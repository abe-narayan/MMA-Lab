/**
 * THE DIRECTOR'S EDIT — which camera is on air at every moment of a bout.
 *
 * A shot plan is a pure function of (recorded frames, events, arena, cosmetic
 * seed): the same bout always cuts the same way, a seek simply looks the shot
 * up, and the cut rules can look *ahead* in the recording, which is how a
 * director with a replay deck never cuts on a punch (docs/design/08 §7.2).
 *
 * The planner is a state machine stepped once per recorded tick. It never looks
 * at a frame after the one it is on; the only look-ahead is the strike index
 * (`StrikeIndex`), which offline is built from every recorded strike and live
 * can be fed pending contacts from the snapshot. So the same code plans a
 * finished recording and a bout being streamed.
 */
import type { SimEvent, TickSnapshot } from '../../sim';
import {
  type CameraArena, insideWall, nearestPanelCentre, panelCentres, postClearance, wallDistanceAt,
} from './geometry';
import { atAzimuth, seeded, wrapAngle } from './math';
import { PLACEMENT, type ShotKind } from './shots';

export const TICK_S = 0.1;

/** The cut rules, as implemented. All times in seconds unless stated. */
export const CUT_RULES = {
  /** Minimum live shot length; knockdown and finish cuts are exempt. */
  minShotS: 4,
  /** Minimum replay angle length. */
  minShotReplayS: 2,
  /** Never cut within this distance of a strike's contact instant. */
  strikeGuardS: 0.4,
  /**
   * The guard in whole ticks. Contacts carry a sub-tick offset, so ±6 ticks
   * keeps every cut at least 0.4 s from a contact whichever way the offset
   * falls and whichever frame the renderer shows the cut on.
   */
  strikeGuardTicks: 6,
  /** A knockdown cut goes in 0.4-3.5 s after the drop, or not at all. */
  kdCutWindowS: [0.4, 3.5] as const,
  /** Nothing but a finish may cut during the first 2.5 s of a knockdown. */
  kdHoldS: 2.5,
  /** A new situation must persist this long before it earns a cut. */
  situationDebounceS: 0.8,
  /** Cut to the tight hard camera after this long with no strikes. */
  lowActivityS: 8,
  /** Round break: jib at +1 s, loser's corner at +6 s, other corner at +26 s, jib back at +44 s. */
  breakSequenceS: [1, 6, 26, 44] as const,
  /** The hard camera is back on air this long before the next bell. */
  preBellS: 2.5,
} as const;

const MIN_SHOT_TICKS = Math.round(CUT_RULES.minShotS / TICK_S);
const DEBOUNCE_TICKS = Math.round(CUT_RULES.situationDebounceS / TICK_S);
const KD_HOLD_TICKS = Math.round(CUT_RULES.kdHoldS / TICK_S);

export type CutReason =
  | 'intro' | 'roundStart' | 'roundEnd' | 'break' | 'situation' | 'clinch' | 'ground'
  | 'standUp' | 'lowActivity' | 'variety' | 'reposition' | 'reaction' | 'knockdown'
  | 'finish' | 'post';

export interface ShotPlanEntry {
  kind: ShotKind;
  /** The recorded tick the cut lands on (may lie past the last frame: the post-roll). */
  startTick: number;
  startT: number;
  reason: CutReason;
  /** Exempt from the minimum shot length (knockdown and finish cuts). */
  forced: boolean;
  /** Fighters this shot is about; empty = everyone. */
  subjects: readonly number[];
  /** Operator / jib azimuth (rad, sim convention). */
  azimuth: number;
  /** Jib: total sweep (rad) and height range over `durationS`. */
  sweep: number;
  heights: readonly [number, number];
  durationS: number;
  /** Per-shot cosmetic seed (handheld noise phases). */
  seed: number;
}

export interface BlockedCut {
  tick: number;
  wanted: ShotKind;
  reason: 'strike' | 'minShot' | 'kdHold';
}

export interface ShotPlan {
  entries: ShotPlanEntry[];
  /** Tick of the last recorded frame; entries after it belong to the post-roll. */
  lastTick: number;
  /** Cuts the rules held back (for the dev timeline and the debug overlay). */
  blocked: BlockedCut[];
}

// ---------------------------------------------------------------------------
// Strike index: the ±0.4 s rule's look-ahead
// ---------------------------------------------------------------------------

export class StrikeIndex {
  private ticks: number[] = [];

  constructor(events: readonly SimEvent[] = []) {
    for (const e of events) if (e.kind === 'strike') this.ticks.push(e.tick);
    this.ticks.sort((a, b) => a - b);
  }

  add(tick: number): void {
    const t = this.ticks;
    if (t.length === 0 || t[t.length - 1] <= tick) t.push(tick);
    else {
      t.push(tick);
      t.sort((a, b) => a - b);
    }
  }

  /** True when a strike resolves within `guard` ticks of `tick`. */
  near(tick: number, guard = CUT_RULES.strikeGuardTicks): boolean {
    const t = this.ticks;
    let lo = 0;
    let hi = t.length;
    const from = tick - guard;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid] < from) lo = mid + 1;
      else hi = mid;
    }
    return lo < t.length && t[lo] <= tick + guard;
  }

  get all(): readonly number[] {
    return this.ticks;
  }
}

/** The contact instant of a strike event, seconds (tick plus its sub-tick offset). */
export const contactTime = (e: SimEvent): number => e.tick * TICK_S + (e.subMs ?? 0) / 1000;

// ---------------------------------------------------------------------------
// Situations
// ---------------------------------------------------------------------------

export type Situation =
  | 'intro' | 'standing' | 'clinch' | 'cageClinch' | 'takedown' | 'ground' | 'down' | 'break' | 'ended';

export function classify(frame: TickSnapshot): Situation {
  if (frame.phase === 'pre') return 'intro';
  if (frame.phase === 'break') return 'break';
  if (frame.phase === 'ended') return 'ended';
  const fs = frame.fighters;
  if (fs.some((f) => f.posture === 'down' || f.posture === 'out')) return 'down';
  const eng = frame.engagements[0];
  if (eng?.inflight) return 'takedown';
  if (fs.some((f) => f.posture === 'ground')) return 'ground';
  const cage = (eng?.cage ?? false) || fs.some((f) => f.againstFence);
  if (fs.some((f) => f.posture === 'clinch') || (eng && (eng.kind === 'takedown' || eng.kind === 'throw' || eng.kind === 'clinch'))) {
    return cage ? 'cageClinch' : 'clinch';
  }
  return 'standing';
}

// ---------------------------------------------------------------------------
// Operator placement
// ---------------------------------------------------------------------------

const cross2 = (ax: number, az: number, bx: number, bz: number): number => ax * bz - az * bx;

/**
 * Pick the apron spot for a handheld: close to the action, looking across the
 * fighters' line (a profile of both, not one's back), on the hard camera's side
 * of that line so screen direction holds, never lined up on a post.
 */
export function chooseOperator(
  ca: CameraArena, frame: TickSnapshot, subjects: readonly number[], seed: string, salt: string,
  avoidAzimuth?: number,
): number {
  const fs = frame.fighters.filter((f) => subjects.length === 0 || subjects.includes(f.id));
  const live = fs.length > 0 ? fs : frame.fighters;
  const mx = live.reduce((s, f) => s + f.x, 0) / Math.max(1, live.length);
  const mz = live.reduce((s, f) => s + f.z, 0) / Math.max(1, live.length);
  const a = frame.fighters[0];
  const b = frame.fighters[1];
  let lx = 0;
  let lz = 0;
  let hasLine = false;
  if (a && b) {
    lx = b.x - a.x;
    lz = b.z - a.z;
    const l = Math.hypot(lx, lz);
    if (l > 0.35) {
      lx /= l;
      lz /= l;
      hasLine = true;
    }
  }
  const main = atAzimuth(ca.mainAzimuth, ca.mainRadius);
  const mainSide = hasLine ? Math.sign(cross2(lx, lz, main[0] - a.x, main[2] - a.z)) : 0;

  let best = ca.mainAzimuth;
  let bestScore = Infinity;
  const unbounded = ca.shape === 'unbounded';
  panelCentres(ca).forEach((az, i) => {
    const p = unbounded
      ? [mx + Math.sin(az) * 3.4, 0, mz + Math.cos(az) * 3.4]
      : atAzimuth(az, wallDistanceAt(ca, az) + PLACEMENT.handheldOutsideM);
    const dx = p[0] - mx;
    const dz = p[2] - mz;
    const d = Math.hypot(dx, dz);
    const side = hasLine ? Math.sign(cross2(lx, lz, p[0] - a.x, p[2] - a.z)) : 0;
    const wrongSide = hasLine && mainSide !== 0 && side !== 0 && side !== mainSide;
    const along = hasLine && d > 1e-3 ? Math.abs((dx * lx + dz * lz) / d) : 0;
    const postPenalty = postClearance(ca, az) < 0.1 ? 4 : 0;
    // Nor may a post stand dead-centre behind the action, seen from here.
    let behindPost = 0;
    if (!unbounded && d > 1e-3) {
      let x = mx;
      let z = mz;
      for (let k = 0; k < 80 && insideWall(ca, x, z); k++) {
        x -= (dx / d) * 0.15;
        z -= (dz / d) * 0.15;
      }
      if (postClearance(ca, Math.atan2(x, z)) < 0.07) behindPost = 2.5;
    }
    // A cut to the same spot is a jump cut; a spot next to it barely better.
    const gap = avoidAzimuth === undefined ? Infinity : Math.abs(wrapAngle(az - avoidAzimuth));
    const same = gap < 0.05 ? 8 : gap < 0.9 ? 1.5 : 0;
    const score = d + along * 2.4 + (wrongSide ? 40 : 0) + postPenalty + behindPost + same + seeded(seed, `${salt}:${i}`) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = az;
    }
  });
  return best;
}

/** Corner robotic: a three-quarter front view of the fighter from outside the fence. */
function cornerAzimuth(ca: CameraArena, frame: TickSnapshot, id: number, seed: string): number {
  const f = frame.fighters.find((x) => x.id === id) ?? frame.fighters[0];
  if (!f) return ca.mainAzimuth;
  const px = f.x + Math.sin(f.facing) * 12;
  const pz = f.z + Math.cos(f.facing) * 12;
  const side = seeded(seed, `corner:${id}`) < 0.5 ? -1 : 1;
  const az = Math.atan2(px, pz) + side * 0.4;
  return ca.shape === 'unbounded' ? az : nearestPanelCentre(ca, az);
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

interface Request {
  kind: ShotKind;
  reason: CutReason;
  forced: boolean;
  priority: number;
  earliest: number;
  deadline: number;
  subjects: number[];
  reposition?: boolean;
}

export interface PlannerOptions {
  arena: CameraArena;
  seed: string;
  /**
   * Ticks of every opening bell. Offline these come from the recording, so the
   * hard camera is back on air before the bell rather than after the first
   * exchange; live the break is assumed to last `breakSeconds`.
   */
  roundStarts?: readonly number[];
  breakSeconds?: number;
}

export class ShotPlanner {
  readonly entries: ShotPlanEntry[] = [];
  readonly blocked: BlockedCut[] = [];
  private cur: ShotPlanEntry | null = null;
  private pending: Request | null = null;
  private rawSit: Situation = 'intro';
  private rawSince = 0;
  private sit: Situation = 'intro';
  private sitSince = 0;
  private lastStrikeTick = -1e9;
  private kdHoldUntil = -1;
  private breakStart = -1;
  private breakStep = 0;
  private groundCutaways = 0;
  private roundCards: number[] = [];
  private finished = false;
  private winner = -1;
  private loser = -1;
  private lastTick = 0;
  private lastFrame: TickSnapshot | null = null;
  private blockedKey = '';
  private readonly seed: string;
  private readonly ca: CameraArena;

  private readonly roundStarts: readonly number[];
  private readonly breakTicks: number;

  constructor(opts: PlannerOptions, private readonly strikes: StrikeIndex) {
    this.seed = opts.seed;
    this.ca = opts.arena;
    this.roundStarts = opts.roundStarts ?? [];
    this.breakTicks = Math.round((opts.breakSeconds ?? 60) / TICK_S);
  }

  get current(): ShotPlanEntry | null {
    return this.cur;
  }

  private hold(name: string, lo: number, hi: number): number {
    const n = this.entries.length;
    return Math.round((lo + seeded(this.seed, `${name}:${n}`) * (hi - lo)) / TICK_S);
  }

  private request(r: Request): void {
    if (this.pending && this.pending.priority > r.priority) return;
    this.pending = r;
  }

  /** Feed one recorded frame and the events stamped with its tick. */
  step(frame: TickSnapshot, events: readonly SimEvent[]): void {
    const tick = frame.tick;
    this.lastTick = tick;
    this.lastFrame = frame;

    // The pre-roll jib opens a recording; a live feed joined mid-bout opens on the hard camera.
    if (!this.cur) {
      const opening = frame.phase === 'pre' || tick === 0;
      this.commit({
        kind: opening ? 'jib' : 'main', reason: opening ? 'intro' : 'situation', forced: true, priority: 9,
        earliest: tick, deadline: Infinity, subjects: [],
      }, frame, tick);
    }

    for (const e of events) this.onEvent(e, frame);

    // Situation, debounced: a clinch that lasts 0.3 s is not worth a cut.
    const raw = classify(frame);
    if (raw !== this.rawSit) {
      this.rawSit = raw;
      this.rawSince = tick;
    }
    const immediate = raw === 'down' || raw === 'break' || raw === 'ended' || raw === 'intro' || raw === 'takedown';
    if (raw !== this.sit && (immediate || tick - this.rawSince >= DEBOUNCE_TICKS)) {
      this.sit = raw;
      this.sitSince = tick;
    }

    if (!this.finished) {
      if (frame.phase === 'round') this.desire(frame, tick);
      else if (frame.phase === 'break') this.breakSequence(tick);
    }
    this.tryCommit(frame, tick);
  }

  private onEvent(e: SimEvent, frame: TickSnapshot): void {
    const tick = e.tick;
    switch (e.kind) {
      case 'strike':
        this.lastStrikeTick = tick;
        break;
      case 'roundStart':
        this.breakStart = -1;
        if (this.cur?.reason === 'roundStart' && this.cur.kind === 'main') break;
        // The opening bell ends the pre-roll (shown while the playhead rests
        // on the first frame), so that cut is not held to the minimum length.
        this.request({
          kind: 'main', reason: 'roundStart', forced: this.cur?.reason === 'intro', priority: 4, earliest: tick,
          deadline: Infinity, subjects: [],
        });
        break;
      case 'roundEnd':
        if (this.finished) break;
        this.breakStart = tick;
        this.breakStep = 0;
        this.request({
          kind: 'jib', reason: 'roundEnd', forced: false, priority: 4,
          earliest: tick + Math.round(CUT_RULES.breakSequenceS[0] / TICK_S), deadline: Infinity, subjects: [],
        });
        break;
      case 'scorecardRound': {
        const cards = (e.detail as { cards?: number[][] }).cards ?? [];
        const sums: number[] = [];
        for (const c of cards) c.forEach((v, i) => { sums[i] = (sums[i] ?? 0) + v; });
        this.roundCards = sums;
        break;
      }
      case 'knockdown': {
        if (this.finished) break;
        this.kdHoldUntil = tick + KD_HOLD_TICKS;
        // Already tight at the fence: the handheld has the knockdown; stay on it.
        if (this.cur && (this.cur.kind === 'cageside' || this.cur.kind === 'ground') && tick - this.cur.startTick >= 10) break;
        const downed = e.target >= 0 ? e.target : e.actor;
        const by = e.target >= 0 ? e.actor : -1;
        const [lo, hi] = CUT_RULES.kdCutWindowS;
        this.request({
          kind: 'cageside', reason: 'knockdown', forced: true, priority: 8,
          earliest: tick + Math.round(lo / TICK_S), deadline: tick + Math.round(hi / TICK_S),
          subjects: by >= 0 ? [downed, by] : [downed],
        });
        break;
      }
      case 'rocked': {
        if (this.finished || this.cur?.kind !== 'main' || this.pending) break;
        const who = e.actor;
        this.request({
          kind: 'mainTight', reason: 'reaction', forced: false, priority: 2,
          earliest: tick, deadline: tick + 30, subjects: who >= 0 ? [who] : [],
        });
        break;
      }
      case 'refereeStoppage':
      case 'submissionFinish': {
        if (this.finished) break;
        this.finished = true;
        if (e.kind === 'refereeStoppage') {
          this.winner = e.target;
        } else {
          this.winner = e.actor;
        }
        this.loser = frame.fighters.find((f) => f.id !== this.winner)?.id ?? -1;
        this.request({
          kind: 'cageside', reason: 'finish', forced: true, priority: 10, earliest: tick,
          deadline: Infinity, subjects: this.loser >= 0 && this.winner >= 0 ? [this.loser, this.winner] : [],
        });
        break;
      }
      case 'decision': {
        const w = (e.detail as { winner?: number | 'draw' }).winner;
        this.winner = typeof w === 'number' ? w : -1;
        break;
      }
      default:
        break;
    }
  }

  /** What the situation asks for during a round. */
  private desire(frame: TickSnapshot, tick: number): void {
    const cur = this.cur;
    if (!cur || tick < this.kdHoldUntil) return;
    if (this.pending && this.pending.priority >= 2) return;
    // A situational wish is re-derived every tick, so a clinch that broke
    // before its cut could go in leaves no stale cut behind.
    this.pending = null;
    const age = tick - cur.startTick;
    const sitAge = tick - this.sitSince;
    const quiet = tick - this.lastStrikeTick;
    const want = (kind: ShotKind, reason: CutReason, extra: Partial<Request> = {}): void => {
      if (kind === cur.kind && !extra.reposition) return;
      this.request({
        kind, reason, forced: false, priority: 1, earliest: tick, deadline: Infinity, subjects: [], ...extra,
      });
    };
    const operatorDrifted = (): boolean => {
      // Re-place a handheld only when another spot on the apron is clearly
      // better than the one on air (the action walked away from it).
      if (cur.kind !== 'cageside' && cur.kind !== 'ground') return false;
      if (tick % 5 !== 0) return false;
      const fs = frame.fighters;
      const mx = fs.reduce((s, f) => s + f.x, 0) / fs.length;
      const mz = fs.reduce((s, f) => s + f.z, 0) / fs.length;
      const opDist = (az: number): number => {
        const op = atAzimuth(az, wallDistanceAt(this.ca, az));
        return Math.hypot(op[0] - mx, op[2] - mz);
      };
      const d = opDist(cur.azimuth);
      if (!Number.isFinite(d) || d < 3.2) return false;
      const best = chooseOperator(this.ca, frame, [], this.seed, `drift:${this.entries.length}`);
      return d - opDist(best) > 1.8;
    };

    switch (this.sit) {
      case 'standing': {
        if (cur.kind === 'main') {
          if (quiet >= CUT_RULES.lowActivityS / TICK_S && age >= CUT_RULES.lowActivityS / TICK_S) {
            want('mainTight', 'lowActivity');
          } else if (age >= this.hold('variety', 28, 44)) {
            want('cageside', 'variety');
          }
        } else if (cur.kind === 'mainTight') {
          if (age >= this.hold('tight', 6, 10) || (quiet < 8 && age >= MIN_SHOT_TICKS + 20)) want('main', 'situation');
        } else if (cur.kind === 'cageside' && cur.reason === 'variety') {
          if (age >= this.hold('varietyHold', 5, 8)) want('main', 'situation');
        } else if (sitAge >= 5) {
          want('main', cur.kind === 'overhead' || cur.kind === 'ground' ? 'standUp' : 'situation');
        }
        break;
      }
      case 'clinch':
      case 'cageClinch': {
        const cage = this.sit === 'cageClinch';
        if (cur.kind === 'main') {
          const clinchMainHold = cur.reason === 'clinch' ? this.hold('clinchMain', 7, 11) : 12;
          if (sitAge >= 12 && (cur.reason !== 'clinch' || age >= clinchMainHold)) {
            want(cage ? 'cageside' : 'mainTight', 'clinch');
          }
        } else if (cur.kind === 'cageside') {
          if (age >= this.hold('clinchSide', 9, 14)) want('main', 'clinch');
          else if (operatorDrifted()) want('cageside', 'reposition', { reposition: true });
        } else if (cur.kind === 'mainTight') {
          if (cage && age >= MIN_SHOT_TICKS) want('cageside', 'clinch');
          else if (age >= this.hold('clinchTight', 7, 11)) want('main', 'clinch');
        } else {
          want(cage ? 'cageside' : 'main', 'clinch');
        }
        break;
      }
      case 'ground': {
        if (sitAge < 10) break;
        // A televised ground fight lives on the hard camera, with cutaways:
        // the low handheld after the landing, then main, then the overhead or
        // the handheld again, main between each.
        const cutaway = cur.kind === 'ground' || cur.kind === 'overhead' || cur.kind === 'cageside';
        const inGround = cur.reason === 'ground' || cur.reason === 'reposition';
        if (!inGround) {
          want(cur.kind === 'main' || cur.kind === 'mainTight' || cur.kind === 'cageside' ? 'ground' : 'main', 'ground');
        } else if (cutaway) {
          if (age >= this.hold(`g:${cur.kind}`, cur.kind === 'overhead' ? 5 : 7, cur.kind === 'overhead' ? 8 : 12)) {
            want('main', 'ground');
          } else if (operatorDrifted()) {
            want(cur.kind, 'reposition', { reposition: true });
          }
        } else if (age >= this.hold('groundMain', 14, 24)) {
          this.groundCutaways++;
          want(this.groundCutaways % 3 === 1 ? 'overhead' : 'ground', 'ground');
        }
        break;
      }
      case 'down': {
        // After the knockdown shot has had its moment, the hard camera shows
        // what happens next (the follow-up, the referee).
        if (cur.reason === 'knockdown' && age >= 35) want('main', 'situation');
        break;
      }
      default:
        break;
    }
  }

  private breakSequence(tick: number): void {
    if (this.breakStart < 0) return;
    const bell = this.roundStarts.find((t) => t > this.breakStart) ?? this.breakStart + this.breakTicks;
    const len = Math.max(1, bell - this.breakStart);
    // The schedule is written for a 60 s break and scales to the real one.
    const [, cornerA, cornerB, jibBack] = CUT_RULES.breakSequenceS.map((s) => Math.round((s / TICK_S) * Math.min(1, len / 600)));
    const bt = tick - this.breakStart;
    if (this.breakStep < 4 && tick >= bell - Math.round(CUT_RULES.preBellS / TICK_S)) {
      // Back on the hard camera before the bell: the first exchange of a round
      // often comes in the opening second, when no cut may go in.
      this.breakStep = 4;
      this.request({ kind: 'main', reason: 'roundStart', forced: false, priority: 4, earliest: tick, deadline: Infinity, subjects: [] });
      return;
    }
    const ids = (this.lastFrame?.fighters ?? []).map((f) => f.id);
    let loser = ids[0] ?? 0;
    if (this.roundCards.length >= 2 && this.roundCards[0] !== this.roundCards[1]) {
      loser = this.roundCards[0] < this.roundCards[1] ? 0 : 1;
    } else if (ids.length >= 2) {
      loser = seeded(this.seed, `loser:${this.breakStart}`) < 0.5 ? ids[0] : ids[1];
    }
    const other = ids.find((i) => i !== loser) ?? loser;
    if (this.breakStep === 0 && bt >= cornerA) {
      this.breakStep = 1;
      this.request({ kind: 'corner', reason: 'break', forced: false, priority: 3, earliest: tick, deadline: Infinity, subjects: [loser] });
    } else if (this.breakStep === 1 && bt >= cornerB) {
      this.breakStep = 2;
      this.request({ kind: 'corner', reason: 'break', forced: false, priority: 3, earliest: tick, deadline: Infinity, subjects: [other] });
    } else if (this.breakStep === 2 && bt >= jibBack) {
      this.breakStep = 3;
      this.request({ kind: 'jib', reason: 'break', forced: false, priority: 3, earliest: tick, deadline: Infinity, subjects: [] });
    }
  }

  private tryCommit(frame: TickSnapshot, tick: number): void {
    const p = this.pending;
    if (!p) return;
    if (tick > p.deadline) {
      this.pending = null;
      return;
    }
    if (tick < p.earliest) return;
    const cur = this.cur;
    let why: BlockedCut['reason'] | null = null;
    if (this.strikes.near(tick)) why = 'strike';
    else if (!p.forced && cur && tick - cur.startTick < MIN_SHOT_TICKS) why = 'minShot';
    else if (!p.forced && tick < this.kdHoldUntil) why = 'kdHold';
    if (why) {
      const key = `${p.kind}:${why}`;
      if (key !== this.blockedKey) {
        this.blockedKey = key;
        this.blocked.push({ tick, wanted: p.kind, reason: why });
      }
      return;
    }
    this.blockedKey = '';
    this.commit(p, frame, tick);
    this.pending = null;
  }

  private commit(r: Request, frame: TickSnapshot, tick: number): void {
    const n = this.entries.length;
    const s = seeded(this.seed, `jib:${n}`) < 0.5 ? -1 : 1;
    let azimuth = this.ca.mainAzimuth;
    let sweep = 0;
    let heights: readonly [number, number] = [0, 0];
    let durationS = 0;
    let subjects = r.subjects;
    switch (r.kind) {
      case 'cageside':
      case 'ground': {
        const prev = this.cur && (this.cur.kind === 'cageside' || this.cur.kind === 'ground' || this.cur.kind === 'finish')
          ? this.cur.azimuth : undefined;
        azimuth = chooseOperator(this.ca, frame, subjects, this.seed, `op:${n}`, prev);
        break;
      }
      case 'corner':
        azimuth = cornerAzimuth(this.ca, frame, subjects[0] ?? 0, this.seed);
        break;
      case 'finish':
        azimuth = chooseOperator(this.ca, frame, subjects, this.seed, `fin:${n}`, this.cur?.azimuth);
        break;
      case 'jib': {
        // Swing between panel centres so the move settles clear of a post.
        const [h0, h1] = PLACEMENT.jibHeightM;
        const step = this.ca.sides > 0 ? (2 * Math.PI) / this.ca.sides : 0.5;
        const swing = (k: number): number => s * Math.sign(k) * Math.min(Math.abs(k) * step, 1.75);
        const panel = (a: number): number => (this.ca.shape === 'unbounded' ? a : nearestPanelCentre(this.ca, a));
        if (r.reason === 'intro') {
          sweep = swing(-2); azimuth = panel(this.ca.mainAzimuth - sweep); heights = [h1, h0 + 0.2]; durationS = 16;
        } else if (r.reason === 'roundEnd') {
          sweep = swing(1); azimuth = panel(this.ca.mainAzimuth - sweep); heights = [h0 + 0.3, h1 - 0.6]; durationS = 7;
        } else if (r.reason === 'break') {
          sweep = swing(-1); azimuth = panel(this.ca.mainAzimuth - sweep); heights = [h1 - 0.4, h0 + 0.2]; durationS = 12;
        } else {
          sweep = swing(2); azimuth = panel(this.ca.mainAzimuth); heights = [h0, h1]; durationS = 24;
        }
        subjects = [];
        break;
      }
      default:
        break;
    }
    const entry: ShotPlanEntry = {
      kind: r.kind, startTick: tick, startT: tick * TICK_S, reason: r.reason, forced: r.forced,
      subjects, azimuth, sweep, heights, durationS,
      seed: Math.floor(seeded(this.seed, `shot:${n}`) * 1e6),
    };
    this.entries.push(entry);
    this.cur = entry;
  }

  /**
   * Close the plan: flush a cut the last frames were still waiting on and add
   * the post-roll (the shots shown while the playhead rests on the final
   * frame): the winner, then a sweeping jib wide.
   */
  finish(): ShotPlan {
    const frame = this.lastFrame;
    if (frame) {
      let t = this.lastTick + 1;
      const p = this.pending;
      if (p) {
        const cur = this.cur;
        t = Math.max(t, p.earliest);
        if (!p.forced && cur) t = Math.max(t, cur.startTick + MIN_SHOT_TICKS);
        while (this.strikes.near(t)) t++;
        this.commit(p, frame, t);
        this.pending = null;
      }
      const end = Math.max(t, this.lastTick);
      const winner = this.winner >= 0 ? this.winner : -1;
      if (this.finished) {
        this.commit({
          kind: 'finish', reason: 'post', forced: false, priority: 0, earliest: 0, deadline: Infinity,
          subjects: winner >= 0 ? [winner] : [],
        }, frame, Math.max(end + 55, (this.cur?.startTick ?? 0) + MIN_SHOT_TICKS));
      } else if (winner >= 0) {
        this.commit({
          kind: 'finish', reason: 'post', forced: false, priority: 0, earliest: 0, deadline: Infinity, subjects: [winner],
        }, frame, Math.max(end + 90, (this.cur?.startTick ?? 0) + MIN_SHOT_TICKS));
      }
      this.commit({
        kind: 'jib', reason: 'post', forced: false, priority: 0, earliest: 0, deadline: Infinity, subjects: [],
      }, frame, (this.cur?.startTick ?? end) + 80);
    }
    return { entries: this.entries, lastTick: this.lastTick, blocked: this.blocked };
  }
}

/** Plan a whole recorded bout. Pure: same inputs, same edit. */
export function planShots(
  frames: readonly TickSnapshot[], events: readonly SimEvent[], opts: PlannerOptions,
): ShotPlan {
  const strikes = new StrikeIndex(events);
  const roundStarts = opts.roundStarts ?? events.filter((e) => e.kind === 'roundStart').map((e) => e.tick);
  const planner = new ShotPlanner({ ...opts, roundStarts }, strikes);
  let ei = 0;
  const byTick: SimEvent[] = [];
  for (const frame of frames) {
    byTick.length = 0;
    while (ei < events.length && events[ei].tick <= frame.tick) byTick.push(events[ei++]);
    planner.step(frame, byTick);
  }
  return planner.finish();
}

/** Index of the plan entry on air at tick-time `t` (seconds). */
export function entryAt(plan: ShotPlan, t: number): number {
  const es = plan.entries;
  let lo = 0;
  let hi = es.length - 1;
  if (hi < 0) return -1;
  if (t < es[0].startT) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (es[mid].startT <= t + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
