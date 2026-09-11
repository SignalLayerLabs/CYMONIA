import unittest

from cymonia.models import Agent, EconomyState, Transaction


class ModelTests(unittest.TestCase):
    def test_agent_round_trip(self):
        agent = Agent(
            agent_id="agent-0001",
            specialty="compute",
            balance=1000.0,
            productivity=1.1,
            spend_propensity=0.4,
            price_sensitivity=0.8,
            reservation_prices={"compute": 10.0},
            active=True,
        )
        self.assertEqual(Agent.from_dict(agent.to_dict()), agent)

    def test_state_round_trip(self):
        state = EconomyState(
            epoch=0,
            seed=20260911,
            policy_rate=3.0,
            money_supply=100000.0,
            agents=[],
            previous_state_hash="GENESIS",
        )
        self.assertEqual(EconomyState.from_dict(state.to_dict()), state)

    def test_transaction_hash_payload_is_stable(self):
        tx = Transaction(
            tx_id="tx-1",
            epoch=1,
            buyer="agent-1",
            seller="agent-2",
            service="compute",
            quantity=1.0,
            unit_price=4.0,
            amount=4.0,
            kind="trade",
        )
        self.assertEqual(tx.hash_payload(), tx.hash_payload())
        self.assertNotIn("hash", tx.hash_payload())


if __name__ == "__main__":
    unittest.main()
