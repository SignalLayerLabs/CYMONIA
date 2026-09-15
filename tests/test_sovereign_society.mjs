import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {makeClaim,makeCommitment,formOrganization} from '../world/society.js';

test('claims may conflict because kernel does not choose social legitimacy',()=>{
  const w=createSovereignGenesis({seed:15,realEpochMs:0});
  const a=w.citizens[0],b=w.citizens[1];
  makeClaim(w,a,{subject:'site:1',predicate:'exclusive_access'},0);
  makeClaim(w,b,{subject:'site:1',predicate:'exclusive_access'},1);
  assert.equal(w.claims.length,2);
  assert.equal(w.claims[0].status,'asserted');
  assert.equal(w.claims[1].status,'asserted');
});

test('organizations require explicit member commitments',()=>{
  const w=createSovereignGenesis({seed:15,realEpochMs:0});
  const a=w.citizens[0],b=w.citizens[1];
  const ca=makeCommitment(w,a,{kind:'join',counterpartyId:b.id,terms:{purpose:'shared-work'}},0);
  const cb=makeCommitment(w,b,{kind:'join',counterpartyId:a.id,terms:{purpose:'shared-work'}},0);
  const org=formOrganization(w,[a,b],{purposeConcept:'shared-work',commitmentIds:[ca.id,cb.id]},1);
  assert.equal(org.members.length,2);
  assert.equal(org.observerClass,null);
});
