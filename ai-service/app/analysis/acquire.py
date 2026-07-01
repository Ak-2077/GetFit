"""
Video acquisition — fetch → probe → read frames → delete (runtime pipeline)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Real, side-effecting counterpart to the pure analytical stages. Given a
fetchable `video_ref` (an ``http(s)://`` URL or a local filesystem path), this
module:

  • ACQUIRES the recording into a transient local file (downloading remote refs
    with ``httpx``; using a local path in place),
  • PROBES it with OpenCV into the pipeline's `VideoMeta` contract (resolution,
    fps, duration, codec, container, size),
  • exposes an `OpenCvFrameReader` that decodes a frame by index on demand for
    the frame-quality, camera-guidance, and pose stages,
  • and DELETES the transient file immediately after processing (only files this
    module downloaded are deleted — a caller-supplied local path is left alone).

Everything here lives INSIDE the trusted pipeline boundary: the raw video bytes
never leave the process, and the transient download is removed on every
termination path (Req 1.x, 12.x). OpenCV (`opencv-python`) is the only heavy
dependency and is already required by the service.
"""

from __future__ import annotations

import hashlib
import logging
import os
import tempfile
import time
from dataclasses import dataclass

import cv2

from .contracts import VideoMeta

logger = logging.getLogger("getfit-ai")

#: Container formats we tag from a file extension; anything else is passed
#: through verbatim for the Video_Validation_Service to accept/reject.
_EXT_TO_FORMAT = {".mp4": "mp4", ".mov": "mov", ".m4v": "mp4", ".qt": "mov"}

#: OpenCV FOURCC → canonical codec label the Video_Validation_Service knows.
_FOURCC_TO_CODEC = {
    "avc1": "h264",
    "h264": "h264",
    "x264": "h264",
    "hev1": "hevc",
    "hvc1": "hevc",
    "hevc": "hevc",
    "mp4v": "mp4v",
    "mpeg": "mpeg",
    "xvid": "xvid",
    "divx": "divx",
}


def _fourcc_to_str(fourcc: float) -> str:
    """Decode an OpenCV FOURCC double into its 4-char ASCII code (lowercased)."""
    code = int(fourcc)
    if code <= 0:
        return ""
    chars = bytes(((code >> (8 * i)) & 0xFF) for i in range(4))
    try:
        return chars.decode("ascii", errors="ignore").strip("\x00 ").lower()
    except Exception:  # pragma: no cover - defensive
        return ""


@dataclass
class AcquiredVideo:
    """A transient, locally-available recording ready for probing/decoding.

    ``owned`` is True when this module downloaded the file (and therefore must
    delete it); False when it points at a caller-supplied local path.
    """

    local_path: str
    owned: bool


class VideoAcquisitionError(Exception):
    """Raised when a video reference cannot be fetched or opened."""


async def acquire(video_ref: str) -> AcquiredVideo:
    """Resolve ``video_ref`` to a local file, downloading remote refs.

    ``http(s)://`` refs are streamed to a NamedTemporaryFile (``owned=True``);
    a ``file://`` ref or a bare existing local path is used in place
    (``owned=False``). Raises :class:`VideoAcquisitionError` on failure.
    """
    ref = (video_ref or "").strip()
    if not ref:
        raise VideoAcquisitionError("empty video reference")

    lower = ref.lower()
    if lower.startswith(("http://", "https://")):
        return await _download(ref)

    # Local path (optionally file:// scheme).
    local = ref
    if lower.startswith("file://"):
        local = ref[len("file://") :]
        # Normalize a Windows path like file:///C:/x → C:/x
        local = local.lstrip("/") if (len(local) > 2 and local[2] == ":") else local
    if not os.path.isfile(local):
        raise VideoAcquisitionError(f"local video not found: {local}")
    return AcquiredVideo(local_path=local, owned=False)


async def _download(url: str) -> AcquiredVideo:
    """Stream a remote video to a transient local file (``owned=True``)."""
    import httpx

    suffix = _suffix_for_url(url)
    fd, path = tempfile.mkstemp(suffix=suffix, prefix="getfit_analysis_")
    os.close(fd)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, read=120.0)) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()
                with open(path, "wb") as fh:
                    async for chunk in resp.aiter_bytes(chunk_size=1 << 16):
                        fh.write(chunk)
    except Exception as exc:
        secure_delete(path)
        raise VideoAcquisitionError(f"failed to download video: {exc!s}") from exc
    return AcquiredVideo(local_path=path, owned=True)


def _suffix_for_url(url: str) -> str:
    """Best-effort file suffix for a download, defaulting to ``.mp4``."""
    tail = url.split("?", 1)[0].rsplit("/", 1)[-1]
    _, ext = os.path.splitext(tail)
    return ext if ext.lower() in _EXT_TO_FORMAT else ".mp4"


def probe(local_path: str) -> VideoMeta:
    """Probe a local video into the `VideoMeta` contract using OpenCV.

    Raises :class:`VideoAcquisitionError` when the file cannot be opened or has
    no decodable frames.
    """
    cap = cv2.VideoCapture(local_path)
    try:
        if not cap.isOpened():
            raise VideoAcquisitionError("OpenCV could not open the video")

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        codec = _FOURCC_TO_CODEC.get(_fourcc_to_str(cap.get(cv2.CAP_PROP_FOURCC)), "")

        if width <= 0 or height <= 0:
            raise VideoAcquisitionError("video has no decodable dimensions")
        if fps <= 0:
            fps = 30.0  # some containers omit fps; assume a safe default
        duration_sec = (frame_count / fps) if frame_count > 0 else 0.0

        try:
            size_bytes = os.path.getsize(local_path)
        except OSError:
            size_bytes = 0

        _, ext = os.path.splitext(local_path)
        container = _EXT_TO_FORMAT.get(ext.lower(), (ext.lstrip(".").lower() or "mp4"))

        return VideoMeta(
            container_format=container,
            codec=codec or "h264",  # assume h264 when the probe cannot report it
            duration_sec=max(0.0, duration_sec),
            width=width,
            height=height,
            fps=fps,
            size_bytes=size_bytes,
            orientation="portrait" if height >= width else "landscape",
        )
    finally:
        cap.release()


class OpenCvFrameReader:
    """Decodes frames from a local video by index, on demand (thread-unsafe).

    Used by the frame-quality, camera-guidance, and pose stages to obtain the
    actual pixels for a `Frame` (which carries only index + timestamp). Holds a
    single `cv2.VideoCapture`; call :meth:`close` when done.
    """

    def __init__(self, local_path: str) -> None:
        self._path = local_path
        self._cap = cv2.VideoCapture(local_path)
        self._last_index = -1

    def read(self, index: int):
        """Return the BGR ndarray for frame ``index`` (or ``None`` if unreadable)."""
        if self._cap is None or not self._cap.isOpened():
            return None
        # Sequential reads are far faster than random seeks; only seek on a jump.
        if index != self._last_index + 1:
            self._cap.set(cv2.CAP_PROP_POS_FRAMES, float(index))
        ok, frame = self._cap.read()
        self._last_index = index
        return frame if ok else None

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None


def secure_delete(path: str, *, retries: int = 3, delay_sec: float = 0.15) -> bool:
    """Delete a transient file, verifying removal with bounded retries.

    Guarantees a recording never lingers on the server (Req 12.x): the file is
    removed and its absence is confirmed. On a transient failure (e.g. a brief
    Windows file lock while a reader releases the handle) the delete is retried
    up to ``retries`` times with a short backoff. Every attempt/outcome is
    logged. Returns True once the file is confirmed gone, False if it still
    exists after all attempts.
    """
    if not path:
        return True

    last_exc: OSError | None = None
    for attempt in range(1, max(1, retries) + 1):
        try:
            if not os.path.isfile(path):
                if attempt > 1:
                    logger.info("Transient video %s confirmed deleted (attempt %d).", path, attempt)
                return True
            os.remove(path)
            if not os.path.isfile(path):
                logger.info("Transient video %s deleted (attempt %d).", path, attempt)
                return True
        except OSError as exc:
            last_exc = exc
            logger.warning(
                "Attempt %d/%d to delete transient video %s failed: %s",
                attempt, retries, path, exc,
            )
        if attempt < retries:
            time.sleep(delay_sec)

    still_present = bool(path and os.path.isfile(path))
    if still_present:
        logger.error(
            "Failed to delete transient video %s after %d attempts (last error: %s).",
            path, retries, last_exc,
        )
    return not still_present


def sha256_file(path: str, *, chunk_size: int = 1 << 20) -> str:
    """Return the lowercase SHA-256 hex digest of a local file's bytes.

    Used to verify the integrity of a downloaded recording against the digest
    computed at the upload boundary before any processing begins (Req 12.x).
    """
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()
