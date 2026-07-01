"""
Smoothing_Adapter — replaceable landmark-smoothing algorithm interface & registry
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A `Smoothing_Algorithm` is a swappable temporal filter that reduces landmark
noise behind a single interface (Req 25.1). This module mirrors the proven
`PoseEngine`/registry convention in `pose_engines.py` and the
`VisionBackend`/`VisionAdapter` convention in `app/vision/`:

  • `SmoothingAlgorithm` is an ABC with a single `smooth(landmarks)` method
    that accepts raw per-frame landmarks and returns smoothed ones (Req 25.1).
  • Concrete algorithms are registered ONCE in a registry keyed by `name`
    (one_euro | kalman | savitzky_golay | moving_average), analogous to
    `build_pose_engine_registry`.
  • The active algorithm is selected by configuration
    (`settings.SMOOTHING_ALGORITHM`) inside the `Smoothing_Adapter` stage, so
    swapping algorithms needs no change to any other Pipeline_Stage
    (Req 25.2, 25.3, 25.5).

Structure-preserving contract (Req 25.2, 25.3):
Every algorithm operates additively and MUST return a list with exactly the
same number of frames as its input, and each output frame MUST carry exactly
the same number of landmarks as the corresponding input frame. Per-frame
metadata that is not a smoothed coordinate — `timestamp_ms`, per-landmark
`confidence`, and `overall_confidence` — is preserved verbatim. Smoothing
touches only the spatial coordinates (x, y, z); x/y stay clamped to the
normalized [0, 1] range required by the `Landmark` contract (Req 7.4).

Smoothing is purely numerical — it performs NO language-model reasoning.
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod

from ..contracts import FrameLandmarks, Landmark


def _clamp_unit(value: float) -> float:
    """Clamp a normalized coordinate back into the [0, 1] range (Req 7.4)."""
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


class SmoothingAlgorithm(ABC):
    """Abstract base every swappable landmark-smoothing filter must implement.

    Mirrors `pose_engines.PoseEngine`. Implementations expose a single
    `smooth` interface (Req 25.1) and MUST preserve input structure and length
    (Req 25.2, 25.3): same number of frames, same number of landmarks per
    frame, with non-coordinate metadata carried through unchanged.
    """

    #: Stable identifier, e.g. "one_euro", "kalman", "savitzky_golay",
    #: "moving_average". Used as the registry key and config selector value.
    name: str = "base"

    @abstractmethod
    def smooth(self, landmarks: list[FrameLandmarks]) -> list[FrameLandmarks]:
        """Return temporally smoothed landmarks (same structure & length)."""
        raise NotImplementedError


class _StreamSmoothingAlgorithm(SmoothingAlgorithm):
    """
    Shared machinery for algorithms expressed as an independent 1-D filter over
    each landmark's coordinate time series.

    This base extracts, for every landmark index, the per-frame (timestamp,
    value) stream for each of x/y/z, delegates to the concrete `_filter_stream`
    implementation, and rebuilds the frames — guaranteeing the
    structure-/length-preserving contract (Req 25.2, 25.3) in one place so each
    algorithm only has to define its 1-D filter.
    """

    def smooth(self, landmarks: list[FrameLandmarks]) -> list[FrameLandmarks]:
        n_frames = len(landmarks)
        if n_frames == 0:
            return []

        # Timestamps drive time-aware filters (e.g. One Euro). Seconds, relative.
        times = [fl.timestamp_ms / 1000.0 for fl in landmarks]

        # Per landmark index, the frames that actually carry that index. Frame
        # landmark counts may differ; we only ever smooth across the frames that
        # share an index, and we write each value back into its own frame so the
        # per-frame count is preserved exactly (Req 25.2).
        max_landmarks = max((len(fl.landmarks) for fl in landmarks), default=0)

        # smoothed[f] accumulates the new Landmark objects for frame f.
        smoothed_coords: list[list[Landmark]] = [
            [None] * len(landmarks[f].landmarks) for f in range(n_frames)  # type: ignore[list-item]
        ]

        for j in range(max_landmarks):
            frame_idxs: list[int] = []
            xs: list[float] = []
            ys: list[float] = []
            zs: list[float] = []
            ts: list[float] = []
            for f in range(n_frames):
                fl = landmarks[f]
                if j < len(fl.landmarks):
                    lm = fl.landmarks[j]
                    frame_idxs.append(f)
                    xs.append(lm.x)
                    ys.append(lm.y)
                    zs.append(lm.z)
                    ts.append(times[f])

            sx = self._filter_stream(xs, ts)
            sy = self._filter_stream(ys, ts)
            sz = self._filter_stream(zs, ts)

            for k, f in enumerate(frame_idxs):
                original = landmarks[f].landmarks[j]
                smoothed_coords[f][j] = Landmark(
                    x=_clamp_unit(sx[k]),
                    y=_clamp_unit(sy[k]),
                    z=sz[k],
                    confidence=original.confidence,  # metadata preserved (Req 25.2)
                )

        return [
            FrameLandmarks(
                timestamp_ms=landmarks[f].timestamp_ms,
                landmarks=smoothed_coords[f],
                overall_confidence=landmarks[f].overall_confidence,
            )
            for f in range(n_frames)
        ]

    @abstractmethod
    def _filter_stream(self, values: list[float], times: list[float]) -> list[float]:
        """Filter a single coordinate time series; returns a same-length list."""
        raise NotImplementedError


class MovingAverageSmoothing(_StreamSmoothingAlgorithm):
    """
    Centered moving-average filter (Req 25.2).

    Each output sample is the mean of the values within a symmetric window. The
    window is truncated at the stream boundaries so the output length always
    equals the input length.
    """

    name = "moving_average"

    def __init__(self, window: int = 5) -> None:
        # Force an odd window >= 1 so the average is centered.
        self.window = max(1, window if window % 2 == 1 else window - 1)

    def _filter_stream(self, values: list[float], times: list[float]) -> list[float]:
        n = len(values)
        if n == 0:
            return []
        half = self.window // 2
        out: list[float] = []
        for i in range(n):
            lo = max(0, i - half)
            hi = min(n, i + half + 1)
            window = values[lo:hi]
            out.append(sum(window) / len(window))
        return out


class OneEuroSmoothing(_StreamSmoothingAlgorithm):
    """
    One Euro Filter (Casiez et al.) — an adaptive low-pass filter that trades
    jitter for lag based on the signal's speed (Req 25.2).

    Uses per-frame timestamps for its time constant; when timestamps are
    missing or non-increasing it falls back to a unit time step so the filter
    stays well-defined.
    """

    name = "one_euro"

    def __init__(
        self,
        min_cutoff: float = 1.0,
        beta: float = 0.0,
        d_cutoff: float = 1.0,
    ) -> None:
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1.0 / (2.0 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def _filter_stream(self, values: list[float], times: list[float]) -> list[float]:
        n = len(values)
        if n == 0:
            return []

        out: list[float] = [values[0]]
        x_prev = values[0]
        dx_prev = 0.0
        t_prev = times[0] if times else 0.0

        for i in range(1, n):
            t = times[i] if i < len(times) else t_prev + 1.0
            dt = t - t_prev
            if dt <= 0.0:
                dt = 1.0  # non-increasing timestamps → unit step fallback

            # Filtered derivative.
            dx = (values[i] - x_prev) / dt
            a_d = self._alpha(self.d_cutoff, dt)
            dx_hat = a_d * dx + (1.0 - a_d) * dx_prev

            # Adaptive cutoff and filtered value.
            cutoff = self.min_cutoff + self.beta * abs(dx_hat)
            a = self._alpha(cutoff, dt)
            x_hat = a * values[i] + (1.0 - a) * x_prev

            out.append(x_hat)
            x_prev = x_hat
            dx_prev = dx_hat
            t_prev = t

        return out


class KalmanSmoothing(_StreamSmoothingAlgorithm):
    """
    Scalar constant-position Kalman filter (Req 25.2).

    A lightweight 1-D Kalman filter per coordinate stream: it balances the
    process noise (`q`) against the measurement noise (`r`) to produce a smooth
    estimate that tracks the underlying signal.
    """

    name = "kalman"

    def __init__(self, process_noise: float = 1e-3, measurement_noise: float = 1e-2) -> None:
        self.q = process_noise
        self.r = measurement_noise

    def _filter_stream(self, values: list[float], times: list[float]) -> list[float]:
        n = len(values)
        if n == 0:
            return []

        x_est = values[0]      # state estimate
        p = 1.0                # estimate covariance
        out: list[float] = []
        for z in values:
            # Predict (constant-position model): state unchanged, covariance grows.
            p += self.q
            # Update with measurement z.
            k = p / (p + self.r)          # Kalman gain
            x_est = x_est + k * (z - x_est)
            p = (1.0 - k) * p
            out.append(x_est)
        return out


class SavitzkyGolaySmoothing(_StreamSmoothingAlgorithm):
    """
    Savitzky-Golay filter (Req 25.2): fits a low-order polynomial over a sliding
    window by least squares and evaluates it at the window center, preserving
    higher-moment features (peaks/valleys) better than a plain moving average.

    Implemented with a self-contained least-squares solve (no SciPy dependency).
    The window is truncated near the stream boundaries and degrades to a shorter
    fit (or the raw value) so the output length always equals the input length.
    """

    name = "savitzky_golay"

    def __init__(self, window: int = 5, polyorder: int = 2) -> None:
        self.window = max(1, window if window % 2 == 1 else window - 1)
        self.polyorder = max(0, polyorder)

    def _filter_stream(self, values: list[float], times: list[float]) -> list[float]:
        n = len(values)
        if n == 0:
            return []
        half = self.window // 2
        out: list[float] = []
        for i in range(n):
            lo = max(0, i - half)
            hi = min(n, i + half + 1)
            window = values[lo:hi]
            # Local x positions centered on i so we evaluate the fit at x = 0.
            xs = [float(idx - i) for idx in range(lo, hi)]
            order = min(self.polyorder, len(window) - 1)
            if order <= 0:
                # Not enough points to fit → fall back to the window mean.
                out.append(sum(window) / len(window))
                continue
            coeffs = _polyfit(xs, window, order)
            # Polynomial value at x = 0 is simply the constant term.
            out.append(coeffs[0])
        return out


def _polyfit(xs: list[float], ys: list[float], order: int) -> list[float]:
    """
    Least-squares polynomial fit returning coefficients [c0, c1, ..., c_order]
    (ascending powers). Solves the normal equations with Gaussian elimination —
    a small, self-contained linear solve (no NumPy/SciPy needed).
    """
    m = order + 1
    # Build the normal-equation matrix A (m x m) and vector b (m).
    # Powers of x up to 2*order are needed for the moment sums.
    power_sums = [0.0] * (2 * order + 1)
    for x in xs:
        p = 1.0
        for k in range(2 * order + 1):
            power_sums[k] += p
            p *= x
    b = [0.0] * m
    for k in range(m):
        s = 0.0
        for x, y in zip(xs, ys):
            s += (x ** k) * y
        b[k] = s
    a = [[power_sums[i + j] for j in range(m)] for i in range(m)]
    return _solve(a, b)


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    """Solve the linear system a·x = b via Gaussian elimination with pivoting."""
    n = len(b)
    # Augmented matrix.
    mat = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        # Partial pivot.
        pivot = max(range(col, n), key=lambda r: abs(mat[r][col]))
        if abs(mat[pivot][col]) < 1e-12:
            # Singular/degenerate column → treat coefficient as 0.
            continue
        mat[col], mat[pivot] = mat[pivot], mat[col]
        piv = mat[col][col]
        for k in range(col, n + 1):
            mat[col][k] /= piv
        for r in range(n):
            if r != col and abs(mat[r][col]) > 1e-12:
                factor = mat[r][col]
                for k in range(col, n + 1):
                    mat[r][k] -= factor * mat[col][k]
    return [mat[i][n] for i in range(n)]


def build_smoothing_registry() -> dict[str, SmoothingAlgorithm]:
    """
    Instantiate every known `Smoothing_Algorithm` ONCE (singletons), keyed by
    `name`.

    Adding a new algorithm = implement `SmoothingAlgorithm` and register it
    here; nothing else in the pipeline changes (Req 25.2, 25.3). Mirrors
    `build_pose_engine_registry`.
    """
    algorithms: list[SmoothingAlgorithm] = [
        OneEuroSmoothing(),
        KalmanSmoothing(),
        SavitzkyGolaySmoothing(),
        MovingAverageSmoothing(),
    ]
    return {algo.name: algo for algo in algorithms}


#: Names of all smoothing algorithms known to the registry (validation/diagnostics).
SMOOTHING_ALGORITHM_NAMES: tuple[str, ...] = (
    "one_euro",
    "kalman",
    "savitzky_golay",
    "moving_average",
)
