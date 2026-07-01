"""
Key_Frame_Selector — Pipeline Stage 4 (QualityScoredFrames → KeyFrames)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Selects a representative subset of the retained, quality-scored frames so that
downstream stages (exercise detection, pose extraction) process only the most
informative frames. The stage enforces four invariants drawn directly from the
acceptance criteria of Requirement 5:

  • Req 5.1 — the selected subset has count <= MAX_KEYFRAMES (config-driven).
  • Req 5.2 — no two selected frames are near-duplicates under a similarity
    metric (configurable KEYFRAME_SIMILARITY_THRESHOLD).
  • Req 5.3 — movement-transition frames are preferred over static frames when
    the subset must be trimmed to the bound.
  • Req 5.4 — the selected frames preserve strictly increasing chronological
    (timestamp) order.

The similarity / transition computation operates on an abstract per-frame
*feature accessor* (`FrameFeatureFn`) rather than on raw pixels. This keeps the
stage deterministic, model-agnostic, and independently testable (Req 14.4): the
default accessor derives a feature vector from the per-frame `FrameQuality`
scores, but a caller (or a test) may inject any accessor that maps a
`QualityScoredFrame` to a numeric vector.

Like every stage, this one NEVER raises on domain failure — it returns a
`StageResult` (see `base.py`).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

from app.core.config import settings

from ..base import PipelineStage, StageResult
from ..contracts import Frame, KeyFrames, QualityScoredFrame, QualityScoredFrames

#: An abstract accessor mapping a quality-scored frame to a numeric feature
#: vector. The similarity and movement-transition metrics operate on the
#: returned vector, which decouples selection logic from any concrete frame
#: representation and makes the stage trivially testable.
FrameFeatureFn = Callable[[QualityScoredFrame], Sequence[float]]


def default_feature_vector(qsf: QualityScoredFrame) -> Sequence[float]:
    """
    Default feature accessor: derive a feature vector from the per-frame
    `FrameQuality` scores. Frames with similar visual quality characteristics
    are treated as near-duplicates, and large frame-to-frame changes in these
    features indicate movement transitions.
    """
    q = qsf.quality
    return (
        q.blur,
        q.brightness,
        q.contrast,
        q.motion_blur,
        q.camera_shake,
        q.body_visibility,
        q.occlusion,
    )


def _distance(a: Sequence[float], b: Sequence[float]) -> float:
    """Euclidean distance between two equal-length feature vectors."""
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


class KeyFrameSelector(PipelineStage[QualityScoredFrames, KeyFrames]):
    """
    Stage 4: select a bounded, de-duplicated, chronologically ordered subset of
    retained frames, preferring movement transitions over static positions.
    """

    name: str = "key_frame_selection"

    def __init__(
        self,
        max_keyframes: int | None = None,
        similarity_threshold: float | None = None,
        feature_fn: FrameFeatureFn = default_feature_vector,
    ) -> None:
        # Selection bounds are read from configuration (never hardcoded), with
        # optional overrides to keep the stage independently testable.
        self.max_keyframes = (
            settings.MAX_KEYFRAMES if max_keyframes is None else max_keyframes
        )
        self.similarity_threshold = (
            settings.KEYFRAME_SIMILARITY_THRESHOLD
            if similarity_threshold is None
            else similarity_threshold
        )
        self.feature_fn = feature_fn

    async def run(self, data: QualityScoredFrames) -> StageResult[KeyFrames]:
        # 1. Consider only frames the Frame_Quality_Service retained (Req 5.1),
        #    ordered chronologically (Req 5.4). The sort is stable, so frames
        #    that share a timestamp keep their original relative order.
        retained = [qsf for qsf in data.frames if qsf.retained]
        retained.sort(key=lambda qsf: qsf.frame.timestamp_ms)

        # Precompute feature vectors and a per-frame movement-transition score.
        features = [list(self.feature_fn(qsf)) for qsf in retained]
        transition = self._transition_scores(features)

        # 2. Greedy chronological pass that simultaneously guarantees:
        #    - strictly increasing timestamps (Req 5.4): never keep a frame
        #      whose timestamp is not strictly greater than the last kept one.
        #    - no near-duplicate pair (Req 5.2): never keep a frame within the
        #      similarity threshold of any already-kept frame. Checking against
        #      every kept frame (not just the previous) makes the no-duplicate
        #      invariant hold pairwise across the whole subset.
        kept_idx: list[int] = []
        last_ts: float | None = None
        for i, qsf in enumerate(retained):
            ts = qsf.frame.timestamp_ms
            if last_ts is not None and ts <= last_ts:
                continue
            if any(
                _distance(features[i], features[j]) < self.similarity_threshold
                for j in kept_idx
            ):
                continue
            kept_idx.append(i)
            last_ts = ts

        # 3. Enforce the MAX_KEYFRAMES bound (Req 5.1). When trimming is needed,
        #    prefer the highest movement-transition frames (Req 5.3), then
        #    restore strictly increasing chronological order (Req 5.4).
        if len(kept_idx) > self.max_keyframes:
            kept_idx = sorted(
                kept_idx,
                key=lambda i: transition[i],
                reverse=True,
            )[: self.max_keyframes]
            kept_idx.sort(key=lambda i: retained[i].frame.timestamp_ms)

        selected: list[Frame] = [retained[i].frame for i in kept_idx]
        return StageResult(
            success=True,
            output=KeyFrames(frames=selected, source_meta=data.source_meta),
        )

    def _transition_scores(self, features: list[list[float]]) -> list[float]:
        """
        Movement-transition score per frame: the mean feature-vector distance to
        its immediate chronological neighbours. Static frames (little change vs.
        neighbours) score low; transition frames score high (Req 5.3).
        """
        n = len(features)
        scores = [0.0] * n
        for i in range(n):
            neighbours: list[float] = []
            if i > 0:
                neighbours.append(_distance(features[i], features[i - 1]))
            if i < n - 1:
                neighbours.append(_distance(features[i], features[i + 1]))
            scores[i] = sum(neighbours) / len(neighbours) if neighbours else 0.0
        return scores
