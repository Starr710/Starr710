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
      [-9, -17, 0.34], [4.5, -17.5, 0.3], [9.5, -19.5, 0.36], [14, -17, 0.32], [-15, -18, 0.38], [20, -15.5, 0.34], [-21, -12, 0.36],
      [-26, -6, 0.4], [-18.5, -7.5, 0.34], [-13, -3, 0.3], [-27, 3, 0.38], [-17, 1.5, 0.32], [-12, 10.5, 0.36], [-25, 17, 0.4], [-14.5, 18.5, 0.34], [-20, 22, 0.36], [-11.5, 24, 0.32],
      [27, -8, 0.36], [26, 12.5, 0.38], [27.3, 4, 0.32], [14.5, -12.5, 0.3], [22, 19.5, 0.36], [13, 22.5, 0.34],
      [6, 24.5, 0.36], [10.5, 18.5, 0.32], [3, 27.5, 0.3], [-7.5, 16.8, 0.34],
    ],
    // rocks in play: [x, z, radius, height] (≥ 1.6 m tall: full cover; under 1 m: waist-high)
    rocks: [
      [-3.5, -17, 1.3, 2.0],     // the first look at the forest, at the trail's mouth
      [8, -17.8, 1.0, 1.1],
      [-21, 4.5, 1.2, 2.2], [-9.5, 20, 1.1, 1.8], [24.5, -12, 1.2, 2.0], [16, 21, 0.9, 1.0], [6.8, 20.5, 1.0, 1.6], [-12, 27, 1.1, 1.8],
      [-26.5, -12.5, 1.0, 0.9],
    ],
    bushes: 34,   // scattered, for looks only (no collision, no concealment yet)
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
    // ---- the four guard assignments (three on by default). Patrols use the existing waypoint routine;
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
      { key: 'B', enabled: true, label: 'Guard B — East Patrol', role: 'patrol', x: 17.6, z: 15.5, yaw: 0,
        personality: { primary: 'curious', secondary: 'bored', seed: 2411 },
        patrol: { enabled: true, loop: true, push: 0.42, seed: 2412, points: [
          { x: 17.6, z: 15.5, pause: [2, 3], face: 0, looks: [-40, 35] },     // north end: looks up toward the north lookout's ground
          { x: 22.5, z: 12 }, { x: 24.2, z: 4.5 }, { x: 23, z: -1.5 },
          { x: 20, z: -5, pause: [2, 3], face: 180, looks: [35, -40] },       // south end: looks back down the forest
          { x: 16.2, z: -2 }, { x: 15.2, z: 4.5 }, { x: 15.8, z: 11 },
        ] } },
      { key: 'C', enabled: true, label: 'Guard C — Compound Patrol', role: 'patrol', x: -3.1, z: 10.2, yaw: 0,
        personality: { primary: 'focused', secondary: 'curious', seed: 2421 },
        patrol: { enabled: true, loop: true, push: 0.42, seed: 2422, points: [
          { x: -3.1, z: 10.2, pause: [1.5, 2], face: 0, looks: [-50] },       // north-west corner: toward the north opening
          { x: 8.6, z: 10.2, pause: [1, 1.5], face: 90, looks: [] },
          { x: 8.6, z: -4.5, pause: [1.5, 2], face: 180, looks: [40] },       // south-east corner: toward the south opening
          { x: -3.1, z: -4.5, pause: [1, 1.5], face: 270, looks: [] },
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

    // trees in play: a trunk (collision, cover) and a canopy above it; one instanced mesh each
    const trunkG = new THREE.CylinderGeometry(0.8, 1, 1, 7).translate(0, 0.5, 0), canopyG = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
    const inst = (geo, mat, n, kind, collide) => { const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = true; m.userData.kind = kind; group.add(m); if (collide) world.meshes.push(m); return m; };
    const trunks = inst(trunkG, mats.bark, L.trees.length, 'tree', true), crowns = inst(canopyG, mats.leaves, L.trees.length * 2, 'leaves', false);
    L.trees.forEach(([x, z, r], i) => {
      const h = 7 + rnd() * 3;
      trunks.setMatrixAt(i, M4.compose(P.set(x, 0, z), Q.identity(), S.set(r, h, r)));
      world.addCylinder(x, z, r, h, null);
      const cr = 1.8 + rnd() * 0.8;
      crowns.setMatrixAt(i * 2, M4.compose(P.set(x, 4.2 + rnd() * 0.5, z), Q.setFromAxisAngle(UP, rnd() * 6), S.set(cr, 3.4, cr)));
      crowns.setMatrixAt(i * 2 + 1, M4.compose(P.set(x, 6.2 + rnd() * 0.4, z), Q.setFromAxisAngle(UP, rnd() * 6), S.set(cr * 0.7, 2.8, cr * 0.7)));
    });
    out.meshes.trunks = trunks; out.counts.trees = L.trees.length;

    // rocks in play
    const rockG = new THREE.DodecahedronGeometry(1, 0);
    const rocks = inst(rockG, mats.rock, L.rocks.length, 'rock', true);
    L.rocks.forEach(([x, z, r, h], i) => {
      rocks.setMatrixAt(i, M4.compose(P.set(x, h * 0.42, z), Q.setFromAxisAngle(UP, rnd() * 6), S.set(r * 1.05, h * 0.62, r * 1.05)));
      world.addCylinder(x, z, r, h, null);
    });
    out.counts.rocks = L.rocks.length;

    // the forest's edge: dense trees and some rocks just outside the playable area (looks only:
    // the bounds keep her and the guards in; nothing out there is ever reached)
    const edge = [], edgeRocks = [], B = L.bounds;
    const insideB = (x, z) => { let ins = false; for (let i = 0, j = B.length - 1; i < B.length; j = i++) { const [ax, az] = B[j], [cx, cz] = B[i]; if ((cz > z) !== (az > z) && x < (ax - cx) * (z - cz) / (az - cz) + cx) ins = !ins; } return ins; };
    for (let i = 0; i < B.length; i++) {
      const [ax, az] = B[i], [bx, bz] = B[(i + 1) % B.length], len = Math.hypot(bx - ax, bz - az);
      let nx = (bz - az) / len, nz = -(bx - ax) / len;
      if (insideB((ax + bx) / 2 + nx * 0.5, (az + bz) / 2 + nz * 0.5)) { nx = -nx; nz = -nz; }   // (outward)
      for (let k = 0; k < len; k += 2.2) {
        const t = (k + rnd() * 1.2) / len, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        for (const off of [1.4 + rnd() * 1.2, 4 + rnd() * 2.5]) {
          const px = x + nx * off, pz = z + nz * off;
          if (!insideB(px, pz)) (rnd() < 0.08 ? edgeRocks : edge).push([px, pz]);
        }
      }
    }
    const eTrunks = inst(trunkG, mats.bark, edge.length, 'tree', false), eCrowns = inst(canopyG, mats.leavesDark, edge.length * 2, 'leaves', false);
    edge.forEach(([x, z], i) => {
      const r = 0.3 + rnd() * 0.15, h = 8 + rnd() * 3, cr = 2 + rnd();
      eTrunks.setMatrixAt(i, M4.compose(P.set(x, 0, z), Q.identity(), S.set(r, h, r)));
      eCrowns.setMatrixAt(i * 2, M4.compose(P.set(x, 2.6 + rnd(), z), Q.setFromAxisAngle(UP, rnd() * 6), S.set(cr, 4.2, cr)));
      eCrowns.setMatrixAt(i * 2 + 1, M4.compose(P.set(x, 5.8 + rnd(), z), Q.setFromAxisAngle(UP, rnd() * 6), S.set(cr * 0.75, 3.4, cr * 0.75)));
    });
    const eRocks = inst(rockG, mats.rock, Math.max(1, edgeRocks.length), 'rock', false);
    edgeRocks.forEach(([x, z], i) => { const r = 1 + rnd() * 1.2; eRocks.setMatrixAt(i, M4.compose(P.set(x, r * 0.4, z), Q.setFromAxisAngle(UP, rnd() * 6), S.set(r, r * 0.9, r))); });
    eTrunks.castShadow = eCrowns.castShadow = false;   // (outside the shadowed area round her anyway)
    out.counts.edgeTrees = edge.length; out.counts.edgeRocks = edgeRocks.length;

    // bushes: looks only (no collision, no concealment yet), kept off the trails and out of the compound
    const bushG = new THREE.IcosahedronGeometry(1, 0), bushes = inst(bushG, mats.bush, L.bushes, 'bush', false); bushes.castShadow = false;
    const onTrail = (x, z) => L.trails.some(([x0, x1, z0, z1]) => x > x0 - 1 && x < x1 + 1 && z > z0 - 1 && z < z1 + 1) || (x > C.minX - 1.5 && x < C.maxX + 1.5 && z > C.minZ - 1.5 && z < C.maxZ + 1.5);
    let nb = 0;
    for (let tries = 0; nb < L.bushes && tries < 2000; tries++) {
      const x = -29 + rnd() * 58, z = -24 + rnd() * 52;
      if (!world.inBounds(x, z, 1.5) || onTrail(x, z)) continue;
      const r = 0.5 + rnd() * 0.5;
      bushes.setMatrixAt(nb++, M4.compose(P.set(x, r * 0.45, z), Q.setFromAxisAngle(UP, rnd() * 6), S.set(r * 1.2, r * 0.75, r * 1.2)));
    }
    bushes.count = nb; out.counts.bushes = nb;

    // the END: a faint marker on the trail's far end
    const X = L.exit, mark = new THREE.Mesh(new THREE.PlaneGeometry(X.maxX - X.minX, X.maxZ - X.minZ).rotateX(-Math.PI / 2), mats.exit);
    mark.position.set((X.minX + X.maxX) / 2, 0.012, (X.minZ + X.maxZ) / 2); mark.renderOrder = 2; group.add(mark);
    for (const im of [trunks, crowns, rocks, eTrunks, eCrowns, eRocks, bushes]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere && im.computeBoundingSphere(); }

    return Object.assign(out, {
      id: L.id, name: L.name, objective: L.objective, spawn: L.spawn, exit: L.exit, bounds: L.bounds, compound: C,
      guards: L.guards.map(g => Object.assign({}, g, { patrol: Object.assign({}, g.patrol, { points: g.patrol.points.map(p => Object.assign({}, p)) }) })),
    });
  };
})(SC.mv);
