"""
Property tests — Property 62: Existing data contracts are preserved additively
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Task 32.2 · Validates: Requirements 52.3, 52.7

Design (design.md "Property 62"):

    For any Analysis_Result produced without the V2 additive fields, its
    serialized shape is exactly the Version 1 schema (the V2 fields
    `review_status` and `score_explanations` are optional and absent), so
    existing consumers and existing tests observe an unchanged contract.

These Hypothesis property tests drive the REAL V1 `AnalysisResult` contract
(`app/analysis/contracts.py`) — including its `_drop_v2_defaults_at_v1_shape`
wrap serializer — over a broad space of valid V1 field values:

  • A result built with ONLY V1 fields serializes (`model_dump()` /
    `model_dump_json()`) to EXACTLY the V1 field set — none of the additive V2
    keys (`review_status`, `score_explanations`) appear (Req 52.3, 52.7).
  • When the additive V2 fields ARE set, every V1 field is byte-identical to the
    V1-only serialization and ONLY the additive keys appear in addition
    (additivity: V2 changes nothing about the V1 shape) (Req 52.3).
  • A parse → dump round-trip preserves the V1 fields exactly.

If any assertion fails, the V2 additions have stopped being additive — that is
a REAL Req 52 regression, not a reason to loosen the test.

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest \\
        app/analysis_v2/test_additive_contract_property.py -q
"""

from __future__ import annotations

import json

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis import contracts as c
from app.analysis.contracts import AnalysisResult, ObjectiveMetrics, RepetitionSummary
from app.analysis_v2.models_v2 import ReviewStatus, ScoreExplanation

# Minimum iterations mandated for these property tests (task requirement: >= 100).
_MIN_ITER = 200


# The exact V1 base field set (25 fields), independent of the V2 additions.
# This is the contract existing V1 consumers/tests observe.
_V1_FIELDS: frozenset[str] = frozenset({
    "exercise_id", "analysis_date", "overall_score",
    "movement_score", "range_of_motion", "tempo", "stability", "symmetry",
    "joint_alignment",
    "strengths", "mistakes", "corrections", "safety_warnings",
    "improvement_tips", "training_advice",
    "movement_metrics", "repetition_summary",
    "overall_confidence", "low_confidence",
    "user_corrections",
    "analysisVersion", "poseEngineVersion", "visionModelVersion",
    "reasoningModelVersion", "pipelineVersion",
})

# The strictly-additive V2 fields (Req 52.3, 52.5).
_V2_ADDITIVE_FIELDS: frozenset[str] = frozenset({"review_status", "score_explanations"})


# ── Smart generators — constrained to the valid V1 input space ───────────────

_finite = st.floats(min_value=-1e6, max_value=1e6, allow_nan=False, allow_infinity=False)
_nonneg = st.floats(min_value=0.0, max_value=1e6, allow_nan=False, allow_infinity=False)
_unit = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
_ids = st.text(min_size=1, max_size=20)
_labels = st.text(min_size=1, max_size=12)
_str_lists = st.lists(st.text(max_size=24), max_size=5)
_float_map = st.dictionaries(_labels, _finite, max_size=4)


@st.composite
def _objective_metrics(draw) -> ObjectiveMetrics:
    return ObjectiveMetrics(
        joint_angles=draw(_float_map),
        bar_path=draw(st.lists(st.lists(_finite, min_size=2, max_size=2), max_size=4)),
        depth=draw(_finite),
        range_of_motion=draw(_float_map),
        tempo=draw(_nonneg),
        symmetry=draw(_unit),
        center_of_mass=draw(st.lists(_finite, min_size=2, max_size=3)),
        balance=draw(_unit),
        confidence=draw(_unit),
    )


@st.composite
def _rep_summary(draw) -> RepetitionSummary:
    return RepetitionSummary(
        rep_count=draw(st.integers(min_value=0, max_value=500)),
        phase_timestamps=[],
        avg_rep_duration_ms=draw(_nonneg),
        movement_consistency=draw(_unit),
    )


@st.composite
def _v1_kwargs(draw) -> dict:
    """A fully-populated set of ONLY the V1 `AnalysisResult` fields."""
    return dict(
        exercise_id=draw(_ids),
        analysis_date=draw(_ids),
        overall_score=draw(_finite),
        movement_score=draw(_finite),
        range_of_motion=draw(_float_map),
        tempo=draw(_nonneg),
        stability=draw(_unit),
        symmetry=draw(_unit),
        joint_alignment=draw(_float_map),
        strengths=draw(_str_lists),
        mistakes=draw(_str_lists),
        corrections=draw(_str_lists),
        safety_warnings=draw(_str_lists),
        improvement_tips=draw(_str_lists),
        training_advice=draw(_str_lists),
        movement_metrics=draw(_objective_metrics()),
        repetition_summary=draw(_rep_summary()),
        overall_confidence=draw(_unit),
        low_confidence=draw(st.booleans()),
        user_corrections=draw(st.lists(st.just({"note": "x"}), max_size=3)),
        analysisVersion=draw(_ids),
        poseEngineVersion=draw(_ids),
        visionModelVersion=draw(_ids),
        reasoningModelVersion=draw(_ids),
        pipelineVersion=draw(_ids),
    )


@st.composite
def _score_explanations(draw) -> list[ScoreExplanation]:
    """A non-empty list of valid `ScoreExplanation`s (factor weights in [0,100])."""
    weight = st.floats(min_value=0.0, max_value=100.0, allow_nan=False, allow_infinity=False)
    factor_names = st.sampled_from(
        ["range_of_motion", "tempo", "balance", "stability", "symmetry"]
    )
    explanation = st.builds(
        ScoreExplanation,
        score_name=st.sampled_from(["movement", "stability", "symmetry", "tempo"]),
        factors=st.dictionaries(factor_names, weight, min_size=1, max_size=5),
    )
    return draw(st.lists(explanation, min_size=1, max_size=3))


# ══════════════════════════════════════════════════════════════════════════
# Property 62 — a V1-only result serializes to EXACTLY the V1 shape
# Feature: ai-exercise-analysis, Property 62: Existing data contracts are
# preserved additively.
# Validates: Requirements 52.3, 52.7
# ══════════════════════════════════════════════════════════════════════════

@settings(max_examples=_MIN_ITER, deadline=None)
@given(kwargs=_v1_kwargs())
def test_v1_only_result_serializes_to_exact_v1_shape(kwargs: dict) -> None:
    """`model_dump()` of a result built without V2 fields has EXACTLY the V1
    key set — the additive V2 keys are omitted entirely (Req 52.3, 52.7)."""
    result = AnalysisResult(**kwargs)
    dumped = result.model_dump()

    assert set(dumped.keys()) == set(_V1_FIELDS), (
        f"V1-shape drifted: extra={set(dumped) - _V1_FIELDS}, "
        f"missing={_V1_FIELDS - set(dumped)} (Req 52.3)"
    )
    for additive in _V2_ADDITIVE_FIELDS:
        assert additive not in dumped, (
            f"additive V2 key {additive!r} leaked into V1 shape (Req 52.7)"
        )


@settings(max_examples=_MIN_ITER, deadline=None)
@given(kwargs=_v1_kwargs())
def test_v1_only_result_json_has_exact_v1_shape(kwargs: dict) -> None:
    """`model_dump_json()` of a V1-only result carries EXACTLY the V1 keys on
    the wire — no additive V2 keys (Req 52.3, 52.7)."""
    result = AnalysisResult(**kwargs)
    payload = json.loads(result.model_dump_json())

    assert set(payload.keys()) == set(_V1_FIELDS)
    assert not (_V2_ADDITIVE_FIELDS & set(payload.keys()))


# ══════════════════════════════════════════════════════════════════════════
# Property 62 — setting the V2 fields leaves the V1 fields byte-identical
# Validates: Requirements 52.3
# ══════════════════════════════════════════════════════════════════════════

@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    kwargs=_v1_kwargs(),
    review_status=st.sampled_from(list(ReviewStatus)),
    explanations=_score_explanations(),
)
def test_setting_v2_fields_is_purely_additive(
    kwargs: dict,
    review_status: ReviewStatus,
    explanations: list[ScoreExplanation],
) -> None:
    """A result WITH the V2 fields set serializes every V1 field byte-identically
    to the V1-only result and adds ONLY the additive keys (Req 52.3)."""
    v1_only = AnalysisResult(**kwargs).model_dump()
    with_v2 = AnalysisResult(
        **kwargs, review_status=review_status, score_explanations=explanations
    ).model_dump()

    # The additive keys — and ONLY the additive keys — are new.
    assert set(with_v2.keys()) - set(v1_only.keys()) == set(_V2_ADDITIVE_FIELDS)

    # Every V1 field is byte-identical: V2 changed nothing about the V1 shape.
    for field in _V1_FIELDS:
        assert with_v2[field] == v1_only[field], (
            f"V1 field {field!r} changed when V2 fields were set — not additive "
            f"(Req 52.3)"
        )


# ══════════════════════════════════════════════════════════════════════════
# Property 62 — parse → dump round-trip preserves the V1 fields exactly
# Validates: Requirements 52.7
# ══════════════════════════════════════════════════════════════════════════

@settings(max_examples=_MIN_ITER, deadline=None)
@given(kwargs=_v1_kwargs())
def test_v1_shape_round_trips_exactly(kwargs: dict) -> None:
    """Dumping a V1-only result and re-parsing it yields the identical V1 shape
    (existing consumers observe an unchanged contract) (Req 52.7)."""
    original = AnalysisResult(**kwargs)
    dumped = original.model_dump()

    reparsed = AnalysisResult.model_validate(dumped)
    redumped = reparsed.model_dump()

    assert set(redumped.keys()) == set(_V1_FIELDS)
    assert redumped == dumped  # byte-stable across the round-trip


@settings(max_examples=_MIN_ITER, deadline=None)
@given(kwargs=_v1_kwargs())
def test_v1_shape_json_round_trips_exactly(kwargs: dict) -> None:
    """JSON dump → parse → JSON dump is byte-stable and keeps the V1 shape."""
    original = AnalysisResult(**kwargs)
    wire = original.model_dump_json()

    reparsed = AnalysisResult.model_validate_json(wire)
    assert reparsed.model_dump_json() == wire
    assert set(json.loads(wire).keys()) == set(_V1_FIELDS)


# ── Guard: the V1 field snapshot itself matches the live contract ────────────

def test_v1_field_snapshot_matches_contract() -> None:
    """The pinned V1 field set equals the live contract minus the V2 additions,
    so this test file cannot silently drift out of sync (Req 52.3)."""
    live = set(c.AnalysisResult.model_fields.keys())
    assert live - _V2_ADDITIVE_FIELDS == set(_V1_FIELDS)
    assert _V2_ADDITIVE_FIELDS <= live
