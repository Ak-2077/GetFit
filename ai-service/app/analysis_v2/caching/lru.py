"""
Shared Volatile LRU Primitive (Req 38.5, 39.5)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A generic, bounded, **memory-only** Least-Recently-Used cache used as the
shared primitive beneath the `Frame_Cache` (Stage 37, Req 38) and the
`Pose_Cache` (Stage 38, Req 39). It is the single source of LRU + capacity
semantics so both caches share identical, independently-testable behavior.

Design intent (design.md "Stage 37 · Frame_Cache & Stage 38 · Pose_Cache"):

  • **Volatile by construction** — entries live only in an in-process
    ``OrderedDict``. Nothing is ever written to disk, and the primitive holds
    only whatever values its consumers hand it. The privacy guarantee of
    Requirement 1 is preserved because the consumers key by hash and never
    place persistent state here; ``clear()`` empties the cache on processing
    completion (Req 38.4/38.6, 39.6 are enforced by the consumers — this
    primitive simply never persists).

  • **Bounded with LRU eviction** — when the cache is full, inserting a new
    key evicts the least-recently-used entry *before* the new entry is stored,
    so the number of live entries never exceeds ``max_entries``
    (Req 38.5, 39.5).

  • **Recency tracking** — both ``get`` (on a hit) and ``put`` (on insert or
    update) mark the touched key as most-recently-used.

  • **Thread-safe** — all mutating/reading operations are guarded by a
    re-entrant lock so the caches can be shared across worker threads safely.

This module is generic over key/value types and contains **no** frame-, pose-,
or video-specific logic; that lives in ``frame_cache.py`` (21.2) and
``pose_cache.py`` (21.3).

Requirement coverage: 38.5, 39.5 (capacity-bounded LRU eviction; volatile,
non-persistent storage).
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Generic, Iterator, TypeVar

K = TypeVar("K")
V = TypeVar("V")


class VolatileLRU(Generic[K, V]):
    """A bounded, in-memory (volatile) least-recently-used cache.

    The cache stores at most ``max_entries`` key/value pairs entirely in
    process memory. On insertion at capacity the least-recently-used entry is
    evicted first (Req 38.5, 39.5). Nothing is ever persisted to disk.

    The consumers (``Frame_Cache``, ``Pose_Cache``) key this cache by hash and
    call :meth:`clear` when processing completes so no frame/pose data outlives
    a job, preserving the privacy guarantee of Requirement 1.
    """

    __slots__ = ("_max_entries", "_store", "_lock")

    def __init__(self, max_entries: int) -> None:
        """Create a volatile LRU bounded to ``max_entries`` live entries.

        ``max_entries`` is coerced to at least 1 so a misconfigured (zero or
        negative) capacity degrades to a minimal usable cache rather than a
        cache that can never store anything. Callers pass their configured
        maximum (e.g. ``FRAME_CACHE_MAX`` / ``POSE_CACHE_MAX``).
        """
        self._max_entries: int = max(1, int(max_entries))
        # OrderedDict preserves insertion/access order; the left end is the
        # least-recently-used entry, the right end the most-recently-used.
        self._store: "OrderedDict[K, V]" = OrderedDict()
        # Re-entrant so composite operations remain safe under shared use.
        self._lock = threading.RLock()

    @property
    def max_entries(self) -> int:
        """The configured maximum number of live entries."""
        return self._max_entries

    def get(self, key: K) -> "V | None":
        """Return the value for ``key`` and mark it most-recently-used.

        Returns ``None`` on a miss. A hit refreshes the entry's recency so it
        is evicted last (standard LRU semantics).
        """
        with self._lock:
            if key not in self._store:
                return None
            self._store.move_to_end(key)
            return self._store[key]

    def put(self, key: K, value: V) -> None:
        """Insert or update ``key`` → ``value`` as the most-recently-used entry.

        When the cache is at capacity and ``key`` is new, the least-recently-used
        entry is evicted *before* the new entry is stored, so the live entry
        count never exceeds ``max_entries`` (Req 38.5, 39.5).
        """
        with self._lock:
            if key in self._store:
                # Update in place and refresh recency.
                self._store[key] = value
                self._store.move_to_end(key)
                return
            if len(self._store) >= self._max_entries:
                # Evict the least-recently-used entry (left end) first.
                self._store.popitem(last=False)
            self._store[key] = value

    def contains(self, key: K) -> bool:
        """Return whether ``key`` is currently cached, without affecting recency."""
        with self._lock:
            return key in self._store

    def clear(self) -> None:
        """Drop every cached entry.

        Called by the consumers when processing completes so no cached
        frame/pose data outlives a job (volatile-only; Req 38.4, 39.6).
        """
        with self._lock:
            self._store.clear()

    def __contains__(self, key: object) -> bool:
        with self._lock:
            return key in self._store

    def __len__(self) -> int:
        """The number of entries currently held (always ≤ ``max_entries``)."""
        with self._lock:
            return len(self._store)

    def __iter__(self) -> Iterator[K]:
        # Snapshot keys under the lock so iteration is safe even if the cache
        # is mutated concurrently. Order is LRU → MRU.
        with self._lock:
            return iter(list(self._store.keys()))

    def __repr__(self) -> str:  # pragma: no cover - debug aid only
        with self._lock:
            return f"VolatileLRU(size={len(self._store)}, max_entries={self._max_entries})"
