/**
 * Stress visualization: applies per-vertex von Mises stress colors.
 */
import * as THREE from 'three';
import { stressColor } from './color_scales.js';
import { getOuterMesh, getStationCount, getCircumSegments } from './engine_mesh.js';

let originalMaterial = null;
let stressMaterial = null;

/**
 * Apply stress color overlay to the outer engine mesh.
 * @param {number[]} stationStress - von Mises stress at each station (MPa)
 * @param {number} yieldStrength - material yield strength (MPa)
 */
export function applyStressOverlay(stationStress, yieldStrength) {
    const mesh = getOuterMesh();
    if (!mesh) return;

    const nStations = getStationCount();
    const nCirc = getCircumSegments();
    const geo = mesh.geometry;

    if (!originalMaterial) {
        originalMaterial = mesh.material;
    }

    const posCount = geo.attributes.position.count;
    const colors = new Float32Array(posCount * 3);

    for (let i = 0; i < nStations; i++) {
        const stress = stationStress[i] !== undefined ? stationStress[i] : 0;
        const [r, g, b] = stressColor(stress, yieldStrength);

        for (let j = 0; j <= nCirc; j++) {
            const idx = i * (nCirc + 1) + j;
            colors[idx * 3] = r;
            colors[idx * 3 + 1] = g;
            colors[idx * 3 + 2] = b;
        }
    }

    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    if (!stressMaterial) {
        stressMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            metalness: 0.3,
            roughness: 0.6,
            side: THREE.DoubleSide,
        });
    }

    mesh.material = stressMaterial;
    geo.attributes.color.needsUpdate = true;

    return { max: Math.max(...stationStress), yield: yieldStrength };
}

/**
 * Remove stress overlay and restore original material.
 */
export function clearStressOverlay() {
    const mesh = getOuterMesh();
    if (!mesh || !originalMaterial) return;
    mesh.material = originalMaterial;
}
