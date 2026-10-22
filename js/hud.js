// SHADOW CELL — HUD: status bars, visibility/noise meters, alert state, minimap, prompts.
(function (SC) {
  'use strict';

  const H = SC.hud = {};
  const $ = id => document.getElementById(id);
  let els, mapCanvas, mapCtx, baseMap, toastTimer, frame = 0;
  const MAP_PX = 3;            // pixels per metre in the pre-rendered base map
  const MAP_SIZE = 200;

  H.init = function (player) {
    els = {
      name: $('op-name'), role: $('op-role'), hp: $('hp-bar').firstElementChild, stam: $('stam-bar').firstElementChild,
      stance: $('stance-label'), cover: $('cover-label'), alert: $('alert-state'), vis: $('vis-value'),
      visBar: $('vis-meter').firstElementChild, noiseBar: $('noise-meter').firstElementChild,
      prompt: $('prompt'), toast: $('toast'), action: $('btn-action'), stanceBtn: $('btn-stance'), fps: $('fps'),
    };
    els.name.textContent = player.def.name;
    els.role.textContent = player.def.role;
    mapCanvas = $('minimap');
    mapCtx = mapCanvas.getContext('2d');
    baseMap = renderBaseMap();
  };

  function renderBaseMap() {
    const W = SC.world, c = document.createElement('canvas');
    c.width = c.height = MAP_SIZE * MAP_PX;
    const g = c.getContext('2d');
    const toPx = v => (v + MAP_SIZE / 2) * MAP_PX;
    g.fillStyle = '#1d2716'; g.fillRect(0, 0, c.width, c.height);
    // vegetation density
    g.fillStyle = 'rgba(40,62,28,0.9)';
    for (const t of W.trees) { if (t.edge) continue; g.beginPath(); g.arc(toPx(t.x), toPx(t.z), (t.canopyR || 2) * MAP_PX * 0.8, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(90,110,50,0.55)';
    for (const p of W.grassPatches) { g.beginPath(); g.arc(toPx(p.x), toPx(p.z), p.r * MAP_PX, 0, 7); g.fill(); }
    // trails
    g.strokeStyle = 'rgba(150,125,85,0.85)'; g.lineWidth = 2.6 * MAP_PX; g.lineCap = g.lineJoin = 'round';
    for (const tr of W.trails) { g.beginPath(); tr.forEach((p, i) => i ? g.lineTo(toPx(p[0]), toPx(p[1])) : g.moveTo(toPx(p[0]), toPx(p[1]))); g.stroke(); }
    // compound
    const C = W.compound;
    g.fillStyle = 'rgba(110,105,85,0.55)'; g.fillRect(toPx(C.minX), toPx(C.minZ), (C.maxX - C.minX) * MAP_PX, (C.maxZ - C.minZ) * MAP_PX);
    g.fillStyle = 'rgba(200,195,160,0.9)';
    for (const b of W.boxes) if (b.tag !== 'fence') g.fillRect(toPx(b.minX), toPx(b.minZ), Math.max(2, (b.maxX - b.minX) * MAP_PX), Math.max(2, (b.maxZ - b.minZ) * MAP_PX));
    g.fillStyle = 'rgba(180,180,170,0.9)';
    for (const b of W.boxes) if (b.tag === 'fence') g.fillRect(toPx(b.minX), toPx(b.minZ), Math.max(2, (b.maxX - b.minX) * MAP_PX), Math.max(2, (b.maxZ - b.minZ) * MAP_PX));
    for (const t of W.towers) { g.strokeStyle = '#d8cfa8'; g.lineWidth = 2; g.strokeRect(toPx(t.x) - 5, toPx(t.z) - 5, 10, 10); }
    // points of interest
    const e = W.poi.extraction;
    g.strokeStyle = '#9fd06a'; g.lineWidth = 3; g.beginPath(); g.arc(toPx(e.x), toPx(e.z), e.r * MAP_PX, 0, 7); g.stroke();
    g.fillStyle = '#9fd06a'; g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('LZ', toPx(e.x), toPx(e.z));
    return c;
  }

  function drawMinimap(player, cam) {
    const g = mapCtx, S = mapCanvas.width, view = 70; // metres shown across
    const scale = S / view;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, 7); g.clip();
    g.fillStyle = '#10160c'; g.fillRect(0, 0, S, S);
    // rotate so camera-forward is up
    g.translate(S / 2, S / 2);
    g.rotate(cam.yaw);
    const sx = (player.pos.x + MAP_SIZE / 2) * MAP_PX, sz = (player.pos.z + MAP_SIZE / 2) * MAP_PX;
    g.scale(scale / MAP_PX, scale / MAP_PX);
    g.drawImage(baseMap, -sx, -sz);
    g.restore();
    // player arrow (facing relative to camera)
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(-(player.yaw - cam.yaw) + Math.PI);
    g.fillStyle = '#e8e0b8';
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill();
    g.restore();
    // north tick
    g.save(); g.translate(S / 2, S / 2); g.rotate(cam.yaw);
    g.fillStyle = '#d4462f'; g.font = 'bold 18px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', 0, -S / 2 + 14);
    g.restore();
  }

  H.toast = function (msg, ms) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms || 2200);
  };

  H.setAlert = function (state) {
    els.alert.textContent = state.toUpperCase();
    els.alert.className = state === 'normal' ? '' : state;
  };

  H.update = function (dt, player, cam, fps) {
    frame++;
    els.hp.style.width = (player.hp * 100).toFixed(0) + '%';
    els.stam.style.width = (player.stamina * 100).toFixed(0) + '%';
    const stanceTxt = player.hug ? 'COVER' : player.stance.toUpperCase();
    if (els.stance.textContent !== stanceTxt) els.stance.textContent = stanceTxt;
    els.stanceBtn.textContent = player.stance === 'stand' ? 'CROUCH' : player.stance === 'crouch' ? 'STAND' : 'CRAWL';

    const c = player.conceal;
    const cover = c.bush > 0.3 ? 'IN BUSH' : c.grass > 0.3 ? 'TALL GRASS' : c.lit > 0.3 ? 'LIT AREA' : c.shade > 0.3 ? 'SHADE' : '';
    if (els.cover.textContent !== cover) els.cover.textContent = cover;

    const v = Math.round(player.visibility * 100);
    els.vis.textContent = v;
    const col = v < 30 ? 'var(--signal)' : v < 60 ? 'var(--caution)' : 'var(--alert)';
    els.vis.style.color = col;
    els.visBar.style.width = v + '%';
    els.visBar.style.background = col;
    els.noiseBar.style.width = Math.round(player.noise * 100) + '%';

    const ctx = player.context;
    const label = ctx ? ctx.label : '';
    if (els.prompt.textContent !== label) { els.prompt.textContent = label; els.prompt.classList.toggle('show', !!label); }
    els.action.classList.toggle('dim', !ctx);
    els.action.textContent = ctx ? (ctx.type === 'release' ? 'LEAVE' : ctx.type === 'hug' ? 'COVER' : 'CHECK') : 'ACTION';

    if (frame % 3 === 0) drawMinimap(player, cam);
    if (frame % 30 === 0 && fps) els.fps.textContent = fps.toFixed(0) + ' FPS';
  };
})(window.SC);
