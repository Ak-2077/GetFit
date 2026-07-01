"""
Stage 36 · Worker_Health_Monitor (Req 37.5–37.7)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** supervision helper that monitors `Inference_Worker`
health and gates `Analysis_Job` assignment away from unhealthy workers. It wraps
the existing worker model without altering any V1 signature or contract
(Req 52.1) and builds on the *unchanged* V1 interfaces re-exported from
`app.analysis_v2` (Req 52.6).

Behavior (Req 37):
  • Req 37.5 — when an `Inference_Worker` fails MORE TIMES THAN the configured
    failure limit within the configured window (default 5 failures within a
    5-minute window), the monitor marks the worker as ``unhealthy``. The limit
    is *exceeded* strictly (``failures_in_window > failure_limit``).
  • Req 37.6 — while a worker is marked ``unhealthy`` it is excluded from
    `Analysis_Job` assignment; `is_assignable()` returns ``False`` so the
    `GPU_Recovery_Service`/queue never dispatches a job to it.
  • Req 37.7 — the monitor exposes, for each worker, a health status of exactly
    one of ``healthy`` or ``unhealthy`` together with the recorded
    (non-negative) failure count within the window, and surfaces a polling
    interval that does not exceed 15 seconds.
  • Req 37.8 — the failure limit, window, and poll interval are read from
    configuration (`config_v2.SettingsV2`); absent/invalid values fall back to
    the documented safe defaults (5 failures per 5-minute window, poll ≤ 15s).

Recovery
--------
Health is computed over a **sliding window**: failures older than the configured
window are pruned on every read/write, so a worker that stops failing recovers
automatically once its in-window failures fall back to the limit or below
(window expiry). An operator (or the `GPU_Recovery_Service` after a successful
restart) can also clear a worker's recorded failures explicitly via `reset()`
or `reset_all()`.

Testability / determinism
--------------------------
The single source of non-determinism — the wall clock used to timestamp and age
out failures — is **injected** through the constructor (`clock`). The clock is a
zero-argument callable returning the current time in **milliseconds**. Property
tests can therefore supply a deterministic, monotonically-advancing clock to
assert the sliding-window classification exactly, without any real delay. The
default clock uses `time.monotonic()` (immune to wall-clock adjustments).

Privacy by construction (Req 1, preserved by Req 52.5): the monitor carries no
video/frame/pose data — only opaque worker identifiers and failure timestamps.

Never raises on domain conditions: recording a failure/success, reading health,
and gating assignment all return normally for any input (Req: returns
`StageResult`/structured values rather than raising — consistent with the V2
contract).
"""

from __future__ import annotations

import time
from typing import Callable, Literal

from pydantic import BaseModel, Field, field_validator

from app.analysis_v2.config_v2 import SettingsV2, settings_v2


# ─────────────────────────────────────────────────────────────────────────
# Injectable clock seam (default below)
# ─────────────────────────────────────────────────────────────────────────

#: A zero-argument time source returning the current time in **milliseconds**.
#: Injectable so property tests can drive the sliding window deterministically.
Clock = Callable[[], float]


def _default_clock() -> float:
    """Real clock: a monotonic timestamp in milliseconds.

    `time.monotonic()` is used (rather than `time.time()`) so the sliding window
    is immune to wall-clock adjustments (NTP steps, DST) that could otherwise
    spuriously age out — or fail to age out — recorded failures.
    """
    return time.monotonic() * 1000.0


HealthStatus = Literal["healthy", "unhealthy"]


# ─────────────────────────────────────────────────────────────────────────
# Worker health snapshot (Req 37.7)
# ─────────────────────────────────────────────────────────────────────────

class WorkerHealth(BaseModel):
    """Point-in-time health snapshot for a single `Inference_Worker` (Req 37.7).

    `status` is exactly one of ``healthy`` / ``unhealthy`` and `failure_count`
    is the non-negative number of failures recorded within the sliding window.
    """

    worker_id: str
    status: HealthStatus
    failure_count: int = Field(ge=0)


# ─────────────────────────────────────────────────────────────────────────
# Health policy (Req 37.8)
# ─────────────────────────────────────────────────────────────────────────

class WorkerHealthPolicy(BaseModel):
    """Configuration-driven worker-health policy (Req 37.5, 37.7, 37.8).

    Every field defaults to the documented safe value; `from_settings()` reads
    the operator-supplied values from `config_v2.SettingsV2`. Out-of-range
    values are reset to the safe default rather than allowed to destabilise the
    health gate.
    """

    #: Failures within the window must EXCEED this limit to mark unhealthy
    #: (default 5 — Req 37.5/37.8).
    failure_limit: int = Field(default=5, ge=0)
    #: Sliding window over which failures are counted (default 300_000 ms = 5 min).
    window_ms: int = Field(default=300_000, ge=0)
    #: Health-poll interval; must not exceed 15 seconds (Req 37.7).
    poll_interval_s: int = Field(default=15, ge=1, le=15)

    @field_validator("failure_limit", mode="before")
    @classmethod
    def _clamp_failure_limit(cls, v: int) -> int:
        try:
            iv = int(v)
        except (TypeError, ValueError):
            return 5
        return iv if iv >= 0 else 5

    @field_validator("window_ms", mode="before")
    @classmethod
    def _clamp_window(cls, v: int) -> int:
        try:
            iv = int(v)
        except (TypeError, ValueError):
            return 300_000
        return iv if iv >= 0 else 300_000

    @field_validator("poll_interval_s", mode="before")
    @classmethod
    def _clamp_poll(cls, v: int) -> int:
        # Poll interval must not exceed 15 seconds (Req 37.7); an absent/invalid
        # or out-of-range value falls back to the documented 15s default.
        try:
            iv = int(v)
        except (TypeError, ValueError):
            return 15
        if iv < 1 or iv > 15:
            return 15
        return iv

    @classmethod
    def from_settings(cls, s: SettingsV2 | None = None) -> "WorkerHealthPolicy":
        """Build a policy from the additive V2 settings (Req 37.8).

        Reads `GPU_FAILURE_LIMIT`, `GPU_FAILURE_WINDOW_MS`, and
        `WORKER_HEALTH_POLL_S`; missing/invalid values fall back to the safe
        defaults via the validators above.
        """
        cfg = s if s is not None else settings_v2
        return cls(
            failure_limit=cfg.GPU_FAILURE_LIMIT,
            window_ms=cfg.GPU_FAILURE_WINDOW_MS,
            poll_interval_s=cfg.WORKER_HEALTH_POLL_S,
        )


# ─────────────────────────────────────────────────────────────────────────
# Worker health monitor (Req 37.5–37.8)
# ─────────────────────────────────────────────────────────────────────────

class WorkerHealthMonitor:
    """Tracks per-worker failures within a sliding window and gates assignment.

    The monitor records each failure with a timestamp from the injected clock,
    ages out failures older than the configured window on every read/write, and
    classifies a worker as ``unhealthy`` once its in-window failure count
    EXCEEDS the configured limit (Req 37.5). Unhealthy workers are excluded from
    `Analysis_Job` assignment (Req 37.6). All operations return normally — the
    monitor never raises on a domain condition.
    """

    def __init__(
        self,
        policy: WorkerHealthPolicy | None = None,
        *,
        clock: Clock | None = None,
    ) -> None:
        """Args:
        policy: health policy; defaults to one built from the V2 settings
            (Req 37.8).
        clock: zero-argument time source in milliseconds; injectable for
            deterministic tests. Defaults to a monotonic millisecond clock.
        """
        self._policy = policy if policy is not None else WorkerHealthPolicy.from_settings()
        self._clock = clock if clock is not None else _default_clock
        # worker_id -> list of failure timestamps (ms), kept pruned to the window.
        self._failures: dict[str, list[float]] = {}
        # worker_id -> last success timestamp (ms); recorded for observability,
        # does not by itself clear in-window failures (recovery is window expiry
        # or explicit reset).
        self._last_success: dict[str, float] = {}

    # ── Accessors ──

    @property
    def policy(self) -> WorkerHealthPolicy:
        return self._policy

    @property
    def poll_interval_s(self) -> int:
        """The health-poll interval in seconds (≤ 15s, Req 37.7)."""
        return self._policy.poll_interval_s

    @property
    def failure_limit(self) -> int:
        return self._policy.failure_limit

    @property
    def window_ms(self) -> int:
        return self._policy.window_ms

    # ── Recording ──

    def record_failure(self, worker_id: str, *, at_ms: float | None = None) -> None:
        """Record one failure for ``worker_id`` at the current (or supplied) time.

        The timestamp is taken from the injected clock unless ``at_ms`` is given.
        Never raises: a missing/None ``worker_id`` is coerced to a string key.
        """
        wid = self._key(worker_id)
        now = self._now(at_ms)
        bucket = self._failures.setdefault(wid, [])
        bucket.append(now)
        # Prune eagerly so memory stays bounded by the in-window failure count.
        self._prune(wid, now)

    def record_success(self, worker_id: str, *, at_ms: float | None = None) -> None:
        """Record a successful job for ``worker_id`` (observability only).

        A success does NOT clear the recorded in-window failures by itself —
        recovery is driven by window expiry or an explicit `reset()` — but it
        ages out failures that have fallen outside the window as of ``now``.
        Never raises.
        """
        wid = self._key(worker_id)
        now = self._now(at_ms)
        self._last_success[wid] = now
        if wid in self._failures:
            self._prune(wid, now)

    # ── Health / gating ──

    def failure_count(self, worker_id: str, *, at_ms: float | None = None) -> int:
        """Return the non-negative number of failures within the window (Req 37.7)."""
        wid = self._key(worker_id)
        now = self._now(at_ms)
        self._prune(wid, now)
        return len(self._failures.get(wid, ()))

    def is_unhealthy(self, worker_id: str, *, at_ms: float | None = None) -> bool:
        """True when in-window failures EXCEED the configured limit (Req 37.5)."""
        return self.failure_count(worker_id, at_ms=at_ms) > self._policy.failure_limit

    def is_healthy(self, worker_id: str, *, at_ms: float | None = None) -> bool:
        """True when the worker is not unhealthy (Req 37.7)."""
        return not self.is_unhealthy(worker_id, at_ms=at_ms)

    def is_assignable(self, worker_id: str, *, at_ms: float | None = None) -> bool:
        """Whether ``worker_id`` may receive an `Analysis_Job` (Req 37.6).

        Returns ``False`` for an unhealthy worker so it is excluded from
        assignment; ``True`` otherwise.
        """
        return not self.is_unhealthy(worker_id, at_ms=at_ms)

    def health(self, worker_id: str, *, at_ms: float | None = None) -> WorkerHealth:
        """Return the current health snapshot for ``worker_id`` (Req 37.7).

        `status` is exactly one of ``healthy`` / ``unhealthy`` and
        `failure_count` is the non-negative in-window failure count.
        """
        wid = self._key(worker_id)
        count = self.failure_count(wid, at_ms=at_ms)
        status: HealthStatus = "unhealthy" if count > self._policy.failure_limit else "healthy"
        return WorkerHealth(worker_id=wid, status=status, failure_count=count)

    def assignable_workers(
        self, worker_ids: "list[str] | tuple[str, ...]", *, at_ms: float | None = None
    ) -> list[str]:
        """Filter ``worker_ids`` to those eligible for assignment (Req 37.6).

        Preserves input order and excludes every unhealthy worker.
        """
        return [w for w in worker_ids if self.is_assignable(w, at_ms=at_ms)]

    def known_workers(self) -> list[str]:
        """Return every worker id the monitor has observed (failure or success)."""
        return sorted(set(self._failures) | set(self._last_success))

    # ── Recovery / explicit reset ──

    def reset(self, worker_id: str) -> None:
        """Clear all recorded failures for ``worker_id`` (explicit recovery).

        Used by an operator or by the `GPU_Recovery_Service` after a successful
        restart to bring a worker back to ``healthy`` immediately. Never raises.
        """
        wid = self._key(worker_id)
        self._failures.pop(wid, None)

    def reset_all(self) -> None:
        """Clear recorded failures for every worker. Never raises."""
        self._failures.clear()

    # ── Internals ──

    def _now(self, at_ms: float | None) -> float:
        if at_ms is not None:
            return float(at_ms)
        try:
            return float(self._clock())
        except Exception:  # noqa: BLE001 — never raise on a clock fault
            # Degrade safely: a faulty clock must not crash health gating.
            return 0.0

    def _prune(self, worker_id: str, now: float) -> None:
        """Drop failures older than the sliding window relative to ``now``.

        A failure is *within the window* when ``now - ts < window_ms`` (the
        oldest boundary instant is excluded). Empty buckets are removed so the
        worker naturally returns to ``healthy`` once all failures age out
        (window-expiry recovery).
        """
        bucket = self._failures.get(worker_id)
        if not bucket:
            return
        window = self._policy.window_ms
        cutoff = now - window
        kept = [ts for ts in bucket if ts > cutoff]
        if kept:
            self._failures[worker_id] = kept
        else:
            self._failures.pop(worker_id, None)

    @staticmethod
    def _key(worker_id: str) -> str:
        """Coerce any worker identifier to a stable string key (never raises)."""
        return worker_id if isinstance(worker_id, str) else str(worker_id)
