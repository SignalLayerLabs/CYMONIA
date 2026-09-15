const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function normalizeGame(data = {}) {
  return {
    ...data,
    actor: data.actor || null,
    player: {
      ...(data.player || {}),
      progress_pct: Math.max(0, Math.min(100, num(data.player?.progress_pct))),
    },
    missions: Array.isArray(data.missions) ? data.missions : [],
    recommended: Array.isArray(data.recommended) ? data.recommended : [],
    events: Array.isArray(data.events) ? data.events : [],
    history: Array.isArray(data.history) ? data.history : [],
    leaderboard: Array.isArray(data.leaderboard) ? data.leaderboard : [],
  };
}
export function recoverMission(missions) {
  return (
    missions.find((m) => m.my_claim && !m.my_completed && !m.my_verified) ||
    missions.find((m) =>
      ["started", "in_progress", "claimed", "retry"].includes(m.status),
    ) ||
    null
  );
}
export function safeEvidenceUrl(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
export function verificationOutcome(result = {}) {
  const accepted = result.accepted === true;
  const settled = accepted && result.waiting_for_team !== true;
  return {
    accepted,
    settled,
    title: settled ? "MISSION COMPLETE" : accepted ? "ROLE VERIFIED · WAITING FOR TEAM" : "CHECK FAILED · CORRECTION NEEDED",
    message:
      result.message ||
      result.reason ||
      (settled
        ? "Your contribution was verified and settled."
        : accepted
          ? "Your role is verified. Settlement happens only when the cooperative mission is complete."
          : "Review the evidence and try again."),
    reward: settled ? num(result.reward_cym) : 0,
    xp: settled ? num(result.xp) : 0,
  };
}
async function request(path, body) {
  const r = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  let d = {};
  try {
    d = await r.json();
  } catch {}
  if (!r.ok)
    throw Error(d.error || `Request failed (${r.status}). Please retry.`);
  return d;
}
export function createGameController() {
  const $ = (id) => document.getElementById(id);
  let state = normalizeGame(),
    active = null;
  const drafts = new Map();
  let busy = false;
  function saveDraft(id, answers) {
    drafts.set(id, answers);
    try {
      sessionStorage.setItem(
        `cymonia.draft.${state.actor?.id}.${id}`,
        JSON.stringify(answers),
      );
    } catch {}
  }
  function message(value, error = false) {
    $("gameMessage").textContent = value;
    $("gameMessage").classList.toggle("error", error);
  }
  async function action(button, fn) {
    if (busy) return;
    busy = true;
    const label = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "Working…";
    }
    try {
      await fn();
    } catch (e) {
      message(e.message, true);
    } finally {
      busy = false;
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  }
  function card(m) {
    return `<article class="mission-card"><div class="contract-head"><span class="pill">${esc(m.category)} · ${esc(m.status)}</span><strong>${num(m.reward_cym)} CYM <small>+${num(m.xp)} XP</small></strong></div><h3>${esc(m.title)}</h3><p>${esc(m.why)}</p><dl><dt>Difficulty</dt><dd>${num(m.difficulty)}/5 · ${num(m.minutes)} min</dd><dt>Skill</dt><dd>${esc(m.skill)}</dd><dt>Impact</dt><dd>${esc(m.impact)}</dd><dt>Risk</dt><dd>${esc(m.risk)}</dd></dl><button class="primary-button" data-start="${esc(m.id)}" ${!state.actor || m.my_completed || m.my_verified ? "disabled" : ""}>${m.my_claim && !m.my_completed ? "Continue mission" : "Start mission"} →</button></article>`;
  }
  function render() {
    const p = state.player;
    $("gameWelcome").textContent = state.actor
      ? "WELCOME TO CYMONIA"
      : "A LIVING HUMAN–AI ECONOMY";
    $("gameNeeds").textContent =
      `${state.missions.filter((m) => !["accepted", "completed", "settled"].includes(m.status)).length} problems detected. ${state.recommended.length} match your current level.`;
    $("findWork").disabled = !state.actor;
    $("missionCards").innerHTML =
      (state.recommended.length
        ? state.recommended
        : state.missions
            .filter(
              (m) => !["accepted", "completed", "settled"].includes(m.status),
            )
            .slice(0, 3)
      )
        .map(card)
        .join("") ||
      '<p class="empty">No open missions right now. Check again as the economy evolves.</p>';
    $("playerProgress").hidden = !state.actor;
    $("playerRank").textContent = p.rank || "Observer";
    $("playerXp").textContent =
      `${num(p.xp)} XP · next: ${p.next_rank || "highest rank"}`;
    $("xpProgress").value = p.progress_pct;
    $("nextUnlock").textContent =
      typeof p.next_unlock === "object"
        ? JSON.stringify(p.next_unlock)
        : p.next_unlock || "Complete verified work to advance.";
    $("careerStats").innerHTML = [
      ["CYM earned", p.earned_cym],
      ["Value created", p.value_created],
      ["Proofs accepted", p.proofs_accepted],
      ["Companies founded", p.companies_founded],
      ["Crises survived", p.crises_survived],
    ]
      .map(
        ([label, v]) =>
          `<div><span>${label}</span><strong>${num(v).toLocaleString()}</strong></div>`,
      )
      .join("");
    $("careerHistory").innerHTML =
      state.history
        .slice(0, 12)
        .map(
          (h) =>
            `<li><strong>${esc(h.title || h.type || h.event_type)}</strong> ${esc(h.message || h.description || h.created_at || "")}</li>`,
        )
        .join("") ||
      "<li>Your first verified contribution starts your career.</li>";
    $("achievements").textContent = (p.achievements || [])
      .map((a) => (typeof a === "string" ? a : a.title || a.name))
      .join(" · ");
    $("worldEvents").innerHTML =
      state.events
        .map(
          (e) =>
            `<article class="world-event ${e.severity === "critical" ? "crisis" : ""}"><span class="eyebrow">${esc(e.district || "Economy")} · ${esc(e.severity || "notice")}</span><h3>${esc(e.title || e.name)}</h3><p>${esc(e.description || e.message || [e.evidence, e.impact].filter(Boolean).join(" "))}</p>${e.deadline ? `<time>${esc(e.deadline)}</time>` : ""}</article>`,
        )
        .join("") ||
      '<p class="empty">No active economic alerts in the latest state.</p>';
    $("worldTicker").textContent =
      state.events.map((e) => e.title || e.name).join("  /  ") ||
      "Latest economy state · no active alerts";
    $("gameLeaderboard").innerHTML =
      state.leaderboard
        .slice(0, 10)
        .map(
          (r, i) =>
            `<li><strong>${i + 1}. ${esc(r.github_login || r.name || r.rank)}</strong> ${num(r.value_created)} value · ${num(r.xp)} XP</li>`,
        )
        .join("") || "<li>Verified outcomes will establish the rankings.</li>";
  }
  function renderActive() {
    const m = active;
    $("currentMission").hidden = !m;
    if (!m) return;
    let saved = drafts.get(m.id) || {};
    try {
      saved =
        JSON.parse(
          sessionStorage.getItem(`cymonia.draft.${state.actor?.id}.${m.id}`) ||
            "null",
        ) || saved;
    } catch {}
    const evidence = Array.isArray(m.evidence)
      ? m.evidence
      : [m.evidence].filter(Boolean);
    $("currentMission").innerHTML =
      `<div class="panel-head"><div><span class="eyebrow">CURRENT MISSION</span><h2>${esc(m.title)}</h2></div><span class="pill">${esc(m.status)}</span></div><p>${esc(m.why)}</p>${m.my_claim?.role ? `<p>Your team role: <strong>${esc(m.my_claim.role)}</strong>. Each role must be independently verified before the team reward settles.</p>` : ""}${m.attempts?.length ? `<p class="footnote">Last check: ${esc(m.attempts.at(-1).message || m.attempts.at(-1).reason)}</p>` : ""}<div class="mission-work"><section><h3>Your evidence</h3>${evidence
        .map((e) => {
          const url = safeEvidenceUrl(
            typeof e === "string" ? e : e.url || e.source_url || e.source,
          );
          return `<div class="evidence">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Open public evidence ↗</a>` : ""}<p>${esc(e.label || "")} ${esc(e.summary || "")}</p>${
            Array.isArray(e.rows) && e.rows.length
              ? `<div class="company-comparison"><table><thead><tr>${Object.keys(
                  e.rows[0],
                )
                  .map((k) => `<th>${esc(k)}</th>`)
                  .join("")}</tr></thead><tbody>${e.rows
                  .map(
                    (row) =>
                      `<tr>${Object.keys(e.rows[0])
                        .map((k) => `<td>${esc(row[k])}</td>`)
                        .join("")}</tr>`,
                  )
                  .join("")}</tbody></table></div>`
              : ""
          }<pre>${esc(typeof e === "string" ? e : typeof e.facts === "object" ? JSON.stringify(e.facts, null, 2) : e.facts || e.description || "")}</pre></div>`;
        })
        .join(
          "",
        )}<ol>${(m.steps || []).map((s) => `<li>${esc(typeof s === "string" ? s : s.instruction || s.title)}</li>`).join("")}</ol><form id="missionProof" class="economy-form">${(
        m.proof || []
      )
        .map(
          (f) =>
            `<label class="span-2">${esc(f.label)}${
              f.type === "select"
                ? `<select name="${esc(f.key)}" required><option value="">Choose an answer</option>${(
                    f.options || []
                  )
                    .map((o) => {
                      const v = typeof o === "object" ? o.value : o;
                      return `<option value="${esc(v)}" ${String(saved[f.key]) === String(v) ? "selected" : ""}>${esc(typeof o === "object" ? o.label : o)}</option>`;
                    })
                    .join("")}</select>`
                : `<input name="${esc(f.key)}" type="${f.type === "number" ? "number" : "text"}" step="any" value="${esc(saved[f.key] ?? "")}" required>`
            }</label>`,
        )
        .join(
          "",
        )}<button class="primary-button span-2">Verify my work →</button></form></section><aside class="mentor"><span class="eyebrow">CYMONIA MENTOR</span><h3>One practical step at a time.</h3><p id="mentorGuidance" aria-live="polite">${esc(m.steps?.[0]?.instruction || m.steps?.[0] || "Ask where to start. Your mentor will guide the next step.")}</p><div class="mentor-prompts">${["Where do I start?", "I don’t understand.", "What do I need to prove?", "Help me do the next step."].map((q) => `<button class="outline-button compact" data-mentor="${esc(q)}">${q}</button>`).join("")}</div><form id="mentorForm"><label for="mentorQuestion">Ask about this mission</label><textarea id="mentorQuestion" name="question" required maxlength="1500"></textarea><button class="outline-button">Ask mentor</button></form></aside></div>`;
    $("missionProof").addEventListener("input", (e) =>
      saveDraft(m.id, Object.fromEntries(new FormData(e.currentTarget))),
    );
    $("missionProof").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const answers = Object.fromEntries(new FormData(form));
      saveDraft(m.id, answers);
      action(form.querySelector("button"), async () => {
        const r = await request(
          `/api/missions/${encodeURIComponent(m.id)}/verify`,
          { answers },
        );
        const o = verificationOutcome(r);
        $("missionOutcome").hidden = false;
        $("missionOutcome").className =
          `mission-outcome ${o.accepted ? "success" : "failure"}`;
        $("missionOutcome").innerHTML =
          `<span class="eyebrow">${o.title}</span><h3>${esc(o.message)}</h3>${o.accepted ? `<strong>+${o.reward} CYM · +${o.xp} XP</strong><p>${esc(r.impact || "")}</p><p>${esc((r.unlocked || []).join(" · "))}</p>` : "<p>Your answers are preserved. Correct them above and verify again.</p>"}`;
        if (o.accepted) {
          active = null;
          await refresh();
          $("currentMission").hidden = true;
        }
      });
    });
    $("mentorForm").addEventListener("submit", (e) => {
      e.preventDefault();
      mentor(
        e.currentTarget.querySelector("button"),
        new FormData(e.currentTarget).get("question"),
      );
    });
  }
  async function mentor(button, question) {
    await action(button, async () => {
      const r = await request(
        `/api/missions/${encodeURIComponent(active.id)}/mentor`,
        { question },
      );
      $("mentorGuidance").textContent = [r.guidance, r.next_step]
        .filter(Boolean)
        .join(" ");
    });
  }
  async function refresh() {
    try {
      state = normalizeGame(await request("/api/game"));
      render();
      if (!active) {
        active = recoverMission(state.missions);
        renderActive();
      }
      message("");
    } catch (e) {
      message(`Mission Control could not refresh. ${e.message}`, true);
    }
  }
  $("findWork").addEventListener("click", (e) =>
    action(e.currentTarget, async () => {
      const r = await request("/api/missions/match", {});
      state.recommended = r.recommended || [];
      render();
      message("Your next missions are ready. Choose one to begin.");
    }),
  );
  $("gameRetry").addEventListener("click", (e) =>
    action(e.currentTarget, refresh),
  );
  $("missionCards").addEventListener("click", (e) => {
    const b = e.target.closest("[data-start]");
    if (b)
      action(b, async () => {
        const r = await request(
          `/api/missions/${encodeURIComponent(b.dataset.start)}/start`,
          {},
        );
        active = r.mission;
        renderActive();
        $("missionOutcome").hidden = true;
        $("currentMission").scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
  });
  $("currentMission").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mentor]");
    if (b) mentor(b, b.dataset.mentor);
  });
  document.addEventListener("cymonia:economy-changed", () => {
    active = null;
    refresh();
  });
  return { refresh };
}
