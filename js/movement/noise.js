// SHADOW CELL — movement: noise events (docs/GAME_DESIGN.md §2).
// Anything that makes a sound emits one event: intensity level 1–5, a type, a
// world position and the surface it happened on. The event's reach grows
// steeply with level (a gunshot carries far further than jogging) and is
// scaled by the surface. Listeners (guards, later) subscribe with on(); this
// stage only emits the player's footsteps and draws each event's reach as a
// fading ring on the ground for testing.
(function (mv) {
  'use strict';

  mv.NoiseDefaults = {
    // reach in metres of each level on standard ground (index = level)
    radius: [0, 2.5, 6, 14, 30, 80],
    // loudness multiplier on the reach, per surface (more surfaces in step 2)
    surfaces: { concrete: 1 },
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
    ringTime: 0.9,         // s a debug ring takes to expand and fade
  };

  mv.NoiseSystem = function (scene, opts) {
    this.cfg = Object.assign({}, mv.NoiseDefaults, opts || {});
    this.listeners = [];
    this.last = null;            // most recent event (for the stats panel)
    this.scene = scene;
    this.rings = [];
    this._next = 0;
  };

  mv.NoiseSystem.prototype.on = function (fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(f => f !== fn); }; };

  // level 1–5, type ('footstep', …), position (Vector3), surface, source (who made it)
  mv.NoiseSystem.prototype.emit = function (level, type, position, surface, source) {
    const c = this.cfg, lv = Math.max(1, Math.min(5, Math.round(level)));
    surface = surface || 'concrete';
    const ev = { level: lv, type, position: position.clone(), surface, source: source || null,
      radius: c.radius[lv] * (c.surfaces[surface] != null ? c.surfaces[surface] : 1), time: performance.now() / 1000 };
    this.last = ev;
    for (const fn of this.listeners) fn(ev);
    if (c.debug && this.scene) this._ring(ev);
    return ev;
  };

  // ---------------------------------------------------------------- debug rings
  const RING_COLORS = [0, 0x7fd1ff, 0x9dff8a, 0xffd34d, 0xff8a3d, 0xff3d3d];

  mv.NoiseSystem.prototype._ring = function (ev) {
    if (!this.rings.length) {
      const geo = new THREE.RingGeometry(0.94, 1, 48); geo.rotateX(-Math.PI / 2);
      for (let i = 0; i < 10; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 }));
        m.visible = false; m.renderOrder = 2; m.userData = { t: 1, r: 1 };
        this.scene.add(m); this.rings.push(m);
      }
    }
    const m = this.rings[this._next]; this._next = (this._next + 1) % this.rings.length;
    m.position.set(ev.position.x, ev.position.y + 0.02, ev.position.z);
    m.material.color.setHex(RING_COLORS[ev.level]);
    m.userData.t = 0; m.userData.r = ev.radius; m.visible = true;
  };

  mv.NoiseSystem.prototype.update = function (dt) {
    for (const m of this.rings) {
      if (!m.visible) continue;
      const u = m.userData; u.t += dt / this.cfg.ringTime;
      if (u.t >= 1) { m.visible = false; continue; }
      const grow = 1 - Math.pow(1 - Math.min(1, u.t / 0.45), 3);        // reaches full size early…
      m.scale.setScalar(Math.max(0.01, u.r * grow));
      m.material.opacity = 0.85 * (1 - Math.max(0, (u.t - 0.45) / 0.55));  // …then fades
    }
  };

  // ---------------------------------------------------------------- footsteps
  // Watches a character's feet and emits a footstep each time a foot lands.
  // Works from the posed skeleton, so any gait clip (and the turn-in-place and
  // settle steps) produce steps without per-clip timing data.
  mv.FootstepEmitter = function (noise, visual, motor, source) {
    this.noise = noise; this.visual = visual; this.motor = motor; this.source = source || 'player';
    this.feet = ['left', 'right'].map(side => ({ side, down: true, at: null, prev: null }));
    this.surface = 'concrete';   // step 2 looks this up from the ground under each foot
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
          this.noise.emit(c.footstepLevel[gait] != null ? c.footstepLevel[gait] : 1, 'footstep', p, this.surface, this.source);
          this.count++;
        }
        f.at = p;
      } else if (f.down && h > c.footLift) f.down = false;
    }
  };
})(SC.mv);
