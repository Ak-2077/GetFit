"""
Property tests for Stage 50 · Secure_Temporary_Storage_Service — secure cleanup
(Req 51.2, 51.4, 51.5, 51.6).

Property 61: Secure cleanup is complete, reported, and retried on failure.

*For any* set of artifacts created for an Analysis_Job and *for any* termination
path, after secure cleanup no artifact created by the job remains in storage,
the reported deleted-location set equals the set of created artifacts, and *for
any* deletion that fails the service retries the secure deletion at most
``max_delete_retries`` times and records a `StructuredError` identifying the
artifact location(s) that could not be deleted.

The service's `cleanup` is async; following the established V2 property-test
convention (`test_retry_manager_property.py`, `test_cost_tracking_property.py`,
etc.) it is driven synchronously via ``asyncio.run``. A fake
`SecureArtifactStore` that fails `secure_delete` a configurable number of times
before succeeding is injected so retry/failure behavior can be asserted exactly
across many inputs.

**Validates: Requirements 51.2, 51.4, 51.5, 51.6**

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest \
        app/analysis_v2/storage/test_secure_temp_storage_cleanup_property.py -q
"""

from __future__ import annotations

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import CleanupReport
from app.analysis_v2 import StructuredError
from app.analysis_v2.storage.secure_temp_storage import (
    SECURE_DELETE_FAILED,
    STAGE_NAME,
    InMemorySecureArtifactStore,
    SecureTemporaryStorageService,
)

# Minimum iterations mandated for these property tests.
_MIN_ITER = 100


# ─────────────────────────────────────────────────────────────────────────
# Shared generators
# ─────────────────────────────────────────────────────────────────────────

# Job ids and artifact ids kept to simple, non-empty, filesystem-safe tokens so
# generated location handles are distinct and well-formed.
_token = st.text(
    alphabet=st.characters(
        whitelist_categories=("Ll", "Lu", "Nd"), whitelist_characters="-_"
    ),
    min_size=1,
    max_size=12,
)
_job_id = _token
# A set of distinct artifact ids for one job (order-independent identity).
_artifact_ids = st.lists(_token, min_size=0, max_size=6, unique=True)
# Small artifact payloads — content is irrelevant to cleanup behavior.
_data = st.binary(min_size=0, max_size=64)


# ─────────────────────────────────────────────────────────────────────────
# Fake stores for retry / failure scenarios
# ─────────────────────────────────────────────────────────────────────────
class _CountingStore(InMemorySecureArtifactStore):
    """An in-memory store that counts `secure_delete` calls per location."""

    def __init__(self) -> None:
        super().__init__()
        self.attempts: dict[str, int] = {}

    def secure_delete(self, location: str) -> None:
        self.attempts[location] = self.attempts.get(location, 0) + 1
        super().secure_delete(location)


class _FlakyStore(InMemorySecureArtifactStore):
    """
    A store whose `secure_delete` fails (raises, leaving the artifact present)
    the first ``fail_times`` times it is called for a location, then succeeds.

    Tracks the number of `secure_delete` attempts per location so the retry
    bound can be asserted.
    """

    def __init__(self, fail_times: int) -> None:
        super().__init__()
        self._fail_times = fail_times
        self.attempts: dict[str, int] = {}

    def secure_delete(self, location: str) -> None:
        self.attempts[location] = self.attempts.get(location, 0) + 1
        if self.attempts[location] <= self._fail_times:
            raise OSError(f"simulated secure-delete failure #{self.attempts[location]}")
        super().secure_delete(location)


class _AlwaysFailStore(InMemorySecureArtifactStore):
    """A store whose `secure_delete` always fails, never removing anything."""

    def __init__(self) -> None:
        super().__init__()
        self.attempts: dict[str, int] = {}

    def secure_delete(self, location: str) -> None:
        self.attempts[location] = self.attempts.get(location, 0) + 1
        raise OSError("simulated permanent secure-delete failure")


def _write_all(
    service: SecureTemporaryStorageService,
    job_id: str,
    artifact_ids: list[str],
    payload: bytes,
) -> list[str]:
    """Write one artifact per id under ``job_id``; return their locations."""
    locations: list[str] = []
    for aid in artifact_ids:
        locations.append(service.write(aid, payload, job_id=job_id))
    return locations


# ─────────────────────────────────────────────────────────────────────────
# Property 61 — success path: complete, volatile, exactly-reported
# ─────────────────────────────────────────────────────────────────────────
@settings(max_examples=_MIN_ITER, deadline=None)
@given(job_id=_job_id, artifact_ids=_artifact_ids, payload=_data)
def test_cleanup_is_complete_reported_and_volatile(job_id, artifact_ids, payload):
    """
    After a successful cleanup: every created artifact is gone from the store
    (complete — Req 51.2), nothing persists / tracking is emptied (volatile —
    Req 51.4), and the CleanupReport names exactly the set of created locations
    with an empty failure set and complete=True (Req 51.6).

    **Validates: Requirements 51.2, 51.4, 51.6**
    """
    store = InMemorySecureArtifactStore()
    service = SecureTemporaryStorageService(store, key=b"k" * 32)
    locations = _write_all(service, job_id, artifact_ids, payload)

    report = asyncio.run(service.cleanup(job_id))

    # Never returns an error on the success path.
    assert isinstance(report, CleanupReport)
    assert report.job_id == job_id
    # Reported deleted-location set equals the created set exactly (Req 51.6).
    assert set(report.deleted) == set(locations)
    assert len(report.deleted) == len(locations)
    assert report.failed == []
    assert report.complete is True
    # Every artifact is gone from the store — complete deletion (Req 51.2).
    for loc in locations:
        assert store.exists(loc) is False
    # Tracking is emptied — nothing persists after termination (Req 51.4).
    assert service.locations_for(job_id) == []


# ─────────────────────────────────────────────────────────────────────────
# Property 61 — cleanup on ANY termination path never raises
# ─────────────────────────────────────────────────────────────────────────
@settings(max_examples=_MIN_ITER, deadline=None)
@given(job_id=_job_id, artifact_ids=_artifact_ids, payload=_data)
def test_cleanup_of_unknown_or_empty_job_never_raises(job_id, artifact_ids, payload):
    """
    Cleanup is safe on any termination path: with nothing written it returns a
    complete, empty report; cleaning the same job twice is idempotent and never
    raises (Req 51.2).

    **Validates: Requirements 51.2, 51.6**
    """
    service = SecureTemporaryStorageService(key=b"k" * 32)

    # No artifacts written yet — cleanup still returns a complete empty report.
    empty = asyncio.run(service.cleanup(job_id))
    assert isinstance(empty, CleanupReport)
    assert empty.deleted == []
    assert empty.failed == []
    assert empty.complete is True

    # Now write some and clean twice; the second run is a no-op complete report.
    _write_all(service, job_id, artifact_ids, payload)
    first = asyncio.run(service.cleanup(job_id))
    second = asyncio.run(service.cleanup(job_id))
    assert isinstance(first, CleanupReport) and first.complete is True
    assert isinstance(second, CleanupReport)
    assert second.deleted == []
    assert second.complete is True


# ─────────────────────────────────────────────────────────────────────────
# Property 61 — transient failures are retried until success
# ─────────────────────────────────────────────────────────────────────────
@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    job_id=_job_id,
    artifact_ids=st.lists(_token, min_size=1, max_size=5, unique=True),
    payload=_data,
    max_retries=st.integers(min_value=0, max_value=5),
    fail_times=st.integers(min_value=0, max_value=6),
    data=st.data(),
)
def test_cleanup_retries_transient_failures_within_bound(
    job_id, artifact_ids, payload, max_retries, fail_times, data
):
    """
    A flaky store that fails ``fail_times`` before succeeding is deleted iff the
    failures fit inside the retry budget (``fail_times <= max_retries``). Either
    way the number of `secure_delete` attempts per location is bounded by
    ``max_delete_retries + 1`` (Req 51.5).

    **Validates: Requirements 51.5**
    """
    store = _FlakyStore(fail_times=fail_times)
    service = SecureTemporaryStorageService(
        store, key=b"k" * 32, max_delete_retries=max_retries
    )
    locations = _write_all(service, job_id, artifact_ids, payload)

    result = asyncio.run(service.cleanup(job_id))

    # Attempt count per location is bounded by max_delete_retries + 1 (Req 51.5).
    for loc in locations:
        assert store.attempts.get(loc, 0) <= max_retries + 1

    if fail_times <= max_retries:
        # The artifact was eventually deleted (retried to success) — Req 51.5.
        assert isinstance(result, CleanupReport)
        assert set(result.deleted) == set(locations)
        assert result.failed == []
        assert result.complete is True
        for loc in locations:
            assert store.exists(loc) is False
        assert service.locations_for(job_id) == []
        # It took exactly the failing attempts plus one success per location.
        for loc in locations:
            assert store.attempts.get(loc, 0) == fail_times + 1
    else:
        # Failures exceed the budget — cleanup surfaces a StructuredError.
        assert isinstance(result, StructuredError)
        assert result.code == SECURE_DELETE_FAILED
        assert result.stage == STAGE_NAME
        # Each undeleted location is named and remains tracked (Req 51.5).
        named = result.message + " ".join(sub.message for sub in result.details)
        for loc in locations:
            assert loc in named
            assert store.exists(loc) is True
            # Exhausted the full budget: one initial try + max_retries retries.
            assert store.attempts.get(loc, 0) == max_retries + 1
        assert set(service.locations_for(job_id)) == set(locations)


# ─────────────────────────────────────────────────────────────────────────
# Property 61 — permanent failure → StructuredError naming undeleted locations
# ─────────────────────────────────────────────────────────────────────────
@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    job_id=_job_id,
    artifact_ids=st.lists(_token, min_size=1, max_size=5, unique=True),
    payload=_data,
    max_retries=st.integers(min_value=0, max_value=4),
)
def test_cleanup_permanent_failure_reports_and_bounds_retries(
    job_id, artifact_ids, payload, max_retries
):
    """
    When secure deletion always fails, cleanup returns a StructuredError
    (code SECURE_DELETE_FAILED) naming every undeleted location, one sub-error
    per location; those locations stay tracked; and each is attempted exactly
    ``max_delete_retries + 1`` times (Req 51.5).

    **Validates: Requirements 51.5**
    """
    store = _AlwaysFailStore()
    service = SecureTemporaryStorageService(
        store, key=b"k" * 32, max_delete_retries=max_retries
    )
    locations = _write_all(service, job_id, artifact_ids, payload)

    result = asyncio.run(service.cleanup(job_id))

    assert isinstance(result, StructuredError)
    assert result.code == SECURE_DELETE_FAILED
    assert result.stage == STAGE_NAME
    # One sub-error per undeleted location, each naming its location (Req 51.5).
    assert len(result.details) == len(locations)
    for loc in locations:
        assert loc in result.message
        assert any(loc in sub.message and sub.code == SECURE_DELETE_FAILED
                   for sub in result.details)
        # Bounded retries: exactly max_delete_retries + 1 attempts.
        assert store.attempts.get(loc, 0) == max_retries + 1
        # Undeleted artifacts remain present and tracked.
        assert store.exists(loc) is True
    assert set(service.locations_for(job_id)) == set(locations)


# ─────────────────────────────────────────────────────────────────────────
# Property 61 — mixed success/failure partitions deleted vs. tracked
# ─────────────────────────────────────────────────────────────────────────
@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    job_id=_job_id,
    good_ids=st.lists(_token, min_size=1, max_size=4, unique=True),
    bad_ids=st.lists(_token, min_size=1, max_size=4, unique=True),
    payload=_data,
    max_retries=st.integers(min_value=0, max_value=3),
)
def test_cleanup_mixed_deletes_good_and_reports_bad(
    job_id, good_ids, bad_ids, payload, max_retries
):
    """
    With some artifacts deletable and others permanently failing, cleanup
    returns a StructuredError naming ONLY the undeleted locations; the deletable
    ones are removed from the store and dropped from tracking while the failing
    ones remain tracked (Req 51.5, 51.6).

    **Validates: Requirements 51.5, 51.6**
    """
    # Ensure disjoint id sets so good/bad locations don't collide.
    bad_only = [b for b in bad_ids if b not in set(good_ids)]
    if not bad_only:
        return  # degenerate overlap; nothing to assert distinctly

    class _SelectiveStore(InMemorySecureArtifactStore):
        """Fails secure_delete only for locations whose id is in `bad_set`."""

        def __init__(self, bad_locations: set[str]) -> None:
            super().__init__()
            self._bad = bad_locations

        def secure_delete(self, location: str) -> None:
            if location in self._bad:
                raise OSError("simulated failure for bad location")
            super().secure_delete(location)

    service_probe = SecureTemporaryStorageService(key=b"k" * 32)
    bad_locations = {
        service_probe._location_for(job_id, aid) for aid in bad_only  # noqa: SLF001
    }
    store = _SelectiveStore(bad_locations)
    service = SecureTemporaryStorageService(
        store, key=b"k" * 32, max_delete_retries=max_retries
    )
    good_locs = _write_all(service, job_id, good_ids, payload)
    bad_locs = _write_all(service, job_id, bad_only, payload)

    result = asyncio.run(service.cleanup(job_id))

    # Some deletions failed ⇒ StructuredError naming only the bad locations.
    assert isinstance(result, StructuredError)
    assert result.code == SECURE_DELETE_FAILED
    for loc in bad_locs:
        assert loc in result.message
        assert store.exists(loc) is True
    for loc in good_locs:
        # Good locations are gone even though the overall run failed.
        assert store.exists(loc) is False
    # Only the undeleted (bad) locations remain tracked (Req 51.4/51.5).
    assert set(service.locations_for(job_id)) == set(bad_locs)
