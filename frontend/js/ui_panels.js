/**
 * UI panel initialization: material selector, geometry sliders, propellant inputs, cooling controls.
 */
import { debounce, formatSI, formatFixed } from './utils.js';

// Geometry slider definitions: [key, label, min, max, step, default, unit, displayMultiplier]
const GEOMETRY_SLIDERS = [
    ['chamber_diameter', 'Chamber Diameter', 0.02, 0.30, 0.002, 0.08, 'mm', 1000],
    ['chamber_length', 'Chamber Length', 0.03, 0.50, 0.005, 0.12, 'mm', 1000],
    ['throat_diameter', 'Throat Diameter', 0.008, 0.15, 0.001, 0.03, 'mm', 1000],
    ['expansion_ratio', 'Expansion Ratio', 2, 80, 0.5, 8, '', 1],
    ['convergence_half_angle', 'Conv. Half-Angle', 15, 60, 1, 30, 'deg', 1],
    ['bell_fraction', 'Bell Fraction', 60, 100, 1, 80, '%', 1],
];

// Variable wall thickness: 6 control points
const WALL_THICKNESS_SLIDERS = [
    ['wt_cp0', 'Chamber End', 0.001, 0.015, 0.0005, 0.003, 'mm', 1000],
    ['wt_cp1', '20% Axial', 0.001, 0.015, 0.0005, 0.003, 'mm', 1000],
    ['wt_cp2', '40% (Converge)', 0.001, 0.015, 0.0005, 0.003, 'mm', 1000],
    ['wt_cp3', '60% (Throat)', 0.001, 0.015, 0.0005, 0.003, 'mm', 1000],
    ['wt_cp4', '80% (Expand)', 0.001, 0.015, 0.0005, 0.003, 'mm', 1000],
    ['wt_cp5', 'Nozzle Exit', 0.001, 0.015, 0.0005, 0.003, 'mm', 1000],
];

// Cooling channel controls: [key, label, min, max, step, default, unit]
const COOLING_INPUTS = [
    ['n_channels', 'Number of Channels', 10, 200, 1, 60, ''],
    ['channel_width', 'Channel Width', 0.0005, 0.006, 0.0001, 0.002, 'm'],
    ['channel_height', 'Channel Height (Uniform)', 0.0005, 0.008, 0.0001, 0.003, 'm'],
    ['rib_width', 'Rib Width', 0.0005, 0.004, 0.0001, 0.001, 'm'],
    ['coolant_mdot', 'Coolant Flow Rate', 0.1, 5.0, 0.1, 1.0, 'kg/s'],
];

// Channel height axial control points: [key, label, min, max, step, default, unit, displayMultiplier]
const CHANNEL_HEIGHT_SLIDERS = [
    ['ch_height_cp0', 'Chamber End', 0.0005, 0.008, 0.0001, 0.003, 'mm', 1000],
    ['ch_height_cp1', 'Midpoint', 0.0005, 0.008, 0.0001, 0.003, 'mm', 1000],
    ['ch_height_cp2', 'Nozzle Exit', 0.0005, 0.008, 0.0001, 0.003, 'mm', 1000],
];

// Propellant input definitions: [key, label, min, max, step, default, unit]
const PROPELLANT_INPUTS = [
    ['gamma', 'Gamma (Cp/Cv)', 1.1, 1.7, 0.01, 1.25, ''],
    ['molecular_weight', 'Mol. Weight', 0.002, 0.044, 0.001, 0.022, 'kg/mol'],
    ['chamber_temperature_K', 'Chamber Temp', 500, 5000, 50, 3400, 'K'],
    ['chamber_pressure_Pa', 'Chamber Pressure', 100000, 30000000, 50000, 3000000, 'Pa'],
];

let currentGeometry = {};
let currentCooling = { enabled: true, coolant_type: 'rp1' };
let currentPropellant = {};
let onChangeCallback = null;

/**
 * Initialize geometry parameter sliders.
 */
export function initGeometrySliders(container, onChange) {
    onChangeCallback = onChange;
    container.innerHTML = '';

    // Main geometry sliders
    for (const [key, label, min, max, step, def, unit, mult] of GEOMETRY_SLIDERS) {
        currentGeometry[key] = def;
        container.appendChild(createSlider(key, label, min, max, step, def, unit, mult, 'geometry'));
    }

    // Wall thickness section header
    const wtHeader = document.createElement('div');
    wtHeader.className = 'section-header';
    wtHeader.innerHTML = '<h4>Wall Thickness (Variable)</h4>';
    wtHeader.style.cssText = 'margin-top: 8px; font-size: 11px; color: #a0a0b0; text-transform: uppercase; letter-spacing: 0.5px;';
    container.appendChild(wtHeader);

    for (const [key, label, min, max, step, def, unit, mult] of WALL_THICKNESS_SLIDERS) {
        currentGeometry[key] = def;
        container.appendChild(createSlider(key, label, min, max, step, def, unit, mult, 'geometry'));
    }
}

function createSlider(key, label, min, max, step, def, unit, mult, changeType) {
    const div = document.createElement('div');
    div.className = 'slider-group';
    div.innerHTML = `
        <label>
            <span>${label}</span>
            <span class="slider-value">${formatFixed(def * mult, unit === 'mm' ? 1 : (step < 1 ? 2 : 0))} ${unit}</span>
        </label>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${def}" data-key="${key}">
    `;

    const input = div.querySelector('input');
    const valueSpan = div.querySelector('.slider-value');

    const debouncedChange = debounce(() => {
        if (onChangeCallback) {
            if (changeType === 'geometry') {
                onChangeCallback('geometry', currentGeometry);
            } else if (changeType === 'cooling') {
                onChangeCallback('cooling', currentCooling);
            }
        }
    }, 150);

    input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (changeType === 'geometry') {
            currentGeometry[key] = v;
        } else {
            currentCooling[key] = v;
        }
        const decimals = unit === 'mm' ? 1 : (step < 1 ? 2 : 0);
        valueSpan.textContent = `${formatFixed(v * mult, decimals)} ${unit}`;
        debouncedChange();
    });

    return div;
}

/**
 * Initialize cooling controls.
 */
export function initCoolingControls(container, onChange) {
    container.innerHTML = '';

    // Coolant type selector
    const typeDiv = document.createElement('div');
    typeDiv.className = 'input-group';
    typeDiv.innerHTML = `
        <label><span>Coolant Type</span></label>
        <select id="coolant-type-select" style="width:100%; padding:4px 8px; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border); border-radius:4px; font-size:12px;">
            <option value="rp1">RP-1 (Kerosene)</option>
            <option value="lch4">LCH4 (Liquid Methane)</option>
        </select>
    `;
    container.appendChild(typeDiv);

    const typeSelect = typeDiv.querySelector('select');
    typeSelect.addEventListener('change', () => {
        currentCooling.coolant_type = typeSelect.value;
        if (onChange) onChange('cooling', currentCooling);
    });

    // Enable/disable toggle
    const toggleDiv = document.createElement('div');
    toggleDiv.className = 'input-group';
    toggleDiv.innerHTML = `
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="cooling-enabled" checked style="accent-color:var(--accent);">
            <span>Enable Regen Cooling</span>
        </label>
    `;
    container.appendChild(toggleDiv);

    const checkbox = toggleDiv.querySelector('input');
    checkbox.addEventListener('change', () => {
        currentCooling.enabled = checkbox.checked;
        if (onChange) onChange('cooling', currentCooling);
    });

    // Cooling parameter inputs
    for (const [key, label, min, max, step, def, unit] of COOLING_INPUTS) {
        currentCooling[key] = def;

        const div = document.createElement('div');
        div.className = 'input-group';
        div.innerHTML = `
            <label>
                <span>${label}</span>
                <span>${unit}</span>
            </label>
            <input type="number" min="${min}" max="${max}" step="${step}" value="${def}" data-key="${key}">
        `;

        const input = div.querySelector('input');
        const debouncedChange = debounce(() => {
            if (onChange) onChange('cooling', currentCooling);
        }, 300);

        input.addEventListener('change', () => {
            currentCooling[key] = parseFloat(input.value);
            debouncedChange();
        });

        container.appendChild(div);
    }

    // Channel Height Profile section header + enable toggle
    const chHeader = document.createElement('div');
    chHeader.className = 'section-header';
    chHeader.innerHTML = `
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:8px;">
            <input type="checkbox" id="ch-height-variable" style="accent-color:var(--accent);">
            <span style="font-size:11px; color:#a0a0b0; text-transform:uppercase; letter-spacing:0.5px;">Variable Channel Height</span>
        </label>
    `;
    container.appendChild(chHeader);

    const chToggle = chHeader.querySelector('input');
    const chSliderContainer = document.createElement('div');
    chSliderContainer.id = 'ch-height-sliders';
    chSliderContainer.style.display = 'none';
    container.appendChild(chSliderContainer);

    chToggle.addEventListener('change', () => {
        chSliderContainer.style.display = chToggle.checked ? 'block' : 'none';
        if (!chToggle.checked) {
            // Disable variable channel height: remove CPs from cooling config
            delete currentCooling.ch_height_cp0;
            delete currentCooling.ch_height_cp1;
            delete currentCooling.ch_height_cp2;
        } else {
            // Enable: set CPs to current uniform channel height
            const h = currentCooling.channel_height || 0.003;
            for (const [key,,,,, def] of CHANNEL_HEIGHT_SLIDERS) {
                currentCooling[key] = h;
                const input = chSliderContainer.querySelector(`input[data-key="${key}"]`);
                if (input) input.value = h;
            }
        }
        if (onChange) onChange('cooling', currentCooling);
    });

    // Channel height CP sliders
    for (const [key, label, min, max, step, def, unit, mult] of CHANNEL_HEIGHT_SLIDERS) {
        const div = document.createElement('div');
        div.className = 'slider-group';
        div.innerHTML = `
            <label>
                <span>${label}</span>
                <span class="slider-value">${formatFixed(def * mult, 1)} ${unit}</span>
            </label>
            <input type="range" min="${min}" max="${max}" step="${step}" value="${def}" data-key="${key}">
        `;

        const input = div.querySelector('input');
        const valueSpan = div.querySelector('.slider-value');
        const debouncedChange = debounce(() => {
            if (onChange) onChange('cooling', currentCooling);
        }, 150);

        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            currentCooling[key] = v;
            valueSpan.textContent = `${formatFixed(v * mult, 1)} ${unit}`;
            debouncedChange();
        });

        chSliderContainer.appendChild(div);
    }
}

/**
 * Initialize propellant input fields.
 */
export function initPropellantInputs(container, onChange) {
    container.innerHTML = '';

    for (const [key, label, min, max, step, def, unit] of PROPELLANT_INPUTS) {
        currentPropellant[key] = def;

        const div = document.createElement('div');
        div.className = 'input-group';
        div.innerHTML = `
            <label>
                <span>${label}</span>
                <span>${unit}</span>
            </label>
            <input type="number" min="${min}" max="${max}" step="${step}" value="${def}" data-key="${key}">
        `;

        const input = div.querySelector('input');
        const debouncedChange = debounce(() => {
            if (onChange) onChange('propellant', currentPropellant);
        }, 300);

        input.addEventListener('change', () => {
            currentPropellant[key] = parseFloat(input.value);
            debouncedChange();
        });

        container.appendChild(div);
    }
}

/**
 * Initialize material selector dropdown.
 */
export function initMaterialSelector(selectEl, materials, onChange) {
    selectEl.innerHTML = '';
    for (const mat of materials) {
        const opt = document.createElement('option');
        opt.value = mat.id;
        opt.textContent = mat.name;
        selectEl.appendChild(opt);
    }

    selectEl.addEventListener('change', () => {
        const mat = materials.find(m => m.id === selectEl.value);
        if (mat && onChange) onChange(mat.id, mat);
    });

    if (materials.length > 0) {
        selectEl.value = materials[0].id;
        const mat = materials[0];
        if (onChange) onChange(mat.id, mat);
    }
}

/**
 * Update the material property card display.
 */
export function updateMaterialCard(cardEl, material) {
    const props = [
        ['Density', `${material.density_kg_m3} kg/m3`],
        ['Conductivity', `${material.thermal_conductivity_W_mK} W/mK`],
        ['Melting Point', `${material.melting_point_K} K`],
        ['Yield Strength', `${material.yield_strength_MPa} MPa`],
        ['Elastic Mod.', `${material.elastic_modulus_GPa} GPa`],
        ['Cost', `$${material.cost_per_kg_usd}/kg`],
    ];

    cardEl.innerHTML = props.map(([label, value]) =>
        `<div class="prop"><span class="prop-label">${label}</span><span class="prop-value">${value}</span></div>`
    ).join('');
}

/**
 * Update performance readout values.
 */
export function updatePerformanceReadout(data) {
    const perf = data.performance || {};
    const struct = data.structural_summary || {};
    const cooling = data.cooling || {};

    const setValue = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setValue('val-thrust', formatSI(perf.thrust_N || 0, 'N'));
    setValue('val-isp', formatFixed(perf.specific_impulse_s || 0, 1) + ' s');
    setValue('val-mdot', formatFixed(perf.mass_flow_kg_s || 0, 3) + ' kg/s');
    setValue('val-ve', formatSI(perf.exit_velocity_m_s || 0, 'm/s'));
    setValue('val-mach', formatFixed(perf.exit_mach || 0, 2));
    setValue('val-tw', formatFixed(perf.thrust_to_weight || 0, 1));
    setValue('val-twall', formatFixed(struct.max_wall_temp_K || 0, 0) + ' K');
    setValue('val-sf', formatFixed(struct.min_safety_factor || 0, 2));
    setValue('val-mass', formatFixed(perf.total_mass_kg || 0, 3) + ' kg');

    // Cooling readout
    if (cooling.max_wall_temp_K !== undefined) {
        setValue('val-cool-twall', formatFixed(cooling.max_wall_temp_K, 0) + ' K');
        setValue('val-cool-dp', formatSI(cooling.coolant_pressure_drop_Pa || 0, 'Pa'));
        setValue('val-cool-texit', formatFixed(cooling.coolant_exit_temp_K || 0, 0) + ' K');
    }

    // Warnings
    const warnings = data.warnings || [];
    const box = document.getElementById('warnings-box');
    if (box) {
        box.innerHTML = warnings.map(w => {
            const cls = w.includes('CRITICAL') ? 'warning critical' : 'warning';
            return `<div class="${cls}">${w}</div>`;
        }).join('');
    }
}

/**
 * Set geometry sliders from a config object.
 */
export function setGeometryFromConfig(config) {
    const allSliders = [...GEOMETRY_SLIDERS, ...WALL_THICKNESS_SLIDERS];
    for (const [key] of allSliders) {
        if (config[key] !== undefined) {
            currentGeometry[key] = config[key];
            const input = document.querySelector(`#geometry-sliders input[data-key="${key}"]`);
            if (input) {
                input.value = config[key];
                input.dispatchEvent(new Event('input'));
            }
        }
    }
    // Backward compat: if config has wall_thickness but not wt_cp0, fill all CPs
    if (config.wall_thickness !== undefined && config.wt_cp0 === undefined) {
        for (let i = 0; i < 6; i++) {
            const key = `wt_cp${i}`;
            currentGeometry[key] = config.wall_thickness;
            const input = document.querySelector(`#geometry-sliders input[data-key="${key}"]`);
            if (input) {
                input.value = config.wall_thickness;
                input.dispatchEvent(new Event('input'));
            }
        }
    }
}

/**
 * Set propellant inputs from a config object.
 */
export function setPropellantFromConfig(config) {
    for (const [key] of PROPELLANT_INPUTS) {
        if (config[key] !== undefined) {
            currentPropellant[key] = config[key];
            const input = document.querySelector(`#propellant-inputs input[data-key="${key}"]`);
            if (input) {
                input.value = config[key];
            }
        }
    }
}

/**
 * Set cooling controls from a config object.
 */
export function setCoolingFromConfig(config) {
    if (!config) return;
    for (const key of Object.keys(config)) {
        if (key === 'enabled') {
            currentCooling.enabled = config.enabled;
            const cb = document.getElementById('cooling-enabled');
            if (cb) cb.checked = config.enabled;
        } else if (key === 'coolant_type') {
            currentCooling.coolant_type = config.coolant_type;
            const sel = document.getElementById('coolant-type-select');
            if (sel) sel.value = config.coolant_type;
        } else {
            currentCooling[key] = config[key];
            const input = document.querySelector(`#cooling-controls input[data-key="${key}"]`);
            if (input) input.value = config[key];
        }
    }
}

export function getGeometry() { return { ...currentGeometry }; }
export function getCooling() { return { ...currentCooling }; }
export function getPropellant() { return { ...currentPropellant }; }
