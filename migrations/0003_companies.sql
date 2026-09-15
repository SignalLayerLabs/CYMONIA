-- Preserve legacy capital and history; old companies require a charter to operate.
ALTER TABLE companies ADD COLUMN mission TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN target_problem TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN strategy TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN kpi TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','bankrupt'));
ALTER TABLE companies ADD COLUMN costs_cym REAL NOT NULL DEFAULT 0 CHECK(costs_cym >= 0);
ALTER TABLE companies ADD COLUMN revenues_cym REAL NOT NULL DEFAULT 0 CHECK(revenues_cym >= 0);
ALTER TABLE companies ADD COLUMN profit_cym REAL NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN successful_contracts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN failed_contracts INTEGER NOT NULL DEFAULT 0;
CREATE TABLE company_operations (
  id TEXT PRIMARY KEY,
  operation_key TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES actors(id),
  kind TEXT NOT NULL CHECK(kind IN ('create','stake','fund_experiment','compete_for_contract')),
  amount_cym REAL NOT NULL CHECK(amount_cym > 0),
  units REAL NOT NULL DEFAULT 0 CHECK(units >= 0),
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX company_operations_company ON company_operations(company_id,created_at);
-- Revenue is an audited settlement, never a simulated surplus.
UPDATE companies SET revenues_cym=COALESCE((SELECT SUM(amount_cym) FROM settlements WHERE recipient_actor_id=companies.id),0),
 successful_contracts=(SELECT COUNT(*) FROM settlements WHERE recipient_actor_id=companies.id);
UPDATE companies SET profit_cym=revenues_cym-costs_cym;
CREATE TRIGGER company_settlement_revenue AFTER INSERT ON settlements
WHEN EXISTS(SELECT 1 FROM companies WHERE id=NEW.recipient_actor_id)
BEGIN
 UPDATE companies SET revenues_cym=revenues_cym+NEW.amount_cym,profit_cym=profit_cym+NEW.amount_cym,
 successful_contracts=successful_contracts+1,status='active' WHERE id=NEW.recipient_actor_id;
END;
CREATE TRIGGER company_contract_failure AFTER UPDATE OF status ON contracts
WHEN OLD.status IN ('claimed','proof_submitted') AND NEW.status IN ('cancelled','rejected')
BEGIN
 UPDATE companies SET failed_contracts=failed_contracts+1 WHERE id=OLD.claimant_actor_id;
END;
CREATE TABLE company_charter_history (
 id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL REFERENCES companies(id),
 actor_id TEXT NOT NULL REFERENCES actors(id),
 before_json TEXT NOT NULL,
 after_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX company_charter_history_company ON company_charter_history(company_id,created_at);
