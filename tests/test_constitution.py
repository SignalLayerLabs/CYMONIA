import json
import tempfile
import unittest
from pathlib import Path

from cymonia.constitution import (
    constitution_hash,
    load_constitution,
    validate_policy_action,
    verify_constitution_identity,
)


class ConstitutionTests(unittest.TestCase):
    def test_genesis_constants_and_hash_are_valid(self):
        constitution = load_constitution()
        self.assertEqual(constitution["currency"]["code"], "CYMONIA")
        self.assertEqual(constitution["genesis"]["initial_supply"], 100000.0)
        self.assertEqual(constitution["genesis"]["agent_count"], 100)
        self.assertTrue(verify_constitution_identity())
        self.assertEqual(len(constitution_hash()), 64)

    def test_rejects_policy_action_outside_constitutional_bounds(self):
        constitution = load_constitution()
        violations = validate_policy_action(
            {
                "current_policy_rate": 3.0,
                "new_policy_rate": 20.0,
                "annualized_issuance_rate": 7.0,
                "issuance_amount": 999999.0,
                "epoch": 10,
                "last_policy_epoch": 9,
            },
            constitution,
        )
        self.assertIn("policy_rate_above_ceiling", violations)
        self.assertIn("issuance_rate_above_maximum", violations)
        self.assertIn("policy_meeting_too_soon", violations)

    def test_modified_constitution_fails_identity_check(self):
        source = Path("constitution/genesis.json")
        data = json.loads(source.read_text())
        data["monetary_policy"]["max_annual_issuance_pct"] = 99.0
        with tempfile.TemporaryDirectory() as tmp:
            modified = Path(tmp) / "genesis.json"
            modified.write_text(json.dumps(data, sort_keys=True, indent=2) + "\n")
            self.assertFalse(verify_constitution_identity(modified))


if __name__ == "__main__":
    unittest.main()
