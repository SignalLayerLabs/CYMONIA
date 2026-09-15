import test from "node:test";import assert from "node:assert/strict";import {onRequest} from "../functions/api/[[path]].js";import {D1TestDB} from "./helpers/d1.mjs";import {upsertHumanFromGitHub,createSession} from "../functions/_lib/store.js";import {hashSecretToken} from "../functions/_lib/auth.js";
async function setup({AI}={}){const DB=new D1TestDB();const env={CYMONIA_DB:DB,SESSION_HASH_SECRET:"s",WORLD_ADVANCE_TOKEN:"clock",TREASURY_GENESIS_CYM:"1000",AI};const human=await upsertHumanFromGitHub(DB,{id:901,login:"observer",name:"Observer"});const token="t";await createSession(DB,human.actor.id,await hashSecretToken(token,"s"),"2099-01-01T00:00:00Z");return{env,token}}
function req(env,path,{method="GET",body,token,auth}={}){const h=new Headers();if(body!==undefined)h.set("content-type","application/json");if(token)h.set("cookie",`cymonia_session=${token}`);if(auth)h.set("authorization",auth);return onRequest({env,request:new Request(`https://x${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)})})}
test("world is public but advance is scheduler protected",async()=>{const{env}=await setup();let r=await req(env,"/api/world");assert.equal(r.status,200);assert.equal((await r.json()).citizens.length,100);r=await req(env,"/api/world/advance",{method:"POST",body:{ticks:2}});assert.equal(r.status,401);r=await req(env,"/api/world/advance",{method:"POST",body:{ticks:2},auth:"Bearer clock"});assert.equal(r.status,200);assert.equal((await r.json()).tick,2)});
test("authenticated owner can inspect, propose and approve Personal Agent strategy",async()=>{const{env,token}=await setup();let r=await req(env,"/api/agent",{token});assert.equal(r.status,200);let a=(await r.json()).agent;assert.equal(a.versions.length,1);r=await req(env,"/api/agent/propose",{method:"POST",token,body:{intent:"become entrepreneur and stay low risk"}});const proposal=(await r.json()).proposal;assert.equal(proposal.status,"pending");r=await req(env,"/api/agent/approve",{method:"POST",token,body:{version:proposal.version}});assert.equal(r.status,200);assert.equal((await r.json()).strategy.status,"active")});


test("Personal Agent proposal uses Workers AI when bound and persists workers-ai origin",async()=>{
  let calls=0;
  const AI={run:async()=>{calls++;return{response:JSON.stringify({goal:"entrepreneur",risk:"low",save_rate:.4,min_liquidity:1500,prefer:["technology","research"],company_threshold:3000,crime:false})}}};
  const{env,token}=await setup({AI});
  let r=await req(env,"/api/agent/propose",{method:"POST",token,body:{intent:"Build a cautious technology company"}});
  assert.equal(r.status,200);
  const proposal=(await r.json()).proposal;
  assert.equal(calls,1);
  assert.equal(proposal.origin,"workers-ai");
  assert.equal(proposal.ai_status,"available");
  assert.equal(proposal.strategy.goal,"entrepreneur");
  assert.equal(proposal.strategy.mode,"MANUAL");
});
