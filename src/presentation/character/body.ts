/**
 * BODY BUILD — one fighter's morphed MakeHuman body, fitted to his measurements (CPU, once per bout).
 *
 * Pipeline (docs/design/08 §3.3):
 *
 *  1. Macro blend with MakeHuman's own semantics (targets/macrodetails/macro.json): gender, age,
 *     muscle, weight, height and proportions factors multiply into each combination target's
 *     weight; the three ethnic head/body *shape* targets come from the face preset, never from
 *     skin tone. Regional targets add neck, torso and face detail.
 *  2. Joints are re-derived from the morphed vertices exactly as MakeHuman does it (joint-cube
 *     means / vertex means, `headRef`/`tailRef`).
 *  3. Fitting to the sim's body: leg segments are stretched along their bones until hip height /
 *     stature equals legReachM / heightM, the body is scaled uniformly to heightM, the clavicles are
 *     stretched to the rig's shoulder width, and the arm segments are stretched until the T-pose
 *     fingertip span equals reachM. Stretches move each vertex by its skin weight on the segment
 *     and everything distal to it, so the flesh and the joints move together.
 *  4. The rest skeleton is the canonical T-pose (rigData directions) with this body's bone lengths.
 *
 * MakeHuman's mesh and targets are in its A-pose (arms ~45° down, slightly forward). The mesh is
 * kept in that pose and bound there: each bone's inverse bind matrix carries the A→T rotation, so
 * the identity pose of the canonical skeleton renders the T-pose, and every Pose is still relative
 * to the T-pose as `skeleton.ts` defines. Binding in the A-pose deforms better than re-posing the
 * mesh to a T first, because fighting poses (guard, clinch) are much closer to the A-pose.
 */
import { RIG_BONES } from '../rig/rigData';
import { BONE_COUNT, BONE_PARENT, B, FACE_CHANNELS, finishRest, type RestSkeleton } from '../rig/skeleton';
import type { FighterDefinition, FighterRuntime } from '../../sim';
import { applyTarget, type BodyAsset } from './asset';
import { resolveFace } from './appearance';

type V3 = [number, number, number];

const RACES = ['african', 'asian', 'caucasian'] as const;
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const clamp01 = (x: number): number => clamp(x, 0, 1);

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/** MakeHuman macro parameters (each 0..1 as in MakeHuman) plus the regional target weights. */
export interface BodyParams {
  gender: number;
  /** MakeHuman age parameter: 0.5 = 25 years, 1 = 90 years. */
  age: number;
  muscle: number;
  weight: number;
  height: number;
  proportions: number;
  /** [african, asian, caucasian] shape blend, sums to 1. */
  shape: [number, number, number];
  /** Signed regional weights keyed by target short name (e.g. `chin-width`: -1..1). */
  regional: Map<string, number>;
}

function buildBlend(def: FighterDefinition): { ecto: number; meso: number; endo: number } {
  const b = def.body.build;
  if (typeof b !== 'string') return b;
  if (b === 'ectomorph') return { ecto: 0.7, meso: 0.25, endo: 0.05 };
  if (b === 'endomorph') return { ecto: 0.05, meso: 0.35, endo: 0.6 };
  return { ecto: 0.2, meso: 0.7, endo: 0.1 };
}

/**
 * Map a fighter onto MakeHuman's macro parameters. The coefficients are [E] look-development
 * values, tuned against the archetype line-up in dev/character.html.
 */
export function bodyParams(def: FighterDefinition, runtime?: FighterRuntime): BodyParams {
  const b = def.body;
  const blend = buildBlend(def);
  const strength = def.physical?.strength ?? 60;
  const bf = b.bodyFatPct ?? 12;
  const mass = b.fightNightKg ?? b.massKg;
  const bulk = runtime?.rig.bulk ?? mass / (23.5 * b.heightM * b.heightM);
  // MakeHuman's age axis: 25 years is 0.5, 90 is 1.0. Below 25 it blends toward the child
  // target, which would make an 19-year-old athlete look adolescent, so adults clamp at 25.
  const years = clamp(b.ageYears ?? 28, 25, 70);
  const age = 0.5 + ((years - 25) / 65) * 0.5;
  const muscle = clamp01(0.42 + 0.55 * blend.meso + 0.22 * (strength / 100) + 0.3 * (bulk - 1));
  // Weight is mostly fat in MakeHuman; a lean athlete still carries athletic volume, so the
  // lean end sits just under average rather than at MakeHuman's gaunt minimum.
  const weight = clamp(0.5 + (bf - 12) * 0.02 + (bulk - 1) * 0.5 + 0.1 * blend.endo - 0.08 * blend.ecto, 0.3, 1);
  const height = clamp(0.5 + (b.heightM - 1.77) * 1.6, 0.15, 0.85);
  const face = resolveFace(def.appearance);
  const regional = new Map(face.morphs);
  const neck = (def.physical?.neckStrength ?? 60) / 100;
  const add = (k: string, v: number): void => { regional.set(k, clamp((regional.get(k) ?? 0) + v, -1, 1)); };
  add('measure-neck-circ', 0.15 + 0.55 * neck + 0.3 * (bulk - 1));
  add('neck-scale-horiz', 0.2 * neck);
  add('torso-vshape', 0.5 * blend.meso - 0.3 * blend.endo);
  add('torso-muscle-dorsi', 0.5 * blend.meso + 0.2 * (strength / 100));
  add('torso-muscle-pectoral', 0.35 * blend.meso + 0.25 * (strength / 100));
  add('stomach-pregnant', clamp((bf - 17) / 16, 0, 0.7));
  add('stomach-tone', clamp((13 - bf) / 8, -0.5, 0.8));
  // Trained limbs and shoulders: MakeHuman's regional muscle targets.
  const lean = clamp01((22 - bf) / 14);
  const limbs = clamp01(0.45 + 0.55 * blend.meso + 0.3 * (strength / 100) + 0.3 * (bulk - 1)) * (0.6 + 0.4 * lean);
  add('upperarm-muscle', limbs);
  add('lowerarm-muscle', 0.9 * limbs);
  add('upperarm-shoulder-muscle', limbs);
  add('upperleg-muscle', 0.9 * limbs);
  add('lowerleg-muscle', 0.8 * limbs);
  add('torso-vshape', 0.25 * limbs);
  return {
    gender: b.sex === 'female' ? 0 : 1,
    age, muscle, weight, height,
    proportions: 0.85,
    shape: face.shape,
    regional,
  };
}

/** The three part-weights of a MakeHuman min/average/max variable. */
function levels(v: number): [number, number, number] {
  if (v < 0.5) { const lo = clamp01(1 - v * 2); return [lo, 1 - lo, 0]; }
  const hi = clamp01(v * 2 - 1);
  return [0, 1 - hi, hi];
}

/** Every macro and regional target weight for these parameters, in a stable order. */
export function targetWeights(p: BodyParams): [string, number][] {
  const out: [string, number][] = [];
  const genders: [string, number][] = [['female', 1 - p.gender], ['male', p.gender]];
  const old = clamp01(p.age * 2 - 1);
  const ages: [string, number][] = [['young', 1 - old], ['old', old]];
  const lv = ['min', 'average', 'max'];
  const mw = levels(p.muscle);
  const ww = levels(p.weight);
  const [hMin, , hMax] = levels(p.height);
  const ideal = clamp01(p.proportions * 2 - 1);
  for (const [g, gw] of genders) for (const [a, aw] of ages) {
    const ga = gw * aw;
    if (ga === 0) continue;
    RACES.forEach((r, i) => out.push([`rga/${r}-${g}-${a}`, ga * p.shape[i]]));
    for (let m = 0; m < 3; m++) for (let w = 0; w < 3; w++) {
      if (m === 1 && w === 1) continue;
      out.push([`uni/${g}-${a}-${lv[m]}muscle-${lv[w]}weight`, ga * mw[m] * ww[w]]);
    }
    out.push([`height/${g}-${a}-min`, ga * hMin], [`height/${g}-${a}-max`, ga * hMax]);
    out.push([`prop/${g}-${a}-ideal`, ga * ideal]);
  }
  const keys = [...p.regional.keys()].sort();
  for (const k of keys) {
    const v = p.regional.get(k)!;
    const pairs: string[] = [];
    // `cheek-bones` etc. are sided in MakeHuman (l-/r-); a face morph drives both sides.
    for (const side of ['', 'l-', 'r-']) pairs.push(side + k);
    for (const name of pairs) {
      if (v > 0) out.push([`reg/${name}-incr`, v], [`reg/${name}`, v]);
      else if (v < 0) out.push([`reg/${name}-decr`, -v]);
    }
  }
  return out.filter(([, w]) => w > 1e-5);
}

// ---------------------------------------------------------------------------
// Skeleton helpers
// ---------------------------------------------------------------------------

/** Children lists and descendant sets, from the canonical parent table. */
const DESCENDANTS: number[][] = (() => {
  const out: number[][] = Array.from({ length: BONE_COUNT }, () => []);
  for (let i = BONE_COUNT - 1; i >= 0; i--) {
    for (let p = BONE_PARENT[i]; p >= 0; p = BONE_PARENT[p]) out[p].push(i);
  }
  return out.map((l) => l.sort((a, b) => a - b));
})();

/** Canonical T-pose direction of every bone (rigData head → tail). */
const T_DIR: Float32Array = (() => {
  const d = new Float32Array(BONE_COUNT * 3);
  RIG_BONES.forEach((b, i) => {
    const x = b.tail[0] - b.head[0], y = b.tail[1] - b.head[1], z = b.tail[2] - b.head[2];
    const n = Math.hypot(x, y, z) || 1;
    d[i * 3] = x / n; d[i * 3 + 1] = y / n; d[i * 3 + 2] = z / n;
  });
  return d;
})();

function refMean(pos: Float32Array, ref: readonly number[], out: Float32Array, o: number): void {
  let x = 0, y = 0, z = 0;
  for (const s of ref) { x += pos[s * 3]; y += pos[s * 3 + 1]; z += pos[s * 3 + 2]; }
  out[o] = x / ref.length; out[o + 1] = y / ref.length; out[o + 2] = z / ref.length;
}

export interface Joints { head: Float32Array; tail: Float32Array }

export function deriveJoints(asset: BodyAsset, pos: Float32Array): Joints {
  const head = new Float32Array(BONE_COUNT * 3);
  const tail = new Float32Array(BONE_COUNT * 3);
  asset.header.jointRefs.forEach((r, i) => {
    refMean(pos, r.head, head, i * 3);
    refMean(pos, r.tail, tail, i * 3);
  });
  return { head, tail };
}

/** Shortest-arc quaternion taking unit a to unit b. */
function fromTo(ax: number, ay: number, az: number, bx: number, by: number, bz: number, out: Float32Array, o: number): void {
  const d = ax * bx + ay * by + az * bz;
  let x: number, y: number, z: number, w: number;
  if (d < -0.999999) {
    // Opposite: 180° about any perpendicular axis.
    x = 0; y = -az; z = ay; w = 0;
    if (Math.hypot(y, z) < 1e-6) { x = az; y = 0; z = -ax; }
  } else {
    x = ay * bz - az * by; y = az * bx - ax * bz; z = ax * by - ay * bx; w = 1 + d;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  out[o] = x / n; out[o + 1] = y / n; out[o + 2] = z / n; out[o + 3] = w / n;
}

function rotate(q: Float32Array, qi: number, vx: number, vy: number, vz: number, out: Float32Array, o: number): void {
  const x = q[qi], y = q[qi + 1], z = q[qi + 2], w = q[qi + 3];
  const cx = y * vz - z * vy, cy = z * vx - x * vz, cz = x * vy - y * vx;
  out[o] = vx + 2 * (w * cx + (y * cz - z * cy));
  out[o + 1] = vy + 2 * (w * cy + (z * cx - x * cz));
  out[o + 2] = vz + 2 * (w * cz + (x * cy - y * cx));
}

/**
 * The A→T conversion: per-bone world rotations taking this body's A-pose bone directions onto the
 * canonical T-pose directions, and the resulting T-pose joints (forward kinematics from the root,
 * keeping this body's bone lengths).
 */
export interface APoseToT { rot: Float32Array; headT: Float32Array; tailT: Float32Array }

export function aPoseToT(j: Joints): APoseToT {
  const rot = new Float32Array(BONE_COUNT * 4);
  const headT = new Float32Array(BONE_COUNT * 3);
  const tailT = new Float32Array(BONE_COUNT * 3);
  const tmp = new Float32Array(3);
  for (let i = 0; i < BONE_COUNT; i++) {
    const hx = j.head[i * 3], hy = j.head[i * 3 + 1], hz = j.head[i * 3 + 2];
    let dx = j.tail[i * 3] - hx, dy = j.tail[i * 3 + 1] - hy, dz = j.tail[i * 3 + 2] - hz;
    const n = Math.hypot(dx, dy, dz) || 1;
    dx /= n; dy /= n; dz /= n;
    fromTo(dx, dy, dz, T_DIR[i * 3], T_DIR[i * 3 + 1], T_DIR[i * 3 + 2], rot, i * 4);
    const p = BONE_PARENT[i];
    if (p < 0) {
      headT[i * 3] = hx; headT[i * 3 + 1] = hy; headT[i * 3 + 2] = hz;
    } else {
      rotate(rot, p * 4, hx - j.head[p * 3], hy - j.head[p * 3 + 1], hz - j.head[p * 3 + 2], tmp, 0);
      headT[i * 3] = headT[p * 3] + tmp[0];
      headT[i * 3 + 1] = headT[p * 3 + 1] + tmp[1];
      headT[i * 3 + 2] = headT[p * 3 + 2] + tmp[2];
    }
    rotate(rot, i * 4, j.tail[i * 3] - hx, j.tail[i * 3 + 1] - hy, j.tail[i * 3 + 2] - hz, tmp, 0);
    tailT[i * 3] = headT[i * 3] + tmp[0];
    tailT[i * 3 + 1] = headT[i * 3 + 1] + tmp[1];
    tailT[i * 3 + 2] = headT[i * 3 + 2] + tmp[2];
  }
  return { rot, headT, tailT };
}

/** Linear-blend-skin src vertices [from, to) from the A-pose into the T-pose. */
export function skinToT(
  asset: BodyAsset, pos: Float32Array, j: Joints, t: APoseToT, from = 0, to = asset.srcCount,
): Float32Array {
  const out = new Float32Array((to - from) * 3);
  const tmp = new Float32Array(3);
  const { skinIdx, skinW } = asset;
  for (let s = from; s < to; s++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = skinW[s * 4 + k] / 255;
      if (w === 0) continue;
      const b = skinIdx[s * 4 + k];
      rotate(t.rot, b * 4, pos[s * 3] - j.head[b * 3], pos[s * 3 + 1] - j.head[b * 3 + 1], pos[s * 3 + 2] - j.head[b * 3 + 2], tmp, 0);
      x += w * (t.headT[b * 3] + tmp[0]);
      y += w * (t.headT[b * 3 + 1] + tmp[1]);
      z += w * (t.headT[b * 3 + 2] + tmp[2]);
    }
    const o = (s - from) * 3;
    out[o] = x; out[o + 1] = y; out[o + 2] = z;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Measurement and fitting
// ---------------------------------------------------------------------------

export interface BodyMeasures {
  /** Floor (soles) to crown, T-pose. */
  statureM: number;
  /** Fingertip-to-fingertip span, T-pose. */
  spanM: number;
  /** Hip joint height above the floor. */
  hipHeightM: number;
  /** Distance between the shoulder (LeftArm/RightArm) joints. */
  shoulderWidthM: number;
  floorY: number;
}

export function measure(asset: BodyAsset, pos: Float32Array): { m: BodyMeasures; joints: Joints; t: APoseToT } {
  const joints = deriveJoints(asset, pos);
  const t = aPoseToT(joints);
  const nBody = asset.header.counts.body;
  const tp = skinToT(asset, pos, joints, t, 0, nBody);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let s = 0; s < nBody; s++) {
    const x = tp[s * 3], y = tp[s * 3 + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const hip = (t.headT[B.lUpLeg * 3 + 1] + t.headT[B.rUpLeg * 3 + 1]) / 2 - minY;
  return {
    m: {
      statureM: maxY - minY,
      spanM: maxX - minX,
      hipHeightM: hip,
      shoulderWidthM: t.headT[B.lArm * 3] - t.headT[B.rArm * 3],
      floorY: minY,
    },
    joints, t,
  };
}

/**
 * Lengthen one bone segment by `delta` metres along its A-pose direction. A vertex moves by its
 * skin weight on every bone distal to the segment, plus its weight on the segment itself times how
 * far along the segment it lies — so the flesh stretches smoothly and the distal joints (which are
 * vertex means) move by exactly `delta`.
 */
function stretchSegment(asset: BodyAsset, pos: Float32Array, j: Joints, bone: number, delta: number): void {
  if (Math.abs(delta) < 1e-6) return;
  const hx = j.head[bone * 3], hy = j.head[bone * 3 + 1], hz = j.head[bone * 3 + 2];
  let dx = j.tail[bone * 3] - hx, dy = j.tail[bone * 3 + 1] - hy, dz = j.tail[bone * 3 + 2] - hz;
  const L = Math.hypot(dx, dy, dz) || 1;
  dx /= L; dy /= L; dz /= L;
  const distal = new Uint8Array(BONE_COUNT);
  for (const d of DESCENDANTS[bone]) distal[d] = 1;
  const { skinIdx, skinW } = asset;
  for (let s = 0; s < asset.srcCount; s++) {
    let f = 0;
    for (let k = 0; k < 4; k++) {
      const w = skinW[s * 4 + k];
      if (w === 0) continue;
      const b = skinIdx[s * 4 + k];
      if (distal[b]) f += w / 255;
      else if (b === bone) {
        const t = ((pos[s * 3] - hx) * dx + (pos[s * 3 + 1] - hy) * dy + (pos[s * 3 + 2] - hz) * dz) / L;
        f += (w / 255) * clamp01(t);
      }
    }
    if (f === 0) continue;
    pos[s * 3] += dx * delta * f;
    pos[s * 3 + 1] += dy * delta * f;
    pos[s * 3 + 2] += dz * delta * f;
  }
}

/** Scale a bone's region and everything distal to it about the bone's head (hands, feet). */
function scaleRegion(asset: BodyAsset, pos: Float32Array, j: Joints, bone: number, k: number): void {
  if (Math.abs(k - 1) < 1e-6) return;
  const cx = j.head[bone * 3], cy = j.head[bone * 3 + 1], cz = j.head[bone * 3 + 2];
  const inRegion = new Uint8Array(BONE_COUNT);
  inRegion[bone] = 1;
  for (const d of DESCENDANTS[bone]) inRegion[d] = 1;
  const { skinIdx, skinW } = asset;
  for (let s = 0; s < asset.srcCount; s++) {
    let f = 0;
    for (let q = 0; q < 4; q++) if (inRegion[skinIdx[s * 4 + q]]) f += skinW[s * 4 + q] / 255;
    if (f === 0) continue;
    const m = (k - 1) * f;
    pos[s * 3] += (pos[s * 3] - cx) * m;
    pos[s * 3 + 1] += (pos[s * 3 + 1] - cy) * m;
    pos[s * 3 + 2] += (pos[s * 3 + 2] - cz) * m;
  }
}

const dist = (a: Float32Array, i: number, b: Float32Array, k: number): number =>
  Math.hypot(a[i * 3] - b[k * 3], a[i * 3 + 1] - b[k * 3 + 1], a[i * 3 + 2] - b[k * 3 + 2]);

/** The body targets the fit aims for, from the definition and (when given) the derived rig. */
export interface FitTargets {
  heightM: number;
  reachM: number;
  legReachM: number;
  shoulderWidthM: number;
  upperArmM: number;
  forearmM: number;
  handM: number;
  thighM: number;
  shankM: number;
}

export function fitTargets(def: FighterDefinition, runtime?: FighterRuntime): FitTargets {
  const b = def.body;
  const meso = buildBlend(def).meso;
  const shoulderWidthM = runtime?.rig.shoulderWidthM ?? 0.2 * b.heightM * (0.92 + 0.16 * meso);
  const armLengthM = runtime?.rig.armLengthM ?? (b.reachM - shoulderWidthM) / 2;
  return {
    heightM: b.heightM,
    reachM: b.reachM,
    legReachM: b.legReachM,
    shoulderWidthM,
    upperArmM: runtime?.rig.upperArmM ?? 0.42 * armLengthM,
    forearmM: runtime?.rig.forearmM ?? 0.33 * armLengthM,
    handM: runtime?.rig.handM ?? 0.25 * armLengthM,
    thighM: runtime?.rig.thighM ?? 0.47 * b.legReachM,
    shankM: runtime?.rig.shankM ?? 0.44 * b.legReachM,
  };
}

/**
 * Segment proportions move halfway from MakeHuman's scanned proportions toward the sim's
 * anthropometric ratios: the sim's ratios are estimates [E], MakeHuman's come from real bodies,
 * and the total (reach, leg length) is matched exactly either way.
 */
const PROPORTION_PULL = 0.5;

function fit(asset: BodyAsset, pos: Float32Array, f: FitTargets): BodyMeasures {
  // 1. Legs: hip height / stature → legReach / height.
  for (let it = 0; it < 2; it++) {
    const { m, joints } = measure(asset, pos);
    const r = clamp(f.legReachM / f.heightM, 0.45, 0.62);
    const d = clamp((r * m.statureM - m.hipHeightM) / (1 - r), -0.12, 0.12);
    for (const [up, lo] of [[B.lUpLeg, B.lLeg], [B.rUpLeg, B.rLeg]] as const) {
      const lt = dist(joints.head, up, joints.head, lo);
      const ls = dist(joints.head, lo, joints.tail, lo);
      const rho = lt / ls + (f.thighM / f.shankM - lt / ls) * PROPORTION_PULL;
      const total = lt + ls + d;
      const dt = (total * rho) / (1 + rho) - lt;
      stretchSegment(asset, pos, joints, up, dt);
      // Joints moved with the thigh; re-derive before stretching the shank.
      const j2 = deriveJoints(asset, pos);
      stretchSegment(asset, pos, j2, lo, d - dt);
    }
  }
  // 2. Uniform scale to stature, soles on the floor.
  {
    const { m } = measure(asset, pos);
    const s = f.heightM / m.statureM;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] *= s;
      pos[i + 1] = (pos[i + 1] - m.floorY) * s;
      pos[i + 2] *= s;
    }
  }
  // 3. Shoulder width (clavicles), limited to what the flesh tolerates.
  for (let it = 0; it < 2; it++) {
    const { m, joints } = measure(asset, pos);
    const d = clamp(f.shoulderWidthM - m.shoulderWidthM, -0.05, 0.05) / 2;
    stretchSegment(asset, pos, joints, B.lShoulder, d);
    stretchSegment(asset, pos, joints, B.rShoulder, d);
  }
  // 4. Arms: span → reach, segments pulled toward the rig's proportions.
  for (let it = 0; it < 3; it++) {
    const { m, joints, t } = measure(asset, pos);
    const need = (f.reachM - m.spanM) / 2;
    for (const [arm, fore, hand, sign] of [[B.lArm, B.lForeArm, B.lHand, 1], [B.rArm, B.rForeArm, B.rHand, -1]] as const) {
      const cu = dist(joints.head, arm, joints.head, fore);
      const cf = dist(joints.head, fore, joints.head, hand);
      // Hand length: wrist to the span extreme, measured in the T-pose.
      const ch = Math.max(0.12, m.spanM / 2 - sign * t.headT[hand * 3]);
      const wu = cu + (f.upperArmM - cu) * PROPORTION_PULL * (it === 0 ? 1 : 0);
      const wf = cf + (f.forearmM - cf) * PROPORTION_PULL * (it === 0 ? 1 : 0);
      const wh = ch + (f.handM - ch) * PROPORTION_PULL * 0.4 * (it === 0 ? 1 : 0);
      const want = cu + cf + ch + need;
      const k = want / (wu + wf + wh);
      const du = clamp(wu * k - cu, -0.08, 0.08);
      const df = clamp(wf * k - cf, -0.08, 0.08);
      const hk = clamp((wh * k) / ch, 0.85, 1.18);
      stretchSegment(asset, pos, joints, arm, du);
      let j2 = deriveJoints(asset, pos);
      stretchSegment(asset, pos, j2, fore, df);
      j2 = deriveJoints(asset, pos);
      scaleRegion(asset, pos, j2, hand, hk);
    }
  }
  return measure(asset, pos).m;
}

// ---------------------------------------------------------------------------
// Normals, cavity, face and swelling morphs
// ---------------------------------------------------------------------------

/** Area-weighted vertex normals over a triangle list whose indices map to src via `map`. */
export function computeNormals(
  pos: Float32Array, index: ArrayLike<number>, map: ArrayLike<number> | null, out: Float32Array,
): void {
  for (let t = 0; t < index.length; t += 3) {
    const a = map ? map[index[t]] : index[t];
    const b = map ? map[index[t + 1]] : index[t + 1];
    const c = map ? map[index[t + 2]] : index[t + 2];
    const e1x = pos[b * 3] - pos[a * 3], e1y = pos[b * 3 + 1] - pos[a * 3 + 1], e1z = pos[b * 3 + 2] - pos[a * 3 + 2];
    const e2x = pos[c * 3] - pos[a * 3], e2y = pos[c * 3 + 1] - pos[a * 3 + 1], e2z = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) { out[v * 3] += nx; out[v * 3 + 1] += ny; out[v * 3 + 2] += nz; }
  }
}

function normalizeRange(n: Float32Array, from: number, to: number): void {
  for (let s = from; s < to; s++) {
    const l = Math.hypot(n[s * 3], n[s * 3 + 1], n[s * 3 + 2]) || 1;
    n[s * 3] /= l; n[s * 3 + 1] /= l; n[s * 3 + 2] /= l;
  }
}

const adjacencyCache = new WeakMap<BodyAsset, { start: Uint32Array; list: Uint16Array }>();

/** Welded body adjacency (src space), built once per asset. */
function adjacency(asset: BodyAsset): { start: Uint32Array; list: Uint16Array } {
  const hit = adjacencyCache.get(asset);
  if (hit) return hit;
  const n = asset.header.counts.body;
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set());
  const idx = asset.lodIndex[0], map = asset.renderSrc;
  for (let t = 0; t < idx.length; t += 3) {
    const a = map[idx[t]], b = map[idx[t + 1]], c = map[idx[t + 2]];
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
  }
  const start = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + sets[i].size;
  const list = new Uint16Array(start[n]);
  for (let i = 0; i < n; i++) [...sets[i]].sort((x, y) => x - y).forEach((v, k) => { list[start[i] + k] = v; });
  const out = { start, list };
  adjacencyCache.set(asset, out);
  return out;
}

/**
 * Cavity: how far a vertex sits below the mean of its neighbours along its normal, normalised by
 * edge length (positive in creases between muscles, negative on ridges), smoothed once. The skin
 * shader darkens and reddens creases by it, scaled by muscle definition.
 */
function computeCavity(asset: BodyAsset, pos: Float32Array, nrm: Float32Array): Float32Array {
  const { start, list } = adjacency(asset);
  const n = asset.header.counts.body;
  const raw = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    let mx = 0, my = 0, mz = 0, el = 0;
    const c = start[v + 1] - start[v];
    for (let k = start[v]; k < start[v + 1]; k++) {
      const u = list[k];
      mx += pos[u * 3]; my += pos[u * 3 + 1]; mz += pos[u * 3 + 2];
      el += Math.hypot(pos[u * 3] - pos[v * 3], pos[u * 3 + 1] - pos[v * 3 + 1], pos[u * 3 + 2] - pos[v * 3 + 2]);
    }
    if (c === 0) continue;
    mx = mx / c - pos[v * 3]; my = my / c - pos[v * 3 + 1]; mz = mz / c - pos[v * 3 + 2];
    raw[v] = (mx * nrm[v * 3] + my * nrm[v * 3 + 1] + mz * nrm[v * 3 + 2]) / (el / c + 1e-6);
  }
  const out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    let s = raw[v] * 2, w = 2;
    for (let k = start[v]; k < start[v + 1]; k++) { s += raw[list[k]]; w++; }
    out[v] = clamp((s / w) * 4, -1, 1);
  }
  return out;
}

/** Face channel recipes: [expression unit, weight] (ethnic variants blended by the face shape). */
const FACE_RECIPES: Readonly<Record<(typeof FACE_CHANNELS)[number], readonly [string, number][]>> = {
  eyesClosedL: [['eye-left-closure', 1]],
  eyesClosedR: [['eye-right-closure', 1]],
  browDown: [['eyebrows-left-down', 1], ['eyebrows-right-down', 1]],
  mouthOpen: [['mouth-open', 1]],
  grimace: [['mouth-retraction', 0.85], ['mouth-parling', 0.5], ['eye-left-slit', 0.3], ['eye-right-slit', 0.3],
    ['nose-left-elevation', 0.4], ['nose-right-elevation', 0.4]],
  jawSlack: [['mouth-open', 0.5], ['mouth-depression', 0.35], ['eye-left-slit', 0.25], ['eye-right-slit', 0.25]],
  wince: [['eye-left-slit', 0.75], ['eye-right-slit', 0.75], ['eyebrows-left-inner-up', 0.5], ['eyebrows-right-inner-up', 0.5],
    ['eyebrows-left-down', 0.35], ['eyebrows-right-down', 0.35], ['nose-left-elevation', 0.5], ['nose-right-elevation', 0.5],
    ['mouth-compression', 0.35]],
  breathe: [['nose-left-dilatation', 0.8], ['nose-right-dilatation', 0.8], ['mouth-parling', 0.45]],
};

export const SWELL_CHANNELS = ['browL', 'browR', 'cheekL', 'cheekR', 'nose', 'lip'] as const;

/** Landmarks on the head (A-pose, metres), found geometrically on the fitted body. */
export interface FaceLandmarks {
  eyeL: V3; eyeR: V3; eyeRadius: number;
  browL: V3; browR: V3; cheekL: V3; cheekR: V3; noseTip: V3; lips: V3;
}

function findLandmarks(asset: BodyAsset, pos: Float32Array, eyeRadius: number): FaceLandmarks {
  const nBody = asset.header.counts.body;
  const e = (name: string): V3 => {
    const s = asset.virtualIndex(name);
    return [pos[s * 3], pos[s * 3 + 1], pos[s * 3 + 2]];
  };
  const eyeL = e('eye-l'), eyeR = e('eye-r');
  const headW = (s: number): number => {
    let w = 0;
    for (let k = 0; k < 4; k++) if (asset.skinIdx[s * 4 + k] === B.head) w += asset.skinW[s * 4 + k] / 255;
    return w;
  };
  /** The most forward head vertex inside a box. */
  const front = (x0: number, x1: number, y0: number, y1: number): V3 => {
    let best = -1, bz = -Infinity;
    for (let s = 0; s < nBody; s++) {
      const x = pos[s * 3], y = pos[s * 3 + 1], z = pos[s * 3 + 2];
      if (x < x0 || x > x1 || y < y0 || y > y1 || headW(s) < 0.5) continue;
      if (z > bz) { bz = z; best = s; }
    }
    return best < 0 ? [(x0 + x1) / 2, (y0 + y1) / 2, eyeL[2]] : [pos[best * 3], pos[best * 3 + 1], pos[best * 3 + 2]];
  };
  const r = eyeRadius;
  const brow = (eye: V3): V3 => front(eye[0] - 0.8 * r, eye[0] + 0.8 * r, eye[1] + 1.2 * r, eye[1] + 2.4 * r);
  const cheek = (eye: V3, out: number): V3 => {
    const x0 = out > 0 ? eye[0] : eye[0] - 1.6 * r;
    return front(x0, x0 + 1.6 * r, eye[1] - 3.2 * r, eye[1] - 1.8 * r);
  };
  const cx = (eyeL[0] + eyeR[0]) / 2, cy = (eyeL[1] + eyeR[1]) / 2;
  const noseTip = front(cx - r, cx + r, cy - 5 * r, cy - r);
  const lips = front(cx - 1.2 * r, cx + 1.2 * r, noseTip[1] - 4.5 * r, noseTip[1] - 2 * r);
  return {
    eyeL, eyeR, eyeRadius,
    browL: brow(eyeL), browR: brow(eyeR),
    cheekL: cheek(eyeL, 1), cheekR: cheek(eyeR, -1),
    noseTip, lips,
  };
}

/** A bump along the normal: gaussian falloff around `c` with radius `rad`, peak `amp` metres. */
function bump(
  asset: BodyAsset, pos: Float32Array, nrm: Float32Array, out: Float32Array,
  c: V3, rad: number, amp: number, stretchY = 1,
): void {
  const nBody = asset.header.counts.body;
  for (let s = 0; s < nBody; s++) {
    const dx = pos[s * 3] - c[0], dy = (pos[s * 3 + 1] - c[1]) / stretchY, dz = pos[s * 3 + 2] - c[2];
    const d2 = (dx * dx + dy * dy + dz * dz) / (rad * rad);
    if (d2 > 9) continue;
    // Only skin facing forward-ish gets pushed; the inside of the mouth and the eye sockets stay.
    const facing = clamp01(nrm[s * 3 + 2] * 1.5 + 0.3);
    const w = Math.exp(-d2) * amp * facing;
    out[s * 3] += nrm[s * 3] * w;
    out[s * 3 + 1] += nrm[s * 3 + 1] * w;
    out[s * 3 + 2] += nrm[s * 3 + 2] * w;
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface BuiltBody {
  params: BodyParams;
  targets: FitTargets;
  measures: BodyMeasures;
  /** Morphed, fitted A-pose positions and normals (src space). */
  pos: Float32Array;
  normal: Float32Array;
  /** Per body vertex (src 0..body), -1..1, positive in creases. */
  cavity: Float32Array;
  jointsA: Joints;
  aToT: APoseToT;
  /** Canonical T-pose joints of this body (the contract's rest skeleton). */
  rest: RestSkeleton;
  /** FACE_CHANNELS morph deltas, src space, A-pose. */
  faceMorphs: Float32Array[];
  /** SWELL_CHANNELS morph deltas at full swelling. */
  swellMorphs: Float32Array[];
  landmarks: FaceLandmarks;
  /** Global scale applied to the MakeHuman body (for sizing props such as eyes). */
  scale: number;
}

/** MakeHuman's helper eye radius on the default body (0.1 m units), in metres. */
const EYE_RADIUS_M = 0.0122;

export function buildBody(asset: BodyAsset, def: FighterDefinition, runtime?: FighterRuntime): BuiltBody {
  const params = bodyParams(def, runtime);
  const pos = asset.srcPos.slice();
  for (const [name, w] of targetWeights(params)) {
    const t = asset.targets.get(name);
    if (t) applyTarget(pos, t, w);
  }
  // Scale of the morphed body before fitting, to size the eyes.
  const before = measure(asset, pos).m.statureM;
  const f = fitTargets(def, runtime);
  const measures = fit(asset, pos, f);
  const scale = f.heightM / before;

  // Normals: body over its welded triangles, helpers over their own.
  const normal = new Float32Array(asset.srcCount * 3);
  computeNormals(pos, asset.lodIndex[0], asset.renderSrc, normal);
  computeNormals(pos, asset.tightsIndex, null, normal);
  computeNormals(pos, asset.teethIndex, null, normal);
  normalizeRange(normal, 0, asset.srcCount);
  const cavity = computeCavity(asset, pos, normal);

  const jointsA = deriveJoints(asset, pos);
  const aToT = aPoseToT(jointsA);
  const rest = finishRest(aToT.headT.slice(), aToT.tailT.slice(), measures.statureM);

  // Face channels: ethnic expression units blended by the face shape, scaled with the body.
  const shape = params.shape;
  const faceMorphs = FACE_CHANNELS.map((ch) => {
    const d = new Float32Array(asset.srcCount * 3);
    for (const [unit, w] of FACE_RECIPES[ch]) {
      RACES.forEach((r, i) => {
        const t = asset.targets.get(`expr/${r}/${unit}`);
        if (t && shape[i] > 0) applyTarget(d, t, w * shape[i] * scale);
      });
    }
    return d;
  });
  // Breathing also lifts the chest a few millimetres.
  {
    const d = faceMorphs[FACE_CHANNELS.indexOf('breathe')];
    const nBody = asset.header.counts.body;
    for (let s = 0; s < nBody; s++) {
      let w = 0;
      for (let k = 0; k < 4; k++) {
        const b = asset.skinIdx[s * 4 + k];
        const ww = asset.skinW[s * 4 + k] / 255;
        if (b === B.spine2) w += ww; else if (b === B.spine1) w += 0.6 * ww; else if (b === B.spine) w += 0.25 * ww;
      }
      if (w === 0) continue;
      const a = 0.007 * w * clamp01(normal[s * 3 + 2] + 0.4);
      d[s * 3] += normal[s * 3] * a; d[s * 3 + 1] += normal[s * 3 + 1] * a + 0.002 * w; d[s * 3 + 2] += normal[s * 3 + 2] * a;
    }
  }

  const landmarks = findLandmarks(asset, pos, EYE_RADIUS_M * scale);
  const r = landmarks.eyeRadius;
  const swellMorphs = SWELL_CHANNELS.map(() => new Float32Array(asset.srcCount * 3));
  // Brow / orbit: the ridge swells and the upper lid puffs down over the eye.
  bump(asset, pos, normal, swellMorphs[0], landmarks.browL, 1.5 * r, 0.011);
  bump(asset, pos, normal, swellMorphs[0], [landmarks.eyeL[0], landmarks.eyeL[1] + 0.5 * r, landmarks.eyeL[2] + r], 0.9 * r, 0.005);
  bump(asset, pos, normal, swellMorphs[1], landmarks.browR, 1.5 * r, 0.011);
  bump(asset, pos, normal, swellMorphs[1], [landmarks.eyeR[0], landmarks.eyeR[1] + 0.5 * r, landmarks.eyeR[2] + r], 0.9 * r, 0.005);
  bump(asset, pos, normal, swellMorphs[2], landmarks.cheekL, 1.9 * r, 0.011, 1.2);
  bump(asset, pos, normal, swellMorphs[3], landmarks.cheekR, 1.9 * r, 0.011, 1.2);
  bump(asset, pos, normal, swellMorphs[4], [landmarks.noseTip[0], landmarks.noseTip[1] + 1.2 * r, landmarks.noseTip[2] - 0.5 * r], 1.4 * r, 0.006, 1.6);
  bump(asset, pos, normal, swellMorphs[5], landmarks.lips, 1.1 * r, 0.006, 0.6);

  return { params, targets: f, measures, pos, normal, cavity, jointsA, aToT, rest, faceMorphs, swellMorphs, landmarks, scale };
}

/** T-pose positions of a built body (src space), for measurement and tests. */
export function builtToT(asset: BodyAsset, body: BuiltBody): Float32Array {
  return skinToT(asset, body.pos, body.jointsA, body.aToT);
}
