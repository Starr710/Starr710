// SHADOW CELL — guard personality (Step 10). Every guard has exactly two permanent
// traits for the whole mission: a PRIMARY (dominant) and a SECONDARY (occasional).
// A trait never replaces the awareness state machine: it only nudges a few existing
// decisions through small modifiers, each scaled by the trait's weight (primary 1,
// secondary 0.4 by default), and only in calm situations:
//   CURIOUS (suspicion and investigation, while not alerted): unusual sounds weigh a
//     little more, repeated disturbances in one area are remembered longer and add up
//     faster, he sometimes keeps looking at a suspicious spot longer before letting it
//     go, and he searches an investigation area one round longer while still suspicious.
//   BORED (NORMAL only): he sometimes lingers a little longer at a patrol observation
//     point or adds a casual extra look, his pauses vary more, and now and then he
//     shifts his stance while standing (a small procedural torso/head shift).
// Hearing and vision capabilities are never touched, and nothing here acts once he's
// ALERT, searching, in Heightened Security or walking back to his post.
//   FOCUSED (Step 11; disciplined, thorough): repeated evidence is dismissed less readily
//     (suspicion fades more slowly, repeats are remembered longer and add up a little
//     faster), he assesses a sound a moment longer after his reaction, and he searches
//     an investigation spot more thoroughly (longer looks, one more round while still
//     suspicious). On patrol he often adds a deliberate sweep and a little more time at
//     each observation point. A single weak sound still doesn't send him investigating.
//   CARELESS (Step 11; trained, but sometimes overlooks small things): he notices and
//     reacts to a faint sound like anyone (same "huh"), but an isolated weak one (nothing
//     else heard nearby) is often written off afterwards: his suspicion then fades fast.
//     Any further sound in the area cancels the write-off and counts in full, so several
//     steps still convince him. His suspicion also holds and fades a little faster. Investigating ambiguous evidence, he
//     looks a little less long and may stop a round early and conclude it was nothing.
//     On patrol he sometimes cuts an observation short. Strong evidence and anything he
//     recognises are never discounted.
// When two traits push one patrol stop in opposite directions, the primary decides.
// Talkative and Hungry are recognised but have no behaviour yet.
// Randomness is seeded (repeatable); traits are frozen once assigned.
(function (mv) {
  'use strict';

  mv.TRAITS = ['bored', 'focused', 'curious', 'careless', 'talkative', 'hungry'];

  // per-trait effects at full weight (primary); a secondary trait applies them × its weight
  mv.TraitEffects = {
    curious: {
      hearInterest: 0.25,      // × (1 + this) suspicion gained from a heard sound
      repeatBoost: 0.15,       // + to the awareness's repeatBoost (repeated sounds in one area add up faster)…
      repeatMax: 0.5,          // + to its repeatMax…
      repeatWindow: 4,         // + s to its repeatWindow (remembers the disturbances longer)
      closerLook: 0.6,         // chance per incident that he keeps looking longer…
      closerLookTime: 1.5,     // …this many extra seconds before his suspicion starts to fade
      searchRounds: 1,         // + look-around rounds at an investigation spot while still suspicious
    },
    bored: {
      linger: 0.5,             // chance per patrol observation stop that he lingers…
      lingerTime: [1, 2.5],    // …this much longer (s)
      casualLook: 0.4,         // chance per stop of an extra casual look…
      casualLookAngle: 60,     // …up to this many degrees off his facing
      pauseJitter: 0.25,       // ± share of extra variation in how long he observes
      shiftEvery: [9, 18],     // s between stance shifts while he stands calm (÷ weight)…
      shiftTime: [1.8, 3],     // …each lasting this long…
      shiftTorso: 6,           // …turning his torso up to this many degrees…
      shiftHead: 10,           // …and his head up to this many
    },
    focused: {
      repeatBoost: 0.1,        // + to repeatBoost: repeated suspicious activity adds up a little faster…
      repeatWindow: 3,         // …and is remembered this much longer (s)
      decayScale: -0.35,       // × (1 + this) the rate his suspicion fades: he doesn't dismiss it readily
      holdExtra: 1,            // + s his suspicion holds before it starts to fade
      assessExtra: 0.4,        // + s he assesses a sound after his reaction before he may walk off
      searchLookHold: 0.35,    // + s each look-around at an investigation spot
      searchRounds: 1,         // + rounds there while still suspicious (still capped by maxInvestigate)
      sweep: 0.75,             // chance per patrol observation stop of a deliberate extra sweep…
      sweepAngle: 70,          // …this far (°) to the side he hasn't covered…
      sweepTime: [0.6, 1.4],   // …and this much longer at the point (s)
    },
    careless: {
      writeOff: 0.7,           // chance an isolated weak sound (no repeat nearby, below redirectStrength) is written off…
      writeOffFade: 2.5,       // …after which his suspicion fades × (1 + this) faster, holding only…
      writeOffHold: 1.6,       // …this long (s) after the sound (time for his reaction and a glance)
      decayScale: 0.3,         // × (1 + this) the rate his suspicion fades
      holdExtra: -1,           // + s (shorter) his suspicion holds before it fades
      searchLookHold: -0.3,    // + s (shorter) each look-around at an investigation spot
      searchRoundsWeak: -1,    // + rounds when the evidence was ambiguous (peak suspicion below weakEvidence)…
      weakEvidence: 0.85,      // …this peak; never fewer than one round
      shortStop: 0.45,         // chance per patrol observation stop that he cuts it short…
      shortScale: 0.6,         // …to this share of the time, skipping his last look
    },
    talkative: {}, hungry: {},   // recognised; behaviours come later
  };
  mv.IMPLEMENTED_TRAITS = ['curious', 'bored', 'focused', 'careless'];

  mv.PersonalityDefaults = {
    enabled: true,           // influence on (tests of the core AI switch it off; traits stay)
    primary: 'curious', secondary: 'bored',
    weights: { primary: 1, secondary: 0.4 },
    seed: 4242,
  };

  // future ordinary guards: a random, role-appropriate pair, fixed for the mission
  mv.RoleTraitPools = {
    sentry: { bored: 3, focused: 3, curious: 2, careless: 2, talkative: 1, hungry: 1 },
    patrol: { bored: 2, focused: 2, curious: 3, careless: 2, talkative: 2, hungry: 2 },
  };
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  mv.rollPersonality = function (seed, role) {
    const rng = mulberry(seed), pool = Object.assign({}, mv.RoleTraitPools[role] || mv.RoleTraitPools.patrol);
    const pick = () => { const tot = Object.values(pool).reduce((a, b) => a + b, 0); let x = rng() * tot; for (const k in pool) { x -= pool[k]; if (x < 0) return k; } return Object.keys(pool)[0]; };
    const primary = pick(); delete pool[primary];
    return { primary, secondary: pick() };
  };

  const SERIOUS = ['ALERT', 'EVASION', 'HEIGHTENED', 'RETURNING'];
  const lerp = (r, x) => r[0] + (r[1] - r[0]) * x;

  mv.GuardPersonality = function (guard, opts) {
    const o = this.cfg = Object.assign({}, mv.PersonalityDefaults, opts || {});
    if (mv.TRAITS.indexOf(o.primary) < 0 || mv.TRAITS.indexOf(o.secondary) < 0 || o.primary === o.secondary)
      throw new Error('a guard needs one primary and one different secondary trait from: ' + mv.TRAITS.join(', '));
    this.guard = guard;
    this.traits = Object.freeze({ primary: o.primary, secondary: o.secondary });   // permanent for the mission
    this.enabled = o.enabled !== false;
    this.reset();
  };

  mv.GuardPersonality.prototype.reset = function () {
    // one seeded stream per kind of choice, so each repeats exactly whatever the frame timing
    const sd = this.cfg.seed; this.rngs = { incident: mulberry(sd), stop: mulberry(sd + 1), shift: mulberry(sd + 2) };
    this.clock = 0; this.current = null; this.overridden = ''; this.log = []; this.writtenOff = null;
    this.shift = { yaw: 0, head: 0, want: 0, wantHead: 0, until: 0, next: null };
    this.counts = { lingers: 0, casualLooks: 0, shifts: 0, closerLooks: 0, extraRounds: 0, sweeps: 0, shortStops: 0, dismissed: 0, discounted: 0, earlyEnds: 0 };
  };

  // how strongly a trait acts on this guard: its weight as primary / secondary, else 0
  mv.GuardPersonality.prototype.weight = function (trait) {
    if (!this.enabled || mv.IMPLEMENTED_TRAITS.indexOf(trait) < 0) return 0;
    return this.traits.primary === trait ? this.cfg.weights.primary : this.traits.secondary === trait ? this.cfg.weights.secondary : 0;
  };
  mv.GuardPersonality.prototype.effect = function (trait, key) { const e = mv.TraitEffects[trait]; return e && e[key] != null ? e[key] : 0; };
  // the combined additive modifier for a key over his traits (scaled by weight)
  mv.GuardPersonality.prototype.mod = function (key) {
    let m = 0; for (const t of [this.traits.primary, this.traits.secondary]) { const w = this.weight(t), e = this.effect(t, key); if (w && typeof e === 'number') m += e * w; }
    return m;
  };
  mv.GuardPersonality.prototype.chance = function (trait, key, stream) { const w = this.weight(trait); return w > 0 && this.rngs[stream]() < this.effect(trait, key) * w; };

  mv.GuardPersonality.prototype._note = function (trait, what, dur) {
    this.current = { trait, what, until: this.clock + (dur || 2.5) };
    this.log.push({ t: this.clock, trait, what }); if (this.log.length > 40) this.log.shift();
  };

  // ---------------------------------------------------------------- CURIOUS hooks (awareness)
  // a new incident: does he take a closer look this time? (extra seconds before suspicion fades)
  mv.GuardPersonality.prototype.onIncident = function () {
    if (!this.chance('curious', 'closerLook', 'incident')) return 0;
    this.counts.closerLooks++; const t = this.effect('curious', 'closerLookTime');
    this._note('curious', `closer look (+${t.toFixed(1)} s)`, 4); return t;
  };
  // an investigation search round finished while he's still suspicious: another round?
  mv.GuardPersonality.prototype.extraRounds = function () { return Math.round(this.mod('searchRounds')); };
  mv.GuardPersonality.prototype.noteExtraRound = function () { this.counts.extraRounds++; const t = this._lead('searchRounds'); this._note(t, t === 'focused' ? 'checking the area thoroughly (+1 round)' : 'searching a little longer', 4); };
  // the trait contributing most to a modifier (for the developer note)
  mv.GuardPersonality.prototype._lead = function (key) {
    let best = null, v = 0; for (const t of [this.traits.primary, this.traits.secondary]) { const x = Math.abs(this.effect(t, key) * this.weight(t)); if (x > v) { v = x; best = t; } }
    return best;
  };

  // ---------------------------------------------------------------- FOCUSED / CARELESS hooks (awareness)
  // a heard sound, judged (it always counts in full for noticing it): a careless guard may
  // write off an isolated weak one; any further sound nearby cancels that
  mv.GuardPersonality.prototype.judgeSound = function (gain, repeats, strong) {
    if (repeats > 0 || gain >= strong) { if (this.writtenOff) { this.writtenOff = null; this._note('careless', 'another sound: taking it seriously', 3); } return; }
    if (this.chance('careless', 'writeOff', 'incident')) { this.writtenOff = { at: this.clock }; this.counts.discounted++; }
  };
  // how his suspicion fades right now: [extra hold (s), fade multiplier]
  mv.GuardPersonality.prototype.fade = function (sinceEvidence) {
    if (this.writtenOff) { const e = mv.TraitEffects.careless, w = this.weight('careless'); return { hold: e.writeOffHold, scale: 1 + e.writeOffFade * w }; }
    return null;
  };
  // he calmed down without investigating
  mv.GuardPersonality.prototype.onCalm = function () {
    if (this.writtenOff) { this.counts.dismissed++; this._note('careless', 'dismissed weak evidence', 3.5); }
    this.writtenOff = null;
  };
  // rounds at an investigation spot: + thorough (focused, curious), − for ambiguous evidence (careless); at least one
  mv.GuardPersonality.prototype.searchRoundsFor = function (base, peak) {
    const weak = peak < (this.effect('careless', 'weakEvidence') || 0.85);
    return Math.max(1, base + Math.round(this.mod('searchRounds')) + (weak ? Math.round(this.mod('searchRoundsWeak')) : 0));
  };
  mv.GuardPersonality.prototype.noteEarlyEnd = function () { this.counts.earlyEnds++; this._note('careless', 'decided it was nothing (search cut short)', 4); };

  // ---------------------------------------------------------------- BORED hooks (patrol)
  // at a patrol observation stop: extra seconds and an extra casual look (or none)
  // looks: the stop's own look offsets (°), so a focused sweep covers the side they don't
  mv.GuardPersonality.prototype.observeExtras = function (face, looks) {
    const out = { pause: 0, looks: [], scale: 1, dropLast: false }, w = this.weight('bored');
    const r = this.rngs.stop;
    if (w) {
      const e = mv.TraitEffects.bored;
      out.scale = 1 + (r() * 2 - 1) * e.pauseJitter * w;
      if (this.chance('bored', 'linger', 'stop')) { out.pause = lerp(e.lingerTime, r()); out.longer = 'bored'; this.counts.lingers++; this._note('bored', `lingering (+${out.pause.toFixed(1)} s)`, out.pause + 1.5); }
      if (this.chance('bored', 'casualLook', 'stop')) { out.looks.push((r() * 2 - 1) * e.casualLookAngle); this.counts.casualLooks++; this._note('bored', 'a casual look around', 3); }
    }
    // Step 11: focused sweeps (longer, more thorough) and careless short stops; if both come up
    // on one stop they'd contradict each other, so only the primary trait's choice is kept
    const sweep = this.chance('focused', 'sweep', 'stop'), short = this.chance('careless', 'shortStop', 'stop');
    const keepSweep = sweep && !(short && this.traits.primary === 'careless'), keepShort = short && !(sweep && this.traits.primary === 'focused');
    if (keepSweep) {
      const f = mv.TraitEffects.focused, lean = (looks || []).reduce((a, b) => a + b, 0);
      out.looks.push((lean > 0 ? -1 : 1) * f.sweepAngle); const t = lerp(f.sweepTime, r()); out.pause += t;
      this.counts.sweeps++; this._note('focused', `deliberate sweep (+${t.toFixed(1)} s)`, 3.5);
    }
    if (keepShort) {
      out.scale *= mv.TraitEffects.careless.shortScale; out.dropLast = true; out.pause = keepSweep ? out.pause : 0; out.looks.length = 0;
      this.counts.shortStops++; this._note('careless', 'a quick look and moving on', 3);
    }
    return out;
  };

  // ---------------------------------------------------------------- per frame (guard.js)
  // calm: true while he's NORMAL and standing still; returns the stance shift to layer on
  mv.GuardPersonality.prototype.update = function (dt, state, calm) {
    this.clock += dt;
    const s = this.shift, w = this.weight('bored'), e = mv.TraitEffects.bored, rs = this.rngs.shift;
    // serious states put the whole personality on hold; suspicion and investigation only the casual (bored) side
    this.overridden = SERIOUS.indexOf(state) >= 0 ? state + ' (personality on hold)' : state !== 'NORMAL' ? state + ' (casual behaviour on hold)' : '';
    if (SERIOUS.indexOf(state) >= 0 || state === 'INVESTIGATING') this.writtenOff = null;   // he's taking it seriously now
    if (state !== 'NORMAL') { s.want = 0; s.wantHead = 0; s.next = null; if (this.current && this.current.trait === 'bored') this.current = null; }
    else if (w) {
      if (s.next == null) s.next = this.clock + lerp(e.shiftEvery, rs()) / w;
      if (calm && !s.want && this.clock >= s.next) {
        const side = rs() < 0.5 ? -1 : 1, dur = lerp(e.shiftTime, rs());
        s.want = side * e.shiftTorso * (0.6 + 0.4 * rs()) * Math.PI / 180; s.wantHead = side * e.shiftHead * (0.5 + 0.5 * rs()) * Math.PI / 180; s.until = this.clock + dur;
        this.counts.shifts++; this._note('bored', 'shifting his stance', dur);
      }
      if (s.want && (this.clock >= s.until || !calm)) { s.want = 0; s.wantHead = 0; s.next = this.clock + lerp(e.shiftEvery, rs()) / w; }
    }
    // eased (a slow, small shift; it never snaps)
    const k = 1 - Math.exp(-2.2 * dt);
    s.yaw += (s.want - s.yaw) * k; s.head += (s.wantHead - s.head) * k;
    if (this.current && this.clock > this.current.until) this.current = null;
  };

  // short status for the developer view
  mv.GuardPersonality.prototype.status = function () {
    const t = this.traits, now = this.current ? `${this.current.trait}: ${this.current.what}` : '—';
    return `${t.primary.toUpperCase()} (primary) · ${t.secondary.toUpperCase()} (secondary)` + (this.enabled ? ` · ${now}` : ' · influence off') + (this.overridden ? ` · overridden by ${this.overridden}` : '');
  };
})(SC.mv);
