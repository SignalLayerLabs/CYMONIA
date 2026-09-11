from __future__ import annotations

from statistics import median

from .constitution import load_constitution, validate_policy_action
from .models import EconomyState, PolicyDecision


def _round_quarter(value: float) -> float:
    return round(value * 4.0) / 4.0


def policy_votes(
    metrics: dict,
    state: EconomyState,
    constitution: dict | None = None,
) -> dict[str, dict]:
    c = constitution or load_constitution()
    target = float(c["monetary_policy"]["inflation_target_pct"])
    inflation = float(metrics.get("inflation_pct", 0.0))
    active = float(metrics.get("active_agent_rate_pct", 0.0))
    gini = float(metrics.get("gini", 0.0))
    velocity = float(metrics.get("velocity", 0.0))
    gdp = float(metrics.get("nominal_gdp", 0.0))

    if inflation > target + 2.0:
        inflation_vote = {"rate_delta": 0.5, "issuance_rate": 0.0, "stance": "tighten"}
    elif inflation > target + 0.75:
        inflation_vote = {"rate_delta": 0.25, "issuance_rate": 0.0, "stance": "tighten"}
    elif inflation < target - 3.0:
        inflation_vote = {"rate_delta": -0.25, "issuance_rate": 2.0, "stance": "ease"}
    elif inflation < target - 1.0:
        inflation_vote = {"rate_delta": -0.25, "issuance_rate": 1.0, "stance": "ease"}
    else:
        inflation_vote = {"rate_delta": 0.0, "issuance_rate": 0.0, "stance": "hold"}

    if active < 15.0 or gdp < 25.0:
        growth_vote = {"rate_delta": -0.5, "issuance_rate": 3.0, "stance": "ease"}
    elif active < 35.0 or velocity < 0.001:
        growth_vote = {"rate_delta": -0.25, "issuance_rate": 1.5, "stance": "ease"}
    elif active > 80.0 and velocity > 0.02:
        growth_vote = {"rate_delta": 0.25, "issuance_rate": 0.0, "stance": "tighten"}
    else:
        growth_vote = {"rate_delta": 0.0, "issuance_rate": 0.0, "stance": "hold"}

    if gini > 0.65:
        stability_vote = {"rate_delta": 0.0, "issuance_rate": 2.0, "stance": "stabilize"}
    elif active < 10.0:
        stability_vote = {"rate_delta": -0.25, "issuance_rate": 2.0, "stance": "stabilize"}
    elif inflation > target + 4.0:
        stability_vote = {"rate_delta": 0.25, "issuance_rate": 0.0, "stance": "tighten"}
    else:
        stability_vote = {"rate_delta": 0.0, "issuance_rate": 0.0, "stance": "hold"}

    return {
        "inflation": inflation_vote,
        "growth": growth_vote,
        "stability": stability_vote,
    }


def propose_policy(
    metrics: dict,
    state: EconomyState,
    constitution: dict | None = None,
) -> PolicyDecision:
    c = constitution or load_constitution()
    policy = c["monetary_policy"]
    time = c["time"]
    votes = policy_votes(metrics, state, c)

    rate_delta = _round_quarter(median(vote["rate_delta"] for vote in votes.values()))
    max_change = float(policy["max_policy_rate_change_pct_points"])
    rate_delta = max(-max_change, min(max_change, rate_delta))
    new_rate = state.policy_rate + rate_delta
    new_rate = max(float(policy["policy_rate_floor_pct"]), min(float(policy["policy_rate_ceiling_pct"]), new_rate))

    issuance_rate = sum(float(vote["issuance_rate"]) for vote in votes.values()) / len(votes)
    issuance_rate = round(max(0.0, min(float(policy["max_annual_issuance_pct"]), issuance_rate)), 6)
    interval = int(time["policy_meeting_interval_epochs"])
    epochs_per_year = int(time["epochs_per_monetary_year"])
    issuance_amount = round(state.money_supply * (issuance_rate / 100.0) * (interval / epochs_per_year), 6)
    live_count = sum(1 for agent in state.agents if agent.active)
    if live_count > 0 and issuance_amount > 0.0:
        per_agent = round(issuance_amount / live_count, 6)
        issuance_amount = round(per_agent * live_count, 6)

    action = {
        "current_policy_rate": state.policy_rate,
        "new_policy_rate": new_rate,
        "annualized_issuance_rate": issuance_rate,
        "issuance_amount": issuance_amount,
        "current_money_supply": state.money_supply,
        "epoch": state.epoch,
        "last_policy_epoch": state.last_policy_epoch,
    }
    violations = validate_policy_action(action, c)
    evidence = {
        "inflation_pct": float(metrics.get("inflation_pct", 0.0)),
        "nominal_gdp": float(metrics.get("nominal_gdp", 0.0)),
        "active_agent_rate_pct": float(metrics.get("active_agent_rate_pct", 0.0)),
        "gini": float(metrics.get("gini", 0.0)),
        "velocity": float(metrics.get("velocity", 0.0)),
    }
    stance = "hold"
    if new_rate > state.policy_rate or issuance_rate == 0.0 and evidence["inflation_pct"] > float(policy["inflation_target_pct"]):
        stance = "tighten"
    elif new_rate < state.policy_rate or issuance_rate > 0.0:
        stance = "ease"
    rationale = (
        f"Governor {stance}: inflation {evidence['inflation_pct']:.2f}%, "
        f"activity {evidence['active_agent_rate_pct']:.2f}%, "
        f"gini {evidence['gini']:.3f}; council median rate move {rate_delta:+.2f}pp."
    )

    return PolicyDecision(
        decision_id=f"policy-{state.epoch:08d}",
        epoch=state.epoch,
        previous_policy_rate=round(state.policy_rate, 6),
        new_policy_rate=round(new_rate, 6),
        annualized_issuance_rate=issuance_rate,
        issuance_amount=issuance_amount,
        votes=votes,
        evidence=evidence,
        rationale=rationale,
        violations=violations,
        enacted=False,
    )


def enact_policy(
    state: EconomyState,
    decision: PolicyDecision,
    constitution: dict | None = None,
) -> EconomyState:
    c = constitution or load_constitution()
    action = {
        "current_policy_rate": state.policy_rate,
        "new_policy_rate": decision.new_policy_rate,
        "annualized_issuance_rate": decision.annualized_issuance_rate,
        "issuance_amount": decision.issuance_amount,
        "current_money_supply": state.money_supply,
        "epoch": state.epoch,
        "last_policy_epoch": state.last_policy_epoch,
    }
    violations = validate_policy_action(action, c)
    if violations:
        decision.violations = violations
        raise ValueError("constitutional_violation:" + ",".join(violations))

    live_agents = [agent for agent in state.agents if agent.active]
    if decision.issuance_amount > 0.0 and not live_agents:
        raise ValueError("no_live_agents_for_issuance")

    state.policy_rate = round(decision.new_policy_rate, 6)
    if decision.issuance_amount > 0.0:
        per_agent = decision.issuance_amount / len(live_agents)
        distributed = 0.0
        for index, agent in enumerate(live_agents):
            if index == len(live_agents) - 1:
                delta = round(decision.issuance_amount - distributed, 6)
            else:
                delta = round(per_agent, 6)
                distributed = round(distributed + delta, 6)
            agent.balance = round(agent.balance + delta, 6)
        state.money_supply = round(state.money_supply + decision.issuance_amount, 6)
        state.cumulative_issuance = round(state.cumulative_issuance + decision.issuance_amount, 6)
    state.last_policy_epoch = state.epoch
    decision.enacted = True
    decision.violations = []
    return state
