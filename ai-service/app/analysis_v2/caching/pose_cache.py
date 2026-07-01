"""
Stage 38 · Pose_Cache (Req 39)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** volatile cache that wraps the V1
`Pose_Extraction_Service` (design.md "Stage 37 · Frame_Cache & Stage 38 ·
Pose_Cache"). It sits *around* pose extraction so the unchanged V1 pipeline
still runs; it never modifies the V1 stage, its `Landmarks`/`FrameLandmarks`
contracts, or the Pose_Engine interface (Req 52.1–52.4).

The cache is keyed by the exact combination of ``(Frame_Hash,
pose_engine_version)`` and holds extracted pose landmarks in the shared,
memory-only `VolatileLRU` primitive (Req 39.5), bounded by ``POSE_CACHE_MAX``
(config_v2). Its purpose is to ensure identical frames are never re-run through
the same Pose_Engine version within a job.

Behavior (Req 39):
  • Req 39.1 — extracted landmarks are stored keyed by the exact combination of
    ``(Frame_Hash, pose_engine_version)``, up to the configured maximum number
    of cache entries (``POSE_CACHE_MAX``).
  • Req 39.2 — a request whose ``(Frame_Hash, pose_engine_version)`` exactly
    matches a cached key returns landmarks identical to those stored and
    excludes any Pose_Engine invocation (the ``extract`` delegate is NOT invoked
    on a hit).
  • Req 39.3 — a miss allows the `Pose_Extraction_Service` to extract landmarks
    (the ``extract`` delegate is invoked) and stores the result under that key.
  • Req 39.4 — a store or retrieve failure degrades gracefully: landmarks are
    extracted normally and returned without interrupting the Analysis_Pipeline
    (fail open — a cache error never propagates).
  • Req 39.5 — at capacity the least-recently-used cached entry is evicted
    before a new entry is stored (delegated to `VolatileLRU`).
  • Req 39.6 — cached landmarks live only in volatile memory, pose images are
    never persisted, and :meth:`clear` deletes every cached entry immediately
    after processing completes, preserving the privacy guarantee of
    Requirement 1.

Privacy by construction (Req 1, preserved by Req 52.5): the cache holds only the
normalized landmark values its consumer hands it, keyed by a frame content hash
+ engine version; NO pose image is ever stored, nothing is written to disk, and
:meth:`clear` empties it on completion, so no pose data outlives a job.
"""

from __future__ import annotations

from typing import Callable, Generic, Tuple, TypeVar

# Build on the shared volatile LRU primitive (Req 39.5), re-exported from the
# caching package — imported, never redefined.
from app.analysis_v2.caching.lru import VolatileLRU
from app.analysis_v2.config_v2 import settings_v2

#: The extracted-landmarks value type. Generic so the cache stays agnostic to
#: how landmarks are represented; in the V2 pipeline this is the V1
#: `FrameLandmarks` (or `Landmarks`) contract from `app/analysis/contracts.py`,
#: which this wrapper never modifies.
P = TypeVar("P")

#: The exact cache key: (Frame_Hash, pose_engine_version).
PoseKey = Tuple[str, str]


class PoseCache(Generic[P]):
    """Volatile LRU cache of pose landmarks keyed by ``(Frame_Hash, engine_version)``.

    Wraps the V1 `Pose_Extraction_Service` additively: consumers call
    :meth:`get_or_extract`, which returns identical cached landmarks on an
    exact-key hit (no Pose_Engine call, Req 39.2) or extracts-then-stores on a
    miss (Req 39.1, 39.3). Any cache error falls back to extraction without
    interrupting the pipeline (Req 39.4). Entries are volatile-only — pose
    images are never persisted — and dropped by :meth:`clear` on processing
    completion (Req 39.6).
    """

    __slots__ = ("_lru",)

    def __init__(
        self,
        max_entries: int | None = None,
        *,
        lru: "VolatileLRU[PoseKey, P] | None" = None,
    ) -> None:
        """Create a Pose_Cache bounded to ``max_entries`` landmark entries.

        ``max_entries`` defaults to ``POSE_CACHE_MAX`` from ``config_v2`` when
        not supplied (Req 39.1); an absent/invalid capacity degrades to the
        `VolatileLRU` minimum rather than an unusable cache. A pre-built ``lru``
        may be injected for testing.
        """
        capacity = settings_v2.POSE_CACHE_MAX if max_entries is None else max_entries
        self._lru: "VolatileLRU[PoseKey, P]" = lru or VolatileLRU(capacity)

    @staticmethod
    def _key(frame_hash: str, engine_version: str) -> PoseKey:
        """Build the exact ``(Frame_Hash, pose_engine_version)`` cache key (Req 39.1)."""
        return (str(frame_hash), str(engine_version))

    def get_or_extract(
        self,
        frame_hash: str,
        engine_version: str,
        extract: Callable[[], P],
    ) -> P:
        """Return cached landmarks for ``(frame_hash, engine_version)`` or extract them.

        On an exact-key hit the cached landmarks are returned identical to those
        stored and ``extract`` is NOT invoked (no Pose_Engine call, Req 39.2).
        On a miss ``extract`` is invoked and its result is stored keyed by
        ``(frame_hash, engine_version)`` (Req 39.1, 39.3). If a cache store or
        retrieve operation fails, landmarks are extracted and returned anyway
        without interrupting the pipeline (Req 39.4 — fail open).

        ``extract`` is the caller's delegate to the V1 `Pose_Extraction_Service`;
        exceptions raised by ``extract`` itself are extraction failures (not
        cache errors) and propagate unchanged so the pipeline handles them
        normally.
        """
        key = self._key(frame_hash, engine_version)

        # ── Retrieve (Req 39.2) — fail open on any cache error (Req 39.4) ──
        try:
            cached = self._lru.get(key)
        except Exception:
            # A retrieve failure must not interrupt the pipeline: extract
            # normally and return without touching the cache further.
            return extract()

        if cached is not None:
            # Exact-key hit — return identical landmarks, no Pose_Engine
            # invocation (Req 39.2).
            return cached

        # ── Miss — allow the Pose_Extraction_Service to extract (Req 39.3) ──
        landmarks = extract()

        # ── Store keyed by the exact combination (Req 39.1); LRU-evict at
        #    capacity (Req 39.5). A store failure is swallowed so the already
        #    extracted landmarks are still returned (Req 39.4 — fail open).
        try:
            self._lru.put(key, landmarks)
        except Exception:
            pass

        return landmarks

    def clear(self) -> None:
        """Delete every cached landmark entry (end-of-job cleanup, Req 39.6).

        Called on processing completion so no pose landmarks outlive a job and
        no pose image is ever persisted, preserving the volatile-only privacy
        guarantee of Requirement 1.
        """
        self._lru.clear()

    def __len__(self) -> int:
        """Number of landmark entries currently cached (always ≤ configured maximum)."""
        return len(self._lru)

    def __repr__(self) -> str:  # pragma: no cover - debug aid only
        return f"PoseCache(size={len(self._lru)}, max_entries={self._lru.max_entries})"
