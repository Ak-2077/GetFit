"""
Job_Queue_Adapter — replaceable background-job backend interface & registry
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A `Job_Queue_Adapter` is the single interface through which the AI service
enqueues an `Analysis_Job`, tracks its `Job_State` lifecycle, and records its
terminal result/error. The submit → `job_id` → poll model sketched in
`ai-service/app/routers/video.py` is formalized here behind one ABC so the
underlying backend (BullMQ, Redis, RabbitMQ, SQS) is swappable by configuration
with no change to any caller (Req 19.7, 31.3).

This module mirrors the proven registry convention in `pose_engines.py` and
`smoothing.py`:

  • `JobQueueAdapter` is an ABC with `enqueue` / `get` / `set_state` /
    `set_result` / `set_error`.
  • Concrete backends are registered ONCE in a registry keyed by `name`
    (bullmq | redis | rabbitmq | sqs), analogous to
    `build_pose_engine_registry` / `build_smoothing_registry`.
  • The active backend is selected by configuration (`settings.QUEUE_BACKEND`)
    via `build_job_queue_adapter`, so swapping backends needs no change to the
    Background_Worker or the API router (Req 19.7).

Lifecycle contract (Req 19.1, 19.4):
`enqueue` assigns a fresh `Job_Id`, stores the job in state `queued` BEFORE any
stage runs, and returns that `Job_Id`. `get` round-trips the stored job by id
(or None if unknown). `set_state` advances the tracked `Job_State`. `set_result`
records the terminal `AnalysisResult` and moves the job to `completed`;
`set_error` records the sanitized `Structured_Error` and moves the job to
`failed` (Req 19.4, 19.5, 19.6).

The default/testable path is a self-contained in-memory store (the `bullmq`
backend's stub), which fully satisfies the round-trip contract without external
infrastructure. The external backends (redis | rabbitmq | sqs) are
dependency-gated stubs: they reuse the same in-memory store until their client
libraries are wired in, keeping the registry complete and the interface stable
(Req 31.3). Selecting one whose library is absent still yields a working adapter
so the pipeline is testable end-to-end.
"""

from __future__ import annotations

import importlib.util
import uuid
from abc import ABC, abstractmethod

from ..base import StructuredError
from ..contracts import AnalysisResult
from ..jobs import AnalysisJob, JobState


class JobQueueAdapter(ABC):
    """Abstract base every swappable background-job backend must implement.

    Mirrors `pose_engines.PoseEngine` / `smoothing.SmoothingAlgorithm`. All
    methods are async so backends backed by network clients (Redis, SQS, …) can
    implement them without blocking the event loop. Implementations MUST honor
    the lifecycle contract: a newly enqueued job is observable in state
    `queued` (Req 19.1) and a state/result/error set through the adapter is
    reflected by a subsequent `get` (Req 19.7).
    """

    #: Stable identifier, e.g. "bullmq", "redis", "rabbitmq", "sqs". Used as the
    #: registry key and the `settings.QUEUE_BACKEND` selector value.
    name: str = "base"

    @abstractmethod
    async def enqueue(self, job: AnalysisJob) -> str:
        """
        Enqueue a job for background processing and return its `Job_Id`.

        The job is stored in state `queued` before any stage runs (Req 19.1).
        A `job_id` is assigned when the incoming job does not already carry one.
        """
        raise NotImplementedError

    @abstractmethod
    async def get(self, job_id: str) -> AnalysisJob | None:
        """Return the tracked job by id, or None if no such job exists."""
        raise NotImplementedError

    @abstractmethod
    async def set_state(self, job_id: str, state: JobState) -> None:
        """Advance the tracked `Job_State` for an existing job (Req 19.4)."""
        raise NotImplementedError

    @abstractmethod
    async def set_result(self, job_id: str, result: AnalysisResult) -> None:
        """Record the terminal result and move the job to `completed` (Req 19.5)."""
        raise NotImplementedError

    @abstractmethod
    async def set_error(self, job_id: str, error: StructuredError) -> None:
        """Record the sanitized error and move the job to `failed` (Req 19.6)."""
        raise NotImplementedError


class _InMemoryJobQueueAdapter(JobQueueAdapter):
    """
    Self-contained in-memory implementation of the adapter contract.

    Backs the default/testable path and the dependency-gated external backends
    until their real clients are wired in. Jobs live in a per-instance dict
    keyed by `job_id`, which satisfies the full enqueue/get/set round-trip
    (Req 19.1, 19.4, 19.7) without any external infrastructure.
    """

    def __init__(self) -> None:
        self._store: dict[str, AnalysisJob] = {}

    async def enqueue(self, job: AnalysisJob) -> str:
        # Assign a Job_Id when the caller did not supply one, and force the
        # initial state to `queued` so the job is observable as queued before
        # any stage runs (Req 19.1).
        job_id = job.job_id or uuid.uuid4().hex
        queued = job.model_copy(update={"job_id": job_id, "state": JobState.queued})
        self._store[job_id] = queued
        return job_id

    async def get(self, job_id: str) -> AnalysisJob | None:
        return self._store.get(job_id)

    async def set_state(self, job_id: str, state: JobState) -> None:
        job = self._store.get(job_id)
        if job is None:
            return
        self._store[job_id] = job.model_copy(update={"state": state})

    async def set_result(self, job_id: str, result: AnalysisResult) -> None:
        job = self._store.get(job_id)
        if job is None:
            return
        self._store[job_id] = job.model_copy(
            update={"result": result, "state": JobState.completed}
        )

    async def set_error(self, job_id: str, error: StructuredError) -> None:
        job = self._store.get(job_id)
        if job is None:
            return
        self._store[job_id] = job.model_copy(
            update={"error": error, "state": JobState.failed}
        )


class BullMQJobQueueAdapter(_InMemoryJobQueueAdapter):
    """
    BullMQ-backed queue (Req 19.7) — the default backend.

    BullMQ is a Redis-backed queue; until its client is wired in, this uses the
    shared in-memory store so the default path is fully testable.
    """
    name = "bullmq"


class _DependencyGatedJobQueueAdapter(_InMemoryJobQueueAdapter):
    """
    Shared stub behavior for external backends whose real client is added later.

    `is_available` probes for the backing library via `import_module_name`. Until
    that client is integrated, the adapter transparently uses the in-memory store
    so selecting it still yields a working, testable adapter (Req 31.3) without
    fabricating a connection.
    """

    #: The importable module that the real backend integration will require.
    import_module_name: str = ""

    @classmethod
    def is_available(cls) -> bool:
        if not cls.import_module_name:
            return False
        try:
            return importlib.util.find_spec(cls.import_module_name) is not None
        except (ImportError, ValueError, ModuleNotFoundError):
            return False


class RedisJobQueueAdapter(_DependencyGatedJobQueueAdapter):
    """Redis-backed queue stub (Req 19.7)."""
    name = "redis"
    import_module_name = "redis"


class RabbitMQJobQueueAdapter(_DependencyGatedJobQueueAdapter):
    """RabbitMQ-backed queue stub (Req 19.7)."""
    name = "rabbitmq"
    import_module_name = "aio_pika"


class SQSJobQueueAdapter(_DependencyGatedJobQueueAdapter):
    """Amazon SQS-backed queue stub (Req 19.7)."""
    name = "sqs"
    import_module_name = "boto3"


def build_job_queue_registry() -> dict[str, JobQueueAdapter]:
    """
    Instantiate every known `Job_Queue_Adapter` ONCE (singletons), keyed by
    `name`.

    Adding a new backend = implement `JobQueueAdapter` and register it here;
    nothing else in the pipeline changes (Req 19.7, 31.3). Mirrors
    `build_pose_engine_registry` / `build_smoothing_registry`.
    """
    adapters: list[JobQueueAdapter] = [
        BullMQJobQueueAdapter(),
        RedisJobQueueAdapter(),
        RabbitMQJobQueueAdapter(),
        SQSJobQueueAdapter(),
    ]
    return {adapter.name: adapter for adapter in adapters}


#: Names of all queue backends known to the registry (validation/diagnostics).
JOB_QUEUE_BACKEND_NAMES: tuple[str, ...] = (
    "bullmq",
    "redis",
    "rabbitmq",
    "sqs",
)


def build_job_queue_adapter(backend: str | None = None) -> JobQueueAdapter:
    """
    Select the active `Job_Queue_Adapter` by configuration (Req 19.7).

    Resolves `backend` (defaulting to `settings.QUEUE_BACKEND`) against the
    registry. An unknown backend name falls back to the default `bullmq`
    backend so a misconfiguration never leaves the service without a queue.
    """
    from ...core.config import settings

    registry = build_job_queue_registry()
    selected = backend or settings.QUEUE_BACKEND
    return registry.get(selected) or registry["bullmq"]
