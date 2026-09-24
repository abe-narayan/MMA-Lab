/**
 * THE BROADCAST CAMERA DIRECTOR (docs/design/08 §7).
 *
 * Two halves:
 *
 *  - **The edit** (`planner.ts`): which camera is on air, decided once per
 *    bout from the recording, so cuts are deterministic, seek-proof, and can
 *    look ahead to keep clear of every punch.
 *  - **The operators** (this file): each frame, the on-air camera is pointed
 *    and zoomed the way its operator would — critically damped pans, zooms
 *    that open quickly and close slowly, a level horizon, a little handheld
 *    float at the fence, a jolt on a heavy landed shot — framing the bodies'
 *    real joint positions (`WorldPose`) inside a title-safe area.
 *
 * Instant replays (`replay.ts`) and the user modes (follow, orbit, free,
 * locked cageside/overhead) run through the same operator code.
 *
 * Determinism: shot choice is a pure function of the recording and the
 * cosmetic seed; camera motion integrates over *simulated* time (so a slow-mo
 * replay moves like slowed footage) and every filter snaps on a
 * discontinuity. Nothing here touches the sim.
 */
import { resolveRuleset, type RulesetId, type SimEvent, type TickSnapshot } from '../../sim';
import type {
  ArenaSet, BoutPresentation, CameraDirector, CameraRequest, CameraState, FrameInput,
} from '../contract';
import { B, type WorldPose } from '../rig/skeleton';
import { type CameraArena, clampToBounds, insideWall, makeCameraArena, postAzimuths, wallDistanceAt } from './geometry';
import {
  AVOID, bodyCapsules, cageCapsules, type Capsule, CORNER_AVOID, cornerSamples, fighterCapsules, inflateCapsules, OCCLUSION_LIMIT, occlusion,
  type SamplePoint, subjectSamples,
} from './occlusion';

/** The dodge's thresholds for the broadcast shots (`AVOID`). */
const DODGE_DEFAULT = { limit: OCCLUSION_LIMIT, clearTo: AVOID.clearTo, homeBelow: AVOID.homeBelow } as const;

/**
 * The between-rounds corner handheld's dodge candidates (offsets from the home
 * spot at `base + side`): along the home side first, then the same spots about
 * the fighter's other side (`-2·side`), where the cornerman who works beside
 * him usually is not.
 */
export function cornerCandidates(side: number): readonly (readonly [number, number])[] {
  let out = cornerCandidateCache.get(side);
  if (!out) {
    const list: (readonly [number, number])[] = CORNER_AVOID.offsets.map(([a, h]) => [a, h] as const);
    list.push([-2 * side, 0]);
    for (const [a, h] of CORNER_AVOID.offsets) list.push([-2 * side + a, h]);
    cornerCandidateCache.set(side, (out = list));
  }
  return out;
}
const cornerCandidateCache = new Map<number, readonly (readonly [number, number])[]>();
/** Before pass 2 (QA `cornerAvoid = false`): the broadcast handheld's walk, narrowed. */
const OLD_CORNER_CANDIDATES = AVOID.handheldAzimuths.map((x) => [x * 0.7, 0] as const);
import { type FramingGoal, fovToTanHalf, lookBasis, requiredTanHalf, solveFraming, tanHalfToFov } from './framing';
import {
  type FighterPoints, type FramingSet, fighterPointsInto, framingPoints, pairMid,
} from './keypoints';
import {
  add, atAzimuth, clamp, dist, distXZ, easeInOut, hashString, lerp, lerpV, norm, scale, smoothNoise, wrapAngle,
  Spring1, Spring3, sub, type V3,
} from './math';
import {
  type BlockedCut, chooseOperator, cornerAzimuth, entryAt, focusGroup, planShots, type ShotPlan, type ShotPlanEntry, ShotPlanner, StrikeIndex, TICK_S,
} from './planner';
import type { ReplayState } from './replay';
import { PLACEMENT, SHOTS, type ShotKind, shotLabel } from './shots';
import { createFreeCameraState, type FreeCameraState, freeCameraPose } from './freeCamera';

/** Where the camera wants to be this frame, before smoothing. */
interface Goal {
  pos: V3;
  target: V3;
  tanHalf: number;
  /** Points the safety clamp keeps inside the frame (empty = no clamp). */
  keep: V3[];
  /** Fraction of the frame the clamp allows `keep` to fill. */
  keepSafe: number;
  focus: V3 | null;
  /** Lens position spring; Infinity = locked to the goal. */
  posOmega: number;
  allowInside: boolean;
  /** Push-in multiplier on the lens (replays), 1 = none. */
  zoomMul: number;
  /** Zoom-in spring override (rad/s): the knockdown push-in is quicker than a drift. */
  zoomIn?: number;
}

export interface DirectorDebug {
  shot: ShotKind;
  label: string;
  source: 'plan' | 'replay' | 'user' | 'locked';
  entryIndex: number;
  reason: string;
  /** Seconds the current shot has been on air. */
  shotSeconds: number;
  /** Effective timeline time (simulated seconds, extended through the pre/post-roll). */
  timeline: number;
  /** A cut the rules are holding back right now, if any. */
  blocked: string | null;
  /** Share of the subject hidden (referee / other fighter) from the lens this frame. */
  occlusion: number;
  /** The operator's current dodge: handheld azimuth offset (rad) or hard-camera slide/boom (m). */
  avoid: [number, number];
  /** Fighters the shot on air is about (empty = everyone), for QA tools. */
  subjects: readonly number[];
  /** Strike shake applied this frame (fraction of the half height; 0 = none). */
  shake: number;
  /** The operator's aim before the handheld float and the shake (QA: motion is judged on it). */
  aim: V3;
}

const DEFAULT_ASPECT = 16 / 9;
const NO_POINTS: V3[] = [];
const NO_FIGHTERS: FighterPoints[] = [];
/** Closest an in-cage lens comes to a body's surface (m). */
const BODY_CLEAR_M = 0.55;
/** Closest a lens outside the cage comes to a post's centre (m): pad half width + lens + margin. */
const POST_CLEAR_M = 0.55;
/** Tightest frame height (m) at the subject for ground work, per shot (camera polish pass). */
const GROUND_MIN_FRAME_M: Partial<Record<ShotKind, number>> = { main: 1.9, reverse: 1.9, overhead: 2.2 };
/** Post-fight handheld: directions (rad) tried round the winner's facing, nearest first. */
const FINISH_TURNS = [0.45, -0.45, 0.8, -0.8, 0, 1.2, -1.2, 1.6, -1.6, 2.1, -2.1, 2.6, -2.6];
/** Follow camera: swings (rad) tried round the fighter to keep the lens inside the cage. */
const FOLLOW_TURNS = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, 2.4, -2.4, Math.PI];
const NO_BIAS: [number, number] = [0, 0];
/** Dodge-key family of a hard-camera goal: live edit vs replay. */
const source = (e: ShotPlanEntry, seg: unknown): string => (seg ? `replay:${e.startTick}` : 'live');

/** The last held-back cut at or before `tick` (within 12 ticks), by binary search. */
function lastBlockedBefore(bl: readonly BlockedCut[], tick: number): BlockedCut | null {
  let lo = 0;
  let hi = bl.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (bl[m]!.tick <= tick) lo = m + 1;
    else hi = m;
  }
  const x = lo > 0 ? bl[lo - 1]! : null;
  return x && x.tick > tick - 12 ? x : null;
}

/**
 * Operator behaviour added in the camera polish pass (docs/design/PHASE8_NOTES.md,
 * "Camera polish pass").
 *
 *  - *Predictive framing.* With the recording the director knows where the
 *    fighters will be. Each fighter's framing points are shifted by the
 *    difference between a centred average of his recorded position around
 *    `now + lead` and his position now: the average removes the per-tick sim
 *    wobble without lag, and the lead (a share of the aim spring's own lag,
 *    2/ω) makes the lens arrive with the action instead of behind it.
 *  - *Dead zones.* The spring goal only moves when the subjects' framing leaves
 *    a small zone around the held aim (a fraction of the frame half height) or
 *    the needed zoom leaves a band around the held zoom (log units; tighter for
 *    zooming out than in). Small limb motion no longer steers the lens.
 *  - *Hard-camera zooms.* MAIN ↔ MAIN TIGHT is the same operator on the same
 *    platform: it is played as a ~1 s zoom and re-aim, not a cut.
 */
export const OPERATOR = {
  /** Lead as a share of the aim spring's ramp lag (2/ω), capped (s). */
  leadShare: 0.8,
  leadMaxS: 0.8,
  /** Half width of the centred average (s) and its sample count. */
  smoothHalfS: 0.5,
  smoothSamples: 5,
  /** Largest predictive shift of a fighter's points (m). */
  maxShiftM: 1.6,
  /** Aim dead zone, fraction of the frame half height (wide shots / tight and handheld shots). */
  aimDeadZone: 0.05,
  aimDeadZoneTight: 0.09,
  /** Zoom dead band (ln tan): opening up / closing in. */
  zoomDeadOut: 0.025,
  zoomDeadIn: 0.08,
  /** Hard-camera zoom between MAIN and MAIN TIGHT: duration (s) and springs (rad/s). */
  zoomTransitionS: 1.1,
  zoomTransitionAim: 3.4,
  zoomTransitionZoom: 3.0,
} as const;

/** Rough height (m) of a fighter's mass for the prediction, by posture. */
const postureY = (p: string, role?: string): number =>
  p === 'standing' || p === 'clinch' ? 1.15 : p === 'ground' ? (role === 'bottom' ? 0.2 : 0.55) : 0.2;
/** A heavy landed shot shakes the frame by at most this fraction of its half height. */
const SHAKE_MAX_NDC = 0.022;

export interface BroadcastDirectorOptions {
  aspect?: number;
}

export class BroadcastCameraDirector implements CameraDirector {
  private bout: BoutPresentation | null = null;
  private ca: CameraArena | null = null;
  private seed = 'bout';
  private breakSeconds = 60;
  private statures: number[] = [];
  private aspect = DEFAULT_ASPECT;
  private request: CameraRequest = { mode: 'broadcast' };
  private locked: ShotKind | null = null;

  // Recording and plan
  private frames: readonly TickSnapshot[] | null = null;
  private events: readonly SimEvent[] = [];
  private strikeEvents: SimEvent[] = [];
  private shotPlan: ShotPlan | null = null;
  private online: { planner: ShotPlanner; strikes: StrikeIndex; lastTick: number; view: ShotPlan } | null = null;

  // Replay
  private replay: ReplayState | null = null;
  private replayEntry: { key: string; entry: ShotPlanEntry } | null = null;

  // Smoothing state
  private readonly posS = new Spring3();
  private readonly aimS = new Spring3();
  private readonly tanS = new Spring1();
  private readonly midS = new Spring3();
  private lastKey = '';
  private lastSimTime = NaN;
  private holdClock = 0;
  private shotStartTimeline = 0;
  private manual: ShotPlanEntry | null = null;
  private handheldH: number | null = null;
  private lastState: CameraState | null = null;
  private dbg: DirectorDebug = {
    shot: 'main', label: 'MAIN', source: 'plan', entryIndex: -1, reason: '', shotSeconds: 0, timeline: 0, blocked: null,
    occlusion: 0, avoid: [0, 0], subjects: [], shake: 0, aim: [0, 0, 0],
  };

  // The referee (an occluder the operators work around) and the dodge state.
  private refereePose: WorldPose | null = null;
  private readonly avoidA = new Spring1();
  private readonly avoidB = new Spring1();
  private avoidTarget: [number, number] = [0, 0];
  private avoidKey = '';
  private lastOcclusion = 0;
  /** Post-fight handheld: direction from the winner, chosen when the shot starts. */
  private finishDir = 0;
  private finishKey = '';

  // Camera polish pass: cage occluders, held (dead-zoned) goals, the hard-camera
  // zoom transition, the multi-fighter focus, and per-frame scratch.
  private cageCaps: Capsule[] = [];
  /** Post centres (x, z) the apron operators walk round, and their azimuths. */
  private posts: [number, number][] = [];
  private postAz: number[] = [];

  /**
   * Push `q` (in place, horizontally) until it is `BODY_CLEAR_M` from every
   * fighter's torso and head and from the referee's and cornermen's bodies.
   */
  private clearOfBodies(q: V3, fighters: readonly FighterPoints[]): void {
    const push = (a: V3, b: V3, r: number): void => {
      const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
      const l = abx * abx + aby * aby + abz * abz;
      const t = l > 0 ? clamp(((q[0] - a[0]) * abx + (q[1] - a[1]) * aby + (q[2] - a[2]) * abz) / l, 0, 1) : 0;
      const cx = a[0] + abx * t, cy = a[1] + aby * t, cz = a[2] + abz * t;
      const dx = q[0] - cx, dz = q[2] - cz;
      const need = r + BODY_CLEAR_M;
      const d3 = Math.hypot(dx, q[1] - cy, dz);
      if (d3 >= need) return;
      const dh = Math.hypot(dx, dz);
      // Straight out horizontally (away from the body's axis; toward the cage centre if on it).
      const ux = dh > 1e-4 ? dx / dh : -cx / (Math.hypot(cx, cz) || 1);
      const uz = dh > 1e-4 ? dz / dh : -cz / (Math.hypot(cx, cz) || 1);
      const dy = q[1] - cy;
      const h = Math.sqrt(Math.max(0, need * need - dy * dy));
      q[0] = cx + ux * h;
      q[2] = cz + uz * h;
    };
    for (let pass = 0; pass < 2; pass++) {
      for (const f of fighters) {
        push(f.hips, f.neck, 0.2);
        push(f.head, f.crown, 0.13);
      }
      if (this.bodyCapsDirty) this.sight(NO_FIGHTERS, NO_FIGHTERS, false);
      for (const c of this.bodyCaps) push(c.a, c.b, c.r);
    }
  }

  /** `az` limited to the stretch of apron between the two posts either side of `home`. */
  private withinPanel(home: number, az: number): number {
    const posts = this.postAz;
    if (posts.length < 2) return az;
    const n = posts.length;
    const step = (2 * Math.PI) / n;
    // Posts are evenly spaced from posts[0]: the panel `home` lies in.
    const rel = wrapAngle(home - posts[0]!);
    const k = Math.floor((rel < 0 ? rel + 2 * Math.PI : rel) / step);
    const lo = posts[0]! + k * step;
    const r = this.ca ? this.ca.circumradius + 0.4 : 5;
    const m = Math.min(step * 0.45, (POST_CLEAR_M + 0.15) / r);
    const d = wrapAngle(az - lo);
    const dd = d < 0 ? d + 2 * Math.PI : d;
    return lo + clamp(dd, m, step - m);
  }

  /** An apron lens kept `POST_CLEAR_M` from every post (an operator walks round it). */
  private clearOfPosts(q: V3): V3 {
    for (const [px, pz] of this.posts) {
      const dx = q[0] - px;
      const dz = q[2] - pz;
      const d = Math.hypot(dx, dz);
      if (d < POST_CLEAR_M) {
        // Straight out from the post (radially outward if exactly on it).
        const r = Math.hypot(px, pz) || 1;
        const ux = d > 1e-4 ? dx / d : px / r;
        const uz = d > 1e-4 ? dz / d : pz / r;
        q[0] = px + ux * POST_CLEAR_M;
        q[2] = pz + uz * POST_CLEAR_M;
      }
    }
    return q;
  }
  private readonly followAz = new Spring1();
  private followKey = '';
  private readonly heldAim: V3 = [0, 0, 0];
  private heldTan = 0;
  private lastKind: ShotKind | null = null;
  private lastSource: DirectorDebug['source'] = 'plan';
  private zoomUntil = -Infinity;
  private readonly pointPool: FighterPoints[] = [];
  private readonly ptsBuf: FighterPoints[] = [];
  private readonly liveBuf: FighterPoints[] = [];
  private readonly focusBuf: FighterPoints[] = [];
  /** Per-fighter predictive shift (x, y, z) by index in `frame.fighters`. */
  private shift = new Float64Array(12);
  private shiftOn = false;
  private readonly sightOut: { samples: SamplePoint[]; occluders: Capsule[] } = { samples: [], occluders: [] };
  /** The corner handheld's sight (people inflated by `CORNER_AVOID.margin`); reused. */
  private readonly cornerSight: { samples: SamplePoint[]; occluders: Capsule[]; samplesAt?: (lens: V3) => SamplePoint[] } = { samples: [], occluders: [] };
  private readonly cornerCaps: Capsule[] = [];
  /** QA (perf-compare-shots.mjs --ab corner): false = the corner handheld stays home, as before pass 2. */
  cornerAvoid = true;
  private readonly fgoal: FramingGoal = { target: [0, 0, 0], tanHalf: 0 };
  private focusCache: { tick: number; ids: number[] | null } = { tick: -1, ids: null };

  /** User camera (free / orbit), manipulated by `FreeCameraController`. */
  readonly free: FreeCameraState = createFreeCameraState();

  constructor(opts: BroadcastDirectorOptions = {}) {
    if (opts.aspect) this.aspect = opts.aspect;
  }

  // ---- configuration ------------------------------------------------------

  setBout(bout: BoutPresentation, arena: ArenaSet | null): void {
    this.bout = bout;
    this.ca = makeCameraArena(bout.arena, arena?.bounds ?? null);
    this.cageCaps = cageCapsules(this.ca, postAzimuths(this.ca));
    const pr = this.ca.circumradius + 0.05;
    this.postAz = this.ca.shape === 'unbounded' || this.ca.wallHeight <= 0 ? [] : postAzimuths(this.ca);
    this.posts = this.postAz.map((a) => [Math.sin(a) * pr, Math.cos(a) * pr] as [number, number]);
    this.seed = bout.cosmeticSeed;
    this.statures = bout.runtimes.map((r) => r.body?.heightM ?? 1.8);
    try {
      this.breakSeconds = resolveRuleset(bout.rulesetId as RulesetId).rounds.breakS;
    } catch {
      this.breakSeconds = 60;
    }
    this.shotPlan = null;
    this.online = null;
    if (this.frames) this.buildPlan();
    this.reset();
  }

  /**
   * Hand the director the whole recording (the Watch screen always has it).
   * Without it the director plans live from the frames it is shown.
   */
  setRecording(frames: readonly TickSnapshot[], events: readonly SimEvent[]): void {
    this.frames = frames;
    this.events = events;
    this.strikeEvents = events.filter((e) => e.kind === 'strike' || e.kind === 'slam' || e.kind === 'knockdown');
    this.online = null;
    if (this.ca) this.buildPlan();
    this.reset();
  }

  setRequest(req: CameraRequest): void {
    if (req.mode !== this.request.mode || req.followId !== this.request.followId) {
      if ((req.mode === 'free' || req.mode === 'orbit') && this.lastState) {
        this.free.initFrom(this.lastState, req.mode);
      }
      this.manual = null;
    }
    this.request = { ...req };
  }

  /** Viewport width / height; framing needs it for the horizontal extent. */
  setAspect(aspect: number): void {
    if (Number.isFinite(aspect) && aspect > 0.2) this.aspect = aspect;
  }

  /** The replay being shown (from `ReplaySequencer.state`), or null for live. */
  setReplay(state: ReplayState | null): void {
    this.replay = state;
  }

  /**
   * The referee's posed body this frame (null: none on the floor). The
   * operators treat him as an occluder: a handheld walks the apron, the hard
   * camera slides along its platform or booms up, until he hides no more than
   * `OCCLUSION_LIMIT` of the fighters they are shooting.
   */
  setReferee(pose: WorldPose | null): void {
    this.refereePose = pose;
    this.bodyCapsDirty = true;
  }

  /**
   * The post-fight staging's clock (seconds of live picture since the end,
   * `finish/FinishStage.postTime`), or null. While set, the post-roll plan
   * (the winner, the wide as they regroup, the announcement) follows it.
   */
  setPostClock(t: number | null): void {
    this.postClock = t;
  }

  /** Other people in the cage the operators work around (the cornermen between rounds). */
  setExtraBodies(poses: readonly WorldPose[]): void {
    this.extraBodies = poses;
    this.bodyCapsDirty = true;
  }
  /** The referee's and cornermen's capsules, rebuilt once per frame they are set. */
  private bodyCaps: Capsule[] = [];
  private bodyCapsDirty = true;
  private extraBodies: readonly WorldPose[] = [];
  private postClock: number | null = null;

  /** Force one shot kind in broadcast mode (dev tools, tests); null to release. */
  lockShot(kind: ShotKind | null): void {
    this.locked = kind;
    this.manual = null;
  }

  get plan(): ShotPlan | null {
    return this.shotPlan ?? this.onlinePlan;
  }

  /** The live plan's view (one object, updated in place). */
  private get onlinePlan(): ShotPlan | null {
    const on = this.online;
    if (!on) return null;
    on.view.lastTick = on.lastTick;
    return on.view;
  }

  debug(): DirectorDebug {
    return this.dbg;
  }

  reset(): void {
    this.avoidKey = '';
    this.finishKey = '';
    this.lastKey = '';
    this.lastSimTime = NaN;
    this.holdClock = 0;
    this.manual = null;
    this.replayEntry = null;
    this.lastKind = null;
    this.zoomUntil = -Infinity;
    this.focusCache.tick = -1;
  }

  private buildPlan(): void {
    if (!this.frames || !this.ca) return;
    this.shotPlan = planShots(this.frames, this.events, { arena: this.ca, seed: this.seed, breakSeconds: this.breakSeconds });
  }

  // ---- per frame -----------------------------------------------------------

  update(input: FrameInput, poses: readonly WorldPose[], realDt: number): CameraState {
    const ca = this.ca ?? (this.ca = makeCameraArena({
      id: 'octagon_30', name: '', shape: 'polygon', sides: 8, apothemM: 4.57, wall: 'fence',
      surface: 'canvas', surfaceHardness: 1, outOfBounds: 'clamp',
    }));
    const frame = input.frame;
    // The referee's and cornermen's poses are live objects: re-read them once this frame.
    this.bodyCapsDirty = true;
    let snap = input.discontinuity || !Number.isFinite(this.lastSimTime);
    if (input.discontinuity) this.holdClock = 0;

    // Pre-roll / post-roll: while the playhead rests on the first or last
    // frame the broadcast keeps going (the intro jib, the winner, the wide).
    const firstTick = this.frames?.[0]?.tick ?? 0;
    const lastTick = this.frames?.[this.frames.length - 1]?.tick ?? Infinity;
    const atFirst = frame.tick <= firstTick && (!input.next || input.alpha < 1e-6) && !input.replay;
    const atLast = frame.tick >= lastTick && !input.replay;
    const holding = atFirst || atLast;
    const simDt = snap ? 0 : input.simTime - this.lastSimTime;
    this.lastSimTime = input.simTime;
    if (holding) this.holdClock += Math.max(0, realDt);
    else this.holdClock = 0;
    // The post-fight staging (`finish/`) keeps its own post clock (it pauses
    // through the finish replay instead of restarting), so the post-roll edit
    // cuts on its beats; without one, the hold clock.
    const post = atLast && this.postClock !== null ? this.postClock : this.holdClock;
    const timeline = atLast ? input.simTime + post : atFirst ? this.holdClock : input.simTime;
    const dt = holding ? clamp(realDt, 0, 0.25) : clamp(simDt, 0, 0.25);

    // Bodies (pooled: no per-frame allocation of the framing points).
    const pts = fighterPointsInto(frame, input.next, input.alpha, poses, this.statures, this.pointPool, this.ptsBuf);
    const liveAll = this.liveBuf;
    liveAll.length = 0;
    for (const p of pts) if (p.posture !== 'out') liveAll.push(p);
    // Multi-fighter bouts: the lens frames the fight that matters (the primary
    // engaged pair and anyone close to it), not all four corners of the cage.
    const focusIds = this.focusGroup(frame, input);
    const framedAll = this.focusBuf;
    framedAll.length = 0;
    for (const p of liveAll.length ? liveAll : pts) if (!focusIds || focusIds.includes(p.id)) framedAll.push(p);
    const mid = pairMid(framedAll.length ? framedAll : pts);

    // Which camera is on air.
    const mode = this.request.mode;
    let entry: ShotPlanEntry;
    let key: string;
    let source: DirectorDebug['source'] = 'plan';
    let entryIndex = -1;
    let shotT: number;
    let replaySeg: ReplayState['segment'] | null = null;

    if (mode === 'free' || mode === 'orbit' || mode === 'follow') {
      entry = this.userEntry(mode);
      key = `user:${mode}:${this.request.followId ?? 0}`;
      source = 'user';
      shotT = timeline;
    } else if (input.replay && this.replay) {
      const r = this.replay;
      replaySeg = r.segment;
      const rk = `replay:${r.plan.id}:${r.segmentIndex}`;
      if (!this.replayEntry || this.replayEntry.key !== rk) {
        this.replayEntry = { key: rk, entry: this.replayShot(r, ca) };
      }
      entry = this.replayEntry.entry;
      key = rk;
      source = 'replay';
      shotT = input.simTime - r.segment.fromTick * TICK_S;
    } else if (mode === 'cageside' || mode === 'overhead' || this.locked) {
      const kind: ShotKind = this.locked ?? (mode === 'overhead' ? 'overhead' : 'cageside');
      if (!this.manual || this.manual.kind !== kind || this.needsReposition(this.manual, this.midS.x, input)) {
        this.manual = this.makeEntry(kind, frame, input.simTime, this.manual ? 'reposition' : 'situation');
      }
      entry = this.manual;
      key = `locked:${kind}:${this.manual.startT}:${this.manual.azimuth}`;
      source = 'locked';
      shotT = timeline - this.manual.startT;
    } else {
      const plan = this.currentPlan(input);
      const idx = atFirst && plan.entries[0]?.reason === 'intro' ? 0 : entryAt(plan, timeline);
      entry = plan.entries[Math.max(0, idx)] ?? this.makeEntry('main', frame, 0, 'situation');
      entryIndex = idx;
      key = `plan:${idx}:${entry.startTick}`;
      shotT = entry.reason === 'intro' && atFirst ? this.holdClock : timeline - entry.startT;
    }

    const kind = entry.kind;
    const spec = SHOTS[kind];
    let cut = snap || key !== this.lastKey;
    // MAIN <-> MAIN TIGHT on the edit: the same operator zooms and re-aims.
    const hard = (k: ShotKind | null): boolean => k === 'main' || k === 'mainTight';
    if (cut && !snap && !holding && source === 'plan' && this.lastSource === 'plan' && hard(kind) && hard(this.lastKind) && kind !== this.lastKind) {
      cut = false;
      this.zoomUntil = timeline + OPERATOR.zoomTransitionS;
    }
    if (cut) {
      snap = true;
      this.zoomUntil = -Infinity;
      this.handheldH = null;
    }
    if (key !== this.lastKey) this.shotStartTimeline = timeline;
    this.lastKey = key;
    this.lastKind = kind;
    this.lastSource = source;

    // Where the fighters are about to be (recorded bouts and replays).
    const predict = !holding && this.frames !== null && kind !== 'jib' && kind !== 'free' && kind !== 'orbit';
    this.shiftOn = predict && this.predictShift(frame, input.simTime, spec.aimOmega);
    let mx = mid[0];
    let mz = mid[2];
    if (this.shiftOn) {
      let sx = 0;
      let sz = 0;
      let n = 0;
      for (const p of framedAll) {
        const i = this.indexOf(frame, p.id);
        if (i < 0) continue;
        sx += this.shift[i * 3]!; sz += this.shift[i * 3 + 2]!; n++;
      }
      if (n) { mx += sx / n; mz += sz / n; }
    }
    const midGoal: V3 = [mx, 0, mz];
    if (snap) this.midS.reset(midGoal);
    const midSm = this.midS.step(midGoal, 3, dt);

    const goal = this.goal(kind, entry, ca, pts, framedAll, midSm, shotT, replaySeg, input, dt, snap, key, poses);

    // Dead zones: the goal the springs chase moves only when the framing
    // leaves a small zone around what the operator is already holding.
    // A fighter right against the lens (a point behind it) must not poison the springs.
    const tanCap = fovToTanHalf(spec.fovMax);
    const goalTan = Number.isFinite(goal.tanHalf * goal.zoomMul) ? goal.tanHalf * goal.zoomMul : tanCap;
    const deadZoned = kind !== 'jib' && kind !== 'free' && kind !== 'orbit';
    if (snap || !deadZoned || this.heldTan <= 0) {
      this.heldAim[0] = goal.target[0]; this.heldAim[1] = goal.target[1]; this.heldAim[2] = goal.target[2];
      this.heldTan = goalTan;
    } else {
      const ox = goal.target[0] - this.heldAim[0];
      const oy = goal.target[1] - this.heldAim[1];
      const oz = goal.target[2] - this.heldAim[2];
      const ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const depth = Math.max(0.5, dist(goal.pos, goal.target));
      const r = (spec.handheldDeg > 0.1 || kind === 'mainTight' || kind === 'follow' ? OPERATOR.aimDeadZoneTight : OPERATOR.aimDeadZone)
        * this.tanS.x * depth;
      if (ol > r) {
        const k = 1 - r / ol;
        this.heldAim[0] += ox * k; this.heldAim[1] += oy * k; this.heldAim[2] += oz * k;
      }
      const lr = Math.log(goalTan / this.heldTan);
      if (lr > OPERATOR.zoomDeadOut) this.heldTan *= Math.exp(lr - OPERATOR.zoomDeadOut);
      else if (lr < -OPERATOR.zoomDeadIn) this.heldTan *= Math.exp(lr + OPERATOR.zoomDeadIn);
    }

    // Smooth like an operator.
    if (snap) {
      this.posS.reset(goal.pos);
      this.aimS.reset(this.heldAim);
      this.tanS.reset(this.heldTan);
    }
    const easing = timeline < this.zoomUntil;
    const aimOmega = easing ? Math.max(spec.aimOmega, OPERATOR.zoomTransitionAim) : spec.aimOmega;
    const pos: V3 = [0, 0, 0];
    if (goal.posOmega === Infinity) this.posS.reset(goal.pos);
    else this.posS.step(goal.pos, goal.posOmega, dt);
    pos[0] = this.posS.x[0]; pos[1] = this.posS.x[1]; pos[2] = this.posS.x[2];
    // A lens walking the apron goes round a post, not through it (the
    // spring's straight line between two spots can cut the corner).
    if (!goal.allowInside && pos[1] < ca.wallHeight + 0.4) this.clearOfPosts(pos);
    // A lens that works among the people in the cage (post-fight, corner,
    // follow) never ends up in someone's head or back.
    if (goal.allowInside && kind !== 'overhead' && kind !== 'free' && kind !== 'orbit') this.clearOfBodies(pos, liveAll);
    const aimSm = this.aimS.step(this.heldAim, aimOmega, dt);
    let aim: V3 = [aimSm[0], aimSm[1], aimSm[2]];
    const zoomOmega = easing ? OPERATOR.zoomTransitionZoom
      : this.heldTan > this.tanS.x ? spec.zoomOutOmega : goal.zoomIn ?? spec.zoomInOmega;
    let tanHalf = this.tanS.step(this.heldTan, zoomOmega, dt);

    // Safety: whatever the springs are doing, the framed bodies stay in the frame.
    if (goal.keep.length > 0) {
      const tanMax = fovToTanHalf(spec.fovMax);
      let need = requiredTanHalf(pos, aim, goal.keep, this.aspect) / goal.keepSafe;
      // Even the widest lens cannot hold them from where the operator is
      // aiming: a quick but continuous whip toward the framing goal (a
      // snap would read as a cut); the spring keeps its momentum.
      if (need > tanMax) {
        aim = lerpV(aim, goal.target, 1 - Math.exp(-12 * Math.max(dt, 1 / 120)));
        this.aimS.set(aim);
        need = requiredTanHalf(pos, aim, goal.keep, this.aspect) / goal.keepSafe;
      }
      if (!Number.isFinite(need)) need = tanMax;
      if (tanHalf < need) {
        // Open the lens exactly as far as needed; keep an opening zoom's
        // momentum (no velocity reset) so the move stays smooth.
        tanHalf = need;
        this.tanS.x = need;
        if (this.tanS.v < 0) this.tanS.v = 0;
        if (this.heldTan < need) this.heldTan = need;
      }
    }
    tanHalf = clamp(tanHalf, fovToTanHalf(spec.fovMin), fovToTanHalf(spec.fovMax));

    this.dbg.aim[0] = aim[0]; this.dbg.aim[1] = aim[1]; this.dbg.aim[2] = aim[2];
    // Handheld float and strike shake: pure functions of timeline time.
    const b = lookBasis(pos, aim);
    const depth = Math.max(0.5, dist(pos, aim));
    const s = entry.seed || hashString(key);
    const hh = spec.handheldDeg * (Math.PI / 180) * (source === 'replay' ? 0.6 : 1);
    let yaw = hh * smoothNoise(timeline, s, 0.31);
    let pitch = hh * 0.8 * smoothNoise(timeline + 11.3, s + 17, 0.27);
    let roll = hh * 0.6 * smoothNoise(timeline + 5.1, s + 41, 0.19);
    const shake = spec.shake * this.shakeAt(input, timeline);
    yaw += shake * tanHalf * 0.6;
    pitch += shake * tanHalf;
    roll += shake * 0.004;
    const ty = Math.tan(yaw) * depth;
    const tp = Math.tan(pitch) * depth;
    aim[0] += b.right[0] * ty + b.up[0] * tp;
    aim[1] += b.right[1] * ty + b.up[1] * tp;
    aim[2] += b.right[2] * ty + b.up[2] * tp;

    // Where a lens may physically be.
    const anchor = ca.shape === 'unbounded' ? midSm : undefined;
    const safePos = clampToBounds(ca, pos, { wide: spec.wide, allowInside: goal.allowInside, anchor });

    // Depth of field: on the handhelds (the fence mesh goes soft) and in replays.
    let dof = spec.dof;
    if (replaySeg) dof = replaySeg.dof;
    const focus = goal.focus ?? aim;

    const state: CameraState = {
      position: safePos,
      target: aim,
      fovDeg: tanHalfToFov(tanHalf),
      rollRad: roll,
      focusM: Math.max(0.3, dist(safePos, focus)),
      dof,
      cut,
      shotName: source === 'replay' ? shotLabel(kind, true) : spec.label,
    };
    this.lastState = state;

    let blocked: string | null = null;
    if (source === 'plan') {
      const plan = this.shotPlan ?? this.onlinePlan;
      const bl = plan ? lastBlockedBefore(plan.blocked, Math.round(timeline / TICK_S)) : null;
      if (bl) blocked = `${bl.wanted} held: ${bl.reason === 'strike' ? '±0.4 s strike window' : bl.reason === 'minShot' ? 'minimum shot length' : 'knockdown hold'}`;
    }
    const dbg = this.dbg;
    dbg.shot = kind; dbg.label = state.shotName; dbg.source = source; dbg.entryIndex = entryIndex; dbg.reason = entry.reason;
    dbg.shotSeconds = timeline - this.shotStartTimeline; dbg.timeline = timeline; dbg.blocked = blocked;
    dbg.occlusion = Math.round(this.lastOcclusion * 100) / 100;
    dbg.avoid[0] = Math.round(this.avoidA.x * 100) / 100;
    dbg.avoid[1] = Math.round(this.avoidB.x * 100) / 100;
    dbg.subjects = entry.subjects.length ? entry.subjects : focusIds ?? entry.subjects;
    dbg.shake = shake;
    return state;
  }

  // ---- prediction and focus (camera polish pass) ------------------------------

  private indexOf(frame: TickSnapshot, id: number): number {
    const fs = frame.fighters;
    if (fs[id]?.id === id) return id;
    for (let i = 0; i < fs.length; i++) if (fs[i]!.id === id) return i;
    return -1;
  }

  /** Fighter `i`'s rough mass centre at recorded time `t` into `out` (false: another phase or round). */
  private massAt(i: number, t: number, phase: string, round: number, out: V3): boolean {
    const tick = Math.floor(t / TICK_S + 1e-9);
    const f0 = this.frameAt(tick);
    if (!f0 || f0.phase !== phase || f0.round !== round) return false;
    const a = f0.fighters[i];
    if (!a) return false;
    const f1 = this.frameAt(tick + 1);
    const b = f1 && f1.tick === f0.tick + 1 && f1.phase === phase ? f1.fighters[i] ?? a : a;
    const al = clamp(t / TICK_S - f0.tick, 0, 1);
    out[0] = lerp(a.x, b.x, al);
    out[1] = lerp(postureY(a.posture, a.role), postureY(b.posture, b.role), al);
    out[2] = lerp(a.z, b.z, al);
    return true;
  }

  /**
   * Per-fighter predictive shift into `this.shift`: a centred average of the
   * recorded mass centre around `now + lead`, minus the centre now.
   */
  private predictShift(frame: TickSnapshot, now: number, aimOmega: number): boolean {
    const n = frame.fighters.length;
    if (this.shift.length < n * 3) this.shift = new Float64Array(n * 3);
    const lead = Math.min(OPERATOR.leadMaxS, (OPERATOR.leadShare * 2) / Math.max(0.5, aimOmega));
    const cur = this.scratchA;
    const smp = this.scratchB;
    const N = OPERATOR.smoothSamples;
    const W = OPERATOR.smoothHalfS;
    let any = false;
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sz = 0;
      if (this.massAt(i, now, frame.phase, frame.round, cur)) {
        for (let k = 0; k < N; k++) {
          const t = now + lead + W * ((2 * k) / (N - 1) - 1);
          // Past the recording's end, or into another phase: the fighter is where he is now.
          if (!this.massAt(i, t, frame.phase, frame.round, smp)) { smp[0] = cur[0]; smp[1] = cur[1]; smp[2] = cur[2]; }
          sx += smp[0]; sy += smp[1]; sz += smp[2];
        }
        sx = sx / N - cur[0]; sy = sy / N - cur[1]; sz = sz / N - cur[2];
        const l = Math.hypot(sx, sz);
        if (l > OPERATOR.maxShiftM) { sx *= OPERATOR.maxShiftM / l; sz *= OPERATOR.maxShiftM / l; }
        any = true;
      }
      this.shift[i * 3] = sx; this.shift[i * 3 + 1] = sy; this.shift[i * 3 + 2] = sz;
    }
    return any;
  }

  private readonly scratchA: V3 = [0, 0, 0];
  private readonly scratchB: V3 = [0, 0, 0];

  /** Multi-fighter bouts: whom the lens frames (`focusGroup`), cached per tick. */
  private focusGroup(frame: TickSnapshot, input: FrameInput): number[] | null {
    if (frame.fighters.length <= 2) return null;
    if (this.focusCache.tick === frame.tick) return this.focusCache.ids;
    const ids = focusGroup(frame, this.frames ? this.events : input.events, this.frames !== null);
    this.focusCache = { tick: frame.tick, ids };
    return ids;
  }

  // ---- plan access ---------------------------------------------------------

  private currentPlan(input: FrameInput): ShotPlan {
    if (this.shotPlan) return this.shotPlan;
    // Live: plan from what has been shown so far; pending contacts in the
    // snapshot are the look-ahead the ±0.4 s rule needs.
    const frame = input.frame;
    if (!this.online || frame.tick < this.online.lastTick) {
      const strikes = new StrikeIndex();
      const planner = new ShotPlanner({ arena: this.ca!, seed: this.seed, breakSeconds: this.breakSeconds }, strikes);
      this.online = {
        planner, strikes, lastTick: frame.tick - 1,
        view: { entries: planner.entries, lastTick: frame.tick - 1, blocked: planner.blocked },
      };
    }
    const on = this.online;
    if (frame.tick > on.lastTick) {
      const evs = this.liveEvents;
      evs.length = 0;
      for (const e of input.events) if (e.tick > on.lastTick && e.tick <= frame.tick) evs.push(e);
      for (const e of evs) if (e.kind === 'strike') on.strikes.add(e.tick);
      for (const f of frame.fighters) {
        if (f.actionStage === 'startup' || f.actionStage === 'contact') on.strikes.add(f.actionDetail.contactTick);
      }
      on.planner.step(frame, evs);
      on.lastTick = frame.tick;
    }
    on.view.lastTick = on.lastTick;
    return on.view;
  }
  private readonly liveEvents: SimEvent[] = [];

  private frameAt(tick: number): TickSnapshot | null {
    const fs = this.frames;
    if (!fs || fs.length === 0) return null;
    let lo = 0;
    let hi = fs.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (fs[m].tick <= tick) lo = m;
      else hi = m - 1;
    }
    return fs[lo];
  }

  private makeEntry(kind: ShotKind, frame: TickSnapshot, t: number, reason: ShotPlanEntry['reason']): ShotPlanEntry {
    const ca = this.ca!;
    // A pinned corner camera during a round stays on one fighter (the red
    // corner's) from the apron spot that shows him best.
    const subjects = kind === 'corner' && frame.fighters[0] ? [frame.fighters[0].id] : [];
    const azimuth = kind === 'cageside' || kind === 'ground' || kind === 'finish' || (kind === 'corner' && frame.phase !== 'break')
      ? chooseOperator(ca, frame, subjects, this.seed, `manual:${frame.tick}`)
      : kind === 'corner' ? cornerAzimuth(ca, frame, subjects[0] ?? 0, this.seed) : ca.mainAzimuth;
    return {
      kind, startTick: Math.round(t / TICK_S), startT: t, reason, forced: false, subjects, azimuth,
      sweep: kind === 'jib' ? 0.8 : 0, heights: [3.2, 5.2], durationS: 20, seed: hashString(`${this.seed}:${kind}:${frame.tick}`),
    };
  }

  private userEntry(mode: 'free' | 'orbit' | 'follow'): ShotPlanEntry {
    return {
      kind: mode, startTick: 0, startT: 0, reason: 'situation', forced: false,
      subjects: mode === 'follow' ? [this.request.followId ?? 0] : [], azimuth: 0, sweep: 0, heights: [0, 0],
      durationS: 0, seed: 7,
    };
  }

  private needsReposition(e: ShotPlanEntry, mid: V3, input: FrameInput): boolean {
    if (e.kind !== 'cageside' && e.kind !== 'ground' && e.kind !== 'corner') return false;
    if (e.kind === 'corner' && input.frame.phase === 'break') return false;
    const ca = this.ca!;
    const wd = wallDistanceAt(ca, e.azimuth);
    if (!Number.isFinite(wd)) return false;
    const op = atAzimuth(e.azimuth, wd);
    if (Math.hypot(op[0] - mid[0], op[2] - mid[2]) < 4.4) return false;
    if (input.simTime - e.startT < 4) return false;
    // Live cut rule: nothing just landed and nothing is about to.
    const recent = input.events.some((x) => x.kind === 'strike' && Math.abs(x.tick * TICK_S - input.simTime) < 0.6);
    const pending = input.frame.fighters.some((f) => f.actionStage === 'startup' || f.actionStage === 'contact');
    return !recent && !pending;
  }

  private replayShot(r: ReplayState, ca: CameraArena): ShotPlanEntry {
    const seg = r.segment;
    const plan = r.plan;
    const frame = this.frameAt(plan.keyTick);
    const subjects = [plan.target, plan.striker].filter((x) => x >= 0);
    let azimuth = ca.mainAzimuth;
    if ((seg.shot === 'cageside' || seg.shot === 'ground') && frame) {
      azimuth = chooseOperator(ca, frame, subjects, this.seed, `replay:${plan.id}:${r.segmentIndex}`);
    }
    return {
      kind: seg.shot, startTick: seg.fromTick, startT: seg.fromTick * TICK_S, reason: 'situation', forced: true,
      subjects, azimuth, sweep: 0, heights: [0, 0], durationS: (seg.toTick - seg.fromTick) * TICK_S,
      seed: hashString(`${plan.id}:${r.segmentIndex}`),
    };
  }

  /** Frame-shake envelope (fraction of half height) from heavy contacts near `t`. */
  private shakeAt(input: FrameInput, t: number): number {
    const evs = this.frames ? this.strikeEvents : input.events;
    // Binary search to the first event at t - 0.7 s.
    let lo = 0;
    let hi = evs.length;
    const from = Math.floor((t - 0.7) / TICK_S);
    if (this.frames) {
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (evs[m].tick < from) lo = m + 1;
        else hi = m;
      }
    }
    let amp = 0;
    for (let i = lo; i < evs.length; i++) {
      const e = evs[i];
      const et = e.tick * TICK_S + (e.subMs ?? 0) / 1000;
      if (et > t) break;
      const age = t - et;
      if (age > 0.7) continue;
      let a = 0;
      if (e.kind === 'strike') {
        const d = (e as { detail: { result: string; forceN?: number } }).detail;
        if (d.result === 'landed' && (d.forceN ?? 0) > 1500) a = Math.min(1, ((d.forceN ?? 0) - 1500) / 1300);
      } else if (e.kind === 'slam') a = 1;
      else if (e.kind === 'knockdown') a = 0.8;
      if (a > 0) amp += a * Math.exp(-age / 0.13) * Math.sin(2 * Math.PI * 8.5 * age + 0.4);
    }
    return clamp(amp, -1, 1) * SHAKE_MAX_NDC;
  }

  // ---- the operators --------------------------------------------------------

  /**
   * Sight lines for this shot: what must be seen (the subjects' heads, chests,
   * hips) and what may block it (the referee; the other fighters when the
   * shot is about one of them).
   */
  private sight(subjects: readonly FighterPoints[], all: readonly FighterPoints[], cage = true): { samples: SamplePoint[]; occluders: Capsule[] } {
    const out = this.sightOut;
    const samples = out.samples;
    const occluders = out.occluders;
    samples.length = 0;
    occluders.length = 0;
    for (const p of all) {
      if (subjects.includes(p)) for (const x of subjectSamples(p)) samples.push(x);
      else for (const c of fighterCapsules(p)) occluders.push(c);
    }
    if (this.bodyCapsDirty) {
      this.bodyCapsDirty = false;
      this.bodyCaps.length = 0;
      if (this.refereePose) for (const c of bodyCapsules(this.refereePose)) this.bodyCaps.push(c);
      for (const w of this.extraBodies) for (const c of bodyCapsules(w)) this.bodyCaps.push(c);
    }
    for (const c of this.bodyCaps) occluders.push(c);
    // The posts and the top rail (camera polish pass): a lens outside the cage
    // walks / slides until neither crosses the fighter's face.
    if (cage) for (const c of this.cageCaps) occluders.push(c);
    return out;
  }

  /**
   * The operator's dodge. `posAt(offset)` is where the lens would be with a
   * given offset (handheld: azimuth along the apron; hard camera: slide and
   * boom). The dodge target changes only when the current one lets the subject
   * be hidden beyond `OCCLUSION_LIMIT` (then the smallest offset that clears
   * it to `AVOID.clearTo`, else the least bad), and goes home once home is
   * clear again; the lens walks there on a spring. A cut or a seek starts the
   * shot already clear.
   */
  private dodge(
    key: string, candidates: readonly (readonly [number, number])[], posAt: (o: readonly [number, number]) => V3,
    sight: { samples: SamplePoint[]; occluders: Capsule[]; samplesAt?: (lens: V3) => SamplePoint[] },
    dt: number, snap: boolean, lim: { limit: number; clearTo: number; homeBelow: number } = DODGE_DEFAULT,
  ): V3 {
    // `samplesAt`: samples that depend on where the lens is (the corner handheld's picture).
    const occAt = (p: V3): number => occlusion(p, sight.samplesAt ? sight.samplesAt(p) : sight.samples, sight.occluders);
    const occ = (o: readonly [number, number]): number => occAt(posAt(o));
    if (sight.samples.length === 0 || sight.occluders.length === 0) {
      this.avoidTarget = [0, 0];
    } else {
      const home = occ([0, 0]);
      const choose = (): [number, number] => {
        if (home <= lim.limit) return [0, 0];
        let best: readonly [number, number] = [0, 0];
        let bestOcc = home;
        for (const c of candidates) {
          const o = occ(c);
          if (o <= lim.clearTo) return [c[0], c[1]];
          if (o < bestOcc - 0.05) { bestOcc = o; best = c; }
        }
        return [best[0], best[1]];
      };
      if (snap || key !== this.avoidKey) {
        this.avoidTarget = choose();
      } else if (this.avoidTarget[0] !== 0 || this.avoidTarget[1] !== 0) {
        if (home < lim.homeBelow) this.avoidTarget = [0, 0];
        else if (occ(this.avoidTarget) > lim.limit) this.avoidTarget = choose();
      } else if (home > lim.limit) {
        this.avoidTarget = choose();
      }
    }
    if (snap || key !== this.avoidKey) {
      this.avoidA.reset(this.avoidTarget[0]);
      this.avoidB.reset(this.avoidTarget[1]);
      this.avoidKey = key;
    } else {
      this.avoidA.step(this.avoidTarget[0], AVOID.omega, dt);
      this.avoidB.step(this.avoidTarget[1], AVOID.omega, dt);
    }
    const pos = posAt([this.avoidA.x, this.avoidB.x]);
    this.lastOcclusion = sight.samples.length ? occAt(pos) : 0;
    return pos;
  }

  /**
   * A knockdown in the last few seconds (or a fighter still down): who fell and
   * who dropped him. The hard camera pushes in on them.
   */
  private knockdownFocus(input: FrameInput): { downed: number; by: number } | null {
    const tick = input.frame.tick;
    let kd: SimEvent | null = null;
    for (const e of input.events) {
      if (e.kind === 'knockdown' && e.tick <= tick && tick - e.tick <= 25) kd = e;
    }
    if (kd) {
      const downed = kd.target >= 0 ? kd.target : kd.actor;
      return { downed, by: kd.target >= 0 ? kd.actor : -1 };
    }
    const down = input.frame.fighters.find((f) => f.posture === 'down');
    if (down && input.frame.phase === 'round') {
      return { downed: down.id, by: input.frame.fighters.find((f) => f.id !== down.id)?.id ?? -1 };
    }
    return null;
  }

  /**
   * Hands raised above their owner's head (fighters' `poses`, plus the
   * referee's head and raised hands when `referee`): framing points for the
   * post-fight shots, so a raised arm is never cropped.
   */
  private raisedPoints(poses: readonly WorldPose[], referee: boolean): V3[] {
    const out: V3[] = [];
    const bodies = referee && this.refereePose ? [...poses, this.refereePose] : poses;
    for (const w of bodies) {
      const headY = w.tip[B.head * 3 + 1];
      for (const hand of [B.lHand, B.rHand]) {
        const y = w.tip[hand * 3 + 1];
        if (Number.isFinite(y) && y > headY) out.push([w.tip[hand * 3], y + 0.06, w.tip[hand * 3 + 2]]);
      }
    }
    if (referee && this.refereePose) {
      const r = this.refereePose;
      out.push([r.tip[B.head * 3], r.tip[B.head * 3 + 1], r.tip[B.head * 3 + 2]]);
    }
    return out;
  }

  /** The post-fight handheld walks into the cage (a bounded arena with a wall). */
  private handheldInside(ca: CameraArena, entry: ShotPlanEntry): boolean {
    return ca.shape !== 'unbounded' && entry.reason === 'post';
  }

  private goal(
    kind: ShotKind, entry: ShotPlanEntry, ca: CameraArena, pts: FighterPoints[], framedAll: FighterPoints[], mid: V3,
    shotT: number, seg: ReplayState['segment'] | null, input: FrameInput, dt: number, snap: boolean, key: string,
    poses: readonly WorldPose[] = [],
  ): Goal {
    this.lastOcclusion = 0;
    const spec = SHOTS[kind];
    const aspect = this.aspect;
    const live = this.liveBuf;
    const everyone = live.length ? live : pts;
    // `all`: whom the wide shots frame (multi-fighter: the focus group).
    const all = framedAll.length ? framedAll : everyone;
    const subj = entry.subjects.length ? everyone.filter((p) => entry.subjects.includes(p.id)) : all;
    const subjects = subj.length ? subj : all;
    const anyDown = (fs: FighterPoints[]): boolean => fs.some((p) => p.posture === 'ground' || p.posture === 'down' || p.posture === 'out');
    const setFor = (fs: FighterPoints[], base: FramingSet): FramingSet => (base === 'torso' && anyDown(fs) ? 'ground' : base);
    const headOf = (id: number): V3 | null => everyone.find((p) => p.id === id)?.head ?? null;
    let focus: V3 | null = null;
    if (seg && this.replay) {
      const r = this.replay.plan;
      focus = seg.focus === 'striker' ? headOf(r.striker) : seg.focus === 'target' ? headOf(r.target) : null;
    }
    const zoomMul = seg ? 1 - seg.pushIn * easeInOut(shotT / Math.max(0.5, (seg.toTick - seg.fromTick) * TICK_S)) : 1;
    const unbounded = ca.shape === 'unbounded';

    const framed = (pos: V3, fs: FighterPoints[], set: FramingSet, safe: number, extra: V3[] = NO_POINTS, bias: [number, number] = NO_BIAS): Goal => {
      const keep = framingPoints(fs, set);
      // Predictive framing: each fighter's points moved to where the recording
      // says he is heading (the safety clamp keeps the points as they are now).
      let aimPts: V3[] = keep;
      if (this.shiftOn && fs.length) {
        aimPts = [];
        const per = keep.length / fs.length;
        for (let k = 0; k < keep.length; k++) {
          const i = this.indexOf(input.frame, fs[Math.floor(k / per)]!.id);
          const q = keep[k]!;
          aimPts.push(i < 0 ? q : [q[0] + this.shift[i * 3]!, q[1] + this.shift[i * 3 + 1]!, q[2] + this.shift[i * 3 + 2]!]);
        }
      }
      const base = aimPts;
      if (extra.length) {
        aimPts = aimPts.slice();
        for (const e of extra) aimPts.push(e);
      }
      let g = solveFraming(pos, aimPts, aspect, safe, bias, this.fgoal);
      // The extras (a raised hand, the referee) are nice to have: when even the
      // widest lens cannot hold them too, the subject comes first.
      if (extra.length && g.tanHalf > fovToTanHalf(spec.fovMax)) g = solveFraming(pos, base, aspect, safe, bias, this.fgoal);
      const target: V3 = [g.target[0], g.target[1], g.target[2]];
      // Never tighter than the shot's minimum frame height at the subject —
      // except ground work, which a broadcast shoots tighter (the pair lies
      // low and long; camera polish pass).
      const onCanvas = fs.length > 0 && fs.every((p) => p.posture === 'ground');
      const minFrame = onCanvas ? Math.min(spec.minFrameM, GROUND_MIN_FRAME_M[kind] ?? spec.minFrameM) : spec.minFrameM;
      const minTan = minFrame / 2 / Math.max(0.5, dist(pos, target));
      let chest: V3 = target;
      if (fs.length) {
        chest = [0, 0, 0];
        for (const p of fs) { chest[0] += p.chest[0] / fs.length; chest[1] += p.chest[1] / fs.length; chest[2] += p.chest[2] / fs.length; }
      }
      return {
        pos, target, tanHalf: Math.max(g.tanHalf, minTan), keep, keepSafe: Math.min(0.9, safe + 0.14),
        focus: focus ?? chest, posOmega: Infinity, allowInside: false, zoomMul,
      };
    };

    switch (kind) {
      case 'main':
      case 'mainTight':
      case 'reverse': {
        const az = kind === 'reverse' ? ca.mainAzimuth + Math.PI : ca.mainAzimuth;
        const base: V3 = unbounded ? add(mid, atAzimuth(az, 7.5)) : atAzimuth(az, ca.mainRadius);
        const home: V3 = [base[0], kind === 'reverse' ? ca.mainHeight - 0.5 : ca.mainHeight, base[2]];
        // The platform: slide along it (tangent to the cage) and boom up to see past the referee.
        const tx = Math.cos(az);
        const tz = -Math.sin(az);
        const kd = kind === 'main' && !seg ? this.knockdownFocus(input) : null;
        const shotSubjects = kd ? all.filter((p) => p.id === kd.downed || p.id === kd.by) : kind === 'main' ? all : subjects;
        // MAIN and MAIN TIGHT are one operator (the zoom transition keeps his dodge).
        const pos = this.dodge(
          kind === 'reverse' ? `${key}:reverse` : `hard:${source(entry, seg)}`, AVOID.mainOffsets,
          (o) => [home[0] + tx * o[0], Math.min(ca.ceiling - 0.8, home[1] + o[1]), home[2] + tz * o[0]],
          this.sight(kd ? all.filter((p) => p.id === kd.downed) : shotSubjects, all), dt, snap,
        );
        if (kd && shotSubjects.length > 0) {
          // The knockdown push-in: the operator punches in on the falling
          // fighter (and the man who dropped him) — a zoom, not a cut, so the
          // strike guard does not apply.
          const g = framed(pos, shotSubjects, 'full', 0.72);
          return { ...g, keepSafe: 0.74, zoomIn: 3.4, posOmega: Infinity };
        }
        // Lead room: frame a little of where the pair is heading (with a
        // recording, `mid` already leads; live, the snapshot velocity).
        let vx = 0;
        let vz = 0;
        if (!this.shiftOn) {
          for (const p of all) { vx += p.velocity[0] / Math.max(1, all.length); vz += p.velocity[1] / Math.max(1, all.length); }
        }
        const lead: V3 = [mid[0] + clamp(vx * 0.6, -0.6, 0.6), 1.0, mid[2] + clamp(vz * 0.6, -0.6, 0.6)];
        if (kind === 'mainTight' || (seg && kind === 'reverse')) {
          const spread = subjects.length > 1 ? dist(subjects[0].hips, subjects[1].hips) : 0;
          const set = spread > 3.4 ? 'full' : setFor(subjects, 'torso');
          // The announcement: the referee between them and every raised hand in frame.
          const extra = entry.reason === 'post' ? this.raisedPoints(poses, true) : [];
          const g = framed(pos, subjects, set, seg ? 0.7 : spec.safe, extra, entry.reason === 'post' ? [0, 0.05] : [0, 0]);
          return { ...g, keepSafe: 0.86 };
        }
        const g = framed(pos, all, 'full', spec.safe, [lead]);
        // The title-safe clamp for the hard camera (tested): 0.74 plus shake stays inside 0.8.
        return { ...g, keepSafe: 0.74, posOmega: unbounded ? 1.2 : Infinity };
      }

      case 'finish': {
        if (this.handheldInside(ca, entry)) {
          // After the stoppage the handhelds are inside the cage (as on every
          // broadcast): 2.3 m from the winner on the chosen side, square to
          // the winner-loser line (the planner's `finishAzimuth`), at eye
          // height, holding the winner and the referee raising his hand.
          const w = subjects[0] ?? all[0];
          // In front of the winner (his chest's facing, from the pose), a
          // little to one side, 2.3 m off, inside the cage: his face, not his
          // back. Chosen when the shot starts and held (an operator walks up
          // and plants), then the dodge works around the referee.
          const at = (dirAz: number): V3 => {
            let r = 2.3;
            let p: V3 = [w.ground[0] + Math.sin(dirAz) * r, 1.62, w.ground[2] + Math.cos(dirAz) * r];
            while (r > 1.2 && !insideWall(ca, p[0], p[2], -0.4)) {
              r -= 0.1;
              p = [w.ground[0] + Math.sin(dirAz) * r, 1.62, w.ground[2] + Math.cos(dirAz) * r];
            }
            return keepInside(ca, p, 0.4);
          };
          if (snap || this.finishKey !== key) {
            this.finishKey = key;
            const idx = input.frame.fighters.findIndex((f) => f.id === w.id);
            const face = idx >= 0 && poses[idx] ? chestFacing(poses[idx]!) : null;
            const base = face ?? entry.azimuth;
            const sight = this.sight([w], all);
            let best = base + 0.45;
            let bestScore = Infinity;
            // Room matters most: a lens pulled in to 1.3 m cannot hold the
            // winner and the raised hand even at its widest (camera polish pass).
            FINISH_TURNS.forEach((o, i) => {
              const p = at(base + o);
              const inside = insideWall(ca, p[0], p[2], -0.35) ? 0 : 5;
              const room = Math.hypot(p[0] - w.ground[0], p[2] - w.ground[2]);
              // ...and nobody else within arm's reach of the lens.
              let crowd = 0;
              for (const q of everyone) {
                if (q.id === w.id) continue;
                crowd += Math.max(0, 1.2 - Math.hypot(p[0] - q.hips[0], p[2] - q.hips[2])) * 4;
              }
              const score = occlusion(p, sight.samples, sight.occluders) * 4 + inside + (2.3 - room) * 3 + crowd + i * 0.05;
              if (score < bestScore) { bestScore = score; best = base + o; }
            });
            this.finishDir = best;
          }
          const pos = this.dodge(
            `${key}:finish`, AVOID.handheldAzimuths.map((a) => [a, 0] as const), (o) => at(this.finishDir + o[0]),
            this.sight([w], all), dt, snap,
          );
          const extra: V3[] = [];
          if (this.refereePose) {
            const r = this.refereePose;
            extra.push([r.tip[B.head * 3], r.tip[B.head * 3 + 1], r.tip[B.head * 3 + 2]]);
            for (const hand of [B.lHand, B.rHand]) {
              const y = r.tip[hand * 3 + 1];
              if (y > r.tip[B.head * 3 + 1]) extra.push([r.tip[hand * 3], y, r.tip[hand * 3 + 2]]);
            }
          }
          // The winner's own raised fists.
          const wi = input.frame.fighters.findIndex((f) => f.id === w.id);
          if (wi >= 0 && poses[wi]) extra.push(...this.raisedPoints([poses[wi]!], false));
          const g = framed(pos, [w], 'torso', 0.62, extra, [0, 0.06]);
          return { ...g, posOmega: 1.2, keepSafe: 0.9, allowInside: true };
        }
      }
      // falls through: no cage to walk into (unbounded) uses the apron handheld
      case 'cageside':
      case 'ground': {
        const low = kind === 'ground';
        const az0 = entry.azimuth;
        const apron = (azIn: number): V3 => {
          if (unbounded) return add(mid, atAzimuth(azIn, 3.4, 0));
          // An operator's walk stays on his side of the posts (crossing one
          // puts it dead in front of the lens).
          const az = this.withinPanel(az0, azIn);
          const p = atAzimuth(az, wallDistanceAt(ca, az) + PLACEMENT.handheldOutsideM, 0);
          // The operator walks the apron a little toward the action.
          const tx = Math.cos(az);
          const tz = -Math.sin(az);
          const slide = clamp((mid[0] - p[0]) * tx + (mid[2] - p[2]) * tz, -0.9, 0.9) * 0.6;
          const q: V3 = [p[0] + tx * slide, 0, p[2] + tz * slide];
          // A fighter pressed against the fence right at the lens: the
          // operator steps back on the apron (camera polish pass), so the
          // subject never fills the lens and the framing never runs out of fov.
          let near = Infinity;
          for (const f of subjects) near = Math.min(near, Math.hypot(f.hips[0] - q[0], f.hips[2] - q[2]));
          const minD = low ? PLACEMENT.handheldMinSubjectM + 0.7 : PLACEMENT.handheldMinSubjectM;
          if (near < minD) {
            const back = Math.min(PLACEMENT.handheldBackOffM, minD - near);
            const r = Math.hypot(q[0], q[2]) || 1;
            q[0] += (q[0] / r) * back;
            q[2] += (q[2] / r) * back;
          }
          return this.clearOfPosts(q);
        };
        let pos: V3 = apron(az0);
        // Standing work is shot through the mesh; a fighter on the canvas is
        // shot from above the top rail, the operator's arms up. Never at rail
        // height, where the rail itself would fill the lens.
        // The height is chosen when the shot starts and kept: an operator
        // does not drag the lens up through the rail mid-shot.
        if (this.handheldH === null) {
          const ground = anyDown(subjects);
          let h = low ? PLACEMENT.groundHeightM : ground ? ca.wallHeight + PLACEMENT.overRailM : PLACEMENT.handheldHeightM;
          if (ca.wallHeight > 0 && Math.abs(h - ca.wallHeight) < 0.35) h = ca.wallHeight + PLACEMENT.overRailM;
          this.handheldH = h;
        }
        const hh = this.handheldH ?? PLACEMENT.handheldHeightM;
        // Walk the apron around the referee (and, on a one-fighter shot, the other fighter).
        pos = this.dodge(
          `${key}:hh`, AVOID.handheldAzimuths.map((a) => [a, 0] as const),
          (o) => { const p = apron(az0 + o[0]); return [p[0], hh, p[2]]; },
          this.sight(subjects, all), dt, snap,
        );
        // The low handheld pinned on standing fighters: head to waist from below.
        const set = kind === 'finish' ? 'torso' : low ? (anyDown(subjects) ? 'ground' : 'torso') : setFor(subjects, 'torso');
        const safe = seg ? 0.74 : spec.safe;
        // The finish: the winner and the referee raising his hand, both in frame.
        const extra: V3[] = [];
        if (kind === 'finish' && this.refereePose) {
          const w = this.refereePose;
          extra.push([w.tip[B.head * 3], w.tip[B.head * 3 + 1], w.tip[B.head * 3 + 2]]);
          for (const hand of [B.lHand, B.rHand]) {
            const y = w.tip[hand * 3 + 1];
            if (y > w.tip[B.head * 3 + 1]) extra.push([w.tip[hand * 3], y, w.tip[hand * 3 + 2]]);
          }
        }
        // Low on standing fighters the lens looks up: aim a little lower so the
        // lights above their heads do not take a third of the picture.
        const g = framed(pos, subjects, set, safe, extra, low ? (set === 'torso' ? [0, -0.12] : [0, 0.12]) : [0, 0.05]);
        return { ...g, posOmega: 1.4, keepSafe: 0.9 };
      }

      case 'overhead': {
        const h = Math.min(PLACEMENT.overheadHeightM, ca.ceiling - 0.8);
        const main = unbounded ? add(mid, atAzimuth(ca.mainAzimuth, 7.5)) : atAzimuth(ca.mainAzimuth, ca.mainRadius);
        const toMain = norm(sub([main[0], 0, main[2]], [mid[0], 0, mid[2]]));
        const off = Math.tan((PLACEMENT.overheadTiltDeg * Math.PI) / 180) * h;
        const pos: V3 = [mid[0] + toMain[0] * off, h, mid[2] + toMain[2] * off];
        const g = framed(pos, subjects, 'ground', seg ? 0.66 : spec.safe);
        return { ...g, posOmega: 1.1, keepSafe: 0.88, allowInside: true };
      }

      case 'jib': {
        // A crane move: the arm swings between two panel centres (so the move
        // settles with no post dead-centre) and booms up or down, the lens
        // held on the middle of the cage, wide enough to see all of it.
        const dur = Math.max(1, entry.durationS);
        const p = easeInOut(shotT / dur);
        const az = entry.azimuth + entry.sweep * p;
        const h = lerp(entry.heights[0], entry.heights[1], p);
        const r = unbounded ? 8 : Math.min(ca.circumradius + PLACEMENT.jibOutsideM, ca.outerRadius - 0.7);
        const pos: V3 = unbounded ? add(mid, atAzimuth(az, r, h)) : atAzimuth(az, r, h);
        const centre: V3 = unbounded ? [mid[0], 0.9, mid[2]] : [mid[0] * 0.25, 0.5, mid[2] * 0.25];
        const d = dist(pos, centre);
        const halfW = unbounded ? 3.5 : ca.circumradius * 1.02;
        const tanHalf = Math.max(halfW / d / aspect, (ca.wallHeight + 1.2) / d);
        return {
          pos, target: centre, tanHalf, keep: [], keepSafe: 1, focus: null,
          posOmega: Infinity, allowInside: false, zoomMul: 1,
        };
      }

      case 'corner': {
        const az0 = entry.azimuth;
        const f = subjects[0] ?? all[0];
        if (input.frame.phase === 'break' && !unbounded) {
          // Between rounds a handheld works inside the cage in front of the
          // corner (over the cutman's shoulder): 1.9 m in front of the seated
          // fighter and a little to one side, lens just above his eye line.
          const idx = input.frame.fighters.findIndex((x) => x.id === f.id);
          const face = idx >= 0 && poses[idx] ? chestFacing(poses[idx]!) : null;
          const base = face ?? Math.atan2(-f.ground[0], -f.ground[2]);
          const side = (entry.seed & 1) === 0 ? 0.42 : -0.42;
          const at = (o: number, lift = 0): V3 => {
            let r = 1.9;
            const a = base + side + o;
            const y = 1.38 + lift;
            let p: V3 = [f.ground[0] + Math.sin(a) * r, y, f.ground[2] + Math.cos(a) * r];
            while (r > 1.2 && !insideWall(ca, p[0], p[2], -0.35)) {
              r -= 0.1;
              p = [f.ground[0] + Math.sin(a) * r, y, f.ground[2] + Math.cos(a) * r];
            }
            return keepInside(ca, p, 0.35);
          };
          // Occlusion-aware (performance pass 2): the cornermen kneel and lean
          // in between lens and fighter, so this handheld counts them with a
          // margin, over the whole picture (not only his head, chest and hips:
          // a coach's back filling a corner of the frame counts), reacts to any
          // of it hidden, and walks, lifts the camera to shoulder height or
          // crosses to the fighter's other side until the picture is clear
          // (CORNER_AVOID, cornerSamples).
          // The lens is inside the cage here: the cage hides nothing from it.
          const sight = this.sight([f], all, false);
          const occ = this.cornerSight.occluders;
          occ.length = 0;
          const nOther = sight.occluders.length - this.bodyCaps.length;
          for (let i = 0; i < nOther; i++) occ.push(sight.occluders[i]!);
          for (const c of inflateCapsules(this.bodyCaps, CORNER_AVOID.margin, this.cornerCaps, CORNER_AVOID.minR)) occ.push(c);
          // The picture's points depend on where the lens is: rebuilt per candidate.
          cornerSamples(f, [Math.sin(base + side), Math.cos(base + side)], this.cornerSight.samples);
          this.cornerSight.samplesAt = (lens: V3): SamplePoint[] => {
            const dx = lens[0] - f.hips[0], dz = lens[2] - f.hips[2], l = Math.hypot(dx, dz) || 1;
            return cornerSamples(f, [dx / l, dz / l], this.cornerSight.samples);
          };
          const pos = this.cornerAvoid
            ? this.dodge(`${key}:cornerIn`, cornerCandidates(side), (o) => at(o[0], o[1]), this.cornerSight, dt, snap, CORNER_AVOID)
            : this.dodge(`${key}:cornerIn`, OLD_CORNER_CANDIDATES, (o) => at(o[0]), this.sight([f], all), dt, snap);
          const g = framed(pos, [f], 'face', 0.5, [], [0, 0.04]);
          return { ...g, posOmega: 1.4, keepSafe: 0.9, focus: f.head, allowInside: true };
        }
        let ch: number = PLACEMENT.cornerHeightM;
        if (ca.wallHeight > 0 && Math.abs(ch - ca.wallHeight) < 0.35) ch = ca.wallHeight + PLACEMENT.overRailM;
        const at = (az: number): V3 => {
          const wd = wallDistanceAt(ca, az);
          const p: V3 = unbounded || !Number.isFinite(wd)
            ? add(f.ground, atAzimuth(az, 2.6, 0))
            : atAzimuth(az, wd + PLACEMENT.cornerOutsideM, 0);
          // Step back along the apron from a fighter right at the lens.
          const near = Math.hypot(f.hips[0] - p[0], f.hips[2] - p[2]);
          if (!unbounded && near < 2) {
            const r = Math.hypot(p[0], p[2]) || 1;
            const back = Math.min(PLACEMENT.handheldBackOffM, 2 - near);
            p[0] += (p[0] / r) * back;
            p[2] += (p[2] / r) * back;
          }
          return this.clearOfPosts([p[0], ch, p[2]]);
        };
        const pos = this.dodge(
          `${key}:corner`, AVOID.handheldAzimuths.map((a) => [a * 0.6, 0] as const), (o) => at(az0 + o[0]),
          this.sight([f], all), dt, snap,
        );
        // Live action (a pinned corner camera during a round): head to waist,
        // a face-tight lens cannot hold a moving fighter.
        const standingF = f.posture === 'standing' || f.posture === 'clinch';
        const set: FramingSet = !standingF ? 'ground' : input.frame.phase === 'round' ? 'torso' : 'face';
        const g = framed(pos, [f], set, set === 'torso' ? 0.62 : spec.safe);
        return { ...g, posOmega: 1.4, keepSafe: 0.92, focus: f.head };
      }

      case 'follow': {
        const id = entry.subjects[0] ?? 0;
        const f = everyone.find((p) => p.id === id) ?? everyone[0]!;
        // His opponent: the nearest other fighter.
        let o: FighterPoints | null = null;
        for (const p of everyone) {
          if (p.id !== f.id && (!o || distXZ(p.hips, f.hips) < distXZ(o.hips, f.hips))) o = p;
        }
        // Away from the opponent — a direction that is only trusted with some
        // distance between them (in a clinch it spins) and swung smoothly.
        const sep = o ? distXZ(f.hips, o.hips) : 0;
        const rawAz = o && sep > 0.45 ? Math.atan2(f.hips[0] - o.hips[0], f.hips[2] - o.hips[2]) : f.facing + Math.PI;
        if (snap || this.followKey !== key) {
          this.followKey = key;
          this.followAz.reset(rawAz);
        } else {
          const target = this.followAz.x + wrapAngle(rawAz - this.followAz.x);
          // Weight the pull by how much the direction can be trusted.
          const w = o ? clamp((sep - 0.45) / 0.8, 0, 1) : 0.3;
          this.followAz.step(this.followAz.x + (target - this.followAz.x) * w, 1.2, dt);
        }
        const away: V3 = [Math.sin(this.followAz.x), 0, Math.cos(this.followAz.x)];
        // Behind and beside him, over his shoulder; swung round toward the
        // middle of the cage when that spot would be in (or behind) the fence.
        let pos: V3 | null = null;
        for (const turn of FOLLOW_TURNS) {
          const c = Math.cos(turn);
          const sn = Math.sin(turn);
          const ax = away[0] * c + away[2] * sn;
          const az = -away[0] * sn + away[2] * c;
          const p: V3 = [f.hips[0] + ax * 3.4 + az * 0.7, 2.4, f.hips[2] + az * 3.4 - ax * 0.7];
          if (unbounded || insideWall(ca, p[0], p[2], -0.5)) { pos = p; break; }
        }
        if (!pos) pos = keepInside(ca, [f.hips[0] + away[0] * 3.4, 2.4, f.hips[2] + away[2] * 3.4], 0.5);
        // Him head to toe, his opponent's head (over the shoulder).
        const g = framed(pos, [f], 'full', spec.safe, o ? [o.crown, o.head] : NO_POINTS);
        return { ...g, posOmega: 1.3, keepSafe: 0.92, allowInside: true };
      }

      case 'orbit':
      case 'free': {
        const pose = freeCameraPose(this.free, kind, mid, shotT);
        return {
          pos: pose.position, target: pose.target, tanHalf: fovToTanHalf(pose.fovDeg), keep: [], keepSafe: 1,
          focus: null, posOmega: Infinity, allowInside: true, zoomMul: 1,
        };
      }
    }
  }
}

/** An in-cage lens at least `m` inside the wall (pulled in radially), never in the mesh. */
function keepInside(ca: CameraArena, p: V3, m: number): V3 {
  if (ca.shape === 'unbounded') return p;
  const r = Math.hypot(p[0], p[2]);
  const wd = wallDistanceAt(ca, Math.atan2(p[0], p[2]));
  if (!Number.isFinite(wd) || r <= wd - m || r < 1e-6) return p;
  const k = Math.max(0, wd - m) / r;
  return [p[0] * k, p[1], p[2] * k];
}

/** Azimuth (sim convention) a posed body's chest faces: the rest pose faces +Z. */
function chestFacing(w: WorldPose): number | null {
  const i = B.spine2 * 4;
  const x = w.quat[i]!, y = w.quat[i + 1]!, z = w.quat[i + 2]!, qw = w.quat[i + 3]!;
  // Rotate (0, 0, 1) by the quaternion.
  const fx = 2 * (x * z + qw * y);
  const fz = 1 - 2 * (x * x + y * y);
  if (!Number.isFinite(fx) || !Number.isFinite(fz) || Math.hypot(fx, fz) < 1e-3) return null;
  return Math.atan2(fx, fz);
}
