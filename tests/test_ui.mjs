import test from "node:test";
import assert from "node:assert/strict";
import { filterAgents, marketTransactions, seriesPoints } from "../site/ui.js";

test("agent search combines specialty and identifier without mutating rank", () => {
  const agents = [
    { agent_id: "agent-001", specialty: "code", balance: 20 },
    { agent_id: "agent-002", specialty: "data", balance: 30 },
  ];
  assert.deepEqual(filterAgents(agents, "001", "code"), [agents[0]]);
  assert.deepEqual(filterAgents(agents, "001", "data"), []);
  assert.equal(agents[0].agent_id, "agent-001");
});
test("market replay excludes issuance and other epochs", () => {
  const txs = [
    { epoch: 4, kind: "trade", service: "code" },
    { epoch: 3, kind: "trade", service: "code" },
    { epoch: 4, kind: "issuance", service: "monetary_base" },
  ];
  assert.deepEqual(marketTransactions(txs, 4, "all"), [txs[0]]);
  assert.deepEqual(marketTransactions(txs, 4, "data"), []);
});
test("chart handles constant and single values with finite coordinates", () => {
  for (const values of [[0], [3, 3, 3], [-4, 0, 4]]) {
    const plot = seriesPoints(values, 500, 150);
    assert.ok(plot.points.every((p) => p.every(Number.isFinite)));
    assert.equal(plot.points.length, values.length);
  }
  assert.equal(seriesPoints([], 500, 150).points.length, 0);
});

test('research reward axis preserves sub-cent precision', async () => {
  const { chart } = await import('../site/ui.js');
  const container={innerHTML:'',textContent:''};
  chart(container, [[{epoch:1,mean_reward:0.001},{epoch:2,mean_reward:0.003}]], 'mean_reward', ['Reward']);
  assert.match(container.innerHTML, /0\.00[1-9]/);
});
