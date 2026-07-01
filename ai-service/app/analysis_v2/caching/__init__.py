"""
V2 volatile caches (additive).

Frame_Cache (Stage 37, Req 38) and Pose_Cache (Stage 38, Req 39) wrap the
V1 extraction stages. Caches are volatile-only and cleared on completion —
no video, frame, or pose image is ever persisted (privacy by construction).

Both caches build on the shared `VolatileLRU` primitive (Req 38.5, 39.5),
re-exported here for use by the Frame_Cache and Pose_Cache.
"""

from app.analysis_v2.caching.frame_cache import FrameCache
from app.analysis_v2.caching.lru import VolatileLRU
from app.analysis_v2.caching.pose_cache import PoseCache

__all__ = ["VolatileLRU", "FrameCache", "PoseCache"]
