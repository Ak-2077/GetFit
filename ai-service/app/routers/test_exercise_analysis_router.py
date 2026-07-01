"""
Integration tests for the Exercise Analysis router
(app/routers/exercise_analysis.py).

These exercise the HTTP surface end-to-end with FastAPI's TestClient against a
fresh `FastAPI()` app that mounts the real router. The default in-memory
Job_Queue_Adapter and poll Progress_Service (built once at module import) make
this testable without any external infrastructure.

Flow covered (Req 18.1, 18.2, 19.1, 19.8):
  1. POST /exercise-analysis/submit returns a job_id in state `queued` (Req 18.2,
     19.1) and seeds the first Progress_Event.
  2. GET /exercise-analysis/status/{job_id} reports the queued state plus the
     latest Progress_Event labelled "Uploading" (Req 19.8, 20.x).
  3. Driving the job through states via the same module-level `_queue`/`_progress`
     the worker would use (set_state → set_result) is reflected by subsequent
     status/result polls, terminating in `completed` carrying the AnalysisResult
     (Req 19.8, 19.5).
  4. Unknown job ids yield 404 on both status and result.
"""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.analysis.contracts import (
    AnalysisResult,
    ObjectiveMetrics,
    RepetitionSummary,
)
from app.analysis.jobs import JobState
from app.routers import exercise_analysis as router_module


# ── App / client fixtures ────────────────────────────────────────────────

@pytest.fixture()
def client() -> TestClient:
    """A TestClient over a fresh app mounting the real exercise-analysis router."""
    app = FastAPI()
    app.include_router(router_module.router)
    return TestClient(app)


def _run(coro):
    """Drive an async coroutine to completion (for simulating the worker)."""
    return asyncio.run(coro)


def _result(exercise_id: str = "squat") -> AnalysisResult:
    """Build a minimal, valid terminal AnalysisResult (Req 19.5)."""
    metrics = ObjectiveMetrics(
        joint_angles={"knee": 90.0},
        bar_path=[[0.5, 0.5]],
        depth=0.5,
        range_of_motion={"knee": 120.0},
        tempo=1.0,
        symmetry=0.9,
        center_of_mass=[0.5, 0.5],
        balance=0.9,
        confidence=0.9,
    )
    reps = RepetitionSummary(
        rep_count=3,
        phase_timestamps=[],
        avg_rep_duration_ms=1200.0,
        movement_consistency=0.85,
    )
    return AnalysisResult(
        exercise_id=exercise_id,
        analysis_date="2024-01-01T00:00:00+00:00",
        overall_score=88.0,
        movement_score=90.0,
        range_of_motion={"knee": 120.0},
        tempo=1.0,
        stability=0.9,
        symmetry=0.9,
        joint_alignment={"knee": 90.0},
        strengths=["good depth"],
        mistakes=[],
        corrections=[],
        safety_warnings=[],
        improvement_tips=[],
        training_advice=[],
        movement_metrics=metrics,
        repetition_summary=reps,
        overall_confidence=0.87,
        low_confidence=False,
        analysisVersion="1.0.0",
        poseEngineVersion="mediapipe-1",
        visionModelVersion="qwen-vl-1",
        reasoningModelVersion="llm-1",
        pipelineVersion="1.0.0",
    )


# ── Tests ────────────────────────────────────────────────────────────────

def test_submit_returns_job_id_in_queued_state(client: TestClient):
    """POST /submit enqueues a job and returns job_id + state queued (Req 18.2, 19.1)."""
    resp = client.post(
        "/exercise-analysis/submit",
        json={"video_url": "https://example.com/clip.mp4", "user_id": "u1"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["job_id"]
    assert body["state"] == JobState.queued.value


def test_submit_requires_a_video_reference(client: TestClient):
    """A submission without a video_url/video_ref is rejected (Req 18.2)."""
    resp = client.post("/exercise-analysis/submit", json={"user_id": "u1"})
    assert resp.status_code == 422


def test_status_reports_queued_state_and_progress_event(client: TestClient):
    """GET /status returns the queued state and the seeded Progress_Event (Req 19.8, 20.x)."""
    submit = client.post(
        "/exercise-analysis/submit",
        json={"video_url": "https://example.com/clip.mp4"},
    )
    job_id = submit.json()["job_id"]

    status = client.get(f"/exercise-analysis/status/{job_id}")
    assert status.status_code == 200
    body = status.json()
    assert body["job_id"] == job_id
    assert body["state"] == JobState.queued.value
    # The submit handler seeds an initial progress observation (Req 20.4).
    assert body["progress"] is not None
    assert body["progress"]["state"] == JobState.queued.value
    assert body["progress"]["label"] == "Uploading"


def test_result_not_available_until_completed(client: TestClient):
    """Before completion, /result reports the in-flight state with no result (Req 19.8)."""
    submit = client.post(
        "/exercise-analysis/submit",
        json={"video_url": "https://example.com/clip.mp4"},
    )
    job_id = submit.json()["job_id"]

    result = client.get(f"/exercise-analysis/result/{job_id}")
    assert result.status_code == 200
    body = result.json()
    assert body["state"] == JobState.queued.value
    assert body["result"] is None


def test_job_progresses_through_states_to_completed(client: TestClient):
    """
    Drive a submitted job through states via the same module-level adapter the
    Background_Worker uses (simulating it), and assert status/result polls
    reflect the transitions, terminating in completed with the result
    (Req 18.1, 19.8, 19.5).
    """
    submit = client.post(
        "/exercise-analysis/submit",
        json={"video_url": "https://example.com/clip.mp4"},
    )
    job_id = submit.json()["job_id"]

    # Simulate the worker advancing the job through intermediate stage states,
    # publishing progress as it goes, using the very adapters the router reads.
    intermediate_states = [
        JobState.validating,
        JobState.extracting_frames,
        JobState.extracting_pose,
        JobState.building_timeline,
        JobState.generating_feedback,
    ]
    for state in intermediate_states:
        _run(router_module._queue.set_state(job_id, state))
        _run(router_module._progress.publish(job_id, state))

        status = client.get(f"/exercise-analysis/status/{job_id}")
        assert status.status_code == 200
        body = status.json()
        assert body["state"] == state.value
        assert body["progress"]["state"] == state.value

        # While in-flight, the result endpoint reports state but no result.
        mid_result = client.get(f"/exercise-analysis/result/{job_id}")
        assert mid_result.json()["state"] == state.value
        assert mid_result.json()["result"] is None

    # The worker records the terminal result, moving the job to completed.
    result = _result()
    _run(router_module._queue.set_result(job_id, result))
    _run(router_module._progress.publish(job_id, JobState.completed))

    status = client.get(f"/exercise-analysis/status/{job_id}")
    assert status.json()["state"] == JobState.completed.value
    assert status.json()["progress"]["label"] == "Complete"

    final = client.get(f"/exercise-analysis/result/{job_id}")
    assert final.status_code == 200
    body = final.json()
    assert body["state"] == JobState.completed.value
    assert body["result"] is not None
    assert body["result"]["exercise_id"] == result.exercise_id
    assert body["error"] is None


def test_unknown_job_id_yields_404_on_status_and_result(client: TestClient):
    """An unknown job id is a 404 on both status and result (Req 19.8)."""
    status = client.get("/exercise-analysis/status/does-not-exist")
    assert status.status_code == 404

    result = client.get("/exercise-analysis/result/does-not-exist")
    assert result.status_code == 404
