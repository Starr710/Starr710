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
    window.angJump = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 57.2958;
    window.segDist = (p, a, b) => { const ab = b.clone().sub(a); const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(a.clone().addScaledVector(ab, t)); };
    motor.teleport(-6, -20, 0);
  });
  page.errors = errors;
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

  // he turns (not snaps) toward where the sound was made, after a short beat, looks,
  // then returns to his post; he faces the sound's origin, not the player; his vision
  // cone turns with him; hearing alone never fills the vision meter
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
      // after the look he returns to his post facing
      let back = null; for (let f = 0; f < 600 && back == null; f++) { step(0, 'stand'); g.update(dt, T); if (h.lookYaw == null && wrapD(g.yaw - g.postYaw) < 3) back = f * dt; }
      return { startT, faceT, maxStep, facingSound, facingPlayer, meterMax, zoneAfter: seenAfterTurn.zone, rateAfter: seenAfterTurn.rate, back, react: h.cfg.reactDelay, maxRate: g.cfg.turn.maxRate };
    });
    const perFrame = r.maxRate / 60 * 57.3 + 0.05;
    const ok = r.startT >= r.react - 0.02 && r.startT < r.react + 0.2 && r.faceT != null && r.faceT < 2.5 && r.maxStep <= perFrame && r.facingSound < 3 && r.facingPlayer > 30
      && r.meterMax === 0 && r.zoneAfter === 'fastest' && r.rateAfter > 0 && r.back != null;
    return { pass: ok, detail: `starts turning after ${r.startT.toFixed(2)} s, faces the sound in ${r.faceT == null ? 'never' : r.faceT.toFixed(2) + ' s'}, max ${r.maxStep.toFixed(2)}°/frame (limit ${perFrame.toFixed(2)}); facing sound ±${r.facingSound.toFixed(1)}°, player ${r.facingPlayer.toFixed(0)}° away; meter while only heard ${r.meterMax}; after the turn the player there is in ${r.zoneAfter} (${r.rateAfter.toFixed(2)}/s); back at post ${r.back == null ? 'never' : 'after ' + r.back.toFixed(1) + ' s'}` };
  },

  // a run of real footsteps circling behind him: redirects are spaced out, the turn
  // stays smooth (no rapid reversals), and his limbs never pop
  async hearingJitter() {
    const page = await simPage();
    const r = await page.evaluate(() => {
      const { motor, noise } = MV, g = MV.guard, h = g.hearing, fs = MV.footsteps, T = MV.seeTarget, dt = 1 / 60, B = g.bones;
      const names = ['spine1', 'chest', 'neck', 'head', 'leftArm', 'rightArm', 'leftForeArm', 'rightForeArm', 'leftUpLeg', 'rightUpLeg', 'leftLeg', 'rightLeg'];
      const prevQ = {}, lastA = {}; let pops = 0, worst = 0, redirects = 0, maxDav = 0, flips = 0, prevAv = 0, lastFlip = -9;
      let lr = h.lastRedirect;
      motor.teleport(g.position.x - 4, g.position.z - 3, 0); for (let f = 0; f < 60; f++) step(0, 'stand');
      for (let f = 0; f < 600; f++) {
        // jog on a 4 m circle around a point behind him
        const a = f * dt * 1.1, x = Math.cos(a), z = -Math.sin(a);
        step(1, 'stand', x, z); fs.update(dt); noise.update(dt); g.update(dt, T);
        if (h.lastRedirect !== lr) { redirects++; lr = h.lastRedirect; }
        const av = g.body.angularVelocity; maxDav = Math.max(maxDav, Math.abs(av - prevAv));
        if (Math.sign(av) !== Math.sign(prevAv) && Math.abs(av) > 0.3 && Math.abs(prevAv) > 0.3) { if (f * dt - lastFlip < 0.5) flips++; lastFlip = f * dt; }
        prevAv = av;
        const ri = g.root.getWorldQuaternion(new THREE.Quaternion()).invert();
        for (const nm of names) { const q = ri.clone().multiply(B[nm].getWorldQuaternion(new THREE.Quaternion())); if (prevQ[nm] && f > 30) { const ang = 2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ[nm])))) * 57.3, leg = nm.endsWith('Leg'); const spike = leg ? (ang > 12 && ang > 2 * (lastA[nm] || 0)) : ang > 9; lastA[nm] = ang; if (spike) { pops++; worst = Math.max(worst, ang); } } prevQ[nm] = q; }
      }
      return { heard: h.heardCount, redirects, maxDav, flips, pops, worst, gap: h.cfg.retargetGap };
    });
    const maxRedirects = Math.floor(10 / r.gap) + 1;
    const ok = r.heard > 5 && r.redirects <= maxRedirects && r.maxDav < 0.75 && r.flips === 0 && r.pops === 0;
    return { pass: ok, detail: `${r.heard} footsteps heard in 10 s, ${r.redirects} look redirects (max ${maxRedirects}), largest turn-rate change ${r.maxDav.toFixed(2)} rad/s per frame, rapid reversals ${r.flips}, guard joint pops ${r.pops}${r.worst ? ' (worst ' + r.worst.toFixed(1) + '°)' : ''}` };
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
