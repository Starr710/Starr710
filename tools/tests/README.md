# Movement regression checks

```
node tools/tests/movement-checks.cjs              # all checks (about 1–2 minutes)
node tools/tests/movement-checks.cjs zones stops  # only some
```

Run from the repo root. The script starts its own local server, opens `movement.html` in headless Chromium (Playwright; install with `npm i -D playwright` if it's missing) and checks the real controller, animator and posture code against limits taken from the approved movement. Run it after any change to movement, animation clips, the rig or tuning, and before testing on the phone.

| Check | What it guards |
|---|---|
| `zones` | Real touches on an iPhone-landscape screen. A light push is SNEAK (1.0–1.3 m/s), a medium push STEALTH WALK (1.85–2.05), a full push JOG (3.1–3.3), and crouched SLOW / FAST CROUCH. A thumb wobbling ±2 px at a zone edge never flips the gait |
| `controls` | No RUN button. CROUCH toggles on and off. The stick and the camera drag work at the same time |
| `plantedFeet` | Planted-foot slip while walking at every gait (≤ 0.4 m/s) |
| `stops` | Releasing the stick: she stops within 1 s and settles into idle, with the planted foot still. The jog stop's last stride drags the foot a little (≈ 0.7 m/s, known), so its limit is 0.8 |
| `fingers` | Fingers don't drift or spin over 10 s (≤ 10°) |
| `jointPops` | 60 s of random stick input, stance changes, turns, stops and starts. No single-frame joint pops while crouched, measured relative to the body. Standing fast reversals are counted but not failed |
| `footsteps` | Footstep noise events: one per foot landing, alternating feet, in step with the gait cycle; level 1 for sneak and slow crouch, 2 for stealth walk and fast crouch, 3 for jog; none while standing or crouching still |
| `surfaces` | The surface strips: the map reports concrete, metal and grass where they are (concrete elsewhere). Footsteps on each strip carry that surface, the gait level stays 1 / 2 / 3, movement speed is identical, and the reach is grass < concrete < metal at every gait |
| `footstepAudio` | Each surface's footstep event plays its own sound. Rendered offline at a stealth-walk step, metal is loudest (> 1.2× concrete) with a ringing tail, concrete is dry, grass is quietest (< concrete / 1.2) and brightest |
| `visionZones` | The guard's nested zones: at 6 m in clear view, each sample's zone matches the angle he measured (30° / 70° / 110° total) on both sides, the angle matches where she was placed (±2.5°), fill rates fall from fastest to normal to slower, and none outside. Widening a zone or doubling its rate in the settings takes effect |
| `visionFactors` | Fill rate falls with distance and is zero past the profile's range; crouching is slower than standing; moving faster than still, jogging faster than walking; at 1.8 m in clear view she's recognised in under 0.4 s |
| `visionCover` | Simple Cover: the 2 m crate hides her standing (meter stays 0); behind the 0.9 m crate she's seen standing but hidden crouched; with long range and the guard facing her, a 2.8 m wall blocks him completely (never seen through), while the same spot in front of it is seen |
| `visionDecay` | After losing sight the meter holds (within 2% at 0.5 s), then falls gradually (below the hold, above 5% at 2 s) to zero by 5 s, never rising while unseen |
| `groundContact` | In the crouch idle both feet touch the ground (lowest skinned vertex ≤ 3 cm) |
| `clearance` | Limbs stay out of the body: hand to shin ≥ 15 cm in the crouch idle (≥ 12 cm during the crouch-walk arm swing), thigh to spine ≥ 15 cm |

## Fixed issues

- **Knee jump on a sharp turn out of the crouch idle** (found by `jointPops`): starting to move reset the stride to the passing pose even while the turn-in-place steps were already showing the walk clip, so the legs jumped (≈19° at the back knee). Now the stride only resets when that jump would be invisible (`startPhaseSnap` in `animator.js`).
