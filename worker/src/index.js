import {
  createSovereignGenesis,
  advanceWorldTo,
  publicWorld,
  getHistory,
  getWhy,
  createHumanAvatar,
  submitHumanIntent,
  acceptAIStrategy,
  buildCognitiveContext,
  sanitizeAIStrategy,
  appendEvent,
  compactLedger,
  worldMinuteAt,
  REAL_MS_PER_WORLD_MINUTE,
  queueCognition,
  takeCognitionCandidate,
} from '../../world/index.js';
import {
  SAFE_ROW_WRITE_BUDGET,
  EMERGENCY_ROW_WRITE_BUDGET,
  encodeSnapshot,
  decodeSnapshot,
  estimateSnapshotRowWrites,
  createWriteBudget,
  reserveWriteBudget,
  nextSnapshotSlot,
  nextUtcDayStart,
} from './persistence.js';
import {
  ensureNeuronBudget,
  estimateReservation,
  neuronCapacity,
  reconcileNeurons,
  resolveNeuronConfig,
  reserveNeurons,
} from './neuron-governor.js';

const MODEL='@cf/zai-org/glm-4.7-flash';
const ALARM_MS=60_000;
const PERSIST_INTERVAL_WORLD_MINUTES=60;
const MAX_COMPLETION_TOKENS=200;
const AI_SYSTEM_PROMPT=`You are the private strategic cognition of one CYMONIA citizen. Use ONLY opaque concept IDs, citizen IDs, evidence, memories and entities present in the supplied context. Never invent Earth knowledge or concrete actions. Return strict compact JSON only: {"focus":"known concept id or null","intent":"explore|understand|share|cooperate|care|construct|adapt","actionBias":["supported action type"],"partnerIds":["known citizen id"],"successSignals":["known concept id"],"horizonMinutes":4320,"confidence":0.7}. The strategy should guide several world-days of local autonomous behavior. Prefer novelty or reinterpretation; use adapt when evidence is insufficient.`;
const AI_RETRY_COOLDOWN_MS=60_000;
const AI_CALL_TIMEOUT_MS=3_000;
const CHECKPOINT_WORLD_MINUTES=60;
const SNAPSHOT_CHUNK_CODE_UNITS=256*1024;
const MAX_CATCHUP_WORLD_MINUTES=360;
const HOT_LEDGER_EVENTS=4096;
const HEARTBEAT_STATUS_KEY='heartbeat-status-v1';

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
  ensureNeuronBudget(world);
  world.runtime.lastSealWorldMinute??=-CHECKPOINT_WORLD_MINUTES;
  return world.runtime;
}
function tickDiagnostics(runtime){
  return {
    lastTickRealMs:runtime.lastTickRealMs??null,
    lastTickWorldMinute:runtime.lastTickWorldMinute??null,
    lastTickError:runtime.lastTickError??null,
    lastAlarmRetryCount:runtime.lastAlarmRetryCount??null,
  };
}
async function sha256Hex(text){
  const bytes=new TextEncoder().encode(text);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function askAI(env,context){
  if(!env.AI?.run)throw new Error('ai_unavailable');
  const out=await env.AI.run(env.BRAIN_MODEL||MODEL,{messages:[{role:'system',content:AI_SYSTEM_PROMPT},{role:'user',content:JSON.stringify(context)}],max_completion_tokens:MAX_COMPLETION_TOKENS,temperature:.45});
  const text=out?.response??out?.result?.response??out?.result??out;
  const usage=out?.usage??out?.result?.usage??out?.result?.response?.usage??null;
  return {strategy:sanitizeAIStrategy(parseJsonText(text)),usage};
}
function serializeAIPrompt(context){return JSON.stringify([{role:'system',content:AI_SYSTEM_PROMPT},{role:'user',content:JSON.stringify(context)}]);}
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
  const lag=Math.max(0,target-world.clock.worldMinute);
  if(lag>maxCatchup){
    skippedWorldMinutes=lag-1;
    world.clock.realEpochMs=nowMs-(world.clock.worldMinute+1)*REAL_MS_PER_WORLD_MINUTE;
    appendEvent(world,'RUNTIME_LAG_REBASED','world',{skippedWorldMinutes,reason:'runtime_outage'},[],world.clock.worldMinute);
    target=world.clock.worldMinute+1;recovered=true;
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
    this.persistChain=Promise.resolve();
    this.lastPersistedGeneration=null;
    this.lastPersistedWorldMinute=null;
    this.persistenceDeferred=0;
    this.persistenceDeferredUntilRealMs=0;
    if(typeof WebSocketRequestResponsePair==='function'&&this.ctx.setWebSocketAutoResponse){
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
    }
    // A constructor also runs before an alarm wakeup; repair alarms from fetch.
    ctx.blockConcurrencyWhile(async()=>{
      this.initializeSQLite();
      this.world=await this.loadWorld();
      if(!this.world){
        this.world=createSovereignGenesis({realEpochMs:Date.now()});
        ensureRuntime(this.world);
        await this.persist({forceSeal:true});
      }else{
        ensureRuntime(this.world);
        if(!this.lastPersistedGeneration)await this.persist({forceSeal:true});
      }
      this.lastPersistedWorldMinute=this.world.clock.worldMinute;
      try{
        const status=await ctx.storage.get(HEARTBEAT_STATUS_KEY);
        if(status&&typeof status==='object')Object.assign(ensureRuntime(this.world),tickDiagnostics(status));
      }catch(error){
        console.error('CYMONIA_HEARTBEAT_STATUS_LOAD_FAILED',String(error?.message||error).slice(0,300));
      }
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
    this.sql.exec(`CREATE TABLE IF NOT EXISTS world_state_manifest(
      id INTEGER PRIMARY KEY CHECK(id=1),
      generation TEXT NOT NULL,
      chunk_count INTEGER NOT NULL,
      world_minute INTEGER NOT NULL,
      ledger_head TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS world_state_chunks_v2(
      id INTEGER PRIMARY KEY,
      state_part TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS persistence_budget(
      id INTEGER PRIMARY KEY CHECK(id=1),
      day TEXT NOT NULL,
      rows_written INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }
  async loadWorld(){
    const manifests=[...this.sql.exec('SELECT generation,chunk_count FROM world_state_manifest WHERE id=1 LIMIT 1')];
    let world;
    if(manifests.length){
      const manifest=manifests[0];
      const slotted=manifest.generation==='slot-a'||manifest.generation==='slot-b';
      const slotBase=manifest.generation==='slot-b'?1_000_000:0;
      const parts=slotted
        ?[...this.sql.exec('SELECT state_part FROM world_state_chunks_v2 WHERE id>=? AND id<? ORDER BY id',slotBase,slotBase+manifest.chunk_count)].map(row=>row.state_part)
        :[...this.sql.exec('SELECT state_part FROM world_state_chunks WHERE generation=? AND seq<? ORDER BY seq',manifest.generation,manifest.chunk_count)].map(row=>row.state_part);
      if(parts.length!==manifest.chunk_count)throw new Error('sovereign_world_chunks_incomplete');
      world=JSON.parse(await decodeSnapshot(joinSnapshot(parts)));
      this.lastPersistedGeneration=manifest.generation;
    }else{
      const rows=[...this.sql.exec('SELECT state_json FROM world_state WHERE id=1 LIMIT 1')];
      if(!rows.length)return null;
      const stored=JSON.parse(rows[0].state_json);
      world=stored;
      if(stored?.format==='chunked-v1'){
        const parts=[...this.sql.exec('SELECT state_part FROM world_state_chunks WHERE generation=? ORDER BY seq',stored.generation)].map(row=>row.state_part);
        if(parts.length!==stored.chunkCount)throw new Error('sovereign_world_chunks_incomplete');
        world=JSON.parse(joinSnapshot(parts));
        this.lastPersistedGeneration=stored.generation;
      }
    }
    if(!world||world.version!==2||!Array.isArray(world.citizens)||!Array.isArray(world.ledger))throw new Error('sovereign_world_state_invalid');
    return world;
  }
  async ensureAlarm(){
    let current=await this.ctx.storage.getAlarm();
    const now=Date.now();
    // A recently due alarm may be waking this object. Only replace one that
    // has remained overdue beyond normal scheduling jitter.
    if(current===null||current<now-2*ALARM_MS){
      current=now+ALARM_MS;
      await this.ctx.storage.setAlarm(current);
    }
    ensureRuntime(this.world).nextAlarmRealMs=current;
    return current;
  }
  persist(options={}){
    const pending=this.persistChain.then(()=>this.persistSnapshot(options));
    this.persistChain=pending.catch(()=>{});
    return pending;
  }
  readPersistenceBudget(day=utcDay(),limit=SAFE_ROW_WRITE_BUDGET){
    const rows=[...this.sql.exec('SELECT day,rows_written FROM persistence_budget WHERE id=1 LIMIT 1')];
    const used=rows.length&&rows[0].day===day?Number(rows[0].rows_written||0):0;
    return createWriteBudget(day,used,limit);
  }
  async persistSnapshot({forceSeal=false}={}){
    const runtime=ensureRuntime(this.world);
    const now=Date.now(),day=utcDay(now);
    if(!forceSeal&&now<this.persistenceDeferredUntilRealMs){
      return {persisted:false,reason:'write_budget_backoff'};
    }
    const limit=forceSeal?EMERGENCY_ROW_WRITE_BUDGET:SAFE_ROW_WRITE_BUDGET;
    const currentBudget=this.readPersistenceBudget(day,limit);
    if(!forceSeal&&currentBudget.rowsWritten>=currentBudget.limit){
      this.persistenceDeferred++;
      this.persistenceDeferredUntilRealMs=nextUtcDayStart(now);
      return {persisted:false,reason:'write_budget_exhausted'};
    }
    compactLedger(this.world,HOT_LEDGER_EVENTS);
    const due=forceSeal||this.world.clock.worldMinute-runtime.lastSealWorldMinute>=CHECKPOINT_WORLD_MINUTES;
    const serialized=JSON.stringify(this.world);
    const encoded=await encodeSnapshot(serialized);
    const generation=nextSnapshotSlot(this.lastPersistedGeneration);
    const parts=splitSnapshot(encoded);
    const slotBase=generation==='slot-b'?1_000_000:0;
    const worldMinute=this.world.clock.worldMinute,ledgerHead=this.world.ledgerHead;
    const sealCount=due?Number([...this.sql.exec('SELECT COUNT(*) AS count FROM world_seals')][0]?.count||0):0;
    const sealPruneRows=due&&sealCount>=4096?1:0;
    const rowWrites=estimateSnapshotRowWrites({chunkCount:parts.length,sealDue:due,sealPruneRows});
    const reservation=reserveWriteBudget(currentBudget,rowWrites);
    if(!reservation.allowed){
      this.persistenceDeferred++;
      if(!forceSeal)this.persistenceDeferredUntilRealMs=nextUtcDayStart(now);
      return {persisted:false,reason:'write_budget_exhausted',rowWrites};
    }
    const stateSha256=due?await sha256Hex(serialized):null;
    this.ctx.storage.transactionSync(()=>{
      for(let seq=0;seq<parts.length;seq++)this.sql.exec(
        'INSERT INTO world_state_chunks_v2(id,state_part) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state_part=excluded.state_part',
        slotBase+seq,parts[seq]
      );
      this.sql.exec(`INSERT INTO world_state_manifest(id,generation,chunk_count,world_minute,ledger_head,updated_at)
        VALUES(1,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,chunk_count=excluded.chunk_count,world_minute=excluded.world_minute,ledger_head=excluded.ledger_head,updated_at=excluded.updated_at`,
        generation,parts.length,worldMinute,ledgerHead,now);
      if(due){
        this.sql.exec('INSERT INTO world_seals(world_minute,ledger_head,state_sha256,created_at) VALUES(?,?,?,?)',worldMinute,ledgerHead,stateSha256,now);
        if(sealPruneRows)this.sql.exec('DELETE FROM world_seals WHERE seq=(SELECT MIN(seq) FROM world_seals)');
      }
      this.sql.exec(`INSERT INTO persistence_budget(id,day,rows_written,updated_at) VALUES(1,?,?,?)
        ON CONFLICT(id) DO UPDATE SET day=excluded.day,rows_written=excluded.rows_written,updated_at=excluded.updated_at`,
        day,reservation.budget.rowsWritten,now);
    });
    if(due)runtime.lastSealWorldMinute=worldMinute;
    this.lastPersistedGeneration=generation;
    this.lastPersistedWorldMinute=worldMinute;
    this.persistenceDeferredUntilRealMs=0;
    return {persisted:true,generation,rowWrites,rowsWritten:reservation.budget.rowsWritten};
  }
  async tick(){
    const progress=advanceWorldBounded(this.world,Date.now());

    const lastPersisted=Number(
      this.lastPersistedWorldMinute ?? this.world.clock.worldMinute
    );

    const checkpointDue=
      this.world.clock.worldMinute-lastPersisted >=
      PERSIST_INTERVAL_WORLD_MINUTES;

    if(progress.recovered){
      // Recovery rebases realEpochMs so downtime is not counted as lived
      // world time. Persist that boundary immediately; otherwise Durable
      // Object hibernation can discard it and reload the pre-recovery state.
      await this.persist({forceSeal:true});
    }else if(checkpointDue){
      await this.persist();
    }

    this.broadcast({
      type:'world_delta',
      state:publicWorld(this.world,Date.now())
    });

    if(!progress.recovered&&await this.processCognition(1)){
      await this.persist();
    }
  }
  async alarm(alarmInfo){
    const startedAt=Date.now();
    const nextAlarm=startedAt+ALARM_MS;
    // Commit the successor before tick can throw or exhaust its CPU budget.
    await this.ctx.storage.setAlarm(nextAlarm);
    const runtime=ensureRuntime(this.world);
    runtime.nextAlarmRealMs=nextAlarm;

    try{
      await this.tick();

      runtime.lastTickRealMs=Date.now();
      runtime.lastTickWorldMinute=this.world.clock.worldMinute;
      runtime.lastTickError=null;
      runtime.lastAlarmRetryCount=Number(alarmInfo?.retryCount||0);
    }catch(error){
      runtime.lastTickRealMs=Date.now();
      runtime.lastTickWorldMinute=this.world?.clock?.worldMinute??null;
      runtime.lastTickError=String(error?.stack||error?.message||error).slice(0,1000);
      runtime.lastAlarmRetryCount=Number(alarmInfo?.retryCount||0);

      console.error('CYMONIA_TICK_FAILED',JSON.stringify({
        worldMinute:this.world?.clock?.worldMinute??null,
        retryCount:Number(alarmInfo?.retryCount||0),
        isRetry:Boolean(alarmInfo?.isRetry),
        elapsedMs:Date.now()-startedAt,
        error:String(error?.message||error).slice(0,300)
      }));

      // Do not rethrow here.
      // A single malformed Citizen or transient runtime error must never
      // permanently stop the Sovereign World heartbeat.
    }
    try{
      // A world snapshot may have been written before the tick outcome was known.
      await this.ctx.storage.put(HEARTBEAT_STATUS_KEY,tickDiagnostics(runtime));
    }catch(error){
      console.error('CYMONIA_HEARTBEAT_STATUS_SAVE_FAILED',String(error?.message||error).slice(0,300));
    }
  }
  async processCognition(limit){
    if(!this.env.AI?.run)return false;
    const budget=ensureNeuronBudget(this.world),model=this.env.BRAIN_MODEL||MODEL,config=resolveNeuronConfig(this.env,model);
    if(Date.now()-Number(budget.lastFailureRealMs||0)<AI_RETRY_COOLDOWN_MS)return false;
    const phases=[];
    if(neuronCapacity(budget,'normal',config.limits)>0)phases.push('standard');
    if(neuronCapacity(budget,'priority',config.limits)>0)phases.push('priority');
    if(neuronCapacity(budget,'emergency',config.limits)>0)phases.push('emergency');
    const rejected=[];
    let used=0,exhaustedReason=phases.length?null:'neuron_hard_budget_exhausted';
    for(const phase of phases){
      if(used>=limit)break;
      const item=takeCognitionCandidate(this.world,this.world.clock.worldMinute,phase);
      if(!item)continue;
      const c=this.world.citizens.find(x=>x.id===item.citizenId&&x.alive);
      if(!c)continue;
      const context=buildCognitiveContext(this.world,c,this.world.clock.worldMinute);
      const reserveClass=item.reserve==='emergency'?'emergency':item.reserve==='priority'?'priority':'normal';
      const estimate=estimateReservation(model,serializeAIPrompt(context),MAX_COMPLETION_TOKENS,config.rates);
      const admission=reserveNeurons(budget,estimate,reserveClass,config.limits);
      if(!admission.ok){
        exhaustedReason=admission.reason;
        rejected.push({item,c});
        continue;
      }
      let accounting=null;
      try{
        const {strategy,usage}=await withTimeout(askAI(this.env,context),AI_CALL_TIMEOUT_MS,'ai_timeout');
        accounting=reconcileNeurons(budget,admission.reservation,usage,model,config.rates);
        acceptAIStrategy(this.world,c.id,strategy,this.world.clock.worldMinute);
        appendEvent(this.world,'AI_COGNITION',c.id,{model,reason:item.reason,status:'accepted',knowledgeContextCount:c.knowledge.filter(k=>k.active!==false).length,chargedNeurons:accounting.charged,accountingWarning:accounting.warning||null},[],this.world.clock.worldMinute);
        budget.lastFailureRealMs=0;
      }catch(error){
        if(!admission.reservation.reconciled)accounting=reconcileNeurons(budget,admission.reservation,null,model,config.rates);
        budget.lastFailureRealMs=Date.now();
        appendEvent(this.world,'COGNITION_DEFERRED',c.id,{reason:item.reason,error:String(error?.message||error).slice(0,160),chargedNeurons:accounting?.charged??null},[],this.world.clock.worldMinute);
        queueCognition(this.world,c,item.reason,Math.max(.2,item.basePriority-.02),this.world.clock.worldMinute,item.eventIds?.at(-1),{retryAfterWorldMinute:this.world.clock.worldMinute+60});
      }
      used++;
    }
    for(const {item,c} of rejected)queueCognition(this.world,c,item.reason,item.basePriority,this.world.clock.worldMinute,item.eventIds?.at(-1));
    if(used===0&&exhaustedReason&&budget.lastExhaustedDay!==budget.day){
      budget.lastExhaustedDay=budget.day;
      appendEvent(this.world,'COGNITION_DEFERRED','world',{reason:'neuron_budget_exhausted',admissionReason:exhaustedReason,usedNeurons:budget.usedNeurons,reservedNeurons:budget.reservedNeurons},[],this.world.clock.worldMinute);
    }
    return used>0;
  }
  websocketMeta(ws){
    try{return ws.deserializeAttachment?.()||null;}catch{return null;}
  }
  broadcast(message){
    const text=JSON.stringify(message);
    for(const ws of this.ctx.getWebSockets()){
      try{ws.send(text);}
      catch(error){
        console.warn('CYMONIA_WS_SEND_FAILED',JSON.stringify({
          session:this.websocketMeta(ws)?.id||null,
          error:String(error?.message||error).slice(0,160)
        }));
      }
    }
  }
  webSocket(){
    const pair=new WebSocketPair(),client=pair[0],server=pair[1];
    const session={id:crypto.randomUUID(),connectedAt:Date.now()};
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment?.(session);
    server.send(JSON.stringify({type:'world_snapshot',state:publicWorld(this.world,Date.now())}));
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws,message){
    if(message==='ping')ws.send('pong');
  }
  webSocketClose(ws,code,reason,wasClean){
    const meta=this.websocketMeta(ws);
    console.log('CYMONIA_WS_CLOSE',JSON.stringify({
      session:meta?.id||null,
      code:Number(code)||0,
      reason:String(reason||'').slice(0,160),
      wasClean:Boolean(wasClean),
      connectedMs:meta?.connectedAt?Math.max(0,Date.now()-meta.connectedAt):null,
      remaining:this.ctx.getWebSockets().length
    }));
  }
  webSocketError(ws,error){
    const meta=this.websocketMeta(ws);
    console.error('CYMONIA_WS_ERROR',JSON.stringify({
      session:meta?.id||null,
      error:String(error?.message||error).slice(0,160),
      remaining:this.ctx.getWebSockets().length
    }));
  }
  async fetch(request){
    const url=new URL(request.url),path=url.pathname.replace(/^\/world/,'')||'/';
    const scheduledAlarmRealMs=await this.ensureAlarm();
    if(request.headers.get('upgrade')==='websocket'&&path==='/stream')return this.webSocket();
    if(request.method==='GET'&&path==='/health'){
      const runtime=ensureRuntime(this.world),budget=ensureNeuronBudget(this.world),persistenceBudget=this.readPersistenceBudget(),model=this.env.BRAIN_MODEL||MODEL,config=resolveNeuronConfig(this.env,model);
      return json({
        ok:true,
        service:'cymonia-sovereign-world',
        version:2,
        model,
        ai:Boolean(this.env.AI?.run),
        ai_budget:{
          day:budget.day,
          used_neurons:budget.usedNeurons,
          reserved_neurons:budget.reservedNeurons,
          prompt_tokens:budget.promptTokens,
          completion_tokens:budget.completionTokens,
          calls:budget.calls,
          soft_limit:config.limits.normal,
          high_priority_limit:config.limits.priority,
          hard_limit:config.limits.emergency,
          available:{normal:neuronCapacity(budget,'normal',config.limits),priority:neuronCapacity(budget,'priority',config.limits),emergency:neuronCapacity(budget,'emergency',config.limits)},
          model_rate_id:config.rates?.rateId||null,
          last_accounting_warning:budget.lastAccountingWarning,
        },
        persistence_budget:{
          day:persistenceBudget.day,
          rows_written:persistenceBudget.rowsWritten,
          soft_limit:SAFE_ROW_WRITE_BUDGET,
          emergency_limit:EMERGENCY_ROW_WRITE_BUDGET,
          deferred:this.persistenceDeferred,
          backoff_until_real_ms:this.persistenceDeferredUntilRealMs||null
        },
        websocket:{mode:'hibernation',clients:this.ctx.getWebSockets().length},
        alarm_interval_ms:ALARM_MS,
        heartbeat:{
          scheduledAlarmRealMs,
          nextAlarmRealMs:runtime.nextAlarmRealMs??null,
          ...tickDiagnostics(runtime),
        },
        world_id:this.world.worldId,
        world_minute:this.world.clock.worldMinute,
        lag_world_minutes:Math.max(0,worldMinuteAt(this.world,Date.now())-this.world.clock.worldMinute),
        ledger_head:this.world.ledgerHead,
        persisted_generation:this.lastPersistedGeneration,
        persistence:'durable-object-sqlite-gzip-slotted'
      });
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
      const externalId=`github:${body.actor.github_id||body.actor.id}`;
      const existing=this.world.citizens.find(c=>c.externalId===externalId);
      const c=existing||createHumanAvatar(this.world,{externalId,displayName:body.actor.display_name||body.actor.github_login||null},this.world.clock.worldMinute);
      if(!existing){
        await this.persist({forceSeal:true});
        this.broadcast({type:'world_delta',state:publicWorld(this.world,Date.now())});
      }
      return json({ok:true,citizenId:c.id,created:!existing});
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
