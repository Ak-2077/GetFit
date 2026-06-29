"""
Step 5 + 6 — Benchmark runner.

For each materialized image: send to the recognition endpoint, normalize the
response, compare to ground truth, store a result record. NEVER imports or
mutates production logic — pure HTTP client.

Usage:
    python -m benchmark.scripts.run_benchmark --split validation --limit 500
"""

import argparse
import base64
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from benchmark import config  # noqa: E402
from benchmark.scripts.common import get_logger, ensure_packages, label_matches  # noqa: E402

log = get_logger("run_benchmark")


def _b64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def _normalize_response(data: dict) -> dict:
    """
    Normalize EITHER response shape into a common record:
      • AI vision route → { success, raw_description, objects, ... }
      • Node backend route → { success, foods:[...], confidence_tier, alternatives, reasoning }
    """
    out = {
        "aiPrediction": "",
        "alternatives": [],
        "confidence": 0.0,
        "reasoning": "",
        "cookingStyle": "",
        "foodState": "",
        "success": bool(data.get("success")),
    }
    if not data:
        return out

    foods = data.get("foods")
    if isinstance(foods, list) and foods:
        primary = foods[0]
        out["aiPrediction"] = primary.get("name") or primary.get("normalized_name") or ""
        out["confidence"] = float(primary.get("confidence") or 0.0)
        out["cookingStyle"] = primary.get("cooking_style") or primary.get("state") or ""
        out["alternatives"] = [a.get("name", "") for a in (data.get("alternatives") or [])][:config.TOP3_LIMIT]
        reasoning = data.get("reasoning") or {}
        out["foodState"] = reasoning.get("food_state", "")
        out["reasoning"] = json.dumps(reasoning)[:500]
        return out

    # AI vision-only route: derive a coarse prediction from description/objects
    desc = data.get("raw_description") or ""
    objs = data.get("objects") or []
    out["aiPrediction"] = (data.get("detected_foods") or [None])[0] or (objs[0]["name"] if objs else "") or desc[:40]
    out["confidence"] = float(data.get("confidence") or 0.0)
    out["cookingStyle"] = data.get("cooking_style", "")
    out["reasoning"] = desc[:500]
    return out


def recognize(image_path: str) -> dict:
    """POST the image to the configured recognition endpoint."""
    import requests  # lightweight; part of standard envs / installed with datasets deps

    payload = {
        "image_base64": _b64(image_path),
        "mime_type": "image/jpeg",
        "food_type": "homemade",
    }
    headers = {"Content-Type": "application/json"}
    if config.RECOGNIZE_AUTH:
        headers["Authorization"] = config.RECOGNIZE_AUTH

    t0 = time.time()
    try:
        resp = requests.post(config.RECOGNIZE_URL, json=payload, headers=headers, timeout=config.REQUEST_TIMEOUT)
        elapsed = time.time() - t0
        data = resp.json() if resp.status_code == 200 else {"success": False, "error": f"HTTP {resp.status_code}"}
    except Exception as e:
        elapsed = time.time() - t0
        data = {"success": False, "error": str(e)}
    rec = _normalize_response(data)
    rec["inferenceTime"] = round(elapsed, 3)
    return rec


def run(split: str = "validation", limit: int = 500):
    ensure_packages()
    try:
        import requests  # noqa: F401
    except ImportError:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])

    index_path = config.FOOD101_DIR / f"index_{split}.json"
    if not index_path.exists():
        log.error(f"No index at {index_path}. Run load_food101 with --materialize first.")
        return
    index = json.loads(index_path.read_text())[:limit]
    log.info(f"Running benchmark over {len(index)} images → endpoint {config.RECOGNIZE_URL}")

    from tqdm import tqdm
    results = []
    for entry in tqdm(index, desc="benchmark"):
        rec = recognize(entry["imagePath"])
        success = label_matches(rec["aiPrediction"], entry["groundTruth"])
        top3_hit = success or any(label_matches(a, entry["groundTruth"]) for a in rec["alternatives"])
        results.append({
            "imageId": entry["imageId"],
            "imagePath": entry["imagePath"],
            "imageHash": entry.get("imageHash", ""),
            "groundTruth": entry["groundTruth"],
            "aiPrediction": rec["aiPrediction"],
            "alternatives": rec["alternatives"],
            "confidence": rec["confidence"],
            "inferenceTime": rec["inferenceTime"],
            "success": success,
            "top3Hit": top3_hit,
            "reasoning": rec["reasoning"],
            "cookingStyle": rec["cookingStyle"],
            "foodState": rec["foodState"],
        })

    out_path = config.RESULTS_DIR / f"results_{split}.json"
    out_path.write_text(json.dumps(results, indent=2))
    log.info(f"Saved {len(results)} results → {out_path}")

    # Auto-generate reports
    from benchmark.scripts.generate_report import generate
    generate(results, split)
    return results


def main():
    ap = argparse.ArgumentParser(description="Run GetFit benchmark over Food-101")
    ap.add_argument("--split", default="validation")
    ap.add_argument("--limit", type=int, default=500)
    args = ap.parse_args()
    run(args.split, args.limit)


if __name__ == "__main__":
    main()
