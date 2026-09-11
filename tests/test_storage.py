import tempfile
import unittest
from pathlib import Path

from cymonia.genesis import create_genesis_state
from cymonia.storage import (
    append_history,
    append_policy_decision,
    load_state,
    read_history,
    read_policy_decisions,
    save_state,
)
from cymonia.models import PolicyDecision


class StorageTests(unittest.TestCase):
    def test_state_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original = create_genesis_state(seed=44)
            save_state(original, root)
            loaded = load_state(root)
            self.assertEqual(loaded, original)

    def test_history_and_policy_append(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            append_history({"epoch": 1, "money_supply": 100000.0}, root)
            append_history({"epoch": 2, "money_supply": 100001.0}, root)
            self.assertEqual([r["epoch"] for r in read_history(root)], [1, 2])
            decision = PolicyDecision(
                decision_id="policy-1",
                epoch=1,
                previous_policy_rate=3.0,
                new_policy_rate=2.75,
                annualized_issuance_rate=1.0,
                issuance_amount=10.0,
                votes={},
                evidence={},
                rationale="test",
                enacted=True,
            )
            append_policy_decision(decision, root)
            rows = read_policy_decisions(root)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].decision_id, "policy-1")


if __name__ == "__main__":
    unittest.main()
