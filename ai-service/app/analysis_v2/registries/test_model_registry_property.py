"""
Property-based tests for the Model_Registry (Req 43).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hypothesis property tests covering the config-driven model registry
(`app/analysis_v2/registries/model_registry.py`):

  • Property 49 — the registry enforces the common model interface and its
    selection is round-tripping and fail-safe (Req 43.2, 43.3, 43.4, 43.5).

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest \\
        app/analysis_v2/registries/test_model_registry_property.py
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.base import StructuredError
from app.analysis_v2.registries.model_registry import (
    MODEL_INTERFACE_NOT_SATISFIED,
    MODEL_KINDS,
    MODEL_NOT_REGISTERED,
    ModelRequest,
    ModelResponse,
    RegisteredModel,
    REQUIRED_POSE_MODELS,
    ModelRegistry,
    build_model_registry,
)

# Minimum number of generated examples per property (task requirement: >= 100).
_MIN_ITER = 150

_KINDS = sorted(MODEL_KINDS)  # ["pose", "reasoning", "vision"]


# ── A minimal, fully conforming RegisteredModel used to exercise the registry ──

class _ConformingModel(RegisteredModel):
    """A minimal conforming model: parametrizable name/kind, async interface.

    Implements exactly the common interface required by Req 43.2 — a non-empty
    `name`, a `kind` in {vision, pose, reasoning}, a `version`, and coroutine
    `is_available` / `infer` that never raise.
    """

    def __init__(self, name: str, kind: str, version: str = "1.0.0") -> None:
        self.name = name
        self.kind = kind  # type: ignore[assignment]
        self.version = version

    async def is_available(self) -> bool:
        return True

    async def infer(self, request: ModelRequest) -> ModelResponse:
        return ModelResponse(model_name=self.name, kind=self.kind, available=True)


# ── Non-conforming objects: each violates exactly one interface requirement ──

class _MissingName:
    kind = "pose"

    async def is_available(self) -> bool:  # pragma: no cover - never registered
        return True

    async def infer(self, request):  # pragma: no cover - never registered
        return None


class _EmptyName:
    name = ""
    kind = "pose"

    async def is_available(self) -> bool:  # pragma: no cover
        return True

    async def infer(self, request):  # pragma: no cover
        return None


class _BadKind:
    name = "bad"
    kind = "not_a_kind"

    async def is_available(self) -> bool:  # pragma: no cover
        return True

    async def infer(self, request):  # pragma: no cover
        return None


class _MissingIsAvailable:
    name = "noavail"
    kind = "pose"

    async def infer(self, request):  # pragma: no cover
        return None


class _NonCallableInfer:
    name = "noinfer"
    kind = "pose"
    infer = "not-callable"

    async def is_available(self) -> bool:  # pragma: no cover
        return True


def _non_conforming_factories():
    """Objects that each violate exactly one part of the common interface."""
    return [
        _MissingName,
        _EmptyName,
        _BadKind,
        _MissingIsAvailable,
        _NonCallableInfer,
    ]


# ── Strategies ───────────────────────────────────────────────────────────────

_names = st.text(
    alphabet=st.characters(min_codepoint=97, max_codepoint=122),
    min_size=1,
    max_size=8,
)
_kinds = st.sampled_from(_KINDS)

# A set of conforming (name, kind) model specs; names unique within a kind is
# not required (later registration of the same (kind, name) simply overwrites),
# so we generate a plain list of specs.
_model_specs = st.lists(
    st.tuples(_names, _kinds),
    min_size=0,
    max_size=8,
)


def _empty_registry() -> ModelRegistry:
    """A registry with no models registered and no active selection."""
    return ModelRegistry()


# ── Property 49 ────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 49: Model registry enforces the interface and selection is round-tripping and fail-safe
# Validates: Requirements 43.2, 43.3, 43.4, 43.5


@settings(max_examples=_MIN_ITER, deadline=None)
@given(specs=_model_specs)
def test_property_49_conforming_models_are_registered_and_retrievable(
    specs: list[tuple[str, str]],
) -> None:
    """A conforming model is accepted, retrievable by (kind, name), and appears
    in available(kind); registration returns None (Req 43.2, 43.4)."""
    registry = _empty_registry()

    # Deduplicate by (kind, name): a later register overwrites the same slot.
    unique: dict[tuple[str, str], _ConformingModel] = {}
    for name, kind in specs:
        model = _ConformingModel(name=name, kind=kind)
        assert registry.register(model) is None  # accepted, no error
        unique[(kind, name)] = model

    # Every registered model is retrievable by (kind, name).
    for (kind, name), model in unique.items():
        assert registry.get(kind, name) is model

    # available(kind) lists EXACTLY the registered names for that kind.
    for kind in _KINDS:
        expected = sorted({n for (k, n) in unique if k == kind})
        assert registry.available(kind) == expected


@settings(max_examples=_MIN_ITER, deadline=None)
@given(specs=_model_specs)
def test_property_49_selecting_registered_name_sets_active(
    specs: list[tuple[str, str]],
) -> None:
    """Selecting a registered name makes it the active model for its kind, and
    active(kind)/get(kind) resolve to that exact instance (Req 43.4)."""
    registry = _empty_registry()
    unique: dict[tuple[str, str], _ConformingModel] = {}
    for name, kind in specs:
        model = _ConformingModel(name=name, kind=kind)
        registry.register(model)
        unique[(kind, name)] = model

    for (kind, name), model in unique.items():
        assert registry.select(kind, name) is None  # accepted selection
        assert registry.active(kind) is model
        assert registry.get(kind) is model  # get() with no name -> active


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    specs=st.lists(st.tuples(_names, _kinds), min_size=1, max_size=8),
    unknown=_names,
)
def test_property_49_selecting_unregistered_name_is_rejected_and_retains_active(
    specs: list[tuple[str, str]],
    unknown: str,
) -> None:
    """Selecting a name absent from the registry is rejected with
    MODEL_NOT_REGISTERED and the previously active model is retained unchanged
    (Req 43.5)."""
    registry = _empty_registry()
    for name, kind in specs:
        registry.register(_ConformingModel(name=name, kind=kind))

    for kind in _KINDS:
        registered = set(registry.available(kind))
        if not registered:
            continue
        # Establish a valid active selection first.
        first = sorted(registered)[0]
        assert registry.select(kind, first) is None
        prev_active = registry.active(kind)

        # Craft a name guaranteed to be absent for this kind.
        missing = unknown
        while missing in registered:
            missing += "z"

        err = registry.select(kind, missing)
        assert isinstance(err, StructuredError)
        assert err.code == MODEL_NOT_REGISTERED
        assert err.stage  # non-empty originating stage
        # Previous active retained, identical instance, unchanged.
        assert registry.active(kind) is prev_active


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    factory_index=st.integers(min_value=0, max_value=len(_non_conforming_factories()) - 1),
    seed_specs=_model_specs,
)
def test_property_49_non_conforming_model_rejected_and_excluded(
    factory_index: int,
    seed_specs: list[tuple[str, str]],
) -> None:
    """A non-conforming object is rejected with MODEL_INTERFACE_NOT_SATISFIED
    and EXCLUDED — the registry is left unchanged (Req 43.3)."""
    registry = _empty_registry()
    for name, kind in seed_specs:
        registry.register(_ConformingModel(name=name, kind=kind))

    before = {kind: registry.available(kind) for kind in _KINDS}

    factory = _non_conforming_factories()[factory_index]
    err = registry.register(factory())
    assert isinstance(err, StructuredError)
    assert err.code == MODEL_INTERFACE_NOT_SATISFIED
    assert err.stage

    # Registry unchanged: no kind gained a model, and the bad object is not
    # retrievable under any kind/name.
    after = {kind: registry.available(kind) for kind in _KINDS}
    assert after == before
    for kind in _KINDS:
        bad_name = getattr(factory, "name", None)
        if isinstance(bad_name, str) and bad_name:
            assert registry.get(kind, bad_name) is None


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    specs=_model_specs,
    factory_index=st.integers(min_value=0, max_value=len(_non_conforming_factories()) - 1),
)
def test_property_49_mixed_registration_admits_iff_conforming(
    specs: list[tuple[str, str]],
    factory_index: int,
) -> None:
    """Across a mixed batch, a model becomes selectable IF AND ONLY IF it
    conforms: conforming specs are all retrievable and selectable; the injected
    non-conforming object never appears and never becomes active (Req 43.2,
    43.3)."""
    registry = _empty_registry()

    # Interleave one non-conforming object among the conforming ones.
    factory = _non_conforming_factories()[factory_index]
    interface_err = registry.register(factory())
    assert interface_err is not None
    assert interface_err.code == MODEL_INTERFACE_NOT_SATISFIED

    unique: dict[tuple[str, str], _ConformingModel] = {}
    for name, kind in specs:
        model = _ConformingModel(name=name, kind=kind)
        assert registry.register(model) is None
        unique[(kind, name)] = model

    # Only-if: exactly the conforming set is present and each is selectable.
    for kind in _KINDS:
        expected = sorted({n for (k, n) in unique if k == kind})
        assert registry.available(kind) == expected
        for name in expected:
            assert registry.select(kind, name) is None
            assert registry.active(kind).name == name


def test_property_49_five_required_pose_models_present() -> None:
    """The fully built registry provides all five required interchangeable pose
    models behind the common interface (Req 43.1 supports 43.2)."""
    registry = build_model_registry()
    pose_available = set(registry.available("pose"))
    for required in REQUIRED_POSE_MODELS:
        assert required in pose_available
