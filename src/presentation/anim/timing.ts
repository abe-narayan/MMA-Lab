/**
 * ACTION TIMING — when did this strike start, when does it land, when is it over?
 *
 * The sim resolves a strike at exactly `contactTick * 100 + contactOffsetMs`
 * (the scheduler's `tMs`), and the animation's moment of impact must land on
 * that instant. The snapshot only carries the scheduled contact while it is
 * *pending*: in the tick that resolves it the contact leaves the queue, and
 * the snapshot's `actionDetail` falls back to "now". So the timing is
 * reconstructed from three sources, best first:
 *
 *   1. a pending contact on `frame` or `next` (exact `tMs`; the commit instant
 *      follows from the tier-scaled total and the catalogue's startup share,
 *      because the sim scales startup/active/recovery by one multiplier);
 *   2. the resolved `strike` event (its `tick*100 + subMs` IS `tMs`), which also
 *      carries the result, region, defence and force;
 *   3. a latch of whatever was last known for this action (kept by the caller).
 */
import {
  TECHNIQUES, type FighterSnapshot, type SimEvent, type StrikeEvent, type TechniqueSpec,
  type TickSnapshot,
} from '../../sim';

export const TECH: ReadonlyMap<string, TechniqueSpec> = new Map(TECHNIQUES.map((t) => [t.id, t]));

export type Region = 'head' | 'body' | 'leadLeg' | 'rearLeg' | 'arms';
export type Result = 'pending' | 'landed' | 'blocked' | 'evaded' | 'missed' | 'checked' | 'caught' | 'interrupted';

export interface ActionTiming {
  id: string;
  spec: TechniqueSpec | null;
  /** All in sim milliseconds. */
  commit: number;
  contact: number;
  activeEnd: number;
  end: number;
  targetId: number | null;
  result: Result;
  region: Region;
  subLocation: string | null;
  defence: string | null;
  forceN: number;
  event: StrikeEvent | null;
  /** True when the contact instant is exact (from the scheduler or the event). */
  exact: boolean;
}

export function isStrikeEvent(e: SimEvent): e is StrikeEvent {
  return e.kind === 'strike';
}

const eventMs = (e: SimEvent): number => e.tick * 100 + e.subMs;

/** The strike event that resolved `actor`'s `id` at `contactMs`, if already recorded. */
export function findStrikeEvent(
  events: readonly SimEvent[], actor: number, id: string, contactMs: number | null, notBefore = -Infinity,
): StrikeEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== 'strike' || e.actor !== actor) continue;
    const se = e as StrikeEvent;
    if (se.detail.technique !== id) continue;
    const ms = eventMs(se);
    if (contactMs !== null) {
      if (Math.abs(ms - contactMs) < 0.5) return se;
      continue;
    }
    if (ms >= notBefore) return se;
    return null;
  }
  return null;
}

function hasPending(f: FighterSnapshot, snapTick: number): boolean {
  return f.action.startsWith('tech.') && f.actionDetail.contactTick > snapTick;
}

function fromSpec(
  id: string, spec: TechniqueSpec | null, contact: number, totalMs: number, targetId: number | null,
): ActionTiming {
  const s = spec ? spec.startupMs : 300;
  const a = spec ? spec.activeMs : 80;
  const r = spec ? spec.recoveryMs : 300;
  const tot = Math.max(1, totalMs || s + a + r);
  const k = tot / (s + a + r);
  const region: Region = spec ? (spec.targets[0] as Region) : 'head';
  return {
    id, spec, commit: contact - s * k, contact, activeEnd: contact + a * k, end: contact - s * k + tot,
    targetId, result: 'pending', region, subLocation: null, defence: null, forceN: 0, event: null, exact: true,
  };
}

function applyEvent(t: ActionTiming, e: StrikeEvent | null): ActionTiming {
  if (!e) return t;
  t.event = e;
  t.result = e.detail.result as Result;
  t.region = e.detail.target as Region;
  t.subLocation = e.detail.subLocation ?? null;
  t.defence = e.detail.defence ?? null;
  t.forceN = e.detail.forceN ?? 0;
  t.targetId = e.target;
  return t;
}

/**
 * The strike (standing technique) this fighter is performing around `nowMs`,
 * or null. `latch` is the caller's memory of the last timing for this fighter.
 */
export function strikeTiming(
  id: number, frame: TickSnapshot, next: TickSnapshot | null, nowMs: number,
  events: readonly SimEvent[], latch: ActionTiming | null,
): ActionTiming | null {
  const f0 = frame.fighters[id];
  const f1 = next?.fighters[id];

  // A new action that commits inside this interpolation interval.
  if (f1 && hasPending(f1, next!.tick) && f1.action !== 'idle') {
    const spec = TECH.get(f1.action) ?? null;
    const c = f1.actionDetail.contactTick * 100 + f1.actionDetail.contactOffsetMs;
    const t = fromSpec(f1.action, spec, c, f1.actionDetail.totalMs, f1.actionDetail.targetId);
    const onF0 = f0 && f0.action === f1.action && hasPending(f0, frame.tick)
      && f0.actionDetail.contactTick * 100 + f0.actionDetail.contactOffsetMs === c;
    if (onF0 || t.commit <= nowMs) return applyEvent(t, findStrikeEvent(events, id, f1.action, c));
  }
  if (!f0) return null;
  if (hasPending(f0, frame.tick)) {
    const spec = TECH.get(f0.action) ?? null;
    const c = f0.actionDetail.contactTick * 100 + f0.actionDetail.contactOffsetMs;
    const t = fromSpec(f0.action, spec, c, f0.actionDetail.totalMs, f0.actionDetail.targetId);
    return applyEvent(t, findStrikeEvent(events, id, f0.action, c));
  }
  if (f0.action.startsWith('tech.')) {
    // Resolved: the event gives the exact contact instant.
    if (latch && latch.id === f0.action && nowMs <= latch.end + 150) {
      if (!latch.event) applyEvent(latch, findStrikeEvent(events, id, f0.action, latch.contact));
      return latch;
    }
    const spec = TECH.get(f0.action) ?? null;
    const e = findStrikeEvent(events, id, f0.action, null, nowMs - 3000);
    if (e) {
      const t = fromSpec(f0.action, spec, eventMs(e), f0.actionDetail.totalMs, e.target);
      if (nowMs <= t.end + 150) return applyEvent(t, e);
    }
  }
  if (latch && nowMs <= latch.end && nowMs >= latch.commit) return latch;
  return null;
}

/** Normalised progress of a timing at `nowMs`. */
export interface Progress {
  /** 0..1 over commit -> contact. */
  pre: number;
  /** 0..1 over contact -> end (active + recovery). */
  post: number;
  /** 0..1 over contact -> end of active. */
  active: number;
  /** ms relative to contact (negative before). */
  dt: number;
  /** Before contact? */
  before: boolean;
}

export function progress(t: ActionTiming, nowMs: number): Progress {
  const pre = (nowMs - t.commit) / Math.max(1, t.contact - t.commit);
  const post = (nowMs - t.contact) / Math.max(1, t.end - t.contact);
  const active = (nowMs - t.contact) / Math.max(1, t.activeEnd - t.contact);
  return {
    pre: Math.max(0, Math.min(1, pre)),
    post: Math.max(0, Math.min(1, post)),
    active: Math.max(0, Math.min(1, active)),
    dt: nowMs - t.contact,
    before: nowMs < t.contact,
  };
}
