// SHADOW CELL — Phase 1A operative review stage.
// Loads the skinned operative GLB, plays its idle, and lets you orbit it with touch.
// Rendering is budgeted for iPhone: capped/adaptive pixel ratio, one shadow-casting
// light with a tight frustum, two materials, no post-processing.
(function () {
  'use strict';

  const MODEL_URL = window.SC_MODEL_URL || 'assets/models/operative.glb';
  // Current file is a stand-in used to validate the pipeline and iPhone performance;
  // it faces -Z, so it is turned to face the FRONT camera.
  const MODEL_YAW = Math.PI;
  const MODEL_NOTE = 'STAND-IN MODEL · FINAL OPERATIVE PENDING';
  const LOAD_TIMEOUT_MS = 45000;
  const BG = 0x16191a;

  const $ = id => document.getElementById(id);
  const ui = {
    stage: $('stage'), loader: $('loader'), loadLabel: $('load-label'), loadBar: $('load-bar'), loadDetail: $('load-detail'),
    error: $('error'), errorTitle: $('error-title'), errorText: $('error-text'), retry: $('retry'), hint: $('hint'),
    stats: $('stats'), statsToggle: $('stats-toggle'),
    st: { fps: $('st-fps'), quality: $('st-quality'), dpr: $('st-dpr'), calls: $('st-calls'), tris: $('st-tris'), load: $('st-load'), gpu: $('st-gpu') },
  };

  function showError(title, text, canRetry) {
    ui.loader.hidden = true;
    ui.error.hidden = false;
    ui.errorTitle.textContent = title;
    ui.errorText.textContent = text;
    ui.retry.hidden = !canRetry;
  }

  // ------------------------------------------------------------------ renderer
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default', stencil: false });
  } catch (e) {
    showError('3D graphics unavailable', 'This browser could not start WebGL. On iPhone, check that Settings › Safari › Advanced › Feature Flags has WebGL enabled, then reload.', false);
    return;
  }
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;
  ui.stage.appendChild(renderer.domElement);

  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  ui.st.gpu.textContent = gpuName;

  // Quality tiers: the adaptive controller only steps down, so it never oscillates.
  const deviceDpr = window.devicePixelRatio || 1;
  const TIERS = [
    { name: 'HIGH', dpr: Math.min(deviceDpr, 2), shadowSize: 1024, shadows: true },
    { name: 'MEDIUM', dpr: Math.min(deviceDpr, 1.5), shadowSize: 1024, shadows: true },
    { name: 'LOW', dpr: Math.min(deviceDpr, 1.15), shadowSize: 512, shadows: true },
    { name: 'MINIMUM', dpr: 1, shadowSize: 512, shadows: false },
  ];
  let tier = 0;

  // ------------------------------------------------------------------ scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 7, 16);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);

  const hemi = new THREE.HemisphereLight(0xdfe4e6, 0x4b4536, 0.75);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff1dc, 2.1);
  key.position.set(2.2, 4.2, 3.0);
  key.castShadow = true;
  const sc = key.shadow.camera;
  sc.left = -1.1; sc.right = 1.1; sc.top = 2.1; sc.bottom = -0.3; sc.near = 0.5; sc.far = 10;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 3;
  scene.add(key);
  scene.add(key.target);
  const rim = new THREE.DirectionalLight(0xc8d8ff, 1.1);
  rim.position.set(-2.5, 3.0, -3.5);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-3, 1.5, 2.5);
  scene.add(fill);

  // ground: subtle worn concrete that fades into the backdrop (opaque — no blending cost)
  function groundTexture() {
    const s = 512, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const bg = '#16191a';
    g.fillStyle = '#3d3f3a'; g.fillRect(0, 0, s, s);
    const img = g.getImageData(0, 0, s, s), d = img.data;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 18;
      d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.8;
    }
    g.putImageData(img, 0, 0);
    // soft blotches
    for (let i = 0; i < 40; i++) {
      const x = rnd() * s, y = rnd() * s, r = 20 + rnd() * 70;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${rnd() < 0.5 ? '20,20,16' : '90,88,76'},0.12)`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // radial fade into the backdrop colour
    const fade = g.createRadialGradient(s / 2, s / 2, s * 0.18, s / 2, s / 2, s * 0.5);
    fade.addColorStop(0, 'rgba(22,25,26,0)');
    fade.addColorStop(1, bg);
    g.fillStyle = fade; g.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(7, 48).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: groundTexture() })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // contact shadow: a small dark radial decal under the feet anchors the body even
  // where the shadow map is soft or disabled on the lowest tier
  function blobTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.62)');
    gr.addColorStop(0.45, 'rgba(0,0,0,0.32)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.8).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, toneMapped: false })
  );
  blob.position.y = 0.004;
  blob.renderOrder = 1;
  scene.add(blob);

  // ------------------------------------------------------------------ orbit camera
  const orbit = {
    yaw: 0.35, pitch: 0.12, dist: 4.2, targetY: 0.95,
    goalYaw: 0.35, goalPitch: 0.12, goalDist: 4.2, goalTargetY: 0.95,
    vYaw: 0, vPitch: 0,
    minDist: 0.9, maxDist: 7,
  };
  const VIEWS = {
    front: { yaw: 0, pitch: 0.1 }, left: { yaw: Math.PI / 2, pitch: 0.1 },
    back: { yaw: Math.PI, pitch: 0.1 }, right: { yaw: -Math.PI / 2, pitch: 0.1 },
    face: { yaw: 0.25, pitch: 0.05, close: true },
  };

  function fitDistance() {
    // keep the full 1.85 m figure (plus margin) in frame for the current aspect ratio
    const vfov = camera.fov * Math.PI / 180;
    const hNeed = 2.25, wNeed = 1.25;
    const dH = (hNeed / 2) / Math.tan(vfov / 2);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dW = (wNeed / 2) / Math.tan(hfov / 2);
    return Math.max(dH, dW) + 0.4;
  }
  function frameHeightForDist(d) {
    // aim at the hips when far, at the face when close
    const t = THREE.MathUtils.clamp((d - 1.1) / (fitDistance() - 1.1), 0, 1);
    return THREE.MathUtils.lerp(1.62, 0.93, t);
  }

  function setView(name) {
    const v = VIEWS[name];
    // take the shortest way round
    let dy = v.yaw - orbit.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    orbit.goalYaw = orbit.yaw + dy;
    orbit.goalPitch = v.pitch;
    orbit.goalDist = v.close ? 1.15 : fitDistance();
    orbit.vYaw = orbit.vPitch = 0;
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
  }

  // pointer handling: 1 finger orbits (with inertia), 2 fingers pinch-zoom, double-tap resets
  const pointers = new Map();
  let pinchStart = 0, pinchDist0 = 0, lastTap = 0, moved = 0;
  const canvas = renderer.domElement;

  function clearViewButtons() { document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', 'false')); }

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    moved = 0;
    orbit.vYaw = orbit.vPitch = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      pinchDist0 = orbit.goalDist;
    }
    ui.hint.classList.add('fade');
  });
  canvas.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    const now = performance.now(), dt = Math.max(1, now - p.t);
    p.x = e.clientX; p.y = e.clientY; p.t = now;
    if (pointers.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      const k = 0.0085;
      orbit.goalYaw -= dx * k;
      orbit.goalPitch = THREE.MathUtils.clamp(orbit.goalPitch + dy * k * 0.7, -0.15, 1.2);
      // velocity in rad/ms for the inertia fling
      orbit.vYaw = THREE.MathUtils.lerp(orbit.vYaw, -dx * k / dt, 0.5);
      orbit.vPitch = THREE.MathUtils.lerp(orbit.vPitch, dy * k * 0.7 / dt, 0.5);
      if (moved > 6) clearViewButtons();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart > 0) orbit.goalDist = THREE.MathUtils.clamp(pinchDist0 * pinchStart / d, orbit.minDist, orbit.maxDist);
      moved += 10;
      clearViewButtons();
    }
  });
  function endPointer(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = 0;
    if (wasSingle) {
      const now = performance.now();
      if (moved < 8) {
        if (now - lastTap < 320) { setView('front'); orbit.goalDist = fitDistance(); lastTap = 0; }
        else lastTap = now;
        orbit.vYaw = orbit.vPitch = 0;
      }
      // a finger that stopped before lifting should not fling
      if (now - p.t > 80) orbit.vYaw = orbit.vPitch = 0;
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    orbit.goalDist = THREE.MathUtils.clamp(orbit.goalDist * Math.exp(e.deltaY * 0.0012), orbit.minDist, orbit.maxDist);
    clearViewButtons();
  }, { passive: false });
  // block Safari page gestures (pinch-zoom, double-tap zoom, rubber-band scroll)
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });

  function updateOrbit(dt) {
    const ms = dt * 1000;
    if (pointers.size === 0 && (Math.abs(orbit.vYaw) > 1e-5 || Math.abs(orbit.vPitch) > 1e-5)) {
      orbit.goalYaw += orbit.vYaw * ms;
      orbit.goalPitch = THREE.MathUtils.clamp(orbit.goalPitch + orbit.vPitch * ms, -0.15, 1.2);
      const decay = Math.exp(-dt * 4.5);
      orbit.vYaw *= decay; orbit.vPitch *= decay;
    }
    const k = 1 - Math.exp(-dt * 12);
    orbit.yaw += (orbit.goalYaw - orbit.yaw) * k;
    orbit.pitch += (orbit.goalPitch - orbit.pitch) * k;
    orbit.dist += (orbit.goalDist - orbit.dist) * (1 - Math.exp(-dt * 9));
    orbit.goalTargetY = frameHeightForDist(orbit.goalDist);
    orbit.targetY += (orbit.goalTargetY - orbit.targetY) * (1 - Math.exp(-dt * 9));

    const cp = Math.cos(orbit.pitch);
    camera.position.set(
      Math.sin(orbit.yaw) * cp * orbit.dist,
      orbit.targetY + Math.sin(orbit.pitch) * orbit.dist,
      Math.cos(orbit.yaw) * cp * orbit.dist
    );
    if (camera.position.y < 0.08) camera.position.y = 0.08;
    camera.lookAt(0, orbit.targetY, 0);
  }

  // ------------------------------------------------------------------ resize / quality
  function applyTier(i) {
    tier = i;
    const t = TIERS[i];
    renderer.setPixelRatio(t.dpr);
    renderer.shadowMap.enabled = t.shadows;
    key.castShadow = t.shadows;
    if (key.shadow.mapSize.x !== t.shadowSize) {
      key.shadow.mapSize.set(t.shadowSize, t.shadowSize);
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    }
    scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
    ui.st.quality.textContent = t.name;
    resize();
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 30 : 32;
    camera.updateProjectionMatrix();
    const fit = fitDistance();
    orbit.maxDist = fit * 1.8;
    if (orbit.goalDist > 1.3) orbit.goalDist = fit;
    const px = renderer.getPixelRatio();
    ui.st.dpr.textContent = `${px.toFixed(2)}× (${Math.round(w * px)}×${Math.round(h * px)})`;
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 300));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

  // ------------------------------------------------------------------ model
  let hips = null, model = null, mixer = null, actions = {}, current = null, skeletonHelper = null, loadT0 = 0;

  function setProgress(frac, detail) {
    ui.loadBar.style.width = Math.round(frac * 100) + '%';
    if (detail) ui.loadDetail.textContent = detail;
  }

  function loadModel() {
    ui.error.hidden = true;
    ui.loader.hidden = false;
    ui.loader.classList.remove('done');
    ui.loadLabel.textContent = 'LOADING OPERATIVE…';
    setProgress(0, ' ');
    loadT0 = performance.now();
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      showError('Loading is taking too long', 'The operative model did not finish downloading. Check your connection and tap Retry.', true);
    }, LOAD_TIMEOUT_MS);

    const loader = new THREE.GLTFLoader();
    const onLoad = gltf => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ui.loadLabel.textContent = 'PREPARING TEXTURES…';
      setProgress(1);
      // let the label paint before the GPU upload stalls the main thread
      requestAnimationFrame(() => setupModel(gltf));
    };
    const onProgress = ev => {
      if (ev.lengthComputable && ev.total) setProgress(ev.loaded / ev.total, `${(ev.loaded / 1048576).toFixed(2)} / ${(ev.total / 1048576).toFixed(2)} MB`);
      else setProgress(0.5, `${(ev.loaded / 1048576).toFixed(2)} MB`);
    };
    const onError = err => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const offline = navigator.onLine === false;
      showError('Couldn\'t load the operative', offline
        ? 'You appear to be offline. Reconnect and tap Retry.'
        : 'The model file could not be read (' + ((err && err.message) || 'network error') + '). Tap Retry; if it keeps failing, reload the page.', true);
    };
    if (/\.b64\.txt$/.test(MODEL_URL)) {
      // hosts that only serve text get the GLB as base64; decode and parse in memory
      const fl = new THREE.FileLoader();
      fl.load(MODEL_URL, text => {
        try {
          const bin = atob(text.trim()), buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          loader.parse(buf.buffer, '', onLoad, onError);
        } catch (e) { onError(e); }
      }, onProgress, onError);
    } else {
      loader.load(MODEL_URL, onLoad, onProgress, onError);
    }
  }
  ui.retry.addEventListener('click', loadModel);

  function setupModel(gltf) {
    model = gltf.scene;
    const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    model.traverse(o => {
      if (o.isSkinnedMesh || o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        // skinned bounds don't follow the animated pose; the figure is always in view here
        o.frustumCulled = false;
        const m = o.material;
        if (m.map) m.map.anisotropy = maxAniso;
        if (m.normalMap) m.normalScale.set(1, 1);
        m.envMapIntensity = 0;
        m.metalness = 0;
        m.roughness = 0.82;
      }
    });
    model.rotation.y = MODEL_YAW;
    scene.add(model);
    if (MODEL_NOTE) { const n = $('model-note'); n.textContent = MODEL_NOTE; n.hidden = false; }

    // ground the figure: lowest point of the bind pose sits exactly on y = 0
    const box = new THREE.Box3().setFromObject(model);
    model.position.y -= box.min.y;

    hips = model.getObjectByName('mixamorigHips') || model.getObjectByName('mixamorig:Hips');
    mixer = new THREE.AnimationMixer(model);
    gltf.animations.forEach(clip => { actions[clip.name] = mixer.clipAction(clip); });
    skeletonHelper = new THREE.SkeletonHelper(model);
    skeletonHelper.visible = false;
    skeletonHelper.material.depthTest = false;
    skeletonHelper.material.toneMapped = false;
    scene.add(skeletonHelper);
    playPose('idle', 0);

    // first frame compiles shaders and uploads textures — do it behind the loader
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    const ms = performance.now() - loadT0;
    ui.st.load.textContent = (ms / 1000).toFixed(2) + ' s';
    ui.loader.classList.add('done');
    setTimeout(() => { ui.loader.hidden = true; }, 400);
    setTimeout(() => ui.hint.classList.add('fade'), 6000);
    perf.reset(1.5);
    report.loadMs = ms;
    report.joints = model.getObjectByProperty('type', 'SkinnedMesh').skeleton.bones.length;
  }

  function playPose(name, fade) {
    const next = actions[name];
    if (!next || next === current) return;
    next.reset().setEffectiveWeight(1).play();
    if (current) current.crossFadeTo(next, fade == null ? 0.35 : fade, false);
    current = next;
    document.querySelectorAll('[data-pose]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pose === name)));
  }

  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('[data-pose]').forEach(b => b.addEventListener('click', () => playPose(b.dataset.pose)));
  $('skeleton-toggle').addEventListener('click', e => {
    if (!skeletonHelper) return;
    skeletonHelper.visible = !skeletonHelper.visible;
    e.currentTarget.setAttribute('aria-pressed', String(skeletonHelper.visible));
  });
  ui.statsToggle.addEventListener('click', () => {
    ui.stats.hidden = !ui.stats.hidden;
    ui.statsToggle.setAttribute('aria-pressed', String(!ui.stats.hidden));
  });

  // ------------------------------------------------------------------ perf monitor
  const perf = {
    frames: 0, time: 0, fps: 60, grace: 1.5, window: [],
    reset(grace) { this.frames = 0; this.time = 0; this.grace = grace || 0; },
    sample(dt) {
      if (this.grace > 0) { this.grace -= dt; return; }
      this.frames++; this.time += dt;
      if (this.time >= 2) {
        this.fps = this.frames / this.time;
        this.window.push(this.fps);
        if (this.window.length > 30) this.window.shift();
        this.frames = 0; this.time = 0;
        // step down when sustained frame rate is well under the display's cap.
        // iOS caps Safari at 60 (30 in Low Power Mode), so 50 is the trigger, not 60.
        if (this.fps < 50 && tier < TIERS.length - 1) { applyTier(tier + 1); this.reset(1); }
      }
    },
  };

  const report = { loadMs: 0, joints: 0 };
  $('copy-report').addEventListener('click', e => {
    const btn = e.currentTarget;
    const lines = [
      'SHADOW CELL Phase 1A test report',
      'Device/browser: ' + navigator.userAgent,
      'Screen: ' + screen.width + '×' + screen.height + ' @' + deviceDpr + 'x, viewport ' + window.innerWidth + '×' + window.innerHeight,
      'Orientation: ' + (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'),
      'GPU: ' + gpuName,
      'Quality tier: ' + TIERS[tier].name + ', render scale ' + renderer.getPixelRatio().toFixed(2),
      'FPS (last 2 s): ' + perf.fps.toFixed(1) + '; history: ' + perf.window.map(f => f.toFixed(0)).join(' '),
      'Draw calls: ' + renderer.info.render.calls + ', triangles: ' + renderer.info.render.triangles,
      'Model load: ' + (report.loadMs / 1000).toFixed(2) + ' s, joints: ' + report.joints,
    ].join('\n');
    const done = ok => { btn.textContent = ok ? 'COPIED' : 'SELECT & COPY BELOW'; setTimeout(() => { btn.textContent = 'COPY TEST REPORT'; }, 2000); };
    const fallback = () => {
      let pre = ui.stats.querySelector('pre');
      if (!pre) { pre = document.createElement('pre'); pre.style.cssText = 'white-space:pre-wrap;font-size:9px;margin:6px 0 0;-webkit-user-select:text;user-select:text;max-height:30vh;overflow:auto'; ui.stats.appendChild(pre); }
      pre.textContent = lines;
      const r = document.createRange(); r.selectNodeContents(pre);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      done(false);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(lines).then(() => done(true), fallback);
    else fallback();
  });

  // ------------------------------------------------------------------ loop
  const clock = new THREE.Clock();
  let statTimer = 0;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    updateOrbit(dt);
    if (mixer) mixer.update(dt);
    if (model) {
      // contact shadow follows the hips so it stays under the weight-bearing area
      if (hips) {
        const p = hips.getWorldPosition(tmpV);
        blob.position.x = p.x; blob.position.z = p.z;
      }
    }
    renderer.render(scene, camera);
    if (model) perf.sample(dt);
    statTimer += dt;
    if (statTimer > 0.5 && !ui.stats.hidden) {
      statTimer = 0;
      ui.st.fps.textContent = perf.fps.toFixed(0);
      ui.st.calls.textContent = renderer.info.render.calls;
      ui.st.tris.textContent = renderer.info.render.triangles.toLocaleString();
    }
  }
  const tmpV = new THREE.Vector3();

  // stop rendering entirely while the tab is hidden (battery)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) renderer.setAnimationLoop(null);
    else { clock.getDelta(); perf.reset(1); renderer.setAnimationLoop(frame); }
  });
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    renderer.setAnimationLoop(null);
    showError('Graphics were reset', 'iOS reclaimed the GPU (often after switching apps or low memory). Reload the page to continue.', false);
  });

  applyTier(0);
  orbit.goalDist = orbit.dist = fitDistance();
  orbit.targetY = orbit.goalTargetY = frameHeightForDist(orbit.dist);
  setView('front');
  orbit.yaw = orbit.goalYaw = 0.6;   // open slightly off-axis, then settle to the front
  orbit.goalYaw = 0;
  renderer.setAnimationLoop(frame);
  loadModel();

  window.SCViewer = { scene, renderer, camera, orbit, setView, playPose, perf, get tier() { return TIERS[tier].name; } };
})();
