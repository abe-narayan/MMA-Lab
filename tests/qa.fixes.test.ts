/**
 * Fixes for Phase 9 QA findings QA-7, QA-8, QA-12..14 (docs/design/QA_FINDINGS.md).
 *
 *  - QA-7: a drawn tournament match gets a rematch on a derived seed, and a
 *    tie-break after `MAX_NO_DECISION_RUNS` level runs, so a bracket always
 *    finishes and stays reproducible.
 *  - QA-8: recorded frames live in compact columns (sim/record/frames.ts);
 *    the view behaves like the old `TickSnapshot[]`, round-trips across a
 *    thread boundary, and fits the 09 §4.5 memory budget.
 *  - QA-12..14: validator bounds (the pinned cases live in qa.edgecases).
 */
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, DEFAULT_SETTINGS, boutSeed, createSim, simulate,
  type FighterDefinition, type SimConfig, type TickSnapshot,
} from '../src/sim';
import { FrameStore, packFrames, unpackFrames } from '../src/sim/record/frames';
import { validateFighter } from '../src/app/store/validate';
import {
  MAX_NO_DECISION_RUNS, flatMatchIndex, matchSeed, recordNoDecision, resolveMatch, tieBreakWinner,
  type BracketMatch, type TieBreakStats,
} from '../src/app/model/bracket';
import { fromWire, toWire, type FromWorker } from '../src/app/workers/simProtocol';
import { roundBaselines } from '../src/app/replay/viewModel';

const ALL = Object.values(ARCHETYPES) as FighterDefinition[];
const arch = (id: string): FighterDefinition => {
  const f = ALL.find((a) => a.id === id);
  if (!f) throw new Error(`no archetype ${id}`);
  return f;
};
const withId = (f: FighterDefinition, id: string): FighterDefinition => {
  const c = JSON.parse(JSON.stringify(f)) as FighterDefinition;
  c.id = id;
  c.name = `${f.name} ${id}`;
  c.short = id.slice(0, 3).toUpperCase();
  return c;
};
const RPA = arch('arch.regional_pro_allrounder');

function oneVsFive(seed: string): SimConfig {
  const fighters = [withId(arch('arch.champion_complete'), 'hero'), ...[0, 1, 2, 3, 4].map((i) => withId(RPA, `g${i}`))];
  return {
    seed, mode: 'teams', fighters, teams: { teamOf: [0, 1, 1, 1, 1, 1] },
    ruleset: 'mma.unified.5r', arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS },
  };
}
function oneVsOne(seed: string): SimConfig {
  return {
    seed, mode: '1v1', fighters: [withId(RPA, 'a'), withId(RPA, 'b')], teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS },
  };
}

// ---------------------------------------------------------------------------
// QA-7
// ---------------------------------------------------------------------------

describe('QA-7: a drawn tournament match can be resolved', () => {
  const m = (attempts?: number): BracketMatch => ({
    a: 'f1', b: 'f2', winner: null, historyId: null, ...(attempts === undefined ? {} : { attempts }),
  });
  const zero: TieBreakStats = { knockdowns: 0, sig: { landed: 10 }, takedowns: { landed: 1 }, subAttempts: 0, controlSeconds: 30 };

  it('keeps the original seed for the first run and salts every rematch deterministically', () => {
    const base = boutSeed('tour.x', 'tournament', 3);
    expect(matchSeed(base, undefined)).toBe(base);
    expect(matchSeed(base, 0)).toBe(base);
    const seeds = [1, 2, 3].map((k) => matchSeed(base, k));
    expect(new Set([base, ...seeds]).size).toBe(4);
    expect(matchSeed(base, 2)).toBe(seeds[1]);
    expect(flatMatchIndex([[1, 2, 3, 4], [5, 6], [7]], 1, 1)).toBe(5);
  });

  it('a rematch seed gives a different bout, the same one every time', () => {
    const base = boutSeed('tour.qa7', 'tournament', 0);
    const run = (k: number) => simulate(oneVsOne(matchSeed(base, k)), { maxTicks: 300 }).digest;
    expect(run(1)).toBe(run(1));
    expect(run(1)).not.toBe(run(0));
  });

  it('asks for rematches, then settles the last level run on the tie-break', () => {
    expect(resolveMatch(m(), ['f1', 'f2'], 0, undefined)).toEqual({ kind: 'advance', winnerId: 'f1', tieBreak: false });
    expect(resolveMatch(m(), ['f1', 'f2'], 1, undefined)).toEqual({ kind: 'advance', winnerId: 'f2', tieBreak: false });

    let match = m();
    const bracket = [[match]];
    let b: BracketMatch[][] = bracket;
    for (let k = 1; k < MAX_NO_DECISION_RUNS; k++) {
      expect(resolveMatch(match, ['f1', 'f2'], 'draw', undefined)).toEqual({ kind: 'rematch', nextAttempt: k });
      b = recordNoDecision(b, 0, 0);
      match = b[0][0];
      expect(match.attempts).toBe(k);
    }
    expect(bracket[0][0].attempts).toBeUndefined(); // recordNoDecision does not mutate
    const moreSig = { ...zero, sig: { landed: 11 } };
    expect(resolveMatch(match, ['f1', 'f2'], 'draw', [zero, moreSig]))
      .toEqual({ kind: 'advance', winnerId: 'f2', tieBreak: true });
    expect(resolveMatch(match, ['f1', 'f2'], 'none', [zero, zero]))
      .toEqual({ kind: 'advance', winnerId: 'f1', tieBreak: true });
    // Nothing to separate them: the higher seed (earlier in entrantIds) goes through.
    expect(resolveMatch(match, ['f2', 'f1'], 'draw', [zero, zero]).kind).toBe('advance');
    expect((resolveMatch(match, ['f2', 'f1'], 'draw', [zero, zero]) as { winnerId: string }).winnerId).toBe('f2');
  });

  it('orders the tie-break criteria: knockdowns, sig, takedowns, sub attempts, control, seed', () => {
    expect(tieBreakWinner({ ...zero, knockdowns: 1 }, { ...zero, sig: { landed: 99 } }, false)).toBe('a');
    expect(tieBreakWinner(zero, { ...zero, sig: { landed: 11 } }, true)).toBe('b');
    expect(tieBreakWinner({ ...zero, takedowns: { landed: 2 } }, zero, false)).toBe('a');
    expect(tieBreakWinner(zero, { ...zero, subAttempts: 1 }, true)).toBe('b');
    expect(tieBreakWinner({ ...zero, controlSeconds: 31 }, zero, false)).toBe('a');
    expect(tieBreakWinner(zero, zero, true)).toBe('a');
    expect(tieBreakWinner(zero, zero, false)).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// QA-8
// ---------------------------------------------------------------------------

/** Max relative error allowed by the store's quantisation (Float32 / 16-bit fixed point). */
function closeTo(a: unknown, b: unknown, path: string, out: string[]): void {
  if (out.length > 5) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return;
    if (Math.abs(a - b) > 1e-5 * Math.max(1, Math.abs(b))) out.push(`${path}: ${a} vs ${b}`);
    return;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    if (ka.join() !== kb.join()) out.push(`${path}: keys ${ka.join()} vs ${kb.join()}`);
    for (const k of kb) closeTo((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
    return;
  }
  if (a !== b) out.push(`${path}: ${String(a)} vs ${String(b)}`);
}

describe('QA-8: recorded frames are compact columns', () => {
  const config = oneVsFive('qa8-frames');
  const MAX = 600;
  const run = simulate(config, { record: true, maxTicks: MAX });
  const frames = run.frames as TickSnapshot[];

  it('does not change the bout: digest, ticks and draws match an unrecorded run', () => {
    const plain = simulate(config, { maxTicks: MAX });
    expect(run.digest).toBe(plain.digest);
    expect(run.ticks).toBe(plain.ticks);
    expect(run.rngDraws).toBe(plain.rngDraws);
    // Same push pattern as before: opening frame, one per step, one after the end.
    expect(frames.length).toBeGreaterThanOrEqual(run.ticks + 1);
  });

  it('decodes every frame to the live snapshot within the quantisation', () => {
    const sim = createSim(config, { maxTicks: MAX });
    const live: TickSnapshot[] = [JSON.parse(JSON.stringify(sim.snapshot()))];
    while (sim.tick < MAX && sim.step()) live.push(JSON.parse(JSON.stringify(sim.snapshot())));
    const problems: string[] = [];
    for (let i = 0; i < live.length; i++) closeTo(frames[i], live[i], `[${i}]`, problems);
    expect(problems).toEqual([]);
    // Ticks are exact.
    expect(frames.slice(0, live.length).map((f) => f.tick)).toEqual(live.map((f) => f.tick));
  });

  it('behaves like a read-only TickSnapshot[]', () => {
    expect(Array.isArray(frames)).toBe(true);
    expect(frames[0].tick).toBe(0);
    expect(frames.at(-1)?.tick).toBe(run.ticks);
    expect(frames.slice(10, 13).map((f) => f.tick)).toEqual([10, 11, 12]);
    expect(frames.find((f) => f.tick === 50)?.tick).toBe(50);
    let n = 0;
    for (const f of frames) n += f.fighters.length > 0 ? 1 : 0;
    expect(n).toBe(frames.length);
    expect(frames[5]).toBe(frames[5]); // cached while hot
    expect(frames[frames.length]).toBeUndefined();
    expect(JSON.parse(JSON.stringify(frames))).toHaveLength(frames.length);
    expect(() => { (frames as TickSnapshot[]).push(frames[0]); }).toThrow();
    expect(() => { (frames as TickSnapshot[])[0] = frames[1]; }).toThrow();
    // App consumers read it unchanged.
    const baselines = roundBaselines(frames, run.events);
    expect(baselines.get(1)?.length).toBe(6);
  });

  it('stores values that do not fit the schema verbatim', () => {
    const s = new FrameStore();
    const f = JSON.parse(JSON.stringify(frames[20])) as TickSnapshot & { extra?: unknown };
    f.fighters[0].damage.head = 1.7; // outside the 0-1 contract
    f.fighters[1].sig.landed = 2.5; // a fraction in an integer column
    (f.fighters[2] as unknown as Record<string, unknown>).newField = { a: [1, 2] };
    f.fighters[3].damageVisual.cuts = Array.from({ length: 7 }, (_, i) => ({ site: `s${i}`, severity: 1, bleeding: false, ageS: i }));
    f.extra = 'x';
    s.push(frames[19]);
    s.push(f);
    s.push(frames[21]);
    expect(s.get(1)).toEqual(f);
    expect(JSON.stringify(s.get(0))).toBe(JSON.stringify(frames[19]));
    expect(JSON.stringify(s.get(2))).toBe(JSON.stringify(frames[21]));
  });

  it('crosses a thread boundary as transferable columns', () => {
    const before = JSON.stringify(frames);
    // Pack a copy so the transfer does not detach the store the other tests read.
    const copy = FrameStore.from(JSON.parse(before) as TickSnapshot[]);
    const msg: FromWorker = { type: 'done', id: 'r1', run: { ...run, frames: copy.view() } };
    const wire = toWire(msg);
    expect(wire.transfer.length).toBeGreaterThan(0);
    const cloned = structuredClone(wire.message, { transfer: wire.transfer });
    const back = fromWire(cloned);
    expect(back.type).toBe('done');
    if (back.type !== 'done') return;
    expect(back.run.digest).toBe(run.digest);
    expect(JSON.stringify(back.run.frames)).toBe(before);
    // Plain arrays pack too, and a revived view is interchangeable.
    const { packed } = packFrames(JSON.parse(before) as TickSnapshot[]);
    expect(JSON.stringify(unpackFrames(structuredClone(packed)))).toBe(before);
  });

  it('fits the 09 §4.5 budget: 1v5 x 5 rounds in ≤ 11 MB', () => {
    // A five-round 1v5 that goes the distance is 15,000 fight ticks + 2,400
    // break ticks + the opening frame. Bouts that long are rare and slow, so
    // the stream is built from a real recorded 1v5 bout, replayed with its
    // ticks renumbered until it is that long. Column cost is per row, so the
    // total is what a real bout of that length costs (dictionaries aside,
    // which are a few KB).
    const FULL = 17_401;
    const source = simulate(oneVsFive('qa8-budget'), { record: true, maxTicks: 2_000 }).frames as TickSnapshot[];
    const plain = source.map((f) => JSON.parse(JSON.stringify(f)) as TickSnapshot);
    const gc = (() => {
      try {
        v8.setFlagsFromString('--expose-gc');
        return vm.runInNewContext('gc') as () => void;
      } catch {
        return null;
      }
    })();
    const used = (): number => {
      gc?.();
      gc?.();
      const m = process.memoryUsage();
      return m.heapUsed + m.arrayBuffers;
    };
    const before = used();
    const store = new FrameStore();
    for (let i = 0; i < FULL; i++) {
      const f = plain[i % plain.length];
      const tick = i;
      store.push({ ...f, tick, t: tick / 10 });
    }
    const heap = used() - before;
    const MB = 1024 * 1024;
    expect(store.length).toBe(FULL);
    expect(store.byteSize(), `columns ${(store.byteSize() / MB).toFixed(1)} MB`).toBeLessThan(11 * MB);
    // Measured heap with slack for GC noise; the old plain-object frames
    // measured +163 MB for this shape (QA-8).
    if (gc) expect(heap, `heap +${(heap / MB).toFixed(1)} MB`).toBeLessThan(16 * MB);
    // Per tick, well under the design's ≈1.2 KB for six fighters.
    expect(store.byteSize() / FULL).toBeLessThan(1200);
  });
});

// ---------------------------------------------------------------------------
// QA-12..14
// ---------------------------------------------------------------------------

describe('QA-12..14: validator bounds', () => {
  const errorsAt = (f: FighterDefinition, path: string) =>
    validateFighter(f).issues.filter((i) => i.path === path && i.severity === 'error');

  it('QA-12: keeps sane pacing, refuses out-of-range pacing', () => {
    const f = withId(RPA, 'p');
    f.style.pacing = [{ round: 1, outputMult: 1.1, riskAppetite: -1 }];
    expect(validateFighter(f).ok).toBe(true);
    f.style.pacing = [{ round: 1, outputMult: 3.5, riskAppetite: 0 }];
    expect(errorsAt(f, 'style.pacing[0].outputMult')).toHaveLength(1);
    f.style.pacing = [{ round: 1, outputMult: 1, riskAppetite: 2.5 }];
    expect(errorsAt(f, 'style.pacing[0].riskAppetite')).toHaveLength(1);
  });

  it('QA-13: refuses impossible bodies, only warns about unusual ones', () => {
    const tiny = withId(RPA, 't');
    tiny.body.heightM = 0.99;
    expect(errorsAt(tiny, 'body.heightM')).toHaveLength(1);
    const short = withId(RPA, 's');
    short.body.heightM = 1.3; // unusual, not impossible
    expect(errorsAt(short, 'body.heightM')).toHaveLength(0);
    expect(validateFighter(short).issues.some((i) => i.path === 'body.heightM' && i.severity === 'warning')).toBe(true);
    const light = withId(RPA, 'l');
    light.body.massKg = 29;
    expect(errorsAt(light, 'body.massKg')).toHaveLength(1);
    const young = withId(RPA, 'y');
    young.body.ageYears = 0.01;
    expect(errorsAt(young, 'body.ageYears')).toHaveLength(1);
  });

  it('QA-14: every shipped archetype validates without errors or whole-number warnings', () => {
    for (const a of ALL) {
      const r = validateFighter(a);
      expect(r.ok, a.id).toBe(true);
      expect(r.issues.filter((i) => /whole number/.test(i.message)).map((i) => i.path), a.id).toEqual([]);
    }
    const neg = withId(RPA, 'n');
    neg.record.stanceExposure = { orthodox: -1, southpaw: 2.2 };
    expect(errorsAt(neg, 'record.stanceExposure.orthodox')).toHaveLength(1);
    expect(errorsAt(neg, 'record.stanceExposure.southpaw')).toHaveLength(0);
  });
});
