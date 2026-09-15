import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCitizenAction,
  summarizeWorld,
  recentEventForCitizen,
  eventPresentation,
} from '../site/game-intelligence.js';

function fixture() {
  return {
    tick: 42,
    citizens: [
      {id:'c:1',name:'AURA',status:'working',x:10,y:10,target_x:20,target_y:20,company_id:'co:1',balance:900,kind:'GENESIS_FOUNDER'},
      {id:'c:2',name:'NOVA',status:'exploring',x:5,y:5,target_x:8,target_y:8,company_id:null,balance:700,kind:'GENESIS_FOUNDER'},
      {id:'c:3',name:'MIRA',status:'exploring',x:15,y:15,target_x:15.1,target_y:15.1,company_id:null,balance:650,kind:'GENESIS_FOUNDER'},
    ],
    companies: [{id:'co:1',name:'AURA Technology',sector:'technology',employees:['c:1'],treasury:300,status:'operational'}],
    buildings: [{id:'b:1',company_id:'co:1',status:'construction',progress:64}],
    institutions: {central_bank:{policy_rate:3.25,inflation:2.8,money_supply:12345},government:{treasury:4321},justice:{open_cases:1},police:{active:8}},
    metrics: {population:3,companies:1,buildings:1,unemployment:0.667,crime_rate:0.02},
    events: [
      {id:'e:1',tick:40,type:'MARKET_PURCHASE',actor_id:'c:2',payload:{company_id:'co:1',amount:7}},
      {id:'e:2',tick:41,type:'INVESTIGATION_OPENED',actor_id:'police',payload:{citizen_id:'c:3'}},
      {id:'e:3',tick:42,type:'WORK_SHIFT',actor_id:'c:1',payload:{company_id:'co:1',salary:6}},
      {id:'e:4',tick:42,type:'CENTRAL_BANK_POLICY',actor_id:'central_bank',payload:{from:3,to:3.25,inflation:4.4}},
    ],
  };
}

test('recentEventForCitizen includes events that reference citizen in payload', () => {
  const w = fixture();
  assert.equal(recentEventForCitizen('c:3', w).id, 'e:2');
});

test('deriveCitizenAction reports canonical work and company name', () => {
  const w = fixture();
  const action = deriveCitizenAction(w.citizens[0], w);
  assert.equal(action.key, 'work');
  assert.match(action.label, /Working/);
  assert.match(action.detail, /AURA Technology/);
});

test('deriveCitizenAction gives recent trade precedence over generic movement', () => {
  const w = fixture();
  const action = deriveCitizenAction(w.citizens[1], w);
  assert.equal(action.key, 'trade');
  assert.match(action.detail, /AURA Technology/);
});

test('deriveCitizenAction surfaces investigation from referenced event', () => {
  const w = fixture();
  const action = deriveCitizenAction(w.citizens[2], w);
  assert.equal(action.key, 'investigation');
  assert.match(action.label, /investigation/i);
});

test('deriveCitizenAction reports commuting when target is materially distant and no newer event overrides it', () => {
  const w = fixture();
  w.events = [];
  const action = deriveCitizenAction(w.citizens[1], w);
  assert.equal(action.key, 'commute');
  assert.ok(action.route);
  assert.deepEqual(action.route.to, {x:8,y:8});
});

test('deriveCitizenAction reports exploration for a stationary explorer', () => {
  const w = fixture();
  w.events = [];
  const action = deriveCitizenAction(w.citizens[2], w);
  assert.equal(action.key, 'explore');
});

test('summarizeWorld derives RTS HUD metrics without inventing server fields', () => {
  const summary = summarizeWorld(fixture());
  assert.equal(summary.population, 3);
  assert.equal(summary.employed, 1);
  assert.equal(summary.constructions, 1);
  assert.equal(summary.companies, 1);
  assert.equal(summary.treasury, 4321);
  assert.equal(summary.policyRate, 3.25);
  assert.equal(summary.recentDecisions, 4);
  assert.equal(summary.openCases, 1);
});

test('eventPresentation maps canonical policy events to readable game UI copy', () => {
  const p = eventPresentation(fixture().events.at(-1));
  assert.equal(p.icon, '⚖');
  assert.equal(p.tone, 'policy');
  assert.match(p.title, /Policy rate/i);
});

test('rankCitizenActivity prioritizes security and trade over generic exploration', async () => {
  const {rankCitizenActivity} = await import('../site/game-intelligence.js');
  const w = fixture();
  const ranked = rankCitizenActivity(w, 3);
  assert.equal(ranked[0].citizen.id, 'c:3');
  assert.equal(ranked[0].action.key, 'investigation');
  assert.equal(ranked[1].citizen.id, 'c:2');
  assert.equal(ranked[1].action.key, 'trade');
});

test('deriveCitizenAction does not call a crime an investigation unless an investigation event exists', () => {
  const w = fixture();
  w.events = [{id:'crime:1',tick:42,type:'CRIME_RECORDED',actor_id:'c:2',payload:{kind:'economic_fraud_simulated',gain:12}}];
  const action = deriveCitizenAction(w.citizens[1], w);
  assert.equal(action.key, 'crime');
  assert.equal(action.label, 'Security alert');
});

test('eventTargetId maps institution actors to renderer entity ids', async () => {
  const {eventTargetId} = await import('../site/game-intelligence.js');
  assert.equal(eventTargetId({actor_id:'central_bank',payload:{}}), 'institution:central_bank');
  assert.equal(eventTargetId({actor_id:'police',payload:{}}), 'institution:police');
  assert.equal(eventTargetId({actor_id:'c:1',payload:{building_id:'b:9'}}), 'b:9');
});

test('recentWorldDecisions keeps consequential world choices and filters routine transactions', async () => {
  const {recentWorldDecisions} = await import('../site/game-intelligence.js');
  const w = fixture();
  const decisions = recentWorldDecisions(w, 4);
  assert.deepEqual(decisions.map(x=>x.id), ['e:4','e:2']);
});
