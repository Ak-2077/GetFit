"""
Property-based tests for the Camera_Guidance_Service
(app/analysis/stages/camera_guidance.py).

Covers design Property 20 — "Camera guidance detects issues and is actionable
or clears" — using Hypothesis with a minimum of 100 iterations.

A `StaticCameraSignalSource` is injected with generated `CameraSignals` that
straddle each configured detection threshold, so the test fully controls every
recording-setup reading without touching real pixel/pose data.

Validates: Requirements 22.2, 22.3, 22.4
"""

import asyncio

from hypothesis import given, settings as hyp_settings
from hypothesis import strategies as st

from app.analysis.contracts import CameraGuidance, Frame, FrameSet, VideoMeta
from app.analysis.stages.camera_guidance import (
    ISSUE_BODY_CUT_OFF,
    ISSUE_BODY_TOO_CLOSE,
    ISSUE_BODY_TOO_SMALL,
    ISSUE_EXCESSIVE_SHAKE,
    ISSUE_INCORRECT_ANGLE,
    ISSUE_INCORRECT_ORIENTATION,
    ISSUE_MULTIPLE_PEOPLE,
    ISSUE_POOR_LIGHTING,
    CameraGuidanceService,
    CameraSignals,
    StaticCameraSignalSource,
)
from app.core.config import settings


# ── Source metadata (only orientation matters to the guidance math) ────────

def _meta(orientation: str) -> VideoMeta:
    return VideoMeta(
        container_format="mp4",
        codec="h264",
        duration_sec=5.0,
        width=1080,
        height=1920,
        fps=30.0,
        size_bytes=1_000_000,
        orientation=orientation,
    )


# ── Generators ─────────────────────────────────────────────────────────────
# Every continuous signal is generated across a range that straddles its
# configured threshold, so each condition is exercised on both its detected
# and its clean side; person_count straddles CAMERA_MAX_PEOPLE.

_camera_signals = st.builds(
    CameraSignals,
    body_coverage=st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    body_area_fraction=st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    view_angle_deg=st.floats(min_value=0.0, max_value=90.0, allow_nan=False, allow_infinity=False),
    brightness=st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    shake=st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    person_count=st.integers(min_value=0, max_value=3),
)

# Signals that sit strictly inside every clean band, so a recording built
# entirely from them (in the expected orientation) has no issues at all —
# guaranteeing the "clears" branch (suitable=True, empty issues) is exercised.
_clean_signals = st.builds(
    CameraSignals,
    body_coverage=st.floats(min_value=0.96, max_value=1.0, allow_nan=False, allow_infinity=False),
    body_area_fraction=st.floats(min_value=0.16, max_value=0.79, allow_nan=False, allow_infinity=False),
    view_angle_deg=st.floats(min_value=0.0, max_value=29.0, allow_nan=False, allow_infinity=False),
    brightness=st.floats(min_value=0.25, max_value=1.0, allow_nan=False, allow_infinity=False),
    shake=st.floats(min_value=0.0, max_value=0.49, allow_nan=False, allow_infinity=False),
    person_count=st.integers(min_value=0, max_value=1),
)

# A run is either an arbitrary recording (any orientation) or a guaranteed-clean
# recording (expected orientation), so both detection and the clean path are hit.
_runs = st.one_of(
    st.tuples(
        st.lists(_camera_signals, min_size=1, max_size=6),
        st.sampled_from(["portrait", "landscape"]),
    ),
    st.tuples(
        st.lists(_clean_signals, min_size=1, max_size=6),
        st.just(settings.CAMERA_EXPECTED_ORIENTATION),
    ),
)


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _expected_aggregate(per_frame: list[CameraSignals]) -> CameraSignals:
    """Recompute the representative reading independently (mean / max)."""
    return CameraSignals(
        body_coverage=_mean([s.body_coverage for s in per_frame]),
        body_area_fraction=_mean([s.body_area_fraction for s in per_frame]),
        view_angle_deg=_mean([s.view_angle_deg for s in per_frame]),
        brightness=_mean([s.brightness for s in per_frame]),
        shake=_mean([s.shake for s in per_frame]),
        person_count=max(s.person_count for s in per_frame),
    )


def _expected_issues(agg: CameraSignals, orientation: str) -> set[str]:
    """Derive the set of violated thresholds straight from the configuration."""
    expected: set[str] = set()
    if orientation != settings.CAMERA_EXPECTED_ORIENTATION:
        expected.add(ISSUE_INCORRECT_ORIENTATION)
    if agg.body_coverage < settings.CAMERA_MIN_BODY_COVERAGE:
        expected.add(ISSUE_BODY_CUT_OFF)
    # body-area conditions are mutually exclusive (too small XOR too close).
    if agg.body_area_fraction < settings.CAMERA_MIN_BODY_AREA:
        expected.add(ISSUE_BODY_TOO_SMALL)
    elif agg.body_area_fraction > settings.CAMERA_MAX_BODY_AREA:
        expected.add(ISSUE_BODY_TOO_CLOSE)
    if agg.view_angle_deg > settings.CAMERA_MAX_VIEW_ANGLE_DEG:
        expected.add(ISSUE_INCORRECT_ANGLE)
    if agg.brightness < settings.CAMERA_MIN_BRIGHTNESS:
        expected.add(ISSUE_POOR_LIGHTING)
    if agg.shake > settings.CAMERA_MAX_SHAKE:
        expected.add(ISSUE_EXCESSIVE_SHAKE)
    if agg.person_count > settings.CAMERA_MAX_PEOPLE:
        expected.add(ISSUE_MULTIPLE_PEOPLE)
    return expected


def _frameset_from(
    signals_list: list[CameraSignals], orientation: str
) -> tuple[FrameSet, StaticCameraSignalSource]:
    frames = [Frame(index=i, timestamp_ms=float(i * 100)) for i in range(len(signals_list))]
    source = StaticCameraSignalSource({f.index: s for f, s in zip(frames, signals_list)})
    return FrameSet(frames=frames, source_meta=_meta(orientation)), source


def _run(stage: CameraGuidanceService, fs: FrameSet):
    return asyncio.run(stage.run(fs))


# ── Property 20 ─────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 20: Camera guidance detects issues
# and is actionable or clears — for any recording, every present condition is
# flagged with a non-empty actionable recommendation and the recording is marked
# unsuitable; when no condition is present the recording is marked suitable with
# an empty issue list.
@given(run=_runs)
@hyp_settings(max_examples=200)
def test_camera_guidance_detects_issues_and_is_actionable_or_clears(run):
    signals_list, orientation = run
    fs, source = _frameset_from(signals_list, orientation)

    # Default thresholds → the configured CAMERA_* values (Req 22.4).
    stage = CameraGuidanceService(source)
    result = _run(stage, fs)

    # The stage never raises on a domain outcome — it always succeeds (Req 22.x).
    assert result.success
    guidance: CameraGuidance = result.output

    aggregate = _expected_aggregate(signals_list)
    expected = _expected_issues(aggregate, orientation)
    detected = {ci.issue for ci in guidance.issues}

    # Detected issues match exactly the violated thresholds (Req 22.2).
    assert detected == expected

    if expected:
        # Issues present → unsuitable, and every issue carries a non-empty,
        # actionable recommendation (Req 22.3).
        assert guidance.suitable is False
        assert guidance.issues, "issues present but issue list is empty"
        for ci in guidance.issues:
            assert ci.recommendation, f"issue {ci.issue!r} has an empty recommendation"
            assert ci.recommendation.strip() != ""
        # No duplicate conditions are reported.
        assert len(guidance.issues) == len(detected)
    else:
        # No issues → suitable with an empty issue list (Req 22.4).
        assert guidance.suitable is True
        assert guidance.issues == []
