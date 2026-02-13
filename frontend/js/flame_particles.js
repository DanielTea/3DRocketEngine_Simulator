/**
 * Physics-based rocket exhaust plume particle system.
 *
 * Models supersonic exhaust with real gas dynamics:
 *  - Plume divergence from Mach angle: alpha = asin(1/M_exit)
 *  - Plume length scaling with pressure ratio Pe/Pa
 *  - Shock diamond spacing from Prandtl-Meyer theory:
 *      L_cell = 1.22 * D_exit * sqrt(M_exit^2 - 1)
 *  - Temperature-based coloring with isentropic downstream cooling
 *  - Underexpanded (Pe/Pa > 1) vs overexpanded (Pe/Pa < 1) regimes
 */
import * as THREE from 'three';

let particleSystem = null;
let particleMaterial = null;
const PARTICLE_COUNT = 4000;

// Cached geometry state
let _exitX = 0;
let _exitR = 0.02;
let _plumeLength = 0.3;

// Physics state with sensible defaults (underexpanded, Mach 3)
let _exhaustPhysics = {
    exit_mach: 3.0,
    exit_pressure_Pa: 150000,
    ambient_pressure_Pa: 101325,
    exit_temperature_K: 1800,
    gamma: 1.2,
};

// Derived quantities (recomputed when physics change)
let _pressureRatio = 1.48;
let _shockSpacing = 0.05;
let _plumeHalfAngle = 0.3398; // radians (~19.5 deg for M=3)

/**
 * Recompute derived plume parameters from current physics state.
 */
function _recomputeDerived() {
    const M = Math.max(_exhaustPhysics.exit_mach, 1.01); // guard against M<=1
    const Pe = _exhaustPhysics.exit_pressure_Pa;
    const Pa = _exhaustPhysics.ambient_pressure_Pa;

    _pressureRatio = Pe / Math.max(Pa, 1.0);

    // Mach angle: alpha = asin(1/M)
    _plumeHalfAngle = Math.asin(1.0 / M);

    // For underexpanded jets the plume fans out wider than the Mach angle.
    // Scale the effective half-angle with pressure ratio so higher Pe/Pa = wider plume.
    if (_pressureRatio > 1.0) {
        // Widen by up to ~2x for very underexpanded jets
        const expansion = 1.0 + 0.4 * Math.log(_pressureRatio);
        _plumeHalfAngle *= Math.min(expansion, 2.5);
    } else {
        // Overexpanded: plume narrows, shocks compress it inward
        _plumeHalfAngle *= Math.max(0.5 * _pressureRatio, 0.15);
    }

    // Shock diamond cell spacing (Prandtl-Meyer):
    // L_cell = 1.22 * D_exit * sqrt(M^2 - 1)
    const D_exit = 2.0 * _exitR;
    _shockSpacing = 1.22 * D_exit * Math.sqrt(M * M - 1.0);

    // Plume length scales with pressure ratio and exit radius
    // Longer plume when underexpanded; shorter when overexpanded
    const basePlumeLength = Math.max(_exitR * 14, 0.15);
    if (_pressureRatio > 1.0) {
        _plumeLength = basePlumeLength * (1.0 + 0.6 * Math.log(_pressureRatio));
    } else {
        _plumeLength = basePlumeLength * Math.max(0.4, _pressureRatio);
    }
}

/* ------------------------------------------------------------------ */
/*  GLSL shaders                                                      */
/* ------------------------------------------------------------------ */

const vertexShader = /* glsl */ `
    attribute float aLifetime;
    attribute float aSeed;
    attribute float aRadius;

    uniform float uPlumeLength;
    uniform float uExitRadius;
    uniform float uIntensity;
    uniform float uExitMach;
    uniform float uPressureRatio;
    uniform float uExitTemp;
    uniform float uGamma;
    uniform float uShockSpacing;
    uniform float uPlumeHalfAngle;

    varying float vLifetime;
    varying float vRadius;
    varying float vSeed;
    varying float vAxialDist;

    void main() {
        vLifetime = aLifetime;
        vRadius   = aRadius;
        vSeed     = aSeed;

        // Axial distance along the plume (0 = nozzle exit, plumeLength = tip)
        float axialDist = aLifetime * uPlumeLength;
        vAxialDist = axialDist;

        // Cone radius from actual Mach-angle-based half-angle
        // coneR = exitR + axialDist * tan(halfAngle)
        float coneR = uExitRadius + axialDist * tan(uPlumeHalfAngle);

        // Radial position within the cone
        float r = aRadius * coneR;

        // Slight turbulent wobble – amplitude grows downstream
        float wobbleAmp = 0.002 * (1.0 + 2.0 * aLifetime);
        float wobble = sin(aLifetime * 14.0 + aSeed * 6.28318) * wobbleAmp;
        float angle = aSeed * 6.28318;

        vec3 pos = position;
        pos.x += axialDist;
        pos.y  = r * cos(angle) + wobble;
        pos.z  = r * sin(angle) + wobble;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

        // Particle size: larger downstream as gas expands
        // Core particles (low aRadius) are smaller, brighter
        float expansionFactor = 1.0 + axialDist / max(uPlumeLength, 0.001) * 1.2;
        float baseSize = mix(0.4, 1.3, aLifetime) * expansionFactor * uIntensity;
        baseSize *= mix(0.4, 1.0, aRadius);

        // Underexpanded jets have brighter, larger particles near exit
        if (uPressureRatio > 1.0) {
            float boostZone = 1.0 - smoothstep(0.0, 0.3, aLifetime);
            baseSize *= 1.0 + 0.15 * boostZone * log(uPressureRatio);
        }

        gl_PointSize = baseSize * (60.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 1.0, 110.0);

        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = /* glsl */ `
    #define PI 3.14159265359

    uniform float uPlumeLength;
    uniform float uExitRadius;
    uniform float uIntensity;
    uniform float uExitMach;
    uniform float uPressureRatio;
    uniform float uExitTemp;
    uniform float uGamma;
    uniform float uShockSpacing;
    uniform float uPlumeHalfAngle;

    varying float vLifetime;
    varying float vRadius;
    varying float vSeed;
    varying float vAxialDist;

    void main() {
        // ---- soft circle ----
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        float circle = smoothstep(0.5, 0.08, dist);

        // ---- shock diamond brightness modulation ----
        // Periodic cosine pattern at the Prandtl-Meyer cell spacing
        // with amplitude that decays downstream (diamonds fade out)
        float shockFalloff = exp(-1.8 * vAxialDist / max(uPlumeLength, 0.001));
        float shockModulation = 1.0;
        if (uShockSpacing > 0.0001) {
            // Core particles see strong diamonds; outer particles see less
            float coreWeight = 1.0 - smoothstep(0.0, 0.5, vRadius);
            float diamondStrength = 0.3 * shockFalloff * coreWeight;

            // For overexpanded jets, diamonds are sharper and more visible
            if (uPressureRatio < 1.0) {
                diamondStrength *= 1.5;
            }

            shockModulation = 1.0 + diamondStrength * cos(2.0 * PI * vAxialDist / uShockSpacing);
        }

        // ---- temperature-based coloring ----
        // Local temperature drops downstream via isentropic expansion:
        //   T_local / T_exit ~ 1 / (1 + ((gamma-1)/2) * M_local^2 )
        // We approximate M_local increasing downstream
        float axialFrac = clamp(vLifetime, 0.0, 1.0);
        float gm1 = uGamma - 1.0;

        // Approximate local Mach number increasing downstream from M_exit
        float M_local = uExitMach * (1.0 + 0.3 * axialFrac);
        float tempRatio = 1.0 / (1.0 + 0.5 * gm1 * M_local * M_local);
        // Normalize so at exit (axialFrac=0) we get ~1
        float tempRatioExit = 1.0 / (1.0 + 0.5 * gm1 * uExitMach * uExitMach);
        float T_normalized = tempRatio / max(tempRatioExit, 0.001); // <=1, drops downstream

        // Radial temperature: core hotter than edge
        float radialCool = 1.0 - 0.5 * vRadius * vRadius;
        float T_local = T_normalized * radialCool;

        // Map exit temperature to an overall warmth bias [0,1]
        // 1000K -> cooler tones; 3500K+ -> white-blue core
        float tempWarmth = clamp((uExitTemp - 800.0) / 3000.0, 0.0, 1.0);

        // ---- color palette ----
        // Core/hot: white-blue (high T), shifting to bright white-yellow
        vec3 coreHot   = vec3(0.75, 0.85, 1.0);  // blue-white
        vec3 coreWarm  = vec3(1.0, 0.95, 0.75);   // warm white-yellow
        vec3 coreColor = mix(coreWarm, coreHot, tempWarmth);

        // Mid: yellow-orange
        vec3 midColor  = vec3(1.0, 0.65, 0.15);

        // Cool/outer: dim red-orange
        vec3 coolColor = vec3(0.55, 0.12, 0.02);

        // Transparent (for outer edge / end of plume)
        vec3 fadeColor = vec3(0.25, 0.05, 0.01);

        // Temperature-to-color mapping
        float t = clamp(T_local, 0.0, 1.0);
        vec3 color;
        if (t > 0.75) {
            color = mix(coreWarm, coreColor, (t - 0.75) / 0.25);
        } else if (t > 0.45) {
            color = mix(midColor, coreWarm, (t - 0.45) / 0.30);
        } else if (t > 0.15) {
            color = mix(coolColor, midColor, (t - 0.15) / 0.30);
        } else {
            color = mix(fadeColor, coolColor, t / 0.15);
        }

        // Apply shock diamond modulation to brightness
        color *= shockModulation;

        // ---- alpha / opacity ----
        // Downstream fade
        float downstreamAlpha = 1.0 - smoothstep(0.45, 1.0, axialFrac);

        // Core brighter than edges
        float radialAlpha = mix(1.0, 0.2, vRadius * vRadius);

        // Near-exit boost for underexpanded jets (bright Mach disk region)
        float machDiskBoost = 1.0;
        if (uPressureRatio > 1.0) {
            machDiskBoost = 1.0 + 0.2 * (1.0 - smoothstep(0.0, 0.15, axialFrac)) * log(uPressureRatio);
        }

        float alpha = circle * downstreamAlpha * radialAlpha * machDiskBoost * 0.5;
        alpha = clamp(alpha, 0.0, 1.0);

        gl_FragColor = vec4(color, alpha);
    }
`;

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Create the flame particle system at the nozzle exit.
 */
export function createFlameSystem(scene, exitX = 0.15, exitRadius = 0.02) {
    if (particleSystem) {
        scene.remove(particleSystem);
        if (particleSystem.geometry) particleSystem.geometry.dispose();
        if (particleMaterial) particleMaterial.dispose();
    }

    _exitX = exitX;
    _exitR = exitRadius;
    _recomputeDerived();

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const lifetimes = new Float32Array(PARTICLE_COUNT);
    const seeds     = new Float32Array(PARTICLE_COUNT);
    const radii     = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        seeds[i] = Math.random();
        resetParticle(i, positions, lifetimes, radii);
    }

    geometry.setAttribute('position',  new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aLifetime', new THREE.BufferAttribute(lifetimes, 1));
    geometry.setAttribute('aSeed',     new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aRadius',   new THREE.BufferAttribute(radii, 1));

    particleMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uPlumeLength:     { value: _plumeLength },
            uExitRadius:      { value: _exitR },
            uIntensity:       { value: 1.0 },
            uExitMach:        { value: _exhaustPhysics.exit_mach },
            uPressureRatio:   { value: _pressureRatio },
            uExitTemp:        { value: _exhaustPhysics.exit_temperature_K },
            uGamma:           { value: _exhaustPhysics.gamma },
            uShockSpacing:    { value: _shockSpacing },
            uPlumeHalfAngle:  { value: _plumeHalfAngle },
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

function resetParticle(i, positions, lifetimes, radii) {
    // All particles originate at the nozzle exit
    positions[i * 3]     = _exitX;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;

    // Stagger lifetime so the plume is always populated
    lifetimes[i] = Math.random();

    // Radial distribution: bias toward core (power < 1 = more near center)
    radii[i] = Math.pow(Math.random(), 0.6);
}

/**
 * Set physics data from the simulation backend.
 * Call this whenever nozzle flow conditions change.
 *
 * @param {Object} data
 * @param {number} data.exit_mach           - Nozzle exit Mach number (typically 2-4)
 * @param {number} data.exit_pressure_Pa    - Static pressure at nozzle exit (Pa)
 * @param {number} data.ambient_pressure_Pa - Ambient atmospheric pressure (Pa, default 101325)
 * @param {number} data.exit_temperature_K  - Static temperature at nozzle exit (K)
 * @param {number} data.gamma               - Ratio of specific heats (~1.2 for combustion products)
 */
export function setExhaustPhysics(data) {
    if (data.exit_mach !== undefined)           _exhaustPhysics.exit_mach           = data.exit_mach;
    if (data.exit_pressure_Pa !== undefined)    _exhaustPhysics.exit_pressure_Pa    = data.exit_pressure_Pa;
    if (data.ambient_pressure_Pa !== undefined) _exhaustPhysics.ambient_pressure_Pa = data.ambient_pressure_Pa;
    if (data.exit_temperature_K !== undefined)  _exhaustPhysics.exit_temperature_K  = data.exit_temperature_K;
    if (data.gamma !== undefined)               _exhaustPhysics.gamma               = data.gamma;

    _recomputeDerived();

    // Push updated physics uniforms to the shader
    if (particleMaterial) {
        particleMaterial.uniforms.uExitMach.value       = _exhaustPhysics.exit_mach;
        particleMaterial.uniforms.uPressureRatio.value   = _pressureRatio;
        particleMaterial.uniforms.uExitTemp.value        = _exhaustPhysics.exit_temperature_K;
        particleMaterial.uniforms.uGamma.value           = _exhaustPhysics.gamma;
        particleMaterial.uniforms.uShockSpacing.value     = _shockSpacing;
        particleMaterial.uniforms.uPlumeHalfAngle.value   = _plumeHalfAngle;
        particleMaterial.uniforms.uPlumeLength.value      = _plumeLength;
    }
}

/**
 * Update flame particles each frame.
 */
export function updateFlame(exitX, exitRadius, thrustScale = 1.0) {
    if (!particleSystem) return;

    _exitX = exitX;
    _exitR = exitRadius;

    // Recompute derived quantities (shock spacing depends on exit radius)
    _recomputeDerived();

    // Modulate plume length by thrust scale
    const thrustModulatedLength = _plumeLength * (0.5 + thrustScale * 0.5);

    const geo       = particleSystem.geometry;
    const positions = geo.attributes.position.array;
    const lifetimes = geo.attributes.aLifetime.array;
    const radii     = geo.attributes.aRadius.array;

    // Particle advection speed proportional to thrust
    const speed = 0.006 + thrustScale * 0.008;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        lifetimes[i] += speed + Math.random() * 0.002;
        if (lifetimes[i] > 1.0) {
            resetParticle(i, positions, lifetimes, radii);
        }
    }

    geo.attributes.position.needsUpdate  = true;
    geo.attributes.aLifetime.needsUpdate = true;

    if (particleMaterial) {
        particleMaterial.uniforms.uPlumeLength.value    = thrustModulatedLength;
        particleMaterial.uniforms.uExitRadius.value     = _exitR;
        particleMaterial.uniforms.uIntensity.value      = 0.35 + thrustScale * 0.5;
        particleMaterial.uniforms.uExitMach.value       = _exhaustPhysics.exit_mach;
        particleMaterial.uniforms.uPressureRatio.value  = _pressureRatio;
        particleMaterial.uniforms.uExitTemp.value       = _exhaustPhysics.exit_temperature_K;
        particleMaterial.uniforms.uGamma.value          = _exhaustPhysics.gamma;
        particleMaterial.uniforms.uShockSpacing.value   = _shockSpacing;
        particleMaterial.uniforms.uPlumeHalfAngle.value = _plumeHalfAngle;
    }
}

/**
 * Toggle flame visibility.
 */
export function setFlameVisible(visible) {
    if (particleSystem) particleSystem.visible = visible;
}

/**
 * Remove flame from scene and dispose GPU resources.
 */
export function removeFlame(scene) {
    if (particleSystem) {
        scene.remove(particleSystem);
        particleSystem.geometry.dispose();
        particleMaterial.dispose();
        particleSystem  = null;
        particleMaterial = null;
    }
}
