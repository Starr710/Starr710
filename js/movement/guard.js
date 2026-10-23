// SHADOW CELL — guards (docs/GAME_DESIGN.md §3–4).
// A guard is its own character type, not a copy of the player controller: no
// input, camera or HUD. It reuses the player's loaded model as a lightweight
// skinned copy (geometry, textures and animation clips are shared; only the
// skeleton, the animation mixer and a tinted uniform material are per guard).
// Stage: stationary, playing the idle clip, with eyes (guard-vision.js). Later
// stages give it a brain that drives a motor + animator like the player's.
(function (mv) {
  'use strict';

  mv.GuardDefaults = {
    uniform: 0x5f84d8,   // multiplies the soldier's texture: a slate-blue uniform, unlike the player's tan
    radius: 0.32,        // m, collision (the player can't walk through a guard)
    height: 1.8,
    vision: 'regular',   // vision profile (mv.VisionDefaults.profiles)
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

  // playerVisual: the loaded mv.CharacterVisual whose model and clips are shared
  mv.Guard = function (scene, world, playerVisual, opts) {
    const o = this.cfg = Object.assign({}, mv.GuardDefaults, opts || {});
    this.world = world;
    this.position = new THREE.Vector3(o.x || 0, 0, o.z || 0);
    this.yaw = o.yaw || 0;                       // facing; 0 = +Z (as the player motor)
    this.root = new THREE.Group();
    const pivot = new THREE.Group(); pivot.rotation.y = playerVisual.profile.forwardYaw || 0;
    this.model = mv.cloneSkinned(playerVisual.model);
    this.model.traverse(n => {
      if (n.isMesh) { n.castShadow = true; n.frustumCulled = false; n.material = Array.isArray(n.material) ? n.material.map(m => uniformMaterial(m, o.uniform)) : uniformMaterial(n.material, o.uniform); }
      if (n.isBone) { if (/head$/i.test(n.name)) this.head = n; }
    });
    pivot.add(this.model); this.root.add(pivot); scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.mixer.clipAction(playerVisual.clips.idle).play();
    this.body = world.addCylinder(this.position.x, this.position.z, o.radius, o.height, null, { noSight: true });
    this.vision = new mv.GuardVision(this, o.vision);
    this.place();
  };

  mv.Guard.prototype.place = function () {
    this.root.position.copy(this.position); this.root.rotation.y = this.yaw;
    this.body.x = this.position.x; this.body.z = this.position.z;
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
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    if (target) this.vision.update(dt, target);
  };
})(SC.mv);
