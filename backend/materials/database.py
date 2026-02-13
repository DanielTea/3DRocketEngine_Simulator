"""Material property database for rocket engine simulation."""

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass
class MaterialProperties:
    id: str
    name: str
    density_kg_m3: float
    thermal_conductivity_W_mK: float
    specific_heat_J_kgK: float
    melting_point_K: float
    yield_strength_MPa: float
    ultimate_strength_MPa: float
    elastic_modulus_GPa: float
    thermal_expansion_coeff_per_K: float
    poissons_ratio: float
    emissivity: float
    cost_per_kg_usd: float
    color_hex: str

    @property
    def elastic_modulus_Pa(self) -> float:
        return self.elastic_modulus_GPa * 1e9

    @property
    def yield_strength_Pa(self) -> float:
        return self.yield_strength_MPa * 1e6


class MaterialDatabase:
    def __init__(self):
        data_path = Path(__file__).parent / "material_data.json"
        with open(data_path, "r") as f:
            data = json.load(f)
        self._materials: dict[str, MaterialProperties] = {}
        for m in data["materials"]:
            props = MaterialProperties(**m)
            self._materials[props.id] = props

    def get(self, material_id: str) -> MaterialProperties:
        if material_id not in self._materials:
            raise KeyError(f"Unknown material: {material_id}")
        return self._materials[material_id]

    def list_all(self) -> list[dict]:
        return [
            {"id": m.id, "name": m.name, "color_hex": m.color_hex}
            for m in self._materials.values()
        ]

    def list_full(self) -> list[dict]:
        from dataclasses import asdict
        return [asdict(m) for m in self._materials.values()]
