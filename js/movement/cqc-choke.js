// SHADOW CELL — CQC chokehold (Step 15): the quiet takedown. While she holds a guard
// (GRAPPLING), pressing and HOLDING CHOKE tightens her hold; he struggles, weakens and goes
// limp, she lowers him to the ground and he's knocked out (guard-ko.js, the same
// unconsciousness, timer, memory and wake-up as the throw). Gameplay only; how it looks is
// throw-anim.js (temporary, for the stand-in rigs).
//   hold     while CHOKE is held: progress 0 → 1 over `duration` s. The pair stays put (the
//            stick is ignored), RELEASE and THROW are locked. Let go early: back to the normal
//            restraint (progress starts again from 0 next time), he's still conscious and held
//   lower    progress complete: he's limp; she lowers him onto his back beside her
//   recover  she lets go and straightens up; then her normal controls are back
// Unlike the throw there's no impact: only a faint sound as he's laid down (noise level
// `lowerNoiseLevel`, 0 = silent), heard through the normal hearing rules. No voice. He needs
// the same room to lie down as a throw (cqc-throw.js); without it CHOKE isn't offered.
(function (mv) {
  'use strict';

  mv.ChokeDefaults = {
    duration: 3.0,         // s of holding CHOKE to knock him out (temporary testing value)
    initiate: 0.25,        // s for the hold to tighten into the chokehold pose
    relaxFrom: 0.6,        // share of the progress after which his struggle fades and he goes limp
    lower: 1.25,           // s to lower him to the ground…
    recover: 0.45,         // …and for her to let go and straighten up
    lowerNoiseLevel: 1,    // the faint sound of laying him down (1 = a sneak's footstep; 0 = none)
    noiseType: 'body lowered',
    playerTurn: 0.3,       // she turns this share of the way toward where he's laid down (≤ playerTurnMax of the throw)
  };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const PHASE_LABEL = { hold: 'choking', lower: 'lowering him', recover: 'letting go' };

  // can she choke the guard she holds? (he must have room to be laid down) { ok, why, L, side }
  mv.CQC.prototype.chokeCheck = function () {
    if (this.state !== 'GRAPPLING') return { ok: false, why: 'not holding anyone' };
    const p = this.throwCheck();
    return p.ok ? p : { ok: false, why: p.why.replace('no room to throw him', 'no room to lower him') };
  };

  // a new press of CHOKE (one per press; holding it on is what keeps the choke going)
  mv.CQC.prototype.chokeStart = function () {
    if (this.state !== 'GRAPPLING') return 'busy';
    const p = this.chokeCheck(); this.lastChoke = p.ok ? 'choking' : p.why;
    if (!p.ok) return p.why;
    const m = this.motor, g = this.guard;
    this.ch = { phase: 'hold', t: 0, p: 0, plan: p, guard: g, side: p.side, L: p.L, S: g.position.clone(), yaw0: g.yaw, yaw1: Math.atan2(-p.L.x, -p.L.z),
      pyaw0: m.yaw, at: m.position.clone(), hipsOut: this.tcfg.hipsOut };
    this.state = 'CHOKING'; this.chokes++; this.vel = null; this.av = 0; this.dir = null; this.speed = 0;
    m.speed = 0; m.targetSpeed = 0; m.angularVelocity = 0; m.reverseGait = false; this._setGuardMotion(0, 0);
    const A = mv.ThrowAnim, ch = this.ch;
    if (A) g.poseHook = () => A.chokeStruggle(g, ch.p, ch.t, this.kcfg);   // his struggle, over his own clip pose
    return 'choke';
  };

  // per frame while CHOKING (from cqc.update); held: is CHOKE held right now
  mv.CQC.prototype._chokeStep = function (dt, held) {
    const c = this.kcfg, m = this.motor, ch = this.ch, g = ch.guard, A = mv.ThrowAnim;
    m.speed = 0; m.targetSpeed = 0; m.angularVelocity = 0; m.reverseGait = false;
    if (ch.phase === 'hold') {
      if (!held) return this._chokeInterrupt();
      ch.t += dt; ch.p = Math.min(1, ch.p + dt / c.duration);
      // the pair stays exactly where it is, facing as it was (the stick does nothing)
      this._place(ch.at.x, ch.at.z, ch.pyaw0, this.cfg.holdOffset); this._setGuardMotion(0, 0);
      this.throwPose = A ? A.chokePlayer('hold', ch.p, ch.t, c) : null;
      if (ch.p >= 1) {   // out: limp in her arms, she lowers him
        g.poseHook = null; g.ko.beginLower(); if (g._live) g._live.clear();   // (his slumped pose is what's frozen)
        ch.phase = 'lower'; ch.t = 0; this.lastChoke = 'completed'; this.chokeDone = (this.chokeDone || 0) + 1;
        const want = Math.atan2(ch.L.x, ch.L.z), turn = Math.max(-this.tcfg.playerTurnMax, Math.min(this.tcfg.playerTurnMax, wrap(want - m.yaw) * 180 / Math.PI * c.playerTurn)) * Math.PI / 180;
        ch.pyaw1 = m.yaw + turn;
      }
      return true;
    }
    if (ch.phase === 'lower') {
      ch.t += dt; const k = Math.min(1, ch.t / c.lower);
      if (A) A.chokeLower(g, ch, k);
      const pp = A ? A.chokePlayer('lower', k, ch.t, c) : { turn: k, crouch: false };
      m.yaw = ch.pyaw0 + wrap(ch.pyaw1 - ch.pyaw0) * pp.turn; m.stance = pp.crouch ? 'crouch' : 'stand'; this.throwPose = pp;
      if (k >= 1) {   // on the ground: knocked out there (the existing unconsciousness)
        const at = new THREE.Vector3(ch.S.x + ch.L.x * ch.hipsOut, 0, ch.S.z + ch.L.z * ch.hipsOut);
        g.yaw = ch.yaw1; g.ko.knockOut({ position: at, along: ch.L, by: ch.at });
        if (this.noise && c.lowerNoiseLevel > 0) this.lastLowerSound = this.noise.emit(c.lowerNoiseLevel, c.noiseType, at, this.world.surfaceAt ? this.world.surfaceAt(at.x, at.z) : 'concrete', 'takedown');
        ch.phase = 'recover'; ch.t = 0;
      }
      return true;
    }
    // recover
    ch.t += dt; const k = Math.min(1, ch.t / c.recover);
    this.throwPose = A ? A.chokePlayer('recover', k, ch.t, c) : null; m.stance = 'stand';
    if (k >= 1) { this.ch = null; this.throwPose = null; this.state = 'FREE'; return false; }
    return true;
  };

  // CHOKE let go before he's out: back to the normal restraint, still conscious and held
  mv.CQC.prototype._chokeInterrupt = function () {
    const ch = this.ch, g = ch.guard;
    g.poseHook = null; if (mv.ThrowAnim) mv.ThrowAnim.clearLive(g);
    this.lastChoke = `interrupted at ${Math.round(ch.p * 100)}%`; this.chokeInterrupts = (this.chokeInterrupts || 0) + 1;
    this.ch = null; this.throwPose = null; this.state = 'GRAPPLING'; this.vel = null; this.av = 0; this.dir = null; this.speed = 0;
    return true;
  };

  // RESET (or any cancel) mid-choke
  mv.CQC.prototype._chokeCancel = function () {
    const ch = this.ch; if (!ch) return;
    const g = ch.guard; g.poseHook = null; if (mv.ThrowAnim) mv.ThrowAnim.clearLive(g);
    if (ch.phase === 'lower' && g.ko) g.ko.abortThrow();
    this.ch = null; this.throwPose = null;
  };

  mv.CQC.prototype.chokeStatus = function (held) {
    if (this.state === 'CHOKING') {
      const ch = this.ch, c = this.kcfg;
      if (ch.phase === 'hold') return `CHOKING · held ${held ? 'yes' : 'no'} · ${Math.round(ch.p * 100)}% · ${((1 - ch.p) * c.duration).toFixed(1)} s left`;
      return `CHOKE completed · ${PHASE_LABEL[ch.phase]}`;
    }
    if (this.state === 'GRAPPLING') { const p = this.chokeCheck(); return (p.ok ? 'CHOKE available' : 'CHOKE blocked: ' + p.why) + (this.lastChoke && this.lastChoke !== 'choking' ? ' · last: ' + this.lastChoke : ''); }
    return this.lastChoke ? 'last: ' + this.lastChoke : '–';
  };
})(SC.mv);
