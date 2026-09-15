// Pure game rules. CYM, trust and ownership never determine XP rank.
export const RANKS = Object.freeze([
  { name: 'Observer', xp: 0, difficulty: 1, ability: 'beginner_missions', unlock: 'Observe and verify public evidence' },
  { name: 'Operator', xp: 100, difficulty: 2, ability: 'cooperative_missions', unlock: 'Join cooperative verification teams' },
  { name: 'Builder', xp: 250, difficulty: 3, ability: 'propose_experiment', unlock: 'Propose economic experiments' },
  { name: 'Architect', xp: 600, difficulty: 4, ability: 'allocate_capital', unlock: 'Allocate earned capital to companies' },
  { name: 'Founder', xp: 1000, difficulty: 5, ability: 'found_company', unlock: 'Found a company with an economic mission' },
  { name: 'Institutional', xp: 2000, difficulty: 5, ability: 'systemic_crisis', unlock: 'Lead systemic crisis investigations' },
]);
export function playerProgress(row = {}) {
  const xp = Math.max(0, Number(row.xp) || 0);
  let tier = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) tier = i;
  const rank = RANKS[tier], next = RANKS[tier + 1];
  return { ...row, xp, rank: rank.name, max_difficulty: rank.difficulty, next_rank: next?.name || null,
    next_unlock: next?.unlock || 'All player abilities available', next_xp: next?.xp || xp,
    progress_pct: next ? Math.min(100, Math.round((xp - rank.xp) / (next.xp - rank.xp) * 100)) : 100,
    unlocks: RANKS.slice(0, tier + 1).map(r => r.ability) };
}
export function matchMissions(missions, player, limit = 3) {
  return missions.filter(m => ['open','active','claimed'].includes(m.status) && !m.my_completed && m.difficulty <= player.max_difficulty)
    .sort((a,b) => Number(Boolean(b.my_claim)) - Number(Boolean(a.my_claim)) || a.difficulty - b.difficulty || a.minutes - b.minutes || a.id.localeCompare(b.id)).slice(0, limit);
}
export function worldEvents(m = {}) {
  const events = [];
  const add = (kind,title,district,severity,evidence,impact,boss = false) => events.push({id:kind,kind,title,district,severity,evidence,impact,boss,status:'active'});
  if (m.backlog >= 5) add('contract_backlog','Work is waiting for intelligence','Contract Market','warning',`${m.backlog} unresolved contracts`,'Find and verify work to reduce the backlog.');
  if (m.treasury_cym < 100) add('liquidity_stress','The contribution reserve is under pressure','Central Bank','critical',`${m.treasury_cym} CYM remaining`,'New missions require available reserves; existing escrow stays protected.');
  if (m.proof_count >= 3 && m.rejected_proofs / m.proof_count >= 0.5) add('verification_crisis','Restore confidence in the evidence','Observatory','critical',`${m.rejected_proofs} of ${m.proof_count} proofs rejected`,'Two independent humans must reconcile the public ledger.',true);
  if (m.bankrupt_companies > 0) add('company_bankruptcy','Productive capital has been lost','Industry','critical',`${m.bankrupt_companies} insolvent companies`,'Review costs before deploying more company capital.');
  if (Number(m.inflation_pct) > 5) add('inflation_pressure','Prices are rising rapidly','Central Bank','warning',`${m.inflation_pct}% published inflation`,'Reconcile the price signal before proposing a policy experiment.');
  if (Number(m.active_agent_rate_pct) < 40) add('specialization_collapse','Too few agents are trading','Research District','warning',`${m.active_agent_rate_pct}% active agents`,'Compare district participation to identify unused capacity.');
  return events;
}
export function verifyMissionAnswers(mission, answers = {}) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return {accepted:false,reason:'answers_required',message:'Enter the evidence requested in each field.'};
  for (const field of mission.proof) {
    const actual = answers[field.key], expected = mission.expected[field.key];
    const ok = field.type === 'number'
      ? actual !== null && actual !== '' && typeof actual !== 'boolean' && Number.isFinite(Number(actual)) && Math.abs(Number(actual) - expected) <= (field.tolerance ?? 0.01)
      : typeof actual === 'string' && actual.trim().toLowerCase() === String(expected).toLowerCase();
    if (!ok) return { accepted:false,reason:'evidence_mismatch',message:`Recheck ${field.label || field.key} in the evidence. Your escrow is safe; correct this field and verify again.`,field:field.key };
  }
  return {accepted:true,reason:'evidence_verified',message:'The evidence matches the frozen source. A new independent audit has been recorded.'};
}
export function resolveMissionResult(mission, submissions) {
  const accepted = submissions.filter(s => Number(s.accepted) === 1);
  if (mission.mode === 'cooperative') {
    const selected = [], actors = new Set();
    for (const role of mission.roles) {
      const proof = accepted.find(s => s.role === role && !actors.has(s.actor_id));
      if (!proof) return {complete:false,winners:[]};
      selected.push(proof.actor_id); actors.add(proof.actor_id);
    }
    return {complete:true,winners:selected};
  }
  return {complete:accepted.length > 0,winners:accepted.length ? [accepted[0].actor_id] : []};
}

export function detectMissions(snapshot = {}, research = null, events = []) {
  if (!snapshot.state_hash || !Array.isArray(snapshot.agents) || !snapshot.agents.length || snapshot.agents.some(a=>!Number.isFinite(a.balance))) return [];
  const missions = [], groups = [...new Set(snapshot.agents.map(a=>a.specialty))].sort();
  const common = {status:'open',mode:'competitive',roles:['contributor'],risk:'No capital at risk. Only the first correct audit of this evidence earns the reserved reward.',skill:'Careful observation',difficulty:1,minutes:5,reward_cym:8,xp:50,impact:'One previously unreviewed evidence record independently reconciled.',category:'Observe'};
  for (const specialty of groups) {
    const agents = snapshot.agents.filter(a=>a.specialty===specialty);
    missions.push({...common,id:`audit:${snapshot.state_hash}:${specialty}`,title:`Reconcile the ${specialty} district`,why:`CYMONIA needs an independent check of the ${specialty} district's published balances before its next research decision.`,
      source_hash:snapshot.state_hash,epoch:snapshot.epoch,steps:['Read the frozen district evidence below. Each row represents one economic agent.','Count the rows and add their balances. Round the total to two decimal places.','Enter both answers. Verification checks them against the frozen source and records new audit coverage.'],
      evidence:{url:'/data/state.json',label:`Published epoch ${snapshot.epoch} · ${specialty} district`,summary:'Frozen at mission creation. This is a published simulation snapshot, not your live wallet.',rows:agents.map(a=>({agent:a.agent_id,balance:a.balance}))},
      proof:[{key:'count',label:'Number of agents in this district',type:'number',tolerance:0},{key:'total',label:'Combined balance (round to two decimals)',type:'number',tolerance:0.011}],expected:{count:agents.length,total:Math.round(agents.reduce((s,a)=>s+a.balance,0)*100)/100}});
  }
  if (research?.runs && research?.config?.seeds) for (const seed of research.config.seeds) {
    const baseline=research.runs.find(r=>r.seed===seed&&r.arm==='baseline'), adaptive=research.runs.find(r=>r.seed===seed&&r.arm==='adaptive');
    if (!baseline?.history?.length || !adaptive?.history?.length) continue;
    const a=baseline.history.at(-1), b=adaptive.history.at(-1);
    if (![a.nominal_gdp,b.nominal_gdp,a.gini,b.gini].every(Number.isFinite)) continue;
    missions.push({...common,id:`compare:${research.constitution_hash}:${research.model.id}:${seed}:${a.epoch}:${a.nominal_gdp}:${b.nominal_gdp}`,title:`Compare learning with fixed rules · seed ${seed}`,category:'Compare',reward_cym:12,xp:75,minutes:8,
      why:'CYMONIA needs reproducible comparisons before investing in adaptive agents. A larger output does not automatically mean less inequality.',source_hash:research.constitution_hash,epoch:snapshot.epoch,
      steps:['Read both results from the same initial state and seed.','Choose which world produced more output and which had less inequality. A smaller inequality score means less concentration.','Verify your comparison to add an independent research audit.'],
      evidence:{url:'/data/experiments.json',label:`Matched-seed research · ${seed}`,summary:'Recorded deterministic simulations, not demonstrated live economic improvement.',rows:[{world:'Fixed rules',output:a.nominal_gdp,inequality:a.gini},{world:'Learning agents',output:b.nominal_gdp,inequality:b.gini}]},
      proof:[{key:'output',label:'Which world produced more output?',type:'select',options:['Fixed rules','Learning agents','Equal']},{key:'inequality',label:'Which world had less inequality?',type:'select',options:['Fixed rules','Learning agents','Equal']}],
      expected:{output:a.nominal_gdp===b.nominal_gdp?'Equal':a.nominal_gdp>b.nominal_gdp?'Fixed rules':'Learning agents',inequality:a.gini===b.gini?'Equal':a.gini<b.gini?'Fixed rules':'Learning agents'}});
  }
  for (const event of events) {
    const base=missions[0];
    if (!base) continue;
    missions.push({...base,id:`event:${event.kind}:${snapshot.state_hash}`,title:`${event.title}: independent district review`,why:`${event.evidence}. ${event.impact}`,category:'Review',difficulty:2,mode:'cooperative',roles:['observer','reviewer'],reward_cym:24,xp:75,event_id:event.id,boss:event.boss,
      impact:'Two distinct humans corroborate the same evidence for this investigation. This audit alone does not claim to resolve the crisis.',risk:'Two independent roles must verify the evidence before the team reward is released. Each earns 12 CYM.'});
  }
  return missions;
}
