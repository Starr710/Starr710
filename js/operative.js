// SHADOW CELL — low-poly operative models with procedural animation.
// Each operative is a rig of pivot groups (hips, knees, shoulders, elbows) so stances
// and gaits are blended in code rather than baked into animation files.
(function (SC) {
  'use strict';

  // Gameplay stats live here too so Phase 2 character select can read them.
  SC.OPERATIVES = {
    ghost: { name: 'GHOST', role: 'INFILTRATOR', camo: 0.8, noise: 0.7, speed: 1.0, build: 1.0,
      colors: { fatigues: 0x2e3a2c, vest: 0x1f261d, skin: 0x8a6a50, head: 0x1c2219, accent: 0x3d4a36 }, headgear: 'hood' },
    hawk: { name: 'HAWK', role: 'RECON', camo: 1.0, noise: 0.9, speed: 1.05, build: 0.96,
      colors: { fatigues: 0x6b6046, vest: 0x4d4532, skin: 0x9c7458, head: 0x4a4430, accent: 0x7d6e4c }, headgear: 'boonie' },
    viper: { name: 'VIPER', role: 'TECHNICIAN', camo: 1.0, noise: 1.0, speed: 1.0, build: 0.94,
      colors: { fatigues: 0x4a5236, vest: 0x2e3326, skin: 0x7a5a44, head: 0x23281e, accent: 0x5fa8a0 }, headgear: 'goggles' },
    titan: { name: 'TITAN', role: 'SUPPORT', camo: 1.15, noise: 1.25, speed: 0.92, build: 1.18,
      colors: { fatigues: 0x544a36, vest: 0x3a3426, skin: 0x6e5040, head: 0x302a20, accent: 0x6a5a3c }, headgear: 'helmet' },
  };

  function box(w, h, d, color, y) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (y) g.translate(0, y, 0);
    const m = new THREE.Mesh(g, SC.world.mat(color));
    m.castShadow = true;
    return m;
  }
  function pivot(parent, x, y, z) { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; }

  SC.Operative = function (type) {
    const def = SC.OPERATIVES[type];
    const c = def.colors, B = def.build;
    this.type = type;
    this.def = def;
    const root = this.root = new THREE.Group();
    const pose = this.pose = pivot(root, 0, 0, 0);         // whole-body offset/rotation (prone)
    const hips = this.hips = pivot(pose, 0, 0.92, 0);      // pelvis

    // legs
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = pivot(hips, side * 0.12 * B, 0, 0);
      hip.add(box(0.17 * B, 0.46, 0.2 * B, c.fatigues, -0.23));
      const knee = pivot(hip, 0, -0.46, 0);
      knee.add(box(0.15 * B, 0.42, 0.17 * B, c.fatigues, -0.21));
      const boot = box(0.17 * B, 0.1, 0.3 * B, 0x1b1b17, -0.42); boot.position.z = 0.05; knee.add(boot);
      this.legs.push({ hip, knee });
    }

    // torso
    const torso = this.torso = pivot(hips, 0, 0.02, 0);
    torso.add(box(0.44 * B, 0.58, 0.26 * B, c.fatigues, 0.29));
    const vest = box(0.48 * B, 0.4, 0.31 * B, c.vest, 0.34); torso.add(vest);
    for (let i = -1; i <= 1; i++) { const p = box(0.11, 0.13, 0.06, c.accent, 0.27); p.position.set(i * 0.13 * B, 0, 0.17 * B); torso.add(p); }
    const pack = box(0.36 * B, 0.42, 0.18 * B, c.accent, 0.36); pack.position.z = -0.22 * B; torso.add(pack);
    if (type === 'hawk') { const ant = box(0.02, 0.5, 0.02, 0x222222, 0.8); ant.position.set(0.12, 0, -0.26); torso.add(ant); }
    if (type === 'titan') { const roll = box(0.42, 0.14, 0.14, 0x3b3b2c, 0.62); roll.position.z = -0.24; torso.add(roll); }

    // head
    const neck = this.neck = pivot(torso, 0, 0.6, 0.01);
    const head = box(0.22, 0.24, 0.23, c.skin, 0.13); neck.add(head);
    const face = box(0.2, 0.08, 0.02, 0x161814, 0.16); face.position.z = 0.12; neck.add(face); // eyes band / face paint
    if (def.headgear === 'hood') { const h = box(0.26, 0.16, 0.27, c.head, 0.24); h.position.z = -0.01; neck.add(h); const tail = box(0.05, 0.03, 0.25, c.head, 0.22); tail.position.z = -0.22; neck.add(tail); }
    if (def.headgear === 'boonie') { const brim = box(0.42, 0.03, 0.42, c.head, 0.25); neck.add(brim); neck.add(box(0.26, 0.1, 0.26, c.head, 0.3)); }
    if (def.headgear === 'goggles') { neck.add(box(0.25, 0.08, 0.26, c.head, 0.27)); const g = box(0.22, 0.06, 0.04, c.accent, 0.2); g.position.z = 0.12; g.material = SC.world.mat(c.accent, { emissive: 0x1a4a44 }); neck.add(g); }
    if (def.headgear === 'helmet') { const h = box(0.3, 0.14, 0.3, c.head, 0.29); neck.add(h); }

    // arms
    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = pivot(torso, side * 0.29 * B, 0.52, 0);
      sh.add(box(0.12 * B, 0.32, 0.13 * B, c.fatigues, -0.16));
      const el = pivot(sh, 0, -0.32, 0);
      el.add(box(0.11 * B, 0.3, 0.12 * B, c.fatigues, -0.15));
      el.add(box(0.1, 0.08, 0.1, 0x22251e, -0.32));
      this.arms.push({ sh, el, side });
    }
    // sidearm holstered on the thigh
    const holster = box(0.08, 0.18, 0.12, 0x1a1a16, -0.12); holster.position.set(0.1, 0, 0.02); this.legs[1].hip.add(holster);
    // pistol in right hand (shown while aiming)
    const gun = this.gun = new THREE.Group();
    const slide = box(0.05, 0.07, 0.24, 0x1d1f1b); slide.position.z = 0.07; gun.add(slide);
    const grip = box(0.045, 0.12, 0.06, 0x1d1f1b, -0.05); gun.add(grip);
    gun.position.set(0, -0.36, 0.04); gun.visible = false;
    this.arms[1].el.add(gun);

    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });

    this.phase = 0;
    this.blend = { crouch: 0, prone: 0, hug: 0, aim: 0 };
  };

  // state: {stance:'stand'|'crouch'|'prone', speed (m/s), moving, hug, hugSide, aim, sprint}
  SC.Operative.prototype.animate = function (dt, s) {
    const b = this.blend, d = SC.damp;
    b.crouch = d(b.crouch, s.stance === 'crouch' ? 1 : 0, 10, dt);
    b.prone = d(b.prone, s.stance === 'prone' ? 1 : 0, 7, dt);
    b.hug = d(b.hug, s.hug ? 1 : 0, 12, dt);
    b.aim = d(b.aim, s.aim ? 1 : 0, 14, dt);

    const sp = s.speed;
    const strideLen = s.stance === 'prone' ? 0.55 : s.stance === 'crouch' ? 0.9 : 1.25;
    if (sp > 0.05) this.phase += dt * sp / strideLen * Math.PI;
    else this.phase = SC.damp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, 6, dt);
    const ph = this.phase, sw = Math.sin(ph), cw = Math.cos(ph);
    const gait = SC.clamp(sp / 4.5, 0, 1.2);          // 0 idle → 1 running
    const run = SC.smoothstep(3, 6, sp);

    const C = b.crouch * (1 - b.prone), P = b.prone;
    const L = this.legs, A = this.arms;

    // ---- legs
    const swingAmt = (0.35 + gait * 0.55) * (1 - P * 0.6);
    for (let i = 0; i < 2; i++) {
      const sgn = i ? -1 : 1, swing = sw * sgn * swingAmt * Math.min(1, sp * 2);
      const lift = Math.max(0, -Math.cos(ph + (i ? Math.PI : 0))) * (0.4 + gait * 0.9) * Math.min(1, sp * 2);
      let hipX = -swing, kneeX = lift;
      // crouch: thighs forward, shins back
      hipX = SC.lerp(hipX, -1.25 - swing * 0.5, C);
      kneeX = SC.lerp(kneeX, 2.0 + lift * 0.3, C);
      // prone: legs straight back with a small crawl kick
      hipX = SC.lerp(hipX, 0.05 + sw * sgn * 0.25 * Math.min(1, sp * 3), P);
      kneeX = SC.lerp(kneeX, 0.25 + Math.max(0, sw * sgn) * 0.6 * Math.min(1, sp * 3), P);
      L[i].hip.rotation.x = hipX;
      L[i].hip.rotation.z = SC.lerp(0, sgn * 0.12, P);
      L[i].knee.rotation.x = kneeX;
    }

    // ---- pelvis height + bob
    const bob = Math.abs(cw) * 0.05 * gait * (1 - P);
    const hipH = SC.lerp(0.92, 0.5, C);
    this.hips.position.y = hipH + bob;
    this.torso.rotation.x = SC.lerp(0.04 + run * 0.18, 0.38, C) * (1 - P);
    this.torso.rotation.y = sw * 0.12 * gait * (1 - P);
    this.torso.rotation.z = 0;

    // prone: rotate the whole pose forward onto the belly, pivot near the hips
    this.pose.rotation.x = P * Math.PI / 2;
    this.pose.position.y = P * 0.2;
    this.pose.position.z = -P * 0.8;
    this.pose.rotation.z = P * sw * 0.05 * Math.min(1, sp * 3);
    this.neck.rotation.x = -P * 1.1 + C * -0.2;

    // ---- arms
    for (const a of A) {
      const sgn = a.side;
      let shX = sw * sgn * (0.3 + gait * 0.7), shZ = -sgn * 0.08, elX = -0.25 - gait * 0.9;
      // crouch: arms forward ready
      shX = SC.lerp(shX, -0.7 + sw * sgn * 0.15, C); elX = SC.lerp(elX, -1.0, C);
      // prone crawl: arms reach forward alternately
      const reach = Math.max(0, sw * sgn) * Math.min(1, sp * 3);
      shX = SC.lerp(shX, -2.6 + reach * 0.6, P); shZ = SC.lerp(shZ, -sgn * 0.35, P); elX = SC.lerp(elX, -0.6 - reach * 0.6, P);
      // wall hug: palms flat against the wall behind
      shX = SC.lerp(shX, 0.35, b.hug); shZ = SC.lerp(shZ, -sgn * 0.25, b.hug); elX = SC.lerp(elX, -0.2, b.hug);
      // aim: right arm extended, left arm supporting
      if (sgn > 0) { shX = SC.lerp(shX, -1.5, b.aim); shZ = SC.lerp(shZ, 0.05, b.aim); elX = SC.lerp(elX, 0, b.aim); }
      else { shX = SC.lerp(shX, -1.35, b.aim); shZ = SC.lerp(shZ, -0.5, b.aim); elX = SC.lerp(elX, -0.4, b.aim); }
      a.sh.rotation.x = shX; a.sh.rotation.z = shZ; a.el.rotation.x = elX;
    }
    this.gun.visible = b.aim > 0.4;
  };
})(window.SC);
