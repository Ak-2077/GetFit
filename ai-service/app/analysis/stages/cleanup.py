"""
Cleanup_Service — ArtifactSet → CleanupReport (Req 1.1, 1.5, 12.1–12.4)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Deletes every Temporary_Artifact created while processing a job — the original
video, extracted frames, pose images, and any temporary working directory —
and reports the set of locations that were removed.

Privacy guarantee (Req 1.1, 1.5):
  • The original video and all transient artifacts must be gone before the
    pipeline returns; nothing of the user's recording may linger.

Termination guarantee (Req 12.1, 12.2, 12.3):
  • Cleanup runs on EVERY termination path — successful completion AND failure
    at any stage. The Analysis_Pipeline invokes this service inside a
    `try/finally` so it executes regardless of how the run ends. Within the
    service, each artifact deletion is independently guarded so one failing
    deletion never prevents the rest from being attempted — best-effort, total
    coverage.

Reporting guarantee (Req 12.4):
  • The returned `CleanupReport` carries the set of artifact locations that were
    deleted. On a clean run the deleted-location set equals the set of created
    artifacts (design Property 3); any location that could not be removed is
    surfaced in `failed` so the pipeline can record a cleanup failure.

Deletion is abstracted behind an `ArtifactStore` seam so the tracking and
total-coverage logic is testable without touching the real filesystem
(mirroring the replaceable-decoder/engine convention used across the pipeline).
A real `FilesystemArtifactStore` plugs in unchanged for production.
"""

from __future__ import annotations

import os
import shutil
import threading
from typing import Protocol, runtime_checkable

from ..base import PipelineStage, StageResult
from ..contracts import ArtifactSet, CleanupReport


@runtime_checkable
class ArtifactStore(Protocol):
    """
    Deletion boundary for transient artifacts.

    Implementations remove a single artifact identified by an opaque location
    handle (a file path, a temp-directory path, a frame handle, ...). `delete`
    is idempotent: removing an already-absent location is a no-op success.
    Keeping deletion behind this seam lets the Cleanup_Service be exercised in
    isolation without a real filesystem (Req 14.4).
    """

    def delete(self, location: str) -> None:
        """Remove the artifact at ``location``. Idempotent; raises on failure."""
        ...

    def exists(self, location: str) -> bool:
        """Whether an artifact still exists at ``location``."""
        ...


class FilesystemArtifactStore:
    """
    Default, dependency-free `ArtifactStore` backed by the local filesystem.

    Handles both files and directories so a per-job working directory
    (e.g. ``tmp/{job_id}/``) and individual frame/pose files are all removable
    through one seam. Deletion is idempotent — a missing path is treated as
    already cleaned.
    """

    def delete(self, location: str) -> None:
        if os.path.isdir(location):
            shutil.rmtree(location, ignore_errors=False)
        elif os.path.exists(location):
            os.remove(location)
        # Missing path → nothing to do (idempotent).

    def exists(self, location: str) -> bool:
        return os.path.exists(location)


class ArtifactRegistry:
    """
    Per-job tracker for the transient artifact set (Req 12.1, 12.2).

    Stages register every Temporary_Artifact they create (the original video,
    extracted frames, pose images, temp dirs) as processing proceeds. The
    registry preserves first-seen order and de-duplicates, so the
    Cleanup_Service receives the complete, exact set of locations to remove on
    whichever termination path is reached. Thread-safe so concurrent stages can
    register against the same job.
    """

    def __init__(self, job_id: str) -> None:
        self._job_id = job_id
        self._lock = threading.Lock()
        self._locations: list[str] = []
        self._seen: set[str] = set()

    @property
    def job_id(self) -> str:
        return self._job_id

    def track(self, location: str) -> None:
        """Register a single artifact location for later cleanup."""
        with self._lock:
            if location not in self._seen:
                self._seen.add(location)
                self._locations.append(location)

    def track_all(self, locations: "list[str] | tuple[str, ...]") -> None:
        """Register several artifact locations at once."""
        for location in locations:
            self.track(location)

    def as_artifact_set(self) -> ArtifactSet:
        """Snapshot the tracked artifacts as an `ArtifactSet` contract."""
        with self._lock:
            return ArtifactSet(job_id=self._job_id, locations=list(self._locations))


class CleanupService(PipelineStage[ArtifactSet, CleanupReport]):
    """
    Deletes every tracked Temporary_Artifact and reports the removed locations.

    Runs on every termination path (the pipeline calls it from a `finally`,
    Req 12.3) and, internally, attempts every artifact even when individual
    deletions fail (Req 12.1, 12.2) so coverage is total and best-effort. The
    `CleanupReport` lists the deleted locations (Req 12.4); anything that could
    not be removed is surfaced in `failed` and flips `complete` to False.
    """

    name = "cleanup"

    def __init__(self, store: ArtifactStore | None = None) -> None:
        # Pluggable store keeps the stage testable without a real filesystem.
        self._store: ArtifactStore = store or FilesystemArtifactStore()

    async def run(self, data: ArtifactSet) -> StageResult[CleanupReport]:
        deleted: list[str] = []
        failed: list[str] = []
        seen: set[str] = set()

        for location in data.locations:
            # De-duplicate so the deleted set mirrors the unique artifact set.
            if location in seen:
                continue
            seen.add(location)

            # Guard each deletion independently: one failure must never abort
            # the rest of the set (Req 12.1, 12.2 — total, best-effort coverage).
            try:
                self._store.delete(location)
            except Exception:
                # A raising store leaves the artifact's fate to verification.
                pass

            # Verify removal so the report reflects reality, not intent:
            # a location is "deleted" only if nothing remains there.
            try:
                still_present = self._store.exists(location)
            except Exception:
                still_present = True

            if still_present:
                failed.append(location)
            else:
                deleted.append(location)

        report = CleanupReport(
            job_id=data.job_id,
            deleted=deleted,
            failed=failed,
            complete=not failed,
        )
        # Cleanup is a terminal housekeeping stage: it always returns a report
        # (never a StructuredError). A failed deletion is recorded in the report
        # so the pipeline can count it (Req 30.1) without halting termination.
        return StageResult[CleanupReport](success=True, output=report)
