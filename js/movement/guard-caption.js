// SHADOW CELL — TEMPORARY guard reaction caption (Step 8.1). A stand-in for the
// voice recordings that don't exist yet: when the guard's one-per-incident vocal
// reaction fires (guard-voice.js) and no recording played, a small "Huh" appears
// above his head for about 1.2 s and fades. It follows him, is hidden when a
// solid object is between the camera and his head or he's too far away, and is
// dismissed the moment he becomes ALERT. It never changes what the guard does.
// To remove once real audio exists: set GuardCaptionDefaults.enabled = false (or
// delete this file, its <script> tag, the #mv-caption element and the lines marked
// "caption" in main.js). With onlyWithoutRecording, a played recording shows nothing.
(function (mv) {
  'use strict';

  mv.GuardCaptionDefaults = {
    enabled: true,
    onlyWithoutRecording: true,   // show only when the voice had no recording to play
    text: 'Huh',
    fadeIn: 0.12,          // s
    hold: 1.2,             // s fully shown…
    fadeOut: 0.45,         // …then fades over this long
    height: 0.38,          // m above his head bone
    maxDistance: 24,       // m from the camera beyond which it isn't drawn
  };

  mv.GuardCaption = function (el, guard, world, opts) {
    this.cfg = Object.assign({}, mv.GuardCaptionDefaults, opts || {});
    this.el = el; this.guard = guard; this.world = world;
    this.active = false; this.t = 0; this.visible = false; this.why = '';
    this.shown = 0; this.dismissed = 0;
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.hide();
  };

  mv.GuardCaption.prototype.show = function (text) {
    if (!this.cfg.enabled) return false;
    this.el.textContent = text || this.cfg.text;
    this.active = true; this.t = 0; this.shown++;
    return true;
  };

  mv.GuardCaption.prototype.hide = function () {
    this.active = false; this.visible = false;
    this.el.style.opacity = '0'; this.el.hidden = true;
  };

  mv.GuardCaption.prototype.opacity = function () {
    const c = this.cfg, t = this.t;
    if (t < c.fadeIn) return t / c.fadeIn;
    if (t < c.fadeIn + c.hold) return 1;
    return Math.max(0, 1 - (t - c.fadeIn - c.hold) / c.fadeOut);
  };

  // per frame, after the camera has moved: w, h = the canvas size in CSS pixels
  mv.GuardCaption.prototype.update = function (dt, camera, w, h) {
    if (!this.active) return;
    const c = this.cfg, g = this.guard;
    if (g.awareness && g.awareness.state === 'ALERT') { this.dismissed++; this.why = 'dismissed: ALERT'; this.hide(); return; }
    this.t += dt;
    if (this.t >= c.fadeIn + c.hold + c.fadeOut) { this.why = 'faded'; this.hide(); return; }
    // anchored above his head; the clock runs on while it's hidden, so it never shows late
    const p = (g.head ? g.head.getWorldPosition(this._p) : this._p.copy(g.position).setY(1.7)); p.y += c.height;
    const dist = camera.position.distanceTo(p), s = this._s.copy(p).project(camera);
    let why = '';
    if (dist > c.maxDistance) why = 'too far';
    else if (s.z > 1 || s.z < -1 || Math.abs(s.x) > 1.1 || Math.abs(s.y) > 1.1) why = 'off screen';
    else if (this.world.segmentBlocked(camera.position, p)) why = 'behind cover';
    this.visible = !why; this.why = why || 'showing';
    if (!this.visible) { this.el.hidden = true; return; }
    this.el.hidden = false;
    this.el.style.opacity = this.opacity().toFixed(3);
    this.el.style.transform = `translate(${((s.x + 1) / 2 * w).toFixed(1)}px, ${((1 - s.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
  };
})(SC.mv);
