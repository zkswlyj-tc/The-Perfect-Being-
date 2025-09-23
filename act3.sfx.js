(function () {
    const SFX = (() => {
        // ---------- State ----------
        let armed = false;
        let p = null; // p5 instance
        let ctx = null; // AudioContext
        let loaderPromise = null;

        // Buses
        let master = null,
            ambBus = null,
            sfxBus = null;

        // Ambience
        let ambNoise = null,
            ambOsc = null,
            ambPan = null,
            ambFilter = null;
        let ambTicker = null;

        // Warning tones
        let warnTones = null;

        // Text tick queue (so ticks from the very first letters will be heard)
        let _pendingTicks = 0;
        let _tickDrain = null;

        // ---------- Utils ----------
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const prefersReduced =
            matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;

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
            // eslint-disable-next-line no-new
            new window.p5((sk) => {
                sk.setup = () => {
                    p = sk;
                    sk.noCanvas();
                };
            });
        }

        function ctxRunning() {
            try {
                const c = p?.getAudioContext?.();
                return !!c && c.state === "running";
            } catch {
                return false;
            }
        }

        // ---------- Core boot ----------
        async function arm() {
            await ensureLibs();
            bootP5();
            if (armed) return;

            // Try to start/resume audio politely
            try {
                await p.userStartAudio();
            } catch {}
            try {
                ctx = p.getAudioContext();
                if (ctx?.state === "suspended") await ctx.resume();
            } catch {}

            if (!ctx || ctx.state !== "running") {
                // Keep trying in background a few times; ticks will queue meanwhile
                nudger();
                return;
            }

            // Build bus graph
            master = new p5.Gain();
            ambBus = new p5.Gain();
            sfxBus = new p5.Gain();
            // route: amb/sfx -> master -> destination
            ambBus.disconnect();
            sfxBus.disconnect();
            ambBus.connect(master);
            sfxBus.connect(master);
            master.connect(p5.soundOut);
            master.amp(0.95);
            ambBus.amp(0.0);
            sfxBus.amp(1.0);

            // Start ambience gently
            ambienceStart(0.18);

            // Drain any queued typing ticks
            drainTypeTicks();

            // Visibility-aware damping
            document.addEventListener("visibilitychange", () => {
                const dim = document.hidden ? 0.3 : 0.95;
                try {
                    master.amp(dim, document.hidden ? 0.18 : 0.35);
                } catch {}
            });

            armed = true;
        }

        async function nudger() {
            // quick polling loop to resume without user gesture where possible
            let tries = 0;
            const tick = async () => {
                tries++;
                try {
                    await p.userStartAudio();
                } catch {}
                try {
                    ctx = p.getAudioContext();
                    if (ctx?.state === "suspended") await ctx.resume();
                } catch {}
                if (ctxRunning() && !armed) {
                    await arm();
                    return;
                }
                if (tries < 18) setTimeout(tick, 280); // ≈5s
            };
            tick();

            // also retry on focus/visibility
            window.addEventListener("focus", () => arm(), { once: true });
            document.addEventListener(
                "visibilitychange",
                () => {
                    if (!document.hidden) arm();
                },
                { once: true }
            );
        }

        // ---------- Ambience ----------
        function ambienceStart(target = 0.2) {
            if (!p || ambNoise) return;

            ambNoise = new p5.Noise("brown");
            ambOsc = new p5.Oscillator("sine");
            ambPan = new p5.Panner3D();
            ambFilter = new p5.Filter("lowpass");

            ambNoise.disconnect();
            ambOsc.disconnect();
            ambPan.disconnect?.();

            // chain: noise+osc -> filter -> pan -> ambBus
            ambNoise.connect(ambFilter);
            ambOsc.connect(ambFilter);
            ambFilter.connect(ambPan);
            ambPan.connect(ambBus);

            ambNoise.amp(0);
            ambOsc.amp(0);
            ambNoise.start();
            ambOsc.start();
            ambOsc.freq(80);

            // target ambience
            ambBus.amp(0, 0);
            ambBus.amp(target, 1.0);
            ambNoise.amp(0.18, 1.0);
            ambOsc.amp(0.06, 1.0);
            ambFilter.freq(850);

            // gentle movement / breathing
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

        // Live modulation (0..1)
        function setIntensity(x) {
            if (!ambFilter) return;
            const u = clamp(x, 0, 1);
            const f = 700 + 1600 * u * u; // 700→2300Hz
            ambFilter.freq(f, 0.12);
            ambNoise?.amp(0.14 + 0.1 * u, 0.12);
            ambOsc?.amp(0.05 + 0.06 * u, 0.12);
        }

        // Duck ambience briefly
        function duck(ms = 300, depth = 0.65) {
            if (!ambBus) return;
            const g = ambBus.input ? ambBus.input.gain.value : 0.2;
            ambBus.amp(g * (1 - depth), 0.05);
            setTimeout(() => ambBus.amp(g, 0.28), ms);
        }

        // ---------- One-shots ----------
        function _beep({
            f = 880,
            type = "sine",
            dur = 0.08,
            g = 0.28,
            pan = 0,
        } = {}) {
            if (!ctxRunning()) return;
            const o = new p5.Oscillator(type);
            const pa = new p5.Panner3D();
            o.disconnect();
            o.connect(pa);
            pa.connect(sfxBus);
            pa.set(clamp(pan, -1, 1), 0, 0);
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

        function _noiseBurst({
            type = "white",
            bp = 2200,
            q = 10,
            dur = 0.12,
            g = 0.22,
        } = {}) {
            if (!ctxRunning()) return;
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
            }, dur * 1000 + 60);
        }

        function _sweepWhoosh({
            from = 400,
            to = 3200,
            dur = 1.4,
            g = 0.24,
        } = {}) {
            if (!ctxRunning()) return;
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
                const u = clamp((p.millis() - t0) / L, 0, 1);
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
            }, L + 220);
        }

        function _sparkle({ level = 0.18 } = {}) {
            for (let i = 0; i < 5; i++) {
                setTimeout(
                    () =>
                        _beep({
                            f: 1200 + Math.random() * 1600,
                            type: "sine",
                            dur: 0.06,
                            g: level,
                            pan: (Math.random() * 2 - 1) * 0.7,
                        }),
                    i * 24
                );
            }
        }

        function _thud({ g = 0.6 } = {}) {
            if (!ctxRunning()) return;
            const o = new p5.Oscillator("sine");
            o.disconnect();
            o.connect(sfxBus);
            o.start();
            o.freq(140);
            o.amp(0);
            o.amp(g, 0.01);
            o.freq(60, 0.18);
            o.amp(0.0001, 0.28);
            setTimeout(() => {
                o.stop();
                o.dispose();
            }, 320);
        }

        // ---------- Text tick (queued) ----------
        function __playTypeTick() {
            // short bright click with tiny stereo variance
            _beep({
                f: 320 + Math.random() * 160,
                type: "square",
                dur: 0.028,
                g: 0.18,
                pan: (Math.random() - 0.5) * 0.5,
            });
        }

        function drainTypeTicks() {
            if (!_pendingTicks) return;
            // limit burst rate
            const n = Math.min(6, _pendingTicks);
            _pendingTicks -= n;
            for (let i = 0; i < n; i++) __playTypeTick();
            if (_pendingTicks > 0) {
                _tickDrain = setTimeout(drainTypeTicks, 60);
            } else {
                _tickDrain = null;
            }
        }

        function typeTick() {
            if (ctxRunning() && armed) {
                __playTypeTick();
                return;
            }
            _pendingTicks++;
            // try to arm silently; drain loop will flush when ready
            try {
                arm();
            } catch {}
            if (!_tickDrain) _tickDrain = setTimeout(drainTypeTicks, 80);
        }

        // ---------- Public cues for act3.js ----------
        const api = {
            // lifecycle
            arm,

            // typing
            typeTick,

            // micro UI
            ui(tag = "generic") {
                const f =
                    tag === "save"
                        ? 1040
                        : tag === "enter"
                        ? 700
                        : tag === "replay"
                        ? 820
                        : 560;
                _beep({ f, type: "triangle", dur: 0.055, g: 0.22 });
            },

            // big beats
            shock() {
                duck(380, 0.5);
                _noiseBurst({
                    type: "white",
                    bp: 3800,
                    q: 5,
                    dur: 0.09,
                    g: 0.26,
                });
                _beep({ f: 1400, type: "square", dur: 0.05, g: 0.22 });
            },
            disperse() {
                _sweepWhoosh({});
                _beep({ f: 920, type: "sine", dur: 0.08, g: 0.22 });
            },
            snapshot() {
                duck(260, 0.4);
                _beep({ f: 1800, type: "square", dur: 0.035, g: 0.22 });
                _noiseBurst({
                    type: "white",
                    bp: 4200,
                    q: 8,
                    dur: 0.06,
                    g: 0.16,
                });
            },

            // CRT “collapse” cue
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
                    _noiseBurst({ bp: 1600, q: 8, dur: 0.06, g: 0.1 });
                }, 140);
                setTimeout(() => {
                    o.stop();
                    o.dispose();
                }, 360);
            },

            // Warning tones
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
                    hi.freq(on ? 1160 : 880, 0.02);
                    lo.freq(on ? 300 : 220, 0.02);
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

            // Ambient modulation
            intensity(x) {
                setIntensity(x);
            },

            // Ending states
            blackout() {
                api.warnOff();
                ambienceStop(500);
                _beep({ f: 420, type: "sine", dur: 0.13, g: 0.2 });
            },
            rearm() {
                _beep({ f: 760, type: "triangle", dur: 0.06, g: 0.2 });
            },

            // Panic button
            stopAll() {
                try {
                    api.warnOff();
                } catch {}
                try {
                    ambienceStop(200);
                } catch {}
            },
        };

        // ---------- Gesture fallback ----------
        ["pointerdown", "keydown", "touchstart"].forEach((evt) => {
            window.addEventListener(evt, () => arm(), {
                once: true,
                passive: true,
            });
        });

        (function autoplayBoot() {
            if (document.readyState !== "loading") arm();
            else document.addEventListener("DOMContentLoaded", arm);
        })();

        return api;
    })();

    // Expose globally for act3.js
    window.SFX = SFX;
})();
