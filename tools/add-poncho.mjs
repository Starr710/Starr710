// Adds the lead operative's black hooded poncho to a generated character GLB.
//   node add-poncho.mjs <in.glb> <out.glb>
//
// The poncho is draped procedurally from the character's own bind-pose surface:
// for every direction around the body we take the furthest point of the torso,
// shoulders and upper arms at each height, then let the cloth hang straight down
// from the widest point above it (a running maximum), which is how a poncho
// tents off the shoulders. Folds and an uneven hem are layered on top. The hood
// is shaped the same way around the head and hair, open at the face.
// Both pieces are skinned by copying weights from the nearest body vertex, so
// they follow the skeleton and every animation clip with no cloth simulation.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const [src, dst] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const jIndex = Object.fromEntries(joints.map((j, i) => [j.getName().replace(/^mixamorig:?/, ''), i]));
const jPos = name => { const m = joints[jIndex[name]].getWorldMatrix(); return [m[12], m[13], m[14]]; };
const meshNode = root.listNodes().find(n => n.getSkin() === skin && n.getMesh());
const mesh = meshNode.getMesh();

// ---------------------------------------------------------------- body samples
const TORSO = new Set(['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder']);
const HEAD = new Set(['Head', 'HeadTop_End', 'Jaw', 'LeftEye', 'RightEye', 'Neck']);
const body = [], head = [], armTop = [];
const seen = new Set();
for (const prim of mesh.listPrimitives()) {
  const mat = prim.getMaterial()?.getName() || '';
  if (/Eye|Teeth|Tongue|Shoes|Boot/.test(mat)) continue;
  const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), Wt = prim.getAttribute('WEIGHTS_0');
  if (!P || !J || !Wt || seen.has(P)) continue;
  seen.add(P);
  const p = [], j = [], w = [];
  for (let i = 0; i < P.getCount(); i++) {
    P.getElement(i, p); J.getElement(i, j); Wt.getElement(i, w);
    let best = 0; for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
    const primary = joints[j[best]].getName().replace(/^mixamorig:?/, '');
    const v = { p: p.slice(), j: j.slice(), w: w.slice(), primary };
    if (TORSO.has(primary)) body.push(v);
    else if (/^(Left|Right)Arm$/.test(primary)) armTop.push(v);
    if (HEAD.has(primary) || mat === 'Hair') head.push(v);
  }
}

const neck = jPos('Neck'), hips = jPos('Hips'), headJ = jPos('Head'), lArm = jPos('LeftArm'), rArm = jPos('RightArm');
const cx = (lArm[0] + rArm[0]) / 2, cz = neck[2];
const yTop = neck[1] + 0.02;
const yHem = hips[1] - 0.30;                    // mid-thigh
console.log(`neck ${neck[1].toFixed(3)} hips ${hips[1].toFixed(3)} hem ${yHem.toFixed(3)} samples body ${body.length} head ${head.length}`);

// polar bins: max radius per (angle, height) — angle 0 = +Z (front)
function bin(samples, NA, y0, y1, NY, ox, oz) {
  const g = Array.from({ length: NY }, () => new Float32Array(NA));
  for (const s of samples) {
    const [x, y, z] = s.p;
    const yi = Math.floor((y1 - y) / (y1 - y0) * NY);
    if (yi < 0 || yi >= NY) continue;
    const a = Math.atan2(x - ox, z - oz);
    const ai = ((Math.round(a / (Math.PI * 2) * NA) % NA) + NA) % NA;
    const r = Math.hypot(x - ox, z - oz);
    if (r > g[yi][ai]) g[yi][ai] = r;
  }
  return g;
}
function blurRing(arr, passes) {
  const n = arr.length; let a = Float32Array.from(arr);
  for (let p = 0; p < passes; p++) { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = (a[(i - 1 + n) % n] + 2 * a[i] + a[(i + 1) % n]) / 4; a = b; }
  return a;
}

// ---------------------------------------------------------------- poncho shell
// Analytic drape fitted to her measurements: a superellipse cross-section that
// runs from the neck, over a rounded shoulder line, then flares to the hem.
// Wherever her body (torso, shoulders, chest, belt kit) sits further out, the
// cloth is pushed out over it, and it never pulls back in going down (gravity).
const NA = 72, NY = 34;
// the drape also clears the tops of the upper arms (deltoids), but is weighted to the torso only
const g = bin(body.concat(armTop.filter(v => v.p[1] > lArm[1] - 0.10)), NA, yHem, yTop + 0.02, NY, cx, cz);
for (let k = 0; k < 2; k++) for (const row of g) for (let i = 0; i < NA; i++) if (row[i] === 0) row[i] = Math.max(row[(i + 1) % NA], row[(i + NA - 1) % NA]);
const shoulderHalf = Math.abs(lArm[0] - rArm[0]) / 2 + 0.12;
const yShoulder = lArm[1] + 0.05;
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const superR = (a, w, d, n) => { const c = Math.abs(Math.sin(a)) / w, e = Math.abs(Math.cos(a)) / d; return 1 / Math.pow(Math.pow(c, n) + Math.pow(e, n), 1 / n); };
const neckRad = 0.075;
const radius = [];
let prev = null;
for (let yi = 0; yi < NY; yi++) {
  const y = yTop + (yHem - yTop) * yi / (NY - 1);
  const sh = Math.pow(smooth(yTop + 0.01, yShoulder - 0.14, y), 0.6);   // sloped shoulder line, neck → upper arm
  const fl = smooth(yShoulder, yHem, y);                        // flare below the shoulders
  const w = neckRad + (shoulderHalf - neckRad) * Math.sin(sh * Math.PI / 2) + 0.05 * fl;
  const d = neckRad + 0.075 * Math.sin(sh * Math.PI / 2) + 0.05 * fl + 0.02;
  const n = 2 + 0.35 * sh;
  const cur = new Float32Array(NA);
  for (let i = 0; i < NA; i++) {
    const a = i / NA * Math.PI * 2;
    cur[i] = Math.max(superR(a, w, d, n), g[yi][i] + 0.028, prev ? prev[i] * 0.997 : 0);
  }
  prev = blurRing(cur, 4);
  radius.push(prev);
}
const neckR = new Float32Array(NA).fill(neckRad + 0.01);

const pos = [], uv = [];
const rows = NY;
for (let yi = 0; yi < rows; yi++) {
  const t = yi / (rows - 1);
  for (let i = 0; i <= NA; i++) {
    const ai = i % NA, a = ai / NA * Math.PI * 2;
    const ft = Math.pow(smooth(yShoulder - 0.05, yHem, yTop + (yHem - yTop) * t), 1.2);
    const fold = (Math.sin(a * 11 + 0.6) * 0.016 + Math.sin(a * 6 - 1.1) * 0.012 + Math.sin(a * 17 + 2.3) * 0.005) * ft;
    const r = radius[yi][ai] + fold;
    let y = yTop + (yHem - yTop) * t;
    if (yi === rows - 1) y += -0.03 * Math.pow(Math.cos(a), 2) + 0.012 * Math.sin(a * 7);
    pos.push(cx + Math.sin(a) * r, y, cz + Math.cos(a) * r);
    uv.push(i / NA, t);
  }
}
const idx = [];
for (let yi = 0; yi < rows - 1; yi++) for (let i = 0; i < NA; i++) {
  const a = yi * (NA + 1) + i, b = a + NA + 1;
  idx.push(a, b, a + 1, a + 1, b, b + 1);
}

// ---------------------------------------------------------------- hood (up)
// Soft ellipsoid around the head (peaked slightly behind the crown), pushed out
// over head + hair. Each elevation row spans only the azimuths outside the face
// opening, so the opening is a clean oval rim rather than missing quads.
const hc = [headJ[0], headJ[1] + 0.075, headJ[2] - 0.02];
const HNA = 44, HNE = 20, E0 = -1.0, E1 = Math.PI / 2;
const hb = Array.from({ length: HNE + 1 }, () => new Float32Array(HNA));
for (const sp of head) {
  const dx = sp.p[0] - hc[0], dy = sp.p[1] - hc[1], dz = sp.p[2] - hc[2];
  const r = Math.hypot(dx, dy, dz), a = Math.atan2(dx, dz), e = Math.asin(dy / (r || 1));
  const ai = ((Math.round(a / (Math.PI * 2) * HNA) % HNA) + HNA) % HNA;
  const ei = Math.round((e - E0) / (E1 - E0) * HNE);
  if (ei >= 0 && ei <= HNE && r > hb[ei][ai]) hb[ei][ai] = r;
}
const hbS = hb.map(row => blurRing(row, 3));
const headR = (a, e) => {
  const ai = ((Math.round(a / (Math.PI * 2) * HNA) % HNA) + HNA) % HNA;
  const ei = Math.min(HNE, Math.max(0, Math.round((e - E0) / (E1 - E0) * HNE)));
  return hbS[ei][ai];
};
const gapAt = e => { const q = (e + 0.2) / 0.64; return q * q < 1 ? 0.98 * Math.sqrt(1 - q * q) : 0; };
const hpos = [], huv = [];
for (let ei = 0; ei <= HNE; ei++) {
  const e = E0 + (E1 - E0) * ei / HNE;
  const gap = Math.max(gapAt(e), 0.002);
  for (let i = 0; i <= HNA; i++) {
    const a = gap + (Math.PI * 2 - 2 * gap) * i / HNA;          // runs around the back, face gap at a = 0
    const back = 0.5 * (1 - Math.cos(a));
    const ce = Math.cos(e), se = Math.sin(e);
    const ell = 1 / Math.sqrt((ce * Math.sin(a) / 0.128) ** 2 + (se / (0.15 + 0.02 * back)) ** 2 + (ce * Math.cos(a) / (0.13 + 0.035 * back)) ** 2);
    let r = Math.max(ell, headR(a, e) + 0.03);
    if (gap > 0.01 && Math.abs(i - HNA / 2) > HNA / 2 - 1.5) r += 0.012;  // rolled rim
    let x = hc[0] + Math.sin(a) * ce * r, y = hc[1] + se * r, z = hc[2] + Math.cos(a) * ce * r;
    if (ei === 0) {                                              // bottom ring sits inside the poncho neck
      const nr = neckRad + 0.02;
      x = cx + Math.sin(a) * nr; y = yTop + 0.01; z = cz + Math.cos(a) * nr;
    }
    hpos.push(x, y, z);
    huv.push(i / HNA, ei / HNE);
  }
}
const hidx = [];
for (let ei = 0; ei < HNE; ei++) for (let i = 0; i < HNA; i++) {
  const p = ei * (HNA + 1) + i, q = p + HNA + 1;
  hidx.push(p, p + 1, q, p + 1, q + 1, q);
}

// ---------------------------------------------------------------- skinning
function skinFrom(samples, positions, override) {
  const J = new Uint16Array(positions.length / 3 * 4), Wt = new Float32Array(positions.length / 3 * 4);
  for (let v = 0; v < positions.length / 3; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    let best = null, bd = Infinity;
    for (const s of samples) { const d = (s.p[0] - x) ** 2 + (s.p[1] - y) ** 2 + (s.p[2] - z) ** 2; if (d < bd) { bd = d; best = s; } }
    const w = override ? override(y) : null;
    if (w) { for (let k = 0; k < 4; k++) { J[v * 4 + k] = w[k][0]; Wt[v * 4 + k] = w[k][1]; } continue; }
    for (let k = 0; k < 4; k++) { J[v * 4 + k] = best.j[k]; Wt[v * 4 + k] = best.w[k]; }
  }
  return { J, Wt };
}
const ps = skinFrom(body, pos);
const hs = skinFrom(head, hpos, y => {
  const t = SCsmooth(yTop, yTop + 0.12, y);   // neck → head blend
  return [[jIndex.Head, t], [jIndex.Neck, 1 - t], [jIndex.Spine2, 0], [jIndex.Hips, 0]];
});
function SCsmooth(a, b, v) { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); }

// ---------------------------------------------------------------- normals
function normals(P, I) {
  const N = new Float32Array(P.length);
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  // the shell winds so normals face inward; flip to face out
  for (let i = 0; i < N.length; i++) N[i] = -N[i];
  return N;
}
const flip = I => { const o = I.slice(); for (let i = 0; i < o.length; i += 3) [o[i + 1], o[i + 2]] = [o[i + 2], o[i + 1]]; return o; };

// ---------------------------------------------------------------- material: black waxed canvas
async function canvasTextures() {
  const S = 256, col = Buffer.alloc(S * S * 3), nrm = Buffer.alloc(S * S * 3);
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const weave = (Math.sin(x * Math.PI / 2) * 0.5 + 0.5) * ((y >> 1) & 1 ? 1 : 0.6) + (Math.sin(y * Math.PI / 2) * 0.5 + 0.5) * ((x >> 1) & 1 ? 0.6 : 1);
    hgt[y * S + x] = weave * 0.5 + rnd() * 0.15;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, n = rnd() * 6;
    const wear = 0.5 + 0.5 * Math.sin(x * 0.05 + Math.sin(y * 0.03) * 2) * Math.sin(y * 0.04);
    const v = 27 + n + wear * 6;
    col[i * 3] = v; col[i * 3 + 1] = v + 1; col[i * 3 + 2] = v + 3;
    const dx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x + S - 1) % S)];
    const dy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
    const l = Math.hypot(dx, dy, 0.6);
    nrm[i * 3] = (-dx / l * 0.5 + 0.5) * 255; nrm[i * 3 + 1] = (-dy / l * 0.5 + 0.5) * 255; nrm[i * 3 + 2] = (0.6 / l * 0.5 + 0.5) * 255;
  }
  const raw = { raw: { width: S, height: S, channels: 3 } };
  return [await sharp(col, raw).jpeg({ quality: 90 }).toBuffer(), await sharp(nrm, raw).png().toBuffer()];
}
const [colJpg, nrmPng] = await canvasTextures();
const tCol = doc.createTexture('poncho_color').setImage(new Uint8Array(colJpg)).setMimeType('image/jpeg');
const tNrm = doc.createTexture('poncho_normal').setImage(new Uint8Array(nrmPng)).setMimeType('image/png');
const ponchoMat = doc.createMaterial('Poncho').setBaseColorTexture(tCol).setNormalTexture(tNrm)
  .setRoughnessFactor(0.8).setMetallicFactor(0).setDoubleSided(true);
// texture repeats across the cloth
ponchoMat.getBaseColorTextureInfo().setWrapS(10497).setWrapT(10497);
ponchoMat.getNormalTextureInfo().setWrapS(10497).setWrapT(10497);
const tile = (arr, su, sv) => arr.map((v, i) => v * (i % 2 ? sv : su));

function addPrim(name, P, I, UV, S, material) {
  const acc = (type, arr, compType) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(P)))
    .setAttribute('NORMAL', acc('VEC3', normals(new Float32Array(P), I)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(UV)))
    .setAttribute('JOINTS_0', acc('VEC4', S.J))
    .setAttribute('WEIGHTS_0', acc('VEC4', S.Wt))
    .setIndices(acc('SCALAR', new Uint32Array(flip(I))))
    .setMaterial(material);
  prim.setExtras({ name });
  mesh.addPrimitive(prim);
}
addPrim('poncho', pos, idx, tile(uv, 40, 26), ps, ponchoMat);
const hoodMat = ponchoMat.clone().setName('Poncho hood');
addPrim('hood', hpos, hidx, tile(huv, 22, 12), hs, hoodMat);

await io.write(dst, doc);
console.log(`poncho ${idx.length / 3} tris, hood ${hidx.length / 3} tris -> ${dst}`);
