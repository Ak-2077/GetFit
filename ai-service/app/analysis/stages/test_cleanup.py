"""
Property + unit tests for the Cleanup_Service (Req 1.1, 1.5, 12.1–12.4).

The Cleanup_Service deletes every Temporary_Artifact created while processing a
job and reports the locations it removed. These tests exercise both the
deletion-tracking logic (against an in-memory fake `ArtifactStore`) and the real
`FilesystemArtifactStore` against a `tmp_path`, covering every termination path.

Mirrors the conventions in `test_confidence_fusion.py` /
`test_video_validation.py`: a tiny `_run` helper drives the async stage, plain
example-based unit tests pin down edge cases, and a Hypothesis property covers
the universal guarantee across many generated artifact sets.
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import ArtifactSet, CleanupReport
from app.analysis.stages.cleanup import (
    ArtifactRegistry,
    CleanupService,
    FilesystemArtifactStore,
)


# ── In-memory fakes (no real filesystem) ──────────────────────────────────

class FakeArtifactStore:
    """An in-memory `ArtifactStore`: a set of present locations.

    `delete` removes a location (idempotent). Locations listed in
    `fail_to_delete` simulate a store that cannot remove an artifact — the
    deletion silently does nothing so the location remains present, which is how
    the Cleanup_Service detects a failed deletion via `exists`.
    """

    def __init__(self, present: set[str], fail_to_delete: set[str] | None = None) -> None:
        self._present: set[str] = set(present)
        self._fail: set[str] = set(fail_to_delete or set())

    def delete(self, location: str) -> None:
        if location in self._fail:
            return  # store unable to remove this artifact (stays present)
        self._present.discard(location)  # idempotent

    def exists(self, location: str) -> bool:
        return location in self._present


class RaisingArtifactStore:
    """A store whose `delete` raises for designated locations.

    Verifies the Cleanup_Service guards each deletion independently — one
    raising deletion must never abort the rest (Req 12.1, 12.2).
    """

    def __init__(self, present: set[str], raise_on: set[str]) -> None:
        self._present: set[str] = set(present)
        self._raise: set[str] = set(raise_on)

    def delete(self, location: str) -> None:
        if location in self._raise:
            raise OSError(f"cannot delete {location}")
        self._present.discard(location)

    def exists(self, location: str) -> bool:
        return location in self._present


def _run(stage: CleanupService, data: ArtifactSet) -> CleanupReport:
    result = asyncio.run(stage.run(data))
    assert result.success is True
    assert result.error is None
    assert result.output is not None
    return result.output


# ── Unit tests ─────────────────────────────────────────────────────────────

def test_clean_run_deletes_every_artifact():
    # Req 1.1, 1.5, 12.4: nothing remains, deleted == unique created set.
    locations = ["video.mp4", "frame1.jpg", "frame2.jpg", "tmp/job/"]
    store = FakeArtifactStore(present=set(locations))
    report = _run(CleanupService(store), ArtifactSet(job_id="j1", locations=locations))

    assert set(report.deleted) == set(locations)
    assert report.failed == []
    assert report.complete is True
    assert all(not store.exists(loc) for loc in locations)


def test_duplicate_locations_collapse_to_unique_set():
    # Req 12.4: the deleted set mirrors the UNIQUE artifact set.
    locations = ["a", "a", "b", "b", "b", "c"]
    store = FakeArtifactStore(present=set(locations))
    report = _run(CleanupService(store), ArtifactSet(job_id="j2", locations=locations))

    assert set(report.deleted) == {"a", "b", "c"}
    assert len(report.deleted) == 3  # no duplicates in the report
    assert report.complete is True


def test_empty_artifact_set_is_a_complete_no_op():
    report = _run(CleanupService(FakeArtifactStore(set())), ArtifactSet(job_id="j3", locations=[]))
    assert report.deleted == []
    assert report.failed == []
    assert report.complete is True


def test_failed_deletion_is_reported_and_marks_incomplete():
    # Req 12.1, 12.2: a store that cannot remove some artifacts → those land in
    # `failed`, the rest are still deleted, and complete is False.
    locations = ["ok1", "stuck", "ok2"]
    store = FakeArtifactStore(present=set(locations), fail_to_delete={"stuck"})
    report = _run(CleanupService(store), ArtifactSet(job_id="j4", locations=locations))

    assert set(report.deleted) == {"ok1", "ok2"}
    assert report.failed == ["stuck"]
    assert report.complete is False
    assert store.exists("stuck") and not store.exists("ok1") and not store.exists("ok2")


def test_raising_store_does_not_abort_remaining_deletions():
    # Req 12.1, 12.2: one deletion raising must not prevent the others.
    locations = ["a", "boom", "b", "c"]
    store = RaisingArtifactStore(present=set(locations), raise_on={"boom"})
    report = _run(CleanupService(store), ArtifactSet(job_id="j5", locations=locations))

    assert set(report.deleted) == {"a", "b", "c"}
    assert report.failed == ["boom"]
    assert report.complete is False


def test_filesystem_store_against_tmp_dir(tmp_path):
    # Req 1.1, 1.5: real FilesystemArtifactStore removes files and directories.
    video = tmp_path / "video.mp4"
    video.write_bytes(b"fake-bytes")
    frame = tmp_path / "frame.jpg"
    frame.write_bytes(b"img")
    workdir = tmp_path / "job"
    workdir.mkdir()
    (workdir / "nested.txt").write_text("x")

    locations = [str(video), str(frame), str(workdir)]
    report = _run(CleanupService(FilesystemArtifactStore()),
                  ArtifactSet(job_id="j6", locations=locations))

    assert set(report.deleted) == set(locations)
    assert report.complete is True
    assert not video.exists() and not frame.exists() and not workdir.exists()


def test_registry_tracks_unique_ordered_locations():
    reg = ArtifactRegistry("job-x")
    reg.track("a")
    reg.track_all(["b", "a", "c", "b"])
    artifacts = reg.as_artifact_set()
    assert artifacts.job_id == "job-x"
    assert artifacts.locations == ["a", "b", "c"]  # first-seen order, de-duplicated


# ── Property 3 ───────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 3: Cleanup removes every artifact on
# every termination path
#
# For any set of temporary artifacts and any termination path (success or
# failure at any stage), after the Cleanup_Service runs no artifact remains and
# the report's deleted-location set equals the set of created artifacts; any
# artifact the store cannot remove appears in `failed` and flips `complete`.
# Validates: Requirements 1.1, 1.5, 12.1, 12.2, 12.3, 12.4

# A location handle: arbitrary non-empty text, so duplicates and odd strings
# (paths, frame handles, temp dirs) are all exercised.
_locations = st.lists(st.text(min_size=1, max_size=12), max_size=20)


@settings(max_examples=200)
@given(
    locations=_locations,
    # The termination path is irrelevant to the contract: cleanup must behave
    # identically whichever subset of artifacts the store cannot remove. We
    # model that by letting any artifact be "stuck", drawn via a data strategy.
    fail_seed=st.data(),
    job_id=st.text(min_size=1, max_size=8),
)
def test_property_cleanup_removes_every_artifact(locations, fail_seed, job_id):
    unique = list(dict.fromkeys(locations))  # unique, order-preserving

    # Choose an arbitrary subset of the unique locations to be un-deletable,
    # standing in for any termination path / partial-failure scenario.
    fail_set: set[str] = set()
    if unique:
        flags = fail_seed.draw(
            st.lists(st.booleans(), min_size=len(unique), max_size=len(unique))
        )
        fail_set = {loc for loc, f in zip(unique, flags) if f}

    store = FakeArtifactStore(present=set(unique), fail_to_delete=fail_set)
    report = _run(CleanupService(store), ArtifactSet(job_id=job_id, locations=locations))

    expected_deleted = {loc for loc in unique if loc not in fail_set}

    # 1) deleted-location set equals the deletable (created) artifacts.
    assert set(report.deleted) == expected_deleted
    # 2) the report carries no duplicates (mirrors the unique artifact set).
    assert len(report.deleted) == len(set(report.deleted))
    assert len(report.failed) == len(set(report.failed))
    # 3) every deletable artifact is actually gone from the store.
    assert all(not store.exists(loc) for loc in expected_deleted)
    # 4) failures are exactly the un-deletable locations, still present.
    assert set(report.failed) == fail_set
    assert all(store.exists(loc) for loc in fail_set)
    # 5) deleted and failed partition the unique artifact set.
    assert set(report.deleted) | set(report.failed) == set(unique)
    assert set(report.deleted).isdisjoint(report.failed)
    # 6) complete is True exactly when nothing failed.
    assert report.complete is (len(fail_set) == 0)
