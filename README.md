# SHADOW CELL

A third-person tactical stealth game for the browser, built with Three.js and tuned for iPhone Safari in landscape. Four operatives infiltrate a jungle outpost, complete objectives, and extract without being seen.

## Build status

| Phase | Scope | Status |
|---|---|---|
| 1 | Jungle map, controllable operative, follow camera, touch controls | Playable (blocky placeholder operative) |
| 1A | Rigged human operative, character review stage, iPhone optimization | Paused: first operative build (poncho + hood) in `character.html`; appearance work resumes later |
| M1 | Movement Stage 1: idle, sneak, stealth walk, jog, crouch, turning, collision (`movement.html`) | **Ready for review** |
| 2 | Four selectable operatives, guard patrol AI, stealth detection | Next |
| 3 | Objectives, extraction, per-operative ranks and team grade | Planned |
| 4 | Squad AI orders (Follow / Hold / Hide / Regroup), full solo mode | Planned |
| 5 | Online co-op for four players with room codes | Planned |

### What Phase 1 includes

- **Mission 01 map, "Jungle Outpost":** about 200 × 200 m. It has trails, roughly 700 trees (broadleaf and palm), bushes, tall-grass patches, rocks, a fenced compound with three ways in (south gate, west breach, north-east crawl hole), a radio station with an antenna mast, barracks, a command shed with intel documents, a truck, crates, three watchtowers, two jungle guard posts, and the extraction LZ. Light fog and real-time shadows.
- **Operative movement:** stand, walk, run, sprint, crouch, crouch-walk, prone and crawl, each with its own procedural animation. Collision with all props. You can press against walls and crates and slide along them. Stones can be thrown as distractions (they make noise events that the Phase 2 guards will react to).
- **Stealth readouts:** a visibility percentage built from stance, movement, bushes, tall grass, canopy shade, lamp light and the operative's camo, plus a noise meter.
- **Camera:** third-person, over the shoulder, with smoothing. Drag to orbit. Aim mode zooms in. The camera swings out from walls when you take cover, avoids clipping through walls, and hides roofs while you are indoors.
- **HUD:** health and stamina bars, stance, concealment status, alert state, objective text, and a minimap that rotates with the camera.
- **Controls:** touch controls as listed below, plus keyboard and mouse for desktop testing.
- **Sound:** synthesized jungle ambience and footsteps (no audio files).
- **Performance:** quality scaling that drops resolution and shadows automatically on slow devices. Static props are merged into about 80 draw calls.

## Movement Stage 1 (`movement.html`)

A test yard with a mocap-animated stand-in character. Left thumb moves: a light push sneaks, a medium push is a stealth walk, a full push jogs. CROUCH toggles crouch (slow and fast crouch work the same way), and the right thumb turns the camera. The Controls table below is for the Phase 1 prototype (`index.html`). The architecture, tuning, and skeleton/clip requirements for the final character are in `docs/CHARACTER_CONTROLLER.md`.

## Phase 1A: operative review (`character.html`)

Open `character.html` to inspect the operative. Drag to orbit, pinch to zoom, and double-tap to reset. Use FRONT / LEFT / BACK / RIGHT / FACE for preset angles, T-POSE + RIG to check the skeleton, and STATS for FPS, render scale, draw calls, GPU and a copyable test report. The renderer caps the pixel ratio at 2× and steps quality down automatically if FPS stays under 50. It stops rendering while the tab is hidden and shows a loading bar, plus clear errors with a retry button.

See `assets/models/ASSET_NOTES.md` for the current model's source and license.

## Controls

| Touch (landscape) | Keyboard / mouse | Action |
|---|---|---|
| Drag on left side | WASD (X = walk) | Move. Push the stick further to run. |
| Drag on right side | Mouse drag | Look / orbit camera |
| STANCE tap / hold | C / Z | Crouch ↔ stand / prone |
| RUN | Shift | Sprint toggle (ends when you lift your thumb) |
| ACTION | E or Space | Context action: press to wall, take low cover, leave cover, check objects |
| AIM (hold) | Right mouse | Over-the-shoulder aim |
| FIRE | F | Throw a stone (aimed while holding AIM) |
| TAKE DOWN | Q | Reserved for Phase 2 |
| SQUAD | Tab | Squad orders menu (active in Phase 4) |
| II | Esc / P | Pause: quality, audio, restart |

## Run it

No build step. Any static file server works:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

To get one self-contained file you can AirDrop or host anywhere:

```bash
python3 tools/build_single.py   # writes dist/shadow-cell.html
```

## Play on iPhone

1. **Hosted preview:** open the preview link in Safari and turn the phone to landscape.
2. **GitHub Pages:** in the repository go to *Settings → Pages*, choose *Deploy from a branch*, and pick this branch with `/ (root)`. Open the `https://<user>.github.io/<repo>/` URL in Safari.
3. **Same Wi-Fi:** run `python3 -m http.server 8000` on your computer and open `http://<computer-ip>:8000` on the phone.

For a true full-screen view without Safari's bars, tap **Share → Add to Home Screen** and launch it from the icon.

## Project layout

```
index.html          page shell, HUD and control markup
css/style.css       HUD, touch controls, menus
lib/three.min.js    Three.js r128 (vendored)
js/util.js          PRNG, noise, math, spatial grid
js/world.js         map generation, colliders, concealment queries
js/operative.js     operative models, stats, procedural animation
js/player.js        movement, stances, cover, visibility/noise, stones
js/input.js         touch joystick/look/buttons + keyboard/mouse
js/camera.js        third-person follow / aim camera
js/hud.js           HUD, minimap, prompts
js/audio.js         synthesized ambience and foley
js/main.js          renderer, loop, menus, quality scaling
tools/build_single.py  single-file bundler
```

All models, the map, the interface and the sounds are original and generated in code.
