"""REST API endpoints for materials, presets, and configuration."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from backend.materials.database import MaterialDatabase
from backend.api.schemas import SimulationConfig, GAConfig, STLExportRequest
from backend.geometry.parametric_engine import ParametricEngine
from backend.geometry.stl_export import generate_stl
from backend.physics.regen_cooling import CoolingChannelGeometry

router = APIRouter(prefix="/api")

# Shared material database instance
material_db = MaterialDatabase()


@router.get("/materials")
async def get_materials():
    """Return full material database."""
    return {"materials": material_db.list_full()}


@router.get("/materials/{material_id}")
async def get_material(material_id: str):
    """Return a single material's properties."""
    try:
        from dataclasses import asdict
        mat = material_db.get(material_id)
        return asdict(mat)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Material '{material_id}' not found")


@router.get("/presets")
async def get_presets():
    """Return preset engine configurations."""
    return {
        "presets": [
            {
                "id": "small_thruster",
                "name": "Small Thruster (1kN)",
                "geometry": {
                    "chamber_diameter": 0.05,
                    "chamber_length": 0.08,
                    "throat_diameter": 0.02,
                    "expansion_ratio": 6.0,
                    "wt_cp0": 0.002, "wt_cp1": 0.002, "wt_cp2": 0.0025,
                    "wt_cp3": 0.003, "wt_cp4": 0.002, "wt_cp5": 0.0015,
                    "convergence_half_angle": 30.0,
                    "throat_upstream_radius_ratio": 1.5,
                    "throat_downstream_radius_ratio": 0.4,
                    "bell_fraction": 80.0,
                    "contour_cp1_y": 0.5,
                    "contour_cp2_y": 0.5,
                },
                "propellant": {
                    "gamma": 1.25,
                    "molecular_weight": 0.022,
                    "chamber_temperature_K": 3200.0,
                    "chamber_pressure_Pa": 2_000_000.0,
                },
                "cooling": {
                    "enabled": True,
                    "coolant_type": "rp1",
                    "n_channels": 40,
                    "channel_width": 0.0015,
                    "channel_height": 0.0015,
                    "rib_width": 0.001,
                    "coolant_mdot": 0.5,
                    "rib_thickness_factor": 0.5,
                },
                "material_id": "copper_c10200",
            },
            {
                "id": "orbital_engine",
                "name": "Orbital Engine (20kN)",
                "geometry": {
                    "chamber_diameter": 0.12,
                    "chamber_length": 0.20,
                    "throat_diameter": 0.045,
                    "expansion_ratio": 25.0,
                    "wt_cp0": 0.004, "wt_cp1": 0.004, "wt_cp2": 0.005,
                    "wt_cp3": 0.006, "wt_cp4": 0.004, "wt_cp5": 0.003,
                    "convergence_half_angle": 35.0,
                    "throat_upstream_radius_ratio": 1.5,
                    "throat_downstream_radius_ratio": 0.4,
                    "bell_fraction": 80.0,
                    "contour_cp1_y": 0.5,
                    "contour_cp2_y": 0.5,
                },
                "propellant": {
                    "gamma": 1.22,
                    "molecular_weight": 0.020,
                    "chamber_temperature_K": 3500.0,
                    "chamber_pressure_Pa": 5_000_000.0,
                },
                "cooling": {
                    "enabled": True,
                    "coolant_type": "rp1",
                    "n_channels": 80,
                    "channel_width": 0.002,
                    "channel_height": 0.003,
                    "rib_width": 0.001,
                    "coolant_mdot": 2.0,
                    "rib_thickness_factor": 0.6,
                },
                "material_id": "inconel_718",
            },
            {
                "id": "test_article",
                "name": "Test Article (Low Pressure)",
                "geometry": {
                    "chamber_diameter": 0.08,
                    "chamber_length": 0.12,
                    "throat_diameter": 0.03,
                    "expansion_ratio": 4.0,
                    "wt_cp0": 0.003, "wt_cp1": 0.003, "wt_cp2": 0.003,
                    "wt_cp3": 0.003, "wt_cp4": 0.003, "wt_cp5": 0.003,
                    "convergence_half_angle": 25.0,
                    "throat_upstream_radius_ratio": 1.2,
                    "throat_downstream_radius_ratio": 0.3,
                    "bell_fraction": 75.0,
                    "contour_cp1_y": 0.5,
                    "contour_cp2_y": 0.5,
                },
                "propellant": {
                    "gamma": 1.30,
                    "molecular_weight": 0.024,
                    "chamber_temperature_K": 2800.0,
                    "chamber_pressure_Pa": 1_000_000.0,
                },
                "cooling": {
                    "enabled": False,
                    "coolant_type": "rp1",
                    "n_channels": 60,
                    "channel_width": 0.002,
                    "channel_height": 0.003,
                    "rib_width": 0.001,
                    "coolant_mdot": 1.0,
                    "rib_thickness_factor": 0.5,
                },
                "material_id": "stainless_304",
            },
        ]
    }


@router.post("/simulation/configure")
async def configure_simulation(config: SimulationConfig):
    """Validate a simulation configuration."""
    try:
        material_db.get(config.material_id)
    except KeyError:
        raise HTTPException(status_code=400, detail=f"Unknown material: {config.material_id}")

    if config.geometry.throat_diameter >= config.geometry.chamber_diameter:
        raise HTTPException(status_code=400,
                          detail="Throat diameter must be less than chamber diameter")

    return {"status": "valid", "config": config.model_dump()}


@router.post("/export/stl")
async def export_stl(request: STLExportRequest):
    """Generate and return a binary STL file of the current engine design."""
    engine = ParametricEngine.from_dict(request.geometry.model_dump())

    cooling_geom = None
    if request.cooling and request.cooling.enabled and request.mode == "full":
        cooling_geom = CoolingChannelGeometry(
            n_channels=request.cooling.n_channels,
            channel_width=request.cooling.channel_width,
            channel_height=request.cooling.channel_height,
            rib_width=request.cooling.rib_width,
            ch_height_cp0=request.cooling.ch_height_cp0,
            ch_height_cp1=request.cooling.ch_height_cp1,
            ch_height_cp2=request.cooling.ch_height_cp2,
        )

    stl_bytes = generate_stl(
        engine=engine,
        cooling_geom=cooling_geom,
        mode=request.mode,
        n_circ=request.resolution,
        include_injector=request.include_injector,
    )

    filename = f"rocket_engine_{request.mode}.stl"
    return Response(
        content=stl_bytes,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(stl_bytes)),
        },
    )


@router.get("/health")
async def health_check():
    return {"status": "ok"}
