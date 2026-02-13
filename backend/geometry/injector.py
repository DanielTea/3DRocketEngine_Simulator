"""Injector orifice geometry and injection physics.

Generates orifice layouts (unlike-doublet pattern in concentric rings)
and computes injection performance metrics (pressure drop, atomization,
combustion stability).
"""

import math
from dataclasses import dataclass, field


# Propellant properties (simplified)
PROPELLANT_PROPS = {
    "lox":  {"density": 1141.0, "surface_tension": 0.013},
    "rp1":  {"density": 810.0,  "surface_tension": 0.025},
    "lch4": {"density": 422.0,  "surface_tension": 0.014},
    "lh2":  {"density": 70.8,   "surface_tension": 0.002},
}


@dataclass
class InjectorOrifice:
    y_center: float
    z_center: float
    radius: float
    orifice_type: str       # 'fuel' or 'oxidizer'
    ring_index: int
    element_index: int


@dataclass
class InjectorLayout:
    orifices: list = field(default_factory=list)
    face_x: float = 0.0
    face_radius: float = 0.04
    n_rings: int = 0
    elements_per_ring: list = field(default_factory=list)
    total_fuel_area_m2: float = 0.0
    total_ox_area_m2: float = 0.0


def generate_injector_layout(config, face_x: float, face_radius: float) -> InjectorLayout:
    """Generate the full orifice layout on the injector face.

    Args:
        config: InjectorConfig (or dict-like with the required fields).
        face_x: Axial position of the injector face (m).
        face_radius: Radius of the injector face (= chamber inner radius at x[0]).

    Returns:
        InjectorLayout with all orifice positions and aggregate areas.
    """
    n_rings = int(config.n_rings)
    base = int(config.elements_per_ring_base)
    r_fuel = config.fuel_orifice_diameter / 2.0
    r_ox = config.ox_orifice_diameter / 2.0
    first_frac = config.first_ring_fraction
    spacing_frac = config.ring_spacing_fraction

    orifices = []
    elements_per_ring = []
    n_fuel = 0
    n_ox = 0

    # Radial offset between fuel and ox holes in an element
    radial_offset = 1.5 * max(config.fuel_orifice_diameter, config.ox_orifice_diameter)

    # Edge margin to keep orifices away from face boundary
    edge_margin = max(r_fuel, r_ox) + 0.0003  # 0.3mm clearance

    for k in range(n_rings):
        # Ring radial position
        if n_rings == 1:
            r_ring = first_frac * face_radius
        else:
            r_ring = (first_frac + k * spacing_frac) * face_radius

        # Clamp ring within face
        r_ring = min(r_ring, face_radius - edge_margin)
        if r_ring < edge_margin:
            continue

        # Number of elements in this ring (linear scaling)
        n_elem = base * (k + 1)
        elements_per_ring.append(n_elem)

        # Stagger odd rings by half angular spacing
        angular_offset = (math.pi / n_elem) if (k % 2 == 1) else 0.0

        for j in range(n_elem):
            theta = 2.0 * math.pi * j / n_elem + angular_offset

            # Fuel orifice at ring radius
            y_f = r_ring * math.cos(theta)
            z_f = r_ring * math.sin(theta)

            # Oxidizer orifice offset radially inward
            r_ox_pos = max(r_ring - radial_offset, edge_margin)
            y_o = r_ox_pos * math.cos(theta)
            z_o = r_ox_pos * math.sin(theta)

            # Validate fuel orifice within face
            dist_f = math.sqrt(y_f**2 + z_f**2)
            if dist_f + r_fuel <= face_radius:
                orifices.append(InjectorOrifice(
                    y_center=y_f, z_center=z_f, radius=r_fuel,
                    orifice_type='fuel', ring_index=k, element_index=j,
                ))
                n_fuel += 1

            # Validate ox orifice within face
            dist_o = math.sqrt(y_o**2 + z_o**2)
            if dist_o + r_ox <= face_radius:
                orifices.append(InjectorOrifice(
                    y_center=y_o, z_center=z_o, radius=r_ox,
                    orifice_type='oxidizer', ring_index=k, element_index=j,
                ))
                n_ox += 1

    total_fuel_area = n_fuel * math.pi * r_fuel**2
    total_ox_area = n_ox * math.pi * r_ox**2

    return InjectorLayout(
        orifices=orifices,
        face_x=face_x,
        face_radius=face_radius,
        n_rings=n_rings,
        elements_per_ring=elements_per_ring,
        total_fuel_area_m2=total_fuel_area,
        total_ox_area_m2=total_ox_area,
    )


def compute_injection_physics(
    layout: InjectorLayout,
    P_chamber: float,
    mdot_total: float,
    mixture_ratio: float = 2.3,
    Cd: float = 0.65,
    fuel_type: str = "rp1",
    ox_type: str = "lox",
    d_fuel: float = 0.001,
    d_ox: float = 0.0012,
) -> dict:
    """Compute injection performance metrics.

    Args:
        layout: The orifice layout.
        P_chamber: Chamber pressure (Pa).
        mdot_total: Total mass flow rate (kg/s).
        mixture_ratio: O/F mass ratio.
        Cd: Discharge coefficient.
        fuel_type: Fuel identifier for property lookup.
        ox_type: Oxidizer identifier for property lookup.
        d_fuel: Fuel orifice diameter (m).
        d_ox: Oxidizer orifice diameter (m).

    Returns:
        Dict with injection velocities, pressure drops, atomization quality, etc.
    """
    fuel_props = PROPELLANT_PROPS.get(fuel_type, PROPELLANT_PROPS["rp1"])
    ox_props = PROPELLANT_PROPS.get(ox_type, PROPELLANT_PROPS["lox"])

    rho_fuel = fuel_props["density"]
    rho_ox = ox_props["density"]
    sigma_fuel = fuel_props["surface_tension"]
    sigma_ox = ox_props["surface_tension"]

    # Split total mass flow
    mdot_fuel = mdot_total / (1.0 + mixture_ratio)
    mdot_ox = mdot_total * mixture_ratio / (1.0 + mixture_ratio)

    A_fuel = max(layout.total_fuel_area_m2, 1e-10)
    A_ox = max(layout.total_ox_area_m2, 1e-10)

    # Injection velocities
    v_fuel = mdot_fuel / (rho_fuel * Cd * A_fuel)
    v_ox = mdot_ox / (rho_ox * Cd * A_ox)

    # Pressure drops (incompressible orifice equation)
    dP_fuel = (mdot_fuel / (Cd * A_fuel))**2 / (2.0 * rho_fuel)
    dP_ox = (mdot_ox / (Cd * A_ox))**2 / (2.0 * rho_ox)

    dP_fuel_ratio = dP_fuel / max(P_chamber, 1.0)
    dP_ox_ratio = dP_ox / max(P_chamber, 1.0)

    # Feed pressures required
    P_fuel_feed = P_chamber + dP_fuel
    P_ox_feed = P_chamber + dP_ox

    # Weber numbers (atomization quality indicator)
    We_fuel = rho_fuel * v_fuel**2 * d_fuel / max(sigma_fuel, 1e-6)
    We_ox = rho_ox * v_ox**2 * d_ox / max(sigma_ox, 1e-6)

    atomization_quality = min((We_fuel + We_ox) / 2000.0, 1.0)

    # Momentum ratio (ideal ≈ 1.0 for unlike doublets)
    mom_fuel = rho_fuel * v_fuel**2
    mom_ox = rho_ox * v_ox**2
    momentum_ratio = mom_fuel / max(mom_ox, 1e-6)

    # Stability margin based on pressure drop ratios
    # Good: 0.15-0.30 of Pc for both fuel and ox
    avg_dp_ratio = (dP_fuel_ratio + dP_ox_ratio) / 2.0
    if avg_dp_ratio < 0.10:
        stability_margin = avg_dp_ratio / 0.10  # penalize low dP
    elif avg_dp_ratio > 0.35:
        stability_margin = max(0.0, 1.0 - (avg_dp_ratio - 0.35) / 0.35)
    else:
        stability_margin = 1.0  # in the sweet spot

    return {
        "mdot_fuel_kg_s": float(mdot_fuel),
        "mdot_ox_kg_s": float(mdot_ox),
        "v_fuel_m_s": float(v_fuel),
        "v_ox_m_s": float(v_ox),
        "dP_fuel_Pa": float(dP_fuel),
        "dP_ox_Pa": float(dP_ox),
        "dP_fuel_ratio": float(dP_fuel_ratio),
        "dP_ox_ratio": float(dP_ox_ratio),
        "P_fuel_feed_Pa": float(P_fuel_feed),
        "P_ox_feed_Pa": float(P_ox_feed),
        "We_fuel": float(We_fuel),
        "We_ox": float(We_ox),
        "atomization_quality": float(atomization_quality),
        "momentum_ratio": float(momentum_ratio),
        "stability_margin": float(stability_margin),
        "n_fuel_orifices": len([o for o in layout.orifices if o.orifice_type == 'fuel']),
        "n_ox_orifices": len([o for o in layout.orifices if o.orifice_type == 'oxidizer']),
        "total_fuel_area_mm2": float(layout.total_fuel_area_m2 * 1e6),
        "total_ox_area_mm2": float(layout.total_ox_area_m2 * 1e6),
    }
