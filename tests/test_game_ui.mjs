import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGame,
  verificationOutcome,
  recoverMission,
  safeEvidenceUrl,
} from "../site/game-ui.js";
test("game empty state is honest and safe", () => {
  assert.deepEqual(normalizeGame().missions, []);
  assert.equal(
    normalizeGame({ player: { progress_pct: 150 } }).player.progress_pct,
    100,
  );
});
test("rejected proof preserves correction and never claims reward", () => {
  const r = verificationOutcome({
    accepted: false,
    reason: "Check the count",
    reward_cym: 99,
  });
  assert.equal(r.accepted, false);
  assert.match(r.message, /Check the count/);
  assert.equal(r.reward, 0);
});
test("accepted proof exposes real progression", () => {
  assert.equal(
    verificationOutcome({ accepted: true, reward_cym: 2, xp: 30 }).reward,
    2,
  );
});
test("refresh recovers an active mission", () => {
  assert.equal(
    recoverMission([
      { id: "a", status: "accepted" },
      { id: "b", status: "started" },
    ])?.id,
    "b",
  );
});
test("evidence links reject executable URLs", () => {
  assert.equal(safeEvidenceUrl("javascript:alert(1)"), "");
  assert.equal(
    safeEvidenceUrl("https://example.com/evidence"),
    "https://example.com/evidence",
  );
});

test("refresh restores server-owned active claim but excludes finished role", () => {
  assert.equal(
    recoverMission([
      {
        id: "done",
        status: "active",
        my_claim: { role: "observer" },
        my_verified: true,
      },
      { id: "mine", status: "active", my_claim: { role: "reviewer" } },
    ]).id,
    "mine",
  );
});
test('verified cooperative role does not imply settlement or payment',()=>{const o=verificationOutcome({accepted:true,waiting_for_team:true,reward_cym:12,xp:50});assert.equal(o.reward,0);assert.equal(o.xp,0);assert.match(o.title,/WAITING/);});
