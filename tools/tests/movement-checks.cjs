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
