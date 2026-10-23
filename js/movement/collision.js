// SHADOW CELL — movement: static collision world.
// The character is a vertical capsule, resolved in 2D as a circle on the XZ plane
// against axis-aligned boxes and vertical cylinders. Resolution slides along
// surfaces, so walking into a wall at an angle keeps the tangential motion.
window.SC = window.SC || {};
SC.mv = SC.mv || {};

(function (mv) {
  'use strict';

  mv.CollisionWorld = function () {
    this.boxes = [];      // {minX,maxX,minZ,maxZ,top}
    this.cylinders = [];  // {x,z,r,top}
    this.meshes = [];     // meshes the camera must not pass through
    this.surfaces = [];   // {minX,maxX,minZ,maxZ,type}: ground patches (noise, footstep sounds)
    this.defaultSurface = 'concrete';
  };

  // a rectangular ground patch of a surface type ('metal', 'grass', …)
  mv.CollisionWorld.prototype.addSurface = function (cx, cz, w, d, type) {
    this.surfaces.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, type });
  };
  // surface type at a ground point (the last patch added wins where patches overlap)
  mv.CollisionWorld.prototype.surfaceAt = function (x, z) {
    for (let i = this.surfaces.length - 1; i >= 0; i--) {
      const s = this.surfaces[i];
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return s.type;
    }
    return this.defaultSurface;
  };

  mv.CollisionWorld.prototype.addBox = function (cx, cz, w, d, top, mesh) {
    this.boxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, top });
    if (mesh) this.meshes.push(mesh);
  };
  mv.CollisionWorld.prototype.addCylinder = function (x, z, r, top, mesh) {
    this.cylinders.push({ x, z, r, top });
    if (mesh) this.meshes.push(mesh);
  };

  // Push a circle (x,z,r) out of every obstacle it overlaps. Returns the
  // corrected position and the summed contact normal (zero when free).
  mv.CollisionWorld.prototype.resolve = function (x, z, r, out) {
    out = out || { x: 0, z: 0, nx: 0, nz: 0, hit: false };
    let nx = 0, nz = 0, hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of this.boxes) {
        const px = Math.max(b.minX, Math.min(x, b.maxX)), pz = Math.max(b.minZ, Math.min(z, b.maxZ));
        let dx = x - px, dz = z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-10) {
          // centre inside the box: leave by the nearest face
          const l = x - b.minX, rr = b.maxX - x, n = z - b.minZ, s = b.maxZ - z, m = Math.min(l, rr, n, s);
          if (m === l) { dx = -1; dz = 0; x = b.minX - r; } else if (m === rr) { dx = 1; dz = 0; x = b.maxX + r; }
          else if (m === n) { dx = 0; dz = -1; z = b.minZ - r; } else { dx = 0; dz = 1; z = b.maxZ + r; }
        } else {
          const d = Math.sqrt(d2);
          dx /= d; dz /= d;
          x = px + dx * r; z = pz + dz * r;
        }
        nx += dx; nz += dz; hit = moved = true;
      }
      for (const c of this.cylinders) {
        let dx = x - c.x, dz = z - c.z;
        const rr = r + c.r, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-10) continue;
        const d = Math.sqrt(d2);
        dx /= d; dz /= d;
        x = c.x + dx * rr; z = c.z + dz * rr;
        nx += dx; nz += dz; hit = moved = true;
      }
      if (!moved) break;
    }
    const nl = Math.hypot(nx, nz) || 1;
    out.x = x; out.z = z; out.nx = hit ? nx / nl : 0; out.nz = hit ? nz / nl : 0; out.hit = hit;
    return out;
  };
})(SC.mv);
