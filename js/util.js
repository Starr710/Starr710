// SHADOW CELL — shared helpers. Everything hangs off the global SC namespace
// so the game runs from plain <script> tags (no build step, works on file:// and Safari).
window.SC = window.SC || {};

(function (SC) {
  'use strict';

  // Deterministic PRNG so the map is identical for every player (needed for co-op later).
  SC.rng = function (seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  function hash2(x, z) {
    let h = (x * 374761393 + z * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Smooth 2D value noise in [0,1].
  SC.noise2 = function (x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  SC.fbm = function (x, z) {
    return SC.noise2(x, z) * 0.6 + SC.noise2(x * 2.1 + 17, z * 2.1 - 9) * 0.3 + SC.noise2(x * 4.3 - 31, z * 4.3 + 5) * 0.1;
  };

  SC.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  SC.lerp = (a, b, t) => a + (b - a) * t;
  SC.smoothstep = (a, b, v) => { const t = SC.clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // Frame-rate independent exponential approach.
  SC.damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
  SC.angleDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
  SC.dampAngle = (a, b, rate, dt) => a + SC.angleDiff(a, b) * (1 - Math.exp(-rate * dt));

  // Distance from point to segment in XZ.
  SC.distToSeg = function (px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const t = SC.clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const cx = ax + dx * t, cz = az + dz * t;
    return Math.hypot(px - cx, pz - cz);
  };

  SC.distToPolyline = function (px, pz, pts) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = SC.distToSeg(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (d < best) best = d;
    }
    return best;
  };

  // Uniform spatial hash for fast "what's near me" queries (bushes, grass, trees).
  SC.SpatialGrid = function (cell) {
    this.cell = cell;
    this.map = new Map();
  };
  SC.SpatialGrid.prototype.key = function (cx, cz) { return cx * 73856093 ^ cz * 19349663; };
  SC.SpatialGrid.prototype.add = function (item) {
    const cx = Math.floor(item.x / this.cell), cz = Math.floor(item.z / this.cell);
    const k = this.key(cx, cz);
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k).push(item);
  };
  SC.SpatialGrid.prototype.query = function (x, z, r, out) {
    out = out || [];
    out.length = 0;
    const c0x = Math.floor((x - r) / this.cell), c1x = Math.floor((x + r) / this.cell);
    const c0z = Math.floor((z - r) / this.cell), c1z = Math.floor((z + r) / this.cell);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.map.get(this.key(cx, cz));
        if (list) for (let i = 0; i < list.length; i++) out.push(list[i]);
      }
    }
    return out;
  };

  SC.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
})(window.SC);
