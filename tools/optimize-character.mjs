// Mobile pipeline for the operative GLB.
//   cd tools && npm install && npm run character
// - drops the 6 unused UV sets the Mixamo export carries (largest saving)
// - removes duplicate accessors/textures and unused data
// - resamples animation keys (lossless within tolerance)
// - renames clips and materials to project names
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, resample } from '@gltf-transform/functions';

const [src, dst] = process.argv.slice(2);
const io = new NodeIO();
const doc = await io.read(src);
const root = doc.getRoot();

for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (let i = 1; i <= 7; i++) {
      const a = prim.getAttribute(`TEXCOORD_${i}`);
      if (a) prim.setAttribute(`TEXCOORD_${i}`, null);
    }
  }
}

const clipNames = { Idle: 'idle', Walk: 'walk', Run: 'run', TPose: 'bindpose' };
for (const anim of root.listAnimations()) anim.setName(clipNames[anim.getName()] || anim.getName());
for (const m of root.listMaterials()) {
  m.setName(m.getName().includes('Visor') ? 'operative_visor' : 'operative_body');
  m.setMetallicFactor(0);
}
root.getAsset().generator = 'shadow-cell optimize-character';

await doc.transform(dedup(), resample(), prune());
await io.write(dst, doc);
console.log('wrote', dst);
