# 3D Rocket Engine Simulator

Interactive browser-based simulator for designing, analyzing, and 3D-printing liquid rocket engines. Features real-time thermodynamic simulation, regenerative cooling analysis, evolutionary co-optimization, and STL export for metal additive manufacturing (SLM/DMLS).

![Python](https://img.shields.io/badge/Python-3.10+-blue) ![Three.js](https://img.shields.io/badge/Three.js-r168-green) ![FastAPI](https://img.shields.io/badge/FastAPI-0.115-teal)

## Features

- **Parametric Engine Geometry** — Bell nozzle contour with variable wall thickness (6 control points), configurable convergence angle, throat radii, and expansion ratio
- **Real-Time Simulation** — Isentropic flow solver computing thrust, Isp, mass flow, exit Mach, and station-by-station thermodynamic properties via WebSocket
- **Regenerative Cooling** — Counter-flow cooling channel analysis with axially varying channel height, configurable channel count/width/rib geometry, and RP-1/LH2/ethanol coolant properties
- **Visualization Modes** — Normal view, thermal heat map, von Mises stress overlay, internal flow with Mach coloring, and cooling channel cutaway with animated coolant flow
- **Evolutionary Optimization** — Multi-objective genetic algorithm (NSGA-II style) co-optimizing 25 design variables across 7 fitness objectives (thrust/weight, thermal survival, efficiency, structural integrity, cost, cooling effectiveness, coolant pressure drop)
- **3D Print Export** — Watertight STL generation in two modes: simple (solid wall) and full (with cooling channel voids) for direct metal printing
- **Material Database** — Copper C10200, Inconel 718, Stainless 304, Haynes 230, Niobium C-103 with full thermal/mechanical properties

## Quick Start

```bash
# Clone the repository
git clone https://github.com/DanielTea/3DRocketEngine_Simulator.git
cd 3DRocketEngine_Simulator

# Setup (creates venv, installs deps, downloads Three.js)
make setup

# Run the server
make run
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

## Project Structure

```
backend/
  main.py                  # FastAPI app (REST + WebSocket + static files)
  api/
    rest_routes.py         # REST endpoints (materials, presets, STL export)
    schemas.py             # Pydantic request/response models
    ws_handler.py          # WebSocket handler (simulation, evolution)
  geometry/
    parametric_engine.py   # Parametric engine profile generation
    contour.py             # Bell nozzle contour (Rao method)
    wall_thickness.py      # Variable wall thickness via B-spline
    mesh_export.py         # Frontend mesh data export
    stl_export.py          # Binary STL generation for 3D printing
  physics/
    isentropic.py          # Compressible flow solver
    thermal.py             # Wall temperature analysis
    structural.py          # Stress and safety factor calculation
    coolant_properties.py  # Coolant thermophysical properties
    regen_cooling.py       # Regenerative cooling channel solver
  evolution/
    ga_engine.py           # Genetic algorithm driver
    population.py          # Population initialization and management
    operators.py           # Crossover and mutation operators
    fitness.py             # Multi-objective fitness evaluation
  materials/
    database.py            # Material property database
    material_data.json     # Material definitions
  config.py                # Simulation defaults
  requirements.txt         # Python dependencies

frontend/
  index.html               # Main UI layout
  style.css                # Dark theme styling
  js/
    main.js                # App initialization and event wiring
    scene.js               # Three.js scene, camera, lighting
    engine_mesh.js         # 3D mesh construction from profile data
    cooling_viz.js         # Cooling channel shader visualization
    flame_particles.js     # Physics-based exhaust plume particles
    internal_flow.js       # Internal propellant flow particles
    heat_map.js            # Thermal heat map overlay
    stress_overlay.js      # Von Mises stress overlay
    flow_viz.js            # Flow Mach number visualization
    color_scales.js        # Color mapping and legend rendering
    evolution_chart.js     # Fitness evolution chart (Canvas 2D)
    ui_panels.js           # Sidebar controls and readouts
    ws_client.js           # WebSocket client
    rest_client.js         # REST API client
    utils.js               # Shared utilities
```

## Requirements

- Python 3.10+
- Modern browser with WebGL support

### Python Dependencies

- FastAPI + Uvicorn (web server)
- NumPy + SciPy (numerical computation)
- numpy-stl (STL file generation)
- DEAP (evolutionary algorithms)
- Pydantic (data validation)

## Usage

### Design an Engine

1. Select a **material** from the sidebar (or start with a preset)
2. Adjust **geometry sliders** — chamber diameter, throat diameter, expansion ratio, wall thickness control points, bell nozzle shape
3. Configure **regenerative cooling** — channel count, width, height, rib width, coolant type and flow rate
4. Click **Run Simulation** to see real-time performance metrics and visualization overlays

### Visualization Modes

- **Normal** — Standard 3D view with metallic material
- **Heat Map** — Wall temperature distribution (K)
- **Stress** — Von Mises stress with yield threshold coloring
- **Flow** — Internal Mach number distribution with particle animation
- **Cooling** — Channel cutaway with animated coolant flow and cross-section slider

### Evolutionary Optimization

1. Expand the **Evolution** panel at the bottom
2. Set population size, generations, crossover/mutation rates
3. Adjust **fitness weights** for the 7 objectives
4. Click **Start Evolution** — watch the fitness chart converge
5. Click **Load Best Design** to apply the optimized geometry

### 3D Print Export

1. Select **Simple** (solid wall prototype) or **Full** (with cooling channel voids for functional prints)
2. Adjust resolution (32–256 circumferential segments)
3. Toggle injector face inclusion
4. Click **Download STL** — opens in any slicer or mesh viewer

## License

MIT
