/**
 * TARGET POINTS on the opponent's solved body, and where each weapon comes from.
 *
 * A strike's aim is a point on the defender's CURRENT world pose — the chin a
 * jab lands on moves when the defender bobs — offset to the surface facing the
 * weapon: a straight lands on the face, a hook on the side of the jaw, an
 * uppercut under the chin, a round kick on the outside of the thigh.
 */
import { B } from '../rig/skeleton';
import {
  add, cross, dot, lerp, madd, norm, qrot, scale, sub, vlerp, type V3,
} from './math';
import { worldP, worldQ } from './spec';
import type { FighterState } from './state';
import type { Region } from './timing';

export type Approach = 'front' | 'side' | 'below' | 'above' | 'sideHigh' | 'sideLow' | 'inside';

export interface AimInput {
  attacker: FighterState;
  defender: FighterState;
  region: Region;
  subLocation: string | null;
  approach: Approach;
  /** +1 when the weapon is on the attacker's left. */
  weaponSide: number;
  /** Defender's lead side (0 = left) — "leadLeg" means the defender's lead leg. */
  defenderLead: 0 | 1;
}

/** Unit vector from the defender's target toward where the weapon comes from. */
export function approachDir(inp: AimInput, center: V3): V3 {
  const a = inp.attacker;
  const ap = a.displayRoot;
  let toA: V3 = [ap[0] - center[0], 0, ap[2] - center[2]];
  toA = norm(toA);
  // Attacker's left, in the world: rotate toA (which points back at the attacker)
  // -> the attacker's forward is -toA; their left = (fwd.z, 0, -fwd.x)... derive:
  const fwd: V3 = [-toA[0], 0, -toA[2]];
  const left: V3 = [fwd[2], 0, -fwd[0]];
  const side = scale(left, inp.weaponSide);
  const up: V3 = [0, 1, 0];
  switch (inp.approach) {
    case 'front': return toA;
    case 'side': return norm(add(scale(toA, 0.45), side));
    case 'sideHigh': return norm(add(add(scale(toA, 0.4), side), scale(up, 0.35)));
    case 'sideLow': return norm(add(add(scale(toA, 0.35), side), scale(up, -0.35)));
    case 'below': return norm(add(scale(toA, 0.55), scale(up, -0.85)));
    case 'above': return norm(add(add(scale(toA, 0.55), scale(up, 0.75)), scale(side, 0.3)));
    case 'inside': return norm(add(scale(toA, 0.5), scale(side, -1)));
  }
}

/** Centre and surface radius of a region on the defender's world pose. */
export function regionCenter(d: FighterState, region: Region, sub_: string | null, lead: 0 | 1): { c: V3; r: number } {
  const w = d.world;
  const s = d.rig.scale;
  switch (region) {
    case 'head': {
      const h = worldP(w, B.head);
      const up = qrot(worldQ(w, B.head), [0, 1, 0]);
      const fwd = qrot(worldQ(w, B.head), [0, 0, 1]);
      let c = madd(madd(h, up, 0.085 * s), fwd, 0.015 * s);
      if (sub_ === 'chin' || sub_ === 'jaw') c = madd(c, up, -0.04 * s);
      return { c, r: 0.095 * s };
    }
    case 'body': {
      const a = worldP(w, B.spine1);
      const b = worldP(w, B.spine2);
      let c = vlerp(a, b, sub_ === 'solar' || sub_ === 'sternum' ? 0.7 : 0.25);
      if (sub_ === 'liver') {
        // The defender's right side.
        const q = worldQ(w, B.spine1);
        c = madd(c, qrot(q, [-1, 0, 0]), 0.05 * s);
      }
      return { c, r: 0.13 * s };
    }
    case 'leadLeg':
    case 'rearLeg': {
      const leadIsLeft = lead === 0;
      const left = region === 'leadLeg' ? leadIsLeft : !leadIsLeft;
      const up = left ? B.lUpLeg : B.rUpLeg;
      const lo = left ? B.lLeg : B.rLeg;
      const ft = left ? B.lFoot : B.rFoot;
      if (sub_ === 'calf') return { c: vlerp(worldP(w, lo), worldP(w, ft), 0.3), r: 0.06 * s };
      if (sub_ === 'knee') return { c: worldP(w, lo), r: 0.055 * s };
      return { c: vlerp(worldP(w, up), worldP(w, lo), 0.62), r: 0.075 * s };
    }
    case 'arms': {
      return { c: vlerp(worldP(w, B.lForeArm), worldP(w, B.lHand), 0.5), r: 0.045 * s };
    }
  }
}

/** Surface point on the defender facing the weapon. */
export function targetPoint(inp: AimInput): V3 {
  const { c, r } = regionCenter(inp.defender, inp.region, inp.subLocation, inp.defenderLead);
  return madd(c, approachDir(inp, c), r);
}

/** The defender's guard glove (or forearm) nearest the incoming line. */
export function blockPoint(inp: AimInput, forearm: boolean): V3 {
  const d = inp.defender;
  const t = targetPoint(inp);
  const src = add(t, scale(approachDir(inp, t), 0.5));
  let best: V3 = t;
  let bestD = Infinity;
  for (const side of [0, 1] as const) {
    // A kick / knee / elbow meets the forearm; a punch the glove's cuff over
    // the wrist (the padded part a high guard turns to the punch). It used to
    // aim at the knuckles' point, 8.5 cm past the wrist and outside the arm:
    // measured, over half the blocked punches ended > 5 cm off the blocking arm.
    const p = vlerp(worldP(d.world, side === 0 ? B.lForeArm : B.rForeArm), worldP(d.world, side === 0 ? B.lHand : B.rHand), forearm ? 0.45 : 0.85);
    // Distance from the segment src -> t.
    const ab = sub(t, src);
    const k = Math.max(0, Math.min(1, dot(sub(p, src), ab) / Math.max(1e-6, dot(ab, ab))));
    const q = madd(src, ab, k);
    const dd = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (dd < bestD) { bestD = dd; best = p; }
  }
  // Land on the outside of the glove.
  return madd(best, approachDir(inp, best), 0.05 * d.rig.scale);
}

/** A miss: past the head on one side and over-extended. */
export function missPoint(inp: AimInput, hit: V3, side: number, depth: number): V3 {
  const a = approachDir(inp, hit);
  const lat = norm(cross(a, [0, 1, 0]));
  return madd(madd(madd(hit, lat, 0.2 * side * inp.defender.rig.scale), a, -depth), [0, 1, 0], 0.03);
}

export { lerp };
