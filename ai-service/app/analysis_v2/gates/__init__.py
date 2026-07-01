"""
V2 pre-pipeline gates (additive).

Components that run before any V1 AI stage — Duplicate_Detection_Service
(Stage 33, Req 34) and Abuse_Protection_Service (Stage 46, Req 47). Each
implements the V1 `PipelineStage` interface and returns
`StageResult`/`StructuredError` rather than raising.
"""
