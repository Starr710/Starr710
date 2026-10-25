// SHADOW CELL — a guard's consciousness (Step 14): knocked out by a CQC throw, unconscious
// for a while, then back on his feet. Gameplay only; how it looks is throw-anim.js.
//   CONSCIOUS     normal guard
//   THROWN        being thrown (cqc-throw.js moves him); his own AI and senses are off
//   UNCONSCIOUS   on the ground where he landed for `unconsciousTime` s (game time): no
//                 movement, patrol, investigation, search, sight or hearing, no ALERT and no
//                 voice. His memory is kept. Two low colliders along his body stand in for
//                 his standing cylinder (she can walk round him, not through him)
//   WAKING        stirring → sitting up → rising, once there's room to stand where he lies
//   DEAD          Step 20: defeated by gunfire (0 HP, guard-health.js). Terminal until RESET:
//                 he buckles and collapses where he stood (no throw: no lift, no sweep), lies
//                 there, and never wakes. Everything else as UNCONSCIOUS (no AI, senses or
//                 voice; low colliders instead of his standing one). Never both: a guard who's
//                 already down isn't a target, and a defeated one can't be knocked out
// Back on his feet he gets his AI back: his awareness picks up from what he knew when he
// went down (attacked, by an intruder, there) and searches from there; he has no idea
// where she went meanwhile. For later stages: guard.ko.state and guard.ko.body (where he
// lies and which way) are what body discovery will look at.
(function (mv) {
  'use strict';

  mv.KnockoutDefaults = {
    unconsciousTime: 60,   // s on the ground (temporary testing value)
    stirTime: 1.2,         // s: slight movement while still lying down…
    sitTime: 1.0,          // …pushing up to sitting…
    riseTime: 1.3,         // …and to his feet
    retryEvery: 0.5,       // s between checks for room to stand, if there isn't any yet
    standRoom: 0.32,       // m: radius that must be free where he stands up (his standing collider)
    playerRoom: 0.7,       // m: and the player at least this far from that spot
    body: { radius: 0.2, along: 0.42, top: 0.3 },   // lying collision: two short cylinders, at his chest and thighs
    collapseTime: 1.2,     // s for a guard defeated by gunfire to buckle and go down (Step 20)…
    collapseShift: 0.28,   // …his hips ending this far along the way he falls
  };

  mv.GuardKnockout = function (guard, opts) {
    this.guard = guard;
    this.cfg = Object.assign({}, mv.KnockoutDefaults, opts || {});
    this.colliders = [];
    this.knockouts = 0;
    this.reset();
  };

  mv.GuardKnockout.prototype.reset = function () {
    this._removeBody();
    if (this.guard._frozen && mv.ThrowAnim) mv.ThrowAnim.unfreeze(this.guard);
    this.state = 'CONSCIOUS'; this.phase = ''; this.t = 0; this.left = 0; this.body = null; this.standAt = null; this.note = ''; this.retry = 0;
    this.knockouts = 0; this.wokeAt = null; this.collapse = null; this.defeats = 0;
  };

  // is he out of action (thrown, unconscious or getting up)?
  mv.GuardKnockout.prototype.down = function () { return this.state !== 'CONSCIOUS'; };

  // the throw starts: he stops being his own man (cqc-throw.js poses him from here)
  mv.GuardKnockout.prototype.beginThrow = function () {
    const g = this.guard;
    if (this.state === 'DEAD') return;   // (Step 20: never both)
    g.stopMoving(); g.motor.speed = 0; g.motor.targetSpeed = 0; g.motor.angularVelocity = 0; g.motor.reverseGait = false;
    if (mv.ThrowAnim) mv.ThrowAnim.freeze(g);
    this.state = 'THROWN'; this.phase = 'thrown'; this.note = 'being thrown';
    if (g.collider) g.collider.x = 1e6;
  };
  // Step 15: choked out — limp in her arms while she lowers him (the choke poses him; he's
  // knocked out properly once he's on the ground)
  mv.GuardKnockout.prototype.beginLower = function () {
    this.beginThrow(); this.phase = 'lowered'; this.note = 'choked unconscious: being lowered';
  };
  // the throw was called off before he landed (RESET): standing where he is
  mv.GuardKnockout.prototype.abortThrow = function () {
    if (this.state !== 'THROWN') return;
    if (mv.ThrowAnim) mv.ThrowAnim.unfreeze(this.guard);
    this.state = 'CONSCIOUS'; this.phase = ''; this.guard.place();
  };

  // Step 20: 0 HP from gunfire. info { dir: the shot's travel (he falls with it), from, source }
  mv.GuardKnockout.prototype.defeat = function (info) {
    const g = this.guard, c = this.cfg;
    if (this.state === 'DEAD') return;
    if (this.state !== 'CONSCIOUS') return;   // (already down: not a target; never both states)
    g.restraint = null; g.poseHook = null; if (mv.ThrowAnim && mv.ThrowAnim.clearLive) mv.ThrowAnim.clearLive(g);
    g.stopMoving(); g.motor.speed = 0; g.motor.targetSpeed = 0; g.motor.angularVelocity = 0; g.motor.reverseGait = false;
    if (mv.ThrowAnim) mv.ThrowAnim.freeze(g);
    const f = g.forward(new THREE.Vector3()), d = info && info.dir ? info.dir.clone().setY(0) : f.clone().negate();
    const back = d.lengthSq() < 1e-8 || d.normalize().dot(f) <= 0 ? 1 : -1;   // shot from in front: he goes over backward; from behind: forward
    const fall = f.clone().multiplyScalar(-back);   // the way his body goes down (head ends that way)
    this.state = 'DEAD'; this.phase = 'collapsing'; this.t = 0; this.left = Infinity; this.note = 'defeated by gunfire';
    this.collapse = { S: g.position.clone(), back, fall, to: g.position.clone().addScaledVector(fall, c.collapseShift).setY(0), by: info && info.from ? info.from.clone() : null };
    this.defeats = (this.defeats || 0) + 1;
    if (g.collider) g.collider.x = 1e6;
    g.vision.blind(); if (g.hearing) g.hearing.heard = null;
    if (g.awareness && g.awareness.onDefeated) g.awareness.onDefeated(this.collapse.by);
  };

  // he hit the ground: info { position: where his hips landed (ground), along: unit
  // direction from his feet to his head, by: where the attacker was }
  mv.GuardKnockout.prototype.knockOut = function (info) {
    const g = this.guard, c = this.cfg;
    g.restraint = null; g.stopMoving();
    g.motor.position.x = info.position.x; g.motor.position.z = info.position.z;
    this.state = 'UNCONSCIOUS'; this.phase = 'out cold'; this.t = 0; this.left = c.unconsciousTime; this.note = 'knocked out by a throw';
    this.body = { position: new THREE.Vector3(info.position.x, 0, info.position.z), along: info.along.clone().setY(0).normalize(), at: g.awareness ? g.awareness.clock : 0 };
    this.knockouts++;
    if (g.collider) g.collider.x = 1e6;
    this._addBody();
    g.vision.blind();
    if (g.hearing) g.hearing.heard = null;
    if (g.awareness && g.awareness.onKnockedOut) g.awareness.onKnockedOut(info.by);
  };

  // per frame while down (instead of the guard's AI). target: the player (vision target)
  mv.GuardKnockout.prototype.update = function (dt, target) {
    const g = this.guard, c = this.cfg, A = mv.ThrowAnim;
    if (g.awareness) g.awareness.clock += dt;     // his memory's clock keeps time (game time)
    if (g.hearing) g.hearing.update(dt);
    if (this.state === 'THROWN') return;           // the throw poses him
    this.t += dt;
    if (this.state === 'DEAD') { this._deadStep(); return; }   // (Step 20: no timer, no waking)
    if (this.state === 'UNCONSCIOUS') {
      this.left = Math.max(0, this.left - dt);
      if (A) A.lying(g);
      if (this.left <= 0 && (this.retry -= dt) <= 0) {
        const spot = this._standSpot(target);
        if (spot) { this.state = 'WAKING'; this.phase = 'stirring'; this.t = 0; this.standAt = spot; this.note = 'coming round'; }
        else { this.retry = c.retryEvery; this.note = 'no room to stand up: waiting'; }
      }
      return;
    }
    // WAKING
    const order = [['stirring', c.stirTime], ['sittingUp', c.sitTime], ['rising', c.riseTime]];
    let i = order.findIndex(p => p[0] === this.phase);
    while (i < order.length && this.t >= order[i][1]) { this.t -= order[i][1]; i++; }
    if (i >= order.length) { this._stand(); return; }
    this.phase = order[i][0];
    if (A) A.wake(g, this.phase, this.t / order[i][1], this.standAt);
  };

  // Step 20: buckling and going down, then lying still where he fell (for good)
  mv.GuardKnockout.prototype._deadStep = function () {
    const g = this.guard, c = this.cfg, C = this.collapse, A = mv.ThrowAnim;
    if (this.phase === 'collapsing') {
      const k = Math.min(1, this.t / c.collapseTime);
      if (A && A.collapse) A.collapse(g, C, k);
      if (k < 1) return;
      // on the ground: his hips are where he lies (the same lying pose and colliders as a knockout)
      g.motor.position.x = C.to.x; g.motor.position.z = C.to.z;
      this.body = { position: C.to.clone(), along: C.fall.clone(), at: g.awareness ? g.awareness.clock : 0, defeated: true };
      this._addBody();
      this.phase = 'down'; this.note = 'defeated by gunfire: down';
    }
    // (posed once: lying still, nothing animates him any more, so there's nothing to redo each frame)
    if (A && !C.posed) { if (C.back > 0) A.lying(g); else A.lyingFront(g); C.posed = true; }
  };

  // where he can stand up: where he lies, or a little along his body; null = no room yet
  mv.GuardKnockout.prototype._standSpot = function (target) {
    const g = this.guard, c = this.cfg, b = this.body, w = g.world, P = target && target.position;
    const saved = this.colliders.map(k => k.x); for (const k of this.colliders) k.x = 1e6;
    let out = null;
    for (const d of [0, 0.3, -0.3]) {
      const x = b.position.x + b.along.x * d, z = b.position.z + b.along.z * d, r = w.resolve(x, z, c.standRoom, {});
      if (Math.hypot(r.x - x, r.z - z) > 0.01) continue;
      if (P && Math.hypot(P.x - x, P.z - z) < c.playerRoom) continue;
      out = new THREE.Vector3(x, 0, z); break;
    }
    this.colliders.forEach((k, i) => { k.x = saved[i]; });
    return out;
  };

  // on his feet: his AI, senses and standing collider back
  mv.GuardKnockout.prototype._stand = function () {
    const g = this.guard;
    if (mv.ThrowAnim) mv.ThrowAnim.unfreeze(g);
    this._removeBody();
    g.motor.position.x = this.standAt.x; g.motor.position.z = this.standAt.z;
    g.motor.speed = 0; g.motor.targetSpeed = 0; g.motor.angularVelocity = 0; g.stopMoving(); g.wantYaw = g.yaw;
    this.state = 'CONSCIOUS'; this.phase = ''; this.note = 'back on his feet'; this.wokeAt = g.awareness ? g.awareness.clock : 0;
    g.place();
    if (g.awareness && g.awareness.onWoke) g.awareness.onWoke();
  };

  mv.GuardKnockout.prototype._addBody = function () {
    const c = this.cfg.body, b = this.body, w = this.guard.world;
    this._removeBody();
    for (const d of [c.along, -c.along]) this.colliders.push(w.addCylinder(b.position.x + b.along.x * d, b.position.z + b.along.z * d, c.radius, c.top, null, { noSight: true }));
  };
  mv.GuardKnockout.prototype._removeBody = function () {
    if (!this.colliders.length) return;
    const list = this.guard.world.cylinders;
    for (const k of this.colliders) { const i = list.indexOf(k); if (i >= 0) list.splice(i, 1); }
    this.colliders = [];
  };

  // short status for the developer view
  mv.GuardKnockout.prototype.status = function () {
    if (this.state === 'CONSCIOUS') return this.knockouts ? `conscious · knocked out ${this.knockouts}×` : 'conscious';
    if (this.state === 'DEAD') return `DEFEATED (gunfire) · ${this.phase === 'collapsing' ? 'collapsing' : 'down for good'}`;
    if (this.state === 'THROWN') return this.phase === 'lowered' ? 'UNCONSCIOUS · being lowered' : 'THROWN';
    if (this.state === 'UNCONSCIOUS') return `UNCONSCIOUS · ${this.left.toFixed(0)} s${this.left <= 0 && this.note ? ' · ' + this.note : ''}`;
    return `WAKING · ${{ stirring: 'stirring', sittingUp: 'sitting up', rising: 'getting up' }[this.phase] || this.phase}`;
  };
})(SC.mv);
