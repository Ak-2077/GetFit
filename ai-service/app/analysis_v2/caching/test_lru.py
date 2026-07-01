"""Unit tests for the shared VolatileLRU primitive (Req 38.5, 39.5)."""

from __future__ import annotations

import threading

from app.analysis_v2.caching.lru import VolatileLRU


def test_get_miss_returns_none():
    cache: VolatileLRU[str, int] = VolatileLRU(2)
    assert cache.get("absent") is None


def test_put_then_get_returns_value():
    cache: VolatileLRU[str, int] = VolatileLRU(2)
    cache.put("a", 1)
    assert cache.get("a") == 1
    assert cache.contains("a")
    assert "a" in cache


def test_evicts_least_recently_used_at_capacity():
    cache: VolatileLRU[str, int] = VolatileLRU(2)
    cache.put("a", 1)
    cache.put("b", 2)
    # Touch "a" so "b" becomes least-recently-used.
    cache.get("a")
    cache.put("c", 3)
    assert "b" not in cache
    assert cache.get("a") == 1
    assert cache.get("c") == 3
    assert len(cache) == 2


def test_never_exceeds_max_entries():
    cache: VolatileLRU[int, int] = VolatileLRU(3)
    for i in range(10):
        cache.put(i, i)
        assert len(cache) <= 3
    assert len(cache) == 3


def test_update_existing_key_does_not_grow_or_evict():
    cache: VolatileLRU[str, int] = VolatileLRU(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("a", 99)  # update, not insert
    assert len(cache) == 2
    assert cache.get("a") == 99
    assert cache.get("b") == 2


def test_update_refreshes_recency():
    cache: VolatileLRU[str, int] = VolatileLRU(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("a", 11)  # "a" is now most-recently-used
    cache.put("c", 3)   # should evict "b"
    assert "b" not in cache
    assert cache.get("a") == 11
    assert cache.get("c") == 3


def test_clear_empties_cache():
    cache: VolatileLRU[str, int] = VolatileLRU(4)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.clear()
    assert len(cache) == 0
    assert cache.get("a") is None
    assert "b" not in cache


def test_non_positive_capacity_coerced_to_one():
    cache: VolatileLRU[str, int] = VolatileLRU(0)
    assert cache.max_entries == 1
    cache.put("a", 1)
    cache.put("b", 2)
    assert len(cache) == 1
    assert "a" not in cache
    assert cache.get("b") == 2


def test_iter_yields_keys_lru_to_mru():
    cache: VolatileLRU[str, int] = VolatileLRU(3)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)
    cache.get("a")  # "a" becomes most-recently-used
    assert list(cache) == ["b", "c", "a"]


def test_thread_safe_under_concurrent_puts():
    cache: VolatileLRU[int, int] = VolatileLRU(50)

    def worker(base: int) -> None:
        for i in range(200):
            cache.put(base * 1000 + i, i)
            cache.get(base * 1000 + i)

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Invariant: capacity is never exceeded regardless of concurrent access.
    assert len(cache) <= 50
