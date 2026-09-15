import {createWorld,advanceWorld,addHumanCitizen,applyCitizenStrategy,publicWorld,explainEvent} from "./world-engine.js";
import {DEFAULT_STRATEGY,parseCymScript,strategyToCymScript,translateIntent,canAutoApprove} from "./cymscript.js";
const first = (db, sql, ...params) => db.prepare(sql).bind(...params).first();
const rows = async (db, sql, ...params) => (await db.prepare(sql).bind(...params).all())?.results || [];
const statement = (db, sql, ...params) => db.prepare(sql).bind(...params);

async function readSnapshot(db) {
  const row = await first(db, "SELECT state_json FROM autonomous_world_state WHERE id=1");
  // A corrupt existing world must fail visibly, never recreate the economy.
  const world = row ? JSON.parse(row.state_json) : createWorld();
  if (!world || !Array.isArray(world.citizens) || !Array.isArray(world.events)) throw new Error("world_state_invalid");
  return {world, previous: row?.state_json ?? null, eventIds: new Set(row ? world.events.map(e => e.id) : [])};
}

// CASE evaluates only its selected branch. A failed guard aborts the D1 batch,
// rolling back the world, events and metadata together; retry from a fresh read.
function guard(db, condition, ...params) {
  return statement(db, `SELECT CASE WHEN ${condition} THEN 1 ELSE json('world_write_conflict') END`, ...params);
}

export async function saveWorld(db, world, previous, {events = world.events, statements = [], guards = []} = {}) {
  if (previous === undefined) throw new TypeError("world_previous_state_required");
  const serialized = JSON.stringify(world);
  if (serialized === previous && !statements.length) return world;
  await db.batch([
    guard(db, "(SELECT state_json FROM autonomous_world_state WHERE id=1) IS ?", previous),
    ...guards,
    statement(db, "INSERT INTO autonomous_world_state(id,tick,state_json,updated_at) VALUES(1,?,?,datetime('now')) ON CONFLICT(id) DO UPDATE SET tick=excluded.tick,state_json=excluded.state_json,updated_at=datetime('now')", world.tick, serialized),
    ...statements,
    statement(db, `INSERT OR IGNORE INTO world_event_log(id,tick,event_type,actor_id,payload_json,causes_json)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.tick'),json_extract(value,'$.type'),
             json_extract(value,'$.actor_id'),COALESCE(json_extract(value,'$.payload'),'{}'),COALESCE(json_extract(value,'$.causes'),'[]')
      FROM json_each(?)`, JSON.stringify(events)),
  ]);
  return world;
}

async function mutateWorld(db, mutate) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = await readSnapshot(db);
    const change = await mutate(snapshot.world);
    try {
      await saveWorld(db, snapshot.world, snapshot.previous, {
        ...change,
        events: change.events || snapshot.world.events.filter(e => !snapshot.eventIds.has(e.id)),
      });
      return change.result;
    } catch (error) {
      if (!/malformed JSON/i.test(error.message) || attempt === 4) throw error;
    }
  }
}

export async function loadWorld(db) {
  return mutateWorld(db, world => ({result: world}));
}

export async function advancePersistentWorld(db, ticks = 1) {
  return mutateWorld(db, world => {
    const events = world.tick === 0 ? world.events.filter(e => e.type === "WORLD_GENESIS") : [];
    advanceWorld(world, ticks, event => events.push(event));
    return {events, result: world};
  });
}

export async function ensureHumanWorldCitizen(db, actor) {
  if (!actor?.id || !actor.github_id) throw new TypeError("world_actor_invalid");
  return mutateWorld(db, async world => {
    let link = await first(db, "SELECT * FROM world_human_links WHERE github_id=?", actor.github_id);
    let citizen = link && world.citizens.find(c => c.id === link.citizen_id);
    if (citizen) return {result: {link, citizen}};
    citizen = addHumanCitizen(world, {github_id: actor.github_id, login: actor.github_login, display_name: actor.display_name});
    const statements = [];
    const guards = [];
    if (!link) {
      link = {actor_id: actor.id, github_id: actor.github_id, citizen_id: citizen.id, agent_mode: "MANUAL", active_strategy_version: 1};
      guards.push(guard(db, "NOT EXISTS(SELECT 1 FROM world_human_links WHERE github_id=?)", actor.github_id));
      statements.push(
        statement(db, "INSERT INTO world_human_links(actor_id,github_id,citizen_id,agent_mode,active_strategy_version) VALUES(?,?,?,?,1)", actor.id, actor.github_id, citizen.id, "MANUAL"),
        statement(db, "INSERT INTO world_strategy_versions(actor_id,version,cym_script,strategy_json,status,origin) VALUES(?,1,?,?,'active','onboarding')", actor.id, strategyToCymScript(DEFAULT_STRATEGY), JSON.stringify(DEFAULT_STRATEGY)),
      );
    } else {
      const active = await first(db, "SELECT strategy_json FROM world_strategy_versions WHERE actor_id=? AND version=?", actor.id, link.active_strategy_version);
      if (active) citizen.strategy = JSON.parse(active.strategy_json);
      if (link.citizen_id !== citizen.id) statements.push(statement(db, "UPDATE world_human_links SET citizen_id=? WHERE actor_id=?", citizen.id, actor.id));
    }
    return {statements, guards, result: {link, citizen}};
  });
}

export async function getWorldPublic(db) { return publicWorld(await loadWorld(db)); }
export async function getWorldNews(db, limit = 50) {
  const events = await rows(db, "SELECT id,tick,event_type,actor_id,payload_json,causes_json,created_at FROM world_event_log ORDER BY tick DESC,rowid DESC LIMIT ?", Math.max(1, Math.min(100, Number(limit) || 50)));
  return events.map(r => ({...r, payload: JSON.parse(r.payload_json || "{}"), causes: JSON.parse(r.causes_json || "[]")}));
}
export async function getWorldWhy(db, eventId) {
  const causal = explainEvent(await loadWorld(db), eventId);
  if (causal) return causal;
  const row = await first(db, "SELECT id,tick,event_type type,actor_id,payload_json,causes_json,created_at ts FROM world_event_log WHERE id=?", eventId);
  return row ? {event: {...row, payload: JSON.parse(row.payload_json || "{}"), causes: JSON.parse(row.causes_json || "[]")}, causes: []} : null;
}
export async function getAgentProfile(db, actor) {
  const {link, citizen} = await ensureHumanWorldCitizen(db, actor);
  const versions = await rows(db, `SELECT version,cym_script,strategy_json,status,origin,intent,created_at FROM world_strategy_versions
    WHERE actor_id=? ORDER BY (version=?) DESC,version DESC LIMIT 12`, actor.id, link.active_strategy_version);
  return {citizen, mode: link.agent_mode, active_version: link.active_strategy_version, versions: versions.map(v => ({...v, strategy: JSON.parse(v.strategy_json)}))};
}
export async function setAgentMode(db, actor, mode) {
  mode = String(mode || "").toUpperCase();
  if (!["MANUAL", "ADVISOR", "AUTONOMOUS"].includes(mode)) throw new TypeError("agent_mode_invalid");
  await ensureHumanWorldCitizen(db, actor);
  await statement(db, "UPDATE world_human_links SET agent_mode=?,updated_at=datetime('now') WHERE actor_id=?", mode, actor.id).run();
  return getAgentProfile(db, actor);
}

function linkGuard(db, link) {
  return guard(db, "EXISTS(SELECT 1 FROM world_human_links WHERE actor_id=? AND active_strategy_version=? AND agent_mode=?)", link.actor_id, link.active_strategy_version, link.agent_mode);
}
function activationStatements(db, actorId, version) {
  return [
    statement(db, "UPDATE world_strategy_versions SET status='superseded' WHERE actor_id=? AND status='active' AND version<>?", actorId, version),
    statement(db, "UPDATE world_strategy_versions SET status='active' WHERE actor_id=? AND version=?", actorId, version),
    statement(db, "UPDATE world_human_links SET active_strategy_version=?,updated_at=datetime('now') WHERE actor_id=?", version, actorId),
  ];
}
export async function proposeAgentStrategy(db, actor, intent, {origin = "deterministic", translator = null} = {}) {
  await ensureHumanWorldCitizen(db, actor);
  return mutateWorld(db, async world => {
    const link = await first(db, "SELECT * FROM world_human_links WHERE actor_id=?", actor.id);
    const active = await first(db, "SELECT strategy_json FROM world_strategy_versions WHERE actor_id=? AND version=?", actor.id, link.active_strategy_version);
    const current = active ? JSON.parse(active.strategy_json) : DEFAULT_STRATEGY;
    const translated = translator ? await translator(intent, current) : null;
    const next = translated?.strategy ? translated.strategy : translateIntent(intent, current);
    next.mode = link.agent_mode;
    const effectiveOrigin = translated?.origin || origin;
    const max = await first(db, "SELECT COALESCE(MAX(version),0) v FROM world_strategy_versions WHERE actor_id=?", actor.id);
    const version = Number(max.v) + 1;
    const script = strategyToCymScript(next);
    const auto = link.agent_mode === "AUTONOMOUS" && canAutoApprove(current, next);
    const status = auto ? "active" : "pending";
    const statements = [
      statement(db, "UPDATE world_strategy_versions SET status='superseded' WHERE actor_id=? AND status='pending'", actor.id),
      statement(db, "INSERT INTO world_strategy_versions(actor_id,version,cym_script,strategy_json,status,origin,intent) VALUES(?,?,?,?,?,?,?)", actor.id, version, script, JSON.stringify(next), status, effectiveOrigin, String(intent || "").slice(0, 2000)),
    ];
    if (auto) {
      applyCitizenStrategy(world, link.citizen_id, next);
      statements.push(...activationStatements(db, actor.id, version));
    }
    return {
      guards: [linkGuard(db, link), guard(db, "(SELECT COALESCE(MAX(version),0) FROM world_strategy_versions WHERE actor_id=?)=?", actor.id, Number(max.v))],
      statements,
      result: {version, script, strategy: next, status, auto_approved: auto, origin: effectiveOrigin, ai_status: translated?.ai_status || "fallback", model: translated?.model || null},
    };
  });
}
export async function approveAgentStrategy(db, actor, version) {
  await ensureHumanWorldCitizen(db, actor);
  version = Number(version);
  return mutateWorld(db, async world => {
    const link = await first(db, "SELECT * FROM world_human_links WHERE actor_id=?", actor.id);
    const row = await first(db, "SELECT * FROM world_strategy_versions WHERE actor_id=? AND version=?", actor.id, version);
    if (!row) throw new Error("strategy_not_found");
    const strategy = parseCymScript(row.cym_script);
    if (link.active_strategy_version === version && row.status === "active") return {result: {version, strategy, script: row.cym_script, status: "active"}};
    applyCitizenStrategy(world, link.citizen_id, strategy);
    return {guards: [linkGuard(db, link)], statements: activationStatements(db, actor.id, version), result: {version, strategy, script: row.cym_script, status: "active"}};
  });
}
