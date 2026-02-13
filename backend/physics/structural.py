"""Structural stress analysis: thick-wall pressure, thermal stress, von Mises."""

import math
import numpy as np


def hoop_stress_thick_wall(P_internal: float, r_inner: float, r_outer: float) -> float:
    """Maximum hoop stress at inner wall (Lame equation) (Pa).
    sigma_theta = P * (r_o^2 + r_i^2) / (r_o^2 - r_i^2)
    """
    if r_outer <= r_inner:
        return 0.0
    return P_internal * (r_outer ** 2 + r_inner ** 2) / (r_outer ** 2 - r_inner ** 2)


def radial_stress_inner(P_internal: float) -> float:
    """Radial stress at inner wall surface (Pa). sigma_r = -P (compressive)."""
    return -P_internal


def axial_stress_closed_end(P_internal: float, r_inner: float, r_outer: float) -> float:
    """Longitudinal/axial stress for closed-end cylinder (Pa).
    sigma_z = P * r_i^2 / (r_o^2 - r_i^2)
    """
    if r_outer <= r_inner:
        return 0.0
    return P_internal * r_inner ** 2 / (r_outer ** 2 - r_inner ** 2)


def thermal_hoop_stress(alpha: float, E: float, nu: float, delta_T: float) -> float:
    """Thermal hoop stress at inner wall (compressive on hot side) (Pa).
    sigma_thermal = -alpha * E * delta_T / (2 * (1 - nu))
    """
    if (1 - nu) == 0:
        return 0.0
    return -alpha * E * delta_T / (2 * (1 - nu))


def von_mises_stress(sigma_r: float, sigma_theta: float, sigma_z: float) -> float:
    """Von Mises equivalent stress (Pa).
    sigma_vm = sqrt(0.5 * ((sr-st)^2 + (st-sz)^2 + (sz-sr)^2))
    """
    return math.sqrt(0.5 * ((sigma_r - sigma_theta) ** 2 +
                             (sigma_theta - sigma_z) ** 2 +
                             (sigma_z - sigma_r) ** 2))


def safety_factor(sigma_vm: float, sigma_yield: float) -> float:
    """Safety factor SF = sigma_yield / sigma_vm."""
    if sigma_vm <= 0:
        return 99.0  # effectively infinite
    return sigma_yield / sigma_vm


def compute_structural_analysis(station_r_inner: np.ndarray,
                                 station_r_outer: np.ndarray,
                                 pressure_Pa: np.ndarray,
                                 wall_temp_inner_K: np.ndarray,
                                 wall_temp_outer_K: np.ndarray,
                                 yield_strength_Pa: float,
                                 elastic_modulus_Pa: float,
                                 thermal_expansion: float,
                                 poissons_ratio: float,
                                 effective_r_outer: np.ndarray = None) -> dict:
    """Compute stress distribution along the engine.

    If effective_r_outer is provided, it is used instead of station_r_outer
    for stress calculations (accounts for cooling channel voids).

    Returns dict with arrays: von_mises_MPa, safety_factor,
    hoop_stress_MPa, thermal_stress_MPa,
    and scalars: min_safety_factor, max_von_mises_MPa.
    """
    n = len(station_r_inner)
    r_outer_for_stress = effective_r_outer if effective_r_outer is not None else station_r_outer

    vm_stress = np.zeros(n)
    sf = np.zeros(n)
    hoop = np.zeros(n)
    thermal = np.zeros(n)

    for i in range(n):
        r_i = station_r_inner[i]
        r_o = r_outer_for_stress[i]
        P = pressure_Pa[i]
        delta_T = wall_temp_inner_K[i] - wall_temp_outer_K[i]
        
        # Pressure stresses
        s_theta_p = hoop_stress_thick_wall(P, r_i, r_o)
        s_r = radial_stress_inner(P)
        s_z = axial_stress_closed_end(P, r_i, r_o)
        
        # Thermal stress
        s_theta_t = thermal_hoop_stress(thermal_expansion, elastic_modulus_Pa,
                                         poissons_ratio, delta_T)
        
        # Combined
        s_theta_total = s_theta_p + s_theta_t
        
        vm = von_mises_stress(s_r, s_theta_total, s_z)
        
        vm_stress[i] = vm
        sf[i] = safety_factor(vm, yield_strength_Pa)
        hoop[i] = s_theta_p
        thermal[i] = s_theta_t
    
    return {
        "von_mises_MPa": vm_stress / 1e6,
        "safety_factor": sf,
        "hoop_stress_MPa": hoop / 1e6,
        "thermal_stress_MPa": thermal / 1e6,
        "min_safety_factor": float(np.min(sf)),
        "min_sf_station_index": int(np.argmin(sf)),
        "max_von_mises_MPa": float(np.max(vm_stress) / 1e6),
    }
