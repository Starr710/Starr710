# SHADOW CELL — Core Stealth & Gameplay Design Specification

Version 1.0 — Design foundation. This records the intended systems and the decisions taken so far. It is **not** a list of things to implement at once: each system is built one working mechanic at a time, with approval before code changes (see [Development rules](#development-rules) and the [Decisions log](#decisions-log)).

## Project overview

Shadow Cell is an original third-person stealth-action game, developed primarily for iPhone, with planned solo and cooperative multiplayer missions. It takes inspiration from *Metal Gear Solid: Peace Walker* and *Metal Gear Solid V*: character movement, intelligent guards, infiltration, close-quarters combat and environmental interaction.

Philosophy: **the player, guards and environment react to each other through consistent gameplay rules.**

## 1. Character movement

The existing character and movement controller are preserved.

Three standing movement speeds, chosen only by how far the left stick is pushed (there is no RUN or JOG button):

| Speed | Stick push | m/s | Noise level |
|---|---|---|---|
| Sneak | light | 1.0–1.25 | 1 |
| Stealth Walk | medium | 1.9–2.0 | 2 |
| Jog | full | 3.2 | 3 |

Crouching keeps its slow crouch (0.8–1.0 m/s, noise 1) and fast crouch (1.85–2.0 m/s, noise 2), also chosen by stick push. No fourth speed. The existing standing and crouching animations, camera, controls and movement values stay; animation quality may be improved in later phases (see `docs/CHARACTER_CONTROLLER.md`).

## 2. Noise and hearing

Five sound-intensity levels, **not linearly spaced** (a level 5 gunshot carries dramatically farther than level 3 jogging):

| Level | Examples |
|---|---|
| 1 | Sneaking, slow crouch-walking, quiet grab |
| 2 | Stealth walking, fast crouch-walking, punches |
| 3 | Jogging, louder distractions |
| 4 | Heavy impacts, loud crashes |
| 5 | Gunfire |

Every sound event carries: intensity, sound type, world position, and the relevant surface or environmental modifiers.

- Guards have individual hearing capabilities. Hearing depends on distance, intensity, the environment and the guard's awareness.
- Hearing a noise does **not** reveal the player's current location.
- Guards also make sound while moving and interacting with the environment.

## 3. Guard vision

Each guard has one vision capability: **Short**, **Regular** (most ordinary guards) or **Great**.

Three horizontal detection zones (initial values, adjustable):

| Zone | Total angle | Detection |
|---|---|---|
| Fastest | 30° | Rapid recognition |
| Normal | 70° | Moderate recognition |
| Slower | 110° | Gradual recognition |

- Detection can begin anywhere inside the effective cone with clear line of sight. Solid obstacles block vision.
- Detection speed depends on distance, movement, stance, lighting and concealment.
- Detection builds gradually, except when an unmistakable threat is seen at close range.

**Elevation:** elevated guards don't get vastly longer or panoramic vision. Watchtower guards scan a limited assigned sector, turning their gaze and pausing periodically. Height changes viewing angles and which cover they can see over, but they still need valid line of sight. Their patterns should create understandable opportunities and blind spots.

## 4. Guard personality traits

Every guard has exactly two traits: a **primary** (dominant behaviour) and a **secondary** (occasional variation).

| Trait | Behaviour |
|---|---|
| Bored | Occasionally interrupts routines to seek stimulation |
| Focused | Prioritises assignments, follows procedure, investigates credible threats carefully |
| Curious | More likely to investigate unusual objects, sounds and locations |
| Careless | May overlook minor evidence and become distracted |
| Talkative | Occasionally approaches other guards for conversation |
| Hungry | May take food breaks during ordinary patrols |

- Important guards get deliberately assigned traits; ordinary guards get role-appropriate randomised combinations at mission start.
- Traits stay stable for the whole mission.
- Vision, hearing, training and temporary conditions are separate from personality.
- Major threats override routine personality behaviour.

## 5. Suspicion and investigation

Awareness states: **Normal → Suspicious → Investigating → Confirmed Threat / Alert → Active Search / Evasion → Heightened Security.**

- Guards generally investigate minor disturbances on their own; depending on personality and circumstances they may ask for nearby help.
- Repeated suspicious events make guards more cautious.
- Guards remember recent suspicious locations; the memory fades gradually.
- Knowledge is not shared automatically. It spreads by shouting, conversation, radio or alarms.
- A guard transmitting an alert can be interrupted before it completes.

## 6. Evasion and heightened security

After the player escapes a confirmed threat (durations are adjustable test values):

1. **Active Search — 30 s.** Informed guards search the last known location, likely escape routes and nearby hiding places.
2. **Heightened Security — 60 s.** Guards resume duties while more vigilant, temporarily adding security checks to their routes (doors, entrances, hiding spots, previously suspicious areas).
3. **Return to normal.** Without further suspicious activity they gradually resume their original patrols and personality behaviour.

- Temporary heightened focus does not replace permanent traits.
- Changes are local to informed guards and affected areas unless valid communication spreads the alert.
- New confirmed evidence can restart or escalate the response.

## 7. Environmental stealth

**Surfaces** affect sound generation and propagation: concrete (standard footsteps), metal (louder), grass (softer, possible rustling), water (splashing), mud (footsteps and visible tracks).

**Footprints:** wet and muddy prints fade over about 30–90 s, depending on weather and surface. Guards must *see* tracks to react to them. They are evidence, not perfect tracking.

**Vegetation:** tall grass and bushes give strong concealment but never guaranteed invisibility. Crouching and staying still give the most benefit; distance, movement, stance and viewing direction still decide detection.

**Lighting:** balanced. Darkness significantly slows detection but never makes the character invisible; close range, movement and viewing direction still matter. Bright light increases visibility.

**Physical cover (simple rules):** when most of the character is behind solid cover, visual detection is blocked. Low obstacles can hide a crouching character but not a standing one. Elevated viewpoints can invalidate cover once enough of the character is visible. Cover doesn't block sound or erase existing guard memory.

## 8. Interactive objects and distractions

Only selected objects are interactive; not every object gets physics. Selected objects can make noise, distract guards or cause physical effects: light impacts may distract or stagger, appropriate heavier objects may stun or knock out depending on the object and hit. Interactions stay lightweight and mobile-friendly.

**Personal decoys:** a limited supply of dedicated throwable noise decoys (physical design not final). They create sound distractions, can be retrieved by the player and replenished from suitable supplies, never knock guards out, and work through the normal noise and guard-memory systems. Guards may approach and inspect decoys but never pick up, confiscate or move them. Repeated distractions in one area raise suspicion. Starting and maximum counts are to be playtested.

## 9. CQC

Touchscreen scheme:

- **Tap CQC:** grab and restrain a nearby guard. While holding: **Knockout**, **Chokehold**, **Release**. The joystick slowly repositions the restrained guard.
- **Hold CQC:** quick takedown.

Restraining a guard interrupts an unfinished radio transmission. Restrained guards gradually resist and may break free (influenced by alertness and capabilities). They don't scream for help, but struggling makes modest noise. CQC can be witnessed by other guards.

## 10. Unconscious guards

Unconscious guards wake up naturally in time; other guards can revive them sooner. On discovery: the guard approaches, briefly inspects, may revive the teammate, then attempts to report, giving the player a short window to intervene. Recovered guards regain their bearings, look around, then try to report the attack; they don't know the player's current location.

**Body movement: dragging only** (no shoulder carry). Dragging has its own slow contextual movement and surface-based sounds. The three movement speeds are unchanged.

## 11. Stealth feedback and HUD

Hybrid feedback: small contextual guard-awareness indicators, visible guard reactions and body language, subtle audio cues, a minimal persistent HUD. Avoid excessive floating markers.

**Directional threat ring:** a subtle ring at ground level around the protagonist's feet. When an important nearby sound happens, an arc briefly shows its general direction; intensity, size or brightness hint at significance. It must stay centred on the feet, give camera-relative direction, fade when no longer relevant, avoid exact enemy tracking, respect what the character could reasonably hear, and stay readable on an iPhone. It supplements guard indicators rather than replacing them.

**Guard personality card (built, temporary for testing):** a small card beside a visible guard's shoulder showing his two traits (primary in capitals and brighter, secondary smaller), e.g. `FOCUSED / Bored`. It follows him, faces the camera, and appears only while the guard himself is visible: on screen, within 18 m, not completely behind solid cover. It never reveals a hidden guard. It is not part of the player's HUD. Settings are in `TraitCardDefaults` (`guard-traitcard.js`).

**Future idea, not implemented: tactical guard scanner.** An optional reconnaissance tool to gather intelligence on guards instead of seeing every guard's traits automatically. Scanning a guard would reveal his primary and secondary personality, and possibly other information designed later, so the player can plan an approach (e.g. a Curious guard is more likely to check out repeated noise, a Careless one may let a faint sound go). It could tie into difficulty: easier modes show more automatically, harder ones require scanning or careful observation, and some hide personality information entirely. The card is ready for this: `TraitCardDefaults.reveal` is `'always'` now, and `'discovered'` shows a guard's card only once `guard.traitsDiscovered` is true. No scanner equipment, buttons, targeting, animation or mechanics exist yet.

## 12. Difficulty philosophy

The base game stays understandable and fair. Higher difficulties can add more demanding evidence and more thorough responses: longer-lasting footprints, more persistent memory, stronger evidence investigation, more coordinated security, longer search or heightened-security periods. Difficulty never grants supernatural perception. Complex environmental details may be reserved for higher difficulties.

## 13. Mobile and multiplayer

Target iPhone performance: reusable systems, selective interactions, simple physics, efficient AI updates. Solo is the initial focus. The architecture should eventually allow co-op (synchronised guards, player actions, environmental evidence and shared alerts). **No networking yet.**

## Development rules

- Do not implement this whole document at once. Inspect the project, preserve the working character, controls and animations, add independent systems one at a time in a small, safe order, and wait for explicit approval before modifying code.
- Do not rebuild the project or replace the movement controller.
- No aiming, shooting, large missions, multiplayer networking or unnecessary systems in the initial stealth work.
- Every timing value, detection threshold and behaviour parameter stays adjustable (one settings table per system).
- Systems talk through events (noise, sight, alerts); guard state is plain data; random traits use a seeded random number generator, so co-op stays possible later.
- Run `node tools/tests/movement-checks.cjs` after any movement or animation change.

## Decisions log

| Decision | Detail |
|---|---|
| **No RUN or JOG button** | Removed the RUN button and the separate 5.6 m/s sprint. The left stick alone picks Sneak, Stealth Walk or Jog by push distance, in zones with hysteresis so there are no in-between speeds and no flicker (`motor.js`: `speedZones`, `zoneHysteresis`). Crouch keeps slow and fast crouch the same way. |
| **Temporary guards** | Reuse the Mixamo test soldier's model, rig and compatible animations, with a different uniform colour. A separate reusable guard character type reuses the motor and animator, driven by AI (later) instead of touch. No duplicated cameras, HUDs or input handlers. Model, textures and clips are loaded once and shared; each guard gets a lightweight skeleton copy (three.js `SkeletonUtils`) and its own animation mixer; a lighter posture layer keeps iPhone cost down. The player's model, movement, animations and controls are not modified. |
| **Implementation order** | 0. Housekeeping (this document, regression checks in `tools/tests/`). 1. Player noise events with a debug ring. 2. Surfaces. 3. A stationary guard with vision. 4. Hearing. 5. Awareness states and investigation. 6. Feedback HUD (indicators, threat ring). 7. Patrols, traits, search and heightened security, cover/lighting/vegetation, decoys, CQC, unconscious guards, dragging, footprints. |
| **Step 1: player noise** | Done in `js/movement/noise.js`. Every footstep emits a noise event (level, type, position, surface `concrete`, source). Reach per level 2.5 / 6 / 14 / 30 / 80 m, adjustable in `NoiseDefaults`. A coloured debug ring shows each reach (blue L1, green L2, yellow L3) and the stats panel shows the last event. No listeners yet. |
| **Step 2: surfaces** | Done. Three test strips (concrete, metal, grass) registered in the world's surface map. Surfaces never change the gait level or speed; they shift the effective intensity and scale the reach (`NoiseDefaults.surfaces`): jog reaches 14 m on concrete, 25 m on metal, 8.5 m on grass. Each surface has its own synthesized footstep sound (`FootstepAudioDefaults`). |
| **Step 3: guard vision** | Done. One stationary Regular-vision guard at (2, −16) facing the start, sharing the soldier model with a slate-blue uniform. Nested zones, distance/stance/movement factors, line of sight against walls and crates, Simple Cover (hidden when under half the body is visible), rapid recognition within 2 m, 1 s hold then −0.3/s decay. Developer view: zones, sight line, meter, stats rows. No hearing, memory, investigation or reactions. All values in `VisionDefaults` are initial test values. Checkpoint before this step: branch `checkpoint/before-step3` (commit `3d385da`). |
| **Step 4: guard hearing** | Done. The stationary guard (Regular hearing) hears footsteps within each event's reach × his sensitivity, remembers the last heard position, and after a 0.35 s beat turns on the spot (player's animator, in-place steps) to look there for 3 s before returning to his post. He faces where the sound was made, not the player. Vision is unchanged and turns with him; hearing never counts as detection. His model is turned so the idle stance's shoulders face along his vision. Checkpoint before this step: branch `checkpoint/before-step4` (commit `10fddd0`). |
| **Step 5: suspicion, investigation, awareness** | Done. NORMAL / SUSPICIOUS / INVESTIGATING / CONFIRMED (`guard-awareness.js`, all values in `AwarenessDefaults`). Sounds and partial sightings build suspicion (intensity, closeness, repetition in one area); it holds then fades. Significant suspicion sends him walking (own motor instance, nav paths around obstacles) to the last suspicious spot, where he searches, then walks back. 100% visual recognition confirms the threat permanently for now: he faces the last place he actually saw her and ignores sounds. The Step 4 three-second return is gone. RESET also resets the guard. Checkpoint before this step: branch `checkpoint/before-step5` (commit `ef93700`). |
| **Step 6: alert and evasion** | Done. ALERT on 100% recognition: he tracks her by sight and doesn't search or return while she's visible. Out of sight for 0.75 s: EVASION, a 30 s Active Search of the last place seen, where she was heading, escape directions and nearby hiding spots, never using her real position. Sounds while alerted give an approximate estimate (tighter for strong, close sounds) and meaningful ones redirect the search, adding 3 s each up to 40 s. Seeing her again re-alerts; losing her again restarts the 30 s. When the search runs out: HEIGHTENED PENDING (he settles; the 60 s phase is Step 7, below). All values in `AwarenessDefaults`. Checkpoint before this step: branch `checkpoint/before-step6` (commit `382a2b5`). |
| **Step 7: heightened security, return to post, safe spawn** | Done. When the Active Search runs out: HEIGHTENED SECURITY, 60 s of cautious work. He walks slower than the search (≈1.1 m/s) to a few checkpoints, corners and routes between his post and where he lost her, never more than 12 m from his post, and holds long look-around pauses at each. A meaningful sound sends him to check his estimate of it and adds 5 s, at most once per 8 s and never past 90 s in total. A weak sound only earns a glance. Then RETURN TO POST: he walks back by path, slows, stops, turns smoothly to his post facing and stands down to NORMAL (never while he can see her). His confirmation is spent and his suspicion drops to 30% and fades. A sighting during either phase re-alerts him and cancels the stand-down, and losing her again starts a fresh search. A meaningful sound during the walk back interrupts it for a 15 s check. Player spawn: (−17, −14), facing east into the yard, 19 m from the guard (beyond his 16 m range) and 84° off his facing, in open ground. It is set in one place (`SPAWN` in `test-area.js`), and RESET returns there standing, with the guard calm at his post and no memory, search or sound left. All values in `AwarenessDefaults`. Checkpoint before this step: branch `checkpoint/before-step7` (commit `77d510c`). |
| **Step 8: natural guard reactions** | Done. A calm guard's first meaningful sound opens one *incident*. He pauses (`reactDelay`, now 0.8 s), then reacts once: a quiet vocal "huh", his head turning toward the sound and his body following. He stands and assesses (`assessTime`, now 0.3 s) before he may walk off to investigate. Further footsteps in the same incident build suspicion and steer his attention as before, but never restart the pause, the reaction or the head turn, and don't interrupt his walk. A new reaction is possible only after he's been back in NORMAL and calm for `incidentCalmTime` (4 s). Sight always comes first: seeing her cancels the pause and replaces the vocal reaction, and ALERT is never delayed. Body language is a light procedural layer on his own bones: head and neck turn toward what he attends to (65° max, 2.6 rad/s), and a slight forward lean grows with tension (none at NORMAL, most in ALERT). There are no floating ?/! symbols and no popups. The voice is a replaceable hook (`guard-voice.js`): no recording ships yet (see `assets/audio/guard/README.md`), so it's silent and STATS → VOICE says so. Checkpoint before this step: branch `checkpoint/before-step8` (commit `b52da75`). |
| **Step 8.1: temporary reaction caption** | Done. A TEMPORARY stand-in until a recording exists: when his one-per-incident vocal reaction fires and no recording plays, a small "Huh" (13 px, muted, no punctuation) appears above his head. It fades in, holds about 1 s, then fades out, following him. It is hidden behind solid cover, beyond 24 m or off screen, and dismissed the moment he becomes ALERT. It changes nothing he does. Turn it off with `GuardCaptionDefaults.enabled = false`; to remove it, delete `guard-caption.js`, its script tag, `#mv-caption` and the lines marked `caption` in `main.js`. Checkpoint before this step: branch `checkpoint/before-step8-1` (commit `86eab2c`). |
| **Step 8.2: visual suspicion reactions** | Done. A calm guard's first partial glimpse of her (typically in his slower peripheral zone) opens an incident like a sound does. He pauses briefly (`visualReactDelay`, now 0.8 s), then reacts once: the same "huh" (caption for now). His head, then body, turn toward the last place he actually saw her, so his cone follows. Detection keeps filling normally throughout. Hearing and sight share the incident, so one reaction per incident whichever sense came first. Recognition wins: if his meter is already ≥ 80% when the reaction is due there is no "huh", and reaching 100% is ALERT on that frame, dismissing the caption. If she slips away first, his suspicion is kept and the existing awareness decides what's next. Zones, rates and ranges are unchanged. Checkpoint before this step: branch `checkpoint/before-step8-2` (commit `50539b1`). |
| **Step 8.3: reaction timing** | Done (after iPhone testing). The first-reaction pause is 0.8 s for both sounds (`reactDelay`) and glimpses (`visualReactDelay`). The caption is fully shown for 1.2 s (`GuardCaptionDefaults.hold`), then fades. `assessTime` drops from 0.6 to 0.3 s so his earliest walk-off to investigate stays at 1.1 s after the sound, as before: no added delay. Recognition during the pause is still ALERT at once. Checkpoint before this step: branch `checkpoint/before-step8-3` (commit `f620b4c`). |
| **Step 9: basic patrol** | Done. One guard walks a repeating route (`PATROL` in `test-area.js`; behaviour in `guard-patrol.js`). Waypoints: his post W0 (2, −16), W1 (12, −11) by the corridor entrance, W2 (6.5, −1) facing the surface strips, and W3 (0.5, −10.5) past the tall crate, walked straight through. He walks at a relaxed ≈1.15 m/s with his own motor, animator and nav paths. He turns toward each leg before setting off, slows into observation points, and stops for 1.5–3 s per point, facing a set direction and looking around (slightly different each lap). The patrol only runs while he's NORMAL. Suspicion, investigation, ALERT, search, Heightened Security and the walk back to his post all interrupt it. After an unsuccessful investigation he walks back to the waypoint he was heading for. After the full alert cycle he stands down at his post (Step 7), then rejoins the route at that waypoint. Every waypoint is > 16 m from the player's spawn. `enabled: false` gives the stationary guard. STATS → PATROL and a dashed route on the ground show his patrol state. Checkpoint before this step: branch `checkpoint/before-step9` (commit `3f55a3b`). |
| **Step 10: personality framework** | Done. `guard-personality.js`: every guard has exactly two permanent traits from Bored / Focused / Curious / Careless / Talkative / Hungry, a primary (weight 1) and a secondary (weight 0.4). They are frozen for the mission and `rollPersonality(seed, role)` gives future ordinary guards a seeded, role-weighted pair. Only Curious and Bored act yet, and only through small modifiers to existing decisions. **Curious** (while not alerted): heard sounds give 25% more suspicion; repeated sounds in one area add up faster (repeat boost +0.15, cap +0.5) and are remembered 4 s longer; 60% of incidents get a closer look (suspicion holds 1.5 s longer); he searches an investigation spot one more round while still suspicious. **Bored** (NORMAL only): at patrol stops he sometimes lingers 1–2.5 s or adds a casual look (up to 60°), pauses vary ±25%, and now and then he shifts his stance while standing (torso ≤ 6°, head ≤ 10°, eased). Hearing, vision and the 0.8 s reaction are untouched. ALERT / EVASION / HEIGHTENED / RETURNING put the personality on hold, and suspicion or investigation put the casual side on hold. The test guard is CURIOUS / BORED (`test-area.js`). STATS → PERSONA shows the traits, the current influence and any override. Checkpoint before this step: branch `checkpoint/before-step10` (commit `123bbf8`). |
| **Step 11: Focused and Careless** | Done. Both are modifiers in the Step 10 framework (`TraitEffects` in `guard-personality.js`); senses and the 0.8 s reaction are untouched. **Focused**: his suspicion holds 1 s longer and fades 35% slower, and repeats are remembered 3 s longer and add up a little faster. He assesses a sound 0.4 s longer after his reaction. At an investigation spot each look lasts 0.35 s longer, plus one round while still suspicious (still capped by `maxInvestigate`). On patrol, 75% of stops get a deliberate sweep to the uncovered side (+0.6–1.4 s). **Careless**: he notices and reacts to a faint sound like anyone. An isolated weak one (nothing else nearby) is then written off 70% of the time and his suspicion fades fast; any further sound nearby cancels the write-off and counts in full. His suspicion holds 1 s less and fades 30% faster. With ambiguous evidence (peak < 85%) he looks 0.3 s less and searches one round fewer (at least one). On patrol, 45% of stops are cut to 60% of the time without his last look. Strong evidence, recognition and anything while alerted are never discounted. When two traits push one patrol stop in opposite directions, the primary decides. Test profiles in `test-area.js`: A Curious/Bored, **B Focused/Bored (default)**, C Careless/Bored. Fix: Curious's sound-interest no longer leaks into alerted (search) sound handling. Checkpoint before this step: branch `checkpoint/before-step11` (commit `0b6325d`). |
| **Personality card (UI only)** | Done. `guard-traitcard.js` + `#mv-trait`: a small dark translucent card with a thin border, drawn in screen space from the guard's shoulder height (his body position, so it doesn't bob). It sits a fixed gap beside him, on the side away from the player on screen; a side change needs the player clearly past him for 1.2 s and is a quick fade, never a jump. It faces the camera and shrinks slightly with distance (12 px down to ≈ 10 px). It shows only while he's on screen, within 18 m and not completely hidden (sight lines to his head, chest and hips checked 8×/s; a cover change must hold for 3 checks, so there's no flicker), and fades in and out in 0.25 s. It sits below and beside the "Huh", clear of it. It reads only his traits and never changes what he does. Settings: `TraitCardDefaults` (enabled, reveal, maxDistance, fontSize, opacity, height / side / gap offset, fade times). Future scanner: documented only (§11). Checkpoint before this: branch `checkpoint/before-trait-card` (commit `b784b45`). |
| **Player stand-in** | The movement lab uses the Mixamo stand-in. The Phase 1A female operative (`assets/models/operative.glb`) is not yet wired in; swapping the final character is a profile change. |
