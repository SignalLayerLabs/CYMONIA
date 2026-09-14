import { City, DISTRICTS } from "./city.js";
import {
  fmt,
  fmtMetric,
  percent,
  escapeHTML as esc,
  text,
  filterAgents,
  marketTransactions,
  chart,
} from "./ui.js";
import { createParticipationController } from "./participate.js";

const $ = (id) => document.getElementById(id);
const model = {
  state: null,
  history: [],
  policy: null,
  transactions: [],
  study: null,
  selected: "compute",
  view: "world",
  replayIndex: 0,
  showAll: false,
  missions: new Set(),
  agent: null,
};
try {
  const saved = JSON.parse(
    localStorage.getItem("cymonia.discoveries.v1") || "[]",
  );
  if (Array.isArray(saved))
    for (const key of saved)
      if (["agent", "council", "lab"].includes(key)) model.missions.add(key);
} catch {
  /* Private mode can disable storage. Exploration still works. */
}
const city = new City($("city"), selectDistrict);
const participation = createParticipationController({ notify: toast });
let historyTimer = null,
  toastTimer = null;
const metricLabels = {
  nominal_gdp: "GDP · CYMONIA",
  money_supply: "Money supply · CYMONIA",
  inflation_pct: "Inflation · %",
  gini: "Inequality · Gini",
  active_agent_rate_pct: "Trading agents · %",
  policy_rate_pct: "Policy rate · %",
  mean_reward: "Mean reward · normalized units",
};

async function loadJSON(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}
function toast(message) {
  text("toast", message);
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3800);
}
function completeMission(id) {
  model.missions.add(id);
  try {
    localStorage.setItem(
      "cymonia.discoveries.v1",
      JSON.stringify([...model.missions]),
    );
  } catch {}
  renderMissions();
}
function renderMissions() {
  for (const [id, key] of [
    ["missionAgent", "agent"],
    ["missionCouncil", "council"],
    ["missionLab", "lab"],
  ]) {
    const done = model.missions.has(key);
    $(id).classList.toggle("done", done);
    $(id).querySelector(".check").textContent = done
      ? "✓"
      : { agent: 1, council: 2, lab: 3 }[key];
  }
  text("missionCount", `${model.missions.size}/3`);
  $("missionBar").style.width = `${(model.missions.size / 3) * 100}%`;
  text(
    "missionNote",
    model.missions.size === 3
      ? "Expedition complete. What would you change in this economy?"
      : "Three discoveries. A better question to ask.",
  );
}
function setView(view) {
  if (!["world", "research", "participate", "protocol"].includes(view)) view = "world";
  model.view = view;
  for (const name of ["world", "research", "participate", "protocol"])
    $(name + "View").hidden = name !== view;
  document.querySelectorAll("[data-view]").forEach((b) => {
    const active = b.dataset.view === view;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  city.visible = view === "world";
  if (view !== "world") stopHistory();
  if (view === "world") requestAnimationFrame(() => city.draw());
  if (view === "research") loadResearch();
  if (view === "participate") participation.refresh();
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
}
function navigate(view) {
  setView(view);
  window.scrollTo({ top: 0, behavior: "instant" });
}
function selectDistrict(id) {
  if (!model.state) return;
  const d = DISTRICTS.find((d) => d.id === id);
  if (!d) return;
  model.selected = id;
  city.select(id);
  document.querySelectorAll("[data-market]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.market === id);
    b.setAttribute("aria-pressed", String(b.dataset.market === id));
  });
  const m = model.state.markets.find((m) => m.service === id);
  text(
    "districtNumber",
    `${String(DISTRICTS.indexOf(d) + 1).padStart(2, "0")} / 10`,
  );
  text("districtIcon", d.icon);
  $("districtIcon").style.color = d.color;
  text("districtTitle", `${id} district`);
  text("districtDescription", d.description);
  text("districtVolume", fmt(m?.volume));
  text("districtTrades", fmt(m?.trades));
  text("districtPopulation", `${m?.agents ?? 0} residents`);
  text(
    "marketHint",
    `${id.toUpperCase()} · ${m?.trades ?? 0} trades · ${fmt(m?.volume)} CYMONIA this epoch`,
  );
  $("districtAgents").innerHTML =
    filterAgents(model.state.agents, "", id)
      .slice(0, 3)
      .map(
        (a) =>
          `<button class="mini-agent" data-agent="${esc(a.agent_id)}"><span class="avatar" aria-hidden="true">•‿•</span><span>${esc(a.agent_id)}</span><strong>${fmt(a.balance)}</strong></button>`,
      )
      .join("") || '<p class="empty">No agents in this district.</p>';
}
function renderState() {
  const s = model.state,
    m = s.latest_metrics || {};
  text("epoch", fmt(s.epoch));
  text("moneySupply", fmt(s.money_supply));
  text("nominalGdp", fmt(m.nominal_gdp));
  text("inflation", percent(m.inflation_pct));
  text("policyRate", percent(s.policy_rate_pct));
  text("activity", percent(m.active_agent_rate_pct));
  text("agentCount", `${s.agent_count} active residents`);
  text("snapshotStatus", `SNAPSHOT / EPOCH ${s.epoch}`);
  text("constitutionHash", s.constitution_hash);
  text("stateHash", s.state_hash);
  text(
    "integrityBadge",
    s.integrity.ok ? "BUILD VERIFIED" : "INTEGRITY FAILURE",
  );
  $("integrityBadge").classList.toggle("warn", !s.integrity.ok);
  text(
    "integrityReport",
    s.integrity.ok
      ? "Constitution identity, state hash, ledger chain and accounting checks passed at build."
      : s.integrity.problems.join(", "),
  );
  $("snapshotStatus").classList.toggle("warn", !s.integrity.ok);
  if (!s.integrity.ok) {
    text("snapshotStatus", "INTEGRITY FAILURE");
    $("snapshotStatus").classList.add("warn");
  }
  $("marketButtons").innerHTML = DISTRICTS.map(
    (d) =>
      `<button data-market="${d.id}" aria-pressed="false"><span style="color:${d.color}">${d.icon}</span>${d.id}</button>`,
  ).join("");
  $("agentMarket").innerHTML =
    '<option value="all">All markets</option>' +
    DISTRICTS.map(
      (d) =>
        `<option value="${d.id}">${d.id[0].toUpperCase() + d.id.slice(1)}</option>`,
    ).join("");
  city.setData(s.agents, marketTransactions(model.transactions, s.epoch));
  selectDistrict(model.selected);
  renderAgents();
}
function renderAgents() {
  if (!model.state) return;
  const agents = filterAgents(
    model.state.agents,
    $("agentSearch").value,
    $("agentMarket").value,
  );
  const displayed = model.showAll ? agents : agents.slice(0, 10);
  $("agentsGrid").innerHTML =
    displayed
      .map(
        (a, i) =>
          `<button class="agent-card" data-agent="${esc(a.agent_id)}"><div class="agent-card-top"><span class="avatar" aria-hidden="true">•‿•</span><small>#${String(i + 1).padStart(2, "0")}</small></div><b>${esc(a.agent_id)}</b><span>${esc(a.specialty)} specialist${a.active ? "" : " · inactive"}</span><strong>${fmt(a.balance)} <small>CYMONIA</small></strong></button>`,
      )
      .join("") ||
    '<p class="empty">No agents match your search. Try another ID or market.</p>';
  $("moreAgents").hidden = agents.length <= 10;
  text(
    "moreAgents",
    model.showAll ? "Show fewer agents" : `Show all ${agents.length} agents`,
  );
  text("agentResultCount", `${displayed.length} of ${agents.length} shown`);
}
function showAgent(id) {
  const a = model.state?.agents.find((a) => a.agent_id === id);
  if (!a) return;
  model.agent = id;
  completeMission("agent");
  const txs = model.transactions
    .filter((tx) => tx.buyer === id || tx.seller === id)
    .slice(0, 6);
  $("agentDetail").innerHTML =
    `<h2 id="agentDialogTitle">${esc(a.agent_id)}</h2><p>${esc(a.specialty)} specialist · snapshot epoch ${model.state.epoch}</p><div class="dossier-stats"><div><span>Current balance · CYMONIA</span><strong>${fmt(a.balance)}</strong></div><div><span>Productivity parameter</span><strong>${fmt(a.productivity)}</strong></div><div><span>Completed sales</span><strong>${fmt(a.completed_sales)}</strong></div><div><span>Completed purchases</span><strong>${fmt(a.completed_purchases)}</strong></div></div><h3>How this agent decides</h3><p>Fixed-rule Genesis agent. Its probability of attempting a purchase is <strong>${percent(a.spend_propensity * 100)}</strong> per epoch. Its price-sensitivity parameter is <strong>${fmt(a.price_sensitivity)}</strong>. Seeded randomness generates the offer and demand; the market only settles affordable matches.</p><p>This is a description of the algorithm, not a generated thought or a claim of consciousness. Adaptive learning is studied separately in the AI laboratory.</p><h3>Recent recorded activity</h3>${txs.map((tx) => `<div class="dossier-trade">E${tx.epoch} · ${tx.buyer === id ? "Bought" : "Sold"} ${esc(tx.service)} · ${fmt(tx.amount)} CYMONIA</div>`).join("") || "<p>No activity for this agent in the latest 60 ledger entries.</p>"}`;
  $("agentDialog").showModal();
}
function renderPolicy() {
  const latest = model.policy.latest;
  const next = model.state.next_policy_epoch;
  text("nextMeeting", `Next meeting · E${next}`);
  if (!latest) {
    text("stanceBadge", "AWAITING MEETING");
    text(
      "policyRationale",
      `The first policy meeting has not happened. The council convenes at epoch ${next}.`,
    );
    $("votes").innerHTML = "";
    text("decisionRate", "No decision yet");
    return;
  }
  const delta = latest.new_policy_rate - latest.previous_policy_rate;
  const stance = !latest.enacted
    ? "REJECTED"
    : delta > 0
      ? "TIGHTEN"
      : delta < 0 || latest.issuance_amount > 0
        ? "EASE"
        : "HOLD";
  text("stanceBadge", `${stance} / E${latest.epoch}`);
  $("stanceBadge").classList.toggle("warn", !latest.enacted);
  $("votes").innerHTML = Object.entries(latest.votes)
    .map(
      ([role, v]) =>
        `<div class="vote"><b>${esc(role)}</b><strong>${v.rate_delta >= 0 ? "+" : ""}${Number(v.rate_delta).toFixed(2)}<small> pp</small></strong><span>${esc(v.stance)}</span></div>`,
    )
    .join("");
  text("policyRationale", latest.rationale);
  text(
    "decisionRate",
    `${latest.enacted ? "Enacted" : "Proposed"} ${percent(latest.previous_policy_rate)} → ${percent(latest.new_policy_rate)}`,
  );
}
function showPolicy() {
  if (!model.policy) return;
  const p = model.policy.latest;
  completeMission("council");
  $("policyDetail").innerHTML = p
    ? `<p>Decision ${esc(p.decision_id)} · Epoch ${p.epoch} · <strong>${p.enacted ? "Enacted" : "Not enacted"}</strong></p><p>${esc(p.rationale)}</p><div class="dossier-stats"><div><span>Proposed policy rate</span><strong>${percent(p.new_policy_rate)}</strong></div><div><span>Issuance amount · CYMONIA</span><strong>${fmt(p.issuance_amount)}</strong></div></div><h3>Observed evidence</h3><div class="table-scroll"><table><tbody>${Object.entries(
        p.evidence,
      )
        .map(
          ([k, v]) =>
            `<tr><td>${esc(k.replaceAll("_", " "))}</td><td>${fmt(v)}</td></tr>`,
        )
        .join(
          "",
        )}</tbody></table></div><p>Annualized issuance rate: ${percent(p.annualized_issuance_rate)}. Validator violations: ${p.violations.length ? esc(p.violations.join(", ")) : "none"}.</p><p>The Governor takes the median rate vote and mean issuance vote, then clamps them to constitutional limits. Genesis has no direct policy-rate transmission into demand.</p><a class="text-button" href="data/policy.json" download>Download the policy record ↓</a>`
    : "<p>No council decision has been recorded yet. A meeting occurs every 12 epochs.</p>";
  $("policyDialog").showModal();
}
function renderTransactions() {
  const rows = model.transactions;
  $("transactions").innerHTML =
    rows
      .map(
        (tx) =>
          `<tr><td>E${tx.epoch}</td><td>${esc(tx.buyer)}</td><td>${esc(tx.seller)}</td><td><span class="service-tag">${esc(tx.service)}</span></td><td>${fmt(tx.amount)}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="5">No transactions have been recorded yet.</td></tr>';
}
function renderHistory() {
  const metric = $("macroMetric").value;
  const data = model.history.slice(0, model.replayIndex + 1);
  chart($("macroChart"), [data], metric, [metricLabels[metric]]);
  const row = data.at(-1);
  text("replayEpoch", row?.epoch ?? "—");
  text("replayValue", row ? fmtMetric(metric, row[metric]) : "—");
  text("macroValueHeader", metricLabels[metric]);
  $("macroRows").innerHTML = data
    .map((r) => `<tr><td>${r.epoch}</td><td>${fmtMetric(metric, r[metric])}</td></tr>`)
    .join("");
  $("epochSlider").value = model.replayIndex;
}
function stopHistory() {
  clearInterval(historyTimer);
  historyTimer = null;
  text("playHistory", "▶");
  $("playHistory").setAttribute("aria-label", "Play macroeconomic history");
}
function playHistory() {
  if (historyTimer) {
    stopHistory();
    return;
  }
  if (model.history.length < 2) return;
  if (model.replayIndex >= model.history.length - 1) model.replayIndex = 0;
  text("playHistory", "Ⅱ");
  $("playHistory").setAttribute("aria-label", "Pause macroeconomic history");
  renderHistory();
  historyTimer = setInterval(() => {
    model.replayIndex++;
    renderHistory();
    if (model.replayIndex >= model.history.length - 1) stopHistory();
  }, 500);
}
let researchLoading = false;
async function loadResearch() {
  if (model.study) {
    renderStudy();
    return;
  }
  if (researchLoading) return;
  researchLoading = true;
  $("researchError").hidden = true;
  try {
    const study = await loadJSON("data/experiments.json");
    if (
      !Array.isArray(study.runs) ||
      !study.runs.length ||
      !Array.isArray(study.config?.seeds)
    )
      throw new Error("Invalid research snapshot");
    model.study = study;
    text("studySeeds", study.config.seeds.length);
    text("studyEpochs", study.config.epochs);
    $("studySeed").innerHTML = study.config.seeds
      .map((s) => `<option value="${Number(s)}">Seed ${Number(s)}</option>`)
      .join("");
    text(
      "researchCommand",
      `python -m cymonia research --epochs ${study.config.epochs} --seeds ${study.config.seeds.join(" ")} --output study.json`,
    );
    $("researchContent").hidden = false;
    renderStudy();
  } catch (error) {
    $("researchError").hidden = false;
    console.error("CYMONIA research data:", error);
  } finally {
    researchLoading = false;
  }
}
function selectedRuns() {
  if (!model.study) return [];
  return ["baseline", "adaptive"].map((arm) =>
    model.study.runs.find(
      (r) => r.seed === Number($("studySeed").value) && r.arm === arm,
    ),
  );
}
function renderStudy() {
  const runs = selectedRuns();
  if (runs.length !== 2 || runs.some((r) => !r)) return;
  const metric = $("studyMetric").value;
  chart(
    $("studyChart"),
    runs.map((r) => r.history),
    metric,
    ["Baseline", "Adaptive"],
  );
  const values = runs.map((r) => r.history.at(-1)?.[metric]);
  const delta = values[1] - values[0];
  $("studyComparison").innerHTML =
    `<div><span>BASELINE / FINAL EPOCH</span><strong>${fmtMetric(metric, values[0])}</strong></div><div><span>ADAPTIVE / FINAL EPOCH</span><strong>${fmtMetric(metric, values[1])}</strong></div><div><span>PAIRED DIFFERENCE</span><strong>${delta > 0 ? "+" : ""}${fmtMetric(metric, delta)}</strong></div>`;
  $("studyRows").innerHTML = runs[0].history
    .map(
      (r, i) =>
        `<tr><td>${r.epoch}</td><td>${fmtMetric(metric, r[metric])}</td><td>${fmtMetric(metric, runs[1].history[i]?.[metric])}</td></tr>`,
    )
    .join("");
  const oldAgent = $("traceAgent").value,
    oldEpoch = $("traceEpoch").value;
  const trace = runs[1].decisions;
  $("traceAgent").innerHTML = [...new Set(trace.map((d) => d.agent_id))]
    .map((id) => `<option value="${esc(id)}">${esc(id)}</option>`)
    .join("");
  if ([...$("traceAgent").options].some((o) => o.value === oldAgent))
    $("traceAgent").value = oldAgent;
  $("traceEpoch").innerHTML = [...new Set(trace.map((d) => d.epoch))]
    .map((e) => `<option value="${e}">Epoch ${e}</option>`)
    .join("");
  if ([...$("traceEpoch").options].some((o) => o.value === oldEpoch))
    $("traceEpoch").value = oldEpoch;
  else if ($("traceEpoch").options.length)
    $("traceEpoch").selectedIndex = $("traceEpoch").options.length - 1;
  text("rewardDefinition", `Reward definition: ${model.study.model.reward}`);
  renderTrace();
  completeMission("lab");
}
function renderTrace() {
  const run = selectedRuns()[1];
  if (!run) return;
  const d = run.decisions.find(
    (d) =>
      d.agent_id === $("traceAgent").value &&
      d.epoch === Number($("traceEpoch").value),
  );
  if (!d) {
    $("decisionTrace").innerHTML =
      "<p>No recorded decision for this selection.</p>";
    return;
  }
  const q = Object.entries(d.q_after),
    max = Math.max(...q.map(([, v]) => Math.abs(v)), 0.000001);
  $("decisionTrace").innerHTML =
    `<div class="trace-grid"><div class="trace-cell"><span>01 / CHOOSE</span><strong>${percent(d.action * 100)}</strong><p>Probability of attempting a purchase</p></div><div class="trace-cell"><span>02 / STRATEGY</span><strong>${d.explore ? "Explore" : "Exploit"}</strong><p>${d.explore ? "Seeded random action" : "Highest estimated reward; seeded tie-breaking"}</p></div><div class="trace-cell"><span>03 / OBSERVE REWARD</span><strong>${Number(d.reward).toFixed(6)}</strong><p>Measured after this epoch completes</p></div><div class="trace-cell"><span>04 / UPDATE ESTIMATE</span><strong>${Number(d.q_before[String(d.action)]).toFixed(6)} →</strong><p>${Number(d.q_after[String(d.action)]).toFixed(6)} after the reward update</p></div></div><div class="q-bars">${q.map(([action, value]) => `<div class="q-value">Spend ${percent(Number(action) * 100)}<strong>${Number(value).toFixed(5)}</strong><div class="q-bar"><i style="width:${(Math.abs(value) / max) * 100}%"></i></div></div>`).join("")}</div><p class="footnote">Learned action values after this epoch. Bars show absolute magnitude; numbers retain the sign. Trace includes ${model.study.config.decision_trace_agents} agents; all ${model.study.config.agent_count} agents learn.</p>`;
}
async function boot() {
  $("loadError").hidden = true;
  try {
    const [state, history, policy, transactions] = await Promise.all([
      loadJSON("data/state.json"),
      loadJSON("data/history.json"),
      loadJSON("data/policy.json"),
      loadJSON("data/transactions.json"),
    ]);
    if (
      !Array.isArray(state.agents) ||
      !Array.isArray(state.markets) ||
      !state.integrity ||
      !Array.isArray(history) ||
      !Array.isArray(transactions) ||
      !policy
    )
      throw new Error(
        "The published snapshot is incomplete. Rebuild site data with scripts/build_site.py.",
      );
    Object.assign(model, {
      state,
      history,
      policy,
      transactions,
      replayIndex: Math.max(0, history.length - 1),
    });
    renderState();
    renderPolicy();
    renderTransactions();
    $("epochSlider").max = Math.max(0, history.length - 1);
    $("epochSlider").disabled = !history.length;
    $("playHistory").disabled = history.length < 2;
    renderHistory();
  } catch (error) {
    text("errorDetail", error.message);
    $("loadError").hidden = false;
    text("snapshotStatus", "DATA UNAVAILABLE");
    $("snapshotStatus").classList.add("warn");
    console.error("CYMONIA snapshot:", error);
  }
}

// One delegated handler keeps generated agent and market controls fully functional.
document.addEventListener("click", (e) => {
  const agent = e.target.closest("[data-agent]");
  if (agent) showAgent(agent.dataset.agent);
  const market = e.target.closest("[data-market]");
  if (market) selectDistrict(market.dataset.market);
  const nav = e.target.closest("[data-view]");
  if (nav) navigate(nav.dataset.view);
  const close = e.target.closest("[data-close]");
  if (close) $(close.dataset.close).close();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
});
window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));
$("retry").addEventListener("click", boot);
$("retryResearch").addEventListener("click", loadResearch);
$("startTour").addEventListener("click", () => {
  if (!model.state) return;
  selectDistrict("compute");
  $("city").scrollIntoView({ behavior: "instant", block: "center" });
  $("city").focus({ preventScroll: true });
  toast("Pick a district, then open an agent to start your expedition.");
});
$("exploreAgents").addEventListener("click", () => {
  $("agentMarket").value = model.selected;
  $("agentSearch").value = "";
  renderAgents();
  $("agentsSection").scrollIntoView({ behavior: "instant" });
  $("agentSearch").focus({ preventScroll: true });
});
$("pauseCity").addEventListener("click", () => {
  city.paused = !city.paused;
  updatePause();
});
function updatePause() {
  $("pauseCity").innerHTML = city.paused
    ? "▶ <span>Replay</span>"
    : "Ⅱ <span>Pause</span>";
  $("pauseCity").setAttribute("aria-pressed", String(city.paused));
  $("pauseCity").title = city.paused
    ? "Resume transaction animation"
    : "Pause transaction animation";
}
document.addEventListener("city-motion-paused", updatePause);
updatePause();
$("fullscreen").addEventListener("click", () => city.fullscreen());
$("agentSearch").addEventListener("input", () => {
  model.showAll = false;
  renderAgents();
});
$("agentMarket").addEventListener("change", () => {
  model.showAll = false;
  renderAgents();
});
$("moreAgents").addEventListener("click", () => {
  model.showAll = !model.showAll;
  renderAgents();
});
$("inspectPolicy").addEventListener("click", showPolicy);
$("missionAgent").addEventListener("click", () => {
  const a = model.state?.agents.find((a) => a.specialty === model.selected);
  if (a) showAgent(a.agent_id);
});
$("missionCouncil").addEventListener("click", showPolicy);
$("missionLab").addEventListener("click", () => navigate("research"));
$("macroMetric").addEventListener("change", renderHistory);
$("epochSlider").addEventListener("input", () => {
  stopHistory();
  model.replayIndex = Number($("epochSlider").value);
  renderHistory();
});
$("playHistory").addEventListener("click", playHistory);
$("studySeed").addEventListener("change", renderStudy);
$("studyMetric").addEventListener("change", renderStudy);
$("traceAgent").addEventListener("change", renderTrace);
$("traceEpoch").addEventListener("change", renderTrace);
$("copyCommand").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("researchCommand").textContent);
    text("copyCommand", "Copied ✓");
  } catch {
    toast("Copy the command shown above; clipboard access is unavailable.");
  }
});
window.render_game_to_text = () =>
  JSON.stringify({
    view: model.view,
    snapshotEpoch: model.state?.epoch ?? null,
    selectedMarket: model.selected,
    selectedAgent: model.agent,
    cityPaused: city.paused,
    routeCount: city.trades.length,
    macroEpoch: model.history[model.replayIndex]?.epoch ?? null,
    missions: [...model.missions],
    researchSeed: $("studySeed").value || null,
    coordinateSystem:
      "Canvas CSS pixels; origin top-left, x right, y down. Schematic isometric districts.",
    districts: city.hits
      .filter((_, i) => i % 2 === 0)
      .map(({ id, x, y }) => ({ id, x: Math.round(x), y: Math.round(y) })),
  });
window.advanceTime = (ms) => {
  if (!city.paused) city.time += ms;
  city.draw();
};
renderMissions();
setView(location.hash.slice(1) || "world");
boot();
