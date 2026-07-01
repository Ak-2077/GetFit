"""
Property-based tests for condition-to-error-code mapping and cross-boundary
error sanitization (app/analysis/errors.py + app/analysis/base.py).

Covers design Property 19 — "Condition-to-error-code mapping with well-formed
structured errors" — using Hypothesis with a minimum of 100 iterations.

Property 19 asserts that, for any stage failure condition, the returned
`StructuredError` carries a non-empty stable code, a human-readable message, and
the originating stage name (with no internal stack detail), and that each
defined domain condition maps to its specified stable code:

  • all frames discarded, dominant absent visibility → BODY_NOT_VISIBLE
  • top detection confidence below threshold        → EXERCISE_NOT_RECOGNIZED
  • more than one person detected                    → MULTIPLE_PEOPLE
  • retained-frame brightness below minimum          → CAMERA_TOO_DARK
  • retained-frame shake above maximum               → CAMERA_SHAKING
  • overall pose confidence below threshold          → LOW_CONFIDENCE
  • video validation                                 → CORRUPTED_VIDEO /
        UNSUPPORTED_CODEC / VIDEO_TOO_SHORT / VIDEO_TOO_LONG

It also pins the canonical supported-code set (exactly ten codes) and verifies
`sanitize_error` surfaces ONLY {code, message}, dropping stage / details / any
internal detail across the boundary.

Validates: Requirements 4.5, 6.3, 7.6, 15.1, 15.3, 15.4, 15.5, 15.6, 21.3, 26.4
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.adapters.pose_engines import PoseEngine, PoseEngineResult
from app.analysis.base import StructuredError
from app.analysis.contracts import (
    Frame,
    FrameLandmarks,
    FrameSet,
    KeyFrames,
    Landmark,
    Landmarks,
    VideoMeta,
)
from app.analysis.errors import (
    BODY_NOT_VISIBLE,
    CAMERA_SHAKING,
    CAMERA_TOO_DARK,
    CORRUPTED_VIDEO,
    EXERCISE_NOT_RECOGNIZED,
    LOW_CONFIDENCE,
    MULTIPLE_PEOPLE,
    SUPPORTED_ERROR_CODES,
    UNSUPPORTED_CODEC,
    VIDEO_TOO_LONG,
    VIDEO_TOO_SHORT,
    is_supported_code,
    sanitize_error,
)
from app.analysis.stages.exercise_detection import (
    ClassifierScore,
    ExerciseDetectionService,
    StaticExerciseClassifier,
)
from app.analysis.stages.frame_quality import (
    QUALITY_METRICS,
    FrameQualityService,
    FrameSignals,
    StaticFramePixelSource,
)
from app.analysis.stages.pose_confidence_validator import PoseConfidenceValidator
from app.analysis.stages.pose_extraction import PoseExtractionService


# ── The ten canonical codes documented in Req 15.2 ────────────────────────
_CANONICAL_CODES = (
    CORRUPTED_VIDEO,
    UNSUPPORTED_CODEC,
    VIDEO_TOO_SHORT,
    VIDEO_TOO_LONG,
    EXERCISE_NOT_RECOGNIZED,
    MULTIPLE_PEOPLE,
    BODY_NOT_VISIBLE,
    CAMERA_TOO_DARK,
    CAMERA_SHAKING,
    LOW_CONFIDENCE,
)


def _meta() -> VideoMeta:
    return VideoMeta(
        container_format="mp4",
        codec="h264",
        duration_sec=5.0,
        width=1080,
        height=1920,
        fps=30.0,
        size_bytes=1_000_000,
        orientation="portrait",
    )


def _assert_well_formed(err: StructuredError, expected_code: str, expected_stage: str) -> None:
    """Assert a StructuredError is well-formed, maps to the expected stable
    code, and sanitizes to exactly {code, message} with no internal detail."""
    assert err is not None
    # Maps to the documented stable code, which is one of the ten supported.
    assert err.code == expected_code
    assert is_supported_code(err.code)
    assert err.code in SUPPORTED_ERROR_CODES
    # Non-empty stable code and a human-readable (non-blank) message (Req 15.1).
    assert err.code and err.code.strip()
    assert err.message and err.message.strip()
    # Originating stage is recorded (Req 15.1).
    assert err.stage == expected_stage
    # Sanitization surfaces ONLY code + message; stage/details never cross the
    # boundary (Req 15.6).
    sanitized = sanitize_error(err)
    assert set(sanitized.keys()) == {"code", "message"}
    assert sanitized["code"] == err.code
    assert sanitized["message"] == err.message
    assert "stage" not in sanitized
    assert "details" not in sanitized


# ──────────────────────────────────────────────────────────────────────────
# Canonical supported-code set (Req 15.2)
# ──────────────────────────────────────────────────────────────────────────

def test_supported_error_codes_are_exactly_the_ten_canonical_codes():
    assert SUPPORTED_ERROR_CODES == frozenset(_CANONICAL_CODES)
    assert len(SUPPORTED_ERROR_CODES) == 10


@given(code=st.sampled_from(_CANONICAL_CODES))
@settings(max_examples=100)
def test_is_supported_code_identifies_every_canonical_code(code: str):
    # Feature: ai-exercise-analysis, Property 19: Condition-to-error-code
    # mapping with well-formed structured errors
    assert is_supported_code(code) is True


# ──────────────────────────────────────────────────────────────────────────
# Core property: sanitize_error surfaces only {code, message}; is_supported_code
# tracks membership exactly; generated structured errors stay well-formed.
# ──────────────────────────────────────────────────────────────────────────

_codes = st.one_of(
    st.sampled_from(_CANONICAL_CODES),
    st.text(min_size=1, max_size=24).filter(lambda s: s.strip() != ""),
)
_messages = st.text(min_size=1, max_size=80).filter(lambda s: s.strip() != "")
_stages = st.sampled_from(
    [
        "video_validation",
        "frame_quality",
        "exercise_detection",
        "pose_extraction",
        "pose_confidence_validation",
        "landmark_validation",
    ]
)


def _structured_error_strategy():
    leaf = st.builds(
        StructuredError,
        code=_codes,
        message=_messages,
        stage=_stages,
        details=st.just([]),
    )
    return st.recursive(
        leaf,
        lambda children: st.builds(
            StructuredError,
            code=_codes,
            message=_messages,
            stage=_stages,
            details=st.lists(children, max_size=3),
        ),
        max_leaves=5,
    )


# Feature: ai-exercise-analysis, Property 19: Condition-to-error-code mapping
# with well-formed structured errors
@given(err=_structured_error_strategy())
@settings(max_examples=200)
def test_sanitize_error_surfaces_only_code_and_message(err: StructuredError):
    # Generated errors are well-formed: non-empty code, human-readable message,
    # originating stage (Req 15.1).
    assert err.code and err.code.strip()
    assert err.message and err.message.strip()
    assert err.stage and err.stage.strip()

    # sanitize_error drops stage, details, and every other internal field,
    # surfacing exactly {code, message} (Req 15.6).
    sanitized = sanitize_error(err)
    assert set(sanitized.keys()) == {"code", "message"}
    assert sanitized["code"] == err.code
    assert sanitized["message"] == err.message
    assert "stage" not in sanitized
    assert "details" not in sanitized

    # is_supported_code tracks membership of the canonical set exactly.
    assert is_supported_code(err.code) == (err.code in SUPPORTED_ERROR_CODES)


# ──────────────────────────────────────────────────────────────────────────
# Frame_Quality_Service condition mappings (Req 4.5, 15.3, 15.4)
# ──────────────────────────────────────────────────────────────────────────

# Feature: ai-exercise-analysis, Property 19: Condition-to-error-code mapping
# with well-formed structured errors
@given(
    n_frames=st.integers(min_value=1, max_value=5),
    visible_keypoints=st.floats(min_value=0.0, max_value=0.49),
)
@settings(max_examples=100)
def test_all_frames_discarded_visibility_dominant_maps_to_body_not_visible(
    n_frames: int, visible_keypoints: float
):
    frames = [Frame(index=i, timestamp_ms=float(i * 100)) for i in range(n_frames)]
    # Every metric good EXCEPT body visibility, so visibility is the sole (and
    # therefore dominant) discard cause and every frame is dropped (Req 4.5).
    signals = FrameSignals(
        sharpness=300.0,
        mean_luminance=200.0,
        luminance_std=90.0,
        motion_magnitude=0.0,
        global_shift=0.0,
        visible_keypoints=visible_keypoints,
        occluded_fraction=0.0,
    )
    source = StaticFramePixelSource({f.index: signals for f in frames})
    result = asyncio.run(
        FrameQualityService(source).run(FrameSet(frames=frames, source_meta=_meta()))
    )

    assert result.success is False
    assert result.output is None
    _assert_well_formed(result.error, BODY_NOT_VISIBLE, "frame_quality")


# Feature: ai-exercise-analysis, Property 19: Condition-to-error-code mapping
# with well-formed structured errors
@given(
    n_frames=st.integers(min_value=1, max_value=5),
    mean_luminance=st.floats(min_value=0.0, max_value=100.0),
)
@settings(max_examples=100)
def test_retained_brightness_below_minimum_maps_to_camera_too_dark(
    n_frames: int, mean_luminance: float
):
    frames = [Frame(index=i, timestamp_ms=float(i * 100)) for i in range(n_frames)]
    # brightness score = mean_luminance / 255; with mean_luminance <= 100 the
    # score is < 0.4, below the min_brightness gate of 0.5 below.
    signals = FrameSignals(
        sharpness=300.0,
        mean_luminance=mean_luminance,
        luminance_std=90.0,
        motion_magnitude=0.0,
        global_shift=0.0,
        visible_keypoints=1.0,
        occluded_fraction=0.0,
    )
    source = StaticFramePixelSource({f.index: signals for f in frames})
    # Thresholds at 0 so frames are retained; gate on the retained-mean brightness.
    thresholds = {m: 0.0 for m in QUALITY_METRICS}
    stage = FrameQualityService(source, quality_thresholds=thresholds, min_brightness=0.5)
    result = asyncio.run(stage.run(FrameSet(frames=frames, source_meta=_meta())))

    assert result.success is False
    _assert_well_formed(result.error, CAMERA_TOO_DARK, "frame_quality")


# Feature: ai-exercise-analysis, Property 19: Condition-to-error-code mapping
# with well-formed structured errors
@given(
    n_frames=st.integers(min_value=1, max_value=5),
    global_shift=st.floats(min_value=5.0, max_value=19.0),
)
@settings(max_examples=100)
def test_retained_shake_above_maximum_maps_to_camera_shaking(
    n_frames: int, global_shift: float
):
    frames = [Frame(index=i, timestamp_ms=float(i * 100)) for i in range(n_frames)]
    # raw shake = global_shift / 20; with global_shift in [5, 19] shake is in
    # [0.25, 0.95], above the max_camera_shake gate of 0.2. Brightness is high so
    # the (earlier) brightness gate passes and shake is the triggered cause.
    signals = FrameSignals(
        sharpness=300.0,
        mean_luminance=200.0,
        luminance_std=90.0,
        motion_magnitude=0.0,
        global_shift=global_shift,
        visible_keypoints=1.0,
        occluded_fraction=0.0,
    )
    source = StaticFramePixelSource({f.index: signals for f in frames})
    thresholds = {m: 0.0 for m in QUALITY_METRICS}
    stage = FrameQualityService(source, quality_thresholds=thresholds, max_camera_shake=0.2)
    result = asyncio.run(stage.run(FrameSet(frames=frames, source_meta=_meta())))

    assert result.success is False
    _assert_well_formed(result.error, CAMERA_SHAKING, "frame_quality")


# ──────────────────────────────────────────────────────────────────────────
# Exercise_Detection_Service condition mapping (Req 6.3)
# ──────────────────────────────────────────────────────────────────────────

# Feature: ai-exercise-analysis, Property 19: Condition-to-error-code mapping
# with well-formed structured errors
@given(
    confidences=st.lists(
        st.floats(min_value=0.0, max_value=0.49), min_size=0, max_size=4
    ),
)
@settings(max_examples=100)
def test_top_detection_confidence_below_threshold_maps_to_not_recognized(
    confidences: list,
):
    candidates = [
        ClassifierScore(exercise_id=f"ex_{i}", confidence=c)
        for i, c in enumerate(confidences)
    ]
    classifier = StaticExerciseClassifier(candidates)
    # Threshold above every generated confidence (and no candidates at all) →
    # nothing clears the gate (Req 6.3).
    stage = ExerciseDetectionService(classifier, confidence_min=0.5)
    result = asyncio.run(stage.run(KeyFrames(frames=[], source_meta=_meta())))

    assert result.success is False
    _assert_well_formed(result.error, EXERCISE_NOT_RECOGNIZED, "exercise_detection")


# ──────────────────────────────────────────────────────────────────────────
# Pose_Extraction_Service condition mapping (Req 7.6)
# ──────────────────────────────────────────────────────────────────────────

class _MultiPersonEngine(PoseEngine):
    """Available test engine that reports more than one detected person."""

    name = "test_multi_person"
    version = "test-0.0.0"

    def __init__(self, person_count: int) -> None:
        self._person_count = person_count

    async def is_available(self) -> bool:
        return True

    async def extract(self, frames):
        return PoseEngineResult(frames=[], person_count=self._person_count, available=True)


# Feature: ai-exercise-analysis, Property 19: Condition-to-error-code mapping
# with well-formed structured errors
@given(person_count=st.integers(min_value=2, max_value=10))
@settings(max_examples=100)
def test_multiple_people_maps_to_multiple_people(person_count: int):
    engine = _MultiPersonEngine(person_count)
    stage = PoseExtractionService(
        registry={engine.name: engine}, active_engine=engine.name
    )
    result = asyncio.run(stage.run(KeyFrames(frames=[], source_meta=_meta())))

    assert result.success is False
    _assert_well_formed(result.error, MULTIPLE_PEOPLE, "pose_extraction")


# ──────────────────────────────────────────────────────────────────────────
# Pose_Confidence_Validator condition mapping (Req 21.3)
# ──────────────────────────────────────────────────────────────────────────

# Feature: ai-exercise-analysis, Property 19: Condition-to-error-code mapping
# with well-formed structured errors
@given(
    n_frames=st.integers(min_value=1, max_value=4),
    overall_confidence=st.floats(min_value=0.0, max_value=0.49),
)
@settings(max_examples=100)
def test_overall_confidence_below_threshold_maps_to_low_confidence(
    n_frames: int, overall_confidence: float
):
    # Each frame carries a high-confidence landmark (so it is not rejected by the
    # per-landmark filter) but a low per-frame overall_confidence, driving the
    # aggregate below the overall gate of 0.5 (Req 21.3).
    frames = [
        FrameLandmarks(
            timestamp_ms=float(i * 100),
            landmarks=[Landmark(x=0.5, y=0.5, z=0.0, confidence=0.9)],
            overall_confidence=overall_confidence,
        )
        for i in range(n_frames)
    ]
    data = Landmarks(frames=frames, source_meta=_meta(), pose_engine="test")
    stage = PoseConfidenceValidator(
        landmark_confidence_min=0.3, overall_confidence_min=0.5
    )
    result = asyncio.run(stage.run(data))

    assert result.success is False
    assert result.output is None
    _assert_well_formed(result.error, LOW_CONFIDENCE, "pose_confidence_validation")


# ──────────────────────────────────────────────────────────────────────────
# Video_Validation_Service condition mappings (Req 2.6–2.9 / 15.2)
# ──────────────────────────────────────────────────────────────────────────

def _base_valid_meta_kwargs() -> dict:
    return dict(
        container_format="mp4",
        codec="h264",
        duration_sec=5.0,
        width=1080,
        height=1920,
        fps=30.0,
        size_bytes=1_000_000,
        orientation="unknown",
    )


def _run_video_validation(**overrides):
    from app.analysis.stages.video_validation import VideoValidationService

    kwargs = _base_valid_meta_kwargs()
    kwargs.update(overrides)
    return asyncio.run(VideoValidationService().run(VideoMeta(**kwargs)))


# Feature: ai-exercise-analysis, Property 19: Condition-to-error-code mapping
# with well-formed structured errors
@given(blank=st.sampled_from(["", "   ", "\t"]))
@settings(max_examples=100)
def test_undecodable_video_maps_to_corrupted_video(blank: str):
    # An unidentifiable codec marks the video undecodable (Req 2.6); every other
    # field is valid so CORRUPTED_VIDEO is the sole top-level code.
    result = _run_video_validation(codec=blank)
    assert result.success is False
    _assert_well_formed(result.error, CORRUPTED_VIDEO, "video_validation")


# Feature: ai-exercise-analysis, Property 19: Condition-to-error-code mapping
# with well-formed structured errors
@given(codec=st.sampled_from(["vp9", "av1", "mpeg4", "vp8", "theora"]))
@settings(max_examples=100)
def test_unsupported_codec_maps_to_unsupported_codec(codec: str):
    # Only the codec violates a constraint, so it surfaces as the single
    # top-level code (Req 2.7).
    result = _run_video_validation(codec=codec)
    assert result.success is False
    _assert_well_formed(result.error, UNSUPPORTED_CODEC, "video_validation")


# Feature: ai-exercise-analysis, Property 19: Condition-to-error-code mapping
# with well-formed structured errors
@given(duration=st.floats(min_value=0.0, max_value=1.99))
@settings(max_examples=100)
def test_duration_below_minimum_maps_to_video_too_short(duration: float):
    result = _run_video_validation(duration_sec=duration)
    assert result.success is False
    _assert_well_formed(result.error, VIDEO_TOO_SHORT, "video_validation")


# Feature: ai-exercise-analysis, Property 19: Condition-to-error-code mapping
# with well-formed structured errors
@given(duration=st.floats(min_value=60.01, max_value=120.0))
@settings(max_examples=100)
def test_duration_above_maximum_maps_to_video_too_long(duration: float):
    result = _run_video_validation(duration_sec=duration)
    assert result.success is False
    _assert_well_formed(result.error, VIDEO_TOO_LONG, "video_validation")
