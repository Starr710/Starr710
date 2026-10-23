# Character controller (Stage 1: basic movement)

Playable test: `movement.html`. The code is in `js/movement/`.

## Modules

| File | Owns | Knows nothing about |
|---|---|---|
| `input.js` | Touch stick (left 45% of the screen), camera drag (rest of the screen), CROUCH toggle, keyboard and mouse. Outputs `move {x,y}`, `look {dx,dy}` and `crouch`. There is no run button: how far the stick is pushed picks the speed. | The character, the camera |
| `motor.js` | Movement and physics: target speed from stick magnitude (in zones, with hysteresis), acceleration/deceleration, limited and smoothed turning, braking on reversal, collision sliding, ground height. Outputs `position`, `yaw`, `speed`, `angularVelocity`, `accel` and `gait`. | Meshes, bones, clips |
| `collision.js` | Static world: boxes and cylinders, with a circle-vs-world resolver. Holds the obstacle meshes that the camera avoids. | — |
| `character-visual.js` | Loads a GLB through a **profile**. Exposes `root`, `mixer`, `clips.{idle,walk,run,sprint?}` and canonical `bones`. Strips root motion. Conditions each clip: resamples it at 60 fps on Catmull-Rom splines and applies a light cyclic Gaussian smooth (`clipSmoothing` in the profile), so mocap keyframe kinks don't show when a gait is slowed. | Input, movement rules |
| `animator.js` | Animation state machine. Grounded locomotion runs through **moving → stopping → stopped**. On release she finishes the step: the motor is told how far to brake so she comes to rest at the walk clip's *passing* pose (feet level), measured automatically from the clip. If she stops short, a settle step follows: the planted foot stays locked while the other foot lifts and steps into the idle stance. Starts begin from the passing pose. Underneath is a speed blend space (idle ↔ walk ↔ run[/sprint]). One shared gait phase keeps the feet in step. Playback rate is matched to ground speed using stride speeds measured from the clips. A procedural whole-body lean sits on top. | Input, collision |
| `posture.js` | Tactical upper-body layer, run after the mixer. **Idle square-up:**
  - The idle clip's hip facing and toe-out are measured against the walk at load.
  - While idle, the hips and legs turn to face forward, the spine counter-turns so the shoulders stay put, and each foot's toe-out is matched to the walk.
  - `idleSquare` (0–1) controls it.

**Stealth legs:**
  - The hips lower slightly and the pelvis tips forward at sneaking pace.
  - Steps shorten, using the animator's `strideScale`, which also slows playback to match so the feet stay planted.
  - Two-bone leg IK holds each foot where the clip put it, keeping the clip's foot angle.
  - The clip's vertical hip bob is levelled at sneaking pace (`levelHips`), so the body glides.
  - The effect fades out toward a sprint.
- **Limb IK:**
  - Hinge-only bend, with a stable axis near full extension.
  - Soft IK: the limb eases into full reach rather than snapping straight.

Above the legs: forward lean grows with speed, shoulder twist is damped, the head is steadied, Arms follow a **carry profile**. `unarmed` is the default. It keeps the clip's own arm motion: each arm bone is pulled toward its running-average pose to reduce swing, the elbow gets extra bend about its own hinge, and the hands are loosely closed. Per-gait values are in the `ARM_GAIT` table. No IK is used. `rifle` is kept for a later stage: a carbine at low ready, port arms in a sprint, on a lag spring, with the hands on grip and handguard. Preview it with `movement.html#rifle`. Pistol, knife and other carries become further profiles. Legs, hips and gait rhythm stay 100% mocap. | Input, collision |
| `camera-rig.js` | Third-person orbit: a spring-damped follow point, a shoulder offset, re-centring behind the character after 1.4 s without camera input, pull-in on obstacles, and a fixed field of view. | The character mesh |
| `noise.js` | Noise events (`docs/GAME_DESIGN.md` §2): `emit(level, type, position, surface, source)`, listeners via `on()`. Reach per level is steeply non-linear (`radius`: 2.5, 6, 14, 30, 80 m). Each surface (`surfaces`) adds an intensity shift (read between levels) and a range scale: concrete 0 / ×1, metal +0.5 / ×1.15, grass −0.5 / ×0.85. The event keeps the action's `level` and also carries the effective `intensity` and `radius`. The footstep emitter looks up the surface under each landing foot from the world's surface map (`collision.js`: `addSurface`, `surfaceAt`; concrete by default). `FootstepEmitter` watches the posed feet and emits a footstep each time a foot lands: low (ankle or toe within 4.5 cm of the ground), after lifting above 7 cm, nearly stopped like a planted foot, and at least 6 cm from that foot's last landing. Level by gait: sneak and slow crouch 1, stealth walk and fast crouch 2, jog 3; turn-in-place and settle steps 1. A debug ring on the ground shows each event's reach (`NoiseDefaults.debug`). | Guards (none yet) |
| `footstep-audio.js` | Synthesized footstep sounds per surface (no audio files), played for the player's footstep events: concrete a dry tap and heel thump, metal a clank with a short ring, grass a soft swish. Loudness follows the event's effective intensity (`gainByIntensity`) times a per-surface gain. Unlocked by the START tap (iOS), resumed by any later tap, suspended while the page is hidden. | Guards |
| `guard.js` | A guard character type (no input, camera or HUD). `cloneSkinned` copies the player's loaded model (shared geometry, textures and clips; own skeleton, mixer and a tinted uniform material). Stationary. Turns on the spot: a turn-only body (limited, smoothed turn rate, `GuardDefaults.turn`) drives the player's own `AnimationController` on the guard's copy, which plays idle and the in-place turning steps. `squareShoulders` turns the model so the idle pose's shoulders face along his vision. Has a collision body that never blocks sight (`addCylinder(..., { noSight: true })`), eyes at the head bone, and a `GuardVision`. Later stages give it a brain driving a motor + animator. | The player's controls |
| `guard-hearing.js` | `HearingDefaults`: Poor / Regular / Keen sensitivity (0.7 / 1 / 1.3 × each sound's own reach, which already includes its surface). Remembers only the most recent heard sound; after `reactDelay` (0.35 s) turns to face where it was made, looks for `lookTime` (3 s), then returns to his post. Repeated sounds redirect his look only if ≥ 12° away and ≥ 0.8 s after the last redirect. Never fills the vision meter. Developer view: a cyan marker at the last heard position and a HEARING stats row. | Investigation, walking, memory beyond one sound |
| `guard-vision.js` | `VisionDefaults`: nested zones (30° / 70° / 110° total, fill rates 1.2 / 0.7 / 0.35 per s), profiles Short / Regular / Great (10 / 16 / 24 m), distance falloff, stance and movement factors, close-range rate, Simple Cover threshold (50% of body points visible), hold then decay. `visionTarget` samples 9 body bones. `collision.js` `segmentBlocked` tests sight lines against boxes (with their heights) and pillars. `GuardDebugView` draws the zones, a sight line (green seen / red blocked / grey out of view) and the detection meter. All values are initial test values. | Hearing, memory, reactions |
| `actions.js` | Context-action framework: register / available / start / update / end. **No actions are registered in Stage 1.** | — |
| `test-area.js` | The test yard, with three 3 × 5 m surface strips (concrete, metal, grass) 4 m ahead of the start. | — |
| `main.js` | Wiring and the frame loop: input → motor → place visual → animator → camera → render. | — |

Swapping the character never touches `motor.js`, `camera-rig.js`, `input.js` or `actions.js`.

## Tuning (all in one place)
- **Speeds and feel:** `SC.mv.MotorDefaults` in `motor.js`.
  - Stick-to-speed curve: sneak 1.0–1.25 m/s (up to about 60% push), stealth walk 1.9–2.0 (about 68–88%), jog 3.2 (from about 94%). These are the only standing speeds; there is no sprint.
  - **Stick zones** (`speedZones`, `crouchSpeedZones`, `zoneHysteresis`): each speed owns a zone of stick travel, and a push is held inside its zone, so there are no in-between speeds. The zone only changes once the thumb is about 2 px (`zoneHysteresis` 0.035) past the midpoint between two zones: sneak ↔ stealth walk at about 64%, stealth walk ↔ jog at about 91%. A wobbling thumb can't flicker between speeds; acceleration and the animation blend smooth the change when it happens.
  - Accel 3.4 m/s², decel 5.2, brake 9.
  - Stops never last more than `maxStopTime` (0.9 s).
  - `settleTime` (0.45 s) in the animator sets the idle settle.
  - Turn rates: 7.5 rad/s standing, 6.5 walking, tapering to about 5.1 at jog (`turnRateFast`, `turnFastSpeed`).
- **Blend thresholds, clip-rate limits and lean:** `SC.mv.AnimatorDefaults` in `animator.js`.
- **Stealth gait:**
  - `strideScale` lives in `SC.mv.AnimatorDefaults`.
  - `hipDrop`, `pelvisTilt` and `hipsBack` live in `SC.mv.PostureDefaults`.
- **Tactical posture:**
  - `SC.mv.PostureDefaults` holds lean by speed, twist damping, head steadiness, weapon lag and finger curl.
  - The `UNARMED` table holds wrist targets per gait plus how much clip swing is kept.
  - The `POSES` table holds the rifle's idle, low-ready and port positions.
- **Camera:** `SC.mv.CameraDefaults` in `camera-rig.js`.

## Replacing the character
Add a profile to `SC.mv.CHARACTER_PROFILES` in `character-visual.js`:

```js
operative: {
  url: 'assets/characters/operative.glb',
  forwardYaw: 0,                 // radians to turn the asset so it faces +Z
  clips: { idle: 'Idle', walk: 'Walk', run: 'Jog', sprint: 'Sprint' },
  inPlace: true,                 // strip horizontal hips motion from clips
}
```

Then load `movement.html` with `window.SC_CHARACTER = 'operative'` set before `main.js` (or change the default in `main.js`).

### Skeleton requirements
- Skinned humanoid, glTF 2.0 / GLB, Y-up, metres. The scene can be scaled internally (Mixamo exports at 0.01 with a Z-up root node are fine).
- **Required bones** (matched by name, with or without a `mixamorig:` prefix): `Hips`, `LeftFoot`, `RightFoot`.
- **Required for the tactical posture:**
  - `Spine`, `Spine2` (chest), `Head`;
  - `LeftArm`/`LeftForeArm`/`LeftHand` and the right-side equivalents;
  - finger chains `<Side>Hand<Thumb|Index|Middle|Ring|Pinky>1-3`. These are optional; without them the hands just won't curl.
  - `LeftUpLeg`/`LeftLeg` and the right-side equivalents, for the stealth legs.
- **Recommended:** `LeftToeBase`/`RightToeBase` (used for stride measurement), `Spine`, `Spine2`, `Neck`, `Head`, full arms and fingers. Later stages need hands (pickups, aiming), a `WeaponR` socket and spine/neck (aim offsets, peeking).
- Mixamo, Unity Humanoid and Unreal-style names work. Our generated operative's 69-bone game rig qualifies.
- Feet must touch y = 0 in the clips. The animator logs each gait's lowest foot height (`stride.*.footMinY`, about 7–9 mm for the test soldier).

### Animation clips
| Role | Required now | Notes |
|---|---|---|
| `idle` | yes | Looping, in place |
| `walk` | yes | Looping, in place. Also used for slow walk at 0.45–0.8× rate |
| `run` | yes | Looping, in place. Used for jog (blended with walk) and, until a sprint clip exists, sprint at up to 1.5× rate |
| `rifle_walk`, `rifle_jog`, `rifle_sprint` (tactical locomotion) | optional, best upgrade | Real tactical mocap would add bent-knee, rolling-step legs. The posture layer already handles the upper body, and would then be dialled down |
| `sprint` | optional | A dedicated sprint, with longer strides and more lean, replaces the sped-up run automatically |
| `slow_walk`, `walk_start`, `walk_stop`, `run_stop`, `turn_in_place_L/R_90/180` | not yet | Planned for polish. They remove the remaining slow-motion look at very low speed and the brief foot pivot when turning on the spot |
| `crouch_*`, `prone_*`, `crawl`, `roll`, `wall_*`, `peek_*`, `vault`, `mantle`, `ladder_*`, `door_*`, `pickup`, `aim_*`, `takedown_*` | later stages | Each future action registers through `actions.js` |

Gait clips must loop cleanly and start with the **left foot planted**, or at least share a consistent phase convention. The walk and run phases are synced by normalized time.

## Current temporary character
`assets/characters/test-soldier.glb` is the Mixamo "Vanguard" from the three.js examples, used under Mixamo terms. Its idle, walk and run clips are motion-captured.
- **Crouch idle and crouch walk:** these come from Quaternius's **Universal Animation Library** (CC0). They were retargeted onto this skeleton by `tools/retarget.html`, which uses world-space rotation deltas against each rig's T-pose and scales hip height by the hips ratio. The result is in `test-soldier-crouch.json`, loaded through the profile's `extraClips`.
- **Mannequin profile:** the UAL mannequin itself (`ual-mannequin.glb`) is still available as the `mannequin` profile. Its stylized jog didn't suit this game.

Retargeting more clips, e.g. for later stages, is done with:
`tools/retarget.html?src=<UAL glb>&dst=assets/characters/test-soldier.glb&clips=Roll,PickUp_Table`
from a local server; the output is in `window.RESULT`.

## Locomotion polish (movement-pre-polish → this)
- **Turn-in-place stepping** (`animator.js`, `turnStep`, `turnStepRate`, `turnStride`): when she turns on the spot, she takes small steps (about one per 90° turned) with short strides, instead of pivoting on planted feet. The effect fades out once she's walking.
- **Stance spring** (`animator.js`, `stanceSpring`): stand↔crouch blends on a critically damped spring, which eases in as well as out. Peak hip jerk during a stance change while walking dropped from about 82 to about 14 mm/frame².
- **Direction-aware camera recentering** (`camera-rig.js`): the camera only drifts behind her when she's travelling away from or across the view. Walking toward the camera never swings it around. Manual look still cancels recentering for 1.4 s.

## Stances
- **Motor:** `motor.stance` is `'stand'` or `'crouch'`, with a separate `crouchSpeedCurve` and two crouch speeds: slow crouch 0.8–1.0 m/s (up to about 60% push) and fast crouch 1.85–2.0 m/s (from about 68% push). Crouch steps are kept short (`crouchStrideScale`: 0.8× of the clip at slow crouch, up to 1.1× at fast crouch), so speed comes mostly from quicker steps (`crouchMaxPlayRate` 2.6). The crouched arms keep 40% of the clip's swing (`crouchArms.keep`). The same stick zones apply: slow crouch ↔ fast crouch at about 64% push.
- **Animator:** crouch idle and crouch walk are their own blend layer. The layer fades over about 0.3 s and shares the gait phase, with an offset measured so the same foot leads. Stops land on the crouch walk's passing pose.
- **Posture:** stealth shaping fades out while crouched, because the crouch clips carry their own posture. On top, an MGSV-style shaping: hip hinge, a fairly flat back with a slight rounding (`crouchHunch`, with the neck lifted so the head stays looking ahead) and arms held forward with the elbows bent about 90° and the hands out in front of the knees. The crouch clip barely moves its arms, so each arm swings with the opposite leg (`crouchArms.swing`). The head follows the spine (`crouchHeadSteady`, `crouchHeadPitch`) rather than being cranked level. Hinging much past 0.48 folds the head under, so extra lean should come from the hunch.
- **Crouch idle** (`crouchIdle` in `PostureDefaults`), layered on the crouch idle clip, which barely moves on its own:
  - **Kneel:** a kneel with the back knee about 29 cm off the ground and the back foot on its toes, from the clip. `drop` can sink the hips further, but past about 5 cm the front thigh pushes into the body.
  - **Hands:** the right hand (kneeling side) hangs down to the ground in front, the left arm rests over the front knee (`reach`, `idleBend`, `idleInward`).
  - **Life:** slow breathing (`breathe`), side-to-side weight shifts (`sway`), and the head slowly scanning left and right with pauses (`scan`).
- **Camera:** drops 0.45 m when crouched.
