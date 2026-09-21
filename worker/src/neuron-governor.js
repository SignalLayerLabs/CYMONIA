export const NEURON_BUDGET_LIMITS=Object.freeze({normal:8000,priority:9000,emergency:9500});
export const MODEL_NEURON_RATES=Object.freeze({
  '@cf/zai-org/glm-4.7-flash':Object.freeze({
    rateId:'cloudflare-glm-4.7-flash-2026-09',
    inputPerMillion:5500,
    outputPerMillion:36400,
  }),
});

const finiteNonNegative=value=>Number.isFinite(Number(value))&&Number(value)>=0;
const precise=value=>Number(Number(value).toFixed(9));
const utcDay=ms=>new Date(ms).toISOString().slice(0,10);

function blankBudget(day,lastFailureRealMs=0){
  return {day,usedNeurons:0,reservedNeurons:0,calls:0,promptTokens:0,completionTokens:0,lastFailureRealMs:Number(lastFailureRealMs)||0,lastExhaustedDay:null,lastAccountingWarning:null};
}

function normalizeBudget(value,day){
  const budget=value&&value.day===day?value:blankBudget(day);
  budget.day=day;
  budget.usedNeurons=finiteNonNegative(budget.usedNeurons)?Number(budget.usedNeurons):0;
  budget.reservedNeurons=finiteNonNegative(budget.reservedNeurons)?Number(budget.reservedNeurons):0;
  budget.calls=finiteNonNegative(budget.calls)?Math.floor(Number(budget.calls)):0;
  budget.promptTokens=finiteNonNegative(budget.promptTokens)?Math.floor(Number(budget.promptTokens)):0;
  budget.completionTokens=finiteNonNegative(budget.completionTokens)?Math.floor(Number(budget.completionTokens)):0;
  budget.lastFailureRealMs=finiteNonNegative(budget.lastFailureRealMs)?Number(budget.lastFailureRealMs):0;
  budget.lastExhaustedDay=budget.lastExhaustedDay?String(budget.lastExhaustedDay):null;
  budget.lastAccountingWarning=budget.lastAccountingWarning?String(budget.lastAccountingWarning).slice(0,96):null;
  return budget;
}

export function ensureNeuronBudget(world,nowMs=Date.now()){
  world.runtime??={};
  const day=utcDay(nowMs);
  let current=world.runtime.neuronBudget;
  if(!current){
    const legacy=world.runtime.aiBudget;
    current=blankBudget(day,legacy?.lastFailureRealMs);
    if(legacy?.day===day)current.calls=Math.max(0,Math.floor(Number(legacy.calls)||0));
  }
  world.runtime.neuronBudget=normalizeBudget(current,day);
  delete world.runtime.aiBudget;
  return world.runtime.neuronBudget;
}

function modelRate(model,rates=MODEL_NEURON_RATES){
  if(!rates)return null;
  if(rates.inputPerMillion!==undefined&&rates.outputPerMillion!==undefined)return rates;
  return rates[model]||null;
}

function neuronCost(promptTokens,completionTokens,rate){
  return precise(promptTokens*Number(rate.inputPerMillion)/1_000_000+completionTokens*Number(rate.outputPerMillion)/1_000_000);
}

function positiveOverride(value,fallback,ceiling=Infinity){
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>0?Math.min(parsed,ceiling):fallback;
}

export function resolveNeuronConfig(env={},model='@cf/zai-org/glm-4.7-flash'){
  const emergency=positiveOverride(env.AI_NEURON_HARD_LIMIT,NEURON_BUDGET_LIMITS.emergency,NEURON_BUDGET_LIMITS.emergency);
  const priority=Math.min(emergency,positiveOverride(env.AI_NEURON_PRIORITY_LIMIT,NEURON_BUDGET_LIMITS.priority,NEURON_BUDGET_LIMITS.priority));
  const normal=Math.min(priority,positiveOverride(env.AI_NEURON_SOFT_LIMIT,NEURON_BUDGET_LIMITS.normal,NEURON_BUDGET_LIMITS.normal));
  const base=MODEL_NEURON_RATES[model]||null;
  const inputPerMillion=positiveOverride(env.AI_INPUT_NEURONS_PER_MILLION,base?.inputPerMillion??NaN);
  const outputPerMillion=positiveOverride(env.AI_OUTPUT_NEURONS_PER_MILLION,base?.outputPerMillion??NaN);
  const overridden=env.AI_INPUT_NEURONS_PER_MILLION!==undefined||env.AI_OUTPUT_NEURONS_PER_MILLION!==undefined;
  const rates=Number.isFinite(inputPerMillion)&&Number.isFinite(outputPerMillion)?{rateId:overridden?`environment-override:${model}`:base.rateId,inputPerMillion,outputPerMillion}:null;
  return {limits:{normal,priority,emergency},rates};
}

export function estimateReservation(model,context,maxCompletionTokens,rates=MODEL_NEURON_RATES){
  const rate=modelRate(model,rates);
  if(!rate||!finiteNonNegative(rate.inputPerMillion)||!finiteNonNegative(rate.outputPerMillion))return Infinity;
  const promptTokens=Math.ceil(String(context??'').length/3);
  const completionTokens=Math.ceil(Math.max(0,Number(maxCompletionTokens)||0));
  return neuronCost(promptTokens,completionTokens,rate);
}

export function neuronCapacity(budget,reserveClass='normal',limits=NEURON_BUDGET_LIMITS){
  const ceiling=limits?.[reserveClass];
  if(!ceiling)return 0;
  const used=finiteNonNegative(budget?.usedNeurons)?Number(budget.usedNeurons):0;
  const reserved=finiteNonNegative(budget?.reservedNeurons)?Number(budget.reservedNeurons):0;
  return precise(Math.max(0,ceiling-used-reserved));
}

export function reserveNeurons(budget,amount,reserveClass='normal',limits=NEURON_BUDGET_LIMITS){
  if(!budget||!limits?.[reserveClass])return {ok:false,reason:'neuron_reserve_class_invalid'};
  if(!finiteNonNegative(amount)||!Number.isFinite(Number(amount)))return {ok:false,reason:'neuron_estimate_unavailable'};
  const held=Math.ceil(Number(amount));
  if(held>neuronCapacity(budget,reserveClass,limits))return {ok:false,reason:`neuron_${reserveClass}_budget_exhausted`};
  budget.reservedNeurons=precise((Number(budget.reservedNeurons)||0)+held);
  return {ok:true,reservation:{amount:held,reserveClass,reconciled:false}};
}

function findUsage(value){
  const candidates=[value,value?.usage,value?.result?.usage,value?.result?.response?.usage,value?.response?.usage];
  for(const candidate of candidates){
    if(!candidate||typeof candidate!=='object')continue;
    const prompt=candidate.prompt_tokens??candidate.input_tokens;
    const completion=candidate.completion_tokens??candidate.output_tokens;
    if(finiteNonNegative(prompt)&&finiteNonNegative(completion))return {promptTokens:Math.ceil(Number(prompt)),completionTokens:Math.ceil(Number(completion))};
  }
  return null;
}

export function reconcileNeurons(budget,reservation,usage,model,rates=MODEL_NEURON_RATES){
  if(!reservation||reservation.reconciled)return {charged:0,warning:'reservation_already_reconciled'};
  reservation.reconciled=true;
  budget.reservedNeurons=precise(Math.max(0,(Number(budget.reservedNeurons)||0)-Number(reservation.amount||0)));
  const parsed=findUsage(usage),rate=modelRate(model,rates);
  let charged,warning=null;
  if(parsed&&rate&&finiteNonNegative(rate.inputPerMillion)&&finiteNonNegative(rate.outputPerMillion)){
    charged=neuronCost(parsed.promptTokens,parsed.completionTokens,rate);
    budget.promptTokens=(Number(budget.promptTokens)||0)+parsed.promptTokens;
    budget.completionTokens=(Number(budget.completionTokens)||0)+parsed.completionTokens;
  }else{
    charged=Number(reservation.amount)||0;
    warning=parsed?'model_rate_missing_charged_reservation':'usage_missing_charged_reservation';
  }
  budget.usedNeurons=precise((Number(budget.usedNeurons)||0)+charged);
  budget.calls=Math.max(0,Math.floor(Number(budget.calls)||0))+1;
  budget.lastAccountingWarning=warning;
  return {charged,warning};
}
