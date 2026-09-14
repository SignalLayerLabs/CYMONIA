import test from "node:test";
import assert from "node:assert/strict";

import {
  contractActionFor,
  formatCym,
  normalizeParticipationState,
  participationStatus,
} from "../site/participate.js";

test("participation state keeps CYM, reputation and stakes separate", () => {
  const state = normalizeParticipationState({
    actor: { id: "human:1", github_login: "builder" },
    wallet: { bootstrap_cym: 20, earned_cym: 42.5, reputation: 17 },
    treasury: { earned_cym: 9500 },
    contracts: [{ id: "c1", status: "funded", claimant_actor_id: null }],
    companies: [{ id: "co1", name: "Helix", treasury_cym: 120, stake_units: 100 }],
    stakes: [{ company_id: "co1", units: 10 }],
    proofs: [{ id: "p1", accepted: 1, observed_improvement_pct: 30 }],
  });
  assert.equal(state.wallet.bootstrap_cym, 20);
  assert.equal(state.wallet.earned_cym, 42.5);
  assert.equal(state.wallet.reputation, 17);
  assert.equal(state.companies[0].treasury_cym, 120);
  assert.equal(state.stakes[0].units, 10);
  assert.equal(state.proofs[0].observed_improvement_pct, 30);
});

test("contract actions reflect deterministic lifecycle", () => {
  const actor = { id: "human:1" };
  assert.equal(contractActionFor({ status: "proposed" }, actor), "fund");
  assert.equal(contractActionFor({ status: "funded", claimant_actor_id: null }, actor), "claim");
  assert.equal(contractActionFor({ status: "claimed", claimant_actor_id: "human:1" }, actor), "prove");
  assert.equal(contractActionFor({ status: "claimed", claimant_actor_id: "human:2" }, actor), null);
  assert.equal(contractActionFor({ status: "settled" }, actor), null);
});

test("status distinguishes static GitHub Pages from live participation", () => {
  assert.deepEqual(participationStatus({ ok: true }), { live: true, label: "LIVE ECONOMY" });
  assert.deepEqual(participationStatus(null), { live: false, label: "PARTICIPATION OFFLINE" });
});

test("CYM formatter does not imply fiat price", () => {
  assert.equal(formatCym(10), "10 CYM");
  assert.equal(formatCym(10.25), "10.25 CYM");
  assert.equal(formatCym(undefined), "0 CYM");
});
