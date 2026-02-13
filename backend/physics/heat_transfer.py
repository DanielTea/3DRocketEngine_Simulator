"""Heat transfer model: Bartz convection, radiation, wall conduction."""

import math
import numpy as np
from backend.config import SIGMA_SB


def prandtl_number(gamma: float) -> float:
    """Estimate Prandtl number for combustion gases.
    Pr = 4*gamma / (9*gamma - 5)
    """
    return 4 * gamma / (9 * gamma - 5)


def gas_viscosity(molecular_weight: float, T0: float) -> float:
    """Estimate dynamic viscosity at stagnation conditions (Pa*s).
    mu_0 = 46.6e-10 * M_w^0.5 * T_0^0.6 (Sutherland-like approximation)
    M_w in g/mol for this correlation.
    """
    M_w_gmol = molecular_weight * 1000  # convert kg/mol to g/mol
    return 46.6e-10 * M_w_gmol ** 0.5 * T0 ** 0.6


def bartz_sigma_correction(T_wall: float, T0: float, M: float, gamma: float) -> float:
    """Bartz sigma correction factor."""
    mach_term = 1 + (gamma - 1) / 2 * M ** 2
    bracket = 0.5 * (T_wall / T0) * mach_term + 0.5
    sigma = bracket ** (-0.68) * mach_term ** (-0.12)
    return sigma


def bartz_heat_transfer_coeff(D_throat: float, mu_0: float, Cp: float,
                               Pr: float, P_chamber: float, c_star: float,
                               A_throat: float, A_local: float,
                               T_wall: float, T0: float, M_local: float,
                               gamma: float, r_curvature: float = None) -> float:
    """Bartz correlation for gas-side convective heat transfer coefficient h_g (W/(m^2*K))."""
    if r_curvature is None:
        r_curvature = D_throat

    sigma = bartz_sigma_correction(T_wall, T0, M_local, gamma)
    area_ratio = A_local / A_throat if A_throat > 0 else 1.0

    h_g = (0.026 / D_throat ** 0.2) * \
          (mu_0 ** 0.2 * Cp / Pr ** 0.6) * \
          (P_chamber / c_star) ** 0.8 * \
          (D_throat / r_curvature) ** 0.1 * \
          (1 / max(area_ratio, 0.1)) ** 0.9 * \
          sigma

    return max(h_g, 0.0)


def adiabatic_wall_temperature(T0: float, M: float, gamma: float, Pr: float) -> float:
    """Adiabatic wall (recovery) temperature.
    T_aw = T0 * [1 + r*(gamma-1)/2*M^2] / [1 + (gamma-1)/2*M^2]
    where r = Pr^(1/3) for turbulent flow.
    """
    r_recovery = Pr ** (1 / 3)
    mach_term = (gamma - 1) / 2 * M ** 2
    return T0 * (1 + r_recovery * mach_term) / (1 + mach_term)


def radiative_heat_flux(T_gas: float, T_wall: float, emissivity_gas: float = 0.15) -> float:
    """Simplified gray-body radiation heat flux (W/m^2)."""
    return emissivity_gas * SIGMA_SB * (T_gas ** 4 - T_wall ** 4)


def wall_conduction_delta_T(q_total: float, wall_thickness: float,
                             thermal_conductivity: float) -> float:
    """Steady-state 1D temperature drop across the wall."""
    if thermal_conductivity <= 0:
        return float('inf')
    return q_total * wall_thickness / thermal_conductivity


def compute_wall_temperatures(station_x: np.ndarray, station_r: np.ndarray,
                               mach: np.ndarray, temperature_K: np.ndarray,
                               pressure_Pa: np.ndarray,
                               gamma: float, molecular_weight: float,
                               P_chamber: float, T_chamber: float, c_star: float,
                               A_throat: float, throat_diameter: float,
                               wall_thickness,
                               thermal_conductivity: float,
                               T_outer: float = 300.0,
                               max_iter: int = 10) -> dict:
    """Compute wall temperature distribution along the engine.

    wall_thickness: float (uniform) or np.ndarray (per-station).

    Returns dict with arrays: heat_flux, wall_temp_inner, wall_temp_outer, h_gas, T_aw,
    and scalars: max_heat_flux, max_wall_temp.
    """
    n = len(station_x)
    R_spec = 8.314462 / molecular_weight
    Cp = gamma * R_spec / (gamma - 1)
    Pr = prandtl_number(gamma)
    mu_0 = gas_viscosity(molecular_weight, T_chamber)

    # Support both scalar and array wall thickness
    if isinstance(wall_thickness, (int, float)):
        wt_arr = np.full(n, wall_thickness)
    else:
        wt_arr = np.asarray(wall_thickness)

    heat_flux = np.zeros(n)
    wall_temp_inner = np.full(n, T_outer + 100)  # initial guess
    wall_temp_outer = np.full(n, T_outer)
    h_gas_arr = np.zeros(n)
    T_aw_arr = np.zeros(n)

    areas = math.pi * station_r ** 2

    for _iteration in range(max_iter):
        for i in range(n):
            T_aw = adiabatic_wall_temperature(T_chamber, mach[i], gamma, Pr)
            T_aw_arr[i] = T_aw

            h_g = bartz_heat_transfer_coeff(
                D_throat=throat_diameter, mu_0=mu_0, Cp=Cp, Pr=Pr,
                P_chamber=P_chamber, c_star=c_star,
                A_throat=A_throat, A_local=areas[i],
                T_wall=wall_temp_inner[i], T0=T_chamber,
                M_local=mach[i], gamma=gamma
            )
            h_gas_arr[i] = h_g

            q_conv = h_g * (T_aw - wall_temp_inner[i])
            q_rad = radiative_heat_flux(temperature_K[i], wall_temp_inner[i])
            q_total = max(q_conv + q_rad, 0)

            delta_T = wall_conduction_delta_T(q_total, wt_arr[i], thermal_conductivity)

            heat_flux[i] = q_total
            wall_temp_inner[i] = T_outer + delta_T
            wall_temp_outer[i] = T_outer

    return {
        "heat_flux_W_m2": heat_flux,
        "wall_temp_inner_K": wall_temp_inner,
        "wall_temp_outer_K": wall_temp_outer,
        "h_gas_W_m2K": h_gas_arr,
        "T_aw_K": T_aw_arr,
        "max_heat_flux_W_m2": float(np.max(heat_flux)),
        "max_wall_temp_K": float(np.max(wall_temp_inner)),
    }
