/**
 * STORE HARDENING — two defects from docs/design/REVIEW_PHASE8_9.md.
 *
 *  1. Import crashed on discipline keys (and ids) that collide with
 *     Object.prototype members: `toString`, `constructor`, `__proto__`.
 *     The file chooses the keys, so every lookup keyed by them must read the
 *     table's own entries only. A hostile or corrupted file is now rejected
 *     field by field with a message, never with "Cannot read properties of
 *     undefined".
 *  2. Tournaments lost an update: a finished match was written back onto the
 *     copy of the bracket captured when the bout *started*, so a result that
 *     landed in between was overwritten. Results now go through a functional
 *     update of the current stored state.
 */
import { describe, expect, it } from 'vitest';
import { ARCHETYPES, DEFAULT_SETTINGS } from '../src/sim';
import { importAll, validateFighter } from '../src/app/store';
import type { Tournament } from '../src/app/store/types';
import { memoryMatchStore } from '../src/app/run/matchStore';
import { applyResult, bracketPlan, buildBracket, resolveMatch, type BracketMatch } from '../src/app/model/bracket';
import { commitMatchResult } from '../src/app/screens/Tournaments';

const base = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(ARCHETYPES['arch.regional_pro_allrounder'])) as Record<string, unknown>;

describe('import survives prototype-named keys', () => {
  for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
    it(`rejects a discipline called "${key}" with a message instead of crashing`, () => {
      // Built as text so `__proto__` is a real own key, exactly as JSON.parse
      // produces it from a file.
      const def = base();
      const json = JSON.stringify({ schemaVersion: 1, fighters: [def] })
        .replace('"disciplines":{', `"disciplines":{"${key}":{"years":3,"sub":{"jab":50}},`);
      let result: ReturnType<typeof importAll> | undefined;
      expect(() => { result = importAll(json, { fighterIds: [] }); }).not.toThrow();
      expect(result!.fighters).toHaveLength(0);
      expect(result!.skipped).toBe(1);
      const issue = result!.issues.find((i) => i.path.includes(`disciplines.${key}`));
      expect(issue?.message).toMatch(/unknown discipline/);
    });
  }

  it('refuses a grade rank that names an Object.prototype member', () => {
    const def = base() as { disciplines: { bjj: { grade: unknown } } };
    def.disciplines.bjj.grade = { system: 'bjjBelt', rank: 'toString' };
    const check = validateFighter(def);
    expect(check.ok).toBe(false);
    expect(check.issues.some((i) => i.path.endsWith('grade.rank') && i.severity === 'error')).toBe(true);
  });

  it('does not crash on a grade system that names an Object.prototype member', () => {
    const def = base() as { disciplines: { bjj: { grade: unknown } } };
    def.disciplines.bjj.grade = { system: 'constructor', rank: 'bjj.black' };
    expect(() => validateFighter(def)).not.toThrow();
    expect(validateFighter(def).ok).toBe(false);
  });

  it('keeps fighter ids like "constructor" intact through the renaming map', () => {
    const def = { ...base(), id: 'constructor' };
    const tournament = {
      id: 'tour.x', name: 'x', format: 'single', size: 4, seeding: 'manual', carryOver: 'none',
      entrantIds: ['constructor', 'toString'],
      bracket: [[{ a: 'constructor', b: 'toString', winner: null, historyId: null }]],
      ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: DEFAULT_SETTINGS, createdAt: '2026-01-01',
    };
    const result = importAll({ schemaVersion: 1, fighters: [def], tournaments: [tournament] }, { fighterIds: [] });
    expect(result.fighters.map((f) => f.id)).toEqual(['constructor']);
    expect(result.tournaments[0].entrantIds).toEqual(['constructor', 'toString']);
    expect(result.tournaments[0].bracket[0][0].a).toBe('constructor');
    expect(result.tournaments[0].bracket[0][0].b).toBe('toString');
  });

  it('still renames a genuine id collision', () => {
    const def = base();
    const result = importAll({ schemaVersion: 1, fighters: [def] }, { fighterIds: [String(def.id)] });
    expect(result.fighters[0].id).toBe(`${String(def.id)} (imported)`);
  });
});

describe('tournament results are committed against the current bracket', () => {
  const entrants = ['f1', 'f2', 'f3', 'f4'];
  const plan = bracketPlan('single', 4);
  const tournament = (): Tournament => ({
    id: 'tour.lost-update', name: 'Lost update', format: 'single', size: 4, seeding: 'manual', carryOver: 'none',
    entrantIds: entrants, bracket: buildBracket('single', 4, entrants),
    ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS }, createdAt: '2026-01-01',
  });

  const commit = (store: ReturnType<typeof memoryMatchStore>, stale: Tournament, round: number, match: number, winner: 0 | 1, hid: string) =>
    commitMatchResult(store, stale.id, round, match, stale.bracket[round][match], (current, live) => {
      const res = resolveMatch(live, current.entrantIds, winner, undefined);
      if (res.kind !== 'advance') throw new Error('expected a winner');
      return { next: { ...current, bracket: applyResult(plan, current.bracket as BracketMatch[][], round, match, res.winnerId, hid) }, res };
    });

  it('keeps both results when two bouts started from the same copy finish in turn', () => {
    const store = memoryMatchStore({ tournaments: [tournament()] });
    const stale = store.tournaments()[0];
    // Both semi-finals were started from the same captured document.
    const [m0, m1] = [0, 1].map((m) => stale.bracket[0][m]);
    expect(m0.a).not.toBeNull();
    expect(m1.a).not.toBeNull();
    expect(commit(store, stale, 0, 0, 0, 'h0')).not.toBeNull();
    expect(commit(store, stale, 0, 1, 1, 'h1')).not.toBeNull();
    const now = store.tournaments()[0];
    expect(now.bracket[0][0].winner).toBe(m0.a);
    expect(now.bracket[0][1].winner).toBe(m1.b);
    expect(now.bracket[0][0].historyId).toBe('h0');
    expect(now.bracket[0][1].historyId).toBe('h1');
    // And the final was filled from both.
    expect([now.bracket[1][0].a, now.bracket[1][0].b].sort()).toEqual([m0.a, m1.b].sort());
  });

  it('writes nothing when the match was already decided meanwhile', () => {
    const store = memoryMatchStore({ tournaments: [tournament()] });
    const stale = store.tournaments()[0];
    expect(commit(store, stale, 0, 0, 0, 'first')).not.toBeNull();
    expect(commit(store, stale, 0, 0, 1, 'second')).toBeNull();
    expect(store.tournaments()[0].bracket[0][0].historyId).toBe('first');
  });

  it('writes nothing when the tournament was deleted meanwhile', () => {
    const store = memoryMatchStore({ tournaments: [tournament()] });
    const stale = store.tournaments()[0];
    store.removeTournament(stale.id);
    expect(commit(store, stale, 0, 0, 0, 'h')).toBeNull();
    expect(store.tournaments()).toHaveLength(0);
  });
});
