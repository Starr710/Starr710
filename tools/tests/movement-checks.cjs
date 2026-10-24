// SHADOW CELL — movement regression checks.
//
//   node tools/tests/movement-checks.cjs            (from the repo root)
//   node tools/tests/movement-checks.cjs zones fingers   (run only some checks)
//
// Starts its own static server, opens movement.html in headless Chromium and
// runs each check against the real controller, animator and posture code. Every
// check prints PASS/FAIL against limits taken from the approved movement, so a
// new animation pack, rig or tuning change that slides feet, pops joints, clips
// limbs or changes the stick speeds shows up here before it reaches the phone.
// Needs Playwright (`npm i -D playwright`, or a global install).
'use strict';

const http = require('http'), fs = require('fs'), path = require('path');

function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(p); } catch (e) { /* next */ } }
  console.error('Playwright not found. Install it with: npm i -D playwright');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.txt': 'text/plain' };
function serve() {
  return new Promise(res => {
    const server = http.createServer((req, rsp) => {
      const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!file.startsWith(ROOT)) { rsp.writeHead(403); return rsp.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { rsp.writeHead(404); return rsp.end(); }
        rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        rsp.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => res(server));
  });
}

// ---------------------------------------------------------------- page helpers
let browser, base;
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

// a lab page stepped by hand at 60 fps (loop stopped), with the helpers below
async function simPage() {
  const page = await (await browser.newContext({ viewport: { width: 640, height: 300 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/movement.html');
  await page.waitForSelector('#mv-start:not([hidden])', { timeout: 120000 });
  await page.evaluate(() => {
    MV.renderer.setAnimationLoop(null);
    const { motor, animator, visual, posture } = MV;
    window.W = o => o.getWorldPosition(new THREE.Vector3());
    // one 60 fps frame: stick push m (0..1) toward world (x, z), in a stance
    window.step = (m, stance, x, z) => {
      motor.stance = stance || 'stand';
      motor.update(1 / 60, m ? (x == null ? 0 : x) : 0, m ? (z == null ? 1 : z) : 0, m);
      visual.place(motor.position, motor.yaw); animator.update(1 / 60, motor); posture.update(1 / 60, motor, animator);
      visual.root.updateMatrixWorld(true);
    };
    // a guard with one of the test personality profiles (A Curious/Bored, B Focused/Bored, C Careless/Bored)
    window.useProfile = (k, extra) => { const g = MV.guard; g.personality = new MV.SCmv.GuardPersonality(g, Object.assign({}, MV.area.profiles[k], extra || {})); return g.personality; };
    window.angJump = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 57.2958;
    window.segDist = (p, a, b) => { const ab = b.clone().sub(a); const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(a.clone().addScaledVector(ab, t)); };
    motor.teleport(-6, -20, 0);
    // the checks written before Step 9 cover the stationary guard (still a setting): patrol off
    MV.guard.patrol.enabled = false; MV.guard.personality.enabled = false; MV.guard.reset();   // and no personality influence (Step 10)
  });
  page.errors = errors;
  return page;
}

// Step 9: the same page with the guard on his patrol route, from its clean start
// (personality influence stays off: the patrol checks cover the routine itself)
async function patrolPage(touch) {
  const page = touch ? await touchPage() : await simPage();
  await page.evaluate(() => { MV.guard.patrol.enabled = true; MV.guard.reset(); });
  return page;
}

// an iPhone-landscape page driven by real touch events with the frame loop running
async function touchPage() {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/movement.html');
  await page.waitForSelector('#mv-start:not([hidden])', { timeout: 120000 });
  await page.tap('#mv-start'); await page.waitForTimeout(300);
  await page.evaluate(() => {
    MV.guard.patrol.enabled = false; MV.guard.personality.enabled = false; MV.guard.reset();   // stationary, neutral guard (see simPage)
    window.useProfile = (k, extra) => { const g = MV.guard; g.personality = new MV.SCmv.GuardPersonality(g, Object.assign({}, MV.area.profiles[k], extra || {})); return g.personality; };
  });
  const cdp = await ctx.newCDPSession(page);
  page.touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  page.errors = errors;
  return page;
}

const r2 = v => v.toFixed(2), cm = v => (v * 100).toFixed(1) + ' cm';

// ---------------------------------------------------------------- checks
const CHECKS = {
  // stick push → speed, through real touches on the fixed-base stick (R = 64 px)
  async zones() {
    const page = await touchPage(), T = page.touch, X = 150, Y0 = 300, res = [];
    const tapCrouch = async () => { const bb = await page.locator('#mv-crouch').boundingBox(); await T('touchStart', [{ x: bb.x + 30, y: bb.y + 30, id: 9 }]); await T('touchEnd', []); await page.waitForTimeout(700); };
    const hold = async (dy) => {
      await page.evaluate(() => { MV.motor.teleport(-6, -20, 0); MV.cam.snap(MV.motor); });
      await T('touchStart', [{ x: X, y: Y0, id: 1 }]); await T('touchMove', [{ x: X, y: Y0 - dy, id: 1 }]);
      await page.waitForTimeout(1800);
      const r = await page.evaluate(() => [MV.motor.speed, MV.motor.gait.label]);
      await T('touchEnd', []); await page.waitForTimeout(1200);
      return r;
    };
    const wobble = async (dy) => {
      await page.evaluate(() => { MV.motor.teleport(-6, -20, 0); MV.cam.snap(MV.motor); });
      await T('touchStart', [{ x: X, y: Y0, id: 1 }]); await T('touchMove', [{ x: X, y: Y0 - dy, id: 1 }]); await page.waitForTimeout(1200);
      await page.evaluate(() => { window.__g = []; (function f() { window.__g.push(MV.motor.gait.label); if (window.__g.length < 400) requestAnimationFrame(f); })(); });
      for (let i = 0; i < 24; i++) { await T('touchMove', [{ x: X + (i % 2 ? 1 : -1), y: Y0 - dy + (i % 2 ? 2 : -2), id: 1 }]); await page.waitForTimeout(100); }
      const g = await page.evaluate(() => window.__g); let flips = 0; for (let i = 1; i < g.length; i++) if (g[i] !== g[i - 1]) flips++;
      await T('touchEnd', []); await page.waitForTimeout(1200);
      return flips;
    };
    let ok = true;
    for (const [dy, label, lo, hi] of [[25, 'SNEAK', 1.0, 1.3], [50, 'STEALTH WALK', 1.85, 2.05], [64, 'JOG', 3.1, 3.3]]) {
      const [v, g] = await hold(dy); const pass = g === label && v >= lo && v <= hi; ok = ok && pass; res.push(`${dy}px ${g} ${r2(v)}`);
    }
    let flips = 0; for (const dy of [38, 41, 56, 58]) flips += await wobble(dy);
    res.push(`wobble flips ${flips}`); ok = ok && flips === 0;
    await tapCrouch();
    for (const [dy, label, lo, hi] of [[25, 'SLOW CROUCH', 0.75, 1.05], [60, 'FAST CROUCH', 1.8, 2.05]]) {
      const [v, g] = await hold(dy); const pass = g === label && v >= lo && v <= hi; ok = ok && pass; res.push(`crouch ${dy}px ${g} ${r2(v)}`);
    }
    ok = ok && !page.errors.length;
    return { pass: ok, detail: res.join(', ') + (page.errors.length ? ' errors: ' + page.errors.join('; ') : '') };
  },

  // on-screen controls: no RUN button, CROUCH toggles, stick + camera drag together
  async controls() {
    const page = await touchPage(), T = page.touch, res = [];
    const noRun = (await page.locator('#mv-sprint').count()) === 0; res.push(noRun ? 'no RUN button' : 'RUN button present');
    await page.evaluate(() => MV.motor.teleport(-6, -20, 0));
    await T('touchStart', [{ x: 150, y: 300, id: 1 }]); await T('touchMove', [{ x: 150, y: 236, id: 1 }]); await page.waitForTimeout(600);
    const yaw0 = await page.evaluate(() => MV.cam.yaw);
    await T('touchStart', [{ x: 150, y: 236, id: 1 }, { x: 600, y: 200, id: 2 }]);
    for (let i = 1; i <= 25; i++) { await T('touchMove', [{ x: 150, y: 236, id: 1 }, { x: 600 + i * 4, y: 200, id: 2 }]); await page.waitForTimeout(30); }
    const [g, yaw1] = await page.evaluate(() => [MV.motor.gait.label, MV.cam.yaw]);
    const twoThumb = g === 'JOG' && Math.abs(yaw1 - yaw0) > 0.1; res.push(`stick + look: ${g}, camera turned ${r2(Math.abs(yaw1 - yaw0))} rad`);
    await T('touchEnd', []); await page.waitForTimeout(1200);
    const bb = await page.locator('#mv-crouch').boundingBox();
    await T('touchStart', [{ x: bb.x + 30, y: bb.y + 30, id: 5 }]); await T('touchEnd', []); await page.waitForTimeout(500);
    const on = await page.evaluate(() => MV.input.crouch && MV.motor.stance === 'crouch');
    await T('touchStart', [{ x: bb.x + 30, y: bb.y + 30, id: 6 }]); await T('touchEnd', []); await page.waitForTimeout(500);
    const off = await page.evaluate(() => !MV.input.crouch && MV.motor.stance === 'stand');
    res.push(`CROUCH on ${on}, off ${off}`);
    return { pass: noRun && twoThumb && on && off && !page.errors.length, detail: res.join(', ') };
  },

  // planted foot speed while walking at each gait (median over the stance phase)
  async plantedFeet() {
    const page = await simPage();
    const rows = await page.evaluate(() => {
      const { motor, visual } = MV, B = visual.bones, out = [];
      for (const [name, m, st] of [['sneak', 0.6, 'stand'], ['stealth walk', 0.88, 'stand'], ['jog', 1, 'stand'], ['slow crouch', 0.6, 'crouch'], ['fast crouch', 0.88, 'crouch']]) {
        motor.teleport(-6, -20, 0); const rec = [];
        for (let f = 0; f < 200; f++) { step(m, st); if (f > 90) rec.push([W(B.leftFoot), W(B.rightFoot)]); }
        const minY = Math.min(...rec.map(r => Math.min(r[0].y, r[1].y))), sl = [];
        for (let i = 1; i < rec.length; i++) { const k = rec[i][0].y < rec[i][1].y ? 0 : 1; if (rec[i][k].y < minY + 0.025 && rec[i - 1][k].y < minY + 0.025) sl.push(Math.hypot(rec[i][k].x - rec[i - 1][k].x, rec[i][k].z - rec[i - 1][k].z) * 60); }
        sl.sort((a, b) => a - b);
        out.push([name, motor.speed, sl.length > 4 ? sl[sl.length >> 1] : 9]);
      }
      return out;
    });
    return { pass: rows.every(r => r[2] <= 0.4), detail: rows.map(r => `${r[0]} ${r2(r[1])} m/s slip ${r2(r[2])}`).join(', ') };
  },

  // releasing the stick: she finishes the step and settles without the planted foot sliding
  async stops() {
    const page = await simPage();
    const rows = await page.evaluate(() => {
      const { motor, animator, visual } = MV, B = visual.bones, out = [];
      for (const [name, m, frames, st] of [['sneak', 0.3, 140, 'stand'], ['stealth walk', 0.78, 150, 'stand'], ['jog', 1, 150, 'stand'], ['slow crouch', 0.3, 140, 'crouch'], ['fast crouch', 1, 150, 'crouch']]) {
        motor.teleport(-6, -20, 0);
        for (let f = 0; f < frames; f++) step(m, st);
        let prev = null, slip = 0, stopAt = null;
        for (let f = 0; f < 150; f++) {
          step(0, st); const pos = [W(B.leftFoot), W(B.rightFoot)];
          // a planted foot: low and not the one stepping (the slower of the two)
          if (prev) { const v = pos.map((p, k) => Math.hypot(p.x - prev[k].x, p.z - prev[k].z) * 60); const k = v[0] < v[1] ? 0 : 1; if (pos[k].y < 0.12) slip = Math.max(slip, v[k]); }
          prev = pos; if (stopAt == null && animator.state === 'stopped') stopAt = f / 60;
        }
        out.push([name, stopAt == null ? 9 : stopAt, slip, animator.weights.idle]);
      }
      return out;
    });
    // the jog stop's last stride briefly drags the planted foot (~0.7 m/s, as approved); the rest must stay planted
    const limit = name => name === 'jog' ? 0.8 : 0.15;
    return { pass: rows.every(r => r[1] <= 1.0 && r[2] <= limit(r[0]) && r[3] >= 0.99), detail: rows.map(r => `${r[0]} ${r2(r[1])} s slip ${r2(r[2])}`).join(', ') };
  },

  // fingers don't drift or spin over 10 s
  async fingers() {
    const page = await simPage();
    const rows = await page.evaluate(() => {
      const { visual } = MV, fb = visual.fingers.left.map(f => f.bone), out = [];
      for (const [name, m, st] of [['crouch idle', 0, 'crouch'], ['crouch walk', 1, 'crouch'], ['stealth walk', 0.78, 'stand']]) {
        for (let f = 0; f < 60; f++) step(m, st);
        const samples = []; for (let f = 0; f < 600; f++) { step(m, st); if (f % 120 === 0) samples.push(fb.map(x => x.quaternion.clone())); }
        out.push([name, Math.max(...fb.map((x, i) => Math.max(...samples.map(sm => sm[i].angleTo(samples[0][i]) * 57.3))))]);
      }
      return out;
    });
    return { pass: rows.every(r => r[1] <= 10), detail: rows.map(r => `${r[0]} ${r[1].toFixed(1)}°`).join(', ') };
  },

  // 60 s of random stick input, stance changes, turns, stops and starts: no
  // single-frame joint pops while crouched (standing reversals are reported only)
  async jointPops() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, visual } = MV, B = visual.bones;
      const names = ['spine1', 'chest', 'neck', 'head', 'leftArm', 'rightArm', 'leftForeArm', 'rightForeArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg'];
      let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const prev = {}, last = {}; let crouchHits = 0, standHits = 0, worst = 0, where = '';
      motor.teleport(-6, -20, 0); let x = 0, y = 0, tx = 0, ty = 0, stance = 'crouch';
      for (let f = 0; f < 3600; f++) {
        if (f % 45 === 0) { const a = rnd() * 6.28, m = rnd() < 0.2 ? 0 : rnd(); tx = Math.sin(a) * m; ty = Math.cos(a) * m; if (rnd() < 0.08) stance = stance === 'crouch' ? 'stand' : 'crouch'; }
        x += (tx - x) * 0.3; y += (ty - y) * 0.3; const m = Math.hypot(x, y);
        motor.stance = stance; motor.update(1 / 60, m ? x / m : 0, m ? y / m : 0, m);
        visual.place(motor.position, motor.yaw); MV.animator.update(1 / 60, motor); MV.posture.update(1 / 60, motor, MV.animator); visual.root.updateMatrixWorld(true);
        // joint rotations relative to the character's root, so turning the whole body isn't a "pop"
        const rootInv = visual.root.getWorldQuaternion(new THREE.Quaternion()).invert();
        for (const nm of names) {
          const q = rootInv.clone().multiply(B[nm].getWorldQuaternion(new THREE.Quaternion()));
          if (prev[nm] && f > 30) {
            const a = angJump(q, prev[nm]), leg = nm.endsWith('Leg');
            const spike = leg ? (a > 12 && a > 2 * (last[nm] || 0)) : a > 9; last[nm] = a;
            if (spike) { if (stance === 'crouch') { crouchHits++; if (a > worst) { worst = a; where = nm + ' at ' + motor.speed.toFixed(2) + ' m/s, turning ' + motor.angularVelocity.toFixed(1) + ' rad/s'; } } else standHits++; }
          }
          prev[nm] = q;
        }
      }
      return { crouchHits, standHits, worst, where };
    });
    return { pass: r.crouchHits === 0, detail: `crouched pops ${r.crouchHits}${r.worst ? ' (worst ' + r.worst.toFixed(1) + '°, ' + r.where + ')' : ''}; standing fast-reversal frames ${r.standHits} (known, not failed)` };
  },

  // footstep noise events: one per foot landing (alternating feet, matching the
  // gait cycle), the right level per gait, none while standing still
  async footsteps() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, animator, noise } = MV, fs = MV.footsteps, evs = [], out = [];
      noise.on(e => evs.push(e));
      const go = (m, st, x, z) => { step(m, st, x, z); fs.update(1 / 60); noise.update(1 / 60); };
      for (const [name, m, st, level] of [['sneak', 0.3, 'stand', 1], ['stealth walk', 0.78, 'stand', 2], ['jog', 1, 'stand', 3], ['slow crouch', 0.3, 'crouch', 1], ['fast crouch', 1, 'crouch', 2]]) {
        motor.teleport(-6, -20, 0); for (let f = 0; f < 120; f++) go(m, st);
        evs.length = 0; let cyc = 0, ph = animator.phase;
        for (let f = 0; f < 240; f++) { go(m, st); let d = animator.phase - ph; if (d < 0) d += 1; cyc += d; ph = animator.phase; }
        const sides = evs.map(e => e.position.x > -6 ? 'a' : 'b'), alt = sides.every((c, i) => !i || c !== sides[i - 1]);
        out.push({ name, n: evs.length, expect: cyc * 2, alt, levelOk: evs.every(e => e.level === level), level });
      }
      const still = [];
      for (const st of ['stand', 'crouch']) { motor.teleport(-6, -20, 0); for (let f = 0; f < 200; f++) go(0, st); evs.length = 0; for (let f = 0; f < 480; f++) go(0, st); still.push(evs.length); }
      return { out, still };
    });
    const ok = r.out.every(o => o.alt && o.levelOk && Math.abs(o.n - o.expect) <= 1.2) && r.still.every(n => n === 0);
    return { pass: ok, detail: r.out.map(o => `${o.name} ${o.n}/${o.expect.toFixed(1)} L${o.level}${o.alt ? '' : ' NOT alternating'}${o.levelOk ? '' : ' WRONG LEVEL'}`).join(', ') + `; still: ${r.still.join('/')} steps` };
  },

  // surface strips: the map reports the right surface, footsteps on each strip
  // carry it, the gait level and movement speed don't change, and the reach is
  // grass < concrete < metal at every gait
  async surfaces() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, world } = MV, fs = MV.footsteps, evs = [];
      noise.on(e => evs.push(e));
      const mapOk = world.surfaceAt(-3.3, 6.5) === 'concrete' && world.surfaceAt(0, 6.5) === 'metal' && world.surfaceAt(3.3, 6.5) === 'grass' && world.surfaceAt(0, 0) === 'concrete';
      const go = (m, st) => { step(m, st); fs.update(1 / 60); noise.update(1 / 60); };
      const rows = [];
      for (const [gait, m, st, level] of [['sneak', 0.3, 'stand', 1], ['stealth walk', 0.78, 'stand', 2], ['jog', 1, 'stand', 3], ['slow crouch', 0.3, 'crouch', 1], ['fast crouch', 1, 'crouch', 2]]) {
        const row = { gait, level };
        for (const [x, surf] of [[-3.3, 'concrete'], [0, 'metal'], [3.3, 'grass']]) {
          motor.teleport(x, 0.5, 0); for (let f = 0; f < 400 && motor.position.z < 4.6; f++) go(m, st);
          evs.length = 0; let top = 0;
          for (let f = 0; f < 400 && motor.position.z < 8.4; f++) { go(m, st); top = Math.max(top, motor.speed); }
          const on = evs.filter(e => e.position.z > 4.05 && e.position.z < 8.95);
          row[surf] = { n: on.length, surfOk: on.length > 0 && on.every(e => e.surface === surf), levelOk: on.every(e => e.level === level), reach: on.length ? on[0].radius : 0, speed: top };
        }
        rows.push(row);
      }
      return { mapOk, rows };
    });
    let ok = r.mapOk;
    const detail = r.rows.map(row => {
      const c = row.concrete, m = row.metal, g = row.grass;
      const good = [c, m, g].every(x => x.surfOk && x.levelOk) && g.reach < c.reach && c.reach < m.reach && Math.abs(m.speed - c.speed) < 0.02 && Math.abs(g.speed - c.speed) < 0.02;
      ok = ok && good;
      return `${row.gait} L${row.level} reach ${g.reach.toFixed(1)}/${c.reach.toFixed(1)}/${m.reach.toFixed(1)} m${good ? '' : ' WRONG'}`;
    }).join(', ');
    return { pass: ok, detail: (r.mapOk ? '' : 'surface map WRONG; ') + 'grass/concrete/metal: ' + detail };
  },

  // footstep sounds: each surface event plays that surface's own voice, and the
  // voices (rendered offline at a stealth-walk step) differ the way they should:
  // metal loudest with a ringing tail, grass quietest and brightest, concrete dry
  async footstepAudio() {
    const page = await simPage();
    const r = await page.evaluate(async () => {
      const fa = MV.footAudio, out = {};
      for (const surf of ['concrete', 'metal', 'grass']) {
        const ev = MV.noise.emit(2, 'footstep', new THREE.Vector3(0, 0, 0), surf, 'player');
        const played = fa.last && fa.last.surface === surf && fa.last.voice === fa.cfg.surfaces[surf].voice;
        const SR = 44100, ctx = new OfflineAudioContext(1, SR * 0.9, SR);
        let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        SC.mv.FOOTSTEP_VOICES[fa.cfg.surfaces[surf].voice](ctx, ctx.destination, 0.01, fa.gainFor(ev), rnd);
        const d = (await ctx.startRendering()).getChannelData(0);
        let e = 0, tail = 0, zc = 0;
        for (let i = 1; i < d.length; i++) { e += d[i] * d[i]; if (i > SR * 0.13) tail += d[i] * d[i]; if ((d[i] > 0) !== (d[i - 1] > 0)) zc++; }
        out[surf] = { played, rms: Math.sqrt(e / (SR * 0.3)), tail: tail / e, bright: zc / 0.9 / 2 };
      }
      return out;
    });
    const c = r.concrete, m = r.metal, g = r.grass;
    const ok = c.played && m.played && g.played && m.rms > c.rms * 1.2 && c.rms > g.rms * 1.2 && m.tail > 0.02 && c.tail < 0.01 && g.bright > c.bright * 3;
    const f = x => `rms ${x.rms.toFixed(3)}, tail ${(x.tail * 100).toFixed(1)}%, ~${Math.round(x.bright)} Hz`;
    return { pass: ok, detail: `concrete ${f(c)}; metal ${f(m)}; grass ${f(g)}` + (c.played && m.played && g.played ? '' : '; WRONG voice played') };
  },

  // ---- guard vision. The test guard stands at (2, -16) facing +Z (Regular, 16 m).
  // place(x, z, stance) poses the player there, standing still, and returns one look

  // the three nested zones: 30° / 70° / 110° total, faster nearer the centre, adjustable
  async visionZones() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const g = MV.guard, v = g.vision, T = MV.seeTarget, D = Math.PI / 180;
      const place = (deg, d, st) => { MV.motor.teleport(2 + d * Math.sin(-deg * D), -16 + d * Math.cos(-deg * D), Math.PI); for (let f = 0; f < 150; f++) step(0, st || 'stand'); g.update(1 / 60); return Object.assign({}, v.look(T)); };
      const at = [0, 8, 13, 17, 25, 33, 37, 45, 53, 57, 70, -13, -25, -45].map(deg => [deg, place(deg, 6)]);
      const zones = v.cfg.zones;
      const saved = zones[0].angle; zones[0].angle = 60; const widened = place(25, 6).zone; zones[0].angle = saved;
      const savedRate = zones[1].rate; zones[1].rate = savedRate * 2; const fastRate = place(25, 6).rate; zones[1].rate = savedRate; const baseRate = place(25, 6).rate;
      return { at: at.map(([deg, s]) => [deg, s.zone, s.rate, s.off]), widened, rateScales: fastRate / baseRate };
    });
    // the zone must match the angle the guard measured (eye to chest) exactly, and that
    // angle must be where she was placed, give or take the eye/chest offsets
    const want = off => off <= 15 ? 'fastest' : off <= 35 ? 'normal' : off <= 55 ? 'slower' : null;
    const zonesOk = r.at.every(([deg, z, , off]) => z === want(off) && Math.abs(off - Math.abs(deg)) < 2.5) && r.at.some(a => a[1] === 'fastest') && r.at.some(a => a[1] === 'normal') && r.at.some(a => a[1] === 'slower') && r.at.some(a => !a[1]);
    const rate = z => r.at.find(a => a[1] === z)[2];
    const orderOk = rate('fastest') > rate('normal') && rate('normal') > rate('slower') && rate('slower') > 0 && r.at.filter(a => !a[1]).every(a => a[2] === 0);
    const adjOk = r.widened === 'fastest' && Math.abs(r.rateScales - 2) < 0.01;
    return { pass: zonesOk && orderOk && adjOk, detail: r.at.map(([deg, z, rt, off]) => `${deg}° (${off.toFixed(1)}°) ${z || 'none'} ${rt.toFixed(2)}/s`).join(', ') + `; widen fastest to 60° → 25° is ${r.widened}; doubling a zone rate ×${r.rateScales.toFixed(2)}` };
  },

  // what changes the fill rate: distance (and the range limit), stance, movement, very close range
  async visionFactors() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const g = MV.guard, v = g.vision, T = MV.seeTarget, m = MV.motor, D = Math.PI / 180;
      const place = (d, st, deg) => { deg = deg == null ? -10 : deg; m.teleport(2 + d * Math.sin(-deg * D), -16 + d * Math.cos(-deg * D), Math.PI); for (let f = 0; f < 150; f++) step(0, st || 'stand'); g.update(1 / 60); };
      const look = () => Object.assign({}, v.look(T));
      const dist = [3, 8, 13, 17].map(d => { place(d); return look(); });
      place(6, 'stand'); const stand = look(); place(6, 'crouch'); const crouch = look();
      place(6, 'stand'); const still = look();
      const sp = m.speed; m.speed = 1.95; const walking = look(); m.speed = 3.2; const jogging = look(); m.speed = sp;
      // very close and unobstructed: recognised almost at once
      place(1.8, 'stand', 0); v.meter = 0; v.acc = Infinity; let t = 0; while (v.meter < 1 && t < 3) { g.update(1 / 60, T); t += 1 / 60; }
      return { dist: dist.map(s => [s.rate, s.why]), stand: stand.rate, crouch: crouch.rate, still: still.rate, walking: walking.rate, jogging: jogging.rate, closeTime: t };
    });
    const d = r.dist;
    const distOk = d[0][0] > d[1][0] && d[1][0] > d[2][0] && d[2][0] > 0 && d[3][0] === 0 && d[3][1] === 'range';
    const ok = distOk && r.crouch < r.stand && r.crouch > 0 && r.walking > r.still && r.jogging > r.walking && r.closeTime < 0.4;
    return { pass: ok, detail: `3/8/13 m ${d[0][0].toFixed(2)}/${d[1][0].toFixed(2)}/${d[2][0].toFixed(2)}/s, 17 m ${d[3][1]}; stand ${r.stand.toFixed(2)} crouch ${r.crouch.toFixed(2)}; still ${r.still.toFixed(2)} walk ${r.walking.toFixed(2)} jog ${r.jogging.toFixed(2)}; 1.8 m recognised in ${r.closeTime.toFixed(2)} s` };
  },

  // Simple Cover and walls: a tall crate hides her standing; a low crate hides her
  // only crouched; a solid wall blocks sight entirely (never seen through)
  async visionCover() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const g = MV.guard, v = g.vision, T = MV.seeTarget, m = MV.motor;
      const place = (x, z, st) => { m.teleport(x, z, Math.PI); for (let f = 0; f < 150; f++) step(0, st); g.update(1 / 60); };
      const watch = secs => { v.meter = 0; v.acc = Infinity; for (let f = 0; f < secs * 60; f++) { step(0, m.stance); g.update(1 / 60, T); } return { meter: v.meter, exposure: v.seen.exposure, why: v.seen.why }; };
      const out = {};
      place(-2.4, -7.0, 'stand'); out.tallStand = watch(3);
      place(3.2, -3.8, 'stand'); out.lowStand = watch(3);
      place(3.2, -3.8, 'crouch'); out.lowCrouch = watch(3);
      // a 2.8 m wall (the corridor at x = 16) between them, with long range and the guard turned to face her
      const yaw0 = g.yaw, prof = v.profile; v.profile = 'great';
      place(17, -8, 'stand'); g.yaw = Math.atan2(17 - 2, -8 + 16); g.faceYaw(g.yaw); g.place(); out.wall = watch(3);
      place(15, -8, 'stand'); out.wallFront = watch(3);
      g.yaw = yaw0; g.faceYaw(yaw0); g.place(); v.profile = prof;
      return out;
    });
    const ok = r.tallStand.meter === 0 && r.tallStand.why === 'blocked' && r.lowStand.meter > 0 && r.lowCrouch.meter === 0 && r.lowCrouch.why === 'blocked' && r.wall.meter === 0 && r.wall.exposure === 0 && r.wallFront.meter > 0;
    const f = x => `${Math.round(x.exposure * 100)}% exposed, meter ${Math.round(x.meter * 100)}%`;
    return { pass: ok, detail: `tall crate standing ${f(r.tallStand)}; low crate standing ${f(r.lowStand)}, crouched ${f(r.lowCrouch)}; behind wall ${f(r.wall)}, in front of it ${f(r.wallFront)}` };
  },

  // losing sight: the meter holds briefly, then falls gradually (not at once) to zero
  async visionDecay() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const g = MV.guard, v = g.vision, T = MV.seeTarget, m = MV.motor;
      const run = (secs, st) => { const tr = []; for (let f = 0; f < secs * 60; f++) { step(0, st || 'stand'); g.update(1 / 60, T); tr.push(v.meter); } return tr; };
      m.teleport(2, -10, Math.PI); v.meter = 0; v.acc = Infinity;
      let t = 0; while (v.meter < 0.6 && t < 10) { step(0, 'stand'); g.update(1 / 60, T); t += 1 / 60; }
      const peak = v.meter;
      m.teleport(-2.4, -7.0, Math.PI);   // behind the tall crate
      const tr = run(5);
      let rises = 0; for (let i = 1; i < tr.length; i++) if (tr[i] > tr[i - 1] + 1e-9) rises++;
      return { peak, at05: tr[29], at2: tr[119], at5: tr[tr.length - 1], rises, hold: v.cfg.holdTime, rate: v.cfg.decayRate };
    });
    const ok = r.at05 >= r.peak - 0.02 && r.at2 < r.at05 - 0.1 && r.at2 > 0.05 && r.at5 === 0 && r.rises === 0;
    return { pass: ok, detail: `meter ${Math.round(r.peak * 100)}% → after 0.5 s ${Math.round(r.at05 * 100)}%, 2 s ${Math.round(r.at2 * 100)}%, 5 s ${Math.round(r.at5 * 100)}% (hold ${r.hold} s, then −${r.rate}/s)` };
  },

  // ---- guard hearing (the same guard, Regular hearing). Synthetic events use the
  // noise system's own emit, so their reach is exactly what footsteps would carry.

  // heard inside the event's own reach × sensitivity, ignored outside; the reach
  // (surface included) is taken from the event, not recomputed
  async hearingRange() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const g = MV.guard, h = g.hearing, n = MV.noise, gp = g.position;
      const at = (d, level, surface) => { n.emit(level, 'footstep', new THREE.Vector3(gp.x + d, 0, gp.z), surface, 'player'); return Object.assign({}, h.last); };
      const out = {
        c55: at(5.5, 2, 'concrete'), c65: at(6.5, 2, 'concrete'),
        m9: at(9, 2, 'metal'), c9: at(9, 2, 'concrete'), g5: at(5, 2, 'grass'), g3: at(3, 2, 'grass'),
      };
      h.profile = 'keen'; out.keen7 = at(7, 2, 'concrete'); h.profile = 'poor'; out.poor5 = at(5, 2, 'concrete'); h.profile = 'regular';
      out.ownGuardIgnored = (() => { const before = h.heardCount; n.emit(3, 'footstep', new THREE.Vector3(gp.x + 1, 0, gp.z), 'concrete', 'guard'); return h.heardCount === before; })();
      return out;
    });
    const ok = r.c55.heard && !r.c65.heard && r.m9.heard && !r.c9.heard && !r.g5.heard && r.g3.heard && r.keen7.heard && !r.poor5.heard && r.ownGuardIgnored
      && Math.abs(r.c55.reach - 6) < 1e-6 && Math.abs(r.m9.reach - 11.5) < 0.05 && Math.abs(r.g5.reach - 3.6125) < 0.01;
    const f = (k, x) => `${k} ${x.heard ? 'heard' : 'ignored'} (${x.distance.toFixed(1)}/${x.reach.toFixed(1)} m)`;
    return { pass: ok, detail: [f('concrete L2 at 5.5', r.c55), f('6.5', r.c65), f('metal L2 at 9', r.m9), f('concrete L2 at 9', r.c9), f('grass L2 at 5', r.g5), f('3', r.g3), f('keen concrete at 7', r.keen7), f('poor concrete at 5', r.poor5)].join(', ') + (r.ownGuardIgnored ? '' : ', OWN SOUND HEARD') };
  },

  // real footsteps on each strip: heard just inside their reach, ignored just outside;
  // metal carries farther than concrete, concrete farther than grass; sneaking is
  // quieter than jogging; standing still makes no sound for him to hear
  async hearingSurfaces() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, h = g.hearing, fs = MV.footsteps, evs = [];
      noise.on(e => evs.push(e));
      const go = (m, st) => { step(m, st); fs.update(1 / 60); noise.update(1 / 60); };
      const post = g.position.clone(), out = {};
      let edgesOk = true;
      for (const [x, surf] of [[-3.3, 'concrete'], [0, 'metal'], [3.3, 'grass']]) for (const [gait, m] of [['sneak', 0.3], ['stealth walk', 0.78], ['jog', 1]]) {
        motor.teleport(x, 0.5, 0); for (let f = 0; f < 400 && motor.position.z < 4.6; f++) go(m, 'stand');
        evs.length = 0; for (let f = 0; f < 400 && motor.position.z < 8.4; f++) go(m, 'stand');
        const ev = evs.filter(e => e.surface === surf)[0];
        // stand the guard just inside, then just outside, this step's reach
        const reach = ev.radius * h.sensitivity();
        g.position.set(ev.position.x + reach - 0.3, 0, ev.position.z); const inside = h.evaluate(ev).heard;
        g.position.set(ev.position.x + reach + 0.3, 0, ev.position.z); const outside = h.evaluate(ev).heard;
        edgesOk = edgesOk && inside && !outside;
        out[surf + ' ' + gait] = reach;
      }
      g.position.copy(post); g.place();
      // standing still on each strip for 5 s: no footsteps, nothing heard
      const before = h.heardCount; let idleSteps = 0;
      for (const x of [-3.3, 0, 3.3]) { motor.teleport(x, 6.5, Math.PI); for (let f = 0; f < 120; f++) go(0, 'stand'); evs.length = 0; for (let f = 0; f < 300; f++) { go(0, 'stand'); g.update(1 / 60); } idleSteps += evs.length; }
      return { reach: out, edgesOk, idleSteps, idleHeard: h.heardCount - before };
    });
    const R = r.reach, gaits = ['sneak', 'stealth walk', 'jog'];
    const surfOk = gaits.every(gt => R['metal ' + gt] > R['concrete ' + gt] && R['concrete ' + gt] > R['grass ' + gt]);
    const gaitOk = ['concrete', 'metal', 'grass'].every(sf => R[sf + ' sneak'] < R[sf + ' stealth walk'] && R[sf + ' stealth walk'] < R[sf + ' jog']);
    const ok = surfOk && gaitOk && r.edgesOk && r.idleSteps === 0 && r.idleHeard === 0;
    return { pass: ok, detail: gaits.map(gt => `${gt} grass/concrete/metal ${R['grass ' + gt].toFixed(1)}/${R['concrete ' + gt].toFixed(1)}/${R['metal ' + gt].toFixed(1)} m`).join(', ') + `; heard inside / ignored outside each: ${r.edgesOk}; idle: ${r.idleSteps} steps, ${r.idleHeard} heard` };
  },

  // he turns (not snaps) toward where the sound was made, after a short beat, and keeps
  // looking there while suspicious: the old 3-second look timer must not send him back
  // (Step 5 fix); only once his suspicion fades does he face his post again. He faces
  // the sound's origin, not the player; his vision cone turns with him; hearing alone
  // never fills the vision meter
  async hearingTurn() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, h = g.hearing, v = g.vision, T = MV.seeTarget, dt = 1 / 60;
      const wrapD = a => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) * 57.3;
      // the player stands far off to his left, silent, out of his view
      motor.teleport(-12, -18, 0); for (let f = 0; f < 120; f++) step(0, 'stand');
      const soundAt = new THREE.Vector3(g.position.x + 5, 0, g.position.z);   // 90° to his right
      const bearing = Math.atan2(soundAt.x - g.position.x, soundAt.z - g.position.z);
      noise.emit(3, 'footstep', soundAt, 'concrete', 'player');
      const yaw0 = g.yaw; let maxStep = 0, prev = g.yaw, t = 0, startT = null, faceT = null, meterMax = 0;
      for (let f = 0; f < 180; f++) { step(0, 'stand'); g.update(dt, T); t += dt; const d = wrapD(g.yaw - prev); maxStep = Math.max(maxStep, d); prev = g.yaw; if (startT == null && wrapD(g.yaw - yaw0) > 0.5) startT = t; if (faceT == null && wrapD(g.yaw - bearing) < 3) faceT = t; meterMax = Math.max(meterMax, v.meter); }
      const facingSound = wrapD(g.yaw - bearing), facingPlayer = wrapD(g.yaw - Math.atan2(motor.position.x - g.position.x, motor.position.z - g.position.z));
      // the cone turned with him: the player at the sound's spot is now in his fastest zone
      motor.teleport(soundAt.x + 1.5, soundAt.z, Math.PI); for (let f = 0; f < 120; f++) step(0, 'stand');
      const seenAfterTurn = Object.assign({}, v.look(T));
      motor.teleport(-12, -18, 0); for (let f = 0; f < 60; f++) step(0, 'stand');
      // he stays turned to the sound (no 3-second snap back); only when suspicion has
      // faded does he return to his post facing
      const a = g.awareness; let back = null, earlyBack = false;
      for (let f = 0; f < 30 * 60 && back == null; f++) { step(0, 'stand'); g.update(dt, T); const tt = 3 + f * dt; if (wrapD(g.yaw - g.postYaw) < 3) { if (a.state === 'NORMAL') back = tt; if (tt < 3.35 + 0.5) earlyBack = true; } }
      return { startT, faceT, maxStep, facingSound, facingPlayer, meterMax, zoneAfter: seenAfterTurn.zone, rateAfter: seenAfterTurn.rate, back, earlyBack, react: a.cfg.reactDelay, maxRate: g.cfg.turn.maxRate };
    });
    const perFrame = r.maxRate / 60 * 57.3 + 0.05;
    const ok = r.startT >= r.react - 0.02 && r.startT < r.react + 0.2 && r.faceT != null && r.faceT < 2.5 && r.maxStep <= perFrame && r.facingSound < 3 && r.facingPlayer > 30
      && r.meterMax === 0 && r.zoneAfter === 'fastest' && r.rateAfter > 0 && r.back != null && !r.earlyBack;
    return { pass: ok, detail: `starts turning after ${r.startT.toFixed(2)} s, faces the sound in ${r.faceT == null ? 'never' : r.faceT.toFixed(2) + ' s'}, max ${r.maxStep.toFixed(2)}°/frame (limit ${perFrame.toFixed(2)}); facing sound ±${r.facingSound.toFixed(1)}°, player ${r.facingPlayer.toFixed(0)}° away; meter while only heard ${r.meterMax}; after the turn the player there is in ${r.zoneAfter} (${r.rateAfter.toFixed(2)}/s); ${r.earlyBack ? 'RETURNED EARLY (old 3 s timer); ' : 'still turned to the sound after the old 3 s timer; '}back to his post facing once calm ${r.back == null ? 'never' : 'after ' + r.back.toFixed(1) + ' s'}` };
  },

  // a run of real footsteps circling behind him: redirects are spaced out, the turn
  // stays smooth (no rapid reversals), and his limbs never pop
  async hearingJitter() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, h = g.hearing, fs = MV.footsteps, T = MV.seeTarget, dt = 1 / 60, B = g.bones;
      const names = ['spine1', 'chest', 'neck', 'head', 'leftArm', 'rightArm', 'leftForeArm', 'rightForeArm', 'leftUpLeg', 'rightUpLeg', 'leftLeg', 'rightLeg'];
      const prevQ = {}, lastA = {}; let pops = 0, worst = 0, redirects = 0, maxDav = 0, flips = 0, prevAv = 0, lastFlip = -9;
      const aw = g.awareness; let lr = aw.lastRedirect;
      motor.teleport(g.position.x - 4, g.position.z - 3, 0); for (let f = 0; f < 60; f++) step(0, 'stand');
      for (let f = 0; f < 600; f++) {
        // jog on a 4 m circle around a point behind him
        const a = f * dt * 1.1, x = Math.cos(a), z = -Math.sin(a);
        step(1, 'stand', x, z); fs.update(dt); noise.update(dt); g.update(dt, T);
        if (aw.lastRedirect !== lr) { redirects++; lr = aw.lastRedirect; }
        const av = g.body.angularVelocity; maxDav = Math.max(maxDav, Math.abs(av - prevAv));
        if (Math.sign(av) !== Math.sign(prevAv) && Math.abs(av) > 0.3 && Math.abs(prevAv) > 0.3) { if (f * dt - lastFlip < 0.5) flips++; lastFlip = f * dt; }
        prevAv = av;
        const ri = g.root.getWorldQuaternion(new THREE.Quaternion()).invert();
        for (const nm of names) { const q = ri.clone().multiply(B[nm].getWorldQuaternion(new THREE.Quaternion())); if (prevQ[nm] && f > 30) { const ang = 2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ[nm])))) * 57.3, leg = nm.endsWith('Leg'); const spike = leg ? (ang > 12 && ang > 2 * (lastA[nm] || 0)) : ang > 9; lastA[nm] = ang; if (spike) { pops++; worst = Math.max(worst, ang); } } prevQ[nm] = q; }
      }
      return { heard: h.heardCount, redirects, maxDav, flips, pops, worst, gap: aw.cfg.retargetGap };
    });
    const maxRedirects = Math.floor(10 / r.gap) + 1;
    const ok = r.heard > 5 && r.redirects <= maxRedirects && r.maxDav < 0.75 && r.flips === 0 && r.pops === 0;
    return { pass: ok, detail: `${r.heard} footsteps heard in 10 s, ${r.redirects} look redirects (max ${maxRedirects}), largest turn-rate change ${r.maxDav.toFixed(2)} rad/s per frame, rapid reversals ${r.flips}, guard joint pops ${r.pops}${r.worst ? ' (worst ' + r.worst.toFixed(1) + '°)' : ''}` };
  },

  // ---- guard awareness (Step 5). In every scenario the player stands silent and out
  // of his view unless the scenario says otherwise; sounds come through the noise system.
  // sim(n) runs n frames of the whole loop: player (still), footsteps, noise, guard.

  // 1–3: a single minor sound makes him suspicious but not investigate, and fades;
  // a faint one barely registers; repeated sounds near one spot build suspicion
  // step by step (without resetting his animation) until he investigates
  async aiSuspicion() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60, B = g.bones, out = {};
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); } };
      const emit = (lv, x, z, surf) => noise.emit(lv, 'footstep', new THREE.Vector3(g.position.x + x, 0, g.position.z + z), surf || 'concrete', 'player');
      motor.teleport(-14, -20, 0); sim(60);
      // a faint grass sneak step 0.8 m away: noted, barely suspicious
      emit(1, 0.6, -0.5, 'grass'); sim(2); out.faint = { susp: a.suspicion, state: a.state };
      g.reset(); sim(30);
      // one sneaking step on concrete 2 m behind him
      emit(1, 1.4, -1.4); let maxS = 0, investigated = false, back = null;
      for (let f = 0; f < 40 * 60; f++) { sim(1); maxS = Math.max(maxS, a.suspicion); if (a.state === 'INVESTIGATING') investigated = true; if (back == null && f > 60 && a.state === 'NORMAL' && Math.abs(Math.atan2(Math.sin(g.yaw - g.postYaw), Math.cos(g.yaw - g.postYaw))) < 0.05) back = f * dt; }
      out.minor = { maxS, investigated, back, endState: a.state, endS: a.suspicion };
      // repeated stealth-walk steps around one spot 5 m behind him, every 0.5 s
      g.reset(); sim(30);
      const steps = [], prevQ = {}, lastA = {}; let pops = 0, flips = 0, prevAv = 0, lastFlip = -9, t = 0;
      for (let k = 0; k < 10; k++) {
        emit(2, -1.5 + (k % 2) * 0.6, -4.8 + k * 0.15); steps.push({ susp: a.suspicion, state: a.state });
        for (let f = 0; f < 30; f++) {
          sim(1); t += dt; const av = g.motor.angularVelocity;
          if (Math.sign(av) !== Math.sign(prevAv) && Math.abs(av) > 0.3 && Math.abs(prevAv) > 0.3) { if (t - lastFlip < 0.5) flips++; lastFlip = t; } prevAv = av;
          const ri = g.root.getWorldQuaternion(new THREE.Quaternion()).invert();
          for (const nm of ['spine1', 'chest', 'head', 'leftArm', 'rightArm', 'leftUpLeg', 'rightUpLeg', 'leftLeg', 'rightLeg']) { const q = ri.clone().multiply(B[nm].getWorldQuaternion(new THREE.Quaternion())); if (prevQ[nm]) { const ang = 2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ[nm])))) * 57.3, leg = nm.endsWith('Leg'); if (leg ? (ang > 12 && ang > 2 * (lastA[nm] || 0)) : ang > 9) pops++; lastA[nm] = ang; } prevQ[nm] = q; }
        }
      }
      out.repeat = { steps, pops, flips, redirects: a.redirects, state: a.state };
      return out;
    });
    const c = { suspiciousAt: 0.08, investigateAt: 0.6 };
    const s = r.repeat.steps.map(x => x.susp);
    const builds = s.slice(1, 4).every((v, i) => v > s[i]);   // the first few repeats each add more
    const reached = r.repeat.state === 'INVESTIGATING' || r.repeat.steps.some(x => x.state === 'INVESTIGATING');
    const ok = r.faint.susp < c.suspiciousAt && r.faint.state === 'NORMAL'
      && r.minor.maxS >= c.suspiciousAt && r.minor.maxS < c.investigateAt && !r.minor.investigated && r.minor.back != null && r.minor.endState === 'NORMAL'
      && builds && reached && r.repeat.pops === 0 && r.repeat.flips === 0;
    return { pass: ok, detail: `faint grass step ${Math.round(r.faint.susp * 100)}% ${r.faint.state}; one sneak step: peak ${Math.round(r.minor.maxS * 100)}% (suspicious, no investigation: ${!r.minor.investigated}), calm and facing post again after ${r.minor.back == null ? 'never' : r.minor.back.toFixed(1) + ' s'}; repeated steps: ${s.slice(0, 5).map(v => Math.round(v * 100) + '%').join(' → ')}… ${reached ? 'INVESTIGATING' : 'never investigated'}, ${r.repeat.redirects} redirects, joint pops ${r.repeat.pops}, rapid turn reversals ${r.repeat.flips}` };
  },

  // 4, 5, 7, 8, 14: a significant sound sends him to its origin, even while the player
  // moves elsewhere unseen; he stops short of it and searches; then he walks back to
  // his post and is NORMAL again: the whole episode ends (no endless loop)
  async aiInvestigate() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); } };
      motor.teleport(-14, -20, 0); sim(60);
      const S = new THREE.Vector3(g.position.x + 5, 0, g.position.z - 3);
      noise.emit(3, 'footstep', S, 'concrete', 'player'); sim(30); noise.emit(3, 'footstep', S, 'concrete', 'player');
      const states = [], goals = []; let minToS = Infinity, stopAt = null, searchYaw = [], searchMaxSpeed = 0, end = null, moved = false;
      for (let f = 0; f < 70 * 60 && end == null; f++) {
        if (f === 90) { motor.teleport(-14, -8, 0); }          // she slips away, silently, out of his sight
        sim(1);
        const k = a.state + ':' + a.behavior; if (states[states.length - 1] !== k) states.push(k);
        if (g.moving && g.goal && a.behavior === 'approach') goals.push(Math.hypot(g.goal.x - S.x, g.goal.z - S.z));
        if (g.motor.speed > 0.3) moved = true;
        // once he has come to rest at the spot: where he stopped, then the look-around (standing still)
        if (a.behavior === 'search' && (stopAt != null || g.isStill())) { if (stopAt == null) stopAt = Math.hypot(g.position.x - S.x, g.position.z - S.z); searchYaw.push(g.yaw); searchMaxSpeed = Math.max(searchMaxSpeed, Math.abs(g.motor.speed)); }
        if (a.behavior === 'approach') minToS = Math.min(minToS, Math.hypot(g.position.x - S.x, g.position.z - S.z));
        if (moved && a.state === 'NORMAL' && g.atPost() && g.isStill()) end = f * dt;
      }
      // the full sweep of directions he looked in while searching (relative to his first)
      const rel = searchYaw.map(y => Math.atan2(Math.sin(y - searchYaw[0]), Math.cos(y - searchYaw[0])) * 57.3);
      const span = rel.length ? Math.max(...rel) - Math.min(...rel) : 0;
      return { states, goalOff: goals.length ? Math.max(...goals) : 9, stopAt, searchSpan: span, searchMaxSpeed, end, postDist: Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z), confirmed: a.confirmed, seen: !!a.seen };
    });
    const seq = r.states.join(' → ');
    const order = ['INVESTIGATING:approach', 'INVESTIGATING:search', 'INVESTIGATING:return', 'NORMAL:idle'].every(k => r.states.includes(k))
      && r.states.indexOf('INVESTIGATING:approach') < r.states.indexOf('INVESTIGATING:search') && r.states.indexOf('INVESTIGATING:search') < r.states.indexOf('INVESTIGATING:return');
    const ok = order && r.goalOff < 0.01 && r.stopAt != null && r.stopAt < 1.8 && r.stopAt > 0.3 && r.searchSpan > 60 && r.searchMaxSpeed < 0.05 && r.end != null && r.end < 60 && r.postDist < 0.6 && !r.confirmed && !r.seen;
    return { pass: ok, detail: `${seq}; his target stayed the sound's origin (max ${r.goalOff.toFixed(2)} m off) while she moved unseen; stopped ${r.stopAt == null ? '?' : r.stopAt.toFixed(2)} m from it, searched ${r.searchSpan.toFixed(0)}° standing still; back at post and NORMAL after ${r.end == null ? 'never' : r.end.toFixed(1) + ' s'}` };
  },

  // 6, 14: he walks around a crate to reach a spot behind it (never through it); a
  // spot he can't reach (outside the perimeter wall) makes him stop safely, search
  // from where he is, and settle back instead of walking into the wall forever
  async aiNavigation() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, world } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60, R = g.cfg.radius;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); } };
      const intrusion = () => { let worst = 0; for (const b of world.boxes) { const dx = Math.max(b.minX - g.position.x, 0, g.position.x - b.maxX), dz = Math.max(b.minZ - g.position.z, 0, g.position.z - b.maxZ); worst = Math.max(worst, R - Math.hypot(dx, dz)); } for (const c of world.cylinders) if (!c.noSight) worst = Math.max(worst, c.r + R - Math.hypot(g.position.x - c.x, g.position.z - c.z)); return worst; };
      const out = {};
      // behind the tall crate at (-2, -8), straight line from his post blocked
      motor.teleport(-14, -21, 0); sim(60);
      const S = new THREE.Vector3(-2, 0, -6);
      noise.emit(3, 'footstep', S, 'concrete', 'player'); sim(30); noise.emit(3, 'footstep', S, 'concrete', 'player');
      const straightBlocked = !g.nav.clear(g.post, S);
      let worst = 0, walked = 0, prev = g.position.clone(), reached = Infinity, done = null;
      for (let f = 0; f < 70 * 60 && done == null; f++) { sim(1); worst = Math.max(worst, intrusion()); walked += g.position.distanceTo(prev); prev.copy(g.position); if (a.behavior === 'search') reached = Math.min(reached, Math.hypot(g.position.x - S.x, g.position.z - S.z)); if (f > 120 && a.state === 'NORMAL' && g.atPost() && g.isStill()) done = f * dt; }
      out.detour = { straightBlocked, worst, walked, straight: g.post.distanceTo(S), reached, done };
      // outside the perimeter wall (z = -22): unreachable
      g.reset(); sim(30);
      const U = new THREE.Vector3(2, 0, -23.5);
      noise.emit(3, 'footstep', U, 'concrete', 'player'); sim(30); noise.emit(3, 'footstep', U, 'concrete', 'player');
      let maxMove = 0, pushing = 0, end = null, note = '';
      for (let f = 0; f < 60 * 60 && end == null; f++) { sim(1); maxMove = Math.max(maxMove, Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z)); if (g.motor.blocked && Math.abs(g.motor.targetSpeed) > 0) pushing++; if (a.note) note = a.note; if (f > 120 && a.state === 'NORMAL' && g.isStill()) end = f * dt; }
      out.unreachable = { maxMove, pushing, end, note, state: a.state };
      return out;
    });
    const d = r.detour, u = r.unreachable;
    const ok = d.straightBlocked && d.worst < 0.02 && d.reached < 1.8 && d.walked > d.straight && d.done != null
      && u.maxMove < 0.5 && u.pushing === 0 && u.end != null && /unreachable/.test(u.note);
    return { pass: ok, detail: `spot behind the tall crate (straight line blocked: ${d.straightBlocked}): reached ${d.reached.toFixed(2)} m from it by a detour, deepest overlap with any obstacle ${(Math.max(0, d.worst) * 100).toFixed(1)} cm, back at post after ${d.done == null ? 'never' : d.done.toFixed(1) + ' s'}; spot outside the perimeter: "${u.note}", moved ${u.maxMove.toFixed(2)} m, frames pushing into a wall ${u.pushing}, settled after ${u.end == null ? 'never' : u.end.toFixed(1) + ' s'}` };
  },

  // 9: while he walks and turns his vision cone is his actual facing: his body and his
  // direction of travel line up with it, and the zones classify around it
  async aiVisionAlign() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, v = g.vision, dt = 1 / 60, B = g.bones;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); } };
      motor.teleport(-14, -21, 0); sim(60);
      const S = new THREE.Vector3(-2, 0, -6);     // the detour walk: straight runs and turns
      noise.emit(3, 'footstep', S, 'concrete', 'player'); sim(30); noise.emit(3, 'footstep', S, 'concrete', 'player');
      let bodyWorst = 0, travelWorst = 0, n = 0, conesOk = true, checked = 0;
      for (let f = 0; f < 12 * 60; f++) {
        sim(1);
        if (a.behavior !== 'approach' || g.motor.speed < 0.8) continue;
        const fw = g.forward(), l = B.leftUpLeg.getWorldPosition(new THREE.Vector3()), rr = B.rightUpLeg.getWorldPosition(new THREE.Vector3());
        const d = l.sub(rr), face = new THREE.Vector3(-d.z, 0, d.x).normalize(); if (face.dot(fw) < 0) face.negate();
        bodyWorst = Math.max(bodyWorst, Math.acos(Math.min(1, face.dot(fw))) * 57.3);
        if (Math.abs(g.motor.angularVelocity) < 0.3) { const vel = g.motor.velocity, sp = Math.hypot(vel.x, vel.z); if (sp > 0.5) travelWorst = Math.max(travelWorst, Math.acos(Math.min(1, (vel.x * fw.x + vel.z * fw.z) / sp)) * 57.3); }
        n++;
        if (f % 90 === 0) {
          // stand her (briefly, for one look) dead ahead of him, then square to his side
          const save = motor.position.clone(), ahead = g.position.clone().addScaledVector(fw, 6), side = g.position.clone().add(new THREE.Vector3(fw.z, 0, -fw.x).multiplyScalar(6));
          motor.position.copy(ahead); MV.visual.place(motor.position, motor.yaw); MV.visual.root.updateMatrixWorld(true); const z1 = v.zoneAt(v.look(T).off);
          motor.position.copy(side); MV.visual.place(motor.position, motor.yaw); MV.visual.root.updateMatrixWorld(true); const z2 = v.zoneAt(v.look(T).off);
          motor.position.copy(save); MV.visual.place(motor.position, motor.yaw); MV.visual.root.updateMatrixWorld(true); v.look(T);
          conesOk = conesOk && z1 && z1.id === 'fastest' && !z2; checked++;
        }
      }
      return { bodyWorst, travelWorst, n, conesOk, checked };
    });
    const ok = r.n > 60 && r.bodyWorst < 30 && r.travelWorst < 15 && r.conesOk && r.checked >= 2;
    return { pass: ok, detail: `${r.n} walking frames: hips within ${r.bodyWorst.toFixed(0)}° of his vision facing, travel within ${r.travelWorst.toFixed(0)}° when walking straight; ${r.checked} spot checks: dead ahead = fastest zone, square to his side = outside the cone: ${r.conesOk}` };
  },

  // 10–13 (Step 5, updated for Step 6): seeing her to 100% confirms the threat, and it
  // sticks: she goes silent and vanishes out of his view, sounds come from elsewhere,
  // time passes; he never drops back to NORMAL / SUSPICIOUS / INVESTIGATING, his first
  // search goes to the last place he actually saw her, that remembered position never
  // follows her, the sounds are remembered separately, and the confirmation outlasts
  // the vision meter fading
  async aiConfirmed() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, v = g.vision, dt = 1 / 60;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); } };
      motor.teleport(5, -10.8, Math.PI); sim(30);      // standing 30° to his right, 6 m away, in plain view
      let t = 0; while (!a.confirmed && t < 15) { sim(1); t += dt; }
      const confirmT = t, seenAt = a.seen ? a.seen.position.clone() : null;
      motor.teleport(-14, -20, 0); sim(2);              // gone: silent, behind him and out of range
      let lostConfirm = false, fellBack = false, seenMoved = 0, heardCount = g.hearing.heardCount, firstDest = null, states = new Set();
      for (let k = 0; k < 8; k++) {
        noise.emit(3, 'footstep', new THREE.Vector3(g.position.x + 6, 0, g.position.z - 1), 'concrete', 'player');   // sounds off to his right
        for (let f = 0; f < 150; f++) {
          sim(1); states.add(a.state);
          if (!a.confirmed) lostConfirm = true;
          if (['NORMAL', 'SUSPICIOUS', 'INVESTIGATING'].indexOf(a.state) >= 0) fellBack = true;
          if (!firstDest && a.evasion && a.evasion.dest) firstDest = a.evasion.dest.p.clone();
          seenMoved = Math.max(seenMoved, a.seen.position.distanceTo(seenAt));
        }
      }
      return { confirmT, seenAt: seenAt && [seenAt.x, seenAt.z], lostConfirm, fellBack, states: [...states], firstDestOff: firstDest ? firstDest.distanceTo(seenAt) : 99, seenMoved, heardNew: g.hearing.heardCount - heardCount, heardPos: !!a.heard, meterEnd: v.meter };
    });
    const ok = r.confirmT < 15 && r.seenAt && !r.lostConfirm && !r.fellBack && r.states.indexOf('EVASION') >= 0 && r.firstDestOff < 0.01 && r.seenMoved < 1e-6 && r.heardNew >= 8 && r.heardPos && r.meterEnd < 0.05;
    return { pass: ok, detail: `confirmed after ${r.confirmT.toFixed(1)} s in view; then 20 s silent and out of sight with 8 sounds to his right: states ${r.states.join(' / ')} (never back to normal/suspicious/investigating: ${!r.fellBack}, confirmation kept: ${!r.lostConfirm}); first search spot ${r.firstDestOff.toFixed(2)} m from the last place he saw her; last-seen position moved ${r.seenMoved.toFixed(2)} m; ${r.heardNew} sounds heard and remembered separately; vision meter faded to ${Math.round(r.meterEnd * 100)}% but the confirmation stayed` };
  },


  // ---- alert and evasion (Step 6). Shared scene helpers live in the page (see setupAlert).

  // 1–3: full recognition → ALERT; he turns to track her while she walks in view; when
  // she stops he stays ALERT (no search timer, no walk back to his post)
  async alertTrack() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60;
      const sim = (n, m, x, z) => { for (let i = 0; i < n; i++) { step(m || 0, 'stand', x, z); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); } };
      const bearingErr = () => { const b = Math.atan2(motor.position.x - g.position.x, motor.position.z - g.position.z); return Math.abs(Math.atan2(Math.sin(g.yaw - b), Math.cos(g.yaw - b))) * 57.3; };
      motor.teleport(2, -10, Math.PI); let t = 0;
      while (a.state !== 'ALERT' && t < 15) { sim(1); t += dt; }
      const alertT = t, pos0 = g.position.clone();
      // she sneaks sideways across his view (6 m away), 5 m to his right
      let worst = 0, lostView = 0; motor.yaw = Math.PI / 2;
      for (let f = 0; f < 300 && motor.position.x < 7; f++) { sim(1, 0.3, 1, 0); if (f > 60) worst = Math.max(worst, bearingErr()); if (a.state !== 'ALERT') lostView++; }
      // then stands still for 10 s
      let stayed = true, timer = false; for (let f = 0; f < 600; f++) { sim(1); if (a.state !== 'ALERT') stayed = false; if (a.evasion) timer = true; }
      return { alertT, worst, lostView, stayed, timer, finalErr: bearingErr(), moved: g.position.distanceTo(pos0), still: g.isStill() };
    });
    const ok = r.alertT < 15 && r.lostView === 0 && r.worst < 30 && r.stayed && !r.timer && r.finalErr < 8 && r.moved < 0.6 && r.still;
    return { pass: ok, detail: `ALERT after ${r.alertT.toFixed(1)} s; while she walked across his view his facing stayed within ${r.worst.toFixed(0)}° of her (frames not ALERT: ${r.lostView}); standing still 10 s: still ALERT ${r.stayed}, search timer started ${r.timer}, facing her within ${r.finalErr.toFixed(1)}°, moved ${r.moved.toFixed(2)} m` };
  },

  // 4–6: losing sight begins EVASION (only after the grace period, which he spends
  // facing the last sighting, not her); he heads for the last place he truly saw her;
  // while she sneaks off unheard his search never homes in on where she really is
  async evasionStart() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60;
      const sim = (n, m, x, z) => { for (let i = 0; i < n; i++) { step(m || 0, 'stand', x, z); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); } };
      motor.teleport(2, -10, Math.PI); let t = 0; while (a.state !== 'ALERT' && t < 15) { sim(1); t += dt; }
      // she sneaks behind the tall crate
      const walkTo = (x, z) => { for (let i = 0; i < 900; i++) { const dx = x - motor.position.x, dz = z - motor.position.z, d = Math.hypot(dx, dz); if (d < 0.25) return; sim(1, 0.3, dx / d, dz / d); } };
      walkTo(-0.6, -8.0); walkTo(-1.0, -6.2); walkTo(-2.4, -5.6);
      let lostAt = null, evasionAt = null, graceYawErr = 0, t2 = 0;
      for (let f = 0; f < 240 && evasionAt == null; f++) { sim(1); t2 += dt; if (lostAt == null && g.vision.seen.rate === 0) lostAt = t2; if (a.state === 'EVASION') evasionAt = t2; }
      const seenAt = a.seen.position.clone();
      const firstDest = a.evasion && a.evasion.dest ? a.evasion.dest.p.clone() : null;
      // she slips away silently to the far corner; he can't hear or see her there
      motor.teleport(-17, 15, 0);
      let nearest = Infinity, maxFromEvidence = 0, seenMoved = 0, heard0 = g.hearing.heardCount;
      for (let f = 0; f < 15 * 60; f++) { sim(1); if (g.goal && g.moving) { nearest = Math.min(nearest, Math.hypot(g.goal.x - motor.position.x, g.goal.z - motor.position.z)); maxFromEvidence = Math.max(maxFromEvidence, Math.hypot(g.goal.x - seenAt.x, g.goal.z - seenAt.z)); } seenMoved = Math.max(seenMoved, a.seen.position.distanceTo(seenAt)); }
      return { grace: a.cfg.alertGrace, lostAt, evasionAt, firstDestOff: firstDest ? firstDest.distanceTo(seenAt) : 99, nearest, maxFromEvidence, seenMoved, heardNew: g.hearing.heardCount - heard0, reach: a.cfg.hideRadius + a.cfg.predictMax + a.cfg.spotSpacing, stillEvasion: a.state };
    });
    const graceOk = r.lostAt != null && r.evasionAt != null && r.evasionAt - r.lostAt >= r.grace - 0.2;
    const ok = graceOk && r.firstDestOff < 0.01 && r.seenMoved < 1e-6 && r.heardNew === 0 && r.maxFromEvidence <= r.reach && r.nearest > 8;
    return { pass: ok, detail: `out of sight at ${r.lostAt == null ? '?' : r.lostAt.toFixed(2)} s, EVASION at ${r.evasionAt == null ? 'never' : r.evasionAt.toFixed(2)} s (grace ${r.grace} s); first search spot ${r.firstDestOff.toFixed(2)} m from the last place he saw her; then she slipped away unheard (${r.heardNew} sounds): his search stayed within ${r.maxFromEvidence.toFixed(1)} m of his evidence (limit ${r.reach.toFixed(1)}), never nearer than ${r.nearest.toFixed(1)} m to her real position, last-seen moved ${r.seenMoved.toFixed(2)} m` };
  },

  // 7–9: a strong sound redirects the search (even through walls) toward an approximate
  // estimate, not the exact spot; a faint one doesn't; a stream of footsteps can't keep
  // extending the search beyond its cap, and causes no jitter
  async evasionHearing() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60, B = g.bones;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); } };
      motor.teleport(2, -10, Math.PI); let t = 0; while (a.state !== 'ALERT' && t < 15) { sim(1); t += dt; }
      motor.teleport(-17, 15, 0); while (a.state !== 'EVASION') sim(1);
      sim(120);
      // faint: a sneak step 2 m from him (heard, weak): no change of plan
      const destBefore = a.evasion.dest ? a.evasion.dest.p.clone() : g.position.clone(), red0 = a.evasion.redirects;
      noise.emit(1, 'footstep', new THREE.Vector3(g.position.x + 1.4, 0, g.position.z + 1.4), 'concrete', 'player'); sim(10);
      const faintRedirected = a.evasion.redirects !== red0;
      sim(100);
      // strong: metal jog steps inside the corridor behind a 2.8 m wall
      const P = new THREE.Vector3(17, 0, -5);
      const blocked = MV.world.segmentBlocked(g.eye(new THREE.Vector3()), new THREE.Vector3(P.x, 1.2, P.z));
      noise.emit(3, 'footstep', P, 'metal', 'player'); sim(2);
      const h = a.heard, est = h.estimate.clone(), err = est.distanceTo(P), spread = h.uncertainty, reason = a.note;
      const destNow = a.evasion.dest ? a.evasion.dest.p.clone() : null;
      // a strong close sound is pinned down better than a far one
      const near = new THREE.Vector3(g.position.x + 3, 0, g.position.z); noise.emit(3, 'footstep', near, 'concrete', 'player'); const nearSpread = a.heard.uncertainty;
      // a stream of footsteps near P for 14 s: timer capped, no jitter
      const e = a.evasion, prevQ = {}, lastA = {}; let pops = 0, flips = 0, prevAv = 0, lastFlip = -9, tt = 0, maxEnd = 0;
      for (let k = 0; k < 28; k++) {
        noise.emit(3, 'footstep', new THREE.Vector3(17 + (k % 3) * 0.4, 0, -5 + k * 0.1), 'metal', 'player');
        for (let f = 0; f < 30; f++) {
          sim(1); tt += dt; if (a.evasion) maxEnd = Math.max(maxEnd, a.evasion.end - a.evasion.start);
          const av = g.motor.angularVelocity; if (Math.sign(av) !== Math.sign(prevAv) && Math.abs(av) > 0.3 && Math.abs(prevAv) > 0.3) { if (tt - lastFlip < 0.5) flips++; lastFlip = tt; } prevAv = av;
          const ri = g.root.getWorldQuaternion(new THREE.Quaternion()).invert();
          for (const nm of ['spine1', 'chest', 'head', 'leftArm', 'rightArm', 'leftUpLeg', 'rightUpLeg', 'leftLeg', 'rightLeg']) { const q = ri.clone().multiply(B[nm].getWorldQuaternion(new THREE.Quaternion())); if (prevQ[nm]) { const ang = 2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ[nm])))) * 57.3, leg = nm.endsWith('Leg'); if (leg ? (ang > 12 && ang > 2 * (lastA[nm] || 0)) : ang > 9) pops++; lastA[nm] = ang; } prevQ[nm] = q; }
        }
      }
      return { faintRedirected, blocked, err, spread, nearSpread, reason, destToEst: destNow ? destNow.distanceTo(est) : 99, destToP: destNow ? destNow.distanceTo(P) : 99, maxEnd, cap: a.cfg.evasionMax, redirects: e.redirects, gap: a.cfg.redirectGap, pops, flips };
    });
    const ok = !r.faintRedirected && r.blocked && r.err > 0.05 && r.err <= r.spread + 1e-6 && r.nearSpread < r.spread && /metal/.test(r.reason) && r.destToEst < 2.6
      && r.maxEnd <= r.cap + 1e-6 && r.redirects <= Math.ceil(16 / r.gap) && r.pops === 0 && r.flips === 0;
    return { pass: ok, detail: `faint sneak step redirected: ${r.faintRedirected}; metal jog behind a wall (sight blocked: ${r.blocked}) → "${r.reason}", his estimate ${r.err.toFixed(2)} m off the real spot (spread ${r.spread.toFixed(1)} m; a close strong sound: ${r.nearSpread.toFixed(1)} m), new search spot ${r.destToEst.toFixed(1)} m from his estimate; 14 s of footsteps: search length peaked at ${r.maxEnd.toFixed(0)} s (cap ${r.cap}), ${r.redirects} redirects, joint pops ${r.pops}, rapid turn reversals ${r.flips}` };
  },

  // 10, 11, 14: with no further evidence he searches several different places (no
  // pacing between two), never through obstacles, and after 30 s settles naturally into
  // HEIGHTENED SECURITY (Step 7: it opens with a standing look-around); the duration is configurable and the search order varies by seed
  async evasionSearch() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, world } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60, R = g.cfg.radius;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); } };
      const intrusion = () => { let w = 0; for (const b of world.boxes) { const dx = Math.max(b.minX - g.position.x, 0, g.position.x - b.maxX), dz = Math.max(b.minZ - g.position.z, 0, g.position.z - b.maxZ); w = Math.max(w, R - Math.hypot(dx, dz)); } for (const c of world.cylinders) if (!c.noSight) w = Math.max(w, c.r + R - Math.hypot(g.position.x - c.x, g.position.z - c.z)); return w; };
      const run = (seed, evasionTime) => {
        g.reset(); a.cfg.seed = seed; a.cfg.evasionTime = evasionTime; a.reset();
        motor.teleport(-2.4, -10.5, Math.PI); motor.yaw = 0; let t = 0; while (a.state !== 'ALERT' && t < 15) { sim(1); t += dt; }
        // she runs off toward the tall crate (seen moving), then vanishes silently
        for (let f = 0; f < 30; f++) { motor.position.z += 0.05; sim(1); }
        motor.teleport(-17, 15, 0);
        while (a.state !== 'EVASION') sim(1);
        // the whole planned search (the first two spots are fixed: last seen, then her heading)
        const planned = [a.evasion.dest].concat(a.evasion.plan).filter(Boolean).map(s => s.p.x.toFixed(1) + ',' + s.p.z.toFixed(1)).join(' ');
        const t0 = a.clock, dests = [], order = []; let worst = 0, hp = null, settle = null;
        for (let f = 0; f < (evasionTime + 6) * 60; f++) {
          sim(1); worst = Math.max(worst, intrusion());
          const d = a.evasion && a.evasion.dest; if (d && (!dests.length || dests[dests.length - 1].distanceTo(d.p) > 0.01)) { dests.push(d.p.clone()); order.push(d.why); }
          if (hp == null && a.state === 'HEIGHTENED') hp = a.clock - t0;
          // Heightened Security opens with a pause to look around: standing, in idle
          if (hp != null && settle == null && a.clock - t0 >= hp + 1) settle = { still: g.isStill(), idle: g.animator.weights.idle, state: a.state };
        }
        let tooClose = 0; for (let i = 0; i < dests.length; i++) for (let j = i + 1; j < dests.length; j++) if (dests[i].distanceTo(dests[j]) < a.cfg.spotSpacing - 0.01) tooClose++;
        return { spots: dests.length, tooClose, worst, hp, still: settle ? settle.still : false, idle: settle ? settle.idle : 0, state: settle ? settle.state : a.state, order: planned };
      };
      const A = run(1337, 30), B = run(4242, 30), C = run(1337, 10);
      return { A, B, C };
    });
    const A = r.A;
    const ok = A.spots >= 3 && A.tooClose === 0 && A.worst < 0.02 && A.hp != null && Math.abs(A.hp - 30) < 0.5 && A.still && A.idle > 0.9 && A.state === 'HEIGHTENED'
      && r.C.hp != null && Math.abs(r.C.hp - 10) < 0.5 && r.B.order !== A.order;
    return { pass: ok, detail: `30 s search: ${A.spots} different spots (pairs closer than the spacing: ${A.tooClose}), deepest obstacle overlap ${(Math.max(0, A.worst) * 100).toFixed(1)} cm, HEIGHTENED SECURITY after ${A.hp == null ? 'never' : A.hp.toFixed(1) + ' s'}, 1 s later standing still ${A.still} with idle weight ${A.idle.toFixed(2)}; a 10 s setting ended at ${r.C.hp == null ? 'never' : r.C.hp.toFixed(1) + ' s'}; another seed planned a different search order: ${r.B.order !== A.order}` };
  },

  // 12, 13: seeing her again during the search returns him to ALERT; losing her again
  // starts a fresh 30 s search
  async evasionReacquire() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); } };
      motor.teleport(2, -10, Math.PI); let t = 0; while (a.state !== 'ALERT' && t < 15) { sim(1); t += dt; }
      motor.teleport(-17, 15, 0); while (a.state !== 'EVASION') sim(1);
      sim(8 * 60);                                         // 8 s into the search
      const firstLeft = a.evasion.end - a.clock;
      // she steps out in front of him, 5 m along his facing, in the open
      const fw = g.forward(), spot = g.position.clone().addScaledVector(fw, 5);
      motor.teleport(spot.x, spot.z, g.yaw + Math.PI); let t2 = 0;
      while (a.state !== 'ALERT' && t2 < 5) { sim(1); t2 += dt; }
      const reacquired = a.state === 'ALERT', reason = a.note;
      sim(60);
      motor.teleport(-17, 15, 0); let t3 = 0; while (a.state !== 'EVASION' && t3 < 5) { sim(1); t3 += dt; }
      const fresh = a.evasion ? a.evasion.end - a.clock : 0;
      return { firstLeft, reacquired, t2, reason, evasions: a.evasions, fresh, total: a.cfg.evasionTime };
    });
    const ok = r.reacquired && r.t2 < 3 && /again/.test(r.reason) && r.evasions === 2 && Math.abs(r.fresh - r.total) < 0.2;
    return { pass: ok, detail: `8 s into the search (${r.firstLeft.toFixed(0)} s left) she stepped into view: ${r.reacquired ? 'ALERT again after ' + r.t2.toFixed(2) + ' s ("' + r.reason + '")' : 'not re-alerted'}; she vanished again: search #${r.evasions} with ${r.fresh.toFixed(1)} s on the clock (fresh ${r.total} s)` };
  },

  // Step 7, 1–9, 13, 14: the whole cycle with her hidden far away. EVASION runs out into
  // HEIGHTENED SECURITY (~60 s of slower, watchful checks near his post), then he walks back
  // by path, stops, turns smoothly to his post facing and stands down to NORMAL. No
  // teleports, no obstacle overlap, never NORMAL while seeing her; hearing and vision still work
  async hsCycle() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, world } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60, R = g.cfg.radius;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); } };
      const intrusion = () => { let w = 0; for (const b of world.boxes) { const dx = Math.max(b.minX - g.position.x, 0, g.position.x - b.maxX), dz = Math.max(b.minZ - g.position.z, 0, g.position.z - b.maxZ); w = Math.max(w, R - Math.hypot(dx, dz)); } for (const c of world.cylinders) if (!c.noSight) w = Math.max(w, c.r + R - Math.hypot(g.position.x - c.x, g.position.z - c.z)); return w; };
      const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
      g.reset(); a.reset();
      motor.teleport(-2.4, -10.5, Math.PI); let t = 0; while (a.state !== 'ALERT' && t < 15) { sim(1); t += dt; }
      for (let f = 0; f < 30; f++) { motor.position.z += 0.05; sim(1); }
      motor.teleport(-17, 15, 0);                                 // hidden far away for the whole stand-down
      while (a.state !== 'EVASION') sim(1);
      const seq = ['EVASION'], times = { EVASION: a.clock }, speeds = { EVASION: [], HEIGHTENED: [], RETURNING: [] };
      let worst = 0, maxStep = 0, maxYawStep = 0, maxLeash = 0, seenEver = false, normalWhileSeen = 0, hsDests = 0, hsPauses = 0, lastDest = null, lastLook = null, maxAv = 0, lastPos = g.position.clone(), lastYaw = g.yaw;
      let behaviours = new Set();
      for (let f = 0; f < 160 * 60 && a.state !== 'NORMAL'; f++) {
        sim(1);
        const s = a.state; if (seq[seq.length - 1] !== s) { seq.push(s); times[s] = a.clock; }
        worst = Math.max(worst, intrusion());
        maxStep = Math.max(maxStep, g.position.distanceTo(lastPos)); maxYawStep = Math.max(maxYawStep, Math.abs(wrap(g.yaw - lastYaw))); lastPos.copy(g.position); lastYaw = g.yaw;
        if (g.vision.seen.rate > 0) seenEver = true;
        if (s === 'NORMAL' && g.vision.seen.rate > 0) normalWhileSeen++;
        if (speeds[s] && g.moving && Math.abs(g.motor.speed) > 0.3) speeds[s].push(Math.abs(g.motor.speed));
        if (s === 'HEIGHTENED' && a.hs) {
          if (a.hs.dest && a.hs.dest !== lastDest) { hsDests++; lastDest = a.hs.dest; maxLeash = Math.max(maxLeash, Math.hypot(a.hs.dest.p.x - g.post.x, a.hs.dest.p.z - g.post.z)); }
          if (a.hs.look && a.hs.look !== lastLook) { hsPauses++; lastLook = a.hs.look; }
          behaviours.add(a.behavior);
        }
        if (s === 'RETURNING' && g.atPost() && !g.moving) maxAv = Math.max(maxAv, Math.abs(g.motor.angularVelocity));
      }
      const end = { state: a.state, post: Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z), facing: Math.abs(wrap(g.yaw - g.postYaw)) * 57.2958, stoodDown: a.standDowns, note: a.note, confirmed: a.confirmed };
      sim(5 * 60);                                                // he stays put and idle
      const after = { state: a.state, post: Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z), still: g.isStill(), idle: g.animator.weights.idle };
      // senses intact: a jog step 4 m behind him is heard; then she stands 6 m in front, seen
      const behind = g.position.clone().addScaledVector(g.forward(), -4);
      const heard0 = g.hearing.heardCount || 0; noise.emit(3, 'footstep', behind, 'concrete', 'player'); sim(2);
      const heard = g.hearing.heardCount > heard0 && g.hearing.heard.position.distanceTo(behind) < 0.01;
      // (he turns to the sound first: once he's settled, she stands 6 m in front of him)
      for (let k = 0; k < 4 * 60 && !(g.isStill() && Math.abs(g.motor.angularVelocity) < 0.02); k++) sim(1);
      const front = g.position.clone().addScaledVector(g.forward(), 6); motor.teleport(front.x, front.z, g.yaw + Math.PI); sim(30);
      const seen = g.vision.seen.rate > 0 && g.vision.meter > 0;
      const mean = v => v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
      return { seq: seq.join(' → '), hsLen: (times.RETURNING || 0) - (times.HEIGHTENED || 0), evLen: (times.HEIGHTENED || 0) - times.EVASION, hsDests, hsPauses, behaviours: [...behaviours],
        evSpeed: mean(speeds.EVASION), hsSpeed: mean(speeds.HEIGHTENED), retSpeed: mean(speeds.RETURNING), maxLeash, leash: a.cfg.heightenedLeash, worst, maxStep, maxYawStep, seenEver, normalWhileSeen, maxAv, end, after, heard, seen, hsTime: a.cfg.heightenedTime };
    });
    const e = r.end, A = r.after;
    const ok = r.seq === 'EVASION → HEIGHTENED → RETURNING → NORMAL' && Math.abs(r.hsLen - r.hsTime) < 0.5 && r.hsDests >= 2 && r.hsPauses >= 3
      && r.hsSpeed > 0 && r.hsSpeed < r.evSpeed * 0.8 && r.maxLeash <= r.leash + 1e-6 && r.worst < 0.02 && r.maxStep < 0.06 && r.maxYawStep < 0.08
      && !r.seenEver && r.normalWhileSeen === 0 && e.state === 'NORMAL' && e.post <= 0.4 && e.facing <= 4 && e.stoodDown === 1 && !e.confirmed && r.maxAv <= 3.05
      && A.state === 'NORMAL' && A.post <= 0.4 && A.still && A.idle > 0.9 && r.heard && r.seen;
    return { pass: ok, detail: `${r.seq}; search ${r.evLen.toFixed(1)} s, Heightened Security ${r.hsLen.toFixed(1)} s (setting ${r.hsTime}): ${r.hsDests} checkpoint walks, ${r.hsPauses} look-around pauses, walking ${r.hsSpeed.toFixed(2)} m/s vs search ${r.evSpeed.toFixed(2)} m/s, checkpoints at most ${r.maxLeash.toFixed(1)} m from his post (leash ${r.leash}); return walk ${r.retSpeed.toFixed(2)} m/s; stood down ${e.post.toFixed(2)} m from his post facing ${e.facing.toFixed(1)}° off (turn ≤ ${r.maxAv.toFixed(2)} rad/s), "${e.note}"; 5 s later ${A.state}, still ${A.still}, idle ${A.idle.toFixed(2)}; largest per-frame move ${(r.maxStep * 100).toFixed(1)} cm / turn ${(r.maxYawStep * 57.3).toFixed(1)}°, obstacle overlap ${(Math.max(0, r.worst) * 100).toFixed(1)} cm, ever saw her ${r.seenEver}; afterwards a sound is heard ${r.heard}, she's seen ${r.seen}` };
  },

  // Step 7, 10–12: interruptions. A sighting during Heightened Security → ALERT, then a fresh
  // EVASION; a sighting during the walk back does the same. A meaningful sound sends him to
  // check it and extends his caution (spaced, capped); weak sounds never extend it; a
  // meaningful sound during the return interrupts it, and he still returns afterwards
  async hsInterrupt() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); } };
      const simUntil = (pred, max) => { let t = 0; while (!pred() && t < max) { sim(1); t += dt; } return t; };
      // time from her meter reaching the re-alert level to ALERT
      const sightLag = max => { let t = 0, at = null; while (a.state !== 'ALERT' && t < max) { sim(1); t += dt; if (at == null && g.vision.meter >= a.cfg.reacquireMeter) at = t; } return at == null ? 99 : t - at; };
      const toHS = () => {
        g.reset(); a.reset(); a.cfg.evasionTime = 5;
        motor.teleport(2, -10, Math.PI); simUntil(() => a.state === 'ALERT', 15);
        motor.teleport(-17, 15, 0); simUntil(() => a.state === 'HEIGHTENED', 30);
      };
      const out = {};
      // a sighting during Heightened Security
      toHS(); sim(6 * 60);
      let fw = g.forward(), p = g.position.clone().addScaledVector(fw, 5);
      motor.teleport(p.x, p.z, g.yaw + Math.PI); out.hsSightT = sightLag(8); out.hsSight = a.state; out.hsSightNote = a.note; out.hsInterrupted = a.interrupted;
      sim(30); motor.teleport(-17, 15, 0); simUntil(() => a.state === 'EVASION', 5);
      out.hsFresh = a.state === 'EVASION' ? a.evasion.end - a.clock : 0; out.hsGone = a.hs === null;
      // a sighting during the walk back
      toHS(); a.hs.end = a.clock; simUntil(() => a.state === 'RETURNING', 2); sim(60);
      fw = g.forward(); p = g.position.clone().addScaledVector(fw, 5);
      motor.teleport(p.x, p.z, g.yaw + Math.PI); out.retSightT = sightLag(8); out.retSight = a.state;
      sim(30); motor.teleport(-17, 15, 0); simUntil(() => a.state === 'EVASION', 5); out.retFresh = a.state === 'EVASION';
      // weak sounds for 40 s (faint sneak steps on grass near him): no extension at all
      toHS(); let end0 = a.hs.end, maxEnd = end0;
      for (let k = 0; k < 40; k++) { noise.emit(1, 'footstep', g.position.clone().add(new THREE.Vector3(2.5, 0, 0)), 'grass', 'player'); sim(60); if (a.hs) maxEnd = Math.max(maxEnd, a.hs.end); else break; }
      out.weakExtended = maxEnd - end0; out.weakState = a.state;
      // one meaningful sound: he heads for it (his estimate, not the exact spot) and it extends a little
      toHS(); sim(3 * 60); end0 = a.hs.end;
      const P = new THREE.Vector3(9, 0, -12);
      noise.emit(3, 'footstep', P, 'metal', 'player'); sim(2);
      out.meanDest = a.hs && a.hs.dest ? a.hs.dest.p.distanceTo(a.heard.estimate) : 99; out.meanExact = a.hs && a.hs.dest ? a.hs.dest.p.distanceTo(P) : 0;
      out.meanExt = a.hs ? a.hs.end - end0 : 0; out.meanNote = a.note; out.meanReason = a.hs ? a.hs.reason : '';
      // a stream of meaningful sounds for 120 s: extensions spaced ≥ the gap and capped at the max
      toHS(); const start = a.hs.start, exts = []; let lastEnd = a.hs.end, maxLen = 0;
      for (let k = 0; k < 240 && a.state === 'HEIGHTENED'; k++) {
        const q = new THREE.Vector3(k % 2 ? 9 : -6, 0, k % 2 ? -12 : -9);
        noise.emit(3, 'footstep', q, 'metal', 'player');
        for (let f = 0; f < 30; f++) { sim(1); if (a.hs) { if (a.hs.end > lastEnd + 1e-6) exts.push(a.clock); lastEnd = a.hs.end; maxLen = Math.max(maxLen, a.hs.end - start); } }
      }
      let minGap = Infinity; for (let i = 1; i < exts.length; i++) minGap = Math.min(minGap, exts[i] - exts[i - 1]);
      out.exts = exts.length; out.minGap = minGap; out.maxLen = maxLen; out.streamEndState = a.state; out.cap = a.cfg.heightenedMax; out.gapCfg = a.cfg.heightenedExtendGap;
      // a meaningful sound during the walk back interrupts it; he checks it, then returns and stands down
      toHS(); a.hs.end = a.clock; simUntil(() => a.state === 'RETURNING', 2); sim(90);
      noise.emit(3, 'footstep', new THREE.Vector3(9, 0, -12), 'metal', 'player'); sim(2);
      out.retInt = a.state; out.retIntNote = a.interrupted; out.retIntReason = a.hs ? a.hs.reason : '';
      const seq = [a.state]; let t = 0;
      while (a.state !== 'NORMAL' && t < 90) { sim(1); t += dt; if (seq[seq.length - 1] !== a.state) seq.push(a.state); }
      out.retSeq = seq.join(' → '); out.retPost = Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z);
      // she stays in plain view (not hidden) for 100 s: never NORMAL
      g.reset(); a.reset(); a.cfg.evasionTime = 30;
      motor.teleport(2, -10, Math.PI); let normal = 0;
      for (let f = 0; f < 100 * 60; f++) { sim(1); if (f > 600 && a.state === 'NORMAL') normal++; }
      out.visibleNormal = normal; out.visibleState = a.state;
      return out;
    });
    const ok = r.hsSight === 'ALERT' && r.hsSightT < 0.05 && /again/.test(r.hsSightNote) && r.hsGone && /interrupted/.test(r.hsInterrupted) && Math.abs(r.hsFresh - 5) < 0.3
      && r.retSight === 'ALERT' && r.retSightT < 0.05 && r.retFresh
      && r.weakExtended === 0 && r.weakState !== 'ALERT'
      && r.meanDest < 0.01 && r.meanExact > 0.05 && r.meanExt > 0 && r.meanExt <= 5 + 1e-6 && /metal/.test(r.meanNote) && /sound/.test(r.meanReason)
      && r.exts >= 2 && r.minGap >= r.gapCfg - 0.05 && r.maxLen <= r.cap + 1e-6
      && r.retInt === 'HEIGHTENED' && /interrupted/.test(r.retIntNote) && r.retSeq.endsWith('RETURNING → NORMAL') && r.retPost <= 0.4
      && r.visibleNormal === 0 && r.visibleState === 'ALERT';
    return { pass: ok, detail: `seen during Heightened Security: ${r.hsSight} after ${r.hsSightT.toFixed(2)} s ("${r.hsInterrupted}"), then a fresh search (${r.hsFresh.toFixed(1)} s); seen during the return: ${r.retSight} ${r.retSightT.toFixed(2)} s after the re-alert level, fresh search ${r.retFresh}; 40 s of faint steps extended it by ${r.weakExtended.toFixed(1)} s; a metal jog step: "${r.meanNote}", he heads for his estimate (${r.meanExact.toFixed(2)} m off the real spot), +${r.meanExt.toFixed(1)} s; a stream of strong sounds: ${r.exts} extensions at least ${isFinite(r.minGap) ? r.minGap.toFixed(1) : '-'} s apart (gap ${r.gapCfg}), longest ${r.maxLen.toFixed(1)} s (cap ${r.cap}), then ${r.streamEndState}; a sound during the walk back → ${r.retInt} ("${r.retIntNote}"), then ${r.retSeq}, ${r.retPost.toFixed(2)} m from post; in plain view 100 s: NORMAL frames ${r.visibleNormal}, ends ${r.visibleState}` };
  },

  // Step 7, 15–17: the spawn. Every vision body point is beyond his range or outside his
  // cone; standing still there for 20 s he never detects her (meter 0, NORMAL); she
  // overlaps no obstacle, has open ground around her, is well away from him and inside the
  // yard, and the camera starts behind her looking into the yard
  async spawnSafe() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, world, area, cam } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60, v = g.vision;
      const S = area.spawn; motor.teleport(S.x, S.z, S.yaw); cam.snap(motor);
      for (let f = 0; f < 120; f++) { step(0, 'stand'); MV.footsteps.update(dt); }
      g.reset();
      const eye = g.eye(new THREE.Vector3()), fw = g.forward(new THREE.Vector3()), half = Math.max(...v.cfg.zones.map(z => z.angle)) / 2;
      const pts = T.points().map(p => { const dx = p.x - eye.x, dz = p.z - eye.z, d = Math.hypot(dx, dz); return { d, off: Math.acos((dx * fw.x + dz * fw.z) / d) * 57.2958 }; });
      const minDist = Math.min(...pts.map(p => p.d)), minOff = Math.min(...pts.map(p => p.off)), allOut = pts.every(p => p.d > v.range() || p.off > half);
      // 20 s standing still with the guard watching and listening
      let maxMeter = 0, states = new Set(), steps0 = MV.footsteps.count;
      for (let f = 0; f < 20 * 60; f++) { step(0, 'stand'); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); maxMeter = Math.max(maxMeter, v.meter); states.add(a.state); }
      // space around her: obstacles and the perimeter
      const R = motor.radius || 0.3, P = motor.position; let clear = Infinity;
      for (const b of world.boxes) { const dx = Math.max(b.minX - P.x, 0, P.x - b.maxX), dz = Math.max(b.minZ - P.z, 0, P.z - b.maxZ); clear = Math.min(clear, Math.hypot(dx, dz) - R); }
      for (const c of world.cylinders) if (!c.noSight) clear = Math.min(clear, Math.hypot(P.x - c.x, P.z - c.z) - c.r - R);
      const toGuard = Math.hypot(P.x - g.position.x, P.z - g.position.z), inside = Math.abs(P.x) < area.size / 2 - 1 && Math.abs(P.z) < area.size / 2 - 1;
      // the camera looks the way she faces, into the yard (toward its centre)
      const cf = cam.forward(new THREE.Vector3()), toC = new THREE.Vector3(-P.x, 0, -P.z).normalize();
      return { minDist, minOff, half, range: v.range(), allOut, maxMeter, states: [...states], why: v.seen.why, footsteps: MV.footsteps.count - steps0, clear, toGuard, inside, camYard: cf.dot(toC), camFacing: cf.dot(new THREE.Vector3(Math.sin(S.yaw), 0, Math.cos(S.yaw))), at: [P.x, P.z] };
    });
    const ok = r.allOut && r.maxMeter === 0 && r.states.length === 1 && r.states[0] === 'NORMAL' && r.footsteps === 0 && r.clear >= 1.5 && r.toGuard >= 3 && r.inside && r.camYard > 0.5 && r.camFacing > 0.99;
    return { pass: ok, detail: `spawn (${r.at[0].toFixed(1)}, ${r.at[1].toFixed(1)}): every body point outside his sight (nearest ${r.minDist.toFixed(1)} m vs range ${r.range}, at least ${r.minOff.toFixed(0)}° off his facing vs ${r.half}° half-cone): ${r.allOut}; 20 s standing still: meter peak ${(r.maxMeter * 100).toFixed(0)}%, states ${r.states.join('/')}, his last look "${r.why}", footsteps ${r.footsteps}; ${r.clear.toFixed(1)} m clear of the nearest obstacle, ${r.toGuard.toFixed(1)} m from him, inside the yard ${r.inside}; camera along her facing ${r.camFacing.toFixed(2)}, toward the yard ${r.camYard.toFixed(2)}` };
  },

  // Step 7, 18: RESET on an iPhone-landscape screen (real touches, frame loop running) after
  // she's crouched and moving and he's alerted, searching and has heard her: she's back at
  // the spawn standing still with the camera behind her; he's at his post, facing it, NORMAL,
  // with no alert, sound, search or investigation left; it stays that way
  async resetClean() {
    const page = await touchPage(), Tc = page.touch;
    await page.evaluate(() => { const { motor, cam } = MV; motor.teleport(2, -10, Math.PI); cam.snap(motor); });
    await page.waitForFunction(() => MV.guard.awareness.state === 'ALERT', null, { timeout: 30000 }).catch(() => {});   // he sees her
    const alerted = await page.evaluate(() => MV.guard.awareness.state);
    await page.evaluate(() => { const { motor, cam } = MV; motor.teleport(-6, 15, Math.PI); cam.snap(motor); });
    await page.waitForFunction(() => MV.guard.awareness.state === 'EVASION', null, { timeout: 30000 }).catch(() => {});   // he loses her: searching
    const bb = await page.locator('#mv-crouch').boundingBox();
    await Tc('touchStart', [{ x: bb.x + 30, y: bb.y + 30, id: 9 }]); await Tc('touchEnd', []); await page.waitForTimeout(300);
    await page.evaluate(() => MV.noise.emit(3, 'footstep', new THREE.Vector3(MV.guard.position.x + 3, 0, MV.guard.position.z), 'metal', 'player'));
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 150, y: 236, id: 1 }]); await page.waitForTimeout(1200);
    const before = await page.evaluate(() => { const a = MV.guard.awareness; return { state: a.state, crouch: MV.input.crouch, speed: MV.motor.speed, heard: !!a.heard, moving: MV.guard.moving }; });
    await Tc('touchEnd', []);
    await page.tap('#mv-reset'); await page.waitForTimeout(100);
    const snap = () => page.evaluate(() => {
      const { motor, input, cam, area } = MV, g = MV.guard, a = g.awareness, S = area.spawn, wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
      return { pos: Math.hypot(motor.position.x - S.x, motor.position.z - S.z), yaw: Math.abs(wrap(motor.yaw - S.yaw)) * 57.3, speed: Math.abs(motor.speed), stance: motor.stance, crouch: input.crouch,
        camYaw: Math.abs(wrap(cam.yaw - S.yaw - Math.PI)) * 57.3, gPost: Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z), gYaw: Math.abs(wrap(g.yaw - g.postYaw)) * 57.3, gMoving: g.moving, path: !!g.path,
        state: a.state, suspicion: a.suspicion, confirmed: a.confirmed, left: [a.evasion, a.hs, a.search, a.focus, a.seen, a.heard].filter(x => x != null).length + a.track.length + a.recent.length,
        meter: g.vision.meter, hearing: !!g.hearing.heard, idle: MV.animator.weights.idle, steps: MV.footsteps.count, still: g.isStill() };
    });
    // she may finish the step she was taking (the animator's normal settle into idle, at the
    // spawn, unheard by him); after that, nothing
    const A = await snap(); await page.waitForTimeout(2000); const M = await snap(); await page.waitForTimeout(3000); const B = await snap();
    const clean = s => s.pos < 0.01 && s.yaw < 0.5 && s.speed < 0.01 && s.stance === 'stand' && !s.crouch && s.gPost < 0.01 && s.gYaw < 0.5 && !s.gMoving && s.state === 'NORMAL' && s.suspicion === 0 && !s.confirmed && s.left === 0 && s.meter === 0 && !s.hearing;
    const ok = alerted === 'ALERT' && before.state === 'EVASION' && before.crouch && before.speed > 0.5 && clean(A) && A.camYaw < 1 && clean(M) && clean(B) && M.steps - A.steps <= 2 && B.steps === M.steps && B.idle > 0.9 && B.still && page.errors.length === 0;
    return { pass: ok, detail: `before RESET: ${alerted} then ${before.state}, crouched ${before.crouch}, moving ${before.speed.toFixed(2)} m/s, heard ${before.heard}; after: her ${A.pos.toFixed(2)} m / ${A.yaw.toFixed(1)}° from the spawn, ${A.stance}, crouch ${A.crouch}, camera ${A.camYaw.toFixed(1)}° from behind her; him ${A.gPost.toFixed(2)} m / ${A.gYaw.toFixed(1)}° from his post, ${A.state}, suspicion ${A.suspicion}, leftover memory/search items ${A.left}, meter ${A.meter}, heard-sound record ${A.hearing}; settle steps in the first 2 s ${M.steps - A.steps} (heard: ${M.hearing}); 3 s later ${B.state}, items ${B.left}, footsteps ${B.steps - M.steps}, her idle ${B.idle.toFixed(2)}, him still ${B.still}; page errors ${page.errors.length}` };
  },

  // Step 7 on an iPhone-landscape screen, real touches, frame loop running (about 2 minutes):
  // from the spawn she stealth-walks into his view until he's alerted, jogs back out of
  // range and north along the west wall, then stands hidden. The whole stand-down runs:
  // EVASION → HEIGHTENED (~60 s) → RETURNING → NORMAL at his post, facing it, never seeing her
  async hsTouchCycle() {
    const page = await touchPage(), Tc = page.touch, X = 150, Y = 300;
    await page.evaluate(() => {
      const g = MV.guard, a = g.awareness; window.__c = { seq: [], times: {}, maxStep: 0, seenHidden: 0, normalSeen: 0 }; let last = '', lp = g.position.clone();
      (function f() {
        const c = window.__c, s = a.state; if (s !== last) { c.seq.push(s); c.times[s] = a.clock; last = s; }
        c.maxStep = Math.max(c.maxStep, g.position.distanceTo(lp)); lp.copy(g.position);
        if (c.hidden && g.vision.seen.rate > 0) c.seenHidden++;
        if (s === 'NORMAL' && c.times.ALERT != null && g.vision.seen.rate > 0) c.normalSeen++;   // after the alert
        requestAnimationFrame(f);
      })();
    });
    // the thumb pushes toward a world point (from the camera's forward / right), re-aimed every 0.3 s
    const steer = async (tx, tz, px, done, max) => {
      const t0 = Date.now(); let first = true;
      while (Date.now() - t0 < max && !(await page.evaluate(done))) {
        const st = await page.evaluate(([tx, tz]) => { const f = MV.cam.forward(new THREE.Vector3()), p = MV.motor.position, wx = tx - p.x, wz = tz - p.z, l = Math.hypot(wx, wz); return { mx: (wx * -f.z + wz * f.x) / l, my: (wx * f.x + wz * f.z) / l }; }, [tx, tz]);
        if (first) { await Tc('touchStart', [{ x: X, y: Y, id: 1 }]); first = false; }
        await Tc('touchMove', [{ x: X + st.mx * px, y: Y - st.my * px, id: 1 }]); await page.waitForTimeout(300);
      }
      await Tc('touchEnd', []);
    };
    await steer(2, -14, 32, () => MV.guard.awareness.state === 'ALERT', 60000);
    await steer(-18, -14, 64, () => MV.motor.position.x < -17, 30000);
    await steer(-18, 18, 64, () => MV.motor.position.z > 17.5, 30000);
    await page.evaluate(() => { window.__c.hidden = true; });
    await page.waitForFunction(() => MV.guard.awareness.standDowns > 0 || MV.guard.awareness.evasions > 1, null, { timeout: 300000, polling: 500 }).catch(() => {});
    await page.waitForTimeout(1000);
    const r = await page.evaluate(() => { const g = MV.guard, a = g.awareness, c = window.__c, wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
      return { seq: c.seq.join(' → '), hs: (c.times.RETURNING || 0) - (c.times.HEIGHTENED || 0), maxStep: c.maxStep, seenHidden: c.seenHidden, normalSeen: c.normalSeen, state: a.state, post: Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z), facing: Math.abs(wrap(g.yaw - g.postYaw)) * 57.3, at: [MV.motor.position.x, MV.motor.position.z] }; });
    const ok = /ALERT → EVASION → HEIGHTENED → RETURNING → NORMAL$/.test(r.seq) && Math.abs(r.hs - 60) < 1 && r.maxStep < 0.15 && r.seenHidden === 0 && r.normalSeen === 0
      && r.state === 'NORMAL' && r.post <= 0.4 && r.facing <= 4 && page.errors.length === 0;
    return { pass: ok, detail: `${r.seq}; Heightened Security ${r.hs.toFixed(1)} s; she hid at (${r.at[0].toFixed(1)}, ${r.at[1].toFixed(1)}), seen while hidden ${r.seenHidden} frames; NORMAL while seeing her after the alert ${r.normalSeen} frames; stood down ${r.post.toFixed(2)} m / ${r.facing.toFixed(1)}° from his post; largest per-frame move ${(r.maxStep * 100).toFixed(1)} cm; page errors ${page.errors.length}` };
  },

  // Step 8, 1, 4, 6, 7: the first meaningful sound of a new incident. He pauses (the body
  // doesn't move before reactDelay), then reacts once (one vocal request), his head and
  // body turn toward it at limited rates, and even when the sound is enough to investigate
  // he assesses before walking (not before reactDelay + assessTime); no joint pops
  async reactFirst() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60, B = g.bones, c = a.cfg, bl = g.cfg.bodyLanguage;
      const sim = () => { step(0, 'stand'); noise.update(dt); g.update(dt, T); };
      motor.teleport(-12, -18, 0); for (let f = 0; f < 60; f++) step(0, 'stand');
      const v0 = MV.voice.log.length, yaw0 = g.yaw;
      // three jog steps 4 m behind-right, close together: enough to investigate at once
      const P = new THREE.Vector3(g.position.x + 2.8, 0, g.position.z - 2.8);
      for (let k = 0; k < 3; k++) { noise.emit(3, 'footstep', P.clone().add(new THREE.Vector3(k * 0.3, 0, 0)), 'concrete', 'player'); sim(); }
      const t0 = a.clock - 2 * dt, susp0 = a.suspicion;
      let reactT = null, bodyT = null, headT = null, moveT = null, maxHead = 0, maxYaw = 0, prevHead = g.headYaw, prevYaw = g.yaw, pops = 0; const prevQ = {}, lastA = {};
      for (let f = 0; f < 6 * 60; f++) {
        sim(); const t = a.clock - t0;
        if (reactT == null && a.reactions > 0) reactT = t;
        if (bodyT == null && Math.abs(Math.atan2(Math.sin(g.yaw - yaw0), Math.cos(g.yaw - yaw0))) > 0.01) bodyT = t;
        if (headT == null && Math.abs(g.headYaw) > 0.01) headT = t;
        if (moveT == null && g.moving && Math.abs(g.motor.speed) > 0.05) moveT = t;
        maxHead = Math.max(maxHead, Math.abs(g.headYaw - prevHead)); prevHead = g.headYaw;
        maxYaw = Math.max(maxYaw, Math.abs(Math.atan2(Math.sin(g.yaw - prevYaw), Math.cos(g.yaw - prevYaw)))); prevYaw = g.yaw;
        const ri = g.root.getWorldQuaternion(new THREE.Quaternion()).invert();
        for (const nm of ['spine1', 'chest', 'neck', 'head', 'leftArm', 'rightArm', 'leftUpLeg', 'rightUpLeg', 'leftLeg', 'rightLeg']) { const q = ri.clone().multiply(B[nm].getWorldQuaternion(new THREE.Quaternion())); if (prevQ[nm]) { const ang = 2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ[nm])))) * 57.3, leg = nm.endsWith('Leg'); if (leg ? (ang > 12 && ang > 2 * (lastA[nm] || 0)) : ang > 9) pops++; lastA[nm] = ang; } prevQ[nm] = q; }
      }
      return { reactT, bodyT, headT, moveT, react: c.reactDelay, assess: c.assessTime, susp0, invAt: c.investigateAt, reactions: a.reactions, voice: MV.voice.log.length - v0, why: MV.voice.log.length ? MV.voice.log[MV.voice.log.length - 1].why : '',
        maxHead: maxHead / dt, headRate: bl.headRate, maxYaw: maxYaw / dt, turnRate: g.cfg.turn.maxRate, pops, state: a.state };
    });
    const ok = r.susp0 >= r.invAt && r.reactions === 1 && r.voice === 1 && r.reactT != null && Math.abs(r.reactT - r.react) < 0.05
      && r.bodyT >= r.react - 0.02 && r.headT >= r.react - 0.02 && r.moveT != null && r.moveT >= r.react + r.assess - 0.02
      && r.maxHead <= r.headRate + 0.01 && r.maxYaw <= r.turnRate + 0.05 && r.pops === 0;
    return { pass: ok, detail: `3 jog steps behind him (suspicion ${(r.susp0 * 100).toFixed(0)}%, enough to investigate): paused, reacted once at ${r.reactT == null ? 'never' : r.reactT.toFixed(2) + ' s'} (delay ${r.react}), ${r.voice} vocal request ("${r.why || 'played'}"); head started turning at ${r.headT == null ? 'never' : r.headT.toFixed(2) + ' s'} (≤ ${r.maxHead.toFixed(2)} rad/s, limit ${r.headRate}), body at ${r.bodyT == null ? 'never' : r.bodyT.toFixed(2) + ' s'} (≤ ${r.maxYaw.toFixed(2)} rad/s, limit ${r.turnRate}); first investigation step at ${r.moveT == null ? 'never' : r.moveT.toFixed(2) + ' s'} (not before ${(r.react + r.assess).toFixed(1)}); joint pops ${r.pops}; ${r.state}` };
  },

  // Step 8, 2, 3, 7, 9: ten footsteps in succession (sneak steps 0.6 s apart, then a run of
  // stealth-walk steps while he walks): one incident, one vocal reaction; suspicion still
  // builds step by step; the pause isn't restarted, the head and body turns aren't
  // restarted (no reversals) and his walk isn't interrupted by the steps
  async reactRepeat() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); } };
      motor.teleport(-12, -18, 0); for (let f = 0; f < 60; f++) step(0, 'stand');
      const v0 = MV.voice.log.length, P = new THREE.Vector3(g.position.x + 1.4, 0, g.position.z - 1);
      const susp = [], reactAts = new Set(); let headRev = 0, prevDh = 0, flips = 0, prevAv = 0, lastFlip = -9, t = 0;
      const watch = n => { for (let i = 0; i < n; i++) { sim(1); t += dt; if (a.incident) reactAts.add(a.incident.reactAt.toFixed(3));
        const av = g.motor.angularVelocity; if (Math.sign(av) !== Math.sign(prevAv) && Math.abs(av) > 0.3 && Math.abs(prevAv) > 0.3) { if (t - lastFlip < 0.5) flips++; lastFlip = t; } prevAv = av;
        // a fresh head turn: from near neutral (< 5°) out past 20° (leading the body, then easing back as it catches up, is one turn)
        const hd = Math.abs(g.headYaw) * 57.3; if (hd < 5) watch.armed = true; else if (hd > 20 && watch.armed !== false) { headRev++; watch.armed = false; } } };
      for (let k = 0; k < 10; k++) { noise.emit(1, 'footstep', P.clone().add(new THREE.Vector3((k % 2) * 0.3, 0, k * 0.15)), 'concrete', 'player'); susp.push(a.suspicion); watch(36); }
      const after10 = { reactions: a.reactions, voice: MV.voice.log.length - v0, state: a.state, incidents: a.incidents };
      let rising = 0, below = 0; for (let i = 1; i < susp.length; i++) if (susp[i - 1] < 1) { below++; if (susp[i] > susp[i - 1] + 1e-6) rising++; }
      // he's walking to investigate: ten more stealth-walk steps near the spot
      let w = 0; while (!(g.moving && Math.abs(g.motor.speed) > 0.3) && w < 600) { sim(1); w++; }
      let stops = 0, wasMoving = g.moving; const v1 = MV.voice.log.length;
      for (let k = 0; k < 10; k++) { noise.emit(2, 'footstep', P.clone().add(new THREE.Vector3(k * 0.1, 0, 0)), 'concrete', 'player'); for (let f = 0; f < 18; f++) { sim(1); if (wasMoving && !g.moving && !g.arrived) stops++; wasMoving = g.moving; } }
      return { after10, rising, below, reactAts: reactAts.size, headRev, flips, walkedAt: w, stops, moreVoice: MV.voice.log.length - v1, reactions: a.reactions, susp: susp.map(x => Math.round(x * 100)).join(' → ') };
    });
    const A = r.after10;
    const ok = A.reactions === 1 && A.voice === 1 && A.incidents === 1 && r.below >= 3 && r.rising === r.below && r.reactAts === 1 && r.headRev === 1 && r.flips === 0 && r.stops === 0 && r.moreVoice === 0 && r.reactions === 1;
    return { pass: ok, detail: `10 sneak steps: ${A.voice} vocal reaction(s), ${A.incidents} incident, suspicion ${r.susp}% (rose on ${r.rising} of the ${r.below} steps below its 100% cap), now ${A.state}; reaction time set ${r.reactAts} time(s) (never restarted), head turns started ${r.headRev}, rapid body-turn reversals ${r.flips}; then 10 stealth-walk steps while he walks: interrupted his walk ${r.stops} times, more vocal reactions ${r.moreVoice}` };
  },

  // Step 8, 5, 10: sight comes first. A sound starts the pause, then she's right in front
  // of him in plain view: ALERT on exactly the same frame as without the sound, and the
  // vocal reaction is cancelled. Once alerted, sounds through EVASION, HEIGHTENED SECURITY
  // and RETURN TO POST never start a new reaction, and the whole cycle still completes
  async reactSight() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); } };
      const framesToAlert = withSound => {
        g.reset(); motor.teleport(-12, -18, 0); for (let f = 0; f < 30; f++) step(0, 'stand'); sim(30);
        if (withSound) noise.emit(2, 'footstep', new THREE.Vector3(g.position.x + 3, 0, g.position.z - 2), 'concrete', 'player');
        sim(6);                                                     // same frames either way (his 10 Hz look stays in step)
        const pausing = a.incident && a.clock < a.incident.reactAt;
        const fw = g.forward(), p = g.position.clone().addScaledVector(fw, 1.6); motor.teleport(p.x, p.z, g.yaw + Math.PI); for (let f = 0; f < 2; f++) step(0, 'stand');
        let n = 0; while (a.state !== 'ALERT' && n < 600) { sim(1); n++; }
        return { n, pausing, reactions: a.reactions };
      };
      const quiet = framesToAlert(false), noisy = framesToAlert(true);
      // the rest of the cycle, quickly: he loses her, sounds come during each phase
      a.cfg.evasionTime = 6; a.cfg.heightenedTime = 8; const r0 = a.reactions, seq = [a.state];
      motor.teleport(-17, 15, 0);
      let t = 0, duringReturn = 0; const Q = new THREE.Vector3(9, 0, -12);
      while (a.standDowns === 0 && t < 120) {
        sim(1); t += dt; if (seq[seq.length - 1] !== a.state) seq.push(a.state);
        // a sound every 2.5 s; only one during the walk back (each would rightly interrupt it)
        if (Math.round(t * 60) % 150 === 0 && (a.state !== 'RETURNING' || duringReturn++ === 0)) noise.emit(2, 'footstep', Q, 'metal', 'player');
      }
      return { quiet, noisy, seq: seq.join(' → '), after: a.reactions - r0, state: a.state };
    });
    const ok = r.noisy.pausing && r.noisy.n === r.quiet.n && r.noisy.reactions === 0 && r.quiet.reactions === 0 && r.after === 0
      && /ALERT → EVASION → HEIGHTENED → (RETURNING → )?(HEIGHTENED → RETURNING → )*NORMAL$/.test(r.seq) && r.state === 'NORMAL';
    return { pass: ok, detail: `in plain view: ALERT after ${r.quiet.n} frames without a sound, ${r.noisy.n} frames when a sound had just started his pause (pausing: ${r.noisy.pausing}); vocal reactions ${r.noisy.reactions} (cancelled by the sighting); then ${r.seq} with sounds every 2.5 s: ${r.after} new reactions` };
  },

  // Step 8, 8: the reaction comes back only after a genuine calm. One sneak step → one
  // reaction; he settles to NORMAL; another step straight away (still within the calm
  // time) → no new reaction; after he's been calm for incidentCalmTime, a new step is a
  // new incident with its own reaction
  async reactRecalm() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); } };
      motor.teleport(-12, -18, 0); for (let f = 0; f < 30; f++) step(0, 'stand');
      const P = new THREE.Vector3(g.position.x + 1.4, 0, g.position.z - 1), snd = () => noise.emit(1, 'footstep', P, 'concrete', 'player');
      snd(); sim(120); const first = a.reactions;
      let t = 0; while (!(a.state === 'NORMAL' && a.suspicion < a.cfg.calmAt) && t < 60) { sim(1); t += dt; }
      snd(); sim(120); const soon = a.reactions;
      t = 0; while (a.incident && t < 60) { sim(1); t += dt; }
      const calmFor = a.cfg.incidentCalmTime, ended = !a.incident;
      snd(); sim(120); const later = a.reactions;
      return { first, soon, later, ended, calmFor, incidents: a.incidents };
    });
    const ok = r.first === 1 && r.soon === 1 && r.ended && r.later === 2 && r.incidents === 2;
    return { pass: ok, detail: `first step: ${r.first} reaction; a step just after he settled (within ${r.calmFor} s of calm): still ${r.soon}; after a genuine calm (incident ended: ${r.ended}) a new step: ${r.later} reactions, ${r.incidents} incidents` };
  },

  // Step 8, 2, 11, 12: real iPhone touches. She walks across the surface strips behind him
  // at sneak, stealth walk and jog (concrete, metal and grass under her feet): each run is
  // one incident with at most one vocal reaction, however many steps he hears. No floating
  // "?" / "!" or any sprite, text or icon appears on him or in the scene; the player's
  // bones are untouched by his body language
  async reactTouch() {
    const page = await touchPage(), Tc = page.touch, X = 150, Y = 300, runs = [];
    const steer = async (tx, tz, px, max) => {
      const t0 = Date.now(); let first = true;
      while (Date.now() - t0 < max) {
        const st = await page.evaluate(([tx, tz]) => { const f = MV.cam.forward(new THREE.Vector3()), p = MV.motor.position, wx = tx - p.x, wz = tz - p.z, l = Math.hypot(wx, wz); return { mx: (wx * -f.z + wz * f.x) / l, my: (wx * f.x + wz * f.z) / l, d: l }; }, [tx, tz]);
        if (st.d < 0.4) break;
        if (first) { await Tc('touchStart', [{ x: X, y: Y, id: 1 }]); first = false; }
        await Tc('touchMove', [{ x: X + st.mx * px, y: Y - st.my * px, id: 1 }]); await page.waitForTimeout(250);
      }
      await Tc('touchEnd', []);
    };
    let glyphs = 0, sprites = 0;
    const scan = () => page.evaluate(() => {
      let sp = 0; MV.scene.traverse(o => { if (o.isSprite || o.isPoints || (o.geometry && o.geometry.type === 'TextGeometry')) sp++; });
      const g = MV.guard; [g.root].forEach(root => root.traverse(o => { const m = o.material; if (m && [].concat(m).some(x => x.map && x.map.image && x.map.image.getContext)) sp++; }));
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let gl = 0, n;
      while ((n = walker.nextNode())) { const s = n.textContent.trim(); const el = n.parentElement; if (/^[!?¿¡]+$/.test(s) && el && el.offsetParent !== null && el.id !== 'mv-indicator') gl++; }   // (the approved awareness indicator is its own check)
      return { sp, gl };
    });
    for (const [label, px] of [['sneak', 25], ['stealth walk', 50], ['jog', 64]]) {
      await page.evaluate(() => {
        const g = MV.guard; g.post.set(0, 0, 1.5); g.postYaw = Math.PI; g.reset();
        MV.motor.teleport(-4.6, 5.2, Math.PI / 2); MV.cam.snap(MV.motor);
        window.__r = { heard: 0, surfaces: {}, v0: MV.voice.log.length };
        if (!window.__hooked) { window.__hooked = true; MV.noise.on(e => { if (e.source === 'player' && window.__r) setTimeout(() => { const h = MV.guard.hearing.heard; if (h && h.position.distanceTo(e.position) < 1e-6) { window.__r.heard++; window.__r.surfaces[e.surface] = (window.__r.surfaces[e.surface] || 0) + 1; } }, 0); }); }
      });
      await page.waitForTimeout(400);
      await steer(4.6, 5.2, px, 12000);
      const s1 = await scan(); glyphs += s1.gl; sprites += s1.sp;
      await page.waitForTimeout(1500);
      const s2 = await scan(); glyphs += s2.gl; sprites += s2.sp;
      const r = await page.evaluate(() => ({ heard: window.__r.heard, surfaces: window.__r.surfaces, voice: MV.voice.log.length - window.__r.v0, reactions: MV.guard.awareness.reactions, incidents: MV.guard.awareness.incidents, state: MV.guard.awareness.state, gait: MV.motor.gait.label }));
      runs.push(Object.assign({ label }, r));
    }
    // his body language moves only his own bones: the player's skeleton shares none of them
    const shared = await page.evaluate(() => { const g = MV.guard, pb = new Set(Object.values(MV.visual.bones)); return Object.values(g.bones).filter(b => pb.has(b)).length; });
    await page.evaluate(() => { const g = MV.guard; g.post.set(2, 0, -16); g.postYaw = 0; g.reset(); });
    const ok = runs.every(x => x.heard >= 3 && x.voice <= 1 && x.reactions <= 1 && x.incidents <= 1 && x.voice === x.reactions) && runs.filter(x => x.reactions === 1).length >= 2
      && runs.some(x => Object.keys(x.surfaces).length >= 2) && glyphs === 0 && sprites === 0 && shared === 0 && page.errors.length === 0;
    return { pass: ok, detail: runs.map(x => `${x.label}: ${x.heard} steps heard (${Object.entries(x.surfaces).map(([k, n]) => k + ' ' + n).join(', ')}) → ${x.voice} vocal reaction, ${x.incidents} incident, ${x.state}`).join('; ') + `; floating ?/! glyphs ${glyphs}, sprites/text/icons on him ${sprites}; bones shared with the player ${shared}; page errors ${page.errors.length}` };
  },

  // Step 8.1: the TEMPORARY "Huh" caption, on an iPhone-landscape page with the frame loop
  // running. Ten footsteps in one incident: it appears once (never re-shown or restarted;
  // its opacity rises, holds about 1 s and falls once), reads "Huh" in small text, sits
  // above his head and follows it; it's hidden behind solid cover and when he's too far
  // away; a new incident that turns into ALERT dismisses it at once; the guard's reaction
  // itself is unchanged (one vocal request per incident)
  async reactCaption() {
    const page = await touchPage();
    await page.evaluate(() => {
      const g = MV.guard; g.reset(); MV.caption.hide();
      MV.motor.teleport(2, -19.5, 0); MV.cam.snap(MV.motor);
      window.__cap = []; const cap = MV.caption;
      (function f() { const el = document.getElementById('mv-caption'), b = el.getBoundingClientRect(), hp = MV.guard.head.getWorldPosition(new THREE.Vector3()).setY(MV.guard.head.getWorldPosition(new THREE.Vector3()).y + cap.cfg.height).project(MV.camera);
        window.__cap.push({ t: MV.guard.awareness.clock, shown: cap.shown, active: cap.active, hidden: el.hidden, op: +el.style.opacity, text: el.textContent, h: b.height, fs: parseFloat(getComputedStyle(el).fontSize), cx: b.left + b.width / 2, by: b.bottom, hx: (hp.x + 1) / 2 * innerWidth, hy: (1 - hp.y) / 2 * innerHeight, state: MV.guard.awareness.state, reactions: MV.guard.awareness.reactions });
        if (window.__cap.length < 4000) requestAnimationFrame(f); })();
    });
    await page.waitForTimeout(300);
    // ten stealth-walk steps to his right, 0.35 s apart (he turns away from her to listen)
    for (let k = 0; k < 10; k++) { await page.evaluate(k => MV.noise.emit(2, 'footstep', new THREE.Vector3(5 + (k % 2) * 0.3, 0, -16 + k * 0.1), 'concrete', 'player'), k); await page.waitForTimeout(350); }
    // until it has finished in game time (a slow machine runs the game clock slower than the wall clock)
    await page.waitForFunction(() => !MV.caption.active, null, { timeout: 20000, polling: 100 }).catch(() => {}); await page.waitForTimeout(200);
    const A = await page.evaluate(() => {
      const L = window.__cap, on = L.filter(x => !x.hidden && x.op > 0);
      let ups = 0, phase = 'in', restarts = 0; for (let i = 1; i < on.length; i++) { const d = on[i].op - on[i - 1].op; if (phase === 'in' && d < -1e-3) phase = 'out'; else if (phase === 'out' && d > 1e-3) restarts++; }
      const first = on[0], last = on[on.length - 1], full = on.filter(x => x.op >= 0.999);
      const anchor = Math.max(...on.map(x => Math.hypot(x.cx - x.hx, x.by - x.hy)));
      return { hold: MV.caption.cfg.hold, total: MV.caption.cfg.fadeIn + MV.caption.cfg.hold + MV.caption.cfg.fadeOut, shown: L[L.length - 1].shown, reactions: L[L.length - 1].reactions, restarts, span: on.length ? last.t - first.t : 0, full: full.length ? full[full.length - 1].t - full[0].t : 0, text: first ? first.text : '', h: first ? first.h : 0, fs: first ? first.fs : 0, anchor, endHidden: L[L.length - 1].hidden, state: L[L.length - 1].state };
    });
    // hidden behind solid cover and when far away (a separate camera; nothing else moves)
    const B = await page.evaluate(() => {
      const cap = MV.caption, g = MV.guard, cam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 80), head = g.head.getWorldPosition(new THREE.Vector3());
      const at = (x, y, z) => { cam.position.set(x, y, z); cam.lookAt(head); cam.updateMatrixWorld(true); cap.show(); cap.update(0.2, cam, innerWidth, innerHeight); const w = cap.why, hid = document.getElementById('mv-caption').hidden; cap.hide(); return { w, hid }; };
      // the 2 m tall crate at (-2, -8) sits between a camera at (-4, -4) and his head
      return { clear: at(2, 2.2, -12.5), wall: at(-4, 1.6, -4), far: at(2, 2.2, 12) };
    });
    // a new incident that becomes ALERT: the caption goes at once
    await page.evaluate(() => { const g = MV.guard; g.reset(); MV.caption.hide(); MV.motor.teleport(-12, -18, 0); MV.cam.snap(MV.motor); window.__cap.length = 0; });
    await page.waitForTimeout(200);
    await page.evaluate(() => MV.noise.emit(2, 'footstep', new THREE.Vector3(MV.guard.position.x + 3, 0, MV.guard.position.z), 'concrete', 'player'));
    await page.waitForFunction(() => MV.caption.active && MV.guard.awareness.reactions === 1, null, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => { const g = MV.guard, p = g.position.clone().addScaledVector(g.forward(), 1.6); MV.motor.teleport(p.x, p.z, g.yaw + Math.PI); MV.cam.snap(MV.motor); });
    await page.waitForFunction(() => MV.guard.awareness.state === 'ALERT', null, { timeout: 10000 }).catch(() => {});
    const C = await page.evaluate(() => { const L = window.__cap, i = L.findIndex(x => x.state === 'ALERT'); return { alerted: i >= 0, shownBefore: L.some(x => x.active), visibleOnAlert: i >= 0 && L.slice(i).some(x => !x.hidden && x.op > 0), dismissed: MV.caption.dismissed, why: MV.caption.why }; });
    await page.evaluate(() => { MV.guard.reset(); MV.caption.hide(); });
    const ok = A.shown === 1 && A.reactions === 1 && A.restarts === 0 && A.text === 'Huh' && Math.abs(A.span - A.total) < 0.2 && Math.abs(A.full - A.hold) < 0.15 && A.fs <= 14 && A.h < 24 && A.anchor < 12 && A.endHidden
      && B.clear.w === 'showing' && !B.clear.hid && B.wall.w === 'behind cover' && B.wall.hid && B.far.w === 'too far' && B.far.hid
      && C.alerted && C.shownBefore && !C.visibleOnAlert && C.dismissed >= 1 && page.errors.length === 0;
    return { pass: ok, detail: `10 footsteps, one incident: shown ${A.shown}× ("${A.text}", ${A.fs}px, ${A.h.toFixed(0)}px tall), ${A.reactions} vocal reaction, restarted ${A.restarts}×; on screen ${A.span.toFixed(2)} s of ${A.total.toFixed(2)} (fully shown ${A.full.toFixed(2)} s of ${A.hold}, then faded), within ${A.anchor.toFixed(1)} px of the point above his head, gone afterwards ${A.endHidden}; clear view: ${B.clear.w}; behind the tall crate: ${B.wall.w}; from 30 m: ${B.far.w}; a new incident turned ALERT: caption on screen after the alert ${C.visibleOnAlert} (${C.why}); page errors ${page.errors.length}` };
  },

  // Step 8.2, glimpse: she sneaks 9 m away 45° off his facing (his slower peripheral zone).
  // His first partial sighting opens an incident: a brief pause, then one "huh" (caption
  // shown once however many times he looks), his head then his body turn toward where he
  // saw her and the cone follows (she ends up in a faster zone); the meter never drops
  // while she's in view. She slips away before 100%: he faces the last place he actually
  // saw her, keeps his suspicion and stays wary (no ALERT, no reset)
  async glimpseReact() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, v = g.vision, T = MV.seeTarget, dt = 1 / 60, c = a.cfg, cap = MV.caption;
      const wrapD = x => Math.abs(Math.atan2(Math.sin(x), Math.cos(x))) * 57.3;
      g.reset(); cap.hide(); const cap0 = cap.shown;
      const off = Math.PI / 4, D = 9, P = new THREE.Vector3(g.position.x + Math.sin(off) * D, 0, g.position.z + Math.cos(off) * D), ux = Math.sin(off), uz = Math.cos(off);
      motor.teleport(P.x, P.z, off + Math.PI);
      let f = 0, firstZone = null, firstSeenF = null, incF = null, reactF = null, headF = null, bodyF = null, looks = 0, drops = 0, lastMeter = 0, yaw0 = g.yaw, lastAcc = v.acc;
      const sim = dir => { step(0.22, 'stand', dir * ux, dir * uz); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); cap.update(dt, MV.camera, 640, 300); f++;
        if (v.acc === 0) looks++;
        const seen = v.seen.rate > 0;
        if (seen && firstSeenF == null) { firstSeenF = f; firstZone = v.seen.zone; }
        if (seen && v.meter < lastMeter - 1e-9) drops++; lastMeter = v.meter;
        if (incF == null && a.incident) incF = f;
        if (reactF == null && a.reactions > 0) reactF = f;
        if (headF == null && Math.abs(g.headYaw) > 0.01) headF = f;
        if (bodyF == null && wrapD(g.yaw - yaw0) > 0.5) bodyF = f; };
      // sneaking back and forth along his line of sight (so the angle stays 45°) until he's turned toward her
      let n = 0; while (n < 8 * 60 && !(bodyF != null && wrapD(g.yaw - Math.atan2(motor.position.x - g.position.x, motor.position.z - g.position.z)) < 12) && v.meter < 0.85) { sim(Math.floor(n / 30) % 2 ? 1 : -1); n++; }
      const zoneAfterTurn = v.seen.zone, meterAtHide = v.meter, incKind = a.incident && a.incident.kind, lastSeen = a.seen.position.clone();
      // she slips away out of sight, silently
      motor.teleport(-17, 15, 0);
      for (let k = 0; k < 120; k++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); }
      const faceLast = wrapD(g.yaw - Math.atan2(lastSeen.x - g.position.x, lastSeen.z - g.position.z)), focusErr = a.focus ? a.focus.position.distanceTo(lastSeen) : 99;
      const stateAfter = a.state, suspAfter = a.suspicion, conf = a.confirmed;
      for (let k = 0; k < 120; k++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); }
      return { firstZone, firstSeenF, incF, incKind, reactF, headF, bodyF, looks, drops, zoneAfterTurn, meterAtHide, reactions: a.reactions, captions: cap.shown - cap0, delay: c.visualReactDelay,
        faceLast, focusErr, stateAfter, suspAfter, conf, susp4: a.suspicion, state4: a.state, suspAt: c.suspiciousAt };
    });
    const ms = x => (x / 60).toFixed(2) + ' s';
    const ok = r.firstZone === 'slower' && r.incKind === 'seen' && r.reactions === 1 && r.captions === 1 && r.looks >= 10
      && r.reactF != null && Math.abs((r.reactF - r.incF) / 60 - r.delay) < 0.03 && r.headF >= r.reactF && r.bodyF >= r.reactF
      && r.drops === 0 && (r.zoneAfterTurn === 'fastest' || r.zoneAfterTurn === 'normal') && r.meterAtHide < 1
      && r.faceLast < 5 && r.focusErr < 0.01 && !r.conf && r.stateAfter !== 'NORMAL' && r.suspAfter >= r.suspAt && r.state4 !== 'NORMAL' && r.state4 !== 'ALERT';
    return { pass: ok, detail: `first seen in his ${r.firstZone} zone at ${ms(r.firstSeenF)}; incident (${r.incKind}) at ${ms(r.incF)}, one "huh" ${((r.reactF - r.incF) / 60).toFixed(2)} s later (pause ${r.delay}), captions ${r.captions}, over ${r.looks} vision looks; head turned at ${ms(r.headF)}, body at ${ms(r.bodyF)}; meter drops while in view ${r.drops}; after the turn she was in his ${r.zoneAfterTurn} zone, meter ${(r.meterAtHide * 100).toFixed(0)}% when she slipped away; then he faced the last place he saw her within ${r.faceLast.toFixed(1)}° (focus ${r.focusErr.toFixed(2)} m from it), ${r.stateAfter} with ${(r.suspAfter * 100).toFixed(0)}% suspicion, confirmed ${r.conf}; 2 s later ${r.state4} ${(r.susp4 * 100).toFixed(0)}%` };
  },

  // Step 8.2, shared and priority: a footstep's "huh", then a glimpse in the same incident:
  // no second reaction (and the reverse: glimpse first, then footsteps). A glimpse that
  // she lets turn into full recognition: ALERT on the very frame the meter reaches 100%
  // and the caption is dismissed at once
  async glimpseShared() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, v = g.vision, T = MV.seeTarget, dt = 1 / 60, cap = MV.caption;
      const sim = (n, m, x, z) => { for (let i = 0; i < n; i++) { step(m || 0, 'stand', x, z); MV.footsteps.update(dt); noise.update(dt); g.update(dt, T); cap.update(dt, MV.camera, 640, 300); } };
      const off = Math.PI / 4, ux = Math.sin(off), uz = Math.cos(off);
      const peripheral = D => { motor.teleport(g.position.x + ux * D, g.position.z + uz * D, off + Math.PI); };
      const glimpse = frames => { for (let i = 0; i < frames; i++) sim(1, 0.22, (Math.floor(i / 30) % 2 ? 1 : -1) * ux, (Math.floor(i / 30) % 2 ? 1 : -1) * uz); };
      const out = {};
      // sound first, then a glimpse
      g.reset(); cap.hide(); motor.teleport(-12, -18, 0); sim(10);
      noise.emit(1, 'footstep', new THREE.Vector3(g.position.x + 1.4, 0, g.position.z - 1), 'concrete', 'player'); sim(60);
      out.a1 = a.reactions; const c0 = cap.shown;
      peripheral(9); glimpse(90); out.aSeen = a.seen != null;
      out.a2 = a.reactions; out.aInc = a.incidents; out.aCap = cap.shown - c0;
      // glimpse first, then footsteps
      g.reset(); cap.hide(); peripheral(9); glimpse(90); out.b1 = a.reactions; const c1 = cap.shown;
      motor.teleport(-17, 15, 0); sim(10);
      for (let k = 0; k < 5; k++) { noise.emit(2, 'footstep', new THREE.Vector3(g.position.x - 2, 0, g.position.z + 2 + k * 0.2), 'concrete', 'player'); sim(30); }
      out.b2 = a.reactions; out.bInc = a.incidents; out.bCap = cap.shown - c1;
      // a glimpse she lets become full recognition
      g.reset(); cap.hide(); peripheral(9); let meterFullF = null, alertF = null, capAfter = 0, f = 0, capDuring = false;
      while (alertF == null && f < 15 * 60) { glimpse(1); f++; if (cap.active) capDuring = true; if (meterFullF == null && v.meter >= 1) meterFullF = f; if (alertF == null && a.state === 'ALERT') alertF = f; }
      sim(1); if (cap.active || !document.getElementById('mv-caption').hidden) capAfter++;
      out.c = { reactions: a.reactions, meterFullF, alertF, capDuring, capAfter, why: cap.why };
      return out;
    });
    const C = r.c;
    const ok = r.a1 === 1 && r.aSeen && r.a2 === 1 && r.aInc === 1 && r.aCap === 0 && r.b1 === 1 && r.b2 === 1 && r.bInc === 1 && r.bCap === 0
      && C.meterFullF != null && C.alertF === C.meterFullF && C.reactions === 1 && C.capDuring && C.capAfter === 0;
    return { pass: ok, detail: `footstep then glimpse: reactions ${r.a1} → ${r.a2}, incidents ${r.aInc}, extra captions ${r.aCap}; glimpse then footsteps: ${r.b1} → ${r.b2}, incidents ${r.bInc}, extra captions ${r.bCap}; glimpse to full recognition: "huh" ${C.reactions}, meter 100% on frame ${C.meterFullF}, ALERT on frame ${C.alertF}, caption shown before ${C.capDuring}, after ALERT ${C.capAfter ? 'still showing' : 'dismissed'} (${C.why})` };
  },

  // Step 8 timing (0.8 s): for a sound and for a peripheral glimpse, he holds still (no head
  // or body turn) for the configured pause, says "huh" once at it, then his head and body
  // start turning straight away. Suspicion (more footsteps) and his vision meter keep
  // building during the pause, which those extra steps and looks never restart. He walks
  // off to investigate as soon as pause + assessTime allows (no extra delay). A recognition
  // reached during the pause is ALERT on that frame, with no "huh"
  async reactTiming() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, v = g.vision, T = MV.seeTarget, dt = 1 / 60, c = a.cfg;
      const wrapD = x => Math.abs(Math.atan2(Math.sin(x), Math.cos(x))) * 57.3;
      const watch = (frames, each) => {
        const yaw0 = g.yaw, t0 = a.clock, o = { reactT: null, headT: null, bodyT: null, moveT: null, reactAts: new Set(), susp: [], meter: [] };
        for (let f = 0; f < frames; f++) {
          each(f); const t = a.clock - t0;
          if (a.incident) o.reactAts.add(a.incident.reactAt.toFixed(4));
          if (o.reactT == null && a.reactions > 0) o.reactT = t;
          if (o.headT == null && Math.abs(g.headYaw) > 0.01) o.headT = t;
          if (o.bodyT == null && wrapD(g.yaw - yaw0) > 0.5) o.bodyT = t;
          if (o.moveT == null && g.moving && Math.abs(g.motor.speed) > 0.05) o.moveT = t;
          o.susp.push(a.suspicion); o.meter.push(v.meter);
        }
        o.reactAts = o.reactAts.size; return o;
      };
      const out = {};
      // a sound: three jog steps behind-right (enough to investigate), then more steps during the pause
      g.reset(); motor.teleport(-12, -18, 0); for (let f = 0; f < 30; f++) step(0, 'stand');
      const P = new THREE.Vector3(g.position.x + 2.8, 0, g.position.z - 2.8);
      noise.emit(2, 'footstep', P, 'concrete', 'player');
      out.sound = watch(4 * 60, f => {
        if (f === 12 || f === 24 || f === 36) noise.emit(2, 'footstep', P.clone().add(new THREE.Vector3(0.2 * f / 12, 0, 0)), 'concrete', 'player');
        step(0, 'stand'); noise.update(dt); g.update(dt, T);
      });
      const S = out.sound; S.suspRise = S.susp[40] > S.susp[0] + 0.01;
      // a glimpse: sneaking 9 m away, 45° off his facing (peripheral)
      g.reset(); const off = Math.PI / 4, ux = Math.sin(off), uz = Math.cos(off);
      motor.teleport(g.position.x + ux * 9, g.position.z + uz * 9, off + Math.PI);
      let incAt = null;
      out.glimpse = watch(4 * 60, f => { const d = Math.floor(f / 30) % 2 ? 1 : -1; step(0.22, 'stand', d * ux, d * uz); noise.update(dt); g.update(dt, T); if (incAt == null && a.incident) incAt = a.clock; });
      const G = out.glimpse; G.incAt = incAt; G.reactFromInc = G.reactT == null || incAt == null ? null : G.reactT - (incAt - (a.clock - 4 * 60 * dt + dt));
      // meter during the glimpse's pause: it rose (never reset)
      const i0 = Math.round((incAt - (a.clock - 4 * 60 * dt + dt)) / dt), i1 = Math.min(G.meter.length - 1, i0 + Math.round(c.visualReactDelay / dt) - 1);
      G.meterPause = [G.meter[i0], G.meter[i1]]; let drops = 0; for (let i = i0 + 1; i <= i1; i++) if (G.meter[i] < G.meter[i - 1] - 1e-9) drops++; G.drops = drops;
      // a glimpse that's recognised during its pause: ALERT on the frame the meter fills, no "huh"
      g.reset(); motor.teleport(g.position.x + ux * 1.9, g.position.z + uz * 1.9, off + Math.PI);   // inside his close range
      let fullF = null, alertF = null, f2 = 0, inc2 = null;
      while (alertF == null && f2 < 600) { step(0, 'stand'); noise.update(dt); g.update(dt, T); f2++; if (inc2 == null && a.incident) inc2 = f2; if (fullF == null && v.meter >= 1) fullF = f2; if (a.state === 'ALERT') alertF = f2; }
      out.recog = { fullF, alertF, inc2, reactions: a.reactions, pauseFrames: Math.round(c.visualReactDelay / dt) };
      out.cfg = { react: c.reactDelay, visual: c.visualReactDelay, assess: c.assessTime, hold: MV.caption.cfg.hold };
      return out;
    });
    const S = r.sound, G = r.glimpse, R = r.recog, C = r.cfg, near = (x, y, e) => x != null && Math.abs(x - y) <= e;
    const okSound = near(S.reactT, C.react, 0.03) && S.headT >= C.react - 0.02 && S.bodyT >= C.react - 0.02 && S.bodyT <= C.react + 0.15 && S.reactAts === 1 && S.suspRise
      && near(S.moveT, C.react + C.assess, 0.1);
    const okGlimpse = near(G.reactFromInc, C.visual, 0.03) && G.headT >= G.reactT - 0.02 && G.bodyT >= G.reactT - 0.02 && G.bodyT <= G.reactT + 0.15 && G.reactAts === 1 && G.meterPause[1] > G.meterPause[0] && G.drops === 0;
    const okRecog = R.fullF != null && R.alertF === R.fullF && R.inc2 != null && R.fullF - R.inc2 < R.pauseFrames && R.reactions === 0;
    const ok = C.react === 0.8 && C.visual === 0.8 && C.hold === 1.2 && okSound && okGlimpse && okRecog;
    const f2 = x => x == null ? 'never' : x.toFixed(2) + ' s';
    return { pass: ok, detail: `settings: sound pause ${C.react} s, glimpse pause ${C.visual} s, assess ${C.assess} s, caption hold ${C.hold} s. Sound: "huh" at ${f2(S.reactT)}, head ${f2(S.headT)}, body ${f2(S.bodyT)}, reaction time set ${S.reactAts}× despite 3 more steps in the pause (suspicion rose: ${S.suspRise}), first investigation step ${f2(S.moveT)} (pause + assess ${(C.react + C.assess).toFixed(1)} s). Glimpse (from when he noticed): "huh" ${f2(G.reactFromInc)}, head ${f2(G.headT - G.reactT + G.reactFromInc)}, body ${f2(G.bodyT - G.reactT + G.reactFromInc)}, set ${G.reactAts}×, meter ${(G.meterPause[0] * 100).toFixed(0)}% → ${(G.meterPause[1] * 100).toFixed(0)}% during the pause (drops ${G.drops}). Recognised ${R.fullF == null ? '-' : ((R.fullF - R.inc2) / 60).toFixed(2) + ' s'} into the pause: ALERT on frame ${R.alertF} (meter full on ${R.fullF}), "huh" ${R.reactions}` };
  },

  // Step 9, 1–4, 12, 13: two laps of the patrol with the player standing at her spawn. He
  // visits the waypoints in order; at observation points he slows, stops for a while and
  // looks around (varying from lap to lap), at the pass-through point he walks straight on;
  // a relaxed walk (never a jog), no obstacle overlap, no teleport or snap, legs moving
  // and planted feet holding while he walks, hips aligned with his vision facing; he never
  // sees or senses the player at the spawn
  async patrolRoute() {
    const page = await patrolPage();
    const r = await page.evaluate(() => {
      const { motor, noise, world, area } = MV, g = MV.guard, a = g.awareness, p = g.patrol, T = MV.seeTarget, dt = 1 / 60, R = g.cfg.radius, B = g.bones, pts = p.cfg.points;
      const intrusion = () => { let w = 0; for (const b of world.boxes) { const dx = Math.max(b.minX - g.position.x, 0, g.position.x - b.maxX), dz = Math.max(b.minZ - g.position.z, 0, g.position.z - b.maxZ); w = Math.max(w, R - Math.hypot(dx, dz)); } for (const c of world.cylinders) if (!c.noSight) w = Math.max(w, c.r + R - Math.hypot(g.position.x - c.x, g.position.z - c.z)); return w; };
      const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
      motor.teleport(area.spawn.x, area.spawn.z, area.spawn.yaw); g.reset();
      const order = [], obs = [], prevQ = {}, lastA = {}; let lastKey = '', cur = null, worst = 0, maxSp = 0, maxStep = 0, maxYaw = 0, pops = 0, meter = 0, sensed = 0, states = new Set();
      let lp = g.position.clone(), ly = g.yaw, passMin = Infinity, nearObsSpeed = [], cruise = [], slips = [], legSwing = { min: 9, max: -9 }, hipOff = 0;
      const foot = {}; for (const s of ['left', 'right']) foot[s] = { prev: null };
      for (let f = 0; f < 112 * 60; f++) {
        step(0, 'stand'); noise.update(dt); g.update(dt, T);
        const key = p.state + p.index;
        if (p.state === 'walking' && order[order.length - 1] !== p.index) order.push(p.index);
        if (key !== lastKey) { if (cur) { cur.t = a.clock - cur.start; obs.push(cur); cur = null; } if (p.state === 'observing') cur = { i: p.index, start: a.clock, yawMin: 9, yawMax: -9, base: (pts[p.index].face || 0) * Math.PI / 180 }; lastKey = key; }
        if (cur && g.isStill()) { const y = wrap(g.yaw - cur.base); cur.yawMin = Math.min(cur.yawMin, y); cur.yawMax = Math.max(cur.yawMax, y); }
        worst = Math.max(worst, intrusion()); const sp = Math.abs(g.motor.speed); maxSp = Math.max(maxSp, sp);
        maxStep = Math.max(maxStep, g.position.distanceTo(lp)); maxYaw = Math.max(maxYaw, Math.abs(wrap(g.yaw - ly))); lp.copy(g.position); ly = g.yaw;
        meter = Math.max(meter, g.vision.meter); if (a.seen || a.heard || a.focus) sensed++; states.add(a.state);
        const w3 = pts[3]; const d3 = Math.hypot(g.position.x - w3.x, g.position.z - w3.z); if (d3 < 1.5) passMin = Math.min(passMin, sp);
        for (const i of [1, 2]) { const q = pts[i], d = Math.hypot(g.position.x - q.x, g.position.z - q.z); if (p.state === 'walking' && p.index === i && d < 1.2 && d > 0.6) nearObsSpeed.push(sp); }
        if (p.state === 'walking' && sp > 0.9) {
          cruise.push(sp);
          // planted feet: the lower foot's ground speed while it's on the ground
          for (const s of ['left', 'right']) { const v = B[s + 'Foot'].getWorldPosition(new THREE.Vector3()); const F = foot[s]; if (F.prev && v.y < 0.13) slips.push(Math.hypot(v.x - F.prev.x, v.z - F.prev.z) / dt); F.prev = v; }
          // thigh pitch (hip → knee, in his own frame): the legs really swing
          const ri = g.root.getWorldQuaternion(new THREE.Quaternion()).invert(), th = B.leftLeg.getWorldPosition(new THREE.Vector3()).sub(B.leftUpLeg.getWorldPosition(new THREE.Vector3())).applyQuaternion(ri), pitch = Math.atan2(th.z, -th.y); legSwing.min = Math.min(legSwing.min, pitch); legSwing.max = Math.max(legSwing.max, pitch);
          const l = B.leftUpLeg.getWorldPosition(new THREE.Vector3()), rr = B.rightUpLeg.getWorldPosition(new THREE.Vector3()), side = l.sub(rr), hf = Math.atan2(-side.z, side.x); hipOff = Math.max(hipOff, Math.min(Math.abs(wrap(hf - g.yaw)), Math.abs(wrap(hf + Math.PI - g.yaw))) * 57.3);
        } else for (const s of ['left', 'right']) foot[s].prev = null;
        const ri = g.root.getWorldQuaternion(new THREE.Quaternion()).invert();
        for (const nm of ['spine1', 'chest', 'neck', 'head', 'leftArm', 'rightArm', 'leftUpLeg', 'rightUpLeg', 'leftLeg', 'rightLeg']) { const q = ri.clone().multiply(B[nm].getWorldQuaternion(new THREE.Quaternion())); if (prevQ[nm]) { const ang = 2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ[nm])))) * 57.3, leg = nm.endsWith('Leg'); if (leg ? (ang > 12 && ang > 2 * (lastA[nm] || 0)) : ang > 9) pops++; lastA[nm] = ang; } prevQ[nm] = q; }
      }
      slips.sort((x, y) => x - y);
      const mean = v => v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
      return { order: order.join(''), obs: obs.map(o => ({ i: o.i, t: o.t, span: (o.yawMax - o.yawMin) * 57.3 })), pause: pts.map(q => q.pause || null), worst, maxSp, maxStep, maxYaw: maxYaw / dt, turnRate: g.cfg.turn.maxRate, pops, meter, sensed, states: [...states],
        passMin, nearObs: mean(nearObsSpeed), cruise: mean(cruise), slipMed: slips[Math.floor(slips.length / 2)] || 0, slipP90: slips[Math.floor(slips.length * 0.9)] || 0, legSwing: (legSwing.max - legSwing.min) * 57.3, hipOff, laps: p.legs };
    });
    // observation pauses: each at least its minimum, never far past its maximum (turning time on top)
    const obsOk = r.obs.filter(o => r.pause[o.i]).every(o => o.t >= r.pause[o.i][0] - 0.05 && o.t <= r.pause[o.i][1] + 4.5 && o.span >= 40);
    const byPoint = i => r.obs.filter(o => o.i === i).map(o => o.t.toFixed(2));
    const varied = [0, 1, 2].some(i => new Set(byPoint(i)).size > 1);
    const ok = r.order.startsWith('1230123') && obsOk && r.obs.length >= 6 && varied && r.passMin > 0.6 && r.nearObs < r.cruise * 0.9
      && r.maxSp <= 1.3 && r.worst < 0.02 && r.maxStep < 0.03 && r.maxYaw <= r.turnRate + 0.05 && r.pops === 0 && r.legSwing > 20 && r.legSwing < 120 && r.slipMed <= 0.4 && r.hipOff < 30
      && r.meter === 0 && r.sensed === 0 && r.states.length === 1 && r.states[0] === 'NORMAL';
    return { pass: ok, detail: `legs walked in order ${r.order}; ${r.obs.length} observation stops (${r.obs.map(o => 'W' + o.i + ' ' + o.t.toFixed(1) + ' s/' + o.span.toFixed(0) + '°').join(', ')}), varying lap to lap ${varied}; through the pass-through point at ≥ ${r.passMin.toFixed(2)} m/s; ${r.nearObs.toFixed(2)} m/s near an observation point vs ${r.cruise.toFixed(2)} cruising (max ${r.maxSp.toFixed(2)}); obstacle overlap ${(Math.max(0, r.worst) * 100).toFixed(1)} cm; per-frame move ≤ ${(r.maxStep * 100).toFixed(1)} cm, turn ≤ ${r.maxYaw.toFixed(2)} rad/s; joint pops ${r.pops}; thigh swing ${r.legSwing.toFixed(0)}°, planted-foot speed median ${r.slipMed.toFixed(2)} m/s (90th pct ${r.slipP90.toFixed(2)}); hips ≤ ${r.hipOff.toFixed(0)}° from his vision facing; player at the spawn: meter peak ${r.meter}, sensed ${r.sensed} frames, states ${r.states.join('/')}` };
  },

  // Step 9, 5, 6, 10, 11, 12: footsteps behind him as he walks his route. The patrol gives
  // way (he stops), the 0.8 s pause and one "huh" for six steps, he investigates his estimate
  // of the sound (never where she really is). Walking back to his route (the waypoint he was
  // heading for), a new sound interrupts that walk; after that one he returns, stands down
  // and carries on his route from that waypoint (no teleport, never restarting at W0)
  async patrolSound() {
    const page = await patrolPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, p = g.patrol, T = MV.seeTarget, dt = 1 / 60;
      let maxStep = 0, lp = g.position.clone();
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); maxStep = Math.max(maxStep, g.position.distanceTo(lp)); lp.copy(g.position); } };
      motor.teleport(-17, 15, 0);                                    // she's hidden far away throughout
      let t = 0; while (!(p.state === 'walking' && p.index === 1 && Math.hypot(g.position.x - 2, g.position.z + 16) > 4) && t < 30) { sim(1); t += dt; }
      const at = g.position.clone(), behind = at.clone().addScaledVector(g.forward(), -3);
      for (let k = 0; k < 6; k++) { noise.emit(2, 'footstep', behind.clone().add(new THREE.Vector3(0.15 * k, 0, 0)), 'concrete', 'player'); sim(20); }
      const out = { interrupted: p.state === 'interrupted', resumeAt: p.resumeIndex, why: p.why, reactions: a.reactions };
      let f = 0; while (a.state !== 'INVESTIGATING' && f < 600) { sim(1); f++; }
      out.inv = a.state; out.focusErr = a.focus ? a.focus.position.distanceTo(behind) : 99; out.focusToHer = a.focus ? a.focus.position.distanceTo(motor.position) : 0;
      // the walk back to his route
      f = 0; while (!(a.state === 'INVESTIGATING' && a.behavior === 'return' && g.moving) && f < 60 * 60) { sim(1); f++; }
      out.returning = a.behavior === 'return'; out.returnTo = g.goal ? Math.hypot(g.goal.x - p.cfg.points[1].x, g.goal.z - p.cfg.points[1].z) : 99;
      sim(60);
      const S = g.position.clone().add(new THREE.Vector3(4, 0, 2)); noise.emit(3, 'footstep', S, 'metal', 'player'); sim(2);
      f = 0; while (a.behavior !== 'approach' && f < 120) { sim(1); f++; }
      out.reInterrupt = a.behavior === 'approach'; out.reFocus = a.focus ? a.focus.position.distanceTo(S) : 99; out.reactions2 = a.reactions;
      // eventually: back on the route, carrying on from W1 → W2
      const seq = []; f = 0;
      while (!(p.state === 'walking' && p.index === 2) && f < 120 * 60) { sim(1); f++; const k = a.state + '/' + p.state; if (seq[seq.length - 1] !== k) seq.push(k); }
      out.seq = seq.join(' → '); out.resumed = p.state === 'walking' && p.index === 2; out.resumes = p.resumes; out.maxStep = maxStep; out.sawHer = !!a.seen;
      return out;
    });
    const ok = r.interrupted && r.resumeAt === 1 && r.reactions === 1 && r.inv === 'INVESTIGATING' && r.focusErr < 0.5 && r.focusToHer > 10
      && r.returning && r.returnTo < 0.01 && r.reInterrupt && r.reFocus < 0.01 && r.reactions2 === 1 && r.resumed && r.resumes >= 1 && r.maxStep < 0.03 && !r.sawHer;
    return { pass: ok, detail: `6 footsteps behind him on the W0→W1 leg: patrol interrupted ${r.interrupted} ("${r.why}", resumes at W${r.resumeAt}), "huh" ×${r.reactions}; ${r.inv} toward ${r.focusErr.toFixed(2)} m from the sound (${r.focusToHer.toFixed(0)} m from her); walking back to his route: ${r.returning} (to W1: ${r.returnTo.toFixed(2)} m); a metal step then interrupted that walk: ${r.reInterrupt} (target ${r.reFocus.toFixed(2)} m from it), "huh" still ×${r.reactions2}; then ${r.seq}; resumed his route W1 → W2 ${r.resumed}; largest per-frame move ${(r.maxStep * 100).toFixed(1)} cm; ever saw her ${r.sawHer}` };
  },

  // Step 9, 7, 8, 9, 10: sight while he patrols. A peripheral glimpse: the patrol gives way,
  // one "huh", and his vision meter never drops through his stop and turn. Then plain view:
  // ALERT on the frame the meter fills, he stops walking. She hides: EVASION (30 s),
  // HEIGHTENED SECURITY (60 s), the walk back to his post and stand-down, then he rejoins
  // his route by nav at the waypoint he was heading for and walks on
  async patrolSight() {
    const page = await patrolPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, p = g.patrol, v = g.vision, T = MV.seeTarget, dt = 1 / 60;
      let maxStep = 0, lp = g.position.clone();
      const sim = (n, m, x, z) => { for (let i = 0; i < n; i++) { step(m || 0, 'stand', x, z); noise.update(dt); g.update(dt, T); maxStep = Math.max(maxStep, g.position.distanceTo(lp)); lp.copy(g.position); } };
      motor.teleport(-17, 15, 0);
      let t = 0; while (!(p.state === 'walking' && p.index === 1 && Math.hypot(g.position.x - 2, g.position.z + 16) > 4) && t < 30) { sim(1); t += dt; }
      // she sneaks alongside him, 9 m away and 45° to his left (his slower peripheral zone)
      const off = g.yaw - Math.PI / 4, hx = Math.sin(g.yaw), hz = Math.cos(g.yaw);
      motor.teleport(g.position.x + Math.sin(off) * 9, g.position.z + Math.cos(off) * 9, g.yaw);
      let drops = 0, last = 0, f = 0, interruptedF = null, stillF = null, zone0 = null;
      while (f < 240 && !(a.reactions === 1 && g.isStill() && f > 100)) { sim(1, p.state === 'interrupted' ? 0 : 0.22, hx, hz); f++; if (zone0 == null && v.seen.rate > 0) zone0 = v.seen.zone; if (v.seen.rate > 0 && v.meter < last - 1e-9) drops++; last = v.meter; if (interruptedF == null && p.state === 'interrupted') interruptedF = f; if (stillF == null && interruptedF != null && g.isStill()) stillF = f; }
      const glimpse = { zone0, interrupted: p.state === 'interrupted', why: p.why, reactions: a.reactions, drops, meter: v.meter, state: a.state, stopped: stillF != null };
      // plain view close in front of him
      const fw = g.forward(), q = g.position.clone().addScaledVector(fw, 3); motor.teleport(q.x, q.z, g.yaw + Math.PI);
      let fullF = null, alertF = null; f = 0;
      while (alertF == null && f < 300) { sim(1); f++; if (fullF == null && v.meter >= 1) fullF = f; if (a.state === 'ALERT') alertF = f; }
      sim(30); const alert = { fullF, alertF, moving: g.moving, patrol: p.state, why: p.why };
      // she hides: the whole cycle, then back on his route
      motor.teleport(-17, 15, 0);
      const seq = [a.state], times = {}; t = 0; let rejoinStart = null;
      while (t < 200 && !(p.state === 'walking' && p.resumes >= 1 && !p.rejoining && p.legs > 2)) {
        sim(1); t += dt; if (seq[seq.length - 1] !== a.state) { seq.push(a.state); times[a.state] = a.clock; }
        if (rejoinStart == null && p.rejoining) rejoinStart = { at: g.position.clone(), to: p.index };
      }
      return { glimpse, alert, seq: seq.join(' → '), ev: (times.HEIGHTENED || 0) - (times.EVASION || 0), hs: (times.RETURNING || 0) - (times.HEIGHTENED || 0), standDowns: a.standDowns,
        rejoin: rejoinStart ? { from: Math.hypot(rejoinStart.at.x - g.post.x, rejoinStart.at.z - g.post.z), to: rejoinStart.to } : null, now: p.index, state: p.state, maxStep };
    });
    const G = r.glimpse, A = r.alert;
    const ok = G.zone0 === 'slower' && G.interrupted && G.reactions === 1 && G.drops === 0 && G.meter > 0 && G.meter < 1 && G.state !== 'ALERT' && G.stopped
      && A.fullF != null && A.alertF === A.fullF && !A.moving && A.patrol === 'interrupted'
      && /^ALERT → EVASION → HEIGHTENED → RETURNING → NORMAL$/.test(r.seq) && Math.abs(r.ev - 30) < 1 && Math.abs(r.hs - 60) < 0.5 && r.standDowns === 1
      && r.rejoin && r.rejoin.from < 0.6 && r.rejoin.to === 1 && r.state === 'walking' && r.maxStep < 0.06;
    return { pass: ok, detail: `peripheral glimpse (his ${G.zone0} zone) while walking: patrol interrupted ${G.interrupted} ("${G.why}"), he stopped ${G.stopped}, "huh" ×${G.reactions}, meter drops ${G.drops} (now ${(G.meter * 100).toFixed(0)}%, ${G.state}); plain view: meter full on frame ${A.fullF}, ALERT on ${A.alertF}, still walking ${A.moving}, patrol ${A.patrol}; she hid: ${r.seq} (search ${r.ev.toFixed(1)} s, Heightened Security ${r.hs.toFixed(1)} s, stand-downs ${r.standDowns}); rejoined his route from ${r.rejoin ? r.rejoin.from.toFixed(2) + ' m from his post toward W' + r.rejoin.to : 'never'}, now ${r.state} to W${r.now}; largest per-frame move ${(r.maxStep * 100).toFixed(1)} cm` };
  },

  // Step 9, 13, 14, 15 on an iPhone-landscape screen (real touches, frame loop running):
  // she starts at the spawn unseen while he patrols; she's moved 3 m behind him and
  // jogs with the stick: he hears, the patrol gives way, one "huh". RESET (tapped): she's
  // at the spawn, he's at his post facing it, NORMAL, memory clear, and his patrol is back
  // at its clean start (observing W0, nothing walked); then he sets off on the route again
  async patrolTouch() {
    const page = await patrolPage(true), Tc = page.touch;
    await page.evaluate(() => { MV.motor.teleport(MV.area.spawn.x, MV.area.spawn.z, MV.area.spawn.yaw); MV.cam.snap(MV.motor); MV.guard.reset(); window.__pm = 0; (function f() { window.__pm = Math.max(window.__pm, MV.guard.vision.meter); if (!window.__stopPm) requestAnimationFrame(f); })(); });
    await page.waitForFunction(() => MV.guard.patrol.state === 'walking' && MV.guard.patrol.index === 1 && Math.hypot(MV.guard.position.x - 2, MV.guard.position.z + 16) > 3, null, { timeout: 60000 }).catch(() => {});
    const spawnMeter = await page.evaluate(() => { window.__stopPm = true; return window.__pm; });
    await page.evaluate(() => { const g = MV.guard, b = g.position.clone().addScaledVector(g.forward(), -3); MV.motor.teleport(b.x, b.z, g.yaw + Math.PI); MV.cam.snap(MV.motor); });
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 150, y: 236, id: 1 }]); await page.waitForTimeout(900); await Tc('touchEnd', []);
    await page.waitForFunction(() => MV.guard.awareness.reactions >= 1, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => ({ patrol: MV.guard.patrol.state, reactions: MV.guard.awareness.reactions, state: MV.guard.awareness.state, heard: MV.guard.hearing.heardCount }));
    await page.tap('#mv-reset'); await page.waitForTimeout(150);
    const snap = () => page.evaluate(() => { const g = MV.guard, a = g.awareness, p = g.patrol, S = MV.area.spawn, wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
      return { her: Math.hypot(MV.motor.position.x - S.x, MV.motor.position.z - S.z), post: Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z), yaw: Math.abs(wrap(g.yaw - g.postYaw)) * 57.3, state: a.state, left: [a.evasion, a.hs, a.search, a.focus, a.seen, a.heard, a.incident].filter(x => x != null).length, susp: a.suspicion,
        patrol: p.state, index: p.index, legs: p.legs, interrupts: p.interrupts, resumes: p.resumes, meter: g.vision.meter }; });
    const A = await snap();
    await page.waitForFunction(() => MV.guard.patrol.state === 'walking' && MV.guard.patrol.index === 1, null, { timeout: 30000 }).catch(() => {});
    const B = await snap();
    const ok = spawnMeter === 0 && before.patrol === 'interrupted' && before.reactions === 1 && A.her < 0.01 && A.post < 0.01 && A.yaw < 0.5 && A.state === 'NORMAL' && A.left === 0 && A.susp === 0
      && A.patrol === 'observing' && A.index === 0 && A.legs === 0 && A.interrupts === 0 && A.meter === 0 && B.patrol === 'walking' && B.index === 1 && B.meter === 0 && page.errors.length === 0;
    return { pass: ok, detail: `she waited at the spawn while he set off: meter peak ${spawnMeter}; jogging 3 m behind him (real touches): patrol ${before.patrol}, "huh" ×${before.reactions}, ${before.state}; after RESET: her ${A.her.toFixed(2)} m from the spawn, him ${A.post.toFixed(2)} m / ${A.yaw.toFixed(1)}° from his post, ${A.state}, leftover memory ${A.left}, patrol ${A.patrol} at W${A.index} (legs ${A.legs}, interrupts ${A.interrupts}); then he set off: ${B.patrol} to W${B.index}, meter ${B.meter}; page errors ${page.errors.length}` };
  },

  // Step 10, 1, 2, 12: exactly one primary and one different secondary trait, from the six
  // known ones (only Curious and Bored act yet); frozen for the mission (can't be changed,
  // unchanged through a whole alert cycle and RESET); bad combinations are refused; the
  // future random assignment is seeded, role-weighted and always gives two different traits
  async personaTraits() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, P = useProfile('A'), T = MV.seeTarget, dt = 1 / 60;   // Step 10's profile
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); } };
      P.enabled = true; const t0 = JSON.stringify(P.traits);
      let frozen = true; try { P.traits.primary = 'hungry'; } catch (e) { /* strict: throws */ } if (P.traits.primary !== 'curious') frozen = false;
      a.cfg.evasionTime = 5; a.cfg.heightenedTime = 5;
      motor.teleport(2, -12, Math.PI); let t = 0; while (a.state !== 'ALERT' && t < 10) { sim(1); t += dt; }
      const duringAlert = JSON.stringify(P.traits); motor.teleport(-17, 15, 0);
      t = 0; while (a.standDowns === 0 && t < 60) { sim(1); t += dt; }
      const afterCycle = JSON.stringify(P.traits), endState = a.state + '/' + a.note, stood = a.standDowns; g.reset(); const afterReset = JSON.stringify(P.traits);
      const refuse = o => { try { new MV.SCmv.GuardPersonality(g, o); return false; } catch (e) { return true; } };
      const rolls = []; for (let s = 1; s <= 40; s++) rolls.push(MV.SCmv.rollPersonality(s, s % 2 ? 'sentry' : 'patrol'));
      const again = JSON.stringify(MV.SCmv.rollPersonality(7, 'patrol')) === JSON.stringify(MV.SCmv.rollPersonality(7, 'patrol'));
      return { endState, t0, frozen, duringAlert, afterCycle, afterReset, stood, traits: MV.SCmv.TRAITS, implemented: MV.SCmv.IMPLEMENTED_TRAITS,
        effects: Object.keys(MV.SCmv.TraitEffects).filter(k => Object.keys(MV.SCmv.TraitEffects[k]).length),
        refuseSame: refuse({ primary: 'bored', secondary: 'bored' }), refuseUnknown: refuse({ primary: 'brave', secondary: 'bored' }),
        rollsOk: rolls.every(x => x.primary !== x.secondary && MV.SCmv.TRAITS.includes(x.primary) && MV.SCmv.TRAITS.includes(x.secondary)), rollKinds: new Set(rolls.map(x => x.primary + '/' + x.secondary)).size, again };
    });
    const T0 = JSON.parse(r.t0);
    const ok = T0.primary === 'curious' && T0.secondary === 'bored' && Object.keys(T0).length === 2 && r.frozen && r.duringAlert === r.t0 && r.afterCycle === r.t0 && r.afterReset === r.t0 && r.stood === 1
      && r.traits.length === 6 && r.implemented.join() === 'curious,bored,focused,careless' && r.effects.sort().join() === 'bored,careless,curious,focused' && r.refuseSame && r.refuseUnknown && r.rollsOk && r.rollKinds >= 8 && r.again;
    return { pass: ok, detail: `traits ${r.t0} (frozen ${r.frozen}); stand-downs ${r.stood} (${r.endState}); unchanged in ALERT ${r.duringAlert === r.t0}, after a full alert cycle and stand-down ${r.afterCycle === r.t0}, after RESET ${r.afterReset === r.t0}; known traits ${r.traits.join('/')}, with behaviour: ${r.effects.join(', ')}; refuses a repeated trait ${r.refuseSame}, an unknown one ${r.refuseUnknown}; 40 seeded random assignments all two different known traits ${r.rollsOk} (${r.rollKinds} different pairs), same seed same pair ${r.again}` };
  },

  // Step 10, 3, 4, 6, 10: CURIOUS against the same guard with personality off. Hearing is
  // unchanged (the same steps heard or missed). One isolated sneak step: neither
  // investigates. Four sneak steps in one area: the neutral guard stays below his
  // investigation threshold, the curious one investigates; two steps 10 s apart still count
  // as a repeat for him; with plenty of suspicion he searches the spot one round longer;
  // a curious secondary trait does less than a curious primary; one "huh" per incident
  async personaCurious() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60, P0 = useProfile('A');   // Step 10's profile
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); } };
      const setup = mode => { g.personality = mode === 'secondary' ? new MV.SCmv.GuardPersonality(g, { primary: 'bored', secondary: 'curious' }) : P0; g.personality.enabled = mode !== 'off'; g.reset(); motor.teleport(-17, 15, 0); sim(10); };
      const steps = (n, gap, d) => { let peak = 0, inv = false, heard = 0, react = a.reactions;
        for (let k = 0; k < n; k++) { const h0 = g.hearing.heardCount; noise.emit(1, 'footstep', new THREE.Vector3(g.position.x + d * 0.7, 0, g.position.z - d * 0.7 + k * 0.2), 'concrete', 'player'); heard += g.hearing.heardCount - h0; for (let f = 0; f < gap * 60; f++) { sim(1); peak = Math.max(peak, a.suspicion); if (a.state === 'INVESTIGATING') inv = true; } }
        for (let f = 0; f < 300; f++) { sim(1); if (a.state === 'INVESTIGATING') inv = true; }
        return { peak, inv, heard, reactions: a.reactions - react }; };
      const out = {};
      for (const m of ['off', 'primary', 'secondary']) {
        setup(m); const one = steps(1, 3, 2);
        setup(m); const four = steps(4, 3, 2);
        setup(m); const far = steps(4, 3, 3.2);
        // two steps 10 s apart (outside the neutral 8 s repeat window, inside the curious 12 s)
        setup(m); noise.emit(1, 'footstep', new THREE.Vector3(g.position.x + 1.4, 0, g.position.z - 1.4), 'concrete', 'player'); const s1 = a.lastGain; sim(600); noise.emit(1, 'footstep', new THREE.Vector3(g.position.x + 1.4, 0, g.position.z - 1.4), 'concrete', 'player'); const s2 = a.lastGain;
        // a strong disturbance: how long he searches the spot
        setup(m); for (let k = 0; k < 3; k++) { noise.emit(3, 'footstep', new THREE.Vector3(g.position.x + 3, 0, g.position.z - 3), 'concrete', 'player'); sim(3); }
        let sStart = null, sEnd = null, t = 0; while (t < 60 && sEnd == null) { sim(1); t += dt; if (sStart == null && a.behavior === 'search') sStart = t; if (sStart != null && a.behavior === 'return') sEnd = t; }
        out[m] = { one, four, far, repeatRatio: s2 / s1, search: sEnd != null && sStart != null ? sEnd - sStart : null, hearInterest: g.personality.mod('hearInterest') };
      }
      g.personality = P0; P0.enabled = false; g.reset();
      return out;
    });
    const O = r.off, C = r.primary, S = r.secondary;
    const ok = !O.one.inv && !C.one.inv && !S.one.inv && O.four.heard === 4 && C.four.heard === 4 && O.far.heard === C.far.heard
      && O.four.peak < 0.6 && !O.four.inv && C.four.inv && C.four.peak > O.four.peak * 1.3
      && C.repeatRatio > 1.2 && O.repeatRatio < 1.01 && C.search > O.search + 3 && C.four.reactions === 1 && O.four.reactions === 1
      && S.hearInterest > 0 && S.hearInterest < C.hearInterest && S.four.peak > O.four.peak && S.four.peak < C.four.peak;
    const f = x => (x.peak * 100).toFixed(0) + '%' + (x.inv ? ' → investigates' : '');
    return { pass: ok, detail: `one sneak step: off ${f(O.one)}, curious ${f(C.one)}; four sneak steps in one area: off ${f(O.four)}, curious ${f(C.four)}, curious secondary ${f(S.four)} (heard ${O.four.heard}/${C.four.heard}; 3.2 m away heard ${O.far.heard}/${C.far.heard}: hearing unchanged); a step 10 s after another weighs ×${O.repeatRatio.toFixed(2)} (off) vs ×${C.repeatRatio.toFixed(2)} (curious); searching a strong disturbance: ${O.search == null ? '-' : O.search.toFixed(1)} s vs ${C.search == null ? '-' : C.search.toFixed(1)} s; sound interest +${(S.hearInterest * 100).toFixed(0)}% as secondary vs +${(C.hearInterest * 100).toFixed(0)}% as primary; "huh" per incident ${O.four.reactions}/${C.four.reactions}` };
  },

  // Step 10, 5, 6, 11: BORED while patrolling (3 laps each, seeded): as a secondary trait he
  // now and then lingers at an observation point, adds a casual look and shifts his stance;
  // as a primary trait he does so clearly more often; with personality off, never. The
  // route stays the same and is always completed in order; the stance shift is small,
  // eased and causes no joint pops; standing at his post (patrol off) a bored guard shifts
  // his stance too without turning away from his post facing. The same seed repeats exactly
  async personaBored() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, p = g.patrol, T = MV.seeTarget, dt = 1 / 60, B = g.bones, P0 = useProfile('A');   // Step 10's profile
      const run = (mode, laps) => {
        g.personality = mode === 'primary' ? new MV.SCmv.GuardPersonality(g, { primary: 'bored', secondary: 'curious' }) : P0;
        g.personality.enabled = mode !== 'off'; p.enabled = true; g.reset(); motor.teleport(-17, 15, 0);
        const P = g.personality, order = [], durs = [], prevQ = {}, lastA = {}; let pops = 0, lastKey = '', start = 0, maxShift = 0;
        for (let f = 0; f < laps * 57 * 60; f++) {
          step(0, 'stand'); noise.update(dt); g.update(dt, T);
          if (p.state === 'walking' && order[order.length - 1] !== p.index) order.push(p.index);
          const key = p.state + p.index; if (key !== lastKey) { if (lastKey.startsWith('observing')) durs.push(+(a.clock - start).toFixed(2)); if (p.state === 'observing') start = a.clock; lastKey = key; }
          maxShift = Math.max(maxShift, Math.abs(P.shift.yaw), Math.abs(P.shift.head));
          const ri = g.root.getWorldQuaternion(new THREE.Quaternion()).invert();
          for (const nm of ['spine1', 'chest', 'neck', 'head']) { const q = ri.clone().multiply(B[nm].getWorldQuaternion(new THREE.Quaternion())); if (prevQ[nm]) { const ang = 2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ[nm])))) * 57.3; if (ang > 9) pops++; } prevQ[nm] = q; }
        }
        return { counts: Object.assign({}, P.counts), order: order.join(''), durs, pops, maxShift: maxShift * 57.3, log: P.log.map(x => x.trait + ':' + x.what), choices: ['lingering', 'casual', 'shifting'].map(k => P.log.filter(x => x.what.indexOf(k) >= 0).map(x => x.what).join('|')).join(' / ') };   // each kind of choice, in order
      };
      const off = run('off', 3), sec = run('secondary', 3), sec2 = run('secondary', 3), pri = run('primary', 3);
      // standing at his post: bored stance shifts, facing kept
      g.personality = P0; P0.enabled = true; p.enabled = false; g.reset(); motor.teleport(-17, 15, 0);
      let maxYawOff = 0; for (let f = 0; f < 120 * 60; f++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); maxYawOff = Math.max(maxYawOff, Math.abs(Math.atan2(Math.sin(g.yaw - g.postYaw), Math.cos(g.yaw - g.postYaw))) * 57.3); }
      const post = { shifts: P0.counts.shifts, maxYawOff };
      P0.enabled = false; g.reset();
      return { off, sec, sec2, pri, post };
    });
    const tot = x => x.counts.lingers + x.counts.casualLooks + x.counts.shifts;
    const O = r.off, S = r.sec, Pm = r.pri;
    const sameRoute = [O, S, Pm].every(x => x.order.startsWith('1230123012'));
    const ok = tot(O) === 0 && tot(S) >= 2 && tot(Pm) > tot(S) * 1.5 && S.counts.lingers + S.counts.casualLooks >= 1 && Pm.counts.lingers > S.counts.lingers && sameRoute
      && S.choices === r.sec2.choices && O.durs.join() !== S.durs.join() && [O, S, Pm].every(x => x.pops === 0) && Pm.maxShift <= 11 && r.post.shifts >= 1 && r.post.maxYawOff < 0.5;
    const c = x => `lingers ${x.counts.lingers}, casual looks ${x.counts.casualLooks}, stance shifts ${x.counts.shifts}`;
    return { pass: ok, detail: `3 laps each — personality off: ${c(O)}; bored secondary: ${c(S)}; bored primary: ${c(Pm)}; route order kept in all ${sameRoute} (${S.order}); same seed makes the same choices in the same order ${S.choices === r.sec2.choices}; observation times off ${O.durs.slice(0, 5).join('/')} vs bored ${S.durs.slice(0, 5).join('/')} s; largest stance shift ${Pm.maxShift.toFixed(1)}°, joint pops ${O.pops}/${S.pops}/${Pm.pops}; at his post for 2 min: ${r.post.shifts} stance shifts, facing kept within ${r.post.maxYawOff.toFixed(2)}°; e.g. ${S.log.slice(0, 3).join('; ')}` };
  },

  // Step 10, 7, 8, 9: awareness first. Plain view: ALERT on exactly the same frame with
  // personality on or off. In the middle of a bored stance shift she's recognised: ALERT on
  // that frame, the shift released, the STATS line says the personality is on hold; through
  // EVASION, HEIGHTENED SECURITY and RETURN TO POST no casual behaviour starts (no lingers,
  // looks or shifts); after the stand-down his Curious / Bored personality acts again
  async personaPriority() {
    const page = await patrolPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, P = useProfile('A'), v = g.vision, T = MV.seeTarget, dt = 1 / 60;   // Step 10's profile
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); } };
      const framesToAlert = on => { P.enabled = on; g.patrol.enabled = false; g.reset(); motor.teleport(-17, 15, 0); sim(30); const q = g.position.clone().addScaledVector(g.forward(), 3); motor.teleport(q.x, q.z, g.yaw + Math.PI); for (let f = 0; f < 2; f++) step(0, 'stand'); let n = 0; while (a.state !== 'ALERT' && n < 600) { sim(1); n++; } return n; };
      const nOff = framesToAlert(false), nOn = framesToAlert(true);
      // a stance shift in progress (forced now), then she's in plain view
      P.enabled = true; g.patrol.enabled = true; g.reset(); motor.teleport(-17, 15, 0); sim(30);
      P.shift.next = 0; let k = 0; while (!P.shift.want && k < 600) { sim(1); k++; }
      const shifting = !!P.shift.want, q = g.position.clone().addScaledVector(g.forward(), 3); motor.teleport(q.x, q.z, g.yaw + Math.PI); for (let f = 0; f < 2; f++) step(0, 'stand');
      let full = null, al = null, f = 0; while (al == null && f < 600) { sim(1); f++; if (full == null && v.meter >= 1) full = f; if (a.state === 'ALERT') al = f; }
      sim(1); const released = P.shift.want === 0, status = P.status();
      // the cycle: nothing casual may start
      a.cfg.evasionTime = 8; a.cfg.heightenedTime = 10;
      motor.teleport(-17, 15, 0); const c0 = JSON.stringify(P.counts), seen = new Set(); let t = 0, casualDuring = 0;
      while (a.standDowns === 0 && t < 120) { const before = P.counts.lingers + P.counts.casualLooks + P.counts.shifts; sim(1); t += dt; seen.add(a.state); if (a.state !== 'NORMAL' && P.counts.lingers + P.counts.casualLooks + P.counts.shifts > before) casualDuring++; }
      const atStandDown = P.counts.lingers + P.counts.casualLooks + P.counts.shifts;
      // after the stand-down: back on the route, the personality acts again
      t = 0; while (t < 150 && P.counts.lingers + P.counts.casualLooks + P.counts.shifts === atStandDown) { sim(1); t += dt; }
      const after = { resumedAfter: t, state: a.state, traits: JSON.stringify(P.traits), what: P.log.length ? P.log[P.log.length - 1].trait + ': ' + P.log[P.log.length - 1].what : '' };
      P.enabled = false; g.reset();
      return { nOff, nOn, shifting, full, al, released, status, states: [...seen].join('/'), casualDuring, after };
    });
    const ok = r.nOff === r.nOn && r.shifting && r.full != null && r.al === r.full && r.released && /ALERT \(personality on hold\)/.test(r.status)
      && /EVASION/.test(r.states) && /HEIGHTENED/.test(r.states) && /RETURNING/.test(r.states) && r.casualDuring === 0
      && r.after.resumedAfter < 150 && r.after.state === 'NORMAL' && r.after.traits === '{"primary":"curious","secondary":"bored"}';
    return { pass: ok, detail: `plain view: ALERT after ${r.nOff} frames with personality off, ${r.nOn} with it on; recognised mid stance shift (${r.shifting}): meter full on frame ${r.full}, ALERT on ${r.al}, shift released ${r.released}, STATS "${r.status}"; through ${r.states}: casual actions started ${r.casualDuring}; after the stand-down his personality acted again ${r.after.resumedAfter.toFixed(1)} s later ("${r.after.what}"), traits ${r.after.traits}` };
  },

  // Step 10 on an iPhone-landscape screen (real touches): personality on and patrolling.
  // Footsteps behind him at sneak, stealth walk and jog: one "huh" per incident; the STATS
  // panel shows both traits; RESET keeps the traits and restarts the personality cleanly
  async personaTouch() {
    const page = await patrolPage(true), Tc = page.touch, runs = [];
    for (const [label, dy, back] of [['sneak', 25, 1.3], ['stealth walk', 50, 2.5], ['jog', 64, 2.5]]) {   // (a sneak step carries only ~2 m)
      await page.evaluate(() => { const g = MV.guard; if (!g.personality.__a) { useProfile('A').__a = true; } g.personality.enabled = true; g.reset(); MV.motor.teleport(-17, 15, 0); });   // Step 10's profile
      await page.waitForFunction(() => MV.guard.patrol.state === 'walking' && MV.guard.patrol.index === 1 && Math.hypot(MV.guard.position.x - 2, MV.guard.position.z + 16) > 3, null, { timeout: 60000 }).catch(() => {});
      await page.evaluate(back => { const g = MV.guard, b = g.position.clone().addScaledVector(g.forward(), -back); MV.motor.teleport(b.x, b.z, g.yaw); /* following him */ MV.cam.snap(MV.motor); window.__h0 = g.hearing.heardCount; }, back);
      await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 150, y: 300 - dy, id: 1 }]); await page.waitForTimeout(1600); await Tc('touchEnd', []);
      await page.waitForTimeout(1500);
      runs.push(Object.assign({ label }, await page.evaluate(() => ({ heard: MV.guard.hearing.heardCount - window.__h0, reactions: MV.guard.awareness.reactions, incidents: MV.guard.awareness.incidents, state: MV.guard.awareness.state, stats: document.getElementById('mv-persona').textContent }))));
    }
    await page.tap('#mv-reset'); await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ traits: JSON.stringify(MV.guard.personality.traits), counts: JSON.stringify(MV.guard.personality.counts), state: MV.guard.awareness.state, patrol: MV.guard.patrol.state }));
    await page.evaluate(() => { MV.guard.personality.enabled = false; MV.guard.reset(); });
    const ok = runs.every(x => x.heard >= 2 && x.reactions <= 1 && x.incidents <= 1) && runs.filter(x => x.reactions === 1).length >= 2 && runs.every(x => /CURIOUS \(primary\) · BORED \(secondary\)/.test(x.stats))
      && after.traits === '{"primary":"curious","secondary":"bored"}' && Object.values(JSON.parse(after.counts)).every(x => x === 0) && after.state === 'NORMAL' && after.patrol === 'observing' && page.errors.length === 0;
    return { pass: ok, detail: runs.map(x => `${x.label}: ${x.heard} steps heard → "huh" ×${x.reactions}, ${x.state}`).join('; ') + `; STATS "${runs[0].stats}"; after RESET traits ${after.traits}, personality counters cleared ${Object.values(JSON.parse(after.counts)).every(x => x === 0)}, ${after.state}, patrol ${after.patrol}; page errors ${page.errors.length}` };
  },

  // Step 11, 1, 2, 3, 14: Focused and Careless as primary and as secondary traits (profiles B
  // and C, plus swapped pairs and Focused+Careless together). Traits never change, through a
  // full alert cycle and RESET; every modifier as a secondary trait is 40% of the primary;
  // on patrol the primary acts more often than the same trait as secondary; Focused+Careless
  // together never makes one stop both longer and shorter; the same seed repeats exactly
  async focCareTraits() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, area } = MV, g = MV.guard, a = g.awareness, p = g.patrol, T = MV.seeTarget, dt = 1 / 60, mv = MV.SCmv;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); } };
      const make = o => { g.personality = new mv.GuardPersonality(g, o); g.patrol.enabled = true; g.reset(); motor.teleport(-17, 15, 0); return g.personality; };
      const laps = (o, n) => { const P = make(o), order = []; let both = 0, lastStops = 0;
        for (let f = 0; f < n * 57 * 60; f++) { const c0 = P.counts.sweeps, s0 = P.counts.shortStops; sim(1); if (P.counts.sweeps > c0 && P.counts.shortStops > s0) both++; if (p.state === 'walking' && order[order.length - 1] !== p.index) order.push(p.index); }
        return { counts: Object.assign({}, P.counts), order: order.join(''), both, choices: ['sweep', 'quick'].map(k => P.log.filter(x => x.what.indexOf(k) >= 0).map(x => x.what).join('|')).join(' / '), traits: JSON.stringify(P.traits) }; };
      const B = laps(area.profiles.B, 3), B2 = laps(area.profiles.B, 3), C = laps(area.profiles.C, 3);
      const fs = laps({ primary: 'bored', secondary: 'focused' }, 3), cs = laps({ primary: 'bored', secondary: 'careless' }, 3);
      const fc = laps({ primary: 'focused', secondary: 'careless' }, 3), cf = laps({ primary: 'careless', secondary: 'focused' }, 3);
      // modifier strength: secondary = 40% of primary
      const mods = {}; for (const t of ['focused', 'careless']) { const pri = new mv.GuardPersonality(g, { primary: t, secondary: 'bored' }), sec = new mv.GuardPersonality(g, { primary: 'bored', secondary: t });
        mods[t] = Object.keys(mv.TraitEffects[t]).filter(k => typeof mv.TraitEffects[t][k] === 'number' && pri.mod(k) !== 0).map(k => +(sec.mod(k) / pri.mod(k)).toFixed(3)); }
      // traits through a full cycle and RESET (profile B)
      const P = make(area.profiles.B); p.enabled = false; g.reset(); const t0 = JSON.stringify(P.traits);
      a.cfg.evasionTime = 5; a.cfg.heightenedTime = 5; motor.teleport(2, -12, Math.PI); let t = 0; while (a.state !== 'ALERT' && t < 10) { sim(1); t += dt; }
      const inAlert = JSON.stringify(P.traits); motor.teleport(-17, 15, 0); t = 0; while (a.standDowns === 0 && t < 60) { sim(1); t += dt; }
      const stood = a.standDowns, afterCycle = JSON.stringify(P.traits); g.reset(); a.cfg.evasionTime = 30; a.cfg.heightenedTime = 60;
      const afterReset = JSON.stringify(g.personality.traits);
      g.personality = new mv.GuardPersonality(g, Object.assign({ enabled: false }, area.profiles.B)); p.enabled = false; g.reset();
      return { B, B2, C, fs, cs, fc, cf, mods, t0, inAlert, afterCycle, afterReset, stood, def: area.profile };
    });
    const ratiosOk = Object.values(r.mods).every(v => v.length >= 4 && v.every(x => Math.abs(x - 0.4) < 1e-6));
    const routes = [r.B, r.C, r.fs, r.cs, r.fc, r.cf].every(x => x.order.startsWith('1230123012'));
    const ok = r.def === 'B' && r.t0 === '{"primary":"focused","secondary":"bored"}' && r.inAlert === r.t0 && r.afterCycle === r.t0 && r.afterReset === r.t0 && r.stood === 1 && ratiosOk
      && r.B.counts.sweeps > r.fs.counts.sweeps && r.fs.counts.sweeps >= 1 && r.C.counts.shortStops > r.cs.counts.shortStops && r.cs.counts.shortStops >= 1
      && r.fc.both === 0 && r.cf.both === 0 && r.fc.counts.sweeps > r.fc.counts.shortStops && r.cf.counts.shortStops > r.cf.counts.sweeps && routes && r.B.choices === r.B2.choices;
    return { pass: ok, detail: `default profile ${r.def} ${r.t0}: unchanged in ALERT, after the cycle (stand-downs ${r.stood}) and RESET ${r.inAlert === r.t0 && r.afterCycle === r.t0 && r.afterReset === r.t0}; secondary/primary modifier ratios ${JSON.stringify(r.mods)}; 3 laps: Focused sweeps ${r.B.counts.sweeps} as primary vs ${r.fs.counts.sweeps} as secondary; Careless short stops ${r.C.counts.shortStops} vs ${r.cs.counts.shortStops}; Focused+Careless: sweeps ${r.fc.counts.sweeps} / short ${r.fc.counts.shortStops}, Careless+Focused: ${r.cf.counts.sweeps} / ${r.cf.counts.shortStops}, stops both longer and shorter ${r.fc.both + r.cf.both}; routes completed in order ${routes}; same seed same choices ${r.B.choices === r.B2.choices}` };
  },

  // Step 11, 4–9, 13: controlled comparison, same sounds and sights for a neutral guard,
  // Curious (A), Focused (B) and Careless (C). Hearing and vision are identical (same steps
  // heard or missed, same meter rise). One faint step: all four react once ("huh") and none
  // investigates; Careless writes it off and is calm soonest, Focused holds it longest.
  // Four faint steps in one area: Focused investigates where neutral and Careless don't;
  // six: all of them do (Careless too). Three jog steps: all investigate, and search the spot
  // Careless < neutral < Focused. Ambiguous evidence (peak below 85%): Careless cuts the
  // search a round short. Nobody's target is ever where she really is
  async focCareSuspicion() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, area } = MV, g = MV.guard, a = g.awareness, v = g.vision, T = MV.seeTarget, dt = 1 / 60, mv = MV.SCmv;
      let knows = 0, hidden = true;   // (in the vision part she's in plain view: not counted)
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); if (hidden && a.focus && a.focus.position.distanceTo(motor.position) < 3) knows++; } };
      const setP = k => { g.personality = new mv.GuardPersonality(g, k === 'N' ? Object.assign({ enabled: false }, area.profiles.B) : area.profiles[k]); g.patrol.enabled = false; g.reset(); motor.teleport(-17, 15, 0); sim(10); };
      const steps = (n, gap, d, lvl) => { let peak = 0, inv = false, calmAt = null, t = 0, heard = 0; const r0 = a.reactions;
        for (let k = 0; k < n; k++) { const h0 = g.hearing.heardCount; noise.emit(lvl || 1, 'footstep', new THREE.Vector3(g.position.x + d * 0.7, 0, g.position.z - d * 0.7 + k * 0.2), 'concrete', 'player'); heard += g.hearing.heardCount - h0; for (let f = 0; f < gap * 60; f++) { sim(1); t += dt; peak = Math.max(peak, a.suspicion); if (a.state === 'INVESTIGATING') inv = true; } }
        for (let f = 0; f < 40 * 60 && calmAt == null && !inv; f++) { sim(1); t += dt; if (a.state === 'INVESTIGATING') inv = true; if (a.state === 'NORMAL') calmAt = t; }
        return { peak, inv, calmAt, heard, reactions: a.reactions - r0, dismissed: g.personality.counts.dismissed }; };
      const search = () => { let s0 = null, s1 = null, t = 0; while (t < 80 && s1 == null) { sim(1); t += dt; if (s0 == null && a.behavior === 'search') s0 = t; if (s0 != null && a.behavior === 'return') s1 = t; } return s0 == null || s1 == null ? null : s1 - s0; };
      const out = {};
      for (const k of ['N', 'A', 'B', 'C']) {
        const o = out[k] = {};
        setP(k); o.one = steps(1, 2, 2);
        setP(k); o.four = steps(4, 2, 2);
        setP(k); o.six = steps(6, 2, 2);
        setP(k); o.far = steps(3, 2, 3.2);
        setP(k); for (let q = 0; q < 3; q++) { noise.emit(3, 'footstep', new THREE.Vector3(g.position.x + 3, 0, g.position.z - 3), 'concrete', 'player'); sim(3); } o.strongInv = a.state === 'SUSPICIOUS' || a.state === 'INVESTIGATING'; o.strong = search(); o.strongReact = a.reactions;
        setP(k); o.amb = steps(5, 2, 2); o.ambSearch = o.amb.inv ? search() : null; o.ambPeak = a.incident ? a.incident.peak : 0; o.earlyEnds = g.personality.counts.earlyEnds; o.extraRounds = g.personality.counts.extraRounds;
        // vision: she stands 8 m in front of him for 1 s
        setP(k); hidden = false; const q = g.position.clone().addScaledVector(g.forward(), 8); motor.teleport(q.x, q.z, g.yaw + Math.PI); for (let f = 0; f < 2; f++) step(0, 'stand'); sim(60); o.meter = +v.meter.toFixed(5); motor.teleport(-17, 15, 0); hidden = true;
        o.senses = JSON.stringify([v.cfg, v.profile, v.range(), g.hearing.cfg, g.hearing.profile]);   // his physical senses' settings
      }
      g.personality = new mv.GuardPersonality(g, Object.assign({ enabled: false }, area.profiles.B)); g.reset();
      out.knows = knows; return out;
    });
    const N = r.N, A = r.A, B = r.B, C = r.C, all = [N, A, B, C];
    // the same steps heard or missed, identical sense settings, and the same meter rise (within 0.5%: his idle
    // animation's phase, which RESET doesn't rewind, moves his eyes by millimetres between runs)
    const sameSenses = all.every(x => x.one.heard === N.one.heard && x.four.heard === N.four.heard && x.far.heard === N.far.heard && x.senses === N.senses && Math.abs(x.meter - N.meter) <= 0.005 * N.meter);
    const ok = sameSenses && all.every(x => x.one.reactions === 1 && !x.one.inv && x.four.reactions === 1 && x.six.inv && x.strongInv && x.strong != null)
      && C.one.dismissed >= 1 && C.one.calmAt < N.one.calmAt && B.one.calmAt > N.one.calmAt
      && B.four.inv && !N.four.inv && !C.four.inv && C.strong < N.strong && N.strong < B.strong
      && C.amb.inv && C.ambPeak < 0.85 && C.earlyEnds >= 1 && B.extraRounds >= 1 && r.knows === 0;
    const f = x => `${(x.peak * 100).toFixed(0)}%${x.inv ? ' → investigates' : x.calmAt != null ? ', calm after ' + x.calmAt.toFixed(1) + ' s' : ''}`;
    return { pass: ok, detail: `same senses for all four ${sameSenses} (heard ${all.map(x => x.one.heard + '/' + x.four.heard + '/' + x.far.heard).join(', ')} steps, meter after 1 s at 8 m ${all.map(x => x.meter).join(', ')}); one faint step — neutral ${f(N.one)}, Curious ${f(A.one)}, Focused ${f(B.one)}, Careless ${f(C.one)} (dismissed ${C.one.dismissed}), "huh" ×1 each ${all.every(x => x.one.reactions === 1)}; four steps — N ${f(N.four)}, A ${f(A.four)}, B ${f(B.four)}, C ${f(C.four)}; six steps — C ${f(C.six)}; three jog steps: all investigate, search N ${N.strong.toFixed(1)} s, A ${A.strong.toFixed(1)}, B ${B.strong.toFixed(1)}, C ${C.strong.toFixed(1)}; five faint steps (ambiguous, Careless peak ${(C.ambPeak * 100).toFixed(0)}%): search N ${N.ambSearch == null ? '-' : N.ambSearch.toFixed(1)}, B ${B.ambSearch == null ? '-' : B.ambSearch.toFixed(1)}, C ${C.ambSearch == null ? '-' : C.ambSearch.toFixed(1)} s (Careless cut short ${C.earlyEnds}, Focused extra rounds ${B.extraRounds}); targets near her hidden position: ${r.knows} frames` };
  },

  // Step 11, 4: patrol observations over 3 laps (seeded): Focused stops are longer and more
  // thorough (deliberate sweeps) than neutral, Careless ones sometimes shorter (quick looks),
  // the route always completed in order, no joint pops, no teleport
  async focCarePatrol() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, area } = MV, g = MV.guard, a = g.awareness, p = g.patrol, T = MV.seeTarget, dt = 1 / 60, B = g.bones, mv = MV.SCmv;
      const run = k => {
        g.personality = new mv.GuardPersonality(g, k === 'N' ? Object.assign({ enabled: false }, area.profiles.B) : area.profiles[k]); p.enabled = true; g.reset(); motor.teleport(-17, 15, 0);
        const P = g.personality, order = [], durs = [], spans = [], prevQ = {}; let lastKey = '', start = 0, pops = 0, maxStep = 0, lp = g.position.clone(), yMin = 9, yMax = -9;
        for (let f = 0; f < 3 * 60 * 60; f++) {
          step(0, 'stand'); noise.update(dt); g.update(dt, T);
          if (p.state === 'walking' && order[order.length - 1] !== p.index) order.push(p.index);
          const key = p.state + p.index; if (key !== lastKey) { if (lastKey.startsWith('observing')) { durs.push(a.clock - start); spans.push((yMax - yMin) * 57.3); } if (p.state === 'observing') { start = a.clock; yMin = 9; yMax = -9; } lastKey = key; }
          if (p.state === 'observing' && g.isStill()) { const face = (p.cfg.points[p.index].face || 0) * Math.PI / 180, y = Math.atan2(Math.sin(g.yaw - face), Math.cos(g.yaw - face)); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
          maxStep = Math.max(maxStep, g.position.distanceTo(lp)); lp.copy(g.position);
          const ri = g.root.getWorldQuaternion(new THREE.Quaternion()).invert();
          for (const nm of ['spine1', 'chest', 'neck', 'head', 'leftUpLeg', 'rightUpLeg']) { const q = ri.clone().multiply(B[nm].getWorldQuaternion(new THREE.Quaternion())); if (prevQ[nm] && 2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ[nm])))) * 57.3 > 9) pops++; prevQ[nm] = q; }
        }
        const mean = x => x.reduce((s, y) => s + y, 0) / Math.max(1, x.length);
        return { order: order.join(''), stops: durs.length, mean: mean(durs), min: Math.min(...durs), span: mean(spans), counts: Object.assign({}, P.counts), pops, maxStep };
      };
      const out = { N: run('N'), B: run('B'), C: run('C') };
      g.personality = new mv.GuardPersonality(g, Object.assign({ enabled: false }, area.profiles.B)); p.enabled = false; g.reset();
      return out;
    });
    const { N, B, C } = r;
    const ok = [N, B, C].every(x => x.order.startsWith('1230123012') && x.pops === 0 && x.maxStep < 0.03 && x.stops >= 9)
      && B.mean > N.mean + 0.5 && B.span > N.span && B.counts.sweeps >= 3 && C.mean < N.mean && C.min < N.min && C.counts.shortStops >= 1;
    const d = x => `${x.stops} stops, mean ${x.mean.toFixed(2)} s (shortest ${x.min.toFixed(2)}), looked over ${x.span.toFixed(0)}° on average`;
    return { pass: ok, detail: `3 laps — neutral: ${d(N)}; Focused/Bored: ${d(B)}, ${B.counts.sweeps} deliberate sweeps; Careless/Bored: ${d(C)}, ${C.counts.shortStops} quick stops; routes in order ${[N, B, C].every(x => x.order.startsWith('1230123012'))}; joint pops ${N.pops}/${B.pops}/${C.pops}` };
  },

  // Step 11, 10, 11, 12: awareness first, for Focused (B) and Careless (C) on patrol. Plain
  // view: ALERT on the same frame as a neutral guard. She stays in view for 10 s: he stays
  // ALERT (Careless never lets a recognised intruder go). She hides: EVASION 30 s, HEIGHTENED
  // 60 s, the walk back and stand-down; no personality action starts during them; then he
  // resumes his route and his personality acts again
  async focCarePriority() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, area } = MV, g = MV.guard, a = g.awareness, p = g.patrol, T = MV.seeTarget, dt = 1 / 60, mv = MV.SCmv;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); } };
      const total = P => Object.values(P.counts).reduce((s, x) => s + x, 0);
      const run = k => {
        g.personality = new mv.GuardPersonality(g, k === 'N' ? Object.assign({ enabled: false }, area.profiles.B) : area.profiles[k]); const P = g.personality;
        // ALERT timing under identical conditions: at his post, she steps out 3 m in front
        p.enabled = false; g.reset(); motor.teleport(-17, 15, 0); sim(30);
        const q0 = g.position.clone().addScaledVector(g.forward(), 3); motor.teleport(q0.x, q0.z, g.yaw + Math.PI); for (let f = 0; f < 2; f++) step(0, 'stand');
        let n = 0; while (a.state !== 'ALERT' && n < 600) { sim(1); n++; }
        // then on patrol: recognised on the W0 → W1 leg
        p.enabled = true; g.reset(); motor.teleport(-17, 15, 0);
        let t = 0; while (!(p.state === 'walking' && p.index === 1 && Math.hypot(g.position.x - 2, g.position.z + 16) > 4) && t < 30) { sim(1); t += dt; }
        const q = g.position.clone().addScaledVector(g.forward(), 3); motor.teleport(q.x, q.z, g.yaw + Math.PI); for (let f = 0; f < 2; f++) step(0, 'stand');
        let m = 0; while (a.state !== 'ALERT' && m < 600) { sim(1); m++; }
        let notAlert = 0; for (let f = 0; f < 600; f++) { sim(1); if (a.state !== 'ALERT') notAlert++; }
        motor.teleport(-17, 15, 0); const seq = [a.state], times = {}; const c0 = total(P); let during = 0; t = 0;
        while (a.standDowns === 0 && t < 150) { const b = total(P); sim(1); t += dt; if (seq[seq.length - 1] !== a.state) { seq.push(a.state); times[a.state] = a.clock; } if (a.state !== 'NORMAL' && total(P) > b) during++; }
        const at = total(P); t = 0; while (t < 120 && !(p.state === 'walking' && p.resumes >= 1 && !p.rejoining)) { sim(1); t += dt; }
        const resumed = p.state === 'walking' && p.resumes >= 1; t = 0; while (t < 120 && total(P) === at && P.enabled) { sim(1); t += dt; }
        return { n, m, notAlert, seq: seq.join(' → '), ev: (times.HEIGHTENED || 0) - (times.EVASION || 0), hs: (times.RETURNING || 0) - (times.HEIGHTENED || 0), during, resumed, actedAgain: total(P) > at, traits: JSON.stringify(P.traits) };
      };
      const out = { N: run('N'), B: run('B'), C: run('C') };
      g.personality = new mv.GuardPersonality(g, Object.assign({ enabled: false }, area.profiles.B)); p.enabled = false; g.reset();
      return out;
    });
    const { N, B, C } = r;
    const ok = [B, C].every(x => x.n === N.n && x.m < 600 && x.notAlert === 0 && /^ALERT → EVASION → HEIGHTENED → RETURNING → NORMAL$/.test(x.seq) && Math.abs(x.ev - 30) < 1 && Math.abs(x.hs - 60) < 0.5 && x.during === 0 && x.resumed && x.actedAgain)
      && N.resumed && B.traits === '{"primary":"focused","secondary":"bored"}' && C.traits === '{"primary":"careless","secondary":"bored"}';
    const d = x => `ALERT after ${x.n} frames at his post (${x.m} on patrol), not ALERT in 10 s of view ${x.notAlert}, ${x.seq} (search ${x.ev.toFixed(1)} s, Heightened ${x.hs.toFixed(1)} s), personality actions during ${x.during}, resumed route ${x.resumed}, personality again ${x.actedAgain}`;
    return { pass: ok, detail: `neutral: ALERT after ${N.n} frames at his post, resumed ${N.resumed}; Focused: ${d(B)}; Careless: ${d(C)}` };
  },

  // Step 11 on an iPhone-landscape screen (real touches, frame loop running), a stationary
  // guard. One faint footstep behind him: Focused and Careless both react once ("huh");
  // Careless writes it off and is calm again sooner after his reaction. Then she sneaks back
  // and forth behind him: with that repeated evidence both become convinced and investigate.
  // STATS shows the profile and Careless's dismissal
  async focCareTouch() {
    const page = await touchPage(), Tc = page.touch, X = 150, Y = 300, out = {};
    const steer = async (tx, tz, px, max) => {
      const t0 = Date.now(); let first = true;
      while (Date.now() - t0 < max) {
        const st = await page.evaluate(([tx, tz]) => { const f = MV.cam.forward(new THREE.Vector3()), p = MV.motor.position, wx = tx - p.x, wz = tz - p.z, l = Math.hypot(wx, wz); return { mx: (wx * -f.z + wz * f.x) / l, my: (wx * f.x + wz * f.z) / l, d: l }; }, [tx, tz]);
        if (st.d < 0.35 || await page.evaluate(() => MV.guard.awareness.state === 'INVESTIGATING' || MV.guard.awareness.state === 'ALERT')) break;
        if (first) { await Tc('touchStart', [{ x: X, y: Y, id: 1 }]); first = false; }
        await Tc('touchMove', [{ x: X + st.mx * px, y: Y - st.my * px, id: 1 }]); await page.waitForTimeout(200);
      }
      if (!first) await Tc('touchEnd', []);
    };
    for (const k of ['B', 'C']) {
      await page.evaluate(k => {
        useProfile(k); const g = MV.guard, a = g.awareness; g.patrol.enabled = false; g.reset();
        const b = g.position.clone().addScaledVector(g.forward(), -2.0); MV.motor.teleport(b.x, b.z, g.yaw + Math.PI); MV.cam.snap(MV.motor);   // facing away: her steps lead away from him
        for (const f of MV.footsteps.feet) { f.down = true; f.prev = null; f.at = null; }   // (as RESET does: no phantom landing after a teleport)
        window.__w = { h0: g.hearing.heardCount, reactT: null, calmT: null, stats: '' };
        (function f() { const w = window.__w; if (w.reactT == null && a.reactions > 0) w.reactT = a.clock; if (w.reactT != null && w.calmT == null && a.state === 'NORMAL') w.calmT = a.clock;
          const s = document.getElementById('mv-persona').textContent; if (/dismissed/.test(s)) w.stats = s; if (!window.__stop) requestAnimationFrame(f); })();
      }, k);
      await page.waitForTimeout(300);
      // exactly one faint step 2 m behind him (a touch tap gives 0–3 steps depending on frame timing)
      await page.evaluate(() => { const g = MV.guard, b = g.position.clone().addScaledVector(g.forward(), -2); MV.motor.teleport(-17, 15, 0); MV.cam.snap(MV.motor); for (const f of MV.footsteps.feet) { f.down = true; f.prev = null; f.at = null; } window.__w.h0 = g.hearing.heardCount; MV.noise.emit(1, 'footstep', b, 'concrete', 'player'); });   // she's out of sight elsewhere
      await page.waitForFunction(() => window.__w.calmT != null || MV.guard.awareness.state === 'INVESTIGATING', null, { timeout: 40000, polling: 100 }).catch(() => {});
      // the STATS row refreshes a few times a second: give it a moment to show a dismissal
      if (k === 'C') await page.waitForFunction(() => !!window.__w.stats, null, { timeout: 3000, polling: 100 }).catch(() => {});
      const one = await page.evaluate(() => { const w = window.__w, a = MV.guard.awareness; return { heard: MV.guard.hearing.heardCount - w.h0, reactions: a.reactions, state: a.state, calm: w.calmT == null ? null : w.calmT - w.reactT, dismissed: MV.guard.personality.counts.dismissed, stats: w.stats || document.getElementById('mv-persona').textContent }; });
      // she sneaks back and forth 1.4 m behind him
      await page.evaluate(() => { const g = MV.guard; g.reset(); window.__h1 = g.hearing.heardCount; window.__r1 = g.awareness.reactions; const b = g.position.clone().addScaledVector(g.forward(), -1.4); MV.motor.teleport(b.x - 1.8, b.z, Math.PI / 2); MV.cam.snap(MV.motor); for (const f of MV.footsteps.feet) { f.down = true; f.prev = null; f.at = null; } });
      const back = await page.evaluate(() => { const g = MV.guard, b = g.position.clone().addScaledVector(g.forward(), -1.4); return [b.x, b.z]; });
      for (let i = 0; i < 6; i++) await steer(back[0] + (i % 2 ? -1.8 : 1.8), back[1], 22, 6000);
      await page.waitForFunction(() => ['INVESTIGATING', 'ALERT'].includes(MV.guard.awareness.state), null, { timeout: 8000 }).catch(() => {});
      const many = await page.evaluate(() => ({ heard: MV.guard.hearing.heardCount - window.__h1, reactions: MV.guard.awareness.reactions, state: MV.guard.awareness.state }));
      out[k] = { one, many };
    }
    await page.evaluate(() => { window.__stop = true; MV.guard.personality.enabled = false; MV.guard.reset(); });
    const { B, C } = out;
    const ok = [B, C].every(x => x.one.heard === 1 && x.one.reactions === 1 && x.one.calm != null && x.many.heard >= 4 && x.many.reactions === 1 && ['INVESTIGATING', 'ALERT'].includes(x.many.state))
      && C.one.calm < B.one.calm && C.one.dismissed >= 1 && /dismissed weak evidence/.test(C.one.stats) && /FOCUSED \(primary\)/.test(B.one.stats) && page.errors.length === 0;
    const d = x => `one faint step: ${x.one.heard} heard, "huh" ×${x.one.reactions}, calm ${x.one.calm == null ? 'never (' + x.one.state + ')' : x.one.calm.toFixed(1) + ' s after his reaction'}; sneaking back and forth behind him: ${x.many.heard} steps heard, "huh" ×${x.many.reactions}, ${x.many.state}`;
    return { pass: ok, detail: `Focused: ${d(B)}; Careless: ${d(C)} (STATS "${C.one.stats}"); page errors ${page.errors.length}` };
  },

  // Personality card (UI only), on an iPhone-landscape page with the frame loop running.
  // It appears beside the visible guard's shoulder (not in the HUD, a corner or STATS) with
  // his two traits, the primary larger and brighter; it follows him as he walks his route
  // and stays attached while the camera turns; it goes when he's off screen, behind solid
  // cover (without flickering at a cover edge) or beyond its distance; it never overlaps the
  // "Huh" at close, medium or long range; switched off, only the card goes
  async traitCard() {
    const page = await touchPage(), Tc = page.touch;
    await page.evaluate(() => { document.getElementById('mv-stats').hidden = true; MV.guard.patrol.enabled = false; MV.guard.reset(); const g = MV.guard; MV.motor.teleport(g.position.x + 1.2, g.position.z + 6, Math.PI); MV.cam.snap(MV.motor); });
    await page.waitForTimeout(1200);
    const geo = () => page.evaluate(() => {
      const g = MV.guard, c = MV.traitCard, el = document.getElementById('mv-trait'), r = el.getBoundingClientRect(), cam = MV.camera, W = innerWidth, H = innerHeight;
      const a = g.position.clone().setY(g.position.y + c.cfg.height).project(cam), right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
      const e = g.position.clone().setY(g.position.y + c.cfg.height).add(right).project(cam), sx = (a.x + 1) / 2 * W, sy = (1 - a.y) / 2 * H, ppm = Math.abs((e.x + 1) / 2 * W - sx);
      const near = r.left >= sx ? r.left - sx : sx - r.right;
      const huds = ['mv-stats', 'mv-reset', 'mv-stats-btn', 'mv-crouch'].map(id => document.getElementById(id)).filter(Boolean).map(x => x.getBoundingClientRect()).concat([...document.querySelectorAll('.mv-head')].map(x => x.getBoundingClientRect()));
      const hit = huds.some(b => b.width && !(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom));
      return { visible: c.visible && !el.hidden, why: c.why, near, nearMax: c.cfg.side * ppm + c.cfg.gap, dy: (r.top + r.bottom) / 2 - sy, ppm, w: r.width, h: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom, W, H, hit, parent: el.parentElement.tagName,
        pri: el.querySelector('.mv-trait-primary').textContent, sec: el.querySelector('.mv-trait-secondary').textContent,
        priFs: parseFloat(getComputedStyle(el.querySelector('.mv-trait-primary')).fontSize), secFs: parseFloat(getComputedStyle(el.querySelector('.mv-trait-secondary')).fontSize),
        priCol: getComputedStyle(el.querySelector('.mv-trait-primary')).color, secCol: getComputedStyle(el.querySelector('.mv-trait-secondary')).color };
    });
    const A = await geo();
    const lum = s => { const m = s.match(/[\d.]+/g).map(Number); return (0.3 * m[0] + 0.59 * m[1] + 0.11 * m[2]) * (m[3] == null ? 1 : m[3]); };
    await page.evaluate(() => useProfile('C')); await page.waitForTimeout(200); const Cx = await geo(); await page.evaluate(() => useProfile('B')); await page.waitForTimeout(200);
    // following him on his route (W0 → W1 crosses the view)
    await page.evaluate(() => { const g = MV.guard; g.patrol.enabled = true; g.reset(); MV.motor.teleport(1, -20.5, Math.atan2(11, 9.5)); MV.cam.snap(MV.motor);   // behind him (unseen), watching his W0 → W1 leg
      window.__f = []; (function f() { const c = MV.traitCard, el = document.getElementById('mv-trait'), r = el.getBoundingClientRect(), a = g.position.clone().setY(g.position.y + c.cfg.height).project(MV.camera); window.__f.push({ st: MV.guard.awareness.state, vis: c.visible, cx: r.left, cy: r.top, sx: (a.x + 1) / 2 * innerWidth, sy: (1 - a.y) / 2 * innerHeight, moving: g.moving, yaw: g.yaw }); if (window.__f.length < 1500 && !window.__stopF) requestAnimationFrame(f); })(); });
    await page.waitForFunction(() => MV.guard.patrol.state === 'walking' && MV.guard.moving, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(7000);
    // the camera turns (a drag on the right of the screen) while he walks
    await Tc('touchStart', [{ x: 620, y: 200, id: 2 }]); for (let i = 1; i <= 12; i++) { await Tc('touchMove', [{ x: 620 - i * 6, y: 200, id: 2 }]); await page.waitForTimeout(60); } await Tc('touchEnd', []);
    await page.waitForTimeout(600);
    const F = await page.evaluate(() => { window.__stopF = true; const R = window.__f, L = R.filter(x => x.vis); let jump = 0, movingFrames = 0, flips = 0;
      // per-frame movement relative to him, between consecutive frames that are both on screen
      for (let i = 1; i < R.length; i++) { if (!R[i].vis || !R[i - 1].vis) continue; const d = Math.hypot((R[i].cx - R[i].sx) - (R[i - 1].cx - R[i - 1].sx), (R[i].cy - R[i].sy) - (R[i - 1].cy - R[i - 1].sy)); jump = Math.max(jump, d); if (R[i].moving) movingFrames++; }
      for (let i = 1; i < L.length; i++) if (Math.sign(L[i].cx - L[i].sx) !== Math.sign(L[i - 1].cx - L[i - 1].sx)) flips++;
      const offs = L.map(x => x.cx - x.sx), mean = offs.reduce((a, b) => a + b, 0) / Math.max(1, offs.length);
      return { states: [...new Set(R.map(x => x.st))].join('/'), frames: L.length, movingFrames, jump, flips, spread: Math.max(...offs.map(o => Math.abs(o - mean))), screenTravel: L.length ? Math.abs(L[L.length - 1].sx - L[0].sx) : 0 }; });
    // off screen: the camera looks the other way
    await page.evaluate(() => { MV.guard.patrol.enabled = false; MV.guard.reset(); MV.cam.yaw += Math.PI; });
    await page.waitForTimeout(400); const off = await page.evaluate(() => ({ vis: MV.traitCard.visible, why: MV.traitCard.why }));
    // synthetic cameras (frame loop paused): cover, flicker, distance, overlap with "Huh"
    const S = await page.evaluate(() => {
      MV.renderer.setAnimationLoop(null);
      const g = MV.guard, c = MV.traitCard, cap = MV.caption, W = innerWidth, H = innerHeight, cam = new THREE.PerspectiveCamera(58, W / H, 0.1, 80), head = g.head.getWorldPosition(new THREE.Vector3());
      const look = (x, y, z) => { cam.position.set(x, y, z); cam.lookAt(head.x, head.y - 0.3, head.z); cam.updateMatrixWorld(true); };
      const run = (n, each) => { for (let i = 0; i < n; i++) { if (each) each(i); c.update(1 / 60, cam, W, H); } return { vis: c.visible, why: c.why }; };
      c.hide(); look(2, 2.2, -10); const clear = run(30);
      c.hide(); look(2, 2.2, -10); run(30); look(-4, 1.6, -4); const crate = run(60);   // shown, then behind the crate: confirmed and faded out within 1 s
      // flicker: every 0.1 s the view swaps between clear and behind the crate
      c.hide(); look(2, 2.2, -10); run(30); let toggles = 0, last = c.visible;
      run(120, i => { if (i % 6 === 0) { if (Math.floor(i / 6) % 2) look(-4, 1.6, -4); else look(2, 2.2, -10); } }); for (let i = 0; i < 1; i++); 
      c.hide(); look(2, 2.2, -10); run(30); last = c.visible;
      for (let i = 0; i < 120; i++) { if (i % 6 === 0) { if (Math.floor(i / 6) % 2) look(-4, 1.6, -4); else look(2, 2.2, -10); } c.update(1 / 60, cam, W, H); if (c.visible !== last) { toggles++; last = c.visible; } }
      c.hide(); look(2, 3, 13); const far = run(30); c.cfg.maxDistance = 40; c.hide(); const farAllowed = run(30); c.cfg.maxDistance = 18;
      // "Huh" and the card at close, medium and long range
      const overlap = [];
      for (const d of [3.5, 9, 15]) {
        c.hide(); cap.hide(); look(g.position.x + 0.8, 2.0, g.position.z + d); cap.show(); for (let i = 0; i < 20; i++) { c.update(1 / 60, cam, W, H); cap.update(1 / 60, cam, W, H); }
        const a = document.getElementById('mv-trait').getBoundingClientRect(), b = document.getElementById('mv-caption').getBoundingClientRect();
        const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)), iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        // the developer suspicion bar over his head (0.6 m above his eyes)
        const bar = g.eye(new THREE.Vector3()); bar.y += 0.6; const bp = bar.project(cam), bx = (bp.x + 1) / 2 * W, by = (1 - bp.y) / 2 * H;
        overlap.push({ d, both: c.visible && cap.visible, area: ix * iy, barInside: bx > a.left && bx < a.right && by > a.top && by < a.bottom, h: a.height, fs: document.getElementById('mv-trait').style.fontSize });
      }
      // switched off: only the card goes ("Huh" still shows)
      c.cfg.enabled = false; cap.hide(); cap.show(); for (let i = 0; i < 20; i++) { c.update(1 / 60, cam, W, H); cap.update(1 / 60, cam, W, H); }
      const disabled = { card: c.visible || !document.getElementById('mv-trait').hidden, huh: cap.visible, why: c.why }; c.cfg.enabled = true; cap.hide();
      return { clear, crate, toggles, far, farAllowed, overlap, disabled };
    });
    const ok = A.visible && A.parent === 'BODY' && !A.hit && A.near >= 4 && A.near <= A.nearMax + 4 && Math.abs(A.dy) < 0.45 * A.ppm && A.pri === 'FOCUSED' && A.sec === 'Bored'
      && Cx.pri === 'CARELESS' && Cx.sec === 'Bored' && A.priFs > A.secFs && lum(A.priCol) > lum(A.secCol) && A.w < A.W * 0.12 && A.h < A.H * 0.12
      && F.frames > 60 && F.movingFrames > 30 && F.jump < 10 && F.flips <= 2 && F.screenTravel > 20 && !off.vis && off.why === 'off screen'
      && S.clear.vis && !S.crate.vis && S.crate.why === 'behind cover' && S.toggles <= 2 && !S.far.vis && S.far.why === 'too far' && S.farAllowed.vis
      && S.overlap.every(o => o.both && o.area === 0 && !o.barInside) && !S.disabled.card && S.disabled.huh && page.errors.length === 0;
    return { pass: ok, detail: `beside him: ${A.near.toFixed(1)} px from his centre line (≤ ${A.nearMax.toFixed(1)}), ${A.dy.toFixed(1)} px from shoulder height, ${A.w.toFixed(0)}×${A.h.toFixed(0)} px on a ${A.W}×${A.H} screen, in the page body, touching the HUD ${A.hit}; text "${A.pri} / ${A.sec}" (Careless guard: "${Cx.pri} / ${Cx.sec}"), primary ${A.priFs}px vs ${A.secFs}px, brighter ${lum(A.priCol) > lum(A.secCol)}; following him on patrol and through a camera turn: ${F.frames} frames, card offset from him moved at most ${F.jump.toFixed(1)} px per frame on screen, ${F.flips} side change(s) (faded, not jumped), ${F.movingFrames} on-screen frames of him walking (${F.states}), crossing ${F.screenTravel.toFixed(0)} px of screen; camera turned away: ${off.why}; clear view ${S.clear.why}, behind the tall crate ${S.crate.why}, view swapping every 0.1 s: ${S.toggles} toggles; from 30 m ${S.far.why} (allowed at 40 m: ${S.farAllowed.vis}); with "Huh" at ${S.overlap.map(o => o.d + ' m: overlap ' + o.area.toFixed(0) + ' px², ' + o.fs).join(', ')}, suspicion bar inside the card ${S.overlap.some(o => o.barInside)}; switched off: card ${S.disabled.card ? 'still shown' : 'gone'}, "Huh" ${S.disabled.huh ? 'still works' : 'gone'}; page errors ${page.errors.length}` };
  },

  // the card never changes what the guard does: the same 60 s (patrol, footsteps behind him,
  // a sighting and its aftermath) on two freshly loaded pages, one with the card updating
  // every frame and one with it switched off, gives exactly the same states, notes and
  // positions (fresh pages: RESET doesn't rewind his animation phase)
  async traitCardAI() {
    const once = async on => { const page = await simPage(); const r = await page.evaluate(on => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60, c = MV.traitCard, cam = MV.camera;
      const run = on => {
        c.cfg.enabled = on; useProfile('B'); g.patrol.enabled = true; g.reset(); motor.teleport(-17, 15, 0); c.hide();
        const trace = [];
        for (let f = 0; f < 60 * 60; f++) {
          if (f === 600) { const b = g.position.clone().addScaledVector(g.forward(), -2); for (let k = 0; k < 3; k++) noise.emit(2, 'footstep', b.clone().add(new THREE.Vector3(k * 0.2, 0, 0)), 'concrete', 'player'); }
          if (f === 1500) { const q = g.position.clone().addScaledVector(g.forward(), 4); motor.teleport(q.x, q.z, g.yaw + Math.PI); }
          if (f === 1800) motor.teleport(-17, 15, 0);
          step(0, 'stand'); noise.update(dt); g.update(dt, T);
          cam.position.set(g.position.x + 3, 2.5, g.position.z + 6); cam.lookAt(g.position.x, 1.4, g.position.z); cam.updateMatrixWorld(true); c.update(dt, cam, 640, 300);
          if (f % 30 === 0) trace.push([a.state, a.behavior, a.note, g.patrol.state, g.position.x.toFixed(4), g.position.z.toFixed(4), g.yaw.toFixed(4), a.suspicion.toFixed(4)].join(','));
        }
        return { trace: trace.join('|'), shown: c.visible, states: [...new Set(trace.map(t => t.split(',')[0]))].join('/') };
      };
      return run(on);
    }, on); await page.close(); return r; };
    const onR = await once(true), offR = await once(false), r = { same: onR.trace === offR.trace, states: onR.states };
    return { pass: r.same && /INVESTIGATING|SUSPICIOUS/.test(r.states), detail: `60 s with the card on vs off: identical states, notes, positions and suspicion ${r.same} (through ${r.states})` };
  },

  // Awareness indicator (UI only): one full cycle per display preset, read from the real
  // awareness states with a camera watching him. NORMAL nothing; SUSPICIOUS and
  // INVESTIGATING one yellow "?" that never restarts as footsteps keep coming; ALERT a red
  // "!" (a cross-fade, not a jump); EVASION the search symbol and HEIGHTENED its subdued form
  // (Easy / developer override only); RETURNING fades it out; back to nothing at NORMAL; a
  // sound interrupting the walk back brings it back. Presets show only their kinds
  async awareIndicator() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60, ind = MV.indicator, el = document.getElementById('mv-indicator');
      const cam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 80);
      const run = (preset, dev) => {
        ind.cfg.preset = preset; ind.cfg.devShowAll = dev; ind.hide();
        g.patrol.enabled = false; g.reset(); a.cfg.evasionTime = 6; a.cfg.heightenedTime = 8; motor.teleport(-17, 15, 0);
        const shown = {}, byState = {}; let restarts = 0, lastOp = 0, stateWas = '', stateSince = 0, susStart = null, susDrops = 0, changesAtSus = null, returnFadeEnd = null, f = 0, alertSwap = null, retStart = null;
        const frame = () => {
          step(0, 'stand'); noise.update(dt); g.update(dt, T);
          cam.position.set(g.position.x + 3, 2.4, g.position.z + 6.5); cam.lookAt(g.position.x, 1.6, g.position.z); cam.updateMatrixWorld(true);
          ind.update(dt, cam, innerWidth, innerHeight); f++;
          const vis = !el.hidden && +el.style.opacity > 0, txt = vis ? el.textContent : '';
          if (vis) { const key = ind.kind; shown[key] = el.style.color; }
          if (a.state !== stateWas) stateSince = a.clock;
          if (a.clock - stateSince > 0.6) (byState[a.state] = byState[a.state] || new Set()).add(vis ? ind.kind : '-');   // settled in the state (a change cross-fades)
          // the "?" through SUSPICIOUS → INVESTIGATING while footsteps continue: never dips
          if ((a.state === 'SUSPICIOUS' || a.state === 'INVESTIGATING') && ind.kind === 'suspicion') { if (susStart == null) { susStart = f; changesAtSus = ind.changes; } if (+el.style.opacity < lastOp - 1e-6 && lastOp < 1) susDrops++; }
          if (a.state === 'RETURNING' && retStart == null) retStart = a.clock;
          if (retStart != null && returnFadeEnd == null && !vis) returnFadeEnd = a.clock - retStart;
          lastOp = vis ? +el.style.opacity : 0; stateWas = a.state;
        };
        for (let k = 0; k < 30; k++) frame();
        const normalShown = !el.hidden;
        // footsteps building to an investigation (one incident)
        for (let k = 0; k < 6; k++) { noise.emit(1, 'footstep', new THREE.Vector3(g.position.x + 1.4, 0, g.position.z - 1.2 + k * 0.1), 'concrete', 'player'); for (let q = 0; q < 80; q++) frame(); }
        const susChanges = ind.changes - (changesAtSus || 0), reactions = a.reactions;
        // she's recognised
        let n = 0, dip = false, alertAt = null, shownAt = null;
        while (n < 600 && !(a.state === 'ALERT' && ind.kind === 'alert' && +el.style.opacity > 0.9)) {
          if (a.state !== 'ALERT') { const q = g.position.clone().addScaledVector(g.forward(), 2); motor.teleport(q.x, q.z, g.yaw + Math.PI); }   // right in front of him
          frame(); n++; if (a.state === 'ALERT' && alertAt == null) alertAt = a.clock; if (alertAt != null && el.hidden) dip = true; if (alertAt != null && shownAt == null && ind.kind === 'alert' && !el.hidden) shownAt = a.clock;
        }
        const alertDelay = shownAt != null ? shownAt - alertAt : null;
        const alertTxt = el.textContent, alertCol = el.style.color;
        motor.teleport(-17, 15, 0);
        // the cycle; a sound during the walk back interrupts it once
        let t = 0, interrupted = false, backAfter = false;
        while (a.standDowns === 0 && t < 80) { frame(); t += dt; if (a.state === 'RETURNING' && !interrupted && a.clock - retStart > 2) { interrupted = true; noise.emit(3, 'footstep', new THREE.Vector3(9, 0, -12), 'metal', 'player'); } if (interrupted && a.state === 'HEIGHTENED' && !el.hidden) backAfter = true; }
        for (let k = 0; k < 60; k++) frame();
        const endShown = !el.hidden;
        const sets = {}; for (const s in byState) sets[s] = [...byState[s]].filter(x => x !== '-').sort().join('/');
        return { alertDelay, shown: Object.keys(shown).sort().join(','), colors: shown, sets, normalShown, susChanges, susDrops, reactions, alertTxt, alertCol, dip, returnFadeEnd, backAfter, interrupted, endShown, standDowns: a.standDowns };
      };
      const out = {};
      for (const [k, p, d] of [['easy', 'easy', false], ['normal', 'normal', false], ['hard', 'hard', false], ['extreme', 'extreme', false], ['dev', 'extreme', true]]) out[k] = run(p, d);
      ind.cfg.preset = 'normal'; ind.cfg.devShowAll = false; a.cfg.evasionTime = 30; a.cfg.heightenedTime = 60; g.reset(); ind.hide();
      out.kinds = ind.cfg.kinds; out.returnFade = ind.cfg.returnFade;
      return out;
    });
    const E = r.easy, N = r.normal, H = r.hard, X = r.extreme, D = r.dev, K = r.kinds;
    const stateOk = x => !x.normalShown && (x.sets.SUSPICIOUS || '') === 'suspicion' && (x.sets.INVESTIGATING || '') === 'suspicion' && x.sets.ALERT === 'alert' && x.sets.EVASION === 'search' && x.sets.HEIGHTENED === 'searchSubdued' && !x.endShown;
    const ok = stateOk(E) && stateOk(D) && E.susChanges === 0 && E.susDrops === 0 && E.reactions === 1 && E.alertTxt === '!' && E.dip && E.alertDelay != null && E.alertDelay <= 0.2 && E.backAfter && E.returnFadeEnd != null && E.returnFadeEnd <= r.returnFade + 0.1
      && E.shown === 'alert,search,searchSubdued,suspicion' && N.shown === 'alert,suspicion' && H.shown === 'alert' && X.shown === '' && D.shown === E.shown
      && [E, N, H, X, D].every(x => x.standDowns === 1 && x.interrupted && !x.normalShown && !x.endShown)
      && K.suspicion.text === '?' && K.alert.text === '!' && K.searchSubdued.opacity < K.search.opacity;
    return { pass: ok, detail: `Easy: NORMAL nothing, SUSPICIOUS ${E.sets.SUSPICIOUS}, INVESTIGATING ${E.sets.INVESTIGATING} (6 footsteps: restarted ${E.susChanges}×, dips ${E.susDrops}, "huh" ×${E.reactions}), ALERT ${E.sets.ALERT} "${E.alertTxt}" ${E.alertCol} (cross-faded ${E.dip}, "!" showing ${E.alertDelay == null ? '-' : E.alertDelay.toFixed(2)} s after ALERT), EVASION ${E.sets.EVASION}, HEIGHTENED ${E.sets.HEIGHTENED}, RETURNING faded out in ${E.returnFadeEnd == null ? '-' : E.returnFadeEnd.toFixed(2)} s (≤ ${r.returnFade}), back with the interrupting sound ${E.backAfter}, gone at NORMAL ${!E.endShown}; kinds shown — Easy ${E.shown}, Normal ${N.shown}, Hard ${H.shown}, Extreme ${X.shown || 'none'}, developer override ${D.shown}; same cycle in every preset (stand-downs ${[E, N, H, X, D].map(x => x.standDowns).join('/')})` };
  },

  // the indicator on an iPhone-landscape page (frame loop running): above his head, small,
  // following him; clear of the "Huh" and of the personality card at close, medium and long
  // range; hidden off screen, behind the tall crate and beyond its distance; switched off,
  // only the indicator goes
  async awareIndicatorView() {
    const page = await touchPage();
    const r = await page.evaluate(() => {
      MV.renderer.setAnimationLoop(null);
      const g = MV.guard, ind = MV.indicator, card = MV.traitCard, cap = MV.caption, a = g.awareness, W = innerWidth, H = innerHeight, cam = new THREE.PerspectiveCamera(58, W / H, 0.1, 80);
      ind.cfg.devShowAll = true; g.reset();
      a.state = 'SUSPICIOUS';   // a display state for the view checks (the AI isn't stepped here)
      const head = () => g.head.getWorldPosition(new THREE.Vector3());
      const look = (x, y, z) => { const h = head(); cam.position.set(x, y, z); cam.lookAt(h.x, h.y - 0.3, h.z); cam.updateMatrixWorld(true); };
      const frames = n => { for (let i = 0; i < n; i++) { ind.update(1 / 60, cam, W, H); card.update(1 / 60, cam, W, H); cap.update(1 / 60, cam, W, H); } };
      const rect = id => document.getElementById(id).getBoundingClientRect(), inter = (p, q) => Math.max(0, Math.min(p.right, q.right) - Math.max(p.left, q.left)) * Math.max(0, Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top));
      const out = { dist: [] };
      for (const d of [3.5, 9, 15]) {
        ind.hide(); card.hide(); cap.hide(); look(g.position.x + 0.8, 2.0, g.position.z + d); cap.show(); frames(40);
        const ri = rect('mv-indicator'), rc = rect('mv-caption'), rt = rect('mv-trait'), hp = head().clone(); hp.y += ind.cfg.height; const p = hp.project(cam), hx = (p.x + 1) / 2 * W, hy = (1 - p.y) / 2 * H;
        out.dist.push({ d, all: ind.visible && cap.visible && card.visible, huh: inter(ri, rc), card: inter(ri, rt), above: ri.bottom <= rc.top + 0.5, dx: (ri.left + ri.right) / 2 - hx, h: ri.height, w: ri.width, fs: document.getElementById('mv-indicator').style.fontSize });
      }
      // follows him: moved 2 m, the indicator moves with his head (no lag)
      ind.hide(); look(g.position.x + 0.8, 2.0, g.position.z + 9); frames(30); const r0 = rect('mv-indicator');
      g.motor.teleport(g.position.x + 1, g.position.z, g.yaw); g.place(); g.root.updateMatrixWorld(true); frames(1);
      const r1 = rect('mv-indicator'), hp = head().clone(); hp.y += ind.cfg.height; const p1 = hp.project(cam); out.follow = Math.abs((r1.left + r1.right) / 2 - (p1.x + 1) / 2 * W); out.moved = Math.abs(r1.left - r0.left);
      g.reset(); a.state = 'SUSPICIOUS';
      // hidden: off screen, behind the crate, too far
      ind.hide(); look(2, 2.2, -10); frames(30); out.clear = ind.visible;
      look(2, 2.2, -10); cam.position.set(2, 2.2, -10); cam.lookAt(2, 2, 5); cam.updateMatrixWorld(true); frames(10); out.off = { vis: ind.visible, why: ind.why };
      ind.hide(); look(2, 2.2, -10); frames(30); look(-4, 1.6, -4); frames(60); out.crate = { vis: ind.visible, why: ind.why };
      ind.hide(); look(2, 3, 13); frames(30); out.far = { vis: ind.visible, why: ind.why };
      // switched off: only the indicator goes
      ind.hide(); card.hide(); cap.hide(); look(2, 2.2, -10); cap.show(); ind.cfg.enabled = false; frames(30); out.off2 = { ind: ind.visible || !document.getElementById('mv-indicator').hidden, card: card.visible, huh: cap.visible };
      ind.cfg.enabled = true; ind.cfg.devShowAll = false; a.state = 'NORMAL'; g.reset(); ind.hide(); cap.hide();
      return out;
    });
    const ok = r.dist.every(x => x.all && x.huh === 0 && x.card === 0 && x.above && Math.abs(x.dx) < 2 && x.h < 24 && x.w < 24) && r.follow < 1 && r.moved > 5
      && r.clear && !r.off.vis && r.off.why === 'off screen' && !r.crate.vis && r.crate.why === 'behind cover' && !r.far.vis && r.far.why === 'too far'
      && !r.off2.ind && r.off2.card && r.off2.huh && page.errors.length === 0;
    return { pass: ok, detail: r.dist.map(x => `${x.d} m: "?" ${x.w.toFixed(0)}×${x.h.toFixed(0)} px (${x.fs}) centred over his head (${x.dx.toFixed(1)} px), above the "Huh" ${x.above}, overlap with "Huh" ${x.huh.toFixed(0)} px² and with the card ${x.card.toFixed(0)} px²`).join('; ') + `; follows his head within ${r.follow.toFixed(2)} px when he moves; clear view shown ${r.clear}, ${r.off.why}, ${r.crate.why}, ${r.far.why}; switched off: indicator ${r.off2.ind ? 'still shown' : 'gone'}, card ${r.off2.card}, "Huh" ${r.off2.huh}; page errors ${page.errors.length}` };
  },

  // switching the indicators never changes what the guard does: the same 60 s on two
  // fresh pages, one with every indicator shown (developer override) and one with them all
  // off (Extreme), gives exactly the same states, notes, positions and suspicion
  async awareIndicatorAI() {
    const once = async dev => { const page = await simPage(); const r = await page.evaluate(dev => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60, ind = MV.indicator, cam = MV.camera;
      ind.cfg.preset = dev ? 'easy' : 'extreme'; ind.cfg.devShowAll = dev; useProfile('B'); g.patrol.enabled = true; g.reset(); motor.teleport(-17, 15, 0);
      const trace = []; let showed = 0;
      for (let f = 0; f < 60 * 60; f++) {
        if (f === 600) { const b = g.position.clone().addScaledVector(g.forward(), -2); for (let k = 0; k < 3; k++) noise.emit(2, 'footstep', b.clone().add(new THREE.Vector3(k * 0.2, 0, 0)), 'concrete', 'player'); }
        if (f === 1500) { const q = g.position.clone().addScaledVector(g.forward(), 3); motor.teleport(q.x, q.z, g.yaw + Math.PI); }
        if (f === 1700) motor.teleport(-17, 15, 0);
        step(0, 'stand'); noise.update(dt); g.update(dt, T);
        cam.position.set(g.position.x + 3, 2.5, g.position.z + 6); cam.lookAt(g.position.x, 1.4, g.position.z); cam.updateMatrixWorld(true); ind.update(dt, cam, 640, 300); if (ind.visible) showed++;
        if (f % 30 === 0) trace.push([a.state, a.behavior, a.note, g.patrol.state, g.position.x.toFixed(4), g.position.z.toFixed(4), g.yaw.toFixed(4), a.suspicion.toFixed(4)].join(','));
      }
      return { trace: trace.join('|'), showed, states: [...new Set(trace.map(t => t.split(',')[0]))].join('/') };
    }, dev); await page.close(); return r; };
    const on = await once(true), off = await once(false);
    const ok = on.trace === off.trace && on.showed > 60 && off.showed === 0 && /SUSPICIOUS|INVESTIGATING/.test(on.states);
    return { pass: ok, detail: `60 s with every indicator shown (${on.showed} frames visible) vs all off (${off.showed}): identical states, notes, positions and suspicion ${on.trace === off.trace} (through ${on.states})` };
  },

  // Step 12, 1–7: an unsuspecting guard recognises her at close (1.6 m), medium (6 m) and
  // long (12 m) range. ALERT comes on the very frame his meter fills, exactly as with the
  // startle switched off; one startle each, lasting 1.8 / 1.2 / 0.8 s; while it lasts he's not
  // ready for offensive actions (vulnerable), then ready; his eyes keep working (she moves:
  // last-seen keeps updating); the recoil eases in and out with no snaps or joint pops, his
  // feet and position untouched
  async startleTrigger() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, v = g.vision, T = MV.seeTarget, dt = 1 / 60, B = g.bones, sc = a.cfg.startle;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); } };
      const one = (d, on) => {
        sc.enabled = on; g.patrol.enabled = false; g.reset(); motor.teleport(-17, 15, 0); sim(30);
        const fw = g.forward(), side = new THREE.Vector3(fw.z, 0, -fw.x), q = g.position.clone().addScaledVector(fw, d);
        motor.teleport(q.x, q.z, g.yaw + Math.PI); for (let k = 0; k < 2; k++) step(0, 'stand');
        let f = 0, fullF = null, alertF = null; while (alertF == null && f < 900) { sim(1); f++; if (fullF == null && v.meter >= 1) fullF = f; if (a.state === 'ALERT') alertF = f; }
        const out = { fullF, alertF, startles: a.startles, note: a.startleNote, dur: a.startle ? a.startle.duration : 0, band: a.startle ? a.startle.band : '' };
        if (!on) return out;
        // through the startle: she edges sideways in plain view; he keeps seeing her
        const pos0 = g.position.clone(), prevQ = {}; let lastPos = g.position.clone(), maxJump = 0, lastAmt = a.startleAmount(), maxAmtStep = 0, maxRot = 0, pops = 0, readyDuring = 0, vulnFrames = 0, seenUpdates = 0, lastSeen = a.seen.position.clone(), lastFoot = null, footSlide = 0, readyAt = null, t0 = a.clock, peak = 0;
        for (let k = 0; k < Math.round((out.dur + 0.5) * 60); k++) {
          motor.position.addScaledVector(side, 0.01);
          sim(1);
          if (a.isStartled()) { vulnFrames++; if (a.offenseReady()) readyDuring++; } else if (readyAt == null) readyAt = a.clock - t0;
          peak = Math.max(peak, a.startleAmount()); maxAmtStep = Math.max(maxAmtStep, Math.abs(a.startleAmount() - lastAmt)); lastAmt = a.startleAmount();
          maxJump = Math.max(maxJump, g.position.distanceTo(lastPos)); lastPos.copy(g.position);
          if (a.seen.position.distanceTo(lastSeen) > 1e-4) { seenUpdates++; lastSeen = a.seen.position.clone(); }
          const ri = g.root.getWorldQuaternion(new THREE.Quaternion()).invert();
          for (const nm of ['spine1', 'chest', 'neck', 'head', 'leftArm', 'rightArm']) { const qq = ri.clone().multiply(B[nm].getWorldQuaternion(new THREE.Quaternion())); if (prevQ[nm]) { const ang = 2 * Math.acos(Math.min(1, Math.abs(qq.dot(prevQ[nm])))) * 57.3; maxRot = Math.max(maxRot, ang); if (ang > 9) pops++; } prevQ[nm] = qq; }
          const ft = B.leftFoot.getWorldPosition(new THREE.Vector3()); if (lastFoot && g.isStill()) footSlide = Math.max(footSlide, Math.hypot(ft.x - lastFoot.x, ft.z - lastFoot.z)); lastFoot = ft;
        }
        Object.assign(out, { maxJump, maxAmtStep, moved: g.position.distanceTo(pos0), maxRot, pops, readyDuring, vulnFrames, seenUpdates, readyAt, peak, footSlide, stateEnd: a.state, readyEnd: a.offenseReady() });
        return out;
      };
      const res = {};
      for (const [k, d] of [['close', 1.6], ['medium', 6], ['far', 12]]) res[k] = { on: one(d, true), off: one(d, false) };
      sc.enabled = true; g.reset();
      res.cfg = sc.durations; return res;
    });
    const D = r.cfg, bands = ['close', 'medium', 'far'];
    const ok = bands.every(b => { const o = r[b].on, f = r[b].off; return o.alertF != null && o.alertF === o.fullF && o.alertF === f.alertF && f.startles === 0 && o.startles === 1 && o.band === b && Math.abs(o.dur - D[b]) < 1e-9
      && o.readyDuring === 0 && Math.abs(o.vulnFrames / 60 - D[b]) < 0.05 && o.readyAt != null && Math.abs(o.readyAt - D[b]) < 0.05 && o.readyEnd && o.seenUpdates >= 3 && o.pops === 0 && o.maxAmtStep <= 0.13 && o.peak > 0.99 && o.maxJump < 0.03 && o.footSlide < 0.01 && o.stateEnd === 'ALERT'; });
    const d = b => { const o = r[b].on; return `${b}: ALERT on frame ${o.alertF} (meter full ${o.fullF}; startle off: ${r[b].off.alertF}), startled ${o.dur} s (${o.note}), not ready for ${(o.vulnFrames / 60).toFixed(2)} s then ready at ${o.readyAt == null ? '-' : o.readyAt.toFixed(2)} s, last-seen updated ${o.seenUpdates}× during it, startle motion ≤ ${(o.maxAmtStep * 100).toFixed(0)}% per frame (upper body ≤ ${o.maxRot.toFixed(1)}°/frame), joint pops ${o.pops}, largest per-frame move ${(o.maxJump * 100).toFixed(1)} cm, standing foot slide ${(o.footSlide * 100).toFixed(1)} cm`; };
    return { pass: ok, detail: bands.map(d).join('; ') };
  },

  // Step 12, 8, 9, 6: no repeats. Startled close up, she slips away at once: the grace runs
  // as usual and EVASION starts while he's still recovering (he isn't held in ALERT). Five
  // times she reappears during the search and ducks away again: ALERT each time, no new
  // startle (the guard never freezes again). Seen during Heightened Security: no startle.
  // Rediscovered right after he stood down: no startle (still on guard); after the rearm
  // time a genuinely new discovery startles him again
  async startleRepeat() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, T = MV.seeTarget, dt = 1 / 60, sc = a.cfg.startle;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); } };
      const front = d => { const q = g.position.clone().addScaledVector(g.forward(), d); motor.teleport(q.x, q.z, g.yaw + Math.PI); for (let k = 0; k < 2; k++) step(0, 'stand'); };
      const until = (fn, max) => { let n = 0; while (!fn() && n < max) { sim(1); n++; } return n; };
      g.patrol.enabled = false; g.reset(); a.cfg.evasionTime = 30; a.cfg.heightenedTime = 12; motor.teleport(-17, 15, 0); sim(30);
      front(1.6); until(() => a.state === 'ALERT', 300); const t0 = a.clock;
      motor.teleport(-17, 15, 0); until(() => a.state === 'EVASION', 300);
      const evasionAt = a.clock - t0, startledThen = a.isStartled(), grace = a.cfg.alertGrace;
      // five reappearances during the search
      let reAlerts = 0, notReadyFrames = 0; sim(240);
      for (let k = 0; k < 5; k++) { front(3); const n = until(() => a.state === 'ALERT', 300); if (n < 300) reAlerts++; for (let q = 0; q < 30; q++) { sim(1); if (!a.offenseReady()) notReadyFrames++; } motor.teleport(-17, 15, 0); until(() => a.state === 'EVASION', 300); sim(120); }
      const afterLoop = { startles: a.startles, note: a.startleNote };
      // Heightened Security
      until(() => a.state === 'HEIGHTENED', 60 * 60); sim(60); front(3); until(() => a.state === 'ALERT', 300); const hsStartles = a.startles, hsNote = a.startleNote;
      // stand down, then rediscovered at once
      motor.teleport(-17, 15, 0); until(() => a.standDowns > 0, 120 * 60); sim(120);
      front(1.6); until(() => a.state === 'ALERT', 300); const soonStartles = a.startles, soonNote = a.startleNote;
      // and once more after the rearm time
      motor.teleport(-17, 15, 0); until(() => a.standDowns > 1, 150 * 60); const sd2 = a.standDowns; sim(Math.round((sc.rearmTime + 1) * 60));
      front(1.6); until(() => a.state === 'ALERT', 300); const laterStartles = a.startles, laterNote = a.startleNote;
      a.cfg.evasionTime = 30; a.cfg.heightenedTime = 60; g.reset();
      return { evasionAt, startledThen, grace, reAlerts, notReadyFrames, afterLoop, hsStartles, hsNote, soonStartles, soonNote, sd2, laterStartles, laterNote };
    });
    const ok = Math.abs(r.evasionAt - r.grace) < 0.15 && r.startledThen && r.reAlerts === 5 && r.notReadyFrames === 0 && r.afterLoop.startles === 1 && /reacquired/.test(r.afterLoop.note)
      && r.hsStartles === 1 && r.soonStartles === 1 && /still on guard/.test(r.soonNote) && r.sd2 >= 2 && r.laterStartles === 2 && /startled/.test(r.laterNote);
    return { pass: ok, detail: `slipped away mid startle: EVASION after ${r.evasionAt.toFixed(2)} s (grace ${r.grace} s) while still startled ${r.startledThen}; 5 reappearances in the search: ALERT ${r.reAlerts}×, frames not ready ${r.notReadyFrames}, startles still ${r.afterLoop.startles} ("${r.afterLoop.note}"); seen in Heightened Security: startles ${r.hsStartles}; rediscovered right after standing down: startles ${r.soonStartles} ("${r.soonNote}"); after the rearm time: startles ${r.laterStartles} ("${r.laterNote}")` };
  },

  // Step 12, 10: the "huh" and the startle never stack. A sound starts his 0.8 s pause; she's
  // recognised during it: ALERT on the same frame as without the sound, no "huh", and the
  // startle begins at that frame and lasts its own 1.8 s (not pause + startle). A glimpse
  // gives one "huh", then she stays in view: the startle follows recognition as usual and no
  // second vocal reaction. Suspicious for a while beforehand, he's partly prepared (×0.75)
  async startleHuh() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, a = g.awareness, v = g.vision, T = MV.seeTarget, dt = 1 / 60, sc = a.cfg.startle, cap = MV.caption;
      const sim = n => { for (let i = 0; i < n; i++) { step(0, 'stand'); noise.update(dt); g.update(dt, T); } };
      const until = (fn, max) => { let n = 0; while (!fn() && n < max) { sim(1); n++; } return n; };
      const fresh = () => { g.patrol.enabled = false; g.reset(); cap.hide(); motor.teleport(-17, 15, 0); sim(30); };
      const front = d => { const q = g.position.clone().addScaledVector(g.forward(), d); motor.teleport(q.x, q.z, g.yaw + Math.PI); for (let k = 0; k < 2; k++) step(0, 'stand'); };
      const out = {};
      fresh(); sim(6); front(1.6); out.quiet = until(() => a.state === 'ALERT', 300);
      fresh(); noise.emit(2, 'footstep', new THREE.Vector3(g.position.x + 3, 0, g.position.z - 2), 'concrete', 'player'); sim(6); const pausing = a.incident && a.clock < a.incident.reactAt;
      front(1.6); out.noisy = until(() => a.state === 'ALERT', 300);
      out.pausing = pausing; out.huh1 = a.reactions; out.startStart = a.startle ? +(a.startle.start - a.confirmedAt).toFixed(4) : null; out.dur1 = a.startle ? a.startle.duration : 0;
      // a glimpse: one "huh", then she stays until recognised
      fresh(); const off = g.yaw - Math.PI / 4; motor.teleport(g.position.x + Math.sin(off) * 9, g.position.z + Math.cos(off) * 9, off + Math.PI);
      until(() => a.reactions > 0, 300); const huhT = a.clock;
      until(() => a.state === 'ALERT', 1200); out.huh2 = a.reactions; out.band2 = a.startle && a.startle.band; out.dur2 = a.startle ? a.startle.duration : 0; out.gap = a.clock - huhT; out.from2 = a.startle && a.startle.from;
      for (let k = 0; k < 5; k++) { sim(1); cap.update(dt, MV.camera, 640, 300); } out.capAfter = cap.active; out.kind2 = a.incident && a.incident.kind;
      out.cfg = sc;
      return out;
    });
    const D = r.cfg.durations, expected2 = D[r.band2];   // her own glimpse growing into recognition: still a surprise (prepared only after something heard)
    const ok = r.pausing && r.noisy === r.quiet && r.huh1 === 0 && r.startStart === 0 && Math.abs(r.dur1 - D.close) < 1e-9
      && r.huh2 === 1 && r.band2 && Math.abs(r.dur2 - expected2) < 0.01 && !r.capAfter;
    return { pass: ok, detail: `recognised during the 0.8 s pause: ALERT after ${r.noisy} frames (no sound: ${r.quiet}), "huh" ×${r.huh1}, startle began ${r.startStart} s after recognition and lasts ${r.dur1} s (close range, nothing added); a glimpse: "huh" ×1, recognised ${r.gap.toFixed(1)} s later from ${r.from2} (${r.band2} range): startle ${r.dur2.toFixed(2)} s (expected ${expected2.toFixed(2)}: a glimpse growing into recognition is still a surprise), "huh" still ×${r.huh2}, caption gone ${!r.capAfter}` };
  },

  // Step 12 with real iPhone touches, patrol and personality on (frame loop running): she
  // sneaks around in front of him at close range as he walks his route; he's recognised her:
  // ALERT, the red "!" over him, startled (close) per the STATS row, his patrol interrupted
  // and the personality card still beside him; she runs off: the search begins as usual
  async startleTouch() {
    const page = await patrolPage(true), Tc = page.touch, X = 150, Y = 300;
    await page.evaluate(() => { useProfile('B'); document.getElementById('mv-stats').hidden = false; MV.guard.reset(); MV.motor.teleport(-17, 15, 0); MV.cam.snap(MV.motor); });
    await page.waitForFunction(() => MV.guard.patrol.state === 'walking' && MV.guard.patrol.index === 1 && Math.hypot(MV.guard.position.x - 2, MV.guard.position.z + 16) > 3, null, { timeout: 60000 }).catch(() => {});
    // she's beside him (just out of his cone), then steps round in front of him with the stick
    await page.evaluate(() => { const g = MV.guard, s = new THREE.Vector3(g.forward().z, 0, -g.forward().x), b = g.position.clone().addScaledVector(s, 1.3).addScaledVector(g.forward(), -1.2); MV.motor.teleport(b.x, b.z, Math.atan2(g.position.x - b.x, g.position.z - b.z)); MV.cam.snap(MV.motor);
      window.__tgt = g.position.clone().addScaledVector(g.forward(), 1.4).addScaledVector(s, 0.5); for (const f of MV.footsteps.feet) { f.down = true; f.prev = null; f.at = null; } window.__w = { alertF: null, startled: '', ind: '', card: false }; const a = g.awareness;
      (function f() { const w = window.__w; if (w.alertF == null && a.state === 'ALERT') w.alertF = a.clock; if (a.isStartled()) { w.startled = document.getElementById('mv-startle').textContent; const el = document.getElementById('mv-indicator'); if (!el.hidden) w.ind = el.textContent + '|' + el.style.color; w.card = w.card || MV.traitCard.visible; w.patrol = g.patrol.state; } if (!window.__stop) requestAnimationFrame(f); })(); });
    await Tc('touchStart', [{ x: X, y: Y, id: 1 }]);
    for (let i = 0; i < 40 && !(await page.evaluate(() => MV.guard.awareness.state === 'ALERT')); i++) {
      const st = await page.evaluate(() => { const f = MV.cam.forward(new THREE.Vector3()), p = MV.motor.position, t = window.__tgt, wx = t.x - p.x, wz = t.z - p.z, l = Math.hypot(wx, wz) || 1; return { mx: (wx * -f.z + wz * f.x) / l, my: (wx * f.x + wz * f.z) / l }; });
      await Tc('touchMove', [{ x: X + st.mx * 45, y: Y - st.my * 45, id: 1 }]); await page.waitForTimeout(120);
    }
    await Tc('touchEnd', []);
    await page.waitForTimeout(600);
    const mid = await page.evaluate(() => ({ state: MV.guard.awareness.state, startle: MV.guard.awareness.startle, startles: MV.guard.awareness.startles, w: window.__w }));
    // she runs off out of sight
    await page.evaluate(() => { MV.motor.teleport(-17, 15, 0); MV.cam.snap(MV.motor); });
    await page.waitForFunction(() => MV.guard.awareness.state === 'EVASION', null, { timeout: 10000 }).catch(() => {});
    const end = await page.evaluate(() => { window.__stop = true; return { state: MV.guard.awareness.state, startles: MV.guard.awareness.startles }; });
    await page.evaluate(() => { MV.guard.personality.enabled = false; MV.guard.reset(); });
    const ok = mid.startles === 1 && mid.startle && mid.startle.band === 'close' && /STARTLED \(close\)/.test(mid.w.startled) && /^!\|/.test(mid.w.ind) && mid.w.patrol === 'interrupted' && end.state === 'EVASION' && end.startles === 1 && page.errors.length === 0;
    return { pass: ok, detail: `stepped round in front of him on his route: ${mid.state}, startled ${mid.startle ? mid.startle.band + ' ' + mid.startle.duration + ' s at ' + mid.startle.distance.toFixed(1) + ' m' : 'no'}; STATS "${mid.w.startled}"; indicator "${mid.w.ind}"; personality card shown ${mid.w.card}; patrol ${mid.w.patrol}; she ran off: ${end.state}, startles ${end.startles}; page errors ${page.errors.length}` };
  },

  // crouch idle: both feet on the ground (lowest skinned vertex near each foot)
  async groundContact() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, visual } = MV, B = visual.bones;
      for (let f = 0; f < 300; f++) step(0, 'crouch');
      let mesh; visual.root.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
      const pos = mesh.geometry.attributes.position, v = new THREE.Vector3(), g = motor.position.y;
      return ['left', 'right'].map(s => {
        const c = W(B[s + 'Foot']).lerp(W(B[s + 'Toe']), 0.5); let mn = 1e9;
        for (let i = 0; i < pos.count; i += 3) { mesh.boneTransform(i, v.fromBufferAttribute(pos, i)); v.applyMatrix4(mesh.matrixWorld); if (v.distanceTo(c) < 0.18) mn = Math.min(mn, v.y); }
        return mn - g;
      });
    });
    return { pass: r.every(h => h <= 0.03), detail: `crouch idle feet lowest point L ${cm(r[0])}, R ${cm(r[1])}` };
  },

  // limbs keep clear of the body: hands vs shins, thighs vs the spine
  async clearance() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, visual } = MV, B = visual.bones, out = {};
      for (const [name, m] of [['crouch idle', 0], ['fast crouch', 0.88]]) {
        motor.teleport(-6, -20, 0); let hand = 1e9, thigh = 1e9;
        for (let f = 0; f < 400; f++) {
          step(m, 'crouch'); if (f < 250) continue;
          for (const s of ['left', 'right']) {
            hand = Math.min(hand, segDist(W(B[s + 'Hand']), W(B[s + 'Leg']), W(B[s + 'Foot'])));
            const k = W(B[s + 'Leg']), mid = k.clone().lerp(W(B[s + 'UpLeg']), 0.4);
            thigh = Math.min(thigh, segDist(k, W(B.spine), W(B.neck)), segDist(mid, W(B.spine1), W(B.neck)));
          }
        }
        out[name] = [hand, thigh];
      }
      return out;
    });
    const rows = Object.entries(r);
    // still pose ≥ 15 cm; the crouch-walk arm swing passes closer (≈13 cm as approved), so ≥ 12 cm there
    return { pass: rows.every(([k, v]) => v[0] >= (k === 'crouch idle' ? 0.15 : 0.12) && v[1] >= 0.15), detail: rows.map(([k, v]) => `${k}: hand–shin ${cm(v[0])}, thigh–body ${cm(v[1])}`).join('; ') };
  },
};

// ---------------------------------------------------------------- run
(async () => {
  const only = process.argv.slice(2);
  const names = only.length ? only : Object.keys(CHECKS);
  for (const n of names) if (!CHECKS[n]) { console.error('unknown check: ' + n + ' (have: ' + Object.keys(CHECKS).join(', ') + ')'); process.exit(2); }
  const { chromium } = loadPlaywright();
  const server = await serve();
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ args: GL_ARGS });
  let failed = 0;
  for (const n of names) {
    const t0 = Date.now();
    let r;
    try { r = await CHECKS[n](); } catch (e) { r = { pass: false, detail: 'crashed: ' + (e && e.message || e) }; }
    if (!r.pass) failed++;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${n.padEnd(14)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s  ${r.detail}`);
    for (const ctx of browser.contexts()) await ctx.close();
  }
  await browser.close(); server.close();
  console.log(failed ? `\n${failed} of ${names.length} checks failed` : `\nall ${names.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
