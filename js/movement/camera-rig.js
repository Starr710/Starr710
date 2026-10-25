// SHADOW CELL — movement: third-person camera.
// Orbits a follow point behind the character's shoulder. The follow point is a
// critically damped spring on the character (smooth, never overshoots); yaw and
// pitch come straight from the right thumb. After a moment without camera input
// while moving, it eases back behind the character. Obstacles pull it in.
(function (mv) {
  'use strict';

  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const wrap = a => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

  mv.CameraDefaults = {
    distance: 3.6, height: 1.45, shoulder: 0.38, crouchDrop: 0.45,
    pitch: 0.2, minPitch: -0.45, maxPitch: 1.05,
    sensitivity: 0.0062,      // rad per px of thumb drag (touch)
    mouseSensitivity: 0.0038,
    followStiffness: 13,      // spring stiffness on the follow point
    recenterDelay: 1.4, recenterRate: 1.6,
    baseFov: 58,
    // Step 18: the aiming view (blended in while aimK > 0): closer, further onto her right shoulder
    aim: { distance: 1.6, shoulder: 0.6, height: 0.1, sensitivity: 0.8, minPitch: -0.75, time: 0.4 },   // time: s to blend in or out (eased at both ends)
  };

  mv.ThirdPersonCamera = function (camera, world, opts) {
    this.cam = camera;
    this.world = world;
    this.cfg = Object.assign({}, mv.CameraDefaults, opts || {});
    this.yaw = Math.PI;         // camera sits behind a character facing +Z
    this.pitch = this.cfg.pitch;
    this.focus = new THREE.Vector3();
    this.focusVel = new THREE.Vector3();
    this.dist = this.cfg.distance;
    this.idleLook = 0;
    this.kick = 0;   // Step 19: a shot's small upward camera kick (rad), recovering (pistol.js)
    this.aimTarget = 0; this.aimK = 0; this.aimP = 0;   // Step 18: 0 = normal view, 1 = aiming view (aimK: the eased aimP)
    this.ray = new THREE.Raycaster();
    this._o = new THREE.Vector3(); this._d = new THREE.Vector3();
  };

  mv.ThirdPersonCamera.prototype.snap = function (motor) {
    this.yaw = wrap(motor.yaw + Math.PI);
    this.focus.set(motor.position.x, motor.position.y + this.cfg.height, motor.position.z);
    this.focusVel.set(0, 0, 0);
  };

  // forward on the ground plane (unit), for camera-relative movement
  mv.ThirdPersonCamera.prototype.forward = function (out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  };

  mv.ThirdPersonCamera.prototype.update = function (dt, motor, look, isMouse) {
    const c = this.cfg, A = c.aim, want = this.aimTarget || 0;
    this.aimP = want > this.aimP ? Math.min(want, this.aimP + dt / A.time) : Math.max(want, this.aimP - dt / A.time);
    const ak = this.aimK = this.aimP * this.aimP * (3 - 2 * this.aimP);
    const lerp = (a, b) => a + (b - a) * ak;
    const sens = (isMouse ? c.mouseSensitivity : c.sensitivity) * lerp(1, A.sensitivity);
    const looked = Math.abs(look.dx) + Math.abs(look.dy) > 0.5;
    this.yaw = wrap(this.yaw - look.dx * sens);
    // (aiming allows a little more upward look; leaving it, that extra eases back rather than snapping)
    this.pitch = Math.max(lerp(c.minPitch, A.minPitch), Math.min(c.maxPitch, this.pitch + look.dy * sens * 0.8));
    look.dx = look.dy = 0;

    // ease back behind the character once the player stops steering the camera (never while aiming)
    this.idleLook = looked ? 0 : this.idleLook + dt;
    if (ak < 0.01 && this.idleLook > c.recenterDelay && motor.speed > 0.8) {
      const behind = wrap(motor.yaw + Math.PI);
      // only drift behind when travelling away from or across the view; walking
      // toward the camera (or along it) never swings the camera around
      const away = -Math.sin(this.yaw) * Math.sin(motor.yaw) - Math.cos(this.yaw) * Math.cos(motor.yaw);
      const k = (1 - Math.exp(-c.recenterRate * dt)) * Math.min(1, (motor.speed - 0.8) / 2) * smooth(-0.25, 0.85, away);
      this.yaw = wrap(this.yaw + wrap(behind - this.yaw) * k);
    }

    // critically damped spring toward the character
    // camera drops with the operative when she crouches
    this.crouchK = (this.crouchK || 0) + ((motor.stance === 'crouch' ? 1 : 0) - (this.crouchK || 0)) * (1 - Math.exp(-6 * dt));
    const tx = motor.position.x, ty = motor.position.y + c.height + A.height * ak - c.crouchDrop * this.crouchK, tz = motor.position.z;
    const w = c.followStiffness, f = this.focus, v = this.focusVel, e = Math.exp(-w * dt);
    for (const [axis, t] of [['x', tx], ['y', ty], ['z', tz]]) {
      const x = f[axis] - t, tmp = (v[axis] + w * x) * dt;
      v[axis] = (v[axis] - w * tmp) * e;
      f[axis] = t + (x + tmp) * e;
    }

    // orbit offset + shoulder
    const vp = this.pitch - (this.kick || 0);   // (the kick is on top of her own pitch, which it never changes)
    const cp = Math.cos(vp), sp = Math.sin(vp), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const rx = cy, rz = -sy;
    let shoulder = lerp(c.shoulder, A.shoulder);
    const distance = lerp(c.distance, A.distance);
    // aiming: the shoulder pivot itself stays out of a wall at her right (pulled in at once, eased back out)
    if (ak > 0.001) {
      this.ray.set(this._o.set(f.x, f.y, f.z), this._d.set(rx, 0, rz)); this.ray.far = shoulder + 0.25;
      const sh = this.ray.intersectObjects(this.world.meshes, false), lim = sh.length ? Math.max(0, sh[0].distance - 0.25) : shoulder;
      this.shLim = this.shLim == null || lim < this.shLim ? lim : this.shLim + (lim - this.shLim) * (1 - Math.exp(-3 * dt));
      shoulder = Math.min(shoulder, this.shLim);
    } else this.shLim = null;
    const ox = f.x + rx * shoulder, oy = f.y, oz = f.z + rz * shoulder;
    const d = this._d.set(sy * cp, sp, cy * cp);
    this.ray.set(this._o.set(ox, oy, oz), d);
    this.ray.far = distance + 0.3;
    const hits = this.ray.intersectObjects(this.world.meshes, false);
    // (closest it's pulled in: 0.7 m, or nearer while aiming, when it sits off her shoulder rather than behind her head)
    const allowed = hits.length ? Math.max(Math.min(lerp(0.7, 0.05, ak), distance), hits[0].distance - 0.25) : distance;
    this.dist = allowed < this.dist ? allowed : this.dist + (allowed - this.dist) * (1 - Math.exp(-3 * dt));
    let px = ox + d.x * this.dist, py = oy + d.y * this.dist, pz = oz + d.z * this.dist;
    if (py < 0.25) py = 0.25;
    this.cam.position.set(px, py, pz);
    this.cam.lookAt(ox - d.x * 4, oy - d.y * 4 + 0.05, oz - d.z * 4);

    const fov = c.baseFov;
    if (Math.abs(this.cam.fov - fov) > 0.05) { this.cam.fov += (fov - this.cam.fov) * (1 - Math.exp(-4 * dt)); this.cam.updateProjectionMatrix(); }
  };
})(SC.mv);
