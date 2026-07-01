"""
Property-based tests for the Exercise_Version_Registry (Req 44) — resolution.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hypothesis property tests for variation property resolution and plugin
round-trip over `app/analysis_v2/registries/exercise_version_registry.py`:

  • Property 50 — Exercise variation property resolution and plugin round-trip
    (Req 44.2, 44.3; supports 44.4).

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest \\
        app/analysis_v2/registries/test_exercise_version_registry_resolution_property.py
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.plugins.exercise_plugin import (
    ExercisePlugin,
    ExercisePluginRegistry,
    build_exercise_plugin_registry,
)
from app.analysis_v2.registries.exercise_version_registry import (
    PLUGIN_PROPERTIES,
    ExerciseVariation,
    ExerciseVersionRegistry,
)

# Minimum number of generated examples per property (task requirement: >= 100).
_MIN_ITER = 150

_BASE_ID = "squat"


# ── A concrete base ExercisePlugin with KNOWN, distinct property values ──

class _BaseSquatPlugin(ExercisePlugin):
    """A fully-implemented Req 28 `ExercisePlugin` with known base values.

    Every property returns a fresh copy of a distinct, known value so a
    resolved value can be compared against either the base value (inherited) or
    the variation's own value (override).
    """

    exercise_id = _BASE_ID

    def rom_definitions(self) -> dict:
        return {"knee": [0, 140], "hip": [0, 120]}

    def movement_phases(self) -> list[str]:
        return ["setup", "descent", "bottom", "ascent", "lockout"]

    def joint_importance(self) -> dict:
        return {"knee": 0.5, "hip": 0.4, "ankle": 0.1}

    def biomechanics_thresholds(self) -> dict:
        return {"knee_valgus_deg": 10, "depth_ratio": 0.9}

    def coaching_rules(self) -> list:
        return ["keep_chest_up", "drive_through_heels"]

    def safety_checks(self) -> list:
        return ["no_knee_collapse"]


def _base_values() -> dict:
    """The known base value for each inheritable plugin property."""
    plugin = _BaseSquatPlugin()
    return {prop: getattr(plugin, prop)() for prop in PLUGIN_PROPERTIES}


# Distinct, non-empty OVERRIDE values per property (differ from base values).
_OVERRIDE_VALUES: dict[str, object] = {
    "rom_definitions": {"knee": [10, 90]},
    "movement_phases": ["unrack", "descent", "ascent"],
    "joint_importance": {"hip": 0.9, "knee": 0.1},
    "biomechanics_thresholds": {"knee_valgus_deg": 3},
    "coaching_rules": ["brace_hard"],
    "safety_checks": ["spotter_required", "belt_recommended"],
}


def _base_registry() -> ExercisePluginRegistry:
    """A V1 registry populated with the concrete base squat plugin."""
    registry = build_exercise_plugin_registry()
    registry.register(_BaseSquatPlugin())
    return registry


# ── Strategies ───────────────────────────────────────────────────────────────

# An arbitrary subset of the inheritable properties to override.
_override_subsets = st.lists(
    st.sampled_from(PLUGIN_PROPERTIES),
    unique=True,
    max_size=len(PLUGIN_PROPERTIES),
)

_variation_ids = st.text(
    alphabet=st.characters(min_codepoint=97, max_codepoint=122),
    min_size=1,
    max_size=10,
)


def _make_variation(variation_id: str, overridden: list[str]) -> ExerciseVariation:
    """Build a variation overriding exactly `overridden` with known values."""
    properties = {prop: _OVERRIDE_VALUES[prop] for prop in overridden}
    return ExerciseVariation(
        variation_id=variation_id,
        base_exercise_id=_BASE_ID,
        properties=properties,
    )


# ── Property 50 ────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 50: Exercise variation property resolution and plugin round-trip
# Validates: Requirements 44.2, 44.3


@settings(max_examples=_MIN_ITER, deadline=None)
@given(variation_id=_variation_ids, overridden=_override_subsets)
def test_property_50_resolve_property_override_wins_else_inherits(
    variation_id: str,
    overridden: list[str],
) -> None:
    """resolve_property returns the variation's value for overridden properties
    and the base plugin's value for non-overridden (inherited) ones (Req 44.2)."""
    registry = ExerciseVersionRegistry(base_registry=_base_registry())
    assert registry.register(_make_variation(variation_id, overridden)) is None

    base = _base_values()
    overridden_set = set(overridden)
    for prop in PLUGIN_PROPERTIES:
        resolved = registry.resolve_property(variation_id, prop)
        if prop in overridden_set:
            assert resolved == _OVERRIDE_VALUES[prop]  # override wins
        else:
            assert resolved == base[prop]  # inherited from base


@settings(max_examples=_MIN_ITER, deadline=None)
@given(variation_id=_variation_ids, overridden=_override_subsets)
def test_property_50_as_plugin_exposes_resolved_values(
    variation_id: str,
    overridden: list[str],
) -> None:
    """as_plugin returns an ExercisePlugin whose exercise_id == variation_id and
    whose 6 interface methods return the resolved (override-else-inherit) values
    (Req 44.2, 44.3)."""
    registry = ExerciseVersionRegistry(base_registry=_base_registry())
    assert registry.register(_make_variation(variation_id, overridden)) is None

    plugin = registry.as_plugin(variation_id)
    assert isinstance(plugin, ExercisePlugin)
    assert plugin.exercise_id == variation_id

    base = _base_values()
    overridden_set = set(overridden)
    for prop in PLUGIN_PROPERTIES:
        method_value = getattr(plugin, prop)()
        if prop in overridden_set:
            assert method_value == _OVERRIDE_VALUES[prop]
        else:
            assert method_value == base[prop]


@settings(max_examples=_MIN_ITER, deadline=None)
@given(variation_id=_variation_ids, overridden=_override_subsets)
def test_property_50_variation_plugin_round_trips_through_v1_registry(
    variation_id: str,
    overridden: list[str],
) -> None:
    """The variation plugin round-trips through the existing Req 28
    ExercisePlugin interface: registering the returned plugin in a fresh V1
    ExercisePluginRegistry and getting it back yields the same instance exposing
    the same resolved values (Req 44.3)."""
    registry = ExerciseVersionRegistry(base_registry=_base_registry())
    assert registry.register(_make_variation(variation_id, overridden)) is None

    plugin = registry.as_plugin(variation_id)
    assert isinstance(plugin, ExercisePlugin)

    # Round-trip through the UNCHANGED V1 registry (register -> get by id).
    v1_registry = build_exercise_plugin_registry()
    v1_registry.register(plugin)
    round_tripped = v1_registry.get(variation_id)

    assert round_tripped is plugin
    assert variation_id in v1_registry.available()

    base = _base_values()
    overridden_set = set(overridden)
    for prop in PLUGIN_PROPERTIES:
        value = getattr(round_tripped, prop)()
        if prop in overridden_set:
            assert value == _OVERRIDE_VALUES[prop]
        else:
            assert value == base[prop]
