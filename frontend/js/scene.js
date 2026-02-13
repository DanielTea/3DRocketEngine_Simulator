/**
 * Three.js scene setup: renderer, camera, lighting.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls';

let renderer, scene, camera, controls;
let animateCallbacks = [];

export function initScene(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0c20);

    camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.001, 50);
    camera.position.set(0.12, 0.08, 0.18);

    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0.08, 0, 0);
    controls.minDistance = 0.02;
    controls.maxDistance = 2;
    controls.update();

    // Lighting — bright enough to see metallic surfaces clearly
    const ambient = new THREE.AmbientLight(0x8090b0, 1.0);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xfff0e0, 2.0);
    keyLight.position.set(0.5, 1.0, 1.0);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x6688cc, 0.8);
    fillLight.position.set(-0.5, 0.3, -0.5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
    rimLight.position.set(-0.3, -0.5, 0.5);
    scene.add(rimLight);

    // Subtle grid
    const grid = new THREE.GridHelper(1, 20, 0x1a2a4a, 0x111a30);
    grid.rotation.z = Math.PI / 2;
    grid.position.x = 0.15;
    scene.add(grid);

    // Handle resize
    const observer = new ResizeObserver(() => {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    });
    observer.observe(canvas.parentElement);

    // Render loop
    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        for (const cb of animateCallbacks) cb();
        renderer.render(scene, camera);
    }
    animate();

    return { renderer, scene, camera, controls };
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getControls() { return controls; }
export function getRenderer() { return renderer; }

export function onAnimate(callback) {
    animateCallbacks.push(callback);
}

/**
 * Auto-frame the camera to fit the engine mesh.
 */
export function frameMesh(totalLength, maxRadius) {
    const cx = totalLength / 2;
    const dist = Math.max(totalLength, maxRadius * 4) * 1.4;
    controls.target.set(cx, 0, 0);
    camera.position.set(cx + dist * 0.3, dist * 0.35, dist * 0.6);
    controls.update();
}

export function setCameraView(view) {
    const t = controls.target;
    const d = camera.position.distanceTo(t) || 0.2;
    switch (view) {
        case 'iso':
            camera.position.set(t.x + d * 0.4, d * 0.35, d * 0.6);
            break;
        case 'side':
            camera.position.set(t.x, 0, d);
            break;
        case 'front':
            camera.position.set(t.x + d, 0, 0.001);
            break;
        case 'section':
            // View from the side, slightly above, looking at the cut face
            camera.position.set(t.x, d * 0.25, -d * 0.05);
            break;
    }
    controls.update();
}
