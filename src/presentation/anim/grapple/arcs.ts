/**
 * TRANSITION ARCS — how the pair moves while an edge is in flight.
 *
 * An arc is a list of keys over the edge's *active* window. Each key is a
 * paired pose (the from-node, the destination node, another node such as
 * `pos.td_lifted`, or a spec written here) plus optional rigid effects applied
 * after solving: lift a body, move it, or rotate it about a pivot (a throw is
 * uke's body turning over tori's hip; a sweep is the pair rolling). Keys are
 * solved and then blended pairwise, so contacts hold at every key and the path
 * between keys is a shortest-arc slerp per bone (keys are authored less than
 * 90° apart so the path is the intended one).
 *
 * Long edges (a 6-15 s guard pass) spend most of their duration working in the
 * from-position; the arc plays over the final `activeS` seconds.
 *
 * Geometry note: the sim's interaction root never moves during an engagement,
 * so every arc must land in the destination node's layout. Forward throws are
 * therefore thrown *across* (uke turns over tori's hip about the a→b axis and
 * lands along X with his head toward +X, which is exactly side control's
 * layout), and falls go backward toward +Z (the layout of guard and half guard).
 */
import type { PairSpec } from './dsl';
import { swapRoles } from './dsl';
import { arm, on, stand } from './build';
import { easeInOut, lerp, smooth, type V3 } from './math';
import { evalNodePose, type Variant } from './poses/types';
import { nodePoseFor } from './poses';
import { mirrorPair } from './dsl';
import { GRAPPLING_EDGES } from '../../../sim';

/** A rigid effect applied to one solved body at a key. */
export interface Fx {
  who: 0 | 1;
  /** Pair-frame translation (metres, reference body). */
  move?: V3;
  /**
   * Rotation. `axis` is a pair-frame vector or one of the body's own axes:
   * 'left' (+θ tips the body toward its belly: a standing man pitches forward,
   * a supine man sits up), 'fwd' (+θ rolls it toward its right), 'up' (+θ
   * turns it to its left).
   */
  rot?: { axis: V3 | 'left' | 'fwd' | 'up'; deg: number; pivot: Pivot };
}
export type Pivot = 'hips' | 'feet' | 'chest' | 'partnerHips' | 'partnerChest' | V3;

export interface ArcKey {
  at: number;
  spec: PairSpec;
  fx?: Fx[];
}

export interface Arc {
  keys: ArcKey[];
  ease: (t: number) => number;
  bespoke: boolean;
  /** Seconds of motion at the end of the edge; null = the whole edge. */
  activeS: number | null;
}

export interface ArcContext {
  edge: string;
  from: string;
  dest: string;
  fromSpec: PairSpec | null;
  toSpec: PairSpec | null;
  v: Variant;
  mirror: boolean;
  /** Mirror sign: +1 normally, -1 when the pair is mirrored (throws go to -X). */
  sx: number;
}

const EDGE = new Map(GRAPPLING_EDGES.map((e) => [e.id, e] as const));

/** Node pose as a spec in this arc's frame (mirrored like the rest). */
function node(id: string, c: ArcContext): PairSpec | null {
  const p = nodePoseFor(id);
  if (!p) return null;
  const s = evalNodePose(p, c.v);
  return c.mirror ? mirrorPair(s) : s;
}

// ---------------------------------------------------------------------------
// Arc builders
// ---------------------------------------------------------------------------

type Builder = (c: ArcContext, from: PairSpec, to: PairSpec) => Omit<Arc, 'bespoke'>;

/** Near-linear time for fast, key-shaped motions (throws, falls): no 3x mid-phase rush. */
const gentle = (t: number): number => 0.75 * t + 0.25 * smooth(t);

/** Plain eased blend: the fallback for every edge without a story of its own. */
const blend: Builder = (_c, from, to) => ({
  keys: [{ at: 0, spec: from }, { at: 1, spec: to }], ease: easeInOut, activeS: 0.9,
});

/**
 * Takedown finish from a captured leg or body: tori drives, uke's feet leave
 * him and he tips backward (toward +Z), both land into the destination.
 */
const drive = (side = 0): Builder => (c, from, to) => ({
  keys: [
    { at: 0, spec: from },
    // Drive: tori steps up and in, uke's hips go back over his heels.
    { at: 0.3, spec: from, fx: [
      { who: 0, move: [0, 0.06, 0.16] },
      { who: 1, rot: { axis: 'left', deg: -24, pivot: 'feet' }, move: [0.06 * side * c.sx, 0, 0.06] },
    ] },
    // Fall: uke's base is gone, he drops seat-first; tori stays chest-to-chest.
    { at: 0.55, spec: from, fx: [
      { who: 0, move: [0.03 * side * c.sx, -0.12, 0.34], rot: { axis: 'left', deg: 12, pivot: 'feet' } },
      { who: 1, rot: { axis: 'left', deg: -58, pivot: 'feet' }, move: [0.1 * side * c.sx, -0.3, 0.2] },
    ] },
    // Landing: uke flat, tori still heavy on him before he postures.
    { at: 0.8, spec: to, fx: [
      { who: 0, rot: { axis: 'left', deg: 40, pivot: 'hips' }, move: [0, -0.04, 0.1] },
      { who: 1, move: [0, 0.05, 0] },
    ] },
    { at: 1, spec: to },
  ],
  ease: gentle,
  activeS: 1.0,
});

/** Lift and return: uke hoisted (td_lifted), swung down to the side, slammed. */
const liftSlam: Builder = (c, from, to) => {
  const lifted = node('pos.td_lifted', c) ?? from;
  return {
    keys: [
      { at: 0, spec: from },
      { at: 0.4, spec: lifted },
      { at: 0.7, spec: lifted, fx: [{ who: 1, rot: { axis: [0, 0, 1], deg: -70 * c.sx, pivot: 'partnerChest' }, move: [0, -0.15, 0] }] },
      { at: 1, spec: to },
    ],
    // Hold the lift, then accelerate into the mat.
    ease: (t) => (t < 0.7 ? easeInOut(t / 0.7) * 0.7 : 0.7 + Math.pow((t - 0.7) / 0.3, 1.6) * 0.3),
    activeS: 1.3,
  };
};

/**
 * Forward throw thrown across: tori (thrower) turns side-on and loads uke on
 * his hip, uke turns over the hip about the a→b axis and lands along X, head
 * toward +X (side control's layout). `thrower` 1 = a counter by b.
 */
const hipThrow = (thrower: 0 | 1 = 0): Builder => (c, from, to) => {
  const load = throwLoad(c, thrower);
  const uke = (1 - thrower) as 0 | 1;
  return {
    keys: [
      { at: 0, spec: from },
      { at: 0.12, spec: from, fx: [{ who: uke, rot: { axis: 'left', deg: 6 + 3 * c.v.tierA * 0, pivot: 'feet' } }] },
      { at: 0.34, spec: load },
      { at: 0.58, spec: load, fx: [
        // Uke turns over the hip toward +X (toward -X when b throws: the
        // role swap turns the frame).
        { who: uke, rot: { axis: [0, 0, 1], deg: (thrower === 0 ? -75 : 75) * c.sx, pivot: 'partnerHips' } },
        { who: thrower, rot: { axis: 'left', deg: 12, pivot: 'feet' } },
      ] },
      { at: 0.8, spec: to, fx: [
        { who: uke, move: [0, 0.2, 0], rot: { axis: 'left', deg: 20, pivot: 'hips' } },
        { who: thrower, move: [0, 0.3, 0] },
      ] },
      { at: 1, spec: to },
    ],
    ease: gentle,
    activeS: null,
  };
};

/** Tori side-on, hips in front of uke's, uke bent over tori's hip. */
function throwLoad(c: ArcContext, thrower: 0 | 1): PairSpec {
  const sx = c.sx;
  const tori = {
    ...stand({ at: [-0.04 * sx, -0.02], yaw: 90 * sx, h: 0.8, pitch: 32, chest: { bend: 26, twist: 10 * sx }, lFoot: [0.18, 0.05], rFoot: [-0.18, 0.1], head: { look: [sx, -0.3, 0.2] as V3 } }),
    lArm: arm(on(sx > 0 ? 'wrist_L' : 'wrist_R'), 'grip', [0.6, -1, 0]),
    rArm: arm(on('back_mid', [0, 0, 0]), 'grip', [-0.8, 0.3, 0]),
  };
  const uke = {
    ...stand({ at: [0.02 * sx, 0.24], yaw: 180 + 25 * sx, h: 0.84, pitch: 40, chest: { bend: 20, twist: -10 * sx }, lFoot: [0.14, 0.12], rFoot: [-0.14, 0.02], head: { look: [sx, -0.4, -0.4] as V3 } }),
    lArm: arm(on('scap_L'), 'grip', [0.6, -1, 0]),
    rArm: arm(on('shoulder_R'), 'open', [-0.6, -1, 0]),
  };
  const p: PairSpec = { a: tori, b: uke };
  return thrower === 0 ? p : swapRoles(p);
}

/** Leg reap / foot sweep / trip: uke's base is taken, he falls backward. */
const trip: Builder = (c, from, to) => ({
  keys: [
    { at: 0, spec: from },
    { at: 0.3, spec: from, fx: [
      { who: 0, move: [0.04 * c.sx, 0, 0.1] },
      { who: 1, rot: { axis: 'left', deg: -18, pivot: 'feet' } },
    ] },
    { at: 0.62, spec: to, fx: [
      { who: 1, move: [0, 0.3, -0.05], rot: { axis: 'left', deg: 48, pivot: 'hips' } },
      { who: 0, move: [0, 0.32, -0.08] },
    ] },
    { at: 1, spec: to },
  ],
  ease: gentle,
  activeS: null,
});

/** Sacrifice throw: tori sits through to his side, uke rolls over sideways. */
const sacrifice: Builder = (c, from, to) => ({
  keys: [
    { at: 0, spec: from },
    { at: 0.3, spec: from, fx: [
      { who: 0, move: [0, -0.35, 0.12], rot: { axis: 'left', deg: -35, pivot: 'feet' } },
      { who: 1, rot: { axis: 'left', deg: 20, pivot: 'feet' }, move: [0, 0, -0.08] },
    ] },
    { at: 0.62, spec: from, fx: [
      { who: 0, move: [0, -0.55, 0.05], rot: { axis: 'left', deg: -70, pivot: 'feet' } },
      { who: 1, rot: { axis: [0, 0, 1], deg: -80 * c.sx, pivot: 'partnerChest' }, move: [0, -0.1, 0] },
    ] },
    { at: 1, spec: to },
  ],
  ease: gentle,
  activeS: null,
});

/** Suplex / rear lift: uke hoisted and arched backward over tori. */
const suplex: Builder = (c, from, to) => ({
  keys: [
    { at: 0, spec: from },
    { at: 0.35, spec: from, fx: [{ who: 1, move: [0, 0.3, -0.05] }, { who: 0, rot: { axis: 'left', deg: -15, pivot: 'feet' } }] },
    { at: 0.65, spec: from, fx: [
      { who: 1, move: [0, 0.2, -0.1], rot: { axis: [0, 0, 1], deg: -80 * c.sx, pivot: 'partnerChest' } },
      { who: 0, rot: { axis: 'left', deg: -35, pivot: 'feet' } },
    ] },
    { at: 1, spec: to },
  ],
  ease: gentle,
  activeS: null,
});

/** Sweeps and bridge-and-roll: the pair turns over sideways together. */
const roll = (deg = 70): Builder => (c, from, to) => ({
  keys: [
    { at: 0, spec: from },
    { at: 0.25, spec: from, fx: [{ who: 1, move: [0, 0.04, 0], rot: { axis: 'fwd', deg: -12 * c.sx, pivot: 'hips' } }] },
    { at: 0.5, spec: from, fx: [
      { who: 0, move: [0, 0.14, 0], rot: { axis: [0, 0, 1], deg: deg * c.sx, pivot: [0, 0.25, 0] } },
      { who: 1, move: [0, 0.14, 0], rot: { axis: [0, 0, 1], deg: deg * c.sx, pivot: [0, 0.25, 0] } },
    ] },
    { at: 0.78, spec: to, fx: [
      { who: 0, move: [0, 0.1, 0], rot: { axis: [0, 0, 1], deg: -deg * 0.55 * c.sx, pivot: [0, 0.25, 0] } },
      { who: 1, move: [0, 0.1, 0], rot: { axis: [0, 0, 1], deg: -deg * 0.55 * c.sx, pivot: [0, 0.25, 0] } },
    ] },
    { at: 1, spec: to },
  ],
  ease: smooth,
  activeS: 1.1,
});

/** Hip escape: the bottom man turns on his side and shrimps his hips out. */
const shrimp: Builder = (c, from, to) => ({
  keys: [
    { at: 0, spec: from },
    { at: 0.45, spec: from, fx: [{ who: 1, move: [-0.16 * c.sx, 0.04, -0.06], rot: { axis: 'fwd', deg: 45 * c.sx, pivot: 'hips' } }] },
    { at: 1, spec: to },
  ],
  ease: smooth,
  activeS: 1.2,
});

/** Guard pass: the top man's hips come up and travel around the legs. */
const pass: Builder = (c, from, to) => ({
  keys: [
    { at: 0, spec: from },
    { at: 0.45, spec: from, fx: [{ who: 0, move: [0.22 * c.sx, 0.14, 0.12], rot: { axis: 'up', deg: 35 * c.sx, pivot: 'hips' } }] },
    { at: 1, spec: to },
  ],
  ease: smooth,
  activeS: 1.5,
});

/** Positional advance on top (side to mount, mount climb, back takes). */
const advance: Builder = (_c, from, to) => ({
  keys: [
    { at: 0, spec: from },
    { at: 0.5, spec: from, fx: [{ who: 0, move: [0, 0.14, 0.05] }] },
    { at: 1, spec: to },
  ],
  ease: smooth,
  activeS: 1.2,
});

/**
 * Technical stand-up and other get-ups: the bottom man sits up, posts, and
 * rises through a low base into the destination.
 */
const standUp: Builder = (_c, from, to) => ({
  keys: [
    { at: 0, spec: from },
    { at: 0.3, spec: from, fx: [{ who: 1, rot: { axis: 'left', deg: 50, pivot: 'hips' }, move: [0, 0.05, 0.05] }] },
    { at: 0.62, spec: to, fx: [{ who: 1, move: [0, -0.38, 0.1], rot: { axis: 'left', deg: 45, pivot: 'feet' } }] },
    { at: 1, spec: to },
  ],
  ease: smooth,
  activeS: 1.4,
});

/** Level change into a leg capture from a tie-up. */
const shoot: Builder = (_c, from, to) => ({
  keys: [
    { at: 0, spec: from },
    { at: 0.4, spec: from, fx: [{ who: 0, move: [0, -0.28, 0.05], rot: { axis: 'left', deg: 25, pivot: 'hips' } }] },
    { at: 1, spec: to },
  ],
  ease: smooth,
  activeS: 0.6,
});

/** Cage drive: a walks b backward into the fence. */
const cageDrive: Builder = (_c, from, to) => ({
  keys: [
    { at: 0, spec: from },
    { at: 0.5, spec: from, fx: [{ who: 0, move: [0, 0, 0.18], rot: { axis: 'left', deg: 10, pivot: 'feet' } }, { who: 1, move: [0, 0, 0.2], rot: { axis: 'left', deg: -8, pivot: 'feet' } }] },
    { at: 1, spec: to },
  ],
  ease: smooth,
  activeS: 1.2,
});

/** Scramble: both bodies come up off the mat and tangle. */
const scramble: Builder = (_c, from, to) => ({
  keys: [
    { at: 0, spec: from },
    { at: 0.5, spec: from, fx: [{ who: 0, move: [0, 0.18, 0] }, { who: 1, move: [0, 0.14, 0], rot: { axis: 'fwd', deg: 30, pivot: 'hips' } }] },
    { at: 1, spec: to },
  ],
  ease: smooth,
  activeS: 1.2,
});

// ---------------------------------------------------------------------------
// Edge → builder
// ---------------------------------------------------------------------------

const BESPOKE: Partial<Record<string, Builder>> = {
  // Takedown finishes
  'tech.double_drive_through': drive(0),
  'tech.knee_tap_double': drive(0.5),
  'tech.double_turn_corner': drive(1),
  'tech.double_cut_corner': drive(1),
  'tech.single_run_pipe': drive(1),
  'tech.single_dump': drive(-1),
  'tech.single_trip': drive(0.5),
  'tech.single_tree_top': drive(0),
  'tech.single_low_finish': drive(0.5),
  'tech.cage_single_chain': drive(0.5),
  'tech.hc_to_double': drive(0),
  'tech.ankle_pick': trip,
  'tech.kick_catch_takedown': drive(1),
  'tech.double_lift_slam': liftSlam,
  'tech.hc_lift_dump': liftSlam,
  'tech.body_lock_lift_return': liftSlam,
  'tech.rear_mat_return': liftSlam,
  'tech.cage_mat_return': liftSlam,
  'tech.rear_lift_suplex': suplex,
  'tech.ura_nage': suplex,
  // Throws (tori = a)
  'tech.uchi_mata': hipThrow(0),
  'tech.harai_goshi': hipThrow(0),
  'tech.hane_goshi': hipThrow(0),
  'tech.koshi_guruma': hipThrow(0),
  'tech.o_goshi': hipThrow(0),
  'tech.ippon_seoi': hipThrow(0),
  'tech.morote_seoi': hipThrow(0),
  'tech.tai_otoshi': hipThrow(0),
  'tech.kata_guruma': hipThrow(0),
  'tech.te_guruma': hipThrow(0),
  'tech.whizzer_throw': hipThrow(0),
  'tech.thai_dump': trip,
  'tech.osoto_gari': trip,
  'tech.ouchi_gari': trip,
  'tech.kouchi_gari': trip,
  'tech.de_ashi_harai': trip,
  'tech.sasae_tsurikomi_ashi': trip,
  'tech.inside_trip': trip,
  'tech.outside_trip': trip,
  'tech.rear_trip': trip,
  'tech.tani_otoshi': sacrifice,
  'tech.sumi_gaeshi': sacrifice,
  'tech.tomoe_nage': sacrifice,
  // Counter throws (b throws a; the destination is already swapped into this frame)
  'tech.uchi_mata_sukashi': hipThrow(1),
  'tech.harai_gaeshi': hipThrow(1),
  'tech.osoto_gaeshi': hipThrow(1),
  'tech.ouchi_gaeshi': hipThrow(1),
  // Captures from a tie-up
  'tech.single_leg': shoot,
  'tech.double_leg': shoot,
  'tech.high_crotch': shoot,
  'tech.single_outside': shoot,
  'tech.single_low': shoot,
  'tech.knee_catch_single': shoot,
  'tech.re_shot': shoot,
  // Cage
  'tech.cage_drive': cageDrive,
  // Sweeps and reversals
  'tech.sweep_hip_bump': roll(80),
  'tech.sweep_scissor': roll(80),
  'tech.sweep_flower': roll(80),
  'tech.sweep_butterfly_hook': roll(70),
  'tech.sweep_x_slx': roll(60),
  'tech.sweep_deep_half': roll(60),
  'tech.rubber_guard_sweep': roll(70),
  'tech.sweep_on_strike': roll(70),
  'tech.lockdown_whip_up': roll(50),
  'tech.escape_mount_upa': roll(85),
  'tech.bridge_roll_kesa_side': roll(80),
  'tech.funk_roll': roll(90),
  // Escapes
  'tech.escape_side_frames_shrimp': shrimp,
  'tech.escape_mount_elbow_knee': shrimp,
  'tech.escape_half_recover': shrimp,
  'tech.guard_retention': shrimp,
  'tech.escape_kob': shrimp,
  'tech.escape_kesa': shrimp,
  // Get-ups
  'tech.technical_standup': standUp,
  'tech.upkick_push_stand': standUp,
  'tech.hip_in_technical_standup_open': standUp,
  'tech.stand_from_turtle': standUp,
  'tech.standup_from_closed_guard': standUp,
  'tech.wall_walk': standUp,
  'tech.wrestle_up': standUp,
  'tech.knee_shield_wrestle_up': standUp,
  // Scrambles
  'tech.scramble_resolve': scramble,
  'tech.dogfight_resolve': scramble,
  'tech.escape_granby': scramble,
  'tech.turtle_sit_out_peek': scramble,
};

const PASS_KINDS = new Set(['pass']);
const ADVANCE_KINDS = new Set(['advance']);

function builderFor(edge: string): { b: Builder; bespoke: boolean } {
  const b = BESPOKE[edge];
  if (b) return { b, bespoke: true };
  const e = EDGE.get(edge);
  if (e && PASS_KINDS.has(e.kind)) return { b: pass, bespoke: true };
  if (e && ADVANCE_KINDS.has(e.kind)) return { b: advance, bespoke: true };
  return { b: blend, bespoke: false };
}

/** Edge ids with a motion story of their own (for the coverage notes). */
export function bespokeEdges(): string[] {
  return GRAPPLING_EDGES.filter((e) => builderFor(e.id).bespoke).map((e) => e.id);
}

export function arcFor(
  edge: string, from: string, dest: string, fromSpec: PairSpec | null, toSpec: PairSpec | null,
  v: Variant, mirror: boolean,
): Arc | null {
  if (!fromSpec && !toSpec) return null;
  if (!fromSpec) return { keys: [{ at: 0, spec: toSpec! }], ease: easeInOut, bespoke: false, activeS: null };
  if (!toSpec) return { keys: [{ at: 0, spec: fromSpec }], ease: easeInOut, bespoke: false, activeS: null };
  const c: ArcContext = { edge, from, dest, fromSpec, toSpec, v, mirror, sx: mirror ? -1 : 1 };
  if (from === dest) {
    // Same-node edges (strikes in the tie, grip fighting, GnP posture) are
    // drawn by the strike layer and idle life, not by an arc.
    return { keys: [{ at: 0, spec: fromSpec }], ease: easeInOut, bespoke: false, activeS: null };
  }
  const { b, bespoke } = builderFor(edge);
  return { ...b(c, fromSpec, toSpec), bespoke };
}

/**
 * The active-window phase: long edges hold the from-pose (working) and move
 * in the final `activeS` seconds.
 */
export function activePhase(arc: Arc, phase: number, durMs: number): number {
  if (arc.activeS === null || durMs <= 0) return phase;
  const act = Math.min(durMs, arc.activeS * 1000);
  return Math.max(0, Math.min(1, (phase * durMs - (durMs - act)) / act));
}

export function sampleArc(arc: Arc, phase: number): { k0: ArcKey; k1: ArcKey | null; w: number } {
  const t = arc.ease(Math.min(1, Math.max(0, phase)));
  const ks = arc.keys;
  if (ks.length === 1 || t <= ks[0].at) return { k0: ks[0], k1: null, w: 0 };
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (t <= b.at) {
      const w = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1;
      return { k0: a, k1: b, w: smooth(w) * 0.35 + w * 0.65 };
    }
  }
  return { k0: ks[ks.length - 1], k1: null, w: 0 };
}

void lerp;
