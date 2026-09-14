PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human','agent','company','system')),
  github_id INTEGER UNIQUE,
  github_login TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallets (
  actor_id TEXT PRIMARY KEY REFERENCES actors(id) ON DELETE CASCADE,
  bootstrap_cym REAL NOT NULL DEFAULT 0 CHECK (bootstrap_cym >= 0),
  earned_cym REAL NOT NULL DEFAULT 0 CHECK (earned_cym >= 0),
  reputation INTEGER NOT NULL DEFAULT 0 CHECK (reputation >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  return_to TEXT NOT NULL DEFAULT '/#participate',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_actor ON sessions(actor_id);

CREATE TABLE IF NOT EXISTS journal (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  from_account TEXT,
  to_account TEXT,
  amount_cym REAL NOT NULL CHECK (amount_cym > 0),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_journal_created ON journal(created_at DESC);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  creator_actor_id TEXT NOT NULL REFERENCES actors(id),
  source TEXT NOT NULL DEFAULT 'human' CHECK (source IN ('human','agent','system')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('economy','research','infrastructure','expansion')),
  economic_purpose TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  baseline_value REAL NOT NULL,
  target_direction TEXT NOT NULL CHECK (target_direction IN ('increase','decrease')),
  min_improvement_pct REAL NOT NULL CHECK (min_improvement_pct > 0 AND min_improvement_pct <= 1000),
  reward_cym REAL NOT NULL CHECK (reward_cym > 0 AND reward_cym <= 10000),
  purpose_score INTEGER NOT NULL CHECK (purpose_score >= 0 AND purpose_score <= 100),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','funded','claimed','proof_submitted','settled','rejected','cancelled')),
  claimant_actor_id TEXT REFERENCES actors(id),
  escrow_cym REAL NOT NULL DEFAULT 0 CHECK (escrow_cym >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status, created_at DESC);

CREATE TABLE IF NOT EXISTS contract_fundings (
  contract_id TEXT PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
  amount_cym REAL NOT NULL CHECK (amount_cym > 0),
  funded_by_account TEXT NOT NULL DEFAULT 'CYMONIA_CONTRIBUTION_TREASURY',
  funded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proofs (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  contributor_actor_id TEXT NOT NULL REFERENCES actors(id),
  before_value REAL NOT NULL,
  after_value REAL NOT NULL,
  observed_improvement_pct REAL,
  evidence_url TEXT NOT NULL,
  evidence_summary TEXT NOT NULL DEFAULT '',
  accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0,1)),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_proofs_contract ON proofs(contract_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settlements (
  contract_id TEXT PRIMARY KEY REFERENCES contracts(id),
  proof_id TEXT NOT NULL UNIQUE,
  recipient_actor_id TEXT NOT NULL REFERENCES actors(id),
  amount_cym REAL NOT NULL CHECK (amount_cym > 0),
  settled_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY REFERENCES actors(id) ON DELETE CASCADE,
  founder_actor_id TEXT NOT NULL REFERENCES actors(id),
  name TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL,
  treasury_cym REAL NOT NULL DEFAULT 0 CHECK (treasury_cym >= 0),
  stake_units REAL NOT NULL DEFAULT 0 CHECK (stake_units >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stakes (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  units REAL NOT NULL DEFAULT 0 CHECK (units >= 0),
  invested_cym REAL NOT NULL DEFAULT 0 CHECK (invested_cym >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, actor_id)
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO actors(id, actor_type, display_name)
VALUES('CYMONIA_CONTRIBUTION_TREASURY', 'system', 'CYMONIA Contribution Treasury');
INSERT OR IGNORE INTO wallets(actor_id, bootstrap_cym, earned_cym, reputation)
VALUES('CYMONIA_CONTRIBUTION_TREASURY', 0, 0, 0);
INSERT OR IGNORE INTO system_state(key, value)
VALUES('participation_genesis_initialized', '0');
INSERT OR IGNORE INTO system_state(key, value)
VALUES('participation_schema_version', '1');
