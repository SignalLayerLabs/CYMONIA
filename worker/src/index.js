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
  trimCitizenMemories,
} from '../../world/index.js';
import {
  SAFE_ROW_WRITE_BUDGET,
  EMERGENCY_ROW_WRITE_BUDGET,
  encodeWorldSnapshotParts,
  decodeWorldSnapshot,
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
import {createEvidencePool} from '../../world/evidence-pool.js';
import {KnowledgeArchive} from './knowledge-archive.js';
import {knowledgeStorage,activeKnowledgeCount} from '../../world/knowledge-storage.js';

const MODEL='@cf/zai-org/glm-4.7-flash';
const ALARM_MS=15_000;
const ALARM_PULSE_MS=2_500;
// Six boundaries divide the retained 30-minute target evenly and leave
// wall-time headroom for the separate mature-world checkpoint phase.
const ALARM_MAX_SEGMENTS=6;
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
const MAX_STAGED_SNAPSHOT_PARTS=64;
const MAX_CATCHUP_WORLD_MINUTES=90;
const ALARM_MAX_ADVANCE_WORLD_MINUTES=30;
const MAX_OUTAGE_WORLD_MINUTES=360;
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
export function advanceWorldBounded(world,nowMs=Date.now(),maxCatchup=MAX_CATCHUP_WORLD_MINUTES,maxOutage=MAX_OUTAGE_WORLD_MINUTES,options={}){
  let trimmedMemories=0;
  for(const citizen of world.citizens)trimmedMemories+=trimCitizenMemories(citizen);
  let target=worldMinuteAt(world,nowMs),recovered=false,skippedWorldMinutes=0;
  const lag=Math.max(0,target-world.clock.worldMinute);
  if(lag>maxOutage){
    skippedWorldMinutes=lag-1;
    world.clock.realEpochMs=nowMs-(world.clock.worldMinute+1)*REAL_MS_PER_WORLD_MINUTE;
    appendEvent(world,'RUNTIME_LAG_REBASED','world',{skippedWorldMinutes,reason:'runtime_outage'},[],world.clock.worldMinute);
    target=world.clock.worldMinute+1;recovered=true;
  }
  const next=recovered?target:Math.min(target,world.clock.worldMinute+maxCatchup,options.targetWorldMinute??Infinity);
  const boundedNow=world.clock.realEpochMs+next*REAL_MS_PER_WORLD_MINUTE;
  advanceWorldTo(world,boundedNow,options);
  return {recovered,skippedWorldMinutes,advanceTargetWorldMinute:next,lagWorldMinutes:Math.max(0,target-world.clock.worldMinute),trimmedMemories};
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
    this.pendingTrimmedMemories=0;
    this.pendingCheckpoint=false;
    this.pendingForceSeal=false;
    this.pendingAdvanceTarget=null;
    this.evidencePool=null;
    this.awaitingColdCpuRenewal=true;
    this.coldCpuRenewalToken=crypto.randomUUID();
    if(typeof WebSocketRequestResponsePair==='function'&&this.ctx.setWebSocketAutoResponse){
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
    }
    // Only synchronous schema setup belongs behind the platform input gate.
    // Canonical readers/mutations await ready; internal heartbeats stay callable
    // during streamed recovery so genuine arrivals can renew the CPU window.
    this.initializing=true;
    const schemaReady=ctx.blockConcurrencyWhile(async()=>this.initializeSQLite());
    this.ready=Promise.resolve(schemaReady).then(async()=>{
      const wakeStartedAt=Date.now();
      console.log('CYMONIA_WAKE_BEGIN');
      this.world=await this.loadWorld();
      if(this.world)this.registerCitizenEvidence();
      const citizens=this.world?.citizens||[];
      console.log('CYMONIA_WAKE_DECODED',JSON.stringify({
        elapsedMs:Date.now()-wakeStartedAt,
        worldMinute:this.world?.clock?.worldMinute??null,
        privateMemories:citizens.reduce((n,c)=>n+(c.memories?.length||0),0),
        knowledgeEntries:citizens.reduce((n,c)=>n+(c.knowledge?.length||0),0),
        knowledgeSources:citizens.reduce((n,c)=>n+(knowledgeStorage(c.knowledge)?.sourceCount??(c.knowledge||[]).reduce((m,k)=>m+(k.provenance?.length||0),0)),0),
        objects:this.world?.objects?.length||0,
        ...(this.evidencePool?.stats()||{}),
      }));
      if(!this.world){
        this.world=createSovereignGenesis({realEpochMs:Date.now()});
        this.registerCitizenEvidence();
        ensureRuntime(this.world);
        await this.persist({forceSeal:true});
      }else{
        ensureRuntime(this.world);
        this.establishClockGuardBaseline();
        if(!this.lastPersistedGeneration||this.knowledgeArchive?.backingBytes)await this.persist({forceSeal:true});
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
      this.initializing=false;
    }).catch(error=>{
      this.initializing=false;
      console.error('CYMONIA_WAKE_FAILED',String(error?.message||error).slice(0,300));
      ctx.abort?.('canonical recovery failed');
      throw error;
    });
    this.ready.catch(()=>{});
    ctx.waitUntil?.(this.ready);
  }
  initializeSQLite(){
    this.sql.exec('CREATE TABLE IF NOT EXISTS knowledge_bins(id TEXT PRIMARY KEY,data BLOB NOT NULL) WITHOUT ROWID');
    this.sql.exec('CREATE TABLE IF NOT EXISTS knowledge_bin_slots(id INTEGER PRIMARY KEY,bin_ids TEXT NOT NULL)');
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
    if(typeof this.ctx?.storage?.transactionSync==='function')this.ensureSealReadIndex();
  }
  ensureSealReadIndex(){
    if(this.sealIndexReady)return true;
    // The migration must never spend unreserved writes or prevent read recovery.
    const schema=new Set(this.sqlRows(`SELECT name FROM sqlite_master
      WHERE name IN ('world_seals_minute','world_seal_inventory','world_seals_count_insert','world_seals_count_delete')`).map(row=>row.name));
    const index=schema.has('world_seals_minute'),table=schema.has('world_seal_inventory');
    const inventory=table?this.sqlRows('SELECT row_count FROM world_seal_inventory WHERE id=1 LIMIT 1')[0]:null;
    if(schema.size===4&&inventory){this.sealIndexReady=true;return true;}
    const now=Date.now(),day=utcDay(now),budget=this.readPersistenceBudget(day);
    if(!reserveWriteBudget(budget,4103).allowed)return false;
    const count=Number(this.sqlRows('SELECT COUNT(*) AS count FROM world_seals')[0]?.count||0);
    // workerd meters index backfill as count+1 (catalog), each table/trigger
    // creation as two rows, each trigger as one, plus inventory and budget bookkeeping.
    const cost=(index?0:count+1)+(table?0:2)+
      (schema.has('world_seals_count_insert')?0:1)+(schema.has('world_seals_count_delete')?0:1)+2;
    const reservation=reserveWriteBudget(budget,cost);
    if(!reservation.allowed)return false;
    // Charge before staging, including failed migrations; never reset burned quota.
    this.sql.exec(`INSERT INTO persistence_budget(id,day,rows_written,updated_at) VALUES(1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET day=excluded.day,rows_written=excluded.rows_written,updated_at=excluded.updated_at`,
      day,reservation.budget.rowsWritten,now);
    this.ctx.storage.transactionSync(()=>{
      this.sql.exec(`CREATE TABLE IF NOT EXISTS world_seal_inventory(
        id INTEGER PRIMARY KEY CHECK(id=1),row_count INTEGER NOT NULL CHECK(row_count>=0))`);
      this.sql.exec('CREATE INDEX IF NOT EXISTS world_seals_minute ON world_seals(world_minute)');
      this.sql.exec('INSERT INTO world_seal_inventory(id,row_count) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET row_count=excluded.row_count',count);
      // Keep the exact count even when sequence numbers contain gaps.
      this.sql.exec(`CREATE TRIGGER IF NOT EXISTS world_seals_count_insert AFTER INSERT ON world_seals
        BEGIN UPDATE world_seal_inventory SET row_count=row_count+1 WHERE id=1; END`);
      this.sql.exec(`CREATE TRIGGER IF NOT EXISTS world_seals_count_delete AFTER DELETE ON world_seals
        BEGIN UPDATE world_seal_inventory SET row_count=row_count-1 WHERE id=1; END`);
    });
    this.sealIndexReady=true;return true;
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
          const pool=createEvidencePool();
          const archive=this.createKnowledgeArchive(pool,true);
          let trimmedMemories=0;
          for(const citizen of world.citizens){trimmedMemories+=trimCitizenMemories(citizen);archive.attach(citizen);pool.hydrateCitizen(citizen);await this.yieldRuntime();}
          this.evidencePool=pool;this.pendingTrimmedMemories=trimmedMemories;
          selected={world,generation,source:meta.source};
          break;
        }
        const count=Number(meta.chunk_count);
        const encoded=this.storedSnapshotParts(meta.generation,count);
        console.log('CYMONIA_SNAPSHOT_LOAD',JSON.stringify({generation:meta.generation,chunkCount:count,streamed:true}));
        let trimmedMemories=0;
        const pool=createEvidencePool();
        const archive=this.createKnowledgeArchive(pool,true);
        const world=await decodeWorldSnapshot(encoded,{onArrayItem:(key,item)=>{
          if(key==='citizens'){trimmedMemories+=trimCitizenMemories(item);archive.attach(item);pool.hydrateCitizen(item);
            return this.yieldRuntime().then(()=>item);}
          return item;
        }});
        await archive.verifyBacking(()=>this.yieldRuntime());
        assertMonotonicSnapshot(world,{worldId:guard?.world_id||null});
        if(meta.world_minute!==undefined&&Number(meta.world_minute)!==world.clock.worldMinute)throw new Error('sovereign_snapshot_metadata_mismatch');
        if(meta.ledger_head!==undefined&&meta.ledger_head!==world.ledgerHead)throw new Error('sovereign_snapshot_metadata_mismatch');
        assertMonotonicSnapshot(world,{highWaterMark,worldId:guard?.world_id||null});
        selected={world,generation:meta.generation,source:meta.source};
        this.lastSnapshotChunkCount=count;
        this.pendingTrimmedMemories=trimmedMemories;
        this.evidencePool=pool;
        this.committedSnapshot=null;
        break;
      }catch(error){
        console.error('CYMONIA_SNAPSHOT_CANDIDATE_REJECTED',String(error?.message||error).slice(0,240));
        // An older slot can share the same clock while missing newer private
        // mutations. Archive corruption must never silently select that state.
        if(String(error?.message||error).startsWith('knowledge_'))
          throw new Error('sovereign_world_snapshot_unavailable_below_clock_guard',{cause:error});
      }
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
    if(this.knowledgeArchive)this.knowledgeArchive.recovering=false;
    compactOperationalState(selected.world);return selected.world;
  }
  *storedSnapshotParts(generation,count){
    // Only the current SQLite row and a 64 KiB base64 window need remain
    // alive alongside the canonical graph during wake and rollback.
    const slotted=generation==='slot-a'||generation==='slot-b';
    const base=generation==='slot-b'?1_000_000:0;
    const rows=slotted
      ?this.sql.exec('SELECT state_part FROM world_state_chunks_v2 WHERE id>=? AND id<? ORDER BY id',base,base+count)
      :this.sql.exec('SELECT state_part FROM world_state_chunks WHERE generation=? AND seq<? ORDER BY seq',generation,count);
    let seen=0;
    for(const row of rows){
      if(++seen>count)throw new Error('sovereign_snapshot_chunk_count_mismatch');
      yield row.state_part;
    }
    if(seen!==count)throw new Error('sovereign_snapshot_chunk_count_mismatch');
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
    const count=Number(meta.chunk_count);
    let trimmedMemories=0;
    const pool=createEvidencePool();
    const archive=this.createKnowledgeArchive(pool,true);
    const restored=await decodeWorldSnapshot(this.storedSnapshotParts(generation,count),{onArrayItem:(key,item)=>{
      if(key==='citizens'){trimmedMemories+=trimCitizenMemories(item);archive.attach(item);pool.hydrateCitizen(item);
        return this.yieldRuntime().then(()=>item);}
      return item;
    }});
    await archive.verifyBacking(()=>this.yieldRuntime());
    assertMonotonicSnapshot(restored,{
      highWaterMark:this.clockHighWaterMark,
      worldId:this.committedStats?.worldId||null
    });
    if(Number(meta.world_minute)!==Number(restored.clock.worldMinute)||String(meta.ledger_head)!==String(restored.ledgerHead)){
      throw new Error('sovereign_committed_snapshot_metadata_mismatch');
    }
    this.lastSnapshotChunkCount=count;
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
    this.pendingTrimmedMemories=trimmedMemories;
    this.evidencePool=pool;
    archive.recovering=false;
    return restored;
  }
  registerCitizenEvidence(){
    this.evidencePool??=createEvidencePool();
    if(this.ctx&&this.sql?.exec)this.knowledgeArchive??=this.createKnowledgeArchive(this.evidencePool);
    for(const citizen of this.world?.citizens||[]){this.evidencePool.hydrateCitizen(citizen);this.knowledgeArchive?.attach(citizen);}
  }
  async yieldRuntime(){
    await this.ctx.storage.sync?.();
    // Resolved stream/storage promises can form a continuous microtask chain.
    // A timer yields to incoming heartbeats and buffered storage completions.
    await new Promise(resolve=>setTimeout(resolve,1));
  }
  createKnowledgeArchive(pool,recovering=false){
    this.knowledgeArchive?.dispose();
    if(recovering){this.awaitingColdCpuRenewal=true;this.coldCpuRenewalToken=crypto.randomUUID();}
    const archive=new KnowledgeArchive(this.sql,{hydrateEntry:entry=>{
      for(const source of entry.provenance||[])if(source.evidence)source.evidence=pool.intern(source.evidence);
    }});
    archive.recovering=recovering;
    // Leave obsolete scratch rows inert: deleting them during wake consumes quota.
    this.knowledgeArchive=archive;
    return archive;
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
    this.evidencePool=null;
    const restored=await this.loadCommittedWorldFromStorage();
    ensureRuntime(restored);
    // External inference already consumed this budget even if saving failed.
    if(this.pendingRecoveryNeuronBudget)restored.runtime.neuronBudget=this.pendingRecoveryNeuronBudget;
    this.world=restored;
    this.pendingCheckpoint=false;
    this.pendingForceSeal=false;
    this.pendingAdvanceTarget=null;
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
    // Reserve enough headroom before staging: the exact chunk count is known
    // only after streaming, and an incomplete inactive slot still costs rows.
    const stagedBins=this.knowledgeArchive?.stagedBinCount()||0;
    if(!reserveWriteBudget(currentBudget,MAX_STAGED_SNAPSHOT_PARTS*2+15+stagedBins*2).allowed){
      return {persisted:false,reason:'write_budget_exhausted'};
    }
    const generation=nextSnapshotSlot(this.lastPersistedGeneration);
    await this.knowledgeArchive?.stageBins((data,id)=>{
      // Each staged bin and its budget charge commit together. An interrupted
      // snapshot never erases the charge or replaces the active manifest.
      this.ctx.storage.transactionSync(()=>{
        const chargeDay=utcDay();
        const budget=this.readPersistenceBudget(chargeDay,currentBudget.limit);
        const admission=reserveWriteBudget(budget,2);
        if(!admission.allowed)throw new Error('knowledge_staging_budget_exhausted');
        this.sql.exec('INSERT INTO knowledge_bins(id,data) VALUES(?,?) ON CONFLICT(id) DO NOTHING',id,data);
        this.sql.exec('UPDATE persistence_budget SET day=?,rows_written=?,updated_at=? WHERE id=1',chargeDay,admission.budget.rowsWritten,Date.now());
      });
      return id;
    },()=>this.yieldRuntime());
    const slotBase=generation==='slot-b'?1_000_000:0;
    let chunkCount=0;
    const encodingStartedAt=Date.now();
    console.log('CYMONIA_CHECKPOINT_BEGIN',JSON.stringify({worldMinute,streamingDigest:typeof crypto.DigestStream==='function'}));
    const {stateSha256}=await encodeWorldSnapshotParts(this.world,{
      sealDue:due,
      clock:snapshotClock,
      ledgerHead,
      maxCodeUnits:ENCODED_SNAPSHOT_CHUNK_CODE_UNITS,
      onProgress:()=>this.yieldRuntime(),
      packedKnowledge:true,
      onPart:part=>{
        if(chunkCount>=MAX_STAGED_SNAPSHOT_PARTS)throw new Error('sovereign_snapshot_exceeds_staging_limit');
        // The active generation and its manifest remain intact until the
        // final metadata transaction. No large SQLite transaction accumulates
        // all of the compressed chunks in the isolate.
        this.ctx.storage.transactionSync(()=>{
          const chargeDay=utcDay();
          const budget=this.readPersistenceBudget(chargeDay,currentBudget.limit),admission=reserveWriteBudget(budget,2);
          if(!admission.allowed)throw new Error('sovereign_snapshot_staging_budget_exhausted');
          this.sql.exec(
            'INSERT INTO world_state_chunks_v2(id,state_part) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state_part=excluded.state_part',
            slotBase+chunkCount,part
          );
          this.sql.exec('UPDATE persistence_budget SET day=?,rows_written=?,updated_at=? WHERE id=1',chargeDay,admission.budget.rowsWritten,Date.now());
        });
        chunkCount++;
      },
    });
    console.log('CYMONIA_CHECKPOINT_ENCODED',JSON.stringify({worldMinute,elapsedMs:Date.now()-encodingStartedAt,parts:chunkCount}));
    const sealCount=due
      ?Number([...this.sql.exec('SELECT row_count AS count FROM world_seal_inventory WHERE id=1 LIMIT 1')][0]?.count||0)
      :0;
    const sealPruneRows=due&&sealCount>=4096?1:0;
    const rowWrites=1+estimateSnapshotRowWrites({
      chunkCount:0,
      sealDue:due,
      sealPruneRows,
    });
    // Workers clocks stay frozen during pure CPU work. Complete staged I/O
    // before timestamping publication; encoding start is not commit time.
    await this.ctx.storage.sync?.();
    const committedAtRealMs=Date.now();
    day=utcDay(committedAtRealMs);
    const reservation=reserveWriteBudget(this.readPersistenceBudget(day,currentBudget.limit),rowWrites);
    if(!reservation.allowed)return {persisted:false,reason:'write_budget_exhausted',rowWrites};
    this.ctx.storage.transactionSync(()=>{
      this.sql.exec(`INSERT INTO world_state_manifest(id,generation,chunk_count,world_minute,ledger_head,updated_at)
        VALUES(1,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,chunk_count=excluded.chunk_count,world_minute=excluded.world_minute,ledger_head=excluded.ledger_head,updated_at=excluded.updated_at`,
        generation,chunkCount,worldMinute,ledgerHead,committedAtRealMs);
      this.sql.exec(`INSERT INTO world_snapshot_slots(generation,chunk_count,world_minute,ledger_head,updated_at)
        VALUES(?,?,?,?,?)
        ON CONFLICT(generation) DO UPDATE SET chunk_count=excluded.chunk_count,world_minute=excluded.world_minute,ledger_head=excluded.ledger_head,updated_at=excluded.updated_at`,
        generation,chunkCount,worldMinute,ledgerHead,committedAtRealMs);
      this.sql.exec('INSERT INTO knowledge_bin_slots(id,bin_ids) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET bin_ids=excluded.bin_ids',
        generation==='slot-b'?1:0,JSON.stringify(this.knowledgeArchive?.referencedBins()||[]));
      this.sql.exec(`INSERT INTO world_clock_guard(id,world_id,highest_world_minute,ledger_head,updated_at)
        VALUES(1,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          world_id=excluded.world_id,
          highest_world_minute=CASE WHEN excluded.highest_world_minute>world_clock_guard.highest_world_minute THEN excluded.highest_world_minute ELSE world_clock_guard.highest_world_minute END,
          ledger_head=CASE WHEN excluded.highest_world_minute>=world_clock_guard.highest_world_minute THEN excluded.ledger_head ELSE world_clock_guard.ledger_head END,
          updated_at=excluded.updated_at`,
        worldId,worldMinute,ledgerHead,committedAtRealMs);
      if(due){
        this.sql.exec(
          'INSERT INTO world_seals(world_minute,ledger_head,state_sha256,created_at) VALUES(?,?,?,?)',
          worldMinute,ledgerHead,stateSha256,committedAtRealMs
        );
        if(sealPruneRows)this.sql.exec(
          'DELETE FROM world_seals WHERE seq=(SELECT MIN(seq) FROM world_seals)'
        );
      }
      this.sql.exec(`INSERT INTO persistence_budget(id,day,rows_written,updated_at) VALUES(1,?,?,?)
        ON CONFLICT(id) DO UPDATE SET day=excluded.day,rows_written=excluded.rows_written,updated_at=excluded.updated_at`,
        day,reservation.budget.rowsWritten,committedAtRealMs);
    });
    await this.ctx.storage.sync?.();
    // Publication already succeeded; optional maintenance cannot roll it back.
    try{this.collectKnowledgeBins(day,currentBudget.limit);}
    catch(error){console.error('CYMONIA_KNOWLEDGE_GC_DEFERRED',String(error?.message||error).slice(0,200));}

    return {
      persisted:true,
      generation,
      chunkCount,
      committedAtRealMs:Date.now(),
      rowWrites:rowWrites+(stagedBins+chunkCount)*2,
      rowsWritten:this.readPersistenceBudget(day,currentBudget.limit).rowsWritten,
    };
  }
  collectKnowledgeBins(day,limit){
    day=utcDay();
    // Two slot inventories and a bounded primary-key window; no full table
    // scan or per-record rows. In-flight/live handles are retained as well.
    const retained=new Set(this.knowledgeArchive?.referencedBins()||[]);
    for(const row of this.sql.exec('SELECT bin_ids FROM knowledge_bin_slots WHERE id<2'))for(const id of JSON.parse(row.bin_ids))retained.add(id);
    this.knowledgeGcCursor??=JSON.parse([...this.sql.exec('SELECT bin_ids FROM knowledge_bin_slots WHERE id=2')][0]?.bin_ids||'[""]')[0];
    const candidates=[...this.sql.exec('SELECT id FROM knowledge_bins WHERE id>? ORDER BY id LIMIT 16',this.knowledgeGcCursor||'')];
    let deleted=0;
    for(const {id} of candidates){
      this.knowledgeGcCursor=id;if(retained.has(id))continue;
      if(deleted>=2)break;
      const budget=this.readPersistenceBudget(day,limit),admission=reserveWriteBudget(budget,2);
      if(!admission.allowed)break;
      this.ctx.storage.transactionSync(()=>{
        this.sql.exec('DELETE FROM knowledge_bins WHERE id=?',id);
        this.sql.exec('UPDATE persistence_budget SET day=?,rows_written=?,updated_at=? WHERE id=1',day,admission.budget.rowsWritten,Date.now());
      });deleted++;
      const cached=this.knowledgeArchive?.binCache.get(id);
      if(cached){this.knowledgeArchive.binCacheBytes-=cached.length;this.knowledgeArchive.binCache.delete(id);}
      this.knowledgeArchive?.bins.delete(id);
    }
    if(!candidates.length)this.knowledgeGcCursor='';
    const budget=this.readPersistenceBudget(day,limit),admission=reserveWriteBudget(budget,2);
    if(admission.allowed)this.ctx.storage.transactionSync(()=>{
      this.sql.exec('INSERT INTO knowledge_bin_slots(id,bin_ids) VALUES(2,?) ON CONFLICT(id) DO UPDATE SET bin_ids=excluded.bin_ids',JSON.stringify([this.knowledgeGcCursor]));
      this.sql.exec('UPDATE persistence_budget SET day=?,rows_written=?,updated_at=? WHERE id=1',day,admission.budget.rowsWritten,Date.now());
    });
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
    this.registerCitizenEvidence();
    const runtime=ensureRuntime(this.world);
    const now=Date.now(),day=utcDay(now);
    if(typeof this.ctx?.storage?.transactionSync==='function'&&!this.ensureSealReadIndex()){
      this.persistenceDeferred++;this.persistenceDeferredUntilRealMs=nextUtcDayStart(now);
      return {persisted:false,reason:'seal_index_migration_budget_exhausted'};
    }
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
    this.lastSnapshotChunkCount=canonical.chunkCount;
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
    this.lastCompletedCheckpointRealMs=canonical.committedAtRealMs;
    console.log('CYMONIA_CHECKPOINT_COMMITTED',JSON.stringify({worldMinute,generation:canonical.generation,committedAtRealMs:canonical.committedAtRealMs}));

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
  checkpointIntervalWorldMinutes(){
    // Reserve 2k of the normal 40k allowance for recovery/retries. Chunk size
    // growth changes cadence without raising the persisted admission limit.
    const pending=(this.knowledgeArchive?.backingBytes||0)+3*(this.knowledgeArchive?.dirtyCodeUnits||0);
    const bins=Math.ceil(pending/(1024*1024));
    const rows=7+2*bins+2*(this.lastSnapshotChunkCount||1)+estimateSnapshotRowWrites({chunkCount:0,sealDue:true,sealPruneRows:1});
    const minutesPerRealDay=86400000/REAL_MS_PER_WORLD_MINUTE;
    return Math.max(PERSIST_INTERVAL_WORLD_MINUTES,Math.ceil(minutesPerRealDay*rows/(SAFE_ROW_WRITE_BUDGET-2000)));
  }
  async tick(maxCatchup=MAX_CATCHUP_WORLD_MINUTES,maxOutage=MAX_OUTAGE_WORLD_MINUTES,{maxSegments=Infinity,deferCheckpoint=false}={}){
    return this.mutateWorld(async()=>{
      if(Date.now()<this.persistenceDeferredUntilRealMs)return;
      // Separate phases bound the work per handler. Only an incoming request
      // renews the platform's cumulative CPU window; alarms alone do not.
      if(deferCheckpoint&&this.pendingCheckpoint){
        // AI decisions share the planned save, rather than forcing a full
        // mature-world checkpoint after every short simulation boundary.
        if(!this.pendingForceSeal)await this.processCognition(1);
        await this.persist({forceSeal:Boolean(this.pendingForceSeal)});
        this.pendingCheckpoint=false;this.pendingForceSeal=false;
        this.pendingTrimmedMemories=0;
        if(this.ctx.getWebSockets().length)this.broadcastWorldSignal('world_signal');
        return;
      }
      this.registerCitizenEvidence();
      const advancementStartedAt=Date.now();
      console.log('CYMONIA_ADVANCE_BEGIN',JSON.stringify({worldMinute:this.world.clock.worldMinute}));
      const progress=advanceWorldBounded(this.world,Date.now(),maxCatchup,maxOutage,{maxSegments,targetWorldMinute:this.pendingAdvanceTarget??Infinity});
      this.pendingAdvanceTarget=this.world.clock.worldMinute<progress.advanceTargetWorldMinute?progress.advanceTargetWorldMinute:null;
      this.registerCitizenEvidence();
      progress.trimmedMemories+=this.pendingTrimmedMemories||0;
      if(progress.trimmedMemories)console.log('CYMONIA_PRIVATE_MEMORY_BOUNDED',JSON.stringify({worldMinute:this.world.clock.worldMinute,trimmedMemories:progress.trimmedMemories}));
      console.log('CYMONIA_ADVANCE_READY',JSON.stringify({worldMinute:this.world.clock.worldMinute,elapsedMs:Date.now()-advancementStartedAt}));

      const lastPersisted=Number(
        this.lastPersistedWorldMinute ?? this.world.clock.worldMinute
      );

      const checkpointDue=
        this.world.clock.worldMinute-lastPersisted >=
        this.checkpointIntervalWorldMinutes();

      const forceSeal=Boolean(progress.recovered||progress.trimmedMemories);
      const cognitionChanged=!deferCheckpoint&&!forceSeal&&await this.processCognition(1);
      if(forceSeal||checkpointDue||cognitionChanged){
        if(deferCheckpoint){
          this.pendingCheckpoint=true;
          this.pendingForceSeal=Boolean(this.pendingForceSeal||forceSeal);
        }else{
          await this.persist({forceSeal});
          this.pendingTrimmedMemories=0;
        }
      }

      // Deferred pulses publish only after their checkpoint commits.
      if(!deferCheckpoint&&this.ctx.getWebSockets().length)this.broadcastWorldSignal('world_signal');
    });
  }
  async alarm(alarmInfo){
    await this.ready;
    if(!this.world)await this.restoreCommittedWorld(this.pendingRecoveryNeuronBudget);
    const startedAt=Date.now();
    // Even a caught-up tick can change private cognition or trim memories.
    // Keep every mutation-capable invocation warm until its next phase.
    let nextAlarm=startedAt+(startedAt<this.persistenceDeferredUntilRealMs?ALARM_MS:ALARM_PULSE_MS);
    // Commit the successor before tick can throw or exhaust its CPU budget.
    await this.ctx.storage.setAlarm(nextAlarm);
    // setAlarm can resolve while its write is still buffered. Flush it before
    // synchronous simulation can keep storage completion events waiting.
    await this.ctx.storage.sync?.();
    // Cold decode already spent CPU in this alarm's platform window. Keep
    // its successor warm until the autonomous incoming heartbeat renews it.
    if(this.awaitingColdCpuRenewal)return;
    let runtime=ensureRuntime(this.world);
    runtime.nextAlarmRealMs=nextAlarm;

    const savingCheckpoint=Boolean(this.pendingCheckpoint);
    try{
      await this.tick(ALARM_MAX_ADVANCE_WORLD_MINUTES,MAX_OUTAGE_WORLD_MINUTES,{maxSegments:ALARM_MAX_SEGMENTS,deferCheckpoint:true});
      runtime=ensureRuntime(this.world);
      runtime.lastTickRealMs=Date.now();
      runtime.lastTickWorldMinute=this.world.clock.worldMinute;
      runtime.lastTickError=null;
      runtime.lastAlarmRetryCount=Number(alarmInfo?.retryCount||0);
      // Leave the precommitted successor unchanged, even if already due.
      // One alarm write per healthy pulse bounds daily Free-plan row usage.
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

      // Back off failed pulses; the precommitted successor also survives a
      // CPU reset that cannot run this catch block.
      const retryAt=Date.now()+ALARM_MS;
      try{await this.ctx.storage.setAlarm(retryAt);nextAlarm=retryAt;}
      catch(scheduleError){console.error('CYMONIA_ALARM_BACKOFF_FAILED',String(scheduleError?.message||scheduleError).slice(0,300));}
    }
    runtime.nextAlarmRealMs=nextAlarm;
    try{
      // Rapid simulation pulses must not consume the Free daily write quota
      // just to repeat healthy diagnostics. Failures and commits flush at once.
      const now=Date.now();
      if(savingCheckpoint||runtime.lastTickError!==this.lastHeartbeatStatusError||now-(this.lastHeartbeatStatusRealMs??-Infinity)>=ALARM_MS){
        await this.ctx.storage.put(HEARTBEAT_STATUS_KEY,tickDiagnostics(runtime));
        this.lastHeartbeatStatusRealMs=now;
        this.lastHeartbeatStatusError=runtime.lastTickError;
      }
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
        appendEvent(this.world,'AI_COGNITION',c.id,{model,reason:item.reason,status:'accepted',knowledgeContextCount:activeKnowledgeCount(c),chargedNeurons:accounting.charged,accountingWarning:accounting.warning||null},[],this.world.clock.worldMinute);
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
    const url=new URL(request.url),path=url.pathname.replace(/^\/world/,'')||'/';
    if(request.method==='GET'&&path==='/runtime-heartbeat'&&(this.initializing||!this.world)){
      this.lastSchedulerHeartbeatRealMs=Date.now();
      return json({ok:true,service:'cymonia-sovereign-world',initializing:true,world_minute:null,lag_world_minutes:null});
    }
    await this.ready;
    if(!this.world)await this.restoreCommittedWorld(this.pendingRecoveryNeuronBudget);
    const scheduledAlarmRealMs=await this.ensureAlarm();
    const world=this.readableWorld();
    if(request.headers.get('upgrade')==='websocket'&&path==='/stream')return this.webSocket();
    if(request.method==='GET'&&path==='/runtime-heartbeat'){
      // A request echoing this token was dispatched after a previous response
      // from this recovered object. Queued cold-wake requests cannot release it.
      if(request.headers.get('x-cymonia-cpu-renewal')===this.coldCpuRenewalToken)this.awaitingColdCpuRenewal=false;
      this.lastSchedulerHeartbeatRealMs=Date.now();
      return json({ok:true,service:'cymonia-sovereign-world',world_minute:world.clock.worldMinute,
        cpu_renewal_token:this.coldCpuRenewalToken,
        lag_world_minutes:Math.max(0,worldMinuteAt(world,Date.now())-world.clock.worldMinute)});
    }
    if(request.method==='GET'&&path==='/health'){
      const runtime=ensureRuntime(this.world),budget=ensureNeuronBudget(this.world),persistenceBudget=this.readPersistenceBudget(),model=this.env.BRAIN_MODEL||MODEL,config=resolveNeuronConfig(this.env,model);
      const operational=world.operationalState;
      const checkpointRealMs=Number(this.sqlRows('SELECT updated_at FROM world_clock_guard WHERE id=1 LIMIT 1')[0]?.updated_at??runtime.lastTickRealMs??0);
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
        scheduler:{interval_ms:20_000,last_received_real_ms:this.lastSchedulerHeartbeatRealMs??null},
        knowledge_archive:this.knowledgeArchive?.stats()??null,
        seal_read_index_ready:Boolean(this.sealIndexReady),
        last_checkpoint_real_ms:Math.max(checkpointRealMs,this.lastCompletedCheckpointRealMs??0),
        alarm_interval_ms:ALARM_PULSE_MS,
        checkpoint_interval_world_minutes:this.checkpointIntervalWorldMinutes(),
        heartbeat:{
          scheduledAlarmRealMs,
          nextAlarmRealMs:runtime.nextAlarmRealMs??null,
          ...tickDiagnostics(runtime),
          alarm_overdue_ms:scheduledAlarmRealMs===null?null:Math.max(0,Date.now()-Number(scheduledAlarmRealMs)),
          tick_stale_ms:runtime.lastTickRealMs==null?null:Math.max(0,Date.now()-Number(runtime.lastTickRealMs)),
          tick_stalled:Boolean(
            worldMinuteAt(world,Date.now())>world.clock.worldMinute &&
            checkpointRealMs>0 &&
            Date.now()-checkpointRealMs>120_000
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
  scheduled(controller,env,ctx){
    // Alarms keep simulation phases warm but do not renew the DO CPU window.
    // Supply genuine incoming requests even when every Observer is closed.
    // Independent slots keep a slow/rejected request from blocking renewal.
    ctx.waitUntil((async()=>{
      let cpuRenewalToken=null,lastTokenSlot=-1;
      const results=await Promise.allSettled([0,20_000,40_000].map(async delay=>{
        if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
        try{
          const id=env.WORLD.idFromName('canonical-v2'),stub=env.WORLD.get(id);
          const response=await stub.fetch(new Request('https://cymonia.internal/world/runtime-heartbeat',{
            signal:AbortSignal.timeout(45_000),
            headers:cpuRenewalToken?{'x-cymonia-cpu-renewal':cpuRenewalToken}:{},
          }));
          if(!response.ok){await response.body?.cancel();throw new Error(`heartbeat_http_${response.status}`);}
          const health=await response.json();
          if(!health.ok||health.service!=='cymonia-sovereign-world')throw new Error('heartbeat_response_invalid');
          if(typeof health.cpu_renewal_token==='string'&&delay>=lastTokenSlot){cpuRenewalToken=health.cpu_renewal_token;lastTokenSlot=delay;}
          console.log('CYMONIA_SCHEDULED_HEARTBEAT',JSON.stringify({
            scheduledTime:controller.scheduledTime,slot:delay/20_000,
            worldMinute:health.world_minute,lagWorldMinutes:health.lag_world_minutes,
          }));
        }catch(error){
          console.error('CYMONIA_SCHEDULED_HEARTBEAT_FAILED',JSON.stringify({slot:delay/20_000,error:String(error?.message||error).slice(0,200)}));
          throw error;
        }
      }));
      if(results.every(result=>result.status==='rejected'))throw new Error('scheduled_world_heartbeat_unavailable');
    })());
  },
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/runtime-heartbeat')return json({ok:false,error:'not_found'},404);
    const id=env.WORLD.idFromName('canonical-v2'),stub=env.WORLD.get(id),routed=new URL(request.url);
    routed.pathname=`/world${url.pathname}`;
    return stub.fetch(new Request(routed,request));
  }
};
