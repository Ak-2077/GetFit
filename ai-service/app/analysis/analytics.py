"""
Analytics_Service — anonymous, aggregate system-health metrics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Collects anonymous, aggregate operational metrics so a Maintainer can monitor
system health WITHOUT compromising End_User privacy (Req 30).

The metrics collected are exactly those required by Req 30.1:
  • average processing time
  • failure rate
  • most-analyzed exercises ("top exercises")
  • average overall Confidence_Score
  • low-confidence occurrence frequency
  • analysis duration
  • cleanup-failure count
  • queue wait time

Privacy invariants (Req 30.2, 30.3) are enforced *structurally* rather than by
convention:
  • `AnalysisMetricRecord` is a closed Pydantic model (`extra="forbid"`) whose
    only fields are bounded numbers, booleans, and a coarse exercise category.
    It carries NO original video, NO extracted frames, NO pose images, and NO
    End_User identifying information (no user id, no job id, no file paths).
  • Every aggregate exposed by the service is a count or a bounded statistic
    computed across records — never a per-user row.

Replaceability (Req 30.4) mirrors the proven `VisionBackend`/`VisionAdapter`
and `Smoothing_Algorithm` registry conventions used across this package:
  • `AnalyticsSink` is an ABC — the single interface behind which any storage
    backend (in-memory, time-series DB, StatsD, …) can be swapped WITHOUT
    touching any Pipeline_Stage.
  • `AnalyticsService` holds a sink and exposes the recording/aggregation API.
    Swapping the sink is a constructor argument; nothing else changes.
  • Collection configuration (low-confidence threshold, top-N exercises) is
    read from configuration, never hardcoded into a stage (Req 30.4).

This module performs NO language-model reasoning and never touches the
analysis hot path — recording is a cheap, side-effect-only operation.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections import Counter

from pydantic import BaseModel, ConfigDict, Field

from ..core.config import settings
from .contracts import CleanupReport
from .jobs import AnalysisJob, JobState

# ── Configuration defaults (Req 30.4) ────────────────────────────────────
# Read from configuration with safe documented defaults so the service behaves
# correctly even when an operator sets nothing. `getattr` keeps this additive —
# no existing `Settings` field has to change for analytics to work.

#: Overall Confidence_Score below this value counts as a low-confidence
#: occurrence (Req 30.1 low-confidence frequency). Defaults to the pipeline's
#: overall-confidence floor so the analytics view matches the gating threshold.
_LOW_CONFIDENCE_THRESHOLD: float = float(
    getattr(settings, "ANALYTICS_LOW_CONFIDENCE_THRESHOLD",
            getattr(settings, "OVERALL_CONFIDENCE_MIN", 0.3))
)

#: How many of the most-analyzed exercises to surface in `top_exercises`.
_TOP_EXERCISES_N: int = int(getattr(settings, "ANALYTICS_TOP_EXERCISES_N", 5))


# ── Per-analysis metric record (anonymous, Req 30.2, 30.3) ───────────────

class AnalysisMetricRecord(BaseModel):
    """
    One anonymous metric observation for a single completed analysis.

    `extra="forbid"` makes the privacy guarantee structural: any attempt to
    record a disallowed field (e.g. `user_id`, `job_id`, a frame, a file path,
    a video handle) raises at construction time rather than silently leaking
    into analytics (Req 30.2, 30.3). Every field below is either a bounded
    number, a boolean, or the coarse exercise *category* — none of which can
    identify an individual End_User.
    """

    model_config = ConfigDict(extra="forbid")

    #: Detected exercise category for "most-analyzed exercises" (Req 30.1).
    #: A coarse, shared label (e.g. "squat") — not user-identifying.
    exercise_id: str = ""
    #: Wall-clock processing time of the analysis stages, milliseconds (Req 30.1).
    processing_time_ms: float = Field(0.0, ge=0.0)
    #: End-to-end analysis duration, milliseconds (Req 30.1).
    duration_ms: float = Field(0.0, ge=0.0)
    #: Time the job waited in the queue before processing began, ms (Req 30.1).
    queue_wait_ms: float = Field(0.0, ge=0.0)
    #: Fused overall Confidence_Score for the analysis, bounded [0,1] (Req 30.1).
    overall_confidence: float = Field(0.0, ge=0.0, le=1.0)
    #: True when the analysis was marked low confidence (Req 30.1 frequency).
    low_confidence: bool = False
    #: True when the analysis terminated in `JobState.failed` (Req 30.1 failure rate).
    failed: bool = False
    #: True when temporary-artifact cleanup did not fully complete (Req 30.1).
    cleanup_failed: bool = False

    @classmethod
    def from_job(
        cls,
        job: AnalysisJob,
        *,
        processing_time_ms: float = 0.0,
        duration_ms: float = 0.0,
        queue_wait_ms: float = 0.0,
        cleanup_report: CleanupReport | None = None,
    ) -> "AnalysisMetricRecord":
        """
        Build an anonymous record from a terminal `AnalysisJob`.

        Deliberately reads ONLY non-identifying fields from the job: the
        terminal `state`, and — when present — the persisted result's coarse
        `exercise_id`, `overall_confidence`, and `low_confidence` flag. The
        job's `user_id`, `job_id`, raw video, frames, and pose data are NEVER
        copied (Req 30.2, 30.3). Cleanup success is derived from the
        `CleanupReport.complete` flag (Req 12.4 → 30.1 cleanup-failure count).
        """
        result = job.result
        return cls(
            exercise_id=result.exercise_id if result is not None else "",
            processing_time_ms=processing_time_ms,
            duration_ms=duration_ms,
            queue_wait_ms=queue_wait_ms,
            overall_confidence=(
                result.overall_confidence if result is not None else 0.0
            ),
            low_confidence=(result.low_confidence if result is not None else False),
            failed=(job.state == JobState.failed),
            cleanup_failed=(
                cleanup_report is not None and not cleanup_report.complete
            ),
        )


# ── Aggregate snapshot (anonymous, Req 30.1) ─────────────────────────────

class ExerciseCount(BaseModel):
    """A single most-analyzed exercise tally (Req 30.1 top exercises)."""
    exercise_id: str
    count: int = Field(..., ge=0)


class AnalyticsAggregate(BaseModel):
    """
    The anonymous, aggregate view exposed to a Maintainer (Req 30.1, 30.3).

    Every field is a count or a bounded statistic computed across recorded
    observations — there is no per-user row anywhere in this structure.
    """

    #: Number of analyses aggregated into this snapshot.
    sample_count: int = Field(0, ge=0)
    #: Mean processing time across analyses, milliseconds (Req 30.1).
    avg_processing_time_ms: float = Field(0.0, ge=0.0)
    #: Fraction of analyses that failed, bounded [0,1] (Req 30.1).
    failure_rate: float = Field(0.0, ge=0.0, le=1.0)
    #: Most-analyzed exercises, ranked by count descending (Req 30.1).
    top_exercises: list[ExerciseCount] = Field(default_factory=list)
    #: Mean overall Confidence_Score across analyses, bounded [0,1] (Req 30.1).
    avg_confidence: float = Field(0.0, ge=0.0, le=1.0)
    #: Fraction of analyses flagged low confidence, bounded [0,1] (Req 30.1).
    low_confidence_frequency: float = Field(0.0, ge=0.0, le=1.0)
    #: Mean end-to-end analysis duration, milliseconds (Req 30.1).
    avg_duration_ms: float = Field(0.0, ge=0.0)
    #: Number of analyses whose temporary-artifact cleanup failed (Req 30.1).
    cleanup_failure_count: int = Field(0, ge=0)
    #: Mean queue wait time before processing began, milliseconds (Req 30.1).
    avg_queue_wait_ms: float = Field(0.0, ge=0.0)


# ── Replaceable sink interface (Req 30.4) ────────────────────────────────

class AnalyticsSink(ABC):
    """
    The single replaceable interface behind which any analytics storage backend
    lives (Req 30.4).

    Mirrors the `SmoothingAlgorithm`/`VisionBackend` ABC convention: a stable,
    minimal contract that the `AnalyticsService` depends on, so swapping the
    backing store (in-memory, time-series DB, StatsD exporter, …) requires no
    change to any Pipeline_Stage. Implementations MUST persist only the
    anonymous `AnalysisMetricRecord` data and MUST NOT add any user-identifying
    information (Req 30.2, 30.3).
    """

    #: Stable identifier, e.g. "in_memory". Used as the registry key.
    name: str = "base"

    @abstractmethod
    def record(self, record: AnalysisMetricRecord) -> None:
        """Persist one anonymous metric observation."""
        raise NotImplementedError

    @abstractmethod
    def aggregate(self, *, top_n: int) -> AnalyticsAggregate:
        """Compute the anonymous aggregate snapshot across recorded metrics."""
        raise NotImplementedError

    @abstractmethod
    def reset(self) -> None:
        """Discard all recorded observations (e.g. for a fresh window/tests)."""
        raise NotImplementedError


class InMemoryAnalyticsSink(AnalyticsSink):
    """
    Default in-process `AnalyticsSink` (Req 30.4).

    Holds only running aggregates plus an exercise-frequency `Counter` — it does
    NOT retain individual records beyond what the aggregate needs, and stores
    nothing user-identifying (Req 30.2, 30.3). Suitable as the zero-dependency
    default; replace with a durable backend in production by swapping the sink.
    """

    name = "in_memory"

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._count: int = 0
        self._sum_processing_ms: float = 0.0
        self._sum_duration_ms: float = 0.0
        self._sum_queue_wait_ms: float = 0.0
        self._sum_confidence: float = 0.0
        self._failures: int = 0
        self._low_confidence: int = 0
        self._cleanup_failures: int = 0
        self._exercises: Counter[str] = Counter()

    def record(self, record: AnalysisMetricRecord) -> None:
        self._count += 1
        self._sum_processing_ms += record.processing_time_ms
        self._sum_duration_ms += record.duration_ms
        self._sum_queue_wait_ms += record.queue_wait_ms
        self._sum_confidence += record.overall_confidence
        if record.failed:
            self._failures += 1
        if record.low_confidence:
            self._low_confidence += 1
        if record.cleanup_failed:
            self._cleanup_failures += 1
        if record.exercise_id:
            self._exercises[record.exercise_id] += 1

    def aggregate(self, *, top_n: int) -> AnalyticsAggregate:
        n = self._count
        if n == 0:
            return AnalyticsAggregate()

        # `Counter.most_common` ranks by count descending; cap to top_n (Req 30.1).
        top = [
            ExerciseCount(exercise_id=ex, count=c)
            for ex, c in self._exercises.most_common(max(0, top_n))
        ]
        return AnalyticsAggregate(
            sample_count=n,
            avg_processing_time_ms=self._sum_processing_ms / n,
            failure_rate=self._failures / n,
            top_exercises=top,
            avg_confidence=self._sum_confidence / n,
            low_confidence_frequency=self._low_confidence / n,
            avg_duration_ms=self._sum_duration_ms / n,
            cleanup_failure_count=self._cleanup_failures,
            avg_queue_wait_ms=self._sum_queue_wait_ms / n,
        )


# ── Service (records + aggregates, Req 30.1) ─────────────────────────────

class AnalyticsService:
    """
    Collects anonymous aggregate system metrics behind a replaceable sink
    (Req 30.1–30.4).

    The service owns no storage of its own — it delegates persistence to an
    injected `AnalyticsSink`, defaulting to `InMemoryAnalyticsSink`. Collection
    configuration (low-confidence threshold, top-N exercises) is read from
    configuration (Req 30.4). Every metric it records is anonymous and
    aggregate-only, excluding video/frames/pose and End_User identity
    (Req 30.2, 30.3) — a guarantee enforced by `AnalysisMetricRecord`.
    """

    def __init__(
        self,
        sink: AnalyticsSink | None = None,
        *,
        low_confidence_threshold: float | None = None,
        top_exercises_n: int | None = None,
    ) -> None:
        self.sink: AnalyticsSink = sink or InMemoryAnalyticsSink()
        self.low_confidence_threshold: float = (
            _LOW_CONFIDENCE_THRESHOLD
            if low_confidence_threshold is None
            else low_confidence_threshold
        )
        self.top_exercises_n: int = (
            _TOP_EXERCISES_N if top_exercises_n is None else top_exercises_n
        )

    def record(self, record: AnalysisMetricRecord) -> None:
        """Forward an already-built anonymous record to the active sink."""
        self.sink.record(record)

    def record_analysis(
        self,
        *,
        exercise_id: str = "",
        processing_time_ms: float = 0.0,
        duration_ms: float = 0.0,
        queue_wait_ms: float = 0.0,
        overall_confidence: float = 0.0,
        failed: bool = False,
        cleanup_failed: bool = False,
        low_confidence: bool | None = None,
    ) -> AnalysisMetricRecord:
        """
        Build and record an anonymous observation from primitive values.

        Only bounded, non-identifying values cross this boundary. When
        `low_confidence` is not supplied, it is derived from the configured
        threshold (Req 30.4): an analysis counts as low confidence whenever its
        overall Confidence_Score is below `low_confidence_threshold`.
        """
        if low_confidence is None:
            low_confidence = overall_confidence < self.low_confidence_threshold
        record = AnalysisMetricRecord(
            exercise_id=exercise_id,
            processing_time_ms=processing_time_ms,
            duration_ms=duration_ms,
            queue_wait_ms=queue_wait_ms,
            overall_confidence=overall_confidence,
            low_confidence=low_confidence,
            failed=failed,
            cleanup_failed=cleanup_failed,
        )
        self.sink.record(record)
        return record

    def record_job(
        self,
        job: AnalysisJob,
        *,
        processing_time_ms: float = 0.0,
        duration_ms: float = 0.0,
        queue_wait_ms: float = 0.0,
        cleanup_report: CleanupReport | None = None,
    ) -> AnalysisMetricRecord:
        """
        Record an anonymous observation derived from a terminal `AnalysisJob`.

        Convenience wrapper over `AnalysisMetricRecord.from_job` that strips all
        identifying fields (user id, job id, raw artifacts) before persisting
        (Req 30.2, 30.3).
        """
        record = AnalysisMetricRecord.from_job(
            job,
            processing_time_ms=processing_time_ms,
            duration_ms=duration_ms,
            queue_wait_ms=queue_wait_ms,
            cleanup_report=cleanup_report,
        )
        self.sink.record(record)
        return record

    def snapshot(self) -> AnalyticsAggregate:
        """Return the current anonymous aggregate snapshot (Req 30.1, 30.3)."""
        return self.sink.aggregate(top_n=self.top_exercises_n)

    def reset(self) -> None:
        """Clear all recorded observations from the active sink."""
        self.sink.reset()


def build_analytics_sink_registry() -> dict[str, AnalyticsSink]:
    """
    Instantiate every known `AnalyticsSink` ONCE, keyed by `name`.

    Mirrors `build_smoothing_registry`/`build_pose_engine_registry`. Adding a
    durable backend = implement `AnalyticsSink` and register it here; nothing
    else in the pipeline changes (Req 30.4).
    """
    sinks: list[AnalyticsSink] = [InMemoryAnalyticsSink()]
    return {sink.name: sink for sink in sinks}


#: Names of all analytics sinks known to the registry (validation/diagnostics).
ANALYTICS_SINK_NAMES: tuple[str, ...] = ("in_memory",)
