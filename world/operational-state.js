const MAX_ACTIONS=1024;
const RECENT_ACTIONS=256;
const MAX_PLANS_PER_CITIZEN=64;
const RECENT_PLANS_PER_CITIZEN=16;
const MAX_EXPERIMENTS=256;
const RECENT_EXPERIMENTS=64;

function nextSequence(stored,length){
  const value=Number(stored);
  return Number.isSafeInteger(value)&&value>=length?value:length;
}

// The ledger is the durable account of completed work. Keep only the
// operational records needed to finish live actions and inspect recent ones.
export function compactOperationalState(world){
  world.actionSequence=nextSequence(world.actionSequence,world.actions.length);
  world.experimentSequence=nextSequence(world.experimentSequence,world.experiments.length);

  if(world.actions.length>MAX_ACTIONS){
    const currentIds=new Set(world.citizens.map(c=>c.currentActionId).filter(Boolean));
    const retained=[];
    let recent=0;
    for(let i=world.actions.length-1;i>=0;i--){
      const action=world.actions[i];
      if(action.status==='active'||currentIds.has(action.id))retained.push(action);
      else if(recent<RECENT_ACTIONS){retained.push(action);recent++;}
    }
    world.actions=retained.reverse();
  }

  const currentPlans=new Map(world.actions.filter(a=>a.status==='active'&&a.planId).map(a=>[a.actorId,a.planId]));
  for(const citizen of world.citizens){
    if(!Array.isArray(citizen.plans))continue;
    citizen.planSequence=nextSequence(citizen.planSequence,citizen.plans.length);
    if(citizen.plans.length<=MAX_PLANS_PER_CITIZEN)continue;
    const currentId=currentPlans.get(citizen.id),retained=[];
    let recent=0;
    for(let i=citizen.plans.length-1;i>=0;i--){
      const plan=citizen.plans[i];
      if(plan.id===currentId)retained.push(plan);
      else if(recent<RECENT_PLANS_PER_CITIZEN){retained.push(plan);recent++;}
    }
    citizen.plans=retained.reverse();
  }

  if(world.experiments.length>MAX_EXPERIMENTS)world.experiments=world.experiments.slice(-RECENT_EXPERIMENTS);
}
