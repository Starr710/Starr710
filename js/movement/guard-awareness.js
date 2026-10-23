// SHADOW CELL — guard awareness: suspicion, investigation and confirmed threats
// (docs/GAME_DESIGN.md §5). The guard's first brain. Four states:
//   NORMAL         at his post, idle; hears and sees normally
//   SUSPICIOUS     something caught his attention: he turns to it and assesses
//   INVESTIGATING  suspicion is significant: he walks to the last suspicious spot,
//                  searches around it, and walks back to his post if nothing turns up
//   CONFIRMED      his vision meter reached 100%: he actually saw her. Persistent in
//                  this stage: no sound, timer or return-to-post can undo it; he faces
//                  the last place he actually saw her
// Memory is only what he earned: the last sound he heard, the last place he actually
// saw her, and whether a sighting was confirmed. He never knows where she is unseen.
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
    reactDelay: 0.35,      // s between noticing something and turning to it
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
  };

  // ---------------------------------------------------------------- evidence
  // a sound the guard heard (from guard-hearing.js)
  mv.GuardAwareness.prototype.onHeard = function (rec) {
    const c = this.cfg, p = rec.position.clone();
    this.heard = { position: p, time: this.clock, intensity: rec.intensity, surface: rec.surface, distance: rec.distance };
    if (this.confirmed) return;                       // a confirmed threat outranks ordinary sounds
    this.recent = this.recent.filter(r => this.clock - r.time <= c.repeatWindow);
    const repeats = this.recent.filter(r => Math.hypot(r.position.x - p.x, r.position.z - p.z) <= c.repeatRadius).length;
    this.recent.push({ position: p, time: this.clock });
    const close = 1 + c.closeBoost * Math.max(0, 1 - rec.distance / Math.max(0.01, rec.reach));
    const repeat = Math.min(c.repeatMax, 1 + c.repeatBoost * repeats);
    const gain = lerpTab(c.hearGain, rec.intensity) * close * repeat;
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
    if (!this.confirmed && v.meter >= 1) {
      this.confirmed = true; this.confirmedAt = this.clock;
      this.state = 'CONFIRMED'; this.behavior = 'facing last seen';
      g.stopMoving(); this.search = null;
    }
    if (this.confirmed) { this.suspicion = 1; this._confirmed(); return; }
    if (this.clock - this.lastEvidence > c.holdTime) this.suspicion = Math.max(0, this.suspicion - c.decayRate * dt);

    if (this.state === 'NORMAL') {
      this.behavior = g.atPost() ? 'idle' : 'off post';
      if (this.suspicion >= c.suspiciousAt && this.focus) this.state = 'SUSPICIOUS';
    }
    if (this.state === 'SUSPICIOUS') {
      this.behavior = 'assessing';
      if (this.focus && this.clock - this.focus.at >= c.reactDelay && g.isStill()) g.faceToward(this.focus.position);
      if (this.suspicion >= c.investigateAt) this._investigate();
      else if (this.suspicion < c.calmAt) { this.state = 'NORMAL'; this.focus = null; g.faceYaw(g.postYaw); }
    } else if (this.state === 'INVESTIGATING') this._investigating();
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
      if (s.heldFor >= c.lookHold) {
        s.heldFor = 0; s.i++;
        if (s.i >= c.lookAround.length) {
          s.i = 0; s.round++;
          if (this.suspicion < c.searchRelaxAt || s.round >= c.searchRounds || timedOut) this._return();
        }
      }
    } else if (this.behavior === 'return') {
      if (g.navFailed) { this.note = 'path to post ' + g.navFailed + ': waiting here'; this._settle(); }
      else if (g.arrived && g.isStill()) { g.faceYaw(g.postYaw); this._settle(); }
    }
  };

  mv.GuardAwareness.prototype._return = function () {
    const g = this.guard;
    this.behavior = 'return'; this.search = null;
    if (!g.goTo(g.post, 0.5)) { this.note = 'post unreachable: waiting here'; this._settle(); }
  };

  // back (or stuck): calm down at his post, still wary if suspicion hasn't gone
  mv.GuardAwareness.prototype._settle = function () {
    this.state = this.suspicion >= this.cfg.suspiciousAt ? 'SUSPICIOUS' : 'NORMAL';
    this.behavior = this.state === 'NORMAL' ? 'idle' : 'assessing';
    if (this.state === 'NORMAL') this.focus = null;
  };

  // ---------------------------------------------------------------- confirmed threat
  // Minimal for this stage: he holds still and faces the last place he actually saw
  // her (tracking her while she's in sight). No chase, combat or stand-down.
  mv.GuardAwareness.prototype._confirmed = function () {
    const g = this.guard;
    this.behavior = g.vision.seen.rate > 0 ? 'watching her' : 'facing last seen';
    if (this.seen && g.isStill() && Math.hypot(this.seen.position.x - g.position.x, this.seen.position.z - g.position.z) > 0.5) g.faceToward(this.seen.position);
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
