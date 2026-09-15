const EVENT_META = {
  COMPANY_FOUNDED: {icon:'◆', tone:'growth', title:'Company founded'},
  CONSTRUCTION_STARTED: {icon:'▧', tone:'build', title:'Construction started'},
  BUILDING_COMPLETED: {icon:'▣', tone:'growth', title:'Building completed'},
  NEED_DISCOVERED: {icon:'!', tone:'alert', title:'New need discovered'},
  INNOVATION_CREATED: {icon:'✦', tone:'growth', title:'Innovation created'},
  MARKET_PURCHASE: {icon:'¤', tone:'economy', title:'Market purchase'},
  CENTRAL_BANK_POLICY: {icon:'⚖', tone:'policy', title:'Policy rate changed'},
  CRIME_RECORDED: {icon:'⚠', tone:'security', title:'Economic crime recorded'},
  INVESTIGATION_OPENED: {icon:'⌕', tone:'security', title:'Investigation opened'},
  JUSTICE_SENTENCE: {icon:'⚖', tone:'security', title:'Justice sentence issued'},
  HUMAN_CITIZEN_ARRIVED: {icon:'★', tone:'human', title:'Human-linked Citizen arrived'},
  STRATEGY_ACTIVATED: {icon:'◇', tone:'policy', title:'Citizen strategy changed'},
  JOB_ACCEPTED: {icon:'⌁', tone:'work', title:'Citizen accepted a job'},
  WORK_SHIFT: {icon:'⚒', tone:'work', title:'Work shift completed'},
};

const ACTION_META = {
  work: {icon:'⚒', tone:'work', label:'Working'},
  trade: {icon:'¤', tone:'economy', label:'Trading'},
  investigation: {icon:'⌕', tone:'security', label:'Under investigation'},
  crime: {icon:'⚠', tone:'security', label:'Security alert'},
  sentence: {icon:'⚖', tone:'security', label:'Justice action'},
  strategy: {icon:'◇', tone:'policy', label:'Changing strategy'},
  job: {icon:'⌁', tone:'work', label:'Starting a job'},
  commute: {icon:'➜', tone:'mobility', label:'Commuting'},
  arrive: {icon:'★', tone:'human', label:'Arriving'},
  explore: {icon:'◎', tone:'explore', label:'Exploring'},
};

const number = (value, fallback=0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const companyById = (world, id) => (world?.companies || []).find((company) => company.id === id) || null;

export function recentEventForCitizen(citizenId, world, maxAge=3) {
  const tick = number(world?.tick);
  const events = world?.events || [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (tick - number(event.tick, tick) > maxAge) break;
    if (event.actor_id === citizenId || event.payload?.citizen_id === citizenId) return event;
  }
  return null;
}

function result(key, detail, extra={}) {
  return {...ACTION_META[key], key, detail, ...extra};
}

export function deriveCitizenAction(citizen, world) {
  const event = recentEventForCitizen(citizen.id, world);
  if (event?.type === 'INVESTIGATION_OPENED') {
    return result('investigation', 'Police opened a canonical case', {eventId:event.id});
  }
  if (event?.type === 'JUSTICE_SENTENCE') {
    const fine = number(event.payload?.fine);
    return result('sentence', fine ? `Sentence recorded · ${fine.toLocaleString()} CYM fine` : 'Sentence recorded', {eventId:event.id});
  }
  if (event?.type === 'CRIME_RECORDED') {
    return result('crime', 'Economic crime recorded', {eventId:event.id});
  }
  if (event?.type === 'MARKET_PURCHASE') {
    const company = companyById(world, event.payload?.company_id);
    return result('trade', company ? `Buying from ${company.name}` : 'Executing a market purchase', {eventId:event.id});
  }
  if (event?.type === 'STRATEGY_ACTIVATED') {
    return result('strategy', `Goal: ${event.payload?.goal || 'new mandate'}`, {eventId:event.id});
  }
  if (event?.type === 'JOB_ACCEPTED') {
    const company = companyById(world, event.payload?.company_id);
    return result('job', company ? `Joining ${company.name}` : 'Joining a company', {eventId:event.id});
  }
  if (citizen.status === 'working' || event?.type === 'WORK_SHIFT') {
    const companyId = event?.payload?.company_id || citizen.company_id;
    const company = companyById(world, companyId);
    return result('work', company ? `Working at ${company.name}` : 'Producing economic output', {
      eventId:event?.id || null,
      route: Number.isFinite(citizen.target_x) && Number.isFinite(citizen.target_y)
        ? {from:{x:number(citizen.x),y:number(citizen.y)},to:{x:number(citizen.target_x),y:number(citizen.target_y)}}
        : null,
    });
  }
  if (citizen.status === 'arrived') return result('arrive', 'Entering the persistent world');

  const dx = number(citizen.target_x, number(citizen.x)) - number(citizen.x);
  const dy = number(citizen.target_y, number(citizen.y)) - number(citizen.y);
  if (Math.hypot(dx, dy) > 0.75) {
    return result('commute', 'Moving toward the next destination', {
      route:{from:{x:number(citizen.x),y:number(citizen.y)},to:{x:number(citizen.target_x),y:number(citizen.target_y)}},
    });
  }
  return result('explore', 'Scanning the world for opportunity');
}

export function summarizeWorld(world) {
  const citizens = world?.citizens || [];
  const companies = world?.companies || [];
  const buildings = world?.buildings || [];
  const employedIds = new Set(companies.flatMap((company) => company.employees || []));
  const tick = number(world?.tick);
  const recentDecisions = (world?.events || []).filter((event) => tick - number(event.tick, tick) <= 3).length;
  return {
    tick,
    population: number(world?.metrics?.population, citizens.length),
    activeAgents: citizens.length,
    employed: employedIds.size,
    companies: number(world?.metrics?.companies, companies.length),
    buildings: number(world?.metrics?.buildings, buildings.length),
    constructions: buildings.filter((building) => building.status === 'construction').length,
    unemployment: number(world?.metrics?.unemployment),
    treasury: number(world?.institutions?.government?.treasury),
    policyRate: number(world?.institutions?.central_bank?.policy_rate),
    inflation: number(world?.institutions?.central_bank?.inflation),
    moneySupply: number(world?.institutions?.central_bank?.money_supply),
    crimeRate: number(world?.metrics?.crime_rate),
    openCases: number(world?.institutions?.justice?.open_cases),
    recentDecisions,
  };
}

export function eventPresentation(event) {
  const meta = EVENT_META[event?.type] || {icon:'•', tone:'neutral', title:String(event?.type || 'World event').replaceAll('_', ' ').toLowerCase()};
  let subtitle = '';
  if (event?.type === 'CENTRAL_BANK_POLICY') subtitle = `${number(event.payload?.from).toFixed(2)}% → ${number(event.payload?.to).toFixed(2)}%`;
  else if (event?.type === 'MARKET_PURCHASE') subtitle = `${number(event.payload?.amount).toLocaleString()} CYM`;
  else if (event?.type === 'CONSTRUCTION_STARTED') subtitle = event.payload?.type || 'New project';
  else if (event?.type === 'JUSTICE_SENTENCE' && event.payload?.fine != null) subtitle = `${number(event.payload.fine).toLocaleString()} CYM fine`;
  return {...meta, subtitle, eventId:event?.id || '', tick:number(event?.tick)};
}

const ACTION_PRIORITY = {investigation:100,sentence:95,crime:92,trade:80,strategy:72,job:70,work:60,commute:40,arrive:35,explore:10};

export function rankCitizenActivity(world, limit=8) {
  return (world?.citizens || [])
    .map((citizen) => ({citizen, action:deriveCitizenAction(citizen, world)}))
    .sort((a,b) => (ACTION_PRIORITY[b.action.key] || 0) - (ACTION_PRIORITY[a.action.key] || 0) || Number(b.citizen.balance || 0) - Number(a.citizen.balance || 0) || String(a.citizen.id).localeCompare(String(b.citizen.id)))
    .slice(0, Math.max(0, Number(limit) || 0));
}

export function eventTargetId(event) {
  const payload=event?.payload||{};
  if(payload.citizen_id)return payload.citizen_id;
  if(payload.building_id)return payload.building_id;
  if(payload.company_id)return payload.company_id;
  const institution={central_bank:'institution:central_bank',government:'institution:government',justice:'institution:justice',police:'institution:police',observatory:'institution:government'}[event?.actor_id];
  return institution||event?.actor_id||null;
}

const CONSEQUENTIAL_EVENT_TYPES = new Set([
  'COMPANY_FOUNDED','CONSTRUCTION_STARTED','BUILDING_COMPLETED','NEED_DISCOVERED','INNOVATION_CREATED',
  'CENTRAL_BANK_POLICY','CRIME_RECORDED','INVESTIGATION_OPENED','JUSTICE_SENTENCE','HUMAN_CITIZEN_ARRIVED','STRATEGY_ACTIVATED'
]);

export function recentWorldDecisions(world, limit=5) {
  return (world?.events || [])
    .filter((event) => CONSEQUENTIAL_EVENT_TYPES.has(event.type))
    .slice(-Math.max(0,Number(limit)||0))
    .reverse();
}
