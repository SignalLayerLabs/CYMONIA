import { validateContractDraft } from "./economy.js";

export const DEFAULT_BRAIN_MODEL = "@cf/zai-org/glm-4.7-flash";

export function buildContractPrompt(snapshot = {}) {
  return [
    "You are an economic analyst inside CYMONIA, a synthetic autonomous economy.",
    "Your job is proposal-only: you cannot mint, transfer, fund, settle, or override any rule.",
    "Constitutional rule: No Economic Purpose -> No Contract.",
    "Identify exactly one measurable problem or opportunity that improves CYMONIA itself, not an unrelated external task.",
    "Return ONLY one JSON object with these keys: title, description, category, economic_purpose, metric_key, baseline_value, target_direction, min_improvement_pct, reward_cym.",
    "category must be one of economy, research, infrastructure, expansion. target_direction must be increase or decrease.",
    "Use the supplied snapshot to choose a real baseline. Do not claim certainty or invent measurements that are absent.",
    `CYMONIA snapshot: ${JSON.stringify(snapshot)}`,
  ].join("\n");
}

function extractText(output) {
  if (typeof output === "string") return output;
  if (output && typeof output.response === "string") return output.response;
  if (output && typeof output.result === "string") return output.result;
  throw new TypeError("brain_output_missing_text");
}

export function parseBrainProposal(output) {
  const text = extractText(output).trim();
  if (!text.startsWith("{") || !text.endsWith("}")) {
    throw new TypeError("brain_output_not_strict_json");
  }
  let proposal;
  try {
    proposal = JSON.parse(text);
  } catch {
    throw new TypeError("brain_output_invalid_json");
  }
  if (!proposal || Array.isArray(proposal) || typeof proposal !== "object") {
    throw new TypeError("brain_output_invalid_shape");
  }
  const validation = validateContractDraft(proposal);
  if (!validation.ok) {
    const error = new TypeError(`brain_proposal_invalid:${validation.errors.join(",")}`);
    error.validation = validation;
    throw error;
  }
  return proposal;
}

export async function proposeContractWithWorkersAI(env, snapshot) {
  if (!env?.AI || typeof env.AI.run !== "function") {
    throw new Error("workers_ai_not_bound");
  }
  const model = env.BRAIN_MODEL || DEFAULT_BRAIN_MODEL;
  const output = await env.AI.run(model, {
    prompt: buildContractPrompt(snapshot),
    max_completion_tokens: 900,
    temperature: 0.2,
  });
  return { model, proposal: parseBrainProposal(output) };
}
