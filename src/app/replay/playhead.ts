/**
 * PLAYHEAD SIGNAL — how the Watch screen's panels learn that the playhead
 * moved without the whole screen re-rendering (Watch/replay pass).
 *
 * Before this, the Watch screen kept the frame index in React state and set it
 * on every sim tick of playback, so the entire screen (transport, HUD, stats,
 * scorecards, game plan, commentary, the 7 000-row event log, the broadcast
 * graphics) re-rendered 10 times a second at 1x and 40 at 4x. Now the
 * transport (`BoutPlayer`) stays the single source of truth, the animation
 * loop calls `notify()` when the frame or the replay state actually changed,
 * and each panel subscribes with its own selector and refresh rate
 * (`usePlayhead`): the clock at 10 Hz, the scrubber at 20 Hz, statistics at
 * 4 Hz, the event log only when the playhead crosses an event. The 3D view
 * never subscribes; it reads the player from its own rAF loop.
 *
 * No React here (the hook is in components/watch/usePlayhead.ts), no DOM.
 */

export type PlayheadListener = () => void;

export class PlayheadSignal {
  private readonly listeners = new Set<PlayheadListener>();
  private versionValue = 0;

  /** Monotonic change counter: bumped by every `notify()`. */
  get version(): number {
    return this.versionValue;
  }

  subscribe(listener: PlayheadListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The playhead (frame, play state, speed, replay on air) changed. */
  notify(): void {
    this.versionValue++;
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (err) {
        console.error('[playhead] listener failed', err);
      }
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

/**
 * Rate limiter for one subscriber: `due(now)` is true when at least three
 * quarters of `1000 / hz` ms passed since the last accepted update. The
 * slack matters: sim ticks arrive on display-frame boundaries (a 10 Hz tick
 * lands 83 or 100 ms after the last at 60 Hz), and a strict interval would
 * push half the updates to a trailing timer — a second React commit instead
 * of sharing the one every other panel makes for that tick. `hz <= 0` or
 * `Infinity` means every change.
 */
export class Throttle {
  private last = -Infinity;

  constructor(private readonly hz: number) {}

  get intervalMs(): number {
    return this.hz > 0 && Number.isFinite(this.hz) ? 1000 / this.hz : 0;
  }

  due(now: number): boolean {
    return now - this.last >= this.intervalMs * 0.75;
  }

  /** Milliseconds until an update would be due. */
  wait(now: number): number {
    return Math.max(0, this.last + this.intervalMs * 0.75 - now);
  }

  mark(now: number): void {
    this.last = now;
  }
}
