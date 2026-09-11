from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any
import json


@dataclass(eq=True)
class Agent:
    agent_id: str
    specialty: str
    balance: float
    productivity: float
    spend_propensity: float
    price_sensitivity: float
    reservation_prices: dict[str, float] = field(default_factory=dict)
    active: bool = True
    completed_sales: int = 0
    completed_purchases: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Agent":
        return cls(**data)


@dataclass(eq=True)
class Offer:
    seller: str
    service: str
    quantity: float
    unit_price: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(eq=True)
class Demand:
    buyer: str
    service: str
    quantity: float
    max_unit_price: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(eq=True)
class Transaction:
    tx_id: str
    epoch: int
    buyer: str
    seller: str
    service: str
    quantity: float
    unit_price: float
    amount: float
    kind: str = "trade"
    prev_hash: str = "GENESIS"
    tx_hash: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Transaction":
        return cls(**data)

    def hash_payload(self) -> str:
        payload = {
            "amount": self.amount,
            "buyer": self.buyer,
            "epoch": self.epoch,
            "kind": self.kind,
            "metadata": self.metadata,
            "quantity": self.quantity,
            "seller": self.seller,
            "service": self.service,
            "tx_id": self.tx_id,
            "unit_price": self.unit_price,
        }
        return json.dumps(payload, sort_keys=True, separators=(",", ":"))


@dataclass(eq=True)
class PolicyDecision:
    decision_id: str
    epoch: int
    previous_policy_rate: float
    new_policy_rate: float
    annualized_issuance_rate: float
    issuance_amount: float
    votes: dict[str, dict[str, Any]]
    evidence: dict[str, float]
    rationale: str
    violations: list[str] = field(default_factory=list)
    enacted: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PolicyDecision":
        return cls(**data)


@dataclass(eq=True)
class EconomyState:
    epoch: int
    seed: int
    policy_rate: float
    money_supply: float
    agents: list[Agent]
    previous_state_hash: str
    last_policy_epoch: int = -1
    cumulative_issuance: float = 0.0
    state_hash: str = ""

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "EconomyState":
        copied = dict(data)
        copied["agents"] = [
            agent if isinstance(agent, Agent) else Agent.from_dict(agent)
            for agent in copied.get("agents", [])
        ]
        return cls(**copied)
