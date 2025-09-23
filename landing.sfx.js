(() => {
    const P5S_URL =
        "https://cdn.jsdelivr.net/npm/p5@1.9.3/lib/addons/p5.sound.min.js";

    const $ = (s, c = document) => c.querySelector(s);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const prefersReduced = matchMedia("(prefers-reduced-motion: reduce)")
        .matches;

    // ---------------- Loader
    let soundReady;
    async function ensureP5Sound() {
        if (
            window.p5 &&
            window.p5.prototype &&
            window.p5.prototype.getAudioContext &&
            window.p5.SoundFile
        )
            return;
        if (!soundReady) {
            soundReady = new Promise((res, rej) => {
                const s = document.createElement("script");
                s.src = P5S_URL;
                s.async = true;
                s.onload = res;
                s.onerror = rej;
                document.head.appendChild(s);
            });
        }
        await soundReady;
    }

    // ---------------- Engine state
    let master,
        humA,
        humB,
        lpfA,
        lpfB,
        droneL,
        droneR,
        noiseAir,
        airBP,
        airHP,
        rev,
        del;
    let sweepNoise, sweepFilter;
    let tickNoise, tickHP, tickEnv;
    let uiOsc, uiEnv;
    let armed = false; // gesture unlocked
    let running = false; // bed running
    let visDuck = false; // visibility duck
    let volBase = prefersReduced ? 0.25 : 0.5; // “global bed” intensity

    // small utility envelopes
    function makeEnv(a = 0.004, d = 0.08, s = 0.0, r = 0.08, peak = 0.3) {
        const e = new p5.Envelope();
        e.setADSR(a, d, s, r);
        e.setRange(peak, 0);
        return e;
    }

    // ---------------- Build graph
    async function build() {
        await ensureP5Sound();

        // Master bus
        master = new p5.Gain();
        master.amp(0); // fade-in after unlock
        master.connect();

        // Sub-reactor hum: two detuned oscillators into LPF + a hint of saturation via delay feedback
        humA = new p5.Oscillator("sawtooth");
        humA.freq(62);
        humA.amp(0);
        humB = new p5.Oscillator("sawtooth");
        humB.freq(62 * 2.01);
        humB.amp(0);
        lpfA = new p5.LowPass();
        lpfA.freq(180);
        lpfA.res(2.2);
        lpfB = new p5.LowPass();
        lpfB.freq(220);
        lpfB.res(1.4);

        del = new p5.Delay();
        del.feedback(0.12);
        del.filter(1200);
        del.process(lpfA, 0.03, 0.12, 1200); // tiny grit

        humA.disconnect();
        humA.connect(lpfA);
        humB.disconnect();
        humB.connect(lpfB);
        lpfA.disconnect();
        lpfA.connect(master);
        lpfB.disconnect();
        lpfB.connect(master);
        humA.start();
        humB.start();

        // Air recirculation hiss: white noise through a bandpass + highpass + reverb
        noiseAir = new p5.Noise("white");
        noiseAir.amp(0);
        airBP = new p5.BandPass();
        airBP.freq(1900);
        airBP.res(3.2);
        airHP = new p5.HighPass();
        airHP.freq(180);
        airHP.res(0.2);
        rev = new p5.Reverb();
        rev.process(airHP, 2.5, 2);

        noiseAir.disconnect();
        noiseAir.connect(airBP);
        airBP.disconnect();
        airBP.connect(airHP);
        airHP.disconnect();
        airHP.connect(master);
        noiseAir.start();

        sweepNoise = new p5.Noise("pink");
        sweepNoise.amp(0);
        sweepFilter = new p5.BandPass();
        sweepFilter.freq(400);
        sweepFilter.res(10);
        sweepNoise.disconnect();
        sweepNoise.connect(sweepFilter);
        sweepFilter.disconnect();
        sweepFilter.connect(master);
        sweepNoise.start();

        droneL = new p5.Oscillator("sine");
        droneL.freq(110);
        droneL.amp(0);
        droneL.pan(-0.3);
        droneR = new p5.Oscillator("sine");
        droneR.freq(111.2);
        droneR.amp(0);
        droneR.pan(0.3);
        droneL.start();
        droneR.start();

        tickNoise = new p5.Noise("white");
        tickNoise.amp(0);
        tickHP = new p5.HighPass();
        tickHP.freq(3200);
        tickHP.res(2.5);
        tickEnv = makeEnv(0.001, 0.025, 0.0, 0.02, 0.12);
        tickNoise.disconnect();
        tickNoise.connect(tickHP);
        tickHP.disconnect();
        tickHP.connect(master);
        tickNoise.start();

        uiOsc = new p5.Oscillator("triangle");
        uiOsc.freq(880);
        uiOsc.amp(0);
        uiOsc.start();
        uiEnv = makeEnv(0.002, 0.07, 0.0, 0.04, 0.3);

        humA.amp(0);
        humB.amp(0);
        noiseAir.amp(0);
        sweepNoise.amp(0);
        droneL.amp(0);
        droneR.amp(0);
    }

    // ---------------- Modulators (LFO timers)
    let rafId = null,
        last = 0,
        sweepT = 0,
        wob = 0;
    function loop(now) {
        const dt = Math.min(48, now - (last || now));
        last = now;

        // Gently wobble reactor filters
        wob += dt * 0.0012;
        const wobA = 170 + Math.sin(wob * 1.1) * 18;
        const wobB = 230 + Math.cos(wob * 0.9) * 22;
        lpfA?.freq(wobA);
        lpfB?.freq(wobB);

        // LFO depth for hum amps
        const humDepth = 0.04 * volBase;
        const humBase = 0.1 * volBase * (visDuck ? 0.4 : 1);
        const lfo = (1 + Math.sin(wob * 0.8)) * 0.5; // 0..1
        humA?.amp(humBase + humDepth * lfo, 0.2);
        humB?.amp(humBase * 0.8 + humDepth * (1 - lfo) * 0.8, 0.25);

        // Air hiss very slow drift + breath
        const airAmp = 0.08 * volBase * (visDuck ? 0.4 : 1);
        airBP?.freq(1700 + Math.sin(wob * 0.45) * 250);
        airHP?.freq(160 + Math.sin(wob * 0.22) * 40);
        noiseAir?.amp(airAmp, 0.5);

        // Scanner sweep
        sweepT += dt;
        const period = 3600; 
        let ph = (sweepT % period) / period; 
        const eased =
            ph < 0.75
                ? Math.pow(ph / 0.75, 1.5)
                : 1 - Math.pow((ph - 0.75) / 0.25, 3);
        sweepFilter?.freq(380 + eased * 2200);
        sweepFilter?.res(7 + eased * 12);
        sweepNoise?.amp(
            0.02 * volBase * (visDuck ? 0.4 : 1) * (eased * 1.2),
            0.05
        );

        // Drone
        const dr = 0.04 * volBase * (visDuck ? 0.35 : 1);
        droneL?.amp(dr * 0.7, 0.4);
        droneR?.amp(dr * 0.7, 0.4);

        rafId = requestAnimationFrame(loop);
    }

    // ---------------- Public controls
    async function init() {
        if (running) return;
        await build();
        running = true;
        rafId = requestAnimationFrame(loop);

        // Sparse ticks
        setInterval(() => {
            if (!armed || !running || visDuck) return;
            if (Math.random() < 0.42) {
                tickHP?.freq(2800 + Math.random() * 1800);
                tickEnv?.play(tickNoise);
            }
        }, 1200 + Math.random() * 500);

        // Title hover ping
        const title = $(".title-svg") || $(".enter-hint");
        title?.addEventListener("mouseenter", () => ping(0.14));
    }

    async function unlock() {
        if (armed) return;
        armed = true;
        await init();

        try {
            const ctx = getAudioContext();
            if (ctx.state !== "running") await ctx.resume();
        } catch {}

        master?.amp(prefersReduced ? 0.22 : 0.35, 0.9);
    }

    function ping(vel = 0.2) {
        if (!uiOsc || !uiEnv) return;
        uiOsc.freq(740 + Math.random() * 200);
        uiEnv.setRange(vel, 0);
        uiEnv.play(uiOsc);
    }

    function accessFlourish() {
        if (!uiOsc || !uiEnv) return;
        // two-step rising ping + brief airy burst
        uiOsc.freq(880);
        uiEnv.setRange(0.35, 0);
        uiEnv.play(uiOsc);
        setTimeout(() => {
            uiOsc.freq(1320);
            uiEnv.setRange(0.42, 0);
            uiEnv.play(uiOsc);
        }, 110);

        // tiny whoosh via sweep noise lift
        sweepNoise?.amp(0.12 * volBase, 0.02);
        setTimeout(() => sweepNoise?.amp(0.02 * volBase, 0.25), 180);
    }

    // Visibility ducking
    document.addEventListener("visibilitychange", () => {
        visDuck = document.hidden;
        master?.amp(document.hidden ? 0.08 : prefersReduced ? 0.22 : 0.35, 0.4);
    });

    // Global gesture unlocks
    document.addEventListener("pointerdown", unlock, {
        once: true,
        passive: true,
    });
    document.addEventListener("keydown", (e) => {
        const k = e.key?.toLowerCase?.();
        if (!armed && (k === "enter" || k === "e")) unlock();
        if (k === "enter" || k === "e") accessFlourish();
        // soft ui pings on any meaningful key
        if ("wasdijklqeopxz".includes(k)) ping(0.12);
    });

    $(".enter-hint")?.addEventListener("mouseenter", () => ping(0.18));

    window.LANDING_SFX = { init, unlock, ping, accessFlourish };
})();
