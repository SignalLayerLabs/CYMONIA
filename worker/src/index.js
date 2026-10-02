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
  encodeWorldSnapshotParts,
  decodeWorldSnapshot,
  snapshotGzipSize,
  snapshotJsonStream,
  estimateSnapshotRowWrites,
  createWriteBudget,
  reserveWriteBudget,
  nextSnapshotSlot,
  nextUtcDayStart,
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
const ALARM_MS=15_000;
const STALE_ALARM_MS=5*60_000;
const ALARM_REARM_COOLDOWN_MS=2*60_000;
const PERSIST_INTERVAL_WORLD_MINUTES=60;
const MAX_COMPLETION_TOKENS=200;
const AI_SYSTEM_PROMPT=`You are the private strategic cognition of one CYMONIA citizen. Use ONLY opaque concept IDs, citizen IDs, evidence, memories and entities present in the supplied context. Never invent Earth knowledge. Return strict compact JSON only: {"focus":"known concept id or null","intent":"explore|understand|share|cooperate|care|construct|adapt","actionBias":["supported action type"],"partnerIds":["known citizen id"],"successSignals":["known concept id"],"horizonMinutes":4320,"confidence":0.7,"programBlueprints":[{"name":"short name","trigger":{"kind":"always|resource_known|high_sleep|low_hydration|low_calories|rain|damaged_structure|grievance|loose_object|near_citizen","threshold":0.5},"cooldownMinutes":120,"steps":[{"type":"OBSERVE|REST|GATHER|CARE|COMMUNICATE|TRANSFER|EXPERIMENT|PICKUP|DROP|REPAIR|DISMANTLE|DESTROY","selector":"self|nearest_known_resource|nearest_known_structure|nearest_damaged_structure|nearest_known_citizen|grievance_actor|loose_known_object|held_object"}]}]}. programBlueprints is optional and should be used only when a reusable behavior genuinely follows from this Citizen evidence. Programs never bypass the sovereign kernel. The strategy should guide several world-days of local autonomous behavior; use adapt when evidence is insufficient.`;
const AI_RETRY_COOLDOWN_MS=60_000;
const AI_CALL_TIMEOUT_MS=3_000;
const CHECKPOINT_WORLD_MINUTES=60;
const SNAPSHOT_CHUNK_CODE_UNITS=256*1024;
const ENCODED_SNAPSHOT_CHUNK_CODE_UNITS=1536*1024;
const MAX_CATCHUP_WORLD_MINUTES=30;
const HOT_LEDGER_EVENTS=4096;
const CAUSAL_LEDGER_EVENTS=512;
const CAUSAL_RECEIPTS=64;
const CAUSAL_OBJECTS=256;
const CAUSAL_PROCEDURES=256;
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
function committedStats(world,clock=world.clock,ledgerHead=world.ledgerHead){
  const living=(world.citizens||[]).filter(citizen=>citizen.alive);
  const activeActions=(world.actions||[]).filter(action=>action.status==='active');
  const movingIds=new Set(activeActions.filter(action=>action.type==='MOVE').map(action=>action.actorId));
  return {
    version:world.version,
    worldId:world.worldId,
    clock:{...clock},
    ledgerHead,
    operationalState:{
      actions:(world.actions||[]).length,
      activeActions:activeActions.length,
      movingCitizens:living.filter(citizen=>movingIds.has(citizen.id)).length,
      livingCitizens:living.length,
      outsideCenter20:living.filter(citizen=>Math.hypot(citizen.position.x-50,citizen.position.y-50)>20).length,
      constructionProjects:(world.projects||[]).filter(project=>project.status==='construction').length,
      plans:(world.citizens||[]).reduce((n,citizen)=>n+(citizen.plans||[]).length,0),
      experiments:(world.experiments||[]).length,
    }
  };
}
function committedCausalReader(world){
  return structuredClone({
    ledger:(world.ledger||[]).slice(-CAUSAL_LEDGER_EVENTS),
    physicalReceipts:(world.physicalReceipts||[]).slice(-CAUSAL_RECEIPTS),
    objects:(world.objects||[]).slice(-CAUSAL_OBJECTS).map(object=>({
      id:object.id,
      lastPhysicalEventId:object.lastPhysicalEventId||null,
      provenance:object.provenance||null,
    })),
    procedures:(world.procedures||[]).slice(-CAUSAL_PROCEDURES).map(procedure=>({
      id:procedure.id,
      evidenceEventId:procedure.evidenceEventId||null,
    })),
  });
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
    // Intentionally never materialized: a second full world graph caused
    // production isolate OOM as the civilization accumulated knowledge.
    this.committedWorld=null;
    // Rollback reloads the durable committed generation from SQLite on demand.
    this.committedSnapshot=null;
    this.committedPublicSnapshot=null;
    this.committedPublicWorldMinute=null;
    this.committedStats=null;
    this.committedHistory={entries:[]};
    this.committedCausalWorld={ledger:[],physicalReceipts:[],objects:[],procedures:[]};
    this.pendingRecoveryNeuronBudget=null;
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
      const wakeStartedAt=Date.now();
      console.log('CYMONIA_WAKE_BEGIN');
      this.initializeSQLite();
      this.world=await this.loadWorld();
      console.log('CYMONIA_WAKE_DECODED',JSON.stringify({elapsedMs:Date.now()-wakeStartedAt,worldMinute:this.world?.clock?.worldMinute??null}));
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
      // Wake only the canonical graph and bounded diagnostics. Building the
      // Observer projection here doubles the hottest allocation immediately
      // after snapshot decode and can reset a large Durable Object.
      this.committedStats=committedStats(this.world);
      this.committedCausalWorld=committedCausalReader(this.world);
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
    const legacyMeta=this.sqlRows('SELECT world_minute,ledger_head,updated_at FROM world_state WHERE id=1 LIMIT 1')[0]||null;
    const seal=this.sqlRows('SELECT MAX(world_minute) AS world_minute FROM world_seals')[0];
    // Pre-guard databases still contain durable evidence of their age. Never
    // turn damaged/missing snapshot data into a new Genesis or an older year.
    const highWaterMark=Math.max(0,...[guard?.highest_world_minute,manifest?.world_minute,seal?.world_minute,...slotRows.map(r=>r.world_minute)]
      .filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))).map(Number));
    const metadata=new Map();
    for(const row of slotRows)if(row.generation==='slot-a'||row.generation==='slot-b')metadata.set(row.generation,{...row,source:`slot:${row.generation}`});
    if(manifest)metadata.set(manifest.generation,{...manifest,source:`manifest:${manifest.generation}`});
    // SQLite metadata supplies the ordering without decoding every generation.
    // Retaining both complete worlds during wakeup can exhaust the isolate.
    const ordered=[...metadata.values(),...(legacyMeta?[{...legacyMeta,source:'legacy-world-state',generation:'legacy-inline'}]:[])].sort((a,b)=>Number(b.world_minute)-Number(a.world_minute)
      ||Number(b.source.startsWith('manifest:'))-Number(a.source.startsWith('manifest:'))
      ||Number(b.updated_at||0)-Number(a.updated_at||0));
    let selected=null;
    for(const meta of ordered){
      if(Number(meta.world_minute)<highWaterMark)continue;
      try{
        if(meta.source==='legacy-world-state'){
          const legacy=this.sqlRows('SELECT state_json FROM world_state WHERE id=1 LIMIT 1')[0];
          const stored=JSON.parse(legacy.state_json);
          let world=stored,generation='legacy-inline';
          if(stored?.format==='chunked-v1'){
            const parts=[...this.sql.exec('SELECT state_part FROM world_state_chunks WHERE generation=? ORDER BY seq',stored.generation)].map(r=>r.state_part);
            if(parts.length!==stored.chunkCount)continue;
            world=JSON.parse(joinSnapshot(parts));generation=stored.generation;
          }
          assertMonotonicSnapshot(world,{highWaterMark,worldId:guard?.world_id||null});
          if(Number(meta.world_minute)!==world.clock.worldMinute||meta.ledger_head!==world.ledgerHead)throw new Error('sovereign_snapshot_metadata_mismatch');
          selected={world,generation,source:meta.source};
          break;
        }
        const slotted=meta.generation==='slot-a'||meta.generation==='slot-b';
        const base=meta.generation==='slot-b'?1_000_000:0;
        const count=Number(meta.chunk_count);
        const parts=slotted
          ?[...this.sql.exec('SELECT state_part FROM world_state_chunks_v2 WHERE id>=? AND id<? ORDER BY id',base,base+count)].map(r=>r.state_part)
          :[...this.sql.exec('SELECT state_part FROM world_state_chunks WHERE generation=? AND seq<? ORDER BY seq',meta.generation,count)].map(r=>r.state_part);
        if(parts.length!==count)continue;
        const encoded=joinSnapshot(parts);
        console.log('CYMONIA_SNAPSHOT_LOAD',JSON.stringify({generation:meta.generation,compressedCodeUnits:encoded.length,uncompressedBytes:snapshotGzipSize(encoded)}));
        const world=await decodeWorldSnapshot(encoded);
        assertMonotonicSnapshot(world,{worldId:guard?.world_id||null});
        if(meta.world_minute!==undefined&&Number(meta.world_minute)!==world.clock.worldMinute)throw new Error('sovereign_snapshot_metadata_mismatch');
        if(meta.ledger_head!==undefined&&meta.ledger_head!==world.ledgerHead)throw new Error('sovereign_snapshot_metadata_mismatch');
        assertMonotonicSnapshot(world,{highWaterMark,worldId:guard?.world_id||null});
        selected={world,generation:meta.generation,source:meta.source};
        this.committedSnapshot=null;
        break;
      }catch(error){console.error('CYMONIA_SNAPSHOT_CANDIDATE_REJECTED',String(error?.message||error).slice(0,240));}
    }
    if(!selected){
      const chunks=this.sqlRows('SELECT id FROM world_state_chunks_v2 LIMIT 1').length||this.sqlRows('SELECT seq FROM world_state_chunks LIMIT 1').length;
      if(guard||manifest||slotRows.length||legacyMeta||seal?.world_minute!=null||chunks)throw new Error('sovereign_world_snapshot_unavailable_below_clock_guard');
      return null;
    }
    const minute=Number(selected.world.clock.worldMinute);
    if(minute<highWaterMark){this.clockRegressionDetected=true;throw new Error(`sovereign_world_clock_regression:${minute}<${highWaterMark}`);}
    assertMonotonicSnapshot(selected.world,{highWaterMark,worldId:guard?.world_id||null});
    this.loadedSnapshotMinute=minute;this.snapshotRecoverySource=selected.source;
    if(selected.generation==='slot-a'||selected.generation==='slot-b')this.lastPersistedGeneration=selected.generation;
    const persistedSealMinute=Number(seal?.world_minute);
    if(Number.isFinite(persistedSealMinute)){
      const selectedRuntime=ensureRuntime(selected.world);
      selectedRuntime.lastSealWorldMinute=Math.max(Number(selectedRuntime.lastSealWorldMinute||0),persistedSealMinute);
    }
    compactOperationalState(selected.world);return selected.world;
  }
  async loadCommittedWorldFromStorage(){
    const meta=this.sqlRows('SELECT generation,chunk_count,world_minute,ledger_head FROM world_state_manifest WHERE id=1 LIMIT 1')[0]||null;
    if(!meta)throw new Error('sovereign_committed_manifest_unavailable');
    const generation=String(meta.generation);
    if(generation!=='slot-a'&&generation!=='slot-b'){
      const fallback=await this.loadWorld();
      if(!fallback)throw new Error('sovereign_committed_snapshot_unavailable');
      return fallback;
    }
    const count=Number(meta.chunk_count),base=generation==='slot-b'?1_000_000:0;
    const parts=[...this.sql.exec(
      'SELECT state_part FROM world_state_chunks_v2 WHERE id>=? AND id<? ORDER BY id',
      base,base+count
    )].map(row=>row.state_part);
    if(parts.length!==count)throw new Error('sovereign_committed_snapshot_incomplete');
    const restored=await decodeWorldSnapshot(joinSnapshot(parts));
    assertMonotonicSnapshot(restored,{
      highWaterMark:this.clockHighWaterMark,
      worldId:this.committedStats?.worldId||null
    });
    if(Number(meta.world_minute)!==Number(restored.clock.worldMinute)||String(meta.ledger_head)!==String(restored.ledgerHead)){
      throw new Error('sovereign_committed_snapshot_metadata_mismatch');
    }
    const seal=this.sqlRows('SELECT MAX(world_minute) AS world_minute FROM world_seals')[0]||null;
    const persistedSealMinute=Number(seal?.world_minute);
    if(Number.isFinite(persistedSealMinute)){
      const runtime=ensureRuntime(restored);
      runtime.lastSealWorldMinute=Math.max(Number(runtime.lastSealWorldMinute||0),persistedSealMinute);
    }
    compactOperationalState(restored);
    this.lastPersistedGeneration=generation;
    this.lastPersistedWorldMinute=Number(meta.world_minute);
    this.loadedSnapshotMinute=Number(meta.world_minute);
    this.snapshotRecoverySource=`rollback:${generation}`;
    return restored;
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
    const runtime=ensureRuntime(this.world);

    if(current===null){
      current=now+ALARM_MS;
      await this.ctx.storage.setAlarm(current);
      runtime.lastAlarmRecoveryReason='missing_alarm';
      runtime.lastAlarmRecoveryRealMs=now;
    }else if(current<now){
      // Cloudflare already owns this alarm. Rewriting an overdue alarm from
      // a read request can cancel/postpone the event that the platform is
      // trying to deliver, especially under sustained health polling. Only
      // rearm after both the alarm and the last successful tick are stale;
      // durable cooldown prevents repeated reads from postponing delivery.
      let rearmed=false;
      if(now-current>STALE_ALARM_MS&&
          (runtime.lastTickRealMs==null||now-Number(runtime.lastTickRealMs)>STALE_ALARM_MS)){
        const lastRearm=await this.ctx.storage.get('cymonia:alarm_rearm_ms');
        if(lastRearm==null||now-Number(lastRearm)>ALARM_REARM_COOLDOWN_MS){
          current=now+1_000;
          await this.ctx.storage.setAlarm(current);
          await this.ctx.storage.put('cymonia:alarm_rearm_ms',now);
          await this.ctx.storage.sync?.();
          runtime.lastAlarmRecoveryReason='stale_alarm_rearmed';
          runtime.lastAlarmRecoveryRealMs=now;
          runtime.alarmRecoveryCount=Number(runtime.alarmRecoveryCount||0)+1;
          rearmed=true;
        }
      }
      if(!rearmed){
        runtime.lastAlarmRecoveryReason='overdue_alarm_preserved';
        runtime.lastAlarmRecoveryRealMs=now;
      }
    }

    runtime.nextAlarmRealMs=current;
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
    // Compression and Workers AI yield the event loop. Serialize ALL writers.
    // Public readers use the bounded committed projection, not a cloned world.
    const pending=(this.mutationChain||Promise.resolve()).then(async()=>{
      if(!this.world)await this.restoreCommittedWorld(this.pendingRecoveryNeuronBudget);
      try{return await callback();}
      catch(error){
        const neuronBudget=this.world?.runtime?.neuronBudget;
        const canReload=Boolean(this.lastPersistedGeneration&&typeof this.sql?.exec==='function');
        if(canReload){
          try{await this.restoreCommittedWorld(neuronBudget);}
          catch(restoreError){
            // Production will retry the durable generation on the next wake.
            // The alarm handler below remains null-safe so this cannot mask
            // the original tick failure.
            this.world=null;
            console.error('CYMONIA_ROLLBACK_RELOAD_FAILED',String(restoreError?.message||restoreError).slice(0,300));
          }
        }
        throw error;
      }
    });
    this.mutationChain=pending.catch(()=>{});
    return pending;
  }
  async restoreCommittedWorld(neuronBudget){
    // Failure recovery is rare. Release the failed full graph first, then
    // reload exactly the durable committed generation from SQLite.
    if(neuronBudget)this.pendingRecoveryNeuronBudget=neuronBudget;
    this.world=null;
    const restored=await this.loadCommittedWorldFromStorage();
    ensureRuntime(restored);
    // External inference already consumed this budget even if saving failed.
    if(this.pendingRecoveryNeuronBudget)restored.runtime.neuronBudget=this.pendingRecoveryNeuronBudget;
    this.world=restored;
    this.pendingRecoveryNeuronBudget=null;
  }
  readableWorld(){return this.committedStats||committedStats(this.world);}
  readPersistenceBudget(day=utcDay(),limit=SAFE_ROW_WRITE_BUDGET){
    const rows=[...this.sql.exec('SELECT day,rows_written FROM persistence_budget WHERE id=1 LIMIT 1')];
    const used=rows.length&&rows[0].day===day?Number(rows[0].rows_written||0):0;
    return createWriteBudget(day,used,limit);
  }
  async writeCanonicalSnapshot({
    forceSeal,
    due,
    now,
    day,
    currentBudget,
    worldMinute,
    ledgerHead,
    worldId,
    snapshotClock,
  }){
    // This activation owns every large private-checkpoint temporary. When it
    // returns, gzip/base64 parts are unreachable before Observer projection
    // work starts.
    const encodingStartedAt=Date.now();
    console.log('CYMONIA_CHECKPOINT_BEGIN',JSON.stringify({worldMinute}));
    const {parts,stateSha256}=await encodeWorldSnapshotParts(this.world,{
      sealDue:due,
      clock:snapshotClock,
      ledgerHead,
      maxCodeUnits:ENCODED_SNAPSHOT_CHUNK_CODE_UNITS,
    });
    console.log('CYMONIA_CHECKPOINT_ENCODED',JSON.stringify({worldMinute,elapsedMs:Date.now()-encodingStartedAt,parts:parts.length}));
    const generation=nextSnapshotSlot(this.lastPersistedGeneration);
    const slotBase=generation==='slot-b'?1_000_000:0;
    const sealCount=due
      ?Number([...this.sql.exec('SELECT COUNT(*) AS count FROM world_seals')][0]?.count||0)
      :0;
    const sealPruneRows=due&&sealCount>=4096?1:0;
    const rowWrites=estimateSnapshotRowWrites({
      chunkCount:parts.length,
      sealDue:due,
      sealPruneRows,
    });
    const reservation=reserveWriteBudget(currentBudget,rowWrites);
    if(!reservation.allowed){
      return {persisted:false,reason:'write_budget_exhausted',rowWrites};
    }

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
        this.sql.exec(
          'INSERT INTO world_seals(world_minute,ledger_head,state_sha256,created_at) VALUES(?,?,?,?)',
          worldMinute,ledgerHead,stateSha256,now
        );
        if(sealPruneRows)this.sql.exec(
          'DELETE FROM world_seals WHERE seq=(SELECT MIN(seq) FROM world_seals)'
        );
      }
      this.sql.exec(`INSERT INTO persistence_budget(id,day,rows_written,updated_at) VALUES(1,?,?,?)
        ON CONFLICT(id) DO UPDATE SET day=excluded.day,rows_written=excluded.rows_written,updated_at=excluded.updated_at`,
        day,reservation.budget.rowsWritten,now);
    });

    return {
      persisted:true,
      generation,
      rowWrites,
      rowsWritten:reservation.budget.rowsWritten,
    };
  }

  async refreshPublicSnapshot({clock=this.world.clock,ledgerHead=this.world.ledgerHead}={}){
    const minute=Number(clock.worldMinute);
    let publicState=publicWorld({
      ...this.world,
      clock:{...clock},
      ledgerHead,
    });
    const committedHistory={entries:[...(publicState.history||[])]};
    const encoded=await encodeWorldSnapshotParts(publicState,{
      clock:publicState.clock,
      ledgerHead:publicState.ledgerHead,
      maxCodeUnits:ENCODED_SNAPSHOT_CHUNK_CODE_UNITS,
    });
    // Drop the materialized projection before joining its much smaller,
    // compressed representation.
    publicState=null;
    const snapshot=joinSnapshot(encoded.parts);
    this.committedPublicSnapshot=snapshot;
    this.committedPublicWorldMinute=minute;
    this.committedHistory=committedHistory;
    return snapshot;
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

    const clockGuard=[...this.sql.exec(
      'SELECT world_id,highest_world_minute FROM world_clock_guard WHERE id=1 LIMIT 1'
    )][0]||null;
    if(clockGuard){
      const minute=Number(this.world.clock.worldMinute);
      if(clockGuard.world_id!==this.world.worldId){
        throw new Error('sovereign_world_identity_regression');
      }
      if(minute<Number(clockGuard.highest_world_minute)){
        this.clockRegressionDetected=true;
        throw new Error(
          `sovereign_world_clock_regression:${minute}<${Number(clockGuard.highest_world_minute)}`
        );
      }
    }

    compactOperationalState(this.world);
    compactLedger(this.world,HOT_LEDGER_EVENTS);

    const due=forceSeal||
      this.world.clock.worldMinute-runtime.lastSealWorldMinute>=CHECKPOINT_WORLD_MINUTES;
    const worldMinute=this.world.clock.worldMinute;
    const ledgerHead=this.world.ledgerHead;
    const worldId=this.world.worldId;
    const snapshotClock={...this.world.clock};

    const canonical=await this.writeCanonicalSnapshot({
      forceSeal,
      due,
      now,
      day,
      currentBudget,
      worldMinute,
      ledgerHead,
      worldId,
      snapshotClock,
    });

    if(!canonical.persisted){
      this.persistenceDeferred++;
      if(!forceSeal)this.persistenceDeferredUntilRealMs=nextUtcDayStart(now);
      return canonical;
    }

    if(due)runtime.lastSealWorldMinute=worldMinute;

    // The durable manifest is authoritative from this point onward. Nothing
    // related to Observer projection is allowed to invalidate this commit.
    this.committedWorld=null;
    this.committedSnapshot=null;
    this.committedStats=committedStats(this.world,snapshotClock,ledgerHead);
    this.committedCausalWorld=committedCausalReader(this.world);
    this.lastPersistedGeneration=canonical.generation;
    this.lastPersistedWorldMinute=worldMinute;
    this.clockHighWaterMark=Math.max(
      Number(this.clockHighWaterMark??worldMinute),
      worldMinute
    );
    this.loadedSnapshotMinute=Math.max(
      Number(this.loadedSnapshotMinute??worldMinute),
      worldMinute
    );
    this.snapshotRecoverySource=`persist:${canonical.generation}`;
    this.persistenceDeferredUntilRealMs=0;

    try{
      // Private gzip/base64 buffers belonged to writeCanonicalSnapshot() and
      // are now out of scope. Refresh public state only after canonical commit.
      await this.refreshPublicSnapshot({clock:snapshotClock,ledgerHead});
    }catch(error){
      console.error(
        'CYMONIA_PUBLIC_SNAPSHOT_REFRESH_FAILED',
        String(error?.message||error).slice(0,300)
      );
    }

    return canonical;
  }
  async tick(){
    return this.mutateWorld(async()=>{
      if(Date.now()<this.persistenceDeferredUntilRealMs)return;
      const advancementStartedAt=Date.now();
      console.log('CYMONIA_ADVANCE_BEGIN',JSON.stringify({worldMinute:this.world.clock.worldMinute}));
      const progress=advanceWorldBounded(this.world,Date.now());
      console.log('CYMONIA_ADVANCE_READY',JSON.stringify({worldMinute:this.world.clock.worldMinute,elapsedMs:Date.now()-advancementStartedAt}));

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
      if(this.ctx.getWebSockets().length)this.broadcastWorldSignal('world_signal');
    });
  }
  async alarm(alarmInfo){
    if(!this.world)await this.restoreCommittedWorld(this.pendingRecoveryNeuronBudget);
    const startedAt=Date.now();
    const nextAlarm=startedAt+ALARM_MS;
    // Commit the successor before tick can throw or exhaust its CPU budget.
    await this.ctx.storage.setAlarm(nextAlarm);
    // setAlarm can resolve while its write is still buffered. Flush it before
    // synchronous simulation can keep storage completion events waiting.
    await this.ctx.storage.sync?.();
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
      runtime=this.world?ensureRuntime(this.world):{
        lastTickRealMs:null,
        lastTickWorldMinute:null,
        lastTickError:null,
        lastAlarmRetryCount:0,
      };
      runtime.lastTickRealMs=Date.now();
      runtime.lastTickWorldMinute=this.world?.clock?.worldMinute??this.committedStats?.clock?.worldMinute??null;
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
    const text=typeof message==='string'?message:JSON.stringify(message);
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
  worldSignal(type='world_signal'){
    const world=this.readableWorld();
    return {
      type,
      version:2,
      worldId:world.worldId,
      worldMinute:world.clock.worldMinute,
      ledgerHead:world.ledgerHead,
      persistedGeneration:this.lastPersistedGeneration??null
    };
  }
  broadcastWorldSignal(type='world_signal'){
    if(!this.ctx.getWebSockets().length)return;
    this.broadcast(this.worldSignal(type));
  }
  webSocket(){
    const pair=new WebSocketPair(),client=pair[0],server=pair[1];
    const session={id:crypto.randomUUID(),connectedAt:Date.now()};
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment?.(session);
    server.send(JSON.stringify(this.worldSignal('world_signal')));
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
    if(!this.world)await this.restoreCommittedWorld(this.pendingRecoveryNeuronBudget);
    const url=new URL(request.url),path=url.pathname.replace(/^\/world/,'')||'/';
    const scheduledAlarmRealMs=await this.ensureAlarm();
    const world=this.readableWorld();
    if(request.headers.get('upgrade')==='websocket'&&path==='/stream')return this.webSocket();
    if(request.method==='GET'&&path==='/health'){
      const runtime=ensureRuntime(this.world),budget=ensureNeuronBudget(this.world),persistenceBudget=this.readPersistenceBudget(),model=this.env.BRAIN_MODEL||MODEL,config=resolveNeuronConfig(this.env,model);
      const operational=world.operationalState;
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
          alarm_overdue_ms:scheduledAlarmRealMs===null?null:Math.max(0,Date.now()-Number(scheduledAlarmRealMs)),
          tick_stale_ms:runtime.lastTickRealMs==null?null:Math.max(0,Date.now()-Number(runtime.lastTickRealMs)),
          tick_stalled:Boolean(
            worldMinuteAt(world,Date.now())>world.clock.worldMinute &&
            runtime.lastTickRealMs!=null &&
            Date.now()-Number(runtime.lastTickRealMs)>60_000
          ),
          last_alarm_recovery_reason:runtime.lastAlarmRecoveryReason??null,
          last_alarm_recovery_real_ms:runtime.lastAlarmRecoveryRealMs??null,
          alarm_recovery_count:Number(runtime.alarmRecoveryCount||0),
        },
        operational_state:{
          actions:operational.actions,
          active_actions:operational.activeActions,
          moving_citizens:operational.movingCitizens,
          living_citizens:operational.livingCitizens,
          outside_center_20:operational.outsideCenter20,
          construction_projects:operational.constructionProjects,
          plans:operational.plans,
          experiments:operational.experiments
        },
        memory_model:'single-canonical-streamed-checkpoint-lazy-public-v2',
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
    if(request.method==='GET'&&(path==='/'||path==='/state')){
      const persistedMinute=Number(this.lastPersistedWorldMinute);
      const publicStale=
        !this.committedPublicSnapshot||
        Number(this.committedPublicWorldMinute)!==persistedMinute;

      if(publicStale){
        // Never project an in-flight/uncommitted graph. If this is the first
        // state read after wake, wait for any current writer and only project
        // when the in-memory graph still equals the durable generation.
        await (this.mutationChain||Promise.resolve()).catch(()=>{});
        if(
          this.world&&
          Number(this.world.clock?.worldMinute)===persistedMinute
        ){
          try{
            await this.refreshPublicSnapshot({
              clock:{...this.world.clock},
              ledgerHead:this.world.ledgerHead,
            });
          }catch(error){
            console.error(
              'CYMONIA_PUBLIC_SNAPSHOT_LAZY_FAILED',
              String(error?.message||error).slice(0,300)
            );
          }
        }
      }

      if(this.committedPublicSnapshot){
        return new Response(
          snapshotJsonStream(this.committedPublicSnapshot,{
            prefix:'{"ok":true,"world":',
            suffix:'}'
          }),
          {headers:{
            'content-type':'application/json; charset=utf-8',
            'cache-control':'no-store'
          }}
        );
      }

      return json({
        ok:false,
        error:'public_snapshot_unavailable',
        world_minute:this.committedStats?.clock?.worldMinute??null,
      },503);
    }
    if(request.method==='GET'&&path==='/history')return json({ok:true,history:this.committedHistory||{entries:[]}});
    if(request.method==='GET'&&path.startsWith('/why/')){
      const id=decodeURIComponent(path.slice(5)),why=getWhy(this.committedCausalWorld||{ledger:[],physicalReceipts:[],objects:[],procedures:[]},id);
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
          if(this.ctx.getWebSockets().length)this.broadcastWorldSignal('world_signal');
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
