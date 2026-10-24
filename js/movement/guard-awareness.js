// SHADOW CELL — guard awareness: suspicion, investigation, alert and evasion
// (docs/GAME_DESIGN.md §5–6). The guard's brain. States:
//   NORMAL         at his post, idle; hears and sees normally
//   SUSPICIOUS     something caught his attention: he turns to it and assesses
//   INVESTIGATING  suspicion is significant: he walks to the last suspicious spot,
//                  searches around it, and walks back to his post if nothing turns up
//   ALERT          his vision meter reached 100% (confirmed): while he can see her he
//                  stands his ground, faces her and tracks her with his eyes
//   EVASION        he lost sight of her (after a short grace): a 30 s Active Search of
//                  the last place he saw her, where she was heading and nearby hiding
//                  spots, redirected by meaningful sounds; seeing her again re-alerts him
//   HEIGHTENED     the search ran out: 60 s of Heightened Security. Cautious, not a hunt:
//                  a careful walk to a few nearby corners and routes around his post and
//                  where he lost her, pausing to look; meaningful sounds are checked
//   RETURNING      Heightened Security is over: he walks back to his post, turns to his
//                  original facing and stands down to NORMAL (old suspicion fades)
// Memory is only what he earned and is kept apart: the last place he actually saw her
// (and which way she was going), the last sound he heard (exact origin for the record,
// his approximate estimate of it once alerted), and whether a sighting was confirmed.
// He never reads where she really is: only what his eyes and ears gave him.
// All thresholds and timers are initial test values, adjustable here.
(function (mv) {
  'use strict';

  mv.AwarenessDefaults = {
    suspiciousAt: 0.08,    // suspicion to become SUSPICIOUS…
    investigateAt: 0.6,    // …to go and INVESTIGATE…
    calmAt: 0.04,          // …and below which he relaxes back to NORMAL
    searchRelaxAt: 0.35,   // an investigation search ends (he heads back) once suspicion is below this
    // evidence → suspicion. A heard sound adds hearGain at its effective intensity
    // (read between entries), more when it was close and when it repeats nearby
    hearGain: [0, 0.08, 0.15, 0.25, 0.4, 0.7],
    closeBoost: 1,         // × (1 + closeBoost × (1 − distance / reach))
    repeatRadius: 4,       // m: sounds this close to an earlier one are "the same area"…
    repeatWindow: 8,       // …if heard within this many seconds…
    repeatBoost: 0.25,     // …each adding this much more weight…
    repeatMax: 2,          // …up to this multiplier
    sightGain: 0.8,        // suspicion per unit of vision-meter fill while he (partly) sees her
    holdTime: 3,           // s without new evidence before suspicion starts to fall…
    decayRate: 0.04,       // …per second
    // reactions
    reactDelay: 0.8,       // s a calm guard pauses on the first sound of a new incident before he reacts (head, body, voice)
    assessTime: 0.3,       // s after reacting that he stands and assesses before he may walk off to investigate (pause + this = 1.1 s, as before)
    visualReactDelay: 0.8, // s a calm guard pauses on a first partial glimpse before he reacts (Step 8.2)…
    visualReactMaxMeter: 0.8,  // …but if his vision meter is already this full when it's due, recognition wins: no "huh"
    incidentCalmTime: 4,   // s back in NORMAL with suspicion below calmAt before a new incident (and a new vocal reaction) can begin
    retargetAngle: 12,     // a new sound only redirects his look if this far (°) from the current one…
    retargetGap: 0.8,      // …and this long (s) after the last redirect
    retargetDistance: 3,   // m: while investigating, a sound this far from his target re-targets him
    // investigation movement (pushes are stick-equivalent for the guard's motor)
    walkPush: 0.45,        // ≈1.17 m/s: a careful walk
    slowPush: 0.13,        // ≈1.0 m/s: slowing as he nears the spot…
    slowWithin: 3,         // …within this distance
    arriveWithin: 1.6,     // m from the spot where he lets the walk finish (he stops ~1 m short)
    lookAround: [0, 55, -55, 25],   // ° from the spot's direction, looked at in turn…
    lookHold: 1.1,         // …for this long each
    searchRounds: 2,       // at most this many look-around rounds before heading back
    maxInvestigate: 45,    // s: an investigation never runs longer than this
    // ---- alert and evasion (Step 6)
    alertGrace: 0.75,      // s out of sight before ALERT becomes EVASION (a brief occlusion doesn't flicker)
    reacquireMeter: 0.35,  // during EVASION / HEIGHTENED / RETURNING, a sighting that fills his meter this far re-alerts him
    evasionTime: 30,       // s of Active Search after losing her
    soundExtend: 3,        // s a meaningful new sound adds to the search…
    evasionMax: 40,        // …but the search never lasts longer than this in total
    travelWindow: 0.6,     // s of sightings used to judge which way she was going
    predictTime: 1.5,      // s ahead along that direction he checks first…
    predictMax: 5,         // …at most this far (m)
    hideRadius: 7,         // m around the last-known area where hiding spots are considered
    hideCount: 4,          // hiding spots per search plan
    spotSpacing: 2.5,      // m: spots this close are the same place (no re-checking it)
    searchJitter: 1.5,     // m of random variation in how spots are ranked (search order varies)
    evasionLooks: [0, 60, -60],   // ° from his arrival heading, looked at in turn at each spot…
    evasionLookHold: 0.6,  // …held this long each
    escapeAngle: 45,       // ° either side of her heading for the two escape-direction spots…
    escapeDistance: 4,     // …this far (m) beyond where she was heading
    widen: 1.6,            // when every spot is checked, the next plan searches this much wider
    evasionWithin: 1.0,    // m from a spot where he lets the walk finish
    evasionPush: 0.78,     // ≈1.95 m/s: a hurried search walk (the motor's stealth-walk zone)
    // hearing once alerted: an approximate estimate, not the exact spot. Its spread (m)
    // = base + far × (distance / reach) + weak × max(0, 1 − intensity / 3)
    soundUncertainty: { base: 0.6, far: 3.0, weak: 1.2 },
    uncertainStates: ['ALERT', 'EVASION', 'HEIGHTENED', 'RETURNING'],
    redirectStrength: 0.2, // a sound must be at least this strong (as suspicion gain) to redirect the search…
    redirectDistance: 3,   // …its estimate this far (m) from where he's heading…
    redirectGap: 1.5,      // …and this long (s) after the last redirect
    // ---- heightened security and return to post (Step 7)
    heightenedTime: 60,    // s of Heightened Security after an unsuccessful Active Search
    heightenedExtend: 5,   // s a meaningful sound adds…
    heightenedExtendGap: 8,  // …at most once per this many seconds…
    heightenedMax: 90,     // …and never beyond this many seconds in total
    heightenedPush: 0.45,  // ≈1.17 m/s: a careful walk (Active Search hurries at evasionPush)
    heightenedSpots: 4,    // checkpoints per plan (corners and routes)…
    heightenedRadius: 8,   // …within this distance (m) of the area between his post and where he lost her…
    heightenedLeash: 12,   // …and never farther than this (m) from his post
    heightenedLooks: [0, 80, -80, 30],   // ° looked at, in turn, at each pause…
    heightenedLookHold: 1.4,   // …held this long each (longer, more watchful than the search)
    heightenedWithin: 1.2, // m from a checkpoint where he lets the walk finish
    returnInterruptTime: 15,   // s of caution when a meaningful sound interrupts his walk back
    postArriveWithin: 0.4, // m: close enough to his post…
    postFacingTolerance: 4,    // …and within this many degrees of its facing to stand down
    standDownSuspicion: 0.3,   // suspicion he's left with on standing down (then fades as usual)
    // ---- startle and recovery (Step 12): an unsuspecting guard who recognises her is startled.
    // ALERT starts on the same frame (nothing waits for the startle); while startled he's
    // recovering: not ready for offensive actions (future CQC can use that window)
    startle: {
      enabled: true,
      closeWithin: 3,      // m: recognised this close is a close-range discovery…
      mediumWithin: 9,     // …this close medium range, farther long range (his sight reaches 16 m)
      durations: { close: 1.8, medium: 1.2, far: 0.8 },   // s of startle and recovery
      preparedScale: 0.75, // × when he was already suspicious from something he heard (partly prepared)…
      preparedAfter: 1.5,  // …for at least this long (s). Gradually recognising her from her own glimpse is still a surprise
      rearmTime: 45,       // s after standing down before a new discovery can startle him again
    },
    seed: 1337,            // for the random variation (repeatable in tests)
    debug: true,           // developer markers and stats (separate from any player HUD)
  };

  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const lerpTab = (tab, x) => { const i = Math.max(0, Math.min(tab.length - 1, x)), k = Math.min(tab.length - 2, Math.floor(i)); return tab[k] + (tab[k + 1] - tab[k]) * (i - k); };

  mv.GuardAwareness = function (guard, opts) {
    this.guard = guard;
    this.cfg = Object.assign({}, mv.AwarenessDefaults, opts || {});
    this.reset();
  };

  mv.GuardAwareness.prototype.reset = function () {
    this.clock = 0;
    this.state = 'NORMAL';
    this.behavior = 'idle';
    this.suspicion = 0;
    this.lastEvidence = -Infinity;
    this.heard = null;        // { position, time, intensity, surface }: last sound he heard
    this.seen = null;         // { position, time }: last place he actually saw her
    this.confirmed = false; this.confirmedAt = null;
    this.focus = null;        // { kind: 'heard' | 'seen', position, at }: what he's reacting to
    this.recent = [];         // recent heard sounds, for repetition
    this.lastRedirect = -Infinity; this.redirects = 0;
    this.search = null; this.investigateStart = 0; this.note = '';
    this.track = [];          // recent sightings { position, time }: her direction of travel
    this.lastContact = -Infinity;
    this.evasion = null; this.evasions = 0;
    this.hs = null; this.standDowns = 0; this.stoodDownAt = null; this.interrupted = '';
    // Step 8: one suspicious incident at a time: { start, kind, reactAt, assessUntil, voiced }
    this.incident = null; this.incidents = 0; this.reactions = 0; this.calmSince = null;
    // Step 12: { start, until, duration, band, distance, from } while startled; history for the developer view
    this.startle = null; this.startles = 0; this.startleNote = '';
    this.rng = mulberry(this.cfg.seed);
  };
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------------------------------------------------------------- evidence
  // a sound the guard heard (from guard-hearing.js)
  mv.GuardAwareness.prototype.onHeard = function (rec) {
    const c = this.cfg, p = rec.position.clone();
    this.heard = { position: p, time: this.clock, intensity: rec.intensity, surface: rec.surface, distance: rec.distance, estimate: p.clone(), uncertainty: 0 };
    const P = this.guard.personality, pm = k => (P ? P.mod(k) : 0);         // Step 10: personality modifiers (0 when neutral)
    this.recent = this.recent.filter(r => this.clock - r.time <= c.repeatWindow + pm('repeatWindow'));
    const repeats = this.recent.filter(r => Math.hypot(r.position.x - p.x, r.position.z - p.z) <= c.repeatRadius).length;
    this.recent.push({ position: p, time: this.clock });
    const close = 1 + c.closeBoost * Math.max(0, 1 - rec.distance / Math.max(0.01, rec.reach));
    const repeat = Math.min(c.repeatMax + pm('repeatMax'), 1 + (c.repeatBoost + pm('repeatBoost')) * repeats);
    const base = lerpTab(c.hearGain, rec.intensity) * close * Math.min(c.repeatMax, 1 + c.repeatBoost * repeats);
    if (c.uncertainStates.indexOf(this.state) >= 0) this._estimate(this.heard, rec);
    // alerted: sounds feed the search, judged without personality (it's on hold in serious states)
    if (this.confirmed) { this.lastGain = base; this._alertHeard(this.heard, base); return; }
    let gain = lerpTab(c.hearGain, rec.intensity) * close * repeat * (1 + pm('hearInterest'));
    if (P) P.judgeSound(gain, repeats, c.redirectStrength);            // Step 11: careless may write off an isolated weak sound (after noticing it)
    this.lastGain = gain;
    this.suspicion = Math.min(1, this.suspicion + gain);
    this.lastEvidence = this.clock;
    this._consider('heard', p);
  };

  // something new to react to: redirect his attention if it's clearly elsewhere
  mv.GuardAwareness.prototype._consider = function (kind, p) {
    const c = this.cfg, g = this.guard;
    if (this.state === 'NORMAL' || this.state === 'SUSPICIOUS') {
      const yaw = Math.atan2(p.x - g.position.x, p.z - g.position.z);
      const cur = this.focus ? Math.atan2(this.focus.position.x - g.position.x, this.focus.position.z - g.position.z) : null;
      const apart = cur == null ? Infinity : Math.abs(wrap(yaw - cur)) * 57.2958;
      if (apart >= c.retargetAngle && this.clock - this.lastRedirect >= c.retargetGap) this._setFocus(kind, p);
      else if (this.focus) this.focus.position.copy(p);   // same direction: keep looking, update the spot
    } else if (this.state === 'INVESTIGATING' && this.focus) {
      const far = Math.hypot(p.x - this.focus.position.x, p.z - this.focus.position.z) > c.retargetDistance;
      if (far && this.clock - this.lastRedirect >= c.retargetGap) {
        this._setFocus(kind, p);
        if (this.behavior === 'search' || this.behavior === 'approach' || this.suspicion >= c.investigateAt) this._investigate();
      }
    }
  };

  mv.GuardAwareness.prototype._setFocus = function (kind, p) {
    this.focus = { kind, position: p.clone(), at: this.clock };
    this.lastRedirect = this.clock; this.redirects++;
  };

  // ---------------------------------------------------------------- per frame
  // target: what he can look at (mv.visionTarget); vision has already updated
  mv.GuardAwareness.prototype.update = function (dt, target) {
    const c = this.cfg, g = this.guard, v = g.vision;
    this.clock += dt;
    // sight: every frame he actually sees her, he knows where she is right now
    if (v.seen.rate > 0 && v.seen.position) {
      const p = v.seen.position.clone();        // where she was when he last looked, not where she is now
      this.seen = { position: p, time: this.clock };
      if (!this.confirmed) {
        this.suspicion = Math.min(1, this.suspicion + v.seen.rate * dt * c.sightGain);
        this.lastEvidence = this.clock;
        this._consider('seen', p);
      }
    }
    if (v.seen.rate > 0 && v.seen.position) {
      this.track.push({ position: v.seen.position.clone(), time: this.clock });
      while (this.track.length && this.clock - this.track[0].time > 2) this.track.shift();
    }
    if (!this.confirmed && v.meter >= 1) {
      this.confirmed = true; this.confirmedAt = this.clock;
      this._alert('recognised her');
    }
    if (g.restraint) { this._restrainedFrame(); return; }       // held: contact, no decisions of his own (Step 13)
    this._incidentUpdate(v.seen.rate > 0, v.meter);
    if (this.confirmed) { this.suspicion = 1; this._alerted(); return; }
    const P = g.personality, pm = k => (P ? P.mod(k) : 0);   // Step 11: focused holds and fades slower, careless faster
    const fade = P && P.enabled ? P.fade() : null;                                // a careless write-off: brief hold, fast fade
    const hold = fade ? fade.hold : Math.max(0.5, c.holdTime + (this.incident && this.incident.closer || 0) + pm('holdExtra'));
    if (this.clock - this.lastEvidence > hold) this.suspicion = Math.max(0, this.suspicion - c.decayRate * (1 + pm('decayScale')) * (fade ? fade.scale : 1) * dt);
    if (this.incident && this.state !== 'NORMAL') this.incident.peak = Math.max(this.incident.peak || 0, this.suspicion);

    if (this.state === 'NORMAL') {
      const pat = this._patrolling();
      this.behavior = pat ? 'patrol' : g.atPost() ? 'idle' : 'off post';
      if (this.suspicion >= c.suspiciousAt && this.focus) {
        this.state = 'SUSPICIOUS'; if (!this.incident) this._beginIncident(this.focus.kind);
        if (pat) pat.interrupt(this.focus.kind === 'heard' ? 'heard something' : 'saw something');   // patrol gives way
      } else if (pat) pat.update(dt);
    }
    if (this.state === 'SUSPICIOUS') {
      const inc = this.incident, reacting = inc ? this.clock >= inc.reactAt : this.focus && this.clock - this.focus.at >= c.reactDelay;
      this.behavior = reacting ? 'assessing' : 'pausing (heard something)';
      if (this.focus && reacting && g.isStill()) g.faceToward(this.focus.position);
      if (this.suspicion >= c.investigateAt && (!inc || this.clock >= inc.assessUntil)) this._investigate();
      else if (this.suspicion < c.calmAt) { this.state = 'NORMAL'; this.focus = null; if (!this._patrolling()) g.faceYaw(g.postYaw); if (P) P.onCalm(); }
    } else if (this.state === 'INVESTIGATING') this._investigating();
  };

  // ---------------------------------------------------------------- incidents (Step 8)
  // A calm guard's first suspicious evidence opens an incident. On a sound he pauses
  // (reactDelay), then reacts once: a quiet vocal "huh", his head and body turn to it,
  // and he assesses (assessTime) before he may walk off. Further sounds in the same
  // incident build suspicion and steer his attention as before, but never restart the
  // pause or the reaction. The incident ends only once he's been calm for incidentCalmTime.
  // Step 8.2: a first partial glimpse opens an incident too (a shorter pause, the same one
  // reaction), and the two senses share it: one "huh" per incident whichever came first.
  mv.GuardAwareness.prototype._beginIncident = function (kind, silent) {
    const c = this.cfg, heard = kind === 'heard', delay = heard ? c.reactDelay : c.visualReactDelay;
    this.incident = { start: this.clock, kind, reactAt: this.clock + delay, assessUntil: this.clock + delay + (heard ? c.assessTime : 0), voiced: !!silent };
    // Step 11: a focused guard assesses a sound a moment longer after his reaction (the reaction itself is unchanged)
    if (heard && !silent && this.guard.personality) this.incident.assessUntil += Math.max(0, this.guard.personality.mod('assessExtra'));
    // a curious guard sometimes takes a closer look: his suspicion holds a little longer before fading
    if (!silent && this.guard.personality) this.incident.closer = this.guard.personality.onIncident();
    this.incidents++; this.calmSince = null;
  };

  mv.GuardAwareness.prototype._incidentUpdate = function (seeing, meter) {
    const c = this.cfg, inc = this.incident;
    if (!inc) return;
    if (this.confirmed) inc.voiced = true;                       // recognised: ALERT, no "huh"
    else if (seeing) {
      // sight comes first: a glimpse during a sound's pause shortens it to the visual pause
      inc.reactAt = Math.min(inc.reactAt, this.clock + c.visualReactDelay);
      inc.assessUntil = Math.min(inc.assessUntil, inc.reactAt);
    }
    if (!inc.voiced && this.clock >= inc.reactAt) {
      inc.voiced = true;
      // recognition about to complete takes priority over the reaction
      if (!(seeing && meter >= c.visualReactMaxMeter)) {
        this.reactions++;
        if (this.onVocal) this.onVocal('huh', this.focus ? this.focus.position : null);
      }
    }
    if (this.state === 'NORMAL' && this.suspicion < c.calmAt) {
      if (this.calmSince == null) this.calmSince = this.clock;
      if (this.clock - this.calmSince >= c.incidentCalmTime) { this.incident = null; this.calmSince = null; }
    } else this.calmSince = null;
  };

  // what he's paying attention to, for his body language (guard.js): a point to turn
  // his head to (or null) and how tense he is (0 relaxed … 1 alert)
  mv.GuardAwareness.prototype.attention = function () {
    const s = this.state, inc = this.incident;
    if (s === 'ALERT') return { point: this.seen ? this.seen.position : null, tension: 1 };
    if (s === 'SUSPICIOUS') return { point: this.focus && (!inc || this.clock >= inc.reactAt) ? this.focus.position : null, tension: 0.45 };
    if (s === 'INVESTIGATING') return { point: this.behavior === 'approach' && this.focus ? this.focus.position : null, tension: this.behavior === 'return' ? 0.3 : 0.6 };
    if (s === 'EVASION') return { point: null, tension: 0.7 };
    if (s === 'HEIGHTENED') return { point: null, tension: 0.5 };
    if (s === 'RETURNING') return { point: null, tension: 0.25 };
    const pat = this._patrolling();
    return { point: pat ? pat.lookPoint : null, tension: 0 };     // NORMAL: relaxed (a patrol's look leads with the head)
  };

  // ---------------------------------------------------------------- investigation
  mv.GuardAwareness.prototype._investigate = function () {
    const g = this.guard;
    if (this.state !== 'INVESTIGATING') this.investigateStart = this.clock;
    this.state = 'INVESTIGATING'; this.search = null;
    if (g.goTo(this.focus.position, this.cfg.arriveWithin)) { this.behavior = 'approach'; this.note = ''; }
    else { this.note = 'spot unreachable: searching from here'; this._beginSearch(); }
  };

  mv.GuardAwareness.prototype._beginSearch = function () {
    const g = this.guard, f = this.focus ? this.focus.position : g.position;
    const base = Math.hypot(f.x - g.position.x, f.z - g.position.z) > 0.3 ? Math.atan2(f.x - g.position.x, f.z - g.position.z) : g.yaw;
    this.behavior = 'search'; this.search = { base, i: 0, round: 0, heldFor: 0, at: this.clock };
  };

  mv.GuardAwareness.prototype._investigating = function () {
    const c = this.cfg, g = this.guard;
    const timedOut = this.clock - this.investigateStart > c.maxInvestigate;
    if (this.behavior === 'approach') {
      if (g.navFailed) { this.note = 'path ' + g.navFailed + ': searching from here'; this._beginSearch(); }
      else if (g.arrived) this._beginSearch();
      else if (timedOut) this._return();
    } else if (this.behavior === 'search') {
      const s = this.search;
      if (!g.isStill()) return;                        // let the walk finish before looking around
      const yaw = s.base + c.lookAround[s.i] * Math.PI / 180;
      g.faceYaw(yaw);
      if (Math.abs(wrap(g.yaw - yaw)) < 0.09) s.heldFor += this.clock - (s.last || this.clock);
      s.last = this.clock;
      const P = this.guard.personality;
      if (s.heldFor >= Math.max(0.4, c.lookHold + (P ? P.mod('searchLookHold') : 0))) {
        s.heldFor = 0; s.i++;
        if (s.i >= c.lookAround.length) {
          s.i = 0; s.round++;
          // personality: curious / focused one more round while still suspicious; careless one fewer on ambiguous evidence
          const peak = this.incident ? this.incident.peak || this.suspicion : this.suspicion, rounds = P ? P.searchRoundsFor(c.searchRounds, peak) : c.searchRounds;
          if (this.suspicion < c.searchRelaxAt || s.round >= rounds || timedOut) { if (P && s.round < c.searchRounds && this.suspicion >= c.searchRelaxAt && !timedOut) P.noteEarlyEnd(); this._return(); }
          else if (s.round >= c.searchRounds) P.noteExtraRound();
        }
      }
    } else if (this.behavior === 'return') {
      if (g.navFailed) { this.note = 'path to post ' + g.navFailed + ': waiting here'; this._settle(); }
      else if (g.arrived && g.isStill()) { if (!this._patrolling()) g.faceYaw(g.postYaw); this._settle(); }
    }
  };

  mv.GuardAwareness.prototype._return = function () {
    const g = this.guard;
    this.behavior = 'return'; this.search = null;
    // a patrolling guard heads back to his route (the waypoint he was walking to), a stationary one to his post
    const pat = this._patrolling(), to = pat ? pat.rejoinPoint() : g.post;
    if (!g.goTo(to, 0.5)) { this.note = (pat ? 'route' : 'post') + ' unreachable: waiting here'; this._settle(); }
  };

  // back (or stuck): calm down at his post, still wary if suspicion hasn't gone
  mv.GuardAwareness.prototype._settle = function () {
    this.state = this.suspicion >= this.cfg.suspiciousAt ? 'SUSPICIOUS' : 'NORMAL';
    this.behavior = this.state === 'NORMAL' ? 'idle' : 'assessing';
    if (this.state === 'NORMAL') this.focus = null;
  };

  // his patrol routine, if he has one and it's on (Step 9)
  mv.GuardAwareness.prototype._patrolling = function () { const p = this.guard.patrol; return p && p.enabled ? p : null; };

  // ---------------------------------------------------------------- alert and evasion
  mv.GuardAwareness.prototype._alert = function (why) {
    const g = this.guard;
    if (why === 'recognised her') this._maybeStartle(this.state);   // the first recognition of this confirmation (Step 12)
    else if (why === 'saw her again') this.startleNote = 'skipped: reacquired a known intruder (' + why + ')';
    if (this._patrolling()) this._patrolling().interrupt('ALERT: ' + why);
    if (this.state === 'HEIGHTENED' || this.state === 'RETURNING') this.interrupted = (this.state === 'HEIGHTENED' ? 'Heightened Security' : 'return to post') + ' interrupted: ' + why;
    this.state = 'ALERT'; this.behavior = 'tracking her'; this.note = why;
    this.lastContact = this.clock; this.evasion = null; this.search = null; this.hs = null;   // a sighting cancels the stand-down
    if (!this.incident) this._beginIncident('seen', true);       // part of an incident until he's genuinely calm again
    g.stopMoving();
  };

  // ---------------------------------------------------------------- startle and recovery (Step 12)
  // Only a genuine surprise startles him: the first recognition of an intruder while he
  // wasn't already confirmed (re-sightings during the search, Heightened Security or the
  // walk back are expected contact), and not again soon after standing down from one.
  mv.GuardAwareness.prototype._maybeStartle = function (prev) {
    const s = this.cfg.startle, v = this.guard.vision;
    if (!s || !s.enabled) { this.startleNote = 'skipped: startle off'; return; }
    if (this.stoodDownAt != null && this.clock - this.stoodDownAt < s.rearmTime) { this.startleNote = `skipped: still on guard (stood down ${(this.clock - this.stoodDownAt).toFixed(0)} s ago)`; return; }
    const d = v.seen && isFinite(v.seen.distance) ? v.seen.distance : (this.seen ? Math.hypot(this.seen.position.x - this.guard.position.x, this.seen.position.z - this.guard.position.z) : 99);
    const band = d <= s.closeWithin ? 'close' : d <= s.mediumWithin ? 'medium' : 'far';
    const prepared = (prev === 'SUSPICIOUS' || prev === 'INVESTIGATING') && !!this.incident && this.incident.kind === 'heard' && this.clock - this.incident.start >= s.preparedAfter;
    const duration = s.durations[band] * (prepared ? s.preparedScale : 1);
    this.startle = { start: this.clock, until: this.clock + duration, duration, band, distance: d, from: prev };
    this.startles++; this.startleNote = `startled: ${band}-range discovery at ${d.toFixed(1)} m${prepared ? ' (was ' + prev.toLowerCase() + ')' : ''}`;
  };
  mv.GuardAwareness.prototype.isStartled = function () { return !!this.startle && this.clock < this.startle.until; };
  mv.GuardAwareness.prototype.recoveryLeft = function () { return this.isStartled() ? this.startle.until - this.clock : 0; };
  // for future combat / CQC logic: may he act offensively yet? (not while startled)
  mv.GuardAwareness.prototype.offenseReady = function () { return !this.isStartled(); };
  mv.GuardAwareness.prototype.vulnerable = function () { return this.isStartled(); };
  // how far into the startle's motion he is, 0…1: rises fast, holds briefly, eases out by recovery
  mv.GuardAwareness.prototype.startleAmount = function () {
    if (!this.isStartled()) return 0;
    const st = this.startle, t = this.clock - st.start, sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    return sm(0, 0.2, t) * (1 - sm(st.duration * 0.35, st.duration, t));   // a quick flinch (0.2 s), then recovery
  };
  mv.GuardAwareness.prototype.startleStatus = function () {
    if (this.isStartled()) return `STARTLED (${this.startle.band}) · ${this.recoveryLeft().toFixed(1)} s to recover · offense not ready`;
    return `ready${this.startleNote ? ' · last: ' + this.startleNote : ''}`;
  };

  // ---------------------------------------------------------------- restrained (Step 13)
  // Grabbed: he knows an intruder has hold of him (physical contact, wherever she came
  // from). He's confirmed and ALERT, his patrol gives way, and he makes no sound (no new
  // vocal reaction). While held he's in contact the whole time (no search starts) and
  // his memory of where she is follows the contact. Released, he carries on from ALERT
  // with her last position: the normal grace and search apply if he can't see her.
  mv.GuardAwareness.prototype.onRestrained = function (by) {
    if (this.incident) this.incident.voiced = true;            // no "huh" now
    if (!this.confirmed) { this.confirmed = true; this.confirmedAt = this.clock; }
    this.suspicion = 1;
    this.seen = { position: by.clone().setY(0), time: this.clock };
    if (this.state !== 'ALERT') this._alert('restrained by an intruder');
    this.note = 'restrained by an intruder'; this.behavior = 'restrained';
  };
  mv.GuardAwareness.prototype._restrainedFrame = function () {
    const by = this.guard.restraint.by;
    this.lastContact = this.clock; this.suspicion = 1;
    this.seen = { position: by.position.clone().setY(0), time: this.clock };
    this.state = 'ALERT'; this.behavior = 'restrained'; this.evasion = null; this.hs = null; this.search = null;
  };
  // Step 14: thrown and knocked out. What he knows stays as it was (an intruder attacked
  // him, there); nothing new comes in while he's out (no sight, no hearing, no decisions)
  mv.GuardAwareness.prototype.onKnockedOut = function (by) {
    const at = by ? by.clone().setY(0) : (this.seen ? this.seen.position.clone() : this.guard.position.clone().setY(0));
    this.attack = { position: at, time: this.clock };
    if (!this.confirmed) { this.confirmed = true; this.confirmedAt = this.clock; }
    this.seen = { position: at.clone(), time: this.clock };
    this.state = 'UNCONSCIOUS'; this.behavior = 'unconscious'; this.note = 'knocked out by an intruder';
    this.evasion = null; this.hs = null; this.search = null; this.focus = null; this.startle = null;
    if (this.incident) this.incident.voiced = true;
  };
  // back on his feet: he was attacked and knows it, so he searches from where it happened
  // (the Active Search, then Heightened Security, then back to his post or route). He has
  // no idea where she went while he was out: no heading, no newer sighting
  mv.GuardAwareness.prototype.onWoke = function () {
    this.track = []; this.suspicion = 1; this.lastContact = this.clock;
    if (!this.seen) this.seen = { position: (this.attack ? this.attack.position : this.guard.position).clone().setY(0), time: this.clock };
    this._startEvasion();
    this.note = 'woke up: searching where he was attacked';
  };
  mv.GuardAwareness.prototype.onReleased = function (at) {
    this.lastContact = this.clock; this.seen = { position: at.clone().setY(0), time: this.clock };
    this.behavior = 'tracking her'; this.note = 'released: on to her';
  };

  // per frame once confirmed
  mv.GuardAwareness.prototype._alerted = function () {
    const c = this.cfg, g = this.guard, v = g.vision, visible = v.seen.rate > 0;
    if (visible) this.lastContact = this.clock;
    if (this.state !== 'ALERT' && visible && v.meter >= c.reacquireMeter) this._alert('saw her again');
    if (this.state === 'ALERT') {
      if (g.moving) g.stopMoving();
      // track her with his eyes: face where he last saw her (exact while she's in view,
      // frozen at the last sighting during the grace, never her unseen position)
      if (this.seen && g.isStill() && Math.hypot(this.seen.position.x - g.position.x, this.seen.position.z - g.position.z) > 0.5) g.faceToward(this.seen.position);
      this.behavior = visible ? 'tracking her' : 'lost sight…';
      if (!visible && this.clock - this.lastContact > c.alertGrace) this._startEvasion();
    } else if (this.state === 'EVASION') {
      if (this.clock >= this.evasion.end) { this.evasion.plan = []; this._startHeightened('Active Search ran out', c.heightenedTime); }
      else this._evasionStep();
    } else if (this.state === 'HEIGHTENED') {
      if (this.clock >= this.hs.end) this._startReturn('Heightened Security over');
      else this._hsStep();
    } else if (this.state === 'RETURNING') this._returnStep();
  };

  // ---------------------------------------------------------------- heightened security
  mv.GuardAwareness.prototype._startHeightened = function (why, duration, first) {
    const g = this.guard;
    this.state = 'HEIGHTENED'; this.note = why;
    this.hs = { start: this.clock, end: this.clock + duration, max: this.clock + this.cfg.heightenedMax, lastExtend: -Infinity, plan: [], visited: [], dest: null, look: null, reason: '' };
    if (first) this.hs.plan.push(first);
    this.hs.plan = this.hs.plan.concat(this._hsPlan());
    g.stopMoving();
    this._hsLook();                                            // first: stop and look around
    this.hs.reason = first ? 'checking ' + first.why : 'pausing to look around';
  };

  // a few checkpoints: corners and routes near the line between his post and where he
  // lost her, within his leash, skipping places the Active Search already covered
  mv.GuardAwareness.prototype._hsPlan = function () {
    const c = this.cfg, g = this.guard, nav = g.nav, post = g.post, spots = [];
    const lost = this.evasion && this.evasion.dest ? this.evasion.dest.p : (this.seen ? this.seen.position : post);
    const centre = new THREE.Vector3((post.x + lost.x) / 2, 0, (post.z + lost.z) / 2);
    const covered = (this.evasion ? this.evasion.visited : []).concat(this.hs ? this.hs.visited : []);
    const near = (p, list) => list.some(q => Math.hypot(q.x - p.x, q.z - p.z) < c.spotSpacing);
    if (nav) {
      const ax = lost.x - post.x, az = lost.z - post.z, len2 = Math.max(0.01, ax * ax + az * az);
      const route = n => { const t = Math.max(0, Math.min(1, ((n.x - post.x) * ax + (n.z - post.z) * az) / len2)); return Math.hypot(n.x - (post.x + ax * t), n.z - (post.z + az * t)); };
      const ranked = nav.nodes.filter(n => Math.hypot(n.x - centre.x, n.z - centre.z) <= c.heightenedRadius && Math.hypot(n.x - post.x, n.z - post.z) <= c.heightenedLeash)
        .map(n => ({ n, score: route(n) + this.rng() * c.searchJitter })).sort((a, b) => a.score - b.score);
      for (const r of ranked) {
        if (spots.length >= c.heightenedSpots) break;
        if (!near(r.n, covered) && !near(r.n, spots.map(s => s.p))) spots.push({ p: new THREE.Vector3(r.n.x, 0, r.n.z), why: 'a corner on the way back to his post' });
      }
    }
    // finally the ground just in front of his post: he ends up near his own area
    const front = post.clone().add(new THREE.Vector3(Math.sin(g.postYaw), 0, Math.cos(g.postYaw)).multiplyScalar(1.5));
    spots.push({ p: nav && nav.inside(front) ? post.clone() : front, why: 'his own area', last: true });
    return spots;
  };

  mv.GuardAwareness.prototype._hsLook = function () {
    const c = this.cfg, g = this.guard;
    this.hs.look = { base: g.yaw, offsets: c.heightenedLooks.map(o => o + (this.rng() - 0.5) * 20), i: 0, heldFor: 0, last: null };
    this.behavior = 'pausing to look around';
  };

  mv.GuardAwareness.prototype._hsNext = function () {
    const c = this.cfg, g = this.guard, h = this.hs;
    while (h.plan.length) {
      const s = h.plan.shift();
      if (g.goTo(s.p, c.heightenedWithin, c.heightenedPush)) { h.dest = s; h.reason = 'checking ' + s.why; h.look = null; this.behavior = 'walking to a checkpoint'; return; }
    }
    h.dest = null; h.reason = 'watching from here'; this._hsLook();       // nothing left: keep watch where he is
  };

  mv.GuardAwareness.prototype._hsStep = function () {
    const c = this.cfg, g = this.guard, h = this.hs;
    if (g.moving) { this.behavior = 'walking to a checkpoint'; return; }
    if (g.navFailed && h.dest) { g.navFailed = null; h.dest = null; this._hsNext(); return; }
    if (!g.isStill()) return;                                    // let the walk finish
    if (!h.look) this._hsLook();
    const L = h.look, yaw = L.base + L.offsets[L.i] * Math.PI / 180;
    g.faceYaw(yaw);
    if (Math.abs(wrap(g.yaw - yaw)) < 0.09) L.heldFor += this.clock - (L.last == null ? this.clock : L.last);
    L.last = this.clock;
    if (L.heldFor >= c.heightenedLookHold) {
      L.heldFor = 0; L.i++;
      if (L.i >= L.offsets.length) {
        if (h.dest) h.visited.push(h.dest.p.clone());
        const wasLast = h.dest && h.dest.last; h.look = null;
        if (wasLast || (!h.plan.length && !h.dest && h.watched)) { h.watched = true; this._hsLook(); h.reason = 'watching from his area'; }
        else { h.watched = !h.plan.length; this._hsNext(); }
      }
    }
  };

  // ---------------------------------------------------------------- return to post
  mv.GuardAwareness.prototype._startReturn = function (why) {
    const c = this.cfg, g = this.guard;
    this.state = 'RETURNING'; this.note = why; this.behavior = 'walking back to post';
    if (!g.goTo(g.post, c.postArriveWithin, c.walkPush)) { this.note = why + ' · post unreachable: standing down here'; this._standDown(); }
  };

  mv.GuardAwareness.prototype._returnStep = function () {
    const c = this.cfg, g = this.guard;
    if (g.moving) { this.behavior = 'walking back to post'; return; }
    if (g.navFailed) { this.note = 'path to post ' + g.navFailed + ': retrying'; g.navFailed = null; if (!g.goTo(g.post, c.postArriveWithin, c.walkPush)) this._standDown(); return; }
    if (!g.isStill()) { this.behavior = 'stopping at post'; return; }
    if (!g.atPost()) { g.goTo(g.post, c.postArriveWithin, c.walkPush); return; }   // drifted short: walk the last bit
    g.faceYaw(g.postYaw); this.behavior = 'turning to his post facing';
    if (g.vision.seen.rate > 0) { this.behavior = 'something in view: not standing down'; return; }   // never NORMAL while seeing her
    if (Math.abs(wrap(g.yaw - g.postYaw)) * 57.2958 <= c.postFacingTolerance && Math.abs(g.motor.angularVelocity) < 0.05) this._standDown();
  };

  // the stand-down: back to NORMAL; the old confirmation is spent, suspicion fades
  mv.GuardAwareness.prototype._standDown = function () {
    const c = this.cfg;
    this.state = 'NORMAL'; this.behavior = 'idle';
    this.confirmed = false; this.suspicion = c.standDownSuspicion; this.lastEvidence = this.clock;
    this.focus = null; this.evasion = null; this.hs = null; this.track = [];
    this.standDowns++; this.stoodDownAt = this.clock; this.note = 'stood down'; this.interrupted = '';
  };

  // which way she was going: from the sightings in her last travelWindow seconds in view
  mv.GuardAwareness.prototype._travel = function () {
    const c = this.cfg, t = this.track;
    if (t.length < 2) return null;
    const last = t[t.length - 1]; let old = t[0];
    for (const s of t) if (last.time - s.time <= c.travelWindow) { old = s; break; }
    const dt = last.time - old.time;
    if (dt < 0.15) return null;
    return new THREE.Vector3((last.position.x - old.position.x) / dt, 0, (last.position.z - old.position.z) / dt);
  };

  mv.GuardAwareness.prototype._startEvasion = function () {
    const c = this.cfg;
    this.evasions++;
    this.state = 'EVASION';
    this.evasion = { start: this.clock, end: this.clock + c.evasionTime, visited: [], plan: [], dest: null, look: null, travel: this._travel(), redirects: 0, reason: '' };
    this.evasion.plan = this._plan(this.seen.position, this.evasion.travel, 'seen');
    this.note = 'lost her: Active Search';
    this._nextSpot();
  };

  // a search plan around an anchor (where he saw or heard her): the anchor itself, the
  // way she was heading, then hiding spots near cover he couldn't see into, ranked by
  // closeness to the area, her heading, and a little random variation
  mv.GuardAwareness.prototype._plan = function (anchor, travel, kind, wider) {
    const c = this.cfg, g = this.guard, nav = g.nav, spots = [], visited = this.evasion ? this.evasion.visited : [];
    const radius = c.hideRadius * (wider || 1);
    const near = (p, list) => list.some(q => Math.hypot(q.x - p.x, q.z - p.z) < c.spotSpacing);
    const add = (p, why) => { if (!near(p, spots.map(s => s.p)) && !near(p, visited) && !(nav && nav.inside(p))) spots.push({ p: new THREE.Vector3(p.x, 0, p.z), why }); };
    add(anchor, kind === 'seen' ? 'the last place he saw her' : 'where he heard her');
    let centre = anchor, dir = null;
    if (travel && Math.hypot(travel.x, travel.z) > 0.3) {
      const sp = Math.hypot(travel.x, travel.z); dir = new THREE.Vector3(travel.x / sp, 0, travel.z / sp);
      let d = Math.min(sp * c.predictTime, c.predictMax), pred = null;
      for (; d > 0.5; d -= 0.5) { const q = anchor.clone().addScaledVector(dir, d); if (!nav || !nav.inside(q)) { pred = q; break; } }
      if (pred) { add(pred, 'where she was heading'); centre = pred; }
    }
    if (nav) {
      const eye = g.eye(new THREE.Vector3()), probe = new THREE.Vector3();
      // candidate places: the navigation waypoints at cover corners, a spot behind the
      // middle of each face of nearby cover, and two escape directions off her heading
      const pool = nav.nodes.slice(), off = g.cfg.radius + 0.45;
      for (const b of g.world.boxes) {
        const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
        if (Math.hypot(cx - centre.x, cz - centre.z) > radius + 4) continue;
        for (const q of [{ x: cx, z: b.minZ - off }, { x: cx, z: b.maxZ + off }, { x: b.minX - off, z: cz }, { x: b.maxX + off, z: cz }]) if (Math.abs(q.x) < 21.4 && Math.abs(q.z) < 21.4 && !nav.inside(q)) pool.push(q);
      }
      if (dir) for (const s of [-1, 1]) { const a = Math.atan2(dir.x, dir.z) + s * c.escapeAngle * Math.PI / 180, q = { x: centre.x + Math.sin(a) * c.escapeDistance, z: centre.z + Math.cos(a) * c.escapeDistance }; if (!nav.inside(q) && nav.plan(centre, q)) pool.push(q); }
      const ranked = pool.map(n => {
        const d = Math.hypot(n.x - centre.x, n.z - centre.z);
        if (d > radius) return null;
        probe.set(n.x, 1.0, n.z);
        const hidden = g.world.segmentBlocked(eye, probe);          // somewhere he couldn't see into
        const ahead = dir ? Math.max(0, ((n.x - anchor.x) * dir.x + (n.z - anchor.z) * dir.z) / Math.max(0.1, Math.hypot(n.x - anchor.x, n.z - anchor.z))) : 0;
        return { n, score: d - (hidden ? 2 : 0) - 1.5 * ahead + this.rng() * c.searchJitter };
      }).filter(Boolean).sort((a, b) => a.score - b.score);
      for (const r of ranked) { if (spots.length >= c.hideCount + 2) break; add(r.n, 'a hiding spot near ' + (kind === 'seen' ? 'where she vanished' : 'the sound')); }
    }
    return spots;
  };

  // head for the next spot in the plan (skipping places already checked or unreachable)
  mv.GuardAwareness.prototype._nextSpot = function () {
    const c = this.cfg, g = this.guard, e = this.evasion;
    for (let tries = 0; tries < 2; tries++) {
      while (e.plan.length) {
        const s = e.plan.shift();
        if (e.visited.some(q => Math.hypot(q.x - s.p.x, q.z - s.p.z) < c.spotSpacing)) continue;
        if (g.goTo(s.p, c.evasionWithin, c.evasionPush)) { e.dest = s; e.reason = 'checking ' + s.why; e.look = null; this.behavior = 'moving to search spot'; return; }
        e.visited.push(s.p.clone());                                // unreachable: don't try it again
      }
      // plan used up: search wider around the freshest evidence he has
      const anchor = this.heard && this.heard.time > (this.seen ? this.seen.time : -1) ? this.heard.estimate : this.seen.position;
      e.wider = (e.wider || 1) * c.widen;
      e.plan = this._plan(anchor, null, anchor === (this.seen && this.seen.position) ? 'seen' : 'heard', e.wider);
    }
    e.dest = null; e.reason = 'nowhere new to check: looking around here'; this._evasionLook();
  };

  mv.GuardAwareness.prototype._evasionLook = function () {
    const c = this.cfg, g = this.guard;
    this.evasion.look = { base: g.yaw, offsets: c.evasionLooks.map(o => o + (this.rng() - 0.5) * 20), i: 0, heldFor: 0, last: null };
    this.behavior = 'searching here';
  };

  mv.GuardAwareness.prototype._evasionStep = function () {
    const c = this.cfg, g = this.guard, e = this.evasion;
    if (g.moving) { this.behavior = 'moving to search spot'; return; }
    if (g.navFailed && e.dest) { e.visited.push(e.dest.p.clone()); e.dest = null; g.navFailed = null; this._nextSpot(); return; }
    if (!g.isStill()) return;                                    // let the walk finish
    if (!e.look) this._evasionLook();
    const L = e.look, yaw = L.base + L.offsets[L.i] * Math.PI / 180;
    g.faceYaw(yaw);
    if (Math.abs(wrap(g.yaw - yaw)) < 0.09) L.heldFor += this.clock - (L.last == null ? this.clock : L.last);
    L.last = this.clock;
    if (L.heldFor >= c.evasionLookHold) {
      L.heldFor = 0; L.i++;
      if (L.i >= L.offsets.length) { if (e.dest) e.visited.push(e.dest.p.clone()); else e.visited.push(g.position.clone()); e.look = null; this._nextSpot(); }
    }
  };

  // his approximate idea of where a sound came from: the origin moved by a random
  // offset within a spread that's tighter for strong, close sounds
  mv.GuardAwareness.prototype._estimate = function (h, rec) {
    const u = this.cfg.soundUncertainty;
    const spread = u.base + u.far * Math.min(1, rec.distance / Math.max(0.01, rec.reach)) + u.weak * Math.max(0, 1 - rec.intensity / 3);
    // a guess on open ground (a guess inside a wall is useless to search); only if no
    // free point exists anywhere in the spread does he fall back to the origin itself
    const nav = this.guard.nav;
    h.estimate = h.position.clone();
    for (let i = 0; i < 24; i++) {
      const a = this.rng() * Math.PI * 2, r = spread * Math.sqrt(this.rng());
      const q = new THREE.Vector3(h.position.x + Math.cos(a) * r, 0, h.position.z + Math.sin(a) * r);
      if (!nav || !nav.inside(q)) { h.estimate = q; break; }
    }
    h.uncertainty = spread;
  };

  // a sound while alerted: evidence for the search, never an exact fix
  mv.GuardAwareness.prototype._alertHeard = function (h, gain) {
    const c = this.cfg, g = this.guard, e = this.evasion;
    if (this.state === 'ALERT') return;                          // he's watching her (or about to search)
    const est = h.estimate, gap = this.clock - this.lastRedirect >= c.redirectGap;
    if (this.state === 'EVASION' && e) {
      const dest = e.dest ? e.dest.p : g.position;
      const far = Math.hypot(est.x - dest.x, est.z - dest.z) > c.redirectDistance;
      if (gain >= c.redirectStrength && far && gap) {
        this.lastRedirect = this.clock; this.redirects++; e.redirects++;
        e.end = Math.min(e.start + c.evasionMax, e.end + c.soundExtend);
        e.plan = this._plan(est, null, 'heard');
        g.stopMoving(); e.look = null;
        this.note = `heard ${h.surface} footsteps ~${h.distance.toFixed(0)} m away (strength ${gain.toFixed(2)})`;
        this._nextSpot();
        return;
      }
      // a weaker or nearby sound: a glance toward it when he's standing, no change of plan
      if (gap && g.isStill() && e.look) { this.lastRedirect = this.clock; e.look.base = Math.atan2(est.x - g.position.x, est.z - g.position.z); e.look.i = 0; e.look.heldFor = 0; this.note = 'glanced at a faint sound'; }
    } else if (this.state === 'HEIGHTENED' && this.hs) {
      const hs = this.hs, dest = hs.dest ? hs.dest.p : g.position;
      if (gain >= c.redirectStrength && gap && Math.hypot(est.x - dest.x, est.z - dest.z) > 1.5) {
        // meaningful: go and check it, extending his caution (rate-limited and capped)
        this.lastRedirect = this.clock; this.redirects++;
        if (this.clock - hs.lastExtend >= c.heightenedExtendGap) { hs.end = Math.min(hs.max, Math.max(hs.end, this.clock) + c.heightenedExtend); hs.lastExtend = this.clock; }
        hs.plan.unshift({ p: est.clone(), why: 'the sound he heard' });
        g.stopMoving(); hs.look = null; hs.watched = false;
        this.note = `heard ${h.surface} footsteps ~${h.distance.toFixed(0)} m away (strength ${gain.toFixed(2)})`;
        this._hsNext();
      } else if (gap && g.isStill() && hs.look) {
        // weak: a glance, no extension
        this.lastRedirect = this.clock; hs.look.base = Math.atan2(est.x - g.position.x, est.z - g.position.z); hs.look.i = 0; hs.look.heldFor = 0; this.note = 'glanced at a faint sound';
      }
    } else if (this.state === 'RETURNING' && gain >= c.redirectStrength && gap) {
      // a meaningful sound interrupts the walk back: check it, then return again
      this.lastRedirect = this.clock; this.redirects++;
      this.interrupted = `return interrupted: heard ${h.surface} footsteps ~${h.distance.toFixed(0)} m away`;
      this._startHeightened(this.interrupted, c.returnInterruptTime, { p: est.clone(), why: 'the sound he heard' });
      this._hsNext();
    }
  };

  // ---------------------------------------------------------------- developer view
  // Temporary tools, not the player HUD: a suspicion bar over his head (orange; red
  // once confirmed), a magenta ring at the last place he actually saw her, a white
  // ring at his movement target and a white line along his planned path. The last
  // heard position keeps its cyan ring (guard-hearing.js).
  mv.GuardAwarenessView = function (scene, guard) {
    this.guard = guard; this.group = new THREE.Group(); scene.add(this.group);
    const ring = (color, r) => { const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.75, r, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })); m.position.y = 0.035; m.renderOrder = 3; m.visible = false; this.group.add(m); return m; };
    this.seenRing = ring(0xff4dd8, 0.34);
    this.targetRing = ring(0xffffff, 0.24);
    // his assigned post: a small square with a tick showing its facing
    this.post = new THREE.Group();
    const sq = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xb8ffb0, transparent: true, opacity: 0.8, depthWrite: false }));
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.4).rotateX(-Math.PI / 2), sq.material); tick.position.z = 0.5;
    this.post.add(sq, tick); this.post.position.y = 0.03; this.post.renderOrder = 3; this.group.add(this.post);
    // once alerted: his approximate estimate of the last sound (radius = its uncertainty)
    // and the spots still planned in his search (yellow dots)
    this.estRing = ring(0x4de1ff, 1); this.estRing.material.opacity = 0.35;
    this.planDots = []; for (let i = 0; i < 8; i++) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.12, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd84d, depthWrite: false })); d.position.y = 0.04; d.visible = false; this.group.add(d); this.planDots.push(d); }
    this.pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new Array(32).fill(0).map(() => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.pathLine.frustumCulled = false; this.pathLine.visible = false; this.group.add(this.pathLine);
    this.bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7, depthWrite: false }));
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.06), new THREE.MeshBasicMaterial({ color: 0xff9a3d, depthWrite: false }));
    this.fill.position.z = 0.001; this.bar.add(bg, this.fill); this.group.add(this.bar);
  };

  const _eye = new THREE.Vector3();
  mv.GuardAwarenessView.prototype.update = function (camera) {
    const g = this.guard, a = g.awareness;
    this.group.visible = a.cfg.debug;
    if (!a.cfg.debug) return;
    g.eye(_eye);
    this.bar.position.set(_eye.x, _eye.y + 0.6, _eye.z); this.bar.quaternion.copy(camera.quaternion);
    this.fill.scale.x = Math.max(0.001, a.suspicion); this.fill.position.x = -0.52 * (1 - a.suspicion);
    this.fill.material.color.setHex(a.confirmed ? 0xff3d3d : 0xff9a3d);
    this.seenRing.visible = !!a.seen; if (a.seen) this.seenRing.position.set(a.seen.position.x, 0.035, a.seen.position.z);
    this.post.position.set(g.post.x, 0.03, g.post.z); this.post.rotation.y = g.postYaw;
    const h = a.heard, approx = h && h.uncertainty > 0;
    this.estRing.visible = !!approx;
    if (approx) { this.estRing.position.set(h.estimate.x, 0.035, h.estimate.z); this.estRing.scale.setScalar(Math.max(0.3, h.uncertainty)); }
    const plan = a.evasion && a.state === 'EVASION' ? a.evasion.plan : a.hs && a.state === 'HEIGHTENED' ? a.hs.plan : [];
    this.planDots.forEach((d, i) => { d.visible = i < plan.length; if (d.visible) d.position.set(plan[i].p.x, 0.04, plan[i].p.z); });
    const moving = g.moving && g.path;
    this.targetRing.visible = !!moving; this.pathLine.visible = !!moving;
    if (moving) {
      this.targetRing.position.set(g.goal.x, 0.035, g.goal.z);
      const pos = this.pathLine.geometry.attributes.position, pts = [{ x: g.position.x, z: g.position.z }].concat(g.path);
      for (let i = 0; i < 32; i++) { const q = pts[Math.min(i, pts.length - 1)]; pos.setXYZ(i, q.x, 0.05, q.z); }
      pos.needsUpdate = true;
    }
  };
})(SC.mv);
