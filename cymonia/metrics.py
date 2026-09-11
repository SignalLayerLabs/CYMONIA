from __future__ import annotations

from .genesis import BASE_PRICES
from .models import EconomyState, Transaction


def gini_coefficient(values: list[float]) -> float:
    cleaned = sorted(max(0.0, float(v)) for v in values)
    n = len(cleaned)
    if n == 0:
        return 0.0
    total = sum(cleaned)
    if total <= 0:
        return 0.0
    weighted = sum((index + 1) * value for index, value in enumerate(cleaned))
    gini = (2.0 * weighted) / (n * total) - (n + 1.0) / n
    return max(0.0, min(1.0, gini))


def compute_metrics(
    state: EconomyState,
    transactions: list[Transaction],
    previous_metrics: dict | None = None,
) -> dict[str, float | int]:
    trade_txs = [tx for tx in transactions if tx.kind == "trade"]
    nominal_gdp = sum(tx.amount for tx in trade_txs)
    weighted_index_sum = 0.0
    quantity_sum = 0.0
    for tx in trade_txs:
        base = BASE_PRICES.get(tx.service)
        if base and tx.quantity > 0:
            weighted_index_sum += tx.quantity * (tx.unit_price / base) * 100.0
            quantity_sum += tx.quantity
    if quantity_sum > 0:
        price_index = weighted_index_sum / quantity_sum
    elif previous_metrics and "price_index" in previous_metrics:
        price_index = float(previous_metrics["price_index"])
    else:
        price_index = 100.0

    if previous_metrics and float(previous_metrics.get("price_index", 0.0)) > 0:
        previous_index = float(previous_metrics["price_index"])
        inflation_pct = ((price_index / previous_index) - 1.0) * 100.0
    else:
        inflation_pct = 0.0

    active_ids: set[str] = set()
    for tx in trade_txs:
        active_ids.add(tx.buyer)
        active_ids.add(tx.seller)
    live_agents = [agent for agent in state.agents if agent.active]
    active_rate = (len(active_ids) / len(live_agents) * 100.0) if live_agents else 0.0
    money_supply = float(state.money_supply)
    velocity = nominal_gdp / money_supply if money_supply > 0 else 0.0

    return {
        "epoch": state.epoch,
        "money_supply": round(money_supply, 6),
        "nominal_gdp": round(nominal_gdp, 6),
        "price_index": round(price_index, 6),
        "inflation_pct": round(inflation_pct, 6),
        "velocity": round(velocity, 9),
        "active_agent_rate_pct": round(active_rate, 6),
        "gini": round(gini_coefficient([agent.balance for agent in live_agents]), 6),
        "transaction_count": len(trade_txs),
        "policy_rate_pct": round(state.policy_rate, 6),
        "agent_count": len(live_agents),
    }
