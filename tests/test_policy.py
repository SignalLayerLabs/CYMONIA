import unittest

from cymonia.constitution import load_constitution
from cymonia.genesis import create_genesis_state
from cymonia.policy import enact_policy, policy_votes, propose_policy


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.constitution = load_constitution()
        self.state = create_genesis_state(seed=10)
        self.state.epoch = 12

    def test_high_inflation_agent_votes_to_tighten(self):
        metrics = {
            "inflation_pct": 7.0,
            "nominal_gdp": 500.0,
            "active_agent_rate_pct": 55.0,
            "gini": 0.2,
            "velocity": 0.005,
        }
        votes = policy_votes(metrics, self.state, self.constitution)
        self.assertGreater(votes["inflation"]["rate_delta"], 0.0)
        self.assertEqual(votes["inflation"]["issuance_rate"], 0.0)

    def test_weak_deflationary_economy_votes_to_ease(self):
        metrics = {
            "inflation_pct": -3.0,
            "nominal_gdp": 10.0,
            "active_agent_rate_pct": 8.0,
            "gini": 0.25,
            "velocity": 0.0001,
        }
        votes = policy_votes(metrics, self.state, self.constitution)
        self.assertLess(votes["growth"]["rate_delta"], 0.0)
        self.assertGreater(votes["growth"]["issuance_rate"], 0.0)

    def test_governor_proposal_respects_rate_and_issuance_bounds(self):
        metrics = {
            "inflation_pct": -4.0,
            "nominal_gdp": 0.0,
            "active_agent_rate_pct": 0.0,
            "gini": 0.8,
            "velocity": 0.0,
        }
        decision = propose_policy(metrics, self.state, self.constitution)
        self.assertLessEqual(
            abs(decision.new_policy_rate - decision.previous_policy_rate),
            self.constitution["monetary_policy"]["max_policy_rate_change_pct_points"],
        )
        self.assertLessEqual(
            decision.annualized_issuance_rate,
            self.constitution["monetary_policy"]["max_annual_issuance_pct"],
        )
        self.assertEqual(decision.violations, [])

    def test_enactment_distributes_issuance_pro_rata_without_favoritism(self):
        metrics = {
            "inflation_pct": -3.0,
            "nominal_gdp": 10.0,
            "active_agent_rate_pct": 5.0,
            "gini": 0.0,
            "velocity": 0.0001,
        }
        decision = propose_policy(metrics, self.state, self.constitution)
        self.assertGreater(decision.issuance_amount, 0.0)
        before = [agent.balance for agent in self.state.agents]
        old_supply = self.state.money_supply
        enact_policy(self.state, decision, self.constitution)
        deltas = [round(agent.balance - prior, 6) for agent, prior in zip(self.state.agents, before)]
        self.assertEqual(len(set(deltas)), 1)
        self.assertAlmostEqual(self.state.money_supply, old_supply + decision.issuance_amount, places=5)
        self.assertTrue(decision.enacted)
        self.assertEqual(self.state.last_policy_epoch, self.state.epoch)

    def test_invalid_decision_is_not_enacted(self):
        metrics = {
            "inflation_pct": 2.0,
            "nominal_gdp": 500.0,
            "active_agent_rate_pct": 50.0,
            "gini": 0.2,
            "velocity": 0.005,
        }
        decision = propose_policy(metrics, self.state, self.constitution)
        decision.new_policy_rate = 99.0
        before = self.state.to_dict()
        with self.assertRaises(ValueError):
            enact_policy(self.state, decision, self.constitution)
        self.assertEqual(self.state.to_dict(), before)


if __name__ == "__main__":
    unittest.main()
