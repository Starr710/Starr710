// SHADOW CELL — TEMPORARY overhead awareness indicator (UI only). A small symbol above a
// visible guard's head showing his ongoing awareness state, read straight from his
// awareness (no second state machine):
//   NORMAL                    nothing
//   SUSPICIOUS, INVESTIGATING a small yellow "?" (one symbol for both: it doesn't restart)
//   ALERT                     a small red "!"
//   EVASION                   a subtle search symbol
//   HEIGHTENED                the search symbol, subdued
//   RETURNING                 whatever he showed last, fading out as he stands down
// It sits above the "Huh" slot (so the two never overlap) and follows his head; it shows
// only while the guard himself is visible (the personality card's check: on screen,
// within maxDistance, not completely behind solid cover, settled so it doesn't flicker).
// A change of symbol is a short cross-fade; a repeated sound never restarts it.
// Which symbols are shown is a display preset (difficulty-style), plus a developer
// override; this is visual feedback only and never changes what the guard does.
// Temporary symbols: to be replaced with Shadow Cell's own visual language.
(function (mv) {
  'use strict';

  // DOM writes only when a value changes (repeated identical writes still cost style work every frame)
  function setDom(o, hidden, styles) {
    if (o._hid !== hidden) { o._hid = hidden; o.el.hidden = hidden; }
    for (const k in styles) { const v = styles[k]; if (o._st[k] !== v) { o._st[k] = v; o.el.style[k] = v; } }
  }

  // which kinds of indicator each preset shows
  mv.IndicatorPresets = {
    easy: { suspicion: true, alert: true, search: true },
    normal: { suspicion: true, alert: true, search: false },
    hard: { suspicion: false, alert: true, search: false },
    extreme: { suspicion: false, alert: false, search: false },
  };

  mv.IndicatorDefaults = {
    enabled: true,
    preset: 'normal',        // easy | normal | hard | extreme
    devShowAll: false,       // developer override: show every kind regardless of preset (also #all-indicators in the URL)
    maxDistance: 24,         // m from the camera
    height: 0.38,            // m above his head bone: the same anchor as the "Huh"…
    above: 19,               // …and this many px higher, clear of it
    fontSize: 15,            // px (shrinks a little with distance, never below minScale)
    minScale: 0.8, refPxPerM: 45,
    fadeIn: 0.2, fadeOut: 0.3,   // s to appear / disappear
    swapFade: 0.12,          // s the old symbol takes to fade when it's being replaced ("?" → "!" is quick)
    returnFade: 1.4,         // s over which the symbol fades out once he's walking back to stand down
    // the temporary symbols
    kinds: {
      suspicion: { text: '?', color: '#f2cf4a', opacity: 1 },
      alert: { text: '!', color: '#ff4a3d', opacity: 1 },
      search: { text: '···', color: '#e6a04a', opacity: 0.95 },
      searchSubdued: { text: '···', color: '#b8a888', opacity: 0.55, group: 'search' },
    },
    checkHz: 8, settle: 3,   // visibility checks (as the personality card)
  };

  const KIND = { SUSPICIOUS: 'suspicion', INVESTIGATING: 'suspicion', ALERT: 'alert', EVASION: 'search', HEIGHTENED: 'searchSubdued' };

  mv.GuardIndicator = function (el, guard, world, opts) {
    this.cfg = Object.assign({}, mv.IndicatorDefaults, opts || {});
    if (typeof location !== 'undefined' && /all-indicators/.test(location.hash)) this.cfg.devShowAll = true;
    this.el = el; this.guard = guard; this.world = world; this._st = {}; this._hid = null;
    this.kind = null; this.opacity = 0; this.visible = false; this.why = '';
    this.changes = 0; this.returnT = 0;
    this.wantVisible = false; this._acc = Infinity; this._pending = null; this._since = 0;
    this._v = new THREE.Vector3(); this._p = new THREE.Vector3(); this._q = new THREE.Vector3(); this._r = new THREE.Vector3();
    setDom(this, true, { opacity: '0' });
  };

  // is this kind shown under the current preset (or the developer override)?
  mv.GuardIndicator.prototype.allowed = function (kind) {
    const c = this.cfg, k = c.kinds[kind], group = k && k.group || kind;
    return c.devShowAll || !!(mv.IndicatorPresets[c.preset] || mv.IndicatorPresets.normal)[group];
  };

  // the symbol his awareness calls for right now (null: none)
  mv.GuardIndicator.prototype.wanted = function (dt) {
    const a = this.guard.awareness, s = a ? a.state : 'NORMAL';
    if (s === 'RETURNING') { this.returnT += dt; return this.returnT < this.cfg.returnFade ? this.kind : null; }
    this.returnT = 0;
    const k = KIND[s] || null;
    return k && this.allowed(k) ? k : null;
  };

  mv.GuardIndicator.prototype.update = function (dt, camera, w, h) {
    const c = this.cfg, g = this.guard;
    camera.updateMatrixWorld();
    if (!c.enabled) { this.hide(); this.why = 'off'; return; }
    // visibility of the guard himself, as the personality card judges it
    this._acc += dt;
    if (this._acc >= 1 / c.checkHz) {
      this._acc = 0; const why = mv.GuardTraitCard.prototype._check.call(this, camera), want = !why;
      if (want !== this.wantVisible) { if (this._pending === want) this._since++; else { this._pending = want; this._since = 1; } }
      else this._pending = null;
      if (this._pending != null && (this._since >= c.settle || (this.opacity === 0 && this._pending))) { this.wantVisible = this._pending; this._pending = null; }
      this._why = why || 'showing';
    }
    const hard = this._why === 'off screen' || this._why === 'too far';
    if (hard) this.wantVisible = false;
    // the symbol: a change fades the current one out, swaps while invisible, then fades in
    // (the same symbol staying wanted — e.g. SUSPICIOUS → INVESTIGATING, or more footsteps — changes nothing)
    const want = this.wanted(dt), returning = g.awareness && g.awareness.state === 'RETURNING';
    if (want !== this.kind && (this.opacity <= 0 || !this.kind)) { this.kind = want; if (want) { this.changes++; const k = c.kinds[want]; this.el.textContent = k.text; this.el.style.color = k.color; } }
    const target = this.kind && want === this.kind && this.wantVisible && !returning ? 1 : 0;
    const swapping = this.kind && want && want !== this.kind;
    const rate = dt / (returning ? c.returnFade : target > this.opacity ? c.fadeIn : swapping ? c.swapFade : c.fadeOut);
    this.opacity = target > this.opacity ? Math.min(1, this.opacity + rate) : Math.max(0, this.opacity - rate);
    if (hard) this.opacity = 0;
    if (this.opacity <= 0 || !this.kind) { setDom(this, true, { opacity: '0' }); this.visible = false; this.why = !this.kind ? 'no indicator' : this._why; return; }
    const k = c.kinds[this.kind];
    // above his head, clear of the "Huh" slot
    const a = (g.head ? g.head.getWorldPosition(this._v) : this._v.copy(g.position).setY(1.7)); a.y += c.height;
    const s = this._q.copy(a).project(camera), sx = (s.x + 1) / 2 * w, sy = (1 - s.y) / 2 * h;
    const right = this._r.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize(), e = this._p.copy(a).add(right).project(camera), ppm = Math.abs((e.x + 1) / 2 * w - sx);
    const scale = Math.max(c.minScale, Math.min(1, ppm / c.refPxPerM));
    setDom(this, false, { fontSize: (c.fontSize * scale).toFixed(2) + 'px', transform: `translate(${sx.toFixed(1)}px, ${(sy - c.above).toFixed(1)}px) translate(-50%, -100%)`, opacity: (this.opacity * k.opacity).toFixed(3) });
    this.visible = true; this.why = this._why;
  };

  mv.GuardIndicator.prototype.hide = function () { this.opacity = 0; this.visible = false; this.wantVisible = false; this._pending = null; this.kind = null; this.returnT = 0; setDom(this, true, { opacity: '0' }); };
})(SC.mv);
