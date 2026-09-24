/**
 * WATCH / REPLAY POLISH SUITE (docs/design/WATCH_REPLAY_PASS.md).
 *
 * What this suite is written to catch:
 *
 *  1. a saved replay that does not re-simulate to the same bout — digest,
 *     events and every recorded frame — in either archive profile, and a
 *     loader that accepts a claim it cannot reproduce;
 *  2. a transport, a replay or a panel that writes to the bout: every
 *     transport operation at every speed runs over a deep-frozen event log,
 *     and the frames' content hash and the re-simulated digest must not move;
 *  3. a corrupted, truncated or foreign file that crashes the loader or is
 *     silently accepted — each must come back as a typed error;
 *  4. statistics and scorecards that show the future: the numbers at tick t
 *     must equal those of a simulation stopped at t;
 *  5. frame stepping that lands a frame out, and playback whose frame at a
 *     given time depends on the display's refresh rate;
 *  6. the presenter robustness fixes (device loss, the quality/bout race,
 *     one character factory per presenter) and the camera override API.
 */
import { describe, expect, it, vi } from 'vitest';

// Several tests re-simulate whole bouts (seconds each on a loaded machine).
vi.setConfig({ testTimeout: 60_000 });
import { Group, Scene } from 'three';
import {
  ARCHETYPES, DEFAULT_SETTINGS, SIM_ENGINE_VERSION, computeStats, createSim, deriveRuntime, resolveParams,
  simulate, toReplayFile, type SimConfig, type SimEvent, type TickSnapshot,
} from '../src/sim';
import { BoutPlayer, SPEED_STEPS, stepSpeed, TICK_SECONDS } from '../src/app/replay/player';
import { loadWatchBout } from '../src/app/replay/bout';
import { EventIndex, advanceBroadcast, lastSecondsReplayPlan, manualReplayPlan } from '../src/app/replay/broadcast';
import {
  commentaryUpTo, debugRows, gamePlanRows, hudModel, intentsAt, roundBaselines, statRows,
} from '../src/app/replay/viewModel';
import { StatsTimeline, eventsThrough, scorecardAt } from '../src/app/replay/statsAt';
import { adjacentMarker, timelineMarkers } from '../src/app/replay/markers';
import { PlayheadSignal, Throttle } from '../src/app/replay/playhead';
import { shortcutFor, SHORTCUT_HELP } from '../src/app/replay/shortcuts';
import {
  ARCHIVE_MAGIC, crc32, decodeArchive, decodeArray, encodeArchive, encodeArray, gzip,
} from '../src/app/replay/archive';
import { memoryLibrary, enforceLimit, metaFor, replayId } from '../src/app/replay/library';
import {
  MAX_CACHED, claimMismatch, encodeForLibrary, encodePortable, openReplay, replayFileFor, saveToLibrary,
} from '../src/app/replay/saved';
import { runWatchJob, watchBoutFromWire, type WatchWire } from '../src/app/workers/simProtocol';
import { planReplays, ReplaySequencer, createCameraDirector } from '../src/presentation/camera';
import { createPresenter, type PresenterDeps, type StageLike } from '../src/presentation/presenter';
import { buildBoutPresentation } from '../src/presentation/stage/bout';
import { qualitySettings } from '../src/presentation/stage/index';
import type {
  Animator, ArenaSet, BoutPresentation, CameraDirector, CameraState, CharacterActor, CharacterFactory, FrameInput,
} from '../src/presentation/contract';
import { defaultRest, type Pose } from '../src/presentation/rig/skeleton';
import { createAnimator } from '../src/presentation/anim';

const ARCH = Object.values(ARCHETYPES);

function config(seed: string, a = 0, b = 1): SimConfig {
  return {
    seed, mode: '1v1', fighters: [ARCH[a], ARCH[b]], teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: DEFAULT_SETTINGS,
  };
}

/** A bout long enough to cross a round break; searched, not hard-coded (the sim is being tuned). */
function findLongConfig(): SimConfig {
  let best = config('polish-0');
  let bestTicks = simulate(best).ticks;
  for (let i = 1; i < 16 && bestTicks < 3500; i++) {
    const c = config(`polish-${i}`, i % ARCH.length, (i + 1) % ARCH.length);
    const t = simulate(c).ticks;
    if (t > bestTicks) {
      best = c;
      bestTicks = t;
    }
  }
  return best;
}

const CFG = findLongConfig();
const BOUT = loadWatchBout(CFG);
const RUN = BOUT.run;
const FRAMES = RUN.frames;

/** FNV-1a over a string. */
function fnv(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Content hash of every recorded frame (NaN-safe, order-sensitive). */
function framesHash(frames: readonly TickSnapshot[]): string {
  let h = 0x811c9dc5;
  const rep = (_k: string, v: unknown): unknown => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v);
  for (let i = 0; i < frames.length; i++) h = fnv(JSON.stringify(frames[i], rep), h);
  return `${frames.length}:${h.toString(16)}`;
}

function eventsHash(events: readonly SimEvent[]): string {
  return fnv(JSON.stringify(events)).toString(16);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

const FRAMES_HASH = framesHash(FRAMES);

// ---------------------------------------------------------------------------
// 1. Save / load / re-simulate
// ---------------------------------------------------------------------------

describe('replay archive: exact reconstruction', () => {
  it('has a bout worth saving (crosses a round break, thousands of frames)', () => {
    expect(RUN.ticks).toBeGreaterThan(1500);
    expect(RUN.events.some((e) => e.kind === 'roundEnd')).toBe(true);
  });

  it('round-trips every typed-array kind bit for bit through the lossless column transforms', () => {
    const f32 = new Float32Array([0, -0, 1.5, NaN, Infinity, -Infinity, 3.4e38, 1e-40, 0.1, 0.1000001]);
    const f64 = new Float64Array([0, -0, Math.PI, NaN, -1e308, 5e-324, 2 ** 53, -7.25]);
    const cases = [
      f32, f64, new Uint8Array([0, 255, 3, 3, 250]), new Uint16Array([65535, 0, 1, 40000]),
      new Uint32Array([0xffffffff, 0, 7, 0x80000000]), new Int8Array([-128, 127, 0, -1]),
      new Int16Array([-32768, 32767, 5, -5]), new Int32Array([-(2 ** 31), 2 ** 31 - 1, 0, -9]),
    ];
    for (const a of cases) {
      const name = a.constructor.name.replace('Array', '').replace('Float', 'f').replace('Uint', 'u').replace('Int', 'i') as never;
      const back = decodeArray(encodeArray(a), name, a.length);
      expect(new Uint8Array(back.buffer)).toEqual(new Uint8Array(a.buffer));
    }
  });

  it('portable profile: seed + setup only, re-simulates to the same digest, events and frames', async () => {
    const bytes = await encodePortable(replayFileFor(BOUT));
    expect(bytes.length).toBeLessThan(64 * 1024);
    const res = await openReplay(bytes);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.opened.verification).toBe('verified');
    const b = res.opened.bout;
    expect(b.run.digest).toBe(RUN.digest);
    expect(b.run.ticks).toBe(RUN.ticks);
    expect(b.run.rngDraws).toBe(RUN.rngDraws);
    expect(eventsHash(b.run.events)).toBe(eventsHash(RUN.events));
    expect(framesHash(b.run.frames)).toBe(FRAMES_HASH);
    expect(b.commentary).toEqual(BOUT.commentary);
  });

  it('library profile: opens from the stored frames without re-simulating, identical to the original', async () => {
    const bytes = await encodeForLibrary(BOUT);
    const resim = vi.fn(() => { throw new Error('must not re-simulate'); });
    const res = await openReplay(bytes, resim);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(resim).not.toHaveBeenCalled();
    expect(res.opened.verification).toBe('cached');
    const b = res.opened.bout;
    expect(framesHash(b.run.frames)).toBe(FRAMES_HASH);
    expect(eventsHash(b.run.events)).toBe(eventsHash(RUN.events));
    expect(b.intents).toEqual(BOUT.intents);
    expect(b.run.stats).toEqual(RUN.stats);
    expect(b.commentary).toEqual(BOUT.commentary);
    // And the stored claim still re-simulates to the same bout.
    expect(claimMismatch(res.opened.file, loadWatchBout(CFG), true)).toBeNull();
  });

  it('compresses: portable is tiny, library is far smaller than the JSON of its frames', async () => {
    const file = replayFileFor(BOUT);
    const json = new TextEncoder().encode(JSON.stringify(file)).length;
    const portable = (await encodePortable(file)).length;
    const library = (await encodeForLibrary(BOUT)).length;
    let framesJson = 0;
    for (let i = 0; i < FRAMES.length; i += 1) framesJson += JSON.stringify(FRAMES[i]).length;
    expect(portable).toBeLessThan(json / 10);
    expect(library).toBeLessThan(framesJson / 20);
  });

  it('reads the previous format: a bare v4 replay JSON (what History exports) verifies', async () => {
    const legacy = new TextEncoder().encode(JSON.stringify(toReplayFile(RUN)));
    const res = await openReplay(legacy);
    expect(res.ok && res.opened.verification).toBe('verified');
  });

  it('flags a file whose claim does not re-simulate (digest tampered) and one from another engine', async () => {
    const tampered = { ...replayFileFor(BOUT), digest: 'deadbeef'.repeat(4) };
    const r1 = await openReplay(await encodePortable(tampered));
    expect(r1.ok && r1.opened.verification).toBe('mismatch');
    expect(r1.ok && r1.opened.bout.run.digest).toBe(RUN.digest);

    const other = { ...replayFileFor(BOUT), engineVersion: '0.0.1-old' };
    const r2 = await openReplay(await encodePortable(other));
    expect(r2.ok && r2.opened.verification).toBe('other-engine');
    const r3 = await openReplay(await encodeArchive({ replay: other, frames: FRAMES, intents: BOUT.intents }));
    expect(r3.ok && r3.opened.verification).toBe('other-engine');
    expect(r3.ok && framesHash(r3.opened.bout.run.frames)).toBe(FRAMES_HASH);
    expect(SIM_ENGINE_VERSION).not.toBe('0.0.1-old');
  });

  it('the worker path builds the identical Watch bout across a structured clone', () => {
    const got: WatchWire[] = [];
    runWatchJob({ type: 'watch', id: 'w1', config: CFG, progressEveryTicks: 500 }, (m, transfer) => {
      got.push(structuredClone(m, { transfer: transfer ?? [] }));
    });
    const done = got.find((m) => m.type === 'watchDone');
    expect(done).toBeDefined();
    expect(got.filter((m) => m.type === 'progress').length).toBeGreaterThan(1);
    if (done?.type !== 'watchDone') return;
    const b = watchBoutFromWire(done, CFG);
    expect(b.run.digest).toBe(RUN.digest);
    expect(framesHash(b.run.frames)).toBe(FRAMES_HASH);
    expect(b.intents).toEqual(BOUT.intents);
    expect(b.commentary).toEqual(BOUT.commentary);
  });

  it('never mutates the bout it saves', async () => {
    const before = eventsHash(RUN.events);
    await encodeForLibrary(BOUT);
    await encodePortable(replayFileFor(BOUT));
    expect(eventsHash(RUN.events)).toBe(before);
    expect(framesHash(FRAMES)).toBe(FRAMES_HASH);
  });
});

// ---------------------------------------------------------------------------
// 3. Corrupted and partial files
// ---------------------------------------------------------------------------

describe('replay archive: corrupted and partial files', () => {
  const good = encodePortable(replayFileFor(BOUT));

  async function codeOf(bytes: Uint8Array): Promise<string> {
    const r = await decodeArchive(bytes);
    return r.ok ? 'ok' : r.error.code;
  }

  it('reports each kind of damage as a typed error, never a throw', async () => {
    const g = await good;
    expect(await codeOf(g)).toBe('ok');
    expect(await codeOf(new Uint8Array(0))).toBe('empty');
    expect(await codeOf(new Uint8Array([1, 2, 3, 250, 251, 252, 253]))).toBe('not-a-replay');
    expect(await codeOf(new TextEncoder().encode('hello, not a replay'))).toBe('not-a-replay');
    expect(await codeOf(new TextEncoder().encode('{"format": 4, "seed": "x"'))).toBe('parse');
    expect(await codeOf(new TextEncoder().encode('{"a": 1}'))).toBe('not-a-replay');
    expect(await codeOf(new TextEncoder().encode(JSON.stringify({ ...toReplayFile(RUN), format: 3 })))).toBe('unsupported-version');
    const noSeed = { ...toReplayFile(RUN) } as Record<string, unknown>;
    delete noSeed.seed;
    expect(await codeOf(new TextEncoder().encode(JSON.stringify(noSeed)))).toBe('invalid');
    expect(await codeOf(g.slice(0, 10))).toBe('truncated');
    expect(await codeOf(g.slice(0, g.length - 7))).toBe('truncated');

    const flipped = g.slice();
    flipped[Math.floor(flipped.length / 2)] ^= 0x5a;
    expect(await codeOf(flipped)).toBe('checksum');

    const future = g.slice();
    future[4] = 9;
    expect(await codeOf(future)).toBe('unsupported-version');

    // Damage behind a recomputed checksum is caught by the decompressor.
    const bad = g.slice();
    bad[16 + 12] ^= 0xff;
    new DataView(bad.buffer).setUint32(12, crc32(bad.subarray(16)), true);
    expect(['decompress', 'parse', 'invalid']).toContain(await codeOf(bad));
  });

  it('rejects a well-formed archive whose payload is not a valid replay', async () => {
    const body = new TextEncoder().encode(JSON.stringify({ kind: 'bout-lab.replay', version: 1, profile: 'portable', hasEvents: false, replay: { format: 4 } }));
    const framed = new Uint8Array(4 + body.length);
    new DataView(framed.buffer).setUint32(0, body.length, true);
    framed.set(body, 4);
    const stored = await gzip(framed);
    const out = new Uint8Array(16 + stored.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, ARCHIVE_MAGIC, true);
    dv.setUint8(4, 1);
    dv.setUint8(5, 1);
    dv.setUint32(8, stored.length, true);
    dv.setUint32(12, crc32(stored), true);
    out.set(stored, 16);
    const r = await decodeArchive(out);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('invalid');
      expect(r.error.message).toMatch(/engine version|seed|incomplete/);
    }
  });

  it('openReplay surfaces decode errors without touching the simulator', async () => {
    const sim = vi.fn();
    const r = await openReplay(new Uint8Array([0x42, 0x4c, 0x52, 0x50, 1, 1, 0, 0]), sim as never);
    expect(r.ok).toBe(false);
    expect(sim).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Library (many stored simulations)
// ---------------------------------------------------------------------------

describe('replay library', () => {
  it('lists metadata only, dedupes by digest, keeps the frame cache for the newest entries', async () => {
    const lib = memoryLibrary();
    const m = await saveToLibrary(lib, BOUT, '2026-01-01T00:00:00.000Z');
    expect(m.profile).toBe('library');
    await saveToLibrary(lib, BOUT, '2026-01-02T00:00:00.000Z');
    let list = await lib.list();
    expect(list).toHaveLength(1);
    expect(list[0].savedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(Object.values(list[0]).some((v) => v instanceof Uint8Array)).toBe(false); // metadata, not the archive

    // Fill with cheap portable entries, newer than the first.
    const file = replayFileFor(BOUT);
    for (let i = 0; i < MAX_CACHED + 3; i++) {
      const f = { ...file, digest: `${i.toString(16).padStart(4, '0')}${file.digest.slice(4)}`, seed: `${file.seed}-${i}` };
      const bytes = await encodeArchive({ replay: f, frames: FRAMES, intents: BOUT.intents });
      await lib.put(metaFor(f, bytes.length, 'library', `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`), bytes);
    }
    await saveToLibrary(lib, BOUT, '2026-03-01T00:00:00.000Z');
    list = await lib.list();
    const cached = list.filter((x) => x.profile === 'library');
    expect(cached.length).toBeLessThanOrEqual(MAX_CACHED);
    expect(list[0].id).toBe(replayId(file));
    // A demoted entry still opens (it re-simulates).
    const demoted = list.find((x) => x.profile === 'portable')!;
    const bytes = await lib.get(demoted.id);
    const dec = await decodeArchive(bytes!);
    expect(dec.ok && dec.archive.cache).toBeNull();
    expect(await enforceLimit(lib, 5)).toHaveLength(list.length - 5);
    expect(await lib.list()).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// 2. Speed and scrubbing never mutate the bout
// ---------------------------------------------------------------------------

describe('transport and panels leave the bout untouched', () => {
  it('every speed, seek, step, loop and replay runs over a frozen event log without changing anything', () => {
    const frozen = deepFreeze(structuredClone(RUN.events) as SimEvent[]);
    const evHash = eventsHash(frozen);
    const p = new BoutPlayer({ frames: FRAMES, events: frozen });
    const seq = new ReplaySequencer(planReplays(frozen, FRAMES));
    const idx = new EventIndex(frozen);
    const stats = new StatsTimeline(frozen, CFG, { stats: RUN.stats, ticks: RUN.ticks });
    const markers = timelineMarkers(frozen, (t) => p.indexForTick(t), p.total);
    const baselines = roundBaselines(FRAMES, frozen);
    const touch = (): void => {
      const f = p.current;
      if (!f) return;
      idx.forFrame(f, p.next);
      hudModel(f, BOUT.fighters, BOUT.runtimes, RUN.stats, [0, 1], 3, baselines);
      debugRows(f, intentsAt(BOUT.intents, f.tick), BOUT.fighters);
      gamePlanRows(intentsAt(BOUT.intents, f.tick), BOUT.fighters, [0, 1]);
      commentaryUpTo(BOUT.commentary, f.tick);
      statRows(stats.at(f.tick).total);
      scorecardAt(frozen, RUN.result.judgeTotals, false, f.tick, p.atEnd);
    };
    for (const speed of [...SPEED_STEPS, 8]) {
      p.setSpeed(speed);
      p.seekFrame(Math.floor(p.total / 3));
      p.play();
      for (let i = 0; i < 90; i++) {
        advanceBroadcast(p, seq, 1 / 60);
        if (i % 9 === 0) touch();
      }
    }
    for (let f = 0; f < p.total; f += Math.max(1, Math.floor(p.total / 97))) {
      p.seekFrame(f);
      seq.reset(p.tick);
      touch();
    }
    p.stepBy(1);
    p.stepBy(-10);
    p.stepEvent(1);
    p.stepEvent(-1);
    p.setLoop({ fromTick: 100, toTick: 160 });
    p.play();
    for (let i = 0; i < 300; i++) advanceBroadcast(p, seq, 1 / 30);
    p.setLoop(null);
    for (const m of markers.slice(0, 10)) {
      p.seekTick(m.tick);
      const req = { fromTick: Math.max(0, m.tick - 40), toTick: m.tick + 20, speed: 0.3, label: m.label, eventIndex: m.eventIndex };
      seq.play(seq.plans.find((pl) => pl.eventIndex === m.eventIndex) ?? manualReplayPlan(req, frozen), p);
      for (let i = 0; i < 400 && seq.state; i++) advanceBroadcast(p, seq, 1 / 60);
    }
    p.restart();
    expect(eventsHash(frozen)).toBe(evHash);
    expect(eventsHash(frozen)).toBe(eventsHash(RUN.events));
    expect(framesHash(FRAMES)).toBe(FRAMES_HASH);
    // The recorded frames are a read-only view.
    expect(() => { (FRAMES as TickSnapshot[])[0] = FRAMES[1]; }).toThrow();
    // And the bout still re-simulates to the digest it was recorded with.
    expect(simulate(CFG).digest).toBe(RUN.digest);
  });
});

// ---------------------------------------------------------------------------
// 4. Statistics and scorecards at the playhead
// ---------------------------------------------------------------------------

describe('statistics at the playhead', () => {
  const timeline = new StatsTimeline(RUN.events, CFG, { stats: RUN.stats, ticks: RUN.ticks });

  it('equal the statistics of the same bout simulated only up to that tick', () => {
    const probes = [1, 150, Math.floor(RUN.ticks / 3), Math.floor(RUN.ticks / 2), RUN.ticks - 5];
    const sim = createSim(CFG);
    let at = 0;
    for (const t of probes) {
      while (sim.tick < t && sim.step()) at = sim.tick;
      const truth = computeStats([...sim.events], CFG, sim.tick);
      expect(timeline.at(sim.tick)).toEqual(truth);
    }
    expect(at).toBeGreaterThan(0);
  });

  it('is the finished bout at the last tick and never decreases on the way', () => {
    expect(timeline.at(RUN.ticks)).toBe(RUN.stats);
    let last = -1;
    let lastTd = -1;
    for (let t = 0; t <= RUN.ticks; t += 97) {
      const s = timeline.at(t).total.fighters;
      const landed = s.reduce((n, f) => n + f.sig.landed, 0);
      const tds = s.reduce((n, f) => n + f.takedowns.landed, 0);
      expect(landed).toBeGreaterThanOrEqual(last);
      expect(tds).toBeGreaterThanOrEqual(lastTd);
      last = landed;
      lastTd = tds;
    }
    const early = timeline.at(20).total.fighters.reduce((n, f) => n + f.sig.landed, 0);
    const final = RUN.stats.total.fighters.reduce((n, f) => n + f.sig.landed, 0);
    expect(early).toBeLessThan(final);
  });

  it('scorecards show only the rounds scored so far', () => {
    const scored = RUN.events.filter((e) => e.kind === 'scorecardRound');
    expect(scored.length).toBeGreaterThan(0);
    const first = scored[0];
    expect(scorecardAt(RUN.events, RUN.result.judgeTotals, false, first.tick - 1, false).rounds).toHaveLength(0);
    expect(scorecardAt(RUN.events, RUN.result.judgeTotals, false, first.tick, false).rounds).toEqual([first.round]);
    const end = scorecardAt(RUN.events, RUN.result.judgeTotals, false, RUN.ticks, true);
    expect(end.rounds).toHaveLength(scored.length);
  });

  it('counts events through a tick by binary search', () => {
    for (const t of [-1, 0, 5, 777, RUN.ticks, RUN.ticks + 10]) {
      expect(eventsThrough(RUN.events, t)).toBe(RUN.events.filter((e) => e.tick <= t).length);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Frame stepping, speeds and refresh-rate independence
// ---------------------------------------------------------------------------

describe('frame stepping and playback clock', () => {
  it('a step is exactly one recorded frame, pauses, and is reversible', () => {
    const p = new BoutPlayer({ frames: FRAMES, events: RUN.events });
    for (const start of [0, 1, 250, Math.floor(p.total / 2), p.total - 2]) {
      p.seekFrame(start);
      p.play();
      p.stepBy(1);
      expect(p.frame).toBe(start + 1);
      expect(p.playing).toBe(false);
      expect(p.tick).toBe(FRAMES[start + 1].tick);
      p.stepBy(-1);
      expect(p.frame).toBe(start);
    }
    p.seekFrame(0);
    p.stepBy(-1);
    expect(p.frame).toBe(0);
    p.seekFrame(p.total - 1);
    p.stepBy(1);
    expect(p.frame).toBe(p.total - 1);
  });

  it('shows the same frame at a given playback time whatever the display refresh rate', () => {
    for (const speed of SPEED_STEPS) {
      const seconds = speed < 1 ? 7 : 3;
      const expected = Math.floor(seconds * speed / TICK_SECONDS + 1e-9);
      for (const hz of [24, 30, 50, 60, 75, 90, 120, 144, 165, 240]) {
        const p = new BoutPlayer({ frames: FRAMES, events: RUN.events });
        p.setSpeed(speed);
        p.play();
        // Timestamps as a rAF loop sees them (ms), differenced like the Watch loop does.
        let last = 0;
        for (let i = 1; i <= seconds * hz; i++) {
          const now = (i * 1000) / hz;
          p.advance((now - last) / 1000);
          last = now;
        }
        expect(p.frame, `${speed}x at ${hz} Hz`).toBe(expected);
      }
    }
  });

  it('jittery frame intervals land on the same frame as steady ones', () => {
    const steady = new BoutPlayer({ frames: FRAMES, events: RUN.events });
    const jitter = new BoutPlayer({ frames: FRAMES, events: RUN.events });
    steady.play();
    jitter.play();
    let t = 0;
    let lastJ = 0;
    for (let i = 1; i <= 600; i++) {
      steady.advance(1 / 60);
      t = i / 60 + (i % 7 === 0 ? 0.004 : i % 5 === 0 ? -0.003 : 0);
      if (i === 600) t = 10;
      jitter.advance(t - lastJ);
      lastJ = t;
    }
    expect(jitter.frame).toBe(steady.frame);
    expect(steady.frame).toBe(100);
  });

  it('speed steps span 0.1x-4x and J/L walk them', () => {
    expect(SPEED_STEPS[0]).toBe(0.1);
    expect(SPEED_STEPS[SPEED_STEPS.length - 1]).toBe(4);
    expect(stepSpeed(1, 1)).toBe(2);
    expect(stepSpeed(1, -1)).toBe(0.5);
    expect(stepSpeed(4, 1)).toBe(4);
    expect(stepSpeed(0.1, -1)).toBe(0.1);
    expect(stepSpeed(0.3, -1)).toBe(0.25);
    expect(stepSpeed(0.3, 1)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Markers, shortcuts, the playhead signal
// ---------------------------------------------------------------------------

describe('timeline markers and shortcuts', () => {
  const p = new BoutPlayer({ frames: FRAMES, events: RUN.events });
  const markers = timelineMarkers(RUN.events, (t) => p.indexForTick(t), p.total);

  it('marks round ends and the moments that matter, in order, where a click seeks', () => {
    expect(markers.filter((m) => m.kind === 'roundEnd').length).toBe(RUN.events.filter((e) => e.kind === 'roundEnd').length);
    for (let i = 1; i < markers.length; i++) expect(markers[i].tick).toBeGreaterThanOrEqual(markers[i - 1].tick);
    for (const m of markers) {
      expect(m.at).toBeGreaterThanOrEqual(0);
      expect(m.at).toBeLessThanOrEqual(1);
      p.seekTick(m.tick);
      expect(p.tick).toBe(m.tick);
      expect(RUN.events[m.eventIndex].tick).toBe(m.tick);
    }
    const kd = RUN.events.filter((e) => e.kind === 'knockdown').length;
    expect(markers.filter((m) => m.kind === 'knockdown').length).toBe(kd);
    const tds = RUN.events.filter((e) => e.kind === 'takedown' && (e as { detail?: { result?: string } }).detail?.result === 'success').length;
    expect(markers.filter((m) => m.kind === 'takedown').length).toBe(tds);
  });

  it('"replay the last 8 s" frames the moment that mattered in the window, in slow motion', () => {
    const big = RUN.events.find((e) => e.kind === 'knockdown')
      ?? RUN.events.find((e) => e.kind === 'takedown' && (e as { detail?: { result?: string } }).detail?.result === 'success')
      ?? RUN.events.find((e) => e.kind === 'strike' && (e as { detail?: { result?: string } }).detail?.result === 'landed');
    expect(big).toBeDefined();
    const to = big!.tick + 10;
    const from = Math.max(0, to - 80);
    const plan = lastSecondsReplayPlan(from, to, RUN.events, (t) => FRAMES[p.indexForTick(t)]);
    expect(plan.segments.length).toBe(2);
    expect(plan.keyTick).toBeGreaterThanOrEqual(from);
    expect(plan.keyTick).toBeLessThanOrEqual(to);
    for (const sgm of plan.segments) {
      expect(sgm.fromTick).toBeGreaterThanOrEqual(from);
      expect(sgm.toTick).toBeLessThanOrEqual(to);
      expect(sgm.speed).toBeLessThan(0.5);
    }
    // A window with nothing in it is one slow angle of the pair.
    const quiet = lastSecondsReplayPlan(0, 0, RUN.events);
    expect(quiet.segments).toHaveLength(1);
    expect(quiet.segments[0].focus).toBe('pair');
  });

  it('steps to the next and previous marker', () => {
    if (markers.length < 2) return;
    const mid = markers[Math.floor(markers.length / 2)];
    expect(adjacentMarker(markers, mid.tick, 1)?.tick).toBeGreaterThan(mid.tick);
    expect(adjacentMarker(markers, mid.tick, -1)?.tick).toBeLessThan(mid.tick);
    expect(adjacentMarker(markers, RUN.ticks + 1, 1)).toBeNull();
  });

  it('maps the documented keys', () => {
    const k = (code: string, key = '', shiftKey = false) => shortcutFor({ code, key, shiftKey });
    expect(k('Space')).toEqual({ type: 'togglePlay' });
    expect(k('KeyK')).toEqual({ type: 'togglePlay' });
    expect(k('KeyJ')).toEqual({ type: 'speed', dir: -1 });
    expect(k('KeyL')).toEqual({ type: 'speed', dir: 1 });
    expect(k('ArrowLeft')).toEqual({ type: 'step', frames: -1 });
    expect(k('ArrowRight', '', true)).toEqual({ type: 'step', frames: 10 });
    expect(k('KeyF')).toEqual({ type: 'fullscreen' });
    expect(k('Slash', '?', true)).toEqual({ type: 'help' });
    for (let n = 1; n <= 9; n++) expect(k(`Digit${n}`)).toEqual({ type: 'camera', slot: n });
    expect(shortcutFor({ code: 'KeyF', key: 'f', ctrlKey: true })).toBeNull();
    expect(SHORTCUT_HELP.length).toBeGreaterThan(8);
  });

  it('the playhead signal notifies subscribers and the throttle limits their rate', () => {
    const s = new PlayheadSignal();
    const seen: number[] = [];
    const off = s.subscribe(() => seen.push(s.version));
    s.notify();
    s.notify();
    off();
    s.notify();
    expect(seen).toEqual([1, 2]);
    const th = new Throttle(10);
    expect(th.due(0)).toBe(true);
    th.mark(0);
    expect(th.due(50)).toBe(false);
    expect(th.wait(50)).toBeCloseTo(25);
    expect(th.due(84)).toBe(true); // a tick one display frame early still shares the commit
    expect(new Throttle(Infinity).intervalMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Presenter robustness and the camera override
// ---------------------------------------------------------------------------

function boutFor(cfg: SimConfig): BoutPresentation {
  const params = resolveParams(cfg.paramOverrides);
  return buildBoutPresentation({
    config: cfg, fighters: cfg.fighters,
    runtimes: cfg.fighters.map((f) => deriveRuntime(f, params, { explain: false })),
  });
}

interface FakeStage extends StageLike {
  renderer: { onDeviceLost(info: { api?: string; message?: string }): void };
  renders: number;
}

function fakeStage(): FakeStage {
  const s: FakeStage = {
    backend: 'webgpu',
    scene: new Scene() as unknown as StageLike['scene'],
    quality: qualitySettings('high'),
    setQuality: () => undefined,
    applyShadowPolicy: () => undefined,
    resize: () => undefined,
    setCameraState: (_s: CameraState) => undefined,
    setReplay: () => undefined,
    cut: () => undefined,
    frameTiming: () => undefined,
    render: () => { s.renders++; },
    warmUp: () => undefined,
    info: () => ({ drawCalls: 1, triangles: 2, internalWidth: 3, internalHeight: 4 }),
    dispose: () => undefined,
    renderer: { onDeviceLost: () => undefined },
    renders: 0,
  };
  return s;
}

function fakeDeps(stage: FakeStage, over: Partial<PresenterDeps> = {}): PresenterDeps {
  const actor = (i: number): CharacterActor => ({
    fighterId: i, object3d: new Group(), rest: defaultRest(),
    applyPose: () => undefined, setVisualState: () => undefined, setLOD: () => undefined, dispose: () => undefined,
  });
  const factory: CharacterFactory = { preload: async () => undefined, create: (_b, i) => actor(i) };
  const animator: Animator = {
    setBout: () => undefined,
    evaluate: (_in, _dt, _out: Pose[]) => undefined,
    reset: () => undefined,
    debug: () => ({ layer: 'x', technique: null, phase: 0, ikTargets: [], tierRules: [] }),
  };
  const camera: CameraDirector = {
    setBout: () => undefined, setRequest: () => undefined, reset: () => undefined,
    update: () => ({ position: [0, 3, 8], target: [0, 1, 0], fovDeg: 35, rollRad: 0, focusM: 8, dof: 0, cut: false, shotName: 'WIDE' }),
  };
  const arena: ArenaSet = {
    object3d: new Group(), bounds: { fightRadiusM: 5, outerRadiusM: 10, ceilingM: 8 }, environment: null,
    update: () => undefined, setQuality: () => undefined, dispose: () => { arena.object3d.removeFromParent(); },
  };
  return {
    createStage: async () => stage,
    createArenaSet: async () => arena,
    createCharacterFactory: () => factory,
    createAnimator: () => animator,
    createCameraDirector: () => camera,
    now: () => 0,
    ...over,
  };
}

const PBOUT = boutFor(config('watch-demo'));
const host = { clientWidth: 1600, clientHeight: 900 } as HTMLElement;

describe('presenter robustness (review M2b, M4, M5)', () => {
  it('a lost GPU device is reported once and nothing renders into it', async () => {
    const stage = fakeStage();
    const p = createPresenter(fakeDeps(stage));
    await p.mount(host);
    await p.setBout(PBOUT);
    const lost = vi.fn();
    p.onDeviceLost(lost);
    p.render();
    expect(stage.renders).toBe(1);
    stage.renderer.onDeviceLost({ api: 'WebGPU', message: 'TDR' });
    stage.renderer.onDeviceLost({ api: 'WebGPU', message: 'again' });
    expect(lost).toHaveBeenCalledTimes(1);
    expect(lost.mock.calls[0][0]).toMatch(/WebGPU device lost: TDR/);
    expect(p.deviceLost).toBe(true);
    p.render();
    expect(stage.renders).toBe(1);
    expect(() => p.dispose()).not.toThrow();
  });

  it('builds the character factory once per presenter, not once per bout', async () => {
    const stage = fakeStage();
    const deps = fakeDeps(stage);
    const make = vi.fn(deps.createCharacterFactory);
    const p = createPresenter({ ...deps, createCharacterFactory: make });
    await p.mount(host);
    await p.setBout(PBOUT);
    await p.setBout(boutFor(config('other-bout', 2, 3)));
    await p.setBout(PBOUT);
    expect(make).toHaveBeenCalledTimes(1);
    p.dispose();
  });

  it('a quality change while a bout is loading leaves no orphan bodies or referee in the scene', async () => {
    const count = async (raceQuality: boolean): Promise<number> => {
      const stage = fakeStage();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => { release = r; });
      const deps = fakeDeps(stage);
      let calls = 0;
      const p = createPresenter({
        ...deps,
        // Only the second bout's arena waits on the gate.
        createArenaSet: async (...a) => { if (++calls > 1) await gate; return deps.createArenaSet(...a); },
      });
      await p.mount(host);
      await p.setBout(PBOUT); // a bout on screen
      const next = p.setBout(boutFor(config('switch', 1, 2)));
      if (raceQuality) p.setQuality('low');
      release();
      await next;
      await new Promise((r) => setTimeout(r, 0));
      const n = stage.scene.children.length;
      p.dispose();
      return n;
    };
    const control = await count(false);
    const raced = await count(true);
    expect(raced).toBe(control);
  });

  it('the camera override pins an operator in broadcast mode and hands back to the director', async () => {
    const stage = fakeStage();
    const director = createCameraDirector();
    const p = createPresenter(fakeDeps(stage, { createCameraDirector: () => director, createAnimator: () => createAnimator() }));
    await p.mount(host);
    p.setRecording(FRAMES, RUN.events);
    await p.setBout(boutFor(CFG));
    const input = (i: number, discontinuity = false): FrameInput => ({
      frame: FRAMES[i], next: FRAMES[i + 1], alpha: 0, simTime: FRAMES[i].t, events: [], playbackRate: 1,
      replay: false, discontinuity,
    });
    p.update(input(300, true), 1 / 60);
    expect(director.debug().source).toBe('plan');
    p.setCameraOverride('overhead');
    p.update(input(301), 1 / 60);
    expect(director.debug().source).toBe('locked');
    expect(director.debug().shot).toBe('overhead');
    expect(p.cameraOverrideKind).toBe('overhead');
    p.setCameraOverride(null);
    p.update(input(302), 1 / 60);
    expect(director.debug().source).toBe('plan');
    p.dispose();
  });
});
