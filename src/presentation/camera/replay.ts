/**
 * INSTANT REPLAY — what gets replayed, from which angles, and when it airs.
 *
 * `planReplays` is pure: from the recorded events and frames it finds the
 * moments a broadcast would replay (a knockdown, the finish, a slam, the
 * biggest shot of a round), picks two or three angles for each, slows them to
 * 0.25-0.35x, and schedules each at the next natural pause — never on top of
 * another replay and never before the moment has finished happening.
 *
 * `ReplaySequencer` plays a plan through any transport shaped like the Watch
 * screen's `BoutPlayer` (structurally typed here so the camera never imports
 * the app): it chains the angles, reports the state the graphics and the
 * camera need (`FrameInput.replay`, the REPLAY bug and its wipes), and hands
 * the playhead back to live when it is done.
 */
import type { SimEvent, TickSnapshot } from '../../sim';
import { TICK_S } from './planner';
import type { ShotKind } from './shots';

export type ReplayTrigger = 'finish' | 'knockdown' | 'slam' | 'bigStrike' | 'takedown' | 'submission';

export interface ReplaySegment {
  /** Camera for this angle. */
  shot: ShotKind;
  fromTick: number;
  toTick: number;
  /** Playback rate (0.25-0.35 slow motion). */
  speed: number;
  /** Depth of field strength 0-1 while this angle plays. */
  dof: number;
  /** Who the lens focuses on. */
  focus: 'striker' | 'target' | 'pair';
  /** Slow push-in over the angle (0 = locked), for the cinematic replay look. */
  pushIn: number;
}

export interface ReplayPlan {
  id: string;
  trigger: ReplayTrigger;
  /** Graphic title: "KNOCKDOWN", "KO", "SUBMISSION", "SLAM", "BIG SHOT". */
  title: string;
  /** The event's own line, for the timeline chip. */
  label: string;
  /** The instant the replay is about (the landing punch, the tap). */
  keyTick: number;
  keyTime: number;
  striker: number;
  target: number;
  /** Union of the angles' source ranges. */
  fromTick: number;
  toTick: number;
  /** Live tick at which the replay airs (the natural pause after the moment). */
  airTick: number;
  airReason: 'lull' | 'roundEnd' | 'boutEnd';
  segments: ReplaySegment[];
  /** Index of the triggering event in `events`. */
  eventIndex: number;
}

/** Tunables, documented in docs/design/PHASE8_NOTES.md. */
export const REPLAY_RULES = {
  /** A landed strike this hard (N) is a "big shot" (priority over takedowns at the round end). */
  bigStrikeForceN: 2000,
  /** The round's best landed strike still earns the round-end replay above this force (N). */
  roundBestForceN: 1500,
  /** A knockdown airs at the first lull: no strike for this long either side. */
  lullS: 2.5,
  /** ...and not sooner than this after the knockdown. */
  lullMinDelayS: 4,
  /** A lull must come within this long of the knockdown, else the round end. */
  lullMaxDelayS: 30,
} as const;

const secs = (s: number): number => Math.round(s / TICK_S);

interface Candidate {
  trigger: ReplayTrigger;
  priority: number;
  keyTick: number;
  keyTime: number;
  striker: number;
  target: number;
  eventTick: number;
  eventIndex: number;
  label: string;
  force: number;
  round: number;
}

const FINISH_TITLES: Record<string, string> = {
  ko: 'KNOCKOUT', tko: 'TKO', submission: 'SUBMISSION',
};

function angles(trigger: ReplayTrigger, key: number, onGround: boolean): ReplaySegment[] {
  // Each angle shows a little less than the one before: the first sets the
  // moment up, the later ones are the money shot again from somewhere else.
  switch (trigger) {
    case 'finish':
      return [
        { shot: 'cageside', fromTick: key - secs(2.0), toTick: key + secs(1.6), speed: 0.3, dof: 0.8, focus: 'target', pushIn: 0.25 },
        { shot: onGround ? 'overhead' : 'reverse', fromTick: key - secs(1.0), toTick: key + secs(1.2), speed: 0.35, dof: 0.55, focus: 'pair', pushIn: 0.12 },
        { shot: 'ground', fromTick: key - secs(0.5), toTick: key + secs(1.0), speed: 0.25, dof: 0.85, focus: 'target', pushIn: 0.3 },
      ];
    case 'knockdown':
      return [
        { shot: 'cageside', fromTick: key - secs(2.2), toTick: key + secs(1.4), speed: 0.3, dof: 0.8, focus: 'target', pushIn: 0.25 },
        { shot: onGround ? 'overhead' : 'reverse', fromTick: key - secs(1.2), toTick: key + secs(1.3), speed: 0.35, dof: 0.55, focus: 'pair', pushIn: 0.12 },
      ];
    case 'submission':
      return [
        { shot: 'overhead', fromTick: key - secs(3.5), toTick: key + secs(0.6), speed: 0.35, dof: 0.4, focus: 'pair', pushIn: 0.15 },
        { shot: 'ground', fromTick: key - secs(2), toTick: key + secs(0.8), speed: 0.3, dof: 0.85, focus: 'target', pushIn: 0.3 },
      ];
    case 'slam':
      return [
        { shot: 'cageside', fromTick: key - secs(1.8), toTick: key + secs(1.0), speed: 0.3, dof: 0.7, focus: 'pair', pushIn: 0.2 },
        { shot: 'overhead', fromTick: key - secs(1.0), toTick: key + secs(1.2), speed: 0.35, dof: 0.4, focus: 'pair', pushIn: 0.1 },
      ];
    case 'takedown':
      return [
        { shot: 'cageside', fromTick: key - secs(1.2), toTick: key + secs(2.2), speed: 0.35, dof: 0.6, focus: 'pair', pushIn: 0.18 },
        { shot: 'overhead', fromTick: key - secs(0.4), toTick: key + secs(2.2), speed: 0.35, dof: 0.35, focus: 'pair', pushIn: 0.1 },
      ];
    case 'bigStrike':
      return [
        { shot: 'cageside', fromTick: key - secs(1.6), toTick: key + secs(1.0), speed: 0.3, dof: 0.8, focus: 'target', pushIn: 0.25 },
        { shot: 'reverse', fromTick: key - secs(1.0), toTick: key + secs(0.9), speed: 0.35, dof: 0.55, focus: 'target', pushIn: 0.12 },
      ];
  }
}

/** The last landed strike by `striker` on `target` at or before `tick` (within `windowS`). */
function lastLanded(
  events: readonly SimEvent[], upTo: number, striker: number, target: number, windowS: number,
): SimEvent | null {
  for (let i = upTo; i >= 0; i--) {
    const e = events[i];
    if (e.tick < events[upTo].tick - secs(windowS)) break;
    if (e.kind !== 'strike') continue;
    const d = (e as { detail: { result: string } }).detail;
    if (d.result !== 'landed') continue;
    if (striker >= 0 && e.actor !== striker) continue;
    if (target >= 0 && e.target !== target) continue;
    return e;
  }
  return null;
}

function isFinishMethod(m: string | undefined): boolean {
  return !!m && (m.startsWith('ko') || m.startsWith('tko') || m.startsWith('submission'));
}

/**
 * Plan every instant replay in a recorded bout. Pure and deterministic.
 * Guarantees (tested): every knockdown and every finish is covered by a plan
 * whose source range contains it; source ranges never overlap; air ticks are
 * strictly increasing and never before the replayed moment ends.
 */
export function planReplays(events: readonly SimEvent[], frames: readonly TickSnapshot[]): ReplayPlan[] {
  if (frames.length === 0) return [];
  const firstTick = frames[0].tick;
  const lastTick = frames[frames.length - 1].tick;
  const frameAt = (tick: number): TickSnapshot => {
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return frames[lo];
  };
  const strikeTicks = events.filter((e) => e.kind === 'strike').map((e) => e.tick);
  const quietAround = (tick: number, s: number): boolean => {
    const g = secs(s);
    for (const t of strikeTicks) if (t >= tick - g && t <= tick + g) return false;
    return true;
  };
  const roundEndTick = new Map<number, number>();
  for (const e of events) if (e.kind === 'roundEnd') roundEndTick.set(e.round, e.tick);

  // ---- candidates --------------------------------------------------------
  const cands: Candidate[] = [];
  let finishIndex = -1;
  events.forEach((e, i) => {
    if (e.kind === 'boutEnd' && isFinishMethod((e.detail as { method?: string }).method)) finishIndex = i;
  });
  events.forEach((e, i) => {
    switch (e.kind) {
      case 'knockdown': {
        const downed = e.target >= 0 ? e.target : e.actor;
        const by = e.target >= 0 ? e.actor : -1;
        const hit = lastLanded(events, i, by, downed, 3);
        const keyTick = hit ? hit.tick : e.tick;
        cands.push({
          trigger: 'knockdown', priority: 4, keyTick, keyTime: hit ? hit.tick * TICK_S + hit.subMs / 1000 : e.tick * TICK_S,
          striker: by, target: downed, eventTick: e.tick, eventIndex: i, label: e.text || 'Knockdown', force: 0, round: e.round,
        });
        break;
      }
      case 'takedown': {
        const d = (e as { detail: { result?: string; to?: string } }).detail;
        if (d.result === 'success' && (d.to ?? '').startsWith('pos.td_')) {
          cands.push({
            trigger: 'takedown', priority: 1, keyTick: e.tick, keyTime: e.tick * TICK_S, striker: e.actor, target: e.target,
            eventTick: e.tick, eventIndex: i, label: e.text || 'Takedown', force: 0, round: e.round,
          });
        }
        break;
      }
      case 'slam':
        cands.push({
          trigger: 'slam', priority: 3, keyTick: e.tick, keyTime: e.tick * TICK_S, striker: e.actor, target: e.target,
          eventTick: e.tick, eventIndex: i, label: e.text || 'Slam', force: 0, round: e.round,
        });
        break;
      case 'strike': {
        const d = (e as { detail: { result: string; forceN?: number; target?: string } }).detail;
        if (d.result === 'landed' && (d.forceN ?? 0) >= REPLAY_RULES.roundBestForceN && d.target !== 'arms') {
          cands.push({
            trigger: 'bigStrike', priority: (d.forceN ?? 0) >= REPLAY_RULES.bigStrikeForceN ? 2 : 0.5, keyTick: e.tick, keyTime: e.tick * TICK_S + e.subMs / 1000,
            striker: e.actor, target: e.target, eventTick: e.tick, eventIndex: i, label: e.text || 'Big shot',
            force: d.forceN ?? 0, round: e.round,
          });
        }
        break;
      }
      default:
        break;
    }
  });

  // ---- the finish ---------------------------------------------------------
  const plans: ReplayPlan[] = [];
  let finishPlan: ReplayPlan | null = null;
  if (finishIndex >= 0) {
    const end = events[finishIndex];
    const method = (end.detail as { method?: string }).method ?? '';
    const sub = [...events].reverse().find((e) => e.kind === 'submissionFinish');
    const stop = [...events].reverse().find((e) => e.kind === 'refereeStoppage');
    let keyTick = end.tick;
    let keyTime = end.tick * TICK_S;
    let striker = -1;
    let target = -1;
    let trigger: ReplayTrigger = 'finish';
    let eventIndex = finishIndex;
    if (method.startsWith('submission') && sub) {
      keyTick = sub.tick;
      keyTime = sub.tick * TICK_S;
      striker = sub.actor;
      target = sub.target;
      trigger = 'submission';
      eventIndex = events.indexOf(sub);
    } else {
      const winner = stop ? stop.target : -1;
      striker = winner;
      target = frames[frames.length - 1].fighters.find((f) => f.id !== winner)?.id ?? -1;
      // The finishing moment: the last knockdown, else the last heavy landed shot.
      const kd = [...cands].reverse().find((c) => c.trigger === 'knockdown' && c.eventTick <= end.tick && c.eventTick >= end.tick - secs(20));
      const idx = stop ? events.indexOf(stop) : finishIndex;
      const hit = kd ? null : lastLanded(events, idx, winner, target, 10);
      if (kd) {
        keyTick = kd.keyTick;
        keyTime = kd.keyTime;
      } else if (hit) {
        keyTick = hit.tick;
        keyTime = hit.tick * TICK_S + hit.subMs / 1000;
      }
    }
    const onGround = frameAt(keyTick).fighters.some((f) => f.posture === 'ground');
    const segs = angles(trigger === 'submission' ? 'submission' : 'finish', keyTick, onGround)
      .map((s) => ({ ...s, fromTick: Math.max(firstTick, s.fromTick), toTick: Math.min(lastTick, s.toTick) }));
    finishPlan = makePlan({
      trigger, title: FINISH_TITLES[method.split('.')[0]] ?? 'FINISH', label: end.text || method,
      keyTick, keyTime, striker, target, airTick: lastTick, airReason: 'boutEnd', segments: segs, eventIndex,
    });
  }

  // ---- knockdowns: at the next lull (or the round end) ---------------------
  const taken: Array<[number, number]> = [];
  if (finishPlan) taken.push([finishPlan.fromTick, finishPlan.toTick]);
  const overlaps = (a: number, b: number): boolean => taken.some(([x, y]) => a <= y && b >= x);
  const airTicks = new Set<number>();
  if (finishPlan) airTicks.add(finishPlan.airTick);

  for (const c of cands.filter((x) => x.trigger === 'knockdown')) {
    const onGround = frameAt(c.keyTick).fighters.some((f) => f.posture === 'ground');
    // The first angle always runs on until the fighter is down.
    const segs = angles('knockdown', c.keyTick, onGround).map((s, k) => ({
      ...s,
      fromTick: Math.max(firstTick, s.fromTick),
      toTick: Math.min(lastTick, k === 0 ? Math.max(s.toTick, c.eventTick + secs(0.8)) : s.toTick),
    }));
    const from = Math.min(...segs.map((s) => s.fromTick));
    const to = Math.max(...segs.map((s) => s.toTick));
    if (finishPlan && from <= finishPlan.toTick && to >= finishPlan.fromTick) continue; // shown in the finish replay
    if (overlaps(from, to)) continue;
    // Air at the first lull after the knockdown, else at the round's end.
    let air = -1;
    const endOfRound = roundEndTick.get(c.round) ?? lastTick;
    for (let t = Math.max(to, c.eventTick + secs(REPLAY_RULES.lullMinDelayS)); t <= Math.min(endOfRound, c.eventTick + secs(REPLAY_RULES.lullMaxDelayS)); t++) {
      const f = frameAt(t);
      if (f.phase !== 'round') break;
      if (f.fighters.some((x) => x.posture === 'down')) continue;
      if (quietAround(t, REPLAY_RULES.lullS)) {
        air = t;
        break;
      }
    }
    let reason: ReplayPlan['airReason'] = 'lull';
    if (air < 0) {
      air = endOfRound;
      reason = endOfRound >= lastTick ? 'boutEnd' : 'roundEnd';
    }
    if (finishPlan && air >= finishPlan.airTick) continue; // the bout ended first; the finish replay covers it
    while (airTicks.has(air)) air++;
    airTicks.add(air);
    taken.push([from, to]);
    plans.push(makePlan({
      trigger: 'knockdown', title: 'KNOCKDOWN', label: c.label, keyTick: c.keyTick, keyTime: c.keyTime,
      striker: c.striker, target: c.target, airTick: air, airReason: reason, segments: segs, eventIndex: c.eventIndex,
    }));
  }

  // ---- one round-end replay per round: the best slam or big shot not yet shown
  const rounds = [...roundEndTick.keys()].sort((a, b) => a - b);
  for (const r of rounds) {
    const endTick = roundEndTick.get(r)!;
    if (finishPlan && endTick >= finishPlan.airTick) continue;
    if (airTicks.has(endTick)) continue;
    const pool = cands
      .filter((c) => (c.trigger === 'slam' || c.trigger === 'bigStrike' || c.trigger === 'takedown') && c.round === r)
      .sort((a, b) => b.priority - a.priority || b.force - a.force || a.keyTick - b.keyTick);
    for (const c of pool) {
      const segs = angles(c.trigger, c.keyTick, false).map((s) => ({
        ...s, fromTick: Math.max(firstTick, s.fromTick), toTick: Math.min(endTick, s.toTick),
      }));
      const from = Math.min(...segs.map((s) => s.fromTick));
      const to = Math.max(...segs.map((s) => s.toTick));
      if (overlaps(from, to) || to > endTick) continue;
      taken.push([from, to]);
      airTicks.add(endTick);
      plans.push(makePlan({
        trigger: c.trigger, title: c.trigger === 'slam' ? 'SLAM' : c.trigger === 'takedown' ? 'TAKEDOWN' : 'BIG SHOT', label: c.label,
        keyTick: c.keyTick, keyTime: c.keyTime, striker: c.striker, target: c.target,
        airTick: endTick, airReason: 'roundEnd', segments: segs, eventIndex: c.eventIndex,
      }));
      break;
    }
  }

  if (finishPlan) plans.push(finishPlan);
  plans.sort((a, b) => a.airTick - b.airTick);
  return plans;
}

function makePlan(p: Omit<ReplayPlan, 'id' | 'fromTick' | 'toTick'>): ReplayPlan {
  const segments = p.segments.filter((s) => s.toTick > s.fromTick);
  return {
    ...p,
    segments,
    id: `${p.trigger}-${p.keyTick}`,
    fromTick: Math.min(...segments.map((s) => s.fromTick)),
    toTick: Math.max(...segments.map((s) => s.toTick)),
  };
}

/** Real-time length of a replay (seconds of screen time), including its wipes. */
export function replayDuration(plan: ReplayPlan): number {
  return plan.segments.reduce((s, g) => s + ((g.toTick - g.fromTick) * TICK_S) / g.speed, 0);
}

// ---------------------------------------------------------------------------
// Sequencer
// ---------------------------------------------------------------------------

/** What `BoutPlayer.startInstantReplay` accepts. */
export interface ReplayRequest {
  fromTick: number;
  toTick: number;
  speed: number;
  label: string;
  eventIndex: number;
}

/** The part of the Watch screen's transport the sequencer drives (BoutPlayer fits). */
export interface ReplayTransport {
  readonly tick: number;
  readonly playing: boolean;
  readonly inInstantReplay: boolean;
  /** True when the playhead rests on the last frame (BoutPlayer.atEnd). */
  readonly atEnd?: boolean;
  startInstantReplay(req: ReplayRequest): void;
  stopInstantReplay(): void;
}

export interface ReplayState {
  plan: ReplayPlan;
  segmentIndex: number;
  segment: ReplaySegment;
  /** Increments on every replay start and end: the overlay keys its wipe on it. */
  wipeKey: number;
}

export function segmentRequest(plan: ReplayPlan, i: number): ReplayRequest {
  const s = plan.segments[i];
  return {
    fromTick: s.fromTick, toTick: s.toTick, speed: s.speed,
    label: `${plan.title} · ${i + 1}/${plan.segments.length}`, eventIndex: plan.eventIndex,
  };
}

/**
 * Chains a plan's angles through the transport. Call `update()` once per
 * animation frame, right after the transport has advanced, so a finished
 * angle hands straight to the next without a live frame in between.
 */
export class ReplaySequencer {
  private active: { plan: ReplayPlan; index: number } | null = null;
  private lastTick = -1;
  private aired = new Set<string>();
  private wipes = 0;
  /** Air replays automatically when the playhead crosses their air tick. */
  auto = true;

  constructor(readonly plans: readonly ReplayPlan[]) {}

  get state(): ReplayState | null {
    const a = this.active;
    if (!a) return null;
    return { plan: a.plan, segmentIndex: a.index, segment: a.plan.segments[a.index], wipeKey: this.wipes };
  }

  /** Wipe counter, also advanced when a replay ends (for the wipe out). */
  get wipeKey(): number {
    return this.wipes;
  }

  play(plan: ReplayPlan, t: ReplayTransport): void {
    if (plan.segments.length === 0) return;
    this.active = { plan, index: 0 };
    this.aired.add(plan.id);
    this.wipes++;
    t.startInstantReplay(segmentRequest(plan, 0));
  }

  stop(t: ReplayTransport): void {
    if (!this.active) return;
    this.active = null;
    this.wipes++;
    if (t.inInstantReplay) t.stopInstantReplay();
    this.lastTick = t.tick;
  }

  /** Forget what has aired (after a seek backwards the replays air again). */
  reset(tick: number): void {
    this.active = null;
    this.lastTick = tick;
    for (const p of this.plans) if (p.airTick > tick) this.aired.delete(p.id);
  }

  update(t: ReplayTransport): void {
    const a = this.active;
    if (a) {
      if (t.inInstantReplay) return;
      // The transport finished this angle and returned to live: next angle.
      if (a.index + 1 < a.plan.segments.length) {
        a.index++;
        t.startInstantReplay(segmentRequest(a.plan, a.index));
        return;
      }
      this.active = null;
      this.wipes++;
      this.lastTick = t.tick;
      return;
    }
    const tick = t.tick;
    const prev = this.lastTick;
    this.lastTick = tick;
    if (!this.auto || prev < 0 || tick === prev) return;
    // Playback reaching the last frame stops the transport, and that is
    // exactly when the finish replay is due, so "at the end" counts as playing.
    if (!t.playing && !t.atEnd) return;
    if (tick < prev || tick - prev > 20) {
      // A seek, not playback: re-arm what lies ahead, air nothing skipped over.
      this.reset(tick);
      return;
    }
    const due = this.plans.find((p) => !this.aired.has(p.id) && p.airTick > prev && p.airTick <= tick);
    if (due) this.play(due, t);
  }
}
