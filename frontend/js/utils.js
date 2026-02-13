/**
 * Shared math and formatting utilities.
 */

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

export function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

export function mapRange(v, inLo, inHi, outLo, outHi) {
    const t = (v - inLo) / (inHi - inLo);
    return lerp(outLo, outHi, clamp(t, 0, 1));
}

export function formatSI(value, unit = '', decimals = 2) {
    const abs = Math.abs(value);
    if (abs >= 1e9) return (value / 1e9).toFixed(decimals) + ' G' + unit;
    if (abs >= 1e6) return (value / 1e6).toFixed(decimals) + ' M' + unit;
    if (abs >= 1e3) return (value / 1e3).toFixed(decimals) + ' k' + unit;
    if (abs >= 1) return value.toFixed(decimals) + ' ' + unit;
    if (abs >= 1e-3) return (value * 1e3).toFixed(decimals) + ' m' + unit;
    if (abs >= 1e-6) return (value * 1e6).toFixed(decimals) + ' u' + unit;
    return value.toExponential(decimals) + ' ' + unit;
}

export function formatFixed(value, decimals = 2) {
    return Number(value).toFixed(decimals);
}

export function debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}
