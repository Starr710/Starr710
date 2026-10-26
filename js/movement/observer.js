// SHADOW CELL — Observation Mode (Step 24.2): a developer tool, not a player ability. The camera leaves her
// (she stays exactly where she was, hidden: no footsteps, nothing for a guard to see or shoot) and flies freely or
// follows one guard, while the level runs on as usual. It shows, for the selected guard only:
//   vision   his three zones as drawn by the real vision settings (faint outlines: where he COULD see), and over
//            the ground where a body there WOULD be seen, sampled through the same line-of-sight test his eyes use
//            (bright: seen standing or crouched; dim: seen standing only, so low cover hides a crouched body there;
//            nothing: hidden). The sampled area is an approximation of the real check (a few heights per cell,
//            not her posed body); her own current visibility is the real check itself
//   route    his waypoints in order, the way he walks them, stops with their pauses and facings, where he's
//            heading, and where he'll rejoin when his route is interrupted
//   sound    a test sound of an existing kind (footsteps L1 / L2, the magazine's clatter, a gunshot) at the
//            ground under the camera, through the normal noise system: the guards hear it as they hear anything
// It also keeps each guard's decision history (real state changes, a bounded log) and writes a plain-text report.
// Nothing it does changes what a guard knows, except a test sound, which he hears like any other.
(function (mv) {
  'use strict';

  mv.ObserverDefaults = {
    speed: 7, vertical: 4,           // m/s across (full stick) and up / down
    height: [0.4, 60],               // m: how low and high the camera may go
    margin: 12,                      // m it may stray outside a level's area
    follow: { distance: 7, height: 5, smoothing: 4 },
    vision: { stepDeg: 4, step: 0.75, hz: 3, stand: [1.6, 1.3, 1.0, 0.5], crouch: [0.8, 0.6, 0.4], need: 0.5 },
    history: 40,                     // decisions kept per guard
    previewHz: 10,
  };
  const D = Math.PI / 180, UP = new THREE.Vector3(0, 1, 0);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

  // o: { camera, scene, world, input, noise, guards() → the level's active guards, level() → { id, area }, sounds: [{ name, level, type }] }
  mv.Observer = function (o) {
    Object.assign(this, o); this.cfg = Object.assign({}, mv.ObserverDefaults, o.opts || {});
    this.active = false; this.mode = 'free'; this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = -0.5;
    this.sel = null; this.show = { vision: true, route: true, sound: true }; this.soundIdx = 2;
    this.vert = 0; this.orbit = 0; this.logs = new Map(); this.snap = new Map(); this.soundLog = []; this.lastTrigger = null;
    this.group = new THREE.Group(); this.group.name = 'observer'; this.group.visible = false; this.scene.add(this.group);
    this._build();
  };
  const O = mv.Observer.prototype;

  // ---------------------------------------------------------------- the drawings (made once, reused)
  O._build = function () {
    const g = this.group, flat = geo => geo.rotateX(-Math.PI / 2), mat = (c, op) => new THREE.MeshBasicMaterial({ color: lin(c), transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide });
    // sound preview: where TRIGGER SOUND would go
    this.preview = new THREE.Group();
    const pr = new THREE.Mesh(flat(new THREE.RingGeometry(0.35, 0.5, 32)), mat(0xffffff, 0.9)), pd = new THREE.Mesh(flat(new THREE.CircleGeometry(0.09, 12)), mat(0xffffff, 1));
    pr.renderOrder = pd.renderOrder = 4; this.preview.add(pr, pd); g.add(this.preview); this.previewAt = null; this._pt = 1;
    // vision: the cells (seen standing and crouched / standing only), the three zones' outlines, his facing
    const cells = 64 * 40;
    const vgeo = () => { const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cells * 18), 3)); b.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cells * 18), 3)); b.setDrawRange(0, 0); return b; };
    const vmat = op => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide });
    this.vFull = new THREE.Mesh(vgeo(), vmat(0.34)); this.vStand = new THREE.Mesh(vgeo(), vmat(0.14));
    this.vLines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 3), 3)), new THREE.LineBasicMaterial({ color: lin(0xf3eedb), transparent: true, opacity: 0.45 }));
    this.vLines.geometry.setDrawRange(0, 0);
    this.vFacing = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)), new THREE.LineBasicMaterial({ color: lin(0xffffff) }));
    this.vRay = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)), new THREE.LineBasicMaterial({ color: lin(0xff5546) }));
    for (const m of [this.vFull, this.vStand, this.vLines, this.vFacing, this.vRay]) { m.frustumCulled = false; m.renderOrder = 3; }
    this.vision = new THREE.Group(); this.vision.add(this.vFull, this.vStand, this.vLines, this.vFacing, this.vRay); g.add(this.vision);
    this.zoneCol = { fastest: [0xff5a3c, 1], normal: [0xffb23c, 1], slower: [0xffe58a, 1] };
    for (const k in this.zoneCol) this.zoneCol[k] = lin(this.zoneCol[k][0]);
    this._vt = 1; this.vstat = null;
    // route: the path, its direction marks, the stops, the facings, the target and the rejoin point
    this.rLine = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 3), 3)), new THREE.LineBasicMaterial({ color: lin(0x9fd0ff), transparent: true, opacity: 0.85 }));
    this.rLine.frustumCulled = false; this.rLine.renderOrder = 3;
    this.rMarks = []; for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(flat(new THREE.RingGeometry(0.22, 0.32, 20)), mat(0x9fd0ff, 0.8)); m.renderOrder = 3; m.visible = false; this.rMarks.push(m); }
    this.rTarget = new THREE.Mesh(flat(new THREE.RingGeometry(0.42, 0.56, 24)), mat(0x7dff6a, 0.95)); this.rTarget.renderOrder = 4;
    this.rRejoin = new THREE.Mesh(flat(new THREE.RingGeometry(0.42, 0.56, 24)), mat(0xffb23c, 0.95)); this.rRejoin.renderOrder = 4;
    this.route = new THREE.Group(); this.route.add(this.rLine, this.rTarget, this.rRejoin, ...this.rMarks); g.add(this.route);
    this.labels = []; this._routeFor = null;
  };

  // ---------------------------------------------------------------- entering, leaving
  O.enter = function () {
    const c = this.camera, d = c.getWorldDirection(new THREE.Vector3());
    this.pos.copy(c.position); this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(clamp(d.y, -1, 1));
    this.active = true; this.mode = 'free'; this.group.visible = true;
    const gs = this.guards(); if (!this.sel || gs.indexOf(this.sel) < 0) this.sel = gs[0] || null;
    this._routeFor = null; this._vt = 1;
  };
  O.exit = function () { this.active = false; this.group.visible = false; this.mode = 'free'; this.vert = 0; for (const l of this.labels) l.el.style.opacity = '0'; };

  // a useful look over the level (after RESET while observing)
  O.overview = function () {
    const a = this.level().area, s = a.spawn;
    if (this.level().id === 'lab') { this.pos.set(s.x, 18, s.z - 14); } else this.pos.set(0, 34, -26);
    this.yaw = Math.PI; this.pitch = -0.85; this.mode = 'free';
  };

  O.selectNext = function () {
    const gs = this.guards(); if (!gs.length) { this.sel = null; return null; }
    const i = gs.indexOf(this.sel); this.sel = gs[(i + 1) % gs.length]; this._routeFor = null; this._vt = 1;
    return this.sel;
  };
  O.toggleFollow = function () { this.mode = this.mode === 'follow' ? 'free' : 'follow'; if (this.mode === 'follow') this.orbit = 0; else { const d = this.camera.getWorldDirection(new THREE.Vector3()); this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(clamp(d.y, -1, 1)); } return this.mode; };

  // the level's area the camera may fly in
  O._clampPos = function () {
    const c = this.cfg, B = this.world.bounds, m = c.margin;
    let x0 = -22, x1 = 22, z0 = -22, z1 = 22;
    if (B) { x0 = Math.min(...B.map(p => p[0])); x1 = Math.max(...B.map(p => p[0])); z0 = Math.min(...B.map(p => p[1])); z1 = Math.max(...B.map(p => p[1])); }
    this.pos.x = clamp(this.pos.x, x0 - m, x1 + m); this.pos.z = clamp(this.pos.z, z0 - m, z1 + m); this.pos.y = clamp(this.pos.y, c.height[0], c.height[1]);
  };

  // per frame while observing: the camera (from the stick, the drag, UP / DOWN), then the drawings
  O.update = function (dt, sens) {
    const c = this.cfg, inp = this.input, cam = this.camera;
    const look = inp.look; const dx = look.dx, dy = look.dy; look.dx = look.dy = 0;
    if (this.sel && this.guards().indexOf(this.sel) < 0) { this.sel = this.guards()[0] || null; if (this.mode === 'follow' && !this.sel) this.mode = 'free'; }
    const keyV = (inp.keys.has('KeyR') || inp.keys.has('PageUp') ? 1 : 0) - (inp.keys.has('KeyV') || inp.keys.has('PageDown') ? 1 : 0);
    const v = clamp(this.vert + keyV, -1, 1);
    if (this.mode === 'follow' && this.sel) {
      const g = this.sel, f = c.follow;
      this.orbit = wrap(this.orbit - dx * sens); this.pitch = clamp(this.pitch + dy * sens * 0.8, -1.4, 0.2);
      const back = g.yaw + Math.PI + this.orbit, want = new THREE.Vector3(g.position.x + Math.sin(back) * f.distance, f.height + v * 0, g.position.z + Math.cos(back) * f.distance);
      want.y = Math.max(1.2, f.height + this.pitch * 3);
      this.pos.lerp(want, 1 - Math.exp(-f.smoothing * dt));
      this._clampPos(); cam.position.copy(this.pos); cam.lookAt(g.position.x, 1.2, g.position.z);
    } else {
      this.yaw = wrap(this.yaw - dx * sens); this.pitch = clamp(this.pitch + -dy * sens * 0.8, -1.5, 1.2);
      const mx = inp.move.x, my = inp.move.y, fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = -fz, rz = fx;
      this.pos.x += (fx * my + rx * mx) * c.speed * dt; this.pos.z += (fz * my + rz * mx) * c.speed * dt; this.pos.y += v * c.vertical * dt;
      this._clampPos(); cam.position.copy(this.pos);
      const cp = Math.cos(this.pitch); cam.lookAt(this.pos.x - Math.sin(this.yaw) * cp, this.pos.y + Math.sin(this.pitch), this.pos.z - Math.cos(this.yaw) * cp);
    }
    cam.updateMatrixWorld(true);
    // where a test sound would go, a few times a second
    if ((this._pt += dt) >= 1 / c.previewHz) { this._pt = 0; this.previewAt = this.groundBelow(); }
    this.preview.visible = !!this.previewAt && this.show.sound;
    if (this.previewAt) this.preview.position.set(this.previewAt.point.x, this.previewAt.point.y + 0.03, this.previewAt.point.z);
    // the selected guard's drawings
    this.vision.visible = !!this.sel && this.show.vision;
    if (this.vision.visible && (this._vt += dt) >= 1 / c.vision.hz) { this._vt = 0; const t0 = performance.now(); this.drawVision(this.sel); this.visionMs = performance.now() - t0; }
    this.route.visible = !!this.sel && this.show.route && !!(this.sel.patrol && this.sel.patrol.enabled);
    if (this.route.visible) this.drawRoute(this.sel);
  };

  // ---------------------------------------------------------------- the ground under the camera
  const _rc = new THREE.Raycaster();
  O.groundBelow = function () {
    const p = this.pos, W = this.world;
    if (W.bounds ? !W.inBounds(p.x, p.z, 0.3) : (Math.abs(p.x) > 21.7 || Math.abs(p.z) > 21.7)) return null;   // (outside the level: no ground to make a sound on)
    _rc.set(new THREE.Vector3(p.x, p.y + 0.5, p.z), new THREE.Vector3(0, -1, 0)); _rc.far = p.y + 2;
    const h = _rc.intersectObjects(W.meshes, false)[0];
    if (h && h.point.y > 0.02) return { point: h.point.clone(), surface: 'concrete', on: h.object.userData.kind || 'solid' };   // (on top of something: a hard surface)
    return { point: new THREE.Vector3(p.x, 0, p.z), surface: W.surfaceAt(p.x, p.z), on: 'ground' };
  };

  // TRIGGER SOUND: one event of the selected kind there, through the noise system
  O.trigger = function () {
    const s = this.sounds[this.soundIdx], at = this.groundBelow();
    if (!at) { this.lastTrigger = { ok: false, why: 'no ground under the camera (outside the level)' }; return this.lastTrigger; }
    const ev = this.noise.emit(s.level, s.type, at.point, at.surface, 'observer test');
    const guards = this.guards().map(g => { const L = g.hearing && g.hearing.last, mine = L && L.type === ev.type && L.position.x === ev.position.x && L.position.z === ev.position.z;
      return { key: keyOf(g), heard: !!(mine && L.heard), why: !mine ? 'not evaluated' : L.heard ? '' : L.why ? L.why : `out of earshot (${L.distance.toFixed(1)} / ${L.reach.toFixed(1)} m)`, distance: mine ? L.distance : null }; });
    const rec = { ok: true, why: '', name: s.name, ev, on: at.on, guards, t: this.clock() };
    this.lastTrigger = rec; this.soundLog = [rec].concat(this.soundLog || []).slice(0, 6);
    return rec;
  };
  O.clock = function () { const g = this.guards()[0]; return g && g.awareness ? g.awareness.clock : 0; };
  const keyOf = g => g.levelKey || (g.cfg.label || '').split(' —')[0].replace('Guard ', '');

  // ---------------------------------------------------------------- vision: theoretical zones and sampled effective sight
  // a body at (x, z) seen by the guard's eye: { standing, crouched } through the real line-of-sight test, the real zones and range
  O.sightAt = function (g, x, z) {
    const V = this.cfg.vision, eye = g.eye(new THREE.Vector3()), W = g.world, P = new THREE.Vector3();
    const count = hs => { let n = 0; for (const h of hs) { P.set(x, h, z); if (!W.segmentBlocked(eye, P)) n++; } return n / hs.length; };
    return { standing: count(V.stand) >= V.need, crouched: count(V.crouch) >= V.need };
  };
  O.drawVision = function (g) {
    const V = this.cfg.vision, vis = g.vision, range = vis.range(), eye = g.eye(new THREE.Vector3()), W = g.world;
    const zones = vis.cfg.zones.slice().sort((a, b) => a.angle - b.angle), half = zones[zones.length - 1].angle / 2;
    const fy = g.yaw, rays = Math.round(2 * half / V.stepDeg) + 1, steps = Math.min(40, Math.ceil(range / V.step));
    const fp = this.vFull.geometry.attributes.position.array, fc = this.vFull.geometry.attributes.color.array, sp = this.vStand.geometry.attributes.position.array, sc = this.vStand.geometry.attributes.color.array;
    let nf = 0, ns = 0, cells = 0, hidden = 0, standOnly = 0;
    const P = new THREE.Vector3(), y = 0.05;
    // per ray, per distance step: the state of a body at that cell's middle
    const state = [];
    for (let i = 0; i < rays; i++) {
      const a = fy + (-half + i * V.stepDeg) * D, ca = Math.cos(a), sa = Math.sin(a), col = [];
      for (let j = 0; j < steps; j++) {
        const d = (j + 0.5) * V.step, x = g.position.x + sa * d, z = g.position.z + ca * d;
        if (W.bounds && !W.inBounds(x, z, 0)) { col.push(0); continue; }
        let st = 0, ns2 = 0, nc = 0;
        for (const h of V.stand) { P.set(x, h, z); if (!W.segmentBlocked(eye, P)) ns2++; }
        for (const h of V.crouch) { P.set(x, h, z); if (!W.segmentBlocked(eye, P)) nc++; }
        if (ns2 / V.stand.length >= V.need) st = nc / V.crouch.length >= V.need ? 2 : 1;
        col.push(st);
      }
      state.push(col);
    }
    const put = (arr, carr, n, pts, c) => { for (let k = 0; k < 6; k++) { const q = pts[k]; arr[(n * 6 + k) * 3] = q[0]; arr[(n * 6 + k) * 3 + 1] = y; arr[(n * 6 + k) * 3 + 2] = q[1]; carr[(n * 6 + k) * 3] = c.r; carr[(n * 6 + k) * 3 + 1] = c.g; carr[(n * 6 + k) * 3 + 2] = c.b; } };
    for (let i = 0; i < rays - 1; i++) {
      const a0 = fy + (-half + i * V.stepDeg) * D, a1 = a0 + V.stepDeg * D, mid = Math.abs(-half + (i + 0.5) * V.stepDeg);
      const zone = zones.find(zz => mid <= zz.angle / 2) || zones[zones.length - 1], c = this.zoneCol[zone.id];
      for (let j = 0; j < steps; j++) {
        const st = Math.min(state[i][j], state[i + 1][j]); cells++;
        if (!st) { hidden++; continue; }
        const r0 = j * V.step, r1 = Math.min(range, (j + 1) * V.step), X = (a, r) => [g.position.x + Math.sin(a) * r, g.position.z + Math.cos(a) * r];
        const A = X(a0, r0), B = X(a1, r0), C = X(a1, r1), E = X(a0, r1), quad = [A, B, C, A, C, E];
        if (st === 2) put(fp, fc, nf++, quad, c); else { put(sp, sc, ns++, quad, c); standOnly++; }
      }
    }
    this.vFull.geometry.setDrawRange(0, nf * 6); this.vFull.geometry.attributes.position.needsUpdate = this.vFull.geometry.attributes.color.needsUpdate = true;
    this.vStand.geometry.setDrawRange(0, ns * 6); this.vStand.geometry.attributes.position.needsUpdate = this.vStand.geometry.attributes.color.needsUpdate = true;
    // the theoretical zones: their edges out to his range and their arcs (faint)
    const lp = this.vLines.geometry.attributes.position.array; let nl = 0;
    const seg = (x0, z0, x1, z1) => { lp[nl++] = x0; lp[nl++] = y + 0.01; lp[nl++] = z0; lp[nl++] = x1; lp[nl++] = y + 0.01; lp[nl++] = z1; };
    for (const zz of zones) {
      const h = zz.angle / 2 * D;
      for (const s of [-1, 1]) seg(g.position.x, g.position.z, g.position.x + Math.sin(fy + s * h) * range, g.position.z + Math.cos(fy + s * h) * range);
      const n = Math.max(4, Math.round(zz.angle / 6));
      for (let k = 0; k < n; k++) { const a0 = fy - h + 2 * h * k / n, a1 = fy - h + 2 * h * (k + 1) / n; seg(g.position.x + Math.sin(a0) * range, g.position.z + Math.cos(a0) * range, g.position.x + Math.sin(a1) * range, g.position.z + Math.cos(a1) * range); }
    }
    this.vLines.geometry.setDrawRange(0, nl / 3); this.vLines.geometry.attributes.position.needsUpdate = true;
    const fa = this.vFacing.geometry.attributes.position.array; fa[0] = g.position.x; fa[1] = 0.1; fa[2] = g.position.z; fa[3] = g.position.x + Math.sin(fy) * 2.5; fa[4] = 0.1; fa[5] = g.position.z + Math.cos(fy) * 2.5; this.vFacing.geometry.attributes.position.needsUpdate = true;
    this.vstat = { cells, hidden, standOnly, seen: cells - hidden, rays, steps, range };
  };
  // the red line: his eye to her (when she's in his range and cone), to what blocks it if something does
  O.drawSightRay = function (g, target) {
    const s = g.vision.seen, a = this.vRay.geometry.attributes.position.array, eye = g.eye(new THREE.Vector3());
    if (!target || !s.zone) { this.vRay.visible = false; return; }
    const c = target.centre(new THREE.Vector3()); a[0] = eye.x; a[1] = eye.y; a[2] = eye.z; a[3] = c.x; a[4] = c.y; a[5] = c.z;
    this.vRay.material.color.copy(lin(s.rate > 0 ? 0xff5546 : 0x8f8f8f)); this.vRay.visible = true; this.vRay.geometry.attributes.position.needsUpdate = true;
  };

  // ---------------------------------------------------------------- the route
  O.drawRoute = function (g) {
    const p = g.patrol, pts = p.cfg.points, lp = this.rLine.geometry.attributes.position.array; let n = 0;
    const seg = (a, b) => { lp[n++] = a.x; lp[n++] = 0.06; lp[n++] = a.z; lp[n++] = b.x; lp[n++] = 0.06; lp[n++] = b.z; };
    const legs = []; for (let i = 0; i < pts.length; i++) { const j = p.cfg.loop || i < pts.length - 1 ? (pts[i].next != null ? pts[i].next : (i + 1) % pts.length) : null; if (j != null && !(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < 0.1)) legs.push([pts[i], pts[j]]); }
    for (const [a, b] of legs) {
      seg(a, b);
      // a direction mark (a small arrowhead) at each leg's middle
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, ang = Math.atan2(b.x - a.x, b.z - a.z);
      for (const s of [-1, 1]) seg({ x: mx, z: mz }, { x: mx - Math.sin(ang + s * 0.5) * 0.6, z: mz - Math.cos(ang + s * 0.5) * 0.6 });
    }
    // each stop's facing
    pts.forEach(q => { if (q.pause && q.face != null) { const a = q.face * D; seg(q, { x: q.x + Math.sin(a) * 1.6, z: q.z + Math.cos(a) * 1.6 }); } });
    this.rLine.geometry.setDrawRange(0, n / 3); this.rLine.geometry.attributes.position.needsUpdate = true;
    this.rMarks.forEach((m, i) => { const q = pts[i]; m.visible = !!q; if (q) { m.position.set(q.x, 0.05, q.z); m.scale.setScalar(q.pause ? 1.3 : 0.6); } });
    const tgt = p.state === 'interrupted' ? null : pts[p.index], rj = p.state === 'interrupted' ? pts[p.resumeIndex != null ? p.resumeIndex : p.index] : null;
    this.rTarget.visible = !!tgt; if (tgt) this.rTarget.position.set(tgt.x, 0.07, tgt.z);
    this.rRejoin.visible = !!rj; if (rj) this.rRejoin.position.set(rj.x, 0.07, rj.z);
  };
  // the waypoints' labels (screen space): number, pause, facing; a lookout's facings in one label
  O.routeLabels = function (g) {
    const p = g.patrol, pts = p && p.enabled ? p.cfg.points : [], same = pts.length > 1 && pts.every(q => Math.hypot(q.x - pts[0].x, q.z - pts[0].z) < 0.1);
    const items = same ? [{ q: pts[0], text: `LOOKOUT · faces ${pts.map((q, i) => (i === p.index && p.state !== 'interrupted' ? '[' : '') + q.face + '°' + (i === p.index && p.state !== 'interrupted' ? ']' : '')).join(' → ')} · ${pts[0].pause.join('–')} s each` }]
      : pts.map((q, i) => ({ q, text: `W${i}${q.pause ? ` · stop ${q.pause.join('–')} s · faces ${q.face}°` : ''}${i === p.index && p.state !== 'interrupted' ? ' ◀ NEXT' : ''}${p.state === 'interrupted' && i === p.resumeIndex ? ' ◀ REJOIN' : ''}` }));
    return items;
  };

  // ---------------------------------------------------------------- decision history (real changes only)
  O.watch = function (guards) {
    for (const g of guards) {
      const a = g.awareness, p = g.patrol, h = g.hearing, v = g.vision, w = g.weapon;
      const now = { state: a.state, beh: a.behavior, pi: p ? p.index : null, ps: p ? p.state : null, rj: p ? p.rejoining : false, heard: h ? h.heardCount : 0, seeing: v.seen.rate > 0, conf: a.confirmed, ko: g.ko ? g.ko.state : 'CONSCIOUS', wpn: w ? w.state : null };
      const was = this.snap.get(g); this.snap.set(g, now);
      if (!was) continue;
      const log = e => { let L = this.logs.get(g); if (!L) this.logs.set(g, L = []); L.push({ t: a.clock, e }); if (L.length > this.cfg.history) L.shift(); };
      if (now.ko !== was.ko) log(now.ko === 'CONSCIOUS' ? 'Back on his feet' : now.ko === 'DEAD' ? 'Defeated (gunfire)' : now.ko === 'UNCONSCIOUS' ? 'Unconscious' : now.ko === 'THROWN' ? 'Thrown' : now.ko);
      if (now.heard !== was.heard && h.heard) log(`Heard L${h.heard.level} ${h.heard.type} (${h.heard.surface}) ${h.heard.distance.toFixed(1)} m away`);
      if (now.seeing !== was.seeing) log(now.seeing ? `Sees her (${v.seen.zone}, ${Math.round(v.seen.exposure * 100)}% of her showing)` : 'Lost sight of her');
      if (now.conf && !was.conf) log('Confirmed: it\'s an intruder');
      if (now.state !== was.state) log(`Entered ${now.state}${a.note ? ' — ' + a.note : ''}`);
      else if (now.beh !== was.beh && now.beh) log(`Now ${now.beh}`);
      if (p && p.enabled) {
        if (now.ps !== was.ps) {
          if (now.ps === 'interrupted') log(`Patrol interrupted (${p.why || now.state.toLowerCase()}); will rejoin at W${p.resumeIndex}`);
          else if (now.ps === 'observing') log(`Reached W${p.index}: observing${p.obs ? ` (${p.obs.total.toFixed(1)} s)` : ''}`);
          else if (now.ps === 'turning' || now.ps === 'walking') { if (was.ps === 'observing' || was.ps === 'interrupted') log(`${now.rj ? 'Returning to route' : 'Moving on'} → W${p.index}`); }
        } else if (now.pi !== was.pi && now.ps === 'walking') log(`Passing on → W${p.index}`);
        else if (now.pi !== was.pi && now.ps === 'observing') log(`Turned to W${p.index}: observing${p.obs ? ` (${p.obs.total.toFixed(1)} s)` : ''}`);
      }
      if (now.wpn !== was.wpn && now.wpn) log(`Pistol ${now.wpn}`);
    }
  };
  O.history = function (g) { return this.logs.get(g) || []; };
  O.clearHistory = function () { this.logs.clear(); this.snap.clear(); this.soundLog = []; this.lastTrigger = null; };
})(SC.mv);
