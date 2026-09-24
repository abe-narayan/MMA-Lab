/**
 * ANIMATION QA HARNESS — shared by `scripts/dev/anim-audit.ts` (the full audit
 * over a representative set of recorded bouts) and
 * `tests/presentation.anim-quality.test.ts` (a short regression guard).
 *
 * It plays a recorded bout through the same pipeline the presenter runs
 * (animator → corner staging → post-fight staging → forward kinematics) at a
 * fixed frame rate, with one extra sample on every strike's recorded contact
 * instant, and measures the RENDERED poses against the sim's recorded state:
 *
 *   footSlide     a foot whose ball (ToeBase joint) is on the floor in two
 *                 consecutive frames should not move horizontally (cm / frame);
 *   hipFreeze     the sim says the fighter moves (> 0.6 m/s) but the rendered
 *                 hips stay put (< 0.15 m/s);
 *   jointLimits   elbow / knee hyperextension (< -5°) and over-flexion, knee vs
 *                 foot twist (tibial rotation > 45° on a bent knee), spine twist
 *                 (> 50°), flexion (> 85°) / extension (> 35°) / side bend (> 40°),
 *                 neck yaw (> 80°), flexion (> 60°) / extension (> 65°), roll (> 45°);
 *   pops          per-bone angular speed spikes above a threshold that no own
 *                 strike, no incoming strike and no seek explains, and hips
 *                 translation jumps;
 *   groundPen     joints (with their flesh radius) below the floor;
 *   interpen      head spheres and torso capsules of different fighters
 *                 (engaged pairs also on the pair solver's firm-body capsules)
 *                 overlapping (standing: > 2 cm; engaged: > 5 cm);
 *   contact       at the recorded contact instant of every landed / blocked
 *                 standing strike, the weapon's distance to the target surface
 *                 (head sphere, torso capsule, thigh capsule, or the blocking arm);
 *   disagreement  rendered state vs sim state: posture ground/down but the body
 *                 rendered upright; standing but rendered low; clinch but chests
 *                 apart; stance (which foot leads) vs the sim's stance; chest not
 *                 facing the opponent in open standing.
 *
 * Everything is measured on the output poses only (no animator internals except
 * the mode / debug layer used to bucket and explain), so it applies equally to
 * the grapple solver, the fall poses, the corner walk and the post-fight script.
 * Deterministic: no Math.random; the timing numbers are the only wall-clock data.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARCHETYPES, DEFAULT_SETTINGS, createSim, deriveRuntime, resolveParams,
  type FighterDefinition, type SimConfig, type SimEvent, type StrikeEvent, type TickSnapshot,
} from '../../src/sim';
import { StandingAnimator } from '../../src/presentation/anim/animator';
import { registerMotionLibrary } from '../../src/presentation/anim/capture';
import '../../src/presentation/anim/grapple';
import { MotionLibrary, type MotionManifest } from '../../src/presentation/assets/motionLibrary';
import { buildBoutPresentation } from '../../src/presentation/stage/bout';
import { restFor } from '../../src/presentation/placeholders/debugSkeleton';
import { CornerRest } from '../../src/presentation/corner';
import { coreCapsules } from '../../src/presentation/anim/grapple/capsules';
import { FinishStage } from '../../src/presentation/finish';
import type { BoutPresentation, FrameInput } from '../../src/presentation/contract';
import {
  B, createPose, createWorldPose, forwardKinematics, type Pose, type RestSkeleton, type WorldPose,
} from '../../src/presentation/rig/skeleton';

type V3 = [number, number, number];
const DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface AuditBoutSpec {
  name: string;
  seed: string;
  ruleset: string;
  fighters: string[];
  mode?: '1v1' | 'teams';
  teamOf?: number[];
  arena?: string;
}

export interface Recording {
  spec: AuditBoutSpec;
  cfg: SimConfig;
  bout: BoutPresentation;
  frames: TickSnapshot[];
  events: SimEvent[];
  rests: RestSkeleton[];
}

const ARCH = Object.values(ARCHETYPES) as FighterDefinition[];
function arch(id: string, uniq: string): FighterDefinition {
  const a = ARCH.find((x) => x.id === id);
  if (!a) throw new Error(`no archetype ${id}`);
  const c = JSON.parse(JSON.stringify(a)) as FighterDefinition;
  c.id = `${id}#${uniq}`;
  return c;
}

/** Record a whole bout (every tick). */
export function recordBout(spec: AuditBoutSpec): Recording {
  const fighters = spec.fighters.map((id, i) => arch(id, String(i)));
  const mode = spec.mode ?? '1v1';
  const cfg: SimConfig = {
    seed: spec.seed, mode, fighters,
    teams: { teamOf: spec.teamOf ?? fighters.map((_, i) => Math.min(i, 1)) },
    ruleset: spec.ruleset as SimConfig['ruleset'],
    arena: (spec.arena ?? 'octagon_30') as SimConfig['arena'],
    settings: DEFAULT_SETTINGS,
  };
  const params = resolveParams(cfg.paramOverrides);
  const bout = buildBoutPresentation({
    config: cfg, fighters, runtimes: fighters.map((f) => deriveRuntime(f, params, { explain: false })),
  });
  const sim = createSim(cfg);
  const frames = [sim.snapshot()];
  while (sim.step()) frames.push(sim.snapshot());
  frames.push(sim.snapshot()); // the app records the final (ended) state too
  const rests = fighters.map((_, i) => restFor(bout, i));
  return { spec, cfg, bout, frames, events: [...sim.events], rests };
}

/**
 * The windows an audit plays (sim seconds): the opening 150 s, the first
 * break (the corner staging), and the last 45 s (the finish). A short bout is
 * played whole.
 */
export function auditWindows(rec: Pick<Recording, 'frames' | 'events'>, full = false): [number, number][] {
  const end = rec.frames[rec.frames.length - 1]!.t;
  if (full || end <= 200) return [[0, end]];
  const w: [number, number][] = [[0, 150]];
  const re = rec.events.find((e) => e.kind === 'roundEnd');
  const rs = re ? rec.events.find((e) => e.kind === 'roundStart' && e.tick > re.tick) : undefined;
  if (re && rs && rs.tick / 10 < end - 50) w.push([Math.max(150, re.tick / 10 - 8), rs.tick / 10 + 4]);
  w.push([Math.max(w[w.length - 1]![1], end - 45), end]);
  return w.filter(([a, b]) => b > a);
}

/**
 * Record (or load from `dir`) a bout for auditing. The sim is being tuned while
 * this pass runs, so before / after comparisons must play the SAME recording:
 * the cache keeps the bout presentation and only the frames the windows need
 * (plus the round boundaries and the last frame), so it stays small.
 */
export function cachedRecording(spec: AuditBoutSpec, dir: string, refresh = false): Recording {
  const file = join(dir, `${spec.name}.json`);
  if (!refresh && existsSync(file)) {
    const d = JSON.parse(readFileSync(file, 'utf8')) as { bout: BoutPresentation; frames: TickSnapshot[]; events: SimEvent[] };
    const rests = d.bout.fighters.map((_, i) => restFor(d.bout, i));
    return { spec, cfg: null as unknown as SimConfig, bout: d.bout, frames: d.frames, events: d.events, rests };
  }
  const rec = recordBout(spec);
  const wins = auditWindows(rec);
  const keepTicks = new Set<number>();
  for (const e of rec.events) if (e.kind === 'roundEnd' || e.kind === 'roundStart') keepTicks.add(e.tick);
  const frames = rec.frames.filter((f, i) => i === rec.frames.length - 1 || keepTicks.has(f.tick)
    || wins.some(([a, b]) => f.t >= a - 0.2 && f.t <= b + 0.2));
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ bout: rec.bout, frames, events: rec.events }));
  return { ...rec, frames };
}

let motionLib: MotionLibrary | null | undefined;
/** The shipped motion library, decoded from `static/assets/motion`. */
export function loadMotion(root = process.cwd()): MotionLibrary {
  if (motionLib) return motionLib;
  motionLib = MotionLibrary.fromData(
    JSON.parse(readFileSync(join(root, 'static/assets/motion/manifest.json'), 'utf8')) as MotionManifest,
    readFileSync(join(root, 'static/assets/motion/motion.bin')),
  );
  return motionLib;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type Bucket = 'standing' | 'engaged' | 'down' | 'getup' | 'corner' | 'post';
export const BUCKETS: Bucket[] = ['standing', 'engaged', 'down', 'getup', 'corner', 'post'];

class Stat {
  n = 0; sum = 0; max = 0; over = 0;
  private vals: number[] = [];
  constructor(private readonly overAt: number, private readonly keep = true) {}
  add(v: number): void {
    this.n++; this.sum += v; if (v > this.max) this.max = v; if (v > this.overAt) this.over++;
    if (this.keep) this.vals.push(v);
  }
  get mean(): number { return this.n ? this.sum / this.n : 0; }
  pct(p: number): number {
    if (!this.vals.length) return 0;
    const s = [...this.vals].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  }
  merge(o: Stat): void {
    this.n += o.n; this.sum += o.sum; this.max = Math.max(this.max, o.max); this.over += o.over;
    if (this.keep) for (const v of o.vals) this.vals.push(v);
  }
}

export interface Example { bout: string; t: number; fighter: number; what: string; value: number; layer: string }

export interface AuditResult {
  frames: number;
  /** Fighter-frames per bucket. */
  fighterFrames: Record<Bucket, number>;
  footSlide: Record<Bucket, Stat>;
  hipFreeze: { frames: number; moving: number; longestMs: number };
  joint: Record<string, number>;
  jointFrames: number;
  pops: { rot: Record<Bucket, number>; trans: Record<Bucket, number>; perMin: number };
  groundPen: Record<Bucket, Stat>;
  interpen: { standing: Stat; engaged: Stat; limbStanding: Stat; engagedCore: Stat };
  contact: { surface: Stat; inRange: Stat; aim: Stat; count: number; missing: number };
  disagree: Record<string, number>;
  disagreeBase: Record<string, number>;
  evalMs: Stat;
  /** evaluate() cost with both fighters standing (the budgeted case). */
  evalStandMs: Stat;
  examples: Example[];
  /** Diagnostic: unexplained rotation pops by bucket:bone:layer. */
  popHist: Record<string, number>;
  /** Diagnostic: joint-limit frames by limit:bucket:layer. */
  jointHist: Record<string, number>;
}

function newResult(): AuditResult {
  const per = <T>(f: () => T): Record<Bucket, T> => Object.fromEntries(BUCKETS.map((b) => [b, f()])) as Record<Bucket, T>;
  return {
    frames: 0,
    fighterFrames: per(() => 0),
    footSlide: per(() => new Stat(0.5)),
    hipFreeze: { frames: 0, moving: 0, longestMs: 0 },
    joint: {},
    jointFrames: 0,
    pops: { rot: per(() => 0), trans: per(() => 0), perMin: 0 },
    groundPen: per(() => new Stat(1)),
    interpen: { standing: new Stat(2), engaged: new Stat(5), limbStanding: new Stat(5), engagedCore: new Stat(2) },
    contact: { surface: new Stat(5), inRange: new Stat(5), aim: new Stat(3), count: 0, missing: 0 },
    disagree: {},
    disagreeBase: {},
    evalMs: new Stat(1),
    evalStandMs: new Stat(1),
    examples: [],
    popHist: {},
    jointHist: {},
  };
}

export function mergeResults(rs: AuditResult[]): AuditResult {
  const o = newResult();
  for (const r of rs) {
    o.frames += r.frames;
    for (const b of BUCKETS) {
      o.fighterFrames[b] += r.fighterFrames[b];
      o.footSlide[b].merge(r.footSlide[b]);
      o.groundPen[b].merge(r.groundPen[b]);
      o.pops.rot[b] += r.pops.rot[b];
      o.pops.trans[b] += r.pops.trans[b];
    }
    o.hipFreeze.frames += r.hipFreeze.frames;
    o.hipFreeze.moving += r.hipFreeze.moving;
    o.hipFreeze.longestMs = Math.max(o.hipFreeze.longestMs, r.hipFreeze.longestMs);
    for (const [k, v] of Object.entries(r.joint)) o.joint[k] = (o.joint[k] ?? 0) + v;
    o.jointFrames += r.jointFrames;
    o.interpen.standing.merge(r.interpen.standing);
    o.interpen.engaged.merge(r.interpen.engaged);
    o.interpen.limbStanding.merge(r.interpen.limbStanding);
    o.interpen.engagedCore.merge(r.interpen.engagedCore);
    o.contact.surface.merge(r.contact.surface);
    o.contact.inRange.merge(r.contact.inRange);
    o.contact.aim.merge(r.contact.aim);
    o.contact.count += r.contact.count;
    o.contact.missing += r.contact.missing;
    for (const [k, v] of Object.entries(r.disagree)) o.disagree[k] = (o.disagree[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.disagreeBase)) o.disagreeBase[k] = (o.disagreeBase[k] ?? 0) + v;
    o.evalMs.merge(r.evalMs);
    o.evalStandMs.merge(r.evalStandMs);
    o.examples.push(...r.examples);
    for (const [k, v] of Object.entries(r.popHist)) o.popHist[k] = (o.popHist[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.jointHist)) o.jointHist[k] = (o.jointHist[k] ?? 0) + v;
  }
  const fighterMin = BUCKETS.reduce((s, b) => s + o.fighterFrames[b], 0) / 60 / 60;
  const pops = BUCKETS.reduce((s, b) => s + o.pops.rot[b] + o.pops.trans[b], 0);
  o.pops.perMin = fighterMin > 0 ? pops / fighterMin : 0;
  return o;
}

/** A debug layer reduced to its family (no clip ids, no reaction suffix). */
function layerKey(layer: string): string {
  return layer.replace(/[mocap [^]]*]/, '[mocap]').replace(/ +L2$/, '').replace(/^(grapple [^ ]+).*$/, '$1');
}

// ---- geometry helpers ------------------------------------------------------

const P = (w: WorldPose, b: number): V3 => [w.pos[b * 3]!, w.pos[b * 3 + 1]!, w.pos[b * 3 + 2]!];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const n = len(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
function qrotW(w: WorldPose, b: number, v: V3): V3 {
  const o = b * 4;
  const x = w.quat[o]!, y = w.quat[o + 1]!, z = w.quat[o + 2]!, s = w.quat[o + 3]!;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + s * tx + (y * tz - z * ty), v[1] + s * ty + (z * tx - x * tz), v[2] + s * tz + (x * ty - y * tx)];
}
function qrel(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number): number {
  const d = Math.abs(a[ao]! * b[bo]! + a[ao + 1]! * b[bo + 1]! + a[ao + 2]! * b[bo + 2]! + a[ao + 3]! * b[bo + 3]!);
  return 2 * Math.acos(Math.min(1, d));
}
/** YXZ euler of conj(qa) * qb (b relative to a), matching the animator's qypr. */
function relEuler(w: WorldPose, a: number, b: number): [number, number, number] {
  const ao = a * 4, bo = b * 4;
  const ax = -w.quat[ao]!, ay = -w.quat[ao + 1]!, az = -w.quat[ao + 2]!, aw = w.quat[ao + 3]!;
  const bx = w.quat[bo]!, by = w.quat[bo + 1]!, bz = w.quat[bo + 2]!, bw = w.quat[bo + 3]!;
  const x = aw * bx + ax * bw + ay * bz - az * by;
  const y = aw * by - ax * bz + ay * bw + az * bx;
  const z = aw * bz + ax * by - ay * bx + az * bw;
  const s = aw * bw - ax * bx - ay * by - az * bz;
  const m02 = 2 * (x * z + s * y), m22 = 1 - 2 * (x * x + y * y);
  const m12 = 2 * (y * z - s * x), m10 = 2 * (x * y + s * z), m11 = 1 - 2 * (x * x + z * z);
  return [Math.atan2(m02, m22), Math.asin(Math.max(-1, Math.min(1, -m12))), Math.atan2(m10, m11)];
}
function segPoint(p: V3, a: V3, b: V3): number {
  const ab = sub(b, a), ap = sub(p, a);
  const t = Math.max(0, Math.min(1, dot(ab, ap) / Math.max(1e-9, dot(ab, ab))));
  return len([ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t]);
}
function segSeg(p1: V3, q1: V3, p2: V3, q2: V3): number {
  // Closest distance between segments (Ericson).
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s: number, t: number;
  if (a <= 1e-9 && e <= 1e-9) return len(r);
  if (a <= 1e-9) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-9) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  const c1: V3 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const c2: V3 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return len(sub(c1, c2));
}
export function headCentreW(w: WorldPose): V3 {
  const o = B.head * 3;
  return [(w.pos[o]! + w.tip[o]!) / 2, (w.pos[o + 1]! + w.tip[o + 1]!) / 2, (w.pos[o + 2]! + w.tip[o + 2]!) / 2];
}
function fist(w: WorldPose, side: 0 | 1, scale: number): V3 {
  const f = P(w, side === 0 ? B.lForeArm : B.rForeArm), h = P(w, side === 0 ? B.lHand : B.rHand);
  const d = norm(sub(h, f));
  const k = 0.085 * scale;
  return [h[0] + d[0] * k, h[1] + d[1] * k, h[2] + d[2] * k];
}

/** Signed flexion (radians, + = anatomical flexion) of a two-bone limb. */
function flexion(w: WorldPose, rest: RestSkeleton, upper: number, lower: number, end: number, hinge: V3): number {
  const u = norm(sub(P(w, lower), P(w, upper)));
  const l = norm(sub(P(w, end), P(w, lower)));
  const rd: V3 = norm([rest.head[lower * 3]! - rest.head[upper * 3]!, rest.head[lower * 3 + 1]! - rest.head[upper * 3 + 1]!, rest.head[lower * 3 + 2]! - rest.head[upper * 3 + 2]!]);
  const k = dot(hinge, rd);
  const h0 = norm([hinge[0] - k * rd[0], hinge[1] - k * rd[1], hinge[2] - k * rd[2]]);
  const hw = qrotW(w, upper, h0);
  return Math.atan2(dot(cross(u, l), hw), dot(u, l));
}

/** Tibial rotation: the angle between where the knee points and where the foot points, on a bent knee. */
function kneeFootTwist(w: WorldPose, hip: number, knee: number, ankle: number, toe: number): number | null {
  const H = P(w, hip), K = P(w, knee), A = P(w, ankle), T = P(w, toe);
  const s = norm(sub(A, K));
  const th = norm(sub(K, H));
  if (-s[1] < Math.cos(45 / DEG)) return null; // a kneeling / lying shin: tibial rotation does not read
  if (dot(s, th) > Math.cos(20 / DEG)) return null; // nearly straight: the knee has no direction
  // The knee points along the thigh's component perpendicular to the shin.
  const kf = sub(th, [s[0] * dot(th, s), s[1] * dot(th, s), s[2] * dot(th, s)]);
  const ft = sub(T, A);
  const ff = sub(ft, [s[0] * dot(ft, s), s[1] * dot(ft, s), s[2] * dot(ft, s)]);
  if (len(kf) < 1e-4 || len(ff) < 1e-4) return null;
  return Math.acos(Math.max(-1, Math.min(1, dot(norm(kf), norm(ff)))));
}

const POP_BONES: { b: number; parent: number | null; lim: number; name: string; torso: boolean; limb: 0 | 1 | -1; leg: boolean }[] = [
  { b: B.hips, parent: null, lim: 540, name: 'hips', torso: true, limb: -1, leg: false },
  { b: B.spine2, parent: B.hips, lim: 480, name: 'chest', torso: true, limb: -1, leg: false },
  { b: B.head, parent: B.spine2, lim: 600, name: 'head', torso: true, limb: -1, leg: false },
  { b: B.lArm, parent: B.spine2, lim: 1100, name: 'lUpperArm', torso: false, limb: 0, leg: false },
  { b: B.lForeArm, parent: B.lArm, lim: 1500, name: 'lForearm', torso: false, limb: 0, leg: false },
  { b: B.rArm, parent: B.spine2, lim: 1100, name: 'rUpperArm', torso: false, limb: 1, leg: false },
  { b: B.rForeArm, parent: B.rArm, lim: 1500, name: 'rForearm', torso: false, limb: 1, leg: false },
  { b: B.lUpLeg, parent: B.hips, lim: 900, name: 'lThigh', torso: false, limb: 0, leg: true },
  { b: B.lLeg, parent: B.lUpLeg, lim: 1200, name: 'lShin', torso: false, limb: 0, leg: true },
  { b: B.rUpLeg, parent: B.hips, lim: 900, name: 'rThigh', torso: false, limb: 1, leg: true },
  { b: B.rLeg, parent: B.rUpLeg, lim: 1200, name: 'rShin', torso: false, limb: 1, leg: true },
];

/** Relative rotation of bone b to its parent (world quats), as a quaternion in a scratch array. */
function relQuat(w: WorldPose, b: number, parent: number | null, out: Float64Array, o: number): void {
  const bo = b * 4;
  if (parent === null) { for (let k = 0; k < 4; k++) out[o + k] = w.quat[bo + k]!; return; }
  const po = parent * 4;
  const ax = -w.quat[po]!, ay = -w.quat[po + 1]!, az = -w.quat[po + 2]!, aw = w.quat[po + 3]!;
  const bx = w.quat[bo]!, by = w.quat[bo + 1]!, bz = w.quat[bo + 2]!, bw = w.quat[bo + 3]!;
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

// Flesh radii of joints for ground penetration (m at scale 1).
const GROUND_JOINTS: [number, number][] = [
  [B.lToe, 0.012], [B.rToe, 0.012], [B.lFoot, 0.04], [B.rFoot, 0.04], [B.lLeg, 0.04], [B.rLeg, 0.04],
  [B.lHand, 0.02], [B.rHand, 0.02], [B.hips, 0.07], [B.spine2, 0.08], [B.head, 0.07],
];

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------

export interface AuditOptions {
  fps?: number;
  /** Sim-second windows to play; a gap between windows is a seek. Default: the whole bout. */
  windows?: [number, number][];
  /** Seconds of post-roll after the last frame (stoppages / decisions). */
  post?: number;
  motion?: MotionLibrary | null;
  /** Keep up to this many worst examples per category. */
  examples?: number;
  /** Called after every rendered frame (captures, debugging). */
  onFrame?: (t: number, worlds: WorldPose[], an: StandingAnimator) => void;
}

interface FState {
  prevToe: [V3 | null, V3 | null];
  prevHip: V3 | null;
  prevRel: Float64Array | null;
  hipSpeedEma: number;
  /** Per-bone angular speed (deg / nominal frame) one and two frames back. */
  w1: Float64Array | null;
  w2: Float64Array | null;
  /** Hips displacement (m / nominal frame) one and two frames back. */
  d1: number;
  d2: number;
  /** The previous frame (pops are attributed to it). */
  prevCtx: { t: number; ms: number; b: Bucket; layer: string; valid: boolean } | null;
  run: number;
  freezeRun: number;
  lastStanceChange: number;
  lastStance: string;
  lastPosture: string;
  postureSince: number;
  lastMode: string;
  modeSince: number;
}

export function audit(rec: Recording, opts: AuditOptions = {}): AuditResult {
  const fps = opts.fps ?? 60;
  const dtMs = 1000 / fps;
  const R = newResult();
  const n = rec.rests.length;
  const motion = opts.motion === undefined ? loadMotion() : opts.motion;
  // As the presenter does: the library is registered for every module (the finish's get-up / celebration).
  registerMotionLibrary(motion);
  const an = new StandingAnimator({ motion });
  an.setBout(rec.bout, rec.rests);
  const corner = new CornerRest(rec.bout, rec.rests, {});
  corner.setRecording(rec.frames, rec.events);
  const fin = new FinishStage(rec.bout, rec.rests, null);
  fin.setRecording(rec.frames, rec.events);
  const poses: Pose[] = rec.rests.map(() => createPose());
  const worlds: WorldPose[] = rec.rests.map(() => createWorldPose());
  const scales = rec.rests.map((r) => r.statureM / 1.7332);
  const frames = rec.frames;
  const endT = frames[frames.length - 1]!.t;
  const t0 = frames[0]!.t;
  // Frames may be a sparse subset of the recording (a cached audit recording): find by time.
  const tickOf = (t: number): number => {
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frames[m]!.t <= t + 1e-9) lo = m; else hi = m - 1; }
    return lo;
  };
  const exMax = opts.examples ?? 6;
  const ex: Record<string, Example[]> = {};
  const note = (cat: string, e: Example): void => {
    const l = (ex[cat] ??= []);
    l.push(e);
    l.sort((a, b) => b.value - a.value);
    if (l.length > exMax) l.length = exMax;
  };
  const inc = (o: Record<string, number>, k: string, v = 1): void => { o[k] = (o[k] ?? 0) + v; };

  // Contact instants (ms) of standing strikes, and every strike's window per fighter.
  const strikes = rec.events.filter((e): e is StrikeEvent => e.kind === 'strike');
  const contactMs = new Set<number>();
  for (const e of strikes) contactMs.add(e.tick * 100 + e.subMs);
  const byActor = new Map<number, number[]>();
  const byTarget = new Map<number, number[]>();
  for (const e of strikes) {
    const ms = e.tick * 100 + e.subMs;
    (byActor.get(e.actor) ?? byActor.set(e.actor, []).get(e.actor)!).push(ms);
    if (e.detail.result !== 'missed' && e.detail.result !== 'evaded') (byTarget.get(e.target) ?? byTarget.set(e.target, []).get(e.target)!).push(ms);
  }
  const near = (arr: number[] | undefined, ms: number, a: number, b: number): boolean => {
    if (!arr) return false;
    for (const x of arr) if (ms - x >= a && ms - x <= b) return true;
    return false;
  };

  // The timeline: fixed-rate samples, plus one on every contact instant.
  const windows = opts.windows ?? [[t0, endT]];
  // \`probe\`: an extra sample on a contact instant between two frames. It is
  // measured for contact only; the per-frame continuity metrics (sliding, pops,
  // hip freeze) skip it, since a 1-2 ms step would scale noise into spikes.
  const times: { t: number; seek: boolean; contact: number | null; probe: boolean }[] = [];
  for (const [a, b0] of windows) {
    const b = Math.min(b0, endT);
    let first = true;
    const contacts = [...contactMs].filter((m) => m / 1000 > a && m / 1000 < b).sort((x, y) => x - y);
    let ci = 0;
    for (let k = 0; ; k++) {
      const t = a + k * dtMs / 1000;
      if (t > b + 1e-9) break;
      while (ci < contacts.length && contacts[ci]! / 1000 < t - 1e-7) times.push({ t: contacts[ci]! / 1000, seek: false, contact: contacts[ci++]!, probe: true });
      if (ci < contacts.length && Math.abs(contacts[ci]! / 1000 - t) <= 1e-7) {
        times.push({ t: contacts[ci]! / 1000, seek: first, contact: contacts[ci++]!, probe: false });
      } else times.push({ t, seek: first, contact: null, probe: false });
      first = false;
    }
  }
  // Event windows by binary search (events are in tick order).
  const evTicks = rec.events.map((e) => e.tick);
  const lower = (tick: number): number => { let lo = 0, hi = evTicks.length; while (lo < hi) { const m = (lo + hi) >> 1; if (evTicks[m]! <= tick) lo = m + 1; else hi = m; } return lo; };
  const windowEvents = (from: number, to: number): SimEvent[] => rec.events.slice(lower(from), lower(to));
  const post = opts.post ?? 0;

  const fs: FState[] = rec.rests.map(() => ({
    prevToe: [null, null], prevHip: null, prevRel: null, hipSpeedEma: 0, freezeRun: 0, w1: null, w2: null, d1: 0, d2: 0, prevCtx: null, run: 0,
    lastStanceChange: -1e9, lastStance: '', lastPosture: '', postureSince: -1e9, lastMode: '', modeSince: -1e9,
  }));
  const relA = new Float64Array(POP_BONES.length * 4);

  let lastT = -1;
  const step = (t: number, seek: boolean, postT: number | null, contactAt: number | null, probe = false): void => {
    const k = tickOf(t);
    const F0 = frames[k]!;
    const F1n = frames[k + 1] ?? null;
    const F1 = F1n && F1n.tick === F0.tick + 1 ? F1n : null;
    const alpha = F1 ? Math.max(0, Math.min(1, (t - F0.t) / Math.max(1e-6, F1.t - F0.t))) : 0;
    const input: FrameInput = {
      frame: F0, next: F1, alpha, simTime: F1 ? t : F0.t,
      events: windowEvents(F0.tick - 20, Math.max(F0.tick, F1?.tick ?? F0.tick)),
      playbackRate: 1, replay: false, discontinuity: seek,
    };
    const realDt = lastT < 0 || seek ? dtMs / 1000 : Math.max(1e-4, (postT !== null ? dtMs / 1000 : t - lastT));
    const c0 = performance.now();
    const post0 = fin.clock(input, realDt);
    an.evaluate(post0 !== null ? fin.animatorInput(input) : input, realDt, poses);
    const cEval = performance.now() - c0;
    const inCorner = corner.apply(input, poses, realDt);
    const inPost = fin.apply(poses, null);
    for (let i = 0; i < n; i++) forwardKinematics(worlds[i]!, poses[i]!, rec.rests[i]!);
    if (n === 2 && !inPost && !inCorner) {
      R.evalMs.add(cEval);
      if (an.fighterState(0)!.mode === 'standing' && an.fighterState(1)!.mode === 'standing') R.evalStandMs.add(cEval);
    }
    const dt = seek || lastT < 0 ? 0 : (postT !== null ? dtMs / 1000 : t - lastT);
    if (!probe) lastT = t;
    R.frames++;
    const nowMs = (postT !== null ? F0.t + postT : t) * 1000;
    const tLabel = postT !== null ? endT + postT : t;

    const engaged = new Map<number, TickSnapshot['engagements'][number]>();
    for (const e of F0.engagements) {
      if (e.kind === 'knockdown') continue;
      engaged.set(e.a, e);
      if (e.b >= 0) engaged.set(e.b, e);
    }
    const buckets: Bucket[] = [];
    for (let i = 0; i < n; i++) {
      const st = an.fighterState(i)!;
      let b: Bucket = st.mode === 'grapple' ? 'engaged' : st.mode === 'down' || st.mode === 'out' ? 'down' : st.mode === 'getup' ? 'getup' : 'standing';
      if (inCorner) b = 'corner';
      if (inPost) b = 'post';
      buckets.push(b);
      if (!probe) R.fighterFrames[b]++;
    }

    if (!probe) for (let i = 0; i < n; i++) {
      const w = worlds[i]!;
      const rest = rec.rests[i]!;
      const s = scales[i]!;
      const snap = F0.fighters[i]!;
      const b = buckets[i]!;
      const f = fs[i]!;
      const layer = an.debug(i).layer;
      const tech = an.debug(i).technique;
      // ---- foot sliding ----
      // On the floor: the ball within 2 cm of its rest height and the ankle no
      // higher than a heel raised on the ball (a kicking foot sweeping low is not planted).
      const floorBall = rest.head[B.lToe * 3 + 1]! + 0.02 * s;
      const floorAnkle = rest.head[B.lFoot * 3 + 1]! + 0.08 * s;
      const onFloorOf = (side: 0 | 1): boolean => P(w, side === 0 ? B.lToe : B.rToe)[1] < floorBall && P(w, side === 0 ? B.lFoot : B.rFoot)[1] < floorAnkle;
      for (const side of [0, 1] as const) {
        const toe = P(w, side === 0 ? B.lToe : B.rToe);
        const onFloor = onFloorOf(side);
        const prev = f.prevToe[side];
        if (onFloor && prev && dt > 0) {
          const slide = Math.hypot(toe[0] - prev[0], toe[2] - prev[2]) * 100 * (dtMs / 1000 / dt);
          R.footSlide[b].add(slide);
          if (slide > 0.5) note(`slide:${b}`, { bout: rec.spec.name, t: tLabel, fighter: i, what: `foot ${side} slide cm/frame`, value: slide, layer });
        }
        f.prevToe[side] = onFloor ? toe : null;
      }
      // ---- hip freeze (open standing only) ----
      const hip = P(w, B.hips);
      if (f.prevHip && dt > 0) {
        const v = Math.hypot(hip[0] - f.prevHip[0], hip[2] - f.prevHip[2]) / dt;
        f.hipSpeedEma += (v - f.hipSpeedEma) * 0.25;
        // Translation pop: a one-frame spike in the hips' speed.
        const d0 = Math.hypot(hip[0] - f.prevHip[0], hip[1] - f.prevHip[1], hip[2] - f.prevHip[2]) * (dtMs / 1000 / dt);
        const k1 = f.prevCtx;
        if (k1 && k1.valid && f.d1 > 0.03 * s && f.d1 > 2.5 * Math.max(d0, f.d2) && !near(byTarget.get(snap.id), k1.ms, -30, 160)) {
          R.pops.trans[k1.b]++;
          note(`popT:${k1.b}`, { bout: rec.spec.name, t: k1.t, fighter: i, what: 'hips jump cm/frame', value: f.d1 * 100, layer: k1.layer });
        }
        f.d2 = f.d1;
        f.d1 = d0;
      }
      if (!(f.prevHip && dt > 0)) { f.d1 = 0; f.d2 = 0; }
      f.prevHip = hip;
      if (b === 'standing' && dt > 0) {
        const nx = F1?.fighters[i];
        const simV = nx ? Math.hypot(nx.x - snap.x, nx.z - snap.z) / Math.max(0.05, F1!.t - F0.t) : 0;
        if (simV > 0.6) {
          R.hipFreeze.moving++;
          if (f.hipSpeedEma < 0.15) {
            R.hipFreeze.frames++;
            f.freezeRun += dt * 1000;
            R.hipFreeze.longestMs = Math.max(R.hipFreeze.longestMs, f.freezeRun);
          } else f.freezeRun = 0;
        } else f.freezeRun = 0;
      } else f.freezeRun = 0;

      // ---- joint limits ----
      R.jointFrames++;
      const jl = (key: string, v: number, lim: number, sign: 1 | -1): void => {
        const over = sign > 0 ? v - lim : lim - v;
        if (over > 0) {
          inc(R.joint, key);
          inc(R.jointHist, `${key}:${b}:${layerKey(layer)}`);
          note(`joint:${key}`, { bout: rec.spec.name, t: tLabel, fighter: i, what: key, value: v * (sign > 0 ? 1 : -1), layer });
        }
      };
      const eL = flexion(w, rest, B.lArm, B.lForeArm, B.lHand, [0, -1, 0]) * DEG;
      const eR = flexion(w, rest, B.rArm, B.rForeArm, B.rHand, [0, 1, 0]) * DEG;
      const kL = flexion(w, rest, B.lUpLeg, B.lLeg, B.lFoot, [1, 0, 0]) * DEG;
      const kR = flexion(w, rest, B.rUpLeg, B.rLeg, B.rFoot, [1, 0, 0]) * DEG;
      jl('elbowHyperext', Math.min(eL, eR), -5, -1);
      jl('elbowOverflex', Math.max(eL, eR), 155, 1);
      jl('kneeHyperext', Math.min(kL, kR), -5, -1);
      jl('kneeOverflex', Math.max(kL, kR), 160, 1);
      // Tibial rotation matters where the foot is loaded: planted feet only.
      const twL = onFloorOf(0) ? kneeFootTwist(w, B.lUpLeg, B.lLeg, B.lFoot, B.lToe) : null;
      const twR = onFloorOf(1) ? kneeFootTwist(w, B.rUpLeg, B.rLeg, B.rFoot, B.rToe) : null;
      jl('kneeFootTwist', Math.max(twL ?? 0, twR ?? 0) * DEG, 45, 1);
      const sp = relEuler(w, B.hips, B.spine2);
      jl('spineTwist', Math.abs(sp[0]) * DEG, 50, 1);
      jl('spineFlex', sp[1] * DEG, 85, 1);
      jl('spineExt', -sp[1] * DEG, 35, 1);
      jl('spineSide', Math.abs(sp[2]) * DEG, 40, 1);
      const nk = relEuler(w, B.spine2, B.head);
      jl('neckYaw', Math.abs(nk[0]) * DEG, 80, 1);
      jl('neckFlex', nk[1] * DEG, 60, 1);
      jl('neckExt', -nk[1] * DEG, 65, 1);
      jl('neckRoll', Math.abs(nk[2]) * DEG, 45, 1);

      // ---- pose pops: a one-frame spike in a bone's angular speed (a velocity
      // discontinuity: much faster than both neighbouring frames) that no own
      // contact, incoming contact or seek explains. Detected one frame late.
      for (let k2 = 0; k2 < POP_BONES.length; k2++) relQuat(w, POP_BONES[k2]!.b, POP_BONES[k2]!.parent, relA, k2 * 4);
      if (!f.w1) { f.w1 = new Float64Array(POP_BONES.length); f.w2 = new Float64Array(POP_BONES.length); }
      if (f.prevRel && dt > 0) {
        const k1 = f.prevCtx;
        const own = !!k1 && near(byActor.get(snap.id), k1.ms, -60, 60);
        const hit = !!k1 && near(byTarget.get(snap.id), k1.ms, -30, 160);
        for (let k2 = 0; k2 < POP_BONES.length; k2++) {
          const pb = POP_BONES[k2]!;
          const w0 = qrel(f.prevRel, k2 * 4, relA, k2 * 4) * DEG * (dtMs / 1000 / dt); // deg per nominal frame
          const w1 = f.w1[k2]!, w2 = f.w2![k2]!;
          if (k1 && k1.valid && w1 > 6 && w1 > 2.5 * Math.max(w0, w2) && !own && !(hit && !pb.leg)) {
            R.pops.rot[k1.b]++;
            inc(R.popHist, `${k1.b}:${pb.name}:${layerKey(k1.layer)}`);
            note(`pop:${k1.b}`, { bout: rec.spec.name, t: k1.t, fighter: i, what: `${pb.name} deg/frame`, value: w1, layer: k1.layer });
          }
          f.w2![k2] = w1;
          f.w1[k2] = w0;
        }
      } else { f.w1.fill(0); f.w2!.fill(0); }
      f.prevRel = f.prevRel ?? new Float64Array(relA.length);
      f.prevRel.set(relA);

      // ---- ground penetration ----
      let depth = 0;
      let deepJ = -1;
      for (const [j, r] of GROUND_JOINTS) {
        const y = j === B.head ? headCentreW(w)[1] : w.pos[j * 3 + 1]!;
        if (r * s - y > depth) { depth = r * s - y; deepJ = j; }
      }
      if (depth > 0) {
        R.groundPen[b].add(depth * 100);
        if (depth > 0.01) note(`ground:${b}`, { bout: rec.spec.name, t: tLabel, fighter: i, what: `joint ${deepJ} below floor cm`, value: depth * 100, layer });
      } else R.groundPen[b].add(0);

      // ---- sim-state disagreement ----
      if (snap.posture !== f.lastPosture) { f.lastPosture = snap.posture; f.postureSince = nowMs; }
      if (snap.stance !== f.lastStance) { f.lastStance = snap.stance; f.lastStanceChange = nowMs; }
      const hc = headCentreW(w);
      const since = nowMs - f.postureSince;
      const dis = (k: string, cond: boolean, base: boolean, value = hc[1]): void => {
        if (!base) return;
        inc(R.disagreeBase, k);
        if (cond) { inc(R.disagree, k); note(`dis:${k}`, { bout: rec.spec.name, t: tLabel, fighter: i, what: k, value, layer }); }
      };
      if (!inPost && !inCorner) {
        const eg = engaged.get(i);
        // On the ground and settled (no transition in flight): the bottom man is
        // low; the top man kneels at most (nodes where he stands over the guard excepted).
        const settled = !!eg && eg.kind === 'ground' && !eg.inflight && nowMs - eg.sinceTick * 100 > 700;
        const standsOver = !!eg && /stand|legs_up|up_kick/.test(eg.node);
        dis('groundButUpright', hc[1] > (snap.role === 'bottom' ? 0.95 : 1.35) * s, settled && !standsOver && (snap.role === 'bottom' || snap.role === 'top'));
        dis('downButUpright', hc[1] > 1.05 * s, (snap.posture === 'down' || snap.posture === 'out') && since > 1000);
        dis('standingButLow', hc[1] < 1.05 * s, snap.posture === 'standing' && !eg && since > 1600 && b === 'standing');
        if (eg && eg.kind === 'clinch' && eg.b >= 0 && since > 500) {
          const o = eg.a === i ? eg.b : eg.a;
          const ch = P(w, B.spine2), oc = P(worlds[o]!, B.spine2);
          dis('clinchButApart', Math.hypot(ch[0] - oc[0], ch[2] - oc[2]) > 0.65, true);
        }
        if (b === 'standing' && snap.posture === 'standing' && !eg) {
          // Opponent: the nearest fighter of another team.
          let o = -1, best = Infinity;
          for (let j = 0; j < n; j++) {
            if (j === i || F0.fighters[j]!.team === snap.team) continue;
            const dd = Math.hypot(worlds[j]!.pos[0]! - hip[0], worlds[j]!.pos[2]! - hip[2]);
            if (dd < best) { best = dd; o = j; }
          }
          if (o >= 0 && best < 3.0 && buckets[o] === 'standing') {
            const ow = worlds[o]!;
            const toOpp = Math.atan2(ow.pos[0]! - hip[0], ow.pos[2]! - hip[2]);
            // Where the head points (the chest is legitimately bladed up to ~60°).
            const hf = qrotW(w, B.head, [0, 0, 1]);
            const headYaw = Math.atan2(hf[0], hf[2]);
            const off = Math.abs(Math.atan2(Math.sin(headYaw - toOpp), Math.cos(headYaw - toOpp))) * DEG;
            const spin = !!tech && /spin|wheel|back_kick|backfist_spin/.test(tech);
            dis('facingOff', off > 60, !spin && !near(byTarget.get(snap.id), nowMs, -80, 900), off);
            const simOff = Math.abs(Math.atan2(Math.sin(snap.facing - toOpp), Math.cos(snap.facing - toOpp))) * DEG;
            inc(R.disagreeBase, 'simFacingInfo');
            if (simOff > 60) inc(R.disagree, 'simFacingInfo');
            // Stance: which foot leads along the line to the opponent.
            if (nowMs - f.lastStanceChange > 600) {
              const fwd: V3 = [Math.sin(toOpp), 0, Math.cos(toOpp)];
              const lf = P(w, B.lFoot), rf = P(w, B.rFoot);
              const lead = dot(sub(lf, rf), fwd); // > 0: left foot ahead
              const want = snap.stance === 'southpaw' ? -1 : 1;
              dis('stanceMismatch', lead * want < -0.04 * s, snap.stance === 'orthodox' || snap.stance === 'southpaw', lead * want);
            }
          }
        }
      }
    }

    // ---- fighter-fighter interpenetration ----
    if (!probe) for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const wi = worlds[i]!, wj = worlds[j]!;
        const si = scales[i]!, sj = scales[j]!;
        const hi = headCentreW(wi), hj = headCentreW(wj);
        const ti: [V3, V3] = [P(wi, B.hips), P(wi, B.neck)], tj: [V3, V3] = [P(wj, B.hips), P(wj, B.neck)];
        const rh = 0.1, rt = 0.12;
        const dHH = (rh * si + rh * sj) - len(sub(hi, hj));
        const dHT = Math.max((rh * si + rt * sj) - segPoint(hi, tj[0], tj[1]), (rh * sj + rt * si) - segPoint(hj, ti[0], ti[1]));
        const dTT = (rt * si + rt * sj) - segSeg(ti[0], ti[1], tj[0], tj[1]);
        const depth = Math.max(0, dHH, dHT, dTT) * 100;
        const eng = buckets[i] === 'engaged' || buckets[j] === 'engaged';
        const both = buckets[i] === 'standing' && buckets[j] === 'standing' || buckets[i] === 'getup' || buckets[j] === 'getup';
        const which = dHH * 100 >= depth - 1e-6 ? 'head-head' : dTT * 100 >= depth - 1e-6 ? 'torso-torso' : 'head-torso';
        if (eng) {
          R.interpen.engaged.add(depth);
          // The firm body (the pair solver's capsules: pelvis, belly, ribs,
          // chest, shoulder line, head — a little inside the skin, so pressing
          // contact is allowed): the crude hips–neck capsule above is as thick
          // at the neck as at the belly and counts a head pressed beside a
          // neck (over-under, front headlock) as 5-12 cm inside the torso.
          let core = 0;
          for (const x of coreCapsules(wi, rec.rests[i]!)) for (const y of coreCapsules(wj, rec.rests[j]!)) core = Math.max(core, x.r + y.r - segSeg(x.a, x.b, y.a, y.b));
          R.interpen.engagedCore.add(core * 100);
          if (core > 0.02) note('interpen:engagedCore', { bout: rec.spec.name, t: tLabel, fighter: i, what: 'firm body cm', value: core * 100, layer: an.debug(i).layer });
          if (depth > 5) note('interpen:engaged', { bout: rec.spec.name, t: tLabel, fighter: i, what: `${which} cm`, value: depth, layer: an.debug(i).layer });
        } else if (both || buckets[i] === 'post' || buckets[i] === 'down' || buckets[j] === 'down') {
          R.interpen.standing.add(depth);
          if (depth > 2) note('interpen:standing', { bout: rec.spec.name, t: tLabel, fighter: i, what: `${which} cm (${buckets[i]}/${buckets[j]})`, value: depth, layer: an.debug(i).layer });
        }
        if (both) {
          // Limbs (thighs, shins, upper arms) into the other's head / torso, except a weapon in its strike.
          const limbs = (w: WorldPose, s: number): [V3, V3, number][] => [
            [P(w, B.lUpLeg), P(w, B.lLeg), 0.07 * s], [P(w, B.rUpLeg), P(w, B.rLeg), 0.07 * s],
            [P(w, B.lLeg), P(w, B.lFoot), 0.05 * s], [P(w, B.rLeg), P(w, B.rFoot), 0.05 * s],
            [P(w, B.lArm), P(w, B.lForeArm), 0.045 * s], [P(w, B.rArm), P(w, B.rForeArm), 0.045 * s],
          ];
          const ownI = !!an.debug(i).technique, ownJ = !!an.debug(j).technique;
          let worst = 0;
          if (!ownI) for (const [a, c, r] of limbs(wi, si)) worst = Math.max(worst, (r + rt * sj) - segSeg(a, c, tj[0], tj[1]), (r + rh * sj) - segPoint(hj, a, c));
          if (!ownJ) for (const [a, c, r] of limbs(wj, sj)) worst = Math.max(worst, (r + rt * si) - segSeg(a, c, ti[0], ti[1]), (r + rh * si) - segPoint(hi, a, c));
          R.interpen.limbStanding.add(Math.max(0, worst) * 100);
        }
      }
    }

    // ---- contact at the recorded instant ----
    const ms = contactAt ?? NaN;
    if (postT === null && contactAt !== null) {
      for (const e of strikes) {
        if (e.tick * 100 + e.subMs !== ms) continue;
        const res = e.detail.result;
        if (res !== 'landed' && res !== 'blocked') continue;
        if (e.detail.short) continue;
        const ai = F0.fighters.findIndex((x) => x.id === e.actor);
        const ti = F0.fighters.findIndex((x) => x.id === e.target);
        if (ai < 0 || ti < 0 || buckets[ai] !== 'standing' || buckets[ti] !== 'standing') continue;
        const tech = e.detail.technique;
        const aw = worlds[ai]!, tw = worlds[ti]!;
        const sa = scales[ai]!, st = scales[ti]!;
        const kick = /kick|teep|knee/.test(tech);
        // Weapon: the fist, elbow, knee, or the shin/instep line.
        const weapon: [V3, V3][] = [];
        if (/elbow/.test(tech)) weapon.push([P(aw, B.lForeArm), P(aw, B.lForeArm)], [P(aw, B.rForeArm), P(aw, B.rForeArm)]);
        else if (/knee/.test(tech)) weapon.push([P(aw, B.lLeg), P(aw, B.lLeg)], [P(aw, B.rLeg), P(aw, B.rLeg)]);
        else if (kick) weapon.push([P(aw, B.lLeg), P(aw, B.lFoot)], [P(aw, B.lFoot), P(aw, B.lToe)], [P(aw, B.rLeg), P(aw, B.rFoot)], [P(aw, B.rFoot), P(aw, B.rToe)]);
        else { const a = fist(aw, 0, sa), c = fist(aw, 1, sa); weapon.push([a, a], [c, c]); }
        // Target surface.
        const tg: [V3, V3, number][] = [];
        if (res === 'blocked') {
          tg.push([P(tw, B.lForeArm), P(tw, B.lHand), 0.05 * st], [P(tw, B.rForeArm), P(tw, B.rHand), 0.05 * st],
            [P(tw, B.lArm), P(tw, B.lForeArm), 0.05 * st], [P(tw, B.rArm), P(tw, B.rForeArm), 0.05 * st]);
          if (kick) tg.push([P(tw, B.lLeg), P(tw, B.lFoot), 0.05 * st], [P(tw, B.rLeg), P(tw, B.rFoot), 0.05 * st]);
        } else if (e.detail.target === 'head') { const h = headCentreW(tw); tg.push([h, h, 0.1 * st]); }
        else if (e.detail.target === 'body') tg.push([P(tw, B.hips), P(tw, B.neck), 0.13 * st]);
        else if (e.detail.target === 'leadLeg' || e.detail.target === 'rearLeg') tg.push([P(tw, B.lUpLeg), P(tw, B.lLeg), 0.075 * st], [P(tw, B.rUpLeg), P(tw, B.rLeg), 0.075 * st], [P(tw, B.lLeg), P(tw, B.lFoot), 0.05 * st], [P(tw, B.rLeg), P(tw, B.rFoot), 0.05 * st]);
        else tg.push([P(tw, B.lArm), P(tw, B.lHand), 0.05 * st], [P(tw, B.rArm), P(tw, B.rHand), 0.05 * st]);
        let best = Infinity;
        for (const [wa, wb] of weapon) for (const [ta, tb, r] of tg) best = Math.min(best, Math.max(0, segSeg(wa, wb, ta, tb) - r));
        R.contact.count++;
        if (!Number.isFinite(best)) { R.contact.missing++; continue; }
        // Recorded centre distance: strikes resolved beyond what any arm or leg
        // reaches (the sim's range model; the display compression only closes
        // part of it) fall short however the animation aims.
        const fa = F0.fighters[ai]!, fb = F0.fighters[ti]!;
        const recD = Math.hypot(fb.x - fa.x, fb.z - fa.z);
        const reachable = recD <= (kick ? 1.9 : 1.6);
        R.contact.surface.add(best * 100);
        if (reachable) R.contact.inRange.add(best * 100);
        if (best > 0.05) note(reachable ? 'contact' : 'contact:outOfRange', { bout: rec.spec.name, t: tLabel, fighter: ai, what: `${tech} ${res} ${e.detail.target} at ${recD.toFixed(2)} m, cm`, value: best * 100, layer: an.debug(ai).layer });
        const aim = an.debug(ai).ikTargets.find((x) => x.name === 'aim' || x.name === 'kick');
        if (aim) {
          let d = Infinity;
          for (const [wa, wb] of weapon) d = Math.min(d, segPoint(aim.pos as V3, wa, wb));
          R.contact.aim.add(d * 100);
        }
      }
    }
    if (!probe) for (let i = 0; i < n; i++) {
      const f = fs[i]!;
      f.run = dt > 0 ? f.run + 1 : 0;
      f.prevCtx = { t: tLabel, ms: nowMs, b: buckets[i]!, layer: an.debug(i).layer, valid: f.run >= 2 };
    }
    opts.onFrame?.(tLabel, worlds, an);
  };

  for (const { t, seek, contact, probe } of times) step(t, seek, null, contact, probe);
  if (post > 0 && fin.result) {
    const lastWin = windows[windows.length - 1]!;
    if (lastWin[1] >= endT - 1e-6) {
      for (let pt = 0; pt <= post; pt += dtMs / 1000) step(endT, false, pt, null);
    }
  }
  R.examples = Object.entries(ex).flatMap(([cat, l]) => l.map((e) => ({ ...e, what: `${cat} · ${e.what}` })));
  const fighterMin = BUCKETS.reduce((s2, b) => s2 + R.fighterFrames[b], 0) / fps / 60;
  const pops = BUCKETS.reduce((s2, b) => s2 + R.pops.rot[b] + R.pops.trans[b], 0);
  R.pops.perMin = fighterMin > 0 ? pops / fighterMin : 0;
  return R;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '-');
const pc = (a: number, b: number): string => (b > 0 ? `${((100 * a) / b).toFixed(2)}%` : '-');

/** Flat metric table (name → value) for before/after comparison. */
export function summarize(r: AuditResult): Record<string, string> {
  const o: Record<string, string> = {};
  for (const b of BUCKETS) {
    const s = r.footSlide[b];
    if (s.n) o[`footSlide.${b} (cm/planted frame: mean / p99 / max / >0.5cm)`] = `${f2(s.mean)} / ${f2(s.pct(0.99))} / ${f2(s.max)} / ${pc(s.over, s.n)}`;
  }
  o['hipFreeze (frames frozen / sim-moving frames, longest ms)'] = `${pc(r.hipFreeze.frames, r.hipFreeze.moving)} (${r.hipFreeze.frames}/${r.hipFreeze.moving}), ${r.hipFreeze.longestMs.toFixed(0)}`;
  for (const k of ['elbowHyperext', 'elbowOverflex', 'kneeHyperext', 'kneeOverflex', 'kneeFootTwist', 'spineTwist', 'spineFlex', 'spineExt', 'spineSide', 'neckYaw', 'neckFlex', 'neckExt', 'neckRoll']) {
    o[`joint.${k} (% fighter-frames)`] = pc(r.joint[k] ?? 0, r.jointFrames);
  }
  o['pops (unexplained one-frame spikes per fighter-minute)'] = f2(r.pops.perMin);
  for (const b of BUCKETS) if (r.pops.rot[b] || r.pops.trans[b]) o[`pops.${b} (rot / trans count)`] = `${r.pops.rot[b]} / ${r.pops.trans[b]}`;
  for (const b of BUCKETS) {
    const s = r.groundPen[b];
    if (s.n) o[`groundPen.${b} (frames >1cm, max cm)`] = `${pc(s.over, s.n)}, ${f2(s.max)}`;
  }
  const ip = r.interpen;
  o['interpen.standing (frames >2cm, p99 / max cm)'] = `${pc(ip.standing.over, ip.standing.n)}, ${f2(ip.standing.pct(0.99))} / ${f2(ip.standing.max)}`;
  o['interpen.limbStanding (frames >5cm, max cm)'] = `${pc(ip.limbStanding.over, ip.limbStanding.n)}, ${f2(ip.limbStanding.max)}`;
  o['interpen.engaged (frames >5cm, p99 / max cm)'] = `${pc(ip.engaged.over, ip.engaged.n)}, ${f2(ip.engaged.pct(0.99))} / ${f2(ip.engaged.max)}`;
  o['interpen.engagedCore (firm-body capsules: frames >2cm, p99 / max cm)'] = `${pc(ip.engagedCore.over, ip.engagedCore.n)}, ${f2(ip.engagedCore.pct(0.99))} / ${f2(ip.engagedCore.max)}`;
  const c = r.contact;
  o['contact.surface (n, median / p90 / max cm, >5cm)'] = `${c.surface.n}, ${f2(c.surface.pct(0.5))} / ${f2(c.surface.pct(0.9))} / ${f2(c.surface.max)}, ${pc(c.surface.over, c.surface.n)}`;
  o['contact.inRange (recorded ≤ 1.6 m punch / 1.9 m kick: n, median / p90 / max cm, >5cm)'] = `${c.inRange.n}, ${f2(c.inRange.pct(0.5))} / ${f2(c.inRange.pct(0.9))} / ${f2(c.inRange.max)}, ${pc(c.inRange.over, c.inRange.n)}`;
  o['contact.aim (IK error: median / p90 / max cm)'] = `${f2(c.aim.pct(0.5))} / ${f2(c.aim.pct(0.9))} / ${f2(c.aim.max)}`;
  for (const k of Object.keys(r.disagreeBase).sort()) o[`disagree.${k} (% of applicable frames)`] = `${pc(r.disagree[k] ?? 0, r.disagreeBase[k] ?? 0)} of ${r.disagreeBase[k]}`;
  o['evaluate ms (2 fighters, all modes: mean / p95)'] = `${f2(r.evalMs.mean)} / ${f2(r.evalMs.pct(0.95))}`;
  o['evaluate ms (2 fighters standing: mean / median / p95)'] = `${f2(r.evalStandMs.mean)} / ${f2(r.evalStandMs.pct(0.5))} / ${f2(r.evalStandMs.pct(0.95))}`;
  return o;
}

/** A representative set: seeds, rulesets, tiers, sizes, stances; one multi-fighter bout. */
export const AUDIT_BOUTS: AuditBoutSpec[] = [
  { name: 'mma-champ-v-pro', seed: 'anim-audit-1', ruleset: 'mma.unified.3r', fighters: ['arch.champion_complete', 'arch.regional_pro_allrounder'] },
  { name: 'mma-thai-v-wrestler', seed: 'anim-audit-2', ruleset: 'mma.unified.3r', fighters: ['arch.thai_striker', 'arch.elite_wrestler_boxer'] },
  { name: 'boxing-pressure-v-counter', seed: 'anim-audit-3', ruleset: 'boxing.pro', fighters: ['arch.pressure_boxer', 'arch.counter_striker'] },
  { name: 'k1-thai-v-tkd', seed: 'anim-audit-4', ruleset: 'kickboxing.k1', fighters: ['arch.thai_striker', 'arch.tkd_convert'] },
  { name: 'amateur-novices', seed: 'anim-audit-5', ruleset: 'mma.amateur', fighters: ['arch.brand_new_brawler', 'arch.gym_fit_beginner'] },
  { name: 'mma-heavy-v-fly', seed: 'anim-audit-6', ruleset: 'mma.unified.3r', fighters: ['arch.heavyweight_power_puncher', 'arch.flyweight_volume_striker'] },
  { name: 'mma-bjj-v-judoka', seed: 'anim-audit-7', ruleset: 'mma.unified.3r', fighters: ['arch.bjj_guard_player', 'arch.judoka'] },
  // Ends in a submission (the winner gets up off the loser; pass 2 of the QA).
  { name: 'mma-sub-finish', seed: 'anim-sub-7', ruleset: 'mma.unified.3r', fighters: ['arch.champion_complete', 'arch.brand_new_brawler'] },
  { name: 'teams-2v2', seed: 'anim-audit-8', ruleset: 'mma.unified.3r', mode: 'teams', teamOf: [0, 0, 1, 1], fighters: ['arch.regional_pro_allrounder', 'arch.pressure_boxer', 'arch.thai_striker', 'arch.sambo_grappler'] },
];
