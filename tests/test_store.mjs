import test from "node:test";
import assert from "node:assert/strict";
import {
  createContract,
  createCompany,
  ensureParticipationGenesis,
  fundContract,
  getParticipationSnapshot,
  stakeInCompany,
  submitProof,
  upsertHumanFromGitHub,
  claimContract,
} from "../functions/_lib/store.js";

import { D1TestDB } from "./helpers/d1.mjs";

const draft = {
  title: "Improve contract completion rate",
  description: "Diagnose failed CYMONIA contracts and raise measurable completion without weakening proof requirements.",
  category: "economy",
  economic_purpose: "Increase productive throughput of CYMONIA's internal contract economy.",
  metric_key: "contract_completion_rate_pct",
  baseline_value: 50,
  target_direction: "increase",
  min_improvement_pct: 20,
  reward_cym: 40,
};

async function setup() {
  const db = new D1TestDB();
  await ensureParticipationGenesis(db, 1000);
  const human = await upsertHumanFromGitHub(db, { id: 123, login: "builder", name: "Builder", avatar_url: "https://example.test/avatar" });
  return { db, human };
}

test("participation genesis seeds contribution treasury exactly once", async () => {
  const db = new D1TestDB();
  await ensureParticipationGenesis(db, 1000);
  await ensureParticipationGenesis(db, 1000);
  const wallet = db.raw.prepare("SELECT earned_cym FROM wallets WHERE actor_id=?").get("CYMONIA_CONTRIBUTION_TREASURY");
  const journal = db.raw.prepare("SELECT COUNT(*) AS n FROM journal WHERE idempotency_key='participation:genesis'").get();
  assert.equal(wallet.earned_cym, 1000);
  assert.equal(journal.n, 1);
});

test("GitHub identity gets bootstrap once and never earned CYM for login", async () => {
  const db = new D1TestDB();
  const first = await upsertHumanFromGitHub(db, { id: 42, login: "renato", name: "Renato", avatar_url: null });
  const second = await upsertHumanFromGitHub(db, { id: 42, login: "renato-new", name: "Renato V", avatar_url: null });
  assert.equal(first.wallet.bootstrap_cym, 20);
  assert.equal(first.wallet.earned_cym, 0);
  assert.equal(second.wallet.bootstrap_cym, 20);
  assert.equal(second.wallet.earned_cym, 0);
  assert.equal(second.actor.github_login, "renato-new");
});

test("funding moves treasury CYM into escrow once", async () => {
  const { db, human } = await setup();
  const contract = await createContract(db, human.actor.id, draft);
  const once = await fundContract(db, contract.id);
  const twice = await fundContract(db, contract.id);
  assert.equal(once.status, "funded");
  assert.equal(once.escrow_cym, 40);
  assert.equal(twice.escrow_cym, 40);
  const treasury = db.raw.prepare("SELECT earned_cym FROM wallets WHERE actor_id=?").get("CYMONIA_CONTRIBUTION_TREASURY");
  assert.equal(treasury.earned_cym, 960);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM contract_fundings WHERE contract_id=?").get(contract.id).n, 1);
});

test("accepted PoEC releases escrow and reputation once; weak proof pays nothing", async () => {
  const { db, human } = await setup();
  const weakContract = await createContract(db, human.actor.id, { ...draft, title: "Improve matching completion rate" });
  await fundContract(db, weakContract.id);
  await claimContract(db, weakContract.id, human.actor.id);
  const weak = await submitProof(db, weakContract.id, human.actor.id, {
    before_value: 50, after_value: 55, evidence_url: "https://github.com/SignalLayerLabs/CYMONIA/pull/1", evidence_summary: "Measured replay",
  });
  assert.equal(weak.accepted, false);
  let wallet = db.raw.prepare("SELECT earned_cym,reputation FROM wallets WHERE actor_id=?").get(human.actor.id);
  assert.equal(wallet.earned_cym, 0);
  assert.equal(wallet.reputation, 0);

  const strong = await submitProof(db, weakContract.id, human.actor.id, {
    before_value: 50, after_value: 65, evidence_url: "https://github.com/SignalLayerLabs/CYMONIA/pull/2", evidence_summary: "Deterministic benchmark",
  });
  assert.equal(strong.accepted, true);
  const retry = await submitProof(db, weakContract.id, human.actor.id, {
    before_value: 50, after_value: 65, evidence_url: "https://github.com/SignalLayerLabs/CYMONIA/pull/2", evidence_summary: "Duplicate submit",
  });
  assert.equal(retry.already_settled, true);
  wallet = db.raw.prepare("SELECT earned_cym,reputation FROM wallets WHERE actor_id=?").get(human.actor.id);
  assert.equal(wallet.earned_cym, 40);
  assert.equal(wallet.reputation, 10);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM settlements WHERE contract_id=?").get(weakContract.id).n, 1);
});

test("earned CYM can create a company and later stakes mint at book value", async () => {
  const { db, human } = await setup();
  db.raw.prepare("UPDATE wallets SET earned_cym=200 WHERE actor_id=?").run(human.actor.id);
  const company = await createCompany(db, human.actor.id, { name: "Helix Markets", purpose: "Detect and reduce inefficiencies inside CYMONIA.", mission: "Reduce failed economic work through reproducible experiments.", target_problem: "Too many contracts fail independent verification.", strategy: "research", kpi: "completion_rate_pct", contribution_cym: 100 });
  assert.equal(company.treasury_cym, 100);
  assert.equal(company.stake_units, 100);
  let founder = db.raw.prepare("SELECT earned_cym FROM wallets WHERE actor_id=?").get(human.actor.id);
  assert.equal(founder.earned_cym, 100);

  db.raw.prepare("UPDATE companies SET treasury_cym=200 WHERE id=?").run(company.id);
  const stake = await stakeInCompany(db, company.id, human.actor.id, 50);
  assert.equal(stake.units_minted, 25);
  const refreshed = db.raw.prepare("SELECT treasury_cym,stake_units FROM companies WHERE id=?").get(company.id);
  assert.equal(refreshed.treasury_cym, 250);
  assert.equal(refreshed.stake_units, 125);
  founder = db.raw.prepare("SELECT earned_cym FROM wallets WHERE actor_id=?").get(human.actor.id);
  assert.equal(founder.earned_cym, 50);
});

test("participation snapshot exposes North-Star operating state", async () => {
  const { db, human } = await setup();
  const contract = await createContract(db, human.actor.id, draft);
  await fundContract(db, contract.id);
  const snapshot = await getParticipationSnapshot(db, human.actor.id);
  assert.equal(snapshot.north_star, "detect-fund-work-prove-settle-learn");
  assert.equal(snapshot.wallet.bootstrap_cym, 20);
  assert.equal(snapshot.treasury.earned_cym, 960);
  assert.equal(snapshot.contracts[0].status, "funded");
  assert.ok(Array.isArray(snapshot.companies));
  assert.ok(Array.isArray(snapshot.proofs));
});

test("AI Company can earn CYM from PoEC and increase stake book value", async () => {
  const { db, human } = await setup();
  db.raw.prepare("UPDATE wallets SET earned_cym=100 WHERE actor_id=?").run(human.actor.id);
  const company = await createCompany(db, human.actor.id, { name: "Atlas Research", purpose: "Research measurable improvements to the CYMONIA economy.", mission: "Reduce failed economic work through reproducible experiments.", target_problem: "Too many contracts fail independent verification.", strategy: "research", kpi: "completion_rate_pct", contribution_cym: 50 });
  const contract = await createContract(db, human.actor.id, { ...draft, title: "Increase verified completion throughput" });
  await fundContract(db, contract.id);
  await claimContract(db, contract.id, company.id);
  const proof = await submitProof(db, contract.id, human.actor.id, {
    before_value: 50, after_value: 65, evidence_url: "https://github.com/SignalLayerLabs/CYMONIA/pull/77", evidence_summary: "Company experiment improved the preregistered metric.",
  }, { recipientActorId: company.id });
  assert.equal(proof.accepted, true);
  const refreshed = db.raw.prepare("SELECT treasury_cym,stake_units FROM companies WHERE id=?").get(company.id);
  assert.equal(refreshed.treasury_cym, 90);
  assert.equal(refreshed.stake_units, 50);
  const founder = db.raw.prepare("SELECT earned_cym,reputation FROM wallets WHERE actor_id=?").get(human.actor.id);
  assert.equal(founder.earned_cym, 50);
  assert.equal(founder.reputation, 10);
  const settlement = db.raw.prepare("SELECT recipient_actor_id,amount_cym FROM settlements WHERE contract_id=?").get(contract.id);
  assert.equal(settlement.recipient_actor_id, company.id);
  assert.equal(settlement.amount_cym, 40);
});
