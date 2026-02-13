"""Convert 2D engine profile to 3D mesh data for Three.js frontend."""

import math
import numpy as np
from backend.geometry.parametric_engine import ParametricEngine


def profile_to_lathe_data(profile_2d: np.ndarray, num_circumferential: int = 64) -> dict:
    """Convert a 2D axial profile to 3D lathe vertices.

    profile_2d: array of shape (N, 2+) with columns [x, r, ...]
    Returns dict with 'positions' (flat float list) and 'indices' (flat int list).
    """
    n_axial = len(profile_2d)
    n_circ = num_circumferential

    positions = []
    normals = []
    uvs = []

    for i in range(n_axial):
        x = float(profile_2d[i, 0])
        r = float(profile_2d[i, 1])
        u = i / max(n_axial - 1, 1)

        for j in range(n_circ + 1):
            theta = 2 * math.pi * j / n_circ
            y = r * math.cos(theta)
            z = r * math.sin(theta)
            positions.extend([x, y, z])

            ny = math.cos(theta)
            nz = math.sin(theta)
            normals.extend([0, ny, nz])

            v = j / n_circ
            uvs.extend([u, v])

    indices = []
    for i in range(n_axial - 1):
        for j in range(n_circ):
            a = i * (n_circ + 1) + j
            b = a + 1
            c = (i + 1) * (n_circ + 1) + j
            d = c + 1
            indices.extend([a, c, b, b, c, d])

    return {
        "positions": positions,
        "normals": normals,
        "uvs": uvs,
        "indices": indices,
        "vertex_count": n_axial * (n_circ + 1),
        "index_count": len(indices),
    }


def export_for_frontend(engine: ParametricEngine, num_circumferential: int = 64) -> dict:
    """Export full engine mesh data for the frontend."""
    profile = engine.generate_profile()

    inner_profile = profile[:, :2]
    outer_profile = np.column_stack([profile[:, 0], profile[:, 2]])

    inner_mesh = profile_to_lathe_data(inner_profile, num_circumferential)
    outer_mesh = profile_to_lathe_data(outer_profile, num_circumferential)

    throat_idx = np.argmin(profile[:, 1])
    wall_thickness = profile[:, 2] - profile[:, 1]

    return {
        "inner_wall": inner_mesh,
        "outer_wall": outer_mesh,
        "profile_2d": inner_profile.tolist(),
        "outer_profile_2d": outer_profile.tolist(),
        "throat_x": float(profile[throat_idx, 0]),
        "exit_x": float(profile[-1, 0]),
        "total_length_m": float(profile[-1, 0] - profile[0, 0]),
        "num_stations": len(profile),
        "station_x": profile[:, 0].tolist(),
        "station_r_inner": profile[:, 1].tolist(),
        "station_r_outer": profile[:, 2].tolist(),
        "station_wall_thickness": wall_thickness.tolist(),
        "station_zone": profile[:, 3].astype(int).tolist(),
    }
