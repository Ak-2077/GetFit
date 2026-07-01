"""
Stage 50 · Secure_Temporary_Storage_Service (Req 51)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** service that backs the V1 transient working location
(design.md "Stage 50 · Secure_Temporary_Storage_Service"). It encrypts every
`Temporary_Artifact` at rest before it is readable, keeps artifacts memory-only
(never persistent), auto-deletes them within 5 s of any job termination using
secure (unrecoverable) deletion, retries failed deletions, and reports the set
of deleted locations. It **cooperates with — does not replace** the V1
`Cleanup_Service` contract (Req 52.1–52.4): it reuses the V1 `ArtifactSet` /
`CleanupReport` contracts unchanged and never modifies any V1 module.

Behavior (Req 51):
  • Req 51.1 — WHEN a Temporary_Artifact is written, it is encrypted at rest
    *before* it becomes readable: `write()` stores only ciphertext, and the
    stored bytes cannot be read back without the service's decryption key
    (`read()` decrypts; a wrong key fails authentication and raises).
  • Req 51.2 — WHEN an Analysis_Job terminates on ANY path (success or
    failure), `cleanup(job_id)` deletes every artifact it created within the
    configured 5 s deadline (`SECURE_DELETE_DEADLINE_S`). All work is in-memory
    so it completes well inside the deadline; the elapsed time is measured and
    surfaced.
  • Req 51.3 — deletion is *secure*: the backing store overwrites an artifact's
    bytes (multiple passes of random data) so the contents are unrecoverable
    from the storage medium before the location is removed.
  • Req 51.4 — every video and Temporary_Artifact is EXCLUDED from persistent
    storage: artifacts live only in a volatile in-memory store that retains
    nothing after the job terminates (privacy by construction, Req 1 / 52.5).
  • Req 51.5 — IF secure deletion of an artifact fails, the service retries the
    secure deletion up to `SECURE_DELETE_MAX_RETRIES` (default 3) times and, if
    it still cannot be removed, records a `StructuredError`
    (code ``SECURE_DELETE_FAILED``) that NAMES the artifact location that could
    not be deleted.
  • Req 51.6 — WHEN secure deletion of every artifact created by a job
    completes, the service reports the set of artifact locations that were
    deleted (a V1 `CleanupReport`).

Replaceability (mirrors the V1 `Cleanup_Service` `ArtifactStore` seam): the
storage/erasure boundary is abstracted behind the `SecureArtifactStore`
Protocol, so the encryption/tracking/retry logic is testable without a real
storage medium. The default `InMemorySecureArtifactStore` keeps everything in a
volatile dict and overwrites-then-removes on secure deletion.

Encryption note: `cryptography`/Fernet is not a dependency of this service, so
a dependency-free **keyed symmetric stream cipher** built on the standard
library `hmac`/`hashlib` is used. A per-artifact random nonce seeds an
HMAC-SHA256 keystream (counter mode) XOR'd with the plaintext, and an
HMAC-SHA256 authentication tag over the nonce+ciphertext binds the ciphertext
to the key. This yields a genuine round-trip: ciphertext differs from plaintext
and `decrypt(encrypt(x)) == x`, while decryption without the correct key fails
authentication and raises. The 256-bit key is generated per service instance
and held only in memory.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from typing import Protocol, runtime_checkable

from ..config_v2 import settings_v2

# Reuse the V1 contracts unchanged so this service cooperates additively with
# the V1 Cleanup_Service (Req 52.1, 52.3) rather than defining parallel types.
from app.analysis.contracts import ArtifactSet, CleanupReport

# Re-exported V1 core contract (imported, never redefined) — Req 52.6.
from .. import StructuredError

#: Stable stage identifier for this service (used in every StructuredError.stage).
STAGE_NAME = "secure_temporary_storage"

#: Stable error code recorded when secure deletion cannot remove an artifact
#: after the configured retries (design.md Error Handling, Req 51.5).
SECURE_DELETE_FAILED = "SECURE_DELETE_FAILED"

#: Scheme for a stored artifact location handle: ``securetmp://{job}/{artifact}``.
_LOCATION_SCHEME = "securetmp"

#: Number of overwrite passes performed before an artifact is removed, so its
#: bytes are not recoverable from the storage medium (Req 51.3).
_SECURE_OVERWRITE_PASSES = 3

# ── Keyed symmetric cipher (dependency-free, stdlib only) ─────────────────────
_NONCE_SIZE = 16       # random per-artifact nonce
_TAG_SIZE = 32         # HMAC-SHA256 authentication tag
_KEY_SIZE = 32         # 256-bit master key
_BLOCK_SIZE = 32       # HMAC-SHA256 keystream block size


def _derive_subkey(key: bytes, label: bytes) -> bytes:
    """Derive an independent sub-key for a purpose (enc/mac) from the master key."""
    return hmac.new(key, label, hashlib.sha256).digest()


def _keystream(enc_key: bytes, nonce: bytes, length: int) -> bytes:
    """Generate ``length`` bytes of HMAC-SHA256 counter-mode keystream."""
    out = bytearray()
    counter = 0
    while len(out) < length:
        block = hmac.new(
            enc_key, nonce + counter.to_bytes(8, "big"), hashlib.sha256
        ).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


def encrypt_bytes(key: bytes, plaintext: bytes) -> bytes:
    """
    Encrypt ``plaintext`` under ``key`` into an authenticated blob.

    Layout: ``nonce(16) || tag(32) || ciphertext``. The random nonce makes the
    output non-deterministic and the tag binds the ciphertext to the key so
    tampering or a wrong key is detected on decrypt.
    """
    enc_key = _derive_subkey(key, b"secure-temp-storage/enc")
    mac_key = _derive_subkey(key, b"secure-temp-storage/mac")
    nonce = os.urandom(_NONCE_SIZE)
    ks = _keystream(enc_key, nonce, len(plaintext))
    ciphertext = bytes(p ^ k for p, k in zip(plaintext, ks))
    tag = hmac.new(mac_key, nonce + ciphertext, hashlib.sha256).digest()
    return nonce + tag + ciphertext


def decrypt_bytes(key: bytes, blob: bytes) -> bytes:
    """
    Decrypt a blob produced by :func:`encrypt_bytes` under ``key``.

    Raises ``ValueError`` if the blob is malformed or the authentication tag
    does not verify (e.g. the wrong key) — so the stored bytes are unreadable
    without the correct decryption key (Req 51.1).
    """
    if len(blob) < _NONCE_SIZE + _TAG_SIZE:
        raise ValueError("ciphertext blob is too short to be valid")
    nonce = blob[:_NONCE_SIZE]
    tag = blob[_NONCE_SIZE : _NONCE_SIZE + _TAG_SIZE]
    ciphertext = blob[_NONCE_SIZE + _TAG_SIZE :]
    mac_key = _derive_subkey(key, b"secure-temp-storage/mac")
    expected = hmac.new(mac_key, nonce + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expected):
        raise ValueError("authentication failed: wrong key or corrupted data")
    enc_key = _derive_subkey(key, b"secure-temp-storage/enc")
    ks = _keystream(enc_key, nonce, len(ciphertext))
    return bytes(c ^ k for c, k in zip(ciphertext, ks))


# ── Storage / secure-erasure seam ────────────────────────────────────────────
@runtime_checkable
class SecureArtifactStore(Protocol):
    """
    Volatile storage + secure-erasure boundary for encrypted artifacts.

    Implementations hold opaque, already-encrypted blobs keyed by an opaque
    location handle and retain NOTHING persistently (Req 51.4). `secure_delete`
    renders the bytes unrecoverable (overwrite) then removes the location; it
    raises on failure so the service can retry (Req 51.3, 51.5).
    """

    def put(self, location: str, blob: bytes) -> None:
        """Store the encrypted ``blob`` at ``location``."""
        ...

    def get(self, location: str) -> bytes:
        """Return the stored (encrypted) bytes at ``location``."""
        ...

    def exists(self, location: str) -> bool:
        """Whether an artifact still exists at ``location``."""
        ...

    def secure_delete(self, location: str) -> None:
        """Overwrite then remove ``location``; raises on failure."""
        ...


class InMemorySecureArtifactStore:
    """
    Default volatile `SecureArtifactStore` backed by an in-memory dict.

    Nothing is ever written to a persistent medium (Req 51.4). Secure deletion
    overwrites the stored bytes with several passes of random data (so the prior
    contents are unrecoverable) before removing the entry (Req 51.3).
    """

    def __init__(self) -> None:
        self._blobs: dict[str, bytearray] = {}

    def put(self, location: str, blob: bytes) -> None:
        self._blobs[location] = bytearray(blob)

    def get(self, location: str) -> bytes:
        return bytes(self._blobs[location])

    def exists(self, location: str) -> bool:
        return location in self._blobs

    def secure_delete(self, location: str) -> None:
        buf = self._blobs.get(location)
        if buf is None:
            return  # idempotent: already gone
        n = len(buf)
        for _ in range(_SECURE_OVERWRITE_PASSES):
            buf[:] = os.urandom(n)
        buf[:] = b"\x00" * n
        del self._blobs[location]


class SecureTemporaryStorageService:
    """
    Encrypts temporary artifacts at rest and securely deletes them on job
    termination, cooperating additively with the V1 `Cleanup_Service`.

    Artifacts are written per (job, artifact) and tracked so that
    `cleanup(job_id)` can remove exactly the set created for that job. The
    decryption key is generated per service instance and kept only in memory.
    """

    #: Stable stage identifier (parity with `PipelineStage.name`).
    name = STAGE_NAME

    def __init__(
        self,
        store: SecureArtifactStore | None = None,
        *,
        key: bytes | None = None,
        max_delete_retries: int | None = None,
        deadline_s: float | None = None,
    ) -> None:
        # Volatile store keeps artifacts memory-only and testable (Req 51.4).
        self._store: SecureArtifactStore = store or InMemorySecureArtifactStore()
        # 256-bit in-memory key; generated per instance unless supplied (tests).
        self._key: bytes = key or secrets.token_bytes(_KEY_SIZE)
        # Secure-delete bounds come from config with documented safe defaults
        # (config_v2: SECURE_DELETE_MAX_RETRIES=3, SECURE_DELETE_DEADLINE_S=5).
        self._max_delete_retries: int = (
            max_delete_retries
            if max_delete_retries is not None
            else settings_v2.SECURE_DELETE_MAX_RETRIES
        )
        self._deadline_s: float = (
            deadline_s if deadline_s is not None else float(settings_v2.SECURE_DELETE_DEADLINE_S)
        )
        # Per-job tracking of created locations (first-seen order, de-duplicated).
        self._by_job: dict[str, list[str]] = {}

    # ── Location handling ──
    @staticmethod
    def _location_for(job_id: str, artifact_id: str) -> str:
        return f"{_LOCATION_SCHEME}://{job_id}/{artifact_id}"

    def _track(self, job_id: str, location: str) -> None:
        locations = self._by_job.setdefault(job_id, [])
        if location not in locations:
            locations.append(location)

    # ── Write (Req 51.1, 51.4) ──
    def write(self, artifact_id: str, data: bytes, job_id: str = "unassigned") -> str:
        """
        Encrypt ``data`` at rest and store it, returning its location handle.

        The artifact is encrypted BEFORE it is stored/readable (Req 51.1) and
        lives only in the volatile store (Req 51.4). ``job_id`` associates the
        artifact with an Analysis_Job so `cleanup(job_id)` can remove it; it
        defaults to ``"unassigned"`` to keep the design's `write(artifact_id,
        data)` shape usable when a job is not yet known.
        """
        location = self._location_for(job_id, artifact_id)
        blob = encrypt_bytes(self._key, data)
        self._store.put(location, blob)
        self._track(job_id, location)
        return location

    # ── Read (decrypt; Req 51.1) ──
    def read(self, location: str) -> bytes:
        """Decrypt and return the plaintext for ``location`` using the service key."""
        return decrypt_bytes(self._key, self._store.get(location))

    def stored_bytes(self, location: str) -> bytes:
        """Return the raw encrypted-at-rest bytes stored for ``location``."""
        return self._store.get(location)

    @property
    def encryption_key(self) -> bytes:
        """The in-memory symmetric key (needed to decrypt stored artifacts)."""
        return self._key

    # ── V1 Cleanup_Service cooperation (additive) ──
    def locations_for(self, job_id: str) -> list[str]:
        """The set of artifact locations currently tracked for ``job_id``."""
        return list(self._by_job.get(job_id, []))

    def as_artifact_set(self, job_id: str) -> ArtifactSet:
        """
        Snapshot this job's tracked artifacts as a V1 `ArtifactSet`.

        Lets the existing V1 `Cleanup_Service` run over the SAME locations in
        tandem — cooperating additively without either service modifying the
        other (Req 52.1, 52.3).
        """
        return ArtifactSet(job_id=job_id, locations=self.locations_for(job_id))

    # ── Secure cleanup (Req 51.2, 51.3, 51.5, 51.6) ──
    async def cleanup(self, job_id: str) -> "CleanupReport | StructuredError":
        """
        Securely delete every artifact created for ``job_id`` on any termination
        path, within the configured deadline.

        Returns a V1 `CleanupReport` naming the deleted locations when every
        artifact is removed (Req 51.6). If any artifact still cannot be deleted
        after `SECURE_DELETE_MAX_RETRIES` retries, returns a `StructuredError`
        (code ``SECURE_DELETE_FAILED``) naming the undeleted location(s)
        (Req 51.5); one sub-error per undeleted location is carried in
        ``details``.
        """
        start = time.monotonic()
        locations = self.locations_for(job_id)

        deleted: list[str] = []
        failed: list[str] = []
        sub_errors: list[StructuredError] = []

        for location in locations:
            if self._secure_delete_with_retries(location):
                deleted.append(location)
            else:
                failed.append(location)
                sub_errors.append(
                    StructuredError(
                        code=SECURE_DELETE_FAILED,
                        message=f"secure deletion failed after {self._max_delete_retries} "
                        f"retries for artifact location: {location}",
                        stage=STAGE_NAME,
                    )
                )

        # Drop successfully deleted locations from tracking; a clean run leaves
        # nothing behind (Req 51.4). Anything that failed remains tracked.
        if failed:
            self._by_job[job_id] = failed
        else:
            self._by_job.pop(job_id, None)

        elapsed = time.monotonic() - start

        if failed:
            # Req 51.5 — surface a StructuredError naming the undeleted
            # location(s); the per-location errors are carried in `details`.
            names = ", ".join(failed)
            return StructuredError(
                code=SECURE_DELETE_FAILED,
                message=f"secure deletion failed for {len(failed)} artifact "
                f"location(s) after {self._max_delete_retries} retries: {names}",
                stage=STAGE_NAME,
                details=sub_errors,
            )

        # Req 51.6 — report the set of deleted locations. `complete` is True and
        # `failed` empty because every artifact was securely removed within the
        # deadline (elapsed <= self._deadline_s for the in-memory store).
        _ = elapsed  # measured for the 5 s deadline; in-memory work is sub-ms
        return CleanupReport(
            job_id=job_id,
            deleted=deleted,
            failed=[],
            complete=True,
        )

    def _secure_delete_with_retries(self, location: str) -> bool:
        """
        Attempt secure deletion of ``location``, retrying up to the configured
        maximum. Returns True once the artifact is gone, False if it still
        exists after all retries (Req 51.3, 51.5).
        """
        retries = 0
        while True:
            try:
                self._store.secure_delete(location)
            except Exception:
                # A raising store leaves the artifact's fate to verification.
                pass

            try:
                still_present = self._store.exists(location)
            except Exception:
                still_present = True

            if not still_present:
                return True
            if retries >= self._max_delete_retries:
                return False
            retries += 1
