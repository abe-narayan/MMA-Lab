/**
 * FIGHTER CREATOR — DATA LAYER SUITE (Phase 6, 09 §3.6)
 *
 * The store sits between a user's work and a storage API that is allowed to
 * fail, so these tests attack the places where work can quietly disappear:
 *
 *   1. validation   — the archetypes must pass, and a wrong field must be
 *                     reported at a `path` precise enough to highlight,
 *   2. round-trip   — export then import must return the same bytes, including
 *                     fields this build has never heard of,
 *   3. collisions   — an import must never overwrite, an edit to a built-in
 *                     must never write through,
 *   4. storage      — a store that throws, and a store that is full, must both
 *                     leave the in-memory state intact and the fighters saved,
 *   5. generation   — a seed must produce the same fighter twice, and every
 *                     generated fighter must be one the sim will accept.
 *
 * Storage is stubbed rather than mocked: `MemoryStorage` is a real
 * implementation with a real byte quota, so the eviction path runs for the same
 * reason it runs in a browser.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ARCHETYPES, SIM_ENGINE_VERSION, deriveRuntime, resolveParams,
  type FighterDefinition, type ReplayFileV4,
} from '../src/sim';
import {
  STORAGE_KEYS, blankFighter, createFighter, exportAll, getFighter, importAll,
  loadDatabase, loadFighters, loadHistory, randomFighter, saveFighters, saveHistory,
  setStorage, summarise, resetStorage, toJson, unloadDatabase, updateFighter,
  validateFighter, searchFighters, sortFighters, nextFighterId,
  type FighterRecord, type HistoryEntry, type StorageLike,
} from '../src/app/store';

const params = resolveParams();
const ARCH_LIST = Object.entries(ARCHETYPES);

const errorsOf = (def: unknown): string[] =>
  validateFighter(def).issues.filter((i) => i.severity === 'error').map((i) => i.path);

/** Deep clone; a definition is plain JSON by contract (01). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// --------------------------------------------------------------------------
// A storage backend that behaves like the real one, including its failures
// --------------------------------------------------------------------------

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  /** Total bytes allowed across all keys; Infinity for an unbounded store. */
  quota = Infinity;
  /** Simulates a store that is present but refuses every write. */
  refuseWrites = false;
  writes = 0;

  private used(exceptKey?: string): number {
    let total = 0;
    for (const [k, v] of this.map) if (k !== exceptKey) total += k.length + v.length;
    return total;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes++;
    if (this.refuseWrites) throw new Error('SecurityError: storage is disabled');
    if (this.used(key) + key.length + value.length > this.quota) {
      throw new Error('QuotaExceededError');
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function historyEntry(id: string, playedAt: string, bodyBytes: number): HistoryEntry {
  const replay = {
    format: 4,
    engineVersion: SIM_ENGINE_VERSION,
    seed: `seed-${id}`,
    digest: `digest-${id}`,
    // The bulk of a real replay is its event log; this stands in for it.
    events: [{ pad: 'x'.repeat(bodyBytes) }],
  } as unknown as ReplayFileV4;
  return {
    id,
    replay,
    result: {
      winner: 0, winningTeam: null, method: 'ko', detail: 'tech.cross',
      round: 1, timeSeconds: 84, totalSeconds: 84, scorecards: [], judgeTotals: [],
    },
    fighterNames: ['A Fighter', 'B Fighter'],
    playedAt,
  };
}

beforeEach(() => {
  resetStorage();
  unloadDatabase();
  setStorage(new MemoryStorage());
});

// --------------------------------------------------------------------------
// 1. Validation
// --------------------------------------------------------------------------

describe('validateFighter — the built-ins', () => {
  it('accepts all fifteen archetypes with no errors', () => {
    for (const [id, def] of ARCH_LIST) {
      const result = validateFighter(def);
      expect(result.issues.filter((i) => i.severity === 'error'), `${id}`).toEqual([]);
      expect(result.ok, id).toBe(true);
    }
    expect(ARCH_LIST).toHaveLength(15);
  });

  it('accepts the blank creation template', () => {
    expect(validateFighter(blankFighter())).toMatchObject({ ok: true });
  });
});

describe('validateFighter — errors, and where they point', () => {
  const base = (): FighterDefinition => clone(ARCHETYPES['arch.regional_pro_allrounder']);

  it('rejects an attribute outside 0-100 at the attribute path', () => {
    const def = base();
    def.physical.chin = 140;
    def.physical.cardio = -3;
    const result = validateFighter(def);
    expect(result.ok).toBe(false);
    expect(errorsOf(def)).toEqual(expect.arrayContaining(['physical.chin', 'physical.cardio']));
    expect(result.issues.find((i) => i.path === 'physical.chin')?.message).toMatch(/0-100/);
  });

  it('rejects a missing attribute', () => {
    const def = base() as unknown as { physical: Record<string, number> };
    delete def.physical.neckStrength;
    expect(errorsOf(def)).toContain('physical.neckStrength');
  });

  it('rejects a sub-skill key that does not belong to the discipline', () => {
    const def = base() as unknown as { disciplines: { boxing: { sub: Record<string, number> } } };
    def.disciplines.boxing.sub.uppercuts = 60;
    const result = validateFighter(def);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.path === 'disciplines.boxing.sub.uppercuts');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toMatch(/not a boxing sub-skill/);
  });

  it('rejects an out-of-range sub-skill at its own path', () => {
    const def = base() as unknown as { disciplines: { bjj: { sub: Record<string, number> } } };
    def.disciplines.bjj.sub.guard = 250;
    expect(errorsOf(def)).toContain('disciplines.bjj.sub.guard');
  });

  it('rejects negative years trained', () => {
    const def = base() as unknown as { disciplines: { wrestling: { years: number } } };
    def.disciplines.wrestling.years = -1;
    const result = validateFighter(def);
    expect(result.ok).toBe(false);
    expect(result.issues.find((i) => i.path === 'disciplines.wrestling.years')?.message)
      .toMatch(/cannot be negative/);
  });

  it('rejects an unknown discipline', () => {
    const def = base() as unknown as { disciplines: Record<string, unknown> };
    def.disciplines.krav = { years: 2, sub: {} };
    expect(errorsOf(def)).toContain('disciplines.krav');
  });

  it('rejects bad enums in the body and the style', () => {
    const def = base() as unknown as {
      body: { stance: string; handedness: string };
      style: { primaryMode: string; whenLosing: string };
    };
    def.body.stance = 'sideways';
    def.body.handedness = 'both';
    def.style.primaryMode = 'ninja';
    def.style.whenLosing = 'cry';
    expect(errorsOf(def)).toEqual(expect.arrayContaining([
      'body.stance', 'body.handedness', 'style.primaryMode', 'style.whenLosing',
    ]));
  });

  it('rejects negative record counters', () => {
    const def = base();
    def.record.proWins = -2;
    def.record.knockdownsSuffered = -1;
    expect(errorsOf(def)).toEqual(expect.arrayContaining(['record.proWins', 'record.knockdownsSuffered']));
  });

  it('rejects a malformed technique reference but only warns on an unknown id', () => {
    const def = base();
    def.style.favouriteTechniques = [
      { techId: 'jab', weight: 1 },
      { techId: 'tech.not_a_real_strike', weight: 1 },
    ];
    const result = validateFighter(def);
    expect(result.issues.find((i) => i.path === 'style.favouriteTechniques[0].techId')?.severity).toBe('error');
    expect(result.issues.find((i) => i.path === 'style.favouriteTechniques[1].techId')?.severity).toBe('warning');
  });
});

describe('validateFighter — unusual but legal', () => {
  const tall = (heightM: number): FighterDefinition => {
    const def = clone(ARCHETYPES['arch.heavyweight_power_puncher']);
    def.body.heightM = heightM;
    def.body.reachM = heightM * 1.03;
    def.body.legReachM = heightM * 0.575;
    return def;
  };

  it('warns about a 2.1 m fighter but accepts them', () => {
    const result = validateFighter(tall(2.10));
    expect(result.ok).toBe(true);
    expect(result.issues.find((i) => i.path === 'body.heightM')?.severity).toBe('warning');
  });

  it('refuses a negative height', () => {
    const result = validateFighter(tall(-1.8));
    expect(result.ok).toBe(false);
    expect(result.issues.find((i) => i.path === 'body.heightM')?.severity).toBe('error');
  });

  it('warns when the sub-skills outrun the training years the tier cap allows', () => {
    const def = clone(ARCHETYPES['arch.champion_complete']) as unknown as {
      disciplines: { boxing: { years: number } };
    };
    def.disciplines.boxing.years = 0.5;
    const result = validateFighter(def);
    expect(result.ok).toBe(true);
    expect(result.issues.find((i) => i.path === 'disciplines.boxing.years')?.message)
      .toMatch(/caps the derived tier/);
  });
});

// --------------------------------------------------------------------------
// 2. Export / import
// --------------------------------------------------------------------------

describe('exportAll -> importAll', () => {
  const withUnknowns = (): FighterDefinition => {
    const def = clone(ARCHETYPES['arch.thai_striker']) as FighterDefinition & Record<string, unknown>;
    def.futureField = { addedBy: 'a later build', values: [1, 2, 3] };
    (def.body as unknown as Record<string, unknown>).shoulderWidthM = 0.46;
    return def;
  };

  it('round-trips a single fighter losslessly, unknown fields included', () => {
    const def = withUnknowns();
    const result = importAll(toJson(exportAll({ fighters: [def], nowIso: '2025-01-01T00:00:00.000Z' })));

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.fighters[0]).toEqual(def);
    expect((result.fighters[0] as unknown as Record<string, unknown>).futureField)
      .toEqual({ addedBy: 'a later build', values: [1, 2, 3] });
  });

  it('preserves unknown top-level keys of the document', () => {
    const doc = exportAll({ fighters: [], extra: { labNotes: 'from v2' }, nowIso: 'x' });
    const result = importAll(toJson(doc));
    expect(result.extra).toEqual({ labNotes: 'from v2' });
  });

  it('round-trips every archetype plus presets, tournaments and history', () => {
    const fighters = ARCH_LIST.map(([, def]) => def);
    const history = [historyEntry('h1', '2025-01-01T00:00:00.000Z', 16)];
    const doc = exportAll({
      fighters,
      history,
      presets: [{
        id: 'preset.1', name: 'Main event', mode: '1v1', fighterIds: [fighters[0].id, fighters[1].id],
        teams: { teamOf: [0, 1] }, ruleset: 'mma.unified.5r', arena: 'octagon_30',
        settings: { weightClass: 'openweight', weighIn: 'none', mismatchMode: 'openweight', refereeStrictness: 'standard', judgingMode: 'hidden', judgeCulture: 'unified_2025', damageRealism: 'realism', blood: true, commentary: true, speed: 1 },
        createdAt: '2025-01-01T00:00:00.000Z',
      }],
      tournaments: [{
        id: 'tourn.1', name: 'Grand Prix', format: 'single', size: 4, seeding: 'rating',
        carryOver: 'none', entrantIds: [fighters[0].id],
        bracket: [[{ a: fighters[0].id, b: null, winner: null, historyId: null }]],
        ruleset: 'mma.unified.3r', arena: 'octagon_30',
        settings: { weightClass: 'openweight', weighIn: 'none', mismatchMode: 'openweight', refereeStrictness: 'standard', judgingMode: 'hidden', judgeCulture: 'unified_2025', damageRealism: 'realism', blood: true, commentary: true, speed: 1 },
        createdAt: '2025-01-01T00:00:00.000Z',
      }],
      nowIso: '2025-01-01T00:00:00.000Z',
    });

    const result = importAll(toJson(doc));
    expect(result.skipped).toBe(0);
    expect(result.fighters).toEqual(fighters);
    expect(result.presets).toEqual(doc.presets);
    expect(result.tournaments).toEqual(doc.tournaments);
    expect(result.history[0].id).toBe('h1');
    expect(result.imported).toBe(fighters.length + 3);
  });

  it('suffixes a colliding id instead of overwriting', () => {
    const def = clone(ARCHETYPES['arch.judoka']);
    const doc = exportAll({ fighters: [def], nowIso: 'x' });

    const result = importAll(toJson(doc), { fighterIds: [def.id] });
    expect(result.imported).toBe(1);
    expect(result.fighters[0].id).toBe('arch.judoka (imported)');
    expect(result.renamed['arch.judoka']).toBe('arch.judoka (imported)');
    // Everything but the id is untouched.
    expect({ ...result.fighters[0], id: def.id }).toEqual(def);

    const again = importAll(toJson(doc), { fighterIds: [def.id, 'arch.judoka (imported)'] });
    expect(again.fighters[0].id).toBe('arch.judoka (imported 2)');
  });

  it('repoints a preset at the renamed fighter', () => {
    const def = clone(ARCHETYPES['arch.judoka']);
    const doc = exportAll({
      fighters: [def],
      presets: [{
        id: 'preset.x', name: 'p', mode: '1v1', fighterIds: [def.id, 'other'],
        teams: { teamOf: [0, 1] }, ruleset: 'mma.unified.3r', arena: 'octagon_30',
        settings: { weightClass: 'openweight', weighIn: 'none', mismatchMode: 'openweight', refereeStrictness: 'standard', judgingMode: 'hidden', judgeCulture: 'unified_2025', damageRealism: 'realism', blood: true, commentary: true, speed: 1 },
        createdAt: 'x',
      }],
      nowIso: 'x',
    });
    const result = importAll(toJson(doc), { fighterIds: [def.id] });
    expect(result.presets[0].fighterIds).toEqual(['arch.judoka (imported)', 'other']);
  });

  it('skips an invalid definition and reports the path inside the document', () => {
    const bad = clone(ARCHETYPES['arch.pressure_boxer']);
    bad.physical.speed = 900;
    const doc = exportAll({ fighters: [clone(ARCHETYPES['arch.judoka']), bad], nowIso: 'x' });

    const result = importAll(toJson(doc));
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.issues.some((i) => i.path === 'fighters[1].physical.speed' && i.severity === 'error')).toBe(true);
  });

  it('imports a replay from another engine but marks it unverifiable', () => {
    const entry = historyEntry('h9', '2025-01-01T00:00:00.000Z', 8);
    (entry.replay as ReplayFileV4).engineVersion = '3.0.0';
    const result = importAll(toJson(exportAll({ history: [entry], nowIso: 'x' })));

    expect(result.imported).toBe(1);
    expect(result.history[0].verified).toBe(false);
    expect(result.history[0].verifyReason).toBe('engine-version');
    expect(result.issues.some((i) => i.path === 'history[0].replay' && i.severity === 'warning')).toBe(true);
  });

  it('refuses a document from a future schema rather than guessing', () => {
    const result = importAll(JSON.stringify({ schemaVersion: 2, fighters: [] }));
    expect(result.imported).toBe(0);
    expect(result.issues[0]).toMatchObject({ path: 'schemaVersion', severity: 'error' });
  });

  it('reports unparseable JSON instead of throwing', () => {
    const result = importAll('{ not json');
    expect(result.imported).toBe(0);
    expect(result.issues[0].severity).toBe('error');
  });
});

// --------------------------------------------------------------------------
// 3. The database
// --------------------------------------------------------------------------

describe('fighter database', () => {
  it('seeds the fifteen archetypes as built-ins on first run', () => {
    const db = loadDatabase();
    expect(db).toHaveLength(15);
    expect(db.every((r) => r.builtIn)).toBe(true);
    expect(getFighter('arch.champion_complete')?.definition.name).toBe(ARCHETYPES['arch.champion_complete'].name);
  });

  it('clones a built-in when it is edited, leaving the archetype pristine', () => {
    loadDatabase();
    const before = getFighter('arch.thai_striker')!;
    const edited = clone(before.definition);
    edited.name = 'My Thai Striker';
    edited.mental.aggression = 91;

    const outcome = updateFighter('arch.thai_striker', edited, { nowIso: '2025-02-02T00:00:00.000Z' });

    expect(outcome.cloned).toBe(true);
    expect(outcome.record.builtIn).toBe(false);
    expect(outcome.record.definition.id).not.toBe('arch.thai_striker');
    expect(outcome.record.definition.mental.aggression).toBe(91);

    const original = getFighter('arch.thai_striker')!;
    expect(original.builtIn).toBe(true);
    expect(original.definition.name).toBe(before.definition.name);
    expect(original.definition.mental.aggression).toBe(ARCHETYPES['arch.thai_striker'].mental.aggression);
    // And the shared archetype object itself is untouched.
    expect(ARCHETYPES['arch.thai_striker'].name).not.toBe('My Thai Striker');
  });

  it('edits a user fighter in place', () => {
    loadDatabase();
    const created = createFighter(randomFighter('user-1'), { nowIso: '2025-01-01T00:00:00.000Z' }).record;
    const edited = clone(created.definition);
    edited.name = 'Renamed';

    const outcome = updateFighter(created.definition.id, edited, { nowIso: '2025-01-02T00:00:00.000Z' });
    expect(outcome.cloned).toBe(false);
    expect(getFighter(created.definition.id)?.definition.name).toBe('Renamed');
    expect(loadDatabase().filter((r) => !r.builtIn)).toHaveLength(1);
  });

  it('allocates ids that cannot collide', () => {
    const taken = new Set(['fighter.ana_silva']);
    expect(nextFighterId(taken, 'Ana Silva')).toBe('fighter.ana_silva.2');
    taken.add('fighter.ana_silva.2');
    expect(nextFighterId(taken, 'Ana Silva')).toBe('fighter.ana_silva.3');
    expect(nextFighterId(new Set(), '???')).toBe('fighter.fighter');
  });

  it('searches and sorts on the denormalised summary', () => {
    const db = loadDatabase();
    expect(searchFighters(db, { query: 'judoka' }).length).toBeGreaterThan(0);
    expect(searchFighters(db, { query: 'no such fighter' })).toHaveLength(0);
    expect(searchFighters(db, { minTier: 5 }).every((r) => r.summary.overallTier >= 5)).toBe(true);

    const byTier = sortFighters(db, 'tier');
    for (let i = 1; i < byTier.length; i++) {
      expect(byTier[i].summary.overallTier).toBeGreaterThanOrEqual(byTier[i - 1].summary.overallTier);
    }
  });
});

describe('summarise', () => {
  it('agrees with deriveRuntime on tier and reach for every archetype', () => {
    for (const [id, def] of ARCH_LIST) {
      const runtime = deriveRuntime(def, params, { explain: false });
      const summary = summarise(def);
      expect(summary.overallTier, id).toBe(runtime.mmaTier);
      expect(summary.reachCm, id).toBe(Math.round(runtime.body.reachM * 100));
      expect(summary.heightCm, id).toBe(Math.round(runtime.body.heightM * 100));
      expect(summary.stance, id).toBe(runtime.body.stance);
      expect(summary.topDiscipline, id).toMatch(/^T[0-5] \w+$/);
    }
  });

  it('is cheap enough to run over a few hundred fighters', () => {
    const defs = Array.from({ length: 200 }, (_, i) => randomFighter(`perf-${i}`));
    const started = Date.now();
    for (const def of defs) summarise(def);
    // Generous: the point is that it is not seconds per fighter.
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

// --------------------------------------------------------------------------
// 4. Persistence
// --------------------------------------------------------------------------

describe('persistence', () => {
  it('keeps the in-memory state when every write throws', () => {
    const store = new MemoryStorage();
    store.refuseWrites = true;
    setStorage(store);

    const records: FighterRecord[] = loadDatabase();
    expect(records).toHaveLength(15);

    const outcome = createFighter(randomFighter('resilient'), { nowIso: 'x' });
    expect(outcome.persisted.ok).toBe(false);
    // The edit survives in memory, and a re-read still sees it.
    expect(getFighter(outcome.record.definition.id)).toBeDefined();
    expect(loadFighters().some((r) => r.definition.id === outcome.record.definition.id)).toBe(true);
    expect(store.map.size).toBe(0);
  });

  it('returns defaults rather than throwing when reads fail', () => {
    setStorage({
      getItem(): string { throw new Error('SecurityError'); },
      setItem(): void { throw new Error('SecurityError'); },
      removeItem(): void { /* no-op */ },
    });
    expect(loadFighters()).toEqual([]);
    expect(loadHistory()).toEqual([]);
  });

  it('returns defaults rather than throwing on corrupt JSON', () => {
    const store = new MemoryStorage();
    store.map.set(STORAGE_KEYS.fighters, '{ truncated');
    store.map.set(STORAGE_KEYS.history, '"not an array"');
    setStorage(store);
    expect(loadFighters()).toEqual([]);
    expect(loadHistory()).toEqual([]);
  });

  it('works with no storage at all', () => {
    setStorage(null);
    const outcome = createFighter(randomFighter('no-storage'), { nowIso: 'x' });
    expect(outcome.persisted).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(getFighter(outcome.record.definition.id)).toBeDefined();
  });

  it('evicts replay bodies before anything else when the quota is exhausted', () => {
    const store = new MemoryStorage();
    setStorage(store);

    const history = Array.from({ length: 6 }, (_, i) =>
      historyEntry(`h${i}`, `2025-01-0${i + 1}T00:00:00.000Z`, 3000));
    expect(saveHistory(history).ok).toBe(true);

    const records = loadDatabase();
    const fightersJson = JSON.stringify(records);

    // Room for the fighters and a couple of replay bodies, not for all six.
    store.quota = store.map.get(STORAGE_KEYS.history)!.length * 0.55 + fightersJson.length + 200;

    const outcome = saveFighters(records);
    expect(outcome.ok).toBe(true);
    expect(outcome.evicted).toBeGreaterThan(0);

    // The fighters are intact...
    const stored = loadFighters();
    expect(stored).toHaveLength(15);
    expect(stored.map((r) => r.definition.id).sort()).toEqual(records.map((r) => r.definition.id).sort());

    // ...and the price was paid by the oldest replay bodies, which became stubs
    // that still carry the seed and digest needed to re-simulate the bout.
    const after = loadHistory();
    expect(after).toHaveLength(6);
    const full = after.filter((e) => (e.replay as { format?: number }).format === 4);
    expect(full.length).toBeLessThan(6);
    const stub = after.find((e) => (e.replay as { format?: number }).format !== 4)!;
    expect(stub.replay).toMatchObject({ seed: expect.stringContaining('seed-'), digest: expect.stringContaining('digest-') });
    expect((stub.replay as { summary: string }).summary).toContain('A Fighter');
    // Oldest first: h0 goes before h5.
    expect((after.find((e) => e.id === 'h0')!.replay as { format?: number }).format).not.toBe(4);
  });

  it('keeps full replays only for the most recent bouts', () => {
    setStorage(new MemoryStorage());
    const history = Array.from({ length: 60 }, (_, i) =>
      historyEntry(`h${String(i).padStart(2, '0')}`, `2025-01-01T00:${String(i).padStart(2, '0')}:00.000Z`, 8));
    expect(saveHistory(history).ok).toBe(true);

    const stored = loadHistory();
    expect(stored).toHaveLength(60);
    expect(stored.filter((e) => (e.replay as { format?: number }).format === 4)).toHaveLength(50);
  });
});

// --------------------------------------------------------------------------
// 5. Generation
// --------------------------------------------------------------------------

describe('randomFighter', () => {
  it('is deterministic per seed', () => {
    for (const seed of ['alpha', 'bravo', 'charlie-42']) {
      expect(randomFighter(seed)).toEqual(randomFighter(seed));
      expect(JSON.stringify(randomFighter(seed))).toBe(JSON.stringify(randomFighter(seed)));
    }
    expect(randomFighter('alpha')).not.toEqual(randomFighter('bravo'));
  });

  it('honours the options without losing determinism', () => {
    const a = randomFighter('opt', { tier: 5, weightClass: 'wc.flyweight', sex: 'female' });
    const b = randomFighter('opt', { tier: 5, weightClass: 'wc.flyweight', sex: 'female' });
    expect(a).toEqual(b);
    expect(a.body.weightClass).toBe('wc.flyweight');
    expect(a.body.sex).toBe('female');
    expect(summarise(a).overallTier).toBeGreaterThanOrEqual(4);
  });

  it('always produces a definition the sim accepts, with no warnings either', () => {
    for (let i = 0; i < 120; i++) {
      const def = randomFighter(`batch-${i}`);
      const result = validateFighter(def);
      expect(result.issues, `seed batch-${i}`).toEqual([]);
      // And it must actually derive: the creator shows a runtime immediately.
      expect(() => deriveRuntime(def, params, { explain: false })).not.toThrow();
    }
  });

  it('produces internally consistent bodies and careers', () => {
    for (let i = 0; i < 40; i++) {
      const def = randomFighter(`consistency-${i}`);
      expect(def.body.reachM / def.body.heightM).toBeGreaterThan(0.9);
      expect(def.body.reachM / def.body.heightM).toBeLessThan(1.15);
      expect(def.body.fightNightKg!).toBeGreaterThanOrEqual(def.body.weighInKg!);
      expect(def.record.proWins + def.record.proLosses).toBeGreaterThanOrEqual(0);
      expect(def.record.koLosses).toBeLessThanOrEqual(def.record.proLosses);
      expect(def.body.ageYears).toBeGreaterThanOrEqual(18);
    }
  });
});
