"""Variable wall thickness: cubic spline interpolation from control points."""

import numpy as np
from scipy.interpolate import CubicSpline

# Normalized axial positions for the 6 control points
WALL_THICKNESS_POSITIONS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
NUM_WALL_THICKNESS_STATIONS = 6


def interpolate_wall_thickness(
    control_thicknesses: list[float],
    station_x: np.ndarray,
) -> np.ndarray:
    """Cubic spline interpolation of wall thickness over axial stations.

    Args:
        control_thicknesses: thickness (m) at each of the 6 normalized positions
        station_x: actual axial x coordinates (monotonically increasing)

    Returns:
        thickness array of shape (len(station_x),), clamped to [0.5mm, 15mm]
    """
    x_min, x_max = station_x[0], station_x[-1]
    span = x_max - x_min
    if span <= 0:
        return np.full_like(station_x, control_thicknesses[0])

    x_norm = (station_x - x_min) / span

    cs = CubicSpline(WALL_THICKNESS_POSITIONS, control_thicknesses, bc_type='natural')
    thickness = cs(x_norm)

    return np.clip(thickness, 0.0005, 0.015)
