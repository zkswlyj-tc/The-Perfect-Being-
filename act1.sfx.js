(function () {
    const S = {}; // state bag
    const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const now = () => (S.ctx ? S.ctx.currentTime : 0);

    function g(v = 1) {
        const n = S.ctx.createGain();
        n.gain.value = v;
        return n;
    }
    function osc(type = "sine", f = 440) {
        const o = S.ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        return o;
    }
    function env(gn, a = 0.005, d = 0.25, peak = 1) {
        const t = now(),
            g = gn.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(0.0001, t);
        g.linearRampToValueAtTime(peak, t + a);
        g.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    function note(
        out,
        type = "sine",
        f0 = 440,
        f1 = null,
        dur = 0.25,
        vol = 0.5
    ) {
        const o = osc(type, f0),
            v = g(vol);
        o.connect(v).connect(out);
        const t = now();
        if (f1 != null) {
            o.frequency.setValueAtTime(f0, t);
            o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
        }
        v.gain.setValueAtTime(0.0001, t);
        v.gain.linearRampToValueAtTime(vol, t + 0.005);
        v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.start(t);
        o.stop(t + dur + 0.05);
    }
    function burstNoise(
        out,
        dur = 0.25,
        { type = "bandpass", f = 800, q = 8, vol = 0.6 } = {}
    ) {
        const src = S.ctx.createBufferSource();
        src.buffer = makeNoise(dur);
        const bi = S.ctx.createBiquadFilter();
        bi.type = type;
        bi.frequency.value = f;
        bi.Q.value = q;
        const v = g(vol);
        src.connect(bi).connect(v).connect(out);
        env(v, 0.004, dur * 0.9, vol);
        src.start();
    }
    function makeNoise(seconds = 1) {
        const len = Math.max(1, Math.floor(S.ctx.sampleRate * seconds));
        const buf = S.ctx.createBuffer(1, len, S.ctx.sampleRate),
            d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
        return buf;
    }
    function makeReverb(seconds = 2.5, decay = 0.35) {
        const rate = S.ctx.sampleRate,
            len = Math.floor(rate * seconds);
        const buf = S.ctx.createBuffer(2, len, rate);
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            for (let i = 0; i < len; i++)
                d[i] =
                    (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay * 6);
        }
        const con = S.ctx.createConvolver();
        con.buffer = buf;
        const input = g(1),
            output = g(1);
        input.connect(con);
        con.connect(output);
        return { input, output };
    }

    function noteUI(
        f0 = 1200,
        f1 = null,
        dur = 0.08,
        vol = 0.22,
        type = "sine"
    ) {
        const pan = S.ctx.createStereoPanner();
        pan.pan.value = 0;
        const out = g(1.0),
            eq = S.ctx.createBiquadFilter();
        eq.type = "peaking";
        eq.frequency.value = 2100;
        eq.Q.value = 1.1;
        eq.gain.value = 2.5;
        const pre = g(1.0);
        pre.connect(out);
        out.connect(eq).connect(pan).connect(S.ui);
        const t = now();
        pre.gain.setValueAtTime(1.0, t);
        pre.gain.linearRampToValueAtTime(1.15, t + 0.012);
        pre.gain.linearRampToValueAtTime(1.0, t + 0.08);
        note(pre, type, f0, f1, dur, vol);
    }

    // ---------- init graph ----------
    async function init() {
        if (S.ctx) return;
        const ctx = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: "interactive",
        });
        S.ctx = ctx;

        // Buses
        const master = g(0.9),
            ui = g(0.9),
            pad = g(0.75),
            beam = g(0.8);
        const revSend = g(0.25),
            dlySend = g(0.12);

        // Sidechain duckers for pad & beam (pre-master)
        const padDucker = g(1.0),
            beamDucker = g(1.0);

        // FX
        const rev = makeReverb(2.6, 0.35);
        revSend.connect(rev.input);
        rev.output.connect(master);

        const dL = ctx.createDelay(1),
            dR = ctx.createDelay(1);
        dL.delayTime.value = 0.27;
        dR.delayTime.value = 0.36;
        const fbL = g(0.28),
            fbR = g(0.28),
            mix = g(0.6);
        dL.connect(fbL).connect(dR);
        dR.connect(fbR).connect(dL);
        dL.connect(mix);
        dR.connect(mix);
        dlySend.connect(dL);
        dlySend.connect(dR);
        mix.connect(master);

        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 18;
        comp.ratio.value = 8;
        comp.attack.value = 0.003;
        comp.release.value = 0.18;

        const notch = (hz) => {
            const bi = ctx.createBiquadFilter();
            bi.type = "peaking";
            bi.frequency.value = hz;
            bi.Q.value = 1.2;
            bi.gain.value = -3.5;
            return bi;
        };
        const padEQ = notch(2200),
            beamEQ = notch(2000);

        pad.connect(padEQ).connect(padDucker).connect(master);
        beam.connect(beamEQ).connect(beamDucker).connect(master);
        ui.connect(master);
        master.connect(comp).connect(ctx.destination);

        Object.assign(S, {
            master,
            ui,
            pad,
            beam,
            padDucker,
            beamDucker,
            revSend,
            dlySend,
        });

        startBed();
        makeBeam();
        autoWire();
    }

    // ---------- sidechain duck ----------
    function duck(amount = 0.5, attack = 0.01, hold = 0.05, release = 0.12) {
        const t = now(),
            tgt = clamp(amount, 0.3, 1);
        [S.padDucker, S.beamDucker].forEach((d) => {
            if (!d) return;
            const g = d.gain;
            g.cancelScheduledValues(t);
            g.setValueAtTime(g.value, t);
            g.linearRampToValueAtTime(tgt, t + attack);
            g.setValueAtTime(tgt, t + attack + hold);
            g.linearRampToValueAtTime(1.0, t + attack + hold + release);
        });
    }

    // ---------- ambient bed ----------
    function startBed() {
        const f1 = 78,
            f2 = 156;
        const o1 = osc("sine", f1),
            o2 = osc("triangle", f2);
        const lfo = osc("sine", 0.08),
            lfoGain = g(28);

        // pad shaper
        const lp = S.ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 900;
        lp.Q.value = 0.4;
        const hp = S.ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 110;
        hp.Q.value = 0.7; // kill drone

        const v = g(0.0); // pad VCA (define BEFORE using!)
        lfo.connect(lfoGain).connect(lp.frequency);

        // per-osc trims
        const g1 = g(1.0),
            g2 = g(0.6);
        o1.connect(g1).connect(v);
        o2.connect(g2).connect(v);

        v.connect(lp).connect(hp).connect(S.pad);

        lp.connect(S.revSend);
        lp.connect(S.dlySend);

        const air = S.ctx.createBufferSource();
        air.buffer = makeNoise(3);
        air.loop = true;
        const bp = S.ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1400;
        bp.Q.value = 1.2;
        const deEss = S.ctx.createBiquadFilter();
        deEss.type = "highshelf";
        deEss.frequency.value = 4500;
        deEss.gain.value = -6;
        const airV = g(0.03);
        air.connect(bp).connect(deEss).connect(airV).connect(S.pad);
        airV.connect(S.revSend);

        const t = now();
        o1.start(t);
        o2.start(t);
        lfo.start(t);
        air.start(t);
        v.gain.linearRampToValueAtTime(0.12, t + 1.2); // lighter pad level
    }

    // ---------- scan beam (always on; level modulated) ----------
    function makeBeam() {
        const src = S.ctx.createBufferSource();
        src.buffer = makeNoise(4);
        src.loop = true;
        const bp = S.ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 3.2;
        bp.frequency.value = 400;
        const pan = S.ctx.createStereoPanner();
        pan.pan.value = -1;
        const v = g(0.0);
        src.connect(bp).connect(pan).connect(v).connect(S.beam);
        v.connect(S.revSend);
        src.start();
        S._beam = { bp, pan, v, lastProg: 0, tickT: 0 };
    }
    function onProgress(p) {
        if (!S._beam) return;
        const { bp, pan, v } = S._beam,
            t = now();
        const targetF = 180 + p * 7600;
        bp.frequency.cancelScheduledValues(t);
        pan.pan.cancelScheduledValues(t);
        bp.frequency.exponentialRampToValueAtTime(
            Math.max(120, targetF),
            t + 0.05
        );
        pan.pan.linearRampToValueAtTime(lerp(-0.95, 0.95, p), t + 0.05);
        v.gain.cancelScheduledValues(t);
        v.gain.linearRampToValueAtTime(0.08 + p * 0.12, t + 0.04);
        const dp = p - (S._beam.lastProg || 0);
        const speed =
            Math.abs(dp) /
            Math.max(
                0.001,
                (performance.now() - (S._beam.tickT || performance.now())) /
                    1000
            );
        if (Math.abs(dp) > 0.01) {
            tick(Math.min(1, 0.2 + speed * 0.15));
            S._beam.tickT = performance.now();
        }
        S._beam.lastProg = p;
    }

    // ---------- UI events (with duck) ----------
    function click() {
        duck(0.5, 0.01, 0.05, 0.12);
        noteUI(1600, null, 0.055, 0.25, "triangle");
    }
    function hover() {
        duck(0.6, 0.01, 0.03, 0.1);
        noteUI(1100, null, 0.04, 0.12, "sine");
    }
    function tick(vol = 0.25) {
        duck(0.55, 0.01, 0.04, 0.12);
        noteUI(2200, 2700, 0.035, vol, "square");
    }
    function ok() {
        duck(0.45, 0.012, 0.09, 0.18);
        noteUI(660, 1320, 0.18, 0.35, "triangle");
        burstNoise(S.revSend, 0.22, {
            type: "highpass",
            f: 1800,
            q: 0.8,
            vol: 0.35,
        });
    }
    function error() {
        duck(0.4, 0.012, 0.11, 0.2);
        burstNoise(S.ui, 0.22, { type: "lowpass", f: 120, q: 0.7, vol: 0.5 });
        noteUI(240, 120, 0.24, 0.28, "sawtooth");
    }
    function handoffBlast() {
        burstNoise(S.beam, 0.9, {
            type: "bandpass",
            f: 1200,
            q: 0.9,
            vol: 0.6,
        });
        S.beam.gain.setTargetAtTime(1.0, now(), 0.03);
        setTimeout(() => S.beam.gain.setTargetAtTime(0.8, now(), 0.15), 180);
        [523.25, 659.25, 783.99].forEach((f, i) =>
            note(S.revSend, "triangle", f * 0.5, f, 0.9, 0.42 - i * 0.06)
        );
        for (let i = 0; i < 8; i++)
            setTimeout(
                () =>
                    note(
                        S.dlySend,
                        "sine",
                        1500 + Math.random() * 1200,
                        null,
                        0.07,
                        0.18
                    ),
                80 + i * 40
            );
    }

    // ---------- autowire ----------
    function autoWire() {
        window.addEventListener("act1:progress", (e) =>
            onProgress(clamp(e.detail?.progress || 0, 0, 1))
        );
        window.addEventListener("act1:complete", () => handoffBlast());
        document.addEventListener(
            "click",
            (e) => {
                const t = e.target.closest("button, a, [role=button], .btn");
                if (t) click();
            },
            true
        );
        document.addEventListener(
            "pointerenter",
            (e) => {
                const t = e.target.closest(".choose, button, .btn, a");
                if (t) hover();
            },
            true
        );
        const typingTicker = () => {
            const active = !!document.querySelector(".is-scanning");
            if (active)
                note(
                    S.ui,
                    "square",
                    1400 + Math.random() * 600,
                    null,
                    0.02,
                    0.12
                );
            S._typingTimer = setTimeout(
                typingTicker,
                active ? 40 + Math.random() * 50 : 120
            );
        };
        typingTicker();
        const vLog = document.getElementById("verifyLog");
        if (vLog) {
            const mo = new MutationObserver((muts) => {
                if (muts.some((m) => m.addedNodes.length)) {
                    tick(0.35);
                }
            });
            mo.observe(vLog, { childList: true });
        }
        const watchVis = (id, fn) => {
            const el = document.getElementById(id);
            if (!el) return;
            const obs = new MutationObserver(() => {
                if (el.hidden === false) fn();
            });
            obs.observe(el, {
                attributes: true,
                attributeFilter: ["hidden", "style", "class"],
            });
        };
        watchVis("bannerGranted", ok);
        watchVis("bannerDenied", error);
    }

    // ---------- public API ----------
    S.init = init;
    S.unlock = async () => {
        try {
            await init();
            await S.ctx.resume();
        } catch {}
    };
    S.setVolume = (v) => {
        if (!S.master) return;
        S.master.gain.setTargetAtTime(clamp(v, 0, 1), now(), 0.03);
    };
    S.mute = (m) => S.setVolume(m ? 0 : 0.9);
    Object.assign(S, { click, hover, ok, error });

    // expose
    window.TPB_SFX = S;

    // lazy init so it’s ready even if module is in <head>
    const boot = async () => {
        try {
            await S.init();
            if (S.ctx && S.ctx.state !== "running") await S.ctx.resume();
        } catch {}
    };
    if (document.readyState !== "loading") boot();
    else document.addEventListener("DOMContentLoaded", boot);
})();
