import {SovereignRenderer,worldMinute,citizenPosition} from './sovereign-renderer.js';
import {ObserverConnection,CONNECTION} from './observer-connection.js';
import {observerConceptView} from './observer-concepts.js';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ICON={MOVE:'→',OBSERVE:'◉',REST:'·',SLEEP:'z',EAT:'•',DRINK:'≈',GATHER:'⌁',CARRY:'▣',CUT:'╱',DIG:'⌄',BUILD:'⌂',CARE:'+',TEACH:'◇',COMMUNICATE:'◇',EXPERIMENT:'✦',ATTACK:'⚠',DEFEND:'◈',TRANSFER:'↔',PROMISE:'∞',CLAIM:'⌁',REPRODUCE:'◌'};
const state={world:null,selected:null,renderer:null,myAvatar:null,keys:new Set(),lastFrame:performance.now(),lastHud:0,connection:null,mode:CONNECTION.CONNECTING};
async function getJSON(url,opts={}){const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...opts});if(!r.ok)throw new Error(`${r.status}`);return r.json();}
function dateLabel(min){const m=Math.max(0,Math.floor(min)),year=Math.floor(m/525600)+1,rem=m%525600,day=Math.floor(rem/1440)+1,hour=Math.floor((rem%1440)/60),minute=rem%60;return `YEAR ${year} · DAY ${day} · ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;}
function climateState(w){const minute=worldMinute(w),dayPhase=Number(w.environment?.dayPhase??((minute%1440)/1440)),seasonPhase=Number(w.environment?.seasonPhase??((minute%525600)/525600)),temperature=Number(w.environment?.temperatureC??18),rain=Number(w.environment?.precipitation??0),seasons=['DEEPWINTER','THAW','HIGHSUN','HARVEST'],season=seasons[Math.floor((((seasonPhase+.125)%1)+1)%1*4)%4];return{dayPhase,season,temperature,rain,night:dayPhase<.21||dayPhase>.79};}
function citizenName(c){return c.selfName||c.observerDisplayName||c.id.replace('genesis:','Citizen ');}
function goalLabel(g){if(!g)return 'No long-term goal exposed';if(typeof g==='string')return g;const actions=Array.isArray(g.actionTypes)?g.actionTypes:[],concepts=Array.isArray(g.concepts)?g.concepts:[];return [actions.length?actions.join(' → '):'',concepts.length?`concepts ${concepts.join(', ')}`:''].filter(Boolean).join(' · ')||'Self-directed';}
function modeLabel(mode){return({[CONNECTION.LIVE]:'LIVE · CANONICAL WORLD',[CONNECTION.DEGRADED]:'DEGRADED · LAST CANONICAL STATE',[CONNECTION.REPLAY]:'OFFLINE · GENESIS REPLAY',[CONNECTION.RECONNECTING]:'RECONNECTING TO CANONICAL WORLD',[CONNECTION.CONNECTING]:'CONNECTING TO CANONICAL WORLD'})[mode]||mode;}
function setConnectionMode(mode,detail){state.mode=mode;const badge=document.querySelector('.truth-badge');if(badge)badge.dataset.mode=mode;$('truthText').textContent=modeLabel(mode);$('worldStatus').textContent=mode===CONNECTION.LIVE?'CANONICAL WORLD':mode;if(mode===CONNECTION.DEGRADED&&detail?.retryInMs)$('worldStatus').textContent=`RETRY ${Math.ceil(detail.retryInMs/1000)}s`;}
function acceptWorld(world,meta={}){state.world=world;state.renderer?.setState(world);state.renderer?.setOwnedCitizen?.(state.myAvatar?.citizenId||null);$('worldLoader')?.classList.add('ready');renderAll();}
function renderTop(){
  const w=state.world;if(!w)return;
  const living=w.citizens.filter(c=>c.alive).length,embodied=w.citizens.length,human=w.citizens.filter(c=>c.kind==='HUMAN_LINKED').length,climate=climateState(w),visibility=state.renderer?.populationVisibility?.()||{visible:living,total:living};
  $('populationValue').textContent=living;
  if($('populationLabel'))$('populationLabel').textContent=`LIVING · ${embodied} TOTAL · ${human} HUMAN · ${visibility.visible} VISIBLE`;
  $('structureValue').textContent=(w.buildings||[]).length;
  $('organizationValue').textContent=(w.organizations||[]).length;
  $('environmentValue').textContent=`${Math.round(climate.temperature)}° ${climate.season}`;
  $('weatherValue').textContent=climate.rain>.08?`RAIN ${Math.round(climate.rain*100)}%`:climate.night?'NIGHT':'CLEAR';
  $('worldDate').textContent=dateLabel(worldMinute(w));
  $('miniMode').textContent=state.mode===CONNECTION.LIVE?'LIVE':'OBSERVER';
  renderMyAvatarStatus();
}
function significantHistory(w){const rows=[...(w.history||[])];const rank={conflict:9,life:8,construction:8,society:8,culture:8,language:7,knowledge:7,genesis:6};return rows.sort((a,b)=>(b.worldMinute-a.worldMinute)||(rank[b.category]||0)-(rank[a.category]||0)).slice(0,14);}
function renderActivity(){const w=state.world;if(!w)return;const history=significantHistory(w);if(history.length){$('activityList').innerHTML=history.map(e=>`<button class="activity-row" data-event="${esc(e.eventId)}"><span>${e.category==='life'?'✦':e.category==='construction'?'⌂':e.category==='conflict'?'⚠':e.category==='language'?'◇':'•'}</span><div><b>${esc(e.label)}</b><small>${esc(e.date?.label||dateLabel(e.worldMinute))} · ${esc(e.category)}</small></div></button>`).join('');return;}const now=worldMinute(w),rows=w.citizens.filter(c=>c.alive&&c.currentAction).sort((a,b)=>{const am=a.currentAction.type==='MOVE'?1:0,bm=b.currentAction.type==='MOVE'?1:0;return am-bm||a.currentAction.endsWorldMinute-b.currentAction.endsWorldMinute;}).slice(0,14);$('activityList').innerHTML=rows.map(c=>{const a=c.currentAction,span=Math.max(1,a.endsWorldMinute-a.startedWorldMinute),progress=clamp((now-a.startedWorldMinute)/span*100,0,100);return `<button class="activity-row" data-citizen="${esc(c.id)}"><span>${ICON[a.type]||'·'}</span><div><b>${esc(citizenName(c))}</b><small>${esc(a.type.toLowerCase())} · ${esc(a.purpose||'self-directed')}</small><i class="action-progress"><i class="action-progress-fill" style="width:${progress.toFixed(1)}%"></i></i></div></button>`;}).join('')||'<div class="activity-row"><span>…</span><div><b>Quiet interval</b><small>No significant canonical event right now.</small></div></div>';}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function objectLabel(id){const o=state.world?.objects?.find(x=>x.id===id);return o?`${o.kind} × ${Number(o.quantity||1).toFixed(Number(o.quantity)%1?1:0)}`:id;}
function relationRows(c){return Object.entries(c.relationships||{}).sort(([,a],[,b])=>Math.max(Math.abs(b.trust||0),Math.abs(b.affection||0),Math.abs(b.fear||0))-Math.max(Math.abs(a.trust||0),Math.abs(a.affection||0),Math.abs(a.fear||0))).slice(0,10);}
function renderInspector(){const w=state.world;if(!w)return;const c=w.citizens.find(x=>x.id===state.selected),b=w.buildings?.find(x=>x.id===state.selected),p=w.projects?.find(x=>x.id===state.selected),d=w.resourceDeposits?.find(x=>x.id===state.selected);if(!c&&!b&&!p&&!d){$('inspector').hidden=true;return}$('inspector').hidden=false;if(b){$('inspectorBody').innerHTML=`<span class="eyebrow">PHYSICAL STRUCTURE</span><h2>${esc(b.id)}</h2><p>Completed at world minute ${esc(b.createdWorldMinute)}. It exists only because its project consumed material and labor.</p><div class="inspector-section"><h3>Provenance</h3><span class="tag">${esc(b.provenance?.projectId||'unknown project')}</span><span class="tag">${esc(b.designId||'unknown design')}</span></div>`;return}if(p){const progress=p.workRequiredMinutes?Math.round(p.workDoneMinutes/p.workRequiredMinutes*100):0;$('inspectorBody').innerHTML=`<span class="eyebrow">CONSTRUCTION PROJECT</span><h2>${esc(p.id)}</h2><div class="inspector-grid"><div><b>${progress}%</b><small>work</small></div><div><b>${esc(p.status)}</b><small>status</small></div></div><p>This site is canonical. Completion requires the project's remaining work and reserved materials.</p>`;return}if(d){$('inspectorBody').innerHTML=`<span class="eyebrow">NATURAL RESOURCE</span><h2>${esc(String(d.type).toUpperCase())}</h2><div class="inspector-grid"><div><b>${Math.round(d.quantity)}</b><small>quantity</small></div><div><b>${Number(d.position.x).toFixed(1)}, ${Number(d.position.y).toFixed(1)}</b><small>location</small></div></div><p>This marker represents a canonical resource deposit, not decorative scenery.</p>`;return}
  const k=Array.isArray(c.knowledge)?c.knowledge:[],conceptViews=k.map(entry=>observerConceptView(w,c,entry)),conceptById=new Map(conceptViews.map(v=>[v.canonicalId,v])),age=(c.body.ageMinutes/525600).toFixed(1),a=c.currentAction,rels=relationRows(c),poss=(c.possessions||[]).slice(0,12),psych=Object.entries(c.psychology||{}).filter(([,v])=>typeof v==='number').sort((a,b)=>b[1]-a[1]).slice(0,7);
  $('inspectorBody').innerHTML=`<span class="eyebrow">${esc(c.kind)} · ${c.alive?'ALIVE':'DEAD'}</span><h2>${esc(citizenName(c))}</h2><div class="inspector-grid"><div><b>${age}</b><small>years</small></div><div><b>${Math.round(c.body.health)}%</b><small>health</small></div><div><b>${Math.round(c.body.hydration)}%</b><small>water</small></div><div><b>${Math.round(c.body.calories)}%</b><small>energy</small></div></div><div class="inspector-section"><span class="eyebrow">CURRENT ACTION</span><h3>${esc(a?.type||'IDLE / THINKING')}</h3><p>${esc(a?.purpose||'No public physical action recorded.')}</p>${a?`<button class="tag" data-why-action="${esc(a.id)}">WHY?</button>`:''}</div><div class="inspector-section"><h3>Current goal</h3><p>${esc(goalLabel(c.activeGoal))}</p></div><div class="inspector-section"><h3>Body / exposure</h3><span class="tag">sleep ${Math.round(c.body.sleepPressure||0)}%</span><span class="tag">temperature ${Number(c.body.temperatureC||36.6).toFixed(1)}°C</span><span class="tag">terrain ${esc(c.body.exposure?.terrain||'unknown')}</span><span class="tag">rain exposure ${Math.round((c.body.exposure?.rainExposure||0)*100)}%</span><span class="tag">injuries ${Number(c.body.injuries||0)}</span><span class="tag">diseases ${Number(c.body.diseases||0)}</span></div><div class="inspector-section"><h3>Mind / traits</h3>${psych.map(([name,v])=>`<span class="tag">${esc(name)} ${Math.round(v*100)}%</span>`).join('')||'<p>No public trait state.</p>'}</div><div class="inspector-section"><h3>Known concepts</h3>${conceptViews.length?conceptViews.slice(0,28).map(v=>`<span class="tag concept-tag" title="${esc(v.tooltip)}">${esc(v.label)}</span>`).join(''):`<p>${c.knowledge?.count!=null?`${c.knowledge.count} private concepts`:'No exposed concepts yet.'}</p>`}</div><div class="inspector-section"><h3>Language</h3>${Object.entries(c.language?.lexicon||{}).slice(0,18).map(([concept,token])=>{const v=conceptById.get(concept)||observerConceptView(w,c,{concept,confidence:null,provenance:[]});return `<span class="tag concept-word" title="${esc(v.tooltip)}">${esc(token)} ↔ ${esc(v.label)}</span>`;}).join('')||'<p>No stable coined lexicon yet.</p>'}</div><div class="inspector-section"><h3>Relationships</h3>${rels.map(([id,r])=>`<span class="tag">${esc(id.replace('genesis:','C'))} · trust ${Math.round((r.trust||0)*100)} · affection ${Math.round((r.affection||0)*100)} · fear ${Math.round((r.fear||0)*100)}</span>`).join('')||'<p>No significant public relationship data yet.</p>'}</div><div class="inspector-section"><h3>Possessions</h3>${poss.map(id=>`<span class="tag">${esc(objectLabel(id))}</span>`).join('')||'<p>No individually held objects.</p>'}</div>`;}
function renderHistory(){const history=state.world?.history||[],q=$('historySearch').value.trim().toLowerCase(),cat=$('historyCategory').value,rows=history.filter(e=>(cat==='all'||e.category===cat)&&(!q||JSON.stringify(e).toLowerCase().includes(q))).sort((a,b)=>b.worldMinute-a.worldMinute);$('historyTimeline').innerHTML=rows.length?rows.map(e=>`<article class="history-entry" data-event="${esc(e.eventId)}"><span class="history-date">${esc(e.date?.label||dateLabel(e.worldMinute))}</span><i class="history-node"></i><div><b>${esc(e.label)}</b><small>${esc(e.era||'Emergent history')} · ${esc(e.category)} · ${esc(e.actorId||'world')}</small></div></article>`).join(''):'<p>No canonical history matches this filter.</p>';}
async function showWhy(id){const p=$('whyPanel');p.hidden=false;p.innerHTML='<span class="eyebrow">WHY?</span><p>Tracing canonical causes…</p>';try{if(String(id).startsWith('observer:')){const e=(state.world.history||[]).find(x=>x.eventId===id);p.innerHTML=`<span class="eyebrow">OBSERVER CLASSIFICATION</span><h3>${esc(e?.label||'Derived historical label')}</h3><p>${esc(e?.era||'')} ${e?.confidence!=null?`· confidence ${Math.round(e.confidence*100)}%`:''}</p><p>This label is descriptive. It never mutates world state.</p>${e?.payload?`<pre>${esc(JSON.stringify(e.payload,null,2))}</pre>`:''}<small>${(e?.causes||[]).length} canonical cause(s)</small>`;return}const d=await getJSON(`/api/v2/why/${encodeURIComponent(id)}`);p.innerHTML=`<span class="eyebrow">CANONICAL CAUSAL TRACE</span><h3>${esc(d.why.event.type)}</h3><p>World minute ${d.why.event.worldMinute} · actor ${esc(d.why.event.actorId)}</p><pre>${esc(JSON.stringify(d.why.event.payload,null,2))}</pre><small>${d.why.causes?.length||0} direct causal parent(s)</small>`;}catch(e){p.innerHTML=`<span class="eyebrow">WHY?</span><p>Trace unavailable: ${esc(e.message)}</p>`;}}
function worldDuration(minutes){
  const m=Math.max(0,Math.floor(Number(minutes)||0)),days=Math.floor(m/1440),hours=Math.floor((m%1440)/60);
  return `${days}d ${hours}h`;
}
function currentOwnedCitizen(){
  const id=state.myAvatar?.citizenId;
  return id?state.world?.citizens?.find(c=>c.id===id)||null:null;
}
function renderMyAvatarStatus(){
  const el=$('myAvatarStatus');if(!el)return;
  if(!state.myAvatar?.authenticated){el.textContent='SIGN IN';el.dataset.state='guest';return;}
  const c=currentOwnedCitizen();
  if(!c){el.textContent='LINKED';el.dataset.state='linked';return;}
  el.textContent=c.alive?'● ALIVE':'† DEAD';el.dataset.state=c.alive?'alive':'dead';
}
function avatarRecentEvents(c){
  const rows=[...(state.world?.recentLedger||[]),...(state.world?.history||[])].filter(e=>e?.actorId===c.id);
  const seen=new Set();
  return rows.sort((a,b)=>Number(b.worldMinute||0)-Number(a.worldMinute||0)).filter(e=>{
    const key=e.eventId||`${e.type}|${e.worldMinute}`;if(seen.has(key))return false;seen.add(key);return true;
  }).slice(0,8);
}
function renderMyAvatar(){
  const guest=$('avatarGuest'),dash=$('avatarDashboard');
  if(!guest||!dash)return;
  const linked=Boolean(state.myAvatar?.authenticated&&state.myAvatar?.citizenId);
  guest.hidden=linked;dash.hidden=!linked;renderMyAvatarStatus();
  if(!linked)return;
  const c=currentOwnedCitizen(),actor=state.myAvatar.actor||{};
  if(!c){$('avatarIdentityName').textContent=actor.displayName||actor.githubLogin||'Linked Citizen';$('avatarIdentityStatus').textContent='Synchronizing canonical Citizen…';return;}
  const img=$('avatarIdentityImage');
  if(actor.avatarUrl){img.src=actor.avatarUrl;img.hidden=false;}else img.hidden=true;
  $('avatarIdentityName').textContent=citizenName(c)||actor.displayName||actor.githubLogin||'My Citizen';
  $('avatarIdentityStatus').textContent=`${c.kind} · ${c.alive?'ALIVE':'DEAD'} · embodied ${worldDuration(worldMinute(state.world)-Number(c.birthWorldMinute||0))} ago`;
  const knowledgeCount=Array.isArray(c.knowledge)?c.knowledge.length:Number(c.knowledge?.count||0);
  const vocabularyCount=Object.keys(c.language?.lexicon||{}).length;
  const relationshipsCount=Object.keys(c.relationships||{}).length;
  const possessionsCount=(c.possessions||[]).length;
  $('avatarStats').innerHTML=`<div><b>${Math.round(c.body.health||0)}%</b><small>health</small></div><div><b>${knowledgeCount}</b><small>knowledge</small></div><div><b>${vocabularyCount}</b><small>words</small></div><div><b>${relationshipsCount}</b><small>relations</small></div>`;
  const a=c.currentAction;
  $('avatarNow').innerHTML=`<p><b>${esc(a?.type||'IDLE / THINKING')}</b> — ${esc(a?.purpose||'No public physical action recorded.')}</p><span class="tag">water ${Math.round(c.body.hydration||0)}%</span><span class="tag">energy ${Math.round(c.body.calories||0)}%</span><span class="tag">sleep ${Math.round(c.body.sleepPressure||0)}%</span><span class="tag">possessions ${possessionsCount}</span><p><small>Goal: ${esc(goalLabel(c.activeGoal))}</small></p>`;
  $('avatarEvolution').innerHTML=`<div class="avatar-evolution-grid"><span><b>${knowledgeCount}</b><small>concepts learned</small></span><span><b>${vocabularyCount}</b><small>coined/shared words</small></span><span><b>${relationshipsCount}</b><small>known relationships</small></span><span><b>${possessionsCount}</b><small>possessions</small></span></div>`;
  const events=avatarRecentEvents(c);
  $('avatarTimeline').innerHTML=events.length?events.map(e=>`<div class="avatar-life-row"><span>${esc(dateLabel(e.worldMinute||0))}</span><b>${esc(e.label||e.type||'Canonical event')}</b></div>`).join(''):'<p>No recent public canonical events for this Citizen yet.</p>';
}
async function refreshMyAvatar({quiet=false}={}){
  try{
    const d=await getJSON('/api/v2/avatar',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:'{}'
    });

    state.myAvatar={
      authenticated:true,
      citizenId:d.avatar?.citizenId||null,
      actor:d.actor||{}
    };

    state.renderer?.setOwnedCitizen?.(state.myAvatar.citizenId);
    renderMyAvatar();
    renderTop();

    return state.myAvatar;
  }catch(error){
    if(error.message==='401'){
      state.myAvatar=null;
      state.renderer?.setOwnedCitizen?.(null);
      renderMyAvatar();
      renderMyAvatarStatus();
      return null;
    }

    if(!quiet)toast('Avatar link unavailable');
    return null;
  }
}
function locateMyAvatar({follow=false,inspect=false}={}){
  const id=state.myAvatar?.citizenId;if(!id){toast('Sign in with GitHub first');return false;}
  const ok=state.renderer?.locateCitizen?.(id,{follow});
  if(!ok){toast(currentOwnedCitizen()?.alive===false?'Your Citizen is dead':'Avatar position unavailable');return false;}
  if(inspect){state.selected=id;state.renderer.setSelected(id);renderInspector();}
  toast(follow?'Following your Citizen':'Located your Citizen');return true;
}
function renderAll(){renderTop();renderActivity();renderInspector();renderMyAvatar();if(!$('societyHistory').hidden)renderHistory();}
function createSocket({onWorld,onOpen,onClose,onError}){const url=new URL('/api/v2/stream',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';const ws=new WebSocket(url);ws.onopen=onOpen;ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.state)onWorld(m.state);}catch(error){onError(error);}};ws.onclose=onClose;ws.onerror=e=>onError(e);return ws;}
function toast(text){const d=document.createElement('div');d.className='toast';d.textContent=text;$('toastLayer').append(d);setTimeout(()=>d.remove(),3200);}
async function sendIntent(){const intent=$('humanIntent').value.trim();if(!intent)return;const feedback=$('agentFeedback');feedback.textContent='Sending direction through the epistemic boundary…';try{const d=await getJSON('/api/v2/intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intent})});feedback.textContent=d.ok?'Direction queued. Your avatar still decides and can fail.':'Direction rejected.';toast('Avatar direction queued');}catch(e){feedback.textContent=e.message==='401'?'Sign in with GitHub first.':`Unavailable: ${e.message}`;}}
function toggleFullscreen(){document.fullscreenElement?document.exitFullscreen?.():$('game').requestFullscreen?.();}
function closeWindows(){let closed=false;for(const id of ['societyHistory','agentWindow']){const el=$(id);if(el&&!el.hidden){el.hidden=true;closed=true;}}$('whyPanel').hidden=true;if(!closed&&state.selected){state.selected=null;state.renderer.setSelected(null);renderInspector();}else if(!closed&&state.renderer.follow)state.renderer.setFollow(null);}
function isTyping(el){return ['INPUT','TEXTAREA','SELECT'].includes(el?.tagName)||el?.isContentEditable;}
function wire(){const canvas=$('worldCanvas');canvas.addEventListener('worldselect',e=>{state.selected=e.detail.id;state.renderer.setSelected(state.selected);renderInspector();});canvas.addEventListener('dblclick',()=>state.renderer.center());document.addEventListener('click',e=>{const c=e.target.closest('[data-citizen]');if(c){state.selected=c.dataset.citizen;state.renderer.setSelected(state.selected);renderInspector();}const h=e.target.closest('[data-event]');if(h)showWhy(h.dataset.event);const why=e.target.closest('[data-why-action]');if(why)showWhy(why.dataset.whyAction);});$('closeInspector').onclick=()=>{state.selected=null;state.renderer.setSelected(null);renderInspector();};$('toggleRail').onclick=()=>$('activityRail').classList.toggle('collapsed');$('historyOpen').onclick=()=>{$('societyHistory').hidden=false;renderHistory();};$('historyClose').onclick=()=>{$('societyHistory').hidden=true;$('whyPanel').hidden=true;};$('historySearch').oninput=renderHistory;$('historyCategory').onchange=renderHistory;$('agentOpen').onclick=async()=>{$('agentWindow').hidden=false;await refreshMyAvatar({quiet:true});renderMyAvatar();};$('agentClose').onclick=()=>$('agentWindow').hidden=true;$('avatarLocate').onclick=()=>locateMyAvatar();$('avatarFollow').onclick=()=>locateMyAvatar({follow:true});$('avatarInspect').onclick=()=>locateMyAvatar({inspect:true});$('sendIntent').onclick=sendIntent;$('centerWorld').onclick=()=>state.renderer.center();$('fitPopulation').onclick=()=>{const ok=state.renderer.fitPopulation();toast(ok?'Framing all living Citizens':'No living Citizens to frame');};$('followSelected').onclick=()=>{state.renderer.setFollow(state.selected);toast(state.selected?'Following selected Citizen':'Select a Citizen first');};$('overlayKnowledge').onclick=()=>state.renderer.toggleOverlay('knowledge');$('overlayRelations').onclick=()=>state.renderer.toggleOverlay('relations');$('fullscreenWorld').onclick=toggleFullscreen;document.addEventListener('keydown',e=>{if(isTyping(e.target)){if(e.key==='Escape')e.target.blur();return}const k=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes(k)){state.keys.add(k);e.preventDefault();}if(k==='f'){toggleFullscreen();e.preventDefault();}else if(k==='escape')closeWindows();else if(k==='h'){$('societyHistory').hidden=!$('societyHistory').hidden;if(!$('societyHistory').hidden)renderHistory();}else if(k==='c')state.renderer.center();else if(k==='v'){state.renderer.fitPopulation();e.preventDefault();}else if(k==='+'||k==='=')state.renderer.zoomBy(1.12);else if(k==='-')state.renderer.zoomBy(.89);});document.addEventListener('keyup',e=>state.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>state.keys.clear());}
function frame(now){const dt=Math.min(.05,(now-state.lastFrame)/1000||.016);state.lastFrame=now;const speed=260*dt;if(state.keys.has('w')||state.keys.has('arrowup'))state.renderer.panBy(0,speed);if(state.keys.has('s')||state.keys.has('arrowdown'))state.renderer.panBy(0,-speed);if(state.keys.has('a')||state.keys.has('arrowleft'))state.renderer.panBy(speed,0);if(state.keys.has('d')||state.keys.has('arrowright'))state.renderer.panBy(-speed,0);state.renderer.draw();if(now-state.lastHud>300){state.lastHud=now;renderTop();if(!$('inspector').hidden)renderInspector();}requestAnimationFrame(frame);}
function installTestHooks(){window.render_game_to_text=()=>{if(!state.world)return JSON.stringify({status:'loading'});const w=state.world;return JSON.stringify({mode:state.mode,worldMinute:worldMinute(w),selectedId:state.selected,citizens:w.citizens.filter(c=>c.alive).map(c=>{const p=citizenPosition(c,w);return{id:c.id,x:Number(p.x.toFixed(3)),y:Number(p.y.toFixed(3)),action:c.currentAction?.type||null};}),structures:(w.buildings||[]).length,projects:(w.projects||[]).filter(p=>p.status==='construction').length});};}
async function boot(){
  state.renderer=new SovereignRenderer($('worldCanvas'),$('miniMap'));
  wire();
  installTestHooks();

  // Rendering must never depend on network availability.
  requestAnimationFrame(frame);

  // Session ownership is resolved before the first canonical state fetch so
  // an authenticated user's idempotent HUMAN_LINKED embodiment is visible immediately.
  await refreshMyAvatar({quiet:true});

  state.connection=new ObserverConnection({
    fetchState:async()=>{
      const d=await getJSON('/api/v2/state');
      return d.world;
    },
    loadReplay:async()=>{
      const d=await getJSON('data/sovereign-genesis.json');
      const replay=structuredClone(d.world||d);

      // Replay is a frozen canonical snapshot, not a fake live world.
      if(replay?.clock){
        replay.clock.realEpochMs=null;
      }

      return replay;
    },
    createSocket,
    onWorld:acceptWorld,
    onMode:setConnectionMode,
    onError:()=>{},
    pollMs:10000
  });

  await state.connection.start();
}
boot().catch(error=>{setConnectionMode(CONNECTION.RECONNECTING);$('worldLoader').querySelector('span').textContent=`World link unavailable: ${error.message}`;});
