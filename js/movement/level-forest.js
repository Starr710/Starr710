// SHADOW CELL — Level 01: Forest Outpost (Step 24). A first playable stealth level: a small
// military compound in the middle of a forest, reached from a southern trail, left by a
// northern one. Everything here is level data plus a builder that turns it into geometry,
// collision and guard configurations; the player, the guards and every other system are the
// ones the Test Lab uses (main.js loads one level at a time into the same world).
// Two references, as approved:
//   MAP A — the compound's interior: its rectangular walls with a north and a south opening,
//           two long central blocks, the smaller blocks along its walls and the rectangular
//           patrol round the two central ones
//   MAP B — everything outside it: the rounded, irregular forest edge (trees and rocks, not a
//           wall), the southern START trail, the western lookout with two low logs and a tall
//           block, the eastern rounded patrol round a tall block, the northern lookout and the
//           END trail, and the low barrier just off the compound's south-east corner
// Units: metres. x east, z north (yaw 0 faces +z, north). About 60 × 80 m in all; the compound
// is 22 × 22 m. Placeholder art: simple shapes, reused (instanced) geometry, no foliage motion.
(function (mv) {
  'use strict';

  const D = Math.PI / 180;

  mv.FOREST_OUTPOST = {
    id: 'forest', name: 'LEVEL 01 — FOREST OUTPOST', objective: 'REACH THE NORTHERN EXIT',
    background: 0x24302a, fog: [26, 62],
    defaultSurface: 'grass',
    spawn: { x: 0, z: -36.5, yaw: 0 },
    // the END trigger: the far end of the northern trail
    exit: { minX: -7, maxX: -0.5, minZ: 36, maxZ: 40 },
    // the playable area (MAP B's rounded outline): the south trail, the two-lobed forest, the north trail
    bounds: [
      [-6, -40], [6, -40], [5.5, -36], [3.5, -31], [2.8, -27], [3.4, -24], [6, -22.5],
      [12, -22.5], [19, -22], [24, -20], [27.5, -15], [29.5, -7], [30, 1], [29.5, 9], [27.5, 16], [24, 22], [19, 26.5], [13, 28.5], [6, 29], [0, 29.5],
      [-0.5, 30], [-1, 34], [-0.5, 40], [-7.5, 40], [-7, 34], [-7, 30],
      [-10, 29.5], [-16, 28.5], [-22, 26.5], [-26.5, 22], [-29.5, 15], [-30.5, 7], [-29.5, -1], [-27.5, -8], [-24, -14], [-19, -19], [-13, -21.5], [-6, -22.5],
      [-3.4, -24], [-2.8, -27], [-3.5, -31], [-5.5, -36],
    ],
    // ---- the compound (MAP A): x −9…13, z −8…14; walls 2.8 m high, 0.35 m thick
    compound: { minX: -9, maxX: 13, minZ: -8, maxZ: 14, wallH: 2.8, wallT: 0.35,
      north: [-0.1, 3.6],   // the north opening (x from … to)
      south: [0.3, 4.9],    // the south opening
    },
    // full-height blocks (tall: they hide a standing player and stop bullets): [x, z, w (x), d (z), h, kind]
    blocks: [
      [1.95, 7.7, 6.3, 2.8, 2.2, 'crate'],     // MAP A: the long northern central block
      [3, -0.75, 7.8, 2.5, 2.2, 'crate'],      // MAP A: the long southern central block
      [-6, 3, 2.4, 3, 2.1, 'crate'],           // MAP A: by the west wall
      [11.1, 11.1, 2, 2, 2.1, 'crate'],        // MAP A: the north-east corner
      [11.6, -3.75, 1.6, 2.5, 2.1, 'crate'],   // MAP A: by the east wall, south
      [-23.3, -1, 3, 2.6, 2.4, 'container'],   // MAP B: the tall block west of the compound
      [19.2, 4.75, 3.4, 4.5, 2.4, 'container'], // MAP B: the tall block inside the eastern patrol loop
    ],
    // waist-high cover (0.95 m: crouched behind it she's hidden, standing she isn't): [x, z, length, along ('x' | 'z'), kind]
    low: [
      [-22, 10.2, 2.5, 'x', 'log'],            // MAP B: the two short western dashes
      [-14.1, 6.9, 2.6, 'x', 'log'],
      [11, -10, 2.0, 'z', 'barrier'],          // MAP B: the tick just off the compound's south-east corner
    ],
    lowH: 0.95,
    // trees that are in play (collision, cover): [x, z, trunk radius]
    trees: [
      // (Step 24.1: the decorative ones by the edge, where the edge's own trees already stand, are gone: (−26, −6),
      // (−27, 3), (27, −8), (27.3, 4), (14, −17), (13, 22.5); every tree kept gives cover on a way through)
      // Forest cleanup: 21 → 14. Gone, crowding an area without breaking any guard's view, or standing in a trail:
      // (9.5, −19.5), (−15, −18), (−21, −12), (−25, 17), (3, 27.5), (26, 12.5) (in the eastern trail), (22, 19.5) (in the northern
      // one). Moved out of a trail, keeping the sightline break each gives: (−17, 1.5) → (−19.6, 1.5) (the western trail, in
      // Guard D's view down it), (−14.5, 18.5) → (−13.6, 18.4) (in Guard A's), (14.5, −12.5) → (14.5, −11.6) (in Guard B's south stop's)
      [-9, -17, 0.34], [4.5, -17.5, 0.3], [20, -15.9, 0.34],   // ((20, −15.5) stood on the southern trail's edge: 0.4 m south of it now)
      [-18.5, -7.5, 0.34], [-13, -3, 0.3], [-19.6, 1.5, 0.32], [-12, 10.5, 0.36], [-13.6, 18.4, 0.34], [-20, 22, 0.36], [-11.5, 24, 0.32],
      [14.5, -11.6, 0.3],
      [6, 24.5, 0.36], [10.5, 18.5, 0.32], [-7.5, 16.8, 0.34],
    ],
    // rocks in play: [x, z, radius, height] (≥ 1.6 m tall: full cover; under 1 m: waist-high)
    rocks: [
      // Forest cleanup: 9 → 6. Gone: (16, 21) and (−9.5, 20) (both filled the northern trail; the trees at (−7.5, 16.8), (−13.6, 18.4)
      // and (−11.5, 24) still break the north lookout's view there) and (−26.5, −12.5) (the far south-west corner, in nobody's view).
      // Moved out of a trail, keeping the cover each gives: (24.5, −12) → (21.5, −10.8) (the eastern trail; cover from Guard B's south
      // stop), (6.8, 20.5) → (6.8, 17.8) (the northern trail; cover from Guard A, 21° off his south-east facing). (−12, 27) stays: it hides a crouch
      // from the north lookout on the way to the END trail
      [-3.5, -17, 1.3, 2.0],     // the first look at the forest, at the trail's mouth
      [8, -17.8, 1.0, 1.1],
      [-21, 4.5, 1.2, 2.2], [21.5, -10.8, 1.2, 2.0], [6.8, 17.8, 1.0, 1.6], [-12, 27, 1.1, 1.8],
    ],
    // bushes: for looks only (no collision, no concealment yet: that's a later step), and only in the outer band of the
    // forest, `bushBand` m in from its edge, clear of the trails, the compound and every patrol route (Forest cleanup: were 26 anywhere)
    bushes: 12, bushBand: 8,
    // the forest's edge (looks only): a ring every `spacing` m along the boundary, `near` [from, + up to] m outside it, and every
    // `backEvery`-th spot a second tree further out (`far`); this share of the spots are rocks instead (Forest cleanup: a little
    // sparser than the 2.8 m / 10 % it was; still a closed wood all round)
    edge: { spacing: 3.2, near: [1.5, 1.6], far: [4.5, 2.2], backEvery: 2, rocks: 0.06 },
    // dirt trails (standard ground for noise, like the lab's concrete): [minX, maxX, minZ, maxZ]
    trails: [
      [-1.8, 1.8, -40, -20],      // the southern START trail
      [-20, 26, -15.5, -12.5],    // across the south of the forest
      [-17.5, -14.5, -15.5, 22],  // the western way north
      [23.5, 26.5, -15.5, 22],    // the eastern way north
      [-17.5, 26.5, 19, 22],      // across the north
      [-5.5, -2, 19, 40],         // the northern END trail
      [0.5, 4.5, -12.5, -8],      // to the compound's south opening
      [0, 3.5, 14, 19],           // from its north opening
    ],
    // ---- the five guard assignments (four on by default: A, B, C, E; D is off until switched on). Patrols use the existing waypoint routine;
    // a lookout's waypoints all stand at his post, so he only turns from one facing to the next
    guards: [
      { key: 'A', enabled: true, label: 'Guard A — North Lookout', role: 'lookout', x: -4, z: 22.7, yaw: 180 * D,
        personality: { primary: 'focused', secondary: 'bored', seed: 2401 },
        patrol: { enabled: true, loop: true, seed: 2402, points: [
          { x: -4, z: 22.7, pause: [3, 4], face: 180, looks: [] },
          { x: -4, z: 22.7, pause: [3, 4], face: 225, looks: [] },
          { x: -4, z: 22.7, pause: [3, 4], face: 180, looks: [] },
          { x: -4, z: 22.7, pause: [3, 4], face: 135, looks: [] },
        ] } },
      // Step 24.2: a rounded six-point loop round his container (was eight points); he stops at its north, east and south
      { key: 'B', enabled: true, label: 'Guard B — East Patrol', role: 'patrol', x: 18.5, z: 13, yaw: 0,
        personality: { primary: 'curious', secondary: 'bored', seed: 2411 },
        patrol: { enabled: true, loop: true, push: 0.42, seed: 2412, points: [
          { x: 18.5, z: 13, pause: [2, 3], face: 0, looks: [-40, 35] },       // north: up toward the north lookout's ground
          { x: 23.8, z: 8.5 },
          { x: 23.8, z: 1, pause: [2, 3], face: 90, looks: [-40, 40] },       // east: along the eastern lane
          { x: 19.5, z: -4.5, pause: [2, 3], face: 180, looks: [35, -40] },   // south: back down the forest
          { x: 15.2, z: -0.5 }, { x: 15.3, z: 8.5 },
        ] } },
      { key: 'C', enabled: true, label: 'Guard C — Compound Patrol', role: 'patrol', x: -3.1, z: 10.2, yaw: 0,
        personality: { primary: 'focused', secondary: 'curious', seed: 2421 },
        patrol: { enabled: true, loop: true, push: 0.42, seed: 2422, points: [
          { x: -3.1, z: 10.2, pause: [1.5, 2], face: 0, looks: [-50] },       // north-west corner: toward the north opening
          { x: 8.6, z: 10.2, pause: [1, 1.5], face: 90, looks: [] },
          { x: 8.6, z: -4.5, pause: [1.5, 2], face: 180, looks: [40] },       // south-east corner: toward the south opening
          { x: -3.1, z: -4.5, pause: [1, 1.5], face: 270, looks: [] },
        ] } },
      // Step 24.1: the southern entrance, where the START trail opens into the forest: a short walk along the trail
      // across it, stopping at each end to watch the trail's mouth (out of sight of the START itself, 22 m off)
      { key: 'E', enabled: true, label: 'Guard E — South Entrance', role: 'patrol', x: -8, z: -14, yaw: 135 * D,
        personality: { primary: 'curious', secondary: 'focused', seed: 2441 },
        // Step 24.2: a small four-point loop across the mouth (was two points walked back and forth)
        patrol: { enabled: true, loop: true, push: 0.42, seed: 2442, points: [
          { x: -8, z: -14, pause: [2.5, 3.5], face: 135, looks: [-35] },     // west: toward the trail's mouth
          { x: 0, z: -11 },
          { x: 8, z: -14, pause: [2.5, 3.5], face: 225, looks: [35] },       // east: toward it from the other side
          { x: 0, z: -15.5 },
        ] } },
      { key: 'D', enabled: false, label: 'Guard D — West Lookout', role: 'lookout', x: -18.3, z: 14.4, yaw: 180 * D,
        personality: { primary: 'careless', secondary: 'curious', seed: 2431 },
        patrol: { enabled: true, loop: true, seed: 2432, points: [
          { x: -18.3, z: 14.4, pause: [3, 5], face: 180, looks: [] },
          { x: -18.3, z: 14.4, pause: [3, 4], face: 140, looks: [] },
          { x: -18.3, z: 14.4, pause: [3, 5], face: 180, looks: [] },
          { x: -18.3, z: 14.4, pause: [3, 4], face: 220, looks: [] },
        ] } },
    ],
  };

  // ---------------------------------------------------------------- building it
  function canvasTex(renderer, size, paint, repeat) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    paint(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); if (repeat) t.repeat.set(repeat[0], repeat[1]);
    return t;
  }
  const seeded = s => () => ((s = (s * 16807) % 2147483647) / 2147483647);

  // group: where the level's objects go (hidden while another level is loaded); world: the collision world (already fresh)
  mv.buildForestOutpost = function (group, world, renderer, L) {
    L = L || mv.FOREST_OUTPOST;
    const rnd = seeded(24), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    world.defaultSurface = L.defaultSurface; world.bounds = L.bounds;
    const lam = (hex, flat) => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex).convertSRGBToLinear(), flatShading: !!flat });
    const mats = {
      ground: new THREE.MeshLambertMaterial({ map: canvasTex(renderer, 256, (g, s) => {
        g.fillStyle = '#3c5228'; g.fillRect(0, 0, s, s); const r = seeded(5);
        for (let i = 0; i < 2600; i++) { const v = r(); g.fillStyle = v < 0.4 ? '#4a6331' : v < 0.75 ? '#33461f' : '#5a6e38'; g.fillRect(r() * s, r() * s, 2 + r() * 3, 1 + r() * 4); }
        for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(92,74,48,0.35)'; g.beginPath(); g.arc(r() * s, r() * s, 2 + r() * 6, 0, 7); g.fill(); }
      }, [32, 36]) }),
      dirt: new THREE.MeshLambertMaterial({ map: canvasTex(renderer, 128, (g, s) => {
        g.fillStyle = '#6b5638'; g.fillRect(0, 0, s, s); const r = seeded(9);
        for (let i = 0; i < 900; i++) { const v = 80 + r() * 50 | 0; g.fillStyle = `rgba(${v + 20},${v},${v - 25},0.45)`; g.fillRect(r() * s, r() * s, 1 + r() * 3, 1 + r() * 3); }
      }) }),
      // (flat colours given as they should look: three.js r128 takes a hex colour as linear, so each is converted from sRGB)
      slab: lam(0x6f706a), wall: lam(0x8a897f), crate: lam(0x6b6048), container: lam(0x4f5c3e), barrier: lam(0x86857c),
      log: lam(0x5c4431), bark: lam(0x4d3a2a), leaves: lam(0x34502b), leavesDark: lam(0x263f22),
      rock: lam(0x6d6d66, true), bush: lam(0x2f4a26, true),
      exit: new THREE.MeshBasicMaterial({ color: 0xa7c46a, transparent: true, opacity: 0.22, depthWrite: false }),
    };
    const out = { meshes: {}, counts: {} };

    // the forest floor (grass) and the trails (dirt) and the compound's slab (concrete)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 110).rotateX(-Math.PI / 2), mats.ground);
    ground.receiveShadow = true; group.add(ground);
    for (const [x0, x1, z0, z1] of L.trails) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), mats.dirt);
      m.material.map.repeat.set(1, 1); m.position.set((x0 + x1) / 2, 0.004, (z0 + z1) / 2); m.receiveShadow = true; group.add(m);
      world.addSurface((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 'dirt');
    }
    const C = L.compound;
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(C.maxX - C.minX, C.maxZ - C.minZ).rotateX(-Math.PI / 2), mats.slab);
    slab.position.set((C.minX + C.maxX) / 2, 0.008, (C.minZ + C.maxZ) / 2); slab.receiveShadow = true; group.add(slab);
    world.addSurface((C.minX + C.maxX) / 2, (C.minZ + C.maxZ) / 2, C.maxX - C.minX, C.maxZ - C.minZ, 'concrete');

    // solid boxes: walls, blocks, low cover
    const box = (x, z, w, d, h, mat, kind) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.kind = kind;
      group.add(mesh); world.addBox(x, z, w, d, h, mesh); return mesh;
    };
    const wall = (x0, z0, x1, z1) => { const t = C.wallT; box((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) || t, Math.abs(z1 - z0) || t, C.wallH, mats.wall, 'wall'); };
    wall(C.minX, C.maxZ, C.north[0], C.maxZ); wall(C.north[1], C.maxZ, C.maxX + C.wallT / 2, C.maxZ);   // north, with its opening
    wall(C.minX, C.minZ, C.south[0], C.minZ); wall(C.south[1], C.minZ, C.maxX + C.wallT / 2, C.minZ);   // south, with its opening
    wall(C.minX, C.minZ, C.minX, C.maxZ); wall(C.maxX, C.minZ, C.maxX, C.maxZ);                         // west, east
    for (const [x, z, w, d, h, kind] of L.blocks) box(x, z, w, d, h, mats[kind], kind);
    for (const [x, z, len, along, kind] of L.low) {
      const w = along === 'x' ? len : 0.6, d = along === 'x' ? 0.6 : len;
      if (kind === 'log') {   // a fallen log (round to look at, a box to the world)
        const m = new THREE.Mesh(new THREE.CylinderGeometry(L.lowH / 2, L.lowH / 2 * 0.9, len, 9), mats.log);
        m.rotation.set(along === 'x' ? 0 : Math.PI / 2, 0, along === 'x' ? Math.PI / 2 : 0); m.position.set(x, L.lowH / 2, z);
        m.castShadow = true; m.receiveShadow = true; m.userData.kind = 'log'; group.add(m); world.addBox(x, z, w, d, L.lowH, m);
      } else box(x, z, w, d, L.lowH, mats.barrier, kind);
    }

    // trees in play: a trunk (collision, cover) and one canopy above it. The trunks (and the rocks below) are one
    // instanced mesh each, always tested by the camera and by bullets; everything that's only looked at (canopies,
    // the forest's edge, bushes) is instanced in chunks of the map, so what's off screen isn't drawn (three.js r128
    // never culls a single instanced mesh: it would draw every tree every frame, and again into the shadow map)
    const trunkG = new THREE.CylinderGeometry(0.8, 1, 1, 7).translate(0, 0.5, 0), canopyG = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
    const inst = (geo, mat, n, kind, collide) => { const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = true; m.userData.kind = kind; group.add(m); if (collide) world.meshes.push(m); return m; };
    const CHUNK = 26, chunks = [];
    const chunked = (geo, mat, list, kind, shadow) => {   // list: [{ x, z, m (Matrix4), reach (m) }]
      const cells = new Map();
      for (const it of list) { const k = Math.floor(it.x / CHUNK) + ',' + Math.floor(it.z / CHUNK); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(it); }
      for (const items of cells.values()) {
        const g = geo.clone(), c = new THREE.Vector3();
        for (const it of items) c.x += it.x / items.length, c.z += it.z / items.length;
        let r = 0; for (const it of items) r = Math.max(r, Math.hypot(it.x - c.x, it.z - c.z) + it.reach);
        c.y = 4; g.boundingSphere = new THREE.Sphere(c, r + 5);
        const im = new THREE.InstancedMesh(g, mat, items.length); items.forEach((it, i) => im.setMatrixAt(i, it.m));
        im.frustumCulled = true; im.castShadow = !!shadow; im.userData.kind = kind; im.instanceMatrix.needsUpdate = true; group.add(im); chunks.push(im);
      }
    };
    const trunks = inst(trunkG, mats.bark, L.trees.length, 'tree', true), crownList = [];
    L.trees.forEach(([x, z, r], i) => {
      const h = 7 + rnd() * 3;
      trunks.setMatrixAt(i, M4.compose(P.set(x, 0, z), Q.identity(), S.set(r, h, r)));
      world.addCylinder(x, z, r, h, null);
      const cr = 1.9 + rnd() * 0.7;
      crownList.push({ x, z, reach: cr, m: M4.clone().compose(P.set(x, 4.3 + rnd() * 0.5, z), Q.setFromAxisAngle(UP, rnd() * 6), S.set(cr, 4.6, cr)) });
    });
    chunked(canopyG, mats.leaves, crownList, 'leaves', true);
    out.meshes.trunks = trunks; out.counts.trees = L.trees.length;

    // rocks in play
    const rockG = new THREE.DodecahedronGeometry(1, 0);
    const rocks = inst(rockG, mats.rock, L.rocks.length, 'rock', true);
    L.rocks.forEach(([x, z, r, h], i) => {
      rocks.setMatrixAt(i, M4.compose(P.set(x, h * 0.42, z), Q.setFromAxisAngle(UP, rnd() * 6), S.set(r * 1.05, h * 0.62, r * 1.05)));
      world.addCylinder(x, z, r, h, null);
    });
    out.counts.rocks = L.rocks.length;

    // the forest's edge: a ring of trees just outside the playable area and a sparser one behind it, some rocks
    // (looks only: the bounds keep her and the guards in; nothing out there is ever reached)
    const edge = [], edgeRocks = [], B = L.bounds, E = L.edge;
    const insideB = (x, z) => { let ins = false; for (let i = 0, j = B.length - 1; i < B.length; j = i++) { const [ax, az] = B[j], [cx, cz] = B[i]; if ((cz > z) !== (az > z) && x < (ax - cx) * (z - cz) / (az - cz) + cx) ins = !ins; } return ins; };
    let along = 0;
    for (let i = 0; i < B.length; i++) {
      const [ax, az] = B[i], [bx, bz] = B[(i + 1) % B.length], len = Math.hypot(bx - ax, bz - az);
      let nx = (bz - az) / len, nz = -(bx - ax) / len;
      if (insideB((ax + bx) / 2 + nx * 0.5, (az + bz) / 2 + nz * 0.5)) { nx = -nx; nz = -nz; }   // (outward)
      for (let k = 0; k < len; k += E.spacing) {
        const t = (k + rnd() * E.spacing * 0.5) / len, x = ax + (bx - ax) * t, z = az + (bz - az) * t, back = (along++ % E.backEvery) === 0;
        for (const off of back ? [E.near[0] + rnd() * E.near[1], E.far[0] + rnd() * E.far[1]] : [E.near[0] + rnd() * E.near[1]]) {
          const px = x + nx * off, pz = z + nz * off;
          if (!insideB(px, pz)) (rnd() < E.rocks ? edgeRocks : edge).push([px, pz]);
        }
      }
    }
    const eTrunkList = [], eCrownList = [], eRockList = [];
    edge.forEach(([x, z]) => {
      const r = 0.3 + rnd() * 0.15, h = 8 + rnd() * 3, cr = 2.2 + rnd();
      eTrunkList.push({ x, z, reach: r, m: M4.clone().compose(P.set(x, 0, z), Q.identity(), S.set(r, h, r)) });
      eCrownList.push({ x, z, reach: cr, m: M4.clone().compose(P.set(x, 2.8 + rnd(), z), Q.setFromAxisAngle(UP, rnd() * 6), S.set(cr, 6.4, cr)) });
    });
    edgeRocks.forEach(([x, z]) => { const r = 1 + rnd() * 1.2; eRockList.push({ x, z, reach: r, m: M4.clone().compose(P.set(x, r * 0.4, z), Q.setFromAxisAngle(UP, rnd() * 6), S.set(r, r * 0.9, r)) }); });
    chunked(trunkG, mats.bark, eTrunkList, 'tree', false); chunked(canopyG, mats.leavesDark, eCrownList, 'leaves', false); chunked(rockG, mats.rock, eRockList, 'rock', false);
    out.counts.edgeTrees = edge.length; out.counts.edgeRocks = edgeRocks.length;

    // bushes: looks only (no collision, no concealment yet), in the outer band only, kept off the trails, out of the compound
    // and away from every patrol route, so the ground round the routes and the compound stays open
    const bushG = new THREE.IcosahedronGeometry(1, 0), bushList = [];
    const onTrail = (x, z) => L.trails.some(([x0, x1, z0, z1]) => x > x0 - 2.5 && x < x1 + 2.5 && z > z0 - 2.5 && z < z1 + 2.5) || (x > C.minX - 2.5 && x < C.maxX + 2.5 && z > C.minZ - 2.5 && z < C.maxZ + 2.5);
    const toEdge = (x, z) => { let d = 1e9; for (let i = 0; i < B.length; i++) { const [ax, az] = B[i], [bx, bz] = B[(i + 1) % B.length], vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz))); d = Math.min(d, Math.hypot(x - ax - vx * t, z - az - vz * t)); } return d; };
    const nearRoute = (x, z) => L.guards.some(g => g.patrol.points.some((q, i, pts) => { const r = pts[(i + 1) % pts.length], vx = r.x - q.x, vz = r.z - q.z, L2 = vx * vx + vz * vz, t = L2 ? Math.max(0, Math.min(1, ((x - q.x) * vx + (z - q.z) * vz) / L2)) : 0; return Math.hypot(x - q.x - vx * t, z - q.z - vz * t) < 4; }));
    for (let tries = 0; bushList.length < L.bushes && tries < 4000; tries++) {
      const x = -29 + rnd() * 58, z = -24 + rnd() * 52;
      if (!world.inBounds(x, z, 1.5) || toEdge(x, z) > L.bushBand || onTrail(x, z) || nearRoute(x, z)) continue;
      const r = 0.5 + rnd() * 0.5;
      bushList.push({ x, z, reach: r * 1.2, m: M4.clone().compose(P.set(x, r * 0.45, z), Q.setFromAxisAngle(UP, rnd() * 6), S.set(r * 1.2, r * 0.75, r * 1.2)) });
    }
    chunked(bushG, mats.bush, bushList, 'bush', false); out.counts.bushes = bushList.length;

    // the END: a faint marker on the trail's far end
    const X = L.exit, mark = new THREE.Mesh(new THREE.PlaneGeometry(X.maxX - X.minX, X.maxZ - X.minZ).rotateX(-Math.PI / 2), mats.exit);
    mark.position.set((X.minX + X.maxX) / 2, 0.012, (X.minZ + X.maxZ) / 2); mark.renderOrder = 2; group.add(mark);
    for (const im of [trunks, rocks]) im.instanceMatrix.needsUpdate = true;
    out.counts.chunks = chunks.length;

    return Object.assign(out, {
      id: L.id, name: L.name, objective: L.objective, spawn: L.spawn, exit: L.exit, bounds: L.bounds, compound: C,
      guards: L.guards.map(g => Object.assign({}, g, { patrol: Object.assign({}, g.patrol, { points: g.patrol.points.map(p => Object.assign({}, p)) }) })),
    });
  };
})(SC.mv);
