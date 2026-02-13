/**
 * REST API client for materials, presets, and configuration.
 */

const API_BASE = '/api';

export async function fetchMaterials() {
    const res = await fetch(`${API_BASE}/materials`);
    if (!res.ok) throw new Error(`Failed to fetch materials: ${res.status}`);
    return res.json();
}

export async function fetchPresets() {
    const res = await fetch(`${API_BASE}/presets`);
    if (!res.ok) throw new Error(`Failed to fetch presets: ${res.status}`);
    return res.json();
}

export async function sendConfig(config) {
    const res = await fetch(`${API_BASE}/simulation/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `Config error: ${res.status}`);
    }
    return res.json();
}

export async function exportSTL(config) {
    const res = await fetch(`${API_BASE}/export/stl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `Export failed: ${res.status}` }));
        throw new Error(err.detail || `Export error: ${res.status}`);
    }

    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?(.+?)"?$/);
    const filename = match ? match[1] : 'rocket_engine.stl';

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
