export const FREE_TIER_ROW_WRITE_BUDGET=100_000;
export const SAFE_ROW_WRITE_BUDGET=72_000;
export const EMERGENCY_ROW_WRITE_BUDGET=88_000;
export const SNAPSHOT_ENCODING='gzip-base64-v1';

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

export async function encodeSnapshot(serialized){
  const source=String(serialized);
  const input=new Response(new TextEncoder().encode(source)).body;
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

export function estimateSnapshotRowWrites({chunkCount,sealDue=false,sealPruneRows=0}){
  const chunks=Math.max(0,Math.floor(Number(chunkCount)||0));
  const pruned=Math.max(0,Math.floor(Number(sealPruneRows)||0));
  return chunks+1+1+(sealDue?1:0)+pruned; // chunks + manifest + budget + optional seal/prune
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
  alarmEverySeconds=10,
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
  return {rowsWritten:budget.rowsWritten,alarmRowsWritten,totalRowsWritten:budget.rowsWritten+alarmRowsWritten,acceptedPersists,deferredPersists,checkpointCount,limit:budget.limit};
}
