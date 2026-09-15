import { validateCompanyCharter, companySummary, evaluateCompanyCounterfactual } from "./companies.js";
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

function companyOperationKey(kind, actorId, key) {
  if (key !== undefined && (typeof key !== "string" || !/^[A-Za-z0-9:_-]{1,120}$/.test(key))) throw new TypeError("idempotency_key_invalid");
  return `company:${kind}:${actorId}:${key ?? crypto.randomUUID()}`;
}
async function companyReceipt(db, key, request) {
  const receipt = await first(db, "SELECT * FROM company_operations WHERE operation_key=?", key);
  if (receipt && receipt.request_json !== request) throw new Error("idempotency_key_conflict");
  return receipt;
}

export async function createCompany(db, founderActorId, input) {
  const charter = validateCompanyCharter(input);
  const contribution = normalizeAmount(input?.contribution_cym ?? DEFAULT_COMPANY_CREATION_CYM, 10000);
  const key = companyOperationKey("create", founderActorId, input?.idempotency_key);
  const request = JSON.stringify({ ...charter, contribution });
  const prior = await companyReceipt(db, key, request);
  if (prior) return companySummary(await first(db, "SELECT * FROM companies WHERE id=?", prior.company_id));
  const id = uuid("company"), op = uuid("operation");
  await db.batch([
    db.prepare(`INSERT INTO company_operations(id,operation_key,company_id,actor_id,kind,amount_cym,units,request_json)
      SELECT ?,?,?,?,'create',?,?,? FROM wallets WHERE actor_id=? AND earned_cym>=?
      ON CONFLICT(operation_key) DO NOTHING`).bind(op,key,id,founderActorId,contribution,contribution,request,founderActorId,contribution),
    db.prepare("UPDATE wallets SET earned_cym=earned_cym-?, updated_at=datetime('now') WHERE actor_id=? AND EXISTS(SELECT 1 FROM company_operations WHERE id=?)").bind(contribution,founderActorId,op),
    db.prepare("INSERT INTO actors(id,actor_type,display_name) SELECT ?,'company',? WHERE EXISTS(SELECT 1 FROM company_operations WHERE id=?)").bind(id,charter.name,op),
    db.prepare(`INSERT INTO companies(id,founder_actor_id,name,purpose,mission,target_problem,strategy,kpi,treasury_cym,stake_units)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM company_operations WHERE id=?)`).bind(id,founderActorId,charter.name,charter.purpose,charter.mission,charter.target_problem,charter.strategy,charter.kpi,contribution,contribution,op),
    db.prepare("INSERT INTO stakes(company_id,actor_id,units,invested_cym) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM company_operations WHERE id=?)").bind(id,founderActorId,contribution,contribution,op),
    db.prepare("INSERT INTO journal(id,idempotency_key,kind,from_account,to_account,amount_cym,metadata_json) SELECT ?,?,'company_genesis',?,?,?,? WHERE EXISTS(SELECT 1 FROM company_operations WHERE id=?)").bind(uuid("journal"),key,founderActorId,id,contribution,JSON.stringify({company_id:id}),op),
  ]);
  const receipt = await companyReceipt(db,key,request);
  if (!receipt) throw new Error("insufficient_earned_cym");
  return companySummary(await first(db,"SELECT * FROM companies WHERE id=?",receipt.company_id));
}

export async function updateCompanyCharter(db, companyId, actorId, input) {
  const company = await first(db, "SELECT * FROM companies WHERE id=?", companyId);
  if (!company) throw new Error("company_not_found");
  if (company.founder_actor_id !== actorId) throw new Error("company_founder_required");
  const charter = validateCompanyCharter({ ...company, ...input });
  const before = { name: company.name, mission: company.mission, target_problem: company.target_problem, strategy: company.strategy, kpi: company.kpi };
  const after = { name: charter.name, mission: charter.mission, target_problem: charter.target_problem, strategy: charter.strategy, kpi: charter.kpi };
  if (JSON.stringify(before) === JSON.stringify(after)) return companySummary(company);
  const historyId = uuid("charter");
  // A charter may evolve between jobs, but operating companies cannot redefine
  // their mission or measurement after observing results. Blank legacy charters
  // may be completed once while preserving all historical capital and outcomes.
  await db.batch([
    db.prepare(`INSERT INTO company_charter_history(id,company_id,actor_id,before_json,after_json)
      SELECT ?,id,?,?,? FROM companies WHERE id=? AND founder_actor_id=?
      AND name=? AND mission=? AND target_problem=? AND strategy=? AND kpi=?
      AND NOT EXISTS(SELECT 1 FROM contracts WHERE claimant_actor_id=companies.id AND status IN ('claimed','proof_submitted'))
      AND ((mission='' AND kpi='') OR (costs_cym=0 AND revenues_cym=0 AND successful_contracts=0 AND failed_contracts=0)
        OR (mission=? AND target_problem=? AND kpi=?))`).bind(historyId,actorId,JSON.stringify(before),JSON.stringify(after),companyId,actorId,
        before.name,before.mission,before.target_problem,before.strategy,before.kpi,charter.mission,charter.target_problem,charter.kpi),
    db.prepare(`UPDATE companies SET name=?,purpose=?,mission=?,target_problem=?,strategy=?,kpi=?
      WHERE id=? AND EXISTS(SELECT 1 FROM company_charter_history WHERE id=?)`).bind(charter.name,charter.purpose,charter.mission,charter.target_problem,charter.strategy,charter.kpi,companyId,historyId),
    db.prepare("UPDATE actors SET display_name=? WHERE id=? AND EXISTS(SELECT 1 FROM company_charter_history WHERE id=?)").bind(charter.name,companyId,historyId),
  ]);
  const history = await first(db, "SELECT id FROM company_charter_history WHERE id=?", historyId);
  if (!history) throw new Error("company_charter_immutable_or_active_contract_or_changed");
  return companySummary(await first(db, "SELECT * FROM companies WHERE id=?", companyId));
}

export async function stakeInCompany(db, companyId, actorId, amount, idempotencyKey) {
  const deposit = normalizeAmount(amount,10000);
  const key=companyOperationKey("stake",actorId,idempotencyKey);
  const request=JSON.stringify({companyId,deposit});
  const prior=await companyReceipt(db,key,request);
  const reply=r=>({company_id:r.company_id,actor_id:r.actor_id,amount_cym:r.amount_cym,units_minted:r.units});
  if(prior) return reply(prior);
  const company=await first(db,"SELECT * FROM companies WHERE id=?",companyId);
  if(!company) throw new Error("company_not_found");
  if(company.status==='bankrupt' || company.treasury_cym<=0) throw new Error("company_bankrupt");
  const op=uuid("operation");
  await db.batch([
    db.prepare(`INSERT INTO company_operations(id,operation_key,company_id,actor_id,kind,amount_cym,units,request_json)
      SELECT ?,?,c.id,?,'stake',?,ROUND(?*c.stake_units/c.treasury_cym,6),? FROM companies c JOIN wallets w ON w.actor_id=?
      WHERE c.id=? AND c.status='active' AND c.treasury_cym>0 AND w.earned_cym>=? AND ROUND(?*c.stake_units/c.treasury_cym,6)>0
      ON CONFLICT(operation_key) DO NOTHING`).bind(op,key,actorId,deposit,deposit,request,actorId,companyId,deposit,deposit),
    db.prepare("UPDATE wallets SET earned_cym=earned_cym-?,updated_at=datetime('now') WHERE actor_id=? AND EXISTS(SELECT 1 FROM company_operations WHERE id=?)").bind(deposit,actorId,op),
    db.prepare("UPDATE companies SET treasury_cym=treasury_cym+?,stake_units=stake_units+(SELECT units FROM company_operations WHERE id=?) WHERE id=? AND EXISTS(SELECT 1 FROM company_operations WHERE id=?)").bind(deposit,op,companyId,op),
    db.prepare(`INSERT INTO stakes(company_id,actor_id,units,invested_cym) SELECT company_id,actor_id,units,amount_cym FROM company_operations WHERE id=?
      ON CONFLICT(company_id,actor_id) DO UPDATE SET units=stakes.units+excluded.units,invested_cym=stakes.invested_cym+excluded.invested_cym,updated_at=datetime('now')`).bind(op),
    db.prepare("INSERT INTO journal(id,idempotency_key,kind,from_account,to_account,amount_cym,metadata_json) SELECT ?,operation_key,'company_stake',actor_id,company_id,amount_cym,json_object('company_id',company_id,'units_minted',units) FROM company_operations WHERE id=?").bind(uuid("journal"),op),
  ]);
  const receipt=await companyReceipt(db,key,request);
  if(!receipt) throw new Error("insufficient_earned_cym_or_company_unavailable");
  return reply(receipt);
}

export async function evaluateCompany(db, companyId, worldState, budget) {
  const company=await first(db,"SELECT * FROM companies WHERE id=?",companyId);
  if(!company) throw new Error("company_not_found");
  return evaluateCompanyCounterfactual(company,worldState,budget);
}

export async function deployCompany(db, companyId, actorId, input, worldState) {
  if(input?.action=== "compete_for_contract") return competeForCompanyContract(db,companyId,actorId,input);
  if(input?.action!=="fund_experiment") throw new TypeError("company_action_invalid");
  const budget=normalizeAmount(input.budget_cym,1000);
  const company=await first(db,"SELECT * FROM companies WHERE id=?",companyId);
  if(!company) throw new Error("company_not_found");
  if(company.founder_actor_id!==actorId) throw new Error("company_founder_required");
  const key=companyOperationKey("deploy",actorId,input.idempotency_key);
  const request=JSON.stringify({companyId,action:input.action,budget});
  const prior=await companyReceipt(db,key,request);
  if(prior) return {id:prior.id,company_id:companyId,evaluation:JSON.parse(prior.result_json)};
  if(company.status==='bankrupt') throw new Error("company_bankrupt");
  const evaluation=evaluateCompanyCounterfactual(company,worldState,budget);
  const op=uuid("operation");
  await db.batch([
    db.prepare(`INSERT INTO company_operations(id,operation_key,company_id,actor_id,kind,amount_cym,request_json,result_json)
      SELECT ?,?,id,?,'fund_experiment',?,?,? FROM companies WHERE id=? AND founder_actor_id=? AND treasury_cym>=? AND status='active'
      ON CONFLICT(operation_key) DO NOTHING`).bind(op,key,actorId,budget,request,JSON.stringify(evaluation),companyId,actorId,budget),
    db.prepare("UPDATE companies SET treasury_cym=ROUND(treasury_cym-?,6),costs_cym=costs_cym+?,profit_cym=profit_cym-?,status=CASE WHEN ROUND(treasury_cym-?,6)=0 THEN 'bankrupt' ELSE 'active' END WHERE id=? AND EXISTS(SELECT 1 FROM company_operations WHERE id=?)").bind(budget,budget,budget,budget,companyId,op),
    db.prepare("UPDATE wallets SET earned_cym=earned_cym+?,updated_at=datetime('now') WHERE actor_id=? AND EXISTS(SELECT 1 FROM company_operations WHERE id=?)").bind(budget,TREASURY_ID,op),
    db.prepare("INSERT INTO journal(id,idempotency_key,kind,from_account,to_account,amount_cym,metadata_json) SELECT ?,?,'company_research_cost',?,?,?,? WHERE EXISTS(SELECT 1 FROM company_operations WHERE id=?)").bind(uuid("journal"),key,companyId,TREASURY_ID,budget,JSON.stringify({company_id:companyId,operation_id:op,scope:evaluation.scope}),op),
  ]);
  const receipt=await companyReceipt(db,key,request);
  if(!receipt) throw new Error("insufficient_company_capital");
  return {id:receipt.id,company_id:companyId,evaluation:JSON.parse(receipt.result_json)};
}

async function competeForCompanyContract(db, companyId, actorId, input) {
  if(input.budget_cym !== undefined && Number(input.budget_cym)!==1) throw new TypeError("company_competition_cost_is_one_cym");
  const company=await first(db,"SELECT * FROM companies WHERE id=?",companyId);
  if(!company) throw new Error("company_not_found");
  if(company.founder_actor_id!==actorId) throw new Error("company_founder_required");
  validateCompanyCharter(company);
  const key=companyOperationKey("compete",actorId,input.idempotency_key);
  const request=JSON.stringify({companyId,action:'compete_for_contract',budget:1});
  const prior=await companyReceipt(db,key,request);
  const reply=r=>({id:r.id,company_id:companyId,...JSON.parse(r.result_json)});
  if(prior) return reply(prior);
  if(company.status==='bankrupt') throw new Error("company_bankrupt");
  const category={research:'research',verification:'infrastructure',matching:'economy'}[company.strategy];
  const op=uuid("operation");
  await db.batch([
    db.prepare(`INSERT INTO company_operations(id,operation_key,company_id,actor_id,kind,amount_cym,request_json,result_json)
      SELECT ?,?,c.id,?,'compete_for_contract',1,?,json_object('contract_id',t.id,'cost_cym',1,'scope','live_contract_assignment')
      FROM companies c JOIN contracts t ON t.category=? AND t.status='funded' AND t.escrow_cym>=t.reward_cym AND t.claimant_actor_id IS NULL
      WHERE c.id=? AND c.founder_actor_id=? AND c.treasury_cym>=1 AND c.status='active'
      AND (SELECT COUNT(*) FROM contracts a WHERE a.claimant_actor_id=c.id AND a.status IN ('claimed','proof_submitted')) <
      CASE WHEN c.successful_contracts>=100 THEN 5 WHEN c.successful_contracts>=25 THEN 4 WHEN c.successful_contracts>=10 THEN 3 WHEN c.successful_contracts>=3 THEN 2 ELSE 1 END
      ORDER BY t.created_at,t.id LIMIT 1 ON CONFLICT(operation_key) DO NOTHING`).bind(op,key,actorId,request,category,companyId,actorId),
    db.prepare("UPDATE contracts SET status='claimed',claimant_actor_id=?,updated_at=datetime('now') WHERE id=(SELECT json_extract(result_json,'$.contract_id') FROM company_operations WHERE id=?)").bind(companyId,op),
    db.prepare("UPDATE companies SET treasury_cym=ROUND(treasury_cym-1,6),costs_cym=costs_cym+1,profit_cym=profit_cym-1,status=CASE WHEN ROUND(treasury_cym-1,6)=0 THEN 'bankrupt' ELSE 'active' END WHERE id=? AND EXISTS(SELECT 1 FROM company_operations WHERE id=?)").bind(companyId,op),
    db.prepare("UPDATE wallets SET earned_cym=earned_cym+1,updated_at=datetime('now') WHERE actor_id=? AND EXISTS(SELECT 1 FROM company_operations WHERE id=?)").bind(TREASURY_ID,op),
    db.prepare("INSERT INTO journal(id,idempotency_key,kind,from_account,to_account,amount_cym,metadata_json) SELECT ?,operation_key,'company_contract_cost',company_id,?,1,result_json FROM company_operations WHERE id=?").bind(uuid("journal"),TREASURY_ID,op),
  ]);
  const receipt=await companyReceipt(db,key,request);
  if(!receipt) throw new Error("company_capacity_capital_or_eligible_contract_unavailable");
  return reply(receipt);
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
