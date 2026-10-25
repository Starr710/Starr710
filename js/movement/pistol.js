// SHADOW CELL — the pistol (Step 19): one semi-automatic pistol, fired while aiming. The CQC
// button reads FIRE while AIM is on (input.js routes its presses here instead of to CQC); one
// press is one shot, at most one per `interval` (by the presses' own timestamps), and only
// once the pistol is up. Unlimited ammunition for the movement lab (no magazine, no reload).
// A shot, hitscan in two stages:
//   1. the camera's centre ray (aim.trace: the crosshair) gives the intended point: its first
//      real obstruction (wall, crate, pillar, a standing guard, the ground)
//   2. the bullet goes from the pistol's muzzle toward that point; whatever solid it meets
//      first is what it hits (cover in front of the muzzle that the camera sees over takes
//      the shot). No penetration: it stops at the first thing
// What it hit is recorded (lastShot) and handed to onHit (the hook a damage system will
// use). For now a guard hit is only registered: a brief flinch, a hit marker on the
// crosshair, his count of hits. No injury, no death, no knockout. The shot is a level 5
// noise ('gunshot') at the muzzle through the normal noise system, so guards hear it by
// their normal hearing (and react by their normal awareness) or don't.
// Feedback (all temporary, cheap): a muzzle flash for a few frames, a puff where it hit
// (pooled), the pistol kicking up in her hands, a small camera kick that recovers, and a
// synthesized gunshot on the footstep audio's context.
(function (mv) {
  'use strict';

  mv.PistolDefaults = {
    interval: 0.2,         // s: fastest it can fire (semi-automatic: one shot per press)
    readyAt: 0.8,          // the aim blend from which it can fire (the pistol is up)
    range: 60,             // m
    noiseLevel: 5, noiseType: 'gunshot',   // the gunfire level of the noise system (reach 80 m on concrete)
    flashTime: 0.05,       // s the muzzle flash shows
    kickDecay: 14,         // 1/s: the pistol's kick settles…
    kickBack: 0.035,       // …from this far back (m)…
    kickClimb: 8,          // …and this much muzzle climb (°)
    cameraKick: 0.5,       // ° the aiming camera kicks up, recovering at…
    cameraRecover: 12,     // …this rate (1/s)
    impactTime: 0.3,       // s an impact puff lasts
    impactPool: 6,         // puffs kept for reuse
    hitMarkerTime: 0.3,    // s the crosshair's hit marker shows (guard hits only)
    flinch: 7, flinchTime: 0.3,   // ° and s a guard flinches when hit (placeholder, no damage)
    volume: 1,
  };
  const DEG = Math.PI / 180;

  // the pieces of a shot's feedback, built once
  function buildFlash() {
    const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const petal = new THREE.PlaneGeometry(0.05, 0.11); petal.rotateX(Math.PI / 2); petal.translate(0, 0, 0.05);
    for (const r of [0, Math.PI / 2]) { const m = new THREE.Mesh(petal, mat); m.rotation.z = r; g.add(m); }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.04, 10), mat); g.add(disc);
    // a soft glow drawn even through her body: from over her shoulder the pistol itself is hidden by her
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d'), gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    // (a quad turned to the camera when it shows, not a sprite: the scene has no sprites, as the guard checks expect)
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), color: 0xffc76a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    glow.position.z = 0.04; glow.renderOrder = 5; glow.name = 'glow'; g.add(glow); g.userData.glow = glow;
    g.visible = false; g.renderOrder = 4; g.name = 'muzzle-flash';
    return g;
  }
  function buildPuff(color) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; m.renderOrder = 3; m.userData.t = 1;
    return m;
  }

  // o: { aim, aimPose, cam, world, guards, noise, scene, audio (FootstepAudio, for its context), marker (hit-marker element) }
  mv.Pistol = function (o, opts) {
    this.cfg = Object.assign({}, mv.PistolDefaults, opts || {});
    Object.assign(this, { aim: o.aim, pose: o.aimPose, cam: o.cam, world: o.world, guards: o.guards || [], noise: o.noise, audio: o.audio, marker: o.marker || null });
    this.ray = new THREE.Raycaster();
    this.flash = buildFlash(); if (this.pose) this.pose.pistol.add(this.flash);
    this.flash.position.set(0, 0.034, 0.17);   // at the muzzle
    this.puffs = [];
    for (let i = 0; i < this.cfg.impactPool; i++) { const p = buildPuff(0xbdb39a); o.scene.add(p); this.puffs.push(p); }
    this._next = 0;
    this.onHit = null;   // hook for a future damage system: onHit(shot)
    this.reset();
  };

  mv.Pistol.prototype.reset = function () {
    this.shots = 0; this.flashes = 0; this.kicks = 0; this.dropped = 0; this.lastShot = null; this.why = '';
    this.lastAt = -Infinity; this.clock = 0; this.shotClock = -Infinity; this.flashT = 0; this.kick = 0; this.markerT = 0; this.sounds = 0;
    this.flash.visible = false; if (this.pose) this.pose.kick = 0;
    if (this.cam) this.cam.kick = 0;
    for (const p of this.puffs) { p.visible = false; p.userData.t = 1; }
    for (const g of this.guards) if (g && g._flinch) { if (g.poseHook === g._flinch.hook) g.poseHook = null; g._flinch = null; }
    if (this.marker) this.marker.classList.remove('hit');
  };

  // can it fire right now? ('' = yes)
  mv.Pistol.prototype.check = function () {
    if (!this.aim.active) return 'not aiming';
    if ((this.cam.aimK || 0) < this.cfg.readyAt || !this.pose || !this.pose.pistol.visible) return 'raising';
    return '';
  };

  // per frame, after the camera and aim.trace: presses = FIRE press times (ms, the events' own)
  mv.Pistol.prototype.update = function (dt, presses) {
    const c = this.cfg; this.clock += dt;
    for (const at of presses || []) {
      const why = this.check();
      if (why) { this.dropped++; this.why = why; continue; }
      if (at - this.lastAt < c.interval * 1000) { this.dropped++; this.why = 'too fast'; continue; }   // (semi-automatic: one per press, at most one per interval)
      this.lastAt = at; this.shotClock = this.clock; this.why = ''; this.fire();
    }
    // feedback easing out
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.flash.visible = false; else if (this.flash.visible) this._face();
    this.kick *= Math.exp(-c.kickDecay * dt); if (this.kick < 1e-3) this.kick = 0;
    if (this.pose) this.pose.kick = this.kick;
    if (this.cam && this.cam.kick) { this.cam.kick *= Math.exp(-c.cameraRecover * dt); if (this.cam.kick < 1e-5) this.cam.kick = 0; }
    for (const p of this.puffs) if (p.visible) {
      const u = p.userData; u.t += dt / c.impactTime;
      if (u.t >= 1) { p.visible = false; continue; }
      p.scale.setScalar(u.s * (0.6 + 1.6 * u.t)); p.material.opacity = 0.85 * (1 - u.t);
    }
    if (this.markerT > 0 && (this.markerT -= dt) <= 0 && this.marker) this.marker.classList.remove('hit');
    for (const g of this.guards) if (g && g._flinch && (g._flinch.t += dt) >= c.flinchTime) { if (g.poseHook === g._flinch.hook) g.poseHook = null; g._flinch = null; }
  };

  // one shot (validated by update)
  mv.Pistol.prototype.fire = function () {
    const c = this.cfg, A = this.aim, P = this.pose;
    const muzzle = P.muzzle(new THREE.Vector3());
    const T = A.trace(muzzle, P.gunDir);                     // 1. the crosshair's point, this instant
    const aimed = { what: T.what, guard: T.guard, point: T.point.clone(), dist: T.dist };
    const shot = this._resolve(muzzle, aimed);              // 2. from the muzzle toward it
    shot.n = ++this.shots; shot.origin = T.origin.clone(); shot.dir = T.dir.clone(); shot.muzzle = muzzle.clone(); shot.aimed = aimed;
    shot.at = A.guards && A.guards[0] && A.guards[0].awareness ? A.guards[0].awareness.clock : 0;
    // the sound: a level 5 event at the muzzle, through the normal noise system; who heard it
    const ev = this.noise.emit(c.noiseLevel, c.noiseType, new THREE.Vector3(muzzle.x, 0, muzzle.z), this.world.surfaceAt ? this.world.surfaceAt(muzzle.x, muzzle.z) : 'concrete', 'player');
    shot.noise = ev;
    shot.heardBy = this.guards.filter(g => g && g.hearing && g.hearing.last && g.hearing.last.type === c.noiseType && g.hearing.last.heard && g.hearing.last.position.distanceTo(ev.position) < 1e-6).map(g => g.cfg.label);
    this.lastShot = shot;
    this._feedback(shot);
    if (shot.guard) this._guardHit(shot);
    if (this.onHit) this.onHit(shot);
    return shot;
  };

  // the bullet from the muzzle toward the aimed point: the first solid thing on that line
  const _u = new THREE.Vector3();
  mv.Pistol.prototype._resolve = function (m, aimed) {
    const c = this.cfg, to = aimed.point, len = m.distanceTo(to), u = _u.copy(to).sub(m).normalize();
    const far = aimed.what === 'nothing' ? c.range : len + 0.1;
    let best = far, what = 'nothing', guard = null, kind = 'none';
    this.ray.set(m, u); this.ray.near = 0; this.ray.far = far;
    const hits = this.ray.intersectObjects(this.world.meshes, false);
    if (hits.length && hits[0].distance < best) { best = hits[0].distance; const k = hits[0].object.userData.kind || 'cover'; what = k; kind = k; }
    if (u.y < -1e-4) { const d = -m.y / u.y; if (d > 0 && d < best) { best = d; what = 'ground'; kind = 'ground'; } }
    for (const g of this.guards) {
      if (!g || (g.isDown && g.isDown())) continue;   // (a downed guard isn't a target yet)
      const d = mv.Aim.rayCylinder(m, u, g.position.x, g.position.z, this.aim.cfg.guardRadius, this.aim.cfg.guardHeight);
      if (d != null && d < best) { best = d; what = g.cfg.label; guard = g; kind = 'guard'; }
    }
    const hit = kind !== 'none';
    // blocked: it stopped at something clearly before the point the crosshair was on
    const blocked = hit && aimed.what !== 'nothing' && best < len - 0.05;
    return { hit, what, kind, guard, point: hit ? m.clone().addScaledVector(u, best) : null, dist: hit ? best : Infinity, muzzleBlocked: blocked, intended: aimed.what };
  };

  // the flash's glow faces the camera
  const _q = new THREE.Quaternion();
  mv.Pistol.prototype._face = function () {
    const glow = this.flash.userData.glow, camera = this.cam && this.cam.cam; if (!glow || !camera) return;
    this.flash.updateMatrixWorld(true); this.flash.getWorldQuaternion(_q).invert(); glow.quaternion.copy(_q.multiply(camera.quaternion));
  };

  mv.Pistol.prototype._feedback = function (shot) {
    const c = this.cfg;
    // muzzle flash (a different turn each shot)
    this.flash.rotation.z = Math.random() * Math.PI; this.flash.visible = true; this.flashT = c.flashTime; this.flashes++; this._face();
    // recoil: the pistol kicks in her hands (aim-pose.js reads pose.kick), the camera kicks a little
    this.kick = 1; this.kicks++;
    if (this.cam) this.cam.kick = (this.cam.kick || 0) + c.cameraKick * DEG;
    // impact puff: dust on a surface, a brighter spark on a guard
    if (shot.hit) {
      const p = this.puffs[this._next]; this._next = (this._next + 1) % this.puffs.length;
      p.position.copy(shot.point); p.material.color.setHex(shot.guard ? 0xffe08a : 0xbdb39a);
      p.userData.t = 0; p.userData.s = shot.guard ? 0.9 : 1; p.visible = true; p.scale.setScalar(0.6);
    }
    if (shot.guard && this.marker) { this.marker.classList.remove('hit'); void this.marker.offsetWidth; this.marker.classList.add('hit'); this.markerT = c.hitMarkerTime; }
    this._sound();
  };

  // a registered hit on a guard: no damage yet. A brief flinch over his own pose, counted
  mv.Pistol.prototype._guardHit = function (shot) {
    const g = shot.guard, c = this.cfg;
    g.shotHits = (g.shotHits || 0) + 1; g.lastShotHit = { point: shot.point.clone(), from: shot.muzzle.clone() };
    if (g.poseHook && !(g._flinch && g.poseHook === g._flinch.hook)) return;   // (something else is posing him)
    const f = g._flinch = { t: 0 }, side = Math.sign(new THREE.Vector3(Math.cos(g.yaw), 0, -Math.sin(g.yaw)).dot(shot.dir)) || 1;
    f.hook = () => {
      const k = Math.sin(Math.PI * Math.min(1, f.t / c.flinchTime)), b = g.bones && (g.bones.chest || g.bones.spine);
      if (!b || k <= 0) return;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), side * c.flinch * DEG * k);
      b.quaternion.multiply(q); b.updateMatrixWorld(true);
    };
    g.poseHook = f.hook;
  };

  // a temporary synthesized gunshot: a sharp crack, a low boom and a short tail
  mv.Pistol.prototype._sound = function () {
    this.sounds++;
    const a = this.audio, ctx = a && a.ctx; if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.003, v = this.cfg.volume, out = ctx.createGain(); out.gain.value = v; out.connect(a.out || ctx.destination);
    const noise = this._noise || (this._noise = (() => { const b = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate), d = b.getChannelData(0); let s = 7; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; } return b; })());
    const burst = (type, f, q, peak, decay, delay) => {
      const src = ctx.createBufferSource(); src.buffer = noise; const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + delay); g.gain.exponentialRampToValueAtTime(peak, t + delay + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + delay + decay);
      src.connect(flt); flt.connect(g); g.connect(out); src.start(t + delay); src.stop(t + delay + decay + 0.05);
    };
    burst('highpass', 1400, 0.7, 1.6, 0.09, 0);          // crack
    burst('lowpass', 900, 0.8, 0.9, 0.35, 0.004);        // body / tail
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.2, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.26);
  };

  // short status for the developer view
  mv.Pistol.prototype.status = function () {
    const why = this.check(), left = Math.max(0, this.cfg.interval - (this.clock - this.shotClock)), s = this.lastShot, xz = p => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;
    const head = `${why ? 'off: ' + why : left > 0 ? `cooldown ${left.toFixed(2)} s` : 'READY'} · shots ${this.shots}`;
    if (why === 'not aiming') return 'off';   // (just that while not aiming: the bar keeps its height; the details show while aiming)
    if (!s) return head;
    const res = s.guard ? `HIT ${s.guard.cfg.label.split(' —')[0]}` : s.hit ? `hit ${s.what}` : 'miss';
    return `${head} · last: ${res}${s.hit ? ` ${s.dist.toFixed(1)} m at ${xz(s.point)}` : ''} · muzzle ${s.muzzleBlocked ? `BLOCKED by ${s.guard ? 'him' : s.what} (crosshair on ${s.intended.split(' —')[0]})` : 'clear'} · L${s.noise.level} ${s.noise.radius.toFixed(0)} m, heard by ${s.heardBy.length ? s.heardBy.map(l => l.split(' —')[0]).join(', ') : 'nobody'}${this.dropped ? ` · ${this.dropped} presses dropped${this.why ? ' (' + this.why + ')' : ''}` : ''}`;
  };
})(SC.mv);
