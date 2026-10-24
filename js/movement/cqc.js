// SHADOW CELL — CQC grab and restraint (Step 13). TAP CQC near a guard to grab him; while
// she holds him the button reads RELEASE. HOLD CQC is reserved for a future quick takedown
// and does nothing yet.
// The grab works on any guard whatever his awareness or facing (unaware, patrolling,
// suspicious, investigating, startled, fully alert, searching), from the front, side or
// rear. It only needs him within `range`, nothing solid between them (a sight line at
// chest height) and the player free to act. While she holds him the pair is one unit:
// she stands behind him, both facing the same way, `holdOffset` apart. The joystick moves
// them slowly (a separate grapple mode, not a normal movement speed): the pair turns toward
// the stick and steps forward, or backs up when the stick points behind. Both bodies are
// kept out of walls. The guard's own locomotion and patrol are suspended (guard.restraint);
// his awareness keeps its memory and knows he's in contact with an intruder, so he's ALERT
// and stays so; he makes no sound. RELEASE pushes him a step away and hands him back to his
// own AI, still alert to her.
// Future actions hook in here (state GRAPPLING): knockout, chokehold, quick takedown, and
// resistance / breaking free (which may make alert or trained guards harder to hold, but
// never prevent the initial grab).
(function (mv) {
  'use strict';

  mv.CQCDefaults = {
    range: 1.45,           // m between the two centres within which a grab can start
    reachHeight: 1.1,      // m: the contact sight line (chest height) that solid cover blocks
    holdTime: 0.45,        // s: a press longer than this is a HOLD (reserved), shorter a TAP
    grabTime: 0.4,         // s to bring both into the restraint position (eased, no snap)
    holdOffset: 0.55,      // m from her centre to his while she holds him (she's behind him)
    moveSpeed: 0.55,       // m/s forward while restraining (cautious)…
    backSpeed: 0.4,        // …and backing up
    accel: 1.6,            // m/s² easing in and out of it
    turnRate: 1.3,         // rad/s the pair turns toward the stick
    releaseTime: 0.35,     // s for the release step…
    releasePush: 0.5,      // …moving him this much farther away from her
    arms: { shoulder: 48, elbow: 55 },   // ° her arms come up and bend to hold him (procedural)
  };

  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

  // player: { motor, visual, input }, guard: mv.Guard, world: the collision world
  mv.CQC = function (player, guard, world, opts) {
    this.cfg = Object.assign({}, mv.CQCDefaults, opts || {});
    this.motor = player.motor; this.visual = player.visual; this.input = player.input;
    this.guard = guard; this.world = world;
    this.reset();
  };

  mv.CQC.prototype.reset = function () {
    this.state = 'FREE';       // FREE | GRABBING | GRAPPLING | RELEASING
    this.t = 0; this.from = null; this.speed = 0; this.grabs = 0; this.releases = 0;
    this.lastTry = ''; this.holdNote = ''; this.armW = 0; this._armBase = new Map();
  };
  mv.CQC.prototype.active = function () { return this.state !== 'FREE'; };

  // can she grab him right now? ('' = yes, otherwise why not)
  mv.CQC.prototype.check = function () {
    const c = this.cfg, g = this.guard, m = this.motor;
    if (this.state !== 'FREE') return 'busy';
    if (!g || g.restraint) return 'no guard';
    const d = Math.hypot(g.position.x - m.position.x, g.position.z - m.position.z);
    if (d > c.range) return 'out of reach';
    const a = new THREE.Vector3(m.position.x, c.reachHeight, m.position.z), b = new THREE.Vector3(g.position.x, c.reachHeight, g.position.z);
    if (this.world.segmentBlocked(a, b)) return 'something solid in the way';
    return '';
  };

  // TAP: grab, or release while holding
  mv.CQC.prototype.tap = function () {
    if (this.state === 'GRAPPLING') { this.release(); return 'release'; }
    if (this.state !== 'FREE') return 'busy';
    const why = this.check(); this.lastTry = why || 'grabbed';
    if (why) return why;
    this._grab(); return 'grab';
  };
  // HOLD: a future quick takedown; reserved, nothing happens
  mv.CQC.prototype.hold = function () { this.holdNote = 'hold: quick takedown not available yet'; return 'reserved'; };

  mv.CQC.prototype._grab = function () {
    const g = this.guard, m = this.motor, c = this.cfg;
    // she takes him from wherever she is: the pair faces from her toward him
    const yaw = Math.atan2(g.position.x - m.position.x, g.position.z - m.position.z);
    this.from = { p: m.position.clone(), py: m.yaw, g: g.position.clone(), gy: g.yaw, yaw };
    this.yaw = yaw; this.state = 'GRABBING'; this.t = 0; this.speed = 0; this.grabs++;
    if (this.input.crouch) this.input.setCrouch(false);
    m.stance = 'stand';
    g.restraint = { by: m, since: g.awareness ? g.awareness.clock : 0 };
    g.stopMoving();
    if (g.awareness && g.awareness.onRestrained) g.awareness.onRestrained(m.position);
  };

  mv.CQC.prototype.release = function () {
    if (this.state !== 'GRAPPLING') return;
    const g = this.guard;
    this.state = 'RELEASING'; this.t = 0; this.releases++;
    this.from = { g: g.position.clone() };
  };

  // immediate end (RESET): both are left where they are, the guard back to his AI
  mv.CQC.prototype.cancel = function () {
    if (this.guard) { this.guard.restraint = null; this.guard.stopMoving(); }
    this.state = 'FREE'; this.speed = 0; this.motor.speed = 0; this.motor.targetSpeed = 0; this.motor.angularVelocity = 0;
  };

  // keep a body out of solid things (the guard's own collider moved aside)
  mv.CQC.prototype._resolve = function (x, z, r) {
    const g = this.guard, col = g.collider, cx = col.x; col.x = 1e6;
    const out = this.world.resolve(x, z, r, {});
    col.x = cx; return out;
  };

  // place the pair: her at p facing yaw, him holdOffset ahead; both kept clear of walls
  mv.CQC.prototype._place = function (px, pz, yaw, offset) {
    const c = this.cfg, g = this.guard, m = this.motor, fx = Math.sin(yaw), fz = Math.cos(yaw);
    let gx = px + fx * offset, gz = pz + fz * offset;
    for (let i = 0; i < 3; i++) {
      const gr = this._resolve(gx, gz, g.cfg.radius); px += gr.x - gx; pz += gr.z - gz; gx = gr.x; gz = gr.z;
      const pr = this._resolve(px, pz, m.cfg.radius); gx += pr.x - px; gz += pr.z - pz; px = pr.x; pz = pr.z;
    }
    m.position.x = px; m.position.z = pz; m.yaw = yaw;
    g.position.x = gx; g.position.z = gz; g.yaw = yaw; g.wantYaw = yaw;
    g.place();
  };

  // per frame, before the player's motor would run. stick: world direction (dx, dz) and
  // push 0…1. Returns true while CQC drives both characters (the normal motor stays off)
  mv.CQC.prototype.update = function (dt, dx, dz, mag) {
    const c = this.cfg, m = this.motor, g = this.guard, inp = this.input;
    // button events from the input layer
    if (inp.cqcTapped) { inp.cqcTapped = false; this.tap(); }
    if (inp.cqcHeld) { inp.cqcHeld = false; this.hold(); }
    this.armW += ((this.state === 'GRABBING' || this.state === 'GRAPPLING' ? 1 : 0) - this.armW) * (1 - Math.exp(-8 * dt));
    if (this.state === 'FREE') return false;
    if (this.state === 'GRABBING') {
      this.t += dt; const k = ease(this.t / c.grabTime), f = this.from;
      // she stays about where she was (a small step in), he's drawn back against her and turned with her
      const target = new THREE.Vector3(f.g.x - Math.sin(f.yaw) * c.holdOffset, 0, f.g.z - Math.cos(f.yaw) * c.holdOffset);
      const px = f.p.x + (target.x - f.p.x) * k * 0.5, pz = f.p.z + (target.z - f.p.z) * k * 0.5;
      const pyaw = f.py + wrap(f.yaw - f.py) * k, gyaw = f.gy + wrap(f.yaw - f.gy) * k;
      const gx = f.g.x + (px + Math.sin(f.yaw) * c.holdOffset - f.g.x) * k, gz = f.g.z + (pz + Math.cos(f.yaw) * c.holdOffset - f.g.z) * k;
      m.position.x = px; m.position.z = pz; m.yaw = pyaw; m.speed = 0; m.targetSpeed = 0; m.angularVelocity = 0;
      g.position.x = gx; g.position.z = gz; g.yaw = gyaw; g.wantYaw = gyaw; g.place();
      if (this.t >= c.grabTime) { this.state = 'GRAPPLING'; this._place(m.position.x, m.position.z, f.yaw, c.holdOffset); }
      this._setGuardMotion(0, 0);
      return true;
    }
    if (this.state === 'GRAPPLING') {
      // turn toward the stick; step forward, or back up when it points behind
      let want = 0, turn = 0;
      if (mag > 0.15) {
        const diff = wrap(Math.atan2(dx, dz) - m.yaw);
        if (Math.abs(diff) > 2.2) want = -c.backSpeed * mag;                 // pulling back: back up, no turn
        else { turn = Math.max(-c.turnRate * dt, Math.min(c.turnRate * dt, diff)); want = c.moveSpeed * mag * Math.max(0, Math.cos(diff)); }
      }
      this.speed += Math.max(-c.accel * dt, Math.min(c.accel * dt, want - this.speed));
      if (Math.abs(this.speed) < 0.005 && want === 0) this.speed = 0;
      const yaw = wrap(m.yaw + turn), ox = m.position.x, oz = m.position.z;
      this._place(ox + Math.sin(yaw) * this.speed * dt, oz + Math.cos(yaw) * this.speed * dt, yaw, c.holdOffset);
      const moved = Math.hypot(m.position.x - ox, m.position.z - oz) / Math.max(dt, 1e-6);
      // the animators read the motors: walking forward plays the walk, backing up stays in place
      m.speed = this.speed > 0 ? Math.min(this.speed, moved) : 0; m.targetSpeed = this.speed > 0.02 ? m.speed : 0; m.angularVelocity = turn / Math.max(dt, 1e-6);
      this._setGuardMotion(m.speed, m.angularVelocity);
      return true;
    }
    if (this.state === 'RELEASING') {
      this.t += dt; const k = ease(this.t / c.releaseTime), f = this.from, yaw = m.yaw;
      const want = new THREE.Vector3(f.g.x + Math.sin(yaw) * c.releasePush * k, 0, f.g.z + Math.cos(yaw) * c.releasePush * k);
      const r = this._resolve(want.x, want.z, g.cfg.radius); g.position.x = r.x; g.position.z = r.z; g.place();
      m.speed = 0; m.targetSpeed = 0; m.angularVelocity = 0; this._setGuardMotion(0, 0);
      if (this.t >= c.releaseTime) {
        g.restraint = null; g.stopMoving(); g.wantYaw = g.yaw;
        if (g.awareness && g.awareness.onReleased) g.awareness.onReleased(m.position);
        this.state = 'FREE';
      }
      return true;
    }
    return false;
  };

  mv.CQC.prototype._setGuardMotion = function (speed, av) {
    const gm = this.guard.motor; gm.speed = speed; gm.targetSpeed = speed > 0.02 ? speed : 0; gm.angularVelocity = av; gm.accel = 0;
  };

  // after her animator and posture layer: her arms come up and forward to hold him
  const _ax = new THREE.Vector3(), _pq = new THREE.Quaternion(), _dq = new THREE.Quaternion();
  mv.CQC.prototype.poseArms = function () {
    const B = this.visual.bones, w = this.armW, D = Math.PI / 180, m = this.motor;
    if (w < 0.001 && !this._armBase.size) return;
    const right = new THREE.Vector3(Math.cos(m.yaw), 0, -Math.sin(m.yaw));
    const a = this.cfg.arms, list = [[B.leftArm, -a.shoulder], [B.rightArm, -a.shoulder], [B.leftForeArm, -a.elbow], [B.rightForeArm, -a.elbow]];
    for (const [bone, deg] of list) {
      if (!bone) continue;
      const kept = this._armBase.get(bone);
      if (kept && bone.quaternion.equals(kept.written)) bone.quaternion.copy(kept.base);   // not re-posed this frame
      const base = bone.quaternion.clone();
      if (w > 0.001) {
        bone.parent.getWorldQuaternion(_pq).invert();
        bone.quaternion.premultiply(_dq.setFromAxisAngle(_ax.copy(right).applyQuaternion(_pq), deg * D * w));
        bone.updateMatrixWorld(true);
        this._armBase.set(bone, { base, written: bone.quaternion.clone() });
      } else this._armBase.delete(bone);
    }
  };

  // short status for the developer view
  mv.CQC.prototype.status = function () {
    if (this.state === 'FREE') { const why = this.check(); return `FREE · ${why ? 'no grab: ' + why : 'CQC available'}${this.holdNote ? ' · ' + this.holdNote : ''}`; }
    return `${this.state === 'GRAPPLING' ? 'GRAPPLING · guard RESTRAINED' : this.state}${this.state === 'GRAPPLING' ? ' · ' + this.speed.toFixed(2) + ' m/s' : ''}`;
  };
})(SC.mv);
