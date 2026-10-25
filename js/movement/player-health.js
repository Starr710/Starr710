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
    defeatTime: 1.3,       // s for her to go down
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
    this.state = 'OK'; this.defeatT = 0; this.defeatedAt = null; this.downTilt = 0; this._lift = 0;
    if (this.visual && this.visual.root) { this.visual.root.rotation.x = 0; this.visual.root.rotation.z = 0; }   // (upright again: place() only sets her yaw)
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
    if (after <= 0) { this.state = 'PLAYER_DEFEATED'; this.defeatT = 0; this.reactions = []; this.reactPhase = 'none'; }
    else mv.GuardHealth.prototype._react.call(this, rec);
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

  // per frame at the very end (after every pose): going down when she's defeated
  mv.PlayerHealth.prototype.defeatPose = function (dt) {
    if (!this.defeated()) return;
    const c = this.cfg, R = this.visual.root;
    this.defeatT += dt; const k = Math.min(1, this.defeatT / c.defeatTime);
    const tilt = ease((k - 0.35) / 0.65) * 84 * Math.PI / 180;   // (first she sinks, crouched; then forward onto the ground)
    R.rotation.order = 'YXZ'; R.rotation.set(tilt, this.motor.yaw, 0); R.updateMatrixWorld(true);   // (her facing, then forward over it)
    // the ground: her lowest point (skin) never below it, resting on it once she's down
    if (k < 1 || this._lift === 0) {
      const low = mv.ThrowAnim ? mv.ThrowAnim.lowest({ model: this.visual.model, bones: this.visual.bones }) - this.motor.position.y : 0;
      this._lift = tilt > 0.01 ? Math.max(0, -low + 0.005) : Math.max(0, -low);
    }
    if (this._lift) { R.position.y += this._lift; R.updateMatrixWorld(true); }
    this.downTilt = tilt;
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
