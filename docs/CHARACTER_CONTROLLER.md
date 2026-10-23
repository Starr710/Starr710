# Character controller (Stage 1: basic movement)

Playable test: `movement.html`. The code is in `js/movement/`.

## Modules

| File | Owns | Knows nothing about |
|---|---|---|
| `input.js` | Touch stick (left 45% of the screen), camera drag (rest of the screen), RUN toggle, keyboard and mouse. Outputs `move {x,y}`, `look {dx,dy}` and `sprint`. | The character, the camera |
| `motor.js` | Movement and physics: target speed from stick magnitude, acceleration/deceleration, limited and smoothed turning, braking on reversal, collision sliding, ground height. Outputs `position`, `yaw`, `speed`, `angularVelocity`, `accel` and `gait`. | Meshes, bones, clips |
| `collision.js` | Static world: boxes and cylinders, with a circle-vs-world resolver. Holds the obstacle meshes that the camera avoids. | — |
| `character-visual.js` | Loads a GLB through a **profile**. Exposes `root`, `mixer`, `clips.{idle,walk,run,sprint?}` and canonical `bones`. Strips root motion. | Input, movement rules |
| `animator.js` | Animation state machine. Stage 1 has a single `grounded` state with a speed blend space (idle ↔ walk ↔ run[/sprint]). One shared gait phase keeps the feet in step. Playback rate is matched to ground speed using stride speeds measured from the clips. A procedural whole-body lean sits on top. | Input, collision |
| `posture.js` | Tactical upper-body layer, run after the mixer. Forward lean grows with speed, shoulder twist is damped, the head is steadied, and the carbine is carried at low ready (port arms in a sprint) on a lag spring. Two-bone arm IK puts the hands on the grip and handguard, and the fingers close around them. Legs, hips and gait rhythm stay 100% mocap. | Input, collision |
| `camera-rig.js` | Third-person orbit: a spring-damped follow point, a shoulder offset, re-centring behind the character after 1.4 s without camera input, pull-in on obstacles, and a small sprint FOV kick. | The character mesh |
| `actions.js` | Context-action framework: register / available / start / update / end. **No actions are registered in Stage 1.** | — |
| `test-area.js` | The test yard. | — |
| `main.js` | Wiring and the frame loop: input → motor → place visual → animator → camera → render. | — |

Swapping the character never touches `motor.js`, `camera-rig.js`, `input.js` or `actions.js`.

## Tuning (all in one place)
- **Speeds and feel:** `SC.mv.MotorDefaults` in `motor.js`.
  - Stick-to-speed curve: slow walk about 0.6–1.0 m/s, walk about 1.5, jog about 3.2. Sprint is 5.6.
  - Accel 3.4 m/s² (2.6 above jog), decel 5.2, brake 9.
  - Turn rates: 7.5 rad/s standing, 6.5 walking, 2.6 at full sprint.
- **Blend thresholds, clip-rate limits and lean:** `SC.mv.AnimatorDefaults` in `animator.js`.
- **Tactical posture:**
  - `SC.mv.PostureDefaults` holds lean by speed, twist damping, head steadiness, weapon lag and finger curl.
  - The `POSES` table in `posture.js` holds the idle, low-ready and port carry positions.
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
`assets/characters/test-soldier.glb` is the Mixamo "Vanguard" from the three.js examples, carrying motion-captured idle, walk and run clips. It's used under Mixamo's terms (free to use in projects, but not to redistribute as a standalone asset). It's a stand-in only, and will be replaced by the operative.
