import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/* -------------------- Config -------------------- */
const PATH_MODELS = {
    beauty: "asset/beauty.glb",
    power: "asset/power1.glb",
    survival: "asset/survival.glb",
};
const COLORS = { beauty: 0xff3b45, power: 0xffd166, survival: 0x67e8f9 };
const ROUTE_COMBINE = "act3.html";
const VALID_KEYS = new Set(["beauty", "power", "survival"]);

/* -------------------- Utils --------------------- */
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const emit = (name, detail = {}) =>
    window.dispatchEvent(new CustomEvent(name, { detail }));
const onReady = (fn) => {
    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
};

/* ---------------- Progress store ---------------- */
function readVisited() {
    try {
        const raw = JSON.parse(
            localStorage.getItem("tpb_progress") || '{"visited":[]}'
        );
        const arr = Array.isArray(raw.visited) ? raw.visited : [];
        return new Set(arr.filter((k) => VALID_KEYS.has(k)));
    } catch {
        return new Set();
    }
}
const visited = readVisited();
function persistVisited() {
    try {
        localStorage.setItem(
            "tpb_progress",
            JSON.stringify({ visited: [...visited] })
        );
    } catch {}
}

/* ---------------- Ambient dust (optional bg) ------------------ */
(function dust() {
    const c = document.getElementById("dust");
    if (!c) return;
    const ctx = c.getContext("2d");
    const DPR = Math.min(2, devicePixelRatio || 1);
    const stars = Array.from({ length: 200 }, () => ({
        x: Math.random() * innerWidth,
        y: Math.random() * innerHeight,
        a: Math.random() * Math.PI * 2,
        v: 0.18 + Math.random() * 0.4,
        r: 0.4 + Math.random() * 1.2,
    }));
    function resize() {
        c.width = Math.floor(innerWidth * DPR);
        c.height = Math.floor(innerHeight * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    function step(t) {
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        ctx.globalCompositeOperation = "lighter";
        for (const s of stars) {
            s.x += Math.cos(s.a) * s.v;
            s.y += Math.sin(s.a) * s.v;
            if (s.x < 0) s.x = innerWidth;
            if (s.x > innerWidth) s.x = 0;
            if (s.y < 0) s.y = innerHeight;
            if (s.y > innerHeight) s.y = 0;
            const tw = 0.5 + 0.5 * Math.sin(t * 0.002 + s.a * 7.3);
            ctx.fillStyle = `rgba(255,255,255,${0.05 + tw * 0.35})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r * (0.7 + tw * 0.6), 0, Math.PI * 2);
            ctx.fill();
        }
        requestAnimationFrame(step);
    }
    resize();
    addEventListener("resize", resize, { passive: true });
    requestAnimationFrame(step);
})();

/* --------------- Particles / placeholders --------------- */
function makeSoftCircle() {
    const N = 64,
        c = document.createElement("canvas");
    c.width = c.height = N;
    const g = c
        .getContext("2d")
        .createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.65, "rgba(255,255,255,.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    const ctx = c.getContext("2d");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(N / 2, N / 2, N / 2, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}
const SPRITE = makeSoftCircle();

function pointsMaterial(color, size = 0.02) {
    const mat = new THREE.PointsMaterial({
        size,
        map: SPRITE,
        transparent: true,
        depthWrite: false,
        alphaTest: 0.02,
        blending: THREE.AdditiveBlending,
        color: new THREE.Color(color),
        opacity: 0.85,
        sizeAttenuation: true,
        fog: true,
    });
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        mat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                "#include <common>\nuniform float uTime;"
            )
            .replace(
                "#include <fog_vertex>",
                `gl_PointSize *= (0.92 + 0.22*sin(uTime*1.2 + dot(position.xy, vec2(12.9898,78.233))));\n#include <fog_vertex>`
            );
    };
    return mat;
}
function centerAndFitPositions(geom, fit = 1.35) {
    const pos = geom.getAttribute("position");
    const box = new THREE.Box3().setFromBufferAttribute(pos);
    const len = box.getSize(new THREE.Vector3()).length();
    const ctr = box.getCenter(new THREE.Vector3());
    const s = fit / len;
    for (let i = 0; i < pos.count; i++) {
        pos.setX(i, (pos.getX(i) - ctr.x) * s);
        pos.setY(i, (pos.getY(i) - ctr.y) * s);
        pos.setZ(i, (pos.getZ(i) - ctr.z) * s);
    }
    pos.needsUpdate = true;
}
function particleFromGeometry(geometry, { color, size = 0.022 } = {}) {
    const geo = geometry.clone().toNonIndexed();
    const a = geo.getAttribute("position");
    const arr = a.array;
    for (let i = 0; i < arr.length; i += 3) {
        arr[i] += (Math.random() * 2 - 1) * 0.004;
        arr[i + 1] += (Math.random() * 2 - 1) * 0.004;
        arr[i + 2] += (Math.random() * 2 - 1) * 0.004;
    }
    a.needsUpdate = true;
    centerAndFitPositions(geo);
    return new THREE.Points(geo, pointsMaterial(color, size));
}
function particleFromObject(
    obj,
    { color, targetCount = 32000, jitter = 0.008, size = 0.02 } = {}
) {
    const pts = [],
        v = new THREE.Vector3();
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        const pos = o.geometry.attributes.position;
        const step = Math.max(1, Math.floor(pos.count / (targetCount / 2)));
        for (let i = 0; i < pos.count; i += step) {
            v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            v.x += (Math.random() * 2 - 1) * jitter;
            v.y += (Math.random() * 2 - 1) * jitter;
            v.z += (Math.random() * 2 - 1) * jitter;
            pts.push(v.x, v.y, v.z);
        }
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    centerAndFitPositions(geom);
    return new THREE.Points(geom, pointsMaterial(color, size));
}

/* ---------------- Viewer per card ---------------- */
class Slot {
    constructor(rootEl, key) {
        this.key = key;
        this.tint = COLORS[key] || 0xffffff;
        this.el = rootEl;
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0b0f14, 0.035);
        this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 20);
        this.camera.position.set(0.6, 0.35, 1.3);
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
        });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.setSize(this.el.clientWidth, this.el.clientHeight, false);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.el.appendChild(this.renderer.domElement);
        this.scene.add(
            new THREE.HemisphereLight(0xffffff, 0x0a0a10, 0.6),
            new THREE.DirectionalLight(0xffffff, 0.55)
        );
        this.controls = new OrbitControls(
            this.camera,
            this.renderer.domElement
        );
        this.controls.enablePan = false;
        this.controls.enableDamping = true;
        this.controls.minDistance = 0.4;
        this.controls.maxDistance = 6;
        this.controls.target.set(0, 0, 0);
        this.root = new THREE.Group();
        this.scene.add(this.root);
        this.clock = new THREE.Clock();

        this.placeholder = particleFromGeometry(
            new THREE.TorusKnotGeometry(0.36, 0.12, 420, 52),
            { color: this.tint, size: 0.02 }
        );
        this.root.add(this.placeholder);

        new ResizeObserver(([e]) => {
            this.renderer.setSize(
                e.contentRect.width,
                e.contentRect.height,
                false
            );
            this.camera.aspect = e.contentRect.width / e.contentRect.height;
            this.camera.updateProjectionMatrix();
        }).observe(this.el);

        requestAnimationFrame(this.tick);
    }
    loadGLB(url) {
        new GLTFLoader().load(
            url,
            (gltf) => {
                const cloud = particleFromObject(gltf.scene || gltf.scenes[0], {
                    color: this.tint,
                });
                if (this.placeholder) {
                    this.root.remove(this.placeholder);
                    this.placeholder.geometry?.dispose?.();
                }
                this.root.add(cloud);
                this.points = cloud;
            },
            undefined,
            (err) => console.error(`[${this.key}] GLB error`, err)
        );
    }
    tick = () => {
        const dt = this.clock.getDelta();
        this.root.rotation.y += dt * 0.25;
        this.root.traverse((o) => {
            if (o.isPoints && o.material) {
                o.material.size =
                    0.02 + Math.sin(this.clock.elapsedTime * 0.9) * 0.002;
                const sh = o.material.userData?.shader;
                if (sh) sh.uniforms.uTime.value = this.clock.elapsedTime;
            }
        });
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(this.tick);
    };
}

onReady(() => {
    const mb = $("#model_beauty"),
        mp = $("#model_power"),
        ms = $("#model_survival");
    if (mb) {
        const s = new Slot(mb, "beauty");
        if (PATH_MODELS.beauty) s.loadGLB(PATH_MODELS.beauty);
    }
    if (mp) {
        const s = new Slot(mp, "power");
        if (PATH_MODELS.power) s.loadGLB(PATH_MODELS.power);
    }
    if (ms) {
        const s = new Slot(ms, "survival");
        if (PATH_MODELS.survival) s.loadGLB(PATH_MODELS.survival);
    }
});

/* ===================== Trials (simple + timed) ===================== */
function setupHiDPICanvas(canvas) {
    const ctx = canvas.getContext("2d", { alpha: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
        const r = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(r.width * dpr));
        const h = Math.max(1, Math.floor(r.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        return { width: r.width, height: r.height };
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return { ctx, dpr, resize, destroy: () => ro.disconnect() };
}
function openTrialOverlay(title, hint, seconds) {
    emit("tpb:trial:open", { title });
    const ov = document.createElement("div");
    ov.className = "trial-overlay";
    ov.innerHTML = `
    <div class="trial-wrap" tabindex="0" role="dialog" aria-label="${title}">
      <div class="trial-head"><div>${title}</div><div class="mono" id="trialTimer">00:${String(
        seconds
    ).padStart(2, "0")}</div></div>
      <div class="trial-body">
        <canvas class="trial-canvas" id="trialCanvas"></canvas>
        <div class="trial-hint mono">${hint}</div>
      </div>
      <div class="trial-foot">
        <button class="tbtn" id="trialQuit" type="button">Abort</button>
        <button class="tbtn" id="trialGo"   type="button">Begin</button>
      </div>
    </div>`;
    document.body.appendChild(ov);

    const wrap = ov.querySelector(".trial-wrap");
    const c = ov.querySelector("#trialCanvas");
    c.tabIndex = 0; // allow the canvas to receive focus
    const timerEl = ov.querySelector("#trialTimer");
    const quit = ov.querySelector("#trialQuit");
    const go = ov.querySelector("#trialGo");
    const { ctx, resize, destroy } = setupHiDPICanvas(c);
    setTimeout(() => wrap.focus({ preventScroll: true }), 0);
    const swallow = (e) => {
        const k = e.key;
        if (
            k === " " ||
            k.startsWith("Arrow") ||
            k === "PageUp" ||
            k === "PageDown"
        )
            e.preventDefault();
    };
    wrap.addEventListener("keydown", swallow, true);
    return { ov, wrap, c, ctx, resize, timerEl, quit, go, destroy, seconds };
}

// BEAUTY — STILLNESS (cursor stays in halo)
function trialBeauty() {
    const TARGET_STILL = 6.0,
        LIMIT = 15;
    return new Promise((resolve, reject) => {
        const ui = openTrialOverlay(
            "BEAUTY // STILLNESS CAPTURE",
            "Keep cursor inside the drifting halo to record 6.0s of stillness.",
            LIMIT
        );
        const { ov, c, ctx, resize, timerEl, quit, go, destroy } = ui;
        let started = false,
            last = 0,
            ttl = LIMIT;
        let insideAccum = 0;
        let mx = -999,
            my = -999;
        let t = 0;
        const halo = () => {
            const { width: w, height: h } = resize();
            const cx = w * 0.5 + Math.cos(t * 0.7) * w * 0.12;
            const cy = h * 0.55 + Math.sin(t * 0.9) * h * 0.08;
            const r = Math.min(w, h) * 0.11 * (1 + 0.08 * Math.sin(t * 1.2));
            return { cx, cy, r };
        };
        c.addEventListener("mousemove", (e) => {
            const r = c.getBoundingClientRect();
            mx = e.clientX - r.left;
            my = e.clientY - r.top;
        });
        c.addEventListener("mouseleave", () => {
            mx = -999;
            my = -999;
        });
        c.addEventListener(
            "touchmove",
            (e) => {
                const t0 = e.touches[0];
                if (!t0) return;
                const r = c.getBoundingClientRect();
                mx = t0.clientX - r.left;
                my = t0.clientY - r.top;
            },
            { passive: true }
        );
        function draw(ts) {
            const dt = last ? (ts - last) / 1000 : 0;
            last = ts;
            const { width: w, height: h } = resize();
            ctx.clearRect(0, 0, w, h);
            // grid
            ctx.strokeStyle = "rgba(255,255,255,.06)";
            ctx.lineWidth = 1;
            for (let x = 40; x < w; x += 40) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h);
                ctx.stroke();
            }
            for (let y = 40; y < h; y += 40) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
                ctx.stroke();
            }
            // halo
            t += dt;
            const h0 = halo();
            ctx.fillStyle = "rgba(255,255,255,.06)";
            ctx.beginPath();
            ctx.arc(h0.cx, h0.cy, h0.r * 1.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,.35)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(h0.cx, h0.cy, h0.r, 0, Math.PI * 2);
            ctx.stroke();
            // pointer
            if (mx > -900) {
                const d = Math.hypot(mx - h0.cx, my - h0.cy);
                const inside = d <= h0.r;
                ctx.fillStyle = inside
                    ? "rgba(255,255,255,.95)"
                    : "rgba(255,255,255,.35)";
                ctx.beginPath();
                ctx.arc(mx, my, 4, 0, Math.PI * 2);
                ctx.fill();
                if (started && inside) insideAccum += dt;
            }
            // progress
            ctx.fillStyle = "#cfe7ff";
            ctx.font = "600 12px JetBrains Mono";
            ctx.fillText(
                `Inside: ${insideAccum.toFixed(1)} / ${TARGET_STILL.toFixed(
                    1
                )} s`,
                20,
                28
            );
            const pct = clamp(insideAccum / TARGET_STILL, 0, 1);
            ctx.fillStyle = "rgba(255,255,255,.15)";
            ctx.fillRect(20, 38, 200, 8);
            ctx.fillStyle = "rgba(255,255,255,.8)";
            ctx.fillRect(20, 38, 200 * pct, 8);
            if (started) {
                ttl = Math.max(0, ttl - dt);
                timerEl.textContent =
                    "00:" + String(Math.ceil(ttl)).padStart(2, "0");
                if (insideAccum >= TARGET_STILL) {
                    success();
                    return;
                }
                if (ttl <= 0) {
                    fail();
                    return;
                }
            }
            requestAnimationFrame(draw);
        }
        function cleanup() {
            destroy();
            ov.remove();
        }
        function success() {
            emit("tpb:trial:success", "beauty");
            cleanup();
            resolve(true);
        }
        function fail() {
            emit("tpb:trial:fail", "beauty");
            cleanup();
            reject("timeout");
        }
        quit.onclick = () => {
            emit("tpb:trial:abort", "beauty");
            cleanup();
            reject("abort");
        };
        go.onclick = () => {
            if (started) return;
            started = true;
            go.disabled = true;
            c.focus();
        };
        requestAnimationFrame(draw);
    });
}

// POWER — STABLE PRESS (hold F)  — FIXED
function trialPower() {
    const LIMIT = 12;
    return new Promise((resolve, reject) => {
        const ui = openTrialOverlay(
            "POWER // STABLE PRESS",
            "Hold F to stabilize the grid. Fill the ring before time expires.",
            LIMIT
        );
        const { ov, wrap, c, ctx, resize, timerEl, quit, go, destroy } = ui;
        let started = false,
            last = 0,
            ttl = LIMIT;
        let hold = false,
            charge = 0;

        const kd = (e) => {
            if (!started) return;
            const k = e.key?.toLowerCase?.();
            if (k === "f") {
                hold = true;
                e.preventDefault();
            }
            if (e.key.startsWith("Arrow")) e.preventDefault();
        };
        const ku = (e) => {
            if (!started) return;
            const k = e.key?.toLowerCase?.();
            if (k === "f") {
                hold = false;
                e.preventDefault();
            }
        };

        // Capture at document level so no extra click is needed
        document.addEventListener("keydown", kd, true);
        document.addEventListener("keyup", ku, true);

        function draw(ts) {
            const dt = last ? (ts - last) / 1000 : 0;
            last = ts;
            const { width: w, height: h } = resize();
            const cx = w * 0.5,
                cy = h * 0.58;
            const R = Math.min(w, h) * 0.22;
            ctx.clearRect(0, 0, w, h);
            ctx.strokeStyle = "rgba(255,255,255,.12)";
            ctx.lineWidth = 12;
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.stroke();
            if (started) {
                charge = clamp(charge + (hold ? +0.7 * dt : -0.35 * dt), 0, 1);
                ttl = Math.max(0, ttl - dt);
                timerEl.textContent =
                    "00:" + String(Math.ceil(ttl)).padStart(2, "0");
                if (charge >= 1) return success();
                if (ttl <= 0) return fail();
            }
            ctx.strokeStyle = "rgba(255,255,255,.9)";
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(
                cx,
                cy,
                R + 12,
                -Math.PI * 0.5,
                -Math.PI * 0.5 + charge * 2 * Math.PI
            );
            ctx.stroke();
            ctx.fillStyle = hold
                ? "rgba(103,232,249,.9)"
                : "rgba(255,255,255,.15)";
            ctx.fillRect(cx - 60, cy + R + 28, 120, 18);
            ctx.fillStyle = "#cfe7ff";
            ctx.font = "600 12px JetBrains Mono";
            ctx.textAlign = "center";
            ctx.fillText("F", cx, cy + R + 42);
            requestAnimationFrame(draw);
        }

        function cleanup() {
            document.removeEventListener("keydown", kd, true);
            document.removeEventListener("keyup", ku, true);
            destroy();
            ov.remove();
        }
        function success() {
            emit("tpb:trial:success", "power");
            cleanup();
            resolve(true);
        }
        function fail() {
            emit("tpb:trial:fail", "power");
            cleanup();
            reject("timeout");
        }

        quit.onclick = () => {
            emit("tpb:trial:abort", "power");
            cleanup();
            reject("abort");
        };
        go.onclick = () => {
            if (started) return;
            started = true;
            go.disabled = true;
            c.focus();
        };
        requestAnimationFrame(draw);
    });
}

// SURVIVAL — RESONANCE LOCK (←/→ rotate, L to lock) — FIXED
function trialSurvival() {
    const LIMIT = 14,
        LOCKS = 3,
        TOL = (12 * Math.PI) / 180;
    return new Promise((resolve, reject) => {
        const ui = openTrialOverlay(
            "SURVIVAL // RESONANCE LOCK",
            "Rotate with ←/→. Press L when the needle aligns with a glowing marker. Lock 3 before time expires.",
            LIMIT
        );
        const { ov, wrap, c, ctx, resize, timerEl, quit, go, destroy } = ui;
        let started = false,
            last = 0,
            ttl = LIMIT;
        let needle = -Math.PI / 2,
            dir = 0;
        const omega = 0.9,
            speed = 2.6;
        const base = [30, 165, 300].map((d) => (d * Math.PI) / 180);
        const locked = [false, false, false];
        let flash = 0,
            shake = 0;

        const kd = (e) => {
            if (!started) return;
            if (e.key === "ArrowLeft") {
                dir = -1;
                e.preventDefault();
            }
            if (e.key === "ArrowRight") {
                dir = +1;
                e.preventDefault();
            }
            const k = e.key?.toLowerCase?.();
            if (k === "l") {
                e.preventDefault();
                const t = (last || performance.now()) / 1000;
                const targets = base
                    .map((b, i) => ({ i, ang: b + omega * t, lock: locked[i] }))
                    .filter((o) => !o.lock);
                if (!targets.length) return;
                const norm = (a) => ((a + Math.PI) % (2 * Math.PI)) - Math.PI;
                targets.sort(
                    (a, b) =>
                        Math.abs(norm(a.ang - needle)) -
                        Math.abs(norm(b.ang - needle))
                );
                const best = targets[0];
                const diff = Math.abs(norm(best.ang - needle));
                if (diff <= TOL) {
                    locked[best.i] = true;
                    flash = 1;
                    if (locked.every(Boolean)) return success();
                } else {
                    shake = 8;
                }
            }
        };
        const ku = (e) => {
            if (!started) return;
            if (e.key === "ArrowLeft" && dir < 0) dir = 0;
            if (e.key === "ArrowRight" && dir > 0) dir = 0;
        };

        // Capture at document level so no extra click is needed
        document.addEventListener("keydown", kd, true);
        document.addEventListener("keyup", ku, true);

        function draw(ts) {
            const dt = last ? (ts - last) / 1000 : 0;
            last = ts;
            const { width: w, height: h } = resize();
            const cx = w * 0.5,
                cy = h * 0.56;
            const R = Math.min(w, h) * 0.24;
            if (started) {
                needle += dir * speed * dt;
                ttl = Math.max(0, ttl - dt);
                timerEl.textContent =
                    "00:" + String(Math.ceil(ttl)).padStart(2, "0");
                if (ttl <= 0) return fail();
            }
            flash = Math.max(0, flash - dt * 2.6);
            shake = Math.max(0, shake - dt * 28);
            const sx = (Math.random() * 2 - 1) * (shake > 0 ? shake : 0);
            const sy = (Math.random() * 2 - 1) * (shake > 0 ? shake : 0);
            ctx.setTransform(1, 0, 0, 1, sx, sy);
            ctx.clearRect(-sx, -sy, w, h);

            ctx.strokeStyle = "rgba(255,255,255,.10)";
            ctx.lineWidth = 10;
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.stroke();

            const t = ts / 1000;
            base.forEach((b, i) => {
                const a = b + omega * t;
                const on = !locked[i];
                if (on) {
                    ctx.strokeStyle = "rgba(103,232,249,.25)";
                    ctx.lineWidth = 10;
                    ctx.beginPath();
                    ctx.arc(cx, cy, R, a - 0.16, a + 0.16);
                    ctx.stroke();
                }
                ctx.fillStyle = locked[i]
                    ? "rgba(103,232,249,.95)"
                    : "rgba(255,255,255,.8)";
                ctx.beginPath();
                ctx.arc(
                    cx + Math.cos(a) * R,
                    cy + Math.sin(a) * R,
                    locked[i] ? 5 : 4,
                    0,
                    Math.PI * 2
                );
                ctx.fill();
            });

            if (flash > 0) {
                ctx.strokeStyle = `rgba(103,232,249,${flash})`;
                ctx.lineWidth = 16 * flash;
                ctx.beginPath();
                ctx.arc(cx, cy, R + 8, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(needle);
            ctx.strokeStyle = "#eaf1ff";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(R + 14, 0);
            ctx.stroke();
            ctx.restore();

            ctx.fillStyle = "#cfe7ff";
            ctx.font = "600 12px JetBrains Mono";
            ctx.textAlign = "center";
            const got = locked.filter(Boolean).length;
            ctx.fillText(`Locks: ${got}/${LOCKS}`, cx, cy + R + 36);

            requestAnimationFrame(draw);
        }

        function cleanup() {
            document.removeEventListener("keydown", kd, true);
            document.removeEventListener("keyup", ku, true);
            destroy();
            ov.remove();
        }
        function success() {
            emit("tpb:trial:success", "survival");
            cleanup();
            resolve(true);
        }
        function fail() {
            emit("tpb:trial:fail", "survival");
            cleanup();
            reject("timeout");
        }

        quit.onclick = () => {
            emit("tpb:trial:abort", "survival");
            cleanup();
            reject("abort");
        };
        go.onclick = () => {
            if (started) return;
            started = true;
            go.disabled = true;
            c.focus();
        };
        requestAnimationFrame(draw);
    });
}

async function runTrial(key) {
    if (key === "beauty") return trialBeauty();
    if (key === "power") return trialPower();
    if (key === "survival") return trialSurvival();
    return true;
}

/* ================= p5 GENERATIVE STUDIO ================= */
const P5_URL = "https://cdn.jsdelivr.net/npm/p5@1.9.3/lib/p5.min.js";
let p5Ready;
function loadP5() {
    if (window.p5) return Promise.resolve();
    if (!p5Ready) {
        p5Ready = new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = P5_URL;
            s.async = true;
            s.onload = res;
            s.onerror = rej;
            document.head.appendChild(s);
        });
    }
    return p5Ready;
}

let currentSketch = null;
async function openArtStudio(key) {
    await loadP5();
    emit("tpb:studio:open");
    const overlay = document.createElement("div");
    overlay.className = "art-overlay";
    overlay.innerHTML = `
    <div class="art-wrap">
      <div class="art-head"><div class="title">GENERATIVE CAPTURE // ${key.toUpperCase()}</div><div class="mono" id="seedLabel"></div></div>
      <div class="art-body"><div class="art-mount" id="artMount"></div></div>
      <div class="art-foot"><button class="art-btn art-close">Close</button><button class="art-btn" id="btnNew">New Variation</button><button class="art-btn" id="btnSave">Download PNG</button></div>
    </div>`;
    document.body.appendChild(overlay);
    const mount = overlay.querySelector("#artMount");
    const seedLabel = overlay.querySelector("#seedLabel");
    const btnClose = overlay.querySelector(".art-close");
    const btnNew = overlay.querySelector("#btnNew");
    const btnSave = overlay.querySelector("#btnSave");
    let seed = Math.floor(Math.random() * 1e9);
    const setSeed = () => (seedLabel.textContent = `SEED:${seed}`);
    function launch() {
        if (currentSketch) {
            currentSketch.remove();
            currentSketch = null;
        }
        setSeed();
        currentSketch = makeSketch(key, mount, seed);
    }
    btnClose.onclick = () => {
        currentSketch?.remove();
        overlay.remove();
        emit("tpb:studio:close");
    };
    btnNew.onclick = () => {
        seed = Math.floor(Math.random() * 1e9);
        launch();
        emit("tpb:studio:new", { key, seed });
    };
    btnSave.onclick = () => {
        currentSketch?.saveCanvas(`${key}_${seed}`, "png");
        emit("tpb:studio:save", { key, seed });
    };
    launch();
}

function makeSketch(key, mount, seed) {
    const palettes = {
        beauty: ["#ff2e63", "#ff7096", "#ffd1dc", "#fff3f9"],
        power: ["#ffd166", "#fff2a0", "#ffeb70", "#ffffff"],
        survival: ["#67e8f9", "#9beefb", "#c9fbff", "#ffffff"],
    };
    const bg = "#070a0f";
    const cols = palettes[key] || ["#ffffff"];
    const sketch = (p) => {
        let W = 800,
            H = 520,
            t = 0;
        p.setup = () => {
            const r = mount.getBoundingClientRect();
            W = Math.max(300, r.width);
            H = Math.max(240, r.height);
            p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
            p.createCanvas(W, H).parent(mount);
            p.noFill();
            p.strokeCap(p.ROUND);
            p.randomSeed(seed);
            p.noiseSeed(seed);
            p.background(bg);
        };
        p.windowResized = () => {
            const r = mount.getBoundingClientRect();
            W = Math.max(300, r.width);
            H = Math.max(240, r.height);
            p.resizeCanvas(W, H);
            p.background(bg);
            t = 0;
        };
        const drawBeauty = () => {
            const cx = W * 0.5,
                cy = H * 0.5,
                R = Math.min(W, H) * 0.36,
                golden = p.PI * (3 - Math.sqrt(5));
            p.push();
            p.translate(cx, cy);
            p.push();
            p.blendMode(p.ADD);
            const g = p.drawingContext.createRadialGradient(
                0,
                0,
                R * 0.15,
                0,
                0,
                R * 1.25
            );
            g.addColorStop(0, "rgba(255,255,255,.06)");
            g.addColorStop(1, "rgba(255,255,255,0)");
            p.drawingContext.fillStyle = g;
            p.noStroke();
            p.rect(-W, -H, W * 2, H * 2);
            p.pop();
            p.noFill();
            for (let L = 0; L < 5; L++) {
                const k = 5 / 7 + 0.02 * Math.sin(t * 0.0012 + L);
                const S = R * (0.72 + L * 0.045);
                const col = p.color(cols[L % cols.length]);
                col.setAlpha(150 - L * 18);
                p.stroke(col);
                p.strokeWeight(1.35 - L * 0.18);
                p.beginShape();
                for (let a = 0; a < p.TWO_PI * 7; a += 0.012) {
                    const wob = 0.86 + 0.14 * Math.sin(a * 3 + t * 0.002 + L);
                    const r = S * Math.sin(k * a) * wob;
                    p.curveVertex(r * Math.cos(a), r * Math.sin(a));
                }
                p.endShape();
            }
            p.stroke(255, 36);
            p.strokeWeight(1);
            const petals = 8;
            for (let i = 0; i < petals; i++) {
                const a = (i / petals) * p.TWO_PI + t * 0.0006;
                const rr = R * (1.02 + 0.03 * Math.sin(t * 0.0018 + i));
                p.arc(0, 0, rr * 2, rr * 2, a - 0.55, a + 0.55);
            }
            p.blendMode(p.ADD);
            const buds = 140;
            for (let i = 0; i < buds; i++) {
                const rad = R * (0.12 + 0.85 * Math.sqrt(i / buds));
                const ang = i * golden + t * 0.00025;
                const x = rad * Math.cos(ang),
                    y = rad * Math.sin(ang);
                const tw = 0.5 + 0.5 * Math.sin(t * 0.002 + i * 1.7);
                const c = p.color(cols[i % cols.length]);
                c.setAlpha(28 + tw * 40);
                p.noStroke();
                p.fill(c);
                p.circle(x, y, 1.2 + tw * 3.2);
            }
            p.blendMode(p.BLEND);
            p.noFill();
            p.stroke(255, 22);
            p.strokeWeight(1);
            p.circle(0, 0, R * 2.06);
            p.pop();
        };
        const drawPower = () => {
            p.blendMode(p.ADD);
            const step = 18;
            for (let x = step * 2; x < W - step * 2; x += step) {
                const n = p.noise(x * 0.01, t * 0.0018);
                const h = H * (0.15 + 0.7 * n);
                p.stroke(cols[(x / step) % cols.length]);
                p.strokeWeight(1.2);
                p.line(x, H * 0.5 - h * 0.5, x, H * 0.5 + h * 0.5);
                if (p.random() < 0.08) {
                    const y = H * 0.5 + (p.random() - 0.5) * h;
                    p.line(x - 8, y, x + 8, y);
                }
            }
            p.blendMode(p.BLEND);
        };
        const drawSurvival = () => {
            const count = 1200;
            p.stroke(255, 28);
            p.strokeWeight(0.6);
            for (let i = 0; i < count; i++) {
                let px = p.random(W),
                    py = p.random(H);
                for (let k = 0; k < 12; k++) {
                    const a =
                        p.noise(px * 0.003, py * 0.003, t * 0.0008) *
                        p.TWO_PI *
                        2;
                    const nx = px + p.cos(a) * 2.2,
                        ny = py + p.sin(a) * 2.2;
                    p.stroke(cols[(i + k) % cols.length]);
                    p.line(px, py, nx, ny);
                    px = nx;
                    py = ny;
                }
            }
        };
        p.draw = () => {
            t += p.deltaTime;
            p.fill(7, 10, 16, 22);
            p.noStroke();
            p.rect(0, 0, W, H);
            if (key === "beauty") drawBeauty();
            else if (key === "power") drawPower();
            else drawSurvival();
            p.noFill();
            p.stroke(255, 12);
            p.strokeWeight(1);
            p.rect(6, 6, W - 12, H - 12, 8);
        };
    };
    return new window.p5(sketch);
}
window.TPB_STUDIO = { open: openArtStudio };

/* -------- Progress chips + combine (single source of truth) -------- */
(function progressAndCombine() {
    let combineBtn = null;
    let PB = { track: null, fill: null };
    let animPct = 0,
        rafId = 0;

    function installProgressBar() {
        const unlockSection =
            $("#combineBtn")?.closest(".unlock") || $(".unlock");
        if (!unlockSection) return { track: null, fill: null };
        let track = unlockSection.querySelector("#tpb-progress");
        if (!track) {
            track = document.createElement("div");
            track.id = "tpb-progress";
            track.className = "tpb-progress";
            const fill = document.createElement("div");
            fill.id = "tpb-progress-fill";
            fill.className = "tpb-progress-fill";
            track.appendChild(fill);
            if ($("#combineBtn"))
                unlockSection.insertBefore(track, $("#combineBtn"));
            else unlockSection.appendChild(track);
        }
        return {
            track,
            fill: unlockSection.querySelector("#tpb-progress-fill"),
        };
    }

    function setSteps(n) {
        const target = clamp(n / 3, 0, 1);
        if (!PB.fill) return;
        if (rafId) cancelAnimationFrame(rafId);
        const start = animPct,
            t0 = performance.now(),
            DUR = 520;
        const tick = (now) => {
            const t = clamp((now - t0) / DUR, 0, 1);
            animPct = start + (target - start) * ease(t);
            PB.fill.style.width = (animPct * 100).toFixed(3) + "%";
            if (t < 1) rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
    }
    function refresh() {
        ["beauty", "power", "survival"].forEach((k) => {
            const el = $("#p_" + k);
            if (!el) return;
            const done = visited.has(k);
            el.classList.toggle("done", done);
            el.setAttribute("aria-checked", done ? "true" : "false");
        });
        setSteps(visited.size);
        const unlocked = visited.size === 3;
        if (combineBtn) {
            combineBtn.disabled = !unlocked;
            combineBtn.setAttribute(
                "aria-disabled",
                unlocked ? "false" : "true"
            );
            combineBtn.classList.toggle("armed", unlocked);
            combineBtn.textContent = unlocked
                ? "COMBINE ▸"
                : "COMBINE PROTOCOL ▸";
            if (unlocked) emit("tpb:combine:armed");
        }
    }

    async function engage(key) {
        try {
            await runTrial(key);
        } catch {
            return;
        }
        visited.add(key);
        persistVisited();
        refresh();
        emit("tpb:engage", { key });
        await openArtStudio(key);
    }

    function wireCards() {
        $$(".card[data-key]").forEach((card) => {
            if (card.dataset.wired === "1") return;
            const key = card.dataset.key;
            const btn = card.querySelector(".choose");
            if (!key || !btn) return;
            const clone = btn.cloneNode(true);
            btn.replaceWith(clone);
            clone.addEventListener("click", () => engage(key));
            card.addEventListener("keydown", (e) => {
                if (e.key === "Enter") engage(key);
            });
            card.addEventListener("mouseenter", () =>
                emit("tpb:hover", { key })
            );
            card.dataset.wired = "1";
        });
    }

    onReady(() => {
        combineBtn = $("#combineBtn");
        PB = installProgressBar();
        wireCards();
        refresh();
        const attachCombine = () => {
            const btn = $("#combineBtn");
            if (!btn || btn.dataset.wired === "1") return;
            btn.addEventListener("click", () => {
                if (visited.size < 3) return;
                emit("tpb:toAct3");
                sessionStorage.setItem("tpb_vector_mode", "combine");
                sessionStorage.setItem(
                    "tpb_progress",
                    JSON.stringify({ visited: [...visited] })
                );
                persistVisited();
                window.location.href = ROUTE_COMBINE;
            });
            btn.dataset.wired = "1";
        };
        attachCombine();
        new MutationObserver(() => {
            PB = PB.fill ? PB : installProgressBar();
            wireCards();
            attachCombine();
        }).observe(document.body, { childList: true, subtree: true });
    });

    window.addEventListener("tpb:trial:success", (e) => {
        const key = typeof e.detail === "string" ? e.detail : e.detail?.key;
        if (!VALID_KEYS.has(key)) return;
        visited.add(key);
        persistVisited();
        refresh();
    });
    window.addEventListener("storage", (ev) => {
        if (ev.key !== "tpb_progress") return;
        const next = readVisited();
        const a = [...next].sort().join("|"),
            b = [...visited].sort().join("|");
        if (a !== b) {
            visited.clear();
            next.forEach((x) => visited.add(x));
            refresh();
        }
    });
})();

(function sfxBridge() {
    const S = window.SFX || window.TPB_SFX || null;
    const unlock = async () => {
        try {
            await S?.init?.();
            await S?.unlock?.();
        } catch {}
        emit("tpb:unlock");
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener(
        "keydown",
        (e) => {
            const k = e.key?.toLowerCase?.();
            if (k === "enter" || k === "e") {
                e.preventDefault();
                unlock();
            }
        },
        { once: true }
    );
    if (S) {
        window.addEventListener("tpb:hover", (e) =>
            S.onCardHover?.(e.detail?.key)
        );
        window.addEventListener("tpb:engage", (e) =>
            S.onEngage?.(e.detail?.key)
        );
        window.addEventListener("tpb:combine:armed", () =>
            S.onCombineArmed?.()
        );
        window.addEventListener("tpb:studio:open", () => S.onStudioOpen?.());
        window.addEventListener("tpb:studio:close", () => S.onStudioClose?.());
        window.addEventListener("tpb:toAct3", () => S.toAct3?.());
        window.addEventListener("tpb:trial:open", (e) =>
            S.onTrialOpen?.(e.detail)
        );
        window.addEventListener("tpb:trial:success", (e) =>
            S.onTrialSuccess?.(e.detail)
        );
        window.addEventListener("tpb:trial:fail", (e) =>
            S.onTrialFail?.(e.detail)
        );
    }
})();
