// SHADOW CELL — movement: tactical upper-body posture layer.
// Runs after the animation mixer each frame. The mocap clips keep full control
// of the legs, hips and gait rhythm; this layer reshapes only the upper body
// into a tactical carry:
//   1. torso leans forward with speed (more at a jog, most in a sprint)
//   2. the clip's shoulder twist is damped so the chest stays square to travel
//   3. the head is steadied, level and looking ahead
//   4. a carbine is carried at LOW READY while walking/jogging and moves to a
//      PORT-ARMS carry (diagonal across the chest) when sprinting; it lags the
//      chest slightly on a spring so it has weight
//   5. both arms reach the weapon with two-bone IK; hands orient to the grip and
//      handguard and the fingers close around them
// Everything is computed from canonical bones, so any humanoid rig works.
(function (mv) {
  'use strict';

  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();

  // exact critically damped spring step (stable at any frame rate)
  mv.springStep = function (pos, vel, target, w, dt) {
    const e = Math.exp(-w * dt);
    for (const k of ['x', 'y', 'z']) {
      const x = pos[k] - target[k], tmp = (vel[k] + w * x) * dt;
      vel[k] = (vel[k] - w * tmp) * e;
      pos[k] = target[k] + (x + tmp) * e;
    }
  };

  mv.PostureDefaults = {
    // forward lean (rad) by ground speed (m/s)
    lean: [[0, 0.07], [1.5, 0.13], [3.2, 0.2], [5.6, 0.3]],
    leanShare: [0.4, 0.3, 0.3],       // spine, spine1, chest
    twistDamp: 0.7,                   // 0 = clip twist, 1 = chest locked to travel direction
    headSteady: 0.65,
    headPitch: 0.08,                  // eyes slightly down the line of travel
    weaponStiffness: 55,              // carbine follow spring (higher = less lag)
    gripCurl: [0.95, 1.05, 0.75],
    supportCurl: [0.7, 0.8, 0.6],
  };

  // Carry poses in the character's yaw frame (x = left, y = up, z = forward),
  // relative to the chest bone: grip point offset + muzzle direction + up hint.
  const POSES = {
    idle: { grip: [-0.15, -0.26, 0.2], dir: [0.16, -0.5, 1], up: [0.1, 1, 0.3] },
    lowReady: { grip: [-0.15, -0.23, 0.22], dir: [0.14, -0.42, 1], up: [0.08, 1, 0.3] },
    port: { grip: [-0.1, -0.2, 0.2], dir: [0.8, 0.62, 0.36], up: [-0.35, 0.45, 0.9] },
  };

  function buildCarbine() {
    // side profiles (z forward, y up) in metres, extruded to 4–5 cm thickness
    const parts = [
      { pts: [[-0.36, -0.1], [-0.08, -0.02], [-0.08, 0.05], [-0.36, 0.035]], w: 0.042 },          // stock
      { pts: [[-0.08, -0.02], [0.2, -0.02], [0.2, 0.07], [-0.08, 0.07]], w: 0.05 },                // receiver
      { pts: [[-0.035, -0.02], [0.02, -0.02], [-0.01, -0.13], [-0.055, -0.125]], w: 0.034 },       // pistol grip
      { pts: [[0.075, -0.02], [0.125, -0.02], [0.14, -0.18], [0.09, -0.185]], w: 0.03 },           // magazine
      { pts: [[0.2, -0.012], [0.44, -0.008], [0.44, 0.058], [0.2, 0.062]], w: 0.052 },             // handguard
      { pts: [[0.44, 0.015], [0.62, 0.018], [0.62, 0.034], [0.44, 0.037]], w: 0.022 },             // barrel
      { pts: [[-0.02, 0.07], [0.12, 0.07], [0.12, 0.1], [-0.02, 0.1]], w: 0.03 },                  // sight rail
    ];
    const geos = parts.map(p => {
      const sh = new THREE.Shape(p.pts.map(([z, y]) => new THREE.Vector2(z, y)));
      const g = new THREE.ExtrudeGeometry(sh, { depth: p.w, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
      g.translate(0, 0, -p.w / 2);
      g.rotateY(-Math.PI / 2);         // shape x → +Z (forward), extrusion → X (thickness)
      return g.toNonIndexed();
    });
    let n = 0; geos.forEach(g => { n += g.attributes.position.count; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    geos.forEach(g => { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.55, metalness: 0.35 }));
    mesh.castShadow = true;
    mesh.name = 'carbine';
    return mesh;
  }

  mv.TacticalPosture = function (visual, opts) {
    this.v = visual;
    this.cfg = Object.assign({}, mv.PostureDefaults, opts || {});
    const b = visual.bones;
    const need = ['spine', 'chest', 'head', 'leftArm', 'leftForeArm', 'leftHand', 'rightArm', 'rightForeArm', 'rightHand'];
    for (const k of need) if (!b[k]) throw new Error('Tactical posture needs a "' + k + '" bone');
    this.weapon = buildCarbine();
    visual.root.add(this.weapon);
    this.wPos = null; this.wVel = V(); this.wQuat = Q();
    this.t = { a: V(), b: V(), c: V(), d: V(), e: V(), q: Q(), q2: Q(), m: new THREE.Matrix4(), m2: new THREE.Matrix4() };
    this._calibrated = false;
  };

  // ---------------------------------------------------------------- helpers
  // rotate a bone by a world-space delta rotation, keeping children attached
  function rotateWorld(bone, qDelta, t) {
    const pq = bone.parent.getWorldQuaternion(t.q2);
    const local = t.q.copy(pq).invert().multiply(qDelta).multiply(pq);
    bone.quaternion.premultiply(local);
    bone.updateMatrixWorld(true);
  }
  function setWorldQuat(bone, qWorld, t) {
    const pq = bone.parent.getWorldQuaternion(t.q2);
    bone.quaternion.copy(pq.invert().multiply(qWorld));
    bone.updateMatrixWorld(true);
  }
  const wpos = (bone, out) => bone.getWorldPosition(out);

  mv.TacticalPosture.prototype._calibrate = function () {
    // per-rig constants measured once from the current pose: which local axis is
    // "forward" for chest and head, and each hand's finger and palm axes
    const v = this.v, b = v.bones, root = v.root;
    root.updateMatrixWorld(true);
    const fwdW = new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(Q()));
    this.chestFwd = fwdW.clone().applyQuaternion(b.chest.getWorldQuaternion(Q()).invert());
    this.headFwd = fwdW.clone().applyQuaternion(b.head.getWorldQuaternion(Q()).invert());
    this.hands = {};
    for (const side of ['left', 'right']) {
      const hand = b[side + 'Hand'], fs = v.fingers[side] || [];
      const pick = name => (fs.find(f => f.finger === name && f.seg === 1) || {}).bone;
      const mid = pick('middle'), idx = pick('index'), pinky = pick('pinky') || pick('ring');
      const hp = wpos(hand, V());
      const F = mid ? wpos(mid, V()).sub(hp).normalize() : wpos(hand, V()).sub(wpos(b[side + 'ForeArm'], V())).normalize();
      const A = idx && pinky ? wpos(idx, V()).sub(wpos(pinky, V())).normalize() : new THREE.Vector3(0, 0, 1);
      const N = side === 'right' ? A.clone().cross(F) : F.clone().cross(A);
      N.sub(F.clone().multiplyScalar(N.dot(F))).normalize();
      const inv = hand.getWorldQuaternion(Q()).invert();
      this.hands[side] = { F: F.applyQuaternion(inv), N: N.applyQuaternion(inv), fingers: fs.slice().sort((p, q) => p.seg - q.seg) };
    }
    this._calibrated = true;
  };

  function twoBoneIK(upper, lower, end, target, pole, t) {
    const a = wpos(upper, t.a), bp = wpos(lower, t.b), c = wpos(end, t.c);
    const l1 = bp.distanceTo(a), l2 = c.distanceTo(bp);
    const dv = t.d.copy(target).sub(a);
    const dist = Math.min(Math.max(dv.length(), 1e-4), (l1 + l2) * 0.999);
    const dir = dv.normalize();
    const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const perp = t.e.copy(pole).sub(dir.clone().multiplyScalar(pole.dot(dir)));
    if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0);
    perp.normalize();
    const elbow = a.clone().add(dir.clone().multiplyScalar(l1 * cosA)).add(perp.multiplyScalar(l1 * sinA));
    rotateWorld(upper, new THREE.Quaternion().setFromUnitVectors(bp.clone().sub(a).normalize(), elbow.sub(a).normalize()), t);
    const b2 = wpos(lower, V()), c2 = wpos(end, V());
    const goal = a.clone().add(dir.multiplyScalar(dist));
    rotateWorld(lower, new THREE.Quaternion().setFromUnitVectors(c2.sub(b2).normalize(), goal.sub(b2).normalize()), t);
  }

  // orient a hand so its finger axis points along Fw and its palm faces Nw
  function orientHand(hand, info, Fw, Nw, t) {
    const Fl = info.F, Nl = info.N;
    const Bl = t.m.makeBasis(Fl, Nl, Fl.clone().cross(Nl));
    const n = Nw.clone().sub(Fw.clone().multiplyScalar(Nw.dot(Fw))).normalize();
    const Bw = t.m2.makeBasis(Fw, n, Fw.clone().cross(n));
    const q = new THREE.Quaternion().setFromRotationMatrix(Bw.multiply(Bl.clone().invert()));
    setWorldQuat(hand, q, t);
  }

  function curlFingers(hand, info, curl, t) {
    const hq = hand.getWorldQuaternion(Q());
    const axis = info.F.clone().cross(info.N).normalize().applyQuaternion(hq);
    for (const f of info.fingers) {
      const amt = (f.finger === 'thumb' ? 0.35 : 1) * curl[f.seg - 1];
      rotateWorld(f.bone, new THREE.Quaternion().setFromAxisAngle(axis, amt), t);
    }
  }

  function poseBasis(p, out) {
    const z = new THREE.Vector3().fromArray(p.dir).normalize();
    const y = new THREE.Vector3().fromArray(p.up);
    y.sub(z.clone().multiplyScalar(y.dot(z))).normalize();
    const x = y.clone().cross(z);
    return out.makeBasis(x, y, z);
  }

  // ---------------------------------------------------------------- per frame
  mv.TacticalPosture.prototype.update = function (dt, motor) {
    const v = this.v, b = v.bones, root = v.root, c = this.cfg, t = this.t;
    root.updateMatrixWorld(true);
    if (!this._calibrated) this._calibrate();
    const s = Math.max(0, motor.speed);
    const rootQ = root.getWorldQuaternion(Q());
    const up = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ);
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);

    // 1. forward lean
    let lean = c.lean[c.lean.length - 1][1];
    for (let i = 1; i < c.lean.length; i++) if (s <= c.lean[i][0]) { const a = c.lean[i - 1], bb = c.lean[i]; lean = lerp(a[1], bb[1], (s - a[0]) / (bb[0] - a[0])); break; }
    [b.spine, b.spine1, b.chest].forEach((bone, i) => { if (bone) rotateWorld(bone, new THREE.Quaternion().setFromAxisAngle(left, lean * c.leanShare[i]), t); });

    // 2. damp shoulder twist: turn the chest back toward the travel direction
    const cf = this.chestFwd.clone().applyQuaternion(b.chest.getWorldQuaternion(Q()));
    let twist = Math.atan2(fwd.x, fwd.z) - Math.atan2(cf.x, cf.z);
    twist = Math.atan2(Math.sin(twist), Math.cos(twist));
    const fix = new THREE.Quaternion().setFromAxisAngle(up, twist * c.twistDamp * 0.5);
    rotateWorld(b.spine1 || b.spine, fix, t);
    rotateWorld(b.chest, fix, t);

    // 3. steady head: blend toward level, looking slightly down the line of travel
    const hf = this.headFwd.clone().applyQuaternion(b.head.getWorldQuaternion(Q()));
    const want = fwd.clone().applyAxisAngle(left, c.headPitch);
    const hq = new THREE.Quaternion().setFromUnitVectors(hf.normalize(), want.normalize());
    rotateWorld(b.head, new THREE.Quaternion().slerp(hq, c.headSteady), t);

    // 4. weapon carry pose in the yaw frame, anchored to the chest, on a spring
    const walkF = smooth(0.1, 1.0, s), sprintF = smooth(4.4, 5.4, s);
    const chestL = root.worldToLocal(wpos(b.chest, V()));
    const P = POSES, mix = (k) => P.idle[k].map((x, i) => lerp(lerp(x, P.lowReady[k][i], walkF), P.port[k][i], sprintF));
    const target = chestL.clone().add(new THREE.Vector3().fromArray(mix('grip')));
    const basis = poseBasis({ dir: mix('dir'), up: mix('up') }, new THREE.Matrix4());
    const tq = new THREE.Quaternion().setFromRotationMatrix(basis);
    if (!this.wPos) { this.wPos = target.clone(); this.wQuat.copy(tq); }
    mv.springStep(this.wPos, this.wVel, target, c.weaponStiffness, dt);
    this.wQuat.slerp(tq, 1 - Math.exp(-18 * dt));
    this.weapon.position.copy(this.wPos);
    this.weapon.quaternion.copy(this.wQuat);
    this.weapon.updateMatrixWorld(true);

    // 5. arms to the weapon: right hand on the grip, left on the handguard
    const W = this.weapon.matrixWorld;
    const wq = this.weapon.getWorldQuaternion(Q());
    const wx = new THREE.Vector3(1, 0, 0).applyQuaternion(wq), wy = new THREE.Vector3(0, 1, 0).applyQuaternion(wq), wz = new THREE.Vector3(0, 0, 1).applyQuaternion(wq);
    const rWrist = new THREE.Vector3(-0.012, -0.02, -0.075).applyMatrix4(W);
    const lWrist = new THREE.Vector3(0.05, -0.07, 0.21).applyMatrix4(W);
    const right = left.clone().negate();
    const rPole = right.clone().multiplyScalar(0.6).add(up.clone().multiplyScalar(-1)).add(fwd.clone().multiplyScalar(-0.35));
    const lPole = left.clone().multiplyScalar(0.35).add(up.clone().multiplyScalar(-1)).add(fwd.clone().multiplyScalar(-0.1));
    twoBoneIK(b.rightArm, b.rightForeArm, b.rightHand, rWrist, rPole, t);
    twoBoneIK(b.leftArm, b.leftForeArm, b.leftHand, lWrist, lPole, t);
    const H = this.hands;
    orientHand(b.rightHand, H.right, wy.clone().multiplyScalar(-0.85).add(wz.clone().multiplyScalar(0.45)).normalize(), wx.clone(), t);
    orientHand(b.leftHand, H.left, wx.clone().multiplyScalar(-0.85).add(wz.clone().multiplyScalar(0.3)).add(wy.clone().multiplyScalar(0.15)).normalize(), wy.clone(), t);
    curlFingers(b.rightHand, H.right, c.gripCurl, t);
    curlFingers(b.leftHand, H.left, c.supportCurl, t);
  };
})(SC.mv);
