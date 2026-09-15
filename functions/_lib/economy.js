const CATEGORIES = new Set(["economy", "research", "infrastructure", "expansion"]);
const DIRECTIONS = new Set(["increase", "decrease"]);
const METRIC_KEY = /^[a-z][a-z0-9_.-]{2,63}$/;
const MAX_REWARD_CYM = 10000;

export function normalizeAmount(value, max = Number.POSITIVE_INFINITY) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > max) {
    throw new RangeError("invalid_amount");
  }
  return Math.round(n * 1e6) / 1e6;
}

export function validateContractDraft(draft = {}) {
  const errors = [];
  const title = String(draft.title || "").trim();
  const description = String(draft.description || "").trim();
  const purpose = String(draft.economic_purpose || "").trim();
  const metricKey = String(draft.metric_key || "").trim();
  const baseline = Number(draft.baseline_value);
  const minImprovement = Number(draft.min_improvement_pct);

  if (title.length < 8 || title.length > 120) errors.push("title_invalid");
  if (description.length < 20 || description.length > 4000) errors.push("description_invalid");
  if (!CATEGORIES.has(draft.category)) errors.push("category_invalid");
  if (purpose.length < 24 || purpose.length > 1000) errors.push("economic_purpose_required");
  if (!METRIC_KEY.test(metricKey)) errors.push("metric_key_invalid");
  if (!Number.isFinite(baseline)) errors.push("baseline_value_invalid");
  if (!DIRECTIONS.has(draft.target_direction)) errors.push("target_direction_invalid");
  if (!Number.isFinite(minImprovement) || minImprovement <= 0 || minImprovement > 1000) {
    errors.push("min_improvement_pct_invalid");
  }
  try {
    normalizeAmount(draft.reward_cym, MAX_REWARD_CYM);
  } catch {
    errors.push("reward_cym_invalid");
  }

  const measurable = errors.every(
    (error) =>
      ![
        "economic_purpose_required",
        "metric_key_invalid",
        "baseline_value_invalid",
        "target_direction_invalid",
        "min_improvement_pct_invalid",
      ].includes(error),
  );
  const score = Math.max(0, 100 - errors.length * 20);
  return { ok: errors.length === 0 && measurable, score, errors };
}

export function calculateImprovement(direction, beforeValue, afterValue) {
  if (!DIRECTIONS.has(direction)) throw new RangeError("invalid_direction");
  const before = Number(beforeValue);
  const after = Number(afterValue);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  if (Math.abs(before) < 1e-12) return null;
  const delta = direction === "increase" ? after - before : before - after;
  return Math.round(((delta / Math.abs(before)) * 100) * 1e6) / 1e6;
}

export function evaluateProof(contract, proof = {}) {
  const baseline = Number(contract.baseline_value);
  const before = Number(proof.before_value);
  const after = Number(proof.after_value);
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return { accepted: false, reason: "measurement_invalid", observed_improvement_pct: null };
  }
  const tolerance = Math.max(1e-9, Math.abs(baseline) * 1e-9);
  if (!Number.isFinite(baseline) || Math.abs(before - baseline) > tolerance) {
    return { accepted: false, reason: "baseline_mismatch", observed_improvement_pct: null };
  }
  const observed = calculateImprovement(contract.target_direction, before, after);
  if (observed === null) {
    return { accepted: false, reason: "baseline_zero", observed_improvement_pct: null };
  }
  const threshold = Number(contract.min_improvement_pct);
  const evidenceUrl = String(proof.evidence_url || "").trim();
  if (!/^https:\/\//i.test(evidenceUrl)) {
    return { accepted: false, reason: "evidence_url_invalid", observed_improvement_pct: observed };
  }
  if (observed + 1e-9 < threshold) {
    return { accepted: false, reason: "threshold_not_met", observed_improvement_pct: observed };
  }
  return { accepted: true, reason: "threshold_met", observed_improvement_pct: observed };
}

export function stakeUnitsForDeposit(company, depositValue) {
  const deposit = normalizeAmount(depositValue, MAX_REWARD_CYM);
  const treasury = Number(company?.treasury_cym || 0);
  const units = Number(company?.stake_units || 0);
  if (!Number.isFinite(treasury) || treasury < 0 || !Number.isFinite(units) || units < 0) {
    throw new RangeError("invalid_company_book");
  }
  if (treasury === 0 || units === 0) return deposit;
  const bookValuePerUnit = treasury / units;
  return Math.round((deposit / bookValuePerUnit) * 1e6) / 1e6;
}

export const ECONOMY_LIMITS = Object.freeze({
  maxRewardCym: MAX_REWARD_CYM,
  allowedCategories: [...CATEGORIES],
});
