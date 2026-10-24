// SHADOW CELL — CQC grab and restraint (Step 13). TAP CQC near a guard to grab him; while
// she holds him the button reads RELEASE. HOLD CQC is reserved for a future quick takedown
// and does nothing yet.
// The grab works on any guard whatever his awareness or facing (unaware, patrolling,
// suspicious, investigating, startled, fully alert, searching), from the front, side or
// rear. It only needs him within `range`, nothing solid between them (a sight line at
// chest height) and the player free to act. While she holds him the pair is one unit:
// she stands behind him, both facing the same way, `holdOffset` apart. The joystick moves
// them in a separate grapple mode (not a normal movement speed), MGSV-style (Step 13.1): the
// stick is the direction of travel; the pair pivots about its centre until she faces away
// from it and pulls him backward that way, both stepping backward. Travel follows the stick
// at once, eased; any direction works, and a reversal turns the pair round. Both bodies are
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
    // Step 13.1 restraint movement (MGSV-style): the stick is the direction of travel; the
    // pair turns so she faces away from it and pulls him backward that way
    pullSpeed: 1.0,        // m/s at a full push (slower and more deliberate than walking)…
    fullPushAt: 0.7,       // …reached at this much stick push (partial pushes scale down)…
    deadZone: 0.06,        // …below this the stick is ignored
    accel: 3.0,            // m/s² speeding up…
    decel: 4.0,            // …and slowing down
    turnRate: 2.4,         // rad/s the pair can pivot (about its centre)…
    turnStiffness: 5,      // …chasing the wanted facing with this gain…
    turnSmoothing: 10,     // …smoothed (1/s)
    steerMinSpeed: 0.5,    // share of speed kept while the pair still faces the wrong way (a reversal)
    travelTurnRate: 4.5,   // rad/s the travel direction swings toward the stick (a reversal is a short U-turn, never a stop)
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
    this.yaw = yaw; this.state = 'GRABBING'; this.t = 0; this.speed = 0; this.grabs++; this.vel = null; this.av = 0; this.dir = null;
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
    this.motor.reverseGait = false; if (this.guard) this.guard.motor.reverseGait = false; this.vel = null; this.av = 0; this.dir = null;
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
      // Step 13.1: the stick is the travel direction (camera-relative, as always). The pair
      // pivots about its centre until she faces away from it, and she pulls him backward
      // that way. Travel follows the stick at once (a little less while still turning round)
      const v = this.vel || (this.vel = new THREE.Vector2(0, 0));
      const push = mag > c.deadZone ? Math.min(1, (mag - c.deadZone) / (c.fullPushAt - c.deadZone)) : 0;
      let wantYaw = m.yaw, tvx = 0, tvz = 0;
      if (push > 0) {
        const tl = Math.hypot(dx, dz) || 1, ux = dx / tl, uz = dz / tl;          // travel direction (unit)
        wantYaw = Math.atan2(-ux, -uz);                                          // she faces away from it
        const err = Math.abs(wrap(wantYaw - m.yaw));
        const keep = Math.max(c.steerMinSpeed, Math.sqrt(Math.max(0, Math.cos(err / 2))));
        tvx = ux * c.pullSpeed * push * keep; tvz = uz * c.pullSpeed * push * keep;
      }
      // pivot (rate-limited, smoothed)
      const diff = wrap(wantYaw - m.yaw), wantAv = push > 0 ? Math.max(-c.turnRate, Math.min(c.turnRate, diff * c.turnStiffness)) : 0;
      this.av = (this.av || 0) + (wantAv - (this.av || 0)) * (1 - Math.exp(-c.turnSmoothing * dt));
      // travel: the speed eases up and down; the direction swings toward the stick at a set rate
      // (so changing direction, even reversing, keeps moving: a short arc rather than a stop)
      const tSpd = Math.hypot(tvx, tvz); let spd = Math.hypot(v.x, v.y), dir = this.dir != null ? this.dir : m.yaw + Math.PI;
      const fromRest = spd < 0.05;                                               // setting off: straight toward the stick
      spd += Math.max(-c.decel * dt, Math.min(c.accel * dt, tSpd - spd));
      if (tSpd > 0) { const want = Math.atan2(tvx, tvz); dir = fromRest ? want : dir + Math.max(-c.travelTurnRate * dt, Math.min(c.travelTurnRate * dt, wrap(want - dir))); }
      if (push === 0 && spd < 0.01) spd = 0;
      this.dir = wrap(dir); v.set(Math.sin(this.dir) * spd, Math.cos(this.dir) * spd);
      // move: pivot about the pair's centre, then travel; both bodies kept out of walls
      const yaw = wrap(m.yaw + this.av * dt), half = c.holdOffset / 2;
      const cx = m.position.x + Math.sin(m.yaw) * half, cz = m.position.z + Math.cos(m.yaw) * half;
      const ox = m.position.x, oz = m.position.z;
      this._place(cx - Math.sin(yaw) * half + v.x * dt, cz - Math.cos(yaw) * half + v.y * dt, yaw, c.holdOffset);
      // the animators read the motors: the pair's travel speed (the pivot shows as stepping round
      // on the spot), stepping backward while she pulls him (gait run in reverse)
      const sp = Math.hypot(v.x, v.y); this.speed = sp;
      const back = v.x * Math.sin(yaw) + v.y * Math.cos(yaw) <= 0;
      m.speed = sp > 0.03 ? sp : 0; m.targetSpeed = push > 0 && sp > 0.03 ? sp : 0; m.angularVelocity = this.av; m.reverseGait = back;
      this._setGuardMotion(m.speed, this.av, back, m.targetSpeed);
      return true;
    }
    if (this.state === 'RELEASING') {
      this.t += dt; const k = ease(this.t / c.releaseTime), f = this.from, yaw = m.yaw;
      const want = new THREE.Vector3(f.g.x + Math.sin(yaw) * c.releasePush * k, 0, f.g.z + Math.cos(yaw) * c.releasePush * k);
      const r = this._resolve(want.x, want.z, g.cfg.radius); g.position.x = r.x; g.position.z = r.z; g.place();
      m.speed = 0; m.targetSpeed = 0; m.angularVelocity = 0; m.reverseGait = false; this._setGuardMotion(0, 0);
      if (this.t >= c.releaseTime) {
        g.restraint = null; g.stopMoving(); g.wantYaw = g.yaw;
        if (g.awareness && g.awareness.onReleased) g.awareness.onReleased(m.position);
        this.state = 'FREE';
      }
      return true;
    }
    return false;
  };

  mv.CQC.prototype._setGuardMotion = function (speed, av, back, target) {
    const gm = this.guard.motor; gm.speed = speed; gm.targetSpeed = target != null ? target : (speed > 0.02 ? speed : 0); gm.angularVelocity = av; gm.accel = 0; gm.reverseGait = !!back;
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
