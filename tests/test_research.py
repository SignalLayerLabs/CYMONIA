from __future__ import annotations

import hashlib
import io
import json
import random
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from cymonia.research import _choose_action, run_study, write_study
from cymonia.cli import main


ROOT = Path(__file__).resolve().parents[1]
CANONICAL_FILES = (
    ROOT / "constitution" / "genesis.json",
    ROOT / "constitution" / "GENESIS_SHA256",
    ROOT / "state" / "state.json",
    ROOT / "state" / "history.json",
    ROOT / "state" / "ledger.jsonl",
    ROOT / "state" / "policy-decisions.jsonl",
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ResearchStudyTests(unittest.TestCase):
    def test_exploitation_selects_the_highest_learned_value(self):
        values = {0.2: -0.5, 0.4: 0.1, 0.6: 0.75, 0.8: 0.2}
        action, explored = _choose_action(random.Random(0), values)
        self.assertFalse(explored)
        self.assertEqual(action, 0.6)

    def test_repeated_seeded_studies_are_identical(self):
        first = run_study([11, 29], 8)
        second = run_study([11, 29], 8)
        self.assertEqual(first, second)

    def test_arms_have_matched_genesis_and_canonical_metric_history(self):
        study = run_study([11], 3)
        baseline, adaptive = study["runs"]
        self.assertEqual(baseline["initial_state_hash"], adaptive["initial_state_hash"])
        self.assertEqual(len(baseline["history"]), 3)
        expected = {
            "epoch", "nominal_gdp", "money_supply", "inflation_pct", "gini",
            "velocity", "transaction_count", "active_agent_rate_pct", "policy_rate_pct",
        }
        self.assertTrue(expected.issubset(baseline["history"][0]))

    def test_adaptive_agents_learn_only_from_completed_steps(self):
        study = run_study([47], 20)
        adaptive = next(run for run in study["runs"] if run["arm"] == "adaptive")
        first = next(item for item in adaptive["decisions"] if item["agent_id"] == "agent-0001")
        self.assertEqual(first["epoch"], 1)
        self.assertEqual(set(first["q_before"].values()), {0.0})
        self.assertNotEqual(first["q_after"], first["q_before"])
        traced = [item for item in adaptive["decisions"] if item["agent_id"] == "agent-0001"]
        for earlier, later in zip(traced, traced[1:]):
            self.assertEqual(later["q_before"], earlier["q_after"])
        rewards_by_action = {key: [] for key in first["q_before"]}
        for decision in traced:
            action_key = f'{decision["action"]:.1f}'
            if not decision["explore"]:
                best_value = max(decision["q_before"].values())
                self.assertEqual(decision["q_before"][action_key], best_value)
            rewards_by_action[action_key].append(decision["reward"])
            expected_average = round(
                sum(rewards_by_action[action_key]) / len(rewards_by_action[action_key]), 9
            )
            self.assertAlmostEqual(decision["q_after"][action_key], expected_average, places=8)
            for other_key in decision["q_before"]:
                if other_key != action_key:
                    self.assertEqual(decision["q_after"][other_key], decision["q_before"][other_key])
        self.assertTrue(any(
            any(value != 0.0 for value in values.values())
            for values in adaptive["final_values"].values()
        ))

    def test_every_agent_learns_and_decision_trace_is_bounded(self):
        epochs = 5
        study = run_study([11], epochs)
        adaptive = next(run for run in study["runs"] if run["arm"] == "adaptive")
        self.assertEqual(len(adaptive["final_values"]), 100)
        self.assertTrue(all(
            sum(counts.values()) == epochs
            for counts in adaptive["final_action_counts"].values()
        ))
        self.assertEqual(len(adaptive["decisions"]), 3 * epochs)
        self.assertEqual({d["agent_id"] for d in adaptive["decisions"]}, {
            "agent-0001", "agent-0002", "agent-0003",
        })

    def test_run_is_in_memory_and_preserves_accounting(self):
        before = {str(path): digest(path) for path in CANONICAL_FILES}
        study = run_study([11], 12)
        after = {str(path): digest(path) for path in CANONICAL_FILES}
        self.assertEqual(before, after)
        for run in study["runs"]:
            self.assertLessEqual(run["max_accounting_error"], 0.001)

    def test_invalid_arguments_are_rejected(self):
        for seeds, epochs in (([], 2), ([1, 1], 2), ([True], 2), ([1], 0)):
            with self.subTest(seeds=seeds, epochs=epochs):
                with self.assertRaises(ValueError):
                    run_study(seeds, epochs)

    def test_writer_creates_parseable_compact_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "nested" / "study.json"
            write_study(run_study([11], 2), target)
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["config"]["epochs"], 2)
            self.assertTrue(target.read_text(encoding="utf-8").endswith("\n"))

    def test_research_cli_writes_requested_study(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "experiments.json"
            output = io.StringIO()
            with redirect_stdout(output):
                status = main(["research", "--epochs", "2", "--seeds", "11", "29", "--output", str(target)])
            self.assertEqual(status, 0)
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["config"]["seeds"], [11, 29])
            self.assertEqual(json.loads(output.getvalue())["output"], str(target))


if __name__ == "__main__":
    unittest.main()
