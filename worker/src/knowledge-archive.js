import {bindKnowledgeStorage,bindKnowledgeView} from '../../world/knowledge-storage.js';
import {hash32} from '../../world/rng.js';
import {deflateSync,inflateSync} from './vendor/fflate.js';

const PAGE_UNITS=65536,CACHE_UNITS=524288,DIRTY_UNITS=524288;
const BACKING_BYTES=32*1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder();
const numeric=key=>typeof key==='string'&&/^(0|[1-9][0-9]*)$/.test(key);
// Parsed strings can retain their large Citizen JSON backing buffer in V8.
// Logical indexes must own small strings independently of evicted records.
const ownedString=value=>typeof value==='string'?JSON.parse(JSON.stringify(value)):value;

// Disposable compressed RAM pages back the live graph. The full guarded gzip
// checkpoint remains the only durable authority; cold recovery incurs no scratch SQL.
export class KnowledgeArchive {
  constructor(_sql,{hydrateEntry=()=>{},maxBackingBytes=BACKING_BYTES}={}){
    this.hydrateEntry=hydrateEntry;this.maxBackingBytes=maxBackingBytes;
    this.pages=new Map();this.backingBytes=0;this.nextPageId=1;this.citizenStores=new WeakMap();
    this.cache=new Map();this.cachedCodeUnits=0;this.stores=new Set();
    this.serializedCache=new Map();this.serializedCodeUnits=0;
    this.dirtyCodeUnits=0;this.pageRefs=new Map();this.pageCounts=new Map();this.pageReads=0;
  }
  dispose(){
    this.pages.clear();this.cache.clear();this.serializedCache.clear();this.stores.clear();this.citizenStores=new WeakMap();
    this.pageRefs.clear();this.pageCounts.clear();
    this.backingBytes=0;this.cachedCodeUnits=0;this.serializedCodeUnits=0;this.dirtyCodeUnits=0;
    this.hydrateEntry=()=>{};
  }
  stats(){return {cachedCodeUnits:this.cachedCodeUnits,dirtyCodeUnits:this.dirtyCodeUnits,
    cachedPages:this.cache.size,pageReads:this.pageReads,livePages:this.pageRefs.size,
    serializedCodeUnits:this.serializedCodeUnits,compressedBytes:this.backingBytes,maxCompressedBytes:this.maxBackingBytes,storage:'compressed-ram',sqlRowsRead:0,sqlRowsWritten:0};}
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
    const bytes=inflateSync(encoded.bytes,{out:new Uint8Array(encoded.rawBytes)});
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
      if(old)this.pageRefs.set(old,this.pageRefs.get(old)-1);
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
  releaseStore(store){
    for(const id of store.rows)if(id)this.pageRefs.set(id,this.pageRefs.get(id)-1);
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
    const dead=[...this.pageRefs].filter(([,count])=>count===0).map(([id])=>id);
    if(!dead.length)return;
    for(const id of dead){
      const serialized=this.serializedCache.get(id);
      if(serialized!==undefined){this.serializedCodeUnits-=serialized.length;this.serializedCache.delete(id);}
      this.backingBytes-=this.pages.get(id).bytes.byteLength;this.pages.delete(id);
      const page=this.cache.get(id);if(page){this.cachedCodeUnits-=page.units;this.cache.delete(id);}
      this.pageRefs.delete(id);this.pageCounts.delete(id);}
  }
}

class ArchivedKnowledge {
  constructor(archive){
    this.archive=archive;this.concepts=[];this.active=[];this.entities=[];
    this.rows=[];this.offsets=[];this.lookupIndex=new Map();this.fallbackIds=new Map();this.dirty=new Map();
    this.activeCount=0;this.sourceCount=0;this.sourceCounts=[];this.views=new Map();
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
