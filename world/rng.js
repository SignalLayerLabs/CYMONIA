export function hash32(value){let h=2166136261>>>0;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
export function rng(seed){let x=hash32(seed)||0x9e3779b9;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
export function stableId(prefix,...parts){return `${prefix}:${hash32(parts.join('|')).toString(16).padStart(8,'0')}`;}
export function pickDeterministic(list,key){if(!list.length)return null;return list[hash32(key)%list.length];}
