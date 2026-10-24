// SHADOW CELL — quick CQC takedown (Step 16): HOLD CQC by a guard (while she's free) takes him
// straight down, without the sustained restraint. It's the grab's acquisition, quicker, run
// straight into the Step 14 throw retimed (cqc-throw.js): the same landing choice and room
// check, the same impact sound, the same knockout (guard-ko.js). Gameplay only; the poses
// are throw-anim.js's.
//   acquire     she seizes him: drawn against her and turned with her (the grab, faster)
//   offBalance / throw / impact / recover   the throw's phases, shorter (≈1.1 s in all)
// Who and when: the same rules as a grab (in reach, nothing solid between them, not down;
// any awareness, any facing), the nearest such guard. It only starts if, once she has him,
// he'll have room to land (worked out for where the pair will be); otherwise nothing
// happens and lastTakedown says why. A HOLD never grabs.
(function (mv) {
  'use strict';

  mv.TakedownDefaults = {
    acquire: 0.15,         // s to seize him (a grab takes grabTime)
    phases: { initiate: 0, offBalance: 0.2, throw: 0.32, impact: 0.12, recover: 0.3 },   // the throw's phases, quicker
  };

  // where the pair will be once she has him: her, him and the facing (as _grab leaves them)
  mv.CQC.prototype._acquirePose = function (g) {
    const m = this.motor, c = this.cfg, yaw = Math.atan2(g.position.x - m.position.x, g.position.z - m.position.z);
    const tx = g.position.x - Math.sin(yaw) * c.holdOffset, tz = g.position.z - Math.cos(yaw) * c.holdOffset;
    const P = new THREE.Vector3(m.position.x + (tx - m.position.x) * 0.5, 0, m.position.z + (tz - m.position.z) * 0.5);
    return { P, S: new THREE.Vector3(P.x + Math.sin(yaw) * c.holdOffset, 0, P.z + Math.cos(yaw) * c.holdOffset), yaw };
  };

  // is a quick takedown possible right now? { ok, why, guard, side }
  mv.CQC.prototype.takedownCheck = function () {
    if (this.state !== 'FREE') return { ok: false, why: 'busy' };
    const why = this.check();
    if (why) return { ok: false, why };
    const g = this.target, A = this._acquirePose(g), p = this._throwPlan(A.S, A.P, A.yaw, g);
    return p.ok ? { ok: true, why: '', guard: g, side: p.side } : { ok: false, why: p.why.replace('no room to throw him', 'no room for a takedown'), guard: g };
  };

  // HOLD CQC while free
  mv.CQC.prototype.quickTakedown = function () {
    const p = this.takedownCheck();
    if (!p.ok) { this.lastTakedown = 'failed: ' + p.why; this.takedownFails = (this.takedownFails || 0) + 1; return p.why; }
    this.guard = p.guard; this.quick = true; this.takedowns = (this.takedowns || 0) + 1; this.lastTakedown = 'taking him down';
    this._grab();                                   // seize him (ends in _acquired, not the restraint)
    return 'takedown';
  };

  // she has him: straight into the throw (the room was checked for this pose)
  mv.CQC.prototype._acquired = function () {
    const g = this.guard, m = this.motor, p = this._throwPlan(g.position, m.position, m.yaw, g);
    this.quick = false;
    if (!p.ok) {   // (something moved into the way meanwhile): let him go rather than force it
      this.lastTakedown = 'cancelled: ' + p.why; this.state = 'GRAPPLING'; this.release(); return;
    }
    this._throwBegin(p, Object.assign({}, this.dcfg.phases), true);
  };

  mv.CQC.prototype.takedownStatus = function () {
    const inp = this.input, hp = inp && inp.cqcHoldProgress ? inp.cqcHoldProgress() : null;
    const input = hp != null ? `HOLD ${Math.round(hp * 100)}% of ${inp.cqcHoldTime.toFixed(2)} s` : (inp ? inp.cqcLast : 'IDLE');
    if (this.quick) return `${input} · seizing ${this.guard.cfg.label}`;
    if (this.state === 'THROWING' && this.thr.quick) return `${input} · TAKEDOWN · ${this.thr.phase}`;
    let avail = '';
    if (this.state === 'FREE') { const c = this.takedownCheck(); avail = c.ok ? ' · available: ' + c.guard.cfg.label : ' · ' + c.why; }
    return `${input}${avail}${this.lastTakedown ? ' · last: ' + this.lastTakedown : ''}`;
  };
})(SC.mv);
