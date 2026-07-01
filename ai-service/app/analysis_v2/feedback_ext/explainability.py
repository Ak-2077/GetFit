"""
Explainable AI — Stage 48 (Req 49)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
An **additive** feedback hook invoked by the existing `Feedback_Service`
after it has built the V1 `AnalysisResult`. For each produced score it attaches
a `Score_Explanation` attributing that score to its weighted contributing
factors — range of motion, tempo, balance, stability, and symmetry — each
expressed as a percentage weight in [0, 100] with the weights summing to 100
(Req 49.1, 49.2).

This module does NOT change the `Feedback_Service` signature — the caller
invokes `explain_score(...)` additively and stores the returned
`ScoreExplanation` in the optional `AnalysisResult.score_explanations` list
(Req 52.3). It builds on the UNCHANGED V1 core contract re-exported from
`app.analysis_v2` (`StructuredError`, Req 52.1, 52.6) and reuses the
`ScoreExplanation` model already defined in `models_v2.py` (task 18) — it never
redefines either.

Fail-safe could-not-explain contract (design.md "Property 58"):
  • all five required contributing factors available  → a `ScoreExplanation`
    whose factor weights are each in [0, 100] and sum to 100, and a `None`
    error indication (Req 49.1, 49.2).
  • any required contributing factor unavailable       → `(None,
    StructuredError(...))` — no explanation, so the caller OMITS the score
    from the result and records the could-not-explain indication (Req 49.3,
    49.4).

Mirroring `review_mode.py` (task 25.1), this function NEVER raises on missing
or malformed factor input. It returns a `(ScoreExplanation | None,
StructuredError | None)` pair: the first element is the explanation (or `None`
when the score cannot be explained) and the second carries the sanitized
could-not-explain indication (or `None` on success). At most one element is
populated per call.
"""

from __future__ import annotations

import math

# Build on the UNCHANGED V1 core contract, re-exported from the V2 package
# (Req 52.1, 52.6) — imported, never redefined.
from app.analysis_v2 import StructuredError

# Reuse the ScoreExplanation model defined in models_v2 (task 18) — do NOT
# redefine. It enforces the per-factor [0, 100] bound; the sum-to-100 invariant
# is enforced here by the producer (design.md "V2 Data Contracts").
from app.analysis_v2.models_v2 import ScoreExplanation

#: The five required contributing factors that every explained score attributes
#: its weight to (Req 49.2), in a stable order.
REQUIRED_FACTORS: tuple[str, ...] = (
    "range_of_motion",
    "tempo",
    "balance",
    "stability",
    "symmetry",
)

#: Total the normalized percentage weights must sum to (Req 49.2).
TOTAL_WEIGHT: float = 100.0

#: Stable stage/component name surfaced as the originating stage in a
#: StructuredError (Req 15.1), mirroring the V1 stage-naming convention.
EXPLAINABILITY_STAGE_NAME: str = "explainable_ai"

#: Stable error code recorded when a score cannot be explained because a
#: required contributing factor is unavailable (Req 49.3, 49.4).
SCORE_NOT_EXPLAINABLE: str = "SCORE_COULD_NOT_BE_EXPLAINED"


def _is_available(value: float | None) -> bool:
    """A contributing factor is available iff it is a finite, non-negative real.

    A missing key, an explicit ``None``, a ``NaN``/``inf`` sentinel, or a
    negative magnitude all count as *unavailable* — none of which can yield a
    valid percentage weight in [0, 100], so the score cannot be explained
    (Req 49.4).
    """
    return value is not None and math.isfinite(value) and value >= 0.0


def explain_score(
    factors: dict[str, float | None],
    score_name: str = "score",
) -> tuple[ScoreExplanation | None, StructuredError | None]:
    """Attribute a produced score to its weighted contributing factors.

    Implements the fail-safe explanation mapping of Property 58 (Req 49):

      • Every required contributing factor (``range_of_motion``, ``tempo``,
        ``balance``, ``stability``, ``symmetry``) is available →
        ``(ScoreExplanation(...), None)`` whose factor weights are each in
        [0, 100] and sum to 100 (Req 49.1, 49.2). The raw factor magnitudes are
        normalized into percentage weights; when every magnitude is zero the
        weight is distributed equally so the sum-to-100 invariant still holds.
      • Any required contributing factor is unavailable (missing, ``None``,
        non-finite, or negative) → ``(None, StructuredError(...))`` so the
        caller OMITS the corresponding score from the ``Analysis_Result`` and
        records the could-not-explain indication (Req 49.3, 49.4). Never raises.

    This is invoked additively by the existing ``Feedback_Service``; it does not
    change that service's signature.

    Args:
        factors: The raw contributing-factor magnitudes for the score, keyed by
            factor name. Only the five ``REQUIRED_FACTORS`` participate in the
            explanation; any additional keys are ignored. A factor is treated as
            unavailable when its key is absent or its value is ``None``,
            non-finite, or negative.
        score_name: The name of the score being explained (e.g. the field name
            in the ``Analysis_Result``). Recorded on the returned
            ``ScoreExplanation``.

    Returns:
        A ``(ScoreExplanation | None, StructuredError | None)`` pair. On success
        the first element is the explanation and the second is ``None``; when a
        required factor is unavailable the first element is ``None`` and the
        second carries a sanitized ``StructuredError(code=
        "SCORE_COULD_NOT_BE_EXPLAINED")``.
    """
    # Req 49.4 — a required contributing factor is unavailable: the score cannot
    # be explained. Return no explanation plus a could-not-explain indication so
    # the caller omits the score (Req 49.3).
    missing = [name for name in REQUIRED_FACTORS if not _is_available(factors.get(name))]
    if missing:
        return (
            None,
            StructuredError(
                code=SCORE_NOT_EXPLAINABLE,
                message=(
                    f"Score {score_name!r} could not be explained because the "
                    f"required contributing factor(s) {', '.join(missing)} "
                    f"were unavailable; the score is omitted from the result."
                ),
                stage=EXPLAINABILITY_STAGE_NAME,
            ),
        )

    # All five factors are available — normalize their magnitudes into
    # percentage weights that are each in [0, 100] and sum to 100 (Req 49.2).
    values = {name: float(factors[name]) for name in REQUIRED_FACTORS}  # type: ignore[arg-type]
    total = math.fsum(values.values())

    if total == 0.0:
        # Every contribution is zero — distribute the weight equally so the
        # sum-to-100 invariant still holds rather than dividing by zero.
        weights = {name: TOTAL_WEIGHT / len(REQUIRED_FACTORS) for name in REQUIRED_FACTORS}
    else:
        weights = {name: (value / total) * TOTAL_WEIGHT for name, value in values.items()}

    return (
        ScoreExplanation(score_name=score_name, factors=weights),
        None,
    )
