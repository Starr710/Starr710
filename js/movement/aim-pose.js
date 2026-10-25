// SHADOW CELL — the aiming pose (Step 18), TEMPORARY presentation for the stand-in rig: over
// the animated pose (after the posture layer and the CQC arms), weighted by the aim blend k
// (the camera's aimK, so the pose and the view ease in and out together):
//   - the upper body turns back onto the aim while the legs follow the travel (aim.legYaw)
//     and pitches partway with it; the head follows the aim
//   - both arms come up onto a placeholder pistol held out in front of the chest, pointed at
//     the aim point (right hand on the grip, left hand cupping it)
// The pistol is a placeholder (no shooting, no ammunition): two boxes, shown only while
// aiming. muzzle() is where a future shot would leave it.
(function (mv) {
  'use strict';

  mv.AimPoseDefaults = {
    reach: 0.44,           // m the pistol is held out in front of the shoulders…
    drop: -0.06,           // …this far below shoulder height (negative: above)…
    side: 0.04,            // …and this far toward her right
    spineShare: [0.15, 0.35, 0.5],   // how the turn onto the aim splits over spine / spine1 / chest
    pitchShare: [0.1, 0.3, 0.4],     // and how much of the aim's up/down each of them takes
    pitchMax: 60,          // ° the upper body follows the aim up or down at most
    head: 0.8,             // share of the remaining aim the head takes
    showAt: 0.3,           // the pistol appears once the blend is past this
    near: 1.0,             // m: a target closer than this is aimed at along the view instead
  };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  function buildPistol() {
    const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.55, metalness: 0.35 });
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.036, 0.2), mat); slide.position.set(0, 0.034, 0.065);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.105, 0.046), mat); grip.position.set(0, -0.022, -0.012); grip.rotation.x = -0.25;
    for (const m of [slide, grip]) { m.castShadow = true; g.add(m); }
    g.name = 'aim-pistol-placeholder'; g.visible = false;
    return g;
  }

  mv.AimPose = function (visual, posture, scene, opts) {
    this.v = visual; this.posture = posture; this.cfg = Object.assign({}, mv.AimPoseDefaults, opts || {});
    this.pistol = buildPistol(); scene.add(this.pistol);
    this.k = 0; this.t = { q: Q(), q2: Q(), m: new THREE.Matrix4(), m2: new THREE.Matrix4() };
    this._muzzle = new THREE.Vector3(0, 0.034, 0.17);
    this.gunDir = new THREE.Vector3(0, 0, 1);
    this.kick = 0;   // Step 19: recoil 0…1 (pistol.js), easing back to 0
  };

  // per frame, after the posture layer and cqc.poseArms. k: aim blend 0…1; yaw: the aim's
  // facing (motor.yaw); dir: the aim direction (unit, the camera's); point: the aim point (or null)
  mv.AimPose.prototype.apply = function (k, yaw, dir, point) {
    this.k = k;
    const P = this.pistol;
    if (k < 0.002 || !this.posture || !this.posture.hands) { P.visible = false; return; }
    const c = this.cfg, b = this.v.bones, t = this.t, K = mv.PostureKit, wp = (bone, out) => bone.getWorldPosition(out);
    // 1. the upper body back onto the aim (measured off the shoulder line, which stays level)
    const spine = [b.spine, b.spine1, b.chest];
    const sl = wp(b.leftArm, V()).sub(wp(b.rightArm, V())); sl.y = 0;
    const f0 = sl.clone().cross(UP);
    const turn = wrap(yaw - Math.atan2(f0.x, f0.z));
    spine.forEach((bone, i) => { if (bone) K.rotateWorld(bone, Q().setFromAxisAngle(UP, turn * c.spineShare[i] * k), t); });
    // 2. pitch partway with the aim
    const fx = Math.sin(yaw), fz = Math.cos(yaw), f = new THREE.Vector3(fx, 0, fz), axis = f.clone().cross(UP).normalize();
    const lim = c.pitchMax * Math.PI / 180, el = Math.max(-lim, Math.min(lim, Math.asin(Math.max(-1, Math.min(1, dir.y)))));
    spine.forEach((bone, i) => { if (bone) K.rotateWorld(bone, Q().setFromAxisAngle(axis, el * c.pitchShare[i] * k), t); });
    // 3. the head follows the aim
    const ph = this.posture.headFwd;
    if (ph && b.head) {
      const hf = ph.clone().applyQuaternion(b.head.getWorldQuaternion(Q())).normalize();
      K.rotateWorld(b.head, Q().slerp(Q().setFromUnitVectors(hf, dir.clone().normalize()), c.head * k), t);
    }
    // 4. where the pistol is held (full pose): out in front of the shoulders, pointed at the aim point
    const right = new THREE.Vector3(fz, 0, -fx);
    const sh = wp(b.leftArm, V()).add(wp(b.rightArm, V())).multiplyScalar(0.5);
    const aimF = new THREE.Vector3(fx * Math.cos(el), Math.sin(el), fz * Math.cos(el));
    const G = sh.clone().addScaledVector(aimF, c.reach).addScaledVector(UP, -c.drop).addScaledVector(right, c.side);
    const gd = point && point.distanceTo(G) > c.near ? point.clone().sub(G).normalize() : dir.clone().normalize();
    this.gunDir.copy(gd);
    // Step 19 recoil: the pistol kicks back and its muzzle climbs, the arms following it (the shot itself already left)
    const kk = this.kick || 0, pc0 = mv.PistolDefaults;
    if (kk > 0 && pc0) { G.addScaledVector(gd, -pc0.kickBack * kk); const ax = gd.clone().cross(UP); if (ax.lengthSq() > 1e-8) gd.applyAxisAngle(ax.normalize(), pc0.kickClimb * Math.PI / 180 * kk); }
    const gy = UP.clone().sub(gd.clone().multiplyScalar(UP.dot(gd))).normalize(), gx = gy.clone().cross(gd);
    const gq = Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(gx, gy, gd));
    // 5. arms onto it (full), then blended with the pose underneath by k
    const arm = [b.rightArm, b.rightForeArm, b.rightHand, b.leftArm, b.leftForeArm, b.leftHand];
    const H = this.posture.hands, fingers = [...H.right.fingers, ...H.left.fingers].map(x => x.bone);
    const all = arm.concat(fingers), base = all.map(bone => bone.quaternion.clone());
    const rWrist = G.clone().addScaledVector(gy, -0.055).addScaledVector(gd, -0.06).addScaledVector(gx, 0.005);
    const lWrist = G.clone().addScaledVector(gy, -0.075).addScaledVector(gd, -0.035).addScaledVector(gx, -0.055);
    const rPole = right.clone().multiplyScalar(0.7).addScaledVector(UP, -1), lPole = right.clone().multiplyScalar(-0.7).addScaledVector(UP, -1);
    K.twoBoneIK(b.rightArm, b.rightForeArm, b.rightHand, rWrist, rPole, t, 1);
    K.twoBoneIK(b.leftArm, b.leftForeArm, b.leftHand, lWrist, lPole, t, 1);
    K.orientHand(b.rightHand, H.right, gd.clone().multiplyScalar(0.55).addScaledVector(gy, 0.35).addScaledVector(gx, -0.25).normalize(), gx.clone().negate(), t);
    K.orientHand(b.leftHand, H.left, gd.clone().multiplyScalar(0.5).addScaledVector(gx, 0.55).addScaledVector(gy, 0.2).normalize(), gx.clone().add(gy.clone().multiplyScalar(0.4)).normalize(), t);
    const pc = this.posture.cfg;
    K.curlFingers(b.rightHand, H.right, pc.gripCurl, t);
    K.curlFingers(b.leftHand, H.left, pc.supportCurl, t);
    // the pistol rides in the right hand: its offset from the hand in the full pose…
    const hq = b.rightHand.getWorldQuaternion(Q()), hp = wp(b.rightHand, V());
    const relQ = hq.clone().invert().multiply(gq), relP = G.clone().sub(hp).applyQuaternion(hq.clone().invert());
    if (k < 0.999) {
      all.forEach((bone, i) => bone.quaternion.copy(base[i].slerp(bone.quaternion, k)));
      b.rightArm.updateMatrixWorld(true); b.leftArm.updateMatrixWorld(true);
    }
    // …kept as the hand moves
    const hq2 = b.rightHand.getWorldQuaternion(Q()), hp2 = wp(b.rightHand, V());
    P.quaternion.copy(hq2).multiply(relQ); P.position.copy(relP.applyQuaternion(hq2).add(hp2));
    P.visible = k > c.showAt; P.updateMatrixWorld(true);
  };

  // where a future shot would leave the pistol (world), or null while it isn't out
  mv.AimPose.prototype.muzzle = function (out) {
    if (!this.pistol.visible) return null;
    return (out || new THREE.Vector3()).copy(this._muzzle).applyMatrix4(this.pistol.matrixWorld);
  };
})(SC.mv);
