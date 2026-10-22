// SHADOW CELL — bootstrap, render loop, menus and quality scaling.
(function (SC) {
  'use strict';

  const G = SC.game = { running: false, paused: false, time: 0, quality: 'high' };
  let renderer, scene, camera, sun, followCam, player, clock;
  let fpsAvg = 60, perfWatch = 0;

  function readQuality() { try { return localStorage.getItem('sc.quality') || 'high'; } catch (e) { return 'high'; } }
  function saveQuality(q) { try { localStorage.setItem('sc.quality', q); } catch (e) { /* storage unavailable */ } }

  function applyQuality(q) {
    G.quality = q;
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 1.6) : Math.min(dpr, 1));
    renderer.shadowMap.enabled = q === 'high';
    sun.castShadow = q === 'high';
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    document.getElementById('quality-btn').textContent = 'QUALITY: ' + q.toUpperCase();
    resize();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function init() {
    const container = document.getElementById('game');
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    const fogColor = new THREE.Color(0x56664f);
    scene.background = fogColor;
    scene.fog = new THREE.FogExp2(fogColor, 0.021);

    camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 120);

    // overcast late-afternoon light filtering through canopy
    scene.add(new THREE.HemisphereLight(0xc4d4b0, 0x3a3524, 1.0));
    sun = new THREE.DirectionalLight(0xffe2b0, 1.05);
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera; sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0015;
    sun.shadow.normalBias = 0.02;
    scene.add(sun); scene.add(sun.target);
    scene.add(new THREE.AmbientLight(0x3a4a32, 0.25));

    SC.world.build(scene);
    // instanced vegetation spans the whole map; its bounds are not per-instance, so skip culling
    scene.traverse(o => { if (o.isInstancedMesh) o.frustumCulled = false; });
    player = new SC.Player(scene, 'ghost');
    followCam = new SC.FollowCam(camera);
    followCam.snapBehind(player);

    SC.input.init();
    SC.hud.init(player);
    G.player = player; G.camera = followCam; G.scene = scene; G.renderer = renderer;

    applyQuality(readQuality());
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 250));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { if (document.hidden && G.running) pause(true); });

    wireMenus();
    clock = new THREE.Clock();
    renderer.setAnimationLoop(loop);
  }

  function wireMenus() {
    const start = document.getElementById('start-screen');
    const deploy = () => {
      SC.audio.start();
      start.classList.add('hidden');
      document.getElementById('hud').classList.remove('hidden');
      document.getElementById('controls').classList.remove('hidden');
      G.running = true;
      SC.input.enabled = true;
      perfWatch = 0;
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      SC.hud.toast('INSERTION COMPLETE · MOVE NORTH TO THE OUTPOST', 3200);
    };
    document.getElementById('deploy-btn').addEventListener('click', deploy);
    document.getElementById('resume-btn').addEventListener('click', () => pause(false));
    document.getElementById('quality-btn').addEventListener('click', () => { const q = G.quality === 'high' ? 'low' : 'high'; applyQuality(q); saveQuality(q); });
    document.getElementById('audio-btn').addEventListener('click', e => { SC.audio.setOn(!SC.audio.on); e.target.textContent = 'AUDIO: ' + (SC.audio.on ? 'ON' : 'OFF'); });
    document.getElementById('restart-btn').addEventListener('click', () => { player.reset(); followCam.snapBehind(player); pause(false); });
    document.querySelectorAll('#squad-menu button').forEach(b => b.addEventListener('click', () => {
      SC.hud.toast('SQUAD ORDER "' + b.dataset.cmd.toUpperCase() + '" · AVAILABLE IN PHASE 4');
      document.getElementById('squad-menu').classList.remove('open');
    }));
  }

  function pause(on) {
    G.paused = on;
    SC.input.enabled = !on;
    SC.input.clear();
    document.getElementById('btn-sprint').classList.remove('on');
    document.getElementById('pause-menu').classList.toggle('hidden', !on);
    if (!on) SC.audio.start();
  }
  G.pause = pause;

  function handleUiEvents() {
    const I = SC.input;
    if (I.consume('pause')) pause(true);
    if (I.consume('squad')) document.getElementById('squad-menu').classList.toggle('open');
    if (I.consume('takedown')) SC.hud.toast('NO TARGET IN REACH · GUARDS ARRIVE IN PHASE 2');
  }

  function loop() {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    G.time += dt;
    fpsAvg = SC.lerp(fpsAvg, 1 / Math.max(dt, 1e-3), 0.05);

    if (G.running && !G.paused) {
      handleUiEvents();
      player.update(dt, SC.input, followCam);
      followCam.update(dt, player, SC.input);
      SC.hud.update(dt, player, followCam, fpsAvg);
      SC.audio.update(dt);

      // auto-downgrade on slow devices during the first seconds of play
      perfWatch += dt;
      if (G.quality === 'high' && perfWatch > 4 && perfWatch < 8 && fpsAvg < 32) {
        applyQuality('low'); saveQuality('low');
        SC.hud.toast('QUALITY LOWERED FOR SMOOTHER PLAY');
        perfWatch = 99;
      }
    } else if (!G.running) {
      // title screen: slow orbit around the insertion point
      followCam.yaw += dt * 0.08;
      followCam.update(dt, player, SC.input);
    }

    // keep the shadow frustum centred on the operative
    sun.position.set(player.pos.x + 22, player.pos.y + 40, player.pos.z + 14);
    sun.target.position.copy(player.pos);

    // hide roofs while the operative is indoors
    const inside = SC.world.insideRoof(player.pos.x, player.pos.z);
    for (const r of SC.world.roofs) r.mesh.visible = r !== inside;

    SC.world.update(G.time);
    renderer.render(scene, camera);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.SC);
