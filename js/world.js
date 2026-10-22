// SHADOW CELL — Mission 01 "Jungle Outpost" map.
// Builds terrain, vegetation, the fenced compound, towers, and exposes
// collision + concealment queries used by the player (and later by guard AI).
(function (SC) {
  'use strict';

  const W = {
    size: 200,          // playable square, -100..100
    bound: 94,          // player clamp
    boxes: [],          // AABB colliders {minX,maxX,minZ,maxZ,h,tag}
    circles: [],        // circle colliders {x,z,r,h}
    occluders: [],      // meshes the camera must not pass through
    roofs: [],          // {mesh, minX,maxX,minZ,maxZ} hidden while player is inside
    lamps: [],          // {x,z,r} lit areas raise visibility
    towers: [],         // watchtower platform positions (for Phase 2 guards)
    posts: [],          // guard post positions
    poi: {},            // named points of interest (radio, intel, extraction...)
  };
  SC.world = W;

  // ---------------------------------------------------------------- layout
  const COMPOUND = { minX: -30, maxX: 30, minZ: -42, maxZ: 12 };
  W.compound = COMPOUND;
  W.trails = [
    [[0, 97], [2, 72], [-3, 46], [0, 26], [0, 12], [0, -8]],                                   // main road → south gate
    [[-2, 62], [-24, 52], [-48, 40], [-56, 12], [-46, -17], [-30, -17], [-18, -17]],            // west trail → breach
    [[2, 72], [30, 62], [54, 42], [64, 10], [61, -30], [64, -70]],                              // east trail → extraction
    [[20, -40], [20, -54], [44, -62], [64, -70]],                                               // NE fence hole → extraction
  ];
  W.clearings = [
    { x: 0, z: 88, r: 7 },     // insertion
    { x: 64, z: -72, r: 10 },  // extraction LZ
    { x: -50, z: 38, r: 6 },   // west guard post
    { x: 52, z: 44, r: 6 },    // east guard post
    { x: 40, z: -12, r: 4 },   // jungle tower
  ];
  W.poi.insertion = { x: 0, z: 88 };
  W.poi.extraction = { x: 64, z: -72, r: 7 };

  function compoundDist(x, z) {
    const dx = Math.max(COMPOUND.minX - x, 0, x - COMPOUND.maxX);
    const dz = Math.max(COMPOUND.minZ - z, 0, z - COMPOUND.maxZ);
    return Math.hypot(dx, dz);
  }
  function trailDist(x, z) {
    let d = Infinity;
    for (const t of W.trails) d = Math.min(d, SC.distToPolyline(x, z, t));
    return d;
  }
  W.trailDist = trailDist;

  // ---------------------------------------------------------------- terrain height
  W.height = function (x, z) {
    let h = (SC.fbm(x * 0.022 + 40, z * 0.022 - 13) - 0.5) * 6 + (SC.noise2(x * 0.11, z * 0.11) - 0.5) * 0.5;
    let flat = SC.smoothstep(2, 14, compoundDist(x, z));
    for (const c of W.clearings) flat = Math.min(flat, SC.smoothstep(c.r * 0.6, c.r + 6, Math.hypot(x - c.x, z - c.z)));
    h *= flat;
    const tr = 1 - SC.smoothstep(1.2, 4, trailDist(x, z));
    h = h * (1 - tr * 0.6) - tr * 0.12;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += SC.smoothstep(84, 104, edge) * 9;
    return h;
  };

  // ---------------------------------------------------------------- helpers
  const mats = {};
  function mat(color, opts) {
    const key = color + JSON.stringify(opts || {});
    if (!mats[key]) mats[key] = new THREE.MeshLambertMaterial(Object.assign({ color }, opts || {}));
    return mats[key];
  }
  W.mat = mat;

  function jitter(geo, amt, rnd) {
    const p = geo.attributes.position;
    // keep shared vertices together so the mesh stays closed
    const seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
      if (!seen.has(k)) seen.set(k, [(rnd() - 0.5) * amt, (rnd() - 0.5) * amt, (rnd() - 0.5) * amt]);
      const o = seen.get(k);
      p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
    }
    geo.computeVertexNormals();
    return geo;
  }

  function addBox(scene, x, y, z, w, h, d, color, opts) {
    opts = opts || {};
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.material || mat(color));
    m.position.set(x, y + h / 2, z);
    if (opts.ry) m.rotation.y = opts.ry;
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    scene.add(m);
    if (opts.collide) {
      // rotated boxes collide as their axis-aligned bounds — fine for 0/90° props
      const sw = opts.ry ? Math.abs(Math.cos(opts.ry)) * w + Math.abs(Math.sin(opts.ry)) * d : w;
      const sd = opts.ry ? Math.abs(Math.sin(opts.ry)) * w + Math.abs(Math.cos(opts.ry)) * d : d;
      W.boxes.push({ minX: x - sw / 2, maxX: x + sw / 2, minZ: z - sd / 2, maxZ: z + sd / 2, h: y + h, tag: opts.tag || 'prop' });
    }
    if (opts.occlude) W.occluders.push(m);
    return m;
  }

  // ---------------------------------------------------------------- build
  W.build = function (scene) {
    const rnd = SC.rng(1337);
    buildGround(scene);
    buildCompound(scene, rnd);
    buildOutposts(scene, rnd);
    buildVegetation(scene, rnd);
    buildExtraction(scene);
    buildColliderGrid();
    mergeStatic(scene);
  };

  // Collapse every static prop mesh into one mesh per material: hundreds of
  // sandbags, posts and planks become a handful of draw calls on mobile GPUs.
  function mergeStatic(scene) {
    scene.updateMatrixWorld(true);
    const groups = new Map(), victims = [];
    scene.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || o.userData.dynamic || o === W.ground) return;
      const key = o.material.uuid + (o.castShadow ? 's' : 'n');
      if (!groups.has(key)) groups.set(key, { material: o.material, cast: o.castShadow, list: [] });
      groups.get(key).list.push(o);
      victims.push(o);
    });
    for (const g of groups.values()) {
      const parts = g.list.map(m => { const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); geo.applyMatrix4(m.matrixWorld); return geo; });
      const withUv = parts.every(p => p.attributes.uv);
      let n = 0; parts.forEach(p => { n += p.attributes.position.count; });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = withUv ? new Float32Array(n * 2) : null;
      let o = 0;
      for (const p of parts) {
        pos.set(p.attributes.position.array, o * 3);
        nor.set(p.attributes.normal.array, o * 3);
        if (uv) uv.set(p.attributes.uv.array, o * 2);
        o += p.attributes.position.count;
        p.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, g.material);
      mesh.castShadow = g.cast; mesh.receiveShadow = true;
      scene.add(mesh);
    }
    // originals leave the scene but keep their world matrices, so the camera can still raycast them
    for (const v of victims) v.parent.remove(v);
  }

  function buildGround(scene) {
    const S = 240, N = 120;
    const geo = new THREE.PlaneGeometry(S, S, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x3d4a26), cMoss = new THREE.Color(0x2c3a1f), cDirt = new THREE.Color(0x5a4a33),
      cGravel = new THREE.Color(0x605a4a), cMud = new THREE.Color(0x3b3224), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, W.height(x, z));
      const n = SC.fbm(x * 0.08, z * 0.08);
      tmp.copy(cMoss).lerp(cGrass, n);
      tmp.lerp(cMud, SC.smoothstep(0.62, 0.8, SC.noise2(x * 0.05 + 7, z * 0.05)) * 0.6);
      const tr = 1 - SC.smoothstep(1.0, 3.2, trailDist(x, z));
      tmp.lerp(cDirt, tr * 0.9);
      const cd = compoundDist(x, z);
      tmp.lerp(cGravel, (1 - SC.smoothstep(0, 4, cd)) * 0.85);
      for (const c of W.clearings) tmp.lerp(cDirt, (1 - SC.smoothstep(c.r * 0.4, c.r, Math.hypot(x - c.x, z - c.z))) * 0.45);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.receiveShadow = true;
    ground.name = 'ground';
    scene.add(ground);
    W.ground = ground;
  }

  function chainLinkTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(150,150,135,1)';
    g.lineWidth = 3;
    g.beginPath();
    for (let i = -64; i <= 64; i += 16) { g.moveTo(i, 0); g.lineTo(i + 64, 64); g.moveTo(i + 64, 0); g.lineTo(i, 64); }
    g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  let fenceMaterial = null;
  function fenceMat(tex) {
    if (!fenceMaterial) fenceMaterial = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    return fenceMaterial;
  }

  function fenceRun(scene, ax, az, bx, bz, tex) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) return;
    const H = 2.4, mx = (ax + bx) / 2, mz = (az + bz) / 2, ang = Math.atan2(bz - az, bx - ax);
    const pg = new THREE.PlaneGeometry(len, H), uv = pg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 1.2, uv.getY(i) * H / 1.2);
    const panel = new THREE.Mesh(pg, fenceMat(tex));
    panel.position.set(mx, H / 2 + 0.05, mz);
    panel.rotation.y = -ang;
    panel.castShadow = true;
    scene.add(panel);
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, H + 0.4, 5);
    const n = Math.ceil(len / 3);
    for (let i = 0; i <= n; i++) {
      const f = i / n, p = new THREE.Mesh(postGeo, mat(0x4d4b42));
      p.position.set(ax + (bx - ax) * f, (H + 0.4) / 2, az + (bz - az) * f);
      scene.add(p);
    }
    const wire = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), mat(0x777766));
    wire.position.set(mx, H + 0.3, mz); wire.rotation.y = -ang; scene.add(wire);
    const th = 0.25;
    W.boxes.push({ minX: Math.min(ax, bx) - th, maxX: Math.max(ax, bx) + th, minZ: Math.min(az, bz) - th, maxZ: Math.max(az, bz) + th, h: H, tag: 'fence', see: true });
  }

  // Building from wall slabs so doorways are real gaps. doors: [{side:'n'|'s'|'e'|'w', at, w}]
  function building(scene, o) {
    const { x, z, w, d, h } = o, T = 0.3, col = o.color || 0x6b6a55;
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    const sides = {
      n: { a: [x0, z0], b: [x1, z0] }, s: { a: [x0, z1], b: [x1, z1] },
      w: { a: [x0, z0], b: [x0, z1] }, e: { a: [x1, z0], b: [x1, z1] },
    };
    for (const k in sides) {
      const s = sides[k], horiz = k === 'n' || k === 's';
      const from = horiz ? s.a[0] : s.a[1], to = horiz ? s.b[0] : s.b[1];
      const gaps = (o.doors || []).filter(dd => dd.side === k).map(dd => [dd.at - dd.w / 2, dd.at + dd.w / 2]).sort((p, q) => p[0] - q[0]);
      let cur = from;
      const segs = [];
      for (const g of gaps) { segs.push([cur, g[0]]); cur = g[1]; }
      segs.push([cur, to]);
      for (const sg of segs) {
        const L = sg[1] - sg[0];
        if (L < 0.05) continue;
        const c = (sg[0] + sg[1]) / 2;
        const m = horiz
          ? addBox(scene, c, 0, s.a[1], L + T, h, T, col, { collide: true, occlude: true, tag: 'wall' })
          : addBox(scene, s.a[0], 0, c, T, h, L + T, col, { collide: true, occlude: true, tag: 'wall' });
        m.userData.wall = true;
      }
      for (const g of gaps) {
        const c = (g[0] + g[1]) / 2, L = g[1] - g[0];
        if (horiz) addBox(scene, c, 2.1, s.a[1], L, h - 2.1, T, col, { occlude: true });
        else addBox(scene, s.a[0], 2.1, c, T, h - 2.1, L, col, { occlude: true });
      }
    }
    // floor + roof
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), mat(0x4a463a));
    floor.position.set(x, 0.05, z); floor.receiveShadow = true; scene.add(floor);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.25, d + 0.8), mat(o.roof || 0x4e5040));
    roof.position.set(x, h + 0.12, z); roof.castShadow = true; scene.add(roof);
    roof.userData.dynamic = true;
    W.roofs.push({ mesh: roof, minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
    return { x0, x1, z0, z1 };
  }

  function watchtower(scene, x, z, ry) {
    const gy = W.height(x, z), H = 5.4, s = 1.3;
    const g = new THREE.Group(); g.position.set(x, gy, z); g.rotation.y = ry || 0; scene.add(g);
    const wood = mat(0x5b4630), dark = mat(0x3c2f22);
    for (const [lx, lz] of [[-s, -s], [s, -s], [-s, s], [s, s]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, H, 0.22), wood);
      leg.position.set(lx, H / 2, lz); leg.castShadow = true; g.add(leg);
      W.circles.push({ x: x + lx * Math.cos(ry || 0) + lz * Math.sin(ry || 0), z: z - lx * Math.sin(ry || 0) + lz * Math.cos(ry || 0), r: 0.25, h: H });
    }
    for (const yy of [1.6, 3.4]) for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2 * s, 0.1, 0.1), dark);
      b.position.set(0, yy, 0); b.rotation.y = i * Math.PI / 2; b.translateZ(s); b.rotation.z = (i % 2 ? 0.5 : -0.5); g.add(b);
    }
    const plat = new THREE.Mesh(new THREE.BoxGeometry(2 * s + 0.8, 0.16, 2 * s + 0.8), wood);
    plat.position.y = H; plat.castShadow = true; g.add(plat);
    for (let i = 0; i < 4; i++) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(2 * s + 0.8, 0.9, 0.08), dark);
      r.position.set(0, H + 0.5, 0); r.rotation.y = i * Math.PI / 2; r.translateZ(s + 0.4); g.add(r);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.2, 4), mat(0x3f4a2e));
    roof.position.y = H + 2.6; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    for (const [lx, lz] of [[-s, -s], [s, -s], [-s, s], [s, s]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 0.1), dark); p.position.set(lx + Math.sign(lx) * 0.3, H + 1.1, lz + Math.sign(lz) * 0.3); g.add(p);
    }
    // ladder
    for (let i = 0; i < 2; i++) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, H, 0.06), dark); rail.position.set(-0.3 + i * 0.6, H / 2, s + 0.5); rail.rotation.x = -0.08; g.add(rail);
    }
    for (let y = 0.4; y < H; y += 0.45) { const rung = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), dark); rung.position.set(0, y, s + 0.5 - y * 0.08); g.add(rung); }
    // searchlight (visual; guards drive it in Phase 2)
    const lampHead = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 0.4, 8), mat(0x222222, { emissive: 0x333322 }));
    lampHead.position.set(0, H + 1.1, -s); lampHead.rotation.x = Math.PI / 2.4; lampHead.userData.dynamic = true; g.add(lampHead);
    W.towers.push({ x, z, y: gy + H, ry: ry || 0, group: g });
  }

  function sandbagRing(scene, cx, cz, r, from, to, rnd) {
    const geo = new THREE.BoxGeometry(0.7, 0.3, 0.38);
    const m = mat(0x7a6c4c);
    for (let a = from; a <= to; a += 0.55 / r) {
      for (let lvl = 0; lvl < 3; lvl++) {
        const off = lvl % 2 ? 0.28 / r : 0;
        const x = cx + Math.cos(a + off) * r, z = cz + Math.sin(a + off) * r;
        const b = new THREE.Mesh(geo, m);
        b.position.set(x, W.height(x, z) + 0.15 + lvl * 0.28, z);
        b.rotation.y = -(a + off) + Math.PI / 2 + (rnd() - 0.5) * 0.15;
        b.castShadow = lvl === 2; b.receiveShadow = true;
        scene.add(b);
      }
      W.circles.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, r: 0.38, h: 0.9, tag: 'sandbag' });
    }
  }

  function crateStack(scene, x, z, n, rnd) {
    const colors = [0x5d5a3c, 0x4f5a3a, 0x6a5c40];
    const gy = W.height(x, z);
    let top = 0;
    for (let i = 0; i < n; i++) {
      const s = 1.1 + rnd() * 0.3, ox = (i % 2) * 1.25, oy = i >= 2 ? 1.15 : 0;
      addBox(scene, x + ox, gy + oy, z, s, s, s, colors[i % 3], { collide: oy === 0, occlude: true, ry: (rnd() - 0.5) * 0.12 });
      top = Math.max(top, oy + s);
    }
  }

  function lamp(scene, x, z, withLight) {
    const gy = W.height(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6), mat(0x3a3a34));
    pole.position.set(x, gy + 2.1, z); scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), mat(0xfff2c0, { emissive: 0xffe08a, emissiveIntensity: 0.9 }));
    head.position.set(x, gy + 4.2, z); scene.add(head);
    if (withLight) {
      const L = new THREE.PointLight(0xffd88a, 1.1, 16, 1.6);
      L.position.set(x, gy + 3.9, z); scene.add(L);
    }
    W.lamps.push({ x, z, r: 7 });
    W.circles.push({ x, z, r: 0.15, h: 4 });
  }

  function truck(scene, x, z, ry) {
    const g = new THREE.Group(); g.position.set(x, W.height(x, z), z); g.rotation.y = ry; scene.add(g);
    const green = mat(0x4a5233), dark = mat(0x222420), canvas = mat(0x5f6142);
    const parts = [
      [0, 1.0, 1.9, 2.3, 1.6, 1.8, green], [0, 0.55, -0.6, 2.3, 0.3, 4.2, dark], [0, 1.65, -0.9, 2.4, 1.9, 3.4, canvas],
    ];
    for (const p of parts) { const m = new THREE.Mesh(new THREE.BoxGeometry(p[3], p[4], p[5]), p[6]); m.position.set(p[0], p[1], p[2]); m.castShadow = true; g.add(m); W.occluders.push(m); }
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 0.05), mat(0x1c2420, { emissive: 0x0a0f0c })); win.position.set(0, 1.45, 2.81); g.add(win);
    const wg = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 10); wg.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [[-1.1, 1.8], [1.1, 1.8], [-1.1, -1.5], [1.1, -1.5], [-1.1, -2.5], [1.1, -2.5]]) { const wh = new THREE.Mesh(wg, dark); wh.position.set(wx, 0.45, wz); g.add(wh); }
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    const hw = (2.4 * c + 6 * s) / 2, hd = (2.4 * s + 6 * c) / 2;
    W.boxes.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, h: 2.6, tag: 'truck' });
  }

  function buildCompound(scene, rnd) {
    const C = COMPOUND, tex = chainLinkTexture();
    // perimeter fence with three ways in: south gate, west breach, north-east crawl hole
    fenceRun(scene, C.minX, C.maxZ, -4, C.maxZ, tex);
    fenceRun(scene, 4, C.maxZ, C.maxX, C.maxZ, tex);
    fenceRun(scene, C.maxX, C.maxZ, C.maxX, C.minZ, tex);
    fenceRun(scene, C.maxX, C.minZ, 21.2, C.minZ, tex);
    fenceRun(scene, 18.8, C.minZ, C.minX, C.minZ, tex);
    fenceRun(scene, C.minX, C.minZ, C.minX, -19.5, tex);
    fenceRun(scene, C.minX, -15, C.minX, C.maxZ, tex);
    // bent fence panel at the west breach (visual cue)
    const bent = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.2), fenceMat(tex));
    bent.position.set(C.minX - 0.8, 0.5, -17.2); bent.rotation.set(-1.2, Math.PI / 2, 0.2); scene.add(bent);

    // south gate: booth + barrier
    addBox(scene, 6, 0, 14.5, 2.2, 2.6, 2.2, 0x5f604a, { collide: true, occlude: true });
    addBox(scene, 6, 2.6, 14.5, 2.6, 0.2, 2.6, 0x3d4430, {});
    const bar = new THREE.Mesh(new THREE.BoxGeometry(8, 0.12, 0.12), mat(0xb8a23a)); bar.position.set(0.5, 1.05, 12.6); scene.add(bar);
    for (let i = -3; i <= 3; i += 2) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.125, 0.13), mat(0x222222)); st.position.set(i, 1.05, 12.6); scene.add(st); }
    sandbagRing(scene, -7, 16, 2.2, -0.3, Math.PI + 0.3, rnd);

    // radio station: door on the south wall, consoles inside on the north wall
    building(scene, { x: -14, z: -26, w: 10, d: 8, h: 3.2, color: 0x6a6650, roof: 0x45493a, doors: [{ side: 's', at: -12, w: 1.6 }, { side: 'e', at: -27, w: 1.4 }] });
    const consoleZ = -29.4;
    addBox(scene, -15, 0, consoleZ, 4.5, 0.9, 0.9, 0x3a3d35, { collide: true, tag: 'console' });
    for (let i = 0; i < 3; i++) {
      const scr = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.08), mat(0x112211, { emissive: 0x3cff6a, emissiveIntensity: 0.55 }));
      scr.position.set(-16.5 + i * 1.5, 1.35, consoleZ - 0.25); scr.rotation.x = -0.25; scene.add(scr);
    }
    addBox(scene, -18, 0, -28.9, 0.9, 2.2, 1.6, 0x2f322b, { collide: true, tag: 'rack' });
    const rackLight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.4, 1.2), mat(0x111111, { emissive: 0xff4422, emissiveIntensity: 0.4 }));
    rackLight.position.set(-17.53, 1.2, -28.9); scene.add(rackLight);
    W.poi.radio = { x: -15, z: consoleZ + 1.1, r: 1.8 };

    // antenna mast with blinking beacon
    const mastX = -22.5, mastZ = -35;
    const mastMat = mat(0x8a8a80);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 16, 4), mastMat);
      leg.position.set(mastX + Math.cos(a) * 0.45, 8, mastZ + Math.sin(a) * 0.45); scene.add(leg);
    }
    for (let y = 1; y < 16; y += 1.4) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.03, 3, 3), mastMat);
      ring.rotation.x = Math.PI / 2; ring.position.set(mastX, y, mastZ); scene.add(ring);
    }
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.2, 0.3, 10), mat(0xaaaaa0)); dish.position.set(mastX + 0.6, 11, mastZ); dish.rotation.z = Math.PI / 2.3; scene.add(dish);
    W.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    W.beacon.position.set(mastX, 16.2, mastZ); W.beacon.userData.dynamic = true; scene.add(W.beacon);
    W.circles.push({ x: mastX, z: mastZ, r: 0.8, h: 16 });
    // generator
    addBox(scene, -7, 0, -37, 2.4, 1.4, 1.4, 0x4c5a3a, { collide: true, occlude: true, tag: 'generator' });
    addBox(scene, -7.6, 1.4, -37, 0.2, 0.7, 0.2, 0x222222, {});

    // barracks + command shed (intel documents inside)
    building(scene, { x: 13, z: -30, w: 14, d: 7, h: 3.4, color: 0x5d604a, roof: 0x3d4434, doors: [] });
    building(scene, { x: 15, z: -6, w: 7, d: 6, h: 3, color: 0x625e48, roof: 0x4a4636, doors: [{ side: 'w', at: -6, w: 1.5 }] });
    addBox(scene, 16.4, 0, -6, 1.4, 0.85, 2.4, 0x4a3b28, { collide: true, tag: 'table' });
    const docs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.36), mat(0xc9b98a, { emissive: 0x332a10 }));
    docs.position.set(16.3, 0.9, -6.3); docs.rotation.y = 0.3; docs.userData.dynamic = true; scene.add(docs);
    W.poi.intel = { x: 15.2, z: -6.2, r: 1.6, mesh: docs };

    truck(scene, -12, -6, 0.15);
    crateStack(scene, 5, -15, 3, rnd);
    crateStack(scene, -21, -12, 2, rnd);
    crateStack(scene, 22, -17, 4, rnd);
    crateStack(scene, 3, 3, 2, rnd);
    crateStack(scene, -4, -33, 3, rnd);
    // inner sandbag nest by the gate
    sandbagRing(scene, 9, 5, 2.4, Math.PI * 0.5, Math.PI * 1.4, rnd);
    // fuel drums
    const drum = new THREE.CylinderGeometry(0.32, 0.32, 0.9, 8);
    for (const [dx, dz] of [[-25, -3], [-24.2, -3.2], [-24.6, -2.4], [26, 6], [25.2, 6.4]]) {
      const m = new THREE.Mesh(drum, mat(0x5a2f22)); m.position.set(dx, 0.45, dz); m.castShadow = true; scene.add(m);
      W.circles.push({ x: dx, z: dz, r: 0.35, h: 0.9 });
    }

    lamp(scene, 0, -14, true);
    lamp(scene, -10, -20, true);
    lamp(scene, 10, -20, false);
    lamp(scene, 2, 9, true);
    lamp(scene, 20, -38, false);

    watchtower(scene, -26, 8, Math.PI * 0.75);
    watchtower(scene, 26, -38, -Math.PI * 0.25);
  }

  function buildOutposts(scene, rnd) {
    // west trail guard post
    sandbagRing(scene, -50, 38, 3, -Math.PI * 0.2, Math.PI * 0.9, rnd);
    tarp(scene, -52, 35, 0.4);
    // east trail guard post
    sandbagRing(scene, 52, 44, 3, Math.PI * 0.6, Math.PI * 1.6, rnd);
    tarp(scene, 54, 47, -0.3);
    W.posts.push({ x: -50, z: 38 }, { x: 52, z: 44 });
    // jungle watchtower overlooking the east trail
    watchtower(scene, 40, -12, Math.PI * 0.5);
    crateStack(scene, -53, 41, 2, rnd);
    crateStack(scene, 49, 47, 1, rnd);
  }

  function tarp(scene, x, z, ry) {
    const gy = W.height(x, z), g = new THREE.Group(); g.position.set(x, gy, z); g.rotation.y = ry; scene.add(g);
    for (const [px, pz] of [[-1.5, -1.2], [1.5, -1.2], [-1.5, 1.2], [1.5, 1.2]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 4), mat(0x4a3a28)); p.position.set(px, 1.1, pz); g.add(p);
    }
    const t = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.05, 2.8), mat(0x4f5a38)); t.position.y = 2.2; t.rotation.z = 0.12; t.castShadow = true; g.add(t);
  }

  // ---------------------------------------------------------------- vegetation
  function blocked(x, z, margin) {
    if (compoundDist(x, z) < 3 + margin) return true;
    if (trailDist(x, z) < 2.4 + margin) return true;
    for (const c of W.clearings) if (Math.hypot(x - c.x, z - c.z) < c.r + margin) return true;
    for (const t of W.towers) if (Math.hypot(x - t.x, z - t.z) < 3.5) return true;
    return false;
  }

  function tuftGeometry(blades, h, w) {
    const pos = [];
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * Math.PI * 2 + 0.3, lean = 0.25;
      const cx = Math.cos(a), cz = Math.sin(a), px = -cz * w, pz = cx * w;
      pos.push(-px, 0, -pz, px, 0, pz, cx * lean * h, h, cz * lean * h);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  function frondGeometry() {
    // one drooping palm leaf pointing +X
    const pos = [], segs = 5, L = 2.6;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const y0 = Math.sin(t0 * 1.6) * 0.6 - t0 * t0 * 1.4, y1 = Math.sin(t1 * 1.6) * 0.6 - t1 * t1 * 1.4;
      const w0 = Math.sin(t0 * Math.PI) * 0.45 + 0.04, w1 = Math.sin(t1 * Math.PI) * 0.45 + 0.04;
      const x0 = t0 * L, x1 = t1 * L;
      pos.push(x0, y0, -w0, x1, y1, -w1, x0, y0 + 0.05, 0, x1, y1, -w1, x1, y1 + 0.05, 0, x0, y0 + 0.05, 0);
      pos.push(x0, y0 + 0.05, 0, x1, y1 + 0.05, 0, x0, y0, w0, x1, y1 + 0.05, 0, x1, y1, w1, x0, y0, w0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  function buildVegetation(scene, rnd) {
    const dummy = new THREE.Object3D();
    const trees = [];
    // scattered jungle with clumps
    for (let tries = 0; tries < 9000 && trees.length < 470; tries++) {
      const x = (rnd() * 2 - 1) * 97, z = (rnd() * 2 - 1) * 97;
      const dens = SC.fbm(x * 0.04 + 3, z * 0.04 - 8);
      if (rnd() > dens * 1.5) continue;
      if (blocked(x, z, 0.5)) continue;
      let ok = true;
      for (let i = trees.length - 1; i >= Math.max(0, trees.length - 80); i--) if (Math.hypot(trees[i].x - x, trees[i].z - z) < 3.2) { ok = false; break; }
      if (!ok) continue;
      trees.push({ x, z, palm: rnd() < 0.38, s: 0.8 + rnd() * 0.7 });
    }
    // dense wall around the map edge hides the boundary
    for (let a = 0; a < 260; a++) {
      const side = a % 4, t = (rnd() * 2 - 1) * 104, d = 97 + rnd() * 10;
      const x = side === 0 ? t : side === 1 ? d : side === 2 ? t : -d;
      const z = side === 0 ? d : side === 1 ? t : side === 2 ? -d : t;
      if (Math.hypot(x, z - 97) < 6) continue; // keep the road's far end readable
      trees.push({ x, z, palm: false, s: 1.4 + rnd() * 0.8, edge: true });
    }
    W.trees = trees;

    const broad = trees.filter(t => !t.palm), palms = trees.filter(t => t.palm);
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.34, 1, 6); trunkGeo.translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x4a3a2a), broad.length);
    const canopyVariants = [0, 1, 2].map(i => jitter(new THREE.IcosahedronGeometry(1, 0), 0.45, SC.rng(50 + i)));
    const canopyMat = mat(0xffffff);
    const canopies = canopyVariants.map(g => new THREE.InstancedMesh(g, canopyMat, broad.length * 2));
    const ccount = [0, 0, 0];
    const leafCols = [0x2f4a22, 0x3a5426, 0x29401f, 0x44582a].map(c => new THREE.Color(c));
    broad.forEach((t, i) => {
      const gy = W.height(t.x, t.z), h = 5 + t.s * 5;
      dummy.position.set(t.x, gy - 0.2, t.z); dummy.rotation.set((rnd() - 0.5) * 0.1, rnd() * 6, (rnd() - 0.5) * 0.1); dummy.scale.set(t.s, h, t.s);
      dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      for (let k = 0; k < 2; k++) {
        const v = (i + k) % 3, idx = ccount[v]++;
        const r = (2.2 + rnd() * 1.4) * t.s * (k ? 0.75 : 1);
        dummy.position.set(t.x + (rnd() - 0.5) * 1.6 * k, gy + h - 0.5 + k * 1.6, t.z + (rnd() - 0.5) * 1.6 * k);
        dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); dummy.scale.set(r, r * 0.7, r);
        dummy.updateMatrix(); canopies[v].setMatrixAt(idx, dummy.matrix);
        canopies[v].setColorAt(idx, leafCols[Math.floor(rnd() * leafCols.length)]);
      }
      t.canopyR = 3 * t.s;
      if (!t.edge) W.circles.push({ x: t.x, z: t.z, r: 0.38 * t.s, h: 8, tag: 'tree' });
    });
    canopies.forEach((c, v) => { c.count = ccount[v]; c.castShadow = true; c.receiveShadow = false; if (c.instanceColor) c.instanceColor.needsUpdate = true; scene.add(c); });
    trunks.castShadow = true; scene.add(trunks);

    // palms
    const pTrunkGeo = new THREE.CylinderGeometry(0.11, 0.2, 1, 5); pTrunkGeo.translate(0, 0.5, 0);
    const pTrunks = new THREE.InstancedMesh(pTrunkGeo, mat(0x6b5a40), palms.length);
    const fronds = new THREE.InstancedMesh(frondGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), palms.length * 7);
    const frondCols = [0x3f5a26, 0x4b6329, 0x36501f].map(c => new THREE.Color(c));
    let fi = 0;
    const tip = new THREE.Vector3();
    palms.forEach((t, i) => {
      const gy = W.height(t.x, t.z), h = 4.5 + t.s * 4, lean = (rnd() - 0.5) * 0.35, rot = rnd() * 6;
      dummy.position.set(t.x, gy - 0.2, t.z); dummy.rotation.set(lean, rot, 0); dummy.scale.set(t.s, h, t.s);
      dummy.updateMatrix(); pTrunks.setMatrixAt(i, dummy.matrix);
      tip.set(0, 1, 0).applyMatrix4(dummy.matrix);
      for (let k = 0; k < 7; k++) {
        dummy.position.copy(tip); dummy.rotation.set(0, k / 7 * Math.PI * 2 + rnd() * 0.4, (rnd() - 0.5) * 0.3);
        const fs = t.s * (0.9 + rnd() * 0.3); dummy.scale.set(fs, fs, fs);
        dummy.updateMatrix(); fronds.setMatrixAt(fi, dummy.matrix); fronds.setColorAt(fi, frondCols[fi % 3]); fi++;
      }
      t.canopyR = 2.2 * t.s;
      W.circles.push({ x: t.x, z: t.z, r: 0.25 * t.s, h: 6, tag: 'tree' });
    });
    pTrunks.castShadow = true; fronds.castShadow = true;
    if (fronds.instanceColor) fronds.instanceColor.needsUpdate = true;
    scene.add(pTrunks); scene.add(fronds);

    W.treeGrid = new SC.SpatialGrid(10);
    trees.forEach(t => { if (!t.edge) W.treeGrid.add(t); });

    // bushes — concentrated along trails and the fence line so stealth routes exist
    const bushes = [];
    const nearFence = (x, z) => { const d = compoundDist(x, z); return d > 3.5 && d < 12; };
    for (let tries = 0; tries < 12000 && bushes.length < 420; tries++) {
      const x = (rnd() * 2 - 1) * 92, z = (rnd() * 2 - 1) * 92;
      const td = trailDist(x, z);
      const want = (td > 2.6 && td < 9) || nearFence(x, z) || rnd() < 0.25;
      if (!want) continue;
      if (compoundDist(x, z) < 3.3) continue;
      if (td < 2.6) continue;
      let clr = false;
      for (const c of W.clearings) if (Math.hypot(x - c.x, z - c.z) < c.r) clr = true;
      if (clr) continue;
      bushes.push({ x, z, r: 0.9 + rnd() * 0.8 });
    }
    // a few inside the compound edge for cover
    for (const [x, z] of [[-27, -6], [-27.5, -30], [27, -24], [-27, 4], [27.5, 0], [-2, -40], [12, -40]]) bushes.push({ x, z, r: 1.1 });
    const bushGeo = jitter(new THREE.IcosahedronGeometry(1, 1), 0.35, SC.rng(9));
    const bushMesh = new THREE.InstancedMesh(bushGeo, mat(0xffffff), bushes.length);
    const bushCols = [0x25391a, 0x2c4419, 0x213317, 0x334a20].map(c => new THREE.Color(c));
    W.bushGrid = new SC.SpatialGrid(6);
    bushes.forEach((b, i) => {
      dummy.position.set(b.x, W.height(b.x, b.z) + b.r * 0.35, b.z);
      dummy.rotation.set(0, rnd() * 6, 0); dummy.scale.set(b.r * 1.15, b.r * 0.85, b.r * 1.15);
      dummy.updateMatrix(); bushMesh.setMatrixAt(i, dummy.matrix); bushMesh.setColorAt(i, bushCols[i % 4]);
      W.bushGrid.add(b);
    });
    if (bushMesh.instanceColor) bushMesh.instanceColor.needsUpdate = true;
    bushMesh.castShadow = true; bushMesh.receiveShadow = true; scene.add(bushMesh);
    W.bushes = bushes;

    // tall grass patches
    const patches = [];
    const seeds = [[-14, 60], [12, 52], [-36, 46], [-60, 24], [-40, -2], [-44, -30], [-12, 30], [14, 30], [36, 30], [44, 58], [60, 24],
      [52, -4], [48, -34], [36, -56], [8, -54], [-14, -52], [-40, -50], [70, -50], [-70, 60], [24, 80], [-24, 78], [72, 70], [-72, -10], [-8, 16], [34, 4], [-36, 18]];
    for (const [sx, sz] of seeds) {
      const r = 4 + rnd() * 3;
      patches.push({ x: sx, z: sz, r });
    }
    const tuft = tuftGeometry(4, 1, 0.07);
    let total = 0; const blades = [];
    for (const p of patches) {
      const n = Math.floor(p.r * p.r * 6);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * p.r;
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (compoundDist(x, z) < 1) continue;
        blades.push([x, z, 0.9 + rnd() * 0.6 - (d / p.r) * 0.35]);
      }
    }
    const grass = new THREE.InstancedMesh(tuft, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), blades.length);
    const gCols = [0x5d6b32, 0x4f5f2c, 0x6b7438, 0x485628].map(c => new THREE.Color(c));
    blades.forEach((b, i) => {
      dummy.position.set(b[0], W.height(b[0], b[1]) - 0.05, b[1]);
      dummy.rotation.set((rnd() - 0.5) * 0.3, rnd() * 6, (rnd() - 0.5) * 0.3); dummy.scale.set(1.3, b[2], 1.3);
      dummy.updateMatrix(); grass.setMatrixAt(i, dummy.matrix); grass.setColorAt(i, gCols[i % 4]);
      total++;
    });
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    grass.receiveShadow = true; scene.add(grass);
    W.grassPatches = patches;
    W.grassMesh = grass;

    // low ground clutter (ferns) — purely visual
    const fernGeo = tuftGeometry(6, 0.55, 0.16);
    const ferns = [];
    for (let i = 0; i < 1800; i++) {
      const x = (rnd() * 2 - 1) * 96, z = (rnd() * 2 - 1) * 96;
      if (compoundDist(x, z) < 2 || trailDist(x, z) < 1.8) continue;
      ferns.push([x, z]);
    }
    const fernMesh = new THREE.InstancedMesh(fernGeo, new THREE.MeshLambertMaterial({ color: 0x3a5424, side: THREE.DoubleSide }), ferns.length);
    ferns.forEach((f, i) => {
      dummy.position.set(f[0], W.height(f[0], f[1]), f[1]); dummy.rotation.set(0, rnd() * 6, 0);
      const s = 0.8 + rnd() * 0.9; dummy.scale.set(s, s, s); dummy.updateMatrix(); fernMesh.setMatrixAt(i, dummy.matrix);
    });
    scene.add(fernMesh);

    // rocks
    const rockGeo = jitter(new THREE.DodecahedronGeometry(1, 0), 0.4, SC.rng(77));
    const rocks = [];
    for (let tries = 0; tries < 3000 && rocks.length < 110; tries++) {
      const x = (rnd() * 2 - 1) * 92, z = (rnd() * 2 - 1) * 92;
      if (blocked(x, z, -0.5)) continue;
      const big = rnd() < 0.3;
      rocks.push({ x, z, s: big ? 1.2 + rnd() * 1.3 : 0.3 + rnd() * 0.5 });
    }
    // deliberate cover boulders near approaches
    for (const [x, z, s] of [[-8, 40, 1.8], [8, 34, 1.5], [-40, 8, 2], [-38, -24, 1.6], [42, 20, 1.7], [30, -48, 1.8], [-6, 72, 1.4], [58, -52, 2.0]]) rocks.push({ x, z, s });
    const rockMesh = new THREE.InstancedMesh(rockGeo, mat(0x6d6a5d), rocks.length);
    rocks.forEach((r, i) => {
      dummy.position.set(r.x, W.height(r.x, r.z) + r.s * 0.25, r.z); dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      dummy.scale.set(r.s * 1.2, r.s * 0.8, r.s); dummy.updateMatrix(); rockMesh.setMatrixAt(i, dummy.matrix);
      if (r.s > 0.7) W.circles.push({ x: r.x, z: r.z, r: r.s * 0.95, h: r.s * 1.0, tag: 'rock' });
    });
    rockMesh.castShadow = true; rockMesh.receiveShadow = true; scene.add(rockMesh);
    W.occluders.push(rockMesh);
  }

  function buildExtraction(scene) {
    const e = W.poi.extraction, gy = W.height(e.x, e.z) + 0.04;
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 5.8, 32), new THREE.MeshBasicMaterial({ color: 0xd8cfa8, transparent: true, opacity: 0.55, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(e.x, gy, e.z); scene.add(ring);
    const hm = new THREE.MeshBasicMaterial({ color: 0xd8cfa8, transparent: true, opacity: 0.55, depthWrite: false });
    for (const [w, d, ox] of [[0.6, 4, -1.2], [0.6, 4, 1.2], [2.4, 0.6, 0]]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(w, d), hm); b.rotation.x = -Math.PI / 2; b.position.set(e.x + ox, gy + 0.01, e.z); scene.add(b);
    }
    W.flare = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff5533 }));
    W.flare.position.set(e.x + 5.5, gy + 0.2, e.z); W.flare.userData.dynamic = true; scene.add(W.flare);
    const smoke = new THREE.Mesh(new THREE.ConeGeometry(0.9, 6, 7, 1, true), new THREE.MeshBasicMaterial({ color: 0xc86048, transparent: true, opacity: 0.18, depthWrite: false }));
    smoke.position.set(e.x + 5.5, gy + 3.2, e.z); smoke.rotation.x = Math.PI; smoke.userData.dynamic = true; scene.add(smoke);
    W.smoke = smoke;
  }

  // ---------------------------------------------------------------- queries
  function buildColliderGrid() {
    W.colGrid = new SC.SpatialGrid(8);
    W.boxes.forEach(b => {
      // register a box in every cell it overlaps
      for (let x = Math.floor(b.minX / 8); x <= Math.floor(b.maxX / 8); x++)
        for (let z = Math.floor(b.minZ / 8); z <= Math.floor(b.maxZ / 8); z++)
          W.colGrid.add({ x: x * 8 + 4, z: z * 8 + 4, box: b });
    });
    W.circles.forEach(c => W.colGrid.add({ x: c.x, z: c.z, circle: c }));
  }

  const qBuf = [];
  // Resolve a circle of radius r at (x,z); returns corrected {x,z}.
  W.collide = function (x, z, r) {
    W.colGrid.query(x, z, r + 8, qBuf);
    const seenBoxes = new Set();
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < qBuf.length; i++) {
        const it = qBuf[i];
        if (it.box) {
          const b = it.box;
          if (pass === 0 && seenBoxes.has(b)) continue;
          seenBoxes.add(b);
          const cx = SC.clamp(x, b.minX, b.maxX), cz = SC.clamp(z, b.minZ, b.maxZ);
          let dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            if (d2 < 1e-8) {
              // centre inside box: push out along the shallowest axis
              const l = x - b.minX, rr = b.maxX - x, n = z - b.minZ, s = b.maxZ - z, m = Math.min(l, rr, n, s);
              if (m === l) x = b.minX - r; else if (m === rr) x = b.maxX + r; else if (m === n) z = b.minZ - r; else z = b.maxZ + r;
            } else {
              const d = Math.sqrt(d2); x = cx + dx / d * r; z = cz + dz / d * r;
            }
          }
        } else {
          const c = it.circle, dx = x - c.x, dz = z - c.z, rr = r + c.r, d2 = dx * dx + dz * dz;
          if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2); x = c.x + dx / d * rr; z = c.z + dz / d * rr; }
        }
      }
      seenBoxes.clear();
    }
    return { x, z };
  };

  // Nearest wall-like surface for cover/wall-hug. Returns {px,pz,nx,nz,dist,h,box} or null.
  W.nearestSurface = function (x, z, maxDist) {
    W.colGrid.query(x, z, maxDist + 8, qBuf);
    let best = null;
    for (const it of qBuf) {
      let px, pz, h, src;
      if (it.box) { const b = it.box; px = SC.clamp(x, b.minX, b.maxX); pz = SC.clamp(z, b.minZ, b.maxZ); h = b.h; src = b; }
      else { const c = it.circle; if (c.r < 0.3) continue; const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz) || 1; px = c.x + dx / d * c.r; pz = c.z + dz / d * c.r; h = c.h; src = c; }
      const d = Math.hypot(x - px, z - pz);
      if (d < maxDist && (!best || d < best.dist)) {
        const nd = d || 1;
        best = { px, pz, nx: (x - px) / nd, nz: (z - pz) / nd, dist: d, h, src };
      }
    }
    return best;
  };

  const nBuf = [];
  // Concealment at a point: {bush, grass, shade, lit}
  W.concealment = function (x, z) {
    const out = { bush: 0, grass: 0, shade: 0, lit: 0 };
    W.bushGrid.query(x, z, 2, nBuf);
    for (const b of nBuf) { const d = Math.hypot(x - b.x, z - b.z); if (d < b.r * 0.95) out.bush = Math.max(out.bush, 1 - d / (b.r * 1.2)); }
    for (const p of W.grassPatches) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) out.grass = Math.max(out.grass, SC.smoothstep(p.r, p.r * 0.6, d)); }
    W.treeGrid.query(x, z, 6, nBuf);
    for (const t of nBuf) { const d = Math.hypot(x - t.x, z - t.z); if (d < t.canopyR) out.shade = Math.max(out.shade, 1 - d / t.canopyR); }
    for (const l of W.lamps) { const d = Math.hypot(x - l.x, z - l.z); if (d < l.r) out.lit = Math.max(out.lit, 1 - d / l.r); }
    if (out.bush > 0) out.bush = Math.min(1, out.bush * 1.6);
    return out;
  };

  W.insideRoof = function (x, z) {
    for (const r of W.roofs) if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return r;
    return null;
  };

  W.update = function (t) {
    if (W.beacon) W.beacon.visible = (t % 1.6) < 0.8;
    if (W.flare) W.flare.material.color.setHSL(0.03, 1, 0.45 + Math.sin(t * 13) * 0.1);
    if (W.smoke) { W.smoke.rotation.y = t * 0.3; W.smoke.scale.x = W.smoke.scale.z = 1 + Math.sin(t * 0.8) * 0.12; }
  };
})(window.SC);
