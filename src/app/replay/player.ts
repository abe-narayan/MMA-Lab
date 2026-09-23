/**
 * BOUT TRANSPORT v4 (docs/design/09 §4.5).
 *
 * The playback transport over a recorded `BoutRun`. It is the v4 successor of
 * `src/replay/player.ts`, which drives the old engine and is left alone; the
 * ideas worth keeping are kept — frame-accurate seek, an interpolation alpha
 * for the renderer, click-an-event-to-jump — and the missing half of §4.5 is
 * added: true slow motion, a loop range, and the instant-replay buffer.
 *
 * Two properties this file exists to guarantee:
 *
 *  1. **Frame-accurate.** Seeking is an array index, found by binary search on
 *     the recorded tick, never by arithmetic on a frame rate. `seekTick(t)`
 *     lands on the frame whose tick is `t` when one exists.
 *  2. **Wall-clock-independent.** `advance(dt)` is handed elapsed seconds; it
 *     accumulates fractional frames in a carry and consumes whole ones. The
 *     same sequence of `dt` values always produces the same sequence of
 *     frames, at any speed, and at 0.1x it visits every frame exactly once
 *     rather than dropping or repeating one.
 *
 * No React, no DOM, no `Math.random()`, no `Date.now()`.
 */
import type { SimEvent, TickSnapshot } from '../../sim';

/** One simulated tick, in seconds (09 §2.1). */
export const TICK_SECONDS = 0.1;
/** 09 §4.5: the speed range `MatchSettings.speed` may take. */
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 8;
/** 09 §4.5 `[E]`: the presenter keeps a ring of the last 200 frames (20 s). */
export const INSTANT_REPLAY_BUFFER_FRAMES = 200;
/** 09 §4.5 `[E]`: 4 s before the moment, 2 s after. */
export const INSTANT_REPLAY_LEAD_TICKS = 40;
export const INSTANT_REPLAY_TAIL_TICKS = 20;
export const INSTANT_REPLAY_SPEED = 0.25;

/** The event kinds that earn an instant replay (09 §4.5). */
export const REPLAY_WORTHY: ReadonlySet<string> = new Set([
  'knockdown', 'submissionFinish', 'refereeStoppage', 'reversal', 'foul', 'slam',
]);

export interface PlayerSource {
  frames: readonly TickSnapshot[];
  events: readonly SimEvent[];
}

export interface LoopRange {
  fromTick: number;
  toTick: number;
}

export interface InstantReplayRequest {
  fromTick: number;
  toTick: number;
  speed: number;
  /** What the chip on the timeline says. */
  label: string;
  /** Index into `events`, or -1 for a manual "last N seconds". */
  eventIndex: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class BoutPlayer {
  readonly frames: readonly TickSnapshot[];
  readonly events: readonly SimEvent[];
  /** Frame index for each event, parallel to `events` — click-to-seek. */
  readonly eventFrame: readonly number[];
  /** Every moment that would earn an instant replay, in tick order. */
  readonly replayTriggers: readonly InstantReplayRequest[];

  frame = 0;
  playing = false;
  private speedValue = 1;
  private carry = 0;
  private loop: LoopRange | null = null;

  /** Set while an instant replay is running; holds what to restore afterwards. */
  private replay: {
    req: InstantReplayRequest;
    returnFrame: number;
    returnSpeed: number;
    returnPlaying: boolean;
  } | null = null;

  constructor(source: PlayerSource) {
    this.frames = source.frames;
    this.events = source.events;
    this.eventFrame = source.events.map((e) => this.indexForTick(e.tick));
    const triggers: InstantReplayRequest[] = [];
    source.events.forEach((e, i) => {
      if (!REPLAY_WORTHY.has(e.kind)) return;
      if (e.kind === 'foul' && !(e as { detail?: { detected?: boolean } }).detail?.detected) return;
      triggers.push({
        fromTick: Math.max(0, e.tick - INSTANT_REPLAY_LEAD_TICKS),
        toTick: e.tick + INSTANT_REPLAY_TAIL_TICKS,
        speed: INSTANT_REPLAY_SPEED,
        label: e.text || e.kind,
        eventIndex: i,
      });
    });
    this.replayTriggers = triggers;
  }

  // ---- reading -----------------------------------------------------------

  get total(): number {
    return this.frames.length;
  }

  get current(): TickSnapshot | null {
    return this.frames[this.frame] ?? null;
  }

  /** The frame after the playhead, for the renderer's interpolation. */
  get next(): TickSnapshot | null {
    return this.frames[this.frame + 1] ?? null;
  }

  /** Interpolation alpha in [0, 1) between `current` and `next`. */
  get alpha(): number {
    return this.carry;
  }

  get tick(): number {
    return this.current?.tick ?? 0;
  }

  get t(): number {
    return this.current?.t ?? 0;
  }

  get atEnd(): boolean {
    return this.frame >= this.total - 1;
  }

  get speed(): number {
    return this.speedValue;
  }

  get loopRange(): LoopRange | null {
    return this.loop;
  }

  get inInstantReplay(): boolean {
    return this.replay !== null;
  }

  get instantReplay(): InstantReplayRequest | null {
    return this.replay?.req ?? null;
  }

  /**
   * Frame index for a tick. Binary search over the recorded ticks rather than
   * `tick` used as an index: the recorder writes one frame before the first
   * step and one after the last, so index and tick are close but not equal,
   * and "close" is exactly the bug that makes an event-seek land a frame out.
   */
  indexForTick(tick: number): number {
    const n = this.frames.length;
    if (n === 0) return 0;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.frames[mid].tick < tick) lo = mid + 1;
      else hi = mid;
    }
    // `lo` is the first frame at or after `tick`; prefer the exact match, and
    // otherwise the last frame at or before it.
    if (this.frames[lo].tick === tick) return lo;
    if (this.frames[lo].tick > tick && lo > 0) return lo - 1;
    return lo;
  }

  /** Index of the latest event at or before the playhead, or -1. */
  currentEventIndex(): number {
    const tick = this.tick;
    let idx = -1;
    for (let i = 0; i < this.events.length; i++) {
      if (this.events[i].tick <= tick) idx = i;
      else break;
    }
    return idx;
  }

  /** The last `seconds` of frames ending at the playhead — the replay buffer. */
  buffer(seconds = INSTANT_REPLAY_BUFFER_FRAMES * TICK_SECONDS): readonly TickSnapshot[] {
    const span = Math.max(1, Math.round(seconds / TICK_SECONDS));
    return this.frames.slice(Math.max(0, this.frame - span + 1), this.frame + 1);
  }

  // ---- transport ---------------------------------------------------------

  play(): void {
    if (this.atEnd && !this.loop) this.seekFrame(0);
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  restart(): void {
    this.seekFrame(this.loop ? this.indexForTick(this.loop.fromTick) : 0);
    this.playing = true;
  }

  setSpeed(speed: number): void {
    this.speedValue = clamp(speed, MIN_SPEED, MAX_SPEED);
  }

  seekFrame(index: number): void {
    this.frame = clamp(Math.round(index), 0, Math.max(0, this.total - 1));
    this.carry = 0;
  }

  /** Frame-accurate seek by simulated tick. */
  seekTick(tick: number): void {
    this.seekFrame(this.indexForTick(tick));
  }

  /** Seek to the tick that produced `events[index]`. */
  seekEvent(index: number): void {
    const e = this.events[index];
    if (!e) return;
    this.seekTick(e.tick);
  }

  /** Step by whole frames; always pauses, so a step is a step. */
  stepBy(n: number): void {
    this.pause();
    this.seekFrame(this.frame + Math.round(n));
  }

  /** Jump to the next/previous recorded event (`dir` = +1 / -1). */
  stepEvent(dir: 1 | -1): void {
    const tick = this.tick;
    if (dir === 1) {
      for (let i = 0; i < this.events.length; i++) {
        if (this.events[i].tick > tick) {
          this.seekEvent(i);
          return;
        }
      }
      this.seekFrame(this.total - 1);
      return;
    }
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].tick < tick) {
        this.seekEvent(i);
        return;
      }
    }
    this.seekFrame(0);
  }

  setLoop(range: LoopRange | null): void {
    if (!range) {
      this.loop = null;
      return;
    }
    const fromTick = Math.min(range.fromTick, range.toTick);
    const toTick = Math.max(range.fromTick, range.toTick);
    this.loop = { fromTick, toTick };
    if (this.tick < fromTick || this.tick > toTick) this.seekTick(fromTick);
  }

  // ---- instant replay ----------------------------------------------------

  /** Re-show the last `seconds` at `speed`, then return to where we were. */
  showLastSeconds(seconds = 8, speed = INSTANT_REPLAY_SPEED): void {
    const tick = this.tick;
    this.startInstantReplay({
      fromTick: Math.max(0, tick - Math.round(seconds / TICK_SECONDS)),
      toTick: tick,
      speed,
      label: `Last ${seconds}s`,
      eventIndex: -1,
    });
  }

  startInstantReplay(req: InstantReplayRequest): void {
    if (this.replay) this.stopInstantReplay();
    this.replay = {
      req,
      returnFrame: this.frame,
      returnSpeed: this.speedValue,
      returnPlaying: this.playing,
    };
    this.setSpeed(req.speed);
    this.seekTick(req.fromTick);
    this.playing = true;
  }

  /** End the replay and restore the playhead, speed and play state. */
  stopInstantReplay(): void {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    this.speedValue = r.returnSpeed;
    this.seekFrame(r.returnFrame);
    this.playing = r.returnPlaying;
  }

  /** The replay-worthy moments up to and including the playhead. */
  availableReplays(): readonly InstantReplayRequest[] {
    const tick = this.tick;
    return this.replayTriggers.filter((r) => r.toTick <= tick);
  }

  // ---- the clock ---------------------------------------------------------

  /**
   * Advance by elapsed real seconds and return the interpolation alpha.
   *
   * The carry is kept in fractional frames, so at 0.1x ten calls of 0.1 s
   * advance exactly one frame: no frame is skipped and none is shown twice.
   */
  advance(dtSeconds: number, tickSeconds = TICK_SECONDS): number {
    if (!this.playing) return this.carry;
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return this.carry;

    this.carry += (dtSeconds * this.speedValue) / tickSeconds;
    const whole = Math.floor(this.carry);
    if (whole <= 0) return this.carry;
    this.carry -= whole;
    let target = this.frame + whole;

    const r = this.replay;
    if (r) {
      const end = this.indexForTick(r.req.toTick);
      if (target >= end) {
        this.stopInstantReplay();
        return this.carry;
      }
      this.frame = target;
      return this.carry;
    }

    if (this.loop) {
      const lo = this.indexForTick(this.loop.fromTick);
      const hi = this.indexForTick(this.loop.toTick);
      const span = Math.max(1, hi - lo + 1);
      if (target > hi) target = lo + ((target - lo) % span);
      this.frame = clamp(target, lo, hi);
      return this.carry;
    }

    if (target >= this.total - 1) {
      this.frame = this.total - 1;
      this.carry = 0;
      this.playing = false;
      return 0;
    }
    this.frame = target;
    return this.carry;
  }
}
