// SHADOW CELL — guards (docs/GAME_DESIGN.md §3–4).
// A guard is its own character type, not a copy of the player controller: no
// input, camera or HUD. It reuses the player's loaded model as a lightweight
// skinned copy (geometry, textures and animation clips are shared; only the
// skeleton, the animation mixer and a tinted uniform material are per guard).
// Stage 5: eyes (guard-vision.js), ears (guard-hearing.js) and a first brain
// (guard-awareness.js). He walks with his own instance of the player's motor
// (same acceleration, braking, turning and wall collision, gentler settings) and
// the player's animation controller on his copy of the model. Standing, he turns
// on the spot with a turn-only mode that drives the same controller's in-place
// turning steps. Paths come from a small visibility-graph planner (guard-nav.js).
(function (mv) {
  'use strict';

  mv.GuardDefaults = {
    uniform: 0x5f84d8,   // multiplies the soldier's texture: a slate-blue uniform, unlike the player's tan
    radius: 0.32,        // m, collision (the player can't walk through a guard)
    height: 1.8,
    vision: 'regular',   // vision profile (mv.VisionDefaults.profiles)
    hearing: 'regular',  // hearing profile (mv.HearingDefaults.profiles)
    // the soldier's idle clip stands turned side-on (hips ~45°, shoulders ~18° off its
    // facing); turn the model so his shoulders, and so his head, face where he looks
    squareShoulders: true,
    // turning on the spot: chase the wanted facing with a limited, smoothed rate
    turn: { maxRate: 3.0, stiffness: 4.5, smoothing: 7 },   // rad/s, 1/s, 1/s
    // his walking motor: the player's motor class with calmer settings (the player's
    // own motor is a separate instance and keeps its values)
    motor: { accel: 2.5, decel: 3.5, turnRateWalk: 3.0, turnRateIdle: 3.0, turnStiffness: 4.5, turnSmoothing: 7 },
    // his animator: the clip's natural stride (the player's shorter stealth stride is
    // made by her posture layer's leg IK, which the guard doesn't run)
    animator: { strideScale: [[0, 1], [6, 1]] },
    atPostWithin: 0.6,     // m from his post that counts as being at it
    waypointWithin: 0.6,   // m: a path waypoint counts as reached
    stuckTime: 2.5,        // s without getting this much…
    stuckProgress: 0.25,   // …(m) closer to the next waypoint means he's stuck: stop safely
  };

  // Copy a skinned model: new bones and skinned meshes bound to them, sharing
  // geometry and materials (what three.js SkeletonUtils.clone does).
  mv.cloneSkinned = function (source) {
    const clone = source.clone(true), map = new Map();
    const walk = (a, b) => { map.set(a, b); for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]); };
    walk(source, clone);
    source.traverse(src => {
      if (!src.isSkinnedMesh) return;
      const dst = map.get(src);
      dst.skeleton = src.skeleton.clone();
      dst.bindMatrix.copy(src.bindMatrix);
      dst.skeleton.bones = src.skeleton.bones.map(bone => map.get(bone));
      dst.bind(dst.skeleton, dst.bindMatrix);
    });
    return clone;
  };

  // one tinted copy of each source material, shared by every guard
  const uniformCache = new Map();
  function uniformMaterial(m, tint) {
    const key = m.uuid + ':' + tint;
    if (!uniformCache.has(key)) { const u = m.clone(); if (u.color) u.color.multiply(new THREE.Color(tint)); uniformCache.set(key, u); }
    return uniformCache.get(key);
  }

  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  // playerVisual: the loaded mv.CharacterVisual whose model and clips are shared
  // noise: the mv.NoiseSystem the guard listens to (optional)
  mv.Guard = function (scene, world, playerVisual, opts, noise) {
    const o = this.cfg = Object.assign({}, mv.GuardDefaults, opts || {});
    this.world = world;
    this.motor = new mv.CharacterMotor(world, o.motor);
    this.motor.teleport(o.x || 0, o.z || 0, o.yaw || 0);
    this.position = this.motor.position;         // facing: this.yaw (the motor's); 0 = +Z
    this.post = this.position.clone();           // his assigned post…
    this.postYaw = this.motor.yaw;               // …and its facing
    this.wantYaw = this.motor.yaw;               // where he's turning to when standing
    this.path = null; this.goal = null; this.moving = false; this.arrived = false; this.navFailed = null;
    this.root = new THREE.Group(); this.lean = new THREE.Group(); this.root.add(this.lean);
    const pivot = this.pivot = new THREE.Group(); pivot.rotation.y = playerVisual.profile.forwardYaw || 0;
    this.model = mv.cloneSkinned(playerVisual.model);
    const byName = {};
    this.model.traverse(n => {
      if (n.isMesh) { n.castShadow = true; n.frustumCulled = false; n.material = Array.isArray(n.material) ? n.material.map(m => uniformMaterial(m, o.uniform)) : uniformMaterial(n.material, o.uniform); }
      if (n.isBone) byName[n.name] = n;
    });
    // the same canonical bones as the player's, found by name in the copy
    this.bones = {};
    for (const k in playerVisual.bones) if (byName[playerVisual.bones[k].name]) this.bones[k] = byName[playerVisual.bones[k].name];
    this.head = this.bones.head;
    pivot.add(this.model); this.lean.add(pivot); scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.model);
    // the player's animation controller drives the guard's copy: idle, and in-place
    // turning steps; the turn-only body below stands in for the player's motor
    this.visual = { clips: playerVisual.clips, profile: playerVisual.profile, mixer: this.mixer, bones: this.bones, root: this.root, lean: this.lean };
    this.place();
    this.animator = new mv.AnimationController(this.visual, o.animator);
    this.body = this.motor;                      // what the animator reads (speed, turning, stance)
    this.pivotYaw = this.pivot.rotation.y;
    this.squareYaw = o.squareShoulders ? this.shoulderOffset() : 0;
    this.collider = world.addCylinder(this.position.x, this.position.z, o.radius, o.height, null, { noSight: true });
    this.nav = mv.GuardNav ? new mv.GuardNav(world, o.radius) : null;
    this.vision = new mv.GuardVision(this, o.vision);
    this.hearing = noise && mv.GuardHearing ? new mv.GuardHearing(this, noise, o.hearing) : null;
    this.awareness = mv.GuardAwareness ? new mv.GuardAwareness(this) : null;
    if (this.hearing && this.awareness) this.hearing.onHeard = rec => this.awareness.onHeard(rec);
    this.place();
  };

  Object.defineProperty(mv.Guard.prototype, 'yaw', { get() { return this.motor.yaw; }, set(v) { this.motor.yaw = v; } });

  // back to his post, calm (the lab's RESET)
  mv.Guard.prototype.reset = function () {
    this.motor.teleport(this.post.x, this.post.z, this.postYaw);
    this.wantYaw = this.postYaw; this.path = null; this.moving = false; this.arrived = false; this.navFailed = null;
    this.vision.meter = 0; this.vision.sinceSeen = Infinity;
    if (this.awareness) this.awareness.reset();
    this.place();
  };

  // ---------------------------------------------------------------- movement orders (from the brain)
  // walk to a point, letting the walk finish once within `within` m; false if no path
  mv.Guard.prototype.goTo = function (p, within) {
    this.arrived = false; this.navFailed = null;
    const path = this.nav ? this.nav.plan(this.position, p) : [{ x: p.x, z: p.z }];
    if (!path) { this.moving = false; this.path = null; this.navFailed = 'unreachable'; return false; }
    this.path = path; this.goal = { x: p.x, z: p.z }; this.within = within; this.moving = true;
    this._best = Infinity; this._bestAt = 0; this._clock = this._clock || 0;
    return true;
  };
  mv.Guard.prototype.stopMoving = function () { this.moving = false; this.path = null; this.wantYaw = this.yaw; };
  mv.Guard.prototype.isStill = function () { return !this.moving && Math.abs(this.motor.speed) < 0.01 && this.animator.state === 'stopped'; };
  mv.Guard.prototype.atPost = function () { return Math.hypot(this.position.x - this.post.x, this.position.z - this.post.z) <= this.cfg.atPostWithin; };

  mv.Guard.prototype.place = function () {
    this.root.position.copy(this.position); this.root.rotation.y = this.yaw;
    if (this.collider) { this.collider.x = this.position.x; this.collider.z = this.position.z; }
  };

  // turn (on the spot) to face a world point, or back to the post facing
  mv.Guard.prototype.faceToward = function (p) { this.wantYaw = Math.atan2(p.x - this.position.x, p.z - this.position.z); };
  mv.Guard.prototype.faceYaw = function (yaw) { this.wantYaw = yaw; };

  // ---------------------------------------------------------------- locomotion
  // one motor step with his own collision body out of the way (so he doesn't bump himself)
  mv.Guard.prototype._motorStep = function (dt, x, z, push) {
    const cx = this.collider.x; this.collider.x = 1e6;
    this.motor.update(dt, x, z, push);
    this.collider.x = cx;
  };

  mv.Guard.prototype._locomotion = function (dt, other) {
    const o = this.cfg, a = this.awareness ? this.awareness.cfg : mv.AwarenessDefaults, m = this.motor, p = this.position;
    this._clock = (this._clock || 0) + dt;
    if (this.moving && this.path) {
      let wp = this.path[0];
      while (this.path.length > 1 && Math.hypot(wp.x - p.x, wp.z - p.z) < o.waypointWithin) { this.path.shift(); wp = this.path[0]; this._best = Infinity; }
      const toGoal = Math.hypot(this.goal.x - p.x, this.goal.z - p.z);
      if (this.path.length === 1 && toGoal <= this.within) { this.moving = false; this.arrived = true; this.path = null; }
      else {
        // stuck: no real progress toward the next waypoint for a while → stop safely
        const d = Math.hypot(wp.x - p.x, wp.z - p.z);
        if (d < this._best - o.stuckProgress) { this._best = d; this._bestAt = this._clock; }
        else if (this._clock - this._bestAt > o.stuckTime) { this.moving = false; this.path = null; this.navFailed = 'stuck'; }
        else {
          const push = this.path.length === 1 && toGoal < a.slowWithin ? a.slowPush : a.walkPush;
          this._motorStep(dt, (wp.x - p.x) / d, (wp.z - p.z) / d, push);
        }
      }
      this.wantYaw = m.yaw;
    }
    if (!this.moving) {
      // finish the step and stop with the motor, then turn on the spot
      if (Math.abs(m.speed) > 0.01 || this.animator.state !== 'stopped') { this._motorStep(dt, 0, 0, 0); this.wantYaw = this.wantYaw == null ? m.yaw : this.wantYaw; }
      else { m.speed = 0; m.targetSpeed = 0; m.accel = 0; this._turn(dt); }
    }
    // never walk through the player either: step back out of her if they overlap
    if (other) {
      const q = other.position, dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz), min = o.radius * 2;
      if (d < min && d > 1e-4) { p.x = q.x + dx / d * min; p.z = q.z + dz / d * min; }
    }
  };

  // the turn-only body: angular velocity chases the wanted facing, limited and smoothed
  mv.Guard.prototype._turn = function (dt) {
    const t = this.cfg.turn, b = this.body, diff = wrap(this.wantYaw - this.yaw);
    const want = Math.max(-t.maxRate, Math.min(t.maxRate, diff * t.stiffness));
    b.angularVelocity += (want - b.angularVelocity) * (1 - Math.exp(-t.smoothing * dt));
    if (Math.abs(diff) < 0.003 && Math.abs(b.angularVelocity) < 0.02) b.angularVelocity = 0;
    this.yaw = wrap(this.yaw + b.angularVelocity * dt);
  };

  // how far (radians, + toward +X) the idle pose's shoulders face from his facing,
  // averaged over one idle cycle (the clip sways)
  mv.Guard.prototype.shoulderOffset = function () {
    const N = 16, dur = this.visual.clips.idle.duration, fw = this.forward();
    let sx = 0, sz = 0;
    for (let i = 0; i < N; i++) {
      this.animator.update(i ? dur / N : 0, this.body); this.root.updateMatrixWorld(true);
      const l = this.bones.leftArm.getWorldPosition(new THREE.Vector3()), r = this.bones.rightArm.getWorldPosition(new THREE.Vector3());
      const d = l.sub(r), face = new THREE.Vector3(-d.z, 0, d.x).normalize();
      if (face.dot(fw) < 0) face.negate();
      sx += face.x; sz += face.z;
    }
    return Math.atan2(sx * fw.z - sz * fw.x, sx * fw.x + sz * fw.z);
  };

  // facing direction on the ground
  mv.Guard.prototype.forward = function (out) { return (out || new THREE.Vector3()).set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); };

  // eye position: the head bone, nudged forward to the face
  mv.Guard.prototype.eye = function (out) {
    out = out || new THREE.Vector3();
    if (this.head) this.head.getWorldPosition(out); else out.copy(this.position).setY(1.65);
    out.y += 0.08;
    return out.addScaledVector(this.forward(new THREE.Vector3()), 0.1);
  };

  // target: what the guard can look at (see mv.visionTarget)
  mv.Guard.prototype.update = function (dt, target) {
    if (this.hearing) this.hearing.update(dt);
    this._locomotion(dt, target);
    this.place();
    this.animator.update(dt, this.motor);
    // the idle stance is squared to his facing; walking clips already face forward
    this.pivot.rotation.y = this.pivotYaw - this.squareYaw * this.animator.weights.idle;
    this.root.updateMatrixWorld(true);
    if (target) this.vision.update(dt, target);
    if (this.awareness) this.awareness.update(dt, target);
  };
})(SC.mv);
