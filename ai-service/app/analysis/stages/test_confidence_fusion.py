"""
Unit tests for the Confidence_Fusion_Service.

Covers the acceptance criteria of Requirement 27:
  • 27.1 — all six per-source confidences are combined into one overall score.
  • 27.2 / 27.4 — the overall Confidence_Score is bounded to [0.0, 1.0].
  • 27.3 — no single source dominates (effective weights are capped).
  • 27.2 (config) — weights are read from configuration / overridable.
plus edge cases (all-zero / all-one inputs, degenerate weights).
"""

import asyncio

from app.analysis.contracts import ConfidenceSources, OverallConfidence
from app.analysis.stages.confidence_fusion import (
    SOURCE_NAMES,
    ConfidenceFusionService,
)


def _sources(value: float = 0.5, **overrides: float) -> ConfidenceSources:
    """Build ConfidenceSources with every source at `value`, with overrides."""
    base = {name: value for name in SOURCE_NAMES}
    base.update(overrides)
    return ConfidenceSources(**base)


def _run(stage: ConfidenceFusionService, data: ConfidenceSources) -> OverallConfidence:
    result = asyncio.run(stage.run(data))
    assert result.success is True
    assert result.error is None
    assert result.output is not None
    return result.output


def test_combines_all_sources_into_single_score():
    # Req 27.1: uniform inputs fuse to that same value (weights sum to 1).
    stage = ConfidenceFusionService()
    out = _run(stage, _sources(0.5))
    assert abs(out.overall - 0.5) < 1e-9


def test_output_bounded_for_extremes():
    # Req 27.2 / 27.4: all-zero → 0.0, all-one → 1.0, both within [0,1].
    stage = ConfidenceFusionService()
    lo = _run(stage, _sources(0.0))
    hi = _run(stage, _sources(1.0))
    assert lo.overall == 0.0
    assert hi.overall == 1.0
    assert 0.0 <= lo.overall <= 1.0
    assert 0.0 <= hi.overall <= 1.0


def test_no_single_source_dominates():
    # Req 27.3: with all other sources at 0, varying one source from 0→1 moves
    # the overall by at most its (capped) effective weight — never the full span.
    stage = ConfidenceFusionService()
    for name in SOURCE_NAMES:
        low = _run(stage, _sources(0.0))
        high = _run(stage, _sources(0.0, **{name: 1.0}))
        delta = high.overall - low.overall
        assert delta < 1.0  # a single source cannot move the score across [0,1]
        assert delta <= stage.max_single_weight + 1e-9


def test_effective_weights_capped_and_normalized():
    # Req 27.3: a dominating configured weight is capped; weights re-normalize.
    stage = ConfidenceFusionService(
        weights={
            "vision": 0.9,
            "pose": 0.02,
            "detection": 0.02,
            "movement_quality": 0.02,
            "biomechanics": 0.02,
            "reasoning": 0.02,
        },
        max_single_weight=0.4,
    )
    ew = stage._effective_weights()
    assert abs(sum(ew.values()) - 1.0) < 1e-9
    # The capped source is no longer near 0.9 of the total.
    assert ew["vision"] < 0.9


def test_degenerate_weights_fall_back_to_uniform():
    # All-zero weights → uniform distribution, still a valid bounded score.
    stage = ConfidenceFusionService(weights={name: 0.0 for name in SOURCE_NAMES})
    ew = stage._effective_weights()
    expected = 1.0 / len(SOURCE_NAMES)
    assert all(abs(w - expected) < 1e-9 for w in ew.values())
    out = _run(stage, _sources(0.7))
    assert abs(out.overall - 0.7) < 1e-9


def test_default_weights_match_config_effective():
    # Req 27.2: default config weights already sum to 1 and respect the cap, so
    # effective weights equal the configured weights.
    from app.core.config import settings

    stage = ConfidenceFusionService()
    ew = stage._effective_weights()
    for name in SOURCE_NAMES:
        assert abs(ew[name] - settings.FUSION_WEIGHTS[name]) < 1e-9
