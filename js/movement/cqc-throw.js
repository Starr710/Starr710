// SHADOW CELL — CQC throw (Step 14): the first nonlethal takedown. While she holds a guard
// (GRAPPLING), THROW takes him off his feet and down onto his back beside her, and he's
// knocked out (guard-ko.js). Gameplay only: the phases, where he lands, the impact and
// the handoff. How it looks is throw-anim.js (temporary, for the stand-in rigs).
//   initiate    the pull stops; she sets her grip (his own AI already suspended)
//   offBalance  she twists him so his back faces the landing and tips him onto his heels
//   throw       she turns into it and drops her hips; he's swept off his feet and goes over
//   impact      he lands (one noise event where he lands; he's UNCONSCIOUS from here)
//   recover     she lets go and straightens up; then her normal controls are back
// Where he lands: on his back, hips `hipsOut` from where he stood, head away from her, to
// one side of her (her right first, then the other sides in `sides` order). The whole
// lying body (feet to head, with a margin) must be clear of walls, crates, pillars and the
// other guard, and not across her; if no side is clear the throw isn't offered.
(function (mv) {
  'use strict';

  mv.ThrowDefaults = {
    initiate: 0.18, offBalance: 0.32, throw: 0.42, impact: 0.16, recover: 0.42,   // s per phase (≈1.5 s in all)
    hipsOut: 0.55,         // m from where he stood to where his hips land
    feet: 0.45, head: 1.45,   // m: his lying body runs from this far behind where he stood to this far ahead (toward the landing)
    bodyRoom: 0.24,        // m kept clear around that line (his body's half-width)
    playerRoom: 0.45,      // m between her centre and his lying body
    sides: [-90, 90, -45, 45, -135, 135],   // ° from her facing to try, in order of preference (− = her right, + = her left)
    playerTurn: 0.55, playerTurnMax: 50,   // her body turns this share of the way toward the throw (≤ this many °)
    noiseLevel: 3,         // impact loudness (noise level 1–5: 3 = as loud as a jog's footstep)
    noiseType: 'body impact',
  };
  const PHASES = ['initiate', 'offBalance', 'throw', 'impact', 'recover'];
  const PHASE_LABEL = { initiate: 'initiation', offBalance: 'off-balance', throw: 'throw', impact: 'impact', recover: 'recovery' };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  // can she throw the guard she holds, and which way? { ok, why, L, side }
  mv.CQC.prototype.throwCheck = function () {
    const c = this.tcfg, m = this.motor, g = this.guard;
    if (this.state !== 'GRAPPLING' || !g) return { ok: false, why: 'not holding anyone' };
    const S = g.position, P = m.position, yaw = m.yaw;
    let why = 'no room to throw him';
    for (const deg of c.sides) {
      const a = yaw + deg * Math.PI / 180, L = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const r = this._landingClear(S, L, P, g);
      if (!r) return { ok: true, why: '', L, side: deg };
      why = 'no room to throw him (' + r + ')';
    }
    return { ok: false, why };
  };

  // '' if his lying body fits that way, otherwise what's in the way
  mv.CQC.prototype._landingClear = function (S, L, P, g) {
    const c = this.tcfg, w = this.world, R = c.bodyRoom;
    const ax = S.x - L.x * c.feet, az = S.z - L.z * c.feet, bx = S.x + L.x * c.head, bz = S.z + L.z * c.head;
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.08);
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
      for (const o of w.boxes) if (Math.hypot(Math.max(o.minX - x, 0, x - o.maxX), Math.max(o.minZ - z, 0, z - o.maxZ)) < R) return 'wall or crate';
      for (const k of w.cylinders) {
        if (k === g.collider || (g.ko && g.ko.colliders.indexOf(k) >= 0)) continue;
        if (Math.hypot(k.x - x, k.z - z) < k.r + R) return 'pillar or body';
      }
    }
    // not across her
    const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((P.x - ax) * vx + (P.z - az) * vz) / (vx * vx + vz * vz)));
    if (Math.hypot(P.x - ax - vx * t, P.z - az - vz * t) < c.playerRoom) return 'she is in the way';
    return '';
  };

  // the THROW button
  mv.CQC.prototype.throwTap = function () {
    if (this.state !== 'GRAPPLING') return 'busy';
    const p = this.throwCheck(); this.lastThrow = p.ok ? 'thrown' : p.why;
    if (!p.ok) return p.why;
    const m = this.motor, g = this.guard, c = this.tcfg;
    const want = Math.atan2(p.L.x, p.L.z), rel = wrap(want - m.yaw), turn = Math.max(-c.playerTurnMax, Math.min(c.playerTurnMax, rel * 180 / Math.PI * c.playerTurn)) * Math.PI / 180;
    this.thr = { t: 0, phase: 'initiate', L: p.L, side: p.side, S: g.position.clone(), yaw0: g.yaw, yaw1: Math.atan2(-p.L.x, -p.L.z), pyaw0: m.yaw, pyaw1: m.yaw + turn,
      by: m.position.clone(), hipsOut: c.hipsOut, impacted: false, guard: g };
    this.state = 'THROWING'; this.throws++; this.vel = null; this.av = 0; this.dir = null; this.speed = 0;
    m.speed = 0; m.targetSpeed = 0; m.angularVelocity = 0; m.reverseGait = false; this._setGuardMotion(0, 0);
    return 'throw';
  };

  // per frame while THROWING (from cqc.update); true while it still has control
  mv.CQC.prototype._throwStep = function (dt) {
    const c = this.tcfg, m = this.motor, thr = this.thr, g = thr.guard, A = mv.ThrowAnim;
    thr.t += dt;
    let t = thr.t, i = 0;
    while (i < PHASES.length && t >= c[PHASES[i]]) { t -= c[PHASES[i]]; i++; }
    if (i >= PHASES.length) return this._throwDone();
    const phase = PHASES[i], k = t / c[phase];
    // entering the off-balance: he's no longer his own man (his pose is the throw's from here)
    if (i >= 1 && !thr.taken) { thr.taken = true; g.ko.beginThrow(); }
    // he lands: knocked out where his hips touch down, one impact sound from there
    if (i >= 3 && !thr.impacted) this._impact();
    m.speed = 0; m.targetSpeed = 0; m.angularVelocity = 0; m.reverseGait = false;
    if (i === 0) this._setGuardMotion(0, 0);
    else if (A) A.guard(g, thr, i <= 3 ? phase : 'lying', k);
    // her: turn toward the throw, drop the hips, work the arms (throw-anim.js says how much)
    const pp = A ? A.player(phase, k) : { turn: k, twist: 0, crouch: false };
    m.yaw = thr.pyaw0 + wrap(thr.pyaw1 - thr.pyaw0) * pp.turn;
    m.stance = pp.crouch ? 'crouch' : 'stand';
    this.throwPose = pp; thr.phase = phase; thr.k = k;
    return true;
  };

  mv.CQC.prototype._impact = function () {
    const c = this.tcfg, thr = this.thr, g = thr.guard;
    thr.impacted = true;
    const at = new THREE.Vector3(thr.S.x + thr.L.x * thr.hipsOut, 0, thr.S.z + thr.L.z * thr.hipsOut);
    g.yaw = thr.yaw1;
    g.ko.knockOut({ position: at, along: thr.L, by: thr.by });
    const surface = this.world.surfaceAt ? this.world.surfaceAt(at.x, at.z) : 'concrete';
    this.lastImpact = this.noise ? this.noise.emit(c.noiseLevel, c.noiseType, at, surface, 'takedown') : null;
    this.impacts = (this.impacts || 0) + 1;
  };

  mv.CQC.prototype._throwDone = function () {
    const thr = this.thr;
    if (!thr.impacted) this._impact();
    this.lastThrowInfo = { guard: thr.guard, side: thr.side, landed: thr.guard.position.clone() };
    this.thr = null; this.throwPose = null; this.state = 'FREE'; this.motor.stance = 'stand';
    return false;
  };

  mv.CQC.prototype.throwStatus = function () {
    if (this.state === 'THROWING') return `THROWING · ${PHASE_LABEL[this.thr.phase] || this.thr.phase}`;
    if (this.state === 'GRAPPLING') { const p = this.throwCheck(); return p.ok ? `THROW available (${p.side < 0 ? 'right' : 'left'} ${Math.abs(p.side)}°)` : 'THROW blocked: ' + p.why; }
    return this.lastThrow ? 'last: ' + this.lastThrow : '–';
  };
})(SC.mv);
