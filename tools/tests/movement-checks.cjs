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
  await _noDamageUnlessCombat(page);
  page.errors = errors;
  return page;
}

// Step 22: guards can shoot her. The checks written before it test other things with her in a
// guard's sight for a long time, so there her health takes no damage (the guards still see,
// draw, fire and make their noise; only the damage is off). The Step 22 checks turn it on
async function _noDamageUnlessCombat(page) {
  await page.evaluate(() => { const P = MV.playerHealth; if (!P || P.__wrapped) return; const t = P.take.bind(P); P.take = ev => window.__combat ? t(ev) : { applied: false, why: 'test: damage off' }; P.__wrapped = true; });
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
  await page.evaluate(() => { MV.setStats(true); });   // (Step 24.1: a level starts with STATS collapsed; these checks were written with it open)
  await page.evaluate(() => {
    MV.guard.patrol.enabled = false; MV.guard.personality.enabled = false; MV.guard.reset();   // stationary, neutral guard (see simPage)
    window.useProfile = (k, extra) => { const g = MV.guard; g.personality = new MV.SCmv.GuardPersonality(g, Object.assign({}, MV.area.profiles[k], extra || {})); return g.personality; };
  });
  const cdp = await ctx.newCDPSession(page);
  page.touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await _noDamageUnlessCombat(page);
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
      // 1.8 s of game time (frames are capped at 1/20 s, so a slow container would otherwise give her less)
      const t0 = await page.evaluate(() => MV.guard.awareness.clock);
      await page.waitForFunction(t0 => MV.guard.awareness.clock >= t0 + 1.8, t0, { timeout: 20000, polling: 'raf' });
      const r = await page.evaluate(() => [MV.motor.speed, MV.motor.gait.label]);
      await T('touchEnd', []); await page.waitForTimeout(1200);
      return r;
    };
    const wobble = async (dy) => {
      await page.evaluate(() => { MV.motor.teleport(-6, -20, 0); MV.cam.snap(MV.motor); });
      await T('touchStart', [{ x: X, y: Y0, id: 1 }]); await T('touchMove', [{ x: X, y: Y0 - dy, id: 1 }]);
      // 1.2 s of game time to reach speed (as hold(): the 3.8 m/s jog of Step 24.2 crosses the
      // walk/jog label line ~0.9 s in, which 1.2 s of wall time on a loaded container could miss)
      const t0 = await page.evaluate(() => MV.guard.awareness.clock);
      await page.waitForFunction(t0 => MV.guard.awareness.clock >= t0 + 1.2, t0, { timeout: 20000, polling: 'raf' });
      await page.evaluate(() => { window.__g = []; (function f() { window.__g.push(MV.motor.gait.label); if (window.__g.length < 400) requestAnimationFrame(f); })(); });
      for (let i = 0; i < 24; i++) { await T('touchMove', [{ x: X + (i % 2 ? 1 : -1), y: Y0 - dy + (i % 2 ? 2 : -2), id: 1 }]); await page.waitForTimeout(100); }
      const g = await page.evaluate(() => window.__g); let flips = 0; for (let i = 1; i < g.length; i++) if (g[i] !== g[i - 1]) flips++;
      await T('touchEnd', []); await page.waitForTimeout(1200);
      return flips;
    };
    let ok = true;
    // Step 24.2 approved speeds: stealth walk 2.4, jog 3.8 (bands were 1.85–2.05 / 3.1–3.3; same ±0.1 width)
    for (const [dy, label, lo, hi] of [[25, 'SNEAK', 1.0, 1.3], [50, 'STEALTH WALK', 2.3, 2.5], [64, 'JOG', 3.7, 3.9]]) {
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
        // each row from the open test spot: at the 2.4 m/s stealth walk (Step 24.2) 11 s
        // from wherever the last row ended reached the north wall and sampled an idle pose
        MV.motor.teleport(-6, -20, 0);
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
      while ((n = walker.nextNode())) { const s = n.textContent.trim(); const el = n.parentElement; if (/^[!?¿¡]+$/.test(s) && el && el.offsetParent !== null && !el.classList.contains('mv-indicator')) gl++; }   // (the approved awareness indicators, one per guard, are their own check)
      return { sp, gl };
    });
    for (const [label, px] of [['sneak', 25], ['stealth walk', 50], ['jog', 64]]) {
      await page.evaluate(() => {
        const g = MV.guard; g.post.set(0, 0, 1.5); g.postYaw = Math.PI; g.reset();
        MV.motor.teleport(-4.6, 5.2, Math.PI / 2); MV.cam.snap(MV.motor);
        window.__r = { heard: 0, surfaces: {}, v0: MV.voice.log.length, r2: MV.guard2.awareness.reactions };
        if (!window.__hooked) { window.__hooked = true; MV.noise.on(e => { if (e.source === 'player' && window.__r) setTimeout(() => { const h = MV.guard.hearing.heard; if (h && h.position.distanceTo(e.position) < 1e-6) { window.__r.heard++; window.__r.surfaces[e.surface] = (window.__r.surfaces[e.surface] || 0) + 1; } }, 0); }); }
      });
      await page.waitForTimeout(400);
      await steer(4.6, 5.2, px, 12000);
      const s1 = await scan(); glyphs += s1.gl; sprites += s1.sp;
      await page.waitForTimeout(1500);
      const s2 = await scan(); glyphs += s2.gl; sprites += s2.sp;
      const r = await page.evaluate(() => ({ heard: window.__r.heard, surfaces: window.__r.surfaces, voice: MV.voice.log.length - window.__r.v0 - (MV.guard2.awareness.reactions - window.__r.r2), g2voice: MV.guard2.awareness.reactions - window.__r.r2, reactions: MV.guard.awareness.reactions,   /* (Step 22: the voice log is shared; Guard 2 can now hear Guard 1's gunfire and react in his own voice) */ incidents: MV.guard.awareness.incidents, state: MV.guard.awareness.state, gait: MV.motor.gait.label }));
      runs.push(Object.assign({ label }, r));
    }
    // his body language moves only his own bones: the player's skeleton shares none of them
    const shared = await page.evaluate(() => { const g = MV.guard, pb = new Set(Object.values(MV.visual.bones)); return Object.values(g.bones).filter(b => pb.has(b)).length; });
    await page.evaluate(() => { const g = MV.guard; g.post.set(2, 0, -16); g.postYaw = 0; g.reset(); });
    const ok = runs.every(x => x.heard >= 3 && x.voice <= 1 && x.reactions <= 1 && x.incidents <= 1 && x.voice === x.reactions) && runs.filter(x => x.reactions === 1).length >= 2
      && runs.some(x => Object.keys(x.surfaces).length >= 2) && glyphs === 0 && sprites === 0 && shared === 0 && page.errors.length === 0;
    return { pass: ok, detail: runs.map(x => `${x.label}: ${x.heard} steps heard (${Object.entries(x.surfaces).map(([k, n]) => k + ' ' + n).join(', ')}) → ${x.voice} vocal reaction${x.g2voice ? ` (+${x.g2voice} from Guard 2, hearing the gunfire)` : ''}, ${x.incidents} incident, ${x.state}`).join('; ') + `; floating ?/! glyphs ${glyphs}, sprites/text/icons on him ${sprites}; bones shared with the player ${shared}; page errors ${page.errors.length}` };
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
    // 0.9 s of game time jogging (frames are capped at 1/20 s, so a slow container would otherwise give her less)
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 150, y: 236, id: 1 }]);
    { const t0 = await page.evaluate(() => MV.guard.awareness.clock); await page.waitForFunction(t0 => MV.guard.awareness.clock >= t0 + 0.9, t0, { timeout: 20000, polling: 'raf' }); } await Tc('touchEnd', []);
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

  // Step 13: grabs from the front, side and rear, and in every awareness state: NORMAL on
  // patrol, SUSPICIOUS, INVESTIGATING, startled ALERT, fully recovered ALERT facing her,
  // EVASION and HEIGHTENED SECURITY: all succeed (the startle isn't needed). Out of reach
  // (1.7 m) and through a wall they fail; a HOLD of the button does nothing (reserved)
  async cqcRules() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input, cam } = MV, g = MV.guard, a = g.awareness, cq = MV.cqc, dt = 1 / 60;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) step(0, 'stand'); else { MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); } noise.update(dt); g.update(dt, MV.seeTarget); };
      const sim = n => { for (let i = 0; i < n; i++) frame(); };
      const until = (fn, max) => { let n = 0; while (!fn() && n < max) { frame(); n++; } return n; };
      const place = (rel, d) => { const y = g.yaw + rel, p = g.position.clone().add(new THREE.Vector3(Math.sin(y) * d, 0, Math.cos(y) * d)); motor.teleport(p.x, p.z, Math.atan2(g.position.x - p.x, g.position.z - p.z)); for (let k = 0; k < 2; k++) step(0, 'stand'); };
      const tryGrab = () => { const before = a.state, startled = a.isStartled(); input.cqcTapped = true; frame(); const got = cq.state === 'GRABBING' || cq.state === 'GRAPPLING'; sim(40); const out = { before, startled, got, state: cq.state, restrained: !!g.restraint, after: a.state, why: cq.lastTry }; cq.cancel(); return out; };
      const fresh = patrol => { cq.cancel(); g.patrol.enabled = !!patrol; g.reset(); a.cfg.evasionTime = 30; a.cfg.heightenedTime = 60; motor.teleport(-17, 15, 0); sim(20); };
      const out = { dirs: {}, states: {} };
      for (const [k, rel] of [['front', 0], ['side', Math.PI / 2], ['rear', Math.PI]]) { fresh(); place(rel, 1.0); out.dirs[k] = tryGrab(); }
      // states
      fresh(true); until(() => g.patrol.state === 'walking' && g.moving, 600); place(Math.PI, 1.0); out.states.patrol = tryGrab();
      fresh(); noise.emit(1, 'footstep', g.position.clone().add(new THREE.Vector3(1.4, 0, -1)), 'concrete', 'player'); sim(60); place(Math.PI, 1.0); out.states.suspicious = tryGrab();
      fresh(); for (let k = 0; k < 3; k++) { noise.emit(3, 'footstep', g.position.clone().add(new THREE.Vector3(2.8, 0, -2.8)), 'concrete', 'player'); sim(3); } until(() => a.state === 'INVESTIGATING' && g.moving, 300); place(Math.PI, 1.0); out.states.investigating = tryGrab();
      fresh(); place(0, 1.2); until(() => a.state === 'ALERT', 300); sim(10); out.states.startled = tryGrab();
      fresh(); place(0, 1.2); until(() => a.state === 'ALERT', 300); sim(150); out.alertFacingSees = g.vision.seen.rate > 0; out.states.alertFacing = tryGrab();   // recovered, watching her, 1.2 m in front
      fresh(); a.cfg.evasionTime = 30; place(0, 3); until(() => a.state === 'ALERT', 300); motor.teleport(-17, 15, 0); until(() => a.state === 'EVASION', 300); sim(120); place(Math.PI, 1.0); out.states.evasion = tryGrab();
      fresh(); a.cfg.evasionTime = 3; place(0, 3); until(() => a.state === 'ALERT', 300); motor.teleport(-17, 15, 0); until(() => a.state === 'HEIGHTENED', 900); sim(60); place(Math.PI, 1.0); out.states.heightened = tryGrab();
      // failures
      fresh(); place(Math.PI, 1.7); input.cqcTapped = true; frame(); out.far = { state: cq.state, why: cq.lastTry };
      fresh(); g.motor.teleport(16.6, -4, 0); g.place(); motor.teleport(15.4, -4, Math.PI / 2); for (let k = 0; k < 2; k++) step(0, 'stand');
      out.wallDist = Math.hypot(g.position.x - motor.position.x, g.position.z - motor.position.z); input.cqcTapped = true; frame(); out.wall = { state: cq.state, why: cq.lastTry };
      // HOLD: nothing
      // HOLD (Step 16: the quick takedown, not a grab)
      fresh(); place(Math.PI, 1.0); input.cqcHeld = true; frame(); sim(20); out.hold = { state: cq.state, quick: !!(cq.thr && cq.thr.quick), restrained: !!g.restraint, note: cq.holdNote }; sim(80); out.hold.ko = g.ko.state;
      cq.cancel(); a.cfg.evasionTime = 30; a.cfg.heightenedTime = 60; g.reset();
      return out;
    });
    const all = Object.assign({}, r.dirs, r.states), ok = Object.values(all).every(x => x.got && x.state === 'GRAPPLING' && x.restrained && x.after === 'ALERT')
      && r.states.patrol.before === 'NORMAL' && r.states.suspicious.before === 'SUSPICIOUS' && r.states.investigating.before === 'INVESTIGATING' && r.states.startled.before === 'ALERT' && r.states.startled.startled
      && r.states.alertFacing.before === 'ALERT' && !r.states.alertFacing.startled && r.alertFacingSees && r.states.evasion.before === 'EVASION' && r.states.heightened.before === 'HEIGHTENED'
      && r.far.state === 'FREE' && r.far.why === 'out of reach' && r.wall.state === 'FREE' && /solid/.test(r.wall.why) && r.wallDist < 1.45 && r.hold.state === 'THROWING' && r.hold.quick && /quick takedown/.test(r.hold.note) && r.hold.ko === 'UNCONSCIOUS';
    const d = (k, x) => `${k} (${x.before}${x.startled ? ', startled' : ''}): ${x.got ? 'grabbed' : 'FAILED ' + x.why}`;
    return { pass: ok, detail: Object.entries(r.dirs).map(([k, x]) => d(k, x)).join('; ') + ' | ' + Object.entries(r.states).map(([k, x]) => d(k, x)).join('; ') + ` (fully recovered ALERT and seeing her: ${r.alertFacingSees}) | 1.7 m away: ${r.far.why}; ${r.wallDist.toFixed(2)} m apart through the corridor wall: ${r.wall.why}; HOLD: ${r.hold.state}${r.hold.quick ? ' (quick takedown)' : ''} ("${r.hold.note}") → ${r.hold.ko}` };
  },

  // Step 13: holding him. They stay aligned (0.55 m apart, facing the same way) through the
  // grab and while she moves him forward, turns and backs up; neither ever overlaps a wall
  // when she drives him into the tall crate; his own AI never moves him (no orders of his,
  // patrol interrupted), he's ALERT and stays in contact (no search starts) until just before his Step 17 break-free time (≥ 2 s), makes
  // no sound. RELEASE separates them, she moves normally again, he's free, still ALERT and
  // turns to her. RESET mid-grapple ends it cleanly
  async cqcRestraint() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input, world } = MV, g = MV.guard, a = g.awareness, cq = MV.cqc, dt = 1 / 60, wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
      let align = 0, yawErr = 0, jump = 0, ownMoves = 0, lp = motor.position.clone();
      const intr = (p, R) => { let w = 0; for (const b of world.boxes) { const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX), dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ); w = Math.max(w, R - Math.hypot(dx, dz)); } return w; };
      let worst = 0;
      const frame = (dx, dz, mag) => {
        const held = cq.update(dt, dx || 0, dz || 0, mag || 0);
        if (!held) motor.update(dt, dx || 0, dz || 0, mag || 0);
        MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true);
        noise.update(dt); g.update(dt, MV.seeTarget);
        if (cq.state === 'GRAPPLING') { align = Math.max(align, Math.abs(Math.hypot(g.position.x - motor.position.x, g.position.z - motor.position.z) - cq.cfg.holdOffset)); yawErr = Math.max(yawErr, Math.abs(wrap(g.yaw - motor.yaw)) * 57.3); if (g.moving || g.path) ownMoves++; worst = Math.max(worst, intr(g.position, g.cfg.radius), intr(motor.position, motor.cfg.radius)); }
        if (cq.state !== 'FREE') jump = Math.max(jump, motor.position.distanceTo(lp), g.position.distanceTo(window.__glp || g.position)); lp.copy(motor.position); window.__glp = g.position.clone();
      };
      const sim = (n, dx, dz, mag) => { for (let i = 0; i < n; i++) frame(dx, dz, mag); };
      cq.cancel(); g.patrol.enabled = true; g.reset(); motor.teleport(-17, 15, 0); sim(30);
      let n = 0; while (!(g.patrol.state === 'walking' && g.moving) && n < 600) { sim(1); n++; }
      const b = g.position.clone().addScaledVector(g.forward(), -1.0); motor.teleport(b.x, b.z, g.yaw); lp.copy(motor.position); for (let k = 0; k < 2; k++) step(0, 'stand');
      const r0 = a.reactions, c0 = MV.caption.shown;
      input.cqcTapped = true; sim(60);
      const grabbed = { state: cq.state, aware: a.state, patrol: g.patrol.state };
      // forward, turn right, back up: world directions relative to her facing
      const yaw0 = motor.yaw, p0 = motor.position.clone(); const F = () => [Math.sin(motor.yaw), Math.cos(motor.yaw)];
      let f = F(); sim(120, f[0], f[1], 1); const fwd = motor.position.clone().sub(p0).dot(new THREE.Vector3(Math.sin(yaw0), 0, Math.cos(yaw0)));
      const y1 = motor.yaw; for (let i = 0; i < 120; i++) { const y = motor.yaw + Math.PI / 2; frame(Math.sin(y), Math.cos(y), 1); } const turned = Math.abs(wrap(motor.yaw - y1)) * 57.3;
      const p2 = motor.position.clone(), y2 = motor.yaw; for (let i = 0; i < 120; i++) { const y = y2 + Math.PI; frame(Math.sin(y), Math.cos(y), 1); } const back = -motor.position.clone().sub(p2).dot(new THREE.Vector3(Math.sin(y2), 0, Math.cos(y2)));
      // held (she's behind him, out of his sight): contact the whole time. Since Step 17 he breaks
      // free after 10 s, so this hold runs to half a second before that
      const holdFor = cq.bf ? Math.max(0, cq.bf.left - 0.5) : 0;
      let notAlert = 0, sounds = 0; for (let i = 0; i < Math.round(holdFor * 60); i++) { frame(); if (a.state !== 'ALERT') notAlert++; } sounds = a.reactions - r0;
      // release (in the open)
      const relAt = motor.position.clone(); input.cqcTapped = true; sim(40);
      const rel = { state: cq.state, restrained: !!g.restraint, sep: Math.hypot(g.position.x - motor.position.x, g.position.z - motor.position.z), aware: a.state };
      // she sneaks off behind him: normal movement again; he stays on alert and hunts from where she was
      let spd = 0, calm = 0, patrolled = 0; const sy = motor.yaw + Math.PI / 2; for (let i = 0; i < 90; i++) { frame(Math.sin(sy), Math.cos(sy), 0.35); spd = Math.max(spd, motor.speed); }   // one fixed direction, to his side
      for (let i = 0; i < 300; i++) { frame(); if (a.state === 'NORMAL') calm++; if (g.patrol.state !== 'interrupted') patrolled++; }
      const after = { state: a.state, calm, patrolled, searchFrom: a.seen ? a.seen.position.distanceTo(relAt.clone().setY(0)) : 99 };
      // into the tall crate
      cq.cancel(); g.patrol.enabled = false; g.reset(); motor.teleport(-2, -11.5, 0); g.motor.teleport(-2, -10.5, 0); g.place(); for (let k = 0; k < 2; k++) step(0, 'stand'); lp.copy(motor.position); window.__glp = null;
      input.cqcTapped = true; sim(40); worst = 0; sim(240, 0, 1, 1); const crateWorst = worst; input.cqcTapped = true; sim(40);
      // RESET mid-grapple
      const bb = g.position.clone().addScaledVector(g.forward(), -1.0); motor.teleport(bb.x, bb.z, g.yaw); for (let k = 0; k < 2; k++) step(0, 'stand'); lp.copy(motor.position); window.__glp = null; input.cqcTapped = true; sim(30); const midState = cq.state;
      cq.cancel(); g.reset(); motor.teleport(MV.area.spawn.x, MV.area.spawn.z, MV.area.spawn.yaw); sim(30);
      const reset = { state: cq.state, restrained: !!g.restraint, aware: a.state, post: Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z) };
      return { grabbed, align, yawErr, jump, ownMoves, fwd, turned, back, notAlert, sounds, captions: MV.caption.shown - c0, crateWorst, rel, spd, after, midState, reset, holdFor };
    });
    const ok = r.grabbed.state === 'GRAPPLING' && r.grabbed.aware === 'ALERT' && r.grabbed.patrol === 'interrupted' && r.align < 0.02 && r.yawErr < 1 && r.jump < 0.06 && r.ownMoves === 0
      && r.fwd > 0.6 && r.turned > 60 && r.back > 0.35 && r.holdFor >= 2 && r.notAlert === 0 && r.sounds === 0 && r.captions === 0 && r.crateWorst < 0.02
      && r.rel.state === 'FREE' && !r.rel.restrained && r.rel.sep > 0.9 && r.rel.aware === 'ALERT' && r.spd > 0.95 && r.spd < 1.35 && r.after.calm === 0 && r.after.patrolled === 0 && (r.after.state === 'ALERT' || r.after.state === 'EVASION') && r.after.searchFrom < 2
      && r.midState === 'GRAPPLING' && r.reset.state === 'FREE' && !r.reset.restrained && r.reset.aware === 'NORMAL' && r.reset.post < 0.01;
    return { pass: ok, detail: `grabbed on his patrol: ${r.grabbed.state}, he's ${r.grabbed.aware}, patrol ${r.grabbed.patrol}; held: spacing within ${(r.align * 100).toFixed(1)} cm of ${0.55} m, facing within ${r.yawErr.toFixed(2)}°, largest per-frame move ${(r.jump * 100).toFixed(1)} cm, his own movement orders ${r.ownMoves}; moved him ${r.fwd.toFixed(2)} m forward, turned ${r.turned.toFixed(0)}°, backed up ${r.back.toFixed(2)} m; ${r.holdFor.toFixed(1)} s held: not ALERT ${r.notAlert} frames, vocal reactions ${r.sounds}, captions ${r.captions}; pushed into the tall crate: deepest overlap ${(Math.max(0, r.crateWorst) * 100).toFixed(1)} cm; RELEASE: ${r.rel.state}, ${r.rel.sep.toFixed(2)} m apart, he's ${r.rel.aware}, then she sneaks off at ${r.spd.toFixed(2)} m/s; 5 s later he's ${r.after.state} (calm frames ${r.after.calm}, patrolling frames ${r.after.patrolled}), hunting from ${r.after.searchFrom.toFixed(2)} m of where she let go; RESET mid-grapple (${r.midState}): ${r.reset.state}, restrained ${r.reset.restrained}, ${r.reset.aware}, at his post ${r.reset.post.toFixed(2)} m` };
  },

  // Step 13 with real iPhone touches (frame loop running, patrol on): she walks up behind
  // him with the stick and taps CQC: GRAPPLING, the button reads RELEASE; the stick moves him;
  // the camera drag still works; tapping RELEASE frees him (button back to CQC); holding CQC
  // for a second near him (Step 16) takes him down instead of grabbing him; RESET mid-grapple
  // clears it
  async cqcTouch() {
    const page = await patrolPage(true), Tc = page.touch;
    const btn = async () => { const b = await page.locator('#mv-cqc').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tap = async (ms) => { const c = await btn(); { const down = Tc('touchStart', [{ x: c.x, y: c.y, id: 7 }]); await page.waitForTimeout(ms || 80); const up = Tc('touchEnd', []); await down; await up; /* finger-up on time, not after the page acknowledges finger-down */ } await page.waitForTimeout(150); };
    await page.evaluate(() => { const g = MV.guard; g.patrol.enabled = false; g.reset(); const b = g.position.clone().addScaledVector(g.forward(), -2.2); MV.motor.teleport(b.x, b.z, g.yaw); MV.cam.snap(MV.motor); for (const f of MV.footsteps.feet) { f.down = true; f.prev = null; f.at = null; } });
    // walk up behind him (sneak) until in reach
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 150, y: 276, id: 1 }]);
    await page.waitForFunction(() => Math.hypot(MV.guard.position.x - MV.motor.position.x, MV.guard.position.z - MV.motor.position.z) < 1.2, null, { timeout: 8000, polling: 30 }).catch(() => {});
    await Tc('touchEnd', []); await page.waitForTimeout(300);
    const ready = await page.evaluate(() => document.getElementById('mv-cqc').classList.contains('ready'));
    await tap(); await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(150);
    const held = await page.evaluate(() => ({ state: MV.cqc.state, label: document.getElementById('mv-cqc').textContent, restrained: !!MV.guard.restraint, aware: MV.guard.awareness.state }));
    // move him with the stick, and turn the camera at the same time
    const p0 = await page.evaluate(() => [MV.motor.position.x, MV.motor.position.z, MV.cam.yaw]);
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }, { x: 620, y: 200, id: 2 }]); await Tc('touchMove', [{ x: 150, y: 240, id: 1 }, { x: 620, y: 200, id: 2 }]);
    for (let i = 1; i <= 10; i++) { await Tc('touchMove', [{ x: 150, y: 240, id: 1 }, { x: 620 - i * 5, y: 200, id: 2 }]); await page.waitForTimeout(150); }
    await Tc('touchEnd', []); await page.waitForTimeout(500);
    const mv = await page.evaluate(p0 => ({ moved: Math.hypot(MV.motor.position.x - p0[0], MV.motor.position.z - p0[1]), camTurn: Math.abs(MV.cam.yaw - p0[2]), d: Math.hypot(MV.guard.position.x - MV.motor.position.x, MV.guard.position.z - MV.motor.position.z), state: MV.cqc.state }), p0);
    await tap(); await page.waitForFunction(() => MV.cqc.state === 'FREE', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(200);
    const freed = await page.evaluate(() => ({ state: MV.cqc.state, label: document.getElementById('mv-cqc').textContent, restrained: !!MV.guard.restraint, aware: MV.guard.awareness.state }));
    // HOLD near him (Step 16): a quick takedown, not a grab
    await page.evaluate(() => { const g = MV.guard, b = g.position.clone().addScaledVector(g.forward(), -1.0); MV.motor.teleport(b.x, b.z, g.yaw); });
    await page.waitForTimeout(200); await tap(1000); await page.waitForFunction(() => MV.guard.isDown() && MV.cqc.state === 'FREE', null, { timeout: 8000, polling: 'raf' }).catch(() => {});
    const hold = await page.evaluate(() => ({ state: MV.cqc.state, note: MV.cqc.holdNote, ko: MV.guard.ko.state, grabs: MV.cqc.grabs, takedowns: MV.cqc.takedowns }));
    await page.tap('#mv-reset'); await page.waitForTimeout(300);
    await page.evaluate(() => { const g = MV.guard, b = g.position.clone().addScaledVector(g.forward(), -1.0); MV.motor.teleport(b.x, b.z, g.yaw); MV.cam.snap(MV.motor); }); await page.waitForTimeout(200);
    // RESET mid-grapple
    await tap(); await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {}); const mid = await page.evaluate(() => MV.cqc.state);
    await page.tap('#mv-reset'); await page.waitForTimeout(300);
    const reset = await page.evaluate(() => ({ state: MV.cqc.state, label: document.getElementById('mv-cqc').textContent, restrained: !!MV.guard.restraint, aware: MV.guard.awareness.state }));
    const ok = ready && held.state === 'GRAPPLING' && held.label === 'RELEASE' && held.restrained && held.aware === 'ALERT' && mv.state === 'GRAPPLING' && mv.moved > 0.4 && mv.camTurn > 0.05 && Math.abs(mv.d - 0.55) < 0.03
      && freed.state === 'FREE' && freed.label === 'CQC' && !freed.restrained && freed.aware === 'ALERT' && hold.state === 'FREE' && /quick takedown/.test(hold.note) && hold.ko === 'UNCONSCIOUS' && hold.takedowns === 1
      && mid === 'GRAPPLING' && reset.state === 'FREE' && reset.label === 'CQC' && !reset.restrained && reset.aware === 'NORMAL' && page.errors.length === 0;
    return { pass: ok, detail: `walked up behind him: button lit ${ready}; tapped CQC: ${held.state}, button "${held.label}", he's ${held.aware}; stick + camera drag together: moved him ${mv.moved.toFixed(2)} m, camera turned ${mv.camTurn.toFixed(2)} rad, still ${mv.d.toFixed(2)} m apart; tapped RELEASE: ${freed.state}, button "${freed.label}", he's ${freed.aware}; held CQC 1 s by him: quick takedown → ${hold.ko} ("${hold.note}", grabs ${hold.grabs}, takedowns ${hold.takedowns}); RESET mid-grapple (${mid}): ${reset.state}, button "${reset.label}", he's ${reset.aware}; page errors ${page.errors.length}` };
  },

  // Step 13.1, 1–8, 11: MGSV-style pulling. With the camera behind her, each of eight stick
  // directions (toward the camera, left, right, away, and the four diagonals) moves the pair
  // ≥ 1 m along the stick in 1.5 s, the pair turned so she faces away from the travel (she
  // pulls him backward, both stepping backward); the pair's centre is up to speed (≥ 0.9 m/s)
  // within 0.6 s; a 90° steer keeps ≥ 60% of the speed; a full reversal turns the pair round
  // without a stop or a jump; partial pushes scale the speed and a tiny one does nothing;
  // spacing and facing stay locked; his own AI never moves him; no joint pops on either
  async cqcPull() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input, cam } = MV, g = MV.guard, cq = MV.cqc, dt = 1 / 60, wrap = x => Math.atan2(Math.sin(x), Math.cos(x)), c = cq.cfg;
      let pops = 0; const prevQ = {};
      const bonesOf = (B, tag) => ['spine1', 'chest', 'head', 'leftUpLeg', 'rightUpLeg', 'leftLeg', 'rightLeg', 'leftArm', 'rightArm'].map(n => [tag + n, B[n]]);
      const all = bonesOf(MV.visual.bones, 'p').concat(bonesOf(g.bones, 'g'));
      const frame = (mx, my) => {
        const f = cam.forward(new THREE.Vector3()), rx = -f.z, rz = f.x; let dx = rx * (mx || 0) + f.x * (my || 0), dz = rz * (mx || 0) + f.z * (my || 0); const mag = Math.min(1, Math.hypot(mx || 0, my || 0)), l = Math.hypot(dx, dz); if (l > 1e-4) { dx /= l; dz /= l; }
        const held = cq.update(dt, dx, dz, mag); if (!held) motor.update(dt, dx, dz, mag);
        MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true);
        g.update(dt, MV.seeTarget); noise.update(dt);
        for (const [k, b] of all) { const root = k[0] === 'p' ? MV.visual.root : g.root, q = root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(b.getWorldQuaternion(new THREE.Quaternion())); const ang = prevQ[k] ? 2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ[k])))) * 57.3 : 0; if (cq.state === 'GRAPPLING' && ang > 12) { pops++; (window.__pops = window.__pops || []).push(k + ' ' + ang.toFixed(1) + '° v' + (cq.vel ? Math.hypot(cq.vel.x, cq.vel.y).toFixed(2) : '-')); } prevQ[k] = q; }   // (only while she holds him: the setup teleports jolt both)
      };
      const centre = () => new THREE.Vector3((motor.position.x + g.position.x) / 2, 0, (motor.position.z + g.position.z) / 2);
      const start = () => { cq.cancel(); g.patrol.enabled = false; g.reset(); g.motor.teleport(0, -2, 0); g.place(); const b = g.position.clone().addScaledVector(g.forward(), -1.0); motor.teleport(b.x, b.z, 0); cam.snap(motor); for (const k in prevQ) delete prevQ[k]; for (let i = 0; i < 10; i++) frame(); input.cqcTapped = true; for (let i = 0; i < 40; i++) frame(); };
      const stickDir = (mx, my) => { const f = cam.forward(new THREE.Vector3()); return new THREE.Vector3(-f.z * mx + f.x * my, 0, f.x * mx + f.z * my).normalize(); };
      const lock = { spacing: 0, yaw: 0, own: 0 }, track = () => { lock.spacing = Math.max(lock.spacing, Math.abs(Math.hypot(g.position.x - motor.position.x, g.position.z - motor.position.z) - c.holdOffset)); lock.yaw = Math.max(lock.yaw, Math.abs(wrap(g.yaw - motor.yaw)) * 57.3); if (g.moving || g.path) lock.own++; };
      const dirs = [];
      for (const [name, mx, my] of [['toward camera', 0, -1], ['left', -1, 0], ['right', 1, 0], ['away', 0, 1], ['back-left', -0.71, -0.71], ['back-right', 0.71, -0.71], ['fwd-left', -0.71, 0.71], ['fwd-right', 0.71, 0.71]]) {
        start(); const want = stickDir(mx, my), c0 = centre(); let up = null, t = 0;
        for (let i = 0; i < 90; i++) { const cb = centre(); frame(mx, my); track(); t += dt; const sp = centre().distanceTo(cb) / dt; if (up == null && sp >= 0.9) up = t; }
        const d = centre().sub(c0), face = Math.abs(wrap(motor.yaw - Math.atan2(-want.x, -want.z))) * 57.3;
        dirs.push({ name, along: d.dot(want), off: Math.abs(d.x * want.z - d.z * want.x), up, face, back: motor.reverseGait && g.motor.reverseGait, phaseMoving: MV.animator.state });
      }
      // steering: pulling toward the camera, then the stick swings 90° to the left
      start(); for (let i = 0; i < 60; i++) { frame(0, -1); track(); } let steerMin = 9; for (let i = 0; i < 60; i++) { const cb = centre(); frame(-1, 0); track(); steerMin = Math.min(steerMin, centre().distanceTo(cb) / dt); }
      // reversal: toward the camera, then straight away from it
      start(); for (let i = 0; i < 60; i++) { frame(0, -1); track(); } let revMin = 9, revJump = 0, avMax = 0; const y0 = motor.yaw;
      for (let i = 0; i < 120; i++) { const cb = centre(), pb = motor.position.clone(); frame(0, 1); track(); revMin = Math.min(revMin, centre().distanceTo(cb) / dt); revJump = Math.max(revJump, motor.position.distanceTo(pb)); avMax = Math.max(avMax, Math.abs(cq.av)); }
      const revTurned = Math.abs(wrap(motor.yaw - y0)) * 57.3;
      // partial pushes
      const partial = {}; for (const p of [0.4, 0.25, 0.04]) { start(); for (let i = 0; i < 90; i++) frame(0, -p); let s = 0; for (let i = 0; i < 30; i++) { const cb = centre(); frame(0, -p); s += centre().distanceTo(cb) / dt; } partial[p] = s / 30; }
      cq.cancel(); g.reset();
      return { popList: (window.__pops || []).slice(0, 25).join(', '), dirs, steerMin, revMin, revJump, avMax, revTurned, partial, lock, pops, pull: c.pullSpeed, turnRate: c.turnRate };
    });
    // directions that need the pair to turn right round (away from the camera) get up to 1 s to reach speed
    const ok = r.dirs.every(d => d.along >= 1.0 && d.off < 0.25 * d.along && d.up != null && d.up <= (/away|fwd/.test(d.name) ? 1.0 : 0.6) && d.face < 10 && d.back)
      && r.steerMin >= 0.6 * r.pull && r.revMin >= 0.25 && r.revJump < 0.06 && r.avMax <= r.turnRate + 1e-6 && r.revTurned > 150
      && r.partial[0.4] > 0.45 && r.partial[0.4] < 0.62 && r.partial[0.25] > 0.2 && r.partial[0.25] < 0.4 && r.partial[0.04] < 0.01
      && r.lock.spacing < 0.01 && r.lock.yaw < 1 && r.lock.own === 0 && r.pops === 0;
    return { pass: ok, detail: r.dirs.map(d => `${d.name}: ${d.along.toFixed(2)} m along the stick (${d.off.toFixed(2)} m off), up to speed in ${d.up == null ? '-' : d.up.toFixed(2)} s, facing away from travel within ${d.face.toFixed(0)}°, stepping backward ${d.back}`).join('; ') + `; steering 90°: speed ≥ ${r.steerMin.toFixed(2)} m/s; reversal: turned ${r.revTurned.toFixed(0)}°, speed ≥ ${r.revMin.toFixed(2)} m/s, pivot ≤ ${r.avMax.toFixed(2)} rad/s, largest per-frame move ${(r.revJump * 100).toFixed(1)} cm; pushes 40% / 25% / 4%: ${r.partial[0.4].toFixed(2)} / ${r.partial[0.25].toFixed(2)} / ${r.partial[0.04].toFixed(2)} m/s; spacing within ${(r.lock.spacing * 100).toFixed(2)} cm, facing within ${r.lock.yaw.toFixed(2)}°, his own movement ${r.lock.own}; joint pops ${r.pops}${r.pops ? ' (' + r.popList + ')' : ''}` };
  },

  // Step 13.1, 9, 10: both bodies against walls, crates and pillars. Pulled along the
  // perimeter wall with him on the wall side: neither overlaps it and they slide along it.
  // Pulled into the tall crate's corner, and pivoted next to a pillar: no overlap, no
  // separation, and they still get somewhere (never permanently stuck)
  async cqcPullCollision() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input, world } = MV, g = MV.guard, cq = MV.cqc, dt = 1 / 60;
      const intr = (p, R) => { let w = 0; for (const b of world.boxes) { const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX), dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ); w = Math.max(w, R - Math.hypot(dx, dz)); } for (const cy of world.cylinders) if (!cy.noSight) w = Math.max(w, cy.r + R - Math.hypot(p.x - cy.x, p.z - cy.z)); return w; };
      const frame = (dx, dz, mag) => { cq.update(dt, dx, dz, mag); MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); g.update(dt, MV.seeTarget); noise.update(dt); };
      const run = (gx, gz, gyaw, dirs) => {
        cq.cancel(); g.patrol.enabled = false; g.reset(); g.motor.teleport(gx, gz, gyaw); g.place(); const b = g.position.clone().addScaledVector(g.forward(), -0.9); motor.teleport(b.x, b.z, gyaw);
        input.cqcTapped = true; for (let i = 0; i < 40; i++) frame(0, 0, 0);
        const c0 = new THREE.Vector3((motor.position.x + g.position.x) / 2, 0, (motor.position.z + g.position.z) / 2);
        let worst = 0, sep = 0;
        for (const [dx, dz, n] of dirs) for (let i = 0; i < n; i++) { frame(dx, dz, 1); worst = Math.max(worst, intr(g.position, g.cfg.radius), intr(motor.position, motor.cfg.radius)); sep = Math.max(sep, Math.abs(Math.hypot(g.position.x - motor.position.x, g.position.z - motor.position.z) - cq.cfg.holdOffset)); }
        const c1 = new THREE.Vector3((motor.position.x + g.position.x) / 2, 0, (motor.position.z + g.position.z) / 2);
        return { worst, sep, travel: c1.distanceTo(c0), state: cq.state };
      };
      // along the south perimeter wall (inner face z = −21.75), him on the wall side, pulled east
      const wall = run(-4, -21.1, Math.PI, [[1, 0, 180]]);
      // diagonally into the tall crate's corner (crate −2.6…−1.4 × −8.6…−7.4), then on along its side
      const crate = run(-3.8, -10, 0.6, [[0.6, 0.8, 120], [1, 0, 90]]);
      // pivoting next to a pillar (−14, −12, r 0.35): the stick swings round in a full circle
      const circle = []; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; circle.push([Math.sin(a), Math.cos(a), 30]); }
      const pillar = run(-13.2, -12.6, 0, circle);
      cq.cancel(); g.reset();
      return { wall, crate, pillar };
    });
    const okOne = x => x.worst < 0.02 && x.sep < 0.01 && x.state === 'GRAPPLING';
    const ok = okOne(r.wall) && okOne(r.crate) && okOne(r.pillar) && r.wall.travel > 2 && r.crate.travel > 1;
    const d = (k, x) => `${k}: deepest overlap ${(Math.max(0, x.worst) * 100).toFixed(1)} cm, spacing error ${(x.sep * 100).toFixed(2)} cm, travelled ${x.travel.toFixed(2)} m`;
    return { pass: ok, detail: [d('along the perimeter wall', r.wall), d('into the tall crate corner and along it', r.crate), d('circling the stick next to a pillar', r.pillar)].join('; ') };
  },

  // Step 13.1 with real iPhone touches (frame loop running): grab from behind, then the left
  // thumb pulls toward the camera, to the left, to the right and diagonally while the right
  // thumb turns the camera: each moves the pair along the stick; RELEASE frees him
  async cqcPullTouch() {
    const page = await patrolPage(true), Tc = page.touch, X = 150, Y = 300;
    const tapCqc = async () => { const b = await page.locator('#mv-cqc').boundingBox(); { const down = Tc('touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 }]); await page.waitForTimeout(80); const up = Tc('touchEnd', []); await down; await up; /* finger-up on time, not after the page acknowledges finger-down */ } };
    await page.evaluate(() => { const g = MV.guard; g.patrol.enabled = false; g.reset(); g.motor.teleport(0, -4, 0); g.place(); const b = g.position.clone().addScaledVector(g.forward(), -1.0); MV.motor.teleport(b.x, b.z, 0); MV.cam.snap(MV.motor); });
    await page.waitForTimeout(300); await tapCqc();
    await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {});
    const runs = [];
    for (const [name, sx, sy] of [['toward camera', 0, 1], ['left', -1, 0], ['right', 1, 0], ['diagonal back-left', -0.71, 0.71]]) {
      const before = await page.evaluate(([sx, sy]) => { const f = MV.cam.forward(new THREE.Vector3()), want = new THREE.Vector3(-f.z * sx + f.x * -sy, 0, f.x * sx + f.z * -sy).normalize(); window.__want = want; return [MV.motor.position.x, MV.motor.position.z, MV.guard.position.x, MV.guard.position.z]; }, [sx, sy]);
      await Tc('touchStart', [{ x: X, y: Y, id: 1 }, { x: 620, y: 200, id: 2 }]);
      for (let i = 1; i <= 10; i++) { await Tc('touchMove', [{ x: X + sx * 60, y: Y + sy * 60, id: 1 }, { x: 620 + (i % 2 ? 2 : -2), y: 200, id: 2 }]); await page.waitForTimeout(150); }
      await Tc('touchEnd', []); await page.waitForTimeout(400);
      runs.push(Object.assign({ name }, await page.evaluate(b => { const cx = (MV.motor.position.x + MV.guard.position.x) / 2 - (b[0] + b[2]) / 2, cz = (MV.motor.position.z + MV.guard.position.z) / 2 - (b[1] + b[3]) / 2, w = window.__want;
        return { along: cx * w.x + cz * w.z, spacing: Math.hypot(MV.guard.position.x - MV.motor.position.x, MV.guard.position.z - MV.motor.position.z), state: MV.cqc.state }; }, before)));
    }
    await tapCqc(); await page.waitForFunction(() => MV.cqc.state === 'FREE', null, { timeout: 8000 }).catch(() => {});
    const end = await page.evaluate(() => ({ state: MV.cqc.state, restrained: !!MV.guard.restraint, rev: MV.motor.reverseGait || MV.guard.motor.reverseGait }));
    const ok = runs.every(x => x.along > 0.5 && Math.abs(x.spacing - 0.55) < 0.03 && x.state === 'GRAPPLING') && end.state === 'FREE' && !end.restrained && !end.rev && page.errors.length === 0;
    return { pass: ok, detail: runs.map(x => `${x.name}: ${x.along.toFixed(2)} m along the stick, ${x.spacing.toFixed(2)} m apart`).join('; ') + ` (camera thumb held throughout); RELEASE: ${end.state}, reverse gait cleared ${!end.rev}; page errors ${page.errors.length}` };
  },

  // Guard 2 (CQC test sentry), 1–3: two independent guards. Guard 2 is his own guard (own
  // motor, collider, model, mixer, animator, senses, awareness, personality, UI elements) and
  // labelled; he stands 5–8 m from the spawn in open ground, facing away from it, well clear
  // of Guard 1's route; with her standing at the spawn for 5 s he neither sees nor hears her.
  // Guard 1's patrol is untouched (his settings and route as before, and 40 s with both guards
  // running he walks it, leaving his first waypoint and reaching the next ones) while Guard 2,
  // unrestrained, never leaves his post
  async guard2Setup() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, world } = MV, [g1, g2] = MV.guards, dt = 1 / 60, T = MV.seeTarget, sp = MV.area.spawn;
      const frame = () => { step(0, 'stand'); noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const pairs = [['guard', g1, g2], ['motor', g1.motor, g2.motor], ['collider', g1.collider, g2.collider], ['model', g1.model, g2.model], ['mixer', g1.mixer, g2.mixer], ['animator', g1.animator, g2.animator], ['head bone', g1.head, g2.head],
        ['vision', g1.vision, g2.vision], ['hearing', g1.hearing, g2.hearing], ['awareness', g1.awareness, g2.awareness], ['personality', g1.personality, g2.personality], ['caption', MV.caption, MV.caption2], ['indicator', MV.indicator, MV.indicator2], ['card', MV.traitCard, MV.traitCard2],
        ['caption element', MV.caption.el, MV.caption2.el], ['indicator element', MV.indicator.el, MV.indicator2.el], ['card element', MV.traitCard.el, MV.traitCard2.el]];
      const shared = pairs.filter(([, a, b]) => !a || !b || a === b).map(p => p[0]);
      const owners = MV.caption2.guard === g2 && MV.indicator2.guard === g2 && MV.traitCard2.guard === g2 && MV.caption.guard === g1 && MV.indicator.guard === g1 && MV.traitCard.guard === g1;
      const dSpawn = Math.hypot(g2.position.x - sp.x, g2.position.z - sp.z);
      const toSpawn = Math.atan2(sp.x - g2.position.x, sp.z - g2.position.z), away = Math.abs(Math.atan2(Math.sin(toSpawn - g2.yaw), Math.cos(toSpawn - g2.yaw))) * 57.3;
      // open ground: nothing solid within 2.5 m of his post
      let clear = Infinity; for (const b of world.boxes) { const dx = Math.max(b.minX - g2.post.x, 0, g2.post.x - b.maxX), dz = Math.max(b.minZ - g2.post.z, 0, g2.post.z - b.maxZ); clear = Math.min(clear, Math.hypot(dx, dz)); }
      const pts = g1.patrol.cfg.points; let route = Infinity;
      for (let i = 0; i < pts.length; i++) { const a = new THREE.Vector3(pts[i].x, 0, pts[i].z), b = new THREE.Vector3(pts[(i + 1) % pts.length].x, 0, pts[(i + 1) % pts.length].z); route = Math.min(route, segDist(g2.post.clone().setY(0), a, b)); }
      // she stands at the spawn for 5 s, both guards running (patrol on, personalities as shipped)
      g1.patrol.enabled = true; g1.personality.enabled = true; g1.reset(); g2.reset(); motor.teleport(sp.x, sp.z, sp.yaw);
      let g2Meter = 0, g2State = 'NORMAL', g2Heard = 0;
      for (let i = 0; i < 300; i++) { frame(); g2Meter = Math.max(g2Meter, g2.vision.meter); if (g2.awareness.state !== 'NORMAL') g2State = g2.awareness.state; if (g2.hearing.heard) g2Heard++; }
      // then 40 s with her parked far from both (north-west corner, out of everyone's sight)
      motor.teleport(-19, 19, 0); const reached = new Set(); let g1Max = 0, g2Off = 0, g1States = new Set();
      const p0 = g1.position.clone();
      for (let i = 0; i < 40 * 60; i++) { frame(); g1States.add(g1.awareness.state); g1Max = Math.max(g1Max, g1.position.distanceTo(p0)); if (g1.patrol.state === 'observing') reached.add(g1.patrol.index); g2Off = Math.max(g2Off, Math.hypot(g2.position.x - g2.post.x, g2.position.z - g2.post.z)); }
      const cfg1 = { label: g1.cfg.label, stationary: !!g1.cfg.stationary, patrol: g1.patrol.enabled, points: pts.length, x: g1.post.x, z: g1.post.z, primary: g1.personality.traits.primary, secondary: g1.personality.traits.secondary };
      return { shared, owners, labels: [g1.cfg.label, g2.cfg.label], dSpawn, away, clear, route, g2Meter, g2State, g2Heard, reached: [...reached], g1Max, g2Off, g1States: [...g1States], cfg1, g2: { stationary: g2.cfg.stationary, patrol: g2.patrol.enabled, traits: g2.personality.traits.primary + '/' + g2.personality.traits.secondary } };
    });
    const ok = r.shared.length === 0 && r.owners && r.labels[0] === 'Guard 1 — Patrol' && r.labels[1] === 'Guard 2 — Stationary CQC Test' && r.dSpawn >= 5 && r.dSpawn <= 8 && r.away > 120 && r.clear > 2.5 && r.route > 6
      && r.g2Meter === 0 && r.g2State === 'NORMAL' && r.g2Heard === 0
      && r.cfg1.patrol && !r.cfg1.stationary && r.cfg1.points === 4 && r.cfg1.x === 2 && r.cfg1.z === -16 && r.cfg1.primary === 'focused' && r.cfg1.secondary === 'bored'
      && r.g1Max > 8 && r.reached.length >= 3 && r.g1States.length === 1 && r.g1States[0] === 'NORMAL' && r.g2Off < 0.01 && r.g2.stationary && !r.g2.patrol && page.errors.length === 0;
    return { pass: ok, detail: `"${r.labels[0]}" / "${r.labels[1]}"; shared parts: ${r.shared.length ? r.shared.join(', ') : 'none'}; UI owned by the right guard ${r.owners}; Guard 2 ${r.dSpawn.toFixed(2)} m from the spawn, facing ${r.away.toFixed(0)}° away from it, ${r.clear.toFixed(1)} m from anything solid, ${r.route.toFixed(1)} m from Guard 1's route (${r.g2.traits}, stationary ${r.g2.stationary}, patrol ${r.g2.patrol}); her 5 s at the spawn: his detection ${Math.round(r.g2Meter * 100)}%, ${r.g2State}, heard ${r.g2Heard} frames; 40 s: Guard 1 (patrol ${r.cfg1.patrol}, ${r.cfg1.points} waypoints from (${r.cfg1.x}, ${r.cfg1.z}), ${r.cfg1.primary}/${r.cfg1.secondary}) walked up to ${r.g1Max.toFixed(1)} m out, observed at waypoints ${r.reached.join(',')}, states ${r.g1States.join(',')}; Guard 2 drifted ${(r.g2Off * 100).toFixed(1)} cm from his post` };
  },

  // Guard 2, 3–4: he holds his post but is a real guard. Footsteps beside him: he hears them,
  // turns toward them and gets suspicious / investigates, without walking off; she steps into
  // his view: his detection fills and he goes ALERT (and startles); she vanishes: he searches
  // (EVASION) from his post, then stands down to NORMAL, still at his post the whole time
  async guard2Senses() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, [g1, g2] = MV.guards, a = g2.awareness, dt = 1 / 60, T = MV.seeTarget, wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
      let off = 0; const states = new Set();
      const frame = () => { step(0, 'stand'); noise.update(dt); g1.update(dt, T); g2.update(dt, T); off = Math.max(off, Math.hypot(g2.position.x - g2.post.x, g2.position.z - g2.post.z)); states.add(a.state); };
      const sim = n => { for (let i = 0; i < n; i++) frame(); }, until = (fn, max) => { let n = 0; while (!fn() && n < max) { frame(); n++; } return n; };
      g2.reset(); a.cfg.evasionTime = 8; a.cfg.heightenedTime = 8; motor.teleport(-19, 19, 0); sim(10);
      // footsteps 3.5 m to his right (behind his shoulder): he hears and turns to them
      const side = g2.yaw - Math.PI / 2, src = g2.position.clone().add(new THREE.Vector3(Math.sin(side) * 3.5, 0, Math.cos(side) * 3.5)), yaw0 = g2.yaw;
      for (let k = 0; k < 4; k++) { noise.emit(3, 'footstep', src, 'concrete', 'player'); sim(6); }
      const heard = !!(g2.hearing.last && g2.hearing.last.heard);
      sim(240); const turned = Math.abs(wrap(g2.yaw - yaw0)) * 57.3, faceErr = Math.abs(wrap(Math.atan2(src.x - g2.position.x, src.z - g2.position.z) - g2.yaw)) * 57.3;
      const heardState = [...states].filter(s => s !== 'NORMAL').join(','), refused = g2.navFailed, reacted = a.reactions;
      sim(60 * 12);
      // she stands 5 m in front of him, in the open
      g2.reset(); sim(5); const f = g2.forward(); motor.teleport(g2.position.x + f.x * 5, g2.position.z + f.z * 5, g2.yaw + Math.PI); for (let k = 0; k < 2; k++) step(0, 'stand');
      const toAlert = until(() => a.state === 'ALERT', 600) / 60, meter = g2.vision.meter, startled = a.isStartled();
      // she vanishes: he searches from his post, then stands down
      motor.teleport(-19, 19, 0); const toEvasion = until(() => a.state === 'EVASION', 900) / 60;
      const toCalm = until(() => a.state === 'NORMAL', 60 * 60) / 60;
      return { heard, turned, faceErr, heardState, refused, reacted, toAlert, meter, startled, toEvasion, toCalm, end: a.state, off, states: [...states] };
    });
    const ok = r.heard && r.turned > 45 && /SUSPICIOUS|INVESTIGATING/.test(r.heardState) && r.reacted >= 1
      && r.toAlert > 0 && r.toAlert < 6 && r.meter >= 0.99 && r.startled && r.toEvasion < 15 && r.end === 'NORMAL' && r.off < 0.7 && page.errors.length === 0;
    return { pass: ok, detail: `footsteps 3.5 m to his side: heard ${r.heard}, turned ${r.turned.toFixed(0)}° (now ${r.faceErr.toFixed(0)}° off the sound), states ${r.heardState}, reactions ${r.reacted}${r.refused ? ', walk refused (' + r.refused + ')' : ''}; she stands 5 m in front: ALERT after ${r.toAlert.toFixed(2)} s, detection ${Math.round(r.meter * 100)}%, startled ${r.startled}; she vanishes: EVASION after ${r.toEvasion.toFixed(1)} s, back to ${r.end} after ${r.toCalm.toFixed(1)} s more; furthest from his post the whole time ${r.off.toFixed(2)} m (states seen ${r.states.join(', ')})` };
  },

  // Guard 2, 5–9: CQC on him. Grabbed from the front, side and rear and while fully ALERT
  // (recovered, watching her); CQC picks whichever guard is in reach (Guard 2 by him, Guard 1
  // by Guard 1, the nearer one when both are in reach) and only that guard is restrained;
  // pulling Guard 2 around never moves Guard 1 (and the reverse); no animation state crosses
  // between them; released away from his post, Guard 2 stays ALERT where she let go (no snap
  // back), and only later walks back to his post once he stands down
  async guard2Cqc() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget;
      let jump2 = 0, lp2 = g2.position.clone();
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) step(0, 'stand'); else { MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); } noise.update(dt); g1.update(dt, T); g2.update(dt, T); jump2 = Math.max(jump2, g2.position.distanceTo(lp2)); lp2.copy(g2.position); };
      const sim = (n, dx, dz, mag) => { for (let i = 0; i < n; i++) frame(dx, dz, mag); }, until = (fn, max) => { let n = 0; while (!fn() && n < max) { frame(); n++; } return n; };
      const place = (g, rel, d) => { const y = g.yaw + rel, p = g.position.clone().add(new THREE.Vector3(Math.sin(y) * d, 0, Math.cos(y) * d)); motor.teleport(p.x, p.z, Math.atan2(g.position.x - p.x, g.position.z - p.z)); for (let k = 0; k < 2; k++) step(0, 'stand'); };
      const fresh = () => { cq.cancel(); g1.patrol.enabled = false; g1.reset(); g2.reset(); motor.teleport(-19, 19, 0); sim(10); lp2.copy(g2.position); };
      const tryGrab = g => { const before = g.awareness.state; input.cqcTapped = true; frame(); sim(40); const out = { before, state: cq.state, held: cq.guard === g, restrained: !!g.restraint, other: !!(g === g1 ? g2 : g1).restraint, after: g.awareness.state, why: cq.lastTry }; cq.cancel(); return out; };
      const out = { dirs: {} };
      for (const [k, rel] of [['front', 0], ['side', Math.PI / 2], ['rear', Math.PI]]) { fresh(); place(g2, rel, 1.0); out.dirs[k] = tryGrab(g2); }
      fresh(); place(g2, 0, 1.2); until(() => g2.awareness.state === 'ALERT', 300); sim(150); out.alertSees = g2.vision.seen.rate > 0; out.alertStartled = g2.awareness.isStartled(); out.alert = tryGrab(g2);
      // targeting: Guard 1 brought over 2.4 m from Guard 2
      fresh(); g1.motor.teleport(g2.post.x - 2.4, g2.post.z, Math.PI / 2); g1.place(); sim(2);
      place(g2, Math.PI, 1.0); cq.check(); out.t2 = cq.target && cq.target.cfg.label; out.g2pick = tryGrab(g2);
      place(g1, Math.PI, 1.0); cq.check(); out.t1 = cq.target && cq.target.cfg.label; out.g1pick = tryGrab(g1);
      // both in reach (between them, 1.0 m from Guard 1, 1.4 m from Guard 2): the nearer
      fresh(); g1.motor.teleport(g2.post.x - 2.4, g2.post.z, Math.PI / 2); g1.place(); sim(2);
      motor.teleport(g1.position.x + 1.0, g1.position.z, -Math.PI / 2); for (let k = 0; k < 2; k++) step(0, 'stand'); cq.check(); out.both = cq.target && cq.target.cfg.label;
      out.bothD = [g1, g2].map(g => Math.hypot(g.position.x - motor.position.x, g.position.z - motor.position.z));
      // moving one doesn't move the other, and nothing of the grapple reaches the other guard
      fresh(); const g1at = g1.position.clone();   // Guard 1 standing at his own post (patrol off)
      place(g2, Math.PI, 1.0); input.cqcTapped = true; sim(40); const p0 = g2.position.clone();
      let g1rev = 0, g2rev = 0, g1move = 0; const back = motor.yaw + Math.PI;
      for (let i = 0; i < 150; i++) { frame(Math.sin(back), Math.cos(back), 1); if (g1.motor.reverseGait) g1rev++; if (g2.motor.reverseGait) g2rev++; g1move = Math.max(g1move, g1.position.distanceTo(g1at)); }
      out.move2 = { moved: g2.position.distanceTo(p0), g1move, g1rev, g2rev, g1restrained: !!g1.restraint, g1speed: g1.motor.speed };
      // release him there, away from his post
      jump2 = 0; input.cqcTapped = true; sim(40);
      const rel = { state: cq.state, restrained: !!g2.restraint, aware: g2.awareness.state, fromPost: Math.hypot(g2.position.x - g2.post.x, g2.position.z - g2.post.z) };
      const relEnd = g2.position.clone(); motor.teleport(-19, 19, 0); let alertFrames = 0, calm = 0, wander = 0;
      for (let i = 0; i < 180; i++) { frame(); if (g2.awareness.state === 'ALERT' || g2.awareness.state === 'EVASION') alertFrames++; if (g2.awareness.state === 'NORMAL') calm++; wander = Math.max(wander, g2.position.distanceTo(relEnd)); }
      const relJump = jump2;
      // then he stands down in time and walks back to his post (no snap)
      g2.awareness.cfg.evasionTime = 6; g2.awareness.cfg.heightenedTime = 6; jump2 = 0;
      const home = until(() => g2.awareness.state === 'NORMAL' && g2.atPost() && !g2.moving, 60 * 90) / 60;
      out.rel = { ...rel, alertFrames, calm, wander, relJump, home, homeJump: jump2, atPost: g2.atPost() };
      // and the reverse: pulling Guard 1 doesn't move Guard 2
      fresh(); const g2at = g2.position.clone();
      place(g1, Math.PI, 1.0); input.cqcTapped = true; sim(40); const q0 = g1.position.clone(); let g2move = 0, g2rev1 = 0; const bk = motor.yaw + Math.PI / 2;
      for (let i = 0; i < 150; i++) { frame(Math.sin(bk), Math.cos(bk), 1); g2move = Math.max(g2move, g2.position.distanceTo(g2at)); if (g2.motor.reverseGait) g2rev1++; }
      out.move1 = { moved: g1.position.distanceTo(q0), g2move, g2rev: g2rev1, held: cq.guard === g1, g2restrained: !!g2.restraint };
      cq.cancel(); g1.reset(); g2.reset(); g2.awareness.cfg.evasionTime = 30; g2.awareness.cfg.heightenedTime = 60;
      return out;
    });
    const okGrab = x => x.state === 'GRAPPLING' && x.held && x.restrained && !x.other && x.after === 'ALERT';
    const ok = Object.values(r.dirs).every(okGrab) && okGrab(r.alert) && r.alert.before === 'ALERT' && r.alertSees && !r.alertStartled
      && r.t2 === 'Guard 2 — Stationary CQC Test' && okGrab(r.g2pick) && r.t1 === 'Guard 1 — Patrol' && okGrab(r.g1pick) && r.both === 'Guard 1 — Patrol' && r.bothD[0] < r.bothD[1] && r.bothD[1] < 1.45
      && r.move2.moved > 1 && r.move2.g1move < 0.01 && r.move2.g1rev === 0 && r.move2.g2rev > 0 && !r.move2.g1restrained
      && r.rel.state === 'FREE' && !r.rel.restrained && r.rel.aware === 'ALERT' && r.rel.fromPost > 1 && r.rel.alertFrames === 180 && r.rel.calm === 0 && r.rel.wander < 0.5 && r.rel.relJump < 0.06
      && r.rel.home > 0 && r.rel.home < 90 && r.rel.atPost && r.rel.homeJump < 0.06
      && r.move1.moved > 1 && r.move1.held && r.move1.g2move < 0.01 && r.move1.g2rev === 0 && !r.move1.g2restrained && page.errors.length === 0;
    const d = (k, x) => `${k} (${x.before}): ${x.state === 'GRAPPLING' && x.held ? 'grabbed' : 'FAILED ' + x.why}${x.other ? ', OTHER GUARD RESTRAINED' : ''}`;
    return { pass: ok, detail: `Guard 2 ${Object.entries(r.dirs).map(([k, x]) => d(k, x)).join('; ')}; ${d('fully ALERT and watching her', r.alert)} | targets: by Guard 2 → ${r.t2}, by Guard 1 → ${r.t1}, both in reach (${r.bothD[0].toFixed(2)} / ${r.bothD[1].toFixed(2)} m) → ${r.both} | pulling Guard 2 ${r.move2.moved.toFixed(2)} m: Guard 1 moved ${(r.move2.g1move * 100).toFixed(1)} cm, his reverse gait ${r.move2.g1rev} frames (Guard 2's ${r.move2.g2rev}); pulling Guard 1 ${r.move1.moved.toFixed(2)} m: Guard 2 moved ${(r.move1.g2move * 100).toFixed(1)} cm | released ${r.rel.fromPost.toFixed(1)} m from his post: ${r.rel.aware}, alert/searching ${r.rel.alertFrames}/180 frames, wandered ${r.rel.wander.toFixed(2)} m, largest step ${(r.rel.relJump * 100).toFixed(1)} cm; stood down and walked home in ${r.rel.home.toFixed(1)} s (largest step ${(r.rel.homeJump * 100).toFixed(1)} cm), at post ${r.rel.atPost}` };
  },

  // Guard 2, 10 + touch: real iPhone touches with the frame loop running. She walks from the
  // spawn up behind Guard 2 with the stick, the CQC button lights and the status names him;
  // tapping CQC restrains Guard 2 (not Guard 1), the button reads RELEASE, the stick moves
  // him; RELEASE frees him still ALERT; she grabs him again and RESET restores both guards
  // (each at his own post and facing, NORMAL, free, Guard 1 back on his patrol)
  async guard2Touch() {
    const page = await touchPage(), Tc = page.touch;
    const btn = async () => { const b = await page.locator('#mv-cqc').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tap = async () => { const c = await btn(); { const down = Tc('touchStart', [{ x: c.x, y: c.y, id: 7 }]); await page.waitForTimeout(80); const up = Tc('touchEnd', []); await down; await up; /* finger-up on time, not after the page acknowledges finger-down */ } await page.waitForTimeout(150); };
    await page.evaluate(() => { MV.guard.patrol.enabled = true; MV.guard.reset(); const g = MV.guard2; g.reset(); const b = g.position.clone().addScaledVector(g.forward(), -2.4); MV.motor.teleport(b.x, b.z, g.yaw); MV.cam.snap(MV.motor); for (const f of MV.footsteps.feet) { f.down = true; f.prev = null; f.at = null; } document.getElementById('mv-stats').hidden = false; });
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 150, y: 276, id: 1 }]);
    await page.waitForFunction(() => Math.hypot(MV.guard2.position.x - MV.motor.position.x, MV.guard2.position.z - MV.motor.position.z) < 1.2, null, { timeout: 10000, polling: 30 }).catch(() => {});
    await Tc('touchEnd', []); await page.waitForTimeout(400);
    const ready = await page.evaluate(() => ({ lit: document.getElementById('mv-cqc').classList.contains('ready'), status: document.getElementById('mv-cqcstat').textContent }));
    await tap(); await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(150);
    const held = await page.evaluate(() => ({ state: MV.cqc.state, label: document.getElementById('mv-cqc').textContent, g2: !!MV.guard2.restraint, g1: !!MV.guard.restraint, aware: MV.guard2.awareness.state, g2row: document.getElementById('mv-g2').textContent, status: MV.cqc.status() }));
    const p0 = await page.evaluate(() => [MV.guard2.position.x, MV.guard2.position.z, MV.guard.position.x, MV.guard.position.z]);
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); for (let i = 0; i < 10; i++) { await Tc('touchMove', [{ x: 150, y: 350, id: 1 }]); await page.waitForTimeout(150); }   // toward the camera: she pulls him back
    await Tc('touchEnd', []); await page.waitForTimeout(400);
    const mv = await page.evaluate(p0 => ({ moved: Math.hypot(MV.guard2.position.x - p0[0], MV.guard2.position.z - p0[1]), d: Math.hypot(MV.guard2.position.x - MV.motor.position.x, MV.guard2.position.z - MV.motor.position.z), state: MV.cqc.state }), p0);
    await tap(); await page.waitForFunction(() => MV.cqc.state === 'FREE', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(200);
    const freed = await page.evaluate(() => ({ state: MV.cqc.state, label: document.getElementById('mv-cqc').textContent, g2: !!MV.guard2.restraint, aware: MV.guard2.awareness.state, fromPost: Math.hypot(MV.guard2.position.x - MV.guard2.post.x, MV.guard2.position.z - MV.guard2.post.z) }));
    // grab him again, then RESET
    await page.evaluate(() => { const g = MV.guard2, b = g.position.clone().addScaledVector(g.forward(), -1.0); MV.motor.teleport(b.x, b.z, g.yaw); }); await page.waitForTimeout(200);
    await tap(); await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {}); const mid = await page.evaluate(() => MV.cqc.state + ' ' + (MV.cqc.guard === MV.guard2 ? 'Guard 2' : 'Guard 1'));
    await page.tap('#mv-reset'); await page.waitForTimeout(300);
    const reset = await page.evaluate(() => MV.guards.map(g => ({ post: Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z), yaw: Math.abs(Math.atan2(Math.sin(g.yaw - g.postYaw), Math.cos(g.yaw - g.postYaw))) * 57.3, aware: g.awareness.state, restrained: !!g.restraint, patrol: g.patrol.state, ind: !g.awareness || document.getElementById(g === MV.guard ? 'mv-indicator' : 'mv-indicator-2').hidden })).concat([{ cqc: MV.cqc.state, label: document.getElementById('mv-cqc').textContent }]));
    const [r1, r2, rc] = reset;
    const ok = ready.lit && /Guard 2/.test(ready.status) && held.state === 'GRAPPLING' && held.label === 'RELEASE' && held.g2 && !held.g1 && held.aware === 'ALERT' && /RESTRAINED/.test(held.g2row) && /Guard 2/.test(held.status)
      && mv.state === 'GRAPPLING' && mv.moved > 0.4 && Math.abs(mv.d - 0.55) < 0.03 && freed.state === 'FREE' && freed.label === 'CQC' && !freed.g2 && freed.aware === 'ALERT'
      && /GRAPPLING Guard 2/.test(mid) && rc.cqc === 'FREE' && rc.label === 'CQC' && [r1, r2].every(x => x.post < 0.01 && x.yaw < 0.5 && x.aware === 'NORMAL' && !x.restrained && x.ind) && r1.patrol === 'observing' && page.errors.length === 0;
    return { pass: ok, detail: `walked up behind Guard 2 from the stick: button lit ${ready.lit}, status "${ready.status}"; tapped CQC: ${held.state}, button "${held.label}", Guard 2 restrained ${held.g2}, Guard 1 restrained ${held.g1}, he's ${held.aware}, stats "${held.g2row}"; stick: moved him ${mv.moved.toFixed(2)} m, ${mv.d.toFixed(2)} m apart; RELEASE: ${freed.state}, button "${freed.label}", he's ${freed.aware}, ${freed.fromPost.toFixed(2)} m from his post; RESET mid-grapple (${mid}): Guard 1 ${r1.post.toFixed(2)} m / ${r1.yaw.toFixed(1)}° from his post, ${r1.aware}, patrol ${r1.patrol}; Guard 2 ${r2.post.toFixed(2)} m / ${r2.yaw.toFixed(1)}°, ${r2.aware}, restrained ${r2.restrained}; CQC ${rc.cqc}, button "${rc.label}"; page errors ${page.errors.length}` };
  },

  // Step 14, 8–11, 13–14, 17: the throw itself, on Guard 2 grabbed from the rear, side and
  // front, on Guard 1 out on his patrol, and on a guard grabbed while fully ALERT. Each:
  // the phases run in order (initiation, off-balance, throw, impact, recovery) in 1.3–1.8 s;
  // she stays put (< 1 cm) and the two stay connected (his hips within 1.3 m of her) with
  // no jumps (her < 3 cm, his head < 20 cm per frame); his hips and head end on the ground
  // (< 0.3 m), skin never below it (> −1 cm) and lying on it (< 2 cm); he lands 0.55 m from
  // where he stood, on a side with room; he's UNCONSCIOUS and free of the restraint; she's
  // back to FREE and the stick moves her again at walking speed within a second
  async throwSequence() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget, A = MV.SCmv.ThrowAnim;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) motor.update(dt, dx || 0, dz || 0, mag || 0); MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = n => { for (let i = 0; i < n; i++) frame(); }, until = (fn, max) => { let n = 0; while (!fn() && n < max) { frame(); n++; } return n; };
      const place = (g, rel, d) => { const y = g.yaw + rel, p = g.position.clone().add(new THREE.Vector3(Math.sin(y) * d, 0, Math.cos(y) * d)); motor.teleport(p.x, p.z, Math.atan2(g.position.x - p.x, g.position.z - p.z)); for (let k = 0; k < 2; k++) step(0, 'stand'); };
      const W = b => b.getWorldPosition(new THREE.Vector3());
      const fresh = () => { cq.cancel(); g1.patrol.enabled = false; g1.reset(); g2.reset(); motor.teleport(-19, 19, 0); sim(10); };
      const run = (g, setup) => {
        setup(); input.cqcTapped = true; sim(40);
        const out = { grabbed: cq.state === 'GRAPPLING' && cq.guard === g, before: g.awareness.state };
        const S = g.position.clone(), P = motor.position.clone(), plan = cq.throwCheck();
        input.throwTapped = true; const phases = []; let n = 0, herMove = 0, herJump = 0, headJump = 0, apart = 0, minSkin = Infinity, lp = motor.position.clone(), lh = W(g.head);
        while (n < 200) { frame(); n++; if (cq.state !== 'THROWING') break; const ph = cq.thr.phase; if (phases[phases.length - 1] !== ph) phases.push(ph);
          herMove = Math.max(herMove, motor.position.distanceTo(P)); herJump = Math.max(herJump, motor.position.distanceTo(lp)); lp.copy(motor.position);
          const h = W(g.head); headJump = Math.max(headJump, h.distanceTo(lh)); lh.copy(h);
          apart = Math.max(apart, Math.hypot(W(g.bones.hips).x - motor.position.x, W(g.bones.hips).z - motor.position.z));
          if (g.isDown()) minSkin = Math.min(minSkin, A.lowest(g)); }
        const land = new THREE.Vector3(S.x + plan.L.x * 0.55, 0, S.z + plan.L.z * 0.55);
        Object.assign(out, { phases: phases.join('>'), time: n / 60, herMove, herJump, headJump, apart, minSkin, side: plan.side, ok: plan.ok,
          hipsY: W(g.bones.hips).y, headY: W(g.head).y, lying: A.lowest(g), landErr: Math.hypot(g.position.x - land.x, g.position.z - land.z), ko: g.ko.state, aware: g.awareness.state, restrained: !!g.restraint, cqc: cq.state,
          clear: cq._landingClear(S, plan.L, P, g) });
        // her controls back
        let spd = 0; const f = motor.yaw + Math.PI; for (let i = 0; i < 60; i++) { frame(Math.sin(f), Math.cos(f), 0.78); spd = Math.max(spd, motor.speed); } out.spd = spd;
        return out;
      };
      const out = {};
      for (const [k, rel] of [['rear', Math.PI], ['side', Math.PI / 2], ['front', 0]]) { fresh(); out['G2 ' + k] = run(g2, () => place(g2, rel, 1.0)); }
      fresh(); g1.patrol.enabled = true; g1.reset(); until(() => g1.patrol.state === 'walking' && g1.moving, 600); out['G1 on patrol'] = run(g1, () => place(g1, Math.PI, 1.0));
      fresh(); out['G2 fully ALERT'] = run(g2, () => { place(g2, 0, 1.2); until(() => g2.awareness.state === 'ALERT', 300); sim(150); });
      out.alertSeen = out['G2 fully ALERT'].before === 'ALERT';
      cq.cancel(); g1.reset(); g2.reset();
      return out;
    });
    const rows = Object.entries(r).filter(([k]) => k !== 'alertSeen');
    const good = x => x.grabbed && x.ok && x.phases === 'initiate>offBalance>throw>impact>recover' && x.time >= 1.3 && x.time <= 1.8 && x.herMove < 0.01 && x.herJump < 0.03 && x.headJump < 0.2 && x.apart < 1.3
      && x.minSkin > -0.01 && x.lying < 0.02 && x.hipsY < 0.3 && x.headY < 0.3 && x.landErr < 0.01 && x.clear === '' && x.ko === 'UNCONSCIOUS' && x.aware === 'UNCONSCIOUS' && !x.restrained && x.cqc === 'FREE' && x.spd > 0.9;
    const ok = rows.every(([, x]) => good(x)) && r.alertSeen && page.errors.length === 0;
    return { pass: ok, detail: rows.map(([k, x]) => `${k} (${x.before}): ${x.phases} in ${x.time.toFixed(2)} s, side ${x.side}°, she moved ${(x.herMove * 100).toFixed(1)} cm, head step ≤ ${(x.headJump * 100).toFixed(0)} cm, hips ≤ ${x.apart.toFixed(2)} m from her, skin ≥ ${(x.minSkin * 100).toFixed(1)} cm, lying ${(x.lying * 100).toFixed(1)} cm (hips ${x.hipsY.toFixed(2)}, head ${x.headY.toFixed(2)} m), landed ${(x.landErr * 100).toFixed(1)} cm from plan, ${x.ko}, then she walks at ${x.spd.toFixed(2)} m/s`).join('; ') + `; page errors ${page.errors.length}` };
  },

  // Step 14, 12: the room he needs. A wall on her right: the throw goes to another side and
  // his whole lying body is clear of every wall and crate; in the narrow corridor there's
  // no room on any side: THROW isn't offered, a tap does nothing (still holding him, he's
  // conscious) and the grapple carries on
  async throwCollision() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input, world } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) step(0, 'stand'); else { MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); } noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = n => { for (let i = 0; i < n; i++) frame(); };
      const boxDist = (x, z) => { let m = Infinity; for (const b of world.boxes) m = Math.min(m, Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ))); return m; };
      const setup = (gx, gz, yaw) => { cq.cancel(); g1.patrol.enabled = false; g1.reset(); g2.reset(); g2.motor.teleport(gx, gz, yaw); g2.place(); motor.teleport(gx - Math.sin(yaw) * 1.0, gz - Math.cos(yaw) * 1.0, yaw); for (let k = 0; k < 2; k++) step(0, 'stand'); sim(2); input.cqcTapped = true; sim(40); };
      // along the south perimeter wall, facing west: her right is the wall side
      setup(-8, -21.0, -Math.PI / 2);
      const near = { state: cq.state, check: cq.throwCheck(), right: boxDist(motor.position.x + Math.cos(motor.yaw + Math.PI / 2) * 0, motor.position.z) };
      const first = cq._landingClear(g2.position.clone(), new THREE.Vector3(Math.sin(motor.yaw - Math.PI / 2), 0, Math.cos(motor.yaw - Math.PI / 2)), motor.position.clone(), g2);
      input.throwTapped = true; sim(100);
      const b = g2.ko.body; let bodyClear = Infinity; for (let s = -0.95; s <= 0.9; s += 0.05) bodyClear = Math.min(bodyClear, boxDist(b.position.x + b.along.x * s, b.position.z + b.along.z * s));
      const wall = { side: near.check.side, first, ko: g2.ko.state, bodyClear };
      // in the narrow corridor
      let corridor = null;
      for (const [gx, gz, yaw] of [[17.2, -4, 0], [17.2, -7, 0], [16.9, -2, Math.PI]]) {
        setup(gx, gz, yaw); const c = cq.throwCheck();
        if (cq.state === 'GRAPPLING' && !c.ok) { input.throwTapped = true; sim(30); corridor = { at: [gx, gz], why: c.why, state: cq.state, ko: g2.ko.state, restrained: !!g2.restraint }; let mv0 = motor.position.clone(); sim(1); const f = motor.yaw + Math.PI; for (let i = 0; i < 30; i++) frame(Math.sin(f), Math.cos(f), 1); corridor.pulled = motor.position.distanceTo(mv0); break; }
      }
      cq.cancel(); g2.reset();
      return { wall, corridor, boxes: world.boxes.length };
    });
    const ok = r.wall.side !== -90 && r.wall.first !== '' && r.wall.ko === 'UNCONSCIOUS' && r.wall.bodyClear > 0.1
      && !!r.corridor && /no room/.test(r.corridor.why) && r.corridor.state === 'GRAPPLING' && r.corridor.ko === 'CONSCIOUS' && r.corridor.restrained && r.corridor.pulled > 0.05 && page.errors.length === 0;
    return { pass: ok, detail: `beside the perimeter wall: her right side refused (${r.wall.first}), thrown to ${r.wall.side}°, ${r.wall.ko}, his lying body ${r.wall.bodyClear.toFixed(2)} m from the nearest wall or crate; ${r.corridor ? `in the corridor at (${r.corridor.at}): "${r.corridor.why}", tap → ${r.corridor.state}, he's ${r.corridor.ko}, still restrained ${r.corridor.restrained}, the pull still works (${r.corridor.pulled.toFixed(2)} m)` : 'no corridor spot found'}` };
  },

  // Step 14, 15–16: the landing makes one sound, from where he lands: a "body impact"
  // (source 'takedown') at the configured level. It goes through normal hearing: Guard 1,
  // 9 m away with his back to it (he never sees her), hears it and turns to it (SUSPICIOUS /
  // INVESTIGATING about the landing spot, not about where she goes afterwards); moved out
  // of its reach he hears nothing and stays NORMAL. The thrown guard hears nothing
  async throwNoise() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) step(0, 'stand'); else { MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); } noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = n => { for (let i = 0; i < n; i++) frame(); };
      const events = []; const off = noise.on(ev => { if (ev.source !== 'player') events.push({ type: ev.type, level: ev.level, source: ev.source, p: ev.position.clone(), radius: ev.radius }); });
      const go = g1At => {
        cq.cancel(); g1.patrol.enabled = false; g1.reset(); g2.reset(); g1.motor.teleport(g1At[0], g1At[1], g1At[2]); g1.place(); g1.post.copy(g1.position); g1.postYaw = g1.yaw; g1.reset();
        const b = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b.x, b.z, g2.yaw); for (let k = 0; k < 2; k++) step(0, 'stand'); sim(2);
        input.cqcTapped = true; sim(40); events.length = 0; input.throwTapped = true; sim(95);
        const land = g2.ko.body.position.clone();
        // she slips away (out of everyone's sight) after the throw
        motor.teleport(-19, 19, 0); sim(120);
        const a = g1.awareness, h = g1.hearing.last;
        return { events: events.map(e => ({ ...e, d: Math.hypot(e.p.x - land.x, e.p.z - land.z) })), g1: { state: a.state, heard: !!(h && h.heard && h.type === 'body impact'), dist: Math.hypot(g1.position.x - land.x, g1.position.z - land.z),
          focus: a.heard ? Math.hypot(a.heard.position.x - land.x, a.heard.position.z - land.z) : 99, toHer: a.heard ? Math.hypot(a.heard.position.x - motor.position.x, a.heard.position.z - motor.position.z) : 0, seenHer: g1.vision.meter }, self: g2.hearing.last ? g2.hearing.last.heard : null };
      };
      const near = go([-12, -9.6, 0]);   // 9 m north, facing away from the throw (it's behind him)
      const far = go([8, -6, 0]);        // 23 m away (out of reach on concrete at level 3)
      off(); cq.cancel(); MV.guard.post.set(2, 0, -16); MV.guard.postYaw = 0; g1.reset(); g2.reset();
      return { near, far, level: cq.tcfg.noiseLevel };
    });
    const ev = r.near.events;
    const ok = ev.length === 1 && ev[0].type === 'body impact' && ev[0].source === 'takedown' && ev[0].level === r.level && ev[0].d < 0.01
      && r.near.g1.heard && /SUSPICIOUS|INVESTIGATING/.test(r.near.g1.state) && r.near.g1.focus < 1.5 && r.near.g1.toHer > 5 && r.near.g1.seenHer === 0
      && r.far.events.length === 1 && !r.far.g1.heard && r.far.g1.state === 'NORMAL' && r.near.self === false && page.errors.length === 0;
    return { pass: ok, detail: `events from the throw: ${ev.map(e => `${e.type} L${e.level} (${e.source}) ${(e.d * 100).toFixed(1)} cm from where he landed, reach ${e.radius.toFixed(1)} m`).join(', ')}; Guard 1 ${r.near.g1.dist.toFixed(1)} m away, back turned: heard ${r.near.g1.heard}, ${r.near.g1.state}, his idea of the sound ${r.near.g1.focus.toFixed(2)} m from the landing and ${r.near.g1.toHer.toFixed(1)} m from where she is now, saw her ${Math.round(r.near.g1.seenHer * 100)}%; ${r.far.g1.dist.toFixed(1)} m away: heard ${r.far.g1.heard}, ${r.far.g1.state}; the thrown guard heard it: ${r.near.self}` };
  },

  // Step 14, 18–19: unconscious. For 20 s she walks round him, stands in his face and stamps
  // beside him: he never sees (meter 0) or hears anything, stays UNCONSCIOUS (no ALERT, no
  // search, no vocal reaction, no awareness indicator), Guard 1's patrol doesn't move him,
  // his body doesn't move or animate (position and head < 1 mm), CQC can't grab him; his
  // standing collider is gone and two low ones lie along his body: she can't walk through
  // him but can walk round him
  async unconsciousState() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input, world } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) motor.update(dt, dx || 0, dz || 0, mag || 0); MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); noise.update(dt); g1.update(dt, T); g2.update(dt, T); MV.indicator.update(dt, MV.camera, 640, 300); };
      const sim = (n, dx, dz, mag) => { for (let i = 0; i < n; i++) frame(dx, dz, mag); };
      const W = b => b.getWorldPosition(new THREE.Vector3());
      // Guard 1 (on his patrol) thrown near his post
      cq.cancel(); g2.reset(); g1.patrol.enabled = true; g1.reset(); sim(30);
      const b = g1.position.clone().addScaledVector(g1.forward(), -1.0); motor.teleport(b.x, b.z, g1.yaw); for (let k = 0; k < 2; k++) step(0, 'stand');
      input.cqcTapped = true; sim(40); input.throwTapped = true; sim(95);
      const a = g1.awareness, p0 = g1.position.clone(), h0 = W(g1.head), r0 = a.reactions, cyl = world.cylinders.length, standing = g1.collider.x;
      const lying = g1.ko.colliders.map(c => ({ r: c.r, top: c.top }));
      let meter = 0, states = new Set(), heard = 0, moved = 0, headMoved = 0, grab = '', ind = 0, closest = Infinity;
      const B = g1.ko.body, ring = t => new THREE.Vector3(B.position.x + Math.sin(t) * 1.4, 0, B.position.z + Math.cos(t) * 1.4);
      for (let i = 0; i < 20 * 60; i++) {
        if (i % 300 === 0) { const q = i < 600 ? ring(i / 100) : B.position.clone().addScaledVector(new THREE.Vector3(-B.along.z, 0, B.along.x), 0.75); motor.teleport(q.x, q.z, Math.atan2(B.position.x - q.x, B.position.z - q.z)); }
        if (i % 20 === 0) noise.emit(3, 'footstep', motor.position.clone(), 'metal', 'player');
        // walk straight at his body: she's stopped by it
        const tx = B.position.x - motor.position.x, tz = B.position.z - motor.position.z, d = Math.hypot(tx, tz) || 1;
        frame(tx / d, tz / d, 0.5);
        closest = Math.min(closest, ...g1.ko.colliders.map(c => Math.hypot(c.x - motor.position.x, c.z - motor.position.z) - c.r - motor.cfg.radius));
        meter = Math.max(meter, g1.vision.meter); states.add(a.state); if (g1.hearing.last && g1.hearing.last.heard) heard++;
        moved = Math.max(moved, g1.position.distanceTo(p0)); headMoved = Math.max(headMoved, W(g1.head).distanceTo(h0));
        if (MV.indicator.visible && MV.indicator.kind) ind++;
      }
      motor.teleport(B.position.x - B.along.z * 0.9, B.position.z + B.along.x * 0.9, 0); for (let k = 0; k < 2; k++) step(0, 'stand'); grab = cq.check();
      // walk round him: a circle 1.2 m out
      let round = 0; motor.teleport(B.position.x + 1.2, B.position.z, 0); const s0 = motor.position.clone();
      for (let i = 0; i < 240; i++) { const t = Math.atan2(motor.position.x - B.position.x, motor.position.z - B.position.z) + Math.PI / 2; frame(Math.sin(t), Math.cos(t), 0.5); round += 0; }
      round = motor.position.distanceTo(s0) + 0.0;
      const out = { meter, states: [...states], heard, moved, headMoved, grab, ind, closest, cyl, standing, lying, reactions: a.reactions - r0, patrol: g1.patrol.state, ko: g1.ko.state, left: g1.ko.left, travelled: round };
      cq.cancel(); g1.reset(); g2.reset(); out.cylAfter = world.cylinders.length;
      return out;
    });
    const ok = r.meter === 0 && r.states.length === 1 && r.states[0] === 'UNCONSCIOUS' && r.heard === 0 && r.moved < 0.001 && r.headMoved < 0.001 && /down/.test(r.grab) && r.ind === 0
      && r.reactions === 0 && r.ko === 'UNCONSCIOUS' && r.standing > 1e5 && r.lying.length === 2 && r.lying.every(c => c.top <= 0.3) && r.closest > -0.01 && r.travelled > 1 && r.cylAfter === r.cyl - 2 && page.errors.length === 0;
    return { pass: ok, detail: `20 s with her circling him, in his face and stamping on metal: detection ${Math.round(r.meter * 100)}%, states ${r.states.join(',')}, sounds heard ${r.heard}, new reactions ${r.reactions}, indicator frames ${r.ind}, body moved ${(r.moved * 1000).toFixed(2)} mm, head ${(r.headMoved * 1000).toFixed(2)} mm, patrol ${r.patrol}, ${r.left.toFixed(0)} s left; CQC by him: "${r.grab}"; standing collider ${r.standing > 1e5 ? 'off' : 'ON'}, lying colliders ${r.lying.map(c => `r ${c.r} top ${c.top}`).join(' / ')}; walking straight at him she stayed ${(r.closest * 100).toFixed(1)} cm clear; walking round him she covered ${r.travelled.toFixed(2)} m; after RESET ${r.cylAfter} colliders (was ${r.cyl})` };
  },

  // Step 14, 20–24: recovery. The timer runs on game time (10 s → 10 s less); when it runs
  // out he stirs, sits up and gets up (in that order, ≈3.5 s), skin never below the ground,
  // no jumps, standing where his body lay, his standing collider back and the lying ones
  // gone. If she's standing on that spot he waits, and gets up once she moves away. Awake,
  // he knows he was attacked: an Active Search around where it happened (where she was then),
  // not where she is now (she left; no heading carried over). Once it all runs out Guard 1
  // goes back to his patrol and Guard 2 walks back to his post (no teleport)
  async recovery() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input, world } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget, A = MV.SCmv.ThrowAnim;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) step(0, 'stand'); else { MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); } noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = n => { for (let i = 0; i < n; i++) frame(); }, until = (fn, max) => { let n = 0; while (!fn() && n < max) { frame(); n++; } return n; };
      const W = b => b.getWorldPosition(new THREE.Vector3());
      const throwG = g => { const b = g.position.clone().addScaledVector(g.forward(), -1.0); motor.teleport(b.x, b.z, g.yaw); for (let k = 0; k < 2; k++) step(0, 'stand'); sim(2); input.cqcTapped = true; sim(40); const at = motor.position.clone().setY(0); input.throwTapped = true; sim(95); return at; };
      const out = {};
      // Guard 2
      cq.cancel(); g1.patrol.enabled = false; g1.reset(); g2.reset(); sim(5);
      const attackAt = throwG(g2), body = g2.ko.body.position.clone();
      const left0 = g2.ko.left; sim(600); out.timer = left0 - g2.ko.left;
      // she leaves, out of his sight, while he's out
      motor.teleport(-19, 19, 0);
      until(() => g2.ko.state === 'WAKING', 60 * 60); const wakeAt = g2.awareness.clock - g2.ko.body.at;   // game time since he hit the ground
      const phases = []; let minSkin = Infinity, headJump = 0, lh = W(g2.head), frames = 0;
      while (g2.ko.state === 'WAKING' && frames < 600) { if (phases[phases.length - 1] !== g2.ko.phase) phases.push(g2.ko.phase); frame(); frames++; if (g2.isDown()) minSkin = Math.min(minSkin, A.lowest(g2)); const h = W(g2.head); headJump = Math.max(headJump, h.distanceTo(lh)); lh.copy(h); }
      const a = g2.awareness;
      Object.assign(out, { wakeAt, phases: phases.join('>'), wakeTime: frames / 60, minSkin, headJump, standErr: Math.hypot(g2.position.x - body.x, g2.position.z - body.z), headY: W(g2.head).y,
        collider: Math.hypot(g2.collider.x - g2.position.x, g2.collider.z - g2.position.z), lyingLeft: g2.ko.colliders.length, state: a.state, note: a.note,
        anchor: (() => { const e = a.evasion, p = e && (e.visited[0] || (e.dest && e.dest.p)); return p ? Math.hypot(p.x - attackAt.x, p.z - attackAt.z) : 99; })(),   // his first search spot (a sentry can't walk to it: it's marked visited)
        seenAt: a.seen ? Math.hypot(a.seen.position.x - attackAt.x, a.seen.position.z - attackAt.z) : 99, seenHer: a.seen ? Math.hypot(a.seen.position.x - motor.position.x, a.seen.position.z - motor.position.z) : 0, travel: a.evasion ? a.evasion.travel : 'none', track: a.track.length });
      // settles, then back to his post on foot
      a.cfg.evasionTime = 6; a.evasion.end = a.clock + 6; a.cfg.heightenedTime = 6; let jump = 0, lp = g2.position.clone();
      const home = until(() => { jump = Math.max(jump, g2.position.distanceTo(lp)); lp.copy(g2.position); return a.state === 'NORMAL' && g2.atPost(); }, 60 * 90) / 60;
      Object.assign(out, { home, homeJump: jump, atPost: g2.atPost() });
      a.cfg.evasionTime = 30; a.cfg.heightenedTime = 60;
      // Guard 1: thrown on his patrol, wakes, searches, then patrols again
      cq.cancel(); g2.reset(); g1.patrol.enabled = true; g1.reset(); until(() => g1.patrol.state === 'walking' && g1.moving, 600);
      throwG(g1); motor.teleport(-19, 19, 0); g1.ko.left = 0.05; until(() => !g1.isDown(), 600);
      const b1 = g1.awareness; b1.cfg.evasionTime = 4; b1.evasion.end = b1.clock + 4; b1.cfg.heightenedTime = 4;
      const p1 = g1.position.clone(); const back = until(() => b1.state === 'NORMAL' && g1.patrol.state !== 'interrupted' && g1.position.distanceTo(p1) > 1.5, 60 * 120) / 60;
      Object.assign(out, { g1back: back, g1patrol: g1.patrol.state, g1state: b1.state });
      b1.cfg.evasionTime = 30; b1.cfg.heightenedTime = 60;
      // no room to get up: she stands where he'd stand
      cq.cancel(); g1.patrol.enabled = false; g1.reset(); g2.reset(); sim(5); throwG(g2);
      const spot = g2.ko.body.position.clone(), dir = g2.ko.body.along;
      motor.teleport(spot.x - dir.z * 0.45, spot.z + dir.x * 0.45, 0); step(0, 'stand'); g2.ko.left = 0.05; sim(120);
      out.blocked = { state: g2.ko.state, note: g2.ko.note };
      motor.teleport(-19, 19, 0); sim(40); out.blocked.after = g2.ko.state;
      cq.cancel(); g1.reset(); g2.reset();
      return out;
    });
    const ok = Math.abs(r.timer - 10) < 0.05 && Math.abs(r.wakeAt - 60) < 0.2 && r.phases === 'stirring>sittingUp>rising' && Math.abs(r.wakeTime - 3.5) < 0.1 && r.minSkin > -0.01 && r.headJump < 0.08
      && r.standErr < 0.01 && r.headY > 1.3 && r.collider < 0.01 && r.lyingLeft === 0 && (r.state === 'EVASION') && /attacked/.test(r.note) && r.anchor < 1.5 && r.seenAt < 0.01 && r.seenHer > 5 && r.travel === null && r.track === 0
      && r.home > 0 && r.home < 90 && r.homeJump < 0.06 && r.atPost && r.g1back > 0 && r.g1back < 120 && r.g1state === 'NORMAL' && r.g1patrol !== 'interrupted'
      && r.blocked.state === 'UNCONSCIOUS' && /no room/.test(r.blocked.note) && r.blocked.after !== 'UNCONSCIOUS' && page.errors.length === 0;
    return { pass: ok, detail: `10 s of game time took ${r.timer.toFixed(2)} s off his timer; waking began ${r.wakeAt.toFixed(2)} s after he hit the ground; ${r.phases} in ${r.wakeTime.toFixed(2)} s, skin ≥ ${(r.minSkin * 100).toFixed(1)} cm, head step ≤ ${(r.headJump * 100).toFixed(1)} cm, standing ${(r.standErr * 100).toFixed(1)} cm from where he lay (head at ${r.headY.toFixed(2)} m), collider back (${(r.collider * 100).toFixed(1)} cm), lying colliders left ${r.lyingLeft}; awake: ${r.state} ("${r.note}"), first search spot ${r.anchor.toFixed(2)} m from where she attacked, memory of her ${r.seenAt.toFixed(2)} m from there and ${r.seenHer.toFixed(1)} m from where she is now, heading ${r.travel === null ? 'none' : 'KNOWN'}, track ${r.track}; Guard 2 walked home in ${r.home.toFixed(1)} s (step ≤ ${(r.homeJump * 100).toFixed(1)} cm), at post ${r.atPost}; Guard 1 back on patrol ${r.g1back.toFixed(1)} s after waking (${r.g1state}, patrol ${r.g1patrol}); with her on his spot: ${r.blocked.state} ("${r.blocked.note}"), then ${r.blocked.after} once she moved` };
  },

  // Step 14, 25: independent guards. While Guard 2 is thrown and lies unconscious, Guard 1
  // patrols on as before (same route positions as a run where Guard 2 is only grabbed and
  // released; a quiet landing here, out of his hearing), conscious;
  // both can be out at once, each on his own timer, each with his own pose and colliders
  async throwIndependence() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) step(0, 'stand'); else { MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); } noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = n => { for (let i = 0; i < n; i++) frame(); };
      const track = n => { const t = []; for (let i = 0; i < n; i++) { frame(); if (i % 30 === 0) t.push(g1.position.clone()); } return t; };
      const prep = () => { cq.cancel(); g1.patrol.enabled = true; g1.reset(); g2.reset(); const b = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b.x, b.z, g2.yaw); for (let k = 0; k < 2; k++) step(0, 'stand'); };
      // (a quiet landing for this check: hearing it is a legitimate reaction, covered by throwNoise)
      const lvl = cq.tcfg.noiseLevel; cq.tcfg.noiseLevel = 1;
      // (both runs alike: grab, then release or throw, then she slips away out of his sight)
      prep(); input.cqcTapped = true; sim(40); input.cqcTapped = true; sim(95); motor.teleport(-19, 19, 0); const ref = track(900);   // grab and release (no throw)
      prep(); input.cqcTapped = true; sim(40); input.throwTapped = true; sim(95); motor.teleport(-19, 19, 0); const run = track(900);
      let dev = 0; for (let i = 0; i < ref.length; i++) dev = Math.max(dev, ref[i].distanceTo(run[i]));
      const g1state = g1.ko.state, g1aware = g1.awareness.state, g2state = g2.ko.state;
      // both down: Guard 1 thrown 20 s after Guard 2
      g2.ko.left = 40; const b = g1.position.clone().addScaledVector(g1.forward(), -1.0); motor.teleport(b.x, b.z, g1.yaw); for (let k = 0; k < 2; k++) step(0, 'stand');
      input.cqcTapped = true; sim(40); input.throwTapped = true; sim(95);
      const both = { g1: g1.ko.state, g2: g2.ko.state, l1: g1.ko.left, l2: g2.ko.left, frozen: g1._frozen !== g2._frozen && !!g1._frozen && !!g2._frozen, cols: g1.ko.colliders[0] !== g2.ko.colliders[0], fall: g1.fall !== g2.fall };
      sim(60 * 39.5); both.g2After = g2.ko.state; both.g1After = g1.ko.state;
      cq.cancel(); g1.reset(); g2.reset(); cq.tcfg.noiseLevel = lvl;
      return { dev, g1state, g1aware, g2state, both };
    });
    const ok = r.dev < 0.01 && r.g1state === 'CONSCIOUS' && r.g1aware === 'NORMAL' && r.g2state === 'UNCONSCIOUS' && r.both.g1 === 'UNCONSCIOUS' && r.both.g2 === 'UNCONSCIOUS' && r.both.l1 > r.both.l2 + 15
      && r.both.frozen && r.both.cols && r.both.fall && r.both.g2After === 'WAKING' && r.both.g1After === 'UNCONSCIOUS' && page.errors.length === 0;
    return { pass: ok, detail: `Guard 1's patrol with Guard 2 thrown vs only grabbed and released: largest difference ${(r.dev * 100).toFixed(2)} cm, he's ${r.g1state} / ${r.g1aware} while Guard 2 is ${r.g2state}; both out: ${r.both.g1} (${r.both.l1.toFixed(1)} s left) and ${r.both.g2} (${r.both.l2.toFixed(1)} s left), own poses ${r.both.frozen}, own colliders ${r.both.cols}; 39.5 s later Guard 2 ${r.both.g2After}, Guard 1 still ${r.both.g1After}` };
  },

  // Step 14, 1–3, 7, 26–27 with real iPhone touches (frame loop running). THROW is hidden
  // until she holds a guard, then shows above RELEASE, clear of the CQC and CROUCH buttons
  // and on the camera side of the screen. Pulling him around with the stick never throws;
  // RELEASE still frees him. A real tap on THROW (while the stick is held) throws Guard 2;
  // holding the button and tapping again mid-throw doesn't start a second throw, and the
  // button is gone while throwing. RESET mid-throw and RESET while he's unconscious both
  // put both guards back at their posts, standing and conscious, and clear the throw
  async throwTouch() {
    const page = await touchPage(), Tc = page.touch;
    let step = 'start';
    // a missing button names the step and the state it failed in (instead of a bare crash)
    const box = async sel => { const b = await page.locator(sel).boundingBox(); if (!b) throw new Error(`${sel} not shown at "${step}": ` + JSON.stringify(await page.evaluate(() => ({ cqc: MV.cqc.state, last: MV.cqc.lastTry, tap: MV.input.cqcLast, heldFor: MV.input.cqcHeldFor, takedown: MV.cqc.lastTakedown, ko: MV.guard2.ko.state, aware: MV.guard2.awareness.state })))); return b; };
    const tapAt = async (b, ms) => { { const down = Tc('touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 }]); await page.waitForTimeout(ms || 80); const up = Tc('touchEnd', []); await down; await up; /* finger-up on time, not after the page acknowledges finger-down */ } await page.waitForTimeout(120); };
    const behind = async () => { await page.evaluate(() => { const g = MV.guard2; const b = g.position.clone().addScaledVector(g.forward(), -1.0); MV.motor.teleport(b.x, b.z, g.yaw); MV.cam.snap(MV.motor); }); await page.waitForTimeout(250); };
    // (the harness can deliver a finger-up late under load: a tap its own events time at < the hold time, read as a HOLD
    // because the finger-up reached the page only after two frames past the threshold. Recognised by exactly that and
    // retapped once; anything else is a real result)
    let retaps = 0;
    const grab = async () => {
      await tapAt(await box('#mv-cqc')); await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {});
      const late = await page.evaluate(() => MV.cqc.state !== 'GRAPPLING' && MV.input.cqcLast === 'HOLD' && MV.input.cqcHeldFor < MV.input.cqcHoldTime);
      if (late && !retaps) { retaps++; await page.evaluate(() => { MV.cqc.cancel(); MV.guard2.reset(); }); await behind(); await tapAt(await box('#mv-cqc')); await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {}); }
      await page.waitForTimeout(300);
    };
    await page.evaluate(() => { MV.guard2.reset(); document.getElementById('mv-stats').hidden = false; });
    const hiddenFree = await page.evaluate(() => document.getElementById('mv-throw').hidden);
    step = 'first grab'; await behind(); await grab();
    const shown = await page.evaluate(() => ({ hidden: document.getElementById('mv-throw').hidden, ready: document.getElementById('mv-throw').classList.contains('ready'), cqc: document.getElementById('mv-cqc').textContent }));
    const tb = await box('#mv-throw'), cb = await box('#mv-cqc'), kb = await box('#mv-crouch'), vw = page.viewportSize().width;
    const over = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    const layout = { overlap: over(tb, cb) || over(tb, kb), right: tb.x > vw * 0.45 };
    // pull him around with the stick for 2 s: no throw
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); for (let i = 0; i < 12; i++) { await Tc('touchMove', [{ x: 150 + (i % 2 ? 40 : -40), y: 340, id: 1 }]); await page.waitForTimeout(160); }
    await Tc('touchEnd', []); await page.waitForTimeout(200);
    const pulled = await page.evaluate(() => ({ state: MV.cqc.state, throws: MV.cqc.throws, down: MV.guard2.isDown() }));
    // RELEASE still works
    await tapAt(await box('#mv-cqc')); await page.waitForFunction(() => MV.cqc.state === 'FREE', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(200);
    const released = await page.evaluate(() => ({ state: MV.cqc.state, restrained: !!MV.guard2.restraint, down: MV.guard2.isDown(), aware: MV.guard2.awareness.state, hidden: document.getElementById('mv-throw').hidden }));
    // grab again; THROW with the stick held, holding the button 600 ms, then a second tap mid-throw
    step = 'second grab'; await page.evaluate(() => { MV.guard2.reset(); }); await behind(); await grab();
    const t = await box('#mv-throw');
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 150, y: 310, id: 1 }]);
    await Tc('touchStart', [{ x: 150, y: 310, id: 1 }, { x: t.x + t.width / 2, y: t.y + t.height / 2, id: 8 }]);
    await page.waitForTimeout(600); await Tc('touchEnd', [{ x: 150, y: 310, id: 1 }]);
    const mid = await page.evaluate(() => ({ state: MV.cqc.state, hidden: document.getElementById('mv-throw').hidden, phase: MV.cqc.thr && MV.cqc.thr.phase }));
    await page.evaluate(() => { MV.input.throwTapped = true; });   // a second request mid-throw
    await Tc('touchEnd', []);
    await page.waitForFunction(() => MV.cqc.state === 'FREE', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ state: MV.cqc.state, throws: MV.cqc.throws, impacts: MV.cqc.impacts, ko: MV.guard2.ko.state, stat: document.getElementById('mv-ko').textContent + ' | ' + document.getElementById('mv-g2').textContent, hidden: document.getElementById('mv-throw').hidden }));
    // RESET while he's unconscious
    await page.tap('#mv-reset'); await page.waitForTimeout(300);
    const state = () => page.evaluate(() => ({ cqc: MV.cqc.state, stance: MV.motor.stance, hidden: document.getElementById('mv-throw').hidden, cyl: MV.world.cylinders.length,
      g: MV.guards.map(g => ({ ko: g.ko.state, aware: g.awareness.state, post: Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z), tilt: g.fall.quaternion.w, restrained: !!g.restraint, col: Math.hypot(g.collider.x - g.position.x, g.collider.z - g.position.z) })) }));
    const resetKO = await state();
    // RESET mid-throw
    step = 'grab after RESET'; await behind(); await grab(); await tapAt(await box('#mv-throw'));
    await page.waitForFunction(() => MV.cqc.thr && MV.cqc.thr.phase === 'throw', null, { timeout: 8000, polling: 'raf' }).catch(() => {});
    const during = await page.evaluate(() => MV.cqc.thr && MV.cqc.thr.phase);
    await page.tap('#mv-reset'); await page.waitForTimeout(300);
    const resetMid = await state();
    const clean = s => s.cqc === 'FREE' && s.stance === 'stand' && s.hidden && s.g.every(g => g.ko === 'CONSCIOUS' && g.aware === 'NORMAL' && g.post < 0.01 && Math.abs(g.tilt) > 0.9999 && !g.restrained && g.col < 0.01);
    const ok = hiddenFree && !shown.hidden && shown.ready && shown.cqc === 'RELEASE' && !layout.overlap && layout.right && pulled.state === 'GRAPPLING' && pulled.throws === 0 && !pulled.down
      && released.state === 'FREE' && !released.restrained && !released.down && released.aware === 'ALERT' && released.hidden
      && mid.state === 'THROWING' && mid.hidden && after.state === 'FREE' && after.throws === 1 && after.impacts === 1 && after.ko === 'UNCONSCIOUS' && /UNCONSCIOUS/.test(after.stat)
      && clean(resetKO) && during === 'throw' && clean(resetMid) && resetKO.cyl === resetMid.cyl && page.errors.length === 0;
    return { pass: ok, detail: `${retaps ? '(1 retap: a finger-up delivered late by the harness) ' : ''}free: THROW hidden ${hiddenFree}; holding him: shown ${!shown.hidden}, lit ${shown.ready}, CQC reads "${shown.cqc}", overlaps CQC/CROUCH ${layout.overlap}, on the camera side ${layout.right}; 2 s of pulling: ${pulled.state}, throws ${pulled.throws}; RELEASE: ${released.state}, he's ${released.aware}, down ${released.down}; THROW tapped with the stick held: ${mid.state} (${mid.phase}), button hidden ${mid.hidden}; after a held press and a second request: throws ${after.throws}, impacts ${after.impacts}, he's ${after.ko}, stats "${after.stat}"; RESET while unconscious: ${resetKO.cqc}, guards ${resetKO.g.map(g => g.ko + '/' + g.aware + ' ' + g.post.toFixed(2) + ' m').join(', ')}; RESET mid-throw (${during}): ${resetMid.cqc}, stance ${resetMid.stance}, guards ${resetMid.g.map(g => g.ko + '/' + g.aware + ' ' + g.post.toFixed(2) + ' m').join(', ')}, colliders ${resetMid.cyl}; page errors ${page.errors.length}` };
  },

  // HUD: the developer stats are a bar along the top edge on iPhone landscape (844×390,
  // 667×375, 932×430): starting within 12 px of the top, fully on screen (every value inside
  // it, nothing past the right edge), wide (≥ 85% of the width) and short (≤ 35% of the
  // height), positioned from the safe-area insets. While it's open the title is hidden and
  // RESET / STATS sit in its top-right corner: no value overlaps them, CROUCH or CQC, and it
  // ends above the THROW button. RESET, STATS and, while holding a guard, THROW and RELEASE
  // get the touch at their centres. Every category shows a value. Values far longer than
  // any real one stay inside the bar (cut short). (24 values since Step 16's TAKEDOWN.) STATS hides it (the title comes back)
  // and shows it again
  async statsBar() {
    const out = [];
    let errors = 0;
    for (const [w, h] of [[844, 390], [667, 375], [932, 430]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
      await page.goto(base + '/movement.html'); await page.waitForSelector('#mv-start:not([hidden])', { timeout: 120000 });
      await page.tap('#mv-start'); await page.waitForTimeout(300); await page.evaluate(() => MV.setStats(true));   // (Step 24.1: STATS starts collapsed)
      await page.evaluate(() => { const g = MV.guard2; const b = g.position.clone().addScaledVector(g.forward(), -1.0); MV.motor.teleport(b.x, b.z, g.yaw); MV.cam.snap(MV.motor); MV.input.cqcTapped = true; });
      await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
      const geo = () => page.evaluate(() => {
        const bar = document.getElementById('mv-stats'), R = bar.getBoundingClientRect(), W = innerWidth, H = innerHeight;
        const vals = [...bar.querySelectorAll('b')], cells = [...bar.querySelectorAll('.mv-sec > div')];
        const rect = id => document.getElementById(id).getBoundingClientRect();
        const over = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        // (Step 24.2: what the capped, scrolling bar shows: each cell clipped to the bar's box, as overflow-y clips it on screen)
        const vis = r => ({ left: Math.max(r.left, R.left), right: Math.min(r.right, R.right), top: Math.max(r.top, R.top), bottom: Math.min(r.bottom, R.bottom) });
        const cellRects = cells.map(c => vis(c.getBoundingClientRect())).filter(r => r.top < r.bottom && r.left < r.right);
        const clear = ['mv-reset', 'mv-stats-btn', 'mv-crouch', 'mv-cqc', 'mv-throw', 'mv-aim'].map(rect).every(b => cellRects.every(c => !over(c, b))) && R.bottom <= rect('mv-throw').top
          && getComputedStyle(document.querySelector('.mv-head')).display === 'none';
        const overlaps = ['mv-reset', 'mv-stats-btn', 'mv-crouch', 'mv-cqc', 'mv-throw', 'mv-aim'].flatMap(id => cells.filter(c => { const r = vis(c.getBoundingClientRect()); return r.top < r.bottom && r.left < r.right && over(r, rect(id)); }).map(c => id + '/' + c.textContent.trim().slice(0, 24)));
        const hit = ['mv-reset', 'mv-stats-btn', 'mv-throw', 'mv-cqc'].every(id => { const b = rect(id); return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === document.getElementById(id); });
        const rule = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (e) { return []; } }).find(r => r.selectorText === '.mv-panel');
        const safe = !!rule && /safe-area-inset-top/.test(rule.cssText) && /safe-area-inset-left/.test(rule.cssText) && /safe-area-inset-right/.test(rule.cssText);
        return { W, H, left: R.left, right: R.right, top: R.top, bottom: R.bottom, width: R.width, height: R.height, clear, overlaps, hit, safe,
          inside: cells.every(c => { const r = c.getBoundingClientRect(); return r.left >= R.left - 0.5 && r.right <= R.right + 0.5 && r.bottom <= R.bottom + 0.5; }) && vals.every(v => v.getBoundingClientRect().right <= R.right + 0.5),
          // (Step 24.1: the expanded bar is capped in height and scrolls: what's below its edge is reached by scrolling, never past its right edge)
          reach: cells.every(c => { const r = c.getBoundingClientRect(); return r.left >= R.left - 0.5 && r.right <= R.right + 0.5 && r.bottom <= R.top + bar.scrollHeight + 0.5; }) && vals.every(v => v.getBoundingClientRect().right <= R.right + 0.5),
          empty: vals.filter(v => !v.textContent.trim() || v.getBoundingClientRect().width < 1).map(v => v.id), count: vals.length, fontPx: parseFloat(getComputedStyle(vals[0]).fontSize) };
      });
      const g = await geo();
      // values far longer than any real one
      const long = await page.evaluate(() => { for (const id of ['mv-g2', 'mv-cqcstat', 'mv-memory', 'mv-aware']) document.getElementById(id).textContent = 'VERY LONG DEBUG STATE · '.repeat(20); return true; }) && await geo();
      // STATS toggle
      await page.tap('#mv-stats-btn'); await page.waitForTimeout(200);
      const off = await page.evaluate(() => ({ hidden: document.getElementById('mv-stats').hidden, pressed: document.getElementById('mv-stats-btn').getAttribute('aria-pressed'), title: getComputedStyle(document.querySelector('.mv-head')).display !== 'none' }));
      await page.tap('#mv-stats-btn'); await page.waitForTimeout(400);
      const on = await page.evaluate(() => ({ hidden: document.getElementById('mv-stats').hidden, pressed: document.getElementById('mv-stats-btn').getAttribute('aria-pressed'), g2: document.getElementById('mv-g2').textContent }));
      const ok = g.left >= 0 && g.right <= g.W && g.top >= 0 && g.top <= 12 && (g.inside || g.reach) && g.width >= 0.85 * g.W && g.height <= 0.35 * g.H && g.clear && g.hit && g.safe && g.empty.length === 0 && g.count === 27 && g.fontPx >= 9.5
        && long.reach && long.right <= long.W && long.height <= 0.4 * long.H && off.hidden && off.pressed === 'false' && off.title && !on.hidden && on.pressed === 'true' && !/VERY LONG/.test(on.g2) && errs.length === 0;
      if (!ok) errors++;
      out.push(`${w}×${h}: bar ${Math.round(g.left)}–${Math.round(g.right)} × ${Math.round(g.top)}–${Math.round(g.bottom)} px (${Math.round(g.width / g.W * 100)}% wide, ${Math.round(g.height / g.H * 100)}% tall), ${g.count} values (empty: ${g.empty.join(',') || 'none'}), ${g.fontPx}px, all inside ${g.inside} (or reached by scrolling the capped bar ${g.reach}), title hidden and no value over RESET/STATS/CROUCH/CQC/THROW ${g.clear}${g.overlaps.length ? ' (' + g.overlaps.join(', ') + ')' : ''}, buttons get the touch ${g.hit}, safe-area insets ${g.safe}; very long values: inside ${long.inside} (all reachable by scrolling ${long.reach}), ${Math.round(long.height / long.H * 100)}% tall; STATS off → hidden ${off.hidden} (title back ${off.title}), on → shown ${!on.hidden} (live again ${!/VERY LONG/.test(on.g2)})${errs.length ? ' errors ' + errs.join(';') : ''}`);
      await ctx.close();
    }
    return { pass: errors === 0, detail: out.join(' | ') };
  },

  // Step 15, 4, 9–13, 23: the chokehold on Guard 2 grabbed from behind, Guard 1 on his patrol,
  // and Guard 2 grabbed while fully ALERT. Holding CHOKE: hold > lower > recover; the hold
  // takes the configured 3 s; she doesn't move and the pair stays locked (spacing within
  // 1 cm) even with the stick pushed; he struggles (a hand comes up ≥ 15 cm) and then goes
  // limp (it drops back); lowering is gentle (head ≤ 8 cm a frame), skin never below the
  // ground, and he ends lying on it, UNCONSCIOUS, no longer restrained, at the planned spot;
  // she's FREE and walking again within a second
  async chokeSequence() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget, A = MV.SCmv.ThrowAnim;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) motor.update(dt, dx || 0, dz || 0, mag || 0); MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = n => { for (let i = 0; i < n; i++) frame(); }, until = (fn, max) => { let n = 0; while (!fn() && n < max) { frame(); n++; } return n; };
      const place = (g, rel, d) => { const y = g.yaw + rel, p = g.position.clone().add(new THREE.Vector3(Math.sin(y) * d, 0, Math.cos(y) * d)); motor.teleport(p.x, p.z, Math.atan2(g.position.x - p.x, g.position.z - p.z)); for (let k = 0; k < 2; k++) step(0, 'stand'); };
      const W = b => b.getWorldPosition(new THREE.Vector3());
      const fresh = () => { cq.cancel(); input._chokeKey = false; g1.patrol.enabled = false; g1.reset(); g2.reset(); motor.teleport(-19, 19, 0); sim(10); };
      const run = (g, setup) => {
        setup(); input.cqcTapped = true; sim(40);
        const out = { grabbed: cq.state === 'GRAPPLING' && cq.guard === g, before: g.awareness.state };
        const S = g.position.clone(), P = motor.position.clone(), plan = cq.chokeCheck(), hand0 = W(g.bones.rightHand || g.bones.rightForeArm).y;
        input._chokeKey = true; input.chokePresses++;
        const phases = []; let n = 0, holdF = 0, herMove = 0, sep = 0, headJump = 0, minSkin = Infinity, handMax = -Infinity, handEnd = 0, lh = W(g.head);
        const back = motor.yaw + Math.PI;
        while (n < 600) { frame(Math.sin(back), Math.cos(back), 1); n++; if (cq.state !== 'CHOKING') break; const ph = cq.ch.phase; if (phases[phases.length - 1] !== ph) phases.push(ph);
          if (ph === 'hold') { holdF++; herMove = Math.max(herMove, motor.position.distanceTo(P)); sep = Math.max(sep, Math.abs(Math.hypot(g.position.x - motor.position.x, g.position.z - motor.position.z) - cq.cfg.holdOffset));
            const hy = W(g.bones.rightHand || g.bones.rightForeArm).y; if (cq.ch.p < 0.6) handMax = Math.max(handMax, hy); handEnd = hy; }
          else { const h = W(g.head); headJump = Math.max(headJump, h.distanceTo(lh)); }
          lh.copy(W(g.head)); if (g.isDown()) minSkin = Math.min(minSkin, A.lowest(g)); }
        input._chokeKey = false;
        const land = new THREE.Vector3(S.x + plan.L.x * 0.55, 0, S.z + plan.L.z * 0.55);
        Object.assign(out, { ok: plan.ok, phases: phases.join('>'), holdTime: holdF / 60, herMove, sep, raise: handMax - hand0, relax: handMax - handEnd, headJump, minSkin, lying: A.lowest(g),
          hipsY: W(g.bones.hips).y, headY: W(g.head).y, landErr: Math.hypot(g.position.x - land.x, g.position.z - land.z), ko: g.ko.state, aware: g.awareness.state, restrained: !!g.restraint, cqc: cq.state, done: cq.lastChoke });
        let spd = 0; const f = motor.yaw + Math.PI; for (let i = 0; i < 60; i++) { frame(Math.sin(f), Math.cos(f), 0.78); spd = Math.max(spd, motor.speed); } out.spd = spd;
        return out;
      };
      const out = {};
      fresh(); out['G2 from behind'] = run(g2, () => place(g2, Math.PI, 1.0));
      fresh(); g1.patrol.enabled = true; g1.reset(); until(() => g1.patrol.state === 'walking' && g1.moving, 600); out['G1 on patrol'] = run(g1, () => place(g1, Math.PI, 1.0));
      fresh(); out['G2 fully ALERT'] = run(g2, () => { place(g2, 0, 1.2); until(() => g2.awareness.state === 'ALERT', 300); sim(150); });
      cq.cancel(); g1.reset(); g2.reset();
      return out;
    });
    const rows = Object.entries(r);
    const good = x => x.grabbed && x.ok && x.phases === 'hold>lower>recover' && Math.abs(x.holdTime - 3) < 0.05 && x.herMove < 0.01 && x.sep < 0.01 && x.raise > 0.15 && x.relax > 0.1
      && x.headJump < 0.08 && x.minSkin > -0.01 && x.lying < 0.02 && x.hipsY < 0.3 && x.headY < 0.3 && x.landErr < 0.01 && x.ko === 'UNCONSCIOUS' && x.aware === 'UNCONSCIOUS' && !x.restrained && x.cqc === 'FREE' && x.done === 'completed' && x.spd > 0.9;
    const ok = rows.every(([, x]) => good(x)) && r['G2 fully ALERT'].before === 'ALERT' && page.errors.length === 0;
    return { pass: ok, detail: rows.map(([k, x]) => `${k} (${x.before}): ${x.phases}, held ${x.holdTime.toFixed(2)} s with the stick pushed (she moved ${(x.herMove * 100).toFixed(1)} cm, spacing ±${(x.sep * 100).toFixed(1)} cm), his hand up ${(x.raise * 100).toFixed(0)} cm then down ${(x.relax * 100).toFixed(0)} cm, lowering head step ≤ ${(x.headJump * 100).toFixed(1)} cm, skin ≥ ${(x.minSkin * 100).toFixed(1)} cm, lying ${(x.lying * 100).toFixed(1)} cm, landed ${(x.landErr * 100).toFixed(1)} cm from plan, ${x.ko}, then she walks at ${x.spd.toFixed(2)} m/s`).join('; ') + `; page errors ${page.errors.length}` };
  },

  // Step 15, 5–8, 19, 23–24: letting go and other buttons. A short tap (0.1 s) doesn't knock
  // him out: back to GRAPPLING, conscious, still held; ten quick taps don't either. Let go at
  // ~50%: back to GRAPPLING, and the next choke starts again from 0. The pull works again at
  // once (≥ 0.6 m in 1.5 s, spacing locked). RELEASE and THROW pressed mid-choke do nothing
  // (still choking, no throw); after letting go both work as before. Once he's out, CHOKE
  // can't start again and he can't be grabbed
  async chokeInterrupt() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) step(0, 'stand'); else { MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); } noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = (n, dx, dz, mag) => { for (let i = 0; i < n; i++) frame(dx, dz, mag); };
      const press = () => { input._chokeKey = true; input.chokePresses++; }, up = () => { input._chokeKey = false; };
      const grab = () => { cq.cancel(); up(); g1.patrol.enabled = false; g1.reset(); g2.reset(); const b = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b.x, b.z, g2.yaw); for (let k = 0; k < 2; k++) step(0, 'stand'); sim(2); input.cqcTapped = true; sim(40); };
      const st = () => ({ cqc: cq.state, ko: g2.ko.state, held: !!g2.restraint, p: cq.ch ? cq.ch.p : 0 });
      const out = {};
      grab(); press(); sim(6); up(); sim(2); out.tap = st();
      for (let i = 0; i < 10; i++) { press(); sim(6); up(); sim(4); } out.taps = st();
      press(); sim(90); out.mid = st(); up(); sim(1); out.halfway = Object.assign(st(), { last: cq.lastChoke, interrupts: cq.chokeInterrupts });
      press(); sim(30); out.again = st(); up(); sim(1);
      // the pull, at once
      const c0 = motor.position.clone(), f = motor.yaw + Math.PI; let sep = 0;
      for (let i = 0; i < 90; i++) { frame(Math.sin(f), Math.cos(f), 1); sep = Math.max(sep, Math.abs(Math.hypot(g2.position.x - motor.position.x, g2.position.z - motor.position.z) - cq.cfg.holdOffset)); }
      out.pull = { moved: motor.position.distanceTo(c0), sep, state: cq.state };
      // RELEASE and THROW mid-choke: ignored
      press(); sim(30); const t0 = cq.throws, r0 = cq.releases; input.cqcTapped = true; input.throwTapped = true; sim(10); out.locked = Object.assign(st(), { throws: cq.throws - t0, releases: cq.releases - r0 }); up(); sim(1);
      // after letting go: RELEASE works
      input.cqcTapped = true; sim(40); out.release = { cqc: cq.state, held: !!g2.restraint, aware: g2.awareness.state, ko: g2.ko.state };
      // and THROW works
      grab(); press(); sim(40); up(); sim(1); input.throwTapped = true; sim(2); out.throw = { cqc: cq.state }; sim(100); out.throw.ko = g2.ko.state;
      // once he's out (choked): no new choke, no grab
      grab(); press(); sim(60 * 3 + 120); up(); const before = cq.chokes; press(); sim(10); up(); input.cqcTapped = true; sim(5);
      out.after = { cqc: cq.state, ko: g2.ko.state, newChokes: cq.chokes - before, grab: cq.lastTry };
      cq.cancel(); up(); g1.reset(); g2.reset();
      return out;
    });
    const ok = r.tap.cqc === 'GRAPPLING' && r.tap.ko === 'CONSCIOUS' && r.tap.held && r.taps.cqc === 'GRAPPLING' && r.taps.ko === 'CONSCIOUS'
      && r.mid.cqc === 'CHOKING' && Math.abs(r.mid.p - 0.5) < 0.03 && r.halfway.cqc === 'GRAPPLING' && r.halfway.ko === 'CONSCIOUS' && r.halfway.held && /interrupted at 50%/.test(r.halfway.last)
      && r.again.cqc === 'CHOKING' && r.again.p < 0.2 && r.pull.moved > 0.6 && r.pull.sep < 0.01 && r.pull.state === 'GRAPPLING'
      && r.locked.cqc === 'CHOKING' && r.locked.throws === 0 && r.locked.releases === 0 && r.locked.held
      && r.release.cqc === 'FREE' && !r.release.held && r.release.ko === 'CONSCIOUS' && r.release.aware === 'ALERT' && r.throw.cqc === 'THROWING' && r.throw.ko === 'UNCONSCIOUS'
      && r.after.ko === 'UNCONSCIOUS' && r.after.cqc === 'FREE' && r.after.newChokes === 0 && /down/.test(r.after.grab) && page.errors.length === 0;
    return { pass: ok, detail: `0.1 s tap: ${r.tap.cqc}, he's ${r.tap.ko}, held ${r.tap.held}; ten quick taps: ${r.taps.cqc}, ${r.taps.ko}; held 1.5 s: ${Math.round(r.mid.p * 100)}%, let go: ${r.halfway.cqc}, ${r.halfway.ko}, held ${r.halfway.held} ("${r.halfway.last}", ${r.halfway.interrupts} interrupts); next choke after 0.5 s at ${Math.round(r.again.p * 100)}%; pull straight after: ${r.pull.moved.toFixed(2)} m, spacing ±${(r.pull.sep * 100).toFixed(1)} cm; RELEASE + THROW mid-choke: ${r.locked.cqc}, throws ${r.locked.throws}, releases ${r.locked.releases}; RELEASE after: ${r.release.cqc}, he's ${r.release.aware}; THROW after letting go: ${r.throw.cqc} → ${r.throw.ko}; after a completed choke: new chokes ${r.after.newChokes}, grab "${r.after.grab}"` };
  },

  // Step 15, 14–16: quieter than the throw. A choke makes no impact: one faint "body lowered"
  // event (level 1, source 'takedown') where he's laid down, its reach well under the throw's.
  // Guard 1 8 m away with his back turned (who hears a throw from there, throwNoise) hears
  // nothing and stays NORMAL; 2 m away (back turned) he does hear it, through the normal
  // hearing rules, about the spot where it happened. Facing it with a clear view he sees her
  // (his detection rises) like any other sighting
  async chokeNoise() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) step(0, 'stand'); else { MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); } noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = n => { for (let i = 0; i < n; i++) frame(); };
      const events = []; const off = noise.on(ev => { if (ev.source !== 'player') events.push({ type: ev.type, level: ev.level, source: ev.source, p: ev.position.clone(), radius: ev.radius }); });
      const go = g1At => {
        cq.cancel(); input._chokeKey = false; g1.patrol.enabled = false; g1.reset(); g2.reset(); g1.post.set(g1At[0], 0, g1At[1]); g1.postYaw = g1At[2]; g1.reset();
        const b = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b.x, b.z, g2.yaw); for (let k = 0; k < 2; k++) step(0, 'stand'); sim(2);
        input.cqcTapped = true; sim(40); events.length = 0; let meter = 0; input._chokeKey = true; input.chokePresses++;
        for (let i = 0; i < 300; i++) { frame(); meter = Math.max(meter, g1.vision.meter); } input._chokeKey = false;
        const land = g2.ko.body.position.clone(); motor.teleport(-19, 19, 0); sim(120);
        const a = g1.awareness, h = g1.hearing.last;
        return { events: events.map(e => ({ ...e, d: Math.hypot(e.p.x - land.x, e.p.z - land.z) })), state: a.state, heard: !!(h && h.heard && h.type === 'body lowered'), dist: Math.hypot(g1.position.x - land.x, g1.position.z - land.z),
          focus: a.heard ? Math.hypot(a.heard.position.x - land.x, a.heard.position.z - land.z) : 99, meter };
      };
      // the landing is to her right: work out where it will be first
      const probe = go([2, -16, 0]); const L = probe.events.length ? probe.events[0].p : null;
      const away = (d, face) => { const x = L.x, z = L.z + d; return [x, z, face]; };   // north of the landing
      const far = go(away(8.3, 0)), near = go(away(2.2, 0)), facing = go(away(8.3, Math.PI));
      off(); cq.cancel(); MV.guard.post.set(2, 0, -16); MV.guard.postYaw = 0; g1.reset(); g2.reset();
      return { far, near, facing, throwRadius: noise.reachOf(cq.tcfg.noiseLevel), level: cq.kcfg.lowerNoiseLevel };
    });
    const ev = r.far.events;
    const ok = ev.length === 1 && ev[0].type === 'body lowered' && ev[0].level === r.level && ev[0].source === 'takedown' && ev[0].d < 0.01 && ev[0].radius < r.throwRadius / 3
      && !r.far.heard && r.far.state === 'NORMAL' && r.near.heard && /SUSPICIOUS|INVESTIGATING/.test(r.near.state) && r.near.focus < 1 && r.facing.meter > 0.2 && page.errors.length === 0;
    return { pass: ok, detail: `events from a choke: ${ev.map(e => `${e.type} L${e.level} (${e.source}) reach ${e.radius.toFixed(1)} m, ${(e.d * 100).toFixed(1)} cm from where he lies`).join(', ')} (a throw's reach: ${r.throwRadius.toFixed(1)} m); Guard 1 ${r.far.dist.toFixed(1)} m away, back turned: heard ${r.far.heard}, ${r.far.state}; ${r.near.dist.toFixed(1)} m away: heard ${r.near.heard}, ${r.near.state}, about ${r.near.focus.toFixed(2)} m from the spot; ${r.facing.dist.toFixed(1)} m away facing it: detection up to ${Math.round(r.facing.meter * 100)}%` };
  },

  // Step 15, 12, 17–18: choked out, he's in the same unconsciousness as a thrown guard: 60 s
  // of game time, then stirring > sitting up > rising; he searches from where he was attacked
  // with no idea where she went; Guard 2 then walks home and Guard 1 back to his patrol. The
  // guards stay independent: Guard 1 patrols on unaffected while Guard 2 is choked and out
  async chokeRecovery() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) step(0, 'stand'); else { MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); } noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = n => { for (let i = 0; i < n; i++) frame(); }, until = (fn, max) => { let n = 0; while (!fn() && n < max) { frame(); n++; } return n; };
      const choke = g => { const b = g.position.clone().addScaledVector(g.forward(), -1.0); motor.teleport(b.x, b.z, g.yaw); for (let k = 0; k < 2; k++) step(0, 'stand'); sim(2); input.cqcTapped = true; sim(40); const at = motor.position.clone().setY(0); input._chokeKey = true; input.chokePresses++; until(() => cq.state === 'FREE', 600); input._chokeKey = false; return at; };
      const out = {};
      cq.cancel(); g1.patrol.enabled = true; g1.reset(); g2.reset(); sim(5);
      const attackAt = choke(g2); const body = g2.ko.body.position.clone();
      motor.teleport(-19, 19, 0);
      const p1 = g1.position.clone(); let g1Down = false; for (let i = 0; i < 600; i++) { frame(); if (g1.isDown()) g1Down = true; }
      out.indep = { g1moved: g1.position.distanceTo(p1), g1Down, g1ko: g1.ko.state, g1aware: g1.awareness.state, left: g2.ko.left, since: g2.awareness.clock - g2.ko.body.at };
      until(() => g2.ko.state === 'WAKING', 60 * 60); out.wakeAt = g2.awareness.clock - g2.ko.body.at;
      const phases = []; while (g2.ko.state === 'WAKING') { if (phases[phases.length - 1] !== g2.ko.phase) phases.push(g2.ko.phase); frame(); }
      const a = g2.awareness;
      Object.assign(out, { phases: phases.join('>'), stand: Math.hypot(g2.position.x - body.x, g2.position.z - body.z), state: a.state, note: a.note,
        seenAt: a.seen ? Math.hypot(a.seen.position.x - attackAt.x, a.seen.position.z - attackAt.z) : 99, seenHer: a.seen ? Math.hypot(a.seen.position.x - motor.position.x, a.seen.position.z - motor.position.z) : 0, travel: a.evasion ? a.evasion.travel : 'none' });
      a.cfg.evasionTime = 6; a.evasion.end = a.clock + 6; a.cfg.heightenedTime = 6;
      out.home = until(() => a.state === 'NORMAL' && g2.atPost(), 60 * 90) / 60; out.atPost = g2.atPost();
      a.cfg.evasionTime = 30; a.cfg.heightenedTime = 60;
      // Guard 1 choked on his patrol, wakes, then patrols again
      cq.cancel(); g2.reset(); g1.reset(); until(() => g1.patrol.state === 'walking' && g1.moving, 600);
      choke(g1); motor.teleport(-19, 19, 0); g1.ko.left = 0.05; until(() => !g1.isDown(), 600);
      const b1 = g1.awareness; b1.cfg.evasionTime = 4; b1.evasion.end = b1.clock + 4; b1.cfg.heightenedTime = 4;
      const q1 = g1.position.clone(); out.g1back = until(() => b1.state === 'NORMAL' && g1.patrol.state !== 'interrupted' && g1.position.distanceTo(q1) > 1.5, 60 * 120) / 60;
      out.g1patrol = g1.patrol.state; b1.cfg.evasionTime = 30; b1.cfg.heightenedTime = 60;
      cq.cancel(); g1.reset(); g2.reset();
      return out;
    });
    const ok = r.indep.g1moved > 3 && !r.indep.g1Down && r.indep.g1ko === 'CONSCIOUS' && Math.abs(r.indep.left - (60 - r.indep.since)) < 0.05 && r.indep.since > 10 && Math.abs(r.wakeAt - 60) < 0.2 && r.phases === 'stirring>sittingUp>rising'
      && r.stand < 0.01 && r.state === 'EVASION' && /attacked/.test(r.note) && r.seenAt < 0.01 && r.seenHer > 5 && r.travel === null && r.home > 0 && r.home < 90 && r.atPost
      && r.g1back > 0 && r.g1back < 120 && r.g1patrol !== 'interrupted' && page.errors.length === 0;
    return { pass: ok, detail: `while Guard 2 is out: Guard 1 patrolled ${r.indep.g1moved.toFixed(1)} m, ${r.indep.g1ko} / ${r.indep.g1aware}; Guard 2's timer ${r.indep.left.toFixed(2)} s left ${r.indep.since.toFixed(2)} s after he went down; waking ${r.wakeAt.toFixed(2)} s after he was laid down: ${r.phases}, standing ${(r.stand * 100).toFixed(1)} cm from where he lay; awake: ${r.state} ("${r.note}"), memory of her ${r.seenAt.toFixed(2)} m from where she choked him and ${r.seenHer.toFixed(1)} m from where she is now, heading ${r.travel === null ? 'none' : 'KNOWN'}; walked home in ${r.home.toFixed(1)} s (at post ${r.atPost}); Guard 1 choked on his patrol was patrolling again ${r.g1back.toFixed(1)} s after waking (${r.g1patrol})` };
  },

  // Step 15, 1–3, 20–22 with real iPhone touches (frame loop running). CHOKE is hidden until
  // she holds a guard; then CHOKE, THROW and RELEASE all show on the right, ≥ 56 px, not
  // overlapping each other or CROUCH. Holding CHOKE (a real touch, the stick pushed at the
  // same time) fills its ring and locks RELEASE and THROW; the pair doesn't move. Lifting the
  // finger: back to GRAPPLING, ring gone. A cancelled touch also lets go (nothing stuck).
  // Held to the end: he's out, the buttons go, and the stick moves her (≥ 0.3 m in 1.5 s). RESET mid-choke and
  // RESET after the choke both restore both guards, standing and conscious at their posts
  async chokeTouch() {
    const page = await touchPage(), Tc = page.touch;
    const box = async sel => page.locator(sel).boundingBox();
    const tapAt = async b => { const down = Tc('touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 }]); await page.waitForTimeout(80); const up = Tc('touchEnd', []); await down; await up; await page.waitForTimeout(120); };
    const behind = async () => { await page.evaluate(() => { const g = MV.guard2; const b = g.position.clone().addScaledVector(g.forward(), -1.0); MV.motor.teleport(b.x, b.z, g.yaw); MV.cam.snap(MV.motor); }); await page.waitForTimeout(250); };
    const grab = async () => { await tapAt(await box('#mv-cqc')); await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(300); };
    const ui = () => page.evaluate(() => { const q = id => document.getElementById(id); return { cqc: MV.cqc.state, p: MV.cqc.ch ? MV.cqc.ch.p : 0, choke: !q('mv-choke').hidden, ring: getComputedStyle(q('mv-choke').querySelector('.mv-ring')).visibility === 'visible',
      locked: q('mv-throw').classList.contains('locked') && q('mv-cqc').classList.contains('locked'), throw: !q('mv-throw').hidden, ko: MV.guard2.ko.state, held: !!MV.guard2.restraint, pos: [MV.motor.position.x, MV.motor.position.z],
      since: MV.cqc.ch ? Math.hypot(MV.motor.position.x - MV.cqc.ch.at.x, MV.motor.position.z - MV.cqc.ch.at.z) : 0 }; });
    await page.evaluate(() => { MV.guard2.reset(); document.getElementById('mv-stats').hidden = false; });
    const free = await ui();
    await behind(); await grab();
    const shown = await ui();
    const bx = { ch: await box('#mv-choke'), th: await box('#mv-throw'), cq: await box('#mv-cqc'), cr: await box('#mv-crouch') }, vw = page.viewportSize().width;
    const over = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    const layout = { overlap: over(bx.ch, bx.th) || over(bx.ch, bx.cq) || over(bx.ch, bx.cr) || over(bx.th, bx.cq), right: [bx.ch, bx.th, bx.cq].every(b => b.x > vw * 0.45), size: Math.min(bx.ch.width, bx.th.width, bx.cq.width) };
    const C = { x: bx.ch.x + bx.ch.width / 2, y: bx.ch.y + bx.ch.height / 2 };
    // hold CHOKE with the stick pushed, ~1 s, then lift
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 150, y: 350, id: 1 }]);
    await Tc('touchStart', [{ x: 150, y: 350, id: 1 }, { x: C.x, y: C.y, id: 9 }]);
    await page.waitForFunction(() => MV.cqc.ch && MV.cqc.ch.p > 0.3, null, { timeout: 15000, polling: 'raf' }).catch(() => {});
    const holding = await ui();
    await Tc('touchEnd', [{ x: C.x, y: C.y, id: 9 }]);   // (touchEnd lists the fingers lifted: the CHOKE finger; the stick stays down)
    await page.waitForFunction(() => MV.cqc.state !== 'CHOKING', null, { timeout: 3000, polling: 'raf' }).catch(() => {}); await page.waitForTimeout(100);   // (the next frame acts on it)
    const lifted = await ui(); await Tc('touchEnd', [{ x: 150, y: 350, id: 1 }]); await page.waitForTimeout(100);
    // a cancelled touch
    await Tc('touchStart', [{ x: C.x, y: C.y, id: 10 }]); await page.waitForFunction(() => MV.cqc.state === 'CHOKING', null, { timeout: 5000 }).catch(() => {});
    await Tc('touchCancel', []); await page.waitForFunction(() => MV.cqc.state !== 'CHOKING', null, { timeout: 3000, polling: 'raf' }).catch(() => {}); await page.waitForTimeout(100);
    const cancelled = await ui();
    // held to the end
    await Tc('touchStart', [{ x: C.x, y: C.y, id: 11 }]);
    await page.waitForFunction(() => MV.guard2.isDown() && MV.cqc.state === 'FREE', null, { timeout: 30000, polling: 'raf' }).catch(() => {});
    await Tc('touchEnd', []); await page.waitForTimeout(200);
    const done = await ui();
    // (back toward the camera: away from his body, which is solid in front of her)
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 150, y: 350, id: 1 }]);
    { const t0 = await page.evaluate(() => MV.guard.awareness.clock); await page.waitForFunction(t0 => MV.guard.awareness.clock >= t0 + 1.5, t0, { timeout: 20000, polling: 'raf' }); } await Tc('touchEnd', []);   // 1.5 s of game time
    const walked = await ui();
    const stat = await page.evaluate(() => document.getElementById('mv-chokestat').textContent + ' | ' + document.getElementById('mv-g2').textContent);
    // RESET after the choke
    await page.tap('#mv-reset'); await page.waitForTimeout(300);
    const state = () => page.evaluate(() => ({ cqc: MV.cqc.state, hidden: document.getElementById('mv-choke').hidden, g: MV.guards.map(g => ({ ko: g.ko.state, aware: g.awareness.state, post: Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z), restrained: !!g.restraint, hook: !!g.poseHook })) }));
    const resetAfter = await state();
    // RESET mid-choke
    await behind(); await grab();
    await Tc('touchStart', [{ x: C.x, y: C.y, id: 12 }]); await page.waitForFunction(() => MV.cqc.ch && MV.cqc.ch.p > 0.2, null, { timeout: 15000, polling: 'raf' }).catch(() => {});
    const mid = await ui();
    await page.tap('#mv-reset'); await Tc('touchEnd', []); await page.waitForTimeout(300);
    const resetMid = await state();
    const clean = s => s.cqc === 'FREE' && s.hidden && s.g.every(g => g.ko === 'CONSCIOUS' && g.aware === 'NORMAL' && g.post < 0.01 && !g.restrained && !g.hook);
    const ok = !free.choke && shown.choke && shown.throw && shown.cqc === 'GRAPPLING' && !layout.overlap && layout.right && layout.size >= 56
      && holding.cqc === 'CHOKING' && holding.ring && holding.locked && holding.since < 0.005
      && lifted.cqc === 'GRAPPLING' && !lifted.ring && !lifted.locked && lifted.ko === 'CONSCIOUS' && lifted.held
      && cancelled.cqc === 'GRAPPLING' && cancelled.ko === 'CONSCIOUS' && cancelled.held
      && done.ko === 'UNCONSCIOUS' && done.cqc === 'FREE' && !done.choke && !done.throw && Math.hypot(walked.pos[0] - done.pos[0], walked.pos[1] - done.pos[1]) > 0.3
      && clean(resetAfter) && mid.cqc === 'CHOKING' && clean(resetMid) && page.errors.length === 0;
    return { pass: ok, detail: `free: CHOKE shown ${free.choke}; holding him: CHOKE ${shown.choke}, THROW ${shown.throw}, ${shown.cqc}, overlap ${layout.overlap}, right side ${layout.right}, smallest ${layout.size.toFixed(0)} px; CHOKE held with the stick pushed: ${holding.cqc} ${Math.round(holding.p * 100)}%, ring ${holding.ring}, RELEASE/THROW locked ${holding.locked}, she moved ${(holding.since * 100).toFixed(1)} cm since the choke began; finger lifted: ${lifted.cqc}, ring ${lifted.ring}, he's ${lifted.ko}; touch cancelled: ${cancelled.cqc}, ${cancelled.ko}; held to the end: ${done.ko}, ${done.cqc}, buttons hidden ${!done.choke && !done.throw}, then she walked ${Math.hypot(walked.pos[0] - done.pos[0], walked.pos[1] - done.pos[1]).toFixed(2)} m; stats "${stat}"; RESET after: ${resetAfter.cqc}, ${resetAfter.g.map(g => g.ko + '/' + g.aware + ' ' + g.post.toFixed(2) + ' m').join(', ')}; RESET mid-choke (${mid.cqc} ${Math.round(mid.p * 100)}%): ${resetMid.cqc}, ${resetMid.g.map(g => g.ko + '/' + g.aware + ' ' + g.post.toFixed(2) + ' m').join(', ')}; page errors ${page.errors.length}` };
  },

  // Step 16, 2, 6–10, 13–16, 18: HOLD CQC (as the input reports it) by Guard 2 from behind,
  // the side and the front (unaware, never startled), by Guard 1 walking his patrol, and by
  // Guard 2 fully ALERT and facing her. Each: acquire > off-balance > throw > impact >
  // recover in 0.9–1.3 s, never the restraint (no GRAPPLING frame, no grab counted); she steps
  // in ≤ 35 cm (half the gap, as a grab does) and they stay together (his hips ≤ 1.3 m from her, his head ≤ 20 cm a frame);
  // skin never below the ground and lying on it; he lands 0.55 m from where she seized him,
  // clear of walls and crates; UNCONSCIOUS; one "body impact" (level 3) right where he lies;
  // then she's FREE and walking within a second
  async takedownSequence() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input, world } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget, A = MV.SCmv.ThrowAnim;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) motor.update(dt, dx || 0, dz || 0, mag || 0); MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = n => { for (let i = 0; i < n; i++) frame(); }, until = (fn, max) => { let n = 0; while (!fn() && n < max) { frame(); n++; } return n; };
      const place = (g, rel, d) => { const y = g.yaw + rel, p = g.position.clone().add(new THREE.Vector3(Math.sin(y) * d, 0, Math.cos(y) * d)); motor.teleport(p.x, p.z, Math.atan2(g.position.x - p.x, g.position.z - p.z)); for (let k = 0; k < 2; k++) step(0, 'stand'); };
      const W = b => b.getWorldPosition(new THREE.Vector3());
      const boxDist = (x, z) => { let m = Infinity; for (const b of world.boxes) m = Math.min(m, Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ))); return m; };
      const events = []; noise.on(ev => { if (ev.source !== 'player') events.push({ type: ev.type, level: ev.level, p: ev.position.clone() }); });
      const fresh = () => { cq.cancel(); g1.patrol.enabled = false; g1.reset(); g2.reset(); motor.teleport(-19, 19, 0); sim(10); };
      const run = (g, setup) => {
        setup(); const before = g.awareness.state, startled = g.awareness.isStartled(), chk = cq.takedownCheck(), P = motor.position.clone(), grabs0 = cq.grabs;
        events.length = 0; input.cqcHeld = true;
        const states = []; let n = 0, herJump = 0, headJump = 0, apart = 0, minSkin = Infinity, grappled = 0, lp = motor.position.clone(), lh = W(g.head), seizedAt = null;
        while (n < 200) { frame(); n++; const s = cq.quick ? 'acquire' : cq.state === 'THROWING' ? cq.thr.phase : cq.state; if (states[states.length - 1] !== s) states.push(s); if (cq.state === 'GRAPPLING') grappled++;
          if (cq.state === 'THROWING' && !seizedAt) seizedAt = g.position.clone();
          herJump = Math.max(herJump, motor.position.distanceTo(lp)); lp.copy(motor.position); const h = W(g.head); headJump = Math.max(headJump, h.distanceTo(lh)); lh.copy(h);
          apart = Math.max(apart, Math.hypot(W(g.bones.hips).x - motor.position.x, W(g.bones.hips).z - motor.position.z)); if (g.isDown()) minSkin = Math.min(minSkin, A.lowest(g)); if (cq.state === 'FREE') break; }
        const b = g.ko.body; let clear = Infinity; if (b) for (let s = -0.95; s <= 0.9; s += 0.05) clear = Math.min(clear, boxDist(b.position.x + b.along.x * s, b.position.z + b.along.z * s));
        const out = { before, startled, ok: chk.ok, states: states.filter(s => s !== 'initiate').join('>'), time: n / 60, step: motor.position.distanceTo(P), herJump, headJump, apart, minSkin, lying: A.lowest(g), grappled, grabs: cq.grabs - grabs0,
          out: b && seizedAt ? Math.hypot(b.position.x - seizedAt.x, b.position.z - seizedAt.z) : 99, clear, ko: g.ko.state, events: events.map(e => `${e.type} L${e.level} ${b ? Math.hypot(e.p.x - b.position.x, e.p.z - b.position.z).toFixed(2) : '?'}`), last: cq.lastTakedown };
        let spd = 0; const f = motor.yaw + Math.PI; for (let i = 0; i < 60; i++) { frame(Math.sin(f), Math.cos(f), 0.78); spd = Math.max(spd, motor.speed); } out.spd = spd;
        return out;
      };
      const res = {};
      for (const [k, rel] of [['G2 behind', Math.PI], ['G2 side', Math.PI / 2], ['G2 front', 0]]) { fresh(); res[k] = run(g2, () => place(g2, rel, 1.0)); }
      fresh(); g1.patrol.enabled = true; g1.reset(); until(() => g1.patrol.state === 'walking' && g1.moving, 600); res['G1 walking'] = run(g1, () => place(g1, Math.PI, 1.0));
      fresh(); res['G2 ALERT, facing her'] = run(g2, () => { place(g2, 0, 1.2); until(() => g2.awareness.state === 'ALERT', 300); sim(150); });
      cq.cancel(); g1.reset(); g2.reset();
      return res;
    });
    const rows = Object.entries(r);
    const good = x => x.ok && x.states === 'acquire>offBalance>throw>impact>recover>FREE' && x.time >= 0.9 && x.time <= 1.3 && x.grappled === 0 && x.grabs === 0 && x.step <= 0.35 && x.herJump < 0.06 && x.headJump < 0.2 && x.apart < 1.3
      && x.minSkin > -0.01 && x.lying < 0.02 && Math.abs(x.out - 0.55) < 0.01 && x.clear > 0.1 && x.ko === 'UNCONSCIOUS' && x.events.length === 1 && /^body impact L3 0\.00$/.test(x.events[0]) && /completed/.test(x.last) && x.spd > 0.9;
    const ok = rows.every(([, x]) => good(x)) && !r['G2 behind'].startled && r['G2 behind'].before === 'NORMAL' && r['G2 ALERT, facing her'].before === 'ALERT' && !r['G2 ALERT, facing her'].startled && page.errors.length === 0;
    return { pass: ok, detail: rows.map(([k, x]) => `${k} (${x.before}${x.startled ? ', startled' : ''}): ${x.states} in ${x.time.toFixed(2)} s, restraint frames ${x.grappled}, grabs ${x.grabs}, she stepped ${(x.step * 100).toFixed(0)} cm, his head ≤ ${(x.headJump * 100).toFixed(0)} cm a frame, hips ≤ ${x.apart.toFixed(2)} m from her, skin ≥ ${(x.minSkin * 100).toFixed(1)} cm, lying ${(x.lying * 100).toFixed(1)} cm, landed ${x.out.toFixed(2)} m out, ${x.clear.toFixed(2)} m clear, ${x.ko}, sound ${x.events.join(' / ')}, then she walks at ${x.spd.toFixed(2)} m/s`).join('; ') + `; page errors ${page.errors.length}` };
  },

  // Step 16, 11–12, 16–17, 22, 25–27: when it doesn't happen, and everything around it. HOLD
  // with nobody in reach (1.7 m), through the corridor wall, at a guard who's down, or where
  // he'd have no room to land: nothing starts, nobody is grabbed, and lastTakedown says why.
  // Two guards in reach: the nearer is taken down. Further HOLDs, taps, THROW and CHOKE during
  // a takedown change nothing (one takedown, one impact). Guard 1 8 m away with his back
  // turned hears the impact (normal hearing) and reacts about the landing spot, not where
  // she goes. RESET mid-takedown leaves both guards standing at their posts. Afterwards TAP
  // still grabs, the pull works, and THROW, CHOKE and RELEASE all still work
  async takedownRules() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) step(0, 'stand'); else { MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); } noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = (n, dx, dz, mag) => { for (let i = 0; i < n; i++) frame(dx, dz, mag); };
      const place = (g, rel, d) => { const y = g.yaw + rel, p = g.position.clone().add(new THREE.Vector3(Math.sin(y) * d, 0, Math.cos(y) * d)); motor.teleport(p.x, p.z, Math.atan2(g.position.x - p.x, g.position.z - p.z)); for (let k = 0; k < 2; k++) step(0, 'stand'); };
      const fresh = () => { cq.cancel(); input._chokeKey = false; g1.patrol.enabled = false; g1.reset(); g2.reset(); motor.teleport(-19, 19, 0); sim(10); };
      const hold = () => { const g0 = cq.grabs, t0 = cq.takedowns; input.cqcHeld = true; frame(); return { state: cq.state, quick: cq.quick || !!(cq.thr && cq.thr.quick), grabbed: cq.grabs - g0, started: cq.takedowns - t0, why: cq.lastTakedown }; };
      const out = {};
      fresh(); place(g2, Math.PI, 1.7); out.far = hold();
      fresh(); g2.motor.teleport(16.6, -4, 0); g2.place(); motor.teleport(15.4, -4, Math.PI / 2); for (let k = 0; k < 2; k++) step(0, 'stand'); out.wall = hold();
      fresh(); for (const [gx, gz, yaw] of [[17.2, -4, 0], [17.2, -7, 0], [16.9, -2, Math.PI]]) { cq.cancel(); g2.reset(); g2.motor.teleport(gx, gz, yaw); g2.place(); motor.teleport(gx - Math.sin(yaw) * 1.0, gz - Math.cos(yaw) * 1.0, yaw); for (let k = 0; k < 2; k++) step(0, 'stand'); sim(2); if (!cq.check() && !cq.takedownCheck().ok) { out.room = hold(); break; } }
      // two in reach: the nearer
      fresh(); g1.motor.teleport(g2.post.x - 2.4, g2.post.z, Math.PI / 2); g1.place(); sim(2); motor.teleport(g1.position.x + 1.0, g1.position.z, -Math.PI / 2); for (let k = 0; k < 2; k++) step(0, 'stand');
      const two = cq.takedownCheck(); out.nearer = two.guard && two.guard.cfg.label;
      // during a takedown: more HOLDs, taps, THROW, CHOKE do nothing; one impact
      fresh(); place(g2, Math.PI, 1.0); const ev = []; const off = noise.on(e => { if (e.type === 'body impact') ev.push(e); });
      input.cqcHeld = true; frame(); const t0 = cq.takedowns, g0 = cq.grabs;
      for (let i = 0; i < 70; i++) { if (i % 7 === 0) { input.cqcHeld = true; input.cqcTapped = true; input.throwTapped = true; input._chokeKey = true; input.chokePresses++; } frame(); }
      input._chokeKey = false; sim(30); off();
      out.during = { takedowns: cq.takedowns - t0 + 1, grabs: cq.grabs - g0, impacts: ev.length, ko: g2.ko.state, cqc: cq.state, chokes: cq.chokes };
      // a guard who's down
      place(g2, Math.PI, 1.0); out.down = hold();
      // hearing: Guard 1 8 m from the landing, back turned
      fresh(); place(g2, Math.PI, 1.0); const chk = cq.takedownCheck();
      input.cqcHeld = true; frame(); const land0 = new THREE.Vector3(); sim(90); land0.copy(g2.ko.body.position);
      cq.cancel(); g2.reset(); g1.post.set(land0.x, 0, land0.z + 8.3); g1.postYaw = 0; g1.reset(); sim(5); place(g2, Math.PI, 1.0);
      input.cqcHeld = true; sim(90); const land = g2.ko.body.position.clone(); motor.teleport(-19, 19, 0); sim(120);
      out.hear = { heard: !!(g1.hearing.last && g1.hearing.last.heard && g1.hearing.last.type === 'body impact'), state: g1.awareness.state, focus: g1.awareness.heard ? Math.hypot(g1.awareness.heard.position.x - land.x, g1.awareness.heard.position.z - land.z) : 99, toHer: g1.awareness.heard ? Math.hypot(g1.awareness.heard.position.x - motor.position.x, g1.awareness.heard.position.z - motor.position.z) : 0, saw: g1.vision.meter };
      MV.guard.post.set(2, 0, -16); MV.guard.postYaw = 0;
      // RESET mid-takedown (as the RESET button does)
      fresh(); place(g2, Math.PI, 1.0); input.cqcHeld = true; sim(30); const midPhase = cq.thr ? cq.thr.phase : cq.state;
      cq.cancel(); g1.reset(); g2.reset(); sim(5);
      out.reset = { mid: midPhase, cqc: cq.state, g: [g1, g2].map(g => ({ ko: g.ko.state, post: Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z), tilt: g.fall.quaternion.w, restrained: !!g.restraint })) };
      // afterwards: TAP grabs, the pull, THROW, CHOKE, RELEASE
      place(g2, Math.PI, 1.0); const ga = cq.grabs; input.cqcTapped = true; sim(40); const tapState = cq.state, tapGrab = cq.grabs - ga;
      const c0 = motor.position.clone(), f = motor.yaw + Math.PI; sim(60, Math.sin(f), Math.cos(f), 1); const pulled = motor.position.distanceTo(c0);
      input.cqcTapped = true; sim(40); const rel = cq.state;
      fresh(); place(g2, Math.PI, 1.0); input.cqcTapped = true; sim(40); input.throwTapped = true; sim(2); const thr = cq.state + (cq.thr && cq.thr.quick ? ' (quick)' : ''); sim(100); const thrKo = g2.ko.state;
      fresh(); place(g2, Math.PI, 1.0); input.cqcTapped = true; sim(40); input._chokeKey = true; input.chokePresses++; sim(5); const ch = cq.state; sim(300); input._chokeKey = false; const chKo = g2.ko.state;
      out.after = { tapState, tapGrab, pulled, rel, thr, thrKo, ch, chKo };
      cq.cancel(); g1.reset(); g2.reset();
      return out;
    });
    const none = x => x && x.state === 'FREE' && !x.quick && x.grabbed === 0 && x.started === 0;
    const ok = none(r.far) && /out of reach/.test(r.far.why) && none(r.wall) && /solid/.test(r.wall.why) && none(r.room) && /no room for a takedown/.test(r.room.why) && none(r.down) && /down/.test(r.down.why)
      && r.nearer === 'Guard 1 — Patrol' && r.during.takedowns === 1 && r.during.grabs === 0 && r.during.impacts === 1 && r.during.ko === 'UNCONSCIOUS' && r.during.cqc === 'FREE' && r.during.chokes === 0
      && r.hear.heard && /SUSPICIOUS|INVESTIGATING/.test(r.hear.state) && r.hear.focus < 1.5 && r.hear.toHer > 5 && r.hear.saw === 0
      && r.reset.cqc === 'FREE' && r.reset.g.every(g => g.ko === 'CONSCIOUS' && g.post < 0.01 && Math.abs(g.tilt) > 0.9999 && !g.restrained)
      && r.after.tapState === 'GRAPPLING' && r.after.tapGrab === 1 && r.after.pulled > 0.4 && r.after.rel === 'FREE' && r.after.thr === 'THROWING' && r.after.thrKo === 'UNCONSCIOUS' && r.after.ch === 'CHOKING' && r.after.chKo === 'UNCONSCIOUS' && page.errors.length === 0;
    const d = x => x ? `${x.state}, grabbed ${x.grabbed}, "${x.why}"` : 'no spot found';
    return { pass: ok, detail: `HOLD 1.7 m away: ${d(r.far)}; through the corridor wall: ${d(r.wall)}; no room to land: ${d(r.room)}; at a guard who's down: ${d(r.down)}; two in reach → ${r.nearer}; during a takedown (HOLD/TAP/THROW/CHOKE pressed every 7 frames): takedowns ${r.during.takedowns}, grabs ${r.during.grabs}, impacts ${r.during.impacts}, chokes ${r.during.chokes}, he's ${r.during.ko}; Guard 1 8 m off, back turned: heard ${r.hear.heard}, ${r.hear.state}, about ${r.hear.focus.toFixed(2)} m from the landing, ${r.hear.toHer.toFixed(1)} m from her, saw ${Math.round(r.hear.saw * 100)}%; RESET mid-takedown (${r.reset.mid}): ${r.reset.cqc}, ${r.reset.g.map(g => g.ko + ' ' + g.post.toFixed(2) + ' m').join(', ')}; afterwards TAP: ${r.after.tapState} (grabs ${r.after.tapGrab}), pulled ${r.after.pulled.toFixed(2)} m, RELEASE: ${r.after.rel}, THROW: ${r.after.thr} → ${r.after.thrKo}, CHOKE: ${r.after.ch} → ${r.after.chKo}` };
  },

  // Step 16, 1, 3–4, 21–22: TAP vs HOLD in the input layer, driven with event times. Free
  // presses: let go at 0.10 / 0.34 s → TAP; held to 0.36 s before any frame saw it → HOLD
  // (on release); polled at 0.2 s nothing, on the first frame past 0.35 s nothing yet (a
  // finger-up may still be on its way), on the next HOLD (once), then letting go adds no TAP.
  // A slow frame: let go at 0.1 s, the frame only comes at 0.6 s → still a TAP. Presses that
  // begin while she holds a guard keep the old rule (TAP up to 0.45 s, then nothing, never a
  // takedown). A cancelled touch and a lost focus do nothing. A second finger on the button
  // changes nothing. Through CQC: a held press takes him down and its release grabs nobody
  async tapHold() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input: I } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget;
      const frame = () => { const held = cq.update(dt, 0, 0, 0); if (!held) step(0, 'stand'); noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const take = () => { const o = { tap: I.cqcTapped, hold: I.cqcHeld, last: I.cqcLast }; I.cqcTapped = false; I.cqcHeld = false; return o; };
      const press = (t, free) => { I.cqcHoldAllowed = free !== false; I._cqcPress(t); };
      const out = {};
      press(1000); I._cqcUp(1100); out.t010 = take();
      press(2000); I._cqcUp(2340); out.t034 = take();
      press(3000); I._cqcUp(3360); out.t036 = take();
      press(4000); out.p02 = I.pollCqcHold(4200); out.p04a = I.pollCqcHold(4383); out.p04 = I.pollCqcHold(4400); out.p05 = I.pollCqcHold(4500); const mid = take(); I._cqcUp(4800); out.polled = { fired: out.p04, again: out.p05, mid, after: take() };
      press(5000); I._cqcUp(5100); out.slow = { poll: I.pollCqcHold(5600), took: take() };
      press(6000, false); I._cqcUp(6400); out.ctx040 = take(); press(7000, false); I.pollCqcHold(7550); out.ctxPoll = I.pollCqcHold(7600); I._cqcUp(7700); out.ctx070 = take();
      press(8000); I._cqcDrop(); I.pollCqcHold(8550); out.cancel = Object.assign(take(), { poll: I.pollCqcHold(8600) });
      press(9000); I.clear(); I.pollCqcHold(9550); out.blur = Object.assign(take(), { poll: I.pollCqcHold(9600) });
      // a second finger: _ts ignores a new press while one is down (simulated as it would)
      press(10000); const d0 = I._cqcDown; if (I._cqcDown == null) I._cqcPress(10200); out.second = I._cqcDown === d0; I._cqcUp(10100); out.secondTake = take();
      // through CQC: a real held press by Guard 2
      g2.reset(); const b = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b.x, b.z, g2.yaw); for (let k = 0; k < 2; k++) step(0, 'stand'); frame();
      const g0 = cq.grabs; I._cqcPress(performance.now() - 400); frame(); frame(); const after = cq.state; /* fires on the second frame past the threshold */ for (let i = 0; i < 20; i++) frame(); I._cqcUp(performance.now()); for (let i = 0; i < 80; i++) frame();
      out.live = { first: after, grabs: cq.grabs - g0, ko: g2.ko.state, state: cq.state + (cq.thr ? ":" + cq.thr.phase + ":" + cq.thr.t.toFixed(2) : ""), takedowns: cq.takedowns, last: cq.lastTakedown };
      cq.cancel(); g2.reset();
      return out;
    });
    const T = x => x.tap && !x.hold, H = x => !x.tap && x.hold, N = x => !x.tap && !x.hold;
    const ok = T(r.t010) && T(r.t034) && H(r.t036) && r.p02 === false && r.p04a === false && r.polled.fired === true && r.polled.again === false && H(r.polled.mid) && N(r.polled.after)
      && r.slow.poll === false && T(r.slow.took) && T(r.ctx040) && r.ctxPoll === false && H(r.ctx070) && N(r.cancel) && r.cancel.poll === false && r.cancel.last === 'CANCELLED' && N(r.blur) && r.blur.poll === false
      && r.second && T(r.secondTake) && (r.live.first === 'GRABBING' || r.live.first === 'THROWING') && r.live.grabs === 0 && r.live.ko === 'UNCONSCIOUS' && r.live.state === 'FREE' && page.errors.length === 0;
    const s = x => x.tap ? 'TAP' : x.hold ? 'HOLD' : 'nothing';
    return { pass: ok, detail: `free press let go at 0.10 s: ${s(r.t010)}, 0.34 s: ${s(r.t034)}, 0.36 s (no frame in between): ${s(r.t036)}; polled at 0.2 s: ${r.p02}, first frame past 0.35 s: ${r.p04a}, the next: ${r.polled.fired} (${s(r.polled.mid)}), 0.5 s: ${r.polled.again}, then let go: ${s(r.polled.after)}; let go at 0.1 s but the frame only at 0.6 s: ${s(r.slow.took)}; pressed while holding a guard, 0.4 s: ${s(r.ctx040)}, polled at 0.6 s: ${r.ctxPoll}, 0.7 s: ${s(r.ctx070)}; cancelled: ${s(r.cancel)} (${r.cancel.last}); focus lost: ${s(r.blur)}; second finger ignored ${r.second}; a live 0.4 s hold by Guard 2: ${r.live.first} → he's ${r.live.ko} ("${r.live.last}", ${r.live.state}), grabs on release ${r.live.grabs}` };
  },

  // Step 16, 1–5, 19–23 with real iPhone touches (frame loop running): by Guard 2, a quick
  // tap grabs him (no takedown) and RELEASE lets him go. Holding CQC (a real 0.6 s press)
  // fills the button's ring and takes him down: no restraint frame on the way, no grab, he's
  // UNCONSCIOUS, and she walks again. A press cancelled at 0.15 s does nothing. A hold with
  // nobody near grabs nobody when let go. RESET during a hold, and RESET mid-takedown, leave
  // everything clean (both guards conscious at their posts, CQC free)
  async takedownTouch() {
    const page = await touchPage(), Tc = page.touch;
    const box = async sel => page.locator(sel).boundingBox();
    const press = async (ms, id) => { const b = await box('#mv-cqc'); const down = Tc('touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: id || 7 }]); await page.waitForTimeout(ms); const up = Tc('touchEnd', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: id || 7 }]); await down; await up; };
    const behind = async () => { await page.evaluate(() => { const g = MV.guard2; const b = g.position.clone().addScaledVector(g.forward(), -1.0); MV.motor.teleport(b.x, b.z, g.yaw); MV.cam.snap(MV.motor); }); await page.waitForTimeout(250); };
    await page.evaluate(() => { MV.guard2.reset(); document.getElementById('mv-stats').hidden = false; window.__seen = new Set(); window.__charge = false;
      (function f() { window.__seen.add(MV.cqc.state + (MV.cqc.thr && MV.cqc.thr.quick ? ':quick' : '')); if (document.getElementById('mv-cqc').classList.contains('charging')) window.__charge = true; requestAnimationFrame(f); })(); });
    const snap = () => page.evaluate(() => ({ cqc: MV.cqc.state, grabs: MV.cqc.grabs, takedowns: MV.cqc.takedowns, ko: MV.guard2.ko.state, held: !!MV.guard2.restraint, last: MV.cqc.lastTakedown, input: MV.input.cqcLast, pos: [MV.motor.position.x, MV.motor.position.z] }));
    // TAP: grab, then RELEASE
    await behind(); await press(80); await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(200);
    const tap = await snap();
    await press(80); await page.waitForFunction(() => MV.cqc.state === 'FREE', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(200);
    const rel = await snap();
    // HOLD: quick takedown
    await page.evaluate(() => MV.guard2.reset()); await behind(); await page.evaluate(() => { window.__seen.clear(); window.__charge = false; });
    const g0 = (await snap()).grabs;
    await press(600); await page.waitForFunction(() => MV.guard2.isDown() && MV.cqc.state === 'FREE', null, { timeout: 10000, polling: 'raf' }).catch(() => {});
    const hold = Object.assign(await snap(), await page.evaluate(() => ({ seen: [...window.__seen], charge: window.__charge })));
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 150, y: 350, id: 1 }]);
    { const t0 = await page.evaluate(() => MV.guard.awareness.clock); await page.waitForFunction(t0 => MV.guard.awareness.clock >= t0 + 1.5, t0, { timeout: 20000, polling: 'raf' }); } await Tc('touchEnd', []);
    const walked = await snap();
    // a cancelled press
    await page.tap('#mv-reset'); await page.waitForTimeout(300); await behind();
    { const b = await box('#mv-cqc'); const down = Tc('touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 }]); await page.waitForTimeout(150); const c = Tc('touchCancel', []); await down; await c; await page.waitForTimeout(600); }   // (cancelled 0.15 s in, by the clock, not after the page acknowledges the press)
    const cancelled = await snap();
    // HOLD with nobody near: no grab on release
    await page.evaluate(() => { MV.motor.teleport(-19, 19, 0); MV.cam.snap(MV.motor); }); await page.waitForTimeout(200);
    const g1 = (await snap()).grabs; await press(600); await page.waitForTimeout(400);
    const nobody = await snap();
    // RESET during a hold (the press goes on through it), and mid-takedown
    await behind();
    { const b = await box('#mv-cqc'); const down = Tc('touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 }]); await page.waitForTimeout(120); await down; await page.tap('#mv-reset'); await Tc('touchEnd', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 }]); await page.waitForTimeout(600); }
    const state = () => page.evaluate(() => ({ cqc: MV.cqc.state, g: MV.guards.map(g => ({ ko: g.ko.state, post: Math.hypot(g.position.x - g.post.x, g.position.z - g.post.z), restrained: !!g.restraint })) }));
    const resetHold = await state();
    // (RESET is pressed from the page the moment the throw phase begins: the whole takedown is ~1 s)
    await page.evaluate(() => { MV.guard2.reset(); window.__mid = null; (function f() { if (MV.cqc.thr && MV.cqc.thr.quick && MV.cqc.thr.phase === 'throw') { window.__mid = MV.cqc.thr.phase; document.getElementById('mv-reset').click(); return; } requestAnimationFrame(f); })(); }); await behind();
    { const b = await box('#mv-cqc'); const down = Tc('touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 }]); await page.waitForFunction(() => window.__mid, null, { timeout: 8000, polling: 'raf' }).catch(() => {}); await down; await Tc('touchEnd', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 }]); }
    const midPhase = await page.evaluate(() => window.__mid || 'FREE'); await page.waitForTimeout(300);
    const resetMid = await state();
    const clean = s => s.cqc === 'FREE' && s.g.every(g => g.ko === 'CONSCIOUS' && g.post < 0.01 && !g.restrained);
    const ok = tap.cqc === 'GRAPPLING' && tap.held && tap.takedowns === 0 && rel.cqc === 'FREE' && rel.ko === 'CONSCIOUS'
      && hold.ko === 'UNCONSCIOUS' && hold.cqc === 'FREE' && hold.grabs === g0 && hold.takedowns === 1 && hold.charge && !hold.seen.includes('GRAPPLING') && hold.seen.includes('THROWING:quick')
      && Math.hypot(walked.pos[0] - hold.pos[0], walked.pos[1] - hold.pos[1]) > 0.3
      && cancelled.cqc === 'FREE' && cancelled.ko === 'CONSCIOUS' && !cancelled.held && cancelled.input === 'CANCELLED'
      && nobody.cqc === 'FREE' && nobody.grabs === g1 && /failed/.test(nobody.last) && clean(resetHold) && midPhase !== 'FREE' && clean(resetMid) && page.errors.length === 0;
    return { pass: ok, detail: `0.08 s tap by Guard 2: ${tap.cqc} (takedowns ${tap.takedowns}); RELEASE: ${rel.cqc}, he's ${rel.ko}; 0.6 s hold: ring filled ${hold.charge}, states ${hold.seen.join(' > ')}, grabs +${hold.grabs - g0}, takedowns ${hold.takedowns}, he's ${hold.ko}, then she walked ${Math.hypot(walked.pos[0] - hold.pos[0], walked.pos[1] - hold.pos[1]).toFixed(2)} m; press cancelled at 0.15 s: ${cancelled.cqc}, he's ${cancelled.ko} (${cancelled.input}); 0.6 s hold with nobody near: ${nobody.cqc}, grabs +${nobody.grabs - g1}, "${nobody.last}"; RESET during a hold: ${resetHold.cqc}, ${resetHold.g.map(g => g.ko + ' ' + g.post.toFixed(2) + ' m').join(', ')}; RESET mid-takedown (${midPhase}): ${resetMid.cqc}, ${resetMid.g.map(g => g.ko + ' ' + g.post.toFixed(2) + ' m').join(', ')}; page errors ${page.errors.length}` };
  },

  // Step 17, 1–14: the standard break-free timer. Every grab starts the same 10 s countdown:
  // Guard 2 from behind (unaware), Guard 2 from the front fully ALERT, Guard 1 on patrol with
  // a different personality — all identical. It runs standing (3 s), pulling (2 s) and
  // turning (2 s) alike. Holding CHOKE pauses it; letting go puts it back to 10 s, again and
  // again, and the next choke still starts from 0. Left alone it runs out: he twists free
  // (no frame jump over 6 cm, nothing through walls), ends ≥ 1 m from her, unrestrained and
  // ALERT, remembering where she was; she walks again at once and can grab him straight away
  async breakFreeTimer() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input, world } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) motor.update(dt, dx || 0, dz || 0, mag || 0); MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = (n, dx, dz, mag) => { for (let i = 0; i < n; i++) frame(dx, dz, mag); }, until = (fn, max) => { let n = 0; while (!fn() && n < max) { frame(); n++; } return n; };
      const place = (g, rel, d) => { const y = g.yaw + rel, p = g.position.clone().add(new THREE.Vector3(Math.sin(y) * d, 0, Math.cos(y) * d)); motor.teleport(p.x, p.z, Math.atan2(g.position.x - p.x, g.position.z - p.z)); for (let k = 0; k < 2; k++) step(0, 'stand'); };
      const fresh = () => { cq.cancel(); input._chokeKey = false; g1.patrol.enabled = false; g1.reset(); g2.reset(); motor.teleport(-19, 19, 0); sim(10); };
      const grab = () => { input.cqcTapped = true; frame(); const at = cq.bf ? cq.bf.left : null; sim(40); return { full: cq.bf && cq.bf.full, start: at, state: cq.state }; };
      const out = { starts: {} };
      fresh(); place(g2, Math.PI, 1.0); out.starts['G2 unaware, behind'] = grab();
      fresh(); place(g2, 0, 1.2); until(() => g2.awareness.state === 'ALERT', 300); sim(150); out.starts['G2 ALERT, front'] = grab();
      fresh(); g1.personality = new MV.SCmv.GuardPersonality(g1, MV.area.profiles.C); g1.patrol.enabled = true; g1.reset(); until(() => g1.patrol.state === 'walking' && g1.moving, 600); place(g1, Math.PI, 1.0); out.starts['G1 patrolling, careless'] = grab();
      g1.personality = new MV.SCmv.GuardPersonality(g1, MV.area.profiles.B);
      // what runs it down
      fresh(); place(g2, Math.PI, 1.0); grab();
      let a = cq.bf.left; sim(180); out.still = a - cq.bf.left;
      a = cq.bf.left; const f = motor.yaw + Math.PI; sim(120, Math.sin(f), Math.cos(f), 1); out.pull = a - cq.bf.left;
      a = cq.bf.left; for (let i = 0; i < 120; i++) { const y = motor.yaw + Math.PI / 2; frame(Math.sin(y), Math.cos(y), 1); } out.turn = a - cq.bf.left;
      // CHOKE pauses, letting go resets (repeatedly), the choke itself starts again from 0
      a = cq.bf.left; input._chokeKey = true; input.chokePresses++; sim(60); out.choke = { before: a, during: cq.bf.left, p: cq.ch.p, state: cq.state };
      input._chokeKey = false; frame(); out.reset1 = { left: cq.bf.left, state: cq.state, ko: g2.ko.state };
      sim(300); const mid = cq.bf.left; input._chokeKey = true; input.chokePresses++; sim(12); const p2 = cq.ch.p; input._chokeKey = false; frame(); out.reset2 = { before: mid, left: cq.bf.left, p: p2 };
      // left alone: he breaks free
      const P0 = motor.position.clone(); let jump = 0, gJump = 0, lp = motor.position.clone(), lg = g2.position.clone(), worst = 0, saw = [];
      const intr = (p, R) => { let w = 0; for (const b of world.boxes) { const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX), dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ); w = Math.max(w, R - Math.hypot(dx, dz)); } return w; };
      const t0 = cq.bf.left; let n = 0;
      while (n < 900) { frame(); n++; if (saw[saw.length - 1] !== cq.state) saw.push(cq.state); jump = Math.max(jump, motor.position.distanceTo(lp)); gJump = Math.max(gJump, g2.position.distanceTo(lg)); lp.copy(motor.position); lg.copy(g2.position); worst = Math.max(worst, intr(g2.position, g2.cfg.radius), intr(motor.position, motor.cfg.radius)); if (cq.state === 'FREE') break; }
      const ga = g2.awareness;
      out.broke = { after: n / 60, t0, states: saw.join('>'), jump, gJump, worst, sep: Math.hypot(g2.position.x - motor.position.x, g2.position.z - motor.position.z), restrained: !!g2.restraint, aware: ga.state, note: ga.note,
        mem: ga.seen ? Math.hypot(ga.seen.position.x - motor.position.x, ga.seen.position.z - motor.position.z) : 99, bf: cq.bf, breaks: cq.breaks, stat: '' };
      sim(30); out.broke.aware2 = ga.state; out.broke.moves = g2.restraint == null;
      let spd = 0; const f2 = motor.yaw + Math.PI; for (let i = 0; i < 40; i++) { frame(Math.sin(f2), Math.cos(f2), 0.78); spd = Math.max(spd, motor.speed); } out.broke.spd = spd;
      place(g2, Math.PI, 1.0); out.regrab = grab();
      cq.cancel(); g1.reset(); g2.reset();
      return out;
    });
    const starts = Object.values(r.starts), b = r.broke;
    const ok = starts.every(s => s.full === 10 && s.state === 'GRAPPLING' && Math.abs(s.start - starts[0].start) < 1e-6) && starts[0].start > 9.9
      && Math.abs(r.still - 3) < 0.02 && Math.abs(r.pull - 2) < 0.02 && Math.abs(r.turn - 2) < 0.02
      && r.choke.state === 'CHOKING' && Math.abs(r.choke.during - r.choke.before) < 1e-6 && r.reset1.state === 'GRAPPLING' && r.reset1.ko === 'CONSCIOUS' && Math.abs(r.reset1.left - 10) < 0.02
      && r.reset2.before < 5.1 && Math.abs(r.reset2.left - 10) < 0.02 && r.reset2.p < 0.1
      && Math.abs(b.after - b.t0 - 0.5) < 0.05 && b.states === 'GRAPPLING>BREAKING>FREE' && b.jump < 0.06 && b.gJump < 0.06 && b.worst < 0.02 && b.sep > 1.0 && !b.restrained && b.aware === 'ALERT' && /broke free/.test(b.note) && b.mem < 0.3 && !b.bf && b.breaks === 1
      && b.spd > 0.9 && r.regrab.state === 'GRAPPLING' && r.regrab.full === 10 && page.errors.length === 0;
    return { pass: ok, detail: `starts: ${Object.entries(r.starts).map(([k, s]) => `${k} ${s.start.toFixed(2)}/${s.full} s`).join(', ')}; used by 3 s standing ${r.still.toFixed(2)} s, 2 s pulling ${r.pull.toFixed(2)} s, 2 s turning ${r.turn.toFixed(2)} s; CHOKE held 1 s: ${r.choke.before.toFixed(2)} → ${r.choke.during.toFixed(2)} s (paused), let go: ${r.reset1.state}, he's ${r.reset1.ko}, ${r.reset1.left.toFixed(2)} s; 5 s later ${r.reset2.before.toFixed(2)} s, a 0.2 s choke (from ${Math.round(r.reset2.p * 100)}%) → ${r.reset2.left.toFixed(2)} s; left alone: ${b.states} ${b.after.toFixed(2)} s later (${b.t0.toFixed(2)} s on the clock + the 0.5 s wrench), steps ≤ ${(b.jump * 100).toFixed(1)} / ${(b.gJump * 100).toFixed(1)} cm, overlap ${(Math.max(0, b.worst) * 100).toFixed(1)} cm, ${b.sep.toFixed(2)} m apart, restrained ${b.restrained}, he's ${b.aware} ("${b.note}"), remembers her ${b.mem.toFixed(2)} m from where she is, then she walks at ${b.spd.toFixed(2)} m/s; grabbed again at once: ${r.regrab.state} (${r.regrab.full} s)` };
  },

  // Step 17, 11, 15–17: the timer never cuts into a committed action. THROW started with 1 s
  // left, and a full CHOKE started with 2 s left, both finish (UNCONSCIOUS, no break-free).
  // RELEASE ends the countdown. The quick takedown never starts one. RESET mid-grapple
  // clears it all. Grapple pulling is unchanged by it (≥ 1.3 m in 1.5 s, spacing locked)
  async breakFreeActions() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input } = MV, [g1, g2] = MV.guards, cq = MV.cqc, dt = 1 / 60, T = MV.seeTarget;
      const frame = (dx, dz, mag) => { const held = cq.update(dt, dx || 0, dz || 0, mag || 0); if (!held) step(0, 'stand'); else { MV.visual.place(motor.position, motor.yaw); MV.animator.update(dt, motor); MV.posture.update(dt, motor, MV.animator); cq.poseArms(); MV.visual.root.updateMatrixWorld(true); } noise.update(dt); g1.update(dt, T); g2.update(dt, T); };
      const sim = (n, dx, dz, mag) => { for (let i = 0; i < n; i++) frame(dx, dz, mag); }, until = (fn, max) => { let n = 0; while (!fn() && n < max) { frame(); n++; } return n; };
      const setup = () => { cq.cancel(); input._chokeKey = false; g1.patrol.enabled = false; g1.reset(); g2.reset(); const b = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b.x, b.z, g2.yaw); for (let k = 0; k < 2; k++) step(0, 'stand'); sim(2); input.cqcTapped = true; sim(40); };
      const out = {};
      setup(); until(() => cq.bf.left <= 1, 900); input.throwTapped = true; frame(); const b0 = cq.breaks; until(() => cq.state === 'FREE', 300);
      out.throw = { ko: g2.ko.state, breaks: cq.breaks - b0, bf: cq.bf };
      setup(); until(() => cq.bf.left <= 2, 900); input._chokeKey = true; input.chokePresses++; const b1 = cq.breaks; until(() => cq.state === 'FREE', 600); input._chokeKey = false;
      out.choke = { ko: g2.ko.state, breaks: cq.breaks - b1, bf: cq.bf };
      setup(); sim(60); input.cqcTapped = true; frame(); out.release = { bf: cq.bf, state: cq.state }; sim(40); out.release.after = cq.state; sim(700); out.release.breaks = cq.breaks;
      cq.cancel(); g2.reset(); const b = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b.x, b.z, g2.yaw); for (let k = 0; k < 2; k++) step(0, 'stand'); sim(2);
      let anyBf = false; input.cqcHeld = true; for (let i = 0; i < 90; i++) { frame(); if (cq.bf) anyBf = true; } out.quick = { anyBf, ko: g2.ko.state };
      setup(); sim(30); const left = cq.bf.left; cq.cancel(); g1.reset(); g2.reset(); sim(5); out.reset = { left, bf: cq.bf, state: cq.state, restrained: !!g2.restraint };
      setup(); const c0 = motor.position.clone(), f = motor.yaw + Math.PI; let sep = 0; for (let i = 0; i < 90; i++) { frame(Math.sin(f), Math.cos(f), 1); sep = Math.max(sep, Math.abs(Math.hypot(g2.position.x - motor.position.x, g2.position.z - motor.position.z) - cq.cfg.holdOffset)); }
      out.pull = { moved: motor.position.distanceTo(c0), sep };
      cq.cancel(); g1.reset(); g2.reset();
      return out;
    });
    const ok = r.throw.ko === 'UNCONSCIOUS' && r.throw.breaks === 0 && !r.throw.bf && r.choke.ko === 'UNCONSCIOUS' && r.choke.breaks === 0 && !r.choke.bf
      && !r.release.bf && r.release.after === 'FREE' && r.release.breaks === 0 && !r.quick.anyBf && r.quick.ko === 'UNCONSCIOUS'
      && r.reset.left > 0 && !r.reset.bf && r.reset.state === 'FREE' && !r.reset.restrained && r.pull.moved > 1.3 && r.pull.sep < 0.01 && page.errors.length === 0;
    return { pass: ok, detail: `THROW with 1 s left: he's ${r.throw.ko}, break-frees ${r.throw.breaks}; full CHOKE from 2 s left: ${r.choke.ko}, break-frees ${r.choke.breaks}; RELEASE: countdown ${r.release.bf ? 'STILL ON' : 'gone'}, then ${r.release.after}, no break-free later (${r.release.breaks}); quick takedown: countdown ever ${r.quick.anyBf}, he's ${r.quick.ko}; RESET at ${r.reset.left.toFixed(1)} s left: ${r.reset.state}, countdown ${r.reset.bf ? 'STILL ON' : 'gone'}; pull: ${r.pull.moved.toFixed(2)} m, spacing ±${(r.pull.sep * 100).toFixed(1)} cm` };
  },

  // Step 17, 18 with real iPhone touches (frame loop running), the whole loop on Guard 2: TAP
  // grabs and the ring round RELEASE shows the countdown (the CQC stats line says "breaks
  // free in"); a real ~1 s CHOKE press, lifted, puts it back near 10 s; the ring goes urgent
  // under 3 s; then he breaks free: CQC FREE, the ring gone, he's ALERT and loose. Grab again,
  // RESET: everything cleared
  async breakFreeTouch() {
    const page = await touchPage(), Tc = page.touch;
    const box = async sel => page.locator(sel).boundingBox();
    const tap = async () => { const b = await box('#mv-cqc'); const down = Tc('touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 }]); await page.waitForTimeout(80); const up = Tc('touchEnd', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 }]); await down; await up; };
    const behind = async () => { await page.evaluate(() => { const g = MV.guard2; g.reset(); const b = g.position.clone().addScaledVector(g.forward(), -1.0); MV.motor.teleport(b.x, b.z, g.yaw); MV.cam.snap(MV.motor); }); await page.waitForTimeout(250); };
    const ui = () => page.evaluate(() => { const c = document.getElementById('mv-cqc'); return { cqc: MV.cqc.state, left: MV.cqc.bf ? MV.cqc.bf.left : null, timer: c.classList.contains('timer'), urgent: c.classList.contains('urgent'), ring: getComputedStyle(c.querySelector('.mv-ring')).visibility === 'visible', stat: document.getElementById('mv-cqcstat').textContent, aware: MV.guard2.awareness.state, held: !!MV.guard2.restraint, ko: MV.guard2.ko.state }; });
    await page.evaluate(() => { document.getElementById('mv-stats').hidden = false; });
    await behind(); await tap(); await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(400);
    const grabbed = await ui();
    await page.waitForFunction(() => MV.cqc.bf && MV.cqc.bf.left < 7, null, { timeout: 20000, polling: 'raf' }).catch(() => {});
    const before = await ui();
    const C = await box('#mv-choke'); const cx = C.x + C.width / 2, cy = C.y + C.height / 2;
    await Tc('touchStart', [{ x: cx, y: cy, id: 9 }]); await page.waitForFunction(() => MV.cqc.ch && MV.cqc.ch.p > 0.25, null, { timeout: 15000, polling: 'raf' }).catch(() => {});
    await Tc('touchEnd', [{ x: cx, y: cy, id: 9 }]); await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 3000, polling: 'raf' }).catch(() => {}); await page.waitForTimeout(100);
    const reset = await ui();
    await page.waitForFunction(() => MV.cqc.bf && MV.cqc.bf.left < 2.5, null, { timeout: 30000, polling: 'raf' }).catch(() => {});
    const urgent = await ui();
    await page.waitForFunction(() => MV.cqc.state === 'FREE', null, { timeout: 15000, polling: 'raf' }).catch(() => {}); await page.waitForTimeout(300);
    const broke = await ui();
    await behind(); await tap(); await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {});
    await page.tap('#mv-reset'); await page.waitForTimeout(300);
    const after = await ui();
    const ok = grabbed.cqc === 'GRAPPLING' && grabbed.timer && grabbed.ring && /breaks free in/.test(grabbed.stat) && grabbed.left > 9
      && before.left < 7 && reset.cqc === 'GRAPPLING' && reset.ko === 'CONSCIOUS' && reset.left > 9.5 && !reset.urgent && urgent.urgent && urgent.left < 3
      && broke.cqc === 'FREE' && !broke.timer && !broke.held && broke.aware === 'ALERT' && broke.left === null && after.cqc === 'FREE' && after.left === null && !after.timer && page.errors.length === 0;
    return { pass: ok, detail: `tapped: ${grabbed.cqc}, ring ${grabbed.ring} (${grabbed.left.toFixed(1)} s), stats "${grabbed.stat}"; at ${before.left.toFixed(1)} s a real CHOKE press, lifted: ${reset.cqc}, he's ${reset.ko}, back to ${reset.left.toFixed(1)} s; at ${urgent.left.toFixed(1)} s urgent ${urgent.urgent}; ran out: ${broke.cqc}, ring ${broke.timer}, he's ${broke.aware}, restrained ${broke.held}; RESET mid-grapple: ${after.cqc}, countdown ${after.left === null ? 'gone' : after.left}; page errors ${page.errors.length}` };
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

  // ---------------------------------------------------------------- Step 24.2: Observation Mode, guard debugging, patrols, speeds
  // Observation Mode through real touches (forest, iPhone layout): STATS → OBSERVE; the camera leaves her (she's hidden, still
  // where she was); the stick flies it, a drag turns it, UP / DOWN raise and lower it; the gameplay buttons are gone and the
  // observer's are there; no footstep of hers while it flies; EXIT OBSERVE puts everything back as it was
  async observeTouch() {
    const page = await touchPage(), T = page.touch;
    await page.evaluate(() => { MV.toMenu(); }); await page.tap('#mv-start-forest'); await page.waitForTimeout(800);
    const st = () => page.evaluate(() => { const o = MV.observer, vis = id => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && !e.closest('[hidden]'); };
      return { on: o.active, pos: o.pos.toArray(), yaw: o.yaw, cam: MV.camera.position.toArray(), me: MV.motor.position.toArray(), shown: MV.visual.root.visible, hp: MV.playerHealth.current, eq: MV.equipment.status(),
        play: ['mv-aim', 'mv-cqc', 'mv-crouch', 'mv-use'].map(vis), obs: ['mv-obs-up', 'mv-obs-down', 'mv-obs-trigger', 'mv-obs-next', 'mv-obs-follow', 'mv-obs-exit', 'mv-obs-kind'].map(vis), steps: MV.footsteps.count }; });
    const s0 = await st();
    await page.tap('#mv-stats-btn'); await page.waitForTimeout(300); await page.tap('#mv-observe'); await page.waitForTimeout(500);
    const s1 = await st();
    // the stick: forward for 1 s
    await T('touchStart', [{ x: 150, y: 300, id: 1 }]); await T('touchMove', [{ x: 150, y: 236, id: 1 }]); await page.waitForTimeout(1200); await T('touchEnd', [{ x: 150, y: 236, id: 1 }]); await page.waitForTimeout(300);
    const s2 = await st();
    // a drag in the right half turns it
    for (let i = 0; i <= 8; i++) { await T(i ? 'touchMove' : 'touchStart', [{ x: 700 - i * 12, y: 330, id: 2 }]); await page.waitForTimeout(25); } await T('touchEnd', [{ x: 604, y: 330, id: 2 }]); await page.waitForTimeout(300);
    const s3 = await st();
    // UP held, then DOWN held
    const hold = async id => { const b = await page.locator('#' + id).boundingBox(); await T('touchStart', [{ x: b.x + 28, y: b.y + 28, id: 3 }]); await page.waitForTimeout(900); await T('touchEnd', [{ x: b.x + 28, y: b.y + 28, id: 3 }]); await page.waitForTimeout(200); return (await st()).pos[1]; };
    const y0 = s3.pos[1], yUp = await hold('mv-obs-up'), yDown = await hold('mv-obs-down');
    const ex = await page.locator('#mv-obs-exit').boundingBox(); await T('touchStart', [{ x: ex.x + 20, y: ex.y + 12, id: 4 }]); await page.waitForTimeout(70); await T('touchEnd', [{ x: ex.x + 20, y: ex.y + 12, id: 4 }]); await page.waitForTimeout(500);
    const s4 = await st();
    const camNear = Math.hypot(s4.cam[0] - s4.me[0], s4.cam[2] - s4.me[2]);
    const ok = !s0.on && s1.on && !s1.shown && s1.play.every(v => !v) && s1.obs.every(Boolean) && s2.pos.join() !== s1.pos.join() && Math.hypot(s2.pos[0] - s1.pos[0], s2.pos[2] - s1.pos[2]) > 2
      && s2.me.join() === s0.me.join() && Math.abs(s3.yaw - s2.yaw) > 0.05 && yUp > y0 + 1 && yDown < yUp - 1 && s4.steps === s1.steps
      && !s4.on && s4.shown && s4.me.join() === s0.me.join() && s4.hp === s0.hp && s4.eq === s0.eq && s4.play.every(Boolean) && s4.obs.every(v => !v) && camNear < 6 && page.errors.length === 0;
    return { pass: ok, detail: `STATS → OBSERVE: observing ${s1.on}, her hidden ${!s1.shown}, gameplay buttons gone ${s1.play.every(v => !v)}, observer controls there ${s1.obs.every(Boolean)}; stick 1.2 s → camera moved ${Math.hypot(s2.pos[0] - s1.pos[0], s2.pos[2] - s1.pos[2]).toFixed(1)} m (her still at her place ${s2.me.join() === s0.me.join()}); drag → turned ${((s3.yaw - s2.yaw) * 57.3).toFixed(0)}°; UP 0.9 s ${y0.toFixed(1)} → ${yUp.toFixed(1)} m, DOWN → ${yDown.toFixed(1)} m; her footsteps while flying ${s4.steps - s1.steps}; EXIT OBSERVE: back ${!s4.on}, her shown ${s4.shown} at the same place ${s4.me.join() === s0.me.join()}, HP ${s4.hp}, equipment "${s4.eq}", buttons back ${s4.play.every(Boolean)}, camera back by her (${camNear.toFixed(1)} m); page errors ${page.errors.length}` };
  },

  // while observing she can't be seen, shot or hurt, and makes no sound; the guards carry on (their AI runs, what they
  // already knew plays out, nothing is reset); flying the camera in front of a guard reveals nothing; exiting restores her
  async observeRules() {
    const page = await CHECKS._forestPage();
    await page.evaluate(() => { window.__combat = true; });
    const r = await page.evaluate(() => {
      const B = G('B'), m = MV.motor, P = MV.playerHealth, out = {}, ev = []; MV.noise.on(e => ev.push(e.source));
      // seen by Guard B first (held facing her), so he's ALERT when observing begins
      B.patrol.enabled = false; B.motor.teleport(20, -5, Math.PI); B.post.set(20, 0, -5); B.postYaw = Math.PI; B.reset(); B.patrol.enabled = false;
      m.teleport(20, -12, 0); MV.cam.snap(m); for (let i = 0; i < 60 * 3; i++) { sim(1); if (P.current < 60) { P.current = 100; P.state = 'OK'; } }
      out.before = { state: B.awareness.state, conf: B.awareness.confirmed, meter: B.vision.meter, hp: P.current };
      const me = m.position.clone(), hp = P.current, shots0 = B.gunfire.shots, eq = MV.equipment.status();
      const r1 = MV.enterObserve(); out.enter = r1.ok;
      out.at = { state: B.awareness.state, conf: B.awareness.confirmed, seen: B.awareness.seen && B.awareness.seen.position.clone() };
      // fly right in front of him for 8 s: nothing to see; she's out of reach of his gun
      ev.length = 0; const o = MV.observer; o.pos.set(20, 1.6, -7); let seenRate = 0, posA = [];
      const A = G('A'); for (let i = 0; i < 60 * 8; i++) { sim(1); seenRate = Math.max(seenRate, B.vision.seen.rate); if (i % 60 === 0) posA.push(G('C').position.clone()); }
      out.during = { seenRate, shots: B.gunfire.shots - shots0, hp: P.current, sounds: ev.filter(s => s === 'player').length, state: B.awareness.state, conf: B.awareness.confirmed, seenKept: !!(B.awareness.seen && out.at.seen && B.awareness.seen.position.distanceTo(out.at.seen) < 1e-6), meter: B.vision.meter, moved: posA.length > 1 && posA[posA.length - 1].distanceTo(posA[0]) > 1 };
      out.dmg = P.take({ amount: 20, source: 'test', id: 'obs1' }).why;
      // CQC and USE presses do nothing while observing
      MV.input.cqcTapped = true; MV.input.useTapped = true; sim(10); out.actions = [MV.cqc.state, MV.equipment.item().ctl.throws];
      MV.exitObserve(); sim(2);
      out.after = { at: m.position.distanceTo(me), hp: P.current === hp, eq: MV.equipment.status() === eq, shown: MV.visual.root.visible, shielded: !!P.shielded };
      return out;
    });
    const o = r, ok = o.before.state === 'ALERT' && o.before.conf && o.enter && o.at.state === 'ALERT' && o.at.conf && o.during.seenRate === 0 && o.during.shots === 0 && o.during.hp === o.before.hp && o.during.sounds === 0
      && o.during.conf && o.during.seenKept && ['ALERT', 'EVASION', 'HEIGHTENED'].indexOf(o.during.state) >= 0 && o.during.moved && o.dmg === 'observing' && o.actions[0] === 'FREE' && o.actions[1] === 0
      && o.after.at < 1e-9 && o.after.hp && o.after.eq && o.after.shown && !o.after.shielded && page.errors.length === 0;
    return { pass: ok, detail: `Guard B sees her: ${o.before.state} (confirmed ${o.before.conf}); OBSERVE: he's still ${o.at.state}, nothing reset; 8 s with the camera 2 m in front of him: sight rate ${o.during.seenRate}, ${o.during.shots} shots, her HP ${o.during.hp}, her sounds ${o.during.sounds}; he's ${o.during.state} (confirmed ${o.during.conf}, last sighting kept ${o.during.seenKept}, meter ${Math.round(o.during.meter * 100)}%), Guard C walking on ${o.during.moved}; damage while observing: "${o.dmg}"; CQC / USE presses: ${o.actions.join(', ')} throws; EXIT: her exactly where she was ${o.after.at < 1e-9}, HP and equipment unchanged ${o.after.hp && o.after.eq}, shown ${o.after.shown}; page errors ${page.errors.length}` };
  },

  // NEXT GUARD goes through the guards in play only (never one who's off); FOLLOW keeps the camera on him as he walks; following
  // changes nothing about him (the same walk with and without it); FREE gives the camera back to the stick
  async observeFollow() {
    const page = await CHECKS._forestPage();
    const r = await page.evaluate(() => {
      const o = MV.observer, out = {};
      MV.enterObserve(); const seq = []; for (let k = 0; k < 6; k++) seq.push(o.selectNext().levelKey); out.seq = seq.join('');
      // B's walk, 20 s from RESET, followed and not
      const walk = follow => { document.getElementById('mv-reset').click(); while (o.sel.levelKey !== 'B') o.selectNext(); if ((o.mode === 'follow') !== follow) o.toggleFollow(); const pts = []; let far = 0;
        for (let i = 0; i < 60 * 20; i++) { sim(1); if (i % 30 === 0) pts.push(G('B').position.x.toFixed(4) + ',' + G('B').position.z.toFixed(4)); if (follow && i > 120) far = Math.max(far, Math.hypot(o.pos.x - G('B').position.x, o.pos.z - G('B').position.z)); } return { pts: pts.join(' '), far }; };   /* (after 2 s to catch up) */
      const a = walk(true); out.followed = a.pts; out.far = a.far;
      // FREE: the stick flies it again
      if (o.mode === 'follow') o.toggleFollow(); const p0 = o.pos.clone(); MV.input.move.y = 1; sim(30); MV.input.move.y = 0; out.free = o.pos.distanceTo(p0);
      MV.exitObserve();
      return out;
    });
    // the same walk on a second, freshly loaded page without following (a fresh load starts exactly the same; RESET alone
    // doesn't restart the guards' animation clocks, so two runs after RESET differ slightly in their turn timing)
    const page2 = await CHECKS._forestPage();
    const plain = await page2.evaluate(() => { const o = MV.observer; MV.enterObserve(); for (let k = 0; k < 6; k++) o.selectNext();
      document.getElementById('mv-reset').click(); while (o.sel.levelKey !== 'B') o.selectNext(); const pts = [];
      for (let i = 0; i < 60 * 20; i++) { sim(1); if (i % 30 === 0) pts.push(G('B').position.x.toFixed(4) + ',' + G('B').position.z.toFixed(4)); } return pts.join(' '); });
    const plain2 = await (await CHECKS._forestPage()).evaluate(() => { const o = MV.observer; MV.enterObserve(); for (let k = 0; k < 6; k++) o.selectNext();
      document.getElementById('mv-reset').click(); while (o.sel.levelKey !== 'B') o.selectNext(); const pts = [];
      for (let i = 0; i < 60 * 20; i++) { sim(1); if (i % 30 === 0) pts.push(G('B').position.x.toFixed(4) + ',' + G('B').position.z.toFixed(4)); } return pts.join(' '); });
    r.repeatable = plain === plain2; r.same = r.followed === plain;
    const o = r, ok = /^[ABCE]{6}$/.test(o.seq) && o.seq.indexOf('D') < 0 && new Set(o.seq.split('')).size === 4 && o.repeatable && o.same && o.far < 9 && o.free > 2 && page.errors.length === 0;
    return { pass: ok, detail: `NEXT GUARD ×6: ${o.seq} (the 4 in play; Guard D off and never chosen); FOLLOW Guard B 20 s: camera within ${o.far.toFixed(1)} m of him; his walk identical followed and not ${o.same} (two fresh pages unfollowed: identical ${o.repeatable}); FREE: the stick moved the camera ${o.free.toFixed(1)} m; page errors ${page.errors.length}` };
  },

  // the vision overlay: the three zones as the real settings draw them, turned with his facing; the sampled sight cells and
  // the body test use the real line-of-sight check: a wall, a tall container, a tree trunk and a rock hide a body; low cover
  // hides it crouched, not standing; her own visibility as the overlay reports it is the real check; the overlay never changes
  // what he detects; switched off it isn't drawn or computed
  async observeVision() {
    const page = await CHECKS._forestPage({ west: true });
    const r = await page.evaluate(() => {
      const o = MV.observer, out = {}, C = G('C'), D = G('D'), m = MV.motor;
      MV.enterObserve(); while (o.sel !== C) o.selectNext(); sim(30);
      const lines = o.vLines.geometry.drawRange.count; out.zones = { n: C.vision.cfg.zones.map(z => z.angle).join('/'), lines, facing: (() => { const a = o.vFacing.geometry.attributes.position.array; return Math.atan2(a[3] - a[0], a[5] - a[2]) - C.yaw; })() };
      // the body test across known cover, from Guard C held at (2, 11.5) facing south (the long northern block 3 m ahead)
      C.patrol.enabled = false; C.motor.teleport(2, 11.5, Math.PI); C.wantYaw = Math.PI; sim(20);
      out.wall = o.sightAt(C, -5, 15.5);           // beyond the north wall's western part (behind him: the test is sight, not the cone)
      out.block = o.sightAt(C, 2, 4.5);            // behind the long northern block
      out.open = o.sightAt(C, 6.5, 10);            // open floor beside him
      D.patrol.enabled = false; D.motor.teleport(-14.1, 14.9, Math.PI); D.wantYaw = Math.PI; sim(20);
      out.log = o.sightAt(D, -14.1, 6.2);          // just behind the low log, from 8 m
      D.motor.teleport(-12, 14.5, Math.PI); sim(5); out.trunk = o.sightAt(D, -12, 9.6);   // behind the tree trunk
      const E = G('E'); E.patrol.enabled = false; E.motor.teleport(-3.5, -13, Math.PI); E.wantYaw = Math.PI; sim(20); out.rock = o.sightAt(E, -3.5, -19.5);   // behind the trail's rock
      // the overlay's cells: drawn for C facing the block: some hidden, none at a hidden spot
      o.drawVision(C); out.cells = o.vstat;
      // agreement: her real visibility (the guard's own look at her posed body) and the overlay's sampled body, at many places
      MV.exitObserve(); let agree = 0, n = 0, exact = 0;
      const guardB = G('B'); guardB.patrol.enabled = false; guardB.motor.teleport(19.5, -4.5, Math.PI); guardB.wantYaw = Math.PI; sim(20);
      for (const [dx, dz] of [[0, -3], [2, -5], [-2, -6], [0, -9], [3, -11], [-3, -12], [5, -8], [-5, -8], [0, -14], [1, -15.5], [-4, -10], [4, -13]]) for (const st of ['stand', 'crouch']) {
        MV.input.setCrouch(st === 'crouch'); m.teleport(19.5 + dx, -4.5 + dz, 0); sim(40); guardB.vision.look(MV.seeTarget); const s = guardB.vision.seen;
        if (!s.zone) continue; n++; const real = s.exposure >= guardB.vision.cfg.coverBlock, est = o.sightAt(guardB, m.position.x, m.position.z)[st === 'stand' ? 'standing' : 'crouched'];
        if (real === est) agree++;
      }
      MV.input.setCrouch(false);
      out.agree = [agree, n];
      // the overlay never changes detection: the same 6 s with it on and off
      const run = on => { document.getElementById('mv-reset').click(); MV.enterObserve(); o.show.vision = on; while (o.sel.levelKey !== 'B') o.selectNext(); const res = []; for (let i = 0; i < 360; i++) { sim(1); if (i % 60 === 0) res.push(MV.active.map(g => g.vision.meter.toFixed(4) + g.awareness.state).join(',')); } const ms = o.visionMs; MV.exitObserve(); return { res: res.join(' '), ms }; };
      const on = run(true); o.visionMs = null; const off = run(false); out.same = on.res === off.res; out.offCost = off.ms; out.onCost = on.ms;
      return out;
    });
    const o = r, ok = o.zones.n === '30/70/110' && o.zones.lines > 20 && Math.abs(Math.atan2(Math.sin(o.zones.facing), Math.cos(o.zones.facing))) < 0.01
      && !o.wall.standing && !o.block.standing && !o.block.crouched && o.open.standing && o.open.crouched && o.log.standing && !o.log.crouched && !o.trunk.standing && !o.rock.standing
      && o.cells.hidden > 0 && o.cells.seen > 0 && o.agree[1] >= 10 && o.agree[0] >= o.agree[1] * 0.85 && o.same && o.offCost == null && o.onCost > 0 && page.errors.length === 0;
    return { pass: ok, detail: `zones ${o.zones.n}° (${o.zones.lines} outline points), facing mark on his facing (${(o.zones.facing * 57.3).toFixed(2)}° off); a body beyond a wall: standing ${o.wall.standing}; behind the long block: ${o.block.standing}/${o.block.crouched}; open floor: ${o.open.standing}/${o.open.crouched}; behind the low log at 8 m: standing ${o.log.standing}, crouched ${o.log.crouched}; behind a trunk: ${o.trunk.standing}; behind the rock: ${o.rock.standing}; Guard C's overlay: ${o.cells.seen} cells seen (${o.cells.standOnly} standing only), ${o.cells.hidden} hidden; sampled body vs his real look at her: ${o.agree[0]} of ${o.agree[1]} agree; detection identical with the overlay on and off ${o.same}; its cost ${o.onCost.toFixed(1)} ms per update on, none computed off; page errors ${page.errors.length}` };
  },

  // the routes: Guard B a continuous rounded six-point loop (never reversing), Guard C the four-corner rectangle, Guard E his
  // four-point loop, each in order; stops at their observation points; turns are smooth (never a snap, never walking backward);
  // a back-and-forth route (a test route for Guard C) stops 2–4 s at each end, looks round, turns, then walks back; the route
  // overlay shows the real waypoints; the lookouts stay at their posts; the Test Lab's patrol still runs
  async patrolRoutes() {
    const page = await CHECKS._forestPage();
    const r = await page.evaluate(() => {
      const out = {}, B = G('B'), C = G('C'), E = G('E'), A = G('A');
      out.cfg = { B: [B.patrol.cfg.points.length, B.patrol.cfg.loop], C: [C.patrol.cfg.points.length, C.patrol.cfg.loop], E: [E.patrol.cfg.points.length, E.patrol.cfg.loop] };
      // B's loop: consecutive legs never turn back on themselves
      const pts = B.patrol.cfg.points; let sharpest = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length]; const h1 = Math.atan2(b.x - a.x, b.z - a.z), h2 = Math.atan2(c.x - b.x, c.z - b.z); sharpest = Math.max(sharpest, Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) * 57.3); }
      out.sharpest = sharpest;
      const order = { B: [], C: [], E: [] }, snap = {}, back = {}, worst = {}, yaw0 = {};
      for (let i = 0; i < 60 * 240; i++) {
        sim(1);
        for (const g of [B, C, E]) { const k = g.levelKey, p = g.patrol; if (order[k][order[k].length - 1] !== p.index) order[k].push(p.index);
          const dy = Math.abs(Math.atan2(Math.sin(g.yaw - (yaw0[k] == null ? g.yaw : yaw0[k])), Math.cos(g.yaw - (yaw0[k] == null ? g.yaw : yaw0[k])))); yaw0[k] = g.yaw; snap[k] = Math.max(snap[k] || 0, dy);
          if (g.motor.speed < -0.01) back[k] = (back[k] || 0) + 1; worst[k] = Math.max(worst[k] || 0, intrusion(g)); }
      }
      const inOrder = (seq, n) => { let ok = true; for (let i = 1; i < seq.length; i++) if (seq[i] !== (seq[i - 1] + 1) % n) ok = false; return ok; };
      out.order = { B: [order.B.length, inOrder(order.B, 6)], C: [order.C.length, inOrder(order.C, 4)], E: [order.E.length, inOrder(order.E, 4)] };
      out.snap = snap; out.back = back; out.worst = worst; out.A = Math.hypot(A.position.x + 4, A.position.z - 22.7);
      // the route overlay for B: labels and the target ring are his real waypoints
      MV.enterObserve(); while (MV.observer.sel !== B) MV.observer.selectNext(); sim(2);
      const labels = MV.observer.routeLabels(B); out.labels = labels.length === pts.length && labels.every((l, i) => l.q === pts[i] && l.text.indexOf('W' + i) === 0) && labels.filter(l => /stop/.test(l.text)).length === pts.filter(p => p.pause).length;
      out.target = B.patrol.state !== 'interrupted' ? Math.hypot(MV.observer.rTarget.position.x - pts[B.patrol.index].x, MV.observer.rTarget.position.z - pts[B.patrol.index].z) : 0;
      MV.exitObserve();
      // a back-and-forth test route for Guard C along the compound's north side
      document.getElementById('mv-reset').click();
      C.patrol = new MV.SCmv.GuardPatrol(C, { enabled: true, loop: false, push: 0.42, seed: 77, points: [{ x: -3.1, z: 10.2 }, { x: 2.5, z: 10.4 }, { x: 8.6, z: 10.2 }] }); C.awareness.reset(); C.patrol.reset();
      const ends = []; let cur = null, prevYaw = C.yaw, maxDy = 0, walkMis = 0;
      for (let i = 0; i < 60 * 90; i++) {
        sim(1); const p = C.patrol, dy = Math.abs(Math.atan2(Math.sin(C.yaw - prevYaw), Math.cos(C.yaw - prevYaw))); prevYaw = C.yaw; maxDy = Math.max(maxDy, dy);
        if (C.motor.speed > 0.4 && C.motor.velocity.lengthSq() > 0.01) { const v = C.motor.velocity; if (v.x * Math.sin(C.yaw) + v.z * Math.cos(C.yaw) < 0.5 * v.length()) walkMis++; }
        const atEnd = p.state === 'observing' && (p.index === 0 || p.index === 2);
        if (atEnd && !cur) cur = { i: p.index, t: i / 60, yaws: new Set() };
        if (cur && atEnd) cur.yaws.add(Math.round(C.yaw * 57.3 / 10));
        if (cur && !atEnd) { ends.push({ i: cur.i, dur: i / 60 - cur.t, looks: cur.yaws.size }); cur = null; }
      }
      out.bf = { ends: ends.map(e => `W${e.i} ${e.dur.toFixed(1)}s/${e.looks}`).join(' '), ok: ends.length >= 3 && ends.every(e => e.dur >= 2 && e.looks >= 3), maxDy, walkMis, idx: C.patrol.cfg.points.length };
      return out;
    });
    const o = r, maxSnap = Math.max(...Object.values(o.snap)), ok = o.cfg.B[0] >= 4 && o.cfg.B[0] <= 6 && o.cfg.B[1] && o.cfg.C.join() === '4,true' && o.cfg.E.join() === '4,true' && o.sharpest < 120
      && o.order.B[0] > 12 && o.order.B[1] && o.order.C[0] > 8 && o.order.C[1] && o.order.E[0] > 8 && o.order.E[1] && maxSnap < 0.1 && Object.keys(o.back).length === 0 && Object.values(o.worst).every(v => v < 0.02) && o.A < 0.05
      && o.labels && o.target < 1e-6 && o.bf.ok && o.bf.maxDy < 0.1 && o.bf.walkMis === 0 && page.errors.length === 0;
    return { pass: ok, detail: `routes: B ${o.cfg.B[0]}-point loop (sharpest turn between legs ${o.sharpest.toFixed(0)}°), C ${o.cfg.C[0]}-point loop, E ${o.cfg.E[0]}-point loop; in 4 min, waypoints in order: B ${o.order.B[1]} (${o.order.B[0]}), C ${o.order.C[1]} (${o.order.C[0]}), E ${o.order.E[1]} (${o.order.E[0]}); biggest turn in one frame ${(maxSnap * 57.3).toFixed(1)}°; walking backward ${Object.keys(o.back).length ? JSON.stringify(o.back) : 'never'}; into anything ${Math.max(...Object.values(o.worst)).toFixed(3)} m; lookout A at his post (${o.A.toFixed(3)} m); route overlay = his waypoints ${o.labels}, target ring on the current one ${o.target < 1e-6}; a back-and-forth test route: end stops ${o.bf.ends} (s / headings looked at), biggest turn in a frame ${(o.bf.maxDy * 57.3).toFixed(1)}°, frames walking against his facing ${o.bf.walkMis}; page errors ${page.errors.length}` };
  },

  // test sounds: the existing kinds (footsteps by gait, the magazine's clatter, the pistol's shot), one event per press, on the
  // ground under the camera (never at her), heard by the normal hearing exactly by its reach; a gunshot raises a pistol, a clatter
  // doesn't; the ring is the event; nothing reveals the observer; no ground (outside the level) → no sound, with why
  async observeSound() {
    const page = await CHECKS._forestPage();
    const r = await page.evaluate(() => {
      const o = MV.observer, out = {}, N = MV.noise, FL = N.cfg.footstepLevel, MG = MV.SCmv.EQUIPMENT['empty-magazine'].config, PC = MV.pistol.cfg;
      out.kinds = o.sounds.map(s => `${s.name}:${s.level}:${s.type}`).join(',');
      out.defs = [FL.sneak, FL.walk, MG.noiseLevel, MG.noiseType, PC.noiseLevel, PC.noiseType].join(',');
      MV.enterObserve(); const evs = []; N.on(e => evs.push(e));
      const C = G('C'); C.patrol.enabled = false; C.motor.teleport(-3.1, 10.2, 0); C.wantYaw = 0; C.reset(); C.patrol.enabled = false; sim(10);
      // behind him (south), at 6 m: a clatter, on the compound's concrete
      o.pos.set(-3.1, 6, 4.2); sim(12); evs.length = 0; o.soundIdx = 2; const t = o.trigger();
      out.one = [evs.length, evs[0] && evs[0].type, evs[0] && evs[0].level, evs[0] && xzd(evs[0].position, o.pos) < 1e-6, xzd(evs[0].position, MV.motor.position) > 5, evs[0] && evs[0].surface];
      const h = C.hearing.last, ev = evs[0], e2 = C.hearing.evaluate(ev); out.heard = [h.heard, e2.heard, Math.abs(h.reach - ev.radius * C.hearing.sensitivity()) < 1e-9, t.guards.find(g => g.key === 'C').heard];
      let seen = 0; const seq = []; for (let i = 0; i < 60 * 25; i++) { sim(1); seen = Math.max(seen, C.vision.meter); if (seq[seq.length - 1] !== C.awareness.state) seq.push(C.awareness.state); }
      out.clatter = { seq: seq.join('>'), seen, w: C.weapon.state, focus: C.awareness.heard ? xzd(C.awareness.heard.position, ev.position) : 99 };
      // the same spot: a gunshot: his pistol comes up (a gunshot is a gunshot)
      document.getElementById('mv-reset').click(); MV.enterObserve(); C.patrol.enabled = false; C.motor.teleport(-3.1, 10.2, 0); C.wantYaw = 0; C.reset(); C.patrol.enabled = false; sim(10);
      o.pos.set(-3.1, 6, 4.2); sim(12); o.soundIdx = 3; evs.length = 0; o.trigger(); let up = 0; for (let i = 0; i < 60 * 4; i++) { sim(1); if (C.weapon.state !== 'LOWERED') up++; }
      out.gun = { type: evs[0].type, lv: evs[0].level, up, why: C.weapon.why, conf: C.awareness.confirmed };
      // the ring is the event
      const ring = N.rings[(N._next + N.rings.length - 1) % N.rings.length]; out.ring = [xzd(ring.position, evs[0].position) < 1e-6, ring.userData.r === evs[0].radius];
      // a quiet footstep far off: out of earshot for everyone, nobody hears it
      o.pos.set(20, 6, -18); sim(12); o.soundIdx = 0; const t3 = o.trigger(); out.quiet = t3.guards.map(g => `${g.key}:${g.heard}`).join(',');
      // expired effects removed
      sim(Math.ceil(N.cfg.ringTime * 60) + 5); out.after = N.rings.filter(m => m.visible).length;
      // outside the level: refused
      o.pos.set(60, 10, 60); o._clampPos(); o.pos.set(60, 10, 60); const t4 = o.trigger(); out.outside = [t4.ok, t4.why];
      MV.exitObserve();
      return out;
    });
    const o = r, ok = o.kinds === 'QUIET FOOTSTEP:1:footstep,NORMAL FOOTSTEP:2:footstep,METALLIC CLATTER:3:clatter,GUNSHOT:5:gunshot' && o.defs === '1,2,3,clatter,5,gunshot'
      && o.one[0] === 1 && o.one[1] === 'clatter' && o.one[2] === 3 && o.one[3] && o.one[4] && o.one[5] === 'concrete' && o.heard.every(Boolean)
      && /SUSPICIOUS/.test(o.clatter.seq) && o.clatter.seen === 0 && o.clatter.focus < 1e-6 && o.gun.type === 'gunshot' && o.gun.lv === 5 && o.gun.up > 0 && o.ring.every(Boolean) && !/:true/.test(o.quiet)
      && o.after === 0 && o.outside[0] === false && /outside/.test(o.outside[1]) && page.errors.length === 0;
    return { pass: ok, detail: `kinds ${o.kinds} (from the footstep levels, the magazine and the pistol: ${o.defs}); one press → ${o.one[0]} event (${o.one[1]} L${o.one[2]} on ${o.one[5]}) under the camera ${o.one[3]}, not at her ${o.one[4]}; Guard C 6 m off heard it ${o.heard[0]} (his hearing's own test ${o.heard[1]}, reach ${o.heard[2] ? 'exactly the event\'s' : 'DIFFERENT'}); he went ${o.clatter.seq}, saw nothing (${o.clatter.seen}), pistol ${o.clatter.w}, his attention on its origin (${o.clatter.focus.toExponential(0)} m); a gunshot there: pistol up ${o.gun.up} frames (${o.gun.why}); ring at the event with its reach ${o.ring.join('/')}; a quiet footstep far off: ${o.quiet}; after its life ${o.after} rings; outside the level: ${o.outside[0]} ("${o.outside[1]}"); page errors ${page.errors.length}` };
  },

  // the approved speeds, measured as her real velocity: sneak ≈ 1.1, stealth walk 2.4, jog 3.8 m/s; the stick's zones, its
  // hysteresis and the crouch speeds unchanged; the change from one speed to the next a smooth ramp; the footstep tiers (L1 / L2 / L3)
  // and their reach by surface unchanged; the guards' own walking speeds unchanged
  async speedTiers() {
    const page = await CHECKS._forestPage();
    const r = await page.evaluate(() => {
      const m = MV.motor, out = {}, ev = []; MV.noise.on(e => { if (e.source === 'player') ev.push(e); });
      MV.levels.forest.recs.forEach(rr => { rr.g.patrol.enabled = false; });
      const run = (push, crouch, x, z) => { MV.input.setCrouch(!!crouch); m.teleport(x, z, 0); MV.cam.snap(m); sim(30); MV.input.move.y = push; sim(120); ev.length = 0; const a = m.position.clone(); sim(150); const v = m.position.distanceTo(a) / 2.5, gait = m.gait.id; const lv = [...new Set(ev.map(e => e.level))].join('/'), rad = [...new Set(ev.map(e => e.surface + ' ' + e.radius.toFixed(1)))].join(','); MV.input.move.y = 0; sim(60); return { v, gait, lv, rad }; };
      // (a clear grass line west of the compound, and the eastern dirt trail, both run north)
      out.sneak = run(0.35, false, -10.8, -6); out.walk = run(0.78, false, -10.8, -6); out.jog = run(1, false, -10.8, -6);
      out.walkDirt = run(0.78, false, 25, -9); out.jogDirt = run(1, false, 25, -9);
      out.crouchSlow = run(0.35, true, -10.8, -6); out.crouchFast = run(1, true, -10.8, -6); MV.input.setCrouch(false);
      const c = m.cfg; out.zones = JSON.stringify(c.speedZones) + ' ' + c.zoneHysteresis + ' ' + JSON.stringify(c.crouchSpeedZones) + ' ' + JSON.stringify(c.crouchSpeedCurve);
      // walk → jog: the speed ramps (never a jump)
      m.teleport(-10.8, -6, 0); MV.cam.snap(m); MV.input.move.y = 0.78; sim(120); let maxA = 0, prev = m.speed; MV.input.move.y = 1; for (let i = 0; i < 90; i++) { sim(1); maxA = Math.max(maxA, m.speed - prev); prev = m.speed; } MV.input.move.y = 0; sim(60);
      out.ramp = maxA;
      out.guardCurve = JSON.stringify(G('B').motor.cfg.speedCurve); out.evasion = G('B').awareness.cfg.evasionPush;
      return out;
    });
    const o = r, ok = o.sneak.v > 1.0 && o.sneak.v < 1.25 && Math.abs(o.walk.v - 2.4) < 0.05 && Math.abs(o.jog.v - 3.8) < 0.05 && o.sneak.gait === 'sneak' && o.walk.gait === 'walk' && o.jog.gait === 'jog'
      && o.sneak.lv === '1' && o.walk.lv === '2' && o.jog.lv === '3' && /grass 3\.6/.test(o.walk.rad) && /grass 8\.5/.test(o.jog.rad) && /dirt 6\.0/.test(o.walkDirt.rad) && /dirt 14\.0/.test(o.jogDirt.rad)
      && Math.abs(o.crouchSlow.v - 0.9) < 0.06 && Math.abs(o.crouchFast.v - 2.0) < 0.06 && o.crouchSlow.lv === '1' && o.crouchFast.lv === '2'
      && o.zones === '[[0.12,0.6],[0.68,0.88],[0.94,1]] 0.035 [[0.12,0.6],[0.68,1]] [[0.12,0.8],[0.6,1],[0.68,1.85],[0.88,2],[1,2]]' && o.ramp <= 0.1
      && o.guardCurve === '[[0.12,1],[0.6,1.25],[0.68,1.9],[0.88,2],[0.94,3.2],[1,3.2]]' && page.errors.length === 0;
    const f = t => `${t.v.toFixed(2)} m/s ${t.gait} L${t.lv}`;
    return { pass: ok, detail: `sneak ${f(o.sneak)}; stealth walk ${f(o.walk)} (${o.walk.rad}; dirt ${o.walkDirt.rad}); jog ${f(o.jog)} (${o.jog.rad}; dirt ${o.jogDirt.rad}); crouch ${f(o.crouchSlow)} / ${f(o.crouchFast)}; zones, hysteresis and crouch curve ${o.zones}; walk → jog: at most ${o.ramp.toFixed(3)} m/s more per frame (a ramp, no jump); the guards' own curve ${o.guardCurve}; page errors ${page.errors.length}` };
  },

  // the developer tools: each guard's decision history records real changes (a sound, his reaction, his return), never the same
  // unchanged state again, and stays bounded; the PERF section reports measured figures; COPY REPORT holds the current state, and
  // where the clipboard is refused it shows the text instead (never claiming it copied); STATS sections open and close; RESET
  // while observing restarts the level and stays observing over it
  async devTools() {
    const page = await CHECKS._forestPage();
    const r = await page.evaluate(() => {
      const o = MV.observer, B = G('B'), out = {};
      MV.enterObserve(); while (o.sel !== B) o.selectNext();
      sim(60 * 20); const idle = o.history(B).length; sim(60 * 5); const idle2 = o.history(B).length;
      // a clatter 5 m behind him
      const f = B.forward(); o.pos.set(B.position.x - f.x * 5, 6, B.position.z - f.z * 5); sim(12); o.soundIdx = 2; o.trigger();
      for (let i = 0; i < 60 * 60; i++) sim(1);
      const H = o.history(B).map(e => e.e); out.hist = { idle, idle2, has: ['Heard L3 clatter', 'Entered SUSPICIOUS', 'Entered INVESTIGATING', 'Patrol interrupted'].map(k => H.some(e => e.indexOf(k) === 0)), back: H.some(e => /Returning to route|Entered NORMAL/.test(e)), dup: H.some((e, i) => i && e === H[i - 1] && /^Entered/.test(e)), times: o.history(B).every((e, i, a) => !i || e.t >= a[i - 1].t) };
      for (let k = 0; k < 30; k++) { o.pos.set(B.position.x + (k % 2 ? 4 : -4), 6, B.position.z); sim(12); o.trigger(); sim(30); }
      out.bounded = o.history(B).length; out.cap = o.cfg.history;
      out.perf = MV.devSection('perf'); out.ai = MV.devSection('ai').split('\n')[0];
      out.report = MV.debugReport();
      // STATS sections
      MV.setStats(true); const tabs = [...document.querySelectorAll('#mv-devtabs [data-tab]')]; tabs.find(t => t.dataset.tab === 'patrol').click(); sim(12);
      out.tab = { pane: !document.getElementById('mv-devpane').hidden, text: document.getElementById('mv-devpane').textContent.slice(0, 40), cells: getComputedStyle(document.querySelector('.mv-sec')).display };
      tabs.find(t => t.dataset.tab === 'all').click(); sim(2); out.tabAll = { pane: document.getElementById('mv-devpane').hidden, cells: getComputedStyle(document.querySelector('.mv-sec')).display };
      // RESET while observing
      B.awareness.suspicion = 0.9; document.getElementById('mv-reset').click(); sim(2);
      out.reset = { on: o.active, level: MV.level.id, hidden: !MV.visual.root.visible, B: [B.position.x, B.position.z, B.awareness.state, B.patrol.index], hist: o.history(B).length <= 2, rings: MV.noise.rings.filter(m => m.visible).length, overview: o.pos.y > 20 };
      MV.exitObserve();
      return out;
    });
    // COPY REPORT through the button: headless pages refuse the clipboard, so the text must be shown instead
    await page.evaluate(() => { MV.setStats(true); document.getElementById('mv-copy').click(); });
    await page.waitForTimeout(500);
    const copy = await page.evaluate(() => ({ state: MV.lastCopy, shown: !document.getElementById('mv-report').hidden, text: document.getElementById('mv-report-text').value.slice(0, 60), pane: document.getElementById('mv-devpane').textContent.slice(0, 40) }));
    const o = r, ok = o.hist.idle2 - o.hist.idle <= 12 && o.hist.has.every(Boolean) && o.hist.back && !o.hist.dup && o.hist.times && o.bounded === o.cap
      && (/^MEASURED: \d+ fps/.test(o.perf) && /draw calls/.test(o.perf) || /^not measured yet/.test(o.perf)) && /Guard B — East Patrol/.test(o.ai)
      && /SHADOW CELL debug report · build Step 24\.2/.test(o.report) && /level: LEVEL 01 — FOREST OUTPOST/.test(o.report) && /SELECTED: Guard B/.test(o.report) && /recent decisions:/.test(o.report) && /navigation:/.test(o.report)
      && o.tab.pane && /Guard B/.test(o.tab.text) && o.tab.cells === 'none' && o.tabAll.pane && o.tabAll.cells !== 'none'
      && o.reset.on && o.reset.level === 'forest' && o.reset.hidden && Math.hypot(o.reset.B[0] - 18.5, o.reset.B[1] - 13) < 0.01 && o.reset.B[2] === 'NORMAL' && o.reset.hist && o.reset.rings === 0 && o.reset.overview
      && ((copy.state === 'copied' && /REPORT COPIED/.test(copy.pane)) || (copy.state === 'shown' && copy.shown && /^SHADOW CELL debug report/.test(copy.text))) && page.errors.length === 0;
    return { pass: ok, detail: `Guard B's history: ${o.hist.idle} entries after 20 s of patrol, ${o.hist.idle2 - o.hist.idle} more in 5 s of it; after a clatter behind him: heard / suspicious / investigating / patrol interrupted ${o.hist.has.join('/')}, returning ${o.hist.back}, a repeated unchanged state ${o.hist.dup}, in time order ${o.hist.times}; after 30 more sounds: ${o.bounded} kept (cap ${o.cap}); PERF "${o.perf.split(' · ').slice(0, 3).join(' · ')}…"; report: ${o.report.split('\n').length} lines, "${o.report.split('\n')[0].slice(0, 50)}…"; PATROL section shown ${o.tab.pane} (cells hidden ${o.tab.cells === 'none'}), ALL back ${o.tabAll.pane}; RESET while observing: still observing ${o.reset.on}, ${o.reset.level}, her hidden ${o.reset.hidden}, Guard B at (${o.reset.B.slice(0, 2).join(', ')}) ${o.reset.B[2]} W${o.reset.B[3]}, history cleared ${o.reset.hist}, rings ${o.reset.rings}, camera over the level ${o.reset.overview}; COPY REPORT: ${copy.state} (${copy.state === 'shown' ? 'clipboard refused here: the text shown to copy' : copy.pane}); page errors ${page.errors.length}` };
  },

  // ---------------------------------------------------------------- Step 24.1: forest corrections and the developer HUD
  // STATS through real touches: collapsed when a level loads (nothing of it on screen), expanded by STATS (capped
  // at about a third of the screen, scrollable, clear of every action button, all its values there), collapsed again;
  // the FPS badge is always shown, small, in the top-left corner, clear of STATS and the controls, and it reads
  // the real frame rate (frames actually drawn per second, not the capped simulation step)
  async hudStats() {
    const out = [], fails = [];
    for (const [w, h] of [[844, 390], [667, 375]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
      await page.goto(base + '/movement.html'); await page.waitForSelector('#mv-start:not([hidden])', { timeout: 120000 });
      await page.tap('#mv-start-forest'); await page.waitForTimeout(2600);
      const geo = () => page.evaluate(() => {
        const R = el => { const r = (typeof el === 'string' ? document.getElementById(el) : el).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        const over = (a, b) => !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
        const bar = document.getElementById('mv-stats'), badge = R('mv-fpsbadge'), btns = ['mv-aim', 'mv-cqc', 'mv-crouch', 'mv-use', 'mv-reset', 'mv-stats-btn'].map(R);
        const cells = bar.hidden ? [] : [...bar.querySelectorAll('.mv-sec > div')].map(R);
        const hit = ['mv-aim', 'mv-cqc', 'mv-crouch', 'mv-use', 'mv-stats-btn'].every(id => { const b = R(id); return document.elementFromPoint(b.l + b.w / 2, b.t + b.h / 2).closest('#' + id) != null; });
        return { open: !bar.hidden, pressed: document.getElementById('mv-stats-btn').getAttribute('aria-pressed'), bar: bar.hidden ? null : R(bar), H: innerHeight, W: innerWidth, rowTop: Math.min(...btns.slice(0, 4).map(b => b.t)),
          scroll: [bar.scrollHeight, bar.clientHeight], values: bar.querySelectorAll('b').length, badge, badgeText: document.getElementById('mv-fpsbadge').textContent, badgeShown: getComputedStyle(document.getElementById('mv-fpsbadge')).visibility === 'visible',
          badgeClear: btns.every(b => !over(b, badge)) && cells.every(c => !over(c, badge)), hit };
      });
      const c0 = await geo();
      await page.tap('#mv-stats-btn'); await page.waitForTimeout(600); const e1 = await geo();
      const scrolled = await page.evaluate(() => { const b = document.getElementById('mv-stats'); b.scrollTop = 1000; const t = b.scrollTop; b.scrollTop = 0; return t; });
      await page.tap('#mv-stats-btn'); await page.waitForTimeout(300); const c2 = await geo();
      // the badge's figure against frames counted here, in the same second-long windows
      const rate = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(), f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res({ counted: n * 1000 / (performance.now() - t0), badge: MV.fps }); }; requestAnimationFrame(f); }));
      const ok = !c0.open && c0.pressed === 'false' && c0.badgeShown && /^FPS \d+$/.test(c0.badgeText) && c0.badge.l < 0.15 * c0.W && c0.badge.t < 30 && c0.badge.w < 70 && c0.badge.h < 20 && c0.badgeClear && c0.hit
        && e1.open && e1.pressed === 'true' && e1.bar.b - e1.bar.t <= 0.35 * e1.H && e1.bar.b <= e1.rowTop && e1.hit && e1.badgeShown && e1.badgeClear && e1.values >= 27
        && (e1.scroll[0] <= e1.scroll[1] + 1 || scrolled > 0) && !c2.open && c2.pressed === 'false' && c2.hit
        && rate.badge > 0 && Math.abs(rate.badge - rate.counted) <= Math.max(2, rate.counted * 0.35) && errs.length === 0;
      if (!ok) fails.push(`${w}×${h}`);
      out.push(`${w}×${h}: level start: STATS collapsed ${!c0.open}, FPS badge "${c0.badgeText}" ${Math.round(c0.badge.w)}×${Math.round(c0.badge.h)} px at (${Math.round(c0.badge.l)}, ${Math.round(c0.badge.t)}), clear of the controls ${c0.badgeClear}; STATS → expanded: ${Math.round(e1.bar.b - e1.bar.t)} px tall (${Math.round((e1.bar.b - e1.bar.t) / e1.H * 100)}%), ends at ${Math.round(e1.bar.b)} above the action row's ${Math.round(e1.rowTop)}, ${e1.values} values, content ${e1.scroll.join('/')} px (scrolls ${scrolled > 0 ? 'yes, ' + scrolled + ' px' : 'no need'}), buttons get the touch ${e1.hit}, badge clear of every value ${e1.badgeClear}; STATS → collapsed ${!c2.open}; frame rate: badge ${rate.badge.toFixed(1)}, counted ${rate.counted.toFixed(1)} fps${errs.length ? '; errors ' + errs.join(';') : ''}`);
      await ctx.close();
    }
    return { pass: fails.length === 0, detail: out.join(' | ') };
  },

  // sound debugging: each real noise event draws a ring at its true origin whose size is its effective reach, coloured by
  // its level, with a short label (what, level, surface, reach, who heard it); rings and labels expire and are reused
  // (12 rings, 4 labels, nothing new per event); switched off, nothing is drawn; and whether it's on or off the guards
  // hear exactly the same
  async soundDebug() {
    const page = await CHECKS._forestPage();
    const r = await page.evaluate(() => {
      const N = MV.noise, out = {}, A = G('A');
      MV.motor.teleport(-4, 17, 0); MV.cam.snap(MV.motor); sim(5);
      // a real footstep sequence: she jogs 3 s on grass toward Guard A's back
      N.cfg.debug = true; MV.forestOpts.sound = true; const evs = []; const off = N.on(e => { if (e.source === 'player') evs.push(e); });
      MV.input.move.y = 1; let check = null;
      for (let i = 0; i < 180; i++) { sim(1); if (!check && evs.length >= 3) { const e = evs[evs.length - 1], ring = N.rings[(N._next + N.rings.length - 1) % N.rings.length]; check = { e, ring }; } }
      MV.input.move.y = 0; off();
      const e = check.e, ring = check.ring;
      out.ring = { at: Math.hypot(ring.position.x - e.position.x, ring.position.z - e.position.z), dot: Math.hypot(ring.userData.dot.position.x - e.position.x, ring.userData.dot.position.z - e.position.z), r: ring.userData.r, radius: e.radius, level: e.level, surf: e.surface };
      // its full size: the ring's outer edge is the event's reach
      const t0 = ring.userData.t; ring.userData.t = 0.4; N.update(0); out.scale = ring.scale.x; ring.userData.t = t0;
      const lbl = MV.noiseLabels.els.map(l => l.el.textContent); out.label = lbl.filter(Boolean).slice(-1)[0] || ''; out.labels = MV.noiseLabels.els.length;
      out.pool = [N.rings.length, MV.scene.children.length];
      for (let k = 0; k < 40; k++) N.emit(2, 'footstep', new THREE.Vector3(30 + k, 0, 30), 'grass', 'test'); out.pool2 = [N.rings.length, MV.scene.children.length];
      // expiry
      sim(Math.ceil(N.cfg.ringTime * 60) + 5); out.after = [N.rings.filter(m => m.visible).length, MV.noiseLabels.els.filter(l => l.shown).length];
      // the same events with it on and off: identical hearing
      const hearRun = on => { N.cfg.debug = on; MV.forestOpts.sound = on; sim(Math.ceil(N.cfg.ringTime * 60) + 5); document.getElementById('mv-reset').click(); sim(2); const res = [];   /* (the last run's rings and labels gone first) */
        for (const [x, z, lv, surf] of [[-4, 19, 2, 'grass'], [-4, 21, 1, 'grass'], [0, -12, 3, 'dirt'], [-8, -10, 2, 'dirt'], [16, 14, 3, 'grass']]) { N.emit(lv, 'footstep', new THREE.Vector3(x, 0, z), surf, 'player'); res.push(MV.active.map(g => g.hearing.last ? `${g.hearing.last.heard}:${g.hearing.last.distance.toFixed(3)}:${g.hearing.last.reach.toFixed(3)}` : '-').join('|')); sim(3); }
        return res.join(' ') + ' / ' + MV.active.map(g => Math.round(g.awareness.suspicion * 1000)).join(','); };
      const vis0 = N.rings.filter(m => m.visible).length; out.withOn = hearRun(true); out.withOff = hearRun(false); out.offDrawn = N.rings.filter(m => m.visible).length - 0;
      out.offLabels = MV.noiseLabels.els.filter(l => l.shown).length;
      N.cfg.debug = true; MV.forestOpts.sound = true;
      return out;
    });
    const o = r, ok = o.ring.at < 1e-6 && o.ring.dot < 1e-6 && Math.abs(o.ring.r - o.ring.radius) < 1e-9 && Math.abs(o.scale - o.ring.radius) < 1e-6 && o.ring.surf === 'grass'
      && o.label.indexOf('FOOTSTEP') === 0 && /— L\d — (GRASS|DIRT) — \d+\.\d m/.test(o.label) && o.labels === 4 && o.pool[0] === 12 && o.pool2[0] === 12 && o.pool2[1] === o.pool[1]
      && o.after[0] === 0 && o.after[1] === 0 && o.withOn === o.withOff && o.offLabels === 0 && page.errors.length === 0;
    return { pass: ok, detail: `a real footstep (L${o.ring.level} ${o.ring.surf}, ${o.ring.radius.toFixed(1)} m): ring and dot at its origin (${o.ring.at.toExponential(0)} m off), full size ${o.scale.toFixed(2)} m = its reach; label "${o.label}"; ${o.pool[0]} rings and ${o.labels} labels, still ${o.pool2[0]} after 40 more events (scene objects ${o.pool[1]} → ${o.pool2[1]}); after ${'its life'}: ${o.after[0]} rings, ${o.after[1]} labels showing; the same 5 events heard identically with it on and off ${o.withOn === o.withOff} (${o.withOn.split(' / ')[1]} suspicion), nothing drawn while off (${o.offLabels} labels); page errors ${page.errors.length}` };
  },

  // every assigned guard (the five, Guard D switched on for this) starts and stands clear of everything solid, with every
  // waypoint reachable (outside anything solid, a path to it from the previous one); after RESET at a phone-like
  // 30 fps each completes several full rounds with no stuck walk (moving without getting anywhere) and never inside
  // anything; a guard who's down doesn't patrol; Guard E stands beyond the safe start, and she isn't seen at it
  async forestLoops() {
    const page = await CHECKS._forestPage({ west: true });
    const r = await page.evaluate(() => {
      const out = {}, W = MV.world, recs = MV.levels.forest.recs;
      out.cfg = recs.map(r => { const g = r.g, pts = r.cfg.patrol.points; let reach = true;
        for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if (g.nav.inside(a) || (Math.hypot(a.x - b.x, a.z - b.z) > 0.1 && !g.nav.plan(a, b))) reach = false; }
        return { k: r.cfg.key, spawnIn: g.nav.inside({ x: r.cfg.x, z: r.cfg.z }), into: intrusion(g), reach }; });
      const E = G('E'); out.E = { at: [E.position.x, E.position.z], fromStart: Math.hypot(E.position.x - 0, E.position.z + 36.5) };
      // standing at the START for 20 s: nobody sees her
      let seen = 0; for (let i = 0; i < 60 * 20; i++) { sim(1); for (const g of MV.active) seen = Math.max(seen, g.vision.meter); } out.atStart = seen;
      // RESET, then 8 minutes at 30 fps, her out of everyone's way
      document.getElementById('mv-reset').click(); MV.motor.teleport(-26, -10, 0);
      const dt = 1 / 30, laps = {}, idx = {}, stuck = {}, worst = {}, last = {};
      for (let i = 0; i < 8 * 60 * 30; i++) {
        MV.tick(dt, true);
        for (const g of MV.active) {
          const k = g.levelKey, p = g.patrol; worst[k] = Math.max(worst[k] || 0, intrusion(g));
          if (idx[k] == null) idx[k] = p.index; if (p.index !== idx[k]) { if (p.index === 0) laps[k] = (laps[k] || 0) + 1; idx[k] = p.index; }
          const l = last[k] || (last[k] = { x: g.position.x, z: g.position.z, t: 0 });
          if (g.moving && Math.hypot(g.position.x - l.x, g.position.z - l.z) < 0.03) { l.t += dt; stuck[k] = Math.max(stuck[k] || 0, l.t); } else { l.t = 0; l.x = g.position.x; l.z = g.position.z; }
        }
      }
      out.laps = laps; out.stuck = stuck; out.worst = worst; out.states = MV.active.map(g => g.levelKey + g.awareness.state).join(' ');
      // down: Guard C knocked out mid-round doesn't patrol
      const C = G('C'); C.ko.knockOut({ position: C.position.clone(), along: new THREE.Vector3(1, 0, 0), by: C.position.clone().add(new THREE.Vector3(-1, 0, 0)) });
      const p0 = C.position.clone(), i0 = C.patrol.index; sim(60 * 10); out.down = { moved: xzd(C.position, p0), idx: C.patrol.index === i0, state: C.ko.state };
      return out;
    });
    const o = r, ok = o.cfg.length === 5 && o.cfg.every(c => !c.spawnIn && c.into === 0 && c.reach) && o.E.fromStart > 20 && o.atStart === 0
      && (o.laps.A || 0) >= 3 && (o.laps.B || 0) >= 2 && (o.laps.C || 0) >= 3 && (o.laps.D || 0) >= 3 && (o.laps.E || 0) >= 3
      && Object.values(o.stuck).every(v => v < 2) && Object.values(o.worst).every(v => v < 0.02) && /^(A|B|C|E|D)NORMAL/.test(o.states)
      && o.down.moved < 0.05 && o.down.idx && o.down.state !== 'CONSCIOUS' && page.errors.length === 0;
    return { pass: ok, detail: `assignments ${o.cfg.map(c => `${c.k}: inside ${c.spawnIn}, ${c.into.toFixed(2)} m into anything, waypoints reachable ${c.reach}`).join('; ')}; Guard E at (${o.E.at.join(', ')}), ${o.E.fromStart.toFixed(0)} m from the START; standing at the START 20 s: seen ${Math.round(o.atStart * 100)}% at most; after RESET, 8 min at 30 fps: full rounds ${Object.entries(o.laps).map(([k, v]) => k + ' ' + v).join(', ')}; longest walk without progress ${Object.entries(o.stuck).map(([k, v]) => k + ' ' + v.toFixed(1) + ' s').join(', ') || 'none'}; deepest into anything ${Math.max(0, ...Object.values(o.worst)).toFixed(3)} m; states ${o.states}; Guard C knocked out: moved ${o.down.moved.toFixed(2)} m in 10 s, same waypoint ${o.down.idx}, ${o.down.state}; page errors ${page.errors.length}` };
  },

  // the forest's vegetation after the correction: everything that's only looked at is instanced in map chunks that the
  // renderer culls (each chunk's bounds hold all its trees), the trees and rocks in play stay one always-tested mesh each
  // (every one stops bullets and sight, and her), the edge is still lined with trees all the way round; with patrol
  // debugging off no developer drawing is shown (none left at the origin), on it shows for the guards in play
  async forestVegetation() {
    const page = await CHECKS._forestPage();
    const r = await page.evaluate(() => {
      const F = MV.levels.forest, L = MV.SCmv.FOREST_OUTPOST, W = MV.world, out = {}, M = new THREE.Matrix4(), P = new THREE.Vector3();
      const insts = []; F.group.traverse(o => { if (o.isInstancedMesh) insts.push(o); });
      const chunks = insts.filter(o => o.frustumCulled), solid = insts.filter(o => !o.frustumCulled);
      let contained = true, edgeN = 0;
      for (const c of chunks) { const s = c.geometry.boundingSphere; for (let i = 0; i < c.count; i++) { c.getMatrixAt(i, M); P.setFromMatrixPosition(M); if (Math.hypot(P.x - s.center.x, P.z - s.center.z) > s.radius) contained = false; } if (c.material === chunks[0].material || c.userData.kind === 'tree') edgeN += 0; }
      out.chunks = chunks.length; out.contained = contained; out.solid = solid.map(o => `${o.userData.kind}:${o.count}`).join(',');
      out.inMeshes = solid.every(o => W.meshes.indexOf(o) >= 0) && chunks.every(o => W.meshes.indexOf(o) < 0);
      out.counts = F.area.counts;
      // every tree and rock in play: a bullet and a line of sight through it are stopped, and she can't stand in it
      const rc = new THREE.Raycaster(); let bullets = 0, sight = 0, body = 0;
      for (const [x, z, rr] of L.trees.concat(L.rocks.map(q => [q[0], q[1], q[2]]))) {
        rc.set(new THREE.Vector3(x - 4, 0.6, z), new THREE.Vector3(1, 0, 0)); rc.far = 8; const h = rc.intersectObjects(W.meshes, false)[0]; if (h && Math.abs(h.point.x - x) <= rr * 1.2 + 0.05) bullets++;
        if (W.segmentBlocked(new THREE.Vector3(x - 3, 0.6, z), new THREE.Vector3(x + 3, 0.6, z))) sight++;
        if (W.resolve(x + 0.05, z, 0.35).hit) body++;
      }
      out.inPlay = [L.trees.length + L.rocks.length, bullets, sight, body];
      // the edge: no long stretch of the boundary without a tree beside it
      const edgePts = []; for (const c of chunks) if (c.userData.kind === 'tree') for (let i = 0; i < c.count; i++) { c.getMatrixAt(i, M); P.setFromMatrixPosition(M); edgePts.push([P.x, P.z]); }
      const B = L.bounds; let worstGap = 0;
      for (let i = 0; i < B.length; i++) { const [ax, az] = B[i], [bx, bz] = B[(i + 1) % B.length], len = Math.hypot(bx - ax, bz - az);
        for (let t = 0; t <= len; t += 1) { const x = ax + (bx - ax) * t / len, z = az + (bz - az) * t / len; let d = 99; for (const [px, pz] of edgePts) d = Math.min(d, Math.hypot(px - x, pz - z)); worstGap = Math.max(worstGap, d); } }
      out.edgeGap = worstGap; out.edgeTrees = edgePts.length;
      // developer drawings: off by default in the forest, nothing of them showing; on with the option, for the guards in play
      const shown = () => { let n = 0, origin = 0; for (const r of F.recs) for (const v of [r.view.group, r.aware.group, r.route.group]) { let vis = v.visible; for (let q = v.parent; q; q = q.parent) vis = vis && q.visible; if (vis) n++; } F.group.traverse(o => { if ((o.isMesh || o.isLine) && !o.isInstancedMesh && o.parent !== F.group) { let vis = o.visible; for (let q = o.parent; q; q = q.parent) vis = vis && q.visible; const p = o.getWorldPosition(new THREE.Vector3()); if (vis && Math.hypot(p.x, p.z) < 0.5 && p.y < 0.5) origin++; } }); return [n, origin]; };
      sim(30); out.off = shown();
      document.getElementById('mv-opt-debug').click(); sim(30); out.on = shown();
      document.getElementById('mv-opt-debug').click(); sim(5); out.off2 = shown();
      return out;
    });
    const o = r, ok = o.chunks >= 4 && o.contained && o.solid === 'tree:21,rock:9' && o.inMeshes && o.inPlay[1] === o.inPlay[0] && o.inPlay[2] === o.inPlay[0] && o.inPlay[3] === o.inPlay[0]
      && o.edgeGap < 6 && o.edgeTrees >= 80 && o.off[0] === 0 && o.off[1] === 0 && o.on[0] === 3 * 4 && o.off2[0] === 0 && page.errors.length === 0;
    return { pass: ok, detail: `${o.chunks} culled chunks (each holding its trees ${o.contained}), always-tested meshes ${o.solid} (in the collision meshes ${o.inMeshes}); trees ${o.counts.trees}, rocks ${o.counts.rocks}, edge trees ${o.counts.edgeTrees}, edge rocks ${o.counts.edgeRocks}, bushes ${o.counts.bushes}; all ${o.inPlay[0]} trees and rocks in play stop a bullet ${o.inPlay[1]}, a line of sight ${o.inPlay[2]} and her ${o.inPlay[3]}; the edge never more than ${o.edgeGap.toFixed(1)} m from a tree (${o.edgeTrees} edge trees); developer drawings shown: off ${o.off[0]} (${o.off[1]} at the origin), with PATROL DEBUG ${o.on[0]} (3 for each of the 4 guards in play), off again ${o.off2[0]}; page errors ${page.errors.length}` };
  },

  // ---------------------------------------------------------------- Step 24: Level 01, the Forest Outpost
  // a stepped page with the forest loaded (from the START choice's own entry point)
  async _forestPage(opts) {
    const page = await simPage();
    await page.evaluate(o => {
      const dt = 1 / 60;
      window.sim = n => { for (let i = 0; i < n; i++) MV.tick(dt, true); };
      window.xzd = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      if (o && o.west) MV.forestOpts.west = true;
      MV.begin('forest');
      window.G = k => MV.levels.forest.recs.find(r => r.cfg.key === k).g;
      // walk her toward a point (the camera turned that way, the stick pushed), up to n frames; true when there
      window.walkTo = (x, z, push, n) => { const m = MV.motor; for (let i = 0; i < (n || 1200); i++) { const dx = x - m.position.x, dz = z - m.position.z; if (Math.hypot(dx, dz) < 0.6) { MV.input.move.y = 0; return true; } MV.cam.yaw = Math.atan2(-dx, -dz); MV.input.move.x = 0; MV.input.move.y = push == null ? 0.78 : push; MV.tick(dt, true); if (MV.level.complete) break; } MV.input.move.y = 0; return false; };
      window.intrusion = g => { const W = MV.world, R = g.cfg.radius; let w = 0; for (const b of W.boxes) { const dx = Math.max(b.minX - g.position.x, 0, g.position.x - b.maxX), dz = Math.max(b.minZ - g.position.z, 0, g.position.z - b.maxZ); w = Math.max(w, R - Math.hypot(dx, dz)); } for (const c of W.cylinders) if (!c.noSight) w = Math.max(w, c.r + R - Math.hypot(g.position.x - c.x, g.position.z - c.z)); return w; };
    }, opts || {});
    return page;
  },

  // the level choice through real touches: two levels on the START screen (both large enough to tap);
  // the forest loads with her at the southern trail and its objective; RESET restarts the forest; LEVELS
  // (shown while STATS is closed) goes back to the choice; the Test Lab loads exactly as before; going
  // back and forth duplicates nothing (systems, guards, listeners, scene objects)
  async levelMenu() {
    const out = [], fails = [];
    for (const [w, h] of [[844, 390], [667, 375]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
      await page.goto(base + '/movement.html'); await page.waitForSelector('#mv-start:not([hidden])', { timeout: 120000 });
      const menu = await page.evaluate(() => {
        const R = id => { const r = document.getElementById(id).getBoundingClientRect(); return { w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, in: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; };
        const a = R('mv-start'), b = R('mv-start-forest');
        const hit = id => { const r = R(id); return document.elementFromPoint(r.cx, r.cy).closest('#' + id) != null; };
        return { title: document.querySelector('#mv-loader .mv-title').textContent, lab: document.getElementById('mv-start').textContent, forest: document.getElementById('mv-start-forest').textContent, a, b, hits: hit('mv-start') && hit('mv-start-forest'), level: MV.level.id, playing: document.body.classList.contains('playing') };
      });
      const base0 = await page.evaluate(() => ({ listeners: MV.noise.listeners.length, children: MV.scene.children.length, active: MV.active.length, hud: document.querySelectorAll('.mv-caption, .mv-indicator, .mv-trait').length }));
      await page.tap('#mv-start-forest'); await page.waitForTimeout(600);
      const f1 = await page.evaluate(() => ({ statsOpen: !document.getElementById('mv-stats').hidden, level: MV.level.id, at: [MV.motor.position.x, MV.motor.position.z], objective: document.getElementById('mv-objective').textContent, shown: !document.getElementById('mv-objective').hidden, active: MV.active.map(g => g.levelKey).join(''), labHidden: !MV.levels.lab.group.visible, forestShown: MV.levels.forest.group.visible, input: MV.input.enabled, lvl: document.getElementById('mv-level') ? 'L01 FOREST OUTPOST cell' : '' }));   /* (its value fills in while STATS is expanded) */
      // walk a little, then RESET: still the forest, back at its start
      await page.evaluate(() => { MV.motor.teleport(5, -10, 0); });
      await page.tap('#mv-reset'); await page.waitForTimeout(300);
      const f2 = await page.evaluate(() => ({ level: MV.level.id, at: [MV.motor.position.x, MV.motor.position.z] }));
      // LEVELS: there while STATS is collapsed (as a level starts), hidden while it's expanded
      const m1 = await page.evaluate(() => getComputedStyle(document.getElementById('mv-menu')).display);
      await page.tap('#mv-stats-btn'); await page.waitForTimeout(200);
      const m0 = await page.evaluate(() => getComputedStyle(document.getElementById('mv-menu')).display);
      await page.tap('#mv-stats-btn'); await page.waitForTimeout(200);
      await page.tap('#mv-menu'); await page.waitForTimeout(500);
      const back = await page.evaluate(() => ({ menu: !document.getElementById('mv-loader').hidden && !document.getElementById('mv-loader').classList.contains('done'), input: MV.input.enabled, playing: document.body.classList.contains('playing') }));
      await page.tap('#mv-start'); await page.waitForTimeout(600);
      const lab = await page.evaluate(() => ({ level: MV.level.id, at: [MV.motor.position.x, MV.motor.position.z], spawn: [MV.area.spawn.x, MV.area.spawn.z], guards: MV.active[0] === MV.guard && MV.active[1] === MV.guard2 && MV.active.length === 2, labShown: MV.levels.lab.group.visible, forestHidden: !MV.levels.forest.group.visible, boxes: MV.world.boxes.length, bounds: MV.world.bounds, parked: MV.levels.forest.recs.every(r => r.g.parked), listeners: MV.noise.listeners.length, children: MV.scene.children.length, hud: document.querySelectorAll('.mv-caption, .mv-indicator, .mv-trait').length }));
      // back and forth three more times
      for (let k = 0; k < 3; k++) { await page.evaluate(() => { MV.toMenu(); MV.begin('forest'); MV.toMenu(); MV.begin('lab'); }); }
      const after = await page.evaluate(() => ({ listeners: MV.noise.listeners.length, children: MV.scene.children.length, active: MV.active.length, hud: document.querySelectorAll('.mv-caption, .mv-indicator, .mv-trait').length, recs: MV.levels.forest.recs.length, cqc: MV.cqc.guards === MV.active, aim: MV.aim.guards === MV.active, pistol: MV.pistol.guards === MV.active, eq: MV.equipment.ctx.guards === MV.active }));
      const r = { menu, base0, f1, f2, m0, m1, back, lab, after, errs: errs.length };
      const ok = menu.title === 'SHADOW CELL' && menu.lab === 'TEST LAB' && menu.forest === 'LEVEL 01 — FOREST OUTPOST' && menu.a.h >= 44 && menu.b.h >= 44 && menu.a.in && menu.b.in && menu.hits && menu.level === 'lab' && !menu.playing
        && f1.level === 'forest' && f1.at[1] < -30 && f1.objective === 'REACH THE NORTHERN EXIT' && f1.shown && !f1.statsOpen && f1.active === 'ABCE' && f1.labHidden && f1.forestShown && f1.input && /L01 FOREST OUTPOST/.test(f1.lvl)
        && f2.level === 'forest' && Math.abs(f2.at[0] - f1.at[0]) < 1e-6 && Math.abs(f2.at[1] - f1.at[1]) < 1e-6 && m0 === 'none' && m1 !== 'none' && back.menu && !back.input && !back.playing
        && lab.level === 'lab' && lab.at[0] === lab.spawn[0] && lab.at[1] === lab.spawn[1] && lab.guards && lab.labShown && lab.forestHidden && lab.bounds === null && lab.parked
        && lab.listeners === base0.listeners + 5 && lab.hud === base0.hud + 15 && after.listeners === lab.listeners && after.children === lab.children && after.active === 2 && after.hud === lab.hud && after.recs === 5 && after.cqc && after.aim && after.pistol && after.eq && errs.length === 0;
      if (!ok) fails.push(`${w}×${h}`);
      out.push(`${w}×${h}: START "${menu.title}": "${menu.lab}" ${Math.round(menu.a.w)}×${Math.round(menu.a.h)} px, "${menu.forest}" ${Math.round(menu.b.w)}×${Math.round(menu.b.h)} px, both on screen and taking the touch ${menu.hits}; forest: ${f1.level}, her at (${f1.at.map(v => v.toFixed(1)).join(', ')}), "${f1.objective}" shown ${f1.shown}, guards ${f1.active}, lab hidden ${f1.labHidden}; RESET → ${f2.level} at the same start ${f2.at[1] === f1.at[1]}; STATS collapsed at the start ${!f1.statsOpen}; LEVELS ${m1} with STATS collapsed, ${m0} expanded → the choice again (play off ${!back.input}); TEST LAB → ${lab.level} at its spawn ${lab.at[0] === lab.spawn[0]}, Guards 1 and 2 ${lab.guards}, ${lab.boxes} boxes, no bounds ${lab.bounds === null}, forest guards parked ${lab.parked}; after 3 more round trips: noise listeners ${base0.listeners} → ${lab.listeners} on the first forest load (its 5 guards) → ${after.listeners}, scene children ${lab.children} → ${after.children}, guard marks ${base0.hud} → ${lab.hud} → ${after.hud}, ${after.recs} forest guards, one shared guard list ${after.cqc && after.aim && after.pistol && after.eq}${errs.length ? '; errors ' + errs.join(';') : ''}`);
      await ctx.close();
    }
    return { pass: fails.length === 0, detail: out.join(' | ') };
  },

  // the forest's geometry: about 60 × 80 m inside an irregular rounded edge of trees and rocks (no wall
  // round it: nothing solid near its edge, and the edge keeps her in); the 22 × 22 m compound with its two
  // openings; tall blocks stop movement, sight and bullets; low cover stops a low line, not a high one;
  // trees and rocks are solid; she spawns on the southern trail; the END is reachable
  async forestLayout() {
    const page = await CHECKS._forestPage();
    const r = await page.evaluate(() => {
      const W = MV.world, L = MV.level.area, B = L.bounds, out = {}, V = (x, y, z) => new THREE.Vector3(x, y, z);
      const xs = B.map(p => p[0]), zs = B.map(p => p[1]);
      out.size = [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)]; out.vertices = B.length;
      // irregular and rounded: many distinct directions along the edge, not a rectangle
      const dirs = new Set(B.map((p, i) => { const q = B[(i + 1) % B.length]; return Math.round(Math.atan2(q[1] - p[1], q[0] - p[0]) * 57.3 / 10); })); out.dirs = dirs.size;
      // no perimeter wall: every box is a compound wall or a block well inside the edge, none longer than the compound's own walls
      out.boxes = W.boxes.length; out.longest = Math.max(...W.boxes.map(b => Math.max(b.maxX - b.minX, b.maxZ - b.minZ)));
      out.nearEdge = W.boxes.filter(b => !W.inBounds((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, 3)).length;
      const C = L.compound; out.compound = [C.maxX - C.minX, C.maxZ - C.minZ];
      out.spawn = [MV.motor.position.x, MV.motor.position.z, W.surfaceAt(MV.motor.position.x, MV.motor.position.z)];
      // the openings: a guard-wide way through each; the walls beside them block
      const nav = MV.active[0].nav;
      out.northOpen = nav.clear({ x: 1.75, z: 16 }, { x: 1.75, z: 11 }); out.southOpen = nav.clear({ x: 2.6, z: -11 }, { x: 2.6, z: -6 });
      out.walls = [nav.clear({ x: -5, z: 16 }, { x: -5, z: 11 }), nav.clear({ x: 9, z: -11 }, { x: 9, z: -6 }), nav.clear({ x: -12, z: 3 }, { x: -6, z: 3 }), nav.clear({ x: 16, z: 3 }, { x: 10, z: 1 })].some(Boolean);
      out.inside = nav.plan({ x: 2.6, z: -12 }, { x: 2, z: 3.5 }) != null;   // into the compound through the south opening
      // a tall block (the long northern one), a low log, a tree, a rock
      const rc = new THREE.Raycaster();
      const bullet = (o, d) => { rc.set(o, d.normalize()); rc.far = 30; const h = rc.intersectObjects(W.meshes, false)[0]; return h ? h.object.userData.kind : 'none'; };
      out.tall = { sight: W.segmentBlocked(V(1.95, 1.6, 12), V(1.95, 1.6, 3)), bullet: bullet(V(1.95, 1.4, 12), V(0, 0, -1)), push: W.resolve(1.95, 7.7, 0.35).hit };
      out.low = { low: W.segmentBlocked(V(-14.1, 0.5, 10), V(-14.1, 0.5, 4)), high: W.segmentBlocked(V(-14.1, 1.5, 10), V(-14.1, 1.5, 4)), bullet: bullet(V(-14.1, 0.5, 10), V(0, 0, -1)), over: bullet(V(-14.1, 1.6, 10), V(0, 0, -1)), push: W.resolve(-14.1, 6.9, 0.35).hit };
      out.tree = { sight: W.segmentBlocked(V(-12, 1.5, 13), V(-12, 1.5, 8)), bullet: bullet(V(-12, 1.4, 13), V(0, 0, -1)), push: W.resolve(-12, 10.65, 0.35) };
      out.rock = { sight: W.segmentBlocked(V(-3.5, 1.5, -20), V(-3.5, 1.5, -14)), bullet: bullet(V(-3.5, 1.2, -20), V(0, 0, 1)) };
      // she walks into a tree trunk and the rock: stopped at their surfaces
      MV.motor.teleport(-12, 13, Math.PI); MV.cam.snap(MV.motor); walkTo(-12, 9, 1, 180); out.treeStop = MV.motor.position.z;
      // the edge keeps her in: pushing out for 3 s at four places
      out.edge = [[-29, 7, -40, 7], [29, 1, 40, 1], [0, -38, 0, -60], [-25, 22, -40, 40]].map(([x, z, tx, tz]) => { MV.motor.teleport(x, z, 0); MV.cam.snap(MV.motor); walkTo(tx, tz, 1, 180); return W.inBounds(MV.motor.position.x, MV.motor.position.z, 0.3); });
      // the END is reachable: a guard-wide path from the spawn to it
      const pl = nav.plan({ x: 0, z: -36.5 }, { x: -3.75, z: 38 }); out.exitPath = pl ? pl.length : null;
      out.surfaces = [W.surfaceAt(10, 25), W.surfaceAt(0, -30), W.surfaceAt(2, 3)];
      document.getElementById('mv-reset').click(); sim(2);
      return out;
    });
    const o = r, ok = o.size[0] >= 55 && o.size[0] <= 65 && o.size[1] >= 75 && o.size[1] <= 85 && o.vertices >= 30 && o.dirs >= 12 && o.longest <= 22.5 && o.nearEdge === 0
      && Math.abs(o.compound[0] - 22) < 0.5 && Math.abs(o.compound[1] - 22) < 0.5 && o.spawn[1] < -30 && o.spawn[2] === 'dirt'
      && o.northOpen && o.southOpen && !o.walls && o.inside && o.tall.sight && o.tall.bullet === 'crate' && o.tall.push
      && o.low.low && !o.low.high && o.low.bullet === 'log' && o.over !== 'log' && o.low.over !== 'log' && o.low.push
      && o.tree.sight && o.tree.bullet === 'tree' && o.tree.push.hit && o.rock.sight && o.rock.bullet === 'rock' && o.treeStop > 10.5 + 0.34 + 0.3 && o.edge.every(Boolean) && o.exitPath != null
      && o.surfaces.join() === 'grass,dirt,concrete' && page.errors.length === 0;
    return { pass: ok, detail: `forest ${o.size.map(v => v.toFixed(0)).join(' × ')} m inside a ${o.vertices}-point edge (${o.dirs} edge directions: rounded, irregular); ${o.boxes} boxes, longest ${o.longest.toFixed(1)} m, none at the edge (no perimeter wall); compound ${o.compound.join(' × ')} m; spawn (${o.spawn[0]}, ${o.spawn[1]}) on ${o.spawn[2]}; openings north ${o.northOpen} / south ${o.southOpen}, walls beside them and round it block ${!o.walls}, a path in through the south ${o.inside}; tall block: sight ${o.tall.sight}, bullet → ${o.tall.bullet}, solid ${o.tall.push}; log: 0.5 m line blocked ${o.low.low}, 1.5 m clear ${!o.low.high}, low bullet → ${o.low.bullet}, high bullet → ${o.low.over}, solid ${o.low.push}; tree: sight ${o.tree.sight}, bullet → ${o.tree.bullet}, walked into it: stopped at z ${o.treeStop.toFixed(2)}; rock: sight ${o.rock.sight}, bullet → ${o.rock.bullet}; pushing out at the edge for 3 s: still inside ${o.edge.join('/')}; a path from the spawn to the END: ${o.exitPath} legs; ground: grass / trail dirt / compound concrete ${o.surfaces.join(', ')}; page errors ${page.errors.length}` };
  },

  // the guards: four assignments (one per guard, not one per drawn marker), three on; each at his place,
  // each on his own routine (the lookouts turning through their facings, Guard B round his loop, Guard C
  // round the compound), stopping at their observation points for about their pauses, moving on after, never
  // into anything solid, never in step with each other; Guard D configured but off (hidden, deaf, not in the way)
  async forestGuards() {
    const page = await CHECKS._forestPage();
    const r = await page.evaluate(() => {
      const F = MV.levels.forest, out = {}, recs = F.recs;
      out.recs = recs.map(r => `${r.cfg.key}:${r.cfg.enabled}:${r.cfg.role}`).join(' ');
      out.active = MV.active.map(g => g.levelKey).join('');
      out.at = MV.active.map(g => [g.levelKey, g.position.x, g.position.z, Math.round(g.yaw * 57.3)]);
      const D = recs.find(r => r.cfg.key === 'D').g; out.D = { parked: D.parked, shown: D.root.visible, collider: D.collider.x, inActive: MV.active.indexOf(D) >= 0, pts: D.patrol.cfg.points.length };
      // three minutes of their routines
      const stops = { A: [], B: [], C: [], E: [] }, near = { B: [], C: [], E: [] }, cur = {}, worst = {}, facings = { A: new Set() };
      for (const k of ['B', 'C', 'E']) near[k] = G(k).patrol.cfg.points.map(() => 99);
      for (let i = 0; i < 60 * 180; i++) {
        sim(1); const t = i / 60;
        for (const g of MV.active) {
          const k = g.levelKey, p = g.patrol, obs = p.state === 'observing';
          worst[k] = Math.max(worst[k] || 0, intrusion(g));
          // (a stop ends when he leaves it, or, for a lookout who goes straight from one facing to the next, when his waypoint changes)
          if (cur[k] && (!obs || p.index !== cur[k].i)) { stops[k].push({ i: cur[k].i, dur: t - cur[k].t, start: cur[k].t }); cur[k] = null; }
          if (obs && !cur[k]) cur[k] = { i: p.index, t };
          if (near[k]) p.cfg.points.forEach((q, j) => { near[k][j] = Math.min(near[k][j], Math.hypot(q.x - g.position.x, q.z - g.position.z)); });
          if (k === 'A' && obs && g.isStill()) facings.A.add(Math.round(((g.yaw * 57.3) % 360 + 360) % 360 / 45) * 45 % 360);
        }
      }
      const d = k => stops[k].map(s => s.dur);
      out.stops = { A: stops.A.length, B: stops.B.map(s => s.i).join(''), C: stops.C.map(s => s.i).join(''), E: stops.E.map(s => s.i).join('') };
      out.dur = { A: [Math.min(...d('A')), Math.max(...d('A'))], B: [Math.min(...d('B')), Math.max(...d('B'))], C: [Math.min(...d('C')), Math.max(...d('C'))], E: [Math.min(...d('E')), Math.max(...d('E'))] };
      out.near = { B: Math.max(...near.B), C: Math.max(...near.C), E: Math.max(...near.E) };
      out.facings = [...facings.A].sort((a, b) => a - b).join(',');
      out.worst = worst; out.stillA = Math.hypot(G('A').position.x + 4, G('A').position.z - 22.7);
      // not in step: the moments each began a stop, compared between guards
      const starts = k => stops[k].map(s => s.start); let sync = 0, pairs = 0;
      for (const [a, b] of [['A', 'B'], ['A', 'C'], ['B', 'C'], ['A', 'E'], ['B', 'E'], ['C', 'E']]) for (const t of starts(a)) { pairs++; if (starts(b).some(u => Math.abs(u - t) < 0.1)) sync++; }
      out.sync = [sync, pairs];
      out.states = MV.active.map(g => g.awareness.state).join(','); out.why = MV.active.map(g => g.patrol.why).filter(Boolean);
      out.D2 = { parked: D.parked, at: [D.position.x, D.position.z], meter: D.vision.meter, heard: D.hearing.heardCount };
      return out;
    });
    const o = r, ok = o.recs === 'A:true:lookout B:true:patrol C:true:patrol E:true:patrol D:false:lookout' && o.active === 'ABCE'
      && Math.hypot(o.at[3][1] + 8, o.at[3][2] + 14) < 0.01 && /0202/.test(o.stops.E)   // (Step 24.2 routes: E a four-point loop stopping at W0 / W2, was 0101; B six points from (18.5, 13) stopping at W0 / W2 / W3, was (17.6, 15.5) and 0404)
      && o.near.E < 0.6 && o.dur.E[0] >= 2.4
      && Math.hypot(o.at[0][1] + 4, o.at[0][2] - 22.7) < 0.01 && Math.hypot(o.at[1][1] - 18.5, o.at[1][2] - 13) < 0.01 && Math.hypot(o.at[2][1] + 3.1, o.at[2][2] - 10.2) < 0.01
      && o.D.parked && !o.D.shown && o.D.collider > 1e5 && !o.D.inActive && o.D.pts === 4
      && o.stops.A >= 20 && /023023/.test(o.stops.B) && /0123/.test(o.stops.C) && o.near.B < 1.3 && o.near.C < 0.6 && o.stillA < 0.05 && /135/.test(o.facings) && /180/.test(o.facings) && /225/.test(o.facings)
      && o.dur.A[0] >= 2.9 && o.dur.A[1] <= 4 * 1.25 + 2.5 + 3 && o.dur.B[0] >= 1.9 && o.dur.C[0] >= 0.9 && o.dur.C[1] <= 2 * 1.25 + 2.5 + 3
      && Object.values(o.worst).every(v => v < 0.02) && o.sync[0] <= o.sync[1] * 0.1 && o.states === 'NORMAL,NORMAL,NORMAL,NORMAL' && o.why.length === 0 && o.D2.parked && o.D2.meter === 0 && o.D2.heard === 0 && page.errors.length === 0;
    return { pass: ok, detail: `assignments ${o.recs}; on: ${o.active}; at A (${o.at[0][1]}, ${o.at[0][2]}) ${o.at[0][3]}°, B (${o.at[1][1]}, ${o.at[1][2]}), C (${o.at[2][1]}, ${o.at[2][2]}); Guard D configured (${o.D.pts} facings), off: parked ${o.D.parked}, hidden ${!o.D.shown}, out of the way ${o.D.collider > 1e5}; in 3 min: A ${o.stops.A} stops facing ${o.facings}° (stays at his post: ${o.stillA.toFixed(3)} m), B stops at ${o.stops.B} (every loop point within ${o.near.B.toFixed(2)} m), C stops at ${o.stops.C} (corners within ${o.near.C.toFixed(2)} m), E (${o.at[3][1]}, ${o.at[3][2]}) stops at ${o.stops.E} (within ${o.near.E.toFixed(2)} m); stop lengths A ${o.dur.A.map(v => v.toFixed(1)).join('–')} s, B ${o.dur.B.map(v => v.toFixed(1)).join('–')} s, C ${o.dur.C.map(v => v.toFixed(1)).join('–')} s, E ${o.dur.E.map(v => v.toFixed(1)).join('–')} s (configured 3–4 / 2–3 / 1–2 / 2.5–3.5, plus the guards' own personalities); deepest into anything solid ${Math.max(...Object.values(o.worst)).toFixed(3)} m; stops begun within 0.1 s of another guard's: ${o.sync[0]} of ${o.sync[1]}; still ${o.states}, no unreachable waypoints ${o.why.length === 0}; Guard D still parked, saw ${o.D2.meter}, heard ${o.D2.heard}; page errors ${page.errors.length}` };
  },

  // their patrols give way to what they legitimately notice and pick up again after: a magazine's clatter
  // near Guard B (investigated where it landed, then back on his loop); being seen by Guard C (ALERT, then
  // searching once she's gone, then back round the compound); each guard on his own (the others carry on)
  async forestResponse() {
    const page = await CHECKS._forestPage();
    const r = await page.evaluate(() => {
      const B = G('B'), C = G('C'), A = G('A'), out = {}, m = MV.motor, it = MV.equipment.item().ctl;
      // a magazine into Guard B's loop from the eastern trail, behind his back while he looks south from the loop's south end
      const hide = () => { m.teleport(-26, -10, 0); MV.cam.snap(m); };   // (out of every guard's range and sight)
      hide(); for (let i = 0; i < 60 * 60 && !(B.patrol.state === 'observing' && B.patrol.index === 3 && B.isStill()); i++) sim(1);   // (Step 24.2: his six-point loop's south stop is W3; it was W4)
      m.teleport(24.5, 12, Math.PI); MV.cam.snap(m); MV.cam.pitch = 0.2; sim(2);
      MV.input.useTapped = true; sim(14); for (let i = 0; i < 360 && !it.impact; i++) sim(1);
      const I = it.impact.point.clone(); hide();
      const seq = [], othersA = []; let near = 99, resumed = null, back = null;
      for (let i = 0; i < 60 * 80; i++) {
        sim(1); const a = B.awareness;
        if (seq[seq.length - 1] !== a.state) seq.push(a.state);
        if (a.state === 'INVESTIGATING') near = Math.min(near, xzd(B.position, I));
        if (back == null && seq.indexOf('INVESTIGATING') >= 0 && a.state === 'NORMAL') back = i / 60;
        if (back != null && resumed == null && B.patrol.state !== 'interrupted' && B.patrol.resumes > 0 && B.moving) resumed = i / 60;
        if (i % 60 === 0) othersA.push(A.awareness.state + C.awareness.state);
        if (resumed != null && i / 60 > resumed + 3) break;
      }
      out.B = { heard: B.hearing.heard && B.hearing.heard.type, seq: seq.join('→'), near, back, resumed, patrol: B.patrol.status(), conf: B.awareness.confirmed, others: othersA.every(s => s === 'NORMALNORMAL') };
      // seen by Guard C inside the compound: ALERT, then gone: search, then back to his round
      document.getElementById('mv-reset').click(); sim(5);
      m.teleport(-3.1, 13, Math.PI); MV.cam.snap(m); for (let i = 0; i < 60 * 5 && !C.awareness.confirmed; i++) sim(1);
      out.C0 = { state: C.awareness.state, conf: C.awareness.confirmed };
      hide();
      const seq2 = []; let rejoin = null;
      for (let i = 0; i < 60 * 240; i++) {
        sim(1); const s = C.awareness.state; if (seq2[seq2.length - 1] !== s) seq2.push(s);
        if (rejoin == null && s === 'NORMAL' && C.patrol.state !== 'interrupted' && seq2.length > 2) rejoin = i / 60;
        if (rejoin != null && i / 60 > rejoin + 15) break;
      }
      let worst = 0; for (let i = 0; i < 60 * 10; i++) { sim(1); worst = Math.max(worst, intrusion(C)); }
      out.C = { seq: seq2.join('→'), rejoin, patrol: C.patrol.status(), moving: C.moving || C.patrol.state === 'observing', inside: C.position.x > -9 && C.position.x < 13 && C.position.z > -8 && C.position.z < 14, worst };
      return out;
    });
    const o = r, ok = o.B.heard === 'clatter' && /INVESTIGATING/.test(o.B.seq) && o.B.near < 3 && o.B.back != null && o.B.resumed != null && !o.B.conf && o.B.others
      && o.C0.conf && o.C0.state === 'ALERT' && /EVASION/.test(o.C.seq) && o.C.rejoin != null && o.C.moving && o.C.inside && o.C.worst < 0.02 && page.errors.length === 0;
    return { pass: ok, detail: `a magazine into Guard B's loop: heard ${o.B.heard}, ${o.B.seq}, came within ${o.B.near.toFixed(1)} m of where it landed, calm after ${o.B.back != null ? o.B.back.toFixed(0) + ' s' : 'NEVER'}, back on his loop after ${o.B.resumed != null ? o.B.resumed.toFixed(0) + ' s' : 'NEVER'} (${o.B.patrol}), never saw her ${!o.B.conf}; A and C carried on ${o.B.others}; Guard C seeing her: ${o.C0.state}; she leaves: ${o.C.seq}, back on his round after ${o.C.rejoin != null ? o.C.rejoin.toFixed(0) + ' s' : 'NEVER'} (${o.C.patrol}), in the compound ${o.C.inside}, never into anything solid (${o.C.worst.toFixed(3)} m); page errors ${page.errors.length}` };
  },

  // the forest plays like the lab: her speeds on grass and dirt, footsteps and their reach by surface,
  // crouching; guards see over low cover only what shows above it (Guard D, switched on for this, watching
  // the log she's behind), never through a tree; the Empty Magazine and CQC (a grab, THROW) work here
  async forestPlay() {
    const page = await CHECKS._forestPage({ west: true });
    const r = await page.evaluate(() => {
      const m = MV.motor, out = {}, D = G('D'), C = G('C'), ev = []; MV.noise.on(e => { if (e.source === 'player') ev.push(e); });
      out.active = MV.active.map(g => g.levelKey).join('');
      // jog on the grass and on the trail
      const speed = (x, z, push) => { m.teleport(x, z, 0); MV.cam.snap(m); MV.input.move.y = push; let s = 0; sim(60); ev.length = 0; for (let i = 0; i < 90; i++) { sim(1); s += m.speed; } const st = ev.map(e => e.surface + ':' + e.radius.toFixed(1)); MV.input.move.y = 0; sim(60); return { v: s / 90, surf: st[st.length - 1], steps: st.length }; };   /* (the steps taken at that pace) */
      out.grass = speed(-20, 11, 1); out.dirt = speed(0, -38, 1);
      MV.input.setCrouch(true); out.crouch = speed(20, -20, 1); MV.input.setCrouch(false); sim(30);
      // Guard D watching the low log (−14.1, 6.9) from 8 m: she's behind it, crouched, then standing
      const P = D.patrol; P.enabled = false; D.motor.teleport(-14.1, 14.9, Math.PI); D.wantYaw = Math.PI; D.awareness.reset(); sim(30);
      const watch = (stance) => { MV.input.setCrouch(stance === 'crouch'); m.teleport(-14.1, 6.2, Math.PI); MV.cam.snap(m); sim(45); D.awareness.reset(); D.vision.meter = 0; let mx = 0, exp = 0;   /* (once she's settled in the stance) */ for (let i = 0; i < 90; i++) { sim(1); mx = Math.max(mx, D.vision.meter); exp = Math.max(exp, D.vision.seen.exposure || 0); } return { meter: mx, exp }; };
      out.crouched = watch('crouch'); D.awareness.reset(); D.vision.meter = 0; sim(10); out.standing = watch('stand'); MV.input.setCrouch(false);
      // behind a tree trunk from him: (−12, 10.5) between
      D.awareness.reset(); D.motor.teleport(-12, 14.5, Math.PI); D.wantYaw = Math.PI; sim(30); m.teleport(-12, 9.6, 0); MV.cam.snap(m); sim(15); D.vision.meter = 0; let tm = 0; for (let i = 0; i < 60; i++) { sim(1); tm = Math.max(tm, D.vision.seen.exposure || 0); }
      out.tree = tm;
      // a grab and a THROW on Guard C, from behind
      document.getElementById('mv-reset').click(); sim(5);
      for (let i = 0; i < 600 && !(C.patrol.state === 'walking' && C.position.z > 9.9 && C.position.x > 0); i++) sim(1);
      const b = C.position.clone().addScaledVector(C.forward(), -1.0); m.teleport(b.x, b.z, C.yaw); MV.cam.snap(m); sim(2);
      MV.input.cqcTapped = true; sim(40); out.grab = MV.cqc.state;
      MV.input.throwTapped = true; const seen = new Set(); for (let i = 0; i < 200; i++) { sim(1); seen.add(MV.cqc.state); }
      out.thrown = [...seen].join('→'); out.ko = C.ko.state;
      return out;
    });
    const o = r, ok = o.active === 'ABCED' && o.grass.v > 3 && Math.abs(o.grass.v - o.dirt.v) < 0.15 && /^grass:8\.5/.test(o.grass.surf) && /^dirt:14\.0/.test(o.dirt.surf) && o.crouch.v < o.grass.v * 0.8
      && o.crouched.meter < 0.05 && o.standing.meter > 0.3 && o.standing.exp > o.crouched.exp && o.tree < 0.5 && o.grab === 'GRAPPLING' && /THROWING/.test(o.thrown) && o.ko !== 'CONSCIOUS' && page.errors.length === 0;
    return { pass: ok, detail: `Guard D switched on: ${o.active}; jog on grass ${o.grass.v.toFixed(2)} m/s (steps ${o.grass.surf} m), on the trail ${o.dirt.v.toFixed(2)} m/s (${o.dirt.surf} m), crouched ${o.crouch.v.toFixed(2)} m/s; Guard D 8 m off the log: crouched behind it ${Math.round(o.crouched.meter * 100)}% seen (${Math.round(o.crouched.exp * 100)}% showing), standing ${Math.round(o.standing.meter * 100)}% (${Math.round(o.standing.exp * 100)}% showing); behind a tree trunk ${Math.round(o.tree * 100)}% showing; Guard C from behind: ${o.grab} → THROW ${o.thrown}, he's ${o.ko}; page errors ${page.errors.length}` };
  },

  // gunfire in the forest: a guard who sees her fires and hits; a tree trunk between them takes the bullets;
  // her pistol hurts him (35); her defeat, and RESET restores the forest (her, the guards, the level)
  async forestCombat() {
    const page = await CHECKS._forestPage();
    await page.evaluate(() => { window.__combat = true; });
    const r = await page.evaluate(() => {
      const m = MV.motor, B = G('B'), P = MV.playerHealth, out = {}, shots = [];
      const f = B.gunfire.fire.bind(B.gunfire); B.gunfire.fire = cf => { const s = f(cf); if (s) shots.push({ kind: s.kind, what: s.what }); return s; };
      // in plain view of Guard B (held still at the south end of his loop, facing south)
      B.patrol.enabled = false; B.motor.teleport(20, -5, Math.PI); B.post.set(20, 0, -5); B.postYaw = Math.PI; B.reset(); B.patrol.enabled = false;
      m.teleport(20, -12, 0); MV.cam.snap(m);
      for (let i = 0; i < 60 * 8; i++) { sim(1); if (P.current < 40) { P.current = 100; P.state = 'OK'; } }
      out.open = { shots: shots.length, hits: shots.filter(s => s.kind === 'player').length, state: B.awareness.state, w: B.weapon.state };
      // behind the trunk at (20, −15.5): she steps behind it
      shots.length = 0; m.teleport(20, -16.6, 0); MV.cam.snap(m); P.current = 100; P.state = 'OK';
      for (let i = 0; i < 60 * 4; i++) { sim(1); if (P.current < 40) { P.current = 100; P.state = 'OK'; } }
      out.cover = { shots: shots.length, hits: shots.filter(s => s.kind === 'player').length, tree: shots.filter(s => s.what === 'tree').length };
      // her pistol at him
      m.teleport(B.position.x, B.position.z - 4, 0); MV.cam.snap(m); MV.cam.pitch = 0.05; MV.aim.toggle(true); sim(45);   // (4 m from wherever he is now, facing him)
      const hp0 = B.health.current; let k = 0; while (B.health.current === hp0 && k < 10) { MV.input._firePress(performance.now()); sim(20); k++; }
      out.pistol = [hp0, B.health.current];
      MV.aim.toggle(false); sim(10);
      // defeated, then RESET
      P.take({ amount: 100, source: 'test', id: 'f1' }); sim(90); out.down = [P.state, P.frozen()];
      document.getElementById('mv-reset').click(); sim(10);
      out.reset = { level: MV.level.id, hp: P.current, state: P.state, at: [m.position.x, m.position.z], guards: MV.active.map(g => `${g.levelKey}${g.health.current}${g.awareness.state}`).join(' '), B: [B.position.x, B.position.z] };
      return out;
    });
    const o = r, ok = o.open.shots >= 2 && o.open.hits >= 1 && o.open.state === 'ALERT' && o.open.w === 'READY' && o.cover.hits === 0 && o.pistol[0] - o.pistol[1] === 35
      && o.down[0] === 'PLAYER_DEFEATED' && o.down[1] && o.reset.level === 'forest' && o.reset.hp === 100 && o.reset.state === 'OK' && o.reset.at[1] < -30 && /A100NORMAL B100NORMAL C100NORMAL/.test(o.reset.guards) && page.errors.length === 0;
    return { pass: ok, detail: `in Guard B's view at 7 m: ${o.open.state}, pistol ${o.open.w}, ${o.open.shots} shots, ${o.open.hits} hits; behind a tree trunk: ${o.cover.shots} shots, ${o.cover.hits} hits (${o.cover.tree} into the tree); her pistol: ${o.pistol[0]} → ${o.pistol[1]} HP; at 0 HP ${o.down[0]} (collapsed ${o.down[1]}); RESET → ${o.reset.level}, ${o.reset.hp} HP ${o.reset.state}, at (${o.reset.at.map(v => v.toFixed(1)).join(', ')}), guards ${o.reset.guards}; page errors ${page.errors.length}` };
  },

  // a stealth way to the END, walked by a careful player with every default guard on his routine:
  // up the trail, round the west of the compound (beyond the north lookout's sight while he can face
  // that way), behind the rock north-west of him, and onto the north trail only once he's turned south
  // (watching his facing, as a player would). Nobody ever confirms her; nobody is touched. Reaching the
  // END: LEVEL COMPLETE once (standing in it doesn't repeat it); REPLAY plays again; the Test Lab after
  async forestStealth() {
    const page = await CHECKS._forestPage();
    const r = await page.evaluate(() => {
      const m = MV.motor, A = G('A'), out = { log: [] }, seenMax = {};
      const watch = () => { for (const g of MV.active) seenMax[g.levelKey] = Math.max(seenMax[g.levelKey] || 0, g.vision.meter); };
      const go = (x, z, push) => { const ok = (() => { for (let i = 0; i < 2400; i++) { const dx = x - m.position.x, dz = z - m.position.z; if (Math.hypot(dx, dz) < 0.6) return true; MV.cam.yaw = Math.atan2(-dx, -dz); MV.input.move.x = 0; MV.input.move.y = push; MV.tick(1 / 60, true); watch(); if (MV.level.complete) return true; } return false; })(); MV.input.move.y = 0; out.log.push(`(${x}, ${z}) ${ok}`); return ok; };
      const facingSouth = () => { const y = ((A.yaw * 57.3) % 360 + 360) % 360, o = A.patrol.obs, ly = o ? (((o.looks[o.i] * 57.3) % 360) + 360) % 360 : y; return y > 110 && y < 200 && ly > 110 && ly < 200 && A.isStill() && o && o.hold - o.heldFor > 1.2; };
      const wait = (cond, n) => { for (let i = 0; i < n; i++) { if (cond()) return i; MV.tick(1 / 60, true); watch(); } return -1; };
      let ok = true;
      // Step 24.1: the south entrance guard: out of his reach on the trail (≥ 17 m from both his stops), wait until he's
      // just set off east (his back to the west), then out of the trail's mouth and away west before he turns
      const E = G('E'); ok = go(0, -30, 0.78);
      out.waitE = wait(() => E.patrol.state === 'walking' && E.patrol.index === 1 && E.position.x < -5, 60 * 60);
      for (const [x, z, p] of [[0, -24, 0.78], [-6, -19, 0.78], [-16, -14, 0.78], [-24, -6, 0.78], [-26.4, -1, 0.78], [-25, 10, 0.78], [-24.5, 18, 0.5], [-22, 24.6, 0.5]]) ok = ok && go(x, z, p);
      // out of his range (≥ 16.5 m): wait for him to face south, then to the rock
      out.dist1 = Math.hypot(m.position.x - A.position.x, m.position.z - A.position.z);
      out.wait1 = wait(facingSouth, 60 * 40); ok = ok && go(-14, 27.9, 0.5);
      MV.input.setCrouch(true); sim(20);
      out.wait2 = wait(facingSouth, 60 * 40); MV.input.setCrouch(false); sim(10);
      ok = ok && go(-7.2, 29.2, 0.5) && go(-4.5, 31.5, 0.5) && go(-4, 38.5, 0.78);
      out.ok = ok; out.done = MV.level.complete; out.completions = MV.level.completions; out.seen = seenMax; out.confirmed = MV.active.filter(g => g.awareness.confirmed).map(g => g.levelKey);
      out.guards = MV.active.map(g => `${g.levelKey} ${g.awareness.state} ${g.health.current} ${g.ko.state}`).join(', ');
      out.screen = !document.getElementById('mv-complete').hidden && document.getElementById('mv-complete').textContent.indexOf('LEVEL COMPLETE') >= 0;
      // standing in the END: no second completion
      for (let i = 0; i < 120; i++) MV.tick(1 / 60, true); out.again = MV.level.completions;
      // REPLAY
      document.getElementById('mv-replay').click(); sim(5);
      out.replay = { level: MV.level.id, complete: MV.level.complete, at: [m.position.x, m.position.z], input: MV.input.enabled, screen: document.getElementById('mv-complete').hidden };
      m.teleport(-4, 38, 0); sim(2); out.second = MV.level.completions;
      // the Test Lab afterwards
      document.getElementById('mv-to-menu').click(); MV.begin('lab'); sim(10);
      out.lab = { level: MV.level.id, guards: MV.active.length, g1: MV.guard.awareness.state, at: [m.position.x, m.position.z] };
      return out;
    });
    const o = r, ok = o.waitE >= 0 && o.ok && o.done && o.completions === 1 && o.confirmed.length === 0 && Object.values(o.seen).every(v => v < 1) && o.screen && o.again === 1
      && o.replay.level === 'forest' && !o.replay.complete && o.replay.at[1] < -30 && o.replay.input && o.replay.screen && o.second === 2 && o.lab.level === 'lab' && o.lab.guards === 2 && page.errors.length === 0;
    return { pass: ok, detail: `waited ${(o.waitE / 60).toFixed(1)} s on the trail for Guard E to set off east; route ${o.log.join(' → ')}; ${o.dist1.toFixed(1)} m from the north lookout, waited ${(o.wait1 / 60).toFixed(1)} s for him to face south, then ${(o.wait2 / 60).toFixed(1)} s behind the rock; END reached ${o.done}, LEVEL COMPLETE shown ${o.screen}, completions ${o.completions} (after 2 s more in it: ${o.again}); most any guard saw of her: ${Object.entries(o.seen).map(([k, v]) => k + ' ' + Math.round(v * 100) + '%').join(', ')}, confirmed by ${o.confirmed.join(',') || 'nobody'}; guards after: ${o.guards}; REPLAY → ${o.replay.level} at the start (${o.replay.at.map(v => v.toFixed(1)).join(', ')}), playing ${o.replay.input}; reached again → completions ${o.second}; Test Lab after: ${o.lab.level}, ${o.lab.guards} guards, Guard 1 ${o.lab.g1}; page errors ${page.errors.length}` };
  },

  // cost: a frame's simulation with three and with four guards (headless, no drawing), drawn frames, and
  // draw calls; the Test Lab for comparison; magazines thrown one after another never pile up
  async forestPerf() {
    const page = await CHECKS._forestPage();
    // frames actually drawn per second by a live frame loop (headless software rendering: noisy, a comparison only)
    const fps = ms => page.evaluate(ms => new Promise(res => { let n = 0, last = performance.now(); const t0 = last; const f = () => { const t = performance.now(); MV.tick(Math.min(0.05, (t - last) / 1000)); last = t; n++; if (t - t0 < ms) requestAnimationFrame(f); else res({ fps: n / ((t - t0) / 1000), calls: MV.renderer.info.render.calls, tris: MV.renderer.info.render.triangles }); }; requestAnimationFrame(f); }), ms);
    const setup = (west, lab) => page.evaluate(([west, lab]) => { MV.forestOpts.west = west; MV.toMenu(); MV.begin(lab ? 'lab' : 'forest'); if (!lab) { MV.motor.teleport(2, -15, 0); MV.cam.snap(MV.motor); } }, [west, lab]);
    const simMs = () => page.evaluate(() => { sim(60); const t0 = performance.now(); sim(600); return (performance.now() - t0) / 600; });
    const runs = { f3: [], f4: [], lab: [] }, sims = { f3: [], f4: [], lab: [] };   // (Step 24.1: f3 = the default four guards, f4 = all five)
    for (let k = 0; k < 2; k++) for (const [key, west, lab] of [['f3', false, false], ['f4', true, false], ['lab', false, true]]) { await setup(west, lab); sims[key].push(await simMs()); runs[key].push(await fps(2500)); }
    const r = await page.evaluate(() => {
      MV.forestOpts.west = false; MV.toMenu(); MV.begin('forest'); const m = MV.motor; m.teleport(0, -30, 0); MV.cam.snap(m); MV.cam.pitch = 0.2;
      const it = MV.equipment.item().ctl; let maxShown = 0;
      for (let k = 0; k < 5; k++) { for (let i = 0; i < 400 && (it.cooldown > 0 || it.busy()); i++) sim(1); MV.input.useTapped = true; for (let i = 0; i < 200; i++) { sim(1); maxShown = Math.max(maxShown, MV.scene.children.filter(o => o.name === 'empty-magazine' && o.visible).length); } }
      return { throws: it.throws, shown: maxShown, meshes: MV.scene.children.filter(o => o.name === 'empty-magazine').length, active: MV.active.length };
    });
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length, f = k => `${avg(sims[k]).toFixed(2)} ms simulated, ${runs[k].map(x => x.fps.toFixed(0)).join('/')} fps drawn (${runs[k][0].calls} draws, ${Math.round(runs[k][0].tris / 1000)}k triangles)`;
    const ok = avg(sims.f3) < 4 && avg(sims.f4) < 5 && r.active === 4 && avg(sims.f4) < avg(sims.f3) * 1.6 + 0.5 && runs.f3[0].calls < 160 && runs.f4[0].calls < 170 && [...runs.f3, ...runs.f4, ...runs.lab].every(x => x.fps > 0)
      && r.throws === 5 && r.shown === 1 && r.meshes === 1 && page.errors.length === 0;
    return { pass: ok, detail: `HEADLESS (software rendering; not an iPhone figure; two alternating windows each): forest, 4 guards (default): ${f('f3')}; 5 guards: ${f('f4')}; Test Lab: ${f('lab')}; 5 magazines thrown in turn: ${r.throws} throws, at most ${r.shown} shown, ${r.meshes} magazine object; page errors ${page.errors.length}` };
  },

  // the forest on an iPhone layout, by touch: the stick walks her up the trail, a drag turns the camera,
  // USE throws, AIM aims, the action row is where it always was
  async forestTouch() {
    const page = await touchPage(), T = page.touch;
    await page.evaluate(() => { MV.toMenu(); });
    await page.tap('#mv-start-forest'); await page.waitForTimeout(800);
    const t0 = await page.evaluate(() => ({ z: MV.motor.position.z, yaw: MV.cam.yaw, level: MV.level.id }));
    await T('touchStart', [{ x: 150, y: 300, id: 1 }]); await T('touchMove', [{ x: 150, y: 236, id: 1 }]);
    await page.waitForFunction(z => MV.motor.position.z > z + 2, t0.z, { timeout: 15000 }).catch(() => {});
    const t1 = await page.evaluate(() => ({ z: MV.motor.position.z, spd: MV.motor.speed }));
    await T('touchEnd', [{ x: 150, y: 236, id: 1 }]); await page.waitForTimeout(400);
    for (let i = 0; i <= 8; i++) { await T(i ? 'touchMove' : 'touchStart', [{ x: 700 - i * 10, y: 330, id: 2 }]); await page.waitForTimeout(25); } await T('touchEnd', [{ x: 620, y: 330, id: 2 }]); await page.waitForTimeout(300);
    const t2 = await page.evaluate(() => MV.cam.yaw);
    const ub = await page.locator('#mv-use').boundingBox(); const n0 = await page.evaluate(() => MV.equipment.item().ctl.throws);
    await T('touchStart', [{ x: ub.x + 28, y: ub.y + 28, id: 3 }]); await page.waitForTimeout(70); await T('touchEnd', [{ x: ub.x + 28, y: ub.y + 28, id: 3 }]);
    await page.waitForFunction(n => MV.equipment.item().ctl.throws > n, n0, { timeout: 5000 }).catch(() => {});
    const n1 = await page.evaluate(() => MV.equipment.item().ctl.throws);
    const ab = await page.locator('#mv-aim').boundingBox();
    await T('touchStart', [{ x: ab.x + 28, y: ab.y + 28, id: 4 }]); await page.waitForTimeout(70); await T('touchEnd', [{ x: ab.x + 28, y: ab.y + 28, id: 4 }]);
    await page.waitForFunction(() => MV.aim.active, null, { timeout: 5000 }).catch(() => {});
    const aimOn = await page.evaluate(() => MV.aim.active);
    const ok = t0.level === 'forest' && t1.z > t0.z + 2 && t1.spd > 0.5 && Math.abs(t2 - t0.yaw) > 0.05 && n1 === n0 + 1 && aimOn && page.errors.length === 0;
    return { pass: ok, detail: `forest by touch: stick → ${(t1.z - t0.z).toFixed(1)} m up the trail (${t1.spd.toFixed(2)} m/s); drag → camera turned ${((t2 - t0.yaw) * 57.3).toFixed(0)}°; USE → ${n1 - n0} throw; AIM → aiming ${aimOn}; page errors ${page.errors.length}` };
  },

  // ---------------------------------------------------------------- Step 23: equipment and the thrown magazine
  async _itemPage(touch) {
    const page = touch ? await touchPage() : await simPage();
    await page.evaluate(() => {
      const dt = 1 / 60;
      window.sim = n => { for (let i = 0; i < n; i++) MV.tick(dt, true); };
      window.mag = () => MV.equipment.item().ctl;
      window.noiseLog = []; MV.noise.on(ev => window.noiseLog.push(ev));
      // her at (x, z) facing yaw, the camera behind her at this pitch; patrol off, both guards calm at their posts
      window.stand = (x, z, yaw, pitch) => { MV.motor.teleport(x, z, yaw); MV.cam.snap(MV.motor); if (pitch != null) MV.cam.pitch = pitch; };
      // one USE press, then n frames; what the press did
      window.use = n => { MV.input.useTapped = true; const before = MV.equipment.uses; sim(n || 1); return MV.equipment.uses > before; };
      // until the thrown magazine has landed (its first contact) or rests, at most 6 s
      window.untilImpact = () => { for (let i = 0; i < 360 && !mag().impact; i++) MV.tick(dt, true); return mag().impact; };
      window.xzd = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    });
    return page;
  },

  // the foundation: a registry of definitions (id, name, category, kind, config, quantity, its
  // behaviour), two independent slots (WEAPON: the existing pistol, not rebuilt; ITEM: the Empty
  // Magazine), one USE action that reads the item, checks it, runs it and reports ok / why; a new
  // item is only a definition; quantities; AIM + FIRE untouched with the item equipped; no cost
  // per frame when nothing is running
  async equipFoundation() {
    const page = await CHECKS._itemPage();
    const r = await page.evaluate(() => {
      const mv = MV.SCmv, E = MV.equipment, out = {};
      const P = mv.EQUIPMENT.pistol, M = mv.EQUIPMENT['empty-magazine'];
      out.defs = [P.id, P.name, P.category, P.kind, typeof P.create, M.id, M.name, M.category, M.kind, M.action, String(M.quantity), typeof M.create].join();
      out.cfg = { range: [M.config.minRange, M.config.maxRange], cd: M.config.cooldown, lv: M.config.noiseLevel, type: M.config.noiseType };
      out.slots = [E.weapon().id, E.item().id, E.weapon().ctl.pistol() === MV.pistol, E.item().ctl instanceof mv.ThrowableItem];
      out.status = E.status();
      // a new item: a definition only (a counted test gadget); equipping it leaves the weapon slot alone
      let used = 0;
      mv.registerEquipment({ id: 'test-gadget', name: 'Test Gadget', category: 'item', kind: 'test', quantity: 2, create: () => ({ canUse: s => s.aiming ? 'aiming' : '', use: () => { used++; return { ok: true, why: '' }; } }) });
      const eq = E.equip('test-gadget'), bad = E.equip('nothing-here');
      out.swap = [eq.ok, bad.ok, bad.why, E.weapon().id, E.item().id];
      const s = { down: false, aiming: false, cqcState: 'FREE', busy: false };
      out.refusedAim = E.useItem(Object.assign({}, s, { aiming: true })).why;   // (its own rule, checked by the one USE action)
      out.q = [E.useItem(s).ok, E.useItem(s).ok, E.useItem(s), used, E.item().quantity];
      E.reset(); out.back = [E.weapon().id, E.item().id, E.last];
      // AIM + FIRE with the item equipped: the pistol fires exactly as before, the magazine stays put
      stand(-6, -20, 0, 0.2); MV.aim.toggle(true); sim(40);
      MV.input._firePress(performance.now()); sim(3);
      out.fire = [MV.aim.active, MV.pistol.shots, mag().throws, MV.equipment.weapon().ctl.status()];
      out.useWhileAim = use(2) ? 'used' : MV.equipment.last.why;
      MV.aim.toggle(false); sim(30);
      // per frame cost: idle, and with a magazine in the air
      const st = { down: false, aiming: false, cqcState: 'FREE', busy: false }, t0 = performance.now();
      for (let i = 0; i < 4000; i++) { E.update(0, st); E.pose(0); }
      out.idleMs = (performance.now() - t0) / 4000;
      use(20); let fl = 0, n = 0;
      while (mag().inFlight() && n < 200) { const a = performance.now(); E.update(1 / 60, st); fl += performance.now() - a; n++; }
      out.flightMs = fl / Math.max(1, n);
      return out;
    });
    const o = r, ok = o.defs === 'pistol,Pistol,weapon,firearm,function,empty-magazine,Empty Magazine,item,throwable,throw,Infinity,function'
      && o.cfg.range[0] >= 8 && o.cfg.range[1] <= 12 && o.cfg.cd === 2.5 && o.cfg.lv === 3 && o.cfg.type === 'clatter' && o.slots.join() === 'pistol,empty-magazine,true,true'
      && o.swap.join() === 'true,false,not registered: nothing-here,pistol,test-gadget' && o.q[0] && o.q[1] && !o.q[2].ok && o.q[2].why === 'none left' && o.q[3] === 2 && o.q[4] === 0 && o.refusedAim === 'aiming'
      && o.back[0] === 'pistol' && o.back[1] === 'empty-magazine' && o.back[2] === null
      && o.fire[0] && o.fire[1] === 1 && o.fire[2] === 0 && /aimed/.test(o.fire[3]) && o.useWhileAim === 'aiming' && o.idleMs < 0.01 && o.flightMs < 0.3 && page.errors.length === 0;
    return { pass: ok, detail: `definitions ${o.defs}; magazine range ${o.cfg.range.join('–')} m, cooldown ${o.cfg.cd} s, L${o.cfg.lv} ${o.cfg.type}; slots ${o.slots.join(', ')} (${o.status}); a test gadget equipped by definition: ${o.swap.join(', ')}; quantity 2 → ${o.q[0]}, ${o.q[1]}, then "${o.q[2].why}" (${o.q[3]} uses, ${o.q[4]} left); refused while aiming "${o.refusedAim}"; RESET → ${o.back.slice(0, 2).join(', ')}; AIM + FIRE with the magazine equipped: aiming ${o.fire[0]}, ${o.fire[1]} shot, ${o.fire[2]} throws, pistol "${o.fire[3]}", USE while aiming "${o.useWhileAim}"; per frame ${(o.idleMs * 1000).toFixed(1)} µs idle, ${(o.flightMs * 1000).toFixed(0)} µs in flight; page errors ${page.errors.length}` };
  },

  // when USE works: once per press; never while aiming, holding a guard, defeated, on cooldown or
  // with a magazine already in the air; a USE press is never a CQC or FIRE press; her movement
  // isn't frozen by the throw; a wind-up interrupted before the release throws nothing
  async useRules() {
    const page = await CHECKS._itemPage();
    const r = await page.evaluate(() => {
      const { motor, input, cqc } = MV, E = MV.equipment, out = {};
      stand(-6, -20, 0, 0.2); sim(10);
      const cq0 = [input.cqcLast, input.firePressCount, MV.pistol.shots];
      out.first = use(1); out.again = use(1) ? 'used' : E.last.why;   // (the same moment: winding up)
      out.press = [cqc.state, input.cqcTapped, input.cqcLast === cq0[0], input.firePressCount === cq0[1], MV.pistol.shots === cq0[2]];
      sim(30); out.flight = use(1) ? 'used' : E.last.why;
      for (let i = 0; i < 300 && mag().inFlight(); i++) sim(1);
      out.cool = mag().cooldown > 0 ? (use(1) ? 'used' : E.last.why) : 'cooldown over';
      sim(150); out.after = use(1); sim(200);
      // walking while she throws: the stick keeps her going
      for (let i = 0; i < 150 && (mag().cooldown > 0 || mag().busy()); i++) sim(1);
      input.move.y = 1; sim(30); const sp0 = motor.speed; input.useTapped = true; let minSp = 9; for (let i = 0; i < 30; i++) { sim(1); minSp = Math.min(minSp, motor.speed); } input.move.y = 0; sim(30);
      out.walk = { sp0, minSp };
      // a wind-up interrupted by AIM: nothing thrown, no cooldown
      for (let i = 0; i < 300 && (mag().cooldown > 0 || mag().busy()); i++) sim(1);
      const th = mag().throws; input.useTapped = true; sim(3); MV.aim.toggle(true); sim(20);
      out.cancel = [mag().throws === th, mag().cancelled, mag().cooldown, mag().inFlight()];
      out.aimRefuse = use(1) ? 'used' : E.last.why; MV.aim.toggle(false); sim(30);
      // holding a guard
      const g2 = MV.guard2, b = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b.x, b.z, g2.yaw); MV.cam.snap(motor); sim(5); input.cqcTapped = true; sim(40);
      out.hold = [cqc.state, use(1) ? 'used' : E.last.why]; cqc.cancel(); sim(10); g2.reset();
      // defeated
      window.__combat = true; stand(-6, -20, 0); MV.playerHealth.take({ amount: 100, source: 'test', id: 'u1' }); sim(5);
      out.down = use(1) ? 'used' : E.last.why; window.__combat = false;
      document.getElementById('mv-reset').click(); sim(5);
      return out;
    });
    const o = r, ok = o.first && o.again === 'throwing' && o.press.join() === 'FREE,false,true,true,true' && o.flight === 'in flight' && /^cooldown/.test(o.cool) && o.after
      && o.walk.sp0 > 1 && o.walk.minSp > 0.8 * o.walk.sp0 && o.cancel[0] && o.cancel[1] === 'aiming' && o.cancel[2] === 0 && !o.cancel[3] && o.aimRefuse === 'aiming'
      && o.hold[0] === 'GRAPPLING' && o.hold[1] === 'holding a guard' && o.down === 'defeated' && page.errors.length === 0;
    return { pass: ok, detail: `a press → thrown ${o.first}; again at once "${o.again}"; the press left CQC ${o.press[0]} (no tap ${!o.press[1]}, no CQC press ${o.press[2]}, no FIRE ${o.press[3]}, no shot ${o.press[4]}); while it flies "${o.flight}"; landed, still "${o.cool}"; after the cooldown → thrown ${o.after}; walking ${o.walk.sp0.toFixed(2)} m/s, throwing ${o.walk.minSp.toFixed(2)} m/s at the slowest; a wind-up cut by AIM: nothing thrown ${o.cancel[0]} (${o.cancel[1]}), cooldown ${o.cancel[2]}; aiming "${o.aimRefuse}"; holding a guard (${o.hold[0]}) "${o.hold[1]}"; defeated "${o.down}"; page errors ${page.errors.length}` };
  },

  // the throw and the flight: in her right hand until the release (≈0.17 s); a real arc under
  // gravity from her hand along the camera's facing, the camera's pitch tilting it (within its
  // limits, 8–12 m on flat ground); one in the air at a time; it settles, lies flat, and is cleared
  // away after a while
  async throwFlight() {
    const page = await CHECKS._itemPage();
    const r = await page.evaluate(() => {
      const B = MV.visual.bones, W = o => o.getWorldPosition(new THREE.Vector3()), out = {}, m = mag();
      const one = pitch => {
        for (let i = 0; i < 400 && (m.cooldown > 0 || m.busy()); i++) sim(1);
        stand(-17, -14, Math.PI / 2, pitch); sim(10);
        MV.input.useTapped = true; let inHand = 0, handMax = 0, rel = null, ys = [], gy = 9.81, peak = 0;
        for (let i = 0; i < 40; i++) { sim(1); if (!m.released) { inHand++; handMax = Math.max(handMax, m.mesh.position.distanceTo(W(B.rightHand))); } else if (rel == null) rel = (i + 1) / 60; }
        const from = m.shot.from.clone(), first = untilImpact();
        let n = 0; while (m.flying && n < 600) { sim(1); n++; }
        const pts = []; // the arc: re-fly it from the release with the same physics to read its peak
        const v0 = new THREE.Vector3(Math.sin(m.shot.yaw) * Math.cos(m.shot.elev * Math.PI / 180), Math.sin(m.shot.elev * Math.PI / 180), Math.cos(m.shot.yaw) * Math.cos(m.shot.elev * Math.PI / 180)).multiplyScalar(m.shot.speed);
        peak = from.y + v0.y * v0.y / (2 * gy);
        return { inHand, handMax, rel, elev: m.shot.elev, speed: m.shot.speed, from: from.y, land: xzd(first.point, from), what: first.what, peak, rest: m.phase, restY: m.mesh.position.y, flat: Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(m.mesh.quaternion).y) };
      };
      out.level = one(0.2); out.up = one(-0.45); out.down = one(1.05);
      // the flight itself, frame by frame: gravity's pull between frames, never below the floor, no second magazine
      for (let i = 0; i < 400 && (m.cooldown > 0 || m.busy()); i++) sim(1);
      stand(-17, -14, Math.PI / 2, 0.2); sim(5); MV.input.useTapped = true; sim(14);
      const ys = []; let minY = 9, seen = 0;
      while (m.inFlight() && !m.impact && ys.length < 200) { ys.push(m.pos.y); minY = Math.min(minY, m.pos.y); sim(1); seen = MV.scene.children.filter(o => o.name === 'empty-magazine' && o.visible).length; }
      const acc = ys.slice(2).map((y, i) => (y - 2 * ys[i + 1] + ys[i]) * 3600);
      out.acc = acc.length ? acc.reduce((a, b) => a + b, 0) / acc.length : 0; out.minY = minY; out.copies = seen;
      // cleared away 8 s after it settles
      let k = 0; while (m.phase !== 'rest' && k < 600) { sim(1); k++; } const vis = m.mesh.visible; sim(60 * 8 + 5);
      out.cleanup = [vis, m.mesh.visible, m.phase];
      return out;
    });
    const o = r, L = o.level, U = o.up, D = o.down;
    const ok = [L, U, D].every(t => t.inHand >= 8 && t.handMax < 0.15 && t.rel > 0.14 && t.rel < 0.25 && t.elev >= 5 && t.elev <= 40 && t.what === 'ground' && t.rest === 'rest' && t.restY < 0.03 && t.flat > 0.95)
      && L.land > 7.5 && L.land < 12.5 && U.land > L.land && D.land < L.land && U.elev > L.elev && D.elev < L.elev && U.land < 12.6 && D.land > 6 && U.peak > L.peak
      && Math.abs(o.acc + 9.81) < 0.3 && o.minY > 0 && o.copies === 1 && o.cleanup.join() === 'true,false,ready' && page.errors.length === 0;
    const f = t => `elev ${t.elev.toFixed(0)}°, ${t.speed.toFixed(1)} m/s, peak ${t.peak.toFixed(1)} m, lands ${t.land.toFixed(1)} m away on the ${t.what}`;
    return { pass: ok, detail: `in her right hand for ${L.inHand} frames (≤ ${cm(L.handMax)} from it), released at ${L.rel.toFixed(2)} s from ${L.from.toFixed(2)} m up; camera level: ${f(L)}; looking up: ${f(U)}; looking down: ${f(D)}; in flight ${o.acc.toFixed(2)} m/s² (gravity), lowest ${cm(o.minY)}, ${o.copies} magazine in the air; settled lying flat (${L.restY.toFixed(3)} m, ${L.flat.toFixed(2)}); 8 s later: shown ${o.cleanup[1]}, ${o.cleanup[2]}; page errors ${page.errors.length}` };
  },

  // what it hits: the long wall, a crate, a pillar and the floor, each where it actually is (nothing
  // passes through: the swept segments catch even a very fast throw); it reacts at the hit point
  async throwCollision() {
    const page = await CHECKS._itemPage();
    const r = await page.evaluate(() => {
      const m = mag(), out = {}, W = MV.world;
      const at = (x, z, yaw, pitch) => {
        for (let i = 0; i < 400 && (m.cooldown > 0 || m.busy()); i++) sim(1);
        stand(x, z, yaw, pitch); sim(5); MV.input.useTapped = true; sim(12);
        let maxZ = -99, maxX = -99; const I = (() => { for (let i = 0; i < 360 && !m.impact; i++) { sim(1); maxZ = Math.max(maxZ, m.pos.z); maxX = Math.max(maxX, m.pos.x); } return m.impact; })();
        let n = 0; while (m.flying && n < 600) { sim(1); n++; maxZ = Math.max(maxZ, m.pos.z); maxX = Math.max(maxX, m.pos.x); }
        return { what: I.what, p: I.point.clone(), maxZ, maxX, rest: m.pos.clone(), bounces: m.bounces };
      };
      out.wall = at(4, 10.4, 0, 0.2);                 // the long wall (z 12.825…13.175, 2.6 m high), 2.4 m ahead
      out.crate = at(-2, -11.2, 0, 0.2);              // the tall crate (z −8.6…−7.4, 2 m), 2.6 m ahead
      out.pillar = at(-14, -14.6, 0, 0.35);           // a pillar at (−14, −12), r 0.35
      out.floor = at(-17, -14, Math.PI / 2, 0.2);
      // a very fast segment straight through the wall still stops at its face
      const S = MV.SCmv.ThrowableItem.sweep, h = S(W, new THREE.Vector3(4, 1, 11), new THREE.Vector3(4, 1, 16), 0.035);
      out.fast = h && { what: h.what, z: 11 + 5 * h.t, n: h.n.z };
      return out;
    });
    const o = r, ok = o.wall.what === 'wall' && o.wall.p.z < 12.83 && o.wall.maxZ < 12.83 && o.wall.rest.z < 12.83
      && o.crate.what === 'crate' && o.crate.p.z < -8.55 && o.crate.maxZ < -8.55
      && o.pillar.what === 'pillar' && Math.hypot(o.pillar.p.x + 14, o.pillar.p.z + 12) < 0.35 + 0.035 + 0.02 && o.pillar.p.y < 3
      && o.floor.what === 'ground' && o.floor.p.y < 0.05 && o.fast && o.fast.what === 'wall' && Math.abs(o.fast.z - 12.79) < 0.01 && o.fast.n === -1 && page.errors.length === 0;
    const f = t => `${t.what} at (${t.p.x.toFixed(2)}, ${t.p.y.toFixed(2)}, ${t.p.z.toFixed(2)}), ${t.bounces} bounces, rests at (${t.rest.x.toFixed(1)}, ${t.rest.z.toFixed(1)})`;
    return { pass: ok, detail: `long wall: ${f(o.wall)}, never past z ${o.wall.maxZ.toFixed(2)}; tall crate: ${f(o.crate)}, never past z ${o.crate.maxZ.toFixed(2)}; pillar: ${f(o.pillar)}; open floor: ${f(o.floor)}; a 5 m segment through the wall: stopped at z ${o.fast ? o.fast.z.toFixed(3) : '–'} (${o.fast ? o.fast.what : 'MISSED'}); page errors ${page.errors.length}` };
  },

  // its sound: one noise event per throw, at the first contact, through the noise system (L3, the
  // surface there: concrete 14 m, metal louder, grass softer), a 'clatter' (an object impact), never
  // a gunshot; the bounces after it make no noise events; the guards don't draw for it
  async throwSound() {
    const page = await CHECKS._itemPage();
    const r = await page.evaluate(() => {
      const m = mag(), out = {};
      // Guard 1 at a post far off, looking away (nobody sees her on the strips)
      MV.guard.post.set(18, 0, -19); MV.guard.postYaw = Math.PI; MV.guard.reset(); MV.guard2.reset();
      const at = (x, z, yaw) => {
        for (let i = 0; i < 400 && (m.cooldown > 0 || m.busy()); i++) sim(1);
        stand(x, z, yaw, 0.2); sim(5); noiseLog.length = 0; MV.input.useTapped = true; sim(12); const I = untilImpact(); sim(240);
        const ev = noiseLog.filter(e => e.source !== 'player'), objs = ev.filter(e => e.source === 'object');
        return { n: objs.length, other: ev.filter(e => e.source !== 'object').map(e => e.type).join(','), type: objs[0] && objs[0].type, lv: objs[0] && objs[0].level, r: objs[0] && objs[0].radius, surf: objs[0] && objs[0].surface, at: objs[0] ? xzd(objs[0].position, I.point) : 9, bounces: m.bounces, ticks: m.ticks };
      };
      out.concrete = at(-17, -14, Math.PI / 2);
      out.metal = at(0, -2.9, 0);       // onto the metal strip (x −1.5…1.5, z 4…9)
      out.grass = at(3.3, -2.9, 0);     // onto the grass strip
      out.gun = MV.guards.map(g => [g.awareness.attack, g.weapon.state, g.hearing.heard ? g.hearing.heard.type : null]);
      out.stats = document.getElementById('mv-equip').textContent;
      return out;
    });
    const o = r, C = o.concrete, M = o.metal, G = o.grass;
    const ok = [C, M, G].every(t => t.n === 1 && t.type === 'clatter' && t.lv === 3 && t.at < 1e-6 && t.bounces >= 1) && C.surf === 'concrete' && Math.abs(C.r - 14) < 0.01
      && M.surf === 'metal' && M.r > C.r + 5 && G.surf === 'grass' && G.r < C.r - 3 && o.gun.every(g => !g[0] && g[1] === 'LOWERED' && g[2] !== 'gunshot')
      && /PISTOL/.test(o.stats) && /MAG/.test(o.stats) && /object impact L3/.test(o.stats) && page.errors.length === 0;
    const f = t => `${t.n} event (${t.type} L${t.lv}, ${t.surf} ${t.r.toFixed(1)} m, ${t.at < 1e-6 ? 'at' : 'NOT at'} the impact; ${t.bounces} bounces, ${t.ticks} ticks heard, other events: ${t.other || 'none'})`;
    return { pass: ok, detail: `concrete: ${f(C)}; metal: ${f(M)}; grass: ${f(G)}; the guards: attacked ${o.gun.map(g => !!g[0]).join('/')}, pistols ${o.gun.map(g => g[1]).join('/')}, last heard ${o.gun.map(g => g[2]).join('/')}; STATS "${o.stats}"; page errors ${page.errors.length}` };
  },

  // a distraction: Guard 2 (a sentry) hears the clatter with his normal hearing, turns and checks it
  // from his post, and settles back, never learning where she is (she threw it from behind him);
  // Guard 1 walks over to the spot, looks around, and goes back to his patrol
  async distractGuards() {
    const page = await CHECKS._itemPage();
    await page.evaluate(() => { MV.guard.patrol.enabled = true; MV.guard.reset(); });
    const r = await page.evaluate(() => {
      const m = mag(), g1 = MV.guard, g2 = MV.guard2, out = {};
      // Guard 2: she's 4 m behind him, throwing over him into his view
      g2.reset(); const f = g2.forward(), bk = g2.position.clone().addScaledVector(f, -4); stand(bk.x, bk.z, g2.yaw, 0.2); sim(10);
      const her = MV.motor.position.clone(); MV.input.useTapped = true; sim(12); const I = untilImpact();
      const h = g2.hearing.last; out.heard = [h.type, h.heard, h.distance.toFixed(1), h.reach.toFixed(1), xzd(h.position, I.point) < 1e-6];
      const seq = []; let meter = 0, focus = null, faced = null, firstT = null, inv = false;
      for (let i = 0; i < 60 * 70; i++) {
        sim(1); const a = g2.awareness; meter = Math.max(meter, g2.vision.meter);
        if (seq[seq.length - 1] !== a.state) seq.push(a.state);
        if (a.focus && !focus) focus = a.focus.position.clone();
        if (a.state === 'INVESTIGATING') { inv = true; const to = Math.atan2(I.point.x - g2.position.x, I.point.z - g2.position.z); faced = faced == null ? Math.abs(Math.atan2(Math.sin(to - g2.yaw), Math.cos(to - g2.yaw))) : Math.min(faced, Math.abs(Math.atan2(Math.sin(to - g2.yaw), Math.cos(to - g2.yaw)))); }
        if (inv && a.state === 'NORMAL' && g2.atPost() && firstT == null) firstT = i / 60;
        if (firstT != null && i / 60 > firstT + 3) break;
      }
      const D = m.impact.heard.find(x => x.label === 'Guard 2');
      out.g2 = { seq: seq.join('→'), meter, focusAt: focus ? xzd(focus, I.point) : 99, focusHer: focus ? xzd(focus, her) : 0, faced: faced == null ? 9 : faced * 57.3, back: firstT, post: g2.atPost(), confirmed: g2.awareness.confirmed, inv: D.investigated, note: g2.awareness.note };
      // Guard 1 on his patrol: she throws from far off and steps out of everyone's sight
      g2.reset(); g1.reset(); sim(5);
      const p0 = g1.position.clone(); stand(p0.x - 19, p0.z + 2, Math.PI / 2, 0.2); sim(5); MV.input.useTapped = true; sim(14); MV.motor.teleport(-19, 19, 0); MV.cam.snap(MV.motor);
      const J = untilImpact(); const seq1 = []; let near = 99, back = null, investigated = false, dist = null;
      for (let i = 0; i < 60 * 90; i++) {
        sim(1); const a = g1.awareness; if (seq1[seq1.length - 1] !== a.state) seq1.push(a.state);
        if (i === 60 * 10) dist = m.distraction();   // (the developer view follows it for 15 s)
        if (a.state === 'INVESTIGATING') { investigated = true; near = Math.min(near, xzd(g1.position, J.point)); }
        if (investigated && a.state === 'NORMAL' && a.behavior === 'patrol' && back == null) back = i / 60;
        if (back != null && i / 60 > back + 4) break;
      }
      out.g1 = { seq: seq1.join('→'), near, back, behavior: g1.awareness.behavior, patrol: g1.patrol.status(), confirmed: g1.awareness.confirmed, dist, later: m.distraction() };
      return out;
    });
    const o = r, A = o.g2, B = o.g1;
    const ok = o.heard[0] === 'clatter' && o.heard[1] && o.heard[4] && /SUSPICIOUS/.test(A.seq) && /INVESTIGATING/.test(A.seq) && A.meter < 0.3 && !A.confirmed && A.focusAt < 0.5 && A.focusHer > 3 && A.faced < 30 && A.back != null && A.post && A.inv
      && /INVESTIGATING/.test(B.seq) && B.near < 3 && B.back != null && B.behavior === 'patrol' && !B.confirmed && /G1 investigated/.test(B.dist) && B.later === null && page.errors.length === 0;
    return { pass: ok, detail: `Guard 2 heard it: ${o.heard[0]} ${o.heard[1]} at ${o.heard[2]}/${o.heard[3]} m (at the impact ${o.heard[4]}); ${A.seq}; his attention on the impact (${A.focusAt.toFixed(2)} m from it, ${A.focusHer.toFixed(1)} m from her), turned to within ${A.faced.toFixed(0)}° of it; saw her ${Math.round(A.meter * 100)}% at most, confirmed ${A.confirmed}; calm at his post again after ${A.back != null ? A.back.toFixed(0) + ' s' : 'NEVER'} ("${A.note}"); Guard 1: ${B.seq}, came within ${B.near.toFixed(1)} m of it, back on patrol after ${B.back != null ? B.back.toFixed(0) + ' s' : 'NEVER'} (${B.patrol}); confirmed ${B.confirmed}; STATS 10 s after: ${B.dist}, folded away after 15 s ${B.later === null}; page errors ${page.errors.length}` };
  },

  // combat comes first: an ALERT guard who sees her keeps on her; one who's lost her takes it as one
  // more sound for his search, keeping what he knows; unconscious or dead guards hear nothing
  async distractPriority() {
    const page = await CHECKS._itemPage();
    const r = await page.evaluate(() => {
      const m = mag(), g1 = MV.guard, g2 = MV.guard2, out = {};
      const toss = (yaw, pitch) => { for (let i = 0; i < 400 && (m.cooldown > 0 || m.busy()); i++) sim(1); MV.cam.yaw = yaw + Math.PI; MV.cam.pitch = pitch == null ? 0.2 : pitch; MV.input.useTapped = true; sim(12); return untilImpact(); };
      // in plain view of Guard 1: ALERT, his pistol on her
      g1.post.set(-6, 0, -16); g1.postYaw = 0; g1.reset(); g2.reset(); stand(-6, -9, Math.PI); sim(60 * 4);
      const a = g1.awareness, s0 = a.state; toss(Math.PI / 2); sim(60);
      const R = m.impact.heard.find(x => x.label === 'Guard 1');
      out.alert = { s0, s1: a.state, target: g1.weapon.target.type, why: R.why, heard: R.heard, conf: a.confirmed };
      // out of his sight (behind the tall crate): EVASION, then a magazine thrown from there
      MV.motor.teleport(-2, -6.9, -Math.PI / 2); MV.cam.snap(MV.motor); for (let i = 0; i < 60 * 3 && a.state !== 'EVASION'; i++) sim(1);
      const seen = a.seen && a.seen.position.clone(), s2 = a.state; const I = toss(-Math.PI / 2, 0.2); sim(30);
      out.lost = { s2, s3: a.state, conf: a.confirmed, kept: !!(a.seen && seen && a.seen.position.distanceTo(seen) < 1e-6), type: a.heard && a.heard.type, note: a.note, plan: a.evasion && a.evasion.plan ? a.evasion.plan.map(p => xzd(p.p, I.point).toFixed(1)).join(',') : '', at: xzd(I.point, g1.position).toFixed(1) };
      // down: Guard 2 unconscious, Guard 1 defeated
      document.getElementById('mv-reset').click(); sim(5); g1.post.set(-6, 0, -16); g1.reset();
      g2.ko.knockOut({ position: g2.position.clone(), along: new THREE.Vector3(1, 0, 0), by: g2.position.clone().add(new THREE.Vector3(-1, 0, 0)) });
      for (let k = 0; k < 3; k++) g1.health.take({ amount: 35, source: 'pistol', id: 'p' + k });
      sim(60 * 3); const st = [g1.awareness.state, g2.awareness.state];
      stand(-12, -13, Math.PI / 2); sim(5); toss(Math.PI); sim(60);
      out.down = m.impact.heard.map(x => `${x.label} ${x.heard} ${x.why}`); out.downState = [st.join(), [g1.awareness.state, g2.awareness.state].join()];
      return out;
    });
    const o = r, ok = o.alert.s0 === 'ALERT' && o.alert.s1 === 'ALERT' && o.alert.target === 'visual' && o.alert.heard && o.alert.why === 'ALERT: kept on her' && o.alert.conf
      && o.lost.s2 === 'EVASION' && o.lost.conf && o.lost.kept && o.lost.type === 'clatter' && ['EVASION', 'HEIGHTENED'].indexOf(o.lost.s3) >= 0
      && o.down.every(s => / false (dead|unconscious)$/.test(s)) && o.down.some(s => /dead$/.test(s)) && o.down.some(s => /unconscious$/.test(s)) && o.downState[0] === o.downState[1] && page.errors.length === 0;
    return { pass: ok, detail: `seeing her: ${o.alert.s0} → ${o.alert.s1}, pistol on ${o.alert.target}, heard ${o.alert.heard} ("${o.alert.why}"); lost her: ${o.lost.s2} → ${o.lost.s3} (impact ${o.lost.at} m from him), still confirmed ${o.lost.conf}, where he last saw her kept ${o.lost.kept}, last heard ${o.lost.type} ("${o.lost.note}"; search spots from the impact ${o.lost.plan || '–'} m); down: ${o.down.join(' · ')} (states unchanged ${o.downState[0] === o.downState[1]}); page errors ${page.errors.length}` };
  },

  // CQC after a distraction: he turns to the sound, she closes in from behind and grabs him, then
  // throws him (CQC THROW, still THROW); USE is unavailable while she holds him
  async distractCqc() {
    const page = await CHECKS._itemPage();
    const r = await page.evaluate(() => {
      const g2 = MV.guard2, { motor, input, cqc } = MV, out = {};
      g2.reset(); const f = g2.forward(), bk = g2.position.clone().addScaledVector(f, -4); stand(bk.x, bk.z, g2.yaw, 0.2); sim(10);
      MV.input.useTapped = true; sim(12); untilImpact();
      let t = 0; while (g2.awareness.state !== 'INVESTIGATING' && t < 600) { sim(1); t++; }
      sim(30);
      const b = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b.x, b.z, g2.yaw); MV.cam.snap(motor); sim(3);
      out.before = [g2.awareness.state, g2.awareness.confirmed, Math.round(g2.vision.meter * 100)];
      input.cqcTapped = true; sim(40); out.grab = cqc.state;
      out.use = MV.equipment.useItem({ down: false, aiming: false, cqcState: cqc.state, busy: false }).why;
      out.btn = [document.getElementById('mv-throw').textContent.trim(), document.body.classList.contains('mv-holding'), getComputedStyle(document.getElementById('mv-use')).visibility];
      input.throwTapped = true; const seen = new Set(); for (let i = 0; i < 200; i++) { sim(1); seen.add(cqc.state); }
      out.thrown = [...seen].join('→'); out.ko = g2.ko.state;
      return out;
    });
    const o = r, ok = o.before[1] === false && o.grab === 'GRAPPLING' && o.use === 'holding a guard' && o.btn.join() === 'THROW,true,hidden' && /THROWING/.test(o.thrown) && o.ko !== 'CONSCIOUS' && page.errors.length === 0;
    return { pass: ok, detail: `distracted: ${o.before[0]} (confirmed ${o.before[1]}, seen ${o.before[2]}%); grab → ${o.grab}; USE "${o.use}"; buttons: "${o.btn[0]}", holding ${o.btn[1]}, USE ${o.btn[2]}; THROW → ${o.thrown}; he's ${o.ko}; page errors ${page.errors.length}` };
  },

  // RESET: the default slots back, no magazine anywhere, no cooldown, the last distraction gone
  async equipReset() {
    const page = await CHECKS._itemPage();
    const r = await page.evaluate(() => {
      const m = mag(), E = MV.equipment, out = {};
      stand(-17, -14, Math.PI / 2, 0.2); sim(5); MV.input.useTapped = true; sim(30);
      out.mid = [m.phase, m.mesh.visible, m.cooldown > 0];
      E.equip('pistol'); document.getElementById('mv-reset').click(); sim(2);
      out.after = [m.phase, m.mesh.visible, m.cooldown, m.impact, m.flying, E.weapon().id, E.item().id, E.last];
      out.use = use(1);
      // after landing too
      untilImpact(); for (let i = 0; i < 300 && m.phase !== 'rest'; i++) sim(1); document.getElementById('mv-reset').click(); sim(12);
      out.rest = [m.phase, m.mesh.visible, document.getElementById('mv-equip').textContent];
      return out;
    });
    const o = r, ok = o.mid.join() === 'flight,true,true' && o.after.slice(0, 5).join() === 'ready,false,0,,false' && o.after[5] === 'pistol' && o.after[6] === 'empty-magazine' && o.after[7] === null && o.use
      && o.rest[0] === 'ready' && !o.rest[1] && o.rest[2] === 'PISTOL holstered · MAG ready' && page.errors.length === 0;
    return { pass: ok, detail: `mid-flight (${o.mid.join(', ')}) → RESET: ${o.after.slice(0, 5).map(String).join(', ')}, slots ${o.after[5]} / ${o.after[6]}; USE straight after → thrown ${o.use}; landed → RESET: ${o.rest.join(', ')}; page errors ${page.errors.length}` };
  },

  // the USE button through real touches on iPhone layouts: in slot 3 of the action row (left of
  // CROUCH, no existing button moved), clear of the swipe area, the crosshair and the stick; a tap
  // is one throw (never CQC or FIRE), a finger kept on it still one; dim while unavailable; gone
  // while she holds a guard (THROW's slot); the E key
  async useTouch() {
    const out = [], fails = [];
    for (const [w, h] of [[844, 390], [667, 375], [932, 430]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
      await page.goto(base + '/movement.html'); await page.waitForSelector('#mv-start:not([hidden])', { timeout: 120000 });
      await page.tap('#mv-start'); await page.waitForTimeout(300); await page.evaluate(() => MV.setStats(true));   // (Step 24.1: STATS starts collapsed)
      const cdp = await ctx.newCDPSession(page), T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
      await page.evaluate(() => { MV.guard.patrol.enabled = false; MV.guard.personality.enabled = false; MV.guard.reset(); MV.motor.teleport(-17, -14, Math.PI / 2); MV.cam.snap(MV.motor); });
      const geo = await page.evaluate(() => {
        const R = id => { const r = document.getElementById(id).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
        const U = R('mv-use'), A = R('mv-aim'), C = R('mv-cqc'), K = R('mv-crouch'), S = R('mv-stats'), W = innerWidth, H = innerHeight;
        const others = [A, C, K].map(b => Math.hypot(b.cx - U.cx, b.cy - U.cy) - 56);
        const hit = document.elementFromPoint(U.cx, U.cy), xh = U.l - 16 > W / 2 || U.r + 16 < W / 2 || U.t - 16 > H / 2 || U.b + 16 < H / 2;
        return { U, row: Math.abs(U.cy - K.cy) < 1 && Math.abs(U.cy - A.cy) < 1, slot: (K.cx - U.cx) / (C.cx - K.cx), gap: Math.min(...others), hit: !!(hit && hit.closest('#mv-use')), label: document.getElementById('mv-use').textContent.trim(), xh, stick: U.l >= 0.45 * W, below: U.b + 12 <= H, statsClear: U.t >= S.b, W, H };
      });
      const st = () => page.evaluate(() => ({ throws: MV.equipment.item().ctl.throws, uses: MV.equipment.uses, refused: MV.equipment.refused, why: MV.equipment.last && MV.equipment.last.why, cqc: MV.cqc.state, cqcLast: MV.input.cqcLast, fires: MV.input.firePressCount, shots: MV.pistol.shots, locked: document.getElementById('mv-use').classList.contains('locked'), busy: MV.equipment.item().ctl.busy(), cd: MV.equipment.item().ctl.cooldown, aim: MV.aim.active }));
      const U = geo.U, tap = async (id, hold) => { const n = await page.evaluate(() => MV.equipment.uses + MV.equipment.refused); await T('touchStart', [{ x: U.cx, y: U.cy, id }]); await page.waitForTimeout(hold || 70); await T('touchEnd', [{ x: U.cx, y: U.cy, id }]); await page.waitForFunction(n => MV.equipment.uses + MV.equipment.refused > n, n, { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(100); };
      const waitReady = () => page.waitForFunction(() => { const c = MV.equipment.item().ctl; return c.cooldown <= 0 && !c.busy(); }, null, { timeout: 15000 }).catch(() => {});
      const s0 = await st(); await tap(1); const s1 = await st();
      await page.waitForTimeout(200); const s2 = await st(); await tap(2); const s3 = await st();   // during its flight / cooldown
      await waitReady(); const sr = await st(); await tap(3, 1200); const s4 = await st();         // a finger kept on it
      await waitReady(); const n4 = (await st()).uses; await page.keyboard.press('KeyE'); await page.waitForFunction(n => MV.equipment.uses + MV.equipment.refused > n, n4 + (await st()).refused, { timeout: 3000 }).catch(() => {}); const s5 = await st();   // (a frame has taken the press: headless frames can be slow)
      await waitReady();
      // aiming: dim and refused
      const ab = await page.locator('#mv-aim').boundingBox(); await T('touchStart', [{ x: ab.x + 28, y: ab.y + 28, id: 4 }]); await page.waitForTimeout(70); await T('touchEnd', [{ x: ab.x + 28, y: ab.y + 28, id: 4 }]); await page.waitForTimeout(500);
      const sa0 = await st(); await tap(5); const sa = await st();
      await T('touchStart', [{ x: ab.x + 28, y: ab.y + 28, id: 6 }]); await page.waitForTimeout(70); await T('touchEnd', [{ x: ab.x + 28, y: ab.y + 28, id: 6 }]); await page.waitForTimeout(500);
      // holding a guard: hidden, its slot is THROW's
      await page.evaluate(() => { const g = MV.guard2; const b = g.position.clone().addScaledVector(g.forward(), -1.0); MV.motor.teleport(b.x, b.z, g.yaw); MV.cam.snap(MV.motor); MV.input.cqcTapped = true; });
      await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(300);
      const hold = await page.evaluate(() => { const u = document.getElementById('mv-use'), t = document.getElementById('mv-throw').getBoundingClientRect(), r = u.getBoundingClientRect(); return { vis: getComputedStyle(u).visibility, throwHere: Math.abs((t.left + t.right) / 2 - (r.left + r.right) / 2) < 1, top: document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2).closest('#mv-throw') != null }; });
      const g = geo, r = { g, s0, s1, s2, s3, sr, s4, s5, sa0, sa, hold, errs: errs.length };
      const ok = g.row && Math.abs(g.slot - 1) < 0.02 && g.gap > 8 && g.hit && /^USE/.test(g.label) && /MAG/.test(g.label) && g.xh && g.stick && g.statsClear
        && s1.throws === s0.throws + 1 && s1.cqc === 'FREE' && s1.cqcLast === s0.cqcLast && s1.fires === s0.fires && s1.shots === s0.shots
        && s2.locked && s3.throws === s1.throws && s3.refused === s2.refused + 1 && s4.throws === sr.throws + 1 && s5.throws === s4.throws + 1
        && sa0.aim && sa0.locked && sa.throws === sa0.throws && sa.why === 'aiming' && sa.fires === sa0.fires && hold.vis === 'hidden' && hold.throwHere && hold.top && errs.length === 0;
      if (!ok) fails.push(`${w}×${h}`);
      out.push(`${w}×${h}: USE "${g.label}" in slot ${(g.slot + 2).toFixed(2)} of the row (same row ${g.row}), ≥ ${g.gap.toFixed(0)} px from AIM/CQC/CROUCH, centre takes the touch ${g.hit}, clear of the crosshair ${g.xh}, of the stick ${g.stick} and of STATS ${g.statsClear}; a tap → ${s1.throws - s0.throws} throw (CQC ${s1.cqc}, CQC press ${s1.cqcLast === s0.cqcLast ? 'none' : s1.cqcLast}, FIRE presses ${s1.fires - s0.fires}, shots ${s1.shots - s0.shots}); dim while it flies ${s2.locked}, a tap then → refused "${s3.why}"; a 1.2 s press → ${s4.throws - sr.throws} throw; E key → ${s5.throws - s4.throws}${s5.throws === s4.throws ? ' (' + s5.why + ', cd ' + s5.cd.toFixed(2) + ', busy ' + s5.busy + ')' : ''}; aiming: dim ${sa0.locked}, a tap → refused "${sa.why}"; holding a guard: USE ${hold.vis}, THROW in its slot ${hold.throwHere}${errs.length ? '; errors ' + errs.join(';') : ''}`);
      await ctx.close();
    }
    return { pass: fails.length === 0, detail: out.join(' | ') };
  },

  // Step 22 correction: her defeat is a collapse, not a sit: within ~1.1 s her hips and head are
  // both down at the floor (lying, not sitting: the head as low as the hips), never below the
  // ground, no jumps, posed once and still; her animation doesn't run under it; RESET stands her up
  async playerCollapse() {
    const page = await CHECKS._gunPage();
    const r = await page.evaluate(() => {
      const { motor } = MV, P = MV.playerHealth, B = MV.visual.bones, A = MV.SCmv.ThrowAnim, W = b => b.getWorldPosition(new THREE.Vector3());
      range(40); sim(30);
      const t0 = MV.animator.time != null ? MV.animator.time : null;
      for (let k = 0; k < 5; k++) P.take({ amount: 20, source: 'Guard 1', id: 'c' + k, dir: new THREE.Vector3(0, 0, -1) });
      let minLow = 9, maxStep = 0, prev = W(B.hips), downAt = null, n = 0;
      for (let i = 0; i < 120; i++) { MV.tick(1 / 60, true); const h = W(B.hips), hd = W(B.head); maxStep = Math.max(maxStep, h.distanceTo(prev)); prev = h; minLow = Math.min(minLow, A.lowest({ model: MV.visual.model, bones: B }) - motor.position.y); if (downAt == null && h.y < 0.35 && hd.y < 0.45) downAt = (i + 1) / 60; }
      const hipsY = W(B.hips).y, headY = W(B.head).y, q = B.leftLeg.quaternion.clone(); sim(120);
      const settled = B.leftLeg.quaternion.equals(q), frozen = P.frozen(), posedOnce = P._posed;
      document.getElementById('mv-reset').click(); sim(40);
      return { hp: 0, downAt, minLow, maxStep, hipsY, headY, settled, frozen, posedOnce, after: { head: W(B.head).y, frozen: P.frozen(), hp: P.current } };
    });
    const o = r, ok = o.downAt != null && o.downAt <= 1.25 && o.hipsY < 0.35 && o.headY < 0.45 && Math.abs(o.headY - o.hipsY) < 0.25 && o.minLow > -0.01 && o.maxStep < 0.08 && o.settled && o.frozen && o.posedOnce
      && o.after.head > 1.35 && !o.after.frozen && o.after.hp === 100 && page.errors.length === 0;
    return { pass: ok, detail: `0 HP: down on the floor ${o.downAt != null ? o.downAt.toFixed(2) + ' s' : 'never'} later (hips ${o.hipsY.toFixed(2)} m, head ${o.headY.toFixed(2)} m: lying, not sitting), never below the ground (lowest ${cm(o.minLow)}), hips ≤ ${cm(o.maxStep)} per frame, still after 2 s ${o.settled}, her animation off under it ${o.frozen}; RESET: head ${o.after.head.toFixed(2)} m up, ${o.after.hp} HP; page errors ${page.errors.length}` };
  },

  // ---------------------------------------------------------------- Step 22: guard gunfire, player health and defeat
  async _gunPage(touch) {
    const page = touch ? await touchPage() : await simPage();
    await page.evaluate(() => { window.__combat = true; });   /* (Step 22 checks: damage on) */
    await page.evaluate(() => {
      const dt = 1 / 60;
      window.sim = n => { for (let i = 0; i < n; i++) MV.tick(dt, true); };
      // Guard 1 at an open post (patrol off), her d m in front of him in plain view
      window.range = (d, yawOff) => { const g1 = MV.guard; g1.patrol.enabled = false; g1.personality.enabled = false; g1.post.set(-6, 0, -16); g1.postYaw = 0; g1.reset(); MV.guard2.reset(); MV.playerHealth.reset(); MV.motor.teleport(-6 + (yawOff || 0), -16 + d, Math.PI); MV.cam.snap(MV.motor); };
      window.keepAlive = () => { const P = MV.playerHealth; if (P.current < P.max) P.current = P.max; P.state = 'OK'; };
      window.shotLog = []; for (const g of MV.guards) { const G = g.gunfire, f = G.fire.bind(G); G.fire = cf => { const s = f(cf); if (s) window.shotLog.push({ g: g.cfg.label.split(' —')[0], t: g.awareness.clock, kind: s.kind, what: s.what, point: s.point && s.point.clone(), from: s.from.clone(), dir: s.dir.clone(), dmg: s.damage ? s.damage.applied : false, visible: g.weapon.target.visible, state: g.weapon.state, startled: g.awareness.isStartled(), noise: s.noise }); return s; }; }
    });
    return page;
  },

  // her health: 100, each guard hit 20 (configurable), five hits to 0, never below; one shot
  // applies once; nothing after defeat; RESET back to 100
  async playerHealth() {
    const page = await CHECKS._gunPage();
    const r = await page.evaluate(() => {
      const P = MV.playerHealth, d = MV.guard.gunfire.cfg.damage;
      const out = { start: [P.current, P.max, P.percent(), P.state], damage: d, cfg2: MV.guard2.gunfire.cfg.damage };
      const hp = []; for (let i = 0; i < 5; i++) { P.take({ amount: d, source: 'Guard 2', id: 'h' + i }); hp.push(P.current); }
      out.hp = hp; out.state = P.state;
      out.after = P.take({ amount: d, source: 'Guard 2', id: 'h9' }); out.hpAfter = P.current;
      P.reset(); const a = P.take({ amount: 20, source: 'Guard 1', id: 'dup' }), b = P.take({ amount: 20, source: 'Guard 1', id: 'dup' });
      out.dup = [a.applied, b.applied, P.current]; P.reset(); P.take({ amount: 500, source: 'x', id: 'big' }); out.big = [P.current, P.state];
      document.getElementById('mv-reset').click(); sim(2); out.reset = [P.current, P.state, P.history.length, P.percent()];
      out.last = (P.take({ amount: 20, source: 'Guard 1 — Patrol', id: 'l' }), [P.lastDamage.amount, P.lastDamage.source, P.received]);
      return out;
    });
    const o = r, ok = o.start.join() === '100,100,100,OK' && o.damage === 20 && o.cfg2 === 20 && o.hp.join() === '80,60,40,20,0' && o.state === 'PLAYER_DEFEATED' && !o.after.applied && o.hpAfter === 0
      && o.dup.join() === 'true,false,80' && o.big.join() === '0,PLAYER_DEFEATED' && o.reset.join() === '100,OK,0,100' && o.last.join() === '20,Guard 1 — Patrol,20' && page.errors.length === 0;
    return { pass: ok, detail: `start ${o.start.join(', ')}; guard damage ${o.damage} / ${o.cfg2}; five hits: ${o.hp.join(' → ')} → ${o.state}; a sixth: applied ${o.after.applied}, ${o.hpAfter} HP; one shot twice: ${o.dup.slice(0, 2).join('/')}, ${o.dup[2]} HP; 500 → ${o.big.join(', ')}; RESET → ${o.reset.join(', ')}; recorded ${o.last.join(', ')}; page errors ${page.errors.length}` };
  },

  // when he may fire: never with the pistol lowered, never during his startle, never on
  // footsteps or a gunshot alone (nothing visible), only READY on a target he can see; he
  // stops once she's behind cover; his cooldown; the two guards on their own rhythms;
  // down or restrained, never
  async gunfireRules() {
    const page = await CHECKS._gunPage();
    const r = await page.evaluate(() => {
      const { motor, noise, input } = MV, g1 = MV.guard, g2 = MV.guard2, cq = MV.cqc;
      const out = {};
      // in plain view from the start: the first shots
      range(7); shotLog.length = 0; let first = null, startleEnd = null, lowered = 0;
      for (let i = 0; i < 60 * 12; i++) { keepAlive(); MV.tick(1 / 60, true); if (g1.awareness.isStartled()) startleEnd = g1.awareness.clock; }
      out.all = shotLog.map(s => s.state + (s.startled ? '!' : '') + (s.visible ? 'v' : '-')).join(' ');
      out.legit = shotLog.every(s => s.state === 'READY' && !s.startled && s.visible);
      out.firstAt = shotLog.length ? shotLog[0].t : null; out.alertAt = g1.awareness.confirmedAt; out.startleEnd = startleEnd; out.n = shotLog.length;
      const gaps = shotLog.slice(1).map((s, i) => s.t - shotLog[i].t); out.minGap = Math.min(...gaps); out.maxGap = Math.max(...gaps);
      // footsteps / a gunshot heard, nothing seen: no shots
      g1.reset(); g2.reset(); motor.teleport(-19, 19, 0); MV.cam.snap(motor); sim(5); shotLog.length = 0;
      const gp = g2.position.clone(), f = g2.forward();
      for (let k = 0; k < 8; k++) { noise.emit(2, 'footstep', new THREE.Vector3(gp.x - f.x * 3, 0, gp.z - f.z * 3), 'concrete', 'player'); sim(20); }
      out.steps = { shots: shotLog.length, w: g2.weapon.state };
      noise.emit(5, 'gunshot', new THREE.Vector3(gp.x - f.x * 6, 0, gp.z - f.z * 6), 'concrete', 'player'); sim(300);
      out.gun = { shots: shotLog.length, w: g2.weapon.state, type: g2.weapon.target.type, visible: g2.weapon.target.visible };
      // behind the tall crate: no more shots once he's lost her
      range(7); for (let i = 0; i < 60 * 6; i++) { keepAlive(); MV.tick(1 / 60, true); }
      shotLog.length = 0; motor.teleport(-2, -6.9, 0); MV.cam.snap(motor); for (let i = 0; i < 60 * 6; i++) { keepAlive(); MV.tick(1 / 60, true); }
      out.hidden = { shots: shotLog.length, late: shotLog.filter(s => s.t > (shotLog[0] ? shotLog[0].t : 0) + 0.2).length, hits: shotLog.filter(s => s.kind === 'player').length, aware: g1.awareness.state, type: g1.weapon.target.type };
      // two guards seeing her: not in step
      g1.post.set(-6, 0, -16); g1.postYaw = 0; g1.reset(); g2.reset(); MV.playerHealth.reset();
      g2.motor.teleport(-3.5, -13, -Math.PI / 4); g2.post.copy(g2.position); g2.postYaw = -Math.PI / 4; g2.reset();
      motor.teleport(-6, -9, Math.PI); MV.cam.snap(motor); shotLog.length = 0;
      for (let i = 0; i < 60 * 14; i++) { keepAlive(); MV.tick(1 / 60, true); }
      const a = shotLog.filter(s => s.g === 'Guard 1').map(s => s.t), b = shotLog.filter(s => s.g === 'Guard 2').map(s => s.t);
      let close = 0; for (const t of a) if (b.some(u => Math.abs(u - t) < 0.05)) close++;
      out.two = { a: a.length, b: b.length, close };
      // grabbed: Guard 1 can't fire while held
      g2.reset(); range(7); for (let i = 0; i < 60 * 5; i++) { keepAlive(); MV.tick(1 / 60, true); }
      const q = g1.position.clone().addScaledVector(g1.forward(), 1.0); motor.teleport(q.x, q.z, g1.yaw + Math.PI); MV.cam.snap(motor); shotLog.length = 0;
      input.cqcTapped = true; let held = 0; for (let i = 0; i < 180; i++) { keepAlive(); MV.tick(1 / 60, true); if (g1.restraint) held++; }
      out.grab = { held, shots: shotLog.filter(s => s.g === 'Guard 1').length, why: g1.gunfire.why };
      cq.cancel();
      // down: unconscious / defeated never fire
      g1.reset(); range(7); g1.ko.knockOut({ position: g1.position.clone(), along: new THREE.Vector3(1, 0, 0), by: motor.position.clone() }); shotLog.length = 0;
      for (let i = 0; i < 60 * 5; i++) { keepAlive(); MV.tick(1 / 60, true); }
      out.uncon = shotLog.filter(s => s.g === 'Guard 1').length;
      g1.reset(); range(7); for (let k = 0; k < 3; k++) g1.health.take({ amount: 35, source: 'pistol', id: 'k' + k }); shotLog.length = 0;
      for (let i = 0; i < 60 * 5; i++) { keepAlive(); MV.tick(1 / 60, true); }
      out.dead = shotLog.filter(s => s.g === 'Guard 1').length;
      return out;
    });
    const o = r, cfg = { interval: 1.5, jitter: 0.2 };
    const ok = o.n >= 4 && o.legit && o.firstAt > o.startleEnd && o.minGap >= cfg.interval - cfg.jitter - 0.02 && o.maxGap <= 4
      && o.steps.shots === 0 && o.steps.w === 'LOWERED' && o.gun.shots === 0 && o.gun.w !== 'LOWERED' && !o.gun.visible
      && o.hidden.late === 0 && o.hidden.hits === 0 && ['EVASION', 'ALERT'].indexOf(o.hidden.aware) >= 0
      && o.two.a >= 3 && o.two.b >= 3 && o.two.close < Math.min(o.two.a, o.two.b) / 2
      && o.grab.held > 150 && o.grab.shots === 0 && o.uncon === 0 && o.dead === 0 && page.errors.length === 0;
    return { pass: ok, detail: `in plain view at 7 m: ${o.n} shots in 12 s, all READY / not startled / target visible ${o.legit}; first shot ${o.firstAt != null ? (o.firstAt - o.startleEnd).toFixed(2) : '–'} s after his startle ended; gaps ${o.minGap.toFixed(2)}–${o.maxGap.toFixed(2)} s; footsteps: ${o.steps.shots} shots (pistol ${o.steps.w}); a gunshot heard: ${o.gun.shots} shots (pistol ${o.gun.w} → ${o.gun.type}); behind the tall crate: ${o.hidden.shots} shots (${o.hidden.late} after the moment he lost her, ${o.hidden.hits} hits), ${o.hidden.aware}; both guards seeing her: ${o.two.a} / ${o.two.b} shots, ${o.two.close} within 50 ms of each other; grabbed ${o.grab.held} frames: ${o.grab.shots} shots (${o.grab.why}); unconscious ${o.uncon}, defeated ${o.dead} shots; page errors ${page.errors.length}` };
  },

  // the bullets: from his real muzzle along where his pistol points; walls and crates stop them;
  // crouched behind the low crate only what shows above it can be hit; misses do nothing, every
  // hit is one 20 HP event; accuracy worse moving and far (seeded); one flash, sound and noise
  // event per shot, heard by the other guard, not by himself
  async gunfireShots() {
    const page = await CHECKS._gunPage();
    const r = await page.evaluate(() => {
      const { motor, input, noise } = MV, g1 = MV.guard, g2 = MV.guard2, G = g1.gunfire, W = g1.weapon, P = MV.playerHealth;
      const out = {};
      // muzzle: on his pistol, along his aim
      range(7); for (let i = 0; i < 60 * 6; i++) { keepAlive(); MV.tick(1 / 60, true); }
      const m = W.muzzle(new THREE.Vector3()), gunPos = W.gun.getWorldPosition(new THREE.Vector3()), gunFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(W.gun.getWorldQuaternion(new THREE.Quaternion()));
      out.muzzle = { fromGun: m.distanceTo(gunPos), along: m.clone().sub(gunPos).normalize().dot(gunFwd), aimVsGun: W.aimDir.angleTo(gunFwd) * 57.3 };
      // accuracy (seeded; her health kept up so the count runs): still at 5 / 10 / 15 m, walking at 7.5 m
      const rate = (d, walk) => { range(d); G.reset(); let i = 0; while (G.shots < 40 && i < 60 * 80) { keepAlive(); if (walk) { input.move.x = Math.sin(i / 90) > 0 ? 0.55 : -0.55; } MV.tick(1 / 60, true); i++; } input.move.x = 0; return G.hits / Math.max(1, G.shots); };
      out.acc = { d5: rate(5), d10: rate(10), d15: rate(15), still75: rate(7.5), walk75: rate(7.5, true) };
      // repeatable: the same seed, the same shots
      const seq = () => { range(7); G.reset(); const ks = []; let i = 0; while (G.shots < 8 && i < 60 * 30) { keepAlive(); MV.tick(1 / 60, true); i++; if (G.lastShot && ks.length < G.shots) ks.push((G.lastShot.offset / G.lastShot.spread).toFixed(5)); } return ks.join(); };   // (the seeded part of the spread: the same draws in the same order)
      out.repeat = seq() === seq();
      // each hit is one 20 HP damage event; misses nothing
      range(7); G.reset(); let lost = 0, hp0 = P.current, i = 0; const kinds = [];
      while (G.shots < 4 && i < 60 * 20) { MV.tick(1 / 60, true); i++; }
      out.dmg = { shots: G.shots, hits: G.hits, lost: 100 - P.current, events: P.history.length, miss: G.misses };
      // walls / crates: fired along a line through the tall crate and the long wall, never her
      const shootAt = (from, to) => { const d = to.clone().sub(from).normalize(); return G._resolve(from, d); };
      motor.teleport(-2, -6.9, 0); sim(3);
      out.crate = shootAt(new THREE.Vector3(-2, 1.3, -10.5), new THREE.Vector3(-2, 1.2, -6.9)).kind + '/' + shootAt(new THREE.Vector3(-2, 1.3, -10.5), new THREE.Vector3(-2, 1.2, -6.9)).what;
      motor.teleport(4, 14.5, 0); sim(3);
      out.wall = shootAt(new THREE.Vector3(4, 1.4, 10), new THREE.Vector3(4, 1.2, 14.5)).what;
      // crouched behind the low crate (0.9 m), a guard standing 6 m off at shooting height: rays in a fan across her
      motor.teleport(3, -4.0, Math.PI); input.setCrouch(true); sim(90);
      const hb = P.hitbox({}), from = new THREE.Vector3(3, 1.45, -11); let low = 0, high = 0, lowHits = 0, highHits = 0;
      for (let y = 0.1; y <= hb.top + 0.2; y += 0.05) for (let x = -0.3; x <= 0.3; x += 0.1) {
        const res = shootAt(from, new THREE.Vector3(hb.x + x, y, hb.z)); const yAtCrate = from.y + (y - from.y) * ((-5.5 - from.z) / (hb.z - from.z));
        if (yAtCrate < 0.88) { low++; if (res.kind === 'player') lowHits++; } else { high++; if (res.kind === 'player') highHits++; } }
      input.setCrouch(false); sim(30);
      out.cover = { top: hb.top, low, lowHits, high, highHits };
      // effects and the noise event: once per shot, from him, heard by Guard 2, not by himself
      g2.reset(); range(7); const evs = []; const off = noise.on(e => { if (e.type === 'gunshot') evs.push(e); });
      const s0 = G.sounds || 0, f0 = G.flashes || 0, h1 = g1.hearing.heardCount, h2 = g2.hearing.heardCount; G.reset();
      i = 0; while (G.shots < 3 && i < 60 * 20) { keepAlive(); MV.tick(1 / 60, true); i++; }
      out.fx = { shots: G.shots, events: evs.length, by: evs.every(e => e.by === g1 && e.level === 5), at: evs.length ? evs[evs.length - 1].position.distanceTo(new THREE.Vector3(G.lastShot.from.x, 0, G.lastShot.from.z)) : null, /* (the last event is the last shot's) */ sounds: (G.sounds || 0) - s0, flashes: (G.flashes || 0) - f0, selfHeard: g1.hearing.heardCount - h1, otherHeard: g2.hearing.heardCount - h2 };
      return out;
    });
    const o = r, A = o.acc, ok = o.muzzle.fromGun < 0.25 && o.muzzle.along > 0.9 && o.muzzle.aimVsGun < 12
      && A.d5 >= 0.55 && A.d5 <= 0.9 && A.still75 >= 0.5 && A.still75 <= 0.85 && A.d10 >= 0.45 && A.walk75 < A.still75 - 0.2 && A.d15 < A.d5 && o.repeat
      && o.dmg.lost === 20 * o.dmg.hits && o.dmg.events === o.dmg.hits && o.dmg.miss === o.dmg.shots - o.dmg.hits
      && o.crate === 'world/crate' && o.wall === 'wall' && o.cover.lowHits === 0 && o.cover.highHits > 0 && o.cover.top < 1.35
      && o.fx.shots === 3 && o.fx.events === 3 && o.fx.by && o.fx.at < 1e-6 && o.fx.sounds === 3 && o.fx.flashes === 3 && o.fx.selfHeard === 0 && o.fx.otherHeard >= 1 && page.errors.length === 0;
    const pc = v => Math.round(v * 100) + '%';
    return { pass: ok, detail: `muzzle ${cm(o.muzzle.fromGun)} from his pistol, along it ${o.muzzle.along.toFixed(2)}, aim vs pistol ${o.muzzle.aimVsGun.toFixed(1)}°; hit rate (40 seeded shots each): still 5 m ${pc(A.d5)}, 7.5 m ${pc(A.still75)}, 10 m ${pc(A.d10)}, 15 m ${pc(A.d15)}; walking at 7.5 m ${pc(A.walk75)}; repeatable ${o.repeat}; 4 shots → ${o.dmg.hits} hits, ${o.dmg.lost} HP lost in ${o.dmg.events} events, ${o.dmg.miss} misses cost nothing; through the tall crate → ${o.crate}, the long wall → ${o.wall}; crouched behind the low crate (her top ${o.cover.top.toFixed(2)} m): rays crossing the crate below its top ${o.cover.lowHits}/${o.cover.low} hit her, above it ${o.cover.highHits}/${o.cover.high}; 3 shots: ${o.fx.events} gunshot events (level 5, his, at his muzzle ${o.fx.at != null ? o.fx.at.toFixed(3) : '–'} m), ${o.fx.sounds} sounds, ${o.fx.flashes} flashes; heard by himself ${o.fx.selfHeard}, by Guard 2 ${o.fx.otherHeard}; page errors ${page.errors.length}` };
  },

  // hurt, she carries on (moves, aims, shoots as before); at 0 HP PLAYER_DEFEATED: down on the
  // ground, nothing works but RESET, no more damage, the message; RESET: 100 HP, up, controls
  // back, the guards' firing cleared
  async playerDefeat() {
    const page = await CHECKS._gunPage();
    const r = await page.evaluate(() => {
      const { motor, input, cam } = MV, P = MV.playerHealth, A = MV.aim, g1 = MV.guard, msg = document.getElementById('mv-defeat');
      const out = {};
      range(30); P.take({ amount: 20, source: 'Guard 1', id: 'a' }); P.take({ amount: 20, source: 'Guard 1', id: 'b' }); sim(40);
      // still moving (her normal speeds), aiming and shooting
      motor.teleport(-6, -20, 0); cam.snap(motor); input.move.y = 1; let spd = 0; for (let i = 0; i < 110; i++) { MV.tick(1 / 60, true); spd = Math.max(spd, motor.speed); } input.move.y = 0; sim(60);
      input.aimTapped = true; sim(60); const aimOn = A.active; const s0 = MV.pistol.shots; window.__t = (window.__t || 1e4) + 1000; input._firePress(window.__t); MV.tick(1 / 60, true);
      out.hurt = { hp: P.current, spd, aimOn, shot: MV.pistol.shots - s0 };
      // three more hits: defeated (while aiming)
      for (const id of ['c', 'd', 'e']) P.take({ amount: 20, source: 'Guard 2', id }); MV.tick(1 / 60, true);
      const p0 = motor.position.clone();
      input.move.y = 1; input.aimTapped = true; input.cqcTapped = true; window.__t += 1000; input._firePress(window.__t); sim(120); input.move.y = 0;
      const R = MV.visual.root, Wp = b => b.getWorldPosition(new THREE.Vector3()), Bv = MV.visual.bones, spineQ = Bv.spine.quaternion.clone(), headP = Wp(Bv.head);
      sim(90); const still = Bv.spine.quaternion.equals(spineQ) && Wp(Bv.head).distanceTo(headP) < 1e-9;   /* (settled: posed once, never redone) */
      out.down = { state: P.state, aim: A.active, moved: motor.position.distanceTo(p0), cqc: MV.cqc.state, shots: MV.pistol.shots - s0, msg: !msg.hidden && /DEFEATED/.test(msg.textContent), hipsY: Wp(Bv.hips).y, headY: Wp(Bv.head).y, still, low: MV.SCmv.ThrowAnim.lowest({ model: MV.visual.model, bones: MV.visual.bones }) - motor.position.y, more: P.take({ amount: 20, source: 'Guard 1', id: 'z' }).applied, hp: P.current, gait: document.getElementById('mv-gait').textContent };
      // the guards stop firing at a defeated player
      range(7); P.take({ amount: 500, source: 'test', id: 'end' }); shotLog.length = 0; for (let i = 0; i < 60 * 8; i++) MV.tick(1 / 60, true);
      out.noFire = { shots: shotLog.length, why: g1.gunfire.why };
      // RESET
      document.getElementById('mv-reset').click(); sim(3);
      out.reset = { hp: P.current, state: P.state, msg: msg.hidden, upright: MV.visual.fall.quaternion.w === 1 && MV.visual.fall.position.length() === 0 && MV.visual.bones.head.getWorldPosition(new THREE.Vector3()).y > 1.35, spawn: Math.hypot(motor.position.x - MV.area.spawn.x, motor.position.z - MV.area.spawn.z), g: [g1, MV.guard2].map(g => [g.gunfire.shots, g.gunfire.cooldown, g.weapon.state].join(',')), body: document.body.classList.contains('mv-defeated') };
      input.move.y = 1; let spd2 = 0; for (let i = 0; i < 110; i++) { MV.tick(1 / 60, true); spd2 = Math.max(spd2, motor.speed); } input.move.y = 0;
      out.reset.spd = spd2;
      return out;
    });
    const o = r, ok = o.hurt.hp === 60 && o.hurt.spd > 3.1 && o.hurt.aimOn && o.hurt.shot === 1
      && o.down.state === 'PLAYER_DEFEATED' && !o.down.aim && o.down.moved < 0.05 && o.down.cqc === 'FREE' && o.down.shots === 1 && o.down.msg && o.down.hipsY < 0.35 && o.down.headY < 0.45 && o.down.still && o.down.low > -0.01 && o.down.low < 0.1 && !o.down.more && o.down.hp === 0 && /PLAYER_DEFEATED/.test(o.down.gait)
      && o.noFire.shots === 0 && o.noFire.why === 'target down'
      && o.reset.hp === 100 && o.reset.state === 'OK' && o.reset.msg && o.reset.upright && o.reset.spawn < 0.01 && o.reset.g.every(x => x === '0,0,LOWERED') && !o.reset.body && o.reset.spd > 3.1 && page.errors.length === 0;
    return { pass: ok, detail: `at ${o.hurt.hp} HP: jogs at ${o.hurt.spd.toFixed(2)} m/s, AIM ${o.hurt.aimOn}, FIRE → ${o.hurt.shot} shot; three more hits: ${o.down.state}, AIM ${o.down.aim}, moved ${cm(o.down.moved)} with the stick held, CQC ${o.down.cqc}, FIRE presses after: ${o.down.shots - 1} shots, message ${o.down.msg}, lying: hips ${o.down.hipsY.toFixed(2)} m, head ${o.down.headY.toFixed(2)} m, lowest point ${cm(o.down.low)}, still once settled ${o.down.still}, more damage ${o.down.more}, STATS "${o.down.gait}"; guards at a defeated player: ${o.noFire.shots} shots (${o.noFire.why}); RESET: ${o.reset.hp} HP ${o.reset.state}, message hidden ${o.reset.msg}, upright ${o.reset.upright}, at the spawn, guards ${o.reset.g.join(' / ')}, jogs ${o.reset.spd.toFixed(2)} m/s; page errors ${page.errors.length}` };
  },

  // CQC against armed, ALERT guards: grab (his firing stops), THROW and CHOKE knock him out,
  // the quick takedown works, break-free: he must get READY again before he can fire; the
  // other guard can still fire while she holds someone
  async gunfireCqc() {
    const page = await CHECKS._gunPage();
    const r = await page.evaluate(() => {
      const { motor, input } = MV, g1 = MV.guard, g2 = MV.guard2, cq = MV.cqc, P = MV.playerHealth;
      const out = {};
      const armed = () => { range(7); for (let i = 0; i < 60 * 5; i++) { keepAlive(); MV.tick(1 / 60, true); } const q = g1.position.clone().addScaledVector(g1.forward(), 1.0); motor.teleport(q.x, q.z, g1.yaw + Math.PI); MV.cam.snap(motor); sim(1); return g1.weapon.state; };
      out.ready = armed(); input.cqcTapped = true; sim(40); out.grab = cq.state; input.throwTapped = true; let n = 0; while (g1.ko.state !== 'UNCONSCIOUS' && n < 200) { keepAlive(); MV.tick(1 / 60, true); n++; } out.thrown = g1.ko.state;
      cq.cancel(); armed(); input.cqcTapped = true; sim(40); input._chokeKey = true; input.chokePresses++; n = 0; while (g1.ko.state !== 'UNCONSCIOUS' && n < 600) { keepAlive(); MV.tick(1 / 60, true); n++; } input._chokeKey = false; out.choked = g1.ko.state;
      cq.cancel(); armed(); cq.input._cqcPress(performance.now() - 1000); n = 0; while (g1.ko.state !== 'UNCONSCIOUS' && n < 300) { keepAlive(); MV.tick(1 / 60, true); n++; } cq.input._cqcUp(performance.now()); out.takedown = g1.ko.state;
      // break-free: back up, steadied, then fires
      cq.cancel(); armed(); input.cqcTapped = true; sim(40); cq.bf.left = 0.05; n = 0; while (cq.state !== 'FREE' && n < 120) { keepAlive(); MV.tick(1 / 60, true); n++; }
      shotLog.length = 0; const t0 = g1.awareness.clock; for (let i = 0; i < 60 * 6; i++) { keepAlive(); MV.tick(1 / 60, true); }
      const s = shotLog.filter(x => x.g === 'Guard 1');
      out.broke = { first: s.length ? s[0].t - t0 : null, legit: s.every(x => x.state === 'READY' && x.visible) };
      // the other guard fires while she holds Guard 1 (Guard 2 brought to an open spot facing them)
      cq.cancel(); armed(); input.cqcTapped = true; sim(40);
      { const px = motor.position.x - 4, pz = motor.position.z + 0.5, yaw = Math.atan2(motor.position.x - px, motor.position.z - pz); g2.reset(); g2.motor.teleport(px, pz, yaw); g2.post.copy(g2.position); g2.postYaw = yaw; g2.wantYaw = yaw; g2.place(); } shotLog.length = 0;   // (4 m to her side, facing her, calm)
      for (let i = 0; i < 60 * 10 && cq.state === 'GRAPPLING'; i++) { keepAlive(); if (cq.bf) cq.bf.left = 9; MV.tick(1 / 60, true); }
      out.other = { g2: shotLog.filter(x => x.g === 'Guard 2').length, g1: shotLog.filter(x => x.g === 'Guard 1').length, cqc: cq.state };
      cq.cancel();
      return out;
    });
    const o = r, ok = o.ready === 'READY' && o.grab === 'GRAPPLING' && o.thrown === 'UNCONSCIOUS' && o.choked === 'UNCONSCIOUS' && o.takedown === 'UNCONSCIOUS'
      && o.broke.first != null && o.broke.first > 0.45 && o.broke.legit && o.other.g1 === 0 && o.other.g2 >= 1 && page.errors.length === 0;
    return { pass: ok, detail: `armed, READY Guard 1 at arm's length: TAP → ${o.grab}, THROW → ${o.thrown}; CHOKE → ${o.choked}; HOLD (quick takedown) → ${o.takedown}; broke free: first shot ${o.broke.first != null ? o.broke.first.toFixed(2) + ' s' : 'none'} later, only READY on a visible target ${o.broke.legit}; holding Guard 1 in Guard 2's view: Guard 2 fired ${o.other.g2}, Guard 1 ${o.other.g1}; page errors ${page.errors.length}` };
  },

  // iPhone: in Guard 2's view he fires and she's hit (HP drops by 20s); she walks behind the
  // tall crate by touch and the hits stop; the controls answer throughout; frame rate while
  // both guards are firing at her moving
  async gunfireTouch() {
    const page = await CHECKS._gunPage(true), Tc = page.touch;
    await page.evaluate(() => { const g = MV.guard2, gp = g.position.clone(), f = g.forward(); MV.motor.teleport(gp.x + f.x * 3, gp.z + f.z * 3, Math.atan2(-f.x, -f.z)); MV.cam.snap(MV.motor); });
    await page.waitForFunction(() => MV.playerHealth.current < 100 || MV.guard2.gunfire.shots >= 3, null, { timeout: 30000, polling: 'raf' }).catch(() => {});
    const r0 = await page.evaluate(() => ({ hp: MV.playerHealth.current, shots: MV.guard2.gunfire.shots, hits: MV.guard2.gunfire.hits, stat: document.getElementById('mv-gait').textContent }));
    // walking by touch with shots landing: the stick keeps working
    await page.evaluate(() => { MV.motor.teleport(-6, -10, Math.PI); MV.cam.snap(MV.motor); const g1 = MV.guard; g1.patrol.enabled = false; g1.post.set(-6, 0, -16); g1.postYaw = 0; g1.reset(); MV.playerHealth.reset(); window.__hk = setInterval(() => { const P = MV.playerHealth; if (P.current < 60) { P.current = 100; P.state = 'OK'; } }, 50); });
    await page.waitForFunction(() => MV.guard.gunfire.shots >= 1, null, { timeout: 20000, polling: 'raf' }).catch(() => {});
    // performance: the frame rate here drifts ±25% from one window to the next whatever the game does, so firing
    // and not firing are measured in alternating 2 s windows (drift hits both alike), and the guards' own work per
    // frame is timed directly
    await page.evaluate(() => { window.__f = 0; (function f() { window.__f++; requestAnimationFrame(f); })(); window.__gt = 0; window.__gn = 0;
      for (const g of MV.guards) { const u = g.update.bind(g); g.update = (dt, t) => { const t0 = performance.now(); u(dt, t); window.__gt += performance.now() - t0; window.__gn++; }; g.gunfire.__u = g.gunfire.update; } });
    const win = async firing => { await page.evaluate(f => { for (const g of MV.guards) g.gunfire.update = f ? g.gunfire.__u : () => {}; window.__f = 0; window.__w0 = performance.now(); window.__gt = 0; window.__gn = 0; }, firing); await page.waitForTimeout(2000);
      return page.evaluate(() => ({ fps: window.__f / ((performance.now() - window.__w0) / 1000), ms: window.__gt / Math.max(1, window.__gn) * 2 })); };
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); let moved = 0;   /* (held sideways, a steady stealth walk, under fire) */
    const W = { on: [], off: [] };
    for (let k = 0; k < 4; k++) { await Tc('touchMove', [{ x: 150 + (k % 2 ? -52 : 52), y: 300, id: 1 }]); const w = await win(k % 2 === 0); (k % 2 === 0 ? W.on : W.off).push(w); moved = Math.max(moved, await page.evaluate(() => MV.motor.speed)); }
    await Tc('touchEnd', []);
    for (const g of [0, 1]) await page.evaluate(i => { MV.guards[i].gunfire.update = MV.guards[i].gunfire.__u; }, g);
    const sum = a => a.reduce((t, x) => t + x.fps, 0), fps = sum(W.on) / W.on.length, calm = sum(W.off) / W.off.length, gms = Math.max(...W.on.map(x => x.ms));
    const r1 = await page.evaluate(() => ({ shots: MV.guard.gunfire.shots, joy: MV.input.joy }));
    await page.evaluate(() => clearInterval(window.__hk));
    await page.tap('#mv-reset'); await page.waitForTimeout(400);
    const r2 = await page.evaluate(() => ({ hp: MV.playerHealth.current, state: MV.playerHealth.state, shots: MV.guard.gunfire.shots + MV.guard2.gunfire.shots }));
    const ok = r0.shots >= 1 && (r0.hp === 100 - 20 * r0.hits) && moved > 1 && r1.shots >= 2 && fps > calm * 0.7 && gms < 4 && r2.hp === 100 && r2.state === 'OK' && r2.shots === 0 && page.errors.length === 0;
    return { pass: ok, detail: `in Guard 2's view: ${r0.shots} shots, ${r0.hits} hits → ${r0.hp} HP (STATS "${r0.stat.slice(0, 60)}"); strafing by touch under fire: up to ${moved.toFixed(2)} m/s, Guard 1 fired ${r1.shots}; frame rate strafing under fire ${fps.toFixed(1)} fps vs ${calm.toFixed(1)} not fired at, alternating windows (≥ 70%); both guards' own work ${gms.toFixed(2)} ms a frame under fire (< 4 ms); RESET → ${r2.hp} HP ${r2.state}, shots cleared ${r2.shots === 0}; page errors ${page.errors.length}` };
  },

  // ---------------------------------------------------------------- Step 21: guard weapon readiness and aiming (nothing fires)
  async _weaponPage(touch) {
    const page = touch ? await touchPage() : await simPage();
    await page.evaluate(() => {
      const dt = 1 / 60;
      window.sim = n => { for (let i = 0; i < n; i++) MV.tick(dt, true); };
      window.wlog = (g, n, tag, out) => { let last = ''; for (let i = 0; i < n; i++) { MV.tick(dt, true); const W = g.weapon, a = g.awareness, s = `${a.state}|${a.isStartled()}|${W.state}|${W.target.type}|${W.target.visible}`; if (s !== last) { out.push({ tag, t: i / 60, aware: a.state, startled: a.isStartled(), state: W.state, k: W.k, target: W.target.type, visible: W.target.visible, why: W.why, err: W.err }); last = s; } } return out; };
      window.ang = (a, b) => a.angleTo(b) * 57.2958;
      // her d m in front of him, facing him (Guard 2 faces a wall ≈ 3.5 m off his post: keep d below that); throws if there's a wall between
      window.front = (g, d) => { const gp = g.position.clone(), f = g.forward(); MV.motor.teleport(gp.x + f.x * d, gp.z + f.z * d, Math.atan2(-f.x, -f.z)); MV.cam.snap(MV.motor); if (MV.world.segmentBlocked(new THREE.Vector3(gp.x, 1.5, gp.z), new THREE.Vector3(MV.motor.position.x, 1.2, MV.motor.position.z))) throw new Error('front(): something solid between them at ' + d + ' m'); };
    });
    return page;
  },

  // holstered at the start; seen: ALERT at once, startled, the draw held part-way while he
  // recovers (offenseReady), up and READY right after it ends (no second delay), the raise
  // smooth; a second sighting later doesn't start it over
  async weaponReady() {
    const page = await CHECKS._weaponPage();
    const r = await page.evaluate(() => {
      const g1 = MV.guard, g2 = MV.guard2, W = g2.weapon;
      const start = [g1.weapon.state, g1.weapon.k, g1.weapon.holster.visible, g1.weapon.gun.visible, g2.weapon.state, g2.weapon.k];
      g1.patrol.enabled = false; g1.reset(); g2.reset(); sim(5);
      front(g2, 3); const log = [], ks = [], hand = [];
      let alertAt = null, startEnd = null, readyAt = null, maxK = 0, maxStep = 0, kStart = 0, prevK = 0, prevGun = null, gunJump = 0;
      for (let i = 0; i < 360; i++) { MV.tick(1 / 60, true); const a = g2.awareness;
        if (a.state === 'ALERT' && alertAt == null) alertAt = i;
        if (alertAt != null && a.isStartled()) { maxK = Math.max(maxK, W.k); startEnd = i; }
        if (W.state === 'READY' && readyAt == null) readyAt = i;
        maxStep = Math.max(maxStep, Math.abs(W.k - prevK)); prevK = W.k;
        if (W.gun.visible) { const p = W.gun.getWorldPosition(new THREE.Vector3()); if (prevGun) gunJump = Math.max(gunJump, p.distanceTo(prevGun)); prevGun = p; } }
      const startled = !!(g2.awareness.startles), dur = g2.awareness.startle && g2.awareness.startle.duration;
      const firstAlert = { aware: g2.awareness.state, startled, dur };
      // ALERT the very frame the meter fills: the awareness says so (Step 12's own check), here: the frame of ALERT == the startle start
      const st = g2.awareness.startle;
      // hidden then seen again: no new startle, no new draw
      const draws0 = W.draws, startles0 = g2.awareness.startles; MV.motor.teleport(-2, -7.0, 0); MV.cam.snap(MV.motor); sim(30); front(g2, 3); sim(120);
      const again = { draws: W.draws - draws0, startles: g2.awareness.startles - startles0, state: W.state };
      return { start, alertAt, startEnd, readyAt, maxK, maxStep, gunJump, firstAlert, again, recoveringMax: W.cfg.recoveringMax, drawTime: W.cfg.drawTime, startleStart: st ? st.start : null };
    });
    const o = r, afterRecovery = (o.readyAt - o.startEnd) / 60, recovery = (o.startEnd - o.alertAt) / 60;
    const ok = o.start.join() === 'LOWERED,0,true,false,LOWERED,0' && o.alertAt != null && o.firstAlert.startled && o.maxK <= o.recoveringMax + 1e-6 && o.maxK > 0.2
      && o.readyAt > o.startEnd && afterRecovery <= o.drawTime * (1 - o.recoveringMax) + 0.1 && o.maxStep <= 1 / 60 / o.drawTime * 1.4 + 1e-6 && o.gunJump < 0.12
      && o.again.draws === 0 && o.again.startles === 0 && o.again.state === 'READY' && page.errors.length === 0;
    return { pass: ok, detail: `start: both LOWERED (pistol holstered ${o.start[2]}, in hand ${o.start[3]}); seen at 3 m: ALERT and startled (${o.firstAlert.dur} s), the draw held at ≤ ${Math.round(o.maxK * 100)}% for the ${recovery.toFixed(2)} s recovery, READY ${afterRecovery.toFixed(2)} s after it ended (≤ ${(o.drawTime * (1 - o.recoveringMax) + 0.1).toFixed(2)} s: no second delay); raise ≤ ${(o.maxStep * 100).toFixed(1)}%/frame, pistol ≤ ${cm(o.gunJump)}/frame; hidden and seen again: ${o.again.draws} new draws, ${o.again.startles} new startles, ${o.again.state}; page errors ${page.errors.length}` };
  },

  // tracking only what he sees: her observed chest while visible (follows her walking, crouched,
  // smoothly, rate-limited); behind the tall crate: the last place he saw her, never where she is
  async weaponTracking() {
    const page = await CHECKS._weaponPage();
    const r = await page.evaluate(() => {
      const { motor, input } = MV, g1 = MV.guard, g2 = MV.guard2, W = g2.weapon;
      g1.patrol.enabled = false; g1.reset(); g2.reset(); sim(5);
      front(g2, 3); sim(300);
      const chestOf = () => MV.visual.bones.chest.getWorldPosition(new THREE.Vector3());
      // she walks sideways while visible (a sneak): the aim follows her, never faster than its rate
      let maxErr = 0, maxRate = 0, prev = W.aimDir.clone(), vis = 0;
      const b0 = W.aimDir.clone();
      input.move.x = 0.8; for (let i = 0; i < 120; i++) { MV.tick(1 / 60, true); if (W.target.visible) { vis++; if (i > 30) maxErr = Math.max(maxErr, W.err); } maxRate = Math.max(maxRate, ang(W.aimDir, prev) * 60); prev.copy(W.aimDir); }
      input.move.x = 0; sim(60);
      const turned = ang(b0, W.aimDir), toHer = ang(W.aimDir, chestOf().sub(g2.bones.chest.getWorldPosition(new THREE.Vector3())).normalize());
      // crouched and visible: the aim drops to her
      input.setCrouch(true); sim(90); const crouchErr = W.err, crouchY = W.target.point ? W.target.point.y : null; input.setCrouch(false); sim(60);
      // behind the tall crate (out of sight): his aim stays on the last place he saw her
      motor.teleport(-2, -6.9, 0); MV.cam.snap(motor); sim(2);
      const lastSeen = g2.awareness.seen.position.clone(); let follows = 0, maxDev = 0;
      input.move.x = 1; for (let i = 0; i < 40; i++) { MV.tick(1 / 60, true); if (W.target.visible) follows++; if (W.target.point && W.target.type === 'last seen') maxDev = Math.max(maxDev, Math.hypot(W.target.point.x - lastSeen.x, W.target.point.z - lastSeen.z)); }
      input.move.x = 0;
      const hidden = { type: W.target.type, follows, maxDev, her: Math.hypot(motor.position.x - lastSeen.x, motor.position.z - lastSeen.z) };
      sim(120); const later = { aware: g2.awareness.state, type: W.target.type, state: W.state };
      return { vis, maxErr, maxRate, turned, toHer, crouchErr, crouchY, hidden, later, rate: W.cfg.trackRate * 57.2958 };
    });
    const o = r, ok = o.vis > 100 && o.turned > 5 && o.toHer < 8 && o.maxErr < 10 && o.maxRate <= o.rate + 1 && o.crouchErr < 8 && o.crouchY != null && o.crouchY < 1.0
      && o.hidden.type === 'last seen' && o.hidden.follows === 0 && o.hidden.maxDev < 1e-6 && o.hidden.her > 0.3 && ['EVASION', 'ALERT'].indexOf(o.later.aware) >= 0 && page.errors.length === 0;
    return { pass: ok, detail: `she walked sideways in view: his aim turned ${o.turned.toFixed(1)}° with her (${o.toHer.toFixed(1)}° off her chest at the end, ≤ ${o.maxErr.toFixed(1)}° while moving, ≤ ${o.maxRate.toFixed(0)}°/s, limit ${o.rate.toFixed(0)}); crouched: ${o.crouchErr.toFixed(1)}° off, aiming ${o.crouchY != null ? o.crouchY.toFixed(2) : '–'} m up; behind the tall crate, moving ${o.hidden.her.toFixed(2)} m: target "${o.hidden.type}", frames tracking her ${o.hidden.follows}, his target ${o.hidden.maxDev.toFixed(3)} m from where he last saw her; 2 s later ${o.later.aware}, ${o.later.state} → ${o.later.type}; page errors ${page.errors.length}` };
  },

  // hearing vs sight: ordinary footsteps → suspicious, pistol stays holstered; a gunshot heard
  // without a sighting → pistol up at the sound's origin (never her), lowered once he settles
  // (NORMAL); Guard 1 drawing from his patrol; the two guards independent
  async weaponEvidence() {
    const page = await CHECKS._weaponPage();
    const r = await page.evaluate(() => {
      const { motor, input, noise } = MV, g1 = MV.guard, g2 = MV.guard2;
      motor.teleport(-19, 19, 0); MV.cam.snap(motor); g1.patrol.enabled = false; g1.reset(); g2.reset(); sim(5);   // (she starts far off, out of everyone's sight)
      // footsteps behind Guard 2 (heard, not seen)
      const gp = g2.position.clone(), f = g2.forward();
      for (let k = 0; k < 6; k++) { noise.emit(2, 'footstep', new THREE.Vector3(gp.x - f.x * 3, 0, gp.z - f.z * 3), 'concrete', 'player'); sim(25); }
      const steps = { aware: g2.awareness.state, w: g2.weapon.state, k: g2.weapon.k, g1: g1.weapon.state };
      g2.reset(); sim(5);
      // a gunshot behind him, she out of sight elsewhere
      motor.teleport(-19, 19, 0); MV.cam.snap(motor); sim(5);
      const origin = new THREE.Vector3(gp.x - f.x * 6, 0, gp.z - f.z * 6);
      noise.emit(5, 'gunshot', origin, 'concrete', 'player'); sim(90);
      const W = g2.weapon, gun = { aware: g2.awareness.state, w: W.state, k: W.k, type: W.target.type, at: W.target.point ? Math.hypot(W.target.point.x - origin.x, W.target.point.z - origin.z) : null, her: W.target.point ? Math.hypot(W.target.point.x - motor.position.x, W.target.point.z - motor.position.z) : null, visible: W.target.visible, seen: g2.awareness.seen };
      // he settles (NORMAL): the pistol goes back
      let n = 0; while (g2.awareness.state !== 'NORMAL' && n < 6000) { MV.tick(1 / 20, true); n++; }
      sim(120); const settled = { aware: g2.awareness.state, w: W.state, k: W.k, lowers: W.lowers };
      // Guard 1: on patrol, she steps into his view: ALERT → he draws while his patrol gives way
      g2.reset(); g1.patrol.enabled = true; g1.personality.enabled = false; g1.reset(); sim(120);
      front(g1, 6); const log = []; wlog(g1, 300, 'g1', log);
      const g1r = { states: [...new Set(log.map(x => x.state))], aware: g1.awareness.state, w: g1.weapon.state, g2: g2.weapon.state, g2k: g2.weapon.k, g2type: g2.weapon.target.type, g2vis: g2.weapon.target.visible, g2shots: g2.gunfire ? g2.gunfire.shots : 0 };
      return { steps, gun, settled, g1r };
    });
    const o = r, ok = ['SUSPICIOUS', 'INVESTIGATING'].indexOf(o.steps.aware) >= 0 && o.steps.w === 'LOWERED' && o.steps.k === 0
      && o.gun.w !== 'LOWERED' && o.gun.k > 0.5 && o.gun.type === 'sound estimate' && o.gun.at < 1e-6 && o.gun.her > 5 && !o.gun.visible && o.gun.seen === null
      && o.settled.aware === 'NORMAL' && o.settled.w === 'LOWERED' && o.settled.k === 0 && o.settled.lowers >= 1
      && o.g1r.aware === 'ALERT' && o.g1r.states.indexOf('DRAWING') >= 0 && (o.g1r.w === 'READY' || o.g1r.w === 'AIMING') && o.g1r.g2 !== 'READY' && !o.g1r.g2vis && o.g1r.g2type !== 'visual' && o.g1r.g2shots === 0 && page.errors.length === 0;   /* (Step 22: Guard 1 now fires; Guard 2 may raise his toward the gunshots he hears, never onto her) */
    return { pass: ok, detail: `footsteps behind Guard 2: ${o.steps.aware}, pistol ${o.steps.w}; a gunshot behind him (she 30 m away, unseen): ${o.gun.aware}, pistol ${o.gun.w} ${Math.round(o.gun.k * 100)}% → ${o.gun.type} ${o.gun.at != null ? o.gun.at.toFixed(3) + ' m from the shot' : ''} (${o.gun.her != null ? o.gun.her.toFixed(0) : '–'} m from her), no sighting ${o.gun.seen === null}; once he settled (${o.settled.aware}): ${o.settled.w}; Guard 1 seen on patrol: ${o.g1r.aware}, pistol ${o.g1r.states.join(' → ')}; Guard 2 meanwhile ${o.g1r.g2} → ${o.g1r.g2type} (never on her: ${!o.g1r.g2vis}, ${o.g1r.g2shots} shots); page errors ${page.errors.length}` };
  },

  // interruptions: a hit knocks the aim (not READY through the reaction) and he comes back to
  // it; grabbed: lowered at once, nothing tracked while held, nothing raised; broke free: up
  // again on what he legitimately has; unconscious and defeated: put away; RESET: holstered;
  // and nothing ever fires (no guard gunshot, no shots, no player damage)
  async weaponInterrupt() {
    const page = await CHECKS._weaponPage();
    const r = await page.evaluate(() => {
      const { motor, input, noise } = MV, g1 = MV.guard, g2 = MV.guard2, W = g2.weapon, cq = MV.cqc;
      const guardShots = []; noise.on(ev => { if (ev.type === 'gunshot' && ev.source !== 'player') guardShots.push(ev); });
      let fired = 0; for (const g of [g1, g2]) { const f = g.gunfire.fire.bind(g.gunfire); g.gunfire.fire = cf => { const x = f(cf); if (x) fired++; return x; }; }   /* (Step 22: every shot either guard fires) */
      g1.patrol.enabled = false; g1.reset(); g2.reset(); sim(5); front(g2, 3); sim(330);
      const ready0 = W.state;
      // a hit (as the pistol hands it: from her)
      const dir = g2.position.clone().sub(motor.position).setY(0).normalize();
      g2.health.take({ amount: 35, source: 'pistol', id: 't.1', dir, from: motor.position.clone() });
      const during = []; for (let i = 0; i < 40; i++) { MV.tick(1 / 60, true); during.push([W.state, W.kPose]); }
      const hit = { notReady: during.slice(0, 15).every(x => x[0] !== 'READY'), dipped: Math.min(...during.slice(0, 20).map(x => x[1])), back: W.state, hp: g2.health.current };
      sim(60); hit.after = W.state;
      // grabbed from the front while READY
      cq.cancel(); const p = g2.position.clone().addScaledVector(g2.forward(), 1.0); motor.teleport(p.x, p.z, g2.yaw + Math.PI); MV.cam.snap(motor); sim(2);
      input.cqcTapped = true; let grabK = [], tracked = 0; for (let i = 0; i < 90; i++) { MV.tick(1 / 60, true); if (g2.restraint) { grabK.push(W.k); if (W.target.type !== 'none') tracked++; } }
      const grab = { cqc: cq.state, kEnd: W.k, state: W.state, maxLate: Math.max(...grabK.slice(15)), tracked, gun: W.gun.visible };
      // broke free: ALERT, up again (on the last place he legitimately had her)
      cq.bf.left = 0.05; let n = 0; while (cq.state !== 'FREE' && n < 120) { MV.tick(1 / 60, true); n++; } sim(80);
      const broke = { cqc: cq.state, aware: g2.awareness.state, w: W.state, k: W.k, type: W.target.type };
      // thrown: unconscious → put away; wakes: draws again for the search
      cq.cancel(); g2.reset(); sim(5); const b2 = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b2.x, b2.z, g2.yaw); MV.cam.snap(motor); sim(3);
      input.cqcTapped = true; sim(40); input.throwTapped = true; n = 0; while (g2.ko.state !== 'UNCONSCIOUS' && n < 200) { MV.tick(1 / 60, true); n++; } sim(30);
      const ko = { ko: g2.ko.state, w: W.state, k: W.k, gun: W.gun.visible, type: W.target.type };
      // quick takedown still works on him (after RESET), and choke
      document.getElementById('mv-reset').click(); sim(3);
      // defeated: put away for good
      g2.reset(); sim(5); front(g2, 3); sim(330);
      for (let k = 0; k < 3; k++) g2.health.take({ amount: 35, source: 'pistol', id: 'd.' + k, dir, from: motor.position.clone() });
      sim(120); const dead = { ko: g2.ko.state, w: W.state, k: W.k, gun: W.gun.visible, type: W.target.type };
      document.getElementById('mv-reset').click(); sim(3);
      const reset = [g1, g2].map(g => [g.weapon.state, g.weapon.k, g.weapon.target.type, g.weapon.gun.visible, g.weapon.holster.visible].join(','));
      const fire = g2.weapon.canFire();
      return { ready0, hit, grab, broke, ko, dead, reset, guardShots: guardShots.length, firedTotal: fired, playerHealth: 'health' in MV.motor || 'hp' in MV.motor, canFireShape: Object.keys(fire).sort().join(',') };
    });
    const o = r, ok = o.ready0 === 'READY' && o.hit.notReady && o.hit.dipped < 0.75 && o.hit.hp === 65 && o.hit.after === 'READY'
      && o.grab.cqc === 'GRAPPLING' && o.grab.kEnd === 0 && o.grab.state === 'LOWERED' && o.grab.maxLate === 0 && o.grab.tracked === 0 && !o.grab.gun
      && o.broke.cqc === 'FREE' && ['ALERT', 'EVASION'].indexOf(o.broke.aware) >= 0 && o.broke.k > 0.5 && ['visual', 'last seen', 'search'].indexOf(o.broke.type) >= 0
      && o.ko.ko === 'UNCONSCIOUS' && o.ko.w === 'LOWERED' && o.ko.k === 0 && !o.ko.gun && o.ko.type === 'none'
      && o.dead.ko === 'DEAD' && o.dead.w === 'LOWERED' && o.dead.k === 0 && !o.dead.gun && o.dead.type === 'none'
      && o.reset.every(x => x === 'LOWERED,0,none,false,true') && o.guardShots === o.firedTotal && !o.playerHealth   /* (Step 22: guards fire now; one gunshot event per shot) */
      && o.canFireShape === 'blocked,dir,err,free,muzzle,offense,ok,ready,target,visible,why' && page.errors.length === 0;
    return { pass: ok, detail: `READY at 3 m: ${o.ready0}; hit (${o.hit.hp} HP): not READY through the reaction ${o.hit.notReady}, his aim knocked to ${Math.round(o.hit.dipped * 100)}% raised, back to ${o.hit.after}; grabbed: ${o.grab.cqc}, pistol ${o.grab.state} (${o.grab.kEnd}), raised while held ${o.grab.maxLate}, frames tracking ${o.grab.tracked}; broke free: ${o.broke.aware}, pistol up ${Math.round(o.broke.k * 100)}% → ${o.broke.type}; thrown: ${o.ko.ko}, pistol ${o.ko.w}; shot down: ${o.dead.ko}, pistol ${o.dead.w}; RESET: ${o.reset.join(' / ')}; guard gunshot events ${o.guardShots} for ${o.firedTotal} shots; canFire() reports ${o.canFireShape}; page errors ${page.errors.length}` };
  },

  // iPhone: walk up to Guard 2 in view by touch, he goes ALERT and comes up READY on her; she
  // strafes and he follows; behind the tall crate he doesn't; the frame rate with both guards aiming
  async weaponTouch() {
    const page = await touchPage(), Tc = page.touch;
    await page.evaluate(() => { const g = MV.guard2, gp = g.position.clone(), f = g.forward(); MV.motor.teleport(gp.x + f.x * 3, gp.z + f.z * 3, Math.atan2(-f.x, -f.z)); MV.cam.snap(MV.motor); });
    await page.waitForFunction(() => MV.guard2.weapon.state === 'READY', null, { timeout: 30000, polling: 'raf' }).catch(() => {});
    const r0 = await page.evaluate(() => ({ w: MV.guard2.weapon.state, aware: MV.guard2.awareness.state, ind: document.getElementById('mv-indicator-2') ? document.getElementById('mv-indicator-2').textContent : '', yaw: Math.atan2(MV.guard2.weapon.aimDir.x, MV.guard2.weapon.aimDir.z) }));
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 205, y: 300, id: 1 }]); await page.waitForTimeout(1500); await Tc('touchEnd', []); await page.waitForTimeout(400);
    const r1 = await page.evaluate(() => ({ w: MV.guard2.weapon.state, yaw: Math.atan2(MV.guard2.weapon.aimDir.x, MV.guard2.weapon.aimDir.z), err: MV.guard2.weapon.err, vis: MV.guard2.weapon.target.visible }));
    // frame rate with him aiming vs a calm yard
    const fps = async () => { await page.evaluate(() => { window.__f = 0; window.__f0 = performance.now(); if (!window.__loop) { window.__loop = true; (function f() { window.__f++; requestAnimationFrame(f); })(); } }); await page.waitForTimeout(3000); return page.evaluate(() => window.__f / ((performance.now() - window.__f0) / 1000)); };
    const aiming = await fps();
    await page.tap('#mv-reset'); await page.waitForTimeout(500); const calm = await fps();
    const wr = a => Math.atan2(Math.sin(a), Math.cos(a));
    const ok = r0.w === 'READY' && r0.aware === 'ALERT' && Math.abs(wr(r1.yaw - r0.yaw)) > 0.05 && r1.vis && r1.err < 10 && aiming > calm * 0.8 && page.errors.length === 0;
    return { pass: ok, detail: `walked into his view: ${r0.aware} (indicator "${r0.ind}"), pistol ${r0.w}; she moved by touch: his aim followed ${(Math.abs(wr(r1.yaw - r0.yaw)) * 57.3).toFixed(1)}° (${r1.err.toFixed(1)}° off, sees her ${r1.vis}); frame rate with him aiming ${aiming.toFixed(0)} fps vs ${calm.toFixed(0)} calm (≥ 80%); page errors ${page.errors.length}` };
  },

  // ---------------------------------------------------------------- Step 20: guard health, damage, hit reactions, defeat
  // 100 HP each; a pistol hit is 35 (65, 30, 0, never below); a shot applies once; misses and
  // cover cost nothing; the two guards are independent; RESET restores both
  async healthDamage() {
    const page = await CHECKS._firePage();
    const r = await page.evaluate(() => {
      const { motor, input } = MV, P = MV.pistol, g1 = MV.guard, g2 = MV.guard2, H = MV.SCmv;
      const out = { start: [g1.health.current, g1.health.max, g2.health.current, g2.health.max] };
      const g1p = g1.position.clone(); const gp = g2.position.clone();
      aimAt(gp.x - 4, gp.z + 0.5, gp.x, 1.2, gp.z);
      out.hp = []; out.pct = [];
      for (let k = 0; k < 4; k++) { press(); MV.tick(1 / 60, true); out.hp.push(g2.health.current); out.pct.push(g2.health.percent()); sim(40); }
      out.fourth = P.lastShot.kind; out.after = g2.health.current; out.defeated = g2.health.defeated();
      // the same shot event twice: applied once
      g2.reset(); const ev = { amount: 35, source: 'pistol', id: 'test.1', dir: new THREE.Vector3(1, 0, 0) };
      const a = H.applyDamage(g2, ev), b = H.applyDamage(g2, ev); out.dup = { a: a.applied, b: b.applied, why: b.why, hp: g2.health.current };
      // an overkill amount: clamped at 0
      const c = H.applyDamage(g2, { amount: 500, source: 'test', id: 'test.2' }); out.clamp = { hp: g2.health.current, defeated: c.defeated };
      g2.reset(); sim(5);
      // misses: past him, into the ground and wall
      aimAt(gp.x - 4, gp.z + 0.5, gp.x + 1.5, 1.2, gp.z + 4); press(); MV.tick(1 / 60, true); out.miss = { kind: P.lastShot.kind, hp: g2.health.current };
      // cover: Guard 2 put behind the tall crate, shot at through it
      if (MV.aim.active) { input.aimTapped = true; sim(40); }
      g2.motor.teleport(-2, -6.9, Math.PI); g2.place(); sim(3);
      aimAt(-2, -11.5, -2, 1.2, -6.9); press(); MV.tick(1 / 60, true); out.cover = { kind: P.lastShot.kind, hp: g2.health.current, aimed: P.lastShot.aimed.what };
      // the long wall between her and Guard 1
      if (MV.aim.active) { input.aimTapped = true; sim(40); }
      g1.patrol.enabled = false; g1.reset(); g1.motor.teleport(4, 14.5, 0); g1.place(); sim(3);
      aimAt(4, 10.5, 4, 1.2, 14.5); press(); MV.tick(1 / 60, true); out.wall = { kind: P.lastShot.kind, hp: g1.health.current };
      // independence: Guard 1 hit twice, Guard 2 untouched (and where he was)
      if (MV.aim.active) { input.aimTapped = true; sim(40); }
      g1.reset(); g2.reset(); sim(5); const p2 = g2.position.clone(); const g1q = g1.position.clone();
      aimAt(g1q.x, g1q.z - 4, g1q.x, 1.2, g1q.z); press(); MV.tick(1 / 60, true); sim(40); press(); MV.tick(1 / 60, true);
      out.indep = { g1: g1.health.current, g2: g2.health.current, g2moved: g2.position.distanceTo(p2), g1hits: g1.health.history.length, g2hits: g2.health.history.length };
      // RESET restores both
      document.getElementById('mv-reset').click(); sim(2);
      out.reset = [g1.health.current, g2.health.current, g1.health.history.length, g2.health.history.length, g1.ko.state, g2.ko.state];
      out.stat = document.getElementById('mv-ko').textContent;
      return out;
    });
    const o = r, ok = o.start.join() === '100,100,100,100' && o.hp.join() === '65,30,0,0' && o.pct.slice(0, 3).map(Math.round).join() === '65,30,0' && o.fourth !== 'guard' && o.after === 0 && o.defeated
      && o.dup.a && !o.dup.b && o.dup.why === 'already applied' && o.dup.hp === 65 && o.clamp.hp === 0 && o.clamp.defeated
      && o.miss.kind !== 'guard' && o.miss.hp === 100 && o.cover.kind === 'crate' && o.cover.hp === 100 && o.wall.kind === 'wall' && o.wall.hp === 100
      && o.indep.g1 === 30 && o.indep.g2 === 100 && o.indep.g2moved < 1e-6 && o.indep.g1hits === 2 && o.indep.g2hits === 0
      && o.reset.join() === '100,100,0,0,CONSCIOUS,CONSCIOUS' && page.errors.length === 0;
    return { pass: ok, detail: `start G1 ${o.start[0]}/${o.start[1]}, G2 ${o.start[2]}/${o.start[3]}; Guard 2 shot 4×: ${o.hp.join(' → ')} HP (${o.pct.slice(0, 3).map(v => Math.round(v) + '%').join(', ')}), the 4th passed over him into the ${o.fourth}; one event applied twice: ${o.dup.a}/${o.dup.b} (${o.dup.why}), ${o.dup.hp} HP; 500 damage → ${o.clamp.hp} HP; a miss → ${o.miss.kind}, ${o.miss.hp} HP; through the tall crate → ${o.cover.kind}, ${o.cover.hp} HP; through the long wall → ${o.wall.kind}, ${o.wall.hp} HP; Guard 1 shot twice: G1 ${o.indep.g1} HP, G2 ${o.indep.g2} HP (moved ${o.indep.g2moved.toFixed(3)} m); RESET → ${o.reset.join(', ')}; page errors ${page.errors.length}` };
  },

  // a nonfatal hit: a visible flinch away from the shot that eases out (no freeze, nothing left
  // on his bones, no joint jumps); a second hit blends over the first (bounded); he keeps
  // walking his patrol
  async hitReaction() {
    const page = await CHECKS._firePage();
    const r = await page.evaluate(() => {
      const P = MV.pistol, g1 = MV.guard, g2 = MV.guard2, dt = 1 / 60;
      const ang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 57.2958;
      const gp = g2.position.clone(); aimAt(gp.x - 4, gp.z + 0.5, gp.x, 1.2, gp.z);
      // the overlay itself: his chest just before and just after the reaction is applied, each frame
      const H = g2.health, orig = H.poseReact.bind(H); let rec = null;
      H.poseReact = function (dt) { const c = g2.bones.chest; c.updateMatrixWorld(true); const q0 = c.getWorldQuaternion(new THREE.Quaternion()); orig(dt); const q1 = c.getWorldQuaternion(new THREE.Quaternion()); if (rec) rec.push({ d: ang(q0, q1), q1, phase: H.reactPhase, hand: g2.bones.rightHand.getWorldPosition(new THREE.Vector3()) }); };
      const run = shots => { g2.reset(); sim(3); rec = []; for (let i = 0; i < 70; i++) { if (shots.indexOf(i) >= 0) press(); MV.tick(dt, true); } const o = rec; rec = null; return o; };
      const one = run([5]);
      let peak = 0, peakAt = 0, maxStep = 0, handJump = 0;
      for (let i = 0; i < one.length; i++) { if (one[i].d > peak) { peak = one[i].d; peakAt = i; } if (i) { maxStep = Math.max(maxStep, Math.abs(one[i].d - one[i - 1].d)); handJump = Math.max(handJump, one[i].hand.distanceTo(one[i - 1].hand)); } }
      const end = one[one.length - 1].d, phases = [...new Set(one.map(x => x.phase))].join('>') + ' … ' + one[one.length - 1].phase;
      const base = g2.health._base.size;
      const two = run([5, 11]); let peak2 = 0; for (const x of two) peak2 = Math.max(peak2, x.d);
      H.poseReact = orig;
      // Guard 1 on his patrol, hit once: he flinches and walks on
      if (MV.aim.active) { MV.input.aimTapped = true; sim(40); }
      g1.patrol.enabled = true; g1.reset(); sim(200);
      const q = g1.position.clone(), fw = g1.forward(); aimAt(q.x - fw.x * 5 + fw.z * 1, q.z - fw.z * 5 - fw.x * 1, q.x, 1.2, q.z);
      let hit = false; for (let k = 0; k < 10 && !hit; k++) { MV.camera.updateMatrixWorld(); const d = new THREE.Vector3(g1.position.x, 1.2, g1.position.z).sub(MV.camera.position).normalize(); MV.cam.yaw = Math.atan2(-d.x, -d.z); MV.cam.pitch = Math.asin(-d.y); sim(6); press(); MV.tick(dt, true); hit = g1.health.current < 100; }
      const p0 = g1.position.clone(); let spd = 0; for (let i = 0; i < 120; i++) { MV.tick(dt, true); if (i > 60) spd = Math.max(spd, g1.motor.speed); }
      return { peak, peakAt, maxStep, handJump, end, phases, base, peak2, g1: { hit, hp: g1.health.current, moved: g1.position.distanceTo(p0), spd, ko: g1.ko.state, phase: g1.health.reactPhase } };
    });
    const o = r, ok = o.peak >= 8 && o.peakAt >= 5 && o.peakAt <= 16 && o.end < 1e-3 && o.base === 0 && o.phases.indexOf('impact') >= 0 && o.phases.indexOf('recovering') >= 0 && / … none$/.test(o.phases)
      && o.maxStep < 6 && o.handJump < 0.08 && o.peak2 <= o.peak * 1.35 && o.g1.hit && o.g1.hp === 65 && o.g1.ko === 'CONSCIOUS' && o.g1.phase === 'none' && o.g1.moved > 0.3 && page.errors.length === 0;
    return { pass: ok, detail: `Guard 2 hit: the reaction turns his chest up to ${o.peak.toFixed(1)}° on top of his own pose (peak ${((o.peakAt - 5) / 60).toFixed(2)} s after the hit), phases ${o.phases}, ${o.end.toFixed(3)}° of it left after 1 s, no pose left behind ${o.base === 0}; the reaction's largest change ${o.maxStep.toFixed(1)}°/frame, hand step ${cm(o.handJump)}; two hits 0.1 s apart peak ${o.peak2.toFixed(1)}° (≤ 1.35× one); Guard 1 hit on patrol: ${o.g1.hp} HP, walked on ${o.g1.moved.toFixed(2)} m in 2 s (up to ${o.g1.spd.toFixed(2)} m/s); page errors ${page.errors.length}` };
  },

  // being shot is attack evidence, not her position: suspicion full, the attack remembered at
  // the gunshot's origin (from his hearing), no sighting; already searching, it restarts the search
  async shotAwareness() {
    const page = await CHECKS._firePage();
    const r = await page.evaluate(() => {
      const { motor, input } = MV, g2 = MV.guard2, g1 = MV.guard;
      g1.patrol.enabled = false; g1.reset(); g2.reset();
      const gp = g2.position.clone(), f = g2.forward();
      aimAt(gp.x - f.x * 5, gp.z - f.z * 5, gp.x, 1.2, gp.z);   // from behind him: out of his sight
      const pre = { seen: g2.awareness.seen, meter: g2.vision.meter };
      press(); MV.tick(1 / 60, true);
      const s = MV.pistol.lastShot, origin = new THREE.Vector3(s.muzzle.x, 0, s.muzzle.z), a = g2.awareness;
      const now = { hp: g2.health.current, susp: a.suspicion, attack: a.attack && a.attack.kind, at: a.attack && a.attack.position.distanceTo(origin), seen: a.seen, confirmed: a.confirmed, note: a.note, state: a.state };
      sim(90);
      const later = { state: a.state, focus: a.focus ? Math.hypot(a.focus.position.x - origin.x, a.focus.position.z - origin.z) : null, shots: a.shots };
      // an alerted guard in Heightened Security, shot: back to the Active Search
      if (MV.aim.active) { input.aimTapped = true; sim(40); }
      g1.reset(); g1.awareness.confirmed = true; g1.awareness.seen = { position: g1.position.clone().add(new THREE.Vector3(3, 0, 3)), time: 0 }; g1.awareness._startHeightened('test', 60); sim(5);
      const st0 = g1.awareness.state; const q = g1.position.clone(), fw = g1.forward();
      aimAt(q.x - fw.x * 5, q.z - fw.z * 5, q.x, 1.2, q.z); const st1 = g1.awareness.state; press(); MV.tick(1 / 60, true);
      const hs = { before: st0, mid: st1, after: g1.awareness.state, hp: g1.health.current };
      return { pre, now, later, hs };
    });
    const o = r, ok = o.pre.seen === null && o.now.hp === 65 && o.now.susp === 1 && o.now.attack === 'shot' && o.now.at < 1e-6 && o.now.seen === null && !o.now.confirmed
      && ['SUSPICIOUS', 'INVESTIGATING', 'ALERT'].indexOf(o.later.state) >= 0 && o.later.shots === 1 && (o.later.state === 'ALERT' || (o.later.focus != null && o.later.focus < 0.01))
      && o.hs.hp === 65 && o.hs.after === 'EVASION' && page.errors.length === 0;
    return { pass: ok, detail: `shot from behind (unseen): ${o.now.hp} HP, suspicion ${Math.round(o.now.susp * 100)}%, remembers "${o.now.attack}" at the gunshot's origin (${o.now.at != null ? o.now.at.toFixed(3) : '–'} m off), no sighting ${o.now.seen === null}, not confirmed ${!o.now.confirmed} ("${o.now.note}"); 1.5 s later ${o.later.state}, looking at the origin ${o.later.focus != null ? o.later.focus.toFixed(2) + ' m off' : '(saw her)'}; Guard 1 in ${o.hs.before}${o.hs.mid !== o.hs.before ? ' (' + o.hs.mid + ' by then)' : ''}, shot → ${o.hs.after}; page errors ${page.errors.length}` };
  },

  // 0 HP: DEAD (not UNCONSCIOUS): he buckles and goes down where he stood, lies on the ground
  // (no float, no sinking, no drift), his standing collider replaced by low ones, no AI, sight
  // or hearing, can't be grabbed, never wakes (70 s); an unconscious guard takes no damage and
  // still wakes with the health he had; RESET stands him up at full health
  async firearmDefeat() {
    const page = await CHECKS._firePage();
    const r = await page.evaluate(() => {
      const { motor, input, world } = MV, g1 = MV.guard, g2 = MV.guard2, A = MV.SCmv.ThrowAnim, dt = 1 / 60;
      const out = {};
      // Guard 1 on his patrol, shot three times
      g1.patrol.enabled = true; g1.personality.enabled = false; g1.reset(); g2.reset(); sim(200);
      const q = g1.position.clone(), fw = g1.forward(); aimAt(q.x - fw.x * 5 + fw.z, q.z - fw.z * 5 - fw.x, q.x, 1.2, q.z);
      let n = 0; while (g1.health.current > 0 && n < 30) { MV.camera.updateMatrixWorld(); const d = new THREE.Vector3(g1.position.x, 1.2, g1.position.z).sub(MV.camera.position).normalize(); MV.cam.yaw = Math.atan2(-d.x, -d.z); MV.cam.pitch = Math.asin(-d.y); sim(8); press(); MV.tick(dt, true); n++; }
      const at = g1.position.clone(), hips0 = g1.bones.hips.getWorldPosition(new THREE.Vector3());
      out.atZero = { hp: g1.health.current, ko: g1.ko.state, aw: g1.awareness.state, phase: g1.ko.phase };
      let maxHip = 0, prev = hips0.clone(), minLow = 9; for (let i = 0; i < 90; i++) { MV.tick(dt, true); const h = g1.bones.hips.getWorldPosition(new THREE.Vector3()); maxHip = Math.max(maxHip, h.distanceTo(prev)); prev = h; minLow = Math.min(minLow, A.lowest(g1)); }
      const lie = g1.position.clone();
      out.down = { phase: g1.ko.phase, low: A.lowest(g1), hipsY: g1.bones.hips.getWorldPosition(new THREE.Vector3()).y, shift: Math.hypot(lie.x - at.x, lie.z - at.z), maxHip, minLow, cyl: g1.ko.colliders.length, standing: g1.collider.x };
      // 70 s: still down, still there, nothing heard or seen, no patrol
      const h0 = g1.hearing.heardCount, aw0 = g1.awareness.state;
      if (MV.aim.active) { input.aimTapped = true; sim(40); }
      motor.teleport(lie.x + 1.2, lie.z, 0); MV.cam.snap(motor); sim(10);   // right beside him, in plain view
      MV.noise.emit(5, 'gunshot', new THREE.Vector3(lie.x + 2, 0, lie.z), 'concrete', 'player');
      for (let i = 0; i < 70 * 20; i++) MV.tick(1 / 20, true);
      out.later = { ko: g1.ko.state, phase: g1.ko.phase, drift: Math.hypot(g1.position.x - lie.x, g1.position.z - lie.z), heard: g1.hearing.heardCount - h0, meter: g1.vision.meter, aw: g1.awareness.state, moving: g1.moving, patrol: g1.patrol.status(), low: A.lowest(g1), vstate: g1.vision.state() };
      out.grab = MV.cqc._checkOne(g1);
      // she can't walk through him (low colliders) but nothing stands there
      const res = world.resolve(lie.x, lie.z, motor.cfg.radius, {}); out.blocks = Math.hypot(res.x - lie.x, res.z - lie.z) > 0.05;
      // separate from unconsciousness: Guard 2 thrown (UNCONSCIOUS), shot at while down: no damage; wakes with his health
      g2.reset(); sim(5); g2.health.take({ amount: 35, source: 'pistol', id: 'pre.1' }); sim(30);
      const b2 = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b2.x, b2.z, g2.yaw); MV.cam.snap(motor); sim(5);
      input.cqcTapped = true; sim(40); input.throwTapped = true; let k = 0; while (g2.ko.state !== 'UNCONSCIOUS' && k < 200) { MV.tick(dt, true); k++; }
      const koHp = g2.health.current; const t = g2.health.take({ amount: 35, source: 'pistol', id: 'down.1' });
      out.uncon = { ko: g2.ko.state, hp: koHp, shot: t.applied, why: t.why, after: g2.health.current };
      g2.ko.left = 0.01; let w = 0; while (g2.ko.state !== 'CONSCIOUS' && w < 600) { MV.tick(1 / 20, true); w++; }
      out.woke = { ko: g2.ko.state, hp: g2.health.current };
      // RESET
      document.getElementById('mv-reset').click(); sim(3);
      out.reset = { ko: g1.ko.state, hp: g1.health.current, post: Math.hypot(g1.position.x - g1.post.x, g1.position.z - g1.post.z), tilt: g1.fall.quaternion.w, cyl: g1.ko.colliders.length, collider: Math.hypot(g1.collider.x - g1.position.x, g1.collider.z - g1.position.z), aw: g1.awareness.state };
      return out;
    });
    const o = r, ok = o.atZero.hp === 0 && o.atZero.ko === 'DEAD' && o.atZero.aw === 'DEAD' && o.atZero.phase === 'collapsing'
      && o.down.phase === 'down' && o.down.low >= 0 && o.down.low < 0.03 && o.down.minLow >= -0.005 && o.down.hipsY < 0.35 && o.down.shift < 0.5 && o.down.maxHip < 0.08 && o.down.cyl === 2 && o.down.standing > 1e5
      && o.later.ko === 'DEAD' && o.later.phase === 'down' && o.later.drift < 1e-6 && o.later.heard === 0 && o.later.meter === 0 && o.later.aw === 'DEAD' && !o.later.moving && Math.abs(o.later.low - o.down.low) < 0.002 && o.later.vstate === 'DEFEATED'
      && o.grab === 'he is down' && o.blocks
      && o.uncon.ko === 'UNCONSCIOUS' && o.uncon.hp === 65 && !o.uncon.shot && o.uncon.why === 'unconscious' && o.uncon.after === 65 && o.woke.ko === 'CONSCIOUS' && o.woke.hp === 65
      && o.reset.ko === 'CONSCIOUS' && o.reset.hp === 100 && o.reset.post < 0.01 && Math.abs(o.reset.tilt) > 0.9999 && o.reset.cyl === 0 && o.reset.collider < 0.01 && o.reset.aw === 'NORMAL' && page.errors.length === 0;
    return { pass: ok, detail: `Guard 1 at 0 HP on patrol: ${o.atZero.ko} (${o.atZero.phase}), awareness ${o.atZero.aw}; 1.5 s later ${o.down.phase}: lowest point ${cm(o.down.low)} (never below ${cm(o.down.minLow)}), hips ${o.down.hipsY.toFixed(2)} m up, ${o.down.shift.toFixed(2)} m from where he stood, hips ≤ ${cm(o.down.maxHip)} per frame, ${o.down.cyl} low colliders, standing collider gone ${o.down.standing > 1e5}; after 70 s with her in plain view and a gunshot 2 m away: ${o.later.ko} ${o.later.phase}, drift ${o.later.drift.toFixed(4)} m, heard ${o.later.heard}, vision ${o.later.vstate} ${o.later.meter}, ${o.later.aw}, moving ${o.later.moving}; CQC: "${o.grab}"; blocks her walking through ${o.blocks}; Guard 2 at 65 HP thrown → ${o.uncon.ko}, shot while down: applied ${o.uncon.shot} (${o.uncon.why}), still ${o.uncon.after}, woke ${o.woke.ko} with ${o.woke.hp} HP; RESET → ${o.reset.ko}, ${o.reset.hp} HP, at his post, upright, colliders back; page errors ${page.errors.length}` };
  },

  // CQC and health: THROW and CHOKE knock out without costing health; a hurt, ALERT guard can
  // still be grabbed from the front; the grab, pull and break-free don't touch health
  async cqcHealth() {
    const page = await CHECKS._firePage();
    const r = await page.evaluate(() => {
      const { motor, input } = MV, g2 = MV.guard2, cq = MV.cqc, dt = 1 / 60;
      const at = (rel, d) => { cq.cancel(); const y = g2.yaw + rel, p = g2.position.clone().add(new THREE.Vector3(Math.sin(y) * d, 0, Math.cos(y) * d)); motor.teleport(p.x, p.z, Math.atan2(g2.position.x - p.x, g2.position.z - p.z)); MV.cam.snap(motor); sim(5); };
      const out = {};
      g2.reset(); sim(5); at(Math.PI, 1.0); input.cqcTapped = true; sim(40); input.throwTapped = true; let k = 0; while (g2.ko.state !== 'UNCONSCIOUS' && k < 300) { MV.tick(dt, true); k++; }
      out.thrown = { ko: g2.ko.state, hp: g2.health.current };
      g2.reset(); sim(5); at(Math.PI, 1.0); input.cqcTapped = true; sim(40); input._chokeKey = true; input.chokePresses++; k = 0; while (g2.ko.state !== 'UNCONSCIOUS' && k < 600) { MV.tick(dt, true); k++; } input._chokeKey = false;
      out.choked = { ko: g2.ko.state, hp: g2.health.current };
      // hurt to 30 HP and ALERT, grabbed from the front
      g2.reset(); sim(5); g2.health.take({ amount: 35, source: 'pistol', id: 'c.1' }); g2.health.take({ amount: 35, source: 'pistol', id: 'c.2' });
      g2.awareness.confirmed = true; g2.awareness._alert('test'); sim(5);
      at(0, 1.0); const why = cq.check(); input.cqcTapped = true; sim(40);
      out.front = { hp: g2.health.current, aware: g2.awareness.state, why, cqc: cq.state };
      input.move.y = 1; sim(60); input.move.y = 0; sim(5);
      cq.bf.left = 0.05; k = 0; while (cq.state !== 'FREE' && k < 120) { MV.tick(dt, true); k++; }
      out.broke = { cqc: cq.state, hp: g2.health.current, aware: g2.awareness.state };
      return out;
    });
    const o = r, ok = o.thrown.ko === 'UNCONSCIOUS' && o.thrown.hp === 100 && o.choked.ko === 'UNCONSCIOUS' && o.choked.hp === 100
      && o.front.hp === 30 && o.front.why === '' && o.front.cqc === 'GRAPPLING' && o.broke.cqc === 'FREE' && o.broke.hp === 30 && o.broke.aware === 'ALERT' && page.errors.length === 0;
    return { pass: ok, detail: `THROW → ${o.thrown.ko} at ${o.thrown.hp} HP; CHOKE → ${o.choked.ko} at ${o.choked.hp} HP; at ${o.front.hp} HP and ${o.front.aware}, grabbed from the front: ${o.front.cqc}; pulled, then broke free: ${o.broke.cqc}, still ${o.broke.hp} HP, ${o.broke.aware}; page errors ${page.errors.length}` };
  },

  // iPhone: AIM, three FIRE taps on Guard 2 (100 → 65 → 30 → 0, he collapses and stays down),
  // STATS shows it, the button still switches FIRE / CQC, RESET restores him
  async damageTouch() {
    const page = await touchPage(), Tc = page.touch;
    const B = async sel => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const aim = await B('#mv-aim'), fire = await B('#mv-cqc');
    const tap = async (p, id) => { const d = Tc('touchStart', [{ x: p.x, y: p.y, id }]); await page.waitForTimeout(70); const u = Tc('touchEnd', [{ x: p.x, y: p.y, id }]); await d; await u; };
    await page.evaluate(() => { document.getElementById('mv-stats').hidden = false; const g = MV.guard2, p = g.position.clone().addScaledVector(g.forward(), -4).add(new THREE.Vector3(0.4, 0, 0)); MV.motor.teleport(p.x, p.z, g.yaw); MV.cam.snap(MV.motor); });
    await tap(aim, 5); await page.waitForFunction(() => MV.cam.aimK > 0.98, null, { timeout: 15000, polling: 'raf' }).catch(() => {});
    // the crosshair onto him (as a drag would)
    await page.evaluate(() => { MV.camera.updateMatrixWorld(); const g = MV.guard2, d = new THREE.Vector3(g.position.x, 1.2, g.position.z).sub(MV.camera.position).normalize(); MV.cam.yaw = Math.atan2(-d.x, -d.z); MV.cam.pitch = Math.asin(-d.y); });
    await page.waitForTimeout(600);
    const hp = [];
    for (let i = 0; i < 3; i++) { await tap(fire, 10 + i); await page.waitForTimeout(700); hp.push(await page.evaluate(() => MV.guard2.health.current)); }
    await page.waitForFunction(() => MV.guard2.ko.phase === 'down', null, { timeout: 15000, polling: 'raf' }).catch(() => {}); await page.waitForTimeout(400);
    const down = await page.evaluate(() => ({ ko: MV.guard2.ko.state, phase: MV.guard2.ko.phase, stat: document.getElementById('mv-g2').textContent, text: document.getElementById('mv-cqc').textContent.trim(), shots: MV.pistol.shots }));
    await tap(aim, 20); await page.waitForTimeout(500); const off = await page.evaluate(() => document.getElementById('mv-cqc').textContent.trim());
    await page.tap('#mv-reset'); await page.waitForTimeout(400);
    const reset = await page.evaluate(() => ({ hp: MV.guard2.health.current, ko: MV.guard2.ko.state, stat: document.getElementById('mv-g2').textContent }));
    const ok = hp.join() === '65,30,0' && down.ko === 'DEAD' && down.phase === 'down' && /HP 0\/100/.test(down.stat) && /DEFEATED/.test(down.stat) && down.text === 'FIRE' && down.shots === 3 && off === 'CQC'
      && reset.hp === 100 && reset.ko === 'CONSCIOUS' && page.errors.length === 0;
    return { pass: ok, detail: `three FIRE taps: ${hp.join(' → ')} HP; Guard 2 ${down.ko} (${down.phase}), STATS "${down.stat.slice(0, 70)}…"; button while aiming "${down.text}", AIM off → "${off}"; RESET → ${reset.hp} HP, ${reset.ko}; page errors ${page.errors.length}` };
  },

  // ---------------------------------------------------------------- Step 19: pistol and the contextual CQC / FIRE / RELEASE button
  // shared helpers (in the page): aim from a spot at a world point; one FIRE press; the shot
  async _firePage(touch) {
    const page = touch ? await touchPage() : await simPage();
    await page.evaluate(() => {
      const { motor, input, cam } = MV, dt = 1 / 60, A = MV.aim;
      window.sim = n => { for (let i = 0; i < n; i++) MV.tick(dt, true); };
      window.__t = 10000; window.press = () => { window.__t += 500; input._firePress(window.__t); };
      window.aimAt = (px, pz, tx, ty, tz, crouch) => {
        if (A.active) { input.aimTapped = true; sim(40); }
        motor.teleport(px, pz, 0); cam.snap(motor); input.setCrouch(!!crouch); sim(40); input.aimTapped = true; sim(60);
        for (let k = 0; k < 4; k++) { MV.camera.updateMatrixWorld(); const d = new THREE.Vector3(tx, ty, tz).sub(MV.camera.position).normalize(); cam.yaw = Math.atan2(-d.x, -d.z); cam.pitch = Math.asin(-d.y); sim(30); }
      };
      window.shotInfo = s => s && { n: s.n, what: s.what, kind: s.kind, guard: s.guard ? s.guard.cfg.label : null, hit: s.hit, dist: s.dist, point: s.point && s.point.clone(), blocked: s.muzzleBlocked, intended: s.intended, aimedPoint: s.aimed.point.clone(), origin: s.origin.clone(), dir: s.dir.clone(), muzzle: s.muzzle.clone(), heard: s.heardBy, level: s.noise.level, type: s.noise.type };
    });
    return page;
  },

  // the one button: CQC normally, FIRE while aiming, RELEASE while holding a guard, always in
  // the same place; a FIRE press never grabs, a CQC press never fires; nothing carries over a
  // mode change; HOLD CQC still takes a guard down once AIM is off; RESET clears the pistol
  async fireButton() {
    const page = await CHECKS._firePage();
    const r = await page.evaluate(() => {
      const { motor, input, cam } = MV, A = MV.aim, cq = MV.cqc, P = MV.pistol, g2 = MV.guard2, B = document.getElementById('mv-cqc');
      const look = () => { const b = B.getBoundingClientRect(), cs = getComputedStyle(B); return { text: B.textContent.trim(), fire: B.classList.contains('fire'), rect: [b.left, b.top, b.width, b.height].map(v => Math.round(v)).join(','), pos: [cs.right, cs.top, cs.width, cs.height].join(',') }; };
      const behind = () => { cq.cancel(); g2.reset(); A.reset(); const b = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b.x, b.z, g2.yaw); cam.snap(motor); sim(10); };
      const out = {};
      behind(); out.normal = look();
      input.aimTapped = true; sim(60); out.aiming = look();
      // a FIRE press behind him: a shot, never a grab
      const g0 = cq.grabs; press(); sim(30); out.fireNoGrab = { shots: P.shots, grabs: cq.grabs - g0, cqc: cq.state, held: !!g2.restraint };
      // switching CQC → FIRE with a pending CQC tap and a CQC press held down: no grab, no shot
      input.aimTapped = true; sim(40);
      cq.input._cqcPress(performance.now()); input.cqcTapped = true; input.aimTapped = true; sim(60);
      const s0 = P.shots; cq.input._cqcUp(performance.now() + 900); sim(20);
      out.cqcToFire = { cqc: cq.state, grabs: cq.grabs - g0, shots: P.shots - s0, takedowns: cq.takedowns || 0 };
      // FIRE → CQC: presses queued as FIRE when AIM ends are dropped, not turned into CQC
      press(); input.aimTapped = true; sim(1); sim(40);
      out.fireToCqc = { shots: P.shots - s0, cqc: cq.state, grabs: cq.grabs - g0 };
      // normal mode: a CQC tap grabs (no shot) and the button reads RELEASE
      behind(); const s1 = P.shots; input.cqcTapped = true; sim(40); out.holding = look(); out.grab = { cqc: cq.state, shots: P.shots - s1 };
      // a FIRE press can't happen while holding him: the button isn't FIRE, presses are ignored
      press(); sim(5); out.noShotHolding = P.shots - s1 === 0;
      input.aimTapped = true; sim(5); out.noAimHolding = !A.active;
      input.cqcTapped = true; sim(40); out.released = cq.state;
      // HOLD CQC (after aiming) still takes him down
      behind(); input.aimTapped = true; sim(40); input.aimTapped = true; sim(40);
      cq.input._cqcPress(performance.now() - 1000); let f = 0; while (cq.state === 'FREE' && f < 90) { MV.tick(1 / 60, true); f++; }   // (a press down 1 s: past the hold time)
      cq.input._cqcUp(performance.now()); let n = 0; while (g2.ko.state !== 'UNCONSCIOUS' && n < 300) { MV.tick(1 / 60, true); n++; }
      out.takedown = { ko: g2.ko.state, shots: P.shots - s1 };
      // shooting disabled during the takedown / with him down and AIM refused while busy is Step 18's rule (aimCqc)
      // RESET clears the pistol's state
      behind(); input.aimTapped = true; sim(60); press(); MV.tick(1 / 60, true); const mid = { flash: P.flash.visible, kick: P.kick > 0, marker: document.getElementById('mv-hitmark').classList.contains('hit') };
      press(); document.getElementById('mv-reset').click(); sim(2);
      out.reset = { mid, shots: P.shots, last: P.lastShot, flash: P.flash.visible, kick: P.kick, camKick: cam.kick, pending: input._firePresses.length, marker: document.getElementById('mv-hitmark').classList.contains('hit'), text: look().text, fireMode: input.fireMode };
      out.normalAgain = look();
      return out;
    });
    const o = r, ok = o.normal.text === 'CQC' && !o.normal.fire && o.aiming.text === 'FIRE' && o.aiming.fire && o.holding.text === 'RELEASE' && o.normal.rect === o.aiming.rect && o.aiming.rect === o.holding.rect
      && o.fireNoGrab.shots === 1 && o.fireNoGrab.grabs === 0 && o.fireNoGrab.cqc === 'FREE' && !o.fireNoGrab.held
      && o.cqcToFire.cqc === 'FREE' && o.cqcToFire.grabs === 0 && o.cqcToFire.shots === 0 && o.cqcToFire.takedowns === 0
      && o.fireToCqc.shots === 0 && o.fireToCqc.cqc === 'FREE' && o.fireToCqc.grabs === 0
      && o.grab.cqc === 'GRAPPLING' && o.grab.shots === 0 && o.noShotHolding && o.noAimHolding && o.released === 'FREE' && o.takedown.ko === 'UNCONSCIOUS' && o.takedown.shots === 0
      && o.reset.mid.flash && o.reset.mid.kick && o.reset.shots === 0 && o.reset.last === null && !o.reset.flash && o.reset.kick === 0 && o.reset.camKick === 0 && o.reset.pending === 0 && !o.reset.marker && o.reset.text === 'CQC' && o.normalAgain.rect === o.normal.rect && page.errors.length === 0;
    return { pass: ok, detail: `button: "${o.normal.text}" / aiming "${o.aiming.text}" (fire style ${o.aiming.fire}) / holding "${o.holding.text}", same box ${o.normal.rect === o.aiming.rect && o.aiming.rect === o.holding.rect} (${o.normal.rect} / ${o.aiming.rect} / ${o.holding.rect}); FIRE press behind Guard 2: ${o.fireNoGrab.shots} shot, ${o.fireNoGrab.grabs} grabs; CQC tap pending + CQC held as AIM comes on, let go 0.9 s later: ${o.cqcToFire.grabs} grabs, ${o.cqcToFire.shots} shots, ${o.cqcToFire.takedowns} takedowns; FIRE pressed as AIM goes off: ${o.fireToCqc.shots} shots, ${o.fireToCqc.grabs} grabs; CQC tap → ${o.grab.cqc} (shots ${o.grab.shots}), FIRE press while holding: no shot ${o.noShotHolding}, AIM refused ${o.noAimHolding}, RELEASE → ${o.released}; HOLD CQC after aiming → Guard 2 ${o.takedown.ko}; RESET after a shot: shots ${o.reset.shots}, flash ${o.reset.flash}, kick ${o.reset.kick}, camera kick ${o.reset.camKick}, queued ${o.reset.pending}, hit marker ${o.reset.marker}, button "${o.reset.text}"; page errors ${page.errors.length}` };
  },

  // the shot: the camera's centre ray gives the point, the muzzle's line decides what it hits.
  // Guards (Guard 2, and Guard 1 on his patrol), walls, crates, pillars, the floor; cover in
  // front of the muzzle takes the shot; impact points on the real faces; feedback once per shot
  // (flash, kick, one gunshot noise event); a hit marker only on a guard hit; slow frames never
  // double a shot; nothing is injured
  async fireHits() {
    const page = await CHECKS._firePage();
    const r = await page.evaluate(() => {
      const { motor, input, cam, noise } = MV, A = MV.aim, P = MV.pistol, g1 = MV.guard, g2 = MV.guard2, mk = document.getElementById('mv-hitmark'), xh = document.getElementById('mv-crosshair');
      let events = 0, gunEvents = []; noise.on(ev => { events++; if (ev.type === 'gunshot') gunEvents.push(ev); });
      const one = () => { const e0 = gunEvents.length, f0 = P.flashes, k0 = P.kicks, s0 = P.shots; press(); MV.tick(1 / 60, true);
        const s = shotInfo(P.lastShot); s.marker = mk.classList.contains('hit'); s.xhGuard = xh.classList.contains('guard'); s.gun = gunEvents.length - e0; s.flash = P.flashes - f0; s.kick = P.kicks - k0; s.shots = P.shots - s0;
        // on the camera ray: the aimed point lies on origin + t·dir
        const v = s.aimedPoint.clone().sub(s.origin); s.offRay = v.clone().sub(s.dir.clone().multiplyScalar(v.dot(s.dir))).length();
        sim(25); return s; };
      const out = {};
      const gp = g2.position.clone();
      aimAt(gp.x - 4, gp.z + 0.5, gp.x, 1.2, gp.z); out.g2 = one();
      aimAt(gp.x - 4, gp.z + 0.5, gp.x + 2, 1.2, gp.z + 3); out.past = one();   // aimed past him: on into the yard
      aimAt(-2, -12, -2, 1.2, -8); out.crate = one();
      aimAt(4, 10, 4, 1.5, 13); out.wall = one();
      aimAt(-17, -12, -14, 1.5, -12); out.pillar = one();
      aimAt(-6, -14, -6, 0, -9); out.ground = one();
      aimAt(3, -6.2, 3, 1.0, 12.8, true); out.low = one(); input.setCrouch(false);
      // Guard 1 walking his patrol: aim at him where he is and fire as he moves
      if (A.active) { input.aimTapped = true; sim(40); }
      g1.patrol.enabled = true; g1.personality.enabled = false; g1.reset(); g2.reset(); sim(240);
      const gp1 = g1.position.clone(), fw = g1.forward(); aimAt(gp1.x - fw.x * 5, gp1.z - fw.z * 5, gp1.x, 1.2, gp1.z);
      let g1hit = null; for (let k = 0; k < 12 && !g1hit; k++) { MV.camera.updateMatrixWorld(); const d = new THREE.Vector3(g1.position.x, 1.2, g1.position.z).sub(MV.camera.position).normalize(); cam.yaw = Math.atan2(-d.x, -d.z); cam.pitch = Math.asin(-d.y); sim(8); const s = one(); if (s.guard && /^Guard 1/.test(s.guard)) g1hit = s; }
      out.g1 = g1hit; out.g1moving = g1.moving || g1.patrol.status();
      // slow frames: one press over several 1/20 s frames is one shot; two presses 50 ms apart in one frame are one shot (too fast), 300 ms apart two
      const s0 = P.shots; window.__t += 1000; input._firePress(window.__t); for (let i = 0; i < 6; i++) MV.tick(1 / 20, true);
      out.slowOne = P.shots - s0;
      window.__t += 1000; input._firePress(window.__t); input._firePress(window.__t + 50); MV.tick(1 / 20, true); out.fast = P.shots - s0 - out.slowOne;
      window.__t += 1000; input._firePress(window.__t); input._firePress(window.__t + 300); MV.tick(1 / 20, true); out.twoApart = P.shots - s0 - out.slowOne - out.fast;
      // nothing injured: no health anywhere, conscious, his AI running
      out.noInjury = [g1, g2].every(g => g.ko.state === (g.health.current > 0 ? 'CONSCIOUS' : 'DEAD') && !g.restraint && g.health.current === Math.max(0, 100 - 35 * g.health.history.length)) && (g2.shotHits || 0) >= 1 && (g1.shotHits || 0) >= 1;   // (Step 20: each hit is 35 HP; DEAD exactly at 0)
      out.hpInfo = [g1, g2].map(g => `${g.cfg.label.split(' —')[0]} ${g.health.current} HP, ${g.health.history.length} hits / ${g.shotHits || 0} shot, ${g.ko.state}`).join('; ');
      out.events = events;
      return out;
    });
    const o = r, near = (a, b) => Math.abs(a - b) < 0.05;
    const per = s => s && s.gun === 1 && s.flash === 1 && s.kick === 1 && s.shots === 1 && s.level === 5 && s.offRay < 1e-6;
    const ok = [o.g2, o.past, o.crate, o.wall, o.pillar, o.ground, o.low].every(per)
      && /^Guard 2/.test(o.g2.guard) && !o.g2.blocked && o.g2.marker && o.g2.xhGuard
      && !o.past.guard && !o.past.marker && o.past.hit && o.past.kind !== 'guard'
      && o.crate.kind === 'crate' && near(o.crate.point.z, -8.6) && !o.crate.marker && o.wall.kind === 'wall' && near(o.wall.point.z, 12.825) && !o.wall.marker
      && o.pillar.kind === 'pillar' && Math.abs(Math.hypot(o.pillar.point.x - -14, o.pillar.point.z - -12) - 0.35) < 0.03 && o.ground.kind === 'ground' && Math.abs(o.ground.point.y) < 1e-6
      && o.low.kind === 'crate' && o.low.blocked && o.low.intended !== 'crate' && o.low.point.z <= -5.49 && !o.low.marker
      && o.g1 && per(o.g1) && o.g1.marker && o.slowOne === 1 && o.fast === 1 && o.twoApart === 2 && o.noInjury && page.errors.length === 0;
    const d = s => s ? `${s.guard ? s.guard.split(' —')[0] : s.kind} ${s.dist.toFixed(2)} m${s.blocked ? ' (muzzle blocked, aimed at ' + s.intended + ')' : ''}${s.marker ? ', hit marker' : ''}` : 'none';
    return { pass: ok, detail: `Guard 2 → ${d(o.g2)}; past him → ${d(o.past)}; tall crate → ${d(o.crate)} at z ${o.crate.point.z.toFixed(2)}; long wall → ${d(o.wall)} at z ${o.wall.point.z.toFixed(2)}; pillar → ${d(o.pillar)}; floor → ${d(o.ground)}; crouched behind the low crate aiming at the wall → ${d(o.low)}; Guard 1 on patrol → ${d(o.g1)}; each shot: 1 gunshot (L5) event, 1 flash, 1 kick, aimed point on the camera ray ${[o.g2, o.wall].every(per)}; slow frames: 1 press → ${o.slowOne} shot, presses 50 ms apart → ${o.fast} (the second too fast), 300 ms apart → ${o.twoApart}; each hit 35 HP and DEAD exactly at 0 ${o.noInjury} (${o.hpInfo}); page errors ${page.errors.length}` };
  },

  // gunfire through the normal hearing: each guard who hears it has the shot's origin (the
  // muzzle where she fired), never where she goes afterwards; a calm guard out of sight reacts
  // by the normal rules (suspicious → investigates the origin), with no ALERT and no sighting;
  // an unconscious guard hears nothing
  async fireHearing() {
    const page = await CHECKS._firePage();
    const r = await page.evaluate(() => {
      const { motor, input, cam } = MV, A = MV.aim, P = MV.pistol, g1 = MV.guard, g2 = MV.guard2;
      g1.patrol.enabled = false; g1.reset(); g2.reset();
      // in the far corner by the spawn, out of both guards' sight (≈ 35 m away), firing into the perimeter wall
      aimAt(-18, 18, -25, 1.0, 18);
      const pre = { g1: g1.awareness.state, g2: g2.awareness.state, seen1: g1.awareness.seen, seen2: g2.awareness.seen };
      press(); MV.tick(1 / 60, true);
      const s = P.lastShot, origin = new THREE.Vector3(s.muzzle.x, 0, s.muzzle.z);
      const rec = g => ({ heard: !!g.hearing.heard && g.hearing.heard.type === 'gunshot', at: g.hearing.heard && g.hearing.heard.position.distanceTo(origin), aw: g.awareness.heard && g.awareness.heard.position.distanceTo(origin) });
      const right = { g1: rec(g1), g2: rec(g2), heardBy: s.heardBy };
      // she walks away (out of sight) while they react
      input.aimTapped = true; sim(30); input.move.x = -1; input.move.y = 0; sim(150); input.move.x = 0; sim(60);
      const her = motor.position.clone();
      const after = g => ({ state: g.awareness.state, focus: g.awareness.focus && g.awareness.focus.position.distanceTo(origin), focusHer: g.awareness.focus && Math.hypot(g.awareness.focus.position.x - her.x, g.awareness.focus.position.z - her.z), heardAt: g.awareness.heard && g.awareness.heard.position.distanceTo(origin), seen: g.awareness.seen, goal: g.goal ? Math.hypot(g.goal.x - origin.x, g.goal.z - origin.z) : null, confirmed: g.awareness.confirmed, susp: g.awareness.suspicion });
      const a1 = after(g1), a2 = after(g2);
      // an unconscious guard hears nothing
      g2.reset(); const gp = g2.position.clone(); motor.teleport(gp.x, gp.z - 1, 0); cam.snap(motor); sim(5); g2.ko.knockOut({ position: g2.position.clone(), along: new THREE.Vector3(1, 0, 0), by: motor.position.clone() }); sim(5);
      const before = g2.hearing.heardCount; aimAt(-2, -10.2, -2, 1.0, -8); press(); MV.tick(1 / 60, true);
      const ko = { heard: g2.hearing.heardCount - before, state: g2.ko.state, why: g2.hearing.last && g2.hearing.last.why };
      return { pre, right, a1, a2, her: { d: her.distanceTo(origin) }, ko, noiseRadius: s.noise.radius };
    });
    const o = r, okHear = o.right.g1.heard && o.right.g2.heard && o.right.g1.at < 1e-6 && o.right.g2.at < 1e-6 && o.right.g1.aw < 1e-6 && o.right.heardBy.length === 2;
    const react = a => ['SUSPICIOUS', 'INVESTIGATING'].indexOf(a.state) >= 0 && !a.confirmed && a.seen === null && a.focus != null && a.focus < 0.01 && a.heardAt < 0.01;
    const ok = okHear && o.pre.seen1 === null && o.pre.seen2 === null && react(o.a1) && react(o.a2) && o.her.d > 2 && o.ko.heard === 0 && o.ko.state === 'UNCONSCIOUS' && o.ko.why === 'unconscious' && page.errors.length === 0;
    return { pass: ok, detail: `shot from the far corner (L5, reach ${o.noiseRadius.toFixed(0)} m): heard by ${o.right.heardBy.map(l => l.split(' —')[0]).join(', ')} at the muzzle's spot exactly ${okHear}; ${o.her.d.toFixed(1)} m later out of sight: Guard 1 ${o.a1.state} (${Math.round(o.a1.susp * 100)}%), looking at the shot's origin (${o.a1.focus != null ? o.a1.focus.toFixed(2) : '–'} m off), not at her (${o.a1.focusHer != null ? o.a1.focusHer.toFixed(1) : '–'} m), never saw her ${o.a1.seen === null}, not ALERT ${!o.a1.confirmed}; Guard 2 ${o.a2.state} (${Math.round(o.a2.susp * 100)}%), origin ${o.a2.focus != null ? o.a2.focus.toFixed(2) : '–'} m off, saw her ${o.a2.seen !== null}; unconscious Guard 2 heard ${o.ko.heard} (${o.ko.why}); page errors ${page.errors.length}` };
  },

  // firing while moving and crouched: each shot leaves along the camera's ray at that instant and
  // hits what the crosshair is on; the aiming pace is unchanged by firing
  async fireMoving() {
    const page = await CHECKS._firePage();
    const r = await page.evaluate(() => {
      const { motor, input, cam } = MV, A = MV.aim, P = MV.pistol;
      const out = {};
      // facing the long wall from 5 m: every shot should land on it, on the crosshair's line
      for (const [n, x, y, crouch] of [['still', 0, 0], ['forward', 0, 0.8], ['backward', 0, -1], ['left', -1, 0], ['right', 1, 0], ['diagonal', 0.7, 0.7], ['crouched', 1, 0, true], ['crouched still', 0, 0, true]]) {
        aimAt(4, 7.5, 4, 1.3, 13, crouch);
        input.move.x = x; input.move.y = y; sim(50);
        let ok = 0, n0 = 0, spd = 0, off = 0, same = 0;
        for (let k = 0; k < 4; k++) { press(); MV.tick(1 / 60, true); const s = P.lastShot; n0++; spd = Math.max(spd, motor.speed);
          const v = s.aimed.point.clone().sub(s.origin); off = Math.max(off, v.clone().sub(s.dir.clone().multiplyScalar(v.dot(s.dir))).length());
          if (s.kind === 'wall') ok++; if (s.kind === 'wall' && s.point.distanceTo(s.aimed.point) < 0.06) same++; sim(14); }
        out[n] = { wall: ok, same, shots: n0, spd, off, pace: crouch ? A.cfg.crouchSpeed : A.cfg.speed, moving: x || y };
        input.move.x = input.move.y = 0; sim(20);
      }
      input.setCrouch(false);
      return out;
    });
    const rows = Object.entries(r), ok = rows.every(([k, v]) => v.wall === 4 && v.same === 4 && v.off < 1e-6 && (!v.moving || Math.abs(v.spd - v.pace) < 0.05)) && page.errors.length === 0;
    return { pass: ok, detail: rows.map(([k, v]) => `${k}: ${v.wall}/4 on the wall, ${v.same}/4 at the crosshair's point${v.moving ? `, ${v.spd.toFixed(2)} m/s` : ''}`).join('; ') + `; page errors ${page.errors.length}` };
  },

  // iPhone: real touches. AIM, then FIRE taps (one shot each), a FIRE held 1 s (one shot),
  // rapid taps, a cancelled touch, firing with the left thumb walking and the right dragging
  // the camera from the lower-right area between taps, a finger held across the mode change
  // (both ways), the page hidden; the frame rate while firing
  async fireTouch() {
    const page = await touchPage(), Tc = page.touch;
    const B = async sel => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const aim = await B('#mv-aim'), cqcB = await B('#mv-cqc');
    const tap = async (p, id, ms) => { const d = Tc('touchStart', [{ x: p.x, y: p.y, id }]); await page.waitForTimeout(ms || 70); const u = Tc('touchEnd', [{ x: p.x, y: p.y, id }]); await d; await u; };
    const st = () => page.evaluate(() => ({ shots: MV.pistol.shots, aim: MV.aim.active, k: MV.cam.aimK, cqc: MV.cqc.state, text: document.getElementById('mv-cqc').textContent.trim(), yaw: MV.cam.yaw, spd: MV.motor.speed, joy: !!MV.input.joy, look: !!MV.input.lookT, grabs: MV.cqc.grabs, tk: MV.cqc.takedowns || 0, fps: MV.fpsNow ? MV.fpsNow() : null }));
    const settle = () => page.waitForFunction(() => MV.cam.aimK > 0.98, null, { timeout: 15000, polling: 'raf' }).catch(() => {});
    const wr = a => Math.atan2(Math.sin(a), Math.cos(a));
    await page.evaluate(() => { const g = MV.guard2, p = g.position.clone().addScaledVector(g.forward(), -4); MV.motor.teleport(p.x, p.z, g.yaw); MV.cam.snap(MV.motor); });
    await tap(aim, 5); await settle(); const s0 = await st();
    await tap(cqcB, 6); await page.waitForTimeout(250); const one = await st();
    const dh = Tc('touchStart', [{ x: cqcB.x, y: cqcB.y, id: 7 }]); await page.waitForTimeout(1000); await Tc('touchEnd', [{ x: cqcB.x, y: cqcB.y, id: 7 }]); await dh; await page.waitForTimeout(150); const held = await st();
    for (let i = 0; i < 5; i++) { await tap(cqcB, 10 + i, 60); await page.waitForTimeout(260); } const rapid = await st();
    await Tc('touchStart', [{ x: cqcB.x, y: cqcB.y, id: 20 }]); await page.waitForTimeout(80); await Tc('touchCancel', []); await page.waitForTimeout(200); const cancelled = await st();
    // two thumbs: walking + dragging from the lower-right area, firing in between
    const W = page.viewportSize().width, H = page.viewportSize().height, dragAt = { x: W * 0.85, y: H * 0.82 };
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 150, y: 245, id: 1 }]); await page.waitForTimeout(400);
    const m0 = await st();
    await Tc('touchStart', [{ x: 150, y: 245, id: 1 }, { x: dragAt.x, y: dragAt.y, id: 2 }]);
    for (let i = 1; i <= 8; i++) { await Tc('touchMove', [{ x: 150, y: 245, id: 1 }, { x: dragAt.x - i * 6, y: dragAt.y, id: 2 }]); await page.waitForTimeout(25); }
    await Tc('touchEnd', [{ x: dragAt.x - 48, y: dragAt.y, id: 2 }]); const dragged = await st();
    const fd = Tc('touchStart', [{ x: 150, y: 245, id: 1 }, { x: cqcB.x, y: cqcB.y, id: 3 }]); await page.waitForTimeout(70); const fu = Tc('touchEnd', [{ x: cqcB.x, y: cqcB.y, id: 3 }]); await fd; await fu; await page.waitForTimeout(150);
    await Tc('touchStart', [{ x: 150, y: 245, id: 1 }, { x: dragAt.x, y: dragAt.y, id: 4 }]);
    for (let i = 1; i <= 8; i++) { await Tc('touchMove', [{ x: 150, y: 245, id: 1 }, { x: dragAt.x + i * 5, y: dragAt.y - i * 2, id: 4 }]); await page.waitForTimeout(25); }
    const mid = await st(); await Tc('touchEnd', [{ x: dragAt.x + 40, y: dragAt.y - 16, id: 4 }]);
    await page.waitForTimeout(100); const walking = await st(); await Tc('touchEnd', [{ x: 150, y: 245, id: 1 }]); await page.waitForTimeout(400);
    // a FIRE finger held while AIM goes off (another finger), lifted later: no grab, no takedown, no shot
    await page.evaluate(() => { const g = MV.guard2; g.reset(); const b = g.position.clone().addScaledVector(g.forward(), -1.0); MV.motor.teleport(b.x, b.z, g.yaw); MV.cam.snap(MV.motor); });
    await page.waitForTimeout(300);
    const x0 = await st();
    await Tc('touchStart', [{ x: cqcB.x, y: cqcB.y, id: 30 }]); await page.waitForTimeout(80);   // (fires one shot: a fresh FIRE press)
    await Tc('touchStart', [{ x: cqcB.x, y: cqcB.y, id: 30 }, { x: aim.x, y: aim.y, id: 31 }]); await page.waitForTimeout(70); await Tc('touchEnd', [{ x: aim.x, y: aim.y, id: 31 }]);
    await page.waitForTimeout(900); await Tc('touchEnd', [{ x: cqcB.x, y: cqcB.y, id: 30 }]); await page.waitForTimeout(500);
    const x1 = await st();
    // a CQC finger held while AIM comes on, lifted later: no grab, no takedown, no shot
    await Tc('touchStart', [{ x: cqcB.x, y: cqcB.y, id: 32 }, { x: aim.x, y: aim.y, id: 33 }]); await page.waitForTimeout(70); await Tc('touchEnd', [{ x: aim.x, y: aim.y, id: 33 }]);   // (both land in one event: the CQC press is still pending as AIM comes on)
    await page.waitForTimeout(900); await Tc('touchEnd', [{ x: cqcB.x, y: cqcB.y, id: 32 }]); await page.waitForTimeout(500);
    const x2 = await st();
    // the page hidden with a FIRE finger down: nothing stuck, no shot when it's back
    await settle(); await Tc('touchStart', [{ x: cqcB.x, y: cqcB.y, id: 40 }]); await page.waitForTimeout(60);
    const sh0 = (await st()).shots;
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(400); const back = await page.evaluate(() => ({ shots: MV.pistol.shots, pending: MV.input._firePresses.length, touches: MV.input._fireTouches.size, down: document.getElementById('mv-cqc').classList.contains('down') }));
    await Tc('touchEnd', [{ x: cqcB.x, y: cqcB.y, id: 40 }]);
    // frame rate: 4 s aiming without firing, then 4 s firing (2.5 taps a second), one frame counter
    await page.evaluate(() => { window.__f = 0; (function f() { window.__f++; requestAnimationFrame(f); })(); }); await page.waitForTimeout(1500);
    const b0 = await page.evaluate(() => { window.__f = 0; return performance.now(); }); await page.waitForTimeout(4000);
    const base = await page.evaluate(b0 => window.__f / ((performance.now() - b0) / 1000), b0);
    const f0 = await page.evaluate(() => { window.__f = 0; return performance.now(); });
    for (let i = 0; i < 10; i++) { await tap(cqcB, 50 + i, 60); await page.waitForTimeout(340); }
    const fr = await page.evaluate(f0 => window.__f / ((performance.now() - f0) / 1000), f0);
    await page.tap('#mv-reset'); await page.waitForTimeout(300); const reset = await st();
    const errs = page.errors.length;
    const ok = s0.aim && s0.text === 'FIRE' && one.shots === s0.shots + 1 && held.shots === one.shots + 1 && rapid.shots === held.shots + 5 && cancelled.shots === rapid.shots + 1
      && m0.joy && Math.abs(wr(dragged.yaw - m0.yaw)) > 0.1 && Math.abs(wr(mid.yaw - dragged.yaw)) > 0.05 && walking.shots === cancelled.shots + 1 && walking.joy && walking.spd > 1.0 && walking.aim
      && x1.shots === x0.shots + 1 && x1.grabs === x0.grabs && x1.tk === x0.tk && x1.cqc === 'FREE' && !x1.aim && x1.text === 'CQC'
      && x2.shots === x1.shots && x2.grabs === x1.grabs && x2.tk === x1.tk && x2.cqc === 'FREE' && x2.aim && x2.text === 'FIRE'
      && back.shots === sh0 && back.pending === 0 && back.touches === 0 && !back.down && reset.shots === 0 && reset.text === 'CQC' && fr > base * 0.8 && errs === 0;
    return { pass: ok, detail: `AIM → button "${s0.text}"; one tap → ${one.shots - s0.shots} shot; held 1 s → ${held.shots - one.shots}; 5 taps 0.33 s apart → ${rapid.shots - held.shots}; a press then touchcancel → ${cancelled.shots - rapid.shots} (the press itself fires; the cancel adds nothing); walking ${walking.spd.toFixed(2)} m/s with the right thumb dragging from the lower-right (turned ${(Math.abs(wr(dragged.yaw - m0.yaw)) * 57.3).toFixed(0)}°, then ${(Math.abs(wr(mid.yaw - dragged.yaw)) * 57.3).toFixed(0)}° back after the shot) and a FIRE tap between → ${walking.shots - cancelled.shots} shot, still aiming ${walking.aim}; FIRE finger held while AIM goes off, lifted 0.9 s later: shots ${x1.shots - x0.shots} (its own press), grabs ${x1.grabs - x0.grabs}, takedowns ${x1.tk - x0.tk}, button "${x1.text}"; CQC finger held while AIM comes on: shots ${x2.shots - x1.shots}, grabs ${x2.grabs - x1.grabs}, takedowns ${x2.tk - x1.tk}; page hidden with FIRE down: no shot ${back.shots === sh0}, nothing left held ${back.touches === 0 && !back.down}; frame rate firing ${fr.toFixed(0)} fps vs ${base.toFixed(0)} without (≥ 80%); RESET → shots ${reset.shots}, "${reset.text}"; page errors ${errs}` };
  },

  // Step 18.1: the right-hand controls are one row (AIM · CQC · CROUCH, THROW · CHOKE only while
  // holding a guard) above an open camera-swipe area in the lower right. On several iPhone
  // landscape sizes: every button on screen, apart, out of the stick's half and below STATS, none
  // over the crosshair; the lower-right area holds no control and really takes camera drags
  // (standing and aiming, with the left thumb walking); taps just outside a button don't press it;
  // a drag across the row presses nothing; AIM, CROUCH and CQC (grab, release, quick takedown) work
  // by real touches
  async controlLayout() {
    const out = [], fails = [];
    for (const [w, h, full] of [[844, 390, true], [667, 375], [932, 430], [780, 360]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
      await page.goto(base + '/movement.html'); await page.waitForSelector('#mv-start:not([hidden])', { timeout: 120000 });
      await page.tap('#mv-start'); await page.waitForTimeout(300); await page.evaluate(() => MV.setStats(true));   // (Step 24.1: STATS starts collapsed)
      const cdp = await ctx.newCDPSession(page), T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
      await page.evaluate(() => { MV.guard.patrol.enabled = false; MV.guard.personality.enabled = false; MV.guard.reset(); MV.motor.teleport(-6, -20, 0); MV.cam.snap(MV.motor); });
      const geo = await page.evaluate(() => {
        const W = innerWidth, H = innerHeight, R = id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return { id, l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
        document.getElementById('mv-throw').hidden = false; document.getElementById('mv-choke').hidden = false;   // (laid out as while holding a guard)
        const ids = ['mv-aim', 'mv-cqc', 'mv-crouch', 'mv-throw', 'mv-choke'], B = ids.map(R);
        const stats = R('mv-stats'), chips = ['mv-reset', 'mv-stats-btn'].map(R);
        document.getElementById('mv-throw').hidden = true; document.getElementById('mv-choke').hidden = true;
        let gap = Infinity; for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) gap = Math.min(gap, Math.hypot(B[i].cx - B[j].cx, B[i].cy - B[j].cy) - (B[i].r - B[i].l) / 2 - (B[j].r - B[j].l) / 2);
        const rowBottom = Math.max(...B.map(b => b.b));
        // the swipe area: right of the screen's middle (55%), below the row, to the edges
        const zone = { l: 0.55 * W, t: rowBottom + 12, r: W, b: H };
        let blocked = 0, n = 0;
        for (let x = zone.l + 4; x < zone.r - 2; x += 12) for (let y = zone.t + 4; y < zone.b - 2; y += 12) { n++; const e = document.elementFromPoint(x, y); if (!e || e.tagName !== 'CANVAS') blocked++; }
        const inZone = B.filter(b => !(b.r <= zone.l || b.l >= zone.r || b.b <= zone.t || b.t >= zone.b)).map(b => b.id);
        const xh = { x: W / 2, y: H / 2 }, overXh = B.slice(0, 3).filter(b => xh.x > b.l - 16 && xh.x < b.r + 16 && xh.y > b.t - 16 && xh.y < b.b + 16).map(b => b.id);
        const centreHit = ids.slice(0, 3).every(id => { const b = R(id); return document.elementFromPoint(b.cx, b.cy).closest('#' + id); });
        // just outside each circle (the corners of its box) belongs to the camera, not the button
        const corners = ids.slice(0, 3).every(id => { const b = R(id); return [[b.l + 3, b.t + 3], [b.r - 3, b.t + 3], [b.l + 3, b.b - 3], [b.r - 3, b.b - 3]].every(([x, y]) => !document.elementFromPoint(x, y).closest('button')); });
        return { W, H, B, gap, rowBottom, zone, zoneW: (zone.r - zone.l) / W, zoneH: (zone.b - zone.t) / H, blocked, n, inZone, overXh, centreHit, corners,
          onScreen: B.every(b => b.l >= 8 && b.r <= W - 8 && b.t >= 8 && b.b <= H - 8), belowStats: B.every(b => b.t >= stats.b && chips.every(c => b.t >= c.b)), outOfStick: B.every(b => b.l >= 0.45 * W) };
      });
      const r = { geo };
      const tapAt = async (x, y, id) => { const d = T('touchStart', [{ x, y, id }]); await page.waitForTimeout(70); const u = T('touchEnd', [{ x, y, id }]); await d; await u; await page.waitForTimeout(120); };
      const st = () => page.evaluate(() => ({ aim: MV.aim.active, yaw: MV.cam.yaw, pitch: MV.cam.pitch, crouch: MV.input.crouch, cqc: MV.cqc.state, spd: MV.motor.speed, look: !!MV.input.lookT, joy: !!MV.input.joy, cqcLast: MV.input.cqcLast, ko2: MV.guard2.ko.state }));
      const wr = a => Math.atan2(Math.sin(a), Math.cos(a));
      const aim = geo.B[0], cqcB = geo.B[1], cr = geo.B[2], Z = geo.zone;
      // a drag from the bottom-right corner area turns the camera both ways
      const drag = async (x0, y0, dx, dy, id, keep) => { await T('touchStart', keep ? [...keep, { x: x0, y: y0, id }] : [{ x: x0, y: y0, id }]); for (let i = 1; i <= 10; i++) { await T('touchMove', keep ? [...keep, { x: x0 + dx * i / 10, y: y0 + dy * i / 10, id }] : [{ x: x0 + dx * i / 10, y: y0 + dy * i / 10, id }]); await page.waitForTimeout(25); } await T('touchEnd', [{ x: x0 + dx, y: y0 + dy, id }]); await page.waitForTimeout(80); };
      const cx = Z.l + (Z.r - Z.l) * 0.75, cy = Z.t + (Z.b - Z.t) * 0.7;   // well into the corner
      let s0 = await st(); await drag(cx, cy, -90, -30, 3); let s1 = await st();
      r.swipe = { yaw: wr(s1.yaw - s0.yaw), pitch: s1.pitch - s0.pitch, stray: s1.aim || s1.crouch !== s0.crouch || s1.cqc !== 'FREE' };
      // AIM: a tap on it toggles and doesn't move the camera
      s0 = await st(); await tapAt(aim.cx, aim.cy, 4); await page.waitForTimeout(500); s1 = await st();
      r.aimOn = { on: s1.aim, yaw: wr(s1.yaw - s0.yaw), pitch: s1.pitch - s0.pitch };
      // aiming: left thumb walking while the right drags from the corner area
      const L = [{ x: 0.18 * w, y: 0.8 * h, id: 1 }];
      await T('touchStart', L); await T('touchMove', [{ x: 0.18 * w, y: 0.8 * h - 55, id: 1 }]); L[0].y -= 55; await page.waitForTimeout(500);
      s0 = await st(); await drag(cx, cy, 70, 25, 5, L); s1 = await st();
      r.twoThumbs = { spd: s1.spd, yaw: wr(s1.yaw - s0.yaw), pitch: s1.pitch - s0.pitch, joy: s1.joy, aim: s1.aim };
      // AIM off by a tap while still walking: the stick keeps going
      await T('touchStart', [...L, { x: aim.cx, y: aim.cy, id: 6 }]); await page.waitForTimeout(70); await T('touchEnd', [{ x: aim.cx, y: aim.cy, id: 6 }]); await page.waitForTimeout(400);
      r.aimOff = await st(); await T('touchEnd', L); await page.waitForTimeout(500);
      // near misses: the corners of AIM's / CROUCH's box, and halfway between neighbours
      s0 = await st();
      for (const b of [aim, cr]) await tapAt(b.l + 3, b.t + 3, 7);
      await tapAt((aim.cx + cqcB.cx) / 2, aim.cy + (aim.b - aim.t) * 0.45, 8);
      s1 = await st(); r.nearMiss = s1.aim === s0.aim && s1.crouch === s0.crouch && s1.cqc === 'FREE' && s1.cqcLast === s0.cqcLast;
      // a camera drag starting in the open area and sliding across the row presses nothing
      s0 = await st(); await drag(cx, Z.t + 6, -(cx - cr.cx), -(Z.t + 6 - cr.cy), 9); s1 = await st();
      r.across = s1.aim === s0.aim && s1.crouch === s0.crouch && s1.cqc === 'FREE' && s1.cqcLast === s0.cqcLast && Math.abs(wr(s1.yaw - s0.yaw)) > 0.05;
      // CROUCH
      await tapAt(cr.cx, cr.cy, 10); const c1 = (await st()).crouch; await tapAt(cr.cx, cr.cy, 11); const c2 = (await st()).crouch;
      r.crouch = c1 && !c2;
      if (full) {   // CQC by real touches on Guard 2: TAP grabs, TAP releases, HOLD takes him down
        const behind = () => page.evaluate(() => { const g = MV.guard2; g.reset(); MV.cqc.cancel(); const b = g.position.clone().addScaledVector(g.forward(), -1.0); MV.motor.teleport(b.x, b.z, g.yaw); MV.cam.snap(MV.motor); });
        await behind(); await page.waitForTimeout(300); await tapAt(cqcB.cx, cqcB.cy, 12);
        await page.waitForFunction(() => MV.cqc.state === 'GRAPPLING', null, { timeout: 8000 }).catch(() => {}); const grab = (await st()).cqc;
        const rel = await page.locator('#mv-cqc').boundingBox(); await tapAt(rel.x + rel.width / 2, rel.y + rel.height / 2, 13);
        await page.waitForFunction(() => MV.cqc.state === 'FREE', null, { timeout: 8000 }).catch(() => {}); const released = (await st()).cqc;
        await behind(); await page.waitForTimeout(300);
        await T('touchStart', [{ x: cqcB.cx, y: cqcB.cy, id: 14 }]); await page.waitForFunction(() => MV.cqc.state !== 'FREE', null, { timeout: 8000 }).catch(() => {});
        await T('touchEnd', [{ x: cqcB.cx, y: cqcB.cy, id: 14 }]); await page.waitForFunction(() => MV.guard2.ko.state === 'UNCONSCIOUS', null, { timeout: 10000 }).catch(() => {});
        const td = await st(); r.cqc = { grab, released, takedown: td.ko2, last: td.cqcLast };
        await page.tap('#mv-reset'); await page.waitForTimeout(200);
      }
      const g = geo, ok = g.onScreen && g.belowStats && g.outOfStick && g.gap >= 8 && g.inZone.length === 0 && g.blocked === 0 && g.zoneW >= 0.44 && g.zoneH >= 0.4 && g.overXh.length === 0 && g.centreHit && g.corners
        && Math.abs(r.swipe.yaw) > 0.2 && Math.abs(r.swipe.pitch) > 0.03 && !r.swipe.stray && r.aimOn.on && r.aimOn.yaw === 0 && r.aimOn.pitch === 0
        && r.twoThumbs.aim && r.twoThumbs.joy && r.twoThumbs.spd > 1.2 && Math.abs(r.twoThumbs.yaw) > 0.1 && Math.abs(r.twoThumbs.pitch) > 0.01 && !r.aimOff.aim && r.aimOff.joy && r.aimOff.spd > 1
        && r.nearMiss && r.across && r.crouch && (!full || (r.cqc.grab === 'GRAPPLING' && r.cqc.released === 'FREE' && r.cqc.takedown === 'UNCONSCIOUS')) && errs.length === 0;
      if (!ok) fails.push(w + '×' + h);
      out.push(`${w}×${h}: row y ${Math.round(g.B[0].t)}–${Math.round(g.rowBottom)} px, gaps ≥ ${g.gap.toFixed(0)} px, on screen/below STATS/out of the stick half ${g.onScreen}/${g.belowStats}/${g.outOfStick}, over the crosshair ${g.overXh.join(',') || 'none'}; swipe area ${Math.round(g.zoneW * 100)}% × ${Math.round(g.zoneH * 100)}% with ${g.inZone.length} controls, ${g.blocked}/${g.n} points not the camera; corner drag turned ${(r.swipe.yaw * 57.3).toFixed(0)}° / pitch ${(r.swipe.pitch * 57.3).toFixed(0)}°; AIM tap → ${r.aimOn.on} (camera still ${r.aimOn.yaw === 0 && r.aimOn.pitch === 0}); aiming, walking ${r.twoThumbs.spd.toFixed(2)} m/s + corner drag ${(r.twoThumbs.yaw * 57.3).toFixed(0)}°; AIM off while walking: ${r.aimOff.aim}, still walking ${r.aimOff.spd.toFixed(2)} m/s; near misses press nothing ${r.nearMiss}; drag across the row presses nothing ${r.across}; CROUCH ${r.crouch}${full ? `; CQC tap ${r.cqc.grab}, tap ${r.cqc.released}, hold → Guard 2 ${r.cqc.takedown}` : ''}${errs.length ? '; errors ' + errs.join(';') : ''}`);
      await ctx.close();
    }
    return { pass: fails.length === 0, detail: (fails.length ? 'FAILED at ' + fails.join(', ') + ' — ' : '') + out.join(' | ') };
  },

  // ---------------------------------------------------------------- Step 18: aiming (AIM ONLY)
  // AIM toggles; the camera eases into the over-the-shoulder view and back to exactly the normal
  // framing; the crosshair only while aiming; the pistol out only while aiming; rapid toggling
  // never leaves anything half-way; RESET restores the defaults (steps the real frame, MV.tick)
  async aimToggle() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, input, cam } = MV, dt = 1 / 60, A = MV.aim, P = MV.aimPose, xh = document.getElementById('mv-crosshair'), btn = document.getElementById('mv-aim');
      const sim = n => { for (let i = 0; i < n; i++) MV.tick(dt, true); };
      motor.teleport(-19, 19, 0); cam.snap(motor); sim(60);
      const before = { dist: cam.dist, pitch: cam.pitch, yaw: cam.yaw, sens: cam.cfg.sensitivity, xh: xh.hidden, pistol: P.pistol.visible };
      input.aimTapped = true; let maxStep = 0, last = MV.camera.position.clone(), ks = [];
      for (let i = 0; i < 90; i++) { MV.tick(dt, true); maxStep = Math.max(maxStep, MV.camera.position.distanceTo(last)); last.copy(MV.camera.position); ks.push(cam.aimK); }
      const k5 = ks[4], mono = ks.every((k, i) => i === 0 || k >= ks[i - 1] - 1e-9);
      const on = { active: A.active, k: cam.aimK, dist: cam.dist, xh: xh.hidden, btn: btn.classList.contains('on'), pistol: P.pistol.visible, status: A.status(false) };
      // the camera's offset from her: closer, further right
      const c = MV.camera.position, m = motor.position, right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
      on.side = c.clone().sub(m).dot(right);
      input.aimTapped = true; let maxOut = 0;
      for (let i = 0; i < 150; i++) { MV.tick(dt, true); maxOut = Math.max(maxOut, MV.camera.position.distanceTo(last)); last.copy(MV.camera.position); }
      const off = { active: A.active, k: cam.aimK, dist: cam.dist, pitch: cam.pitch, yaw: cam.yaw, xh: xh.hidden, btn: btn.classList.contains('on'), pistol: P.pistol.visible, sens: cam.cfg.sensitivity, wArm: MV.visual.bones.rightArm.quaternion.clone() };
      // rapid toggling: 10 taps a few frames apart (ends not aiming), then settle
      for (let i = 0; i < 10; i++) { input.aimTapped = true; sim(3 + (i % 3)); }
      const midRapid = A.active; sim(150);
      const rapid = { active: A.active, k: cam.aimK, xh: xh.hidden, pistol: P.pistol.visible, legYaw: A.legYaw, enters: A.enters, exits: A.exits };
      // RESET while aiming
      input.aimTapped = true; sim(40);
      document.getElementById('mv-reset').click(); sim(2);
      const reset = { active: A.active, k: cam.aimK, target: cam.aimTarget, xh: xh.hidden, btn: btn.classList.contains('on'), pistol: P.pistol.visible, legYaw: A.legYaw };
      return { before, on, off, rapid, midRapid, reset, maxStep, maxOut, k5, mono };
    });
    const ok = r.before.xh && !r.before.pistol && r.on.active && r.on.k > 0.99 && Math.abs(r.on.dist - 1.6) < 0.1 && r.on.side > 0.45 && !r.on.xh && r.on.btn && r.on.pistol && /ON/.test(r.on.status)
      && r.k5 < 0.3 && r.mono && r.maxStep < 0.15 && r.maxOut < 0.15
      && !r.off.active && r.off.k < 0.01 && Math.abs(r.off.dist - r.before.dist) < 0.05 && Math.abs(r.off.pitch - r.before.pitch) < 1e-6 && Math.abs(r.off.yaw - r.before.yaw) < 1e-6 && r.off.xh && !r.off.btn && !r.off.pistol && r.off.sens === r.before.sens
      && !r.rapid.active && r.rapid.k < 0.01 && r.rapid.xh && !r.rapid.pistol && Math.abs(r.rapid.legYaw) < 1e-3 && r.rapid.enters === 6 && r.rapid.exits === 6
      && !r.reset.active && r.reset.k === 0 && r.reset.target === 0 && r.reset.xh && !r.reset.btn && !r.reset.pistol && r.reset.legYaw === 0 && page.errors.length === 0;
    return { pass: ok, detail: `tap: aiming ${r.on.active}, camera ${r.on.dist.toFixed(2)} m back (normal ${r.before.dist.toFixed(2)}), ${r.on.side.toFixed(2)} m right, blend after 5 frames ${(r.k5 * 100).toFixed(0)}% (eased, monotonic ${r.mono}), largest camera step ${cm(r.maxStep)} in / ${cm(r.maxOut)} out per frame; crosshair ${!r.on.xh}, pistol ${r.on.pistol}; tap again: camera ${r.off.dist.toFixed(2)} m, yaw/pitch unchanged ${Math.abs(r.off.yaw - r.before.yaw) < 1e-6 && Math.abs(r.off.pitch - r.before.pitch) < 1e-6}, crosshair hidden ${r.off.xh}, pistol ${r.off.pistol}; 10 rapid taps then settled: aiming ${r.rapid.active}, blend ${r.rapid.k.toFixed(3)}, entered/left ${r.rapid.enters}/${r.rapid.exits}; RESET while aiming: aiming ${r.reset.active}, blend ${r.reset.k}, crosshair hidden ${r.reset.xh}, pistol ${r.reset.pistol}; page errors ${page.errors.length}` };
  },

  // dragging the camera turns the aim (horizontal: yaw, vertical: pitch) and she turns to face
  // it smoothly (rate-limited, no snap), standing still; the crosshair (screen centre) is the aim
  // ray; neither her head nor her shoulder sits over the crosshair
  async aimFacing() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, input, cam } = MV, dt = 1 / 60, A = MV.aim, B = MV.visual.bones, wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
      const sim = n => { for (let i = 0; i < n; i++) MV.tick(dt, true); };
      motor.teleport(-19, 19, 0.5); cam.snap(motor); sim(30); input.aimTapped = true; sim(60);
      const p0 = motor.position.clone(), yaw0 = cam.yaw;
      // a horizontal drag of 120 px (touch) in 10 frames, then a vertical one
      for (let i = 0; i < 10; i++) { input.look.dx += 12; input.mouse = false; MV.tick(dt, true); }
      const dyaw = wrap(cam.yaw - yaw0), want = cam.cfg.sensitivity * cam.cfg.aim.sensitivity * 120;
      let maxRate = 0, prev = motor.yaw, n = 0;
      while (Math.abs(wrap(cam.yaw + Math.PI - motor.yaw)) > 0.01 && n < 300) { MV.tick(dt, true); maxRate = Math.max(maxRate, Math.abs(wrap(motor.yaw - prev)) / dt); prev = motor.yaw; n++; }
      sim(10);
      const faced = Math.abs(wrap(cam.yaw + Math.PI - motor.yaw)) * 57.3;
      const p1 = motor.position.clone();
      const pitch0 = cam.pitch; for (let i = 0; i < 10; i++) { input.look.dy += -6; MV.tick(dt, true); }
      const dpitch = cam.pitch - pitch0;
      sim(5);
      // the aim ray is the camera's centre ray
      const T = A.target, cd = MV.camera.getWorldDirection(new THREE.Vector3()), along = T.dir.dot(cd), fromCam = T.origin.distanceTo(MV.camera.position);
      const up = Math.asin(T.dir.y);
      // a 180° flip of the camera: she turns round over several frames, never snapping
      const yawB = motor.yaw; cam.yaw = wrap(cam.yaw + Math.PI); let flipF = 0, flipMax = 0; prev = motor.yaw;
      while (Math.abs(wrap(cam.yaw + Math.PI - motor.yaw)) > 0.02 && flipF < 400) { MV.tick(dt, true); flipMax = Math.max(flipMax, Math.abs(wrap(motor.yaw - prev))); prev = motor.yaw; flipF++; }
      sim(20);
      // pixels from the screen centre to her head and right shoulder (844×390 screen)
      const scr = v => { const q = v.clone().project(MV.camera); return [(q.x + 1) / 2 * 844, (1 - q.y) / 2 * 390]; };
      const W = b => b.getWorldPosition(new THREE.Vector3());
      const dpx = b => { const [x, y] = scr(W(b)); return Math.hypot(x - 422, y - 195); };
      const head = dpx(B.head), shoulder = dpx(B.rightArm), xh = (() => { const [x] = scr(W(B.head)); return x; })();
      // she stood still throughout (turning on the spot)
      const drift = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      return { dyaw, want, maxRate, n, faced, dpitch, along, fromCam, up, flipF, flipMax: flipMax * 57.3, head, shoulder, headX: xh, drift, turnRate: A.cfg.turnRate };
    });
    const ok = Math.abs(-r.dyaw - r.want) < 0.01 && r.want > 0.4 && r.n > 3 && r.maxRate <= r.turnRate + 0.01 && r.faced < 1 && r.dpitch < -0.03 && r.along > 0.9999 && r.fromCam < 1e-3 && r.up > 0
      && r.flipF >= 25 && r.flipMax < 8 && r.head > 60 && r.shoulder > 60 && r.headX < 422 && r.drift < 0.05 && page.errors.length === 0;
    return { pass: ok, detail: `120 px drag right → aim turned ${(-r.dyaw * 57.3).toFixed(1)}° right (expected ${(r.want * 57.3).toFixed(1)}°); she followed in ${r.n} frames, at most ${(r.maxRate * 57.3).toFixed(0)}°/s (limit ${(r.turnRate * 57.3).toFixed(0)}), now ${r.faced.toFixed(2)}° off; upward drag → camera pitch ${(r.dpitch * 57.3).toFixed(1)}°, aim ${(r.up * 57.3).toFixed(1)}° up; aim ray = camera centre ray (dot ${r.along.toFixed(5)}, from the camera ${r.fromCam.toFixed(4)} m); camera flipped 180°: she turned round in ${r.flipF} frames, largest step ${r.flipMax.toFixed(1)}°; head ${r.head.toFixed(0)} px, right shoulder ${r.shoulder.toFixed(0)} px from the crosshair (head left of it ${r.headX < 422}); drift standing ${cm(r.drift)}; page errors ${page.errors.length}` };
  },

  // movement while aiming: forward, back, both strafes and diagonals, at the configured 1.4 m/s,
  // camera-relative, without turning away from the aim; footsteps keep their noise; when AIM
  // ends the normal stick speeds are exactly as before
  async aimMovement() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, input, cam } = MV, dt = 1 / 60, A = MV.aim, noise = MV.noise;
      const sim = n => { for (let i = 0; i < n; i++) MV.tick(dt, true); };
      const speeds = () => { const out = {}; for (const [n, m] of [['sneak', 0.35], ['walk', 0.78], ['jog', 1]]) { motor.teleport(-6, -20, 0); cam.snap(motor); input.move.x = 0; input.move.y = m; sim(110); out[n] = +motor.speed.toFixed(3); input.move.y = 0; sim(60); } return out; };
      const before = speeds();
      motor.teleport(-6, -14, 0.3); cam.snap(motor); sim(20); input.aimTapped = true; sim(60);
      const moves = {}; let steps = 0, stepLevels = new Set();
      const heard = () => { const n = noise.last; return n; };
      for (const [n, x, y] of [['forward', 0, 1], ['backward', 0, -1], ['left', -1, 0], ['right', 1, 0], ['diag fwd-right', 0.707, 0.707], ['diag back-left', -0.707, -0.707]]) {
        motor.teleport(-6, -14, motor.yaw); sim(5);
        const yaw0 = motor.yaw, p0 = motor.position.clone(), f = new THREE.Vector3(); cam.forward(f); const rt = new THREE.Vector3(-f.z, 0, f.x);
        input.move.x = x; input.move.y = y; let spd = 0, turn = 0, leg = 0, rev = false, n0 = noise.last;
        for (let i = 0; i < 130; i++) { MV.tick(dt, true); if (i > 60) { spd = Math.max(spd, motor.speed); leg = Math.max(leg, Math.abs(A.legYaw)); rev = rev || motor.reverseGait; }
          turn = Math.max(turn, Math.abs(Math.atan2(Math.sin(motor.yaw - yaw0), Math.cos(motor.yaw - yaw0))));
          if (noise.last && noise.last !== n0 && noise.last.type === 'footstep') { steps++; stepLevels.add(noise.last.level); n0 = noise.last; } }
        input.move.x = input.move.y = 0; sim(40);
        const d = motor.position.clone().sub(p0), dl = Math.hypot(d.x, d.z) || 1;
        moves[n] = { spd, turn: turn * 57.3, along: (d.dot(f) * y + d.dot(rt) * x) / dl / Math.hypot(x, y), leg: leg * 57.3, rev, still: motor.speed };
      }
      const stillAiming = A.active;
      input.aimTapped = true; sim(80);
      const after = speeds();
      return { before, after, moves, steps, levels: [...stepLevels], stillAiming, cfg: A.cfg.speed };
    });
    const M = r.moves, mv = Object.values(M);
    const ok = mv.every(m => Math.abs(m.spd - r.cfg) < 0.03 && m.turn < 1 && m.along > 0.99 && m.still < 0.05) && M.backward.rev && !M.forward.rev && M.left.leg > 30 && M.right.leg > 30 && M.forward.leg < 2
      && r.steps > 6 && r.levels.length > 0 && r.levels.every(l => l >= 1) && r.stillAiming && JSON.stringify(r.before) === JSON.stringify(r.after) && page.errors.length === 0;
    return { pass: ok, detail: Object.entries(M).map(([k, m]) => `${k} ${m.spd.toFixed(2)} m/s (turned ${m.turn.toFixed(1)}°, on line ${m.along.toFixed(3)}, legs ${m.leg.toFixed(0)}°${m.rev ? ', stepping back' : ''})`).join('; ') + `; ${r.steps} footsteps at levels ${r.levels.join('/')}; normal speeds before ${JSON.stringify(r.before)} = after ${JSON.stringify(r.after)}; page errors ${page.errors.length}` };
  },

  // crouched aiming: enter while crouched, the camera drops, the slower crouched pace, standing
  // up keeps AIM, and leaving AIM gives the normal crouch back
  async aimCrouch() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, input, cam } = MV, dt = 1 / 60, A = MV.aim, P = MV.aimPose, B = MV.visual.bones, W = b => b.getWorldPosition(new THREE.Vector3());
      const sim = n => { for (let i = 0; i < n; i++) MV.tick(dt, true); };
      motor.teleport(-19, 19, 0); cam.snap(motor); sim(20);
      input.aimTapped = true; sim(80); const standY = MV.camera.position.y;
      input.setCrouch(true); sim(80);
      const crouchY = MV.camera.position.y, inCrouch = { active: A.active, stance: motor.stance, hand: W(B.rightHand).distanceTo(W(P.pistol)), pistol: P.pistol.visible, gunUp: P.gunDir.y };
      input.move.y = 1; let spd = 0; for (let i = 0; i < 120; i++) { MV.tick(dt, true); spd = Math.max(spd, motor.speed); } input.move.y = 0; sim(40);
      input.setCrouch(false); sim(60); const stoodUp = A.active;
      input.setCrouch(true); sim(30); input.aimTapped = true; sim(90);
      // normal crouch again: the stick picks the normal crouch speeds
      input.move.y = 1; let cs = 0; for (let i = 0; i < 150; i++) { MV.tick(dt, true); cs = Math.max(cs, motor.speed); } input.move.y = 0; sim(30);
      const out = { active: A.active, stance: motor.stance, pistol: P.pistol.visible, k: cam.aimK };
      // entering AIM while already crouched
      sim(30); input.aimTapped = true; sim(60); const enterCrouched = A.active && motor.stance === 'crouch';
      return { standY, crouchY, inCrouch, spd, stoodUp, out, cs, enterCrouched, cfg: A.cfg.crouchSpeed };
    });
    const ok = r.inCrouch.active && r.inCrouch.stance === 'crouch' && r.inCrouch.pistol && r.inCrouch.hand < 0.12 && r.crouchY < r.standY - 0.3 && Math.abs(r.spd - r.cfg) < 0.03
      && r.stoodUp && !r.out.active && r.out.stance === 'crouch' && !r.out.pistol && r.out.k < 0.01 && r.cs > r.cfg + 0.2 && r.enterCrouched && page.errors.length === 0;
    return { pass: ok, detail: `aiming then CROUCH: still aiming ${r.inCrouch.active}, camera ${r.standY.toFixed(2)} → ${r.crouchY.toFixed(2)} m, hand on the pistol ${cm(r.inCrouch.hand)}; crouched aim pace ${r.spd.toFixed(2)} m/s (config ${r.cfg}); stood up still aiming ${r.stoodUp}; AIM off while crouched: ${r.out.stance}, normal crouch speed ${r.cs.toFixed(2)} m/s, pistol ${r.out.pistol}; AIM entered while crouched ${r.enterCrouched}; page errors ${page.errors.length}` };
  },

  // the aiming camera keeps out of walls (her right shoulder against the corridor wall); the aim
  // ray stops at the real first obstruction (wall, crate, pillar, guard, ground); the muzzle's
  // own line is reported separately (cover in front of the pistol but not the camera)
  async aimCollision() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, input, cam, world } = MV, dt = 1 / 60, A = MV.aim, g2 = MV.guard2;
      const sim = n => { for (let i = 0; i < n; i++) MV.tick(dt, true); };
      const inside = p => world.boxes.some(b => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y < b.top);
      const rayClear = () => { const o = new THREE.Vector3(motor.position.x, cam.focus.y, motor.position.z), c = MV.camera.position; return !world.segmentBlocked(o, c.clone()); };
      const out = {};
      // corridor (x 16.2 … 17.8): facing north along it, her right shoulder 0.3 m from the west wall
      motor.teleport(16.5, -3, 0); cam.snap(motor); sim(30); input.aimTapped = true;
      let bad = 0, minWall = Infinity; for (let i = 0; i < 120; i++) { MV.tick(dt, true); const c = MV.camera.position; if (inside(c) || !rayClear()) bad++; minWall = Math.min(minWall, c.x - 16.175); }
      out.corridor = { bad, minWall, dist: cam.dist };
      // turning the camera round in the corridor while aiming
      let bad2 = 0; for (let i = 0; i < 120; i++) { input.look.dx += 15; MV.tick(dt, true); const c = MV.camera.position; if (inside(c) || !rayClear()) bad2++; }
      out.turning = bad2;
      input.aimTapped = true; sim(90);
      // aim ray targets: aim straight at things from a known spot
      const aimAt = (px, pz, tx, ty, tz, crouch) => { motor.teleport(px, pz, 0); cam.snap(motor); input.setCrouch(!!crouch); sim(40); input.aimTapped = true; sim(60);
        for (let k = 0; k < 4; k++) { // turn the camera until the screen centre is on the point
          MV.camera.updateMatrixWorld(); const d = new THREE.Vector3(tx, ty, tz).sub(MV.camera.position).normalize();
          cam.yaw = Math.atan2(-d.x, -d.z); cam.pitch = Math.asin(-d.y); sim(30); }
        const T = A.target, res = { what: T.what, dist: T.dist, guard: T.guard ? T.guard.cfg.label : null, clear: T.muzzleClear, point: T.point.clone(), muzzle: !!T.muzzle, mdir: !!T.muzzleDir, xh: document.getElementById('mv-crosshair').className };
        input.aimTapped = true; sim(60); return res; };
      out.crate = aimAt(-2, -12, -2, 1.2, -8);           // the tall crate (2 m) from 4 m south
      out.crateFace = out.crate.point.z;                 // its south face is at z = -8.6
      const gp = g2.position; out.guard = aimAt(gp.x - 3, gp.z, gp.x, 1.2, gp.z);
      out.ground = aimAt(-19, 19, -15, 0, 21);
      out.wall = aimAt(4, 10, 4, 1.5, 13);               // the long wall (face at z = 12.825)
      // crouched behind the low crate (0.9 m, just in front of her), aiming over it at the long wall:
      // the camera sees the wall, the pistol's own line is blocked by the crate
      out.lowCover = aimAt(3, -6.2, 3, 1.0, 12.8, true); input.setCrouch(false); sim(30);
      return out;
    });
    const o = r, ok = o.corridor.bad === 0 && o.turning === 0 && o.corridor.minWall > 0.1
      && o.crate.what === 'wall / cover' && Math.abs(o.crateFace - -8.6) < 0.05 && /^Guard 2/.test(o.guard.guard) && /guard/.test(o.guard.xh) && o.ground.what === 'ground' && Math.abs(o.ground.point.y) < 1e-6
      && o.wall.what === 'wall / cover' && Math.abs(o.wall.point.z - 12.825) < 0.05 && o.crate.clear && o.crate.muzzle && o.crate.mdir && o.lowCover.what === 'wall / cover' && Math.abs(o.lowCover.point.z - 12.825) < 0.05 && !o.lowCover.clear && /blocked/.test(o.lowCover.xh);
    return { pass: ok && page.errors.length === 0, detail: `corridor, right shoulder to the wall: camera inside a wall or behind one in ${o.corridor.bad}/120 frames, ${o.turning}/120 turning round, closest ${cm(o.corridor.minWall)} from the wall; aim at the tall crate → ${o.crate.what} at z ${o.crate.point.z.toFixed(2)} (face −8.60); at Guard 2 → ${o.guard.guard} (${o.guard.dist.toFixed(1)} m, crosshair "${o.guard.xh}"); at the floor → ${o.ground.what}; at the long wall → ${o.wall.what} at z ${o.wall.point.z.toFixed(2)} (face 12.83); muzzle origin/direction reported ${o.crate.muzzle}/${o.crate.mdir}, its line to the crate clear ${o.crate.clear}; crouched behind the low crate: camera sees ${o.lowCover.what} at z ${o.lowCover.point.z.toFixed(2)}, muzzle clear ${o.lowCover.clear} (crosshair "${o.lowCover.xh}"); page errors ${page.errors.length}` };
  },

  // AIM and CQC: AIM isn't available in any CQC state (restraint, throw, choke, quick takedown,
  // break-free); while aiming, TAP / HOLD CQC, THROW and CHOKE do nothing; after AIM ends CQC
  // works as before; nothing fires, hurts or alerts (no FIRE button, guards stay calm)
  async aimCqc() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, input, cam } = MV, dt = 1 / 60, A = MV.aim, cq = MV.cqc, g2 = MV.guard2, g1 = MV.guard;
      const sim = n => { for (let i = 0; i < n; i++) MV.tick(dt, true); };
      const behind = () => { cq.cancel(); g2.reset(); const b = g2.position.clone().addScaledVector(g2.forward(), -1.0); motor.teleport(b.x, b.z, g2.yaw); cam.snap(motor); sim(10); };
      const tryAim = () => { input.aimTapped = true; sim(2); const a = A.active; if (a) { input.aimTapped = true; sim(2); } return a; };
      const out = {};
      // while aiming: CQC presses do nothing
      behind(); input.aimTapped = true; sim(40);
      input.cqcTapped = true; sim(30); out.tap = cq.state;
      cq.input._cqcPress(performance.now() - 1000); sim(30); cq.input._cqcUp(performance.now()); sim(10); out.hold = cq.state;
      input.throwTapped = true; input._chokeKey = true; input.chokePresses++; sim(20); input._chokeKey = false; out.throwChoke = cq.state;
      out.cqcStat = cq.status(); out.cqcLocked = document.getElementById('mv-cqc').classList.contains('fire') && document.getElementById('mv-cqc').textContent.trim() === 'FIRE';   // (Step 19: while aiming the CQC button is FIRE, not dimmed)
      out.alerted = g2.awareness.state;   // (he may well have heard her step in behind him: the normal hearing rules; that's not this check)
      out.guard = { aware: g2.awareness.state, held: !!g2.restraint, ko: g2.ko.state };
      // AIM off: CQC is back
      input.aimTapped = true; sim(30); input.cqcTapped = true; sim(40); out.after = cq.state;
      // AIM during each CQC state
      out.grappling = tryAim(); out.aimBtnLocked = document.getElementById('mv-aim').classList.contains('locked');
      input._chokeKey = true; input.chokePresses++; sim(20); out.choking = cq.state === 'CHOKING' && tryAim(); input._chokeKey = false; sim(5);
      input.throwTapped = true; sim(3); out.throwing = cq.state === 'THROWING' && tryAim(); sim(200);
      behind(); cq.input._cqcPress(performance.now()); let f = 0; while (cq.state === 'FREE' && f < 60) { MV.tick(dt, true); f++; } const td = cq.state; out.takedown = (td === 'GRABBING' || td === 'THROWING') && tryAim(); cq.input._cqcUp(performance.now()); sim(200);
      behind(); input.cqcTapped = true; sim(40); cq.bf.left = 0.05; sim(3); out.breaking = cq.state === 'BREAKING' && tryAim(); sim(60);
      out.freeAgain = cq.state === 'FREE' && tryAim();
      // aiming at a calm guard alerts nobody; no FIRE button exists
      cq.cancel(); g2.reset(); g1.reset(); sim(10);
      const p = g2.position.clone().addScaledVector(g2.forward(), -5); motor.teleport(p.x, p.z, g2.yaw); cam.snap(motor); sim(20);
      const n0 = MV.noise.last; input.aimTapped = true; sim(240);
      out.calm = { g2: g2.awareness.state, g2s: g2.awareness.suspicion, g1: g1.awareness.state, noise: MV.noise.last === n0, hp: g2.health.current !== g2.health.max || g1.health.current !== g1.health.max };   // (Step 20: guards have health; aiming alone must not touch it)
      out.fire = !!document.querySelector('#mv-fire, [id*="shoot"], [id*="ammo"], [id*="reload"]') || /FIRE|SHOOT|AMMO|RELOAD/i.test([...document.querySelectorAll('button')].filter(b => b.id !== 'mv-cqc').map(b => b.textContent).join(' '));   // (Step 19: FIRE is the shared CQC button only)
      input.aimTapped = true; sim(60);
      return out;
    });
    const o = r, ok = o.tap === 'FREE' && o.hold === 'FREE' && o.throwChoke === 'FREE' && /unavailable while aiming/.test(o.cqcStat) && o.cqcLocked && !o.guard.held && o.guard.ko === 'CONSCIOUS'
      && o.after === 'GRAPPLING' && o.grappling === false && o.aimBtnLocked && o.choking === false && o.throwing === false && o.takedown === false && o.breaking === false && o.freeAgain === true
      && o.calm.g2 === 'NORMAL' && o.calm.g2s === 0 && o.calm.g1 === 'NORMAL' && o.calm.noise && !o.calm.hp && !o.fire && page.errors.length === 0;
    return { pass: ok, detail: `aiming behind Guard 2: TAP → ${o.tap}, HOLD → ${o.hold}, THROW/CHOKE → ${o.throwChoke}, stats "${o.cqcStat}", CQC button reads FIRE ${o.cqcLocked}, he's not held ${!o.guard.held}, ${o.guard.ko}; AIM off then TAP → ${o.after}; AIM accepted while grappling ${o.grappling} (button dimmed ${o.aimBtnLocked}), choking ${o.choking}, throwing ${o.throwing}, quick takedown ${o.takedown}, breaking free ${o.breaking}; free again → AIM ${o.freeAgain}; aiming at Guard 2 for 4 s: G2 ${o.calm.g2} ${o.calm.g2s}%, G1 ${o.calm.g1}, no sound ${o.calm.noise}; a separate FIRE / ammo anywhere ${o.fire}, health touched by aiming ${o.calm.hp}; page errors ${page.errors.length}` };
  },

  // the guards carry on exactly as they would: Guard 1's patrol and Guard 2 at his post, the
  // same as an identical run without AIM (aiming from where neither can see or hear her)
  async aimGuards() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, input, cam } = MV, dt = 1 / 60, A = MV.aim, g1 = MV.guard, g2 = MV.guard2;
      const sim = n => { for (let i = 0; i < n; i++) MV.tick(dt, true); };
      const run = aim => {
        g1.patrol.enabled = true; g1.reset(); g2.reset(); A.reset(); motor.teleport(-19, -19, 0.8); cam.snap(motor); sim(5);
        if (aim) input.aimTapped = true;
        const trail = [];
        for (let i = 0; i < 600; i++) { if (aim && i % 120 === 30) input.look.dx += 40; MV.tick(dt, true); if (i % 60 === 0) trail.push([g1.position.x, g1.position.z, g2.position.x, g2.position.z]); }
        const res = { trail, s1: g1.awareness.state, s2: g2.awareness.state, post: g2.atPost(), patrol: g1.patrol.status(), aimed: A.active };
        if (A.active) { input.aimTapped = true; sim(60); }
        return res;
      };
      const a = run(false), b = run(true);
      const dev = Math.max(...a.trail.map((t, i) => Math.max(Math.hypot(t[0] - b.trail[i][0], t[1] - b.trail[i][1]), Math.hypot(t[2] - b.trail[i][2], t[3] - b.trail[i][3]))));
      const moved = Math.hypot(a.trail[0][0] - a.trail[a.trail.length - 1][0], a.trail[0][1] - a.trail[a.trail.length - 1][1]);
      return { a, b, dev, moved };
    });
    const ok = r.b.aimed && r.dev < 1e-6 && r.moved > 3 && r.a.s1 === r.b.s1 && r.b.s1 === 'NORMAL' && r.b.s2 === 'NORMAL' && r.b.post && r.a.patrol === r.b.patrol && page.errors.length === 0;
    return { pass: ok, detail: `10 s with and without aiming: Guard 1 patrolled ${r.moved.toFixed(1)} m, guards' paths differ by at most ${r.dev.toExponential(1)} m; G1 ${r.b.s1} (${r.b.patrol}), G2 ${r.b.s2} at post ${r.b.post}; page errors ${page.errors.length}` };
  },

  // iPhone: real taps on AIM, the right thumb dragging the aim while the left thumb walks (two
  // fingers at once), AIM tapped while both are down, rapid taps; nothing stuck
  async aimTouch() {
    const page = await touchPage(), Tc = page.touch;
    const box = await page.locator('#mv-aim').boundingBox(), ax = box.x + box.width / 2, ay = box.y + box.height / 2;
    const tapAim = async id => { const d = Tc('touchStart', [{ x: ax, y: ay, id }]); await page.waitForTimeout(70); const u = Tc('touchEnd', [{ x: ax, y: ay, id }]); await d; await u; };
    const st = () => page.evaluate(() => ({ active: MV.aim.active, k: MV.cam.aimK, xh: document.getElementById('mv-crosshair').hidden, yaw: MV.cam.yaw, pitch: MV.cam.pitch, my: MV.motor.yaw, spd: MV.motor.speed, x: MV.motor.position.x, z: MV.motor.position.z, cqc: MV.cqc.state, look: !!MV.input.lookT, joy: !!MV.input.joy }));
    const settle = async (want) => page.waitForFunction(w => w ? MV.cam.aimK > 0.98 : MV.cam.aimK < 0.02, want, { timeout: 15000, polling: 'raf' }).catch(() => {});
    await page.evaluate(() => { MV.motor.teleport(-19, 19, 0.6); MV.cam.snap(MV.motor); });
    // the AIM button isn't under any other control, nor over the camera-drag or stick areas used here
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y).id, [ax, ay]);
    await tapAim(5); await settle(true); const on = await st();
    // two thumbs: left stick forward, right thumb dragging right and up, together
    const t0 = await page.evaluate(() => MV.guard.awareness.clock);
    await Tc('touchStart', [{ x: 150, y: 300, id: 1 }]); await Tc('touchMove', [{ x: 150, y: 240, id: 1 }]);
    await Tc('touchStart', [{ x: 150, y: 240, id: 1 }, { x: 560, y: 200, id: 2 }]);
    for (let i = 1; i <= 12; i++) { await Tc('touchMove', [{ x: 150, y: 240, id: 1 }, { x: 560 + i * 8, y: 200 - i * 3, id: 2 }]); await page.waitForTimeout(30); }
    const both = await st();
    // AIM tapped by a third finger while both are down: aim ends, both thumbs keep working
    await tapAim(6); await page.waitForTimeout(200); const third = await st();
    await Tc('touchMove', [{ x: 150, y: 240, id: 1 }, { x: 680, y: 160, id: 2 }]); await page.waitForTimeout(100); const after3 = await st();
    await Tc('touchEnd', [{ x: 680, y: 160, id: 2 }]); await Tc('touchEnd', [{ x: 150, y: 240, id: 1 }]); await page.waitForTimeout(400);
    await settle(false); const off = await st();
    // rapid: 7 taps (odd: ends aiming), then settle
    for (let i = 0; i < 7; i++) { await tapAim(10 + i); await page.waitForTimeout(60); }
    await settle(true); const rapid = await st();
    await tapAim(20); await settle(false); const last = await st();
    const errs = page.errors.length, wr = a => Math.atan2(Math.sin(a), Math.cos(a));
    const ok = hit === 'mv-aim' && on.active && on.k > 0.98 && !on.xh && both.active && both.look && both.joy && both.spd > 1.2 && both.spd < 1.5 && Math.abs(wr(both.yaw - on.yaw)) > 0.1 && both.pitch !== on.pitch
      && !third.active && third.look && third.joy && Math.abs(wr(after3.yaw - third.yaw)) > 0.05 && !off.active && off.k < 0.02 && off.xh && rapid.active && !rapid.xh && !last.active && last.xh && last.k < 0.02 && last.cqc === 'FREE' && errs === 0;
    return { pass: ok, detail: `AIM button gets the touch ${hit === 'mv-aim'}; tap → aiming ${on.active}, crosshair ${!on.xh}; left thumb walking (${both.spd.toFixed(2)} m/s) while the right drags: aim turned ${(-wr(both.yaw - on.yaw) * 57.3).toFixed(1)}° right, pitch ${((both.pitch - on.pitch) * 57.3).toFixed(1)}°; AIM tapped by a third finger: aiming ${third.active}, thumbs still held ${third.look}/${third.joy}, drag still turns ${(Math.abs(wr(after3.yaw - third.yaw)) * 57.3).toFixed(1)}°; settled: blend ${off.k.toFixed(3)}, crosshair hidden ${off.xh}; 7 rapid taps → aiming ${rapid.active}, one more → ${last.active} (blend ${last.k.toFixed(3)}); page errors ${errs}` };
  },
};

// ---------------------------------------------------------------- run
(async () => {
  const only = process.argv.slice(2);
  const names = only.length ? only : Object.keys(CHECKS).filter(n => n[0] !== '_');   // (_name: a shared helper, not a check)
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
