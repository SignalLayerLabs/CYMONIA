const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const fmt6 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

async function loadJSON(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

function text(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function pct(value) { return `${Number(value || 0).toFixed(2)}%`; }
function cym(value) { return `${fmt.format(Number(value || 0))} CYMONIA`; }
function shortHash(value) { return value || '—'; }

function renderState(state) {
  const m = state.latest_metrics || {};
  text('moneySupply', fmt.format(state.money_supply));
  text('inflation', pct(m.inflation_pct));
  text('policyRate', pct(state.policy_rate_pct));
  text('nominalGdp', fmt.format(m.nominal_gdp || 0));
  text('agentCount', fmt.format(state.agent_count));
  text('epoch', fmt.format(state.epoch));
  text('velocityBadge', `velocity ${Number(m.velocity || 0).toFixed(5)}`);
  text('giniBadge', `Gini ${Number(m.gini || 0).toFixed(3)}`);
  text('constitutionHash', shortHash(state.constitution_hash));
  text('stateHash', shortHash(state.state_hash));
  text('constitutionStatus', state.constitution_valid ? 'VERIFIED' : 'INVALID');
  text('integrityBadge', state.constitution_valid ? 'GENESIS VERIFIED' : 'IDENTITY MISMATCH');
  document.getElementById('networkDot')?.classList.toggle('ok', Boolean(state.constitution_valid));

  const agents = document.getElementById('topAgents');
  if (agents) {
    agents.innerHTML = (state.top_agents || []).map((agent, i) => `
      <div class="agent">
        <span class="rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="agent-id">${agent.agent_id}<small>${agent.specialty}</small></span>
        <strong class="balance">${cym(agent.balance)}</strong>
      </div>`).join('');
  }
}

function renderPolicy(payload) {
  const latest = payload.latest;
  const empty = document.getElementById('policyEmpty');
  const content = document.getElementById('policyContent');
  if (!latest) {
    if (empty) empty.hidden = false;
    if (content) content.hidden = true;
    return;
  }
  if (empty) empty.hidden = true;
  if (content) content.hidden = false;
  const delta = Number(latest.new_policy_rate) - Number(latest.previous_policy_rate);
  let stance = 'HOLD';
  let stanceClass = '';
  if (delta > 0) { stance = 'TIGHTEN'; stanceClass = 'tighten'; }
  else if (delta < 0 || Number(latest.annualized_issuance_rate) > 0) { stance = 'EASE'; stanceClass = 'ease'; }
  const badge = document.getElementById('stanceBadge');
  if (badge) {
    badge.textContent = `${stance} · EPOCH ${latest.epoch}`;
    badge.classList.remove('tighten', 'ease');
    if (stanceClass) badge.classList.add(stanceClass);
  }
  text('decisionRate', `${Number(latest.previous_policy_rate).toFixed(2)}% → ${Number(latest.new_policy_rate).toFixed(2)}%`);
  text('decisionIssuance', `${Number(latest.annualized_issuance_rate).toFixed(3)}% · ${cym(latest.issuance_amount)}`);
  text('policyRationale', latest.rationale);
  const votes = document.getElementById('votes');
  if (votes) {
    votes.innerHTML = Object.entries(latest.votes || {}).map(([role, vote]) => `
      <div class="vote"><strong class="role">${role} agent</strong><span class="move">${Number(vote.rate_delta) >= 0 ? '+' : ''}${Number(vote.rate_delta).toFixed(2)}pp</span><span class="stance">${vote.stance}</span></div>
    `).join('');
  }
}

function renderTransactions(transactions) {
  text('txCount', `${transactions.length} shown`);
  const body = document.getElementById('transactions');
  if (!body) return;
  if (!transactions.length) {
    body.innerHTML = '<tr><td colspan="5" class="muted">No transactions yet.</td></tr>';
    return;
  }
  body.innerHTML = transactions.map(tx => `
    <tr>
      <td>${tx.epoch}</td>
      <td>${tx.buyer}</td>
      <td>${tx.seller}</td>
      <td>${tx.service}</td>
      <td class="num">${fmt6.format(tx.amount)}</td>
    </tr>`).join('');
}

function drawChart(history) {
  const canvas = document.getElementById('macroChart');
  if (!canvas || !history.length) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(600, Math.floor(rect.width * dpr));
  canvas.height = Math.max(260, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const pad = { top: 18, right: 16, bottom: 26, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.fillStyle = '#667085';
  ctx.font = '11px system-ui';
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + plotH * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
  }

  const supplies = history.map(x => Number(x.money_supply || 0));
  const gdps = history.map(x => Number(x.nominal_gdp || 0));
  const supplyMin = Math.min(...supplies);
  const supplyMax = Math.max(...supplies, supplyMin + 1);
  const gdpMax = Math.max(...gdps, 1);
  const xAt = i => pad.left + (history.length === 1 ? 0 : plotW * i / (history.length - 1));
  const supplyY = v => pad.top + plotH - ((v - supplyMin) / (supplyMax - supplyMin)) * plotH;
  const gdpY = v => pad.top + plotH - (v / gdpMax) * plotH;

  function line(values, yFn, stroke) {
    ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.beginPath();
    values.forEach((v, i) => { const x = xAt(i), y = yFn(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
  line(supplies, supplyY, '#6ee7ff');
  line(gdps, gdpY, '#a78bfa');
  ctx.fillStyle = '#667085';
  ctx.fillText(`E${history[0].epoch}`, pad.left, height - 6);
  const label = `E${history[history.length - 1].epoch}`;
  ctx.fillText(label, width - pad.right - ctx.measureText(label).width, height - 6);
}

async function boot() {
  try {
    const [state, history, policy, transactions] = await Promise.all([
      loadJSON('data/state.json'),
      loadJSON('data/history.json'),
      loadJSON('data/policy.json'),
      loadJSON('data/transactions.json'),
    ]);
    renderState(state);
    renderPolicy(policy);
    renderTransactions(transactions);
    drawChart(history);
    window.addEventListener('resize', () => drawChart(history), { passive: true });
  } catch (error) {
    console.error('CYMONIA dashboard failed to load', error);
    text('constitutionStatus', 'DATA ERROR');
  }
}

document.addEventListener('DOMContentLoaded', boot);
