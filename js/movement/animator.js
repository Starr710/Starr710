// SHADOW CELL — movement: animation controller.
// A small state machine whose only state this stage is GROUNDED, driving a 1D
// blend space over speed: idle ↔ walk ↔ run (run doubles as jog and sprint until
// dedicated clips exist). Walk and run share one normalized gait phase so feet
// stay in step while blending, and the phase advances by distance travelled
// divided by stride length, so playback rate always matches ground speed (no
// foot sliding). Stride speeds are measured from the clips' own foot motion at
// load, so a replacement character needs no hand tuning.
//
// On top of the clips sits a light procedural layer that never moves limbs:
// whole-body lean into turns and with acceleration, pivoting at the feet.
(function (mv) {
  'use strict';

  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  mv.AnimatorDefaults = {
    idleOut: [0.04, 0.5],     // speed range over which idle fades out
    minPlayRate: 0.45,        // slowest a gait clip is allowed to play (slow walk)
    maxPlayRate: 1.5,         // fastest (sprint on the run clip)
    leanTurn: 0.035,          // body roll per (rad/s × m/s)
    leanTurnMax: 0.14,
    leanAccel: 0.012,         // body pitch per m/s²
    leanAccelMax: 0.06,
    leanSmoothing: 7,
    settleTime: 0.45,
    crouchSettleTime: 0.75,    // crouch idle stands further from the walk pose: two unhurried steps
    startPhaseSnap: 0.04,      // a start jumps the stride to the passing pose only if the jump would be
                               // invisible: (gait clip weight showing) × (phase distance) below this
    stanceSpring: 11,
    // fast crouch-walk: longer, quicker strides than the clip's own (it is authored slow)
    crouchStrideScale: [[0, 0.8], [1.0, 0.8], [2.0, 1.1]],   // shorter, quicker crouch steps
    crouchMaxPlayRate: 2.6,          // stand↔crouch blend spring (higher = quicker)
    turnStep: [1.0, 3.5],      // rad/s range over which turning in place blends in stepping
    turnStepRate: 0.32,        // gait cycles per radian turned (≈ one step per 90°)
    turnStride: 0.22,          // stride scale for those steps (feet stay near the body)          // s from stopping to a full idle stance
    // stealth gait shaping: stride length multiplier by speed (m/s). Shorter
    // steps at sneaking pace; the posture layer pulls the feet in to match.
    strideScale: [[0, 0.6], [0.5, 0.6], [1.1, 0.66], [1.8, 0.84], [2.5, 0.96], [3.2, 1]],
  };
  mv.table = (pts, x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    return pts[pts.length - 1][1];
  };

  mv.AnimationController = function (visual, opts) {
    this.v = visual;
    this.cfg = Object.assign({}, mv.AnimatorDefaults, opts || {});
    this.state = 'stopped';          // grounded locomotion: moving / stopping / stopped
    this._lastLen = 1;
    this.phase = 0;
    this.roll = 0; this.pitch = 0;
    const mixer = visual.mixer;
    this.actions = {};
    for (const k of ['idle', 'walk', 'run', 'sprint', 'crouchIdle', 'crouchWalk']) {
      const clip = visual.clips[k];
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(k === 'idle' ? 1 : 0);
      if (k !== 'idle' && k !== 'crouchIdle') a.setEffectiveTimeScale(0);   // gait clips are scrubbed by phase
      this.actions[k] = a;
    }
    const S = this.stride = {};
    for (const k of ['walk', 'run', 'sprint', 'crouchWalk']) if (visual.clips[k]) this.stride[k] = this.calibrate(visual.clips[k]);
    // a profile may pin measured speeds (stylized clips can fool the measurement)
    const pin = visual.profile.strideSpeeds || {};
    for (const k in pin) if (this.stride[k]) { this.stride[k].speed = pin[k]; this.stride[k].length = pin[k] * this.stride[k].duration; }
    // which way the idle clip's hips face relative to the walk's (mocap idles
    // often stand turned side-on); the posture layer squares the stance up
    this.idleYaw = this.facing(visual.clips.idle) - this.facing(visual.clips.walk);
    this.idleYaw = Math.atan2(Math.sin(this.idleYaw), Math.cos(this.idleYaw));
    // per-foot toe-out correction so the squared-up idle feet splay like the walk's
    const wrapA = x => Math.atan2(Math.sin(x), Math.cos(x));
    this.idleFootYaw = ['left', 'right'].map(side => {
      const fi = this.facing(visual.clips.idle, side), fw = this.facing(visual.clips.walk, side);
      return fi == null || fw == null ? 0 : wrapA(fw - (fi - this.idleYaw));
    });
    // stride table and blend points may be tuned per character
    if (visual.profile.strideScale) this.cfg.strideScale = visual.profile.strideScale;
    this.blendPts = visual.profile.blend || null;
    // crouch walk shares the gait phase: offset its clock so the same foot leads
    this.crouchOffset = 0;
    if (S.crouchWalk && S.walk) {
      const lead = (clip, ph) => this.leadFoot(clip, ph);
      let off = ((S.crouchWalk.passing[0] - S.walk.passing[0]) % 1 + 1) % 1;
      if (lead(visual.clips.walk, S.walk.passing[0] + 0.15) !== lead(visual.clips.crouchWalk, S.crouchWalk.passing[0] + 0.15)) off = (off + 0.5) % 1;
      this.crouchOffset = off;
    }
    this.crouchW = 0;
    // the probe shares the mixer's cached actions, so restart them after measuring
    for (const k in this.actions) {
      const a = this.actions[k];
      a.reset().play();
      a.setEffectiveWeight(k === 'idle' ? 1 : 0);
      a.setEffectiveTimeScale(k === 'idle' || k === 'crouchIdle' ? 1 : 0);
    }
    this.weights = { idle: 1, walk: 0, run: 0, sprint: 0 };
    this.strideScale = 1;
  };

  // Average facing (yaw, rad) of a clip's pelvis, from the left→right hip axis.
  // With `footSide` ('left'/'right'), the average heel→toe yaw of that foot instead.
  mv.AnimationController.prototype.facing = function (clip, footSide) {
    const v = this.v, b = v.bones, mixer = v.mixer, root = v.root;
    if (!b.leftUpLeg || !b.rightUpLeg) return 0;
    const foot = footSide && b[footSide + 'Foot'], toe = footSide && b[footSide + 'Toe'];
    if (footSide && (!foot || !toe)) return null;
    const probe = mixer.clipAction(clip).stop();
    const others = Object.values(this.actions).map(a => [a, a.getEffectiveWeight()]);
    others.forEach(([a]) => a.setEffectiveWeight(0));
    probe.reset().play().setEffectiveWeight(1).setEffectiveTimeScale(0);
    let sx = 0, sz = 0;
    const N = 24, a = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      probe.time = clip.duration * i / N;
      mixer.update(0);
      root.updateMatrixWorld(true);
      let yaw;
      if (footSide) {
        root.worldToLocal(toe.getWorldPosition(a)); root.worldToLocal(foot.getWorldPosition(c));
        yaw = Math.atan2(a.x - c.x, a.z - c.z);
      } else {
        root.worldToLocal(b.leftUpLeg.getWorldPosition(a));
        root.worldToLocal(b.rightUpLeg.getWorldPosition(c));
        const lx = a.x - c.x, lz = a.z - c.z;      // left-pointing hip axis; facing = axis rotated -90°
        yaw = Math.atan2(-lz, lx);
      }
      sx += Math.sin(yaw); sz += Math.cos(yaw);
    }
    probe.stop();
    others.forEach(([act, wt]) => act.setEffectiveWeight(wt));
    return Math.atan2(sx, sz);
  };

  // Which foot is further forward at a phase: 0 = left, 1 = right.
  mv.AnimationController.prototype.leadFoot = function (clip, phase) {
    const v = this.v, b = v.bones, mixer = v.mixer, root = v.root;
    const probe = mixer.clipAction(clip).stop();
    const others = Object.values(this.actions).map(a => [a, a.getEffectiveWeight()]);
    others.forEach(([a]) => a.setEffectiveWeight(0));
    probe.reset().play().setEffectiveWeight(1).setEffectiveTimeScale(0);
    probe.time = clip.duration * (((phase % 1) + 1) % 1);
    mixer.update(0); root.updateMatrixWorld(true);
    const l = root.worldToLocal(b.leftFoot.getWorldPosition(new THREE.Vector3())).z, r = root.worldToLocal(b.rightFoot.getWorldPosition(new THREE.Vector3())).z;
    probe.stop();
    others.forEach(([a, wt]) => a.setEffectiveWeight(wt));
    return l > r ? 0 : 1;
  };

  // Measure a looping gait clip's natural ground speed from its planted foot:
  // whichever foot is lowest is on the ground, and it travels backward relative
  // to the body at exactly the speed the body would move forward.
  mv.AnimationController.prototype.calibrate = function (clip) {
    const v = this.v, mixer = v.mixer, root = v.root;
    const probe = mixer.clipAction(clip).stop();
    const others = Object.values(this.actions).map(a => [a, a.getEffectiveWeight()]);
    others.forEach(([a]) => a.setEffectiveWeight(0));
    probe.reset().play().setEffectiveWeight(1).setEffectiveTimeScale(0);
    const N = 48, T = clip.duration, feet = [v.bones.leftToe || v.bones.leftFoot, v.bones.rightToe || v.bones.rightFoot];
    const samples = [];
    const w = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      probe.time = T * i / N;
      mixer.update(0);
      root.updateMatrixWorld(true);
      samples.push(feet.map(f => root.worldToLocal(f.getWorldPosition(w)).clone()));
    }
    probe.stop();
    others.forEach(([a, wt]) => a.setEffectiveWeight(wt));
    const minY = [0, 1].map(k => Math.min(...samples.map(s => s[k].y)));
    const speeds = [];
    for (let i = 1; i <= N; i++) {
      for (let k = 0; k < 2; k++) {
        const a = samples[i - 1][k], b = samples[i][k];
        // planted: at its lowest (within 1.5 cm), below the other foot, and moving back
        const planted = a.y < minY[k] + 0.015 && b.y < minY[k] + 0.015 && a.y <= samples[i - 1][1 - k].y && b.z < a.z;
        if (planted) speeds.push(-(b.z - a.z) / (T / N));
      }
    }
    speeds.sort((p, q) => p - q);
    const speed = speeds.length ? speeds[Math.floor(speeds.length / 2)] : (clip.name.match(/run/i) ? 3.5 : 1.4);
    // "passing" phases: where the feet are level with each other front-to-back.
    // Stops end here and starts begin here, so the hand-off to idle is a small
    // foot placement instead of a slide from mid-stride.
    const gap = samples.slice(0, N).map(sm => Math.abs(sm[0].z - sm[1].z));
    const minima = [];
    for (let i = 0; i < N; i++) if (gap[i] <= gap[(i + N - 1) % N] && gap[i] < gap[(i + 1) % N]) minima.push({ phase: i / N, gap: gap[i] });
    minima.sort((p, q) => p.gap - q.gap);
    const passing = minima.slice(0, 2).map(m => m.phase).sort((p, q) => p - q);
    const res = { speed: Math.max(0.3, speed), duration: T, length: Math.max(0.3, speed) * T, footMinY: Math.min(minY[0], minY[1]), passing };
    return res;
  };

  // motor: { speed, angularVelocity, accel }
  mv.AnimationController.prototype.update = function (dt, motor) {
    const c = this.cfg, A = this.actions, S = this.stride;
    const s = Math.max(0, motor.speed);
    const walk = S.walk, run = S.run, sprint = S.sprint;

    // ---- stance: crouch blends on a critically damped spring (~0.35 s), which eases
    // in as well as out, so stance changes never start with a jolt
    const cw = S.crouchWalk && A.crouchIdle ? (motor.stance === 'crouch' ? 1 : 0) : 0;
    {
      const w = c.stanceSpring, x = this.crouchW - cw, v = this.crouchV || 0, e = Math.exp(-w * dt), tmp = (v + w * x) * dt;
      this.crouchV = (v - w * tmp) * e;
      this.crouchW = Math.min(1, Math.max(0, cw + (x + tmp) * e));
      if (Math.abs(this.crouchW - cw) < 1e-3 && Math.abs(this.crouchV) < 1e-3) { this.crouchW = cw; this.crouchV = 0; }
    }
    const C = this.crouchW, cwk = S.crouchWalk;

    // ---- locomotion state: moving / stopping (finish the step) / stopped
    const wantsMove = motor.targetSpeed > 0;
    const standPass = walk.passing && walk.passing.length ? walk.passing : [0, 0.5];
    // stops land on the passing pose of whichever stance is active (in walk-phase terms)
    const passing = C > 0.5 && cwk ? cwk.passing.map(p => ((p - this.crouchOffset) % 1 + 1) % 1) : standPass;
    const ahead = p => ((p - this.phase) % 1 + 1) % 1;
    if (wantsMove) {
      // first step starts from the passing pose, but only where that jump can't be
      // seen: if the gait clip is already showing (stepping while turning on the
      // spot, or mid settle step) a long jump would pop the legs, so the stride carries on
      if (this.state === 'stopped' && s < 0.05) {
        const jump = Math.abs((((passing[0] - this.phase) % 1) + 1.5) % 1 - 0.5);
        if ((1 - (this.idleSm == null ? 1 : this.idleSm)) * jump < c.startPhaseSnap) this.phase = passing[0];
      }
      this.state = 'moving';
      motor.stopDistance = 0;
    } else if (this.state === 'moving' && s > 0.05) {
      // pick the next passing phase that is far enough ahead to reach smoothly
      // far enough that braking stays comfortable (≈5.5 m/s²) over that distance
      // (strides shrink as the gait slows toward a walk, so plan with the slow-walk stride)
      const slowLen = walk.length * mv.table(c.strideScale, 0.5);
      const minAhead = Math.min(0.95, Math.max(0.06, s * s / (2 * 4 * slowLen)));
      const cands = passing.map(p => ({ p, d: ahead(p) })).map(o => (o.d < minAhead ? { p: o.p, d: o.d + 1 } : o)).sort((x, y) => x.d - y.d);
      this.stopTarget = cands[0].p;
      this.stopRemain = cands[0].d;
      this.stopIdle = 0;
      this.state = 'stopping';
    } else if (this.state === 'moving') this.state = 'stopped';
    let idleW;
    if (this.state === 'stopping') {
      // the motor brakes so the body comes to rest exactly at the stop phase
      motor.stopDistance = Math.max(0.01, this.stopRemain * this._lastLen);
      // idle only ever rises during a stop (an extra step must not pop the pose back)
      this.stopIdle = Math.max(this.stopIdle || 0, 1 - smooth(0.02, 0.16, this.stopRemain));
      idleW = this.stopIdle;
      if (this.stopRemain <= 0.004 && s > 0.6) {
        // still moving when the step runs out (e.g. a hard stop from a sprint): take one more step
        const next = passing.find(p => p !== this.stopTarget);
        const step = next != null ? ((next - this.stopTarget) % 1 + 1) % 1 : 1;
        this.stopTarget = next != null ? next : this.stopTarget;
        this.stopRemain += step;
      } else if (s <= 0.03 || this.stopRemain <= 0.004) {
        // land on the stop pose if we're (nearly) there; never jump the pose otherwise
        if (this.stopRemain < 0.03) this.phase = this.stopTarget;
        // carry on from the idle blend the stop already reached (never dip back)
        this.state = 'stopped'; this.settle = this.stopIdle || 0;
        motor.stopDistance = s > 0.03 ? 0.02 : 0;      // pull up the last few cm/s
      }
    }
    if (this.state === 'stopped') {
      // settle into idle over a fixed time; the posture layer turns this into a
      // small settle step (one foot stays planted, the other steps in)
      this.settle = Math.min(1, (this.settle || 0) + dt / lerp(c.settleTime, c.crouchSettleTime, C));
      idleW = smooth(0, 1, this.settle);
    }
    if (this.state === 'moving') idleW = 1 - smooth(c.idleOut[0], c.idleOut[1], s);
    // turning on the spot: take small steps instead of pivoting on planted feet
    const turn = smooth(c.turnStep[0], c.turnStep[1], Math.abs(motor.angularVelocity)) * (1 - smooth(0.3, 0.8, s));
    this.turnSm = (this.turnSm || 0) + (turn - (this.turnSm || 0)) * (1 - Math.exp(-10 * dt));
    if (this.turnSm > 1e-3) idleW = Math.min(idleW, 1 - this.turnSm * 0.8);
    // the idle weight glides; state changes can never pop the pose
    this.idleSm = this.idleSm == null ? idleW : this.idleSm + (idleW - this.idleSm) * (1 - Math.exp(-14 * dt));
    idleW = this.idleSm;
    const bp = this.blendPts;
    const toRun = bp ? smooth(bp.walkToRun[0], bp.walkToRun[1], s) : smooth(walk.speed * 1.05, run.speed * 0.85, s);
    const toSprint = sprint ? (bp ? smooth(bp.runToSprint[0], bp.runToSprint[1], s) : smooth(run.speed * 1.1, sprint.speed * 0.95, s)) : 0;
    const moveW = 1 - idleW;
    const St = 1 - C;
    const wWalk = St * moveW * (1 - toRun), wRun = St * moveW * toRun * (1 - toSprint), wSprint = St * moveW * toRun * toSprint;

    // ---- shared gait phase: distance / blended stride length, clamped play rate
    // (crouch-walk plays at its own stride; stealth stride shaping is standing-only)
    const crouchStride = mv.table(c.crouchStrideScale, s);
    this.strideScale = lerp(lerp(mv.table(c.strideScale, s), crouchStride, C), c.turnStride, this.turnSm || 0);
    const standLen = lerp(lerp(walk.length, run.length, toRun), sprint ? sprint.length : run.length, toSprint);
    const standDur = lerp(lerp(walk.duration, run.duration, toRun), sprint ? sprint.duration : run.duration, toSprint);
    const blendLen = lerp(standLen * mv.table(c.strideScale, s), (cwk ? cwk.length : standLen) * crouchStride, C);
    const blendDur = lerp(standDur, cwk ? cwk.duration : standDur, C);
    let rate = s / blendLen * blendDur;                       // cycles per cycle-duration
    // while stopping, the phase follows ground distance exactly (no minimum rate),
    // so the planted foot stays put as the body decelerates into the stop
    const maxRate = lerp(c.maxPlayRate, c.crouchMaxPlayRate, C);
    if (this.state === 'moving') rate = Math.min(maxRate, Math.max(s > 0.02 ? c.minPlayRate : 0, rate));
    else rate = Math.min(maxRate, rate);
    let dPhase = dt * rate / blendDur;
    if (this.state === 'stopping') { dPhase = Math.min(dPhase, this.stopRemain); this.stopRemain -= dPhase; }
    if (this.state === 'stopped') dPhase = 0;
    // stepping while turning in place: about one step per 90° of turn
    if (this.turnSm > 1e-3 && this.state !== 'stopping') dPhase += dt * Math.abs(motor.angularVelocity) * c.turnStepRate * this.turnSm;
    // motor.reverseGait (Step 13.1, set only by CQC while she pulls a guard backward): the
    // gait cycle runs backwards, so the walk reads as stepping backward. Normal movement never sets it
    this.phase = motor.reverseGait ? ((this.phase - dPhase) % 1 + 1) % 1 : (this.phase + dPhase) % 1;
    this._lastLen = blendLen;

    A.idle.setEffectiveWeight(idleW * St);
    if (A.crouchIdle) A.crouchIdle.setEffectiveWeight(idleW * C);
    if (A.crouchWalk) { A.crouchWalk.setEffectiveWeight(moveW * C); A.crouchWalk.time = ((this.phase + this.crouchOffset) % 1) * cwk.duration; }
    A.walk.setEffectiveWeight(wWalk); A.walk.time = this.phase * walk.duration;
    A.run.setEffectiveWeight(wRun); A.run.time = this.phase * run.duration;
    if (A.sprint) { A.sprint.setEffectiveWeight(wSprint); A.sprint.time = this.phase * sprint.duration; }
    this.weights.idle = idleW; this.weights.crouch = C; this.weights.walk = wWalk; this.weights.run = wRun; this.weights.sprint = wSprint;
    this.playRate = rate;

    this.v.mixer.update(dt);

    // ---- procedural lean (whole body, pivoting at the feet)
    const k = 1 - Math.exp(-c.leanSmoothing * dt);
    const rollT = Math.max(-c.leanTurnMax, Math.min(c.leanTurnMax, -motor.angularVelocity * s * c.leanTurn));
    const pitchT = Math.max(-c.leanAccelMax, Math.min(c.leanAccelMax, motor.accel * c.leanAccel)) * smooth(0.2, 1.5, s + Math.abs(motor.accel) * 0.2);
    this.roll += (rollT - this.roll) * k;
    this.pitch += (pitchT - this.pitch) * k;
    this.v.lean.rotation.set(this.pitch, 0, this.roll);
  };
})(SC.mv);
