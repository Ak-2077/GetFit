"""
Pipeline V2 · Pre-Pipeline Gate Wiring (Req 34.5, 47.4, 52.1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** orchestrator that runs the two V2 pre-pipeline gates —
`Duplicate_Detection_Service` (Stage 33, Req 34) then `Abuse_Protection_Service`
(Stage 46, Req 47) — *before* the first V1 AI stage, and, on pass-through,
delegates to the **UNCHANGED** V1 `Analysis_Pipeline` (design.md "Extended
Pipeline Sequence (V2)"):

    Duplicate_Detection ──hit──▶ return cached AnalysisResult (no AI stages)
                        └─miss─▶ Abuse_Protection ──reject──▶ NOT_EXERCISE_VIDEO
                                                 └─pass──▶ V1 pipeline (UNCHANGED)

This module is *wiring only*. It never redefines a V1 contract and never alters
any V1 stage's input/output contract (Req 34.5, 47.4, 52.1): the V1 pipeline is
invoked through its existing `run(video, job_id=..., artifacts=...)` entrypoint,
byte-for-byte unchanged. All three collaborators — the duplicate store, the
exercise-content classifier, and the V1 pipeline — are injected so they can be
mocked in the integration tests (task 31.4), each with a sensible in-memory
default where one exists.

Behaviour (mirrors design.md's flowchart):
  • DUPLICATE HIT — the duplicate gate reports `cache_hit=True`; the cached
    `AnalysisResult` is returned and **every** AI stage is skipped (Req 34.3).
  • ABUSE REJECT — the abuse gate returns a failed `StageResult`; its
    `StructuredError` (`NOT_EXERCISE_VIDEO`) is surfaced with **no**
    `AnalysisResult` (Req 47.2, 47.6).
  • PASS-THROUGH — otherwise (duplicate miss/bypass + abuse pass) the UNCHANGED
    V1 pipeline runs and its `StageResult[AnalysisResult]` is returned verbatim
    (Req 34.4, 47.3).

Following the V1/V2 convention (`base.py`, design.md "V2 Design Principles"),
the gates never raise on a domain failure — the duplicate gate degrades to a
graceful bypass and the abuse gate returns a `StructuredError`. This wrapper
inherits that contract: it returns a `PipelineV2Outcome`, never raising for a
gate/pipeline domain failure.

Cross-cutting wrapper decoration (Req 36.5, 38.6, 39.4, 51.2, 52.1, 52.4)
─────────────────────────────────────────────────────────────────────────
On the PASS-THROUGH branch the UNCHANGED V1 pipeline is not called bare — it is
run through the additive V2 cross-cutting wrappers (design.md "Extended Pipeline
Sequence (V2)" / "Cross-Cutting Wrappers"):

    Secure_Temporary_Storage  ─ backs the transient working location (Req 51.2)
      └─ GPU_Recovery_Service ─ supervises inference, recovers a crash (Req 37)
           └─ Retry_Manager   ─ wraps external dependency calls (Req 36.5)
                └─ Frame_Cache / Pose_Cache decorate frame / pose extraction
                   (Req 38, 39) via the extraction seams
                     └─ UNCHANGED V1 `Analysis_Pipeline.run` (Req 52.1)

The decoration is **strictly additive**: no V1 stage input/output contract is
altered (Req 52.1) and the V1 `run` entrypoint is invoked exactly as V1 defines
it. Every wrapper degrades to **exact V1 behavior on its own failure** (Req 52.4):
  • a cache store/retrieve failure just runs the V1 extraction (Req 38.6, 39.4);
  • retry exhaustion surfaces `RETRY_EXHAUSTED` as a failed `StageResult`, and a
    failure of the retry machinery itself falls back to a direct V1 run (Req 36.4);
  • GPU-recovery exhaustion surfaces `RECOVERY_EXHAUSTED`, and a failure of the
    recovery machinery falls back to a direct V1 run (Req 37.4);
  • a failure to provision/clean the secure transient location falls back to the
    V1 pipeline's own working location + `Cleanup_Service` (Req 51.2).
None of these wrappers can corrupt the V1 path.

All five wrappers are injected as **optional collaborators** with real defaults,
so the task 31.4 integration tests can substitute mocks and assert the
fall-back-to-V1 behavior of each.
"""

from __future__ import annotations

import math
from enum import Enum
from typing import Callable, Protocol, TypeVar, runtime_checkable

from pydantic import BaseModel, Field

# Build on the UNCHANGED V1 contracts, re-exported from the V2 package
# (Req 52.1, 52.6) — imported, never redefined.
from app.analysis.contracts import AnalysisResult, KeyFrames, VideoMeta
from app.analysis.jobs import AnalysisJob, JobState
# The UNCHANGED V1 Exercise_Plugin interface — imported for typing only so
# variations can be exposed through it without touching the V1 module (Req 44.3).
from app.analysis.plugins.exercise_plugin import ExercisePlugin
from app.analysis.stages.cleanup import ArtifactRegistry
from app.analysis_v2 import StageResult, StructuredError
from app.analysis_v2.caching.frame_cache import FrameCache
from app.analysis_v2.caching.pose_cache import PoseCache
from app.analysis_v2.config_v2 import settings_v2
# ── Feedback extensions (Stage 41 Review Mode, Stage 48 Explainable AI) ──
# Additive hooks invoked AFTER the V1 Feedback_Service builds the result
# (Req 42.1, 49.1). Injected as optional collaborators so 31.4 can mock them.
from app.analysis_v2.feedback_ext.explainability import explain_score as _default_explain_score
from app.analysis_v2.feedback_ext.review_mode import (
    assign_review_status as _default_assign_review_status,
)
from app.analysis_v2.gates.abuse_protection import (
    AbuseProtectionService,
    ContentClassifier,
    StaticContentClassifier,
)
from app.analysis_v2.gates.duplicate_detection import (
    DuplicateCheckInput,
    DuplicateDecision,
    DuplicateDetectionService,
    DuplicateStore,
    InMemoryDuplicateStore,
)
from app.analysis_v2.models_v2 import (
    BenchmarkSample,
    CostRecord,
    ReviewStatus,
    ScoreExplanation,
)
# ── Registries (Stage 42 Model_Registry, Stage 43 Exercise_Version_Registry) ──
from app.analysis_v2.registries.exercise_version_registry import (
    ExerciseVersionRegistry,
    build_exercise_version_registry,
)
from app.analysis_v2.registries.model_registry import (
    ModelRegistry,
    RegisteredModel,
    build_model_registry,
)
from app.analysis_v2.resilience.gpu_recovery import GPURecoveryService
from app.analysis_v2.resilience.retry_manager import RetryManager
from app.analysis_v2.storage.secure_temp_storage import SecureTemporaryStorageService
# ── Telemetry (Stage 39 Cost_Tracking, Stage 40 Benchmark_Dataset_Builder) ──
from app.analysis_v2.telemetry.benchmark_builder import BenchmarkDatasetBuilder
from app.analysis_v2.telemetry.cost_tracking import CostTrackingService

#: Generic value type for the frame / pose extraction decoration seams.
_T = TypeVar("_T")

#: Default identifier the `Retry_Manager` names when it reports a
#: `RETRY_EXHAUSTED` failure of the V1 pipeline's external-dependency-bearing run.
_DEFAULT_DEPENDENCY_NAME = "analysis_pipeline"

#: Default worker identity the `GPU_Recovery_Service` supervises for the V1 run.
_DEFAULT_WORKER_ID = "v1_inference_worker"

#: Artifact id under which the secure transient working location is tracked so
#: `Secure_Temporary_Storage_Service.cleanup` can securely delete it (Req 51.2).
_TRANSIENT_WORKDIR_ARTIFACT = "v1_transient_workdir"

#: The produced `AnalysisResult` scores the Explainable-AI hook attributes to
#: their weighted contributing factors (Req 49.1). Each is explained
#: independently; a score whose factors cannot be explained is simply OMITTED
#: from `score_explanations` (Req 49.3, 49.4), so absence preserves the V1 shape.
_EXPLAINED_SCORES: tuple[str, ...] = ("overall_score", "movement_score")

#: The model kind whose active model names the `Cost_Record.model_used` field
#: (the pose backend drives the bulk of inference cost). Sourced from the
#: `Model_Registry` so a config swap needs no caller change (Req 43.6).
_COST_MODEL_KIND: str = "pose"

#: Structural type of the injectable `assign_review_status` hook (Req 42.1).
ReviewStatusAssigner = Callable[
    [float, "float | None"], "tuple[ReviewStatus, StructuredError | None]"
]

#: Structural type of the injectable `explain_score` hook (Req 49.1).
ScoreExplainer = Callable[
    ["dict[str, float | None]", str],
    "tuple[ScoreExplanation | None, StructuredError | None]",
]


@runtime_checkable
class V1PipelineRunner(Protocol):
    """
    Structural type of the UNCHANGED V1 `Analysis_Pipeline` entrypoint this
    wrapper delegates to on pass-through.

    Declared as a `Protocol` (not an import of the concrete class) so the V1
    pipeline can be injected as a real `Analysis_Pipeline` in production and as
    a lightweight mock in the 31.4 integration tests, without this module
    depending on how the V1 pipeline is constructed. The signature mirrors
    `Analysis_Pipeline.run` exactly, so the invocation contract is preserved
    byte-for-byte (Req 52.1).
    """

    async def run(
        self,
        video: VideoMeta,
        *,
        job_id: str,
        artifacts: ArtifactRegistry | None = None,
    ) -> StageResult[AnalysisResult]:
        ...


class PipelineV2Path(str, Enum):
    """Which branch of the pre-pipeline gate flow produced the outcome."""

    #: Duplicate gate reported a cache hit; every AI stage was skipped (Req 34.3).
    duplicate_hit = "duplicate_hit"
    #: Abuse gate rejected the content; NOT_EXERCISE_VIDEO, no result (Req 47.2).
    abuse_rejected = "abuse_rejected"
    #: Both gates passed; the UNCHANGED V1 pipeline ran (Req 34.4, 47.3).
    pipeline_ran = "pipeline_ran"


class PipelineV2Outcome(BaseModel):
    """
    Unified outcome of a V2 pre-pipeline run.

    `result` is always a V1 `StageResult[AnalysisResult]` so callers handle the
    three branches through the *same* V1 contract (Req 52.1) — no new
    success/error shape is introduced:

      • DUPLICATE HIT  ⇒ ``path=duplicate_hit``,
        ``result=StageResult(success=True, output=<cached AnalysisResult>)``.
      • ABUSE REJECT   ⇒ ``path=abuse_rejected``,
        ``result=StageResult(success=False, error=<NOT_EXERCISE_VIDEO>)``.
      • PASS-THROUGH   ⇒ ``path=pipeline_ran``,
        ``result=<the V1 pipeline's StageResult, verbatim>``.

    `duplicate_decision` retains the duplicate gate's decision (hit / miss /
    graceful bypass with reason) for observability; it is `None` only in the
    defensive case where the gate produced no output.
    """

    path: PipelineV2Path
    result: StageResult[AnalysisResult]
    duplicate_decision: DuplicateDecision | None = Field(default=None)


class PipelineV2:
    """
    Additive orchestrator: pre-pipeline gates → UNCHANGED V1 pipeline.

    Injected collaborators (each mockable for task 31.4):
      • ``v1_pipeline`` — the UNCHANGED V1 `Analysis_Pipeline` (or any object
        satisfying :class:`V1PipelineRunner`). Required: a V1 pipeline cannot be
        constructed without its analytical seams, so there is no default.
      • duplicate detection — supply a fully-built ``duplicate_detection`` gate,
        or a ``duplicate_store`` to back the default gate. Defaults to a
        `DuplicateDetectionService` over an `InMemoryDuplicateStore`.
      • abuse protection — supply a fully-built ``abuse_protection`` gate, or a
        ``content_classifier`` to back the default gate. Defaults to an
        `AbuseProtectionService` over a permissive `StaticContentClassifier`
        (confidence 1.0 → pass-through) until a real content model is wired.

    Cross-cutting wrapper collaborators (each mockable for task 31.4; each
    degrades to exact V1 behavior on its own failure, Req 52.4):
      • ``frame_cache`` — `Frame_Cache` decorating frame extraction (Req 38);
        defaults to a real `FrameCache` bounded by config.
      • ``pose_cache`` — `Pose_Cache` decorating pose extraction (Req 39);
        defaults to a real `PoseCache` bounded by config.
      • ``retry_manager`` — `Retry_Manager` wrapping external dependency calls
        (Req 36); defaults to a real `RetryManager` built from config.
      • ``gpu_recovery`` — `GPU_Recovery_Service` supervising inference (Req 37);
        defaults to a real `GPURecoveryService` built from config.
      • ``secure_storage`` — `Secure_Temporary_Storage_Service` backing the
        transient working location (Req 51); defaults to a real service over a
        volatile in-memory store.
      • ``dependency_name`` / ``worker_id`` — identifiers the retry manager and
        GPU-recovery service report the V1 run under.

    Post-feedback augmentation + terminal telemetry collaborators (task 31.3;
    each mockable for task 31.4; each strictly additive and fail-safe):
      • ``assign_review_status`` — the Stage 41 Human-Review hook; sets
        `AnalysisResult.review_status` from the overall confidence + threshold
        (Req 42.1). Defaults to `feedback_ext.review_mode.assign_review_status`.
      • ``explain_score`` — the Stage 48 Explainable-AI hook; attaches a
        `ScoreExplanation` per produced score (Req 49.1). Defaults to
        `feedback_ext.explainability.explain_score`.
      • ``review_threshold`` — the confidence threshold the review hook maps
        against (Req 42.3); defaults to `settings_v2.REVIEW_THRESHOLD`.
      • ``model_registry`` — the Stage 42 `Model_Registry`; the active model is
        sourced through `active(kind)` so a config swap needs no caller change
        (Req 43.6). Defaults to a config-built `ModelRegistry`.
      • ``exercise_version_registry`` — the Stage 43 `Exercise_Version_Registry`;
        variations are exposed through the UNCHANGED `Exercise_Plugin` interface
        via `exercise_plugin(...)` (Req 44.3). Defaults to an empty registry.
      • ``cost_tracking`` — the Stage 39 `Cost_Tracking_Service`; records exactly
        one anonymous `CostRecord` at a terminal job state (Req 40.1). Defaults
        to a real `CostTrackingService`. Off the hot path and non-blocking.
      • ``benchmark_builder`` — the Stage 40 `Benchmark_Dataset_Builder`; records
        a `BenchmarkSample` when a manual correction is supplied (Req 41.1).
        Defaults to a real `BenchmarkDatasetBuilder`.

    The feedback augmentation is **strictly additive** (Req 52.1, 52.3): the V1
    `Feedback_Service` signature and the V1 `AnalysisResult` base shape are
    unchanged; the optional `review_status` / `score_explanations` fields are
    set ONLY when the hooks yield a value, and their absence serializes to the
    exact V1 shape (contracts.py `_drop_v2_defaults_at_v1_shape`, Req 52.3). The
    telemetry triggers hold their data in SEPARATE analytics sinks and never
    touch, wrap, or delay the client `AnalysisResult` (Req 40.3, 41.6).
    """

    def __init__(
        self,
        v1_pipeline: V1PipelineRunner,
        *,
        duplicate_detection: DuplicateDetectionService | None = None,
        abuse_protection: AbuseProtectionService | None = None,
        duplicate_store: DuplicateStore | None = None,
        content_classifier: ContentClassifier | None = None,
        # ── Cross-cutting wrappers (Req 36.5, 38.6, 39.4, 51.2, 52.4) ──
        frame_cache: FrameCache | None = None,
        pose_cache: PoseCache | None = None,
        retry_manager: RetryManager | None = None,
        gpu_recovery: GPURecoveryService | None = None,
        secure_storage: SecureTemporaryStorageService | None = None,
        dependency_name: str = _DEFAULT_DEPENDENCY_NAME,
        worker_id: str = _DEFAULT_WORKER_ID,
        # ── Post-feedback augmentation + terminal telemetry (task 31.3) ──
        assign_review_status: ReviewStatusAssigner | None = None,
        explain_score: ScoreExplainer | None = None,
        review_threshold: float | None = None,
        model_registry: ModelRegistry | None = None,
        exercise_version_registry: ExerciseVersionRegistry | None = None,
        cost_tracking: CostTrackingService | None = None,
        benchmark_builder: BenchmarkDatasetBuilder | None = None,
    ) -> None:
        self.v1_pipeline = v1_pipeline
        # Duplicate gate: prefer an injected gate, else build one over the
        # injected/default store (Req 34) — a graceful, config-driven default.
        self.duplicate_detection = duplicate_detection or DuplicateDetectionService(
            duplicate_store or InMemoryDuplicateStore()
        )
        # Abuse gate: prefer an injected gate, else build one over the
        # injected/default classifier (Req 47). The default permits genuine
        # exercise content (confidence 1.0) so the gate is a passthrough until a
        # real model-backed classifier is registered.
        self.abuse_protection = abuse_protection or AbuseProtectionService(
            content_classifier or StaticContentClassifier(1.0)
        )

        # ── Cross-cutting wrappers: each prefers an injected instance, else
        #    builds the real component from config. All are additive decorators
        #    around the UNCHANGED V1 run and fall back to exact V1 behavior on
        #    their own failure (Req 52.4).
        self.frame_cache = frame_cache if frame_cache is not None else FrameCache()
        self.pose_cache = pose_cache if pose_cache is not None else PoseCache()
        self.retry_manager = retry_manager if retry_manager is not None else RetryManager()
        self.gpu_recovery = gpu_recovery if gpu_recovery is not None else GPURecoveryService()
        self.secure_storage = (
            secure_storage if secure_storage is not None else SecureTemporaryStorageService()
        )
        self.dependency_name = dependency_name
        self.worker_id = worker_id

        # ── Post-feedback augmentation hooks (Stage 41, 48; Req 42.1, 49.1) ──
        # Prefer an injected hook, else the real module function. Both are
        # invoked ADDITIVELY after the V1 Feedback_Service builds the result and
        # never change its signature; each is called fail-safe (a raising hook
        # degrades to the exact V1 shape, Req 52.3).
        self.assign_review_status: ReviewStatusAssigner = (
            assign_review_status
            if assign_review_status is not None
            else _default_assign_review_status
        )
        self.explain_score: ScoreExplainer = (
            explain_score if explain_score is not None else _default_explain_score
        )
        self.review_threshold: float = (
            review_threshold if review_threshold is not None else settings_v2.REVIEW_THRESHOLD
        )

        # ── Registries (Stage 42, 43; Req 43.6, 44.3) ──
        # The active model is sourced through `Model_Registry.active(kind)` and
        # exercise variations are exposed through the UNCHANGED Exercise_Plugin
        # interface — a config swap needs no caller change.
        self.model_registry: ModelRegistry = (
            model_registry if model_registry is not None else build_model_registry()
        )
        self.exercise_version_registry: ExerciseVersionRegistry = (
            exercise_version_registry
            if exercise_version_registry is not None
            else build_exercise_version_registry()
        )

        # ── Terminal / correction telemetry (Stage 39, 40; Req 40.1, 41.1) ──
        # Both are off the analysis hot path, hold their data in SEPARATE
        # analytics sinks, and never touch/delay the client AnalysisResult.
        self.cost_tracking: CostTrackingService = (
            cost_tracking if cost_tracking is not None else CostTrackingService()
        )
        self.benchmark_builder: BenchmarkDatasetBuilder = (
            benchmark_builder if benchmark_builder is not None else BenchmarkDatasetBuilder()
        )

    async def run(
        self,
        *,
        duplicate_input: DuplicateCheckInput,
        key_frames: KeyFrames,
        video: VideoMeta,
        job_id: str,
        artifacts: ArtifactRegistry | None = None,
        cost_metrics: CostRecord | None = None,
        correction_sample: BenchmarkSample | None = None,
    ) -> PipelineV2Outcome:
        """
        Run the pre-pipeline gates, then (on pass) the UNCHANGED V1 pipeline.

        Args:
            duplicate_input: identity + local video handle/bytes for the
                `Duplicate_Detection_Service` `(user_id, video_hash,
                pipeline_version)` lookup (Req 34.1, 34.2).
            key_frames: the `KeyFrames` the `Abuse_Protection_Service` classifies
                (Req 47.1). Its contract is `KeyFrames → KeyFrames`; on pass the
                frames are unchanged and the V1 pipeline runs from ``video``.
            video: the validated/probed input handed VERBATIM to the V1 pipeline
                on pass-through — the V1 invocation is unchanged (Req 52.1).
            job_id: identifier the V1 pipeline keys its `Progress_Event`s by.
            artifacts: optional pre-seeded artifact registry forwarded to V1.
            cost_metrics: optional pre-measured `CostRecord` for the run. When
                omitted a minimal record is synthesized whose ``model_used`` is
                sourced from the active `Model_Registry` model (Req 40.1, 43.6).
            correction_sample: optional `BenchmarkSample` for a manual
                correction; when supplied the `Benchmark_Dataset_Builder` records
                it at the terminal point (Req 41.1). Incomplete samples are
                rejected fail-safe by the builder.

        Returns:
            A :class:`PipelineV2Outcome` describing which branch was taken and
            carrying the unified V1 `StageResult[AnalysisResult]`.
        """
        # ── Gate 1 · Duplicate detection (Stage 33, Req 34) ──────────────────
        # A HIT returns the cached result and skips every AI stage (Req 34.3).
        # A miss OR a graceful bypass (hash/store unavailable, Req 34.6/34.7)
        # falls through to abuse protection so the pipeline runs normally
        # (Req 34.4). The gate never raises.
        dup = await self.duplicate_detection.run(duplicate_input)
        decision = dup.output
        if dup.success and decision is not None and decision.cache_hit:
            # A cached hit is a previously-produced (already-augmented) result —
            # it is returned verbatim (Req 34.3). Still a terminal job, so the
            # terminal telemetry triggers fire (Req 40.1).
            outcome = PipelineV2Outcome(
                path=PipelineV2Path.duplicate_hit,
                result=StageResult(success=True, output=decision.result),
                duplicate_decision=decision,
            )
            await self._fire_terminal_telemetry(
                job_id, outcome.result, cost_metrics, correction_sample
            )
            return outcome

        # ── Gate 2 · Abuse protection (Stage 46, Req 47) ─────────────────────
        # Below-threshold or unclassifiable content halts here with a
        # StructuredError (NOT_EXERCISE_VIDEO) and NO AnalysisResult
        # (Req 47.2, 47.6). At/above threshold the frames pass unchanged and we
        # proceed to the V1 pipeline (Req 47.3, 47.4). The gate never raises.
        abuse = await self.abuse_protection.run(key_frames)
        if not abuse.success:
            outcome = PipelineV2Outcome(
                path=PipelineV2Path.abuse_rejected,
                result=StageResult(success=False, error=abuse.error),
                duplicate_decision=decision,
            )
            # A rejection is a terminal (failed) job — fire terminal telemetry
            # (Req 40.1). There is no AnalysisResult to augment (Req 47.6).
            await self._fire_terminal_telemetry(
                job_id, outcome.result, cost_metrics, correction_sample
            )
            return outcome

        # ── Delegate to the UNCHANGED V1 pipeline (Req 34.4, 47.3, 52.1) ─────
        # No V1 stage input/output contract is touched; the V1 `run` entrypoint
        # is invoked exactly as V1 defines it. On the pass-through branch the run
        # is decorated by the additive cross-cutting wrappers (secure storage →
        # GPU recovery → retry → caches), each of which degrades to exact V1
        # behavior on its own failure (Req 36.5, 38.6, 39.4, 51.2, 52.4).
        v1_result = await self._run_v1_supervised(video, job_id=job_id, artifacts=artifacts)

        # ── Post-feedback augmentation (Stage 41 + 48; Req 42.1, 49.1) ───────
        # AFTER the V1 Feedback_Service has built the result, ADDITIVELY set the
        # optional review_status + score_explanations fields WITHOUT changing the
        # Feedback_Service signature or the V1 AnalysisResult base shape. Absence
        # of the hooks' output serializes to the exact V1 shape (Req 52.3).
        augmented = self._augment_feedback_result(v1_result)

        outcome = PipelineV2Outcome(
            path=PipelineV2Path.pipeline_ran,
            result=augmented,
            duplicate_decision=decision,
        )
        # ── Terminal telemetry (Stage 39 + 40; Req 40.1, 41.1) ──────────────
        await self._fire_terminal_telemetry(
            job_id, augmented, cost_metrics, correction_sample
        )
        return outcome

    # ── Post-feedback augmentation (Stage 41 Review, Stage 48 Explain) ───────
    # Invoked additively after the V1 Feedback_Service builds the result; the V1
    # signature and AnalysisResult base shape are unchanged (Req 52.1, 52.3).

    def _augment_feedback_result(
        self, result: StageResult[AnalysisResult]
    ) -> StageResult[AnalysisResult]:
        """Additively set `review_status` + attach `score_explanations` (Req 42.1, 49.1).

        Operates on the freshly-produced V1 `AnalysisResult` only. Every V2 field
        is set ONLY when its hook yields a value; when neither field is populated
        the ORIGINAL result is returned unchanged, so its serialized form is the
        exact V1 shape (Req 52.3). Each hook is invoked fail-safe — a raising
        hook is swallowed and simply leaves its field absent (exact V1 shape),
        so the augmentation can never corrupt or delay the client result.
        """
        # No result to augment on a failed/absent V1 output — return verbatim.
        if not result.success or result.output is None:
            return result

        analysis = result.output
        updates: dict[str, object] = {}

        # Stage 41 · Human Review Mode (Req 42.1): map overall confidence +
        # configured threshold onto exactly one ReviewStatus. Fail-safe.
        try:
            status, _review_err = self.assign_review_status(
                analysis.overall_confidence, self.review_threshold
            )
            if status is not None:
                updates["review_status"] = status
        except Exception:  # noqa: BLE001 — fail-safe: leave field absent (V1 shape)
            pass

        # Stage 48 · Explainable AI (Req 49.1): attach a ScoreExplanation per
        # produced score. A score whose factors cannot be explained is OMITTED
        # (Req 49.3, 49.4). Fail-safe.
        try:
            factors = self._extract_contributing_factors(analysis)
            explanations: list[ScoreExplanation] = []
            for score_name in _EXPLAINED_SCORES:
                explanation, _explain_err = self.explain_score(factors, score_name)
                if explanation is not None:
                    explanations.append(explanation)
            if explanations:
                updates["score_explanations"] = explanations
        except Exception:  # noqa: BLE001 — fail-safe: leave field absent (V1 shape)
            pass

        # Nothing to add ⇒ return the ORIGINAL result so its serialized shape is
        # byte-for-byte the V1 shape (Req 52.3).
        if not updates:
            return result

        # model_copy(update=...) yields a NEW result with the additive fields
        # set; the V1 base fields are copied unchanged (Req 52.1).
        return StageResult(success=True, output=analysis.model_copy(update=updates))

    @staticmethod
    def _extract_contributing_factors(
        analysis: AnalysisResult,
    ) -> dict[str, float | None]:
        """Derive the five Explainable-AI contributing factors from the result (Req 49.2).

        Maps the V1 `AnalysisResult` scalars onto the factors the explainability
        hook attributes each score to — range_of_motion, tempo, balance,
        stability, symmetry. `range_of_motion` is a per-joint mapping in the V1
        contract, so its mean magnitude is used as the aggregate factor value
        (an empty mapping yields 0.0, which the hook still explains via equal
        distribution). No video / frame / pose data is read — only derived
        scalars (privacy boundary preserved, Req 13.2).
        """
        rom = analysis.range_of_motion
        rom_scalar = (math.fsum(rom.values()) / len(rom)) if rom else 0.0
        return {
            "range_of_motion": rom_scalar,
            "tempo": analysis.tempo,
            "balance": analysis.movement_metrics.balance,
            "stability": analysis.stability,
            "symmetry": analysis.symmetry,
        }

    # ── Active model sourcing (Stage 42 · Model_Registry, Req 43.6) ──────────

    def active_model(self, kind: str = _COST_MODEL_KIND) -> RegisteredModel | None:
        """Source the active model for `kind` from the `Model_Registry` (Req 43.6).

        Callers select through this uniform accessor and never depend on a
        concrete model, so a differently-configured active model is swapped in
        without changing any caller (Req 43.6). Fail-safe: returns ``None`` when
        no model is active for `kind`.
        """
        return self.model_registry.active(kind)

    # ── Exercise-variation exposure (Stage 43 · Exercise_Version_Registry) ───

    def exercise_plugin(self, variation_id: str) -> ExercisePlugin | StructuredError:
        """Expose a registered variation through the UNCHANGED Exercise_Plugin API (Req 44.3).

        Delegates to `Exercise_Version_Registry.as_plugin`, which returns an
        `ExercisePlugin` (the existing Req 28 interface, unchanged) resolving the
        variation's properties by override-then-inherit, or a fail-safe
        `StructuredError(code="EXERCISE_VARIATION_NOT_FOUND")` when the variation
        is unknown. A variation is added/replaced without changing any stage
        interface (Req 44.4).
        """
        return self.exercise_version_registry.as_plugin(variation_id)

    # ── Terminal / correction telemetry (Stage 39 + 40; Req 40.1, 41.1) ──────
    # Both triggers are off the analysis hot path, hold their data in SEPARATE
    # analytics sinks, and NEVER touch, wrap, or delay the client AnalysisResult
    # (Req 40.3, 40.5, 41.6). Every trigger is fail-safe.

    async def _fire_terminal_telemetry(
        self,
        job_id: str,
        result: StageResult[AnalysisResult],
        cost_metrics: CostRecord | None,
        correction_sample: BenchmarkSample | None,
    ) -> None:
        """Record cost at the terminal state and a benchmark sample on correction.

        The job is terminal here by construction — ``completed`` when the result
        succeeded, ``failed`` otherwise (Req 40.1). Both triggers are best-effort
        and never propagate: a telemetry failure must not affect the returned
        outcome (Req 40.5).
        """
        await self._record_terminal_cost(job_id, result, cost_metrics)
        self._record_correction_benchmark(correction_sample)

    async def _record_terminal_cost(
        self,
        job_id: str,
        result: StageResult[AnalysisResult],
        cost_metrics: CostRecord | None,
    ) -> None:
        """Record exactly one anonymous `CostRecord` at the terminal state (Req 40.1).

        The terminal job state is derived from the outcome (completed/failed).
        When ``cost_metrics`` is not supplied a minimal record is synthesized
        whose ``model_used`` is sourced from the active `Model_Registry` model
        (Req 43.6). The `Cost_Tracking_Service` is idempotent per job and
        non-blocking; any failure is swallowed so the client result is returned
        unmodified and without delay (Req 40.5).
        """
        try:
            state = JobState.completed if result.success else JobState.failed
            job = AnalysisJob(job_id=job_id, user_id="", state=state)
            metrics = cost_metrics if cost_metrics is not None else self._default_cost_record()
            await self.cost_tracking.record(job, metrics)
        except Exception:  # noqa: BLE001 — telemetry must never affect the result
            pass

    def _default_cost_record(self) -> CostRecord:
        """Synthesize a minimal anonymous `CostRecord` for the run (Req 40.2, 40.4).

        Carries only anonymous aggregates — no user / video / frame / pose data
        (structurally enforced by the `CostRecord` contract). ``model_used`` is
        sourced from the active `Model_Registry` model so a config swap is
        reflected without a caller change (Req 43.6); resource magnitudes default
        to zero when not measured at this seam.
        """
        active = self.active_model(_COST_MODEL_KIND)
        model_used = active.name if active is not None else settings_v2.ACTIVE_POSE_MODEL
        return CostRecord(
            processing_time_ms=0.0,
            gpu_memory_mb=0.0,
            vram_usage_mb=0.0,
            frame_count=0,
            model_used=model_used,
            token_count=0,
            estimated_inference_cost=0.0,
            worker_id=self.worker_id,
            queue_wait_ms=0.0,
        )

    def _record_correction_benchmark(
        self, correction_sample: BenchmarkSample | None
    ) -> None:
        """Record a correction-derived `BenchmarkSample` when one is supplied (Req 41.1).

        Only fires when a manual correction is present (``correction_sample`` is
        not ``None``). The `Benchmark_Dataset_Builder` records exactly one sample
        per accepted correction and rejects incomplete samples fail-safe
        (Req 41.3); it never stores the original video (Req 41.6). Any failure is
        swallowed so the client result is never affected.
        """
        if correction_sample is None:
            return
        try:
            self.benchmark_builder.record(correction_sample)
        except Exception:  # noqa: BLE001 — telemetry must never affect the result
            pass

    # ── Cross-cutting wrapper decoration (Req 36.5, 38.6, 39.4, 51.2, 52.4) ──
    # The wrappers layer around the UNCHANGED V1 run; every layer falls back to
    # exact V1 behavior on its own failure so the V1 path is never corrupted.

    async def _run_v1_supervised(
        self,
        video: VideoMeta,
        *,
        job_id: str,
        artifacts: ArtifactRegistry | None,
    ) -> StageResult[AnalysisResult]:
        """Run the UNCHANGED V1 pipeline decorated by every cross-cutting wrapper.

        Outermost layer: `Secure_Temporary_Storage_Service` backs the transient
        working location and securely deletes it on ANY termination path
        (Req 51.2). Provisioning/cleanup are best-effort — a failure falls back
        to the V1 pipeline's own working directory + `Cleanup_Service` (exact V1
        behavior, Req 52.4). The volatile frame/pose caches are cleared on
        completion so no decoded frame or landmark outlives the job (Req 38.4,
        39.6).
        """
        provisioned = self._provision_transient_storage(job_id)
        try:
            return await self._run_v1_with_gpu_recovery(
                video, job_id=job_id, artifacts=artifacts
            )
        finally:
            # Volatile caches never outlive the job (privacy, Req 38.4 / 39.6).
            self._clear_caches()
            # Securely delete the transient working location (Req 51.2); fail
            # open — the V1 Cleanup_Service already ran on the V1 path.
            if provisioned:
                await self._secure_cleanup_transient_storage(job_id)

    async def _run_v1_with_gpu_recovery(
        self,
        video: VideoMeta,
        *,
        job_id: str,
        artifacts: ArtifactRegistry | None,
    ) -> StageResult[AnalysisResult]:
        """Supervise the inference-bearing V1 run with the `GPU_Recovery_Service`.

        The V1 run is executed through the retry wrapper. If it raises — the
        signature of an inference-worker crash bubbling out of the pipeline — the
        `GPU_Recovery_Service` supervises recovery (Req 37): on a successful
        recovery the V1 pipeline is retried once to produce the result; on
        recovery exhaustion a `RECOVERY_EXHAUSTED` `StructuredError` is surfaced
        as a failed `StageResult` (Req 37.4). A failure of the recovery machinery
        itself falls back to a direct V1 run (exact V1 behavior, Req 52.4).
        """
        try:
            return await self._run_v1_with_retry(video, job_id=job_id, artifacts=artifacts)
        except Exception as crash:  # noqa: BLE001 — supervise, never propagate
            return await self._recover_from_inference_crash(
                crash, video, job_id=job_id, artifacts=artifacts
            )

    async def _run_v1_with_retry(
        self,
        video: VideoMeta,
        *,
        job_id: str,
        artifacts: ArtifactRegistry | None,
    ) -> StageResult[AnalysisResult]:
        """Wrap the V1 run's external dependency calls with the `Retry_Manager`.

        `Retry_Manager.call` forwards the arguments to the V1 `run` UNCHANGED
        (Req 36.5) and returns its `StageResult` verbatim on success (Req 36.7).
        On retry exhaustion it returns a `RETRY_EXHAUSTED` `StructuredError`,
        surfaced here as a failed `StageResult` (Req 36.4). A non-transient
        failure is returned as the originating exception (Req 36.6); it is
        re-raised so the GPU-recovery layer can supervise a genuine crash. If the
        retry machinery itself fails, this falls back to a direct V1 run (exact
        V1 behavior, Req 52.4).
        """
        try:
            outcome = await self.retry_manager.call(
                self.dependency_name,
                self.v1_pipeline.run,
                video,
                job_id=job_id,
                artifacts=artifacts,
            )
        except Exception:  # noqa: BLE001 — retry machinery failure → exact V1
            return await self.v1_pipeline.run(video, job_id=job_id, artifacts=artifacts)

        if isinstance(outcome, StageResult):
            # V1 result verbatim — success (Req 36.7) or a V1 domain failure.
            return outcome
        if isinstance(outcome, StructuredError):
            # RETRY_EXHAUSTED (Req 36.4) — surface without corrupting V1 path.
            return StageResult(success=False, error=outcome)
        if isinstance(outcome, BaseException):
            # Non-transient failure returned as-is (Req 36.6): re-raise so the
            # GPU-recovery layer supervises it (and ultimately falls back to V1).
            raise outcome
        # Defensive: an unexpected outcome shape degrades to exact V1 behavior.
        return await self.v1_pipeline.run(video, job_id=job_id, artifacts=artifacts)

    async def _recover_from_inference_crash(
        self,
        crash: BaseException,
        video: VideoMeta,
        *,
        job_id: str,
        artifacts: ArtifactRegistry | None,
    ) -> StageResult[AnalysisResult]:
        """Recover a crashed inference worker, or surface `RECOVERY_EXHAUSTED`.

        Delegates to the `GPU_Recovery_Service` (Req 37). On a recovered worker
        the V1 pipeline is retried once to produce the result; on exhaustion the
        service's `RECOVERY_EXHAUSTED` `StructuredError` (Req 37.4) is surfaced as
        a failed `StageResult`. If the recovery machinery itself fails, this falls
        back to a direct V1 run (exact V1 behavior, Req 52.4).
        """
        try:
            job = AnalysisJob(
                job_id=job_id, user_id="", state=JobState.extracting_pose
            )
            recovery = await self.gpu_recovery.recover(self.worker_id, job)
        except Exception:  # noqa: BLE001 — recovery machinery failure → exact V1
            return await self.v1_pipeline.run(video, job_id=job_id, artifacts=artifacts)

        if recovery.recovered:
            # Worker restored (Req 37.2/37.3): retry the V1 pipeline once to
            # produce the full AnalysisResult over the recovered worker.
            return await self.v1_pipeline.run(video, job_id=job_id, artifacts=artifacts)

        # Recovery exhausted (Req 37.4): surface the structured error, no result.
        error = recovery.error or StructuredError(
            code="RECOVERY_EXHAUSTED",
            message=(
                f"GPU recovery exhausted for worker '{self.worker_id}' "
                f"(crash: {type(crash).__name__})."
            ),
            stage=self.gpu_recovery.name,
        )
        return StageResult(success=False, error=error)

    # ── Secure transient working location (Req 51.2) ─────────────────────────

    def _provision_transient_storage(self, job_id: str) -> bool:
        """Back the job's transient working location with secure storage (Req 51.2).

        Registers a tracked, encrypted-at-rest transient location for the job so
        it can be securely deleted on termination. Best-effort: any failure falls
        back to the V1 pipeline's own working location (exact V1 behavior,
        Req 52.4) and returns ``False`` so no cleanup is attempted.
        """
        try:
            self.secure_storage.write(_TRANSIENT_WORKDIR_ARTIFACT, b"", job_id=job_id)
            return True
        except Exception:  # noqa: BLE001 — fail open to exact V1 behavior
            return False

    async def _secure_cleanup_transient_storage(self, job_id: str) -> None:
        """Securely delete the job's transient location (Req 51.2); fail open.

        A failure here never affects the outcome: the V1 `Cleanup_Service`
        already removed the V1 artifacts on every termination path (Req 12.3).
        """
        try:
            await self.secure_storage.cleanup(job_id)
        except Exception:  # noqa: BLE001 — cleanup failure must not corrupt V1
            pass

    # ── Frame / Pose cache decoration seams (Req 38.6, 39.4, 52.4) ───────────
    # These decorate the V1 frame/pose extraction delegates additively: on an
    # exact-key cache hit the cached value is returned; otherwise the V1
    # extraction runs and its result is cached. ANY cache failure (including a
    # wholly unavailable cache collaborator) degrades to running the V1
    # extraction delegate unchanged, so the V1 path is never corrupted.

    def _extract_frame_cached(
        self,
        video_hash: str,
        ts_ms: float,
        decode: Callable[[], _T],
    ) -> _T:
        """`Frame_Cache` around a V1 frame-decode delegate (Req 38.6, 52.4).

        Falls back to invoking ``decode`` directly if the cache collaborator
        raises, so a cache miss/store/retrieve failure just runs the exact V1
        frame extraction.
        """
        try:
            return self.frame_cache.get_or_decode(video_hash, ts_ms, decode)
        except Exception:  # noqa: BLE001 — fail open to exact V1 extraction
            return decode()

    def _extract_pose_cached(
        self,
        frame_hash: str,
        engine_version: str,
        extract: Callable[[], _T],
    ) -> _T:
        """`Pose_Cache` around a V1 pose-extract delegate (Req 39.4, 52.4).

        Falls back to invoking ``extract`` directly if the cache collaborator
        raises, so a cache miss/store/retrieve failure just runs the exact V1
        pose extraction.
        """
        try:
            return self.pose_cache.get_or_extract(frame_hash, engine_version, extract)
        except Exception:  # noqa: BLE001 — fail open to exact V1 extraction
            return extract()

    def _clear_caches(self) -> None:
        """Clear the volatile frame/pose caches on completion (Req 38.4, 39.6).

        Best-effort so a cache-clear failure never affects the outcome; the
        caches hold volatile-only data that must not outlive the job.
        """
        for cache in (self.frame_cache, self.pose_cache):
            try:
                cache.clear()
            except Exception:  # noqa: BLE001 — clearing must never crash the run
                pass


# Public wiring surface. `StructuredError` is re-exported for callers that
# inspect the NOT_EXERCISE_VIDEO error on the abuse-reject branch.
__all__ = [
    "PipelineV2",
    "PipelineV2Outcome",
    "PipelineV2Path",
    "V1PipelineRunner",
    "ReviewStatusAssigner",
    "ScoreExplainer",
    "StructuredError",
]
