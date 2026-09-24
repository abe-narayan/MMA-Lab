/**
 * BROADCAST TRANSPORT GLUE — what the Watch screen and `Arena3D` share to
 * drive the 3D broadcast from the `BoutPlayer` (integration, Phase 8).
 *
 *  - `EventIndex`: the per-frame event window for `FrameInput.events`, from
 *    two seconds back **through the next frame's tick**, so the animator knows
 *    how a strike resolving in the next 100 ms ends (miss, block) before
 *    impact. Binary search on the recorded, tick-ordered stream; cached per
 *    (frame, next) so a 60 Hz loop over a 10 Hz sim allocates ten times a second.
 *  - `advanceBroadcast`: `player.advance(dt)` then `sequencer.update(player)`
 *    (the camera's instant-replay chain), reporting whether the playhead
 *    *jumped* (a replay started, changed angle or ended; a loop wrapped).
 *  - `SeekDetector`: turns jumps and seeks into exactly one discontinuity
 *    frame for `FrameInput.discontinuity`.
 *  - `manualReplayPlan`: a one-angle `ReplayPlan` for the viewer's own
 *    "replay the last 8 s" / event-chip replays, so every replay goes through
 *    the sequencer and shows the REPLAY bug, slow motion and depth of field.
 *
 * No React, no DOM, no `Math.random()`.
 */
import type { SimEvent, TickSnapshot } from '../../sim';
import type { ReplayPlan, ReplaySequencer, ReplayState } from '../../presentation/camera';
import type { BoutPlayer, InstantReplayRequest } from './player';

/** Ticks of history in the event window (two seconds at 10 Hz). */
export const EVENT_HISTORY_TICKS = 20;
/** A forward jump larger than this many frames is treated as a seek. */
export const MAX_CONTINUOUS_JUMP = 12;

export class EventIndex {
  private key = '';
  private cached: readonly SimEvent[] = [];

  constructor(readonly events: readonly SimEvent[]) {}

  /** First index whose tick is > `tick`. */
  private upper(tick: number): number {
    const ev = this.events;
    let lo = 0;
    let hi = ev.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ev[mid].tick <= tick) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Events with `from < tick <= to` (the sim's `eventWindow` convention). */
  window(from: number, to: number): readonly SimEvent[] {
    const key = `${from}:${to}`;
    if (key === this.key) return this.cached;
    this.key = key;
    this.cached = this.events.slice(this.upper(from), this.upper(to));
    return this.cached;
  }

  /** The `FrameInput.events` for the frame on screen: 2 s back, through `next.tick`. */
  forFrame(frame: TickSnapshot, next: TickSnapshot | null): readonly SimEvent[] {
    const to = Math.max(frame.tick, next?.tick ?? frame.tick);
    return this.window(frame.tick - EVENT_HISTORY_TICKS, to);
  }
}

/** Identity of the replay angle on air ('' when live). */
export function replayKey(s: ReplayState | null | undefined): string {
  return s ? `${s.plan.id}#${s.segmentIndex}` : '';
}

/**
 * One tick of the Watch clock: advance the transport, then let the replay
 * sequencer chain angles or air a due replay. `jumped` is true when the
 * playhead moved other than by plain playback.
 */
export function advanceBroadcast(
  player: BoutPlayer, seq: ReplaySequencer | null, dt: number,
): { alpha: number; jumped: boolean } {
  const before = player.frame;
  const wasReplay = player.inInstantReplay;
  const key = replayKey(seq?.state);
  player.advance(dt);
  seq?.update(player);
  const jumped = player.frame < before
    || player.inInstantReplay !== wasReplay
    || replayKey(seq?.state) !== key;
  return { alpha: player.alpha, jumped };
}

/**
 * Exactly one discontinuity per seek. The host bumps `seekVersion` on every
 * jump it knows about; a backwards or large forward tick step counts too (so
 * a host that forgets still snaps). Both arrive in the same frame, so they
 * make one discontinuity, not two.
 */
export class SeekDetector {
  private lastTick = -1;
  private lastSeek: number | null = null;

  next(tick: number, seekVersion: number): boolean {
    const d = this.lastTick < 0
      || seekVersion !== this.lastSeek
      || tick < this.lastTick
      || tick - this.lastTick > MAX_CONTINUOUS_JUMP;
    this.lastTick = tick;
    this.lastSeek = seekVersion;
    return d;
  }

  reset(): void {
    this.lastTick = -1;
    this.lastSeek = null;
  }
}

/**
 * A single-angle replay plan for a viewer-requested replay (the handheld at
 * cageside, 0.3x or the request's speed, depth of field on the pair).
 */
export function manualReplayPlan(req: InstantReplayRequest, events: readonly SimEvent[], title = 'REPLAY'): ReplayPlan {
  const e = req.eventIndex >= 0 ? events[req.eventIndex] : undefined;
  const striker = e && e.actor >= 0 ? e.actor : 0;
  const target = e && e.target >= 0 ? e.target : (striker === 0 ? 1 : 0);
  const keyTick = e?.tick ?? req.toTick;
  return {
    id: `manual-${req.fromTick}-${req.toTick}-${req.eventIndex}`,
    trigger: 'bigStrike',
    title,
    label: req.label,
    keyTick,
    keyTime: keyTick * 0.1,
    striker,
    target,
    fromTick: req.fromTick,
    toTick: req.toTick,
    airTick: req.toTick,
    airReason: 'lull',
    segments: [{
      shot: 'cageside', fromTick: req.fromTick, toTick: req.toTick, speed: req.speed,
      dof: 0.6, focus: 'pair', pushIn: 0.12,
    }],
    eventIndex: req.eventIndex,
  };
}
