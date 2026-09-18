import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSovereignGenesis} from '../world/genesis.js';
import {createHumanAvatar} from '../world/engine.js';

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');

test('human avatar embodiment is idempotent and population distinguishes embodiment from living count',()=>{
  const world=createSovereignGenesis({seed:31,realEpochMs:0});

  const reserve=world.reserves.observerEmbodimentKg;

  const a=createHumanAvatar(
    world,
    {externalId:'github:owner-1',displayName:'Owner'},
    0
  );

  const afterFirst=world.reserves.observerEmbodimentKg;

  const b=createHumanAvatar(
    world,
    {externalId:'github:owner-1',displayName:'Owner'},
    10
  );

  assert.equal(a.id,b.id);
  assert.equal(world.citizens.length,101);
  assert.equal(afterFirst,world.reserves.observerEmbodimentKg);
  assert.ok(afterFirst<reserve);
});

test('session-backed POST avatar endpoint automatically ensures ownership without requiring an intent',()=>{
  const api=read('functions/api/v2/[[path]].js');
  const worker=read('worker/src/index.js');

  assert.ok(
    api.includes("request.method==='POST'&&p==='/avatar'")
  );

  assert.equal(
    api.includes("request.method==='GET'&&p==='/avatar'"),
    false
  );

  assert.match(api,/requireActor\(request,env\)/);
  assert.ok(api.includes("path:'/avatar'"));
  assert.ok(api.includes('authenticated:true'));

  assert.match(
    worker,
    /const existing=this\.world\.citizens\.find\(c=>c\.externalId===externalId\)/
  );

  assert.match(worker,/created:!existing/);
  assert.match(worker,/if\(!existing\)\{/);
});

test('Observer exposes owned-avatar marker, locate/follow controls and personal evolution panel',()=>{
  const html=read('site/index.html');
  const js=read('site/sovereign-world.js');
  const renderer=read('site/sovereign-renderer.js');
  const pixi=read('site/pixi-observer.js');

  assert.match(html,/id="myAvatarStatus"/);
  assert.match(html,/id="avatarDashboard"/);

  for(const id of [
    'avatarLocate',
    'avatarFollow',
    'avatarInspect',
    'avatarEvolution',
    'avatarTimeline'
  ]){
    assert.match(html,new RegExp(`id="${id}"`));
  }

  assert.match(js,/refreshMyAvatar/);
  assert.match(js,/renderMyAvatar/);

  assert.ok(
    js.includes(
      "LIVING · ${embodied} TOTAL · ${human} HUMAN · ${visibility.visible} VISIBLE"
    )
  );

  assert.match(
    js,
    /getJSON\('\/api\/v2\/avatar',\{/
  );

  assert.match(renderer,/setOwnedCitizen/);
  assert.match(renderer,/locateCitizen/);
  assert.match(pixi,/ownedCitizenId/);
  assert.match(pixi,/'YOU'/);
});

test('public HUMAN_LINKED state remains privacy-minimal',()=>{
  const engine=read('world/engine.js');
  const js=read('site/sovereign-world.js');

  assert.match(
    engine,
    /c\.kind==='HUMAN_LINKED'\?\{count:c\.knowledge\.filter/
  );

  const start=engine.indexOf('export function publicWorld');

  assert.ok(
    start>=0,
    'publicWorld must exist'
  );

  const next=engine.indexOf(
    '\nexport function ',
    start+'export function publicWorld'.length
  );

  const publicBlock=engine.slice(
    start,
    next>=0?next:engine.length
  );

  assert.doesNotMatch(
    publicBlock,
    /privateHumanIntents/
  );

  assert.match(js,/knowledgeCount/);
  assert.match(js,/vocabularyCount/);
  assert.match(js,/relationshipsCount/);
  assert.match(js,/possessionsCount/);
});
