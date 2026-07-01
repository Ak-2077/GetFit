"""
Analysis Pipeline — Core Stage Interface & Result Schema
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every analysis stage implements PipelineStage and returns a StageResult.
This is the contract that keeps the pipeline modular and model-agnostic.

Mirrors the existing `app/vision/base.py` VisionBackend ABC convention:
abstract base + Pydantic result schema, and stages NEVER raise on domain
errors — they return StageResult(success=False, error=StructuredError(...))
so the orchestrator can decide how to proceed.
"""

from abc import ABC, abstractmethod
from typing import Generic, TypeVar

from pydantic import BaseModel, Field


class StructuredError(BaseModel):
    """
    Sanitized, cross-boundary error description.
    Surfaces only stable, human-safe information — never stack traces or
    internal detail.

    `details` optionally carries the individual sub-errors when a single
    response aggregates several violations (e.g. the Video_Validation_Service
    reporting every violated constraint at once, Req 2.10). It defaults to an
    empty list so the common single-error case is unchanged.
    """
    code: str        # stable error code (see Error Handling)
    message: str     # human-readable, no stack details
    stage: str       # originating Pipeline_Stage name
    details: list["StructuredError"] = Field(default_factory=list)


# Resolve the self-referential `details` forward reference.
StructuredError.model_rebuild()


#: Generic stage input/output type variables; bound to Pydantic models so
#: every stage contract is a validated, serializable data structure.
TIn = TypeVar("TIn", bound=BaseModel)
TOut = TypeVar("TOut", bound=BaseModel)


class StageResult(BaseModel, Generic[TOut]):
    """
    Normalized output from ANY pipeline stage.
    On success, `output` carries the stage's typed result; on domain failure,
    `error` carries a StructuredError and `output` is None.
    """
    success: bool
    output: TOut | None = None
    error: StructuredError | None = None


class PipelineStage(ABC, Generic[TIn, TOut]):
    """Abstract base every analysis pipeline stage must implement."""

    #: Stable identifier for the stage, e.g. "video_validation".
    name: str = "stage"

    @abstractmethod
    async def run(self, data: TIn) -> "StageResult[TOut]":
        """
        Execute the stage's single responsibility.

        Implementations must NOT raise on domain failure — return a
        StageResult(success=False, error=StructuredError(...)) instead so the
        Analysis_Pipeline can halt analytical stages and surface the
        sanitized error.
        """
        raise NotImplementedError
