"""
Progress_Service — transport-agnostic real-time job progress (Req 20.x)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The `Progress_Service` collects `ProgressEvent`s for in-flight analysis jobs
and exposes them through a *replaceable transport* (Req 20.4). This module
mirrors the proven `PoseEngine`/registry convention in `pose_engines.py` and
the `SmoothingAlgorithm`/registry convention in `smoothing.py`:

  • `ProgressTransport` is an ABC with `publish(job_id, event)` and
    `latest(job_id)` (analogous to `PoseEngine`).
  • Concrete transports are registered ONCE in a registry keyed by `name`
    (poll | push | both), analogous to `build_pose_engine_registry`.
  • The active transport is selected by configuration
    (`settings.PROGRESS_TRANSPORT`) inside the `Progress_Service`, so swapping
    the delivery mechanism needs no change to any Pipeline_Stage (Req 20.4).

Independence from analytical logic (Req 20.2, 20.5):
The `Progress_Service` only ever *receives* a `Job_State` (plus optional
percent) and *forwards* a bounded `ProgressEvent`. It never reads, holds, or
mutates analytical data — Pipeline_Stages emit progress to it without the
service participating in their computation. Because the only state the service
carries is the latest event per job, publishing is fully decoupled from the
analysis itself.

Privacy boundary (Req 20.6):
A `ProgressEvent` carries only `job_id`, `state`, a human-readable `label`
(Req 20.3), and an optional `percent`. Raw video, raw frames, and pose images
are structurally excluded — they are not fields of `ProgressEvent`.
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod

from app.core.config import Settings, settings

from ..jobs import PROGRESS_LABELS, JobState, ProgressEvent


# Raised when settings.PROGRESS_TRANSPORT names a transport that is not in the
# registry — a configuration error surfaced distinctly from runtime failures.
class ProgressTransportNotConfigured(ValueError):
    """The configured progress transport name is not present in the registry."""


class ProgressTransport(ABC):
    """Abstract base every replaceable progress-delivery transport implements.

    Mirrors `pose_engines.PoseEngine`. A transport decides *how* a published
    `ProgressEvent` reaches consumers (polling the latest value, pushing to
    subscribers, or both) while keeping the `publish`/`latest` interface stable
    so the delivery mechanism is swappable via configuration (Req 20.4).
    """

    #: Stable identifier and registry key, e.g. "poll", "push", "both".
    name: str = "base"

    @abstractmethod
    async def publish(self, job_id: str, event: ProgressEvent) -> None:
        """Record/deliver the most recent `ProgressEvent` for `job_id`."""
        raise NotImplementedError

    @abstractmethod
    async def latest(self, job_id: str) -> ProgressEvent | None:
        """Return the most recently published event for `job_id`, or None."""
        raise NotImplementedError


class _LatestEventStore:
    """
    Shared, concurrency-safe store of the latest `ProgressEvent` per job.

    Every transport keeps the most recent event per `job_id` so `latest`
    (the polling read) is always well-defined. An `asyncio.Lock` guards the
    mapping so concurrent stage emissions and reads stay consistent.
    """

    def __init__(self) -> None:
        self._latest: dict[str, ProgressEvent] = {}
        self._lock = asyncio.Lock()

    async def _remember(self, job_id: str, event: ProgressEvent) -> None:
        async with self._lock:
            self._latest[job_id] = event

    async def _recall(self, job_id: str) -> ProgressEvent | None:
        async with self._lock:
            return self._latest.get(job_id)


class PollProgressTransport(ProgressTransport, _LatestEventStore):
    """
    Polling transport (Req 20.4): publishing simply records the latest event
    per job, which consumers retrieve on demand via `latest` (e.g. the
    `GET /exercise-analysis/status/{job_id}` endpoint).
    """

    name = "poll"

    def __init__(self) -> None:
        _LatestEventStore.__init__(self)

    async def publish(self, job_id: str, event: ProgressEvent) -> None:
        await self._remember(job_id, event)

    async def latest(self, job_id: str) -> ProgressEvent | None:
        return await self._recall(job_id)


class PushProgressTransport(ProgressTransport, _LatestEventStore):
    """
    Push transport (Req 20.4): publishing fans the event out to every active
    subscriber for the job (e.g. an SSE/WebSocket connection) AND records it as
    the latest, so a consumer that subscribes late can still read the current
    state. Subscribers receive events through an `asyncio.Queue` obtained from
    `subscribe`.
    """

    name = "push"

    def __init__(self) -> None:
        _LatestEventStore.__init__(self)
        self._subscribers: dict[str, list[asyncio.Queue[ProgressEvent]]] = {}

    async def subscribe(self, job_id: str) -> "asyncio.Queue[ProgressEvent]":
        """Register a subscriber for `job_id` and return its delivery queue."""
        queue: asyncio.Queue[ProgressEvent] = asyncio.Queue()
        async with self._lock:
            self._subscribers.setdefault(job_id, []).append(queue)
            # Seed the queue with the current state so late subscribers are
            # immediately consistent with the latest published event.
            current = self._latest.get(job_id)
        if current is not None:
            await queue.put(current)
        return queue

    async def unsubscribe(self, job_id: str, queue: "asyncio.Queue[ProgressEvent]") -> None:
        """Remove a previously registered subscriber queue for `job_id`."""
        async with self._lock:
            queues = self._subscribers.get(job_id)
            if queues and queue in queues:
                queues.remove(queue)
                if not queues:
                    self._subscribers.pop(job_id, None)

    async def publish(self, job_id: str, event: ProgressEvent) -> None:
        async with self._lock:
            self._latest[job_id] = event
            targets = list(self._subscribers.get(job_id, ()))
        for queue in targets:
            await queue.put(event)

    async def latest(self, job_id: str) -> ProgressEvent | None:
        return await self._recall(job_id)


class BothProgressTransport(PushProgressTransport):
    """
    Combined transport (Req 20.4): supports BOTH polling and push delivery.

    It records the latest event for polling (via `latest`) and fans out to
    subscribers for push (via `subscribe`) — the union of the poll and push
    behaviors behind the same interface.
    """

    name = "both"


def build_progress_transport_registry() -> dict[str, ProgressTransport]:
    """
    Instantiate every known `ProgressTransport` ONCE (singletons), keyed by
    `name`.

    Adding a new transport = implement `ProgressTransport` and register it
    here; nothing else changes (Req 20.4). Mirrors
    `build_pose_engine_registry`/`build_smoothing_registry`.
    """
    transports: list[ProgressTransport] = [
        PollProgressTransport(),
        PushProgressTransport(),
        BothProgressTransport(),
    ]
    return {transport.name: transport for transport in transports}


#: Names of all transports known to the registry (validation/diagnostics).
PROGRESS_TRANSPORT_NAMES: tuple[str, ...] = ("poll", "push", "both")


class Progress_Service:
    """
    Transport-agnostic progress service (Req 20.x).

    Collects `ProgressEvent`s emitted by Pipeline_Stages independently of their
    analytical logic (Req 20.1, 20.2) and exposes the latest event per job
    (Req 20.4) through a configuration-selected, replaceable transport
    (`settings.PROGRESS_TRANSPORT`, Req 20.4). When a job reaches the
    `completed` state the published event carries the "Complete" label
    (Req 20.5) — sourced from `PROGRESS_LABELS` (Req 20.3).

    The `registry` and `active_transport` overrides keep the service
    independently testable, mirroring the `Smoothing_Adapter` override pattern.
    """

    def __init__(
        self,
        config: Settings | None = None,
        registry: dict[str, ProgressTransport] | None = None,
        active_transport: str | None = None,
    ) -> None:
        self._cfg = config or settings
        self._registry = (
            registry if registry is not None else build_progress_transport_registry()
        )
        # Transport selection is read from configuration, never hardcoded
        # (Req 20.4).
        self.active_transport = active_transport or self._cfg.PROGRESS_TRANSPORT
        transport = self._registry.get(self.active_transport)
        if transport is None:
            raise ProgressTransportNotConfigured(
                f"Configured progress transport '{self.active_transport}' is not "
                f"registered. Known transports: {sorted(self._registry)}."
            )
        self.transport = transport

    @staticmethod
    def label_for(state: JobState) -> str:
        """
        Resolve the human-readable status label for a `Job_State` (Req 20.3).

        Labels are drawn from `PROGRESS_LABELS`; states without a surfaced
        label (e.g. terminal `failed`) fall back to the raw state value so a
        `ProgressEvent` always carries a non-empty label.
        """
        return PROGRESS_LABELS.get(state, state.value)

    async def publish(
        self,
        job_id: str,
        state: JobState,
        percent: float | None = None,
    ) -> ProgressEvent:
        """
        Build and publish a bounded `ProgressEvent` for `job_id` (Req 20.1).

        The event carries only the state, its human-readable label (Req 20.3),
        and an optional percent — raw video/frames/pose are structurally
        excluded (Req 20.6). Reaching `JobState.completed` yields the "Complete"
        label (Req 20.5). Publishing touches no analytical data (Req 20.2, 20.5).
        """
        event = ProgressEvent(
            job_id=job_id,
            state=state,
            label=self.label_for(state),
            percent=percent,
        )
        await self.transport.publish(job_id, event)
        return event

    async def publish_event(self, event: ProgressEvent) -> None:
        """Publish a pre-built `ProgressEvent` through the active transport."""
        await self.transport.publish(event.job_id, event)

    async def latest(self, job_id: str) -> ProgressEvent | None:
        """Return the most recent `ProgressEvent` for `job_id`, or None (Req 20.4)."""
        return await self.transport.latest(job_id)
