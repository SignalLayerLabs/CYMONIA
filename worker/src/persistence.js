export const FREE_TIER_ROW_WRITE_BUDGET=100_000;
export const ACCOUNT_RESERVE_ROW_WRITE_BUDGET=40_000;
export const SAFE_ROW_WRITE_BUDGET=40_000;
export const EMERGENCY_ROW_WRITE_BUDGET=60_000;
export const SNAPSHOT_ENCODING='gzip-base64-v1';
import {knowledgeStorage,knowledgeSnapshotValue} from '../../world/knowledge-storage.js';

function bytesToBase64(bytes){
  let binary='';
  const step=0x8000;
  for(let i=0;i<bytes.length;i+=step){
    binary+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+step)));
  }
  return btoa(binary);
}

function base64ToBytes(value){
  const binary=atob(value);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}

function recordByteStream(records){
  const encoder=new TextEncoder();
  let source='',offset=0;
  return new ReadableStream({pull(controller){
    const pieces=[];let length=0,done=false;
    while(length<65536){
      if(offset>=source.length){
        const record=records.next();
        if(record.done){done=true;break;}
        source=record.value;offset=0;
      }
      let end=Math.min(source.length,offset+65536-length);
      if(end<source.length&&source.charCodeAt(end-1)>=0xD800&&source.charCodeAt(end-1)<=0xDBFF)end--;
      if(end===offset)break;
      pieces.push(source.slice(offset,end));length+=end-offset;offset=end;
    }
    if(length)controller.enqueue(encoder.encode(pieces.join('')));
    if(done)controller.close();
  }});
}
function snapshotByteStream(serialized){return recordByteStream([String(serialized)][Symbol.iterator]());}

function isSmallJsonRecord(value){
  // Keep the native JSON fast path for ordinary evidence records. Reject
  // large collections before traversing them; nested private arrays still
  // stream without allocating a whole Citizen or memory-array string.
  const pending=[value];let nodes=0,units=0;
  while(pending.length){
    const item=pending.pop();
    if(++nodes>64)return false;
    if(typeof item==='string'){units+=item.length;if(units>8192)return false;}
    else if(item&&typeof item==='object'){
      if(knowledgeStorage(item))return false;
      if(typeof item.toJSON==='function')return false;
      const keys=Object.keys(item);
      if(keys.length>32)return false;
      for(const key of keys){units+=key.length;pending.push(item[key]);}
      if(units>8192)return false;
    }
  }
  return true;
}

function* worldJsonRecords(value,ancestors=new Set(),key=''){
  const archive=knowledgeStorage(value);
  if(archive){yield '[';let first=true;for(const text of archive.serializedRecords()){
    if(!first)yield ',';first=false;yield text;
  }yield ']';return;}
  value=knowledgeSnapshotValue(value);
  if(value&&typeof value.toJSON==='function')value=value.toJSON(key);
  if(!value||typeof value!=='object'){yield JSON.stringify(value)??'null';return;}
  if(isSmallJsonRecord(value)){yield JSON.stringify(value);return;}
  if(ancestors.has(value))throw new TypeError('Circular snapshot JSON');
  ancestors.add(value);
  if(Array.isArray(value)){
    yield '[';
    for(let i=0;i<value.length;i++){
      if(i)yield ',';
      yield* worldJsonRecords(value[i],ancestors,String(i));
    }
    yield ']';
  }else{
    yield '{';let first=true;
    for(const name of Object.keys(value)){
      const item=value[name];
      if(item===undefined||typeof item==='function'||typeof item==='symbol')continue;
      if(!first)yield ',';first=false;
      yield `${JSON.stringify(name)}:`;
      yield* worldJsonRecords(item,ancestors,name);
    }
    yield '}';
  }
  ancestors.delete(value);
}


function appendEncodedText(emitPart,state,text,maxCodeUnits){
  let offset=0;
  while(offset<text.length){
    if(state.value.length>=maxCodeUnits){
      emitPart(state.value);
      state.value='';
    }
    const room=maxCodeUnits-state.value.length;
    const take=Math.min(room,text.length-offset);
    state.value+=text.slice(offset,offset+take);
    offset+=take;
  }
}

function appendBase64Bytes(emitPart,state,bytes,maxCodeUnits){
  // 32766 is divisible by 3, so every non-final block is independently
  // padding-free and can be concatenated into one canonical base64 stream.
  const step=32766;
  for(let offset=0;offset<bytes.length;offset+=step){
    const end=Math.min(bytes.length,offset+step);
    const view=bytes.subarray(offset,end);
    let binary='';
    for(let i=0;i<view.length;i+=0x2000){
      binary+=String.fromCharCode(...view.subarray(i,Math.min(view.length,i+0x2000)));
    }
    appendEncodedText(emitPart,state,btoa(binary),maxCodeUnits);
  }
}

export async function encodeWorldSnapshotParts(world,{
  sealDue=false,
  clock=world.clock,
  ledgerHead=world.ledgerHead,
  maxCodeUnits=256*1024,
  onPart=null,
  onProgress=null,
}={}){
  const limit=Math.max(1024,Math.floor(Number(maxCodeUnits)||256*1024));
  const snapshot={...world,clock:{...clock},ledgerHead};
  if(world.runtime){
    snapshot.runtime={...world.runtime};
    if(world.runtime.neuronBudget)snapshot.runtime.neuronBudget={...world.runtime.neuronBudget};
  }

  let input=recordByteStream(worldJsonRecords(snapshot));
  const digest=sealDue&&typeof crypto.DigestStream==='function'
    ?new crypto.DigestStream('SHA-256')
    :null;
  const digestPromise=digest?.digest;
  digestPromise?.catch(()=>{});
  const writer=digest?.getWriter();
  writer?.closed.catch(()=>{});
  const fallback=[];

  let progressBytes=0;
  if(sealDue||onProgress)input=input.pipeThrough(new TransformStream({
    async transform(chunk,controller){
      if(writer)await writer.write(chunk);
      else if(sealDue)fallback.push(chunk);
      progressBytes+=chunk.byteLength;
      // Bound uninterrupted work by input size, even for highly compressible
      // worlds. Native gzip may otherwise emit no output for many records.
      if(onProgress&&progressBytes>=4*1024*1024){await onProgress();progressBytes=0;}
      controller.enqueue(chunk);
    },
    async flush(){if(writer)await writer.close();}
  }));

  const parts=[];
  let partCount=0;
  const emitPart=part=>{
    if(onPart)onPart(part);
    else parts.push(part);
    partCount++;
  };
  const state={value:`${SNAPSHOT_ENCODING}:`};
  const reader=input.pipeThrough(new CompressionStream('gzip')).getReader();
  let carry=new Uint8Array(0);

  try{
    while(true){
      const item=await reader.read();
      if(item.done)break;
      const chunk=item.value instanceof Uint8Array
        ?item.value
        :new Uint8Array(item.value);
      let bytes;
      if(carry.length){
        bytes=new Uint8Array(carry.length+chunk.length);
        bytes.set(carry,0);
        bytes.set(chunk,carry.length);
      }else bytes=chunk;

      const aligned=bytes.length-(bytes.length%3);
      if(aligned)appendBase64Bytes(emitPart,state,bytes.subarray(0,aligned),limit);
      carry=aligned<bytes.length?bytes.slice(aligned):new Uint8Array(0);
    }
    if(carry.length)appendBase64Bytes(emitPart,state,carry,limit);
  }catch(error){
    await reader.cancel(error).catch(()=>{});
    if(writer)await writer.abort(error).catch(()=>{});
    throw error;
  }finally{
    try{reader.releaseLock();}catch{}
    writer?.releaseLock();
  }

  if(state.value||!partCount)emitPart(state.value);
  if(onProgress)await onProgress();

  let stateSha256=null;
  if(sealDue){
    let hash;
    if(digest)hash=await digestPromise;
    else{
      const bytes=new Uint8Array(fallback.reduce((sum,chunk)=>sum+chunk.byteLength,0));
      let offset=0;
      for(const chunk of fallback){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      hash=await crypto.subtle.digest('SHA-256',bytes);
    }
    stateSha256=[...new Uint8Array(hash)]
      .map(b=>b.toString(16).padStart(2,'0'))
      .join('');
  }

  return {parts,partCount,stateSha256};
}

export async function encodeWorldSnapshot(world,{sealDue=false,clock=world.clock,ledgerHead=world.ledgerHead}={}){
  // Writers are serialized by SovereignWorld. Capture clock and runtime
  // scalars before yielding; stream large arrays one entity at a time.
  const snapshot={...world,clock:{...clock},ledgerHead};
  if(world.runtime){
    snapshot.runtime={...world.runtime};
    if(world.runtime.neuronBudget)snapshot.runtime.neuronBudget={...world.runtime.neuronBudget};
  }
  let input=recordByteStream(worldJsonRecords(snapshot));
  const digest=sealDue&&typeof crypto.DigestStream==='function'?new crypto.DigestStream('SHA-256'):null;
  const digestPromise=digest?.digest;
  // Compression can fail before we await the digest. Observe its rejection
  // immediately while retaining the original promise for error propagation.
  digestPromise?.catch(()=>{});
  const writer=digest?.getWriter();
  writer?.closed.catch(()=>{});
  const fallback=[];
  if(sealDue)input=input.pipeThrough(new TransformStream({
    async transform(chunk,controller){
      if(writer)await writer.write(chunk);else fallback.push(chunk);
      controller.enqueue(chunk);
    },async flush(){if(writer)await writer.close();}
  }));
  // Hash inline rather than teeing: a faster hash consumer must not buffer
  // the entire JSON while the gzip consumer applies backpressure.
  let compressed;
  try{
    compressed=new Uint8Array(await new Response(input.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  }catch(error){
    if(writer)await writer.abort(error).catch(()=>{});
    throw error;
  }finally{writer?.releaseLock();}
  let stateSha256=null;
  if(sealDue){
    let hash;
    if(digest)hash=await digestPromise;
    else{
      // Node test runtimes lack the Cloudflare streaming digest extension.
      const bytes=new Uint8Array(fallback.reduce((sum,chunk)=>sum+chunk.byteLength,0));
      let offset=0;for(const chunk of fallback){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      hash=await crypto.subtle.digest('SHA-256',bytes);
    }
    stateSha256=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  return {encoded:`${SNAPSHOT_ENCODING}:${bytesToBase64(compressed)}`,stateSha256};
}

export async function sha256Snapshot(serialized){
  let digest;
  if(typeof crypto.DigestStream==='function'){
    const stream=new crypto.DigestStream('SHA-256');
    const digestPromise=stream.digest;
    digestPromise.catch(()=>{});
    await snapshotByteStream(serialized).pipeTo(stream);
    digest=await digestPromise;
  }else{
    // Node's unit-test Web Crypto has no Cloudflare DigestStream extension.
    digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized));
  }
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export async function encodeSnapshot(serialized){
  const input=snapshotByteStream(serialized);
  const compressedStream=input.pipeThrough(new CompressionStream('gzip'));
  const compressed=new Uint8Array(await new Response(compressedStream).arrayBuffer());
  return `${SNAPSHOT_ENCODING}:${bytesToBase64(compressed)}`;
}

export async function decodeSnapshot(encoded){
  const source=String(encoded);
  const prefix=`${SNAPSHOT_ENCODING}:`;
  if(!source.startsWith(prefix))return source;
  const input=new Response(base64ToBytes(source.slice(prefix.length))).body;
  const decompressed=input.pipeThrough(new DecompressionStream('gzip'));
  return new Response(decompressed).text();
}

export function snapshotGzipSize(encoded){
  if(!String(encoded).startsWith(`${SNAPSHOT_ENCODING}:`))return null;
  const tail=base64ToBytes(String(encoded).slice(-12));
  return tail.byteLength>=4?new DataView(tail.buffer).getUint32(tail.byteLength-4,true):null;
}

export async function decodeWorldSnapshot(encoded,{onArrayItem=null}={}){
  // Parse root arrays one entity at a time. A cold wake must never retain the
  // full private JSON string alongside the hydrated canonical object graph.
  const reader=snapshotJsonStream(encoded).pipeThrough(new TextDecoderStream()).getReader();
  const world={};
  let mode='start',key=null,array=null,parts=[],depth=0,quoted=false,escaped=false;
  const fail=()=>{throw new SyntaxError('Invalid snapshot JSON');};
  function finishToken(){
    const text=parts.join('');parts=[];
    if(!text.trim())fail();
    return JSON.parse(text);
  }
  try{
    while(true){
      const {value:chunk,done}=await reader.read();
      if(done)break;
      let start=0;
      for(let i=0;i<chunk.length;i++){
        const c=chunk[i];
        if(mode==='key'||mode==='token'){
          if(quoted){
            if(escaped)escaped=false;
            else if(c==='\\')escaped=true;
            else if(c==='"')quoted=false;
            continue;
          }
          const delimiter=depth===0&&(mode==='key'?c===':':c===','||c===']'||c==='}');
          if(delimiter){
            parts.push(chunk.slice(start,i));start=i+1;
            if(mode==='key'){
              key=finishToken();if(typeof key!=='string')fail();mode='value';
            }else{
              const item=finishToken();
              if(array){const processed=onArrayItem?onArrayItem(key,item):item;
                array.push(processed&&typeof processed.then==='function'?await processed:processed);
                if(c===']'){array=null;mode='after';}else if(c===',')mode='item';else fail();}
              else{Object.defineProperty(world,key,{value:item,writable:true,enumerable:true,configurable:true});mode=c===','?'next':c==='}'?'done':fail();}
            }
            continue;
          }
          if(c==='"')quoted=true;
          else if(c==='['||c==='{')depth++;
          else if(c===']'||c==='}')depth--;
          if(depth<0)fail();
          continue;
        }
        start=i+1;
        if(c===' '||c==='\t'||c==='\r'||c==='\n')continue;
        if(mode==='start'){if(c!=='{')fail();mode='first';}
        else if(mode==='first'||mode==='next'){
          if(c==='}'&&mode==='first'){mode='done';continue;}
          if(c!=='"')fail();mode='key';quoted=true;parts=[];start=i;
        }else if(mode==='value'){
          if(c==='['){array=[];Object.defineProperty(world,key,{value:array,writable:true,enumerable:true,configurable:true});mode='firstItem';}
          else{mode='token';parts=[];depth=0;quoted=false;escaped=false;start=i;i--;}
        }else if(mode==='firstItem'||mode==='item'){
          if(c===']'&&mode==='firstItem'){array=null;mode='after';}
          else{mode='token';parts=[];depth=0;quoted=false;escaped=false;start=i;i--;}
        }else if(mode==='after'){
          if(c===',')mode='next';else if(c==='}')mode='done';else fail();
        }else fail();
      }
      if(mode==='key'||mode==='token')parts.push(chunk.slice(start));
    }
    if(mode!=='done')fail();
    return world;
  }catch(error){await reader.cancel(error).catch(()=>{});throw error;}
  finally{reader.releaseLock();}
}

function compressedSnapshotByteStream(encoded){
  const marker=`${SNAPSHOT_ENCODING}:`;
  const iterator=typeof encoded==='string'?[encoded][Symbol.iterator]():encoded[Symbol.iterator]();
  let source='',offset=0,header='',carry='',ready=false,stopped=false;
  const stop=()=>{if(stopped)return;stopped=true;source='';carry='';iterator.return?.();};
  const stream=new ReadableStream({
    pull(controller){
      try{
        if(stopped){controller.close();return;}
        while(true){
          if(offset>=source.length){
            const next=iterator.next();
            source='';offset=0;
            if(next.done){
              if(!ready||carry.length)throw new SyntaxError('Truncated compressed snapshot');
              controller.close();return;
            }
            if(typeof next.value!=='string')throw new TypeError('Invalid snapshot chunk');
            source=next.value;
          }
          if(!ready){
            const take=Math.min(marker.length-header.length,source.length-offset);
            header+=source.slice(offset,offset+take);offset+=take;
            if(!marker.startsWith(header))throw new SyntaxError('Invalid compressed snapshot header');
            if(header.length<marker.length)continue;
            ready=true;
          }
          const take=Math.min(65536-carry.length,source.length-offset);
          const text=carry+source.slice(offset,offset+take);offset+=take;
          const aligned=text.length-text.length%4;
          carry=text.slice(aligned);
          if(aligned){controller.enqueue(base64ToBytes(text.slice(0,aligned)));return;}
        }
      }catch(error){stop();controller.error(error);}
    },
    cancel(){stop();}
  });
  return {stream,stop};
}

export function snapshotJsonStream(encoded,{prefix='',suffix=''}={}){
  const marker=`${SNAPSHOT_ENCODING}:`;
  const compressed=typeof encoded!=='string'||encoded.startsWith(marker);
  const input=compressed?compressedSnapshotByteStream(encoded):null;
  const body=compressed
    ?input.stream.pipeThrough(new DecompressionStream('gzip'))
    :snapshotByteStream(encoded);
  const reader=body.getReader(),encoder=new TextEncoder();
  let started=false,ended=false;
  return new ReadableStream({
    async pull(controller){
      try{
        if(!started){started=true;if(prefix){controller.enqueue(encoder.encode(prefix));return;}}
        const item=await reader.read();
        if(!item.done){controller.enqueue(item.value);return;}
        ended=true;reader.releaseLock();
        if(suffix)controller.enqueue(encoder.encode(suffix));
        controller.close();
      }catch(error){ended=true;input?.stop();reader.releaseLock();controller.error(error);}
    },
    cancel(reason){if(!ended){ended=true;input?.stop();return reader.cancel(reason).finally(()=>reader.releaseLock());}}
  });
}

export function estimateSnapshotRowWrites({chunkCount,sealDue=false,sealPruneRows=0}){
  const chunks=Math.max(0,Math.floor(Number(chunkCount)||0));
  const pruned=2*Math.max(0,Math.floor(Number(sealPruneRows)||0));
  return chunks+1+1+1+1+(sealDue?4:0)+pruned; // measured workerd costs: seal table/index/count-trigger/sequence=4, delete+count-trigger=2
}

export function selectNewestSnapshot(candidates){
  const valid=(candidates||[]).filter(c=>c?.world&&c.world.version===2&&Array.isArray(c.world.citizens)&&Array.isArray(c.world.ledger)&&Number.isFinite(Number(c.world.clock?.worldMinute)));
  valid.sort((a,b)=>Number(b.world.clock.worldMinute)-Number(a.world.clock.worldMinute)
    ||Number(String(b.source||'').startsWith('manifest:'))-Number(String(a.source||'').startsWith('manifest:'))
    ||Number(b.updatedAt||0)-Number(a.updatedAt||0));
  return valid[0]||null;
}

export function assertMonotonicSnapshot(world,{highWaterMark=null,worldId=null}={}){
  if(!world||world.version!==2||!Array.isArray(world.citizens)||!Array.isArray(world.ledger))throw new Error('sovereign_world_state_invalid');
  const minute=Number(world.clock?.worldMinute);
  if(!Number.isFinite(minute)||minute<0)throw new Error('sovereign_world_clock_invalid');
  if(worldId&&world.worldId!==worldId)throw new Error('sovereign_world_identity_regression');
  if(Number.isFinite(Number(highWaterMark))&&minute<Number(highWaterMark))throw new Error(`sovereign_world_clock_regression:${minute}<${Number(highWaterMark)}`);
  return world;
}

export function nextSnapshotSlot(current){
  return current==='slot-a'?'slot-b':'slot-a';
}

export function nextUtcDayStart(nowMs=Date.now()){
  const d=new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1,0,0,0,0);
}

export function createWriteBudget(day,rowsWritten=0,limit=SAFE_ROW_WRITE_BUDGET){
  return {
    day:String(day),
    rowsWritten:Math.max(0,Math.floor(Number(rowsWritten)||0)),
    limit:Math.min(FREE_TIER_ROW_WRITE_BUDGET,Math.max(0,Math.floor(Number(limit)||0))),
  };
}

export function reserveWriteBudget(budget,rowWrites){
  const cost=Math.max(0,Math.floor(Number(rowWrites)||0));
  const current=createWriteBudget(budget.day,budget.rowsWritten,budget.limit);
  if(current.rowsWritten+cost>current.limit)return {allowed:false,budget:current,cost};
  return {allowed:true,budget:{...current,rowsWritten:current.rowsWritten+cost},cost};
}

export function simulateDay({
  checkpointEverySeconds=60,
  cognitionPersists=0,
  chunkCount=1,
  sealEveryCheckpoints=60,
  alarmEverySeconds=15,
  day='simulation',
  limit=SAFE_ROW_WRITE_BUDGET,
}={}){
  const checkpointCount=Math.floor(86_400/Math.max(1,checkpointEverySeconds));
  let budget=createWriteBudget(day,0,limit);
  let acceptedPersists=0,deferredPersists=0;
  const attempt=(sealDue)=>{
    const cost=estimateSnapshotRowWrites({chunkCount,sealDue});
    const reservation=reserveWriteBudget(budget,cost);
    if(reservation.allowed){budget=reservation.budget;acceptedPersists++;}
    else deferredPersists++;
  };
  for(let i=1;i<=checkpointCount;i++)attempt(sealEveryCheckpoints>0&&i%sealEveryCheckpoints===0);
  for(let i=0;i<Math.max(0,Math.floor(cognitionPersists));i++)attempt(false);
  const alarmRowsWritten=Math.floor(86_400/Math.max(1,alarmEverySeconds));
  const heartbeatDiagnosticRowsWritten=alarmRowsWritten;
  const totalRowsWritten=budget.rowsWritten+alarmRowsWritten+heartbeatDiagnosticRowsWritten;
  return {
    rowsWritten:budget.rowsWritten,
    alarmRowsWritten,
    heartbeatDiagnosticRowsWritten,
    totalRowsWritten,
    freeTierHeadroom:Math.max(0,FREE_TIER_ROW_WRITE_BUDGET-totalRowsWritten),
    acceptedPersists,
    deferredPersists,
    checkpointCount,
    limit:budget.limit
  };
}
