"""
Unit tests for the Reasoning_Service.

Covers the acceptance criteria of Requirement 10 and the LOW_CONFIDENCE gate of
Requirement 15.5:
  • 10.2 / 10.3 — the stage's input contract carries ONLY the Movement_Timeline
    and Objective_Metrics; there is no field through which raw video/frames could
    enter (privacy boundary is structural).
  • 10.4 — when the supporting Objective_Metrics confidence is below threshold,
    the produced output is marked low confidence but still returned.
  • 15.5 — when the overall analysis confidence is below threshold, the stage
    returns a Structured_Error with code `LOW_CONFIDENCE` and no output.
plus edge cases (confidence clamping, reasoner failure degradation).
"""

import asyncio

from app.analysis.contracts import (
    MovementTimeline,
    ObjectiveMetrics,
    ReasoningOutput,
)
from app.analysis.stages.reasoning import (
    ReasoningInput,
    ReasoningService,
    Reasoner,
    StaticReasoner,
)


def _metrics(confidence: float = 1.0) -> ObjectiveMetrics:
    """Build a minimal ObjectiveMetrics with a chosen supporting confidence."""
    return ObjectiveMetrics(
        joint_angles={"knee": 90.0},
        bar_path=[[0.0, 0.0]],
        depth=0.5,
        range_of_motion={"knee": 120.0},
        tempo=2.0,
        symmetry=0.9,
        center_of_mass=[0.5, 0.5],
        balance=0.8,
        confidence=confidence,
    )


def _timeline() -> MovementTimeline:
    return MovementTimeline(entries=[])


def _input(metrics_confidence: float = 1.0) -> ReasoningInput:
    return ReasoningInput(timeline=_timeline(), metrics=_metrics(metrics_confidence))


def _output(confidence: float = 1.0) -> ReasoningOutput:
    return ReasoningOutput(
        strengths=["solid depth"],
        mistakes=[],
        corrections=[],
        safety_warnings=[],
        improvement_tips=["brace harder"],
        training_advice=[],
        confidence=confidence,
    )


def _run(stage: ReasoningService, data: ReasoningInput):
    return asyncio.run(stage.run(data))


# ── Req 10.2 / 10.3: structural privacy boundary ──

def test_input_contract_carries_only_timeline_and_metrics():
    # The only analytical inputs are the timeline and metrics (Req 10.2); there
    # is deliberately no field for raw video, frames, or a video reference
    # (Req 10.3) — the privacy boundary is enforced by the schema itself.
    assert set(ReasoningInput.model_fields) == {"timeline", "metrics"}


# ── Req 10.4: low-confidence marking is non-fatal ──

def test_marks_low_confidence_when_supporting_metrics_below_threshold():
    stage = ReasoningService(
        StaticReasoner(_output(confidence=0.9)),
        reasoning_confidence_min=0.5,
        overall_confidence_min=0.3,
    )
    # Supporting metrics confidence (0.4) below reasoning_confidence_min (0.5)
    # but overall (min(0.4, 0.9)=0.4) above overall_confidence_min (0.3).
    result = _run(stage, _input(metrics_confidence=0.4))
    assert result.success is True
    assert result.output is not None
    assert result.output.low_confidence is True
    # The qualitative feedback is still returned.
    assert result.output.strengths == ["solid depth"]


def test_high_confidence_output_not_marked_low():
    stage = ReasoningService(
        StaticReasoner(_output(confidence=0.95)),
        reasoning_confidence_min=0.5,
        overall_confidence_min=0.3,
    )
    result = _run(stage, _input(metrics_confidence=0.9))
    assert result.success is True
    assert result.output.low_confidence is False
    assert result.output.confidence == 0.95


# ── Req 15.5: LOW_CONFIDENCE structured error is fatal ──

def test_emits_low_confidence_error_when_overall_below_threshold():
    stage = ReasoningService(
        StaticReasoner(_output(confidence=0.9)),
        reasoning_confidence_min=0.5,
        overall_confidence_min=0.5,
    )
    # Overall confidence = min(metrics 0.2, reasoning 0.9) = 0.2 < 0.5.
    result = _run(stage, _input(metrics_confidence=0.2))
    assert result.success is False
    assert result.output is None
    assert result.error is not None
    assert result.error.code == "LOW_CONFIDENCE"
    assert result.error.stage == "reasoning"


def test_low_reasoner_confidence_drives_overall_gate():
    # Even with strong metrics, a low reasoner self-confidence pulls the overall
    # (the min of the two) below threshold and trips the gate (Req 15.5).
    stage = ReasoningService(
        StaticReasoner(_output(confidence=0.1)),
        reasoning_confidence_min=0.5,
        overall_confidence_min=0.5,
    )
    result = _run(stage, _input(metrics_confidence=0.95))
    assert result.success is False
    assert result.error.code == "LOW_CONFIDENCE"


# ── Edge cases ──

def test_reasoner_confidence_is_clamped_into_unit_interval():
    # A seam reporting an out-of-range confidence is defensively clamped so the
    # output confidence stays within [0, 1].
    stage = ReasoningService(
        StaticReasoner(ReasoningOutput.model_construct(
            strengths=[], mistakes=[], corrections=[], safety_warnings=[],
            improvement_tips=[], training_advice=[], confidence=1.7,
            low_confidence=False,
        )),
        reasoning_confidence_min=0.5,
        overall_confidence_min=0.3,
    )
    result = _run(stage, _input(metrics_confidence=0.9))
    assert result.success is True
    assert result.output.confidence == 1.0


class _FailingReasoner(Reasoner):
    """A seam that degrades to zero confidence (mirrors model-failure path)."""

    async def reason(self, timeline, metrics):
        return ReasoningOutput(confidence=0.0)


def test_zero_confidence_reasoner_trips_low_confidence_gate():
    stage = ReasoningService(
        _FailingReasoner(),
        reasoning_confidence_min=0.5,
        overall_confidence_min=0.3,
    )
    result = _run(stage, _input(metrics_confidence=0.9))
    assert result.success is False
    assert result.error.code == "LOW_CONFIDENCE"
