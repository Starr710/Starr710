// SHADOW CELL — break-free timer (Step 17). Every guard she holds breaks out of her grip after
// the same `duration` (game time): no difference for awareness, personality, training,
// facing or startle. The countdown starts with the grab and runs while she holds him
// (GRABBING, GRAPPLING) — standing, pulling, turning, the camera: none of it extends it.
// Holding CHOKE pauses it; a choke let go before he's out puts it back to the full time
// (cqc-choke.js). THROW, a completed choke, RELEASE and RESET end it; the quick takedown never
// starts one. At zero (only in the ordinary restraint — never during a committed throw or
// choke) he twists out of the hold and steps away while she staggers back a little; then
// he's free and ALERT, remembering where she was, and she can move (and grab) again at once.
(function (mv) {
  'use strict';

  mv.BreakFreeDefaults = {
    duration: 10,          // s she can hold a guard (temporary testing value; the same for every guard)
    breakTime: 0.5,        // s he takes to twist free…
    push: 0.8,             // …ending this far further away from her (m)…
    stagger: 0.18,         // …while she's knocked back this much (m)
    twist: 40,             // ° his body twists as he wrenches out
    urgentAt: 3,           // s left when the indicator turns urgent
  };
  const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

  mv.CQC.prototype._bfStart = function () { const d = this.bcfg.duration; this.bf = { left: d, full: d }; };
  mv.CQC.prototype._bfReset = function () { if (this.bf) { this.bf.left = this.bf.full; this.bfResets = (this.bfResets || 0) + 1; } };
  mv.CQC.prototype._bfEnd = function () { this.bf = null; };

  // per frame, before the state's own step: count down while she's simply holding him
  mv.CQC.prototype._bfTick = function (dt) {
    if (!this.bf || (this.state !== 'GRABBING' && this.state !== 'GRAPPLING')) return;
    this.bf.left = Math.max(0, this.bf.left - dt);
    if (this.bf.left <= 0 && this.state === 'GRAPPLING') this._breakFree();
  };

  mv.CQC.prototype._breakFree = function () {
    const m = this.motor, g = this.guard;
    this.bf = null; this.breaks = (this.breaks || 0) + 1; this.lastBreak = g.cfg.label + ' broke free';
    this.state = 'BREAKING'; this.t = 0; this.vel = null; this.av = 0; this.dir = null; this.speed = 0;
    this.from = { p: m.position.clone(), g: g.position.clone(), yaw: m.yaw, gy: g.yaw };
    m.speed = 0; m.targetSpeed = 0; m.angularVelocity = 0; m.reverseGait = false; this._setGuardMotion(0, 0);
  };

  // per frame while BREAKING: he wrenches out and away, she's knocked back; both kept out of walls
  mv.CQC.prototype._breakStep = function (dt) {
    const c = this.bcfg, m = this.motor, g = this.guard, f = this.from;
    this.t += dt; const k = ease(this.t / c.breakTime), fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
    const gr = this._resolve(f.g.x + fx * c.push * k, f.g.z + fz * c.push * k, g.cfg.radius);
    g.position.x = gr.x; g.position.z = gr.z; g.yaw = f.gy + c.twist * Math.PI / 180 * Math.sin(Math.PI * k); g.wantYaw = g.yaw; g.place();
    const pr = this._resolve(f.p.x - fx * c.stagger * k, f.p.z - fz * c.stagger * k, m.cfg.radius);   // (his own collider aside: they're still touching)
    m.position.x = pr.x; m.position.z = pr.z; m.speed = 0; m.targetSpeed = 0; m.angularVelocity = 0; m.reverseGait = false;
    this._setGuardMotion(0, 0);
    if (this.t >= c.breakTime) {
      g.restraint = null; g.stopMoving(); g.yaw = f.gy; g.wantYaw = g.yaw; g.place();
      if (g.awareness && g.awareness.onReleased) { g.awareness.onReleased(m.position); g.awareness.note = 'broke free from her hold'; }
      this.state = 'FREE';
    }
    return true;
  };

  // for the HUD and STATS: { left, full, urgent } while a countdown is running (paused while choking)
  mv.CQC.prototype.breakFreeInfo = function () {
    if (!this.bf) return null;
    return { left: this.bf.left, full: this.bf.full, urgent: this.bf.left <= this.bcfg.urgentAt, paused: this.state === 'CHOKING' };
  };
})(SC.mv);
