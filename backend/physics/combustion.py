"""Combustion chamber thermodynamics for rocket engine simulation."""

import math
from backend.config import G0, R_UNIVERSAL


def specific_gas_constant(molecular_weight: float) -> float:
    """R_specific = R_universal / M_w (J/(kg*K))."""
    return R_UNIVERSAL / molecular_weight


def gamma_function(gamma: float) -> float:
    """Vandenkerckhove function: Gamma = sqrt(gamma) * (2/(gamma+1))^((gamma+1)/(2*(gamma-1)))."""
    return math.sqrt(gamma) * (2 / (gamma + 1)) ** ((gamma + 1) / (2 * (gamma - 1)))


def characteristic_velocity(gamma: float, R_specific: float, T_chamber: float) -> float:
    """Characteristic exhaust velocity c* (m/s).
    
    c* = sqrt(R_specific * T_chamber) / Gamma(gamma)
    """
    Gamma = gamma_function(gamma)
    return math.sqrt(R_specific * T_chamber) / Gamma


def mass_flow_rate(P_chamber: float, A_throat: float, c_star: float) -> float:
    """Mass flow rate through the nozzle (kg/s).
    
    mdot = P_c * A_t / c*
    """
    return P_chamber * A_throat / c_star


def thrust_coefficient(gamma: float, expansion_ratio: float,
                       P_exit_over_Pc: float, P_ambient_over_Pc: float) -> float:
    """Thrust coefficient Cf (dimensionless).
    
    Cf = sqrt((2*gamma^2/(gamma-1)) * (2/(gamma+1))^((gamma+1)/(gamma-1)) * 
         (1 - (Pe/Pc)^((gamma-1)/gamma))) + (Pe/Pc - Pa/Pc) * epsilon
    """
    term1 = (2 * gamma ** 2) / (gamma - 1)
    term2 = (2 / (gamma + 1)) ** ((gamma + 1) / (gamma - 1))
    term3 = 1 - P_exit_over_Pc ** ((gamma - 1) / gamma)
    
    momentum_term = math.sqrt(term1 * term2 * max(term3, 0))
    pressure_term = (P_exit_over_Pc - P_ambient_over_Pc) * expansion_ratio
    
    return momentum_term + pressure_term


def ideal_thrust(Cf: float, P_chamber: float, A_throat: float) -> float:
    """Thrust F = Cf * Pc * At (N)."""
    return Cf * P_chamber * A_throat


def specific_impulse(thrust: float, mdot: float) -> float:
    """Specific impulse Isp = F / (mdot * g0) (seconds)."""
    if mdot <= 0:
        return 0.0
    return thrust / (mdot * G0)


def exit_velocity(Isp: float) -> float:
    """Effective exhaust velocity Ve = Isp * g0 (m/s)."""
    return Isp * G0


def compute_chamber_performance(gamma: float, molecular_weight: float,
                                T_chamber: float, P_chamber: float,
                                A_throat: float, expansion_ratio: float,
                                P_ambient: float) -> dict:
    """Compute all combustion chamber performance parameters.
    
    Returns dict with c_star, mdot, Cf, thrust, Isp, Ve, P_exit.
    """
    R_spec = specific_gas_constant(molecular_weight)
    c_star = characteristic_velocity(gamma, R_spec, T_chamber)
    mdot = mass_flow_rate(P_chamber, A_throat, c_star)
    
    # Exit pressure ratio (from isentropic expansion)
    # Need to solve for exit Mach first, then get P_exit
    # Use the area_mach_relation from gas_dynamics
    # For now, compute Cf with a pressure ratio estimate
    from backend.physics.gas_dynamics import area_mach_relation, isentropic_pressure_ratio
    
    M_exit = area_mach_relation(expansion_ratio, gamma, supersonic=True)
    P_exit_ratio = isentropic_pressure_ratio(M_exit, gamma)
    P_exit = P_exit_ratio * P_chamber
    
    Cf = thrust_coefficient(gamma, expansion_ratio,
                           P_exit_ratio, P_ambient / P_chamber)
    F = ideal_thrust(Cf, P_chamber, A_throat)
    Isp = specific_impulse(F, mdot)
    Ve = exit_velocity(Isp)
    
    return {
        "c_star_m_s": c_star,
        "mass_flow_kg_s": mdot,
        "thrust_coefficient": Cf,
        "thrust_N": F,
        "specific_impulse_s": Isp,
        "exit_velocity_m_s": Ve,
        "exit_pressure_Pa": P_exit,
        "exit_mach": M_exit,
        "R_specific": R_spec,
    }
