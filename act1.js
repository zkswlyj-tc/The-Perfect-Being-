(() => {
    "use strict";

    /* ------------------------------ Config ---------------------------------- */
    const CFG = {
        typing: { cps: 30, jitter: 0.25 },
        verify: {
            stepMs: 360,
            steps: (name) => [
                "Initializing...",
                "Routing via secure relay…",
                "Key exchange",
                "Personnel registry query…",
                "Heuristic MFA…",
                `Clearance: ${name.toUpperCase()}`,
                "Integrity: PASS",
            ],
            barStep: [12, 24],
        },
        scan: {
            autoplayMs: 5200, // full sweep length
            progressVarNames: ["--progress", "--act1-progress"],
        },
        fx: {
            grainOpacity: 0.06,
            netNodeCount: 42,
            netSpeed: 0.018, // slow orbital speed
            parallaxMax: 0.9, // px multiplier
            telemetryHz: 2, // updates per second
        },
    };

    /* ------------------------------ Utilities -------------------------------- */
    const $ = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rnd = (min, max) => min + Math.random() * (max - min);
    const lerp = (a, b, t) => a + (b - a) * t;

    // seeded PRNG (xorshift32)
    function seedFrom(str = "") {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < str.length; i++)
            h = ((h ^ str.charCodeAt(i)) * 16777619) >>> 0;
        return () => {
            h ^= h << 13;
            h >>>= 0;
            h ^= h >>> 17;
            h >>>= 0;
            h ^= h << 5;
            h >>>= 0;
            return (h >>> 0) / 4294967295;
        };
    }

    // scan-typed effect
    async function typeTo(
        el,
        { cps = CFG.typing.cps, jitter = CFG.typing.jitter } = {}
    ) {
        if (!el) return;
        const text = el.getAttribute("data-text") ?? el.textContent ?? "";
        el.textContent = "";
        el.classList.add("is-scanning");
        for (const ch of [...text]) {
            el.textContent += ch;
            // eslint-disable-next-line no-await-in-loop
            await wait(
                (1000 / cps) * (1 - jitter + Math.random() * jitter * 2)
            );
        }
        el.classList.remove("is-scanning");
    }

    function setCSSProgress(p) {
        const pct = `${(p * 100).toFixed(3)}%`;
        for (const k of CFG.scan.progressVarNames) {
            document.documentElement.style.setProperty(k, pct);
        }
    }

    (function ensureHiddenRule() {
        if (!document.getElementById("__hidden_css__")) {
            const style = document.createElement("style");
            style.id = "__hidden_css__";
            style.textContent = `.hidden{display:none!important}`;
            document.head.appendChild(style);
        }
    })();

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches;

    /* ------------------------------ FX Engine -------------------------------- */
    const FX = (() => {
        let seed = seedFrom("default");
        let paused = prefersReduced;

        // canvases
        let grainCanvas, grainCtx; 
        let netCanvas, netCtx; 
        let dustCanvas, dustCtx; 
        let vpEl;

        // constellation
        let nodes = [];

        // dust
        let dust = [];
        let dustSprite = null;
        let scanProg = 0; // 0..1 

        // loop timing
        let rafId = null;

        function makeCanvas(cls, parent = document.body) {
            const c = document.createElement("canvas");
            c.className = cls;
            Object.assign(c.style, {
                position: "fixed",
                inset: "0",
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                zIndex: cls.includes("fx-over-vp") ? 2 : 1,
                mixBlendMode: "soft-light",
                opacity: String(CFG.fx.grainOpacity),
            });
            parent.appendChild(c);
            return c;
        }

        function makeOverViewportCanvas(
            vp,
            z = 2,
            blend = "screen",
            opacity = "0.55"
        ) {
            const c = document.createElement("canvas");
            c.className = "fx-over-vp";
            Object.assign(c.style, {
                position: "absolute",
                inset: "0",
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                zIndex: z,
                mixBlendMode: blend,
                opacity,
            });
            vp.appendChild(c);
            return c;
        }

        function resizeCanvas(c) {
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const rect =
                c === grainCanvas
                    ? document.documentElement.getBoundingClientRect()
                    : c.parentElement.getBoundingClientRect();
            c.width = Math.max(1, Math.floor(rect.width * dpr));
            c.height = Math.max(1, Math.floor(rect.height * dpr));
            c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        /* ---------- Film grain --------- */
        let grainTimer = 0;
        function drawGrain(now) {
            if (!grainCtx) return;
            if (now - grainTimer < 120) return;
            grainTimer = now;
            const w = grainCanvas.clientWidth,
                h = grainCanvas.clientHeight;
            grainCtx.clearRect(0, 0, w, h);
            const count = Math.floor((w * h) / 5500);
            grainCtx.fillStyle = "rgba(255,255,255,0.13)";
            for (let i = 0; i < count; i++) {
                grainCtx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
            }
        }

        /* ---------- Constellation ------- */
        function initNetwork() {
            nodes = [];
            const rand = seed;
            const rect = vpEl.getBoundingClientRect();
            for (let i = 0; i < CFG.fx.netNodeCount; i++) {
                nodes.push({
                    a: rand() * Math.PI * 2,
                    r: lerp(
                        Math.min(rect.width, rect.height) * 0.12,
                        Math.min(rect.width, rect.height) * 0.44,
                        rand()
                    ),
                    s: (rand() * 0.6 + 0.7) * CFG.fx.netSpeed,
                    w: rand() * 0.6 + 0.4,
                    cx: rect.width / 2,
                    cy: rect.height / 2,
                    px: 0,
                    py: 0,
                });
            }
        }

        function drawNetwork(dt) {
            if (!netCtx) return;
            const w = netCanvas.clientWidth,
                h = netCanvas.clientHeight;
            netCtx.clearRect(0, 0, w, h);
            netCtx.save();
            netCtx.globalCompositeOperation = "lighter";
            netCtx.lineWidth = 1;

            for (const n of nodes) {
                n.a += n.s * dt * 0.06;
                n.px = n.cx + Math.cos(n.a) * n.r;
                n.py = n.cy + Math.sin(n.a) * n.r;
            }

            for (let i = 0; i < nodes.length; i++) {
                const a = nodes[i];
                for (let j = i + 1; j < nodes.length; j++) {
                    const b = nodes[j];
                    const dx = a.px - b.px,
                        dy = a.py - b.py;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < 160 * 160) {
                        const alpha = 0.25 * (1 - d2 / (160 * 160));
                        netCtx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(
                            3
                        )})`;
                        netCtx.beginPath();
                        netCtx.moveTo(a.px, a.py);
                        netCtx.lineTo(b.px, b.py);
                        netCtx.stroke();
                    }
                }
            }

            netCtx.fillStyle = "rgba(255,255,255,0.65)";
            for (const n of nodes) {
                netCtx.beginPath();
                netCtx.arc(n.px, n.py, n.w, 0, Math.PI * 2);
                netCtx.fill();
            }
            netCtx.restore();
        }

        /* ---------- Dusty overlay -------- */

        function makeDustSprite() {
            const N = 48;
            const c = document.createElement("canvas");
            c.width = c.height = N;
            const ctx = c.getContext("2d");
            const g = ctx.createRadialGradient(
                N / 2,
                N / 2,
                0,
                N / 2,
                N / 2,
                N / 2
            );
            g.addColorStop(0.0, "rgba(255,255,255,0.9)");
            g.addColorStop(0.5, "rgba(255,255,255,0.25)");
            g.addColorStop(1.0, "rgba(255,255,255,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(N / 2, N / 2, N / 2, 0, Math.PI * 2);
            ctx.fill();
            return c;
        }

        function initDust() {
            dust = [];
            dustSprite = makeDustSprite();
            const w = dustCanvas.clientWidth,
                h = dustCanvas.clientHeight;

            // density scales with area, capped
            const target = Math.min(480, Math.floor(w * h * 0.00012));
            for (let i = 0; i < target; i++) {
                dust.push(spawnDust(w, h));
            }
        }

        function spawnDust(w, h) {
            const z = 0.5 + Math.random() * 0.7; // pseudo depth 
            return {
                x: Math.random() * w,
                y: Math.random() * h,
                z,
                r: 4 + Math.random() * 18 * z, // radius (screen px)
                vx: (Math.random() - 0.5) * (0.08 + 0.12 * z),
                vy: (0.02 + Math.random() * 0.06) * z,
                tw: Math.random() * Math.PI * 2, // twinkle phase
                s: 0.85 + Math.random() * 0.3, // size jitter
            };
        }

        function drawDust(dt, now) {
            if (!dustCtx) return;
            const w = dustCanvas.clientWidth,
                h = dustCanvas.clientHeight;
            const progX = w * scanProg; // scan line x in px

            dustCtx.clearRect(0, 0, w, h);
            dustCtx.globalCompositeOperation = "lighter";

            for (let i = 0; i < dust.length; i++) {
                const p = dust[i];

                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.tw += 0.0025 * dt;

                const m = 30;
                if (p.x < -m || p.x > w + m || p.y > h + m) {
                    dust[i] = spawnDust(w, h);
                    continue;
                }

                const band = 140; // px
                const glow = Math.max(0, 1 - Math.abs(p.x - progX) / band);
                const g2 = Math.pow(glow, 1.8);

                const tw = 0.85 + 0.15 * Math.sin(p.tw + p.z * 3.1);

                const alpha = (0.035 + 0.06 * g2) * (0.7 + 0.3 * p.z);
                const size = p.r * p.s * (0.9 + 0.25 * g2) * tw;

                dustCtx.globalAlpha = alpha;
                dustCtx.drawImage(
                    dustSprite,
                    p.x - size,
                    p.y - size,
                    size * 2,
                    size * 2
                );
            }
        }

        /* ---------- Parallax tilt --------- */
        function bindParallax(el) {
            let x = 0,
                y = 0,
                tx = 0,
                ty = 0;
            const max = CFG.fx.parallaxMax;
            const update = () => {
                tx += (x - tx) * 0.08;
                ty += (y - ty) * 0.08;
                document.documentElement.style.setProperty(
                    "--tiltX",
                    tx.toFixed(4)
                );
                document.documentElement.style.setProperty(
                    "--tiltY",
                    ty.toFixed(4)
                );
                if (!paused) requestAnimationFrame(update);
            };
            el.addEventListener("pointermove", (e) => {
                const r = el.getBoundingClientRect();
                const nx = (e.clientX - r.left) / r.width - 0.5;
                const ny = (e.clientY - r.top) / r.height - 0.5;
                x = clamp(nx * max, -max, max);
                y = clamp(ny * max, -max, max);
            });
            update();
        }

        function setSeed(name) {
            seed = seedFrom(name || "default");
            const glow = 0.6 + seed() * 0.25;
            document.documentElement.style.setProperty(
                "--glow",
                `rgba(255,255,255,${glow})`
            );
        }

        function start(vp) {
            if (prefersReduced) {
                paused = true;
                return;
            }
            vpEl = vp;

            grainCanvas = makeCanvas("fx-grain", document.body);
            grainCtx = grainCanvas.getContext("2d");
            resizeCanvas(grainCanvas);

            netCanvas = makeOverViewportCanvas(vpEl, 2, "screen", "0.55");
            netCtx = netCanvas.getContext("2d");
            resizeCanvas(netCanvas);
            initNetwork();

            dustCanvas = makeOverViewportCanvas(vpEl, 3, "screen", "0.9");
            dustCtx = dustCanvas.getContext("2d");
            resizeCanvas(dustCanvas);
            initDust();

            bindParallax(vpEl);

            let last = performance.now();
            const loop = (now) => {
                const dt = Math.min(48, now - last);
                last = now;
                if (!paused) {
                    drawGrain(now);
                    drawNetwork(dt);
                    drawDust(dt, now);
                }
                rafId = requestAnimationFrame(loop);
            };
            rafId = requestAnimationFrame(loop);

            window.addEventListener("resize", () => {
                resizeCanvas(grainCanvas);
                resizeCanvas(netCanvas);
                resizeCanvas(dustCanvas);
                initNetwork();
                initDust();
            });

            document.addEventListener("visibilitychange", () => {
                paused = document.hidden || prefersReduced;
            });

            // listen for scan progress from Act I
            window.addEventListener("act1:progress", (e) => {
                scanProg = clamp(e.detail?.progress ?? 0, 0, 1);
            });
        }

        function flashHandoff(vp) {
            if (!vp) return;
            vp.animate(
                [
                    { filter: "contrast(100%) brightness(100%)" },
                    { filter: "contrast(150%) brightness(120%)" },
                    { filter: "contrast(100%) brightness(100%)" },
                ],
                { duration: 480, easing: "cubic-bezier(.2,.8,.2,1)" }
            );
        }

        return { start, setSeed, flashHandoff };
    })();

    /* ------------------------------ Opening ---------------------------------- */
    const Opening = (() => {
        const root = $("#openingScreen");
        const btn = $("#openFileBtn");
        const login = $("#loginScreen");

        async function show() {
            // Hide main
            $(".frame")?.classList.add("hidden");
            // Type lines
            for (const el of $$(".opening-screen .scan-typed")) {
                // eslint-disable-next-line no-await-in-loop
                await typeTo(el);
            }
            // minimal accessibility focus
            btn?.focus();
        }

        async function proceed() {
            root?.classList.add("hide");
            await wait(800);
            if (root) root.style.display = "none";
            login?.classList.remove("hidden");
            // type login header
            for (const el of $$(".login-header .scan-typed")) {
                // eslint-disable-next-line no-await-in-loop
                await typeTo(el);
            }
        }

        function bind() {
            btn?.addEventListener("click", proceed);
            window.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && root && root.style.display !== "none")
                    proceed();
            });
        }

        return { show, bind, proceed };
    })();

    /* ------------------------------- Login ----------------------------------- */
    const Login = (() => {
        const pane = $("#loginScreen");
        const form = $("#loginForm");
        const nameEl = $("#name");
        const nda = $("#nda");
        const verify = $("#verifyUI");
        const bar = $("#verifyBar");
        const log = $("#verifyLog");
        const okB = $("#bannerGranted");
        const noB = $("#bannerDenied");

        function logLine(msg) {
            if (!log) return;
            const row = document.createElement("div");
            row.className = "row";
            row.textContent = `> ${msg}`;
            log.appendChild(row);
            log.scrollTop = log.scrollHeight;
        }

        async function runVerification(name) {
            if (verify) verify.hidden = false;
            if (bar) bar.style.width = "0%";
            if (log) log.innerHTML = "";
            if (noB) noB.hidden = true;
            if (okB) okB.hidden = true;

            let pct = 0;
            for (const s of CFG.verify.steps(name)) {
                logLine(s);
                const inc = lerp(
                    CFG.verify.barStep[0],
                    CFG.verify.barStep[1],
                    Math.random()
                );
                pct = clamp(pct + inc, 0, 100);
                if (bar) bar.style.width = `${pct}%`;
                // eslint-disable-next-line no-await-in-loop
                await wait(CFG.verify.stepMs);
            }
            if (bar) bar.style.width = "100%";
            await wait(260);
            if (okB) okB.hidden = false;
            return true;
        }

        function bind(onSuccess) {
            form?.addEventListener("submit", async (e) => {
                e.preventDefault();
                const name = (nameEl?.value || "").trim();
                if (!name || !nda?.checked) {
                    if (noB) noB.hidden = false;
                    form?.animate(
                        [
                            { transform: "translateX(0)" },
                            { transform: "translateX(-6px)" },
                            { transform: "translateX(6px)" },
                            { transform: "translateX(0)" },
                        ],
                        { duration: 180, iterations: 2, easing: "ease-in-out" }
                    );
                    return;
                }

                // personalize .role spans
                $$(".role").forEach((el) => (el.textContent = name));

                // seed FX based on name
                FX.setSeed(name);

                await runVerification(name);

                pane?.classList.add("hide");
                await wait(900);
                if (pane) pane.style.display = "none";
                onSuccess?.(name);
            });
        }

        return { bind };
    })();

    /* ------------------------------- Act I ----------------------------------- */
    const Act1 = (() => {
        const frame = $(".frame");
        const vp = $("#viewport");
        const line = $("#scanLine");
        const glow = $("#scanGlow");
        const status = $("#status");
        const coords = $("#coords");

        // Telemetry in topbar (right side element)
        const topbarRight = $(".topbar div:last-child");

        let progress = 0; // 0..1
        let lastT = 0;
        let telemetryTimer = 0;
        let completeDispatched = false;

        function rect() {
            return (
                vp?.getBoundingClientRect?.() || {
                    left: 0,
                    width: 1,
                    top: 0,
                    height: 1,
                }
            );
        }

        function render() {
            setCSSProgress(progress);
            window.dispatchEvent(
                new CustomEvent("act1:progress", { detail: { progress } })
            );

            // position scan beam
            const r = rect();
            const x = r.width * progress;
            if (line) line.style.left = `${x}px`;
            if (glow) glow.style.left = `${x}px`;

            // status copy (manual mission)
            if (status) {
                status.textContent =
                    progress >= 1
                        ? "SCAN COMPLETE — HANDOFF ARMED"
                        : "SCRUB THE BEAM TO 100% TO ARM HANDOFF";
            }

            // completion event (manual only)
            if (!completeDispatched && progress >= 1) {
                completeDispatched = true;
                FX.flashHandoff(vp);
                window.dispatchEvent(new Event("act1:complete"));
            }
        }

        function updateTelemetry(dt) {
            telemetryTimer += dt;
            const interval = 1000 / CFG.fx.telemetryHz;
            if (telemetryTimer < interval || !topbarRight) return;
            telemetryTimer = 0;
            const now = performance.now() / 1000;
            const t = now.toFixed(2);
            const v = (0.92 + Math.sin(now * 0.6) * 0.04).toFixed(3);
            const hr = Math.round(112 + Math.sin(now * 0.9) * 6);
            topbarRight.textContent = `ARCHIVE ONLINE · USER PRESENCE VERIFIED · T:${t}s · V:${v} · HR:${hr}`;
        }

        function raf(now) {
            const dt = Math.min(48, now - (lastT || now));
            lastT = now;
            // NO AUTOPLAY: progress is only user-driven
            updateTelemetry(dt);
            requestAnimationFrame(raf);
        }

        function bindInput() {
            if (!vp) return;
            let dragging = false;

            function setFromPointer(e) {
                const r = rect();
                const p = (e.clientX - r.left) / r.width;
                progress = clamp(p, 0, 1);
                if (coords)
                    coords.textContent = `X:${Math.round(
                        e.clientX - r.left
                    )} Y:${Math.round(e.clientY - r.top)}`;
                render();
            }

            // Drag to scan
            vp.addEventListener("pointerdown", (e) => {
                dragging = true;
                vp.setPointerCapture?.(e.pointerId);
                setFromPointer(e);
            });
            vp.addEventListener("pointermove", (e) => {
                if (dragging) setFromPointer(e);
            });
            vp.addEventListener("pointerup", () => {
                dragging = false;
            });
            vp.addEventListener("pointerleave", () => {
                dragging = false;
            });

            // Keyboard scan 
            vp.setAttribute("tabindex", "0");
            window.addEventListener("keydown", (e) => {
                if (e.code === "ArrowRight") {
                    progress = clamp(progress + 0.02, 0, 1);
                    render();
                }
                if (e.code === "ArrowLeft") {
                    progress = clamp(progress - 0.02, 0, 1);
                    render();
                }
            });

            // Optional: mouse wheel to scrub
            vp.addEventListener(
                "wheel",
                (e) => {
                    e.preventDefault();
                    const delta = Math.sign(e.deltaY) * -0.025; // up = forward
                    progress = clamp(progress + delta, 0, 1);
                    render();
                },
                { passive: false }
            );
        }

        async function show() {
            frame?.classList.remove("hidden");
            await wait(220);
            // start manual (no autoplay)
            render();
            requestAnimationFrame(raf);

            // start visual FX
            FX.start(vp);
        }

        return { show, bindInput, render };
    })();

    /* --------------------------------- Boot --------------------------------- */
    document.addEventListener("DOMContentLoaded", async () => {
        try {
            Opening.bind();
            await Opening.show();

            Login.bind(async () => {
                Act1.bindInput();
                await Act1.show();
            });
        } catch (err) {
            console.error("[TPB] Fatal init error — fallback to Act I:", err);
            // fail-open if something goes wrong
            $("#openingScreen")?.classList.add("hide");
            $("#loginScreen")?.classList.add("hide");
            await wait(300);
            $(".frame")?.classList.remove("hidden");
            Act1.bindInput();
            requestAnimationFrame(Act1.render);
        }
    });
})();
(() => {
    const panel = document.getElementById("leftHUD");
    const body = document.getElementById("leftBody");
    if (!panel || !body) return;

    const paras = Array.from(body.querySelectorAll(".lead p"));
    let i = 0;

    function armLine(p) {
        p.animate(
            [
                { textShadow: "0 0 0 rgba(255,255,255,0)" },
                { textShadow: "0 0 10px rgba(255,255,255,.18)" },
                { textShadow: "0 0 0 rgba(255,255,255,0)" },
            ],
            { duration: 380, easing: "ease-out" }
        );
        p.style.color = "#eef3f8";
    }

    // bring lines online one by one on first view
    const stepIn = () => {
        if (i >= paras.length) return;
        armLine(paras[i++]);
        setTimeout(stepIn, 420);
    };
    // start when section enters viewport
    const io = new IntersectionObserver(
        (entries) => {
            if (entries.some((e) => e.isIntersecting)) {
                stepIn();
                io.disconnect();
            }
        },
        { threshold: 0.3 }
    );
    io.observe(panel);

    // sync "armed" glow when Act I scan completes
    window.addEventListener("act1:complete", () => {
        panel.animate(
            [
                { filter: "contrast(100%) brightness(100%)" },
                { filter: "contrast(150%) brightness(118%)" },
                { filter: "contrast(100%) brightness(100%)" },
            ],
            { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" }
        );
        panel.classList.add("armed");
    });
})();
/* === Minimal HUD Brief add-on === */
(() => {
    const brief = document.getElementById("brief");
    if (!brief) return;

    // 1) Progressive reveal of rows
    const rows = brief.querySelectorAll(".row, .tags, .ecg, .hint");
    rows.forEach((el) => {
        el.style.opacity = 0;
        el.style.transform = "translateY(6px)";
    });
    const io = new IntersectionObserver(
        (ents) => {
            if (!ents.some((e) => e.isIntersecting)) return;
            rows.forEach((el, i) => {
                el.animate(
                    [
                        { opacity: 0, transform: "translateY(6px)" },
                        { opacity: 1, transform: "translateY(0)" },
                    ],
                    {
                        duration: 320,
                        delay: i * 90,
                        easing: "cubic-bezier(.2,.7,.2,1)",
                        fill: "forwards",
                    }
                );
            });
            io.disconnect();
        },
        { threshold: 0.35 }
    );
    io.observe(brief);

    // 2) ECG trace (perf-light)
    const c = document.getElementById("ecg");
    const ctx = c?.getContext("2d");
    if (ctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const resize = () => {
            const r = c.getBoundingClientRect();
            c.width = Math.max(1, Math.floor(r.width * dpr));
            c.height = Math.max(1, Math.floor(r.height * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        window.addEventListener("resize", resize, { passive: true });

        let x = 0,
            t = 0;
        function step(now) {
            const w = c.clientWidth,
                h = c.clientHeight;
            t = now * 0.0022;
            x = (x + 2) % (w + 2);
            ctx.clearRect(0, 0, w, h);
            // grid
            ctx.strokeStyle = "rgba(255,255,255,.06)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let gy = 8; gy < h; gy += 12) {
                ctx.moveTo(0, gy);
                ctx.lineTo(w, gy);
            }
            ctx.stroke();
            ctx.strokeStyle = "rgba(255,255,255,.7)";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (let i = 0; i < w; i++) {
                const k = (i + x) * 0.022;
                const spike = Math.exp(-Math.pow(i - w * 0.25, 2) / 140) * 22;
                const y =
                    h * 0.5 +
                    Math.sin(k + t) * 5 -
                    Math.cos(k * 0.7) * 3 -
                    spike;
                if (i === 0) ctx.moveTo(i, y);
                else ctx.lineTo(i, y);
            }
            ctx.stroke();
            requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }


})();

// Update a single stat chip (0..100)
function setStat(key, pct) {
    const el = document.querySelector(`.stat[data-key="${key}"]`);
    if (!el) return;
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    el.style.setProperty("--pct", p);
    const v = el.querySelector(".value");
    if (v) v.textContent = `${String(p).padStart(2, "0")}%`;
}

// Example: keep at 0 now
setStat("beauty", 0);
setStat("power", 0);
setStat("survival", 0);


(() => {
    const brief = document.getElementById("brief");
    if (!brief) return;

    const fit = (w) => {
        brief.classList.toggle("compact", w < 560);
        brief.classList.toggle("nano", w < 400);
    };

    // Initial + reactive sizing
    const ro = new ResizeObserver((entries) => {
        for (const e of entries) fit(e.contentRect.width);
    });
    ro.observe(brief);
    fit(brief.getBoundingClientRect().width);
})();
/* =========================
   Act I → Act II Handoff (manual only)
   ========================= */
(function act2Handoff() {
    const ROUTE_ACT2 = "act2.html"; // ← change if your filename differs
    let armed = false;

    function go(nextDelay = 220) {
        if (armed) return;
        armed = true;

        // tiny flash for the handoff
        document.body.animate(
            [
                { filter: "contrast(100%) brightness(100%)" },
                { filter: "contrast(150%) brightness(120%)" },
                { filter: "contrast(100%) brightness(100%)" },
            ],
            { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" }
        );

        sessionStorage.setItem(
            "tpb_act1_complete",
            JSON.stringify({ ok: true, t: Date.now() })
        );

        setTimeout(() => {
            window.location.href = ROUTE_ACT2;
        }, nextDelay);
    }

    function showCTA() {
        if (document.getElementById("act2CTA")) return;

        const cta = document.createElement("div");
        cta.id = "act2CTA";
        cta.style.cssText = `
      position: fixed; inset: auto 0 24px 0; display:flex; justify-content:center; pointer-events:none; z-index: 9999;
    `;
        cta.innerHTML = `
      <button id="toAct2"
        style="
          pointer-events:auto; font: 600 12px/1.2 'JetBrains Mono', ui-monospace;
          letter-spacing:.08em; text-transform:uppercase;
          padding:10px 14px; border-radius:10px;
          background:#0f1318; color:#e8eef6; border:1px solid rgba(255,255,255,.16);
          box-shadow:0 8px 24px rgba(0,0,0,.35);"
      >
        PROCEED — SELECT A VECTOR
      </button>
    `;
        document.body.appendChild(cta);

        document
            .getElementById("toAct2")
            ?.addEventListener("click", () => go(120));
    }

    // Only arm CTA when manual scan actually completes
    window.addEventListener("act1:complete", () => {
        showCTA(); // no auto-redirect — user must click or press Enter/E
    });

    // Keyboard shortcut once CTA is visible
    window.addEventListener("keydown", (e) => {
        if (!document.getElementById("act2CTA")) return;
        const k = e.key.toLowerCase();
        if (k === "enter" || k === "e") {
            e.preventDefault();
            go(0);
        }
    });

    // Fallback: if CSS var says 100% (manual scrub), just show the CTA (no auto go)
    const cssProbe = setInterval(() => {
        const cs = getComputedStyle(document.documentElement);
        const v =
            cs.getPropertyValue("--act1-progress").trim() ||
            cs.getPropertyValue("--progress").trim();
        const n = parseFloat(v) || 0;
        if (n >= 99.9) {
            clearInterval(cssProbe);
            showCTA();
        }
    }, 400);
})();
