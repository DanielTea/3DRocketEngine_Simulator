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

    // Injector face — solid disc at chamber inlet
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
