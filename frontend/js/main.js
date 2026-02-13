/**
 * 3D Rocket Engine Simulator — Main Entry Point
 * Initializes scene, WebSocket, UI panels, and wires everything together.
 */
import { initScene, getScene, onAnimate, setCameraView, frameMesh } from './scene.js';
import { buildEngineMesh, updateMeshColor } from './engine_mesh.js';
import { createFlameSystem, updateFlame, setFlameVisible, setExhaustPhysics } from './flame_particles.js';
import { createInternalFlow, updateInternalFlow, advanceInternalFlowParticles, setInternalFlowVisible } from './internal_flow.js';
import { applyHeatMap, clearHeatMap } from './heat_map.js';
import { applyStressOverlay, clearStressOverlay } from './stress_overlay.js';
import { applyFlowVisualization, clearFlowViz } from './flow_viz.js';
import { showCoolingViz, showCrossSection, clearCoolingViz, updateChannelAnimation } from './cooling_viz.js';
import { thermalColor, stressColor, drawLegend } from './color_scales.js';
import { WSClient } from './ws_client.js';
import { fetchMaterials, fetchPresets, exportSTL } from './rest_client.js';
import {
    initGeometrySliders, initPropellantInputs, initCoolingControls,
    initMaterialSelector, updateMaterialCard,
    updatePerformanceReadout, setGeometryFromConfig, setPropellantFromConfig,
    setCoolingFromConfig, getGeometry, getPropellant, getCooling,
} from './ui_panels.js';
import { initEvolutionChart, addGenerationData, clearChart } from './evolution_chart.js';

// ── State ──
let ws = null;
let simRunning = false;
let evoRunning = false;
let currentMaterialId = 'copper_c10200';
let currentMaterial = null;
let materialsMap = {};
let vizMode = 'normal';  // 'normal', 'heatmap', 'stress', 'flow', 'cooling'
let lastSimData = null;
let lastMeshData = null;
let bestEvoGenome = null;

// ── Initialization ──
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Init Three.js scene
    const canvas = document.getElementById('three-canvas');
    initScene(canvas);

    // 2. Init evolution chart
    const evoChartCanvas = document.getElementById('evolution-chart');
    initEvolutionChart(evoChartCanvas);

    // 3. Fetch materials and presets
    try {
        const [matData, presetData] = await Promise.all([fetchMaterials(), fetchPresets()]);
        const materials = matData.materials || [];

        for (const m of materials) materialsMap[m.id] = m;

        initMaterialSelector(
            document.getElementById('material-select'),
            materials,
            onMaterialChange
        );

        const presetSelect = document.getElementById('preset-select');
        for (const p of (presetData.presets || [])) {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            opt._preset = p;
            presetSelect.appendChild(opt);
        }
        presetSelect.addEventListener('change', () => {
            const opt = presetSelect.selectedOptions[0];
            if (opt && opt._preset) loadPreset(opt._preset);
        });
    } catch (e) {
        console.error('Failed to fetch initial data:', e);
    }

    // 4. Init UI sliders and inputs
    initGeometrySliders(document.getElementById('geometry-sliders'), onParamChange);
    initPropellantInputs(document.getElementById('propellant-inputs'), onParamChange);
    initCoolingControls(document.getElementById('cooling-controls'), onParamChange);

    // 5. Connect WebSocket
    const wsUrl = `ws://${location.host}/ws`;
    ws = new WSClient(wsUrl);
    ws.onStatusChange = (status) => {
        const el = document.getElementById('connection-status');
        if (status === 'connected') {
            el.textContent = 'Connected';
            el.className = 'status-connected';
        } else {
            el.textContent = 'Disconnected';
            el.className = 'status-disconnected';
        }
    };

    ws.on('mesh_update', onMeshUpdate);
    ws.on('sim_tick', onSimTick);
    ws.on('evolution_snapshot', onEvolutionSnapshot);
    ws.on('evolution_complete', onEvolutionComplete);
    ws.on('error', onError);

    ws.connect();

    // 6. Wire buttons
    document.getElementById('btn-start-sim').addEventListener('click', startSimulation);
    document.getElementById('btn-stop-sim').addEventListener('click', stopSimulation);
    document.getElementById('btn-start-evo').addEventListener('click', startEvolution);
    document.getElementById('btn-stop-evo').addEventListener('click', stopEvolution);
    document.getElementById('btn-load-best').addEventListener('click', loadBestDesign);

    // 7. STL export controls
    document.getElementById('stl-resolution').addEventListener('input', (e) => {
        document.getElementById('stl-res-val').textContent = `${e.target.value} segments`;
    });

    document.getElementById('btn-export-stl').addEventListener('click', async () => {
        const statusEl = document.getElementById('stl-status');
        const btn = document.getElementById('btn-export-stl');
        const mode = document.getElementById('stl-mode-select').value;
        const resolution = parseInt(document.getElementById('stl-resolution').value);
        const includeInjector = document.getElementById('stl-injector').checked;

        btn.disabled = true;
        statusEl.textContent = 'Generating STL...';

        try {
            await exportSTL({
                geometry: getGeometry(),
                cooling: getCooling(),
                mode,
                include_injector: includeInjector,
                resolution,
            });
            statusEl.textContent = 'Download started!';
        } catch (e) {
            statusEl.textContent = `Error: ${e.message}`;
            console.error('STL export error:', e);
        } finally {
            btn.disabled = false;
            setTimeout(() => { statusEl.textContent = ''; }, 5000);
        }
    });

    // 8. Viz mode buttons
    document.querySelectorAll('.viz-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.viz-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            vizMode = btn.dataset.mode;
            applyVisualization();
        });
    });

    // 8. Camera buttons
    document.querySelectorAll('.cam-btn').forEach(btn => {
        btn.addEventListener('click', () => setCameraView(btn.dataset.view));
    });

    // 9. Bottom panel toggle
    const bottomPanel = document.getElementById('bottom-panel');
    document.getElementById('bottom-toggle').addEventListener('click', () => {
        bottomPanel.classList.toggle('collapsed');
    });

    // 10. Evo param sliders
    document.getElementById('evo-cx').addEventListener('input', (e) => {
        document.getElementById('evo-cx-val').textContent = (e.target.value / 100).toFixed(2);
    });
    document.getElementById('evo-mut').addEventListener('input', (e) => {
        document.getElementById('evo-mut-val').textContent = (e.target.value / 100).toFixed(2);
    });

    // Fitness weight sliders (all 7)
    document.querySelectorAll('.weight-slider input').forEach(input => {
        input.addEventListener('input', () => {
            input.parentElement.querySelector('.w-val').textContent = (input.value / 100).toFixed(2);
        });
    });

    // 11. Section position slider (for cooling cutaway / cross-section)
    document.getElementById('section-slider').addEventListener('input', (e) => {
        const pct = parseInt(e.target.value);
        document.getElementById('section-slider-val').textContent = `${Math.round(pct / 2)}%`;
        if (vizMode === 'cooling' && lastMeshData && lastSimData) {
            const cooling = getCooling();
            showCrossSection(lastMeshData, cooling, pct, lastSimData.cooling || null);
        }
    });

    // Flame + cooling + internal flow animation in render loop
    onAnimate(() => {
        if (simRunning && lastMeshData) {
            const thrust = lastSimData?.performance?.thrust_N || 0;
            const maxThrust = 50000;
            updateFlame(
                lastMeshData.exit_x || 0.4,
                lastMeshData.station_r_inner?.[lastMeshData.station_r_inner.length - 1] || 0.04,
                Math.min(thrust / maxThrust, 1.0)
            );
        }
        if (vizMode === 'cooling') {
            updateChannelAnimation(performance.now() * 0.001);
        }
        if (vizMode === 'flow' && simRunning) {
            advanceInternalFlowParticles();
        }
    });
});

// ── Handlers ──

function onMaterialChange(materialId, material) {
    currentMaterialId = materialId;
    currentMaterial = material;
    updateMaterialCard(document.getElementById('material-card'), material);
    updateMeshColor(material.color_hex);

    if (simRunning && ws.connected) {
        ws.send('update_params', { material_id: materialId });
    }
}

function onParamChange(type, values) {
    if (simRunning && ws.connected) {
        const payload = {};
        if (type === 'geometry') payload.geometry = values;
        if (type === 'propellant') payload.propellant = values;
        if (type === 'cooling') payload.cooling = values;
        ws.send('update_params', payload);
    }
}

function onMeshUpdate(data) {
    lastMeshData = data;
    const scene = getScene();
    const colorHex = currentMaterial?.color_hex || '#C0C0C0';
    buildEngineMesh(data, scene, colorHex);

    const totalLen = data.total_length_m || 0.2;
    const maxR = Math.max(...(data.station_r_outer || [0.04]));
    frameMesh(totalLen, maxR);

    const exitX = data.exit_x || 0.15;
    const exitR = data.station_r_inner?.[data.station_r_inner.length - 1] || 0.02;
    createFlameSystem(scene, exitX, exitR);
    setFlameVisible(simRunning);

    // (Re-)create internal flow particle system
    createInternalFlow(scene);
    setInternalFlowVisible(simRunning && vizMode === 'flow');
}

function onSimTick(data) {
    lastSimData = data;
    updatePerformanceReadout(data);

    // Feed physics-based exhaust data to the plume
    const st = data.stations;
    if (st?.mach?.length) {
        const nSt = st.mach.length;
        setExhaustPhysics({
            exit_mach: st.mach[nSt - 1],
            exit_pressure_Pa: st.pressure_Pa?.[nSt - 1] || 101325,
            ambient_pressure_Pa: 101325,
            exit_temperature_K: st.temperature_K?.[nSt - 1] || 1800,
            gamma: data.performance?.gamma || 1.2,
        });
    }

    // Update internal flow particle data (full texture update on sim tick)
    if (lastMeshData?.station_x && st?.mach) {
        updateInternalFlow({
            station_x: lastMeshData.station_x,
            station_r_inner: lastMeshData.station_r_inner,
            mach: st.mach,
            velocity_m_s: st.velocity_m_s,
            temperature_K: st.temperature_K,
        });
        setInternalFlowVisible(simRunning && vizMode === 'flow');
    }

    applyVisualization();
}

function onEvolutionSnapshot(data) {
    addGenerationData(data.generation, data.best_fitness, data.avg_fitness, data.worst_fitness);
    document.getElementById('evo-status').textContent =
        `Gen ${data.generation} | Best: ${data.best_fitness.toFixed(4)} | Diversity: ${data.diversity.toFixed(3)}`;
    bestEvoGenome = data.best_genome;
    document.getElementById('btn-load-best').disabled = false;
}

function onEvolutionComplete(data) {
    evoRunning = false;
    document.getElementById('btn-start-evo').disabled = false;
    document.getElementById('btn-stop-evo').disabled = true;
    bestEvoGenome = data.best_genome;
    document.getElementById('evo-status').textContent =
        `Complete! ${data.total_generations} gens | Best: ${data.best_fitness.toFixed(4)} | Reason: ${data.reason}`;
}

function onError(data) {
    console.error('Server error:', data.code, data.message);
    document.getElementById('evo-status').textContent = `Error: ${data.message}`;
}

function applyVisualization() {
    if (!lastSimData) return;
    const stations = lastSimData.stations;
    const cooling = lastSimData.cooling;
    const legendCanvas = document.getElementById('legend-canvas');
    const legendCtx = legendCanvas.getContext('2d');
    const sectionSlider = document.getElementById('section-slider-container');

    // Clear all overlays first
    clearHeatMap();
    clearStressOverlay();
    clearFlowViz();
    if (vizMode !== 'cooling') clearCoolingViz();
    if (vizMode !== 'flow') setInternalFlowVisible(false);

    // Hide section slider by default (only shown in cooling mode)
    sectionSlider.style.display = 'none';

    if (vizMode === 'heatmap' && stations?.wall_temp_inner_K) {
        const range = applyHeatMap(stations.wall_temp_inner_K);
        if (range) {
            legendCanvas.style.display = 'block';
            drawLegend(legendCtx, 5, 10, 20, 260, thermalColor, range.min, range.max, 'K');
        }
    } else if (vizMode === 'stress' && stations?.von_mises_stress_MPa) {
        const yieldMPa = currentMaterial?.yield_strength_MPa || 200;
        applyStressOverlay(stations.von_mises_stress_MPa, yieldMPa);
        legendCanvas.style.display = 'block';
        const maxStress = Math.max(...stations.von_mises_stress_MPa);
        drawLegend(legendCtx, 5, 10, 20, 260,
            (v, mn, mx) => stressColor(v, yieldMPa), 0, Math.max(maxStress, yieldMPa), 'MPa');
    } else if (vizMode === 'flow' && stations?.mach) {
        applyFlowVisualization(stations.mach, cooling);
        setInternalFlowVisible(simRunning);
        legendCanvas.style.display = 'block';
        const maxMach = Math.max(...stations.mach);
        drawLegend(legendCtx, 5, 10, 20, 260,
            (v, mn, mx) => {
                const M = mn + (mx - mn) * v;
                if (M <= 1) return `rgb(${Math.round(51 + 204 * M)},${Math.round(102 + 153 * M)},255)`;
                const t = Math.min((M - 1) / 3, 1);
                return `rgb(255,${Math.round(255 - 204 * t)},${Math.round(255 - 230 * t)})`;
            }, 0, Math.max(maxMach, 3), 'Mach');
    } else if (vizMode === 'cooling' && lastMeshData) {
        const coolingCfg = getCooling();
        showCoolingViz(lastMeshData, coolingCfg, cooling, true);

        // Show cross-section ring at current slider position
        const sliderVal = parseInt(document.getElementById('section-slider').value);
        const maxStation = (lastMeshData.station_x?.length || 200) - 1;
        document.getElementById('section-slider').max = maxStation;
        showCrossSection(lastMeshData, coolingCfg, sliderVal, cooling);
        sectionSlider.style.display = 'block';

        // Legend for coolant temperature
        if (cooling?.T_coolant_K) {
            const tMin = Math.min(...cooling.T_coolant_K);
            const tMax = Math.max(...cooling.T_coolant_K);
            legendCanvas.style.display = 'block';
            drawLegend(legendCtx, 5, 10, 20, 260,
                (v, mn, mx) => {
                    const T = mn + (mx - mn) * v;
                    const t = (T - mn) / Math.max(mx - mn, 1);
                    if (t < 0.33) return `rgb(0,${Math.round(77 + 153 * t / 0.33)},255)`;
                    if (t < 0.66) {
                        const s = (t - 0.33) / 0.33;
                        return `rgb(${Math.round(255 * s)},230,${Math.round(255 * (1 - s))})`;
                    }
                    const s = (t - 0.66) / 0.34;
                    return `rgb(255,${Math.round(230 - 192 * s)},0)`;
                }, tMin, tMax, 'K');
        } else {
            legendCanvas.style.display = 'none';
        }
    } else {
        legendCanvas.style.display = 'none';
    }
}

// ── Actions ──

function startSimulation() {
    const geometry = getGeometry();
    const propellant = getPropellant();
    const cooling = getCooling();

    ws.send('start_simulation', {
        geometry,
        propellant,
        cooling,
        material_id: currentMaterialId,
        ambient_pressure_Pa: 101325,
    });

    simRunning = true;
    setFlameVisible(true);
    document.getElementById('btn-start-sim').disabled = true;
    document.getElementById('btn-stop-sim').disabled = false;
}

function stopSimulation() {
    ws.send('stop_simulation');
    simRunning = false;
    setFlameVisible(false);
    document.getElementById('btn-start-sim').disabled = false;
    document.getElementById('btn-stop-sim').disabled = true;
}

function startEvolution() {
    clearChart();

    const cooling = getCooling();
    const fitnessWeights = {
        thrust_to_weight: parseInt(document.getElementById('w-tw').value) / 100,
        thermal_survival: parseInt(document.getElementById('w-thermal').value) / 100,
        efficiency: parseInt(document.getElementById('w-eff').value) / 100,
        structural_integrity: parseInt(document.getElementById('w-struct').value) / 100,
        cost_efficiency: parseInt(document.getElementById('w-cost').value) / 100,
        cooling_effectiveness: parseInt(document.getElementById('w-cooling').value) / 100,
        coolant_pressure_drop: parseInt(document.getElementById('w-pressure').value) / 100,
    };

    ws.send('start_evolution', {
        population_size: parseInt(document.getElementById('evo-pop-size').value),
        num_generations: parseInt(document.getElementById('evo-generations').value),
        crossover_prob: parseInt(document.getElementById('evo-cx').value) / 100,
        mutation_prob: parseInt(document.getElementById('evo-mut').value) / 100,
        fitness_weights: fitnessWeights,
        propellant: getPropellant(),
        cooling,
        material_id: currentMaterialId,
        ambient_pressure_Pa: 101325,
    });

    evoRunning = true;
    document.getElementById('btn-start-evo').disabled = true;
    document.getElementById('btn-stop-evo').disabled = false;
    document.getElementById('evo-status').textContent = 'Starting co-optimization...';
}

function stopEvolution() {
    ws.send('stop_evolution');
    evoRunning = false;
    document.getElementById('btn-start-evo').disabled = false;
    document.getElementById('btn-stop-evo').disabled = true;
}

function loadBestDesign() {
    if (!bestEvoGenome) return;
    setGeometryFromConfig(bestEvoGenome);

    if (!simRunning) {
        startSimulation();
    }
}

function loadPreset(preset) {
    if (preset.geometry) setGeometryFromConfig(preset.geometry);
    if (preset.propellant) setPropellantFromConfig(preset.propellant);
    if (preset.cooling) setCoolingFromConfig(preset.cooling);
    if (preset.material_id) {
        const select = document.getElementById('material-select');
        select.value = preset.material_id;
        select.dispatchEvent(new Event('change'));
    }
}
