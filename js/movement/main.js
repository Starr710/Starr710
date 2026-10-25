// SHADOW CELL — movement: Stage 1 bootstrap and frame loop.
// Wiring only. Each frame runs: input → motor → visual placement → animator → camera → render.
(function (mv) {
  'use strict';

  const $ = id => document.getElementById(id);
  const ui = {
    loader: $('mv-loader'), loadBar: $('mv-load-bar'), loadText: $('mv-load-text'),
    error: $('mv-error'), errorText: $('mv-error-text'), start: $('mv-start'),
    stats: $('mv-stats'), statsBtn: $('mv-stats-btn'), reset: $('mv-reset'),
    gait: $('mv-gait'), speed: $('mv-speed'), noise: $('mv-noise'), guard: $('mv-guard'), detect: $('mv-detect'), hear: $('mv-hear'), aware: $('mv-aware'), memory: $('mv-memory'), reason: $('mv-reason'), post: $('mv-post'), voice: $('mv-voice'), patrol: $('mv-patrol'), persona: $('mv-persona'), startle: $('mv-startle'), cqcstat: $('mv-cqcstat'), g2: $('mv-g2'), throwBtn: $('mv-throw'), chokeBtn: $('mv-choke'), chokestat: $('mv-chokestat'), tkdnstat: $('mv-tkdnstat'), throwstat: $('mv-throwstat'), ko: $('mv-ko'), cqcBtn: $('mv-cqc'), aimBtn: $('mv-aim'), crosshair: $('mv-crosshair'), aimstat: $('mv-aimstat'), hitmark: $('mv-hitmark'), shotstat: $('mv-shotstat'), dmg: $('mv-dmg'), defeat: $('mv-defeat'), fps: $('mv-fps'), rate: $('mv-rate'), quality: $('mv-quality'), calib: $('mv-calib'),
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
  const input = new mv.Input({ root: document.body, base: $('mv-joy-base'), knob: $('mv-joy-knob'), crouch: $('mv-crouch'), cqc: $('mv-cqc'), throw: $('mv-throw'), choke: $('mv-choke'), aim: $('mv-aim') });
  const cam = new mv.ThirdPersonCamera(camera, world);
  const actions = new mv.ActionSystem();
  const noise = new mv.NoiseSystem(scene);
  const footAudio = new mv.FootstepAudio(noise);
  // iOS: audio starts on the START tap; any later tap resumes it if the system suspended it
  document.addEventListener('touchend', () => { if (input.enabled) footAudio.unlock(); }, { passive: true });
  let footsteps = null, voice = null, caption = null, traitCard = null, indicator = null, cqc = null, guard = null, guardView = null, awareView = null, patrolView = null, seeTarget = null;
  let aim = null, aimPose = null, pistol = null, playerHealth = null, wasDown = false;   // Step 18, Step 19, Step 22
  let guard2 = null, guard2View = null, aware2View = null, caption2 = null, indicator2 = null, traitCard2 = null;
  // a second copy of a guard's screen-space element (caption, indicator, card), same classes, its own id
  const cloneUi = id => { const src = $(id), el = src.cloneNode(true); el.id = id + '-2'; src.parentNode.insertBefore(el, src.nextSibling); return el; };
  const profile = mv.CHARACTER_PROFILES[window.SC_CHARACTER || 'testSoldier'];
  const visual = new mv.CharacterVisual(profile);
  let animator = null, posture = null;
  scene.add(visual.root);

  // the player at the spawn: standing, still, the camera behind her looking into the yard
  function spawn() {
    input.setCrouch(false); motor.stance = 'stand';
    motor.teleport(area.spawn.x, area.spawn.z, area.spawn.yaw);
    cam.snap(motor);
    // a foot in the air when she's moved must not land as a footstep at the spawn
    if (footsteps) for (const f of footsteps.feet) { f.down = true; f.prev = null; f.at = null; }
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
    // Guard 1 — Patrol, sharing the player's model and clips
    guard = new mv.Guard(scene, world, visual, Object.assign({ vision: 'regular', hearing: 'regular' }, area.guard), noise);
    // Guard 2 — Stationary CQC Test: the same model and systems, held at his post (no patrol)
    guard2 = new mv.Guard(scene, world, visual, Object.assign({ vision: 'regular', hearing: 'regular' }, area.guard2), noise);
    guard2View = new mv.GuardDebugView(scene, guard2);
    aware2View = new mv.GuardAwarenessView(scene, guard2);
    guardView = new mv.GuardDebugView(scene, guard);
    awareView = new mv.GuardAwarenessView(scene, guard);
    patrolView = new mv.GuardPatrolView(scene, guard.patrol);
    // his voice: a quiet "huh" once per suspicious incident (a hook until a recording is added)
    voice = new mv.GuardVoice(() => footAudio.ctx);
    // caption: a TEMPORARY "Huh" above his head while no recording exists (guard-caption.js)
    caption = new mv.GuardCaption($('mv-caption'), guard, world);
    cqc = new mv.CQC({ motor, visual, input, noise }, [guard, guard2], world);   // Step 13: grab and restraint (whichever guard is in reach)
    indicator = new mv.GuardIndicator($('mv-indicator'), guard, world);   // TEMPORARY awareness symbol above him (UI only)
    traitCard = new mv.GuardTraitCard($('mv-trait'), guard, world, null, motor);   // his personality, beside him, clear of the player (UI only)
    guard.awareness.onVocal = line => {
      const rec = voice.say(line, guard.position, motor.position);
      if (caption && !(rec.played && caption.cfg.onlyWithoutRecording)) caption.show();   // caption
    };
    caption2 = new mv.GuardCaption(cloneUi('mv-caption'), guard2, world);
    indicator2 = new mv.GuardIndicator(cloneUi('mv-indicator'), guard2, world);
    traitCard2 = new mv.GuardTraitCard(cloneUi('mv-trait'), guard2, world, null, motor);
    guard2.awareness.onVocal = line => {
      const rec = voice.say(line, guard2.position, motor.position);
      if (!(rec.played && caption2.cfg.onlyWithoutRecording)) caption2.show();
    };
    // Step 18: aiming (AIM ONLY: no shooting yet) and its temporary pose with a placeholder pistol
    aim = new mv.Aim(motor, cam, camera, world, [guard, guard2]);
    aimPose = new mv.AimPose(visual, posture, scene);
    // Step 19: the pistol, fired with the CQC button (FIRE) while aiming
    // Step 21: each guard's pistol (aiming only: nothing fires); the same rig as hers, so her hand calibration applies
    guard.weapon = new mv.GuardWeapon(guard, scene, posture); guard2.weapon = new mv.GuardWeapon(guard2, scene, posture);
    // Step 22: her health, and the guards' gunfire at her (only through weapon.canFire)
    playerHealth = new mv.PlayerHealth(visual, motor); playerHealth.tintEl = ui.dmg; playerHealth.audio = footAudio;
    for (const g of [guard, guard2]) g.gunfire = new mv.GuardGunfire(g, { player: { motor, health: playerHealth }, guards: [guard, guard2], world, noise, scene, audio: footAudio });
    pistol = new mv.Pistol({ aim, aimPose, cam, world, guards: [guard, guard2], noise, scene, audio: footAudio, marker: ui.hitmark });
    seeTarget = mv.visionTarget(visual, motor);
    const s = animator.stride;
    ui.calib.textContent = `walk ${s.walk.speed.toFixed(2)} · run ${s.run.speed.toFixed(2)} m/s`;
    visual.place(motor.position, motor.yaw);
    // (Step 19: the pistol and its flash and puffs are compiled now too, or the first shot would stall on it)
    const warm = [aimPose.pistol, pistol.flash, ...pistol.puffs]; for (const o of warm) o.visible = true;
    renderer.compile(scene, camera);
    for (const o of warm) o.visible = false;
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
  ui.reset.addEventListener('click', () => { input._cqcDrop(); /* a CQC press still down is cancelled too: no TAP or HOLD after RESET */ if (cqc) cqc.cancel(); if (aim) aim.reset(); if (pistol) pistol.reset(); input._fireDrop(); if (playerHealth) playerHealth.reset(); wasDown = false; ui.defeat.hidden = true; document.body.classList.remove('mv-defeated'); spawn(); if (guard) guard.reset(); if (guard2) guard2.reset(); for (const u of [caption, indicator, caption2, indicator2]) if (u) u.hide(); });
  // the stats bar leaves room for RESET / STATS in its top-right corner
  const chipRoom = () => document.documentElement.style.setProperty('--chips-w', document.querySelector('.mv-topright').offsetWidth + 8 + 'px');
  chipRoom(); window.addEventListener('resize', chipRoom);
  ui.statsBtn.addEventListener('click', () => {
    ui.stats.hidden = !ui.stats.hidden; ui.statsBtn.setAttribute('aria-pressed', String(!ui.stats.hidden));
    if (!ui.stats.hidden) { for (const b of ui.stats.querySelectorAll('b')) b._v = undefined; hudT = 1; }   // shown again: every value rewritten on the next frame
  });

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  const fwd = new THREE.Vector3(), aimMz = new THREE.Vector3();
  let fps = 60, fpsT = 0, fpsN = 0, hudT = 0, grace = 2;
  // stats text is written only when it changes (each write re-lays out the bar)
  const put = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
  const cqcUi = { t: 0, ready: false, shown: null, lbl: 'CQC', hold: false, thr: false, thrReady: null, thrShown: null, locked: false, ring: null, charging: false, fired: false, cring: null, timer: false, urgent: false };
  ui.chokeRing = ui.chokeBtn.querySelector('circle'); ui.cqcRing = ui.cqcBtn.querySelector('circle'); ui.cqcLabel = ui.cqcBtn.querySelector('span');
  function frame() { tick(Math.min(clock.getDelta(), 1 / 20)); }
  // one frame of everything; the checks step it by hand (noRender: skip drawing it)
  function tick(dt, noRender) {

    if (animator) {
      // camera-relative stick → world direction
      cam.forward(fwd);
      const rx = -fwd.z, rz = fwd.x;                 // camera right on the ground
      const mx = input.move.x, my = input.move.y;
      let dx = rx * mx + fwd.x * my, dz = rz * mx + fwd.z * my;
      const mag = Math.min(1, Math.hypot(mx, my));
      const l = Math.hypot(dx, dz); if (l > 1e-4) { dx /= l; dz /= l; }

      motor.stance = input.crouch ? 'crouch' : 'stand';
      // Step 22: defeated: everything she does stops (CQC let go, AIM off, no movement) until RESET
      const down = !!(playerHealth && playerHealth.defeated());
      if (down && !wasDown) { wasDown = true; if (cqc) cqc.cancel(); if (aim) aim.exit('defeated'); input._cqcDrop(); input._fireDrop(); input.move.x = input.move.y = 0; ui.defeat.hidden = false; document.body.classList.add('mv-defeated'); }
      if (down) { input.move.x = input.move.y = 0; }
      // Step 18: AIM (only while she's free); anything else taking over ends it; while aiming CQC is unavailable
      if (aim && cqc) {
        const allowed = cqc.state === 'FREE' && !actions.busy() && !down;
        if (input.aimTapped) { input.aimTapped = false; if (aim.cfg.mode !== 'hold') aim.toggle(allowed); }
        if (aim.cfg.mode === 'hold') { if (input.aiming()) aim.enter(allowed); else if (aim.active) aim.exit('AIM let go'); }
        if (aim.active && !allowed) aim.exit('interrupted');
        cqc.blocked = aim.active || down; input.fireMode = aim.active;   // Step 19: while aiming the CQC button is FIRE
        const on = aim.active, locked = !on && !allowed;
        if (cqcUi.aim !== on) { cqcUi.aim = on; ui.aimBtn.classList.toggle('on', on); ui.aimBtn.setAttribute('aria-pressed', String(on)); ui.cqcBtn.classList.toggle('fire', on); }
        if (cqcUi.aimLocked !== locked) { cqcUi.aimLocked = locked; ui.aimBtn.classList.toggle('locked', locked); }
      }
      const grappling = cqc ? cqc.update(dt, dx, dz, mag) : false;   // CQC drives both characters while active
      if (cqc) {
        // the button: RELEASE while holding him; bright when a grab is possible (checked a few times a second)
        const choking = cqc.state === 'CHOKING' && cqc.ch.phase === 'hold';   // Step 15: RELEASE / THROW locked while CHOKE is held
        // one button, three jobs: FIRE while aiming (Step 19), RELEASE while holding a guard, CQC otherwise
        const lbl = aim && aim.active ? 'FIRE' : cqc.state === 'GRAPPLING' || choking ? 'RELEASE' : 'CQC', hold = cqc.active();
        if ((cqcUi.t += dt) > 0.12) { cqcUi.t = 0; cqcUi.ready = !hold && !(aim && aim.active) && !cqc.check(); cqcUi.thrReady = cqc.state === 'GRAPPLING' && cqc.throwCheck().ok; }
        // Step 14: THROW shows only while she holds a guard (lit when there's room to throw him)
        const thr = cqc.state === 'GRAPPLING' || choking;
        if (cqcUi.thr !== thr) { cqcUi.thr = thr; ui.throwBtn.hidden = !thr; ui.chokeBtn.hidden = !thr; document.body.classList.toggle('mv-holding', thr); if (thr) { cqcUi.thrReady = cqc.state === 'GRAPPLING' && cqc.throwCheck().ok; } }
        if (cqcUi.locked !== choking) { cqcUi.locked = choking; ui.throwBtn.classList.toggle('locked', choking); ui.cqcBtn.classList.toggle('locked', choking); ui.chokeBtn.classList.toggle('active', choking); }
        if (choking) { const off = (182.2 * (1 - cqc.ch.p)).toFixed(1); if (cqcUi.ring !== off) { cqcUi.ring = off; ui.chokeRing.style.strokeDashoffset = off; } } else if (cqcUi.ring !== null) { cqcUi.ring = null; ui.chokeRing.style.strokeDashoffset = ''; }
        if (cqcUi.thrShown !== cqcUi.thrReady) { cqcUi.thrShown = cqcUi.thrReady; ui.throwBtn.classList.toggle('ready', !!cqcUi.thrReady); ui.chokeBtn.classList.toggle('ready', !!cqcUi.thrReady); }   // (CHOKE needs the same room to lay him down)
        if (cqcUi.lbl !== lbl) { cqcUi.lbl = lbl; ui.cqcLabel.textContent = lbl; }
        // Step 16: the hold ring (a free press filling toward a quick takedown), a brief flash when it fires
        const hp = input.cqcHoldProgress(), charging = hp != null && hp > 0.3, fired = cqc.quick || (cqc.state === 'THROWING' && cqc.thr.quick && cqc.thr.t < 0.35);
        if (cqcUi.charging !== charging) { cqcUi.charging = charging; ui.cqcBtn.classList.toggle('charging', charging); }
        if (cqcUi.fired !== fired) { cqcUi.fired = fired; ui.cqcBtn.classList.toggle('fired', fired); }
        // Step 17: while she holds a guard the same ring shows the break-free time left (urgent near the end)
        const bf = cqc.breakFreeInfo(), timer = !charging && !!bf, urgent = timer && bf.urgent;
        if (cqcUi.timer !== timer) { cqcUi.timer = timer; ui.cqcBtn.classList.toggle('timer', timer); }
        if (cqcUi.urgent !== urgent) { cqcUi.urgent = urgent; ui.cqcBtn.classList.toggle('urgent', urgent); }
        const ringK = charging ? hp : timer ? bf.left / bf.full : null;
        if (ringK != null) { const off = (182.2 * (1 - ringK)).toFixed(1); if (cqcUi.cring !== off) { cqcUi.cring = off; ui.cqcRing.style.strokeDashoffset = off; } } else if (cqcUi.cring !== null) { cqcUi.cring = null; ui.cqcRing.style.strokeDashoffset = ''; }
        if (cqcUi.hold !== hold) { cqcUi.hold = hold; ui.cqcBtn.classList.toggle('holding', hold); }
        if (cqcUi.shown !== cqcUi.ready) { cqcUi.shown = cqcUi.ready; ui.cqcBtn.classList.toggle('ready', cqcUi.ready); }
      }
      if (!actions.busy() && !grappling) { if (aim && aim.active) aim.step(dt, dx, dz, mag, input.crouch); else motor.update(dt, down ? 0 : dx, down ? 0 : dz, down ? 0 : mag); }
      if (aim && !aim.active) aim.idle(dt);
      actions.update({ motor, world, visual, input }, dt, false);
      visual.place(motor.position, motor.yaw + (aim ? aim.legYaw : 0));   // (aiming: the legs turn toward the travel, the upper body stays on the aim)
      // (once she's going down after a defeat, her pose is the defeat's alone: no animation, posture or aim layer under it)
      const frozen = !!(playerHealth && playerHealth.frozen());
      if (!frozen) {
        animator.update(dt, motor);
        posture.update(dt, motor, animator);
        if (cqc) cqc.poseArms();
        if (playerHealth) playerHealth.poseReact(dt);   // Step 22: a hit's flinch (before the aim pose: her pistol stays in her hands)
        if (aimPose) aimPose.apply(cam.aimK, motor.yaw, aim.target.dir, aim.target.point);
      } else if (aimPose) aimPose.pistol.visible = false;
      if (playerHealth) playerHealth.defeatPose(dt);   // (going down at 0 HP, over everything)
      visual.root.updateMatrixWorld(true);
      if (!down) footsteps.update(dt);
      guard.update(dt, seeTarget);
      guardView.update(camera, seeTarget);
      guard.hearing.updateDebug(scene);
      awareView.update(camera);
      patrolView.update(guard.awareness.cfg.debug);
      guard2.update(dt, seeTarget);
      guard2View.update(camera, seeTarget);
      guard2.hearing.updateDebug(scene);
      aware2View.update(camera);
    }
    noise.update(dt);
    cam.update(dt, motor, input.look, input.mouse);
    if (aim) {   // Step 18: the aim ray (the screen centre) once the camera has moved; the crosshair
      if (cam.aimK > 0.002 || aim.active) aim.trace(aimPose.muzzle(aimMz), aimPose.gunDir);
      if (pistol) pistol.update(dt, input.takeFire());   // Step 19: this frame's FIRE presses, against the crosshair as drawn
      const show = aim.active && cam.aimK > 0.6, onGuard = show && !!aim.target.guard, blocked = show && !aim.target.muzzleClear;
      if (cqcUi.xh !== show) { cqcUi.xh = show; ui.crosshair.hidden = !show; }
      if (cqcUi.xhG !== onGuard) { cqcUi.xhG = onGuard; ui.crosshair.classList.toggle('guard', onGuard); }
      if (cqcUi.xhB !== blocked) { cqcUi.xhB = blocked; ui.crosshair.classList.toggle('blocked', blocked); }
    }
    if (caption) caption.update(dt, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight);   // caption
    if (traitCard) traitCard.update(dt, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    if (indicator) indicator.update(dt, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    for (const u of [caption2, traitCard2, indicator2]) if (u) u.update(dt, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    sun.position.set(motor.position.x + 6, 14, motor.position.z + 5);
    sun.target.position.copy(motor.position);
    if (!noRender) renderer.render(scene, camera);

    // frame rate + adaptive quality
    fpsT += dt; fpsN++;
    if (fpsT > 1) { fps = fpsN / fpsT; fpsT = fpsN = 0; if (input.enabled && (grace -= 1) < 0 && fps < 48 && tier < TIERS.length - 1) { applyTier(tier + 1); grace = 2; } }
    hudT += dt;
    if (hudT > 0.15 && !ui.stats.hidden) {
      hudT = 0;
      // Step 22: her health beside her gait, and what the guards have fired at her
      const ef = guard && guard2 ? [guard, guard2].reduce((t, g) => ({ shots: t.shots + (g.gunfire ? g.gunfire.shots : 0), hits: t.hits + (g.gunfire ? g.gunfire.hits : 0) }), { shots: 0, hits: 0 }) : null;
      put(ui.gait, motor.gait.label + (playerHealth ? ' · ' + playerHealth.status(ef) : ''));
      put(ui.speed, motor.speed.toFixed(2) + ' m/s');
      const n = noise.last;
      put(ui.noise, n && performance.now() / 1000 - n.time < 1.2 ? `L${n.level} ${n.surface} · ${n.radius.toFixed(1)} m` : '–');
      if (guard) {
        const s = guard.vision.seen;
        put(ui.guard, (s.zone ? s.zone.toUpperCase() : '—') + ' · ' + (isFinite(s.distance) ? s.distance.toFixed(1) + ' m' : '–') + (s.zone ? ' · ' + Math.round(s.exposure * 100) + '% exposed' : ''));
        put(ui.detect, Math.round(guard.vision.meter * 100) + '% ' + guard.vision.state());
        const h = guard.hearing.last;
        put(ui.hear, h ? `${h.heard ? 'HEARD' : 'IGNORED'} ${h.type} L${h.level} ${h.surface} i${h.intensity.toFixed(1)} · ${h.distance.toFixed(1)}/${h.reach.toFixed(1)} m` : 'LISTENING');
        const a = guard.awareness, xz = p => p ? `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})` : '—';
        const left = a.state === 'EVASION' && a.evasion ? ` · ${Math.max(0, a.evasion.end - a.clock).toFixed(0)} s left` : a.state === 'HEIGHTENED' && a.hs ? ` · ${Math.max(0, a.hs.end - a.clock).toFixed(0)} s left` : '';
        const label = { HEIGHTENED: 'HEIGHTENED SECURITY', RETURNING: 'RETURN TO POST' }[a.state] || a.state;
        const wpn = g => { const w = g.weapon && g.weapon.status(); return w ? ' · ' + w : ''; };   // Step 21: his pistol (only once it's out)
        put(ui.aware, `${label}${left} · ${Math.round(a.suspicion * 100)}% · ${a.behavior}` + (guard.moving ? ' → ' + xz(guard.goal) : '') + wpn(guard));
        const ago = t => t == null ? '' : ` ${(a.clock - t).toFixed(0)} s ago`;
        put(ui.memory, `seen ${xz(a.seen && a.seen.position)}${a.seen ? ago(a.seen.time) : ''} · heard ${a.heard && a.heard.uncertainty ? '≈' + xz(a.heard.estimate) + ' ±' + a.heard.uncertainty.toFixed(1) + ' m' : xz(a.heard && a.heard.position)} · ${a.confirmed ? (guard.vision.seen.rate > 0 ? 'CONFIRMED · in sight' : 'CONFIRMED · no contact') : 'not confirmed'}`);
        put(ui.reason, (a.evasion && a.state === 'EVASION' ? a.evasion.reason + (a.note ? ' · ' + a.note : '') : a.hs && a.state === 'HEIGHTENED' ? a.hs.reason + (a.note ? ' · ' + a.note : '') : a.note) || '–');
        put(ui.voice, voice ? voice.status() : '–');
        put(ui.patrol, guard.patrol.status());
        put(ui.persona, guard.personality.status());
        put(ui.startle, guard.awareness.startleStatus());
        put(ui.cqcstat, cqc.status());
        put(ui.throwstat, cqc.throwStatus());
        put(ui.chokestat, cqc.chokeStatus(input.choking()));
        put(ui.tkdnstat, cqc.takedownStatus());
        put(ui.aimstat, aim.status(input.crouch));
        put(ui.shotstat, pistol.status());
        // Step 20: health first (just HP until he's hurt), then consciousness / defeat
        const hp = g => !g.health ? '' : g.health.lastDamage ? g.health.status() + ' · ' : `HP ${g.health.current}/${g.health.max} · `;
        put(ui.ko, hp(guard) + (guard.health && guard.health.lastDamage ? '' : guard.ko.status()) + (guard.awareness.attack ? ` · remembers ${guard.awareness.attack.kind === 'shot' ? 'being shot' : 'attack'} at ${xz(guard.awareness.attack.position)}` : ''));
        if (guard2) { const b = guard2.awareness, tr = `${guard2.personality.traits.primary}/${guard2.personality.traits.secondary}`;
          put(ui.g2, guard2.isDown() ? `${hp(guard2)}${guard2.health && guard2.health.lastDamage ? '' : guard2.ko.status() + ' · '}${tr}${b.attack ? ' · remembers attack at ' + xz(b.attack.position) : ''}`
            : `${hp(guard2)}${b.state} · ${Math.round(b.suspicion * 100)}% · seen ${Math.round(guard2.vision.meter * 100)}% · ${tr} · ${guard2.restraint ? 'RESTRAINED' : guard2.atPost() ? 'at post' : 'off post ' + xz(guard2.position)}${guard2.ko.knockouts ? ' · ' + guard2.ko.status() : ''}${wpn(guard2)}`); }
        put(ui.post, `${xz(guard.post)} ${Math.round(guard.postYaw * 57.3)}° · ${guard.atPost() ? 'at post' : 'away from post'}${a.state === 'RETURNING' ? ' · returning' : ''}${a.stoodDownAt != null ? ' · stood down ' + (a.clock - a.stoodDownAt).toFixed(0) + ' s ago' : ''}${a.interrupted ? ' · ' + a.interrupted : ''}`);
      }
      put(ui.rate, animator ? animator.playRate.toFixed(2) + '×' : '–');
      put(ui.fps, fps.toFixed(0) + ' · ' + renderer.info.render.calls + ' draws');
    }
  }
  renderer.setAnimationLoop(frame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { renderer.setAnimationLoop(null); input.clear(); footAudio.suspend(); }
    else { clock.getDelta(); renderer.setAnimationLoop(frame); }
  });

  window.MV = { SCmv: mv, tick, motor, cam, input, world, area, noise, footAudio, get guard() { return guard; }, get guard2() { return guard2; }, get guards() { return [guard, guard2]; }, get caption2() { return caption2; }, get indicator2() { return indicator2; }, get traitCard2() { return traitCard2; }, get seeTarget() { return seeTarget; }, get footsteps() { return footsteps; }, get voice() { return voice; }, get caption() { return caption; }, get traitCard() { return traitCard; }, get indicator() { return indicator; }, get cqc() { return cqc; }, get aim() { return aim; }, get aimPose() { return aimPose; }, get pistol() { return pistol; }, get playerHealth() { return playerHealth; }, camera, get animator() { return animator; }, get posture() { return posture; }, visual, renderer, scene };
})(SC.mv);
