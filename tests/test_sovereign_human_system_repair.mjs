import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {createHumanAvatar,submitHumanIntent} from '../world/engine.js';
import {killCitizen} from '../world/biology.js';
import {totalTrackedMass} from '../world/materials.js';
import {classifyHistory} from '../world/observer.js';
import {appendEvent,compactLedger,verifyLedger} from '../world/ledger.js';

async function repairAPI(){return import('../world/system-repair.js');}
function incident(){
  const w=createSovereignGenesis({realEpochMs:0});
  const a=createHumanAvatar(w,{externalId:'github:111',displayName:'Alice'});
  const b=createHumanAvatar(w,{externalId:'github:222',displayName:'Bob'});
  a.knowledge.push({concept:'learned:local',confidence:1,provenance:[]});
  killCitizen(w,a,'disease_or_biology',300000);
  killCitizen(w,w.citizens[0],'disease_or_biology',300000);
  w.clock.worldMinute=1944000;
  return {w,a,b};
}

test('human incident restores the existing GitHub identity with auditable death and conserved mass',async()=>{
  const {applyHumanSystemRepair,HUMAN_SYSTEM_REPAIR_ID}=await repairAPI();
  const {w,a,b}=incident(),before=totalTrackedMass(w),count=w.citizens.length;
  const identity={id:a.id,externalId:a.externalId,displayName:a.observerDisplayName,knowledge:structuredClone(a.knowledge)};
  assert.equal(applyHumanSystemRepair(w,null),false);
  assert.equal(applyHumanSystemRepair(w,HUMAN_SYSTEM_REPAIR_ID),true);
  assert.equal(w.citizens.length,count);assert.equal(w.citizens[0].alive,false);
  assert.equal(a.alive,true);assert.equal(a.body.alive,true);assert.equal(a.deathWorldMinute,null);
  assert.equal(a.body.health,100);assert.equal(b.alive,true);
  assert.deepEqual({id:a.id,externalId:a.externalId,displayName:a.observerDisplayName,knowledge:a.knowledge},identity);
  assert.equal(createHumanAvatar(w,{externalId:identity.externalId}),a);
  assert.doesNotThrow(()=>submitHumanIntent(w,a.id,'explore'));
  assert.ok(Math.abs(totalTrackedMass(w)-before)<1e-6);
  assert.ok(w.objects.some(o=>o.provenance?.citizenId===a.id));
  assert.ok(verifyLedger(w));
  const notice=classifyHistory(w).entries.find(e=>e.category==='system');
  assert.match(notice.label,/GitHub.*bug di sistema/);
  assert.deepEqual(notice.payload.previousDeaths,[{citizenId:a.id,deathWorldMinute:300000}]);
  assert.equal(JSON.stringify(notice).includes(identity.externalId),false);
  appendEvent(w,'OBSERVATION','world');compactLedger(w,1);
  assert.ok(classifyHistory(w).entries.some(e=>e.category==='system'));
  const reloaded=JSON.parse(JSON.stringify(w));
  killCitizen(reloaded,reloaded.citizens.find(c=>c.id===a.id),'later_natural_death',1945000);
  assert.equal(applyHumanSystemRepair(reloaded,HUMAN_SYSTEM_REPAIR_ID),false);
  assert.equal(reloaded.citizens.find(c=>c.id===a.id).alive,false);
});

test('human repair excludes post-fix deaths and refuses insufficient material without partial changes',async()=>{
  const {applyHumanSystemRepair,HUMAN_SYSTEM_REPAIR_ID}=await repairAPI();
  const {w,b}=incident();killCitizen(w,b,'later_natural_death',1943000);
  w.environment.naturalReservoirs.biomassKg=0;
  const before=JSON.stringify(w);
  assert.throws(()=>applyHumanSystemRepair(w,HUMAN_SYSTEM_REPAIR_ID),/insufficient_biomass/);
  assert.equal(JSON.stringify(w),before);
  w.environment.naturalReservoirs.biomassKg=10000;
  applyHumanSystemRepair(w,HUMAN_SYSTEM_REPAIR_ID);
  assert.equal(b.alive,false);
});

test('human restoration survives a real SQLite wake and a subsequent death stays permanent',async t=>{
  const {sqliteStorage,wake,readWorld}=await import('./helpers/sovereign-sqlite.mjs');
  const {HUMAN_SYSTEM_REPAIR_ID}=await repairAPI();
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  const a=createHumanAvatar(instance.world,{externalId:'github:recovery',displayName:'Recovery User'});
  killCitizen(instance.world,a,'disease_or_biology',400000);
  instance.world.clock.worldMinute=1944000;await instance.persist({forceSeal:true});
  const {instance:restored}=await wake(storage,{HUMAN_SYSTEM_REPAIR_ID});
  assert.equal(restored.world.citizens.find(c=>c.id===a.id).alive,true);
  const visible=await readWorld(restored);
  assert.ok(visible.citizens.some(c=>c.id===a.id&&c.alive));
  assert.ok(visible.history.some(e=>e.label.includes('collegati a GitHub')));
  killCitizen(restored.world,restored.world.citizens.find(c=>c.id===a.id),'later_natural_death',1944100);
  restored.world.clock.worldMinute=1944100;await restored.persist({forceSeal:true});
  const {instance:again}=await wake(storage,{HUMAN_SYSTEM_REPAIR_ID});
  assert.equal(again.world.citizens.find(c=>c.id===a.id).alive,false);
  assert.equal(again.world.citizens.filter(c=>c.externalId==='github:recovery').length,1);
});
