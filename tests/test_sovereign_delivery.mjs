import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const exists=p=>fs.existsSync(new URL(`../${p}`,import.meta.url));

test('CI deploys and verifies the Sovereign World only',()=>{
  const ci=read('.github/workflows/ci.yml');
  const pages=read('.github/workflows/pages.yml');
  assert.match(ci,/node --test tests\/test_sovereign_\*\.mjs/);
  assert.match(ci,/build_sovereign_genesis\.mjs/);
  assert.match(ci,/browser-sovereign\.mjs/);
  assert.match(ci,/wrangler deploy --config wrangler\.world\.toml/);
  assert.match(ci,/wrangler pages deploy site/);
  assert.match(pages,/build_sovereign_genesis\.mjs/);
  assert.doesNotMatch(ci,/python -m unittest discover/);
});

test('obsolete v1 paths are absent and current auth/runtime paths exist',()=>{
  for(const p of [
    'archive/v1','cymonia','state','constitution','functions/api/[[path]].js',
    'site/app.js','site/live-world.js','site/world-renderer.js',
    'scripts/build_world_replay.mjs','scripts/build_site.py','scripts/build_experiments.py',
    '.github/workflows/economy.yml'
  ]) assert.equal(exists(p),false,p);
  for(const p of [
    'functions/api/auth/[[path]].js','functions/api/v2/[[path]].js',
    'functions/_lib/identity.js','migrations/0001_identity.sql','site/sovereign-world.js'
  ]) assert.equal(exists(p),true,p);
});

test('repository documentation describes the current world',()=>{
  const readme=read('README.md');
  assert.match(readme,/Sovereign World/i);
  assert.match(readme,/Durable Object/i);
  assert.doesNotMatch(readme,/archive\/v1|historical prototype|APPLY\.sh/i);
  assert.doesNotMatch(read('CONTRIBUTING.md'),/python -m|economic Contracts|docs\/architecture\.md/i);
  assert.doesNotMatch(read('SECURITY.md'),/api\/world|api\/agent|CymScript/i);
});

test('auth bridge contains only identity routes',()=>{
  const auth=read('functions/api/auth/[[path]].js');
  assert.match(auth,/github/);
  assert.match(auth,/createSession/);
  assert.doesNotMatch(auth,/contracts|companies|participation|ensureHumanWorldCitizen/);
});

test('Genesis replay builder is reproducible',()=>{
  const build=read('scripts/build_sovereign_genesis.mjs');
  assert.doesNotMatch(build,/new Date\(\)\.toISOString\(\)/);
  assert.match(build,/new Date\(realEpochMs\)\.toISOString\(\)/);
});

test('production Durable Object stays within free-tier write budget',()=>{
  const worker=read('worker/src/index.js');
  assert.match(worker,/const ALARM_MS=10_000;/);
  assert.match(worker,/const PERSIST_INTERVAL_WORLD_MINUTES=60;/);
  assert.doesNotMatch(worker,/const ALARM_MS=1000;/);
  assert.match(worker,/checkpointDue/);
});
