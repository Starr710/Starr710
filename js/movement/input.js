// SHADOW CELL — movement: player input.
// Touch: the stick appears wherever the left thumb lands (left 45% of the
// screen) and stays put; how far it's pushed picks sneak, stealth walk or jog.
// Any drag elsewhere turns the camera; CROUCH toggles crouch. Keyboard/mouse
// mirror it for desktop. Output is device-independent: move {x,y} (stick space,
// |m| ≤ 1), look deltas in px, and a crouch flag. Nothing here knows about the character.
(function (mv) {
  'use strict';

  mv.Input = function (els) {
    this.move = { x: 0, y: 0 };
    this.look = { dx: 0, dy: 0 };
    this.crouch = false;
    this.mouse = false;          // last look came from a mouse
    this.enabled = false;
    this.els = els;
    this.R = 64;                 // stick travel radius (px)
    this.joy = null; this.lookT = null; this.btn = new Map(); this.keys = new Set();
    // CQC button (Step 13): a short press is a TAP, a long one a HOLD (read and cleared by cqc.js)
    // Step 16: a press that starts while she's free (cqcHoldAllowed, set by cqc.js each frame) is a
    // HOLD — the quick takedown — the moment it has lasted cqcHoldTime (fired once, while still
    // down: pollCqcHold); let go sooner and it's a TAP (grab). One press is one or the other,
    // never both. A press while she holds a guard (RELEASE) keeps the Step 13 rule: TAP if let
    // go within contextHoldTime, otherwise HOLD (which does nothing there). Only the first
    // finger on the button counts; a cancelled touch, blur or hidden page drops the press with
    // no action. Times come from the events' own timestamps
    this.cqcTapped = false; this.cqcHeld = false; this.cqcHoldTime = 0.35; this.contextHoldTime = 0.45; this._cqcDown = null;
    this.cqcHoldAllowed = false; this._cqcFree = false; this._cqcFired = false; this._cqcTouch = null; this.cqcLast = 'IDLE';
    // THROW button (Step 14, shown only while holding a guard): one request per press (read and cleared by cqc.js)
    this.throwTapped = false;
    // CHOKE button (Step 15): press and HOLD. chokePresses counts presses (each may start one
    // choke); choking() is true while it's held: by a touch on it (until that touch ends or is
    // cancelled), the G key or the mouse. Anything that drops input (blur, hidden page) lets go
    this.chokePresses = 0; this._chokeTouches = new Set(); this._chokeKey = false; this._chokeMouse = false;
    // AIM button (Step 18): aimTapped is one request per press (toggle mode, read and cleared by
    // main.js); aiming() is true while it's held (hold mode): a touch on it, the Q key or the mouse
    this.aimTapped = false; this._aimTouches = new Set(); this._aimKey = false; this._aimMouse = false;
    this._bind();
  };

  const P = mv.Input.prototype;
  // when an event actually happened (its own timestamp), not when the page got round to it:
  // a slow frame must not stretch a quick tap into a hold. Falls back to now if a browser's
  // timestamps aren't on the performance clock
  const when = e => { const n = performance.now(), t = e && e.timeStamp; return t > 0 && t <= n + 50 && t > n - 5000 ? t : n; };

  // CROUCH toggles
  P.setCrouch = function (on) {
    this.crouch = on;
    this.els.crouch.classList.toggle('on', on);
    this.els.crouch.setAttribute('aria-pressed', String(on));
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
    this.els.crouch.addEventListener('click', e => { if (e.pointerType !== 'touch' && e.detail !== 0) this.setCrouch(!this.crouch); });
    if (this.els.cqc) this.els.cqc.addEventListener('click', e => { if (this.enabled && e.pointerType !== 'touch' && e.detail !== 0) this.cqcTapped = true; });
    if (this.els.throw) this.els.throw.addEventListener('click', e => { if (this.enabled && e.pointerType !== 'touch' && e.detail !== 0) this.throwTapped = true; });
    if (this.els.aim) {
      this.els.aim.addEventListener('mousedown', e => { if (this.enabled && !this.sourceCapabilitiesTouch(e)) { this._aimMouse = true; this.aimTapped = true; this.els.aim.classList.add('down'); } });
      window.addEventListener('mouseup', () => { if (this._aimMouse) { this._aimMouse = false; this.els.aim.classList.remove('down'); } });
    }
    if (this.els.choke) {
      this.els.choke.addEventListener('mousedown', e => { if (this.enabled && !this.sourceCapabilitiesTouch(e)) { this._chokeMouse = true; this.chokePresses++; this.els.choke.classList.add('down'); } });
      window.addEventListener('mouseup', () => { if (this._chokeMouse) { this._chokeMouse = false; this.els.choke.classList.remove('down'); } });
    }
  };
  // a mouse event synthesised from a touch (the touch handlers already took it)
  P.sourceCapabilitiesTouch = function (e) { return !!(e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) || (this._lastTouch && performance.now() - this._lastTouch < 800); };
  P.choking = function () { return this._chokeTouches.size > 0 || this._chokeKey || this._chokeMouse; };
  P.aiming = function () { return this._aimTouches.size > 0 || this._aimKey || this._aimMouse; };

  P._ts = function (e) {
    this._lastTouch = performance.now();
    if (!this.enabled) return;
    let allow = false;
    for (const t of e.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el && el.closest && el.closest('#mv-crouch')) { this.btn.set(t.identifier, 'crouch'); this.setCrouch(!this.crouch); continue; }
      if (el && el.closest && el.closest('#mv-cqc')) {
        this.btn.set(t.identifier, 'cqc');
        // a press whose finger is no longer on the screen (its touchend never arrived) is dropped, never left stuck
        if (this._cqcDown != null && this._cqcTouch != null && (t.identifier === this._cqcTouch || ![...e.touches].some(x => x.identifier === this._cqcTouch))) this._cqcDrop();
        if (this._cqcDown == null) { this._cqcTouch = t.identifier; this._cqcPress(when(e)); }
        continue;
      }
      if (el && el.closest && el.closest('#mv-throw')) { this.btn.set(t.identifier, 'throw'); this.throwTapped = true; this.els.throw.classList.add('down'); continue; }
      if (el && el.closest && el.closest('#mv-aim')) { this.btn.set(t.identifier, 'aim'); this._aimTouches.add(t.identifier); this.aimTapped = true; this.els.aim.classList.add('down'); continue; }
      if (el && el.closest && el.closest('#mv-choke')) { this.btn.set(t.identifier, 'choke'); this._chokeTouches.add(t.identifier); this.chokePresses++; this.els.choke.classList.add('down'); continue; }
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
      } else if (this.lookT && t.identifier === this.lookT.id) this.lookT = null;
      if (this.btn.get(t.identifier) === 'cqc' && t.identifier === this._cqcTouch) { this._cqcTouch = null; if (e.type === 'touchcancel') this._cqcDrop(); else this._cqcUp(when(e)); }
      if (this.btn.get(t.identifier) === 'throw' && this.els.throw) this.els.throw.classList.remove('down');
      if (this.btn.get(t.identifier) === 'aim') { this._aimTouches.delete(t.identifier); if (!this._aimTouches.size && this.els.aim) this.els.aim.classList.remove('down'); }
      if (this.btn.get(t.identifier) === 'choke') { this._chokeTouches.delete(t.identifier); if (!this._chokeTouches.size && this.els.choke) this.els.choke.classList.remove('down'); }
      this.btn.delete(t.identifier);
    }
    const tgt = e.target;
    if (e.cancelable && !(tgt && tgt.closest && tgt.closest('button, .mv-panel'))) e.preventDefault();
  };

  P._key = function (e, down) {
    if (!this.enabled) return;
    const k = e.code;
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (k === 'KeyC' && down && !e.repeat) this.setCrouch(!this.crouch);
    if (k === 'KeyF' && !e.repeat) { if (down) { if (this._cqcDown == null) this._cqcPress(when(e)); } else this._cqcUp(when(e)); }
    if (k === 'KeyT' && down && !e.repeat) this.throwTapped = true;   // THROW (Step 14)
    if (k === 'KeyQ' && !e.repeat) { if (down) { this._aimKey = true; this.aimTapped = true; } else this._aimKey = false; }   // AIM (Step 18)
    if (k === 'KeyG' && !e.repeat) { if (down) { this._chokeKey = true; this.chokePresses++; } else this._chokeKey = false; }   // CHOKE, held (Step 15)
    let x = 0, y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    // Ctrl = sneak, Alt = stealth walk, nothing = jog (each in the middle of its stick zone)
    const m = this.keys.has('ControlLeft') ? 0.35 : this.keys.has('AltLeft') ? 0.78 : 1;
    const l = Math.hypot(x, y) || 1;
    if (!this.joy) { this.move.x = x / l * m; this.move.y = y / l * m; }
  };

  // the CQC button let go: TAP or HOLD by how long it was pressed
  P._cqcPress = function (at) {
    this._cqcDown = at; this._cqcFree = this.cqcHoldAllowed; this._cqcFired = false; this._cqcArmed = false; this.cqcLast = 'PRESSED';
    if (this.els.cqc) this.els.cqc.classList.add('down');
  };
  P._cqcUp = function (at) {
    if (this._cqcDown == null) return;
    const held = ((at != null ? at : performance.now()) - this._cqcDown) / 1000; this._cqcDown = null;
    if (this.els.cqc) this.els.cqc.classList.remove('down');
    this.cqcHeldFor = held;
    if (this._cqcFired) return;   // already a HOLD (it fired while the finger was down)
    if (held < (this._cqcFree ? this.cqcHoldTime : this.contextHoldTime)) { this.cqcTapped = true; this.cqcLast = 'TAP'; }
    else { this.cqcHeld = true; this.cqcLast = 'HOLD'; }   // (held past it before a frame could see it)
  };
  // the press ended without an action (touch cancelled, focus lost)
  P._cqcDrop = function () {
    if (this._cqcDown == null) return;
    this._cqcDown = null; this._cqcFired = false; this.cqcLast = 'CANCELLED';
    if (this.els.cqc) this.els.cqc.classList.remove('down');
  };
  // per frame (cqc.js): a free press that's lasted cqcHoldTime becomes a HOLD, once. It has
  // to be seen past the threshold on two frames running: a finger-up already on its way (its
  // event can arrive a frame late when the page is busy) gets the frame in between to land,
  // so a quick tap is never taken for a hold (costs a hold at most one frame)
  P.pollCqcHold = function (now) {
    if (this._cqcDown == null || this._cqcFired || !this._cqcFree || !this.cqcHoldAllowed) { this._cqcArmed = false; return false; }
    if (((now != null ? now : performance.now()) - this._cqcDown) / 1000 < this.cqcHoldTime) return false;
    if (!this._cqcArmed) { this._cqcArmed = true; return false; }
    this._cqcArmed = false; this._cqcFired = true; this.cqcHeld = true; this.cqcLast = 'HOLD'; return true;
  };
  // how far a free press is toward a HOLD (0…1), null when there's none
  P.cqcHoldProgress = function (now) {
    if (this._cqcDown == null || this._cqcFired || !this._cqcFree) return null;
    return Math.min(1, ((now != null ? now : performance.now()) - this._cqcDown) / 1000 / this.cqcHoldTime);
  };

  P.clear = function () {
    this.move.x = this.move.y = 0; this.look.dx = this.look.dy = 0;
    this.joy = this.lookT = null; this.btn.clear(); this.keys.clear(); this._cqcDrop(); this._cqcTouch = null;
    this._chokeTouches.clear(); this._chokeKey = false; this._chokeMouse = false; if (this.els.choke) this.els.choke.classList.remove('down');
    this.aimTapped = false; this._aimTouches.clear(); this._aimKey = false; this._aimMouse = false; if (this.els.aim) this.els.aim.classList.remove('down');
    this.els.root.classList.remove('stick-on');
  };
})(SC.mv);
