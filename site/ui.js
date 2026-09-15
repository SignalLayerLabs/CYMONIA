export const number = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
export const fmt = (value) =>
  Number.isFinite(Number(value)) && value !== null
    ? number.format(Number(value))
    : "—";
export const fmtMetric = (metric, value) => {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const digits = metric === "mean_reward" ? 6 : metric === "gini" ? 4 : 2;
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
};
export const percent = (value) =>
  value == null ? "—" : `${Number(value).toFixed(2)}%`;
export const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function text(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
export function filterAgents(agents, query = "", specialty = "all") {
  const q = query.toLowerCase().trim();
  return agents
    .filter(
      (a) =>
        (specialty === "all" || a.specialty === specialty) &&
        `${a.agent_id} ${a.specialty}`.toLowerCase().includes(q),
    )
    .sort(
      (a, b) => b.balance - a.balance || a.agent_id.localeCompare(b.agent_id),
    );
}
export function marketTransactions(transactions, epoch, specialty = "all") {
  return transactions.filter(
    (tx) =>
      tx.kind === "trade" &&
      tx.epoch === epoch &&
      (specialty === "all" || tx.service === specialty),
  );
}
export function seriesPoints(values, width = 640, height = 160, bounds = null) {
  if (!values.length) return { points: [], min: 0, max: 1 };
  let min = bounds ? bounds[0] : Math.min(...values),
    max = bounds ? bounds[1] : Math.max(...values);
  if (max === min) {
    const gap = Math.max(Math.abs(max) * 0.05, 0.01);
    min -= gap;
    max += gap;
  }
  return {
    min,
    max,
    points: values.map((v, i) => [
      52 + (i / Math.max(1, values.length - 1)) * (width - 66),
      16 + ((max - v) / (max - min)) * (height - 42),
    ]),
  };
}
export function chart(
  container,
  histories,
  metric,
  labels,
  colors = ["#a8edbd", "#bba9ff"],
) {
  const values = histories.flatMap((h) =>
    h.map((row) => Number(row[metric] ?? 0)),
  );
  if (!values.length) {
    container.textContent =
      "No observations yet. The first epoch will appear here.";
    return;
  }
  let min = Math.min(...values),
    max = Math.max(...values);
  const gap = Math.max((max - min) * 0.12, max === min ? Math.abs(max) * 0.01 : 0, 0.000001);
  min -= gap;
  max += gap;
  const w = 700,
    h = 190;
  let svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHTML(labels.join(" versus "))}; ${escapeHTML(metric)}. Exact values in the table below.">`;
  for (let i = 0; i < 4; i++) {
    const y = 16 + (i * (h - 42)) / 3;
    svg += `<path d="M52 ${y}H686" stroke="#293740" stroke-dasharray="3 5"/><text x="0" y="${y + 4}" fill="#a5b4b7" font-size="11">${fmtMetric(metric, max - (i * (max - min)) / 3)}</text>`;
  }
  histories.forEach((history, i) => {
    const { points } = seriesPoints(
      history.map((row) => Number(row[metric] ?? 0)),
      w,
      h,
      [min, max],
    );
    if (!points.length) return;
    svg += `<polyline points="${points.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="2.5" stroke-linejoin="round"/>`;
    const last = points.at(-1);
    svg += `<circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${colors[i % colors.length]}"/>`;
  });
  const first = histories.find((h) => h.length) || [];
  svg += `<text x="52" y="187" fill="#a5b4b7" font-size="11">EPOCH ${first[0]?.epoch ?? 0}</text><text x="686" y="187" text-anchor="end" fill="#a5b4b7" font-size="11">${first.at(-1)?.epoch ?? 0}</text></svg>`;
  container.innerHTML = svg;
}
