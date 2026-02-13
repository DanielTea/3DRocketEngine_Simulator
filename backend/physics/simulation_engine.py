"""Simulation engine: orchestrates all physics modules into a single tick."""

import math
import numpy as np
from backend.geometry.parametric_engine import ParametricEngine
from backend.geometry.wall_thickness import interpolate_wall_thickness
from backend.materials.database import MaterialProperties
from backend.physics import combustion, gas_dynamics, heat_transfer, structural
from backend.physics.regen_cooling import compute_regen_cooling, CoolingChannelGeometry
from backend.physics.effective_properties import compute_effective_r_outer
from backend.config import G0, ATMOSPHERIC_PRESSURE


class SimulationEngine:
    """Runs the complete physics simulation for a given engine configuration."""

    def __init__(self, engine: ParametricEngine, material: MaterialProperties,
                 gamma: float = 1.25, molecular_weight: float = 0.022,
                 chamber_temperature_K: float = 3400.0,
                 chamber_pressure_Pa: float = 3_000_000.0,
                 ambient_pressure_Pa: float = ATMOSPHERIC_PRESSURE,
                 cooling_enabled: bool = True,
                 cooling_channel_geom: CoolingChannelGeometry = None,
                 coolant_mdot: float = 1.0,
                 coolant_type: str = "rp1",
                 coolant_inlet_temp: float = 300.0,
                 coolant_inlet_pressure: float = 5_000_000.0,
                 rib_thickness_factor: float = 0.5):
        self.engine = engine
        self.material = material
        self.gamma = gamma
        self.molecular_weight = molecular_weight
        self.T_chamber = chamber_temperature_K
        self.P_chamber = chamber_pressure_Pa
        self.P_ambient = ambient_pressure_Pa

        # Cooling parameters
        self.cooling_enabled = cooling_enabled
        self.cooling_geom = cooling_channel_geom or CoolingChannelGeometry()
        self.coolant_mdot = coolant_mdot
        self.coolant_type = coolant_type
        self.coolant_inlet_temp = coolant_inlet_temp
        self.coolant_inlet_pressure = coolant_inlet_pressure
        self.rib_thickness_factor = rib_thickness_factor

        # Pre-compute profile
        self._profile = engine.generate_profile()
        self._station_x = self._profile[:, 0]
        self._station_r_inner = self._profile[:, 1]
        self._station_r_outer = self._profile[:, 2]
        self._wall_thickness = self._station_r_outer - self._station_r_inner

    def run_tick(self) -> dict:
        """Execute one full physics tick.

        Returns a comprehensive dict with all simulation results.
        """
        R_spec = combustion.specific_gas_constant(self.molecular_weight)

        # 1. Combustion chamber performance
        c_star = combustion.characteristic_velocity(self.gamma, R_spec, self.T_chamber)
        mdot = combustion.mass_flow_rate(self.P_chamber, self.engine.throat_area, c_star)

        # 2. Nozzle flow field
        throat_r = self.engine.throat_diameter / 2
        flow = gas_dynamics.solve_nozzle_flow(
            self._station_x, self._station_r_inner,
            throat_r, self.gamma, R_spec,
            self.P_chamber, self.T_chamber, self.P_ambient
        )

        # 3. Exit conditions and thrust
        M_exit = flow["mach"][-1]
        P_exit = flow["pressure_Pa"][-1]
        V_exit = flow["velocity_m_s"][-1]

        thrust = gas_dynamics.compute_thrust(
            mdot, V_exit, P_exit, self.P_ambient, self.engine.exit_area
        )
        Isp = gas_dynamics.compute_specific_impulse(thrust, mdot)

        Cf = thrust / (self.P_chamber * self.engine.throat_area) if self.engine.throat_area > 0 else 0

        # 4. Heat transfer (without cooling first, to get h_gas and T_aw)
        ht = heat_transfer.compute_wall_temperatures(
            self._station_x, self._station_r_inner,
            flow["mach"], flow["temperature_K"], flow["pressure_Pa"],
            self.gamma, self.molecular_weight,
            self.P_chamber, self.T_chamber, c_star,
            self.engine.throat_area, self.engine.throat_diameter,
            self._wall_thickness,
            self.material.thermal_conductivity_W_mK
        )

        # 5. Regenerative cooling (if enabled)
        cooling_result = None
        if self.cooling_enabled:
            cooling_result = compute_regen_cooling(
                station_x=self._station_x,
                station_r_inner=self._station_r_inner,
                station_r_outer=self._station_r_outer,
                wall_thickness=self._wall_thickness,
                h_gas=ht["h_gas_W_m2K"],
                T_aw=ht["T_aw_K"],
                channel_geom=self.cooling_geom,
                coolant_mdot=self.coolant_mdot,
                coolant_inlet_temp=self.coolant_inlet_temp,
                coolant_inlet_pressure=self.coolant_inlet_pressure,
                coolant_type=self.coolant_type,
                k_wall=self.material.thermal_conductivity_W_mK,
            )
            # Use cooling-corrected wall temperatures
            ht["wall_temp_inner_K"] = cooling_result["T_wall_hot_K"]
            ht["wall_temp_outer_K"] = cooling_result["T_wall_cold_K"]
            ht["max_wall_temp_K"] = cooling_result["max_wall_temp_K"]

        # 6. Effective structural properties (topology-inspired)
        effective_r = None
        if self.cooling_enabled:
            effective_r = compute_effective_r_outer(
                self._station_r_inner, self._station_r_outer,
                self.cooling_geom.n_channels,
                self.cooling_geom.channel_width,
                self.cooling_geom.channel_height,
                self.cooling_geom.rib_width,
                self.rib_thickness_factor,
            )

        # 7. Structural analysis
        stress = structural.compute_structural_analysis(
            self._station_r_inner, self._station_r_outer,
            flow["pressure_Pa"],
            ht["wall_temp_inner_K"], ht["wall_temp_outer_K"],
            self.material.yield_strength_Pa,
            self.material.elastic_modulus_Pa,
            self.material.thermal_expansion_coeff_per_K,
            self.material.poissons_ratio,
            effective_r_outer=effective_r,
        )

        # 8. Mass
        total_mass = self.engine.total_mass(self.material.density_kg_m3)

        # 9. Warnings
        warnings = []
        thermal_margin = ht["max_wall_temp_K"] / self.material.melting_point_K
        if thermal_margin > 0.8:
            pct = thermal_margin * 100
            warnings.append(f"Wall temperature reaches {pct:.0f}% of melting point ({self.material.melting_point_K} K)")
        if thermal_margin > 1.0:
            warnings.append("CRITICAL: Wall temperature EXCEEDS melting point - structural failure")
        if stress["min_safety_factor"] < 1.5:
            warnings.append(f"Low safety factor: {stress['min_safety_factor']:.2f} at station {stress['min_sf_station_index']}")
        if stress["min_safety_factor"] < 1.0:
            warnings.append("CRITICAL: Safety factor below 1.0 - structural yielding")

        result = {
            "performance": {
                "thrust_N": float(thrust),
                "specific_impulse_s": float(Isp),
                "mass_flow_kg_s": float(mdot),
                "exit_velocity_m_s": float(V_exit),
                "exit_pressure_Pa": float(P_exit),
                "exit_mach": float(M_exit),
                "characteristic_velocity_m_s": float(c_star),
                "thrust_coefficient": float(Cf),
                "total_mass_kg": float(total_mass),
                "thrust_to_weight": float(thrust / (total_mass * G0)) if total_mass > 0 else 0,
            },
            "stations": {
                "x": self._station_x.tolist(),
                "r_inner": self._station_r_inner.tolist(),
                "r_outer": self._station_r_outer.tolist(),
                "wall_thickness": self._wall_thickness.tolist(),
                "area_ratio": flow["area_ratio"].tolist(),
                "mach": flow["mach"].tolist(),
                "pressure_Pa": flow["pressure_Pa"].tolist(),
                "temperature_K": flow["temperature_K"].tolist(),
                "velocity_m_s": flow["velocity_m_s"].tolist(),
                "heat_flux_W_m2": ht["heat_flux_W_m2"].tolist(),
                "wall_temp_inner_K": ht["wall_temp_inner_K"].tolist(),
                "wall_temp_outer_K": ht["wall_temp_outer_K"].tolist(),
                "von_mises_stress_MPa": stress["von_mises_MPa"].tolist(),
                "safety_factor": stress["safety_factor"].tolist(),
            },
            "structural_summary": {
                "min_safety_factor": stress["min_safety_factor"],
                "min_sf_station_index": stress["min_sf_station_index"],
                "max_von_mises_MPa": stress["max_von_mises_MPa"],
                "max_wall_temp_K": ht["max_wall_temp_K"],
                "thermal_margin": float(thermal_margin),
            },
            "warnings": warnings,
        }

        # Add cooling data if available
        if cooling_result is not None:
            result["cooling"] = {
                "T_coolant_K": cooling_result["T_coolant_K"].tolist(),
                "T_wall_hot_K": cooling_result["T_wall_hot_K"].tolist(),
                "T_wall_cold_K": cooling_result["T_wall_cold_K"].tolist(),
                "h_coolant_W_m2K": cooling_result["h_coolant_W_m2K"].tolist(),
                "heat_flux_W_m2": cooling_result["heat_flux_W_m2"].tolist(),
                "coolant_velocity_m_s": cooling_result["coolant_velocity_m_s"].tolist(),
                "coolant_pressure_Pa": cooling_result["coolant_pressure_Pa"].tolist(),
                "coolant_pressure_drop_Pa": cooling_result["coolant_pressure_drop_Pa"],
                "max_wall_temp_K": cooling_result["max_wall_temp_K"],
                "coolant_exit_temp_K": cooling_result["coolant_exit_temp_K"],
                "max_coolant_temp_K": cooling_result["max_coolant_temp_K"],
                "channel_height_profile": cooling_result["channel_height_profile"].tolist(),
            }
            result["performance"]["coolant_pressure_drop_Pa"] = cooling_result["coolant_pressure_drop_Pa"]

        return result

    def update_config(self, engine: ParametricEngine = None,
                      material: MaterialProperties = None,
                      gamma: float = None, molecular_weight: float = None,
                      chamber_temperature_K: float = None,
                      chamber_pressure_Pa: float = None,
                      ambient_pressure_Pa: float = None,
                      cooling_enabled: bool = None,
                      cooling_channel_geom: CoolingChannelGeometry = None,
                      coolant_mdot: float = None,
                      coolant_type: str = None,
                      rib_thickness_factor: float = None):
        """Hot-update simulation parameters."""
        if engine is not None:
            self.engine = engine
            self._profile = engine.generate_profile()
            self._station_x = self._profile[:, 0]
            self._station_r_inner = self._profile[:, 1]
            self._station_r_outer = self._profile[:, 2]
            self._wall_thickness = self._station_r_outer - self._station_r_inner
        if material is not None:
            self.material = material
        if gamma is not None:
            self.gamma = gamma
        if molecular_weight is not None:
            self.molecular_weight = molecular_weight
        if chamber_temperature_K is not None:
            self.T_chamber = chamber_temperature_K
        if chamber_pressure_Pa is not None:
            self.P_chamber = chamber_pressure_Pa
        if ambient_pressure_Pa is not None:
            self.P_ambient = ambient_pressure_Pa
        if cooling_enabled is not None:
            self.cooling_enabled = cooling_enabled
        if cooling_channel_geom is not None:
            self.cooling_geom = cooling_channel_geom
        if coolant_mdot is not None:
            self.coolant_mdot = coolant_mdot
        if coolant_type is not None:
            self.coolant_type = coolant_type
        if rib_thickness_factor is not None:
            self.rib_thickness_factor = rib_thickness_factor
