"""Per-exercise plugins consumed by the Exercise_Plugin_Registry.

V1 exposes only the `ExercisePlugin` interface and the
`ExercisePluginRegistry` (Req 28); no per-exercise plugin logic is implemented
(Req 17.2, 17.3, 28.3).
"""

from .exercise_plugin import (
    EXERCISES_NAMESPACE,
    ExercisePlugin,
    ExercisePluginRegistry,
    build_exercise_plugin_registry,
)

__all__ = [
    "EXERCISES_NAMESPACE",
    "ExercisePlugin",
    "ExercisePluginRegistry",
    "build_exercise_plugin_registry",
]
