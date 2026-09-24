/**
 * QA2 FIXES (docs/design/QA2_FINDINGS.md) in the screens this pass owns.
 *
 *  4. Team wins were shown as "No contest": the sim reports team results as
 *     winner 'none' with `winningTeam` set.
 *  5. Long names broke dialogs: names are capped at NAME_MAX, and an import
 *     shortens an over-long name with a warning instead of refusing it.
 *  7. Double-clicking Run cancelled the bout: Cancel is no longer rendered
 *     where Run was.
 *  8. Scrubber markers overlapped: close markers are stacked into rows.
 *  9. "Playback speed" did nothing: Watch now opens a bout at that speed.
 * 10. Raw method ids ("DECISION.UNANIMOUS") and mixed clock rounding.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ARCHETYPES, type BoutResult, type ReplayFileV4 } from '../src/sim';
import { NAME_MAX, importAll, validateFighter } from '../src/app/store';
import { hasWinner, winnerLabel } from '../src/app/screens/BoutResult';
import { resultLine } from '../src/app/replay/library';
import { clockText, methodText } from '../src/app/model/format';
import { stackMarkers, MARKER_GAP } from '../src/app/components/watch/Scrubber';
import { startSpeed } from '../src/app/screens/Watch';
import { SPEED_STEPS } from '../src/app/replay/player';
import { MatchSetup } from '../src/app/screens/MatchSetup';
import { memoryMatchStore } from '../src/app/run/matchStore';
import { defaultDraft } from '../src/app/model/matchModel';
import { makeRecord, blankFighter } from '../src/app/store';
import type { FighterStoreApi } from '../src/app/storeApi';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const RPA = clone(ARCHETYPES['arch.regional_pro_allrounder']);

const result = (over: Partial<BoutResult>): BoutResult => ({
  winner: 'none', winningTeam: null, method: 'tko', detail: '', round: 1, timeSeconds: 234.6,
  totalSeconds: 234.6, scorecards: [], judgeTotals: [], ...over,
});

describe('4. team wins are named, not "No contest"', () => {
  const names = ['AAA', 'BBB', 'CCC', 'DDD'];
  it('names the winning team and its members', () => {
    const r = result({ winner: 'none', winningTeam: 0 });
    expect(winnerLabel(r, names, [0, 0, 1, 1])).toBe('Red team (AAA, BBB)');
    expect(winnerLabel(result({ winningTeam: 1 }), names, [0, 0, 1, 1])).toBe('Blue team (CCC, DDD)');
    expect(winnerLabel(r, names)).toBe('Red team');
    expect(hasWinner(r)).toBe(true);
  });
  it('keeps individual winners, draws and real no contests', () => {
    expect(winnerLabel(result({ winner: 1 }), names)).toBe('BBB');
    expect(winnerLabel(result({ winner: 'draw' }), names)).toBe('Draw');
    expect(winnerLabel(result({ method: 'noContest' }), names)).toBe('No contest');
    expect(hasWinner(result({}))).toBe(false);
  });
  it('the replay library line names the team and spells the method', () => {
    const file = {
      fighters: [RPA, RPA, RPA], teams: { teamOf: [0, 1, 1] },
      result: result({ winningTeam: 1, method: 'decision.unanimous', round: 3, timeSeconds: 300 }),
    } as unknown as ReplayFileV4;
    const line = resultLine(file);
    expect(line).toContain('Unanimous decision');
    expect(line).toContain('Blue team');
    expect(line).not.toMatch(/none|DECISION\.UNANIMOUS/);
  });
});

describe('5. name length', () => {
  it('refuses a name longer than NAME_MAX with a clear message', () => {
    const def = { ...clone(RPA), name: 'x'.repeat(NAME_MAX + 1) };
    const check = validateFighter(def);
    expect(check.ok).toBe(false);
    expect(check.issues.find((i) => i.path === 'name')?.message).toMatch(`at most ${NAME_MAX}`);
    expect(validateFighter({ ...clone(RPA), name: 'x'.repeat(NAME_MAX) }).ok).toBe(true);
  });
  it('import shortens a 2,000-character name and says so', () => {
    const long = `${'Very Long Name '.repeat(140)}`;
    const r = importAll({ schemaVersion: 1, fighters: [{ ...clone(RPA), name: long }] }, { fighterIds: [] });
    expect(r.fighters).toHaveLength(1);
    expect(r.fighters[0].name.length).toBeLessThanOrEqual(NAME_MAX);
    expect(r.issues.some((i) => i.severity === 'warning' && i.path.endsWith('.name'))).toBe(true);
  });
});

describe('7. Run and Cancel never share a spot', () => {
  it('the header holds only Run; Cancel lives in the progress strip', () => {
    const records = Object.values(ARCHETYPES).map((d) => makeRecord(d, { builtIn: true }));
    const store = {
      list: () => records, get: (id: string) => records.find((r) => r.definition.id === id),
      validate: validateFighter, blank: blankFighter,
    } as unknown as FighterStoreApi;
    const html = renderToStaticMarkup(
      <MatchSetup store={store} matchStore={memoryMatchStore()} revision={0}
        draft={defaultDraft('s')} onDraftChange={() => undefined} onRan={() => undefined} />,
    );
    const actions = html.slice(html.indexOf('page-actions'), html.indexOf('</header>'));
    expect(actions).toContain('Run bout');
    expect(actions).not.toContain('Cancel');
  });
});

describe('8. scrubber markers stack instead of overlapping', () => {
  it('puts markers closer than the gap in different rows', () => {
    const rows = stackMarkers([0.5, 0.5 + MARKER_GAP / 2, 0.5 + MARKER_GAP / 3, 0.9]);
    expect(new Set(rows.slice(0, 3)).size).toBe(3);
    expect(rows[3]).toBe(0);
  });
  it('reuses the first row once there is room', () => {
    expect(stackMarkers([0.1, 0.3, 0.5])).toEqual([0, 0, 0]);
  });
  it('never exceeds the row budget', () => {
    const rows = stackMarkers(Array.from({ length: 20 }, (_, i) => 0.5 + i * 1e-4));
    expect(Math.max(...rows)).toBeLessThan(3);
  });
});

describe('9. playback speed setting', () => {
  it('opens Watch at the configured speed, snapped to a transport step', () => {
    expect(startSpeed(0.25)).toBe(0.25);
    expect(startSpeed(2)).toBe(2);
    expect(startSpeed(8)).toBe(Math.max(...SPEED_STEPS));
    expect(startSpeed(undefined)).toBe(1);
  });
});

describe('10. one spelling for methods and clocks', () => {
  it('spells method ids in words, whatever their case', () => {
    expect(methodText('DECISION.UNANIMOUS')).toBe('Unanimous decision');
    expect(methodText('tko.doctor')).toBe('TKO (doctor stoppage)');
    expect(methodText('someNewMethod')).toBe('Some new method');
  });
  it('floors a result time, so 234.6 s is 3:54 everywhere', () => {
    expect(clockText(234.6)).toBe('3:54');
    expect(clockText(0)).toBe('0:00');
  });
});
