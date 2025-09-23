
const SFX = (() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    const supportsAudio = !!AC;
    let ctx = null,
        started = false,
        unlocked = false;
    let master, limiter, reverb, revSend, delay, dlySend;
    let bedSrc = null,
        bedGain,
        drone = null,
        droneGain;
    let tickTimer = null,
        servoTimer = null;
    let overlayDucked = false;
    let mode = "beauty";

    const prefersReduced =
        matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;

    // ---------- Utils ----------
    const now = () => ctx?.currentTime ?? 0;
    const db = (n) => Math.pow(10, n / 20);
    const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

    const COLORS = {
        beauty: { tonic: 220.0, osc: "sine", hue: "soft" },
        power: { tonic: 185.0, osc: "sawtooth", hue: "hot" },
        survival: { tonic: 196.0, osc: "triangle", hue: "icy" },
    };

    // ---------- Core graph ----------
    function makeMaster() {
        master = ctx.createGain();
        master.gain.value = db(-10);

        limiter = ctx.createDynamicsCompressor();
        // ✅ Correct: set AudioParam.value directly
        limiter.threshold.value = -16;
        limiter.knee.value = 18;
        limiter.ratio.value = 8;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.22;

        // Reverb
        reverb = ctx.createConvolver();
        reverb.buffer = makeIR(ctx, {
            seconds: 2.7,
            decay: 2.2,
            color: 0.55,
            size: 1.0,
            stereo: 1,
        });
        revSend = ctx.createGain();
        revSend.gain.value = db(-11);

        // Delay
        delay = ctx.createDelay(1.6);
        delay.delayTime.value = 0.26;
        const fb = ctx.createGain();
        fb.gain.value = 0.28;
        delay.connect(fb).connect(delay);
        dlySend = ctx.createGain();
        dlySend.gain.value = db(-18);

        // Wiring
        revSend.connect(reverb).connect(master);
        dlySend.connect(delay).connect(master);
        master.connect(limiter).connect(ctx.destination);
    }

    function makeIR(
        context,
        { seconds = 2.5, decay = 2.0, size = 1.0, color = 0.5, stereo = 1 } = {}
    ) {
        const rate = context.sampleRate,
            len = Math.floor(rate * seconds);
        const buf = context.createBuffer(2, len, rate);
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            for (let i = 0; i < len; i++) {
                const t = i / len;
                const env =
                    Math.pow(1 - t, decay) *
                    (0.5 + 0.5 * Math.cos(Math.PI * t * size));
                const n =
                    (Math.random() * 2 - 1) *
                    (0.82 + 0.18 * Math.cos(i * 0.005 * (ch ? 1.2 : 1)));
                d[i] =
                    n *
                    env *
                    (stereo ? (ch ? 1.0 : 0.96) : 1) *
                    (0.6 + 0.4 * color);
            }
        }
        return buf;
    }

    // ---------- Bed ----------
    function startBed() {
        if (bedSrc) return; // idempotent
        bedGain = ctx.createGain();
        bedGain.gain.value = db(-16);
        bedSrc = ctx.createBufferSource();
        bedSrc.buffer = makeBedBuf();
        bedSrc.loop = true;

        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 24;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 700;
        lp.Q.value = 0.6;

        const lfo = ctx.createOscillator();
        lfo.type = "sine";
        lfo.frequency.value = 0.05;
        const lAmt = ctx.createGain();
        lAmt.gain.value = 240;
        lfo.connect(lAmt).connect(lp.frequency);
        lfo.start();

        bedSrc.connect(hp).connect(lp).connect(bedGain).connect(master);
        bedGain.connect(revSend);
        bedSrc.start();
    }
    function makeBedBuf() {
        const len = Math.floor(ctx.sampleRate * 3.0),
            buf = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            let b = 0;
            for (let i = 0; i < len; i++) {
                const w = Math.random() * 2 - 1;
                b = (b + 0.015 * w) / 1.015;
                const flutter =
                    0.008 * Math.sin(i * 0.013 + ch * 0.7) +
                    0.006 * Math.sin(i * 0.0073);
                d[i] = (b + flutter) * 0.9;
            }
        }
        return buf;
    }

    // ---------- Drone ----------
    function startDrone() {
        if (droneGain) return;
        droneGain = ctx.createGain();
        droneGain.gain.value = db(-18);
        const stack = droneStack(COLORS[mode]);
        stack.out.connect(droneGain);
        droneGain.connect(master);
        droneGain.connect(revSend);
        droneGain.connect(dlySend);

        if (ctx.createStereoPanner) {
            const pan = ctx.createStereoPanner();
            pan.pan.value = 0;
            droneGain.disconnect();
            droneGain.connect(pan).connect(master);
            droneGain.connect(pan).connect(revSend);
            droneGain.connect(pan).connect(dlySend);
            const lfo = ctx.createOscillator();
            lfo.frequency.value = 0.03;
            const amt = ctx.createGain();
            amt.gain.value = 0.6;
            lfo.connect(amt).connect(pan.pan);
            lfo.start();
        }
        drone = stack;
    }
    function droneStack({ tonic, osc, hue }) {
        const out = ctx.createGain();
        out.gain.value = 1;
        const voices = [];
        [0, 7, 12].forEach((st, i) => {
            const o = ctx.createOscillator();
            o.type = osc;
            o.frequency.value = tonic * Math.pow(2, st / 12);
            const g = ctx.createGain();
            g.gain.value = [db(-18), db(-14), db(-16)][i];

            const vib = ctx.createOscillator();
            vib.frequency.value = 0.08 + i * 0.02;
            const vAmt = ctx.createGain();
            vAmt.gain.value = hue === "hot" ? 2.0 : 1.2;
            vib.connect(vAmt).connect(o.frequency);
            vib.start();

            const sat = waveSaturator(hue === "hot" ? 0.6 : 0.35);
            const lp = ctx.createBiquadFilter();
            lp.type = "lowpass";
            lp.frequency.value =
                { soft: 1400, hot: 900, icy: 1200 }[hue] || 1200;
            lp.Q.value = { soft: 0.7, hot: 0.95, icy: 1.05 }[hue] || 0.9;

            o.connect(g).connect(sat).connect(lp).connect(out);
            o.start();
            voices.push(g);
        });
        const t = now();
        voices.forEach((g, i) => {
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(g.gain.value, t + 2 + i * 0.35);
        });
        return { out, voices };
    }
    function waveSaturator(amount = 0.4) {
        const ws = ctx.createWaveShaper(),
            n = 44100,
            curve = new Float32Array(n),
            k = 2 * amount * 100;
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
        }
        ws.curve = curve;
        ws.oversample = "4x";
        return ws;
    }

    // ---------- One-shots ----------
    function impulse(dur = 0.01) {
        const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const b = ctx.createBuffer(1, len, ctx.sampleRate);
        b.getChannelData(0)[0] = 1;
        return b;
    }
    function noise(dur = 0.25) {
        const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const b = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return b;
    }
    function chain(src, nodeA, nodeB, pan = 0, sendFX = true) {
        let last = src;
        if (nodeA) {
            src.connect(nodeA);
            last = nodeA;
        }
        if (nodeB) {
            nodeA?.connect(nodeB);
            last = nodeB;
        }
        if (ctx.createStereoPanner) {
            const p = ctx.createStereoPanner();
            p.pan.value = pan;
            last.connect(p).connect(master);
            if (sendFX) {
                last.connect(p).connect(revSend);
            }
        } else {
            last.connect(master);
            if (sendFX) last.connect(revSend);
        }
    }
    function cleanup(...nodes) {
        setTimeout(
            () =>
                nodes.forEach((n) => {
                    try {
                        n.disconnect?.();
                    } catch {}
                }),
            1200
        );
    }

    function click({ level = -18, pan = 0, tone = 1800 } = {}) {
        const n = ctx.createBufferSource();
        n.buffer = impulse(0.006);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = tone;
        bp.Q.value = 6;
        const g = ctx.createGain();
        g.gain.value = db(level);
        chain(n, bp, g, pan, true);
        n.start();
        cleanup(n, bp, g);
    }
    function beep({
        freq = 880,
        dur = 0.1,
        level = -16,
        glide = 1.0,
        pan = 0,
    } = {}) {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = freq;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 2400;
        f.Q.value = 0.9;
        const g = ctx.createGain();
        g.gain.value = db(level);
        const t = now();
        o.frequency.setValueAtTime(freq, t);
        o.frequency.exponentialRampToValueAtTime(
            Math.max(1, freq * glide),
            t + dur * 0.7
        );
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(db(level), t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        chain(o, f, g, pan, true);
        g.connect(dlySend);
        o.start(t);
        o.stop(t + dur + 0.05);
        cleanup(o, f, g);
    }
    function whoosh({ base = 300, hot = false, level = -18 } = {}) {
        const n = ctx.createBufferSource();
        n.buffer = noise(0.4);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 2.8;
        bp.frequency.value = base;
        const g = ctx.createGain();
        g.gain.value = db(level);
        const t = now();
        bp.frequency.setValueAtTime(base, t);
        bp.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.08);
        bp.frequency.exponentialRampToValueAtTime(
            base * (hot ? 2.1 : 1.7),
            t + 0.35
        );
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(db(level + 6), t + 0.06);
        g.gain.exponentialRampToValueAtTime(db(level - 10), t + 0.35);
        chain(n, bp, g, (Math.random() * 2 - 1) * 0.55, true);
        n.start();
        cleanup(n, bp, g);
    }
    function sparkle({ level = -22 } = {}) {
        for (let i = 0; i < 5; i++)
            setTimeout(
                () =>
                    beep({
                        freq: 1200 + Math.random() * 1600,
                        dur: 0.06,
                        level,
                        glide: 1.02,
                        pan: (Math.random() * 2 - 1) * 0.7,
                    }),
                i * 24
            );
    }
    function thud({ level = -10 } = {}) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = 140;
        const g = ctx.createGain();
        g.gain.value = db(level);
        const t = now();
        o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(db(level), t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        chain(o, null, g, 0, false);
        o.start(t);
        o.stop(t + 0.3);
        cleanup(o, g);
    }

    // ---------- Ambient schedulers ----------
    function scheduleTicks() {
        clearInterval(tickTimer);
        const base = mode === "power" ? 360 : 520;
        tickTimer = setInterval(() => {
            click({
                level: -22,
                pan: (Math.random() * 2 - 1) * 0.2,
                tone: mode === "beauty" ? 1400 : 2200,
            });
            if (Math.random() < 0.35)
                beep({
                    freq: COLORS[mode].tonic * (Math.random() < 0.5 ? 2 : 3),
                    dur: 0.08,
                    level: -20,
                    glide: 1.12,
                    pan: (Math.random() * 2 - 1) * 0.25,
                });
        }, base);
    }
    function scheduleServos() {
        clearInterval(servoTimer);
        servoTimer = setInterval(() => {
            if (Math.random() < 0.55)
                whoosh({
                    base: mode === "power" ? 420 : 280,
                    hot: mode === "power",
                });
        }, 1300);
    }

    // ---------- Public API ----------
    async function init() {
        if (!supportsAudio || started) return;
        ctx = new AC({ latencyHint: "interactive" });
        makeMaster();
        started = true;

        // Expose for diagnostics
        SFX.__ctx = ctx;

        document.addEventListener("visibilitychange", () => {
            if (!ctx) return;
            if (document.hidden) fadeMasterTo(db(-30), 0.25);
            else fadeMasterTo(db(-10), 0.45);
        });
    }

    async function unlock() {
        if (!supportsAudio || unlocked || !started) return;
        if (ctx.state === "suspended") {
            try {
                await ctx.resume();
            } catch {}
        }
        startBed();
        startDrone();
        if (!prefersReduced) {
            scheduleTicks();
            scheduleServos();
        }
        unlocked = true;
    }

    function setMode(next) {
        if (!COLORS[next]) return;
        mode = next;
        if (!unlocked) return;
        try {
            drone?.out?.disconnect?.();
        } catch {}
        drone = null;
        droneGain = null;
        startDrone();
        beep({
            freq: COLORS[mode].tonic * 2,
            dur: 0.09,
            level: -18,
            glide: 1.03,
        });
    }

    function onCardHover(key) {
        if (!unlocked) return;
        beep({
            freq: COLORS[key]?.tonic * 2 || 880,
            dur: 0.06,
            level: -22,
            glide: 1.01,
            pan: (Math.random() * 2 - 1) * 0.25,
        });
    }
    function onEngage(key) {
        setMode(key);
        whoosh({
            base: (COLORS[key]?.tonic || 220) * 0.9,
            hot: key === "power",
            level: -16,
        });
        beep({
            freq: COLORS[key]?.tonic * 3 || 660,
            dur: 0.12,
            level: -14,
            glide: 1.12,
            pan: 0.1,
        });
        duck(droneGain, db(-18), db(-12), 0.18, 0.5);
    }
    function onCombineArmed() {
        if (!unlocked) return;
        const T = COLORS[mode].tonic;
        [1, 5 / 4, 3 / 2].forEach((r, i) =>
            setTimeout(
                () => beep({ freq: T * r * 2, dur: 0.14, level: -16 }),
                i * 80
            )
        );
        sparkle({ level: -24 });
    }
    function onStudioOpen() {
        if (!unlocked || overlayDucked) return;
        overlayDucked = true;
        duck(master, master.gain.value, db(-14), 0.15, 0.0);
    }
    function onStudioClose() {
        if (!unlocked) return;
        overlayDucked = false;
        duck(master, master.gain.value, db(-10), 0.25, 0.0);
    }
    function onStudioNew() {
        if (!unlocked) return;
        click({ level: -18, tone: 1600 });
        sparkle({ level: -28 });
    }
    function onStudioSave() {
        if (!unlocked) return;
        beep({ freq: 1100, dur: 0.08, level: -18, glide: 1.0 });
        sparkle({ level: -22 });
    }
    function onTrialOpen() {
        if (!unlocked) return;
        whoosh({ base: 320, hot: mode === "power", level: -18 });
        beep({
            freq: (COLORS[mode].tonic || 220) * 2,
            dur: 0.1,
            level: -16,
            glide: 1.05,
        });
    }
    function onTrialSuccess(key) {
        if (!unlocked) return;
        const T = COLORS[key || mode]?.tonic || 220;
        [1, 5 / 4, 3 / 2, 2].forEach((r, i) =>
            setTimeout(
                () => beep({ freq: T * r * 2, dur: 0.12, level: -14 }),
                i * 80
            )
        );
        sparkle({ level: -20 });
    }
    function onTrialFail() {
        if (!unlocked) return;
        thud({ level: -8 });
        beep({ freq: 220, dur: 0.08, level: -22, glide: 0.96 });
    }
    function onTrialAbort() {
        if (!unlocked) return;
        whoosh({ base: 260, level: -22 });
    }
    function toAct3() {
        if (!unlocked) return;
        whoosh({ base: 360, hot: true, level: -14 });
        whoosh({ base: 280, level: -16 });
        fadeMasterTo(db(-26), 0.8);
    }

    function duck(g, from, to, attack = 0.12, release = 0.4) {
        if (!g) return;
        const t = now();
        try {
            g.gain.cancelScheduledValues(t);
            g.gain.setValueAtTime(from, t);
            g.gain.linearRampToValueAtTime(to, t + attack);
            g.gain.linearRampToValueAtTime(from, t + attack + release);
        } catch {}
    }
    function fadeMasterTo(target, time = 0.5) {
        const t = now();
        try {
            master.gain.cancelScheduledValues(t);
            master.gain.setValueAtTime(master.gain.value, t);
            master.gain.linearRampToValueAtTime(target, t + time);
        } catch {}
    }

    // ---------- Expose ----------
    const api = {
        init,
        unlock,
        setMode,
        onCardHover,
        onEngage,
        onCombineArmed,
        onStudioOpen,
        onStudioClose,
        onStudioNew,
        onStudioSave,
        onTrialOpen,
        onTrialSuccess,
        onTrialFail,
        onTrialAbort,
        toAct3,
        __ctx: null, // populated in init
    };
    return api;
})();

window.SFX = SFX;

/* ============================================================================
   AUTOPLAY BOOTSTRAP (no click required where allowed)
   ========================================================================== */
(function autoplayBoot() {
    if (!("SFX" in window)) return;

    const SILENT_WAV =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

    async function nudge() {
        try {
            await SFX.init();
        } catch {}
        try {
            await SFX.unlock();
        } catch {}

        // Silent element nudge
        try {
            const el = new Audio(SILENT_WAV);
            el.muted = true;
            el.autoplay = true;
            el.playsInline = true;
            el.loop = false;
            el.style.cssText = "position:absolute;width:0;height:0;opacity:0";
            document.body.appendChild(el);
            await el.play().catch(() => {});
            setTimeout(() => el.remove(), 500);
            try {
                await SFX.unlock();
            } catch {}
        } catch {}

        // Resume loop (a few seconds of polite retries)
        let tries = 0;
        const retry = async () => {
            tries++;
            try {
                await SFX.unlock();
            } catch {}
            if (tries < 20) setTimeout(retry, 250);
        };
        setTimeout(retry, 200);

        // Also retry on focus/visibility
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) SFX.unlock();
        });
        window.addEventListener("focus", () => SFX.unlock());
        window.addEventListener("pageshow", () => SFX.unlock());
    }

    if (document.readyState !== "loading") nudge();
    else document.addEventListener("DOMContentLoaded", nudge);

    // Gesture fallback (harmless if already unlocked)
    const fallback = async () => {
        await SFX.unlock();
    };
    document.addEventListener("pointerdown", fallback, { once: true });
    document.addEventListener(
        "keydown",
        (e) => {
            const k = e.key?.toLowerCase?.();
            if (k === "enter" || k === "e" || k === " ") fallback();
        },
        { once: true }
    );
})();

/* ============================================================================
   OPTIONAL: convenience wiring (safe if you already have a bridge)
   ========================================================================== */
(function optionalEventWire() {
    if (window.__TPB_SFX_WIRED__) return;
    window.__TPB_SFX_WIRED__ = true;

    window.addEventListener("tpb:hover", (e) =>
        SFX.onCardHover?.(e.detail?.key)
    );
    window.addEventListener("tpb:engage", (e) => SFX.onEngage?.(e.detail?.key));
    window.addEventListener("tpb:combine:armed", () => SFX.onCombineArmed?.());
    window.addEventListener("tpb:studio:open", () => SFX.onStudioOpen?.());
    window.addEventListener("tpb:studio:close", () => SFX.onStudioClose?.());
    window.addEventListener("tpb:studio:new", (e) =>
        SFX.onStudioNew?.(e.detail)
    );
    window.addEventListener("tpb:studio:save", (e) =>
        SFX.onStudioSave?.(e.detail)
    );
    window.addEventListener("tpb:toAct3", () => SFX.toAct3?.());
    window.addEventListener("tpb:trial:open", (e) =>
        SFX.onTrialOpen?.(e.detail)
    );
    window.addEventListener("tpb:trial:success", (e) =>
        SFX.onTrialSuccess?.(e.detail)
    );
    window.addEventListener("tpb:trial:fail", (e) =>
        SFX.onTrialFail?.(e.detail)
    );
})();
