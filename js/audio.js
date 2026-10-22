// SHADOW CELL — synthesized audio (no asset files): jungle ambience, footsteps, foley.
(function (SC) {
  'use strict';

  const A = SC.audio = { on: true };
  let ctx = null, master = null, noiseBuf = null, birdTimer = 0;

  function makeNoise(seconds) {
    const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
    return b;
  }

  // Must be called from a user gesture (iOS requirement).
  A.start = function () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = A.on ? 0.8 : 0; master.connect(ctx.destination);
    noiseBuf = makeNoise(3);

    // insects: band-passed noise with slow tremolo
    const ins = ctx.createBufferSource(); ins.buffer = noiseBuf; ins.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 6;
    const ig = ctx.createGain(); ig.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 7; const lg = ctx.createGain(); lg.gain.value = 0.025;
    lfo.connect(lg); lg.connect(ig.gain); lfo.start();
    ins.connect(bp); bp.connect(ig); ig.connect(master); ins.start();
    // wind / canopy rustle
    const wind = ctx.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true; wind.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const wg = ctx.createGain(); wg.gain.value = 0.12;
    wind.connect(lp); lp.connect(wg); wg.connect(master); wind.start();
  };

  A.setOn = function (on) { A.on = on; if (master) master.gain.value = on ? 0.8 : 0; };

  function burst(dur, freq, type, gain, q) {
    if (!ctx || !A.on) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 2, dur + 0.05);
  }

  A.step = function (noise, stance) {
    const g = 0.04 + noise * 0.22;
    burst(stance === 'prone' ? 0.25 : 0.09, stance === 'prone' ? 900 : 650 + Math.random() * 300, 'lowpass', g, 0.7);
  };
  A.cloth = function () { burst(0.14, 2200, 'bandpass', 0.05, 0.8); };
  A.clack = function () {
    if (!ctx || !A.on) return;
    burst(0.06, 2500, 'highpass', 0.35, 1);
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.08);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.12);
  };

  function bird() {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const base = 1800 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 4);
    o.type = 'sine';
    g.gain.value = 0;
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.16;
      o.frequency.setValueAtTime(base, s); o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.5), s + 0.1);
      g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(0.03, s + 0.02); g.gain.linearRampToValueAtTime(0.0001, s + 0.12);
    }
    o.connect(g);
    if (p) { p.pan.value = Math.random() * 2 - 1; g.connect(p); p.connect(master); } else g.connect(master);
    o.start(t); o.stop(t + n * 0.16 + 0.1);
  }

  A.update = function (dt) {
    if (!ctx || !A.on) return;
    birdTimer -= dt;
    if (birdTimer < 0) { birdTimer = 2 + Math.random() * 6; bird(); }
  };
})(window.SC);
