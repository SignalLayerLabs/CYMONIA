import json
import tempfile
import unittest
from pathlib import Path

from cymonia.simulation import initialize_economy, run_epochs
from scripts.build_site import build_dashboard_data


class SiteBuildTests(unittest.TestCase):
    def test_build_dashboard_data_contains_live_economy_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_root = root / "state"
            site_root = root / "site"
            initialize_economy(state_root, seed=909)
            run_epochs(state_root, 13)
            build_dashboard_data(state_root=state_root, site_root=site_root)

            state = json.loads((site_root / "data" / "state.json").read_text())
            history = json.loads((site_root / "data" / "history.json").read_text())
            policy = json.loads((site_root / "data" / "policy.json").read_text())
            txs = json.loads((site_root / "data" / "transactions.json").read_text())

            self.assertEqual(state["epoch"], 13)
            self.assertEqual(state["currency"], "CYMONIA")
            self.assertIn("money_supply", state)
            self.assertIn("policy_rate_pct", state)
            self.assertIn("constitution_hash", state)
            self.assertTrue(state["constitution_valid"])
            self.assertEqual(len(history), 13)
            self.assertEqual(policy["latest"]["epoch"], 12)
            self.assertLessEqual(len(txs), 60)
            self.assertIn("top_agents", state)
            self.assertEqual(len(state["top_agents"]), 10)


    def test_build_script_runs_directly_from_repo_root(self):
        import subprocess
        import sys
        result = subprocess.run(
            [sys.executable, "scripts/build_site.py"],
            cwd=Path.cwd(),
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("dashboard data built", result.stdout.lower())

    def test_static_dashboard_shell_has_required_sections(self):
        index = Path("site/index.html").read_text(encoding="utf-8")
        app = Path("site/app.js").read_text(encoding="utf-8")
        styles = Path("site/styles.css").read_text(encoding="utf-8")
        for marker in ("Money Supply", "Policy Rate", "Central Bank", "Constitution", "Recent Transactions", "Top Agents"):
            self.assertIn(marker, index)
        self.assertIn("data/state.json", app)
        self.assertIn("data/history.json", app)
        self.assertIn("data/policy.json", app)
        self.assertIn("data/transactions.json", app)
        self.assertIn("@media", styles)


if __name__ == "__main__":
    unittest.main()
