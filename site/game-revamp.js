import {project} from './world-scene.js';
import {deriveCitizenAction,eventPresentation,eventTargetId,rankCitizenActivity,recentWorldDecisions,summarizeWorld} from './game-intelligence.js';

const POLL_MS=5000;
const SYNC_TICK_MS=1000;
const MODES=[
  ['world','WORLD','◎'],
  ['economy','ECONOMY','¤'],
  ['logistics','LOGISTICS','➜'],
  ['build','BUILD','▧'],
  ['security','SECURITY','⌕'],
  ['policy','POLICY','⚖'],
];
const TONE_COLOR={work:'#8ed8b7',economy:'#f0c56a',security:'#e88773',policy:'#9ec8ff',mobility:'#8ec9e8',human:'#ffe29a',explore:'#b9c9bc',growth:'#9ed8a2',build:'#e0b96a',alert:'#f09a70',neutral:'#c6cfca'};
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
const fmt=value=>Math.round(Number(value||0)).toLocaleString();
const pct=value=>`${(Number(value||0)*100).toFixed(1)}%`;

const state={world:null,source:'unknown',mode:'world',syncedAt:0,seen:new Set(),initial:true,raf:0,pollTimer:0,syncTimer:0,health:null};

function shell(){
  const stage=document.querySelector('.world-stage');
  if(!stage||$('rtsHud'))return false;
  document.body.classList.add('game-rts-active');
  document.body.dataset.rtsMode='world';
  stage.insertAdjacentHTML('beforeend',`
    <canvas id="rtsTelemetry" aria-hidden="true"></canvas>
    <section id="rtsHud" class="rts-hud" data-ready="false" aria-label="Live world command HUD">
      <div class="rts-live-lockup">
        <span class="rts-kicker">CYMONIA // LIVE OPS</span>
        <strong><i></i><span id="rtsLiveState">CONNECTING</span></strong>
        <small id="rtsSyncAge">Waiting for canonical world…</small>
      </div>
      <div class="rts-metrics" role="list">
        <div role="listitem"><span>POP</span><b id="rtsMetricPopulation">—</b><small>citizens</small></div>
        <div role="listitem"><span>ACTIVE</span><b id="rtsMetricActive">—</b><small>agents now</small></div>
        <div role="listitem"><span>EMPLOYED</span><b id="rtsMetricEmployed">—</b><small>working</small></div>
        <div role="listitem"><span>COMPANIES</span><b id="rtsMetricCompanies">—</b><small>operating</small></div>
        <div role="listitem"><span>BUILD</span><b id="rtsMetricBuild">—</b><small>active sites</small></div>
        <div role="listitem"><span>TREASURY</span><b id="rtsMetricTreasury">—</b><small>CYM</small></div>
        <div role="listitem"><span>CRIME</span><b id="rtsMetricCrime">—</b><small>recent rate</small></div>
        <div role="listitem"><span>RATE</span><b id="rtsMetricRate">—</b><small>policy</small></div>
      </div>
      <div class="rts-system">
        <span id="rtsTick">TICK —</span>
        <small id="rtsSystemState">CANONICAL STATE</small>
      </div>
    </section>
    <aside id="rtsActivity" class="rts-activity" aria-label="Agents acting now">
      <header><div><span>NOW</span><strong>Agents acting</strong></div><b id="rtsDecisionCount">— decisions</b></header>
      <div id="rtsActivityList" class="rts-activity-list"></div>
      <footer>Derived only from canonical state + events</footer>
    </aside>
    <div id="rtsDecisionStrip" class="rts-decision-strip" aria-label="Recent world decisions"></div>
    <div id="rtsBursts" class="rts-bursts" aria-live="polite" aria-atomic="false"></div>
    <nav id="rtsModeDeck" class="rts-mode-deck" aria-label="World visualization mode">
      ${MODES.map(([mode,label,icon],i)=>`<button class="rts-mode" data-mode="${mode}" aria-pressed="${i===0}"><span>${icon}</span><b>${label}</b><small>${i+1}</small></button>`).join('')}
      <div class="rts-mode-readout"><span>VIEW</span><strong id="rtsModeName">WORLD</strong><small id="rtsModeHint">Current actions + canonical event pulses</small></div>
    </nav>
    <div class="rts-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  `);
  return true;
}

function setMode(mode){
  if(!MODES.some(([key])=>key===mode))return;
  state.mode=mode;document.body.dataset.rtsMode=mode;
  document.querySelectorAll('.rts-mode').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
  const row=MODES.find(([key])=>key===mode);$('rtsModeName').textContent=row[1];
  $('rtsModeHint').textContent={
    world:'Current actions + canonical event pulses',economy:'Wealth, companies and market activity',logistics:'Citizen routes toward canonical targets',build:'Construction progress and active sites',security:'Crime, investigations and justice activity',policy:'Institutions and monetary-policy decisions'
  }[mode];
  renderActivity();
}

function renderHud(){
  if(!state.world)return;
  const m=summarizeWorld(state.world);
  $('rtsMetricPopulation').textContent=m.population;
  $('rtsMetricActive').textContent=m.activeAgents;
  $('rtsMetricEmployed').textContent=m.employed;
  $('rtsMetricCompanies').textContent=m.companies;
  $('rtsMetricBuild').textContent=m.constructions;
  $('rtsMetricTreasury').textContent=fmt(m.treasury);
  $('rtsMetricCrime').textContent=pct(m.crimeRate);
  $('rtsMetricRate').textContent=`${m.policyRate.toFixed(2)}%`;
  $('rtsTick').textContent=`TICK ${fmt(m.tick)}`;
  $('rtsDecisionCount').textContent=`${m.recentDecisions} decisions`;
  $('rtsLiveState').textContent=state.source==='live'?'LIVE CANONICAL':'RECORDED REPLAY';
  $('rtsHud').dataset.ready='true';
}

function actionMatchesMode(action){
  if(state.mode==='world')return true;
  if(state.mode==='economy')return ['trade','work','job','strategy'].includes(action.key);
  if(state.mode==='logistics')return ['commute','work'].includes(action.key);
  if(state.mode==='build')return ['work','commute'].includes(action.key);
  if(state.mode==='security')return ['investigation','sentence','crime'].includes(action.key);
  if(state.mode==='policy')return ['strategy'].includes(action.key);
  return true;
}

function renderActivity(){
  if(!state.world)return;
  let rows=rankCitizenActivity(state.world,18);
  const filtered=rows.filter(row=>actionMatchesMode(row.action));
  rows=(filtered.length?filtered:rows).slice(0,8);
  $('rtsActivityList').innerHTML=rows.map(({citizen,action})=>`
    <button class="rts-agent-row" data-world-citizen="${esc(citizen.id)}" data-tone="${esc(action.tone)}">
      <span class="rts-action-icon">${esc(action.icon)}</span>
      <span class="rts-agent-copy"><strong>${esc(citizen.name)}</strong><small>${esc(action.label)} · ${esc(action.detail)}</small></span>
      <span class="rts-agent-sector">${esc(citizen.sector||'world')}</span>
    </button>`).join('')||'<p class="rts-empty">No matching activity in this view.</p>';
}

function renderDecisions(){
  if(!state.world)return;
  const decisions=recentWorldDecisions(state.world,4);
  $('rtsDecisionStrip').innerHTML=decisions.map(event=>{const p=eventPresentation(event);return `<button data-world-event="${esc(event.id)}" class="rts-decision-chip tone-${esc(p.tone)}"><span>${esc(p.icon)}</span><b>${esc(p.title)}</b><small>T${fmt(event.tick)}</small></button>`}).join('');
}

function burst(event){
  const box=$('rtsBursts');if(!box)return;
  const p=eventPresentation(event),node=document.createElement('article');
  node.className=`rts-burst tone-${p.tone}`;
  node.innerHTML=`<span>${esc(p.icon)}</span><div><small>WORLD EVENT · TICK ${fmt(event.tick)}</small><strong>${esc(p.title)}</strong>${p.subtitle?`<em>${esc(p.subtitle)}</em>`:''}</div>`;
  box.prepend(node);while(box.children.length>3)box.lastElementChild.remove();
  setTimeout(()=>node.classList.add('leaving'),4200);setTimeout(()=>node.remove(),5000);
}

function processEvents(world){
  const events=world.events||[];
  if(state.initial){state.seen=new Set(events.map(event=>event.id));state.initial=false;return;}
  const fresh=events.filter(event=>!state.seen.has(event.id));
  fresh.slice(-3).forEach(burst);
  state.seen=new Set(events.map(event=>event.id));
}

function roundRect(ctx,x,y,w,h,r){
  const radius=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+radius,y);ctx.arcTo(x+w,y,x+w,y+h,radius);ctx.arcTo(x+w,y+h,x,y+h,radius);ctx.arcTo(x,y+h,x,y,radius);ctx.arcTo(x,y,x+w,y,radius);ctx.closePath();
}

function drawBadge(ctx,x,y,action,strong=false){
  const color=TONE_COLOR[action.tone]||TONE_COLOR.neutral;
  ctx.save();ctx.font=strong?'700 12px system-ui':'700 10px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
  const w=strong?28:20,h=strong?24:18;roundRect(ctx,x-w/2,y-h/2,w,h,5);ctx.fillStyle='#071317e8';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=strong?1.4:1;ctx.stroke();ctx.fillStyle=color;ctx.fillText(action.icon,x,y+.5);ctx.restore();
}

function drawRoute(ctx,from,to,color,phase,alpha=.72){
  ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=alpha;ctx.lineWidth=1.25;ctx.setLineDash([7,8]);ctx.lineDashOffset=-phase;ctx.beginPath();ctx.moveTo(from.x,from.y);const mx=(from.x+to.x)/2,my=Math.min(from.y,to.y)-24;ctx.quadraticCurveTo(mx,my,to.x,to.y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=color;ctx.beginPath();ctx.arc(to.x,to.y,2.6,0,Math.PI*2);ctx.fill();ctx.restore();
}

function drawTelemetry(time){
  const canvas=$('rtsTelemetry'),stage=document.querySelector('.world-stage');
  if(!canvas||!stage){state.raf=requestAnimationFrame(drawTelemetry);return;}
  const rect=stage.getBoundingClientRect();if(!rect.width||!rect.height){state.raf=requestAnimationFrame(drawTelemetry);return;}
  const d=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(rect.width*d)||canvas.height!==Math.round(rect.height*d)){canvas.width=Math.round(rect.width*d);canvas.height=Math.round(rect.height*d);}
  const ctx=canvas.getContext('2d');ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,rect.width,rect.height);
  const diag=window.getLiveWorldState?.();const world=state.world;if(!diag||!world){state.raf=requestAnimationFrame(drawTelemetry);return;}
  const hits=new Map((diag.visible||[]).map(hit=>[hit.id,hit]));const ranked=rankCitizenActivity(world,state.mode==='logistics'?40:12);const rankedIds=new Set(ranked.map(row=>row.citizen.id));
  const phase=(time/55)%15;

  if(state.mode==='economy'){
    for(const citizen of world.citizens||[]){const hit=hits.get(citizen.id);if(!hit)continue;const wealth=Math.max(0,Number(citizen.balance||0));const radius=4+Math.min(18,Math.log10(wealth+10)*4);ctx.beginPath();ctx.arc(hit.x,hit.y-hit.height*.35,radius,0,Math.PI*2);ctx.fillStyle='#e6c66f12';ctx.fill();ctx.strokeStyle='#e6c66f55';ctx.stroke();}
  }
  if(state.mode==='build'){
    for(const building of (world.buildings||[]).filter(item=>item.status==='construction')){const hit=hits.get(building.id);if(!hit)continue;const progress=Math.max(0,Math.min(100,Number(building.progress||0)));ctx.save();ctx.strokeStyle='#e7bd69';ctx.lineWidth=3;ctx.beginPath();ctx.arc(hit.x,hit.y-hit.height*.38,18,Math.PI*-.5,Math.PI*(-.5+2*progress/100));ctx.stroke();ctx.font='700 9px system-ui';ctx.fillStyle='#ffe2a0';ctx.textAlign='center';ctx.fillText(`${Math.round(progress)}%`,hit.x,hit.y-hit.height*.38+3);ctx.restore();}
  }

  for(let index=0;index<ranked.length;index+=1){const {citizen,action}=ranked[index];const hit=hits.get(citizen.id);if(!hit)continue;const strong=diag.selected===citizen.id||diag.follow===citizen.id||index<8;
    const shouldRoute=action.route&&(state.mode==='logistics'||state.mode==='world'||diag.selected===citizen.id||diag.follow===citizen.id);
    if(shouldRoute){const target=project(action.route.to.x,action.route.to.y,diag.camera);drawRoute(ctx,{x:hit.x,y:hit.y-hit.height*.2},target,TONE_COLOR[action.tone]||'#9fc8bd',phase,state.mode==='logistics'?.9:.38);}
    if(state.mode==='world'||actionMatchesMode(action)||diag.selected===citizen.id)drawBadge(ctx,hit.x,hit.y-hit.height-8,action,strong);
  }

  const recent=(world.events||[]).slice(-24).filter(event=>Number(world.tick)-Number(event.tick)<=2);
  for(const event of recent){const id=eventTargetId(event),hit=hits.get(id);if(!hit)continue;const p=eventPresentation(event);if(state.mode==='security'&&!['security'].includes(p.tone))continue;if(state.mode==='policy'&&p.tone!=='policy')continue;if(state.mode==='build'&&!['build','growth'].includes(p.tone))continue;const color=TONE_COLOR[p.tone]||TONE_COLOR.neutral;const radius=17+((time/35)%16);ctx.save();ctx.globalAlpha=.6-((time/35)%16)/40;ctx.strokeStyle=color;ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(hit.x,hit.y-hit.height*.45,radius,0,Math.PI*2);ctx.stroke();ctx.restore();}

  if(state.mode==='policy'){
    for(const id of ['institution:central_bank','institution:government']){const hit=hits.get(id);if(!hit)continue;ctx.save();ctx.strokeStyle='#9ec8ff99';ctx.setLineDash([4,5]);ctx.lineDashOffset=-phase;ctx.beginPath();ctx.arc(hit.x,hit.y-hit.height*.45,30,0,Math.PI*2);ctx.stroke();ctx.restore();}
  }
  state.raf=requestAnimationFrame(drawTelemetry);
}

async function json(url){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4200);try{const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:controller.signal});if(!response.ok)throw new Error(String(response.status));return await response.json();}finally{clearTimeout(timer)}}

async function refreshHealth(){try{state.health=await json('/api/health');$('rtsSystemState').textContent=state.health.personal_agent_ai==='workers-ai'&&state.health.d1_bound?'AI + D1 ONLINE':'CANONICAL STATE';}catch{$('rtsSystemState').textContent='CANONICAL STATE';}}

async function refresh(){
  if(document.hidden)return;
  try{
    let world;
    try{world=await json('/api/world');state.source='live';}
    catch{world=await json('data/world.json');state.source='replay';}
    processEvents(world);state.world=world;state.syncedAt=Date.now();renderHud();renderActivity();renderDecisions();
    $('rtsLiveState').closest('strong').classList.toggle('degraded',state.source!=='live');
  }catch{
    $('rtsLiveState').textContent='LAST KNOWN STATE';$('rtsLiveState').closest('strong').classList.add('degraded');
  }
}

function updateSync(){
  if(!$('rtsSyncAge'))return;
  if(!state.syncedAt){$('rtsSyncAge').textContent='Waiting for canonical world…';return;}
  const seconds=Math.max(0,Math.floor((Date.now()-state.syncedAt)/1000));$('rtsSyncAge').textContent=`Synced ${seconds}s ago · world persists when you leave`;
}

function wire(){
  document.querySelectorAll('.rts-mode').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.mode)));
  document.addEventListener('keydown',event=>{if(event.metaKey||event.ctrlKey||event.altKey)return;const tag=document.activeElement?.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag))return;const index=Number(event.key)-1;if(index>=0&&index<MODES.length)setMode(MODES[index][0]);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
}

function init(){
  if(!shell())return;
  wire();refreshHealth();refresh();updateSync();
  state.pollTimer=setInterval(refresh,POLL_MS);state.syncTimer=setInterval(updateSync,SYNC_TICK_MS);state.raf=requestAnimationFrame(drawTelemetry);
  window.getCymoniaGameRevampState=()=>({mode:state.mode,tick:state.world?.tick??null,syncedAt:state.syncedAt,ready:$('rtsHud')?.dataset.ready==='true'});
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
