// SHADOW CELL — movement: Stage 1 bootstrap and frame loop.
// Wiring only. Each frame runs: input → motor → visual placement → animator → camera → render.
(function (mv) {
  'use strict';

  const $ = id => document.getElementById(id);
  const ui = {
    loader: $('mv-loader'), loadBar: $('mv-load-bar'), loadText: $('mv-load-text'),
    error: $('mv-error'), errorText: $('mv-error-text'), fpsBadge: $('mv-fpsbadge'), resume: $('mv-resume'), optSound: $('mv-opt-sound'), start: $('mv-start'), startForest: $('mv-start-forest'), levelsRow: $('mv-levels'), opts: $('mv-opts'), optWest: $('mv-opt-west'), optDebug: $('mv-opt-debug'), menu: $('mv-menu'), complete: $('mv-complete'), completeSub: $('mv-complete-sub'), replay: $('mv-replay'), toMenu: $('mv-to-menu'), objective: $('mv-objective'),
    stats: $('mv-stats'), statsBtn: $('mv-stats-btn'), reset: $('mv-reset'),
    gait: $('mv-gait'), speed: $('mv-speed'), noise: $('mv-noise'), guard: $('mv-guard'), detect: $('mv-detect'), hear: $('mv-hear'), aware: $('mv-aware'), memory: $('mv-memory'), reason: $('mv-reason'), post: $('mv-post'), voice: $('mv-voice'), patrol: $('mv-patrol'), persona: $('mv-persona'), startle: $('mv-startle'), cqcstat: $('mv-cqcstat'), g2: $('mv-g2'), throwBtn: $('mv-throw'), chokeBtn: $('mv-choke'), chokestat: $('mv-chokestat'), tkdnstat: $('mv-tkdnstat'), throwstat: $('mv-throwstat'), ko: $('mv-ko'), cqcBtn: $('mv-cqc'), aimBtn: $('mv-aim'), crosshair: $('mv-crosshair'), aimstat: $('mv-aimstat'), hitmark: $('mv-hitmark'), shotstat: $('mv-shotstat'), dmg: $('mv-dmg'), useBtn: $('mv-use'), equip: $('mv-equip'), useItem: $('mv-use-item'), defeat: $('mv-defeat'), fps: $('mv-fps'), rate: $('mv-rate'), quality: $('mv-quality'), calib: $('mv-calib'),
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
  // Step 24: levels. Each is its own group of objects and its own collision (world.store()); one is
  // loaded at a time into the same world, scene and systems. The Test Lab is built (and loaded) at once,
  // exactly as before; the Forest Outpost is built the first time it's chosen and kept after that
  const labGroup = new THREE.Group(); labGroup.name = 'level-lab'; scene.add(labGroup);
  const area = mv.buildTestArea(labGroup, world, renderer);
  const levels = { lab: { id: 'lab', name: 'TEST LAB', group: labGroup, area, store: world.store(), bg: BG.getHex(), fog: [22, 48], started: false, completions: 0 } };
  let level = levels.lab;
  const active = [];   // the loaded level's guards: every system that deals with guards holds this one array
  const forestOpts = { west: false, debug: false, sound: true };   // the level choice's options: Guard D, the forest's developer drawings, sound debugging (Step 24.1)
  const motor = new mv.CharacterMotor(world);
  const input = new mv.Input({ root: document.body, base: $('mv-joy-base'), knob: $('mv-joy-knob'), crouch: $('mv-crouch'), cqc: $('mv-cqc'), throw: $('mv-throw'), choke: $('mv-choke'), aim: $('mv-aim'), use: $('mv-use') });
  const cam = new mv.ThirdPersonCamera(camera, world);
  const actions = new mv.ActionSystem();
  const noise = new mv.NoiseSystem(scene);
  const footAudio = new mv.FootstepAudio(noise);
  // iOS: audio starts on the START tap; any later tap resumes it if the system suspended it
  document.addEventListener('touchend', () => { if (input.enabled) footAudio.unlock(); }, { passive: true });
  let footsteps = null, voice = null, caption = null, traitCard = null, indicator = null, cqc = null, guard = null, guardView = null, awareView = null, patrolView = null, seeTarget = null;
  let aim = null, aimPose = null, pistol = null, playerHealth = null, wasDown = false;   // Step 18, Step 19, Step 22
  let equipment = null;   // Step 23
  let guard2 = null, guard2View = null, aware2View = null, caption2 = null, indicator2 = null, traitCard2 = null;
  // a second copy of a guard's screen-space element (caption, indicator, card), same classes, its own id
  const cloneUi = (id, n) => { const src = $(id), el = src.cloneNode(true); el.id = id + '-' + (n || 2); src.parentNode.insertBefore(el, src.nextSibling); return el; };
  const profile = mv.CHARACTER_PROFILES[window.SC_CHARACTER || 'testSoldier'];
  const visual = new mv.CharacterVisual(profile);
  let animator = null, posture = null;
  scene.add(visual.root);

  // the player at the spawn: standing, still, the camera behind her looking into the yard
  function spawn() {
    input.setCrouch(false); motor.stance = 'stand';
    const sp = level.area.spawn; motor.teleport(sp.x, sp.z, sp.yaw);
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
    guard = new mv.Guard(labGroup, world, visual, Object.assign({ vision: 'regular', hearing: 'regular' }, area.guard), noise);
    // Guard 2 — Stationary CQC Test: the same model and systems, held at his post (no patrol)
    guard2 = new mv.Guard(labGroup, world, visual, Object.assign({ vision: 'regular', hearing: 'regular' }, area.guard2), noise);
    active.push(guard, guard2);
    guard2View = new mv.GuardDebugView(labGroup, guard2);
    aware2View = new mv.GuardAwarenessView(labGroup, guard2);
    guardView = new mv.GuardDebugView(labGroup, guard);
    awareView = new mv.GuardAwarenessView(labGroup, guard);
    patrolView = new mv.GuardPatrolView(labGroup, guard.patrol);
    // his voice: a quiet "huh" once per suspicious incident (a hook until a recording is added)
    voice = new mv.GuardVoice(() => footAudio.ctx);
    // caption: a TEMPORARY "Huh" above his head while no recording exists (guard-caption.js)
    caption = new mv.GuardCaption($('mv-caption'), guard, world);
    cqc = new mv.CQC({ motor, visual, input, noise }, active, world);   // Step 13: grab and restraint (whichever guard is in reach)
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
    aim = new mv.Aim(motor, cam, camera, world, active);
    aimPose = new mv.AimPose(visual, posture, scene);
    // Step 19: the pistol, fired with the CQC button (FIRE) while aiming
    // Step 21: each guard's pistol (aiming only: nothing fires); the same rig as hers, so her hand calibration applies
    guard.weapon = new mv.GuardWeapon(guard, labGroup, posture); guard2.weapon = new mv.GuardWeapon(guard2, labGroup, posture);
    // Step 22: her health, and the guards' gunfire at her (only through weapon.canFire)
    playerHealth = new mv.PlayerHealth(visual, motor); playerHealth.tintEl = ui.dmg; playerHealth.audio = footAudio;
    for (const g of [guard, guard2]) g.gunfire = new mv.GuardGunfire(g, { player: { motor, health: playerHealth }, guards: active, world, noise, scene: labGroup, audio: footAudio });
    pistol = new mv.Pistol({ aim, aimPose, cam, world, guards: active, noise, scene, audio: footAudio, marker: ui.hitmark });
    // Step 23: the equipped weapon (the pistol above, registered, not rebuilt) and item (the Empty Magazine), used through USE
    equipment = new mv.Equipment({ pistol, motor, visual, posture, cam, world, noise, scene, audio: footAudio, guards: active });
    seeTarget = mv.visionTarget(visual, motor);
    const s = animator.stride;
    ui.calib.textContent = `walk ${s.walk.speed.toFixed(2)} · run ${s.run.speed.toFixed(2)} m/s`;
    visual.place(motor.position, motor.yaw);
    // (Step 19: the pistol and its flash and puffs are compiled now too, or the first shot would stall on it)
    const warm = [aimPose.pistol, pistol.flash, ...pistol.puffs, ...Object.values(equipment.controllers).map(c => c.mesh).filter(Boolean)]; for (const o of warm) o.visible = true;
    renderer.compile(scene, camera);
    for (const o of warm) o.visible = false;
    ui.loadText.textContent = 'Ready · choose a level';
    ui.levelsRow.hidden = ui.opts.hidden = ui.start.hidden = ui.startForest.hidden = false;
  }).catch(err => fail('The character could not be loaded (' + (err && err.message || 'network error') + '). Reload to try again.'));

  // Step 24: START is a choice of level. The Test Lab's button is the original START (a first start
  // there changes nothing: the lab is already loaded as it always was); any other choice loads that level fresh
  const begin = id => {
    if (!animator) return;
    if (id !== level.id || level.started) enterLevel(id);
    level.started = true; setStats(false);   // (Step 24.1: STATS collapsed when a level loads)
    ui.loader.classList.add('done');
    setTimeout(() => { if (ui.loader.classList.contains('done')) ui.loader.hidden = true; }, 350);   // (unless the choice was opened again meanwhile)
    input.enabled = true;
    footAudio.unlock();
    document.body.classList.add('playing');
    if (level.area.objective) showObjective(level.area.objective);
  };
  ui.start.addEventListener('click', () => begin('lab'));
  ui.startForest.addEventListener('click', () => begin('forest'));
  // the forest options (on the level choice): Guard D on or off, the developer drawings on or off
  const optLabel = () => { ui.optWest.textContent = 'WEST LOOKOUT ' + (forestOpts.west ? 'ON' : 'OFF'); ui.optWest.setAttribute('aria-pressed', String(forestOpts.west)); ui.optDebug.textContent = 'PATROL DEBUG ' + (forestOpts.debug ? 'ON' : 'OFF'); ui.optDebug.setAttribute('aria-pressed', String(forestOpts.debug)); ui.optSound.textContent = 'SOUND DEBUG ' + (forestOpts.sound ? 'ON' : 'OFF'); ui.optSound.setAttribute('aria-pressed', String(forestOpts.sound)); };
  optLabel();
  ui.optWest.addEventListener('click', () => { forestOpts.west = !forestOpts.west; optLabel(); if (levels.forest) levels.forest.started = true; /* (applied when the forest next loads) */ });
  ui.optDebug.addEventListener('click', () => { forestOpts.debug = !forestOpts.debug; optLabel(); if (level.id === 'forest') applyDebug(); });   // (applied at once)
  // Step 24.1: sound debugging (the rings and labels; the hearing itself is untouched), applied at once, in either level
  ui.optSound.addEventListener('click', () => { forestOpts.sound = !forestOpts.sound; optLabel(); noise.cfg.debug = forestOpts.sound; if (!forestOpts.sound) hideNoiseLabels(); });
  ui.resume.addEventListener('click', () => { if (!level.started || level.complete) return; ui.loader.classList.add('done'); setTimeout(() => { if (ui.loader.classList.contains('done')) ui.loader.hidden = true; }, 350); input.enabled = true; document.body.classList.add('playing'); });
  // back to the level choice (LEVELS chip, LEVEL COMPLETE): play stops, nothing is unloaded
  const toMenu = () => {
    input.clear(); input.enabled = false; document.body.classList.remove('playing');
    ui.complete.hidden = true; ui.objective.hidden = true;
    ui.loader.hidden = false; void ui.loader.offsetWidth; ui.loader.classList.remove('done');
    ui.loadText.textContent = 'Choose a level';
    ui.resume.hidden = !(level.started && !level.complete); ui.resume.textContent = 'RESUME ' + (level.id === 'lab' ? 'TEST LAB' : 'FOREST OUTPOST');
  };
  ui.menu.addEventListener('click', toMenu);
  ui.toMenu.addEventListener('click', toMenu);
  ui.replay.addEventListener('click', () => { ui.complete.hidden = true; resetLevel(); input.enabled = true; if (level.area.objective) showObjective(level.area.objective); });
  let objT = null;
  function showObjective(text) {
    ui.objective.textContent = text; ui.objective.hidden = false; ui.objective.classList.remove('fade');
    clearTimeout(objT); objT = setTimeout(() => { ui.objective.classList.add('fade'); objT = setTimeout(() => { ui.objective.hidden = true; }, 700); }, 4000);
  }
  // RESET puts the player back at the start and the guards back at their posts, calm (Step 24: of the level that's loaded)
  function resetLevel() {
    input._cqcDrop(); /* a CQC press still down is cancelled too: no TAP or HOLD after RESET */ if (cqc) cqc.cancel(); if (aim) aim.reset(); if (pistol) pistol.reset(); input._fireDrop(); if (playerHealth) playerHealth.reset(); if (equipment) equipment.reset(); input.useTapped = false; wasDown = false; ui.defeat.hidden = true; document.body.classList.remove('mv-defeated'); spawn();
    for (const g of active) g.reset();
    if (level.id === 'lab') { for (const u of [caption, indicator, caption2, indicator2]) if (u) u.hide(); }
    else for (const r of level.recs) { r.caption.hide(); r.indicator.hide(); }
    level.complete = false; ui.complete.hidden = true;
  }
  ui.reset.addEventListener('click', () => { resetLevel(); if (!input.enabled && document.body.classList.contains('playing')) input.enabled = true; });

  // ---------------------------------------------------------------- Step 24: loading a level
  // the forest, built once: its objects, its collision, its four guards (each with its own pistol,
  // gunfire, developer views and screen-space marks), every one parked until the level is loaded
  function buildForest() {
    const rec = levels.forest = { id: 'forest', name: mv.FOREST_OUTPOST.name, group: new THREE.Group(), started: false, completions: 0, bg: mv.FOREST_OUTPOST.background, fog: mv.FOREST_OUTPOST.fog, recs: [] };
    rec.group.name = 'level-forest'; scene.add(rec.group);
    const keep = world.store(); world.fresh();
    const t0 = performance.now();
    rec.area = mv.buildForestOutpost(rec.group, world, renderer);
    for (const cfg of rec.area.guards) {
      const g = new mv.Guard(rec.group, world, visual, Object.assign({ vision: 'regular', hearing: 'regular' }, cfg), noise);
      g.levelKey = cfg.key; g.role = cfg.role;
      g.weapon = new mv.GuardWeapon(g, rec.group, posture);
      g.gunfire = new mv.GuardGunfire(g, { player: { motor, health: playerHealth }, guards: active, world, noise, scene: rec.group, audio: footAudio });
      const n = 'f' + cfg.key, r = { g, cfg, view: new mv.GuardDebugView(rec.group, g), aware: new mv.GuardAwarenessView(rec.group, g), route: new mv.GuardPatrolView(rec.group, g.patrol),
        caption: new mv.GuardCaption(cloneUi('mv-caption', n), g, world), indicator: new mv.GuardIndicator(cloneUi('mv-indicator', n), g, world), card: new mv.GuardTraitCard(cloneUi('mv-trait', n), g, world, null, motor) };
      g.awareness.onVocal = line => { const v = voice.say(line, g.position, motor.position); if (!(v.played && r.caption.cfg.onlyWithoutRecording)) r.caption.show(); };
      g.parked = true; rec.recs.push(r);
      // (Step 24.1: in the forest a guard who's off screen or past the fog isn't drawn: his meshes culled against a
      // bounding sphere grown well past his bind pose, so no animation, crouch or fall ever pokes outside it)
      g.root.traverse(n => { if (!n.isMesh || !n.geometry) return; const G = n.geometry; if (!G.userData.grownSphere) { G.computeBoundingSphere(); G.boundingSphere.radius *= 1.8; G.userData.grownSphere = true; } n.frustumCulled = true; });
    }
    rec.buildMs = performance.now() - t0;
    rec.store = world.store(); world.use(keep);
    rec.group.updateMatrixWorld(true);   // (its world matrices now: bullets and the camera test against them before it's first drawn)
    // (Step 24.1: its materials compiled now, its guards' muzzle flashes and hit puffs too: the renderer skips hidden
    // things, and compiling them at a guard's first shot would stall the frame mid-fight)
    const warm = []; for (const r of rec.recs) warm.push(r.g.gunfire.flash, ...r.g.gunfire.puffs, r.g.weapon.gun);
    const was = warm.map(o => o.visible); warm.forEach(o => { o.visible = true; }); rec.group.visible = true;
    renderer.compile(scene, camera);
    warm.forEach((o, i) => { o.visible = was[i]; }); rec.group.visible = false;
    return rec;
  }
  // which of a level's guards are on: the forest's from their configuration (Guard D by the option)
  const enabledIn = rec => rec.id === 'lab' ? [guard, guard2] : rec.recs.filter(r => r.cfg.key === 'D' ? forestOpts.west : r.cfg.enabled).map(r => r.g);
  function enterLevel(id) {
    const next = levels[id] || (id === 'forest' ? buildForest() : null);
    if (!next) return false;
    // the one that was loaded: back at their posts while its collision is still loaded (a knocked-out guard's
    // ground colliders live there), then parked (hidden, deaf, not updated), its marks hidden
    for (const g of active) g.reset();
    for (const g of active) g.parked = true;
    if (level.id === 'lab') { for (const u of [caption, indicator, caption2, indicator2, traitCard, traitCard2]) if (u) u.hide(); }
    else for (const r of level.recs) { r.caption.hide(); r.indicator.hide(); r.card.hide(); }
    level.group.visible = false;
    // the new one
    level = next; world.use(next.store); next.group.visible = true;
    active.length = 0; active.push(...enabledIn(next));
    if (next.recs) for (const r of next.recs) { const on = active.indexOf(r.g) >= 0; r.g.parked = !on; r.g.root.visible = on; }
    for (const g of active) g.parked = false;
    if (cqc) cqc.guard = active[0];
    BG.setHex(next.bg); scene.fog.near = next.fog[0]; scene.fog.far = next.fog[1];
    // (Step 24.1: nothing past the fog is drawn in the forest: it would only be fog-coloured; the lab keeps its 80 m)
    camera.far = next.id === 'lab' ? 80 : next.fog[1] + 4; camera.updateProjectionMatrix();
    applyDebug();
    noise.cfg.debug = forestOpts.sound;   // (Step 24.1: sound rings by their own option, in either level)
    resetLevel();
    if (next.recs) for (const r of next.recs) if (r.g.parked && r.g.collider) r.g.collider.x = 1e6;   // (a guard who's off isn't in the way either)
    if (next.id === 'lab') { if (ui.levelCell) { ui.levelCell.remove(); for (const p of ui.patrolCells) p.el.remove(); } for (const t of ui.stats.querySelectorAll('i.g1')) t.textContent = 'G1'; ui.stats.querySelector('i.g2').textContent = 'G2'; }
    else { levelCell(); ui.stats.querySelector('i.g2').textContent = 'ALL'; }
    return true;
  }
  // the developer drawings of the loaded level: the Test Lab keeps its own; the forest's only by the option.
  // (Step 24.1: otherwise hidden, never drawn: left alone they'd stand at the world's origin, inside the compound's southern block)
  function applyDebug() {
    const dbg = level.id === 'lab' || forestOpts.debug;
    for (const g of active) { g.awareness.cfg.debug = dbg; if (g.hearing) g.hearing.cfg.debug = dbg; }
    level.debug = dbg;
    if (level.recs) for (const r of level.recs) { const on = dbg && !r.g.parked; r.view.group.visible = on; r.aware.group.visible = on; r.route.group.visible = on; if (r.g.hearing.marker) r.g.hearing.marker.visible = on; if (!on) r.card.hide(); }
  }
  // the developer bar's LEVEL cell (the forest only: the lab's bar is unchanged)
  function levelCell() {
    const sec = ui.stats.querySelector('.mv-sec:last-child');
    if (!ui.levelCell) {
      const d = document.createElement('div'); d.className = 'mv-levelcell'; d.innerHTML = '<span>LEVEL</span><b id="mv-level">–</b>'; ui.levelCell = d; ui.level = d.querySelector('b');
      // Step 24.1: one cell per guard of the level: his patrol, waypoints, pause, state, and why he's off his route
      ui.patrolCells = level.recs.map(r => { const c = document.createElement('div'); c.className = 'mv-levelcell'; c.innerHTML = `<span>PATROL ${r.cfg.key}</span><b id="mv-patrol-${r.cfg.key}">–</b>`; return { el: c, b: c.querySelector('b'), r }; });
    }
    sec.appendChild(ui.levelCell); for (const p of ui.patrolCells) { if (p.r.g.parked) p.el.remove(); else sec.appendChild(p.el); }
  }
  // reached the END alive: LEVEL COMPLETE, once
  function completeLevel() {
    level.complete = true; level.completions++;
    input.clear(); input.enabled = false;
    ui.completeSub.textContent = level.name.replace(/^LEVEL \d+ — /, ''); ui.complete.hidden = false; ui.objective.hidden = true;
  }
  const inExit = (X, p) => p.x >= X.minX && p.x <= X.maxX && p.z >= X.minZ && p.z <= X.maxZ;

  // the stats bar leaves room for RESET / STATS in its top-right corner (LEVELS shows only while it's closed)
  const chipRoom = () => document.documentElement.style.setProperty('--chips-w', document.querySelector('.mv-topright').offsetWidth - (ui.menu.offsetWidth ? ui.menu.offsetWidth + 6 : 0) + 8 + 'px');
  chipRoom(); window.addEventListener('resize', chipRoom);
  // STATS: expanded or collapsed (Step 24.1: a level starts collapsed)
  function setStats(open) {
    ui.stats.hidden = !open; ui.statsBtn.setAttribute('aria-pressed', String(open));
    if (open) { for (const b of ui.stats.querySelectorAll('b')) b._v = undefined; hudT = 1; }   // shown again: every value rewritten on the next frame
  }
  ui.statsBtn.addEventListener('click', () => setStats(ui.stats.hidden));

  // ---------------------------------------------------------------- Step 24: the developer bar in another level
  // the G1 cells follow the active guard nearest her, the G2 cell lists them all in short
  const near = g => Math.hypot(g.position.x - motor.position.x, g.position.z - motor.position.z);
  const statGuards = () => { const l = active.slice().sort((a, b) => near(a) - near(b)); return [l[0] || null, l[1] || null]; };
  const xz1 = p => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;
  // one guard in a few words: his key, state, and where his route has him (waypoint, pause left, back to his route)
  const brief = g => {
    if (g.isDown()) return `${g.levelKey} ${g.ko.state === 'DEAD' ? 'DEAD' : 'down'}`;
    const a = g.awareness, p = g.patrol, st = a.state === 'HEIGHTENED' ? 'HEIGHT' : a.state === 'INVESTIGATING' ? 'INVEST' : a.state === 'SUSPICIOUS' ? 'SUSP' : a.state;
    let route = '';
    if (p && p.enabled) route = p.state === 'interrupted' ? `off route (W${p.resumeIndex} next)` : p.state === 'observing' ? `W${p.index} ${p.obs ? Math.max(0, p.obs.total - (p.obs.i * p.obs.hold + p.obs.heldFor)).toFixed(1) + ' s' : ''}` : `${p.rejoining ? 'rejoin ' : ''}→W${p.index}`;
    return `${g.levelKey} ${st}${g.restraint ? ' HELD' : ''} ${route}`;
  };
  // one guard's patrol in full: his assignment, the waypoint he's at or heading for and the one after, the pause left,
  // what he's doing, and why he's off his route (if he is)
  const patrolLine = r => {
    const g = r.g, p = g.patrol, a = g.awareness, role = r.cfg.label.split('— ')[1] || r.cfg.role;
    if (g.isDown()) return `${role} · ${g.ko.state}${g.ko.state === 'DEAD' ? '' : ' · ' + g.ko.status()} · no patrol while down`;
    const nx = p.nextIndex ? (() => { const d = p.dir, n = p.nextIndex(p.index); p.dir = d; return n; })() : null;
    const pause = p.state === 'observing' && p.obs ? ` · pause ${Math.max(0, p.obs.total - (p.obs.i * p.obs.hold + p.obs.heldFor)).toFixed(1)} s left` : '';
    const st = p.state === 'interrupted' ? `INTERRUPTED (${p.why || a.state.toLowerCase()}) · back to W${p.resumeIndex} when calm` : p.rejoining ? 'rejoining route' : p.state;
    return `${role} · ${a.state}${a.behavior ? ' ' + a.behavior : ''} · W${p.index}${nx != null ? '→W' + nx : ''}${pause} · ${st}`;
  };
  function forestStats() {
    const L = level, X = L.area.exit, p = motor.position, toExit = Math.hypot(Math.max(X.minX - p.x, 0, p.x - X.maxX), Math.max(X.minZ - p.z, 0, p.z - X.maxZ));
    if (ui.level) put(ui.level, `${L.name.replace(/^LEVEL (\d+) — /, 'L$1 ')} · you ${xz1(p)} · ${L.complete ? 'COMPLETE' : 'exit ' + toExit.toFixed(0) + ' m'} · ${active.length}/${L.recs.length} guards`);
    put(ui.g2, L.recs.filter(r => !r.g.parked).map(r => brief(r.g)).join(' · '));
    if (ui.patrolCells) for (const c of ui.patrolCells) if (!c.r.g.parked) put(c.b, patrolLine(c.r));
    const s = statGuards()[0]; if (s) { const t = ui.stats.querySelector('i.g1'); if (t && t.textContent !== s.levelKey) t.textContent = s.levelKey; }
  }

  // ---------------------------------------------------------------- Step 24.1: sound-event labels (sound debugging)
  // a short label at each sound's origin: what, level, surface, reach and which guards heard it; 4 reused in turn
  const noiseLabels = { els: [], next: 0, live: 0 }, _np = new THREE.Vector3();
  for (let i = 0; i < 4; i++) { const el = document.createElement('div'); el.className = 'mv-noiselabel'; document.body.appendChild(el); noiseLabels.els.push({ el, ev: null, t: 0, shown: false }); }
  noise.onShown = ev => {
    if (!forestOpts.sound) return;
    const heard = active.filter(g => g.hearing && g.hearing.last && g.hearing.last.heard && g.hearing.last.type === ev.type && g.hearing.last.position.x === ev.position.x && g.hearing.last.position.z === ev.position.z).map(g => g.levelKey || (g === guard ? '1' : '2'));
    const L = noiseLabels.els[noiseLabels.next]; noiseLabels.next = (noiseLabels.next + 1) % noiseLabels.els.length;
    L.el.textContent = `${ev.type.toUpperCase()} — L${ev.level} — ${ev.surface.toUpperCase()} — ${ev.radius.toFixed(1)} m${heard.length ? ' · heard by ' + heard.join(',') : ''}`;
    L.ev = ev; L.age = 0; if (!L.shown) noiseLabels.live++; L.shown = true;
  };
  // (in game time, like the rings: a label lives exactly as long as its ring)
  function updateNoiseLabels(dt) {
    const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight, life = noise.cfg.ringTime;
    for (const L of noiseLabels.els) {
      if (!L.shown) continue;
      L.age += dt; const k = L.age / life;
      _np.copy(L.ev.position); _np.y += 0.25; _np.project(camera);
      if (k >= 1 || _np.z > 1) { L.shown = false; noiseLabels.live--; L.el.style.opacity = '0'; continue; }
      L.el.style.transform = `translate(${((_np.x + 1) / 2 * W).toFixed(0)}px, ${((1 - _np.y) / 2 * H).toFixed(0)}px) translate(-50%, -100%)`;
      L.el.style.opacity = String(k < 0.6 ? 1 : (1 - k) / 0.4);
    }
  }
  function hideNoiseLabels() { for (const L of noiseLabels.els) { if (L.shown) noiseLabels.live--; L.shown = false; L.el.style.opacity = '0'; } }

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  const fwd = new THREE.Vector3(), aimMz = new THREE.Vector3();
  let fps = 60, fpsN = 0, hudT = 0, grace = 2;
  // stats text is written only when it changes (each write re-lays out the bar)
  const put = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
  const cqcUi = { t: 0, ready: false, shown: null, lbl: 'CQC', hold: false, thr: false, thrReady: null, thrShown: null, locked: false, ring: null, charging: false, fired: false, cring: null, timer: false, urgent: false };
  ui.useRing = ui.useBtn.querySelector('circle');
  // Step 23: what the equipped item needs to know about her right now
  const useState = down => ({ down, aiming: !!(aim && aim.active), cqcState: cqc ? cqc.state : 'FREE', busy: actions.busy() });
  ui.chokeRing = ui.chokeBtn.querySelector('circle'); ui.cqcRing = ui.cqcBtn.querySelector('circle'); ui.cqcLabel = ui.cqcBtn.querySelector('span');
  // Step 24.1: the frame rate from real time between drawn frames (the simulation's step is capped at 1/20 s, so
  // counting steps would read 20 fps on a slower device); once a second into the FPS badge and STATS
  let fpsT0 = performance.now();
  function frame() {
    tick(Math.min(clock.getDelta(), 1 / 20));
    const now = performance.now(); fpsN++;
    if (now - fpsT0 >= 1000) {
      fps = fpsN * 1000 / (now - fpsT0); fpsN = 0; fpsT0 = now;
      put(ui.fpsBadge, 'FPS ' + Math.round(fps));
      if (input.enabled && (grace -= 1) < 0 && fps < 48 && tier < TIERS.length - 1) { applyTier(tier + 1); grace = 2; }
    }
  }
  // one frame of everything; the checks step it by hand (noRender: skip drawing it)
  function tick(dt, noRender) {

    if (animator && !level.complete) {   // (Step 24: once a level is complete, play stops behind its screen)
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
      // Step 23: USE: the equipped item's own action (a throw for the magazine), once per press, never a CQC or FIRE press
      if (equipment) {
        const es = useState(down), it = equipment.item();
        if (input.useTapped) { input.useTapped = false; equipment.useItem(es); }
        equipment.update(dt, es);
        const why = it && it.ctl.canUse ? it.ctl.canUse(es) : 'no item', cdK = it && it.ctl.cooldown > 0 ? it.ctl.cooldown / it.ctl.cfg.cooldown : 0;
        if (cqcUi.useLocked !== !!why) { cqcUi.useLocked = !!why; ui.useBtn.classList.toggle('locked', !!why); }
        const ring = cdK > 0 ? (182.2 * (1 - cdK)).toFixed(0) : null;
        if (cqcUi.useRing !== ring) { if ((cqcUi.useRing == null) !== (ring == null)) ui.useBtn.classList.toggle('cooling', ring != null); cqcUi.useRing = ring; if (ring != null) ui.useRing.style.strokeDashoffset = ring; }
        const short = it ? it.def.short || it.def.name : '–'; if (cqcUi.useLbl !== short) { cqcUi.useLbl = short; ui.useItem.textContent = short; }
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
        if (equipment) equipment.pose(dt);   // Step 23: the throwing arm (her legs keep their animation)
        if (playerHealth) playerHealth.poseReact(dt);   // Step 22: a hit's flinch (before the aim pose: her pistol stays in her hands)
        if (aimPose) aimPose.apply(cam.aimK, motor.yaw, aim.target.dir, aim.target.point);
      } else if (aimPose) aimPose.pistol.visible = false;
      if (playerHealth) playerHealth.defeatPose(dt);   // (going down at 0 HP, over everything)
      visual.root.updateMatrixWorld(true);
      if (!down) footsteps.update(dt);
      if (level.id === 'lab') {
        guard.update(dt, seeTarget);
        guardView.update(camera, seeTarget);
        guard.hearing.updateDebug(labGroup);
        awareView.update(camera);
        patrolView.update(guard.awareness.cfg.debug);
        guard2.update(dt, seeTarget);
        guard2View.update(camera, seeTarget);
        guard2.hearing.updateDebug(labGroup);
        aware2View.update(camera);
      } else {
        // Step 24: the level's guards, each on his own (the developer drawings only when asked for)
        const dbg = level.debug;
        for (const r of level.recs) {
          if (r.g.parked) continue;
          r.g.update(dt, seeTarget);
          if (dbg) { r.view.update(camera, seeTarget); r.g.hearing.updateDebug(level.group); r.aware.update(camera); r.route.update(true); }
        }
        // the END: reached on her feet
        if (level.area.exit && !down && inExit(level.area.exit, motor.position)) completeLevel();
      }
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
    if (level.id === 'lab') {
      if (caption) caption.update(dt, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight);   // caption
      if (traitCard) traitCard.update(dt, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
      if (indicator) indicator.update(dt, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
      for (const u of [caption2, traitCard2, indicator2]) if (u) u.update(dt, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    } else {
      const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
      for (const r of level.recs) { if (r.g.parked) continue; r.caption.update(dt, camera, W, H); r.indicator.update(dt, camera, W, H); if (level.debug) r.card.update(dt, camera, W, H); }   // (the personality card is a developer drawing)
    }
    sun.position.set(motor.position.x + 6, 14, motor.position.z + 5);
    sun.target.position.copy(motor.position);
    if (!noRender) renderer.render(scene, camera);

    // frame rate + adaptive quality
    if (noiseLabels.live) updateNoiseLabels(dt);
    hudT += dt;
    if (hudT > 0.15 && !ui.stats.hidden) {
      hudT = 0;
      // Step 22: her health beside her gait, and what the guards have fired at her
      const ef = guard && guard2 ? active.reduce((t, g) => ({ shots: t.shots + (g.gunfire ? g.gunfire.shots : 0), hits: t.hits + (g.gunfire ? g.gunfire.hits : 0) }), { shots: 0, hits: 0 }) : null;
      put(ui.gait, motor.gait.label + (playerHealth ? ' · ' + playerHealth.status(ef) : ''));
      put(ui.speed, motor.speed.toFixed(2) + ' m/s');
      const n = noise.last;
      put(ui.noise, n && performance.now() / 1000 - n.time < 1.2 ? `L${n.level} ${n.surface} · ${n.radius.toFixed(1)} m` : '–');
      // (Step 24: in another level these cells follow its guards: the one nearest her, then the next nearest)
      const sg = level.id === 'lab' ? [guard, guard2] : statGuards();
      ((guard, guard2) => { if (guard) {
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
        // Step 23: what's equipped (weapon and item, each with its state) and the last distraction
        // (the last distraction's details for a while after it, and only while she's free: holding a guard or aiming, the bar has no line to spare)
        if (equipment) { const it = equipment.item(), d = it && it.ctl.distraction && !cqc.active() && !aim.active ? it.ctl.distraction() : ''; put(ui.equip, equipment.status() + (d ? ' · ' + d : '')); }
        // Step 20: health first (just HP until he's hurt), then consciousness / defeat
        const hp = g => !g.health ? '' : g.health.lastDamage ? g.health.status() + ' · ' : `HP ${g.health.current}/${g.health.max} · `;
        put(ui.ko, hp(guard) + (guard.health && guard.health.lastDamage ? '' : guard.ko.status()) + (guard.awareness.attack ? ` · remembers ${guard.awareness.attack.kind === 'shot' ? 'being shot' : 'attack'} at ${xz(guard.awareness.attack.position)}` : ''));
        if (guard2) { const b = guard2.awareness, tr = `${guard2.personality.traits.primary}/${guard2.personality.traits.secondary}`;
          put(ui.g2, guard2.isDown() ? `${hp(guard2)}${guard2.health && guard2.health.lastDamage ? '' : guard2.ko.status() + ' · '}${tr}${b.attack ? ' · remembers attack at ' + xz(b.attack.position) : ''}`
            : `${hp(guard2)}${b.state} · ${Math.round(b.suspicion * 100)}% · seen ${Math.round(guard2.vision.meter * 100)}% · ${tr} · ${guard2.restraint ? 'RESTRAINED' : guard2.atPost() ? 'at post' : 'off post ' + xz(guard2.position)}${guard2.ko.knockouts ? ' · ' + guard2.ko.status() : ''}${wpn(guard2)}`); }
        put(ui.post, `${xz(guard.post)} ${Math.round(guard.postYaw * 57.3)}° · ${guard.atPost() ? 'at post' : 'away from post'}${a.state === 'RETURNING' ? ' · returning' : ''}${a.stoodDownAt != null ? ' · stood down ' + (a.clock - a.stoodDownAt).toFixed(0) + ' s ago' : ''}${a.interrupted ? ' · ' + a.interrupted : ''}`);
      } })(sg[0], sg[1]);
      if (level.id !== 'lab') forestStats();
      put(ui.rate, animator ? animator.playRate.toFixed(2) + '×' : '–');
      put(ui.fps, fps.toFixed(0) + ' · ' + renderer.info.render.calls + ' draws');
    }
  }
  renderer.setAnimationLoop(frame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { renderer.setAnimationLoop(null); input.clear(); footAudio.suspend(); }
    else { clock.getDelta(); renderer.setAnimationLoop(frame); }
  });

  window.MV = { SCmv: mv, tick, motor, cam, input, world, area, noise, footAudio, levels, active, forestOpts, enterLevel, resetLevel, begin, toMenu, setStats, noiseLabels, get fps() { return fps; }, get level() { return level; }, get guard() { return guard; }, get guard2() { return guard2; }, get guards() { return [guard, guard2]; }, get caption2() { return caption2; }, get indicator2() { return indicator2; }, get traitCard2() { return traitCard2; }, get seeTarget() { return seeTarget; }, get footsteps() { return footsteps; }, get voice() { return voice; }, get caption() { return caption; }, get traitCard() { return traitCard; }, get indicator() { return indicator; }, get cqc() { return cqc; }, get aim() { return aim; }, get aimPose() { return aimPose; }, get pistol() { return pistol; }, get playerHealth() { return playerHealth; }, get equipment() { return equipment; }, camera, get animator() { return animator; }, get posture() { return posture; }, visual, renderer, scene };
})(SC.mv);
