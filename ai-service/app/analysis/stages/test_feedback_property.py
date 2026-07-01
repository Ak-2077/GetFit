"""
Property-based test for the Feedback_Service
(app/analysis/stages/feedback.py).

Covers design Property 13 — "Feedback result is structurally complete with
confidence flagging" — using Hypothesis with a minimum of 100 iterations.

Validates: Requirements 10.4, 11.1, 11.2, 11.4, 17.1
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import (
    AnalysisResult,
    MovementTimeline,
    ObjectiveMetrics,
    ReasoningOutput,
    RepetitionSummary,
)
from app.analysis.stages.feedback import (
    LOW_CONFIDENCE_STATEMENT,
    FeedbackInput,
    FeedbackService,
)

# A fixed low-confidence threshold so expected behavior is fully deterministic
# in-test (the stage defaults this to settings.REASONING_CONFIDENCE_MIN).
_THRESHOLD = 0.5


# ── Generators ───────────────────────────────────────────────────────────
# Smart generators that vary every contributing Confidence_Score across and
# around the threshold (metrics.confidence, reasoning.confidence,
# repetition_summary.movement_consistency, and the optional fused
# overall_confidence), plus the reasoning low_confidence flag — so both the
# flagged and unflagged branches of Req 11.4 / 10.4 are exercised.

_CONFIDENCE = st.floats(
    min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False
)

# A short list of free-text feedback strings (kept non-empty often so the
# copy-through of the Req 11.2 qualitative fields is observable).
_TEXT_LIST = st.lists(st.text(max_size=20), max_size=4)

_JOINT_MAP = st.dictionaries(
    keys=st.sampled_from(["knee", "hip", "elbow", "shoulder", "ankle"]),
    values=st.floats(
        min_value=0.0, max_value=180.0, allow_nan=False, allow_infinity=False
    ),
    max_size=5,
)

_FINITE = st.floats(
    min_value=-1000.0, max_value=1000.0, allow_nan=False, allow_infinity=False
)


@st.composite
def objective_metrics(draw) -> ObjectiveMetrics:
    return ObjectiveMetrics(
        joint_angles=draw(_JOINT_MAP),
        bar_path=draw(st.lists(st.lists(_FINITE, min_size=2, max_size=2), max_size=4)),
        depth=draw(_FINITE),
        range_of_motion=draw(_JOINT_MAP),
        tempo=draw(_FINITE),
        symmetry=draw(_CONFIDENCE),
        center_of_mass=draw(st.lists(_FINITE, min_size=2, max_size=2)),
        balance=draw(_CONFIDENCE),
        confidence=draw(_CONFIDENCE),
    )


@st.composite
def reasoning_outputs(draw) -> ReasoningOutput:
    return ReasoningOutput(
        strengths=draw(_TEXT_LIST),
        mistakes=draw(_TEXT_LIST),
        corrections=draw(_TEXT_LIST),
        safety_warnings=draw(_TEXT_LIST),
        improvement_tips=draw(_TEXT_LIST),
        training_advice=draw(_TEXT_LIST),
        confidence=draw(_CONFIDENCE),
        low_confidence=draw(st.booleans()),
    )


@st.composite
def repetition_summaries(draw) -> RepetitionSummary:
    return RepetitionSummary(
        rep_count=draw(st.integers(min_value=0, max_value=20)),
        phase_timestamps=[],
        avg_rep_duration_ms=draw(
            st.floats(min_value=0.0, max_value=10_000.0, allow_nan=False, allow_infinity=False)
        ),
        movement_consistency=draw(_CONFIDENCE),
    )


@st.composite
def feedback_inputs(draw) -> FeedbackInput:
    return FeedbackInput(
        reasoning=draw(reasoning_outputs()),
        metrics=draw(objective_metrics()),
        timeline=MovementTimeline(entries=[]),
        exercise_id=draw(st.text(max_size=12)),
        repetition_summary=draw(repetition_summaries()),
        overall_confidence=draw(st.one_of(st.none(), _CONFIDENCE)),
    )


# Required field sets straight from the contract / requirements.
_SCORE_FIELDS = {  # Req 11.1
    "overall_score",
    "movement_score",
    "range_of_motion",
    "tempo",
    "stability",
    "symmetry",
    "joint_alignment",
}
_QUALITATIVE_FIELDS = {  # Req 11.2
    "strengths",
    "mistakes",
    "corrections",
    "safety_warnings",
    "improvement_tips",
    "training_advice",
}
_VERSION_FIELDS = {  # Req 29.1 metadata
    "analysisVersion",
    "poseEngineVersion",
    "visionModelVersion",
    "reasoningModelVersion",
    "pipelineVersion",
}


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _expected_low_confidence(data: FeedbackInput) -> bool:
    """Re-derive the expected low-confidence decision from the inputs."""
    metric_c = _clamp01(data.metrics.confidence)
    reasoning_c = _clamp01(data.reasoning.confidence)
    consistency = _clamp01(data.repetition_summary.movement_consistency)
    if data.overall_confidence is None:
        overall = min(metric_c, reasoning_c, consistency)
    else:
        overall = _clamp01(data.overall_confidence)
    contributing = [metric_c, reasoning_c, consistency, overall]
    return data.reasoning.low_confidence or any(c < _THRESHOLD for c in contributing)


def _run(data: FeedbackInput) -> AnalysisResult:
    stage = FeedbackService(confidence_min=_THRESHOLD)
    result = asyncio.run(stage.run(data))
    assert result.success is True
    assert result.error is None
    assert result.output is not None
    return result.output


# ── Property 13 ─────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 13: Feedback result is structurally
# complete with confidence flagging
@given(data=feedback_inputs())
@settings(max_examples=200)
def test_feedback_structurally_complete_with_confidence_flagging(data: FeedbackInput):
    result = _run(data)
    dumped = result.model_dump()

    # Req 11.1 + 11.2 + 29.1 — every required field is present and populated.
    assert _SCORE_FIELDS.issubset(dumped.keys())
    assert _QUALITATIVE_FIELDS.issubset(dumped.keys())
    assert _VERSION_FIELDS.issubset(dumped.keys())
    for field in _SCORE_FIELDS | _QUALITATIVE_FIELDS | _VERSION_FIELDS:
        assert dumped[field] is not None

    # Qualitative fields are list-typed; version fields are non-empty strings.
    for field in _QUALITATIVE_FIELDS:
        assert isinstance(dumped[field], list)
    for field in _VERSION_FIELDS:
        assert isinstance(dumped[field], str)
        assert dumped[field] != ""

    # Req 11.4 / 10.4 — low_confidence is True iff any contributing confidence
    # is below threshold or the reasoning output was flagged low confidence.
    assert result.low_confidence is _expected_low_confidence(data)

    # Req 11.4 — when low confidence, the explicit statement is surfaced in
    # safety_warnings (exactly once); otherwise it is absent.
    if result.low_confidence:
        assert LOW_CONFIDENCE_STATEMENT in result.safety_warnings
        assert result.safety_warnings.count(LOW_CONFIDENCE_STATEMENT) == 1
    else:
        assert LOW_CONFIDENCE_STATEMENT not in result.safety_warnings

    # Overall confidence is a bounded probability in [0, 1].
    assert 0.0 <= result.overall_confidence <= 1.0
