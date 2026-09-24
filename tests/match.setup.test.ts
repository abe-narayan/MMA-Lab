/**
 * PHASE 7a — match setup, modes, rulesets, arenas, tournaments, history.
 *
 * The same constraint Phase 6 wrote under applies: this project ships with no
 * DOM test environment and may add no dependency, so nothing here clicks a
 * button. It does not need to. Every decision the screens make lives in a pure
 * function in `src/app/model/**`, in `src/app/run/**` or in
 * `src/app/workers/simProtocol.ts`, and that is what is tested.
 *
 * The load-bearing test is the last one. A Worker exists so the page does not
 * freeze; it must not, under any circumstances, change the fight. The test
 * drives the worker's own runner across a JSON boundary — the same
 * serialisation a `postMessage` performs — and asserts the digest, tick count,
 * draw count and full event stream are identical to a plain `simulate()`.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  ARCHETYPES, ARENAS, DEFAULT_SETTINGS, RULESETS, SIM_ENGINE_VERSION,
  configFromReplay, simulate, toReplayFile, verifyReplay,
  type ArenaId, type FighterDefinition, type MatchSettings, type RulesetId, type SimConfig,
} from '../src/sim';

import {
  CATCHWEIGHT_MAX_GAP_KG, FFA_MAX, RULESET_IDS, ARENA_IDS, STANDARD_ARENAS, TEAM_PRESETS,
  buildSimConfig, defaultDraft, isStandardPairing, mismatchWarnings, newSeed, pairingWarning,
  resizeSlots, sideCounts, slotCount, slotPlan, teamAssignmentFor,
  type MatchDraft,
} from '../src/app/model/matchModel';

import {
  SUPPORTED_SIZES, applyResult, bracketPlan, buildBracket, championOf, matchCount, readyMatches,
  seedOrder, seedSlots, standings, type BracketFormat, type BracketMatch,
} from '../src/app/model/bracket';

import {
  CARRY_FRACTIONS, EMPTY_LEDGER, FRESH, applyCarryOver, carriedAfter, damageLedger,
} from '../src/app/model/carryOver';

import { createRunner, type FromWorker, type ToWorker } from '../src/app/workers/simProtocol';
import { historyEntryFor, runBout } from '../src/app/run/runBout';
import { bindMatchStore, memoryMatchStore } from '../src/app/run/matchStore';
import { resetStorage, setStorage, type StorageLike } from '../src/app/store';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const A: FighterDefinition = ARCHETYPES['arch.regional_pro_allrounder'];
const B: FighterDefinition = ARCHETYPES['arch.pressure_boxer'];
const C: FighterDefinition = ARCHETYPES['arch.bjj_guard_player'];
const HEAVY: FighterDefinition = ARCHETYPES['arch.heavyweight_power_puncher'];
const FLY: FighterDefinition = ARCHETYPES['arch.flyweight_volume_striker'];

const DEFS = new Map<string, FighterDefinition>(
  [A, B, C, HEAVY, FLY].map((d) => [d.id, d]),
);
const lookup = (id: string): FighterDefinition | undefined => DEFS.get(id);

function draftWith(patch: Partial<MatchDraft>): MatchDraft {
  return resizeSlots({ ...defaultDraft('seed.fixture'), ...patch });
}

const baseConfig = (seed: string): SimConfig => ({
  seed,
  mode: '1v1',
  fighters: [A, B],
  teams: { teamOf: [0, 1] },
  ruleset: 'mma.unified.3r',
  arena: 'octagon_30',
  settings: { ...DEFAULT_SETTINGS },
});

// --------------------------------------------------------------------------
// 1. Mode presets and team assignment (09 §3.1)
// --------------------------------------------------------------------------

describe('match modes', () => {
  it('1v1 is two teams of one', () => {
    const shape = { mode: '1v1' as const, teamPreset: '2v2' as const, ffaCount: 3, crowdAttackers: 3 };
    expect(sideCounts(shape)).toEqual([1, 1]);
    expect(teamAssignmentFor(shape)).toEqual({ teamOf: [0, 1] });
  });

  it('every team preset produces the sizes 09 §3.1 names', () => {
    const expected: Record<string, [number, number]> = {
      '2v2': [2, 2], '1v2': [1, 2], '1v3': [1, 3], '1v5': [1, 5], '3v3': [3, 3],
    };
    for (const [preset, sizes] of Object.entries(expected)) {
      expect(TEAM_PRESETS[preset as keyof typeof TEAM_PRESETS]).toEqual(sizes);
      const shape = {
        mode: 'teams' as const,
        teamPreset: preset as keyof typeof TEAM_PRESETS,
        ffaCount: 3,
        crowdAttackers: 3,
      };
      expect(sideCounts(shape)).toEqual(sizes);
      const teamOf = teamAssignmentFor(shape).teamOf;
      expect(teamOf.length).toBe(sizes[0] + sizes[1]);
      expect(teamOf.filter((t) => t === 0).length).toBe(sizes[0]);
      expect(teamOf.filter((t) => t === 1).length).toBe(sizes[1]);
      // Slots are laid out team by team: side A first, then side B.
      expect(teamOf.slice(0, sizes[0]).every((t) => t === 0)).toBe(true);
    }
  });

  it('1v5 puts the lone fighter on team 0 and five on team 1', () => {
    const teamOf = teamAssignmentFor({
      mode: 'teams', teamPreset: '1v5', ffaCount: 3, crowdAttackers: 3,
    }).teamOf;
    expect(teamOf).toEqual([0, 1, 1, 1, 1, 1]);
  });

  it('ffa gives every fighter their own team, 2 to 6', () => {
    for (let n = 2; n <= FFA_MAX; n++) {
      const teamOf = teamAssignmentFor({
        mode: 'ffa', teamPreset: '2v2', ffaCount: n, crowdAttackers: 3,
      }).teamOf;
      expect(teamOf).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(new Set(teamOf).size).toBe(n);
    }
  });

  it('crowd is one defender against 2 to 8 attackers', () => {
    for (let n = 2; n <= 8; n++) {
      const shape = { mode: 'crowd' as const, teamPreset: '2v2' as const, ffaCount: 3, crowdAttackers: n };
      expect(sideCounts(shape)).toEqual([1, n]);
      expect(slotCount(shape)).toBe(n + 1);
      const plan = slotPlan(shape);
      expect(plan[0].label).toBe('Defender');
      expect(plan[1].label).toBe('Attacker 1');
      expect(plan.every((s, i) => s.team === (i === 0 ? 0 : 1))).toBe(true);
    }
  });

  it('mode counts are clamped to their documented bounds', () => {
    expect(sideCounts({ mode: 'ffa', teamPreset: '2v2', ffaCount: 99, crowdAttackers: 3 }).length).toBe(6);
    expect(sideCounts({ mode: 'ffa', teamPreset: '2v2', ffaCount: 0, crowdAttackers: 3 }).length).toBe(2);
    expect(sideCounts({ mode: 'crowd', teamPreset: '2v2', ffaCount: 3, crowdAttackers: 99 })[1]).toBe(8);
  });

  it('resizing the slot list keeps the picks that survive', () => {
    const three = draftWith({ mode: 'teams', teamPreset: '1v2', slots: [A.id, B.id, C.id] });
    expect(three.slots).toEqual([A.id, B.id, C.id]);
    const two = resizeSlots({ ...three, mode: '1v1' });
    expect(two.slots).toEqual([A.id, B.id]);
    const back = resizeSlots({ ...two, mode: 'teams', teamPreset: '1v3' });
    expect(back.slots).toEqual([A.id, B.id, null, null]);
  });
});

// --------------------------------------------------------------------------
// 2. Ruleset × arena legality (09 §3.3)
// --------------------------------------------------------------------------

describe('ruleset x arena legality', () => {
  /** The table as 09 §3.3 writes it, re-derived here rather than imported. */
  const rings: ArenaId[] = ['ring_16', 'ring_20', 'ring_24'];
  const cages: ArenaId[] = ['octagon_30', 'octagon_25'];
  const EXPECTED: Record<RulesetId, ArenaId[]> = {
    'mma.unified.3r': [...cages, ...rings],
    'mma.unified.5r': [...cages, ...rings],
    'mma.unified.2017': [...cages, ...rings],
    'mma.amateur': [...cages, ...rings],
    'boxing.pro': [...rings],
    'kickboxing.glory': [...rings],
    'kickboxing.k1': [...rings],
    'muay_thai.abc': [...rings, ...cages],
    'muay_thai.stadium': [...rings, ...cages],
    'grappling.ibjjf': ['mat_ibjjf'],
    'grappling.adcc': ['mat_ibjjf'],
    'grappling.subonly': ['mat_ibjjf'],
    'judo.ijf': ['tatami_ijf'],
    street: ['street_open', 'street_grass'],
  };

  it('covers all fourteen rulesets and all nine arenas', () => {
    expect(RULESET_IDS.length).toBe(14);
    expect(ARENA_IDS.length).toBe(9);
    expect(Object.keys(RULESETS).sort()).toEqual([...RULESET_IDS].sort());
    expect(Object.keys(ARENAS).sort()).toEqual([...ARENA_IDS].sort());
  });

  it('matches the table cell for cell', () => {
    for (const ruleset of RULESET_IDS) {
      const allowed = new Set(EXPECTED[ruleset]);
      expect([...STANDARD_ARENAS[ruleset]].sort()).toEqual([...allowed].sort());
      for (const arena of ARENA_IDS) {
        expect(isStandardPairing(ruleset, arena)).toBe(allowed.has(arena));
      }
    }
  });

  it('warns about a non-standard pairing but never blocks it', () => {
    expect(pairingWarning('mma.unified.3r', 'octagon_30')).toBeNull();
    const warning = pairingWarning('judo.ijf', 'street_open');
    expect(warning).toContain('Non-standard');
    // Not blocked: a config still builds.
    const draft = draftWith({
      ruleset: 'judo.ijf', arena: 'street_open', slots: [A.id, B.id],
    });
    expect(buildSimConfig(draft, lookup).problems).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// 3. Mismatch warnings (09 §3.4)
// --------------------------------------------------------------------------

describe('mismatch warnings', () => {
  const settings = (p: Partial<MatchSettings>): MatchSettings => ({ ...DEFAULT_SETTINGS, ...p });

  it('says nothing when a classed bout is inside its class', () => {
    const issues = mismatchWarnings([A, A], settings({ mismatchMode: 'classed', weightClass: 'catchweight' }));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('flags a classed bout across weight classes as an error', () => {
    const issues = mismatchWarnings(
      [FLY, HEAVY],
      settings({ mismatchMode: 'classed', weightClass: 'heavyweight' }),
    );
    expect(issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('enforces the 5 lb catchweight rule', () => {
    expect(CATCHWEIGHT_MAX_GAP_KG).toBeCloseTo(2.268, 3);
    const issues = mismatchWarnings(
      [FLY, HEAVY],
      settings({ mismatchMode: 'classed', weightClass: 'catchweight' }),
    );
    expect(issues.some((i) => i.level === 'error' && /Catchweight/.test(i.text))).toBe(true);
  });

  it('openweight reports the estimated shift instead of refusing', () => {
    const issues = mismatchWarnings([FLY, HEAVY], settings({ mismatchMode: 'openweight' }));
    expect(issues.some((i) => i.level === 'error')).toBe(false);
    expect(issues.some((i) => /pp of win probability/.test(i.text))).toBe(true);
  });

  it('calls an extreme size gap extreme', () => {
    const issues = mismatchWarnings([FLY, HEAVY], settings({ mismatchMode: 'openweight' }));
    expect(issues.some((i) => /Extreme size gap/.test(i.text))).toBe(true);
  });

  it('calls an extreme tier gap extreme', () => {
    const tierOf = (d: FighterDefinition): number => (d.id === A.id ? 5 : 1);
    const issues = mismatchWarnings([A, B], settings({ mismatchMode: 'openweight' }), tierOf);
    expect(issues.some((i) => /Extreme skill gap/.test(i.text))).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 4. Building a SimConfig, and reproducing it from the seed
// --------------------------------------------------------------------------

describe('the config the setup screen builds', () => {
  it('refuses an empty slot, an unknown id, a duplicate and an empty seed', () => {
    expect(buildSimConfig(draftWith({ slots: [A.id, null] }), lookup).problems.length).toBe(1);
    expect(buildSimConfig(draftWith({ slots: [A.id, 'nope'] }), lookup).problems[0])
      .toContain('no fighter with id');
    expect(buildSimConfig(draftWith({ slots: [A.id, A.id] }), lookup).problems[0])
      .toContain('same fighter is in two slots');
    expect(buildSimConfig(draftWith({ slots: [A.id, B.id], seed: '  ' }), lookup).problems[0])
      .toContain('seed cannot be empty');
  });

  it('produces a config that matches the draft', () => {
    const draft = draftWith({
      mode: 'teams', teamPreset: '1v2', slots: [A.id, B.id, C.id],
      ruleset: 'mma.unified.5r', arena: 'octagon_25', seed: 'seed.teams',
    });
    const { config, problems } = buildSimConfig(draft, lookup);
    expect(problems).toEqual([]);
    expect(config).not.toBeNull();
    expect(config?.mode).toBe('teams');
    expect(config?.teams.teamOf).toEqual([0, 1, 1]);
    expect(config?.fighters.map((f) => f.id)).toEqual([A.id, B.id, C.id]);
    expect(config?.ruleset).toBe('mma.unified.5r');
    expect(config?.arena).toBe('octagon_25');
    expect(config?.seed).toBe('seed.teams');
  });

  it('gives the street ruleset its 180 s cap and drops an out-of-range home fighter', () => {
    const draft = draftWith({
      mode: 'crowd', crowdAttackers: 2, slots: [A.id, B.id, C.id],
      ruleset: 'street', arena: 'street_open',
      settings: { ...DEFAULT_SETTINGS, homeFighter: 9 },
    });
    const { config } = buildSimConfig(draft, lookup);
    expect(config?.settings.maxSeconds).toBe(180);
    expect(config?.settings.homeFighter).toBeUndefined();
  });

  it('is a valid, runnable config that reproduces bit-identically from its seed', () => {
    const draft = draftWith({ slots: [A.id, B.id], seed: 'phase7a.reproduce' });
    const { config } = buildSimConfig(draft, lookup);
    expect(config).not.toBeNull();

    const first = simulate(config as SimConfig);
    const second = simulate(config as SimConfig);
    expect(second.digest).toBe(first.digest);
    expect(second.ticks).toBe(first.ticks);
    expect(second.rngDraws).toBe(first.rngDraws);
    expect(second.result).toEqual(first.result);
    expect(second.events.length).toBe(first.events.length);

    // And through a replay file, which is how the app stores it.
    const file = toReplayFile(first);
    const reloaded = simulate(configFromReplay(
      JSON.parse(JSON.stringify(file)) as typeof file,
    ));
    expect(reloaded.digest).toBe(first.digest);
    expect(verifyReplay(file).verified).toBe(true);
    expect(file.engineVersion).toBe(SIM_ENGINE_VERSION);
  });

  it('a different seed is a different fight', () => {
    const one = simulate(baseConfig('phase7a.seed-one'));
    const two = simulate(baseConfig('phase7a.seed-two'));
    expect(two.digest).not.toBe(one.digest);
  });

  it('newSeed is deterministic in its inputs and never empty', () => {
    expect(newSeed('bout', 1234)).toBe(newSeed('bout', 1234));
    expect(newSeed('bout', 1234)).not.toBe(newSeed('bout', 1235));
    expect(newSeed('bout', 1234).length).toBeGreaterThan(6);
  });
});

// --------------------------------------------------------------------------
// 5. Brackets (09 §3.5)
// --------------------------------------------------------------------------

describe('bracket generation', () => {
  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `f${i + 1}`);

  it('supports exactly the sizes 09 §3.5 lists', () => {
    expect(SUPPORTED_SIZES.single).toEqual([4, 8, 16, 32]);
    expect(SUPPORTED_SIZES.double).toEqual([8, 16]);
    expect(SUPPORTED_SIZES.roundRobin.every((n) => n <= 8)).toBe(true);
  });

  it('single elimination has size-1 matches and log2(size) rounds at every size', () => {
    for (const size of SUPPORTED_SIZES.single) {
      const plan = bracketPlan('single', size);
      expect(plan.rounds.length).toBe(Math.log2(size));
      expect(matchCount(plan)).toBe(size - 1);
      expect(plan.rounds[0].length).toBe(size / 2);
      expect(plan.rounds[plan.rounds.length - 1].length).toBe(1);
    }
  });

  it('double elimination has 2*size-2 matches over k + (2k-2) + 1 rounds', () => {
    for (const size of SUPPORTED_SIZES.double) {
      const k = Math.log2(size);
      const plan = bracketPlan('double', size);
      expect(matchCount(plan)).toBe(2 * size - 2);
      // k winners rounds, 2k-2 losers rounds, one grand final.
      expect(plan.rounds.length).toBe(k + (2 * k - 2) + 1);
      expect(plan.rounds[plan.rounds.length - 1].length).toBe(1);
      // Every winners-bracket match drops its loser somewhere.
      const wb = plan.rounds.slice(0, k).flat();
      expect(wb.every((m) => m.loserTo !== null)).toBe(true);
      // Every slot is fed by at most one match.
      const seen = new Set<string>();
      for (const m of plan.rounds.flat()) {
        for (const ref of [m.winnerTo, m.loserTo]) {
          if (!ref) continue;
          const key = `${ref.round}:${ref.match}:${ref.slot}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it('round robin pairs everyone exactly once, at every supported size', () => {
    for (const size of SUPPORTED_SIZES.roundRobin) {
      const bracket = buildBracket('roundRobin', size, ids(size));
      const pairs = new Set<string>();
      let real = 0;
      for (const row of bracket) {
        for (const m of row) {
          if (m.a === null || m.b === null) continue;
          real++;
          pairs.add([m.a, m.b].sort().join('|'));
        }
      }
      expect(real).toBe((size * (size - 1)) / 2);
      expect(pairs.size).toBe(real);
      // An odd field means one fighter rests per round.
      const perRound = bracket.map((row) => row.filter((m) => m.a !== null && m.b !== null).length);
      expect(perRound.every((n) => n === Math.floor(size / 2))).toBe(true);
    }
  });

  it('seeds a full single-elimination draw so 1 meets the lowest seed', () => {
    expect(seedSlots(4)).toEqual([1, 4, 2, 3]);
    expect(seedSlots(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    for (const size of SUPPORTED_SIZES.single) {
      const slots = seedSlots(size);
      // Every seed appears once; every first-round pair sums to size + 1, so
      // the top seed always draws the bottom one and 1 and 2 are in opposite
      // halves and can only meet in the final.
      expect([...slots].sort((x, y) => x - y)).toEqual(
        Array.from({ length: size }, (_, i) => i + 1),
      );
      for (let i = 0; i < size; i += 2) expect(slots[i] + slots[i + 1]).toBe(size + 1);
      expect(slots[0]).toBe(1);
      expect(slots.indexOf(2)).toBeGreaterThanOrEqual(size / 2);
    }
    const bracket = buildBracket('single', 8, ids(8));
    expect(bracket[0][0].a).toBe('f1');
    expect(bracket[0][0].b).toBe('f8');
    expect(bracket[0][2].a).toBe('f2');
  });

  it('gives byes to the top seeds when the field is short', () => {
    // Five entrants into an eight draw: three byes, and seeds 1-3 get them.
    const plan = bracketPlan('single', 8);
    const bracket = buildBracket('single', 8, ids(5));
    const round0 = bracket[0];
    const byes = round0.filter((m) => m.winner !== null);
    expect(byes.length).toBe(3);
    expect(byes.map((m) => m.winner).sort()).toEqual(['f1', 'f2', 'f3']);
    // Those byes are already standing in round 1, and the two of them that
    // met a bye on the same side of the draw are ready to fight each other.
    expect(bracket[1].flatMap((m) => [m.a, m.b]).filter(Boolean).sort())
      .toEqual(['f1', 'f2', 'f3']);
    const ready = readyMatches(plan, bracket);
    expect(ready.length).toBe(2);
    expect(ready.some((m) => m.round === 0)).toBe(true);
    expect(ready.some((m) => m.round === 1)).toBe(true);
  });

  it('handles every odd entrant count into every single-elimination size', () => {
    for (const size of SUPPORTED_SIZES.single) {
      for (let n = 2; n <= size; n++) {
        const plan = bracketPlan('single', size);
        let bracket = buildBracket('single', size, ids(n));
        // Play the whole thing out: the lower id always wins.
        let guard = 0;
        while (championOf(plan, bracket) === null && guard++ < 200) {
          const next = readyMatches(plan, bracket);
          expect(next.length).toBeGreaterThan(0);
          const m = next[0];
          const winner = Number(m.a.slice(1)) < Number(m.b.slice(1)) ? m.a : m.b;
          bracket = applyResult(plan, bracket, m.round, m.match, winner, null);
        }
        expect(championOf(plan, bracket)).toBe('f1');
      }
    }
  });

  it('runs a double-elimination draw to a single champion, with and without byes', () => {
    for (const size of SUPPORTED_SIZES.double) {
      for (const n of [size, size - 1, size - 3, Math.floor(size / 2) + 1]) {
        const plan = bracketPlan('double', size);
        let bracket = buildBracket('double', size, ids(n));
        let guard = 0;
        while (championOf(plan, bracket) === null && guard++ < 400) {
          const next = readyMatches(plan, bracket);
          expect(next.length).toBeGreaterThan(0);
          const m = next[0];
          const winner = Number(m.a.slice(1)) < Number(m.b.slice(1)) ? m.a : m.b;
          bracket = applyResult(plan, bracket, m.round, m.match, winner, null);
        }
        expect(championOf(plan, bracket)).toBe('f1');
      }
    }
  });

  it('a losing fighter gets a second life in double elimination', () => {
    const plan = bracketPlan('double', 8);
    let bracket = buildBracket('double', 8, ids(8));
    const first = readyMatches(plan, bracket)[0];
    const loser = first.a === 'f1' ? first.b : first.a;
    bracket = applyResult(plan, bracket, first.round, first.match, first.a, null);
    const stillIn = bracket.flat().some((m) => m.a === loser || m.b === loser);
    expect(stillIn).toBe(true);
  });

  it('refuses a winner who is not in the match', () => {
    const plan = bracketPlan('single', 4);
    const bracket = buildBracket('single', 4, ids(4)) as BracketMatch[][];
    expect(() => applyResult(plan, bracket, 0, 0, 'f3', null)).toThrow();
  });

  it('round-robin standings sort by wins, then fewest losses', () => {
    const plan = bracketPlan('roundRobin', 4);
    let bracket = buildBracket('roundRobin', 4, ids(4));
    let guard = 0;
    while (readyMatches(plan, bracket).length > 0 && guard++ < 50) {
      const m = readyMatches(plan, bracket)[0];
      const winner = Number(m.a.slice(1)) < Number(m.b.slice(1)) ? m.a : m.b;
      bracket = applyResult(plan, bracket, m.round, m.match, winner, null);
    }
    const table = standings(bracket);
    expect(table[0].id).toBe('f1');
    expect(table[0].wins).toBe(3);
    expect(table[table.length - 1].id).toBe('f4');
    expect(championOf(plan, bracket)).toBe('f1');
  });
});

// --------------------------------------------------------------------------
// 6. Seeding determinism (09 §3.5)
// --------------------------------------------------------------------------

describe('seeding', () => {
  const entrants = ['f3', 'f1', 'f4', 'f2', 'f5'];
  const rating = (id: string): number => Number(id.slice(1));

  it('manual keeps the order it was given', () => {
    expect(seedOrder(entrants, 'manual', 'tour.x', rating)).toEqual(entrants);
  });

  it('rating sorts descending, ties broken by id', () => {
    expect(seedOrder(entrants, 'rating', 'tour.x', rating)).toEqual(['f5', 'f4', 'f3', 'f2', 'f1']);
    expect(seedOrder(entrants, 'rating', 'tour.x', () => 1)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
  });

  it('random is deterministic per tournament id and independent of input order', () => {
    const one = seedOrder(entrants, 'random', 'tour.abc');
    const again = seedOrder(entrants, 'random', 'tour.abc');
    const shuffledInput = seedOrder([...entrants].reverse(), 'random', 'tour.abc');
    expect(again).toEqual(one);
    expect(shuffledInput).toEqual(one);
    expect([...one].sort()).toEqual([...entrants].sort());
  });

  it('a different tournament id is a different draw', () => {
    const a = seedOrder(entrants, 'random', 'tour.abc');
    const b = seedOrder(entrants, 'random', 'tour.xyz');
    expect(a.join()).not.toBe(b.join());
  });

  it('the whole bracket is reproducible from the tournament id alone', () => {
    const build = (): BracketMatch[][] =>
      buildBracket('single', 8, seedOrder(entrants, 'random', 'tour.repeat'));
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

// --------------------------------------------------------------------------
// 7. Carry-over (09 §3.5)
// --------------------------------------------------------------------------

describe('carry-over', () => {
  const ledger = {
    head: 0.4, body: 0.6, legs: 0.2, cuts: 2, knockdownsSuffered: 1, koLoss: true,
  };

  it('none carries nothing', () => {
    expect(carriedAfter(FRESH, ledger, 'none')).toEqual(FRESH);
    expect(CARRY_FRACTIONS.none.staminaPct).toBe(1);
  });

  it('sameNight applies the documented fractions exactly', () => {
    const after = carriedAfter(FRESH, ledger, 'sameNight');
    expect(after.head).toBeCloseTo(0.4 * 0.30, 10);
    expect(after.body).toBeCloseTo(0.6 * 0.50, 10);
    expect(after.legs).toBeCloseTo(0.2 * 0.50, 10);
    expect(after.cuts).toBe(2);
    expect(after.staminaPct).toBe(0.85);
  });

  it('career carries the same damage as sameNight', () => {
    expect(carriedAfter(FRESH, ledger, 'career')).toEqual(carriedAfter(FRESH, ledger, 'sameNight'));
    expect(CARRY_FRACTIONS.career).toEqual(CARRY_FRACTIONS.sameNight);
  });

  it('compounds across bouts', () => {
    const one = carriedAfter(FRESH, ledger, 'sameNight');
    const two = carriedAfter(one, ledger, 'sameNight');
    expect(two.head).toBeCloseTo((one.head + 0.4) * 0.3, 10);
    expect(two.head).toBeGreaterThan(one.head);
  });

  it('a carried fighter is measurably worse, and a fresh one is untouched', () => {
    const carried = carriedAfter(FRESH, ledger, 'sameNight');
    const hurt = applyCarryOver(A, carried, 'sameNight', ledger);
    expect(hurt.physical.chin).toBeLessThan(A.physical.chin);
    expect(hurt.physical.bodyToughness).toBeLessThan(A.physical.bodyToughness);
    expect(hurt.physical.cardio).toBeLessThan(A.physical.cardio);
    expect(applyCarryOver(A, FRESH, 'none', EMPTY_LEDGER)).toBe(A);
    // The source definition is never mutated.
    expect(A.physical.chin).toBe(ARCHETYPES['arch.regional_pro_allrounder'].physical.chin);
  });

  it('career adds the knockout to the record and ages the fighter', () => {
    const carried = carriedAfter(FRESH, ledger, 'career');
    const older = applyCarryOver(A, carried, 'career', ledger, 90);
    expect(older.record.koLosses).toBe(A.record.koLosses + 1);
    expect(older.record.knockdownsSuffered).toBe(A.record.knockdownsSuffered + 1);
    expect(older.body.ageYears).toBeCloseTo(A.body.ageYears + 90 / 365.25, 2);
    expect(older.record.daysSinceLastBout).toBe(90);
  });

  it('reads a real bout for the damage it did', () => {
    // A bout long enough for both men to have been hit (Phase 9: the old
    // seed now ends by an early submission before one of them is touched).
    let run = simulate(baseConfig('phase7a.ledger'));
    for (let i = 1; i < 12 && run.result.totalSeconds < 120; i++) run = simulate(baseConfig(`phase7a.ledger-${i}`));
    const zero = damageLedger(run.events, 0, run.result);
    const one = damageLedger(run.events, 1, run.result);
    expect(zero.head + zero.body + zero.legs).toBeGreaterThan(0);
    expect(one.head + one.body + one.legs).toBeGreaterThan(0);
    // No fighter can be recorded as having knocked themselves out.
    expect(zero.koLoss && one.koLoss).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 8. History round-trips through the store (09 §3.6)
// --------------------------------------------------------------------------

describe('history', () => {
  /** A `localStorage` that lives in a Map, so the real store can be exercised. */
  function fakeStorage(): StorageLike & { size(): number } {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
      removeItem: (k) => {
        map.delete(k);
      },
      size: () => map.size,
    };
  }

  beforeEach(() => {
    resetStorage();
  });

  it('round-trips a finished bout through the real persistence layer', () => {
    setStorage(fakeStorage());
    const store = bindMatchStore();
    const run = simulate(baseConfig('phase7a.history'));
    const entry = historyEntryFor(run, { playedAt: '2026-01-01T00:00:00.000Z' });

    expect(store.putHistory(entry).ok).toBe(true);
    const read = store.history();
    expect(read.length).toBe(1);
    expect(read[0].id).toBe(entry.id);
    expect(read[0].fighterNames).toEqual([A.name, B.name]);
    expect(read[0].result.method).toBe(run.result.method);

    // The stored replay is a whole, self-contained, verifiable file.
    const replay = read[0].replay;
    expect(typeof replay === 'object' && 'format' in replay && replay.format === 4).toBe(true);
    expect(verifyReplay(replay as never).verified).toBe(true);

    // Replacing by id does not duplicate; deleting removes.
    store.putHistory({ ...entry, fighterNames: ['x', 'y'] });
    expect(store.history().length).toBe(1);
    expect(store.history()[0].fighterNames).toEqual(['x', 'y']);
    store.removeHistory(entry.id);
    expect(store.history()).toEqual([]);
    resetStorage();
  });

  it('survives a JSON round trip unchanged', () => {
    const run = simulate(baseConfig('phase7a.json'));
    const entry = historyEntryFor(run, { playedAt: '2026-01-01T00:00:00.000Z' });
    const copy = JSON.parse(JSON.stringify(entry)) as typeof entry;
    expect(copy).toEqual(entry);
    expect(verifyReplay(copy.replay as never).verified).toBe(true);
  });

  it('tags a tournament bout with its bracket slot', () => {
    const run = simulate(baseConfig('phase7a.tournament-tag'));
    const entry = historyEntryFor(run, {
      tournamentId: 'tour.t', tournamentSlot: { roundIndex: 1, matchIndex: 2 }, label: 'Semi-final 3',
    });
    expect(entry.tournamentId).toBe('tour.t');
    const replay = entry.replay as { meta?: { tournament?: { id: string; roundIndex: number } } };
    expect(replay.meta?.tournament).toEqual({ id: 'tour.t', roundIndex: 1, matchIndex: 2 });
  });

  it('the in-memory store behaves like the persisted one', () => {
    const store = memoryMatchStore();
    const run = simulate(baseConfig('phase7a.memory'));
    const entry = historyEntryFor(run, { playedAt: '2026-01-01T00:00:00.000Z' });
    store.putHistory(entry);
    expect(store.history().length).toBe(1);
    store.clearHistory();
    expect(store.history()).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// 9. THE IMPORTANT ONE — a Worker must not change a bout
// --------------------------------------------------------------------------

describe('worker and main thread agree', () => {
  /**
   * Drive the worker's own runner the way a `postMessage` would: the config
   * goes across as structured-cloneable data, the replies come back the same
   * way. Anything the boundary loses — an undefined field, a class instance, a
   * non-enumerable property — shows up here as a changed digest.
   */
  async function throughTheWorker(config: SimConfig, record: boolean) {
    const out: FromWorker[] = [];
    const runner = createRunner({ post: (m) => out.push(JSON.parse(JSON.stringify(m)) as FromWorker) });
    const message = JSON.parse(JSON.stringify({
      type: 'run', id: 'w1', config, record, progressEveryTicks: 37,
    })) as ToWorker;
    await runner.handle(message);
    const done = out.find((m) => m.type === 'done');
    if (!done || done.type !== 'done') {
      const err = out.find((m) => m.type === 'error');
      throw new Error(err && err.type === 'error' ? err.message : 'the worker produced no run');
    }
    return { run: done.run, messages: out };
  }

  it('produces an identical digest, tick count, draw count and event stream', async () => {
    const config = baseConfig('phase7a.worker-parity');
    const main = simulate(config);
    const { run } = await throughTheWorker(config, false);

    expect(run.digest).toBe(main.digest);
    expect(run.ticks).toBe(main.ticks);
    expect(run.rngDraws).toBe(main.rngDraws);
    expect(run.result).toEqual(JSON.parse(JSON.stringify(main.result)));
    expect(run.events.length).toBe(main.events.length);
    expect(JSON.stringify(run.events)).toBe(JSON.stringify(JSON.parse(JSON.stringify(main.events))));
    expect(JSON.stringify(run.stats)).toBe(JSON.stringify(JSON.parse(JSON.stringify(main.stats))));
  });

  it('records the same frames as simulate({ record: true })', async () => {
    const config = baseConfig('phase7a.worker-frames');
    const main = simulate(config, { record: true });
    const { run } = await throughTheWorker(config, true);
    expect(run.frames?.length).toBe(main.frames?.length);
    expect(run.digest).toBe(main.digest);
  });

  it('holds across every mode, ruleset family and arena surface', async () => {
    const cases: SimConfig[] = [
      { ...baseConfig('parity.boxing'), ruleset: 'boxing.pro', arena: 'ring_20' },
      { ...baseConfig('parity.grappling'), ruleset: 'grappling.adcc', arena: 'mat_ibjjf' },
      { ...baseConfig('parity.judo'), ruleset: 'judo.ijf', arena: 'tatami_ijf' },
      {
        ...baseConfig('parity.crowd'),
        mode: 'crowd',
        fighters: [A, B, C],
        teams: { teamOf: [0, 1, 1] },
        ruleset: 'street',
        arena: 'street_open',
        settings: { ...DEFAULT_SETTINGS, maxSeconds: 60 },
      },
      {
        ...baseConfig('parity.ffa'),
        mode: 'ffa',
        fighters: [A, B, C],
        teams: { teamOf: [0, 1, 2] },
      },
    ];
    for (const config of cases) {
      const main = simulate(config);
      const { run } = await throughTheWorker(config, false);
      expect(run.digest, `digest for ${config.seed}`).toBe(main.digest);
      expect(run.ticks, `ticks for ${config.seed}`).toBe(main.ticks);
      expect(run.rngDraws, `draws for ${config.seed}`).toBe(main.rngDraws);
    }
  });

  it('streams progress without affecting the outcome', async () => {
    const config = baseConfig('phase7a.worker-progress');
    const slow = await throughTheWorker(config, false);
    const progress = slow.messages.filter((m) => m.type === 'progress');
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((m) => m.type === 'progress' && m.round >= 1)).toBe(true);
    expect(slow.run.digest).toBe(simulate(config).digest);
  });

  it('the main-thread fallback in runBout matches simulate() too', async () => {
    const config = baseConfig('phase7a.fallback');
    const outcome = await runBout(config, { record: false, forceMainThread: true }).promise;
    expect(outcome.ranOn).toBe('main');
    const main = simulate(config);
    expect(outcome.run.digest).toBe(main.digest);
    expect(outcome.run.ticks).toBe(main.ticks);
    expect(outcome.run.rngDraws).toBe(main.rngDraws);
  });

  it('reports a bad config as an error rather than throwing into the void', async () => {
    const broken = { ...baseConfig('phase7a.broken'), ruleset: 'not.a.ruleset' as RulesetId };
    await expect(throughTheWorker(broken, false)).rejects.toThrow();
  });
});
