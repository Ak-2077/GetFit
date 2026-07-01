"""
Stage 39 · Cost_Tracking_Service (Req 40)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** telemetry service that records per-analysis resource
and cost telemetry as anonymous analytics, entirely off the analysis hot path
(design.md "Stage 39 · Cost_Tracking_Service"). It never modifies a V1 stage,
contract, or the client-facing `AnalysisResult` (Req 52.1–52.4).

At any terminal `Analysis_Job` state — whether ``completed`` or ``failed`` —
the service records exactly one anonymous `CostRecord` within 5 seconds of that
state being reached (Req 40.1). Cost data is analytics-only and is deliberately
kept separate from everything the client ever sees.

Behavior (Req 40):
  • Req 40.1 — WHEN an Analysis_Job reaches a terminal state (completed or
    failed), the service records, within 5 s, EXACTLY ONE `CostRecord`
    containing processing time, GPU memory, VRAM usage, frame count, model
    used, token count, estimated inference cost, worker id, and queue wait
    time. A repeated call for an already-recorded terminal job is idempotent —
    it never produces a second record (guaranteeing "exactly one").
  • Req 40.2 — each `CostRecord` is stored as anonymous analytics that excludes
    any user-identifying information and is NOT linked to any user account or
    `AnalysisResult` returned to the client. The `job`/`user` are used only to
    decide *whether* to record and to identify a job in a failure indication —
    never copied into the stored record.
  • Req 40.3 — every `CostRecord` field is excluded from the client
    `AnalysisResult`: this service holds cost data in a SEPARATE analytics sink
    and never writes to, wraps, or returns an `AnalysisResult`.
  • Req 40.4 — the original video, extracted frames, and pose images are
    excluded from every `CostRecord`. This is enforced *structurally* by the
    `CostRecord` contract (`extra="forbid"`, no video/frame/pose fields); a
    privacy-violating field cannot be attached (models_v2, Req 40.4).
  • Req 40.5 — IF recording a `CostRecord` fails, the service allows the
    `AnalysisResult` to be returned to the client without delay or modification
    (it never raises and never touches the result) AND returns a
    `CostRecordingFailure` identifying the affected Analysis_Job.

Replaceability (mirrors the V1 `Analytics_Service`, Req 30.4): `CostSink` is an
ABC behind which any storage backend (in-memory, time-series DB, StatsD, …) can
be swapped WITHOUT touching any Pipeline_Stage. `CostTrackingService` owns a
sink (defaulting to `InMemoryCostSink`) and exposes the recording/aggregation
API. Collection configuration is read from `config_v2`, never hardcoded.

Privacy by construction (Req 1, preserved by Req 52.5): the sink stores only
anonymous `CostRecord` aggregates — no user id, no job id, no video, frames, or
pose. The transient per-job dedup bookkeeping used to guarantee "exactly one"
is service-internal, never persisted as analytics, and carries no cost data.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ..config_v2 import settings_v2
from ..models_v2 import CostRecord

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.analysis.jobs import AnalysisJob


# ── Terminal-state detection (Req 40.1) ──────────────────────────────────
#
# The two terminal outcomes of an Analysis_Job are ``completed`` and
# ``failed`` (jobs.JobState, Req 19.5/19.6). Compared by value so this module
# stays decoupled from the V1 enum import at runtime.
_TERMINAL_STATES: frozenset[str] = frozenset({"completed", "failed"})


def _state_value(job: "AnalysisJob") -> str:
    """Return the job's state as a plain string, tolerant of enum or str."""
    state = getattr(job, "state", None)
    return getattr(state, "value", state) if state is not None else ""


# ── Non-blocking failure indication (Req 40.5) ───────────────────────────

class CostRecordingFailure(BaseModel):
    """
    Non-blocking indication that recording a `CostRecord` failed (Req 40.5).

    Identifies the affected Analysis_Job by ``job_id`` so an operator can
    correlate the miss, while the client's `AnalysisResult` is returned
    unmodified and without delay. Carries NO cost values and NO user data — it
    is a diagnostic signal only, never surfaced to the client.
    """
    job_id: str
    reason: str


# ── Aggregate views (anonymous, for admin/telemetry) ─────────────────────

class CostModelBreakdown(BaseModel):
    """
    Per-model cost rollup (totals + averages) for one ``model_used`` value.

    Anonymous and aggregate-only — a count plus bounded sums/means across the
    records attributed to that model. No per-user or per-job row.
    """
    model_used: str
    sample_count: int = Field(0, ge=0)
    total_estimated_inference_cost: float = Field(0.0, ge=0.0)
    total_token_count: int = Field(0, ge=0)
    total_frame_count: int = Field(0, ge=0)
    avg_processing_time_ms: float = Field(0.0, ge=0.0)
    avg_estimated_inference_cost: float = Field(0.0, ge=0.0)


class CostAggregate(BaseModel):
    """
    The anonymous, aggregate cost view exposed to admin/telemetry.

    Every field is a count, total, average, or per-model rollup computed across
    recorded `CostRecord`s — there is no per-user or per-job row anywhere in
    this structure (Req 40.2).
    """
    sample_count: int = Field(0, ge=0)

    # Totals across all recorded jobs.
    total_processing_time_ms: float = Field(0.0, ge=0.0)
    total_estimated_inference_cost: float = Field(0.0, ge=0.0)
    total_token_count: int = Field(0, ge=0)
    total_frame_count: int = Field(0, ge=0)

    # Averages across all recorded jobs.
    avg_processing_time_ms: float = Field(0.0, ge=0.0)
    avg_gpu_memory_mb: float = Field(0.0, ge=0.0)
    avg_vram_usage_mb: float = Field(0.0, ge=0.0)
    avg_frame_count: float = Field(0.0, ge=0.0)
    avg_token_count: float = Field(0.0, ge=0.0)
    avg_estimated_inference_cost: float = Field(0.0, ge=0.0)
    avg_queue_wait_ms: float = Field(0.0, ge=0.0)

    # Per-model breakdown, keyed by ``model_used``.
    per_model: dict[str, CostModelBreakdown] = Field(default_factory=dict)


# ── Replaceable sink interface (mirrors AnalyticsSink, Req 30.4 pattern) ──

class CostSink(ABC):
    """
    The single replaceable interface behind which any cost-telemetry storage
    backend lives.

    Mirrors the V1 `AnalyticsSink` ABC convention: a stable, minimal contract
    the `CostTrackingService` depends on, so swapping the backing store
    (in-memory, time-series DB, StatsD exporter, …) requires no change to any
    Pipeline_Stage. Implementations MUST persist only the anonymous
    `CostRecord` data and MUST NOT add any user-identifying information or any
    video / frame / pose data (Req 40.2, 40.4).
    """

    #: Stable identifier, e.g. "in_memory". Used as the registry key.
    name: str = "base"

    @abstractmethod
    def record(self, record: CostRecord) -> None:
        """Persist one anonymous cost record. May raise on backend failure."""
        raise NotImplementedError

    @abstractmethod
    def aggregate(self) -> CostAggregate:
        """Compute the anonymous aggregate cost snapshot across records."""
        raise NotImplementedError

    @abstractmethod
    def reset(self) -> None:
        """Discard all recorded observations (e.g. for a fresh window/tests)."""
        raise NotImplementedError


class InMemoryCostSink(CostSink):
    """
    Default in-process `CostSink`.

    Holds only running totals plus a per-model rollup — it does NOT retain the
    individual `CostRecord`s beyond what the aggregate needs, and stores nothing
    user-identifying (Req 40.2, 40.4). Suitable as the zero-dependency default;
    replace with a durable backend in production by swapping the sink.
    """

    name = "in_memory"

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._count: int = 0
        self._sum_processing_ms: float = 0.0
        self._sum_gpu_memory_mb: float = 0.0
        self._sum_vram_usage_mb: float = 0.0
        self._sum_frame_count: int = 0
        self._sum_token_count: int = 0
        self._sum_cost: float = 0.0
        self._sum_queue_wait_ms: float = 0.0
        # Per-model running rollups keyed by model_used.
        self._per_model: dict[str, dict[str, float]] = {}

    def record(self, record: CostRecord) -> None:
        self._count += 1
        self._sum_processing_ms += record.processing_time_ms
        self._sum_gpu_memory_mb += record.gpu_memory_mb
        self._sum_vram_usage_mb += record.vram_usage_mb
        self._sum_frame_count += record.frame_count
        self._sum_token_count += record.token_count
        self._sum_cost += record.estimated_inference_cost
        self._sum_queue_wait_ms += record.queue_wait_ms

        m = self._per_model.setdefault(
            record.model_used,
            {"count": 0.0, "cost": 0.0, "tokens": 0.0, "frames": 0.0, "processing_ms": 0.0},
        )
        m["count"] += 1
        m["cost"] += record.estimated_inference_cost
        m["tokens"] += record.token_count
        m["frames"] += record.frame_count
        m["processing_ms"] += record.processing_time_ms

    def aggregate(self) -> CostAggregate:
        n = self._count
        if n == 0:
            return CostAggregate()

        per_model: dict[str, CostModelBreakdown] = {}
        for model_used, m in self._per_model.items():
            mc = int(m["count"])
            per_model[model_used] = CostModelBreakdown(
                model_used=model_used,
                sample_count=mc,
                total_estimated_inference_cost=m["cost"],
                total_token_count=int(m["tokens"]),
                total_frame_count=int(m["frames"]),
                avg_processing_time_ms=(m["processing_ms"] / mc) if mc else 0.0,
                avg_estimated_inference_cost=(m["cost"] / mc) if mc else 0.0,
            )

        return CostAggregate(
            sample_count=n,
            total_processing_time_ms=self._sum_processing_ms,
            total_estimated_inference_cost=self._sum_cost,
            total_token_count=self._sum_token_count,
            total_frame_count=self._sum_frame_count,
            avg_processing_time_ms=self._sum_processing_ms / n,
            avg_gpu_memory_mb=self._sum_gpu_memory_mb / n,
            avg_vram_usage_mb=self._sum_vram_usage_mb / n,
            avg_frame_count=self._sum_frame_count / n,
            avg_token_count=self._sum_token_count / n,
            avg_estimated_inference_cost=self._sum_cost / n,
            avg_queue_wait_ms=self._sum_queue_wait_ms / n,
            per_model=per_model,
        )


# ── Service (records + aggregates, Req 40) ───────────────────────────────

class CostTrackingService:
    """
    Records per-analysis cost telemetry behind a replaceable sink (Req 40).

    The service owns no storage of its own — it delegates persistence to an
    injected `CostSink`, defaulting to `InMemoryCostSink`. It records EXACTLY
    ONE anonymous `CostRecord` per terminal Analysis_Job (Req 40.1), keeps that
    data entirely separate from the client `AnalysisResult` (Req 40.3), and
    NEVER raises on a domain condition — a recording failure yields a
    `CostRecordingFailure` while the result is left untouched (Req 40.5).
    """

    def __init__(
        self,
        sink: CostSink | None = None,
        *,
        enabled: bool | None = None,
        record_deadline_s: int | None = None,
    ) -> None:
        self.sink: CostSink = sink or InMemoryCostSink()
        self.enabled: bool = (
            settings_v2.COST_TRACKING_ENABLED if enabled is None else enabled
        )
        #: Informational deadline (Req 40.1). Recording is off the hot path and
        #: cheap, so the bound is naturally met; exposed for observability.
        self.record_deadline_s: int = (
            settings_v2.COST_RECORD_DEADLINE_S
            if record_deadline_s is None
            else record_deadline_s
        )
        #: Transient, service-internal dedup set guaranteeing "exactly one"
        #: record per terminal job (Req 40.1). Holds only job ids for
        #: idempotency; NEVER stored as analytics and never linked to cost data.
        self._recorded_jobs: set[str] = set()

    async def record(
        self, job: "AnalysisJob", metrics: CostRecord
    ) -> CostRecordingFailure | None:
        """
        Record exactly one anonymous `CostRecord` for a terminal job (Req 40.1).

        Returns ``None`` when the record is stored (or when there is nothing to
        do), and a `CostRecordingFailure` identifying the job when the sink
        fails (Req 40.5). This method NEVER raises on a domain condition and
        never touches the client `AnalysisResult` (Req 40.3, 40.5).

        The ``job`` is inspected only to (a) confirm it reached a terminal state,
        (b) deduplicate so exactly one record is stored, and (c) identify the
        job in a failure indication. Neither the job id nor the user id is ever
        copied into the stored `metrics` (Req 40.2).
        """
        job_id = getattr(job, "job_id", "")

        # Disabled → no-op; the client result is never affected (Req 40.3/40.5).
        if not self.enabled:
            return None

        # Only terminal jobs are recorded (Req 40.1). A non-terminal job is a
        # domain condition, not a recording failure: no record, no raise.
        if _state_value(job) not in _TERMINAL_STATES:
            return CostRecordingFailure(
                job_id=job_id, reason="job is not in a terminal state"
            )

        # Idempotency: guarantee EXACTLY ONE record per terminal job (Req 40.1).
        # A repeated call is a benign no-op — it must not add a second record.
        if job_id and job_id in self._recorded_jobs:
            return None

        try:
            self.sink.record(metrics)
        except Exception as exc:  # noqa: BLE001 - failure must never propagate
            # Req 40.5: recording failed — leave the result untouched and return
            # a non-blocking indication identifying the affected job.
            return CostRecordingFailure(
                job_id=job_id, reason=f"cost record persistence failed: {exc}"
            )

        if job_id:
            self._recorded_jobs.add(job_id)
        return None

    def snapshot(self) -> CostAggregate:
        """Return the current anonymous aggregate cost snapshot (Req 40.2)."""
        return self.sink.aggregate()

    def reset(self) -> None:
        """Clear all recorded observations and dedup bookkeeping."""
        self.sink.reset()
        self._recorded_jobs.clear()


def build_cost_sink_registry() -> dict[str, CostSink]:
    """
    Instantiate every known `CostSink` ONCE, keyed by ``name``.

    Mirrors `build_analytics_sink_registry`. Adding a durable backend = implement
    `CostSink` and register it here; nothing else in the pipeline changes.
    """
    sinks: list[CostSink] = [InMemoryCostSink()]
    return {sink.name: sink for sink in sinks}


#: Names of all cost sinks known to the registry (validation/diagnostics).
COST_SINK_NAMES: tuple[str, ...] = ("in_memory",)
