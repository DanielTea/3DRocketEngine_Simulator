/**
 * Flow visualization: Mach-colored inner surface + coolant flow arrows.
 *
 * In "flow" mode:
 *  - Inner mesh is colored by Mach number (blue=subsonic, white=sonic, red=supersonic)
 *  - Coolant flow is indicated by arrow lines along the outer surface
 */
import * as THREE from 'three';
import { getOuterMesh, getInnerMesh, getStationCount, getCircumSegments } from './engine_mesh.js';
import { mapRange, clamp } from './utils.js';

let coolantArrows = null;
let flowColorsApplied = false;

/**
 * Mach number to color: blue (M<1) -> white (M=1) -> red (M>3)
 */
function machColor(M) {
    if (M <= 1.0) {
        const t = clamp(M, 0, 1);
        // blue -> white
        return [
            mapRange(t, 0, 1, 0.2, 1.0),
            mapRange(t, 0, 1, 0.4, 1.0),
            mapRange(t, 0, 1, 1.0, 1.0),
        ];
    } else {
        const t = clamp((M - 1.0) / 3.0, 0, 1);
        // white -> red
        return [
            1.0,
            mapRange(t, 0, 1, 1.0, 0.2),
            mapRange(t, 0, 1, 1.0, 0.1),
        ];
    }
}

/**
 * Apply Mach-number coloring to the inner mesh.
 */
export function applyFlowVisualization(machArray, coolantData) {
    const innerMesh = getInnerMesh();
    if (!innerMesh || !machArray) return;

    const nStations = getStationCount();
    const nCirc = getCircumSegments();
    const geo = innerMesh.geometry;

    // Create or update vertex color attribute
    const vertexCount = nStations * (nCirc + 1);
    let colors = geo.getAttribute('color');
    if (!colors || colors.count !== vertexCount) {
        colors = new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 3), 3);
        geo.setAttribute('color', colors);
    }

    for (let i = 0; i < nStations; i++) {
        const M = i < machArray.length ? machArray[i] : 1.0;
        const [r, g, b] = machColor(M);
        for (let j = 0; j <= nCirc; j++) {
            const idx = i * (nCirc + 1) + j;
            colors.setXYZ(idx, r, g, b);
        }
    }
    colors.needsUpdate = true;

    // Enable vertex colors on the material
    innerMesh.material.vertexColors = true;
    innerMesh.material.needsUpdate = true;
    flowColorsApplied = true;

    // Draw coolant flow arrows if data is available
    if (coolantData && coolantData.coolant_velocity_m_s) {
        drawCoolantFlow(coolantData);
    }
}

/**
 * Draw coolant flow direction arrows along the outer surface.
 */
function drawCoolantFlow(coolantData) {
    removeCoolantArrows();

    const outerMesh = getOuterMesh();
    if (!outerMesh || !outerMesh.parent) return;

    const scene = outerMesh.parent;
    const geo = outerMesh.geometry;
    const posAttr = geo.getAttribute('position');
    if (!posAttr) return;

    const nStations = getStationCount();
    const nCirc = getCircumSegments();

    // Sample a few circumferential positions for arrows
    const circumSamples = [0, Math.floor(nCirc / 4), Math.floor(nCirc / 2), Math.floor(3 * nCirc / 4)];
    const arrowGroup = new THREE.Group();

    // Arrows go from nozzle exit (high station index) toward chamber (low index)
    const step = Math.max(1, Math.floor(nStations / 15));

    for (const jSample of circumSamples) {
        const points = [];
        for (let i = nStations - 1; i >= 0; i -= step) {
            const idx = i * (nCirc + 1) + jSample;
            if (idx * 3 + 2 < posAttr.array.length) {
                points.push(new THREE.Vector3(
                    posAttr.array[idx * 3],
                    posAttr.array[idx * 3 + 1],
                    posAttr.array[idx * 3 + 2]
                ));
            }
        }

        if (points.length >= 2) {
            const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
            const lineMat = new THREE.LineBasicMaterial({
                color: 0x00ccff,
                transparent: true,
                opacity: 0.6,
                linewidth: 2,
            });
            const line = new THREE.Line(lineGeo, lineMat);
            arrowGroup.add(line);

            // Add arrowhead at the end (chamber direction)
            const lastPt = points[points.length - 1];
            const prevPt = points[points.length - 2];
            const dir = new THREE.Vector3().subVectors(lastPt, prevPt).normalize();
            const arrowHelper = new THREE.ArrowHelper(dir, prevPt, 0.005, 0x00ccff, 0.003, 0.002);
            arrowGroup.add(arrowHelper);
        }
    }

    scene.add(arrowGroup);
    coolantArrows = arrowGroup;
}

/**
 * Remove coolant flow arrows.
 */
function removeCoolantArrows() {
    if (coolantArrows && coolantArrows.parent) {
        coolantArrows.parent.remove(coolantArrows);
        coolantArrows.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }
    coolantArrows = null;
}

/**
 * Clear flow visualization.
 */
export function clearFlowViz() {
    removeCoolantArrows();

    if (flowColorsApplied) {
        const innerMesh = getInnerMesh();
        if (innerMesh) {
            innerMesh.material.vertexColors = false;
            innerMesh.material.needsUpdate = true;
            const geo = innerMesh.geometry;
            if (geo.getAttribute('color')) {
                geo.deleteAttribute('color');
            }
        }
        flowColorsApplied = false;
    }
}
