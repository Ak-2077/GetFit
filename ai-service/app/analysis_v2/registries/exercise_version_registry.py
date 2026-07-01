"""
Stage 43 · Exercise_Version_Registry (Req 44)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** registry that registers named `Exercise_Variation`s of a
single base exercise with *property inheritance*, and exposes each variation to
the `Analysis_Pipeline` through the **existing** Req 28 `ExercisePlugin`
interface — WITHOUT modifying that interface or any V1 module (Req 44.3, 44.4,
52.1). It builds ON TOP of the unchanged V1 `Exercise_Plugin` interface +
`ExercisePluginRegistry` (`app/analysis/plugins/exercise_plugin.py`) and reuses
the V1 `StructuredError` re-exported from `app.analysis_v2` (Req 52.6) — it
never redefines either.

Behavior (Req 44):
  • Req 44.1 — registers one or more `Exercise_Variation`s of a base exercise,
    each keyed by a unique identifier (e.g. for the Squat: Powerlifting,
    Olympic, Front, Hack, and Bulgarian Split variations).
  • Req 44.2 — property resolution: when a variation does NOT define a property
    its value is inherited from the base exercise; when a variation DOES define
    a property, the variation's own value wins (override).
  • Req 44.3 — every registered variation is exposed through the existing
    `ExercisePlugin` interface via `as_plugin(...)`; the interface is unchanged.
  • Req 44.4 — a variation is added or replaced without changing the interface
    of any `Pipeline_Stage`; callers resolve through `as_plugin`/`resolve_*`
    and never depend on a concrete variation type.
  • Req 44.5 — a variation whose `base_exercise_id` is NOT registered in the
    backing `ExercisePluginRegistry` is REJECTED with
    `StructuredError(code="EXERCISE_BASE_NOT_FOUND")` naming the missing base,
    and the registry state is left unchanged.
  • Req 44.6 — a variation registered with an identifier that already exists,
    when `replace` is NOT requested, is REJECTED with
    `StructuredError(code="EXERCISE_DUPLICATE_ID")`; the existing variation is
    retained unchanged.

Fail-safe (V2 contract): every domain operation returns normally and NEVER
raises. `register` returns a sanitized `StructuredError` on rejection (or
``None`` on success); `get`/`available`/`resolve_property` return
``None``/empty on unknown lookups; `as_plugin` returns a `StructuredError`
(rather than raising) when the requested variation is unknown.

Privacy by construction (Req 1, preserved by Req 52.5): variations carry only
exercise-definition metadata (ROM, phases, joint importance, thresholds) — never
video/frame/pose data — and surface sanitized errors.

V2 SCOPE BOUNDARY (Req 17.2, 17.3, mirrored from Req 28.3): this registry adds
NO validated per-exercise scoring/coaching logic. It only defines *variation
inheritance* over the existing plugin interface, so per-exercise quality logic
(deferred in V1/V2) can plug in later with no architectural change.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

# Build ON the UNCHANGED V1 Exercise_Plugin interface + registry (Req 28) —
# imported, never modified.
from app.analysis.plugins.exercise_plugin import (
    ExercisePlugin,
    ExercisePluginRegistry,
    build_exercise_plugin_registry,
)

# Reuse the V1 StructuredError re-exported from the V2 package (Req 52.6) —
# imported, never redefined.
from app.analysis_v2 import StructuredError


# ─────────────────────────────────────────────────────────────────────────
# Stable identifiers
# ─────────────────────────────────────────────────────────────────────────

#: Stable stage/component name surfaced as the originating stage in a
#: StructuredError (Req 15.1).
REGISTRY_STAGE_NAME: str = "exercise_version_registry"

# Stable error codes emitted by the registry (design.md Error Handling table).
EXERCISE_BASE_NOT_FOUND: str = "EXERCISE_BASE_NOT_FOUND"
EXERCISE_DUPLICATE_ID: str = "EXERCISE_DUPLICATE_ID"
#: Additive resolution error — the requested variation is not registered. Used
#: by `as_plugin` so an unknown resolution surfaces a sanitized error instead of
#: raising (V2 fail-safe contract); it is NOT a registration-rejection code.
EXERCISE_VARIATION_NOT_FOUND: str = "EXERCISE_VARIATION_NOT_FOUND"

#: The inheritable `ExercisePlugin` interface properties (Req 28.2). A variation
#: may override any of these by name in its `properties`; anything absent is
#: inherited from the base exercise's plugin (Req 44.2). Each maps to the V1
#: `ExercisePlugin` method that produces the base value, plus the empty default
#: used when neither the variation nor the base supply a value.
_PLUGIN_PROPERTY_DEFAULTS: dict[str, object] = {
    "rom_definitions": {},
    "movement_phases": [],
    "joint_importance": {},
    "biomechanics_thresholds": {},
    "coaching_rules": [],
    "safety_checks": [],
}

#: Ordered, immutable view of the inheritable property names (Req 44.2).
PLUGIN_PROPERTIES: tuple[str, ...] = tuple(_PLUGIN_PROPERTY_DEFAULTS.keys())

#: Canonical Squat variation identifiers called out by Req 44.1. Provided for
#: traceability/documentation only — the registry registers whatever variations
#: a maintainer supplies over a registered base (nothing is auto-registered).
SQUAT_VARIATION_IDS: tuple[str, ...] = (
    "squat_powerlifting",
    "squat_olympic",
    "squat_front",
    "squat_hack",
    "squat_bulgarian_split",
)


# ─────────────────────────────────────────────────────────────────────────
# Exercise_Variation contract
# ─────────────────────────────────────────────────────────────────────────

class ExerciseVariation(BaseModel):
    """A named variation of a base exercise with only its overridden properties.

    `properties` carries ONLY the properties this variation overrides; every
    other property is inherited from the base exercise's `ExercisePlugin`
    (Req 44.2). Keys are inheritable `ExercisePlugin` property names (see
    `PLUGIN_PROPERTIES`); unknown keys are stored but never surfaced through the
    plugin interface.
    """

    #: Unique identifier for this variation, e.g. "squat_front" (Req 44.1).
    variation_id: str
    #: Identifier of the base exercise whose plugin supplies inherited
    #: properties; MUST be registered in the backing `ExercisePluginRegistry`
    #: at registration time (Req 44.5).
    base_exercise_id: str
    #: Only the properties this variation overrides (override wins, Req 44.2).
    properties: dict = Field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────
# Variation-backed ExercisePlugin (exposes a variation through the Req 28 API)
# ─────────────────────────────────────────────────────────────────────────

class _VariationPlugin(ExercisePlugin):
    """Adapts a registered `ExerciseVariation` to the existing `ExercisePlugin`.

    Implements the UNCHANGED Req 28 interface (Req 44.3) by delegating every
    property to `ExerciseVersionRegistry.resolve_property`, so variation
    overrides win and everything else is inherited from the base plugin
    (Req 44.2). Its `exercise_id` is the variation id, so it round-trips through
    the V1 `ExercisePluginRegistry` (register → get) unchanged.
    """

    def __init__(self, registry: "ExerciseVersionRegistry", variation_id: str) -> None:
        self.exercise_id = variation_id
        self._registry = registry
        self._variation_id = variation_id

    def _resolved(self, prop: str) -> object:
        """Return the resolved value for `prop`, falling back to the empty default."""
        value = self._registry.resolve_property(self._variation_id, prop)
        if value is None:
            return _PLUGIN_PROPERTY_DEFAULTS[prop]
        return value

    def rom_definitions(self) -> dict:
        return self._resolved("rom_definitions")  # type: ignore[return-value]

    def movement_phases(self) -> list[str]:
        return self._resolved("movement_phases")  # type: ignore[return-value]

    def joint_importance(self) -> dict:
        return self._resolved("joint_importance")  # type: ignore[return-value]

    def biomechanics_thresholds(self) -> dict:
        return self._resolved("biomechanics_thresholds")  # type: ignore[return-value]

    def coaching_rules(self) -> list:
        return self._resolved("coaching_rules")  # type: ignore[return-value]

    def safety_checks(self) -> list:
        return self._resolved("safety_checks")  # type: ignore[return-value]


# ─────────────────────────────────────────────────────────────────────────
# The Exercise_Version_Registry (Req 44)
# ─────────────────────────────────────────────────────────────────────────

class ExerciseVersionRegistry:
    """Registers `Exercise_Variation`s over a V1 `ExercisePluginRegistry`.

    Base exercises live in the backing `ExercisePluginRegistry` (V1, unchanged);
    this registry stores variations keyed by `variation_id` and resolves each
    variation's properties by override-then-inherit (Req 44.2). Variations are
    exposed through the existing `ExercisePlugin` interface via `as_plugin`
    (Req 44.3) and can be added/replaced without changing any stage interface
    (Req 44.4).

    Every operation is fail-safe: `register` returns a sanitized
    `StructuredError` on rejection (never raises), and `get`/`available`/
    `resolve_property` return `None`/empty rather than raising.
    """

    def __init__(self, base_registry: ExercisePluginRegistry | None = None) -> None:
        """Build an empty variation registry over a base `ExercisePluginRegistry`.

        Args:
            base_registry: the V1 `ExercisePluginRegistry` holding base
                exercises. Defaults to a fresh (empty) V1 registry via
                `build_exercise_plugin_registry`; inject a populated one so
                variations can reference registered bases (Req 44.5).
        """
        self._base_registry = (
            base_registry if base_registry is not None else build_exercise_plugin_registry()
        )
        #: variation_id -> ExerciseVariation.
        self._variations: dict[str, ExerciseVariation] = {}

    # ── Registration (Req 44.1, 44.5, 44.6) ──

    def register(
        self, variation: ExerciseVariation, replace: bool = False
    ) -> StructuredError | None:
        """Register (or, when `replace=True`, replace) a variation (Req 44.1).

        Returns ``None`` on success. Rejections (never raise):
          • base not registered in the backing `ExercisePluginRegistry` →
            `StructuredError(code="EXERCISE_BASE_NOT_FOUND")`; registry state is
            left unchanged (Req 44.5).
          • identifier already exists and `replace` is not requested →
            `StructuredError(code="EXERCISE_DUPLICATE_ID")`; the existing
            variation is retained unchanged (Req 44.6).
        """
        # Req 44.5 — the base exercise MUST be a registered ExercisePlugin.
        if self._base_registry.get(variation.base_exercise_id) is None:
            return self._base_not_found_error(variation)

        # Req 44.6 — duplicate identifier without an explicit replace is rejected
        # and the existing variation is kept unchanged.
        if variation.variation_id in self._variations and not replace:
            return self._duplicate_id_error(variation)

        self._variations[variation.variation_id] = variation
        return None

    # ── Lookups (fail-safe) ──

    def get(self, variation_id: str) -> ExerciseVariation | None:
        """Return the registered `ExerciseVariation`, or ``None`` if absent."""
        return self._variations.get(variation_id)

    def available(self) -> list[str]:
        """Return the sorted identifiers of every registered variation (Req 44.1)."""
        return sorted(self._variations.keys())

    # ── Property inheritance (Req 44.2) ──

    def resolve_property(self, variation_id: str, prop: str) -> object | None:
        """Resolve `prop` for `variation_id`: override wins, else inherit (Req 44.2).

        Resolution order:
          1. If the variation explicitly defines `prop`, return the variation's
             own value (override wins).
          2. Otherwise inherit `prop` from the base exercise's `ExercisePlugin`
             (an inheritable interface property in `PLUGIN_PROPERTIES`).
          3. Return ``None`` when the variation is unknown, the base is no longer
             registered, or `prop` is not an inheritable/overridden property —
             fail-safe, never raises.
        """
        variation = self._variations.get(variation_id)
        if variation is None:
            return None

        # 1) Variation override wins (Req 44.2).
        if prop in variation.properties:
            return variation.properties[prop]

        # 2) Inherit from the base plugin for known interface properties.
        if prop not in _PLUGIN_PROPERTY_DEFAULTS:
            return None
        base_plugin = self._base_registry.get(variation.base_exercise_id)
        if base_plugin is None:
            return None
        return getattr(base_plugin, prop)()

    # ── Plugin exposure / resolution (Req 44.3, 44.4) ──

    def as_plugin(self, variation_id: str) -> ExercisePlugin | StructuredError:
        """Resolve a registered variation to an `ExercisePlugin` (Req 44.3).

        Returns an `ExercisePlugin` (the existing Req 28 interface, unchanged)
        whose `exercise_id` is `variation_id` and whose properties are resolved
        by override-then-inherit (Req 44.2). When the variation is not
        registered, returns `StructuredError(code="EXERCISE_VARIATION_NOT_FOUND")`
        instead of raising (V2 fail-safe contract).
        """
        if variation_id not in self._variations:
            return StructuredError(
                code=EXERCISE_VARIATION_NOT_FOUND,
                message=(
                    f"Exercise variation {variation_id!r} is not registered; cannot "
                    "expose it through the Exercise_Plugin interface."
                ),
                stage=REGISTRY_STAGE_NAME,
            )
        return _VariationPlugin(self, variation_id)

    # ── Internals ──

    def _base_not_found_error(self, variation: ExerciseVariation) -> StructuredError:
        """Build the EXERCISE_BASE_NOT_FOUND error; registry unchanged (Req 44.5)."""
        return StructuredError(
            code=EXERCISE_BASE_NOT_FOUND,
            message=(
                f"Exercise variation {variation.variation_id!r} references base "
                f"exercise {variation.base_exercise_id!r}, which is not registered "
                "in the Exercise_Plugin registry; registration rejected and the "
                "registry state left unchanged."
            ),
            stage=REGISTRY_STAGE_NAME,
        )

    def _duplicate_id_error(self, variation: ExerciseVariation) -> StructuredError:
        """Build the EXERCISE_DUPLICATE_ID error; existing retained (Req 44.6)."""
        return StructuredError(
            code=EXERCISE_DUPLICATE_ID,
            message=(
                f"An exercise variation with identifier {variation.variation_id!r} "
                "already exists and replacement was not requested; registration "
                "rejected and the existing variation retained unchanged."
            ),
            stage=REGISTRY_STAGE_NAME,
        )


# ─────────────────────────────────────────────────────────────────────────
# Factory (mirrors build_model_registry / build_exercise_plugin_registry)
# ─────────────────────────────────────────────────────────────────────────

def build_exercise_version_registry(
    base_registry: ExercisePluginRegistry | None = None,
) -> ExerciseVersionRegistry:
    """Construct an `ExerciseVersionRegistry` over a base `ExercisePluginRegistry`.

    Mirrors `build_exercise_plugin_registry`/`build_model_registry` as the single
    construction entry point. Ships EMPTY of variations in V2 (no per-exercise
    logic is registered); a maintainer registers variations over a populated
    base registry. Never raises.
    """
    return ExerciseVersionRegistry(base_registry=base_registry)
