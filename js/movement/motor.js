// SHADOW CELL — movement: character motor (movement + "physics").
// Knows nothing about meshes, bones or animation clips. It turns a desired
// direction + intensity into a position, a facing and a speed with weight:
// speed ramps with acceleration/deceleration, the body turns at a limited,
// smoothed angular rate, hard reversals brake first, and collisions slide.
// Characters move the way they face (no strafing in this stage).
(function (mv) {
  'use strict';

  const TAU = Math.PI * 2;
  const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  // Gait speeds (m/s). The stick picks a speed continuously; RUN overrides to sprint.
  mv.GAITS = [
    { id: 'idle', label: 'IDLE', max: 0.05 },
    { id: 'sneak', label: 'SNEAK', max: 1.3 },
    { id: 'walk', label: 'STEALTH WALK', max: 2.3 },
    { id: 'jog', label: 'JOG', max: 4.3 },
    { id: 'sprint', label: 'SPRINT', max: Infinity },
  ];

  mv.CROUCH_GAITS = [{ id: 'crouch', label: 'CROUCH' }, { id: 'crouchwalk', label: 'CROUCH WALK' }];

  mv.MotorDefaults = {
    radius: 0.32,
    // stick magnitude → target speed, piecewise linear
    // wide, separate zones: sneak up to ~60% push, stealth walk ~68–88%, jog past ~94%
    speedCurve: [[0.12, 1.0], [0.6, 1.25], [0.68, 1.9], [0.88, 2.0], [0.94, 3.2], [1.0, 3.2]],
    sprintSpeed: 5.6,
    // crouch-walk: light push creeps, full push is a steady crouch-walk
    crouchSpeedCurve: [[0.12, 0.6], [0.55, 1.0], [0.8, 1.8], [1.0, 2.0]],
    accel: 3.4,            // m/s² when speeding up at walking pace…
    accelFast: 2.6,        // …and when pushing past jog into a sprint (it takes effort)
    decel: 5.2,            // m/s² when easing off
    brake: 9.0,            // m/s² when reversing hard
    maxStopTime: 0.9,      // s; finishing a step never drags on longer than this
    turnRateWalk: 6.5,     // rad/s max body turn rate at walking speed
    turnRateSprint: 2.6,   // rad/s at full sprint (wide arcs)
    turnRateIdle: 7.5,     // rad/s turning on the spot from a stand
    turnStiffness: 9,      // how hard the body chases the stick angle
    turnSmoothing: 16,     // angular-velocity smoothing (higher = snappier)
  };

  mv.CharacterMotor = function (world, opts) {
    this.world = world;
    this.cfg = Object.assign({}, mv.MotorDefaults, opts || {});
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;              // facing; 0 = +Z
    this.speed = 0;            // signed forward speed along the facing
    this.angularVelocity = 0;  // rad/s, + = turning left
    this.accel = 0;            // m/s², for animation lean
    this.targetSpeed = 0;
    this.gait = mv.GAITS[0];
    this.stance = 'stand';     // 'stand' | 'crouch'
    this.blocked = false;
    this.stopDistance = 0;     // set by the animator while finishing a step
    this.contactX = 0; this.contactZ = 0;
    this._res = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
  };

  mv.CharacterMotor.prototype.teleport = function (x, z, yaw) {
    this.position.set(x, this.groundHeight(x, z), z);
    this.yaw = yaw || 0;
    this.speed = 0; this.angularVelocity = 0; this.velocity.set(0, 0, 0);
  };

  // flat test floor; later stages swap in terrain/stairs here
  mv.CharacterMotor.prototype.groundHeight = function () { return 0; };

  function curve(points, m) {
    if (m <= points[0][0]) return 0;
    for (let i = 1; i < points.length; i++) {
      if (m <= points[i][0]) { const a = points[i - 1], b = points[i]; return lerp(a[1], b[1], (m - a[0]) / (b[0] - a[0])); }
    }
    return points[points.length - 1][1];
  }

  // dirX/dirZ: desired world-space direction (unit or zero), magnitude 0..1, sprint flag.
  mv.CharacterMotor.prototype.update = function (dt, dirX, dirZ, magnitude, sprint) {
    const c = this.cfg;
    const crouched = this.stance === 'crouch';
    let target = curve(crouched ? c.crouchSpeedCurve : c.speedCurve, magnitude);
    if (sprint && magnitude > 0.35 && !crouched) target = c.sprintSpeed;
    const hasInput = target > 0;

    // ---- turning: chase the stick angle with a limited, smoothed angular rate
    let diff = 0;
    if (hasInput) {
      diff = wrap(Math.atan2(dirX, dirZ) - this.yaw);
      const sp = Math.max(0, this.speed);
      const maxRate = sp < 0.6 ? lerp(c.turnRateIdle, c.turnRateWalk, sp / 0.6)
        : lerp(c.turnRateWalk, c.turnRateSprint, smooth(1.6, c.sprintSpeed, sp));
      const want = Math.max(-maxRate, Math.min(maxRate, diff * c.turnStiffness));
      this.angularVelocity += (want - this.angularVelocity) * (1 - Math.exp(-c.turnSmoothing * dt));
    } else {
      this.angularVelocity *= Math.exp(-c.turnSmoothing * dt);
    }
    this.yaw = wrap(this.yaw + this.angularVelocity * dt);

    // ---- speed: only commit to moving once facing roughly the right way;
    // a hard reversal at speed brakes before turning round
    const align = Math.cos(Math.min(Math.abs(diff), Math.PI));
    if (hasInput) target *= smooth(-0.2, 0.75, align);
    // pushing straight into a wall: stand still rather than tread in place
    if (this.blocked) target *= smooth(-0.85, -0.45, dirX * this.contactX + dirZ * this.contactZ);
    this.targetSpeed = target;
    const prev = this.speed;
    let rate;
    if (target > this.speed) rate = this.speed > 3.2 ? c.accelFast : c.accel;
    else rate = align < 0 && this.speed > 1.5 ? c.brake : c.decel;
    // the animator may ask for a specific stopping distance so the last step lands
    // on a natural stop pose; brake just hard enough to cover exactly that distance
    if (target > 0 || this.stopV0 == null) this.stopV0 = target > 0 ? null : this.speed;
    if (target === 0 && this.stopDistance > 0 && this.speed > 0.05) rate = Math.min(c.brake, Math.max(0.8, (this.stopV0 || this.speed) / c.maxStopTime, this.speed * this.speed / (2 * this.stopDistance)));
    const dv = target - this.speed;
    this.speed += Math.sign(dv) * Math.min(Math.abs(dv), rate * dt);
    // soften the last few cm/s so starts and stops ease in and out
    if (Math.abs(dv) < 0.25 && !(target === 0 && this.stopDistance > 0)) this.speed += (target - this.speed) * (1 - Math.exp(-6 * dt));
    if (this.speed < 0.005 && target === 0) this.speed = 0;

    // ---- integrate + collide
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const ox = this.position.x, oz = this.position.z;
    const r = this.world.resolve(ox + fx * this.speed * dt, oz + fz * this.speed * dt, c.radius, this._res);
    this.position.x = r.x; this.position.z = r.z;
    this.position.y = this.groundHeight(r.x, r.z);
    this.blocked = r.hit;
    this.contactX = r.nx; this.contactZ = r.nz;
    const vx = dt > 0 ? (r.x - ox) / dt : 0, vz = dt > 0 ? (r.z - oz) / dt : 0;
    this.velocity.set(vx, 0, vz);
    if (r.hit) {
      // pressing into a wall: the legs slow to the speed actually achieved
      // (head-on she settles to a stand instead of treading in place)
      const achieved = Math.max(0, vx * fx + vz * fz) + Math.hypot(vx, vz) * 0.35;
      if (achieved < this.speed) this.speed += (achieved - this.speed) * (1 - Math.exp(-10 * dt));
    }
    this.accel = dt > 0 ? (this.speed - prev) / dt : 0;

    // ---- gait label (for animation + HUD)
    const s = this.speed;
    this.gait = crouched ? (s < 0.05 ? mv.CROUCH_GAITS[0] : mv.CROUCH_GAITS[1]) : mv.GAITS.find(g => s <= g.max);
  };
})(SC.mv);
