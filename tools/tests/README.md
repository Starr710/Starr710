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
| `groundContact` | In the crouch idle both feet touch the ground (lowest skinned vertex ≤ 3 cm) |
| `clearance` | Limbs stay out of the body: hand to shin ≥ 15 cm in the crouch idle (≥ 12 cm during the crouch-walk arm swing), thigh to spine ≥ 15 cm |

## Fixed issues

- **Knee jump on a sharp turn out of the crouch idle** (found by `jointPops`): starting to move reset the stride to the passing pose even while the turn-in-place steps were already showing the walk clip, so the legs jumped (≈19° at the back knee). Now the stride only resets when that jump would be invisible (`startPhaseSnap` in `animator.js`).
