import unittest

from cymonia.genesis import SERVICES, create_genesis_state


class GenesisTests(unittest.TestCase):
    def test_genesis_has_100_agents_and_100k_supply(self):
        state = create_genesis_state()
        self.assertEqual(len(state.agents), 100)
        self.assertAlmostEqual(state.money_supply, 100000.0)
        self.assertAlmostEqual(sum(a.balance for a in state.agents), 100000.0)
        self.assertTrue(all(a.balance == 1000.0 for a in state.agents))

    def test_genesis_is_deterministic(self):
        a = create_genesis_state(seed=12345)
        b = create_genesis_state(seed=12345)
        self.assertEqual(a.to_dict(), b.to_dict())

    def test_all_service_specialties_are_represented(self):
        state = create_genesis_state()
        represented = {a.specialty for a in state.agents}
        self.assertEqual(represented, set(SERVICES))


if __name__ == "__main__":
    unittest.main()
