// SHADOW CELL — guard patrol (Step 9). A simple security routine for one guard: a
// repeating route of waypoints walked at a relaxed pace with his own motor, animator
// and nav paths (guard.js / guard-nav.js). At observation points he slows, stops,
// faces a set direction and looks around for a while; at pass-through points he
// carries on walking. It runs only while his awareness is NORMAL: anything else
// (suspicion, investigation, alert, search, heightened security, the walk back to
// his post) interrupts it, and when he's NORMAL again he walks back to the waypoint
// he was heading for and carries on. It knows nothing about the player: only where
// the route goes. His post stays his home: the Step 7 stand-down still returns him
// there before he resumes. With patrol disabled he is the stationary guard.
// All values are initial test values, adjustable here or per guard (area.guard.patrol).
(function (mv) {
  'use strict';

  mv.PatrolDefaults = {
    enabled: true,
    loop: true,            // after the last waypoint, back to the first (false: walk the route back and forth)
    push: 0.42,            // stick-equivalent push: ≈1.15 m/s, a relaxed walk (never a jog)
    // waypoints: { x, z, pause: [min, max] s (0 / omitted = walk straight through),
    //   face: facing (degrees, 0 = +Z, 90 = +X) to observe in, looks: [° from face, …],
    //   next: the waypoint after this one (Step 24, optional; otherwise the route order) }
    // A lookout (Step 24) is a route whose points all stand at his post: he only turns from one facing to the next
    points: [],
    arriveWithin: 0.45,    // m from an observation point where he lets the walk finish
    passWithin: 1.2,       // m from a pass-through point where he heads on to the next one
    startTurn: 30,         // ° he turns on the spot toward the next leg before setting off
    lookJitter: 10,        // ± ° of variation in each look, so no two rounds are identical
    skipLook: 0.25,        // chance an extra look is skipped this time
    lookPoint: 5,          // m ahead in the look direction for his head to lead the turn
    seed: 9001,            // patrol variation (separate from the awareness's own randomness)
    // Step 24.2: a back-and-forth route (loop: false) always stops at its two ends before walking back: a pause
    // (unless the end has its own), a look each way (unless it has its own looks), then a turn on the spot
    endPause: [2, 4], endLooks: [-40, 40],
  };

  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const D2R = Math.PI / 180;
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  mv.GuardPatrol = function (guard, opts) {
    this.guard = guard;
    this.cfg = Object.assign({}, mv.PatrolDefaults, opts || {});
    this.enabled = !!this.cfg.enabled && this.cfg.points.length > 0;
    this.reset();
  };

  // the clean starting state: observing at the first waypoint (his post), as he stands at RESET
  mv.GuardPatrol.prototype.reset = function () {
    this.rng = mulberry(this.cfg.seed);
    this.index = 0; this.dir = 1; this.legs = 0; this.resumes = 0; this.interrupts = 0;
    this.state = 'observing'; this.why = ''; this.resumeIndex = null; this.rejoining = false;
    this.obs = null; this.lookPoint = null; this.clock = 0;
    const p = this.cfg.points[0], g = this.guard;
    if (p && Math.hypot(p.x - g.position.x, p.z - g.position.z) <= this.cfg.arriveWithin) this._observe();
    else if (p) this._setOff(0);   // (a guard with no route has nothing to set off for)
  };

  // (Step 24.2) is this waypoint a stop: an observation point, or an end of a back-and-forth route
  mv.GuardPatrol.prototype.stopsAt = function (i) {
    const wp = this.cfg.points[i], n = this.cfg.points.length;
    return !!(wp && ((wp.pause && wp.pause[1] > 0) || (!this.cfg.loop && n > 1 && (i === 0 || i === n - 1))));
  };
  mv.GuardPatrol.prototype.point = function (i) { const p = this.cfg.points[i]; return p ? new THREE.Vector3(p.x, 0, p.z) : null; };
  mv.GuardPatrol.prototype.nextIndex = function (i) {
    const n = this.cfg.points.length, p = this.cfg.points[i];
    if (p && p.next != null) return p.next;   // (Step 24: an explicit next waypoint)
    if (this.cfg.loop) return (i + 1) % n;
    if (i + this.dir < 0 || i + this.dir >= n) this.dir = -this.dir;
    return i + this.dir;
  };
  // where an investigation hands him back to his route: the waypoint he was heading for
  mv.GuardPatrol.prototype.rejoinPoint = function () { return this.point(this.resumeIndex != null ? this.resumeIndex : this.index); };

  // ---------------------------------------------------------------- awareness hooks
  // his awareness left NORMAL: stop the routine (a walk he was on comes to a natural stop)
  mv.GuardPatrol.prototype.interrupt = function (why) {
    if (!this.enabled || this.state === 'interrupted') return;
    const g = this.guard, s = this.state;
    // resume where he was going; if he was observing, with the next leg
    this.resumeIndex = s === 'observing' ? this.nextIndex(this.index) : this.index;
    if (s === 'walking' || s === 'turning') g.stopMoving();
    this.state = 'interrupted'; this.why = why; this.interrupts++; this.obs = null; this.lookPoint = null;
  };

  // per frame while his awareness is NORMAL
  mv.GuardPatrol.prototype.update = function (dt) {
    if (!this.enabled) return;
    const c = this.cfg, g = this.guard;
    this.clock += dt;
    if (this.state === 'interrupted') {
      // back to NORMAL: rejoin the route at the waypoint he was heading for
      this.index = this.resumeIndex != null ? this.resumeIndex : this.index; this.resumeIndex = null;
      this.resumes++; this.rejoining = true; this.why = 'returning to route';
      this._setOff(this.index);
    }
    if (this.state === 'turning') {
      const t = this.point(this.index);
      g.faceToward(t); this.lookPoint = t;
      if (!g.isStill() && !g.moving) return;
      if (Math.abs(wrap(Math.atan2(t.x - g.position.x, t.z - g.position.z) - g.yaw)) <= c.startTurn * D2R || Math.hypot(t.x - g.position.x, t.z - g.position.z) < 1) this._walk();
    } else if (this.state === 'walking') this._walking();
    else if (this.state === 'observing') this._observing(dt);
  };

  // ---------------------------------------------------------------- legs
  mv.GuardPatrol.prototype._setOff = function (i) {
    const g = this.guard, t = this.point(i);
    this.index = i; this.obs = null;
    if (Math.hypot(t.x - g.position.x, t.z - g.position.z) <= this.cfg.arriveWithin) { this._arrive(); return; }
    this.state = 'turning';
  };

  mv.GuardPatrol.prototype._walk = function () {
    const c = this.cfg, g = this.guard, pass = !this.stopsAt(this.index);
    this.lookPoint = null;
    // through a pass-through point at full pace; slow and stop at an observation point
    if (g.goTo(this.point(this.index), pass ? 0.3 : c.arriveWithin, c.push, { noSlow: pass })) { this.state = 'walking'; this.legs++; }
    else { this.why = 'waypoint ' + this.index + ' unreachable: skipping it'; this._setOff(this.nextIndex(this.index)); }
  };

  mv.GuardPatrol.prototype._walking = function () {
    const c = this.cfg, g = this.guard, wp = c.points[this.index], pass = !this.stopsAt(this.index);
    if (g.navFailed) { this.why = 'path ' + g.navFailed + ': on to the next waypoint'; g.navFailed = null; this._setOff(this.nextIndex(this.index)); return; }
    const d = Math.hypot(wp.x - g.position.x, wp.z - g.position.z);
    if (pass && (d <= c.passWithin || g.arrived)) {
      // carry on walking into the next leg without stopping
      this.rejoining = false; this.why = '';
      this.index = this.nextIndex(this.index);
      const npass = !this.stopsAt(this.index);
      if (!g.goTo(this.point(this.index), npass ? 0.3 : c.arriveWithin, c.push, { noSlow: npass })) this._setOff(this.nextIndex(this.index));
      else this.legs++;
      return;
    }
    if (!pass && g.arrived && g.isStill()) this._arrive();
  };

  mv.GuardPatrol.prototype._arrive = function () {
    this.rejoining = false; this.why = '';
    if (this.stopsAt(this.index)) this._observe();
    else this._setOff(this.nextIndex(this.index));
  };

  // ---------------------------------------------------------------- observing
  mv.GuardPatrol.prototype._observe = function () {
    const c = this.cfg, g = this.guard, wp = c.points[this.index], r = this.rng;
    const face = wp.face != null ? wp.face * D2R : g.yaw;
    const end = !(wp.pause && wp.pause[1] > 0), pause = end ? c.endPause : wp.pause, ownLooks = end && !wp.looks ? c.endLooks : wp.looks;   // (a route's end: the defaults)
    let total = pause ? pause[0] + (pause[1] - pause[0]) * r() : 2;
    // the facing first, then his looks (an extra look is sometimes skipped; each varies a little)
    let offs = [0].concat((ownLooks || []).filter((o, i) => i === 0 || r() >= c.skipLook));
    // Step 10: a bored guard sometimes lingers, adds a casual look, and varies more
    const P = g.personality, ex = P ? P.observeExtras(face, ownLooks) : null;
    if (ex) { total = total * ex.scale + ex.pause; if (ex.dropLast && offs.length > 1) offs = offs.slice(0, -1); offs = offs.concat(ex.looks); }
    const looks = offs.map((o, k) => face + (o + (o && k <= (ownLooks || []).length ? (r() * 2 - 1) * c.lookJitter : 0)) * D2R);
    this.obs = { looks, i: 0, hold: total / looks.length, heldFor: 0, total };
    this.state = 'observing';
  };

  mv.GuardPatrol.prototype._observing = function (dt) {
    const g = this.guard, o = this.obs;
    if (!o) { this._observe(); return; }
    if (!g.isStill()) return;
    const yaw = o.looks[o.i];
    g.faceYaw(yaw);
    this.lookPoint = g.position.clone().add(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(this.cfg.lookPoint));
    if (Math.abs(wrap(g.yaw - yaw)) < 0.09 && Math.abs(g.motor.angularVelocity) < 0.3) o.heldFor += dt;
    if (o.heldFor >= o.hold) {
      o.heldFor = 0; o.i++;
      if (o.i >= o.looks.length) { this.obs = null; this.lookPoint = null; this._setOff(this.nextIndex(this.index)); }
    }
  };

  // short status for the developer view
  mv.GuardPatrol.prototype.status = function () {
    if (!this.enabled) return 'off (stationary guard)';
    const p = this.cfg.points[this.index], at = p ? `W${this.index} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})` : '—';
    if (this.state === 'interrupted') return `interrupted: ${this.why} · resumes at W${this.resumeIndex}`;
    if (this.state === 'observing') return `paused · observing at ${at}` + (this.obs ? ` · ${Math.max(0, this.obs.total - (this.obs.i * this.obs.hold + this.obs.heldFor)).toFixed(1)} s` : '');
    return `${this.rejoining ? 'returning to route' : this.state === 'turning' ? 'turning' : 'moving'} → ${at}` + (this.resumes && !this.rejoining ? ' · resumed' : '');
  };

  // ---------------------------------------------------------------- developer view
  // the route on the ground (thin line through the waypoints; observation points ringed,
  // pass-through points dotted; the active one brighter). Developer-only.
  mv.GuardPatrolView = function (scene, patrol) {
    this.patrol = patrol; this.group = new THREE.Group(); scene.add(this.group);
    const pts = patrol.cfg.points;
    if (!pts.length) return;
    const loop = pts.map(p => new THREE.Vector3(p.x, 0.03, p.z)); if (patrol.cfg.loop) loop.push(loop[0].clone());
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(loop), new THREE.LineDashedMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.45, dashSize: 0.4, gapSize: 0.3 }));
    this.line.computeLineDistances(); this.group.add(this.line);
    this.marks = pts.map(p => {
      const obs = p.pause && p.pause[1] > 0;
      const m = new THREE.Mesh(obs ? new THREE.RingGeometry(0.22, 0.3, 20).rotateX(-Math.PI / 2) : new THREE.CircleGeometry(0.09, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.5, depthWrite: false }));
      m.position.set(p.x, 0.032, p.z); m.renderOrder = 3; this.group.add(m); return m;
    });
  };
  mv.GuardPatrolView.prototype.update = function (visible) {
    const p = this.patrol;
    this.group.visible = visible && p.enabled;
    if (!this.marks) return;
    this.marks.forEach((m, i) => { m.material.opacity = i === p.index && p.state !== 'interrupted' ? 0.95 : 0.4; });
  };
})(SC.mv);
