/**
 * Cooling channel 3D visualization:
 * - GPU shader-based channel/rib rendering on outer surface with animated coolant flow
 * - Cutaway section showing internal channel structure (hot wall, channel, closeout)
 * - Cross-section ring at a selectable axial station
 */
import * as THREE from 'three';
import { getOuterMesh, getInnerMesh, getStationCount, getCircumSegments, getMeshGroup } from './engine_mesh.js';
import { getScene, getRenderer } from './scene.js';
import { mapRange, clamp } from './utils.js';

let cutawayGroup = null;
let crossSectionGroup = null;
let channelShaderActive = false;
let clippingPlane = null;
let clippedMaterials = [];

// Channel shader state
let channelMaterial = null;
let coolantTexture = null;
let savedOuterMaterial = null;

// ── GLSL — Channel vertex shader ────────────────────────────────

const CHANNEL_VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>

varying vec2 vUv;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalMatrix * normal;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <clipping_planes_vertex>
}
`;

// ── GLSL — Channel fragment shader ──────────────────────────────

const CHANNEL_FRAG = /* glsl */ `
#include <clipping_planes_pars_fragment>

uniform float uNChannels;
uniform float uChannelFraction;
uniform float uTime;
uniform sampler2D uCoolantTempTex;
uniform vec3 uRibColor;
uniform float uHasCoolantData;

varying vec2 vUv;
varying vec3 vNormal;

// Blue -> cyan -> yellow -> red coolant temperature ramp
vec3 coolantRamp(float t) {
    t = clamp(t, 0.0, 1.0);
    if (t < 0.33) {
        float s = t / 0.33;
        return vec3(0.0, mix(0.3, 0.9, s), 1.0);
    }
    if (t < 0.66) {
        float s = (t - 0.33) / 0.33;
        return vec3(s, 0.9, 1.0 - s);
    }
    float s = (t - 0.66) / 0.34;
    return vec3(1.0, mix(0.9, 0.15, s), 0.0);
}

void main() {
    #include <clipping_planes_fragment>

    // ── Channel / rib detection via circumferential UV ──
    float phase = fract(vUv.y * uNChannels);
    float chHalf = uChannelFraction * 0.5;
    bool inChannel = phase < chHalf || phase > (1.0 - chHalf);

    vec3 color;

    if (inChannel) {
        // ── Coolant temperature color ──
        float tNorm = texture2D(uCoolantTempTex, vec2(vUv.x, 0.5)).r;
        color = uHasCoolantData > 0.5 ? coolantRamp(tNorm) : vec3(0.0, 0.4, 1.0);

        // ── Animated flow pulses (counter-flow: exit -> chamber) ──
        float flowPhase = fract(vUv.x * 25.0 + uTime * 1.2);
        float pulse = smoothstep(0.0, 0.08, flowPhase) * smoothstep(0.3, 0.18, flowPhase);
        color = mix(color, color + vec3(0.15, 0.3, 0.5), pulse * 0.45);

        // ── Groove depth illusion (darken channel edges) ──
        float edgeDist;
        if (phase < chHalf) {
            edgeDist = phase / chHalf;
        } else {
            edgeDist = (1.0 - phase) / chHalf;
        }
        float groove = smoothstep(0.0, 0.22, clamp(edgeDist, 0.0, 1.0));
        color *= mix(0.2, 1.0, groove);

    } else {
        // ── Rib: dark metallic with subtle center highlight ──
        color = uRibColor;
        float ribPhase = (phase - chHalf) / max(1.0 - uChannelFraction, 0.001);
        float ribHighlight = 1.0 + 0.08 * (0.5 - abs(ribPhase - 0.5));
        color *= ribHighlight;
    }

    // ── Simple directional + ambient lighting ──
    vec3 N = normalize(vNormal);
    vec3 lightDir = normalize(vec3(0.5, 1.0, 1.0));
    float diff = max(dot(N, lightDir), 0.0) * 0.55 + 0.45;
    color *= diff;

    gl_FragColor = vec4(color, 1.0);
}
`;

// ── Coolant temperature DataTexture ─────────────────────────────

const TEX_WIDTH = 256;

function createCoolantTempTexture(temps) {
    const data = new Uint8Array(TEX_WIDTH * 4);

    if (temps && temps.length > 0) {
        const tMin = Math.min(...temps);
        const tMax = Math.max(...temps);
        const range = Math.max(tMax - tMin, 1);

        for (let i = 0; i < TEX_WIDTH; i++) {
            const frac = i / (TEX_WIDTH - 1);
            const sf = frac * (temps.length - 1);
            const s0 = Math.floor(sf);
            const s1 = Math.min(s0 + 1, temps.length - 1);
            const alpha = sf - s0;
            const temp = temps[s0] * (1 - alpha) + temps[s1] * alpha;

            const norm = clamp((temp - tMin) / range, 0, 1);
            data[i * 4]     = Math.round(norm * 255);
            data[i * 4 + 1] = 0;
            data[i * 4 + 2] = 0;
            data[i * 4 + 3] = 255;
        }
    } else {
        for (let i = 0; i < TEX_WIDTH; i++) {
            data[i * 4]     = 128;
            data[i * 4 + 1] = 0;
            data[i * 4 + 2] = 0;
            data[i * 4 + 3] = 255;
        }
    }

    const tex = new THREE.DataTexture(data, TEX_WIDTH, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Show the full cooling-channel overlay.
 * @param {object} meshData   – mesh_update payload (station_x, station_r_inner, …)
 * @param {object} cooling    – {enabled, n_channels, channel_width, channel_height, rib_width}
 * @param {object|null} coolantData – sim_tick.cooling (T_coolant_K, …)
 * @param {boolean} cutaway   – enable half-section cutaway
 */
export function showCoolingViz(meshData, cooling, coolantData, cutaway = true) {
    // Clear cutaway/cross-section geometry (rebuilt each call) but keep channel shader alive
    clearCutawayAndCrossSection();

    if (!cooling || !cooling.enabled) {
        clearCoolingViz();
        return;
    }
    const scene = getScene();
    if (!scene) return;

    applyChannelShader(meshData, cooling, coolantData);

    if (cutaway) {
        enableCutaway(meshData, cooling, coolantData);
    }
}

/**
 * Show a transverse cross-section ring at the given station index.
 */
export function showCrossSection(meshData, cooling, stationIndex, coolantData) {
    removeCrossSection();
    if (!cooling || !cooling.enabled || !meshData?.station_x) return;
    const scene = getScene();
    if (!scene) return;

    const idx = clamp(stationIndex, 0, meshData.station_x.length - 1);
    crossSectionGroup = buildCrossSectionRing(
        meshData.station_x[idx],
        meshData.station_r_inner[idx],
        meshData.station_r_outer[idx],
        cooling,
        coolantData?.T_coolant_K?.[idx],
    );
    scene.add(crossSectionGroup);
}

/**
 * Remove all cooling-channel visuals, restoring original outer mesh material.
 */
export function clearCoolingViz() {
    clearCutawayAndCrossSection();

    if (channelShaderActive) {
        const mesh = getOuterMesh();
        // Only restore if the current mesh is still using our shader
        if (mesh && savedOuterMaterial && mesh.material === channelMaterial) {
            mesh.material = savedOuterMaterial;
        }
        if (channelMaterial) { channelMaterial.dispose(); channelMaterial = null; }
        if (coolantTexture) { coolantTexture.dispose(); coolantTexture = null; }
        savedOuterMaterial = null;
        channelShaderActive = false;
    }
}

/**
 * Update the flow animation time uniform. Call from the render loop.
 */
export function updateChannelAnimation(timeSec) {
    if (channelMaterial) {
        channelMaterial.uniforms.uTime.value = timeSec;
    }
}

// ── Channel shader on outer surface ─────────────────────────────

function applyChannelShader(meshData, cooling, coolantData) {
    const mesh = getOuterMesh();
    if (!mesh) return;

    const nCh   = cooling.n_channels    || 60;
    const chW   = cooling.channel_width  || 0.002;
    const ribW  = cooling.rib_width      || 0.001;
    const chFrac = chW / (chW + ribW);
    const temps = coolantData?.T_coolant_K || null;

    // Create / update coolant temperature texture
    if (coolantTexture) coolantTexture.dispose();
    coolantTexture = createCoolantTempTexture(temps);

    if (!channelMaterial || mesh.material !== channelMaterial) {
        // First call, or mesh was rebuilt — create new ShaderMaterial
        if (channelMaterial) channelMaterial.dispose();
        savedOuterMaterial = mesh.material;

        channelMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uNChannels:       { value: nCh },
                uChannelFraction: { value: chFrac },
                uTime:            { value: 0.0 },
                uCoolantTempTex:  { value: coolantTexture },
                uRibColor:        { value: new THREE.Vector3(0.32, 0.32, 0.36) },
                uHasCoolantData:  { value: temps ? 1.0 : 0.0 },
            },
            vertexShader: CHANNEL_VERT,
            fragmentShader: CHANNEL_FRAG,
            side: THREE.DoubleSide,
            clipping: true,
        });

        mesh.material = channelMaterial;
    } else {
        // Update existing uniforms
        channelMaterial.uniforms.uNChannels.value       = nCh;
        channelMaterial.uniforms.uChannelFraction.value  = chFrac;
        channelMaterial.uniforms.uCoolantTempTex.value   = coolantTexture;
        channelMaterial.uniforms.uHasCoolantData.value   = temps ? 1.0 : 0.0;
    }

    channelShaderActive = true;
}

// ── Internal helpers: cutaway + cross-section cleanup ───────────

function clearCutawayAndCrossSection() {
    disposeGroup(cutawayGroup);
    cutawayGroup = null;

    for (const mat of clippedMaterials) {
        mat.clippingPlanes = [];
        mat.needsUpdate = true;
    }
    clippedMaterials = [];
    clippingPlane = null;
    const renderer = getRenderer();
    if (renderer) renderer.localClippingEnabled = false;

    removeCrossSection();
}

// ── Cutaway section ─────────────────────────────────────────────

function enableCutaway(meshData, cooling, coolantData) {
    const renderer = getRenderer();
    const scene    = getScene();
    if (!renderer || !scene) return;

    renderer.localClippingEnabled = true;
    clippingPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);   // clip z > 0

    const group = getMeshGroup();
    if (group) {
        group.traverse(child => {
            if (child.material) {
                child.material.clippingPlanes = [clippingPlane];
                child.material.clipShadows    = true;
                child.material.needsUpdate    = true;
                clippedMaterials.push(child.material);
            }
        });
    }

    cutawayGroup = buildSectionFace(meshData, cooling, coolantData);
    scene.add(cutawayGroup);
}

/**
 * Build the longitudinal section face (flat in the XY plane at z = 0).
 * Shows: hot wall | channel strip (temp-colored) | closeout.
 */
function buildSectionFace(meshData, cooling, coolantData) {
    const g = new THREE.Group();

    const xs  = meshData.station_x;
    const ri  = meshData.station_r_inner;
    const ro  = meshData.station_r_outer;
    const n   = xs.length;
    if (n < 2) return g;

    const chH      = cooling.channel_height || 0.003;
    const closeout = 0.0005;

    // Pre-compute channel radial boundaries at each station
    const chTop = [], chBot = [];
    for (let i = 0; i < n; i++) {
        const top = ro[i] - closeout;
        const bot = Math.max(top - chH, ri[i] + 0.0003);
        chTop.push(top);
        chBot.push(bot);
    }

    // Materials
    const wallMat    = new THREE.MeshBasicMaterial({ color: 0x6a6a78, side: THREE.DoubleSide });
    const closeMat   = new THREE.MeshBasicMaterial({ color: 0x505060, side: THREE.DoubleSide });
    const lineMat    = new THREE.LineBasicMaterial({ color: 0x99aabb });
    const chLineMat  = new THREE.LineBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.7 });

    // Helper — build both upper and lower halves in one pass
    for (const sign of [1, -1]) {

        // Hot wall
        g.add(new THREE.Mesh(
            makeStrip(xs, i => sign * ri[i], i => sign * chBot[i], n),
            wallMat.clone(),
        ));

        // Closeout
        g.add(new THREE.Mesh(
            makeStrip(xs, i => sign * chTop[i], i => sign * ro[i], n),
            closeMat.clone(),
        ));

        // Channel strip — vertex-colored by coolant temperature
        const chGeo = makeStrip(xs, i => sign * chBot[i], i => sign * chTop[i], n);
        applyStripTempColors(chGeo, xs, coolantData);
        const chMat = coolantData?.T_coolant_K
            ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
            : new THREE.MeshBasicMaterial({ color: 0x0077cc, side: THREE.DoubleSide });
        g.add(new THREE.Mesh(chGeo, chMat));

        // Outline
        g.add(makeLine(xs.map((x, i) => [x, sign * ri[i]]), lineMat.clone()));
        g.add(makeLine(xs.map((x, i) => [x, sign * ro[i]]), lineMat.clone()));

        // Channel boundary lines
        g.add(makeLine(xs.map((x, i) => [x, sign * chTop[i]]), chLineMat.clone()));
        g.add(makeLine(xs.map((x, i) => [x, sign * chBot[i]]), chLineMat.clone()));
    }

    // Coolant flow arrows along the channel strip (counter-flow direction: exit → chamber)
    for (const sign of [1, -1]) {
        const arrowPts = [];
        const step = Math.max(1, Math.floor(n / 12));
        for (let i = n - 1; i >= 0; i -= step) {
            const yMid = sign * (chBot[i] + chTop[i]) / 2;
            arrowPts.push(new THREE.Vector3(xs[i], yMid, 0));
        }
        if (arrowPts.length >= 2) {
            const arrowGeo = new THREE.BufferGeometry().setFromPoints(arrowPts);
            const arrowMat = new THREE.LineBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.5 });
            g.add(new THREE.Line(arrowGeo, arrowMat));

            const last = arrowPts[arrowPts.length - 1];
            const prev = arrowPts[arrowPts.length - 2];
            const dir  = new THREE.Vector3().subVectors(last, prev).normalize();
            g.add(new THREE.ArrowHelper(dir, prev, 0.004, 0x00ddff, 0.003, 0.002));
        }
    }

    return g;
}

// ── Cross-section ring ──────────────────────────────────────────

function buildCrossSectionRing(x, rInner, rOuter, cooling, coolantTempAtStation) {
    const g = new THREE.Group();

    const nCh   = cooling.n_channels    || 60;
    const chH   = cooling.channel_height || 0.003;
    const chW   = cooling.channel_width  || 0.002;
    const ribW  = cooling.rib_width      || 0.001;
    const close = 0.0005;

    // Full wall ring (background)
    const wallGeo = new THREE.RingGeometry(rInner, rOuter, 128, 1);
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x555566, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.rotation.y = Math.PI / 2;
    wallMesh.position.x = x;
    g.add(wallMesh);

    // Channel arcs
    const rChOuter = rOuter - close;
    const rChInner = Math.max(rChOuter - chH, rInner + 0.0003);
    const rMean    = (rChInner + rChOuter) / 2;
    const chAngle  = chW / rMean;

    const chColor = coolantTempToHex(coolantTempAtStation);

    for (let ch = 0; ch < nCh; ch++) {
        const center = (2 * Math.PI * ch) / nCh;
        const start  = center - chAngle / 2;
        const chGeo  = new THREE.RingGeometry(rChInner, rChOuter, 6, 1, start, chAngle);
        const chMat  = new THREE.MeshBasicMaterial({ color: chColor, side: THREE.DoubleSide });
        const chMesh = new THREE.Mesh(chGeo, chMat);
        chMesh.rotation.y = Math.PI / 2;
        chMesh.position.x = x;
        g.add(chMesh);
    }

    // Inner hot-gas-side ring (red)
    const hotGeo  = new THREE.RingGeometry(rInner - 0.0002, rInner, 128, 1);
    const hotMat  = new THREE.MeshBasicMaterial({ color: 0xff4400, side: THREE.DoubleSide });
    const hotMesh = new THREE.Mesh(hotGeo, hotMat);
    hotMesh.rotation.y = Math.PI / 2;
    hotMesh.position.x = x;
    g.add(hotMesh);

    // Outline circles
    g.add(circleLineYZ(rOuter, x, 0xaabbdd));
    g.add(circleLineYZ(rInner, x, 0xff6644));
    g.add(circleLineYZ(rChOuter, x, 0x44aaff));
    g.add(circleLineYZ(rChInner, x, 0x44aaff));

    return g;
}

// ── Helpers ─────────────────────────────────────────────────────

function makeStrip(xs, rLoFn, rHiFn, n) {
    const shape = new THREE.Shape();
    shape.moveTo(xs[0], rLoFn(0));
    for (let i = 1; i < n; i++) shape.lineTo(xs[i], rLoFn(i));
    for (let i = n - 1; i >= 0; i--) shape.lineTo(xs[i], rHiFn(i));
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
}

function applyStripTempColors(geo, xs, coolantData) {
    const temps = coolantData?.T_coolant_K;
    if (!temps) return;

    const tMin = Math.min(...temps);
    const tMax = Math.max(...temps);
    const pos  = geo.getAttribute('position');
    const cols = new Float32Array(pos.count * 3);

    for (let vi = 0; vi < pos.count; vi++) {
        const vx = pos.getX(vi);
        let best = 0, bestD = Infinity;
        for (let si = 0; si < xs.length; si++) {
            const d = Math.abs(xs[si] - vx);
            if (d < bestD) { bestD = d; best = si; }
        }
        const [r, g, b] = coolantColor(temps[best], tMin, tMax);
        cols[vi * 3] = r; cols[vi * 3 + 1] = g; cols[vi * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
}

function makeLine(pts, mat) {
    const vecs = pts.map(([x, y]) => new THREE.Vector3(x, y, 0));
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(vecs), mat);
}

function circleLineYZ(r, xPos, color) {
    const pts = [];
    for (let i = 0; i <= 128; i++) {
        const t = (i / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3(xPos, r * Math.cos(t), r * Math.sin(t)));
    }
    return new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color }),
    );
}

/** Blue->cyan->yellow->red temperature ramp.  Returns [r, g, b] in [0,1]. */
function coolantColor(temp, tMin, tMax) {
    const t = clamp((temp - tMin) / Math.max(tMax - tMin, 1), 0, 1);
    if (t < 0.33) {
        const s = t / 0.33;
        return [0, mapRange(s, 0, 1, 0.3, 0.9), 1];
    }
    if (t < 0.66) {
        const s = (t - 0.33) / 0.33;
        return [s, 0.9, 1 - s];
    }
    const s = (t - 0.66) / 0.34;
    return [1, mapRange(s, 0, 1, 0.9, 0.15), 0];
}

function coolantTempToHex(temp) {
    if (temp === undefined || temp === null) return 0x0088ff;
    const t = clamp((temp - 300) / 300, 0, 1);
    const r = Math.floor(t * 255);
    const g = Math.floor(128 * (1 - t * 0.5));
    const b = Math.floor((1 - t) * 255);
    return (r << 16) | (g << 8) | b;
}

function disposeGroup(group) {
    if (!group) return;
    if (group.parent) group.parent.remove(group);
    group.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
    });
}

function removeCrossSection() {
    disposeGroup(crossSectionGroup);
    crossSectionGroup = null;
}
