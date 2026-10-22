// SHADOW CELL — touch + keyboard/mouse input.
// Left 45% of the screen spawns a floating joystick; the rest of the screen (outside
// buttons) drags the camera. Buttons are hit-tested by data-btn so multi-touch works.
(function (SC) {
  'use strict';

  const I = SC.input = {
    move: { x: 0, y: 0 },
    look: { dx: 0, dy: 0 },
    aim: false,
    sprint: false,
    events: new Set(),
    enabled: false,
  };
  I.consume = function (name) { if (I.events.has(name)) { I.events.delete(name); return true; } return false; };
  I.fire = function (name) { I.events.add(name); };

  const JOY_R = 52;
  let joy = null;       // {id, ox, oy}
  let look = null;      // {id, x, y}
  const btnTouches = new Map();   // touch id -> {btn, t0, el}
  let stanceTimer = null;
  let ctrlEl, baseEl, knobEl;
  const keys = new Set();

  function btnPress(name, el) {
    el && el.classList.add('pressed');
    switch (name) {
      case 'stance':
        clearTimeout(stanceTimer);
        stanceTimer = setTimeout(() => { stanceTimer = 'held'; I.fire('stanceHold'); el && el.classList.remove('pressed'); }, 380);
        break;
      case 'aim': I.aim = true; break;
      case 'sprint': I.sprint = !I.sprint; el && el.classList.toggle('on', I.sprint); break;
      default: I.fire(name);
    }
  }
  function btnRelease(name, el) {
    el && el.classList.remove('pressed');
    if (name === 'stance') {
      if (stanceTimer !== 'held') { clearTimeout(stanceTimer); I.fire('stanceTap'); }
      stanceTimer = null;
    }
    if (name === 'aim') I.aim = false;
  }

  function setKnob(dx, dy) {
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function onTouchStart(e) {
    if (!I.enabled) return;
    let allowDefault = false;
    for (const t of e.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const btn = el && el.closest && el.closest('[data-btn]');
      if (btn) {
        const name = btn.dataset.btn;
        btnTouches.set(t.identifier, { name, el: btn });
        btnPress(name, btn);
        continue;
      }
      if (el && el.closest && el.closest('#squad-menu')) { allowDefault = true; continue; }   // let menu buttons click
      if (!joy && t.clientX < window.innerWidth * 0.45) {
        joy = { id: t.identifier, ox: t.clientX, oy: t.clientY };
        baseEl.style.left = knobEl.style.left = t.clientX + 'px';
        baseEl.style.top = knobEl.style.top = t.clientY + 'px';
        setKnob(0, 0);
        ctrlEl.classList.add('active');
      } else if (!look) {
        look = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }
    if (e.cancelable && !allowDefault) e.preventDefault();
  }

  function onTouchMove(e) {
    if (!I.enabled) return;
    for (const t of e.changedTouches) {
      if (joy && t.identifier === joy.id) {
        let dx = t.clientX - joy.ox, dy = t.clientY - joy.oy;
        const d = Math.hypot(dx, dy);
        if (d > JOY_R) {
          // drag the base along so the thumb never "runs off" the stick
          const over = d - JOY_R;
          joy.ox += dx / d * over; joy.oy += dy / d * over;
          baseEl.style.left = knobEl.style.left = joy.ox + 'px';
          baseEl.style.top = knobEl.style.top = joy.oy + 'px';
          dx = t.clientX - joy.ox; dy = t.clientY - joy.oy;
        }
        setKnob(dx, dy);
        I.move.x = dx / JOY_R; I.move.y = -dy / JOY_R;
      } else if (look && t.identifier === look.id) {
        I.look.dx += t.clientX - look.x; I.look.dy += t.clientY - look.y;
        look.x = t.clientX; look.y = t.clientY;
      }
    }
    if (e.cancelable) e.preventDefault();
  }

  function onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (joy && t.identifier === joy.id) {
        joy = null; I.move.x = I.move.y = 0; ctrlEl.classList.remove('active');
        I.sprint = false; document.getElementById('btn-sprint').classList.remove('on');   // RUN toggle ends when the thumb lifts
      }
      else if (look && t.identifier === look.id) look = null;
      const b = btnTouches.get(t.identifier);
      if (b) { btnRelease(b.name, b.el); btnTouches.delete(t.identifier); }
    }
    if (e.cancelable && e.target && !(e.target.closest && e.target.closest('#squad-menu, .screen'))) e.preventDefault();
  }

  // ---------------- keyboard + mouse (desktop testing)
  function updateKeyMove() {
    let x = 0, y = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
    const walk = keys.has('AltLeft') || keys.has('KeyX');
    const l = Math.hypot(x, y) || 1;
    I.move.x = x / l * (walk ? 0.5 : 1); I.move.y = y / l * (walk ? 0.5 : 1);
  }
  function onKey(e, down) {
    if (!I.enabled) return;
    const k = e.code;
    if (down && keys.has(k)) return;
    if (down) keys.add(k); else keys.delete(k);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'KeyX'].includes(k)) updateKeyMove();
    if (k === 'ShiftLeft' || k === 'ShiftRight') I.sprint = down;
    if (!down) return;
    if (k === 'KeyC') I.fire('stanceTap');
    if (k === 'KeyZ') I.fire('prone');
    if (k === 'KeyE' || k === 'Space') I.fire('action');
    if (k === 'KeyQ') I.fire('takedown');
    if (k === 'KeyF') I.fire('attack');
    if (k === 'Tab') { I.fire('squad'); e.preventDefault(); }
    if (k === 'Escape' || k === 'KeyP') I.fire('pause');
  }

  let mouseDrag = null;
  function onMouseDown(e) {
    if (!I.enabled || e.target.closest('[data-btn], #squad-menu, .screen')) return;
    if (e.button === 2) { I.aim = true; return; }
    if (e.button === 0) mouseDrag = { x: e.clientX, y: e.clientY };
  }
  function onMouseMove(e) {
    if (document.pointerLockElement) { I.look.dx += e.movementX; I.look.dy += e.movementY; return; }
    if (!mouseDrag) return;
    I.look.dx += e.clientX - mouseDrag.x; I.look.dy += e.clientY - mouseDrag.y;
    mouseDrag.x = e.clientX; mouseDrag.y = e.clientY;
  }
  function onMouseUp(e) { if (e.button === 2) I.aim = false; if (e.button === 0) mouseDrag = null; }

  // mouse clicks on on-screen buttons (desktop) — touch is handled above
  function onBtnMouse(e) {
    if (SC.isTouch && e.pointerType === 'touch') return;
    const btn = e.target.closest('[data-btn]');
    if (!btn) return;
    btnPress(btn.dataset.btn, btn);
    const up = () => { btnRelease(btn.dataset.btn, btn); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointerup', up);
  }

  I.init = function () {
    ctrlEl = document.getElementById('controls');
    baseEl = document.getElementById('joy-base');
    knobEl = document.getElementById('joy-knob');
    const opts = { passive: false };
    document.addEventListener('touchstart', onTouchStart, opts);
    document.addEventListener('touchmove', onTouchMove, opts);
    document.addEventListener('touchend', onTouchEnd, opts);
    document.addEventListener('touchcancel', onTouchEnd, opts);
    // block iOS pinch-zoom / double-tap zoom
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('dblclick', e => e.preventDefault());
    window.addEventListener('keydown', e => onKey(e, true));
    window.addEventListener('keyup', e => onKey(e, false));
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('contextmenu', e => e.preventDefault());
    ctrlEl.addEventListener('pointerdown', onBtnMouse);
    window.addEventListener('blur', I.clear);
  };

  I.clear = function () {
    I.move.x = I.move.y = 0; I.look.dx = I.look.dy = 0; I.aim = false; I.sprint = false;
    joy = look = null; btnTouches.clear(); keys.clear(); I.events.clear();
    if (ctrlEl) { ctrlEl.classList.remove('active'); ctrlEl.querySelectorAll('.pressed').forEach(b => b.classList.remove('pressed')); }
  };
})(window.SC);
