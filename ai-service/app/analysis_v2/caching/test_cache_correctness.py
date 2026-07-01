"""
Property + unit tests for cache correctness over Frame_Cache and Pose_Cache.

# Feature: ai-exercise-analysis, Property 45: Caches return identical data on hit,
# recompute on miss, evict LRU, and stay volatile — for any cache (Frame_Cache or
# Pose_Cache) and any sequence of accesses, an exact-key hit returns data identical
# to what was stored without invoking the underlying decode/extract, a miss invokes
# the underlying operation and stores the result, the number of stored entries never
# exceeds the configured maximum (the least-recently-used entry is evicted first), a
# store or retrieve failure falls back to recompute without interrupting the pipeline,
# and after processing completes the cache holds no entries (volatile only).

**Validates: Requirements 38.1, 38.2, 38.3, 38.4, 38.5, 38.6, 39.1, 39.2, 39.3, 39.4, 39.5, 39.6**
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Callable, List, Tuple

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis_v2.caching.frame_cache import FrameCache
from app.analysis_v2.caching.pose_cache import PoseCache


# ─────────────────────────────────────────────────────────────────────────────
# Cache adapters — one shared property covers BOTH caches (Property 45 spans
# Frame_Cache Req 38 and Pose_Cache Req 39). Each adapter exposes a uniform
# (build, call, key_for) surface so the same access sequence exercises either.
# ─────────────────────────────────────────────────────────────────────────────
class _FrameAdapter:
    """Adapts FrameCache.get_or_decode into the uniform test surface."""

    label = "frame"

    @staticmethod
    def build(max_entries: int, *, lru=None) -> FrameCache:
        return FrameCache(max_entries, lru=lru) if lru is not None else FrameCache(max_entries)

    @staticmethod
    def key_for(i: int) -> Tuple[str, float]:
        # (Video_Hash, frame_timestamp) — same video, distinct timestamps.
        return ("vhash-abc", float(i))

    @staticmethod
    def call(cache: FrameCache, key: Tuple[str, float], delegate: Callable[[], object]) -> object:
        video_hash, ts_ms = key
        return cache.get_or_decode(video_hash, ts_ms, delegate)


class _PoseAdapter:
    """Adapts PoseCache.get_or_extract into the uniform test surface."""

    label = "pose"

    @staticmethod
    def build(max_entries: int, *, lru=None) -> PoseCache:
        return PoseCache(max_entries, lru=lru) if lru is not None else PoseCache(max_entries)

    @staticmethod
    def key_for(i: int) -> Tuple[str, str]:
        # (Frame_Hash, pose_engine_version) — distinct frame hashes, fixed engine.
        return (f"fhash-{i}", "engine-v1")

    @staticmethod
    def call(cache: PoseCache, key: Tuple[str, str], delegate: Callable[[], object]) -> object:
        frame_hash, engine_version = key
        return cache.get_or_extract(frame_hash, engine_version, delegate)


ADAPTERS = [_FrameAdapter, _PoseAdapter]
ADAPTER_IDS = [a.label for a in ADAPTERS]


# ─────────────────────────────────────────────────────────────────────────────
# Generators
# ─────────────────────────────────────────────────────────────────────────────
def cache_access_sequences() -> st.SearchStrategy[List[int]]:
    """A sequence of key ids drawn from a small pool so hits and misses interleave."""
    return st.lists(st.integers(min_value=0, max_value=11), min_size=0, max_size=60)


# A faulty LRU whose operations always raise — used to prove the caches fail open
# (Req 38.6 / 39.4): a cache error must degrade to recompute, never propagate.
class _BrokenLRU:
    max_entries = 1

    def get(self, key):  # noqa: D401 - test double
        raise RuntimeError("simulated cache retrieve failure")

    def put(self, key, value):  # noqa: D401 - test double
        raise RuntimeError("simulated cache store failure")

    def clear(self):
        raise RuntimeError("simulated cache clear failure")

    def __len__(self):
        return 0

    def __bool__(self):
        # Stay truthy: the caches build `self._lru = lru or VolatileLRU(...)`,
        # so a falsy double (len 0) would be discarded and never exercised.
        return True


# ─────────────────────────────────────────────────────────────────────────────
# Property 45
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("adapter", ADAPTERS, ids=ADAPTER_IDS)
@given(accesses=cache_access_sequences(), max_entries=st.integers(min_value=1, max_value=256))
@settings(max_examples=200, deadline=None)
def test_cache_correctness(adapter, accesses, max_entries):
    """Property 45 — hit returns identical stored value & skips compute; miss
    computes exactly once & stores; capacity is never exceeded (LRU eviction);
    clear() empties; re-request after clear recomputes."""
    cache = adapter.build(max_entries)

    # Reference LRU model predicts hit/miss and eviction ordering (Req *.5).
    model: "OrderedDict[object, object]" = OrderedDict()
    compute_calls = {"total": 0}

    for i in accesses:
        key = adapter.key_for(i)

        produced: List[object] = []

        def delegate():
            compute_calls["total"] += 1
            value = object()  # fresh, unique, non-None value
            produced.append(value)
            return value

        predicted_hit = key in model
        before = compute_calls["total"]
        result = adapter.call(cache, key, delegate)
        was_miss = compute_calls["total"] > before

        if predicted_hit:
            # Hit: delegate NOT invoked (Req 38.2 / 39.2) and the SAME stored
            # object is returned (identical data on hit).
            assert not was_miss, "delegate was invoked on an exact-key hit"
            assert result is model[key], "hit did not return the stored value"
            model.move_to_end(key)
        else:
            # Miss: delegate invoked exactly once (Req 38.3 / 39.3) and result stored.
            assert was_miss, "delegate was not invoked on a miss"
            assert compute_calls["total"] - before == 1, "delegate invoked more than once on a miss"
            assert result is produced[0]
            if len(model) >= max_entries:
                model.popitem(last=False)  # evict LRU first (Req 38.5 / 39.5)
            model[key] = result

        # Invariant: live entries never exceed the configured maximum, and the
        # cache tracks the reference model exactly (Req 38.1 / 39.1, 38.5 / 39.5).
        assert len(cache) <= max_entries
        assert len(cache) == len(model)

    # clear() empties the cache — volatile only, nothing persists (Req 38.4 / 39.6).
    cache.clear()
    assert len(cache) == 0

    # A re-request after clear() is a miss → recomputes (nothing outlived clear()).
    if accesses:
        key = adapter.key_for(accesses[0])
        recomputed = {"n": 0}

        def delegate_after_clear():
            recomputed["n"] += 1
            return object()

        adapter.call(cache, key, delegate_after_clear)
        assert recomputed["n"] == 1, "cache did not recompute after clear()"


@pytest.mark.parametrize("adapter", ADAPTERS, ids=ADAPTER_IDS)
@given(ids=st.lists(st.integers(min_value=0, max_value=20), min_size=1, max_size=30))
@settings(max_examples=100, deadline=None)
def test_cache_fails_open_on_backend_error(adapter, ids):
    """Property 45 (fail-open clause) — a store/retrieve failure degrades to
    recompute and never interrupts the pipeline (Req 38.6 / 39.4)."""
    cache = adapter.build(64, lru=_BrokenLRU())

    for i in ids:
        key = adapter.key_for(i)
        calls = {"n": 0}

        def delegate():
            calls["n"] += 1
            return object()

        # Backend get/put both raise; the call must still succeed by recomputing.
        result = adapter.call(cache, key, delegate)
        assert result is not None
        assert calls["n"] == 1, "fail-open path did not compute exactly once"


# ─────────────────────────────────────────────────────────────────────────────
# Focused unit tests (specific examples & edge cases) for both caches
# ─────────────────────────────────────────────────────────────────────────────
def test_frame_cache_hit_returns_same_object_without_decoding():
    cache: FrameCache = FrameCache(8)
    sentinel = object()
    calls = {"n": 0}

    def decode():
        calls["n"] += 1
        return sentinel

    first = cache.get_or_decode("vhash", 100.0, decode)
    second = cache.get_or_decode("vhash", 100.0, lambda: pytest.fail("decode called on hit"))
    assert first is sentinel
    assert second is sentinel
    assert calls["n"] == 1


def test_pose_cache_hit_returns_same_object_without_extraction():
    cache: PoseCache = PoseCache(8)
    sentinel = object()
    calls = {"n": 0}

    def extract():
        calls["n"] += 1
        return sentinel

    first = cache.get_or_extract("fhash", "engine-v1", extract)
    second = cache.get_or_extract("fhash", "engine-v1", lambda: pytest.fail("extract called on hit"))
    assert first is sentinel
    assert second is sentinel
    assert calls["n"] == 1


def test_frame_cache_evicts_lru_and_bounds_size():
    cache: FrameCache = FrameCache(2)
    cache.get_or_decode("v", 1.0, lambda: "a")
    cache.get_or_decode("v", 2.0, lambda: "b")
    cache.get_or_decode("v", 1.0, lambda: pytest.fail("should be a hit"))  # refresh 1.0
    cache.get_or_decode("v", 3.0, lambda: "c")  # evicts LRU (2.0)
    assert len(cache) == 2
    # 2.0 was evicted → recompute occurs.
    recomputed = cache.get_or_decode("v", 2.0, lambda: "b2")
    assert recomputed == "b2"


def test_pose_cache_distinct_engine_versions_are_distinct_keys():
    cache: PoseCache = PoseCache(8)
    a = cache.get_or_extract("fhash", "engine-v1", lambda: "v1")
    b = cache.get_or_extract("fhash", "engine-v2", lambda: "v2")
    assert a == "v1"
    assert b == "v2"
    assert len(cache) == 2


def test_clear_empties_both_caches():
    fc: FrameCache = FrameCache(4)
    pc: PoseCache = PoseCache(4)
    fc.get_or_decode("v", 1.0, lambda: "x")
    pc.get_or_extract("f", "e", lambda: "y")
    fc.clear()
    pc.clear()
    assert len(fc) == 0
    assert len(pc) == 0
