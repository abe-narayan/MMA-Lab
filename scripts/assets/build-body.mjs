/**
 * Builds the runtime body asset for the character module from MakeHuman's MPFB2 data (CC0).
 *
 *   node scripts/dev/heavy.mjs node scripts/assets/build-body.mjs [--offline] [--out <dir>]
 *
 * Source: https://github.com/makehumancommunity/mpfb2 src/mpfb/data/ (CC0 1.0; LICENSE.ASSETS.md).
 * Downloads are cached in $MPFB_CACHE (default: <os tmpdir>/boutlab-mpfb2) so a rebuild is offline.
 *
 * Output (static/assets/body/, served at /assets/body/):
 *   body.json   header: counts, part ranges, bone order, joint references, target table,
 *               buffer table (name, type, byte offset, length) into body.bin
 *   body.bin    little-endian typed arrays, 4-byte aligned:
 *                 src.pos       f32  x3  MakeHuman A-pose rest positions, metres, three.js axes
 *                 src.skinIdx   u8   x4  canonical bone indices (rigData order)
 *                 src.skinW     u8   x4  weights, sum exactly 255
 *                 body.uv       f32  x2  per render vertex
 *                 body.src      u16      render vertex -> src vertex
 *                 body.idx0/1/2 u16/u32  LOD0 (quads split), LOD1, LOD2 triangle lists (render verts)
 *                 tights.idx    u32      helper-tights triangles (src verts)
 *                 teeth.idx     u32      helper-upper-teeth triangles (src verts)
 *                 t.<name>.i/.d u16 + i16x3  sparse morph deltas, quantised with a per-target scale
 *   masks/*.jpg MPFB2 region masks in the body UV layout (lips, nails, areolae, ears, eyelids, face,
 *               inside of the mouth)
 *
 * "src" vertices are the kept MakeHuman vertices: the body (13 380), helper-tights (for shorts),
 * helper-upper-teeth (mouthguard), then one virtual vertex per `joint-*` cube (the cube's mean) and
 * per helper eye (its centre). A virtual vertex's morph delta is the mean of its members' deltas, so
 * re-deriving a CUBE joint from a morphed body is exact, and the 1 000 cube vertices never ship.
 *
 * Deterministic: no clocks, no randomness, stable iteration orders; rerunning produces identical bytes.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const BASE = 'https://raw.githubusercontent.com/makehumancommunity/mpfb2/master/src/mpfb/data/';
const CACHE = process.env.MPFB_CACHE ?? join(tmpdir(), 'boutlab-mpfb2');
const OFFLINE = process.argv.includes('--offline');
const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg > 0 ? process.argv[outArg + 1] : 'static/assets/body');
const SCALE = 0.1; // MakeHuman decimetres -> metres

async function fetchCached(rel) {
  const file = join(CACHE, rel);
  if (existsSync(file)) return readFileSync(file);
  if (OFFLINE) throw new Error(`not cached: ${rel}`);
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + rel);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, buf);
      return buf;
    }
    if (res.status === 404 || attempt >= 3) throw new Error(`download failed ${res.status}: ${rel}`);
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
}

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

const RACES = ['african', 'asian', 'caucasian'];
const GENDERS = ['female', 'male'];
const AGES = ['young', 'old'];
const LEVELS = ['min', 'average', 'max'];

/** [storedName, relative path under targets/] */
const TARGETS = [];
for (const r of RACES) for (const g of GENDERS) for (const a of AGES) {
  TARGETS.push([`rga/${r}-${g}-${a}`, `macrodetails/${r}-${g}-${a}`]);
}
for (const g of GENDERS) for (const a of AGES) for (const m of LEVELS) for (const w of LEVELS) {
  if (m === 'average' && w === 'average') continue; // empty in MakeHuman
  TARGETS.push([`uni/${g}-${a}-${m}muscle-${w}weight`, `macrodetails/universal-${g}-${a}-${m}muscle-${w}weight`]);
}
// Height and proportion targets do not depend on muscle/weight in MPFB2 (verified: identical
// deltas for height, < 0.1 mm mean difference for proportions), so the average/average variant
// stands in for all nine and the muscle/weight factors sum out to 1.
for (const g of GENDERS) for (const a of AGES) {
  for (const h of ['min', 'max']) {
    TARGETS.push([`height/${g}-${a}-${h}`, `macrodetails/height/${g}-${a}-averagemuscle-averageweight-${h}height`]);
  }
  TARGETS.push([`prop/${g}-${a}-ideal`, `macrodetails/proportions/${g}-${a}-averagemuscle-averageweight-idealproportions`]);
}
const PAIRS = [
  'head/head-fat', 'head/head-scale-horiz', 'head/head-scale-depth',
  'chin/chin-width', 'chin/chin-prominent', 'chin/chin-height', 'chin/chin-bones', 'chin/chin-prognathism',
  'cheek/l-cheek-bones', 'cheek/r-cheek-bones', 'cheek/l-cheek-volume', 'cheek/r-cheek-volume',
  'nose/nose-scale-horiz', 'nose/nose-scale-vert', 'nose/nose-scale-depth', 'nose/nose-hump', 'nose/nose-flaring',
  'nose/nose-point-width', 'nose/nose-volume',
  'mouth/mouth-scale-horiz', 'mouth/mouth-lowerlip-volume', 'mouth/mouth-upperlip-volume',
  'ears/l-ear-scale', 'ears/r-ear-scale', 'ears/l-ear-flap', 'ears/r-ear-flap',
  'ears/l-ear-scale-depth', 'ears/r-ear-scale-depth',
  'neck/measure-neck-circ', 'neck/neck-scale-horiz',
  'torso/torso-vshape', 'torso/torso-muscle-dorsi', 'torso/torso-muscle-pectoral',
  'stomach/stomach-pregnant', 'stomach/stomach-tone',
  'arms/l-upperarm-muscle', 'arms/r-upperarm-muscle', 'arms/l-lowerarm-muscle', 'arms/r-lowerarm-muscle',
  'arms/l-upperarm-shoulder-muscle', 'arms/r-upperarm-shoulder-muscle',
  'legs/l-upperleg-muscle', 'legs/r-upperleg-muscle', 'legs/l-lowerleg-muscle', 'legs/r-lowerleg-muscle',
];
for (const p of PAIRS) for (const s of ['decr', 'incr']) TARGETS.push([`reg/${p.split('/')[1]}-${s}`, `${p}-${s}`]);
for (const p of [
  'head/head-square', 'head/head-oval', 'head/head-round', 'head/head-rectangular', 'head/head-triangular',
  'head/head-invertedtriangular', 'head/head-diamond', 'nose/nose-compression-compress',
  'eyebrows/eyebrows-trans-forward', 'eyebrows/eyebrows-trans-backward', 'eyebrows/eyebrows-angle-down',
  'eyebrows/eyebrows-angle-up', 'forehead/forehead-trans-forward', 'forehead/forehead-trans-backward',
]) TARGETS.push([`reg/${p.split('/')[1]}`, p]);
const EXPR = [
  'eye-left-closure', 'eye-right-closure', 'eye-left-slit', 'eye-right-slit',
  'eyebrows-left-down', 'eyebrows-right-down', 'eyebrows-left-inner-up', 'eyebrows-right-inner-up',
  'mouth-open', 'mouth-retraction', 'mouth-depression', 'mouth-compression', 'mouth-parling',
  'nose-left-elevation', 'nose-right-elevation', 'nose-left-dilatation', 'nose-right-dilatation',
];
for (const r of RACES) for (const e of EXPR) TARGETS.push([`expr/${r}/${e}`, `expression/units/${r}/${e}`]);

const MASKS = ['lips', 'fingernails', 'toenails', 'aureolae', 'ears', 'eyelids', 'face', 'inside-mouth'];

// ---------------------------------------------------------------------------
// Parse the base mesh
// ---------------------------------------------------------------------------

const objText = (await fetchCached('3dobjs/base.obj')).toString('utf8');
const V = [];
const VT = [];
const groups = new Map(); // name -> { faces: [[v...],[vt...]][], verts: Set }
let group = null;
for (const line of objText.split('\n')) {
  if (line.startsWith('v ')) {
    const p = line.slice(2).trim().split(/\s+/).map(Number);
    V.push(p);
  } else if (line.startsWith('vt ')) {
    const p = line.slice(3).trim().split(/\s+/).map(Number);
    VT.push(p);
  } else if (line.startsWith('g ')) {
    const name = line.slice(2).trim();
    if (!groups.has(name)) groups.set(name, { faces: [], verts: new Set() });
    group = groups.get(name);
  } else if (line.startsWith('f ')) {
    const corners = line.slice(2).trim().split(/\s+/).map((c) => c.split('/').map((x) => Number(x) - 1));
    group.faces.push(corners);
    for (const c of corners) group.verts.add(c[0]);
  }
}
const sortedVerts = (g) => [...groups.get(g).verts].sort((a, b) => a - b);

// Kept vertices.
const bodyVerts = sortedVerts('body');
const tightsVerts = sortedVerts('helper-tights');
const teethVerts = sortedVerts('helper-upper-teeth');
if (bodyVerts.length !== 13380 || bodyVerts[bodyVerts.length - 1] !== 13379) throw new Error('unexpected body range');
const cubeNames = [...groups.keys()].filter((g) => g.startsWith('joint-')).sort();
const virtualDefs = [
  ...cubeNames.map((n) => ({ name: n, members: sortedVerts(n) })),
  { name: 'eye-l', members: sortedVerts('helper-l-eye') },
  { name: 'eye-r', members: sortedVerts('helper-r-eye') },
];
// Single vertices named by MEAN joint references that lie outside the kept parts (some sit on
// joint cubes) are kept individually.
const rigJson = JSON.parse((await fetchCached('rigs/standard/rig.mixamo.json')).toString('utf8'));
const keptSet = new Set([...bodyVerts, ...tightsVerts, ...teethVerts]);
const refExtra = [...new Set(Object.values(rigJson.bones).flatMap((b) => [b.head, b.tail])
  .filter((j) => j.strategy !== 'CUBE').flatMap((j) => j.vertex_indices ?? []))]
  .filter((v) => !keptSet.has(v)).sort((a, b) => a - b);
const srcOf = new Map(); // original index -> src index
const srcOrig = []; // src index -> original index (or -1 for virtual)
for (const list of [bodyVerts, tightsVerts, teethVerts, refExtra]) {
  for (const v of list) { srcOf.set(v, srcOrig.length); srcOrig.push(v); }
}
const virtualBase = srcOrig.length;
for (let i = 0; i < virtualDefs.length; i++) srcOrig.push(-1);
const N = srcOrig.length;

// Blender/MPFB space -> three: the OBJ is already Y-up, facing +Z, in decimetres.
const srcPos = new Float32Array(N * 3);
for (let s = 0; s < virtualBase; s++) {
  const p = V[srcOrig[s]];
  srcPos[s * 3] = p[0] * SCALE; srcPos[s * 3 + 1] = p[1] * SCALE; srcPos[s * 3 + 2] = p[2] * SCALE;
}
virtualDefs.forEach((d, i) => {
  const s = virtualBase + i;
  for (const m of d.members) for (let k = 0; k < 3; k++) srcPos[s * 3 + k] += (V[m][k] * SCALE) / d.members.length;
});

// ---------------------------------------------------------------------------
// Bones and skin weights
// ---------------------------------------------------------------------------

const rigTs = readFileSync(resolve('src/presentation/rig/rigData.ts'), 'utf8');
const boneNames = [...rigTs.matchAll(/"name": "([A-Za-z0-9]+)"/g)].map((m) => m[1]);
if (boneNames.length !== 52) throw new Error(`expected 52 bones in rigData.ts, got ${boneNames.length}`);
const boneIdx = new Map(boneNames.map((n, i) => [n, i]));
const weightsJson = JSON.parse((await fetchCached('rigs/standard/weights.mixamo.json')).toString('utf8'));
const infl = Array.from({ length: V.length }, () => []);
for (const bone of Object.keys(weightsJson.weights).sort()) {
  const bi = boneIdx.get(bone.replace(/^mixamorig:/, ''));
  if (bi === undefined) throw new Error(`weights reference unknown bone ${bone}`);
  for (const [v, w] of weightsJson.weights[bone]) if (w > 0) infl[v].push([bi, w]);
}
const skinIdx = new Uint8Array(N * 4);
const skinW = new Uint8Array(N * 4);
function packInfluences(s, list) {
  const top = list.slice().sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
  const sum = top.reduce((t, x) => t + x[1], 0);
  if (!(sum > 0)) throw new Error(`src vertex ${s} has no skin weight`);
  let used = 0;
  const q = top.map((x) => Math.round((x[1] / sum) * 255));
  used = q.reduce((a, b) => a + b, 0);
  q[0] += 255 - used; // exact sum; the largest absorbs rounding
  for (let k = 0; k < 4; k++) {
    skinIdx[s * 4 + k] = k < top.length ? top[k][0] : top[0][0];
    skinW[s * 4 + k] = k < top.length ? q[k] : 0;
  }
}
for (let s = 0; s < virtualBase; s++) packInfluences(s, infl[srcOrig[s]]);
virtualDefs.forEach((d, i) => {
  const acc = new Map();
  for (const m of d.members) for (const [b, w] of infl[m]) acc.set(b, (acc.get(b) ?? 0) + w / d.members.length);
  packInfluences(virtualBase + i, [...acc.entries()]);
});

// Joint references resolved to src indices.
const cubeSrc = (name) => {
  const i = virtualDefs.findIndex((d) => d.name === name);
  if (i < 0) throw new Error(`no cube ${name}`);
  return virtualBase + i;
};
const refOf = (j) => {
  if (j.strategy === 'CUBE') return [cubeSrc(j.cube_name)];
  const out = (j.vertex_indices ?? []).map((v) => {
    const s = srcOf.get(v);
    if (s === undefined) throw new Error(`joint ref vertex ${v} not kept`);
    return s;
  });
  if (out.length === 0) throw new Error(`empty joint reference (${j.strategy})`);
  return out;
};
const jointRefs = boneNames.map((n) => {
  const b = rigJson.bones[`mixamorig:${n}`];
  return { head: refOf(b.head), tail: refOf(b.tail) };
});

// ---------------------------------------------------------------------------
// Render topology: body with UV seams split
// ---------------------------------------------------------------------------

const renderKey = new Map();
const renderSrc = [];
const renderUV = [];
// First pass: one render vertex per body vertex, using the first UV each vertex meets, so the
// first 13 380 render vertices are the src body vertices in order.
const firstUV = new Int32Array(13380).fill(-1);
for (const f of groups.get('body').faces) for (const [v, vt] of f) if (firstUV[v] < 0) firstUV[v] = vt;
for (let v = 0; v < 13380; v++) {
  renderKey.set(`${v}/${firstUV[v]}`, v);
  renderSrc.push(v);
  renderUV.push(VT[firstUV[v]][0], VT[firstUV[v]][1]);
}
const bodyTris = [];
for (const f of groups.get('body').faces) {
  const r = f.map(([v, vt]) => {
    const key = `${v}/${vt}`;
    let idx = renderKey.get(key);
    if (idx === undefined) {
      idx = renderSrc.length;
      renderKey.set(key, idx);
      renderSrc.push(v);
      renderUV.push(VT[vt][0], VT[vt][1]);
    }
    return idx;
  });
  // Split quads along the shorter diagonal (better shading on a curved body).
  if (r.length === 4) {
    const d02 = dist2(renderSrc[r[0]], renderSrc[r[2]]);
    const d13 = dist2(renderSrc[r[1]], renderSrc[r[3]]);
    if (d02 <= d13) bodyTris.push(r[0], r[1], r[2], r[0], r[2], r[3]);
    else bodyTris.push(r[0], r[1], r[3], r[1], r[2], r[3]);
  } else bodyTris.push(r[0], r[1], r[2]);
}
function dist2(a, b) {
  const p = V[a], q = V[b];
  return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
}
const helperTris = (g) => {
  const out = [];
  for (const f of groups.get(g).faces) {
    const s = f.map(([v]) => srcOf.get(v));
    if (s.length === 4) out.push(s[0], s[1], s[2], s[0], s[2], s[3]);
    else out.push(s[0], s[1], s[2]);
  }
  return out;
};
const tightsTris = helperTris('helper-tights');
const teethTris = helperTris('helper-upper-teeth');

// LODs: simplify the welded body (src positions) so UV seams cannot crack, then map each corner
// back to the render vertex of that src vertex whose UV is nearest the triangle's other corners.
const { MeshoptSimplifier } = await import('meshoptimizer');
await MeshoptSimplifier.ready;
const weldedTris = new Uint32Array(bodyTris.map((r) => renderSrc[r]));
const bodyPos = srcPos.slice(0, 13380 * 3);
const renderOfSrc = Array.from({ length: 13380 }, () => []);
renderSrc.forEach((s, r) => renderOfSrc[s].push(r));
function simplifyTo(targetTris) {
  const [idx] = MeshoptSimplifier.simplify(weldedTris, bodyPos, 3, targetTris * 3, 0.05, []);
  const out = new Uint32Array(idx.length);
  for (let t = 0; t < idx.length; t += 3) {
    for (let c = 0; c < 3; c++) {
      const s = idx[t + c];
      const cand = renderOfSrc[s];
      if (cand.length === 1) { out[t + c] = cand[0]; continue; }
      // Reference UV: the other two corners' first render vertices.
      let u = 0, w = 0;
      for (let o = 1; o <= 2; o++) {
        const r0 = renderOfSrc[idx[t + ((c + o) % 3)]][0];
        u += renderUV[r0 * 2] / 2; w += renderUV[r0 * 2 + 1] / 2;
      }
      let best = cand[0], bd = Infinity;
      for (const r of cand) {
        const d = (renderUV[r * 2] - u) ** 2 + (renderUV[r * 2 + 1] - w) ** 2;
        if (d < bd) { bd = d; best = r; }
      }
      out[t + c] = best;
    }
  }
  return out;
}
const lod1 = simplifyTo(9000);
const lod2 = simplifyTo(3200);

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

const bin = [];
let binLen = 0;
const buffers = {};
function addBuffer(name, arr) {
  const pad = (4 - (binLen % 4)) % 4;
  if (pad) { bin.push(Buffer.alloc(pad)); binLen += pad; }
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  buffers[name] = { type: arr.constructor.name, offset: binLen, length: arr.length };
  bin.push(Buffer.from(buf)); binLen += buf.length;
}

const targetTable = [];
const texts = new Map();
for (const [name, rel] of TARGETS) {
  const raw = await fetchCached(`targets/${rel}.target.gz`);
  texts.set(name, gunzipSync(raw).toString('utf8'));
}
// Virtual vertices need the original member deltas, so parse against the full index space once.
for (const [name] of TARGETS) {
  const text = texts.get(name);
  const full = new Float64Array(V.length * 3);
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const p = t.split(/\s+/);
    const v = Number(p[0]);
    full[v * 3] = Number(p[1]) * SCALE; full[v * 3 + 1] = Number(p[2]) * SCALE; full[v * 3 + 2] = Number(p[3]) * SCALE;
  }
  const d = new Float64Array(N * 3);
  for (let s = 0; s < virtualBase; s++) for (let k = 0; k < 3; k++) d[s * 3 + k] = full[srcOrig[s] * 3 + k];
  virtualDefs.forEach((def, i) => {
    for (const m of def.members) for (let k = 0; k < 3; k++) d[(virtualBase + i) * 3 + k] += full[m * 3 + k] / def.members.length;
  });
  let maxAbs = 0;
  const idx = [];
  for (let s = 0; s < N; s++) {
    const m = Math.max(Math.abs(d[s * 3]), Math.abs(d[s * 3 + 1]), Math.abs(d[s * 3 + 2]));
    if (m > 2e-6) { idx.push(s); if (m > maxAbs) maxAbs = m; }
  }
  if (idx.length === 0) { console.warn(`target ${name} is empty; skipped`); continue; }
  // Quantise with exactly the scale written to the header, so decoding is exact.
  const scale = Number(((maxAbs / 32767) * 1.00001).toPrecision(9));
  // Targets touching most vertices are stored densely (no index array).
  const dense = idx.length > N * 0.75;
  const list = dense ? Array.from({ length: N }, (_, s) => s) : idx;
  const qd = new Int16Array(list.length * 3);
  list.forEach((s, j) => { for (let k = 0; k < 3; k++) qd[j * 3 + k] = Math.round(d[s * 3 + k] / scale); });
  if (!dense) addBuffer(`t.${name}.i`, new Uint16Array(idx));
  addBuffer(`t.${name}.d`, qd);
  targetTable.push({ name, count: list.length, dense, scale });
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

addBuffer('src.pos', srcPos);
addBuffer('src.skinIdx', skinIdx);
addBuffer('src.skinW', skinW);
addBuffer('body.uv', new Float32Array(renderUV));
addBuffer('body.src', new Uint16Array(renderSrc));
addBuffer('body.idx0', new Uint16Array(bodyTris));
addBuffer('body.idx1', new Uint16Array(lod1));
addBuffer('body.idx2', new Uint16Array(lod2));
addBuffer('tights.idx', new Uint16Array(tightsTris));
addBuffer('teeth.idx', new Uint16Array(teethTris));

const binBuf = Buffer.concat(bin);
const header = {
  format: 'boutlab-body/1',
  source: 'MakeHuman MPFB2 data (CC0 1.0), github.com/makehumancommunity/mpfb2 src/mpfb/data; built by scripts/assets/build-body.mjs',
  units: 'metres; three.js axes (Y up, facing +Z); MakeHuman A-pose rest (arms down ~45 deg)',
  counts: {
    src: N, body: 13380, tights: tightsVerts.length, teeth: teethVerts.length,
    render: renderSrc.length, trisLod0: bodyTris.length / 3, trisLod1: lod1.length / 3, trisLod2: lod2.length / 3,
  },
  ranges: {
    body: [0, 13380],
    tights: [13380, 13380 + tightsVerts.length],
    teeth: [13380 + tightsVerts.length, 13380 + tightsVerts.length + teethVerts.length],
    refs: [13380 + tightsVerts.length + teethVerts.length, virtualBase],
    virtual: [virtualBase, N],
  },
  virtual: virtualDefs.map((d) => d.name),
  bones: boneNames,
  jointRefs,
  targets: targetTable,
  masks: MASKS.map((m) => `masks/mpfb_${m}.jpg`),
  buffers,
  binBytes: binBuf.length,
  binSha256: createHash('sha256').update(binBuf).digest('hex'),
};
mkdirSync(join(OUT, 'masks'), { recursive: true });
writeFileSync(join(OUT, 'body.bin'), binBuf);
writeFileSync(join(OUT, 'body.json'), JSON.stringify(header));
for (const m of MASKS) {
  const buf = await fetchCached(`textures/mpfb_${m}.jpg`);
  writeFileSync(join(OUT, 'masks', `mpfb_${m}.jpg`), buf);
}
console.log(`body asset: ${N} src verts, ${renderSrc.length} render verts, LOD tris ${header.counts.trisLod0}/${header.counts.trisLod1}/${header.counts.trisLod2}, ` +
  `${targetTable.length} targets, bin ${(binBuf.length / 1024).toFixed(0)} KiB, sha ${header.binSha256.slice(0, 12)}`);
