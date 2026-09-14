import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateImprovement,
  evaluateProof,
  normalizeAmount,
  stakeUnitsForDeposit,
  validateContractDraft,
} from "../functions/_lib/economy.js";

const validDraft = {
  title: "Reduce failed contract settlements",
  description: "Investigate settlement failures and implement a measurable reduction without weakening proof rules.",
  category: "economy",
  economic_purpose: "Increase the reliability and productive throughput of the CYMONIA contract market.",
  metric_key: "contract_failure_rate_pct",
  baseline_value: 20,
  target_direction: "decrease",
  min_improvement_pct: 25,
  reward_cym: 40,
};

test("contract validation enforces measurable CYMONIA economic purpose", () => {
  assert.equal(validateContractDraft(validDraft).ok, true);
  const vague = validateContractDraft({ ...validDraft, economic_purpose: "make it better", metric_key: "" });
  assert.equal(vague.ok, false);
  assert.ok(vague.errors.includes("economic_purpose_required"));
  assert.ok(vague.errors.includes("metric_key_invalid"));
});

test("contract validation rejects unsupported categories and unsafe rewards", () => {
  const result = validateContractDraft({ ...validDraft, category: "random-client-work", reward_cym: 1000000 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("category_invalid"));
  assert.ok(result.errors.includes("reward_cym_invalid"));
});

test("improvement math respects increase and decrease direction", () => {
  assert.equal(calculateImprovement("increase", 100, 125), 25);
  assert.equal(calculateImprovement("decrease", 20, 15), 25);
  assert.equal(calculateImprovement("increase", 100, 90), -10);
  assert.equal(calculateImprovement("decrease", 20, 25), -25);
  assert.equal(calculateImprovement("increase", 0, 10), null);
});

test("proof must use preregistered baseline and clear threshold", () => {
  const contract = validDraft;
  const accepted = evaluateProof(contract, { before_value: 20, after_value: 14, evidence_url: "https://github.com/SignalLayerLabs/CYMONIA/pull/42" });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.observed_improvement_pct, 30);

  const weak = evaluateProof(contract, { before_value: 20, after_value: 17, evidence_url: "https://github.com/SignalLayerLabs/CYMONIA/pull/43" });
  assert.equal(weak.accepted, false);
  assert.equal(weak.reason, "threshold_not_met");

  const movedBaseline = evaluateProof(contract, { before_value: 10, after_value: 5, evidence_url: "https://github.com/SignalLayerLabs/CYMONIA/pull/44" });
  assert.equal(movedBaseline.accepted, false);
  assert.equal(movedBaseline.reason, "baseline_mismatch");
});

test("amount normalization blocks negative, non-finite and excessive values", () => {
  assert.equal(normalizeAmount("12.3456789", 100), 12.345679);
  for (const value of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, 101]) {
    assert.throws(() => normalizeAmount(value, 100));
  }
});

test("stake units are minted at company book value, not always one-to-one", () => {
  assert.equal(stakeUnitsForDeposit({ treasury_cym: 0, stake_units: 0 }, 25), 25);
  assert.equal(stakeUnitsForDeposit({ treasury_cym: 200, stake_units: 100 }, 50), 25);
});

import {
  parseCookies,
  sessionCookie,
  sha256Hex,
  createOpaqueToken,
} from "../functions/_lib/auth.js";
import {
  DEFAULT_BRAIN_MODEL,
  buildContractPrompt,
  parseBrainProposal,
} from "../functions/_lib/brain.js";

test("auth helpers parse cookies and emit hardened session cookie", async () => {
  assert.deepEqual(parseCookies("a=1; cymonia_session=abc%20123; empty="), {
    a: "1",
    cymonia_session: "abc 123",
    empty: "",
  });
  const cookie = sessionCookie("secret token", 3600);
  assert.match(cookie, /^cymonia_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=3600/);
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const token = createOpaqueToken();
  assert.ok(token.length >= 40);
  assert.notEqual(token, createOpaqueToken());
});

test("brain prompt keeps AI proposal-only and scoped to CYMONIA", () => {
  assert.equal(DEFAULT_BRAIN_MODEL, "@cf/zai-org/glm-4.7-flash");
  const prompt = buildContractPrompt({ epoch: 23, inflation_pct: 2.4, nominal_gdp: 901 });
  assert.match(prompt, /No Economic Purpose/i);
  assert.match(prompt, /CYMONIA/i);
  assert.match(prompt, /proposal/i);
  assert.match(prompt, /JSON/i);
});

test("brain parser accepts one strict economic-contract object and rejects prose", () => {
  const proposal = parseBrainProposal(JSON.stringify(validDraft));
  assert.equal(proposal.title, validDraft.title);
  assert.equal(validateContractDraft(proposal).ok, true);
  assert.throws(() => parseBrainProposal("I think you should increase GDP."));
  assert.throws(() => parseBrainProposal(JSON.stringify({ ...validDraft, economic_purpose: "nice" })));
});
