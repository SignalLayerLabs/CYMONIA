import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const exists=p=>fs.existsSync(new URL(`../${p}`,import.meta.url));

test('repository landing page communicates the product before the implementation',()=>{
  const readme=read('README.md');
  assert.match(readme,/persistent artificial civilization/i);
  assert.match(readme,/autonomous AI citizens/i);
  assert.match(readme,/ENTER THE LIVE WORLD/i);
  assert.match(readme,/cymonia\.pages\.dev/);
  assert.match(readme,/multi-agent/i);
  assert.match(readme,/artificial life/i);
});

test('public site exposes technical SEO and machine-readable discovery metadata',()=>{
  const html=read('site/index.html');
  assert.match(html,/rel="canonical" href="https:\/\/cymonia\.pages\.dev\/"/);
  assert.match(html,/property="og:title"/);
  assert.match(html,/property="og:image"/);
  assert.match(html,/name="twitter:card"/);
  assert.match(html,/application\/ld\+json/);
  assert.match(html,/SoftwareApplication/);
  assert.equal(exists('site/robots.txt'),true);
  assert.equal(exists('site/sitemap.xml'),true);
  assert.equal(exists('site/llms.txt'),true);
});

test('repository cleanup removes superseded presentation assets',()=>{
  for(const p of [
    'site/cinematic-world.css',
    'site/assets/world-backdrop.png',
    'site/assets/world-buildings.png',
    'site/assets/world-citizens.png',
    'site/assets/world-terrain.png',
    'docs/superpowers',
    'docs/architecture-v2.md',
    'docs/deployment-sovereign-world.md'
  ]) assert.equal(exists(p),false,p);

  for(const p of [
    'docs/README.md',
    'docs/architecture/overview.md',
    'docs/architecture/physics.md',
    'docs/design/sovereign-world-v2.md',
    'docs/design/self-evolving-world.md',
    'docs/observer/art.md',
    'docs/observer/spine.md',
    'docs/operations/deployment.md',
    'docs/reference/repository-map.md'
  ]) assert.equal(exists(p),true,p);
});

test('contributor workflow is discoverable and structured',()=>{
  const contributing=read('CONTRIBUTING.md');
  const map=read('docs/reference/repository-map.md');
  assert.match(contributing,/Pick the right layer/);
  assert.match(contributing,/Non-negotiable invariants/);
  assert.match(map,/cognition\.js/);
  assert.match(map,/worker\/src\/index\.js/);
  assert.match(map,/pixi-observer\.js/);
  assert.equal(exists('.github/PULL_REQUEST_TEMPLATE.md'),true);
  assert.equal(exists('.github/ISSUE_TEMPLATE/bug_report.yml'),true);
  assert.equal(exists('.github/ISSUE_TEMPLATE/feature_request.yml'),true);
});
