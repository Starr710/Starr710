// SHADOW CELL — third-person follow camera with over-the-shoulder aim and wall avoidance.
(function (SC) {
  'use strict';

  SC.FollowCam = function (camera) {
    this.cam = camera;
    this.yaw = 0;            // 0 = camera south of player, looking north
    this.pitch = 0.32;
    this.dist = 4.4;
    this.curDist = 4.4;
    this.target = new THREE.Vector3();
    this.shoulder = 0.45;
    this.aimBlend = 0;
    this.aimPitch = 0.4;
    this.ray = new THREE.Raycaster();
    this.tmp = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.autoYaw = null;
    this.sens = SC.isTouch ? 0.0065 : 0.0042;
  };

  SC.FollowCam.prototype.snapBehind = function (player) {
    this.yaw = player.yaw + Math.PI;
    this.target.set(player.pos.x, player.pos.y + 1.4, player.pos.z);
  };

  SC.FollowCam.prototype.update = function (dt, player, input) {
    const W = SC.world;
    // look input
    const s = this.sens * (player.aim ? 0.55 : 1);
    this.yaw -= input.look.dx * s;
    this.pitch += input.look.dy * s * 0.8;
    if (this.autoYaw != null) {
      // gentle swing (e.g. when pressing to a wall) that any manual look cancels
      if (Math.abs(input.look.dx) > 2 || Math.abs(SC.angleDiff(this.yaw, this.autoYaw)) < 0.02) this.autoYaw = null;
      else this.yaw = SC.dampAngle(this.yaw, this.autoYaw, 5, dt);
    }
    input.look.dx = input.look.dy = 0;
    this.pitch = SC.clamp(this.pitch, -0.35, 1.15);

    this.aimBlend = SC.damp(this.aimBlend, player.aim ? 1 : 0, 12, dt);
    const A = this.aimBlend;
    // throw pitch when aiming: look up → lob higher
    this.aimPitch = SC.clamp(0.25 - this.pitch * 0.9, -0.3, 1.0);

    const eye = player.stance === 'prone' ? 0.55 : player.stance === 'crouch' ? 1.05 : 1.5;
    const tx = player.pos.x, ty = player.pos.y + eye, tz = player.pos.z;
    this.target.x = SC.damp(this.target.x, tx, 14, dt);
    this.target.z = SC.damp(this.target.z, tz, 14, dt);
    this.target.y = SC.damp(this.target.y, ty, 8, dt);

    const baseDist = player.stance === 'prone' ? 3.4 : player.hug ? 3.8 : 4.4;
    const dist = SC.lerp(baseDist, 1.6, A);
    const shoulder = SC.lerp(this.shoulder * (player.hug ? 0.2 : 1), 0.62, A);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // pivot = target shifted to the right shoulder
    const rx = cy, rz = -sy;
    const px = this.target.x + rx * shoulder, py = this.target.y + A * 0.12, pz = this.target.z + rz * shoulder;
    this.dir.set(sy * cp, sp, cy * cp);

    // obstruction check
    const origin = this.tmp.set(px, py, pz);
    this.ray.set(origin, this.dir);
    this.ray.far = dist + 0.3;
    let allowed = dist;
    const hits = this.ray.intersectObjects(W.occluders.concat(W.roofs.filter(r => r.mesh.visible).map(r => r.mesh)), false);
    if (hits.length) allowed = Math.max(0.6, hits[0].distance - 0.3);
    this.curDist = allowed < this.curDist ? allowed : SC.damp(this.curDist, allowed, 4, dt);

    let cx = px + this.dir.x * this.curDist, cyy = py + this.dir.y * this.curDist, cz = pz + this.dir.z * this.curDist;
    const gy = W.height(cx, cz) + 0.35;
    if (cyy < gy) cyy = gy;
    this.cam.position.set(cx, cyy, cz);
    this.cam.lookAt(px - this.dir.x * 4, py - this.dir.y * 4 + 0.05, pz - this.dir.z * 4);

    const fov = SC.lerp(62, 48, A);
    if (Math.abs(this.cam.fov - fov) > 0.05) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
  };
})(window.SC);
