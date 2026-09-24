/**
 * THE END OF THE BOUT — the post-fight sequence as a pure script.
 *
 * The recording stops on the stoppage (or the decision): its last frame is the
 * tick the bout ended. Everything a broadcast shows after that — the referee
 * waving it off, the winner walking away with his arms up, the loser attended
 * on the canvas, then both fighters either side of the referee in the centre
 * and the winner's hand raised — happens while the playhead rests on that last
 * frame. This file is the script: given the recorded result, where everyone is
 * and what they do `t` seconds after the end. It is a pure function of the
 * recording and `t` (no state, no randomness); `finish/index.ts` poses the
 * bodies from it and the camera planner cuts to it.
 *
 * Timing (seconds after the end), stoppages (KO, TKO, submission, DQ):
 *   0     the referee is in; he waves it off over the loser, between the two;
 *   0.9   the winner turns away and walks off toward open canvas, arms rising;
 *   3.0   the winner celebrates to the crowd (arms up, turning, pumping);
 *   2.0   the referee kneels beside the loser (hand on him when he sits up);
 *         the loser stays down, then sits up (KO later than TKO), then stands;
 *   9.0   the finish replay airs (the post clock waits while it plays);
 *   9.0   everyone walks to the centre: referee in the middle facing the hard
 *         camera, the winner on one side, the loser on the other;
 *   13.0  the referee takes both by the wrist, arms low;
 *   16.0  he raises the winner's arm (0.7 s), and holds it up.
 * Decisions: apart, both arms up (each thinks he won), to the centre by 7.6 s,
 * wrists taken at 8.2 s, the hand raised at 12 s (both hands for a draw, no
 * raise for a no contest).
 */
import type { Arena, SimEvent, TickSnapshot } from '../../sim';
import { displaySeparation } from '../anim/animator';
import { makeCameraArena, wallDistanceAt } from '../camera/geometry';

export type P2 = [number, number];

export type FinishKind = 'stoppage' | 'decision' | 'none';

export interface FinishResult {
  kind: FinishKind;
  /** The bout's result method (`boutEnd.detail.method`). */
  method: string;
  /** Fighter indices; -1 when nobody won (draw, no contest). */
  winner: number;
  loser: number;
  draw: boolean;
  /** Tick of the last recorded frame (the end). */
  endTick: number;
  /** The loser is on the canvas at the end (down, out, or on the ground). */
  loserDown: boolean;
  /** Knocked out cold: stays down longest. */
  ko: boolean;
  /** Tapped or choked: the finish happened on the ground. */
  submission: boolean;
}

/** Index of the fighter with snapshot id `id` in `frame`, else -1. */
function indexOf(frame: TickSnapshot, id: number): number {
  return frame.fighters.findIndex((f) => f.id === id);
}

/**
 * The recorded result, from the last frame and the events. Only for a 1v1
 * bout whose recording ends with the bout (`phase: 'ended'`); null otherwise.
 */
export function finishResult(frames: readonly TickSnapshot[], events: readonly SimEvent[]): FinishResult | null {
  const last = frames[frames.length - 1];
  if (!last || last.phase !== 'ended' || last.fighters.length !== 2) return null;
  let method = '';
  let winnerId = -1;
  let loserId = -1;
  let draw = false;
  let stoppage = false;
  for (const e of events) {
    if (e.tick > last.tick) break;
    switch (e.kind) {
      case 'boutEnd': method = String((e.detail as { method?: string }).method ?? ''); break;
      case 'refereeStoppage': stoppage = true; if (e.target >= 0) winnerId = e.target; break;
      case 'submissionFinish': stoppage = true; if (e.actor >= 0) winnerId = e.actor; break;
      case 'fighterOut': if (e.actor >= 0 && e.tick >= last.tick - 5) loserId = e.actor; break;
      case 'decision': {
        const w = (e.detail as { winner?: number | 'draw' }).winner;
        if (w === 'draw') draw = true;
        else if (typeof w === 'number') winnerId = w;
        break;
      }
      default: break;
    }
  }
  const other = (id: number): number => last.fighters.find((f) => f.id !== id)?.id ?? -1;
  if (winnerId < 0 && loserId >= 0) winnerId = other(loserId);
  if (loserId < 0 && winnerId >= 0) loserId = other(winnerId);
  const m = method.toLowerCase();
  const decision = m.startsWith('decision') || m === 'draw' || draw;
  const noResult = m === 'nocontest' || m === 'separated' || m === 'escaped';
  let kind: FinishKind = decision ? 'decision' : stoppage || m.startsWith('ko') || m.startsWith('tko')
    || m.startsWith('submission') || m === 'dq' ? 'stoppage' : 'none';
  if (noResult) kind = 'none';
  if (kind === 'decision' && draw) { winnerId = -1; loserId = -1; }
  const winner = winnerId >= 0 ? indexOf(last, winnerId) : -1;
  const loser = loserId >= 0 ? indexOf(last, loserId) : -1;
  if (kind === 'stoppage' && (winner < 0 || loser < 0)) kind = 'none';
  const lf = loser >= 0 ? last.fighters[loser] : undefined;
  const loserDown = !!lf && (lf.posture === 'down' || lf.posture === 'out' || lf.posture === 'ground');
  return {
    kind, method, winner, loser, draw: kind === 'decision' && winner < 0, endTick: last.tick, loserDown,
    ko: m === 'ko' || (!!lf && lf.states.includes('state.ko')),
    submission: m.startsWith('submission'),
  };
}

/** A timed interval [from, to] (seconds after the end). */
export type Span = [number, number];

export interface FinishTimeline {
  kind: FinishKind;
  /** Referee waving it off (stoppage). */
  wave: Span | null;
  /** Referee down beside the loser. */
  attend: Span | null;
  /** Winner: walk away, then celebrate at his spot. */
  walkOff: Span;
  celebrate: Span;
  /** Loser: sit up, then stand (null: he never went down). */
  sitUp: Span | null;
  standUp: Span | null;
  /** Loser standing hurt: bent over, hands on his knees. */
  bentOver: Span | null;
  /** The finish replay airs at this post time (stoppages only). */
  replayAt: number | null;
  /** Everyone walks to the centre marks. */
  regroup: Span;
  /** The referee takes the wrists. */
  hold: number;
  /** The winner's arm goes up over [raise, raise + RAISE_S]. */
  raise: number;
  /** A raise at all (no contest: none). */
  raises: boolean;
  /** Camera beats (post time): winner handheld, the wide as they regroup, the announcement (hard camera), the winner close. */
  shots: { celebrate: number; regroup: number; announce: number; winner: number; wide: number };
}

/** How long the raise takes. */
export const RAISE_S = 0.7;

/** The script's timing for a result. Pure. */
export function finishTimeline(r: FinishResult): FinishTimeline {
  if (r.kind === 'stoppage') {
    const regroup: Span = [9.0, 12.4];
    let sitUp: Span | null = null;
    let standUp: Span | null = null;
    let bentOver: Span | null = null;
    if (r.loserDown) {
      if (r.submission) { sitUp = [1.2, 2.8]; standUp = [5.2, 7.0]; }
      else if (r.ko) { sitUp = [4.4, 6.4]; standUp = [8.2, 10.0]; }
      else { sitUp = [2.0, 3.6]; standUp = [6.0, 7.8]; }
    } else {
      bentOver = [0.6, 6.4];
    }
    return {
      kind: 'stoppage', wave: [0, 1.7], attend: [2.0, 9.0], walkOff: [0.9, 3.0], celebrate: [3.0, 8.4],
      sitUp, standUp, bentOver, replayAt: 9.0, regroup, hold: 13.0, raise: 16.0, raises: true,
      shots: { celebrate: 4.0, regroup: 9.0, announce: 13.0, winner: 19.5, wide: 26.5 },
    };
  }
  // Decision, draw, or no result: nobody is hurt.
  return {
    kind: r.kind, wave: null, attend: null, walkOff: [0.6, 2.8], celebrate: [1.0, 4.2],
    sitUp: null, standUp: null, bentOver: null, replayAt: null, regroup: [4.2, 7.6], hold: 8.2,
    raise: 12.0, raises: r.kind === 'decision',
    shots: { celebrate: 1.5, regroup: 4.2, announce: 8.2, winner: 15.5, wide: 22.5 },
  };
}

/** One camera beat of the post-roll: which operator, from when (post seconds), on whom. */
export interface PostShot {
  t: number;
  kind: 'finish' | 'jib' | 'mainTight';
  /** Fighter indices framed ([] = the whole cage). */
  subjects: number[];
}

/**
 * The post-roll edit for a result: the winner's handheld while he celebrates,
 * the wide as everyone walks to the centre, the hard camera tight on the three
 * of them for the announcement and the raise, the winner close, the closing wide.
 */
export function postShots(r: FinishResult, tl: FinishTimeline): PostShot[] {
  const a = r.winner >= 0 ? r.winner : 0;
  const b = r.winner >= 0 ? r.loser : 1;
  const both = [a, b].filter((x) => x >= 0);
  if (tl.kind === 'stoppage') {
    return [
      { t: tl.shots.celebrate, kind: 'finish', subjects: [a] },
      { t: tl.shots.regroup, kind: 'jib', subjects: [] },
      { t: tl.shots.announce, kind: 'mainTight', subjects: both },
      { t: tl.shots.winner, kind: 'finish', subjects: [a] },
      { t: tl.shots.wide, kind: 'jib', subjects: [] },
    ];
  }
  return [
    { t: tl.shots.celebrate, kind: 'jib', subjects: [] },
    { t: tl.shots.announce, kind: 'mainTight', subjects: both },
    ...(tl.raises && r.winner >= 0 ? [{ t: tl.shots.winner, kind: 'finish' as const, subjects: [a] }] : []),
    { t: tl.shots.wide, kind: 'jib', subjects: [] },
  ];
}

// ---------------------------------------------------------------------------
// Where: the ceremony marks and the paths
// ---------------------------------------------------------------------------

/** Centre-to-centre spacing of the three at the announcement (m). */
export const MARK_GAP_M = 0.62;
/** Nobody walks closer than this to the wall (m). */
const WALL_KEEP_M = 1.05;

export interface CeremonyMarks {
  centre: P2;
  /** Facing of all three (toward the hard camera). */
  facing: number;
  /** The referee's right, as a unit floor vector. */
  right: P2;
  /** +1: the winner stands on the referee's right; -1: his left. */
  side: 1 | -1;
  winner: P2;
  loser: P2;
}

/**
 * The centre marks: the referee in the middle facing the hard camera, the
 * winner on the side he is already on (fewest crossings), the loser on the
 * other. For a draw / no result `a` stands on the side of fighter 0.
 */
export function ceremonyMarks(arena: Arena, a0: P2, b0: P2): CeremonyMarks {
  const ca = makeCameraArena(arena, null);
  const facing = ca.mainAzimuth;
  const right: P2 = [-Math.cos(facing), Math.sin(facing)];
  const centre: P2 = [0, 0];
  const proj = (p: P2): number => (p[0] - centre[0]) * right[0] + (p[1] - centre[1]) * right[1];
  const side: 1 | -1 = proj(a0) - proj(b0) >= 0 ? 1 : -1;
  return {
    centre, facing, right, side,
    winner: [centre[0] + right[0] * side * MARK_GAP_M, centre[1] + right[1] * side * MARK_GAP_M],
    loser: [centre[0] - right[0] * side * MARK_GAP_M, centre[1] - right[1] * side * MARK_GAP_M],
  };
}

/** Pull a floor point inside the wall by `keep` (m). */
export function keepInside(arena: Arena, p: P2, keep = WALL_KEEP_M): P2 {
  if (arena.shape === 'unbounded') return p;
  const ca = makeCameraArena(arena, null);
  const r = Math.hypot(p[0], p[1]);
  if (r < 1e-6) return p;
  const max = Math.max(0.5, wallDistanceAt(ca, Math.atan2(p[0], p[1])) - keep);
  return r > max ? [(p[0] / r) * max, (p[1] / r) * max] : p;
}

/**
 * Where the fighters are drawn on the last frame (the animator's display
 * compression applied to the recorded positions), 1v1.
 */
export function displayedEnd(frames: readonly TickSnapshot[]): [P2, P2] | null {
  const last = frames[frames.length - 1];
  if (!last || last.fighters.length !== 2) return null;
  const a = last.fighters[0]!;
  const b = last.fighters[1]!;
  return displayedPair([a.x, a.z], [b.x, b.z]);
}

/** Where a 1v1 pair recorded at `a`, `b` is drawn (the animator's display compression). */
export function displayedPair(a: P2, b: P2): [P2, P2] {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d < 1e-4) return [[a[0], a[1]], [b[0], b[1]]];
  const dd = displaySeparation(d);
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;
  const ux = (b[0] - a[0]) / d;
  const uz = (b[1] - a[1]) / d;
  return [[mx - (ux * dd) / 2, mz - (uz * dd) / 2], [mx + (ux * dd) / 2, mz + (uz * dd) / 2]];
}

/** Recorded centre distance the referee's break opens a clinch to (m). */
export const CLINCH_BREAK_M = 1.35;
/** When the break starts and how long it takes (post seconds). */
export const CLINCH_BREAK_S: [number, number] = [0.1, 0.55];

/**
 * A bout that ends with the pair tied up standing (a TKO against the fence, the
 * bell in a clinch): the recorded positions, the unit direction from the first
 * fighter to the second and how far each steps back.
 */
export interface ClinchEnd {
  a0: P2;
  b0: P2;
  dir: P2;
  /** How far each fighter steps back (recorded metres). */
  half: number;
}

export function clinchEnd(frames: readonly TickSnapshot[]): ClinchEnd | null {
  const last = frames[frames.length - 1];
  if (!last || last.fighters.length !== 2) return null;
  const e = last.engagements.find((x) => x.kind !== 'knockdown' && x.b >= 0);
  if (!e || e.kind === 'ground') return null;
  const fa = last.fighters[0]!;
  const fb = last.fighters[1]!;
  const up = (p: string): boolean => p === 'clinch' || p === 'standing' || p === 'out';
  if (!up(fa.posture) || !up(fb.posture)) return null;
  let dx = fb.x - fa.x;
  let dz = fb.z - fa.z;
  let d = Math.hypot(dx, dz);
  if (d < 1e-3) { dx = Math.sin(e.rootYaw); dz = Math.cos(e.rootYaw); d = 0; }
  const n = Math.hypot(dx, dz) || 1;
  return { a0: [fa.x, fa.z], b0: [fb.x, fb.z], dir: [dx / n, dz / n], half: Math.max(0, (CLINCH_BREAK_M - d) / 2) };
}

/** The pair's recorded positions `t` post seconds into a clinch break (pure). */
export function clinchBreakAt(c: ClinchEnd, t: number): [P2, P2] {
  const e = smooth((t - CLINCH_BREAK_S[0]) / CLINCH_BREAK_S[1]) * c.half;
  return [
    [c.a0[0] - c.dir[0] * e, c.a0[1] - c.dir[1] * e],
    [c.b0[0] + c.dir[0] * e, c.b0[1] + c.dir[1] * e],
  ];
}

/** The winner's celebration spot: away from the loser, toward open canvas, clear of the wall. */
export function celebrationSpot(arena: Arena, winner0: P2, loser0: P2, marks: CeremonyMarks): P2 {
  let dx = winner0[0] - loser0[0];
  let dz = winner0[1] - loser0[1];
  let d = Math.hypot(dx, dz);
  if (d < 1e-3) { dx = marks.right[0] * marks.side; dz = marks.right[1] * marks.side; d = 1; }
  // Away from the loser, bent toward the winner's own side of the cage (where his mark is).
  const ux = dx / d * 0.7 + marks.right[0] * marks.side * 0.3;
  const uz = dz / d * 0.7 + marks.right[1] * marks.side * 0.3;
  const n = Math.hypot(ux, uz) || 1;
  return keepInside(arena, [winner0[0] + (ux / n) * 2.1, winner0[1] + (uz / n) * 2.1]);
}

// ---------------------------------------------------------------------------
// Paths: eased legs with the distance walked (drives the gait) and a facing
// ---------------------------------------------------------------------------

export interface Leg {
  t0: number;
  t1: number;
  from: P2;
  to: P2;
  /** Facing before setting off and after arriving. */
  face0: number;
  face1: number;
}

export interface PathSample {
  x: number;
  z: number;
  facing: number;
  /** Distance walked since the path began (m). */
  walked: number;
  /** Speed now (m/s). */
  speed: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (t: number): number => { const x = clamp01(t); return x * x * (3 - 2 * x); };
export const angleLerp = (a: number, b: number, t: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** Sample a sequence of legs at time `t` (before the first: at its start; after the last: at its end). */
export function samplePath(legs: readonly Leg[], t: number): PathSample {
  let walked = 0;
  const first = legs[0];
  if (!first) return { x: 0, z: 0, facing: 0, walked: 0, speed: 0 };
  if (t <= first.t0) return { x: first.from[0], z: first.from[1], facing: first.face0, walked: 0, speed: 0 };
  for (let i = 0; i < legs.length; i++) {
    const g = legs[i]!;
    const len = Math.hypot(g.to[0] - g.from[0], g.to[1] - g.from[1]);
    const dur = Math.max(1e-3, g.t1 - g.t0);
    const next = legs[i + 1];
    if (t <= g.t1) {
      const u = clamp01((t - g.t0) / dur);
      const e = smooth(u);
      const heading = len > 0.05 ? Math.atan2(g.to[0] - g.from[0], g.to[1] - g.from[1]) : g.face1;
      let facing = angleLerp(g.face0, heading, smooth((t - g.t0) / Math.min(0.45, dur * 0.4)));
      facing = angleLerp(facing, g.face1, smooth((t - (g.t1 - Math.min(0.5, dur * 0.35))) / Math.min(0.6, dur * 0.45)));
      return {
        x: g.from[0] + (g.to[0] - g.from[0]) * e,
        z: g.from[1] + (g.to[1] - g.from[1]) * e,
        facing,
        walked: walked + len * e,
        speed: (len * 6 * u * (1 - u)) / dur,
      };
    }
    walked += len;
    if (!next || t < next.t0) {
      return { x: g.to[0], z: g.to[1], facing: g.face1, walked, speed: 0 };
    }
  }
  const lastLeg = legs[legs.length - 1]!;
  return { x: lastLeg.to[0], z: lastLeg.to[1], facing: lastLeg.face1, walked, speed: 0 };
}

const toward = (a: P2, b: P2): number => Math.atan2(b[0] - a[0], b[1] - a[1]);
export { toward };

/**
 * Keep walkers apart: a pure projection over floor points (moving ones yield
 * to fixed ones, equal ones split the difference). `r` is the minimum
 * centre distance per pair. Returns adjusted copies.
 */
export function separatePoints(pts: readonly P2[], fixed: readonly boolean[], r: number, obstacles: readonly { p: P2; r: number }[] = []): P2[] {
  const out = pts.map((p) => [p[0], p[1]] as P2);
  for (let it = 0; it < 4; it++) {
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        let d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d < 1e-6) { dx = 1; dz = 0; d = 1e-6; }
        const need = r - d;
        const fa = fixed[i] ? 0 : fixed[j] ? 1 : 0.5;
        const fb = fixed[j] ? 0 : fixed[i] ? 1 : 0.5;
        a[0] -= (dx / d) * need * fa; a[1] -= (dz / d) * need * fa;
        b[0] += (dx / d) * need * fb; b[1] += (dz / d) * need * fb;
      }
      if (fixed[i]) continue;
      for (const o of obstacles) {
        const a = out[i]!;
        const dx = a[0] - o.p[0];
        const dz = a[1] - o.p[1];
        const d = Math.hypot(dx, dz);
        if (d >= o.r || d < 1e-6) continue;
        a[0] += (dx / d) * (o.r - d); a[1] += (dz / d) * (o.r - d);
      }
    }
  }
  return out;
}
