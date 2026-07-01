"""Concrete `PipelineStage` implementations for the analysis pipeline."""

from .biomechanics import BiomechanicsService
from .cleanup import (
    ArtifactRegistry,
    ArtifactStore,
    CleanupService,
    FilesystemArtifactStore,
)
from .camera_guidance import (
    CameraGuidanceService,
    CameraSignals,
    CameraSignalSource,
    StaticCameraSignalSource,
    aggregate_signals,
)
from .exercise_detection import (
    ClassifierScore,
    ExerciseClassifier,
    ExerciseDetectionService,
    StaticExerciseClassifier,
)
from .feedback import (
    FEEDBACK_ERROR,
    LOW_CONFIDENCE_STATEMENT,
    FeedbackInput,
    FeedbackService,
)
from .frame_extraction import (
    DefaultFrameDecoder,
    FrameDecoder,
    FrameExtractionService,
)
from .key_frame_selector import (
    KeyFrameSelector,
    default_feature_vector,
)
from .movement_phase import (
    GENERIC_PHASES,
    MovementPhaseService,
)
from .movement_timeline import (
    COCO_KEYPOINT_NAMES,
    JOINT_ANGLE_DEFS,
    MovementTimelineService,
)
from .reasoning import (
    OllamaReasoner,
    Reasoner,
    ReasoningInput,
    ReasoningService,
    StaticReasoner,
)
from .rep_counting import (
    REP_COUNTING_ERROR,
    RepCountingService,
)
from .video_validation import (
    VideoValidationService,
    determine_orientation,
)

__all__ = [
    "BiomechanicsService",
    "CleanupService",
    "ArtifactStore",
    "FilesystemArtifactStore",
    "ArtifactRegistry",
    "VideoValidationService",
    "determine_orientation",
    "KeyFrameSelector",
    "default_feature_vector",
    "MovementTimelineService",
    "COCO_KEYPOINT_NAMES",
    "JOINT_ANGLE_DEFS",
    "MovementPhaseService",
    "GENERIC_PHASES",
    "FrameExtractionService",
    "FrameDecoder",
    "DefaultFrameDecoder",
    "ExerciseDetectionService",
    "ExerciseClassifier",
    "StaticExerciseClassifier",
    "ClassifierScore",
    "FeedbackService",
    "FeedbackInput",
    "FEEDBACK_ERROR",
    "LOW_CONFIDENCE_STATEMENT",
    "CameraGuidanceService",
    "CameraSignals",
    "CameraSignalSource",
    "StaticCameraSignalSource",
    "aggregate_signals",
    "ReasoningService",
    "ReasoningInput",
    "Reasoner",
    "StaticReasoner",
    "OllamaReasoner",
    "RepCountingService",
    "REP_COUNTING_ERROR",
]
