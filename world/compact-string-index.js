// A disposable exact lookup directory into an existing canonical array. String
// keys stay in that array; buckets retain only their numeric positions. Callers
// delete an indexed key before changing its canonical value.
const DELETED=0xffffffff;
function hash(value){
  let h=2166136261;
  for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619);
  return h>>>0;
}
export class CompactStringIndex {
  constructor(entries,expectedSize=0){
    this.entries=entries;this.table=new Uint32Array(16);this.size=0;this.used=0;this.other=new Map();
    while(this.table.length*.65<expectedSize)this.table=new Uint32Array(this.table.length*2);
  }
  slot(key){
    const mask=this.table.length-1;let slot=hash(key)&mask,deleted=-1;
    for(;;slot=(slot+1)&mask){
      const code=this.table[slot];
      if(!code)return {slot:deleted<0?slot:deleted,found:false};
      if(code===DELETED){if(deleted<0)deleted=slot;}
      else if(this.entries[code-1]===key)return {slot,found:true};
    }
  }
  get(key){
    if(typeof key!=='string')return this.other.get(key);
    const {slot,found}=this.slot(key);return found?this.table[slot]-1:undefined;
  }
  has(key){return typeof key==='string'?this.slot(key).found:this.other.has(key);}
  set(key,index){
    if(typeof key!=='string'){this.other.set(key,index);return this;}
    if(!Number.isInteger(index)||index<0||index>=DELETED-1||this.entries[index]!==key)
      throw new Error('compact_string_index_position_invalid');
    if((this.used+1)>this.table.length*.65)this.resize(this.size<this.table.length*.3?this.table.length:this.table.length*2);
    const {slot,found}=this.slot(key);
    if(!found){this.size++;if(!this.table[slot])this.used++;}
    this.table[slot]=index+1;return this;
  }
  delete(key){
    if(typeof key!=='string')return this.other.delete(key);
    const {slot,found}=this.slot(key);if(!found)return false;
    this.table[slot]=DELETED;this.size--;return true;
  }
  resize(length){
    const old=this.table;this.table=new Uint32Array(length);this.size=0;this.used=0;
    for(const code of old)if(code&&code!==DELETED)this.set(this.entries[code-1],code-1);
  }
}
