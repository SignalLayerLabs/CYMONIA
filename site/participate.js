const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function formatCym(value) {
  const amount = n(value);
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 6 }).format(amount)} CYM`;
}
export function normalizeParticipationState(payload = {}) {
  return {
    north_star: payload.north_star || "detect-fund-work-prove-settle-learn",
    actor: payload.actor || null,
    wallet: {
      bootstrap_cym: n(payload.wallet?.bootstrap_cym),
      earned_cym: n(payload.wallet?.earned_cym),
      reputation: n(payload.wallet?.reputation),
    },
    treasury: { earned_cym: n(payload.treasury?.earned_cym) },
    contracts: Array.isArray(payload.contracts) ? payload.contracts : [],
    companies: Array.isArray(payload.companies) ? payload.companies : [],
    proofs: Array.isArray(payload.proofs) ? payload.proofs : [],
    stakes: Array.isArray(payload.stakes) ? payload.stakes : [],
  };
}
export function contractActionFor(contract, actor) {
  if (!actor) return null;
  if (contract.status === "proposed") return "fund";
  if (contract.status === "funded" && !contract.claimant_actor_id)
    return "claim";
  if (contract.status === "claimed" && contract.claimant_actor_id === actor.id)
    return "prove";
  return null;
}
export function participationStatus(health) {
  return health?.ok
    ? { live: true, label: "LIVE ECONOMY" }
    : { live: false, label: "PARTICIPATION OFFLINE" };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
  });
  let data = {};
  try {
    data = await response.json();
  } catch {}
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}
function post(path, body = {}) {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function statusClass(status) {
  return ["settled"].includes(status)
    ? "good"
    : ["claimed", "funded"].includes(status)
      ? "active"
      : "";
}

export function createParticipationController({ notify = () => {} } = {}) {
  let state = normalizeParticipationState();
  let loaded = false;
  let pending = false;
  const $ = (id) => document.getElementById(id);

  function render() {
    const actor = state.actor;
    $("participationSignedOut").hidden = Boolean(actor);
    $("participationSignedIn").hidden = !actor;
    $("participationWorkspace").hidden = !actor;
    $("participantLogin").textContent = actor?.github_login
      ? `@${actor.github_login}`
      : "—";
    $("bootstrapBalance").textContent =
      `${state.wallet.bootstrap_cym.toLocaleString()} bCYM`;
    $("earnedBalance").textContent = formatCym(state.wallet.earned_cym);
    $("reputationValue").textContent = state.wallet.reputation.toLocaleString();
    $("participationTreasury").textContent = formatCym(
      state.treasury.earned_cym,
    );
    $("participationOpen").textContent = state.contracts
      .filter((c) => !["settled", "cancelled"].includes(c.status))
      .length.toLocaleString();
    $("participationCompanies").textContent =
      state.companies.length.toLocaleString();
    $("participationProofs").textContent = state.proofs
      .filter((p) => Number(p.accepted) === 1)
      .length.toLocaleString();

    const foundedCompanies = state.companies.filter(
      (company) => company.founder_actor_id === actor?.id,
    );
    const controlledCompanyIds = new Set(
      foundedCompanies.map((company) => company.id),
    );
    $("contractsList").innerHTML = state.contracts.length
      ? state.contracts
          .map((c) => {
            const action = contractActionFor(c, actor);
            let button =
              action === "fund"
                ? `<button class="outline-button compact" data-contract-action="fund" data-id="${esc(c.id)}">Fund from treasury</button>`
                : action === "claim"
                  ? `<button class="outline-button compact" data-contract-action="claim" data-id="${esc(c.id)}">Claim personally</button>`
                  : action === "prove"
                    ? `<button class="outline-button compact" data-contract-action="prove" data-id="${esc(c.id)}">Submit proof ↓</button>`
                    : "";
            if (c.status === "funded" && foundedCompanies.length) {
              button += foundedCompanies
                .map(
                  (company) =>
                    `<button class="outline-button compact" data-contract-action="claim" data-company-id="${esc(company.id)}" data-id="${esc(c.id)}">Claim via ${esc(company.name)}</button>`,
                )
                .join("");
            }
            return `<article class="contract-card"><div class="contract-head"><span class="contract-status ${statusClass(c.status)}">${esc(c.status)}</span><strong>${esc(c.reward_cym)} CYM</strong></div><h3>${esc(c.title)}</h3><p>${esc(c.economic_purpose)}</p><dl><dt>Metric</dt><dd>${esc(c.metric_key)}</dd><dt>Baseline</dt><dd>${esc(c.baseline_value)}</dd><dt>Target</dt><dd>${esc(c.target_direction)} ≥ ${esc(c.min_improvement_pct)}%</dd></dl><div class="contract-actions">${button}</div></article>`;
          })
          .join("")
      : '<p class="empty">No Economic Contracts yet. The first useful problem can start here.</p>';

    const ownClaims = state.contracts.filter(
      (c) =>
        c.status === "claimed" &&
        (c.claimant_actor_id === actor?.id ||
          controlledCompanyIds.has(c.claimant_actor_id)),
    );
    $("proofContract").innerHTML = ownClaims.length
      ? ownClaims
          .map((c) => {
            const company = foundedCompanies.find(
              (candidate) => candidate.id === c.claimant_actor_id,
            );
            return `<option value="${esc(c.id)}">${esc(c.title)}${company ? ` · via ${esc(company.name)}` : ""}</option>`;
          })
          .join("")
      : '<option value="">No claimed contract</option>';
    $("proofForm").querySelector("button[type=submit]").disabled =
      !ownClaims.length;

    $("companiesList").innerHTML = state.companies.length
      ? state.companies
          .map((c) => {
            const book = n(c.stake_units)
              ? n(c.treasury_cym) / n(c.stake_units)
              : 1;
            return `<article class="company-card"><div><span class="eyebrow">${esc(c.rank || "Garage")} · ${esc(c.status || "active")}</span><h3>${esc(c.name)}</h3><p>${esc(c.mission || c.purpose)}</p><p>Problem: ${esc(c.target_problem || "Legacy company; charter required before deployment")}</p><p>Strategy: ${esc(c.strategy || "—")} · target: ${esc(c.kpi || "—")}</p></div><div class="company-numbers"><strong>${formatCym(c.treasury_cym)}</strong><span>treasury · ${n(c.stake_units).toLocaleString()} units · book ${book.toFixed(3)} CYM/unit</span><p>Revenue ${formatCym(c.revenues_cym)} · costs ${formatCym(c.costs_cym)} · P&amp;L ${formatCym(c.profit_cym ?? n(c.revenues_cym) - n(c.costs_cym))}</p><p>Value created: ${formatCym(c.value_created_cym)} · success ${c.success_rate_pct == null ? "not measured" : esc(c.success_rate_pct) + "%"}</p><p>Staff: Human founder + AI research advisor</p></div>${actor ? `<form data-stake-company="${esc(c.id)}" class="inline-stake"><label>Allocate CYM<input name="amount_cym" type="number" min="0.000001" step="0.000001" required></label><button class="outline-button compact">Acquire stakes</button></form>` : ""}${actor?.id === c.founder_actor_id && c.strategy ? `<form data-company-operation="${esc(c.id)}" class="economy-form"><label>Experiment budget (CYM)<input name="budget_cym" type="number" min="0.000001" max="${n(c.treasury_cym)}" step="any" value="${Math.min(30, n(c.treasury_cym))}" required></label><div class="form-actions"><button name="operation" value="evaluate" class="outline-button compact">Compare worlds</button><button name="operation" value="deploy" class="primary-button compact" ${c.status === "bankrupt" ? "disabled" : ""}>Deploy capital</button></div><p class="footnote span-2">Comparison is a simulation. Deployment spends treasury on a research experiment; only verified work earns revenue.</p></form><div id="company-result-${esc(c.id)}" aria-live="polite"></div>` : ""}</article>`;
          })
          .join("")
      : '<p class="empty">No AI Company has been capitalized yet.</p>';
  }

  async function refresh() {
    try {
      const health = await api("/api/health");
      const status = participationStatus(health);
      $("participationStatus").textContent = status.label;
      $("participationStatus").classList.toggle("warn", !status.live);
      $("participationOffline").hidden = true;
      state = normalizeParticipationState(await api("/api/state"));
      render();
      loaded = true;
    } catch (error) {
      $("participationStatus").textContent = "PARTICIPATION OFFLINE";
      $("participationStatus").classList.add("warn");
      $("participationOffline").hidden = false;
      $("participationOfflineDetail").textContent = error.message;
      loaded = true;
    }
  }

  async function mutate(work, success, control) {
    if (pending) return false;
    pending = true;
    const buttons = [
      ...document.querySelectorAll(
        "#participationWorkspace button, #logoutParticipation",
      ),
    ];
    const disabled = buttons.map((b) => b.disabled);
    buttons.forEach((b) => (b.disabled = true));
    try {
      const result = await work();
      notify(success);
      $("advancedMessage").textContent = success;
      await refresh();
      document.dispatchEvent(new Event("cymonia:economy-changed"));
      return result || true;
    } catch (error) {
      notify(error.message);
      $("advancedMessage").textContent = error.message;
      return false;
    } finally {
      pending = false;
      buttons.forEach((b, i) => {
        if (b.isConnected) b.disabled = disabled[i];
      });
    }
  }

  function install() {
    $("contractForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = formObject(form);
      for (const k of ["baseline_value", "min_improvement_pct", "reward_cym"])
        body[k] = Number(body[k]);
      mutate(
        () => post("/api/contracts", body),
        "Economic Contract proposed.",
      ).then((ok) => {
        if (ok) form.reset();
      });
    });
    $("aiProposal").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Detecting a need…";
      try {
        const data = await post("/api/brain/propose", {});
        for (const [key, value] of Object.entries(data.proposal)) {
          const field = $("contractForm").elements.namedItem(key);
          if (field) field.value = value;
        }
        notify(
          `AI proposal drafted with ${data.model}. Human funding is still required.`,
        );
      } catch (error) {
        notify(error.message);
        $("advancedMessage").textContent = error.message;
      } finally {
        button.disabled = false;
        button.textContent = "Ask AI to detect a need";
      }
    });
    $("proofForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const body = formObject(event.currentTarget);
      const id = body.contract_id;
      delete body.contract_id;
      body.before_value = Number(body.before_value);
      body.after_value = Number(body.after_value);
      mutate(
        () => post(`/api/contracts/${encodeURIComponent(id)}/proof`, body),
        "Verification finished.",
      ).then((result) => {
        if (result) {
          const proof = result.proof || result;
          const accepted = proof.accepted === true || proof.accepted === 1;
          $("advancedMessage").textContent =
            `${accepted ? "CHECK PASSED" : "CHECK FAILED"}: ${proof.message || proof.reason || (accepted ? "Verified work recorded." : "Review your evidence and correct the form before trying again.")}`;
        }
      });
    });
    $("companyForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = formObject(form);
      body.contribution_cym = Number(body.contribution_cym);
      body.idempotency_key =
        form.dataset.requestKey ||
        (form.dataset.requestKey = crypto.randomUUID());
      mutate(
        () => post("/api/companies", body),
        "AI Company capitalized.",
      ).then((ok) => {
        if (ok) {
          form.reset();
          delete form.dataset.requestKey;
        }
      });
    });
    $("logoutParticipation").addEventListener("click", () =>
      mutate(() => post("/api/auth/logout", {}), "Signed out."),
    );
    $("contractsList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-contract-action]");
      if (!button) return;
      const id = button.dataset.id,
        action = button.dataset.contractAction;
      if (action === "prove") {
        $("proofContract").value = id;
        $("proofForm").scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const body =
        action === "claim" && button.dataset.companyId
          ? { company_id: button.dataset.companyId }
          : {};
      mutate(
        () => post(`/api/contracts/${encodeURIComponent(id)}/${action}`, body),
        action === "fund"
          ? "Contract escrow funded."
          : button.dataset.companyId
            ? "Contract claimed through AI Company."
            : "Contract claimed personally.",
      );
    });
    $("companiesList").addEventListener("submit", async (event) => {
      const form = event.target.closest("[data-company-operation]");
      if (!form) return;
      event.preventDefault();
      const id = form.dataset.companyOperation;
      const operation = event.submitter?.value || "evaluate";
      const budget_cym = Number(new FormData(form).get("budget_cym"));
      const key =
        form.dataset.requestKey ||
        (form.dataset.requestKey = crypto.randomUUID());
      const result = await mutate(
        () =>
          post(
            `/api/companies/${encodeURIComponent(id)}/${operation}`,
            operation === "deploy"
              ? { action: "fund_experiment", budget_cym, idempotency_key: key }
              : { budget_cym },
          ),
        operation === "deploy"
          ? "Company capital deployed. Research result recorded."
          : "Paired comparison complete. No capital spent.",
      );
      if (!result) return;
      const e = result.evaluation || result.experiment?.evaluation;
      const target = $(`company-result-${id}`);
      if (target && e)
        target.innerHTML = `<h3>${esc(e.verdict)} · SIMULATION ONLY</h3><p>${esc(e.scope_note)}</p><div class="company-comparison"><table><caption>Same starting state and seed · paired worlds</caption><thead><tr><th>Measure</th><th>Without company</th><th>With company</th></tr></thead><tbody>${["economic_surplus_cym", "completion_rate_pct", "failures", "capital_consumed_cym"].map((k) => `<tr><th>${esc(k.replaceAll("_", " "))}</th><td>${esc(e.world_a?.[k])}</td><td>${esc(e.world_b?.[k])}</td></tr>`).join("")}</tbody></table></div><p>Modeled value ${formatCym(e.value_created_cym)} · ROI ${esc(e.roi_pct)}% · target change ${esc(e.kpi_delta)}</p>`;
    });
    $("companiesList").addEventListener("submit", (event) => {
      const form = event.target.closest("[data-stake-company]");
      if (!form) return;
      event.preventDefault();
      const amount = Number(new FormData(form).get("amount_cym"));
      mutate(
        () =>
          post(
            `/api/companies/${encodeURIComponent(form.dataset.stakeCompany)}/stake`,
            { amount_cym: amount },
          ),
        "Capital allocated to AI Company.",
      );
    });
  }
  install();
  return {
    refresh,
    get loaded() {
      return loaded;
    },
  };
}
