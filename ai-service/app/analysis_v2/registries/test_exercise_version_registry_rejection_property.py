"""
Property-based tests for the Exercise_Version_Registry (Req 44) — rejections.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hypothesis property tests for variation registration rejections over
`app/analysis_v2/registries/exercise_version_registry.py`:

  • Property 51 — Exercise variation registration rejects missing bases and
    duplicates without side effects (Req 44.5, 44.6).

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest \\
        app/analysis_v2/registries/test_exercise_version_registry_rejection_property.py
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.base import StructuredError
from app.analysis.plugins.exercise_plugin import (
    ExercisePlugin,
    ExercisePluginRegistry,
    build_exercise_plugin_registry,
)
from app.analysis_v2.registries.exercise_version_registry import (
    EXERCISE_BASE_NOT_FOUND,
    EXERCISE_DUPLICATE_ID,
    ExerciseVariation,
    ExerciseVersionRegistry,
)

# Minimum number of generated examples per property (task requirement: >= 100).
_MIN_ITER = 150

_BASE_ID = "squat"


# ── A minimal concrete base ExercisePlugin registered as the base exercise ──

class _BasePlugin(ExercisePlugin):
    """A minimal Req 28 `ExercisePlugin` used as the registered base exercise."""

    def __init__(self, exercise_id: str = _BASE_ID) -> None:
        self.exercise_id = exercise_id

    def rom_definitions(self) -> dict:
        return {"knee": [0, 140]}

    def movement_phases(self) -> list[str]:
        return ["descent", "ascent"]

    def joint_importance(self) -> dict:
        return {"knee": 1.0}

    def biomechanics_thresholds(self) -> dict:
        return {"depth_ratio": 0.9}

    def coaching_rules(self) -> list:
        return []

    def safety_checks(self) -> list:
        return []


def _base_registry() -> ExercisePluginRegistry:
    """A V1 registry populated with a single registered base exercise."""
    registry = build_exercise_plugin_registry()
    registry.register(_BasePlugin())
    return registry


# ── Strategies ───────────────────────────────────────────────────────────────

_ids = st.text(
    alphabet=st.characters(min_codepoint=97, max_codepoint=122),
    min_size=1,
    max_size=10,
)


# ── Property 51 ────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 51: Exercise variation registration rejects missing bases and duplicates without side effects
# Validates: Requirements 44.5, 44.6


@settings(max_examples=_MIN_ITER, deadline=None)
@given(variation_id=_ids, missing_base=_ids)
def test_property_51_missing_base_rejected_state_unchanged(
    variation_id: str,
    missing_base: str,
) -> None:
    """Registering a variation whose base_exercise_id is NOT registered is
    rejected with EXERCISE_BASE_NOT_FOUND and available() is unchanged — the
    variation is not added (Req 44.5). Never raises."""
    # Ensure the base is genuinely absent from the backing registry.
    if missing_base == _BASE_ID:
        missing_base += "_absent"

    registry = ExerciseVersionRegistry(base_registry=_base_registry())
    before = registry.available()

    variation = ExerciseVariation(
        variation_id=variation_id,
        base_exercise_id=missing_base,
        properties={},
    )
    err = registry.register(variation)

    assert isinstance(err, StructuredError)
    assert err.code == EXERCISE_BASE_NOT_FOUND
    assert err.stage  # non-empty originating stage
    # State unchanged: variation not added, not retrievable.
    assert registry.available() == before
    assert variation_id not in registry.available()
    assert registry.get(variation_id) is None


@settings(max_examples=_MIN_ITER, deadline=None)
@given(variation_id=_ids)
def test_property_51_duplicate_id_rejected_existing_retained(
    variation_id: str,
) -> None:
    """Registering a duplicate variation_id without replace=True is rejected
    with EXERCISE_DUPLICATE_ID and the EXISTING variation is retained unchanged
    (Req 44.6). Never raises."""
    registry = ExerciseVersionRegistry(base_registry=_base_registry())

    original = ExerciseVariation(
        variation_id=variation_id,
        base_exercise_id=_BASE_ID,
        properties={"coaching_rules": ["original"]},
    )
    assert registry.register(original) is None

    # A different variation reusing the same identifier.
    duplicate = ExerciseVariation(
        variation_id=variation_id,
        base_exercise_id=_BASE_ID,
        properties={"coaching_rules": ["changed"]},
    )
    err = registry.register(duplicate)  # replace defaults to False

    assert isinstance(err, StructuredError)
    assert err.code == EXERCISE_DUPLICATE_ID
    assert err.stage
    # Existing retained unchanged (identical to the originally registered one).
    retained = registry.get(variation_id)
    assert retained is original
    assert retained.properties == {"coaching_rules": ["original"]}
    assert registry.available() == [variation_id]


@settings(max_examples=_MIN_ITER, deadline=None)
@given(variation_id=_ids)
def test_property_51_replace_true_replaces_successfully(
    variation_id: str,
) -> None:
    """register(..., replace=True) replaces an existing variation successfully
    (returns None) and the new definition wins (Req 44.6, complement)."""
    registry = ExerciseVersionRegistry(base_registry=_base_registry())

    original = ExerciseVariation(
        variation_id=variation_id,
        base_exercise_id=_BASE_ID,
        properties={"coaching_rules": ["original"]},
    )
    assert registry.register(original) is None

    replacement = ExerciseVariation(
        variation_id=variation_id,
        base_exercise_id=_BASE_ID,
        properties={"coaching_rules": ["replaced"]},
    )
    assert registry.register(replacement, replace=True) is None

    retained = registry.get(variation_id)
    assert retained is replacement
    assert retained.properties == {"coaching_rules": ["replaced"]}
    assert registry.available() == [variation_id]
