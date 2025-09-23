/* global p5, TARGET */
(() => {
    "use strict";

    /* =========== Routing (keyboard-only AFTER overlay) =========== */
    const TARGET_URL =
        typeof TARGET !== "undefined" && TARGET ? TARGET : "preact1.html";
    let leaving = false;
    let overlayOpen = false;

    function navigate(delay = 650) {
        if (leaving) return;
        leaving = true;
        document.body.classList.add("leaving");
        setTimeout(() => {
            window.location.href = TARGET_URL;
        }, delay);
    }

    window.addEventListener("keydown", (e) => {
        const k = e.key?.toLowerCase?.();
        if (overlayOpen) {
            if (k === "enter" || k === "e") {
                document.getElementById("introOk")?.click();
            }
            return;
        }
        // Overlay is closed → now Enter/E routes to the file
        if (k === "enter" || k === "e") {
            navigate(650);
        }
    });

    /* =================== Headphones intro overlay =================== */
    function showIntro() {
        overlayOpen = true;

        const ov = document.createElement("div");
        ov.className = "intro-overlay";
        ov.id = "introOverlay";
        ov.innerHTML = `
      <div class="intro-panel" role="dialog" aria-modal="true" aria-labelledby="introTitle">
        <div class="intro-title" id="introTitle">ACCESS NOTICE</div>
        <div class="intro-line">Wear <b>headphones</b> for the best experience.</div>
        <div class="intro-line">Ambient lab audio and tactile UI cues are present.</div>
        <button class="intro-btn" id="introOk" type="button" aria-label="Continue">I’m Ready</button>
      </div>
    `;
        document.body.appendChild(ov);
        requestAnimationFrame(() => ov.classList.add("open"));

        const btn = ov.querySelector("#introOk");
        btn?.focus({ preventScroll: true });

        // swallow *all* background clicks while overlay is open
        const swallow = (e) => {
            if (!overlayOpen) return;
            const ok =
                e.target &&
                (e.target.id === "introOk" || e.target.closest?.("#introOk"));
            if (!ok) {
                e.stopPropagation();
                e.preventDefault();
            }
        };
        document.addEventListener("click", swallow, true);
        document.addEventListener("pointerdown", swallow, true);
        document.addEventListener("mousedown", swallow, true);

        // Clicking the overlay button only closes + primes audio; does NOT navigate
        btn?.addEventListener(
            "click",
            () => {
                try {
                    const ctx = new (window.AudioContext ||
                        window.webkitAudioContext)();
                    if (ctx.state !== "running") ctx.resume?.();
                    window.TPB_LANDING_SFX?.start?.(ctx);
                } catch {
                    /* ignore */
                }
                closeIntro();
            },
            { once: true }
        );

        function closeIntro() {
            ov.classList.remove("open");
            setTimeout(() => {
                ov.remove();
                overlayOpen = false;
                document.removeEventListener("click", swallow, true);
                document.removeEventListener("pointerdown", swallow, true);
                document.removeEventListener("mousedown", swallow, true);
                // Fire a signal for anything that wants to react to "ready"
                window.dispatchEvent(new Event("landing:ready"));
            }, 260);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", showIntro, {
            once: true,
        });
    } else {
        showIntro();
    }

    /* =================== p5 VISUALS (run under overlay) =================== */
    // Ensure #stage exists
    if (!document.getElementById("stage")) {
        const stage = document.createElement("div");
        stage.id = "stage";
        document.body.prepend(stage);
    }

    new p5((s) => {
        let particles = [],
            pg,
            sg,
            dpr = Math.min(window.devicePixelRatio || 1, 2);
        const ripples = [],
            sparks = [],
            anomalies = [];

        s.setup = () => {
            const W = s.windowWidth,
                H = s.windowHeight;
            s.pixelDensity(dpr);
            s.createCanvas(W, H).parent("stage");

            pg = s.createGraphics(W, H);
            pg.pixelDensity(dpr);
            pg.clear();
            sg = s.createGraphics(W, H);
            sg.pixelDensity(dpr);
            sg.clear();

            const N = Math.floor(Math.min(1200, Math.max(420, (W * H) / 4000)));
            for (let i = 0; i < N; i++) particles.push(makeParticle());

            s.noiseDetail(4, 0.5);
            s.frameRate(60);
            s.strokeCap(s.ROUND);
            s.noFill();
        };

        s.windowResized = () => {
            const W = s.windowWidth,
                H = s.windowHeight;
            s.resizeCanvas(W, H);
            pg = s.createGraphics(W, H);
            pg.pixelDensity(dpr);
            pg.clear();
            sg = s.createGraphics(W, H);
            sg.pixelDensity(dpr);
            sg.clear();
        };

        function spawnInteraction(x, y) {
            for (let i = 0; i < 3; i++)
                ripples.push({
                    p: s.createVector(x, y),
                    r: 4 + i * 8,
                    w: 1.4,
                    a: 180 - i * 30,
                });

            for (let i = 0; i < 80; i++) {
                const ang = s.random(s.TWO_PI),
                    spd = s.random(1.5, 4.2);
                sparks.push({
                    p: s.createVector(x, y),
                    v: s.createVector(Math.cos(ang), Math.sin(ang)).mult(spd),
                    life: s.random(26, 60),
                    w: s.random(0.6, 1.4),
                });
            }

            anomalies.push({
                p: s.createVector(x, y),
                r: s.random(140, 220),
                str: s.random(0.9, 1.4),
                life: s.random(180, 300),
            });

            if (ripples.length > 30) ripples.splice(0, ripples.length - 30);
            if (sparks.length > 900) sparks.splice(0, sparks.length - 900);
            if (anomalies.length > 8) anomalies.shift();
        }

        // Background art can still react to clicks/touches (cosmetic)
        s.mousePressed = () => spawnInteraction(s.mouseX, s.mouseY);
        s.touchStarted = () => {
            const t = s.touches?.[0];
            spawnInteraction(t ? t.x : s.mouseX, t ? t.y : s.mouseY);
            return false;
        };

        function makeParticle() {
            return {
                p: s.createVector(s.random(s.width), s.random(s.height)),
                v: s.createVector(0, 0),
                life: s.random(300, 900),
                w: s.random(0.6, 1.4),
            };
        }

        function flow(x, y, t) {
            const n1 = s.noise(x * 0.0013, y * 0.0013, t),
                n2 = s.noise((x + 1000) * 0.0013, (y - 1000) * 0.0013, t + 5.2);
            const a = (n1 - n2) * s.TWO_PI * 1.2;
            const base = s.createVector(Math.cos(a), Math.sin(a));

            const cx = s.width * 0.5,
                cy = s.height * 0.52;
            const dx = x - cx,
                dy = y - cy,
                r = Math.hypot(dx, dy),
                R = Math.min(s.width, s.height) * 0.26;
            const attract = Math.exp(-Math.pow((r - R) / (R * 0.35), 2)) * 0.9;

            let swirlX = 0,
                swirlY = 0;
            for (const an of anomalies) {
                const ax = x - an.p.x,
                    ay = y - an.p.y,
                    d = Math.hypot(ax, ay) + 1e-4;
                const g =
                    Math.exp(-Math.pow(d / an.r, 2)) * an.str * (an.life / 300);
                swirlX += (-ay / d) * g;
                swirlY += (ax / d) * g;
            }
            return base
                .rotate(attract * 0.7)
                .add(swirlX, swirlY)
                .mult(0.9 + attract * 0.8);
        }

        function updateParticle(pt, t) {
            const f = flow(pt.p.x, pt.p.y, t);
            if (s.mouseX >= 0) {
                const d = s.dist(pt.p.x, pt.p.y, s.mouseX, s.mouseY);
                if (d < 180) {
                    const dir = s
                        .createVector(pt.p.x - s.mouseX, pt.p.y - s.mouseY)
                        .setMag((180 - d) * 0.002);
                    f.add(dir);
                }
            }
            pt.v.lerp(f, 0.18);
            pt.p.add(pt.v);
            pt.life--;

            if (pt.p.x < 0) pt.p.x = s.width;
            if (pt.p.x > s.width) pt.p.x = 0;
            if (pt.p.y < 0) pt.p.y = s.height;
            if (pt.p.y > s.height) pt.p.y = 0;
            if (pt.life <= 0) Object.assign(pt, makeParticle());
        }

        function drawParticles(t) {
            pg.noFill();
            pg.stroke(255, 60);
            for (let i = 0; i < particles.length; i++) {
                const pt = particles[i],
                    prev = pt.p.copy();
                updateParticle(pt, t);
                pg.strokeWeight(pt.w);
                pg.line(prev.x, prev.y, pt.p.x, pt.p.y);

                if (i % 50 === 0) {
                    const j =
                            (i + Math.floor(s.random(1, 40))) %
                            particles.length,
                        p2 = particles[j].p,
                        d = prev.dist(p2);
                    if (d < 80) {
                        pg.stroke(255, s.map(d, 0, 80, 110, 0));
                        pg.strokeWeight(0.6);
                        pg.line(prev.x, prev.y, p2.x, p2.y);
                    }
                }
            }
            s.image(pg, 0, 0);
            pg.noStroke();
            pg.fill(0, 16);
            pg.rect(0, 0, s.width, s.height);
        }

        function paintSacred(t) {
            sg.clear();
            const cx = sg.width * 0.5,
                cy = sg.height * 0.52;
            sg.push();
            sg.translate(cx, cy);

            const minSide = Math.min(sg.width, sg.height);
            sg.blendMode(s.BLEND);
            sg.noFill();
            sg.stroke(255, 90);
            sg.strokeWeight(0.8);
            for (let i = 0; i < 6; i++) {
                const R = minSide * 0.1 + i * 26;
                sg.circle(0, 0, R * 2);
            }

            const maxR = minSide * 0.22;
            const pulse = 0.78 + 0.02 * Math.sin(s.millis() * 0.0022);
            const k = 5 / 8;
            sg.stroke(255, 220);
            sg.strokeWeight(1.6);
            sg.beginShape();
            for (let a = 0; a < s.TWO_PI * 8; a += 0.02) {
                const r = maxR * pulse * Math.sin(k * a);
                sg.vertex(r * Math.cos(a), r * Math.sin(a));
            }
            sg.endShape();

            sg.stroke(255, 50);
            sg.strokeWeight(0.7);
            for (let i = 0; i < 36; i++) {
                const a = (i / 36) * s.TWO_PI,
                    R = minSide * 0.32;
                sg.line(0, 0, Math.cos(a) * R, Math.sin(a) * R);
            }

            sg.blendMode(s.ADD);
            sg.stroke(255, 28);
            sg.strokeWeight(10);
            sg.circle(0, 0, maxR * 2.02);

            sg.pop();
        }

        function drawGrid() {
            s.push();
            s.stroke(255, 18);
            s.strokeWeight(1);
            const step = 64;
            for (let x = 0; x < s.width; x += step) s.line(x, 0, x, s.height);
            for (let y = 0; y < s.height; y += step) s.line(0, y, s.width, y);
            s.pop();
        }

        function drawRipples() {
            for (let i = ripples.length - 1; i >= 0; i--) {
                const r = ripples[i];
                r.r += 2.6;
                r.w = Math.max(0.6, r.w * 0.995);
                r.a -= 2.2;
                s.noFill();
                s.stroke(255, r.a);
                s.strokeWeight(r.w);
                s.circle(r.p.x, r.p.y, r.r * 2);
                if (r.a <= 0) ripples.splice(i, 1);
            }
        }

        function drawSparks() {
            s.stroke(255, 150);
            for (let i = sparks.length - 1; i >= 0; i--) {
                const sp = sparks[i],
                    prev = sp.p.copy();
                sp.p.add(sp.v);
                sp.v.mult(0.985);
                sp.life--;
                s.strokeWeight(sp.w);
                s.line(prev.x, prev.y, sp.p.x, sp.p.y);
                if (sp.life <= 0) sparks.splice(i, 1);
            }
        }

        function updateAnomalies() {
            for (let i = anomalies.length - 1; i >= 0; i--) {
                const an = anomalies[i];
                an.life--;
                s.noFill();
                s.stroke(255, s.map(an.life, 0, 300, 0, 70));
                s.strokeWeight(0.8);
                s.circle(an.p.x, an.p.y, an.r * 2);
                if (an.life <= 0) anomalies.splice(i, 1);
            }
        }

        s.draw = () => {
            s.background(0, 18);
            const t = s.millis() * 0.00025;

            drawGrid();
            drawParticles(t);
            drawRipples();
            drawSparks();
            updateAnomalies();

            paintSacred(t);
            s.image(sg, 0, 0);

            if (s.frameCount % 240 < 2) {
                s.noStroke();
                s.fill(255, 18);
                const y = (s.frameCount * 9) % s.height;
                s.rect(0, y, s.width, 2);
            }
        };
    });
})();
