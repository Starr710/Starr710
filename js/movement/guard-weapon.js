// SHADOW CELL — guard weapon readiness and aiming (Step 21). AIMING ONLY: nothing fires.
// Each guard carries one placeholder pistol (holstered at his hip). How ready it is lives
// apart from his awareness (ALERT means he's confirmed danger, not that his weapon is up):
//   LOWERED    holstered / down: normal duty, suspicion, an investigation of an ordinary sound
//   DRAWING    bringing it up (the raise k climbs over drawTime)
//   AIMING     up, pointed at what he legitimately has, but not lined up / not able to act
//   READY      up, lined up on a target he can see, and free to act (startle over, no hit
//              reaction): what Step 22's shooting will check (canFire)
//   LOWERING   putting it away (awareness settled, restrained, back to his post)
// When it comes up: once he's confirmed her (ALERT, and EVASION / HEIGHTENED while he
// searches), or when there's evidence of a gunfight without a sighting (he heard a gunshot
// or was hit: SUSPICIOUS / INVESTIGATING), until his awareness settles (NORMAL, RETURNING).
// Ordinary suspicious sounds never bring it up.
// Where it points (the target), only from what he legitimately has:
//   visual         she's in sight now (guard-vision.js): her observed chest, tracked
//   last seen      out of sight: the last place he saw her (awareness memory), never where
//                  she's gone since
//   search         searching: where he's looking (his own facing)
//   sound estimate a gunshot / being hit without a sighting: the sound's (estimated) origin
// The aim turns toward it at a limited rate (no snapping, no perfect tracking).
// Startle (Step 12): the draw starts with ALERT but can't come fully up while he's
// recovering (offenseReady); it finishes as the recovery ends. No second timer.
// Interrupted by: being grabbed (lowered at once, nothing tracked while held), a hit (the
// reaction knocks the aim and holds READY back), going down (unconscious, defeated: put
// away, nothing tracked).
(function (mv) {
  'use strict';

  mv.GuardWeaponDefaults = {
    drawTime: 0.7,         // s to bring the pistol from the holster to the aim
    lowerTime: 0.9,        // s to put it away
    grabbedTime: 0.2,      // s it takes to be knocked down when he's grabbed
    recoveringMax: 0.45,   // how far up it can come while he's still startled
    trackRate: 2.2,        // rad/s the aim can turn (smoothed)
    trackSmoothing: 10,
    readyAngle: 6,         // ° from the target within which it's lined up
    yawMax: 65, pitchMax: 45,   // ° the arms and upper body can aim away from where his body faces
    reach: 0.42, drop: -0.04, side: 0.04,   // where the pistol is held (as the player's: aim-pose.js)
    spineShare: [0.15, 0.35, 0.5], pitchShare: [0.1, 0.3, 0.4],
    lowReady: -25,         // ° pitch while searching with nothing to aim at (cautious, not at anyone)
    sweepPitch: -10,       // ° while walking a search
    chest: 1.15,           // m: the height aimed at when only a spot on the ground is known
    hitDip: 0.5,           // share of the raise a hit reaction knocks out (at its peak)
  };
  const D = Math.PI / 180, wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const UP = new THREE.Vector3(0, 1, 0);
  const RAISED = ['ALERT', 'EVASION', 'HEIGHTENED'], SETTLED = ['NORMAL', 'RETURNING'];

  // guard: mv.Guard; scene; posture: the player's TacticalPosture (the same rig: its hand calibration applies)
  mv.GuardWeapon = function (guard, scene, posture, opts) {
    this.g = guard; this.cfg = Object.assign({}, mv.GuardWeaponDefaults, opts || {});
    this.hands = posture && posture.hands ? posture.hands : null;
    this.pc = posture ? posture.cfg : null;
    const build = mv.AimPose && mv.AimPose.buildPistol;
    this.gun = build(); this.gun.name = 'guard-pistol'; scene.add(this.gun);
    this.holster = build(); this.holster.name = 'guard-pistol-holstered'; this.holster.visible = true;
    this._muzzle = new THREE.Vector3(0, 0.034, 0.17);
    this._fingers = null; this.t = { q: new THREE.Quaternion(), q2: new THREE.Quaternion(), m: new THREE.Matrix4(), m2: new THREE.Matrix4() };
    this.aimDir = guard.forward(new THREE.Vector3()); this.want = this.aimDir.clone();
    this.target = { type: 'none', point: null, visible: false };
    this.reset();
  };

  mv.GuardWeapon.prototype.reset = function () {
    this.state = 'LOWERED'; this.k = 0; this.why = 'on duty'; this.draws = 0; this.lowers = 0; this.gunshot = null;
    this.target.type = 'none'; this.target.point = null; this.target.visible = false; this.aligned = false; this.err = Infinity;
    if (this.g) { this.g.forward(this.aimDir); this.want.copy(this.aimDir); }
    this.gun.visible = false; this.holster.visible = true;
  };

  // the holster at his right hip, set up once from his current pose (then it rides on his hips bone)
  mv.GuardWeapon.prototype._fitHolster = function () {
    const g = this.g, hips = g.bones.hips; if (!hips || this._holstered) return;
    g.root.updateMatrixWorld(true);
    const f = g.forward(new THREE.Vector3()), r = new THREE.Vector3(f.z, 0, -f.x);
    const p = hips.getWorldPosition(new THREE.Vector3()).addScaledVector(r, 0.21).addScaledVector(UP, -0.1).addScaledVector(f, 0.0);
    const z = UP.clone().negate(), y = f.clone().negate(), x = y.clone().cross(z);   // barrel down, grip forward-up
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    hips.add(this.holster); this.holster.position.copy(hips.worldToLocal(p));
    this.holster.quaternion.copy(hips.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
    const ws = hips.getWorldScale(new THREE.Vector3()); this.holster.scale.set(1 / ws.x, 1 / ws.y, 1 / ws.z);   // (the rig's bones are scaled: keep the pistol its real size)
    this._holstered = true;
  };
  mv.GuardWeapon.prototype._fingersOf = function (side) {
    if (!this.hands) return [];
    this._fingers = this._fingers || {};
    if (!this._fingers[side]) this._fingers[side] = this.hands[side].fingers.map(f => ({ bone: this.g.model.getObjectByName(f.bone.name), finger: f.finger, seg: f.seg })).filter(f => f.bone);
    return this._fingers[side];
  };

  // ---------------------------------------------------------------- deciding (after his awareness, each frame)
  mv.GuardWeapon.prototype.decide = function (dt) {
    const c = this.cfg, g = this.g, a = g.awareness, v = g.vision, T = this.target;
    this._fitHolster();
    // the evidence of a gunfight without a sighting: a gunshot he heard (kept while his awareness stays up)
    const h = g.hearing && g.hearing.heard;
    if (h && h.type === 'gunshot' && (!this.gunshot || this.gunshot.time !== h.time)) this.gunshot = { time: h.time, at: a ? a.clock : 0 };
    if (a && SETTLED.indexOf(a.state) >= 0) this.gunshot = null;
    const shot = a && a.attack && a.attack.kind === 'shot' && SETTLED.indexOf(a.state) < 0;
    // should it be up?
    let up = false, why = '';
    if (g.restraint) { why = 'grabbed'; }
    else if (!a) why = 'no awareness';
    else if (RAISED.indexOf(a.state) >= 0) { up = true; why = a.state === 'ALERT' ? 'intruder confirmed' : a.state === 'EVASION' ? 'searching for her' : 'heightened security'; }
    else if ((this.gunshot || shot) && (a.state === 'SUSPICIOUS' || a.state === 'INVESTIGATING')) { up = true; why = shot ? 'he was shot' : 'heard a gunshot'; }
    else why = a.state === 'RETURNING' ? 'threat passed: back to post' : a.state === 'NORMAL' ? 'on duty' : 'only a suspicion';
    // what it points at
    const seen = v && v.seen, visible = !!(a && a.confirmed && seen && seen.rate > 0 && seen.position);
    T.visible = visible;
    if (!up) { T.type = 'none'; T.point = null; }
    else if (visible) { T.type = 'visual'; T.point = (T.point || new THREE.Vector3()).copy(seen.centre || seen.position.clone().setY(c.chest)); }
    else if (a.confirmed && a.state === 'ALERT' && a.seen) { T.type = 'last seen'; T.point = (T.point || new THREE.Vector3()).copy(a.seen.position).setY(c.chest); }
    else if (a.confirmed) { T.type = 'search'; T.point = null; }
    else {
      const est = a.heard && (a.heard.estimate || a.heard.position), at = shot ? a.attack.position : est;
      T.type = 'sound estimate'; T.point = at ? (T.point || new THREE.Vector3()).copy(at).setY(c.chest) : null;
    }
    // the raise: up toward 1 (held lower while he's startled), down when it's not wanted
    const startled = a && a.isStartled && a.isStartled(), grabbed = !!g.restraint;
    const top = up ? (startled ? c.recoveringMax : 1) : 0;
    const rate = grabbed ? 1 / c.grabbedTime : top > this.k ? 1 / c.drawTime : 1 / c.lowerTime;
    const was = this.k;
    this.k = top > this.k ? Math.min(top, this.k + rate * dt) : Math.max(top, this.k - rate * dt);
    if (this.k > 0 && was === 0) this.draws++;
    if (this.k === 0 && was > 0) this.lowers++;
    // where it points: toward the target, at a limited rate
    const f = g.forward(new THREE.Vector3()), eye = g.eye ? g.eye(new THREE.Vector3()) : g.position.clone().setY(1.6);
    const chest = g.bones.chest ? g.bones.chest.getWorldPosition(new THREE.Vector3()) : eye;
    if (T.point) this.want.copy(T.point).sub(chest).normalize();
    else this.want.set(f.x, Math.sin((a && a.state === 'HEIGHTENED' ? c.lowReady : c.sweepPitch) * D), f.z).normalize();
    if (!up) this.want.set(f.x, Math.sin(c.lowReady * D), f.z).normalize();
    // limited to what his arms and upper body can reach from where his body faces
    const yaw = Math.atan2(this.want.x, this.want.z), rel = Math.max(-c.yawMax * D, Math.min(c.yawMax * D, wrap(yaw - g.yaw))), el = Math.max(-c.pitchMax * D, Math.min(c.pitchMax * D, Math.asin(Math.max(-1, Math.min(1, this.want.y)))));
    const ty = g.yaw + rel, lim = new THREE.Vector3(Math.sin(ty) * Math.cos(el), Math.sin(el), Math.cos(ty) * Math.cos(el));
    const ang = this.aimDir.angleTo(lim), step = Math.min(ang, c.trackRate * dt, ang * (1 - Math.exp(-c.trackSmoothing * dt)) + 1e-4);
    if (ang > 1e-6) { const ax = this.aimDir.clone().cross(lim); if (ax.lengthSq() > 1e-10) this.aimDir.applyAxisAngle(ax.normalize(), Math.min(step, ang)); else this.aimDir.copy(lim); }
    this.err = T.point ? this.aimDir.angleTo(this.want) / D : Infinity;
    this.aligned = this.err <= c.readyAngle;
    // the state
    const react = g.health && g.health.reactPhase && g.health.reactPhase !== 'none';
    if (this.k === 0) this.state = 'LOWERED';
    else if (this.k < top - 1e-6 || (top === 0 && this.k > 0)) this.state = top > this.k ? 'DRAWING' : 'LOWERING';
    else if (startled && top < 1) this.state = 'DRAWING';
    else this.state = visible && this.aligned && !react && !startled ? 'READY' : 'AIMING';
    this.why = startled && up ? why + ' (startled: recovering)' : react && up ? why + ' (hit: knocked off aim)' : why;
  };

  // down (unconscious, defeated): put away at once, nothing tracked
  mv.GuardWeapon.prototype.stow = function (why) {
    this._fitHolster();
    if (this.k > 0) this.lowers++;
    this.k = 0; this.state = 'LOWERED'; this.why = why; this.target.type = 'none'; this.target.point = null; this.target.visible = false; this.aligned = false;
    this.gun.visible = false; this.holster.visible = true;
  };

  // ---------------------------------------------------------------- the pose (after his own pose and body language)
  const _pq = new THREE.Quaternion();
  mv.GuardWeapon.prototype.pose = function () {
    const g = this.g, c = this.cfg, B = g.bones, K = mv.PostureKit;
    const dip = g.health && g.health.reactions && g.health.reactions.length ? c.hitDip * Math.min(1, g.health.reactions.reduce((s, r) => s + Math.max(0, 1 - r.t / 0.5), 0)) : 0;
    const k = ease(this.k) * (1 - dip);
    this.kPose = k;
    if (k < 0.002 || !K || !B.rightArm || !B.leftArm) { this.gun.visible = false; this.holster.visible = true; this._rel = null; return; }
    const t = this.t, wp = (b, o) => b.getWorldPosition(o);
    const f = g.forward(new THREE.Vector3()), right = new THREE.Vector3(f.z, 0, -f.x);
    const ad = this.aimDir, ayaw = Math.atan2(ad.x, ad.z), rel = wrap(ayaw - g.yaw), el = Math.asin(Math.max(-1, Math.min(1, ad.y)));
    // the upper body turns and pitches partway with the aim
    const spine = [B.spine, B.spine1, B.chest];
    spine.forEach((b, i) => { if (b) K.rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(UP, rel * c.spineShare[i] * k), t); });
    const fa = new THREE.Vector3(Math.sin(ayaw), 0, Math.cos(ayaw)), pax = fa.clone().cross(UP).normalize();
    spine.forEach((b, i) => { if (b) K.rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(pax, el * c.pitchShare[i] * k), t); });
    // where the pistol is held, pointed along the aim
    const sh = wp(B.leftArm, new THREE.Vector3()).add(wp(B.rightArm, new THREE.Vector3())).multiplyScalar(0.5);
    const ra = new THREE.Vector3(fa.z, 0, -fa.x);
    const G = sh.addScaledVector(ad, c.reach).addScaledVector(UP, -c.drop).addScaledVector(ra, c.side);
    const gd = ad.clone().normalize(), gy = UP.clone().sub(gd.clone().multiplyScalar(UP.dot(gd))).normalize(), gx = gy.clone().cross(gd);
    const gq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(gx, gy, gd));
    // arms onto it (full), blended with his own pose by k
    const H = this.hands, fingers = H ? [...this._fingersOf('right'), ...this._fingersOf('left')].map(x => x.bone) : [];
    const all = [B.rightArm, B.rightForeArm, B.rightHand, B.leftArm, B.leftForeArm, B.leftHand, ...fingers].filter(Boolean), base = all.map(b => b.quaternion.clone());
    const rW = G.clone().addScaledVector(gy, -0.055).addScaledVector(gd, -0.06).addScaledVector(gx, 0.005);
    const lW = G.clone().addScaledVector(gy, -0.075).addScaledVector(gd, -0.035).addScaledVector(gx, -0.055);
    K.twoBoneIK(B.rightArm, B.rightForeArm, B.rightHand, rW, right.clone().multiplyScalar(0.7).addScaledVector(UP, -1), t, 1);
    K.twoBoneIK(B.leftArm, B.leftForeArm, B.leftHand, lW, right.clone().multiplyScalar(-0.7).addScaledVector(UP, -1), t, 1);
    if (H) {
      K.orientHand(B.rightHand, H.right, gd.clone().multiplyScalar(0.55).addScaledVector(gy, 0.35).addScaledVector(gx, -0.25).normalize(), gx.clone().negate(), t);
      K.orientHand(B.leftHand, H.left, gd.clone().multiplyScalar(0.5).addScaledVector(gx, 0.55).addScaledVector(gy, 0.2).normalize(), gx.clone().add(gy.clone().multiplyScalar(0.4)).normalize(), t);
      if (this.pc) { K.curlFingers(B.rightHand, { F: H.right.F, N: H.right.N, fingers: this._fingersOf('right') }, this.pc.gripCurl, t); K.curlFingers(B.leftHand, { F: H.left.F, N: H.left.N, fingers: this._fingersOf('left') }, this.pc.supportCurl, t); }
    }
    const hq = B.rightHand.getWorldQuaternion(new THREE.Quaternion()), hp = wp(B.rightHand, new THREE.Vector3());
    this._rel = { q: hq.clone().invert().multiply(gq), p: G.clone().sub(hp).applyQuaternion(hq.clone().invert()) };
    if (k < 0.999) { all.forEach((b, i) => b.quaternion.copy(base[i].slerp(b.quaternion, k))); B.rightArm.updateMatrixWorld(true); B.leftArm.updateMatrixWorld(true); }
  };
  // the pistol in his right hand (after any hit reaction has moved his upper body), or in the holster
  mv.GuardWeapon.prototype.attach = function () {
    const g = this.g, R = this._rel, show = !!R && this.kPose > 0.15;
    this.gun.visible = show; this.holster.visible = !show;
    if (!show) return;
    const hq = g.bones.rightHand.getWorldQuaternion(_pq), hp = g.bones.rightHand.getWorldPosition(new THREE.Vector3());
    this.gun.quaternion.copy(hq).multiply(R.q); this.gun.position.copy(R.p.clone().applyQuaternion(hq).add(hp)); this.gun.updateMatrixWorld(true);
  };

  // ---------------------------------------------------------------- for Step 22 (nothing fires yet)
  // could he fire right now? { ok, why, ready, free, target, visible, dir, muzzle, blocked, offense }
  mv.GuardWeapon.prototype.muzzle = function (out) { return this.gun.visible ? (out || new THREE.Vector3()).copy(this._muzzle).applyMatrix4(this.gun.matrixWorld) : null; };
  mv.GuardWeapon.prototype.canFire = function () {
    const g = this.g, a = g.awareness, T = this.target;
    const free = !(g.isDown && g.isDown()) && !g.restraint, offense = !!(a && a.offenseReady && a.offenseReady()), react = !!(g.health && g.health.reactPhase !== 'none');
    const m = this.muzzle(), blocked = !!(m && T.point && g.world.segmentBlocked(m, T.point));
    const out = { ready: this.state === 'READY', free, target: T.type, visible: T.visible, dir: this.aimDir.clone(), muzzle: m, blocked, offense: offense && !react, err: this.err };
    out.why = !free ? (g.restraint ? 'restrained' : 'down') : !out.ready ? this.state.toLowerCase() : !T.visible ? 'no visible target' : blocked ? 'line blocked' : !out.offense ? (react ? 'hit reaction' : 'startled') : '';
    out.ok = !out.why;
    return out;
  };

  // short status for the developer view (empty while it's simply holstered on duty)
  mv.GuardWeapon.prototype.status = function () {
    if (this.state === 'LOWERED' && (this.why === 'on duty' || this.why === 'grabbed')) return '';
    const T = this.target, xz = p => p ? `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})` : '–', deg = Math.round(Math.atan2(this.aimDir.x, this.aimDir.z) / D);
    return `WPN ${this.state}${this.state === 'DRAWING' || this.state === 'LOWERING' ? ' ' + Math.round(this.k * 100) + '%' : ''} → ${T.type}${T.point ? ' ' + xz(T.point) : ''} ${deg}°${T.visible ? ' (sees her)' : ''} · ${this.canFire().ok ? 'offense OK' : 'no offense'} · ${this.why}`;
  };
})(SC.mv);
