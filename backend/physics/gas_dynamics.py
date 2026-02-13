"""Quasi-1D compressible nozzle flow: isentropic relations, area-Mach, shocks."""

import math
import numpy as np
from scipy.optimize import brentq
from backend.config import R_UNIVERSAL


def isentropic_temperature_ratio(M: float, gamma: float) -> float:
    """T/T0 = (1 + (gamma-1)/2 * M^2)^(-1)."""
    return (1 + (gamma - 1) / 2 * M ** 2) ** (-1)


def isentropic_pressure_ratio(M: float, gamma: float) -> float:
    """P/P0 = (1 + (gamma-1)/2 * M^2)^(-gamma/(gamma-1))."""
    return (1 + (gamma - 1) / 2 * M ** 2) ** (-gamma / (gamma - 1))


def isentropic_density_ratio(M: float, gamma: float) -> float:
    """rho/rho0 = (1 + (gamma-1)/2 * M^2)^(-1/(gamma-1))."""
    return (1 + (gamma - 1) / 2 * M ** 2) ** (-1 / (gamma - 1))


def area_mach_function(M: float, gamma: float) -> float:
    """Compute (A/A*)^2 as a function of Mach number.
    
    (A/A*)^2 = (1/M^2) * [(2/(gamma+1)) * (1 + (gamma-1)/2 * M^2)]^((gamma+1)/(gamma-1))
    """
    if M <= 0:
        return float('inf')
    exponent = (gamma + 1) / (gamma - 1)
    term = (2 / (gamma + 1)) * (1 + (gamma - 1) / 2 * M ** 2)
    return (1 / M ** 2) * term ** exponent


def area_mach_relation(area_ratio: float, gamma: float, supersonic: bool = False) -> float:
    """Solve for Mach number given A/A* (area ratio).
    
    Returns the subsonic root by default, or supersonic if supersonic=True.
    """
    if area_ratio < 1.0:
        area_ratio = 1.0
    
    if abs(area_ratio - 1.0) < 1e-10:
        return 1.0
    
    target = area_ratio ** 2
    
    def residual(M):
        return area_mach_function(M, gamma) - target
    
    if supersonic:
        # Supersonic root: M > 1
        # area_mach_function increases with M for M > 1, so residual goes from
        # negative (near M=1) to positive (large M). Find M_high where residual > 0.
        M_high = 2.0
        while residual(M_high) < 0:
            M_high *= 2
            if M_high > 200:
                break
        return brentq(residual, 1.0001, M_high, xtol=1e-10)
    else:
        # Subsonic root: 0 < M < 1
        return brentq(residual, 0.001, 0.9999, xtol=1e-10)


def normal_shock_relations(M1: float, gamma: float) -> dict:
    """Compute flow properties across a normal shock.
    
    Returns dict with M2, P2_over_P1, T2_over_T1, rho2_over_rho1.
    """
    if M1 <= 1.0:
        return {"M2": M1, "P2_over_P1": 1.0, "T2_over_T1": 1.0, "rho2_over_rho1": 1.0}
    
    M2_sq = (1 + (gamma - 1) / 2 * M1 ** 2) / (gamma * M1 ** 2 - (gamma - 1) / 2)
    M2 = math.sqrt(max(M2_sq, 0))
    
    P2_over_P1 = 1 + 2 * gamma / (gamma + 1) * (M1 ** 2 - 1)
    
    rho2_over_rho1 = ((gamma + 1) * M1 ** 2) / (2 + (gamma - 1) * M1 ** 2)
    
    T2_over_T1 = P2_over_P1 / rho2_over_rho1
    
    return {
        "M2": M2,
        "P2_over_P1": P2_over_P1,
        "T2_over_T1": T2_over_T1,
        "rho2_over_rho1": rho2_over_rho1,
    }


def solve_nozzle_flow(station_x: np.ndarray, station_r: np.ndarray,
                      throat_r: float, gamma: float, R_specific: float,
                      P0: float, T0: float, P_back: float) -> dict:
    """Solve the quasi-1D isentropic flow through the nozzle.
    
    Args:
        station_x: axial positions (m)
        station_r: inner radius at each station (m)
        throat_r: throat radius (m)
        gamma: ratio of specific heats
        R_specific: specific gas constant (J/(kg*K))
        P0: stagnation/chamber pressure (Pa)
        T0: stagnation/chamber temperature (K)
        P_back: back/ambient pressure (Pa)
    
    Returns dict with arrays: mach, pressure, temperature, velocity, density
    """
    n = len(station_x)
    A_throat = math.pi * throat_r ** 2
    
    # Find throat index (minimum radius)
    throat_idx = np.argmin(station_r)
    
    # Compute area ratios
    areas = math.pi * station_r ** 2
    area_ratios = areas / A_throat
    
    # Determine flow regime based on pressure ratio
    # For a rocket nozzle, if chamber pressure is high enough to choke the throat,
    # the divergent section has supersonic flow. The critical pressure ratio for
    # choking is (2/(gamma+1))^(gamma/(gamma-1)).
    critical_ratio = (2 / (gamma + 1)) ** (gamma / (gamma - 1))
    choked = P0 * critical_ratio > P_back  # throat pressure > back pressure
    fully_supersonic = choked  # supersonic in divergent section if choked
    
    # Solve Mach at each station
    mach = np.zeros(n)
    pressure = np.zeros(n)
    temperature = np.zeros(n)
    velocity = np.zeros(n)
    density = np.zeros(n)
    
    rho0 = P0 / (R_specific * T0)
    
    for i in range(n):
        ar = max(area_ratios[i], 1.0)
        
        if i <= throat_idx:
            # Subsonic in convergent section
            try:
                M = area_mach_relation(ar, gamma, supersonic=False)
            except Exception:
                M = 0.01
        elif fully_supersonic:
            # Supersonic in divergent section
            try:
                M = area_mach_relation(ar, gamma, supersonic=True)
            except Exception:
                M = 1.0
        else:
            # Subsonic throughout (not choked) or shock present
            # Simplified: assume subsonic for now
            try:
                M = area_mach_relation(ar, gamma, supersonic=False)
            except Exception:
                M = 0.01
        
        mach[i] = M
        pressure[i] = isentropic_pressure_ratio(M, gamma) * P0
        temperature[i] = isentropic_temperature_ratio(M, gamma) * T0
        velocity[i] = M * math.sqrt(gamma * R_specific * temperature[i])
        density[i] = isentropic_density_ratio(M, gamma) * rho0
    
    # Force Mach = 1 at throat
    mach[throat_idx] = 1.0
    pressure[throat_idx] = isentropic_pressure_ratio(1.0, gamma) * P0
    temperature[throat_idx] = isentropic_temperature_ratio(1.0, gamma) * T0
    velocity[throat_idx] = math.sqrt(gamma * R_specific * temperature[throat_idx])
    density[throat_idx] = isentropic_density_ratio(1.0, gamma) * rho0
    
    return {
        "mach": mach,
        "pressure_Pa": pressure,
        "temperature_K": temperature,
        "velocity_m_s": velocity,
        "density_kg_m3": density,
        "area_ratio": area_ratios,
        "throat_index": int(throat_idx),
    }


def compute_thrust(mdot: float, V_exit: float, P_exit: float,
                   P_ambient: float, A_exit: float) -> float:
    """Compute thrust from momentum and pressure terms.
    
    F = mdot * V_e + (P_e - P_a) * A_e
    """
    return mdot * V_exit + (P_exit - P_ambient) * A_exit


def compute_specific_impulse(thrust: float, mdot: float) -> float:
    """Isp = F / (mdot * g0)."""
    from backend.config import G0
    if mdot <= 0:
        return 0.0
    return thrust / (mdot * G0)
