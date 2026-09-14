import json
import tempfile
import unittest
from pathlib import Path

from cymonia.simulation import initialize_economy, run_epochs
from scripts.build_site import build_dashboard_data


class ObservatoryTests(unittest.TestCase):
    def build(self, epochs):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        initialize_economy(root / 'state', seed=19)
        run_epochs(root / 'state', epochs)
        build_dashboard_data(root / 'state', root / 'site')
        return root, json.loads((root / 'site/data/state.json').read_text())

    def test_exports_all_agents_and_latest_market_totals(self):
        root, data = self.build(12)
        self.assertEqual(len(data.get('agents', [])), 100)
        self.assertEqual(len(data['markets']), 10)
        self.assertAlmostEqual(sum(m['volume'] for m in data['markets']), data['latest_metrics']['nominal_gdp'], places=4)
        self.assertEqual(sum(m['trades'] for m in data['markets']), data['latest_metrics']['transaction_count'])
        self.assertEqual(data['next_policy_epoch'], 24)
        self.assertTrue(data['integrity']['ok'])
        txs = json.loads((root / 'site/data/transactions.json').read_text())
        self.assertLessEqual(len(txs), 60)
        self.assertTrue(all(m['service'] != 'monetary_base' for m in data['markets']))

    def test_genesis_has_empty_markets_and_no_claim_of_activity(self):
        _, data = self.build(0)
        self.assertEqual(len(data.get('markets', [])), 10)
        self.assertTrue(all(m['trades'] == 0 and m['volume'] == 0 for m in data['markets']))
        self.assertEqual(data['next_policy_epoch'], 12)

    def test_snapshot_reports_state_integrity_failure(self):
        root, _ = self.build(1)
        path = root / 'state/state.json'
        value = json.loads(path.read_text())
        value['state_hash'] = 'tampered'
        path.write_text(json.dumps(value))
        build_dashboard_data(root / 'state', root / 'site')
        data = json.loads((root / 'site/data/state.json').read_text())
        self.assertFalse(data.get('integrity', {}).get('ok', True))
        self.assertIn('state_hash_mismatch', data['integrity']['problems'])
