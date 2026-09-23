/**
 * What the camera frames: a handful of world-space points per fighter.
 *
 * The director prefers the animated bodies (`WorldPose`, one per fighter, from
 * the animation module's forward kinematics) so a lunging jab or a fighter
 * dropped flat is framed where the body actually is. When a pose is missing or
 * not yet evaluated it falls back to a stand-in built from the snapshot alone,
 * which is also what the dev page and the tests draw.
 */
import type { FighterSnapshot, TickSnapshot } from '../../sim';
import { B, BONE_COUNT, createWorldPose, type WorldPose } from '../rig/skeleton';
import { lerp, type V3, wrapAngle } from './math';

export interface FighterPoints {
  id: number;
  posture: FighterSnapshot['posture'];
  /** Top of the skull. */
  crown: V3;
  /** Centre of the head (between the eyes), for focus and face framing. */
  head: V3;
  neck: V3;
  chest: V3;
  hips: V3;
  handL: V3;
  handR: V3;
  /** Soles, on or near the floor. */
  footL: V3;
  footR: V3;
  /** Floor position (hips projected to y = 0). */
  ground: V3;
  facing: number;
  velocity: [number, number];
}

const readPos = (arr: Float32Array, i: number): V3 => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];

function poseLooksValid(w: WorldPose | undefined): w is WorldPose {
  if (!w || w.pos.length < BONE_COUNT * 3) return false;
  const hy = w.tip[B.head * 3 + 1];
  const hipsY = w.pos[B.hips * 3 + 1];
  // An unevaluated buffer is all zeros; a real body has its crown off the floor.
  return Number.isFinite(hy) && Number.isFinite(hipsY) && (hy > 0.05 || hipsY > 0.05);
}

export function pointsFromWorldPose(id: number, w: WorldPose, snap: FighterSnapshot | undefined): FighterPoints {
  const sole = (i: number): V3 => {
    const p = readPos(w.pos, i);
    return [p[0], Math.max(0, p[1] - 0.09), p[2]];
  };
  const hips = readPos(w.pos, B.hips);
  return {
    id,
    posture: snap?.posture ?? 'standing',
    crown: readPos(w.tip, B.head),
    head: readPos(w.pos, B.head).map((v, k) => (v + w.tip[B.head * 3 + k]) / 2) as V3,
    neck: readPos(w.pos, B.neck),
    chest: readPos(w.pos, B.spine2),
    hips,
    handL: readPos(w.tip, B.lHand),
    handR: readPos(w.tip, B.rHand),
    footL: sole(B.lFoot),
    footR: sole(B.rFoot),
    ground: [hips[0], 0, hips[2]],
    facing: snap?.facing ?? 0,
    velocity: [snap?.vx ?? 0, snap?.vz ?? 0],
  };
}

// ---------------------------------------------------------------------------
// Stand-in body from the snapshot
// ---------------------------------------------------------------------------

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/**
 * Local-space joints of a stand-in body (fighter faces +Z, left is +X), in
 * metres for a 1.8 m fighter; scaled by stature.
 */
function standInLocal(f: FighterSnapshot, opp: FighterSnapshot | undefined): Record<string, V3> {
  const southpaw = f.stance === 'southpaw';
  const lead = southpaw ? -1 : 1; // lead side sign on X
  const posture = f.posture;
  if (posture === 'ground' || posture === 'down' || posture === 'out') {
    const bottom = posture !== 'ground' || f.role === 'bottom';
    if (bottom) {
      // Flat on the back, head toward -Z of the body frame (away from facing).
      return {
        hips: [0, 0.16, 0], chest: [0, 0.16, -0.38], neck: [0, 0.14, -0.58], head: [0, 0.13, -0.68],
        crown: [0, 0.12, -0.84], handL: [0.3, 0.3, -0.35], handR: [-0.3, 0.3, -0.35],
        footL: [0.2, 0.2, 0.85], footR: [-0.2, 0.2, 0.85],
      };
    }
    // Top: kneeling / posted over the partner.
    return {
      hips: [0, 0.55, -0.1], chest: [0, 0.8, 0.2], neck: [0, 0.92, 0.38], head: [0, 0.95, 0.47],
      crown: [0, 1.0, 0.6], handL: [0.3, 0.3, 0.55], handR: [-0.3, 0.3, 0.55],
      footL: [0.25, 0.05, -0.55], footR: [-0.25, 0.05, -0.55],
    };
  }
  const clinch = posture === 'clinch';
  const striking = f.actionStage === 'contact' || (f.actionStage === 'startup' && f.actionPhase > 0.6);
  const kick = /kick|knee/.test(String(f.action));
  const reachZ = striking && !kick ? 0.72 : clinch ? 0.34 : 0.28;
  const handLead: V3 = [0.14 * lead, clinch ? 1.3 : 1.45, reachZ];
  const handRear: V3 = [-0.14 * lead, clinch ? 1.3 : 1.47, clinch ? 0.34 : 0.22];
  const lean = clinch ? 0.18 : 0.05;
  const footLead: V3 = [0.14 * lead, 0, 0.32];
  const footRear: V3 = [-0.16 * lead, 0, -0.3];
  if (striking && kick) footLead[1] = 0.9;
  void opp;
  return {
    hips: [0, 0.98, 0], chest: [0, 1.3, lean * 0.6], neck: [0, 1.5, lean], head: [0, 1.6, lean + 0.02],
    crown: [0, 1.8, lean + 0.04],
    handL: southpaw ? handRear : handLead,
    handR: southpaw ? handLead : handRear,
    footL: southpaw ? footRear : footLead,
    footR: southpaw ? footLead : footRear,
  };
}

/**
 * Interpolated stand-in points for fighter `i` between two snapshots. `stature`
 * scales the body (1.8 m reference).
 */
export function standInPoints(
  frame: TickSnapshot, next: TickSnapshot | null, alpha: number, i: number, stature = 1.8,
): FighterPoints {
  const a = frame.fighters[i];
  const b = next?.fighters[i] ?? a;
  const t = next ? alpha : 0;
  const x = lerp(a.x, b.x, t);
  const z = lerp(a.z, b.z, t);
  const facing = lerpAngle(a.facing, b.facing, t);
  const opp = frame.fighters.find((o) => o.id !== a.id);
  const local = standInLocal(t < 0.5 ? a : b, opp);
  const s = stature / 1.8;
  const c = Math.cos(facing);
  const sn = Math.sin(facing);
  const world = (p: V3): V3 => {
    const lx = p[0] * s;
    const lz = p[2] * s;
    return [x + lx * c + lz * sn, p[1] * s, z - lx * sn + lz * c];
  };
  return {
    id: a.id,
    posture: a.posture,
    crown: world(local.crown),
    head: world(local.head),
    neck: world(local.neck),
    chest: world(local.chest),
    hips: world(local.hips),
    handL: world(local.handL),
    handR: world(local.handR),
    footL: world(local.footL),
    footR: world(local.footR),
    ground: [x, 0, z],
    facing,
    velocity: [lerp(a.vx, b.vx, t), lerp(a.vz, b.vz, t)],
  };
}

/** Every fighter's points: the animated body when valid, else the stand-in. */
export function fighterPoints(
  frame: TickSnapshot, next: TickSnapshot | null, alpha: number,
  poses: readonly WorldPose[], statures: readonly number[],
): FighterPoints[] {
  const out: FighterPoints[] = [];
  for (let i = 0; i < frame.fighters.length; i++) {
    const f = frame.fighters[i];
    if (f.posture === 'out' && frame.fighters.length > 2) continue;
    const w = poses[i];
    out.push(poseLooksValid(w) ? pointsFromWorldPose(f.id, w, f) : standInPoints(frame, next, alpha, i, statures[i] ?? 1.8));
  }
  return out;
}

/**
 * Write a stand-in body into a `WorldPose` (key joints only), for the dev
 * page's capsule fighters and for tests that exercise the WorldPose path.
 */
export function standInWorldPose(p: FighterPoints, out: WorldPose = createWorldPose()): WorldPose {
  const put = (arr: Float32Array, i: number, v: V3): void => {
    arr[i * 3] = v[0]; arr[i * 3 + 1] = v[1]; arr[i * 3 + 2] = v[2];
  };
  put(out.pos, B.hips, p.hips);
  put(out.pos, B.spine2, p.chest);
  put(out.pos, B.neck, p.neck);
  const headJoint: V3 = [2 * p.head[0] - p.crown[0], 2 * p.head[1] - p.crown[1], 2 * p.head[2] - p.crown[2]];
  put(out.pos, B.head, headJoint);
  put(out.tip, B.head, p.crown);
  put(out.tip, B.lHand, p.handL);
  put(out.tip, B.rHand, p.handR);
  put(out.pos, B.lHand, p.handL);
  put(out.pos, B.rHand, p.handR);
  put(out.pos, B.lFoot, [p.footL[0], p.footL[1] + 0.09, p.footL[2]]);
  put(out.pos, B.rFoot, [p.footR[0], p.footR[1] + 0.09, p.footR[2]]);
  return out;
}

export type FramingSet = 'full' | 'torso' | 'face' | 'ground';

/** The points a shot of a given tightness must keep in frame. */
export function framingPoints(fps: readonly FighterPoints[], set: FramingSet): V3[] {
  const pts: V3[] = [];
  for (const p of fps) {
    switch (set) {
      case 'full':
        pts.push(p.crown, p.footL, p.footR, p.handL, p.handR, p.hips);
        break;
      case 'ground':
        pts.push(p.crown, p.hips, p.handL, p.handR, p.footL, p.footR);
        break;
      case 'torso': {
        const waist: V3 = [p.hips[0], p.hips[1] - 0.12, p.hips[2]];
        pts.push(p.crown, waist, p.handL, p.handR, p.chest);
        break;
      }
      case 'face': {
        const sternum: V3 = [p.chest[0], p.chest[1] - 0.12, p.chest[2]];
        pts.push(p.crown, sternum, p.neck);
        break;
      }
    }
  }
  return pts;
}

/** Midpoint of the fighters' hips on the floor. */
export function pairMid(fps: readonly FighterPoints[]): V3 {
  if (fps.length === 0) return [0, 0, 0];
  let x = 0;
  let z = 0;
  for (const p of fps) {
    x += p.hips[0];
    z += p.hips[2];
  }
  return [x / fps.length, 0, z / fps.length];
}
