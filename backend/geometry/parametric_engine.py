"""Parametric rocket engine geometry: converts parameter vector to physical profile."""

import math
import numpy as np
from backend.geometry.contour import full_engine_contour
from backend.geometry.wall_thickness import interpolate_wall_thickness
from backend.config import GENOME_BOUNDS, GENE_NAMES, NUM_PROFILE_STATIONS


class ParametricEngine:
    """Converts a parameter vector into a rocket engine geometry profile.

    Supports variable wall thickness via 6 cubic-spline control points.
    """

    def __init__(self, chamber_diameter: float = 0.08, chamber_length: float = 0.12,
                 throat_diameter: float = 0.03, expansion_ratio: float = 8.0,
                 wt_cp0: float = 0.003, wt_cp1: float = 0.003,
                 wt_cp2: float = 0.003, wt_cp3: float = 0.003,
                 wt_cp4: float = 0.003, wt_cp5: float = 0.003,
                 convergence_half_angle: float = 30.0,
                 throat_upstream_radius_ratio: float = 1.5,
                 throat_downstream_radius_ratio: float = 0.4,
                 bell_fraction: float = 80.0,
                 contour_cp1_y: float = 0.5, contour_cp2_y: float = 0.5):
        self.chamber_diameter = chamber_diameter
        self.chamber_length = chamber_length
        self.throat_diameter = throat_diameter
        self.expansion_ratio = expansion_ratio
        self.wt_cp0 = wt_cp0
        self.wt_cp1 = wt_cp1
        self.wt_cp2 = wt_cp2
        self.wt_cp3 = wt_cp3
        self.wt_cp4 = wt_cp4
        self.wt_cp5 = wt_cp5
        self.convergence_half_angle = convergence_half_angle
        self.throat_upstream_radius_ratio = throat_upstream_radius_ratio
        self.throat_downstream_radius_ratio = throat_downstream_radius_ratio
        self.bell_fraction = bell_fraction
        self.contour_cp1_y = contour_cp1_y
        self.contour_cp2_y = contour_cp2_y

    @property
    def wall_thickness_control_points(self) -> list[float]:
        return [self.wt_cp0, self.wt_cp1, self.wt_cp2,
                self.wt_cp3, self.wt_cp4, self.wt_cp5]

    @property
    def mean_wall_thickness(self) -> float:
        return sum(self.wall_thickness_control_points) / 6.0

    def generate_profile(self, num_stations: int = NUM_PROFILE_STATIONS) -> np.ndarray:
        """Generate the engine profile.

        Returns array of shape (num_stations, 4): [x, r_inner, r_outer, zone_id]
        """
        contour = full_engine_contour(
            self.chamber_diameter, self.chamber_length,
            self.throat_diameter, self.expansion_ratio,
            self.convergence_half_angle,
            self.throat_upstream_radius_ratio,
            self.throat_downstream_radius_ratio,
            self.bell_fraction,
            self.contour_cp1_y, self.contour_cp2_y,
            num_stations
        )

        station_x = contour[:, 0]
        station_r_inner = contour[:, 1]

        # Variable wall thickness via cubic spline interpolation
        thickness = interpolate_wall_thickness(
            self.wall_thickness_control_points, station_x
        )

        r_outer = station_r_inner + thickness
        profile = np.column_stack([
            station_x,       # x
            station_r_inner, # r_inner
            r_outer,         # r_outer
            contour[:, 2],   # zone_id
        ])
        return profile

    @property
    def throat_area(self) -> float:
        """Cross-sectional area at the throat (m^2)."""
        return math.pi * (self.throat_diameter / 2) ** 2

    @property
    def exit_area(self) -> float:
        """Cross-sectional area at the nozzle exit (m^2)."""
        return self.throat_area * self.expansion_ratio

    @property
    def exit_diameter(self) -> float:
        return self.throat_diameter * math.sqrt(self.expansion_ratio)

    @property
    def chamber_area(self) -> float:
        return math.pi * (self.chamber_diameter / 2) ** 2

    def chamber_volume(self) -> float:
        """Volume of the cylindrical combustion chamber (m^3)."""
        return self.chamber_area * self.chamber_length

    def total_mass(self, density: float) -> float:
        """Approximate total wall mass given material density (kg)."""
        profile = self.generate_profile()
        mass = 0.0
        for i in range(1, len(profile)):
            dx = profile[i, 0] - profile[i - 1, 0]
            r_inner = (profile[i, 1] + profile[i - 1, 1]) / 2
            r_outer = (profile[i, 2] + profile[i - 1, 2]) / 2
            dV = math.pi * (r_outer ** 2 - r_inner ** 2) * dx
            mass += density * dV
        return mass

    def to_genome(self) -> list[float]:
        """Serialize to the shape portion of the genome (genes 0-15)."""
        return [
            self.chamber_diameter, self.chamber_length,
            self.throat_diameter, self.expansion_ratio,
            self.wt_cp0, self.wt_cp1, self.wt_cp2,
            self.wt_cp3, self.wt_cp4, self.wt_cp5,
            self.convergence_half_angle,
            self.throat_upstream_radius_ratio,
            self.throat_downstream_radius_ratio,
            self.bell_fraction,
            self.contour_cp1_y, self.contour_cp2_y,
        ]

    @classmethod
    def from_genome(cls, genome: list[float]) -> "ParametricEngine":
        """Reconstruct from a genome vector (uses first 16 genes)."""
        shape_names = GENE_NAMES[:16]
        kwargs = dict(zip(shape_names, genome[:16]))
        return cls(**kwargs)

    @classmethod
    def from_dict(cls, d: dict) -> "ParametricEngine":
        """Construct from a dictionary of parameters.

        Supports both old format (wall_thickness scalar) and new format (wt_cp* control points).
        """
        d = dict(d)  # don't mutate original
        # Backward compatibility: convert scalar wall_thickness to 6 CPs
        if "wall_thickness" in d and "wt_cp0" not in d:
            wt = d.pop("wall_thickness")
            for i in range(6):
                d[f"wt_cp{i}"] = wt

        shape_names = set(GENE_NAMES[:16])
        filtered = {k: v for k, v in d.items() if k in shape_names}
        return cls(**filtered)

    def to_dict(self) -> dict:
        shape_names = GENE_NAMES[:16]
        return dict(zip(shape_names, self.to_genome()))
