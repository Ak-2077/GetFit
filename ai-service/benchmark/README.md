# GetFit Benchmark Framework — Phase 1 (Food-101)

A **completely isolated** evaluation framework. It measures the accuracy of the
existing GetFit recognition pipeline against public datasets. It never imports
or modifies production code — it talks to the running service over HTTP.

> Does **not** touch: GetFit DB, USDA, Open Food Facts, Vision Adapter,
> Reasoning Engine, or any production API. All artifacts stay under `benchmark/`.

## Layout
```
benchmark/
├── config.py              # paths, endpoint, dataset registry
├── food101/               # materialized images + index (gitignored)
├── dataset/               # reserved for future datasets (gitignored)
├── annotations/           # reserved
├── results/               # raw run results JSON (gitignored)
├── reports/               # accuracy.json / accuracy.csv / summary.md
├── getfit_benchmark.json  # human-corrected gold set (gitignored)
└── scripts/
    ├── common.py          # logging, install, label matching
    ├── load_food101.py    # download + materialize (Steps 2,4)
    ├── run_benchmark.py    # run pipeline + store results (Steps 5,6)
    ├── generate_report.py # metrics + dashboard (Steps 7,10)
    └── annotate.py        # manual correction → GetFit benchmark (Steps 8,9)
```

## Prerequisites
1. The recognition service must be running. By default the benchmark calls the
   AI vision route:
   ```
   uvicorn app.main:app --host 0.0.0.0 --port 8100
   ```
   To benchmark the **full Node pipeline** instead, point the endpoint at it:
   ```
   set BENCHMARK_RECOGNIZE_URL=http://localhost:5000/api/food/recognize
   set BENCHMARK_RECOGNIZE_AUTH=Bearer <token>
   ```

## Usage
```bash
# 1) Download Food-101 (cached) + write 500 validation images to disk
python -m benchmark.scripts.load_food101 --split validation --limit 500 --materialize

# 2) Run the benchmark (auto-generates reports)
python -m benchmark.scripts.run_benchmark --split validation --limit 500

# 3) Inspect reports
#    benchmark/reports/summary.md  (dashboard)
#    benchmark/reports/accuracy.json / accuracy.csv

# 4) Manually correct predictions → builds getfit_benchmark.json
python -m benchmark.scripts.annotate --split validation
```

## Metrics (reports/summary.md)
Top-1 / Top-3 accuracy, hallucination rate, false-negative rate, unknown rate,
average confidence, average inference time.

## Adding a new dataset (Stage 11)
Add one entry to `DATASET_REGISTRY` in `config.py` (Nutrition5k, UECFood100,
UECFood256, GetFit custom) and write a thin loader mirroring `load_food101.py`.
The runner, report, and annotator are dataset-agnostic.

## Notes
- Packages auto-install on first run (`datasets pillow tqdm pandas numpy`,
  plus `requests`). Already-installed packages are skipped.
- Downloads cache in `.hf_cache/`; re-runs do not re-download.
- Label matching is lenient (containment/token overlap) because Food-101 uses
  dish-level labels while the pipeline may return a base or preparation.
