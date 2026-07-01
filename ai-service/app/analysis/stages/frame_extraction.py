"""
Frame_Extraction_Service — VideoMeta → FrameSet (Req 3.1–3.7)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Extracts still frames from a validated video **locally, inside the trusted
pipeline boundary**, using a configuration-driven sampling strategy. Only the
resulting `FrameSet` (frame index + start-relative timestamp) crosses to later
stages — the original video bytes are NEVER transmitted to any Pose_Engine,
vision, or Reasoning_Service (Req 1.3, 3.7).

Sampling strategies (config `FRAME_SAMPLING`):
  • ``every``     — every frame of the video                          (Req 3.2)
  • ``every_n``   — one frame for every ``FRAME_SAMPLE_N`` frames      (Req 3.3)
  • ``every_ms``  — one frame per ``FRAME_SAMPLE_MS`` ms interval       (Req 3.4)
  • ``adaptive``  — interval varies with detected inter-frame movement  (Req 3.5)

Each emitted `Frame` carries a non-negative `timestamp_ms` relative to the
start of the video (Req 3.6), and frames are produced in non-decreasing
timestamp order.

Decoding is abstracted behind a `FrameDecoder` so the deterministic sampling
logic is testable without a real video file. A production decoder (e.g. an
OpenCV/PyAV-backed implementation that reads the transient local file) plugs in
without changing this stage — mirroring the replaceable-engine convention used
across `app/vision/`.
"""

from __future__ import annotations

import math
from typing import Protocol, runtime_checkable

from app.core.config import settings

from ..base import PipelineStage, StageResult
from ..contracts import Frame, FrameSet, VideoMeta

#: Sampling strategies supported by the Frame_Extraction_Service.
_STRATEGIES = {"every", "every_n", "every_ms", "adaptive"}


@runtime_checkable
class FrameDecoder(Protocol):
    """
    Local frame-decoding boundary.

    Implementations decode the transient, locally-stored video and expose the
    total frame count, a per-frame start-relative timestamp, and an optional
    per-frame movement signal used by the adaptive strategy. The original video
    bytes stay behind this interface and are never surfaced into the `FrameSet`
    contract (Req 3.7).
    """

    def frame_count(self, meta: VideoMeta) -> int:
        """Total number of decodable frames in the video."""
        ...

    def timestamp_ms(self, meta: VideoMeta, index: int) -> float:
        """Start-relative timestamp (ms) of the frame at ``index`` (Req 3.6)."""
        ...

    def movement_score(self, meta: VideoMeta, index: int) -> float:
        """Detected inter-frame movement in [0, 1] used by adaptive sampling."""
        ...


class DefaultFrameDecoder:
    """
    Metadata-derived decoder used as the default, dependency-free backend.

    Frame geometry is computed deterministically from `VideoMeta` so the
    sampling logic can be exercised in isolation (Req 14.4). The total frame
    count is ``round(duration_sec * fps)`` and each frame's timestamp is
    ``index / fps`` seconds from the start. A real CV-backed decoder can replace
    this class without changing the stage.
    """

    def frame_count(self, meta: VideoMeta) -> int:
        return max(0, round(meta.duration_sec * meta.fps))

    def timestamp_ms(self, meta: VideoMeta, index: int) -> float:
        if meta.fps <= 0:
            return 0.0
        return max(0.0, (index / meta.fps) * 1000.0)

    def movement_score(self, meta: VideoMeta, index: int) -> float:
        # No pixel data available from metadata alone; report a neutral,
        # constant movement signal. A real decoder computes this from
        # frame-to-frame differences.
        return 0.5


class FrameExtractionService(PipelineStage[VideoMeta, FrameSet]):
    """
    Extracts frames locally according to the configured sampling strategy and
    returns a `FrameSet`. Decoding happens inside the trusted boundary; the
    original video never leaves it (Req 3.1, 3.7).
    """

    name = "frame_extraction"

    def __init__(self, decoder: FrameDecoder | None = None) -> None:
        # Pluggable decoder keeps the stage testable without a real video.
        self._decoder: FrameDecoder = decoder or DefaultFrameDecoder()

    async def run(self, data: VideoMeta) -> StageResult[FrameSet]:
        strategy = settings.FRAME_SAMPLING
        if strategy not in _STRATEGIES:
            # Unknown strategy degrades safely to dense extraction rather than
            # raising (stages never raise on domain conditions).
            strategy = "every"

        n_frames = self._decoder.frame_count(data)
        indices = self._select_indices(strategy, n_frames, data)

        frames = [
            Frame(index=idx, timestamp_ms=self._decoder.timestamp_ms(data, idx))
            for idx in indices
        ]
        return StageResult[FrameSet](
            success=True,
            output=FrameSet(frames=frames, source_meta=data),
        )

    # ── Sampling strategy → ordered frame indices ──────────────────────────

    def _select_indices(
        self, strategy: str, n_frames: int, meta: VideoMeta
    ) -> list[int]:
        if n_frames <= 0:
            return []
        if strategy == "every":
            return list(range(n_frames))
        if strategy == "every_n":
            return self._every_n_indices(n_frames)
        if strategy == "every_ms":
            return self._every_ms_indices(n_frames, meta)
        if strategy == "adaptive":
            return self._adaptive_indices(n_frames, meta)
        return list(range(n_frames))

    @staticmethod
    def _every_n_indices(n_frames: int) -> list[int]:
        """One frame for every Nth frame → ceil(n_frames / N) frames (Req 3.3)."""
        step = max(1, int(settings.FRAME_SAMPLE_N))
        return list(range(0, n_frames, step))

    def _every_ms_indices(self, n_frames: int, meta: VideoMeta) -> list[int]:
        """
        One frame per ``FRAME_SAMPLE_MS`` interval over the video duration
        → ceil(duration_ms / X) frames (Req 3.4). The frame nearest each
        interval boundary ``k * X`` is selected, clamped to the last frame.
        """
        sample_ms = float(settings.FRAME_SAMPLE_MS)
        if sample_ms <= 0:
            return list(range(n_frames))

        duration_ms = max(0.0, meta.duration_sec * 1000.0)
        interval_count = math.ceil(duration_ms / sample_ms) if duration_ms > 0 else 0
        indices: list[int] = []
        for k in range(interval_count):
            t_ms = k * sample_ms
            idx = int((t_ms / 1000.0) * meta.fps) if meta.fps > 0 else 0
            indices.append(min(idx, n_frames - 1))
        return indices

    def _adaptive_indices(self, n_frames: int, meta: VideoMeta) -> list[int]:
        """
        Vary the extraction interval with detected inter-frame movement
        (Req 3.5): high movement → smaller step (sample densely), low movement
        → larger step. The result never exceeds the every-frame count and
        always advances by at least one frame, so the count is bounded within
        [ceil(n_frames / max_step), n_frames].
        """
        max_step = max(1, int(settings.FRAME_SAMPLE_N))
        indices: list[int] = []
        idx = 0
        while idx < n_frames:
            indices.append(idx)
            movement = self._decoder.movement_score(meta, idx)
            movement = min(1.0, max(0.0, movement))
            # movement 1.0 → step 1 (dense); movement 0.0 → step max_step (sparse)
            step = round(max_step - movement * (max_step - 1))
            idx += max(1, step)
        return indices
