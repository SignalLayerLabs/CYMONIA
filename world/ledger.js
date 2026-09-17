import {stableId,hash32} from './rng.js';
function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;return JSON.stringify(value);}
export function chainHash(value){return hash32(canonical(value)).toString(16).padStart(8,'0');}
function ledgerBaseSeq(world){return Number.isInteger(world.ledgerBaseSeq)?world.ledgerBaseSeq:0;}
function ledgerBaseHash(world){return typeof world.ledgerBaseHash==='string'&&world.ledgerBaseHash?world.ledgerBaseHash:'GENESIS';}
export function appendEvent(world,type,actorId,payload={},causes=[],at=world.clock.worldMinute){
  const seq=ledgerBaseSeq(world)+world.ledger.length;
  const previousHash=world.ledger.length?world.ledger[world.ledger.length-1].hash:ledgerBaseHash(world);
  const base={seq,worldMinute:Math.floor(at),type,actorId:actorId??'world',payload,causes:[...causes],previousHash};
  const event={id:stableId('evt',world.worldId,seq,type,actorId,canonical(payload)),...base};
  event.hash=chainHash(event);
  world.ledger.push(event);
  world.ledgerHead=event.hash;
  return event;
}
export function compactLedger(world,maxEvents=4096){
  const keep=Math.max(1,Math.floor(Number(maxEvents)||1));
  if(!Array.isArray(world.ledger)||world.ledger.length<=keep)return 0;
  const dropCount=world.ledger.length-keep;
  const retained=world.ledger.slice(dropCount);
  world.ledgerBaseSeq=retained[0].seq;
  world.ledgerBaseHash=retained[0].previousHash;
  world.ledger=retained;
  return dropCount;
}
export function verifyLedger(world){
  if(!Array.isArray(world.ledger))return false;
  let expectedSeq=ledgerBaseSeq(world),prev=ledgerBaseHash(world);
  for(const e of world.ledger){
    if(e.seq!==expectedSeq||e.previousHash!==prev)return false;
    const copy={...e};delete copy.hash;
    if(chainHash(copy)!==e.hash)return false;
    prev=e.hash;expectedSeq++;
  }
  return prev===world.ledgerHead;
}
