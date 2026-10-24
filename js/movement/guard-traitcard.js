// SHADOW CELL — guard personality card (UI only). A small card beside a visible guard's
// shoulder showing his two traits: the primary in capitals, slightly brighter, the
// secondary smaller beneath it. It's drawn in screen space from his 3D position each
// frame (anchored to his body at shoulder height, not to a bone, so it doesn't bob),
// sits a fixed gap to the side of him (the side away from the screen edge), and fades
// in and out. It shows only while the guard himself is visible to the camera: on
// screen, within maxDistance, and not completely hidden behind solid cover (sight lines
// to his head, chest and hips, checked a few times a second, with a short settle time
// so partial cover doesn't make it flicker). It reads the guard's traits and nothing
// else; it never changes what he does.
// Temporary for testing the AI. Later a tactical scanner may decide which guards' traits
// the player has discovered: `reveal` ('always' now; 'discovered' shows a guard's card
// only once guard.traitsDiscovered is true).
(function (mv) {
  'use strict';

  // DOM writes only when a value changes (repeated identical writes still cost style work every frame)
  function setDom(o, hidden, styles) {
    if (o._hid !== hidden) { o._hid = hidden; o.el.hidden = hidden; }
    for (const k in styles) { const v = styles[k]; if (o._st[k] !== v) { o._st[k] = v; o.el.style[k] = v; } }
  }

  mv.TraitCardDefaults = {
    enabled: true,
    reveal: 'always',        // 'always' | 'discovered' (future scanner) | 'never'
    maxDistance: 18,         // m from the camera
    fontSize: 12,            // px, primary trait (the secondary is ~80% of it)
    opacity: 0.92,           // card opacity when fully shown
    height: 1.42,            // m above his feet: shoulder height
    side: 0.36,              // m from his centre to the card's near edge (beside his shoulder)…
    gap: 6,                  // …plus this many pixels
    minScale: 0.85,          // the card shrinks a little with distance, never below this
    refPxPerM: 45,           // …full size at this screen scale (px per metre at his distance; ≈ 6 m away)
    fadeIn: 0.25, fadeOut: 0.25,   // s
    checkHz: 8,              // visibility (sight-line) checks per second
    settle: 3,               // consecutive checks (≈ 0.375 s) that must agree before the card follows a cover change
    smoothing: 0,            // 1/s screen-position easing (0 = none: his body anchor doesn't bob, and easing would lag camera turns)
    margin: 6,               // px kept from the screen edges
    sideMargin: 30,          // px the player must be past him before the card changes side…
    sideHold: 1.2,           // …for this long (s); the change is a quick fade out and in, never a jump
    flipFade: 0.12,          // s
  };

  const label = t => t.charAt(0).toUpperCase() + t.slice(1);

  // avoid (optional): something not to cover, e.g. the player ({ position }): the card goes on
  // his side away from it on screen
  mv.GuardTraitCard = function (el, guard, world, opts, avoid) {
    this.avoid = avoid || null;
    this.cfg = Object.assign({}, mv.TraitCardDefaults, opts || {});
    this.el = el; this.guard = guard; this.world = world; this._st = {}; this._hid = null;
    this.pri = el.querySelector('.mv-trait-primary'); this.sec = el.querySelector('.mv-trait-secondary');
    this.opacity = 0; this.visible = false; this.wantVisible = false; this.why = 'starting';
    this._acc = Infinity; this._pending = null; this._since = 0; this._sx = null; this._sy = null; this._key = '';
    this._v = new THREE.Vector3(); this._r = new THREE.Vector3(); this._p = new THREE.Vector3(); this._q = new THREE.Vector3();
    setDom(this, true, { opacity: '0' });
  };

  mv.GuardTraitCard.prototype.revealed = function () {
    const c = this.cfg;
    return c.reveal === 'always' || (c.reveal === 'discovered' && !!this.guard.traitsDiscovered);
  };

  // is the guard himself visible to this camera? ('' or why not)
  mv.GuardTraitCard.prototype._check = function (camera) {
    const g = this.guard, c = this.cfg, cam = camera.position;
    const base = this._v.copy(g.position);
    if (cam.distanceTo(base.setY(1.2)) > c.maxDistance) return 'too far';
    const s = this._q.copy(base).project(camera);
    if (s.z > 1 || s.z < -1 || Math.abs(s.x) > 1.05 || Math.abs(s.y) > 1.05) return 'off screen';
    // completely behind solid cover: no clear sight line to any of his head, chest or hips
    const pts = [g.bones.head, g.bones.chest, g.bones.hips].filter(Boolean);
    for (const b of pts) if (!this.world.segmentBlocked(cam, b.getWorldPosition(this._p))) return '';
    return pts.length ? 'behind cover' : '';
  };

  // per frame, after the camera has moved: w, h = the canvas size in CSS pixels
  mv.GuardTraitCard.prototype.update = function (dt, camera, w, h) {
    const c = this.cfg, g = this.guard, P = g.personality;
    camera.updateMatrixWorld();   // this frame's view (the renderer would only refresh it when drawing, a frame late for us)
    if (!c.enabled || !P || !this.revealed()) { this.hide(); this.why = !c.enabled ? 'off' : !P ? 'no personality' : 'not discovered'; return; }
    // visibility: checked a few times a second, and only followed once it has settled
    this._acc += dt;
    if (this._acc >= 1 / c.checkHz) {
      this._acc = 0; const why = this._check(camera), want = !why;
      if (want !== this.wantVisible) { if (this._pending === want) this._since++; else { this._pending = want; this._since = 1; } }
      else this._pending = null;
      if (this._pending != null && (this._since >= c.settle || (this.opacity === 0 && this._pending))) { this.wantVisible = this._pending; this._pending = null; }
      this._why = why || 'showing';
    }
    // off screen and too far hide at once (nothing to fade toward); cover fades out
    if (this._why === 'off screen' || this._why === 'too far') this.wantVisible = false;
    this.why = this._why || '';
    // a pending side change fades the card out first; it switches sides while hidden
    const flipping = this._flipTo && this._flipTo !== this._side;
    const target = this.wantVisible && !flipping ? 1 : 0, rate = dt / (flipping ? c.flipFade : target ? c.fadeIn : c.fadeOut);
    this.opacity = target > this.opacity ? Math.min(1, this.opacity + rate) : Math.max(0, this.opacity - rate);
    if (this._why === 'off screen' || this._why === 'too far') this.opacity = 0;
    if (flipping && this.opacity <= 0) { this._side = this._flipTo; this._flipTo = null; }
    if (this.opacity <= 0) { setDom(this, true, { opacity: '0' }); this.visible = false; if (!flipping) this._sx = null; return; }
    // text (only when it changes)
    const key = P.traits.primary + '/' + P.traits.secondary;
    if (key !== this._key) { this._key = key; this.pri.textContent = P.traits.primary.toUpperCase(); this.sec.textContent = label(P.traits.secondary); }
    // anchor: his shoulder height above his feet; screen scale there from the camera's right
    // (Step 14: on the ground, the card sits a little above his body instead of his standing shoulder)
    const a = g.isDown && g.isDown() && g.bones.chest ? g.bones.chest.getWorldPosition(this._v).setY(g.position.y + 0.55) : this._v.copy(g.position).setY(g.position.y + c.height), right = this._r.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    const s = this._q.copy(a).project(camera), sx = (s.x + 1) / 2 * w, sy = (1 - s.y) / 2 * h;
    const e = this._p.copy(a).add(right).project(camera), pxPerM = Math.abs((e.x + 1) / 2 * w - sx);
    const scale = Math.max(c.minScale, Math.min(1, pxPerM / c.refPxPerM));
    // optional easing of the screen position
    const k = this._sx == null || !c.smoothing ? 1 : 1 - Math.exp(-c.smoothing * dt);
    this._sx = this._sx == null ? sx : this._sx + (sx - this._sx) * k; this._sy = this._sy == null ? sy : this._sy + (sy - this._sy) * k;
    this._ppm = this._ppm == null ? pxPerM : this._ppm + (pxPerM - this._ppm) * k;
    const off = c.side * this._ppm + c.gap;
    setDom(this, false, { fontSize: (c.fontSize * scale).toFixed(2) + 'px' });
    const bw = this.el.offsetWidth, bh = this.el.offsetHeight;
    // beside his shoulder on the side away from the player on screen (right by default);
    // flipped if that would run off the screen. The side is held unless it must change
    if (!this._side) this._side = 'right';
    let want = this._side;
    if (this.avoid) { const pv = this._p.copy(this.avoid.position).setY(this.avoid.position.y + c.height).project(camera), px = (pv.x + 1) / 2 * w;
      if (px > this._sx + c.sideMargin) want = 'left'; else if (px < this._sx - c.sideMargin) want = 'right'; }
    // the screen edge decides first
    if (want === 'right' && this._sx + off + bw > w - c.margin) want = 'left'; else if (want === 'left' && this._sx - off - bw < c.margin) want = 'right';
    if (want !== this._side) { this._wantFor = (this._wantSide === want ? this._wantFor : 0) + dt; this._wantSide = want; if (this._wantFor >= c.sideHold || this.opacity < 0.05) this._flipTo = want; }
    else { this._wantFor = 0; this._wantSide = null; }
    let x = this._side === 'right' ? this._sx + off : this._sx - off - bw;
    x = Math.max(c.margin, Math.min(w - c.margin - bw, x));
    const y = Math.max(c.margin, Math.min(h - c.margin - bh, this._sy - bh / 2));
    setDom(this, false, { transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`, opacity: (this.opacity * c.opacity).toFixed(3) });
    this.visible = !flipping; this.side = this._side;
  };

  mv.GuardTraitCard.prototype.hide = function () { this.opacity = 0; this.visible = false; this.wantVisible = false; this._pending = null; this._sx = null; setDom(this, true, { opacity: '0' }); };
})(SC.mv);
