import test from 'node:test';
import assert from 'node:assert/strict';
import {KnowledgeArchive} from '../worker/src/knowledge-archive.js';
import {encodeWorldSnapshot,decodeWorldSnapshot} from '../worker/src/persistence.js';

test('checkpoint streams immutable private JSON without rehydrating historical records',async()=>{
 let hydrated=0;const archive=new KnowledgeArchive(null,{hydrateEntry:()=>{hydrated++;}});
 const records=Array.from({length:2400},(_,i)=>({concept:`record:${i}`,active:i%3!==0,confidence:.75,
 provenance:[{kind:'observation',eventId:`event:${i}`,evidence:{entityId:`entity:${i}`,text:'🌍 observed "matter" \\ '+i}}]}));
 const citizen={knowledge:records};archive.attach(citizen);
 const world={version:2,clock:{worldMinute:10},ledgerHead:'head',citizens:[citizen],ledger:[]};
 const {encoded}=await encodeWorldSnapshot(world);
 assert.equal(hydrated,0,'saving historical knowledge must not rebuild its decoded evidence objects');
 const decoded=await decodeWorldSnapshot(encoded);assert.deepEqual(decoded.citizens[0].knowledge,records);
});

test('serialized checkpoints still reject damaged immutable pages',async()=>{
 const archive=new KnowledgeArchive(null);const citizen={knowledge:[{concept:'proof',active:true,provenance:[{eventId:'original'}]}]};archive.attach(citizen);
 archive.pages.values().next().value.checksum^=1;
 await assert.rejects(encodeWorldSnapshot({clock:{worldMinute:0},ledgerHead:'head',citizens:[citizen]}),/knowledge_page_checksum/);
});

test('small parent snapshots use the archive instead of native JSON rehydration',async()=>{
 let hydrated=0;const archive=new KnowledgeArchive(null,{hydrateEntry:()=>{hydrated++;}});
 const records=[{concept:'small',active:true,provenance:[{eventId:'original'}]}],citizen={knowledge:records};archive.attach(citizen);
 const {encoded}=await encodeWorldSnapshot({clock:{worldMinute:0},ledgerHead:'head',citizens:[citizen]});
 assert.equal(hydrated,0);assert.deepEqual((await decodeWorldSnapshot(encoded)).citizens[0].knowledge,records);
});

test('serialized offsets reject corruption even when the page text is cached',async()=>{
 const archive=new KnowledgeArchive(null),citizen={knowledge:[{concept:'a',active:true},{concept:'b',active:false}]};archive.attach(citizen);
 const world={clock:{worldMinute:0},ledgerHead:'head',citizens:[citizen]};await encodeWorldSnapshot(world);
 archive.pages.values().next().value.ends[0]++;
 await assert.rejects(encodeWorldSnapshot(world),/knowledge_page_offsets_invalid/);
});

test('serialized page spans count UTF-16 units and preserve oversized evidence and opaque concepts',async()=>{
 const archive=new KnowledgeArchive(null),records=[{concept:'\uD800:private',active:true,provenance:[{evidence:{text:'🌍'.repeat(350000)}}]}];
 const citizen={knowledge:records};archive.attach(citizen);
 const {encoded}=await encodeWorldSnapshot({clock:{worldMinute:0},ledgerHead:'head',citizens:[citizen]});
 assert.deepEqual((await decodeWorldSnapshot(encoded)).citizens[0].knowledge,records);
 assert.equal(archive.serializedCodeUnits,0,'an oversized immutable page must not enter the text cache');
});

test('loading new immutable pages does not repeatedly scan the entire existing archive',()=>{
 const archive=new KnowledgeArchive(null);let visited=0;const iterate=archive.pageRefs[Symbol.iterator].bind(archive.pageRefs);
 archive.pageRefs[Symbol.iterator]=function*(){for(const row of iterate()){visited++;yield row;}};
 archive.attach({knowledge:Array.from({length:24000},(_,i)=>({concept:`linear:${i}`,active:true,provenance:[{evidence:{entityId:`object:${i}`,text:'observed'.repeat(10)}}]}))});
 assert.ok(archive.pages.size>20);assert.ok(visited<=archive.pages.size*2,`archive startup scanned ${visited} existing pages for ${archive.pages.size} writes`);
});
