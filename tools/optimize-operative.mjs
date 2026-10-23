// Mobile pipeline for the generated lead operative (Ara 3D Gen export).
//   cd tools && npm install && node optimize-operative.mjs <in.glb> <out.glb>
// - recolours hair and brows to the brief's blonde (the source textures are dark)
// - caps textures: skin/hair 1024², everything else 512²; opaque maps become JPEG
// - keeps only the animation clips the game will use
// - dedups, prunes, then meshopt-compresses geometry + animation (EXT_meshopt_compression)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [src, dst] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();

const KEEP_CLIPS = new Set([
  'Idle', 'Crouch idle', 'Walk', 'Run', 'Walk backwards', 'Strafe left', 'Strafe right',
  'Turn left 45°', 'Turn left 90°', 'Turn right 45°', 'Turn right 90°',
  'Pistol idle (low ready)', 'Pistol aim', 'Rifle idle (low ready)', 'Rifle aim idle',
  'Rifle walk (aiming)', 'Rifle run', 'Rifle sprint', 'Crouch aim idle', 'Crouch walk (aiming)', 'Throw grenade',
]);
for (const a of root.listAnimations()) if (!KEEP_CLIPS.has(a.getName())) a.dispose();

// blonde: map luminance onto a dark-gold → pale-wheat ramp, keep alpha
async function recolour(tex, dark, light, gamma) {
  const img = sharp(Buffer.from(tex.getImage()));
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    const t = Math.min(1, Math.pow(l, gamma) * 1.6);
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(dark[c] + (light[c] - dark[c]) * t);
  }
  const out = await sharp(data, { raw: info }).png().toBuffer();
  tex.setImage(new Uint8Array(out));
}

// work coverall: overalls → olive drab, undershirt → black (keeps the cloth shading)
async function recolourOutfit(tex) {
  const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const shirt = g > b + 25 && r > b + 5;
    const [d, hi, k] = shirt ? [[10, 10, 11], [58, 58, 60], 1.3] : [[30, 32, 19], [92, 96, 58], 1.15];
    const t = Math.min(1, l * k);
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(d[c] + (hi[c] - d[c]) * t);
  }
  tex.setImage(new Uint8Array(await sharp(data, { raw: info }).jpeg({ quality: 88 }).toBuffer()));
  tex.setMimeType('image/jpeg');
}

for (const m of root.listMaterials()) {
  const name = m.getName();
  if (name === 'Outfit' && m.getBaseColorTexture()) { await recolourOutfit(m.getBaseColorTexture()); m.setBaseColorFactor([1, 1, 1, 1]); }
  const base = m.getBaseColorTexture();
  if (name === 'Hair' && base) { await recolour(base, [92, 70, 34], [236, 214, 160], 0.7); m.setBaseColorFactor([1, 1, 1, 1]); }
  if (name === 'Eyebrows' && base) { await recolour(base, [70, 52, 28], [150, 118, 70], 1.0); }
}

const alphaTextures = new Set();
for (const m of root.listMaterials()) if (m.getAlphaMode() !== 'OPAQUE' && m.getBaseColorTexture()) alphaTextures.add(m.getBaseColorTexture());
const bigTextures = new Set();
for (const m of root.listMaterials()) if (['Skin', 'Hair', 'Outfit'].includes(m.getName()) && m.getBaseColorTexture()) bigTextures.add(m.getBaseColorTexture());

for (const tex of root.listTextures()) {
  const max = bigTextures.has(tex) ? 1024 : 512;
  let img = sharp(Buffer.from(tex.getImage())).resize(max, max, { fit: 'inside', withoutEnlargement: true });
  if (alphaTextures.has(tex)) { tex.setImage(new Uint8Array(await img.png({ compressionLevel: 9, palette: false }).toBuffer())); tex.setMimeType('image/png'); }
  else { tex.setImage(new Uint8Array(await img.flatten().jpeg({ quality: 86, mozjpeg: true }).toBuffer())); tex.setMimeType('image/jpeg'); tex.setURI(tex.getURI().replace(/\.png$/, '.jpg')); }
}

await MeshoptEncoder.ready;
io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await doc.transform(dedup(), resample(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(dst, doc);
console.log('wrote', dst);
