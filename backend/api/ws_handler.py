"""WebSocket connection handler and message router."""

import json
import asyncio
import traceback
from fastapi import WebSocket, WebSocketDisconnect
from backend.api.schemas import SimulationConfig, GAConfig, UpdateParams, CoolingConfig, InjectorConfig
from backend.geometry.parametric_engine import ParametricEngine
from backend.geometry.mesh_export import export_for_frontend
from backend.physics.simulation_engine import SimulationEngine
from backend.physics.regen_cooling import CoolingChannelGeometry
from backend.materials.database import MaterialDatabase

material_db = MaterialDatabase()


def cooling_config_to_geom(cfg: CoolingConfig) -> CoolingChannelGeometry:
    """Convert CoolingConfig pydantic model to CoolingChannelGeometry dataclass."""
    return CoolingChannelGeometry(
        n_channels=cfg.n_channels,
        channel_width=cfg.channel_width,
        channel_height=cfg.channel_height,
        rib_width=cfg.rib_width,
        ch_height_cp0=cfg.ch_height_cp0,
        ch_height_cp1=cfg.ch_height_cp1,
        ch_height_cp2=cfg.ch_height_cp2,
    )


class ConnectionManager:
    """Manages active WebSocket connections."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_json(self, websocket: WebSocket, data: dict):
        await websocket.send_json(data)


manager = ConnectionManager()


class SimulationSession:
    """Tracks state for a single client's simulation session."""

    def __init__(self):
        self.sim_engine: SimulationEngine | None = None
        self.sim_running = False
        self.evolution_running = False
        self._sim_task: asyncio.Task | None = None
        self._evo_task: asyncio.Task | None = None

    def stop_simulation(self):
        self.sim_running = False
        if self._sim_task and not self._sim_task.done():
            self._sim_task.cancel()

    def stop_evolution(self):
        self.evolution_running = False
        if self._evo_task and not self._evo_task.done():
            self._evo_task.cancel()


async def handle_websocket(websocket: WebSocket):
    """Main WebSocket endpoint handler."""
    await manager.connect(websocket)
    session = SimulationSession()

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "")
            payload = data.get("payload", {})

            try:
                if msg_type == "start_simulation":
                    await handle_start_simulation(websocket, session, payload)
                elif msg_type == "stop_simulation":
                    session.stop_simulation()
                elif msg_type == "update_params":
                    await handle_update_params(websocket, session, payload)
                elif msg_type == "request_mesh":
                    await handle_request_mesh(websocket, session)
                elif msg_type == "start_evolution":
                    await handle_start_evolution(websocket, session, payload)
                elif msg_type == "stop_evolution":
                    session.stop_evolution()
                else:
                    await manager.send_json(websocket, {
                        "type": "error",
                        "payload": {"code": "UNKNOWN_MESSAGE", "message": f"Unknown type: {msg_type}"}
                    })
            except Exception as e:
                await manager.send_json(websocket, {
                    "type": "error",
                    "payload": {"code": "HANDLER_ERROR", "message": str(e)}
                })

    except WebSocketDisconnect:
        session.stop_simulation()
        session.stop_evolution()
        manager.disconnect(websocket)


async def handle_start_simulation(websocket: WebSocket, session: SimulationSession, payload: dict):
    """Start or restart the physics simulation loop."""
    session.stop_simulation()

    # Debug: log injector config received
    inj_payload = payload.get("injector", {})
    print(f"[WS] start_simulation injector payload: {inj_payload}")

    config = SimulationConfig(**payload)
    print(f"[WS] parsed injector config: enabled={config.injector.enabled}, n_rings={config.injector.n_rings}")

    engine = ParametricEngine.from_dict(config.geometry.model_dump())
    material = material_db.get(config.material_id)

    # Build cooling config
    cooling_geom = cooling_config_to_geom(config.cooling)

    session.sim_engine = SimulationEngine(
        engine=engine, material=material,
        gamma=config.propellant.gamma,
        molecular_weight=config.propellant.molecular_weight,
        chamber_temperature_K=config.propellant.chamber_temperature_K,
        chamber_pressure_Pa=config.propellant.chamber_pressure_Pa,
        ambient_pressure_Pa=config.ambient_pressure_Pa,
        cooling_enabled=config.cooling.enabled,
        cooling_channel_geom=cooling_geom,
        coolant_mdot=config.cooling.coolant_mdot,
        coolant_type=config.cooling.coolant_type,
        coolant_inlet_temp=config.cooling.coolant_inlet_temp,
        coolant_inlet_pressure=config.cooling.coolant_inlet_pressure,
        rib_thickness_factor=config.cooling.rib_thickness_factor,
        injector_config=config.injector,
    )
    session.injector_config = config.injector

    # Send initial mesh
    mesh_data = export_for_frontend(engine, injector_config=config.injector)
    n_orif = len(mesh_data.get("injector_orifices", []))
    print(f"[WS] mesh_update sent: has injector_orifices={n_orif}")
    await manager.send_json(websocket, {"type": "mesh_update", "payload": mesh_data})

    # Start simulation loop
    session.sim_running = True

    async def sim_loop():
        while session.sim_running:
            try:
                tick_data = session.sim_engine.run_tick()
                await manager.send_json(websocket, {"type": "sim_tick", "payload": tick_data})
                await asyncio.sleep(0.1)  # ~10 Hz
            except asyncio.CancelledError:
                break
            except Exception as e:
                await manager.send_json(websocket, {
                    "type": "error",
                    "payload": {"code": "SIM_ERROR", "message": str(e)}
                })
                break

    session._sim_task = asyncio.create_task(sim_loop())


async def handle_update_params(websocket: WebSocket, session: SimulationSession, payload: dict):
    """Hot-update simulation parameters."""
    if session.sim_engine is None:
        await manager.send_json(websocket, {
            "type": "error",
            "payload": {"code": "NO_SIMULATION", "message": "No simulation running"}
        })
        return

    update = UpdateParams(**payload)

    new_engine = None
    new_material = None

    if update.geometry is not None:
        new_engine = ParametricEngine.from_dict(update.geometry.model_dump())
    if update.material_id is not None:
        new_material = material_db.get(update.material_id)

    cooling_geom = None
    if update.cooling is not None:
        cooling_geom = cooling_config_to_geom(update.cooling)

    injector_cfg = update.injector if update.injector is not None else None
    if injector_cfg is not None:
        session.injector_config = injector_cfg

    session.sim_engine.update_config(
        engine=new_engine,
        material=new_material,
        chamber_pressure_Pa=update.propellant.chamber_pressure_Pa if update.propellant else None,
        chamber_temperature_K=update.propellant.chamber_temperature_K if update.propellant else None,
        gamma=update.propellant.gamma if update.propellant else None,
        molecular_weight=update.propellant.molecular_weight if update.propellant else None,
        ambient_pressure_Pa=update.ambient_pressure_Pa,
        cooling_enabled=update.cooling.enabled if update.cooling else None,
        cooling_channel_geom=cooling_geom,
        coolant_mdot=update.cooling.coolant_mdot if update.cooling else None,
        coolant_type=update.cooling.coolant_type if update.cooling else None,
        rib_thickness_factor=update.cooling.rib_thickness_factor if update.cooling else None,
        injector_config=injector_cfg,
    )

    # If geometry or injector changed, send new mesh
    inj_cfg = getattr(session, 'injector_config', None)
    if new_engine is not None or injector_cfg is not None:
        engine_to_use = new_engine or session.sim_engine.engine
        mesh_data = export_for_frontend(engine_to_use, injector_config=inj_cfg)
        await manager.send_json(websocket, {"type": "mesh_update", "payload": mesh_data})


async def handle_request_mesh(websocket: WebSocket, session: SimulationSession):
    """Send current mesh data."""
    if session.sim_engine is None:
        await manager.send_json(websocket, {
            "type": "error",
            "payload": {"code": "NO_SIMULATION", "message": "No simulation configured"}
        })
        return

    inj_cfg = getattr(session, 'injector_config', None)
    mesh_data = export_for_frontend(session.sim_engine.engine, injector_config=inj_cfg)
    await manager.send_json(websocket, {"type": "mesh_update", "payload": mesh_data})


async def handle_start_evolution(websocket: WebSocket, session: SimulationSession, payload: dict):
    """Launch the evolutionary algorithm."""
    session.stop_evolution()

    ga_config = GAConfig(**payload)
    material = material_db.get(ga_config.material_id)

    session.evolution_running = True

    async def evo_loop():
        try:
            from backend.evolution.ga_engine import EvolutionRunner
            from backend.evolution.fitness import FitnessEvaluator

            cooling_cfg = ga_config.cooling if hasattr(ga_config, 'cooling') else CoolingConfig()
            injector_cfg = ga_config.injector if hasattr(ga_config, 'injector') else InjectorConfig()

            evaluator = FitnessEvaluator(
                weights=ga_config.fitness_weights,
                material=material,
                gamma=ga_config.propellant.gamma,
                molecular_weight=ga_config.propellant.molecular_weight,
                chamber_temperature_K=ga_config.propellant.chamber_temperature_K,
                chamber_pressure_Pa=ga_config.propellant.chamber_pressure_Pa,
                ambient_pressure_Pa=ga_config.ambient_pressure_Pa,
                cooling_enabled=cooling_cfg.enabled,
                coolant_type=cooling_cfg.coolant_type,
                injector_config=injector_cfg,
            )

            async def on_generation(snapshot):
                if session.evolution_running:
                    await manager.send_json(websocket, {
                        "type": "evolution_snapshot", "payload": snapshot
                    })

            runner = EvolutionRunner(
                population_size=ga_config.population_size,
                num_generations=ga_config.num_generations,
                crossover_prob=ga_config.crossover_prob,
                mutation_prob=ga_config.mutation_prob,
                evaluator=evaluator,
                on_generation=on_generation,
            )

            best = await runner.run_async(lambda: session.evolution_running)

            if session.evolution_running:
                await manager.send_json(websocket, {
                    "type": "evolution_complete",
                    "payload": best,
                })
        except asyncio.CancelledError:
            pass
        except Exception as e:
            await manager.send_json(websocket, {
                "type": "error",
                "payload": {"code": "EVOLUTION_ERROR", "message": str(e), "traceback": traceback.format_exc()}
            })
        finally:
            session.evolution_running = False

    session._evo_task = asyncio.create_task(evo_loop())
