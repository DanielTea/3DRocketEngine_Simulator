/**
 * Color ramp utilities for thermal and stress visualization.
 */

/**
 * Thermal color scale: blue (cold) -> cyan -> green -> yellow -> red (hot).
 * Returns [r, g, b] each in [0, 1].
 */
export function thermalColor(value, min, max) {
    let t = (value - min) / (max - min);
    t = Math.max(0, Math.min(1, t));

    let r, g, b;
    if (t < 0.25) {
        const s = t / 0.25;
        r = 0; g = s; b = 1;
    } else if (t < 0.5) {
        const s = (t - 0.25) / 0.25;
        r = 0; g = 1; b = 1 - s;
    } else if (t < 0.75) {
        const s = (t - 0.5) / 0.25;
        r = s; g = 1; b = 0;
    } else {
        const s = (t - 0.75) / 0.25;
        r = 1; g = 1 - s; b = 0;
    }
    return [r, g, b];
}

/**
 * Stress color scale: green (safe) -> yellow -> red (yield).
 * value: von Mises stress, sigmaYield: material yield strength.
 */
export function stressColor(value, sigmaYield) {
    let t = value / sigmaYield;
    t = Math.max(0, Math.min(1.5, t));

    let r, g, b;
    if (t < 0.5) {
        r = 0; g = 0.8; b = 0.2;
    } else if (t < 0.8) {
        const s = (t - 0.5) / 0.3;
        r = s; g = 0.8; b = 0.2 * (1 - s);
    } else if (t < 1.0) {
        const s = (t - 0.8) / 0.2;
        r = 1; g = 0.8 * (1 - s); b = 0;
    } else {
        r = 1; g = 0; b = 0;
    }
    return [r, g, b];
}

/**
 * Draw a color legend bar on a 2D canvas context.
 */
export function drawLegend(ctx, x, y, width, height, colorFn, min, max, unit, steps = 50) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    for (let i = 0; i < steps; i++) {
        const t = 1 - i / steps;
        const value = min + t * (max - min);
        const [r, g, b] = colorFn(value, min, max);
        ctx.fillStyle = `rgb(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0})`;
        ctx.fillRect(x, y + (i / steps) * height, width, height / steps + 1);
    }

    // Labels
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${max.toFixed(0)} ${unit}`, x + width + 4, y + 10);
    ctx.fillText(`${((max + min) / 2).toFixed(0)}`, x + width + 4, y + height / 2 + 4);
    ctx.fillText(`${min.toFixed(0)} ${unit}`, x + width + 4, y + height);
}
