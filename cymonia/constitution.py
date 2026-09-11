from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONSTITUTION_PATH = ROOT / "constitution" / "genesis.json"
DEFAULT_HASH_PATH = ROOT / "constitution" / "GENESIS_SHA256"


def load_constitution(path: Path | str | None = None) -> dict[str, Any]:
    target = Path(path) if path is not None else DEFAULT_CONSTITUTION_PATH
    return json.loads(target.read_text(encoding="utf-8"))


def constitution_hash(path: Path | str | None = None) -> str:
    target = Path(path) if path is not None else DEFAULT_CONSTITUTION_PATH
    return hashlib.sha256(target.read_bytes()).hexdigest()


def verify_constitution_identity(path: Path | str | None = None) -> bool:
    expected = DEFAULT_HASH_PATH.read_text(encoding="utf-8").strip()
    return constitution_hash(path) == expected


def validate_policy_action(
    action: dict[str, Any], constitution: dict[str, Any] | None = None
) -> list[str]:
    c = constitution or load_constitution()
    policy = c["monetary_policy"]
    time = c["time"]
    genesis = c["genesis"]
    violations: list[str] = []

    current_rate = float(action.get("current_policy_rate", policy["genesis_policy_rate_pct"]))
    new_rate = float(action.get("new_policy_rate", current_rate))
    if new_rate < float(policy["policy_rate_floor_pct"]):
        violations.append("policy_rate_below_floor")
    if new_rate > float(policy["policy_rate_ceiling_pct"]):
        violations.append("policy_rate_above_ceiling")
    if abs(new_rate - current_rate) > float(policy["max_policy_rate_change_pct_points"]) + 1e-12:
        violations.append("policy_rate_change_above_maximum")

    issuance_rate = float(action.get("annualized_issuance_rate", 0.0))
    max_annual = float(policy["max_annual_issuance_pct"])
    if issuance_rate < 0:
        violations.append("negative_issuance_rate")
    if issuance_rate > max_annual + 1e-12:
        violations.append("issuance_rate_above_maximum")

    epoch = int(action.get("epoch", 0))
    last_epoch = int(action.get("last_policy_epoch", -10**9))
    interval = int(time["policy_meeting_interval_epochs"])
    if last_epoch >= 0 and epoch - last_epoch < interval:
        violations.append("policy_meeting_too_soon")

    issuance_amount = float(action.get("issuance_amount", 0.0))
    reference_supply = float(action.get("current_money_supply", genesis["initial_supply"]))
    epochs_per_year = int(time["epochs_per_monetary_year"])
    max_amount = reference_supply * (max_annual / 100.0) * (interval / epochs_per_year)
    if issuance_amount < -1e-12:
        violations.append("negative_issuance_amount")
    if issuance_amount > max_amount + 1e-9:
        violations.append("issuance_amount_above_meeting_maximum")

    return violations
