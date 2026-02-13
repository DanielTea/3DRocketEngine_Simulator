/**
 * Build and update the rocket engine 3D mesh from profile data.
 * Uses LatheGeometry-like approach with BufferGeometry for maximum control.
 */
import * as THREE from 'three';

let outerMesh = null;
let innerMesh = null;
let currentGroup = null;
let stationCount = 0;
let circumSegments = 64;

/**
 * Build the engine mesh group from profile data received from the backend.
 * @param {Object} meshData - mesh_update payload from backend
 * @param {THREE.Scene} scene
 * @param {string} colorHex - material color
 * @returns {THREE.Group}
 */
export function buildEngineMesh(meshData, scene, colorHex = '#C0C0C0') {
    // Remove old mesh
    if (currentGroup) {
        scene.remove(currentGroup);
        currentGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }

    currentGroup = new THREE.Group();
    const profile2d = meshData.profile_2d;
    const outerProfile2d = meshData.outer_profile_2d;
    stationCount = profile2d.length;

    // Outer wall — primary visible surface
    const outerGeo = createLatheGeometry(outerProfile2d, circumSegments);
    const outerMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        metalness: 0.45,
        roughness: 0.4,
        side: THREE.DoubleSide,
        envMapIntensity: 1.0,
    });
    outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.castShadow = true;
    outerMesh.receiveShadow = true;
    currentGroup.add(outerMesh);

    // Inner wall — visible through nozzle opening, darker
    const innerGeo = createLatheGeometry(profile2d, circumSegments);
    const innerColor = new THREE.Color(colorHex).multiplyScalar(0.4);
    const innerMat = new THREE.MeshStandardMaterial({
        color: innerColor,
        metalness: 0.3,
        roughness: 0.7,
        side: THREE.BackSide,
    });
    innerMesh = new THREE.Mesh(innerGeo, innerMat);
    currentGroup.add(innerMesh);

    // Edge wireframe overlay for shape definition
    const edgeMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        wireframe: true,
        transparent: true,
        opacity: 0.04,
    });
    const edgeMesh = new THREE.Mesh(outerGeo.clone(), edgeMat);
    currentGroup.add(edgeMesh);

    // End caps — show wall cross-section at chamber and nozzle ends
    const capMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex).multiplyScalar(0.7),
        metalness: 0.5,
        roughness: 0.5,
        side: THREE.DoubleSide,
    });

    const chamberCapGeo = createEndCapGeometry(
        profile2d[0][0], profile2d[0][1], outerProfile2d[0][1], circumSegments, true
    );
    currentGroup.add(new THREE.Mesh(chamberCapGeo, capMat));

    const nLast = profile2d.length - 1;
    const nozzleCapGeo = createEndCapGeometry(
        profile2d[nLast][0], profile2d[nLast][1], outerProfile2d[nLast][1], circumSegments, false
    );
    currentGroup.add(new THREE.Mesh(nozzleCapGeo, capMat.clone()));

    // Cooling channel indicators on outer wall (subtle lines + manifold rings)
    if (outerProfile2d.length >= 2) {
        const coolingGroup = createCoolingChannelIndicators(outerProfile2d, meshData);
        currentGroup.add(coolingGroup);
    }

    // Injector face — with optional orifice holes
    const orifices = meshData.injector_orifices || null;
    console.log('[EngineMesh] injector_orifices:', orifices ? orifices.length : 'none');
    if (orifices && orifices.length > 0) {
        const injGroup = createInjectorFaceWithOrifices(
            profile2d[0][0], profile2d[0][1], orifices, circumSegments
        );
        currentGroup.add(injGroup);
    } else {
        const injectorGeo = createInjectorFaceGeometry(
            profile2d[0][0], profile2d[0][1], circumSegments
        );
        const injectorMat = new THREE.MeshStandardMaterial({
            color: 0x444455,
            metalness: 0.6,
            roughness: 0.3,
            side: THREE.DoubleSide,
        });
        currentGroup.add(new THREE.Mesh(injectorGeo, injectorMat));
    }

    scene.add(currentGroup);
    return currentGroup;
}

/**
 * Create an annular ring (end cap) at a given axial station.
 */
function createEndCapGeometry(x, rInner, rOuter, segments, faceNegativeX) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const nx = faceNegativeX ? -1 : 1;

    for (let j = 0; j <= segments; j++) {
        const theta = (j / segments) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const v = j / segments;

        // Inner ring vertex
        positions.push(x, rInner * cosT, rInner * sinT);
        normals.push(nx, 0, 0);
        uvs.push(0, v);

        // Outer ring vertex
        positions.push(x, rOuter * cosT, rOuter * sinT);
        normals.push(nx, 0, 0);
        uvs.push(1, v);
    }

    for (let j = 0; j < segments; j++) {
        const i0 = j * 2;
        const o0 = j * 2 + 1;
        const i1 = (j + 1) * 2;
        const o1 = (j + 1) * 2 + 1;

        if (faceNegativeX) {
            indices.push(i0, o0, i1, i1, o0, o1);
        } else {
            indices.push(i0, i1, o0, o0, i1, o1);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
}

/**
 * Create a filled disc for the injector face at the chamber inlet.
 */
function createInjectorFaceGeometry(x, rInner, segments) {
    const positions = [x, 0, 0];
    const normals = [-1, 0, 0];
    const uvs = [0.5, 0.5];
    const indices = [];

    for (let j = 0; j <= segments; j++) {
        const theta = (j / segments) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        positions.push(x, rInner * cosT, rInner * sinT);
        normals.push(-1, 0, 0);
        uvs.push(0.5 + 0.5 * cosT, 0.5 + 0.5 * sinT);
    }

    for (let j = 1; j <= segments; j++) {
        indices.push(0, j + 1, j);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
}

/**
 * Create injector face with orifice holes using polar grid exclusion.
 * Returns a THREE.Group with the face mesh and colored orifice ring markers.
 *
 * Resolution is computed from the smallest orifice so that grid cells
 * are smaller than the holes — otherwise no cell center would ever land
 * inside a hole and the exclusion test would produce no visible openings.
 */
function createInjectorFaceWithOrifices(x, faceRadius, orifices, segments) {
    const group = new THREE.Group();

    // Determine required resolution from smallest orifice
    let minOrificeRadius = faceRadius;
    for (const o of orifices) {
        if (o.radius < minOrificeRadius) minOrificeRadius = o.radius;
    }
    // Cell size should be ~half the orifice diameter for clear holes
    const cellTarget = minOrificeRadius;  // = half orifice diameter
    const nRadial = Math.min(120, Math.max(40, Math.ceil(faceRadius / cellTarget)));
    const nAngular = Math.min(512, Math.max(segments, Math.ceil(2 * Math.PI * faceRadius / cellTarget)));

    // Build polar grid face with holes
    const positions = [];
    const normals = [];
    const indices = [];

    const radii = [];
    for (let i = 0; i <= nRadial; i++) radii.push((i / nRadial) * faceRadius);

    const thetas = [];
    for (let j = 0; j <= nAngular; j++) thetas.push((j / nAngular) * Math.PI * 2);

    // Vertex grid: [radial][angular]
    const vertexMap = [];
    let vIdx = 0;
    for (let i = 0; i <= nRadial; i++) {
        const row = [];
        const r = radii[i];
        for (let j = 0; j <= nAngular; j++) {
            const theta = thetas[j];
            positions.push(x, r * Math.cos(theta), r * Math.sin(theta));
            normals.push(-1, 0, 0);
            row.push(vIdx++);
        }
        vertexMap.push(row);
    }

    // Pre-compute orifice data for faster checks
    const orX = orifices.map(o => o.y);
    const orZ = orifices.map(o => o.z);
    const orR2 = orifices.map(o => o.radius * o.radius);
    const nOr = orifices.length;

    // Build quads, skip cells whose center is inside an orifice
    for (let i = 0; i < nRadial; i++) {
        const r0 = radii[i];
        const r1 = radii[i + 1];
        const rMid = (r0 + r1) / 2;

        for (let j = 0; j < nAngular; j++) {
            const tMid = (thetas[j] + thetas[j + 1]) / 2;
            const cy = rMid * Math.cos(tMid);
            const cz = rMid * Math.sin(tMid);

            // Check if cell center is inside any orifice
            let inside = false;
            for (let k = 0; k < nOr; k++) {
                const dy = cy - orX[k];
                const dz = cz - orZ[k];
                if (dy * dy + dz * dz < orR2[k]) {
                    inside = true;
                    break;
                }
            }
            if (inside) continue;

            const a = vertexMap[i][j];
            const b = vertexMap[i][j + 1];
            const c = vertexMap[i + 1][j];
            const d = vertexMap[i + 1][j + 1];

            if (i === 0) {
                // Center fan triangle (CCW from -X view)
                indices.push(a, d, c);
            } else {
                indices.push(a, b, c);
                indices.push(b, d, c);
            }
        }
    }

    const faceGeo = new THREE.BufferGeometry();
    faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    faceGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    faceGeo.setIndex(indices);

    const faceMat = new THREE.MeshStandardMaterial({
        color: 0x667788,
        metalness: 0.5,
        roughness: 0.4,
        side: THREE.DoubleSide,
    });
    group.add(new THREE.Mesh(faceGeo, faceMat));
    console.log(`[EngineMesh] Injector face: ${nRadial}×${nAngular} grid, ${orifices.length} orifices, faceR=${faceRadius.toFixed(4)}, minOrifR=${minOrificeRadius.toFixed(5)}`);

    // Colored orifice markers — placed in front of face, bright & emissive
    const fuelColor = new THREE.Color(0x2299ff);
    const oxColor = new THREE.Color(0xff6622);
    const circleSegments = 24;
    // Minimum display radius: 3% of face to be visible at any zoom
    const minDisplayRadius = faceRadius * 0.03;

    for (const o of orifices) {
        const displayR = Math.max(o.radius * 2.0, minDisplayRadius);
        const isFuel = o.type === 'fuel';

        // Bright emissive filled circle in front of face
        const circGeo = new THREE.CircleGeometry(displayR, circleSegments);
        const circMat = new THREE.MeshBasicMaterial({
            color: isFuel ? fuelColor : oxColor,
            side: THREE.DoubleSide,
        });
        const circMesh = new THREE.Mesh(circGeo, circMat);
        // Place well in front of the face (negative X = towards chamber viewer)
        circMesh.position.set(x - 0.001, o.y, o.z);
        circMesh.rotation.y = Math.PI / 2;
        group.add(circMesh);
    }

    return group;
}


/**
 * Create a LatheGeometry from a 2D profile [[x, r], ...].
 */
function createLatheGeometry(profile2d, segments) {
    const nAxial = profile2d.length;
    const nCirc = segments;

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i < nAxial; i++) {
        const x = profile2d[i][0];
        const r = profile2d[i][1];
        const u = i / (nAxial - 1);

        // Compute axial normal direction for smooth shading
        let dx = 0, dr = 0;
        if (i < nAxial - 1) {
            dx = profile2d[i + 1][0] - x;
            dr = profile2d[i + 1][1] - r;
        } else {
            dx = x - profile2d[i - 1][0];
            dr = r - profile2d[i - 1][1];
        }
        const len = Math.sqrt(dx * dx + dr * dr) || 1;
        // Normal is perpendicular to the tangent in the (x, r) plane
        const nx = -dr / len;
        const nr = dx / len;

        for (let j = 0; j <= nCirc; j++) {
            const theta = (j / nCirc) * Math.PI * 2;
            const cosT = Math.cos(theta);
            const sinT = Math.sin(theta);

            positions.push(x, r * cosT, r * sinT);
            normals.push(nx, nr * cosT, nr * sinT);
            uvs.push(u, j / nCirc);
        }
    }

    for (let i = 0; i < nAxial - 1; i++) {
        for (let j = 0; j < nCirc; j++) {
            const a = i * (nCirc + 1) + j;
            const b = a + 1;
            const c = (i + 1) * (nCirc + 1) + j;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    return geo;
}

/**
 * Create subtle cooling channel indicators on the outer wall.
 * Shows: thin channel lines running axially + inlet/outlet manifold rings.
 */
function createCoolingChannelIndicators(outerProfile2d, meshData) {
    const group = new THREE.Group();
    const nChannels = 60; // default channel count
    const n = outerProfile2d.length;
    if (n < 2) return group;

    // Coolant inlet ring (nozzle exit — blue)
    const exitX = outerProfile2d[n - 1][0];
    const exitR = outerProfile2d[n - 1][1];
    group.add(createManifoldRing(exitX, exitR, 0x2299ff, 'COOLANT IN'));

    // Coolant outlet ring (chamber end — orange-red, heated coolant)
    const chamberX = outerProfile2d[0][0];
    const chamberR = outerProfile2d[0][1];
    group.add(createManifoldRing(chamberX, chamberR, 0xff6633, 'COOLANT OUT'));

    // Axial channel lines along the outer wall (every Nth channel for subtlety)
    const showEvery = Math.max(1, Math.floor(nChannels / 20)); // ~20 visible lines
    const channelLineMat = new THREE.LineBasicMaterial({
        color: 0x44aaff,
        transparent: true,
        opacity: 0.25,
    });

    for (let ch = 0; ch < nChannels; ch += showEvery) {
        const theta = (ch / nChannels) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        const points = [];
        // Sample every few stations for smooth lines
        const step = Math.max(1, Math.floor(n / 60));
        for (let i = 0; i < n; i += step) {
            const x = outerProfile2d[i][0];
            const r = outerProfile2d[i][1] * 1.001; // slightly outside surface
            points.push(new THREE.Vector3(x, r * cosT, r * sinT));
        }
        // Always include last point
        const lastX = outerProfile2d[n - 1][0];
        const lastR = outerProfile2d[n - 1][1] * 1.001;
        points.push(new THREE.Vector3(lastX, lastR * cosT, lastR * sinT));

        const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
        group.add(new THREE.Line(lineGeo, channelLineMat));
    }

    return group;
}

/**
 * Create a manifold ring at a given axial station with a label color.
 */
function createManifoldRing(x, r, color, _label) {
    const ringGroup = new THREE.Group();

    // Bright ring slightly outside the wall
    const rOuter = r * 1.015;
    const rInner = r * 1.005;
    const ringGeo = new THREE.RingGeometry(rInner, rOuter, 64);
    const ringMat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.y = Math.PI / 2;
    ringMesh.position.x = x;
    ringGroup.add(ringMesh);

    // Thin outline circle
    const pts = [];
    for (let i = 0; i <= 128; i++) {
        const t = (i / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3(x, rOuter * Math.cos(t), rOuter * Math.sin(t)));
    }
    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    ringGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));

    return ringGroup;
}

/**
 * Update the engine material color (when material selection changes).
 */
export function updateMeshColor(colorHex) {
    if (outerMesh) {
        outerMesh.material.color.set(colorHex);
    }
    if (innerMesh) {
        innerMesh.material.color.set(new THREE.Color(colorHex).multiplyScalar(0.4));
    }
}

/**
 * Get the outer mesh for applying overlays.
 */
export function getOuterMesh() { return outerMesh; }
export function getInnerMesh() { return innerMesh; }
export function getStationCount() { return stationCount; }
export function getCircumSegments() { return circumSegments; }
export function getMeshGroup() { return currentGroup; }
