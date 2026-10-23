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
| **Player stand-in** | The movement lab uses the Mixamo stand-in. The Phase 1A female operative (`assets/models/operative.glb`) is not yet wired in; swapping the final character is a profile change. |
