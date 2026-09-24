/**
 * SIM GOLDEN — bit-exact regression guard for the simulation core.
 *
 * `tests/fixtures/sim-golden.json` holds, for ~40 bouts that cover every
 * ruleset, the multi-fighter modes, crowd and street, extreme stats and
 * bodies, match settings and non-default timesteps, the digest, tick count,
 * RNG draw count and SHA-1 hashes of the result, the full event log, the
 * stats and every recorded frame (at full float precision). Re-running those
 * bouts must reproduce every one of them exactly: a performance change that
 * moves a single bit of a single number fails here.
 *
 * If this fails and you did NOT mean to change the simulation, the change
 * altered results: find it (`npx tsx scripts/dev/sim-golden.ts --check
 * tests/fixtures/sim-golden.json` prints every differing field).
 *
 * If you DID mean to change the simulation, bump `SIM_ENGINE_VERSION` in
 * `src/sim/record/recorder.ts` and regenerate the fixture intentionally:
 *
 *   npx tsx scripts/dev/sim-golden.ts --write tests/fixtures/sim-golden.json
 *
 * (`--write` re-records the case ids already in the file; see the script.)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RNG, SIM_ENGINE_VERSION } from '../src/sim';
import { ACTION_FAMILIES } from '../src/sim/ai/contracts';
import { STRIKE_FAMILIES } from '../src/sim/ai/families';
import { ExchangeLedger, LEDGER_WINDOW_S } from '../src/sim/ai/perceive';
import { ConsiderationScorer, scoreAction, scoreValue, type ConsiderationInputs, type ScorableAction, type WeightBundle } from '../src/sim/ai/utility';
import { diffRow, goldenCases, runGoldenCase, type GoldenFile } from '../scripts/dev/sim-golden-lib';

const FIXTURE = 'tests/fixtures/sim-golden.json';
const REGEN = 'npx tsx scripts/dev/sim-golden.ts --write tests/fixtures/sim-golden.json';

const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as GoldenFile;
const byId = new Map(goldenCases().map((c) => [c.id, c]));

describe('sim golden corpus', () => {
  it('was recorded under the current engine version', () => {
    expect(
      golden.engineVersion,
      `The fixture was recorded under engine ${golden.engineVersion} but SIM_ENGINE_VERSION is ${SIM_ENGINE_VERSION}. `
      + `If the engine change is intentional, regenerate it: ${REGEN}`,
    ).toBe(SIM_ENGINE_VERSION);
  });

  // Four chunks so a slow machine never trips a single test's timeout.
  const CHUNKS = 4;
  for (let k = 0; k < CHUNKS; k++) {
    const rows = golden.rows.filter((_, i) => i % CHUNKS === k);
    it(`reproduces bouts bit for bit (chunk ${k + 1}/${CHUNKS}, ${rows.length} bouts)`, () => {
      const failures: string[] = [];
      for (const want of rows) {
        const c = byId.get(want.id);
        if (!c) {
          failures.push(`${want.id}: no such case in scripts/dev/sim-golden-lib.ts`);
          continue;
        }
        const diffs = diffRow(want, runGoldenCase(c));
        if (diffs.length) failures.push(`${want.id}:\n    ${diffs.join('\n    ')}`);
      }
      expect(
        failures,
        `Simulation output changed for ${failures.length} golden bout(s). Determinism is part of the engine `
        + `contract: a change that is not meant to alter results must reproduce these exactly. If the change is `
        + `intentional, bump SIM_ENGINE_VERSION and regenerate the fixture: ${REGEN}\n${failures.join('\n')}`,
      ).toEqual([]);
    }, 600_000);
  }
});

describe('scoreValue / ConsiderationScorer', () => {
  it('equal scoreAction(...).score bit for bit', () => {
    const rng = new RNG('score-value-equivalence');
    const pick = <T>(xs: readonly T[]): T => xs[rng.int(xs.length)];
    const edge = (): number => pick([-0.5, 0, 0.2, 0.5, 1, 1.4, 2, rng.next(), rng.next() * 3]);
    for (let i = 0; i < 20000; i++) {
      const a: ScorableAction = {
        family: pick(ACTION_FAMILIES), base: edge(), rangeError: edge(), risk: edge(),
        ownRegionDamage: edge(), positionValue: edge(), isMustNot: rng.next() < 0.3, shield: rng.next() < 0.5 ? 0 : 1,
      };
      const x: ConsiderationInputs = {
        ownFatigue: edge(), oppFatigue: edge(), oppHurt: rng.next() < 0.5 ? 0 : 1,
        ownCageDistM: edge(), oppCageDistM: edge(), roundTimeLeftFrac: edge(), behind: rng.next() < 0.5,
        setupRecent: rng.next() < 0.5 ? 0 : 1, expectedThreat: edge(), oppInRecovery: rng.next() < 0.5 ? 0 : 1,
        balance: edge(), riskAppetite: pick([-3, -2, -1, 0, 1, 2, 3]), paceRatio: edge(),
        dwellExceeded: rng.next() < 0.3, lookahead: edge(), intentRangeM: edge(), distanceM: edge(),
        effectiveIqTier: pick([0, 1, 2, 3, 4, 5]),
      };
      const w: WeightBundle = { style: edge(), pref: edge(), plan: edge(), adapt: edge(), matchup: edge(), multi: edge() };
      const want = scoreAction(a, x, w).score;
      expect(Object.is(scoreValue(a, x, w), want)).toBe(true);
      const scorer = new ConsiderationScorer(x);
      // Twice: the second call reads the family table the first one built.
      expect(Object.is(scorer.score(a, w), want)).toBe(true);
      expect(Object.is(scorer.score(a, w), want)).toBe(true);
    }
  });
});

describe('ExchangeLedger running counts', () => {
  // The ledger answers from running counts and a strike-time index instead of
  // scanning its window (perf). This replays random traffic against a plain
  // re-implementation of the original scans and demands identical answers.
  it('match a full scan of the window', () => {
    const rng = new RNG('ledger-equivalence');
    const kinds = ['attempt', 'landed', 'absorbed', 'absorbedHeavy', 'knockdown', 'tdLanded', 'tdStuffed',
      'takenDown', 'counterEaten', 'cageExchange'] as const;
    const fams = ACTION_FAMILIES.slice(0, 12);
    for (let run = 0; run < 40; run++) {
      const ledger = new ExchangeLedger();
      const mirror: { tS: number; kind: string; family: string | null }[] = [];
      let nowS = 0;
      for (let step = 0; step < 1500; step++) {
        nowS += rng.next() < 0.1 ? 0 : 0.1;
        ledger.advance(nowS);
        while (mirror.length > 0 && mirror[0].tS < nowS - LEDGER_WINDOW_S) mirror.shift();
        const notes = rng.int(3);
        for (let k = 0; k < notes; k++) {
          const kind = kinds[rng.int(rng.next() < 0.7 ? 2 : kinds.length)];
          const family = rng.next() < 0.1 ? null : fams[rng.int(run % 2 ? 3 : fams.length)];
          ledger.note(kind, family);
          mirror.push({ tS: nowS, kind, family });
        }
        const count = (kind: string, family?: string): number =>
          mirror.filter((e) => e.kind === kind && (family === undefined || e.family === family)).length;
        const f = fams[rng.int(fams.length)];
        expect(ledger.attempts(f)).toBe(count('attempt', f));
        expect(ledger.landed()).toBe(count('landed'));
        expect(ledger.cageExchanges).toBe(count('cageExchange'));
        const a = count('attempt', f);
        expect(ledger.hitRate(f, 2)).toBe(a < 2 ? null : count('landed', f) / a);
        // bestFamily, the original way.
        const by = new Map<string, { a: number; l: number }>();
        for (const e of mirror) {
          if (e.family === null || (e.kind !== 'attempt' && e.kind !== 'landed')) continue;
          const row = by.get(e.family) ?? { a: 0, l: 0 };
          if (e.kind === 'attempt') row.a += 1; else row.l += 1;
          by.set(e.family, row);
        }
        let best: string | null = null;
        let bestRate = -1;
        for (const [fam, row] of by) {
          if (row.a < 3) continue;
          if (row.l / row.a > bestRate) { bestRate = row.l / row.a; best = fam; }
        }
        expect(ledger.bestFamily()).toBe(best);
        // paceEstimate, the original way.
        const span = Math.max(0, Math.min(12, (step % 200) / 10));
        let n = 0;
        for (const e of mirror) {
          if (e.kind !== 'attempt' || e.tS < nowS - span) continue;
          if (e.family === null || !STRIKE_FAMILIES.has(e.family as never)) continue;
          n++;
        }
        expect(Object.is(ledger.paceEstimate(20, (step % 200) / 10), (n * 60 + 20 * 8) / (span + 8))).toBe(true);
      }
    }
  });
});
