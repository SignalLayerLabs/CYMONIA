import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import * as store from '../functions/_lib/store.js';

class DB {
  constructor() { this.raw = new DatabaseSync(':memory:'); for (const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort()) this.raw.exec(readFileSync(`migrations/${f}`, 'utf8')); }
  prepare(sql) { const db=this.raw; const make=(params)=>({ bind:(...p)=>make(p), first:async()=>db.prepare(sql).get(...params)??null, all:async()=>({results:db.prepare(sql).all(...params)}), run:async()=>({meta:{changes:Number(db.prepare(sql).run(...params).changes)}}) }); return make([]); }
  async batch(statements) { this.raw.exec('BEGIN'); try { const out=[]; for(const s of statements) out.push(await s.run()); this.raw.exec('COMMIT'); return out; } catch(e) {this.raw.exec('ROLLBACK'); throw e;} }
}
const charter={name:'Helix Research',purpose:'Improve verified productivity inside the CYMONIA economy.',mission:'Reduce failed economic work through reproducible experiments.',target_problem:'Too many contracts fail independent verification.',strategy:'research',kpi:'completion_rate_pct',contribution_cym:100,idempotency_key:'found-1'};
const world={seed:42,backlog:100,completion_rate_pct:50,failure_rate_pct:50,economic_surplus_cym:100};
async function setup() { const db=new DB(); await store.ensureParticipationGenesis(db,1000); const {actor}=await store.upsertHumanFromGitHub(db,{id:321,login:'founder'}); db.raw.prepare('UPDATE wallets SET earned_cym=200 WHERE actor_id=?').run(actor.id); return {db,actor}; }
test('company creation rejects a purpose-only wallet without economic charter',async()=>{const {db,actor}=await setup(); await assert.rejects(store.createCompany(db,actor.id,{name:charter.name,purpose:charter.purpose,contribution_cym:100}),/mission/); assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM companies').get().n,0);});
test('founding and staking retries conserve capital and reject changed idempotency payload',async()=>{const {db,actor}=await setup(); const c=await store.createCompany(db,actor.id,charter); const again=await store.createCompany(db,actor.id,charter); assert.equal(again.id,c.id); assert.equal(again.mission,charter.mission); const a=await store.stakeInCompany(db,c.id,actor.id,50,'stake-1'); const b=await store.stakeInCompany(db,c.id,actor.id,50,'stake-1'); assert.equal(a.units_minted,50); assert.equal(b.units_minted,50); assert.equal(db.raw.prepare('SELECT earned_cym FROM wallets WHERE actor_id=?').get(actor.id).earned_cym,50); await assert.rejects(store.stakeInCompany(db,c.id,actor.id,40,'stake-1'),/idempotency/);});
test('same-state same-seed evaluation is paired, read-only and explicitly simulated',async()=>{const {db,actor}=await setup(); const c=await store.createCompany(db,actor.id,charter); assert.equal(typeof store.evaluateCompany,'function'); const a=await store.evaluateCompany(db,c.id,world); const b=await store.evaluateCompany(db,c.id,world); assert.deepEqual(a,b); assert.equal(a.scope,'bounded_research_simulation'); assert.equal(a.reward_cym,0); assert.equal(a.world_a.seed,a.world_b.seed); assert.deepEqual(a.world_a.initial_state,a.world_b.initial_state); assert.notEqual(a.world_a.economic_surplus_cym,a.world_b.economic_surplus_cym); assert.equal(db.raw.prepare('SELECT treasury_cym FROM companies WHERE id=?').get(c.id).treasury_cym,100);});
test('deployment spends real capital once, records loss and lowers stake book value without minting simulated value',async()=>{const {db,actor}=await setup(); const c=await store.createCompany(db,actor.id,charter); const input={action:'fund_experiment',budget_cym:30,idempotency_key:'deploy-1'}; assert.equal(typeof store.deployCompany,'function'); const a=await store.deployCompany(db,c.id,actor.id,input,world); const b=await store.deployCompany(db,c.id,actor.id,input,world); assert.equal(a.id,b.id); const row=db.raw.prepare('SELECT * FROM companies WHERE id=?').get(c.id); assert.equal(row.treasury_cym,70); assert.equal(row.costs_cym,30); assert.equal(row.revenues_cym,0); assert.equal(row.profit_cym,-30); assert.equal(row.treasury_cym/row.stake_units,0.7); assert.equal(db.raw.prepare('SELECT earned_cym FROM wallets WHERE actor_id=?').get(store.TREASURY_ID).earned_cym,1030); await assert.rejects(store.deployCompany(db,c.id,'other',input,world),/founder/);});
test('capital exhaustion bankrupts company and blocks further exposure',async()=>{const {db,actor}=await setup(); const c=await store.createCompany(db,actor.id,charter); assert.equal(typeof store.deployCompany,'function'); await store.deployCompany(db,c.id,actor.id,{action:'fund_experiment',budget_cym:100,idempotency_key:'last'},world); assert.equal(db.raw.prepare('SELECT status FROM companies WHERE id=?').get(c.id).status,'bankrupt'); await assert.rejects(store.stakeInCompany(db,c.id,actor.id,1,'rescue'),/bankrupt/); await assert.rejects(store.deployCompany(db,c.id,actor.id,{action:'mint',budget_cym:1},world),/action/);});
test('capital checks and stake pricing use transaction state, not stale preflight reads',async()=>{
 const {db,actor}=await setup(); const original=db.batch.bind(db); let intercept=true;
 db.batch=async ss=>{if(intercept){intercept=false;db.raw.prepare('UPDATE wallets SET earned_cym=0 WHERE actor_id=?').run(actor.id);}return original(ss);};
 await assert.rejects(store.createCompany(db,actor.id,charter),/insufficient/);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM companies').get().n,0);
 assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM company_operations").get().n,0);
 db.raw.prepare('UPDATE wallets SET earned_cym=200 WHERE actor_id=?').run(actor.id);
 const c=await store.createCompany(db,actor.id,charter);intercept=true;
 db.batch=async ss=>{if(intercept){intercept=false;db.raw.prepare('UPDATE companies SET treasury_cym=200 WHERE id=?').run(c.id);}return original(ss);};
 const receipt=await store.stakeInCompany(db,c.id,actor.id,50,'new-price');assert.equal(receipt.units_minted,25);
});
test('strict charter rejects unknown strategies and KPIs',async()=>{const {db,actor}=await setup();for(const patch of [{strategy:'mint'},{kpi:'anything'},{target_problem:''}]) await assert.rejects(store.createCompany(db,actor.id,{...charter,...patch}),/company_/);});
test('deterministic competition assigns real contract and cost once within capacity',async()=>{
 const {db,actor}=await setup(); const c=await store.createCompany(db,actor.id,charter);
 const contract=await store.createContract(db,actor.id,{title:'Research reproducible productivity',description:'Research independently reproducible throughput improvements with public benchmark evidence.',category:'research',economic_purpose:'Increase productive throughput of the CYMONIA economic system.',metric_key:'contract_completion_rate_pct',baseline_value:50,target_direction:'increase',min_improvement_pct:20,reward_cym:40});
 await store.fundContract(db,contract.id);
 const input={action:'compete_for_contract',budget_cym:1,idempotency_key:'compete'};
 const a=await store.deployCompany(db,c.id,actor.id,input,world);const b=await store.deployCompany(db,c.id,actor.id,input,world);
 assert.equal(a.contract_id,contract.id);assert.equal(a.id,b.id);
 assert.equal(db.raw.prepare('SELECT claimant_actor_id FROM contracts WHERE id=?').get(contract.id).claimant_actor_id,c.id);
 assert.equal(db.raw.prepare('SELECT treasury_cym FROM companies WHERE id=?').get(c.id).treasury_cym,99);
 await assert.rejects(store.deployCompany(db,c.id,actor.id,{...input,idempotency_key:'again'},world),/capacity|eligible/);
});
test('counterfactual destroys value when there are no opportunities and rejects fabricated state',async()=>{const {db,actor}=await setup(); const c=await store.createCompany(db,actor.id,charter);assert.equal((await store.evaluateCompany(db,c.id,{...world,backlog:0})).value_created_cym,-30); await assert.rejects(store.evaluateCompany(db,c.id,{...world,seed:NaN}),/state/);});
test('independently settled contract revenue updates P&L and productive capacity once',async()=>{
 const {db,actor}=await setup(); const c=await store.createCompany(db,actor.id,charter);
 const contract=await store.createContract(db,actor.id,{title:'Research reproducible productivity',description:'Research independently reproducible throughput improvements with public benchmark evidence.',category:'research',economic_purpose:'Increase productive throughput of the CYMONIA economic system.',metric_key:'contract_completion_rate_pct',baseline_value:50,target_direction:'increase',min_improvement_pct:20,reward_cym:40});
 // Exercise the settlement accounting trigger independently of proof admission policy.
 db.raw.prepare("INSERT INTO settlements(contract_id,proof_id,recipient_actor_id,amount_cym) VALUES(?,?,?,40)").run(contract.id,'verified-proof',c.id);
 db.raw.prepare("INSERT OR IGNORE INTO settlements(contract_id,proof_id,recipient_actor_id,amount_cym) VALUES(?,?,?,40)").run(contract.id,'verified-proof',c.id);
 const row=db.raw.prepare('SELECT * FROM companies WHERE id=?').get(c.id);
 assert.equal(row.revenues_cym,40);assert.equal(row.profit_cym,40);assert.equal(row.successful_contracts,1);
});
test('operating costs cannot overdraw a treasury changed after preflight',async()=>{
 const {db,actor}=await setup();const c=await store.createCompany(db,actor.id,charter);const original=db.batch.bind(db);
 db.batch=async ss=>{db.raw.prepare('UPDATE companies SET treasury_cym=1 WHERE id=?').run(c.id);return original(ss);};
 await assert.rejects(store.deployCompany(db,c.id,actor.id,{action:'fund_experiment',budget_cym:30,idempotency_key:'race'},world),/insufficient/);
 assert.equal(db.raw.prepare('SELECT costs_cym FROM companies WHERE id=?').get(c.id).costs_cym,0);
 assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM journal WHERE kind='company_research_cost'").get().n,0);
});
test('terminal company contract failure reduces measured success rate without inventing revenue',async()=>{
 const {db,actor}=await setup();const c=await store.createCompany(db,actor.id,charter);
 const contract=await store.createContract(db,actor.id,{title:'Research reproducible productivity',description:'Research independently reproducible throughput improvements with public benchmark evidence.',category:'research',economic_purpose:'Increase productive throughput of the CYMONIA economic system.',metric_key:'contract_completion_rate_pct',baseline_value:50,target_direction:'increase',min_improvement_pct:20,reward_cym:40});
 await store.fundContract(db,contract.id);await store.deployCompany(db,c.id,actor.id,{action:'compete_for_contract',idempotency_key:'failure'},world);
 db.raw.prepare("UPDATE contracts SET status='cancelled' WHERE id=?").run(contract.id);
 db.raw.prepare("UPDATE contracts SET status='cancelled' WHERE id=?").run(contract.id);
 const row=db.raw.prepare('SELECT * FROM companies WHERE id=?').get(c.id);assert.equal(row.failed_contracts,1);assert.equal(row.revenues_cym,0);
});
test('founder can complete legacy charter and evolve strategy only with no active claims',async()=>{
 const {db,actor}=await setup();const c=await store.createCompany(db,actor.id,charter);
 db.raw.prepare("UPDATE companies SET mission='',target_problem='',strategy='',kpi='' WHERE id=?").run(c.id);
 assert.equal(typeof store.updateCompanyCharter,'function');
 await assert.rejects(store.updateCompanyCharter(db,c.id,'stranger',charter),/founder/);
 const restored=await store.updateCompanyCharter(db,c.id,actor.id,charter);assert.equal(restored.mission,charter.mission);
 await store.deployCompany(db,c.id,actor.id,{action:'fund_experiment',budget_cym:1,idempotency_key:'operated'},world);
 await assert.rejects(store.updateCompanyCharter(db,c.id,actor.id,{...charter,kpi:'failure_rate_pct'}),/immutable/);
 const evolved=await store.updateCompanyCharter(db,c.id,actor.id,{...charter,strategy:'matching'});assert.equal(evolved.strategy,'matching');
 const contract=await store.createContract(db,actor.id,{title:'Research reproducible productivity',description:'Research independently reproducible throughput improvements with public benchmark evidence.',category:'economy',economic_purpose:'Increase productive throughput of the CYMONIA economic system.',metric_key:'contract_completion_rate_pct',baseline_value:50,target_direction:'increase',min_improvement_pct:20,reward_cym:40});
 await store.fundContract(db,contract.id);await store.deployCompany(db,c.id,actor.id,{action:'compete_for_contract',idempotency_key:'claimed'},world);
 await assert.rejects(store.updateCompanyCharter(db,c.id,actor.id,{...charter,strategy:'verification'}),/active_contract/);
});
