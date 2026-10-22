// SHADOW CELL — the controlled operative: movement, stances, cover, concealment, noise.
(function (SC) {
  'use strict';

  const R = 0.34;           // body radius for collision
  const GRAV = 18;

  SC.Player = function (scene, type) {
    this.scene = scene;
    this.op = new SC.Operative(type);
    this.def = this.op.def;
    scene.add(this.op.root);
    this.stones = [];
    this.rings = [];
    this.reset();
  };

  SC.Player.prototype.reset = function () {
    const ins = SC.world.poi.insertion;
    this.pos = new THREE.Vector3(ins.x, SC.world.height(ins.x, ins.z), ins.z);
    this.vel = new THREE.Vector2(0, 0);
    this.yaw = Math.PI;          // facing north (-Z), toward the outpost
    this.stance = 'crouch';
    this.stanceLock = 0;         // seconds of reduced speed while changing stance
    this.hug = null;
    this.aim = false;
    this.sprint = false;
    this.stamina = 1;
    this.hp = 1;
    this.speed = 0;
    this.visibility = 0;
    this.noise = 0;
    this.conceal = { bush: 0, grass: 0, shade: 0, lit: 0 };
    this.context = null;
    this.throwCd = 0;
    this.lastStep = 0;
  };

  SC.Player.prototype.setStance = function (s) {
    if (s === this.stance) return;
    if (this.stance === 'prone' || s === 'prone') this.stanceLock = 0.45; else this.stanceLock = 0.15;
    this.stance = s;
    if (s === 'prone') this.hug = null;
    if (s !== 'stand') this.sprint = false;
    SC.audio && SC.audio.cloth();
  };

  // closest point on the hug surface (box or circle) to p
  function surfacePoint(src, x, z) {
    if (src.minX !== undefined) return [SC.clamp(x, src.minX, src.maxX), SC.clamp(z, src.minZ, src.maxZ)];
    const dx = x - src.x, dz = z - src.z, d = Math.hypot(dx, dz) || 1;
    return [src.x + dx / d * src.r, src.z + dz / d * src.r];
  }

  SC.Player.prototype.update = function (dt, input, cam) {
    const W = SC.world;
    this.throwCd -= dt;
    this.stanceLock = Math.max(0, this.stanceLock - dt);

    // ---------------- stance input
    if (input.consume('stanceTap')) {
      if (this.stance === 'stand') this.setStance('crouch');
      else if (this.stance === 'crouch') this.setStance('stand');
      else this.setStance('crouch');
    }
    if (input.consume('stanceHold')) this.setStance(this.stance === 'prone' ? 'crouch' : 'prone');
    if (input.consume('prone')) this.setStance(this.stance === 'prone' ? 'crouch' : 'prone');

    this.aim = input.aim;
    if (input.sprint && !this.aim && this.stamina > 0.05) {
      if (this.stance !== 'stand') { this.setStance('stand'); }
      this.sprint = true;
    } else this.sprint = false;

    // ---------------- desired movement (camera relative)
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);   // camera forward on ground
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);    // camera right
    let mx = rx * input.move.x + fx * input.move.y;
    let mz = rz * input.move.x + fz * input.move.y;
    let mag = Math.min(1, Math.hypot(mx, mz));
    if (mag > 0.001) { const l = Math.hypot(mx, mz); mx /= l; mz /= l; }
    if (mag < 0.12) mag = 0;

    let maxSpeed;
    if (this.stance === 'prone') maxSpeed = 0.9 * mag;
    else if (this.stance === 'crouch') maxSpeed = 2.1 * mag;
    else if (this.sprint && mag > 0.3) maxSpeed = 6.6;
    else maxSpeed = mag < 0.7 ? 2.0 * mag / 0.7 : SC.lerp(2.0, 4.4, (mag - 0.7) / 0.3);
    if (this.aim) maxSpeed = Math.min(maxSpeed, this.stance === 'prone' ? 0.5 : 1.5);
    maxSpeed *= this.def.speed;
    if (this.stanceLock > 0) maxSpeed *= 0.3;

    // ---------------- wall hug constraint
    if (this.hug) {
      const h = this.hug;
      const away = (mx * h.nx + mz * h.nz) * mag;
      if (away > 0.75) { this.hug = null; }
      else {
        const tx = -h.nz, tz = h.nx, along = mx * tx + mz * tz;
        mx = tx * Math.sign(along); mz = tz * Math.sign(along);
        maxSpeed = Math.min(1.4, 2.0 * Math.abs(along) * mag) * this.def.speed;
        if (Math.abs(along) * mag < 0.15) maxSpeed = 0;
      }
    }

    // ---------------- integrate
    const tvx = mx * maxSpeed, tvz = mz * maxSpeed;
    const accel = maxSpeed > this.vel.length() ? 10 : 14;
    this.vel.x = SC.damp(this.vel.x, tvx, accel, dt);
    this.vel.y = SC.damp(this.vel.y, tvz, accel, dt);
    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.y * dt;
    const c = W.collide(nx, nz, R);
    nx = SC.clamp(c.x, -W.bound, W.bound); nz = SC.clamp(c.z, -W.bound, W.bound);

    if (this.hug) {
      const sp = surfacePoint(this.hug.src, nx, nz);
      const dx = nx - sp[0], dz = nz - sp[1], d = Math.hypot(dx, dz);
      if (d > R + 0.4 || d < 1e-4) this.hug = null;
      else {
        this.hug.nx = dx / d; this.hug.nz = dz / d;
        nx = sp[0] + this.hug.nx * (R + 0.03); nz = sp[1] + this.hug.nz * (R + 0.03);
        const cc = W.collide(nx, nz, R); nx = cc.x; nz = cc.z;
      }
    }

    const moved = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    this.speed = dt > 0 ? moved / dt : 0;
    this.pos.x = nx; this.pos.z = nz;
    this.pos.y = SC.damp(this.pos.y, W.height(nx, nz), 20, dt);

    // ---------------- facing
    if (this.hug) {
      this.yaw = SC.dampAngle(this.yaw, Math.atan2(this.hug.nx, this.hug.nz), 14, dt);
    } else if (this.aim) {
      this.yaw = SC.dampAngle(this.yaw, Math.atan2(fx, fz), 16, dt);
    } else if (this.speed > 0.2 && mag > 0) {
      this.yaw = SC.dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.y), this.stance === 'prone' ? 5 : 11, dt);
    }

    // ---------------- stamina
    if (this.sprint && this.speed > 3) this.stamina = Math.max(0, this.stamina - dt * 0.12);
    else this.stamina = Math.min(1, this.stamina + dt * (this.speed < 0.3 ? 0.18 : 0.08));

    // ---------------- context action
    this.context = this.findContext();
    if (input.consume('action')) this.doAction();
    if (input.consume('attack')) this.throwStone(cam);

    // ---------------- concealment / visibility / noise
    this.updateStealth(dt);

    // ---------------- model
    const op = this.op;
    op.root.position.copy(this.pos);
    op.root.rotation.y = this.yaw;
    op.animate(dt, { stance: this.stance, speed: this.speed, hug: !!this.hug, aim: this.aim });

    // footsteps on the gait cycle
    const step = Math.floor(op.phase / Math.PI);
    if (step !== this.lastStep && this.speed > 0.4) {
      this.lastStep = step;
      SC.audio && SC.audio.step(this.noise, this.stance);
    }

    this.updateStones(dt);
  };

  SC.Player.prototype.findContext = function () {
    const W = SC.world;
    if (this.hug) return { type: 'release', label: 'LEAVE COVER' };
    const poi = W.poi;
    if (Math.hypot(this.pos.x - poi.radio.x, this.pos.z - poi.radio.z) < poi.radio.r) return { type: 'info', label: 'COMMS CONSOLE · SABOTAGE IN PHASE 3' };
    if (Math.hypot(this.pos.x - poi.intel.x, this.pos.z - poi.intel.z) < poi.intel.r) return { type: 'info', label: 'INTEL DOCUMENTS · PICKUP IN PHASE 3' };
    if (this.stance !== 'prone') {
      const s = W.nearestSurface(this.pos.x, this.pos.z, R + 0.45);
      if (s && s.h >= 0.8 && !(s.src && s.src.tag === 'tree')) {
        const low = s.h < 1.4;
        return { type: 'hug', label: low ? 'TAKE LOW COVER' : 'PRESS TO WALL', surf: s, low };
      }
    }
    return null;
  };

  SC.Player.prototype.doAction = function () {
    const ctx = this.context;
    if (!ctx) return;
    if (ctx.type === 'release') { this.hug = null; return; }
    if (ctx.type === 'hug') {
      const s = ctx.surf;
      this.hug = { src: s.src, nx: s.nx, nz: s.nz };
      // swing the camera out from the wall, angled slightly so the operative stays in frame
      if (SC.game && SC.game.camera) SC.game.camera.autoYaw = Math.atan2(s.nx, s.nz) + 0.6;
      if (ctx.low && this.stance === 'stand') this.setStance('crouch');
      this.sprint = false;
      SC.audio && SC.audio.cloth();
    }
    if (ctx.type === 'info') SC.hud && SC.hud.toast(ctx.label.split(' · ')[0] + ' located');
  };

  SC.Player.prototype.updateStealth = function (dt) {
    const c = this.conceal = SC.world.concealment(this.pos.x, this.pos.z);
    const st = this.stance;
    let v = st === 'stand' ? 1 : st === 'crouch' ? 0.58 : 0.3;
    const moveF = SC.clamp(this.speed / 4.5, 0, 1.5);
    v *= 1 + moveF * 0.6;
    v *= 1 - c.bush * (st === 'stand' ? 0.45 : st === 'crouch' ? 0.82 : 0.92);
    v *= 1 - c.grass * (st === 'stand' ? 0.2 : st === 'crouch' ? 0.62 : 0.88);
    v *= 1 - c.shade * 0.22;
    v *= 1 + c.lit * 0.55;
    if (this.hug) v *= 0.85;
    v *= this.def.camo;
    this.visibility = SC.damp(this.visibility, SC.clamp(v, 0.02, 1), 6, dt);

    let n = 0;
    if (this.speed > 0.15) {
      if (st === 'prone') n = 0.05;
      else if (st === 'crouch') n = 0.1 + this.speed * 0.03;
      else n = this.sprint ? 0.95 : this.speed > 3 ? 0.55 : 0.22;
    }
    if (c.bush > 0.2 && this.speed > 0.15) n += 0.08;   // rustling leaves
    n *= this.def.noise;
    this.noise = SC.damp(this.noise, SC.clamp(n, 0, 1), 8, dt);
  };

  // ---------------- distraction stones
  SC.Player.prototype.throwStone = function (cam) {
    if (this.throwCd > 0) return;
    this.throwCd = 0.7;
    let s = this.stones.find(o => !o.active);
    if (!s) {
      if (this.stones.length >= 6) s = this.stones.shift(); else s = { mesh: new THREE.Mesh(new THREE.DodecahedronGeometry(0.07, 0), SC.world.mat(0x77736a)) };
      this.scene.add(s.mesh);
      this.stones.push(s);
    }
    const yaw = this.aim ? cam.yaw : this.yaw + Math.PI;
    const dirx = -Math.sin(yaw), dirz = -Math.cos(yaw);
    const pitch = this.aim ? cam.aimPitch : 0.5;
    const power = 12;
    s.vel = new THREE.Vector3(dirx * Math.cos(pitch) * power, Math.sin(pitch) * power + 2, dirz * Math.cos(pitch) * power);
    const handY = this.stance === 'prone' ? 0.4 : this.stance === 'crouch' ? 1.0 : 1.5;
    s.mesh.position.set(this.pos.x + dirx * 0.4, this.pos.y + handY, this.pos.z + dirz * 0.4);
    s.mesh.visible = true;
    s.active = true;
    s.bounces = 0;
    // throwing is a small noise on its own
    this.noise = Math.max(this.noise, 0.15);
    SC.audio && SC.audio.cloth();
  };

  SC.Player.prototype.updateStones = function (dt) {
    const W = SC.world;
    for (const s of this.stones) {
      if (!s.active) continue;
      s.vel.y -= GRAV * dt;
      const p = s.mesh.position;
      p.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += dt * 9; s.mesh.rotation.z += dt * 7;
      let hit = false;
      const gy = W.height(p.x, p.z);
      if (p.y < gy + 0.05) { p.y = gy + 0.05; hit = true; }
      else {
        const c = W.collide(p.x, p.z, 0.05);
        if ((Math.abs(c.x - p.x) > 1e-3 || Math.abs(c.z - p.z) > 1e-3) && p.y < 2.6) { p.x = c.x; p.z = c.z; s.vel.x *= -0.3; s.vel.z *= -0.3; hit = true; }
      }
      if (hit) {
        if (s.bounces === 0) this.noiseEvent(p.x, p.y, p.z, 11);
        s.bounces++;
        s.vel.multiplyScalar(0.3);
        s.vel.y = Math.abs(s.vel.y) * 0.5;
        if (s.bounces > 2 || s.vel.length() < 0.6) { s.active = false; setTimeout(() => { s.mesh.visible = false; }, 4000); }
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / 0.9;
      r.mesh.scale.setScalar(0.3 + k * r.radius);
      r.mesh.material.opacity = 0.55 * (1 - k);
      if (k >= 1) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); this.rings.splice(i, 1); }
    }
  };

  // Noise events are broadcast to SC.events so guard AI (Phase 2) can react.
  SC.events = SC.events || { listeners: [], emit(e) { this.listeners.forEach(f => f(e)); }, on(f) { this.listeners.push(f); } };
  SC.Player.prototype.noiseEvent = function (x, y, z, radius) {
    SC.events.emit({ type: 'noise', x, y, z, radius, source: 'stone' });
    SC.audio && SC.audio.clack();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 24), new THREE.MeshBasicMaterial({ color: 0xd8cfa8, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.05, z);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, t: 0, radius });
  };
})(window.SC);
