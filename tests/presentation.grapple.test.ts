/**
 * Grappling animation (docs/design/08 §5.7): coverage, bodies that do not pass
 * through each other, grips that land on their sockets across body sizes,
 * continuous transitions, and determinism.
 */
import { describe, expect, it } from 'vitest';
import {
  GRAPPLING_EDGES, POSITIONS, SUBMISSIONS,
  type EngagementSnapshot, type FighterSnapshot, type SimEvent, type TickSnapshot,
} from '../src/sim';
import type { BoutPresentation, FrameInput } from '../src/presentation/contract';
import type { GrappleContext } from '../src/presentation/anim/grappleApi';
import { grappleSolver } from '../src/presentation/anim/grappleApi';
import {
  BONE_COUNT, createPose, createWorldPose, forwardKinematics, type Pose, type RestSkeleton,
} from '../src/presentation/rig/skeleton';
import {
  GENERIC_NODES, GrappleSolverImpl, NODE_POSES, likelyDestination, scaledRest,
} from '../src/presentation/anim/grapple';
import { Composer } from '../src/presentation/anim/grapple/compose';
import { bodyCapsules, penetrations, lowestPoint } from '../src/presentation/anim/grapple/capsules';
import { dropped, type ContactRecord } from '../src/presentation/anim/grapple/solve';
import { DEFAULT_VARIANT } from '../src/presentation/anim/grapple/poses/types';
import { nodePoseFor } from '../src/presentation/anim/grapple/poses';
import { defaultNodeForSub, subCoverage } from '../src/presentation/anim/grapple/subs';
import { dist } from '../src/presentation/anim/grapple/math';
import type { PairRequest } from '../src/presentation/anim/grapple/request';

// Equal bodies, a heavyweight on a flyweight, and the reverse (ARCHETYPES:
// arch.heavyweight_power_puncher 1.93 m, arch.flyweight_volume_striker 1.65 m).
const SIZES: readonly [number, number][] = [[1.78, 1.78], [1.93, 1.65], [1.65, 1.93]];
const RESTS = new Map<number, RestSkeleton>();
const rest = (h: number): RestSkeleton => {
  let r = RESTS.get(h);
  if (!r) { r = scaledRest(h); RESTS.set(h, r); }
  return r;
};

/** Torso and head capsules may press, not pass: firm-body overlap allowed. */
const CORE_TOL = 0.05;
/**
 * Limbs wrapping a torso (underhooks, body locks, hooks) press into the round
 * capsule that stands in for a flatter torso, so the allowance is larger.
 */
const LIMB_TOL = 0.17;
const FLOOR_TOL = -0.06;
const CONTACT_TOL = 0.03;
const CORE = new Set(['pelvis', 'belly', 'ribs', 'chest', 'shoulders', 'neck', 'head']);

const composer = new Composer();
const out: [Pose, Pose] = [createPose(), createPose()];
const wa = createWorldPose();
const wb = createWorldPose();

function req(node: string, extra: Partial<PairRequest> = {}): PairRequest {
  return { node, variant: DEFAULT_VARIANT, mirror: false, flight: null, sub: null, strike: null, ...extra };
}

function solve(r: PairRequest, ha: number, hb: number, contacts?: ContactRecord[]) {
  const res = composer.compose(r, rest(ha), rest(hb), out, contacts);
  forwardKinematics(wa, out[0], rest(ha));
  forwardKinematics(wb, out[1], rest(hb));
  return res;
}

function worstPenetration(ha: number, hb: number): { core: number; limb: number; what: string } {
  const ca = bodyCapsules(wa, rest(ha));
  const cb = bodyCapsules(wb, rest(hb));
  let core = 0, limb = 0, what = '';
  for (const p of penetrations(ca, cb, 0)) {
    const isCore = CORE.has(p.a) && CORE.has(p.b);
    if (isCore && p.depth > core) { core = p.depth; what = `${p.a}/${p.b}`; }
    if (!isCore && p.depth > limb) limb = p.depth;
  }
  return { core, limb, what };
}

// ---------------------------------------------------------------------------

describe('grapple: coverage', () => {
  it('every POSITIONS id has a bespoke pose or is explicitly listed as generic', () => {
    for (const p of POSITIONS) {
      const bespoke = p.id in NODE_POSES;
      const generic = p.id in GENERIC_NODES;
      expect(bespoke || generic, p.id).toBe(true);
      expect(bespoke && generic, `${p.id} listed twice`).toBe(false);
    }
  });

  it('every submission in the catalogue has a stage builder', () => {
    const cov = subCoverage();
    expect(cov.length).toBe(SUBMISSIONS.length);
    for (const c of cov) expect(c.builder, c.id).not.toBe('none');
  });

  it('the solver is registered with the hand-off at import', () => {
    expect(grappleSolver()).not.toBeNull();
  });

  it('every node composes to finite poses for every size pairing', () => {
    for (const p of POSITIONS) {
      for (const [ha, hb] of SIZES) {
        const r = solve(req(p.id), ha, hb);
        expect(r.handled, p.id).toBe(true);
        for (const pose of out) {
          for (const v of pose.local) expect(Number.isFinite(v), p.id).toBe(true);
          for (const v of pose.rootPos) expect(Number.isFinite(v), p.id).toBe(true);
        }
      }
    }
  });
});

describe('grapple: key poses', () => {
  it('bodies press but do not pass through each other, and stay on the mat', () => {
    const bad: string[] = [];
    for (const p of POSITIONS) {
      for (const [ha, hb] of SIZES) {
        solve(req(p.id), ha, hb);
        const w = worstPenetration(ha, hb);
        if (w.core > CORE_TOL) bad.push(`${p.id} ${ha}/${hb} core ${w.what} ${(w.core * 100).toFixed(0)} cm`);
        if (w.limb > LIMB_TOL) bad.push(`${p.id} ${ha}/${hb} limb ${(w.limb * 100).toFixed(0)} cm`);
        const low = Math.min(lowestPoint(bodyCapsules(wa, rest(ha))), lowestPoint(bodyCapsules(wb, rest(hb))));
        if (low < FLOOR_TOL) bad.push(`${p.id} ${ha}/${hb} below the mat ${(low * 100).toFixed(0)} cm`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('grips land within 3 cm of their sockets for equal, big-on-small and small-on-big pairs', () => {
    const bad: string[] = [];
    let n = 0;
    let lost = 0;
    for (const p of POSITIONS) {
      for (const [ha, hb] of SIZES) {
        const contacts: ContactRecord[] = [];
        solve(req(p.id), ha, hb, contacts);
        n += contacts.length + dropped.length;
        lost += dropped.length;
        for (const c of contacts) {
          const e = dist(c.want, c.got);
          if (e > CONTACT_TOL) bad.push(`${p.id} ${ha}/${hb} ${'ab'[c.who]}.${c.limb}->${c.socket} ${(e * 100).toFixed(1)} cm`);
        }
        // Equal bodies must make every grip the pose asks for.
        if (ha === hb && dropped.length > 0) bad.push(`${p.id} equal sizes let go of ${dropped.map((d) => d.socket).join(', ')}`);
      }
    }
    expect(bad).toEqual([]);
    expect(n).toBeGreaterThan(500);
    // Mismatched bodies may let go of a grip they cannot reach, rarely.
    expect(lost / n).toBeLessThan(0.03);
  });

  it('submission stage poses hold their grips for every size pairing', () => {
    const bad: string[] = [];
    for (const s of SUBMISSIONS) {
      const node = defaultNodeForSub(s.id);
      const role = (s as unknown as { role: string }).role;
      const attacker: 'a' | 'b' = role === 'bottom' ? 'b' : 'a';
      for (const stage of [1, 2, 3, 4]) {
        for (const [ha, hb] of SIZES) {
          const contacts: ContactRecord[] = [];
          const r = solve(req(node, { sub: { technique: s.id, stage, attacker, stageT: 0.5, tapT: stage === 4 ? 0.2 : null, limp: false } }), ha, hb, contacts);
          expect(r.handled, s.id).toBe(true);
          for (const c of contacts) {
            const e = dist(c.want, c.got);
            if (e > CONTACT_TOL) bad.push(`${s.id} S${stage} ${ha}/${hb} ${'ab'[c.who]}.${c.limb}->${c.socket} ${(e * 100).toFixed(1)} cm`);
          }
          const w = worstPenetration(ha, hb);
          if (w.core > CORE_TOL * 2) bad.push(`${s.id} S${stage} ${ha}/${hb} core ${w.what} ${(w.core * 100).toFixed(0)} cm`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/** Max joint displacement between consecutive frames. */
function frameJump(prev: Float32Array[], cur: Float32Array[]): number {
  let m = 0;
  for (let i = 0; i < 2; i++) {
    for (let b = 0; b < BONE_COUNT; b++) {
      const d = Math.hypot(cur[i][b * 3] - prev[i][b * 3], cur[i][b * 3 + 1] - prev[i][b * 3 + 1], cur[i][b * 3 + 2] - prev[i][b * 3 + 2]);
      if (d > m) m = d;
    }
  }
  return m;
}

const STANDING = new Set(POSITIONS.filter((p) => p.family === 'standingFree').map((p) => p.id as string));
/** A frame-to-frame joint move this large at 60 fps (18 m/s) is a pop, not motion. */
const JUMP_TOL = 0.3;

describe('grapple: transitions', () => {
  it('every edge arc is continuous at 60 fps (no joint jumps between frames)', () => {
    const bad: string[] = [];
    const [ha, hb] = SIZES[1];
    for (const e of GRAPPLING_EDGES) {
      // Entries from free standing are the standing animator's; the pair only
      // exists once they land in a tie-up.
      const from = e.from.find((f) => !STANDING.has(f) && nodePoseFor(f));
      if (!from) continue;
      const d = likelyDestination(e.id, from);
      const durMs = Math.max(400, (e.durationMs[0] + e.durationMs[1]) / 2);
      const steps = Math.round((durMs / 1000) * 60);
      let prev: Float32Array[] | null = null;
      let worst = 0;
      for (let k = 0; k <= steps; k++) {
        solve(req(from, { flight: { edge: e.id, phase: k / steps, dest: d.node, swap: d.swap, durMs, kuzushi: { dir: 0, mag: 1 } } }), ha, hb);
        const cur = [new Float32Array(wa.pos), new Float32Array(wb.pos)];
        if (prev) worst = Math.max(worst, frameJump(prev, cur));
        prev = cur;
      }
      if (worst > JUMP_TOL) bad.push(`${e.id} ${(worst * 100).toFixed(0)} cm/frame`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('the solver carries a node → edge → node sequence at 60 fps without pops', () => {
    const solver = new GrappleSolverImpl();
    const ra = rest(1.93), rb = rest(1.65);
    const pa = createPose(), pb = createPose();
    const w0 = createWorldPose(), w1 = createWorldPose();
    const seqs: [string, string, string][] = [
      ['pos.td_double_leg_in', 'tech.double_drive_through', 'pos.ground_open_kneeling_top'],
      ['pos.clinch_over_under', 'tech.uchi_mata', 'pos.ground_side'],
      ['pos.ground_closed_posture_up', 'tech.sweep_hip_bump', 'pos.ground_mount_low'],
      ['pos.ground_side', 'tech.side_to_mount', 'pos.ground_mount_low'],
      ['pos.ground_mount_low', 'tech.escape_mount_upa', 'pos.ground_closed_posture_up'],
    ];
    const bad: string[] = [];
    for (const [node, edge, dest] of seqs) {
      solver.reset();
      const e = GRAPPLING_EDGES.find((x) => x.id === edge)!;
      const swap = e.to.find((t) => t.node === dest)?.swap ?? false;
      const durMs = Math.round((e.durationMs[0] + e.durationMs[1]) / 2);
      let prev: Float32Array[] | null = null;
      let worst = 0;
      const total = 0.5 + durMs / 1000 + 0.8;
      for (let f = 0; f * (1 / 60) < total; f++) {
        const t = 10 + f / 60;
        const local = t - 10;
        const inFlight = local >= 0.5 && local < 0.5 + durMs / 1000;
        const after = local >= 0.5 + durMs / 1000;
        const phase = inFlight ? (local - 0.5) / (durMs / 1000) : 0;
        const ctx = contextFor({
          node: after ? dest : node,
          swapped: after && swap,
          inflight: inFlight ? { edge, tStart: 0, dur: durMs, phase } : null,
          t, discontinuity: f === 0, ra, rb,
        });
        solver.evaluate(ctx, after && swap ? pb : pa, after && swap ? pa : pb, w0, w1);
        forwardKinematics(w0, pa, ra);
        forwardKinematics(w1, pb, rb);
        const cur = [new Float32Array(w0.pos), new Float32Array(w1.pos)];
        if (prev) worst = Math.max(worst, frameJump(prev, cur));
        prev = cur;
      }
      if (worst > JUMP_TOL) bad.push(`${node} → ${edge} → ${dest}: ${(worst * 100).toFixed(0)} cm/frame`);
    }
    expect(bad).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------

describe('grapple: determinism', () => {
  it('the same frame gives the same poses, whatever came before', () => {
    const ra = rest(1.93), rb = rest(1.65);
    const run = (warm: boolean): Float32Array => {
      const solver = new GrappleSolverImpl();
      const pa = createPose(), pb = createPose();
      const w0 = createWorldPose(), w1 = createWorldPose();
      if (warm) {
        for (let k = 0; k < 20; k++) {
          solver.evaluate(contextFor({ node: 'pos.ground_side', inflight: null, t: 3 + k / 60, discontinuity: k === 0, ra, rb }), pa, pb, w0, w1);
        }
      }
      // A seek lands here: discontinuity must make history irrelevant.
      solver.evaluate(contextFor({ node: 'pos.ground_mount_high', inflight: { edge: 'tech.mount_to_tech_mount', tStart: 0, dur: 1500, phase: 0.6 }, t: 7.25, discontinuity: true, ra, rb }), pa, pb, w0, w1);
      return new Float32Array([...pa.local, ...pa.rootPos, ...pb.local, ...pb.rootPos]);
    };
    const a = run(false);
    const b = run(true);
    const c = run(true);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(Array.from(c)).toEqual(Array.from(a));
  });

  it('never calls Math.random', () => {
    const orig = Math.random;
    Math.random = () => { throw new Error('Math.random in the grapple solver'); };
    try {
      for (const p of POSITIONS) solve(req(p.id), 1.78, 1.78);
    } finally {
      Math.random = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// Snapshot scaffolding
// ---------------------------------------------------------------------------

function fighter(id: number, over: Partial<FighterSnapshot> = {}): FighterSnapshot {
  return {
    id, team: id, x: id === 0 ? -0.075 : 0.075, z: 0, facing: 0, vx: 0, vz: 0, stance: 'orthodox', leadFoot: 0,
    againstFence: false, fenceNormalAngle: 0, posture: 'ground', position: 'pos.ground_side', role: id === 0 ? 'top' : 'bottom',
    partnerId: 1 - id, action: 'idle', actionPhase: 0, actionStage: 'none', actionResult: 'none', defence: 'def.none' as never,
    actionDetail: { startTick: 0, totalMs: 0, contactTick: 0, contactOffsetMs: 0, target: 'none', subLocation: null, side: 'L', targetId: null, forceNorm: 0, direction: 'front' },
    defenceDetail: { phase: 1, side: 'both' },
    stamina: { total: 1, burst: 1 }, damage: { head: 0, body: 0, legs: 0, cut: 0 }, state: 0, states: [], balance: 1,
    sub: { technique: null, stage: 0, progress: 0 }, sig: { landed: 0, attempted: 0 }, intentTag: '',
    grips: [], contacts: { footL: false, footR: false, kneeL: false, kneeR: false, handL: false, handR: false, hipL: false, hipR: false, back: false, chest: false, fence: false },
    damageVisual: { zones: [], swelling: [], cuts: [], bloodOnGloves: 0 },
    fatigueVisual: { f: 0, breathingRate: 0, handsDrop: 0, flatFeet: 0, chinUp: 0 },
    ...over,
  } as FighterSnapshot;
}

function contextFor(o: {
  node: string; swapped?: boolean; inflight: EngagementSnapshot['inflight']; t: number; discontinuity: boolean;
  ra: RestSkeleton; rb: RestSkeleton;
}): GrappleContext {
  const aId = o.swapped ? 1 : 0;
  const bId = 1 - aId;
  const e: EngagementSnapshot = {
    a: aId, b: bId, node: o.node as EngagementSnapshot['node'], sinceTick: 0, kind: 'ground', cage: false,
    underhookOwner: null, kuzushi: { dir: 0, mag: 1 }, posture: 'chest', inflight: o.inflight,
    rootX: 0, rootZ: 0, rootYaw: o.swapped ? Math.PI : 0,
  };
  const fs = [fighter(0), fighter(1)];
  const frame = { v: 4, tick: Math.round(o.t * 10), t: o.t, round: 1, roundTime: o.t, phase: 'round', fighters: fs, engagements: [e], referee: { state: 'watching' }, score: { hidden: true } } as unknown as TickSnapshot;
  const input: FrameInput = { frame, next: null, alpha: 0, simTime: o.t, events: [] as SimEvent[], playbackRate: 1, replay: false, discontinuity: o.discontinuity };
  const bout = { fighters: [], runtimes: [], teamOf: [0, 1], arena: { id: 'x', name: 'x', shape: 'unbounded', wall: 'none', surface: 'canvas', surfaceHardness: 1, outOfBounds: 'none' }, rulesetId: 'mma.unified.3r', glove: 'mma4oz', cornerColours: ['#f00', '#00f'], blood: false, cosmeticSeed: 't' } as unknown as BoutPresentation;
  return { bout, input, engagement: e, nextEngagement: null, a: fs[aId], b: fs[bId], restA: aId === 0 ? o.ra : o.rb, restB: aId === 0 ? o.rb : o.ra };
}
