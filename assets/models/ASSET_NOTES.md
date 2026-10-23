# Model assets

| File | What it is | License |
|---|---|---|
| `operative.glb` | Lead operative, Phase 1A review build | Character from MakeHuman data (CC0 1.0) via [Ara 3D Gen](https://github.com/olatunde85/3d-gen) (MIT; exports free to use without attribution). Poncho, hood and recolours are this project's own work. |
| `operative.params.json` | Generator settings that reproduce the base character | — |

## Build stats
- About 40.7k triangles: body/clothes 34.1k, poncho 4.8k, hood 1.8k. 16 draw calls.
- 3.3 MB GLB: meshopt-compressed geometry, skin and hair textures at 1024², all other textures 512².
- Skeleton: 69-joint game rig with Mixamo bone names (no `mixamorig:` prefix), plus a `WeaponR` socket and jaw/eye bones.
- Clips kept: Idle, Crouch idle, Walk, Run, Walk backwards, Strafe L/R, Turn 45°/90° L/R, Pistol idle/aim, Rifle idle/aim/walk/run/sprint, Crouch aim idle, Crouch walk (aiming), Throw grenade.

## Rebuild
1. Generate `assets/source/operative_raw.glb` with Ara 3D Gen: `npm run export -- --params operative.params.json --formats glb`.
2. Then run `cd tools && npm install && npm run character`. `add-poncho.mjs` drapes and skins the poncho and hood. `optimize-operative.mjs` recolours the hair and coverall, resizes the textures, trims the clips and compresses the file.
