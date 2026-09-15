CREATE TABLE IF NOT EXISTS autonomous_world_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  tick INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS world_event_log (
  id TEXT PRIMARY KEY,
  tick INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  causes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_world_event_tick ON world_event_log(tick DESC);
CREATE TABLE IF NOT EXISTS world_human_links (
  actor_id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  citizen_id TEXT NOT NULL UNIQUE,
  agent_mode TEXT NOT NULL DEFAULT 'MANUAL' CHECK(agent_mode IN ('MANUAL','ADVISOR','AUTONOMOUS')),
  active_strategy_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS world_strategy_versions (
  actor_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  cym_script TEXT NOT NULL,
  strategy_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','pending','rejected','superseded')),
  origin TEXT NOT NULL DEFAULT 'onboarding',
  intent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(actor_id,version)
);
