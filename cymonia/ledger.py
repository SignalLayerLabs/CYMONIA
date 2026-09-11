from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .models import Transaction


def _hash_transaction(prev_hash: str, tx: Transaction) -> str:
    material = (prev_hash + "|" + tx.hash_payload()).encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def read_ledger(path: Path | str) -> list[Transaction]:
    target = Path(path)
    if not target.exists():
        return []
    rows: list[Transaction] = []
    for line in target.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(Transaction.from_dict(json.loads(line)))
    return rows


def append_transactions(path: Path | str, transactions: list[Transaction]) -> list[Transaction]:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    existing = read_ledger(target)
    prev_hash = existing[-1].tx_hash if existing else "GENESIS"
    stored_rows: list[Transaction] = []
    lines: list[str] = []
    for tx in transactions:
        stored = Transaction.from_dict(tx.to_dict())
        stored.prev_hash = prev_hash
        stored.tx_hash = _hash_transaction(prev_hash, stored)
        stored_rows.append(stored)
        lines.append(json.dumps(stored.to_dict(), sort_keys=True, separators=(",", ":")))
        prev_hash = stored.tx_hash
    if lines:
        with target.open("a", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
    return stored_rows


def append_transaction(path: Path | str, tx: Transaction) -> Transaction:
    return append_transactions(path, [tx])[0]


def verify_ledger(path: Path | str) -> tuple[bool, str]:
    expected_prev = "GENESIS"
    for index, tx in enumerate(read_ledger(path)):
        if tx.prev_hash != expected_prev:
            return False, f"prev_hash_mismatch_at_{index}"
        expected_hash = _hash_transaction(expected_prev, tx)
        if tx.tx_hash != expected_hash:
            return False, f"hash_mismatch_at_{index}"
        expected_prev = tx.tx_hash
    return True, "ok"
