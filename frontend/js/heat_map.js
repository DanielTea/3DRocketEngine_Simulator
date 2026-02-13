/**
 * Heat map visualization: applies per-vertex thermal colors to the engine mesh.
 */
import * as THREE from 'three';
import { thermalColor } from './color_scales.js';
import { getOuterMesh, getStationCount, getCircumSegments } from './engine_mesh.js';

let originalMaterial = null;
let heatMaterial = null;

/**
 * Apply thermal color map to the outer engine mesh.
 * @param {number[]} stationTemps - wall temperature at each station (K)
 */
export function applyHeatMap(stationTemps) {
    const mesh = getOuterMesh();
    if (!mesh) return;

    const nStations = getStationCount();
    const nCirc = getCircumSegments();
    const geo = mesh.geometry;

    if (!originalMaterial) {
        originalMaterial = mesh.material;
    }

    // Create vertex color attribute
    const posCount = geo.attributes.position.count;
    const colors = new Float32Array(posCount * 3);

    const tMin = Math.min(...stationTemps);
    const tMax = Math.max(...stationTemps);

    for (let i = 0; i < nStations; i++) {
        const temp = stationTemps[i] !== undefined ? stationTemps[i] : tMin;
        const [r, g, b] = thermalColor(temp, tMin, tMax);

        for (let j = 0; j <= nCirc; j++) {
            const idx = i * (nCirc + 1) + j;
            colors[idx * 3] = r;
            colors[idx * 3 + 1] = g;
            colors[idx * 3 + 2] = b;
        }
    }

    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    if (!heatMaterial) {
        heatMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            metalness: 0.3,
            roughness: 0.6,
            side: THREE.DoubleSide,
        });
    }

    mesh.material = heatMaterial;
    geo.attributes.color.needsUpdate = true;

    return { min: tMin, max: tMax };
}

/**
 * Remove heat map and restore original material.
 */
export function clearHeatMap() {
    const mesh = getOuterMesh();
    if (!mesh || !originalMaterial) return;
    mesh.material = originalMaterial;
}
