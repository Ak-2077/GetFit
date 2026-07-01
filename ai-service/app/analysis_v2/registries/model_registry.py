"""
Stage 42 · Model_Registry (Req 43)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** registry that exposes interchangeable vision, pose, and
reasoning models behind ONE common interface, selectable by configuration only
(Req 43). It mirrors the proven V1 `PoseEngine` ABC + registry + config-driven
selection template (`app/analysis/adapters/pose_engines.py`,
`app/vision/`) and builds on the *unchanged* V1 contracts re-exported from
`app.analysis_v2` (Req 52.1, 52.6) — it reuses `StructuredError` and never
redefines it.

Behavior (Req 43):
  • Req 43.1 — the registry registers at least the five interchangeable pose /
    vision models: MediaPipe, MoveNet, RTMPose, YOLO Pose, and OpenPose.
  • Req 43.2 — every `RegisteredModel` MUST implement the common model
    interface (a non-empty `name`, a `kind` of vision / pose / reasoning, and
    callable `is_available` / `infer`) before it is accepted.
  • Req 43.3 — a model that does NOT implement the interface is REJECTED with
    `StructuredError(code="MODEL_INTERFACE_NOT_SATISFIED")`, is EXCLUDED from the
    set of selectable models, and the registry is left unchanged.
  • Req 43.4 — when the registry initializes, the active model for each kind is
    the one named in configuration (`ACTIVE_VISION_MODEL`, `ACTIVE_POSE_MODEL`,
    `ACTIVE_REASONING_MODEL`).
  • Req 43.5 — selecting a name NOT present in the registry is REJECTED with
    `StructuredError(code="MODEL_NOT_REGISTERED")`; the previously active model
    is RETAINED with no change to its state.
  • Req 43.6 — a differently-configured model is swapped in WITHOUT changing the
    interface of any `Pipeline_Stage`; callers select through `active(kind)` and
    never depend on a concrete model, so a config swap needs no caller change.

Fail-safe (V2 contract): every domain lookup / selection returns normally —
`register`/`select` return a sanitized `StructuredError` (never raise),
`get`/`active`/`available` return `None`/empty rather than raising. This lets
the `Analysis_Pipeline` and the `GPU_Recovery_Service` (Stage 37) select the
active or fallback model through a uniform interface.

Privacy by construction (Req 1, preserved by Req 52.5): models carry no
video/frame/pose data in-contract — `ModelRequest`/`ModelResponse` reference
opaque handles / aggregate payloads only, and surface sanitized errors.

The concrete models here are dependency-gated stubs (exactly like the V1
`PoseEngine` stubs): each reports availability by probing for its backing
library and, until real inference is wired in, returns an "unavailable"
response rather than raising — keeping the registry complete and the interface
stable while real inference is added behind each model independently.
"""

from __future__ import annotations

import importlib.util
from abc import ABC, abstractmethod
from typing import Literal

from pydantic import BaseModel, Field

# Build on the UNCHANGED V1 contract, re-exported from the V2 package
# (Req 52.1, 52.6) — imported, never redefined.
from app.analysis_v2 import StructuredError
from app.analysis_v2.config_v2 import SettingsV2, settings_v2


# ─────────────────────────────────────────────────────────────────────────
# Stable identifiers
# ─────────────────────────────────────────────────────────────────────────

#: Stable stage/component name surfaced as the originating stage in a
#: StructuredError (Req 15.1).
REGISTRY_STAGE_NAME: str = "model_registry"

#: The three model kinds exposed behind the common interface (Req 43).
ModelKind = Literal["vision", "pose", "reasoning"]

#: The set of valid model kinds, used for interface conformance checks.
MODEL_KINDS: frozenset[str] = frozenset({"vision", "pose", "reasoning"})

# Stable error codes emitted by the registry (design.md Error Handling).
MODEL_INTERFACE_NOT_SATISFIED: str = "MODEL_INTERFACE_NOT_SATISFIED"
MODEL_NOT_REGISTERED: str = "MODEL_NOT_REGISTERED"

#: The five interchangeable pose/vision models the registry MUST provide
#: (Req 43.1). Names are stable, lowercase identifiers.
REQUIRED_POSE_MODELS: tuple[str, ...] = (
    "mediapipe",
    "movenet",
    "rtmpose",
    "yolo_pose",
    "openpose",
)


# ─────────────────────────────────────────────────────────────────────────
# Common model I/O contracts (opaque / privacy-safe)
# ─────────────────────────────────────────────────────────────────────────

class ModelRequest(BaseModel):
    """
    Opaque request carried into ANY `RegisteredModel.infer` (Req 43.2).

    Privacy by construction: carries only an opaque `payload` handle/reference
    and free-form, non-PII `params` — never video bytes, frames, or pose images
    (Req 1, 52.5). Models receive references, not raw media.
    """
    payload: str = Field(default="", description="Opaque handle/reference — never raw media")
    params: dict[str, str] = Field(default_factory=dict, description="Non-PII model parameters")


class ModelResponse(BaseModel):
    """
    Normalized output from ANY `RegisteredModel.infer` (Req 43.2).

    `available` is False when the model could not run (e.g. its backing library
    is not installed); in that case `output` is empty. Mirrors the V1
    `PoseEngineResult.available` convention so callers treat every model
    uniformly.
    """
    model_name: str = ""
    kind: ModelKind = "pose"
    available: bool = True
    output: dict[str, str] = Field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────
# Common model interface (Req 43.2)
# ─────────────────────────────────────────────────────────────────────────

class RegisteredModel(ABC):
    """Abstract base every interchangeable vision/pose/reasoning model implements.

    Mirrors `app/analysis/adapters/pose_engines.py::PoseEngine`. Implementations
    MUST NOT raise on inference failure — return a
    `ModelResponse(available=False)` so the registry/pipeline can surface a
    sanitized `StructuredError` and fall back. The common interface is exactly:
    a non-empty `name`, a `kind` of vision / pose / reasoning, a `version`, and
    the coroutine methods `is_available` and `infer` (Req 43.2).
    """

    #: Stable identifier, e.g. "mediapipe", "movenet", "rtmpose".
    name: str = "base"
    #: One of "vision" / "pose" / "reasoning".
    kind: ModelKind = "pose"
    #: Model version string, surfaced in versioning / diagnostics.
    version: str = "0.0.0"

    @abstractmethod
    async def is_available(self) -> bool:
        """Return True if this model can currently serve inference requests."""
        raise NotImplementedError

    @abstractmethod
    async def infer(self, request: ModelRequest) -> ModelResponse:
        """
        Run inference for `request` behind the common interface (Req 43.2).

        Must NOT raise on inference failure — return an
        `ModelResponse(available=False)` instead so the registry/pipeline can
        fall back to another model without changing any stage interface
        (Req 43.6).
        """
        raise NotImplementedError


# ─────────────────────────────────────────────────────────────────────────
# Dependency-gated concrete models (stubs until real inference is wired in)
# ─────────────────────────────────────────────────────────────────────────

class _DependencyGatedModel(RegisteredModel):
    """
    Shared stub behavior for models whose real inference is added later.

    Availability is determined by probing for the model's backing library via
    `import_module_name`. Until inference is implemented, `infer` returns an
    unavailable response instead of fabricating output, keeping the registry
    complete and the interface stable (mirrors the V1 `PoseEngine` stubs).
    """

    #: The importable module that must be present for the model to run.
    import_module_name: str = ""

    async def is_available(self) -> bool:
        if not self.import_module_name:
            return False
        try:
            return importlib.util.find_spec(self.import_module_name) is not None
        except (ImportError, ValueError, ModuleNotFoundError):
            return False

    async def infer(self, request: ModelRequest) -> ModelResponse:
        # Real inference is wired in per-model later; until then the model is
        # honestly reported as unavailable rather than returning fake output.
        return ModelResponse(model_name=self.name, kind=self.kind, available=False)


# ── Pose / vision models — the five required interchangeable backends (Req 43.1) ──

class MediaPipePoseModel(_DependencyGatedModel):
    """MediaPipe pose backend stub (Req 43.1)."""
    name = "mediapipe"
    kind: ModelKind = "pose"
    version = "mediapipe-stub-0.0.0"
    import_module_name = "mediapipe"


class MoveNetPoseModel(_DependencyGatedModel):
    """MoveNet (TensorFlow) pose backend stub (Req 43.1)."""
    name = "movenet"
    kind: ModelKind = "pose"
    version = "movenet-stub-0.0.0"
    import_module_name = "tensorflow"


class RTMPosePoseModel(_DependencyGatedModel):
    """RTMPose pose backend stub (Req 43.1)."""
    name = "rtmpose"
    kind: ModelKind = "pose"
    version = "rtmpose-stub-0.0.0"
    import_module_name = "mmpose"


class YoloPosePoseModel(_DependencyGatedModel):
    """YOLO Pose backend stub (Req 43.1)."""
    name = "yolo_pose"
    kind: ModelKind = "pose"
    version = "yolo_pose-stub-0.0.0"
    import_module_name = "ultralytics"


class OpenPosePoseModel(_DependencyGatedModel):
    """OpenPose backend stub (Req 43.1)."""
    name = "openpose"
    kind: ModelKind = "pose"
    version = "openpose-stub-0.0.0"
    import_module_name = "pyopenpose"


class MediaPipeVisionModel(_DependencyGatedModel):
    """MediaPipe vision backend stub — default `ACTIVE_VISION_MODEL`."""
    name = "mediapipe"
    kind: ModelKind = "vision"
    version = "mediapipe-vision-stub-0.0.0"
    import_module_name = "mediapipe"


class DefaultReasoningModel(_DependencyGatedModel):
    """Default reasoning model stub — default `ACTIVE_REASONING_MODEL`.

    Reasoning inference is wired into the V1 `Reasoning_Service` LLM later; this
    stub keeps the reasoning kind present and selectable behind the common
    interface without fabricating output.
    """
    name = "default"
    kind: ModelKind = "reasoning"
    version = "reasoning-stub-0.0.0"
    import_module_name = ""


# ─────────────────────────────────────────────────────────────────────────
# The Model_Registry (Req 43)
# ─────────────────────────────────────────────────────────────────────────

class ModelRegistry:
    """Registers interchangeable models per kind and selects the active one by config.

    Storage is keyed by `kind` then `name`, so the same stable name (e.g.
    "mediapipe") can serve more than one kind (vision AND pose) via distinct
    `RegisteredModel` instances. The active model per kind is chosen from
    configuration at construction (Req 43.4) and can be swapped through
    `select(kind, name)` with no change to any caller (Req 43.6).

    Every domain operation is fail-safe: `register`/`select` return a sanitized
    `StructuredError` on rejection (never raise), and `get`/`active`/`available`
    return `None`/empty rather than raising.
    """

    def __init__(self, settings: SettingsV2 | None = None) -> None:
        """Build an empty registry and select active models from config (Req 43.4).

        Args:
            settings: additive V2 settings; defaults to the shared
                `settings_v2`. Read for `ACTIVE_VISION_MODEL`,
                `ACTIVE_POSE_MODEL`, and `ACTIVE_REASONING_MODEL`.
        """
        self._settings = settings if settings is not None else settings_v2
        # kind -> {name -> RegisteredModel}
        self._models: dict[str, dict[str, RegisteredModel]] = {
            "vision": {},
            "pose": {},
            "reasoning": {},
        }
        # kind -> active model name (or None when no valid selection yet).
        self._active: dict[str, str | None] = {
            "vision": None,
            "pose": None,
            "reasoning": None,
        }
        # Non-fatal selection issues encountered during config-driven init
        # (Req 43.5); surfaced for diagnostics, never raised.
        self._init_errors: list[StructuredError] = []

    # ── Registration (Req 43.2, 43.3) ──

    def register(self, model: object) -> StructuredError | None:
        """Register `model` behind the common interface (Req 43.2).

        Returns ``None`` on success. If `model` does not implement the common
        interface it is REJECTED and EXCLUDED — the registry is left unchanged —
        and a `StructuredError(code="MODEL_INTERFACE_NOT_SATISFIED")` is returned
        (Req 43.3). Never raises.
        """
        conformance_error = self._interface_error(model)
        if conformance_error is not None:
            return conformance_error
        # `model` is interface-conforming past this point.
        self._models[model.kind][model.name] = model  # type: ignore[union-attr,index]
        return None

    def register_all(self, models: "list[object]") -> list[StructuredError]:
        """Register many models; return the rejections (empty when all accepted)."""
        errors: list[StructuredError] = []
        for model in models:
            err = self.register(model)
            if err is not None:
                errors.append(err)
        return errors

    # ── Selection (Req 43.4, 43.5, 43.6) ──

    def select(self, kind: str, name: str) -> StructuredError | None:
        """Select `name` as the active model for `kind` (Req 43.4, 43.6).

        Returns ``None`` on success. If `name` is not present in the registry
        for `kind`, the selection is REJECTED with
        `StructuredError(code="MODEL_NOT_REGISTERED")` and the previously active
        model is RETAINED with no change to its state (Req 43.5). Never raises.
        """
        if kind not in self._models:
            return self._not_registered_error(kind, name)
        if name not in self._models[kind]:
            # Reject; keep the previous active selection untouched (Req 43.5).
            return self._not_registered_error(kind, name)
        self._active[kind] = name
        return None

    def active(self, kind: str) -> RegisteredModel | None:
        """Return the active `RegisteredModel` for `kind`, or ``None`` (Req 43.4)."""
        name = self._active.get(kind)
        if name is None:
            return None
        return self._models.get(kind, {}).get(name)

    def get(self, kind: str, name: str | None = None) -> RegisteredModel | None:
        """Look up a model by `kind` (and optional `name`) — fail-safe.

        With `name` omitted, returns the active model for `kind` (Req 43.4);
        otherwise returns the named model or ``None`` when it is not registered.
        Never raises on an unknown kind/name (V2 contract).
        """
        if name is None:
            return self.active(kind)
        return self._models.get(kind, {}).get(name)

    def available(self, kind: str) -> list[str]:
        """Return the sorted names of every model registered for `kind`.

        Returns an empty list for an unknown kind (never raises).
        """
        return sorted(self._models.get(kind, {}).keys())

    def init_errors(self) -> list[StructuredError]:
        """Return any non-fatal selection errors captured during config init (Req 43.5)."""
        return list(self._init_errors)

    # ── Config-driven active selection (Req 43.4) ──

    def apply_config_selection(self) -> list[StructuredError]:
        """Select the active model per kind from configuration (Req 43.4).

        Reads `ACTIVE_VISION_MODEL`, `ACTIVE_POSE_MODEL`, and
        `ACTIVE_REASONING_MODEL`. A configured name that is absent from the
        registry is rejected (Req 43.5) and its `StructuredError` is collected
        and returned (and recorded in `init_errors()`); the corresponding active
        model is left unchanged. Never raises.
        """
        configured: dict[str, str] = {
            "vision": self._settings.ACTIVE_VISION_MODEL,
            "pose": self._settings.ACTIVE_POSE_MODEL,
            "reasoning": self._settings.ACTIVE_REASONING_MODEL,
        }
        errors: list[StructuredError] = []
        for kind, name in configured.items():
            err = self.select(kind, name)
            if err is not None:
                errors.append(err)
        self._init_errors = errors
        return errors

    # ── Internals ──

    def _interface_error(self, model: object) -> StructuredError | None:
        """Return a MODEL_INTERFACE_NOT_SATISFIED error iff `model` is non-conforming.

        The common interface is duck-typed so ANY submitted object is validated
        (not just declared subclasses): a non-empty string `name`, a `kind` in
        {vision, pose, reasoning}, and callable `is_available` / `infer`
        (Req 43.2). A conforming model returns ``None``.
        """
        name = getattr(model, "name", None)
        kind = getattr(model, "kind", None)
        is_available = getattr(model, "is_available", None)
        infer = getattr(model, "infer", None)

        conforms = (
            isinstance(name, str)
            and name != ""
            and isinstance(kind, str)
            and kind in MODEL_KINDS
            and callable(is_available)
            and callable(infer)
        )
        if conforms:
            return None
        return StructuredError(
            code=MODEL_INTERFACE_NOT_SATISFIED,
            message=(
                "Submitted model does not implement the common model interface "
                "(requires a non-empty name, a kind of vision/pose/reasoning, and "
                "callable is_available/infer); registration rejected and the model "
                "excluded from the selectable set."
            ),
            stage=REGISTRY_STAGE_NAME,
        )

    def _not_registered_error(self, kind: str, name: str) -> StructuredError:
        """Build the MODEL_NOT_REGISTERED error; previous active retained (Req 43.5)."""
        return StructuredError(
            code=MODEL_NOT_REGISTERED,
            message=(
                f"Configured model {name!r} for kind {kind!r} is not present in the "
                "registry; selection rejected and the previously active model retained."
            ),
            stage=REGISTRY_STAGE_NAME,
        )


# ─────────────────────────────────────────────────────────────────────────
# Factory + default singleton (mirrors build_pose_engine_registry)
# ─────────────────────────────────────────────────────────────────────────

def build_registered_models() -> list[RegisteredModel]:
    """Instantiate every known `RegisteredModel` ONCE (singletons).

    Provides the five required interchangeable pose/vision models (Req 43.1)
    plus a vision-kind MediaPipe and a default reasoning model so every kind has
    a config-selectable default (`ACTIVE_VISION_MODEL`, `ACTIVE_POSE_MODEL`,
    `ACTIVE_REASONING_MODEL`). Adding a new model = implement `RegisteredModel`
    and register it here; nothing else in the pipeline changes (Req 43.6).
    """
    return [
        # Five required pose/vision models (Req 43.1).
        MediaPipePoseModel(),
        MoveNetPoseModel(),
        RTMPosePoseModel(),
        YoloPosePoseModel(),
        OpenPosePoseModel(),
        # Per-kind defaults so config selection resolves out of the box.
        MediaPipeVisionModel(),
        DefaultReasoningModel(),
    ]


def build_model_registry(settings: SettingsV2 | None = None) -> ModelRegistry:
    """Build a `ModelRegistry`, register the known models, and apply config selection.

    Mirrors `build_pose_engine_registry`: every known model is registered ONCE,
    then the active model per kind is selected from configuration (Req 43.4).
    Any config naming an unregistered model is rejected fail-safe (Req 43.5) and
    surfaced via `registry.init_errors()` — construction never raises.
    """
    registry = ModelRegistry(settings=settings)
    registry.register_all(list(build_registered_models()))
    registry.apply_config_selection()
    return registry


#: Process-wide default registry, selected by the shared V2 settings (Req 43.4).
model_registry: ModelRegistry = build_model_registry()
