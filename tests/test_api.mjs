import test from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../functions/api/[[path]].js";
import { D1TestDB } from "./helpers/d1.mjs";
import { createSession, ensureParticipationGenesis, upsertHumanFromGitHub } from "../functions/_lib/store.js";
import { hashSecretToken } from "../functions/_lib/auth.js";

const validDraft = {
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
  const DB = new D1TestDB();
  const env = {
    CYMONIA_DB: DB,
    TREASURY_GENESIS_CYM: "1000",
    SESSION_HASH_SECRET: "test-secret",
    GITHUB_CLIENT_ID: "github-client-id",
    GITHUB_CLIENT_SECRET: "github-secret",
    BRAIN_MODEL: "@cf/zai-org/glm-4.7-flash",
    TREASURY_STEWARD_LOGINS: "api-builder",
    AI: { run: async () => ({ response: JSON.stringify({ ...validDraft, baseline_value: 0 }) }) },
  };
  await ensureParticipationGenesis(DB, 1000);
  const human = await upsertHumanFromGitHub(DB, { id: 321, login: "api-builder", name: "API Builder", avatar_url: null });
  const rawToken = "session-token-for-tests";
  const tokenHash = await hashSecretToken(rawToken, env.SESSION_HASH_SECRET);
  await createSession(DB, human.actor.id, tokenHash, "2099-01-01T00:00:00Z");
  return { DB, env, human, rawToken };
}

async function call(env, path, { method = "GET", body, token, headers = {} } = {}) {
  const h = new Headers(headers);
  if (body !== undefined) {
    h.set("content-type", h.get("content-type") || "application/json");
  }
  if (token) h.set("cookie", `cymonia_session=${encodeURIComponent(token)}`);
  const request = new Request(`https://cymonia.example${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    redirect: "manual",
  });
  return onRequest({ request, env });
}

async function json(response) { return response.json(); }

test("health is public and states the North Star", async () => {
  const { env } = await setup();
  const response = await call(env, "/api/health");
  assert.equal(response.status, 200);
  const data = await json(response);
  assert.equal(data.ok, true);
  assert.equal(data.north_star, "detect-fund-work-prove-settle-learn");
  assert.equal(data.external_token, false);
  assert.equal(data.default_brain_model, "@cf/zai-org/glm-4.7-flash");
  assert.equal(data.personal_agent_ai, "workers-ai");
  assert.equal(data.d1_bound, true);
});

test("state mutation requires session and application/json", async () => {
  const { env, rawToken } = await setup();
  let response = await call(env, "/api/contracts", { method: "POST", body: validDraft });
  assert.equal(response.status, 401);
  response = await call(env, "/api/contracts", { method: "POST", body: JSON.stringify(validDraft), token: rawToken, headers: { "content-type": "text/plain" } });
  assert.equal(response.status, 415);
});

test("authenticated human can create, fund, claim and settle an Economic Contract", async () => {
  const { env, rawToken } = await setup();
  let response = await call(env, "/api/contracts", { method: "POST", body: validDraft, token: rawToken });
  assert.equal(response.status, 201);
  const created = (await json(response)).contract;

  response = await call(env, `/api/contracts/${encodeURIComponent(created.id)}/fund`, { method: "POST", body: {}, token: rawToken });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).contract.status, "funded");

  response = await call(env, `/api/contracts/${encodeURIComponent(created.id)}/claim`, { method: "POST", body: {}, token: rawToken });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).contract.status, "claimed");

  response = await call(env, `/api/contracts/${encodeURIComponent(created.id)}/proof`, {
    method: "POST", token: rawToken,
    body: { before_value: 50, after_value: 65, evidence_url: "https://github.com/SignalLayerLabs/CYMONIA/pull/9", evidence_summary: "Deterministic replay passed." },
  });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).proof.accepted, true);

  response = await call(env, "/api/state", { token: rawToken });
  const state = await json(response);
  assert.equal(state.wallet.earned_cym, 40);
  assert.equal(state.wallet.reputation, 10);
});

test("AI can propose but cannot fund or settle", async () => {
  const { env, rawToken } = await setup();
  const response = await call(env, "/api/brain/propose", { method: "POST", body: {}, token: rawToken });
  assert.equal(response.status, 200);
  const data = await json(response);
  assert.equal(data.proposal.title, validDraft.title);
  assert.equal(data.proposal_only, true);
  assert.equal(data.model, "@cf/zai-org/glm-4.7-flash");
});

test("earned capital can be deployed into an AI Company", async () => {
  const { env, DB, human, rawToken } = await setup();
  DB.raw.prepare("UPDATE wallets SET earned_cym=200 WHERE actor_id=?").run(human.actor.id);
  let response = await call(env, "/api/companies", { method: "POST", token: rawToken, body: { name: "Helix Markets", purpose: "Detect and reduce inefficiencies inside the CYMONIA economy.", mission: "Reduce failed economic work through reproducible experiments.", target_problem: "Too many contracts fail independent verification.", strategy: "research", kpi: "completion_rate_pct", contribution_cym: 100 } });
  assert.equal(response.status, 201);
  const company = (await json(response)).company;
  response = await call(env, `/api/companies/${encodeURIComponent(company.id)}/stake`, { method: "POST", token: rawToken, body: { amount_cym: 25 } });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).stake.units_minted, 25);
});

test("GitHub auth start stores state and redirects without rewarding a star", async () => {
  const { env, DB } = await setup();
  const response = await call(env, "/api/auth/github?return_to=%2F%23participate");
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  assert.match(response.headers.get("set-cookie"), /cymonia_oauth_state=/);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM oauth_states").get().n, 1);
});

test("founder can claim work through an AI Company and PoEC grows company treasury", async () => {
  const { env, DB, human, rawToken } = await setup();
  DB.raw.prepare("UPDATE wallets SET earned_cym=100 WHERE actor_id=?").run(human.actor.id);
  let response = await call(env, "/api/companies", { method: "POST", token: rawToken, body: { name: "Atlas Research", purpose: "Research measurable improvements to the CYMONIA economy.", mission: "Reduce failed economic work through reproducible experiments.", target_problem: "Too many contracts fail independent verification.", strategy: "research", kpi: "completion_rate_pct", contribution_cym: 50 } });
  const company = (await json(response)).company;

  response = await call(env, "/api/contracts", { method: "POST", body: { ...validDraft, title: "Increase company-delivered economic throughput" }, token: rawToken });
  const contract = (await json(response)).contract;
  await call(env, `/api/contracts/${encodeURIComponent(contract.id)}/fund`, { method: "POST", body: {}, token: rawToken });

  response = await call(env, `/api/contracts/${encodeURIComponent(contract.id)}/claim`, { method: "POST", body: { company_id: company.id }, token: rawToken });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).contract.claimant_actor_id, company.id);

  response = await call(env, `/api/contracts/${encodeURIComponent(contract.id)}/proof`, { method: "POST", token: rawToken, body: { before_value: 50, after_value: 65, evidence_url: "https://github.com/SignalLayerLabs/CYMONIA/pull/88", evidence_summary: "Company delivered the measured improvement." } });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).proof.accepted, true);
  const companyRow = DB.raw.prepare("SELECT treasury_cym,stake_units FROM companies WHERE id=?").get(company.id);
  assert.equal(companyRow.treasury_cym, 90);
  assert.equal(companyRow.stake_units, 50);
  const founderWallet = DB.raw.prepare("SELECT earned_cym,reputation FROM wallets WHERE actor_id=?").get(human.actor.id);
  assert.equal(founderWallet.earned_cym, 50);
  assert.equal(founderWallet.reputation, 10);
});
