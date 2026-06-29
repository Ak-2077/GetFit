"""
Benchmark configuration — all paths & endpoints in one place.
Isolated from production settings.
"""

import os
from pathlib import Path

# ── Root paths (everything stays under benchmark/) ──
BENCHMARK_ROOT = Path(__file__).resolve().parent
FOOD101_DIR = BENCHMARK_ROOT / "food101"
DATASET_DIR = BENCHMARK_ROOT / "dataset"
ANNOTATIONS_DIR = BENCHMARK_ROOT / "annotations"
RESULTS_DIR = BENCHMARK_ROOT / "results"
REPORTS_DIR = BENCHMARK_ROOT / "reports"
SCRIPTS_DIR = BENCHMARK_ROOT / "scripts"
CACHE_DIR = BENCHMARK_ROOT / ".hf_cache"

for _d in (FOOD101_DIR, DATASET_DIR, ANNOTATIONS_DIR, RESULTS_DIR, REPORTS_DIR, CACHE_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ── Recognition endpoint ──
# The benchmark calls the RUNNING service over HTTP. It never imports
# production code. Override with env vars.
#   AI service (vision only):  http://localhost:8100/food-vision/recognize
#   Node backend (full pipeline, needs auth): http://localhost:5000/api/food/recognize
RECOGNIZE_URL = os.environ.get(
    "BENCHMARK_RECOGNIZE_URL", "http://localhost:8100/food-vision/recognize"
)
# Optional bearer token if pointing at the authenticated backend route.
RECOGNIZE_AUTH = os.environ.get("BENCHMARK_RECOGNIZE_AUTH", "")
REQUEST_TIMEOUT = float(os.environ.get("BENCHMARK_TIMEOUT", "90"))

# ── Confidence thresholds for metric computation ──
UNKNOWN_THRESHOLD = 0.60   # below this → "unknown"
TOP3_LIMIT = 3

# ── HF dataset registry (Stage 11 — future compatibility) ──
# Adding a dataset = add one entry here.
DATASET_REGISTRY = {
    "food101": {
        "hf_id": "ethz/food101",
        "image_key": "image",
        "label_key": "label",
        "splits": ["train", "validation"],
    },
    # Future:
    # "nutrition5k": {...}, "uecfood100": {...}, "uecfood256": {...},
}
