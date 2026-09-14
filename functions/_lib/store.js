import { evaluateProof, normalizeAmount, stakeUnitsForDeposit, validateContractDraft } from "./economy.js";

export const TREASURY_ID = "CYMONIA_CONTRIBUTION_TREASURY";
export const BOOTSTRAP_CYM = 20;
export const DEFAULT_COMPANY_CREATION_CYM = 50;

function uuid(prefix) {
  return `${prefix}:${crypto.randomUUID()}`;
}

async function first(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

async function results(db, sql, ...params) {
  const out = await db.prepare(sql).bind(...params).all();
  return out?.results || [];
}

async function run(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

function changes(result) {
  return Number(result?.meta?.changes || 0);
}

export async function ensureParticipationGenesis(db, amount = 10000) {
  const genesis = normalizeAmount(amount, 1_000_000_000);
  const state = await first(db, "SELECT value FROM system_state WHERE key='participation_genesis_initialized'");
  if (state?.value === "1") {
    return first(db, "SELECT * FROM wallets WHERE actor_id=?", TREASURY_ID);
  }
  const journalId = uuid("journal");
  await db.batch([
    db.prepare("UPDATE wallets SET earned_cym=earned_cym+?, updated_at=datetime('now') WHERE actor_id=? AND EXISTS(SELECT 1 FROM system_state WHERE key='participation_genesis_initialized' AND value='0') AND NOT EXISTS(SELECT 1 FROM journal WHERE idempotency_key='participation:genesis')").bind(genesis, TREASURY_ID),
    db.prepare("INSERT OR IGNORE INTO journal(id,idempotency_key,kind,from_account,to_account,amount_cym,metadata_json) SELECT ?,'participation:genesis','participation_genesis',NULL,?,?,? WHERE NOT EXISTS(SELECT 1 FROM journal WHERE idempotency_key='participation:genesis')").bind(journalId, TREASURY_ID, genesis, JSON.stringify({ experimental_reserve: true })),
    db.prepare("UPDATE system_state SET value='1', updated_at=datetime('now') WHERE key='participation_genesis_initialized'"),
  ]);
  return first(db, "SELECT * FROM wallets WHERE actor_id=?", TREASURY_ID);
}

export async function upsertHumanFromGitHub(db, githubUser) {
  const githubId = Number(githubUser?.id);
  const login = String(githubUser?.login || "").trim();
  if (!Number.isSafeInteger(githubId) || githubId <= 0 || !login) throw new TypeError("github_identity_invalid");
  let actor = await first(db, "SELECT * FROM actors WHERE github_id=?", githubId);
  const actorId = actor?.id || `human:github:${githubId}`;
  await run(
    db,
    "INSERT INTO actors(id,actor_type,github_id,github_login,display_name,avatar_url) VALUES(?,?,?,?,?,?) ON CONFLICT(github_id) DO UPDATE SET github_login=excluded.github_login, display_name=excluded.display_name, avatar_url=excluded.avatar_url",
    actorId,
    "human",
    githubId,
    login,
    githubUser?.name ? String(githubUser.name).slice(0, 200) : null,
    githubUser?.avatar_url ? String(githubUser.avatar_url).slice(0, 500) : null,
  );
  await run(db, "INSERT OR IGNORE INTO wallets(actor_id,bootstrap_cym,earned_cym,reputation) VALUES(?,?,0,0)", actorId, BOOTSTRAP_CYM);
  actor = await first(db, "SELECT * FROM actors WHERE github_id=?", githubId);
  const wallet = await first(db, "SELECT * FROM wallets WHERE actor_id=?", actor.id);
  return { actor, wallet };
}

export async function createContract(db, creatorActorId, draft, { source = "human" } = {}) {
  const validation = validateContractDraft(draft);
  if (!validation.ok) {
    const error = new TypeError(`contract_invalid:${validation.errors.join(",")}`);
    error.validation = validation;
    throw error;
  }
  if (!["human", "agent", "system"].includes(source)) throw new TypeError("contract_source_invalid");
  const id = uuid("contract");
  await run(
    db,
    `INSERT INTO contracts(id,creator_actor_id,source,title,description,category,economic_purpose,metric_key,baseline_value,target_direction,min_improvement_pct,reward_cym,purpose_score,status)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'proposed')`,
    id,
    creatorActorId,
    source,
    String(draft.title).trim(),
    String(draft.description).trim(),
    draft.category,
    String(draft.economic_purpose).trim(),
    String(draft.metric_key).trim(),
    Number(draft.baseline_value),
    draft.target_direction,
    Number(draft.min_improvement_pct),
    normalizeAmount(draft.reward_cym, 10000),
    validation.score,
  );
  return first(db, "SELECT * FROM contracts WHERE id=?", id);
}

export async function fundContract(db, contractId) {
  const contract = await first(db, "SELECT * FROM contracts WHERE id=?", contractId);
  if (!contract) throw new Error("contract_not_found");
  if (contract.status === "funded" || contract.status === "claimed" || contract.status === "settled") return contract;
  if (contract.status !== "proposed") throw new Error("contract_not_fundable");
  const fundingKey = `contract:fund:${contractId}`;
  const journalId = uuid("journal");
  await db.batch([
    db.prepare(`UPDATE contracts SET status='funded', escrow_cym=reward_cym, updated_at=datetime('now')
      WHERE id=? AND status='proposed' AND purpose_score>=100
      AND EXISTS(SELECT 1 FROM wallets WHERE actor_id=? AND earned_cym>=contracts.reward_cym)`).bind(contractId, TREASURY_ID),
    db.prepare(`INSERT OR IGNORE INTO contract_fundings(contract_id,amount_cym,funded_by_account)
      SELECT id,reward_cym,? FROM contracts WHERE id=? AND status='funded'`).bind(TREASURY_ID, contractId),
    db.prepare(`UPDATE wallets SET earned_cym=earned_cym-(SELECT amount_cym FROM contract_fundings WHERE contract_id=?), updated_at=datetime('now')
      WHERE actor_id=? AND EXISTS(SELECT 1 FROM contract_fundings WHERE contract_id=?)
      AND NOT EXISTS(SELECT 1 FROM journal WHERE idempotency_key=?)`).bind(contractId, TREASURY_ID, contractId, fundingKey),
    db.prepare(`INSERT OR IGNORE INTO journal(id,idempotency_key,kind,from_account,to_account,amount_cym,metadata_json)
      SELECT ?,?,'contract_funding',?,('escrow:' || contract_id),amount_cym,? FROM contract_fundings WHERE contract_id=?`).bind(
      journalId,
      fundingKey,
      TREASURY_ID,
      JSON.stringify({ contract_id: contractId }),
      contractId,
    ),
  ]);
  const funded = await first(db, "SELECT * FROM contracts WHERE id=?", contractId);
  if (funded.status !== "funded") throw new Error("treasury_insufficient_or_contract_invalid");
  return funded;
}

export async function getContract(db, contractId) {
  return first(db, "SELECT * FROM contracts WHERE id=?", contractId);
}

export async function claimContract(db, contractId, actorId) {
  const current = await first(db, "SELECT * FROM contracts WHERE id=?", contractId);
  if (!current) throw new Error("contract_not_found");
  if (current.status === "claimed" && current.claimant_actor_id === actorId) return current;
  if (current.status !== "funded") throw new Error("contract_not_claimable");
  const result = await run(db, "UPDATE contracts SET status='claimed', claimant_actor_id=?, updated_at=datetime('now') WHERE id=? AND status='funded' AND claimant_actor_id IS NULL", actorId, contractId);
  if (!changes(result)) throw new Error("contract_already_claimed");
  return first(db, "SELECT * FROM contracts WHERE id=?", contractId);
}

export async function submitProof(db, contractId, contributorActorId, proof, { recipientActorId = contributorActorId } = {}) {
  const contract = await first(db, "SELECT * FROM contracts WHERE id=?", contractId);
  if (!contract) throw new Error("contract_not_found");
  if (contract.status === "settled") {
    const settlement = await first(db, "SELECT * FROM settlements WHERE contract_id=?", contractId);
    return { accepted: true, already_settled: true, settlement };
  }
  if (contract.status !== "claimed" || contract.claimant_actor_id !== recipientActorId) throw new Error("contract_not_owned_by_contributor");
  const recipient = await first(db, "SELECT actor_type FROM actors WHERE id=?", recipientActorId);
  if (!recipient || !["human", "company"].includes(recipient.actor_type)) throw new Error("settlement_recipient_invalid");
  const evaluation = evaluateProof(contract, proof);
  const proofId = uuid("proof");
  const summary = String(proof?.evidence_summary || "").trim().slice(0, 4000);
  if (!evaluation.accepted) {
    await run(
      db,
      "INSERT INTO proofs(id,contract_id,contributor_actor_id,before_value,after_value,observed_improvement_pct,evidence_url,evidence_summary,accepted,reason) VALUES(?,?,?,?,?,?,?,?,0,?)",
      proofId,
      contractId,
      contributorActorId,
      Number(proof.before_value),
      Number(proof.after_value),
      evaluation.observed_improvement_pct,
      String(proof.evidence_url || "").trim(),
      summary,
      evaluation.reason,
    );
    return { ...evaluation, proof_id: proofId };
  }

  const settleKey = `contract:settle:${contractId}`;
  const journalId = uuid("journal");
  const statements = [
    db.prepare("INSERT INTO proofs(id,contract_id,contributor_actor_id,before_value,after_value,observed_improvement_pct,evidence_url,evidence_summary,accepted,reason) VALUES(?,?,?,?,?,?,?,?,1,?)").bind(
      proofId,
      contractId,
      contributorActorId,
      Number(proof.before_value),
      Number(proof.after_value),
      evaluation.observed_improvement_pct,
      String(proof.evidence_url || "").trim(),
      summary,
      evaluation.reason,
    ),
    db.prepare("UPDATE contracts SET status='settled', escrow_cym=0, updated_at=datetime('now') WHERE id=? AND status='claimed' AND claimant_actor_id=? AND NOT EXISTS(SELECT 1 FROM settlements WHERE contract_id=?)").bind(contractId, recipientActorId, contractId),
    db.prepare("INSERT OR IGNORE INTO settlements(contract_id,proof_id,recipient_actor_id,amount_cym) SELECT id,?,?,reward_cym FROM contracts WHERE id=? AND status='settled' AND NOT EXISTS(SELECT 1 FROM settlements WHERE contract_id=?)").bind(proofId, recipientActorId, contractId, contractId),
  ];
  if (recipient.actor_type === "human") {
    statements.push(
      db.prepare("UPDATE wallets SET earned_cym=earned_cym+(SELECT amount_cym FROM settlements WHERE contract_id=?), reputation=reputation+10, updated_at=datetime('now') WHERE actor_id=? AND EXISTS(SELECT 1 FROM settlements WHERE contract_id=?) AND NOT EXISTS(SELECT 1 FROM journal WHERE idempotency_key=?)").bind(contractId, recipientActorId, contractId, settleKey),
    );
  } else {
    statements.push(
      db.prepare("UPDATE companies SET treasury_cym=treasury_cym+(SELECT amount_cym FROM settlements WHERE contract_id=?) WHERE id=? AND EXISTS(SELECT 1 FROM settlements WHERE contract_id=?) AND NOT EXISTS(SELECT 1 FROM journal WHERE idempotency_key=?)").bind(contractId, recipientActorId, contractId, settleKey),
      db.prepare("UPDATE wallets SET reputation=reputation+10, updated_at=datetime('now') WHERE actor_id=? AND NOT EXISTS(SELECT 1 FROM journal WHERE idempotency_key=?)").bind(contributorActorId, settleKey),
    );
  }
  statements.push(
    db.prepare("INSERT OR IGNORE INTO journal(id,idempotency_key,kind,from_account,to_account,amount_cym,metadata_json) SELECT ?,?,'poec_settlement',('escrow:' || contract_id),recipient_actor_id,amount_cym,? FROM settlements WHERE contract_id=?").bind(
      journalId,
      settleKey,
      JSON.stringify({ contract_id: contractId, proof_id: proofId, contributor_actor_id: contributorActorId, observed_improvement_pct: evaluation.observed_improvement_pct }),
      contractId,
    ),
  );
  await db.batch(statements);
  const settlement = await first(db, "SELECT * FROM settlements WHERE contract_id=?", contractId);
  if (!settlement) throw new Error("settlement_failed");
  return { ...evaluation, proof_id: proofId, settlement };
}

function validateCompanyInput(input) {
  const name = String(input?.name || "").trim();
  const purpose = String(input?.purpose || "").trim();
  if (name.length < 3 || name.length > 80) throw new TypeError("company_name_invalid");
  if (purpose.length < 24 || purpose.length > 1000) throw new TypeError("company_purpose_invalid");
  return { name, purpose };
}

export async function createCompany(db, founderActorId, input) {
  const { name, purpose } = validateCompanyInput(input);
  const contribution = normalizeAmount(input?.contribution_cym ?? DEFAULT_COMPANY_CREATION_CYM, 10000);
  const wallet = await first(db, "SELECT earned_cym FROM wallets WHERE actor_id=?", founderActorId);
  if (!wallet || Number(wallet.earned_cym) < contribution) throw new Error("insufficient_earned_cym");
  const id = uuid("company");
  const opKey = `company:create:${id}`;
  const journalId = uuid("journal");
  await db.batch([
    db.prepare("INSERT INTO actors(id,actor_type,display_name) VALUES(?,'company',?)").bind(id, name),
    db.prepare("INSERT INTO companies(id,founder_actor_id,name,purpose,treasury_cym,stake_units) VALUES(?,?,?,?,?,?)").bind(id, founderActorId, name, purpose, contribution, contribution),
    db.prepare("UPDATE wallets SET earned_cym=earned_cym-?, updated_at=datetime('now') WHERE actor_id=? AND earned_cym>=? AND NOT EXISTS(SELECT 1 FROM journal WHERE idempotency_key=?)").bind(contribution, founderActorId, contribution, opKey),
    db.prepare("INSERT INTO stakes(company_id,actor_id,units,invested_cym) VALUES(?,?,?,?)").bind(id, founderActorId, contribution, contribution),
    db.prepare("INSERT INTO journal(id,idempotency_key,kind,from_account,to_account,amount_cym,metadata_json) VALUES(?,?,'company_genesis',?,?,?,?)").bind(journalId, opKey, founderActorId, id, contribution, JSON.stringify({ company_id: id })),
  ]);
  return first(db, "SELECT * FROM companies WHERE id=?", id);
}

export async function stakeInCompany(db, companyId, actorId, amount) {
  const deposit = normalizeAmount(amount, 10000);
  const company = await first(db, "SELECT * FROM companies WHERE id=?", companyId);
  if (!company) throw new Error("company_not_found");
  const wallet = await first(db, "SELECT earned_cym FROM wallets WHERE actor_id=?", actorId);
  if (!wallet || Number(wallet.earned_cym) < deposit) throw new Error("insufficient_earned_cym");
  const units = stakeUnitsForDeposit(company, deposit);
  const opKey = `company:stake:${companyId}:${actorId}:${crypto.randomUUID()}`;
  const journalId = uuid("journal");
  await db.batch([
    db.prepare("UPDATE wallets SET earned_cym=earned_cym-?, updated_at=datetime('now') WHERE actor_id=? AND earned_cym>=? AND NOT EXISTS(SELECT 1 FROM journal WHERE idempotency_key=?)").bind(deposit, actorId, deposit, opKey),
    db.prepare("UPDATE companies SET treasury_cym=treasury_cym+?, stake_units=stake_units+? WHERE id=? AND NOT EXISTS(SELECT 1 FROM journal WHERE idempotency_key=?)").bind(deposit, units, companyId, opKey),
    db.prepare(`INSERT INTO stakes(company_id,actor_id,units,invested_cym) VALUES(?,?,?,?)
      ON CONFLICT(company_id,actor_id) DO UPDATE SET units=stakes.units+excluded.units, invested_cym=stakes.invested_cym+excluded.invested_cym, updated_at=datetime('now')`).bind(companyId, actorId, units, deposit),
    db.prepare("INSERT INTO journal(id,idempotency_key,kind,from_account,to_account,amount_cym,metadata_json) VALUES(?,?,'company_stake',?,?,?,?)").bind(journalId, opKey, actorId, companyId, deposit, JSON.stringify({ company_id: companyId, units_minted: units })),
  ]);
  return { company_id: companyId, actor_id: actorId, amount_cym: deposit, units_minted: units };
}

export async function isCompanyFounder(db, companyId, actorId) {
  const row = await first(db, "SELECT 1 AS ok FROM companies WHERE id=? AND founder_actor_id=?", companyId, actorId);
  return Boolean(row?.ok);
}

export async function getParticipationSnapshot(db, actorId = null) {
  const treasury = await first(db, "SELECT bootstrap_cym,earned_cym,reputation FROM wallets WHERE actor_id=?", TREASURY_ID);
  const contracts = await results(db, `SELECT c.*, a.github_login AS creator_login, ca.github_login AS claimant_login
    FROM contracts c LEFT JOIN actors a ON a.id=c.creator_actor_id LEFT JOIN actors ca ON ca.id=c.claimant_actor_id
    ORDER BY c.created_at DESC LIMIT 100`);
  const companies = await results(db, `SELECT c.*, a.github_login AS founder_login FROM companies c LEFT JOIN actors a ON a.id=c.founder_actor_id ORDER BY c.created_at DESC LIMIT 100`);
  const proofs = await results(db, `SELECT p.id,p.contract_id,p.accepted,p.reason,p.observed_improvement_pct,p.before_value,p.after_value,p.evidence_url,p.created_at,c.title,c.metric_key
    FROM proofs p JOIN contracts c ON c.id=p.contract_id ORDER BY p.created_at DESC LIMIT 100`);
  let actor = null, wallet = null, stakes = [];
  if (actorId) {
    actor = await first(db, "SELECT * FROM actors WHERE id=?", actorId);
    wallet = await first(db, "SELECT bootstrap_cym,earned_cym,reputation FROM wallets WHERE actor_id=?", actorId);
    stakes = await results(db, "SELECT s.*, c.name AS company_name, c.treasury_cym, c.stake_units FROM stakes s JOIN companies c ON c.id=s.company_id WHERE s.actor_id=? ORDER BY s.updated_at DESC", actorId);
  }
  return {
    north_star: "detect-fund-work-prove-settle-learn",
    actor,
    wallet,
    treasury,
    contracts,
    companies,
    proofs,
    stakes,
  };
}

export async function getSessionActor(db, tokenHash) {
  if (!tokenHash) return null;
  return first(db, `SELECT a.* FROM sessions s JOIN actors a ON a.id=s.actor_id
    WHERE s.token_hash=? AND s.expires_at>datetime('now')`, tokenHash);
}

export async function createSession(db, actorId, tokenHash, expiresAt) {
  await run(db, "INSERT INTO sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)", tokenHash, actorId, expiresAt);
}

export async function deleteSession(db, tokenHash) {
  if (!tokenHash) return;
  await run(db, "DELETE FROM sessions WHERE token_hash=?", tokenHash);
}

export async function saveOauthState(db, stateHash, returnTo, expiresAt) {
  await run(db, "INSERT INTO oauth_states(state_hash,return_to,expires_at) VALUES(?,?,?)", stateHash, returnTo, expiresAt);
}

export async function consumeOauthState(db, stateHash) {
  const state = await first(db, "SELECT * FROM oauth_states WHERE state_hash=? AND expires_at>datetime('now')", stateHash);
  if (!state) return null;
  await run(db, "DELETE FROM oauth_states WHERE state_hash=?", stateHash);
  return state;
}
