"""
Property tests for Stage 36 · GPU_Recovery_Service (Req 37.1–37.4).

These tests drive the `GPURecoveryService` with fully DETERMINISTIC, injected
side-effect seams — a `restart_worker` stub and a `run_inference` stub that
succeed/fail on demand, a recording no-op `sleeper`, and a monotonic `clock` —
so the bounded restart + escalate-to-fallback + clean-exhaustion discipline can
be asserted exactly across many inputs without any real worker, GPU, or
wall-clock delay (`enforce_timeouts=False` keeps the seams pure). Each recovery
is driven synchronously via ``asyncio.run``.

Mirrors the established property-test style in this package (`hypothesis`
`@given` + `@settings(max_examples=..., deadline=None)`).

# Feature: ai-exercise-analysis, Property 43: GPU recovery escalates within
# bounds then fails cleanly. For any inference crash scenario, the
# GPU_Recovery_Service restarts the worker at most the configured maximum
# attempts and retries the job once per restart; if the active model still fails
# it switches to the configured fallback model and retries; if the fallback also
# fails the affected job is marked failed with no partial results and a
# recovery-exhaustion error.
#
# Validates: Requirements 37.1, 37.2, 37.3, 37.4
"""

from __future__ import annotations

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.jobs import AnalysisJob, JobState
from app.analysis_v2.resilience.gpu_recovery import (
    GPURecoveryService,
    RecoveryPolicy,
)
from app.analysis_v2.resilience.worker_health import (
    WorkerHealthMonitor,
    WorkerHealthPolicy,
)

# Minimum iterations mandated for these property tests.
_MIN_ITER = 200

_ACTIVE = "active-model"
_FALLBACK = "fallback-model"
_WORKER = "worker-A"
_RESULT = {"keyframes": [1, 2, 3], "ok": True}  # opaque, non-None success payload


# ─────────────────────────────────────────────────────────────────────────
# Deterministic seams (recording, no real delay)
# ─────────────────────────────────────────────────────────────────────────

class RecordingSleeper:
    """An awaitable no-op sleeper that records every requested delay."""

    def __init__(self) -> None:
        self.calls: list[float] = []

    async def __call__(self, delay_s: float) -> None:
        self.calls.append(delay_s)


def _make_clock():
    """A zero-arg monotonically-advancing clock (seconds)."""
    t = [0.0]

    def clock() -> float:
        t[0] += 1.0
        return t[0]

    return clock


def _make_job() -> AnalysisJob:
    return AnalysisJob(job_id="job-1", user_id="user-1")


def _make_service(policy: RecoveryPolicy, *, restart_worker, run_inference):
    """Build a service with deterministic seams and timeouts disabled."""
    sleeper = RecordingSleeper()
    restart_calls = {"n": 0}

    def counting_restart(worker_id: str):
        restart_calls["n"] += 1
        return restart_worker(worker_id)

    # A fresh monitor with a deterministic clock keeps health recording pure.
    monitor = WorkerHealthMonitor(WorkerHealthPolicy(), clock=_make_clock())
    service = GPURecoveryService(
        monitor,
        policy=policy,
        restart_worker=counting_restart,
        run_inference=run_inference,
        sleeper=sleeper,
        clock=_make_clock(),
        enforce_timeouts=False,
    )
    return service, restart_calls, sleeper


# ─────────────────────────────────────────────────────────────────────────
# Smart generators — constrained to the meaningful input space
# ─────────────────────────────────────────────────────────────────────────

# Configured maximum restart attempts, within the policy's bound [0, 10].
_max_attempts = st.integers(min_value=0, max_value=10)


def _policy(max_attempts: int) -> RecoveryPolicy:
    return RecoveryPolicy(
        max_restart_attempts=max_attempts,
        active_model=_ACTIVE,
        fallback_model=_FALLBACK,
        restart_backoff_s=0.0,
    )


def _always_restart_ok(_worker_id: str) -> None:
    return None


# ─────────────────────────────────────────────────────────────────────────
# Property 43 — active model recovers within the restart budget (Req 37.1, 37.2)
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(data=st.data(), max_attempts=st.integers(min_value=1, max_value=10))
def test_active_model_recovers_within_restart_budget(data, max_attempts) -> None:
    """Active model succeeding on the Kth restart ⇒ recovered via active, K ≤ max.

    # Feature: ai-exercise-analysis, Property 43: GPU recovery escalates within
    # bounds then fails cleanly.
    Validates: Requirements 37.1, 37.2
    """
    # The active model succeeds on the Kth restart attempt (1 ≤ K ≤ max).
    success_on = data.draw(st.integers(min_value=1, max_value=max_attempts))

    active_calls = {"n": 0}

    def run_inference(worker_id: str, job: AnalysisJob, model_name: str):
        if model_name == _ACTIVE:
            active_calls["n"] += 1
            if active_calls["n"] >= success_on:
                return _RESULT
            raise RuntimeError("active model failed this attempt")
        # The fallback must never be reached when the active model recovers.
        raise AssertionError("fallback should not be invoked")

    service, restart_calls, _ = _make_service(
        _policy(max_attempts),
        restart_worker=_always_restart_ok,
        run_inference=run_inference,
    )
    job = _make_job()
    outcome = asyncio.run(service.recover(_WORKER, job))

    # Recovered via the ACTIVE model, no fallback (Req 37.1, 37.2).
    assert outcome.recovered is True
    assert outcome.recovery_model == _ACTIVE
    assert outcome.fallback_used is False
    assert outcome.result == _RESULT
    assert outcome.error is None
    # Restarted exactly K times (1 retry per restart), within the budget.
    assert outcome.restart_attempts == success_on
    assert outcome.restart_attempts <= max_attempts
    assert restart_calls["n"] == success_on
    # The job record is preserved and NOT marked failed on success.
    assert outcome.job.job_id == job.job_id
    assert outcome.job.user_id == job.user_id
    assert outcome.job.state != JobState.failed


# ─────────────────────────────────────────────────────────────────────────
# Property 43 — fallback recovers when the active model is exhausted (Req 37.3)
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(max_attempts=_max_attempts)
def test_fallback_recovers_when_active_exhausted(max_attempts) -> None:
    """Active always fails but fallback succeeds ⇒ recovered via fallback at max.

    # Feature: ai-exercise-analysis, Property 43: GPU recovery escalates within
    # bounds then fails cleanly.
    Validates: Requirements 37.3
    """

    def run_inference(worker_id: str, job: AnalysisJob, model_name: str):
        if model_name == _FALLBACK:
            return _RESULT
        raise RuntimeError("active model failed")

    service, restart_calls, _ = _make_service(
        _policy(max_attempts),
        restart_worker=_always_restart_ok,
        run_inference=run_inference,
    )
    job = _make_job()
    outcome = asyncio.run(service.recover(_WORKER, job))

    # Recovered via the FALLBACK model after exhausting the active model (Req 37.3).
    assert outcome.recovered is True
    assert outcome.recovery_model == _FALLBACK
    assert outcome.fallback_used is True
    assert outcome.result == _RESULT
    assert outcome.error is None
    # The active model was retried once per restart up to the full budget.
    assert outcome.restart_attempts == max_attempts
    assert restart_calls["n"] == max_attempts
    assert outcome.job.state != JobState.failed


# ─────────────────────────────────────────────────────────────────────────
# Property 43 — both models fail ⇒ clean exhaustion, no partial results (Req 37.4)
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(max_attempts=_max_attempts)
def test_recovery_exhausted_when_active_and_fallback_fail(max_attempts) -> None:
    """Active and fallback both fail ⇒ job failed, no result, RECOVERY_EXHAUSTED.

    # Feature: ai-exercise-analysis, Property 43: GPU recovery escalates within
    # bounds then fails cleanly.
    Validates: Requirements 37.4
    """

    def run_inference(worker_id: str, job: AnalysisJob, model_name: str):
        raise RuntimeError(f"{model_name} failed")

    service, restart_calls, _ = _make_service(
        _policy(max_attempts),
        restart_worker=_always_restart_ok,
        run_inference=run_inference,
    )
    job = _make_job()
    outcome = asyncio.run(service.recover(_WORKER, job))

    # Unrecoverable: job marked failed with NO partial results (Req 37.4).
    assert outcome.recovered is False
    assert outcome.result is None
    assert outcome.recovery_model is None
    assert outcome.fallback_used is False
    assert outcome.error is not None
    assert outcome.error.code == "RECOVERY_EXHAUSTED"
    assert outcome.error.stage == "gpu_recovery"
    assert outcome.job.state == JobState.failed
    assert outcome.job.result is None
    # The rest of the AnalysisJob record is preserved (id/user unchanged).
    assert outcome.job.job_id == job.job_id
    assert outcome.job.user_id == job.user_id
    # Restarts never exceed the configured maximum.
    assert outcome.restart_attempts == max_attempts
    assert restart_calls["n"] == max_attempts


# ─────────────────────────────────────────────────────────────────────────
# Property 43 — universal invariants across arbitrary crash scenarios
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    max_attempts=_max_attempts,
    # Per-restart success/failure pattern (indexed by restart call count).
    restart_pattern=st.lists(st.booleans(), max_size=12),
    # Per-call active-model success/failure pattern (indexed by active call count).
    active_pattern=st.lists(st.booleans(), max_size=12),
    # Whether the single fallback retry succeeds.
    fallback_ok=st.booleans(),
)
def test_recovery_invariants_hold_for_any_scenario(
    max_attempts, restart_pattern, active_pattern, fallback_ok
) -> None:
    """Across ANY scenario: bounded restarts, never raises, clean result/error.

    # Feature: ai-exercise-analysis, Property 43: GPU recovery escalates within
    # bounds then fails cleanly.
    Validates: Requirements 37.1, 37.2, 37.3, 37.4
    """
    restart_idx = {"n": 0}
    active_idx = {"n": 0}

    def restart_worker(worker_id: str):
        i = restart_idx["n"]
        restart_idx["n"] += 1
        ok = restart_pattern[i] if i < len(restart_pattern) else False
        if not ok:
            raise RuntimeError("restart failed")
        return None

    def run_inference(worker_id: str, job: AnalysisJob, model_name: str):
        if model_name == _ACTIVE:
            i = active_idx["n"]
            active_idx["n"] += 1
            ok = active_pattern[i] if i < len(active_pattern) else False
            if ok:
                return _RESULT
            raise RuntimeError("active failed")
        # fallback
        if fallback_ok:
            return _RESULT
        raise RuntimeError("fallback failed")

    service, restart_calls, _ = _make_service(
        _policy(max_attempts),
        restart_worker=restart_worker,
        run_inference=run_inference,
    )
    job = _make_job()

    # Never raises on any domain condition.
    outcome = asyncio.run(service.recover(_WORKER, job))

    # Restarts are strictly bounded by the configured maximum (Req 37.1).
    assert 0 <= outcome.restart_attempts <= max_attempts
    assert restart_calls["n"] <= max_attempts

    # Job identity is always preserved.
    assert outcome.job.job_id == job.job_id
    assert outcome.job.user_id == job.user_id

    if outcome.recovered:
        # Success ⇒ a result via active or fallback, no error, not failed.
        assert outcome.error is None
        assert outcome.result == _RESULT
        assert outcome.recovery_model in {_ACTIVE, _FALLBACK}
        assert outcome.job.state != JobState.failed
        if outcome.recovery_model == _ACTIVE:
            assert outcome.fallback_used is False
            assert 1 <= outcome.restart_attempts <= max_attempts
        else:
            # Fallback only runs after the active budget is exhausted (Req 37.3).
            assert outcome.fallback_used is True
            assert outcome.restart_attempts == max_attempts
    else:
        # Failure ⇒ clean exhaustion with no partial results (Req 37.4).
        assert outcome.result is None
        assert outcome.recovery_model is None
        assert outcome.fallback_used is False
        assert outcome.error is not None
        assert outcome.error.code == "RECOVERY_EXHAUSTED"
        assert outcome.error.stage == "gpu_recovery"
        assert outcome.job.state == JobState.failed
        assert outcome.job.result is None
        assert outcome.restart_attempts == max_attempts
