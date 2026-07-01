"""
Analysis Pipeline — Supported Error Codes & Cross-Boundary Sanitization
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Defines the canonical set of stable error codes the Analysis_Pipeline
supports (Req 15.2) and a sanitization helper that surfaces ONLY `code` and
`message` across the stage boundary to the backend/user — never the
originating `stage`, nested `details`, stack traces, or any internal
detail (Req 15.6).

Every Pipeline_Stage that cannot complete its responsibility returns a
`StructuredError` (see `base.py`) carrying a stable `code`, a human-readable
`message`, and the originating `stage` (Req 15.1). The backend then maps the
sanitized payload to an HTTP response carrying only `code` + `message`,
consistent with the existing `videoController.js` error pattern.
"""

from __future__ import annotations

from typing import TypedDict

from .base import StructuredError


# ── Canonical supported error codes (Req 15.2) ────────────────────────────
#
# Module-level constants for each stable code so call sites reference a name
# rather than a string literal, keeping the codes consistent across stages.

CORRUPTED_VIDEO: str = "CORRUPTED_VIDEO"
UNSUPPORTED_CODEC: str = "UNSUPPORTED_CODEC"
VIDEO_TOO_SHORT: str = "VIDEO_TOO_SHORT"
VIDEO_TOO_LONG: str = "VIDEO_TOO_LONG"
EXERCISE_NOT_RECOGNIZED: str = "EXERCISE_NOT_RECOGNIZED"
MULTIPLE_PEOPLE: str = "MULTIPLE_PEOPLE"
BODY_NOT_VISIBLE: str = "BODY_NOT_VISIBLE"
CAMERA_TOO_DARK: str = "CAMERA_TOO_DARK"
CAMERA_SHAKING: str = "CAMERA_SHAKING"
LOW_CONFIDENCE: str = "LOW_CONFIDENCE"


#: The canonical set of the ten error codes the Analysis_Pipeline supports
#: (Req 15.2). Stages must only emit codes drawn from this set; the property
#: test (task 9.4) verifies every surfaced code is a member.
SUPPORTED_ERROR_CODES: frozenset[str] = frozenset(
    {
        CORRUPTED_VIDEO,
        UNSUPPORTED_CODEC,
        VIDEO_TOO_SHORT,
        VIDEO_TOO_LONG,
        EXERCISE_NOT_RECOGNIZED,
        MULTIPLE_PEOPLE,
        BODY_NOT_VISIBLE,
        CAMERA_TOO_DARK,
        CAMERA_SHAKING,
        LOW_CONFIDENCE,
    }
)


class SanitizedError(TypedDict):
    """
    The minimal, client-safe error payload surfaced across the stage boundary.

    Carries ONLY the stable `code` and human-readable `message` (Req 15.6) —
    the originating `stage`, nested `details`, stack traces, and any other
    internal detail are deliberately excluded.
    """
    code: str
    message: str


def is_supported_code(code: str) -> bool:
    """Return True if `code` is one of the ten canonical supported codes (Req 15.2)."""
    return code in SUPPORTED_ERROR_CODES


def sanitize_error(error: StructuredError) -> SanitizedError:
    """
    Reduce a `StructuredError` to the client-safe `{code, message}` payload
    surfaced across the stage boundary to the backend/user (Req 15.6).

    Only `code` and `message` are surfaced; the originating `stage`, any
    nested `details`, and all internal detail are dropped so no stack traces
    or implementation specifics ever cross the boundary.
    """
    return SanitizedError(code=error.code, message=error.message)
