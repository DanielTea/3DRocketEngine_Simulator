"""Global configuration and constants for the rocket engine simulator."""

import math
from dataclasses import dataclass, field


# Physical constants
G0 = 9.80665  # m/s^2, standard gravity
R_UNIVERSAL = 8.314462  # J/(mol*K)
SIGMA_SB = 5.670374419e-8  # W/(m^2*K^4), Stefan-Boltzmann constant
ATMOSPHERIC_PRESSURE = 101325.0  # Pa


@dataclass
class PropellantDefaults:
    gamma: float = 1.25
    molecular_weight: float = 0.022  # kg/mol (approximate for LOX/RP-1)
    chamber_temperature_K: float = 3400.0
    chamber_pressure_Pa: float = 3_000_000.0


@dataclass
class GeometryDefaults:
    chamber_diameter: float = 0.08  # m
    chamber_length: float = 0.12  # m
    throat_diameter: float = 0.03  # m
    expansion_ratio: float = 8.0
    # Variable wall thickness: 6 control points at normalized positions [0, 0.2, 0.4, 0.6, 0.8, 1.0]
    wt_cp0: float = 0.003  # m (chamber end)
    wt_cp1: float = 0.003
    wt_cp2: float = 0.003
    wt_cp3: float = 0.003
    wt_cp4: float = 0.003
    wt_cp5: float = 0.003  # m (nozzle exit)
    convergence_half_angle: float = 30.0  # degrees
    throat_upstream_radius_ratio: float = 1.5
    throat_downstream_radius_ratio: float = 0.4
    bell_fraction: float = 80.0  # percent
    contour_cp1_y: float = 0.5
    contour_cp2_y: float = 0.5


@dataclass
class CoolingDefaults:
    n_channels: int = 60
    channel_width: float = 0.002   # m
    channel_height: float = 0.003  # m
    rib_width: float = 0.001       # m
    coolant_mdot: float = 1.0      # kg/s
    rib_thickness_factor: float = 0.5  # 0-1, structural rib effect


@dataclass
class GADefaults:
    population_size: int = 50
    num_generations: int = 100
    crossover_prob: float = 0.7
    mutation_prob: float = 0.3
    elite_fraction: float = 0.05


# ── Genome definition: 25 genes total ──
# Genes 0-3: shape basics
# Genes 4-9: wall thickness control points (variable thickness)
# Genes 10-15: shape refinements
# Genes 16-21: cooling channel parameters
# Genes 22-24: channel height axial control points
GENOME_BOUNDS = [
    (0.02, 0.30),    # [0]  chamber_diameter (m)
    (0.03, 0.50),    # [1]  chamber_length (m)
    (0.008, 0.15),   # [2]  throat_diameter (m)
    (2.0, 80.0),     # [3]  expansion_ratio
    (0.001, 0.015),  # [4]  wt_cp0 — wall thickness at x=0.0 (m)
    (0.001, 0.015),  # [5]  wt_cp1 — wall thickness at x=0.2
    (0.001, 0.015),  # [6]  wt_cp2 — wall thickness at x=0.4
    (0.001, 0.015),  # [7]  wt_cp3 — wall thickness at x=0.6
    (0.001, 0.015),  # [8]  wt_cp4 — wall thickness at x=0.8
    (0.001, 0.015),  # [9]  wt_cp5 — wall thickness at x=1.0
    (15.0, 60.0),    # [10] convergence_half_angle (deg)
    (0.5, 2.0),      # [11] throat_upstream_radius_ratio
    (0.2, 1.0),      # [12] throat_downstream_radius_ratio
    (60.0, 100.0),   # [13] bell_fraction (%)
    (0.0, 1.0),      # [14] contour_cp1_y
    (0.0, 1.0),      # [15] contour_cp2_y
    (10.0, 200.0),   # [16] n_channels
    (0.0005, 0.006), # [17] channel_width (m)
    (0.0005, 0.008), # [18] channel_height (m)
    (0.0005, 0.004), # [19] rib_width (m)
    (0.1, 5.0),      # [20] coolant_mdot (kg/s)
    (0.1, 1.0),      # [21] rib_thickness_factor
    (0.0005, 0.008), # [22] ch_height_cp0 — channel height at chamber end (m)
    (0.0005, 0.008), # [23] ch_height_cp1 — channel height at midpoint (m)
    (0.0005, 0.008), # [24] ch_height_cp2 — channel height at nozzle exit (m)
]

GENE_NAMES = [
    "chamber_diameter", "chamber_length", "throat_diameter", "expansion_ratio",
    "wt_cp0", "wt_cp1", "wt_cp2", "wt_cp3", "wt_cp4", "wt_cp5",
    "convergence_half_angle", "throat_upstream_radius_ratio",
    "throat_downstream_radius_ratio", "bell_fraction",
    "contour_cp1_y", "contour_cp2_y",
    "n_channels", "channel_width", "channel_height", "rib_width",
    "coolant_mdot", "rib_thickness_factor",
    "ch_height_cp0", "ch_height_cp1", "ch_height_cp2",
]

# Index ranges for genome slicing
SHAPE_GENE_INDICES = list(range(0, 16))       # engine shape + wall thickness
COOLING_GENE_INDICES = list(range(16, 25))     # cooling system params (incl. channel height CPs)

NUM_PROFILE_STATIONS = 200

SERVER_HOST = "0.0.0.0"
SERVER_PORT = 8000
