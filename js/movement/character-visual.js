// SHADOW CELL — movement: the character's visual model.
// Loads any skinned humanoid GLB described by a profile (see
// docs/CHARACTER_CONTROLLER.md) and exposes a mesh-independent surface to the
// rest of the controller: a root to place, a mixer, named clips, and canonical
// bones. Swapping the operative later means writing a new profile, nothing more.
(function (mv) {
  'use strict';

  // Canonical bone → name patterns (Mixamo with or without the "mixamorig:" prefix,
  // MakeHuman game rig, Unity/Unreal-style names).
  const BONE_PATTERNS = {
    hips: /(hips|pelvis)$/i,
    spine: /spine(_?0?1)?$/i,
    chest: /(spine2|spine_?03|upper_?chest|chest)$/i,
    neck: /neck(_?01)?$/i,
    head: /head$/i,
    leftFoot: /(left_?foot|foot_?l)$/i,
    rightFoot: /(right_?foot|foot_?r)$/i,
    leftToe: /(left_?toe_?base|ball_?l|toe_?l)$/i,
    rightToe: /(right_?toe_?base|ball_?r|toe_?r)$/i,
    spine1: /spine_?0?1$/i,
    leftShoulder: /(left_?shoulder|clavicle_?l)$/i,
    rightShoulder: /(right_?shoulder|clavicle_?r)$/i,
    leftArm: /(left_?arm|upper_?arm_?l)$/i,
    rightArm: /(right_?arm|upper_?arm_?r)$/i,
    leftForeArm: /(left_?fore_?arm|lower_?arm_?l)$/i,
    rightForeArm: /(right_?fore_?arm|lower_?arm_?r)$/i,
    leftUpLeg: /(left_?up_?leg|thigh_?l)$/i,
    rightUpLeg: /(right_?up_?leg|thigh_?r)$/i,
    leftLeg: /(left_?leg|calf_?l|shin_?l)$/i,
    rightLeg: /(right_?leg|calf_?r|shin_?r)$/i,
    leftHand: /(left_?hand|hand_?l)$/i,
    rightHand: /(right_?hand|hand_?r)$/i,
  };
  // finger chains: <Left|Right>Hand<Thumb|Index|Middle|Ring|Pinky><1..3>
  const FINGER = /(left|right)_?hand_?(thumb|index|middle|ring|pinky)_?([123])$/i;

  // Rigify DEF-* skeleton (Quaternius UAL). three.js strips "." from node names,
  // so "DEF-thigh.L" arrives as "DEF-thighL" and "DEF-spine.001" as "DEF-spine001".
  const RIGIFY_BONES = {
    hips: 'DEF-hips', spine: 'DEF-spine001', spine1: 'DEF-spine002', chest: 'DEF-spine003', neck: 'DEF-neck', head: 'DEF-head',
    leftShoulder: 'DEF-shoulderL', rightShoulder: 'DEF-shoulderR',
    leftArm: 'DEF-upper_armL', rightArm: 'DEF-upper_armR', leftForeArm: 'DEF-forearmL', rightForeArm: 'DEF-forearmR',
    leftHand: 'DEF-handL', rightHand: 'DEF-handR',
    leftUpLeg: 'DEF-thighL', rightUpLeg: 'DEF-thighR', leftLeg: 'DEF-shinL', rightLeg: 'DEF-shinR',
    leftFoot: 'DEF-footL', rightFoot: 'DEF-footR', leftToe: 'DEF-toeL', rightToe: 'DEF-toeR',
  };
  // DEF-f_index01L / DEF-thumb01L → side, finger, segment
  const RIGIFY_FINGER = /^DEF-(?:f_)?(thumb|index|middle|ring|pinky)0([123])(L|R)$/;

  mv.CHARACTER_PROFILES = {
    // Temporary playable character: Quaternius "Universal Animation Library" mannequin (CC0),
    // with real mocap-style idle, walk, jog, sprint, crouch idle and crouch walk.
    mannequin: {
      url: 'assets/characters/ual-mannequin.glb',
      forwardYaw: 0,
      bones: RIGIFY_BONES,
      fingerPattern: RIGIFY_FINGER,
      // (its Sprint_Loop's foot contacts don't match any ground speed, so the long-
      // striding jog clip doubles as the sprint at full stride)
      clips: { idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', crouchIdle: 'Crouch_Idle_Loop', crouchWalk: 'Crouch_Fwd_Loop' },
      inPlace: true,
      materialFix: { roughness: 0.75, color: 0x6b6f5a },
      // natural ground speed of each clip (m/s), found by a foot-slip sweep; the
      // stylized jog and sprint take long strides, so they're shortened in play
      // clip ground speeds (m/s) as played here, fitted by a foot-slip sweep through
      // the full controller; sneak takes shorter steps than the stealth walk
      strideSpeeds: { walk: 1.13, run: 5.6, crouchWalk: 0.75 },
      // the long stylized jog strides are shortened by the leg layer; playback rates
      // land at ~0.94 sneak, ~1.26 stealth walk, ~0.92 jog, ~1.0 sprint
      strideScale: [[0, 0.85], [1.0, 0.85], [1.45, 1.05], [2.2, 0.8], [3.2, 0.62], [4.4, 0.82], [5.6, 1.0]],
      blend: { walkToRun: [1.6, 3.0], runToSprint: [3.8, 5.3] },
    },
    // Temporary playable character: Mixamo "Vanguard" mocap rig from the three.js examples.
    testSoldier: {
      url: 'assets/characters/test-soldier.glb',
      forwardYaw: Math.PI,          // this file faces -Z; the controller's forward is +Z
      clips: { idle: 'idle', walk: 'walk', run: 'run', crouchIdle: 'Crouch_Idle_Loop', crouchWalk: 'Crouch_Fwd_Loop' },
      // crouch clips retargeted from the CC0 Quaternius library (tools/retarget.html)
      extraClips: 'assets/characters/test-soldier-crouch.json',
      inPlace: true,                // strip any horizontal hips drift from clips
      materialFix: { roughness: 0.8 },
      // walk → run blend (m/s): the 2.4 m/s stealth walk stays on the walk clip (~80/20
      // otherwise, which slid the planted foot on stopping); the 3.8 m/s jog is all run
      blend: { walkToRun: [2.2, 3.8], runToSprint: [3.8, 5.3] },
    },
  };

  mv.CharacterVisual = function (profile) {
    this.profile = profile;
    this.root = new THREE.Group();       // placed by the motor (position + yaw)
    this.fall = new THREE.Group();       // whole-body pose when she's defeated (identity otherwise; as the guards' fall group)
    this.lean = new THREE.Group();       // procedural body lean, pivots at the feet
    this.pivot = new THREE.Group();      // static correction of the asset's forward axis
    this.root.add(this.fall); this.fall.add(this.lean);
    this.lean.add(this.pivot);
    this.pivot.rotation.y = profile.forwardYaw || 0;
    this.model = null;
    this.mixer = null;
    this.clips = {};
    this.bones = {};
    this.fingers = {};
    this.skinned = [];
  };

  mv.CharacterVisual.prototype.load = function (onProgress) {
    const p = this.profile;
    return new Promise((resolve, reject) => {
      const loader = new THREE.GLTFLoader();
      if (window.MeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
      const setup = gltf => { try { this._setup(gltf); resolve(this); } catch (e) { reject(e); } };
      const done = gltf => {
        const extra = window.SC_EXTRA_CLIPS_URL || p.extraClips;
        if (!extra) return setup(gltf);
        new THREE.FileLoader().load(extra, text => {
          try { JSON.parse(text).forEach(j => gltf.animations.push(THREE.AnimationClip.parse(j))); } catch (e) { return reject(e); }
          setup(gltf);
        }, null, reject);
      };
      const url = window.SC_CHARACTER_URL || p.url;
      if (/\.b64\.txt$/.test(url)) {
        // text-only hosts get the GLB as base64
        new THREE.FileLoader().load(url, text => {
          try {
            const bin = atob(text.trim()), buf = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            loader.parse(buf.buffer, '', done, reject);
          } catch (e) { reject(e); }
        }, onProgress, reject);
      } else loader.load(url, done, onProgress, reject);
    });
  };

  mv.CharacterVisual.prototype._setup = function (gltf) {
    const p = this.profile;
    const model = this.model = gltf.scene;
    model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false;          // skinned bounds don't follow the animated pose
        if (o.isSkinnedMesh) this.skinned.push(o);
        const m = o.material;
        if (m && p.materialFix) {
          if (p.materialFix.roughness != null) m.roughness = Math.max(m.roughness, p.materialFix.roughness);
          if (p.materialFix.color != null && m.color) m.color.setHex(p.materialFix.color);
          m.metalness = 0;
        }
      }
      if (o.isBone) {
        if (p.bones) { for (const k in p.bones) if (p.bones[k] === o.name) this.bones[k] = o; }
        else for (const k in BONE_PATTERNS) if (!this.bones[k] && BONE_PATTERNS[k].test(o.name)) this.bones[k] = o;
        if (p.fingerPattern) {
          const f = p.fingerPattern.exec(o.name);
          if (f) { const side = f[3] === 'L' ? 'left' : 'right'; (this.fingers[side] = this.fingers[side] || []).push({ bone: o, finger: f[1], seg: +f[2] }); }
        } else {
          const f = FINGER.exec(o.name);
          if (f) (this.fingers[f[1].toLowerCase()] = this.fingers[f[1].toLowerCase()] || []).push({ bone: o, finger: f[2].toLowerCase(), seg: +f[3] });
        }
      }
    });
    for (const k of ['hips', 'leftFoot', 'rightFoot']) if (!this.bones[k]) throw new Error('Character rig is missing a "' + k + '" bone');
    this.pivot.add(model);

    // clips by role; fall back to name search
    const byName = {};
    gltf.animations.forEach(c => { byName[c.name.toLowerCase()] = c; });
    const pick = (role, re) => byName[(p.clips[role] || '').toLowerCase()] || gltf.animations.find(c => re.test(c.name));
    this.clips.idle = pick('idle', /idle/i);
    this.clips.walk = pick('walk', /walk/i);
    this.clips.run = pick('run', /run|jog/i);
    if (p.clips.sprint) this.clips.sprint = pick('sprint', /sprint/i);
    if (p.clips.crouchIdle) this.clips.crouchIdle = pick('crouchIdle', /crouch.*idle/i);
    if (p.clips.crouchWalk) this.clips.crouchWalk = pick('crouchWalk', /crouch.*(fwd|walk)/i);
    for (const k of ['idle', 'walk', 'run']) if (!this.clips[k]) throw new Error('Character is missing a "' + k + '" animation clip');

    if (p.inPlace) for (const k in this.clips) if (this.clips[k]) this._stripRootMotion(this.clips[k]);
    // mocap at 30 keys/s with linear blending shows kinks at each key, worst when
    // a gait is slowed down for sneaking; resample on splines and smooth lightly
    const smoothing = p.clipSmoothing || { fps: 60, sigma: 1.3 };
    for (const k in this.clips) if (this.clips[k]) mv.smoothLoopClip(this.clips[k], smoothing.fps, smoothing.sigma);
    this.mixer = new THREE.AnimationMixer(model);
  };

  // Remove horizontal hips translation so clips play in place; keep the vertical bob.
  mv.CharacterVisual.prototype._stripRootMotion = function (clip) {
    const hipsName = this.bones.hips.name;
    for (const track of clip.tracks) {
      if (track.name !== hipsName + '.position') continue;
      const v = track.values;
      // the hips bone's parent may be rotated (Z-up exports); detect the vertical axis
      // as the component with the largest absolute value at rest and keep only that one
      const axes = [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])];
      const up = axes.indexOf(Math.max.apply(null, axes));
      const rest = [v[0], v[1], v[2]];
      for (let i = 0; i < v.length; i += 3) for (let a = 0; a < 3; a++) if (a !== up) v[i + a] = rest[a];
    }
  };

  // Resample every track of a looping clip at `fps` with Catmull-Rom splines,
  // then apply a cyclic Gaussian blur of `sigma` frames. Quaternions are kept
  // on one hemisphere before filtering and renormalized after.
  mv.smoothLoopClip = function (clip, fps, sigma) {
    const T = clip.duration;
    if (!(T > 0)) return clip;
    const N = Math.max(4, Math.round(T * fps));
    const times = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) times[i] = T * i / N;
    const R = Math.ceil(sigma * 3), ker = [];
    let ks = 0;
    for (let i = -R; i <= R; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); ker.push(w); ks += w; }
    for (let i = 0; i < ker.length; i++) ker[i] /= ks;
    clip.tracks = clip.tracks.map(track => {
      const src = track.times, vals = track.values, size = vals.length / src.length;
      if (src.length < 3) return track;
      const isQuat = size === 4 && /quaternion$/.test(track.name);
      // keys of one period (the last key repeats the first in a looping export)
      let K = src.length;
      if (Math.abs(src[K - 1] - T) < 1e-4 && K > 2) K--;
      const key = new Float32Array(K * size);
      for (let i = 0; i < K; i++) for (let c = 0; c < size; c++) key[i * size + c] = vals[i * size + c];
      if (isQuat) for (let i = 1; i < K; i++) {
        let d = 0; for (let c = 0; c < 4; c++) d += key[i * 4 + c] * key[(i - 1) * 4 + c];
        if (d < 0) for (let c = 0; c < 4; c++) key[i * 4 + c] *= -1;
      }
      const at = (i, c) => {
        let w = 0, j = i;
        while (j < 0) { j += K; w--; }
        while (j >= K) { j -= K; w++; }
        let v = key[j * size + c];
        // keep quaternion signs continuous across the wrap
        if (isQuat && w !== 0) { let d = 0; for (let q = 0; q < 4; q++) d += key[j * 4 + q] * key[(w > 0 ? K - 1 : 0) * 4 + q]; if (d < 0) v = -v; }
        return v;
      };
      const st = i => (i >= K ? src[i - K] + T : src[i]);
      const raw = new Float32Array(N * size);
      let seg = 0;
      for (let n = 0; n < N; n++) {
        const t = times[n];
        while (seg < K - 1 && st(seg + 1) <= t) seg++;
        const t0 = st(seg), t1 = st(seg + 1), u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        const u2 = u * u, u3 = u2 * u;
        for (let c = 0; c < size; c++) {
          const p0 = at(seg - 1, c), p1 = at(seg, c), p2 = at(seg + 1, c), p3 = at(seg + 2, c);
          raw[n * size + c] = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
        }
      }
      if (isQuat) for (let n = 1; n < N; n++) {
        let d = 0; for (let c = 0; c < 4; c++) d += raw[n * 4 + c] * raw[(n - 1) * 4 + c];
        if (d < 0) for (let c = 0; c < 4; c++) raw[n * 4 + c] *= -1;
      }
      const out = new Float32Array((N + 1) * size);
      for (let n = 0; n < N; n++) {
        for (let c = 0; c < size; c++) {
          let acc = 0;
          for (let k = -R; k <= R; k++) {
            const m = ((n + k) % N + N) % N;
            let v = raw[m * size + c];
            if (isQuat) { let d = 0; for (let q = 0; q < 4; q++) d += raw[m * 4 + q] * raw[n * 4 + q]; if (d < 0) v = -v; }
            acc += ker[k + R] * v;
          }
          out[n * size + c] = acc;
        }
        if (isQuat) { const o = n * 4, l = Math.hypot(out[o], out[o + 1], out[o + 2], out[o + 3]) || 1; for (let c = 0; c < 4; c++) out[o + c] /= l; }
      }
      // close the loop: last sample equals the first
      for (let c = 0; c < size; c++) out[N * size + c] = out[c];
      const Ctor = track.constructor;
      return new Ctor(track.name, times, out);
    });
    return clip;
  };

  mv.CharacterVisual.prototype.place = function (position, yaw) {
    this.root.position.copy(position);
    this.root.rotation.y = yaw;
  };
})(SC.mv);
