// SHADOW CELL — movement: Stage 1 bootstrap and frame loop.
// Wiring only. Each frame runs: input → motor → visual placement → animator → camera → render.
(function (mv) {
  'use strict';

  const $ = id => document.getElementById(id);
  const ui = {
    loader: $('mv-loader'), loadBar: $('mv-load-bar'), loadText: $('mv-load-text'),
    error: $('mv-error'), errorText: $('mv-error-text'), start: $('mv-start'),
    stats: $('mv-stats'), statsBtn: $('mv-stats-btn'), reset: $('mv-reset'),
    gait: $('mv-gait'), speed: $('mv-speed'), noise: $('mv-noise'), guard: $('mv-guard'), detect: $('mv-detect'), hear: $('mv-hear'), aware: $('mv-aware'), memory: $('mv-memory'), reason: $('mv-reason'), fps: $('mv-fps'), rate: $('mv-rate'), quality: $('mv-quality'), calib: $('mv-calib'),
  };
  const fail = msg => { ui.loader.hidden = true; ui.error.hidden = false; ui.errorText.textContent = msg; };

  // ---------------------------------------------------------------- renderer
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default', stencil: false }); }
  catch (e) { fail('This browser could not start 3D graphics (WebGL).'); return; }
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('mv-stage').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const BG = new THREE.Color(0x2b302b);
  scene.background = BG;
  scene.fog = new THREE.Fog(BG, 22, 48);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 80);
  scene.add(new THREE.HemisphereLight(0xdfe5e0, 0x3d3a30, 0.85));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // quality tiers step down only, so the frame rate can't oscillate
  const dpr = window.devicePixelRatio || 1;
  const TIERS = [{ n: 'HIGH', d: Math.min(dpr, 2), s: true }, { n: 'MEDIUM', d: Math.min(dpr, 1.5), s: true }, { n: 'LOW', d: 1, s: true }, { n: 'MIN', d: 1, s: false }];
  let tier = 0;
  function applyTier(i) {
    tier = i; renderer.setPixelRatio(TIERS[i].d);
    renderer.shadowMap.enabled = sun.castShadow = TIERS[i].s;
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    ui.quality.textContent = TIERS[i].n + ' · ' + TIERS[i].d.toFixed(2) + '×';
    resize();
  }
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 300));

  // ---------------------------------------------------------------- systems
  const world = new mv.CollisionWorld();
  const area = mv.buildTestArea(scene, world, renderer);
  const motor = new mv.CharacterMotor(world);
  const input = new mv.Input({ root: document.body, base: $('mv-joy-base'), knob: $('mv-joy-knob'), crouch: $('mv-crouch') });
  const cam = new mv.ThirdPersonCamera(camera, world);
  const actions = new mv.ActionSystem();
  const noise = new mv.NoiseSystem(scene);
  const footAudio = new mv.FootstepAudio(noise);
  // iOS: audio starts on the START tap; any later tap resumes it if the system suspended it
  document.addEventListener('touchend', () => { if (input.enabled) footAudio.unlock(); }, { passive: true });
  let footsteps = null, guard = null, guardView = null, awareView = null, seeTarget = null;
  const profile = mv.CHARACTER_PROFILES[window.SC_CHARACTER || 'testSoldier'];
  const visual = new mv.CharacterVisual(profile);
  let animator = null, posture = null;
  scene.add(visual.root);

  function spawn() {
    motor.teleport(area.spawn.x, area.spawn.z, area.spawn.yaw);
    cam.snap(motor);
  }
  spawn();
  applyTier(0);

  visual.load(ev => {
    if (ev.lengthComputable) { ui.loadBar.style.width = (ev.loaded / ev.total * 100).toFixed(0) + '%'; ui.loadText.textContent = (ev.loaded / 1048576).toFixed(1) + ' / ' + (ev.total / 1048576).toFixed(1) + ' MB'; }
  }).then(() => {
    animator = new mv.AnimationController(visual);
    // unarmed by default; '#rifle' previews the rifle carry kept for later stages
    posture = new mv.TacticalPosture(visual, { carry: location.hash === '#rifle' ? 'rifle' : 'unarmed' });
    footsteps = new mv.FootstepEmitter(noise, visual, motor, 'player');
    // one stationary test guard sharing the player's model and clips
    guard = new mv.Guard(scene, world, visual, Object.assign({ vision: 'regular', hearing: 'regular' }, area.guard), noise);
    guardView = new mv.GuardDebugView(scene, guard);
    awareView = new mv.GuardAwarenessView(scene, guard);
    seeTarget = mv.visionTarget(visual, motor);
    const s = animator.stride;
    ui.calib.textContent = `walk ${s.walk.speed.toFixed(2)} · run ${s.run.speed.toFixed(2)} m/s`;
    visual.place(motor.position, motor.yaw);
    renderer.compile(scene, camera);
    ui.loadText.textContent = 'Ready';
    ui.start.hidden = false;
  }).catch(err => fail('The character could not be loaded (' + (err && err.message || 'network error') + '). Reload to try again.'));

  ui.start.addEventListener('click', () => {
    ui.loader.classList.add('done');
    setTimeout(() => { ui.loader.hidden = true; }, 350);
    input.enabled = true;
    footAudio.unlock();
    document.body.classList.add('playing');
  });
  // RESET puts the player back at the start and the guard back at his post, calm
  ui.reset.addEventListener('click', () => { spawn(); if (guard) guard.reset(); });
  ui.statsBtn.addEventListener('click', () => { ui.stats.hidden = !ui.stats.hidden; ui.statsBtn.setAttribute('aria-pressed', String(!ui.stats.hidden)); });

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  const fwd = new THREE.Vector3();
  let fps = 60, fpsT = 0, fpsN = 0, hudT = 0, grace = 2;
  function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 20);

    if (animator) {
      // camera-relative stick → world direction
      cam.forward(fwd);
      const rx = -fwd.z, rz = fwd.x;                 // camera right on the ground
      const mx = input.move.x, my = input.move.y;
      let dx = rx * mx + fwd.x * my, dz = rz * mx + fwd.z * my;
      const mag = Math.min(1, Math.hypot(mx, my));
      const l = Math.hypot(dx, dz); if (l > 1e-4) { dx /= l; dz /= l; }

      motor.stance = input.crouch ? 'crouch' : 'stand';
      if (!actions.busy()) motor.update(dt, dx, dz, mag);
      actions.update({ motor, world, visual, input }, dt, false);
      visual.place(motor.position, motor.yaw);
      animator.update(dt, motor);
      posture.update(dt, motor, animator);
      visual.root.updateMatrixWorld(true);
      footsteps.update(dt);
      guard.update(dt, seeTarget);
      guardView.update(camera, seeTarget);
      guard.hearing.updateDebug(scene);
      awareView.update(camera);
    }
    noise.update(dt);
    cam.update(dt, motor, input.look, input.mouse);
    sun.position.set(motor.position.x + 6, 14, motor.position.z + 5);
    sun.target.position.copy(motor.position);
    renderer.render(scene, camera);

    // frame rate + adaptive quality
    fpsT += dt; fpsN++;
    if (fpsT > 1) { fps = fpsN / fpsT; fpsT = fpsN = 0; if (input.enabled && (grace -= 1) < 0 && fps < 48 && tier < TIERS.length - 1) { applyTier(tier + 1); grace = 2; } }
    hudT += dt;
    if (hudT > 0.15 && !ui.stats.hidden) {
      hudT = 0;
      ui.gait.textContent = motor.gait.label;
      ui.speed.textContent = motor.speed.toFixed(2) + ' m/s';
      const n = noise.last;
      ui.noise.textContent = n && performance.now() / 1000 - n.time < 1.2 ? `L${n.level} ${n.surface} · ${n.radius.toFixed(1)} m` : '–';
      if (guard) {
        const s = guard.vision.seen;
        ui.guard.textContent = (s.zone ? s.zone.toUpperCase() : '—') + ' · ' + (isFinite(s.distance) ? s.distance.toFixed(1) + ' m' : '–') + (s.zone ? ' · ' + Math.round(s.exposure * 100) + '% exposed' : '');
        ui.detect.textContent = Math.round(guard.vision.meter * 100) + '% ' + guard.vision.state();
        const h = guard.hearing.last;
        ui.hear.textContent = h ? `${h.heard ? 'HEARD' : 'IGNORED'} ${h.type} L${h.level} ${h.surface} i${h.intensity.toFixed(1)} · ${h.distance.toFixed(1)}/${h.reach.toFixed(1)} m` : 'LISTENING';
        const a = guard.awareness, xz = p => p ? `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})` : '—';
        const left = a.state === 'EVASION' && a.evasion ? ` · ${Math.max(0, a.evasion.end - a.clock).toFixed(0)} s left` : '';
        ui.aware.textContent = `${a.state.replace('_', ' ')}${left} · ${Math.round(a.suspicion * 100)}% · ${a.behavior}` + (guard.moving ? ' → ' + xz(guard.goal) : '');
        const ago = t => t == null ? '' : ` ${(a.clock - t).toFixed(0)} s ago`;
        ui.memory.textContent = `seen ${xz(a.seen && a.seen.position)}${a.seen ? ago(a.seen.time) : ''} · heard ${a.heard && a.heard.uncertainty ? '≈' + xz(a.heard.estimate) + ' ±' + a.heard.uncertainty.toFixed(1) + ' m' : xz(a.heard && a.heard.position)} · ${a.confirmed ? (guard.vision.seen.rate > 0 ? 'CONFIRMED · in sight' : 'CONFIRMED · no contact') : 'not confirmed'}`;
        ui.reason.textContent = (a.evasion && a.state === 'EVASION' ? a.evasion.reason + (a.note ? ' · ' + a.note : '') : a.note) || '–';
      }
      ui.rate.textContent = animator ? animator.playRate.toFixed(2) + '×' : '–';
      ui.fps.textContent = fps.toFixed(0) + ' · ' + renderer.info.render.calls + ' draws';
    }
  }
  renderer.setAnimationLoop(frame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { renderer.setAnimationLoop(null); input.clear(); footAudio.suspend(); }
    else { clock.getDelta(); renderer.setAnimationLoop(frame); }
  });

  window.MV = { motor, cam, input, world, noise, footAudio, get guard() { return guard; }, get seeTarget() { return seeTarget; }, get footsteps() { return footsteps; }, get animator() { return animator; }, get posture() { return posture; }, visual, renderer, scene };
})(SC.mv);
