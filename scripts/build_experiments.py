"""Build the checked-in adaptive-agent study used by the static laboratory."""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cymonia.research import run_study, write_study


def main() -> None:
    write_study(run_study([11, 29, 47], 60), ROOT / "site" / "data" / "experiments.json")


if __name__ == "__main__":
    main()
