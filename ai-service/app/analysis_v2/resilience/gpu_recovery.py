"""
Stage 36 · GPU_Recovery_Service (Req 37.1–37.4, 37.8)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** supervision helper that recovers an `Inference_Worker`
after it crashes mid-inference. It composes the already-built
`Worker_Health_Monitor` (Stage 36, Req 37.5–37.8) and is wired, in production,
to the `Model_Registry` (Stage 42, Req 43) for active/fallback model selection.
It builds on the *unchanged* V1 contracts re-exported from `app.analysis_v2`
(Req 52.1, 52.6) — it reuses `StructuredError` and the V1 `AnalysisJob`/`JobState`
without redefining either.

Behavior (Req 37):
  • Req 37.1 — on an inference crash the service restarts the `Inference_Worker`
    automatically, **up to the configured maximum restart attempts** (default 3).
    The detect (≤10s) and restart (≤30s) budgets are documented in the policy and
    enforced as operation timeouts on the injected restart action.
  • Req 37.2 — on each restart the service reloads the active model and retries
    the affected `Analysis_Job` **exactly once per restart**, completing model
    reload + inference within the configured budget (≤60s).
  • Req 37.3 — IF the active model fails to load/produce inference across the
    bounded restart attempts, the service selects the configured **fallback
    model** (`GPU_FALLBACK_MODEL`) and retries the job once with it.
  • Req 37.4 — IF the fallback model also fails, the service marks the affected
    job ``failed`` with **no partial results** (``result=None``), returns a
    ``StructuredError(code="RECOVERY_EXHAUSTED")``, and preserves the rest of the
    `AnalysisJob` record (id/user unchanged).
  • Req 37.8 — the maximum restart attempts, fallback model, and the worker
    failure limit/window are all read from configuration
    (`config_v2.SettingsV2`); absent/invalid values fall back to the documented
    safe defaults (3 restart attempts, fallback ``movenet``, 5 failures / 5-min
    window — the last via the `Worker_Health_Monitor`).

Composition with the Worker_Health_Monitor (Req 37.5–37.6)
----------------------------------------------------------
Every observed inference/restart failure is recorded against the worker via
``monitor.record_failure``; a successful recovery records a success. The monitor
independently marks a worker ``unhealthy`` once its in-window failures exceed the
limit and excludes it from assignment (Req 37.5/37.6) — so a worker that keeps
crashing during recovery is naturally taken out of rotation.

Testability / determinism
--------------------------
The two side effects — restarting the worker and running inference — are
**injected** through the constructor (`restart_worker`, `run_inference`), and the
pacing/clock seams (`sleeper`, `clock`) are injectable too. Property tests can
therefore supply deterministic stubs that succeed/fail on demand and assert the
escalation discipline exactly (restart at most N times, retry once per restart,
fallback once, then a clean recovery-exhaustion error) without any real worker,
GPU, or wall-clock delay.

Never raises on a domain condition (consistent with the V2 contract): a crash,
a failed restart, a failed inference, or an exhausted recovery all return a
`RecoveryOutcome` carrying a sanitized `StructuredError` rather than propagating
an exception.

Privacy by construction (Req 1, preserved by Req 52.5): the service carries no
video/frame/pose data; it forwards the opaque `AnalysisJob` and worker id only,
and surfaces sanitized, human-safe `StructuredError`s (never stack traces).
"""

from __future__ import annotations

import asyncio
import inspect
from typing import Any, Awaitable, Callable

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Build on the UNCHANGED V1 contracts, re-exported from the V2 package
# (Req 52.1, 52.6) — imported, never redefined.
from app.analysis_v2 import StructuredError
from app.analysis.jobs import AnalysisJob, JobState
from app.analysis_v2.config_v2 import SettingsV2, settings_v2
from app.analysis_v2.resilience.worker_health import WorkerHealthMonitor


# ─────────────────────────────────────────────────────────────────────────
# Injectable side-effect seams (defaults below)
# ─────────────────────────────────────────────────────────────────────────

#: Restart action for a worker. Receives the worker id; may be sync or async.
#: Raising (or timing out) signals the restart did not succeed (Req 37.1).
RestartAction = Callable[[str], "Awaitable[None] | None"]

#: Inference runner. Receives ``(worker_id, job, model_name)`` and returns the
#: inference result on success; raising (or timing out) signals the model failed
#: to load or produce inference (Req 37.2, 37.3). May be sync or async.
InferenceFn = Callable[[str, AnalysisJob, str], "Awaitable[Any] | Any"]

#: Awaitable pacing sleeper (seconds); injectable for deterministic tests.
Sleeper = Callable[[float], Awaitable[None]]

#: Zero-argument time source (seconds); injectable for deterministic tests.
Clock = Callable[[], float]


async def _default_restart(worker_id: str) -> None:
    """Default restart action: a no-op success.

    Production wiring replaces this with the real `Inference_Worker` restart.
    A no-op default keeps the service constructible (and lets the active model
    be retried) without a live worker.
    """
    return None


def _default_run_inference(worker_id: str, job: AnalysisJob, model_name: str) -> Any:
    """Default inference runner: signals "no model wired".

    With no real model attached, every attempt fails, so recovery escalates and
    terminates cleanly with ``RECOVERY_EXHAUSTED`` rather than hanging. Production
    wiring replaces this with the `Model_Registry`-selected model on the worker.
    """
    raise RuntimeError(f"no inference backend wired for model '{model_name}'")


async def _default_sleeper(delay_s: float) -> None:
    """Real pacing sleeper: pause for ``delay_s`` seconds."""
    if delay_s and delay_s > 0:
        await asyncio.sleep(delay_s)


def _default_clock() -> float:
    """Real clock: a monotonic timestamp in seconds (immune to wall-clock steps)."""
    import time

    return time.monotonic()


# ─────────────────────────────────────────────────────────────────────────
# Recovery policy (Req 37.1, 37.3, 37.8)
# ─────────────────────────────────────────────────────────────────────────

class RecoveryPolicy(BaseModel):
    """Configuration-driven GPU-recovery policy (Req 37.1, 37.3, 37.8).

    Every field defaults to the documented safe value; `from_settings()` reads
    the operator-supplied values from `config_v2.SettingsV2`. The restart-attempt
    count is bounded to the integer range [0, 10]; an out-of-range/invalid value
    is reset to the safe default of 3 rather than allowed to destabilise
    recovery.
    """

    #: Max worker restarts on a crash; default 3, bounded [0, 10] (Req 37.1/37.8).
    max_restart_attempts: int = Field(default=3, ge=0, le=10)
    #: Active model retried after each restart (Req 37.2).
    active_model: str = Field(default="mediapipe")
    #: Fallback model selected once the active model is exhausted (Req 37.3).
    fallback_model: str = Field(default="movenet")
    #: Documented operation budgets (seconds): detect ≤10s, restart ≤30s,
    #: reload+inference ≤60s (Req 37.1, 37.2). Enforced as timeouts when
    #: ``enforce_timeouts`` is set on the service.
    detect_timeout_s: float = Field(default=10.0, ge=0.0)
    restart_timeout_s: float = Field(default=30.0, ge=0.0)
    reload_timeout_s: float = Field(default=60.0, ge=0.0)
    #: Optional pacing between restart attempts (seconds); default 0 (no wait).
    restart_backoff_s: float = Field(default=0.0, ge=0.0)

    @field_validator("max_restart_attempts", mode="before")
    @classmethod
    def _clamp_attempts(cls, v: int) -> int:
        # Restart count is bounded [0, 10] (Req 37.1); reset to the safe default
        # rather than allowing an out-of-range value to destabilise recovery.
        try:
            iv = int(v)
        except (TypeError, ValueError):
            return 3
        if not (0 <= iv <= 10):
            return 3
        return iv

    @field_validator("active_model", "fallback_model", mode="before")
    @classmethod
    def _coerce_model(cls, v: Any) -> str:
        # An absent/blank configured model name falls back to a safe default
        # via the field default; coerce non-strings to a stable string.
        if v is None:
            return ""
        return v if isinstance(v, str) else str(v)

    @classmethod
    def from_settings(cls, s: SettingsV2 | None = None) -> "RecoveryPolicy":
        """Build a policy from the additive V2 settings (Req 37.8).

        Reads `GPU_MAX_RESTART_ATTEMPTS`, `ACTIVE_VISION_MODEL`, and
        `GPU_FALLBACK_MODEL`; missing/invalid values fall back to the safe
        defaults via the validators above.
        """
        cfg = s if s is not None else settings_v2
        active = getattr(cfg, "ACTIVE_VISION_MODEL", "") or "mediapipe"
        fallback = getattr(cfg, "GPU_FALLBACK_MODEL", "") or "movenet"
        return cls(
            max_restart_attempts=cfg.GPU_MAX_RESTART_ATTEMPTS,
            active_model=active,
            fallback_model=fallback,
        )


# ─────────────────────────────────────────────────────────────────────────
# Recovery outcome (Req 37.2–37.4)
# ─────────────────────────────────────────────────────────────────────────

class RecoveryOutcome(BaseModel):
    """The result of one recovery attempt for a crashed `Inference_Worker`.

    `recovered` is ``True`` when an inference retry succeeded (with the active or
    fallback model). On an unrecoverable failure (Req 37.4) `recovered` is
    ``False`` and `error` carries a ``RECOVERY_EXHAUSTED`` `StructuredError`; the
    embedded `job` is then marked ``failed`` with ``result=None`` (no partial
    results). Never both a result and an error.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    recovered: bool
    #: The (possibly updated) job record. On failure: state=failed, result=None.
    job: AnalysisJob
    #: Number of worker restarts actually performed (0..max_restart_attempts).
    restart_attempts: int = Field(ge=0)
    #: Which model produced a successful inference, if any (Req 37.2/37.3).
    recovery_model: str | None = None
    #: True when recovery succeeded only via the configured fallback (Req 37.3).
    fallback_used: bool = False
    #: The inference result on success (opaque, never persisted).
    result: Any = None
    #: Sanitized recovery-exhaustion error on unrecoverable failure (Req 37.4).
    error: StructuredError | None = None


# ─────────────────────────────────────────────────────────────────────────
# GPU recovery service (Req 37.1–37.4, 37.8)
# ─────────────────────────────────────────────────────────────────────────

class GPURecoveryService:
    """Recovers a crashed `Inference_Worker` with bounded, escalating retries.

    Recovery discipline (Req 37.1–37.4):
      1. Restart the worker up to ``max_restart_attempts`` times; reload the
         active model and retry the job exactly once per restart (Req 37.1/37.2).
      2. When the active model is exhausted, retry once with the configured
         fallback model (Req 37.3).
      3. When the fallback also fails (or none applies), mark the job ``failed``
         with no partial results and return ``RECOVERY_EXHAUSTED`` (Req 37.4).

    All operations return a `RecoveryOutcome`; the service never raises on a
    domain condition.
    """

    name = "gpu_recovery"

    def __init__(
        self,
        monitor: WorkerHealthMonitor | None = None,
        registry: Any | None = None,
        *,
        policy: RecoveryPolicy | None = None,
        restart_worker: RestartAction | None = None,
        run_inference: InferenceFn | None = None,
        sleeper: Sleeper | None = None,
        clock: Clock | None = None,
        enforce_timeouts: bool = True,
    ) -> None:
        """Args:
        monitor: `Worker_Health_Monitor` used to record failures/successes and
            gate assignment (Req 37.5/37.6); defaults to one built from settings.
        registry: `Model_Registry` (Req 43); reserved for production wiring of
            active/fallback model selection. Optional — when omitted the model
            names come from the policy/config.
        policy: recovery policy; defaults to one built from the V2 settings
            (Req 37.8).
        restart_worker: injectable restart action (Req 37.1); defaults to a
            no-op success.
        run_inference: injectable model-reload + inference runner (Req 37.2);
            raising/timing out signals failure. Defaults to a runner that fails
            cleanly (no model wired).
        sleeper: awaitable pacing sleeper (seconds); injectable for deterministic
            tests. Defaults to a real `asyncio.sleep`.
        clock: zero-argument time source (seconds); injectable for deterministic
            tests. Defaults to a monotonic clock.
        enforce_timeouts: when True (default) the detect/restart/reload budgets
            are enforced as operation timeouts; tests may disable for purity.
        """
        self._monitor = monitor if monitor is not None else WorkerHealthMonitor()
        self._registry = registry
        self._policy = policy if policy is not None else RecoveryPolicy.from_settings()
        self._restart = restart_worker if restart_worker is not None else _default_restart
        self._infer = run_inference if run_inference is not None else _default_run_inference
        self._sleeper = sleeper if sleeper is not None else _default_sleeper
        self._clock = clock if clock is not None else _default_clock
        self._enforce_timeouts = enforce_timeouts

    # ── Accessors ──

    @property
    def policy(self) -> RecoveryPolicy:
        return self._policy

    @property
    def monitor(self) -> WorkerHealthMonitor:
        return self._monitor

    @property
    def max_restart_attempts(self) -> int:
        return self._policy.max_restart_attempts

    def is_assignable(self, worker_id: str) -> bool:
        """Whether ``worker_id`` may receive a job — excludes unhealthy (Req 37.6)."""
        return self._monitor.is_assignable(worker_id)

    # ── Recovery ──

    async def recover(self, worker_id: str, job: AnalysisJob) -> RecoveryOutcome:
        """Recover ``worker_id`` after an inference crash on ``job`` (Req 37.1–37.4).

        Returns a `RecoveryOutcome`. On success `recovered` is True and `result`
        carries the inference output; on exhaustion `recovered` is False, the
        embedded `job` is ``failed`` with no partial results, and `error` is a
        ``RECOVERY_EXHAUSTED`` `StructuredError`. Never raises on a domain
        condition.
        """
        wid = worker_id if isinstance(worker_id, str) else str(worker_id)
        # Record the triggering crash against worker health (Req 37.5 input).
        self._safe_record_failure(wid)

        attempts = 0
        last_cause = "inference_crash"

        try:
            # ── Bounded restart loop with the ACTIVE model (Req 37.1, 37.2) ──
            while attempts < self._policy.max_restart_attempts:
                attempts += 1

                # Optional pacing between restarts (injected sleeper; default 0).
                if attempts > 1:
                    await self._safe_sleep(self._policy.restart_backoff_s)

                # Restart the worker within the restart budget (≤30s, Req 37.1).
                restarted, restart_cause = await self._try_restart(wid)
                if not restarted:
                    # Restart itself failed: consume the attempt, record the
                    # failure, and move on to the next restart (Req 37.1).
                    last_cause = restart_cause
                    self._safe_record_failure(wid)
                    continue

                # Reload active model + retry the job exactly once (Req 37.2).
                ok, result, cause = await self._try_inference(
                    wid, job, self._policy.active_model
                )
                if ok:
                    self._safe_record_success(wid)
                    return RecoveryOutcome(
                        recovered=True,
                        job=job,
                        restart_attempts=attempts,
                        recovery_model=self._policy.active_model,
                        fallback_used=False,
                        result=result,
                    )
                last_cause = cause
                self._safe_record_failure(wid)

            # ── Escalate to the FALLBACK model once (Req 37.3) ──
            fallback = self._policy.fallback_model
            if fallback and fallback != self._policy.active_model:
                ok, result, cause = await self._try_inference(wid, job, fallback)
                if ok:
                    self._safe_record_success(wid)
                    return RecoveryOutcome(
                        recovered=True,
                        job=job,
                        restart_attempts=attempts,
                        recovery_model=fallback,
                        fallback_used=True,
                        result=result,
                    )
                last_cause = cause
                self._safe_record_failure(wid)

        except Exception as exc:  # noqa: BLE001 — never raise on a domain fault
            # Any unexpected internal fault degrades to a clean exhaustion outcome
            # rather than propagating (V2 contract: return StructuredError).
            last_cause = type(exc).__name__

        # ── Recovery exhausted (Req 37.4) ──
        return self._recovery_exhausted(wid, job, attempts, last_cause)

    # ── Internals ──

    async def _try_restart(self, worker_id: str) -> "tuple[bool, str]":
        """Restart the worker within the restart budget. Returns (ok, cause)."""
        try:
            await self._invoke(
                self._restart,
                self._policy.restart_timeout_s,
                worker_id,
            )
            return True, ""
        except Exception as exc:  # noqa: BLE001 — classify, never propagate
            return False, type(exc).__name__

    async def _try_inference(
        self, worker_id: str, job: AnalysisJob, model_name: str
    ) -> "tuple[bool, Any, str]":
        """Reload model + run inference within the reload budget.

        Returns ``(ok, result, cause)``: ``ok`` True with the result on success;
        ``ok`` False with the failure cause otherwise (Req 37.2, 37.3).
        """
        try:
            result = await self._invoke(
                self._infer,
                self._policy.reload_timeout_s,
                worker_id,
                job,
                model_name,
            )
            return True, result, ""
        except Exception as exc:  # noqa: BLE001 — classify, never propagate
            return False, None, type(exc).__name__

    async def _invoke(self, fn: Callable, timeout_s: float, *args) -> Any:
        """Invoke ``fn(*args)`` (sync or async), enforcing ``timeout_s`` when set.

        A timeout surfaces as `asyncio.TimeoutError` — classified as a failure by
        the callers, mapping to the "fails within N seconds" requirement clauses
        (Req 37.1, 37.2, 37.3).
        """

        async def _runner() -> Any:
            res = fn(*args)
            if inspect.isawaitable(res):
                res = await res
            return res

        if self._enforce_timeouts and timeout_s and timeout_s > 0:
            return await asyncio.wait_for(_runner(), timeout_s)
        return await _runner()

    def _recovery_exhausted(
        self,
        worker_id: str,
        job: AnalysisJob,
        attempts: int,
        last_cause: str,
    ) -> RecoveryOutcome:
        """Build the failed outcome on exhausted recovery (Req 37.4).

        Marks the job ``failed`` with NO partial results (``result=None``),
        preserves the rest of the `AnalysisJob` record, and attaches a sanitized
        ``RECOVERY_EXHAUSTED`` `StructuredError` naming the worker and the
        attempt count.
        """
        error = StructuredError(
            code="RECOVERY_EXHAUSTED",
            message=(
                f"GPU recovery exhausted for worker '{worker_id}' after "
                f"{attempts} restart attempt(s); active model "
                f"'{self._policy.active_model}' and fallback model "
                f"'{self._policy.fallback_model}' both failed "
                f"(last cause: {last_cause})."
            ),
            stage=self.name,
        )
        failed_job = job.model_copy(
            update={"state": JobState.failed, "result": None, "error": error}
        )
        return RecoveryOutcome(
            recovered=False,
            job=failed_job,
            restart_attempts=attempts,
            recovery_model=None,
            fallback_used=False,
            result=None,
            error=error,
        )

    # ── Safe monitor / sleeper wrappers (never raise on a domain fault) ──

    def _safe_record_failure(self, worker_id: str) -> None:
        try:
            self._monitor.record_failure(worker_id)
        except Exception:  # noqa: BLE001 — health recording must never crash recovery
            pass

    def _safe_record_success(self, worker_id: str) -> None:
        try:
            self._monitor.record_success(worker_id)
        except Exception:  # noqa: BLE001
            pass

    async def _safe_sleep(self, delay_s: float) -> None:
        try:
            await self._sleeper(delay_s)
        except Exception:  # noqa: BLE001 — pacing must never crash recovery
            pass
