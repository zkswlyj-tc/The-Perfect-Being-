import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

/* =============================================================================
   S F X   E N G I N E  
   ========================================================================== */
const SFX = (() => {
    let armed = false;
    let p = null;

    // busses
    let master, ambBus, sfxBus;
    let ambNoise = null,
        ambOsc = null,
        ambPan = null,
        ambFilter = null;
    let ambTicker = null;
    let warnTones = null;
    let loaderPromise = null;

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    function loadScript(src) {
        return new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = true;
            s.onload = res;
            s.onerror = rej;
            document.head.appendChild(s);
        });
    }

    async function ensureLibs() {
        if (window.p5 && window.p5.SoundFile) return;
        if (!loaderPromise) {
            loaderPromise = (async () => {
                if (!window.p5)
                    await loadScript(
                        "https://cdn.jsdelivr.net/npm/p5@1.9.3/lib/p5.min.js"
                    );
                if (!window.p5?.SoundFile)
                    await loadScript(
                        "https://cdn.jsdelivr.net/npm/p5@1.9.3/lib/addons/p5.sound.min.js"
                    );
            })();
        }
        await loaderPromise;
    }

    function bootP5() {
        if (p) return;
        new window.p5((sk) => {
            sk.setup = () => {
                p = sk;
                sk.noCanvas();
            };
        });
    }

    async function unlock() {
        await ensureLibs();
        bootP5();
        if (armed) return;

        try {
            await p.userStartAudio();
        } catch {}
        if (!p?.getAudioContext()) return;

        master = new p5.Gain();
        ambBus = new p5.Gain();
        sfxBus = new p5.Gain();
        ambBus.disconnect();
        sfxBus.disconnect();
        ambBus.connect(master);
        sfxBus.connect(master);
        master.connect(p5.soundOut);
        master.amp(0.95);
        ambBus.amp(0.0);
        sfxBus.amp(1.0);
        ambienceStart(0.18);
        armed = true;
    }

    // ---------- ambience ----------
    function ambienceStart(target = 0.2) {
        if (!p || ambNoise) return;

        ambNoise = new p5.Noise("brown");
        ambOsc = new p5.Oscillator("sine");
        ambPan = new p5.Panner3D();
        ambFilter = new p5.Filter("lowpass");

        ambNoise.disconnect();
        ambOsc.disconnect();
        ambPan.disconnect?.();
        ambNoise.connect(ambFilter);
        ambOsc.connect(ambFilter);
        ambFilter.connect(ambPan);
        ambPan.connect(ambBus);

        ambNoise.amp(0);
        ambOsc.amp(0);
        ambNoise.start();
        ambOsc.start();
        ambOsc.freq(80);

        ambBus.amp(0, 0);
        ambBus.amp(target, 1.0);
        ambNoise.amp(0.18, 1.0);
        ambOsc.amp(0.06, 1.0);
        ambFilter.freq(850);

        ambTicker = setInterval(() => {
            const t = p.millis() * 0.001;
            ambPan.set(Math.sin(t * 0.25) * 0.6, 0, 0);
            ambOsc.freq(78 + Math.sin(t * 0.6) * 3);
        }, 60);
    }

    function ambienceStop(ms = 600) {
        if (!ambNoise) return;
        ambBus.amp(0.0, ms / 1000);
        setTimeout(() => {
            ambNoise.stop();
            ambNoise.dispose();
            ambNoise = null;
            ambOsc.stop();
            ambOsc.dispose();
            ambOsc = null;
            ambPan?.dispose?.();
            ambPan = null;
            ambFilter?.dispose?.();
            ambFilter = null;
            clearInterval(ambTicker);
            ambTicker = null;
        }, ms + 40);
    }

    function setIntensity(x) {
        if (!ambFilter) return;
        const u = clamp(x, 0, 1);
        const f = 700 + 1600 * u * u;
        ambFilter.freq(f, 0.12);
        ambNoise?.amp(0.14 + 0.1 * u, 0.12);
        ambOsc?.amp(0.05 + 0.06 * u, 0.12);
    }

    function beep({
        f = 880,
        type = "sine",
        dur = 0.08,
        g = 0.28,
        pan = 0,
    } = {}) {
        if (!armed) return;
        const o = new p5.Oscillator(type);
        const pa = new p5.Panner3D();
        o.disconnect();
        o.connect(pa);
        pa.connect(sfxBus);
        pa.set(Math.max(-1, Math.min(1, pan)), 0, 0);
        o.start();
        o.amp(0);
        o.freq(f);
        o.amp(g, dur * 0.25);
        o.amp(0.0001, dur * 0.75);
        setTimeout(() => {
            o.stop();
            o.dispose();
            pa.dispose?.();
        }, dur * 1000 + 40);
    }
    function noiseBurst({
        type = "white",
        bp = 2200,
        q = 10,
        dur = 0.12,
        g = 0.22,
    } = {}) {
        if (!armed) return;
        const n = new p5.Noise(type);
        const f = new p5.Filter("bandpass");
        n.disconnect();
        n.connect(f);
        f.connect(sfxBus);
        f.freq(bp);
        f.res(q);
        n.start();
        n.amp(0);
        n.amp(g, 0.02);
        n.amp(0.0001, dur * 0.8);
        setTimeout(() => {
            n.stop();
            n.dispose();
            f.dispose?.();
        }, dur * 1000 + 50);
    }
    function sweepWhoosh({ from = 400, to = 3200, dur = 1.4, g = 0.24 } = {}) {
        if (!armed) return;
        const n = new p5.Noise("pink");
        const f = new p5.Filter("bandpass");
        n.disconnect();
        n.connect(f);
        f.connect(sfxBus);
        n.start();
        n.amp(0);
        n.amp(g, 0.08);
        const t0 = p.millis();
        const L = dur * 1000;
        const iv = setInterval(() => {
            const u = Math.max(0, Math.min(1, (p.millis() - t0) / L));
            f.freq(from + (to - from) * Math.pow(u, 0.85));
            f.res(12 - 6 * u);
            if (u >= 1) {
                clearInterval(iv);
                n.amp(0.0001, 0.18);
            }
        }, 14);
        setTimeout(() => {
            n.stop();
            n.dispose();
            f.dispose?.();
        }, L + 200);
    }
    function duck(ms = 300, depth = 0.65) {
        if (!ambBus) return;
        const current = ambBus.input ? ambBus.input.gain.value : 0.2;
        ambBus.amp(current * (1 - depth), 0.05);
        setTimeout(() => ambBus.amp(current, 0.28), ms);
    }

    const api = {
        async arm() {
            await unlock();
        },
        ui(tag = "generic") {
            const f =
                tag === "save"
                    ? 1040
                    : tag === "enter"
                    ? 700
                    : tag === "replay"
                    ? 820
                    : 560;
            beep({ f, type: "triangle", dur: 0.055, g: 0.24 });
        },
        typeTick() {
            beep({
                f: 260 + Math.random() * 120,
                type: "square",
                dur: 0.02,
                g: 0.12,
                pan: (Math.random() - 0.5) * 0.5,
            });
        },
        shock() {
            duck(380, 0.5);
            noiseBurst({ type: "white", bp: 3800, q: 5, dur: 0.09, g: 0.26 });
            beep({ f: 1400, type: "square", dur: 0.05, g: 0.22 });
        },
        disperse() {
            sweepWhoosh({});
            beep({ f: 920, type: "sine", dur: 0.08, g: 0.22 });
        },
        snapshot() {
            duck(260, 0.4);
            beep({ f: 1800, type: "square", dur: 0.035, g: 0.22 });
            noiseBurst({ type: "white", bp: 4200, q: 8, dur: 0.06, g: 0.16 });
        },
        crt() {
            duck(260, 0.5);
            const o = new p5.Oscillator("triangle");
            o.disconnect();
            o.connect(sfxBus);
            o.start();
            o.freq(700);
            o.amp(0.0);
            o.amp(0.22, 0.06);
            o.freq(1800, 0.12);
            setTimeout(() => {
                o.freq(100, 0.16);
                o.amp(0, 0.12);
                noiseBurst({ bp: 1600, q: 8, dur: 0.06, g: 0.1 });
            }, 140);
            setTimeout(() => {
                o.stop();
                o.dispose();
            }, 360);
        },
        warnOn() {
            if (warnTones) return;
            const hi = new p5.Oscillator("square");
            const lo = new p5.Oscillator("sawtooth");
            hi.disconnect();
            lo.disconnect();
            hi.connect(sfxBus);
            lo.connect(sfxBus);
            hi.start();
            lo.start();
            hi.amp(0);
            lo.amp(0);
            let on = true;
            const flip = () => {
                if (!warnTones) return;
                on = !on;
                const fhi = on ? 1160 : 880,
                    flo = on ? 300 : 220;
                hi.freq(fhi, 0.02);
                lo.freq(flo, 0.02);
                hi.amp(on ? 0.22 : 0.16, 0.04);
                lo.amp(on ? 0.12 : 0.1, 0.04);
            };
            const iv = setInterval(flip, 420);
            flip();
            warnTones = { hi, lo, iv };
        },
        warnOff() {
            if (!warnTones) return;
            clearInterval(warnTones.iv);
            warnTones.hi.stop();
            warnTones.lo.stop();
            warnTones.hi.dispose();
            warnTones.lo.dispose();
            warnTones = null;
        },
        intensity(x) {
            setIntensity(x);
        },
        blackout() {
            api.warnOff();
            ambienceStop(500);
            beep({ f: 420, type: "sine", dur: 0.13, g: 0.2 });
        },
        rearm() {
            beep({ f: 760, type: "triangle", dur: 0.06, g: 0.2 });
        },
        stopAll() {
            api.warnOff();
            ambienceStop(200);
        },
    };

    ["pointerdown", "keydown", "touchstart"].forEach((evt) => {
        window.addEventListener(evt, () => api.arm(), {
            once: true,
            passive: true,
        });
    });

    return api;
})();

/* =============================================================================
   U I   H E L P E R S
   ========================================================================== */
const $ = (s, c = document) => c.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutQuad = (t) =>
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/* =============================================================================
   T Y P E D   I N T R O
   ========================================================================== */
(async function typeNovel() {
    const root = $("#novel");
    const enter = $("#enter");
    const lines = [...root.querySelectorAll(".line")];
    for (const el of lines) {
        const text = el.dataset.text || el.textContent || "";
        el.textContent = "";
        el.classList.add("show");
        for (let i = 0; i < text.length; i++) {
            el.textContent = text.slice(0, i + 1);
            if ((i & 1) === 0) SFX.typeTick();
            await wait(14 + Math.random() * 12);
        }
        await wait(140);
    }
    enter.removeAttribute("disabled");
})();

/* =============================================================================
   S T A R S   +   S H O C K   R I N G S
   ========================================================================== */
const SHOCK_RINGS = [];
(function stars() {
    const c = $("#stars");
    const ctx = c.getContext("2d");
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    const stars = [];
    function resize() {
        c.width = Math.floor(innerWidth * DPR);
        c.height = Math.floor(innerHeight * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        if (!stars.length) {
            const N = Math.max(260, ((innerWidth * innerHeight) / 7000) | 0);
            for (let i = 0; i < N; i++) {
                stars.push({
                    x: Math.random() * innerWidth,
                    y: Math.random() * innerHeight,
                    r: Math.random() * 1.2 + 0.25,
                    a: Math.random() * Math.PI * 2,
                    v: 0.06 + Math.random() * 0.25,
                });
            }
        }
    }
    function ringGradient(x, y, r) {
        const g = ctx.createRadialGradient(x, y, r * 0.65, x, y, r);
        g.addColorStop(0, "rgba(255,255,255,0.10)");
        g.addColorStop(1, "rgba(255,255,255,0.00)");
        return g;
    }
    function tick(t) {
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
            ctx.fillStyle = `rgba(255,255,255,${0.04 + tw * 0.28})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r * (0.6 + tw * 0.5), 0, Math.PI * 2);
            ctx.fill();
        }
        for (let i = SHOCK_RINGS.length - 1; i >= 0; i--) {
            const R = SHOCK_RINGS[i];
            R.t += 1 / 60;
            const life = clamp(1 - R.t / R.max, 0, 1);
            const rad = R.start + (R.end - R.start) * (1 - life);
            ctx.globalAlpha = 0.9 * life;
            ctx.strokeStyle = "rgba(255,255,255,0.35)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(R.x, R.y, rad, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillStyle = ringGradient(R.x, R.y, rad * 1.2);
            ctx.beginPath();
            ctx.arc(R.x, R.y, rad * 1.2, 0, Math.PI * 2);
            ctx.fill();
            if (life <= 0) SHOCK_RINGS.splice(i, 1);
        }
        requestAnimationFrame(tick);
    }
    resize();
    addEventListener("resize", resize, { passive: true });
    requestAnimationFrame(tick);
})();
function shock(x, y) {
    SHOCK_RINGS.push({
        x,
        y,
        t: 0,
        max: 1.1,
        start: 20,
        end: Math.max(innerWidth, innerHeight) * 0.6,
    });
    SFX.shock();
    if (navigator.vibrate) navigator.vibrate(40);
}

/* =============================================================================
   T H R E E . J S   S T A G E
   ========================================================================== */
const container = $("#viewport");
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b0f14, 0.018);

const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
let baseCamZ = 2.05;
const baseFov = 42;
camera.fov = baseFov;
camera.position.set(0, 0.0, baseCamZ);

function centerAndFrame(points, padding = 1.18) {
    const geom = points.geometry;
    geom.computeBoundingBox();
    const box = geom.boundingBox;
    const ctr = box.getCenter(new THREE.Vector3());
    const pos = geom.getAttribute("position");
    const home = geom.getAttribute("home");
    for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(
            i,
            pos.getX(i) - ctr.x,
            pos.getY(i) - ctr.y,
            pos.getZ(i) - ctr.z
        );
        home.setXYZ(
            i,
            home.getX(i) - ctr.x,
            home.getY(i) - ctr.y,
            home.getZ(i) - ctr.z
        );
    }
    pos.needsUpdate = true;
    home.needsUpdate = true;
    geom.computeBoundingBox();
    geom.computeBoundingSphere();

    points.position.set(0, 0, 0);
    root.position.set(0, 0, 0);

    const size = new THREE.Vector3();
    geom.boundingBox.getSize(size);
    const fovY = THREE.MathUtils.degToRad(camera.fov);
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * camera.aspect);
    const distY = size.y / 2 / Math.tan(fovY / 2);
    const distX = size.x / 2 / Math.tan(fovX / 2);
    const dist = Math.max(distX, distY) * padding;

    baseCamZ = dist;
    camTargetZ = dist;
    camera.position.set(0, 0, dist);
    camera.updateProjectionMatrix();
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.domElement.classList.add("three-canvas"); // <- CSS handles sizing
container.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x0a0a10, 0.55));
const root = new THREE.Group();
scene.add(root);

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
    const x = c.getContext("2d");
    x.fillStyle = g;
    x.beginPath();
    x.arc(N / 2, N / 2, N / 2, 0, Math.PI * 2);
    x.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}
const SPRITE = makeSoftCircle();
function pointsMat(size = 0.034, opacity = 0.96) {
    const m = new THREE.PointsMaterial({
        size,
        map: SPRITE,
        transparent: true,
        depthWrite: false,
        alphaTest: 0.02,
        blending: THREE.AdditiveBlending,
        color: 0xffffff,
        opacity,
        sizeAttenuation: true,
        vertexColors: true,
        fog: true,
    });
    m.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        m.userData.shader = shader;
        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                "#include <common>\nuniform float uTime;"
            )
            .replace(
                "#include <fog_vertex>",
                `
        gl_PointSize *= (1.25 + 0.35*sin(uTime*1.1 + dot(position.xy, vec2(12.9898,78.233))));
        #include <fog_vertex>
      `
            );
    };
    m.needsUpdate = true;
    return m;
}

async function buildGeomFromFBX(url, { target = 120000, fit = 1.55 } = {}) {
    const fbx = await new Promise((res, rej) =>
        new FBXLoader().load(url, res, undefined, rej)
    );
    const P = [],
        N = [],
        R = [];
    const v = new THREE.Vector3(),
        n = new THREE.Vector3();
    fbx.updateMatrixWorld(true);
    fbx.traverse((o) => {
        const g = o.isSkinnedMesh ? o.geometry : o.isMesh ? o.geometry : null;
        if (!g?.attributes?.position) return;
        const pos = g.attributes.position,
            nor = g.attributes.normal;
        const step = Math.max(1, Math.floor(pos.count / (target / 2)));
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
        for (let i = 0; i < pos.count; i += step) {
            v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            if (nor) {
                n.fromBufferAttribute(nor, Math.min(i, nor.count - 1));
                n.applyMatrix3(normalMatrix).normalize();
            } else n.copy(v).normalize();
            P.push(v.x, v.y, v.z);
            N.push(n.x, n.y, n.z);
            R.push(Math.random());
        }
    });
    if (!P.length) throw new Error("No vertices sampled from FBX");

    const posAttr = new THREE.Float32BufferAttribute(P, 3);
    const box = new THREE.Box3().setFromBufferAttribute(posAttr);
    const diag = box.getSize(new THREE.Vector3()).length() || 1;
    const ctr = box.getCenter(new THREE.Vector3());
    const s = fit / diag;
    for (let i = 0; i < posAttr.count; i++) {
        posAttr.setXYZ(
            i,
            (posAttr.getX(i) - ctr.x) * s,
            (posAttr.getY(i) - ctr.y) * s,
            (posAttr.getZ(i) - ctr.z) * s
        );
    }
    const homeAttr = posAttr.clone();

    const dirArr = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
        const px = homeAttr.getX(i),
            py = homeAttr.getY(i),
            pz = homeAttr.getZ(i);
        const radial = new THREE.Vector3(px, py, pz).normalize();
        const nx = N[i * 3] ?? radial.x,
            ny = N[i * 3 + 1] ?? radial.y,
            nz = N[i * 3 + 2] ?? radial.z;
        const normal = new THREE.Vector3(nx, ny, nz).normalize();
        const dir = radial
            .multiplyScalar(0.55)
            .add(normal.multiplyScalar(0.45))
            .normalize();
        dirArr.set([dir.x, dir.y, dir.z], i * 3);
    }

    let maxR = 0;
    for (let i = 0; i < homeAttr.count; i++) {
        maxR = Math.max(
            maxR,
            Math.hypot(homeAttr.getX(i), homeAttr.getY(i), homeAttr.getZ(i))
        );
    }
    const colors = new Float32Array(homeAttr.count * 3);
    for (let i = 0; i < homeAttr.count; i++) {
        const r =
            Math.hypot(homeAttr.getX(i), homeAttr.getY(i), homeAttr.getZ(i)) /
            maxR;
        const t = Math.max(0, Math.min(1, r));
        const warm = [1.0, 0.82, 0.74],
            mid = [1, 1, 1],
            cool = [0.72, 0.92, 1.0];
        let Rm, Gm, Bm;
        if (t < 0.45) {
            const u = t / 0.45;
            Rm = warm[0] + (mid[0] - warm[0]) * u;
            Gm = warm[1] + (mid[1] - warm[1]) * u;
            Bm = warm[2] + (mid[2] - warm[2]) * u;
        } else {
            const u = (t - 0.45) / 0.55;
            Rm = mid[0] + (cool[0] - mid[0]) * u;
            Gm = mid[1] + (cool[1] - mid[1]) * u;
            Bm = mid[2] + (cool[2] - mid[2]) * u;
        }
        colors.set([Rm, Gm, Bm], i * 3);
    }
    const delay = new Float32Array(homeAttr.count);
    const rand = new Float32Array(homeAttr.count);
    for (let i = 0; i < homeAttr.count; i++) {
        const r =
            Math.hypot(homeAttr.getX(i), homeAttr.getY(i), homeAttr.getZ(i)) /
            maxR;
        const rv = Math.random();
        delay[i] = 0.1 + 0.55 * r + 0.25 * rv;
        rand[i] = rv;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", posAttr);
    geom.setAttribute("home", homeAttr);
    geom.setAttribute("dir", new THREE.BufferAttribute(dirArr, 3));
    geom.setAttribute("rand", new THREE.BufferAttribute(rand, 1));
    geom.setAttribute("delay", new THREE.BufferAttribute(delay, 1));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3, true));
    return geom;
}

/* =============================================================================
   A C T O R   /   T I M E L I N E
   ========================================================================== */
let cloud = null,
    tSec = 0,
    exploding = false,
    tStart = 0;
let camTargetZ = 2.05,
    camFovTarget = 42;

async function mountCloud() {
    try {
        const geom = await buildGeomFromFBX("asset/baby.fbx");
        cloud = new THREE.Points(geom, pointsMat());
        root.add(cloud);
    } catch (err) {
        console.warn("[Act3] FBX load failed, fallback:", err?.message || err);
        const g = new THREE.TorusKnotGeometry(0.6, 0.2, 560, 72).toNonIndexed();
        const pos = g.getAttribute("position");
        const home = pos.clone();
        const dirArr = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
            const v = new THREE.Vector3(
                home.getX(i),
                home.getY(i),
                home.getZ(i)
            ).normalize();
            dirArr.set([v.x, v.y, v.z], i * 3);
        }
        const delay = new Float32Array(pos.count)
            .fill(0)
            .map((_, i) => 0.15 + 0.75 * (i / pos.count));
        const rand = new Float32Array(pos.count)
            .fill(0)
            .map(() => Math.random());
        const colors = new Float32Array(pos.count * 3).fill(1);
        g.setAttribute("home", home);
        g.setAttribute("dir", new THREE.BufferAttribute(dirArr, 3));
        g.setAttribute("delay", new THREE.BufferAttribute(delay, 1));
        g.setAttribute("rand", new THREE.BufferAttribute(rand, 1));
        g.setAttribute("color", new THREE.BufferAttribute(colors, 3, true));
        cloud = new THREE.Points(g, pointsMat());
        root.add(cloud);
    }
}

function triggerDispersion() {
    if (!cloud) return;
    exploding = true;
    tStart = tSec;
    camTargetZ = 2.45;
    camFovTarget = 46;
    shock(innerWidth / 2, innerHeight / 2);
    document.body.animate(
        [
            { filter: "contrast(100%) brightness(100%)" },
            { filter: "contrast(160%) brightness(130%)" },
            { filter: "contrast(100%) brightness(100%)" },
        ],
        { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" }
    );
    SFX.disperse();
    scheduleEndSequence(3200);
}

function replay() {
    if (!cloud) return;
    const pos = cloud.geometry.getAttribute("position");
    const home = cloud.geometry.getAttribute("home");
    for (let i = 0; i < pos.count; i++)
        pos.setXYZ(i, home.getX(i), home.getY(i), home.getZ(i));
    pos.needsUpdate = true;
    cloud.material.opacity = 0.96;
    cloud.material.size = 0.034;
    camera.fov = 42;
    camera.updateProjectionMatrix();
    camera.position.z = 2.05;
    camTargetZ = 2.05;
    camFovTarget = 42;
    SFX.rearm();
    setTimeout(triggerDispersion, 380);
}

/* =============================================================================
   U I   W I R E U P
   ========================================================================== */
$("#enter").addEventListener("click", async () => {
    await SFX.arm();
    SFX.ui("enter");
    $("#novel").style.display = "none";
    $("#stage").hidden = false;
    await mountCloud();
    setTimeout(triggerDispersion, 420);
    $("#replay").disabled = false;
    $("#save").disabled = false;
});
$("#replay").addEventListener("click", () => {
    SFX.ui("replay");
    replay();
});
$("#save").addEventListener("click", () => {
    SFX.ui("save");
    SFX.snapshot();
    renderer.render(scene, camera);
    const a = document.createElement("a");
    a.download = `act3_${Date.now()}.png`;
    a.href = renderer.domElement.toDataURL("image/png");
    a.click();
});

/* =============================================================================
   T E L E M E T R Y
   ========================================================================== */
(function telem() {
    const el = $("#telemetry");
    const step = () => {
        const t = (performance.now() / 1000).toFixed(2);
        const v = (0.955 + Math.sin(performance.now() * 0.0006) * 0.03).toFixed(
            3
        );
        const hr = Math.round(108 + Math.sin(performance.now() * 0.0012) * 8);
        el.textContent = `ARCHIVE FINAL · T:${t}s · V:${v} · HR:${hr}`;
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
})();

/* =============================================================================
   A N I M A T E
   ========================================================================== */
new ResizeObserver(([e]) => {
    renderer.setSize(e.contentRect.width, e.contentRect.height, false);
    camera.aspect = e.contentRect.width / e.contentRect.height;
    camera.updateProjectionMatrix();
}).observe(container);

const clock = new THREE.Clock();
(function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    tSec += dt;
    root.rotation.y += dt * 0.1;
    camera.position.z += (camTargetZ - camera.position.z) * 0.04;
    camera.fov += (camFovTarget - camera.fov) * 0.04;
    camera.updateProjectionMatrix();

    if (cloud) {
        const sh = cloud.material.userData?.shader;
        if (sh) sh.uniforms.uTime.value = tSec;

        if (exploding) {
            const pos = cloud.geometry.getAttribute("position");
            const home = cloud.geometry.getAttribute("home");
            const dir = cloud.geometry.getAttribute("dir");
            const rnd = cloud.geometry.getAttribute("rand");
            const dly = cloud.geometry.getAttribute("delay");
            const T = tSec - tStart;

            let maxU = 0;
            for (let i = 0; i < pos.count; i++) {
                const t0 = T - dly.getX(i);
                const u = clamp(t0 / 1.35, 0, 1);
                const e = easeOutCubic(u);
                maxU = u > maxU ? u : maxU;

                const dist = e * (1.9 + 1.2 * rnd.getX(i));
                const swirl = Math.PI * 1.85 * e * (0.6 + 0.4 * rnd.getX(i));
                const s = Math.sin(swirl),
                    c = Math.cos(swirl);
                const hx = home.getX(i),
                    hy = home.getY(i),
                    hz = home.getZ(i);
                const dx = dir.getX(i),
                    dy = dir.getY(i),
                    dz = dir.getZ(i);
                let x = hx + dx * dist,
                    y = hy + dy * dist,
                    z = hz + dz * dist;
                const rx = x * c - z * s,
                    rz = x * s + z * c;
                const flutter =
                    Math.sin((hx + hz) * 3.0 + tSec * 1.3) *
                    0.06 *
                    (1.0 - e * 0.6);
                pos.setXYZ(i, rx, y + flutter, rz);
            }
            pos.needsUpdate = true;

            const k = clamp((tSec - tStart) / 2.0, 0, 1);
            cloud.material.opacity = 0.96 * (1.0 - 0.85 * k);
            cloud.material.size = 0.034 + 0.065 * easeInOutQuad(k);

            SFX.intensity(maxU);
        }
    }
    renderer.render(scene, camera);
})();

/* =============================================================================
   W A R N I N G   /   C R T   /   B L A C K O U T
   ========================================================================== */
let _endShown = false;
let _endTimer = null;

function addWarningFX() {
    if (document.getElementById("warnFX")) return;
    const w = document.createElement("div");
    w.id = "warnFX";
    w.className = "warn open";
    w.innerHTML = `<div class="veil"></div><div class="frame"></div><div class="txt">SYSTEM FAULT — CHANNEL UNSTABLE</div>`;
    document.body.appendChild(w);

    const start = performance.now();
    function shake() {
        const t = (performance.now() - start) / 1000;
        const k = Math.max(0, 1 - t * 1.0);
        container.style.transform = `translate(${
            (Math.random() - 0.5) * 8 * k
        }px, ${(Math.random() - 0.5) * 5 * k}px)`;
        if (k > 0.03) requestAnimationFrame(shake);
        else container.style.transform = "";
    }
    requestAnimationFrame(shake);
    if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
}
function clearWarningFX() {
    document.getElementById("warnFX")?.remove();
}

function showBlackout() {
    let b = document.getElementById("blackout");
    if (!b) {
        const year = new Date().getFullYear();
        b = document.createElement("div");
        b.id = "blackout";
        b.className = "blackout";
        b.innerHTML = `<div class="sig">© ${year} Tracy Tran · All rights reserved.</div>`;
        document.body.appendChild(b);
    }
    requestAnimationFrame(() => b.classList.add("open"));
}

function scheduleEndSequence(delayMs = 3200) {
    if (_endShown) return;
    if (_endTimer) clearTimeout(_endTimer);
    _endTimer = setTimeout(() => {
        if (!_endShown) runEndSequence();
    }, delayMs);
}

async function runEndSequence() {
    _endShown = true;

    const stars = document.getElementById("stars");
    const crt = document.createElement("div");
    crt.className = "crt-off run";
    document.body.appendChild(crt);

    renderer.domElement.style.transition = "opacity 680ms ease";
    stars.style.transition = "opacity 680ms ease";
    renderer.domElement.style.opacity = "0.10";
    stars.style.opacity = "0.08";

    const hud = document.getElementById("telemetry");
    if (hud) hud.textContent = "LINK LOST · CHANNEL CLOSED";
    SFX.crt();
    await wait(760);

    addWarningFX();
    SFX.warnOn();

    const ov = document.createElement("div");
    ov.className = "eol";
    ov.innerHTML = `
    <div class="box">
      <div class="line mono">// SYSTEM FAULT</div>
      <div class="line">Target state “perfection” does not converge.</div>
      <div class="line">Design optimizes. Life refuses to be solved.</div>
      <div class="line">Shutting down the machine that promised otherwise…</div>
      <div class="line"><strong>There is no perfect model. There is only you.</strong></div>
      <div class="actions">
        <button id="eolReplay">Replay dispersion</button>
        <button id="eolClose">Continue</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("open"));

    const rows = [...ov.querySelectorAll(".line")];
    for (let i = 0; i < rows.length; i++) {
        await wait(110 + i * 110);
        rows[i].classList.add("show");
    }

    const restore = () => {
        clearWarningFX();
        SFX.warnOff();
        ov.remove();
        crt.remove();
        renderer.domElement.style.opacity = "1";
        stars.style.opacity = "1";
        _endShown = false;
    };
    ov.querySelector("#eolReplay").onclick = () => {
        SFX.rearm();
        restore();
        replay();
    };
    ov.querySelector("#eolClose").onclick = () => {
        SFX.blackout();
        ov.remove();
        crt.remove();
        showBlackout();
    };
}

/* Quick mute for dev */
window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "m") SFX.stopAll();
});
