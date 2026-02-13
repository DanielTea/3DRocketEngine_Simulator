"""Regenerative cooling: 1D energy balance along coolant channels.

Models counter-flow cooling where propellant flows from nozzle exit toward
the injector through rectangular channels machined into the engine wall.
"""

import math
import numpy as np
from dataclasses import dataclass
from backend.physics.coolant_properties import get_coolant


@dataclass
class CoolingChannelGeometry:
    """Cooling channel parameters."""
    n_channels: int = 60
    channel_width: float = 0.002      # m
    channel_height: float = 0.003     # m (uniform default)
    rib_width: float = 0.001          # m
    # Optional axial control points for variable channel height
    ch_height_cp0: float = None       # channel height at chamber end (x=0)
    ch_height_cp1: float = None       # channel height at midpoint (x=0.5)
    ch_height_cp2: float = None       # channel height at nozzle exit (x=1.0)

    def get_channel_height_array(self, n_stations: int) -> np.ndarray:
        """Return per-station channel heights, interpolating from CPs if set."""
        if self.ch_height_cp0 is None:
            return np.full(n_stations, self.channel_height)
        cp_x = np.array([0.0, 0.5, 1.0])
        cp_h = np.array([self.ch_height_cp0, self.ch_height_cp1, self.ch_height_cp2])
        t = np.linspace(0, 1, n_stations)
        return np.interp(t, cp_x, cp_h)


def hydraulic_diameter(width: float, height: float) -> float:
    """Rectangular channel hydraulic diameter: D_h = 4*A / P."""
    if width <= 0 or height <= 0:
        return 1e-6
    return 4.0 * width * height / (2.0 * (width + height))


def dittus_boelter_h(Re: float, Pr: float, D_h: float, k_coolant: float) -> float:
    """Coolant-side heat transfer coefficient (Dittus-Boelter).
    h_c = 0.023 * Re^0.8 * Pr^0.4 * k / D_h
    """
    if D_h <= 0 or Re < 100:
        return 100.0  # fallback for very low Re
    return 0.023 * abs(Re) ** 0.8 * max(Pr, 0.5) ** 0.4 * k_coolant / D_h


def compute_regen_cooling(
    station_x: np.ndarray,
    station_r_inner: np.ndarray,
    station_r_outer: np.ndarray,
    wall_thickness: np.ndarray,
    h_gas: np.ndarray,
    T_aw: np.ndarray,
    channel_geom: CoolingChannelGeometry,
    coolant_mdot: float,
    coolant_inlet_temp: float = 300.0,
    coolant_inlet_pressure: float = 5_000_000.0,
    coolant_type: str = "rp1",
    k_wall: float = 391.0,
) -> dict:
    """Solve the coupled wall-coolant energy balance station by station.

    The solver marches from nozzle exit (station N-1) backward to station 0
    (injector end), computing the 3-layer heat transfer at each station:
      gas -> wall_hot -> wall_cold -> coolant

    Uses the overall heat transfer coefficient approach:
      1/U = 1/h_g + t_wall/k_wall + 1/h_c
      Q = U * (T_aw - T_coolant)  per unit area

    Returns dict with per-station arrays and summary scalars.
    """
    n = len(station_x)
    coolant_cls = get_coolant(coolant_type)

    # Per-station channel heights (may vary axially via control points)
    channel_heights = channel_geom.get_channel_height_array(n)
    ch_w = channel_geom.channel_width

    # Per-channel mass flow
    mdot_per_channel = coolant_mdot / max(channel_geom.n_channels, 1)

    # Output arrays
    T_wall_hot = np.zeros(n)
    T_wall_cold = np.zeros(n)
    T_coolant = np.zeros(n)
    h_coolant_arr = np.zeros(n)
    coolant_vel = np.zeros(n)
    coolant_pressure = np.zeros(n)
    heat_flux_total = np.zeros(n)

    # Initialize coolant at nozzle exit (last station)
    T_coolant[-1] = coolant_inlet_temp
    coolant_pressure[-1] = coolant_inlet_pressure

    # March backward from nozzle exit to chamber inlet
    for i in range(n - 1, -1, -1):
        T_c = T_coolant[i]
        t_w = max(wall_thickness[i], 0.0005)

        # Per-station channel geometry
        ch_h = max(channel_heights[i], 0.0005)
        D_h = hydraulic_diameter(ch_w, ch_h)
        A_channel = ch_w * ch_h

        # Coolant properties at current temperature
        rho_c = coolant_cls.density(T_c)
        cp_c = coolant_cls.specific_heat(T_c)
        mu_c = coolant_cls.viscosity(T_c)
        k_c = coolant_cls.conductivity(T_c)
        Pr_c = coolant_cls.prandtl(T_c)

        # Coolant velocity in channel
        v_c = mdot_per_channel / (rho_c * A_channel) if (rho_c * A_channel) > 0 else 1.0
        coolant_vel[i] = v_c

        # Reynolds number
        Re_c = rho_c * v_c * D_h / mu_c if mu_c > 0 else 1000.0

        # Coolant-side heat transfer coefficient
        h_c = dittus_boelter_h(Re_c, Pr_c, D_h, k_c)
        h_coolant_arr[i] = h_c

        # Overall heat transfer coefficient
        # 1/U = 1/h_g + t_wall/k_wall + 1/h_c
        h_g = max(h_gas[i], 10.0)
        R_total = 1.0 / h_g + t_w / max(k_wall, 0.1) + 1.0 / max(h_c, 10.0)
        U = 1.0 / R_total

        # Heat flux
        Q = U * max(T_aw[i] - T_c, 0.0)
        heat_flux_total[i] = Q

        # Wall temperatures
        T_wall_hot[i] = T_aw[i] - Q / h_g
        T_wall_cold[i] = T_c + Q / max(h_c, 10.0)

        # Coolant absorbs heat over the local wetted area
        # Wetted perimeter per station ~ 2*pi*r_outer (all channels combined)
        if i > 0:
            dx = abs(station_x[i] - station_x[i - 1])
            r_mid = (station_r_outer[i] + station_r_outer[max(i - 1, 0)]) / 2.0
            dA = 2.0 * math.pi * r_mid * dx  # wetted area of this station segment

            dT_coolant = Q * dA / (coolant_mdot * cp_c) if (coolant_mdot * cp_c) > 0 else 0.0
            T_coolant[i - 1] = T_c + dT_coolant

            # Pressure drop: McAdams Fanning friction factor, converted to Darcy
            # f_Fanning = 0.046 * Re^(-0.2), f_Darcy = 4 * f_Fanning
            # ΔP = f_Darcy * (L/D_h) * ½ρv²
            f_fanning = 0.046 * max(Re_c, 100.0) ** (-0.2)
            f_darcy = 4.0 * f_fanning
            dP = f_darcy * (dx / max(D_h, 1e-6)) * 0.5 * rho_c * v_c ** 2
            coolant_pressure[i - 1] = coolant_pressure[i] - dP

    total_pressure_drop = coolant_pressure[-1] - coolant_pressure[0]

    return {
        "T_wall_hot_K": T_wall_hot,
        "T_wall_cold_K": T_wall_cold,
        "T_coolant_K": T_coolant,
        "h_coolant_W_m2K": h_coolant_arr,
        "heat_flux_W_m2": heat_flux_total,
        "coolant_velocity_m_s": coolant_vel,
        "coolant_pressure_Pa": coolant_pressure,
        "coolant_pressure_drop_Pa": float(abs(total_pressure_drop)),
        "max_wall_temp_K": float(np.max(T_wall_hot)),
        "coolant_exit_temp_K": float(T_coolant[0]),
        "max_coolant_temp_K": float(np.max(T_coolant)),
        "channel_height_profile": channel_heights,
    }
