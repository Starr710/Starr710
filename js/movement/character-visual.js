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
    leftHand: /(left_?hand|hand_?l)$/i,
    rightHand: /(right_?hand|hand_?r)$/i,
  };
  // finger chains: <Left|Right>Hand<Thumb|Index|Middle|Ring|Pinky><1..3>
  const FINGER = /(left|right)_?hand_?(thumb|index|middle|ring|pinky)_?([123])$/i;

  mv.CHARACTER_PROFILES = {
    // Temporary playable character: Mixamo "Vanguard" mocap rig from the three.js examples.
    testSoldier: {
      url: 'assets/characters/test-soldier.glb',
      forwardYaw: Math.PI,          // this file faces -Z; the controller's forward is +Z
      clips: { idle: 'idle', walk: 'walk', run: 'run' },
      inPlace: true,                // strip any horizontal hips drift from clips
      materialFix: { roughness: 0.8 },
    },
  };

  mv.CharacterVisual = function (profile) {
    this.profile = profile;
    this.root = new THREE.Group();       // placed by the motor (position + yaw)
    this.lean = new THREE.Group();       // procedural body lean, pivots at the feet
    this.pivot = new THREE.Group();      // static correction of the asset's forward axis
    this.root.add(this.lean);
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
      const done = gltf => { try { this._setup(gltf); resolve(this); } catch (e) { reject(e); } };
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
        if (m && p.materialFix) { if (p.materialFix.roughness != null) m.roughness = Math.max(m.roughness, p.materialFix.roughness); m.metalness = 0; }
      }
      if (o.isBone) {
        for (const k in BONE_PATTERNS) if (!this.bones[k] && BONE_PATTERNS[k].test(o.name)) this.bones[k] = o;
        const f = FINGER.exec(o.name);
        if (f) (this.fingers[f[1].toLowerCase()] = this.fingers[f[1].toLowerCase()] || []).push({ bone: o, finger: f[2].toLowerCase(), seg: +f[3] });
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
    for (const k of ['idle', 'walk', 'run']) if (!this.clips[k]) throw new Error('Character is missing a "' + k + '" animation clip');

    if (p.inPlace) for (const k in this.clips) if (this.clips[k]) this._stripRootMotion(this.clips[k]);
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

  mv.CharacterVisual.prototype.place = function (position, yaw) {
    this.root.position.copy(position);
    this.root.rotation.y = yaw;
  };
})(SC.mv);
