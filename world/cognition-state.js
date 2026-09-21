const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));

function trimOldest(record,limit,lastMinuteKey='lastWorldMinute'){
  const entries=Object.entries(record);
  if(entries.length<=limit)return;
  entries.sort((a,b)=>Number(a[1]?.[lastMinuteKey]||0)-Number(b[1]?.[lastMinuteKey]||0));
  for(const [key] of entries.slice(0,entries.length-limit))delete record[key];
}

export function ensureCognitionState(citizen,at=0){
  citizen.cognition??={lastReflectionMinute:null,pending:true,reason:'migration'};
  const existing=citizen.cognition.local||{};
  citizen.cognition.local={
    lastLocalChoiceMinute:existing.lastLocalChoiceMinute??null,
    lastOutcomeMinute:existing.lastOutcomeMinute??null,
    outcomes:existing.outcomes&&typeof existing.outcomes==='object'?existing.outcomes:{},
    cooldowns:existing.cooldowns&&typeof existing.cooldowns==='object'?existing.cooldowns:{},
    cognitionDebt:clamp(existing.cognitionDebt,0,1),
    lastAICognitionMinute:existing.lastAICognitionMinute??null,
    aiCognitionCount:Math.max(0,Math.floor(Number(existing.aiCognitionCount)||0)),
  };
  if(!Number.isFinite(Number(at)))citizen.cognition.local.lastLocalChoiceMinute=null;
  return citizen.cognition.local;
}

export function recordAffordanceOutcome(citizen,family,result={},at=0){
  const state=ensureCognitionState(citizen,at);
  const key=String(family||'unknown').slice(0,48);
  const prior=state.outcomes[key]||{attempts:0,successes:0,failures:0,utility:0,lastWorldMinute:null,lastReason:null,lastOk:null};
  const ok=Boolean(result.ok);
  const impulse=ok?.35:-.45;
  state.outcomes[key]={
    attempts:Math.max(0,Number(prior.attempts)||0)+1,
    successes:Math.max(0,Number(prior.successes)||0)+(ok?1:0),
    failures:Math.max(0,Number(prior.failures)||0)+(ok?0:1),
    utility:clamp((Number(prior.utility)||0)*.65+impulse,-1,1),
    lastWorldMinute:Number(at)||0,
    lastReason:result.reason?String(result.reason).slice(0,96):null,
    lastOk:ok,
  };
  state.lastOutcomeMinute=Number(at)||0;
  trimOldest(state.outcomes,24);
  trimOldest(state.cooldowns,48,'setWorldMinute');
  return state;
}

export function outcomeModifier(citizen,family,at=0){
  const state=ensureCognitionState(citizen,at);
  const outcome=state.outcomes[String(family||'unknown')];
  if(!outcome)return 0;
  const elapsed=Math.max(0,(Number(at)||0)-Number(outcome.lastWorldMinute||0));
  return clamp(Number(outcome.utility)||0,-1,1)*Math.exp(-elapsed/4320);
}

export function ageCognitionDebt(citizen,deltaMinutes){
  const state=ensureCognitionState(citizen);
  state.cognitionDebt=clamp(state.cognitionDebt+Math.max(0,Number(deltaMinutes)||0)/10080,0,1);
  return state.cognitionDebt;
}

export function markAICognition(citizen,at=0){
  const state=ensureCognitionState(citizen,at);
  state.cognitionDebt=0;
  state.lastAICognitionMinute=Number(at)||0;
  state.aiCognitionCount+=1;
  return state;
}
