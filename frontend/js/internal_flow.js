/**
 * GPU particle system for visualizing propellant gas flow inside
 * the rocket engine nozzle (quasi-1D flow field).
 *
 * Particles travel along the engine axis (x-direction) with velocity
 * proportional to the local Mach number, distributed radially within
 * the inner wall radius at each station, and color-coded by local
 * gas temperature.
 *
 * Uses THREE.DataTexture to pass per-station arrays to the GPU so
 * that all position, velocity, and color logic runs in the shaders.
 */
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PARTICLE_COUNT = 2000;
const DATA_TEX_WIDTH = 256; // width of 1-D DataTextures (station samples)

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let particleSystem = null;
let particleMaterial = null;

// DataTextures (RGBA Float, width=256, height=1)
let radiusTex = null;
let velocityTex = null;
let temperatureTex = null;
let stationXTex = null;

// Cached flow extents (used for lifetime advancement on CPU)
let _axialLength = 1.0;   // total length along x
let _maxVelocity = 1.0;   // max velocity for normalisation

// ---------------------------------------------------------------------------
// Helpers — DataTexture creation & update
// ---------------------------------------------------------------------------

/**
 * Create a 1-D RGBA Float DataTexture (width x 1).
 * We store the scalar value in the R channel.
 */
function createDataTexture1D() {
    const data = new Float32Array(DATA_TEX_WIDTH * 4); // RGBA
    const tex = new THREE.DataTexture(
        data,
        DATA_TEX_WIDTH,
        1,
        THREE.RGBAFormat,
        THREE.FloatType
    );
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}

/**
 * Resample an arbitrary-length source array into the DataTexture's
 * R channel (256 evenly-spaced samples via linear interpolation).
 */
function fillDataTexture(tex, srcArray) {
    const data = tex.image.data; // Float32Array, length = 256 * 4
    const srcLen = srcArray.length;
    if (srcLen === 0) return;

    for (let i = 0; i < DATA_TEX_WIDTH; i++) {
        // Map texel index to fractional source index
        const t = i / (DATA_TEX_WIDTH - 1); // 0 … 1
        const srcIdx = t * (srcLen - 1);
        const lo = Math.floor(srcIdx);
        const hi = Math.min(lo + 1, srcLen - 1);
        const frac = srcIdx - lo;
        const val = srcArray[lo] * (1 - frac) + srcArray[hi] * frac;

        const base = i * 4;
        data[base + 0] = val;   // R
        data[base + 1] = 0.0;   // G (unused)
        data[base + 2] = 0.0;   // B (unused)
        data[base + 3] = 1.0;   // A
    }
    tex.needsUpdate = true;
}

/**
 * Same as fillDataTexture but writes a normalised (0-1) mapping of
 * station_x positions so the shader can look up the physical x coordinate
 * from the normalised axial parameter t.
 */
function fillStationXTexture(tex, stationX) {
    const data = tex.image.data;
    const srcLen = stationX.length;
    if (srcLen === 0) return;

    const xMin = stationX[0];
    const xMax = stationX[srcLen - 1];
    const range = xMax - xMin || 1.0;

    for (let i = 0; i < DATA_TEX_WIDTH; i++) {
        const t = i / (DATA_TEX_WIDTH - 1);
        const srcIdx = t * (srcLen - 1);
        const lo = Math.floor(srcIdx);
        const hi = Math.min(lo + 1, srcLen - 1);
        const frac = srcIdx - lo;
        const val = stationX[lo] * (1 - frac) + stationX[hi] * frac;

        const base = i * 4;
        data[base + 0] = val;            // physical x
        data[base + 1] = (val - xMin) / range; // normalised x (0-1)
        data[base + 2] = 0.0;
        data[base + 3] = 1.0;
    }
    tex.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// GLSL Shaders
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `
    // Per-particle attributes
    attribute float aLifetime;   // 0-1: axial position along nozzle (0 = inlet, 1 = exit)
    attribute float aRadialFrac; // 0-1: fraction from centreline to wall
    attribute float aAngle;      // 0-2PI: azimuthal angle

    // Data textures (256 x 1, value in R channel)
    uniform sampler2D uStationX;      // .r = physical x, .g = normalised x
    uniform sampler2D uRadiusTex;     // inner wall radius at each station
    uniform sampler2D uVelocityTex;   // velocity (m/s) at each station
    uniform sampler2D uTemperatureTex;// temperature (K) at each station

    // Scalars
    uniform float uMaxTemperature;    // for normalising temperature to 0-1
    uniform float uMinTemperature;

    // Varyings passed to fragment shader
    varying float vTemperatureNorm;   // 0 (cool) to 1 (hot)
    varying float vRadialFrac;
    varying float vLifetime;

    void main() {
        // Sample textures at the particle's axial position
        vec2 uv = vec2(aLifetime, 0.5);

        float x       = texture2D(uStationX, uv).r;
        float rInner  = texture2D(uRadiusTex, uv).r;
        float tempK   = texture2D(uTemperatureTex, uv).r;

        // Radial position inside nozzle
        float r = aRadialFrac * rInner;
        float y = r * cos(aAngle);
        float z = r * sin(aAngle);

        vec3 pos = vec3(x, y, z);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

        // Point size: slightly larger near chamber (subsonic, dense gas)
        // and slightly smaller near exit (expanded gas)
        float basePx = mix(2.5, 1.2, aLifetime);
        // Particles near centreline are slightly brighter/larger
        basePx *= mix(1.3, 0.7, aRadialFrac);
        gl_PointSize = basePx * (100.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 1.0, 80.0);

        gl_Position = projectionMatrix * mvPosition;

        // Temperature normalised 0-1 (1 = hottest)
        float tRange = uMaxTemperature - uMinTemperature;
        vTemperatureNorm = tRange > 0.0
            ? clamp((tempK - uMinTemperature) / tRange, 0.0, 1.0)
            : 0.5;
        vRadialFrac = aRadialFrac;
        vLifetime = aLifetime;
    }
`;

const fragmentShader = /* glsl */ `
    varying float vTemperatureNorm;
    varying float vRadialFrac;
    varying float vLifetime;

    void main() {
        // Soft circular point
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        float alpha = smoothstep(0.5, 0.15, dist);

        // Temperature-based colour ramp:
        //   hot  (1.0) → white-yellow  (chamber)
        //   mid  (0.5) → bright orange  (throat region)
        //   cool (0.0) → dim orange-red  (expanded exit)
        vec3 hotColor  = vec3(1.0, 0.97, 0.85);  // near-white / pale yellow
        vec3 midColor  = vec3(1.0, 0.75, 0.25);  // golden yellow-orange
        vec3 coolColor = vec3(0.85, 0.30, 0.05);  // deep orange

        vec3 color;
        if (vTemperatureNorm > 0.5) {
            color = mix(midColor, hotColor, (vTemperatureNorm - 0.5) * 2.0);
        } else {
            color = mix(coolColor, midColor, vTemperatureNorm * 2.0);
        }

        // Radial fade: particles near the wall are dimmer
        alpha *= mix(1.0, 0.35, vRadialFrac * vRadialFrac);

        // Slight fade near inlet/exit ends to avoid hard pop-in
        float edgeFade = smoothstep(0.0, 0.04, vLifetime)
                       * smoothstep(1.0, 0.96, vLifetime);
        alpha *= edgeFade;

        // Overall intensity
        alpha *= 0.65;

        gl_FragColor = vec4(color, alpha);
    }
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create the internal-flow particle system and add it to the scene.
 * Call once during initialisation; then feed data via updateInternalFlow().
 */
export function createInternalFlow(scene) {
    // Clean up if called again
    if (particleSystem) {
        removeInternalFlow(scene);
    }

    // -- DataTextures --
    radiusTex      = createDataTexture1D();
    velocityTex    = createDataTexture1D();
    temperatureTex = createDataTexture1D();
    stationXTex    = createDataTexture1D();

    // -- Geometry & per-particle attributes --
    const geometry = new THREE.BufferGeometry();

    const lifetimes   = new Float32Array(PARTICLE_COUNT);
    const radialFracs = new Float32Array(PARTICLE_COUNT);
    const angles      = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        lifetimes[i]   = Math.random();                        // stagger along axis
        radialFracs[i] = Math.sqrt(Math.random());             // sqrt → uniform disk area
        angles[i]      = Math.random() * Math.PI * 2.0;
    }

    // Dummy positions — the vertex shader computes the real positions
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    geometry.setAttribute('position',     new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aLifetime',    new THREE.BufferAttribute(lifetimes, 1));
    geometry.setAttribute('aRadialFrac',  new THREE.BufferAttribute(radialFracs, 1));
    geometry.setAttribute('aAngle',       new THREE.BufferAttribute(angles, 1));

    // -- ShaderMaterial --
    particleMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uStationX:       { value: stationXTex },
            uRadiusTex:      { value: radiusTex },
            uVelocityTex:    { value: velocityTex },
            uTemperatureTex: { value: temperatureTex },
            uMaxTemperature: { value: 3500.0 },
            uMinTemperature: { value: 300.0 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    particleSystem = new THREE.Points(geometry, particleMaterial);
    particleSystem.frustumCulled = false;
    scene.add(particleSystem);

    return particleSystem;
}

/**
 * Feed new simulation data and advance particles.
 *
 * @param {Object} flowData
 * @param {number[]} flowData.station_x        – axial positions (m)
 * @param {number[]} flowData.station_r_inner  – inner wall radius at each station (m)
 * @param {number[]} flowData.mach             – Mach number at each station
 * @param {number[]} flowData.velocity_m_s     – gas velocity at each station (m/s)
 * @param {number[]} flowData.temperature_K    – static temperature at each station (K)
 */
export function updateInternalFlow(flowData) {
    if (!particleSystem || !particleMaterial) return;

    const {
        station_x,
        station_r_inner,
        mach,
        velocity_m_s,
        temperature_K,
    } = flowData;

    if (!station_x || station_x.length < 2) return;

    // -- Update DataTextures --
    fillStationXTexture(stationXTex, station_x);
    fillDataTexture(radiusTex, station_r_inner);
    fillDataTexture(velocityTex, velocity_m_s);
    fillDataTexture(temperatureTex, temperature_K);

    // -- Update uniforms --
    const tMax = Math.max(...temperature_K);
    const tMin = Math.min(...temperature_K);
    particleMaterial.uniforms.uMaxTemperature.value = tMax;
    particleMaterial.uniforms.uMinTemperature.value = tMin;

    // Cache for CPU-side lifetime advancement
    _axialLength = station_x[station_x.length - 1] - station_x[0];
    _maxVelocity = Math.max(...velocity_m_s, 1.0);

    // -- Advance particle lifetimes on CPU --
    // Each particle moves along the axis at a rate proportional to the local
    // velocity (looked up from the mach / velocity arrays).  Faster particles
    // near the throat traverse their lifetime increment quicker.
    const geo = particleSystem.geometry;
    const lifetimes = geo.attributes.aLifetime.array;
    const nStations = velocity_m_s.length;

    // Base timestep: tuned so a particle at max velocity crosses the nozzle
    // in roughly 1.5 seconds of wall-clock time at 60 fps.
    const dt = 0.012;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        // Look up the local velocity at this particle's axial position
        const t = lifetimes[i]; // 0-1
        const srcIdx = t * (nStations - 1);
        const lo = Math.floor(srcIdx);
        const hi = Math.min(lo + 1, nStations - 1);
        const frac = srcIdx - lo;
        const localVel = velocity_m_s[lo] * (1 - frac) + velocity_m_s[hi] * frac;

        // Normalised speed factor (0-1), so particles near the throat move
        // faster through their lifetime than those in the chamber
        const speedFactor = localVel / _maxVelocity;

        lifetimes[i] += dt * (0.3 + 0.7 * speedFactor);

        // Wrap around — particle re-enters from the chamber end
        if (lifetimes[i] >= 1.0) {
            lifetimes[i] -= 1.0;
        }
    }

    geo.attributes.aLifetime.needsUpdate = true;
}

/**
 * Lightweight per-frame lifetime advancement (no texture updates).
 * Call from the render loop for smooth animation between sim ticks.
 */
export function advanceInternalFlowParticles() {
    if (!particleSystem || _maxVelocity <= 0) return;

    const geo = particleSystem.geometry;
    const lifetimes = geo.attributes.aLifetime.array;

    // Use cached velocity data to advance lifetimes
    const dt = 0.012;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        // Simple advancement with cached max velocity
        // (full velocity lookup only in updateInternalFlow)
        lifetimes[i] += dt * 0.6;
        if (lifetimes[i] >= 1.0) {
            lifetimes[i] -= 1.0;
        }
    }

    geo.attributes.aLifetime.needsUpdate = true;
}

/**
 * Show or hide the internal flow visualisation.
 */
export function setInternalFlowVisible(visible) {
    if (particleSystem) {
        particleSystem.visible = visible;
    }
}

/**
 * Remove the particle system from the scene and release GPU resources.
 */
export function removeInternalFlow(scene) {
    if (particleSystem) {
        scene.remove(particleSystem);
        if (particleSystem.geometry) particleSystem.geometry.dispose();
    }
    if (particleMaterial) particleMaterial.dispose();
    if (radiusTex)      radiusTex.dispose();
    if (velocityTex)    velocityTex.dispose();
    if (temperatureTex) temperatureTex.dispose();
    if (stationXTex)    stationXTex.dispose();

    particleSystem  = null;
    particleMaterial = null;
    radiusTex       = null;
    velocityTex     = null;
    temperatureTex  = null;
    stationXTex     = null;
}
