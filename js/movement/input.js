// SHADOW CELL — movement: player input.
// Touch: a floating stick spawns wherever the left thumb lands (left 45% of the
// screen); any drag elsewhere turns the camera; RUN toggles sprint and switches
// itself off when the stick is released. Keyboard/mouse mirror it for desktop.
// Output is device-independent: move {x,y} (stick space, |m| ≤ 1), look deltas
// in px, and a sprint flag. Nothing here knows about the character.
(function (mv) {
  'use strict';

  mv.Input = function (els) {
    this.move = { x: 0, y: 0 };
    this.look = { dx: 0, dy: 0 };
    this.sprint = false;
    this.crouch = false;
    this.mouse = false;          // last look came from a mouse
    this.enabled = false;
    this.els = els;
    this.R = 64;                 // stick travel radius (px)
    this.joy = null; this.lookT = null; this.btn = new Map(); this.keys = new Set();
    this._bind();
  };

  const P = mv.Input.prototype;

  // CROUCH toggles; sprinting stands her up, crouching cancels a sprint
  P.setCrouch = function (on) {
    this.crouch = on;
    this.els.crouch.classList.toggle('on', on);
    this.els.crouch.setAttribute('aria-pressed', String(on));
    if (on && this.sprint) this.setSprint(false);
  };

  P.setSprint = function (on) {
    if (on && this.crouch) this.setCrouch(false);
    this.sprint = on;
    this.els.sprint.classList.toggle('on', on);
    this.els.sprint.setAttribute('aria-pressed', String(on));
  };

  P._knob = function (dx, dy) { this.els.knob.style.transform = `translate(${dx}px, ${dy}px)`; };
  P._placeBase = function (x, y) {
    const b = this.els.base.style, k = this.els.knob.style;
    b.left = k.left = x + 'px'; b.top = k.top = y + 'px';
  };

  P._bind = function () {
    const opt = { passive: false };
    document.addEventListener('touchstart', e => this._ts(e), opt);
    document.addEventListener('touchmove', e => this._tm(e), opt);
    document.addEventListener('touchend', e => this._te(e), opt);
    document.addEventListener('touchcancel', e => this._te(e), opt);
    ['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault(), opt));
    window.addEventListener('keydown', e => this._key(e, true));
    window.addEventListener('keyup', e => this._key(e, false));
    window.addEventListener('blur', () => this.clear());
    // mouse look: drag, or pointer lock after a click on the canvas
    let drag = null;
    window.addEventListener('mousedown', e => { if (this.enabled && e.target.tagName === 'CANVAS') { drag = { x: e.clientX, y: e.clientY }; } });
    window.addEventListener('mousemove', e => {
      if (!this.enabled) return;
      if (document.pointerLockElement) { this.look.dx += e.movementX; this.look.dy += e.movementY; this.mouse = true; return; }
      if (!drag) return;
      this.look.dx += e.clientX - drag.x; this.look.dy += e.clientY - drag.y; this.mouse = true;
      drag.x = e.clientX; drag.y = e.clientY;
    });
    window.addEventListener('mouseup', () => { drag = null; });
    this.els.sprint.addEventListener('click', e => { if (e.pointerType !== 'touch' && e.detail !== 0) this.setSprint(!this.sprint); });
    this.els.crouch.addEventListener('click', e => { if (e.pointerType !== 'touch' && e.detail !== 0) this.setCrouch(!this.crouch); });
  };

  P._ts = function (e) {
    if (!this.enabled) return;
    let allow = false;
    for (const t of e.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el && el.closest && el.closest('#mv-sprint')) { this.btn.set(t.identifier, 'sprint'); this.setSprint(!this.sprint); continue; }
      if (el && el.closest && el.closest('#mv-crouch')) { this.btn.set(t.identifier, 'crouch'); this.setCrouch(!this.crouch); continue; }
      if (el && el.closest && el.closest('button, .mv-panel')) { allow = true; continue; }
      if (!this.joy && t.clientX < window.innerWidth * 0.45) {
        this.joy = { id: t.identifier, ox: t.clientX, oy: t.clientY };
        this._placeBase(t.clientX, t.clientY); this._knob(0, 0);
        this.els.root.classList.add('stick-on');
      } else if (!this.lookT) {
        this.lookT = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }
    if (!allow && e.cancelable) e.preventDefault();
  };

  P._tm = function (e) {
    if (!this.enabled) return;
    for (const t of e.changedTouches) {
      if (this.joy && t.identifier === this.joy.id) {
        const j = this.joy, R = this.R;
        // the base stays where the thumb first landed, so the push amount (and
        // with it sneak / stealth walk / jog) only changes when the thumb does
        let dx = t.clientX - j.ox, dy = t.clientY - j.oy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        this._knob(dx, dy);
        this.move.x = dx / R; this.move.y = -dy / R;
      } else if (this.lookT && t.identifier === this.lookT.id) {
        this.look.dx += t.clientX - this.lookT.x; this.look.dy += t.clientY - this.lookT.y; this.mouse = false;
        this.lookT.x = t.clientX; this.lookT.y = t.clientY;
      }
    }
    if (e.cancelable) e.preventDefault();
  };

  P._te = function (e) {
    for (const t of e.changedTouches) {
      if (this.joy && t.identifier === this.joy.id) {
        this.joy = null; this.move.x = this.move.y = 0;
        this.els.root.classList.remove('stick-on');
        this.setSprint(false);
      } else if (this.lookT && t.identifier === this.lookT.id) this.lookT = null;
      this.btn.delete(t.identifier);
    }
    const tgt = e.target;
    if (e.cancelable && !(tgt && tgt.closest && tgt.closest('button, .mv-panel'))) e.preventDefault();
  };

  P._key = function (e, down) {
    if (!this.enabled) return;
    const k = e.code;
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (k === 'ShiftLeft' || k === 'ShiftRight') this.setSprint(down);
    if (k === 'KeyC' && down && !e.repeat) this.setCrouch(!this.crouch);
    let x = 0, y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    // Ctrl = slow walk, Alt = walk, nothing = jog
    const m = this.keys.has('ControlLeft') ? 0.35 : this.keys.has('AltLeft') ? 0.65 : 1;
    const l = Math.hypot(x, y) || 1;
    if (!this.joy) { this.move.x = x / l * m; this.move.y = y / l * m; }
  };

  P.clear = function () {
    this.move.x = this.move.y = 0; this.look.dx = this.look.dy = 0;
    this.joy = this.lookT = null; this.btn.clear(); this.keys.clear();
    this.setSprint(false);
    this.els.root.classList.remove('stick-on');
  };
})(SC.mv);
