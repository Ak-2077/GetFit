"""
Stage 37 · Frame_Cache (Req 38)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** volatile cache that wraps the V1
`Frame_Extraction_Service` (design.md "Stage 37 · Frame_Cache & Stage 38 ·
Pose_Cache"). It sits *around* extraction so the unchanged V1 pipeline still
runs; it never modifies the V1 stage, its `Frame`/`FrameSet` contracts, or the
extraction interface (Req 52.1–52.4).

The cache is keyed by the exact combination of ``(Video_Hash, frame_timestamp)``
and holds decoded frames in the shared, memory-only `VolatileLRU` primitive
(Req 38.5), bounded by ``FRAME_CACHE_MAX`` (config_v2). Its purpose is to ensure
the same video is never decoded twice within a job.

Behavior (Req 38):
  • Req 38.1 — decoded frames are stored keyed by the exact ``(Video_Hash,
    frame_timestamp)`` combination, up to the configured maximum number of
    cached frames (``FRAME_CACHE_MAX``).
  • Req 38.2 — a request whose ``(Video_Hash, frame_timestamp)`` exactly matches
    a cached key returns the cached frame and excludes repeated decoding (the
    ``decode`` delegate is NOT invoked on a hit).
  • Req 38.3 — a miss allows the `Frame_Extraction_Service` to decode the frame
    (the ``decode`` delegate is invoked) and the result is stored.
  • Req 38.4 — cached frames live only in volatile memory, are never persisted,
    and :meth:`clear` deletes every cached frame immediately after processing
    completes, preserving the privacy guarantee of Requirement 1.
  • Req 38.5 — at capacity the least-recently-used cached frame is evicted
    before a new frame is stored (delegated to `VolatileLRU`).
  • Req 38.6 — a store or retrieve failure degrades gracefully: the frame is
    decoded normally and returned without interrupting the Analysis_Pipeline
    (fail open — a cache error never propagates).

Privacy by construction (Req 1, preserved by Req 52.5): the cache holds only the
decoded frame values its consumer hands it, keyed by a content hash + timestamp;
nothing is written to disk and :meth:`clear` empties it on completion, so no
frame data outlives a job.
"""

from __future__ import annotations

from typing import Callable, Generic, Tuple, TypeVar

# Build on the shared volatile LRU primitive (Req 38.5), re-exported from the
# caching package — imported, never redefined.
from app.analysis_v2.caching.lru import VolatileLRU
from app.analysis_v2.config_v2 import settings_v2

#: The decoded-frame value type. Generic so the cache stays agnostic to how a
#: decoded frame is represented (e.g. a pixel buffer / array handle); the V1
#: `Frame`/`FrameSet` contracts are never modified by this wrapper.
F = TypeVar("F")

#: The exact cache key: (Video_Hash, frame_timestamp).
FrameKey = Tuple[str, float]


class FrameCache(Generic[F]):
    """Volatile LRU cache of decoded frames keyed by ``(Video_Hash, timestamp)``.

    Wraps the V1 `Frame_Extraction_Service` additively: consumers call
    :meth:`get_or_decode`, which returns a cached frame on an exact-key hit
    (no decoding, Req 38.2) or decodes-then-stores on a miss (Req 38.1, 38.3).
    Any cache error falls back to decoding without interrupting the pipeline
    (Req 38.6). Entries are volatile-only and dropped by :meth:`clear` on
    processing completion (Req 38.4).
    """

    __slots__ = ("_lru",)

    def __init__(
        self,
        max_frames: int | None = None,
        *,
        lru: "VolatileLRU[FrameKey, F] | None" = None,
    ) -> None:
        """Create a Frame_Cache bounded to ``max_frames`` decoded frames.

        ``max_frames`` defaults to ``FRAME_CACHE_MAX`` from ``config_v2`` when
        not supplied (Req 38.1); an absent/invalid capacity degrades to the
        `VolatileLRU` minimum rather than an unusable cache. A pre-built ``lru``
        may be injected for testing.
        """
        capacity = settings_v2.FRAME_CACHE_MAX if max_frames is None else max_frames
        self._lru: "VolatileLRU[FrameKey, F]" = lru or VolatileLRU(capacity)

    @staticmethod
    def _key(video_hash: str, ts_ms: float) -> FrameKey:
        """Build the exact ``(Video_Hash, frame_timestamp)`` cache key (Req 38.1)."""
        return (video_hash, float(ts_ms))

    def get_or_decode(
        self,
        video_hash: str,
        ts_ms: float,
        decode: Callable[[], F],
    ) -> F:
        """Return the cached frame for ``(video_hash, ts_ms)`` or decode it.

        On an exact-key hit the cached frame is returned and ``decode`` is NOT
        invoked (Req 38.2). On a miss ``decode`` is invoked and its result is
        stored keyed by ``(video_hash, ts_ms)`` (Req 38.1, 38.3). If a cache
        store or retrieve operation fails, the frame is decoded and returned
        anyway without interrupting the pipeline (Req 38.6 — fail open).

        ``decode`` is the caller's delegate to the V1 `Frame_Extraction_Service`;
        exceptions raised by ``decode`` itself are extraction failures (not cache
        errors) and propagate unchanged so the pipeline handles them normally.
        """
        key = self._key(video_hash, ts_ms)

        # ── Retrieve (Req 38.2) — fail open on any cache error (Req 38.6) ──
        try:
            cached = self._lru.get(key)
        except Exception:
            # A retrieve failure must not interrupt the pipeline: decode
            # normally and return without touching the cache further.
            return decode()

        if cached is not None:
            # Exact-key hit — return the cached frame, no decoding (Req 38.2).
            return cached

        # ── Miss — allow the Frame_Extraction_Service to decode (Req 38.3) ──
        frame = decode()

        # ── Store keyed by the exact combination (Req 38.1); LRU-evict at
        #    capacity (Req 38.5). A store failure is swallowed so the already
        #    decoded frame is still returned (Req 38.6 — fail open).
        try:
            self._lru.put(key, frame)
        except Exception:
            pass

        return frame

    def clear(self) -> None:
        """Delete every cached frame (end-of-job cleanup, Req 38.4).

        Called on processing completion so no decoded frame outlives a job,
        preserving the volatile-only privacy guarantee of Requirement 1.
        """
        self._lru.clear()

    def __len__(self) -> int:
        """Number of frames currently cached (always ≤ configured maximum)."""
        return len(self._lru)

    def __repr__(self) -> str:  # pragma: no cover - debug aid only
        return f"FrameCache(size={len(self._lru)}, max_frames={self._lru.max_entries})"
