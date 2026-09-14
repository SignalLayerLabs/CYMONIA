from __future__ import annotations

import json
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cymonia.constitution import constitution_hash, verify_constitution_identity, load_constitution
from cymonia.genesis import SERVICES
from cymonia.simulation import verify_economy
from cymonia.ledger import read_ledger
from cymonia.storage import load_state, read_history, read_policy_decisions


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def build_dashboard_data(state_root: Path | str = "state", site_root: Path | str = "site") -> None:
    state_root = Path(state_root)
    site_root = Path(site_root)
    data_root = site_root / "data"
    state = load_state(state_root)
    history = read_history(state_root)
    decisions = read_policy_decisions(state_root)
    transactions = read_ledger(state_root / "ledger.jsonl")
    latest_metrics = history[-1] if history else {}
    top_agents = sorted(
        state.agents,
        key=lambda agent: (-agent.balance, agent.agent_id),
    )[:10]
    integrity_ok, integrity_problems = verify_economy(state_root)
    interval = int(load_constitution()["time"]["policy_meeting_interval_epochs"])
    current_trades = [tx for tx in transactions if tx.epoch == state.epoch and tx.kind == "trade"]
    markets = []
    for service in SERVICES:
        trades = [tx for tx in current_trades if tx.service == service]
        quantity = sum(tx.quantity for tx in trades)
        volume = sum(tx.amount for tx in trades)
        markets.append({
            "service": service,
            "agents": sum(1 for agent in state.agents if agent.active and agent.specialty == service),
            "trades": len(trades),
            "volume": round(volume, 6),
            "quantity": round(quantity, 6),
            "average_price": round(volume / quantity, 6) if quantity else None,
        })
    state_payload = {
        "schema_version": 2,
        "agents": [agent.to_dict() for agent in sorted(state.agents, key=lambda a: a.agent_id)],
        "markets": markets,
        "integrity": {"ok": integrity_ok, "problems": integrity_problems, "checked_at": "snapshot build"},
        "next_policy_epoch": (state.epoch // interval + 1) * interval,
        "agent_model": "Deterministic rule-based agents (Genesis v0.1)",
        "epoch": state.epoch,
        "currency": "CYMONIA",
        "money_supply": state.money_supply,
        "policy_rate_pct": state.policy_rate,
        "agent_count": sum(1 for agent in state.agents if agent.active),
        "cumulative_issuance": state.cumulative_issuance,
        "state_hash": state.state_hash,
        "previous_state_hash": state.previous_state_hash,
        "constitution_hash": constitution_hash(),
        "constitution_valid": verify_constitution_identity(),
        "latest_metrics": latest_metrics,
        "top_agents": [
            {
                "agent_id": agent.agent_id,
                "specialty": agent.specialty,
                "balance": agent.balance,
                "sales": agent.completed_sales,
                "purchases": agent.completed_purchases,
            }
            for agent in top_agents
        ],
    }
    policy_payload = {
        "latest": decisions[-1].to_dict() if decisions else None,
        "count": len(decisions),
        "recent": [decision.to_dict() for decision in decisions[-12:]],
    }
    tx_payload = [tx.to_dict() for tx in transactions[-60:]][::-1]
    _write_json(data_root / "state.json", state_payload)
    _write_json(data_root / "history.json", history[-500:])
    _write_json(data_root / "policy.json", policy_payload)
    _write_json(data_root / "transactions.json", tx_payload)


def main() -> int:
    build_dashboard_data()
    print("CYMONIA dashboard data built")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
