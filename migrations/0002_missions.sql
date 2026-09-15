-- Additive: existing actors, wallets, contracts and history remain intact.
CREATE TABLE missions (
 id TEXT PRIMARY KEY,
 definition_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','active','completed','expired')),
 reward_cym REAL NOT NULL CHECK(reward_cym>0 AND reward_cym<=100),
 xp INTEGER NOT NULL CHECK(xp>0 AND xp<=100),
 role_count INTEGER NOT NULL CHECK(role_count IN (1,2)),
 escrow_cym REAL NOT NULL DEFAULT 0 CHECK(escrow_cym>=0),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 completed_at TEXT
);
CREATE TABLE mission_claims (
 mission_id TEXT NOT NULL REFERENCES missions(id),
 actor_id TEXT NOT NULL REFERENCES actors(id),
 role TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(mission_id,actor_id),
 UNIQUE(mission_id,role)
);
CREATE TABLE mission_attempts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 mission_id TEXT NOT NULL REFERENCES missions(id),
 actor_id TEXT NOT NULL REFERENCES actors(id),
 role TEXT NOT NULL,
 answers_json TEXT NOT NULL,
 accepted INTEGER NOT NULL CHECK(accepted IN(0,1)),
 reason TEXT NOT NULL,
 message TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX mission_one_verified_report ON mission_attempts(mission_id,actor_id) WHERE accepted=1;
CREATE INDEX mission_attempt_lookup ON mission_attempts(mission_id,actor_id,id DESC);
CREATE TABLE mission_rewards (
 mission_id TEXT NOT NULL REFERENCES missions(id),
 actor_id TEXT NOT NULL REFERENCES actors(id),
 reward_cym REAL NOT NULL CHECK(reward_cym>0),
 xp INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(mission_id,actor_id)
);
CREATE TABLE achievements (
 actor_id TEXT NOT NULL REFERENCES actors(id),
 achievement TEXT NOT NULL,
 serial INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(actor_id,achievement),
 UNIQUE(achievement,serial)
);
CREATE TABLE world_events (
 id TEXT PRIMARY KEY,
 definition_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 resolved_at TEXT
);
-- Independent attestation is required for advanced user-measured contracts.
CREATE TABLE proof_attestations (
 contract_id TEXT PRIMARY KEY REFERENCES contracts(id),
 steward_actor_id TEXT NOT NULL REFERENCES actors(id),
 evidence_url TEXT NOT NULL,
 before_value REAL NOT NULL,
 after_value REAL NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
UPDATE system_state SET value='2' WHERE key='participation_schema_version';
