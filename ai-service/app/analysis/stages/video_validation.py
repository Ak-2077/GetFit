"""
Video_Validation_Service — first analytical Pipeline_Stage (Req 2.x)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Validates a probed `VideoMeta` against the configured constraints — container
format, codec, duration bounds, resolution, frame rate, and file size — records
the video orientation, and aggregates EVERY violated constraint into a single
structured response (Req 2.10). On full success it returns the detected
metadata with orientation recorded (Req 2.11).

The stage NEVER raises on a domain failure: it returns
`StageResult(success=False, error=StructuredError(...))` so the
Analysis_Pipeline can halt analytical stages and surface the sanitized error
(see `base.py`).

Error codes emitted (design Error Handling table + Req 2.6–2.9):
  • CORRUPTED_VIDEO   — video cannot be decoded (container/codec unidentifiable)
  • UNSUPPORTED_CODEC — codec not in the configured supported list
  • VIDEO_TOO_SHORT   — duration below the configured minimum
  • VIDEO_TOO_LONG    — duration above the configured maximum
Additional stable codes for the remaining Req 2.1 / 2.4 constraints, which have
no dedicated code in Req 15.2 but must be reported distinctly so the aggregated
response names exactly the violated constraints (design Property 4):
  • UNSUPPORTED_FORMAT — container format not in the configured supported list
  • INVALID_RESOLUTION — width/height outside the configured bounds
  • INVALID_FRAME_RATE — frame rate outside the configured bounds
  • VIDEO_TOO_LARGE    — file size above the configured maximum
"""

from __future__ import annotations

from app.core.config import Settings, settings

from ..base import PipelineStage, StageResult, StructuredError
from ..contracts import VideoMeta

# ── Stable error codes (Req 2.6–2.9 + the format/resolution/fps/size constraints) ──
CORRUPTED_VIDEO = "CORRUPTED_VIDEO"
UNSUPPORTED_FORMAT = "UNSUPPORTED_FORMAT"
UNSUPPORTED_CODEC = "UNSUPPORTED_CODEC"
VIDEO_TOO_SHORT = "VIDEO_TOO_SHORT"
VIDEO_TOO_LONG = "VIDEO_TOO_LONG"
INVALID_RESOLUTION = "INVALID_RESOLUTION"
INVALID_FRAME_RATE = "INVALID_FRAME_RATE"
VIDEO_TOO_LARGE = "VIDEO_TOO_LARGE"

# Aggregate code used when more than one constraint is violated at once (Req 2.10).
VIDEO_VALIDATION_FAILED = "VIDEO_VALIDATION_FAILED"

#: Orientation labels recorded on the validated metadata (Req 2.5).
LANDSCAPE = "landscape"
PORTRAIT = "portrait"


def determine_orientation(width: int, height: int) -> str:
    """Derive video orientation from frame dimensions (Req 2.5).

    A square frame (``width == height``) is treated as ``landscape``.
    """
    return LANDSCAPE if width >= height else PORTRAIT


class VideoValidationService(PipelineStage[VideoMeta, VideoMeta]):
    """Validate input video metadata against configured constraints (Req 2.x)."""

    name = "video_validation"

    def __init__(self, config: Settings | None = None) -> None:
        # Thresholds are always read from configuration, never hardcoded.
        self._cfg = config or settings

    # ── Pure validation helpers (no I/O, deterministic) ──

    @staticmethod
    def _is_corrupted(meta: VideoMeta) -> bool:
        """A video whose container or codec could not be identified by the
        probe is treated as undecodable / corrupted (Req 2.6)."""
        return not meta.container_format.strip() or not meta.codec.strip()

    def collect_violations(self, meta: VideoMeta) -> list[StructuredError]:
        """Return a StructuredError for every violated constraint (Req 2.1–2.4).

        The list is empty exactly when the metadata satisfies all constraints.
        Order is deterministic: format, codec, duration, resolution, fps, size.
        """
        cfg = self._cfg
        violations: list[StructuredError] = []

        # Req 2.1 — container format against the configured supported list.
        supported_formats = {fmt.lower() for fmt in cfg.SUPPORTED_FORMATS}
        if meta.container_format.strip().lower() not in supported_formats:
            violations.append(
                self._error(
                    UNSUPPORTED_FORMAT,
                    f"Unsupported container format '{meta.container_format}'. "
                    f"Supported formats: {sorted(supported_formats)}.",
                )
            )

        # Req 2.2 / 2.7 — codec against the configured supported list.
        supported_codecs = {c.lower() for c in cfg.SUPPORTED_CODECS}
        if meta.codec.strip().lower() not in supported_codecs:
            violations.append(
                self._error(
                    UNSUPPORTED_CODEC,
                    f"Unsupported codec '{meta.codec}'. "
                    f"Supported codecs: {sorted(supported_codecs)}.",
                )
            )

        # Req 2.3 / 2.8 / 2.9 — duration within [MIN_DURATION_SEC, MAX_DURATION_SEC].
        if meta.duration_sec < cfg.MIN_DURATION_SEC:
            violations.append(
                self._error(
                    VIDEO_TOO_SHORT,
                    f"Video duration {meta.duration_sec}s is below the minimum "
                    f"of {cfg.MIN_DURATION_SEC}s.",
                )
            )
        elif meta.duration_sec > cfg.MAX_DURATION_SEC:
            violations.append(
                self._error(
                    VIDEO_TOO_LONG,
                    f"Video duration {meta.duration_sec}s exceeds the maximum "
                    f"of {cfg.MAX_DURATION_SEC}s.",
                )
            )

        # Req 2.4 — resolution within configured bounds.
        if not (cfg.MIN_WIDTH <= meta.width <= cfg.MAX_WIDTH) or not (
            cfg.MIN_HEIGHT <= meta.height <= cfg.MAX_HEIGHT
        ):
            violations.append(
                self._error(
                    INVALID_RESOLUTION,
                    f"Resolution {meta.width}x{meta.height} is outside the "
                    f"allowed bounds "
                    f"{cfg.MIN_WIDTH}x{cfg.MIN_HEIGHT} – "
                    f"{cfg.MAX_WIDTH}x{cfg.MAX_HEIGHT}.",
                )
            )

        # Req 2.4 — frame rate within configured bounds.
        if not (cfg.MIN_FPS <= meta.fps <= cfg.MAX_FPS):
            violations.append(
                self._error(
                    INVALID_FRAME_RATE,
                    f"Frame rate {meta.fps}fps is outside the allowed bounds "
                    f"{cfg.MIN_FPS} – {cfg.MAX_FPS}fps.",
                )
            )

        # Req 2.4 — file size within configured bounds.
        if meta.size_bytes > cfg.MAX_SIZE_BYTES:
            violations.append(
                self._error(
                    VIDEO_TOO_LARGE,
                    f"File size {meta.size_bytes} bytes exceeds the maximum of "
                    f"{cfg.MAX_SIZE_BYTES} bytes.",
                )
            )

        return violations

    # ── Stage entry point ──

    async def run(self, data: VideoMeta) -> StageResult[VideoMeta]:
        """Validate the video metadata and return a normalized StageResult.

        - If the video cannot be decoded → single CORRUPTED_VIDEO error (Req 2.6).
        - If one or more constraints are violated → a single aggregated response
          carrying every violation in ``error.details`` (Req 2.10).
        - Otherwise → success with the detected metadata and recorded
          orientation (Req 2.5, 2.11).
        """
        # Req 2.6 — an undecodable video short-circuits all other checks.
        if self._is_corrupted(data):
            return StageResult(
                success=False,
                error=self._error(
                    CORRUPTED_VIDEO,
                    "Video is corrupted or cannot be decoded.",
                ),
            )

        violations = self.collect_violations(data)

        if violations:
            return StageResult(success=False, error=self._aggregate(violations))

        # Req 2.5 / 2.11 — success: record orientation on the detected metadata.
        validated = data.model_copy(
            update={"orientation": determine_orientation(data.width, data.height)}
        )
        return StageResult(success=True, output=validated)

    # ── Internal construction helpers ──

    def _error(self, code: str, message: str) -> StructuredError:
        return StructuredError(code=code, message=message, stage=self.name)

    def _aggregate(self, violations: list[StructuredError]) -> StructuredError:
        """Fold multiple constraint violations into one structured response.

        When exactly one constraint is violated the top-level ``code`` is that
        constraint's code; when several are violated the top-level ``code`` is
        the aggregate ``VIDEO_VALIDATION_FAILED``. In both cases the full set of
        violations is preserved in ``details`` (Req 2.10).
        """
        if len(violations) == 1:
            single = violations[0]
            return StructuredError(
                code=single.code,
                message=single.message,
                stage=self.name,
                details=list(violations),
            )

        codes = ", ".join(v.code for v in violations)
        return StructuredError(
            code=VIDEO_VALIDATION_FAILED,
            message=f"Video failed {len(violations)} validation constraints: {codes}.",
            stage=self.name,
            details=list(violations),
        )
