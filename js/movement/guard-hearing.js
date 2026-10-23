// SHADOW CELL — guard hearing (docs/GAME_DESIGN.md §2).
// The guard listens to the noise system. Each event already carries its
// effective reach (level, surface and all), so a sound is heard when it happens
// within that reach × the guard's hearing sensitivity; nothing is recomputed.
// When he hears one he remembers where it came from (only the most recent), and
// after a short beat turns on the spot to look there, holds the look, then turns
// back to his post. He reacts to where the sound was made, never to where the
// player is now. Hearing never fills the vision meter: only seeing does.
// All values are initial test values, adjustable here.
(function (mv) {
  'use strict';

  mv.HearingDefaults = {
    // hearing capability: multiplies each sound's own reach
    profiles: { poor: { sensitivity: 0.7 }, regular: { sensitivity: 1 }, keen: { sensitivity: 1.3 } },
    reactDelay: 0.35,      // s between hearing a sound and starting to turn toward it
    lookTime: 3.0,         // s he keeps looking after the last sound he heard…
    returnToPost: true,    // …then turns back to his post's facing
    // repeated sounds (a run of footsteps): a new one only redirects his look if it
    // comes from a clearly different direction and not too soon after the last redirect
    retargetAngle: 12,     // degrees
    retargetGap: 0.8,      // s
    ignoreSources: ['guard'],
    debug: true,           // developer marker at the last heard position (stats row is separate)
  };

  mv.GuardHearing = function (guard, noise, profile, opts) {
    this.guard = guard;
    this.cfg = Object.assign({}, mv.HearingDefaults, opts || {});
    this.profile = profile || 'regular';
    this.clock = 0;
    this.last = null;        // the last sound evaluated: heard or ignored, with why
    this.heard = null;       // the most recent sound he heard: { position, time, … }
    this.heardCount = 0;
    this.pending = null;     // { yaw, at }: a turn waiting for the reaction delay
    this.lookYaw = null;     // the direction he's looking toward (null = at his post)
    this.lastRedirect = -Infinity;
    this.off = noise.on(ev => this.hear(ev));
    this.marker = null;
  };

  mv.GuardHearing.prototype.sensitivity = function () { return this.cfg.profiles[this.profile].sensitivity; };

  // distance on the ground from the guard to a sound, and the reach he hears it within
  mv.GuardHearing.prototype.evaluate = function (ev) {
    const g = this.guard.position, d = Math.hypot(ev.position.x - g.x, ev.position.z - g.z);
    const reach = ev.radius * this.sensitivity();
    return { distance: d, reach, heard: d <= reach };
  };

  mv.GuardHearing.prototype.hear = function (ev) {
    if (this.cfg.ignoreSources.indexOf(ev.source) >= 0) return;
    const r = this.evaluate(ev);
    this.last = { type: ev.type, level: ev.level, intensity: ev.intensity, surface: ev.surface, source: ev.source,
      distance: r.distance, reach: r.reach, heard: r.heard, position: ev.position.clone(), time: this.clock };
    if (!r.heard) return;
    this.heard = this.last; this.heardCount++;
    const g = this.guard, yaw = Math.atan2(ev.position.x - g.position.x, ev.position.z - g.position.z);
    const current = this.pending ? this.pending.yaw : this.lookYaw;
    const apart = current == null ? Infinity : Math.abs(Math.atan2(Math.sin(yaw - current), Math.cos(yaw - current))) * 57.2958;
    if (apart >= this.cfg.retargetAngle && this.clock - this.lastRedirect >= this.cfg.retargetGap) {
      this.pending = { yaw, at: this.clock + this.cfg.reactDelay };
      this.lastRedirect = this.clock;
    }
  };

  mv.GuardHearing.prototype.update = function (dt) {
    this.clock += dt;
    const g = this.guard;
    if (this.pending && this.clock >= this.pending.at) { this.lookYaw = this.pending.yaw; g.faceYaw(this.lookYaw); this.pending = null; }
    if (this.lookYaw != null && !this.pending && this.heard && this.clock - this.heard.time > this.cfg.reactDelay + this.cfg.lookTime) {
      this.lookYaw = null;
      if (this.cfg.returnToPost) g.faceYaw(g.postYaw);
    }
  };

  // short state for the developer view
  mv.GuardHearing.prototype.state = function () {
    if (this.pending) return 'HEARD — REACTING';
    if (this.lookYaw != null) return 'LOOKING';
    return 'LISTENING';
  };

  // ---------------------------------------------------------------- developer marker
  // a small cyan ring at the last heard position (the sound's origin, not the player)
  mv.GuardHearing.prototype.updateDebug = function (scene) {
    if (!this.cfg.debug) { if (this.marker) this.marker.visible = false; return; }
    if (!this.marker) {
      this.marker = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4de1ff, transparent: true, opacity: 0.9, depthWrite: false }));
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4de1ff, depthWrite: false }));
      ring.position.y = dot.position.y = 0.03; this.marker.add(ring, dot); this.marker.renderOrder = 3; scene.add(this.marker);
    }
    this.marker.visible = !!this.heard;
    if (this.heard) this.marker.position.set(this.heard.position.x, 0, this.heard.position.z);
  };
})(SC.mv);
