"""
Stage 35 · Retry_Manager (Req 36)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** decorator that wraps a call to any External_Dependency
(the vision model, the `Pose_Engine`, the `Reasoning_Service` LLM, the
`Job_Queue_Adapter`, or the `Database` — Req 36.2) with exponential backoff +
jitter. It builds on the UNCHANGED V1 contracts (it reuses `StructuredError`
re-exported from `app.analysis_v2`, Req 52.1/52.6) and never alters the wrapped
call's signature or request (Req 36.5).

Behavior (Req 36):
  • Req 36.1 — a TRANSIENT failure (network timeout, connection failure, or a
    temporary-unavailability / resource-exhaustion response such as HTTP 503 or
    429) is retried using exponential backoff with jitter until the call
    succeeds or the configured maximum retry count is reached.
  • Req 36.3 — the maximum retry count, initial backoff delay, backoff
    multiplier, maximum backoff delay, and maximum jitter are all read from
    configuration (`config_v2.SettingsV2`); the retry count is bounded to the
    integer range [0, 10] and the delays/jitter are expressed in milliseconds.
  • Req 36.4 — when the configured maximum retry count is exhausted without a
    success, the manager STOPS retrying and returns a
    `StructuredError(code="RETRY_EXHAUSTED")` that identifies the failed
    External_Dependency, without altering the request passed to it.
  • Req 36.5 — the manager operates additively: it passes ``*args``/``**kwargs``
    through to ``fn`` UNCHANGED and returns ``fn``'s result verbatim on success,
    so it never modifies the wrapped dependency's interface.
  • Req 36.6 — a NON-TRANSIENT failure (e.g. a validation or programming error)
    is NOT retried; the originating error is returned to the caller as-is.
  • Req 36.7 — when a retried call succeeds before the maximum retry count is
    reached, the successful result is returned to the caller.

Testability / determinism
--------------------------
The two sources of non-determinism — the sleep between attempts and the random
jitter — are **injected** through the constructor (`sleeper` and
`jitter_source`). Property tests can therefore supply a recording no-op sleeper
and a deterministic jitter source to assert the backoff discipline exactly,
without incurring any real wall-clock delay. `compute_delay()` exposes the
backoff schedule so tests can verify monotonic, capped exponential growth.

Privacy by construction (Req 1, preserved by Req 52.5): the manager carries no
video/frame/pose data; it only forwards the caller's own arguments and returns
sanitized, human-safe `StructuredError`s (never stack traces) on exhaustion.
"""

from __future__ import annotations

import asyncio
import inspect
import random
from typing import Awaitable, Callable

from pydantic import BaseModel, Field, field_validator

# Build on the UNCHANGED V1 contract, re-exported from the V2 package
# (Req 52.1, 52.6) — imported, never redefined.
from app.analysis_v2 import StructuredError
from app.analysis_v2.config_v2 import SettingsV2, settings_v2


# ─────────────────────────────────────────────────────────────────────────
# Transient / non-transient classification (Req 36.1, 36.6)
# ─────────────────────────────────────────────────────────────────────────

class TransientError(Exception):
    """
    Explicit marker for a transient External_Dependency failure — a network
    timeout, a connection failure, or a temporary-unavailability /
    resource-exhaustion response (e.g. HTTP 503 / 429). Such failures are
    retried with backoff + jitter (Req 36.1).
    """


class NonTransientError(Exception):
    """
    Explicit marker for a non-transient failure (e.g. a validation or
    programming error). Such failures are NOT retried; the originating error is
    returned to the caller (Req 36.6).
    """


#: Predicate seam used to classify a raised exception. Returns ``True`` when the
#: failure is transient (and therefore retryable). Injectable so a caller can
#: refine the classification for a specific dependency without changing the
#: manager's logic.
TransientPredicate = Callable[[BaseException], bool]


def default_is_transient(exc: BaseException) -> bool:
    """
    Default transient/non-transient classification (Req 36.1, 36.6).

    Transient (retryable):
      • `TransientError` (explicit marker),
      • `TimeoutError` / `asyncio.TimeoutError` (network/operation timeouts),
      • `ConnectionError` and its subclasses (connection failures).

    Non-transient (NOT retryable): everything else — most importantly explicit
    `NonTransientError`, and validation/programming errors such as `ValueError`
    or `TypeError`. When the classification is ambiguous the failure is treated
    as non-transient so a deterministic bug is never retried in a hot loop.
    """
    if isinstance(exc, NonTransientError):
        return False
    if isinstance(exc, TransientError):
        return True
    # `asyncio.TimeoutError` is an alias of `TimeoutError` on Python 3.11+, but
    # list both for clarity and older runtimes.
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError, ConnectionError)):
        return True
    return False


# ─────────────────────────────────────────────────────────────────────────
# Retry policy (Req 36.3)
# ─────────────────────────────────────────────────────────────────────────

class RetryPolicy(BaseModel):
    """
    Configuration-driven retry policy (Req 36.3). Every field defaults to the
    documented safe value; `from_settings()` reads the operator-supplied values
    from `config_v2.SettingsV2`. The maximum retry count is bounded to the
    integer range [0, 10]; an out-of-range value is clamped to the safe default.
    All delays and the jitter are expressed in milliseconds.
    """

    max_retries: int = Field(default=3, ge=0, le=10)
    initial_delay_ms: int = Field(default=200, ge=0)
    multiplier: float = Field(default=2.0, ge=1.0)
    max_delay_ms: int = Field(default=10_000, ge=0)
    max_jitter_ms: int = Field(default=250, ge=0)

    @field_validator("max_retries", mode="before")
    @classmethod
    def _clamp_max_retries(cls, v: int) -> int:
        # Retry count is bounded [0, 10] (Req 36.3); reset to the safe default
        # rather than allowing an out-of-range value to destabilise retries.
        try:
            iv = int(v)
        except (TypeError, ValueError):
            return 3
        if not (0 <= iv <= 10):
            return 3
        return iv

    @classmethod
    def from_settings(cls, s: SettingsV2 | None = None) -> "RetryPolicy":
        """
        Build a policy from the additive V2 settings (Req 36.3). Reads
        `RETRY_MAX`, `RETRY_INITIAL_DELAY_MS`, `RETRY_MULTIPLIER`,
        `RETRY_MAX_DELAY_MS`, and `RETRY_MAX_JITTER_MS`.
        """
        cfg = s if s is not None else settings_v2
        return cls(
            max_retries=cfg.RETRY_MAX,
            initial_delay_ms=cfg.RETRY_INITIAL_DELAY_MS,
            multiplier=cfg.RETRY_MULTIPLIER,
            max_delay_ms=cfg.RETRY_MAX_DELAY_MS,
            max_jitter_ms=cfg.RETRY_MAX_JITTER_MS,
        )


# Injectable side-effect seams (defaults below). The sleeper receives a delay in
# milliseconds; the jitter source receives the configured maximum jitter (ms)
# and returns the jitter to add to a backoff delay, in [0, max_jitter_ms].
Sleeper = Callable[[float], Awaitable[None]]
JitterSource = Callable[[int], float]


async def _default_sleeper(delay_ms: float) -> None:
    """Real sleeper: pause for ``delay_ms`` milliseconds."""
    await asyncio.sleep(delay_ms / 1000.0)


def _default_jitter(max_jitter_ms: int) -> float:
    """Real jitter source: a uniform random value in [0, max_jitter_ms] ms."""
    if max_jitter_ms <= 0:
        return 0.0
    return random.uniform(0.0, float(max_jitter_ms))


# ─────────────────────────────────────────────────────────────────────────
# Retry manager (Req 36.1–36.7)
# ─────────────────────────────────────────────────────────────────────────

class RetryManager:
    """
    Wraps an External_Dependency call with exponential backoff + jitter.

    The manager is a transparent decorator: `call()` forwards the caller's
    ``*args``/``**kwargs`` to ``fn`` unchanged and returns ``fn``'s result
    verbatim on success, so it never alters the wrapped dependency's signature
    or request (Req 36.5, 36.7).
    """

    def __init__(
        self,
        policy: RetryPolicy | None = None,
        *,
        is_transient: TransientPredicate | None = None,
        sleeper: Sleeper | None = None,
        jitter_source: JitterSource | None = None,
    ) -> None:
        """
        Args:
            policy: retry policy; defaults to one built from the V2 settings
                (Req 36.3).
            is_transient: classification predicate; defaults to
                `default_is_transient` (Req 36.1, 36.6).
            sleeper: awaitable backoff sleeper (ms); injectable for deterministic
                tests. Defaults to a real `asyncio.sleep`.
            jitter_source: jitter generator (ms); injectable for deterministic
                tests. Defaults to a uniform random source in [0, max_jitter_ms].
        """
        self._policy = policy if policy is not None else RetryPolicy.from_settings()
        self._is_transient = is_transient if is_transient is not None else default_is_transient
        self._sleeper = sleeper if sleeper is not None else _default_sleeper
        self._jitter_source = jitter_source if jitter_source is not None else _default_jitter

    @property
    def policy(self) -> RetryPolicy:
        return self._policy

    def compute_delay(self, attempt: int) -> float:
        """
        Backoff delay (ms) applied BEFORE the retry following the zero-based
        ``attempt`` index, i.e. the delay between attempt ``n`` and ``n+1``.

        Exponential growth ``initial_delay_ms * multiplier**attempt`` capped at
        ``max_delay_ms``, plus a jitter drawn from the injected source in
        ``[0, max_jitter_ms]`` (Req 36.1). Exposed so property tests can assert
        the backoff discipline (monotonic, capped exponential growth) without
        any real delay.
        """
        base = self._policy.initial_delay_ms * (self._policy.multiplier ** attempt)
        capped = min(base, float(self._policy.max_delay_ms))
        jitter = self._jitter_source(self._policy.max_jitter_ms)
        return capped + jitter

    async def call(self, dependency: str, fn: Callable, *args, **kwargs):
        """
        Invoke ``fn(*args, **kwargs)`` with retry-on-transient-failure.

        Returns:
            • ``fn``'s result verbatim on success (Req 36.7);
            • the originating exception, returned unchanged, on a non-transient
              failure — not retried (Req 36.6);
            • a ``StructuredError(code="RETRY_EXHAUSTED")`` naming ``dependency``
              once the configured maximum retry count is exhausted (Req 36.4).

        ``fn`` may be synchronous or asynchronous; an awaitable result is awaited
        transparently. The arguments are forwarded UNCHANGED (Req 36.5).
        """
        attempt = 0
        last_exc: BaseException | None = None

        while True:
            try:
                result = fn(*args, **kwargs)
                if inspect.isawaitable(result):
                    result = await result
                # Success — return the dependency's result unchanged (Req 36.7).
                return result
            except Exception as exc:  # noqa: BLE001 — classify, then decide
                # Non-transient failure: do NOT retry; return the originating
                # error to the caller unchanged (Req 36.6).
                if not self._is_transient(exc):
                    return exc

                last_exc = exc

                # Transient failure. If the configured maximum retry count is
                # exhausted, stop and return a structured exhaustion error
                # (Req 36.4). `attempt` is the zero-based attempt index, so
                # `attempt >= max_retries` means every allotted retry is used.
                if attempt >= self._policy.max_retries:
                    return self._retry_exhausted(dependency, attempt, last_exc)

                # Otherwise back off (exponential + jitter) and retry (Req 36.1).
                await self._sleeper(self.compute_delay(attempt))
                attempt += 1

    def _retry_exhausted(
        self,
        dependency: str,
        final_attempt_index: int,
        last_exc: BaseException | None,
    ) -> StructuredError:
        """
        Build the sanitized retry-exhaustion error (Req 36.4). Names the failed
        External_Dependency in `stage` and summarizes the exhaustion in
        `message` — no stack traces or internal detail (StructuredError
        contract). The request passed to the dependency is never altered.
        """
        total_attempts = final_attempt_index + 1
        cause = type(last_exc).__name__ if last_exc is not None else "unknown"
        return StructuredError(
            code="RETRY_EXHAUSTED",
            message=(
                f"Dependency '{dependency}' retry exhausted after "
                f"{total_attempts} attempt(s) (last transient cause: {cause})."
            ),
            stage=dependency,
        )
