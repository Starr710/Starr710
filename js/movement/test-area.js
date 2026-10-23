// SHADOW CELL — movement: Stage 1 test yard.
// A flat 44 × 44 m concrete yard with a 1 m grid. It contains:
// - a 30 m sprint lane with markings every 5 m
// - crates and pillars to collide with
// - a long wall and a narrow L-shaped corridor to test wall sliding and camera pull-in
// - a perimeter wall
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

  mv.buildTestArea = function (scene, world, renderer) {
    const SIZE = 44;
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

    // sprint lane along +Z from the start, painted every 5 m
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

    // start pad
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.65, 32).rotateX(-Math.PI / 2), mats.paint);
    pad.position.set(0, 0.006, 0); scene.add(pad);

    return { spawn: { x: 0, z: 0, yaw: 0 }, size: SIZE };
  };
})(SC.mv);
