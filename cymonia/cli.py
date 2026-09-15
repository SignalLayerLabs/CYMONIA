from __future__ import annotations

import argparse
import json
from pathlib import Path

from .research import run_study, write_study
from .simulation import advance_persisted_epoch, initialize_economy, run_epochs, verify_economy
from .storage import load_state


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cymonia", description="CYMONIA autonomous economy simulator")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init = subparsers.add_parser("init", help="create deterministic Genesis state")
    init.add_argument("--root", default="state")
    init.add_argument("--seed", type=int, default=None)
    init.add_argument("--force", action="store_true")

    step = subparsers.add_parser("step", help="advance one economic epoch")
    step.add_argument("--root", default="state")

    run = subparsers.add_parser("run", help="advance multiple economic epochs")
    run.add_argument("--root", default="state")
    run.add_argument("--epochs", type=int, default=1)

    verify = subparsers.add_parser("verify", help="verify constitution, state and ledger integrity")
    verify.add_argument("--root", default="state")

    research = subparsers.add_parser("research", help="run a reproducible adaptive-agent study")
    research.add_argument("--epochs", type=int, default=60)
    research.add_argument("--seeds", type=int, nargs="+", default=[11, 29, 47])
    research.add_argument("--output", default="site/data/experiments.json")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "init":
        root = Path(args.root)
        state = initialize_economy(root=root, seed=args.seed, force=args.force)
        print(json.dumps({"status": "initialized", "epoch": state.epoch, "state_hash": state.state_hash}))
        return 0
    if args.command == "step":
        root = Path(args.root)
        state, metrics = advance_persisted_epoch(root)
        print(json.dumps({"status": "advanced", "epoch": state.epoch, "metrics": metrics}, sort_keys=True))
        return 0
    if args.command == "run":
        root = Path(args.root)
        state = run_epochs(root=root, count=args.epochs)
        print(json.dumps({"status": "advanced", "epoch": state.epoch, "state_hash": state.state_hash}, sort_keys=True))
        return 0
    if args.command == "verify":
        root = Path(args.root)
        ok, problems = verify_economy(root)
        state = load_state(root) if (root / "state.json").exists() else None
        print(json.dumps({"ok": ok, "problems": problems, "epoch": state.epoch if state else None}, sort_keys=True))
        return 0 if ok else 1
    if args.command == "research":
        study = run_study(args.seeds, args.epochs)
        write_study(study, args.output)
        print(json.dumps({
            "status": "written",
            "output": str(args.output),
            "seeds": args.seeds,
            "epochs": args.epochs,
        }, sort_keys=True))
        return 0
    return 2
