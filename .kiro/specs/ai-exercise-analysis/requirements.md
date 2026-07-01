# Requirements Document

## Introduction

This document defines the requirements for **Version 1 (Foundation)** of the AI-powered exercise form analysis feature in GetFit. The goal of Version 1 is to deliver a scalable, modular, production-grade pipeline architecture into which future versions can plug exercise-quality scoring, coaching rules, and per-exercise logic **without architectural changes**.

The system ingests a user-recorded workout video, processes it through a sequence of independent, single-responsibility stages (validation, frame extraction, frame quality analysis, key frame selection, exercise detection, pose extraction, movement timeline construction, biomechanics computation, AI reasoning, and feedback generation), and persists only the final analysis result. A privacy guarantee is central: the original video and all intermediate artifacts (frames, pose images, temporary files) are never persisted and are deleted immediately after processing.

Version 1 explicitly excludes actual exercise-quality scoring, coaching rules, and hardcoded per-exercise logic. The Feedback Generator produces a result with the defined output structure but is not required to contain validated coaching judgments in this version. The architecture must, however, be capable of analyzing the following exercises without redesign: Squats, Deadlifts, Bench Press, Shoulder Press, Pull Ups, Push Ups, Lat Pulldown, Rows, Lunges, Bicep Curl, Tricep Pushdown, Leg Press, Leg Extension, Romanian Deadlift, Hip Thrust, and Plank.

The feature spans three existing codebases: the Python FastAPI AI microservice (`ai-service/`), the Node/Express backend (`Backend/`), and the React Native / Expo frontend (`Frontend/`). It reuses the established modular adapter conventions already used by the food-vision pipeline.

## Glossary

- **Analysis_Pipeline**: The end-to-end orchestrator that runs the ordered sequence of processing stages from video input to stored analysis result.
- **Video_Validation_Service**: The component that validates an input video against format, duration, resolution, frame-rate, size, orientation, and corruption constraints.
- **Frame_Extraction_Service**: The component that extracts still frames from a validated video locally, using a configurable sampling strategy.
- **Frame_Quality_Service**: The component that scores extracted frames for visual quality (blur, brightness, contrast, motion blur, camera shake, body visibility, occlusion) and discards frames below configured thresholds.
- **Key_Frame_Selector**: The component that selects a representative subset of high-quality frames, avoiding duplicates and preferring movement transitions.
- **Exercise_Detection_Service**: The component that identifies the exercise type from selected frames and returns a confidence score and ranked alternatives.
- **Pose_Extraction_Service**: The replaceable component that converts frames into normalized body landmarks using a configurable pose engine.
- **Pose_Engine**: A specific, swappable pose-estimation backend (for example MediaPipe, MoveNet, BlazePose, or OpenPose) accessed through the Pose_Extraction_Service.
- **Movement_Timeline_Service**: The component that converts per-frame landmarks into an ordered movement sequence containing joint positions, joint angles, velocity, acceleration, direction, and movement phases.
- **Movement_Timeline**: The time-ordered movement data structure produced by the Movement_Timeline_Service; the source of truth for downstream stages.
- **Biomechanics_Service**: The component that computes objective biomechanical metrics from the Movement_Timeline using deterministic mathematics only.
- **Objective_Metrics**: The set of computed biomechanical values (joint angles, bar path, depth, range of motion, tempo, symmetry, center of mass, balance) produced by the Biomechanics_Service.
- **Reasoning_Service**: The component that uses a large language model to reason over structured Objective_Metrics and the Movement_Timeline.
- **Feedback_Service**: The component that produces the final structured analysis result returned to the user.
- **Cleanup_Service**: The component that deletes all temporary artifacts created during processing.
- **Analysis_Result**: The final structured output persisted to the database and returned to the user.
- **Temporary_Artifact**: Any intermediate data created during processing, including the original video bytes, extracted frames, pose images, and temporary files.
- **Confidence_Score**: A numeric value in the range 0.0 to 1.0 indicating the system's certainty in a detection or analysis output.
- **Pipeline_Stage**: Any one of the independent, single-responsibility processing components listed above.
- **Structured_Error**: A machine-readable error object containing a stable error code, a human-readable message, and the originating Pipeline_Stage.
- **Database**: The MongoDB persistence layer accessed by the Node/Express backend.
- **End_User**: A GetFit application user who records a workout video and receives analysis.
- **Maintainer**: A developer who extends or modifies the system, including adding new Pose_Engines or supported exercises.
- **Job_Queue_Adapter**: The replaceable component that enqueues, dequeues, and tracks background analysis jobs behind a single interface, with interchangeable backends (BullMQ, Redis, RabbitMQ, SQS).
- **Analysis_Job**: A unit of asynchronous work representing one video analysis request processed by background workers.
- **Job_Id**: A unique identifier returned to the End_User immediately after video submission, used to query the status and result of an Analysis_Job.
- **Job_State**: The current lifecycle state of an Analysis_Job, drawn from the defined set: queued, validating, extracting_frames, frame_quality, selecting_keyframes, detecting_exercise, extracting_pose, building_timeline, biomechanics, reasoning, generating_feedback, cleaning_up, completed, failed.
- **Background_Worker**: A process that consumes Analysis_Jobs from the Job_Queue_Adapter and executes the Analysis_Pipeline outside the request/response cycle.
- **Progress_Service**: The component that collects and publishes Progress_Events emitted by Pipeline_Stages, decoupled from stage analytical logic.
- **Progress_Event**: A structured event describing the current Job_State, a human-readable label, and optional completion percentage for an Analysis_Job.
- **Pose_Confidence**: A numeric value in the range 0.0 to 1.0 indicating the reliability of an individual landmark or of the overall pose produced by the Pose_Engine.
- **Pose_Confidence_Validator**: The component that filters individual landmarks by configurable confidence thresholds and evaluates overall pose reliability before biomechanics.
- **Camera_Guidance_Service**: The component that analyzes recording quality before pose extraction and returns actionable guidance describing detected recording problems.
- **Camera_Guidance**: The structured, actionable output produced by the Camera_Guidance_Service describing recording issues and recommended corrections.
- **Rep_Counting_Service**: The component that detects repetitions from the Movement_Timeline using generic movement cycles without exercise-specific rules.
- **Repetition_Summary**: The structured output of the Rep_Counting_Service containing repetition count, phase timestamps, average repetition duration, and movement consistency.
- **Movement_Phase**: A generic, exercise-agnostic segment of a repetition, drawn from the set: Start, Eccentric, Bottom, Concentric, Top.
- **Movement_Phase_Service**: The component that splits movement into generic Movement_Phases and exposes them for future exercise plugins.
- **Smoothing_Adapter**: The replaceable component that reduces landmark noise behind a single interface, with interchangeable algorithms (One Euro Filter, Kalman Filter, Savitzky-Golay, Moving Average).
- **Landmark_Validation_Service**: The component that rejects anatomically impossible poses and implausible frame-to-frame landmark transitions.
- **Confidence_Fusion_Service**: The component that combines multiple per-stage confidence sources into a single calibrated overall Confidence_Score.
- **Exercise_Plugin**: A self-contained module for a single exercise that conforms to a defined plugin interface; in Version 1 only the interface is defined, with no per-exercise logic implemented.
- **Exercise_Plugin_Registry**: The component that discovers and exposes available Exercise_Plugins to the Analysis_Pipeline through a uniform interface.
- **Analysis_Versioning**: The set of version metadata fields persisted alongside each Analysis_Result for debugging and upgrade tracking.
- **Analytics_Service**: The component that collects anonymous, aggregate system metrics without storing video or frames.

## Requirements

### Requirement 1: Video Privacy and Non-Persistence

**User Story:** As an End_User, I want my workout video to never be stored anywhere, so that my personal recordings remain private.

#### Acceptance Criteria

1. THE Analysis_Pipeline SHALL process the original video only in transient memory or in a temporary working location that is removed before the pipeline returns.
2. THE Analysis_Pipeline SHALL exclude the original video bytes from every persisted record in the Database.
3. THE Pose_Extraction_Service SHALL transmit only extracted frames or derived landmark data to any Pose_Engine, and SHALL exclude the original video from such transmission.
4. THE Reasoning_Service SHALL receive only structured Objective_Metrics and Movement_Timeline data as input, and SHALL exclude raw video and raw frames from its input.
5. WHEN the Analysis_Pipeline completes, THE Cleanup_Service SHALL delete every Temporary_Artifact, including extracted frames and pose images.
6. THE Analysis_Pipeline SHALL persist only the Analysis_Result fields defined in Requirement 13 to the Database.

### Requirement 2: Video Validation

**User Story:** As an End_User, I want unsuitable videos to be rejected with clear reasons, so that I know how to record a usable video.

#### Acceptance Criteria

1. WHEN a video is submitted, THE Video_Validation_Service SHALL validate the video container format against a configured list of supported formats.
2. WHEN a video is submitted, THE Video_Validation_Service SHALL validate the video codec against a configured list of supported codecs.
3. WHEN a video is submitted, THE Video_Validation_Service SHALL validate that the video duration is greater than or equal to a configured minimum duration and less than or equal to a configured maximum duration.
4. WHEN a video is submitted, THE Video_Validation_Service SHALL validate that the video resolution, frame rate, and file size are within configured bounds.
5. WHEN a video is submitted, THE Video_Validation_Service SHALL determine the video orientation and record it in the validation output.
6. IF the submitted video is corrupted or cannot be decoded, THEN THE Video_Validation_Service SHALL return a Structured_Error with code `CORRUPTED_VIDEO`.
7. IF the submitted video uses an unsupported codec, THEN THE Video_Validation_Service SHALL return a Structured_Error with code `UNSUPPORTED_CODEC`.
8. IF the submitted video duration is less than the configured minimum, THEN THE Video_Validation_Service SHALL return a Structured_Error with code `VIDEO_TOO_SHORT`.
9. IF the submitted video duration is greater than the configured maximum, THEN THE Video_Validation_Service SHALL return a Structured_Error with code `VIDEO_TOO_LONG`.
10. WHEN validation fails for one or more constraints, THE Video_Validation_Service SHALL return all detected Structured_Errors in a single structured response.
11. WHEN a video passes all validation constraints, THE Video_Validation_Service SHALL return a success result containing the detected video metadata.

### Requirement 3: Frame Extraction

**User Story:** As an End_User, I want frames extracted from my video on the device side before any AI processing, so that my full video is never uploaded to an AI engine.

#### Acceptance Criteria

1. THE Frame_Extraction_Service SHALL extract frames locally before any Pose_Engine or Reasoning_Service invocation.
2. WHERE a sampling strategy of "every frame" is configured, THE Frame_Extraction_Service SHALL extract every frame of the video.
3. WHERE a sampling strategy of "every N frames" is configured, THE Frame_Extraction_Service SHALL extract one frame for every N frames of the video.
4. WHERE a sampling strategy of "every X milliseconds" is configured, THE Frame_Extraction_Service SHALL extract one frame for each X-millisecond interval of the video.
5. WHERE an adaptive sampling strategy is configured, THE Frame_Extraction_Service SHALL vary the extraction interval based on detected movement between frames.
6. THE Frame_Extraction_Service SHALL associate each extracted frame with a timestamp relative to the start of the video.
7. THE Frame_Extraction_Service SHALL exclude the original video from any upload to a Pose_Engine or the Reasoning_Service.

### Requirement 4: Frame Quality Analysis

**User Story:** As an End_User, I want low-quality frames discarded, so that analysis is based on clear images.

#### Acceptance Criteria

1. WHEN frames are received from the Frame_Extraction_Service, THE Frame_Quality_Service SHALL compute blur, brightness, contrast, motion-blur, and camera-shake scores for each frame.
2. WHEN frames are received from the Frame_Extraction_Service, THE Frame_Quality_Service SHALL compute a body-visibility score and an occlusion score for each frame.
3. IF a frame's quality scores fall below configured thresholds, THEN THE Frame_Quality_Service SHALL discard the frame from the set passed to the Key_Frame_Selector.
4. THE Frame_Quality_Service SHALL return the retained frames together with their computed quality scores.
5. IF every extracted frame is discarded for low quality, THEN THE Frame_Quality_Service SHALL return a Structured_Error with code `BODY_NOT_VISIBLE` when the dominant cause is absent body visibility.

### Requirement 5: Key Frame Selection

**User Story:** As an End_User, I want the system to focus on the most representative frames, so that analysis is efficient and accurate.

#### Acceptance Criteria

1. WHEN retained frames are received from the Frame_Quality_Service, THE Key_Frame_Selector SHALL select a subset of frames whose count is less than or equal to a configured maximum.
2. THE Key_Frame_Selector SHALL exclude duplicate or near-duplicate frames from the selected subset.
3. THE Key_Frame_Selector SHALL prefer frames that represent movement transitions over frames that represent static positions.
4. THE Key_Frame_Selector SHALL preserve the chronological order of the selected frames.

### Requirement 6: Exercise Detection

**User Story:** As an End_User, I want the system to identify which exercise I performed, so that the analysis is relevant to my movement.

#### Acceptance Criteria

1. WHEN selected frames are received, THE Exercise_Detection_Service SHALL return a detected exercise identifier and a Confidence_Score.
2. THE Exercise_Detection_Service SHALL return a ranked list of alternative exercise identifiers with their Confidence_Scores.
3. IF the highest Confidence_Score is below a configured threshold, THEN THE Exercise_Detection_Service SHALL return a Structured_Error with code `EXERCISE_NOT_RECOGNIZED`.
4. THE Exercise_Detection_Service SHALL exclude posture-quality judgments from the detection output.

### Requirement 7: Pose Extraction with Replaceable Engine

**User Story:** As a Maintainer, I want pose extraction isolated behind a replaceable interface, so that I can swap pose engines without changing other stages.

#### Acceptance Criteria

1. THE Pose_Extraction_Service SHALL expose a single interface that accepts frames and returns normalized body landmarks.
2. THE Pose_Extraction_Service SHALL select the active Pose_Engine from configuration.
3. WHERE a different supported Pose_Engine is configured, THE Pose_Extraction_Service SHALL produce normalized body landmarks without requiring changes to any other Pipeline_Stage.
4. THE Pose_Extraction_Service SHALL return landmarks in a normalized coordinate space that is independent of the source frame resolution.
5. THE Pose_Extraction_Service SHALL exclude language-model reasoning from its processing.
6. IF more than one person is detected in the frames, THEN THE Pose_Extraction_Service SHALL return a Structured_Error with code `MULTIPLE_PEOPLE`.

### Requirement 8: Movement Timeline Construction

**User Story:** As a Maintainer, I want a single source-of-truth movement sequence, so that downstream stages share consistent motion data.

#### Acceptance Criteria

1. WHEN normalized landmarks are received from the Pose_Extraction_Service, THE Movement_Timeline_Service SHALL construct a Movement_Timeline ordered by frame timestamp.
2. THE Movement_Timeline SHALL contain joint positions, joint angles, joint velocity, joint acceleration, and movement direction for each timeline entry.
3. THE Movement_Timeline_Service SHALL segment the timeline into labeled movement phases.
4. THE Movement_Timeline_Service SHALL compute velocity and acceleration using the timestamps associated with each frame.

### Requirement 9: Biomechanics Computation

**User Story:** As a Maintainer, I want objective metrics computed by deterministic math, so that measurements are reproducible and independent of AI.

#### Acceptance Criteria

1. WHEN a Movement_Timeline is received, THE Biomechanics_Service SHALL compute Objective_Metrics using deterministic mathematical functions only.
2. THE Biomechanics_Service SHALL exclude language-model inference from its computation.
3. THE Biomechanics_Service SHALL compute joint angles, bar path, depth, range of motion, tempo, symmetry, center of mass, and balance as Objective_Metrics.
4. WHEN given the same Movement_Timeline as input, THE Biomechanics_Service SHALL produce identical Objective_Metrics across repeated executions.

### Requirement 10: AI Reasoning Over Structured Data

**User Story:** As an End_User, I want the AI to reason only over objective measurements, so that conclusions are grounded and the raw video stays private.

#### Acceptance Criteria

1. THE Reasoning_Service SHALL execute only after the Biomechanics_Service has produced Objective_Metrics.
2. THE Reasoning_Service SHALL accept the Movement_Timeline and Objective_Metrics as its only analytical inputs.
3. THE Reasoning_Service SHALL exclude raw video and raw frames from its input.
4. WHEN the supporting Objective_Metrics produce a Confidence_Score below a configured threshold, THE Reasoning_Service SHALL mark the affected output as low confidence.

### Requirement 11: Feedback Generation

**User Story:** As an End_User, I want a clear structured analysis result, so that I can understand the output of my recorded lift.

#### Acceptance Criteria

1. WHEN the Reasoning_Service completes, THE Feedback_Service SHALL produce an Analysis_Result containing Overall Score, Movement Score, Range of Motion, Tempo, Stability, Symmetry, and Joint Alignment fields.
2. THE Feedback_Service SHALL produce Strengths, Mistakes, Corrections, Safety Warnings, Improvement Tips, and Training Advice fields in the Analysis_Result.
3. THE Feedback_Service SHALL derive every Analysis_Result field from the Objective_Metrics, Movement_Timeline, or Reasoning_Service output.
4. WHEN any contributing Confidence_Score is below a configured threshold, THE Feedback_Service SHALL include an explicit low-confidence statement in the Analysis_Result.

### Requirement 12: Cleanup Guarantee

**User Story:** As an End_User, I want all temporary data removed after analysis, so that nothing of my video lingers on any system.

#### Acceptance Criteria

1. WHEN the Analysis_Pipeline finishes successfully, THE Cleanup_Service SHALL delete every Temporary_Artifact created during processing.
2. IF any Pipeline_Stage returns a Structured_Error, THEN THE Cleanup_Service SHALL delete every Temporary_Artifact created before the failure.
3. THE Analysis_Pipeline SHALL invoke the Cleanup_Service on every termination path, including success and failure.
4. WHEN the Cleanup_Service completes, THE Cleanup_Service SHALL report the set of artifact locations that were deleted.

### Requirement 13: Data Model and Storage Restriction

**User Story:** As a Maintainer, I want a strictly bounded persisted data model, so that only permitted analysis data is stored.

#### Acceptance Criteria

1. THE Analysis_Pipeline SHALL persist the exercise identifier, the analysis date, the overall score, the feedback content, the movement metrics, and the user corrections to the Database.
2. THE Database SHALL exclude the original video, extracted frames, pose images, and temporary files from every persisted record.
3. WHEN an End_User submits a correction, THE Analysis_Pipeline SHALL store the user correction associated with the corresponding Analysis_Result.
4. THE Analysis_Result SHALL be associated with the identifier of the End_User who submitted the video.

### Requirement 14: Service Modularity and Independent Testability

**User Story:** As a Maintainer, I want each stage as an independent, replaceable service, so that I can test and evolve stages in isolation.

#### Acceptance Criteria

1. THE Analysis_Pipeline SHALL implement each Pipeline_Stage as an independent service with a single responsibility.
2. THE Analysis_Pipeline SHALL define each Pipeline_Stage behind an interface that allows the stage implementation to be replaced without modifying other stages.
3. THE Analysis_Pipeline SHALL pass data between stages using defined structured data contracts.
4. THE Analysis_Pipeline SHALL allow each Pipeline_Stage to be executed and tested in isolation from the other stages.

### Requirement 15: Structured Error Handling

**User Story:** As an End_User, I want descriptive, structured errors, so that I understand why an analysis could not be completed.

#### Acceptance Criteria

1. WHEN a Pipeline_Stage cannot complete its responsibility, THE Pipeline_Stage SHALL return a Structured_Error containing a stable error code, a human-readable message, and the originating Pipeline_Stage.
2. THE Analysis_Pipeline SHALL support the error codes `CORRUPTED_VIDEO`, `UNSUPPORTED_CODEC`, `VIDEO_TOO_SHORT`, `VIDEO_TOO_LONG`, `EXERCISE_NOT_RECOGNIZED`, `MULTIPLE_PEOPLE`, `BODY_NOT_VISIBLE`, `CAMERA_TOO_DARK`, `CAMERA_SHAKING`, and `LOW_CONFIDENCE`.
3. IF the Frame_Quality_Service determines that frame brightness is below the configured minimum across the retained frames, THEN THE Frame_Quality_Service SHALL return a Structured_Error with code `CAMERA_TOO_DARK`.
4. IF the Frame_Quality_Service determines that camera shake exceeds the configured maximum across the retained frames, THEN THE Frame_Quality_Service SHALL return a Structured_Error with code `CAMERA_SHAKING`.
5. IF the overall analysis Confidence_Score is below the configured threshold, THEN THE Reasoning_Service SHALL return a Structured_Error with code `LOW_CONFIDENCE`.
6. WHEN a Structured_Error is returned to the backend, THE Analysis_Pipeline SHALL return the error code and message to the End_User without exposing internal stack details.

### Requirement 16: Performance and Scalability Architecture

**User Story:** As a Maintainer, I want a pipeline designed for parallel execution and reuse, so that the system scales without redesign.

#### Acceptance Criteria

1. THE Analysis_Pipeline SHALL define stage data contracts that permit independent stages to execute in parallel in a future version.
2. THE Analysis_Pipeline SHALL reuse intermediate outputs of a Pipeline_Stage rather than recomputing them in later stages.
3. THE Analysis_Pipeline SHALL process each extracted frame through quality analysis at most once per analysis.
4. WHERE asynchronous processing is configured, THE Analysis_Pipeline SHALL accept a video submission and return a job identifier that the End_User can poll for the Analysis_Result.

### Requirement 17: Version 1 Scope Boundary

**User Story:** As a Maintainer, I want Version 1 limited to the foundation architecture, so that future quality-scoring logic plugs in cleanly.

#### Acceptance Criteria

1. THE Feedback_Service SHALL produce the Analysis_Result structure defined in Requirement 11 without requiring validated exercise-quality scoring logic in Version 1.
2. THE Analysis_Pipeline SHALL exclude hardcoded per-exercise coaching rules from Version 1.
3. THE Analysis_Pipeline SHALL exclude rule-based posture-correction logic from Version 1.
4. THE Analysis_Pipeline SHALL support the addition of exercise-quality scoring for any exercise listed in the Introduction without modifying the interfaces of existing Pipeline_Stages.

### Requirement 18: End-to-End Analysis Submission

**User Story:** As an End_User, I want to record a lift and receive an analysis, so that I can review my recorded workout.

#### Acceptance Criteria

1. WHEN an End_User submits a recorded workout video, THE Analysis_Pipeline SHALL execute the Pipeline_Stages in the order: validation, frame extraction, frame quality analysis, key frame selection, exercise detection, pose extraction, movement timeline construction, biomechanics computation, AI reasoning, feedback generation, and cleanup.
2. WHEN the Analysis_Pipeline completes successfully, THE Analysis_Pipeline SHALL return the Analysis_Result to the End_User.
3. IF any Pipeline_Stage returns a Structured_Error, THEN THE Analysis_Pipeline SHALL stop subsequent analytical stages, run the Cleanup_Service, and return the Structured_Error to the End_User.
4. THE Frontend SHALL present the Analysis_Result fields defined in Requirement 11 to the End_User.

### Requirement 19: Asynchronous Job Queue

**User Story:** As a Maintainer, I want the pipeline execution flow to run asynchronously behind a replaceable queue adapter, so that video analysis scales across background workers without changing any processing stage.

#### Acceptance Criteria

1. WHEN an End_User submits a video, THE Analysis_Pipeline SHALL enqueue an Analysis_Job through the Job_Queue_Adapter and return a Job_Id before any Pipeline_Stage executes.
2. THE Background_Worker SHALL execute the Pipeline_Stages in the order defined in Requirement 18 without modifying any Pipeline_Stage interface.
3. THE Job_Queue_Adapter SHALL represent the state of each Analysis_Job using exactly one Job_State from the set: queued, validating, extracting_frames, frame_quality, selecting_keyframes, detecting_exercise, extracting_pose, building_timeline, biomechanics, reasoning, generating_feedback, cleaning_up, completed, failed.
4. WHEN a Pipeline_Stage begins, THE Background_Worker SHALL set the Job_State to the value corresponding to that stage.
5. WHEN the Analysis_Pipeline completes successfully, THE Background_Worker SHALL set the Job_State to completed.
6. IF a Pipeline_Stage returns a Structured_Error, THEN THE Background_Worker SHALL set the Job_State to failed and associate the Structured_Error with the Analysis_Job.
7. THE Job_Queue_Adapter SHALL expose a single interface that allows the queue backend to be replaced among BullMQ, Redis, RabbitMQ, and SQS without modifying any Pipeline_Stage.
8. WHEN the End_User queries an Analysis_Job using a Job_Id, THE Analysis_Pipeline SHALL return the current Job_State and, where the Job_State is completed, the Analysis_Result.

### Requirement 20: Real-Time Progress Service

**User Story:** As an End_User, I want to see real-time progress while my video is analyzed, so that I understand what the system is doing at each step.

#### Acceptance Criteria

1. WHEN a Pipeline_Stage starts or finishes, THE Pipeline_Stage SHALL emit a Progress_Event to the Progress_Service.
2. THE Progress_Service SHALL publish Progress_Events independently of the analytical logic of each Pipeline_Stage.
3. THE Progress_Service SHALL associate each Progress_Event with a human-readable label drawn from the set: Uploading, Validating, Extracting Frames, Selecting Key Frames, Detecting Exercise, Extracting Pose, Building Timeline, Computing Biomechanics, Generating Feedback, Cleaning Temporary Files, Complete.
4. WHEN the Frontend subscribes to or polls progress for a Job_Id, THE Progress_Service SHALL return the most recent Progress_Event for that Analysis_Job.
5. THE Progress_Service SHALL exclude analytical computation from its responsibility.

### Requirement 21: Pose Confidence Validation

**User Story:** As an End_User, I want unreliable pose data to be rejected before analysis, so that my feedback is not based on inaccurate body tracking.

#### Acceptance Criteria

1. THE Pose_Extraction_Service SHALL associate a Pose_Confidence value with each landmark it returns.
2. IF a landmark's Pose_Confidence is below the configured per-landmark threshold, THEN THE Pose_Confidence_Validator SHALL reject that landmark.
3. IF the overall Pose_Confidence is below the configured overall threshold, THEN THE Pose_Confidence_Validator SHALL return a Structured_Error with code `LOW_CONFIDENCE`.
4. WHEN the overall Pose_Confidence is below the configured overall threshold, THE Analysis_Pipeline SHALL exclude the affected landmarks from the input to the Biomechanics_Service.
5. THE Pose_Confidence_Validator SHALL read its per-landmark and overall thresholds from configuration.

### Requirement 22: Camera Guidance Service

**User Story:** As an End_User, I want actionable guidance about my recording quality before analysis runs, so that I can re-record correctly when my setup is unsuitable.

#### Acceptance Criteria

1. THE Camera_Guidance_Service SHALL execute before the Pose_Extraction_Service.
2. WHEN frames are received, THE Camera_Guidance_Service SHALL detect body cut off, body too small, body too close, incorrect recording angle, poor lighting, excessive camera shake, landscape versus portrait orientation, and presence of multiple people.
3. WHEN one or more recording issues are detected, THE Camera_Guidance_Service SHALL return Camera_Guidance containing an actionable recommendation for each detected issue.
4. WHEN no recording issues are detected, THE Camera_Guidance_Service SHALL return a Camera_Guidance result indicating that the recording is suitable.
5. THE Camera_Guidance_Service SHALL read its detection thresholds from configuration.

### Requirement 23: Rep Counting Service

**User Story:** As an End_User, I want the system to count my repetitions, so that I can review how many reps I performed.

#### Acceptance Criteria

1. THE Rep_Counting_Service SHALL detect repetitions using the Movement_Timeline as its only analytical input.
2. THE Rep_Counting_Service SHALL detect repetitions using generic movement cycles and SHALL exclude exercise-specific rules from its logic.
3. WHEN repetitions are detected, THE Rep_Counting_Service SHALL return a Repetition_Summary containing the repetition count, the phase timestamps for each repetition, the average repetition duration, and a movement-consistency measure.
4. THE Rep_Counting_Service SHALL read its detection parameters from configuration.

### Requirement 24: Movement Phase Detection

**User Story:** As a Maintainer, I want movement split into generic phases, so that future exercise plugins can interpret phases without per-exercise hardcoding in the pipeline.

#### Acceptance Criteria

1. WHEN a Movement_Timeline is received, THE Movement_Phase_Service SHALL segment movement into Movement_Phases drawn from the set: Start, Eccentric, Bottom, Concentric, Top.
2. THE Movement_Phase_Service SHALL produce Movement_Phases using generic movement analysis and SHALL exclude per-exercise hardcoded logic.
3. THE Movement_Phase_Service SHALL expose the produced Movement_Phases through an interface consumable by an Exercise_Plugin.
4. THE Movement_Phase_Service SHALL associate each Movement_Phase with its start timestamp and end timestamp.

### Requirement 25: Temporal Smoothing

**User Story:** As a Maintainer, I want a replaceable smoothing layer for noisy landmarks, so that biomechanics operate on stable data and the smoothing algorithm can be swapped freely.

#### Acceptance Criteria

1. THE Smoothing_Adapter SHALL expose a single interface that accepts raw landmarks and returns smoothed landmarks.
2. THE Smoothing_Adapter SHALL allow the smoothing algorithm to be replaced among One Euro Filter, Kalman Filter, Savitzky-Golay, and Moving Average without modifying any Pipeline_Stage.
3. THE Smoothing_Adapter SHALL select the active smoothing algorithm from configuration.
4. THE Biomechanics_Service SHALL receive only smoothed landmarks produced by the Smoothing_Adapter as its landmark input.

### Requirement 26: Landmark Validation

**User Story:** As an End_User, I want anatomically impossible poses rejected, so that my analysis is not corrupted by tracking errors.

#### Acceptance Criteria

1. WHEN landmarks are received, THE Landmark_Validation_Service SHALL reject poses that contain anatomically impossible joint configurations, including a limb positioned in an impossible orientation relative to connected joints.
2. WHEN landmarks are received, THE Landmark_Validation_Service SHALL reject poses that contain implausible bone lengths or crossed bone segments.
3. IF the displacement of a landmark between consecutive frames exceeds the configured maximum, THEN THE Landmark_Validation_Service SHALL reject the affected pose.
4. WHEN a pose is rejected, THE Landmark_Validation_Service SHALL return a Structured_Error identifying the originating Pipeline_Stage and the rejection cause.
5. THE Landmark_Validation_Service SHALL read its anatomical and frame-to-frame thresholds from configuration.

### Requirement 27: Multi-Source Confidence Fusion

**User Story:** As an End_User, I want one trustworthy overall confidence value, so that I can judge how reliable my analysis is.

#### Acceptance Criteria

1. WHEN per-stage confidence values are available, THE Confidence_Fusion_Service SHALL combine the vision Confidence_Score, the Pose_Confidence, the exercise-detection Confidence_Score, the movement-quality measure, the biomechanics Confidence_Score, and the reasoning Confidence_Score into a single overall Confidence_Score.
2. THE Confidence_Fusion_Service SHALL produce a calibrated overall Confidence_Score in the range 0.0 to 1.0.
3. THE Confidence_Fusion_Service SHALL combine the contributing sources so that no single source determines the overall Confidence_Score on its own.
4. THE Confidence_Fusion_Service SHALL read its source weights from configuration.

### Requirement 28: Exercise Plugin Architecture

**User Story:** As a Maintainer, I want each exercise isolated in its own plugin module behind a defined interface, so that future per-exercise logic plugs in without changing the pipeline.

#### Acceptance Criteria

1. THE Analysis_Pipeline SHALL define an Exercise_Plugin interface that a per-exercise module implements to contribute range-of-motion definitions, Movement_Phases, joint-importance weights, biomechanics thresholds, coaching rules, and safety checks.
2. THE Exercise_Plugin_Registry SHALL discover and expose available Exercise_Plugins to the Analysis_Pipeline through the Exercise_Plugin interface.
3. THE Analysis_Pipeline SHALL allow a new Exercise_Plugin to be added without modifying the interfaces of existing Pipeline_Stages.
4. THE Analysis_Pipeline SHALL define each Exercise_Plugin as a self-contained module scoped to a single exercise.
5. THE Analysis_Pipeline SHALL exclude per-exercise coaching rules and per-exercise biomechanics logic from the Exercise_Plugin implementations in Version 1, defining only the Exercise_Plugin interface.

### Requirement 29: Analysis Versioning

**User Story:** As a Maintainer, I want version metadata stored with each result, so that I can debug and safely upgrade models and the pipeline.

#### Acceptance Criteria

1. WHEN an Analysis_Result is persisted, THE Analysis_Pipeline SHALL store the analysisVersion, poseEngineVersion, visionModelVersion, reasoningModelVersion, and pipelineVersion fields alongside the Analysis_Result.
2. THE Analysis_Versioning fields SHALL be metadata associated with the Analysis_Result and SHALL extend the persisted data model defined in Requirement 13.
3. THE Database SHALL continue to exclude the original video, extracted frames, pose images, and temporary files when Analysis_Versioning fields are stored.

### Requirement 30: Analytics Service

**User Story:** As a Maintainer, I want anonymous aggregate system metrics, so that I can monitor system health without compromising user privacy.

#### Acceptance Criteria

1. THE Analytics_Service SHALL collect average processing time, failure rate, most-analyzed exercises, average overall Confidence_Score, low-confidence occurrence frequency, analysis duration, cleanup-failure count, and queue wait time.
2. THE Analytics_Service SHALL store only aggregate and anonymous metrics.
3. THE Analytics_Service SHALL exclude the original video and extracted frames from every metric it stores.
4. THE Analytics_Service SHALL exclude End_User identifying information from every stored metric.

### Requirement 31: Long-Term Scalability and Model Evolution

**User Story:** As a Maintainer, I want the architecture to scale to very high analysis volume and absorb improved AI models, so that growth and model upgrades do not require redesigning the pipeline.

#### Acceptance Criteria

1. THE Analysis_Pipeline SHALL define stage data contracts that support processing of millions of Analysis_Jobs without altering Pipeline_Stage interfaces.
2. WHERE an improved Pose_Engine, vision model, or reasoning model is configured, THE Analysis_Pipeline SHALL adopt the improved model without modifying the interfaces of existing Pipeline_Stages.
3. THE Analysis_Pipeline SHALL scale background processing by adding Background_Workers without modifying any Pipeline_Stage.

### Requirement 19: Asynchronous Job Queue

**User Story:** As an End_User, I want video submission to return immediately and process in the background, so that I am not blocked while my recorded lift is analyzed.

#### Acceptance Criteria

1. WHEN an End_User submits a video, THE Analysis_Pipeline SHALL enqueue an Analysis_Job through the Job_Queue_Adapter and return a Job_Id without waiting for analysis to complete.
2. THE Analysis_Pipeline SHALL execute every Pipeline_Stage inside a Background_Worker outside the request/response cycle.
3. THE Analysis_Pipeline SHALL preserve the existing logic and interface of every Pipeline_Stage when executed asynchronously.
4. THE Job_Queue_Adapter SHALL expose a single interface for enqueue, dequeue, and status operations that allows the queue backend to be replaced among BullMQ, Redis, RabbitMQ, and SQS without modifying any Pipeline_Stage.
5. THE Analysis_Pipeline SHALL represent the state of an Analysis_Job using exactly the Job_State values `queued`, `validating`, `extracting_frames`, `frame_quality`, `selecting_keyframes`, `detecting_exercise`, `extracting_pose`, `building_timeline`, `biomechanics`, `reasoning`, `generating_feedback`, `cleaning_up`, `completed`, and `failed`.
6. WHEN an End_User queries an Analysis_Job using a Job_Id, THE Analysis_Pipeline SHALL return the current Job_State and, where available, the Analysis_Result.
7. IF a Pipeline_Stage returns a Structured_Error during background execution, THEN THE Analysis_Pipeline SHALL set the Job_State to `failed` and retain the Structured_Error for retrieval by Job_Id.
8. THE Job_Queue_Adapter SHALL introduce asynchronous orchestration additively without altering the existing analytical interfaces, existing backend APIs, or the privacy guarantee defined in Requirement 1.

### Requirement 20: Real-Time Progress Service

**User Story:** As an End_User, I want to see real-time status of each processing step, so that I understand the progress of my analysis.

#### Acceptance Criteria

1. WHEN a Pipeline_Stage begins execution, THE Pipeline_Stage SHALL emit a Progress_Event describing the corresponding Job_State to the Progress_Service.
2. THE Progress_Service SHALL collect Progress_Events independently of, and without modifying, the analytical logic of any Pipeline_Stage.
3. THE Progress_Service SHALL expose, for each Job_State, a human-readable status label drawn from the set: Uploading, Validating, Extracting Frames, Selecting Key Frames, Detecting Exercise, Extracting Pose, Building Timeline, Computing Biomechanics, Generating Feedback, Cleaning Temporary Files, and Complete.
4. THE Progress_Service SHALL expose job progress through a replaceable transport that supports polling, push delivery, or both, selected by configuration.
5. WHEN the Analysis_Job reaches the `completed` Job_State, THE Progress_Service SHALL publish a Progress_Event with the Complete status label.
6. THE Progress_Service SHALL exclude raw video, raw frames, and pose images from every Progress_Event.

### Requirement 21: Pose Confidence Validation

**User Story:** As an End_User, I want unreliable pose data rejected before analysis, so that feedback is not based on inaccurate landmarks.

#### Acceptance Criteria

1. WHEN landmarks are received from the Pose_Engine, THE Pose_Confidence_Validator SHALL read the Pose_Confidence value associated with each landmark.
2. IF a landmark's Pose_Confidence is below the configured per-landmark threshold, THEN THE Pose_Confidence_Validator SHALL reject that landmark from the set passed to downstream stages.
3. IF the overall Pose_Confidence across retained landmarks is below the configured threshold, THEN THE Pose_Confidence_Validator SHALL return a Structured_Error with code `LOW_CONFIDENCE` and SHALL stop the Analysis_Pipeline before the Biomechanics_Service executes.
4. THE Pose_Confidence_Validator SHALL read every confidence threshold from configuration.
5. THE Pose_Confidence_Validator SHALL operate additively between pose extraction and biomechanics without modifying the interface of the Pose_Extraction_Service or the Biomechanics_Service.

### Requirement 22: Camera Guidance Service

**User Story:** As an End_User, I want guidance when my recording setup is poor, so that I can re-record a usable video.

#### Acceptance Criteria

1. THE Camera_Guidance_Service SHALL analyze recording quality before the Pose_Extraction_Service executes.
2. WHEN recording quality is analyzed, THE Camera_Guidance_Service SHALL detect each of the following conditions: body cut off, body too small, body too close, incorrect camera angle, poor lighting, excessive camera shake, landscape versus portrait orientation, and multiple people present.
3. WHEN one or more recording problems are detected, THE Camera_Guidance_Service SHALL return Camera_Guidance containing actionable corrections for each detected problem.
4. THE Camera_Guidance_Service SHALL read every detection threshold from configuration.
5. THE Camera_Guidance_Service SHALL operate as an independent Pipeline_Stage that can be executed and tested in isolation.
6. THE Camera_Guidance_Service SHALL operate additively before pose extraction without modifying the interface of any existing Pipeline_Stage.

### Requirement 23: Repetition Counting

**User Story:** As an End_User, I want my repetitions counted automatically, so that I can review how many reps I performed.

#### Acceptance Criteria

1. WHEN a Movement_Timeline is received, THE Rep_Counting_Service SHALL detect repetitions using generic movement cycles only.
2. THE Rep_Counting_Service SHALL exclude exercise-specific repetition rules from its computation.
3. THE Rep_Counting_Service SHALL produce a Repetition_Summary containing the repetition count, the phase timestamps, the average repetition duration, and a movement-consistency value.
4. THE Rep_Counting_Service SHALL derive the Repetition_Summary from the Movement_Timeline as its only analytical input.

### Requirement 24: Movement Phase Detection

**User Story:** As a Maintainer, I want movement split into generic phases, so that future exercise plugins can refine phases without interface changes.

#### Acceptance Criteria

1. WHEN a Movement_Timeline is received, THE Movement_Phase_Service SHALL segment the movement into the generic Movement_Phases Start, Eccentric, Bottom, Concentric, and Top.
2. THE Movement_Phase_Service SHALL exclude exercise-specific phase logic from Version 1.
3. WHERE an Exercise_Plugin overrides the phase definitions, THE Movement_Phase_Service SHALL apply the plugin-provided phase definitions without changing its own interface.
4. THE Movement_Phase_Service SHALL expose the detected Movement_Phases through a stable interface usable by future Exercise_Plugins.

### Requirement 25: Temporal Smoothing

**User Story:** As a Maintainer, I want a replaceable smoothing layer for noisy landmarks, so that biomechanics operates on stable data without changing adjacent stages.

#### Acceptance Criteria

1. WHEN landmarks are produced by pose extraction, THE Smoothing_Adapter SHALL apply a temporal smoothing filter to the landmarks before the Biomechanics_Service executes.
2. THE Smoothing_Adapter SHALL select the active smoothing algorithm from configuration among One Euro Filter, Kalman Filter, Savitzky-Golay, and Moving Average.
3. WHERE a different supported smoothing algorithm is configured, THE Smoothing_Adapter SHALL produce smoothed landmarks without requiring changes to any other Pipeline_Stage.
4. THE Biomechanics_Service SHALL receive only smoothed landmarks as its landmark input.
5. THE Smoothing_Adapter SHALL operate additively between pose extraction and biomechanics without modifying the interface of the Pose_Extraction_Service or the Biomechanics_Service.

### Requirement 26: Landmark Validation

**User Story:** As an End_User, I want anatomically impossible poses rejected, so that analysis is not based on physically invalid data.

#### Acceptance Criteria

1. WHEN landmarks are received, THE Landmark_Validation_Service SHALL evaluate the landmarks against configured anatomical constraints.
2. IF a pose contains impossible joint lengths, crossed bones, or impossible limb orientation, THEN THE Landmark_Validation_Service SHALL return a Structured_Error identifying the violated constraint.
3. IF the frame-to-frame landmark displacement exceeds the configured implausible-jump threshold, THEN THE Landmark_Validation_Service SHALL return a Structured_Error identifying the implausible transition.
4. THE Landmark_Validation_Service SHALL read every anatomical constraint from configuration.
5. THE Landmark_Validation_Service SHALL exclude exercise-specific logic from its validation.

### Requirement 27: Multi-Source Confidence Fusion

**User Story:** As an End_User, I want a single trustworthy overall confidence value, so that I can judge how much to rely on the analysis.

#### Acceptance Criteria

1. THE Confidence_Fusion_Service SHALL combine the vision confidence, pose confidence, exercise-detection confidence, movement-quality confidence, biomechanics confidence, and reasoning confidence into a single overall Confidence_Score.
2. THE Confidence_Fusion_Service SHALL read the weight applied to each confidence source from configuration.
3. THE Confidence_Fusion_Service SHALL bound the weight of each individual confidence source so that no single source determines the overall Confidence_Score on its own.
4. THE Confidence_Fusion_Service SHALL produce the overall Confidence_Score in the range 0.0 to 1.0.

### Requirement 28: Exercise Plugin Architecture

**User Story:** As a Maintainer, I want each exercise isolated in its own plugin, so that exercises can be added or replaced without touching pipeline stages.

#### Acceptance Criteria

1. THE Exercise_Plugin_Registry SHALL register each Exercise_Plugin under an `Exercises/` namespace keyed by exercise identifier.
2. THE Exercise_Plugin SHALL define a plugin interface capable of describing range-of-motion definitions, movement phases, joint importance, biomechanics thresholds, coaching rules, and safety checks.
3. THE Analysis_Pipeline SHALL define only the Exercise_Plugin interfaces and the Exercise_Plugin_Registry in Version 1, and SHALL exclude per-exercise coaching rules and per-exercise logic from Version 1.
4. WHEN an Exercise_Plugin is added or replaced, THE Exercise_Plugin_Registry SHALL make the plugin available without modifying the interfaces of any existing Pipeline_Stage.
5. THE Exercise_Plugin_Registry SHALL expose registered Exercise_Plugins to the Analysis_Pipeline through a uniform interface.

### Requirement 29: Analysis Versioning

**User Story:** As a Maintainer, I want version metadata stored with each result, so that I can debug and upgrade analyses over time.

#### Acceptance Criteria

1. WHEN an Analysis_Result is persisted, THE Analysis_Pipeline SHALL store the `analysisVersion`, `poseEngineVersion`, `visionModelVersion`, `reasoningModelVersion`, and `pipelineVersion` fields with the Analysis_Result.
2. THE Analysis_Pipeline SHALL add the Analysis_Versioning fields additively to the bounded data model defined in Requirement 13.
3. THE Database SHALL continue to exclude the original video, extracted frames, and pose images from every persisted record when Analysis_Versioning fields are stored.

### Requirement 30: Analytics Service

**User Story:** As a Maintainer, I want anonymous aggregate metrics, so that I can monitor and improve the system without compromising privacy.

#### Acceptance Criteria

1. THE Analytics_Service SHALL collect the average processing time, the failure rate, the most-analyzed exercises, the average overall Confidence_Score, the low-confidence frequency, the analysis duration, the cleanup-failure count, and the queue wait time.
2. THE Analytics_Service SHALL exclude the original video, extracted frames, and pose images from every collected metric.
3. THE Analytics_Service SHALL store only anonymous, aggregate metrics that cannot identify an individual End_User.
4. THE Analytics_Service SHALL read its collection configuration from configuration and SHALL be replaceable behind a single interface without modifying any Pipeline_Stage.

### Requirement 31: Additive Compatibility and Privacy Preservation for Stages 19-30

**User Story:** As a Maintainer, I want every Stage 19 through Stage 30 addition to be strictly additive, so that existing behavior, interfaces, and privacy guarantees remain intact.

#### Acceptance Criteria

1. THE Analysis_Pipeline SHALL introduce the components defined in Requirements 19 through 30 without modifying the interfaces of the Pipeline_Stages defined in Requirements 1 through 18.
2. THE Analysis_Pipeline SHALL preserve every existing backend API contract unchanged when the Stage 19 through Stage 30 components are added.
3. THE Analysis_Pipeline SHALL preserve the execution behavior of every existing Pipeline_Stage when orchestration becomes asynchronous.
4. THE Analysis_Pipeline SHALL preserve the privacy guarantee defined in Requirement 1, such that video, frames, and pose data are never persisted and are deleted immediately after processing, for every component defined in Requirements 19 through 30.
5. THE Analysis_Pipeline SHALL implement each component defined in Requirements 19 through 30 as an independently replaceable, independently unit-testable, configuration-driven service with a single responsibility and a clear interface.
6. THE Analysis_Pipeline SHALL exclude hardcoded exercise-specific logic from every component defined in Requirements 19 through 30 in Version 1.

---

# Version 2 (Production Extensions)

## Introduction (Version 2)

This section defines **Version 2 (Production Extensions)** of the AI-powered exercise form analysis feature. Version 2 is **strictly additive** to Version 1 (Foundation, Requirements 1 through 31): it introduces production-hardening capabilities — on-device video compression, resumable chunked upload, duplicate detection, pre-recording guidance, dependency retry and recovery, GPU failure recovery, frame and pose caching, cost tracking, benchmark dataset building, human review gating, model and exercise-version registries, offline queueing, admin analytics, abuse protection, device-capability adaptation, explainable scoring, multi-camera-ready interfaces, and secure temporary storage.

Version 2 introduces **no breaking changes**. The original Version 1 pipeline, every existing API, every existing data contract, and every existing adapter remain unchanged. All Version 2 components are modular, replaceable, configuration-driven, privacy-first, independently testable, and backwards compatible. The privacy guarantee of Requirement 1 — that the original video and intermediate artifacts are never persisted — is preserved across every Version 2 component. These stages are numbered Stage 31 through Stage 50 in the product roadmap and correspond to Requirements 32 through 52 below.

## Glossary (Version 2 Additions)

- **Video_Compression_Service**: The on-device component that compresses a recorded video before upload using a configurable target resolution, frame rate, codec, bitrate, and target size, while preserving quality sufficient for pose estimation.
- **Compression_Metadata**: The structured record of a compression operation containing originalSize, compressedSize, compressionRatio, and compressionTime.
- **Chunk_Upload_Service**: The component that uploads a video in ordered chunks, supports pause, resume, and cancel, verifies upload integrity, and retries failed chunks.
- **Upload_Chunk**: A contiguous, individually addressable segment of a video upload identified by an index and a SHA256 checksum.
- **Duplicate_Detection_Service**: The component that computes a local content hash of a video and determines whether an equivalent analysis already exists for the same End_User, content hash, and pipeline version.
- **Video_Hash**: A SHA256 digest computed locally over the video content, used for duplicate detection and caching.
- **Recording_Assistant_Service**: The component that provides live, pre-recording guidance by analyzing the camera preview before recording begins.
- **Recording_Guidance**: The structured, actionable live instruction set produced by the Recording_Assistant_Service before recording.
- **Retry_Manager**: The component that wraps calls to external dependencies with configurable retries, exponential backoff, and jitter.
- **External_Dependency**: Any service the Analysis_Pipeline depends on externally, including the vision model, the Pose_Engine, the Reasoning_Service large language model, the Job_Queue_Adapter, and the Database.
- **GPU_Recovery_Service**: The component that detects inference worker crashes and performs automatic recovery, including worker restart, model reload, job retry, and fallback model selection.
- **Worker_Health_Monitor**: The component that monitors Background_Worker health and marks unhealthy workers.
- **Inference_Worker**: A Background_Worker that performs GPU-bound model inference.
- **Frame_Cache**: The component that caches decoded frames keyed by Video_Hash and frame timestamp to avoid repeated decoding.
- **Pose_Cache**: The component that caches extracted pose landmarks keyed by frame hash and Pose_Engine version to avoid repeated pose extraction.
- **Frame_Hash**: A digest identifying a single decoded frame, used as a Pose_Cache key component.
- **Cost_Tracking_Service**: The component that records per-analysis resource and cost telemetry as anonymous analytics, never exposed to the client.
- **Cost_Record**: The structured analytics record containing processing time, GPU memory, VRAM usage, frame count, model used, token count, estimated inference cost, worker identifier, and queue wait time.
- **Benchmark_Dataset_Builder**: The component that records incorrect predictions as future training data without storing the original video.
- **Benchmark_Sample**: A stored record containing an image hash, exercise, prediction, ground truth, confidence, reason, manual correction, and pipeline version.
- **Review_Status**: A status value assigned to an Analysis_Result, drawn from the set Confident and Needs Review.
- **Model_Registry**: The component that exposes multiple interchangeable vision, pose, and reasoning models behind a common interface, selectable by configuration.
- **Registered_Model**: A vision, pose, or reasoning model registered in the Model_Registry that implements the common model interface.
- **Exercise_Version_Registry**: The component that registers multiple named variations of a single exercise and supports inheritance between variations.
- **Exercise_Variation**: A named variation of a base exercise (for example, Powerlifting Squat, Olympic Squat, Front Squat, Hack Squat, Bulgarian Split Squat) registered in the Exercise_Version_Registry.
- **Offline_Queue_Service**: The frontend component that stores recordings locally when network connectivity is unavailable and uploads them automatically when connectivity is restored.
- **Offline_Queue_State**: The lifecycle state of a locally queued recording, drawn from the set Queued, Uploading, Processing, Completed, and Failed.
- **Admin_Analytics_Service**: The component that aggregates operational metrics for administrators without storing user-identifiable information.
- **Admin_Dashboard**: The administrator-facing presentation of aggregated operational metrics.
- **Abuse_Protection_Service**: The component that rejects non-exercise video content before analysis proceeds.
- **Device_Capability_Service**: The frontend component that detects device performance characteristics and adjusts compression, resolution, frame sampling, and upload quality accordingly.
- **Device_Capability_Profile**: The structured assessment of a device's performance tier produced by the Device_Capability_Service.
- **Score_Explanation**: The structured breakdown that attributes a produced score to its weighted contributing factors.
- **Multi_Camera_Interface**: The interface definitions that allow future multi-angle camera fusion to be added without breaking changes; no multi-camera behavior is implemented in this version.
- **Secure_Temporary_Storage_Service**: The component that stores temporary files encrypted at rest, performs automatic cleanup, and securely deletes temporary files.

## Requirements (Version 2)

### Requirement 32: Smart Video Compression (Stage 31)

**User Story:** As an End_User, I want my video compressed on my device before upload, so that I use less bandwidth while preserving enough quality for accurate analysis.

#### Acceptance Criteria

1. WHEN an End_User submits a recorded video, THE Video_Compression_Service SHALL compress the video on the device before any upload begins.
2. WHERE the source video resolution is greater than 720p, THE Video_Compression_Service SHALL re-encode the video to a configured target resolution of 720p, a target frame rate of 30 frames per second, and the H264 codec, AND WHERE the source video resolution is at or below 720p, THE Video_Compression_Service SHALL NOT upscale the resolution.
3. THE Video_Compression_Service SHALL read the target bitrate, target quality, and target output size from configuration, with a configured target size between 5 megabytes and 15 megabytes inclusive.
4. THE Video_Compression_Service SHALL produce a compressed video whose measured quality metric is greater than or equal to the configured target quality value.
5. WHEN compression succeeds, THE Chunk_Upload_Service SHALL upload the compressed video and SHALL exclude the original video from upload.
6. IF compression fails or exceeds the configured maximum compression time, THEN THE Video_Compression_Service SHALL return a Structured_Error with code `COMPRESSION_FAILED`, SHALL retain the original video unchanged, and THE Chunk_Upload_Service SHALL upload the original video as the fallback.
7. WHEN compression completes, THE Video_Compression_Service SHALL record Compression_Metadata containing originalSize, compressedSize, compressionRatio, and compressionTime.
8. WHEN upload completes, THE Video_Compression_Service SHALL exclude every compressed video from permanent storage.
9. WHEN compression succeeds, THE Video_Compression_Service SHALL produce a compressed video whose size does not exceed the configured target output size.

### Requirement 33: Chunked Upload with Resume (Stage 32)

**User Story:** As an End_User, I want my upload to resume after interruption, so that I never have to restart a large upload from the beginning.

#### Acceptance Criteria

1. WHEN a video upload begins, THE Chunk_Upload_Service SHALL divide the video into ordered Upload_Chunks of a configured size between 1 megabyte and 50 megabytes, where the final Upload_Chunk may be smaller than the configured size.
2. THE Chunk_Upload_Service SHALL compute a SHA256 checksum for each Upload_Chunk.
3. WHEN an Upload_Chunk is received, THE Chunk_Upload_Service SHALL mark the Upload_Chunk as verified only if its recomputed SHA256 checksum equals the originally computed checksum.
4. IF an Upload_Chunk fails verification or transfer, THEN THE Chunk_Upload_Service SHALL retry that Upload_Chunk up to 3 times without re-uploading previously verified chunks.
5. IF the retry limit for an Upload_Chunk is exhausted, THEN THE Chunk_Upload_Service SHALL halt the upload, retain every previously verified Upload_Chunk, and return an indication identifying the failed Upload_Chunk.
6. WHEN an upload is interrupted and later resumed within 24 hours, THE Chunk_Upload_Service SHALL resume from the first unverified Upload_Chunk.
7. IF an interrupted upload is resumed after its 24-hour resumability window has expired, THEN THE Chunk_Upload_Service SHALL return an indication that the upload session has expired and SHALL require the upload to begin anew.
8. THE Chunk_Upload_Service SHALL support pause, resume, and cancel operations for an in-progress upload, AND WHEN an upload is cancelled THE Chunk_Upload_Service SHALL discard every uploaded Upload_Chunk and release the associated upload storage.
9. WHILE an upload is in progress, THE Chunk_Upload_Service SHALL report upload progress as the fraction of verified Upload_Chunks over the total Upload_Chunk count, updated after each Upload_Chunk is verified.
10. WHEN all Upload_Chunks are verified, THE Chunk_Upload_Service SHALL report the upload as complete.

### Requirement 34: Duplicate Video Detection (Stage 33)

**User Story:** As an End_User, I want re-submitting the same video to return my previous analysis instantly, so that I do not wait for redundant processing.

#### Acceptance Criteria

1. WHEN a video is submitted, THE Duplicate_Detection_Service SHALL compute a local Video_Hash using SHA256 over the complete byte content of the video file.
2. BEFORE the Analysis_Pipeline executes, THE Duplicate_Detection_Service SHALL check whether an Analysis_Result already exists for which the End_User identifier, the Video_Hash, and the pipeline version are all exactly equal to those of the submitted video.
3. WHEN a matching prior Analysis_Result exists, THE Duplicate_Detection_Service SHALL return the cached Analysis_Result within 2 seconds and SHALL exclude every Analysis_Pipeline AI stage from execution.
4. WHEN no matching prior Analysis_Result exists, THE Duplicate_Detection_Service SHALL allow the Analysis_Pipeline to execute normally with no AI stage excluded.
5. THE Duplicate_Detection_Service SHALL operate additively before the Analysis_Pipeline without modifying the input or output interface of any existing Pipeline_Stage.
6. IF the Video_Hash cannot be computed, THEN THE Duplicate_Detection_Service SHALL allow the Analysis_Pipeline to execute normally and SHALL record an indication that the duplicate check was bypassed.
7. IF the store of prior Analysis_Results is unavailable, THEN THE Duplicate_Detection_Service SHALL allow the Analysis_Pipeline to execute normally and SHALL record an indication that the duplicate check was bypassed.

### Requirement 35: Recording Assistant (Stage 34)

**User Story:** As an End_User, I want live guidance before I start recording, so that I capture a usable video on the first attempt.

#### Acceptance Criteria

1. WHILE the camera preview is active and before recording begins, THE Recording_Assistant_Service SHALL analyze the camera preview at a configured refresh interval and SHALL return updated Recording_Guidance within a configured maximum analysis latency.
2. WHEN the camera preview is analyzed, THE Recording_Assistant_Service SHALL detect camera positioned too low, camera positioned too high, body cropped, feet missing, head missing, poor lighting, backlight, camera shaking, multiple people present, distance too close, distance too far, and portrait versus landscape orientation.
3. WHEN one or more recording conditions are detected, THE Recording_Assistant_Service SHALL return Recording_Guidance containing exactly one corrective instruction for each detected condition that names the detected condition and the adjustment the End_User must make, with instructions ordered by a configured severity ranking.
4. WHEN no adverse recording conditions are detected, THE Recording_Assistant_Service SHALL return Recording_Guidance indicating the setup is ready for recording.
5. THE Recording_Assistant_Service SHALL read every detection threshold, the refresh interval, and the maximum analysis latency from configuration.
6. IF the camera preview frame is unavailable or preview analysis fails, THEN THE Recording_Assistant_Service SHALL return a Structured_Error indicating that guidance is unavailable and SHALL allow the End_User to begin recording without blocking.

### Requirement 36: Retry and Recovery for External Dependencies (Stage 35)

**User Story:** As a Maintainer, I want transient external failures retried automatically, so that the system tolerates intermittent dependency errors.

#### Acceptance Criteria

1. WHEN a call to an External_Dependency fails with a transient failure (a network timeout, a connection failure, or a temporary-unavailability or resource-exhaustion response from the External_Dependency), THE Retry_Manager SHALL retry the call using exponential backoff with jitter until the call succeeds or the configured maximum retry count is reached.
2. THE Retry_Manager SHALL wrap calls to the vision model, the Pose_Engine, the Reasoning_Service large language model, the Job_Queue_Adapter, and the Database.
3. THE Retry_Manager SHALL read the maximum retry count, the initial backoff delay, the backoff multiplier, the maximum backoff delay, and the maximum jitter from configuration, where the maximum retry count is an integer in the range 0 to 10 and each delay and jitter value is expressed in milliseconds within configured bounds.
4. IF the configured maximum retry count is exhausted without a successful call, THEN THE Retry_Manager SHALL stop retrying and return a Structured_Error identifying the failed External_Dependency and indicating retry exhaustion, without altering the request passed to the External_Dependency.
5. THE Retry_Manager SHALL operate additively without modifying the interface of any wrapped External_Dependency.
6. IF a call to an External_Dependency fails with a non-transient failure, THEN THE Retry_Manager SHALL NOT retry the call and SHALL return the originating error identifying the failed External_Dependency.
7. WHEN a retried call to an External_Dependency succeeds before the configured maximum retry count is reached, THE Retry_Manager SHALL return the successful result to the caller.

### Requirement 37: GPU Failure Recovery (Stage 36)

**User Story:** As a Maintainer, I want inference crashes recovered automatically, so that analysis continues without manual intervention.

#### Acceptance Criteria

1. WHEN an Inference_Worker crashes during inference, THE GPU_Recovery_Service SHALL detect the crash within 10 seconds and SHALL restart the Inference_Worker automatically within 30 seconds of detection, up to the configured maximum restart attempts (default 3 attempts).
2. WHEN an Inference_Worker is restarted, THE GPU_Recovery_Service SHALL reload the active model and SHALL retry the affected Analysis_Job exactly once per restart, completing model reload within 60 seconds.
3. IF the active model fails to load or to produce inference within 60 seconds after recovery, THEN THE GPU_Recovery_Service SHALL select the configured fallback model and SHALL retry the affected Analysis_Job using the fallback model.
4. IF the configured fallback model also fails to load or to produce inference within 60 seconds, THEN THE GPU_Recovery_Service SHALL mark the affected Analysis_Job as failed, SHALL return an error response indicating recovery exhaustion, and SHALL preserve the Analysis_Job record without partial results.
5. WHEN an Inference_Worker fails more times than the configured failure limit (default 5 failures within a 5-minute window), THE Worker_Health_Monitor SHALL mark the Inference_Worker as unhealthy.
6. WHILE an Inference_Worker is marked as unhealthy, THE GPU_Recovery_Service SHALL exclude that Inference_Worker from Analysis_Job assignment.
7. THE Worker_Health_Monitor SHALL poll the health of every Inference_Worker at intervals not exceeding 15 seconds and SHALL expose, for each Inference_Worker, a health status of one of healthy or unhealthy together with the recorded failure count.
8. THE GPU_Recovery_Service SHALL read its maximum restart attempts, failure limit, and fallback model selection from configuration, and IF any of these configuration values is absent, THEN THE GPU_Recovery_Service SHALL apply the documented default values (3 restart attempts, 5 failures per 5-minute window).

### Requirement 38: Frame Cache (Stage 37)

**User Story:** As a Maintainer, I want decoded frames cached, so that the system does not decode the same video twice.

#### Acceptance Criteria

1. WHEN frames are decoded, THE Frame_Cache SHALL store the decoded frames keyed by the exact combination of Video_Hash and frame timestamp, up to a configured maximum number of cached frames.
2. WHEN a decoded frame is requested for a Video_Hash and frame timestamp that exactly match a cached key, THE Frame_Cache SHALL return the cached frame and SHALL exclude repeated decoding.
3. WHEN no cached frame exists for the requested Video_Hash and frame timestamp, THE Frame_Cache SHALL allow the Frame_Extraction_Service to decode the frame.
4. THE Frame_Cache SHALL hold cached frames only in volatile memory, SHALL exclude cached frames from persistent storage, and SHALL delete every cached frame immediately after processing completes, remaining within the privacy guarantee defined in Requirement 1.
5. WHEN the Frame_Cache reaches its configured maximum number of cached frames, THE Frame_Cache SHALL evict the least-recently-used cached frame before storing a new frame.
6. IF a Frame_Cache store or retrieve operation fails, THEN THE Frame_Cache SHALL allow the Frame_Extraction_Service to decode the frame without interrupting the Analysis_Pipeline.

### Requirement 39: Pose Cache (Stage 38)

**User Story:** As a Maintainer, I want pose extraction results cached, so that the system reuses landmarks instead of recomputing them.

#### Acceptance Criteria

1. WHEN pose landmarks are extracted, THE Pose_Cache SHALL store the landmarks keyed by the exact combination of Frame_Hash and Pose_Engine version, up to a configured maximum number of cache entries.
2. WHEN landmarks are requested for a Frame_Hash and Pose_Engine version that exactly match a cached key, THE Pose_Cache SHALL return landmarks identical to those stored and SHALL exclude any Pose_Engine invocation.
3. WHEN no cached landmarks exist for the requested Frame_Hash and Pose_Engine version, THE Pose_Cache SHALL allow the Pose_Extraction_Service to extract landmarks and SHALL store the extracted landmarks under that key.
4. IF a Pose_Cache store or retrieve operation fails, THEN THE Pose_Cache SHALL allow the Pose_Extraction_Service to extract landmarks without interrupting the Analysis_Pipeline.
5. WHEN the Pose_Cache reaches its configured maximum number of cache entries, THE Pose_Cache SHALL evict the least-recently-used entry before storing a new entry.
6. THE Pose_Cache SHALL exclude pose images from persistent storage, SHALL delete every cached entry when processing completes, and SHALL remain within the privacy guarantee defined in Requirement 1.

### Requirement 40: AI Cost Tracking (Stage 39)

**User Story:** As a Maintainer, I want per-analysis cost telemetry, so that I can monitor and optimize inference cost without exposing it to users.

#### Acceptance Criteria

1. WHEN an Analysis_Job reaches a terminal state, whether completed successfully or failed, THE Cost_Tracking_Service SHALL record, within 5 seconds of that state being reached, exactly one Cost_Record containing processing time, GPU memory, VRAM usage, frame count, model used, token count, estimated inference cost, worker identifier, and queue wait time.
2. THE Cost_Tracking_Service SHALL store each Cost_Record as anonymous analytics data that excludes any user-identifying information and that is not linked to any user account or Analysis_Result returned to the client.
3. THE Cost_Tracking_Service SHALL exclude every Cost_Record field from the Analysis_Result returned to the client.
4. THE Cost_Tracking_Service SHALL exclude the original video, extracted frames, and pose images from every Cost_Record.
5. IF recording a Cost_Record fails, THEN THE Cost_Tracking_Service SHALL allow the Analysis_Result to be returned to the client without delay or modification and SHALL produce a failure indication identifying the affected Analysis_Job.

### Requirement 41: Benchmark Dataset Builder (Stage 40)

**User Story:** As a Maintainer, I want incorrect predictions captured as training data, so that future models can be improved without storing user videos.

#### Acceptance Criteria

1. WHEN a prediction is identified as incorrect through a manual correction, THE Benchmark_Dataset_Builder SHALL record exactly one Benchmark_Sample that corresponds to that correction.
2. THE Benchmark_Sample SHALL contain an image hash, the exercise, the prediction, the ground truth, a confidence value between 0.0 and 1.0 inclusive, the reason, the manual correction, and the pipeline version, with every one of these fields present and non-empty.
3. IF any required field of a Benchmark_Sample is missing or empty at the time of recording, THEN THE Benchmark_Dataset_Builder SHALL reject the recording, retain the manual correction unchanged, and return an indication that the recording failed due to incomplete sample data.
4. WHEN an export is requested, THE Benchmark_Dataset_Builder SHALL export all currently collected Benchmark_Samples as a single dataset.
5. IF an export is requested while no Benchmark_Samples have been collected, THEN THE Benchmark_Dataset_Builder SHALL produce an empty dataset and return an indication that no samples were available.
6. THE Benchmark_Dataset_Builder SHALL exclude the original video from every Benchmark_Sample and from the exported dataset.

### Requirement 42: Human Review Mode (Stage 41)

**User Story:** As an End_User, I want low-confidence results flagged for review, so that the system does not present uncertain analysis as confident.

#### Acceptance Criteria

1. IF the overall Confidence_Score (a value in the range 0.0 to 1.0) of an Analysis_Result is strictly below the configured review threshold, THEN THE Feedback_Service SHALL set the Review_Status of the Analysis_Result to Needs Review.
2. WHEN the overall Confidence_Score is greater than or equal to the configured review threshold, THE Feedback_Service SHALL set the Review_Status to Confident.
3. THE Feedback_Service SHALL read the review threshold, a value in the range 0.0 to 1.0, from configuration.
4. WHILE the Review_Status is Needs Review, THE Feedback_Service SHALL exclude any representation of the Analysis_Result as Confident or as high confidence.
5. THE Feedback_Service SHALL assign every Analysis_Result exactly one Review_Status drawn from the set Confident and Needs Review.
6. IF the configured review threshold is absent or outside the range 0.0 to 1.0, THEN THE Feedback_Service SHALL set the Review_Status to Needs Review and return an indication that the review threshold configuration is invalid.

### Requirement 43: Model Registry (Stage 42)

**User Story:** As a Maintainer, I want interchangeable vision, pose, and reasoning models, so that I can switch models through configuration only.

#### Acceptance Criteria

1. THE Model_Registry SHALL register at least the following five interchangeable pose and vision models: MediaPipe, MoveNet, RTMPose, YOLO Pose, and OpenPose.
2. THE Model_Registry SHALL require every Registered_Model to implement the common model interface before it is accepted into the registry.
3. IF a model that does not implement the common model interface is submitted for registration, THEN THE Model_Registry SHALL reject the registration, exclude the model from the set of selectable Registered_Models, and return an error indicating the interface was not satisfied.
4. WHEN the Model_Registry initializes, THE Model_Registry SHALL select as the active Registered_Model the model named in the configuration.
5. IF the configuration names a model that is not present in the registry, THEN THE Model_Registry SHALL reject the selection, retain the previously active Registered_Model with no change to its state, and return an error indicating the configured model is unavailable.
6. WHERE a different Registered_Model is configured, THE Analysis_Pipeline SHALL use the selected model without modifying the interface of any existing Pipeline_Stage.

### Requirement 44: Exercise Version Registry (Stage 43)

**User Story:** As a Maintainer, I want multiple variations of a single exercise registered with inheritance, so that exercise variants reuse shared logic.

#### Acceptance Criteria

1. THE Exercise_Version_Registry SHALL register one or more Exercise_Variations of a single base exercise, each identified by a unique identifier, including for the Squat the Powerlifting, Olympic, Front, Hack, and Bulgarian Split variations.
2. WHEN an Exercise_Variation does not define a property, THE Exercise_Version_Registry SHALL resolve that property from the base exercise, and WHEN an Exercise_Variation explicitly defines a property, THE Exercise_Version_Registry SHALL use the variation's own value for that property.
3. THE Exercise_Version_Registry SHALL expose registered Exercise_Variations to the Analysis_Pipeline through the Exercise_Plugin interface defined in Requirement 28.
4. WHEN an Exercise_Variation is added or replaced, THE Exercise_Version_Registry SHALL make the variation available without modifying the interfaces of any existing Pipeline_Stage.
5. IF a registered Exercise_Variation references a base exercise that is not registered, THEN THE Exercise_Version_Registry SHALL reject the registration, return a Structured_Error identifying the missing base exercise, and leave the registry state unchanged.
6. IF an Exercise_Variation is registered with an identifier that already exists and replacement is not requested, THEN THE Exercise_Version_Registry SHALL reject the registration, retain the existing Exercise_Variation unchanged, and return a Structured_Error indicating the duplicate identifier.

### Requirement 45: Offline Queue (Stage 44)

**User Story:** As an End_User, I want my recordings queued when I am offline, so that they upload automatically later and are never lost.

#### Acceptance Criteria

1. IF network connectivity is unavailable when a recording is submitted, THEN THE Offline_Queue_Service SHALL store the recording in local persistent storage and SHALL set its Offline_Queue_State to Queued.
2. WHEN network connectivity is restored, THE Offline_Queue_Service SHALL detect the restored connectivity within 30 seconds and SHALL begin uploading queued recordings in ascending order of their submission timestamp (oldest first).
3. THE Offline_Queue_Service SHALL represent each queued recording using exactly one Offline_Queue_State from the set Queued, Uploading, Processing, Completed, and Failed.
4. WHEN the Offline_Queue_State of a queued recording changes, THE Offline_Queue_Service SHALL update the displayed Offline_Queue_State for that recording to the End_User within 2 seconds of the change.
5. THE Offline_Queue_Service SHALL retain every queued recording in local persistent storage until its Offline_Queue_State reaches Completed, and SHALL remove the recording from local persistent storage only after its Offline_Queue_State reaches Completed.
6. IF an upload attempt for a queued recording fails, THEN THE Offline_Queue_Service SHALL retry the upload up to 5 times, and IF all 5 attempts fail, THEN THE Offline_Queue_Service SHALL set the Offline_Queue_State to Failed, SHALL retain the recording in local persistent storage, and SHALL display an error indication identifying the affected recording to the End_User.
7. IF local persistent storage is unavailable or full when a recording is submitted while offline, THEN THE Offline_Queue_Service SHALL reject the submission, SHALL not set the Offline_Queue_State to Queued, and SHALL display an error indication explaining that the recording could not be queued.

### Requirement 46: Admin Analytics Dashboard (Stage 45)

**User Story:** As a Maintainer, I want aggregated operational metrics, so that I can monitor system health without accessing user-identifiable data.

#### Acceptance Criteria

1. THE Admin_Analytics_Service SHALL collect the following metrics at a recurring interval not exceeding 60 seconds, each computed over a rolling aggregation window of 5 minutes: the average processing time in milliseconds, the average overall Confidence_Score as a value from 0.0 to 1.0, the queue length as a count of 0 or greater, the worker utilization as a percentage from 0 to 100, the GPU utilization as a percentage from 0 to 100, the failure rate as a percentage from 0 to 100, the exercise popularity as a count per exercise type, the camera-issue frequency as a count of 0 or greater, the retry count as a count of 0 or greater, and the model usage as a count per model identifier.
2. WHEN an authenticated administrator requests the Admin_Dashboard, THE Admin_Dashboard SHALL present every collected metric from Criterion 1 within 3 seconds of the request.
3. WHILE the Admin_Dashboard is open for an authenticated administrator, THE Admin_Dashboard SHALL refresh the presented metrics at an interval not exceeding 60 seconds.
4. IF a requester of the Admin_Dashboard is not an authenticated administrator, THEN THE Admin_Dashboard SHALL deny access and present no metrics.
5. THE Admin_Analytics_Service SHALL exclude user-identifiable information from every collected metric.
6. THE Admin_Analytics_Service SHALL store only aggregate metrics and SHALL NOT store per-user records.
7. IF a metric value is unavailable for the current aggregation window, THEN THE Admin_Dashboard SHALL present an indicator that the metric value is unavailable while continuing to present all available metrics.

### Requirement 47: Abuse Protection (Stage 46)

**User Story:** As a Maintainer, I want non-exercise videos rejected, so that the pipeline only processes genuine workout recordings.

#### Acceptance Criteria

1. WHEN a video is submitted, THE Abuse_Protection_Service SHALL compute an exercise-content Confidence_Score in the range 0.0 to 1.0 and classify whether the video content is a genuine exercise recording before any Analysis_Pipeline AI stage executes.
2. IF the computed exercise-content Confidence_Score is below the configured classification threshold, including content such as a movie, television content, gaming content, a pet, a landscape, a car, an empty room, multiple unrelated people, a cartoon, or any other non-exercise content, THEN THE Abuse_Protection_Service SHALL stop the subsequent Analysis_Pipeline AI stages and return a Structured_Error with code `NOT_EXERCISE_VIDEO` that identifies the originating Pipeline_Stage, without producing any Analysis_Result.
3. WHEN the computed exercise-content Confidence_Score is greater than or equal to the configured classification threshold, THE Abuse_Protection_Service SHALL allow the Analysis_Pipeline to proceed to the next Pipeline_Stage.
4. THE Abuse_Protection_Service SHALL operate additively without modifying the interface of any existing Pipeline_Stage.
5. THE Abuse_Protection_Service SHALL read its classification threshold from configuration.
6. IF the Abuse_Protection_Service cannot complete classification of the submitted video, THEN THE Abuse_Protection_Service SHALL stop the subsequent Analysis_Pipeline AI stages and return a Structured_Error identifying the originating Pipeline_Stage and the failure cause, without producing any Analysis_Result.

### Requirement 48: Device Capability Detection (Stage 47)

**User Story:** As an End_User, I want the app to adapt to my device, so that processing matches my device's performance.

#### Acceptance Criteria

1. WHEN the application starts a recording session, THE Device_Capability_Service SHALL detect the device performance characteristics and produce a Device_Capability_Profile within 2 seconds, where the profile classifies the device into exactly one of the following performance tiers: high-end, mid-range, or low-end.
2. WHEN a Device_Capability_Profile is produced, THE Device_Capability_Service SHALL set the compression target, the resolution, the frame sampling rate, and the upload quality before recording begins, such that any two devices assigned the same performance tier receive identical values for all four settings.
3. WHERE the Device_Capability_Profile indicates the high-end tier, THE Device_Capability_Service SHALL select resolution, frame sampling rate, and upload quality values that are greater than or equal to the values selected for the mid-range tier and less than or equal to the maximum values supported by the recording session.
4. WHERE the Device_Capability_Profile indicates the low-end tier, THE Device_Capability_Service SHALL select resolution, frame sampling rate, and upload quality values that are less than or equal to the values selected for the mid-range tier.
5. IF the Device_Capability_Service cannot complete detection within 2 seconds or detection fails, THEN THE Device_Capability_Service SHALL produce a Device_Capability_Profile assigned to the low-end tier as a safe default, apply the corresponding low-end settings, and record an indication that detection did not complete.

### Requirement 49: Explainable AI (Stage 48)

**User Story:** As an End_User, I want every score explained, so that I understand how each score was derived.

#### Acceptance Criteria

1. WHEN the Feedback_Service produces a score, THE Feedback_Service SHALL attach a Score_Explanation to that score.
2. THE Score_Explanation SHALL attribute the score to its weighted contributing factors — range of motion, tempo, balance, stability, and symmetry — each expressed as a percentage weight in the range 0 to 100, where the percentage weights of the contributing factors sum to 100.
3. THE Feedback_Service SHALL exclude any score that lacks a Score_Explanation from the Analysis_Result.
4. IF a contributing factor required for a Score_Explanation is unavailable, THEN THE Feedback_Service SHALL omit the corresponding score from the Analysis_Result and record an indication that the score could not be explained.

### Requirement 50: Multi-Camera Ready Architecture (Stage 49)

**User Story:** As a Maintainer, I want interfaces ready for multi-camera fusion, so that future multi-angle support requires no breaking changes.

#### Acceptance Criteria

1. THE Analysis_Pipeline SHALL define a Multi_Camera_Interface that accepts camera-angle inputs each labeled with exactly one value from the set Front, Side, and Rear, together with a single multi-angle fusion input.
2. THE Analysis_Pipeline SHALL declare the Multi_Camera_Interface only, with no implemented multi-camera processing behavior in this version.
3. THE Multi_Camera_Interface SHALL allow a future multi-camera implementation to be added without modifying the interface signature of any existing Pipeline_Stage.
4. THE Analysis_Pipeline SHALL route no input through the Multi_Camera_Interface in this version and SHALL use the existing single-camera path.
5. IF the Multi_Camera_Interface is invoked in this version, THEN THE Analysis_Pipeline SHALL return a Structured_Error indicating that multi-camera processing is not implemented, without modifying the existing single-camera state.

### Requirement 51: Secure Temporary Storage (Stage 50)

**User Story:** As an End_User, I want my temporary files encrypted and securely deleted, so that no recoverable copy of my video remains.

#### Acceptance Criteria

1. WHEN a Temporary_Artifact is written, THE Secure_Temporary_Storage_Service SHALL encrypt the Temporary_Artifact at rest before it becomes readable, such that the stored bytes cannot be read without the corresponding decryption key.
2. WHEN an Analysis_Job terminates on any path, including successful completion and failure, THE Secure_Temporary_Storage_Service SHALL automatically delete every Temporary_Artifact it created within 5 seconds of termination.
3. WHEN a Temporary_Artifact is removed, THE Secure_Temporary_Storage_Service SHALL perform secure deletion such that the contents of the Temporary_Artifact are not recoverable from the storage medium after the deletion completes.
4. THE Secure_Temporary_Storage_Service SHALL exclude every video and every Temporary_Artifact from persistent storage, where persistent storage is any storage that retains data after the associated Analysis_Job terminates.
5. IF secure deletion of a Temporary_Artifact fails, THEN THE Secure_Temporary_Storage_Service SHALL retry the secure deletion up to 3 times, and SHALL record a Structured_Error indicating the artifact location that could not be deleted.
6. WHEN secure deletion of every Temporary_Artifact created by an Analysis_Job completes, THE Secure_Temporary_Storage_Service SHALL report the set of artifact locations that were deleted.

### Requirement 52: Version 2 Additive Compatibility and Cross-Cutting Guarantees

**User Story:** As a Maintainer, I want every Version 2 component to be strictly additive, so that existing behavior, interfaces, data contracts, and privacy guarantees remain intact.

#### Acceptance Criteria

1. THE Analysis_Pipeline SHALL introduce the components defined in Requirements 32 through 51 without modifying the interfaces of the Pipeline_Stages defined in Requirements 1 through 31.
2. THE Analysis_Pipeline SHALL preserve every existing backend API contract unchanged when the Version 2 components are added.
3. THE Analysis_Pipeline SHALL preserve every existing data contract unchanged when the Version 2 components are added.
4. THE Analysis_Pipeline SHALL preserve every existing adapter unchanged when the Version 2 components are added.
5. THE Analysis_Pipeline SHALL preserve the privacy guarantee defined in Requirement 1 for every component defined in Requirements 32 through 51.
6. THE Analysis_Pipeline SHALL implement each component defined in Requirements 32 through 51 as an independently replaceable, independently unit-testable, integration-testable, property-testable, and configuration-driven service with a single responsibility and a clear interface.
7. THE Analysis_Pipeline SHALL preserve the behavior of every existing automated test when the Version 2 components are added.
