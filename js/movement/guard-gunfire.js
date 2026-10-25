// SHADOW CELL — guard gunfire (Step 22). A guard fires his pistol only when Step 21's
// weapon.canFire() says so (conscious, not restrained, pistol READY: up, startle over, no
// hit reaction, lined up on a target he can SEE right now, a clear line from his muzzle)
// and his own aim has steadied and his cooldown is done. Never on a sound alone: canFire
// needs a visible target. One shot per firing action, semi-automatic: about one every
// `interval` s, each guard on his own (slightly varied) rhythm. Unlimited ammunition.
// A shot is a real hitscan bullet from his muzzle: the direction is where his pistol
// actually points (aimDir: it lags behind a moving target, it doesn't predict) out to the
// distance of what he sees, plus a spread (normal, seeded: repeatable in tests) that's
// worse further away, when she moves (more so sideways), before he's steadied, just after
// a hit reaction and when she's only partly exposed. What it meets first is what it hits:
// a wall, a crate, a pillar, the ground, another guard's body (it stops; no damage: no
// friendly fire yet), or her body (player-health.js hitbox): only then does she lose
// health (`damage`, once per shot). No penetration, no curving toward her.
// Each shot: a muzzle flash on his pistol, its recoil in his arms, a puff where it hits,
// a gunshot (heard by the OTHER guards through their normal hearing, a level 5 noise at his
// muzzle; he doesn't hear himself), and its sound.
(function (mv) {
  'use strict';

  mv.GuardGunfireDefaults = {
    damage: 20,            // HP per hit on the player (temporary testing value: 5 hits from full)
    interval: 1.5,         // s between shots…
    jitter: 0.2,           // …± this (each guard's own rhythm)
    steady: 0.45,          // s of a steady READY aim before his first shot…
    steadyJitter: 0.3,     // …plus up to this
    // spread: the standard deviation of where the bullet crosses her distance, in metres
    spread: {
      base: 0.17, perMetre: 0.004,  // a clearly exposed, still target at 5–10 m: ≈ 60–70% hits on her body (fewer further off)
      moving: 0.1,         // + per m/s she moves…
      lateral: 0.12,       // …and per m/s of that across his line of fire
      unsteady: 0.6,       // ×(1 + this) on his first shot, easing to ×1 over…
      steadyTime: 1.2,     // …this long of continuous aim
      afterHit: 0.6, afterHitTime: 0.8,   // ×(1 + afterHit) for this long after a hit reaction
      exposure: 0.6,       // ×(1 + this × hidden share) when part of her is covered
    },
    range: 40,             // m
    noiseLevel: 5, noiseType: 'gunshot',
    flashTime: 0.05, kickDecay: 12,
    volume: 0.9, hearFalloff: 10,   // the sound fades with his distance from her (the listener)
    seed: 4242,
  };
  const D = Math.PI / 180;
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // guard: mv.Guard (with .weapon); o: { player: { motor, health }, guards (all), world, noise, scene, audio }
  mv.GuardGunfire = function (guard, o, opts) {
    this.g = guard; this.cfg = Object.assign({}, mv.GuardGunfireDefaults, opts || {}); this.cfg.spread = Object.assign({}, mv.GuardGunfireDefaults.spread, (opts && opts.spread) || {});
    Object.assign(this, { player: o.player, guards: o.guards || [], world: o.world, noise: o.noise, audio: o.audio });
    this.ray = new THREE.Raycaster();
    const Fx = mv.PistolFx;
    this.flash = Fx.buildFlash(); this.flash.userData.glow.visible = false;   // (no see-through glow for him: walls hide his flash)
    this.flash.position.set(0, 0.034, 0.17); guard.weapon.gun.add(this.flash);
    this.puffs = []; for (let i = 0; i < 3; i++) { const p = Fx.buildPuff(0xbdb39a); o.scene.add(p); this.puffs.push(p); }
    this._next = 0; this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._hb = {};
    this.series = 0;
    this.reset();
  };

  mv.GuardGunfire.prototype.reset = function () {
    this.rng = mulberry(this.cfg.seed + (this.g && this.g.cfg && this.g.cfg.label ? this.g.cfg.label.length * 977 : 0));
    this.cooldown = 0; this.steadyT = 0; this.steadyNeed = this.cfg.steady + this.rng() * this.cfg.steadyJitter;
    this.shots = 0; this.hits = 0; this.misses = 0; this.lastShot = null; this.why = 'not ready'; this.afterHit = 0; this.flashT = 0; this.series++;
    this.flash.visible = false; for (const p of this.puffs) { p.visible = false; p.userData.t = 1; }
    if (this.g && this.g.weapon) this.g.weapon.kick = 0;
  };

  // per frame, after his weapon has decided (guard.js)
  mv.GuardGunfire.prototype.update = function (dt) {
    const c = this.cfg, g = this.g, W = g.weapon, P = this.player;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (g.health && g.health.reactPhase && g.health.reactPhase !== 'none') this.afterHit = c.spread.afterHitTime; else this.afterHit = Math.max(0, this.afterHit - dt);
    // feedback easing out
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.flash.visible = false;
    W.kick = W.kick > 1e-3 ? W.kick * Math.exp(-c.kickDecay * dt) : 0;
    for (const p of this.puffs) if (p.visible) { const u = p.userData; u.t += dt / 0.3; if (u.t >= 1) { p.visible = false; continue; } p.scale.setScalar(0.6 + 1.6 * u.t); p.material.opacity = 0.85 * (1 - u.t); }
    // may he fire?
    const cf = W.canFire();
    let why = cf.why;
    if (!why && P.health && P.health.defeated()) why = 'target down';
    if (why) { this.steadyT = 0; this.why = why; return; }
    this.steadyT += dt;
    if (this.steadyT < this.steadyNeed) { this.why = 'steadying'; return; }
    if (this.cooldown > 0) { this.why = 'cooldown'; return; }
    this.why = ''; this.fire(cf);
  };

  // one shot
  mv.GuardGunfire.prototype.fire = function (cf) {
    const c = this.cfg, S = c.spread, g = this.g, W = g.weapon, P = this.player, T = W.target;
    const muzzle = W.muzzle(new THREE.Vector3()); if (!muzzle || !T.point) return null;
    // where his pistol points, out to the distance of what he sees
    const chest = g.bones.chest ? g.bones.chest.getWorldPosition(new THREE.Vector3()) : muzzle.clone();
    const dist = chest.distanceTo(T.point), aimPt = chest.clone().addScaledVector(W.aimDir, dist);
    let dir = aimPt.clone().sub(muzzle).normalize();
    // the spread at her distance
    const v = P.motor.velocity || new THREE.Vector3(), spd = Math.hypot(v.x, v.z), across = Math.abs(v.x * dir.z - v.z * dir.x) / Math.max(1e-6, Math.hypot(dir.x, dir.z));
    let s = S.base + S.perMetre * dist + S.moving * spd + S.lateral * across;
    s *= 1 + S.unsteady * Math.max(0, 1 - this.steadyT / S.steadyTime);
    if (this.afterHit > 0) s *= 1 + S.afterHit;
    const exp = g.vision && g.vision.seen ? g.vision.seen.exposure : 1;
    s *= 1 + S.exposure * Math.max(0, 1 - (exp == null ? 1 : exp));
    const u1 = Math.max(1e-9, this.rng()), u2 = this.rng(), r = Math.sqrt(-2 * Math.log(u1)), ox = r * Math.cos(2 * Math.PI * u2) * s, oy = r * Math.sin(2 * Math.PI * u2) * s;   // (normal, 2D)
    const right = dir.clone().cross(new THREE.Vector3(0, 1, 0)).normalize(), up = right.clone().cross(dir).normalize();
    dir = aimPt.clone().addScaledVector(right, ox).addScaledVector(up, oy).sub(muzzle).normalize();
    // what it meets first
    const res = this._resolve(muzzle, dir);
    const shot = { n: ++this.shots, from: muzzle.clone(), dir: dir.clone(), aimed: aimPt, spread: s, offset: Math.hypot(ox, oy), dist, steady: this.steadyT, moving: spd, across, ...res };
    if (res.kind === 'player') {
      shot.damage = P.health.take({ amount: c.damage, source: g.cfg.label, id: g.cfg.label + '.' + this.series + '.' + shot.n, from: muzzle, dir, point: res.point });
      this.hits++;
    } else this.misses++;
    this.lastShot = shot;
    // the gunshot: a level 5 noise at his muzzle (the other guards hear it as usual; he doesn't hear himself)
    shot.noise = this.noise.emit(c.noiseLevel, c.noiseType, new THREE.Vector3(muzzle.x, 0, muzzle.z), this.world.surfaceAt ? this.world.surfaceAt(muzzle.x, muzzle.z) : 'concrete', 'guard-gunfire', g);
    this._feedback(shot);
    this.cooldown = c.interval + (this.rng() * 2 - 1) * c.jitter;
    return shot;
  };

  // the bullet's first contact: world, ground, her body, another standing guard
  mv.GuardGunfire.prototype._resolve = function (m, d) {
    const c = this.cfg, P = this.player;
    let best = c.range, kind = 'none', what = 'nothing', guard = null;
    this.ray.set(m, d); this.ray.near = 0; this.ray.far = best;
    const hits = this.ray.intersectObjects(this.world.meshes, false);
    if (hits.length && hits[0].distance < best) { best = hits[0].distance; kind = 'world'; what = hits[0].object.userData.kind || 'cover'; }
    if (d.y < -1e-4) { const t = -m.y / d.y; if (t > 0 && t < best) { best = t; kind = 'world'; what = 'ground'; } }
    const hb = P.health.hitbox(this._hb);
    const tp = mv.Aim.rayCylinder(m, d, hb.x, hb.z, hb.r, hb.top);
    if (tp != null && tp < best) { best = tp; kind = 'player'; what = 'player'; }
    for (const o of this.guards) {
      if (!o || o === this.g || (o.isDown && o.isDown())) continue;
      const t = mv.Aim.rayCylinder(m, d, o.position.x, o.position.z, 0.3, 1.8);
      if (t != null && t < best) { best = t; kind = 'guard'; what = o.cfg.label; guard = o; }
    }
    return { kind, what, guard, point: kind === 'none' ? null : m.clone().addScaledVector(d, best), range: kind === 'none' ? Infinity : best };
  };

  mv.GuardGunfire.prototype._feedback = function (shot) {
    const c = this.cfg, g = this.g, W = g.weapon;
    this.flash.rotation.z = this.rng() * Math.PI; this.flash.visible = true; this.flashT = c.flashTime; this.flashes = (this.flashes || 0) + 1;
    W.kick = 1;
    if (shot.point) {
      const p = this.puffs[this._next]; this._next = (this._next + 1) % this.puffs.length;
      p.position.copy(shot.point); p.material.color.setHex(shot.kind === 'player' ? 0xff9d7a : 0xbdb39a); p.userData.t = 0; p.visible = true; p.scale.setScalar(0.6);
    }
    // its sound, fainter the further he is from her
    const d = Math.hypot(g.position.x - this.player.motor.position.x, g.position.z - this.player.motor.position.z);
    this.sounds = (this.sounds || 0) + 1;
    mv.PistolFx.gunshot(this.audio, c.volume / (1 + d / c.hearFalloff), this);
  };

  // short status for the developer view (with the weapon's)
  mv.GuardGunfire.prototype.status = function () {
    const s = this.lastShot;
    const now = this.why === '' ? 'FIRING' : this.why === 'cooldown' ? `cooldown ${this.cooldown.toFixed(1)} s` : this.why;
    return `fire: ${now}${this.shots ? ` · ${this.shots} shots ${this.hits} hit${s ? ' · last ' + (s.kind === 'player' ? 'HIT her' : 'missed → ' + s.what) : ''}` : ''}`;
  };
})(SC.mv);
