import {
  createSovereignGenesis,
  advanceWorldTo,
  publicWorld,
  getHistory,
  getWhy,
  createHumanAvatar,
  submitHumanIntent,
  acceptCognitiveProposal,
  buildCognitiveContext,
  sanitizeAIProposal,
  appendEvent,
  worldMinuteAt,
  REAL_MS_PER_WORLD_MINUTE,
} from '../../world/index.js';

const MODEL='@cf/zai-org/glm-4.7-flash';
const ALARM_MS=1000;
const AI_CALLS_PER_REAL_DAY=200;
const AI_RETRY_COOLDOWN_MS=60_000;
const AI_CALL_TIMEOUT_MS=3_000;
const CHECKPOINT_WORLD_MINUTES=60;
const SNAPSHOT_CHUNK_CODE_UNITS=256*1024;
const MAX_CATCHUP_WORLD_MINUTES=360;

function json(data,status=200,headers={}){
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
}
function parseJsonText(value){
  if(value&&typeof value==='object'&&!Array.isArray(value))return value;
  const raw=String(value||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
  if(start<0||end<start)throw new Error('ai_json_missing');
  return JSON.parse(raw.slice(start,end+1));
}
function utcDay(ms=Date.now()){return new Date(ms).toISOString().slice(0,10);}
function ensureRuntime(world){
  world.runtime??={};
  world.runtime.aiBudget??={day:utcDay(),calls:0,lastExhaustedDay:null,lastFailureRealMs:0};
  world.runtime.lastSealWorldMinute??=-CHECKPOINT_WORLD_MINUTES;
  return world.runtime;
}
function resetDailyBudget(world){
  const runtime=ensureRuntime(world),day=utcDay();
  if(runtime.aiBudget.day!==day){runtime.aiBudget={day,calls:0,lastExhaustedDay:null,lastFailureRealMs:0};}
  return runtime.aiBudget;
}
function configuredDailyBudget(env){
  const raw=Number(env.AI_CALLS_PER_REAL_DAY||AI_CALLS_PER_REAL_DAY);
  return Number.isFinite(raw)?Math.max(0,Math.floor(raw)):AI_CALLS_PER_REAL_DAY;
}
async function sha256Hex(text){
  const bytes=new TextEncoder().encode(text);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function askAI(env,context){
  if(!env.AI?.run)throw new Error('ai_unavailable');
  const system=`You are the private cognition process of one inhabitant of CYMONIA. You are NOT an Earth assistant. Use ONLY facts, opaque concept IDs, entities, memories and evidence present in the supplied context. Never introduce Earth institutions, technologies, languages, history, religion, science, objects, recipes or proper names unless the exact concept already exists in context. External direction is a preference only and never factual knowledge. Return strict JSON only, with this shape: {"concepts":["known concept id"],"beliefUpdates":[{"stanceCode":"supports|opposes|uncertain|sacred|taboo|causal|identity|normative","conceptIds":["known concept id"],"confidence":0.0}],"actions":[{"type":"MOVE|OBSERVE|REST|SLEEP|EAT|DRINK|GATHER|CARRY|CUT|DIG|HEAT|COOL|MIX|ASSEMBLE|BUILD|CARE|TEACH|COMMUNICATE|EXPERIMENT|ATTACK|DEFEND|TRANSFER|PROMISE|CLAIM|REPRODUCE","durationMinutes":number,"targetId":string|null,"targetPosition":{"x":number,"y":number}|null,"purpose":"survival|explore|cooperate|care|experiment|construct|defend|communicate|self_directed","concepts":["known concept id"],"payload":object}]}. Payload may contain only IDs and primitive parameters supported by the action. For GATHER use quantity. For TEACH/COMMUNICATE use concept, conceptIds, beliefId or primitiveSignal. For PROMISE use kindCode and purposeConcept. For CLAIM use predicateCode, subjectId and purposeConcept. For EXPERIMENT use targetIds and methodCode. For BUILD use projectId or inputObjectIds, site, workMinutes and form. For TRANSFER use objectId. For CUT/DIG/HEAT/COOL/MIX/ASSEMBLE use inputObjectIds, quantities and form. REPRODUCE uses only targetId. Prefer a short coherent plan. If knowledge is insufficient, OBSERVE, COMMUNICATE or EXPERIMENT instead of assuming.`;
  const out=await env.AI.run(env.BRAIN_MODEL||MODEL,{messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(context)}],max_tokens:620,temperature:.7});
  const text=out?.response??out?.result?.response??out?.result??out;
  return sanitizeAIProposal(parseJsonText(text));
}
async function withTimeout(promise,timeoutMs,label='operation_timeout'){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}
export function splitSnapshot(serialized,maxCodeUnits=SNAPSHOT_CHUNK_CODE_UNITS){
  const source=String(serialized),parts=[];
  for(let start=0;start<source.length;){
    let end=Math.min(source.length,start+maxCodeUnits);
    if(end<source.length){const before=source.charCodeAt(end-1),after=source.charCodeAt(end);if(before>=0xD800&&before<=0xDBFF&&after>=0xDC00&&after<=0xDFFF)end--;}
    parts.push(source.slice(start,end));start=end;
  }
  return parts.length?parts:[''];
}
export function joinSnapshot(parts){return parts.join('');}
export function advanceWorldBounded(world,nowMs=Date.now(),maxCatchup=MAX_CATCHUP_WORLD_MINUTES){
  let target=worldMinuteAt(world,nowMs),recovered=false,skippedWorldMinutes=0;
  const pristine=world.clock.worldMinute===0&&world.actions.length===0&&world.ledger.length<=2;
  if(pristine&&target>maxCatchup){
    skippedWorldMinutes=target;
    world.clock.realEpochMs=nowMs-REAL_MS_PER_WORLD_MINUTE;
    appendEvent(world,'RUNTIME_GENESIS_RECOVERED','world',{skippedWorldMinutes,reason:'unpersisted_runtime_outage'},[],0);
    target=1;recovered=true;
  }
  const next=Math.min(target,world.clock.worldMinute+maxCatchup);
  const boundedNow=world.clock.realEpochMs+next*REAL_MS_PER_WORLD_MINUTE;
  advanceWorldTo(world,boundedNow);
  return {recovered,skippedWorldMinutes,lagWorldMinutes:Math.max(0,target-next)};
}

export class SovereignWorld {
  constructor(ctx,env){
    this.ctx=ctx;
    this.env=env;
    this.sql=ctx.storage.sql;
    this.world=null;
    this.persistSequence=0;
    this.clients=new Set();
    ctx.blockConcurrencyWhile(async()=>{
      this.initializeSQLite();
      this.world=this.loadWorld();
      if(!this.world){
        this.world=createSovereignGenesis({realEpochMs:Date.now()});
        ensureRuntime(this.world);
        await this.persist({forceSeal:true});
      }else ensureRuntime(this.world);
      await this.ensureAlarm();
    });
  }
  initializeSQLite(){
    this.sql.exec(`CREATE TABLE IF NOT EXISTS world_state(
      id INTEGER PRIMARY KEY CHECK(id=1),
      state_json TEXT NOT NULL,
      world_minute INTEGER NOT NULL,
      ledger_head TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS world_seals(
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      world_minute INTEGER NOT NULL,
      ledger_head TEXT NOT NULL,
      state_sha256 TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS world_state_chunks(
      generation TEXT NOT NULL,
      seq INTEGER NOT NULL,
      state_part TEXT NOT NULL,
      PRIMARY KEY(generation,seq)
    )`);
  }
  loadWorld(){
    const rows=[...this.sql.exec('SELECT state_json FROM world_state WHERE id=1 LIMIT 1')];
    if(!rows.length)return null;
    const stored=JSON.parse(rows[0].state_json);
    let world=stored;
    if(stored?.format==='chunked-v1'){
      const parts=[...this.sql.exec('SELECT state_part FROM world_state_chunks WHERE generation=? ORDER BY seq',stored.generation)].map(row=>row.state_part);
      if(parts.length!==stored.chunkCount)throw new Error('sovereign_world_chunks_incomplete');
      world=JSON.parse(joinSnapshot(parts));
    }
    if(!world||world.version!==2||!Array.isArray(world.citizens)||!Array.isArray(world.ledger))throw new Error('sovereign_world_state_invalid');
    return world;
  }
  async ensureAlarm(){
    const current=await this.ctx.storage.getAlarm();
    if(current===null)await this.ctx.storage.setAlarm(Date.now()+ALARM_MS);
  }
  async persist({forceSeal=false}={}){
    const runtime=ensureRuntime(this.world);
    const now=Date.now();
    const due=forceSeal||this.world.clock.worldMinute-runtime.lastSealWorldMinute>=CHECKPOINT_WORLD_MINUTES;
    if(due)runtime.lastSealWorldMinute=this.world.clock.worldMinute;
    const serialized=JSON.stringify(this.world),generation=`${now}-${++this.persistSequence}`,parts=splitSnapshot(serialized);
    const metadata=JSON.stringify({format:'chunked-v1',generation,chunkCount:parts.length});
    const stateSha256=due?await sha256Hex(serialized):null;
    this.ctx.storage.transactionSync(()=>{
      for(let seq=0;seq<parts.length;seq++)this.sql.exec('INSERT INTO world_state_chunks(generation,seq,state_part) VALUES(?,?,?)',generation,seq,parts[seq]);
      this.sql.exec(`INSERT INTO world_state(id,state_json,world_minute,ledger_head,updated_at)
        VALUES(1,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,world_minute=excluded.world_minute,ledger_head=excluded.ledger_head,updated_at=excluded.updated_at`,
        metadata,this.world.clock.worldMinute,this.world.ledgerHead,now);
      this.sql.exec('DELETE FROM world_state_chunks WHERE generation<>?',generation);
      if(due){
        this.sql.exec('INSERT INTO world_seals(world_minute,ledger_head,state_sha256,created_at) VALUES(?,?,?,?)',this.world.clock.worldMinute,this.world.ledgerHead,stateSha256,now);
        this.sql.exec('DELETE FROM world_seals WHERE seq NOT IN (SELECT seq FROM world_seals ORDER BY seq DESC LIMIT 4096)');
      }
    });
  }
  async tick(){
    await this.ctx.storage.setAlarm(Date.now()+ALARM_MS);
    advanceWorldBounded(this.world,Date.now());
    await this.processCognition(1);
    await this.persist();
    this.broadcast({type:'world_delta',state:publicWorld(this.world,Date.now())});
  }
  async alarm(){await this.tick();}
  async processCognition(limit){
    if(!this.env.AI?.run)return;
    const budget=resetDailyBudget(this.world),dailyLimit=configuredDailyBudget(this.env),runtime=ensureRuntime(this.world);
    if(Date.now()-Number(budget.lastFailureRealMs||0)<AI_RETRY_COOLDOWN_MS)return;
    if(budget.calls>=dailyLimit){
      if(budget.lastExhaustedDay!==budget.day){
        budget.lastExhaustedDay=budget.day;
        appendEvent(this.world,'COGNITION_DEFERRED','world',{reason:'ai_budget_exhausted',dailyLimit},[],this.world.clock.worldMinute);
      }
      return;
    }
    const queue=this.world.cognitionQueue.sort((a,b)=>b.priority-a.priority);
    let used=0;
    while(queue.length&&used<limit&&budget.calls<dailyLimit){
      const item=queue.shift();
      const c=this.world.citizens.find(x=>x.id===item.citizenId&&x.alive);
      if(!c)continue;
      budget.calls++;
      try{
        const proposal=await withTimeout(askAI(this.env,buildCognitiveContext(this.world,c,this.world.clock.worldMinute)),AI_CALL_TIMEOUT_MS,'ai_timeout');
        acceptCognitiveProposal(this.world,c.id,proposal,this.world.clock.worldMinute);
        appendEvent(this.world,'AI_COGNITION',c.id,{model:this.env.BRAIN_MODEL||MODEL,reason:item.reason,status:'accepted',knowledgeContextCount:c.knowledge.filter(k=>k.active!==false).length},[],this.world.clock.worldMinute);
        budget.lastFailureRealMs=0;
      }catch(error){
        budget.lastFailureRealMs=Date.now();
        appendEvent(this.world,'COGNITION_DEFERRED',c.id,{reason:item.reason,error:String(error?.message||error).slice(0,160)},[],this.world.clock.worldMinute);
        queue.push({...item,priority:Math.max(.2,item.priority-.02)});
      }
      used++;
    }
    runtime.aiBudget=budget;
  }
  broadcast(message){
    const text=JSON.stringify(message);
    for(const ws of this.clients){try{ws.send(text);}catch{this.clients.delete(ws);}}
  }
  webSocket(){
    const pair=new WebSocketPair(),client=pair[0],server=pair[1];
    this.ctx.acceptWebSocket(server);
    this.clients.add(server);
    server.send(JSON.stringify({type:'world_snapshot',state:publicWorld(this.world,Date.now())}));
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketClose(ws){this.clients.delete(ws);}
  webSocketError(ws){this.clients.delete(ws);}
  async fetch(request){
    const url=new URL(request.url),path=url.pathname.replace(/^\/world/,'')||'/';
    if(request.headers.get('upgrade')==='websocket'&&path==='/stream')return this.webSocket();
    if(request.method==='GET'&&path==='/health'){
      const budget=resetDailyBudget(this.world);
      return json({ok:true,service:'cymonia-sovereign-world',version:2,model:this.env.BRAIN_MODEL||MODEL,ai:Boolean(this.env.AI?.run),ai_budget:{day:budget.day,calls:budget.calls,limit:configuredDailyBudget(this.env)},world_id:this.world.worldId,world_minute:this.world.clock.worldMinute,lag_world_minutes:Math.max(0,worldMinuteAt(this.world,Date.now())-this.world.clock.worldMinute),ledger_head:this.world.ledgerHead,persistence:'durable-object-sqlite-chunked'});
    }
    if(request.method==='GET'&&(path==='/'||path==='/state'))return json({ok:true,world:publicWorld(this.world,Date.now())});
    if(request.method==='GET'&&path==='/history')return json({ok:true,history:getHistory(this.world)});
    if(request.method==='GET'&&path.startsWith('/why/')){
      const id=decodeURIComponent(path.slice(5)),why=getWhy(this.world,id);
      return why?json({ok:true,why}):json({ok:false,error:'event_not_found'},404);
    }
    if(request.method==='POST'&&path==='/avatar'){
      const body=await request.json();
      if(!body?.actor?.id)return json({ok:false,error:'actor_required'},400);
      const c=createHumanAvatar(this.world,{externalId:`github:${body.actor.github_id||body.actor.id}`,displayName:body.actor.display_name||body.actor.github_login||null},this.world.clock.worldMinute);
      await this.persist({forceSeal:true});
      return json({ok:true,citizenId:c.id});
    }
    if(request.method==='POST'&&path==='/intent'){
      const body=await request.json();
      if(!body?.citizenId||!String(body.intent||'').trim())return json({ok:false,error:'intent_required'},400);
      const result=submitHumanIntent(this.world,body.citizenId,body.intent,this.world.clock.worldMinute);
      await this.persist({forceSeal:true});
      return json({ok:true,...result});
    }
    return json({ok:false,error:'not_found'},404);
  }
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    const id=env.WORLD.idFromName('canonical-v2'),stub=env.WORLD.get(id),routed=new URL(request.url);
    routed.pathname=`/world${url.pathname}`;
    return stub.fetch(new Request(routed,request));
  }
};
