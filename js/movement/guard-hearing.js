// SHADOW CELL — guard hearing (docs/GAME_DESIGN.md §2).
// The guard listens to the noise system. Each event already carries its
// effective reach (level, surface and all), so a sound is heard when it happens
// within that reach × the guard's hearing sensitivity; nothing is recomputed.
// Hearing is perception only: it records the last sound evaluated (heard or
// ignored) and the last one heard, and hands each heard sound to the guard's
// awareness (guard-awareness.js), which decides how to react. Hearing never
// fills the vision meter: only seeing does. Values are adjustable here.
(function (mv) {
  'use strict';

  mv.HearingDefaults = {
    // hearing capability: multiplies each sound's own reach
    profiles: { poor: { sensitivity: 0.7 }, regular: { sensitivity: 1 }, keen: { sensitivity: 1.3 } },
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
    this.onHeard = null;     // set by the guard: called with each heard sound's record
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
    if (this.onHeard) this.onHeard(this.last);
  };

  mv.GuardHearing.prototype.update = function (dt) { this.clock += dt; };

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
