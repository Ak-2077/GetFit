# GetFit Food Recognition v3 — Hierarchical Pipeline

Extends the v2 Candidate Generation + Filtering pipeline. **No existing
component was replaced.** Fully compatible with the Vision Adapter,
Qwen2.5-VL (primary), Moondream (fallback), Reasoning Engine, USDA, Open Food
Facts, the GetFit Database, and the existing API contract.

## Pipeline Stages

| Stage | Status | Where |
|-------|--------|-------|
| 0 — Image Quality Gate | Existing (`/food-vision/analyze-quality`, `quality_issue`) | ai-service |
| 1 — Hierarchical Recognition (Category→State→Cooking→Dish) | **New** `deriveHierarchy()` | `foodHierarchy.js` |
| 2 — Candidate Generation (category-restricted) | Existing + extended | `reasoningEngine.js` |
| 3 — Visual Evidence Matrix (centralized) | **New** `EVIDENCE_MATRIX` | `foodHierarchy.js` |
| 4 — Weighted Similarity Scoring | **New** `weightedDishScore()` | `foodHierarchy.js` |
| 5 — Hard Negative Classifier | **New** `hardNegativeReject()` | `foodHierarchy.js` |
| 6 — Object Grouping (halves/slices → 1) | Existing `normalizeCounts()` | `reasoningEngine.js` |
| 7 — Portion Estimation | Existing `estimatePortion()` | `foodRoute.js` |
| 8 — Mixed Meal Segmentation | Existing (per-food grouping) | `reasoningEngine.js` |
| 9 — Confidence Calibration (primary dominates) | Existing | `reasoningEngine.js` |
| 10 — Alternatives (max 3, evidence-backed) | Existing | `reasoningEngine.js` |
| 11 — Unknown Handling (<60% → unknown) | **New** `isUnknown` flag | `reasoningEngine.js` + `foodRoute.js` |
| 12 — Learning System | Existing (`FoodCorrection`) | `foodRoute.js` |
| 13 — Performance (ontology cache, async, parallel) | Existing | multiple |
| 14 — Evaluation Suite | This document + unit suites | `tests/` |

## Hard Negative Rules (Stage 5)

A dish is rejected before reasoning if its family is detected but the required
base is not:

| Dish family | Requires |
|-------------|----------|
| biryani / pulao / fried rice | rice |
| sandwich / toast / burger | bread |
| ramen / chow mein / noodles | noodles |
| pasta / spaghetti / macaroni | pasta |
| curry / gravy / masala / korma | gravy/curry/sauce cue |
| stew / soup / rasam / sambar | liquid/bowl/gravy cue |
| wrap / roll / burrito | rolled/wrapped/bread cue |
| pizza | cheese/bread/dough/crust cue |

## Weighted Scoring (Stage 4)

```
score = 0.40·visual + 0.20·cooking + 0.15·state
      + 0.10·objectContext + 0.10·ingredients + 0.05·ontology
```
Normalized to [0,1]. Verified by unit test (full=1.0, visual-only=0.40).

## Test Coverage

- `tests/reasoningEngine.test.mjs` — **43 assertions** (egg family, mutual
  exclusion, single-primary, candidate filtering, count grouping).
- `tests/foodHierarchy.test.mjs` — **18 assertions** (hard negatives, evidence
  matrix, weighted score, hierarchy derivation).

Run:
```
node tests/reasoningEngine.test.mjs
node tests/foodHierarchy.test.mjs
```

## Stage 14 — Benchmark Methodology (to be populated)

A labeled image benchmark (target ≥500 images) should measure:

| Metric | Definition |
|--------|------------|
| Top-1 Accuracy | primary == ground truth |
| Top-3 Accuracy | ground truth in {primary, alternatives} |
| Precision / Recall | per food class |
| False Positive Rate | hallucinated dishes / total |
| Portion Error | mean abs % weight error |
| Multi-Food Accuracy | correct food separation rate |
| Inference Time | end-to-end ms |

Place labeled fixtures in `Backend/tests/fixtures/food-benchmark/` as
`{ imageHash, rawVisionText, objects, groundTruth }` and run the benchmark
harness (to be added) to regenerate this section after each major change.


---

# Recognition v4 — Additive Extensions

All v4 work is **additive**. No existing component, API, or schema changed.
The 61 v3 tests still pass; 20 new tests added (81 total).

## Implemented now

| Stage | Status | Where |
|-------|--------|-------|
| 17 — Visual Feature Extractor | **Done** `extractVisualFeatures()` / `featuresToTokens()` | `services/visualFeatureExtractor.js` |
| 22 — Food Relationship Graph | **Done** `FOOD_GRAPH`, `baseOfDish`, `childrenOf`, `areExclusiveSiblings`, `graphCandidateNames` | `services/foodRelationshipGraph.js` |
| 25 — Benchmark Framework | **Done** metrics runner + fixture loader | `tests/benchmark.mjs` |
| 17 wiring | **Done** feature tokens feed the hard-negative gate | `reasoningEngine.js` |

### Stage 17 — Visual Feature Extractor
Converts raw vision text + objects into a structured object: `shape`, `color`,
`texture`, `container`, `surface`, `structural`, `utensils`, `cutState`,
boolean flags (`hasGravy`, `hasRiceGrains`, `hasBread`, `hasNoodles`,
`hasCheese`, `hasShell`, `hasBone`, `hasSteam`, `hasLiquid`), `counts`,
`objects`. Negation/word-boundary aware ("no oil" ≠ oily). Exposed in the
reasoning result as `visualFeatures`. Its tokens now strengthen the Stage 5
hard-negative gate.

### Stage 22 — Food Relationship Graph
Hierarchical base → preparations graph with mutually-exclusive sibling sets.
Enables graph-scoped candidate traversal (`graphCandidateNames`) and clean
sibling/conflict detection.

### Stage 25 — Benchmark Framework
`node tests/benchmark.mjs` computes Top-1, Top-3, hallucination rate, unknown
rate, avg confidence, calibration error, multi-food accuracy, avg inference ms.
Loads `tests/fixtures/food-benchmark.json` if present, else a built-in smoke set.

## Requires infrastructure (designed, not stood up here)

These stages need an embedding model + vector store and DB migrations, which
can't be provisioned in this environment. The graph + feature extractor are
the foundation they plug into:

| Stage | What remains |
|-------|--------------|
| 15 — Visual Embedding Layer | Generate image embeddings via Qwen/CLIP; cache by image hash in `FoodMemory.visualEmbedding`. |
| 16 / 23 — Similarity & Retrieval-Augmented Reasoning | ANN index (e.g. Redis vector / pgvector / Faiss) returning top-20 before reasoning. `graphCandidateNames()` already narrows scope as an interim. |
| 18 — Advanced Segmentation | Per-region masks from the vision service (SAM/Qwen grounding). Current pipeline segments via detected objects. |
| 19 — Portion Estimation 2.0 | Reference-object scale + plate-coverage geometry (groundwork exists in prior portion engine). |
| 24 — Learning System v2 | Extend `FoodCorrection`/`FoodMemory` schema with embedding + feature columns (additive migration). |

## Test commands
```
node tests/reasoningEngine.test.mjs    # 43
node tests/foodHierarchy.test.mjs      # 18
node tests/visualFeatures.test.mjs     # 20
node tests/benchmark.mjs               # metrics report
```
