/**
 * REPLAY ENGINE
 *
 * Loads a ReplayFile, re-executes the deterministic engine from its seed, and
 * exposes the resulting per-tick state stream for scrubbing, stepping and
 * playback. Verification is built in: after re-execution the player compares
 * the fingerprint of the state stream it just produced with the one stored in
 * the replay file. `verified === false` means the replay did not reproduce and
 * the UI says so rather than quietly showing a different bout.
 */

import { BoutSimulation } from '../engine/engine';
import { DEFAULT_PARAMS } from '../engine/params';
import type { ReplayFile } from '../engine/recorder';
import type { BoutEvent, TickSnapshot } from '../engine/types';

export interface LoadedReplay {
  file: ReplayFile;
  frames: TickSnapshot[];
  events: BoutEvent[];
  /** Index into `frames` for each event, for timeline click-to-seek. */
  eventFrameIndex: number[];
  digest: string;
  verified: boolean;
  fighterLabels: string[];
  durationSeconds: number;
}

export function loadReplay(file: ReplayFile): LoadedReplay {
  const params = file.paramOverrides ? { ...DEFAULT_PARAMS, ...file.paramOverrides } : DEFAULT_PARAMS;
  const sim = new BoutSimulation({
    seed: file.seed,
    opponents: file.opponents,
    params,
    profileA: file.profiles.a,
    profileB: file.profiles.b,
  });
  const frames = sim.runRecorded();
  const digest = sim.digest.value;
  const events = sim.events;
  const eventFrameIndex = events.map((e) => Math.min(frames.length - 1, Math.max(0, e.tick)));
  return {
    file,
    frames,
    events,
    eventFrameIndex,
    digest,
    verified: digest === file.digest,
    fighterLabels: sim.fighters.map((f) => f.label),
    durationSeconds: frames.length ? frames[frames.length - 1].t : 0,
  };
}

/** Playback transport over a LoadedReplay. Frame-accurate, no wall-clock drift. */
export class ReplayPlayer {
  replay: LoadedReplay;
  frame = 0;
  playing = false;
  speed = 1;
  private carry = 0;

  constructor(replay: LoadedReplay) {
    this.replay = replay;
  }

  get frames(): TickSnapshot[] { return this.replay.frames; }
  get current(): TickSnapshot { return this.replay.frames[this.frame]; }
  get total(): number { return this.replay.frames.length; }
  get atEnd(): boolean { return this.frame >= this.total - 1; }

  play(): void { if (this.atEnd) this.frame = 0; this.playing = true; }
  pause(): void { this.playing = false; }
  toggle(): void { this.playing ? this.pause() : this.play(); }
  restart(): void { this.frame = 0; this.carry = 0; this.playing = true; }
  seek(frame: number): void {
    this.frame = Math.max(0, Math.min(this.total - 1, Math.round(frame)));
    this.carry = 0;
  }
  stepBy(n: number): void { this.pause(); this.seek(this.frame + n); }

  /**
   * Advance by real elapsed seconds. Returns the interpolation alpha between
   * the current frame and the next one so the renderer can move smoothly even
   * at 0.25x speed.
   */
  advance(dtSeconds: number, tickSeconds = 0.1): number {
    if (!this.playing) return 0;
    this.carry += (dtSeconds * this.speed) / tickSeconds;
    const whole = Math.floor(this.carry);
    if (whole > 0) {
      this.carry -= whole;
      this.frame = Math.min(this.total - 1, this.frame + whole);
      if (this.frame >= this.total - 1) this.playing = false;
    }
    return this.carry;
  }

  /** Events that occurred at or before the current frame. */
  eventsUpTo(): BoutEvent[] {
    const out: BoutEvent[] = [];
    for (const e of this.replay.events) {
      if (e.tick <= this.current.tick) out.push(e);
      else break;
    }
    return out;
  }

  /** Index of the most recent event at or before the playhead, or -1. */
  currentEventIndex(): number {
    let idx = -1;
    for (let i = 0; i < this.replay.events.length; i++) {
      if (this.replay.events[i].tick <= this.current.tick) idx = i;
      else break;
    }
    return idx;
  }
}
