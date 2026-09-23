/**
 * CROWD REACTIONS — a pure function of the recorded events and the sim clock.
 *
 * The crowd stands and roars on knockdowns and finishes, cheers takedowns and
 * big shots, rises through a deep submission, applauds the bell, and fires
 * camera flashes in proportion to how loud it is. Because it reads nothing but
 * (events, simTime, frame summary), a replay and a scrub show the same crowd.
 * `EventMemory` only buffers events longer than the presenter's 2-second window
 * so a finish roar can outlast it; it is cleared on seek.
 *
 * Seat-level decisions (who stands first, which seat flashes) are hashed from
 * the cosmetic seed and the seat index in the crowd shader; `flashOn` is the
 * CPU mirror of that rule for tests and tools.
 */
import type { SimEvent } from '../../sim';
import { pcgHash01 } from './rng';

export interface CrowdState {
  /** 0-1 overall energy (noise, bounce, arm waving). */
  excitement: number;
  /** 0-1 fraction of the crowd on its feet. */
  stand: number;
  /** Camera flashes per second per 1000 seats. */
  flashRate: number;
  /** 0-1 fraction of seats holding a phone light up. */
  phones: number;
}

export interface CrowdContext {
  phase: 'pre' | 'round' | 'break' | 'ended';
  /** Anyone currently down (posture 'down'). */
  anyDown: boolean;
  /** Deepest submission stage currently on (0-4). */
  subStage: number;
}

interface Impulse { excite: number; stand: number; tau: number; flash: number }

/** How the building reacts to each event kind. `null` = no reaction. */
export function impulseFor(e: SimEvent): Impulse | null {
  switch (e.kind) {
    case 'knockdown': return { excite: 1.0, stand: 0.9, tau: 7, flash: 1.0 };
    case 'rocked': return { excite: 0.6, stand: 0.35, tau: 3.5, flash: 0.4 };
    case 'submissionFinish':
    case 'refereeStoppage':
    case 'fighterOut':
    case 'cornerStop':
    case 'streetEnd':
      return { excite: 1.0, stand: 1.0, tau: 25, flash: 1.0 };
    case 'boutEnd': return { excite: 0.8, stand: 0.8, tau: 20, flash: 0.7 };
    case 'decision': return { excite: 0.85, stand: 0.75, tau: 15, flash: 0.8 };
    case 'boutStart': return { excite: 0.65, stand: 0.25, tau: 6, flash: 0.5 };
    case 'roundStart': return { excite: 0.35, stand: 0, tau: 3, flash: 0.15 };
    case 'roundEnd': return { excite: 0.45, stand: 0.1, tau: 4, flash: 0.2 };
    case 'slam': return { excite: 0.7, stand: 0.4, tau: 3.5, flash: 0.5 };
    case 'takedown':
      return e.detail.result === 'success' ? { excite: 0.35, stand: 0.05, tau: 2.5, flash: 0.1 } : null;
    case 'reversal':
    case 'scramble':
      return { excite: 0.25, stand: 0, tau: 2, flash: 0 };
    case 'submissionStage':
      return e.detail.stage >= 2 ? { excite: 0.15 * e.detail.stage, stand: e.detail.stage >= 3 ? 0.3 : 0, tau: 3, flash: 0.1 } : null;
    case 'strike': {
      if (e.detail.result !== 'landed') return null;
      const head = e.detail.damage?.head ?? 0;
      const force = e.detail.forceN ?? 0;
      const big = Math.max(head * 6, (force - 2500) / 4000);
      if (big <= 0.15) return null;
      return { excite: Math.min(0.55, big * 0.5), stand: 0, tau: 1.3, flash: Math.min(0.3, big * 0.2) };
    }
    case 'deduction': return { excite: 0.3, stand: 0, tau: 3, flash: 0 };
    default: return null;
  }
}

export function eventTime(e: SimEvent, tickS = 0.1): number {
  return e.tick * tickS + e.subMs / 1000;
}

const ATTACK_S = 0.35;

function envelope(dt: number, tau: number): number {
  if (dt < 0) return 0;
  const rise = Math.min(1, dt / ATTACK_S);
  return rise * Math.exp(-dt / tau);
}

/**
 * The crowd's state at `simTime`. Pure: the same (events, simTime, ctx) always
 * gives the same answer, whatever order the events arrive in.
 */
export function crowdState(
  events: readonly SimEvent[], simTime: number, ctx: CrowdContext, tickS = 0.1,
): CrowdState {
  // Products of (1 - a) saturate softly. Contributions are accumulated in a
  // canonical event order so the answer is bit-identical whatever order the
  // events arrived in (live, replay, after a seek).
  const live: { e: SimEvent; imp: Impulse; dt: number }[] = [];
  for (const e of events) {
    const imp = impulseFor(e);
    if (!imp) continue;
    const dt = simTime - eventTime(e, tickS);
    if (dt < 0 || dt > imp.tau * 6) continue;
    live.push({ e, imp, dt });
  }
  live.sort((p, q) => p.e.tick - q.e.tick || p.e.subMs - q.e.subMs || (p.e.kind < q.e.kind ? -1 : p.e.kind > q.e.kind ? 1 : 0)
    || p.e.actor - q.e.actor || p.e.target - q.e.target);
  let quietE = 1;
  let sitting = 1;
  let flash = 0;
  for (const { imp, dt } of live) {
    const env = envelope(dt, imp.tau);
    quietE *= 1 - imp.excite * env;
    sitting *= 1 - imp.stand * envelope(dt, imp.tau * 1.2);
    // Flash bursts are short: the moment itself, then a tail.
    flash += imp.flash * Math.exp(-dt / 1.5);
  }
  let excitement = 1 - quietE;
  let stand = 1 - sitting;

  // Sustained states from the frame.
  const base = ctx.phase === 'round' ? 0.14 : ctx.phase === 'break' ? 0.08 : ctx.phase === 'pre' ? 0.3 : 0.5;
  excitement = 1 - (1 - excitement) * (1 - base);
  if (ctx.anyDown) { excitement = Math.max(excitement, 0.7); stand = Math.max(stand, 0.5); }
  if (ctx.subStage >= 3) { excitement = Math.max(excitement, 0.55); stand = Math.max(stand, 0.25); }
  if (ctx.phase === 'ended') { excitement = Math.max(excitement, 0.6); stand = Math.max(stand, 0.7); }

  const flashRate = 0.6 + 30 * excitement * excitement + 60 * flash;
  const phones = ctx.phase === 'ended' ? 0.35 : ctx.phase === 'pre' ? 0.25 : 0.03 + 0.2 * stand;
  return {
    excitement: clamp01(excitement),
    stand: clamp01(stand),
    flashRate,
    phones: clamp01(phones),
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Flash buckets per second; one seat flashes for at most one bucket (~1/15 s). */
export const FLASH_BUCKETS_PER_S = 15;

/**
 * The flash rule the crowd shader runs (crowd.ts), mirrored exactly on the CPU:
 * seat `seat` fires in the 1/15 s bucket containing `simTime` when the PCG hash
 * of (seat * 7919 + bucket + seedOffset) mod 2^32 falls under the per-bucket
 * probability. Only sim time goes in, so replays flash identically.
 */
export function flashSeed(seat: number, simTime: number, seedOffset: number): number {
  const bucket = Math.floor(simTime * FLASH_BUCKETS_PER_S);
  return (Math.imul(seat >>> 0, 7919) + bucket + (seedOffset >>> 0)) >>> 0;
}

export function flashOn(seedOffset: number, seat: number, simTime: number, flashRate: number): boolean {
  const p = flashRate / 1000 / FLASH_BUCKETS_PER_S;
  return pcgHash01(flashSeed(seat, simTime, seedOffset)) < p;
}

/**
 * Keeps events longer than the presenter's window so long reactions survive.
 * Deterministic: keyed by the verified event fields, trimmed by sim time.
 */
export class EventMemory {
  private readonly map = new Map<string, SimEvent>();
  private list: SimEvent[] = [];
  private dirty = false;

  constructor(private readonly keepS = 40, private readonly tickS = 0.1) {}

  clear(): void {
    this.map.clear();
    this.list = [];
  }

  add(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (!impulseFor(e)) continue;
      const k = `${e.tick}:${e.subMs}:${e.kind}:${e.actor}:${e.target}`;
      if (!this.map.has(k)) { this.map.set(k, e); this.dirty = true; }
    }
  }

  /** Events not in the future of `simTime` and not older than the keep window. */
  at(simTime: number): readonly SimEvent[] {
    if (this.dirty) {
      this.list = [...this.map.values()];
      this.dirty = false;
    }
    let trimmed = false;
    for (const [k, e] of this.map) {
      if (simTime - eventTime(e, this.tickS) > this.keepS) { this.map.delete(k); trimmed = true; }
    }
    if (trimmed) this.list = [...this.map.values()];
    return this.list;
  }
}
