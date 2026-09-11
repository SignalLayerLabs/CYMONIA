from __future__ import annotations

import hashlib
import json
import random

from .constitution import load_constitution
from .models import Agent, EconomyState

SERVICES = [
    "compute",
    "data",
    "research",
    "code",
    "audit",
    "security",
    "planning",
    "design",
    "verification",
    "storage",
]

BASE_PRICES = {
    "compute": 8.0,
    "data": 11.0,
    "research": 18.0,
    "code": 16.0,
    "audit": 14.0,
    "security": 20.0,
    "planning": 12.0,
    "design": 10.0,
    "verification": 9.0,
    "storage": 4.0,
}


def _state_hash(state: EconomyState) -> str:
    data = state.to_dict()
    data["state_hash"] = ""
    raw = json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def create_genesis_state(seed: int | None = None) -> EconomyState:
    constitution = load_constitution()
    genesis = constitution["genesis"]
    policy = constitution["monetary_policy"]
    seed_value = int(genesis["seed"] if seed is None else seed)
    rng = random.Random(seed_value)
    agents: list[Agent] = []
    count = int(genesis["agent_count"])
    initial_balance = float(genesis["initial_balance_per_agent"])

    for index in range(count):
        specialty = SERVICES[index % len(SERVICES)]
        productivity = round(rng.uniform(0.75, 1.35), 4)
        spend_propensity = round(rng.uniform(0.20, 0.70), 4)
        price_sensitivity = round(rng.uniform(0.75, 1.25), 4)
        own_price = BASE_PRICES[specialty] * rng.uniform(0.90, 1.10)
        agent = Agent(
            agent_id=f"agent-{index + 1:04d}",
            specialty=specialty,
            balance=initial_balance,
            productivity=productivity,
            spend_propensity=spend_propensity,
            price_sensitivity=price_sensitivity,
            reservation_prices={specialty: round(own_price, 6)},
        )
        agents.append(agent)

    state = EconomyState(
        epoch=0,
        seed=seed_value,
        policy_rate=float(policy["genesis_policy_rate_pct"]),
        money_supply=float(genesis["initial_supply"]),
        agents=agents,
        previous_state_hash="GENESIS",
        last_policy_epoch=-1,
        cumulative_issuance=0.0,
    )
    state.state_hash = _state_hash(state)
    return state
