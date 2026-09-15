"""Reproducible, in-memory experiments isolated from CYMONIA's canonical state."""

from __future__ import annotations

import json
import random
from pathlib import Path
from statistics import fmean
from typing import Any

from .constitution import constitution_hash, load_constitution
from .genesis import BASE_PRICES, create_genesis_state
from .simulation import step_epoch


SCHEMA_VERSION = "1.0"
MODEL_ID = "seeded-epsilon-greedy-v1"
EPSILON = 0.12
ACTIONS = (0.2, 0.4, 0.6, 0.8)
TRACE_AGENT_COUNT = 3


def _key(action: float) -> str:
    return f"{action:.1f}"


def _rounded_map(values: dict[float, float]) -> dict[str, float]:
    return {_key(action): round(values[action], 9) for action in ACTIONS}


def _choose_action(
    rng: random.Random,
    values: dict[float, float],
) -> tuple[float, bool]:
    explore = rng.random() < EPSILON
    if explore:
        return ACTIONS[rng.randrange(len(ACTIONS))], True
    best = max(values.values())
    candidates = [action for action in ACTIONS if values[action] == best]
    return candidates[rng.randrange(len(candidates))], False


def _validate(seeds: list[int], epochs: int) -> None:
    if not isinstance(seeds, list) or not seeds:
        raise ValueError("seeds must be a non-empty list of integers")
    if any(isinstance(seed, bool) or not isinstance(seed, int) for seed in seeds):
        raise ValueError("seeds must be a non-empty list of integers")
    if len(set(seeds)) != len(seeds):
        raise ValueError("seeds must be unique")
    if isinstance(epochs, bool) or not isinstance(epochs, int) or epochs < 1:
        raise ValueError("epochs must be a positive integer")


def _utility_by_agent(transactions: list[Any]) -> dict[str, float]:
    utility: dict[str, float] = {}
    for tx in transactions:
        if tx.kind == "trade":
            utility[tx.buyer] = utility.get(tx.buyer, 0.0) + tx.quantity * BASE_PRICES[tx.service]
    return utility


def _run_arm(seed: int, epochs: int, arm: str, initial_balance: float) -> dict[str, Any]:
    state = create_genesis_state(seed=seed)
    initial_state_hash = state.state_hash
    agent_ids = [agent.agent_id for agent in state.agents]
    trace_ids = set(agent_ids[:TRACE_AGENT_COUNT])
    fixed = {agent.agent_id: agent.spend_propensity for agent in state.agents}
    values = {agent_id: {action: 0.0 for action in ACTIONS} for agent_id in agent_ids}
    counts = {agent_id: {action: 0 for action in ACTIONS} for agent_id in agent_ids}
    rngs = {
        agent_id: random.Random(seed * 1_000_003 + index * 97_409 + 71)
        for index, agent_id in enumerate(agent_ids)
    }
    history: list[dict[str, Any]] = []
    decisions: list[dict[str, Any]] = []
    previous_metrics = None
    cumulative_reward = 0.0
    max_accounting_error = 0.0

    for _ in range(epochs):
        selected: dict[str, tuple[float, bool, dict[str, float]]] = {}
        for agent in state.agents:
            if arm == "adaptive":
                q_before = _rounded_map(values[agent.agent_id])
                action, explore = _choose_action(rngs[agent.agent_id], values[agent.agent_id])
                agent.spend_propensity = action
            else:
                action, explore, q_before = fixed[agent.agent_id], False, {}
                agent.spend_propensity = action
            selected[agent.agent_id] = (action, explore, q_before)

        balances_before = {agent.agent_id: agent.balance for agent in state.agents}
        state, transactions, policy, metrics = step_epoch(state, previous_metrics)
        previous_metrics = metrics
        utility = _utility_by_agent(transactions)
        issuance_per_agent = (
            policy.issuance_amount / len(state.agents)
            if policy is not None and policy.enacted and state.agents
            else 0.0
        )
        epoch_rewards: list[float] = []
        for agent in state.agents:
            agent_id = agent.agent_id
            action, explore, q_before = selected[agent_id]
            reward = (
                agent.balance - balances_before[agent_id] - issuance_per_agent
                + utility.get(agent_id, 0.0)
            ) / initial_balance
            reward = round(reward, 9)
            epoch_rewards.append(reward)
            if arm == "adaptive":
                counts[agent_id][action] += 1
                count = counts[agent_id][action]
                old = values[agent_id][action]
                values[agent_id][action] = old + (reward - old) / count
                q_after = _rounded_map(values[agent_id])
            else:
                q_after = {}
            if agent_id in trace_ids:
                decisions.append({
                    "epoch": state.epoch,
                    "agent_id": agent_id,
                    "action": round(action, 4),
                    "reward": reward,
                    "explore": explore,
                    "q_before": q_before,
                    "q_after": q_after,
                })
        mean_reward = fmean(epoch_rewards)
        cumulative_reward += sum(epoch_rewards)
        row = dict(metrics)
        row["mean_reward"] = round(mean_reward, 9)
        row["cumulative_reward"] = round(cumulative_reward, 9)
        history.append(row)
        max_accounting_error = max(
            max_accounting_error,
            abs(sum(agent.balance for agent in state.agents) - state.money_supply),
        )

    return {
        "seed": seed,
        "arm": arm,
        "initial_state_hash": initial_state_hash,
        "history": history,
        "decisions": decisions,
        "final_values": {
            agent_id: _rounded_map(values[agent_id]) for agent_id in agent_ids
        } if arm == "adaptive" else {},
        "final_action_counts": {
            agent_id: {_key(action): counts[agent_id][action] for action in ACTIONS}
            for agent_id in agent_ids
        } if arm == "adaptive" else {},
        "cumulative_reward": round(cumulative_reward, 9),
        "max_accounting_error": round(max_accounting_error, 9),
    }


def _mean(runs: list[dict[str, Any]], field: str) -> float:
    if field == "cumulative_reward":
        return round(fmean(run[field] for run in runs), 9)
    return round(fmean(run["history"][-1][field] for run in runs), 9)


def run_study(seeds: list[int], epochs: int) -> dict[str, Any]:
    """Compare fixed Genesis behavior with seeded adaptive spending agents."""
    _validate(seeds, epochs)
    constitution = load_constitution()
    initial_balance = float(constitution["genesis"]["initial_balance_per_agent"])
    runs: list[dict[str, Any]] = []
    for seed in seeds:
        runs.append(_run_arm(seed, epochs, "baseline", initial_balance))
        runs.append(_run_arm(seed, epochs, "adaptive", initial_balance))

    baseline = [run for run in runs if run["arm"] == "baseline"]
    adaptive = [run for run in runs if run["arm"] == "adaptive"]
    fields = ("nominal_gdp", "gini", "transaction_count", "cumulative_reward")
    baseline_means = {field: _mean(baseline, field) for field in fields}
    adaptive_means = {field: _mean(adaptive, field) for field in fields}
    paired = {
        field: round(fmean(
            (a[field] if field == "cumulative_reward" else a["history"][-1][field])
            - (b[field] if field == "cumulative_reward" else b["history"][-1][field])
            for b, a in zip(baseline, adaptive)
        ), 9)
        for field in fields
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "model": {
            "id": MODEL_ID,
            "type": "adaptive multi-armed bandit",
            "algorithm": "independent per-agent seeded epsilon-greedy sample-average learning",
            "update_rule": "Q(a) <- Q(a) + (reward - Q(a)) / N(a)",
            "reward": "(balance change excluding equal policy issuance + purchased service utility at canonical base price) / initial balance",
            "baseline": "fixed Genesis spend_propensity; no learning",
        },
        "description": "Matched-seed toy-economy comparison of fixed and adaptive spending behavior.",
        "config": {
            "seeds": list(seeds),
            "epochs": epochs,
            "epsilon": EPSILON,
            "actions": list(ACTIONS),
            "agent_count": int(constitution["genesis"]["agent_count"]),
            "decision_trace_agents": TRACE_AGENT_COUNT,
        },
        "constitution_hash": constitution_hash(),
        "arms": [
            {"id": "baseline", "label": "Fixed rule baseline", "description": "Canonical agents retain their seeded Genesis spending propensity."},
            {"id": "adaptive", "label": "Adaptive bandit", "description": "Each agent independently selects a spending propensity with seeded epsilon-greedy learning."},
        ],
        "runs": runs,
        "summary": [
            {"arm": "baseline", "seeds": len(seeds), "means": baseline_means, "paired_difference_vs_baseline": None},
            {"arm": "adaptive", "seeds": len(seeds), "means": adaptive_means, "paired_difference_vs_baseline": paired},
        ],
    }


def write_study(study: dict[str, Any], output: Path | str) -> None:
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(study, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
