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
  blendPose, createPose, forwardKinematics, type Pose, type WorldPose, BONE_COUNT,
} from '../../rig/skeleton';
import { Composer, copy } from './compose';
import { easeInOut, qAxis, qMul, qRot, type V3 } from './math';
import type { FlightRequest, PairRequest, StrikeRequest, SubRequest } from './request';
import { nearestWall, wallPlanes, type WallPlane } from './fence';
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
  /** Striker phase memory: once the contact resolves the snapshot stops reporting phase. */
  strike: { id: number; action: string; phase: number; t: number; total: number } | null;
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
        key: res.key, last: new Map(), from: new Map(), fadeStart: t, fadeDur: 0, lastTime: t, strike: null,
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
    rememberStrike(st, ctx, req.strike);

    const w = st.fadeDur > 0 ? easeInOut((t - st.fadeStart) / st.fadeDur) : 1;
    writeOut(outA, TMP_A, st.from.get(idA), w);
    writeOut(outB, TMP_B, st.from.get(idB), w);
    st.last.set(idA, clonePose(outA, st.last.get(idA)));
    st.last.set(idB, clonePose(outB, st.last.get(idB)));

    forwardKinematics(worldA, outA, ctx.restA);
    forwardKinematics(worldB, outB, ctx.restB);
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

  return {
    node: e.node,
    variant,
    mirror,
    flight,
    sub: subRequest(ctx),
    strike: strikeRequest(ctx, st),
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

function strikeRequest(ctx: GrappleContext, st: PairState | null): StrikeRequest | null {
  const { a, b, input } = ctx;
  for (const [who, f] of [['a', a], ['b', b]] as const) {
    if (!GROUND_STRIKES.has(f.action)) continue;
    const d = f.actionDetail;
    let phase: number;
    const nextF = input.next?.fighters[f.id];
    if (f.actionStage !== 'none') {
      phase = f.actionPhase;
      if (nextF && nextF.action === f.action && nextF.actionStage !== 'none') {
        phase += (nextF.actionPhase - f.actionPhase) * input.alpha;
      } else if (d.totalMs > 0) phase += (input.alpha * 100) / d.totalMs;
    } else if (st?.strike && st.strike.id === f.id && st.strike.action === f.action) {
      phase = st.strike.phase + ((input.simTime - st.strike.t) * 1000) / Math.max(200, st.strike.total);
    } else {
      phase = 0.8;
    }
    const contactMs = (d.contactTick - d.startTick) * 100 + d.contactOffsetMs;
    const contactAt = d.totalMs > 0 && contactMs > 0 ? Math.min(0.85, Math.max(0.25, contactMs / d.totalMs)) : 0.5;
    // Alternate hands strike to strike (the sim's `side` is the stance lead).
    const side: 'L' | 'R' = (d.startTick & 1) === 1 ? 'L' : 'R';
    return { who, technique: f.action, phase: Math.min(1, Math.max(0, phase)), contactAt, side };
  }
  return null;
}

function rememberStrike(st: PairState, ctx: GrappleContext, s: StrikeRequest | null): void {
  if (!s) { st.strike = null; return; }
  const f = s.who === 'a' ? ctx.a : ctx.b;
  if (f.actionStage !== 'none') {
    st.strike = { id: f.id, action: f.action, phase: s.phase, t: ctx.input.simTime, total: f.actionDetail.totalMs };
  }
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
