"""
Step 2 + 4 — Food-101 dataset loader.

Downloads (once, cached) and exposes Food-101 via Hugging Face datasets.
Materializes a sample of images to disk for the runner/annotator.

Usage:
    python -m benchmark.scripts.load_food101 --split validation --limit 500 --materialize
"""

import argparse
import json
import sys
from pathlib import Path

# Allow running as a module or a script
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from benchmark import config  # noqa: E402
from benchmark.scripts.common import get_logger, ensure_packages, normalize_label, file_hash  # noqa: E402

log = get_logger("load_food101")


def load_split(split: str = "validation"):
    """Load a Food-101 split via HF (cached locally). Returns the dataset."""
    ensure_packages()
    from datasets import load_dataset  # imported after ensure_packages

    meta = config.DATASET_REGISTRY["food101"]
    log.info(f"Loading {meta['hf_id']} split='{split}' (cache: {config.CACHE_DIR}) …")
    try:
        ds = load_dataset(meta["hf_id"], split=split, cache_dir=str(config.CACHE_DIR))
    except Exception as e:
        log.error(f"Failed to load Food-101: {e}")
        log.error("Check internet connectivity. The dataset caches after first download.")
        raise
    log.info(f"Loaded {len(ds)} examples from split '{split}'.")
    return ds


def dataset_statistics(ds) -> dict:
    """Print + return label distribution statistics."""
    meta = config.DATASET_REGISTRY["food101"]
    label_feature = ds.features[meta["label_key"]]
    names = getattr(label_feature, "names", None)
    counts = {}
    for label_id in ds[meta["label_key"]]:
        name = names[label_id] if names else str(label_id)
        counts[name] = counts.get(name, 0) + 1
    stats = {
        "total_images": len(ds),
        "num_classes": len(counts),
        "examples_per_class_min": min(counts.values()) if counts else 0,
        "examples_per_class_max": max(counts.values()) if counts else 0,
    }
    log.info(f"Stats: {stats}")
    return stats


def materialize(ds, limit: int = 500, split: str = "validation") -> list:
    """
    Write `limit` images to benchmark/food101/<split>/ and an index JSON.
    Skips files that already exist (caching).
    """
    meta = config.DATASET_REGISTRY["food101"]
    names = getattr(ds.features[meta["label_key"]], "names", None)
    out_dir = config.FOOD101_DIR / split
    out_dir.mkdir(parents=True, exist_ok=True)

    index = []
    n = min(limit, len(ds))
    log.info(f"Materializing {n} images → {out_dir}")
    for i in range(n):
        row = ds[i]
        label_id = row[meta["label_key"]]
        label = normalize_label(names[label_id] if names else str(label_id))
        img = row[meta["image_key"]]
        img_path = out_dir / f"{i:05d}.jpg"
        if not img_path.exists():
            try:
                img.convert("RGB").save(img_path, "JPEG", quality=85)
            except Exception as e:
                log.warning(f"Skip image {i}: {e}")
                continue
        index.append({
            "imageId": f"food101_{split}_{i:05d}",
            "imagePath": str(img_path),
            "imageHash": file_hash(img_path),
            "groundTruth": label,
        })

    index_path = config.FOOD101_DIR / f"index_{split}.json"
    index_path.write_text(json.dumps(index, indent=2))
    log.info(f"Wrote index: {index_path} ({len(index)} entries)")
    return index


def main():
    ap = argparse.ArgumentParser(description="Load & materialize Food-101")
    ap.add_argument("--split", default="validation")
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--materialize", action="store_true", help="write images to disk")
    args = ap.parse_args()

    ds = load_split(args.split)
    dataset_statistics(ds)
    if args.materialize:
        materialize(ds, args.limit, args.split)


if __name__ == "__main__":
    main()
