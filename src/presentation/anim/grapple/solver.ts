/**
 * THE GRAPPLE SOLVER — `GrappleSolver` implementation.
 *
 * Per engaged pair, per frame:
 *   1. distil the snapshots into a `PairRequest` (node, edge in flight and its
 *      destination, submission stage, ground strike, variant);
 *   2. compose the pair in pair space (`compose.ts`);
 *   3. place the pair in the world at the interaction root (interpolated to the
 *      display frame), against the fence for cage nodes, and out of the fence
 *      for everything else;
 *   4. cross-fade from the last output whenever the pose *source* changes
 *      discontinuously (a node resolves, a submission stage changes, the pair
 *      first engages from the standing animator's pose).
 *
 * State is only the fade memory and is dropped on `discontinuity`, so a seek
 * shows exactly what a fresh playback would.
 */
import { GRAPPLING_EDGES, POSITIONS, type EngagementSnapshot, type FighterSnapshot, type SimEvent } from '../../../sim';
import type { GrappleContext, GrappleResult, GrappleSolver } from '../grappleApi';
import {
  blendPose, createPose, forwardKinematics, translateWorld, type Pose, type WorldPose, BONE_COUNT,
} from '../../rig/skeleton';
import { Composer, copy } from './compose';
import { floorFix } from '../blend';
import { easeInOut, qAxis, qMul, qRot, type V3 } from './math';
import type { FlightRequest, PairRequest, StrikeRequest, SubRequest } from './request';
import { nearestWall, wallPlanes, type WallPlane } from './fence';
import { TECH } from '../timing';
import { coreCapsules, segSegClosest } from './capsules';
import type { RestSkeleton } from '../../rig/skeleton';
import type { Arena } from '../../../sim';

const EDGE_BY_ID = new Map(GRAPPLING_EDGES.map((e) => [e.id, e] as const));
const NODE_BY_ID = new Map(POSITIONS.map((n) => [n.id, n] as const));

/** Destination the arc aims at while the edge is still in flight: the heaviest listed. */
export function likelyDestination(edgeId: string, from: string): { node: string; swap: boolean } {
  const e = EDGE_BY_ID.get(edgeId);
  if (!e || e.to.length === 0) return { node: from, swap: false };
  let best = e.to[0];
  for (const t of e.to) if (t.weight > best.weight) best = t;
  const node = best.node === 'same' ? from : best.node;
  return { node, swap: !!best.swap };
}

const FADE_ENGAGE = 0.4;
const FADE_NODE = 0.3;
const FADE_SUB = 0.35;
const FADE_EDGE_START = 0.12;

interface PairState {
  key: string;
  last: Map<number, Pose>;
  from: Map<number, Pose>;
  fadeStart: number;
  fadeDur: number;
  lastTime: number;
  /** The output separation's root pushes as drawn (followed), their velocities, and when. */
  sepA: V3; sepB: V3; sepVA: V3; sepVB: V3; sepT: number;
}

/** Natural frequency (rad/s) of the output separation's follow. */
const SEP_FOLLOW_W = 25;

/** Critically damped follow of `x` (velocity `v`) toward `target` over `dt` s (exact closed form). */
function springTo(x: V3, v: V3, target: readonly number[], dt: number, w: number): void {
  const ex = Math.exp(-w * dt);
  for (let k = 0; k < 3; k++) {
    const ch = x[k]! - target[k]!;
    const tmp = (v[k]! + w * ch) * dt;
    v[k] = (v[k]! - w * tmp) * ex;
    x[k] = target[k]! + (ch + tmp) * ex;
  }
}

function pairKey(e: EngagementSnapshot): string {
  return e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
}

const TMP_A = createPose();
const TMP_B = createPose();

export class GrappleSolverImpl implements GrappleSolver {
  private readonly composer = new Composer();
  private readonly states = new Map<string, PairState>();
  private planesFor: Arena | null = null;
  private planes: WallPlane[] = [];
  /** Last label, for the debug overlay. */
  lastLabel = '';

  reset(): void {
    this.states.clear();
  }

  evaluate(ctx: GrappleContext, outA: Pose, outB: Pose, worldA: WorldPose, worldB: WorldPose): GrappleResult {
    const { input, engagement: e } = ctx;
    const t = input.simTime;
    const key = pairKey(e);
    let st = this.states.get(key) ?? null;
    if (input.discontinuity || (st && t < st.lastTime - 1e-6)) {
      this.states.delete(key);
      st = null;
    }
    this.gc(t);

    const req = buildRequest(ctx, st);
    const res = this.composer.compose(req, ctx.restA, ctx.restB, [TMP_A, TMP_B]);
    if (!res.handled) {
      this.lastLabel = res.label;
      return { handled: false, label: res.label };
    }

    // ---- world placement -----------------------------------------------------
    const root = interpRoot(ctx);
    const planes = this.wallPlanesOf(ctx.bout.arena);
    placeInWorld(TMP_A, TMP_B, root, e, ctx, planes, worldA, worldB);

    // ---- cross-fades ----------------------------------------------------------
    const idA = e.a;
    const idB = e.b;
    if (!st) {
      st = {
        key: res.key, last: new Map(), from: new Map(), fadeStart: t, fadeDur: 0, lastTime: t,
        sepA: [0, 0, 0], sepB: [0, 0, 0], sepVA: [0, 0, 0], sepVB: [0, 0, 0], sepT: -1,
      };
      if (!input.discontinuity) {
        // Engaging from the standing animator's pose (what arrived in out*).
        st.from.set(idA, clonePose(outA));
        st.from.set(idB, clonePose(outB));
        st.fadeStart = t;
        st.fadeDur = isNeutral(outA) || isNeutral(outB) ? 0 : FADE_ENGAGE;
      }
      this.states.set(key, st);
    } else if (st.key !== res.key) {
      const dur = res.key.startsWith('sub:') || st.key.startsWith('sub:') ? FADE_SUB
        : res.key.startsWith('edge:') && st.key.startsWith('node:') ? FADE_EDGE_START : FADE_NODE;
      for (const id of [idA, idB]) {
        const last = st.last.get(id);
        if (last) st.from.set(id, clonePose(last, st.from.get(id)));
      }
      st.fadeStart = t;
      st.fadeDur = dur;
      st.key = res.key;
    }
    st.lastTime = t;

    const w = st.fadeDur > 0 ? easeInOut((t - st.fadeStart) / st.fadeDur) : 1;
    writeOut(outA, TMP_A, st.from.get(idA), w);
    writeOut(outB, TMP_B, st.from.get(idB), w);
    // The pair solver keeps each key pose's bodies apart, but a throw's rigid
    // rotation, a blend between two keys or a cross-fade can still put one
    // torso inside the other (measured: 3.6 % of engaged frames over 2 cm on
    // the firm body, up to 21 cm). Push the output apart the same way.
    // The push follows its target through a critically damped spring (a
    // throw sweeps the bodies through each other over a few frames, and the
    // raw push would jump with it); a seek or a fresh engagement starts on it.
    {
      const a0: V3 = [outA.rootPos[0], outA.rootPos[1], outA.rootPos[2]];
      const b0: V3 = [outB.rootPos[0], outB.rootPos[1], outB.rootPos[2]];
      separateOutput(outA, outB, worldA, worldB, ctx.restA, ctx.restB);
      const ta: V3 = [outA.rootPos[0] - a0[0], outA.rootPos[1] - a0[1], outA.rootPos[2] - a0[2]];
      const tb: V3 = [outB.rootPos[0] - b0[0], outB.rootPos[1] - b0[1], outB.rootPos[2] - b0[2]];
      const dt = Math.min(0.1, Math.max(0, t - st.sepT));
      const fresh = st.sepT < 0;
      st.sepT = t;
      // Stored by fighter (the lower id first), not by role: roles swap on a reversal.
      const aLo = e.a < e.b;
      for (const [push, target, vel, out, o0, w, r] of [
        [aLo ? st.sepA : st.sepB, ta, aLo ? st.sepVA : st.sepVB, outA, a0, worldA, ctx.restA],
        [aLo ? st.sepB : st.sepA, tb, aLo ? st.sepVB : st.sepVA, outB, b0, worldB, ctx.restB],
      ] as const) {
        if (fresh) { push[0] = target[0]; push[1] = target[1]; push[2] = target[2]; vel[0] = vel[1] = vel[2] = 0; }
        else if (dt > 0) springTo(push, vel, target, dt, SEP_FOLLOW_W);
        out.rootPos[0] = o0[0] + push[0]; out.rootPos[1] = o0[1] + Math.max(0, push[1]); out.rootPos[2] = o0[2] + push[2];
        forwardKinematics(w, out, r);
      }
    }
    // Nothing under the mat: throw arcs rotate whole bodies about a pivot, and
    // the cross-fades blend bone by bone (a foot went up to 73 cm under it).
    floorFix(outA, worldA, ctx.restA);
    floorFix(outB, worldB, ctx.restB);
    st.last.set(idA, clonePose(outA, st.last.get(idA)));
    st.last.set(idB, clonePose(outB, st.last.get(idB)));
    this.lastLabel = res.label;
    return { handled: true, label: res.label };
  }

  private wallPlanesOf(arena: Arena): WallPlane[] {
    if (this.planesFor !== arena) {
      this.planesFor = arena;
      this.planes = wallPlanes(arena);
    }
    return this.planes;
  }

  private gc(t: number): void {
    for (const [k, s] of this.states) if (t - s.lastTime > 2) this.states.delete(k);
  }
}

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

function tierOf(ctx: GrappleContext, id: number): number {
  const r = ctx.bout.runtimes[id];
  return r ? r.grapplingTier : 4;
}

export function buildRequest(ctx: GrappleContext, st: PairState | null): PairRequest {
  void st;
  const { engagement: e, nextEngagement: n, input, a, b } = ctx;
  const variant = {
    postured: e.posture === 'postured',
    cage: e.cage,
    t: input.simTime,
    tierA: tierOf(ctx, e.a),
    tierB: tierOf(ctx, e.b),
  };
  // Left/right: the attacker's stance picks the side (a southpaw shoots and
  // mounts to the other side), stable for the whole engagement.
  const mirror = a.stance === 'southpaw';

  let flight: FlightRequest | null = null;
  if (e.inflight) {
    const f = e.inflight;
    let phase = f.phase;
    const sameNext = n && n.a === e.a && n.inflight && n.inflight.edge === f.edge && n.inflight.tStart === f.tStart;
    if (sameNext) phase = f.phase + (n!.inflight!.phase - f.phase) * input.alpha;
    else if (f.dur > 0) phase = Math.min(1, f.phase + (input.alpha * 100) / f.dur);
    let dest: { node: string; swap: boolean };
    if (n && n.node !== e.node && !n.inflight) dest = { node: n.node, swap: n.a !== e.a };
    else dest = likelyDestination(f.edge, e.node);
    flight = {
      edge: f.edge, phase: Math.max(0, Math.min(1, phase)), dest: dest.node, swap: dest.swap,
      durMs: f.dur, kuzushi: { dir: e.kuzushi.dir, mag: e.kuzushi.mag },
    };
  }

  const strikes = strikeRequests(ctx);
  return {
    node: e.node,
    variant,
    mirror,
    flight,
    sub: subRequest(ctx),
    strike: strikes.length ? strikes[strikes.length - 1]! : null,
    strikes,
  };
}

function subRequest(ctx: GrappleContext): SubRequest | null {
  const { a, b, input } = ctx;
  const att: FighterSnapshot | null = a.sub.technique ? a : b.sub.technique ? b : null;
  if (!att || !att.sub.technique) return null;
  const def = att === a ? b : a;
  const stage = att.sub.stage;
  let stageT = 1.0;
  let tapT: number | null = null;
  let limp = false;
  const now = input.simTime;
  for (let i = input.events.length - 1; i >= 0; i--) {
    const ev = input.events[i] as SimEvent;
    if (ev.kind === 'submissionStage' && ev.actor === att.id && stageT === 1.0) {
      stageT = Math.max(0, now - (ev.tick * 100 + ev.subMs) / 1000);
    }
    if (ev.kind === 'submissionFinish' && ev.actor === att.id) {
      tapT = Math.max(0, now - (ev.tick * 100 + ev.subMs) / 1000);
      limp = (ev.detail as { type?: string }).type === 'loc';
      break;
    }
  }
  if (stage >= 4 && tapT === null) tapT = stageT;
  if (limp) tapT = null;
  void def;
  return { technique: att.sub.technique, stage, attacker: att === a ? 'a' : 'b', stageT, tapT, limp };
}

const GROUND_STRIKES = new Set([
  'tech.gnp_punch', 'tech.gnp_elbow', 'tech.gnp_hammerfist', 'tech.bottom_punch', 'tech.bottom_elbow',
]);

/**
 * The ground strike being thrown now, timed like the standing strikes
 * (`timing.ts`): the sim reports a ground strike's action with no stage and a
 * start tick that follows the clock, and carries its contact instant only
 * while it is pending (then in the strike event). The phase used to be read
 * from the snapshot's phase / start tick, so every tick restarted it and
 * flipped the striking hand — measured, most of the one-frame arm and chest
 * pops of held ground positions (half guard, closed guard, kneeling top).
 * Now: every contact instant this fighter has in flight (pending on this or
 * the next frame) or just resolved (events), the catalogue's startup / active
 * / recovery scaled to the recorded total, and the hand chosen from the
 * contact instant, so a strike is one continuous motion.
 */
function strikeRequests(ctx: GrappleContext): StrikeRequest[] {
  const { a, b, input } = ctx;
  const now = input.simTime * 1000;
  const out: { s: StrikeRequest; start: number; c: number }[] = [];
  for (const [who, f] of [['a', a], ['b', b]] as const) {
    const cands: { c: number; tech: string; total: number }[] = [];
    for (const fr of [input.frame, input.next]) {
      const g = fr?.fighters[f.id];
      if (!fr || !g || !GROUND_STRIKES.has(g.action) || g.actionDetail.contactTick <= fr.tick) continue;
      cands.push({ c: g.actionDetail.contactTick * 100 + g.actionDetail.contactOffsetMs, tech: g.action, total: g.actionDetail.totalMs });
    }
    for (const ev of input.events) {
      if (ev.kind !== 'strike' || ev.actor !== f.id) continue;
      const tech = (ev as { detail: { technique: string } }).detail.technique;
      if (GROUND_STRIKES.has(tech)) cands.push({ c: ev.tick * 100 + ev.subMs, tech, total: f.action === tech ? f.actionDetail.totalMs : 0 });
    }
    for (const k of cands) {
      if (out.some((o) => o.s.who === who && Math.abs(o.c - k.c) < 0.5)) continue; // pending and resolved: one strike
      const spec = TECH.get(k.tech);
      const su = spec ? spec.startupMs : 220, ac = spec ? spec.activeMs : 50, rc = spec ? spec.recoveryMs : 300;
      const total = k.total > 0 ? k.total : su + ac + rc;
      const start = k.c - su * (total / (su + ac + rc));
      if (now < start || now > start + total) continue;
      out.push({
        start, c: k.c,
        s: {
          who, technique: k.tech, phase: Math.min(1, Math.max(0, (now - start) / total)),
          contactAt: Math.min(0.85, Math.max(0.25, su / (su + ac + rc))),
          side: (Math.round(k.c / 100) & 1) === 1 ? 'L' : 'R',
        },
      });
    }
  }
  return out.sort((x, y) => x.start - y.start).map((o) => o.s);
}

// ---------------------------------------------------------------------------
// World placement
// ---------------------------------------------------------------------------

function interpRoot(ctx: GrappleContext): { x: number; z: number; yaw: number } {
  const e = ctx.engagement;
  const n = ctx.nextEngagement;
  const al = ctx.input.alpha;
  if (!n || n.a !== e.a || n.b !== e.b) return { x: e.rootX, z: e.rootZ, yaw: e.rootYaw };
  let dy = n.rootYaw - e.rootYaw;
  while (dy > Math.PI) dy -= 2 * Math.PI;
  while (dy < -Math.PI) dy += 2 * Math.PI;
  return { x: e.rootX + (n.rootX - e.rootX) * al, z: e.rootZ + (n.rootZ - e.rootZ) * al, yaw: e.rootYaw + dy * al };
}

const CAGE_NODES = new Set(
  POSITIONS.filter((p) => p.cageVariant === 'is' && p.family !== 'standingFree').map((p) => p.id as string),
);
const CLINCH_NODES = new Set(POSITIONS.filter((p) => p.family === 'clinch').map((p) => p.id as string));

function placeInWorld(
  pa: Pose, pb: Pose, root: { x: number; z: number; yaw: number }, e: EngagementSnapshot,
  ctx: GrappleContext, planes: readonly WallPlane[], wa: WorldPose, wb: WorldPose,
): void {
  let yaw = root.yaw;
  let rx = root.x;
  let rz = root.z;
  // Pinned against the fence: the cage-only nodes, and any tie-up or leg
  // attack the sim flags as on the cage.
  const fenceNode = CAGE_NODES.has(e.node)
    || (e.cage && (CLINCH_NODES.has(e.node) || e.node === 'pos.td_single_leg_in' || e.node === 'pos.td_double_leg_in'));
  if (fenceNode && planes.length > 0) {
    // The pinned fighter's back goes on the nearest wall: a→b points into it.
    const w = nearestWall(planes, ctx.b.x, ctx.b.z);
    if (w) yaw = Math.atan2(w.plane.nx, w.plane.nz);
  }
  const q = qAxis([0, 1, 0], yaw);
  for (const p of [pa, pb]) {
    const r = qRot(q, [p.rootPos[0], p.rootPos[1], p.rootPos[2]]);
    p.rootPos[0] = r[0] + rx; p.rootPos[1] = r[1]; p.rootPos[2] = r[2] + rz;
    const nq = qMul(q, p.rootQuat);
    p.rootQuat[0] = nq[0]; p.rootQuat[1] = nq[1]; p.rootQuat[2] = nq[2]; p.rootQuat[3] = nq[3];
  }
  if (planes.length === 0) return;
  // Fence contact / depenetration: measure how far the pair reaches past the
  // nearest wall and slide the pair (never the individuals) to fix it.
  forwardKinematics(wa, pa, ctx.restA);
  forwardKinematics(wb, pb, ctx.restB);
  const near = nearestWall(planes, rx, rz);
  if (!near || near.dist > 2.5) return;
  const { nx, nz, d } = near.plane;
  let maxOut = -Infinity;
  for (const w of [wa, wb]) {
    for (let i = 0; i < BONE_COUNT; i++) {
      const s = w.pos[i * 3] * nx + w.pos[i * 3 + 2] * nz;
      if (s > maxOut) maxOut = s;
    }
  }
  const BODY = 0.1; // body surface beyond the joint centres
  const over = maxOut + BODY - d;
  let shift = 0;
  if (fenceNode) shift = -over; // touch the fence exactly
  else if (over > 0) shift = -over;
  if (shift !== 0) {
    for (const p of [pa, pb]) { p.rootPos[0] += nx * shift; p.rootPos[2] += nz * shift; }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clonePose(src: Pose, into?: Pose): Pose {
  const p = into ?? createPose();
  copy(p, src);
  return p;
}

/** True for a T-pose at the origin (nobody animated it). */
function isNeutral(p: Pose): boolean {
  if (p.rootPos[0] !== 0 || p.rootPos[1] !== 0 || p.rootPos[2] !== 0) return false;
  for (let i = 0; i < 12; i++) if (Math.abs(p.local[i * 4 + 3] - 1) > 1e-6) return false;
  return true;
}

/** Firm-body overlap left alone by the output separation (m): pressing contact. */
const OUT_SLOP = 0.012;

/**
 * Slide two output poses apart where their firm-body capsules (torso, shoulder
 * line, head) overlap by more than `OUT_SLOP`: the higher-hipped body moves
 * (the man on top comes up / off), similar heights share it, and a body up on
 * its feet only slides horizontally (nobody floats) and is never pushed down.
 * Continuous in the poses (the push is the overlap), so it adds no pops.
 */
function separateOutput(pa: Pose, pb: Pose, wa: WorldPose, wb: WorldPose, ra: RestSkeleton, rb: RestSkeleton): void {
  forwardKinematics(wa, pa, ra);
  forwardKinematics(wb, pb, rb);
  for (let it = 0; it < 4; it++) {
    // The push: as deep as the deepest overlap, along the depth-weighted mean
    // of every overlapping pair's separation direction (the single deepest
    // pair's direction switched from frame to frame as capsules crossed).
    let depth = 0;
    let dir: V3 = [0, 0, 0];
    for (const x of coreCapsules(wa, ra)) {
      for (const y of coreCapsules(wb, rb)) {
        const r = segSegClosest(x.a, x.b, y.a, y.b);
        const d = x.r + y.r - r.d;
        if (d <= OUT_SLOP * 0.5) continue;
        depth = Math.max(depth, d);
        const u = [r.c1[0] - r.c2[0], r.c1[1] - r.c2[1], r.c1[2] - r.c2[2]];
        const ul = Math.hypot(u[0]!, u[1]!, u[2]!);
        if (ul > 1e-5) { dir[0] += u[0]! / ul * d; dir[1] += u[1]! / ul * d; dir[2] += u[2]! / ul * d; }
      }
    }
    if (depth <= OUT_SLOP) return;
    let dl = Math.hypot(dir[0], dir[1], dir[2]);
    if (dl < 1e-5) { dir = [pa.rootPos[0] - pb.rootPos[0], 0, pa.rootPos[2] - pb.rootPos[2]]; dl = Math.hypot(dir[0], dir[1], dir[2]) || 1; }
    dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    const ya = pa.rootPos[1], yb = pb.rootPos[1];
    // The higher-hipped body takes more of it — continuously.
    const wA = Math.min(1, Math.max(0, 0.5 + (ya - yb) / 0.3));
    const push = depth - OUT_SLOP * 0.5;
    for (const [p, w, r, k, sgn] of [[pa, wa, ra, wA, 1], [pb, wb, rb, 1 - wA, -1]] as const) {
      if (k <= 0) continue;
      let d: V3 = [dir[0] * sgn, dir[1] * sgn, dir[2] * sgn];
      const s = r.statureM / 1.7332;
      if (p.rootPos[1] > 0.55 * s || d[1] < 0) {
        const h = Math.hypot(d[0], d[2]);
        d = h > 1e-3 ? [d[0] / h, 0, d[2] / h] : [0, 0, 0];
      }
      p.rootPos[0] += d[0] * push * k; p.rootPos[1] += d[1] * push * k; p.rootPos[2] += d[2] * push * k;
      // A pure root translation: shift the world pose (no full FK).
      translateWorld(w, d[0] * push * k, d[1] * push * k, d[2] * push * k);
    }
  }
}

const FACE_TMP = new Float32Array(16);
function writeOut(out: Pose, des: Pose, from: Pose | undefined, w: number): void {
  // Face channels stay the standing animator's; the solver only adds its own
  // (a choke's grimace, a limp jaw) on top.
  const nf = out.face.length;
  FACE_TMP.set(out.face);
  if (!from || w >= 1) copy(out, des);
  else blendPose(out, from, des, w);
  for (let k = 0; k < nf; k++) out.face[k] = Math.max(FACE_TMP[k], des.face[k]);
}

export type { V3 };
