// SHADOW CELL — CQC throw: presentation only (Step 14). TEMPORARY, built for the stand-in
// soldier rig; replace this file with real throw / knockdown / get-up animations later.
// Gameplay (cqc-throw.js, guard-ko.js) decides what happens and when; this file only
// shows it, from the phase and progress it is handed.
// How it shows it: while a guard is down his clip pose is frozen (his animator stops) and
// becomes the base pose. His whole body is then turned as one piece about his hips (the
// `fall` group between his root and his model), with a few eased bone adjustments on top:
// arms out as he loses his balance, legs swept up, the head turned aside while he lies
// there, the trunk and knees bending to sit up and push himself back to his feet. The
// stand-in's idle is a staggered, side-on stance, so a "neutral" correction (trunk upright,
// legs and arms straight down, worked out once when he's frozen) is faded in as he goes
// over and out as he gets up: he lies flat. After each pose the lowest point of his skin
// (sampled) is checked against the ground: never below it, and pinned to it while he lies
// or gets up (no sinking, no floating).
// The player's side is a handful of numbers (how far she turns, how much her trunk twists
// and her arms work, whether she drops her hips) applied by cqc.js.
(function (mv) {
  'use strict';

  const D = Math.PI / 180;
  const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, k) => a + (b - a) * k;
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  mv.ThrowAnimDefaults = {
    lieClear: 0.005,         // m: his lowest point (skin) above the ground lying on his back
    offBalanceTilt: 14,      // ° he's tipped back onto his heels…
    offBalanceTwist: 0.4,    // …and this share of the turn so his back faces the landing
    overshoot: 8,            // ° past flat at impact, settling back (the slam)
    lift: 0.07,              // m his hips rise over her hip early in the throw
    sweep: 55,               // ° his legs are swept up at the height of the throw
    flail: [28, 60],         // ° his arms go out: losing balance, in the air
    lyingArms: 24,           // ° arms out from his sides lying there…
    lyingHead: 18,           // …head turned aside
    bounce: 0.035,           // m he bounces at impact
    // her side: share of the way she turns toward the throw, trunk twist, arm work
    player: { twist: [14, 32], shoulder: [48, 62, 30], elbow: [55, 38, 70] },
  };

  // bones adjusted on top of the frozen pose (parents before children) and the joints
  // checked against the ground
  const OVERLAY = ['spine', 'spine1', 'chest', 'neck', 'head', 'leftArm', 'rightArm', 'leftForeArm', 'rightForeArm', 'leftUpLeg', 'rightUpLeg', 'leftLeg', 'rightLeg'];
  const LOW = ['hips', 'spine', 'chest', 'neck', 'head', 'leftFoot', 'rightFoot', 'leftToe', 'rightToe', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftForeArm', 'rightForeArm'];
  // the neutral correction: [bone, its child (sets the direction)] → straight up (trunk) or down (limbs), parents first
  const NEUTRAL = [['spine', 'neck', 1], ['neck', 'head', 1], ['leftUpLeg', 'leftLeg', -1], ['rightUpLeg', 'rightLeg', -1], ['leftLeg', 'leftFoot', -1], ['rightLeg', 'rightFoot', -1],
    ['leftArm', 'leftForeArm', -1], ['rightArm', 'rightForeArm', -1], ['leftForeArm', 'leftHand', -1], ['rightForeArm', 'rightHand', -1]];
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _bq = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _ax = new THREE.Vector3(), _id = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
  const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

  mv.ThrowAnim = {
    cfg: mv.ThrowAnimDefaults,

    // hold his current clip pose as the base for everything that follows
    freeze(g) {
      if (g._frozen) return g._frozen;
      g.fall.position.set(0, 0, 0); g.fall.quaternion.identity();
      g.root.updateMatrixWorld(true);
      const base = new Map();
      for (const k of OVERLAY) if (g.bones[k]) base.set(g.bones[k], g.bones[k].quaternion.clone());
      const hipsW = g.bones.hips.getWorldPosition(new THREE.Vector3());
      const hipRest = g.root.worldToLocal(hipsW.clone());
      // the neutral correction for each bone, in his body's frame (applied one by one, then undone)
      const neutral = new Map(), bodyQ = g.root.getWorldQuaternion(new THREE.Quaternion()), inv = bodyQ.clone().invert();
      for (const [k, ck, up] of NEUTRAL) {
        const b = g.bones[k], ch = g.bones[ck]; if (!b || !ch) continue;
        const d = ch.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
        const qw = new THREE.Quaternion().setFromUnitVectors(d, new THREE.Vector3(0, up, 0));
        neutral.set(b, inv.clone().multiply(qw).multiply(bodyQ));
        b.parent.getWorldQuaternion(_pq).invert(); b.quaternion.premultiply(_pq.clone().multiply(qw).multiply(_pq.clone().invert())); b.updateMatrixWorld(true);
      }
      for (const [b, q] of base) b.quaternion.copy(q);
      g.root.updateMatrixWorld(true);
      g._frozen = { base, hipRest, hipsW, neutral, standClear: this.lowest(g) - g.position.y };
      return g._frozen;
    },
    // back to the clip pose (his animator takes over again)
    unfreeze(g) {
      if (!g._frozen) return;
      for (const [b, q] of g._frozen.base) b.quaternion.copy(q);
      g.fall.position.set(0, 0, 0); g.fall.quaternion.identity();
      g._frozen = null; g.root.updateMatrixWorld(true);
    },

    // the lowest point of his skin (every 7th vertex: ≈0.2 ms)
    lowest(g) {
      let m = Infinity;
      g.model.traverse(o => {
        if (!o.isSkinnedMesh) return;
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i += 7) { o.boneTransform(i, _v.fromBufferAttribute(pos, i)); _v.applyMatrix4(o.matrixWorld); if (_v.y < m) m = _v.y; }
      });
      if (m === Infinity) for (const k of LOW) { const b = g.bones[k]; if (b) m = Math.min(m, b.getWorldPosition(_v).y); }
      return m;
    },

    // p: { hips: world point (xz used; y unless pinned), tilt: rad backward (π/2 = on his back),
    //      bones: { name: [bend, twist, roll] ° about his body's lateral / vertical / forward axes },
    //      neutral: 0…1 how much of the neutral correction (straight trunk and limbs),
    //      clear: m, pin: true = lowest point exactly at `clear`, false = at least `clear` }
    pose(g, p) {
      const F = g._frozen; if (!F) return;
      g.place();
      const q = _q.setFromAxisAngle(AX.x, -(p.tilt || 0));
      // hips target in his root's frame (root: his position, turned by his yaw)
      const loc = _w.copy(p.hips).sub(g.root.position).applyAxisAngle(AX.y, -g.yaw);
      g.fall.quaternion.copy(q);
      g.fall.position.copy(F.hipRest).applyQuaternion(q).negate().add(loc);
      for (const [b, bq] of F.base) b.quaternion.copy(bq);
      g.root.updateMatrixWorld(true);
      // bone adjustments about his body axes (his facing, turned with the fall)
      g.root.getWorldQuaternion(_bq).multiply(q);
      const bones = p.bones || {}, nw = p.neutral || 0;
      for (const k of OVERLAY) {
        const a = bones[k], b = g.bones[k], n = nw > 0 && b ? F.neutral.get(b) : null;
        if (!b || (!n && (!a || (!a[0] && !a[1] && !a[2])))) continue;
        b.parent.getWorldQuaternion(_pq).invert();
        if (n) {   // body frame → world → his parent's frame
          const W = _qa.copy(_bq).multiply(_dq.copy(_id).slerp(n, nw)).multiply(_qb.copy(_bq).invert());
          b.quaternion.premultiply(_qb.copy(_pq).multiply(W).multiply(_qc.copy(_pq).invert()));
        }
        if (!a) { b.updateMatrixWorld(true); continue; }
        if (a[1]) b.quaternion.premultiply(_dq.setFromAxisAngle(_ax.copy(AX.y).applyQuaternion(_bq).applyQuaternion(_pq), a[1] * D));
        if (a[0]) b.quaternion.premultiply(_dq.setFromAxisAngle(_ax.copy(AX.x).applyQuaternion(_bq).applyQuaternion(_pq), a[0] * D));
        if (a[2]) b.quaternion.premultiply(_dq.setFromAxisAngle(_ax.copy(AX.z).applyQuaternion(_bq).applyQuaternion(_pq), a[2] * D));
        b.updateMatrixWorld(true);
      }
      // the ground
      const low = this.lowest(g) - g.position.y, want = p.clear != null ? p.clear : F.standClear;
      const dy = p.pin ? want - low : Math.max(0, want - low);
      if (Math.abs(dy) > 1e-6) { g.fall.position.y += dy; g.root.updateMatrixWorld(true); }
      g.downPose = { tilt: p.tilt || 0, lowest: low + dy };
    },

    // ---------------------------------------------------------------- the throw (guard)
    // thr: { S: where he stood, L: unit landing direction (his head ends that way), yaw0, yaw1,
    //        hipsOut: m from S to where his hips land, h0: his hips at the freeze (world) }
    // phase: 'offBalance' | 'throw' | 'impact' (k 0…1 through it), 'lying'
    guard(g, thr, phase, k) {
      const c = this.cfg, F = g._frozen; if (!F) return;
      const dyaw = wrap(thr.yaw1 - thr.yaw0), land = new THREE.Vector3(thr.S.x + thr.L.x * thr.hipsOut, 0, thr.S.z + thr.L.z * thr.hipsOut);
      const arms = a => ({ leftArm: [0, 0, a], rightArm: [0, 0, -a] });
      if (phase === 'offBalance') {
        const e = ease(k);
        g.yaw = thr.yaw0 + dyaw * c.offBalanceTwist * e;
        const f = g.forward(new THREE.Vector3());
        const hips = new THREE.Vector3(F.hipsW.x + f.x * 0.06 * e, F.hipsW.y - 0.03 * e, F.hipsW.z + f.z * 0.06 * e);
        this.pose(g, { hips, tilt: c.offBalanceTilt * D * e, bones: arms(c.flail[0] * e), pin: false });
        thr.hb = hips;
      } else if (phase === 'throw') {
        const e = ease(k), hb = thr.hb || F.hipsW;
        g.yaw = thr.yaw0 + dyaw * (c.offBalanceTwist + (1 - c.offBalanceTwist) * e);
        const tilt = c.offBalanceTilt + (90 + c.overshoot - c.offBalanceTilt) * Math.pow(k, 1.5);
        const y = hb.y + (0.15 - hb.y) * k * k + c.lift * Math.sin(Math.PI * k);
        const hips = new THREE.Vector3(lerp(hb.x, land.x, e), y, lerp(hb.z, land.z, e));
        const sw = -c.sweep * Math.sin(Math.PI * Math.min(1, k * 1.15));
        const b = arms(lerp(c.flail[0], c.flail[1], e)); b.leftUpLeg = [sw, 0, 0]; b.rightUpLeg = [sw * 0.8, 0, 0];
        this.pose(g, { hips, tilt: tilt * D, bones: b, neutral: e, clear: c.lieClear, pin: false });
      } else if (phase === 'impact') {
        const e = ease(k), b = arms(lerp(c.flail[1], c.lyingArms, e)); b.head = [0, c.lyingHead * e, 0];
        this.pose(g, { hips: land, tilt: (90 + c.overshoot * (1 - e)) * D, bones: b, neutral: 1, clear: c.lieClear + c.bounce * Math.sin(Math.PI * k), pin: true });
      } else this.lying(g);
    },

    // ---------------------------------------------------------------- shot down (Step 20)
    // Not a throw: he buckles where he stands (knees give, hips drop, arms go slack), then
    // tips over the way the shot pushed him (back: onto his back; forward: onto his front),
    // hips moving only a little (C.to), and settles. C: { S, back (+1 / −1), fall, to }; k 0…1
    collapse(g, C, k) {
      const c = this.cfg, F = g._frozen; if (!F) return;
      const s = C.back, h0 = F.hipsW.y;
      const buckle = ease(Math.min(1, k / 0.45)), top = ease(Math.max(0, (k - 0.35) / 0.55)), settle = Math.max(0, (k - 0.9) / 0.1);
      const kneel = 0.42 * h0;   // hips dropped this much by the buckle
      const hips = new THREE.Vector3(lerp(C.S.x, C.to.x, top) + (F.hipsW.x - C.S.x) * (1 - top), lerp(h0 - kneel * buckle, 0.15, top), lerp(C.S.z, C.to.z, top) + (F.hipsW.z - C.S.z) * (1 - top));
      // (C.kneel, the player's defeat: her knees stay bent through the fall, so she goes down onto knees and chest)
      const slump = C.kneel ? buckle * (1 - top * top * top) : buckle * (1 - top);
      const b = { spine: [12 * slump, 0, 0], spine1: [10 * slump, 0, 0], chest: [8 * slump, 0, 0], head: [16 * buckle * (1 - top), c.lyingHead * top * s, 0],
        leftUpLeg: [-48 * slump, 0, 0], rightUpLeg: [-44 * slump, 0, 0], leftLeg: [75 * slump, 0, 0], rightLeg: [70 * slump, 0, 0],
        leftArm: [6 * buckle, 0, 10 * buckle * (1 - top) + c.lyingArms * top], rightArm: [6 * buckle, 0, -10 * buckle * (1 - top) - c.lyingArms * top] };
      const clear = c.lieClear + 0.02 * Math.sin(Math.PI * settle);
      this.pose(g, { hips, tilt: s * (Math.PI / 2) * top, bones: b, neutral: top, clear, pin: top > 0.98 });
      // going over, his body comes down onto the ground progressively (never hanging in the air)
      const w = C.kneel ? ease((top - 0.1) / 0.45) : ease((top - 0.35) / 0.55), over = g.downPose.lowest - clear;
      if (w > 0 && over > 0) { g.fall.position.y -= over * w; g.root.updateMatrixWorld(true); g.downPose.lowest -= over * w; }
    },
    // face down (shot from behind), the counterpart of lying()
    lyingFront(g) {
      const c = this.cfg, b = { leftArm: [0, 0, c.lyingArms], rightArm: [0, 0, -c.lyingArms], head: [0, -c.lyingHead, 0] };
      this.pose(g, { hips: g.position, tilt: -Math.PI / 2, bones: b, neutral: 1, clear: c.lieClear, pin: true });
    },

    // still on the ground: one fixed pose (no breathing, no drift)
    lying(g, extra) {
      const c = this.cfg, b = { leftArm: [0, 0, c.lyingArms], rightArm: [0, 0, -c.lyingArms], head: [0, c.lyingHead, 0] };
      if (extra) for (const k in extra) b[k] = extra[k];
      this.pose(g, { hips: g.position, tilt: Math.PI / 2, bones: b, neutral: 1, clear: c.lieClear, pin: true });
    },

    // ---------------------------------------------------------------- getting up (guard)
    // phase: 'stirring' | 'sittingUp' | 'rising'; k 0…1; to: where he stands (world, rising only)
    wake(g, phase, k, to) {
      const c = this.cfg, F = g._frozen; if (!F) return;
      if (phase === 'stirring') {
        const s = Math.sin(Math.PI * 2 * k * 1.5) * Math.sin(Math.PI * k);
        this.lying(g, { head: [0, c.lyingHead * (1 - ease(k)) + 7 * s, 0], leftArm: [0, 0, c.lyingArms + 8 * s], rightArm: [0, 0, -c.lyingArms + 4 * s],
          leftUpLeg: [-10 * Math.sin(Math.PI * k), 0, 0], leftLeg: [18 * Math.sin(Math.PI * k), 0, 0] });
        return;
      }
      const sit = phase === 'sittingUp' ? ease(k) : 1, up = phase === 'rising' ? ease(k) : 0, bend = sit * (1 - up);
      // trunk forward over his legs, knees drawn up, hands back toward the ground to push
      const b = { spine: [28 * bend, 0, 0], spine1: [26 * bend, 0, 0], chest: [20 * bend, 0, 0], neck: [-8 * bend, 0, 0],
        leftUpLeg: [-42 * bend, 0, 0], rightUpLeg: [-38 * bend, 0, 0], leftLeg: [85 * bend, 0, 0], rightLeg: [80 * bend, 0, 0],
        leftArm: [-20 * bend, 0, c.lyingArms * (1 - sit) + 12 * bend], rightArm: [-20 * bend, 0, -c.lyingArms * (1 - sit) - 12 * bend] };
      const end = to || g.position, hipEnd = new THREE.Vector3(F.hipRest.x, 0, F.hipRest.z).applyAxisAngle(AX.y, g.yaw).add(end);
      const hips = new THREE.Vector3(lerp(g.position.x, hipEnd.x, up), 0, lerp(g.position.z, hipEnd.z, up));
      this.pose(g, { hips, tilt: Math.PI / 2 * (1 - up), bones: b, neutral: 1 - up, clear: lerp(c.lieClear, F.standClear, up), pin: true });
    },

    // ---------------------------------------------------------------- the chokehold (Step 15)
    // on top of his live clip pose (he's restrained, not frozen): bones turned about his body
    // axes, restored each frame before being turned again (nothing accumulates)
    live(g, bones) {
      const L = g._live || (g._live = new Map());
      g.root.updateMatrixWorld(true); g.root.getWorldQuaternion(_bq);
      for (const k of OVERLAY) {
        const b = g.bones[k]; if (!b) continue;
        const kept = L.get(b);
        if (kept && b.quaternion.equals(kept.written)) b.quaternion.copy(kept.base);   // not re-posed by his clip this frame
        const a = bones[k];
        if (!a || (!a[0] && !a[1] && !a[2])) { L.delete(b); continue; }
        const base = b.quaternion.clone();
        b.parent.getWorldQuaternion(_pq).invert();
        if (a[1]) b.quaternion.premultiply(_dq.setFromAxisAngle(_ax.copy(AX.y).applyQuaternion(_bq).applyQuaternion(_pq), a[1] * D));
        if (a[0]) b.quaternion.premultiply(_dq.setFromAxisAngle(_ax.copy(AX.x).applyQuaternion(_bq).applyQuaternion(_pq), a[0] * D));
        if (a[2]) b.quaternion.premultiply(_dq.setFromAxisAngle(_ax.copy(AX.z).applyQuaternion(_bq).applyQuaternion(_pq), a[2] * D));
        b.updateMatrixWorld(true);
        L.set(b, { base, written: b.quaternion.clone() });
      }
    },
    // the live overlay off again (choke let go, RESET)
    clearLive(g) {
      if (!g._live) return;
      for (const [b, kept] of g._live) if (b.quaternion.equals(kept.written)) b.quaternion.copy(kept.base);
      g._live.clear(); g.root.updateMatrixWorld(true);
    },
    // p: progress 0…1, t: s since the choke began. He fights it (hands up at her arm, trunk
    // twisting, head pushed back), weakening after `relaxFrom` until he slumps limp
    chokeStruggle(g, p, t, c) {
      const w = ease(t / (c.initiate || 0.25)), r = ease((p - c.relaxFrom) / (1 - c.relaxFrom)), s = w * (1 - 0.85 * r);
      const o1 = Math.sin(Math.PI * 2 * 2.6 * t), o2 = Math.sin(Math.PI * 2 * 1.7 * t + 1);
      this.live(g, {
        spine1: [-4 * s + 10 * r, 7 * s * o1, 0], chest: [0, 5 * s * o2, 0],
        head: [-10 * s * (0.7 + 0.3 * o2) + 22 * r, 0, 6 * s * o1], neck: [6 * r, 0, 0],
        leftArm: [-(50 + 10 * o1) * s, 0, 8 * s], rightArm: [-(50 + 10 * o2) * s, 0, -8 * s],
        leftForeArm: [-40 * s, 0, 0], rightForeArm: [-40 * s, 0, 0],
      });
    },
    // he's out: she lowers him. k 0…1: his knees give (sag), then he's laid down onto his back
    // beside her, ending in exactly the lying pose. ch: { S, L, yaw0, yaw1, hipsOut }
    chokeLower(g, ch, k) {
      const c = this.cfg, F = g._frozen; if (!F) return;
      const dyaw = wrap(ch.yaw1 - ch.yaw0), land = new THREE.Vector3(ch.S.x + ch.L.x * ch.hipsOut, 0, ch.S.z + ch.L.z * ch.hipsOut);
      const sag = ease(k / 0.4), lay = ease((k - 0.4) / 0.6), bend = sag * (1 - lay);
      g.yaw = ch.yaw0 + dyaw * lay;
      const hips = new THREE.Vector3(lerp(F.hipsW.x, land.x, lay), 0, lerp(F.hipsW.z, land.z, lay));
      const b = { leftUpLeg: [-35 * bend, 0, 0], rightUpLeg: [-32 * bend, 0, 0], leftLeg: [65 * bend, 0, 0], rightLeg: [60 * bend, 0, 0],
        head: [22 * (1 - lay), c.lyingHead * lay, 0], leftArm: [0, 0, c.lyingArms * lay], rightArm: [0, 0, -c.lyingArms * lay] };
      this.pose(g, { hips, tilt: (8 * sag + 82 * lay) * D, bones: b, neutral: lay, clear: lerp(F.standClear, c.lieClear, lay), pin: true });
    },
    // her side: arms tighten (a little pumping), then she follows him down and lets go
    chokePlayer(phase, k, t, c) {
      if (phase === 'hold') { const w = ease(t / (c.initiate || 0.25)); return { shoulder: lerp(48, 62, w) + 2 * Math.sin(Math.PI * 2 * 2.6 * t) * w, elbow: lerp(55, 95, w), twist: 0, crouch: false }; }
      if (phase === 'lower') return { turn: ease(k), shoulder: lerp(62, 40, ease(k)), elbow: lerp(95, 60, ease(k)), twist: 0, crouch: k > 0.35 };
      return { turn: 1, shoulder: 40, elbow: 60, twist: 0, crouch: false };
    },

    // ---------------------------------------------------------------- the throw (player)
    // how far through her turn toward the throw (0…1), trunk twist (° toward it), arm angles, crouch
    player(phase, k) {
      const p = this.cfg.player, e = ease(k);
      if (phase === 'initiate') return { turn: 0, twist: 0, shoulder: lerp(p.shoulder[0], p.shoulder[1], e), elbow: lerp(p.elbow[0], p.elbow[1], e), crouch: false };
      if (phase === 'offBalance') return { turn: 0.35 * e, twist: p.twist[0] * e, shoulder: p.shoulder[1], elbow: p.elbow[1], crouch: false };
      if (phase === 'throw') return { turn: 0.35 + 0.65 * e, twist: lerp(p.twist[0], p.twist[1], e), shoulder: lerp(p.shoulder[1], p.shoulder[2], e), elbow: lerp(p.elbow[1], p.elbow[2], e), crouch: true };
      if (phase === 'impact') return { turn: 1, twist: p.twist[1], shoulder: p.shoulder[2], elbow: p.elbow[2], crouch: true };
      return { turn: 1, twist: p.twist[1] * (1 - e), shoulder: p.shoulder[2], elbow: p.elbow[2], crouch: false };   // recovery: arms let go (cqc fades them)
    },
  };
})(SC.mv);
