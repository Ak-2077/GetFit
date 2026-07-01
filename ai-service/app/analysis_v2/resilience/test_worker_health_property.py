"""
Property tests for Stage 36 · Worker_Health_Monitor (Req 37.5–37.7).

These tests drive the `WorkerHealthMonitor` with a fully DETERMINISTIC time
seam: every failure is recorded with an explicit ``at_ms`` and every health /
gating read supplies an explicit ``at_ms`` query time, so the sliding-window
classification can be asserted exactly across many inputs without any real
wall-clock delay (the monitor's only source of non-determinism is its injected
clock).

Mirrors the established property-test style in this package (`hypothesis`
`@given` + `@settings(max_examples=..., deadline=None)`).

# Feature: ai-exercise-analysis, Property 44: Worker health classification gates
# assignment. For any worker, its health status is exactly one of healthy or
# unhealthy with a non-negative recorded failure count, the worker is marked
# unhealthy when its failure count exceeds the configured limit within the
# window, and an unhealthy worker is never selected for Analysis_Job assignment.
#
# Validates: Requirements 37.5, 37.6, 37.7
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis_v2.resilience.worker_health import (
    WorkerHealthMonitor,
    WorkerHealthPolicy,
)

# Minimum iterations mandated for these property tests.
_MIN_ITER = 200


# ─────────────────────────────────────────────────────────────────────────
# Smart generators — constrained to the meaningful input space
# ─────────────────────────────────────────────────────────────────────────

# Failure limit: small positive band exercises both healthy and unhealthy
# classification cheaply; 0 means "any in-window failure is unhealthy".
_failure_limit = st.integers(min_value=0, max_value=8)
# Sliding window in ms (>= 1 so the window is meaningful).
_window_ms = st.integers(min_value=1, max_value=600_000)
# Poll interval must stay within the documented bound (<= 15s, Req 37.7).
_poll_interval_s = st.integers(min_value=1, max_value=15)


@st.composite
def _policies(draw) -> WorkerHealthPolicy:
    return WorkerHealthPolicy(
        failure_limit=draw(_failure_limit),
        window_ms=draw(_window_ms),
        poll_interval_s=draw(_poll_interval_s),
    )


@st.composite
def _scenario(draw):
    """Draw a (policy, failure_times, query_time) scenario.

    Failure timestamps are integers recorded in non-decreasing order; the query
    time is at or after the last failure so eager pruning at record time stays
    consistent with pruning at the query instant. This lets the test compute the
    expected in-window count exactly.
    """
    policy = draw(_policies())
    times = sorted(
        draw(st.lists(st.integers(min_value=0, max_value=1_000_000), max_size=20))
    )
    last = times[-1] if times else 0
    # Query at-or-after the last failure; the extra offset lets failures age out.
    query_time = last + draw(st.integers(min_value=0, max_value=1_200_000))
    return policy, times, query_time


def _expected_in_window(times: list[int], query_time: int, window_ms: int) -> int:
    """Failures strictly within the window relative to ``query_time``.

    Matches the monitor's pruning rule: a failure at ``ts`` is in-window when
    ``query_time - ts < window_ms`` (equivalently ``ts > query_time - window``).
    """
    cutoff = query_time - window_ms
    return sum(1 for t in times if t > cutoff)


# ─────────────────────────────────────────────────────────────────────────
# Property 44 — classification + non-negative count + status domain
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(scenario=_scenario())
def test_health_classification_matches_sliding_window(scenario) -> None:
    """Status ∈ {healthy, unhealthy}, count ≥ 0, unhealthy iff in-window > limit.

    # Feature: ai-exercise-analysis, Property 44: Worker health classification
    # gates assignment.
    Validates: Requirements 37.5, 37.6, 37.7
    """
    policy, times, query_time = scenario
    monitor = WorkerHealthMonitor(policy)
    worker = "worker-A"

    for t in times:
        monitor.record_failure(worker, at_ms=t)

    expected = _expected_in_window(times, query_time, policy.window_ms)

    snapshot = monitor.health(worker, at_ms=query_time)

    # Req 37.7 — status is exactly one of healthy/unhealthy, count is non-negative
    assert snapshot.status in {"healthy", "unhealthy"}
    assert snapshot.failure_count >= 0

    # Failure count reflects exactly the in-window failures.
    assert snapshot.failure_count == expected
    assert monitor.failure_count(worker, at_ms=query_time) == expected

    # Req 37.5 — unhealthy iff in-window failures STRICTLY exceed the limit.
    should_be_unhealthy = expected > policy.failure_limit
    assert monitor.is_unhealthy(worker, at_ms=query_time) is should_be_unhealthy
    assert monitor.is_healthy(worker, at_ms=query_time) is (not should_be_unhealthy)
    assert (snapshot.status == "unhealthy") is should_be_unhealthy

    # Req 37.6 — gating mirrors health exactly.
    assert monitor.is_assignable(worker, at_ms=query_time) is (not should_be_unhealthy)


# ─────────────────────────────────────────────────────────────────────────
# Property 44 — unhealthy workers excluded from assignment (Req 37.6)
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    policy=_policies(),
    # Per-worker failure burst sizes, recorded at the same instant t=0.
    bursts=st.lists(st.integers(min_value=0, max_value=20), min_size=1, max_size=8),
)
def test_unhealthy_workers_excluded_from_assignment(policy, bursts) -> None:
    """No unhealthy worker is ever selected for assignment.

    # Feature: ai-exercise-analysis, Property 44: Worker health classification
    # gates assignment.
    Validates: Requirements 37.6, 37.7
    """
    monitor = WorkerHealthMonitor(policy)
    worker_ids = [f"worker-{i}" for i in range(len(bursts))]

    # Record each worker's failures within the window (all at t=0, queried at t=0).
    for wid, count in zip(worker_ids, bursts):
        for _ in range(count):
            monitor.record_failure(wid, at_ms=0)

    assignable = monitor.assignable_workers(worker_ids, at_ms=0)

    for wid, count in zip(worker_ids, bursts):
        unhealthy = count > policy.failure_limit
        if unhealthy:
            # Excluded from the assignable set and individually not assignable.
            assert wid not in assignable
            assert monitor.is_assignable(wid, at_ms=0) is False
        else:
            assert wid in assignable
            assert monitor.is_assignable(wid, at_ms=0) is True

    # The assignable set is exactly the healthy subset, order-preserved.
    expected_assignable = [
        wid
        for wid, count in zip(worker_ids, bursts)
        if not (count > policy.failure_limit)
    ]
    assert assignable == expected_assignable


# ─────────────────────────────────────────────────────────────────────────
# Property 44 — recovery via window expiry and via explicit reset
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    policy=_policies(),
    excess=st.integers(min_value=1, max_value=10),
)
def test_recovery_via_window_expiry_and_reset(policy, excess) -> None:
    """Aging failures out of the window restores health; so does reset().

    # Feature: ai-exercise-analysis, Property 44: Worker health classification
    # gates assignment.
    Validates: Requirements 37.5, 37.6, 37.7
    """
    monitor = WorkerHealthMonitor(policy)
    worker = "worker-R"

    # Drive the worker firmly into the unhealthy region: limit + excess failures
    # all recorded at t=0 (strictly exceeds the limit).
    n_failures = policy.failure_limit + excess
    for _ in range(n_failures):
        monitor.record_failure(worker, at_ms=0)

    # Immediately unhealthy and unassignable at t=0.
    assert monitor.is_unhealthy(worker, at_ms=0) is True
    assert monitor.is_assignable(worker, at_ms=0) is False

    # Recovery 1 — window expiry: query strictly beyond the window so every
    # failure ages out (ts=0 is in-window iff now - 0 < window; at now=window it
    # is exactly the boundary and excluded).
    later = policy.window_ms
    assert monitor.failure_count(worker, at_ms=later) == 0
    assert monitor.is_healthy(worker, at_ms=later) is True
    assert monitor.is_assignable(worker, at_ms=later) is True
    assert monitor.health(worker, at_ms=later).status == "healthy"

    # Re-fail at a fresh instant to become unhealthy again, then reset.
    base = policy.window_ms * 10
    for _ in range(n_failures):
        monitor.record_failure(worker, at_ms=base)
    assert monitor.is_unhealthy(worker, at_ms=base) is True

    # Recovery 2 — explicit reset() clears all recorded failures immediately.
    monitor.reset(worker)
    assert monitor.failure_count(worker, at_ms=base) == 0
    assert monitor.is_healthy(worker, at_ms=base) is True
    assert monitor.is_assignable(worker, at_ms=base) is True
