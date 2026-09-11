import unittest

from cymonia.genesis import create_genesis_state
from cymonia.market import clear_market, generate_epoch_intents
from cymonia.models import Demand, Offer


class MarketTests(unittest.TestCase):
    def test_settlement_moves_cym_without_changing_supply(self):
        state = create_genesis_state(seed=1)
        buyer = state.agents[0]
        seller = state.agents[1]
        buyer.specialty = "data"
        seller.specialty = "compute"
        starting_total = sum(a.balance for a in state.agents)
        starting_buyer = buyer.balance
        starting_seller = seller.balance
        offers = [Offer(seller=seller.agent_id, service="compute", quantity=2.0, unit_price=10.0)]
        demands = [Demand(buyer=buyer.agent_id, service="compute", quantity=1.5, max_unit_price=12.0)]
        txs = clear_market(state, offers, demands)
        self.assertEqual(len(txs), 1)
        self.assertAlmostEqual(txs[0].amount, 15.0)
        self.assertAlmostEqual(buyer.balance, starting_buyer - 15.0)
        self.assertAlmostEqual(seller.balance, starting_seller + 15.0)
        self.assertAlmostEqual(sum(a.balance for a in state.agents), starting_total)
        self.assertGreaterEqual(min(a.balance for a in state.agents), 0.0)

    def test_unfunded_or_overpriced_trade_does_not_settle(self):
        state = create_genesis_state(seed=2)
        buyer = state.agents[0]
        seller = state.agents[1]
        buyer.balance = 1.0
        offers = [Offer(seller=seller.agent_id, service="compute", quantity=1.0, unit_price=10.0)]
        demands = [Demand(buyer=buyer.agent_id, service="compute", quantity=1.0, max_unit_price=5.0)]
        self.assertEqual(clear_market(state, offers, demands), [])
        self.assertGreaterEqual(buyer.balance, 0.0)

    def test_epoch_intents_are_deterministic(self):
        state_a = create_genesis_state(seed=77)
        state_b = create_genesis_state(seed=77)
        state_a.epoch = 9
        state_b.epoch = 9
        offers_a, demands_a = generate_epoch_intents(state_a)
        offers_b, demands_b = generate_epoch_intents(state_b)
        self.assertEqual([o.to_dict() for o in offers_a], [o.to_dict() for o in offers_b])
        self.assertEqual([d.to_dict() for d in demands_a], [d.to_dict() for d in demands_b])


if __name__ == "__main__":
    unittest.main()
