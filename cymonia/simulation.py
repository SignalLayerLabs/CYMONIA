from __future__ import annotations

from pathlib import Path

from .constitution import load_constitution, verify_constitution_identity
from .genesis import create_genesis_state
from .ledger import append_transactions, verify_ledger
from .market import clear_market, generate_epoch_intents
from .metrics import compute_metrics
from .models import EconomyState, PolicyDecision, Transaction
from .policy import enact_policy, propose_policy
from .storage import (
    append_history,
    append_policy_decision,
    compute_state_hash,
    load_state,
    read_history,
    save_state,
)


def step_epoch(
    state: EconomyState,
    previous_metrics: dict | None = None,
) -> tuple[EconomyState, list[Transaction], PolicyDecision | None, dict]:
    if not verify_constitution_identity():
        raise ValueError("genesis_constitution_identity_mismatch")
    constitution = load_constitution()
    next_state = EconomyState.from_dict(state.to_dict())
    next_state.previous_state_hash = state.state_hash or compute_state_hash(state)
    next_state.epoch += 1

    offers, demands = generate_epoch_intents(next_state)
    transactions = clear_market(next_state, offers, demands)
    metrics = compute_metrics(next_state, transactions, previous_metrics)

    policy_decision: PolicyDecision | None = None
    interval = int(constitution["time"]["policy_meeting_interval_epochs"])
    meeting_due = next_state.epoch % interval == 0
    if meeting_due and (
        next_state.last_policy_epoch < 0
        or next_state.epoch - next_state.last_policy_epoch >= interval
    ):
        policy_decision = propose_policy(metrics, next_state, constitution)
        if not policy_decision.violations:
            enact_policy(next_state, policy_decision, constitution)
            if policy_decision.issuance_amount > 0.0:
                transactions.append(
                    Transaction(
                        tx_id=f"e{next_state.epoch:08d}-issuance",
                        epoch=next_state.epoch,
                        buyer="CYMONIA_CENTRAL_BANK",
                        seller="ALL_LIVE_AGENTS",
                        service="monetary_base",
                        quantity=1.0,
                        unit_price=policy_decision.issuance_amount,
                        amount=policy_decision.issuance_amount,
                        kind="issuance",
                        metadata={
                            "decision_id": policy_decision.decision_id,
                            "distribution": constitution["monetary_policy"]["issuance_distribution"],
                        },
                    )
                )
        metrics = compute_metrics(next_state, transactions, previous_metrics)

    next_state.state_hash = compute_state_hash(next_state)
    return next_state, transactions, policy_decision, metrics


def initialize_economy(
    root: Path | str = "state",
    seed: int | None = None,
    force: bool = False,
) -> EconomyState:
    root_path = Path(root)
    if (root_path / "state.json").exists() and not force:
        raise FileExistsError(f"economy already initialized at {root_path}")
    root_path.mkdir(parents=True, exist_ok=True)
    if force:
        for name in ("state.json", "history.json", "ledger.jsonl", "policy-decisions.jsonl"):
            path = root_path / name
            if path.exists():
                path.unlink()
    state = create_genesis_state(seed=seed)
    save_state(state, root_path)
    (root_path / "history.json").write_text("[]\n", encoding="utf-8")
    (root_path / "ledger.jsonl").write_text("", encoding="utf-8")
    (root_path / "policy-decisions.jsonl").write_text("", encoding="utf-8")
    return state


def advance_persisted_epoch(root: Path | str = "state") -> tuple[EconomyState, dict]:
    root_path = Path(root)
    state = load_state(root_path)
    history = read_history(root_path)
    previous_metrics = history[-1] if history else None
    new_state, transactions, policy, metrics = step_epoch(state, previous_metrics)
    append_transactions(root_path / "ledger.jsonl", transactions)
    if policy is not None:
        append_policy_decision(policy, root_path)
    append_history(metrics, root_path)
    save_state(new_state, root_path)
    return new_state, metrics


def run_epochs(root: Path | str = "state", count: int = 1) -> EconomyState:
    if count < 0:
        raise ValueError("count must be non-negative")
    state = load_state(root)
    for _ in range(count):
        state, _metrics = advance_persisted_epoch(root)
    return state


def verify_economy(root: Path | str = "state") -> tuple[bool, list[str]]:
    root_path = Path(root)
    problems: list[str] = []
    if not verify_constitution_identity():
        problems.append("constitution_identity_mismatch")
    try:
        state = load_state(root_path)
    except (FileNotFoundError, ValueError, KeyError) as exc:
        return False, [f"state_load_failed:{exc}"]

    expected_hash = compute_state_hash(state)
    if state.state_hash != expected_hash:
        problems.append("state_hash_mismatch")
    if any(agent.balance < -1e-9 for agent in state.agents):
        problems.append("negative_balance")
    balances = sum(agent.balance for agent in state.agents)
    if abs(balances - state.money_supply) > 0.001:
        problems.append("supply_accounting_mismatch")

    ledger_ok, ledger_reason = verify_ledger(root_path / "ledger.jsonl")
    if not ledger_ok:
        problems.append(f"ledger:{ledger_reason}")
    history = read_history(root_path)
    if history and int(history[-1].get("epoch", -1)) != state.epoch:
        problems.append("history_epoch_mismatch")
    return not problems, problems
