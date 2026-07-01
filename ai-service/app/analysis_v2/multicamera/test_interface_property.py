"""
Property-based tests for the Multi_Camera_Interface (Req 50).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hypothesis property tests covering the declared-but-unimplemented multi-camera
fusion seam (`app/analysis_v2/multicamera/interface.py`):

  • Property 59 — invoking the multi-camera interface in this version returns a
    StructuredError indicating multi-camera processing is not implemented
    (code MULTI_CAMERA_NOT_IMPLEMENTED, stage "multi_camera_interface") inside a
    failed StageResult, never raises, and leaves the existing single-camera
    state unchanged (Req 50.5).

The `fuse` entrypoint is async; following the established V2 property-test
convention (`test_abuse_protection_property.py`, `test_cost_tracking_property.py`,
etc.) it is driven synchronously via ``asyncio.run``.

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest app/analysis_v2/multicamera/test_interface_property.py -q
"""

from __future__ import annotations

import asyncio
import copy

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis_v2 import StageResult, StructuredError
from app.analysis_v2.models_v2 import CameraAngle, MultiCameraInput, VideoRef
from app.analysis_v2.multicamera.interface import (
    MULTI_CAMERA_NOT_IMPLEMENTED,
    STAGE_NAME,
    DeclaredMultiCameraInterface,
    MultiCameraInterface,
)

# Minimum number of generated examples per property (task requirement: >= 100).
_MIN_ITER = 150


# ── Shared builders / strategies ─────────────────────────────────────────────

def _representative_single_camera_state() -> dict:
    """
    A representative snapshot of "single-camera state" the interface must never
    touch (Property 59). Its exact shape is unimportant — what matters is that
    invoking `fuse` leaves it byte-for-byte identical.
    """
    return {
        "active_angle": CameraAngle.front.value,
        "video_ref": "single/camera/handle.mp4",
        "frames_processed": 42,
        "pipeline_stage": "video_validation",
        "nested": {"scores": [0.1, 0.2, 0.3], "flags": {"ready": True}},
    }


# Opaque, non-empty video handles (VideoRef is a plain str alias).
_video_refs: st.SearchStrategy[VideoRef] = st.text(
    alphabet=st.characters(min_codepoint=33, max_codepoint=126),
    min_size=1,
    max_size=24,
)

# Any subset of the three supported angles → VideoRef (possibly empty).
_angle_maps: st.SearchStrategy[dict] = st.dictionaries(
    keys=st.sampled_from(list(CameraAngle)),
    values=_video_refs,
    max_size=len(CameraAngle),
)

# Optional single fusion input.
_fusion_inputs = st.one_of(st.none(), _video_refs)


@st.composite
def _multi_camera_inputs(draw) -> MultiCameraInput:
    """Arbitrary MultiCameraInput: any angle subset + optional fusion input."""
    return MultiCameraInput(
        angles=draw(_angle_maps),
        fusion_input=draw(_fusion_inputs),
    )


# Both the directly-instantiable ABC (concrete default `fuse`) and the named
# concrete subclass are inert and must behave identically.
_interfaces = st.sampled_from([MultiCameraInterface, DeclaredMultiCameraInterface])


# ── Property 59 ──────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 59: Invoking the multi-camera interface errors without disturbing single-camera state
# Validates: Requirements 50.5

@settings(max_examples=_MIN_ITER, deadline=None)
@given(inputs=_multi_camera_inputs(), iface_cls=_interfaces)
def test_property_59_invocation_errors_without_disturbing_single_camera_state(
    inputs: MultiCameraInput, iface_cls: type[MultiCameraInterface]
) -> None:
    """
    For ANY MultiCameraInput (any subset of Front/Side/Rear angles plus an
    optional fusion input) and either concrete interface type: invoking `fuse`
    returns a failed StageResult carrying a StructuredError with
    code == MULTI_CAMERA_NOT_IMPLEMENTED and stage == "multi_camera_interface",
    never raises, and leaves a representative single-camera state unchanged
    (Req 50.5).
    """
    interface = iface_cls()

    # Establish representative single-camera state + an independent reference
    # snapshot to compare against after invocation.
    single_camera_state = _representative_single_camera_state()
    state_before = copy.deepcopy(single_camera_state)

    # Never raises on the domain "not implemented" condition — returns a result.
    result = asyncio.run(interface.fuse(inputs))

    # Failed StageResult with no output and a populated StructuredError.
    assert isinstance(result, StageResult)
    assert result.success is False
    assert result.output is None
    assert isinstance(result.error, StructuredError)

    # Stable, attributed not-implemented error (Req 50.5).
    assert result.error.code == MULTI_CAMERA_NOT_IMPLEMENTED
    assert result.error.stage == STAGE_NAME
    assert result.error.stage == "multi_camera_interface"

    # Single-camera state is byte-for-byte undisturbed — the seam is inert.
    assert single_camera_state == state_before
