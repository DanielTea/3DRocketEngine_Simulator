"""Effective structural properties accounting for cooling channel voids.

When cooling channels are machined into the wall, the effective structural
cross-section is reduced. This module computes the effective outer radius
and void fraction for use in structural analysis.
"""

import math
import numpy as np


def compute_void_fraction(n_channels: int, channel_width: float,
                          rib_width: float, r_outer: float) -> float:
    """Fraction of the circumference occupied by cooling channels.

    void_fraction = n_channels * channel_width / (2 * pi * r_outer)
    """
    circumference = 2.0 * math.pi * r_outer
    if circumference <= 0:
        return 0.0
    total_channel_width = n_channels * channel_width
    return min(total_channel_width / circumference, 0.85)


def effective_wall_thickness(wall_thickness: float, channel_height: float,
                              void_fraction: float,
                              rib_thickness_factor: float = 0.5) -> float:
    """Effective structural wall thickness considering cooling voids.

    The ribs between channels provide some structural support (captured by
    rib_thickness_factor), while the channels reduce the effective section.

    effective_t = t_wall - channel_height * void_fraction * (1 - rib_factor)
    """
    reduction = channel_height * void_fraction * (1.0 - rib_thickness_factor)
    return max(wall_thickness - reduction, wall_thickness * 0.3)


def compute_effective_r_outer(station_r_inner: np.ndarray,
                               station_r_outer: np.ndarray,
                               n_channels: int,
                               channel_width: float,
                               channel_height: float,
                               rib_width: float,
                               rib_thickness_factor: float = 0.5) -> np.ndarray:
    """Compute effective outer radius per station for structural analysis.

    Returns array of effective r_outer values that account for the
    weakening effect of cooling channels in the wall.
    """
    n = len(station_r_inner)
    effective_r = np.zeros(n)

    for i in range(n):
        r_i = station_r_inner[i]
        r_o = station_r_outer[i]
        t_wall = r_o - r_i

        vf = compute_void_fraction(n_channels, channel_width, rib_width, r_o)
        t_eff = effective_wall_thickness(t_wall, channel_height, vf, rib_thickness_factor)
        effective_r[i] = r_i + t_eff

    return effective_r
