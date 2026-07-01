# Implementation Plan: AI Exercise Analysis (Version 1 — Foundation)

## Overview

This plan converts the Version 1 design into incremental coding steps. Work proceeds from the
core stage interfaces and Pydantic data contracts outward: each `Pipeline_Stage` and replaceable
adapter is implemented behind its interface, validated with property-based tests (Hypothesis in the
Python `ai-service`, fast-check in the Node `Backend`), then wired into the `Analysis_Pipeline`
orchestrator, the asynchronous `Job_Queue_Adapter` / `Background_Worker`, the FastAPI router, the
Node persistence layer, and finally the frontend presentation.

The new pipeline lives in a new `ai-service/app/analysis/` package and mirrors the existing
`app/vision/` adapter conventions (ABC + concrete implementations + registry + config-driven
selection). The Node `Backend/` is extended additively (new controller, aiClient methods, Mongoose
schema, routes) without changing existing AI APIs. Version 1 delivers architecture and contracts
only — no validated exercise-quality scoring or per-exercise logic.

Conventions:
- Stages return `StageResult(success=False, error=StructuredError(...))` on domain failure; they
  never raise across stage boundaries.
- Property tests run a minimum of 100 iterations and are tagged
  `# Feature: ai-exercise-analysis, Property {n}: {property_text}`.
- External services (pose engines, queue backends, LLM reasoning) are mocked/stubbed in tests.

## Tasks

- [x] 1. Set up the analysis package, stage interfaces, and data contracts
  - [x] 1.1 Create the `app/analysis/` package skeleton and core stage interface
    - Create `ai-service/app/analysis/__init__.py`, `stages/`, `adapters/`, and `plugins/` subpackages
    - Implement `app/analysis/base.py` with `StructuredError`, `StageResult[TOut]`, and the
      `PipelineStage(ABC, Generic[TIn, TOut])` interface following the `VisionBackend` ABC convention
    - _Requirements: 14.1, 14.2, 15.1, 31.5_

  - [x] 1.2 Define all Pydantic stage data contracts
    - Implement `app/analysis/contracts.py` with `VideoMeta`, `Frame`, `FrameSet`, `FrameQuality`,
      `QualityScoredFrame`, `Landmark`, `FrameLandmarks`, `TimelineEntry`, `MovementTimeline`,
      `MovementPhase`, `RepetitionSummary`, `ObjectiveMetrics`, `Detection`, `ConfidenceSources`,
      `CameraGuidance`, `ReasoningOutput`, and `AnalysisResult`
    - Ensure landmark coordinates are normalized and resolution-independent, and confidence fields
      are bounded to [0.0, 1.0]
    - _Requirements: 7.4, 13.1, 14.3, 16.1, 21.1, 31.1_

  - [x] 1.3 Extend configuration with selection, threshold, and weight settings
    - Extend `ai-service/app/core/config.py` with `POSE_ENGINE`, `SMOOTHING_ALGORITHM`,
      `QUEUE_BACKEND`, `PROGRESS_TRANSPORT`, `FRAME_SAMPLING`, supported formats/codecs, duration and
      quality thresholds, confidence thresholds, `MAX_LANDMARK_JUMP`, and `FUSION_WEIGHTS` /
      `FUSION_MAX_SINGLE_WEIGHT`
    - Update `.env.example` with the new configuration keys
    - _Requirements: 3.x config, 4.x config, 21.5, 22.4, 23.4, 25.3, 26.4, 27.2, 30.4_

  - [x] 1.4 Write unit tests for contracts and the stage interface
    - Assert contract serialization round-trips and that `StageResult`/`StructuredError` enforce
      required fields; assert a sample stage implements `PipelineStage`
    - _Requirements: 14.1, 14.3, 14.4_

- [x] 2. Implement video validation and the frame stages
  - [x] 2.1 Implement the `Video_Validation_Service`
    - Validate container format, codec, duration bounds, resolution, frame rate, and size; record
      orientation; aggregate all violations into a single structured response; emit
      `CORRUPTED_VIDEO`, `UNSUPPORTED_CODEC`, `VIDEO_TOO_SHORT`, `VIDEO_TOO_LONG` codes
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

  - [x] 2.2 Write property test for video validation
    - **Property 4: Validation reports exactly the violated constraints**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11**

  - [x] 2.3 Implement the `Frame_Extraction_Service`
    - Decode frames locally inside the trusted boundary; support `every` / `every_n` / `every_ms` /
      `adaptive` sampling strategies; attach a start-relative timestamp to each frame; never transmit
      the original video to any engine
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 2.4 Write property test for frame extraction
    - **Property 5: Frame extraction count and timestamps match the sampling strategy**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6**

  - [x] 2.5 Implement the `Frame_Quality_Service`
    - Compute blur, brightness, contrast, motion-blur, camera-shake, body-visibility, and occlusion
      scores per frame; discard sub-threshold frames; emit `BODY_NOT_VISIBLE`, `CAMERA_TOO_DARK`,
      `CAMERA_SHAKING` codes for dominant failure causes
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 15.3, 15.4, 16.3_

  - [x] 2.6 Write property test for frame quality scoring
    - **Property 6: Quality scoring is complete and discards exactly sub-threshold frames**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 16.3**

  - [x] 2.7 Implement the `Key_Frame_Selector`
    - Select a subset bounded by `MAX_KEYFRAMES`; drop near-duplicates by a similarity metric; prefer
      movement transitions; preserve chronological order
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 2.8 Write property test for key frame selection
    - **Property 7: Key frame selection is bounded, de-duplicated, and chronological**
    - **Validates: Requirements 5.1, 5.2, 5.4**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement camera guidance, exercise detection, and replaceable pose extraction
  - [x] 4.1 Implement the `Camera_Guidance_Service`
    - Detect body cut off, body too small/too close, incorrect angle, poor lighting, excessive shake,
      orientation, and multiple people before pose extraction; attach an actionable recommendation per
      detected issue; return a suitable result with an empty issue list when clean
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6_

  - [x] 4.2 Write property test for camera guidance
    - **Property 20: Camera guidance detects issues and is actionable or clears**
    - **Validates: Requirements 22.2, 22.3, 22.4**

  - [x] 4.3 Implement the `Exercise_Detection_Service`
    - Return a detected exercise id with a bounded confidence and a ranked list of alternatives;
      gate on `DETECTION_CONFIDENCE_MIN` to emit `EXERCISE_NOT_RECOGNIZED`; exclude posture judgments
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 4.4 Write property test for exercise detection
    - **Property 8: Exercise detection produces ranked, bounded confidences**
    - **Validates: Requirements 6.1, 6.2**

  - [x] 4.5 Implement the `Pose_Extraction_Service` with a replaceable `Pose_Engine` registry
    - Define the `PoseEngine` ABC and a registry (mediapipe/movenet/blazepose/openpose stubs);
      select the active engine from config; return normalized landmarks with per-landmark
      `Pose_Confidence`; emit `MULTIPLE_PEOPLE`; exclude LLM reasoning
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 21.1, 31.2_

  - [x] 4.6 Write property test for normalized pose extraction
    - **Property 9: Normalized landmarks are resolution-independent**
    - **Validates: Requirements 7.4, 21.1**

- [x] 5. Implement landmark confidence, validation, and replaceable smoothing
  - [x] 5.1 Implement the `Pose_Confidence_Validator`
    - Reject landmarks below the per-landmark threshold; gate overall pose confidence and emit
      `LOW_CONFIDENCE` before biomechanics; read thresholds from config; operate additively
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5_

  - [x] 5.2 Write property test for pose-confidence filtering
    - **Property 16: Pose-confidence filtering retains exactly above-threshold landmarks**
    - **Validates: Requirements 21.2, 21.4**

  - [x] 5.3 Implement the `Landmark_Validation_Service`
    - Reject anatomically impossible poses (impossible bone length, crossed bones, impossible limb
      orientation) and implausible frame-to-frame jumps; return a `Structured_Error` naming the cause;
      read thresholds from config
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5_

  - [x] 5.4 Write property test for landmark validation
    - **Property 17: Landmark validation rejects implausible poses and transitions**
    - **Validates: Requirements 26.1, 26.2, 26.3**

  - [x] 5.5 Implement the `Smoothing_Adapter` with a replaceable algorithm registry
    - Define the `SmoothingAlgorithm` ABC and registry (one_euro/kalman/savitzky_golay/moving_average);
      select from config; preserve input structure and length; operate additively before biomechanics
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5_

  - [x] 5.6 Write property test for adapter contract conformance
    - **Property 10: Any registered pose engine and smoothing algorithm yields a downstream-valid landmark contract**
    - **Validates: Requirements 7.3, 25.2, 25.3**

- [x] 6. Implement the movement timeline, phases, rep counting, and biomechanics
  - [x] 6.1 Implement the `Movement_Timeline_Service`
    - Construct a timestamp-ordered timeline with joint positions, angles, velocity, acceleration, and
      direction per entry; compute velocity/acceleration from inter-frame timestamps
    - _Requirements: 8.1, 8.2, 8.4_

  - [x] 6.2 Write property test for the movement timeline
    - **Property 11: Movement timeline is ordered, complete, and derivative-consistent**
    - **Validates: Requirements 8.1, 8.2, 8.4**

  - [x] 6.3 Implement the `Movement_Phase_Service`
    - Segment the timeline into generic phases {Start, Eccentric, Bottom, Concentric, Top} with
      start/end timestamps, ordered and non-overlapping; expose them through a plugin-consumable
      interface; exclude per-exercise logic
    - _Requirements: 8.3, 24.1, 24.2, 24.3, 24.4_

  - [x] 6.4 Write property test for movement phases
    - **Property 15: Movement phases are generic, labeled, and time-bounded**
    - **Validates: Requirements 8.3, 24.1, 24.4**

  - [x] 6.5 Implement the `Rep_Counting_Service`
    - Detect repetitions from the timeline using generic movement cycles only; produce a
      `Repetition_Summary` (count, phase timestamps, average duration, consistency); read params from config
    - _Requirements: 23.1, 23.2, 23.3, 23.4_

  - [x] 6.6 Write property test for repetition counting
    - **Property 14: Repetition summary is timeline-derived and well-formed**
    - **Validates: Requirements 23.1, 23.2, 23.3, 23.4**

  - [x] 6.7 Implement the `Biomechanics_Service`
    - Compute joint angles, bar path, depth, range of motion, tempo, symmetry, center of mass, and
      balance using deterministic math only (reuse `pose.py` `calc_angle` / COCO-17 indices); exclude LLM inference
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 6.8 Write property test for biomechanics
    - **Property 12: Biomechanics computation is deterministic and complete**
    - **Validates: Requirements 9.1, 9.3, 9.4**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement confidence fusion, reasoning, and feedback generation
  - [x] 8.1 Implement the `Confidence_Fusion_Service`
    - Combine the six per-stage confidence sources into a bounded [0,1] overall score using
      config-driven weights capped by `FUSION_MAX_SINGLE_WEIGHT` so no single source dominates
    - _Requirements: 27.1, 27.2, 27.3, 27.4_

  - [x] 8.2 Write property test for confidence fusion
    - **Property 18: Confidence fusion is bounded and no single source dominates**
    - **Validates: Requirements 27.1, 27.2, 27.3**

  - [x] 8.3 Implement the `Reasoning_Service`
    - Accept only the `Movement_Timeline` and `Objective_Metrics`; exclude raw video/frames; run after
      biomechanics; mark low-confidence output and emit `LOW_CONFIDENCE` when overall confidence is below threshold
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 15.5_

  - [x] 8.4 Implement the `Feedback_Service`
    - Produce the full `Analysis_Result` (overall/movement/ROM/tempo/stability/symmetry/joint alignment
      scores plus strengths/mistakes/corrections/safety warnings/improvement tips/training advice);
      derive every field from metrics/timeline/reasoning; include a low-confidence statement when flagged;
      no validated quality scoring in V1
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 17.1_

  - [x] 8.5 Write property test for feedback generation
    - **Property 13: Feedback result is structurally complete with confidence flagging**
    - **Validates: Requirements 10.4, 11.1, 11.2, 11.4, 17.1**

- [x] 9. Implement cleanup, privacy enforcement, and structured error handling
  - [x] 9.1 Implement the `Cleanup_Service`
    - Track the per-job transient artifact set; delete every artifact on success and failure via a
      `try/finally` guarantee; report the set of deleted locations
    - _Requirements: 1.1, 1.5, 12.1, 12.2, 12.3, 12.4_

  - [x] 9.2 Write property test for cleanup
    - **Property 3: Cleanup removes every artifact on every termination path**
    - **Validates: Requirements 1.1, 1.5, 12.1, 12.2, 12.3, 12.4**

  - [x] 9.3 Implement the supported error-code set and sanitization helper
    - Define the canonical supported error-code constant (the ten codes from Req 15.2) and a helper
      that surfaces only `code` + `message` (no stack/internal detail) across the stage boundary
    - _Requirements: 15.1, 15.2, 15.6_

  - [x] 9.4 Write property test for error-code mapping
    - **Property 19: Condition-to-error-code mapping with well-formed structured errors**
    - **Validates: Requirements 4.5, 6.3, 7.6, 15.1, 15.3, 15.4, 15.5, 15.6, 21.3, 26.4**

  - [x] 9.5 Write property test for downstream transmission privacy
    - **Property 2: Downstream transmission excludes raw video and frames** (spy on reasoning input,
      progress events, and analytics metrics)
    - **Validates: Requirements 1.3, 1.4, 3.7, 10.2, 10.3, 20.6, 30.2, 30.3, 31.4**

- [x] 10. Implement the asynchronous job queue and progress service
  - [x] 10.1 Implement the job and progress models
    - Implement `JobState` enum, `PROGRESS_LABELS` mapping, `ProgressEvent`, and `AnalysisJob`
      (excluding raw video/frames/pose from every event)
    - _Requirements: 19.3, 19.5, 20.3, 20.6_

  - [x] 10.2 Implement the `Job_Queue_Adapter` interface and swappable backends
    - Define the `JobQueueAdapter` ABC (enqueue/get/set_state/set_result/set_error) and backends
      (bullmq/redis/rabbitmq/sqs stubs) selected by config; enqueue returns a `Job_Id` with state `queued`
    - _Requirements: 19.1, 19.4, 19.7, 31.3_

  - [x] 10.3 Write property test for the queue adapter
    - **Property 23: Queue adapter round-trip preserves job identity and state**
    - **Validates: Requirements 19.7**

  - [x] 10.4 Implement the `Progress_Service` with a replaceable transport
    - Define the `ProgressTransport` ABC (publish/latest) with poll/push/both transports selected by
      config; publish events independently of analytical logic and return the latest event per job
    - _Requirements: 20.1, 20.2, 20.4, 20.5_

  - [x] 10.5 Write property test for the progress service
    - **Property 24: Progress label mapping and latest-event recency**
    - **Validates: Requirements 20.1, 20.3, 20.4, 20.5**

  - [x] 10.6 Write property test for the job lifecycle
    - **Property 22: Job lifecycle — valid states, terminal outcomes, and query round-trip**
    - **Validates: Requirements 16.4, 18.2, 19.1, 19.3, 19.4, 19.5, 19.6, 19.8**

- [x] 11. Implement the pipeline orchestrator and background worker
  - [x] 11.1 Implement the `Analysis_Pipeline` orchestrator
    - Execute stages in the canonical order with camera guidance / confidence validation / landmark
      validation / smoothing / phases / reps woven in; emit progress events at stage start/finish; on
      any `Structured_Error` halt analytical stages, run cleanup, and surface the sanitized error
    - _Requirements: 16.1, 16.2, 18.1, 18.2, 18.3, 31.1_

  - [x] 11.2 Write property test for pipeline ordering and error halting
    - **Property 21: Pipeline executes stages in canonical order, stopping on error**
    - **Validates: Requirements 3.1, 8.3, 10.1, 18.1, 18.3, 19.2, 21.3, 22.1, 25.1, 25.4**

  - [x] 11.3 Implement the `Background_Worker`
    - Dequeue jobs via the `Job_Queue_Adapter`, run the orchestrator outside the request cycle, set
      `Job_State` per stage, terminate in `completed` with the result or `failed` with the error
    - _Requirements: 19.2, 19.5, 19.6, 19.8, 31.3_

  - [x] 11.4 Write property test for sync/async equivalence
    - **Property 26: Synchronous and asynchronous orchestration are equivalent**
    - **Validates: Requirements 31.3**

- [x] 12. Implement the plugin registry, versioning, and analytics
  - [x] 12.1 Implement the `Exercise_Plugin` interface and `Exercise_Plugin_Registry`
    - Define the `ExercisePlugin` ABC (rom/phases/joint importance/thresholds/coaching/safety, empty in
      V1) and a registry keyed by exercise id under an `Exercises/` namespace; no per-exercise logic
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 17.2, 17.3, 17.4_

  - [x] 12.2 Write property test for the plugin registry
    - **Property 25: Exercise plugin registry round-trip**
    - **Validates: Requirements 28.1, 28.2, 28.4, 28.5**

  - [x] 12.3 Add the `Analysis_Versioning` metadata fields
    - Add `analysisVersion`, `poseEngineVersion`, `visionModelVersion`, `reasoningModelVersion`, and
      `pipelineVersion` to the `Analysis_Result` additively while preserving the privacy exclusions
    - _Requirements: 29.1, 29.2, 29.3_

  - [x] 12.4 Implement the `Analytics_Service`
    - Collect anonymous aggregate metrics (avg processing time, failure rate, top exercises, avg
      confidence, low-confidence frequency, duration, cleanup-failure count, queue wait) behind a
      replaceable interface; exclude video/frames/pose and any user-identifying info
    - _Requirements: 30.1, 30.2, 30.3, 30.4_

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Expose the AI service FastAPI router
  - [x] 14.1 Implement the exercise-analysis router
    - Add `app/routers/exercise_analysis.py` with `POST /exercise-analysis/submit` (enqueue → return
      `job_id`), `GET /exercise-analysis/status/{job_id}` (state + progress), and
      `GET /exercise-analysis/result/{job_id}`; register it in `app/main.py`
    - _Requirements: 18.2, 19.1, 19.8, 20.4_

  - [x] 14.2 Write integration tests for the router endpoints
    - Submit a stubbed job, poll status through states, and retrieve the result (stages/queue mocked)
    - _Requirements: 18.1, 18.2, 19.1, 19.8_

- [x] 15. Integrate with the Node/Express backend
  - [x] 15.1 Add `aiClient.js` analysis methods
    - Add `submitAnalysis(videoUrl, exerciseHint)`, `getAnalysisStatus(jobId)`, and
      `getAnalysisResult(jobId)` following the existing axios pattern
    - _Requirements: 19.1, 19.8, 31.2_

  - [x] 15.2 Add the bounded `AnalysisResult` Mongoose schema
    - Create the schema with `userId` association and version metadata; explicitly exclude
      `videoUrl`, frames, and pose images from the persisted record
    - _Requirements: 13.1, 13.2, 13.4, 29.1, 29.3_

  - [x] 15.3 Implement the `analysisController`
    - Add `submit`, `status`, `result`, and `correction` handlers that call `aiClient`, persist the
      bounded result with `userId`, store user corrections, and map AI errors to `code` + `message` only
    - _Requirements: 13.3, 15.6, 18.2, 18.3_

  - [x] 15.4 Wire the analysis routes
    - Register `POST /api/ai/analysis/submit`, `GET /api/ai/analysis/status/:jobId`,
      `GET /api/ai/analysis/result/:jobId`, and `POST /api/ai/analysis/:id/correction`
    - _Requirements: 18.2, 19.8_

  - [x] 15.5 Write property test for the persisted record boundary (fast-check)
    - **Property 1: Bounded persisted record excludes raw artifacts** (key set ⊆ permitted fields;
      no video/frame/pose/temp data) plus the correction round-trip
    - **Validates: Requirements 1.2, 1.6, 13.1, 13.2, 13.3, 13.4, 29.1, 29.3**

  - [x] 15.6 Write integration tests for persistence and corrections
    - Persist a result and round-trip a correction against an in-memory MongoDB
    - _Requirements: 13.3, 13.4_

- [x] 16. Present results on the frontend
  - [x] 16.1 Implement submission, progress polling, and result components
    - Submit a recorded video, poll status/progress for the human-readable labels, and render the
      Requirement 11 `Analysis_Result` fields; support submitting a correction
    - _Requirements: 18.4, 20.3, 20.4_

  - [x] 16.2 Write component test for result rendering
    - Assert all Requirement 11 score and feedback fields and the progress labels render
    - _Requirements: 11.1, 11.2, 18.4, 20.3_

- [x] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core
  implementation tasks are never optional.
- Each task references specific granular requirements for traceability.
- Property tests validate the 26 universal correctness properties; unit and integration tests cover
  examples, architectural conformance, config-driven selection, and infrastructure wiring.
- External services (pose engines, queue backends, LLM reasoning, MongoDB) are mocked/stubbed in
  property tests so the tests exercise our logic, not third-party behavior.
- Checkpoints (tasks 3, 7, 13, 17) provide incremental validation points.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.4", "2.1", "2.3", "2.5", "2.7", "4.1", "4.3", "4.5", "5.1", "5.3", "5.5", "6.1", "6.7", "8.1", "8.3", "9.1", "9.3", "10.1", "10.2", "10.4", "12.1", "12.3", "12.4", "15.1", "15.2", "16.1"] },
    { "id": 3, "tasks": ["2.2", "2.4", "2.6", "2.8", "4.2", "4.4", "4.6", "5.2", "5.4", "5.6", "6.2", "6.3", "6.5", "6.8", "8.2", "8.4", "9.2", "9.4", "9.5", "10.3", "10.5", "10.6", "12.2", "15.3", "16.2"] },
    { "id": 4, "tasks": ["6.4", "6.6", "8.5", "11.1", "15.4", "15.5"] },
    { "id": 5, "tasks": ["11.2", "11.3", "14.1", "15.6"] },
    { "id": 6, "tasks": ["11.4", "14.2"] }
  ]
}
```

## Version 2 (Production Extensions) Tasks

### Overview (Version 2)

This section extends the Version 1 plan **strictly additively**. Every Version 1 task (1–17) and the
Version 1 Task Dependency Graph above remain unchanged. All Version 2 work lives in new packages and
new files — the new `ai-service/app/analysis_v2/` package (mirroring the V1 `analysis/` + `vision/`
ABC + registry + config-driven conventions), new `Frontend/src/recording/` and `Frontend/src/upload/`
modules, and new `Backend/` controllers/services — plus **optional additive** fields on the existing
`AnalysisResult`. No existing V1 file, API, data contract, adapter, or `PipelineStage` interface is
modified (Req 52.1–52.4, 52.7).

Conventions (carried over from V1):
- Pre-pipeline gates implement the existing `PipelineStage[TIn, TOut]` interface and return
  `StageResult(success=False, error=StructuredError(...))` on domain failure; they never raise.
- Cross-cutting wrappers (caches, retry, GPU recovery, secure storage) **fail open** to exact V1
  behavior so the unchanged pipeline still runs.
- Property tests run a minimum of 100 iterations (Hypothesis in `ai-service`, fast-check in
  `Backend`/`Frontend`) and are tagged
  `# Feature: ai-exercise-analysis, Property {n}: {property_text}` (Python) /
  `// Feature: ai-exercise-analysis, Property {n}: {property_text}` (TS).
- External services (encoder, network, pose engines, LLMs, GPU/worker processes, encryption backend,
  device storage) are mocked/stubbed so each test exercises our logic.

## Tasks (Version 2)

- [x] 18. Set up the `analysis_v2` package, V2 data contracts, and configuration
  - [x] 18.1 Create the `analysis_v2` package skeleton
    - Create `ai-service/app/analysis_v2/__init__.py` and the `gates/`, `resilience/`, `caching/`,
      `telemetry/`, `registries/`, `storage/`, `feedback_ext/`, and `multicamera/` subpackages, each
      with `__init__.py`; reuse (import, do not modify) the V1 `PipelineStage`, `StageResult`, and
      `StructuredError` from `app/analysis/base.py`
    - _Requirements: 52.1, 52.6_

  - [x] 18.2 Define the V2 Pydantic data contracts in `models_v2.py`
    - Implement `CompressionMetadata`, `UploadChunk`, `CostRecord`, `BenchmarkSample`,
      `ReviewStatus` (enum), `ScoreExplanation`, `DeviceCapabilityProfile`, `OfflineQueueState`
      (enum), `CameraAngle` (enum), `MultiCameraInput`, and the `MultiCameraInterface` ABC
      declaration; enforce bounded confidences in [0.0, 1.0], `ScoreExplanation` factor weights in
      [0,100], and exclude any user/video/frame/pose fields from `CostRecord` and `BenchmarkSample`
    - _Requirements: 32.7, 33.1, 33.2, 40.1, 40.2, 40.4, 41.2, 41.6, 42.5, 48.1, 45.3, 49.2, 50.1_

  - [x] 18.3 Add the V2 configuration in `config_v2.py`
    - Add all V2 settings additively (compression, chunk upload, duplicate/abuse thresholds,
      recording assistant, retry policy, GPU recovery, cache sizes, review threshold, active model
      selection, offline queue, admin intervals, secure-delete bounds) with the documented safe
      defaults; do not change any existing `app/core/config.py` key; update `.env.example` additively
    - _Requirements: 32.3, 33.1, 34.2, 35.5, 36.3, 37.8, 38.1, 39.1, 42.3, 43.4, 45.6, 46.1, 47.5, 51.5_

  - [x] 18.4 Add the additive optional `AnalysisResult` fields (privacy-preserving)
    - Add optional `review_status: ReviewStatus | None = None` and
      `score_explanations: list[ScoreExplanation] = []` to the existing `AnalysisResult`; ensure the
      absence of these fields yields the exact V1 serialized shape and that no video/frame/pose data
      is introduced
    - _Requirements: 42.1, 49.1, 52.3, 52.5_

  - [x] 18.5 Write unit tests for the V2 contracts and additive fields
    - Assert V2 contract serialization round-trips, enum membership, and that an `AnalysisResult`
      without V2 fields serializes identically to the V1 schema
    - _Requirements: 52.3, 52.6, 52.7_

- [x] 19. Implement the pre-pipeline gates (Duplicate Detection + Abuse Protection)
  - [x] 19.1 Implement the `Duplicate_Detection_Service` and `DuplicateStore` interface
    - Add `analysis_v2/gates/duplicate_detection.py` implementing the `PipelineStage` gate that
      computes a local SHA256 `Video_Hash`, looks up a prior result by
      `(user_id, video_hash, pipeline_version)` via a replaceable `DuplicateStore`, returns a
      `DuplicateDecision` with the cached result on hit (skip AI stages, within 2s) and runs normally
      on miss; on hash failure or store unavailability it bypasses and records a bypass indication
    - _Requirements: 34.1, 34.2, 34.3, 34.4, 34.5, 34.6, 34.7_

  - [x] 19.2 Write property test for video hashing
    - **Property 36: Video hashing is deterministic and content-discriminating**
    - **Validates: Requirements 34.1**

  - [x] 19.3 Write property test for the duplicate decision
    - **Property 37: Duplicate decision returns cached result on exact-triple match and runs otherwise**
    - **Validates: Requirements 34.2, 34.3, 34.4**

  - [x] 19.4 Write property test for graceful duplicate-check bypass
    - **Property 38: Duplicate detection degrades gracefully**
    - **Validates: Requirements 34.6, 34.7**

  - [x] 19.5 Implement the `Abuse_Protection_Service`
    - Add `analysis_v2/gates/abuse_protection.py` implementing the `PipelineStage` gate that runs
      after duplicate detection and before any V1 AI stage: compute an exercise-content confidence in
      [0,1], pass frames through unchanged at/above the configured threshold, and below threshold (or
      when classification cannot complete) stop subsequent AI stages and return
      `StructuredError(code="NOT_EXERCISE_VIDEO")` naming the originating stage with no `Analysis_Result`
    - _Requirements: 47.1, 47.2, 47.3, 47.4, 47.5, 47.6_

  - [x] 19.6 Write property test for abuse protection
    - **Property 56: Abuse protection gates the AI stages by content classification**
    - **Validates: Requirements 47.1, 47.2, 47.3, 47.6**

- [x] 20. Implement dependency retry and GPU failure recovery
  - [x] 20.1 Implement the `Retry_Manager`
    - Add `analysis_v2/resilience/retry_manager.py` with a `RetryPolicy`, transient/non-transient
      classification, and a `call(dependency, fn, ...)` decorator that retries transient failures
      with exponential backoff + jitter up to the configured max, does not retry non-transient
      failures (returns the originating error), and on exhaustion returns
      `StructuredError(code="RETRY_EXHAUSTED")` naming the dependency; never alters the wrapped
      call's signature or request
    - _Requirements: 36.1, 36.2, 36.3, 36.4, 36.5, 36.6, 36.7_

  - [x] 20.2 Write property test for retry backoff discipline
    - **Property 41: Retry succeeds-or-bounds with disciplined backoff**
    - **Validates: Requirements 36.1, 36.7**

  - [x] 20.3 Write property test for retry exhaustion and non-transient classification
    - **Property 42: Retry exhaustion and non-transient classification are correct and request-preserving**
    - **Validates: Requirements 36.4, 36.6**

  - [x] 20.4 Implement the `Worker_Health_Monitor`
    - Add `analysis_v2/resilience/worker_health.py` tracking per-worker failure counts within the
      configured window, exposing a `healthy`/`unhealthy` status with the recorded failure count,
      marking a worker unhealthy when failures exceed the configured limit, and excluding unhealthy
      workers from assignment
    - _Requirements: 37.5, 37.6, 37.7_

  - [x] 20.5 Write property test for worker health gating
    - **Property 44: Worker health classification gates assignment**
    - **Validates: Requirements 37.5, 37.6, 37.7**

  - [x] 20.6 Implement the `GPU_Recovery_Service`
    - Add `analysis_v2/resilience/gpu_recovery.py` that, on an inference crash, restarts the worker
      up to the configured maximum attempts (default 3), reloads the active model and retries the job
      once per restart, falls back to the configured fallback model on active-model failure, and on
      fallback failure marks the job failed with no partial results and returns
      `StructuredError(code="RECOVERY_EXHAUSTED")`; reads bounds from config with documented defaults;
      uses the `Worker_Health_Monitor` and `Model_Registry`
    - _Requirements: 37.1, 37.2, 37.3, 37.4, 37.8_

  - [x] 20.7 Write property test for GPU recovery escalation
    - **Property 43: GPU recovery escalates within bounds then fails cleanly**
    - **Validates: Requirements 37.1, 37.2, 37.3, 37.4**

- [x] 21. Implement frame and pose caching over a shared volatile LRU
  - [x] 21.1 Implement the shared `VolatileLRU` primitive
    - Add `analysis_v2/caching/lru.py` with a generic memory-only LRU (`get`/`put`/`clear`) that
      evicts the least-recently-used entry at capacity and holds no persistent state
    - _Requirements: 38.5, 39.5_

  - [x] 21.2 Implement the `Frame_Cache`
    - Add `analysis_v2/caching/frame_cache.py` keyed by `(Video_Hash, frame_timestamp)` with a
      `get_or_decode` path: exact-key hit returns the cached frame without decoding, miss decodes and
      stores, store/retrieve failure falls back to decode without interrupting the pipeline, entries
      are volatile-only and cleared after processing
    - _Requirements: 38.1, 38.2, 38.3, 38.4, 38.6_

  - [x] 21.3 Implement the `Pose_Cache`
    - Add `analysis_v2/caching/pose_cache.py` keyed by `(Frame_Hash, pose_engine_version)` with a
      `get_or_extract` path: exact-key hit returns identical landmarks without a `Pose_Engine` call,
      miss extracts and stores, failure falls back to extract, entries are volatile-only, exclude pose
      images from persistent storage, and clear on completion
    - _Requirements: 39.1, 39.2, 39.3, 39.4, 39.6_

  - [x] 21.4 Write property test for cache correctness (both caches)
    - **Property 45: Caches return identical data on hit, recompute on miss, evict LRU, and stay volatile**
    - **Validates: Requirements 38.1, 38.2, 38.3, 38.4, 38.5, 38.6, 39.1, 39.2, 39.3, 39.4, 39.5, 39.6**

- [x] 22. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 23. Implement telemetry (Cost Tracking, Benchmark Builder, Admin Analytics)
  - [x] 23.1 Implement the `Cost_Tracking_Service`
    - Add `analysis_v2/telemetry/cost_tracking.py` that records exactly one anonymous `Cost_Record`
      within 5s of any terminal job state, stores it as aggregate analytics unlinked to any user or
      client result, excludes every cost field from the client `Analysis_Result`, and on failure
      returns the result unmodified plus a failure indication identifying the job
    - _Requirements: 40.1, 40.2, 40.3, 40.4, 40.5_

  - [x] 23.2 Write property test for cost tracking
    - **Property 46: Cost tracking records exactly one complete record and never blocks**
    - **Validates: Requirements 40.1, 40.5**

  - [x] 23.3 Implement the `Benchmark_Dataset_Builder`
    - Add `analysis_v2/telemetry/benchmark_builder.py` that records one fully-populated
      `Benchmark_Sample` per manual correction, rejects incomplete samples with
      `StructuredError(code="BENCHMARK_SAMPLE_INCOMPLETE")` while retaining the correction, exports all
      collected samples as one dataset (empty dataset + no-samples indication when none), and excludes
      the original video from every sample and export
    - _Requirements: 41.1, 41.2, 41.3, 41.4, 41.5, 41.6_

  - [x] 23.4 Write property test for the benchmark builder
    - **Property 47: Benchmark samples are all-or-nothing and exports are faithful**
    - **Validates: Requirements 41.1, 41.2, 41.3, 41.4, 41.5, 41.6**

  - [x] 23.5 Implement the `Admin_Analytics_Service` and admin dashboard backend
    - Add `analysis_v2/telemetry/admin_analytics.py` that aggregates the operational metrics over the
      rolling window with values within their declared ranges (percentages [0,100], counts ≥ 0,
      confidence [0,1]), stores only aggregates excluding user-identifiable information and per-user
      records, and surfaces an unavailable indicator for missing metric values
    - _Requirements: 46.1, 46.5, 46.6, 46.7_

  - [x] 23.6 Write property test for admin metrics bounds and privacy
    - **Property 55: Admin metrics are within declared bounds and contain no user-identifying data**
    - **Validates: Requirements 46.1, 46.5, 46.6**

- [x] 24. Implement the Model Registry and Exercise Version Registry
  - [x] 24.1 Implement the `Model_Registry`
    - Add `analysis_v2/registries/model_registry.py` with the common `RegisteredModel` interface and a
      registry that registers at least MediaPipe, MoveNet, RTMPose, YOLO Pose, and OpenPose, rejects
      non-conforming models with `StructuredError(code="MODEL_INTERFACE_NOT_SATISFIED")`, selects the
      active model by config, and rejects an unregistered configured name with
      `StructuredError(code="MODEL_NOT_REGISTERED")` while retaining the previous active model
    - _Requirements: 43.1, 43.2, 43.3, 43.4, 43.5, 43.6_

  - [x] 24.2 Write property test for the model registry
    - **Property 49: Model registry enforces the interface and selection is round-tripping and fail-safe**
    - **Validates: Requirements 43.2, 43.3, 43.4, 43.5**

  - [x] 24.3 Implement the `Exercise_Version_Registry` over the existing `Exercise_Plugin` interface
    - Add `analysis_v2/registries/exercise_version_registry.py` that registers named
      `Exercise_Variation`s with property inheritance (variation override wins, otherwise inherit from
      base), exposes variations through the **existing** Req 28 `ExercisePlugin` interface unchanged,
      rejects variations referencing a missing base with `EXERCISE_BASE_NOT_FOUND`, and rejects
      duplicate identifiers (without replacement) with `EXERCISE_DUPLICATE_ID`, leaving state unchanged
    - _Requirements: 44.1, 44.2, 44.3, 44.4, 44.5, 44.6_

  - [x] 24.4 Write property test for variation resolution and plugin round-trip
    - **Property 50: Exercise variation property resolution and plugin round-trip**
    - **Validates: Requirements 44.2, 44.3**

  - [x] 24.5 Write property test for variation registration rejections
    - **Property 51: Exercise variation registration rejects missing bases and duplicates without side effects**
    - **Validates: Requirements 44.5, 44.6**

- [x] 25. Implement the Feedback_Service extensions and Multi-Camera interface
  - [x] 25.1 Implement the Human Review Mode hook
    - Add `analysis_v2/feedback_ext/review_mode.py` with `assign_review_status(overall_confidence,
      threshold)` that returns Needs Review when confidence is strictly below threshold and Confident
      otherwise, assigns exactly one status, never represents Needs Review as Confident, and on absent
      or out-of-range threshold returns Needs Review plus an invalid-config indication; invoked
      additively by the existing `Feedback_Service` (no signature change)
    - _Requirements: 42.1, 42.2, 42.3, 42.4, 42.5, 42.6_

  - [x] 25.2 Write property test for review status mapping
    - **Property 48: Review status is a total, fail-safe threshold mapping**
    - **Validates: Requirements 42.1, 42.2, 42.4, 42.5, 42.6**

  - [x] 25.3 Implement the Explainable AI hook
    - Add `analysis_v2/feedback_ext/explainability.py` with `explain_score(factors)` that attaches a
      `Score_Explanation` attributing each score to weighted factors (range of motion, tempo, balance,
      stability, symmetry) each in [0,100] summing to 100; when a required factor is unavailable it
      returns no explanation so the caller omits that score and records a could-not-explain indication;
      invoked additively by the existing `Feedback_Service`
    - _Requirements: 49.1, 49.2, 49.3, 49.4_

  - [x] 25.4 Write property test for score explanations
    - **Property 58: Every reported score is explained with factor weights summing to 100**
    - **Validates: Requirements 49.1, 49.2, 49.3, 49.4**

  - [x] 25.5 Declare the `Multi_Camera_Interface`
    - Add `analysis_v2/multicamera/interface.py` declaring the `MultiCameraInterface` ABC accepting
      Front/Side/Rear angle inputs and a single fusion input, with no implemented behavior; any
      invocation returns `StructuredError(code="MULTI_CAMERA_NOT_IMPLEMENTED")` without touching the
      existing single-camera state; the pipeline routes no input through it
    - _Requirements: 50.1, 50.2, 50.3, 50.4, 50.5_

  - [x] 25.6 Write property test for the multi-camera interface
    - **Property 59: Invoking the multi-camera interface errors without disturbing single-camera state**
    - **Validates: Requirements 50.5**

- [x] 26. Implement secure temporary storage
  - [x] 26.1 Implement the `Secure_Temporary_Storage_Service`
    - Add `analysis_v2/storage/secure_temp_storage.py` that encrypts every `Temporary_Artifact` at
      rest before it is readable, excludes all artifacts from persistent storage, auto-deletes within
      5s of any job termination via secure (unrecoverable) deletion, retries failed deletions up to 3
      times recording `StructuredError(code="SECURE_DELETE_FAILED")` naming the undeleted location, and
      reports the set of deleted locations; cooperates with the V1 `Cleanup_Service` contract additively
    - _Requirements: 51.1, 51.2, 51.3, 51.4, 51.5, 51.6_

  - [x] 26.2 Write property test for the encryption round-trip
    - **Property 60: Secure temporary storage is an encryption round-trip**
    - **Validates: Requirements 51.1**

  - [x] 26.3 Write property test for secure cleanup
    - **Property 61: Secure cleanup is complete, reported, and retried on failure**
    - **Validates: Requirements 51.2, 51.4, 51.5, 51.6**

- [x] 27. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 28. Implement the frontend Video Compression and Chunk Upload services
  - [x] 28.1 Implement the `Video_Compression_Service`
    - Add `Frontend/src/recording/videoCompression.ts` that compresses on-device before upload:
      re-encode sources above 720p to 720p/30fps/H264 without upscaling sources at or below 720p, keep
      the output within the configured target size (5–15MB) and at/above target quality, produce
      `CompressionMetadata` (originalSize, compressedSize, compressionRatio, compressionTime) with
      ratio = compressed/original, and on failure or timeout return `COMPRESSION_FAILED`, retain the
      original unchanged, and signal the original as the upload fallback; never persist the compressed
      video after upload
    - _Requirements: 32.1, 32.2, 32.3, 32.4, 32.5, 32.6, 32.7, 32.8, 32.9_

  - [x] 28.2 Write property test for compression resolution ceiling
    - **Property 27: Compression preserves resolution ceiling without upscaling**
    - **Validates: Requirements 32.2**

  - [x] 28.3 Write property test for successful compression bounds and metadata
    - **Property 28: Successful compression is bounded, sufficient, and metadata-consistent**
    - **Validates: Requirements 32.1, 32.4, 32.5, 32.7, 32.8, 32.9**

  - [x] 28.4 Write property test for compression failure fallback
    - **Property 29: Compression failure falls back to the unchanged original**
    - **Validates: Requirements 32.6**

  - [x] 28.5 Implement the `Chunk_Upload_Service`
    - Add `Frontend/src/upload/chunkUpload.ts` that partitions the file into ordered chunks of the
      configured size (1–50MB, final may be smaller), computes a per-chunk SHA256, marks a chunk
      verified only when the recomputed checksum equals the original, retries a failing chunk up to 3
      times without re-uploading verified chunks, halts and identifies the failed chunk on exhaustion,
      resumes from the first unverified chunk within 24h (expires after), supports pause/resume/cancel
      (cancel discards all chunks and releases storage), reports progress as verified/total, and
      reports complete when all chunks are verified
    - _Requirements: 33.1, 33.2, 33.3, 33.4, 33.5, 33.6, 33.7, 33.8, 33.9, 33.10_

  - [x] 28.6 Write property test for chunk partitioning
    - **Property 30: Chunking is an order-preserving exact partition**
    - **Validates: Requirements 33.1**

  - [x] 28.7 Write property test for chunk verification integrity
    - **Property 31: Chunk verification is a sound integrity round-trip**
    - **Validates: Requirements 33.2, 33.3**

  - [x] 28.8 Write property test for bounded chunk retry
    - **Property 32: Bounded retry never re-sends verified chunks; exhaustion halts and reports**
    - **Validates: Requirements 33.4, 33.5**

  - [x] 28.9 Write property test for resume
    - **Property 33: Resume starts at the first unverified chunk**
    - **Validates: Requirements 33.6**

  - [x] 28.10 Write property test for upload progress and completion
    - **Property 34: Progress equals the verified fraction and completion is exact**
    - **Validates: Requirements 33.9, 33.10**

  - [x] 28.11 Write property test for cancel
    - **Property 35: Cancel discards all chunks and releases storage**
    - **Validates: Requirements 33.8**

- [x] 29. Implement the frontend Recording Assistant, Offline Queue, and Device Capability services
  - [x] 29.1 Implement the `Recording_Assistant_Service`
    - Add `Frontend/src/recording/recordingAssistant.ts` that analyzes the camera preview at the
      configured refresh interval, detects each recording condition (camera too low/high, body
      cropped, feet/head missing, poor lighting, backlight, shake, multiple people, distance
      too close/far, orientation), returns exactly one severity-ordered corrective instruction per
      detected condition (ready with empty list when none), and on preview unavailability/failure
      returns a guidance-unavailable `Structured_Error` that does not block recording
    - _Requirements: 35.1, 35.2, 35.3, 35.4, 35.5, 35.6_

  - [x] 29.2 Write property test for recording guidance bijection
    - **Property 39: Recording guidance is a severity-ordered bijection over detected conditions**
    - **Validates: Requirements 35.2, 35.3, 35.4**

  - [x] 29.3 Write property test for non-blocking preview failure
    - **Property 40: Preview-analysis failure is non-blocking**
    - **Validates: Requirements 35.6**

  - [x] 29.4 Implement the `Offline_Queue_Service`
    - Add `Frontend/src/upload/offlineQueue.ts` that persists recordings locally with state Queued
      when offline, assigns exactly one `Offline_Queue_State` at all times, retains a recording until
      and removes it only after Completed, uploads oldest-first on reconnect (detected ≤30s), reflects
      state changes ≤2s, retries a failing upload up to 5 times then sets Failed (retaining the
      recording and showing an error), and rejects submission (without setting Queued) when local
      storage is unavailable/full
    - _Requirements: 45.1, 45.2, 45.3, 45.4, 45.5, 45.6, 45.7_

  - [x] 29.5 Write property test for offline queue lifecycle
    - **Property 52: Offline queue never loses a recording across its lifecycle**
    - **Validates: Requirements 45.1, 45.3, 45.5**

  - [x] 29.6 Write property test for oldest-first upload ordering
    - **Property 53: Offline queue uploads oldest-first on reconnect**
    - **Validates: Requirements 45.2**

  - [x] 29.7 Write property test for offline upload failure and unavailable storage
    - **Property 54: Offline upload failure and unavailable storage are handled without loss**
    - **Validates: Requirements 45.6, 45.7**

  - [x] 29.8 Implement the `Device_Capability_Service`
    - Add `Frontend/src/recording/deviceCapability.ts` that detects device performance within 2s and
      produces a `DeviceCapabilityProfile` classified into exactly one of high-end/mid-range/low-end,
      where the tier fully determines compression target, resolution, frame sampling rate, and upload
      quality (same tier ⇒ identical settings) monotonically non-decreasing from low-end→mid→high-end,
      and on timeout/failure produces a low-end safe-default profile with a detection-incomplete indication
    - _Requirements: 48.1, 48.2, 48.3, 48.4, 48.5_

  - [x] 29.9 Write property test for device tier determinism
    - **Property 57: Device tier fully and monotonically determines recording settings, with a low-end fail-safe**
    - **Validates: Requirements 48.1, 48.2, 48.3, 48.4, 48.5**

- [x] 30. Integrate the Node/Express backend additively
  - [x] 30.1 Implement the `chunkUploadController`
    - Add `Backend/controllers/chunkUploadController.js` that receives chunks, recomputes and verifies
      each SHA256 (verified iff equal), tracks the verified set, supports resume/cancel, and enforces
      the 24h session window; wire it under a new route without changing existing routes
    - _Requirements: 33.2, 33.3, 33.6, 33.8_

  - [x] 30.2 Implement the `duplicateStore` service
    - Add `Backend/services/duplicateStore.js` with `findByUserHashVersion(userId, videoHash,
      pipelineVersion)` over the existing `AnalysisResult` collection (hash only, never the video)
    - _Requirements: 34.2, 34.7_

  - [x] 30.3 Implement the `adminAnalyticsController`
    - Add `Backend/controllers/adminAnalyticsController.js` with a `requireAdmin` middleware (reusing
      existing auth) that returns aggregate-only metrics to authenticated administrators and denies
      access (no metrics) to non-admins; wire it under a new admin route
    - _Requirements: 46.2, 46.3, 46.4, 46.7_

  - [x] 30.4 Add additive `aiClient.js` methods
    - Add additive methods for duplicate lookup and chunked/compressed submission following the
      existing axios pattern, without modifying the existing `submitAnalysis`/`getAnalysisStatus`/
      `getAnalysisResult` signatures
    - _Requirements: 52.1, 52.2_

  - [x] 30.5 Add the additive Mongoose fields
    - Extend the existing `AnalysisResult` schema with optional `reviewStatus` (enum), `scoreExplanations`,
      `videoHash` (indexed, hash only), and `pipelineVersion`; add separate `costRecords`,
      `benchmarkSamples`, and `adminMetrics` collections that are never joined to the client result;
      change no existing field
    - _Requirements: 42.1, 49.1, 34.2, 52.3, 52.5_

- [x] 31. Wire the Version 2 components into the pipeline additively
  - [x] 31.1 Wire the pre-pipeline gates
    - Add `analysis_v2/pipeline_v2.py` that runs `Duplicate_Detection_Service` then
      `Abuse_Protection_Service` before the first V1 stage: a duplicate hit returns the cached result
      and skips all AI stages; an abuse rejection returns the structured error with no result;
      otherwise it invokes the unchanged V1 pipeline — no V1 stage input/output contract is modified
    - _Requirements: 34.5, 47.4, 52.1_

  - [x] 31.2 Wire the cache/retry/GPU/secure-storage wrappers
    - In `analysis_v2/pipeline_v2.py`, decorate the unchanged V1 calls additively: `Frame_Cache`
      around frame extraction, `Pose_Cache` around pose extraction, `Retry_Manager` around external
      dependency calls, `GPU_Recovery_Service` supervising inference, and `Secure_Temporary_Storage`
      backing the transient working location; every wrapper falls back to exact V1 behavior on failure
    - _Requirements: 36.5, 38.6, 39.4, 51.2, 52.1, 52.4_

  - [x] 31.3 Wire the feedback extensions and model/exercise registries
    - In `analysis_v2/pipeline_v2.py`, after the V1 `Feedback_Service` builds the result, additively
      set `review_status` and attach `score_explanations`, source the active model from the
      `Model_Registry`, expose `Exercise_Version_Registry` variations through the existing
      `Exercise_Plugin` interface, and trigger `Cost_Tracking`/`Benchmark` at terminal/correction —
      without changing the `Feedback_Service` signature
    - _Requirements: 40.1, 42.1, 43.6, 44.3, 49.1, 52.1_

  - [x] 31.4 Write integration tests for additive wiring
    - Assert a duplicate hit skips AI stages, an abuse rejection produces no result, cache/retry
      wrappers fall back to V1 behavior on failure, and the V1 stage interfaces are invoked unchanged
      (gates/caches/queue/models mocked)
    - _Requirements: 52.1, 52.4_

- [x] 32. Verify Version 2 additive compatibility (cross-cutting)
  - [x] 32.1 Write contract/snapshot tests for V1 signature stability
    - Add snapshot/contract tests asserting every V1 `PipelineStage`, adapter, and backend API
      signature is byte-stable after V2 is added, and run the entire existing V1 test suite to confirm
      it remains green
    - _Requirements: 52.1, 52.2, 52.4, 52.7_

  - [x] 32.2 Write property test for additive data-contract preservation
    - **Property 62: Existing data contracts are preserved additively**
    - **Validates: Requirements 52.3, 52.7**

  - [x] 32.3 Write property test for the cross-cutting privacy guarantee
    - **Property 63: The privacy guarantee holds across every V2 component**
    - **Validates: Requirements 40.2, 40.3, 40.4, 41.6, 46.5, 46.6, 51.4, 52.5**

- [x] 33. Final Version 2 checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes (Version 2)

- This section is strictly additive: Version 1 tasks (1–17) and the Version 1 Task Dependency Graph
  are unchanged. Version 2 top-level tasks are numbered 18–33.
- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core
  implementation tasks are never optional.
- Property tests cover the 37 new universal correctness properties (Properties 27–63); each property
  is its own sub-task placed next to the implementation it validates, tagged with the V1 tag format.
- Cross-cutting compatibility (Req 52) is verified by contract/snapshot tests (V1 signatures byte-stable
  and the V1 suite green) plus Properties 62 and 63.
- External services (encoder, network, pose engines, LLMs, GPU/worker processes, encryption backend,
  device storage, MongoDB) are mocked/stubbed so tests exercise our logic, not third-party behavior.
- Checkpoints (tasks 22, 27, 33) provide incremental Version 2 validation points.

## Version 2 Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["18.1"] },
    { "id": 1, "tasks": ["18.2", "18.3"] },
    { "id": 2, "tasks": ["18.4", "19.1", "19.5", "20.1", "20.4", "21.1", "23.1", "23.3", "23.5", "24.1", "24.3", "25.1", "25.3", "25.5", "26.1", "28.1", "28.5", "29.1", "29.4", "29.8", "30.1", "30.2", "30.3", "30.4", "30.5"] },
    { "id": 3, "tasks": ["18.5", "19.2", "19.3", "19.4", "19.6", "20.2", "20.3", "20.5", "20.6", "21.2", "21.3", "23.2", "23.4", "23.6", "24.2", "24.4", "24.5", "25.2", "25.4", "25.6", "26.2", "26.3", "28.2", "28.3", "28.4", "28.6", "28.7", "28.8", "28.9", "28.10", "28.11", "29.2", "29.3", "29.5", "29.6", "29.7", "29.9", "31.1"] },
    { "id": 4, "tasks": ["20.7", "21.4", "31.2"] },
    { "id": 5, "tasks": ["31.3"] },
    { "id": 6, "tasks": ["31.4", "32.1"] },
    { "id": 7, "tasks": ["32.2", "32.3"] }
  ]
}
```
