/**
 * FIGHT KIT — shorts (cut from MakeHuman's helper-tights shell, so they fit every body the morphs
 * make), gloves built procedurally around the hand bones, mouthguard from the teeth helper, and the
 * sports top for female fighters. Hand wraps and ankle tape are painted on the skin (skinMaterial).
 *
 * Branding: fictional only. No real promotion or sponsor marks; the shorts carry an abstract
 * chevron emblem.
 */
import * as THREE from 'three/webgpu';
import {
  abs, atan, attribute, float, max, mix, mx_noise_float, smoothstep, texture, uniform, vec2, vec3, vec4,
  normalMap, sin, select, step,
} from 'three/tsl';
import type { BoutPresentation, CharacterVisualState, QualitySettings } from '../contract';
import { B, boneIndex } from '../rig/skeleton';
import type { BodyAsset } from './asset';
import { builtToT, type BuiltBody } from './body';
import type { Canonical } from './canonical';
import { FINGER_BONES, handShapeRotations, type HandShape, type Rig } from './rigging';
import { BONE_PARENT } from '../rig/skeleton';
import { hexToLinear, type RGB } from './appearance';
import {
  append, emptyMesh, filterTriangles, roundedBox, solidify, toSkinnedGeometry, transform, tube, type MeshData,
} from './geom';
import { objectUniform } from './skinMaterial';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export interface KitTextures { cloth: THREE.Texture; leather: THREE.Texture }

export interface Kit {
  meshes: THREE.Object3D[];
  wrapsOnSkin: boolean;
  wrapColour: RGB;
  setState(s: CharacterVisualState): void;
  setLOD(l: number): void;
  dispose(): void;
}

interface KitResources {
  asset: BodyAsset; can: Canonical; kitTex: KitTextures;
  material<M extends THREE.Material>(key: string, make: () => M): M;
}

type ShortsCut = { top: number; hem: number; flare: number; slit: number; offset: number };

/** Per-fighter kit values, read by the shared kit materials through `userData.kit`. */
export interface KitState {
  primary: THREE.Vector3; secondary: THREE.Vector3; trim: THREE.Vector3;
  glove: THREE.Vector3; accent: THREE.Vector3; mouthguard: THREE.Vector3; blood: number;
}

export function buildKit(
  res: KitResources, body: BuiltBody, rig: Rig, bout: BoutPresentation, index: number, quality: QualitySettings,
): Kit {
  const def = bout.fighters[index];
  const app = def.appearance;
  const corner = hexToLinear(bout.cornerColours[index], [0.5, 0.05, 0.05]);
  const meshes: THREE.Object3D[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const kind = bout.glove;
  const state: KitState = {
    primary: new THREE.Vector3(...hexToLinear(app?.shortsKit?.primary, darken(corner, 0.55))),
    secondary: new THREE.Vector3(...hexToLinear(app?.shortsKit?.secondary, corner)),
    trim: new THREE.Vector3(...hexToLinear(app?.shortsKit?.trim, [0.7, 0.7, 0.68])),
    glove: new THREE.Vector3(...hexToLinear(app?.gloveKit?.color, kind === 'mma4oz' ? [0.012, 0.012, 0.013] : darken(corner, 0.9))),
    accent: new THREE.Vector3(...(kind === 'mma4oz' ? corner : ([0.75, 0.75, 0.72] as RGB))),
    mouthguard: new THREE.Vector3(...hexToLinear(app?.mouthguardColor, corner)),
    blood: 0,
  };
  const add = (g: THREE.BufferGeometry, m: THREE.Material, skel: THREE.Skeleton, name: string): THREE.SkinnedMesh => {
    const mesh = new THREE.SkinnedMesh(g, m);
    mesh.name = name;
    mesh.bind(skel, new THREE.Matrix4());
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.kit = state;
    meshes.push(mesh); geos.push(g);
    return mesh;
  };

  // ---- shorts ---------------------------------------------------------------------------
  const rules = bout.rulesetId.toLowerCase();
  const style = app?.shortsKit?.style
    ?? (kind === 'boxing10oz' || kind === 'boxing16oz' ? (/thai|muay|kick/.test(rules) ? 'thai_short' : 'boxing_trunk')
      : kind === 'grappling' ? 'compression' : 'mma_short');
  const J = res.can.jointT;
  const hipY = J[B.lUpLeg * 3 + 1], kneeY = J[B.lLeg * 3 + 1], spineY = J[B.spine * 3 + 1];
  const thigh = hipY - kneeY;
  const cuts: Record<string, ShortsCut> = {
    mma_short: { top: hipY + 0.085, hem: kneeY + 0.5 * thigh, flare: 0.028, slit: 0.075, offset: 0.006 },
    vale_tudo: { top: hipY + 0.06, hem: hipY - 0.13, flare: 0.002, slit: 0, offset: 0.0025 },
    boxing_trunk: { top: spineY + 0.03, hem: kneeY + 0.62 * thigh, flare: 0.035, slit: 0, offset: 0.007 },
    thai_short: { top: spineY + 0.01, hem: hipY - 0.11, flare: 0.05, slit: 0.05, offset: 0.007 },
    compression: { top: hipY + 0.08, hem: kneeY + 0.07, flare: 0.001, slit: 0, offset: 0.002 },
  };
  const cutKey = cuts[style] ? style : 'mma_short';
  const cut = cuts[cutKey];
  {
    const m = shellFromTights(res, body, (p) => !(Math.abs(p[0]) > 0.3 && p[1] > 1.15),
      (p, n) => {
        const t = smooth(hipY, cut.hem, p[1]);
        const outward = smooth(-0.3, 0.7, n[0] * Math.sign(p[0]) + 0.3 * Math.abs(n[2]));
        const waist = smooth(cut.top - 0.06, cut.top, p[1]);
        return cut.offset + cut.flare * t * (0.35 + 0.65 * outward) - 0.002 * waist;
      },
      () => true, { lo: cut.hem, hi: cut.top });
    const solid = solidify(m.mesh, 0.003);
    const g = toSkinnedGeometry(solid, m.skinIndex(solid), m.skinWeight(solid));
    const mat = res.material(`shorts|${cutKey}`, () => shortsMaterial(res.kitTex, { cut, hipX: J[B.lUpLeg * 3], style: cutKey }));
    add(g, mat, rig.skelA, 'shorts');
  }

  // ---- sports top (female) --------------------------------------------------------------
  if (def.body.sex === 'female') {
    const chestY = J[B.spine2 * 3 + 1];
    const m = shellFromTights(res, body, (p) => p[1] > chestY - 0.07 && p[1] < chestY + 0.12 && Math.abs(p[0]) < 0.17 && !(p[2] < -0.02 && p[1] > chestY + 0.09),
      () => 0.003, () => true);
    const solid = solidify(m.mesh, 0.002);
    const g = toSkinnedGeometry(solid, m.skinIndex(solid), m.skinWeight(solid));
    const mat = res.material('top', () => shortsMaterial(res.kitTex, { cut: { ...cut, top: chestY + 0.2, hem: chestY - 0.07 }, hipX: 0.1, style: 'top' }));
    add(g, mat, rig.skelA, 'top');
  }

  // ---- mouthguard -----------------------------------------------------------------------
  {
    const [t0, t1] = res.asset.header.ranges.teeth;
    const m = emptyMesh();
    const map = new Map<number, number>();
    for (let s = t0; s < t1; s++) {
      map.set(s, s - t0);
      for (let k = 0; k < 3; k++) {
        m.pos.push(body.pos[s * 3 + k] + body.normal[s * 3 + k] * 0.0012);
        m.nrm.push(body.normal[s * 3 + k]);
      }
    }
    const idx = res.asset.teethIndex;
    for (let i = 0; i < idx.length; i++) m.index.push(map.get(idx[i])!);
    const solid = solidify(m, 0.0025);
    const si: number[] = [], sw: number[] = [];
    for (let v = 0; v < solid.pos.length / 3; v++) { si.push(B.head, 0, 0, 0); sw.push(1, 0, 0, 0); }
    const mat = res.material('mouthguard', () => {
      const mg = new THREE.MeshPhysicalNodeMaterial();
      mg.colorNode = vec4(objectUniform('kit', (k) => k.mouthguard, new THREE.Vector3(0.5, 0.05, 0.05)), 1) as N;
      mg.roughnessNode = float(0.22) as N;
      mg.clearcoatNode = float(1) as N;
      mg.clearcoatRoughnessNode = float(0.08) as N;
      return mg;
    });
    add(toSkinnedGeometry(solid, si, sw), mat, rig.skelA, 'mouthguard');
  }

  // ---- gloves -----------------------------------------------------------------------------
  if (kind === 'mma4oz' || kind === 'boxing10oz' || kind === 'boxing16oz') {
    const tpos = builtToT(res.asset, body);
    const mma = kind === 'mma4oz';
    const mat = res.material(`glove|${mma}`, () => gloveMaterial(res.kitTex, mma));
    for (const side of [1, -1] as const) {
      const m = mma ? mmaGlove(res.asset, body, tpos, side) : boxingGlove(res.asset, body, tpos, side, kind === 'boxing16oz');
      add(toSkinnedGeometry(m.mesh, m.si, m.sw), mat, rig.skelT, side > 0 ? 'glove-l' : 'glove-r');
    }
  }
  const wrapsOnSkin = kind === 'grappling' || (kind === 'bare' && !!app?.handWrapColor);
  const wrapColour = hexToLinear(app?.handWrapColor, kind === 'grappling' ? corner : [0.6, 0.6, 0.58]);
  void quality;

  return {
    meshes, wrapsOnSkin, wrapColour,
    setState(s) { state.blood = s.blood ? Math.max(0, Math.min(1, s.bloodOnGloves)) : 0; },
    setLOD(l: number) {
      // The mouthguard is only ever seen in close-ups.
      for (const m of meshes) if (m.name === 'mouthguard') m.visible = l <= 1;
    },
    dispose() { for (const g of geos) g.dispose(); },
  };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const darken = (c: RGB, k: number): RGB => [c[0] * (1 - k), c[1] * (1 - k), c[2] * (1 - k)];

/**
 * Cut a garment out of the helper-tights shell: faces whose canonical vertices pass `keepVert`
 * (and whose centroid passes `keepFace`), offset outward along the fitted normal by `offset(p, n)`.
 */
function shellFromTights(
  res: KitResources, body: BuiltBody,
  keepVert: (canon: number[]) => boolean,
  offset: (canon: number[], canonNormal: number[]) => number,
  keepFace: (centroid: number[], canonNormal: number[]) => boolean,
  snap?: { lo: number; hi: number },
): { mesh: MeshData; skinIndex(m: MeshData): number[]; skinWeight(m: MeshData): number[] } {
  const { asset, can } = res;
  const idx = asset.tightsIndex;
  const [t0, t1] = asset.header.ranges.tights;
  // Canonical normals of the tights (computed here; the canonical pass only did the body).
  const cn = new Float32Array((t1 - t0) * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] - t0, idx[t + 1] - t0, idx[t + 2] - t0];
    const P = (i: number): number[] => [can.pos[(i + t0) * 3], can.pos[(i + t0) * 3 + 1], can.pos[(i + t0) * 3 + 2]];
    const pa = P(a), pb = P(b), pc = P(c);
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) cn[v * 3 + k] += n[k];
  }
  for (let v = 0; v < t1 - t0; v++) {
    const l = Math.hypot(cn[v * 3], cn[v * 3 + 1], cn[v * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) cn[v * 3 + k] /= l;
  }
  const canon = (s: number): number[] => [can.pos[s * 3], can.pos[s * 3 + 1], can.pos[s * 3 + 2]];
  const cnorm = (s: number): number[] => [cn[(s - t0) * 3], cn[(s - t0) * 3 + 1], cn[(s - t0) * 3 + 2]];
  const remap = new Map<number, number>();
  const srcOf: number[] = [];
  const m = emptyMesh();
  m.extra.aRef = { size: 3, data: [] };
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    const cen = [0, 1, 2].map((k) => tri.reduce((acc, s) => acc + can.pos[s * 3 + k] / 3, 0));
    // With a band, keep every triangle that touches it; the material cuts the exact edge per pixel.
    const touches = snap && tri.some((s) => can.pos[s * 3 + 1] >= snap.lo - 1e-4 && can.pos[s * 3 + 1] <= snap.hi + 1e-4);
    if (snap ? !(touches && keepVert(cen)) : !tri.every((s) => keepVert(canon(s)))) continue;
    const cnm = [0, 1, 2].map((k) => tri.reduce((acc, s) => acc + cnorm(s)[k] / 3, 0));
    if (!keepFace(cen, cnm)) continue;
    for (const s of tri) {
      if (!remap.has(s)) {
        remap.set(s, srcOf.length);
        srcOf.push(s);
        const cp = canon(s);
        const off = offset([cp[0], snap ? Math.min(snap.hi, Math.max(snap.lo, cp[1])) : cp[1], cp[2]], cnorm(s));
        for (let k = 0; k < 3; k++) {
          m.pos.push(body.pos[s * 3 + k] + body.normal[s * 3 + k] * off);
          m.nrm.push(body.normal[s * 3 + k]);
        }
        m.extra.aRef.data.push(...cp);
      }
      m.index.push(remap.get(s)!);
    }
  }
  const skin = (solid: MeshData, weights: boolean): number[] => {
    const out: number[] = [];
    const n = solid.pos.length / 3;
    for (let v = 0; v < n; v++) {
      const s = srcOf[v % srcOf.length];
      for (let k = 0; k < 4; k++) out.push(weights ? asset.skinW[s * 4 + k] / 255 : asset.skinIdx[s * 4 + k]);
    }
    return out;
  };
  return { mesh: m, skinIndex: (s) => skin(s, false), skinWeight: (s) => skin(s, true) };
}

// ---------------------------------------------------------------------------
// Gloves
// ---------------------------------------------------------------------------

interface HandFrame { W: number[]; d: number[]; up: number[]; fr: number[]; Lk: number; halfW: number; wristRy: number; wristRz: number; palmT: number }

/** The hand's T-pose frame (x along the hand, y back of hand, z thumb side) and its sizes. */
function handFrame(asset: BodyAsset, body: BuiltBody, tpos: Float32Array, side: 1 | -1): HandFrame {
  const r = body.rest;
  const s = side > 0 ? 'Left' : 'Right';
  const H = side > 0 ? B.lHand : B.rHand;
  const P = (i: number): number[] => [r.head[i * 3], r.head[i * 3 + 1], r.head[i * 3 + 2]];
  const W = P(H);
  const kn = ['Index1', 'Middle1', 'Ring1', 'Pinky1'].map((f) => P(boneIndex(`${s}Hand${f}`)));
  const K = [0, 1, 2].map((k) => kn.reduce((a, p) => a + p[k] / 4, 0));
  let d = [K[0] - W[0], K[1] - W[1], K[2] - W[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  d = d.map((x) => x / l);
  const fr0 = [0, 0, 1];
  const dot = fr0[2] * d[2];
  let fr = [fr0[0] - dot * d[0], fr0[1] - dot * d[1], fr0[2] - dot * d[2]];
  const fl = Math.hypot(fr[0], fr[1], fr[2]);
  fr = fr.map((x) => x / fl);
  const up = [d[1] * fr[2] - d[2] * fr[1], d[2] * fr[0] - d[0] * fr[2], d[0] * fr[1] - d[1] * fr[0]].map((x) => x * -side);
  const halfW = Math.max(0.035, Math.hypot(kn[0][0] - kn[3][0], kn[0][1] - kn[3][1], kn[0][2] - kn[3][2]) / 2 + 0.012);
  // Wrist and palm cross-sections from the fitted body's T-pose.
  let ry = 0.02, rz = 0.028, pt = 0.014;
  const nBody = asset.header.counts.body;
  for (let v = 0; v < nBody; v++) {
    const q = [tpos[v * 3] - W[0], tpos[v * 3 + 1] - W[1], tpos[v * 3 + 2] - W[2]];
    const x = q[0] * d[0] + q[1] * d[1] + q[2] * d[2];
    const y = q[0] * up[0] + q[1] * up[1] + q[2] * up[2];
    const z = q[0] * fr[0] + q[1] * fr[1] + q[2] * fr[2];
    if (Math.abs(z) > 0.06 || Math.abs(y) > 0.06) continue;
    if (Math.abs(x + 0.02) < 0.006) { ry = Math.max(ry, Math.abs(y)); rz = Math.max(rz, Math.abs(z)); }
    if (Math.abs(x - l * 0.5) < 0.008 && Math.abs(z) < 0.02) pt = Math.max(pt, Math.abs(y));
  }
  return { W, d, up, fr, Lk: l, halfW, wristRy: ry, wristRz: rz, palmT: pt };
}

/**
 * Glove shader inputs in one vec4 (WebGPU guarantees only 8 vertex attributes):
 * aGlove = (part, inner, cut.x, cut.y); `aLocal` stays separate.
 */
function packGlove(m: MeshData): void {
  const n = m.pos.length / 3;
  const get = (k: string, i: number, c = 0): number => m.extra[k]?.data[i * (m.extra[k].size) + c] ?? 0;
  const data: number[] = [];
  for (let i = 0; i < n; i++) data.push(get('aPart', i), get('aInner', i), get('aCut', i, 0), get('aCut', i, 1));
  for (const k of Object.keys(m.extra)) if (k !== 'aLocal') delete m.extra[k];
  m.extra.aGlove = { size: 4, data };
}

function frameSkin(m: MeshData, side: 1 | -1, cuffBlend: (x: number) => number): { si: number[]; sw: number[] } {
  const H = side > 0 ? B.lHand : B.rHand;
  const F = side > 0 ? B.lForeArm : B.rForeArm;
  const si: number[] = [], sw: number[] = [];
  const lx = m.extra.aLocal.data;
  for (let v = 0; v < m.pos.length / 3; v++) {
    const f = cuffBlend(lx[v * 3]);
    si.push(H, F, 0, 0); sw.push(1 - f, f, 0, 0);
  }
  return { si, sw };
}

function place(m: MeshData, f: HandFrame, side: 1 | -1): MeshData {
  // Remember local coordinates for the shader, then move into the T-pose hand frame.
  m.extra.aLocal = { size: 3, data: m.pos.slice() };
  transform(m, f.d, f.up, f.fr, f.W);
  // The right hand's frame is mirrored: restore counter-clockwise winding.
  if (side < 0) for (let t = 0; t < m.index.length; t += 3) { const a = m.index[t + 1]; m.index[t + 1] = m.index[t + 2]; m.index[t + 2] = a; }
  return m;
}

/**
 * The closed fist's extent in the hand frame: the hand and finger vertices of the fitted body,
 * posed with the fist the actor applies (forward kinematics of the finger chains in the T-pose).
 * Gloves are sized to it, so a big-handed heavyweight gets a bigger glove.
 */
function fistBox(asset: BodyAsset, body: BuiltBody, tpos: Float32Array, f: HandFrame, side: 1 | -1, shape: HandShape):
  { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } {
  const rot = handShapeRotations(shape);
  const r = body.rest;
  const H = side > 0 ? B.lHand : B.rHand;
  // World rotation and joint position of every finger bone (the hand bone itself stays at rest).
  const Q = new Map<number, THREE.Quaternion>([[H, new THREE.Quaternion()]]);
  const P = new Map<number, THREE.Vector3>([[H, new THREE.Vector3(r.head[H * 3], r.head[H * 3 + 1], r.head[H * 3 + 2])]]);
  FINGER_BONES.forEach((b, k) => {
    const parent = BONE_PARENT[b];
    if (!Q.has(parent)) return; // the other hand
    const qp = Q.get(parent)!;
    const off = new THREE.Vector3(r.head[b * 3] - r.head[parent * 3], r.head[b * 3 + 1] - r.head[parent * 3 + 1], r.head[b * 3 + 2] - r.head[parent * 3 + 2]).applyQuaternion(qp);
    P.set(b, P.get(parent)!.clone().add(off));
    Q.set(b, qp.clone().multiply(new THREE.Quaternion(rot[k * 4], rot[k * 4 + 1], rot[k * 4 + 2], rot[k * 4 + 3])));
  });
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  const v = new THREE.Vector3();
  const acc = new THREE.Vector3();
  for (let s = 0; s < asset.header.counts.body; s++) {
    let wHand = 0;
    acc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const b = asset.skinIdx[s * 4 + k], w = asset.skinW[s * 4 + k] / 255;
      if (w === 0) continue;
      const q = Q.get(b);
      v.set(tpos[s * 3] - r.head[b * 3], tpos[s * 3 + 1] - r.head[b * 3 + 1], tpos[s * 3 + 2] - r.head[b * 3 + 2]);
      if (q) { v.applyQuaternion(q).add(P.get(b)!); wHand += w; } else v.set(tpos[s * 3], tpos[s * 3 + 1], tpos[s * 3 + 2]);
      acc.addScaledVector(v, w);
    }
    if (wHand < 0.6) continue;
    const dx = acc.x - f.W[0], dy = acc.y - f.W[1], dz = acc.z - f.W[2];
    const x = dx * f.d[0] + dy * f.d[1] + dz * f.d[2];
    if (x < 0.0) continue;
    const y = dx * f.up[0] + dy * f.up[1] + dz * f.up[2];
    const z = dx * f.fr[0] + dy * f.fr[1] + dz * f.fr[2];
    box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
    box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
    box.z0 = Math.min(box.z0, z); box.z1 = Math.max(box.z1, z);
  }
  return box;
}

function mmaGlove(asset: BodyAsset, body: BuiltBody, tpos: Float32Array, side: 1 | -1): { mesh: MeshData; si: number[]; sw: number[] } {
  const f = handFrame(asset, body, tpos, side);
  const fist = fistBox(asset, body, tpos, f, side, 'gloveFist');
  const out = emptyMesh();
  // Padded shell over the back of the fist and the knuckles (about 2 cm of foam there, 1 cm on the
  // back of the hand and the sides), open under the palm so the curled fingers show.
  const front = fist.x1 + 0.02, back = -0.012;
  const top = fist.y1 + 0.013, bottom = fist.y0 - 0.004;
  const cx = (front + back) / 2, ax = (front - back) / 2;
  const cy = (top + bottom) / 2, ay = (top - bottom) / 2;
  const cz = (fist.z0 + fist.z1) / 2, az = (fist.z1 - fist.z0) / 2 + 0.011;
  let shell = roundedBox([ax, ay, az], 0.42, 34);
  for (let i = 0; i < shell.pos.length; i += 3) {
    const u = shell.pos[i] / ax, w = shell.pos[i + 1] / ay;
    // The knuckle pad bulges up and forward; the back of the hand is flatter.
    shell.pos[i + 1] += 0.006 * smooth(-0.1, 0.7, u) * smooth(0, 0.8, w);
    shell.pos[i] += cx; shell.pos[i + 1] += cy; shell.pos[i + 2] += cz;
  }
  const knuckleLine = fist.x1 - 0.028;
  const palmCut = cy - 0.15 * ay;
  // The palm opening is cut per pixel in the shader (aCut = the two cut planes), which gives a
  // clean edge; the geometry only drops the triangles well inside it.
  const inOpening = (p: number[]): boolean => p[1] < palmCut - 0.012 && p[0] < knuckleLine - 0.012;
  shell = filterTriangles(shell, (c) => !(inOpening(c) || c[0] < back + 0.004));
  shell.extra.aCut = { size: 2, data: [] };
  for (let i = 0; i < shell.pos.length; i += 3) shell.extra.aCut.data.push(shell.pos[i] - knuckleLine, shell.pos[i + 1] - palmCut);
  append(out, solidify(shell, 0.004), 0);
  // Wrist cuff (glove colour) with a narrower accent strap over it.
  const cuff = tube(-0.075, back + 0.012, f.wristRy + 0.006, f.wristRz + 0.006, 1.1, 32, 6);
  append(out, solidify(cuff, 0.003), 1);
  const strap = tube(-0.058, -0.028, f.wristRy + 0.0095, f.wristRz + 0.0095, 1.02, 32, 2);
  append(out, solidify(strap, 0.002), 2);
  place(out, f, side);
  packGlove(out);
  const { si, sw } = frameSkin(out, side, (x) => smooth(0.0, -0.05, x));
  return { mesh: out, si, sw };
}

function boxingGlove(asset: BodyAsset, body: BuiltBody, tpos: Float32Array, side: 1 | -1, heavy: boolean): { mesh: MeshData; si: number[]; sw: number[] } {
  const f = handFrame(asset, body, tpos, side);
  const fist = fistBox(asset, body, tpos, f, side, 'fist');
  const out = emptyMesh();
  const k = heavy ? 1.12 : 1;
  // Padding: ~4.5 cm over the knuckles (10 oz), 3 cm over the back of the hand, 2.5 cm at the sides.
  const front = fist.x1 + 0.045 * k, back = -0.03;
  const top = fist.y1 + 0.03 * k, bottom = fist.y0 - 0.022 * k;
  const cx = (front + back) / 2, ax = (front - back) / 2;
  const cy = (top + bottom) / 2, ay = (top - bottom) / 2;
  const cz = (fist.z0 + fist.z1) / 2, az = (fist.z1 - fist.z0) / 2 + 0.025 * k;
  const mitt = roundedBox([ax, ay, az], 0.72, 34);
  for (let i = 0; i < mitt.pos.length; i += 3) {
    const u = mitt.pos[i] / ax;
    mitt.pos[i + 1] *= 1 + 0.1 * smooth(-0.2, 0.8, u);
    mitt.pos[i] += cx; mitt.pos[i + 1] += cy; mitt.pos[i + 2] += cz;
  }
  append(out, mitt, 0);
  const thumb = roundedBox([0.045 * k, 0.028 * k, 0.026 * k], 0.85, 16);
  for (let i = 0; i < thumb.pos.length; i += 3) {
    const x = thumb.pos[i], y = thumb.pos[i + 1];
    thumb.pos[i] = x * 0.94 - y * 0.34 + cx - 0.2 * ax;
    thumb.pos[i + 1] = x * 0.34 + y * 0.94 + cy - 0.25 * ay;
    thumb.pos[i + 2] += az * 0.9;
  }
  append(out, thumb, 1);
  const cuff = tube(-0.13, cx - 0.75 * ax, f.wristRy + 0.018, f.wristRz + 0.018, 1.2, 32, 6);
  append(out, solidify(cuff, 0.006), 2);
  const strap = tube(-0.11, -0.04, f.wristRy + 0.024, f.wristRz + 0.024, 1.04, 32, 3);
  append(out, solidify(strap, 0.004), 3);
  place(out, f, side);
  packGlove(out);
  const { si, sw } = frameSkin(out, side, (x) => smooth(-0.01, -0.09, x));
  return { mesh: out, si, sw };
}

function gloveMaterial(tex: KitTextures, mma: boolean): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const blood: N = objectUniform('kit', (k) => k.blood, 0);
  const gl: N = attribute('aGlove', 'vec4');
  const part: N = gl.x.round();
  const inner: N = gl.y;
  const loc: N = attribute('aLocal', 'vec3');
  const grainUV: N = vec2(loc.x.add(loc.z.mul(0.7)), loc.y.add(loc.z.mul(0.5))).mul(22);
  const grain: N = texture(tex.leather, grainUV);
  const base: N = objectUniform('kit', (k) => k.glove, new THREE.Vector3(0.01, 0.01, 0.01));
  const acc: N = objectUniform('kit', (k) => k.accent, new THREE.Vector3(0.5, 0.05, 0.05));
  // MMA: the wrist strap carries the accent (corner) colour; boxing: the cuff strap.
  const isStrap: N = mma ? select(part.equal(2), float(1), float(0)) : select(part.equal(3), float(1), float(0));
  let c: N = mix(base, acc, isStrap);
  if (mma) {
    // Palm opening, cut per pixel: behind the knuckle line and below the palm plane.
    const cut: N = gl.zw;
    const pad: N = select(part.equal(0), float(1), float(0));
    const edge: N = max(cut.x, cut.y); // < 0 inside the opening
    m.opacityNode = float(1).sub(step(edge, 0).mul(pad)) as N;
    m.alphaTestNode = float(0.5) as N;
    // A stitched binding along the cut edge, reading as the padding's thickness.
    c = mix(c, c.mul(0.45).add(acc.mul(0.08)), smoothstep(0.004, 0.0015, edge).mul(pad));
  }
  // Knuckle blood.
  const knuckle: N = smoothstep(0.05, 0.1, loc.x).mul(select(part.equal(0), float(1), float(0)));
  c = mix(c, vec3(0.12, 0.005, 0.008), knuckle.mul(blood).mul(mx_noise_float(loc.mul(120)).mul(0.5).add(0.5)).mul(0.85));
  c = mix(c, c.mul(0.35), inner);
  m.colorNode = vec4(c, 1) as N;
  // Padding is glossy synthetic leather; the cuff and strap are matte (webbing, velcro).
  const matte: N = select(part.equal(0), float(0), float(1));
  m.roughnessNode = mix(float(0.36), float(0.62), matte).add(grain.z.mul(0.1)) as N;
  m.normalNode = normalMap(vec3(grain.xy.sub(0.5).mul(0.6).add(0.5), 1)) as N;
  m.clearcoatNode = mix(float(0.35), float(0.0), matte) as N;
  m.clearcoatRoughnessNode = float(0.28) as N;
  m.sheenNode = vec3(0.05, 0.05, 0.05) as N;
  m.side = THREE.DoubleSide;
  return m;
}

// ---------------------------------------------------------------------------
// Shorts material
// ---------------------------------------------------------------------------

function shortsMaterial(
  tex: KitTextures,
  o: { cut: ShortsCut; hipX: number; style: string },
): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const ref: N = attribute('aRef', 'vec3');
  const inner: N = attribute('aInner', 'float');
  const sideS: N = select(ref.x.greaterThan(0), float(1), float(-1));
  const lx: N = ref.x.mul(sideS).sub(o.hipX);
  const th: N = atan(ref.z.sub(0.01), lx); // 0 = outer side of the leg, ±π/2 front/back
  const y: N = ref.y;
  const board = o.style === 'mma_short' || o.style === 'boxing_trunk' || o.style === 'thai_short';
  const panel: N = board ? smoothstep(0.62, 0.52, abs(th)).mul(smoothstep(o.cut.top - 0.05, o.cut.top - 0.06, y)) : float(0);
  const pipe: N = board ? smoothstep(0.02, 0.0, abs(abs(th).sub(0.57))) : float(0);
  const waist: N = smoothstep(o.cut.top - 0.048, o.cut.top - 0.043, y);
  const hem: N = smoothstep(o.cut.hem + 0.016, o.cut.hem + 0.011, y);
  // An abstract chevron emblem on the lower front of the left leg (no text, no real marks).
  const ex: N = ref.x.sub(o.hipX + 0.02);
  const ey: N = y.sub(o.cut.hem + 0.06);
  const chev: N = smoothstep(0.006, 0.003, abs(ey.sub(abs(ex).mul(-0.7)).add(0.004))).mul(smoothstep(0.035, 0.03, abs(ex)))
    .mul(select(ref.x.greaterThan(0), float(1), float(0))).mul(smoothstep(0.02, 0.05, ref.z)).mul(board ? 1 : 0);
  // Colours are uniforms so every fighter's shorts share one compiled pipeline.
  let c: N = objectUniform('kit', (k) => k.primary, new THREE.Vector3(0.1, 0.1, 0.1));
  c = mix(c, objectUniform('kit', (k) => k.secondary, new THREE.Vector3(0.5, 0.05, 0.05)), panel);
  c = mix(c, objectUniform('kit', (k) => k.trim, new THREE.Vector3(0.7, 0.7, 0.7)), max(max(pipe, waist.mul(0.85)), max(hem, chev)));
  // Waistband ribbing and weave.
  const rib: N = sin(ref.x.mul(420).add(ref.z.mul(420))).mul(waist).mul(0.12);
  const wuv: N = vec2(ref.x.mul(0.8).add(ref.z), ref.y).mul(26);
  const weave: N = texture(tex.cloth, wuv);
  // Soft folds hanging from the waistband and gathering at the crotch.
  const fold: N = mx_noise_float(vec3(th.mul(3), y.mul(14), 0)).mul(board ? 0.35 : 0.12);
  const nx: N = weave.x.sub(0.5).mul(0.7).add(fold.mul(0.6)).add(rib);
  const ny: N = weave.y.sub(0.5).mul(0.7).add(fold.mul(0.2));
  m.normalNode = normalMap(vec3(nx.add(0.5), ny.add(0.5), 1)) as N;
  c = c.mul(weave.z.mul(0.2).add(0.9));
  // Side slit above the hem: a dark parting line with the thigh's shadow in it.
  if (o.cut.slit > 0) {
    const slit: N = smoothstep(0.05, 0.015, abs(th)).mul(smoothstep(o.cut.hem + o.cut.slit, o.cut.hem + o.cut.slit - 0.012, y));
    c = mix(c, c.mul(0.15), slit.mul(0.85));
  }
  c = mix(c, c.mul(0.3), inner);
  m.colorNode = vec4(c, 1) as N;
  m.roughnessNode = float(o.style === 'compression' ? 0.5 : 0.72) as N;
  m.sheenNode = c.mul(0.6).add(0.08) as N;
  m.sheenRoughnessNode = float(0.55) as N;
  // Clean hem and waist lines: cut per pixel in canonical height.
  if (o.style !== 'top') {
    m.opacityNode = step(o.cut.hem, y).mul(step(y, o.cut.top)) as N;
    m.alphaTestNode = float(0.5) as N;
  }
  m.side = THREE.DoubleSide;
  return m;
}
