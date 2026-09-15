import sqlite3
import unittest
from pathlib import Path


class ParticipatorySchemaTests(unittest.TestCase):
    def setUp(self):
        self.path = Path("migrations/0001_participatory_economy.sql")

    def load_db(self):
        con = sqlite3.connect(":memory:")
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.path.read_text(encoding="utf-8"))
        return con

    def test_migration_defines_required_tables_and_system_accounts(self):
        con = self.load_db()
        tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {
            "actors", "wallets", "oauth_states", "sessions", "journal",
            "contracts", "contract_fundings", "proofs", "settlements",
            "companies", "stakes", "system_state",
        }
        self.assertTrue(required.issubset(tables), required - tables)
        treasury = con.execute("SELECT actor_type FROM actors WHERE id='CYMONIA_CONTRIBUTION_TREASURY'").fetchone()
        self.assertEqual(treasury, ("system",))
        wallet = con.execute("SELECT bootstrap_cym, earned_cym FROM wallets WHERE actor_id='CYMONIA_CONTRIBUTION_TREASURY'").fetchone()
        self.assertEqual(wallet, (0.0, 0.0))
        initialized = con.execute("SELECT value FROM system_state WHERE key='participation_genesis_initialized'").fetchone()
        self.assertEqual(initialized, ("0",))
        columns = {row[1] for row in con.execute("PRAGMA table_info(companies)")}
        self.assertIn("treasury_cym", columns)

    def test_wallets_reject_negative_balances(self):
        con = self.load_db()
        con.execute("INSERT INTO actors(id, actor_type) VALUES('human:test', 'human')")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO wallets(actor_id, earned_cym) VALUES('human:test', -1)")

    def test_contract_status_and_actor_type_are_constrained(self):
        con = self.load_db()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO actors(id, actor_type) VALUES('bad', 'wizard')")
        con.execute("INSERT INTO actors(id, actor_type) VALUES('human:test', 'human')")
        con.execute("INSERT INTO wallets(actor_id) VALUES('human:test')")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute(
                """INSERT INTO contracts(
                    id, creator_actor_id, title, description, category, economic_purpose,
                    metric_key, baseline_value, target_direction, min_improvement_pct,
                    reward_cym, status
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                ("c1", "human:test", "A useful title", "A sufficiently descriptive contract body for testing.",
                 "economy", "Improve the CYMONIA economy measurably.", "gdp", 10, "increase", 5, 10, "nonsense"),
            )

    def test_one_funding_and_one_settlement_per_contract(self):
        con = self.load_db()
        con.execute("INSERT INTO actors(id, actor_type) VALUES('human:test', 'human')")
        con.execute("INSERT INTO wallets(actor_id) VALUES('human:test')")
        con.execute(
            """INSERT INTO contracts(
                id, creator_actor_id, title, description, category, economic_purpose,
                metric_key, baseline_value, target_direction, min_improvement_pct,
                reward_cym, purpose_score, status
            ) VALUES('c1','human:test','Useful title','Long enough description for this economic contract.',
                'economy','Improve a measurable CYMONIA market outcome.','gdp',10,'increase',5,10,100,'proposed')"""
        )
        con.execute("INSERT INTO contract_fundings(contract_id, amount_cym) VALUES('c1', 10)")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO contract_fundings(contract_id, amount_cym) VALUES('c1', 10)")
        con.execute("INSERT INTO settlements(contract_id, proof_id, recipient_actor_id, amount_cym) VALUES('c1','p1','human:test',10)")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO settlements(contract_id, proof_id, recipient_actor_id, amount_cym) VALUES('c1','p2','human:test',10)")


if __name__ == "__main__":
    unittest.main()
