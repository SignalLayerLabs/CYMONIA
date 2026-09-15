import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const exists=p=>fs.existsSync(new URL(`../${p}`,import.meta.url));

test('v2 CI is sovereign-first and GitHub Actions is not the world heartbeat',()=>{
  const economy=read('.github/workflows/economy.yml');
  const ci=read('.github/workflows/ci.yml');
  assert.doesNotMatch(economy,/\bschedule\s*:/);
  assert.match(economy,/workflow_dispatch/);
  assert.match(economy,/historical|v1/i);
  assert.match(ci,/node --test tests\/test_sovereign_\*\.mjs/);
  assert.match(ci,/build_sovereign_genesis\.mjs/);
  assert.match(ci,/browser-sovereign\.mjs/);
  assert.match(ci,/wrangler deploy --config wrangler\.world\.toml/);
  assert.match(ci,/wrangler pages deploy site/);
  assert.doesNotMatch(ci,/python -m unittest discover/);
});

test('v2 documentation defines game-only cutover and v1 archive boundary',()=>{
  for(const p of ['README.md','archive/v1/README.md','RELEASE_SOVEREIGN_WORLD_V2.md','docs/architecture-v2.md','docs/deployment-sovereign-world.md']) assert.equal(exists(p),true,p);
  const readme=read('README.md');
  assert.match(readme,/Sovereign World/i);
  assert.match(readme,/world is the application|world is the product/i);
  assert.match(readme,/no dashboard/i);
  assert.match(read('archive/v1/README.md'),/historical prototype/i);
});

test('package installer is guarded, archives v1 UI, and disables v1 world mutation on OAuth',()=>{
  for(const p of ['APPLY.sh','CHECK.sh']) assert.equal(exists(p),true,p);
  const apply=read('APPLY.sh');
  assert.match(apply,/CYMONIA_ALLOW_DIRTY/);
  assert.match(apply,/git .*status --porcelain/);
  assert.match(apply,/constitution\/genesis\.json/);
  assert.match(apply,/archive\/v1\/index-v1\.html/);
  assert.match(apply,/ensureHumanWorldCitizen/);
  assert.match(apply,/functions\/api\/\[\[path\]\]\.js/);
  assert.doesNotMatch(apply,/reset --hard|clean -fd/);
  const check=read('CHECK.sh');
  assert.match(check,/test_sovereign_\*\.mjs/);
  assert.match(check,/sovereign-world\.js/);
  assert.match(check,/legacy dashboard|world-grid|analysis-grid/i);
});

test('Genesis replay builder is reproducible',()=>{
  const build=read('scripts/build_sovereign_genesis.mjs');
  assert.doesNotMatch(build,/new Date\(\)\.toISOString\(\)/);
  assert.match(build,/new Date\(realEpochMs\)\.toISOString\(\)/);
});
