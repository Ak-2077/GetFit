"""
Property-based tests for the Exercise_Plugin_Registry
(app/analysis/plugins/exercise_plugin.py).

Covers design Property 25 — "Exercise plugin registry round-trip" — using
Hypothesis with a minimum of 100 iterations.

Validates: Requirements 28.1, 28.2, 28.4, 28.5
"""

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.plugins.exercise_plugin import (
    ExercisePlugin,
    ExercisePluginRegistry,
    build_exercise_plugin_registry,
)


# ── A minimal concrete plugin ──────────────────────────────────────────────
# Implements all six abstract methods with empty/simple structures (the V1
# interface expects empty coaching_rules/safety_checks). The exercise_id is
# parametrizable so the same class can stand in for any registered exercise.
# `token` lets a test distinguish two instances sharing one exercise_id, so
# replacement semantics can be observed by identity AND by value.
class _StubExercisePlugin(ExercisePlugin):
    def __init__(self, exercise_id: str, token: int = 0) -> None:
        self.exercise_id = exercise_id
        self.token = token

    def rom_definitions(self) -> dict:
        return {}

    def movement_phases(self) -> list[str]:
        return []

    def joint_importance(self) -> dict:
        return {}

    def biomechanics_thresholds(self) -> dict:
        return {}

    def coaching_rules(self) -> list:
        return []

    def safety_checks(self) -> list:
        return []


# ── Generators ──────────────────────────────────────────────────────────────
# Bare exercise identifiers — non-empty strings. Sets of ids exercise the
# registry across arbitrary, distinct exercises.
_EXERCISE_IDS = st.text(
    alphabet=st.characters(min_codepoint=33, max_codepoint=126),
    min_size=1,
    max_size=12,
)
_ID_SETS = st.sets(_EXERCISE_IDS, min_size=0, max_size=8)


# ── Property 25 ───────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 25: Exercise plugin registry
# round-trip — registering a plugin under an exercise id and looking it up
# round-trips (get returns the registered plugin); available() lists exactly
# the registered bare ids; re-registering an id replaces the plugin; unknown
# ids return None.
@given(ids=_ID_SETS, unknown=_EXERCISE_IDS)
@settings(max_examples=200)
def test_registry_round_trip(ids: set[str], unknown: str):
    registry = build_exercise_plugin_registry()
    assert isinstance(registry, ExercisePluginRegistry)

    # A freshly built V1 registry is empty (Req 28.3 — ships with no plugins).
    assert registry.available() == []

    # Register one plugin per id under the `Exercises/` namespace (Req 28.1).
    plugins: dict[str, _StubExercisePlugin] = {}
    for ex_id in ids:
        plugin = _StubExercisePlugin(ex_id)
        registry.register(plugin)
        plugins[ex_id] = plugin

    # Round-trip: get(id) returns the exact instance registered (Req 28.5).
    for ex_id, plugin in plugins.items():
        assert registry.get(ex_id) is plugin

    # available() lists exactly the registered bare ids — no namespace prefix
    # leaks, no duplicates, nothing missing (Req 28.1, 28.5).
    assert set(registry.available()) == ids
    assert len(registry.available()) == len(ids)

    # Re-registering an id replaces the plugin without touching any other entry
    # or the registry interface (Req 28.4).
    for ex_id in ids:
        replacement = _StubExercisePlugin(ex_id, token=1)
        registry.register(replacement)
        assert registry.get(ex_id) is replacement
        assert registry.get(ex_id).token == 1
        # Replacement keeps the namespace membership identical (no new keys).
        assert set(registry.available()) == ids

    # Unknown ids resolve to None (Req 28.5).
    if unknown not in ids:
        assert registry.get(unknown) is None
