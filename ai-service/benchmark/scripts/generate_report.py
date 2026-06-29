"""
Step 7 + 10 — Automatic reports & dashboard.

Reads a results list (or results JSON) and writes:
  reports/accuracy.json
  reports/accuracy.csv
  reports/summary.md

Usage:
    python -m benchmark.scripts.generate_report --split validation
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from benchmark import config  # noqa: E402
from benchmark.scripts.common import get_logger  # noqa: E402

log = get_logger("report")


def compute_metrics(results: list) -> dict:
    n = len(results) or 1
    top1 = sum(1 for r in results if r["success"])
    top3 = sum(1 for r in results if r.get("top3Hit"))
    unknown = sum(1 for r in results if (r["confidence"] or 0) < config.UNKNOWN_THRESHOLD)
    # Hallucination: confident (>=threshold) but wrong
    hallucinations = sum(1 for r in results
                         if not r["success"] and (r["confidence"] or 0) >= config.UNKNOWN_THRESHOLD)
    # False negatives: was unknown/empty but a real food existed (all have GT here)
    false_neg = sum(1 for r in results if not r["aiPrediction"])
    conf_sum = sum(r["confidence"] or 0 for r in results)
    time_sum = sum(r["inferenceTime"] or 0 for r in results)

    pct = lambda x: round(x / n * 100, 2)
    return {
        "imagesTested": len(results),
        "top1Accuracy": pct(top1),
        "top3Accuracy": pct(top3),
        "falsePositiveRate": pct(hallucinations),
        "falseNegativeRate": pct(false_neg),
        "hallucinationRate": pct(hallucinations),
        "unknownRate": pct(unknown),
        "averageConfidence": round(conf_sum / n * 100, 1),
        "averageInferenceTime": round(time_sum / n, 3),
    }


def generate(results, split: str = "validation"):
    if isinstance(results, (str, Path)):
        results = json.loads(Path(results).read_text())

    metrics = compute_metrics(results)

    # accuracy.json
    (config.REPORTS_DIR / "accuracy.json").write_text(json.dumps(metrics, indent=2))

    # accuracy.csv
    csv_lines = ["metric,value"] + [f"{k},{v}" for k, v in metrics.items()]
    (config.REPORTS_DIR / "accuracy.csv").write_text("\n".join(csv_lines))

    # summary.md dashboard
    md = f"""# GetFit Food-101 Benchmark — `{split}`

| Metric | Value |
|--------|-------|
| Images Tested | {metrics['imagesTested']} |
| Top-1 Accuracy | {metrics['top1Accuracy']}% |
| Top-3 Accuracy | {metrics['top3Accuracy']}% |
| Hallucination Rate | {metrics['hallucinationRate']}% |
| False Negative Rate | {metrics['falseNegativeRate']}% |
| Unknown Rate | {metrics['unknownRate']}% |
| Average Confidence | {metrics['averageConfidence']}% |
| Average Time | {metrics['averageInferenceTime']}s |

_Generated automatically by the GetFit benchmark framework._
"""
    (config.REPORTS_DIR / "summary.md").write_text(md)

    log.info("Reports written → reports/{accuracy.json, accuracy.csv, summary.md}")
    log.info(f"Dashboard:\n{md}")
    return metrics


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="validation")
    args = ap.parse_args()
    rp = config.RESULTS_DIR / f"results_{args.split}.json"
    if not rp.exists():
        log.error(f"No results at {rp}. Run run_benchmark first.")
        return
    generate(json.loads(rp.read_text()), args.split)


if __name__ == "__main__":
    main()
