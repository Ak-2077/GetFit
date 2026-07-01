"""
Exercise_Plugin — per-exercise interface & registry (interface only in V1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
An `Exercise_Plugin` isolates everything specific to a single exercise (squat,
bench, deadlift, …) behind one stable interface, so future per-exercise
quality-scoring logic can plug in without touching any `Pipeline_Stage`
(Req 28, Req 17.4).

This module mirrors the proven registry convention in
`app/analysis/adapters/pose_engines.py`:

  • `ExercisePlugin` is an ABC describing range-of-motion definitions, movement
    phases, joint importance, biomechanics thresholds, coaching rules, and
    safety checks (Req 28.2).
  • `ExercisePluginRegistry` registers plugins under an `Exercises/` namespace
    keyed by exercise identifier (Req 28.1) and exposes them through a uniform
    interface — `register`, `get`, `available` (Req 28.5).

V1 SCOPE BOUNDARY (Req 17.2, 17.3, 28.3): this module defines ONLY the
interface and the registry. It contains NO per-exercise logic, NO hardcoded
coaching rules, and NO rule-based posture correction. `coaching_rules()` and
`safety_checks()` are part of the interface but are expected to be empty in V1.
Adding or replacing a plugin later requires no change to any existing
`Pipeline_Stage` (Req 28.4).
"""

from __future__ import annotations

from abc import ABC, abstractmethod

#: The namespace under which every Exercise_Plugin is registered (Req 28.1).
#: Registry keys are formed as ``f"{EXERCISES_NAMESPACE}{exercise_id}"`` so that
#: every plugin lives under a single, explicit `Exercises/` namespace while the
#: public API still accepts and returns bare exercise identifiers.
EXERCISES_NAMESPACE: str = "Exercises/"


class ExercisePlugin(ABC):
    """Abstract base every per-exercise plugin must implement.

    Mirrors the ABC convention of `PoseEngine`/`VisionBackend`. The interface is
    intentionally broad enough to describe everything a future quality-scoring
    stage needs (Req 28.2), but V1 supplies NO per-exercise implementation
    (Req 17.2, 17.3, 28.3). `coaching_rules()` and `safety_checks()` are part of
    the contract yet are expected to return empty collections in V1.
    """

    #: Stable identifier for the exercise this plugin describes, e.g. "squat".
    #: Used as the registry key under the `Exercises/` namespace (Req 28.1).
    exercise_id: str = "base"

    @abstractmethod
    def rom_definitions(self) -> dict:
        """Return range-of-motion definitions for the exercise (Req 28.2)."""
        raise NotImplementedError

    @abstractmethod
    def movement_phases(self) -> list[str]:
        """Return the ordered movement phases for the exercise (Req 28.2)."""
        raise NotImplementedError

    @abstractmethod
    def joint_importance(self) -> dict:
        """Return per-joint importance weighting for the exercise (Req 28.2)."""
        raise NotImplementedError

    @abstractmethod
    def biomechanics_thresholds(self) -> dict:
        """Return biomechanics thresholds for the exercise (Req 28.2)."""
        raise NotImplementedError

    @abstractmethod
    def coaching_rules(self) -> list:
        """Return coaching rules for the exercise.

        Empty in V1 — per-exercise coaching rules are excluded from Version 1
        (Req 17.2, 28.3).
        """
        raise NotImplementedError

    @abstractmethod
    def safety_checks(self) -> list:
        """Return safety checks for the exercise.

        Empty in V1 — rule-based correction logic is excluded from Version 1
        (Req 17.3, 28.3).
        """
        raise NotImplementedError


class ExercisePluginRegistry:
    """Registry of `ExercisePlugin`s keyed by exercise id under `Exercises/`.

    Mirrors `build_pose_engine_registry`'s "register once, look up by name"
    convention, but is mutable so plugins can be added or replaced without
    touching any `Pipeline_Stage` (Req 28.4). Exposes a uniform interface
    (`register`, `get`, `available`) to the Analysis_Pipeline (Req 28.5).

    V1 ships this registry EMPTY — no per-exercise plugin is registered
    (Req 17.2, 28.3). It exists so future plugins plug in cleanly.
    """

    def __init__(self) -> None:
        #: Keyed by the fully-namespaced id (``Exercises/<exercise_id>``) so the
        #: `Exercises/` namespace is explicit in the stored keys (Req 28.1).
        self._plugins: dict[str, ExercisePlugin] = {}

    @staticmethod
    def _namespaced(exercise_id: str) -> str:
        """Form the namespaced registry key for an exercise id (Req 28.1)."""
        return f"{EXERCISES_NAMESPACE}{exercise_id}"

    def register(self, plugin: ExercisePlugin) -> None:
        """Register (or replace) a plugin under the `Exercises/` namespace.

        Keyed by `plugin.exercise_id` (Req 28.1). Re-registering the same
        exercise id replaces the existing plugin, so a plugin can be swapped
        without modifying any existing Pipeline_Stage (Req 28.4).
        """
        self._plugins[self._namespaced(plugin.exercise_id)] = plugin

    def get(self, exercise_id: str) -> ExercisePlugin | None:
        """Return the plugin registered for `exercise_id`, or None if absent."""
        return self._plugins.get(self._namespaced(exercise_id))

    def available(self) -> list[str]:
        """Return the bare exercise identifiers currently registered.

        Strips the `Exercises/` namespace prefix so callers receive the same
        identifiers they registered/look up with (Req 28.5).
        """
        prefix_len = len(EXERCISES_NAMESPACE)
        return [key[prefix_len:] for key in self._plugins]


def build_exercise_plugin_registry() -> ExercisePluginRegistry:
    """Construct the Exercise_Plugin_Registry.

    Returns an EMPTY registry in V1: the interface and registry exist, but no
    per-exercise plugin logic is registered (Req 17.2, 28.3). Mirrors
    `build_pose_engine_registry` as the single construction entry point.
    """
    return ExercisePluginRegistry()
