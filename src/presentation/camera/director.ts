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
import { type CameraArena, clampToBounds, insideWall, makeCameraArena, wallDistanceAt } from './geometry';
import {
  AVOID, bodyCapsules, type Capsule, fighterCapsules, OCCLUSION_LIMIT, occlusion, type SamplePoint, subjectSamples,
} from './occlusion';
import { fovToTanHalf, lookBasis, requiredTanHalf, solveFraming, tanHalfToFov } from './framing';
import {
  type FighterPoints, type FramingSet, fighterPoints, framingPoints, pairMid,
} from './keypoints';
import {
  add, atAzimuth, clamp, dist, easeInOut, hashString, lerp, norm, scale, smoothNoise,
  Spring1, Spring3, sub, type V3,
} from './math';
import {
  chooseOperator, entryAt, planShots, type ShotPlan, type ShotPlanEntry, ShotPlanner, StrikeIndex, TICK_S,
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
}

const DEFAULT_ASPECT = 16 / 9;
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
  private online: { planner: ShotPlanner; strikes: StrikeIndex; lastTick: number } | null = null;

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
    occlusion: 0, avoid: [0, 0],
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

  /** User camera (free / orbit), manipulated by `FreeCameraController`. */
  readonly free: FreeCameraState = createFreeCameraState();

  constructor(opts: BroadcastDirectorOptions = {}) {
    if (opts.aspect) this.aspect = opts.aspect;
  }

  // ---- configuration ------------------------------------------------------

  setBout(bout: BoutPresentation, arena: ArenaSet | null): void {
    this.bout = bout;
    this.ca = makeCameraArena(bout.arena, arena?.bounds ?? null);
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
  }

  /** Force one shot kind in broadcast mode (dev tools, tests); null to release. */
  lockShot(kind: ShotKind | null): void {
    this.locked = kind;
    this.manual = null;
  }

  get plan(): ShotPlan | null {
    return this.shotPlan ?? (this.online ? { entries: this.online.planner.entries, lastTick: this.online.lastTick, blocked: this.online.planner.blocked } : null);
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
    const timeline = atLast ? input.simTime + this.holdClock : atFirst ? this.holdClock : input.simTime;
    const dt = holding ? clamp(realDt, 0, 0.25) : clamp(simDt, 0, 0.25);

    // Bodies.
    const pts = fighterPoints(frame, input.next, input.alpha, poses, this.statures);
    const mid = pairMid(pts.filter((p) => p.posture !== 'out').length ? pts.filter((p) => p.posture !== 'out') : pts);
    if (snap) this.midS.reset(mid);
    const midSm = this.midS.step(mid, 3, dt);

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
      if (!this.manual || this.manual.kind !== kind || this.needsReposition(this.manual, midSm, input)) {
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

    const cut = snap || key !== this.lastKey;
    if (cut) {
      snap = true;
      this.shotStartTimeline = timeline;
      this.handheldH = null;
    }
    this.lastKey = key;

    const kind = entry.kind;
    const spec = SHOTS[kind];
    const goal = this.goal(kind, entry, ca, pts, midSm, shotT, replaySeg, input, dt, snap, key, poses);

    // Smooth like an operator.
    if (snap) {
      this.posS.reset(goal.pos);
      this.aimS.reset(goal.target);
      this.tanS.reset(goal.tanHalf * goal.zoomMul);
    }
    const pos: V3 = [...(goal.posOmega === Infinity ? (this.posS.reset(goal.pos), goal.pos) : this.posS.step(goal.pos, goal.posOmega, dt))] as V3;
    let aim: V3 = [...this.aimS.step(goal.target, spec.aimOmega, dt)] as V3;
    const goalTan = goal.tanHalf * goal.zoomMul;
    let tanHalf = this.tanS.step(goalTan, goalTan > this.tanS.x ? spec.zoomOutOmega : goal.zoomIn ?? spec.zoomInOmega, dt);

    // Safety: whatever the springs are doing, the framed bodies stay in the frame.
    if (goal.keep.length > 0) {
      const tanMax = fovToTanHalf(spec.fovMax);
      let need = requiredTanHalf(pos, aim, goal.keep, this.aspect) / goal.keepSafe;
      if (need > tanMax) {
        aim = [...goal.target] as V3;
        this.aimS.reset(aim);
        need = requiredTanHalf(pos, aim, goal.keep, this.aspect) / goal.keepSafe;
      }
      if (tanHalf < need) {
        tanHalf = need;
        this.tanS.reset(need);
      }
    }
    tanHalf = clamp(tanHalf, fovToTanHalf(spec.fovMin), fovToTanHalf(spec.fovMax));

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
    aim = add(aim, add(scale(b.right, Math.tan(yaw) * depth), scale(b.up, Math.tan(pitch) * depth)));

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

    const plan = this.plan;
    let blocked: string | null = null;
    if (plan && source === 'plan') {
      const tick = Math.round(timeline / TICK_S);
      const bl = plan.blocked.filter((x) => x.tick <= tick && x.tick > tick - 12).pop();
      if (bl) blocked = `${bl.wanted} held: ${bl.reason === 'strike' ? '±0.4 s strike window' : bl.reason === 'minShot' ? 'minimum shot length' : 'knockdown hold'}`;
    }
    this.dbg = {
      shot: kind, label: state.shotName, source, entryIndex, reason: entry.reason,
      shotSeconds: timeline - this.shotStartTimeline, timeline, blocked,
      occlusion: Math.round(this.lastOcclusion * 100) / 100,
      avoid: [Math.round(this.avoidA.x * 100) / 100, Math.round(this.avoidB.x * 100) / 100],
    };
    return state;
  }

  // ---- plan access ---------------------------------------------------------

  private currentPlan(input: FrameInput): ShotPlan {
    if (this.shotPlan) return this.shotPlan;
    // Live: plan from what has been shown so far; pending contacts in the
    // snapshot are the look-ahead the ±0.4 s rule needs.
    const frame = input.frame;
    if (!this.online || frame.tick < this.online.lastTick) {
      const strikes = new StrikeIndex();
      this.online = {
        planner: new ShotPlanner({ arena: this.ca!, seed: this.seed, breakSeconds: this.breakSeconds }, strikes),
        strikes, lastTick: frame.tick - 1,
      };
    }
    const on = this.online;
    if (frame.tick > on.lastTick) {
      const evs = input.events.filter((e) => e.tick > on.lastTick && e.tick <= frame.tick);
      for (const e of evs) if (e.kind === 'strike') on.strikes.add(e.tick);
      for (const f of frame.fighters) {
        if (f.actionStage === 'startup' || f.actionStage === 'contact') on.strikes.add(f.actionDetail.contactTick);
      }
      on.planner.step(frame, evs);
      on.lastTick = frame.tick;
    }
    return { entries: on.planner.entries, lastTick: on.lastTick, blocked: on.planner.blocked };
  }

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
    const azimuth = kind === 'cageside' || kind === 'ground' || kind === 'finish'
      ? chooseOperator(ca, frame, [], this.seed, `manual:${frame.tick}`)
      : ca.mainAzimuth;
    return {
      kind, startTick: Math.round(t / TICK_S), startT: t, reason, forced: false, subjects: [], azimuth,
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
    if (e.kind !== 'cageside' && e.kind !== 'ground') return false;
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
  private sight(subjects: FighterPoints[], all: FighterPoints[]): { samples: SamplePoint[]; occluders: Capsule[] } {
    const samples: SamplePoint[] = [];
    const occluders: Capsule[] = [];
    const ids = new Set(subjects.map((p) => p.id));
    for (const p of all) {
      if (ids.has(p.id)) samples.push(...subjectSamples(p));
      else occluders.push(...fighterCapsules(p));
    }
    if (this.refereePose) occluders.push(...bodyCapsules(this.refereePose));
    return { samples, occluders };
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
    sight: { samples: SamplePoint[]; occluders: Capsule[] }, dt: number, snap: boolean,
  ): V3 {
    const occ = (o: readonly [number, number]): number => occlusion(posAt(o), sight.samples, sight.occluders);
    if (sight.samples.length === 0 || sight.occluders.length === 0) {
      this.avoidTarget = [0, 0];
    } else {
      const home = occ([0, 0]);
      const choose = (): [number, number] => {
        if (home <= OCCLUSION_LIMIT) return [0, 0];
        let best: readonly [number, number] = [0, 0];
        let bestOcc = home;
        for (const c of candidates) {
          const o = occ(c);
          if (o <= AVOID.clearTo) return [c[0], c[1]];
          if (o < bestOcc - 0.05) { bestOcc = o; best = c; }
        }
        return [best[0], best[1]];
      };
      if (snap || key !== this.avoidKey) {
        this.avoidTarget = choose();
      } else if (this.avoidTarget[0] !== 0 || this.avoidTarget[1] !== 0) {
        if (home < AVOID.homeBelow) this.avoidTarget = [0, 0];
        else if (occ(this.avoidTarget) > OCCLUSION_LIMIT) this.avoidTarget = choose();
      } else if (home > OCCLUSION_LIMIT) {
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
    this.lastOcclusion = sight.samples.length ? occlusion(pos, sight.samples, sight.occluders) : 0;
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

  /** The post-fight handheld walks into the cage (a bounded arena with a wall). */
  private handheldInside(ca: CameraArena, entry: ShotPlanEntry): boolean {
    return ca.shape !== 'unbounded' && entry.reason === 'post';
  }

  private goal(
    kind: ShotKind, entry: ShotPlanEntry, ca: CameraArena, pts: FighterPoints[], mid: V3, shotT: number,
    seg: ReplayState['segment'] | null, input: FrameInput, dt: number, snap: boolean, key: string,
    poses: readonly WorldPose[] = [],
  ): Goal {
    this.lastOcclusion = 0;
    const spec = SHOTS[kind];
    const aspect = this.aspect;
    const live = pts.filter((p) => p.posture !== 'out');
    const all = live.length ? live : pts;
    const subj = entry.subjects.length ? all.filter((p) => entry.subjects.includes(p.id)) : all;
    const subjects = subj.length ? subj : all;
    const anyDown = (fs: FighterPoints[]): boolean => fs.some((p) => p.posture === 'ground' || p.posture === 'down' || p.posture === 'out');
    const setFor = (fs: FighterPoints[], base: FramingSet): FramingSet => (base === 'torso' && anyDown(fs) ? 'ground' : base);
    const headOf = (id: number): V3 | null => all.find((p) => p.id === id)?.head ?? null;
    let focus: V3 | null = null;
    if (seg && this.replay) {
      const r = this.replay.plan;
      focus = seg.focus === 'striker' ? headOf(r.striker) : seg.focus === 'target' ? headOf(r.target) : null;
    }
    const zoomMul = seg ? 1 - seg.pushIn * easeInOut(shotT / Math.max(0.5, (seg.toTick - seg.fromTick) * TICK_S)) : 1;
    const unbounded = ca.shape === 'unbounded';

    const framed = (pos: V3, fs: FighterPoints[], set: FramingSet, safe: number, extra: V3[] = [], bias: [number, number] = [0, 0]): Goal => {
      const keep = framingPoints(fs, set);
      const g = solveFraming(pos, [...keep, ...extra], aspect, safe, bias);
      // Never tighter than the shot's minimum frame height at the subject.
      const minTan = spec.minFrameM / 2 / Math.max(0.5, dist(pos, g.target));
      const chest = fs.length ? fs.reduce<V3>((a, p) => add(a, scale(p.chest, 1 / fs.length)), [0, 0, 0]) : g.target;
      return {
        pos, target: g.target, tanHalf: Math.max(g.tanHalf, minTan), keep, keepSafe: Math.min(0.9, safe + 0.14),
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
        const pos = this.dodge(
          `${key}:main`, AVOID.mainOffsets,
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
        // Lead room: frame a little of where the pair is heading.
        const vx = all.reduce((s, p) => s + p.velocity[0], 0) / Math.max(1, all.length);
        const vz = all.reduce((s, p) => s + p.velocity[1], 0) / Math.max(1, all.length);
        const lead: V3 = [mid[0] + clamp(vx * 0.6, -0.6, 0.6), 1.0, mid[2] + clamp(vz * 0.6, -0.6, 0.6)];
        if (kind === 'mainTight' || (seg && kind === 'reverse')) {
          const spread = subjects.length > 1 ? dist(subjects[0].hips, subjects[1].hips) : 0;
          const set = spread > 3.4 ? 'full' : setFor(subjects, 'torso');
          const g = framed(pos, subjects, set, seg ? 0.7 : spec.safe);
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
            while (r > 1.2 && !insideWall(ca, p[0], p[2], 0.4)) {
              r -= 0.1;
              p = [w.ground[0] + Math.sin(dirAz) * r, 1.62, w.ground[2] + Math.cos(dirAz) * r];
            }
            return p;
          };
          if (snap || this.finishKey !== key) {
            this.finishKey = key;
            const idx = input.frame.fighters.findIndex((f) => f.id === w.id);
            const face = idx >= 0 && poses[idx] ? chestFacing(poses[idx]!) : null;
            const base = face ?? entry.azimuth;
            const sight = this.sight([w], all);
            let best = base + 0.45;
            let bestScore = Infinity;
            [0.45, -0.45, 0.8, -0.8, 0, 1.2, -1.2].forEach((o, i) => {
              const p = at(base + o);
              const inside = insideWall(ca, p[0], p[2], 0.35) ? 0 : 5;
              const room = Math.hypot(p[0] - w.ground[0], p[2] - w.ground[2]);
              const score = occlusion(p, sight.samples, sight.occluders) * 4 + inside + (2.3 - room) + i * 0.05;
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
          const g = framed(pos, [w], 'torso', 0.62, extra, [0, 0.06]);
          return { ...g, posOmega: 1.2, keepSafe: 0.9, allowInside: true };
        }
      }
      // falls through: no cage to walk into (unbounded) uses the apron handheld
      case 'cageside':
      case 'ground': {
        const low = kind === 'ground';
        const az0 = entry.azimuth;
        const apron = (az: number): V3 => {
          if (unbounded) return add(mid, atAzimuth(az, 3.4, 0));
          const p = atAzimuth(az, wallDistanceAt(ca, az) + PLACEMENT.handheldOutsideM, 0);
          // The operator walks the apron a little toward the action.
          const tx = Math.cos(az);
          const tz = -Math.sin(az);
          const slide = clamp((mid[0] - p[0]) * tx + (mid[2] - p[2]) * tz, -0.9, 0.9) * 0.6;
          return [p[0] + tx * slide, 0, p[2] + tz * slide];
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
        const set = kind === 'finish' ? 'torso' : low ? 'ground' : setFor(subjects, 'torso');
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
        const g = framed(pos, subjects, set, safe, extra, low ? [0, 0.12] : [0, 0.05]);
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
          const at = (o: number): V3 => {
            let r = 1.9;
            const a = base + side + o;
            let p: V3 = [f.ground[0] + Math.sin(a) * r, 1.38, f.ground[2] + Math.cos(a) * r];
            while (r > 1.2 && !insideWall(ca, p[0], p[2], 0.35)) {
              r -= 0.1;
              p = [f.ground[0] + Math.sin(a) * r, 1.38, f.ground[2] + Math.cos(a) * r];
            }
            return p;
          };
          const pos = this.dodge(
            `${key}:cornerIn`, AVOID.handheldAzimuths.map((x) => [x * 0.7, 0] as const), (o) => at(o[0]),
            this.sight([f], all), dt, snap,
          );
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
          return [p[0], ch, p[2]];
        };
        const pos = this.dodge(
          `${key}:corner`, AVOID.handheldAzimuths.map((a) => [a * 0.6, 0] as const), (o) => at(az0 + o[0]),
          this.sight([f], all), dt, snap,
        );
        const g = framed(pos, [f], f.posture === 'standing' || f.posture === 'clinch' ? 'face' : 'ground', spec.safe);
        return { ...g, posOmega: 1.4, keepSafe: 0.92, focus: f.head };
      }

      case 'follow': {
        const id = entry.subjects[0] ?? 0;
        const f = all.find((p) => p.id === id) ?? all[0];
        const o = all.find((p) => p.id !== f.id);
        const away = o ? norm(sub([f.hips[0], 0, f.hips[2]], [o.hips[0], 0, o.hips[2]])) : norm(atAzimuth(f.facing + Math.PI, 1));
        const side: V3 = [away[2], 0, -away[0]];
        const pos: V3 = [f.hips[0] + away[0] * 2.9 + side[0] * 0.7, 2.2, f.hips[2] + away[2] * 2.9 + side[2] * 0.7];
        const g = framed(pos, all, 'full', spec.safe);
        return { ...g, posOmega: 2.2, keepSafe: 0.92, allowInside: true };
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
