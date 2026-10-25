// SHADOW CELL — lightweight guard navigation for the test yard.
// The yard is boxes and pillars, so a visibility graph is enough: candidate
// waypoints sit just outside every box corner and around every pillar, and two
// points connect when a body-wide corridor between them is clear. Waypoint-to-
// waypoint visibility is computed once (the yard is static); each plan only adds
// the start and goal and runs a small A*. No path → plan() returns null and the
// guard stops safely instead of walking into a wall.
(function (mv) {
  'use strict';

  mv.NavDefaults = {
    clearance: 0.35,    // m kept between the guard's body and an obstacle when rounding it
    rayHeight: 0.45,    // m: corridor test height (every obstacle in the yard is taller)
    bound: 21.4,        // m: waypoints must lie inside the perimeter
  };

  mv.GuardNav = function (world, radius, opts) {
    this.world = world; this.radius = radius;
    this.cfg = Object.assign({}, mv.NavDefaults, opts || {});
    this._build();
  };

  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  // is a body-wide corridor between two ground points clear? (three parallel sight lines)
  mv.GuardNav.prototype.clear = function (p, q) {
    const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz);
    if (len < 1e-6) return !this.inside(p);
    if (this.world.bounds && this.world.crossesBounds(p, q)) return false;   // (Step 24: never out across a level's edge)
    const nx = -dz / len, nz = dx / len, w = this.radius + 0.05, h = this.cfg.rayHeight;
    for (const o of [-w, 0, w]) {
      _a.set(p.x + nx * o, h, p.z + nz * o); _b.set(q.x + nx * o, h, q.z + nz * o);
      if (this.world.segmentBlocked(_a, _b)) return false;
    }
    return true;
  };

  // is a ground point inside an obstacle grown by the guard's radius?
  mv.GuardNav.prototype.inside = function (p) {
    const r = this.radius;
    for (const b of this.world.boxes) if (p.x > b.minX - r && p.x < b.maxX + r && p.z > b.minZ - r && p.z < b.maxZ + r) return true;
    for (const c of this.world.cylinders) if (!c.noSight && Math.hypot(p.x - c.x, p.z - c.z) < c.r + r) return true;
    if (this.world.bounds && !this.world.inBounds(p.x, p.z, r)) return true;   // (Step 24: outside a level's edge counts as solid)
    return false;
  };

  mv.GuardNav.prototype._build = function () {
    const c = this.cfg, off = this.radius + c.clearance, nodes = [];
    for (const b of this.world.boxes) for (const [x, z] of [[b.minX - off, b.minZ - off], [b.maxX + off, b.minZ - off], [b.minX - off, b.maxZ + off], [b.maxX + off, b.maxZ + off]]) nodes.push({ x, z });
    for (const cy of this.world.cylinders) if (!cy.noSight) for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; nodes.push({ x: cy.x + Math.cos(a) * (cy.r + off), z: cy.z + Math.sin(a) * (cy.r + off) }); }
    // (a level with its own edge (Step 24) uses that instead of the lab's square perimeter)
    this.nodes = nodes.filter(n => (this.world.bounds || (Math.abs(n.x) < c.bound && Math.abs(n.z) < c.bound)) && !this.inside(n));
    this.links = this.nodes.map(() => []);
    for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
      if (this.clear(this.nodes[i], this.nodes[j])) { const d = Math.hypot(this.nodes[i].x - this.nodes[j].x, this.nodes[i].z - this.nodes[j].z); this.links[i].push([j, d]); this.links[j].push([i, d]); }
    }
  };

  // a list of ground points from `from` (exclusive) to `to`, or null if unreachable
  mv.GuardNav.prototype.plan = function (from, to) {
    if (this.inside(to)) return null;
    if (this.clear(from, to)) return [{ x: to.x, z: to.z }];
    const N = this.nodes, n = N.length, S = n, G = n + 1, pts = N.concat([{ x: from.x, z: from.z }, { x: to.x, z: to.z }]);
    const startLinks = [], goalLinks = new Map();
    for (let i = 0; i < n; i++) {
      if (this.clear(from, N[i])) startLinks.push([i, Math.hypot(from.x - N[i].x, from.z - N[i].z)]);
      if (this.clear(N[i], to)) goalLinks.set(i, Math.hypot(N[i].x - to.x, N[i].z - to.z));
    }
    const h = i => Math.hypot(pts[i].x - to.x, pts[i].z - to.z);
    const g = new Map([[S, 0]]), came = new Map(), open = new Set([S]);
    while (open.size) {
      let cur = -1, best = Infinity;
      for (const i of open) { const f = g.get(i) + h(i); if (f < best) { best = f; cur = i; } }
      if (cur === G) {
        const path = []; let k = G;
        while (k !== S) { path.unshift({ x: pts[k].x, z: pts[k].z }); k = came.get(k); }
        return path;
      }
      open.delete(cur);
      const edges = cur === S ? startLinks : this.links[cur].slice();
      if (cur !== S && goalLinks.has(cur)) edges.push([G, goalLinks.get(cur)]);
      for (const [j, d] of edges) {
        const ng = g.get(cur) + d;
        if (ng < (g.has(j) ? g.get(j) : Infinity)) { g.set(j, ng); came.set(j, cur); open.add(j); }
      }
    }
    return null;
  };
})(SC.mv);
