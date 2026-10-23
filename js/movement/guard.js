// SHADOW CELL — guards (docs/GAME_DESIGN.md §3–4).
// A guard is its own character type, not a copy of the player controller: no
// input, camera or HUD. It reuses the player's loaded model as a lightweight
// skinned copy (geometry, textures and animation clips are shared; only the
// skeleton, the animation mixer and a tinted uniform material are per guard).
// Stage: stationary with eyes (guard-vision.js) and ears (guard-hearing.js). It
// can turn on the spot: a turn-only body drives the player's own animation
// controller, which turns the spin into small in-place steps exactly as it does
// for the player. Later stages give it a brain that drives a full motor.
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
    this.position = new THREE.Vector3(o.x || 0, 0, o.z || 0);
    this.yaw = o.yaw || 0;                       // facing; 0 = +Z (as the player motor)
    this.postYaw = this.yaw;                     // the facing of his assigned post
    this.wantYaw = this.yaw;                     // where he's turning to
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
    this.animator = new mv.AnimationController(this.visual);
    this.body = { speed: 0, targetSpeed: 0, accel: 0, angularVelocity: 0, stance: 'stand', stopDistance: 0, gait: mv.GAITS[0] };
    if (o.squareShoulders) this.pivot.rotation.y -= this.shoulderOffset();
    this.collider = world.addCylinder(this.position.x, this.position.z, o.radius, o.height, null, { noSight: true });
    this.vision = new mv.GuardVision(this, o.vision);
    this.hearing = noise && mv.GuardHearing ? new mv.GuardHearing(this, noise, o.hearing) : null;
    this.place();
  };

  mv.Guard.prototype.place = function () {
    this.root.position.copy(this.position); this.root.rotation.y = this.yaw;
    if (this.collider) { this.collider.x = this.position.x; this.collider.z = this.position.z; }
  };

  // turn (on the spot) to face a world point, or back to the post facing
  mv.Guard.prototype.faceToward = function (p) { this.wantYaw = Math.atan2(p.x - this.position.x, p.z - this.position.z); };
  mv.Guard.prototype.faceYaw = function (yaw) { this.wantYaw = yaw; };

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
    this._turn(dt);
    this.place();
    this.animator.update(dt, this.body);
    this.root.updateMatrixWorld(true);
    if (target) this.vision.update(dt, target);
  };
})(SC.mv);
