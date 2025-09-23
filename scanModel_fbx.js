import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const MODEL_URL = "asset/baby.fbx";

const container = document.querySelector("#viewport");

const png = document.getElementById("fetus");
if (png) png.style.display = "none";

// Scene / camera / renderer
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b0f14, 0.035);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0.8, 0.5, 1.8);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

renderer.domElement.style.position = "absolute";
renderer.domElement.style.inset = "0";
renderer.domElement.style.clipPath =
    "inset(0 calc(100% - var(--reveal)) 0 0 round 2px)";
renderer.domElement.style.webkitClipPath =
    "inset(0 calc(100% - var(--reveal)) 0 0 round 2px)";
container.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x0a0a10, 0.45));
const key = new THREE.DirectionalLight(0xffffff, 0.65);
key.position.set(2, 2, 3);
scene.add(key);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 0.4;
controls.maxDistance = 6;

const root = new THREE.Group();
scene.add(root);

let mixer = null;
let particleCloud = null;
let solidModel = null;

new FBXLoader().load(
    MODEL_URL,
    (fbx) => {
        // Neutral mesh (kept for debug toggle)
        fbx.traverse((o) => {
            if (o.isMesh) {
                o.material = new THREE.MeshStandardMaterial({
                    color: 0xe9eef6,
                    roughness: 0.7,
                    metalness: 0.0,
                });
                o.castShadow = o.receiveShadow = false;
            }
        });

        // Center & scale
        const box = new THREE.Box3().setFromObject(fbx);
        const size = box.getSize(new THREE.Vector3()).length();
        const center = box.getCenter(new THREE.Vector3());
        fbx.position.sub(center);
        fbx.scale.setScalar(1.6 / size);

        root.add(fbx);
        solidModel = fbx;

        // Play embedded animations if present
        if (fbx.animations && fbx.animations.length) {
            mixer = new THREE.AnimationMixer(fbx);
            fbx.animations.forEach((clip) => mixer.clipAction(clip).play());
        }

        // Particle cloud
        particleCloud = buildParticleCloud(fbx, {
            targetCount: 60000,
            size: 0.018,
        });
        root.add(particleCloud);

        fbx.visible = false;
        particleCloud.visible = true;
    },
    undefined,
    (err) => console.error("FBX load error:", err)
);

// ---------- helpers ----------

function getCSSProgress() {
    const cs = getComputedStyle(document.documentElement);
    let v = cs.getPropertyValue("--act1-progress").trim();
    if (!v) v = cs.getPropertyValue("--progress").trim();
    const n = parseFloat(v || "0");
    return isNaN(n) ? 0 : n / 100;
}

function buildParticleCloud(
    object3D,
    {
        targetCount = 35000,
        size = 0.015,
        spread = 0.085,
        jitter = 0.02,
        hollow = 0.25,
    } = {}
) {
    const pts = [];
    const v = new THREE.Vector3();
    object3D.updateMatrixWorld(true);

    // sample fewer verts → sparser look
    object3D.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        const pos = o.geometry.attributes.position;
        const step = Math.max(1, Math.floor(pos.count / targetCount));
        for (let i = 0; i < pos.count; i += step) {
            v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            pts.push(v.x, v.y, v.z);
        }
    });

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));

    // normalize to your 1.6 “fit box” like the mesh
    const box = new THREE.Box3().setFromBufferAttribute(
        geom.getAttribute("position")
    );
    const sz = box.getSize(new THREE.Vector3()).length();
    const ctr = box.getCenter(new THREE.Vector3());
    const arr = geom.getAttribute("position");
    const scale = 1.6 / sz;

    // push points outward + add jitter; randomly drop some interior points
    const toDrop = [];
    for (let i = 0; i < arr.count; i++) {
        // scaled, centered
        let px = (arr.getX(i) - ctr.x) * scale;
        let py = (arr.getY(i) - ctr.y) * scale;
        let pz = (arr.getZ(i) - ctr.z) * scale;

        // radial direction
        const len = Math.hypot(px, py, pz) || 1.0;
        const nx = px / len,
            ny = py / len,
            nz = pz / len;

        // outward push (prefer more push at the “inside” to hollow it)
        const radial = spread * Math.pow(Math.random(), 0.6);
        px += nx * radial;
        py += ny * radial;
        pz += nz * radial;

        // random jitter (isotropic dust)
        px += (Math.random() * 2 - 1) * jitter;
        py += (Math.random() * 2 - 1) * jitter;
        pz += (Math.random() * 2 - 1) * jitter;

        if (Math.random() < hollow * Math.max(0, 1.0 - len)) {
            toDrop.push(i);
            continue;
        }

        arr.setX(i, px);
        arr.setY(i, py);
        arr.setZ(i, pz);
    }

    // compact if dropped
    if (toDrop.length) {
        const keep = new Float32Array((arr.count - toDrop.length) * 3);
        let w = 0;
        for (let i = 0; i < arr.count; i++) {
            if (toDrop.includes(i)) continue;
            keep[w++] = arr.getX(i);
            keep[w++] = arr.getY(i);
            keep[w++] = arr.getZ(i);
        }
        geom.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(keep, 3)
        );
    } else {
        arr.needsUpdate = true;
    }

    const sprite = makeSoftCircle();
    const mat = new THREE.PointsMaterial({
        size,
        map: sprite,
        alphaTest: 0.02,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: new THREE.Color(0xdfe6ee),
        opacity: 0.72,
        sizeAttenuation: true,
        fog: true,
    });

    applyScanTwinkle(mat);

    return new THREE.Points(geom, mat);
}
root.add(makeAmbientDust(0.95, 1800)); // radius, count
function makeAmbientDust(radius = 1.0, count = 1500) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        // random within a sphere shell
        let x = Math.random() * 2 - 1;
        let y = Math.random() * 2 - 1;
        let z = Math.random() * 2 - 1;
        const len = Math.hypot(x, y, z) || 1;
        x /= len;
        y /= len;
        z /= len;
        const r = radius * (0.75 + Math.random() * 0.35);
        positions[i * 3 + 0] = x * r;
        positions[i * 3 + 1] = y * r;
        positions[i * 3 + 2] = z * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const m = new THREE.PointsMaterial({
        size: 0.01,
        color: 0xd0d7e0,
        opacity: 0.18,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        fog: true,
    });
    return new THREE.Points(g, m);
}

function makeSoftCircle() {
    const N = 64;
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    g.addColorStop(0.0, "rgba(255,255,255,1)");
    g.addColorStop(0.65, "rgba(255,255,255,0.55)");
    g.addColorStop(1.0, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(N / 2, N / 2, N / 2, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function applyScanTwinkle(material) {
    material.onBeforeCompile = (shader) => {
        // uniforms
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uProgress = { value: 0 };

        // add varyings + uniforms to both shaders
        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                "#include <common>\nuniform float uTime; uniform float uProgress;\nvarying float vGlow; varying float vTw;"
            )
            // after project to clip-space, compute glow & twinkle
            .replace(
                "#include <project_vertex>",
                `#include <project_vertex>
         // screen-space X in 0..1
         vec4 clipPos = projectionMatrix * mvPosition;
         float screenX = (clipPos.x/clipPos.w) * 0.5 + 0.5;
         float d = abs(screenX - uProgress);
         vGlow = smoothstep(0.06, 0.0, d);          // narrow band glows
         // cheap per-point phase using object-space pos
         vTw = 0.5 + 0.5 * sin(uTime*1.2 + dot(position.xy, vec2(12.9898,78.233)));
        `
            )
            // after standard size computation, boost size by twinkle/glow
            .replace(
                "#include <fog_vertex>",
                `gl_PointSize *= (1.0 + 0.55*vTw + 0.85*vGlow);\n#include <fog_vertex>`
            );

        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <common>",
                "#include <common>\nvarying float vGlow; varying float vTw;"
            )
            .replace(
                "diffuseColor.a = opacity;",
                "diffuseColor.a = opacity * (0.55 + 0.45*vTw) + vGlow * 0.35;"
            );

        // stash for runtime updates
        material.userData.shader = shader;
    };

    material.needsUpdate = true;
}

// Resize to viewport
new ResizeObserver(([entry]) => {
    const w = entry.contentRect.width,
        h = entry.contentRect.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}).observe(container);

window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "p") {
        if (!solidModel || !particleCloud) return;
        const toParticles = !particleCloud.visible;
        particleCloud.visible = toParticles;
        solidModel.visible = !toParticles;
    }
});

// Animate
const clock = new THREE.Clock();
function tick() {
    requestAnimationFrame(tick);
    const dt = clock.getDelta();
    if (mixer) mixer.update(dt);

    root.rotation.y += dt * 0.15;

    // keep shader uniforms in sync
    if (particleCloud) {
        const mat = particleCloud.material;
        const sh = mat.userData && mat.userData.shader;
        if (sh) {
            sh.uniforms.uTime.value = clock.elapsedTime;
            sh.uniforms.uProgress.value = getCSSProgress(); // <- from your scan UI
        }
    }

    controls.update();
    renderer.render(scene, camera);
}
tick();
