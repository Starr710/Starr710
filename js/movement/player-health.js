// SHADOW CELL — the protagonist's health (Step 22). The same shape as a guard's
// (guard-health.js): `max` and `current` (100), percent() worked out from them, every hit
// recorded (lastDamage, history), damage in through take(ev) only, at most once per event,
// never below 0. Apart from everything else: CQC, guard awareness and unconsciousness never
// touch it. No healing yet.
//   a hit        a short flinch over her pose (the guards' reaction overlay, on her bones),
//                a brief red tint at the screen edges and a dull impact sound. Her controls
//                are untouched: she keeps moving, aiming and shooting
//   0 HP         PLAYER_DEFEATED: she sinks to her knees and goes down where she stands;
//                movement, AIM, FIRE and CQC are off (main.js) and a short message says to
//                RESET. Nothing more can hurt her; RESET is the retry
// Her body for bullets (hitbox): an upright cylinder round her hips, as tall as her head is
// high right now (lower when she crouches), so it follows what's actually on screen.
(function (mv) {
  'use strict';

  mv.PlayerHealthDefaults = {
    max: 100,
    react: { rise: 0.08, settle: 0.35, recoil: 12, twist: 9, head: 8, slow: 1, keep: 2 },   // gentler than a guard's, and her pace is never checked (slow 1)
    hitbox: { radius: 0.24, headClear: 0.12 },
    tint: 0.45,            // s the screen-edge tint lasts
    reactFor: 0.12,        // s of the last hit's flinch before she goes down…
    defeatTime: 0.95,      // …and s to go down
    historyMax: 12,
  };
  const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

  mv.PlayerHealth = function (visual, motor, opts) {
    this.cfg = Object.assign({}, mv.PlayerHealthDefaults, opts || {});
    this.max = this.cfg.max; this.visual = visual; this.motor = motor;
    // what the shared reaction code needs of "him"
    this.guard = { bones: visual.bones, forward: out => out.set(Math.sin(motor.yaw), 0, Math.cos(motor.yaw)), motor: { speed: 0, angularVelocity: 0 } };
    this._base = new Map(); this.tintEl = null; this.audio = null;
    this.reset();
  };

  mv.PlayerHealth.prototype.reset = function () {
    this.current = this.max; this.history = []; this.lastDamage = null; this.received = 0; this.events = new Set();
    this.reactions = []; this.reactPhase = 'none'; if (this._base && this._base.size) mv.GuardHealth.prototype._restore.call(this);
    this.state = 'OK'; this.defeatT = 0; this.defeatedAt = null;
    if (this._g) this._unfreeze();   // (on her feet again: her animation takes over)
    if (this.tintEl) this.tintEl.classList.remove('hit');
  };
  mv.PlayerHealth.prototype.percent = function () { return this.max > 0 ? this.current / this.max * 100 : 0; };
  mv.PlayerHealth.prototype.defeated = function () { return this.state === 'PLAYER_DEFEATED'; };

  // ev: { amount, source (who), id (unique per shot), from, dir, point }
  mv.PlayerHealth.prototype.take = function (ev) {
    const key = (ev.source || '?') + ':' + ev.id;
    if (ev.id != null && this.events.has(key)) return { applied: false, why: 'already applied' };
    if (this.defeated()) return { applied: false, why: 'already defeated' };
    const before = this.current, after = Math.max(0, before - Math.max(0, ev.amount || 0));
    if (ev.id != null) this.events.add(key);
    this.current = after; this.received += before - after;
    const rec = { amount: before - after, source: ev.source || '?', before, after, from: ev.from ? ev.from.clone() : null, dir: ev.dir ? ev.dir.clone() : null, point: ev.point ? ev.point.clone() : null };
    this.lastDamage = rec; this.history.push(rec); if (this.history.length > this.cfg.historyMax) this.history.shift();
    if (after <= 0) { this.state = 'PLAYER_DEFEATED'; this.defeatT = 0; }
    mv.GuardHealth.prototype._react.call(this, rec);   // (the last hit too: she flinches, then goes down)
    if (this.tintEl) { this.tintEl.classList.remove('hit'); void this.tintEl.offsetWidth; this.tintEl.classList.add('hit'); }
    this._thud();
    return { applied: true, why: '', before, after, defeated: after <= 0 };
  };

  // her body for bullets, right now: { x, z, r, top }
  mv.PlayerHealth.prototype.hitbox = function (out) {
    const B = this.visual.bones, c = this.cfg.hitbox, o = out || {};
    const hips = (B.hips || B.spine).getWorldPosition(this._v || (this._v = new THREE.Vector3()));
    o.x = hips.x; o.z = hips.z; o.r = c.radius;
    o.top = (B.head ? B.head.getWorldPosition(this._w || (this._w = new THREE.Vector3())).y : 1.6) + c.headClear - this.motor.position.y;
    return o;
  };

  // per frame, after her animation and posture, before the aiming pose (so the pistol stays in her hands)
  mv.PlayerHealth.prototype.poseReact = function (dt) { mv.GuardHealth.prototype.poseReact.call(this, dt); };

  // Defeated: the last hit's flinch plays for `reactFor` s, then her pose is frozen (main.js stops her animation,
  // posture and aim layers) and she collapses as the guards do when shot down (throw-anim.js collapse: the knees
  // give, the hips drop, the trunk and legs go over together, forward onto her front, her skin kept on the ground),
  // then lies face down. Posed once when she's settled: nothing is recalculated after that. RESET unfreezes her
  mv.PlayerHealth.prototype.frozen = function () { return !!this._frozen; };
  mv.PlayerHealth.prototype._shim = function () {
    if (this._g) return this._g;
    const v = this.visual, m = this.motor;
    this._g = { root: v.root, fall: v.fall, bones: v.bones, model: v.model, get position() { return m.position; }, get yaw() { return m.yaw; }, set yaw(x) {},
      place() { v.place(m.position, m.yaw); v.root.updateMatrixWorld(true); }, forward: out => out.set(Math.sin(m.yaw), 0, Math.cos(m.yaw)) };
    return this._g;
  };
  // per frame at the very end (after every pose)
  mv.PlayerHealth.prototype.defeatPose = function (dt) {
    if (!this.defeated()) return;
    const c = this.cfg, A = mv.ThrowAnim; if (!A || !this.visual.fall) return;
    this.defeatT += dt;
    if (this.defeatT < c.reactFor) return;   // (the last hit's flinch first)
    const g = this._shim();
    if (!this._frozen) {
      this.visual.lean.rotation.set(0, 0, 0); g.place();
      A.freeze(g); this._frozen = true; this._posed = false;
      const f = g.forward(new THREE.Vector3());
      this.collapse = { S: this.motor.position.clone(), back: -1, fall: f, to: this.motor.position.clone().setY(0), kneel: true };   // (forward, onto her knees and chest, where she stands)
    }
    const k = Math.min(1, (this.defeatT - c.reactFor) / c.defeatTime);
    if (k < 1) { A.collapse(g, this.collapse, k); this.downK = k; }
    else if (!this._posed) { A.lyingFront(g); this._posed = true; this.downK = 1; }
  };
  mv.PlayerHealth.prototype._unfreeze = function () {
    if (this._frozen && mv.ThrowAnim) mv.ThrowAnim.unfreeze(this._g);
    this._frozen = false; this._posed = false; this.downK = 0;
  };

  // a dull hit sound (temporary, synthesized)
  mv.PlayerHealth.prototype._thud = function () {
    const a = this.audio, ctx = a && a.ctx; if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.003, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(a.out || ctx.destination); o.start(t); o.stop(t + 0.2);
  };

  mv.PlayerHealth.prototype.status = function (enemy) {
    const L = this.lastDamage;
    const shots = enemy && enemy.shots ? ` · enemy ${enemy.shots} shots, ${enemy.hits} hit, ${enemy.shots - enemy.hits} missed` : '';
    if (!L && !shots && !this.defeated()) return `HP ${this.current}/${this.max}`;
    return `HP ${this.current}/${this.max} (${Math.round(this.percent())}%)${L ? ` · −${L.amount} ${L.source.split(' —')[0]}` : ''}${shots}${this.defeated() ? ' · PLAYER_DEFEATED' : ''}`;
  };
})(SC.mv);
