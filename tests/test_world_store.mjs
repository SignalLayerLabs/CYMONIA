import test from "node:test";import assert from "node:assert/strict";import {D1TestDB} from "./helpers/d1.mjs";import {ensureHumanWorldCitizen,getAgentProfile,proposeAgentStrategy,approveAgentStrategy,advancePersistentWorld,getWorldPublic,getWorldNews} from "../functions/_lib/world-store.js";
const actor={id:"human:github:88",github_id:88,github_login:"builder",display_name:"Builder"};
test("D1 world persists genesis and advances without recreating founders",async()=>{const db=new D1TestDB();await advancePersistentWorld(db,20);const w=await getWorldPublic(db);assert.equal(w.citizens.filter(c=>c.kind==="GENESIS_FOUNDER").length,100);assert.equal(w.tick,20);assert.ok((await getWorldNews(db)).length>0)});
test("GitHub actor receives exactly one citizen and versioned Personal Agent strategy",async()=>{const db=new D1TestDB();const a=await ensureHumanWorldCitizen(db,actor);const b=await ensureHumanWorldCitizen(db,{...actor,github_login:"renamed"});assert.equal(a.citizen.id,b.citizen.id);const p=await getAgentProfile(db,actor);assert.equal(p.versions.length,1);const proposed=await proposeAgentStrategy(db,actor,"become an entrepreneur, save 40%, stay low risk");assert.equal(proposed.status,"pending");const active=await approveAgentStrategy(db,actor,proposed.version);assert.equal(active.status,"active");const after=await getAgentProfile(db,actor);assert.equal(after.active_version,proposed.version)});

// Pause a real SQLite read to reproduce a competing request before this one resumes.
class InterleavedDB extends D1TestDB {
  afterWorldRead = null;
  beforeBatch = null;
  async batch(statements) {
    const hook = this.beforeBatch;
    this.beforeBatch = null;
    if (hook) await hook();
    return super.batch(statements);
  }
  prepare(sql) {
    const statement = super.prepare(sql);
    if (!/SELECT state_json FROM autonomous_world_state/.test(sql)) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...params) => {
      const bound = bind(...params);
      const read = bound.first.bind(bound);
      bound.first = async () => {
        const result = read();
        const hook = this.afterWorldRead;
        this.afterWorldRead = null;
        if (hook) await hook();
        return result;
      };
      return bound;
    };
    return statement;
  }
}
const secondActor = {id:"human:github:89",github_id:89,github_login:"second",display_name:"Second"};

test("reading an existing agent cannot roll back a concurrent tick", async () => {
  const db = new InterleavedDB();
  await ensureHumanWorldCitizen(db, actor);
  db.afterWorldRead = () => advancePersistentWorld(db, 1);
  await getAgentProfile(db, actor);
  assert.equal((await getWorldPublic(db)).tick, 1);
});

test("concurrent arrivals retain both citizens and their metadata", async () => {
  const db = new InterleavedDB();
  await getWorldPublic(db);
  db.afterWorldRead = () => ensureHumanWorldCitizen(db, secondActor);
  await ensureHumanWorldCitizen(db, actor);
  const world = await getWorldPublic(db);
  assert.deepEqual(world.citizens.filter(c=>c.kind === "HUMAN_LINKED").map(c=>c.id).sort(), ["human:88", "human:89"]);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM world_human_links").get().n, 2);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM world_strategy_versions WHERE status='active'").get().n, 2);
});

test("a failed event insert rolls back onboarding state and metadata", async () => {
  const db = new D1TestDB();
  await getWorldPublic(db);
  db.raw.exec("CREATE TRIGGER reject_arrival BEFORE INSERT ON world_event_log WHEN NEW.event_type='HUMAN_CITIZEN_ARRIVED' BEGIN SELECT RAISE(ABORT,'test_event_failure'); END");
  await assert.rejects(ensureHumanWorldCitizen(db, actor), /test_event_failure/);
  assert.equal((await getWorldPublic(db)).citizens.length, 100);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM world_human_links").get().n, 0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM world_strategy_versions").get().n, 0);
});

test("bulk ticks preserve every event after the in-memory history rolls over", async () => {
  const db = new D1TestDB();
  await advancePersistentWorld(db, 400);
  const count = db.raw.prepare("SELECT COUNT(*) n FROM world_event_log").get().n;
  assert.ok(count > 5000, `only ${count} events persisted`);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM world_event_log WHERE event_type='WORLD_GENESIS'").get().n, 1);
  assert.ok(db.raw.prepare("SELECT COUNT(*) n FROM world_event_log WHERE tick BETWEEN 1 AND 20").get().n > 300);
});

test("corrupt persisted world is reported without replacing it with genesis", async () => {
  const db = new D1TestDB();
  db.raw.prepare("INSERT INTO autonomous_world_state(id,tick,state_json) VALUES(1,20,'corrupt')").run();
  await assert.rejects(getWorldPublic(db));
  assert.equal(db.raw.prepare("SELECT state_json FROM autonomous_world_state").get().state_json, "corrupt");
});

test("older active strategy remains authoritative after many pending proposals", async () => {
  const db = new D1TestDB();
  const careful = await proposeAgentStrategy(db, actor, "low risk, save 40%");
  await approveAgentStrategy(db, actor, careful.version);
  for (let i=0; i<13; i++) await proposeAgentStrategy(db, actor, "become an entrepreneur");
  const proposal = await proposeAgentStrategy(db, actor, "help the community");
  assert.equal(proposal.strategy.risk, "low");
  assert.equal(proposal.strategy.save_rate, .4);
  assert.ok((await getAgentProfile(db, actor)).versions.some(v=>v.version===careful.version && v.status === "active"));
});

test("strategy activation and a competing arrival both survive", async () => {
  const db = new InterleavedDB();
  const proposed = await proposeAgentStrategy(db, actor, "low risk, save 40%");
  db.afterWorldRead = () => ensureHumanWorldCitizen(db, secondActor);
  await approveAgentStrategy(db, actor, proposed.version);
  const world = await getWorldPublic(db);
  assert.ok(world.citizens.some(c=>c.id === "human:89"));
  const profile = await getAgentProfile(db, actor);
  assert.equal(profile.citizen.strategy.risk, "low");
  assert.equal(profile.active_version, proposed.version);
});

test("event failure rolls back strategy activation metadata", async () => {
  const db = new D1TestDB();
  const proposed = await proposeAgentStrategy(db, actor, "low risk");
  db.raw.exec("CREATE TRIGGER reject_strategy BEFORE INSERT ON world_event_log WHEN NEW.event_type='STRATEGY_ACTIVATED' BEGIN SELECT RAISE(ABORT,'test_event_failure'); END");
  await assert.rejects(approveAgentStrategy(db, actor, proposed.version), /test_event_failure/);
  const profile = await getAgentProfile(db, actor);
  assert.equal(profile.active_version, 1);
  assert.equal(profile.citizen.strategy.risk, "medium");
  assert.equal(profile.versions.find(v=>v.version === proposed.version).status, "pending");
});

test("two competing ticks both commit without losing either advance", async () => {
  const db = new InterleavedDB();
  await getWorldPublic(db);
  db.beforeBatch = () => advancePersistentWorld(db, 2);
  await advancePersistentWorld(db, 3);
  assert.equal((await getWorldPublic(db)).tick, 5);
});

test("competing strategy proposals receive distinct complete versions", async () => {
  const db = new InterleavedDB();
  await ensureHumanWorldCitizen(db, actor);
  db.beforeBatch = () => proposeAgentStrategy(db, actor, "low risk");
  const latest = await proposeAgentStrategy(db, actor, "save 40%");
  const profile = await getAgentProfile(db, actor);
  assert.equal(latest.version, 3);
  assert.equal(profile.versions.find(v=>v.version === 2).status, "superseded");
  assert.equal(profile.versions.find(v=>v.version === 3).status, "pending");
  assert.equal(profile.active_version, 1);
});

test("competing activations preserve both citizens' active strategies", async () => {
  const db = new InterleavedDB();
  const one = await proposeAgentStrategy(db, actor, "low risk");
  const two = await proposeAgentStrategy(db, secondActor, "save 40%");
  db.beforeBatch = () => approveAgentStrategy(db, secondActor, two.version);
  await approveAgentStrategy(db, actor, one.version);
  const first = await getAgentProfile(db, actor);
  const second = await getAgentProfile(db, secondActor);
  assert.equal(first.active_version, one.version);
  assert.equal(first.citizen.strategy.risk, "low");
  assert.equal(second.active_version, two.version);
  assert.equal(second.citizen.strategy.save_rate, .4);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM world_event_log WHERE event_type='STRATEGY_ACTIVATED'").get().n, 2);
});
