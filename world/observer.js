import {worldDate} from './clock.js';
import {deriveSettlements} from './living-world.js';

// Public history carries causal IDs; full evidence remains available through WHY.
export function publicPhysicalReceipt(r){
  return {id:r.id,receiptId:r.id,eventId:r.eventId||null,actorId:r.actorId,worldMinute:r.worldMinute,actionId:r.actionId,procedureId:r.procedureId,inputObjectIds:r.inputObjectIds,outputObjectIds:r.outputObjectIds,primitives:(r.operations||[]).map(op=>op.primitive),workJ:r.workJ,heatJ:r.heatJ,ambientHeatJ:r.ambientHeatJ};
}
export function publicEventPayload(e){return e.type==='PHYSICAL_OPERATIONS_EXECUTED'?publicPhysicalReceipt(e.payload):e.payload;}

function baseEntry(world,e,label,category='event'){
  return {eventId:e.id,worldMinute:e.worldMinute,date:worldDate(e.worldMinute),category,label,actorId:e.actorId,payload:publicEventPayload(e),observerOnly:true};
}

function culturalClassifications(world){
  const groups=new Map();
  for(const citizen of world.citizens||[]){
    for(const belief of citizen.beliefs||[]){
      if(belief.stanceCode!=='sacred')continue;
      const key=[...(belief.conceptIds||[])].sort().join('|');
      if(!key)continue;
      let group=groups.get(key);if(!group){group={conceptIds:key.split('|'),holders:[],confidence:0,beliefIds:[]};groups.set(key,group);}
      group.holders.push(citizen.id);group.confidence+=Number(belief.confidence||0);group.beliefIds.push(belief.id);
    }
  }
  const out=[];
  for(const group of groups.values()){
    if(group.holders.length<3)continue;
    const related=(world.ledger||[]).filter(e=>e.type==='BELIEF_ADOPTED'&&group.beliefIds.includes(e.payload?.beliefId));
    const last=related.at(-1)||(world.ledger||[]).at(-1);if(!last)continue;
    out.push({
      eventId:`observer:culture:${group.conceptIds.join('+')}:${last.id}`,
      worldMinute:last.worldMinute,
      date:worldDate(last.worldMinute),
      category:'culture',
      label:'Observer classification: proto-religious shared sacred belief',
      confidence:Math.min(.95,.42+group.holders.length*.08+(group.confidence/group.holders.length)*.2),
      observerOnly:true,
      causes:related.map(e=>e.id),
      payload:{conceptIds:group.conceptIds,holderCount:group.holders.length}
    });
  }
  return out;
}

function assignEmergentEras(entries){
  const ordered=[...entries].sort((a,b)=>a.worldMinute-b.worldMinute||String(a.eventId).localeCompare(String(b.eventId)));
  if(!ordered.length)return ordered;
  let era=1,anchor=ordered[0];
  const landmark=new Set(['construction','knowledge','society','culture','conflict','language']);
  for(let i=0;i<ordered.length;i++){
    const entry=ordered[i];
    if(i>0&&landmark.has(entry.category)&&entry.category!==ordered[i-1].category){era++;anchor=entry;}
    entry.era=`Observer Era ${era} — ${anchor.label.replace(/^Observer classification:\s*/i,'').slice(0,52)}`;
  }
  return ordered;
}

export function classifyHistory(world){
  const entries=[];
  for(const e of world.ledger||[]){
    let label=null,category='event';
    if(e.type==='WORLD_GENESIS'){label='Genesis: the first 100 inhabitants awaken';category='genesis';}
    else if(e.type==='BIRTH'){label='A new life begins';category='life';}
    else if(e.type==='DEATH'){label='A Citizen dies';category='life';}
    else if(e.type==='BUILDING_COMPLETED'){label='A constructed structure is completed';category='construction';}
    else if(e.type==='DESIGN_REGISTERED'){label='A new design is recorded';category='knowledge';}
    else if(e.type==='ORGANIZATION_FORMED'){label='A persistent coordination group forms';category='society';}
    else if(e.type==='SIGNAL_COINED'){label='A new communicative symbol appears';category='language';}
    else if(e.type==='EXPERIMENT_COMPLETED'){label='An experiment changes the knowledge frontier';category='knowledge';}
    else if(e.type==='VIOLENCE'){label='Violent conflict recorded';category='conflict';}
    else if(e.type==='ENTITY_DESTROYED'){label='A physical structure or artifact is destroyed';category='conflict';}
    else if(e.type==='RESOURCE_PATCH_DAMAGED'){label='A natural resource patch is heavily damaged';category='ecology';}
    else if(e.type==='REPAIR_COMPLETED'){label='A damaged physical object is repaired';category='construction';}
    else if(e.type==='GRIEVANCE_CREATED'){label='A persistent grievance forms from experienced harm';category='society';}
    else if(e.type==='PHYSICAL_OPERATIONS_EXECUTED'){label='A physical operation sequence produces an observed outcome';category='knowledge';}
    else if(e.type==='PROCEDURE_DISCOVERED'){label='A Citizen remembers a successful physical procedure';category='knowledge';}
    else if(e.type==='PROCEDURE_MODIFIED'){label='A Citizen changes a learned procedure';category='knowledge';}
    else if(e.type==='PROCEDURE_TRANSMITTED'||e.type==='PROCEDURE_LEARNED'){label='Physical procedure knowledge is transmitted';category='knowledge';}
    else if(e.type==='PROCEDURE_LOST'||e.type==='PROCEDURE_KNOWLEDGE_FORGOTTEN'){label='Physical procedure knowledge is lost';category='knowledge';}
    else if(e.type==='PROCEDURE_ATTEMPT_FAILED'){label='A procedure attempt contradicts expectations';category='knowledge';}
    else if(e.type==='PROGRAM_CREATED'){label='A Citizen creates a persistent behavioral program';category='knowledge';}
    else continue;
    entries.push(baseEntry(world,e,label,category));
  }
  const recentViolence=(world.ledger||[]).filter(e=>e.type==='VIOLENCE').slice(-20);
  if(recentViolence.length>=2){
    const last=recentViolence.at(-1);
    entries.push({eventId:`observer:conflict:${last.id}`,worldMinute:last.worldMinute,date:worldDate(last.worldMinute),category:'conflict',label:'Observer classification: organized or escalating conflict',confidence:Math.min(.95,.45+recentViolence.length*.08),observerOnly:true,causes:recentViolence.map(e=>e.id)});
  }
  entries.push(...culturalClassifications(world));
  for(const settlement of deriveSettlements(world,world.clock.worldMinute))entries.push({eventId:settlement.id,worldMinute:settlement.sinceWorldMinute,date:worldDate(settlement.sinceWorldMinute),category:'society',label:'Observer classification: persistent settlement cluster',confidence:Math.min(.95,.48+settlement.buildings*.08+Math.min(.2,settlement.useMinutes/10000)),observerOnly:true,causes:[],payload:{structureIds:settlement.structureIds,population:settlement.population,useMinutes:settlement.useMinutes,traffic:settlement.traffic}});
  const withEras=assignEmergentEras(entries);
  return {entries:withEras.sort((a,b)=>b.worldMinute-a.worldMinute||String(b.eventId).localeCompare(String(a.eventId)))};
}

export function why(world,eventId,depth=4){
  const by=new Map((world.ledger||[]).map(e=>[e.id,e]));let root=by.get(eventId);if(!root){const receipt=(world.physicalReceipts||[]).find(r=>r.id===eventId||r.eventId===eventId);const object=(world.objects||[]).find(o=>o.id===eventId),procedure=(world.procedures||[]).find(p=>p.id===eventId);root=by.get(object?.lastPhysicalEventId||object?.provenance?.eventId||procedure?.evidenceEventId)||[...by.values()].find(e=>e.type==='ACTION_STARTED'&&e.payload?.actionId===eventId)||[...by.values()].findLast(e=>e.payload?.procedureId===eventId);if(!root&&receipt)root={id:receipt.eventId,type:'PHYSICAL_OPERATIONS_EXECUTED',actorId:receipt.actorId,worldMinute:receipt.worldMinute,payload:receipt,causes:[],archivedEvidence:true};}if(!root)return null;
  const walk=(e,d)=>({event:e,causes:d>0?(e.causes||[]).map(id=>by.get(id)).filter(Boolean).map(x=>walk(x,d-1)):[]});
  return walk(root,depth);
}
