import json
import tempfile
import unittest
from pathlib import Path

from cymonia.ledger import append_transaction, append_transactions, read_ledger, verify_ledger
from cymonia.models import Transaction


class LedgerTests(unittest.TestCase):
    def tx(self, tx_id: str, amount: float = 5.0) -> Transaction:
        return Transaction(
            tx_id=tx_id,
            epoch=1,
            buyer="agent-0001",
            seller="agent-0002",
            service="compute",
            quantity=1.0,
            unit_price=amount,
            amount=amount,
        )

    def test_first_append_builds_genesis_hash_chain(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ledger.jsonl"
            stored = append_transaction(path, self.tx("tx-1"))
            self.assertEqual(stored.prev_hash, "GENESIS")
            self.assertEqual(len(stored.tx_hash), 64)
            ok, reason = verify_ledger(path)
            self.assertTrue(ok, reason)

    def test_second_append_links_to_previous_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ledger.jsonl"
            first = append_transaction(path, self.tx("tx-1"))
            second = append_transaction(path, self.tx("tx-2"))
            self.assertEqual(second.prev_hash, first.tx_hash)
            self.assertEqual(len(read_ledger(path)), 2)
            self.assertTrue(verify_ledger(path)[0])


    def test_batch_append_reads_existing_ledger_once(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ledger.jsonl"
            txs = [self.tx(f"tx-{i}") for i in range(100)]
            with patch("cymonia.ledger.read_ledger", wraps=read_ledger) as reader:
                stored = append_transactions(path, txs)
            self.assertEqual(len(stored), 100)
            self.assertEqual(reader.call_count, 1)
            self.assertTrue(verify_ledger(path)[0])

    def test_tampering_is_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ledger.jsonl"
            append_transaction(path, self.tx("tx-1"))
            append_transaction(path, self.tx("tx-2"))
            lines = path.read_text().splitlines()
            row = json.loads(lines[0])
            row["amount"] = 5000.0
            lines[0] = json.dumps(row, sort_keys=True)
            path.write_text("\n".join(lines) + "\n")
            ok, reason = verify_ledger(path)
            self.assertFalse(ok)
            self.assertIn("hash_mismatch", reason)


if __name__ == "__main__":
    unittest.main()
