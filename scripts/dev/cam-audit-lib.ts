/**
 * CAMERA QA HARNESS — shared by `scripts/dev/cam-audit.ts` (the full audit over a
 * representative set of recorded bouts) and `tests/presentation.cam-quality.test.ts`
 * (a short regression guard).
 *
 * It drives the broadcast director headless the way the presenter does (the
 * animated bodies from the animator / corner / post-fight staging and forward
 * kinematics, the referee from the arena's tracker and his animator, the cornermen
 * between rounds) over recorded bouts, and measures every frame the director
 * puts on air:
 *
 *   visibility    the shot's subjects' heads and torsos inside the action-safe
 *                 frame (90 %), and fully off-screen;
 *   occlusion     share of the subjects (head 2, chest 1.5, hips 1) hidden from the
 *                 lens by the referee, the cornermen, the cage (posts, top rail) and
 *                 the other fighters (reported apart: fighters overlapping each
 *                 other is normal broadcast grammar);
 *   composition   the subjects' fill of the frame vs the shot's intended fill,
 *                 headroom (crown to frame top), lead room when the subjects move
 *                 across the frame, horizon roll;
 *   motion        aim angular speed in screen heights / s, jerk, pan reversals
 *                 ("hunting"), sudden reframes, lens speed, zoom rate — measured
 *                 within a shot (cuts excluded) with the deliberate strike shake
 *                 masked out;
 *   the edit      cuts per minute, shot lengths, rendered cuts within ±6 ticks of
 *                 a strike (the documented knockdown exception counted apart);
 *   clipping      a lens inside the fence volume where the shot does not allow it,
 *                 within a post, inside a body, below the floor, in the lighting
 *                 rig, outside the building;
 *   replays       every planned replay angle played at its slow-motion rate: the
 *                 event's subjects visible and centred at the key instant, and the
 *                 lens steady (real-time screen speed) during the angle;
 *   cost          `director.update` wall time.
 *
 * Recordings are cached (the sim is tuned while camera work goes on, so before /
 * after must replay the same bouts). Deterministic apart from the timings.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARCHETYPES, DEFAULT_SETTINGS, createSim, deriveRuntime, resolveParams,
  type FighterDefinition, type SimConfig, type SimEvent, type TickSnapshot,
} from '../../src/sim';
import type { BoutPresentation, CameraRequest, CameraState, FrameInput } from '../../src/presentation/contract';
import { buildBoutPresentation } from '../../src/presentation/stage/bout';
import {
  createCameraDirector, planReplays, type BroadcastCameraDirector, type ReplayPlan, type ReplayState,
  type ShotKind, SHOTS, TICK_S,
} from '../../src/presentation/camera';
import { makeCameraArena, insideWall, postAzimuths, wallDistanceAt, type CameraArena } from '../../src/presentation/camera/geometry';
import { projectNdc } from '../../src/presentation/camera/framing';
import { framingPoints, pointsFromWorldPose, standInPoints, type FighterPoints } from '../../src/presentation/camera/keypoints';
import { bodyCapsules, fighterCapsules, occlusion, subjectSamples, type Capsule, type SamplePoint } from '../../src/presentation/camera/occlusion';
import type { RefereePlacement } from '../../src/presentation/arena/referee';
import { B, createPose, createWorldPose, forwardKinematics, type Pose, type RestSkeleton, type WorldPose } from '../../src/presentation/rig/skeleton';

type V3 = [number, number, number];

// ---------------------------------------------------------------------------
// Bouts
// ---------------------------------------------------------------------------

export interface CamBoutSpec {
  name: string;
  seed: string;
  ruleset: string;
  arena: string;
  fighters: string[];
  mode?: '1v1' | 'teams';
  teamOf?: number[];
  /**
   * Content the bout must have; seeds `${seed}`, `${seed}-1`, … are tried in
   * order until one does (the sim is tuned, so a fixed seed drifts).
   */
  want?: { groundFrac?: number; finish?: boolean; knockdown?: boolean; break?: boolean };
}

export const CAM_BOUTS: CamBoutSpec[] = [
  { name: 'mma-oct30', seed: 'cam-audit-1', ruleset: 'mma.unified.3r', arena: 'octagon_30', fighters: ['arch.champion_complete', 'arch.regional_pro_allrounder'], want: { break: true } },
  { name: 'mma-ground', seed: 'cam-audit-2', ruleset: 'mma.unified.3r', arena: 'octagon_30', fighters: ['arch.bjj_guard_player', 'arch.elite_wrestler_boxer'], want: { groundFrac: 0.3 } },
  { name: 'mma-oct25-ko', seed: 'cam-audit-3', ruleset: 'mma.unified.3r', arena: 'octagon_25', fighters: ['arch.heavyweight_power_puncher', 'arch.thai_striker'], want: { finish: true, knockdown: true } },
  { name: 'boxing-ring20', seed: 'cam-audit-4', ruleset: 'boxing.pro', arena: 'ring_20', fighters: ['arch.pressure_boxer', 'arch.counter_striker'] },
  { name: 'k1-ring16', seed: 'cam-audit-5', ruleset: 'kickboxing.k1', arena: 'ring_16', fighters: ['arch.thai_striker', 'arch.tkd_convert'] },
  { name: 'adcc-mat', seed: 'cam-audit-6', ruleset: 'grappling.adcc', arena: 'mat_ibjjf', fighters: ['arch.bjj_guard_player', 'arch.sambo_grappler'] },
  { name: 'street', seed: 'cam-audit-7', ruleset: 'street', arena: 'street_open', fighters: ['arch.brand_new_brawler', 'arch.pressure_boxer'] },
  { name: 'teams-2v2', seed: 'cam-audit-8', ruleset: 'mma.unified.3r', arena: 'octagon_30', mode: 'teams', teamOf: [0, 0, 1, 1], fighters: ['arch.regional_pro_allrounder', 'arch.pressure_boxer', 'arch.thai_striker', 'arch.sambo_grappler'] },
];

export interface CamRecording {
  spec: CamBoutSpec;
  seed: string;
  bout: BoutPresentation;
  frames: TickSnapshot[];
  events: SimEvent[];
}

const ARCH = Object.values(ARCHETYPES) as FighterDefinition[];
function arch(id: string, uniq: string): FighterDefinition {
  const a = ARCH.find((x) => x.id === id);
  if (!a) throw new Error(`no archetype ${id}`);
  const c = JSON.parse(JSON.stringify(a)) as FighterDefinition;
  c.id = `${id}#${uniq}`;
  return c;
}

function recordOnce(spec: CamBoutSpec, seed: string): CamRecording {
  const fighters = spec.fighters.map((id, i) => arch(id, String(i)));
  const mode = spec.mode ?? '1v1';
  const cfg: SimConfig = {
    seed, mode, fighters,
    teams: { teamOf: spec.teamOf ?? fighters.map((_, i) => Math.min(i, 1)) },
    ruleset: spec.ruleset as SimConfig['ruleset'],
    arena: spec.arena as SimConfig['arena'],
    settings: DEFAULT_SETTINGS,
  };
  const params = resolveParams(cfg.paramOverrides);
  const bout = buildBoutPresentation({
    config: cfg, fighters, runtimes: fighters.map((f) => deriveRuntime(f, params, { explain: false })),
  });
  const sim = createSim(cfg);
  const frames = [sim.snapshot()];
  while (sim.step()) frames.push(sim.snapshot());
  frames.push(sim.snapshot());
  return { spec, seed, bout, frames, events: [...sim.events] };
}

export function groundFraction(rec: Pick<CamRecording, 'frames'>): number {
  let g = 0;
  let n = 0;
  for (const f of rec.frames) {
    if (f.phase !== 'round') continue;
    n++;
    if (f.fighters.some((x) => x.posture === 'ground')) g++;
  }
  return n ? g / n : 0;
}

function satisfies(rec: CamRecording): boolean {
  const w = rec.spec.want;
  if (!w) return true;
  if (w.groundFrac !== undefined && groundFraction(rec) < w.groundFrac) return false;
  const end = rec.events.find((e) => e.kind === 'boutEnd');
  const method = (end?.detail as { method?: string } | undefined)?.method ?? '';
  if (w.finish && !/^(ko|tko|submission)/.test(method)) return false;
  if (w.knockdown && !rec.events.some((e) => e.kind === 'knockdown')) return false;
  if (w.break && !rec.frames.some((f) => f.phase === 'break')) return false;
  return true;
}

/** Record a bout with the wanted content (first matching seed of up to 40). */
export function recordCamBout(spec: CamBoutSpec): CamRecording {
  let last: CamRecording | null = null;
  for (let k = 0; k < 40; k++) {
    const seed = k === 0 ? spec.seed : `${spec.seed}-${k}`;
    last = recordOnce(spec, seed);
    if (satisfies(last)) return last;
  }
  return last!;
}

/** Record (or load from `dir`) a bout: before / after comparisons play the same recording. */
export function cachedCamRecording(spec: CamBoutSpec, dir: string, refresh = false): CamRecording {
  const file = join(dir, `${spec.name}.json`);
  if (!refresh && existsSync(file)) {
    const d = JSON.parse(readFileSync(file, 'utf8')) as Omit<CamRecording, 'spec'>;
    return { spec, ...d };
  }
  const rec = recordCamBout(spec);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ seed: rec.seed, bout: rec.bout, frames: rec.frames, events: rec.events }));
  return rec;
}

/**
 * The windows an audit plays (sim seconds): the opening 150 s, the first break
 * and the last 60 s. A short bout is played whole.
 */
export function camWindows(rec: Pick<CamRecording, 'frames' | 'events'>, full = false): [number, number][] {
  const end = rec.frames[rec.frames.length - 1]!.t;
  if (full || end <= 240) return [[0, end]];
  const w: [number, number][] = [[0, 150]];
  const re = rec.events.find((e) => e.kind === 'roundEnd');
  const rs = re ? rec.events.find((e) => e.kind === 'roundStart' && e.tick > re.tick) : undefined;
  if (re && rs && rs.tick / 10 < end - 60) w.push([Math.max(150, re.tick / 10 - 10), rs.tick / 10 + 6]);
  w.push([Math.max(w[w.length - 1]![1], end - 60), end]);
  return w.filter(([a, b]) => b > a);
}

// ---------------------------------------------------------------------------
// Bodies: the presenter's pipeline, headless
// ---------------------------------------------------------------------------

export interface BodySource {
  /** Pose everyone for this frame; returns the fighters' world poses (empty = stand-ins). */
  update(input: FrameInput, realDt: number): readonly WorldPose[];
  referee(): WorldPose | null;
  extras(): readonly WorldPose[];
  postClock(): number | null;
}

/** The real animated bodies (animator, corner, post-fight staging, referee). Loaded lazily (heavy imports). */
export async function animatedBodies(rec: CamRecording, root = process.cwd()): Promise<BodySource> {
  const { StandingAnimator } = await import('../../src/presentation/anim/animator');
  const { registerMotionLibrary } = await import('../../src/presentation/anim/capture');
  await import('../../src/presentation/anim/grapple');
  const { MotionLibrary } = await import('../../src/presentation/assets/motionLibrary');
  const { restFor } = await import('../../src/presentation/placeholders/debugSkeleton');
  const { CornerRest } = await import('../../src/presentation/corner');
  const { FinishStage } = await import('../../src/presentation/finish');
  const { RefereeTracker } = await import('../../src/presentation/arena/referee');
  const { RefereeAnimator, refereeRest } = await import('../../src/presentation/referee');
  const motion = MotionLibrary.fromData(
    JSON.parse(readFileSync(join(root, 'static/assets/motion/manifest.json'), 'utf8')),
    readFileSync(join(root, 'static/assets/motion/motion.bin')),
  );
  registerMotionLibrary(motion);
  const rests: RestSkeleton[] = rec.bout.fighters.map((_, i) => restFor(rec.bout, i));
  const an = new StandingAnimator({ motion });
  an.setBout(rec.bout, rests);
  const corner = new CornerRest(rec.bout, rests, { factory: null });
  corner.setRecording(rec.frames, rec.events);
  const refRest = refereeRest();
  const fin = new FinishStage(rec.bout, rests, refRest);
  fin.setRecording(rec.frames, rec.events);
  const ca = makeCameraArena(rec.bout.arena, null);
  const tracker = rec.bout.arena.shape !== 'unbounded' ? new RefereeTracker(rec.bout.arena, undefined, ca.mainAzimuth) : null;
  const refAn = new RefereeAnimator(refRest);
  const poses: Pose[] = rests.map(() => createPose());
  const worlds: WorldPose[] = rests.map(() => createWorldPose());
  let refPlace: RefereePlacement | null = null;
  let refShown = false;
  let post: number | null = null;
  return {
    update(input, realDt) {
      if (input.discontinuity) { an.reset(); refAn.reset(); }
      post = fin.clock(input, realDt);
      an.evaluate(post !== null ? fin.animatorInput(input) : input, realDt, poses);
      corner.apply(input, poses, realDt);
      fin.apply(poses, refPlace && refPlace.present ? refPlace : null);
      for (let i = 0; i < poses.length; i++) forwardKinematics(worlds[i]!, poses[i]!, rests[i]!);
      const script = fin.refereeScript(worlds);
      const simDt = input.discontinuity ? 0 : Math.max(0, realDt) * (script ? 1 : input.playbackRate);
      if (script) {
        refPlace = script.placement;
        refAn.evaluate({ placement: script.placement, fighters: worlds, realDt, simDt, snap: input.discontinuity, extra: script.extra });
        refShown = true;
      } else if (tracker) {
        const t = tracker.update(input.frame, input.simTime, simDt, input.discontinuity, { events: input.events });
        refPlace = t;
        refShown = t.present;
        if (t.present) refAn.evaluate({ placement: t, fighters: worlds, realDt, simDt, snap: input.discontinuity });
      } else refShown = false;
      return worlds;
    },
    referee: () => (refShown ? refAn.world : null),
    extras: () => corner.crew?.bodies() ?? [],
    postClock: () => post,
  };
}

/** Stand-in bodies (the snapshot only) plus the tracked referee: fast, for the unit test. */
export async function standInBodies(rec: CamRecording): Promise<BodySource> {
  const { RefereeTracker } = await import('../../src/presentation/arena/referee');
  const { RefereeAnimator, refereeRest } = await import('../../src/presentation/referee');
  const ca = makeCameraArena(rec.bout.arena, null);
  const tracker = rec.bout.arena.shape !== 'unbounded' ? new RefereeTracker(rec.bout.arena, undefined, ca.mainAzimuth) : null;
  const refAn = new RefereeAnimator(refereeRest());
  let shown = false;
  return {
    update(input, realDt) {
      if (input.discontinuity) refAn.reset();
      const simDt = input.discontinuity ? 0 : Math.max(0, realDt) * input.playbackRate;
      if (tracker) {
        const t = tracker.update(input.frame, input.simTime, simDt, input.discontinuity, { events: input.events });
        shown = t.present;
        if (t.present) refAn.evaluate({ placement: t, fighters: [], realDt, simDt, snap: input.discontinuity });
      }
      return [];
    },
    referee: () => (shown ? refAn.world : null),
    extras: () => [],
    postClock: () => null,
  };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export class Stat {
  n = 0; sum = 0; max = 0;
  vals: number[] = [];
  add(v: number): void { this.n++; this.sum += v; if (v > this.max) this.max = v; this.vals.push(v); }
  get mean(): number { return this.n ? this.sum / this.n : 0; }
  pct(p: number): number {
    if (!this.vals.length) return 0;
    const s = [...this.vals].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  }
  merge(o: Stat): void { this.n += o.n; this.sum += o.sum; this.max = Math.max(this.max, o.max); for (const v of o.vals) this.vals.push(v); }
}

export interface CamResult {
  frames: number;
  seconds: number;
  /** Subject-frames: heads / torsos checked. */
  subj: number;
  headOutSafe: number;
  torsoOutSafe: number;
  offScreen: number;
  /** Multi-fighter bouts: the primary engaged pair's heads outside the safe frame. */
  primaryOut: number;
  primaryN: number;
  occReferee: Stat;
  occCage: Stat;
  occCrew: Stat;
  occFighter: Stat;
  /** Frames where referee + cage + crew hide more than 30 % of the subjects. */
  occBad: number;
  fillRatio: Stat;
  /** Fill of the frame while the subjects are on the canvas (ground work), per shot family. */
  fillGround: Record<string, Stat>;
  fillTight: number;
  fillLoose: number;
  fillN: number;
  headroomLow: number;
  headroomHigh: number;
  headroomN: number;
  leadBad: number;
  leadN: number;
  rollDeg: Stat;
  /** Aim speed (screen heights / s), within shots. */
  screenSpeed: Stat;
  /** Aim jerk (screen heights / s³), within shots, shake masked. */
  jerk: Stat;
  lensSpeed: Stat;
  zoomRate: Stat;
  reversals: number;
  reframes: number;
  motionSeconds: number;
  cuts: number;
  liveSeconds: number;
  shotLengths: Stat;
  cutsNearStrike: number;
  cutsNearStrikeKd: number;
  clip: Record<string, number>;
  updateMs: Stat;
  replay: {
    angles: number;
    keyVisible: number;
    keyCentreDist: Stat;
    speed: Stat;
    cutsInside: number;
  };
  byShot: Record<string, { frames: number; headOut: number; occBad: number; speed: Stat; jerk: Stat; fill: Stat }>;
  examples: { t: number; what: string; value: number; shot: string; bout: string }[];
}

export function newCamResult(): CamResult {
  return {
    frames: 0, seconds: 0, subj: 0, headOutSafe: 0, torsoOutSafe: 0, offScreen: 0, primaryOut: 0, primaryN: 0,
    occReferee: new Stat(), occCage: new Stat(), occCrew: new Stat(), occFighter: new Stat(), occBad: 0,
    fillRatio: new Stat(), fillGround: {}, fillTight: 0, fillLoose: 0, fillN: 0, headroomLow: 0, headroomHigh: 0, headroomN: 0,
    leadBad: 0, leadN: 0, rollDeg: new Stat(), screenSpeed: new Stat(), jerk: new Stat(), lensSpeed: new Stat(),
    zoomRate: new Stat(), reversals: 0, reframes: 0, motionSeconds: 0, cuts: 0, liveSeconds: 0, shotLengths: new Stat(),
    cutsNearStrike: 0, cutsNearStrikeKd: 0, clip: {}, updateMs: new Stat(),
    replay: { angles: 0, keyVisible: 0, keyCentreDist: new Stat(), speed: new Stat(), cutsInside: 0 },
    byShot: {}, examples: [],
  };
}

export function mergeCam(rs: CamResult[]): CamResult {
  const o = newCamResult();
  for (const r of rs) {
    for (const k of Object.keys(o) as (keyof CamResult)[]) {
      const a = o[k] as unknown;
      const b = r[k] as unknown;
      if (typeof a === 'number') (o as unknown as Record<string, number>)[k] = a + (b as number);
      else if (a instanceof Stat) a.merge(b as Stat);
    }
    for (const [k, v] of Object.entries(r.clip)) o.clip[k] = (o.clip[k] ?? 0) + v;
    o.replay.angles += r.replay.angles; o.replay.keyVisible += r.replay.keyVisible; o.replay.cutsInside += r.replay.cutsInside;
    o.replay.keyCentreDist.merge(r.replay.keyCentreDist); o.replay.speed.merge(r.replay.speed);
    for (const [k, v] of Object.entries(r.byShot)) {
      const s = (o.byShot[k] ??= { frames: 0, headOut: 0, occBad: 0, speed: new Stat(), jerk: new Stat(), fill: new Stat() });
      s.frames += v.frames; s.headOut += v.headOut; s.occBad += v.occBad; s.speed.merge(v.speed); s.jerk.merge(v.jerk); s.fill.merge(v.fill);
    }
    o.examples.push(...r.examples);
    for (const [k, v] of Object.entries(r.fillGround)) (o.fillGround[k] ??= new Stat()).merge(v);
  }
  return o;
}

const pc = (a: number, b: number): string => (b ? `${((100 * a) / b).toFixed(2)} %` : '-');
const f2 = (v: number): string => v.toFixed(2);

/** The flat summary (the before / after table). */
export function summarizeCam(r: CamResult): Record<string, string> {
  const min = Math.max(1e-9, r.liveSeconds / 60);
  const mmin = Math.max(1e-9, r.motionSeconds / 60);
  return {
    'visibility: subject head outside safe frame (90 %)': pc(r.headOutSafe, r.subj),
    'visibility: subject chest outside safe frame': pc(r.torsoOutSafe, r.subj),
    'visibility: subject head/torso fully off-screen': pc(r.offScreen, r.subj),
    'visibility: 2v2 primary pair head outside safe': pc(r.primaryOut, r.primaryN),
    'occlusion: frames > 30 % hidden (referee+cage+crew)': pc(r.occBad, r.frames),
    'occlusion: referee mean / p95': `${f2(r.occReferee.mean)} / ${f2(r.occReferee.pct(0.95))}`,
    'occlusion: cage (posts, rail) mean / p95': `${f2(r.occCage.mean)} / ${f2(r.occCage.pct(0.95))}`,
    'occlusion: cornermen p95 / max': `${f2(r.occCrew.pct(0.95))} / ${f2(r.occCrew.max)}`,
    'occlusion: other fighters (info) mean': f2(r.occFighter.mean),
    'composition: fill / intended, median (p10-p90)': `${f2(r.fillRatio.pct(0.5))} (${f2(r.fillRatio.pct(0.1))}-${f2(r.fillRatio.pct(0.9))})`,
    ...Object.fromEntries(['main', 'mainTight', 'overhead', 'ground'].map((k) => [`composition: ground-work fill p50, ${k}`, r.fillGround[k] ? f2(r.fillGround[k]!.pct(0.5)) : '-'])),
    'composition: too tight (fill > 0.95)': pc(r.fillTight, r.fillN),
    'composition: too loose (fill < 0.3)': pc(r.fillLoose, r.fillN),
    'composition: headroom < 2 % (standing)': pc(r.headroomLow, r.headroomN),
    'composition: headroom > 30 % (standing)': pc(r.headroomHigh, r.headroomN),
    'composition: lead room wrong way (moving)': pc(r.leadBad, r.leadN),
    'composition: roll p95 / max (deg)': `${f2(r.rollDeg.pct(0.95))} / ${f2(r.rollDeg.max)}`,
    'motion: aim speed p50 / p95 / max (screens/s)': `${f2(r.screenSpeed.pct(0.5))} / ${f2(r.screenSpeed.pct(0.95))} / ${f2(r.screenSpeed.max)}`,
    'motion: aim jerk p50 / p95 (screens/s^3)': `${f2(r.jerk.pct(0.5))} / ${f2(r.jerk.pct(0.95))}`,
    'motion: pan reversals / min (hunting)': f2(r.reversals / mmin),
    'motion: sudden reframes / min': f2(r.reframes / mmin),
    'motion: lens speed p95 (m/s)': f2(r.lensSpeed.pct(0.95)),
    'motion: zoom rate p95 (ln/s)': f2(r.zoomRate.pct(0.95)),
    'edit: cuts / min (live)': f2(r.cuts / min),
    'edit: shot length median / p10 / min (s)': `${f2(r.shotLengths.pct(0.5))} / ${f2(r.shotLengths.pct(0.1))} / ${f2(r.shotLengths.vals.length ? Math.min(...r.shotLengths.vals) : 0)}`,
    'edit: rendered cuts within ±6 ticks of a strike': String(r.cutsNearStrike),
    'edit: ... of which the knockdown exception': String(r.cutsNearStrikeKd),
    'clipping: frames (all kinds)': String(Object.values(r.clip).reduce((a, b) => a + b, 0)),
    ...Object.fromEntries(Object.entries(r.clip).map(([k, v]) => [`clipping: ${k}`, String(v)])),
    'replay: angles / key subjects visible': `${r.replay.angles} / ${pc(r.replay.keyVisible, r.replay.angles)}`,
    'replay: key-instant centre distance median / max (NDC)': `${f2(r.replay.keyCentreDist.pct(0.5))} / ${f2(r.replay.keyCentreDist.max)}`,
    'replay: real-time aim speed p95 / max (screens/s)': `${f2(r.replay.speed.pct(0.95))} / ${f2(r.replay.speed.max)}`,
    'replay: cuts inside an angle': String(r.replay.cutsInside),
    'cost: director.update mean / p99 (ms)': `${r.updateMs.mean.toFixed(3)} / ${r.updateMs.pct(0.99).toFixed(3)}`,
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Posts and the top rail (as capsules) of a bounded cage / ring. */
export function cageCapsules(ca: CameraArena): Capsule[] {
  if (ca.shape === 'unbounded' || ca.wall === 'none' || ca.wallHeight <= 0) return [];
  const out: Capsule[] = [];
  const posts = postAzimuths(ca);
  const r = ca.circumradius + 0.05;
  const h = ca.wallHeight + 0.1;
  for (const a of posts) out.push({ a: [Math.sin(a) * r, 0.05, Math.cos(a) * r], b: [Math.sin(a) * r, h, Math.cos(a) * r], r: 0.15 });
  // Top rail (fence) / top rope (ring): between neighbouring posts.
  for (let k = 0; k < posts.length; k++) {
    const a0 = posts[k]!;
    const a1 = posts[(k + 1) % posts.length]!;
    out.push({ a: [Math.sin(a0) * r, ca.wallHeight, Math.cos(a0) * r], b: [Math.sin(a1) * r, ca.wallHeight, Math.cos(a1) * r], r: ca.wall === 'fence' ? 0.06 : 0.03 });
  }
  return out;
}

function segDist(p: V3, a: V3, b: V3): number {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = l > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l)) : 0;
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

const TRUSS_Y = 8.6;

/** The shots that may put the lens inside the fence (documented). */
function insideAllowed(kind: ShotKind, reason: string, phase: string): boolean {
  if (kind === 'overhead') return true;
  if (kind === 'follow' || kind === 'free' || kind === 'orbit') return true;
  if (kind === 'finish' && reason === 'post') return true;
  if (kind === 'corner' && phase === 'break') return true;
  return false;
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

export interface CamAuditOptions {
  fps?: number;
  windows?: [number, number][];
  /** Seconds of pre-roll (resting on the first frame) and post-roll. */
  pre?: number;
  post?: number;
  bodies: BodySource;
  /** Pin one shot (`lockShot`) or a user mode (`setRequest`). */
  lock?: ShotKind | null;
  request?: CameraRequest;
  /** Also play every planned replay angle. */
  replays?: boolean;
  aspect?: number;
  examples?: number;
  /** Called with each on-air state (captures). */
  onFrame?: (t: number, s: CameraState, d: BroadcastCameraDirector, pts: FighterPoints[]) => void;
}

interface Track {
  key: string;
  d: V3 | null;
  v: V3 | null;
  a: V3 | null;
  pos: V3 | null;
  tan: number;
  panSign: [number, number];
  panSignT: [number, number];
  accHigh: boolean;
}

const newTrack = (): Track => ({ key: '', d: null, v: null, a: null, pos: null, tan: 0, panSign: [0, 0], panSignT: [-9, -9], accHigh: false });

function pointsFor(frame: TickSnapshot, next: TickSnapshot | null, alpha: number, worlds: readonly WorldPose[], statures: number[]): FighterPoints[] {
  const out: FighterPoints[] = [];
  for (let i = 0; i < frame.fighters.length; i++) {
    const f = frame.fighters[i]!;
    const w = worlds[i];
    const valid = w && Number.isFinite(w.tip[B.head * 3 + 1]!) && (w.tip[B.head * 3 + 1]! > 0.05 || w.pos[B.hips * 3 + 1]! > 0.05);
    out.push(valid ? pointsFromWorldPose(f.id, w!, f) : standInPoints(frame, next, alpha, i, statures[i] ?? 1.8));
  }
  return out;
}

/** The engaged pair with the most strikes in the last 3 s (multi-fighter bouts). */
function primaryPair(frame: TickSnapshot, events: readonly SimEvent[]): number[] | null {
  if (frame.fighters.length <= 2) return null;
  const score = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'strike' || e.target < 0 || e.tick < frame.tick - 30) continue;
    const k = [Math.min(e.actor, e.target), Math.max(e.actor, e.target)].join(',');
    score.set(k, (score.get(k) ?? 0) + 1);
  }
  for (const g of frame.engagements) {
    if (g.b < 0) continue;
    const k = [Math.min(g.a, g.b), Math.max(g.a, g.b)].join(',');
    score.set(k, (score.get(k) ?? 0) + 2);
  }
  let best: string | null = null;
  let bs = 0;
  for (const [k, v] of score) if (v > bs) { bs = v; best = k; }
  return best ? best.split(',').map(Number) : null;
}

export function auditCamera(rec: CamRecording, opts: CamAuditOptions): CamResult {
  const R = newCamResult();
  const fps = opts.fps ?? 30;
  const dt = 1 / fps;
  const aspect = opts.aspect ?? 16 / 9;
  const bodies = opts.bodies;
  const frames = rec.frames;
  const events = rec.events;
  const d = createCameraDirector({ aspect });
  d.setBout(rec.bout, null);
  d.setRecording(frames, events);
  if (opts.lock) d.lockShot(opts.lock);
  if (opts.request) d.setRequest(opts.request);
  const ca = makeCameraArena(rec.bout.arena, null);
  const cage = cageCapsules(ca);
  const statures = rec.bout.runtimes.map((r) => r.body?.heightM ?? 1.8);
  const endT = frames[frames.length - 1]!.t;
  const t0 = frames[0]!.t;
  const exMax = opts.examples ?? 4;
  const note = (t: number, what: string, value: number, shot: string): void => {
    if (R.examples.length < 4000) R.examples.push({ t, what, value, shot, bout: rec.spec.name });
  };
  const tickOf = (t: number): number => {
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frames[m]!.t <= t + 1e-9) lo = m; else hi = m - 1; }
    return lo;
  };
  const evTicks = events.map((e) => e.tick);
  const upper = (tick: number): number => { let lo = 0, hi = evTicks.length; while (lo < hi) { const m = (lo + hi) >> 1; if (evTicks[m]! <= tick) lo = m + 1; else hi = m; } return lo; };
  const windowEvents = (from: number, to: number): SimEvent[] => events.slice(upper(from), upper(to));
  const strikeTimes = events.filter((e) => e.kind === 'strike').map((e) => e.tick * TICK_S + (e.subMs ?? 0) / 1000);
  const kdTicks = events.filter((e) => e.kind === 'knockdown').map((e) => e.tick);

  const tr = newTrack();
  let curT = 0;

  const measure = (s: CameraState, input: FrameInput, pts: FighterPoints[], holding: boolean, realDt: number, seek: boolean, t: number): void => {
    const dbg = d.debug();
    const kind = dbg.shot;
    const reason = dbg.reason;
    R.frames++;
    R.seconds += realDt;
    const bs = (R.byShot[kind] ??= { frames: 0, headOut: 0, occBad: 0, speed: new Stat(), jerk: new Stat(), fill: new Stat() });
    bs.frames++;
    const live = pts.filter((p) => p.posture !== 'out' || frames[0]!.fighters.length <= 2);
    const subjIds = dbg.subjects && dbg.subjects.length ? dbg.subjects : live.map((p) => p.id);
    const subjects = live.filter((p) => subjIds.includes(p.id));
    const subj = subjects.length ? subjects : live;
    const ndc = (p: V3): [number, number, number] => projectNdc(s, aspect, p);

    // ---- visibility -------------------------------------------------------------
    // The jib is a wide establishing move: its subject is the cage; skip the pair checks.
    const checkVis = kind !== 'jib';
    let anyHeadOut = false;
    if (checkVis) {
      for (const p of subj) {
        R.subj++;
        const h = ndc(p.head);
        const c = ndc(p.chest);
        const hp = ndc(p.hips);
        const out = (q: [number, number, number], m: number): boolean => q[2] <= 0 || Math.abs(q[0]) > m || Math.abs(q[1]) > m;
        if (out(h, 0.9)) { R.headOutSafe++; anyHeadOut = true; if (R.examples.length < 400) note(t, 'head outside safe', Math.max(Math.abs(h[0]), Math.abs(h[1])), kind); }
        // Torso = the chest (a head-and-shoulders or head-to-waist shot leaves the hips out by design).
        if (out(c, 0.9)) R.torsoOutSafe++;
        void hp;
        if (out(h, 1) && out(c, 1)) R.offScreen++;
      }
    }
    if (anyHeadOut) bs.headOut++;
    const prim = primaryPair(input.frame, input.events);
    if (prim && kind !== 'jib') {
      for (const id of prim) {
        const p = live.find((q) => q.id === id);
        if (!p) continue;
        R.primaryN++;
        const h = ndc(p.head);
        if (h[2] <= 0 || Math.abs(h[0]) > 0.9 || Math.abs(h[1]) > 0.9) R.primaryOut++;
      }
    }

    // ---- occlusion --------------------------------------------------------------
    const samples: SamplePoint[] = [];
    for (const p of subj) samples.push(...subjectSamples(p));
    const ref = bodies.referee();
    const refCaps = ref ? bodyCapsules(ref) : [];
    const crewCaps: Capsule[] = [];
    for (const w of bodies.extras()) crewCaps.push(...bodyCapsules(w));
    const otherCaps: Capsule[] = [];
    for (const p of live) if (!subj.includes(p)) otherCaps.push(...fighterCapsules(p));
    const cam = s.position as V3;
    const insideCage = insideWall(ca, cam[0], cam[2]);
    // The cage never hides anything from a lens inside it looking in, nor from the overhead.
    const cageOcc = insideCage || cam[1] > ca.wallHeight + 1.5 ? 0 : occlusion(cam, samples, cage);
    const oRef = refCaps.length ? occlusion(cam, samples, refCaps) : 0;
    const oCrew = crewCaps.length ? occlusion(cam, samples, crewCaps) : 0;
    const oF = otherCaps.length ? occlusion(cam, samples, otherCaps) : 0;
    const all = cage.length || refCaps.length || crewCaps.length
      ? occlusion(cam, samples, [...(insideCage || cam[1] > ca.wallHeight + 1.5 ? [] : cage), ...refCaps, ...crewCaps]) : 0;
    R.occReferee.add(oRef);
    R.occCage.add(cageOcc);
    R.occCrew.add(oCrew);
    R.occFighter.add(oF);
    if (all > 0.3 && kind !== 'jib') {
      R.occBad++;
      bs.occBad++;
      note(t, `occluded (ref ${oRef.toFixed(2)} cage ${cageOcc.toFixed(2)} crew ${oCrew.toFixed(2)}) lens ${cam.map((v) => v.toFixed(2)).join(", ")} subj ${subj.map((p) => p.head.map((v) => v.toFixed(1)).join(",")).join(" ")}`, all, kind);
    }

    // ---- composition ------------------------------------------------------------
    const spec = SHOTS[kind];
    if (kind !== 'jib' && kind !== 'free' && kind !== 'orbit') {
      const standing = subj.every((p) => p.posture === 'standing' || p.posture === 'clinch');
      // The set the shot is meant to hold: a pinned corner camera during a
      // round and the low handheld on standing fighters frame head to waist.
      const set = kind === 'corner' ? (input.frame.phase === 'round' ? 'torso' : 'face')
        : spec.framing === 'full' ? 'full' : standing ? (kind === 'ground' ? 'torso' : spec.framing) : 'ground';
      const fp = framingPoints(subj, set as 'full' | 'torso' | 'face' | 'ground');
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      for (const q of fp) {
        const n = ndc(q);
        if (n[2] <= 0) continue;
        xmin = Math.min(xmin, n[0]); xmax = Math.max(xmax, n[0]); ymin = Math.min(ymin, n[1]); ymax = Math.max(ymax, n[1]);
      }
      if (Number.isFinite(xmin)) {
        const fill = Math.max((xmax - xmin) / 2, (ymax - ymin) / 2);
        R.fillN++;
        R.fillRatio.add(fill / spec.safe);
        bs.fill.add(fill);
        if (subj.every((p) => p.posture === 'ground')) (R.fillGround[kind] ??= new Stat()).add(fill);
        if (fill > 0.95) R.fillTight++;
        if (fill < 0.3) R.fillLoose++;
        if (standing && kind !== 'overhead') {
          let top = -Infinity;
          for (const p of subj) top = Math.max(top, ndc(p.crown)[1]);
          const headroom = (1 - top) / 2;
          R.headroomN++;
          if (headroom < 0.02) R.headroomLow++;
          if (headroom > 0.3 && set !== 'full') R.headroomHigh++;
        }
      }
    }
    const rollDeg = Math.abs(s.rollRad) * 180 / Math.PI;
    R.rollDeg.add(rollDeg);

    // ---- motion -----------------------------------------------------------------
    const key = `${dbg.source}:${dbg.entryIndex}:${dbg.shot}:${dbg.label}`;
    const tanHalf = Math.tan((s.fovDeg * Math.PI) / 360);
    // Judged on the operator's aim (before the deliberate handheld float and strike shake).
    const aimOp = dbg.aim ?? s.target;
    const dx = aimOp[0] - s.position[0], dy = aimOp[1] - s.position[1], dz = aimOp[2] - s.position[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    const dir: V3 = [dx / dl, dy / dl, dz / dl];
    if (s.cut || seek || key !== tr.key || realDt <= 0) {
      tr.key = key; tr.d = dir; tr.v = null; tr.a = null; tr.pos = [...s.position] as V3; tr.tan = tanHalf; tr.panSign = [0, 0]; tr.accHigh = false;
    } else {
      const v: V3 = [(dir[0] - tr.d![0]) / realDt, (dir[1] - tr.d![1]) / realDt, (dir[2] - tr.d![2]) / realDt];
      const scr = Math.hypot(v[0], v[1], v[2]) / (2 * tanHalf);
      const shaking = (dbg.shake ?? 0) !== 0;
      R.motionSeconds += realDt;
      R.screenSpeed.add(scr);
      bs.speed.add(scr);
      R.lensSpeed.add(Math.hypot(s.position[0] - tr.pos![0], s.position[1] - tr.pos![1], s.position[2] - tr.pos![2]) / realDt);
      R.zoomRate.add(Math.abs(Math.log(tanHalf / tr.tan)) / realDt);
      // Pan / tilt components in the camera's right / up axes.
      const right: V3 = [-dir[2], 0, dir[0]];
      const rl = Math.hypot(right[0], right[2]) || 1;
      const pan = (v[0] * right[0] + v[2] * right[2]) / rl / (2 * tanHalf);
      const tilt = v[1] / (2 * tanHalf);
      [pan, tilt].forEach((c, k) => {
        if (Math.abs(c) < 0.04) return;
        const sg = Math.sign(c);
        if (tr.panSign[k] !== 0 && sg !== tr.panSign[k] && t - tr.panSignT[k] < 0.6 && !shaking) R.reversals++;
        if (sg !== tr.panSign[k]) { tr.panSign[k] = sg; }
        tr.panSignT[k] = t;
      });
      if (tr.v) {
        const a: V3 = [(v[0] - tr.v[0]) / realDt, (v[1] - tr.v[1]) / realDt, (v[2] - tr.v[2]) / realDt];
        const acc = Math.hypot(a[0], a[1], a[2]) / (2 * tanHalf);
        const high = acc > 3 && !shaking;
        if (high && !tr.accHigh) { R.reframes++; if (R.examples.length < 400) note(t, 'sudden reframe', acc, kind); }
        tr.accHigh = acc > 1.5;
        if (tr.a && !shaking) {
          const j = Math.hypot(a[0] - tr.a[0], a[1] - tr.a[1], a[2] - tr.a[2]) / realDt / (2 * tanHalf);
          R.jerk.add(j);
          bs.jerk.add(j);
        }
        tr.a = a;
      }
      tr.v = v; tr.d = dir; tr.pos = [...s.position] as V3; tr.tan = tanHalf;
    }
    // Lead room: the subjects crossing the frame should have more room ahead.
    if (kind !== 'jib' && subj.length && !holding && tr.v) {
      let vx = 0, vz = 0;
      for (const p of subj) { vx += p.velocity[0]; vz += p.velocity[1]; }
      vx /= subj.length; vz /= subj.length;
      const right: V3 = [-dir[2], 0, dir[0]];
      const rl = Math.hypot(right[0], right[2]) || 1;
      const lateral = (vx * right[0] + vz * right[2]) / rl;
      if (Math.abs(lateral) > 1.2) {
        let xmin = Infinity, xmax = -Infinity;
        for (const p of subj) for (const q of [p.head, p.hips]) { const n = ndc(q); xmin = Math.min(xmin, n[0]); xmax = Math.max(xmax, n[0]); }
        const ahead = lateral > 0 ? 1 - xmax : xmin + 1;
        const behind = lateral > 0 ? xmin + 1 : 1 - xmax;
        R.leadN++;
        if (ahead < behind - 0.15) R.leadBad++;
      }
    }

    // ---- the edit ---------------------------------------------------------------
    if (!holding && dbg.source === 'plan') {
      R.liveSeconds += realDt;
      if (s.cut && !seek) {
        R.cuts++;
        const tt = input.simTime;
        const near = strikeTimes.some((c) => Math.abs(c - tt) < 0.4 - 1e-6);
        if (near) {
          const kd = kdTicks.some((k) => tt >= k * TICK_S && tt - k * TICK_S < 4);
          if (kd && reason === 'knockdown') R.cutsNearStrikeKd++;
          else { R.cutsNearStrike++; note(t, 'cut near strike', 0, kind); }
        }
      }
    }
    // ---- clipping ---------------------------------------------------------------
    const clip = (k: string): void => {
      R.clip[k] = (R.clip[k] ?? 0) + 1;
      if (R.examples.length < 400) note(t, `clip ${k} (lens ${cam.map((v) => v.toFixed(2)).join(', ')})`, 0, kind);
    };
    const [x, y, z] = cam;
    if (!Number.isFinite(x + y + z + s.fovDeg)) clip('non-finite');
    if (y < 0.2) clip('below floor');
    if (ca.shape !== 'unbounded') {
      const r = Math.hypot(x, z);
      if (insideCage && y < ca.wallHeight + 1.5 && !insideAllowed(kind, reason, input.frame.phase)) clip('inside fence volume');
      const wd = wallDistanceAt(ca, Math.atan2(x, z));
      if (y < ca.wallHeight + 0.15 && Math.abs(r - wd) < 0.15) clip('in the fence mesh');
      for (const c of cage) if (segDist(cam, c.a, c.b) < c.r + 0.12) { clip('post / rail'); break; }
      if (y > TRUSS_Y - 0.4 && r < ca.circumradius + 2.5) clip('lighting rig');
      if (r > ca.outerRadius) clip('outside building');
    }
    let inBody = false;
    const caps: Capsule[] = [...refCaps, ...crewCaps];
    for (const p of live) caps.push(...fighterCapsules(p));
    let nearBody = false;
    for (const c of caps) {
      const d = segDist(cam, c.a, c.b) - c.r;
      if (d < 0.12) { inBody = true; break; }
      if (d < 0.4) nearBody = true;
    }
    if (inBody) clip('inside a body');
    // A head or a back filling the lens (a composition failure, not a render one).
    else if (nearBody) clip('body within 0.4 m of the lens');
  };

  // ---- the live pass -------------------------------------------------------------
  const windows = opts.windows ?? [[t0, endT]];
  let lastT = -1;
  const step = (t: number, seek: boolean, holding: 'pre' | 'post' | null): void => {
    curT = t;
    const k = tickOf(t);
    const F0 = frames[k]!;
    const F1n = frames[k + 1] ?? null;
    const F1 = holding ? (holding === 'pre' ? F1n : null) : F1n && F1n.tick === F0.tick + 1 ? F1n : null;
    const alpha = F1 && !holding ? Math.max(0, Math.min(1, (t - F0.t) / Math.max(1e-6, F1.t - F0.t))) : 0;
    const input: FrameInput = {
      frame: F0, next: F1, alpha, simTime: holding ? F0.t : F1 ? t : F0.t,
      events: windowEvents(F0.tick - 20, Math.max(F0.tick, F1?.tick ?? F0.tick)),
      playbackRate: 1, replay: false, discontinuity: seek,
    };
    const worlds = bodies.update(input, dt);
    d.setReferee(bodies.referee());
    d.setExtraBodies(bodies.extras());
    d.setPostClock(bodies.postClock());
    d.setReplay(null);
    const c0 = performance.now();
    const s = d.update(input, worlds, dt);
    R.updateMs.add(performance.now() - c0);
    const pts = pointsFor(F0, F1, alpha, worlds, statures);
    opts.onFrame?.(t, s, d, pts);
    measure(s, input, pts, holding !== null, dt, seek, t);
    lastT = t;
  };
  void lastT;
  const pre = opts.pre ?? 0;
  let first = true;
  if (pre > 0 && windows[0]![0] <= t0 + 1e-6) {
    for (let k = 0; k < Math.round(pre / dt); k++) { step(t0, first, 'pre'); first = false; }
  }
  for (const [a, b0] of windows) {
    const b = Math.min(b0, endT);
    let wFirst = true;
    for (let k = 0; ; k++) {
      const t = a + k * dt;
      if (t > b + 1e-9) break;
      step(t, first || wFirst, null);
      first = false;
      wFirst = false;
    }
  }
  if ((opts.post ?? 0) > 0 && windows[windows.length - 1]![1] >= endT - 1e-6) {
    for (let k = 0; k < Math.round(opts.post! / dt); k++) step(endT, false, 'post');
  }

  // ---- the edit: planned live shot lengths --------------------------------------
  const plan = d.plan;
  if (plan && !opts.lock && !opts.request) {
    const es = plan.entries;
    for (let i = 0; i + 1 < es.length; i++) {
      const e = es[i]!;
      if (e.reason === 'intro' || e.reason === 'post' || e.startTick > plan.lastTick) continue;
      const end = Math.min(es[i + 1]!.startT, plan.lastTick * TICK_S);
      if (end > e.startT) R.shotLengths.add(end - e.startT);
    }
  }

  // ---- replays -------------------------------------------------------------------
  if (opts.replays && !opts.lock && !opts.request) {
    const plans: ReplayPlan[] = planReplays(events, frames);
    const realFps = 60;
    for (const plan of plans) {
      for (let si = 0; si < plan.segments.length; si++) {
        const seg = plan.segments[si]!;
        const state: ReplayState = { plan, segmentIndex: si, segment: seg, wipeKey: 0 };
        d.setReplay(state);
        const from = seg.fromTick * TICK_S;
        const to = seg.toTick * TICK_S;
        const sdt = seg.speed / realFps;
        const trR = newTrack();
        let keyChecked = false;
        let firstR = true;
        for (let t = from; t <= to + 1e-9; t += sdt) {
          const k = tickOf(t);
          const F0 = frames[k]!;
          const F1n = frames[k + 1] ?? null;
          const F1 = F1n && F1n.tick === F0.tick + 1 ? F1n : null;
          const alpha = F1 ? Math.max(0, Math.min(1, (t - F0.t) / (F1.t - F0.t))) : 0;
          const input: FrameInput = {
            frame: F0, next: F1, alpha, simTime: F1 ? t : F0.t,
            events: windowEvents(F0.tick - 20, Math.max(F0.tick, F1?.tick ?? F0.tick)),
            playbackRate: seg.speed, replay: true, discontinuity: firstR,
          };
          const worlds = bodies.update(input, 1 / realFps);
          d.setReferee(bodies.referee());
          d.setExtraBodies(bodies.extras());
          d.setPostClock(null);
          const c0 = performance.now();
          const s = d.update(input, worlds, 1 / realFps);
          R.updateMs.add(performance.now() - c0);
          const pts = pointsFor(F0, F1, alpha, worlds, statures);
          if (!firstR && s.cut) R.replay.cutsInside++;
          // Real-time steadiness.
          const tanHalf = Math.tan((s.fovDeg * Math.PI) / 360);
          const dx = s.target[0] - s.position[0], dy = s.target[1] - s.position[1], dz = s.target[2] - s.position[2];
          const dl = Math.hypot(dx, dy, dz) || 1;
          const dir: V3 = [dx / dl, dy / dl, dz / dl];
          if (trR.d && !firstR) {
            const scr = Math.hypot(dir[0] - trR.d[0], dir[1] - trR.d[1], dir[2] - trR.d[2]) * realFps / (2 * tanHalf);
            R.replay.speed.add(scr);
          }
          trR.d = dir;
          if (!keyChecked && t >= plan.keyTime - 1e-9) {
            keyChecked = true;
            R.replay.angles++;
            const ids = [plan.target, plan.striker].filter((x) => x >= 0);
            const ps = pts.filter((p) => ids.includes(p.id));
            const use = ps.length ? ps : pts;
            let ok = true;
            let cx = 0, cy = 0;
            for (const p of use) {
              const h = projectNdc(s, aspect, p.head);
              if (h[2] <= 0 || Math.abs(h[0]) > 0.9 || Math.abs(h[1]) > 0.9) ok = false;
              cx += h[0] / use.length; cy += h[1] / use.length;
            }
            if (ok) R.replay.keyVisible++;
            else note(plan.keyTime, `replay ${plan.id}#${si} key subject outside`, 1, s.shotName);
            R.replay.keyCentreDist.add(Math.hypot(cx, cy));
          }
          firstR = false;
        }
      }
    }
    d.setReplay(null);
  }
  // Keep the worst few examples per kind.
  const byWhat = new Map<string, CamResult['examples']>();
  for (const e of R.examples) {
    const k = e.what.split(' (')[0]!;
    (byWhat.get(k) ?? byWhat.set(k, []).get(k)!).push(e);
  }
  R.examples = [...byWhat.values()].flatMap((l) => l.sort((a, b) => b.value - a.value).slice(0, exMax));
  return R;
}
