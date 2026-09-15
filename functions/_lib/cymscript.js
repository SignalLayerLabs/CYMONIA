const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const DEFAULT_STRATEGY=Object.freeze({version:1,goal:"build_wealth",risk:"medium",save_rate:0.3,min_liquidity:1000,prefer:["technology","research"],company_threshold:5000,crime:false,mode:"MANUAL"});
export function parseCymScript(source=""){
  const s=String(source).slice(0,8000); const out={...DEFAULT_STRATEGY,prefer:[...DEFAULT_STRATEGY.prefer]};
  const val=(re)=>s.match(re)?.[1];
  const goal=val(/goal\(["']([a-z_]+)["']\)/i); if(goal) out.goal=goal.toLowerCase();
  const risk=val(/risk\(["'](low|medium|high)["']\)/i); if(risk) out.risk=risk.toLowerCase();
  const save=Number(val(/save\((\d+(?:\.\d+)?)\s*%?\)/i)); if(Number.isFinite(save)&&save>=0) out.save_rate=clamp(save>1?save/100:save,0,0.9);
  const liquid=Number(val(/keep\((\d+(?:\.\d+)?)\)/i)); if(Number.isFinite(liquid)&&liquid>=0) out.min_liquidity=clamp(liquid,0,1e9);
  const threshold=Number(val(/company(?:_threshold|\.start_when)\((\d+(?:\.\d+)?)\)/i)); if(Number.isFinite(threshold)&&threshold>0) out.company_threshold=clamp(threshold,100,1e9);
  const pref=val(/prefer\(([^)]+)\)/i); if(pref){ const xs=[...pref.matchAll(/["']([a-z_]+)["']/gi)].map(m=>m[1].toLowerCase()).slice(0,6); if(xs.length) out.prefer=xs; }
  if(/crime\((?:true|allow|yes)\)/i.test(s)) out.crime=true;
  if(/crime\((?:false|forbid|no)\)/i.test(s)) out.crime=false;
  const mode=val(/mode\(["'](manual|advisor|autonomous)["']\)/i); if(mode) out.mode=mode.toUpperCase();
  return out;
}
export function strategyToCymScript(strategy={}){ const s={...DEFAULT_STRATEGY,...strategy}; return [
  `citizen.goal("${s.goal}")`, `citizen.risk("${s.risk}")`, `citizen.save(${Math.round(s.save_rate*100)}%)`, `citizen.keep(${Math.round(s.min_liquidity)}).as("emergency_fund")`, `citizen.prefer(${(s.prefer||[]).map(x=>`"${x}"`).join(", ")})`, `citizen.company_threshold(${Math.round(s.company_threshold)})`, `citizen.crime(${s.crime?"allow":"forbid"})`, `citizen.mode("${s.mode}")`].join("\n"); }
export function translateIntent(intent,current={}){ const text=String(intent||"").toLowerCase(); const s={...DEFAULT_STRATEGY,...current,prefer:[...(current.prefer||DEFAULT_STRATEGY.prefer)]};
  if(/imprend|entrepreneur|azienda|company/.test(text)) {s.goal="entrepreneur"; s.company_threshold=Math.min(s.company_threshold,3500);} if(/ricc|wealth|profit/.test(text)) s.goal="build_wealth"; if(/aiut|community|social/.test(text)) s.goal="community";
  if(/prud|conserv|basso rischio|low risk/.test(text)) s.risk="low"; if(/aggress|alto rischio|high risk/.test(text)) s.risk="high"; if(/tecnolog|research|ricerca/.test(text)) s.prefer=["technology","research"];
  if(/criminal|illegal|delinquent|delinqu|truff/.test(text)) s.crime=true; if(/legale|no crime|niente reati/.test(text)) s.crime=false;
  const pct=text.match(/(?:rispar|save)[^0-9]{0,12}(\d{1,2})\s*%/); if(pct) s.save_rate=clamp(Number(pct[1])/100,0,.9);
  return s; }
export function canAutoApprove(previous,next){ const rank={low:0,medium:1,high:2}; return (rank[next.risk]??1)<=(rank[previous.risk]??1) && Number(next.min_liquidity)>=Number(previous.min_liquidity) && (next.crime!==true || previous.crime===true); }
