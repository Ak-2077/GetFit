"""
Stage 40 · Benchmark_Dataset_Builder (Req 41)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** telemetry component that captures incorrect
predictions — surfaced through a manual correction — as future training/eval
data, WITHOUT ever storing the original video (design.md "Stage 40 ·
Benchmark_Dataset_Builder"). It never modifies a V1 stage, contract, or the
client-facing `AnalysisResult` (Req 52.1–52.4).

Behavior (Req 41):
  • Req 41.1 — WHEN a prediction is identified as incorrect through a manual
    correction, the builder records EXACTLY ONE `BenchmarkSample` that
    corresponds to that correction. Each accepted `record(...)` appends one
    sample; a rejected recording appends nothing.
  • Req 41.2 — a `BenchmarkSample` carries an image hash, the exercise, the
    prediction, the ground truth, a confidence in [0.0, 1.0], the reason, the
    manual correction, and the pipeline version — every one present and
    non-empty. The confidence bound is enforced structurally by the
    `BenchmarkSample` contract; the non-empty check for the string fields is
    enforced here at the service layer.
  • Req 41.3 — IF any required field is missing or empty at recording time, the
    builder REJECTS the recording with
    ``StructuredError(code="BENCHMARK_SAMPLE_INCOMPLETE")``, retains the manual
    correction unchanged (the rejected sample is never stored and never
    mutated), and returns an incomplete-data indication.
  • Req 41.4 — WHEN an export is requested, the builder exports all currently
    collected `BenchmarkSample`s as a single `BenchmarkDataset`.
  • Req 41.5 — IF an export is requested while no samples have been collected,
    the builder produces an empty dataset and flags ``is_empty=True`` as the
    no-samples indication.
  • Req 41.6 — the original video (and frames/pose) is excluded from every
    `BenchmarkSample` and from the exported dataset. This is guaranteed
    *structurally*: `BenchmarkSample` references the image by `image_hash` only
    and forbids extra fields (`extra="forbid"`, models_v2), and the dataset
    carries nothing but `BenchmarkSample`s.

Gating: recording is gated by ``settings_v2.BENCHMARK_ENABLED`` (config_v2).
When disabled the builder is a no-op — no sample is stored and the client
result is never affected.

Replaceability (mirrors the V1 `Analytics_Service` and the V2
`Cost_Tracking_Service`, Req 30.4 pattern): `BenchmarkSink` is an ABC behind
which any storage backend (in-memory, object store, dataset registry, …) can be
swapped WITHOUT touching any Pipeline_Stage. `BenchmarkDatasetBuilder` owns a
sink (defaulting to `InMemoryBenchmarkSink`) and exposes the record/export API.

Never raises on a domain condition: an incomplete sample yields a failed
`StageResult`, not an exception, so the surrounding flow (and the retained
manual correction) is never disrupted.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel, ConfigDict, Field

from app.analysis.base import StageResult, StructuredError

from ..config_v2 import settings_v2
from ..models_v2 import BenchmarkSample


# ── Required, must-be-non-empty fields (Req 41.2) ────────────────────────
#
# `confidence` is intentionally NOT listed: its presence and [0.0, 1.0] bound
# are enforced structurally by the `BenchmarkSample` contract (models_v2), so a
# constructed sample always carries a valid confidence. The remaining fields are
# free-form strings that Pydantic accepts even when empty, so the "present and
# non-empty" guarantee (Req 41.2/41.3) is enforced here at the service layer.
_REQUIRED_STR_FIELDS: tuple[str, ...] = (
    "image_hash",
    "exercise",
    "prediction",
    "ground_truth",
    "reason",
    "manual_correction",
    "pipeline_version",
)


# ── Exported dataset view (Req 41.4, 41.5, 41.6) ─────────────────────────

class BenchmarkDataset(BaseModel):
    """
    The single dataset produced by an export (Req 41.4).

    Holds every collected `BenchmarkSample` plus a count and an ``is_empty``
    no-samples indication (Req 41.5). PRIVACY BOUNDARY: it contains ONLY
    `BenchmarkSample`s, each of which references its image by hash and forbids
    extra fields — so no original video / frames / pose can appear anywhere in
    the dataset (Req 41.6). ``extra="forbid"`` keeps that boundary intact.
    """
    model_config = ConfigDict(extra="forbid")

    samples: list[BenchmarkSample] = Field(default_factory=list)
    sample_count: int = Field(0, ge=0, description="Number of samples in the dataset")
    is_empty: bool = Field(True, description="No-samples indication (Req 41.5)")


# ── Replaceable sink interface (mirrors CostSink, Req 30.4 pattern) ───────

class BenchmarkSink(ABC):
    """
    The single replaceable interface behind which any benchmark-sample storage
    backend lives.

    Mirrors the `CostSink` / V1 `AnalyticsSink` convention: a stable, minimal
    contract the `BenchmarkDatasetBuilder` depends on, so swapping the backing
    store (in-memory, object store, dataset registry, …) requires no change to
    any Pipeline_Stage. Implementations MUST persist ONLY `BenchmarkSample`s and
    MUST NOT attach the original video, frames, or pose (Req 41.6).
    """

    #: Stable identifier, e.g. "in_memory". Used as the registry key.
    name: str = "base"

    @abstractmethod
    def record(self, sample: BenchmarkSample) -> None:
        """Persist exactly one benchmark sample. May raise on backend failure."""
        raise NotImplementedError

    @abstractmethod
    def export(self) -> list[BenchmarkSample]:
        """Return every collected sample, in insertion order."""
        raise NotImplementedError

    @abstractmethod
    def count(self) -> int:
        """Return the number of collected samples."""
        raise NotImplementedError

    @abstractmethod
    def reset(self) -> None:
        """Discard all collected samples (e.g. for a fresh window/tests)."""
        raise NotImplementedError


class InMemoryBenchmarkSink(BenchmarkSink):
    """
    Default in-process `BenchmarkSink`.

    Retains accepted `BenchmarkSample`s in insertion order so an export can
    faithfully return them all (Req 41.4). Stores nothing but validated samples
    — no video / frames / pose (Req 41.6). Suitable as the zero-dependency
    default; replace with a durable backend in production by swapping the sink.
    """

    name = "in_memory"

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._samples: list[BenchmarkSample] = []

    def record(self, sample: BenchmarkSample) -> None:
        self._samples.append(sample)

    def export(self) -> list[BenchmarkSample]:
        # Return a shallow copy so callers cannot mutate the stored dataset.
        return list(self._samples)

    def count(self) -> int:
        return len(self._samples)


# ── Builder (records + exports, Req 41) ──────────────────────────────────

class BenchmarkDatasetBuilder:
    """
    Records correction-derived `BenchmarkSample`s behind a replaceable sink and
    exports them as a single dataset (Req 41).

    The builder owns no storage of its own — it delegates persistence to an
    injected `BenchmarkSink`, defaulting to `InMemoryBenchmarkSink`. It records
    EXACTLY ONE sample per accepted correction (Req 41.1), rejects incomplete
    samples while retaining the manual correction (Req 41.3), exports every
    collected sample (Req 41.4) with an empty-dataset indication when none exist
    (Req 41.5), and NEVER stores the original video (Req 41.6). It NEVER raises
    on a domain condition.
    """

    #: Stable stage identifier, surfaced in a StructuredError.
    name: str = "benchmark_dataset_builder"

    def __init__(
        self,
        sink: BenchmarkSink | None = None,
        *,
        enabled: bool | None = None,
    ) -> None:
        self.sink: BenchmarkSink = sink or InMemoryBenchmarkSink()
        self.enabled: bool = (
            settings_v2.BENCHMARK_ENABLED if enabled is None else enabled
        )

    def record(self, sample: BenchmarkSample) -> StageResult[BenchmarkSample]:
        """
        Record exactly one `BenchmarkSample` for a manual correction (Req 41.1).

        Returns a successful `StageResult` carrying the stored sample on accept,
        or a failed `StageResult` with a
        ``StructuredError(code="BENCHMARK_SAMPLE_INCOMPLETE")`` when any required
        field is missing or empty (Req 41.3). A rejected sample is NEVER stored
        and NEVER mutated, so the manual correction it carries is retained
        unchanged. This method NEVER raises on a domain condition.

        When the builder is disabled (``BENCHMARK_ENABLED`` false) recording is a
        no-op: it returns a failed `StageResult` with no error, and nothing is
        stored (the client flow is never affected).
        """
        # Gated no-op (config_v2.BENCHMARK_ENABLED). Nothing stored; not a
        # domain failure, so no StructuredError is attached.
        if not self.enabled:
            return StageResult(success=False)

        # Req 41.2/41.3: every required string field must be present + non-empty
        # (whitespace-only counts as empty). Collect ALL offenders for a
        # single, actionable indication.
        missing = [
            field
            for field in _REQUIRED_STR_FIELDS
            if not str(getattr(sample, field, "") or "").strip()
        ]
        if missing:
            # Reject; the manual correction is retained unchanged because the
            # sample is neither stored nor modified (Req 41.3).
            return StageResult(
                success=False,
                error=StructuredError(
                    code="BENCHMARK_SAMPLE_INCOMPLETE",
                    message=(
                        "benchmark sample missing or empty required field(s): "
                        f"{', '.join(missing)}; manual correction retained"
                    ),
                    stage=self.name,
                ),
            )

        # Accept: store EXACTLY ONE sample for this correction (Req 41.1).
        self.sink.record(sample)
        return StageResult(success=True, output=sample)

    def export(self) -> BenchmarkDataset:
        """
        Export all currently collected samples as one dataset (Req 41.4).

        When no samples have been collected, returns an empty dataset with
        ``is_empty=True`` as the no-samples indication (Req 41.5). The original
        video is never present — the dataset carries only `BenchmarkSample`s,
        each referencing its image by hash (Req 41.6).
        """
        samples = self.sink.export()
        return BenchmarkDataset(
            samples=samples,
            sample_count=len(samples),
            is_empty=(len(samples) == 0),
        )

    def reset(self) -> None:
        """Discard all collected samples (fresh window / tests)."""
        self.sink.reset()


def build_benchmark_sink_registry() -> dict[str, BenchmarkSink]:
    """
    Instantiate every known `BenchmarkSink` ONCE, keyed by ``name``.

    Mirrors `build_cost_sink_registry`. Adding a durable backend = implement
    `BenchmarkSink` and register it here; nothing else in the pipeline changes.
    """
    sinks: list[BenchmarkSink] = [InMemoryBenchmarkSink()]
    return {sink.name: sink for sink in sinks}


#: Names of all benchmark sinks known to the registry (validation/diagnostics).
BENCHMARK_SINK_NAMES: tuple[str, ...] = ("in_memory",)
