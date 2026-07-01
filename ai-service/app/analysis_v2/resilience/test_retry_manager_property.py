"""
Property tests for Stage 35 · Retry_Manager (Req 36).

These tests drive the `RetryManager` with fully INJECTED side effects — a
recording no-op sleeper (captures the backoff delays without any real
wall-clock wait) and a deterministic jitter source — so the backoff discipline,
the success/exhaustion outcomes, the non-transient classification, and the
request-preserving forwarding can be asserted exactly across many inputs.

Mirrors the established property-test style in this package (`hypothesis`
`@given` + `@settings(max_examples=..., deadline=None)`, async scenarios driven
via `asyncio.run`).
"""

from __future__ import annotations

import asyncio

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis_v2 import StructuredError
from app.analysis_v2.resilience.retry_manager import (
    NonTransientError,
    RetryManager,
    RetryPolicy,
    TransientError,
)

# Minimum iterations mandated for these property tests.
_MIN_ITER = 150


# ─────────────────────────────────────────────────────────────────────────
# Shared generators / helpers
# ─────────────────────────────────────────────────────────────────────────

# Policy field generators kept in safe, in-range bounds (Req 36.3).
_initial_delay = st.integers(min_value=0, max_value=1_000)
_multiplier = st.floats(
    min_value=1.0, max_value=4.0, allow_nan=False, allow_infinity=False
)
_max_delay = st.integers(min_value=0, max_value=20_000)
_max_jitter = st.integers(min_value=0, max_value=500)
_jitter_fraction = st.floats(
    min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False
)
_dependency = st.sampled_from(
    ["vision_model", "pose_engine", "reasoning_service", "job_queue", "database"]
)


class _RecordingSleeper:
    """An async sleeper that records each backoff delay (ms) without sleeping."""

    def __init__(self) -> None:
        self.delays: list[float] = []

    async def __call__(self, delay_ms: float) -> None:
        self.delays.append(delay_ms)


def _make_jitter_source(fraction: float):
    """
    Deterministic jitter source: returns ``fraction * max_jitter_ms``, always a
    constant value within ``[0, max_jitter_ms]`` for a given policy. Determinism
    lets the test recompute the expected per-attempt delay exactly.
    """

    def _jitter(max_jitter_ms: int) -> float:
        return fraction * float(max_jitter_ms)

    return _jitter


class _FlakyFn:
    """
    A callable that fails transiently the first ``fail_times`` invocations and
    then returns ``success_value``. Records every (args, kwargs) it receives so
    request-preservation (Req 36.5) can be asserted.
    """

    def __init__(self, fail_times: int, success_value):
        self.fail_times = fail_times
        self.success_value = success_value
        self.calls = 0
        self.received: list[tuple[tuple, dict]] = []

    def __call__(self, *args, **kwargs):
        self.calls += 1
        self.received.append((args, dict(kwargs)))
        if self.calls <= self.fail_times:
            raise TransientError(f"transient #{self.calls}")
        return self.success_value


def _expected_delay(policy: RetryPolicy, attempt: int, jitter_value: float) -> float:
    base = policy.initial_delay_ms * (policy.multiplier ** attempt)
    capped = min(base, float(policy.max_delay_ms))
    return capped + jitter_value


# ─────────────────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 41: Retry succeeds-or-bounds with
# disciplined backoff
# Validates: Requirements 36.1, 36.7
# ─────────────────────────────────────────────────────────────────────────


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    data=st.data(),
    initial_delay_ms=_initial_delay,
    multiplier=_multiplier,
    max_delay_ms=_max_delay,
    max_jitter_ms=_max_jitter,
    jitter_fraction=_jitter_fraction,
    dependency=_dependency,
    success_value=st.integers(),
)
def test_property_41_retry_succeeds_with_disciplined_backoff(
    data,
    initial_delay_ms: int,
    multiplier: float,
    max_delay_ms: int,
    max_jitter_ms: int,
    jitter_fraction: float,
    dependency: str,
    success_value: int,
) -> None:
    """
    For a fn that fails transiently k times then succeeds, with k <= max_retries:
      • the call returns the success result verbatim (Req 36.7);
      • it performs exactly k retries == exactly k recorded backoff delays;
      • each recorded delay equals the disciplined schedule
        compute_delay(attempt): exponential growth capped at max_delay_ms plus a
        jitter within [0, max_jitter_ms] (Req 36.1);
      • the capped base component is monotonic non-decreasing;
      • total attempts are bounded by max_retries + 1.
    """
    max_retries = data.draw(st.integers(min_value=0, max_value=10))
    # k transient failures, with the success arriving within the configured max.
    k = data.draw(st.integers(min_value=0, max_value=max_retries))

    policy = RetryPolicy(
        max_retries=max_retries,
        initial_delay_ms=initial_delay_ms,
        multiplier=multiplier,
        max_delay_ms=max_delay_ms,
        max_jitter_ms=max_jitter_ms,
    )
    sleeper = _RecordingSleeper()
    jitter_value = jitter_fraction * float(max_jitter_ms)
    manager = RetryManager(
        policy,
        sleeper=sleeper,
        jitter_source=_make_jitter_source(jitter_fraction),
    )

    fn = _FlakyFn(fail_times=k, success_value=success_value)

    result = asyncio.run(manager.call(dependency, fn))

    # Success result returned verbatim (Req 36.7).
    assert result == success_value
    assert not isinstance(result, StructuredError)

    # Exactly k retries performed => exactly k backoff sleeps recorded.
    assert len(sleeper.delays) == k
    # Total attempts bounded by max_retries + 1 (the k failures + 1 success).
    assert fn.calls == k + 1
    assert fn.calls <= max_retries + 1

    # Each recorded delay follows the disciplined exponential-backoff+jitter
    # schedule, and the jitter stays within its configured bound.
    for attempt, delay in enumerate(sleeper.delays):
        expected = _expected_delay(policy, attempt, jitter_value)
        assert delay == pytest.approx(expected)
        assert 0.0 <= jitter_value <= float(max_jitter_ms)
        assert delay <= float(max_delay_ms) + float(max_jitter_ms)

    # The capped base component is monotonic non-decreasing (disciplined growth).
    bases = [
        min(initial_delay_ms * (multiplier ** a), float(max_delay_ms))
        for a in range(len(sleeper.delays))
    ]
    for prev, cur in zip(bases, bases[1:]):
        assert cur >= prev


# ─────────────────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 42: Retry exhaustion and
# non-transient classification are correct and request-preserving
# Validates: Requirements 36.4, 36.6
# ─────────────────────────────────────────────────────────────────────────


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    max_retries=st.integers(min_value=0, max_value=10),
    initial_delay_ms=_initial_delay,
    multiplier=_multiplier,
    max_delay_ms=_max_delay,
    max_jitter_ms=_max_jitter,
    jitter_fraction=_jitter_fraction,
    dependency=_dependency,
    args=st.tuples(st.integers(), st.text(max_size=8)),
    kwargs=st.dictionaries(
        st.text(min_size=1, max_size=5), st.integers(), max_size=4
    ),
)
def test_property_42_exhaustion_is_structured_and_request_preserving(
    max_retries: int,
    initial_delay_ms: int,
    multiplier: float,
    max_delay_ms: int,
    max_jitter_ms: int,
    jitter_fraction: float,
    dependency: str,
    args: tuple,
    kwargs: dict,
) -> None:
    """
    A fn that ALWAYS fails transiently returns a
    StructuredError(code="RETRY_EXHAUSTED") that names the dependency, after
    exactly max_retries retries (== max_retries recorded sleeps), and forwards
    the arguments unchanged to every attempt (Req 36.4, 36.5).
    """
    policy = RetryPolicy(
        max_retries=max_retries,
        initial_delay_ms=initial_delay_ms,
        multiplier=multiplier,
        max_delay_ms=max_delay_ms,
        max_jitter_ms=max_jitter_ms,
    )
    sleeper = _RecordingSleeper()
    manager = RetryManager(
        policy,
        sleeper=sleeper,
        jitter_source=_make_jitter_source(jitter_fraction),
    )

    received: list[tuple[tuple, dict]] = []

    def always_transient(*a, **kw):
        received.append((a, dict(kw)))
        raise TransientError("always failing")

    result = asyncio.run(manager.call(dependency, always_transient, *args, **kwargs))

    # Exhaustion returns a StructuredError naming the failed dependency (Req 36.4).
    assert isinstance(result, StructuredError)
    assert result.code == "RETRY_EXHAUSTED"
    assert result.stage == dependency

    # Exactly max_retries retries => max_retries recorded backoff sleeps; the
    # total attempt count is max_retries + 1 (initial attempt + each retry).
    assert len(sleeper.delays) == max_retries
    assert len(received) == max_retries + 1

    # The request is forwarded UNCHANGED to every attempt (Req 36.5).
    for got_args, got_kwargs in received:
        assert got_args == args
        assert got_kwargs == kwargs


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    max_retries=st.integers(min_value=0, max_value=10),
    initial_delay_ms=_initial_delay,
    multiplier=_multiplier,
    max_delay_ms=_max_delay,
    max_jitter_ms=_max_jitter,
    jitter_fraction=_jitter_fraction,
    dependency=_dependency,
    error_kind=st.sampled_from(["non_transient", "value", "type"]),
    args=st.tuples(st.integers(), st.text(max_size=8)),
    kwargs=st.dictionaries(
        st.text(min_size=1, max_size=5), st.integers(), max_size=4
    ),
)
def test_property_42_non_transient_is_not_retried_and_returned_unchanged(
    max_retries: int,
    initial_delay_ms: int,
    multiplier: float,
    max_delay_ms: int,
    max_jitter_ms: int,
    jitter_fraction: float,
    dependency: str,
    error_kind: str,
    args: tuple,
    kwargs: dict,
) -> None:
    """
    A fn that raises a NON-transient error causes exactly one attempt with NO
    retries (zero recorded sleeps); the originating error object is returned to
    the caller UNCHANGED (same identity), and the arguments are forwarded
    unchanged (Req 36.6, 36.5).
    """
    policy = RetryPolicy(
        max_retries=max_retries,
        initial_delay_ms=initial_delay_ms,
        multiplier=multiplier,
        max_delay_ms=max_delay_ms,
        max_jitter_ms=max_jitter_ms,
    )
    sleeper = _RecordingSleeper()
    manager = RetryManager(
        policy,
        sleeper=sleeper,
        jitter_source=_make_jitter_source(jitter_fraction),
    )

    if error_kind == "non_transient":
        originating: Exception = NonTransientError("validation failed")
    elif error_kind == "value":
        originating = ValueError("bad value")
    else:
        originating = TypeError("bad type")

    received: list[tuple[tuple, dict]] = []

    def raises_non_transient(*a, **kw):
        received.append((a, dict(kw)))
        raise originating

    result = asyncio.run(
        manager.call(dependency, raises_non_transient, *args, **kwargs)
    )

    # The originating error is returned unchanged — same object (Req 36.6).
    assert result is originating
    assert not isinstance(result, StructuredError)

    # Not retried: exactly one attempt, zero backoff sleeps (Req 36.6).
    assert len(received) == 1
    assert sleeper.delays == []

    # Request forwarded unchanged (Req 36.5).
    got_args, got_kwargs = received[0]
    assert got_args == args
    assert got_kwargs == kwargs
