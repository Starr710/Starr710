# Model assets

| File | Source | License | Status |
|---|---|---|---|
| `operative.glb` | Mixamo "Vanguard" character, as shipped in the three.js examples (`examples/models/gltf/Soldier.glb`, r128) | Mixamo terms: royalty-free use inside projects; not for redistribution as a standalone asset | **Stand-in** used to validate the loader, skinning, shadows and iPhone performance. To be replaced by the final operative. |

`operative.glb` is produced by `tools/optimize-character.mjs`: it drops 6 unused UV sets, dedups, resamples the animation keys, and renames the clips to `idle`, `walk`, `run` and `bindpose`. That takes the file from 2.1 MB to 1.34 MB. The result is 11.4k triangles, 2 materials, two 1024² JPEG textures, and a 49-joint Mixamo-standard skeleton (`mixamorig*` bones), so Mixamo animation clips retarget directly.
