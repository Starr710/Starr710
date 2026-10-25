// SHADOW CELL — a throwable item (Step 23): the Empty Magazine, the first utility item, used
// through the one USE action (equipment.js). Nothing here is a "decoy button": it's a
// definition in the equipment registry, and a later throwable is another definition with
// its own config (or its own create()).
// One use:
//   throw        a short procedural throw over her animated pose (`throwTime`): the magazine
//                in her right hand, a wind-up behind the shoulder, released at `releaseAt`,
//                a follow-through. Her legs are never stopped: she can walk while she throws
//   direction    where the camera looks on the ground; the camera's pitch tilts the arc
//                (looking up throws higher and further), always within [minElev, maxElev]
//                and a landing distance on flat ground of [minRange, maxRange]
//   flight       a real ballistic path under gravity from her hand, moved in short sub-steps,
//                each one a segment checked against every wall, crate, pillar (the collision
//                world's boxes and cylinders) and the floor: nothing tunnels through. It
//                reacts where it actually hits (a bounce off the surface's normal)
//   impact       the FIRST contact is the one sound of the throw: a noise event through the
//                existing noise system at the impact point, at `noiseLevel` on the surface
//                there (concrete L3 ≈ 14 m, metal louder, grass softer), of type 'clatter'
//                (an object impact: never a gunshot, never a footstep). The guards hear it
//                with their normal hearing and judge it with their normal awareness; it tells
//                them where it landed, never where she is. Later bounces are only small
//                audible ticks, never new noise events
//   settle       it slides to rest, lies flat, and is cleared away after `cleanupAfter` s
// Only one magazine is ever in flight. A wind-up is cancelled (nothing thrown, no cooldown)
// if she starts aiming, grabs a guard or is defeated before the release.
(function (mv) {
  'use strict';

  mv.MagazineDefaults = {
    cooldown: 2.5,            // s from a throw until the next one
    throwTime: 0.42,          // s of the throw pose in all…
    releaseAt: 0.17,          // …the magazine leaves her hand here
    minRange: 8, maxRange: 12,   // m it would carry on flat ground (low arc … high arc)
    elevOffset: 25,           // ° of launch elevation with the camera level…
    pitchShare: 0.7,          // …less this share of the camera's downward pitch…
    minElev: 5, maxElev: 40,  // …kept within these
    gravity: 9.81,
    step: 1 / 120,            // s per flight sub-step (each a checked segment)
    radius: 0.035,            // m: its size against the world
    restitution: 0.32,        // bounce: normal speed kept…
    friction: 0.3,            // …tangential speed kept per bounce
    restSpeed: 0.45,          // m/s on the floor below which it stops bouncing and slides…
    slideDecel: 10,           // …slowing this fast (m/s²) to rest
    maxFlight: 6,             // s: a safety stop for anything that never lands
    cleanupAfter: 8,          // s at rest before it's cleared away
    noiseLevel: 3, noiseType: 'clatter', category: 'object impact',
    volume: 0.75, hearFalloff: 10,   // the clatter fades with its distance from her (the listener)
    tickVolume: 0.25,         // later bounces: small ticks (sound only)
    reportFor: 15,            // s after the impact the developer view follows the guards' response (and shows it)
  };
  const D = Math.PI / 180, UP = new THREE.Vector3(0, 1, 0);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  function buildMagazine() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.105, 0.05), new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.45, metalness: 0.6 }));
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.042), new THREE.MeshStandardMaterial({ color: 0x8d8f8c, roughness: 0.35, metalness: 0.8 }));
    lip.position.y = 0.058; body.castShadow = true; g.add(body, lip);
    g.name = 'empty-magazine'; g.visible = false;
    return g;
  }

  // the first thing a segment a→b (3D) meets: { t (0…1), n (normal), what } or null.
  // Boxes are solid from the floor to their top, cylinders likewise; characters (noSight) don't stop it
  function sweep(world, a, b, r) {
    let best = null;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    for (const o of world.boxes) {
      let t0 = 0, t1 = 1, nAxis = -1, nSign = 0, ok = true;
      const lo = [o.minX - r, -1, o.minZ - r], hi = [o.maxX + r, o.top + r, o.maxZ + r], p = [a.x, a.y, a.z], d = [dx, dy, dz];
      for (let i = 0; i < 3 && ok; i++) {
        if (Math.abs(d[i]) < 1e-9) { if (p[i] < lo[i] || p[i] > hi[i]) ok = false; continue; }
        let u = (lo[i] - p[i]) / d[i], v = (hi[i] - p[i]) / d[i], s = -1;
        if (u > v) { const w = u; u = v; v = w; s = 1; }
        if (u > t0) { t0 = u; nAxis = i; nSign = s; }
        t1 = Math.min(t1, v); if (t0 > t1) ok = false;
      }
      if (!ok || nAxis < 0 || t0 > 1 || (best && t0 >= best.t)) continue;   // (nAxis < 0: it starts inside: let it out)
      const n = new THREE.Vector3(); n.setComponent(nAxis, nSign);
      best = { t: t0, n, what: (o.mesh && o.mesh.userData.kind) || 'wall', box: o };
    }
    for (const c of world.cylinders) {
      if (c.noSight) continue;
      const R = c.r + r, fx = a.x - c.x, fz = a.z - c.z, A = dx * dx + dz * dz;
      if (A < 1e-12) continue;
      const B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - R * R, disc = B * B - 4 * A * C;
      if (C < 0 || disc < 0) continue;
      const t = (-B - Math.sqrt(disc)) / (2 * A);
      if (t < 0 || t > 1 || (best && t >= best.t)) continue;
      const y = a.y + dy * t; if (y > c.top + r) continue;
      const n = new THREE.Vector3(fx + dx * t, 0, fz + dz * t).normalize();
      best = { t, n, what: (c.mesh && c.mesh.userData.kind) || 'pillar' };
    }
    if (dy < 0 && a.y >= r - 1e-6 && b.y < r) {
      const t = (a.y - r) / -dy;
      if (!best || t < best.t) best = { t, n: UP.clone(), what: 'ground' };
    }
    return best;
  }

  // a short metallic clatter (synthesized): a bright noise burst and a few inharmonic rings
  function clatter(audio, vol, tick) {
    const ctx = audio && audio.ctx; if (!ctx || ctx.state !== 'running' || vol < 0.01) return false;
    const t = ctx.currentTime + 0.004, out = audio.out || ctx.destination;
    const len = Math.floor(ctx.sampleRate * (tick ? 0.04 : 0.09)), buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
    src.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = tick ? 4200 : 3200; bp.Q.value = 1.2; ng.gain.value = vol * 0.9;
    src.connect(bp); bp.connect(ng); ng.connect(out); src.start(t);
    const rings = tick ? [3900] : [1870, 2960, 4410, 6230];
    rings.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = t + (tick ? 0 : i * 0.012 + (i > 1 ? 0.05 : 0)), dur = tick ? 0.05 : 0.12 + 0.05 * (3 - i);
      o.type = 'sine'; o.frequency.setValueAtTime(f * (0.98 + Math.random() * 0.04), at);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol * (tick ? 0.25 : 0.32 / (1 + i * 0.4)), at + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g); g.connect(out); o.start(at); o.stop(at + dur + 0.02);
    });
    return true;
  }

  // ctx (equipment): { motor, visual, posture, cam, world, noise, scene, audio, guards }
  mv.ThrowableItem = function (ctx, def) {
    this.ctx = ctx; this.def = def; this.cfg = Object.assign({}, mv.MagazineDefaults, def.config || {});
    this.mesh = buildMagazine(); ctx.scene.add(this.mesh);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this.throws = 0; this.impacts = 0; this.sounds = 0; this.ticks = 0;
    this.reset();
  };
  const T = mv.ThrowableItem.prototype;

  T.reset = function () {
    this.phase = 'ready';   // ready | throwing | flight | rest (and back to ready once cleared)
    this.cooldown = 0; this.armT = Infinity; this.released = false; this.flying = false; this.flightT = 0; this.restT = 0; this.bounces = 0;
    this.shot = null;       // this throw: { yaw, elev, speed, range, from }
    this.impact = null;     // its first contact: { point, what, surface, noise, heard: [...] }
    this.cancelled = null;
    this.mesh.visible = false;
  };

  T.busy = function () { return this.phase === 'throwing' || this.phase === 'flight'; };
  T.inFlight = function () { return this.phase === 'flight'; };

  // state (main.js): { down, aiming, cqcState, busy }
  T.canUse = function (s) {
    if (s.down) return 'defeated';
    if (s.aiming) return 'aiming';
    if (s.cqcState && s.cqcState !== 'FREE') return s.cqcState === 'GRAPPLING' || s.cqcState === 'CHOKING' ? 'holding a guard' : 'in CQC';
    if (s.busy) return 'busy';
    if (this.phase === 'throwing') return 'throwing';
    if (this.phase === 'flight') return 'in flight';
    if (this.cooldown > 0) return `cooldown ${this.cooldown.toFixed(1)} s`;
    return '';
  };

  T.use = function () {
    const c = this.cfg, cam = this.ctx.cam;
    // where it goes: the camera's facing on the ground, its pitch tilting the arc
    const f = cam.forward(new THREE.Vector3()), yaw = Math.atan2(f.x, f.z);
    const elev = clamp(c.elevOffset - c.pitchShare * (cam.pitch / D), c.minElev, c.maxElev);
    const range = c.minRange + (c.maxRange - c.minRange) * (elev - c.minElev) / Math.max(1e-6, c.maxElev - c.minElev);
    if (this.phase === 'rest') this.mesh.visible = false;   // (a new throw clears the last one away)
    this.phase = 'throwing'; this.armT = 0; this.released = false; this.cancelled = null;
    this.shot = { yaw, elev, range, speed: 0, from: null, at: performance.now() };
    this.cooldown = c.cooldown; this.throws++;
    this.mesh.visible = true;
    return { ok: true, why: '' };
  };

  // per frame (before her pose is built): the throw's clock, the flight, who went to look
  T.update = function (dt, s) {
    const c = this.cfg;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.phase === 'throwing') {
      // something took over before it left her hand: no throw, no cooldown
      const stop = s.down ? 'defeated' : s.aiming ? 'aiming' : s.cqcState && s.cqcState !== 'FREE' ? 'CQC' : '';
      if (stop) { this.cancelled = stop; this.phase = 'ready'; this.cooldown = 0; this.throws--; this.armT = Infinity; this.mesh.visible = false; return; }
      if (this.armT >= c.releaseAt + 0.1) this._release(null);   // (no pose to release it from: from her shoulder)
    }
    if (this.armT < c.throwTime) this.armT += dt;
    if (this.flying) this._fly(dt);
    if (this.phase === 'rest' && (this.restT += dt) >= c.cleanupAfter) { this.mesh.visible = false; this.phase = 'ready'; }
    this.watch(dt);
  };

  // the magazine leaves her hand (world position), on the throw's line
  T._release = function (hand) {
    const c = this.cfg, sh = this.shot, m = this.ctx.motor;
    const from = hand ? hand.clone() : m.position.clone().add(new THREE.Vector3(0, 1.45, 0));
    // the speed that lands it `range` away on flat ground from this height
    const h = Math.max(0.2, from.y), th = sh.elev * D, R = sh.range;
    const v = Math.sqrt(c.gravity * R * R / (2 * Math.cos(th) * Math.cos(th) * Math.max(0.1, h + R * Math.tan(th))));
    sh.speed = v; sh.from = from.clone();
    this.pos.copy(from);
    this.vel.set(Math.sin(sh.yaw) * Math.cos(th), Math.sin(th), Math.cos(sh.yaw) * Math.cos(th)).multiplyScalar(v);
    // (her own walking carries into it a little)
    if (m.velocity) this.vel.addScaledVector(m.velocity, 0.5).setY(this.vel.y);
    this.released = true; this.flying = true; this.phase = 'flight'; this.flightT = 0; this.bounces = 0; this.impact = null; this.restT = 0;
    this.spin = new THREE.Vector3(9 + Math.random() * 4, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 5);
    this.mesh.position.copy(from);
  };

  // sub-stepped flight: every step a segment against the world
  T._fly = function (dt) {
    const c = this.cfg, W = this.ctx.world, a = this._a, b = this._b;
    let left = Math.min(dt, 0.1);
    while (left > 1e-6 && this.flying) {
      const h = Math.min(c.step, left); left -= h; this.flightT += h;
      const onFloor = this.pos.y <= c.radius + 1e-3 && Math.abs(this.vel.y) < 1e-3;
      if (onFloor) {   // sliding to rest
        const sp = Math.hypot(this.vel.x, this.vel.z), ns = Math.max(0, sp - c.slideDecel * h);
        if (ns < 0.02) { this._rest(); break; }
        this.vel.x *= ns / sp; this.vel.z *= ns / sp;
      } else this.vel.y -= c.gravity * h;
      a.copy(this.pos); b.copy(this.pos).addScaledVector(this.vel, h);
      const hit = sweep(W, a, b, c.radius);
      if (hit) {
        this.pos.copy(a).lerp(b, Math.max(0, hit.t - 1e-4));
        this._contact(hit);
      } else this.pos.copy(b);
      if (this.flightT > c.maxFlight) { this._rest(); break; }
    }
    // its look: tumbling in flight
    const M = this.mesh; M.position.copy(this.pos);
    if (this.flying) { M.rotation.x += this.spin.x * dt; M.rotation.y += this.spin.y * dt; M.rotation.z += this.spin.z * dt; }
  };

  T._contact = function (hit) {
    const c = this.cfg, n = hit.n, vn = this.vel.dot(n);
    if (vn >= 0) return;
    const speed = this.vel.length();
    // the bounce: normal part reversed and damped, the rest slowed by friction
    const vN = n.clone().multiplyScalar(vn), vT = this.vel.clone().sub(vN);
    this.vel.copy(vT.multiplyScalar(c.friction)).addScaledVector(n, -vn * c.restitution);
    this.spin.multiplyScalar(0.5);
    this.bounces++;
    if (!this.impact) this._impact(hit, speed);
    else if (speed > 1.2) { this.ticks++; clatter(this.ctx.audio, c.tickVolume * this._fade(), true); }
    // on the floor and slow: no more hops, it slides
    if (n.y > 0.7 && Math.abs(this.vel.y) < c.restSpeed * 2) { this.vel.y = 0; this.pos.y = c.radius; }
  };

  // the first contact: the one noise of this throw
  T._impact = function (hit, speed) {
    const c = this.cfg, W = this.ctx.world, p = this.pos.clone();
    const surface = hit.what === 'ground' && W.surfaceAt ? W.surfaceAt(p.x, p.z) : 'concrete';
    this.impacts++;
    const ev = this.ctx.noise.emit(c.noiseLevel, c.noiseType, new THREE.Vector3(p.x, 0, p.z), surface, 'object');
    const heard = [];
    for (const g of this.ctx.guards || []) {
      if (!g) continue;
      const L = g.hearing && g.hearing.last, own = !!L && L.type === c.noiseType && L.position.x === ev.position.x && L.position.z === ev.position.z;   // (what his hearing made of this very event)
      const a = g.awareness, dead = g.ko && g.ko.state === 'DEAD';
      const why = !own ? 'not heard' : L.heard ? (a && a.state === 'ALERT' && g.vision.seen.rate > 0 ? 'ALERT: kept on her' : '') : L.why ? (dead ? 'dead' : L.why) : `out of earshot ${L.distance.toFixed(1)}/${L.reach.toFixed(1)} m`;
      heard.push({ guard: g, label: g.cfg.label.split(' —')[0], heard: !!(own && L.heard), distance: own ? L.distance : null, why, state: a ? a.state : '', investigated: false, looked: false });
    }
    this.impact = { point: p, what: hit.what, surface, speed, noise: ev, heard, time: this.flightT, watchT: 0 };
    this.sounds += clatter(this.ctx.audio, c.volume * this._fade(), false) ? 1 : 0;
  };

  T._fade = function () {
    const m = this.ctx.motor.position; return 1 / (1 + Math.hypot(this.pos.x - m.x, this.pos.z - m.z) / this.cfg.hearFalloff);
  };

  T._rest = function () {
    this.flying = false; this.vel.set(0, 0, 0); this.pos.y = 0.013; this.restT = 0;
    if (this.phase === 'flight') this.phase = 'rest';
    // lying flat on its side, keeping roughly the heading it had
    const M = this.mesh; M.position.copy(this.pos);
    M.quaternion.setFromAxisAngle(UP, M.rotation.y).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
    if (!this.impact) this._impact({ what: 'ground', n: UP }, 0);   // (never touched anything: still one sound where it stopped)
  };

  // who went to look (for the developer view), checked a few times a second for a while after the impact
  T.watch = function (dt) {
    const I = this.impact; if (!I || I.watchT > this.cfg.reportFor) return;
    I.watchT += dt;
    for (const r of I.heard) {
      if (!r.heard) continue;
      const a = r.guard.awareness, f = a.focus && a.focus.position;
      const near = f && Math.hypot(f.x - I.point.x, f.z - I.point.z) < 3;
      if (a.state === 'INVESTIGATING' && near) r.investigated = true;
      if ((a.state === 'SUSPICIOUS' || a.state === 'INVESTIGATING') && near) r.looked = true;
      if (!r.why && I.watchT > 2.5 && !r.looked && r.guard.personality && r.guard.personality.writtenOff) r.why = 'wrote it off';
    }
  };

  // per frame, after her animation and posture: the throwing arm over them (a short overlay, her legs untouched)
  T.pose = function (dt) {
    const c = this.cfg, b = this.ctx.visual.bones, P = this.ctx.posture, u = this.armT;
    if (!(u < c.throwTime)) return;
    if (!P || !P.hands || !b.rightArm || !b.leftArm || !b.rightHand) return;   // (update() releases it from her shoulder)
    const K = mv.PostureKit, t = this._t || (this._t = { q: new THREE.Quaternion(), q2: new THREE.Quaternion(), m: new THREE.Matrix4(), m2: new THREE.Matrix4() });
    const rel = c.releaseAt, end = c.throwTime, m = this.ctx.motor, sh = this.shot;
    // the weight of the overlay: in during the wind-up, out over the end of the follow-through
    const w = smooth(u / 0.08) * (1 - smooth((u - (end - 0.12)) / 0.12));
    // the hand goes back (to 55% of the wind-up), then swings through the release
    const back = smooth(u / (rel * 0.55)), swing = smooth((u - rel * 0.55) / (rel * 0.45 + 0.06));
    // her shoulders: which way is her right, and which way a turn about the vertical takes the right shoulder
    const r = b.rightArm.getWorldPosition(new THREE.Vector3()).sub(b.leftArm.getWorldPosition(new THREE.Vector3())).setY(0).normalize();
    const f0 = new THREE.Vector3(Math.sin(m.yaw), 0, Math.cos(m.yaw)), fwdSign = Math.sign(UP.clone().cross(r).dot(f0)) || 1;
    // the upper body: toward the throw (at most 50°), the right shoulder back for the wind-up, through for the release
    const twist = clamp(wrap(sh.yaw - m.yaw), -50 * D, 50 * D);
    const turn = (twist * 0.8 + fwdSign * (-28 * D * back * (1 - swing) + 16 * D * swing)) * w;
    [b.spine, b.spine1, b.chest].forEach((bone, i) => { if (bone) K.rotateWorld(bone, new THREE.Quaternion().setFromAxisAngle(UP, turn * [0.25, 0.35, 0.4][i]), t); });
    // the throwing hand: behind and above the shoulder → out in front, high, at the release → down across her
    const yaw = m.yaw + twist * 0.8, f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), rr = r.clone().applyAxisAngle(UP, twist * 0.8);
    const S = b.rightArm.getWorldPosition(new THREE.Vector3());
    const wound = S.clone().addScaledVector(f, -0.2).addScaledVector(UP, 0.15).addScaledVector(rr, 0.12);
    const out = S.clone().addScaledVector(f, 0.42).addScaledVector(UP, 0.16).addScaledVector(rr, 0.02);
    const after = S.clone().addScaledVector(f, 0.34).addScaledVector(UP, -0.32).addScaledVector(rr, -0.14);
    // (the swing forward arcs over the shoulder, never through it)
    const over = S.clone().addScaledVector(f, 0.1).addScaledVector(UP, 0.34).addScaledVector(rr, 0.1), k = swing, j = 1 - k;
    const target = u < rel ? wound.multiplyScalar(j * j).addScaledVector(over, 2 * j * k).addScaledVector(out, k * k) : out.lerp(after, smooth((u - rel) / (end - rel - 0.06)));
    const all = [b.rightArm, b.rightForeArm, b.rightHand, ...P.hands.right.fingers.map(x => x.bone)], base = all.map(x => x.quaternion.clone());
    K.twoBoneIK(b.rightArm, b.rightForeArm, b.rightHand, target, rr.clone().multiplyScalar(0.7).addScaledVector(UP, -0.6), t, 1);
    if (!this.released) K.curlFingers(b.rightHand, P.hands.right, P.cfg.gripCurl, t);
    if (w < 0.999) { all.forEach((x, i) => x.quaternion.copy(base[i].slerp(x.quaternion, w))); b.rightArm.updateMatrixWorld(true); }
    // in her hand until the release
    if (!this.released && this.phase === 'throwing') {
      const hq = b.rightHand.getWorldQuaternion(new THREE.Quaternion()), M = this.mesh;
      M.position.copy(b.rightHand.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, 0.07, 0.02).applyQuaternion(hq)); M.quaternion.copy(hq); M.updateMatrixWorld(true);
      if (u >= rel) this._release(M.position);
    }
  };

  T.status = function () {
    const ph = this.phase, I = this.impact;
    const now = ph === 'throwing' ? (this.released ? 'thrown' : 'winding up') : ph === 'flight' ? 'in flight' : ph === 'rest' ? 'settled' : 'ready';
    return `${now}${this.cooldown > 0 ? ` · cd ${this.cooldown.toFixed(1)} s` : ''}${this.cancelled && ph === 'ready' ? ' · cancelled (' + this.cancelled + ')' : ''}`;
  };
  // the last distraction, for the developer view
  // (null once it's over: the stats bar then folds it away; the record stays in this.impact)
  T.distraction = function () {
    const I = this.impact; if (!I || I.watchT > this.cfg.reportFor) return null;
    const xz = `(${I.point.x.toFixed(1)}, ${I.point.z.toFixed(1)})`;
    const who = I.heard.map(r => `${r.label.replace('Guard ', 'G')} ${r.heard ? (r.investigated ? 'investigated' : r.looked ? 'looked' : r.why || 'heard') : r.why}`).join(' · ');
    return `${xz} ${I.what === 'ground' ? I.surface : I.what} · ${this.cfg.category} L${I.noise.level} ${I.noise.radius.toFixed(0)} m · ${who}`;
  };

  // ---------------------------------------------------------------- the Empty Magazine
  mv.registerEquipment({
    id: 'empty-magazine', name: 'Empty Magazine', short: 'MAG', category: 'item', kind: 'throwable', action: 'throw',
    quantity: Infinity,   // unlimited for now
    config: Object.assign({}, mv.MagazineDefaults),
    create(ctx, def) { return new mv.ThrowableItem(ctx, def); },
  });
  mv.ThrowableItem.sweep = sweep;   // (the checks use it)
})(SC.mv);
