import {bindKnowledgeStorage,bindKnowledgeView} from '../../world/knowledge-storage.js';
import {hash32} from '../../world/rng.js';
import {deflateSync,inflateSync} from './vendor/fflate.js';
import {archiveDigest} from './archive-digest.js';

const PAGE_UNITS=65536,CACHE_UNITS=524288,DIRTY_UNITS=524288;
const BACKING_BYTES=32*1024*1024;
const BIN_BYTES=1024*1024,BIN_CACHE_BYTES=8*1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder();
const numeric=key=>typeof key==='string'&&/^(0|[1-9][0-9]*)$/.test(key);
// Parsed strings can retain their large Citizen JSON backing buffer in V8.
// Logical indexes must own small strings independently of evicted records.
const ownedString=value=>typeof value==='string'?JSON.parse(JSON.stringify(value)):value;
const undefinedConcepts=concepts=>concepts.flatMap((value,index)=>value===undefined?[index]:[]);
function restoreAbsentConcepts(concepts,indices=[]){
  if(!Array.isArray(concepts)||!Array.isArray(indices))throw new Error('knowledge_absent_concept_mask_invalid');
  for(const index of indices){if(!Number.isSafeInteger(index)||index<0||index>=concepts.length||concepts[index]!==null)
    throw new Error('knowledge_absent_concept_mask_invalid');concepts[index]=undefined;}
}
// Keep the existing array interface while owning compact numeric storage.
// Cold restore owns exactly its existing rows; append growth adds at most half
// a column of spare capacity instead of duplicating all mature-world indices.
function indexColumn(source=[],boolean=false){
  let length=source.length,capacity=Math.max(64,length);
  let data=boolean?new Uint8Array(capacity):new Uint32Array(capacity);
  for(let i=0;i<length;i++){
    if(boolean?typeof source[i]!=='boolean':!Number.isSafeInteger(source[i])||source[i]<0||source[i]>=0xffffffff)throw new Error('knowledge_index_value_invalid');
    data[i]=boolean?Number(source[i]):source[i];
  }
  return new Proxy([],{
    get(target,key,receiver){if(key==='length')return length;
      if(key==='toJSON')return ()=>Array.from(data.subarray(0,length),boolean?Boolean:undefined);
      if(numeric(key)){const index=Number(key);return index<length?(boolean?Boolean(data[index]):data[index]):undefined;}
      return Reflect.get(target,key,receiver);},
    has(target,key){return numeric(key)?Number(key)<length:Reflect.has(target,key);},
    ownKeys(){return Array.from({length},(_,i)=>String(i)).concat('length');},
    getOwnPropertyDescriptor(target,key){return numeric(key)&&Number(key)<length?
      {value:undefined,writable:true,enumerable:true,configurable:true}:Reflect.getOwnPropertyDescriptor(target,key);},
    set(target,key,value){
      if(key==='length'){if(value!==length)throw new Error('knowledge_index_length_mutation');return true;}
      if(!numeric(key))throw new Error('knowledge_index_mutation');const index=Number(key);
      if(boolean?typeof value!=='boolean':!Number.isSafeInteger(value)||value<0||value>=0xffffffff)throw new Error('knowledge_index_value_invalid');
      if(index>=capacity){capacity=Math.max(Math.ceil(capacity*1.5),index+1);const next=boolean?new Uint8Array(capacity):new Uint32Array(capacity);next.set(data);data=next;}
      data[index]=boolean?Number(Boolean(value)):value;length=Math.max(length,index+1);return true;
    }
  });
}

// Immutable compressed pages are packed once into durable bins. The guarded
// checkpoint owns the bin descriptors and logical order; caches are disposable.
export class KnowledgeArchive {
  constructor(sql,{hydrateEntry=()=>{},maxBackingBytes=BACKING_BYTES,maxBinCacheBytes=BIN_CACHE_BYTES}={}){
    this.sql=sql;this.bins=new Map();this.binCache=new Map();this.binCacheBytes=0;this.maxBinCacheBytes=maxBinCacheBytes;
    this.sqlRowsRead=0;this.sqlRowsWritten=0;
    this.hydrateEntry=hydrateEntry;this.maxBackingBytes=maxBackingBytes;
    this.pages=new Map();this.backingBytes=0;this.nextPageId=1;this.citizenStores=new WeakMap();
    this.cache=new Map();this.cachedCodeUnits=0;this.stores=new Set();
    this.serializedCache=new Map();this.serializedCodeUnits=0;
    this.dirtyCodeUnits=0;this.pageRefs=new Map();this.pageCounts=new Map();this.pageReads=0;
    this.deadPages=new Set();
  }
  dispose(){
    this.pages.clear();this.cache.clear();this.serializedCache.clear();this.stores.clear();this.citizenStores=new WeakMap();
    this.pageRefs.clear();this.pageCounts.clear();
    this.deadPages.clear();
    this.bins.clear();this.binCache.clear();this.binCacheBytes=0;
    this.backingBytes=0;this.cachedCodeUnits=0;this.serializedCodeUnits=0;this.dirtyCodeUnits=0;
    this.hydrateEntry=()=>{};
  }
  stats(){return {cachedCodeUnits:this.cachedCodeUnits,dirtyCodeUnits:this.dirtyCodeUnits,
    cachedPages:this.cache.size,pageReads:this.pageReads,livePages:this.pageRefs.size,
    serializedCodeUnits:this.serializedCodeUnits,compressedBytes:this.backingBytes+this.binCacheBytes,
    pendingCompressedBytes:this.backingBytes,cachedBinBytes:this.binCacheBytes,archivedCompressedBytes:[...this.bins.values()].reduce((n,b)=>n+b.size,0),
    maxCompressedBytes:this.maxBackingBytes,storage:this.sql?'packed-sqlite':'compressed-ram',sqlRowsRead:this.sqlRowsRead,sqlRowsWritten:this.sqlRowsWritten};}
  readBin(id){
    let bytes=this.binCache.get(id);
    if(bytes){this.binCache.delete(id);this.binCache.set(id,bytes);return bytes;}
    const descriptor=this.bins.get(id);
    if(!descriptor)throw new Error('knowledge_bin_descriptor_missing');
    let row;
    try{row=[...this.sql.exec('SELECT data FROM knowledge_bins WHERE id=?',id)][0];this.sqlRowsRead++;}
    catch(error){throw new Error('knowledge_bin_load_failed',{cause:error});}
    if(!row)throw new Error('knowledge_bin_missing');
    bytes=new Uint8Array(row.data);
    if(bytes.length!==descriptor.size||archiveDigest(bytes)!==descriptor.sha256)throw new Error('knowledge_bin_integrity');
    if(bytes.length<=this.maxBinCacheBytes){
      this.binCache.set(id,bytes);this.binCacheBytes+=bytes.length;
      while(this.binCacheBytes>this.maxBinCacheBytes){const first=this.binCache.keys().next().value;
        this.binCacheBytes-=this.binCache.get(first).length;this.binCache.delete(first);}
    }
    return bytes;
  }
  async verifyBacking(yieldRuntime=async()=>{}){
    for(const id of this.referencedBins()){this.readBin(id);await yieldRuntime();}
  }
  referencedBins(){return [...new Set([...this.pages.values()].filter(p=>p.binId!=null).map(p=>p.binId))];}
  stagedBinCount(){
    this.flush();let count=0,size=0;
    for(const p of this.pages.values())if(p.bytes){if(size&&size+p.bytes.length>BIN_BYTES){count++;size=0;}
      size+=p.bytes.length;if(size>=BIN_BYTES){count++;size=0;}}
    return count+(size?1:0);
  }
  async stageBins(stage,yieldRuntime=async()=>{}){
    this.flush();let items=[],size=0;
    const flush=async()=>{
      if(!items.length)return;
      const data=new Uint8Array(size);let offset=0;
      for(const [,page] of items){data.set(page.bytes,offset);offset+=page.bytes.length;}
      const sha256=archiveDigest(data),id=await stage(data,sha256);
      this.bins.set(id,{id,size:data.length,sha256});this.sqlRowsWritten++;
      offset=0;
      for(const [,page] of items){const length=page.bytes.length;this.backingBytes-=length;
        delete page.bytes;page.binId=id;page.offset=offset;page.length=length;offset+=length;}
      items=[];size=0;await yieldRuntime();
    };
    for(const item of this.pages)if(item[1].bytes){const length=item[1].bytes.length;
      if(size&&size+length>BIN_BYTES)await flush();
      if(length>1_500_000)throw new Error('knowledge_bin_exceeds_row_limit');
      items.push(item);size+=length;if(size>=BIN_BYTES)await flush();}
    await flush();
  }
  readPage(id){
    if(this.serializedCache.size){this.serializedCache.clear();this.serializedCodeUnits=0;}
    let page=this.cache.get(id);
    if(page){this.cache.delete(id);this.cache.set(id,page);return page.records;}
    const text=this.pageText(id);
    const records=JSON.parse(text);
    if(!Array.isArray(records))throw new Error('knowledge_page_invalid');
    for(const entry of records)this.hydrateEntry(entry);
    page={records,units:text.length};this.pageReads++;
    // A single exceptionally large record is read without retaining its page.
    if(page.units<=CACHE_UNITS){
      this.cache.set(id,page);this.cachedCodeUnits+=page.units;
      while(this.cachedCodeUnits>CACHE_UNITS||this.cache.size>8){const first=this.cache.keys().next().value;
        this.cachedCodeUnits-=this.cache.get(first).units;this.cache.delete(first);}
    }
    return records;
  }
  pageText(id){
    const encoded=this.pages.get(id);
    if(!encoded)throw new Error('knowledge_page_missing');
    // Supply a bounded output buffer: malformed data cannot inflate unboundedly.
    const compressed=encoded.bytes||this.readBin(encoded.binId).subarray(encoded.offset,encoded.offset+encoded.length);
    const bytes=inflateSync(compressed,{out:new Uint8Array(encoded.rawBytes)});
    const text=decoder.decode(bytes);
    if(hash32(text)!==encoded.checksum)throw new Error('knowledge_page_checksum');
    return text;
  }
  readSerializedPage(id){
    let text=this.serializedCache.get(id);
    const page=this.pages.get(id);
    if(!page)throw new Error('knowledge_page_missing');
    const cached=text!==undefined;
    if(cached){this.serializedCache.delete(id);this.serializedCache.set(id,text);}
    else{text=this.pageText(id);this.pageReads++;}
    const ends=page.ends;
    if(hash32(ends.join(','))!==page.endsChecksum||ends.length!==page.concepts.length||page.activeBits.length!==Math.ceil(ends.length/8)||
      !ends.length||ends[ends.length-1]!==text.length-1||text[0]!=='['||text.at(-1)!==']')throw new Error('knowledge_page_offsets_invalid');
    let start=1;
    for(const end of ends){if(end<=start||end>=text.length)throw new Error('knowledge_page_offsets_invalid');start=end+1;}
    if(!cached&&text.length<=CACHE_UNITS){
      this.serializedCache.set(id,text);this.serializedCodeUnits+=text.length;
      while(this.serializedCodeUnits>CACHE_UNITS||this.serializedCache.size>8){const first=this.serializedCache.keys().next().value;
        this.serializedCodeUnits-=this.serializedCache.get(first).length;this.serializedCache.delete(first);}
    }
    return text;
  }
  beginSerialization(){
    // A checkpoint needs the immutable text, not a second graph of decoded evidence.
    this.cache.clear();this.cachedCodeUnits=0;
  }
  recordUnits(id,offset){
    const ends=this.pages.get(id)?.ends;
    if(!ends||!Number.isInteger(offset)||offset<0||offset>=ends.length)throw new Error('knowledge_page_offsets_invalid');
    return ends[offset]-(offset?ends[offset-1]+1:1);
  }
  write(records,handles){
    const text=`[${records.join(',')}]`;
    const input=encoder.encode(text),bytes=deflateSync(input,{level:1}).slice();
    this.releaseDeadPages();
    if(this.backingBytes+bytes.byteLength>this.maxBackingBytes)throw new Error('knowledge_compressed_capacity_exceeded');
    const id=this.nextPageId++;
    const ends=new Uint32Array(records.length),activeBits=new Uint8Array(Math.ceil(records.length/8));
    let end=1;
    const concepts=handles.map(({store,index},offset)=>{
      end+=records[offset].length;ends[offset]=end;end++;
      if(store.active[index])activeBits[offset>>3]|=1<<(offset&7);
      return store.concepts[index];
    });
    this.pages.set(id,{bytes,rawBytes:input.byteLength,checksum:hash32(text),ends,endsChecksum:hash32(ends.join(',')),concepts,activeBits});
    this.backingBytes+=bytes.byteLength;
    this.pageRefs.set(id,handles.length);
    this.pageCounts.set(id,handles.length);
    for(let offset=0;offset<handles.length;offset++){
      const {store,index}=handles[offset],old=store.rows[index];
      if(old)this.releasePage(old);
      store.rows[index]=id;store.offsets[index]=offset;
      const pending=store.dirty.get(index);
      if(pending){this.dirtyCodeUnits-=pending.units;store.dirty.delete(index);}
    }
  }
  appendBatch(items){
    let records=[],handles=[],units=2;
    const flush=()=>{if(records.length)this.write(records,handles);records=[];handles=[];units=2;};
    for(const item of items){const text=JSON.stringify(item.entry);
      // Bound transient inflation per record. Oversized records fail closed;
      // private evidence is never trimmed and the full checkpoint stays intact.
      if(text.length>500_000&&encoder.encode(text).length>1_500_000)throw new Error('knowledge_record_exceeds_page_limit');
      if(units+text.length+1>PAGE_UNITS)flush();
      records.push(text);handles.push(item);units+=text.length+1;
      if(units>=PAGE_UNITS)flush();
    }
    flush();
  }
  attach(citizen){
    if(citizen.knowledge?.runtimeKnowledgeArchive===this)return citizen.knowledge;
    if(['knowledge-packed-v1','knowledge-packed-v2'].includes(citizen.knowledge?.format)){
      try{return this.restore(citizen);}
      catch(error){if(String(error?.message||error).startsWith('knowledge_'))throw error;
        throw new Error('knowledge_checkpoint_descriptor_invalid',{cause:error});}
    }
    if(citizen.knowledge!=null&&!Array.isArray(citizen.knowledge))throw new Error('knowledge_format_invalid');
    const source=citizen.knowledge||[],store=new ArchivedKnowledge(this);
    this.stores.add(store);
    try{
      this.appendBatch((function*(){for(let index=0;index<source.length;index++){
        const entry=source[index];store.indexEntry(index,entry);yield {store,index,entry};
      }})());
    }catch(error){this.releaseStore(store);throw error;}
    const old=this.citizenStores.get(citizen);
    citizen.knowledge=store.array;this.citizenStores.set(citizen,store);
    if(old)this.releaseStore(old);
    return store.array;
  }
  restore(citizen){
    const saved=citizen.knowledge,store=new ArchivedKnowledge(this);
    restoreAbsentConcepts(saved.concepts,saved.undefinedConcepts);
    const legacy=saved.format==='knowledge-packed-v1',legacyPages=new Map();
    if(!this.sql)throw new Error('knowledge_packed_storage_unavailable');
    for(const b of saved.bins){
      if(!/^[0-9a-f]{64}$/.test(b.id)||b.id!==b.sha256||!Number.isInteger(b.size)||b.size<1||b.size>1_500_000)throw new Error('knowledge_bin_descriptor_invalid');
      const prior=this.bins.get(b.id);
      if(prior&&(prior.sha256!==b.sha256||prior.size!==b.size))throw new Error('knowledge_bin_descriptor_conflict');
      this.bins.set(b.id,b);
    }
    for(const p of saved.pages){
      if(legacy){restoreAbsentConcepts(p.concepts,p.undefinedConcepts);legacyPages.set(p.id,p.concepts);}
      const {id,binId,offset,length,rawBytes,checksum,ends,endsChecksum,concepts,activeBits}=p,bin=this.bins.get(binId);
      if(!Number.isSafeInteger(id)||id<1||!bin||!Number.isInteger(offset)||offset<0||!Number.isInteger(length)||length<1||offset+length>bin.size||
        !Number.isInteger(rawBytes)||rawBytes<2||rawBytes>1_500_002||!Array.isArray(ends)||legacy&&(!Array.isArray(concepts)||ends.length!==concepts.length)||
        !Array.isArray(activeBits)||activeBits.length!==Math.ceil(ends.length/8)||hash32(ends.join(','))!==endsChecksum)throw new Error('knowledge_page_descriptor_invalid');
      const prior=this.pages.get(id);
      if(prior&&(prior.binId!==binId||prior.offset!==offset||prior.length!==length||prior.checksum!==checksum||prior.endsChecksum!==endsChecksum))throw new Error('knowledge_page_descriptor_conflict');
      if(!prior){this.pages.set(id,{binId,offset,length,rawBytes,checksum,ends:new Uint32Array(ends),endsChecksum,concepts:new Array(ends.length),activeBits:new Uint8Array(activeBits)});
        this.pageRefs.set(id,0);this.pageCounts.set(id,ends.length);}
      this.nextPageId=Math.max(this.nextPageId,id+1);
    }
    const n=saved.concepts.length;
    for(const field of ['active','entities','rows','offsets','sourceCounts'])if(!Array.isArray(saved[field])||saved[field].length!==n)throw new Error('knowledge_index_invalid');
    store.concepts=saved.concepts.map(ownedString);
    store.entities=saved.entities.map(value=>Array.isArray(value)?value.map(ownedString):ownedString(value));
    for(const field of ['rows','offsets','sourceCounts'])store[field]=indexColumn(saved[field]);
    store.active=indexColumn(saved.active,true);
    store.fallbackIds=new Map(saved.fallbackIds.map(([index,id])=>[index,ownedString(id)]));
    for(let i=0;i<n;i++){
      const page=this.pages.get(store.rows[i]),offset=store.offsets[i];
      if(!page||!Number.isInteger(offset)||offset<0||offset>=page.ends.length||legacy&&legacyPages.get(store.rows[i])[offset]!==store.concepts[i]||
        Boolean(page.activeBits[offset>>3]&(1<<(offset&7)))!==store.active[i]||!Number.isSafeInteger(store.sourceCounts[i])||store.sourceCounts[i]<0)throw new Error('knowledge_index_record_mismatch');
      if(this.pageRefs.get(store.rows[i])&&Object.hasOwn(page.concepts,offset)&&page.concepts[offset]!==store.concepts[i])throw new Error('knowledge_index_record_mismatch');
      page.concepts[offset]=store.concepts[i];
      this.pageRefs.set(store.rows[i],this.pageRefs.get(store.rows[i])+1);
      store.sourceCount+=store.sourceCounts[i];if(store.active[i]){store.activeCount++;
        if(!store.lookupIndex.has(store.concepts[i]))store.lookupIndex.set(store.concepts[i],i);}
    }
    this.stores.add(store);this.citizenStores.set(citizen,store);citizen.knowledge=store.array;return store.array;
  }
  releaseStore(store){
    for(const id of store.rows)if(id)this.releasePage(id);
    for(const pending of store.dirty.values())this.dirtyCodeUnits-=pending.units;
    this.stores.delete(store);this.releaseDeadPages();
  }
  flush(){
    const archive=this;
    this.appendBatch((function*(){for(const store of archive.stores)
      for(const [index,pending] of store.dirty)yield {store,index,entry:pending.entry};})());
  }
  reclaim(){
    // RAM handles describe every live record. GC runs synchronously between
    // mutations, never while the checkpoint stream is reading these pages.
    const fragmented=new Set([...this.pageRefs].filter(([id,count])=>count>0&&count<this.pageCounts.get(id)/2).map(([id])=>id));
    if(fragmented.size){
      const archive=this;
      this.appendBatch((function*(){for(const store of archive.stores)
        for(let index=0;index<store.rows.length;index++)if(fragmented.has(store.rows[index]))
          yield {store,index,entry:store.raw(index)};})());
    }
    this.releaseDeadPages();
  }
  releaseDeadPages(){
    const dead=this.deadPages;
    if(!dead.size)return;
    for(const id of dead){
      const serialized=this.serializedCache.get(id);
      if(serialized!==undefined){this.serializedCodeUnits-=serialized.length;this.serializedCache.delete(id);}
      this.backingBytes-=this.pages.get(id).bytes?.byteLength||0;this.pages.delete(id);
      const page=this.cache.get(id);if(page){this.cachedCodeUnits-=page.units;this.cache.delete(id);}
      this.pageRefs.delete(id);this.pageCounts.delete(id);}
    dead.clear();
  }
  releasePage(id){
    const remaining=this.pageRefs.get(id)-1;this.pageRefs.set(id,remaining);
    if(remaining===0)this.deadPages.add(id);
  }
}

class ArchivedKnowledge {
  constructor(archive){
    this.archive=archive;this.concepts=[];this.active=indexColumn([],true);this.entities=[];
    this.rows=indexColumn();this.offsets=indexColumn();this.lookupIndex=new Map();this.fallbackIds=new Map();this.dirty=new Map();
    this.activeCount=0;this.sourceCount=0;this.sourceCounts=indexColumn();this.views=new Map();
    const store=this;
    this.array=bindKnowledgeStorage(new Proxy([],{
      get(target,key,receiver){
        if(key==='runtimeKnowledgeArchive')return archive;
        if(key==='length')return store.concepts.length;
        if(numeric(key))return Number(key)<store.concepts.length?store.view(Number(key)):undefined;
        if(key==='push')return (...entries)=>{for(const entry of entries)store.replace(store.concepts.length,entry);return store.concepts.length;};
        return Reflect.get(target,key,receiver);
      },
      has(target,key){return numeric(key)?Number(key)<store.concepts.length:Reflect.has(target,key);},
      ownKeys(){return [...store.concepts.keys()].map(String).concat('length');},
      getOwnPropertyDescriptor(target,key){return numeric(key)&&Number(key)<store.concepts.length?
        {value:undefined,writable:true,enumerable:true,configurable:true}:Reflect.getOwnPropertyDescriptor(target,key);},
      set(target,key,value){
        if(numeric(key)){store.replace(Number(key),value);return true;}
        if(key==='length'&&value===store.concepts.length)return true;
        throw new Error('knowledge_archive_array_mutation_unsupported');
      }
    }),store);
  }
  checkpointValue(){
    if(this.dirty.size)throw new Error('knowledge_checkpoint_unflushed');
    const ids=[...new Set(this.rows)],bins=new Set();
    const pages=ids.map(id=>{const p=this.archive.pages.get(id);
      if(!p||p.bytes||p.binId==null)throw new Error('knowledge_checkpoint_unstaged');
      bins.add(p.binId);return {id,binId:p.binId,offset:p.offset,length:p.length,rawBytes:p.rawBytes,checksum:p.checksum,
        ends:[...p.ends],endsChecksum:p.endsChecksum,activeBits:[...p.activeBits]};});
    return {format:'knowledge-packed-v2',concepts:this.concepts,undefinedConcepts:undefinedConcepts(this.concepts),active:this.active,entities:this.entities,
      rows:this.rows,offsets:this.offsets,sourceCounts:this.sourceCounts,fallbackIds:[...this.fallbackIds],pages,
      bins:[...bins].map(id=>this.archive.bins.get(id))};
  }
  indexEntry(index,entry){
    const was=this.active[index],concept=this.concepts[index];
    if(was)this.activeCount--;
    this.concepts[index]=ownedString(entry.concept);this.active[index]=entry.active!==false;
    if(!entry.concept&&entry.id)this.fallbackIds.set(index,ownedString(entry.id));else this.fallbackIds.delete(index);
    const ids=[...new Set((entry.provenance||[]).map(source=>source.evidence?.entityId).filter(Boolean))].map(ownedString);
    this.entities[index]=ids.length>1?ids:ids[0]??null;
    const sources=entry.provenance?.length||0;
    this.sourceCount+=sources-(this.sourceCounts[index]||0);this.sourceCounts[index]=sources;
    if(this.active[index])this.activeCount++;
    if(concept!==undefined&&this.lookupIndex.get(concept)===index){
      this.lookupIndex.delete(concept);
      if(concept!==entry.concept||!this.active[index]){
        const replacement=this.concepts.findIndex((id,i)=>id===concept&&this.active[i]);
        if(replacement>=0)this.lookupIndex.set(concept,replacement);
      }
    }
    if(this.active[index]&&(!this.lookupIndex.has(entry.concept)||index<this.lookupIndex.get(entry.concept)))this.lookupIndex.set(this.concepts[index],index);
  }
  raw(index){
    const pending=this.dirty.get(index);if(pending)return pending.entry;
    const entry=this.archive.readPage(this.rows[index])[this.offsets[index]];
    if(!entry||entry.concept!==this.concepts[index]||(entry.active!==false)!==this.active[index])
      throw new Error('knowledge_page_record_mismatch');
    return entry;
  }
  lookup(concept){
    const index=this.lookupIndex.get(concept);
    if(index===undefined)return null;
    return this.view(index);
  }
  has(concept){return this.lookupIndex.has(concept);}
  anyConcept(concept){return this.concepts.some((id,i)=>(id||this.fallbackIds.get(i))===concept);}
  replace(index,entry){
    if(index>this.concepts.length)throw new Error('knowledge_archive_sparse_array');
    this.archive.hydrateEntry(entry);
    const old=this.dirty.get(index);
    const units=JSON.stringify(entry).length;
    this.archive.dirtyCodeUnits+=units-(old?.units||0);
    this.dirty.set(index,{entry,units});this.indexEntry(index,entry);
    if(this.archive.dirtyCodeUnits>=DIRTY_UNITS){this.archive.flush();this.archive.reclaim();}
  }
  change(index,path,key,value){
    // Clone only the changed record. Frozen evidence remains shared; its
    // immutability is part of the existing Citizen evidence contract.
    const raw=this.raw(index),copy=structuredClone(raw);
    let object=copy;for(const part of path)object=object[part];
    object[key]=value;this.replace(index,copy);
  }
  view(index){
    let view=this.views.get(index);if(view)return view;
    const store=this;
    function facade(path){
      const read=()=>{let value=store.raw(index);for(const part of path)value=value[part];return value;};
      const value=path.length?read():{};if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
      const target=Array.isArray(value)?[]:{};
      return bindKnowledgeView(new Proxy(target,{
        get(_target,key){if(!path.length&&key==='concept')return store.concepts[index];
          const object=read(),item=object[key];
          if(typeof item==='function')return item;
          if(item&&typeof item==='object')return facade([...path,key]);return item;},
        set(_target,key,value){store.change(index,path,key,value);return true;},
        has(_target,key){return key in read();},
        ownKeys(){return Reflect.ownKeys(read());},
        getOwnPropertyDescriptor(_target,key){
          if(Array.isArray(target)&&key==='length')return Reflect.getOwnPropertyDescriptor(target,key);
          const d=Object.getOwnPropertyDescriptor(read(),key);return d?{...d,configurable:true}:undefined;
        }
      }),read);
    }
    view=facade([]);this.views.set(index,view);
    if(this.views.size>64)this.views.delete(this.views.keys().next().value);
    return view;
  }
  recent(limit){const entries=[];for(let i=this.concepts.length-1;i>=0&&entries.length<limit;i--)
    if(this.active[i])entries.push(this.view(i));return entries.reverse();}
  activeConcepts(){return this.concepts.filter((_,i)=>this.active[i]);}
  forEntity(id){const entries=[];for(let i=0;i<this.entities.length;i++)if(this.active[i]&&
    (this.entities[i]===id||Array.isArray(this.entities[i])&&this.entities[i].includes(id)))entries.push(this.view(i));return entries;}
  *serializedRecords(){
    // Group a bounded logical window by physical page, then emit original order.
    // Cross-Citizen dirty flushes otherwise cause repeated inflation on every record.
    this.archive.beginSerialization();
    for(let start=0;start<this.concepts.length;){
      let end=start,units=0;
      while(end<this.concepts.length&&end-start<2048){
        const size=this.dirty.get(end)?.units??this.archive.recordUnits(this.rows[end],this.offsets[end]);
        if(end>start&&units+size>1048576)break;
        units+=size;end++;
      }
      const strings=new Array(end-start),groups=new Map();
      for(let i=start;i<end;i++){
        const pending=this.dirty.get(i);
        if(pending){strings[i-start]=JSON.stringify(pending.entry);continue;}
        const id=this.rows[i];let indexes=groups.get(id);
        if(!indexes)groups.set(id,indexes=[]);indexes.push(i);
      }
      for(const [id,indexes] of groups){
        const text=this.archive.readSerializedPage(id),page=this.archive.pages.get(id);
        for(const i of indexes){
          const offset=this.offsets[i],end=page.ends[offset],begin=offset?page.ends[offset-1]+1:1;
          const active=Boolean(page.activeBits[offset>>3]&(1<<(offset&7)));
          if(page.concepts[offset]!==this.concepts[i]||active!==this.active[i])throw new Error('knowledge_page_record_mismatch');
          // V8 slices otherwise pin every inflated page touched by a sparse window.
          strings[i-start]=ownedString(text.slice(begin,end));
        }
      }
      yield* strings;start=end;
    }
  }
  *records(){for(let i=0;i<this.concepts.length;i++)yield this.raw(i);}
}
