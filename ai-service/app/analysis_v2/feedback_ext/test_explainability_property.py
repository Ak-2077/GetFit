"""
Property-based tests for Explainable AI — Stage 48 (Req 49).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hypothesis property tests covering the total, fail-safe score-explanation
mapping implemented by `explain_score(...)` in
`app/analysis_v2/feedback_ext/explainability.py`:

  • Property 58 — every reported score is explained with factor weights each in
    [0, 100] and summing to 100; any score whose required contributing factor
    is unavailable is omitted and a could-not-explain indication is recorded
    (Req 49.1, 49.2, 49.3, 49.4).

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest \\
        app/analysis_v2/feedback_ext/test_explainability_property.py -q
"""

from __future__ import annotations

import math

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.base import StructuredError
from app.analysis_v2.feedback_ext.explainability import (
    EXPLAINABILITY_STAGE_NAME,
    REQUIRED_FACTORS,
    SCORE_NOT_EXPLAINABLE,
    TOTAL_WEIGHT,
    explain_score,
)
from app.analysis_v2.models_v2 import ScoreExplanation

# Minimum number of generated examples per property (task requirement: >= 100).
_MIN_ITER = 200

# Absolute tolerance for the sum-to-100 float invariant.
_SUM_TOL = 1e-6


# ── Strategies ───────────────────────────────────────────────────────────────

# An *available* factor magnitude: finite and non-negative (the modelled input
# space that yields a valid percentage weight).
_available_value = st.floats(
    min_value=0.0,
    max_value=1e6,
    allow_nan=False,
    allow_infinity=False,
)

# An *unavailable* factor value: explicit None, non-finite sentinels, or a
# strictly-negative magnitude — none of which can produce a valid weight.
_unavailable_value = st.one_of(
    st.none(),
    st.just(float("nan")),
    st.just(float("inf")),
    st.just(float("-inf")),
    st.floats(max_value=-1e-9, allow_nan=False, allow_infinity=False),
)

# A dict with every required factor present and available.
_all_available_factors = st.fixed_dictionaries(
    {name: _available_value for name in REQUIRED_FACTORS}
)

# Score names, including the empty string edge case.
_score_name = st.text(min_size=0, max_size=32)


def _assert_valid_explanation(explanation: object) -> None:
    """Totality helper: a bona-fide ScoreExplanation with sound weights."""
    assert isinstance(explanation, ScoreExplanation)
    # Every required factor is attributed a weight in [0, 100] (Req 49.2).
    for name in REQUIRED_FACTORS:
        assert name in explanation.factors
        weight = explanation.factors[name]
        assert 0.0 <= weight <= 100.0
    # The weights sum to 100 within float tolerance (Req 49.2).
    assert math.isclose(
        math.fsum(explanation.factors.values()),
        TOTAL_WEIGHT,
        abs_tol=_SUM_TOL,
    )


# ── Property 58 ────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 58: Every reported score is explained
#          with factor weights summing to 100
# Validates: Requirements 49.1, 49.2, 49.3, 49.4


@settings(max_examples=_MIN_ITER, deadline=None)
@given(factors=_all_available_factors, score_name=_score_name)
def test_property_58_all_available_weights_sum_to_100(
    factors: dict[str, float],
    score_name: str,
) -> None:
    """All five factors available → a ScoreExplanation whose weights are each in
    [0, 100] and sum to 100, with no error surfaced (Req 49.1, 49.2)."""
    explanation, error = explain_score(factors, score_name=score_name)
    assert error is None
    _assert_valid_explanation(explanation)
    assert explanation.score_name == score_name


@settings(max_examples=_MIN_ITER, deadline=None)
@given(score_name=_score_name)
def test_property_58_all_zero_magnitudes_distribute_equally(
    score_name: str,
) -> None:
    """All-zero magnitudes still satisfy sum-to-100 by distributing equally
    (20.0 each) rather than dividing by zero (Req 49.2)."""
    factors = {name: 0.0 for name in REQUIRED_FACTORS}
    explanation, error = explain_score(factors, score_name=score_name)
    assert error is None
    _assert_valid_explanation(explanation)
    expected = TOTAL_WEIGHT / len(REQUIRED_FACTORS)
    for name in REQUIRED_FACTORS:
        assert math.isclose(explanation.factors[name], expected, abs_tol=_SUM_TOL)


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    factors=_all_available_factors,
    missing_index=st.integers(min_value=0, max_value=len(REQUIRED_FACTORS) - 1),
    bad_value=_unavailable_value,
    score_name=_score_name,
)
def test_property_58_unavailable_factor_is_omitted_and_reported(
    factors: dict[str, float],
    missing_index: int,
    bad_value: float | None,
    score_name: str,
) -> None:
    """Any required factor unavailable (None / non-finite / negative) →
    (None, StructuredError) with the could-not-explain code so the caller omits
    the score; never raises (Req 49.3, 49.4)."""
    corrupted = dict(factors)
    corrupted[REQUIRED_FACTORS[missing_index]] = bad_value  # type: ignore[assignment]
    explanation, error = explain_score(corrupted, score_name=score_name)
    assert explanation is None
    assert isinstance(error, StructuredError)
    assert error.code == SCORE_NOT_EXPLAINABLE
    assert error.stage == EXPLAINABILITY_STAGE_NAME
    assert error.message  # non-empty, human-readable indication


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    absent_index=st.integers(min_value=0, max_value=len(REQUIRED_FACTORS) - 1),
    factors=_all_available_factors,
    score_name=_score_name,
)
def test_property_58_absent_key_is_omitted_and_reported(
    absent_index: int,
    factors: dict[str, float],
    score_name: str,
) -> None:
    """A missing required-factor KEY is treated as unavailable → the score is
    omitted with a could-not-explain indication (Req 49.4)."""
    corrupted = dict(factors)
    del corrupted[REQUIRED_FACTORS[absent_index]]
    explanation, error = explain_score(corrupted, score_name=score_name)
    assert explanation is None
    assert isinstance(error, StructuredError)
    assert error.code == SCORE_NOT_EXPLAINABLE
    assert error.stage == EXPLAINABILITY_STAGE_NAME


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    factors=st.dictionaries(
        keys=st.sampled_from(REQUIRED_FACTORS),
        values=st.one_of(_available_value, _unavailable_value),
    ),
    score_name=_score_name,
)
def test_property_58_totality_over_entire_input_space(
    factors: dict[str, float | None],
    score_name: str,
) -> None:
    """Totality across the WHOLE factor input space: exactly one of
    (explanation, error) is populated, never both, and the function never raises
    (Req 49.1, 49.3, 49.4)."""
    explanation, error = explain_score(factors, score_name=score_name)

    # Exactly one arm of the pair is populated.
    assert (explanation is None) != (error is None)

    all_available = all(
        (v := factors.get(name)) is not None
        and math.isfinite(v)
        and v >= 0.0
        for name in REQUIRED_FACTORS
    )
    if all_available:
        assert error is None
        _assert_valid_explanation(explanation)
    else:
        assert explanation is None
        assert isinstance(error, StructuredError)
        assert error.code == SCORE_NOT_EXPLAINABLE
        assert error.stage == EXPLAINABILITY_STAGE_NAME


@settings(max_examples=_MIN_ITER, deadline=None)
@given(factors=_all_available_factors, extra_value=_available_value)
def test_property_58_extra_keys_are_ignored(
    factors: dict[str, float],
    extra_value: float,
) -> None:
    """Additional non-required keys never participate in the explanation and do
    not affect the sum-to-100 invariant (Req 49.2)."""
    augmented = dict(factors)
    augmented["not_a_factor"] = extra_value
    explanation, error = explain_score(augmented)
    assert error is None
    _assert_valid_explanation(explanation)
    assert "not_a_factor" not in explanation.factors
