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
// Focused, Careless, Talkative and Hungry are recognised but have no behaviour yet.
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
    focused: {}, careless: {}, talkative: {}, hungry: {},   // recognised; behaviours come later
  };
  mv.IMPLEMENTED_TRAITS = ['curious', 'bored'];

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
    this.clock = 0; this.current = null; this.overridden = ''; this.log = [];
    this.shift = { yaw: 0, head: 0, want: 0, wantHead: 0, until: 0, next: null };
    this.counts = { lingers: 0, casualLooks: 0, shifts: 0, closerLooks: 0, extraRounds: 0 };
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
  mv.GuardPersonality.prototype.noteExtraRound = function () { this.counts.extraRounds++; this._note('curious', 'searching a little longer', 4); };

  // ---------------------------------------------------------------- BORED hooks (patrol)
  // at a patrol observation stop: extra seconds and an extra casual look (or none)
  mv.GuardPersonality.prototype.observeExtras = function (face) {
    const out = { pause: 0, looks: [], scale: 1 }, w = this.weight('bored');
    if (!w) return out;
    const e = mv.TraitEffects.bored, r = this.rngs.stop;
    out.scale = 1 + (r() * 2 - 1) * e.pauseJitter * w;
    if (this.chance('bored', 'linger', 'stop')) { out.pause = lerp(e.lingerTime, r()); this.counts.lingers++; this._note('bored', `lingering (+${out.pause.toFixed(1)} s)`, out.pause + 1.5); }
    if (this.chance('bored', 'casualLook', 'stop')) { out.looks.push((r() * 2 - 1) * e.casualLookAngle); this.counts.casualLooks++; this._note('bored', 'a casual look around', 3); }
    return out;
  };

  // ---------------------------------------------------------------- per frame (guard.js)
  // calm: true while he's NORMAL and standing still; returns the stance shift to layer on
  mv.GuardPersonality.prototype.update = function (dt, state, calm) {
    this.clock += dt;
    const s = this.shift, w = this.weight('bored'), e = mv.TraitEffects.bored, rs = this.rngs.shift;
    // serious states put the whole personality on hold; suspicion and investigation only the casual (bored) side
    this.overridden = SERIOUS.indexOf(state) >= 0 ? state + ' (personality on hold)' : state !== 'NORMAL' ? state + ' (casual behaviour on hold)' : '';
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
