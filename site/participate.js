const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function formatCym(value) {
  const amount = n(value);
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 6 }).format(amount)} CYM`;
}
export function normalizeParticipationState(payload = {}) {
  return {
    north_star: payload.north_star || "detect-fund-work-prove-settle-learn",
    actor: payload.actor || null,
    wallet: { bootstrap_cym: n(payload.wallet?.bootstrap_cym), earned_cym: n(payload.wallet?.earned_cym), reputation: n(payload.wallet?.reputation) },
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
  if (contract.status === "funded" && !contract.claimant_actor_id) return "claim";
  if (contract.status === "claimed" && contract.claimant_actor_id === actor.id) return "prove";
  return null;
}
export function participationStatus(health) {
  return health?.ok ? { live: true, label: "LIVE ECONOMY" } : { live: false, label: "PARTICIPATION OFFLINE" };
}

async function api(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...options });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}
function post(path, body = {}) {
  return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function statusClass(status) { return ["settled"].includes(status) ? "good" : ["claimed","funded"].includes(status) ? "active" : ""; }

export function createParticipationController({ notify = () => {} } = {}) {
  let state = normalizeParticipationState();
  let loaded = false;
  const $ = (id) => document.getElementById(id);

  function render() {
    const actor = state.actor;
    $("participationSignedOut").hidden = Boolean(actor);
    $("participationSignedIn").hidden = !actor;
    $("participationWorkspace").hidden = !actor;
    $("participantLogin").textContent = actor?.github_login ? `@${actor.github_login}` : "—";
    $("bootstrapBalance").textContent = `${state.wallet.bootstrap_cym.toLocaleString()} bCYM`;
    $("earnedBalance").textContent = formatCym(state.wallet.earned_cym);
    $("reputationValue").textContent = state.wallet.reputation.toLocaleString();
    $("participationTreasury").textContent = formatCym(state.treasury.earned_cym);
    $("participationOpen").textContent = state.contracts.filter((c) => !["settled","cancelled"].includes(c.status)).length.toLocaleString();
    $("participationCompanies").textContent = state.companies.length.toLocaleString();
    $("participationProofs").textContent = state.proofs.filter((p) => Number(p.accepted) === 1).length.toLocaleString();

    const foundedCompanies = state.companies.filter((company) => company.founder_actor_id === actor?.id);
    const controlledCompanyIds = new Set(foundedCompanies.map((company) => company.id));
    $("contractsList").innerHTML = state.contracts.length ? state.contracts.map((c) => {
      const action = contractActionFor(c, actor);
      let button = action === "fund" ? `<button class="outline-button compact" data-contract-action="fund" data-id="${esc(c.id)}">Fund from treasury</button>`
        : action === "claim" ? `<button class="outline-button compact" data-contract-action="claim" data-id="${esc(c.id)}">Claim personally</button>`
        : action === "prove" ? `<button class="outline-button compact" data-contract-action="prove" data-id="${esc(c.id)}">Submit proof ↓</button>` : "";
      if (c.status === "funded" && foundedCompanies.length) {
        button += foundedCompanies.map((company) => `<button class="outline-button compact" data-contract-action="claim" data-company-id="${esc(company.id)}" data-id="${esc(c.id)}">Claim via ${esc(company.name)}</button>`).join("");
      }
      return `<article class="contract-card"><div class="contract-head"><span class="contract-status ${statusClass(c.status)}">${esc(c.status)}</span><strong>${esc(c.reward_cym)} CYM</strong></div><h3>${esc(c.title)}</h3><p>${esc(c.economic_purpose)}</p><dl><dt>Metric</dt><dd>${esc(c.metric_key)}</dd><dt>Baseline</dt><dd>${esc(c.baseline_value)}</dd><dt>Target</dt><dd>${esc(c.target_direction)} ≥ ${esc(c.min_improvement_pct)}%</dd></dl><div class="contract-actions">${button}</div></article>`;
    }).join("") : '<p class="empty">No Economic Contracts yet. The first useful problem can start here.</p>';

    const ownClaims = state.contracts.filter((c) => c.status === "claimed" && (c.claimant_actor_id === actor?.id || controlledCompanyIds.has(c.claimant_actor_id)));
    $("proofContract").innerHTML = ownClaims.length ? ownClaims.map((c) => {
      const company = foundedCompanies.find((candidate) => candidate.id === c.claimant_actor_id);
      return `<option value="${esc(c.id)}">${esc(c.title)}${company ? ` · via ${esc(company.name)}` : ""}</option>`;
    }).join("") : '<option value="">No claimed contract</option>';
    $("proofForm").querySelector("button[type=submit]").disabled = !ownClaims.length;

    $("companiesList").innerHTML = state.companies.length ? state.companies.map((c) => {
      const book = n(c.stake_units) ? n(c.treasury_cym) / n(c.stake_units) : 1;
      return `<article class="company-card"><div><span class="eyebrow">AI COMPANY</span><h3>${esc(c.name)}</h3><p>${esc(c.purpose)}</p></div><div class="company-numbers"><strong>${formatCym(c.treasury_cym)}</strong><span>treasury · ${n(c.stake_units).toLocaleString()} units · book ${book.toFixed(3)} CYM/unit</span></div>${actor ? `<form data-stake-company="${esc(c.id)}" class="inline-stake"><input name="amount_cym" type="number" min="0.000001" step="0.000001" placeholder="CYM" required><button class="outline-button compact">Allocate stake</button></form>` : ""}</article>`;
    }).join("") : '<p class="empty">No AI Company has been capitalized yet.</p>';
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
      $("participationOfflineDetail").textContent = "This static Observatory is working, but the Cloudflare participation API is not connected here.";
      loaded = true;
    }
  }

  async function mutate(work, success) {
    try { await work(); notify(success); await refresh(); }
    catch (error) { notify(error.message); }
  }

  function install() {
    $("contractForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const body = formObject(event.currentTarget);
      for (const k of ["baseline_value","min_improvement_pct","reward_cym"]) body[k] = Number(body[k]);
      mutate(() => post("/api/contracts", body), "Economic Contract proposed.").then(() => event.currentTarget.reset());
    });
    $("aiProposal").addEventListener("click", async () => {
      try {
        const data = await post("/api/brain/propose", {});
        for (const [key, value] of Object.entries(data.proposal)) {
          const field = $("contractForm").elements.namedItem(key);
          if (field) field.value = value;
        }
        notify(`AI proposal drafted with ${data.model}. Human funding is still required.`);
      } catch (error) { notify(error.message); }
    });
    $("proofForm").addEventListener("submit", (event) => {
      event.preventDefault(); const body = formObject(event.currentTarget); const id = body.contract_id; delete body.contract_id;
      body.before_value = Number(body.before_value); body.after_value = Number(body.after_value);
      mutate(() => post(`/api/contracts/${encodeURIComponent(id)}/proof`, body), "Proof processed by the deterministic PoEC gate.");
    });
    $("companyForm").addEventListener("submit", (event) => {
      event.preventDefault(); const body = formObject(event.currentTarget); body.contribution_cym = Number(body.contribution_cym);
      mutate(() => post("/api/companies", body), "AI Company capitalized.").then(() => event.currentTarget.reset());
    });
    $("logoutParticipation").addEventListener("click", () => mutate(() => post("/api/auth/logout", {}), "Signed out."));
    $("contractsList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-contract-action]"); if (!button) return;
      const id = button.dataset.id, action = button.dataset.contractAction;
      if (action === "prove") { $("proofContract").value = id; $("proofForm").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      const body = action === "claim" && button.dataset.companyId ? { company_id: button.dataset.companyId } : {};
      mutate(() => post(`/api/contracts/${encodeURIComponent(id)}/${action}`, body), action === "fund" ? "Contract escrow funded." : button.dataset.companyId ? "Contract claimed through AI Company." : "Contract claimed personally.");
    });
    $("companiesList").addEventListener("submit", (event) => {
      const form = event.target.closest("[data-stake-company]"); if (!form) return; event.preventDefault();
      const amount = Number(new FormData(form).get("amount_cym"));
      mutate(() => post(`/api/companies/${encodeURIComponent(form.dataset.stakeCompany)}/stake`, { amount_cym: amount }), "Capital allocated to AI Company.");
    });
  }
  install();
  return { refresh, get loaded() { return loaded; } };
}
