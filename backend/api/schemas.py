"""Pydantic models for API request/response validation."""

from pydantic import BaseModel, Field
from typing import Optional


class EngineGeometryParams(BaseModel):
    chamber_diameter: float = Field(0.08, ge=0.02, le=0.30)
    chamber_length: float = Field(0.12, ge=0.03, le=0.50)
    throat_diameter: float = Field(0.03, ge=0.008, le=0.15)
    expansion_ratio: float = Field(8.0, ge=2.0, le=80.0)
    # Variable wall thickness: 6 control points
    wt_cp0: float = Field(0.003, ge=0.001, le=0.015)
    wt_cp1: float = Field(0.003, ge=0.001, le=0.015)
    wt_cp2: float = Field(0.003, ge=0.001, le=0.015)
    wt_cp3: float = Field(0.003, ge=0.001, le=0.015)
    wt_cp4: float = Field(0.003, ge=0.001, le=0.015)
    wt_cp5: float = Field(0.003, ge=0.001, le=0.015)
    convergence_half_angle: float = Field(30.0, ge=15.0, le=60.0)
    throat_upstream_radius_ratio: float = Field(1.5, ge=0.5, le=2.0)
    throat_downstream_radius_ratio: float = Field(0.4, ge=0.2, le=1.0)
    bell_fraction: float = Field(80.0, ge=60.0, le=100.0)
    contour_cp1_y: float = Field(0.5, ge=0.0, le=1.0)
    contour_cp2_y: float = Field(0.5, ge=0.0, le=1.0)


class CoolingConfig(BaseModel):
    enabled: bool = True
    coolant_type: str = "rp1"
    n_channels: int = Field(60, ge=10, le=200)
    channel_width: float = Field(0.002, ge=0.0005, le=0.006)
    channel_height: float = Field(0.003, ge=0.0005, le=0.008)
    rib_width: float = Field(0.001, ge=0.0005, le=0.004)
    coolant_mdot: float = Field(1.0, ge=0.1, le=5.0)
    coolant_inlet_temp: float = Field(300.0, ge=100.0, le=500.0)
    coolant_inlet_pressure: float = Field(5_000_000.0, ge=500_000.0, le=30_000_000.0)
    rib_thickness_factor: float = Field(0.5, ge=0.1, le=1.0)
    # Optional axial channel height control points (None = uniform channel_height)
    ch_height_cp0: Optional[float] = Field(None, ge=0.0005, le=0.008)
    ch_height_cp1: Optional[float] = Field(None, ge=0.0005, le=0.008)
    ch_height_cp2: Optional[float] = Field(None, ge=0.0005, le=0.008)


class InjectorConfig(BaseModel):
    enabled: bool = False
    n_rings: int = Field(3, ge=1, le=10)
    elements_per_ring_base: int = Field(6, ge=3, le=24)
    fuel_orifice_diameter: float = Field(0.001, ge=0.0005, le=0.005)
    ox_orifice_diameter: float = Field(0.0012, ge=0.0005, le=0.006)
    injection_angle_deg: float = Field(30.0, ge=0.0, le=60.0)
    first_ring_fraction: float = Field(0.25, ge=0.10, le=0.50)
    ring_spacing_fraction: float = Field(0.20, ge=0.05, le=0.40)
    mixture_ratio: float = Field(2.3, ge=1.0, le=4.0)
    discharge_coefficient: float = Field(0.65, ge=0.4, le=0.9)


class PropellantConfig(BaseModel):
    gamma: float = Field(1.25, ge=1.1, le=1.7)
    molecular_weight: float = Field(0.022, ge=0.002, le=0.044)
    chamber_temperature_K: float = Field(3400.0, ge=500.0, le=5000.0)
    chamber_pressure_Pa: float = Field(3_000_000.0, ge=100_000.0, le=30_000_000.0)


class SimulationConfig(BaseModel):
    geometry: EngineGeometryParams = Field(default_factory=EngineGeometryParams)
    propellant: PropellantConfig = Field(default_factory=PropellantConfig)
    cooling: CoolingConfig = Field(default_factory=CoolingConfig)
    injector: InjectorConfig = Field(default_factory=InjectorConfig)
    material_id: str = "copper_c10200"
    ambient_pressure_Pa: float = Field(101325.0, ge=0.0, le=200_000.0)


class GAConfig(BaseModel):
    population_size: int = Field(50, ge=10, le=500)
    num_generations: int = Field(100, ge=5, le=1000)
    crossover_prob: float = Field(0.7, ge=0.0, le=1.0)
    mutation_prob: float = Field(0.3, ge=0.0, le=1.0)
    fitness_weights: dict = Field(default_factory=lambda: {
        "thrust_to_weight": 0.25,
        "thermal_survival": 0.20,
        "efficiency": 0.20,
        "structural_integrity": 0.15,
        "cost_efficiency": 0.05,
        "cooling_effectiveness": 0.10,
        "coolant_pressure_drop": 0.05,
        "injection_quality": 0.00,
    })
    propellant: PropellantConfig = Field(default_factory=PropellantConfig)
    cooling: CoolingConfig = Field(default_factory=CoolingConfig)
    injector: InjectorConfig = Field(default_factory=InjectorConfig)
    material_id: str = "copper_c10200"
    ambient_pressure_Pa: float = Field(101325.0, ge=0.0, le=200_000.0)


class UpdateParams(BaseModel):
    geometry: Optional[EngineGeometryParams] = None
    propellant: Optional[PropellantConfig] = None
    cooling: Optional[CoolingConfig] = None
    injector: Optional[InjectorConfig] = None
    material_id: Optional[str] = None
    ambient_pressure_Pa: Optional[float] = None


class STLExportRequest(BaseModel):
    geometry: EngineGeometryParams = Field(default_factory=EngineGeometryParams)
    cooling: Optional[CoolingConfig] = None
    injector: Optional[InjectorConfig] = None
    mode: str = Field("simple", pattern="^(simple|full)$")
    include_injector: bool = True
    resolution: int = Field(128, ge=32, le=256)
