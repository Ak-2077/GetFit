"""
Shared helpers for the benchmark scripts: logging, dependency install,
label normalization, hashing.
"""

import importlib
import logging
import subprocess
import sys
import hashlib


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        h = logging.StreamHandler(sys.stdout)
        h.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s", "%H:%M:%S"))
        logger.addHandler(h)
        logger.setLevel(logging.INFO)
    return logger


log = get_logger("benchmark")


# ── Step 1: ensure packages (skip if present) ──
REQUIRED = ["datasets", "PIL", "tqdm", "pandas", "numpy"]
PIP_NAMES = {"PIL": "pillow"}


def ensure_packages():
    """Install required packages only if missing."""
    missing = []
    for mod in REQUIRED:
        try:
            importlib.import_module(mod)
        except ImportError:
            missing.append(PIP_NAMES.get(mod, mod))
    if missing:
        log.info(f"Installing missing packages: {', '.join(missing)}")
        subprocess.check_call([sys.executable, "-m", "pip", "install", *missing])
    else:
        log.info("All benchmark packages already installed — skipping install.")


def normalize_label(label: str) -> str:
    """Food-101 labels look like 'french_fries' → 'french fries'."""
    return (label or "").replace("_", " ").strip().lower()


def label_matches(prediction: str, ground_truth: str) -> bool:
    """
    Lenient match: exact, or one contains the other's core token.
    Food-101 has dish-level labels; the pipeline may return a base ingredient
    or a more specific preparation, so we allow containment in either direction.
    """
    p = (prediction or "").strip().lower()
    g = (ground_truth or "").strip().lower()
    if not p or not g:
        return False
    if p == g:
        return True
    if p in g or g in p:
        return True
    # token overlap (e.g. "boiled egg" vs "egg") — share a significant word
    pg = set(p.split())
    gg = set(g.split())
    common = pg & gg
    return any(len(w) >= 4 for w in common)


def file_hash(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()[:16]
