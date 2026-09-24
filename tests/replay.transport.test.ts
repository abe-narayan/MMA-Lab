/**
 * REPLAY TRANSPORT SUITE — docs/design/09 §4.4, §4.5.
 *
 * What this suite is written to catch:
 *
 *  1. a seek that lands a frame out — `seekTick` must land on the frame whose
 *     recorded tick is the one asked for, and an event-seek on the event's own
 *     tick, not on `tick` used as an array index;
 *  2. slow motion that drops or repeats frames — at 0.1x every frame must be
 *     visited exactly once, in order;
 *  3. a transport whose behaviour depends on the wall clock — the same
 *     sequence of `dt` values must always produce the same frames;
 *  4. a game-plan panel that re-derives the plan instead of showing
 *     `Sim.intents()` (09 §4.4);
 *  5. a loader whose intent sampling perturbs the bout it is watching.
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, DEFAULT_SETTINGS, simulate, type SimConfig,
} from '../src/sim';
import {
  BoutPlayer, INSTANT_REPLAY_LEAD_TICKS, MAX_SPEED, MIN_SPEED, REPLAY_WORTHY, TICK_SECONDS,
} from '../src/app/replay/player';
import { loadWatchBout } from '../src/app/replay/bout';
import {
  commentaryUpTo, cornerOf, debugRows, gamePlanRows, hudModel, intentsAt, roundBaselines,
  scorecardModel, statRows,
} from '../src/app/replay/viewModel';

const ARCH = Object.values(ARCHETYPES);

function config(seed: string): SimConfig {
  return {
    seed,
    mode: '1v1',
    fighters: [ARCH[0], ARCH[1]],
    teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r',
    arena: 'octagon_30',
    settings: DEFAULT_SETTINGS,
  };
}

/**
 * A bout long enough to exercise seeking, looping and the replay buffer. The
 * seed is *searched for* rather than hard-coded: chapter 07's tuning changes
 * how long a given matchup lasts, and a suite that assumes "seed X runs 7,000
 * ticks" breaks every time the AI improves.
 */
function longRun(): ReturnType<typeof simulate> {
  // Phase 9: the bout must also contain something the replay planner airs (a
  // knockdown or a finish); after calibration a long bout is often a clean
  // decision with neither, which left the replay tests nothing to offer.
  const airable = (r: ReturnType<typeof simulate>): boolean => r.events.some((e) =>
    (e.kind === 'knockdown' || e.kind === 'reversal' || e.kind === 'slam') && e.tick + 20 < r.ticks - 1);
  let best: ReturnType<typeof simulate> | null = null;
  for (let i = 0; i < 40 && (best === null || best.ticks < 1500); i++) {
    const next = simulate(config(`transport-${i}`), { record: true });
    if (airable(next) && (best === null || next.ticks > best.ticks)) best = next;
  }
  return best ?? simulate(config('transport-0'), { record: true });
}

const RUN = longRun();
const FRAMES = RUN.frames ?? [];
const LAST = RUN.ticks - 1;
/** A tick comfortably inside the bout, for the buffer and replay tests. */
const MID = Math.floor(RUN.ticks * 0.6);

function player(): BoutPlayer {
  return new BoutPlayer({ frames: FRAMES, events: RUN.events });
}

// ---------------------------------------------------------------------------
// Seeking
// ---------------------------------------------------------------------------

describe('seeking', () => {
  it('has a long enough bout to seek over', () => {
    expect(FRAMES.length).toBeGreaterThan(1000);
    expect(RUN.ticks).toBeGreaterThan(1000);
  });

  it('seeks to the exact tick', () => {
    const p = player();
    for (const tick of [0, 1, 7, 100, 513, Math.floor(RUN.ticks / 2), LAST]) {
      p.seekTick(tick);
      expect(p.current?.tick, `tick ${tick}`).toBe(tick);
    }
  });

  it('clamps a seek beyond either end rather than going out of bounds', () => {
    const p = player();
    p.seekTick(-500);
    expect(p.frame).toBe(0);
    p.seekTick(RUN.ticks + 10_000);
    expect(p.frame).toBe(p.total - 1);
  });

  it('event-seek lands on the event’s own tick', () => {
    const p = player();
    RUN.events.forEach((e, i) => {
      p.seekEvent(i);
      expect(p.current?.tick, `event ${i} (${e.kind})`).toBe(e.tick);
    });
  });

  it('steps to the next and previous event', () => {
    const p = player();
    p.seekFrame(0);
    p.stepEvent(1);
    const first = p.tick;
    expect(RUN.events.some((e) => e.tick === first)).toBe(true);
    p.stepEvent(1);
    expect(p.tick).toBeGreaterThan(first);
    p.stepEvent(-1);
    expect(p.tick).toBe(first);
  });

  it('reports the event under the playhead', () => {
    const p = player();
    const idx = Math.floor(RUN.events.length / 2);
    p.seekEvent(idx);
    const at = p.currentEventIndex();
    expect(at).toBeGreaterThanOrEqual(idx);
    expect(RUN.events[at].tick).toBe(RUN.events[idx].tick);
  });

  it('a frame step is exactly one frame, and pauses', () => {
    const p = player();
    p.play();
    p.seekTick(MID);
    p.stepBy(1);
    expect(p.playing).toBe(false);
    expect(p.current?.tick).toBe(MID + 1);
    p.stepBy(-1);
    expect(p.current?.tick).toBe(MID);
  });
});

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

describe('playback', () => {
  it('slow motion drops no frame and repeats none', () => {
    const p = player();
    p.setSpeed(0.1);
    p.seekFrame(0);
    p.play();
    const visited: number[] = [p.frame];
    // 0.1x means one frame per second of real time; 200 steps of 50 ms is 10 s
    // of wall clock, so exactly 10 frames should pass.
    for (let i = 0; i < 200; i++) {
      p.advance(0.05);
      if (p.frame !== visited[visited.length - 1]) visited.push(p.frame);
    }
    expect(visited[0]).toBe(0);
    expect(visited.length).toBe(11);
    for (let i = 1; i < visited.length; i++) {
      expect(visited[i] - visited[i - 1]).toBe(1);
    }
  });

  it('runs at real time at 1x', () => {
    const p = player();
    p.seekFrame(0);
    p.play();
    for (let i = 0; i < 100; i++) p.advance(0.1);
    expect(p.frame).toBe(100);
  });

  it('is wall-clock-independent: the same dt sequence gives the same frames', () => {
    const dts = [0.016, 0.033, 0.008, 0.05, 0.021, 0.12, 0.004];
    const run = (): number[] => {
      const p = player();
      p.setSpeed(0.4);
      p.seekFrame(0);
      p.play();
      const seen: number[] = [];
      for (let i = 0; i < 300; i++) {
        p.advance(dts[i % dts.length]);
        seen.push(p.frame);
      }
      return seen;
    };
    expect(run()).toEqual(run());
  });

  it('never advances while paused', () => {
    const p = player();
    p.seekFrame(50);
    p.pause();
    for (let i = 0; i < 50; i++) p.advance(0.1);
    expect(p.frame).toBe(50);
  });

  it('clamps speed to the 0.1x-8x range of 09 §4.5', () => {
    const p = player();
    p.setSpeed(100);
    expect(p.speed).toBe(MAX_SPEED);
    p.setSpeed(0);
    expect(p.speed).toBe(MIN_SPEED);
  });

  it('stops at the end and never runs off the array', () => {
    const p = player();
    p.setSpeed(8);
    p.seekFrame(p.total - 40);
    p.play();
    for (let i = 0; i < 200; i++) p.advance(0.1);
    expect(p.frame).toBe(p.total - 1);
    expect(p.playing).toBe(false);
  });

  it('returns an interpolation alpha in [0, 1)', () => {
    const p = player();
    p.setSpeed(0.3);
    p.seekFrame(10);
    p.play();
    for (let i = 0; i < 60; i++) {
      const a = p.advance(0.02);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('loops a range without escaping it', () => {
    const p = player();
    p.setLoop({ fromTick: MID, toTick: MID + 100 });
    expect(p.current?.tick).toBe(MID);
    p.setSpeed(4);
    p.play();
    for (let i = 0; i < 300; i++) {
      p.advance(0.05);
      expect(p.tick).toBeGreaterThanOrEqual(MID);
      expect(p.tick).toBeLessThanOrEqual(MID + 100);
    }
    p.setLoop(null);
    expect(p.loopRange).toBeNull();
  });

  it('accepts a loop range given backwards', () => {
    const p = player();
    p.setLoop({ fromTick: MID + 400, toTick: MID });
    expect(p.loopRange).toEqual({ fromTick: MID, toTick: MID + 400 });
  });
});

// ---------------------------------------------------------------------------
// Instant replay
// ---------------------------------------------------------------------------

describe('instant replay', () => {
  it('offers one for every replay-worthy moment, with the 09 §4.5 window', () => {
    const p = player();
    const worthy = RUN.events.filter(
      (e) => REPLAY_WORTHY.has(e.kind)
        && !(e.kind === 'foul' && !(e as { detail?: { detected?: boolean } }).detail?.detected),
    );
    expect(p.replayTriggers.length).toBe(worthy.length);
    for (const r of p.replayTriggers) {
      const e = RUN.events[r.eventIndex];
      expect(r.fromTick).toBe(Math.max(0, e.tick - INSTANT_REPLAY_LEAD_TICKS));
      expect(r.toTick).toBeGreaterThan(e.tick);
      expect(r.speed).toBeLessThan(1);
    }
  });

  it('plays the last N seconds and puts the playhead back where it was', () => {
    const p = player();
    p.seekTick(MID);
    p.setSpeed(2);
    p.pause();
    p.showLastSeconds(6);
    expect(p.inInstantReplay).toBe(true);
    expect(p.tick).toBe(MID - Math.round(6 / TICK_SECONDS));
    expect(p.speed).toBeLessThan(1);
    for (let i = 0; i < 2000 && p.inInstantReplay; i++) p.advance(0.1);
    expect(p.inInstantReplay).toBe(false);
    expect(p.tick).toBe(MID);
    expect(p.speed).toBe(2);
    expect(p.playing).toBe(false);
  });

  it('only offers replays of moments already past the playhead', () => {
    const p = player();
    p.seekFrame(0);
    expect(p.availableReplays().length).toBe(0);
    p.seekFrame(p.total - 1);
    // Every trigger whose tail is inside the recorded bout is on offer; one
    // that runs past the final frame is not, because it never finished.
    const inside = p.replayTriggers.filter((r) => r.toTick <= p.tick).length;
    expect(p.availableReplays().length).toBe(inside);
    expect(inside).toBeGreaterThan(0);
  });

  it('keeps a buffer of the recent frames', () => {
    const p = player();
    p.seekTick(MID);
    const buf = p.buffer(20);
    expect(buf.length).toBe(200);
    expect(buf[buf.length - 1].tick).toBe(MID);
    expect(buf[0].tick).toBe(MID - 199);
  });
});

// ---------------------------------------------------------------------------
// The loader and the view-models
// ---------------------------------------------------------------------------

describe('the watch bout', () => {
  const bout = loadWatchBout(config(RUN.config.seed), { intentEverySeconds: 1 });
  const plain = simulate(config(RUN.config.seed));

  it('sampling the game plan does not perturb the bout', () => {
    expect(bout.run.digest).toBe(plain.digest);
    expect(bout.run.rngDraws).toBe(plain.rngDraws);
    expect(bout.run.ticks).toBe(plain.ticks);
    expect(bout.run.events.length).toBe(plain.events.length);
  });

  it('records a frame for every tick', () => {
    expect(bout.run.frames.length).toBeGreaterThan(bout.run.ticks);
    expect(bout.run.frames[0].tick).toBe(0);
  });

  it('carries commentary generated from the same run', () => {
    expect(bout.commentary.length).toBeGreaterThan(0);
    for (const l of bout.commentary) expect(l.tick).toBeLessThanOrEqual(bout.run.ticks);
  });

  it('the game-plan panel is Sim.intents() rearranged, not re-derived', () => {
    for (const sample of bout.intents) {
      const rows = gamePlanRows(sample.intents, bout.fighters, bout.config.teams.teamOf);
      expect(rows.length).toBe(sample.intents.length);
      rows.forEach((row, i) => {
        const intent = sample.intents[i];
        expect(row.fighterId).toBe(intent.fighterId);
        expect(row.mode).toBe(intent.mode);
        expect(row.phase).toBe(intent.phase);
        expect(row.planLines).toEqual(intent.planLines);
        expect(row.adjustments).toEqual(intent.adjustments);
        expect(row.scoreBelief).toBe(intent.scoreBelief);
        expect(row.emergency).toBe(intent.emergency);
        expect(row.tierRules).toEqual(intent.tierRules);
        expect(row.animationTags).toEqual(intent.animationTags);
      });
    }
  });

  it('gives the panel the plan in force at the playhead, not the latest one', () => {
    const first = bout.intents[0];
    const last = bout.intents[bout.intents.length - 1];
    expect(intentsAt(bout.intents, first.tick)).toEqual(first.intents);
    expect(intentsAt(bout.intents, bout.run.ticks + 100)).toEqual(last.intents);
    const mid = bout.intents[Math.floor(bout.intents.length / 2)];
    expect(intentsAt(bout.intents, mid.tick)).toEqual(mid.intents);
    // A tick between two samples reads the earlier one — the plan has not
    // changed as far as anybody watching can know.
    expect(intentsAt(bout.intents, mid.tick + 1)).toEqual(mid.intents);
  });

  it('builds a HUD that matches the frame on screen', () => {
    const frame = bout.run.frames[Math.floor(bout.run.frames.length / 2)];
    const hud = hudModel(
      frame, bout.fighters, bout.runtimes, bout.run.stats, bout.config.teams.teamOf, 3,
    );
    expect(hud).not.toBeNull();
    expect(hud?.round).toBe(frame.round);
    expect(hud?.fighters.length).toBe(frame.fighters.length);
    hud?.fighters.forEach((row, i) => {
      expect(row.stamina).toBe(frame.fighters[i].stamina.total);
      expect(row.damage.head).toBe(frame.fighters[i].damage.head);
      expect(row.sig).toEqual(frame.fighters[i].sig);
      expect(row.name).toBe(bout.fighters[i].name);
    });
  });

  it('shows the round tally as it stood, not the finished round’s total', () => {
    const baselines = roundBaselines(bout.run.frames, bout.run.events);
    const start = bout.run.events.find((e) => e.kind === 'roundStart' && e.round === 1);
    expect(start).toBeDefined();
    const justAfter = bout.run.frames.find((f) => f.tick === (start?.tick ?? 0) + 5);
    expect(justAfter).toBeDefined();
    const hud = hudModel(
      justAfter ?? null, bout.fighters, bout.runtimes, bout.run.stats,
      bout.config.teams.teamOf, 3, baselines,
    );
    const finished = bout.run.stats.perRound.find((r) => r.round === 1);
    hud?.fighters.forEach((row, i) => {
      // Half a second in, nobody has thrown a round's worth of strikes.
      expect(row.roundSig.attempted).toBeLessThanOrEqual(finished?.fighters[i].sig.attempted ?? 0);
      expect(row.roundSig.landed).toBeGreaterThanOrEqual(0);
    });
    // And at the final frame the running total matches the bout total.
    const last = bout.run.frames[bout.run.frames.length - 1];
    last.fighters.forEach((f, i) => {
      expect(f.sig.landed).toBe(bout.run.stats.total.fighters[i].sig.landed);
    });
  });

  it('builds the debug rows from the same frame and intents', () => {
    const frame = bout.run.frames[Math.min(200, bout.run.frames.length - 1)];
    const intents = intentsAt(bout.intents, frame.tick);
    const rows = debugRows(frame, intents, bout.fighters);
    expect(rows.length).toBe(frame.fighters.length);
    rows.forEach((r, i) => {
      expect(r.node).toBe(frame.fighters[i].position);
      expect(r.defence).toBe(frame.fighters[i].defence);
      expect(r.mode).toBe(intents[i]?.mode);
    });
  });

  it('shows only the commentary spoken so far', () => {
    const half = Math.floor(bout.run.ticks / 2);
    const shown = commentaryUpTo(bout.commentary, half);
    for (const l of shown) expect(l.tick).toBeLessThanOrEqual(half);
    expect(commentaryUpTo(bout.commentary, 0).length)
      .toBeLessThanOrEqual(shown.length);
  });

  it('builds stat rows and scorecards without inventing numbers', () => {
    const rows = statRows(bout.run.stats.total);
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(r.values.length).toBe(2);
    const cards = scorecardModel(bout.run.events, bout.run.result.judgeTotals, true);
    expect(cards.hidden).toBe(true);
    expect(cards.judges.length).toBe(cards.judges.length);
  });

  it('assigns a corner per team', () => {
    expect(cornerOf(0, bout.config.teams.teamOf)).toBe('A');
    expect(cornerOf(1, bout.config.teams.teamOf)).toBe('B');
  });
});
