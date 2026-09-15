import test from 'node:test';
import assert from 'node:assert/strict';
import {D1TestDB} from './helpers/d1.mjs';
import {ensureParticipationGenesis,upsertHumanFromGitHub} from '../functions/_lib/store.js';
import * as game from '../functions/_lib/game-store.js';
const source={state_hash:'fixture-24',epoch:24,agents:[{agent_id:'a',specialty:'compute',balance:60},{agent_id:'b',specialty:'compute',balance:40}]};
async function setup(){const db=new D1TestDB();await ensureParticipationGenesis(db,1000);const {actor}=await upsertHumanFromGitHub(db,{id:1,login:'player'});return {db,actor};}
test('beginner can match, start, correct rejected proof, earn once and recover after refresh',async()=>{
 assert.equal(typeof game.syncMissions,'function');
 const {db,actor}=await setup();await game.syncMissions(db,source,null,[]);
 let state=await game.gameSnapshot(db,actor.id);const mission=state.recommended[0];assert.ok(mission);assert.equal('expected' in mission,false);
 await game.startMission(db,mission.id,actor.id);await game.startMission(db,mission.id,actor.id);
 let rejected=await game.verifyWork(db,mission.id,actor.id,{count:3,total:100});assert.equal(rejected.accepted,false);
 assert.equal(db.raw.prepare('SELECT escrow_cym FROM missions WHERE id=?').get(mission.id).escrow_cym,8);
 const accepted=await game.verifyWork(db,mission.id,actor.id,{count:2,total:100});assert.equal(accepted.accepted,true);
 await game.verifyWork(db,mission.id,actor.id,{count:2,total:100});
 state=await game.gameSnapshot(db,actor.id);assert.equal(state.wallet.earned_cym,8);assert.equal(state.player.xp,50);assert.equal(state.wallet.reputation,5);
 assert.equal(state.player.proofs_accepted,1);assert.equal(state.missions[0].status,'completed');
 assert.equal(db.raw.prepare('SELECT earned_cym FROM wallets WHERE actor_id=?').get('CYMONIA_CONTRIBUTION_TREASURY').earned_cym,992);
 assert.equal(state.player.achievements.length,1);
});
test('competition pays only the first accepted proof and preserves total CYM',async()=>{
 assert.equal(typeof game.syncMissions,'function');
 const {db,actor}=await setup();const other=(await upsertHumanFromGitHub(db,{id:2,login:'other'})).actor;
 await game.syncMissions(db,source,null,[]);const m=(await game.gameSnapshot(db,actor.id)).missions[0];
 await game.startMission(db,m.id,actor.id);await game.startMission(db,m.id,other.id);
 await game.verifyWork(db,m.id,actor.id,{count:2,total:100});const result=await game.verifyWork(db,m.id,other.id,{count:2,total:100});assert.equal(result.accepted,false);
 assert.equal((await game.gameSnapshot(db,other.id)).wallet.earned_cym,0);
 assert.equal(db.raw.prepare('SELECT SUM(earned_cym) n FROM wallets').get().n,1000);
});
test('unowned missions cannot be verified and repeated matching cannot manufacture work or escrow',async()=>{
 assert.equal(typeof game.syncMissions,'function');
 const {db,actor}=await setup();await game.syncMissions(db,source,null,[]);await game.syncMissions(db,source,null,[]);
 const m=(await game.gameSnapshot(db,actor.id)).missions[0];
 await assert.rejects(game.verifyWork(db,m.id,actor.id,{count:2,total:100}),/start_mission_first/);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM missions').get().n,1);
 assert.equal(db.raw.prepare('SELECT SUM(escrow_cym) n FROM missions').get().n,0);
});
