"""
Stage 33 · Duplicate_Detection_Service (Req 34)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** pre-pipeline gate (design.md "Stage 33") that runs
*before* the first V1 AI stage. It computes a local SHA256 `Video_Hash` over
the complete byte content of the submitted video (Req 34.1) and looks up a
prior `AnalysisResult` by the exact triple `(user_id, video_hash,
pipeline_version)` (Req 34.2) through a **replaceable** `DuplicateStore`.

Behaviour:
  • HIT  — a matching prior result exists ⇒ the gate returns a
    `DuplicateDecision(cache_hit=True, result=<cached>)` within the configured
    lookup timeout (~2 s, `DUPLICATE_LOOKUP_TIMEOUT_MS`) so the orchestrator
    skips EVERY AI stage (Req 34.3).
  • MISS — no match ⇒ `DuplicateDecision(cache_hit=False)` and the V1 pipeline
    runs normally with no AI stage excluded (Req 34.4).
  • BYPASS — if the `Video_Hash` cannot be computed (Req 34.6) OR the store is
    unavailable / too slow (Req 34.7), the gate **never raises**; it returns a
    miss-shaped decision flagged `bypassed=True` with a `bypass_reason`, and the
    pipeline runs normally.

Conventions (mirrors `app/analysis/adapters/pose_engines.py`): an ABC for the
replaceable backend, a config-driven in-memory default, a `build_*_registry`
factory keyed by `name`, and the gate itself implements the unchanged V1
`PipelineStage` interface, returning `StageResult`/`StructuredError` rather
than raising (design.md "V2 Design Principles").

Privacy by construction (Req 1, preserved by Req 52.5): the gate and the store
persist ONLY the hash plus the bounded `AnalysisResult` — never the video
bytes, frames, or pose images.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import time
from abc import ABC, abstractmethod

from pydantic import BaseModel, Field

# Build on the UNCHANGED V1 contracts, re-exported from the V2 package
# (Req 52.1, 52.6) — imported, never redefined.
from app.analysis.contracts import AnalysisResult
from app.analysis_v2 import PipelineStage, StageResult
from app.analysis_v2.config_v2 import settings_v2
from app.analysis_v2.models_v2 import VideoRef

#: Read the local video in bounded chunks so hashing a large file never loads
#: the whole video into memory (privacy + footprint).
_HASH_CHUNK_BYTES = 1024 * 1024  # 1 MiB


# ── Gate I/O contracts ──────────────────────────────────────────────────────

class DuplicateCheckInput(BaseModel):
    """
    Input to the `Duplicate_Detection_Service`.

    Carries the opaque local video handle (and, for in-process/test callers,
    optional inline bytes) together with the identity needed for the exact
    `(user_id, video_hash, pipeline_version)` lookup (Req 34.2). No video bytes
    are persisted — `video_ref`/`video_bytes` are consumed only to compute the
    SHA256 `Video_Hash` and are never stored.
    """

    model_config = {"arbitrary_types_allowed": True}

    user_id: str = Field(..., description="End_User identifier")
    pipeline_version: str = Field(..., description="Pipeline version of the submission")
    # Opaque local path/handle to the video whose bytes are hashed (Req 34.1).
    video_ref: VideoRef | None = Field(default=None, description="Local video path/handle")
    # Optional inline bytes (small/in-process callers, tests); preferred over
    # re-reading the handle when supplied.
    video_bytes: bytes | None = Field(default=None, description="Inline video bytes (optional)")


class DuplicateDecision(BaseModel):
    """
    The `Duplicate_Detection_Service` output (Req 34.3, 34.4).

    `cache_hit=True` ⇒ a prior `AnalysisResult` was found and is carried in
    `result`; the orchestrator MUST skip every AI stage. `cache_hit=False` ⇒
    proceed with the normal V1 pipeline. When the check could not be performed,
    `bypassed=True` and `bypass_reason` records the indication (Req 34.6, 34.7);
    a bypass is always shaped as a miss so the pipeline runs normally.
    """

    cache_hit: bool = Field(..., description="True iff a matching prior result was found")
    result: AnalysisResult | None = Field(
        default=None, description="Cached result on hit; None on miss/bypass"
    )
    video_hash: str | None = Field(
        default=None, description="Computed SHA256 Video_Hash; None when hashing failed"
    )
    bypassed: bool = Field(
        default=False, description="True iff the check was bypassed (Req 34.6/34.7)"
    )
    bypass_reason: str | None = Field(
        default=None, description="Recorded indication of why the check was bypassed"
    )
    lookup_ms: float = Field(
        default=0.0, ge=0.0, description="Wall-clock time spent in the store lookup (ms)"
    )

    @property
    def skip_ai_stages(self) -> bool:
        """Whether the orchestrator should exclude every AI stage (Req 34.3)."""
        return self.cache_hit


# ── Replaceable store backend (ABC + in-memory default + registry) ───────────

class DuplicateStore(ABC):
    """
    Replaceable lookup over prior results; backend selected by config
    (design.md "Stage 33"). Mirrors the `VisionBackend`/`PoseEngine` ABC
    convention.

    PRIVACY: implementations persist ONLY the `Video_Hash` plus the bounded
    `AnalysisResult` — never video bytes, frames, or pose images (Req 52.5).
    Implementations MUST NOT raise from `find` on a transient backend failure;
    raising is treated by the gate as "store unavailable" and triggers a
    graceful bypass (Req 34.7).
    """

    #: Stable identifier for registry selection, e.g. "in_memory".
    name: str = "base"

    @abstractmethod
    async def find(
        self, user_id: str, video_hash: str, pipeline_version: str
    ) -> AnalysisResult | None:
        """
        Return the prior `AnalysisResult` whose `(user_id, video_hash,
        pipeline_version)` match exactly (Req 34.2), or `None` if none exists.
        """
        raise NotImplementedError


class InMemoryDuplicateStore(DuplicateStore):
    """
    Volatile in-memory default `DuplicateStore`.

    Keyed by the exact `(user_id, video_hash, pipeline_version)` triple so a
    match requires all three to be equal (Req 34.2). Stores only the hash key
    and the bounded `AnalysisResult` (Req 52.5). Suitable as the safe default
    and for tests; a persistent backend (e.g. the Node `duplicateStore.js`
    service) can be registered in its place without touching the gate.
    """

    name = "in_memory"

    def __init__(self) -> None:
        self._by_key: dict[tuple[str, str, str], AnalysisResult] = {}

    @staticmethod
    def _key(user_id: str, video_hash: str, pipeline_version: str) -> tuple[str, str, str]:
        return (user_id, video_hash, pipeline_version)

    async def save(
        self,
        user_id: str,
        video_hash: str,
        pipeline_version: str,
        result: AnalysisResult,
    ) -> None:
        """Record a prior result under its exact identity triple."""
        self._by_key[self._key(user_id, video_hash, pipeline_version)] = result

    async def find(
        self, user_id: str, video_hash: str, pipeline_version: str
    ) -> AnalysisResult | None:
        return self._by_key.get(self._key(user_id, video_hash, pipeline_version))


def build_duplicate_store_registry() -> dict[str, DuplicateStore]:
    """
    Instantiate every known `DuplicateStore` ONCE, keyed by `name`.

    Adding a backend = implement `DuplicateStore` and register it here; the
    gate is unchanged. Mirrors `build_pose_engine_registry`.
    """
    stores: list[DuplicateStore] = [
        InMemoryDuplicateStore(),
    ]
    return {store.name: store for store in stores}


#: Names of all stores known to the registry (validation / diagnostics).
DUPLICATE_STORE_NAMES: tuple[str, ...] = ("in_memory",)


# ── Video_Hash computation (Req 34.1) ────────────────────────────────────────

def compute_video_hash(data: DuplicateCheckInput) -> str:
    """
    Compute the SHA256 `Video_Hash` over the COMPLETE byte content of the video
    (Req 34.1).

    Prefers inline `video_bytes` when supplied; otherwise reads the local
    `video_ref` handle in bounded chunks. Raises on any failure (missing
    handle, unreadable file, no source) — the caller catches and bypasses
    (Req 34.6) so this function never has to decide policy.
    """
    if data.video_bytes is not None:
        return hashlib.sha256(data.video_bytes).hexdigest()

    if data.video_ref:
        digest = hashlib.sha256()
        with open(os.fspath(data.video_ref), "rb") as fh:
            for chunk in iter(lambda: fh.read(_HASH_CHUNK_BYTES), b""):
                digest.update(chunk)
        return digest.hexdigest()

    raise ValueError("no video source (video_bytes/video_ref) provided to hash")


# ── The gate ─────────────────────────────────────────────────────────────────

class DuplicateDetectionService(PipelineStage[DuplicateCheckInput, DuplicateDecision]):
    """
    Pre-pipeline duplicate-detection gate (Req 34).

    Additive: it runs before the first V1 stage and never alters any V1 stage's
    input/output contract (Req 34.5). It never raises — every failure path
    degrades to a graceful bypass that lets the V1 pipeline run normally
    (Req 34.6, 34.7).
    """

    name = "duplicate_detection"

    def __init__(self, store: DuplicateStore) -> None:
        self._store = store
        # Configured lookup budget (~2 s, Req 34.2/34.3); seconds for asyncio.
        self._timeout_s = max(0.0, settings_v2.DUPLICATE_LOOKUP_TIMEOUT_MS / 1000.0)

    def _bypass(self, reason: str, video_hash: str | None = None) -> StageResult[DuplicateDecision]:
        """Build a successful, miss-shaped decision flagged as a recorded bypass."""
        return StageResult(
            success=True,
            output=DuplicateDecision(
                cache_hit=False,
                result=None,
                video_hash=video_hash,
                bypassed=True,
                bypass_reason=reason,
            ),
        )

    async def run(self, data: DuplicateCheckInput) -> StageResult[DuplicateDecision]:
        # 1) Compute the SHA256 Video_Hash (Req 34.1). Any failure → bypass and
        #    record the indication (Req 34.6); never raise.
        try:
            video_hash = compute_video_hash(data)
        except Exception:  # noqa: BLE001 — degrade gracefully on any hash failure
            return self._bypass("video_hash_unavailable")

        # 2) Look up the prior result by the exact identity triple (Req 34.2),
        #    bounded by the configured timeout so a slow/unavailable store never
        #    delays the pipeline (Req 34.3). Store error or timeout → bypass and
        #    record the indication (Req 34.7); never raise.
        started = time.perf_counter()
        try:
            cached = await asyncio.wait_for(
                self._store.find(data.user_id, video_hash, data.pipeline_version),
                timeout=self._timeout_s if self._timeout_s > 0 else None,
            )
        except asyncio.TimeoutError:
            return self._bypass("store_lookup_timeout", video_hash=video_hash)
        except Exception:  # noqa: BLE001 — store unavailable → graceful bypass
            return self._bypass("store_unavailable", video_hash=video_hash)
        lookup_ms = (time.perf_counter() - started) * 1000.0

        # 3) Hit → return the cached result so the orchestrator skips every AI
        #    stage (Req 34.3). Miss → proceed normally (Req 34.4).
        if cached is not None:
            return StageResult(
                success=True,
                output=DuplicateDecision(
                    cache_hit=True,
                    result=cached,
                    video_hash=video_hash,
                    lookup_ms=lookup_ms,
                ),
            )

        return StageResult(
            success=True,
            output=DuplicateDecision(
                cache_hit=False,
                result=None,
                video_hash=video_hash,
                lookup_ms=lookup_ms,
            ),
        )
