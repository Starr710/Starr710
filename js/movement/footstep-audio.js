// SHADOW CELL — movement: footstep sounds per surface (synthesized, no audio files).
// Listens to the noise system: every footstep event from the player plays that
// surface's sound, at a loudness that follows the event's effective intensity
// (so metal is louder and grass softer than concrete, as the noise reach is).
// Web Audio must be unlocked by a user gesture on iOS: call unlock() from a tap.
(function (mv) {
  'use strict';

  mv.FootstepAudioDefaults = {
    volume: 0.9,                       // master volume
    source: 'player',                  // whose footsteps to play
    // loudness by effective intensity (index = intensity, read between entries)
    gainByIntensity: [0.12, 0.28, 0.5, 0.8, 1, 1],
    // per-surface sound: overall gain and the voice that plays it
    surfaces: {
      concrete: { gain: 0.8, voice: 'concrete' },   // dry tap with a soft heel thump
      metal: { gain: 0.75, voice: 'metal' },        // clank with a short metallic ring
      grass: { gain: 0.9, voice: 'grass' },         // soft swish and rustle, no thump
    },
  };

  // ---------------------------------------------------------------- voices
  // Each voice schedules one footstep at time t on any AudioContext (live or
  // offline), with amplitude g. rnd() gives the small per-step variation.
  function noiseBuffer(ctx) {
    if (ctx.__scNoise) return ctx.__scNoise;
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
    let seed = 11; for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = seed / 1073741823.5 - 1; }
    return (ctx.__scNoise = b);
  }
  function env(ctx, t, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }
  function noiseBurst(ctx, out, t, filterType, freq, q, peak, attack, decay, rnd) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx); src.playbackRate.value = 0.9 + rnd() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = env(ctx, t, peak, attack, decay);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, rnd() * 0.5, attack + decay + 0.05);
  }
  function tone(ctx, out, t, type, f0, f1, peak, attack, decay) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    const g = env(ctx, t, peak, attack, decay);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  mv.FOOTSTEP_VOICES = {
    concrete(ctx, out, t, g, rnd) {
      noiseBurst(ctx, out, t, 'bandpass', 1500 + rnd() * 400, 1.1, g * 0.9, 0.003, 0.07, rnd);   // sole on hard ground
      tone(ctx, out, t, 'sine', 110, 55, g * 0.55, 0.004, 0.09);                                  // heel thump
    },
    metal(ctx, out, t, g, rnd) {
      noiseBurst(ctx, out, t, 'highpass', 1800, 0.8, g * 0.75, 0.002, 0.04, rnd);                // hard impact
      const k = 1 + (rnd() - 0.5) * 0.06;                                                         // plate ring, slightly detuned per step
      tone(ctx, out, t, 'triangle', 430 * k, 425 * k, g * 0.32, 0.003, 0.75);
      tone(ctx, out, t, 'sine', 1130 * k, 1125 * k, g * 0.22, 0.002, 0.55);
      tone(ctx, out, t, 'sine', 1980 * k, 1975 * k, g * 0.12, 0.002, 0.35);
      tone(ctx, out, t, 'sine', 150, 75, g * 0.45, 0.003, 0.07);                                 // boot on the plate
    },
    grass(ctx, out, t, g, rnd) {
      noiseBurst(ctx, out, t, 'bandpass', 2600 + rnd() * 600, 0.5, g * 0.5, 0.018, 0.16, rnd);   // blades brushing
      noiseBurst(ctx, out, t + 0.01, 'lowpass', 850, 0.7, g * 0.3, 0.006, 0.09, rnd);            // soft crunch underfoot
    },
  };

  // ---------------------------------------------------------------- player
  mv.FootstepAudio = function (noise, opts) {
    this.cfg = Object.assign({}, mv.FootstepAudioDefaults, opts || {});
    this.ctx = null; this.out = null;
    this.played = {}; this.last = null;   // per-surface counts and the last step (stats, tests)
    noise.on(ev => { if (ev.type === 'footstep' && ev.source === this.cfg.source) this.play(ev); });
  };

  // create / resume the audio context; call from a tap (iOS needs a user gesture)
  mv.FootstepAudio.prototype.unlock = function () {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.out = this.ctx.createGain(); this.out.gain.value = this.cfg.volume; this.out.connect(this.ctx.destination);
      // a silent buffer started inside the gesture finishes the unlock on older iOS
      const s = this.ctx.createBufferSource(); s.buffer = this.ctx.createBuffer(1, 1, 22050); s.connect(this.ctx.destination); s.start(0);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  };
  mv.FootstepAudio.prototype.suspend = function () { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); };

  // amplitude of a step: surface gain × loudness at the event's effective intensity
  mv.FootstepAudio.prototype.gainFor = function (ev) {
    const c = this.cfg, s = c.surfaces[ev.surface] || c.surfaces.concrete, tab = c.gainByIntensity;
    const i = Math.max(0, Math.min(tab.length - 1, ev.intensity != null ? ev.intensity : ev.level)), k = Math.min(tab.length - 2, Math.floor(i));
    return s.gain * (tab[k] + (tab[k + 1] - tab[k]) * (i - k));
  };

  mv.FootstepAudio.prototype.play = function (ev) {
    const c = this.cfg, s = c.surfaces[ev.surface] || c.surfaces.concrete;
    this.played[ev.surface] = (this.played[ev.surface] || 0) + 1;
    this.last = { surface: ev.surface, voice: s.voice, gain: this.gainFor(ev) };
    if (!this.ctx || this.ctx.state !== 'running') return;
    mv.FOOTSTEP_VOICES[s.voice](this.ctx, this.out, this.ctx.currentTime + 0.005, this.last.gain, Math.random);
  };
})(SC.mv);
