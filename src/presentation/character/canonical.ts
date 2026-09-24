/**
 * CANONICAL BODY SPACE — per-vertex data that is the same for every fighter.
 *
 * The un-morphed MakeHuman base mesh, posed into the canonical T-pose with its soles on y = 0, is
 * the reference space for everything the skin shader draws procedurally: hairline, beard,
 * eyebrows, tattoos, cut sites, damage zones, sweat and flush distribution. Because it is the same
 * space for every fighter, a cut on the left brow is on the left brow of a flyweight and a
 * heavyweight alike, whatever the morphs did to the geometry.
 */
import { B } from '../rig/skeleton';
import type { BodyAsset } from './asset';
import { aPoseToT, deriveJoints, skinToT, computeNormals } from './body';
import { lashAt, sweatRegion } from './anatomy';

type V3 = [number, number, number];

export interface CanonicalLandmarks {
  eyeL: V3; eyeR: V3; noseTip: V3; lips: V3; chin: V3; browL: V3; browR: V3; cheekL: V3; cheekR: V3;
  earL: V3; earR: V3; crownY: number; neckY: number; headCentre: V3;
}

export interface Canonical {
  /** Canonical position per src vertex (T-pose, soles on the floor). */
  pos: Float32Array;
  normal: Float32Array;
  lm: CanonicalLandmarks;
  /** Per src body vertex: palm/sole, thin (back-scatter), oil (T-zone), lash line. */
  misc: Float32Array;
  /** Per src body vertex: regional sweat propensity, flush weight, hand-wrap mask, static AO (1 = open). */
  fx: Float32Array;
  /** Damage zones 0-3 and 4-7 (docs/design/08 §2.2 order), legs as LEFT (6) / RIGHT (7). */
  zoneA: Float32Array;
  zoneB: Float32Array;
  /** Canonical T-pose joint heads (BONE_COUNT x 3), floor at 0. */
  jointT: Float32Array;
}

const cache = new WeakMap<BodyAsset, Canonical>();

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function canonical(asset: BodyAsset): Canonical {
  const hit = cache.get(asset);
  if (hit) return hit;
  const src = asset.srcPos;
  const j = deriveJoints(asset, src);
  const t = aPoseToT(j);
  const pos = skinToT(asset, src, j, t);
  const nBody = asset.header.counts.body;
  let floor = Infinity;
  for (let s = 0; s < nBody; s++) floor = Math.min(floor, pos[s * 3 + 1]);
  for (let s = 0; s < asset.srcCount; s++) pos[s * 3 + 1] -= floor;
  const normal = new Float32Array(asset.srcCount * 3);
  computeNormals(pos, asset.lodIndex[0], asset.renderSrc, normal);
  for (let s = 0; s < nBody; s++) {
    const l = Math.hypot(normal[s * 3], normal[s * 3 + 1], normal[s * 3 + 2]) || 1;
    normal[s * 3] /= l; normal[s * 3 + 1] /= l; normal[s * 3 + 2] /= l;
  }

  const P = (s: number): V3 => [pos[s * 3], pos[s * 3 + 1], pos[s * 3 + 2]];
  const w = (s: number, bones: readonly number[]): number => {
    let x = 0;
    for (let k = 0; k < 4; k++) if (bones.includes(asset.skinIdx[s * 4 + k])) x += asset.skinW[s * 4 + k] / 255;
    return x;
  };
  const eyeL = P(asset.virtualIndex('eye-l'));
  const eyeR = P(asset.virtualIndex('eye-r'));
  const r = 0.0122 * 0.96;
  const front = (x0: number, x1: number, y0: number, y1: number): V3 => {
    let best = -1, bz = -Infinity;
    for (let s = 0; s < nBody; s++) {
      const x = pos[s * 3], y = pos[s * 3 + 1], z = pos[s * 3 + 2];
      if (x < x0 || x > x1 || y < y0 || y > y1 || w(s, [B.head]) < 0.5) continue;
      if (z > bz) { bz = z; best = s; }
    }
    return P(Math.max(0, best));
  };
  const cx = (eyeL[0] + eyeR[0]) / 2, cy = (eyeL[1] + eyeR[1]) / 2;
  const noseTip = front(cx - r, cx + r, cy - 5 * r, cy - r);
  const lips = front(cx - 1.2 * r, cx + 1.2 * r, noseTip[1] - 4.5 * r, noseTip[1] - 2 * r);
  const chin = front(cx - 1.5 * r, cx + 1.5 * r, lips[1] - 5 * r, lips[1] - 2.2 * r);
  const browL = front(eyeL[0] - 0.8 * r, eyeL[0] + 0.8 * r, eyeL[1] + 1.2 * r, eyeL[1] + 2.4 * r);
  const browR = front(eyeR[0] - 0.8 * r, eyeR[0] + 0.8 * r, eyeR[1] + 1.2 * r, eyeR[1] + 2.4 * r);
  const cheekL = front(eyeL[0], eyeL[0] + 1.6 * r, eyeL[1] - 3.2 * r, eyeL[1] - 1.8 * r);
  const cheekR = front(eyeR[0] - 1.6 * r, eyeR[0], eyeR[1] - 3.2 * r, eyeR[1] - 1.8 * r);
  // Ears: the most lateral head vertices at eye height.
  let earL: V3 = eyeL, earR: V3 = eyeR, crownY = 0;
  for (let s = 0; s < nBody; s++) {
    if (w(s, [B.head]) < 0.5) continue;
    const p = P(s);
    if (p[1] > crownY) crownY = p[1];
    if (Math.abs(p[1] - (eyeL[1] - r)) < 2 * r) {
      if (p[0] > earL[0]) earL = p;
      if (p[0] < earR[0]) earR = p;
    }
  }
  const neckY = t.headT[B.neck * 3 + 1] - floor;
  const headCentre: V3 = [0, (crownY + chin[1]) / 2, (eyeL[2] + earL[2]) / 2 - 0.01];
  const lm: CanonicalLandmarks = { eyeL, eyeR, noseTip, lips, chin, browL, browR, cheekL, cheekR, earL, earR, crownY, neckY, headCentre };

  const misc = new Float32Array(nBody * 4);
  const fx = new Float32Array(nBody * 4);
  const zoneA = new Float32Array(nBody * 4);
  const zoneB = new Float32Array(nBody * 4);
  const g = (p: V3, c: V3, rad: number, sy = 1): number => {
    const dx = p[0] - c[0], dy = (p[1] - c[1]) / sy, dz = p[2] - c[2];
    return Math.exp(-(dx * dx + dy * dy + dz * dz) / (rad * rad));
  };
  const hands = [B.lHand, B.rHand];
  const fingers: number[] = [];
  for (let b = 0; b < asset.header.bones.length; b++) if (/Hand(Index|Middle|Ring|Pinky|Thumb)/.test(asset.header.bones[b])) fingers.push(b);
  const feet = [B.lFoot, B.rFoot, B.lToe, B.rToe];
  for (let s = 0; s < nBody; s++) {
    const p = P(s);
    const ny = normal[s * 3 + 1], nz = normal[s * 3 + 2], nx = normal[s * 3];
    const wh = w(s, hands) + w(s, fingers);
    const wf = w(s, feet);
    const head = w(s, [B.head]);
    const neck = w(s, [B.neck]);
    const chest = w(s, [B.spine2]);
    const abd = w(s, [B.spine, B.spine1]);
    const arms = w(s, [B.lArm, B.rArm, B.lForeArm, B.rForeArm]);
    const shoulders = w(s, [B.lShoulder, B.rShoulder]);
    const legs = w(s, [B.lUpLeg, B.rUpLeg, B.lLeg, B.rLeg]);
    // Palms (T-pose palms face down) and soles.
    const palm = wh * smooth(0.15, 0.65, -ny) + wf * smooth(0.35, 0.85, -ny) * smooth(0.05, 0.0, p[1]);
    const thin = Math.min(1, 0.8 * w(s, fingers) + 0.45 * g(p, noseTip, 1.2 * r) + 0.25 * wf * smooth(0.12, 0.2, p[2]));
    const oil = head * Math.min(1, g(p, noseTip, 2.5 * r, 1.6) + g(p, [cx, cy + 3.2 * r, eyeL[2] + 0.4 * r], 3.2 * r, 0.7) * 0.8 + 0.25 * g(p, chin, 2 * r));
    misc.set([Math.min(1, palm), thin, oil, lashAt(p)], s * 4);
    const sweat = sweatRegion(p, [nx, ny, nz]);
    const flush = Math.min(1,
      head * (0.35 + 0.65 * Math.min(1, g(p, cheekL, 2.4 * r) + g(p, cheekR, 2.4 * r) + g(p, noseTip, 1.6 * r) +
        g(p, earL, 2.2 * r) + g(p, earR, 2.2 * r))) + neck * 0.55 + chest * 0.5 * smooth(-0.2, 0.3, nz) + shoulders * 0.25);
    // Hand-wrap coverage: the hand, the knuckles and ~8 cm of forearm above the wrist.
    const wristX = t.headT[B.lHand * 3];
    const wrap = w(s, [B.lForeArm, B.rForeArm]) * smooth(wristX - 0.1, wristX - 0.075, Math.abs(p[0])) + w(s, hands) +
      0.6 * w(s, fingers) * smooth(0.035, 0.0, Math.abs(p[0]) - (wristX + 0.105));
    fx.set([sweat, flush, Math.min(1, wrap), 1], s * 4);
    // Damage zones.
    const eyeZone = (eye: V3, brow: V3): number => head * Math.min(1, g(p, brow, 2.4 * r, 0.8) + 0.8 * g(p, eye, 1.6 * r)) * smooth(-0.2, 0.3, nz);
    const z0 = eyeZone(eyeL, browL);
    const z1 = eyeZone(eyeR, browR);
    const z2 = head * Math.min(1, g(p, noseTip, 1.8 * r, 1.5) + g(p, lips, 1.8 * r, 0.8)) * smooth(-0.2, 0.3, nz);
    const jaw = (cheek: V3, side: number): number => head * Math.min(1, g(p, cheek, 2.6 * r, 1.3) +
      0.8 * g(p, [cheek[0] + side * 0.4 * r, chin[1] + 1.5 * r, cheek[2] - 2.5 * r], 2.6 * r));
    const z3 = jaw(cheekL, 1), z4 = jaw(cheekR, -1);
    const z5 = Math.min(1, (abd + 0.6 * chest) * smooth(-0.3, 0.2, nz + Math.abs(nx) * 0.6));
    const thighL = w(s, [B.lUpLeg]) * smooth(0.82, 0.7, p[1]), calfL = w(s, [B.lLeg]) * smooth(0.12, 0.3, p[1]);
    const thighR = w(s, [B.rUpLeg]) * smooth(0.82, 0.7, p[1]), calfR = w(s, [B.rLeg]) * smooth(0.12, 0.3, p[1]);
    zoneA.set([z0, z1, z2, z3], s * 4);
    zoneB.set([z4, z5, Math.min(1, thighL + 0.8 * calfL), Math.min(1, thighR + 0.8 * calfR)], s * 4);
  }
  staticAO(asset, pos, normal, fx);
  const jointT = t.headT.slice();
  for (let i = 1; i < jointT.length; i += 3) jointT[i] -= floor;
  const out: Canonical = { pos, normal, lm, misc, fx, zoneA, zoneB, jointT };
  cache.set(asset, out);
  return out;
}

/**
 * Static ambient occlusion per body vertex in the canonical T-pose (point-based: each nearby
 * vertex is a small disc of a third of its triangles' area; occlusion is the summed disc form
 * factor). Catches what is always shadowed whatever the pose — under the jaw, eye sockets,
 * nostrils, ears, between the fingers and toes, the navel — for the skin's image-based light,
 * which otherwise mirrors the bright canvas into every downward-facing crease. Written to fx[3].
 */
function staticAO(asset: BodyAsset, pos: Float32Array, normal: Float32Array, fx: Float32Array): void {
  const n = asset.header.counts.body;
  const area = new Float32Array(n);
  const idx = asset.lodIndex[0], map = asset.renderSrc;
  for (let t = 0; t < idx.length; t += 3) {
    const a = map[idx[t]], b = map[idx[t + 1]], c = map[idx[t + 2]];
    const e1 = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
    const e2 = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
    const A = 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 3;
    area[a] += A; area[b] += A; area[c] += A;
  }
  const R = 0.08, cell = R;
  const key = (x: number, y: number, z: number): number => ((Math.floor(x / cell) + 64) * 128 + (Math.floor(y / cell) + 8)) * 128 + (Math.floor(z / cell) + 64);
  const grid = new Map<number, number[]>();
  for (let s = 0; s < n; s++) {
    const k = key(pos[s * 3], pos[s * 3 + 1], pos[s * 3 + 2]);
    let l = grid.get(k);
    if (!l) { l = []; grid.set(k, l); }
    l.push(s);
  }
  for (let s = 0; s < n; s++) {
    const px = pos[s * 3], py = pos[s * 3 + 1], pz = pos[s * 3 + 2];
    const nx = normal[s * 3], ny = normal[s * 3 + 1], nz = normal[s * 3 + 2];
    // Start a hair above the surface so the vertex does not see its own tangent plane.
    const ox = px + nx * 0.002, oy = py + ny * 0.002, oz = pz + nz * 0.002;
    const cx = Math.floor(px / cell), cy = Math.floor(py / cell), cz = Math.floor(pz / cell);
    let occ = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const l = grid.get(((cx + i + 64) * 128 + (cy + j + 8)) * 128 + (cz + k + 64));
      if (!l) continue;
      for (const o of l) {
        const dx = pos[o * 3] - ox, dy = pos[o * 3 + 1] - oy, dz = pos[o * 3 + 2] - oz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R * R || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const cosV = (nx * dx + ny * dy + nz * dz) / d;
        if (cosV <= 0.05) continue;
        const cosO = Math.abs(normal[o * 3] * dx + normal[o * 3 + 1] * dy + normal[o * 3 + 2] * dz) / d;
        occ += (area[o] * cosV * cosO) / (Math.PI * d2 + area[o]);
      }
    }
    fx[s * 4 + 3] = Math.max(0.15, 1 - Math.min(1, occ * 1.4));
  }
}

