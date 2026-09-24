/**
 * CLOTHES FOR THE PEOPLE IN THE CAGE — cut from the body mesh, then tailored.
 *
 * The character module builds fighters (skin, shorts, gloves); the referee and
 * the cornermen need clothes over most of the body. Rather than modelling
 * garments, this cuts them from the wearer's own skinned body mesh (the way a
 * sculptor "extracts" clothing from a body), then tailors them:
 *
 *   - every vertex of the body is classified in the bind pose (MakeHuman's
 *     A-pose) by the bone that carries most of its weight and, along the limbs,
 *     by how far down the bone it sits: short sleeves end above the elbow,
 *     trousers at the ankle, shoes cover the foot, gloves the hand;
 *   - a garment is the triangles two of whose corners it claims, with the
 *     body's own skin indices and weights, so it bends exactly as the body does
 *     and needs no extra bones;
 *   - Taubin smoothing takes the anatomy out (no pecs, abs, crotch or calves);
 *   - drape: trouser legs hang as tubes around the leg bones (wider than the
 *     leg, not a second skin), with a looser seat; the shirt stands off the
 *     body and blouses over the waistband; sleeves flare to the hem;
 *   - one level of subdivision carries folds: a pressed crease down each
 *     trouser leg, compression folds behind the knee, the break over the shoe,
 *     pleats where the shirt is tucked in, diagonal pulls from the armpits.
 *     They are real geometry (offset along the normal, normals recomputed), and
 *     a per-vertex cavity term darkens the valleys;
 *   - trim built from the garments' own hems: a shirt collar (a stand and a
 *     fall) from the neck opening, a rib band for a crew neck, a leather belt
 *     with a buckle round the trousers' waistband; a small chest patch; black
 *     nitrile gloves (optional) over the hands;
 *   - the skin under the clothes is removed from the body's index buffers, so
 *     nothing pokes through at a bent knee and no skin shading is paid for
 *     pixels nobody sees.
 *
 * Cost: about 25 k triangles and five draw calls per dressed body (shirt,
 * trousers, shoes, trim, gloves), one shared material per garment kind.
 *
 * It only reads the actor's scene graph (meshes named `body-lod*`, the
 * shared skeleton, the `shorts` kit mesh) through three.js: the character
 * module's files are not touched. If the actor has no such meshes the caller
 * falls back to a capsule body.
 */
import * as THREE from 'three/webgpu';
import { attribute, float, mix, positionLocal, vec3 } from 'three/tsl';
import { releaseFromRenderer } from '../character/release';

type Garment = 'shirt' | 'trousers' | 'shoes' | 'gloves';
type V3 = [number, number, number];
type RGB = [number, number, number];

/** What someone wears. Colours are linear RGB. */
export interface Outfit {
  id: string;
  shirt: RGB;
  /** 'collar': a shirt collar (stand and fall); 'crew': a ribbed round neck. */
  neck: 'collar' | 'crew';
  /** A small patch on the left chest: 'boutlab' (the show's name), or none. */
  patch: 'boutlab' | null;
  trousers: RGB;
  /** 'slacks': pressed tubes, a belt; 'track': looser, tapered to a cuff, a side stripe. */
  cut: 'slacks' | 'track';
  /** Side stripe on track pants. */
  stripe: RGB | null;
  shoes: RGB;
  /** Sole colour (a sneaker's white sole, a dress shoe's black). */
  sole: RGB;
  /** Nitrile gloves over the hands (null: bare hands). */
  gloves: RGB | null;
}

/** The official: black short-sleeved shirt with a collar, black slacks and belt, black shoes, black gloves. */
export const REFEREE_OUTFIT: Outfit = {
  id: 'referee',
  shirt: [0.0075, 0.0078, 0.0085],
  neck: 'collar',
  patch: 'boutlab',
  trousers: [0.0062, 0.0064, 0.007],
  cut: 'slacks',
  stripe: null,
  shoes: [0.006, 0.006, 0.007],
  sole: [0.004, 0.004, 0.004],
  gloves: [0.006, 0.006, 0.0068],
};

/** A cornerman in a team shirt (the corner's colour), black track pants, sneakers. */
export function cornerOutfit(corner: 0 | 1, teamColour: RGB, cutman: boolean): Outfit {
  return {
    id: `corner${corner}${cutman ? 'c' : ''}`,
    shirt: teamColour,
    neck: 'crew',
    patch: null,
    trousers: [0.008, 0.008, 0.009],
    cut: 'track',
    stripe: [teamColour[0] * 0.9 + 0.02, teamColour[1] * 0.9 + 0.02, teamColour[2] * 0.9 + 0.02],
    shoes: [0.012, 0.012, 0.013],
    sole: [0.6, 0.6, 0.58],
    gloves: cutman ? [0.01, 0.02, 0.09] : null,
  };
}

export interface RefereeClothes {
  meshes: THREE.Mesh[];
  /** Triangles removed from the body (skin under clothes), per body LOD. */
  hiddenTriangles: number[];
  /** Triangles of all the clothes. */
  triangles: number;
  dispose(): void;
}

/** How far each garment stands off the skin (m), per region. */
const OFFSET = {
  shirt: 0.016, sleeve: 0.024, sleeveHem: 0.034, collar: 0.008, blouse: 0.014,
  trousers: 0.026, seat: 0.032, waistband: 0.03,
  shoes: 0.012, toe: 0.02, sole: 0.02, gloves: 0.0025,
} as const;

/**
 * Cloth does not follow every muscle: Taubin (lambda/mu) smoothing of the
 * garment surface in the bind pose takes the anatomy out (pecs, abs, the
 * crotch) without shrinking it, before the offset is applied. Hems stay put.
 */
const SMOOTH = { shirt: 10, trousers: 16, shoes: 4, gloves: 0 } as const;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Group vertices that share a position (UV seams) so cuts and smoothing see one surface. */
function weld(pos: ArrayLike<number>): { groupOf: Int32Array; count: number } {
  const n = pos.length / 3;
  const key = (v: number): string =>
    `${Math.round(pos[v * 3]! * 1e4)},${Math.round(pos[v * 3 + 1]! * 1e4)},${Math.round(pos[v * 3 + 2]! * 1e4)}`;
  const groupOf = new Int32Array(n);
  const ids = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const k = key(v);
    let g = ids.get(k);
    if (g === undefined) { g = ids.size; ids.set(k, g); }
    groupOf[v] = g;
  }
  return { groupOf, count: ids.size };
}

/**
 * Smooth `pos` (per vertex, xyz) over the triangles `tris`, welding vertices
 * that share a position (UV seams), keeping boundary vertices fixed, and
 * return smooth per-vertex normals of the result. Exported for the tests.
 */
export function smoothGarment(
  pos: Float32Array, tris: readonly number[], iterations: number,
  hem?: (v: number, p: [number, number, number]) => [number, number, number] | null,
  pinned?: (v: number) => boolean,
): Float32Array {
  const n = pos.length / 3;
  const { groupOf, count: G } = weld(pos);
  const gp = new Float64Array(G * 3);
  const cnt = new Float64Array(G);
  for (let v = 0; v < n; v++) {
    const g = groupOf[v]!;
    gp[g * 3] += pos[v * 3]!; gp[g * 3 + 1] += pos[v * 3 + 1]!; gp[g * 3 + 2] += pos[v * 3 + 2]!; cnt[g] += 1;
  }
  for (let g = 0; g < G; g++) { gp[g * 3] /= cnt[g]!; gp[g * 3 + 1] /= cnt[g]!; gp[g * 3 + 2] /= cnt[g]!; }
  // Edges (welded) and how many triangles use each: 1 = boundary.
  const edgeUse = new Map<number, number>();
  const nbr: Set<number>[] = Array.from({ length: G }, () => new Set<number>());
  for (let t = 0; t < tris.length; t += 3) {
    const c = [groupOf[tris[t]!]!, groupOf[tris[t + 1]!]!, groupOf[tris[t + 2]!]!];
    for (let e = 0; e < 3; e++) {
      const a = c[e]!, b = c[(e + 1) % 3]!;
      if (a === b) continue;
      nbr[a]!.add(b); nbr[b]!.add(a);
      const k = a < b ? a * G + b : b * G + a;
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }
  const fixed = new Uint8Array(G);
  for (const [k, u] of edgeUse) {
    if (u === 1) { fixed[Math.floor(k / G)] = 1; fixed[k % G] = 1; }
  }
  // Straighten the hems: a cut along triangle edges zigzags; each hem vertex
  // slides along its limb onto the cut plane (a clean cuff, a straight collar).
  if (hem) {
    for (let v = 0; v < n; v++) {
      const g = groupOf[v]!;
      if (!fixed[g]) continue;
      const q = hem(v, [gp[g * 3]!, gp[g * 3 + 1]!, gp[g * 3 + 2]!]);
      if (q) { gp[g * 3] = q[0]; gp[g * 3 + 1] = q[1]; gp[g * 3 + 2] = q[2]; }
    }
  }
  if (pinned) for (let v = 0; v < n; v++) if (pinned(v)) fixed[groupOf[v]!] = 1;
  const tmp = new Float64Array(G * 3);
  const pass = (f: number): void => {
    for (let g = 0; g < G; g++) {
      const ns = nbr[g]!;
      if (fixed[g] || ns.size === 0) { tmp[g * 3] = gp[g * 3]!; tmp[g * 3 + 1] = gp[g * 3 + 1]!; tmp[g * 3 + 2] = gp[g * 3 + 2]!; continue; }
      let x = 0, y = 0, z = 0;
      for (const o of ns) { x += gp[o * 3]!; y += gp[o * 3 + 1]!; z += gp[o * 3 + 2]!; }
      x /= ns.size; y /= ns.size; z /= ns.size;
      tmp[g * 3] = gp[g * 3]! + f * (x - gp[g * 3]!);
      tmp[g * 3 + 1] = gp[g * 3 + 1]! + f * (y - gp[g * 3 + 1]!);
      tmp[g * 3 + 2] = gp[g * 3 + 2]! + f * (z - gp[g * 3 + 2]!);
    }
    gp.set(tmp);
  };
  for (let i = 0; i < iterations; i++) { pass(0.5); pass(-0.53); }
  // Area-weighted normals on the welded surface.
  const gn = new Float64Array(G * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = groupOf[tris[t]!]!, b = groupOf[tris[t + 1]!]!, c = groupOf[tris[t + 2]!]!;
    const ux = gp[b * 3]! - gp[a * 3]!, uy = gp[b * 3 + 1]! - gp[a * 3 + 1]!, uz = gp[b * 3 + 2]! - gp[a * 3 + 2]!;
    const vx = gp[c * 3]! - gp[a * 3]!, vy = gp[c * 3 + 1]! - gp[a * 3 + 1]!, vz = gp[c * 3 + 2]! - gp[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const g of [a, b, c]) { gn[g * 3] += nx; gn[g * 3 + 1] += ny; gn[g * 3 + 2] += nz; }
  }
  const normals = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const g = groupOf[v]!;
    const l = Math.hypot(gn[g * 3]!, gn[g * 3 + 1]!, gn[g * 3 + 2]!) || 1;
    pos[v * 3] = gp[g * 3]!; pos[v * 3 + 1] = gp[g * 3 + 1]!; pos[v * 3 + 2] = gp[g * 3 + 2]!;
    normals[v * 3] = gn[g * 3]! / l; normals[v * 3 + 1] = gn[g * 3 + 1]! / l; normals[v * 3 + 2] = gn[g * 3 + 2]! / l;
  }
  return normals;
}

/** A garment in the making: positions, skinning, and the body vertex each came from (-1 = new). */
interface Piece {
  pos: Float32Array;
  si: Uint16Array;
  sw: Float32Array;
  src: Int32Array;
  tris: number[];
}

/** Mix two vertices' skin influences half and half, keeping the four strongest. */
function mixWeights(si: Uint16Array, sw: Float32Array, a: number, b: number, outI: Uint16Array, outW: Float32Array, o: number): void {
  const acc = new Map<number, number>();
  for (const v of [a, b]) {
    for (let k = 0; k < 4; k++) {
      const w = sw[v * 4 + k]!;
      if (w <= 0) continue;
      const bone = si[v * 4 + k]!;
      acc.set(bone, (acc.get(bone) ?? 0) + w * 0.5);
    }
  }
  const top = [...acc.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 4);
  const sum = top.reduce((s, x) => s + x[1], 0) || 1;
  for (let k = 0; k < 4; k++) {
    outI[o * 4 + k] = top[k]?.[0] ?? 0;
    outW[o * 4 + k] = (top[k]?.[1] ?? 0) / sum;
  }
}

/** One level of midpoint subdivision (each triangle into four). Edges shared by position stay shared. */
function subdivide(p: Piece): Piece {
  const n = p.pos.length / 3;
  const { groupOf } = weld(p.pos);
  const mids = new Map<string, number>();
  const extra: { a: number; b: number }[] = [];
  const mid = (a: number, b: number): number => {
    const ga = groupOf[a]!, gb = groupOf[b]!;
    // Keyed by the welded ends (and the actual vertices, so UV-split sides keep their own copies).
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    void ga; void gb;
    let m = mids.get(key);
    if (m === undefined) { m = n + extra.length; extra.push({ a, b }); mids.set(key, m); }
    return m;
  };
  const tris: number[] = [];
  for (let t = 0; t < p.tris.length; t += 3) {
    const a = p.tris[t]!, b = p.tris[t + 1]!, c = p.tris[t + 2]!;
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    tris.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const N = n + extra.length;
  const pos = new Float32Array(N * 3);
  const si = new Uint16Array(N * 4);
  const sw = new Float32Array(N * 4);
  const src = new Int32Array(N).fill(-1);
  pos.set(p.pos); si.set(p.si); sw.set(p.sw); src.set(p.src);
  extra.forEach(({ a, b }, i) => {
    const o = n + i;
    for (let k = 0; k < 3; k++) pos[o * 3 + k] = (p.pos[a * 3 + k]! + p.pos[b * 3 + k]!) / 2;
    mixWeights(p.si, p.sw, a, b, si, sw, o);
    src[o] = p.src[a]!;
  });
  return { pos, si, sw, src, tris };
}

/** Ordered boundary loops of a triangle set (welded), as vertex indices. */
function boundaryLoops(pos: Float32Array, tris: readonly number[]): number[][] {
  const { groupOf, count: G } = weld(pos);
  const rep = new Int32Array(G).fill(-1);
  for (let v = 0; v < groupOf.length; v++) if (rep[groupOf[v]!]! < 0) rep[groupOf[v]!] = v;
  const use = new Map<number, number>();
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = groupOf[tris[t + e]!]!, b = groupOf[tris[t + (e + 1) % 3]!]!;
      if (a === b) continue;
      const k = a < b ? a * G + b : b * G + a;
      use.set(k, (use.get(k) ?? 0) + 1);
    }
  }
  const adj = new Map<number, number[]>();
  for (const [k, u] of use) {
    if (u !== 1) continue;
    const a = Math.floor(k / G), b = k % G;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const seen = new Set<number>();
  const loops: number[][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let prev = -1;
    let cur = start;
    for (let guard = 0; guard < 100000; guard++) {
      seen.add(cur);
      loop.push(rep[cur]!);
      const next = (adj.get(cur) ?? []).find((x) => x !== prev && !seen.has(x));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 6) loops.push(loop);
  }
  return loops;
}

function centroid(pos: Float32Array, loop: readonly number[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const v of loop) { c[0] += pos[v * 3]!; c[1] += pos[v * 3 + 1]!; c[2] += pos[v * 3 + 2]!; }
  return [c[0] / loop.length, c[1] / loop.length, c[2] / loop.length];
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** Cloth: a fabric sheen (so black still reads under the top light), fold valleys darkened, optional trim colour. */
function clothMaterial(base: RGB, roughness: number, trim: RGB | null): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p: N = positionLocal;
  // A faint large-scale mottle (weave, wear), and the fold valleys darker.
  const mottle: N = p.x.mul(9.1).sin().mul(p.y.mul(7.3).add(p.z.mul(5.1)).sin()).mul(0.5).add(0.5);
  const cavity: N = attribute('cavity', 'float');
  let col: N = mix(vec3(...base), vec3(...base).mul(1.35), mottle.mul(0.45));
  if (trim) col = mix(col, vec3(...trim), attribute('trim', 'float'));
  m.colorNode = col.mul(float(1).sub(cavity.mul(0.55))) as N;
  m.roughnessNode = float(roughness) as N;
  m.metalnessNode = float(0) as N;
  const lum = Math.max(0.04, (base[0] + base[1] + base[2]) / 3);
  m.sheenNode = vec3(Math.min(0.3, lum * 2 + 0.08), Math.min(0.3, lum * 2 + 0.08), Math.min(0.3, lum * 2 + 0.09)) as N;
  m.sheenRoughnessNode = float(0.55) as N;
  return m;
}

/** Leather shoes / sneakers: glossier, a clear coat, the sole its own colour. */
function shoeMaterial(o: Outfit): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.colorNode = mix(vec3(...o.shoes), vec3(...o.sole), attribute('trim', 'float')) as N;
  m.roughnessNode = float(o.cut === 'slacks' ? 0.4 : 0.6) as N;
  m.metalnessNode = float(0) as N;
  m.clearcoatNode = float(o.cut === 'slacks' ? 0.55 : 0.1) as N;
  m.clearcoatRoughnessNode = float(0.3) as N;
  return m;
}

/** Nitrile: thin, semi-gloss rubber. */
function gloveMaterial(c: RGB): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.colorNode = vec3(...c) as N;
  m.roughnessNode = float(0.32) as N;
  m.metalnessNode = float(0) as N;
  m.clearcoatNode = float(0.35) as N;
  m.clearcoatRoughnessNode = float(0.25) as N;
  return m;
}

/** Belt leather and buckle metal in one material (trim = metal). */
function beltMaterial(): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.side = THREE.DoubleSide;
  const metal: N = attribute('trim', 'float');
  m.colorNode = mix(vec3(0.008, 0.007, 0.007), vec3(0.55, 0.55, 0.57), metal) as N;
  m.roughnessNode = mix(float(0.45), float(0.22), metal) as N;
  m.metalnessNode = metal as N;
  m.clearcoatNode = float(0.3) as N;
  return m;
}

/** The chest patch: "BOUT LAB" on charcoal with a gold keyline (a canvas texture; plain in a DOM-less test). */
function patchMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x1b1c1f, roughness: 0.7, metalness: 0 });
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 144;
    const g = c.getContext('2d');
    if (g) {
      g.fillStyle = '#1c1d21';
      g.fillRect(0, 0, 256, 144);
      g.strokeStyle = '#c9a24a';
      g.lineWidth = 8;
      g.strokeRect(8, 8, 240, 128);
      g.fillStyle = '#e9e6de';
      g.font = 'bold 50px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('BOUT LAB', 128, 76);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      m.map = tex;
      m.color.set(0xffffff);
    }
  }
  return m;
}

/**
 * Garment materials, shared by every figure wearing the same garment (and
 * across bouts). Keyed by content: `sig` carries the colours a material bakes
 * in, so a corner in the other team colour gets its own material instead of
 * the first bout's. Bounded: outfits come from the fixed team palette.
 */
const materials = new Map<string, THREE.Material>();
function material(key: string, make: () => THREE.Material, sig = ''): THREE.Material {
  const k = sig ? `${key}|${sig}` : key;
  let m = materials.get(k);
  if (!m) {
    m = make();
    m.name = key;
    materials.set(k, m);
  }
  return m;
}

/** The colours a garment material bakes in (the shirt; trousers' stripe and the collar derive from it). */
function colourSig(o: Outfit): string {
  return o.shirt.map((v) => v.toFixed(4)).join(',');
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

interface Classified {
  garment: Array<Garment | null>;
  offset: Float32Array;
  /**
   * Per vertex, the limb segment its garment is cut across (a → b, bind pose)
   * and where along it the cut lies (`hemT`, NaN where no hem applies).
   */
  hemA: Float32Array;
  hemB: Float32Array;
  hemT: Float32Array;
}

export interface ClassifyOptions {
  /** Cover the hands (gloves). */
  gloves?: boolean;
}

/**
 * Classify every body vertex (bind pose) into a garment, or skin (null), and
 * choose its offset. Pure over the arrays; exported for the tests.
 */
export function classifyVertices(
  position: ArrayLike<number>, skinIndex: ArrayLike<number>, skinWeight: ArrayLike<number>,
  boneNames: readonly string[], bindJoint: (bone: number) => [number, number, number],
  opts: ClassifyOptions = {},
): Classified {
  const n = position.length / 3;
  const garment: Array<Garment | null> = new Array(n).fill(null);
  const offset = new Float32Array(n);
  const hemA = new Float32Array(n * 3);
  const hemB = new Float32Array(n * 3);
  const hemT = new Float32Array(n).fill(NaN);
  const setHem = (v: number, a: [number, number, number] | null, b: [number, number, number] | null, t: number): void => {
    if (!a || !b) return;
    hemA.set(a, v * 3); hemB.set(b, v * 3); hemT[v] = t;
  };
  const idx = (name: string): number => boneNames.indexOf(name);
  const joint = (name: string): [number, number, number] | null => {
    const i = idx(name);
    return i >= 0 ? bindJoint(i) : null;
  };
  /** 0 at `from`'s joint, 1 at `to`'s joint, along the segment. */
  const along = (px: number, py: number, pz: number, from: string, to: string): number => {
    const a = joint(from);
    const b = joint(to);
    if (!a || !b) return 0.5;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const l2 = dx * dx + dy * dy + dz * dz || 1;
    return ((px - a[0]) * dx + (py - a[1]) * dy + (pz - a[2]) * dz) / l2;
  };
  const neck = joint('Neck');
  const hips = joint('Hips');
  for (let v = 0; v < n; v++) {
    // Dominant bone.
    let best = -1;
    let bw = 0;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight[v * 4 + k];
      if (w > bw) { bw = w; best = skinIndex[v * 4 + k]; }
    }
    const name = best >= 0 ? boneNames[best] ?? '' : '';
    const px = position[v * 3], py = position[v * 3 + 1], pz = position[v * 3 + 2];
    let g: Garment | null = null;
    let off = 0;
    switch (name) {
      case 'Spine': case 'Spine1': case 'Spine2': case 'LeftShoulder': case 'RightShoulder':
        g = 'shirt'; off = OFFSET.shirt;
        break;
      case 'Neck':
        // A collar: the lower part of the neck only.
        if (neck && py < neck[1] + 0.035) {
          g = 'shirt'; off = OFFSET.collar;
          setHem(v, neck, [neck[0], neck[1] + 0.1, neck[2]], 0.35);
        }
        break;
      case 'LeftArm': case 'RightArm': {
        const side = name.startsWith('Left') ? 'Left' : 'Right';
        const t = along(px, py, pz, `${side}Arm`, `${side}ForeArm`);
        // Short sleeves end a hand's width above the elbow, flaring to the hem.
        if (t < 0.78) {
          g = 'shirt';
          off = t < 0.6 ? OFFSET.shirt + (OFFSET.sleeve - OFFSET.shirt) * Math.max(0, t / 0.6)
            : OFFSET.sleeve + (OFFSET.sleeveHem - OFFSET.sleeve) * ((t - 0.6) / 0.18);
        }
        setHem(v, joint(`${side}Arm`), joint(`${side}ForeArm`), 0.78);
        break;
      }
      case 'LeftForeArm': case 'RightForeArm': {
        if (!opts.gloves) break;
        const side = name.startsWith('Left') ? 'Left' : 'Right';
        const t = along(px, py, pz, `${side}ForeArm`, `${side}Hand`);
        // The glove's cuff comes a little up the wrist.
        if (t > 0.9) { g = 'gloves'; off = OFFSET.gloves; }
        setHem(v, joint(`${side}ForeArm`), joint(`${side}Hand`), 0.9);
        break;
      }
      case 'Hips':
        g = 'trousers';
        off = hips && py > hips[1] + 0.02 ? OFFSET.waistband : OFFSET.seat;
        break;
      case 'LeftUpLeg': case 'RightUpLeg':
        g = 'trousers'; off = OFFSET.trousers;
        break;
      case 'LeftLeg': case 'RightLeg': {
        const side = name.startsWith('Left') ? 'Left' : 'Right';
        const t = along(px, py, pz, `${side}Leg`, `${side}Foot`);
        if (t < 0.9) { g = 'trousers'; off = OFFSET.trousers; }
        else { g = 'shoes'; off = OFFSET.shoes; }
        setHem(v, joint(`${side}Leg`), joint(`${side}Foot`), 0.9);
        break;
      }
      case 'LeftFoot': case 'RightFoot': case 'LeftToeBase': case 'RightToeBase':
        g = 'shoes'; off = py < 0.03 ? OFFSET.sole : name.includes('Toe') ? OFFSET.toe : OFFSET.shoes;
        break;
      default:
        // Hands and fingers (LeftHand, LeftHandIndex1, …).
        if (opts.gloves && /^(Left|Right)Hand/.test(name)) { g = 'gloves'; off = OFFSET.gloves; }
        break;
    }
    garment[v] = g;
    offset[v] = off;
  }
  return { garment, offset, hemA, hemB, hemT };
}

// ---------------------------------------------------------------------------
// Tailoring
// ---------------------------------------------------------------------------

interface Joints {
  get(name: string): V3 | null;
}

/** Leg bone axis (bind pose) a vertex belongs to, by its dominant bone name. */
function legAxis(name: string, j: Joints): [V3, V3] | null {
  const m = /^(Left|Right)(UpLeg|Leg)$/.exec(name);
  if (!m) return null;
  const a = j.get(`${m[1]}${m[2]}`);
  const b = j.get(m[2] === 'UpLeg' ? `${m[1]}Leg` : `${m[1]}Foot`);
  return a && b ? [a, b] : null;
}

/** Radius (m) a trouser leg hangs at, along the leg (0 hip .. 1 knee .. 2 ankle). */
function tubeRadius(u: number, cut: Outfit['cut'], k: number): number {
  if (cut === 'track') {
    // Loose to the knee, tapering to an elastic cuff.
    return (u < 1 ? 0.102 - 0.012 * u : u < 1.75 ? 0.09 - 0.008 * (u - 1) : 0.084 - 0.04 * (u - 1.75) / 0.25) * k;
  }
  // Slacks: a straight leg, a touch narrower at the hem.
  return (u < 1 ? 0.1 - 0.012 * u : 0.088 - 0.006 * (u - 1)) * k;
}

/**
 * Where a vertex's fold displacement goes (m, along the normal): pressed
 * creases, knee compression, the break at the hem, the tuck pleats, armpit
 * pulls. Pure over bind-pose coordinates.
 */
function foldAt(
  g: Garment, name: string, p: V3, j: Joints, cut: Outfit['cut'], neckY: number, waistY: number,
): number {
  if (g === 'trousers') {
    const ax = legAxis(name, j);
    if (ax) {
      const [a, b] = ax;
      // Angle round the leg: 0 = front.
      const cx = p[0] - (a[0] + b[0]) / 2;
      const cz = p[2] - (a[2] + b[2]) / 2;
      const th = Math.atan2(cx, cz);
      const knee = j.get(name.startsWith('Left') ? 'LeftLeg' : 'RightLeg');
      const kneeY = knee ? knee[1] : 0.49;
      const hemY = 0.1;
      const eK = Math.exp(-(((p[1] - kneeY) / 0.075) ** 2));
      const eH = Math.exp(-(((p[1] - hemY - 0.07) / 0.06) ** 2));
      let f = 0.0038 * eK * Math.sin((2 * Math.PI * p[1]) / 0.046 + 1.8 * Math.sin(th));
      f += 0.005 * eH * Math.sin((2 * Math.PI * p[1]) / 0.04 + 2.4 * Math.sin(2 * th));
      f += 0.0014 * Math.sin((2 * Math.PI * p[1]) / 0.12 + 3 * Math.sin(th + 0.7));
      // Slacks: a pressed crease down the front and back of each leg.
      if (cut === 'slacks') f += 0.0032 * (Math.exp(-((th / 0.13) ** 2)) + Math.exp(-(((Math.abs(th) - Math.PI) / 0.13) ** 2))) * (1 - eH);
      return f;
    }
    // Seat and fly: soft pulls toward the crotch.
    return 0.0018 * Math.sin((2 * Math.PI * (p[1] + Math.abs(p[0]) * 0.8)) / 0.07);
  }
  if (g === 'shirt') {
    const th = Math.atan2(p[0], p[2]);
    // Bloused over the waistband: vertical pleats from the tuck.
    const eW = Math.exp(-(((p[1] - (waistY + 0.06)) / 0.05) ** 2));
    let f = 0.0042 * eW * Math.sin(th * 11 + 0.6 * Math.sin(p[1] * 40));
    // Pulls from the armpits across the chest and back.
    const eA = Math.exp(-(((p[1] - (neckY - 0.2)) / 0.09) ** 2)) * Math.min(1, Math.abs(p[0]) / 0.12);
    f += 0.0026 * eA * Math.sin((2 * Math.PI * (p[1] * 0.8 + Math.abs(p[0]) * 0.6)) / 0.065);
    // Sleeves: rings near the hem.
    if (/Arm$/.test(name)) f += 0.0022 * Math.sin((2 * Math.PI * Math.abs(p[0])) / 0.05);
    return f;
  }
  return 0;
}

/**
 * Dress a built character. Returns null when the actor does not expose the
 * body meshes this needs (the caller then uses a capsule body).
 */
export function dressFigure(root: THREE.Object3D, outfit: Outfit): RefereeClothes | null {
  const bodies: THREE.SkinnedMesh[] = [];
  let shorts: THREE.Object3D | null = null;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && /^body-lod\d/.test(m.name)) bodies.push(m);
    if (o.name === 'shorts') shorts = o;
  });
  if (bodies.length === 0) return null;
  bodies.sort((a, b) => a.name.localeCompare(b.name));
  const src = bodies[Math.min(1, bodies.length - 1)]!;
  const geo = src.geometry;
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const skeleton = src.skeleton;
  if (!pos || !nrm || !si || !sw || !skeleton || !geo.index) return null;

  const names = skeleton.bones.map((b) => b.name);
  const inv = new THREE.Matrix4();
  const bindJoint = (i: number): [number, number, number] => {
    inv.copy(skeleton.boneInverses[i]!).invert();
    const e = inv.elements;
    return [e[12]!, e[13]!, e[14]!];
  };
  const joints: Joints = {
    get: (name) => { const i = names.indexOf(name); return i >= 0 ? bindJoint(i) : null; },
  };
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const SI = new Uint16Array(n * 4);
  const SW = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    P[v * 3] = pos.getX(v); P[v * 3 + 1] = pos.getY(v); P[v * 3 + 2] = pos.getZ(v);
    SI[v * 4] = si.getX(v); SI[v * 4 + 1] = si.getY(v); SI[v * 4 + 2] = si.getZ(v); SI[v * 4 + 3] = si.getW(v);
    SW[v * 4] = sw.getX(v); SW[v * 4 + 1] = sw.getY(v); SW[v * 4 + 2] = sw.getZ(v); SW[v * 4 + 3] = sw.getW(v);
  }
  const cls = classifyVertices(P, SI, SW, names, bindJoint, { gloves: !!outfit.gloves });
  const dominant = (siA: Uint16Array, swA: Float32Array, v: number): string => {
    let best = -1;
    let bw = 0;
    for (let k = 0; k < 4; k++) { const w = swA[v * 4 + k]!; if (w > bw) { bw = w; best = siA[v * 4 + k]!; } }
    return best >= 0 ? names[best] ?? '' : '';
  };
  const neckJ = joints.get('Neck');
  const hipsJ = joints.get('Hips');
  const headJ = joints.get('Head');
  const k = neckJ ? neckJ[1] / 1.479 : 1;
  const neckY = neckJ ? neckJ[1] : 1.48;
  const waistY = hipsJ ? hipsJ[1] + 0.07 : 1.03;

  const meshes: THREE.Mesh[] = [];
  const geos: THREE.BufferGeometry[] = [];
  let triangles = 0;
  const index = geo.index.array;
  const trim: { shirtNeck: number[] | null; waist: number[] | null; shirt: Piece | null; trousers: Piece | null } = {
    shirtNeck: null, waist: null, shirt: null, trousers: null,
  };

  const addMesh = (g: THREE.BufferGeometry, mat: THREE.Material, name: string): void => {
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1.3);
    const mesh = new THREE.SkinnedMesh(g, mat);
    mesh.name = name;
    mesh.bind(skeleton, src.bindMatrix.clone());
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    meshes.push(mesh);
    geos.push(g);
    triangles += (g.index?.count ?? 0) / 3;
  };

  for (const g of ['shirt', 'trousers', 'shoes', 'gloves'] as const) {
    if (g === 'gloves' && !outfit.gloves) continue;
    const remap = new Int32Array(n).fill(-1);
    const tris: number[] = [];
    let count = 0;
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t]!, b = index[t + 1]!, c = index[t + 2]!;
      // A triangle belongs to the garment when two of its corners do; the
      // third (skin side of a hem) is pulled onto the garment's surface too.
      const inG = (cls.garment[a] === g ? 1 : 0) + (cls.garment[b] === g ? 1 : 0) + (cls.garment[c] === g ? 1 : 0);
      if (inG < 2) continue;
      for (const v of [a, b, c]) if (remap[v] < 0) remap[v] = count++;
      tris.push(remap[a]!, remap[b]!, remap[c]!);
    }
    if (tris.length === 0) continue;
    let piece: Piece = {
      pos: new Float32Array(count * 3), si: new Uint16Array(count * 4), sw: new Float32Array(count * 4),
      src: new Int32Array(count), tris,
    };
    const go = new Float32Array(count);
    for (let v = 0; v < n; v++) {
      const r = remap[v]!;
      if (r < 0) continue;
      piece.src[r] = v;
      go[r] = cls.garment[v] === g ? cls.offset[v]! : g === 'shoes' ? OFFSET.shoes : g === 'gloves' ? OFFSET.gloves : OFFSET.shirt * 0.8;
      for (let q = 0; q < 3; q++) piece.pos[r * 3 + q] = P[v * 3 + q]!;
      for (let q = 0; q < 4; q++) { piece.si[r * 4 + q] = SI[v * 4 + q]!; piece.sw[r * 4 + q] = SW[v * 4 + q]!; }
    }
    // Drape: smooth the anatomy out (hems straightened), then stand the cloth off the skin.
    const hem = (r: number, p: [number, number, number]): [number, number, number] | null => {
      const v = piece.src[r]!;
      const T = cls.hemT[v]!;
      if (!Number.isFinite(T)) return null;
      const a = [cls.hemA[v * 3]!, cls.hemA[v * 3 + 1]!, cls.hemA[v * 3 + 2]!];
      const b = [cls.hemB[v * 3]!, cls.hemB[v * 3 + 1]!, cls.hemB[v * 3 + 2]!];
      const d = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const l2 = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]! || 1;
      const t = ((p[0] - a[0]!) * d[0]! + (p[1] - a[1]!) * d[1]! + (p[2] - a[2]!) * d[2]!) / l2;
      if (Math.abs(T - t) > 0.25) return null;
      return [p[0] + d[0]! * (T - t), p[1] + d[1]! * (T - t), p[2] + d[2]! * (T - t)];
    };
    const gn = smoothGarment(piece.pos, piece.tris, SMOOTH[g], hem);
    const tubed = new Uint8Array(count);
    for (let r = 0; r < count; r++) {
      const name = dominant(piece.si, piece.sw, r);
      const p: V3 = [piece.pos[r * 3]!, piece.pos[r * 3 + 1]!, piece.pos[r * 3 + 2]!];
      const ax = g === 'trousers' ? legAxis(name, joints) : null;
      if (ax) {
        // Trouser legs hang as tubes round the leg bone, never tighter than the offset.
        const [a, b] = ax;
        const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2));
        const c: V3 = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
        const rv: V3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
        const rl = Math.hypot(rv[0], rv[1], rv[2]) || 1;
        const u = (/UpLeg$/.test(name) ? 0 : 1) + t;
        const R = Math.max(rl + go[r]!, tubeRadius(u, outfit.cut, k));
        let x = c[0] + (rv[0] / rl) * R;
        // The inner sides of the two legs meet at the crotch, never cross.
        if (Math.sign(x) !== Math.sign(c[0]) || Math.abs(x) < 0.012) x = Math.sign(c[0] || 1) * 0.012;
        piece.pos[r * 3] = x;
        piece.pos[r * 3 + 1] = c[1] + (rv[1] / rl) * R;
        piece.pos[r * 3 + 2] = c[2] + (rv[2] / rl) * R;
        tubed[r] = 1;
        continue;
      }
      let off = go[r]!;
      // The shirt blouses over the waistband.
      if (g === 'shirt') off += OFFSET.blouse * Math.exp(-(((p[1] - (waistY + 0.05)) / 0.06) ** 2));
      for (let q = 0; q < 3; q++) piece.pos[r * 3 + q] += gn[r * 3 + q]! * off;
    }
    // Blend the tube into the seat.
    if (g === 'trousers') smoothGarment(piece.pos, piece.tris, 2, undefined, (v) => tubed[v] === 1 && piece.pos[v * 3 + 1]! < waistY - 0.25);
    // Trim loops come from the tailored surface before subdivision.
    if (g === 'shirt' || g === 'trousers') {
      const loops = boundaryLoops(piece.pos, piece.tris);
      const byHeight = loops.map((l) => ({ l, y: centroid(piece.pos, l)[1] })).sort((x, y) => y.y - x.y);
      if (g === 'shirt') { trim.shirtNeck = byHeight[0]?.l ?? null; trim.shirt = piece; }
      else { trim.waist = byHeight[0]?.l ?? null; trim.trousers = piece; }
    }
    // Folds (shirt, trousers): subdivide once, displace along the normal, darken the valleys.
    let cavity: Float32Array | null = null;
    let trimW: Float32Array | null = null;
    if (g === 'shirt' || g === 'trousers') {
      piece = subdivide(piece);
      const cnt2 = piece.pos.length / 3;
      const n0 = smoothGarment(piece.pos, piece.tris, 0);
      cavity = new Float32Array(cnt2);
      trimW = new Float32Array(cnt2);
      for (let r = 0; r < cnt2; r++) {
        const name = dominant(piece.si, piece.sw, r);
        const p: V3 = [piece.pos[r * 3]!, piece.pos[r * 3 + 1]!, piece.pos[r * 3 + 2]!];
        const f = foldAt(g, name, p, joints, outfit.cut, neckY, waistY);
        for (let q = 0; q < 3; q++) piece.pos[r * 3 + q] += n0[r * 3 + q]! * f;
        cavity[r] = Math.max(0, Math.min(1, -f / 0.0045));
        if (g === 'trousers' && outfit.stripe) {
          // Track pants: a stripe down the outside of each leg.
          const ax = legAxis(name, joints) ?? (/Hips/.test(name) ? null : null);
          if (ax) {
            const cx = p[0] - (ax[0][0] + ax[1][0]) / 2;
            const cz = p[2] - (ax[0][2] + ax[1][2]) / 2;
            const th = Math.atan2(cx, cz) * Math.sign((ax[0][0] + ax[1][0]) / 2 || 1);
            trimW[r] = Math.max(0, 1 - Math.abs(th - Math.PI / 2) / 0.28);
          }
        }
      }
    }
    const normals = smoothGarment(piece.pos, piece.tris, 0);
    const cntF = piece.pos.length / 3;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(piece.pos, 3));
    bg.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    bg.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(piece.si, 4));
    bg.setAttribute('skinWeight', new THREE.BufferAttribute(piece.sw, 4));
    if (g === 'shoes') {
      // The sole (a sneaker's white rubber, a dress shoe's black).
      trimW = new Float32Array(cntF);
      for (let r = 0; r < cntF; r++) trimW[r] = piece.pos[r * 3 + 1]! < 0.028 ? 1 : 0;
    }
    bg.setAttribute('cavity', new THREE.BufferAttribute(cavity ?? new Float32Array(cntF), 1));
    bg.setAttribute('trim', new THREE.BufferAttribute(trimW ?? new Float32Array(cntF), 1));
    bg.setIndex(piece.tris.length / 3 * 3 >= 65536 * 3 ? new THREE.Uint32BufferAttribute(piece.tris, 1) : piece.tris);
    const mat = g === 'shoes' ? material(`cloth-shoes-${outfit.id}`, () => shoeMaterial(outfit))
      : g === 'gloves' ? material(`cloth-gloves-${outfit.id}`, () => gloveMaterial(outfit.gloves!))
        : g === 'shirt' ? material(`cloth-shirt-${outfit.id}`, () => clothMaterial(outfit.shirt, 0.82, null), colourSig(outfit))
          : material(`cloth-trousers-${outfit.id}`, () => clothMaterial(outfit.trousers, outfit.cut === 'slacks' ? 0.66 : 0.8, outfit.stripe), colourSig(outfit));
    addMesh(bg, mat, `outfit-${g}`);
  }

  // ---- trim: collar or crew band, belt, patch ----------------------------------
  const trimPos: number[] = [];
  const trimSI: number[] = [];
  const trimSW: number[] = [];
  const trimMetal: number[] = [];
  const trimTris: number[] = [];
  const trimCav: number[] = [];
  const beltPos: number[] = [];
  const beltSI: number[] = [];
  const beltSW: number[] = [];
  const beltMetal: number[] = [];
  const beltTris: number[] = [];
  const pushV = (arr: { p: number[]; i: number[]; w: number[]; m: number[] }, p: V3, piece: Piece, v: number, metal = 0): number => {
    const id = arr.p.length / 3;
    arr.p.push(p[0], p[1], p[2]);
    for (let q = 0; q < 4; q++) { arr.i.push(piece.si[v * 4 + q]!); arr.w.push(piece.sw[v * 4 + q]!); }
    arr.m.push(metal);
    return id;
  };
  const collarArr = { p: trimPos, i: trimSI, w: trimSW, m: trimMetal };
  const beltArr = { p: beltPos, i: beltSI, w: beltSW, m: beltMetal };
  const neckAxis: V3 = neckJ && headJ ? (() => {
    const d: V3 = [headJ[0] - neckJ[0], headJ[1] - neckJ[1], headJ[2] - neckJ[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  })() : [0, 1, 0];
  /** A ribbon of quads along a closed loop, rows given as offsets (radial, along axis) per point. */
  /**
   * A ribbon of quads round a hem loop. The cut hem zigzags along triangle
   * edges, so the loop is resampled by angle round its centre (evenly, the
   * radius and height smoothed) before the rows are laid out: a clean band.
   * `rows` give (outward, along-axis) offsets per angle; `skip` leaves a gap.
   */
  const ribbon = (
    arr: typeof collarArr, tris: number[], loop: number[], piece: Piece, c: V3, axis: V3,
    rows: ((ang: number) => [number, number])[], skip: (ang: number) => boolean,
  ): void => {
    const pts = loop.map((v) => {
      const x = piece.pos[v * 3]! - c[0];
      const z = piece.pos[v * 3 + 2]! - c[2];
      return { v, ang: Math.atan2(x, z), r: Math.hypot(x, z), y: piece.pos[v * 3 + 1]! };
    }).sort((p, q) => p.ang - q.ang);
    const L = pts.length;
    if (L < 6) return;
    // Circular moving average of radius and height (the zigzag out).
    const sr = pts.map((_, i) => {
      let r = 0, y = 0;
      for (let k = -3; k <= 3; k++) { const q = pts[(i + k + L) % L]!; r += q.r; y += q.y; }
      return { r: r / 7, y: y / 7 };
    });
    const N = 64;
    const ids: number[][] = [];
    const angs: number[] = [];
    for (let s2 = 0; s2 < N; s2++) {
      const ang = -Math.PI + (2 * Math.PI * s2) / N;
      // Bracketing samples (circular).
      let j = pts.findIndex((q) => q.ang >= ang);
      if (j < 0) j = 0;
      const i0 = (j - 1 + L) % L;
      const p0 = pts[i0]!, p1 = pts[j]!;
      let span = p1.ang - p0.ang;
      if (span <= 0) span += 2 * Math.PI;
      let off = ang - p0.ang;
      if (off < 0) off += 2 * Math.PI;
      const u = Math.max(0, Math.min(1, off / span));
      const r = sr[i0]!.r + (sr[j]!.r - sr[i0]!.r) * u;
      const y = sr[i0]!.y + (sr[j]!.y - sr[i0]!.y) * u;
      const v = u < 0.5 ? p0.v : p1.v;
      const rx = Math.sin(ang), rz = Math.cos(ang);
      const base: V3 = [c[0] + rx * r, y, c[2] + rz * r];
      angs.push(ang);
      ids.push(rows.map((row) => {
        const [out, up] = row(ang);
        return pushV(arr, [base[0] + rx * out + axis[0] * up, base[1] + axis[1] * up, base[2] + rz * out + axis[2] * up], piece, v);
      }));
    }
    for (let s2 = 0; s2 < N; s2++) {
      const a2 = ids[s2]!;
      const b2 = ids[(s2 + 1) % N]!;
      if (skip(angs[s2]!) && skip(angs[(s2 + 1) % N]!)) continue;
      for (let r = 0; r + 1 < rows.length; r++) {
        tris.push(a2[r]!, a2[r + 1]!, b2[r + 1]!, a2[r]!, b2[r + 1]!, b2[r]!);
      }
    }
  };
  if (trim.shirt && trim.shirtNeck) {
    const piece = trim.shirt;
    const c = centroid(piece.pos, trim.shirtNeck);
    const front = (ang: number): number => Math.max(0, 1 - Math.abs(ang) / 0.6);
    if (outfit.neck === 'collar') {
      // A stand (3 cm up the neck), then the fall folded over it and spread
      // onto the shoulders, its points longer at the front; open at the throat.
      ribbon(collarArr, trimTris, trim.shirtNeck, piece, c, neckAxis, [
        () => [0.002, -0.004],
        () => [0.005, 0.03 * k],
        () => [0.014, 0.034 * k],
        (ang) => [0.03 + 0.012 * front(ang), -0.004 - 0.028 * front(ang)],
      ], (ang) => Math.abs(ang) < 0.16);
    } else {
      // Crew neck: a ribbed band.
      ribbon(collarArr, trimTris, trim.shirtNeck, piece, c, neckAxis, [
        () => [0.001, -0.006],
        () => [0.004, 0.016 * k],
        () => [0.0, 0.019 * k],
      ], () => false);
    }
    for (let q = 0; q < trimMetal.length; q++) trimCav.push(0);
  }
  if (outfit.cut === 'slacks' && trim.trousers && trim.waist) {
    const piece = trim.trousers;
    const c = centroid(piece.pos, trim.waist);
    // The belt: a band round the waistband, a lip over its top edge.
    ribbon(beltArr, beltTris, trim.waist, piece, c, [0, 1, 0], [
      () => [0.004, -0.016],
      () => [0.008, -0.012],
      () => [0.008, 0.02],
      () => [0.001, 0.024],
    ], () => false);
    // The buckle: a small plate at the front.
    let fv = trim.waist[0]!;
    for (const v of trim.waist) if (piece.pos[v * 3 + 2]! > piece.pos[fv * 3 + 2]!) fv = v;
    const f: V3 = [piece.pos[fv * 3]!, piece.pos[fv * 3 + 1]!, piece.pos[fv * 3 + 2]! + 0.011];
    const w = 0.026, h = 0.019;
    const b0 = pushV(beltArr, [f[0] - w, f[1] - h + 0.002, f[2]], piece, fv, 1);
    const b1 = pushV(beltArr, [f[0] + w, f[1] - h + 0.002, f[2]], piece, fv, 1);
    const b2 = pushV(beltArr, [f[0] + w, f[1] + h + 0.002, f[2]], piece, fv, 1);
    const b3 = pushV(beltArr, [f[0] - w, f[1] + h + 0.002, f[2]], piece, fv, 1);
    beltTris.push(b0, b1, b2, b0, b2, b3);
  }
  const finishTrim = (p: number[], i: number[], w: number[], m: number[], tris: number[], mat: THREE.Material, name: string): void => {
    if (tris.length === 0) return;
    const g = new THREE.BufferGeometry();
    const pa = new Float32Array(p);
    g.setAttribute('position', new THREE.BufferAttribute(pa, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(i), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(w), 4));
    g.setAttribute('trim', new THREE.BufferAttribute(new Float32Array(m), 1));
    g.setAttribute('cavity', new THREE.BufferAttribute(new Float32Array(m.length), 1));
    g.setIndex(tris);
    g.computeVertexNormals();
    addMesh(g, mat, name);
  };
  finishTrim(trimPos, trimSI, trimSW, trimMetal, trimTris,
    material(`cloth-collar-${outfit.id}`, () => {
      const mm = clothMaterial(outfit.neck === 'crew'
        ? [outfit.shirt[0] * 0.8, outfit.shirt[1] * 0.8, outfit.shirt[2] * 0.8] : outfit.shirt, 0.85, null);
      mm.side = THREE.DoubleSide;
      return mm;
    }, colourSig(outfit)), 'outfit-collar');
  finishTrim(beltPos, beltSI, beltSW, beltMetal, beltTris, material('cloth-belt', beltMaterial), 'outfit-belt');

  // The chest patch: a small plate on the left chest, rigid with the chest bone.
  if (outfit.patch && trim.shirt) {
    const piece = trim.shirt;
    const spine2 = names.indexOf('Spine2');
    const cy = neckY - 0.15 * k;
    const cx = 0.095 * k;
    let bestV = -1;
    let bestD = Infinity;
    const cn = piece.pos.length / 3;
    for (let r = 0; r < cn; r++) {
      if (piece.pos[r * 3 + 2]! < 0.02) continue;
      const d = Math.hypot(piece.pos[r * 3]! - cx, piece.pos[r * 3 + 1]! - cy);
      if (d < bestD) { bestD = d; bestV = r; }
    }
    if (bestV >= 0 && spine2 >= 0) {
      // Front-most surface there (the folds moved it a little).
      const c: V3 = [cx, cy, piece.pos[bestV * 3 + 2]! + 0.006];
      const w = 0.04 * k, h = 0.0225 * k;
      const g = new THREE.BufferGeometry();
      const p = new Float32Array([c[0] - w, c[1] - h, c[2], c[0] + w, c[1] - h, c[2] + 0.004, c[0] + w, c[1] + h, c[2] + 0.004, c[0] - w, c[1] + h, c[2]]);
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      // The patch reads the right way round on the wearer (his left is +X, facing +Z).
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array([spine2, 0, 0, 0, spine2, 0, 0, 0, spine2, 0, 0, 0, spine2, 0, 0, 0]), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      addMesh(g, material('cloth-patch', patchMaterial), 'outfit-patch');
    }
  }

  // Remove the skin the clothes cover, from every body LOD's own index.
  const hiddenTriangles: number[] = [];
  for (const b of bodies) {
    const ix = b.geometry.index;
    if (!ix) { hiddenTriangles.push(0); continue; }
    const arr = ix.array;
    const keep: number[] = [];
    let hidden = 0;
    for (let t = 0; t < arr.length; t += 3) {
      const a = arr[t]!, bb = arr[t + 1]!, c = arr[t + 2]!;
      if (cls.garment[a] && cls.garment[bb] && cls.garment[c]) { hidden++; continue; }
      keep.push(a, bb, c);
    }
    const Ctor = arr instanceof Uint32Array ? Uint32Array : Uint16Array;
    b.geometry.setIndex(new THREE.BufferAttribute(new Ctor(keep), 1));
    hiddenTriangles.push(hidden);
  }
  // The fighters' shorts would only show through at the waist.
  if (shorts) (shorts as THREE.Object3D).removeFromParent();

  return {
    meshes,
    hiddenTriangles,
    triangles,
    dispose(): void {
      // The garment materials are shared (`material()` above), so each mesh's
      // render objects are released explicitly (character/release.ts).
      releaseFromRenderer([], meshes);
      for (const g of geos) g.dispose();
      for (const m of meshes) m.removeFromParent();
    },
  };
}

/** Dress a built character as the referee (see `REFEREE_OUTFIT`). */
export function dressReferee(root: THREE.Object3D, outfit: Outfit = REFEREE_OUTFIT): RefereeClothes | null {
  return dressFigure(root, outfit);
}
