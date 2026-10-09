import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeSnapshot,decodeWorldSnapshot} from '../worker/src/persistence.js';
const world={version:2,worldId:'private-world',clock:{worldMinute:40},citizens:[],ledger:[],ledgerHead:'private-head'};
async function sidecar(publicWorld={...world,clock:{worldMinute:30},ledgerHead:'public-head'}){
 return {format:'public-checkpoint-v1',worldId:world.worldId,worldMinute:30,ledgerHead:'public-head',encoded:await encodeSnapshot(JSON.stringify({ok:true,world:publicWorld}))};
}
async function rejects(saved){let installed=false;await assert.rejects(decodeWorldSnapshot(JSON.stringify({...world,checkpointPublicSnapshot:saved}),{onPublicSnapshot(){installed=true;}}),/knowledge_public_checkpoint_invalid/);assert.equal(installed,false);}
test('public checkpoint rejects invalid root shapes, broken gzip and incomplete JSON before installation',async()=>{
 for(const saved of [[],false,42,'invalid',{...(await sidecar()),encoded:'gzip-base64-v1:garbage'},
 {...(await sidecar()),encoded:await encodeSnapshot('{"ok":true,"world":{}')},
 {...(await sidecar()),encoded:await encodeSnapshot('{"ok":false,"world":{}}')},
 {...(await sidecar()),encoded:await encodeSnapshot('{"ok":true,"world":{},"extra":true}')}])await rejects(saved);
});
test('public checkpoint validates the actual encoded identity, time and ledger while retaining a prior public minute',async()=>{
 for(const change of [{worldId:'another-world'},{clock:{worldMinute:31}},{ledgerHead:'another-head'},{version:1}])await rejects(await sidecar({...world,clock:{worldMinute:30},ledgerHead:'public-head',...change}));
 const saved=await sidecar();let installed;
 const restored=await decodeWorldSnapshot(JSON.stringify({...world,checkpointPublicSnapshot:saved}),{onPublicSnapshot(value){installed=value;}});
 assert.deepEqual(restored,world);assert.deepEqual(installed,saved);
});
