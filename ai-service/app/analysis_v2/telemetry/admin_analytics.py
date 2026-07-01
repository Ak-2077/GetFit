"""
Stage 45 · Admin_Analytics_Service (Req 46)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** telemetry service that composes the anonymous,
aggregate views already produced by the V1 `Analytics_Service`
(app/analysis/analytics.py) and the V2 `Cost_Tracking_Service`
(cost_tracking.py) — plus benchmark sample counts and a small set of live
operational gauges — into ONE anonymous admin metrics snapshot for the
`Admin_Dashboard` (design.md "Stage 45 · Admin_Analytics_Service"). It never
modifies a V1 stage, contract, or the client-facing `AnalysisResult`
(Req 52.1–52.4).

Behavior (Req 46):
  • Req 46.1 — the service collects, over a rolling aggregation window
    (`ADMIN_AGGREGATION_WINDOW_MIN`, default 5 min) at a recurring interval
    (`ADMIN_METRIC_INTERVAL_S`, default ≤ 60 s), every metric required by the
    dashboard: average processing time (ms), average overall Confidence_Score
    ([0.0, 1.0]), queue length (count ≥ 0), worker utilization (%, [0, 100]),
    GPU utilization (%, [0, 100]), failure rate (%, [0, 100]), exercise
    popularity (count per exercise), camera-issue frequency (count ≥ 0), retry
    count (count ≥ 0), and model usage (count per model identifier). Every
    computed value is bounded to its declared range — enforced *structurally*
    by the `AdminMetricsSnapshot` contract. The interval / window values are
    informational for this aggregate composition (design.md).
  • Req 46.5 — every collected metric excludes user-identifiable information:
    the snapshot is built ONLY from the anonymous aggregates of the V1
    `AnalyticsAggregate`, the V2 `CostAggregate`, benchmark counts, and coarse
    operational gauges. No user id, job id, video, frame, or pose ever crosses
    this boundary.
  • Req 46.6 — the service stores ONLY aggregate metrics and NEVER a per-user
    record: `AdminMetricsSnapshot` is a closed model (`extra="forbid"`) of
    counts, bounded statistics, and category→count maps whose keys are coarse
    shared labels (exercise category, model identifier) — never a user.
  • Req 46.7 — IF a metric value is unavailable for the current window (e.g. no
    analyses recorded yet, or a live gauge is not supplied), the snapshot marks
    that metric ``None`` and lists its name in ``unavailable_metrics`` as the
    unavailable indicator, while still presenting every available metric.

Replaceability (mirrors the V1 `Analytics_Service` and the V2
`Cost_Tracking_Service` / `Benchmark_Dataset_Builder`, Req 30.4 pattern): the
live operational gauges (queue length, worker / GPU utilization, camera-issue
frequency, retry count) that are NOT derivable from the aggregate views are
supplied through a replaceable `OperationalMetricsProvider` ABC, defaulting to
`NullOperationalMetricsProvider` (everything unavailable). Swapping in a real
provider (from the worker pool, GPU monitor, queue adapter, …) requires no
change to the service or any Pipeline_Stage. Collection configuration is read
from `config_v2`, never hardcoded.

Never raises: composing a snapshot is a cheap, off-hot-path read of existing
aggregates. Any failure while reading a source is contained — the affected
metric is simply marked unavailable — so the admin view degrades gracefully
and never disrupts the surrounding flow (Req 46.7).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ..config_v2 import settings_v2

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.analysis.analytics import AnalyticsService
    from .benchmark_builder import BenchmarkDatasetBuilder
    from .cost_tracking import CostTrackingService


# ── Live operational gauges (not derivable from the aggregate views) ──────

class OperationalGauges(BaseModel):
    """
    The point-in-time operational inputs that the V1 / V2 aggregate views do
    not carry: queue depth, worker / GPU utilization, camera-issue frequency,
    and retry count (Req 46.1).

    Every field is Optional — ``None`` means "unavailable for this window"
    (Req 46.7) — and is bounded to its declared range structurally: counts are
    ``ge=0`` and utilizations are percentages in ``[0, 100]``. The gauges are
    anonymous and aggregate: a count or a percentage, never a per-user row
    (Req 46.5, 46.6).
    """
    model_config = ConfigDict(extra="forbid")

    queue_length: int | None = Field(default=None, ge=0)
    worker_utilization_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    gpu_utilization_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    camera_issue_frequency: int | None = Field(default=None, ge=0)
    retry_count: int | None = Field(default=None, ge=0)


class OperationalMetricsProvider(ABC):
    """
    Replaceable source of the live operational gauges (Req 46.1).

    Mirrors the `CostSink` / `AnalyticsSink` ABC convention: a stable, minimal
    contract behind which any real source (worker pool, GPU monitor, queue
    adapter, …) can be swapped WITHOUT touching the `AdminAnalyticsService`.
    Implementations MUST return only anonymous, aggregate gauges and MUST NOT
    surface any user-identifiable information (Req 46.5, 46.6). A provider
    SHOULD NOT raise — an unavailable gauge is expressed as ``None``.
    """

    #: Stable identifier, e.g. "null". Used as the registry key.
    name: str = "base"

    @abstractmethod
    def gauges(self) -> OperationalGauges:
        """Return the current anonymous operational gauges."""
        raise NotImplementedError


class NullOperationalMetricsProvider(OperationalMetricsProvider):
    """
    Default zero-dependency provider: every live gauge is unavailable (Req 46.7).

    Suitable when no operational source is wired up yet — the dashboard still
    receives all analytics/cost-derived metrics and an unavailable indicator for
    each live gauge. Replace with a real provider by swapping the constructor arg.
    """

    name = "null"

    def gauges(self) -> OperationalGauges:
        return OperationalGauges()


class StaticOperationalMetricsProvider(OperationalMetricsProvider):
    """
    Simple provider that returns a fixed `OperationalGauges` value.

    Useful for wiring a caller that already holds the current gauges, and for
    tests. Stores only the anonymous aggregate gauges it is given.
    """

    name = "static"

    def __init__(self, gauges: OperationalGauges | None = None) -> None:
        self._gauges = gauges or OperationalGauges()

    def gauges(self) -> OperationalGauges:
        return self._gauges


# ── Aggregate admin snapshot (anonymous, bounded, Req 46.1/46.5/46.6) ─────

class AdminMetricsSnapshot(BaseModel):
    """
    The single anonymous, aggregate admin view presented to the `Admin_Dashboard`
    (Req 46.1).

    `extra="forbid"` makes the privacy guarantee structural: only the bounded,
    aggregate fields below may ever appear — no user id, job id, video, frame,
    or pose (Req 46.5, 46.6). Each numeric metric is bounded to its declared
    range (percentages ``[0, 100]``, counts ``ge=0``, confidence ``[0.0, 1.0]``).
    A metric that is unavailable for the current window is ``None`` AND named in
    ``unavailable_metrics`` (Req 46.7); the ``per``-category maps
    (`exercise_popularity`, `model_usage`) key on coarse shared labels only.
    """
    model_config = ConfigDict(extra="forbid")

    #: Number of analyses aggregated into this window (0 ⇒ averages unavailable).
    sample_count: int = Field(0, ge=0)

    # ── Analytics-derived metrics (from V1 AnalyticsAggregate) ──
    #: Mean processing time in ms; ``None`` when no analyses in window (Req 46.7).
    avg_processing_time_ms: float | None = Field(default=None, ge=0.0)
    #: Mean overall Confidence_Score in [0.0, 1.0]; ``None`` when unavailable.
    avg_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    #: Failure rate as a percentage in [0, 100]; ``None`` when unavailable.
    failure_rate_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    #: Exercise popularity: count per (coarse) exercise category (Req 46.1).
    exercise_popularity: dict[str, int] = Field(default_factory=dict)

    # ── Live operational gauges (from OperationalMetricsProvider) ──
    #: Queue length, count ≥ 0; ``None`` when unavailable (Req 46.7).
    queue_length: int | None = Field(default=None, ge=0)
    #: Worker utilization percentage in [0, 100]; ``None`` when unavailable.
    worker_utilization_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    #: GPU utilization percentage in [0, 100]; ``None`` when unavailable.
    gpu_utilization_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    #: Camera-issue frequency, count ≥ 0; ``None`` when unavailable.
    camera_issue_frequency: int | None = Field(default=None, ge=0)
    #: Retry count, count ≥ 0; ``None`` when unavailable.
    retry_count: int | None = Field(default=None, ge=0)

    # ── Cost/benchmark-derived metrics (from V2 CostAggregate + benchmark) ──
    #: Model usage: count per model identifier (Req 46.1).
    model_usage: dict[str, int] = Field(default_factory=dict)
    #: Number of benchmark samples collected in the window, count ≥ 0.
    benchmark_sample_count: int = Field(0, ge=0)

    # ── Unavailable indicator + informational collection config (Req 46.7) ──
    #: Names of the metrics that are unavailable for this window (Req 46.7).
    unavailable_metrics: list[str] = Field(default_factory=list)
    #: Informational: the configured emission interval and window (Req 46.1).
    interval_seconds: int = Field(0, ge=0)
    window_minutes: int = Field(0, ge=0)


# ── Service (composes V1 + V2 aggregates, Req 46) ────────────────────────

class AdminAnalyticsService:
    """
    Composes the anonymous admin metrics snapshot for the `Admin_Dashboard`
    (Req 46).

    The service owns NO per-analysis storage of its own. It reads the anonymous
    aggregate views already maintained by the injected V1 `AnalyticsService` and
    V2 `CostTrackingService` (and an optional `BenchmarkDatasetBuilder`), adds
    the live gauges from a replaceable `OperationalMetricsProvider`, and folds
    them into ONE bounded `AdminMetricsSnapshot` (Req 46.1). Every value is
    anonymous and aggregate (Req 46.5, 46.6), any missing value is marked
    unavailable (Req 46.7), and collection NEVER raises.
    """

    def __init__(
        self,
        analytics_service: "AnalyticsService",
        cost_service: "CostTrackingService",
        *,
        benchmark_builder: "BenchmarkDatasetBuilder | None" = None,
        gauges_provider: OperationalMetricsProvider | None = None,
        enabled: bool | None = None,
        metric_interval_s: int | None = None,
        aggregation_window_min: int | None = None,
    ) -> None:
        self.analytics_service = analytics_service
        self.cost_service = cost_service
        self.benchmark_builder = benchmark_builder
        self.gauges_provider: OperationalMetricsProvider = (
            gauges_provider or NullOperationalMetricsProvider()
        )
        self.enabled: bool = (
            settings_v2.ADMIN_ANALYTICS_ENABLED if enabled is None else enabled
        )
        #: Informational collection cadence (Req 46.1). Composing the snapshot is
        #: a cheap read, so these bounds are naturally met; exposed for the view.
        self.metric_interval_s: int = (
            settings_v2.ADMIN_METRIC_INTERVAL_S
            if metric_interval_s is None
            else metric_interval_s
        )
        self.aggregation_window_min: int = (
            settings_v2.ADMIN_AGGREGATION_WINDOW_MIN
            if aggregation_window_min is None
            else aggregation_window_min
        )

    def collect(self) -> AdminMetricsSnapshot:
        """
        Compose and return the current anonymous admin metrics snapshot (Req 46.1).

        Reads the V1 `AnalyticsAggregate`, the V2 `CostAggregate`, benchmark
        counts, and the live operational gauges, mapping each into its bounded
        field. A metric with no data in the window (or a gauge not supplied) is
        left ``None`` and named in ``unavailable_metrics`` (Req 46.7). NEVER
        raises — a failure reading any single source degrades only that metric.

        When the service is disabled (``ADMIN_ANALYTICS_ENABLED`` false) it
        returns an empty, all-unavailable snapshot (still a valid dashboard
        view) without touching any source.
        """
        unavailable: list[str] = []

        if not self.enabled:
            return self._all_unavailable_snapshot()

        # ── Analytics-derived metrics (anonymous aggregate, Req 46.5) ──
        sample_count = 0
        avg_processing_time_ms: float | None = None
        avg_confidence: float | None = None
        failure_rate_pct: float | None = None
        exercise_popularity: dict[str, int] = {}
        try:
            agg = self.analytics_service.snapshot()
            sample_count = agg.sample_count
            if agg.sample_count > 0:
                avg_processing_time_ms = agg.avg_processing_time_ms
                avg_confidence = agg.avg_confidence
                # failure_rate is a fraction [0,1]; present as a percentage.
                failure_rate_pct = _to_percentage(agg.failure_rate)
            exercise_popularity = {
                ex.exercise_id: ex.count for ex in agg.top_exercises
            }
        except Exception:  # noqa: BLE001 - never raise; degrade the metric
            pass

        # ── Cost/benchmark-derived metrics (anonymous aggregate, Req 46.5) ──
        model_usage: dict[str, int] = {}
        try:
            cost_agg = self.cost_service.snapshot()
            model_usage = {
                model: breakdown.sample_count
                for model, breakdown in cost_agg.per_model.items()
            }
        except Exception:  # noqa: BLE001
            pass

        benchmark_sample_count = 0
        if self.benchmark_builder is not None:
            try:
                benchmark_sample_count = self.benchmark_builder.export().sample_count
            except Exception:  # noqa: BLE001
                pass

        # ── Live operational gauges (replaceable provider, Req 46.7) ──
        gauges = OperationalGauges()
        try:
            gauges = self.gauges_provider.gauges()
        except Exception:  # noqa: BLE001
            pass

        snapshot = AdminMetricsSnapshot(
            sample_count=sample_count,
            avg_processing_time_ms=avg_processing_time_ms,
            avg_confidence=avg_confidence,
            failure_rate_pct=failure_rate_pct,
            exercise_popularity=exercise_popularity,
            queue_length=gauges.queue_length,
            worker_utilization_pct=gauges.worker_utilization_pct,
            gpu_utilization_pct=gauges.gpu_utilization_pct,
            camera_issue_frequency=gauges.camera_issue_frequency,
            retry_count=gauges.retry_count,
            model_usage=model_usage,
            benchmark_sample_count=benchmark_sample_count,
            interval_seconds=self.metric_interval_s,
            window_minutes=self.aggregation_window_min,
        )

        # Req 46.7: every ``None`` metric is surfaced via the unavailable list.
        snapshot.unavailable_metrics = _collect_unavailable(snapshot)
        return snapshot

    def _all_unavailable_snapshot(self) -> AdminMetricsSnapshot:
        """Empty snapshot with every value metric marked unavailable (Req 46.7)."""
        snapshot = AdminMetricsSnapshot(
            interval_seconds=self.metric_interval_s,
            window_minutes=self.aggregation_window_min,
        )
        snapshot.unavailable_metrics = _collect_unavailable(snapshot)
        return snapshot


# ── Helpers ──────────────────────────────────────────────────────────────

#: The value metrics whose absence is surfaced through ``unavailable_metrics``
#: (Req 46.7). Map fields (`exercise_popularity`, `model_usage`) and counts that
#: default to 0 (`benchmark_sample_count`) are always present, so they are not
#: listed here — only the Optional value metrics can be "unavailable".
_UNAVAILABLE_CANDIDATES: tuple[str, ...] = (
    "avg_processing_time_ms",
    "avg_confidence",
    "failure_rate_pct",
    "queue_length",
    "worker_utilization_pct",
    "gpu_utilization_pct",
    "camera_issue_frequency",
    "retry_count",
)


def _to_percentage(fraction: float) -> float:
    """Map a [0,1] fraction to a [0,100] percentage, clamped to the range."""
    pct = fraction * 100.0
    if pct < 0.0:
        return 0.0
    if pct > 100.0:
        return 100.0
    return pct


def _collect_unavailable(snapshot: AdminMetricsSnapshot) -> list[str]:
    """Return the names of the Optional value metrics that are ``None`` (Req 46.7)."""
    return [
        name
        for name in _UNAVAILABLE_CANDIDATES
        if getattr(snapshot, name) is None
    ]
