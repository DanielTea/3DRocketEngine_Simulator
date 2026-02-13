"""Multi-objective fitness evaluation for evolved engine designs."""

import math
from backend.geometry.parametric_engine import ParametricEngine
from backend.physics.simulation_engine import SimulationEngine
from backend.physics.regen_cooling import CoolingChannelGeometry
from backend.materials.database import MaterialProperties
from backend.config import G0, GENE_NAMES


class FitnessEvaluator:
    """Evaluates a candidate engine genome against multiple objectives."""

    def __init__(self, weights: dict, material: MaterialProperties,
                 gamma: float, molecular_weight: float,
                 chamber_temperature_K: float, chamber_pressure_Pa: float,
                 ambient_pressure_Pa: float = 101325.0,
                 cooling_enabled: bool = True,
                 coolant_type: str = "rp1"):
        self.weights = weights
        self.material = material
        self.gamma = gamma
        self.molecular_weight = molecular_weight
        self.T_chamber = chamber_temperature_K
        self.P_chamber = chamber_pressure_Pa
        self.P_ambient = ambient_pressure_Pa
        self.cooling_enabled = cooling_enabled
        self.coolant_type = coolant_type

    def evaluate(self, genome: list) -> dict:
        """Evaluate a genome and return fitness scores.

        The genome contains 22 genes: 16 shape/thickness + 6 cooling.
        Returns dict with individual scores and weighted total.
        """
        try:
            # Extract engine shape from first 16 genes
            engine = ParametricEngine.from_genome(genome)

            # Extract cooling channel params from genes 16-21 (+22-24 for height CPs)
            cooling_geom = None
            coolant_mdot = 1.0
            rib_thickness_factor = 0.5
            if len(genome) >= 22:
                cooling_kwargs = dict(
                    n_channels=max(10, int(round(genome[16]))),
                    channel_width=genome[17],
                    channel_height=genome[18],
                    rib_width=genome[19],
                )
                # Channel height control points (genes 22-24)
                if len(genome) >= 25:
                    cooling_kwargs["ch_height_cp0"] = genome[22]
                    cooling_kwargs["ch_height_cp1"] = genome[23]
                    cooling_kwargs["ch_height_cp2"] = genome[24]
                cooling_geom = CoolingChannelGeometry(**cooling_kwargs)
                coolant_mdot = genome[20]
                rib_thickness_factor = genome[21]

            sim = SimulationEngine(
                engine=engine, material=self.material,
                gamma=self.gamma, molecular_weight=self.molecular_weight,
                chamber_temperature_K=self.T_chamber,
                chamber_pressure_Pa=self.P_chamber,
                ambient_pressure_Pa=self.P_ambient,
                cooling_enabled=self.cooling_enabled,
                cooling_channel_geom=cooling_geom,
                coolant_mdot=coolant_mdot,
                coolant_type=self.coolant_type,
                rib_thickness_factor=rib_thickness_factor,
            )

            result = sim.run_tick()
            perf = result["performance"]
            struct = result["structural_summary"]
            cooling = result.get("cooling", {})

            # Sub-scores (all in [0, 1] range, higher = better)

            # 1. Thrust-to-weight ratio (normalize: 100 is excellent)
            tw = perf.get("thrust_to_weight", 0)
            score_tw = min(tw / 100.0, 1.0)

            # 2. Thermal survival (1 = well below melting, 0 = at/above melting)
            thermal_margin = struct.get("thermal_margin", 1.0)
            score_thermal = max(0.0, 1.0 - thermal_margin)

            # 3. Efficiency (Isp ratio vs theoretical max)
            from backend.physics.combustion import specific_gas_constant, characteristic_velocity
            R_spec = specific_gas_constant(self.molecular_weight)
            c_star = characteristic_velocity(self.gamma, R_spec, self.T_chamber)
            Isp_actual = perf.get("specific_impulse_s", 0)
            Isp_max = c_star / G0 * 1.8
            score_efficiency = min(Isp_actual / max(Isp_max, 1), 1.0)

            # 4. Structural integrity (min safety factor / target)
            sf = struct.get("min_safety_factor", 0)
            target_sf = 2.0
            score_structural = min(sf / target_sf, 1.0)

            # 5. Cost efficiency (lighter and cheaper = better)
            mass = perf.get("total_mass_kg", 1)
            cost = self.material.cost_per_kg_usd * mass
            score_cost = max(0, 1.0 - cost / 500.0)

            # 6. Cooling effectiveness (how much max wall temp was reduced)
            score_cooling = 0.5  # default if cooling disabled
            if cooling:
                max_wall_T = cooling.get("max_wall_temp_K", self.T_chamber)
                # Best: wall temp far below melting; worst: at melting
                cooling_ratio = max_wall_T / self.material.melting_point_K
                score_cooling = max(0.0, 1.0 - cooling_ratio)

            # 7. Coolant pressure drop (lower is better)
            score_pressure_drop = 0.5  # default if cooling disabled
            if cooling:
                dp = cooling.get("coolant_pressure_drop_Pa", 0)
                # Normalize: 0 Pa = perfect (1.0), 3 MPa = bad (0.0)
                score_pressure_drop = max(0.0, 1.0 - dp / 3_000_000.0)

            scores = {
                "thrust_to_weight": score_tw,
                "thermal_survival": score_thermal,
                "efficiency": score_efficiency,
                "structural_integrity": score_structural,
                "cost_efficiency": score_cost,
                "cooling_effectiveness": score_cooling,
                "coolant_pressure_drop": score_pressure_drop,
            }

            # Weighted total
            total = sum(self.weights.get(k, 0) * v for k, v in scores.items())
            weight_sum = sum(self.weights.values())
            if weight_sum > 0:
                total /= weight_sum

            return {
                "total": total,
                "scores": scores,
                "performance": perf,
            }

        except Exception:
            # Invalid genome - return worst fitness
            return {
                "total": 0.0,
                "scores": {k: 0.0 for k in [
                    "thrust_to_weight", "thermal_survival", "efficiency",
                    "structural_integrity", "cost_efficiency",
                    "cooling_effectiveness", "coolant_pressure_drop",
                ]},
                "performance": {},
            }
