// Temporary playable character: Quaternius "Universal Animation Library" mannequin (CC0).
//   node optimize-ual.mjs <AnimationLibrary_Godot_Standard.glb> <out.glb>
// Keeps the locomotion + crouch clips used now and a few for later stages,
// then meshopt-compresses geometry and animation for iPhone.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const [src, dst] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const KEEP = new Set([
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop',
  // later stages
  'Roll', 'PickUp_Table', 'Interact', 'Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Aim_Down', 'Pistol_Shoot', 'Pistol_Reload',
]);
for (const a of doc.getRoot().listAnimations()) if (!KEEP.has(a.getName())) a.dispose();
await MeshoptEncoder.ready;
io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await doc.transform(dedup(), resample(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(dst, doc);
console.log('wrote', dst);
