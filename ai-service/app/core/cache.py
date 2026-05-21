"""
Semantic Response Cache — Redis-backed with embedding similarity.

Caches AI responses keyed by semantic similarity of the query.
Avoids redundant GPU inference for common/repeated questions.

Cache tiers:
  - Exact match (hash of normalized query) → instant
  - Semantic match (cosine similarity > threshold) → near-instant
  - Miss → generate and cache result
"""

import hashlib
import json
import time
import logging
from typing import Optional

import numpy as np
import redis.asyncio as redis

from app.core.config import settings

logger = logging.getLogger("getfit-ai")

# ── Redis connection (lazy init + circuit breaker) ──
_redis: Optional[redis.Redis] = None
_redis_failures: int = 0
_redis_disabled_until: float = 0  # timestamp when to retry
_REDIS_MAX_FAILURES = 3
_REDIS_BACKOFF_SECS = 60  # skip Redis for 60s after repeated failures

CACHE_PREFIX = "sc:"           # semantic cache prefix
EMBED_PREFIX = "sce:"          # cached embeddings prefix
STATS_KEY = "sc:stats"         # rolling stats hash
SIMILARITY_THRESHOLD = 0.92    # cosine similarity threshold for cache hit
DEFAULT_TTL = 3600 * 6         # 6 hours default TTL
SHORT_TTL = 1800               # 30 min for casual/motivation
LONG_TTL = 3600 * 24           # 24h for factual/education
EMBED_TTL = 3600 * 48          # 48h for embedding cache

# Intents eligible for caching (stable, non-personalized responses)
CACHEABLE_INTENTS = {
    "casual_chat", "motivation", "greeting", "factual_query",
    "form_correction", "coaching",
}

# Intents that should NEVER be cached (highly personalized)
UNCACHEABLE_INTENTS = {
    "workout_planning", "nutrition_question", "progress_analysis",
    "injury_concern", "recovery_analysis",
}


async def get_redis() -> redis.Redis:
    """Get or create async Redis connection with circuit breaker."""
    global _redis, _redis_failures, _redis_disabled_until

    # Circuit breaker: skip Redis entirely if recently failed
    if _redis_failures >= _REDIS_MAX_FAILURES:
        if time.time() < _redis_disabled_until:
            raise ConnectionError("Redis circuit breaker open")
        # Retry window — reset and try again
        logger.info("Redis circuit breaker: retrying connection...")
        _redis_failures = 0
        _redis = None

    if _redis is None:
        _redis = redis.from_url(
            settings.REDIS_URL,
            decode_responses=False,
            socket_connect_timeout=1,
            socket_timeout=1,
        )
    return _redis


def _redis_fail():
    """Record a Redis failure and trip circuit breaker if threshold reached."""
    global _redis_failures, _redis_disabled_until, _redis
    _redis_failures += 1
    if _redis_failures >= _REDIS_MAX_FAILURES:
        _redis_disabled_until = time.time() + _REDIS_BACKOFF_SECS
        _redis = None  # force reconnect on next retry
        logger.warning(f"Redis circuit breaker OPEN — skipping cache for {_REDIS_BACKOFF_SECS}s")


def _redis_success():
    """Reset failure counter on successful Redis operation."""
    global _redis_failures
    if _redis_failures > 0:
        _redis_failures = 0


def _normalize_query(query: str) -> str:
    """Normalize query for exact-match hashing."""
    return " ".join(query.lower().strip().split())


def _exact_key(query: str, intent: str) -> str:
    """Hash key for exact query match."""
    normalized = _normalize_query(query)
    h = hashlib.sha256(f"{intent}:{normalized}".encode()).hexdigest()[:16]
    return f"{CACHE_PREFIX}exact:{h}"


def _ttl_for_intent(intent: str) -> int:
    """Select TTL based on intent stability."""
    if intent in ("casual_chat", "greeting", "motivation"):
        return SHORT_TTL
    if intent in ("factual_query", "form_correction"):
        return LONG_TTL
    return DEFAULT_TTL


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Fast cosine similarity."""
    a_np = np.array(a, dtype=np.float32)
    b_np = np.array(b, dtype=np.float32)
    dot = np.dot(a_np, b_np)
    norm = np.linalg.norm(a_np) * np.linalg.norm(b_np)
    return float(dot / norm) if norm > 0 else 0.0


async def cache_get(
    query: str,
    intent: str,
    embedding: Optional[list[float]] = None,
) -> Optional[dict]:
    """
    Try to get a cached response.

    1. Exact match (fast hash lookup)
    2. Semantic match (embedding cosine similarity)

    Returns: { "content": str, "cache": "exact"|"semantic", "similarity": float }
             or None on miss
    """
    if intent in UNCACHEABLE_INTENTS:
        return None

    try:
        r = await get_redis()

        # ── Exact match ──
        t_start = time.time()
        exact = await r.get(_exact_key(query, intent))
        if exact:
            data = json.loads(exact)
            logger.debug(f"Cache HIT (exact): {query[:40]}...")
            await _stat_incr(r, "hits")
            await _stat_incr(r, "gpu_avoided")
            await _stat_incr_float(r, "latency_saved_ms", 3000)  # ~3s saved per cache hit
            return {"content": data["content"], "cache": "exact", "similarity": 1.0}

        # ── Semantic match ──
        if embedding and intent in CACHEABLE_INTENTS:
            # Get all semantic cache entries for this intent
            pattern = f"{CACHE_PREFIX}sem:{intent}:*"
            keys = []
            async for key in r.scan_iter(match=pattern, count=50):
                keys.append(key)

            if keys:
                # Batch fetch
                entries = await r.mget(keys)
                best_sim = 0.0
                best_entry = None

                for raw in entries:
                    if not raw:
                        continue
                    try:
                        entry = json.loads(raw)
                        sim = _cosine_similarity(embedding, entry.get("embedding", []))
                        if sim > best_sim:
                            best_sim = sim
                            best_entry = entry
                    except (json.JSONDecodeError, KeyError):
                        continue

                if best_entry and best_sim >= SIMILARITY_THRESHOLD:
                    logger.debug(f"Cache HIT (semantic, sim={best_sim:.3f}): {query[:40]}...")
                    await _stat_incr(r, "hits")
                    await _stat_incr(r, "gpu_avoided")
                    await _stat_incr_float(r, "latency_saved_ms", 3000)
                    return {
                        "content": best_entry["content"],
                        "cache": "semantic",
                        "similarity": best_sim,
                    }

    except Exception as e:
        _redis_fail()
        logger.warning(f"Cache get error: {e}")
        return None

    _redis_success()

    # Record miss
    try:
        r = await get_redis()
        await _stat_incr(r, "misses")
    except Exception:
        pass

    return None


async def cache_set(
    query: str,
    intent: str,
    content: str,
    embedding: Optional[list[float]] = None,
) -> None:
    """
    Store a response in both exact and semantic caches.
    """
    if intent in UNCACHEABLE_INTENTS:
        return
    if len(content) < 20:
        return  # don't cache trivially short responses

    try:
        r = await get_redis()
        ttl = _ttl_for_intent(intent)

        # ── Exact cache ──
        exact_data = json.dumps({"content": content, "ts": int(time.time())})
        await r.setex(_exact_key(query, intent), ttl, exact_data)

        # ── Semantic cache (only for cacheable intents with embedding) ──
        if embedding and intent in CACHEABLE_INTENTS:
            h = hashlib.sha256(_normalize_query(query).encode()).hexdigest()[:12]
            sem_key = f"{CACHE_PREFIX}sem:{intent}:{h}"
            sem_data = json.dumps({
                "content": content,
                "embedding": embedding,
                "ts": int(time.time()),
            })
            await r.setex(sem_key, ttl, sem_data)

        _redis_success()
    except Exception as e:
        _redis_fail()
        logger.warning(f"Cache set error: {e}")


# ═══ EMBEDDING CACHE ═══

async def embed_cache_get(text: str) -> Optional[list[float]]:
    """Get cached embedding for text. Avoids repeated GPU embedding calls."""
    try:
        r = await get_redis()
        key = f"{EMBED_PREFIX}{hashlib.sha256(_normalize_query(text).encode()).hexdigest()[:16]}"
        raw = await r.get(key)
        if raw:
            await _stat_incr(r, "embed_hits")
            return json.loads(raw)
        await _stat_incr(r, "embed_misses")
        _redis_success()
    except Exception as e:
        _redis_fail()
        logger.warning(f"Embed cache get error: {e}")
    return None


async def embed_cache_set(text: str, embedding: list[float]) -> None:
    """Cache an embedding vector in Redis."""
    try:
        r = await get_redis()
        key = f"{EMBED_PREFIX}{hashlib.sha256(_normalize_query(text).encode()).hexdigest()[:16]}"
        await r.setex(key, EMBED_TTL, json.dumps(embedding))
        _redis_success()
    except Exception as e:
        _redis_fail()
        logger.warning(f"Embed cache set error: {e}")


# ═══ STATS TRACKING ═══

async def _stat_incr(r, field: str, amount: int = 1) -> None:
    """Increment a rolling stats counter."""
    try:
        await r.hincrby(STATS_KEY, field, amount)
    except Exception:
        pass


async def _stat_incr_float(r, field: str, amount: float) -> None:
    """Increment a rolling stats float counter."""
    try:
        await r.hincrbyfloat(STATS_KEY, field, amount)
    except Exception:
        pass


async def cache_stats() -> dict:
    """Get cache statistics with hit rates and performance data."""
    try:
        r = await get_redis()
        exact_count = 0
        sem_count = 0
        embed_count = 0
        async for _ in r.scan_iter(match=f"{CACHE_PREFIX}exact:*", count=100):
            exact_count += 1
        async for _ in r.scan_iter(match=f"{CACHE_PREFIX}sem:*", count=100):
            sem_count += 1
        async for _ in r.scan_iter(match=f"{EMBED_PREFIX}*", count=100):
            embed_count += 1

        # Rolling stats
        raw_stats = await r.hgetall(STATS_KEY)
        stats = {k.decode() if isinstance(k, bytes) else k: v.decode() if isinstance(v, bytes) else v for k, v in raw_stats.items()}

        hits = int(stats.get("hits", 0))
        misses = int(stats.get("misses", 0))
        total = hits + misses
        embed_hits = int(stats.get("embed_hits", 0))
        embed_misses = int(stats.get("embed_misses", 0))
        embed_total = embed_hits + embed_misses
        latency_saved_ms = float(stats.get("latency_saved_ms", 0))
        gpu_avoided = int(stats.get("gpu_avoided", 0))

        return {
            "exact_entries": exact_count,
            "semantic_entries": sem_count,
            "embed_entries": embed_count,
            "response_cache": {
                "hits": hits,
                "misses": misses,
                "hit_rate": f"{(hits / total * 100):.1f}%" if total > 0 else "0%",
                "latency_saved_ms": round(latency_saved_ms, 1),
                "gpu_requests_avoided": gpu_avoided,
            },
            "embed_cache": {
                "hits": embed_hits,
                "misses": embed_misses,
                "hit_rate": f"{(embed_hits / embed_total * 100):.1f}%" if embed_total > 0 else "0%",
            },
        }
    except Exception:
        return {"exact_entries": 0, "semantic_entries": 0, "error": "redis unavailable"}
