import unittest

from cymonia.genesis import BASE_PRICES, create_genesis_state
from cymonia.metrics import compute_metrics, gini_coefficient
from cymonia.models import Transaction


class MetricsTests(unittest.TestCase):
    def test_gini_is_zero_for_equal_balances(self):
        self.assertAlmostEqual(gini_coefficient([10, 10, 10, 10]), 0.0)

    def test_gini_increases_with_concentration(self):
        self.assertGreater(gini_coefficient([0, 0, 0, 40]), 0.5)

    def test_compute_macro_metrics(self):
        state = create_genesis_state(seed=3)
        txs = [
            Transaction(
                tx_id="a",
                epoch=1,
                buyer="agent-0001",
                seller="agent-0002",
                service="compute",
                quantity=2.0,
                unit_price=BASE_PRICES["compute"],
                amount=2.0 * BASE_PRICES["compute"],
            ),
            Transaction(
                tx_id="b",
                epoch=1,
                buyer="agent-0003",
                seller="agent-0004",
                service="data",
                quantity=1.0,
                unit_price=BASE_PRICES["data"] * 1.1,
                amount=BASE_PRICES["data"] * 1.1,
            ),
        ]
        metrics = compute_metrics(state, txs)
        self.assertAlmostEqual(metrics["money_supply"], 100000.0)
        self.assertAlmostEqual(metrics["nominal_gdp"], 16.0 + 12.1)
        self.assertGreater(metrics["price_index"], 100.0)
        self.assertEqual(metrics["transaction_count"], 2)
        self.assertAlmostEqual(metrics["velocity"], metrics["nominal_gdp"] / 100000.0)
        self.assertAlmostEqual(metrics["active_agent_rate_pct"], 4.0)
        self.assertAlmostEqual(metrics["gini"], 0.0)

    def test_inflation_uses_previous_price_index(self):
        state = create_genesis_state(seed=4)
        txs = [
            Transaction(
                tx_id="x",
                epoch=1,
                buyer="agent-0001",
                seller="agent-0002",
                service="compute",
                quantity=1.0,
                unit_price=8.8,
                amount=8.8,
            )
        ]
        metrics = compute_metrics(state, txs, previous_metrics={"price_index": 100.0})
        self.assertAlmostEqual(metrics["inflation_pct"], 10.0, places=6)


if __name__ == "__main__":
    unittest.main()
