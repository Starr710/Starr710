// SHADOW CELL — movement: tactical upper-body posture layer.
// Runs after the animation mixer each frame. The mocap clips keep the gait
// rhythm and foot placement; this layer reshapes the body into a stealth carry:
//   0. stealth legs: hips lowered (knees bent) and steps shortened at sneaking
//      pace, with two-bone leg IK holding each foot where the clip placed it
//      (pulled in by the animator's stride scale, so feet stay planted)
//   1. torso leans forward with speed (more at a jog, most in a sprint)
//   2. the clip's shoulder twist is damped so the chest stays square to travel
//   3. the head is steadied, level and looking ahead
//   4. arms follow the active CARRY profile:
//      - unarmed (default): compact, bent-elbow arms close to the body with a
//        reduced version of the clip's own arm swing, hands loosely closed
//      - rifle: a carbine at LOW READY, PORT ARMS when sprinting, on a lag
//        spring; two-bone IK puts the hands on grip and handguard
//      Pistol, knife and other carries are added as further profiles.
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
    lean: [[0, 0.08], [0.4, 0.38], [0.8, 0.38], [1.15, 0.15], [1.6, 0.14], [2.2, 0.16], [3.2, 0.2], [5.6, 0.3]],
    hipDrop: [[0, 0.015], [0.4, 0.065], [0.8, 0.065], [1.15, 0.02], [1.6, 0.018], [2.4, 0.012], [3.4, 0.006], [5.0, 0]],
    levelHips: [[0, 0], [0.4, 0.9], [0.8, 0.9], [1.15, 0.45], [1.6, 0.4], [2.4, 0.25], [3.4, 0]],   // share of hip bob removed
    ankleLock: 0.7,
    idleSquare: 1,                     // 0 = keep the idle clip's turned stance, 1 = face forward                    // 1 = foot keeps the clip's world angle, 0 = follows the shin
    pelvisTilt: [[0, 0.04], [0.4, 0.2], [0.8, 0.2], [1.15, 0.07], [1.6, 0.06], [2.4, 0.05], [3.4, 0.03], [5.0, 0]],   // rad, chest-forward
    hipsBack: 0.35,                    // pelvis shifts back by this × drop, keeping weight over the feet
    leanShare: [0.4, 0.3, 0.3],       // spine, spine1, chest
    twistDamp: 0.7,                   // 0 = clip twist, 1 = chest locked to travel direction
    headSteady: 0.65,
    headPitch: 0.04,                  // eyes slightly down the line of travel
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

  // Unarmed arm targets (wrist position in the yaw frame, relative to the chest),
  // by gait, and how much of the clip's own arm swing survives.
  const UNARMED = {
    idle: { r: [-0.21, -0.42, 0.1], l: [0.21, -0.42, 0.1], keep: 0.55 },
    sneak: { r: [-0.17, -0.2, 0.22], l: [0.17, -0.2, 0.22], keep: 0.1 },   // hands drawn up near the chest, barely swinging
    walk: { r: [-0.21, -0.34, 0.15], l: [0.21, -0.34, 0.15], keep: 0.42 },  // ready but relaxed, some swing
    jog: { r: [-0.21, -0.26, 0.15], l: [0.21, -0.26, 0.15], keep: 0.4 },
    sprint: { r: [-0.22, -0.24, 0.1], l: [0.22, -0.24, 0.1], keep: 0.75 },
  };
  mv.CARRY_MODES = ['unarmed', 'rifle'];

  mv.TacticalPosture = function (visual, opts) {
    this.v = visual;
    this.cfg = Object.assign({}, mv.PostureDefaults, opts || {});
    const b = visual.bones;
    const need = ['spine', 'chest', 'head', 'leftArm', 'leftForeArm', 'leftHand', 'rightArm', 'rightForeArm', 'rightHand'];
    for (const k of need) if (!b[k]) throw new Error('Tactical posture needs a "' + k + '" bone');
    this.weapon = buildCarbine();
    visual.root.add(this.weapon);
    this.setCarry(this.cfg.carry || 'unarmed');
    this.wPos = null; this.wVel = V(); this.wQuat = Q();
    this.t = { a: V(), b: V(), c: V(), d: V(), e: V(), q: Q(), q2: Q(), m: new THREE.Matrix4(), m2: new THREE.Matrix4() };
    this._calibrated = false;
  };

  mv.TacticalPosture.prototype.setCarry = function (mode) {
    this.carry = mv.CARRY_MODES.indexOf(mode) >= 0 ? mode : 'unarmed';
    this.weapon.visible = this.carry === 'rifle';
    this.wPos = null;
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

  // Two-bone IK with a true hinge: the middle joint (knee/elbow) only bends about
  // its own hinge axis, so the limb never twists along its length; the upper
  // bone then aims the chain at the target and swivels the joint toward the pole.
  function twoBoneIK(upper, lower, end, target, pole, t, swivel) {
    const a = wpos(upper, V()), bp = wpos(lower, V()), c = wpos(end, V());
    const l1 = bp.distanceTo(a), l2 = c.distanceTo(bp);
    // soft IK: ease into full extension instead of snapping straight at max reach
    const L = l1 + l2, soft = 0.05 * L, d0 = L - soft;
    let dist = Math.max(target.distanceTo(a), Math.abs(l1 - l2) + 1e-3);
    if (dist > d0) dist = d0 + soft * (1 - Math.exp(-(dist - d0) / soft));
    dist = Math.min(dist, L * 0.9995);
    // 1. bend: set the interior angle at the hinge from the law of cosines
    const ba = a.clone().sub(bp), bc = c.clone().sub(bp);
    const cur = ba.angleTo(bc);
    const want = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2))));
    // hinge axis: from the current bend, but near a straight limb that cross
    // product is noisy, so blend toward the axis implied by the pole
    const ab = bp.clone().sub(a);
    const nBend = ab.clone().cross(bc), nPole = ab.clone().cross(pole);
    if (nPole.lengthSq() > 1e-10) nPole.normalize();
    let n;
    if (nBend.lengthSq() > 1e-10) {
      nBend.normalize();
      if (nPole.lengthSq() > 0.5 && nPole.dot(nBend) < 0) nPole.negate();
      const wb = Math.min(1, Math.max(0, (Math.PI - cur - 0.12) / 0.35));   // 0 when nearly straight
      n = nPole.lengthSq() > 0.5 ? nPole.multiplyScalar(1 - wb).add(nBend.multiplyScalar(wb)) : nBend;
    } else n = nPole;
    if (n.lengthSq() > 1e-10) rotateWorld(lower, new THREE.Quaternion().setFromAxisAngle(n.normalize(), cur - want), t);
    // 2. aim the whole chain at the target
    const c2 = wpos(end, V());
    rotateWorld(upper, new THREE.Quaternion().setFromUnitVectors(c2.sub(a).normalize(), target.clone().sub(a).normalize()), t);
    // 3. swivel about the shoulder/hip → target line so the joint points toward the pole
    if (swivel > 0) {
      const axis = target.clone().sub(a).normalize();
      const k = wpos(lower, V()).sub(a); k.sub(axis.clone().multiplyScalar(k.dot(axis)));
      const pp = pole.clone().sub(axis.clone().multiplyScalar(pole.dot(axis)));
      if (k.lengthSq() > 1e-8 && pp.lengthSq() > 1e-8) {
        let ang = k.angleTo(pp);
        if (k.clone().cross(pp).dot(axis) < 0) ang = -ang;
        rotateWorld(upper, new THREE.Quaternion().setFromAxisAngle(axis, ang * swivel), t);
      }
    }
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
  mv.TacticalPosture.prototype.update = function (dt, motor, animator) {
    const v = this.v, b = v.bones, root = v.root, c = this.cfg, t = this.t;
    root.updateMatrixWorld(true);
    if (!this._calibrated) this._calibrate();
    const s = Math.max(0, motor.speed);
    const rootQ = root.getWorldQuaternion(Q());
    const up = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ);
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);

    // -1. square up the idle stance: turn hips + legs to face forward, and turn the
    // spine back by the same amount so the shoulders stay where the clip had them
    if (animator && animator.idleYaw && b.hips) {
      const k = animator.weights.idle * this.cfg.idleSquare;
      if (k > 1e-3) {
        const q = new THREE.Quaternion().setFromAxisAngle(up, -animator.idleYaw * k);
        rotateWorld(b.hips, q, t);
        rotateWorld(b.spine, q.clone().invert(), t);
      }
    }

    // 0. stealth legs
    this._legs(dt, s, animator ? animator.strideScale : 1, fwd, left, up, animator);
    this._idleFeet(animator, up);

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

    const walkF = smooth(0.1, 1.0, s), sprintF = smooth(4.4, 5.4, s);
    if (this.carry === 'unarmed') this._unarmed(dt, s, walkF, sprintF, fwd, left, up);
    else this._rifle(dt, walkF, sprintF, fwd, left, up);
  };

  mv.TacticalPosture.prototype._legs = function (dt, s, stride, fwd, left, up, animator) {
    const b = this.v.bones, t = this.t;
    if (!b.leftUpLeg || !b.leftLeg || !b.rightUpLeg || !b.rightLeg) return;
    const want = mv.table(this.cfg.hipDrop, s);
    this.drop = this.drop == null ? want : this.drop + (want - this.drop) * (1 - Math.exp(-6 * dt));
    const hips = b.hips, H = wpos(hips, V());
    // sneaking keeps the body level: flatten the clip's vertical hip bob toward
    // its running average (this also removes a knee hitch under the lowered stance)
    this.hipsMean = this.hipsMean == null ? H.y : this.hipsMean + (H.y - this.hipsMean) * (1 - Math.exp(-2 * dt));
    H.y += (this.hipsMean - H.y) * mv.table(this.cfg.levelHips, s);
    // where the clip put each foot, pulled toward the hips along travel for shorter steps
    const feet = ['left', 'right'].map(side => {
      const foot = b[side + 'Foot'], p = wpos(foot, V()), q = foot.getWorldQuaternion(Q());
      const along = p.clone().sub(H).dot(fwd);
      p.addScaledVector(fwd, -along * (1 - stride));
      return { side, foot, p, q };
    });
    // settle step after a stop: the planted foot stays locked to the ground and the
    // other foot lifts a little and steps into the idle stance, instead of both
    // feet sliding while the pose blends
    const settling = animator && animator.state === 'stopped' && animator.settle < 1;
    if (settling) {
      if (!this.lock && this.lastFeet) {
        const along = this.lastFeet.map(p => Math.abs(p.clone().sub(H).dot(fwd)));
        this.lock = { pos: this.lastFeet.map(p => p.clone()), mover: along[0] > along[1] ? 0 : 1 };
      }
      if (this.lock) {
        const u = animator.settle;
        feet.forEach((f, i) => {
          const L = this.lock.pos[i];
          if (i === this.lock.mover) {
            const w = smooth(0.05, 0.85, u);
            f.p.lerpVectors(L, f.p, w).addScaledVector(up, 0.06 * Math.sin(Math.PI * w));
          } else f.p.lerpVectors(L, f.p, smooth(0.8, 1, u));
        });
      }
    } else this.lock = null;
    this.lastFeet = feet.map(f => f.p.clone());

    // lower the pelvis (and ease it back) in world space, then tip it forward
    H.addScaledVector(up, -this.drop).addScaledVector(fwd, -this.drop * this.cfg.hipsBack);
    hips.position.copy(hips.parent.worldToLocal(H));
    hips.updateMatrixWorld(true);
    rotateWorld(hips, new THREE.Quaternion().setFromAxisAngle(left, mv.table(this.cfg.pelvisTilt, s)), t);
    for (const f of feet) {
      const out = f.side === 'left' ? left.clone() : left.clone().negate();
      const pole = fwd.clone().add(out.multiplyScalar(0.15));
      twoBoneIK(b[f.side + 'UpLeg'], b[f.side + 'Leg'], f.foot, f.p, pole, t, 0.25);
      // mostly keep the clip's foot angle (flat contact) but let the ankle follow
      // the shin a little, so the joint never folds sharply
      const kept = f.foot.getWorldQuaternion(Q()).slerp(f.q, this.cfg.ankleLock);
      setWorldQuat(f.foot, kept, t);
    }
  };

  // after the leg IK: turn each foot about the vertical so the idle toe-out matches the walk
  mv.TacticalPosture.prototype._idleFeet = function (animator, up) {
    const b = this.v.bones, t = this.t;
    if (!animator || !animator.idleFootYaw) return;
    const k = animator.weights.idle * this.cfg.idleSquare;
    if (k < 1e-3) return;
    ['left', 'right'].forEach((side, i) => {
      const f = b[side + 'Foot'];
      if (f && animator.idleFootYaw[i]) rotateWorld(f, new THREE.Quaternion().setFromAxisAngle(up, animator.idleFootYaw[i] * k), t);
    });
  };

  mv.TacticalPosture.prototype._unarmed = function (dt, s, walkF, sprintF, fwd, left, up) {
    const v = this.v, b = v.bones, root = v.root, t = this.t;
    const jogF = smooth(1.8, 3.0, s);
    const U = UNARMED;
    // idle → sneak (≤0.8 m/s) → stealth walk (≥1.15 m/s) → jog → sprint
    const toWalk = smooth(0.8, 1.15, s);
    const mixArr = side => U.idle[side].map((x, i) => lerp(lerp(lerp(x, lerp(U.sneak[side][i], U.walk[side][i], toWalk), walkF), U.jog[side][i], jogF), U.sprint[side][i], sprintF));
    const keep = lerp(lerp(lerp(U.idle.keep, lerp(U.sneak.keep, U.walk.keep, toWalk), walkF), U.jog.keep, jogF), U.sprint.keep, sprintF);
    const chestL = root.worldToLocal(wpos(b.chest, V()));
    const right = left.clone().negate();
    const rPole = right.clone().multiplyScalar(0.5).add(up.clone().multiplyScalar(-0.6)).add(fwd.clone().multiplyScalar(-1));
    const lPole = left.clone().multiplyScalar(0.5).add(up.clone().multiplyScalar(-0.6)).add(fwd.clone().multiplyScalar(-1));
    for (const [side, pole] of [['right', rPole], ['left', lPole]]) {
      const hand = b[side + 'Hand'];
      // where the clip put the wrist, in the yaw frame relative to the chest
      const clipRel = root.worldToLocal(wpos(hand, V())).sub(chestL);
      const goal = new THREE.Vector3().fromArray(mixArr(side === 'right' ? 'r' : 'l'));
      const rel = goal.lerp(clipRel, keep);
      const target = root.localToWorld(chestL.clone().add(rel));
      twoBoneIK(b[side + 'Arm'], b[side + 'ForeArm'], hand, target, pole, t, 0.6);
      curlFingers(hand, this.hands[side], [0.45, 0.55, 0.4], t);
    }
  };

  mv.TacticalPosture.prototype._rifle = function (dt, walkF, sprintF, fwd, left, up) {
    const v = this.v, b = v.bones, root = v.root, c = this.cfg, t = this.t;
    // 4. weapon carry pose in the yaw frame, anchored to the chest, on a spring
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
    twoBoneIK(b.rightArm, b.rightForeArm, b.rightHand, rWrist, rPole, t, 1);
    twoBoneIK(b.leftArm, b.leftForeArm, b.leftHand, lWrist, lPole, t, 1);
    const H = this.hands;
    orientHand(b.rightHand, H.right, wy.clone().multiplyScalar(-0.85).add(wz.clone().multiplyScalar(0.45)).normalize(), wx.clone(), t);
    orientHand(b.leftHand, H.left, wx.clone().multiplyScalar(-0.85).add(wz.clone().multiplyScalar(0.3)).add(wy.clone().multiplyScalar(0.15)).normalize(), wy.clone(), t);
    curlFingers(b.rightHand, H.right, c.gripCurl, t);
    curlFingers(b.leftHand, H.left, c.supportCurl, t);
  };
})(SC.mv);
