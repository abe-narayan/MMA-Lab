/**
 * PAIR CLEARANCE — two standing bodies never share space.
 *
 * `animator.headClearance` only moves the striker, and only while his action
 * runs; just after a close-range hook lands, the defender's head reaction
 * (turned and tilted into the punch's path) and the striker's follow-through
 * could still bring the two heads into each other (mocap pass, "Still wrong").
 * This is a last pass over every standing, unengaged pair, after both bodies
 * are fully solved:
 *
 *   - heads: spheres of `HEAD_RADIUS_M` (scaled) around each head's centre (the
 *     midpoint of the Head bone, about eye level). When the centres are closer
 *     than `HEAD_CLEAR_M`, both trunks lean apart along the line between the
 *     heads (pitch and roll spread over the spine); the fighter just hit takes
 *     most of it (his head is the one snapping away), the puncher the rest;
 *   - chests: the Spine2 joints are kept `CHEST_CLEAR_M` apart by sliding the
 *     pelvises apart (planted feet stay; the pelvis clamp keeps them in reach).
 *
 * Guard hands move with the head that moves; a weapon hand on its target stays
 * there. A pure function of the solved poses and the strike timing (no state),
 * so it is continuous in time and identical under play, scrub and seek.
 */
import { B, type WorldPose } from '../rig/skeleton';
import { solveSpec } from './spec';
import { clampPelvis } from './stance';
import type { Ctx, FighterState } from './state';
import type { V3 } from './math';

/** Radius of the sphere standing in for a head (m, at scale 1). */
export const HEAD_RADIUS_M = 0.1;
/** Head centres are kept this far apart (m, at scale 1): two radii and a small gap. */
export const HEAD_CLEAR_M = 0.235;
/** Chest joints (Spine2) are kept this far apart (m, at scale 1). */
export const CHEST_CLEAR_M = 0.3;
/** Most a trunk leans away per frame for clearance (radians). */
const MAX_LEAN = 0.42;
/** A fighter counts as "just hit" from this long before contact to this long after (ms). */
const HIT_WINDOW: [number, number] = [-60, 700];

/** Centre of the head (midpoint of the Head bone: about eye level, mid-skull). */
export function headCentre(w: WorldPose): V3 {
  const o = B.head * 3;
  return [(w.pos[o] + w.tip[o]) / 2, (w.pos[o + 1] + w.tip[o + 1]) / 2, (w.pos[o + 2] + w.tip[o + 2]) / 2];
}

function chest(w: WorldPose): V3 {
  const o = B.spine2 * 3;
  return [w.pos[o], w.pos[o + 1], w.pos[o + 2]];
}

/** How much of a separation fighter `c` takes: more when he was just hit. */
export function clearanceShare(c: Ctx, other: Ctx): number {
  const hit = (x: Ctx): boolean => x.incoming.some(({ t }) => {
    if (t.result === 'missed' || t.result === 'evaded') return false;
    const dt = x.nowMs - t.contact;
    return dt >= HIT_WINDOW[0] && dt <= HIT_WINDOW[1];
  });
  const a = hit(c);
  const b = hit(other);
  if (a && !b) return 0.75;
  if (b && !a) return 0.25;
  return 0.5;
}

/**
 * Lean `st`'s trunk so its head moves about `amount` metres along world
 * direction `u` (horizontal), and carry its guard hands along.
 */
function leanAway(st: FighterState, u: V3, amount: number): void {
  const spec = st.spec;
  const fr = spec.frame;
  // Body axes: forward (sin yaw, cos yaw), left (cos yaw, -sin yaw).
  const f = u[0] * fr.s + u[2] * fr.c;
  const l = u[0] * fr.c - u[2] * fr.s;
  // The head sits ~0.62 m (scaled) above the hips: that is the lever.
  const lever = 0.62 * st.rig.scale;
  const ang = Math.min(MAX_LEAN, amount / lever);
  // +pitch leans forward; -roll tilts toward the body's left (+X).
  spec.spinePitch += f * ang;
  spec.spineRoll -= l * ang;
  const moved = ang * lever;
  for (const h of spec.hands) {
    if (h.w <= 0 || h.fistTarget) continue;
    h.pos = [h.pos[0] + u[0] * moved, h.pos[1], h.pos[2] + u[2] * moved];
  }
}

/**
 * Keep one standing pair apart (see the file comment). Mutates both fighters'
 * specs and re-solves their poses when needed. Returns the head-centre
 * distance after the pass (m).
 */
export function separatePair(a: Ctx, b: Ctx): number {
  const sa = a.st;
  const sb = b.st;
  const scale = (sa.rig.scale + sb.rig.scale) / 2;
  const share = clearanceShare(a, b);
  let dHead = Infinity;

  // Chests first (a pelvis move changes where the heads are).
  {
    const ca = chest(sa.world);
    const cb = chest(sb.world);
    const dx = ca[0] - cb[0];
    const dz = ca[2] - cb[2];
    const d = Math.hypot(dx, dz);
    const min = CHEST_CLEAR_M * scale;
    if (d < min) {
      const ux = d > 1e-5 ? dx / d : Math.sin(sa.spec.frame.yaw + Math.PI);
      const uz = d > 1e-5 ? dz / d : Math.cos(sa.spec.frame.yaw + Math.PI);
      const need = min - d;
      for (const [st, s, sign] of [[sa, share, 1], [sb, 1 - share, -1]] as const) {
        const m = need * s * sign;
        st.spec.pelvis = [st.spec.pelvis[0] + ux * m, st.spec.pelvis[1], st.spec.pelvis[2] + uz * m];
        for (const h of st.spec.hands) {
          if (h.w <= 0 || h.fistTarget) continue;
          h.pos = [h.pos[0] + ux * m, h.pos[1], h.pos[2] + uz * m];
        }
        clampPelvis(st.spec, st);
        solveSpec(st.spec, st.rig, st.pose, st.world, false);
      }
    }
  }

  for (let it = 0; it < 3; it++) {
    const ha = headCentre(sa.world);
    const hb = headCentre(sb.world);
    const dx = ha[0] - hb[0];
    const dy = ha[1] - hb[1];
    const dz = ha[2] - hb[2];
    dHead = Math.hypot(dx, dy, dz);
    const min = HEAD_CLEAR_M * scale;
    if (dHead >= min) break;
    // Apart along the heads' horizontal line (a lean cannot lift a head).
    let hx = dx;
    let hz = dz;
    let hl = Math.hypot(hx, hz);
    if (hl < 1e-4) {
      hx = sa.spec.pelvis[0] - sb.spec.pelvis[0];
      hz = sa.spec.pelvis[2] - sb.spec.pelvis[2];
      hl = Math.hypot(hx, hz) || 1;
    }
    const u: V3 = [hx / hl, 0, hz / hl];
    // The vertical offset already separates part of it: move horizontally
    // just enough that the 3D distance reaches the minimum (plus a hair).
    const wantH = Math.sqrt(Math.max(0, min * min - dy * dy)) + 0.004;
    const need = Math.max(0.004, wantH - Math.hypot(dx, dz));
    leanAway(sa, u, need * share);
    leanAway(sb, [-u[0], 0, -u[2]], need * (1 - share));
    solveSpec(sa.spec, sa.rig, sa.pose, sa.world, false);
    solveSpec(sb.spec, sb.rig, sb.pose, sb.world, false);
  }
  const ha = headCentre(sa.world);
  const hb = headCentre(sb.world);
  return Math.hypot(ha[0] - hb[0], ha[1] - hb[1], ha[2] - hb[2]);
}
