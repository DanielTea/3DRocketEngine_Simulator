/**
 * Evolution progress chart: renders fitness over generations on a 2D canvas.
 */

let ctx = null;
let data = { best: [], avg: [], worst: [] };
let maxGen = 0;

/**
 * Initialize the chart with a canvas element.
 * @param {HTMLCanvasElement} canvas
 */
export function initEvolutionChart(canvas) {
    ctx = canvas.getContext('2d');
    clearChart();
}

/**
 * Add a generation data point.
 */
export function addGenerationData(gen, best, avg, worst) {
    data.best.push(best);
    data.avg.push(avg);
    data.worst.push(worst);
    maxGen = gen;
    redraw();
}

/**
 * Clear all chart data.
 */
export function clearChart() {
    data = { best: [], avg: [], worst: [] };
    maxGen = 0;
    if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        drawEmpty();
    }
}

function drawEmpty() {
    if (!ctx) return;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.fillStyle = '#1e2a45';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#606070';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Evolution chart — start evolution to see progress', w / 2, h / 2);
}

function redraw() {
    if (!ctx || data.best.length === 0) return;

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const padding = { top: 20, right: 15, bottom: 30, left: 45 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    // Clear
    ctx.fillStyle = '#1e2a45';
    ctx.fillRect(0, 0, w, h);

    // Compute bounds
    const allVals = [...data.best, ...data.avg, ...data.worst];
    let yMin = Math.min(...allVals);
    let yMax = Math.max(...allVals);
    if (yMax - yMin < 0.01) { yMin -= 0.05; yMax += 0.05; }
    const nPts = data.best.length;
    const xMax = Math.max(nPts - 1, 1);

    function toX(i) { return padding.left + (i / xMax) * plotW; }
    function toY(v) { return padding.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH; }

    // Grid lines
    ctx.strokeStyle = '#2a3a5c';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (i / 4) * plotH;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();
    }

    // Fill band between best and worst
    ctx.fillStyle = 'rgba(15, 158, 240, 0.08)';
    ctx.beginPath();
    for (let i = 0; i < nPts; i++) {
        const x = toX(i);
        ctx.lineTo(x, toY(data.best[i]));
    }
    for (let i = nPts - 1; i >= 0; i--) {
        ctx.lineTo(toX(i), toY(data.worst[i]));
    }
    ctx.closePath();
    ctx.fill();

    // Draw lines
    function drawLine(arr, color, width) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
            const x = toX(i);
            const y = toY(arr[i]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    drawLine(data.worst, '#e74c3c88', 1);
    drawLine(data.avg, '#f39c1299', 1.5);
    drawLine(data.best, '#2ecc71', 2);

    // Axes labels
    ctx.fillStyle = '#a0a0b0';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Generation', w / 2, h - 4);

    ctx.textAlign = 'left';
    ctx.fillText('0', padding.left, h - 14);
    ctx.textAlign = 'right';
    ctx.fillText(String(maxGen), w - padding.right, h - 14);

    // Y labels
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const v = yMin + (1 - i / 4) * (yMax - yMin);
        ctx.fillText(v.toFixed(3), padding.left - 4, padding.top + (i / 4) * plotH + 4);
    }

    // Legend
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    const lx = padding.left + 5;
    const ly = padding.top + 12;
    ctx.fillStyle = '#2ecc71'; ctx.fillText('Best', lx, ly);
    ctx.fillStyle = '#f39c12'; ctx.fillText('Avg', lx + 30, ly);
    ctx.fillStyle = '#e74c3c'; ctx.fillText('Worst', lx + 58, ly);
}
