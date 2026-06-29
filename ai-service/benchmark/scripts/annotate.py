"""
Step 8 + 9 — Manual annotation tool → GetFit Benchmark builder.

CLI annotator that walks benchmark results, shows ground truth + AI prediction,
and lets a human approve or correct. Corrections are written to
benchmark/getfit_benchmark.json. Food-101 itself is NEVER modified.

Usage:
    python -m benchmark.scripts.annotate --split validation [--start 0]
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from benchmark import config  # noqa: E402
from benchmark.scripts.common import get_logger  # noqa: E402

log = get_logger("annotate")

GETFIT_BENCHMARK = config.BENCHMARK_ROOT / "getfit_benchmark.json"


def _load_benchmark() -> dict:
    if GETFIT_BENCHMARK.exists():
        try:
            return {e["imageHash"]: e for e in json.loads(GETFIT_BENCHMARK.read_text())}
        except Exception:
            return {}
    return {}


def _save_benchmark(entries: dict):
    GETFIT_BENCHMARK.write_text(json.dumps(list(entries.values()), indent=2))
    log.info(f"Saved {len(entries)} entries → {GETFIT_BENCHMARK}")


def _try_open_image(path: str):
    """Best-effort preview — opens in the OS default viewer if possible."""
    try:
        from PIL import Image
        Image.open(path).show()
    except Exception:
        log.info(f"(Preview unavailable) Image path: {path}")


def _ask(prompt: str, default: str = "") -> str:
    val = input(f"{prompt}" + (f" [{default}]" if default else "") + ": ").strip()
    return val or default


def annotate(split: str = "validation", start: int = 0):
    results_path = config.RESULTS_DIR / f"results_{split}.json"
    if not results_path.exists():
        log.error(f"No results at {results_path}. Run run_benchmark first.")
        return
    results = json.loads(results_path.read_text())
    entries = _load_benchmark()

    log.info("Commands: [a]pprove  [c]orrect  [s]kip  [q]uit & save")
    for i in range(start, len(results)):
        r = results[i]
        print("\n" + "═" * 60)
        print(f"#{i}  {r['imageId']}")
        print(f"  Image:        {r['imagePath']}")
        print(f"  Ground Truth: {r['groundTruth']}")
        print(f"  AI Predicted: {r['aiPrediction']}  ({round((r['confidence'] or 0)*100)}%)")
        print(f"  Alternatives: {', '.join(r['alternatives']) or '—'}")
        print(f"  Cooking:      {r['cookingStyle'] or '—'}   State: {r['foodState'] or '—'}")
        _try_open_image(r["imagePath"])

        cmd = _ask("Action (a/c/s/q)", "a").lower()
        if cmd == "q":
            break
        if cmd == "s":
            continue

        if cmd == "a":
            food = r["aiPrediction"] or r["groundTruth"]
            cooking = r["cookingStyle"]
            category = ""
            portion = ""
            grams = 0
        else:  # correct
            food = _ask("Correct food", r["aiPrediction"] or r["groundTruth"])
            cooking = _ask("Cooking style", r["cookingStyle"])
            category = _ask("Category", "")
            portion = _ask("Portion (e.g. 1 piece)", "")
            grams = _ask("Grams", "0")

        # Optional nutrition (left blank → 0; filled during curation)
        entries[r["imageHash"]] = {
            "imageHash": r["imageHash"],
            "imagePath": r["imagePath"],
            "foodName": food,
            "cookingStyle": cooking,
            "category": category,
            "portion": portion,
            "grams": _to_num(grams),
            "calories": 0, "protein": 0, "carbs": 0, "fat": 0,
            "notes": "approved" if cmd == "a" else "corrected",
        }
        _save_benchmark(entries)

    _save_benchmark(entries)
    log.info("Annotation session complete.")


def _to_num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="validation")
    ap.add_argument("--start", type=int, default=0)
    args = ap.parse_args()
    annotate(args.split, args.start)


if __name__ == "__main__":
    main()
