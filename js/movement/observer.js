// SHADOW CELL — Observation Mode (Step 24.2): a developer tool, not a player ability. The camera leaves her
// (she stays exactly where she was, hidden: no footsteps, nothing for a guard to see or shoot) and flies freely or
// follows one guard, while the level runs on as usual. It shows, for the selected guard only:
//   vision   his three zones as drawn by the real vision settings (faint outlines, one colour per zone: where he
//            COULD see), and over the ground where a body there WOULD be seen, sampled through the same line-of-sight
//            test his eyes use (a strong fill: seen standing or crouched; a weaker one: seen standing only, so low
//            cover hides a crouched body there; nothing: hidden), with a white edge round what he can see. The sampled
//            area is an approximation of the real check (a few heights per cell, not her posed body); her own current
//            visibility is the real check itself
//   route    his waypoints in order, the way he walks them (a thick line with arrowheads), numbered, stops with their
//            pauses and facings, where he's heading, and where he'll rejoin when his route is interrupted
//   sound    a test sound of an existing kind (footsteps L1 / L2, the magazine's clatter, a gunshot) at the
//            ground under the camera, through the normal noise system: the guards hear it as they hear anything
// It also keeps each guard's decision history (real state changes, a bounded log) and writes a plain-text report.
// Nothing it does changes what a guard knows, except a test sound, which he hears like any other.
// (Forest cleanup: the overlays are flat ribbons, not GL lines, which are always 1 px; the zone colours are distinct
// from the ground; the route is magenta, nothing else in the forest is)
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
    // the drawings: widths in m, heights above the ground (the trails sit at 4 mm, the slab at 8 mm)
    draw: { y: 0.05, edge: 0.22, outline: 0.12, route: 0.2, facing: 0.14, labelRange: 48 },
  };
  const D = Math.PI / 180, UP = new THREE.Vector3(0, 1, 0);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  // a thick ground line (a flat quad `w` m wide from a to b: 6 vertices), a triangle, an arrowhead pointing along `ang`
  const rib = (arr, n, ax, az, bx, bz, w, y) => {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, nx = -dz / L * w / 2, nz = dx / L * w / 2;
    const v = [ax + nx, az + nz, ax - nx, az - nz, bx - nx, bz - nz, ax + nx, az + nz, bx - nx, bz - nz, bx + nx, bz + nz];
    for (let k = 0; k < 6; k++) { arr[n++] = v[k * 2]; arr[n++] = y; arr[n++] = v[k * 2 + 1]; }
    return n;
  };
  const tri = (arr, n, pts, y) => { for (const [x, z] of pts) { arr[n++] = x; arr[n++] = y; arr[n++] = z; } return n; };
  const head = (arr, n, x, z, ang, len, y) => tri(arr, n, [[x, z], [x - Math.sin(ang + 0.5) * len, z - Math.cos(ang + 0.5) * len], [x - Math.sin(ang - 0.5) * len, z - Math.cos(ang - 0.5) * len]], y);
  const paint = (carr, from, to, c) => { for (let k = from; k < to; k += 3) { carr[k] = c.r; carr[k + 1] = c.g; carr[k + 2] = c.b; } };
  const geo = (verts, colours) => { const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3)); if (colours) b.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3)); b.setDrawRange(0, 0); return b; };
  const flush = (m, verts) => { const g = m.geometry; g.setDrawRange(0, verts); g.attributes.position.needsUpdate = true; if (g.attributes.color) g.attributes.color.needsUpdate = true; };

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
    const vmat = op => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide });
    const mesh = (gm, m, order) => { const x = new THREE.Mesh(gm, m); x.frustumCulled = false; x.renderOrder = order; return x; };
    // sound preview: where TRIGGER SOUND would go
    this.preview = new THREE.Group();
    const pr = new THREE.Mesh(flat(new THREE.RingGeometry(0.35, 0.5, 32)), mat(0xffffff, 0.9)), pd = new THREE.Mesh(flat(new THREE.CircleGeometry(0.09, 12)), mat(0xffffff, 1));
    pr.renderOrder = pd.renderOrder = 4; this.preview.add(pr, pd); g.add(this.preview); this.previewAt = null; this._pt = 1;
    // vision: the cells (seen standing and crouched / standing only) in their zone's colour, the white edge of what's seen,
    // the three zones' outlines (faint, each its zone's colour), his facing (a white arrow)
    const cells = 64 * 40;
    this.vFull = mesh(geo(cells * 6, true), vmat(0.46), 3); this.vStand = mesh(geo(cells * 6, true), vmat(0.22), 3);
    this.vEdge = mesh(geo(2400 * 6, false), mat(0xffffff, 0.95), 4);
    this.vLines = mesh(geo(400 * 6, true), vmat(0.6), 3);
    this.vFacing = mesh(geo(9, false), mat(0xffffff, 0.95), 4); this.vFacing.userData = { from: [0, 0], to: [0, 0] };
    this.vRay = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)), new THREE.LineBasicMaterial({ color: lin(0xff5546) }));
    this.vRay.frustumCulled = false; this.vRay.renderOrder = 4;
    this.vision = new THREE.Group(); this.vision.add(this.vFull, this.vStand, this.vEdge, this.vLines, this.vFacing, this.vRay); g.add(this.vision);
    // (debug colours, distinct from one another and from grass, dirt, rock and concrete: fastest red, normal yellow, slower cyan)
    this.zoneCol = { fastest: 0xff3b2f, normal: 0xffd23c, slower: 0x29e3ff };
    for (const k in this.zoneCol) this.zoneCol[k] = lin(this.zoneCol[k]);
    this._vt = 1; this.vstat = null;
    // route: the path (legs with arrowheads), the stops' facings, the waypoint rings, the target and the rejoin point
    this.routeCol = lin(0xff4fd8); this.targetCol = lin(0x7dff6a); this.rejoinCol = lin(0xffb23c);
    this.rLine = mesh(geo(400 * 6, true), vmat(0.92), 3);
    this.rHeads = mesh(geo(80 * 3, true), vmat(0.95), 4);
    this.rMarks = []; for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(flat(new THREE.RingGeometry(0.3, 0.44, 24)), mat(0xff4fd8, 0.9)); m.renderOrder = 3; m.visible = false; this.rMarks.push(m); }
    this.rTarget = new THREE.Mesh(flat(new THREE.RingGeometry(0.5, 0.7, 28)), mat(0x7dff6a, 0.95)); this.rTarget.renderOrder = 4;
    this.rRejoin = new THREE.Mesh(flat(new THREE.RingGeometry(0.5, 0.7, 28)), mat(0xffb23c, 0.95)); this.rRejoin.renderOrder = 4;
    this.route = new THREE.Group(); this.route.add(this.rLine, this.rHeads, this.rTarget, this.rRejoin, ...this.rMarks); g.add(this.route);
    this._routeFor = null;
  };

  // ---------------------------------------------------------------- entering, leaving
  O.enter = function () {
    const c = this.camera, d = c.getWorldDirection(new THREE.Vector3());
    this.pos.copy(c.position); this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(clamp(d.y, -1, 1));
    this.active = true; this.mode = 'free'; this.group.visible = true;
    const gs = this.guards(); if (!this.sel || gs.indexOf(this.sel) < 0) this.sel = gs[0] || null;
    this._routeFor = null; this._vt = 1;
  };
  // (the world drawings go with the group; the page's labels are the page's to hide)
  O.exit = function () { this.active = false; this.group.visible = false; this.mode = 'free'; this.vert = 0; };

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
    // the selected guard's drawings (nothing is computed for an overlay that's off)
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
    const V = this.cfg.vision, DR = this.cfg.draw, vis = g.vision, range = vis.range(), eye = g.eye(new THREE.Vector3()), W = g.world;
    const zones = vis.cfg.zones.slice().sort((a, b) => a.angle - b.angle), half = zones[zones.length - 1].angle / 2;
    const fy = g.yaw, rays = Math.round(2 * half / V.stepDeg) + 1, steps = Math.min(40, Math.ceil(range / V.step));
    const fp = this.vFull.geometry.attributes.position.array, fc = this.vFull.geometry.attributes.color.array, sp = this.vStand.geometry.attributes.position.array, sc = this.vStand.geometry.attributes.color.array;
    let nf = 0, ns = 0, cells = 0, hidden = 0, standOnly = 0;
    const P = new THREE.Vector3(), y = DR.y, gx = g.position.x, gz = g.position.z;
    // per ray, per distance step: the state of a body at that cell's middle (0 hidden, 1 seen standing only, 2 seen either way)
    const state = [];
    for (let i = 0; i < rays; i++) {
      const a = fy + (-half + i * V.stepDeg) * D, ca = Math.cos(a), sa = Math.sin(a), col = [];
      for (let j = 0; j < steps; j++) {
        const d = (j + 0.5) * V.step, x = gx + sa * d, z = gz + ca * d;
        if (W.bounds && !W.inBounds(x, z, 0)) { col.push(0); continue; }
        let st = 0, ns2 = 0, nc = 0;
        for (const h of V.stand) { P.set(x, h, z); if (!W.segmentBlocked(eye, P)) ns2++; }
        for (const h of V.crouch) { P.set(x, h, z); if (!W.segmentBlocked(eye, P)) nc++; }
        if (ns2 / V.stand.length >= V.need) st = nc / V.crouch.length >= V.need ? 2 : 1;
        col.push(st);
      }
      state.push(col);
    }
    // a column (between rays i and i + 1) is seen only where both its rays are
    const cell = (i, j) => (i < 0 || i >= rays - 1 || j < 0 || j >= steps) ? 0 : Math.min(state[i][j], state[i + 1][j]);
    const X = (a, r) => [gx + Math.sin(a) * r, gz + Math.cos(a) * r];
    const put = (arr, carr, n, pts, c) => { for (let k = 0; k < 6; k++) { const q = pts[k]; arr[(n * 6 + k) * 3] = q[0]; arr[(n * 6 + k) * 3 + 1] = y; arr[(n * 6 + k) * 3 + 2] = q[1]; carr[(n * 6 + k) * 3] = c.r; carr[(n * 6 + k) * 3 + 1] = c.g; carr[(n * 6 + k) * 3 + 2] = c.b; } };
    // the white edge of what he sees: each seen cell's sides that face a hidden cell (or the cone's or the range's end)
    const ep = this.vEdge.geometry.attributes.position.array; let ne = 0;
    const edge = (A, B) => { if (ne + 18 <= ep.length) ne = rib(ep, ne, A[0], A[1], B[0], B[1], DR.edge, y + 0.012); };
    for (let i = 0; i < rays - 1; i++) {
      const a0 = fy + (-half + i * V.stepDeg) * D, a1 = a0 + V.stepDeg * D, mid = Math.abs(-half + (i + 0.5) * V.stepDeg);
      const zone = zones.find(zz => mid <= zz.angle / 2) || zones[zones.length - 1], c = this.zoneCol[zone.id];
      for (let j = 0; j < steps; j++) {
        const st = cell(i, j); cells++;
        if (!st) { hidden++; continue; }
        const r0 = j * V.step, r1 = Math.min(range, (j + 1) * V.step);
        const A = X(a0, r0), B = X(a1, r0), C = X(a1, r1), E = X(a0, r1), quad = [A, B, C, A, C, E];
        if (st === 2) put(fp, fc, nf++, quad, c); else { put(sp, sc, ns++, quad, c); standOnly++; }
        if (!cell(i, j + 1)) edge(E, C);        // beyond it: hidden, or his range
        if (!cell(i, j - 1)) edge(A, B);        // before it: hidden (sight resuming past something)
        if (!cell(i - 1, j)) edge(A, E);        // the column beside it
        if (!cell(i + 1, j)) edge(B, C);
      }
    }
    flush(this.vFull, nf * 6); flush(this.vStand, ns * 6); flush(this.vEdge, ne / 3);
    // the theoretical zones: their edges out to his range and their arcs, faint, each in its zone's colour
    const lp = this.vLines.geometry.attributes.position.array, lc = this.vLines.geometry.attributes.color.array; let nl = 0;
    const seg = (x0, z0, x1, z1, c) => { if (nl + 18 > lp.length) return; const from = nl; nl = rib(lp, nl, x0, z0, x1, z1, DR.outline, y + 0.006); paint(lc, from, nl, c); };
    for (const zz of zones) {
      const h = zz.angle / 2 * D, c = this.zoneCol[zz.id];
      for (const s of [-1, 1]) seg(gx, gz, gx + Math.sin(fy + s * h) * range, gz + Math.cos(fy + s * h) * range, c);
      const n = Math.max(6, Math.round(zz.angle / 4));
      for (let k = 0; k < n; k++) { const a0 = fy - h + 2 * h * k / n, a1 = fy - h + 2 * h * (k + 1) / n; seg(gx + Math.sin(a0) * range, gz + Math.cos(a0) * range, gx + Math.sin(a1) * range, gz + Math.cos(a1) * range, c); }
    }
    flush(this.vLines, nl / 3);
    // his facing: a white arrow 2.5 m long
    const fa = this.vFacing.geometry.attributes.position.array, tx = gx + Math.sin(fy) * 2.5, tz = gz + Math.cos(fy) * 2.5;
    let nfa = rib(fa, 0, gx, gz, gx + Math.sin(fy) * 2.0, gz + Math.cos(fy) * 2.0, DR.route, y + 0.02); nfa = head(fa, nfa, tx, tz, fy, 0.7, y + 0.02);
    flush(this.vFacing, nfa / 3); this.vFacing.userData.from = [gx, gz]; this.vFacing.userData.to = [tx, tz];
    this.vstat = { cells, hidden, standOnly, seen: cells - hidden, rays, steps, range, edges: ne / 18 };
  };
  // the red line: his eye to her (when she's in his range and cone), to what blocks it if something does
  O.drawSightRay = function (g, target) {
    const s = g.vision.seen, a = this.vRay.geometry.attributes.position.array, eye = g.eye(new THREE.Vector3());
    if (!target || !s.zone) { this.vRay.visible = false; return; }
    const c = target.centre(new THREE.Vector3()); a[0] = eye.x; a[1] = eye.y; a[2] = eye.z; a[3] = c.x; a[4] = c.y; a[5] = c.z;
    this.vRay.material.color.copy(lin(s.rate > 0 ? 0xff5546 : 0x8f8f8f)); this.vRay.visible = true; this.vRay.geometry.attributes.position.needsUpdate = true;
  };

  // ---------------------------------------------------------------- the route
  // a lookout's route: every waypoint at his post (he only turns from one facing to the next)
  const atPost = pts => pts.length > 1 && pts.every(q => Math.hypot(q.x - pts[0].x, q.z - pts[0].z) < 0.1);
  O.drawRoute = function (g) {
    const p = g.patrol, pts = p.cfg.points, DR = this.cfg.draw, y = DR.y + 0.03, same = atPost(pts);
    const lp = this.rLine.geometry.attributes.position.array, lc = this.rLine.geometry.attributes.color.array; let n = 0;
    const hp = this.rHeads.geometry.attributes.position.array, hc = this.rHeads.geometry.attributes.color.array; let nh = 0;
    const line = (a, b, w, c) => { if (n + 18 > lp.length) return; const from = n; n = rib(lp, n, a.x, a.z, b.x, b.z, w, y); paint(lc, from, n, c); };
    const arrow = (x, z, ang, len, c) => { if (nh + 9 > hp.length) return; const from = nh; nh = head(hp, nh, x, z, ang, len, y + 0.01); paint(hc, from, nh, c); };
    const cur = p.state === 'interrupted' ? -1 : p.index, rj = p.state === 'interrupted' ? (p.resumeIndex != null ? p.resumeIndex : p.index) : -1;
    if (!same) {
      // the legs, the way he walks them: a thick line with an arrowhead at each leg's middle (two on a long leg)
      const legs = []; for (let i = 0; i < pts.length; i++) { const j = p.cfg.loop || i < pts.length - 1 ? (pts[i].next != null ? pts[i].next : (i + 1) % pts.length) : null; if (j != null && !(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < 0.1)) legs.push([pts[i], pts[j]]); }
      for (const [a, b] of legs) {
        line(a, b, DR.route, this.routeCol);
        const len = Math.hypot(b.x - a.x, b.z - a.z), ang = Math.atan2(b.x - a.x, b.z - a.z);
        for (const t of len > 10 ? [0.3, 0.7] : [0.5]) arrow(a.x + (b.x - a.x) * t + Math.sin(ang) * 0.45, a.z + (b.z - a.z) * t + Math.cos(ang) * 0.45, ang, 0.9, this.routeCol);
      }
    }
    // each stop's facing: an arrow (a lookout's facings fan out from his post); the one he's at or heading for in the target's colour
    pts.forEach((q, i) => {
      if (!(q.pause && q.face != null)) return;
      const a = q.face * D, c = i === cur ? this.targetCol : this.routeCol, len = same ? 2.4 : 1.6;
      line(q, { x: q.x + Math.sin(a) * (len - 0.4), z: q.z + Math.cos(a) * (len - 0.4) }, DR.facing, c);
      arrow(q.x + Math.sin(a) * len, q.z + Math.cos(a) * len, a, 0.5, c);
    });
    flush(this.rLine, n / 3); flush(this.rHeads, nh / 3);
    // the waypoints: a ring each (bigger at a stop; one for a post), the target and the rejoin point
    this.rMarks.forEach((m, i) => { const q = pts[i]; m.visible = !!q && (!same || i === 0); if (q) { m.position.set(q.x, y - 0.01, q.z); m.scale.setScalar(q.pause ? 1.3 : 0.8); } });
    const tgt = cur >= 0 ? pts[cur] : null, rjp = rj >= 0 ? pts[rj] : null;
    this.rTarget.visible = !!tgt; if (tgt) this.rTarget.position.set(tgt.x, y + 0.01, tgt.z);
    this.rRejoin.visible = !!rjp; if (rjp) this.rRejoin.position.set(rjp.x, y + 0.01, rjp.z);
  };
  // the waypoints' labels (screen space, compact, one per waypoint): its number, a stop's pause and facing, a mark on the
  // one he's heading for or will rejoin. A lookout gets one label at his post (his facing sequence is in the PATROL section)
  O.routeLabels = function (g) {
    const p = g.patrol, pts = p && p.enabled ? p.cfg.points : [];
    const cur = p && p.state !== 'interrupted' ? p.index : -1, rj = p && p.state === 'interrupted' ? (p.resumeIndex != null ? p.resumeIndex : p.index) : -1;
    if (atPost(pts)) return [{ q: pts[0], text: `POST · ${pts.length} facings · ${pts[0].pause.join('–')} s${cur >= 0 ? ` · now ${pts[cur].face}°` : ''}`, cur: false, rejoin: rj >= 0 }];
    return pts.map((q, i) => ({ q, text: `W${i}${q.pause ? ` · stop ${q.pause.join('–')} s · ${q.face}°` : ''}${i === cur ? ' ◀' : i === rj ? ' ◀ rejoin' : ''}`, cur: i === cur, rejoin: i === rj }));
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
