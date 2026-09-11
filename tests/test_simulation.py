import tempfile
import unittest
from pathlib import Path

from cymonia.genesis import create_genesis_state
from cymonia.simulation import initialize_economy, run_epochs, step_epoch, verify_economy
from cymonia.storage import load_state, read_history


class SimulationTests(unittest.TestCase):
    def test_one_epoch_is_deterministic(self):
        left = create_genesis_state(seed=101)
        right = create_genesis_state(seed=101)
        a_state, a_txs, a_policy, a_metrics = step_epoch(left)
        b_state, b_txs, b_policy, b_metrics = step_epoch(right)
        self.assertEqual(a_state.to_dict(), b_state.to_dict())
        self.assertEqual([tx.to_dict() for tx in a_txs], [tx.to_dict() for tx in b_txs])
        self.assertEqual(a_metrics, b_metrics)
        self.assertEqual(a_policy, b_policy)

    def test_100_epochs_preserve_invariants(self):
        state = create_genesis_state(seed=2026)
        previous = None
        policy_count = 0
        for _ in range(100):
            state, _txs, policy, metrics = step_epoch(state, previous)
            previous = metrics
            if policy is not None:
                policy_count += 1
            self.assertGreaterEqual(min(agent.balance for agent in state.agents), 0.0)
            self.assertAlmostEqual(sum(a.balance for a in state.agents), state.money_supply, places=3)
        self.assertEqual(state.epoch, 100)
        self.assertGreater(policy_count, 0)


    def test_persisted_epoch_appends_ledger_as_one_batch(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initialize_economy(root=root, seed=808)
            with patch("cymonia.simulation.append_transactions", wraps=__import__("cymonia.ledger", fromlist=["append_transactions"]).append_transactions) as batch:
                from cymonia.simulation import advance_persisted_epoch
                advance_persisted_epoch(root)
            self.assertEqual(batch.call_count, 1)

    def test_initialize_run_and_verify_persisted_economy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initialize_economy(root=root, seed=505)
            run_epochs(root=root, count=25)
            state = load_state(root)
            self.assertEqual(state.epoch, 25)
            self.assertEqual(len(read_history(root)), 25)
            ok, problems = verify_economy(root)
            self.assertTrue(ok, problems)


if __name__ == "__main__":
    unittest.main()
