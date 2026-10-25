// SHADOW CELL — movement: noise events (docs/GAME_DESIGN.md §2).
// Anything that makes a sound emits one event: intensity level 1–5, a type, a
// world position and the surface it happened on. The event's reach grows
// steeply with level (a gunshot carries far further than jogging). The surface
// shifts the effective intensity and scales the reach (metal is louder, grass
// softer) without changing the level itself. Listeners (footstep audio now,
// guards later) subscribe with on(); this stage emits the player's footsteps
// and draws each event's reach as a fading ring on the ground for testing.
(function (mv) {
  'use strict';

  mv.NoiseDefaults = {
    // reach in metres of each level on standard ground (index = level)
    radius: [0, 2.5, 6, 14, 30, 80],
    // per surface: intensity is added to the level (fractions allowed; the reach
    // is read between levels), range then scales the reach. The level itself
    // (1 sneak, 2 stealth walk, 3 jog) never changes with the surface.
    surfaces: {
      concrete: { intensity: 0, range: 1 },        // standard: sneak 2.5 m, stealth walk 6 m, jog 14 m
      metal: { intensity: 0.5, range: 1.15 },      // louder: ≈4.9 / 11.5 / 25 m
      grass: { intensity: -0.5, range: 0.85 },     // softer: ≈1.1 / 3.6 / 8.5 m
      dirt: { intensity: 0, range: 1 },            // Step 24: a packed dirt trail: standard, like concrete (no new balance)
    },
    // footstep noise level per gait id (motor.gait.id); steps taken while
    // turning on the spot or settling after a stop count as the quietest
    footstepLevel: { idle: 1, sneak: 1, walk: 2, jog: 3, crouch: 1, crouchslow: 1, crouchfast: 2 },
    // footstep detection on the lower of each foot's ankle and toe joints (m above ground)
    footContact: 0.045,    // below this the foot is down…
    footLift: 0.07,        // …and it must rise above this before the next step counts
    footTravel: 0.06,      // m the foot must have moved since its last landing
    // a landing counts once the low foot has (nearly) stopped, like a planted foot:
    // a swinging foot skimming the ground at a sneak is still moving fast
    footPlantSpeed: [0.45, 0.5],   // m/s: max(first, second × body speed)
    debug: true,           // draw each event's reach as a ring on the ground
    ringTime: 1.3,         // s a debug ring takes to expand, hold and fade (Step 24.1: a little longer, to read it)
  };

  mv.NoiseSystem = function (scene, opts) {
    this.cfg = Object.assign({}, mv.NoiseDefaults, opts || {});
    this.listeners = [];
    this.last = null;            // most recent event (for the stats panel)
    this.scene = scene;
    this.rings = [];
    this._next = 0;
  };

  // reach (m) of an effective intensity, read between the levels of the radius table
  mv.NoiseSystem.prototype.reachOf = function (intensity) {
    const r = this.cfg.radius, i = Math.max(0, Math.min(r.length - 1, intensity)), k = Math.min(r.length - 2, Math.floor(i));
    return r[k] + (r[k + 1] - r[k]) * (i - k);
  };

  mv.NoiseSystem.prototype.on = function (fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(f => f !== fn); }; };

  // level 1–5, type ('footstep', …), position (Vector3), surface, source (who made it)
  // by (optional): the one who made it, if it matters who (Step 22: a guard doesn't hear his own shot)
  mv.NoiseSystem.prototype.emit = function (level, type, position, surface, source, by) {
    const c = this.cfg, lv = Math.max(1, Math.min(5, Math.round(level)));
    surface = surface || 'concrete';
    const mod = c.surfaces[surface] || c.surfaces.concrete || { intensity: 0, range: 1 };
    // level: the action's loudness (unchanged by the surface); intensity: what the surface makes of it
    const intensity = Math.max(0, Math.min(5, lv + (mod.intensity || 0)));
    const ev = { level: lv, intensity, type, position: position.clone(), surface, source: source || null,
      radius: this.reachOf(intensity) * (mod.range != null ? mod.range : 1), time: performance.now() / 1000, by: by || null };
    this.last = ev;
    for (const fn of this.listeners) fn(ev);
    if (c.debug && this.scene) { this._ring(ev); if (this.onShown) this.onShown(ev); }   // (Step 24.1: after every listener has heard it, so a label can say who did)
    return ev;
  };

  // ---------------------------------------------------------------- debug rings
  const RING_COLORS = [0, 0x7fd1ff, 0x9dff8a, 0xffd34d, 0xff8a3d, 0xff3d3d];

  // Step 24.1: easier to see on grass, dirt and concrete: a coloured band at the event's exact reach with a dark
  // edge, a faint fill and a dot at its true origin; 12 of them reused in turn (nothing new is made per event)
  mv.NoiseSystem.prototype._ring = function (ev) {
    if (!this.rings.length) {
      const flat = g => g.rotateX(-Math.PI / 2);
      const geo = { band: flat(new THREE.RingGeometry(0.88, 1, 56)), edge: flat(new THREE.RingGeometry(1, 1.025, 56)), fill: flat(new THREE.CircleGeometry(0.88, 40)), dot: flat(new THREE.CircleGeometry(1, 16)) };
      const mat = (color, op) => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, opacity: op });
      for (let i = 0; i < 12; i++) {
        const g = new THREE.Group(), band = new THREE.Mesh(geo.band, mat(0xffffff, 0)), edge = new THREE.Mesh(geo.edge, mat(0x000000, 0)), fill = new THREE.Mesh(geo.fill, mat(0xffffff, 0));
        const dot = new THREE.Mesh(geo.dot, mat(0xffffff, 0)); dot.scale.setScalar(0.13); dot.position.y = 0.005;
        for (const m of [band, edge, fill, dot]) m.renderOrder = 2;
        g.add(fill, band, edge); g.visible = false; g.userData = { t: 1, r: 1, band, edge, fill, dot };
        this.scene.add(g); this.scene.add(dot); dot.visible = false; this.rings.push(g);
      }
    }
    const m = this.rings[this._next], u = m.userData; this._next = (this._next + 1) % this.rings.length;
    m.position.set(ev.position.x, ev.position.y + 0.02, ev.position.z); u.dot.position.set(ev.position.x, ev.position.y + 0.025, ev.position.z);
    const col = RING_COLORS[ev.level]; for (const k of ['band', 'fill', 'dot']) u[k].material.color.setHex(col).convertSRGBToLinear();   // (as the colour reads: r128 takes hex as linear)
    u.t = 0; u.r = ev.radius; m.visible = true; u.dot.visible = true;
  };

  mv.NoiseSystem.prototype.update = function (dt) {
    const life = this.cfg.ringTime;
    for (const m of this.rings) {
      if (!m.visible) continue;
      const u = m.userData; u.t += dt / life;
      if (u.t >= 1) { m.visible = false; u.dot.visible = false; continue; }
      const grow = 1 - Math.pow(1 - Math.min(1, u.t / 0.35), 3);        // reaches its full reach early…
      m.scale.setScalar(Math.max(0.01, u.r * grow));
      const k = 1 - Math.max(0, (u.t - 0.45) / 0.55);                    // …holds, then fades
      u.band.material.opacity = 0.95 * k; u.edge.material.opacity = 0.5 * k; u.fill.material.opacity = 0.16 * k; u.dot.material.opacity = k;
    }
  };

  // ---------------------------------------------------------------- footsteps
  // Watches a character's feet and emits a footstep each time a foot lands.
  // Works from the posed skeleton, so any gait clip (and the turn-in-place and
  // settle steps) produce steps without per-clip timing data.
  mv.FootstepEmitter = function (noise, visual, motor, source) {
    this.noise = noise; this.visual = visual; this.motor = motor; this.source = source || 'player';
    this.feet = ['left', 'right'].map(side => ({ side, down: true, at: null, prev: null }));
    this.surface = 'concrete';   // surface under the last landing (from the world's surface map)
    this.count = 0;
  };

  const _v = new THREE.Vector3(), _t = new THREE.Vector3();
  mv.FootstepEmitter.prototype.update = function (dt) {
    const c = this.noise.cfg, b = this.visual.bones, g = this.motor.position.y;
    const plant = Math.max(c.footPlantSpeed[0], c.footPlantSpeed[1] * Math.abs(this.motor.speed));
    for (const f of this.feet) {
      const foot = b[f.side + 'Foot'], toe = b[f.side + 'Toe'];
      if (!foot) continue;
      foot.getWorldPosition(_v);
      let h = _v.y;
      if (toe) { toe.getWorldPosition(_t); if (_t.y < h) { h = _t.y; } }
      h -= g;
      const speed = f.prev && dt > 0 ? Math.hypot(_v.x - f.prev.x, _v.z - f.prev.z) / dt : 0;
      f.prev = f.prev || new THREE.Vector3(); f.prev.copy(_v);
      if (!f.down && h < c.footContact && speed < plant) {
        f.down = true;
        const p = (toe && _t.y < _v.y ? _t : _v).clone(); p.y = g;
        if (!f.at || Math.hypot(p.x - f.at.x, p.z - f.at.z) >= c.footTravel) {
          const gait = this.motor.gait ? this.motor.gait.id : 'walk';
          const world = this.motor.world;
          this.surface = world && world.surfaceAt ? world.surfaceAt(p.x, p.z) : 'concrete';
          this.noise.emit(c.footstepLevel[gait] != null ? c.footstepLevel[gait] : 1, 'footstep', p, this.surface, this.source);
          this.count++;
        }
        f.at = p;
      } else if (f.down && h > c.footLift) f.down = false;
    }
  };
})(SC.mv);
