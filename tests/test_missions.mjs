import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../functions/_lib/missions.js';

test('matching recommends three available missions within player ability and never completed work',()=>{
 assert.equal(typeof game.matchMissions,'function');
 const missions=[{id:'hard',difficulty:5,status:'open'},{id:'done',difficulty:1,status:'completed'},...['a','b','c','d'].map(id=>({id,difficulty:1,status:'open',minutes:5}))];
 assert.deepEqual(game.matchMissions(missions,game.playerProgress({xp:0})).map(m=>m.id),['a','b','c']);
});
test('XP alone determines rank and real ability unlocks, not CYM or reputation',()=>{
 assert.equal(typeof game.playerProgress,'function');
 assert.equal(game.playerProgress({xp:0,earned_cym:99999,reputation:9999}).rank,'Observer');
 assert.equal(game.playerProgress({xp:100}).rank,'Operator');
 assert.ok(game.playerProgress({xp:250}).unlocks.includes('propose_experiment'));
 assert.ok(game.playerProgress({xp:1000}).unlocks.includes('found_company'));
 assert.equal(game.playerProgress({xp:99}).next_rank,'Operator');
});
test('world crises derive from recorded economic metrics; calm state has no invented crisis',()=>{
 assert.equal(typeof game.worldEvents,'function');
 assert.deepEqual(game.worldEvents({backlog:0,treasury_cym:1000,rejected_proofs:0,proof_count:0,bankrupt_companies:0}),[]);
 const events=game.worldEvents({backlog:12,treasury_cym:10,rejected_proofs:8,proof_count:10,bankrupt_companies:1});
 assert.ok(events.some(e=>e.kind==='verification_crisis' && e.boss));
 assert.ok(events.some(e=>e.kind==='liquidity_stress'));
 assert.ok(events.every(e=>e.evidence && e.impact));
});
test('server verifies evidence answers and explains correction, never accepts claimed money or missing facts',()=>{
 assert.equal(typeof game.verifyMissionAnswers,'function');
 const mission={expected:{count:10,total:100.25},proof:[{key:'count',type:'number'},{key:'total',type:'number'}]};
 assert.equal(game.verifyMissionAnswers(mission,{count:10,total:100.25}).accepted,true);
 assert.equal(game.verifyMissionAnswers(mission,{count:11,total:100.25,reward_cym:9999}).accepted,false);
 assert.equal(game.verifyMissionAnswers(mission,{count:null,total:100.25}).accepted,false);
 assert.match(game.verifyMissionAnswers(mission,{count:11,total:100.25}).message,/count/i);
});
test('cooperation needs different humans in every role; competition rewards only first verified solution',()=>{
 assert.equal(typeof game.resolveMissionResult,'function');
 assert.equal(game.resolveMissionResult({mode:'cooperative',roles:['observer','reviewer']},[{actor_id:'a',role:'observer',accepted:1}]).complete,false);
 assert.equal(game.resolveMissionResult({mode:'cooperative',roles:['observer','reviewer']},[{actor_id:'a',role:'observer',accepted:1},{actor_id:'a',role:'reviewer',accepted:1}]).complete,false);
 assert.deepEqual(game.resolveMissionResult({mode:'cooperative',roles:['observer','reviewer']},[{actor_id:'a',role:'observer',accepted:1},{actor_id:'b',role:'reviewer',accepted:1}]).winners,['a','b']);
 assert.deepEqual(game.resolveMissionResult({mode:'competitive'},[{actor_id:'a',accepted:0},{actor_id:'b',accepted:1},{actor_id:'c',accepted:1}]).winners,['b']);
});
test('mission detection freezes district evidence, pays only new coverage and skips invalid sources',()=>{
 assert.equal(typeof game.detectMissions,'function');
 const source={state_hash:'abcd',epoch:24,agents:[{agent_id:'agent-a',specialty:'compute',balance:60,completed_sales:2},{agent_id:'agent-b',specialty:'compute',balance:40,completed_sales:3}]};
 const missions=game.detectMissions(source,null,[]);
 assert.equal(missions[0].expected.count,2);
 assert.equal(missions[0].expected.total,100);
 assert.equal(missions[0].evidence.rows.length,2);
 assert.deepEqual(game.detectMissions({},null,[]),[]);
 assert.deepEqual(game.detectMissions(source,null,[]).map(m=>m.id),missions.map(m=>m.id));
});
