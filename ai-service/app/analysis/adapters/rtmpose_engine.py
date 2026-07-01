"""
RTMPose Pose_Engine — real, ONNX-backed landmark extraction (Req 7.x, 21.1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A concrete `Pose_Engine` that produces REAL body landmarks using RTMPose via
`rtmlib` on the ONNX Runtime CPU backend. This is the runtime replacement for
the dependency-gated stubs in `pose_engines.py` — it is chosen because MediaPipe
publishes no working wheel for this interpreter (Python 3.14), whereas
`onnxruntime` + `rtmlib` do and self-download their model.

Unlike the registry stubs (which take no constructor args and receive only
`Frame` index/timestamp), this engine is **job-bound**: it holds an
`OpenCvFrameReader` for the job's downloaded video and the probed `VideoMeta`,
so it can decode the actual pixels for each `Frame` and run inference. The
pipeline wires one instance per job via the `pose_extraction=` override, so no
shared/global mutable state crosses jobs.

Output contract (matches `contracts.Landmark` / `FrameLandmarks`):
  • 17 COCO keypoints per frame in fixed order,
  • x/y normalized to [0,1] by the frame dimensions (resolution-independent,
    Req 7.4), z left at 0.0 (RTMPose body model is 2-D),
  • per-landmark `confidence` = the model's keypoint score, clamped to [0,1]
    (Req 21.1),
  • `overall_confidence` = mean keypoint score for the frame,
  • `person_count` = the max number of confidently-detected people across the
    processed frames, so the pipeline's MULTIPLE_PEOPLE guard (Req 7.6) fires on
    genuine multi-person footage while a clean single-person clip reports 1.

Never raises on inference failure — returns `PoseEngineResult(available=False)`
so the `Pose_Extraction_Service` surfaces a sanitized error.
"""

from __future__ import annotations

import logging
import os
import threading

from ..acquire import OpenCvFrameReader
from ..contracts import Frame, FrameLandmarks, Landmark, VideoMeta
from ..person_validation import PersonDetection
from .pose_engines import PoseEngine, PoseEngineResult

logger = logging.getLogger("getfit-ai")

#: A person is "present" in a frame when its mean keypoint score is at least
#: this value — filters spurious low-confidence detections so a clean
#: single-person clip does not falsely trip the MULTIPLE_PEOPLE guard.
_PERSON_PRESENCE_MIN_SCORE = 0.3

# The rtmlib model is expensive to construct and thread-unsafe to build
# concurrently, so it is created once per process and reused across jobs.
_body_model = None
_body_lock = threading.Lock()


def _clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return float(value)


def _get_body_model():
    """Lazily build and cache the shared rtmlib Body model (CPU/ONNX)."""
    global _body_model
    if _body_model is not None:
        return _body_model
    with _body_lock:
        if _body_model is None:
            from rtmlib import Body

            mode = os.environ.get("RTMPOSE_MODE", "lightweight")
            _body_model = Body(mode=mode, backend="onnxruntime", device="cpu")
    return _body_model


class RtmPoseEngine(PoseEngine):
    """Job-bound RTMPose engine producing normalized COCO-17 landmarks."""

    name = "rtmpose"
    version = "rtmpose-body7-256x192"

    def __init__(self, reader: OpenCvFrameReader, meta: VideoMeta) -> None:
        self._reader = reader
        self._meta = meta

    async def is_available(self) -> bool:
        try:
            import importlib.util

            return (
                importlib.util.find_spec("rtmlib") is not None
                and importlib.util.find_spec("onnxruntime") is not None
            )
        except Exception:  # pragma: no cover - defensive
            return False

    async def extract(self, frames: list[Frame]) -> PoseEngineResult:
        try:
            model = _get_body_model()
        except Exception as exc:
            logger.warning("RTMPose model unavailable: %s", exc)
            return PoseEngineResult(frames=[], person_count=0, available=False)

        width = float(self._meta.width) or 1.0
        height = float(self._meta.height) or 1.0

        out_frames: list[FrameLandmarks] = []
        detections: list[PersonDetection] = []
        max_people = 0

        for frame in frames:
            image = self._reader.read(frame.index)
            if image is None:
                continue

            try:
                keypoints, scores = model(image)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("RTMPose inference failed on frame %s: %s", frame.index, exc)
                continue

            if keypoints is None or len(keypoints) == 0:
                continue

            # Count confidently-present people for the multi-person guard, and
            # select the highest-mean-score person for this frame's landmarks.
            present = 0
            best_idx = 0
            best_mean = -1.0
            for p_idx in range(len(keypoints)):
                p_scores = scores[p_idx]
                mean_score = float(sum(float(s) for s in p_scores) / len(p_scores))
                if mean_score >= _PERSON_PRESENCE_MIN_SCORE:
                    present += 1
                if mean_score > best_mean:
                    best_mean = mean_score
                    best_idx = p_idx

                # Record a per-person detection (normalized bbox + confidence)
                # for the additive Person Validation Layer. Every detected
                # person is tracked — posters/mirrors/TVs are filtered later by
                # motion/size/confidence, not discarded here.
                det = self._detection_for(
                    keypoints[p_idx], p_scores, frame, width, height
                )
                if det is not None:
                    detections.append(det)
            max_people = max(max_people, present)

            kp = keypoints[best_idx]
            sc = scores[best_idx]
            landmarks = [
                Landmark(
                    x=_clamp01(float(kp[j][0]) / width),
                    y=_clamp01(float(kp[j][1]) / height),
                    z=0.0,
                    confidence=_clamp01(float(sc[j])),
                )
                for j in range(len(kp))
            ]
            overall = _clamp01(sum(lm.confidence for lm in landmarks) / len(landmarks)) if landmarks else 0.0
            out_frames.append(
                FrameLandmarks(
                    timestamp_ms=frame.timestamp_ms,
                    landmarks=landmarks,
                    overall_confidence=overall,
                )
            )

        return PoseEngineResult(
            frames=out_frames,
            person_count=max(max_people, 1 if out_frames else 0),
            available=True,
            detections=detections,
        )

    @staticmethod
    def _detection_for(kp, scores, frame: Frame, width: float, height: float):
        """Build a normalized `PersonDetection` (bbox + confidence) for a person.

        The bounding box spans the confidently-detected keypoints; coordinates
        are normalized to the frame so the validation layer is
        resolution-independent. Returns ``None`` when no keypoint is usable.
        """
        xs: list[float] = []
        ys: list[float] = []
        visible = 0
        score_sum = 0.0
        n = len(kp)
        for j in range(n):
            s = float(scores[j])
            score_sum += s
            if s >= _PERSON_PRESENCE_MIN_SCORE:
                visible += 1
                xs.append(float(kp[j][0]))
                ys.append(float(kp[j][1]))
        if not xs or not ys:
            # Fall back to all keypoints so a low-confidence person is still
            # tracked (it will simply score low in the validation layer).
            xs = [float(kp[j][0]) for j in range(n)]
            ys = [float(kp[j][1]) for j in range(n)]
        if not xs or not ys:
            return None

        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        mean_score = score_sum / n if n else 0.0
        return PersonDetection(
            frame_index=frame.index,
            timestamp_ms=frame.timestamp_ms,
            cx=_clamp01(((min_x + max_x) / 2.0) / width),
            cy=_clamp01(((min_y + max_y) / 2.0) / height),
            width=_clamp01((max_x - min_x) / width),
            height=_clamp01((max_y - min_y) / height),
            mean_score=_clamp01(mean_score),
            visible_keypoints=visible,
        )
