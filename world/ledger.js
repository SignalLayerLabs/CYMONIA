import {stableId,hash32} from './rng.js';
function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;return JSON.stringify(value);}
export function chainHash(value){return hash32(canonical(value)).toString(16).padStart(8,'0');}
export function appendEvent(world,type,actorId,payload={},causes=[],at=world.clock.worldMinute){
  const seq=world.ledger.length;
  const previousHash=seq?world.ledger[seq-1].hash:'GENESIS';
  const base={seq,worldMinute:Math.floor(at),type,actorId:actorId??'world',payload,causes:[...causes],previousHash};
  const event={id:stableId('evt',world.worldId,seq,type,actorId,canonical(payload)),...base};
  event.hash=chainHash(event);
  world.ledger.push(event);
  world.ledgerHead=event.hash;
  return event;
}
export function verifyLedger(world){let prev='GENESIS';for(let i=0;i<world.ledger.length;i++){const e=world.ledger[i];if(e.seq!==i||e.previousHash!==prev)return false;const copy={...e};delete copy.hash;if(chainHash(copy)!==e.hash)return false;prev=e.hash;}return prev===world.ledgerHead;}
