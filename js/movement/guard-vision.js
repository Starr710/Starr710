// SHADOW CELL — guard vision (docs/GAME_DESIGN.md §3, §7 "Simple Cover").
// Three nested horizontal zones centred on the guard's facing. Anywhere inside
// the widest zone and within the profile's range, with a clear line of sight to
// enough of the body, the guard's detection meter fills; faster nearer the
// centre, nearer the guard, for a standing and moving target. Losing sight holds
// the meter briefly, then it falls gradually. No reactions, memory or
// investigation yet: the meter is all this stage produces.
// All values below are initial test values, adjustable here.
(function (mv) {
  'use strict';

  mv.VisionDefaults = {
    // nested zones: total angle (degrees) centred on the facing, and the meter's
    // fill rate (per second) for a standing, moving target at close range
    zones: [
      { id: 'fastest', angle: 30, rate: 1.2 },
      { id: 'normal', angle: 70, rate: 0.7 },
      { id: 'slower', angle: 110, rate: 0.35 },
    ],
    // vision capability: how far the guard can see (m)
    profiles: { short: { range: 10 }, regular: { range: 16 }, great: { range: 24 } },
    fullRateDistance: 2.5,   // m: up to here the zone rate applies in full…
    farRateScale: 0.15,      // …easing down to this fraction of it at the profile's range
    stance: { stand: 1, crouch: 0.5 },
    // movement: still, then from slow (sneak, ~1 m/s) to fast (jog, fastSpeed)
    movement: { still: 0.5, slow: 0.85, fast: 1.3, fastSpeed: 3.2 },
    closeRange: 2.0,         // m: unobstructed and inside the cone this close…
    closeRate: 5,            // …the meter fills at this rate (recognised in ~0.2 s)
    coverBlock: 0.5,         // Simple Cover: below this visible share of the body, she's hidden
    holdTime: 1.0,           // s the meter holds after losing sight…
    decayRate: 0.3,          // …then falls at this rate per second
    updateHz: 10,            // perception checks per second (the meter itself moves every frame)
  };

  // What a guard can look at: sample points on the body (from the posed bones,
  // so crouching lowers them), the stance and the speed. Built for the player
  // now; later for bodies and other characters.
  const TARGET_BONES = ['head', 'neck', 'chest', 'spine', 'hips', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
  mv.visionTarget = function (visual, motor) {
    const bones = TARGET_BONES.map(k => visual.bones[k]).filter(Boolean), pts = bones.map(() => new THREE.Vector3());
    return {
      points() { bones.forEach((b, i) => b.getWorldPosition(pts[i])); return pts; },
      centre(out) { return (visual.bones.chest || visual.bones.hips).getWorldPosition(out); },
      get position() { return motor.position; },   // where she stands (for collision and "last seen")
      get stance() { return motor.stance; },
      get speed() { return Math.abs(motor.speed); },
    };
  };

  mv.GuardVision = function (guard, profile, opts) {
    this.guard = guard;
    this.cfg = Object.assign({}, mv.VisionDefaults, opts || {});
    this.profile = profile || 'regular';
    this.meter = 0;            // 0 … 1 (1 = recognised)
    this.sinceSeen = Infinity;
    this.acc = Infinity;       // look on the first update
    // last look: zone id (or null), distance, visible share of the body, fill rate,
    // and why not, when not seen: 'range', 'cone' or 'blocked'
    // position: where she stood at that look, if he saw her (what he actually observed)
    this.seen = { zone: null, distance: Infinity, exposure: 0, rate: 0, blocked: false, why: 'range', rays: [], position: null };
  };

  mv.GuardVision.prototype.range = function () { return this.cfg.profiles[this.profile].range; };

  // which zone a horizontal angle off the facing (degrees, either side) falls in
  mv.GuardVision.prototype.zoneAt = function (offDeg) {
    const zones = this.cfg.zones.slice().sort((a, b) => a.angle - b.angle);
    return zones.find(z => offDeg <= z.angle / 2) || null;
  };

  const _e = new THREE.Vector3(), _c = new THREE.Vector3(), _f = new THREE.Vector3();
  mv.GuardVision.prototype.look = function (target) {
    const c = this.cfg, g = this.guard, eye = g.eye(_e), centre = target.centre(_c), fwd = g.forward(_f);
    const dx = centre.x - eye.x, dz = centre.z - eye.z, dist = Math.hypot(dx, dz);
    const off = dist > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, (dx * fwd.x + dz * fwd.z) / dist))) * 57.2958 : 0;
    const s = this.seen; s.distance = dist; s.off = off; s.zone = null; s.rate = 0; s.blocked = false; s.exposure = 0; s.rays.length = 0; s.position = null;
    if (dist > this.range()) { s.why = 'range'; return s; }
    const zone = this.zoneAt(off);
    if (!zone) { s.why = 'cone'; return s; }
    s.zone = zone.id;
    // line of sight to each body point; Simple Cover: hidden if most of her is behind solid cover
    const pts = target.points(); let clear = 0;
    for (const p of pts) { const ok = !g.world.segmentBlocked(eye, p); if (ok) clear++; s.rays.push(ok); }
    s.exposure = pts.length ? clear / pts.length : 0;
    if (s.exposure < c.coverBlock) { s.blocked = true; s.why = 'blocked'; return s; }
    s.why = null;
    if (target.position) { s.position = target.position.clone(); s.position.y = 0; }
    if (dist <= c.closeRange) { s.rate = c.closeRate; return s; }
    const far = smooth(c.fullRateDistance, this.range(), dist), distF = 1 - (1 - c.farRateScale) * far;
    const m = c.movement, sp = target.speed;
    const moveF = sp < 0.05 ? m.still : m.slow + (m.fast - m.slow) * Math.min(1, Math.max(0, (sp - 1) / (m.fastSpeed - 1)));
    const stanceF = c.stance[target.stance] != null ? c.stance[target.stance] : 1;
    s.rate = zone.rate * distF * stanceF * moveF * s.exposure;
    return s;
  };
  function smooth(a, b, v) { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); }

  mv.GuardVision.prototype.update = function (dt, target) {
    this.acc += dt;
    if (this.acc >= 1 / this.cfg.updateHz) { this.acc = 0; this.look(target); }
    const s = this.seen;
    if (s.rate > 0) { this.meter = Math.min(1, this.meter + s.rate * dt); this.sinceSeen = 0; }
    else {
      this.sinceSeen += dt;
      if (this.sinceSeen > this.cfg.holdTime) this.meter = Math.max(0, this.meter - this.cfg.decayRate * dt);
    }
  };

  // Step 14: unconscious, he sees nothing (and has seen nothing since)
  mv.GuardVision.prototype.blind = function () {
    const s = this.seen; this.meter = 0; this.sinceSeen = Infinity; this.acc = Infinity;
    s.zone = null; s.rate = 0; s.blocked = false; s.exposure = 0; s.rays.length = 0; s.position = null; s.distance = Infinity; s.why = 'unconscious';
  };

  // short state for the developer view
  mv.GuardVision.prototype.state = function () {
    const s = this.seen;
    if (s.why === 'unconscious' && this.guard.isDown && this.guard.isDown()) return this.guard.ko && this.guard.ko.state === 'DEAD' ? 'DEFEATED' : 'UNCONSCIOUS';
    if (this.meter >= 1 && s.rate > 0) return 'RECOGNISED';
    if (s.rate > 0) return 'SEEING';
    if (this.meter > 0) return this.sinceSeen > this.cfg.holdTime ? 'FADING' : 'HOLDING';
    return s.why === 'blocked' ? 'BLOCKED' : s.why === 'cone' ? 'OUT OF VIEW' : 'OUT OF RANGE';
  };

  // ---------------------------------------------------------------- developer view
  // The three zones on the ground, a sight line to the target (green: seen,
  // red: blocked by cover, grey: outside the cone or range) and a detection meter
  // over the guard's head. Developer-only: remove or hide with `visible`.
  const ZONE_COLORS = { fastest: 0xff4b3d, normal: 0xff9a3d, slower: 0xffd84d };
  mv.GuardDebugView = function (scene, guard) {
    this.guard = guard; this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.zones = new THREE.Group(); this.group.add(this.zones);
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.9 }));
    this.line.frustumCulled = false; this.group.add(this.line);
    this.bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.16), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7, depthWrite: false }));
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.1), new THREE.MeshBasicMaterial({ color: 0xffd84d, depthWrite: false }));
    this.fill.position.z = 0.001; this.bar.add(bg, this.fill); this.bar.renderOrder = 3; this.group.add(this.bar);
    this.rebuild();
  };

  // (re)draw the zones from the current angles and range
  mv.GuardDebugView.prototype.rebuild = function () {
    const v = this.guard.vision, R = v.range();
    this.zones.clear();
    for (const z of v.cfg.zones.slice().sort((a, b) => b.angle - a.angle)) {
      const half = z.angle / 2 * Math.PI / 180;
      // CircleGeometry sweeps from +X anticlockwise; laid flat, angle -90° points along +Z (the facing)
      const fan = new THREE.Mesh(new THREE.CircleGeometry(R, 48, -Math.PI / 2 - half, half * 2).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: ZONE_COLORS[z.id] || 0xffffff, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
      fan.position.y = 0.012; fan.renderOrder = 1; this.zones.add(fan);
      const edge = [new THREE.Vector3(Math.sin(-half) * R, 0.014, Math.cos(-half) * R), new THREE.Vector3(0, 0.014, 0), new THREE.Vector3(Math.sin(half) * R, 0.014, Math.cos(half) * R)];
      this.zones.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge), new THREE.LineBasicMaterial({ color: ZONE_COLORS[z.id] || 0xffffff, transparent: true, opacity: 0.95 })));
    }
  };

  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  mv.GuardDebugView.prototype.update = function (camera, target) {
    const g = this.guard, v = g.vision, s = v.seen;
    this.group.visible = !(g.isDown && g.isDown());   // Step 14: no sight while he's down
    if (!this.group.visible) return;
    this.zones.position.set(g.position.x, 0, g.position.z); this.zones.rotation.y = g.yaw;
    const eye = g.eye(_a), c = target.centre(_b);
    const pos = this.line.geometry.attributes.position; pos.setXYZ(0, eye.x, eye.y, eye.z); pos.setXYZ(1, c.x, c.y, c.z); pos.needsUpdate = true;
    this.line.material.color.setHex(s.rate > 0 ? 0x5dff7a : s.blocked ? 0xff4040 : 0x777777);
    this.line.material.opacity = s.zone ? 0.9 : 0.35;
    this.bar.position.set(eye.x, eye.y + 0.42, eye.z); this.bar.quaternion.copy(camera.quaternion);
    this.fill.scale.x = Math.max(0.001, v.meter); this.fill.position.x = -0.52 * (1 - v.meter);
    this.fill.material.color.setHex(v.meter >= 1 ? 0xff3d3d : 0xffd84d);
  };
})(SC.mv);
