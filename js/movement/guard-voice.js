// SHADOW CELL — guard voice (Step 8): a replaceable hook for short vocal reactions.
// The awareness asks for a line ('huh': a quiet questioning sound on the first sound
// of a new incident) and this plays one of its recordings, at a configurable volume,
// softer with distance from the listener, with a tiny pitch variation. No recording
// ships yet: until files exist at the paths below every request is logged (and shown
// in the STATS panel) but nothing plays. No synthesized voice stands in for it.
// To add the recording: put short mono clips (m4a/mp3/wav, ~0.3–0.6 s, a natural
// under-the-breath "huh?") at these paths, or set lines.huh to other URLs.
(function (mv) {
  'use strict';

  mv.GuardVoiceDefaults = {
    lines: { huh: ['assets/audio/guard/huh-1.m4a', 'assets/audio/guard/huh-2.m4a'] },
    volume: 0.7,           // master volume of the guard's voice (separate from footsteps)
    falloff: 8,            // m: gain = volume / (1 + distance / falloff)
    pitchJitter: 0.03,     // ± playback-rate variation between plays
  };

  // getCtx(): the page's running AudioContext, or null until audio is unlocked
  mv.GuardVoice = function (getCtx, opts) {
    this.cfg = Object.assign({}, mv.GuardVoiceDefaults, opts || {});
    this.getCtx = getCtx;
    this.data = {};        // line → [ArrayBuffer] fetched
    this.buffers = {};     // line → [AudioBuffer] decoded
    this.missing = {};     // line → true when none of its files could be loaded
    this.log = [];         // every request: { line, time, played, why }
    this.n = 0;
    for (const line in this.cfg.lines) this._fetch(line);
  };

  mv.GuardVoice.prototype._fetch = function (line) {
    const urls = this.cfg.lines[line] || [];
    if (!urls.length || typeof fetch !== 'function') { this.missing[line] = true; return; }
    Promise.all(urls.map(u => fetch(u).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null))).then(list => {
      this.data[line] = list.filter(Boolean);
      if (!this.data[line].length) this.missing[line] = true;
    });
  };

  // decode the fetched files once a context exists
  mv.GuardVoice.prototype._decoded = function (line, ctx) {
    if (this.buffers[line] || !this.data[line] || !this.data[line].length) return this.buffers[line] || null;
    const raw = this.data[line]; this.data[line] = null; this.buffers[line] = [];
    raw.forEach(ab => ctx.decodeAudioData(ab, b => this.buffers[line].push(b), () => {}));
    return this.buffers[line];
  };

  // say a line from `from` (where he stands), heard at `listener` (the player)
  mv.GuardVoice.prototype.say = function (line, from, listener) {
    const c = this.cfg, ctx = this.getCtx && this.getCtx(), rec = { line, time: performance.now() / 1000, played: false, why: '' };
    this.log.push(rec); if (this.log.length > 50) this.log.shift();
    if (this.missing[line]) { rec.why = 'no recording yet'; return rec; }
    if (!ctx || ctx.state !== 'running') { rec.why = 'audio not started'; return rec; }
    const bufs = this._decoded(line, ctx);
    if (!bufs || !bufs.length) { rec.why = 'still loading'; return rec; }
    const d = from && listener ? Math.hypot(from.x - listener.x, from.z - listener.z) : 0;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = bufs[this.n++ % bufs.length];
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * c.pitchJitter;
    g.gain.value = c.volume / (1 + d / c.falloff);
    src.connect(g); g.connect(ctx.destination); src.start();
    rec.played = true; return rec;
  };

  // short status for the developer view
  mv.GuardVoice.prototype.status = function () {
    const n = this.log.length, last = this.log[n - 1];
    if (!n) return Object.keys(this.missing).length ? 'quiet · no recording yet (hook ready)' : 'quiet';
    return `"${last.line}" ×${n}` + (last.played ? ' · played' : ' · ' + last.why);
  };
})(SC.mv);
