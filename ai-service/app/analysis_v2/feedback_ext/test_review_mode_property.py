"""
Property-based tests for Human_Review_Mode (Req 42).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hypothesis property tests covering the total, fail-safe threshold mapping
implemented by `assign_review_status(...)` in
`app/analysis_v2/feedback_ext/review_mode.py`:

  • Property 48 — review status is a total, fail-safe threshold mapping
    (Req 42.1, 42.2, 42.4, 42.5, 42.6).

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest \\
        app/analysis_v2/feedback_ext/test_review_mode_property.py -q
"""

from __future__ import annotations

import math

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.base import StructuredError
from app.analysis_v2.feedback_ext.review_mode import (
    INVALID_REVIEW_THRESHOLD,
    REVIEW_STAGE_NAME,
    assign_review_status,
)
from app.analysis_v2.models_v2 import ReviewStatus

# Minimum number of generated examples per property (task requirement: >= 100).
_MIN_ITER = 200

# The two — and only two — review states (Req 42.5).
_ALL_STATUSES = {ReviewStatus.confident, ReviewStatus.needs_review}


# ── Strategies ───────────────────────────────────────────────────────────────

# Confidence scores are expected in [0.0, 1.0] (the modelled input space).
_confidence = st.floats(
    min_value=0.0,
    max_value=1.0,
    allow_nan=False,
    allow_infinity=False,
)

# Valid, in-range thresholds live in the closed interval [0.0, 1.0].
_valid_threshold = st.floats(
    min_value=0.0,
    max_value=1.0,
    allow_nan=False,
    allow_infinity=False,
)

# Out-of-range thresholds: strictly below 0.0 or strictly above 1.0, plus the
# pathological NaN / infinities, all of which must be treated as invalid config.
_out_of_range_threshold = st.one_of(
    st.floats(max_value=-1e-9, allow_nan=False, allow_infinity=False),
    st.floats(min_value=1.0 + 1e-9, allow_nan=False, allow_infinity=False),
    st.just(float("nan")),
    st.just(float("inf")),
    st.just(float("-inf")),
)


def _assert_valid_status(status: object) -> None:
    """Totality helper: a bona-fide ReviewStatus is always returned."""
    assert isinstance(status, ReviewStatus)
    assert status in _ALL_STATUSES


# ── Property 48 ────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 48: Review status is a total, fail-safe threshold mapping
# Validates: Requirements 42.1, 42.2, 42.4, 42.5, 42.6


@settings(max_examples=_MIN_ITER, deadline=None)
@given(confidence=_confidence, threshold=_valid_threshold)
def test_property_48_totality_valid_threshold(
    confidence: float,
    threshold: float,
) -> None:
    """For any confidence and any valid threshold, exactly one valid status is
    returned and no error is surfaced (Req 42.5)."""
    status, error = assign_review_status(confidence, threshold)
    _assert_valid_status(status)
    # A valid configuration never carries an invalid-config indication.
    assert error is None


@settings(max_examples=_MIN_ITER, deadline=None)
@given(confidence=_confidence, threshold=_valid_threshold)
def test_property_48_boundary_strict_below_vs_at_or_above(
    confidence: float,
    threshold: float,
) -> None:
    """Needs Review IFF confidence is strictly below threshold; Confident IFF
    confidence >= threshold (Req 42.1, 42.2). This pins the boundary: equality
    resolves to Confident, not Needs Review."""
    status, error = assign_review_status(confidence, threshold)
    assert error is None
    if confidence < threshold:
        assert status is ReviewStatus.needs_review
    else:
        assert status is ReviewStatus.confident


@settings(max_examples=_MIN_ITER, deadline=None)
@given(value=_valid_threshold)
def test_property_48_equal_confidence_and_threshold_is_confident(
    value: float,
) -> None:
    """At exact equality (confidence == threshold) the result is Confident —
    the '>=' side of the strict-below boundary (Req 42.2, 42.4)."""
    status, error = assign_review_status(value, value)
    assert error is None
    assert status is ReviewStatus.confident


@settings(max_examples=_MIN_ITER, deadline=None)
@given(confidence=_confidence, threshold=_out_of_range_threshold)
def test_property_48_out_of_range_threshold_is_failsafe(
    confidence: float,
    threshold: float,
) -> None:
    """A threshold outside [0.0, 1.0] (including NaN / infinities) fails safe:
    Needs Review plus an INVALID_REVIEW_THRESHOLD indication; never raises
    (Req 42.6, 42.4)."""
    status, error = assign_review_status(confidence, threshold)
    _assert_valid_status(status)
    assert status is ReviewStatus.needs_review
    assert isinstance(error, StructuredError)
    assert error.code == INVALID_REVIEW_THRESHOLD
    assert error.stage == REVIEW_STAGE_NAME
    assert error.message  # non-empty, human-readable indication


@settings(max_examples=_MIN_ITER, deadline=None)
@given(confidence=_confidence)
def test_property_48_absent_threshold_is_failsafe(confidence: float) -> None:
    """An absent threshold (None) fails safe to Needs Review with an
    INVALID_REVIEW_THRESHOLD indication; never raises (Req 42.6)."""
    status, error = assign_review_status(confidence, None)
    assert status is ReviewStatus.needs_review
    assert isinstance(error, StructuredError)
    assert error.code == INVALID_REVIEW_THRESHOLD
    assert error.stage == REVIEW_STAGE_NAME


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    confidence=_confidence,
    threshold=st.one_of(_valid_threshold, _out_of_range_threshold, st.none()),
)
def test_property_48_totality_over_entire_input_space(
    confidence: float,
    threshold: float | None,
) -> None:
    """Totality across the WHOLE threshold input space (valid, out-of-range,
    and absent): exactly one valid status is always returned and a Needs Review
    result is never represented as Confident (Req 42.5, 42.4)."""
    status, error = assign_review_status(confidence, threshold)
    _assert_valid_status(status)

    # A Needs Review outcome must never be mislabelled Confident and
    # vice-versa: the two states are mutually exclusive.
    is_needs_review = status is ReviewStatus.needs_review
    is_confident = status is ReviewStatus.confident
    assert is_needs_review != is_confident  # exactly one holds

    # Fail-safe pairing: an error is surfaced IFF the threshold is invalid, and
    # whenever an error is surfaced the status is the safe Needs Review.
    invalid = (
        threshold is None
        or math.isnan(threshold)
        or not (0.0 <= threshold <= 1.0)
    )
    if invalid:
        assert status is ReviewStatus.needs_review
        assert isinstance(error, StructuredError)
        assert error.code == INVALID_REVIEW_THRESHOLD
    else:
        assert error is None
