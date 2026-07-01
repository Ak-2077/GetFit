"""
Property-based tests for the Confidence_Fusion_Service
(app/analysis/stages/confidence_fusion.py).

Covers design Property 18 — "Confidence fusion is bounded and no single source
dominates" — using Hypothesis with a minimum of 100 iterations.

Validates: Requirements 27.1, 27.2, 27.3
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import ConfidenceSources, OverallConfidence
from app.analysis.stages.confidence_fusion import (
    SOURCE_NAMES,
    ConfidenceFusionService,
)

_TOL = 1e-9


# ── Generators ─────────────────────────────────────────────────────────────
# Six bounded per-source confidences in [0,1] (the full valid input space).

_confidence = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)

_sources = st.builds(
    ConfidenceSources,
    vision=_confidence,
    pose=_confidence,
    detection=_confidence,
    movement_quality=_confidence,
    biomechanics=_confidence,
    reasoning=_confidence,
)

# A configurable weight map (some weights may exceed the cap so capping and
# re-normalization are genuinely exercised) plus a per-source cap in a range
# that straddles typical configured weights.
_weight_maps = st.fixed_dictionaries(
    {name: st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
     for name in SOURCE_NAMES}
)
_max_single_weight = st.floats(min_value=0.1, max_value=0.5, allow_nan=False, allow_infinity=False)


def _expected_effective_weights(weights: dict, max_single_weight: float) -> dict:
    """
    Independent re-derivation of the implementation's effective weights: normalize
    the configured weights, then water-fill — cap any source above
    `max_single_weight` and redistribute the removed excess uniformly across the
    sub-cap sources until none exceeds the cap. Falls back to a uniform split when
    the configuration is degenerate (all weights non-positive) or the cap is too
    small to keep every source <= cap while summing to 1.0 (cap * n < 1.0).
    """
    n = len(SOURCE_NAMES)
    cap = max(max_single_weight, 0.0)

    raw = {name: max(weights.get(name, 0.0), 0.0) for name in SOURCE_NAMES}
    total = sum(raw.values())
    if total <= 0.0 or cap <= 0.0 or cap * n < 1.0:
        uniform = 1.0 / n
        return {name: uniform for name in SOURCE_NAMES}

    eff = {name: w / total for name, w in raw.items()}
    tol = 1e-12
    for _ in range(n + 1):
        over = [name for name in SOURCE_NAMES if eff[name] > cap + tol]
        if not over:
            break
        excess = sum(eff[name] - cap for name in over)
        for name in over:
            eff[name] = cap
        receivers = [name for name in SOURCE_NAMES if eff[name] < cap - tol]
        if not receivers:
            break
        share = excess / len(receivers)
        for name in receivers:
            eff[name] += share
    return eff


def _overall(stage: ConfidenceFusionService, sources: ConfidenceSources) -> float:
    result = asyncio.run(stage.run(sources))
    assert result.success is True
    assert result.error is None
    out: OverallConfidence = result.output
    assert out is not None
    return out.overall


def _with(value_map: dict) -> ConfidenceSources:
    return ConfidenceSources(**value_map)


# ── Property 18 ────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 18: Confidence fusion is bounded and
# no single source dominates — for any six per-source confidences in [0,1] and
# configured (capped, re-normalized) weights, the overall score lies in [0,1],
# equals the weighted average of the sources, and varying any single source
# across its full [0,1] range (others fixed) moves the overall by at most that
# source's capped effective weight.
@given(sources=_sources, weights=_weight_maps, max_single_weight=_max_single_weight)
@settings(max_examples=200)
def test_confidence_fusion_bounded_and_no_single_source_dominates(
    sources, weights, max_single_weight
):
    stage = ConfidenceFusionService(weights=weights, max_single_weight=max_single_weight)
    effective = _expected_effective_weights(weights, max_single_weight)

    base = {name: getattr(sources, name) for name in SOURCE_NAMES}
    overall = _overall(stage, sources)

    # Req 27.2 — the overall Confidence_Score is bounded to [0,1].
    assert 0.0 <= overall <= 1.0

    # Req 27.1 — weighted-average sanity check: the output equals the
    # (capped, re-normalized) weighted average of the six sources.
    expected = sum(effective[name] * base[name] for name in SOURCE_NAMES)
    assert abs(overall - max(0.0, min(1.0, expected))) <= 1e-6

    # Req 27.3 — no single source dominates: varying one source from 0 to 1
    # (holding the others fixed) moves the overall by at most that source's
    # capped effective weight, which is itself capped well below the full span.
    for name in SOURCE_NAMES:
        low_map = dict(base, **{name: 0.0})
        high_map = dict(base, **{name: 1.0})
        delta = _overall(stage, _with(high_map)) - _overall(stage, _with(low_map))
        assert delta >= -_TOL
        assert delta <= effective[name] + 1e-6
        # No single source can move the overall across the full [0,1] span.
        assert delta < 1.0


# Feature: ai-exercise-analysis, Property 18: Confidence fusion is bounded and
# no single source dominates — the same guarantees hold under the default
# configured fusion weights (Req 27.2: weights sourced from configuration).
@given(sources=_sources)
@settings(max_examples=100)
def test_confidence_fusion_default_config_bounded_and_no_domination(sources):
    stage = ConfidenceFusionService()
    effective = _expected_effective_weights(stage.weights, stage.max_single_weight)

    base = {name: getattr(sources, name) for name in SOURCE_NAMES}
    overall = _overall(stage, sources)

    assert 0.0 <= overall <= 1.0

    expected = sum(effective[name] * base[name] for name in SOURCE_NAMES)
    assert abs(overall - max(0.0, min(1.0, expected))) <= 1e-6

    for name in SOURCE_NAMES:
        low_map = dict(base, **{name: 0.0})
        high_map = dict(base, **{name: 1.0})
        delta = _overall(stage, _with(high_map)) - _overall(stage, _with(low_map))
        assert 0.0 - _TOL <= delta <= effective[name] + 1e-6
        assert delta < 1.0
