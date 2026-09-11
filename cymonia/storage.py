from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .models import EconomyState, PolicyDecision


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)


def compute_state_hash(state: EconomyState) -> str:
    payload = state.to_dict()
    payload["state_hash"] = ""
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def save_state(state: EconomyState, root: Path | str) -> None:
    root_path = Path(root)
    state.state_hash = compute_state_hash(state)
    content = json.dumps(state.to_dict(), sort_keys=True, indent=2) + "\n"
    _atomic_write(root_path / "state.json", content)


def load_state(root: Path | str) -> EconomyState:
    path = Path(root) / "state.json"
    return EconomyState.from_dict(json.loads(path.read_text(encoding="utf-8")))


def read_history(root: Path | str) -> list[dict[str, Any]]:
    path = Path(root) / "history.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def append_history(metrics: dict[str, Any], root: Path | str) -> None:
    root_path = Path(root)
    history = read_history(root_path)
    history.append(metrics)
    _atomic_write(root_path / "history.json", json.dumps(history, sort_keys=True, indent=2) + "\n")


def read_policy_decisions(root: Path | str) -> list[PolicyDecision]:
    path = Path(root) / "policy-decisions.jsonl"
    if not path.exists():
        return []
    decisions: list[PolicyDecision] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            decisions.append(PolicyDecision.from_dict(json.loads(line)))
    return decisions


def append_policy_decision(decision: PolicyDecision, root: Path | str) -> None:
    path = Path(root) / "policy-decisions.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(decision.to_dict(), sort_keys=True, separators=(",", ":")) + "\n")
