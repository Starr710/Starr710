// SHADOW CELL — guard health, damage and hit reactions (Step 20). Gameplay state first: each
// guard has his own `max` and `current` health (100 for a regular guard); a weapon hands a
// damage event to mv.applyDamage (the one way damage gets in), which applies it at most once
// per event, never below 0, and records it. What reads it (STATS now, health bars later):
// current, max, percent() (worked out from those two, never stored), lastDamage, history,
// defeated(). Health is apart from consciousness: a CQC knockout doesn't touch it and a guard
// keeps his health through being knocked out and coming round.
//   nonfatal hit   he flinches away from the shot (an overlay on his own pose: upper body
//                  recoils, shoulders twist, head snaps, his stride checked for a moment)
//                  and knows he's been attacked (guard-awareness.js onShot)
//   0 HP           he's defeated by gunfire: a terminal state of his consciousness
//                  (guard-ko.js 'DEAD'): he buckles and collapses where he stood, lies
//                  there and does nothing until RESET (never wakes, unlike UNCONSCIOUS)
// A guard who's already down (unconscious or defeated) isn't a target and takes no damage.
(function (mv) {
  'use strict';

  mv.HealthDefaults = {
    max: 100,              // regular guard (temporary testing value)
    // the hit reaction (temporary, procedural): rises fast, eases back
    react: { rise: 0.1, settle: 0.4, recoil: 20, twist: 14, head: 12, slow: 0.35, keep: 2 },   // ° and s; slow: share of his speed kept at the hit; keep: reactions blended at once
    historyMax: 12,
  };
  const D = Math.PI / 180;
  const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

  mv.GuardHealth = function (guard, opts) {
    this.guard = guard;
    this.cfg = Object.assign({}, mv.HealthDefaults, opts || {});
    this.max = this.cfg.max;
    this._base = new Map();
    this.reset();
  };

  mv.GuardHealth.prototype.reset = function () {
    this.current = this.max; this.history = []; this.lastDamage = null; this.received = 0; this.events = new Set();
    this.reactions = []; this.reactPhase = 'none';
    this._restore();
  };
  mv.GuardHealth.prototype.percent = function () { return this.max > 0 ? this.current / this.max * 100 : 0; };
  mv.GuardHealth.prototype.defeated = function () { return this.current <= 0; };

  // the damage interface. ev: { amount, source (e.g. 'pistol'), id (unique per event: a shot
  // applies once), from (where it came from: the muzzle), dir (unit, its travel), point }
  // returns { applied, why, before, after, defeated }
  mv.applyDamage = function (guard, ev) {
    const h = guard && guard.health;
    if (!h) return { applied: false, why: 'no health' };
    return h.take(ev);
  };
  mv.GuardHealth.prototype.take = function (ev) {
    const g = this.guard, key = ev.source + ':' + ev.id;
    if (ev.id != null && this.events.has(key)) return { applied: false, why: 'already applied' };
    if (g.isDown && g.isDown()) return { applied: false, why: g.ko.state === 'DEAD' ? 'already defeated' : 'unconscious' };
    const amount = Math.max(0, ev.amount || 0), before = this.current, after = Math.max(0, before - amount);
    if (ev.id != null) this.events.add(key);
    this.current = after; this.received += before - after;
    const rec = { amount: before - after, source: ev.source || '?', before, after, at: g.awareness ? g.awareness.clock : 0, from: ev.from ? ev.from.clone() : null, dir: ev.dir ? ev.dir.clone() : null, point: ev.point ? ev.point.clone() : null };
    this.lastDamage = rec; this.history.push(rec); if (this.history.length > this.cfg.historyMax) this.history.shift();
    if (after <= 0) {
      this.reactions = []; this._restore(); this.reactPhase = 'none';
      if (g.ko && g.ko.defeat) g.ko.defeat({ dir: rec.dir, from: rec.from, source: rec.source });
    } else {
      this._react(rec);
      if (g.awareness && g.awareness.onShot) g.awareness.onShot(rec);
    }
    return { applied: true, why: '', before, after, defeated: after <= 0 };
  };

  // ---------------------------------------------------------------- the hit reaction
  mv.GuardHealth.prototype._react = function (rec) {
    const c = this.cfg.react, g = this.guard;
    // away from the shot: lean back along its travel, twist toward the side it struck
    const d = rec.dir ? rec.dir.clone().setY(0) : new THREE.Vector3(0, 0, 1); if (d.lengthSq() < 1e-8) d.set(0, 0, 1); d.normalize();
    const f = g.forward(new THREE.Vector3()), r = new THREE.Vector3(f.z, 0, -f.x);   // his right
    this.reactions.push({ t: 0, d, side: Math.sign(d.dot(r)) || 1 });
    while (this.reactions.length > c.keep) this.reactions.shift();   // a new hit blends over the last one, never piles up
    if (g.motor) { g.motor.speed *= c.slow; g.motor.angularVelocity *= c.slow; }   // his stride checked for a moment (his own walk picks back up)
  };

  // per frame after his own pose (guard.js): the reactions on top; nothing accumulates
  const _pq = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _ax = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  mv.GuardHealth.prototype.poseReact = function (dt) {
    const c = this.cfg.react, g = this.guard, B = g.bones;
    if (!this.reactions.length && !this._base.size) { this.reactPhase = 'none'; return; }
    for (const r of this.reactions) r.t += dt;
    this.reactions = this.reactions.filter(r => r.t < c.rise + c.settle);
    const env = r => r.t < c.rise ? ease(r.t / c.rise) : 1 - ease((r.t - c.rise) / c.settle);
    let total = 0; for (const r of this.reactions) total += env(r);
    const norm = total > 1 ? 1 / total : 1;   // blended, never more than one full reaction
    const last = this.reactions[this.reactions.length - 1];
    this.reactPhase = !last ? 'none' : last.t < c.rise ? 'impact' : 'recovering';
    const parts = [[B.spine1, 0.4, 0.4], [B.chest, 0.6, 0.6], [B.head, 0, 0, true]];
    for (const [bone, kr, kt, head] of parts) {
      if (!bone) continue;
      const kept = this._base.get(bone);
      if (kept && bone.quaternion.equals(kept.written)) bone.quaternion.copy(kept.base);   // (not re-posed by his clip this frame)
      if (!this.reactions.length) { this._base.delete(bone); continue; }
      const base = bone.quaternion.clone();
      bone.parent.getWorldQuaternion(_pq).invert();
      for (const r of this.reactions) {
        const e = env(r) * norm; if (e <= 1e-4) continue;
        const tilt = _ax.copy(r.d).cross(UP).negate().normalize();   // leans back along the shot's travel
        const a = head ? c.head : c.recoil * kr, tw = head ? 0 : c.twist * kt * r.side;
        bone.quaternion.premultiply(_dq.setFromAxisAngle(tilt.applyQuaternion(_pq), a * D * e));
        if (tw) bone.quaternion.premultiply(_dq.setFromAxisAngle(_ax.copy(UP).applyQuaternion(_pq), -tw * D * e));
      }
      bone.updateMatrixWorld(true);
      this._base.set(bone, { base, written: bone.quaternion.clone() });
    }
  };
  // put any reaction pose back (defeat, RESET)
  mv.GuardHealth.prototype._restore = function () {
    for (const [bone, kept] of this._base) if (bone.quaternion.equals(kept.written)) bone.quaternion.copy(kept.base);
    this._base.clear();
  };

  // short status for the developer view
  mv.GuardHealth.prototype.status = function () {
    const L = this.lastDamage, g = this.guard;
    const state = g.ko ? (g.ko.state === 'DEAD' ? 'DEFEATED (gunfire)' : g.ko.state) : 'conscious';
    return `HP ${Math.round(this.current)}/${this.max} (${Math.round(this.percent())}%)${L ? ` · last −${L.amount} ${L.source}` : ''} · ${this.reactPhase === 'none' ? state : 'hit: ' + this.reactPhase}`;
  };
})(SC.mv);
