import {
  AUTH_COOKIE_NAMES,
  clearOauthStateCookie,
  clearSessionCookie,
  createOpaqueToken,
  hashSecretToken,
  oauthStateCookie,
  parseCookies,
  sessionCookie,
} from "../_lib/auth.js";
import { DEFAULT_BRAIN_MODEL, proposeContractWithWorkersAI } from "../_lib/brain.js";
import { errorResponse, json, readJson, redirect, requireActor, safeReturnTo, sessionActor } from "../_lib/http.js";
import {
  claimContract,
  consumeOauthState,
  createCompany,
  createContract,
  createSession,
  deleteSession,
  ensureParticipationGenesis,
  fundContract,
  getParticipationSnapshot,
  getContract,
  isCompanyFounder,
  saveOauthState,
  stakeInCompany,
  submitProof,
  upsertHumanFromGitHub,
} from "../_lib/store.js";

function db(env) {
  if (!env?.CYMONIA_DB) throw new Error("CYMONIA_DB_not_bound");
  return env.CYMONIA_DB;
}

function genesisAmount(env) {
  const amount = Number(env.TREASURY_GENESIS_CYM || 10000);
  return Number.isFinite(amount) && amount > 0 ? amount : 10000;
}

function segments(request) {
  return new URL(request.url).pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent);
}

function isPost(request) { return request.method.toUpperCase() === "POST"; }
function sqlTimestamp(ms) { return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, ""); }

function isSteward(actor, env) {
  const allowed = String(env.TREASURY_STEWARD_LOGINS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(String(actor?.github_login || "").toLowerCase());
}

function participationMetrics(snapshot) {
  const total = snapshot.contracts.length;
  const settled = snapshot.contracts.filter((c) => c.status === "settled").length;
  const claimed = snapshot.contracts.filter((c) => c.status === "claimed").length;
  const funded = snapshot.contracts.filter((c) => ["funded", "claimed"].includes(c.status)).length;
  const open = snapshot.contracts.filter((c) => !["settled", "cancelled"].includes(c.status)).length;
  return {
    contract_count: total,
    contract_settled_count: settled,
    contract_claimed_count: claimed,
    contract_open_count: open,
    contract_funded_open_count: funded,
    contract_completion_rate_pct: total ? (settled / total) * 100 : 0,
    company_count: snapshot.companies.length,
    proof_count: snapshot.proofs.length,
    accepted_proof_count: snapshot.proofs.filter((p) => Number(p.accepted) === 1).length,
    rejected_proof_count: snapshot.proofs.filter((p) => Number(p.accepted) !== 1).length,
    mean_accepted_improvement_pct: (() => {
      const accepted = snapshot.proofs.filter((p) => Number(p.accepted) === 1 && Number.isFinite(Number(p.observed_improvement_pct)));
      return accepted.length ? accepted.reduce((sum, p) => sum + Number(p.observed_improvement_pct), 0) / accepted.length : 0;
    })(),
    recent_verified_outcomes: snapshot.proofs.filter((p) => Number(p.accepted) === 1).slice(0, 12).map((p) => ({ metric_key: p.metric_key, observed_improvement_pct: p.observed_improvement_pct, title: p.title })),
    contribution_treasury_cym: Number(snapshot.treasury?.earned_cym || 0),
  };
}

async function authStart(request, env) {
  if (!env.GITHUB_CLIENT_ID) throw new Error("GITHUB_CLIENT_ID_not_configured");
  const url = new URL(request.url);
  const rawState = createOpaqueToken(24);
  const stateHash = await hashSecretToken(rawState, String(env.SESSION_HASH_SECRET || ""));
  const returnTo = safeReturnTo(url.searchParams.get("return_to"));
  await saveOauthState(db(env), stateHash, returnTo, sqlTimestamp(Date.now() + 10 * 60 * 1000));
  const callback = new URL("/api/auth/callback", request.url).href;
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", callback);
  authorize.searchParams.set("state", rawState);
  const headers = new Headers();
  headers.append("set-cookie", oauthStateCookie(rawState));
  return redirect(authorize.href, 302, headers);
}

async function authCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const cookies = parseCookies(request.headers.get("cookie") || "");
  if (!code || !state || cookies[AUTH_COOKIE_NAMES.oauthState] !== state) {
    const error = new Error("oauth_state_invalid"); error.status = 400; throw error;
  }
  const stateHash = await hashSecretToken(state, String(env.SESSION_HASH_SECRET || ""));
  const saved = await consumeOauthState(db(env), stateHash);
  if (!saved) { const error = new Error("oauth_state_expired"); error.status = 400; throw error; }
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) throw new Error("github_oauth_not_configured");
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "CYMONIA" },
    body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: new URL("/api/auth/callback", request.url).href }),
  });
  if (!tokenResponse.ok) throw new Error("github_token_exchange_failed");
  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) throw new Error("github_access_token_missing");
  const userResponse = await fetch("https://api.github.com/user", {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${tokenData.access_token}`, "user-agent": "CYMONIA" },
  });
  if (!userResponse.ok) throw new Error("github_identity_lookup_failed");
  const githubUser = await userResponse.json();
  const human = await upsertHumanFromGitHub(db(env), githubUser);
  const rawSession = createOpaqueToken(32);
  const sessionHash = await hashSecretToken(rawSession, String(env.SESSION_HASH_SECRET || ""));
  await createSession(db(env), human.actor.id, sessionHash, sqlTimestamp(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const headers = new Headers();
  headers.append("set-cookie", sessionCookie(rawSession));
  headers.append("set-cookie", clearOauthStateCookie());
  return redirect(saved.return_to || "/#participate", 302, headers);
}

async function logout(request, env) {
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const raw = cookies[AUTH_COOKIE_NAMES.session];
  if (raw && env.SESSION_HASH_SECRET) {
    await deleteSession(db(env), await hashSecretToken(raw, String(env.SESSION_HASH_SECRET)));
  }
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}

async function handle(request, env) {
  const parts = segments(request);
  const method = request.method.toUpperCase();

  if (parts[0] === "health" && method === "GET") {
    return json({ ok: true, service: "cymonia-participation-alpha", north_star: "detect-fund-work-prove-settle-learn", external_token: false, default_brain_model: env.BRAIN_MODEL || DEFAULT_BRAIN_MODEL });
  }

  if (parts[0] === "auth" && parts[1] === "github" && method === "GET") return authStart(request, env);
  if (parts[0] === "auth" && parts[1] === "callback" && method === "GET") return authCallback(request, env);
  if (parts[0] === "auth" && parts[1] === "logout" && isPost(request)) { await readJson(request); return logout(request, env); }

  await ensureParticipationGenesis(db(env), genesisAmount(env));

  if (parts[0] === "state" && method === "GET") {
    const actor = await sessionActor(request, env);
    return json(await getParticipationSnapshot(db(env), actor?.id || null));
  }

  const actor = await requireActor(request, env);

  if (parts[0] === "contracts" && parts.length === 1 && isPost(request)) {
    const body = await readJson(request);
    const contract = await createContract(db(env), actor.id, body, { source: "human" });
    return json({ ok: true, contract }, 201);
  }
  if (parts[0] === "contracts" && parts[2] === "fund" && isPost(request)) {
    await readJson(request);
    if (!isSteward(actor, env)) { const error = new Error("treasury_steward_required"); error.status = 403; throw error; }
    return json({ ok: true, contract: await fundContract(db(env), parts[1]) });
  }
  if (parts[0] === "contracts" && parts[2] === "claim" && isPost(request)) {
    const body = await readJson(request);
    let claimant = actor.id;
    if (body.company_id) {
      const allowed = await isCompanyFounder(db(env), String(body.company_id), actor.id);
      if (!allowed) { const error = new Error("company_control_required"); error.status = 403; throw error; }
      claimant = String(body.company_id);
    }
    return json({ ok: true, contract: await claimContract(db(env), parts[1], claimant) });
  }
  if (parts[0] === "contracts" && parts[2] === "proof" && isPost(request)) {
    const body = await readJson(request);
    const contract = await getContract(db(env), parts[1]);
    if (!contract) { const error = new Error("contract_not_found"); error.status = 404; throw error; }
    let recipient = actor.id;
    if (contract.claimant_actor_id !== actor.id) {
      const allowed = await isCompanyFounder(db(env), contract.claimant_actor_id, actor.id);
      if (!allowed) { const error = new Error("company_control_required"); error.status = 403; throw error; }
      recipient = contract.claimant_actor_id;
    }
    return json({ ok: true, proof: await submitProof(db(env), parts[1], actor.id, body, { recipientActorId: recipient }) });
  }
  if (parts[0] === "companies" && parts.length === 1 && isPost(request)) {
    const body = await readJson(request);
    return json({ ok: true, company: await createCompany(db(env), actor.id, body) }, 201);
  }
  if (parts[0] === "companies" && parts[2] === "stake" && isPost(request)) {
    const body = await readJson(request);
    return json({ ok: true, stake: await stakeInCompany(db(env), parts[1], actor.id, body.amount_cym) });
  }
  if (parts[0] === "brain" && parts[1] === "propose" && isPost(request)) {
    await readJson(request);
    const snapshot = await getParticipationSnapshot(db(env), actor.id);
    const { model, proposal } = await proposeContractWithWorkersAI(env, participationMetrics(snapshot));
    return json({ ok: true, proposal_only: true, model, proposal });
  }

  return json({ ok: false, error: "not_found" }, 404);
}

export async function onRequest({ request, env }) {
  try {
    return await handle(request, env);
  } catch (error) {
    return errorResponse(error);
  }
}
