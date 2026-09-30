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
  compactOperationalState,
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
  selectNewestSnapshot,
  assertMonotonicSnapshot,
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
const AI_SYSTEM_PROMPT=`You are the private strategic cognition of one CYMONIA citizen. Use ONLY opaque concept IDs, citizen IDs, evidence, memories and entities present in the supplied context. Never invent Earth knowledge. Return strict compact JSON only: {"focus":"known concept id or null","intent":"explore|understand|share|cooperate|care|construct|adapt","actionBias":["supported action type"],"partnerIds":["known citizen id"],"successSignals":["known concept id"],"horizonMinutes":4320,"confidence":0.7,"programBlueprints":[{"name":"short name","trigger":{"kind":"always|resource_known|high_sleep|low_hydration|low_calories|rain|damaged_structure|grievance|loose_object|near_citizen","threshold":0.5},"cooldownMinutes":120,"steps":[{"type":"OBSERVE|REST|GATHER|CARE|COMMUNICATE|TRANSFER|EXPERIMENT|PICKUP|DROP|REPAIR|DISMANTLE|DESTROY","selector":"self|nearest_known_resource|nearest_known_structure|nearest_damaged_structure|nearest_known_citizen|grievance_actor|loose_known_object|held_object"}]}]}. programBlueprints is optional and should be used only when a reusable behavior genuinely follows from this Citizen evidence. Programs never bypass the sovereign kernel. The strategy should guide several world-days of local autonomous behavior; use adapt when evidence is insufficient.`;
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
    this.committedWorld=null;
    this.mutationChain=Promise.resolve();
    this.persistSequence=0;
    this.persistChain=Promise.resolve();
    this.lastPersistedGeneration=null;
    this.lastPersistedWorldMinute=null;
    this.persistenceDeferred=0;
    this.persistenceDeferredUntilRealMs=0;
    this.loadedSnapshotMinute=null;
    this.clockHighWaterMark=null;
    this.clockRegressionDetected=false;
    this.snapshotRecoverySource=null;
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
        this.establishClockGuardBaseline();
        if(!this.lastPersistedGeneration)await this.persist({forceSeal:true});
      }
      this.lastPersistedWorldMinute=this.world.clock.worldMinute;
      this.committedWorld=structuredClone(this.world);
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
    this.sql.exec(`CREATE TABLE IF NOT EXISTS world_snapshot_slots(
      generation TEXT PRIMARY KEY,
      chunk_count INTEGER NOT NULL,
      world_minute INTEGER NOT NULL,
      ledger_head TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS world_clock_guard(
      id INTEGER PRIMARY KEY CHECK(id=1),
      world_id TEXT NOT NULL,
      highest_world_minute INTEGER NOT NULL,
      ledger_head TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }
  sqlRows(query,...args){
    if(typeof this.sql?.exec!=='function')return [];
    try{
      const rows=this.sql.exec(query,...args);
      return rows&&typeof rows[Symbol.iterator]==='function'?[...rows]:[];
    }catch(error){
      // Some unit tests intentionally instantiate SovereignWorld without
      // a complete Durable Object SQLite implementation. Production
      // instances always have ctx + real storage.sql, so production SQL
      // errors remain fatal and can never silently bypass the clock guard.
      if(!this.ctx)return [];
      throw error;
    }
  }

  async loadWorld(){
    const guard=this.sqlRows('SELECT world_id,highest_world_minute FROM world_clock_guard WHERE id=1 LIMIT 1')[0]||null;
    this.clockHighWaterMark=guard?Number(guard.highest_world_minute):null;
    const manifest=this.sqlRows('SELECT generation,chunk_count,world_minute,ledger_head,updated_at FROM world_state_manifest WHERE id=1 LIMIT 1')[0]||null;
    const slotRows=this.sqlRows('SELECT generation,chunk_count,world_minute,ledger_head,updated_at FROM world_snapshot_slots');
    const seal=this.sqlRows('SELECT MAX(world_minute) AS world_minute FROM world_seals')[0];
    // Pre-guard databases still contain durable evidence of their age. Never
    // turn damaged/missing snapshot data into a new Genesis or an older year.
    const highWaterMark=Math.max(0,...[guard?.highest_world_minute,manifest?.world_minute,seal?.world_minute,...slotRows.map(r=>r.world_minute)]
      .filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))).map(Number));
    const metadata=new Map();
    for(const row of slotRows)if(row.generation==='slot-a'||row.generation==='slot-b')metadata.set(row.generation,{...row,source:`slot:${row.generation}`});
    if(manifest)metadata.set(manifest.generation,{...manifest,source:`manifest:${manifest.generation}`});
    const candidates=[];
    for(const meta of metadata.values()){
      try{
        const slotted=meta.generation==='slot-a'||meta.generation==='slot-b';
        const base=meta.generation==='slot-b'?1_000_000:0;
        const count=Number(meta.chunk_count);
        const parts=slotted
          ?[...this.sql.exec('SELECT state_part FROM world_state_chunks_v2 WHERE id>=? AND id<? ORDER BY id',base,base+count)].map(r=>r.state_part)
          :[...this.sql.exec('SELECT state_part FROM world_state_chunks WHERE generation=? AND seq<? ORDER BY seq',meta.generation,count)].map(r=>r.state_part);
        if(parts.length!==count)continue;
        const world=JSON.parse(await decodeSnapshot(joinSnapshot(parts)));
        assertMonotonicSnapshot(world,{worldId:guard?.world_id||null});
        if(meta.world_minute!==undefined&&Number(meta.world_minute)!==world.clock.worldMinute)throw new Error('sovereign_snapshot_metadata_mismatch');
        if(meta.ledger_head!==undefined&&meta.ledger_head!==world.ledgerHead)throw new Error('sovereign_snapshot_metadata_mismatch');
        candidates.push({world,generation:meta.generation,updatedAt:Number(meta.updated_at||0),source:meta.source});
      }catch(error){console.error('CYMONIA_SNAPSHOT_CANDIDATE_REJECTED',String(error?.message||error).slice(0,240));}
    }
    const legacy=this.sqlRows('SELECT state_json,updated_at FROM world_state WHERE id=1 LIMIT 1')[0]||null;
    if(legacy){
      try{
        const stored=JSON.parse(legacy.state_json);let world=stored,generation='legacy-inline';
        if(stored?.format==='chunked-v1'){
          const parts=[...this.sql.exec('SELECT state_part FROM world_state_chunks WHERE generation=? ORDER BY seq',stored.generation)].map(r=>r.state_part);
          if(parts.length===stored.chunkCount){world=JSON.parse(joinSnapshot(parts));generation=stored.generation;}else world=null;
        }
        if(world){assertMonotonicSnapshot(world,{worldId:guard?.world_id||null});candidates.push({world,generation,updatedAt:Number(legacy.updated_at||0),source:'legacy-world-state'});}
      }catch(error){console.error('CYMONIA_LEGACY_SNAPSHOT_REJECTED',String(error?.message||error).slice(0,240));}
    }
    const selected=selectNewestSnapshot(candidates);
    if(!selected){
      const chunks=this.sqlRows('SELECT id FROM world_state_chunks_v2 LIMIT 1').length||this.sqlRows('SELECT seq FROM world_state_chunks LIMIT 1').length;
      if(guard||manifest||slotRows.length||legacy||seal?.world_minute!=null||chunks)throw new Error('sovereign_world_snapshot_unavailable_below_clock_guard');
      return null;
    }
    const minute=Number(selected.world.clock.worldMinute);
    if(minute<highWaterMark){this.clockRegressionDetected=true;throw new Error(`sovereign_world_clock_regression:${minute}<${highWaterMark}`);}
    assertMonotonicSnapshot(selected.world,{highWaterMark,worldId:guard?.world_id||null});
    this.loadedSnapshotMinute=minute;this.snapshotRecoverySource=selected.source;
    if(selected.generation==='slot-a'||selected.generation==='slot-b')this.lastPersistedGeneration=selected.generation;
    compactOperationalState(selected.world);return selected.world;
  }
  establishClockGuardBaseline(){
    if(!this.world)return;
    if(typeof this.sql?.exec!=='function')return;
    const now=Date.now(),minute=Number(this.world.clock.worldMinute),worldId=String(this.world.worldId),ledgerHead=String(this.world.ledgerHead||'');
    const row=this.sqlRows('SELECT world_id,highest_world_minute FROM world_clock_guard WHERE id=1 LIMIT 1')[0]||null;
    if(row){
      if(row.world_id!==worldId)throw new Error('sovereign_world_identity_regression');
      if(minute<Number(row.highest_world_minute)){this.clockRegressionDetected=true;throw new Error(`sovereign_world_clock_regression:${minute}<${Number(row.highest_world_minute)}`);}
      this.clockHighWaterMark=Number(row.highest_world_minute);
    }else{
      this.sql.exec('INSERT INTO world_clock_guard(id,world_id,highest_world_minute,ledger_head,updated_at) VALUES(1,?,?,?,?)',worldId,minute,ledgerHead,now);
      this.clockHighWaterMark=minute;
    }
    const manifest=this.sqlRows('SELECT generation,chunk_count,world_minute,ledger_head,updated_at FROM world_state_manifest WHERE id=1 LIMIT 1')[0]||null;
    if(manifest&&(manifest.generation==='slot-a'||manifest.generation==='slot-b')){
      const existing=this.sqlRows('SELECT generation FROM world_snapshot_slots WHERE generation=? LIMIT 1',manifest.generation);
      if(!existing.length)this.sql.exec('INSERT INTO world_snapshot_slots(generation,chunk_count,world_minute,ledger_head,updated_at) VALUES(?,?,?,?,?)',manifest.generation,Number(manifest.chunk_count),Number(manifest.world_minute),String(manifest.ledger_head),Number(manifest.updated_at));
    }
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
    const pending=this.persistChain.then(async()=>{
      const result=await this.persistSnapshot(options);
      if(!result.persisted)throw new Error(`sovereign_persistence_deferred:${result.reason}`);
      return result;
    });
    this.persistChain=pending.catch(()=>{});
    return pending;
  }
  mutateWorld(callback){
    // Compression and Workers AI yield the event loop. Serialize ALL writers,
    // while readers continue to observe the last fully committed snapshot.
    const pending=(this.mutationChain||Promise.resolve()).then(async()=>{
      try{return await callback();}
      catch(error){
        if(this.committedWorld){
          const neuronBudget=this.world.runtime?.neuronBudget;
          this.world=structuredClone(this.committedWorld);
          // External inference already consumed this budget even if saving failed.
          if(neuronBudget)this.world.runtime.neuronBudget=neuronBudget;
        }
        throw error;
      }
    });
    this.mutationChain=pending.catch(()=>{});
    return pending;
  }
  readableWorld(){return this.committedWorld||this.world;}
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
    const clockGuard=[...this.sql.exec('SELECT world_id,highest_world_minute FROM world_clock_guard WHERE id=1 LIMIT 1')][0]||null;
    if(clockGuard){
      const minute=Number(this.world.clock.worldMinute);
      if(clockGuard.world_id!==this.world.worldId)throw new Error('sovereign_world_identity_regression');
      if(minute<Number(clockGuard.highest_world_minute)){this.clockRegressionDetected=true;throw new Error(`sovereign_world_clock_regression:${minute}<${Number(clockGuard.highest_world_minute)}`);}
    }
    compactOperationalState(this.world);
    compactLedger(this.world,HOT_LEDGER_EVENTS);
    const due=forceSeal||this.world.clock.worldMinute-runtime.lastSealWorldMinute>=CHECKPOINT_WORLD_MINUTES;
    const worldMinute=this.world.clock.worldMinute,ledgerHead=this.world.ledgerHead,worldId=this.world.worldId;
    const serialized=JSON.stringify(this.world);
    const encoded=await encodeSnapshot(serialized);
    const generation=nextSnapshotSlot(this.lastPersistedGeneration);
    const parts=splitSnapshot(encoded);
    const slotBase=generation==='slot-b'?1_000_000:0;
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
      this.sql.exec(`INSERT INTO world_snapshot_slots(generation,chunk_count,world_minute,ledger_head,updated_at)
        VALUES(?,?,?,?,?)
        ON CONFLICT(generation) DO UPDATE SET chunk_count=excluded.chunk_count,world_minute=excluded.world_minute,ledger_head=excluded.ledger_head,updated_at=excluded.updated_at`,
        generation,parts.length,worldMinute,ledgerHead,now);
      this.sql.exec(`INSERT INTO world_clock_guard(id,world_id,highest_world_minute,ledger_head,updated_at)
        VALUES(1,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          world_id=excluded.world_id,
          highest_world_minute=CASE WHEN excluded.highest_world_minute>world_clock_guard.highest_world_minute THEN excluded.highest_world_minute ELSE world_clock_guard.highest_world_minute END,
          ledger_head=CASE WHEN excluded.highest_world_minute>=world_clock_guard.highest_world_minute THEN excluded.ledger_head ELSE world_clock_guard.ledger_head END,
          updated_at=excluded.updated_at`,
        worldId,worldMinute,ledgerHead,now);
      if(due){
        this.sql.exec('INSERT INTO world_seals(world_minute,ledger_head,state_sha256,created_at) VALUES(?,?,?,?)',worldMinute,ledgerHead,stateSha256,now);
        if(sealPruneRows)this.sql.exec('DELETE FROM world_seals WHERE seq=(SELECT MIN(seq) FROM world_seals)');
      }
      this.sql.exec(`INSERT INTO persistence_budget(id,day,rows_written,updated_at) VALUES(1,?,?,?)
        ON CONFLICT(id) DO UPDATE SET day=excluded.day,rows_written=excluded.rows_written,updated_at=excluded.updated_at`,
        day,reservation.budget.rowsWritten,now);
    });
    if(due)runtime.lastSealWorldMinute=worldMinute;
    this.committedWorld=JSON.parse(serialized);
    if(due)this.committedWorld.runtime.lastSealWorldMinute=worldMinute;
    this.lastPersistedGeneration=generation;
    this.lastPersistedWorldMinute=worldMinute;
    this.clockHighWaterMark=Math.max(Number(this.clockHighWaterMark??worldMinute),worldMinute);
    this.loadedSnapshotMinute=Math.max(Number(this.loadedSnapshotMinute??worldMinute),worldMinute);
    this.snapshotRecoverySource=`persist:${generation}`;
    this.persistenceDeferredUntilRealMs=0;
    return {persisted:true,generation,rowWrites,rowsWritten:reservation.budget.rowsWritten};
  }
  async tick(){
    return this.mutateWorld(async()=>{
      if(Date.now()<this.persistenceDeferredUntilRealMs)return;
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

      const cognitionChanged=!progress.recovered&&await this.processCognition(1);

      if(cognitionChanged){
        await this.persist();
      }

      // Publish the final state of this heartbeat, including a strategy
      // accepted by cognition during the same tick.
      this.broadcast({
        type:'world_delta',
        state:publicWorld(this.readableWorld(),Date.now())
      });
    });
  }
  async alarm(alarmInfo){
    const startedAt=Date.now();
    const nextAlarm=startedAt+ALARM_MS;
    // Commit the successor before tick can throw or exhaust its CPU budget.
    await this.ctx.storage.setAlarm(nextAlarm);
    let runtime=ensureRuntime(this.world);
    runtime.nextAlarmRealMs=nextAlarm;

    try{
      await this.tick();
      runtime=ensureRuntime(this.world);
      runtime.lastTickRealMs=Date.now();
      runtime.lastTickWorldMinute=this.world.clock.worldMinute;
      runtime.lastTickError=null;
      runtime.lastAlarmRetryCount=Number(alarmInfo?.retryCount||0);
    }catch(error){
      runtime=ensureRuntime(this.world);
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
    runtime.nextAlarmRealMs=nextAlarm;
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
    server.send(JSON.stringify({type:'world_snapshot',state:publicWorld(this.readableWorld(),Date.now())}));
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
    const world=this.readableWorld();
    if(request.headers.get('upgrade')==='websocket'&&path==='/stream')return this.webSocket();
    if(request.method==='GET'&&path==='/health'){
      const runtime=ensureRuntime(this.world),budget=ensureNeuronBudget(this.world),persistenceBudget=this.readPersistenceBudget(),model=this.env.BRAIN_MODEL||MODEL,config=resolveNeuronConfig(this.env,model);
      const living=world.citizens.filter(citizen=>citizen.alive);
      const activeActions=world.actions.filter(action=>action.status==='active');
      const movingCitizens=living.filter(citizen=>activeActions.some(action=>action.actorId===citizen.id&&action.type==='MOVE'));
      const outsideCenter20=living.filter(citizen=>Math.hypot(citizen.position.x-50,citizen.position.y-50)>20);
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
        operational_state:{
          actions:world.actions.length,
          active_actions:activeActions.length,
          moving_citizens:movingCitizens.length,
          living_citizens:living.length,
          outside_center_20:outsideCenter20.length,
          construction_projects:world.projects.filter(project=>project.status==='construction').length,
          plans:world.citizens.reduce((n,c)=>n+c.plans.length,0),
          experiments:world.experiments.length
        },
        world_id:world.worldId,
        world_minute:world.clock.worldMinute,
        lag_world_minutes:Math.max(0,worldMinuteAt(world,Date.now())-world.clock.worldMinute),
        clock_high_water_mark:this.clockHighWaterMark,
        loaded_snapshot_minute:this.loadedSnapshotMinute,
        clock_regression_detected:this.clockRegressionDetected,
        snapshot_recovery_source:this.snapshotRecoverySource,
        ledger_head:world.ledgerHead,
        persisted_generation:this.lastPersistedGeneration,
        persistence:'durable-object-sqlite-gzip-slotted'
      });
    }
    if(request.method==='GET'&&(path==='/'||path==='/state'))return json({ok:true,world:publicWorld(world,Date.now())});
    if(request.method==='GET'&&path==='/history')return json({ok:true,history:getHistory(world)});
    if(request.method==='GET'&&path.startsWith('/why/')){
      const id=decodeURIComponent(path.slice(5)),why=getWhy(world,id);
      return why?json({ok:true,why}):json({ok:false,error:'event_not_found'},404);
    }
    if(request.method==='POST'&&path==='/avatar'){
      const body=await request.json();
      if(!body?.actor?.id)return json({ok:false,error:'actor_required'},400);
      return this.mutateWorld(async()=>{
        const externalId=`github:${body.actor.github_id||body.actor.id}`;
        const existing=this.world.citizens.find(c=>c.externalId===externalId);
        const c=existing||createHumanAvatar(this.world,{externalId,displayName:body.actor.display_name||body.actor.github_login||null},this.world.clock.worldMinute);
        if(!existing){
          await this.persist({forceSeal:true});
          this.broadcast({type:'world_delta',state:publicWorld(this.readableWorld(),Date.now())});
        }
        return json({ok:true,citizenId:c.id,created:!existing});
      }).catch(()=>json({ok:false,error:'world_write_unavailable'},503));
    }
    if(request.method==='POST'&&path==='/intent'){
      const body=await request.json();
      if(!body?.citizenId||!String(body.intent||'').trim())return json({ok:false,error:'intent_required'},400);
      return this.mutateWorld(async()=>{
        const result=submitHumanIntent(this.world,body.citizenId,body.intent,this.world.clock.worldMinute);
        await this.persist({forceSeal:true});
        return json({ok:true,...result});
      }).catch(()=>json({ok:false,error:'world_write_unavailable'},503));
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
