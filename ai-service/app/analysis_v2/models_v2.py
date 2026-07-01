"""
Analysis Pipeline — Version 2 Data Contracts (Pydantic v2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
New, **strictly additive** typed data structures introduced by Version 2
(Production Extensions). None of these models modify or replace a Version 1
contract (`app/analysis/contracts.py`); they live entirely in the new
`app/analysis_v2/` package (Req 52.1) and follow the same Pydantic v2
conventions used across V1.

Design invariants enforced here via Pydantic `Field`/validators (see
design.md "V2 Data Contracts"):
  • Every confidence value is bounded to the closed interval [0.0, 1.0]
    (e.g. `BenchmarkSample.confidence`, Req 41.2).
  • `ScoreExplanation` factor weights are each bounded to [0, 100] (Req 49.2).
  • Privacy by construction: `CostRecord` (Req 40.2, 40.4) and
    `BenchmarkSample` (Req 41.6) carry NO user / video / frame / pose fields —
    only anonymous, aggregate, or hashed values. Both forbid unknown extra
    fields so a privacy-violating field can never be silently attached.

`MultiCameraInterface` is a **declaration only** (Req 50.2, 50.3, 50.5): the
ABC is defined so the single-camera architecture is multi-camera-ready, but no
concrete implementation exists in V2.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.analysis.base import StageResult


# An opaque, transient reference to a locally-held video (path/handle). Pixel
# bytes are NEVER carried in-contract — only a handle is referenced, mirroring
# the V1 artifact-handle convention (Req 1.x). Defined as a plain alias because
# V1 treats the pipeline input (VideoRef) as an opaque handle.
VideoRef = str


# ── Video_Compression_Service (Req 32) ──

class CompressionMetadata(BaseModel):
    """
    Metadata describing a client-side compression pass (Req 32.7).

    Anonymous, aggregate sizing/timing only — no video bytes, no user data.
    """
    original_size: int = Field(..., ge=0, description="Source size in bytes")
    compressed_size: int = Field(..., ge=0, description="Output size in bytes")
    compression_ratio: float = Field(..., ge=0.0, description="compressed/original ratio")
    compression_time_ms: float = Field(..., ge=0.0, description="Wall-clock compression time (ms)")


# ── Chunk_Upload_Service (Req 33) ──

class UploadChunk(BaseModel):
    """
    A single ordered upload chunk with a per-chunk integrity checksum
    (Req 33.1–33.3).

    `index` orders the chunk within the session; `size_bytes` is the chunk
    payload size (the service partitions into 1 MB–50 MB chunks, with the final
    chunk possibly smaller); `verified` is True iff the server-recomputed
    SHA-256 matches `sha256` (Req 33.2).
    """
    index: int = Field(..., ge=0, description="Ordered chunk index")
    size_bytes: int = Field(..., gt=0, description="Chunk payload size in bytes")
    sha256: str = Field(..., description="Per-chunk SHA-256 checksum")
    verified: bool = Field(default=False, description="True iff recomputed == original")


# ── Cost_Tracking_Service (Req 40) ──

class CostRecord(BaseModel):
    """
    Anonymous, aggregate resource-cost record for one terminal job (Req 40.1).

    PRIVACY BOUNDARY: contains NO user_id and NO video / frame / pose data
    (Req 40.2, 40.4). `frame_count` is an aggregate count only — not frame
    pixels. Excluded from the client-facing result (Req 40.3) and stored in a
    separate analytics collection. `extra="forbid"` guarantees no privacy-
    violating field can be attached.
    """
    model_config = ConfigDict(extra="forbid")

    processing_time_ms: float = Field(..., ge=0.0)
    gpu_memory_mb: float = Field(..., ge=0.0)
    vram_usage_mb: float = Field(..., ge=0.0)
    frame_count: int = Field(..., ge=0, description="Aggregate count only — not frame data")
    model_used: str
    token_count: int = Field(..., ge=0)
    estimated_inference_cost: float = Field(..., ge=0.0)
    worker_id: str
    queue_wait_ms: float = Field(..., ge=0.0)


# ── Benchmark_Dataset_Builder (Req 41) ──

class BenchmarkSample(BaseModel):
    """
    A single benchmark/eval sample (Req 41.2). Every field is required and
    must be non-empty for the sample to be accepted by the builder
    (validated at the service layer, Req 41.1–41.3).

    PRIVACY BOUNDARY: references the image by `image_hash` only — NO original
    video / frames / pose are carried (Req 41.6). `extra="forbid"` prevents any
    privacy-violating field from being attached.
    """
    model_config = ConfigDict(extra="forbid")

    image_hash: str = Field(..., description="Hash of the source image — never the image itself")
    exercise: str
    prediction: str
    ground_truth: str
    confidence: float = Field(..., ge=0.0, le=1.0, description="Bounded confidence in [0,1]")
    reason: str
    manual_correction: str
    pipeline_version: str


# ── Human_Review_Mode (Req 42) ──

class ReviewStatus(str, Enum):
    """Exactly one of two human-review states for a result (Req 42.5)."""
    confident = "Confident"
    needs_review = "Needs Review"


# ── Explainable_Feedback / Explainability (Req 49) ──

class ScoreExplanation(BaseModel):
    """
    A per-score explanation expressed as weighted contributing factors
    (Req 49.2).

    `factors` maps factor name (range_of_motion, tempo, balance, stability,
    symmetry) to a weight; each weight is bounded to [0, 100]. The design's
    sum-to-100 invariant is enforced by the producer (`explain_score`); this
    contract enforces the per-factor [0, 100] bound.
    """
    score_name: str
    factors: dict[str, float] = Field(
        ..., description="{range_of_motion, tempo, balance, stability, symmetry} each in [0,100]"
    )

    @field_validator("factors")
    @classmethod
    def _factor_weights_bounded(cls, v: dict[str, float]) -> dict[str, float]:
        for name, weight in v.items():
            if not (0.0 <= weight <= 100.0):
                raise ValueError(
                    f"factor weight for {name!r} must be in [0, 100], got {weight}"
                )
        return v


# ── Device_Capability_Service (Req 48) ──

class DeviceCapabilityProfile(BaseModel):
    """
    On-device capability tier and the recording/upload settings derived from it
    (Req 48.1–48.5). A failed/timed-out detection falls back to a low-end safe
    default with `detection_completed=False`.
    """
    tier: Literal["high-end", "mid-range", "low-end"]
    resolution: int = Field(..., gt=0)
    frame_sampling_rate: int = Field(..., gt=0)
    upload_quality: int = Field(..., ge=0)
    compression_target: int = Field(..., ge=0)
    detection_completed: bool = True


# ── Offline_Queue_Service (Req 45) ──

class OfflineQueueState(str, Enum):
    """Lifecycle states of a locally-queued recording (Req 45.3)."""
    queued = "Queued"
    uploading = "Uploading"
    processing = "Processing"
    completed = "Completed"
    failed = "Failed"


# ── Multi-Camera readiness (Req 50) — declaration only ──

class CameraAngle(str, Enum):
    """Supported camera angles for a future multi-camera fusion (Req 50.1)."""
    front = "Front"
    side = "Side"
    rear = "Rear"


class MultiCameraInput(BaseModel):
    """
    Declaration-only input shape for a future multi-camera fusion (Req 50.1).

    `angles` maps each `CameraAngle` to its (opaque) `VideoRef`; `fusion_input`
    is an optional pre-fused single reference. No fusion logic consumes this in
    V2 — it exists so the architecture is multi-camera-ready without changing
    the single-camera path.
    """
    angles: dict[CameraAngle, VideoRef] = Field(default_factory=dict)
    fusion_input: VideoRef | None = None


class MultiCameraInterface(ABC):
    """
    Declared, NOT implemented multi-camera fusion interface (Req 50.2, 50.3,
    50.5).

    The single-camera architecture is intentionally multi-camera-ready: this
    ABC declares the fusion entrypoint so a future engine can implement it, but
    V2 ships no concrete implementation. Any invocation in V2 is expected to
    return ``StructuredError(code='MULTI_CAMERA_NOT_IMPLEMENTED')`` without
    touching single-camera state (Req 50.5).
    """

    @abstractmethod
    async def fuse(self, inputs: MultiCameraInput) -> "StageResult":
        """Declaration only — no V2 implementation (Req 50.5)."""
        ...
