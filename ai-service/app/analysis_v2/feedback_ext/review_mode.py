"""
Human Review Mode — Stage 41 (Req 42)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
An **additive** feedback hook invoked by the existing `Feedback_Service`
after it has built the V1 `AnalysisResult`. It maps an overall
Confidence_Score plus a configured review threshold onto exactly one
`Review_Status` (Req 42.5) so low-confidence results are gated for human
review rather than presented as confident (Req 42.4).

This module does NOT change the `Feedback_Service` signature — the caller
invokes `assign_review_status(...)` additively and stores the returned status
in the optional `AnalysisResult.review_status` field (Req 52.3). It builds on
the UNCHANGED V1 core contracts re-exported from `app.analysis_v2`
(`StructuredError`, Req 52.1, 52.6) and reuses the `ReviewStatus` enum already
defined in `models_v2.py` (Req 42.5) — it never redefines either.

Total, fail-safe threshold mapping (design.md "Property 48"):
  • confidence strictly below threshold        → Needs Review        (Req 42.1)
  • confidence >= threshold                     → Confident           (Req 42.2)
  • threshold absent or outside [0.0, 1.0]      → Needs Review + an
    invalid-config `StructuredError` indication (Req 42.6)

Fail-safe contract (consistent with other V2 components): this function NEVER
raises on a misconfigured threshold. It returns a `(ReviewStatus,
StructuredError | None)` pair — the second element is `None` on a valid
configuration and carries the sanitized invalid-config indication otherwise.
Because the unsafe path resolves to Needs Review, a Needs Review result is
never represented as Confident (Req 42.4, 42.5).
"""

from __future__ import annotations

# Build on the UNCHANGED V1 core contract, re-exported from the V2 package
# (Req 52.1, 52.6) — imported, never redefined.
from app.analysis_v2 import StructuredError

# Reuse the ReviewStatus enum defined in models_v2 (task 18) — do NOT redefine.
from app.analysis_v2.models_v2 import ReviewStatus

#: Stable stage/component name surfaced as the originating stage in a
#: StructuredError (Req 15.1), mirroring the V1 stage-naming convention.
REVIEW_STAGE_NAME: str = "human_review_mode"

#: Stable error code for a misconfigured review threshold (Req 42.6).
INVALID_REVIEW_THRESHOLD: str = "INVALID_REVIEW_THRESHOLD"


def assign_review_status(
    overall_confidence: float,
    threshold: float | None,
) -> tuple[ReviewStatus, StructuredError | None]:
    """Assign exactly one `Review_Status` from an overall confidence + threshold.

    Implements the total, fail-safe threshold mapping of Property 48 (Req 42):

      • ``threshold`` is ``None`` or outside the closed interval [0.0, 1.0] →
        ``(ReviewStatus.needs_review, StructuredError(...))`` — the fail-safe
        Needs Review status plus a sanitized invalid-config indication
        (Req 42.6). Never raises.
      • ``overall_confidence`` strictly below ``threshold`` →
        ``(ReviewStatus.needs_review, None)`` (Req 42.1).
      • ``overall_confidence`` greater than or equal to ``threshold`` →
        ``(ReviewStatus.confident, None)`` (Req 42.2).

    Exactly one status is always returned (Req 42.5); because every uncertain
    or misconfigured path resolves to Needs Review, a Needs Review result is
    never represented as Confident (Req 42.4).

    Args:
        overall_confidence: The overall Confidence_Score of the Analysis_Result
            (a value in [0.0, 1.0]).
        threshold: The configured review threshold read from configuration
            (Req 42.3); expected to be a value in [0.0, 1.0], or ``None`` when
            absent.

    Returns:
        A ``(ReviewStatus, StructuredError | None)`` pair. The second element is
        ``None`` for a valid threshold configuration, or a sanitized
        ``StructuredError(code="INVALID_REVIEW_THRESHOLD")`` when the threshold
        is absent or out of range (Req 42.6).
    """
    # Req 42.6 — absent or out-of-range threshold is a configuration fault:
    # fail safe to Needs Review and surface an invalid-config indication.
    if threshold is None or not (0.0 <= threshold <= 1.0):
        return (
            ReviewStatus.needs_review,
            StructuredError(
                code=INVALID_REVIEW_THRESHOLD,
                message=(
                    "Configured review threshold is absent or outside the "
                    "range 0.0 to 1.0; defaulting the review status to "
                    "Needs Review."
                ),
                stage=REVIEW_STAGE_NAME,
            ),
        )

    # Req 42.1 — strictly below threshold → Needs Review.
    if overall_confidence < threshold:
        return (ReviewStatus.needs_review, None)

    # Req 42.2 — at or above threshold → Confident.
    return (ReviewStatus.confident, None)
