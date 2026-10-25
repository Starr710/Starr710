// SHADOW CELL — third-person aiming (Step 18): AIM ONLY (no shooting yet). Gameplay only; how
// it looks is aim-pose.js (temporary), the camera's side is camera-rig.js's aim blend.
// AIM toggles (cfg.mode 'toggle'; 'hold' = aim while the button is held). While aiming:
//   - the camera eases into an over-the-shoulder view; the right thumb aims it
//   - she turns (rate-limited, never snapping) to face the horizontal aim direction
//   - the left stick moves her at a deliberate aiming pace, camera-relative as always —
//     forward, backward, strafing, diagonals — without turning her away from the aim
//     (its own locomotion: the normal motor is untouched and resumes when AIM ends)
//   - crouch works as ever (slower aiming pace, lower camera)
//   - footsteps keep their noise: the gait is the one her aiming speed falls in
// The aim itself: the camera's ray through the screen centre (the crosshair), its first
// real obstruction (wall, crate, pillar, guard or ground) is the target point; the future
// weapon would fire from its muzzle toward that point (muzzleClear says whether that line
// is clear too). Nothing here fires, hurts or alerts anyone.
// AIM is only available while she's free (no CQC action, no other action running); while
// aiming, CQC is unavailable (cqc.blocked). If anything else takes over, AIM ends.
(function (mv) {
  'use strict';

  mv.AimDefaults = {
    mode: 'toggle',        // 'toggle' (tap AIM to enter / leave) | 'hold' (aim while AIM is held)
    speed: 1.4,            // m/s at a full push, standing (temporary testing value)
    crouchSpeed: 0.8,      // m/s crouched
    fullPushAt: 0.7, deadZone: 0.06,   // stick push for full speed / ignored below this
    accel: 5, decel: 7,    // m/s²
    turnRate: 7,           // rad/s she can turn to follow the aim…
    turnStiffness: 10, turnSmoothing: 40,   // …chasing it this hard, smoothed (critically damped: settles without overshoot)
    legMax: 45,            // ° her legs turn toward the travel direction (strafing, diagonals); the upper body stays on the aim
    legRate: 8,            // 1/s easing of that
    rayFar: 60,            // m the aim ray looks
    guardRadius: 0.3, guardHeight: 1.8,   // a standing guard's body for the aim ray
  };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  mv.Aim = function (motor, cam, camera, world, guards, opts) {
    this.cfg = Object.assign({}, mv.AimDefaults, opts || {});
    this.motor = motor; this.cam = cam; this.camera = camera; this.world = world; this.guards = guards || [];
    this.ray = new THREE.Raycaster();
    this.reset();
  };

  mv.Aim.prototype.reset = function () {
    this.active = false; this.vel = new THREE.Vector2(0, 0); this.av = 0; this.legYaw = 0; this.enters = 0; this.exits = 0; this.why = '';
    this.target = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), point: null, dist: Infinity, what: 'nothing', guard: null, muzzle: null, muzzleDir: null, muzzleClear: true };
    if (this.cam) { this.cam.aimTarget = 0; this.cam.aimK = 0; this.cam.aimP = 0; }
  };

  // enter / leave
  mv.Aim.prototype.enter = function (allowed) {
    if (this.active) return true;
    if (!allowed) { this.why = 'not now (busy)'; return false; }
    const m = this.motor;
    this.active = true; this.enters++; this.why = '';
    this.vel.set(Math.sin(m.yaw) * Math.max(0, m.speed), Math.cos(m.yaw) * Math.max(0, m.speed));   // keep her momentum, then slow to the aiming pace
    this.av = m.angularVelocity || 0;
    if (this.cam) this.cam.aimTarget = 1;
    return true;
  };
  mv.Aim.prototype.exit = function (why) {
    if (!this.active) return;
    const m = this.motor;
    this.active = false; this.exits++; this.why = why || '';
    // the normal motor carries on from her current motion (no stop, no jump)
    const f = this.vel.x * Math.sin(m.yaw) + this.vel.y * Math.cos(m.yaw);
    m.speed = Math.max(0, f); m.targetSpeed = m.speed; m.reverseGait = false;
    if (this.cam) this.cam.aimTarget = 0;
  };
  mv.Aim.prototype.toggle = function (allowed) { return this.active ? (this.exit('AIM tapped'), false) : this.enter(allowed); };

  // per frame while aiming, instead of motor.update: stick (dx, dz) world direction, mag 0…1
  mv.Aim.prototype.step = function (dt, dx, dz, mag, crouched) {
    const c = this.cfg, m = this.motor;
    // face the aim (horizontal): rate-limited and smoothed
    const want = wrap(this.cam.yaw + Math.PI), diff = wrap(want - m.yaw);
    const wantAv = Math.max(-c.turnRate, Math.min(c.turnRate, diff * c.turnStiffness));
    this.av += (wantAv - this.av) * (1 - Math.exp(-c.turnSmoothing * dt));
    m.yaw = wrap(m.yaw + this.av * dt); m.angularVelocity = this.av;
    // move at the aiming pace, any direction, without turning
    const push = mag > c.deadZone ? Math.min(1, (mag - c.deadZone) / (c.fullPushAt - c.deadZone)) : 0;
    const top = (crouched ? c.crouchSpeed : c.speed) * push, tl = Math.hypot(dx, dz) || 1;
    const tx = dx / tl * top, tz = dz / tl * top, ex = tx - this.vel.x, ez = tz - this.vel.y, el = Math.hypot(ex, ez);
    const lim = (top > Math.hypot(this.vel.x, this.vel.y) ? c.accel : c.decel) * dt;
    if (el > lim) { this.vel.x += ex / el * lim; this.vel.y += ez / el * lim; } else this.vel.set(tx, tz);
    const r = this.world.resolve(m.position.x + this.vel.x * dt, m.position.z + this.vel.y * dt, m.cfg.radius, {});
    if (dt > 0) { this.vel.set((r.x - m.position.x) / dt, (r.z - m.position.z) / dt); }   // blocked by a wall: she stops against it
    m.position.x = r.x; m.position.z = r.z; m.velocity.set(this.vel.x, 0, this.vel.y); m.blocked = false;
    // what the animator and footsteps read: speed, stepping backward, the gait it falls in
    const spd = Math.hypot(this.vel.x, this.vel.y), fx = Math.sin(m.yaw), fz = Math.cos(m.yaw), along = this.vel.x * fx + this.vel.y * fz;
    const back = spd > 0.05 && along < -0.15 * spd;
    m.speed = spd > 0.03 ? spd : 0; m.targetSpeed = push > 0 ? m.speed : 0; m.accel = 0; m.reverseGait = back;
    m.gait = crouched ? mv.CROUCH_GAITS[spd < 0.05 ? 0 : spd <= 1.4 ? 1 : 2] : mv.GAITS.find(g => spd <= g.max);
    // legs toward the travel (backpedalling: toward straight back), the upper body stays on the aim
    let leg = 0;
    if (spd > 0.08) { const rel = wrap(Math.atan2(this.vel.x, this.vel.y) - m.yaw); leg = back ? wrap(rel + Math.PI) : rel; }
    const lm = c.legMax * Math.PI / 180; leg = Math.max(-lm, Math.min(lm, leg));
    this.legYaw += (leg - this.legYaw) * (1 - Math.exp(-c.legRate * dt));
  };
  // when not aiming, the leg turn eases back out (her normal facing)
  mv.Aim.prototype.idle = function (dt) { this.legYaw += (0 - this.legYaw) * (1 - Math.exp(-this.cfg.legRate * dt)); if (Math.abs(this.legYaw) < 1e-4) this.legYaw = 0; };

  // the aim ray (after the camera has moved): camera centre ray, its first real obstruction
  const _p = new THREE.Vector3(), _q = new THREE.Vector3();
  mv.Aim.prototype.trace = function (muzzle, muzzleDir) {
    const c = this.cfg, T = this.target, cam = this.camera;
    cam.updateMatrixWorld(); cam.getWorldPosition(T.origin); cam.getWorldDirection(T.dir);
    let best = c.rayFar, what = 'nothing', guard = null;
    this.ray.set(T.origin, T.dir); this.ray.near = 0.05; this.ray.far = c.rayFar;
    const hits = this.ray.intersectObjects(this.world.meshes, false);
    if (hits.length && hits[0].distance < best) { best = hits[0].distance; what = 'wall / cover'; }
    // the ground
    if (T.dir.y < -1e-4) { const d = -T.origin.y / T.dir.y; if (d > 0 && d < best) { best = d; what = 'ground'; } }
    // guards: a standing body as an upright capsule (a downed one isn't a target yet)
    for (const g of this.guards) {
      if (!g || (g.isDown && g.isDown())) continue;
      const d = rayCylinder(T.origin, T.dir, g.position.x, g.position.z, c.guardRadius, c.guardHeight);
      if (d != null && d < best) { best = d; what = g.cfg.label; guard = g; }
    }
    T.dist = best; T.what = what; T.guard = guard;
    T.point = (T.point || new THREE.Vector3()).copy(T.origin).addScaledVector(T.dir, best);
    // for the future weapon: is the line from its muzzle to that point clear as well?
    T.muzzle = muzzle ? (T.muzzle || new THREE.Vector3()).copy(muzzle) : null;
    T.muzzleDir = muzzle && muzzleDir ? (T.muzzleDir || new THREE.Vector3()).copy(muzzleDir) : null;   // which way the weapon points
    T.muzzleClear = muzzle ? !this.world.segmentBlocked(_p.copy(muzzle), _q.copy(T.point).addScaledVector(T.dir, -0.05)) : true;
    return T;
  };
  // distance along a ray to an upright cylinder (x, z, r, height 0…h), or null (also used by the pistol, Step 19)
  mv.Aim.rayCylinder = rayCylinder;
  function rayCylinder(o, d, x, z, r, h) {
    const fx = o.x - x, fz = o.z - z, A = d.x * d.x + d.z * d.z, B = 2 * (fx * d.x + fz * d.z), C = fx * fx + fz * fz - r * r;
    if (A < 1e-9) return null;
    const D = B * B - 4 * A * C; if (D < 0) return null;
    const t = (-B - Math.sqrt(D)) / (2 * A); if (t <= 0) return null;
    const y = o.y + d.y * t; return y >= 0 && y <= h ? t : null;
  }

  // short status for the developer view
  mv.Aim.prototype.status = function (crouched) {
    const m = this.motor, T = this.target, k = this.cam ? this.cam.aimK || 0 : 0;
    if (!this.active && k < 0.01) return `off${this.why ? ' · ' + this.why : ''}`;
    const deg = a => Math.round(a * 180 / Math.PI);
    const el = Math.asin(Math.max(-1, Math.min(1, T.dir.y)));
    return `${this.active ? 'ON' : 'leaving'} · cam ${k > 0.99 ? 'over-shoulder' : 'blending ' + Math.round(k * 100) + '%'} ${this.cam.dist.toFixed(2)} m · yaw ${deg(m.yaw)}° · aim ${deg(wrap(this.cam.yaw + Math.PI))}°/${deg(el)}° · ` +
      `${T.what} ${isFinite(T.dist) ? T.dist.toFixed(1) + ' m' : ''}${T.muzzleClear ? '' : ' (muzzle blocked)'} · ${crouched ? 'crouched' : 'standing'} ${Math.hypot(this.vel.x, this.vel.y).toFixed(2)} m/s`;
  };
})(SC.mv);
