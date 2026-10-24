// SHADOW CELL — movement: Stage 1 test yard.
// A flat 44 × 44 m concrete yard with a 1 m grid. It contains:
// - a 30 m speed lane with markings every 5 m
// - crates and pillars to collide with
// - a long wall and a narrow L-shaped corridor to test wall sliding and camera pull-in
// - a perimeter wall
// - three surface test strips just ahead of the start: concrete, metal, grass
// - a stationary test guard behind the start (placed by main.js at `guard`), looking
//   toward it, with a low crate, a tall crate and a 1.5 m crate inside his view
(function (mv) {
  'use strict';

  function gridTexture(renderer) {
    const S = 512, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#5b5d57'; g.fillRect(0, 0, S, S);
    let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1800; i++) { const v = 70 + rnd() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v - 6},0.25)`; g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 6, 2 + rnd() * 6); }
    // one texture tile = 4 m: thin line every metre, heavier line at the tile edge
    g.strokeStyle = 'rgba(30,32,28,0.45)'; g.lineWidth = 2;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * S / 4, 0); g.lineTo(i * S / 4, S); g.moveTo(0, i * S / 4); g.lineTo(S, i * S / 4); g.stroke(); }
    g.strokeStyle = 'rgba(25,26,22,0.8)'; g.lineWidth = 4; g.strokeRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  // one canvas texture per surface strip (w × d metres), labelled at the edge
  // nearest the start so it reads the right way up from there
  function surfaceTexture(renderer, type, w, d) {
    const PX = 96, c = document.createElement('canvas');
    c.width = w * PX; c.height = d * PX;
    const g = c.getContext('2d'), W = c.width, H = c.height;
    let seed = type.length * 7 + 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    if (type === 'metal') {
      // diamond (tread) plate
      g.fillStyle = '#4e545a'; g.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 24) for (let x = (y / 24) % 2 ? 12 : 0; x < W; x += 24) {
        g.save(); g.translate(x, y); g.rotate(((x + y) / 24) % 2 ? 0.6 : -0.6);
        g.fillStyle = '#6c737a'; g.fillRect(-7, -2, 14, 4); g.fillStyle = '#2f3337'; g.fillRect(-7, 2, 14, 1.5); g.restore();
      }
      g.strokeStyle = '#2a2e32'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
      g.fillStyle = '#1f2326'; for (const [x, y] of [[14, 14], [W - 14, 14], [14, H - 14], [W - 14, H - 14]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
    } else if (type === 'grass') {
      g.fillStyle = '#3f5a2a'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 9000; i++) {
        const x = rnd() * W, y = rnd() * H, l = 5 + rnd() * 9, v = rnd();
        g.strokeStyle = v < 0.33 ? '#56783a' : v < 0.66 ? '#30481f' : '#6b8c45'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 5, y - l); g.stroke();
      }
    } else {
      // a poured slab, a little lighter than the yard
      g.fillStyle = '#7a7b74'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 2500; i++) { const v = 100 + rnd() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v - 4},0.3)`; g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 4, 2 + rnd() * 4); }
      g.strokeStyle = 'rgba(40,40,36,0.7)'; g.lineWidth = 3; g.strokeRect(2, 2, W - 4, H - 4);
      g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    }
    // label near the start edge (canvas top maps to the near, -Z end), turned to face the start
    g.save(); g.translate(W / 2, 30); g.rotate(Math.PI);
    g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(232,224,180,0.9)'; g.fillText(type.toUpperCase(), 0, 0); g.restore();
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  mv.buildTestArea = function (scene, world, renderer) {
    const SIZE = 44;
    // The guard's patrol route (Step 9; guard-patrol.js has the other settings): his post,
    // the open ground by the corridor entrance, the north side facing the surface strips,
    // then back past the tall crate (walked straight through). Observation points: pause
    // [min, max] s, facing (°, 0 = +Z, 90 = +X) and looks (° from that facing). Every point
    // is more than 16 m (his sight range) from the player's spawn. enabled: false = stationary.
    const PATROL = {
      enabled: true, loop: true, push: 0.42,
      points: [
        { x: 2, z: -16, pause: [2, 3], face: 0, looks: [-40, 35] },
        { x: 12, z: -11, pause: [1.5, 2.5], face: 90, looks: [-50, 40] },
        { x: 6.5, z: -1, pause: [1.5, 3], face: -35, looks: [40, -30] },
        { x: 0.5, z: -10.5 },
      ],
    };
    // The guard's post, and the player's spawn (the one place to change it; RESET returns
    // here). The spawn is in the yard's west corner, 19 m from the guard (beyond his 16 m
    // sight range) and 84° off his facing (outside his 55° half-cone), in open ground
    // (3.6 m to the nearest pillar, 5 m to the wall), facing east toward the yard.
    // his two permanent personality traits (guard-personality.js). Test profiles (Step 11):
    // change PROFILE to compare them; all three have the same senses and movement
    const PROFILES = {
      A: { primary: 'curious', secondary: 'bored' },    // Step 10
      B: { primary: 'focused', secondary: 'bored' },    // default
      C: { primary: 'careless', secondary: 'bored' },   // comparison
    };
    const PROFILE = 'B';
    const GUARD = { x: 2, z: -16, yaw: 0, patrol: PATROL, personality: PROFILES[PROFILE] };
    const SPAWN = { x: -17, z: -14, yaw: Math.PI / 2 };
    const tex = gridTexture(renderer);
    tex.repeat.set(SIZE / 4, SIZE / 4);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }));
    ground.receiveShadow = true;
    scene.add(ground);

    const mats = {
      crate: new THREE.MeshLambertMaterial({ color: 0x6d5f44 }),
      crateDark: new THREE.MeshLambertMaterial({ color: 0x4f4a38 }),
      wall: new THREE.MeshLambertMaterial({ color: 0x77786e }),
      pillar: new THREE.MeshLambertMaterial({ color: 0x8a8a7e }),
      paint: new THREE.MeshBasicMaterial({ color: 0xd8cfa0 }),
      accent: new THREE.MeshLambertMaterial({ color: 0x9b4a32 }),
    };
    const box = (x, z, w, d, h, m, rotY) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true;
      if (rotY) mesh.rotation.y = rotY;
      scene.add(mesh);
      world.addBox(x, z, rotY ? d : w, rotY ? w : d, h, mesh);
      return mesh;
    };
    const pillar = (x, z, r, h) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), mats.pillar);
      mesh.position.set(x, h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh); world.addCylinder(x, z, r, h, mesh);
    };

    // perimeter
    const H = SIZE / 2;
    box(0, -H, SIZE, 0.5, 1.4, mats.wall); box(0, H, SIZE, 0.5, 1.4, mats.wall);
    box(-H, 0, 0.5, SIZE, 1.4, mats.wall); box(H, 0, 0.5, SIZE, 1.4, mats.wall);

    // speed lane along +Z from the start, painted every 5 m
    for (let m = 0; m <= 30; m += 5) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(3, m % 10 === 0 ? 0.18 : 0.08).rotateX(-Math.PI / 2), mats.paint);
      stripe.position.set(-6, 0.005, -18 + m + 2); scene.add(stripe);
    }
    for (const sx of [-7.5, -4.5]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 30).rotateX(-Math.PI / 2), mats.paint);
      edge.position.set(sx, 0.005, -1); scene.add(edge);
    }

    // crates: a cluster plus scattered singles of different heights
    box(6, 4, 1.2, 1.2, 1.2, mats.crate); box(7.3, 4, 1.2, 1.2, 1.2, mats.crateDark); box(6.6, 5.3, 1.2, 1.2, 2.4, mats.crate);
    box(3, -5, 2, 1, 0.9, mats.crateDark); box(10, -8, 1.5, 1.5, 1.5, mats.crate); box(8, -14, 3, 0.6, 1.1, mats.crateDark);
    box(12, 9, 1, 1, 1, mats.crate, 0); box(13.2, 10.4, 1.4, 1.4, 1.4, mats.crateDark);

    // pillars for weaving at speed
    for (let i = 0; i < 6; i++) pillar(-14 + (i % 2) * 2.2, -12 + i * 4, 0.35, 3);

    // long wall with a gap, for wall sliding
    box(4, 13, 12, 0.35, 2.6, mats.wall);
    box(14, 13, 4, 0.35, 2.6, mats.wall);

    // L-shaped corridor (1.6 m wide) for camera collision
    box(16, -4, 0.35, 12, 2.8, mats.wall);
    box(18, -2, 0.35, 8, 2.8, mats.wall);
    box(17.1, -10, 2.15, 0.35, 2.8, mats.wall);
    box(12.5, 2, 7.3, 0.35, 2.8, mats.wall);
    box(14.2, 3.6, 3.8, 0.35, 2.8, mats.wall);

    // tall crate (2 m) in the guard's view, for hiding behind standing up
    box(-2, -8, 1.2, 1.2, 2.0, mats.crateDark);

    // surface test strips, 3 × 5 m, side by side from 4 m ahead of the start
    for (const [type, x] of [['concrete', -3.3], ['metal', 0], ['grass', 3.3]]) {
      const w = 3, d = 5, z = 6.5;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: surfaceTexture(renderer, type, w, d) }));
      strip.position.set(x, 0.004, z); strip.receiveShadow = true; scene.add(strip);
      world.addSurface(x, z, w, d, type);
    }

    // start pad, at the player's spawn
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.65, 32).rotateX(-Math.PI / 2), mats.paint);
    pad.position.set(SPAWN.x, 0.006, SPAWN.z); scene.add(pad);

    return { spawn: SPAWN, size: SIZE, guard: GUARD, profiles: PROFILES, profile: PROFILE };
  };
})(SC.mv);
