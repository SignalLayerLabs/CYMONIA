import test from "node:test";import assert from "node:assert/strict";
import {createWorld,advanceWorld,addHumanCitizen,applyCitizenStrategy,explainEvent} from "../functions/_lib/world-engine.js";
import {parseCymScript,translateIntent,canAutoApprove} from "../functions/_lib/cymscript.js";
test("Genesis world permanently starts with 100 founder citizens",()=>{const w=createWorld();assert.equal(w.citizens.length,100);assert.equal(w.citizens.filter(c=>c.kind==="GENESIS_FOUNDER").length,100)});
test("world autonomously discovers needs, companies, construction and markets",()=>{const w=advanceWorld(createWorld(),60);assert.ok(w.needs.length>0);assert.ok(w.companies.length>0);assert.ok(w.buildings.length>0);assert.ok(w.events.some(e=>e.type==="MARKET_PURCHASE"));assert.ok(w.innovations.length>0)});
test("GitHub identity maps to one human-linked citizen",()=>{const w=createWorld();const a=addHumanCitizen(w,{github_id:7,login:"renato"});const b=addHumanCitizen(w,{github_id:7,login:"renamed"});assert.equal(a.id,b.id);assert.equal(w.citizens.filter(c=>c.github_id===7).length,1)});
test("CymScript is bounded, readable and owner guardrails block autonomous risk escalation",()=>{const s=parseCymScript('citizen.goal("entrepreneur")\ncitizen.risk("low")\ncitizen.save(40%)\ncitizen.keep(1500)\ncitizen.company_threshold(3000)');assert.equal(s.goal,"entrepreneur");assert.equal(s.save_rate,.4);const next=translateIntent("be more aggressive and become entrepreneur",s);assert.equal(next.risk,"high");assert.equal(canAutoApprove(s,next),false)});
test("activated human strategy enters canonical event history",()=>{const w=createWorld();const c=addHumanCitizen(w,{github_id:9,login:"human"});applyCitizenStrategy(w,c.id,{...c.strategy,goal:"entrepreneur"});const e=w.events.at(-1);assert.equal(e.type,"STRATEGY_ACTIVATED");assert.ok(explainEvent(w,e.id))});
test("autonomous strategy approval blocks crime escalation and permits de-escalation",()=>{
  const lawful=parseCymScript('citizen.risk("low")\ncitizen.keep(1500)\ncitizen.crime(forbid)');
  assert.equal(canAutoApprove(lawful,{...lawful,crime:true}),false);
  assert.equal(canAutoApprove({...lawful,crime:true},lawful),true);
  assert.equal(canAutoApprove(lawful,{...lawful,min_liquidity:500}),false);
});
test("event IDs remain unique after the rolling window reaches its cap",()=>{
  const world=createWorld();
  const emitted=[world.events[0]];
  advanceWorld(world,400,event=>emitted.push(event));
  assert.ok(emitted.length>5000);
  assert.equal(new Set(emitted.map(event=>event.id)).size,emitted.length);
  assert.equal(world.events.length,5000);
});
test("legacy worlds resume event numbering above existing IDs",()=>{
  const world=advanceWorld(createWorld(),400);
  const lastSequence=Number(world.events.at(-1).id.split(":")[2]);
  delete world.event_sequence;
  applyCitizenStrategy(world,world.citizens[0].id,world.citizens[0].strategy);
  assert.ok(Number(world.events.at(-1).id.split(":")[2])>lastSequence);
});
