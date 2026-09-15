import { normalizeAmount } from './economy.js';

export const COMPANY_STRATEGIES = Object.freeze(['research', 'verification', 'matching']);
export const COMPANY_KPIS = Object.freeze(['completion_rate_pct', 'failure_rate_pct', 'economic_surplus_cym']);
export function validateCompanyCharter(input = {}) {
  const out = {};
  for (const [key,min,max] of [['name',3,80],['mission',24,1000],['target_problem',24,1000]]) {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if (value.length < min || value.length > max) throw new TypeError(`company_${key}_invalid`);
    out[key] = value;
  }
  if (!COMPANY_STRATEGIES.includes(input.strategy)) throw new TypeError('company_strategy_invalid');
  if (!COMPANY_KPIS.includes(input.kpi)) throw new TypeError('company_kpi_invalid');
  return { ...out, purpose: out.mission, strategy: input.strategy, kpi: input.kpi };
}
export function companySummary(company) {
  const revenue = Number(company.revenues_cym || 0), costs = Number(company.costs_cym || 0);
  const successes = Number(company.successful_contracts || 0);
  const level = successes >= 100 ? 5 : successes >= 25 ? 4 : successes >= 10 ? 3 : successes >= 3 ? 2 : 1;
  return { ...company, profit_cym: round(revenue-costs), value_created_cym: round(revenue-costs),
    level, rank: ['Garage','Lab','Firm','Corporation','Institution'][level-1],
    capabilities: ['fund_experiment','compete_for_contract'], max_active_contracts: level,
    book_value_per_stake: company.stake_units > 0 ? round(company.treasury_cym/company.stake_units) : 0,
    staff: {human:company.founder_actor_id,ai:'Advisory research engine; no spending authority'},
    success_rate_pct: (successes + Number(company.failed_contracts || 0)) ? round(100*successes/(successes+Number(company.failed_contracts || 0))) : null };
}
function round(v) {return Math.round(v*1e6)/1e6;}
function stateOf(state = {}) {
  const out = {};
  for (const key of ['seed','backlog','completion_rate_pct','failure_rate_pct','economic_surplus_cym']) {
    const n=Number(state[key]);
    if (!Number.isFinite(n) || n<0 || n>1e12) throw new TypeError('company_world_state_invalid');
    out[key]=n;
  }
  if (out.completion_rate_pct>100 || out.failure_rate_pct>100 || !Number.isInteger(out.seed) || !Number.isInteger(out.backlog)) throw new TypeError('company_world_state_invalid');
  return out;
}
// A bounded queue model, not the canonical Python economy. Common random numbers
// expose the marginal effect of added research capacity on identical opportunities.
export function evaluateCompanyCounterfactual(company, state, budgetValue) {
  if (!COMPANY_STRATEGIES.includes(company.strategy) || !COMPANY_KPIS.includes(company.kpi)) throw new Error('company_charter_required');
  const initial = stateOf(state);
  const budget = normalizeAmount(budgetValue ?? Math.min(30,Number(company.treasury_cym)),1000);
  const opportunities = Math.min(1000,initial.backlog);
  const draws=[]; let seed=initial.seed>>>0;
  for(let i=0;i<opportunities;i++) {seed=(Math.imul(seed,1664525)+1013904223)>>>0;draws.push(seed/4294967296);}
  const gain = Math.min(0.25, Math.sqrt(budget)/100) * ({research:1,verification:0.8,matching:1.2}[company.strategy]);
  const run=(intervention)=>{
    const probability=Math.min(1,initial.completion_rate_pct/100+(intervention?gain:0));
    const completed=draws.filter(n=>n<probability).length;
    const consumed=intervention?budget:0;
    const completion=opportunities?100*completed/opportunities:initial.completion_rate_pct;
    return {seed:initial.seed,initial_state:{...initial},completed,failures:opportunities-completed,
      completion_rate_pct:round(completion),failure_rate_pct:round(opportunities?100-completion:initial.failure_rate_pct),
      capital_consumed_cym:consumed,economic_surplus_cym:round(initial.economic_surplus_cym+completed*10-consumed)};
  };
  const a=run(false), b=run(true), value=round(b.economic_surplus_cym-a.economic_surplus_cym);
  return {scope:'bounded_research_simulation',model_version:1,scope_note:'Paired queue-capacity research model. Ten CYM per modeled completion is an assumption, not earned revenue or a verified change to the live economy.',
    reward_cym:0,world_a:a,world_b:b,target_kpi:company.kpi,kpi_delta:round(b[company.kpi]-a[company.kpi]),
    capital_consumed_cym:budget,value_created_cym:value,roi_pct:round(value/budget*100),
    verdict:value>0?'THIS COMPANY CREATED VALUE':value<0?'THIS COMPANY DESTROYED VALUE':'NO MEASURED VALUE CHANGE',verdict_scope:'simulation only'};
}
