/**
 * FINAL REVIEW FIXES (docs/design/REVIEW_FINAL.md) — one regression per bug.
 *
 * No DOM environment is installed (see tests/creator.ui.test.tsx), so each
 * behaviour a click or key press drives is asserted through the pure function
 * or class the component now delegates to, plus static renders where markup
 * is the point.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ARCHETYPES, DEFAULT_SETTINGS, type FighterDefinition, type SimConfig } from '../src/sim';
import {
  ID_MAX, blankFighter, freeId, importAll, makeRecord, resetStorage, setStorage, toJson,
  exportRecords, unloadDatabase, validateFighter, type StorageLike,
} from '../src/app/store';
import type { FighterRecord } from '../src/app/store/types';
import type { FighterStoreApi } from '../src/app/storeApi';
import { bindStore, editorKey } from '../src/app/App';
import { FighterCreator, undoShortcut } from '../src/app/screens/FighterCreator';
import { batchCsvFileName, batchResultNames, type BatchPhase } from '../src/app/screens/BatchSim';
import { DraftHistory } from '../src/app/model/draftHistory';
import { clampNumber, deleteAtPath, setAtPath } from '../src/app/model/paths';
import { BODY_META } from '../src/app/model/fieldMeta';
import { numberInputText, rangeLabel, Slider } from '../src/app/ui';
import { aggregate, methodClass, type BoutSummary } from '../src/app/model/batchModel';
import { runBatch } from '../src/app/run/batchRun';

// Count every bout the batch runner actually finishes, including ones whose
// results the orchestrator discards after a cancel.
const counter = vi.hoisted(() => ({ results: 0 }));
vi.mock('../src/app/workers/batchProtocol', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/app/workers/batchProtocol')>();
  return {
    ...mod,
    createBatchRunner: (host: Parameters<typeof mod.createBatchRunner>[0]) => mod.createBatchRunner({
      ...host,
      post: (m) => { if (m.type === 'result') counter.results++; host.post(m); },
    }),
  };
});

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function fakeStore(records: FighterRecord[]): FighterStoreApi {
  return {
    list: () => records,
    get: (id) => records.find((r) => r.definition.id === id),
    save: (def) => makeRecord(def),
    remove: () => undefined,
    duplicate: (id) => makeRecord({ ...records.find((r) => r.definition.id === id)!.definition, id: `${id}.copy` }),
    validate: (def) => validateFighter(def),
    blank: () => blankFighter(),
    random: () => blankFighter(),
    exportJson: () => '{}',
    importJson: () => ({ added: 0, skipped: 0, problems: [] }),
  };
}

beforeEach(() => {
  resetStorage();
  unloadDatabase();
  setStorage(new MemoryStorage());
});

describe('1. a second "New fighter" does not overwrite the first', () => {
  it('each blank carries an id no stored fighter has', () => {
    const store = bindStore();
    const first = store.blank();
    const saved1 = store.save({ ...first, name: 'First Custom' });
    const second = store.blank();
    expect(second.id).not.toBe(saved1.definition.id);
    const saved2 = store.save({ ...second, name: 'Second Custom' });
    expect(saved2.definition.id).not.toBe(saved1.definition.id);
    const names = store.list().map((r) => r.summary.name);
    expect(names).toContain('First Custom');
    expect(names).toContain('Second Custom');
    // Deterministic: fighter.new, then fighter.new.2.
    expect(saved1.definition.id).toBe('fighter.new');
    expect(saved2.definition.id).toBe('fighter.new.2');
  });
});

describe('2. "Discard and leave" really discards', () => {
  it('a new editing session is a new editor key, so the draft remounts from its initial fighter', () => {
    // The shell bumps the session on "Discard and leave"; the key change
    // remounts <FighterCreator> on its `initial`, throwing the draft away and
    // restarting dirty tracking from a clean baseline.
    expect(editorKey('fighter.x', 1)).not.toBe(editorKey('fighter.x', 2));
    expect(editorKey('fighter.x', 3)).toBe(editorKey('fighter.x', 3));
    const src = readFileSync('src/app/App.tsx', 'utf8');
    const guard = src.slice(src.indexOf("confirmLabel: 'Discard and leave'"), src.indexOf('go(next);'));
    expect(guard).toMatch(/setEditorSession\(/);
    expect(src).toMatch(/key=\{editorKey\(editing\.def\.id, editorSession\)\}/);
  });
});

describe('3. undo shortcuts only act on the visible editor', () => {
  const key = (k: string, extra: Partial<{ shiftKey: boolean; target: EventTarget | null }> = {}) => ({
    ctrlKey: true, metaKey: false, shiftKey: false, key: k, target: null, ...extra,
  });
  it('does nothing while the creator tab is hidden', () => {
    expect(undoShortcut(key('z'), false)).toBeNull();
    expect(undoShortcut(key('y'), false)).toBeNull();
    expect(undoShortcut(key('z', { shiftKey: true }), false)).toBeNull();
  });
  it('undoes and redoes while it is showing', () => {
    expect(undoShortcut(key('z'), true)).toBe('undo');
    expect(undoShortcut(key('y'), true)).toBe('redo');
    expect(undoShortcut(key('Z', { shiftKey: true }), true)).toBe('redo');
    expect(undoShortcut({ ...key('z'), ctrlKey: false }, true)).toBeNull();
  });
  it('leaves typing in a text or number box to the browser', () => {
    const text = { tagName: 'INPUT', type: 'text' } as unknown as EventTarget;
    const num = { tagName: 'INPUT', type: 'number' } as unknown as EventTarget;
    expect(undoShortcut(key('z', { target: text }), true)).toBeNull();
    expect(undoShortcut(key('z', { target: num }), true)).toBeNull();
  });
});

describe('4. number fields allow free typing and clamp on commit', () => {
  it('shows the typed text while editing, not a clamped value', () => {
    // Typing "75" into weight (min 40): the "7" alone would clamp to 40.
    const clamp = BODY_META.massKg.clamp!;
    expect(clampNumber('7', clamp, 77.1)).toBe(40); // why per-keystroke commit was wrong
    expect(numberInputText('7', 77.1)).toBe('7');
    expect(numberInputText('75', 77.1)).toBe('75');
    expect(clampNumber('75', clamp, 77.1)).toBe(75); // committed on blur/Enter
    expect(numberInputText(null, 75)).toBe('75');
    expect(clampNumber('405', clamp, 75)).toBe(180);
  });
  it('prints the allowed range', () => {
    expect(rangeLabel(40, 180)).toBe('40–180');
    expect(rangeLabel(-1e9, 1e9)).toBeNull();
    const html = renderToStaticMarkup(
      <FighterCreator store={fakeStore([])} initial={blankFighter()} fromBuiltIn={false} onSaved={() => undefined} onCancel={() => undefined} />,
    );
    expect(html).toContain('fc-range');
    expect(html).toContain('40–180');
    const slider = renderToStaticMarkup(<Slider label="Pace" value={5} min={1} max={10} onChange={() => undefined} withNumber />);
    expect(slider).toContain('title="1–10"');
  });
});

describe('5. toast Undo restores the named action', () => {
  it('removing a discipline then moving a slider: Undo brings the discipline back', () => {
    const start = clone(ARCHETYPES['arch.regional_pro_allrounder']) as FighterDefinition;
    const disc = Object.keys(start.disciplines)[0];
    const h = new DraftHistory<FighterDefinition>(start);
    // untrainDiscipline: capture, then act.
    const restore = h.restorePoint();
    h.update((d) => deleteAtPath(d, `disciplines.${disc}`), '*', 1000);
    // A later, unrelated edit.
    h.update((d) => setAtPath(d, 'physical.power', 12), 'physical.power', 2000);
    expect(h.current.disciplines).not.toHaveProperty(disc);
    // The toast's Undo.
    h.update(restore, '*', 3000);
    expect(h.current.disciplines).toHaveProperty(disc);
    expect(h.current).toBe(start);
    // The restore is itself undoable.
    h.undo();
    expect(h.current.disciplines).not.toHaveProperty(disc);
  });
  it('the generic undo, by contrast, only reverts the latest edit', () => {
    const start = clone(ARCHETYPES['arch.regional_pro_allrounder']) as FighterDefinition;
    const disc = Object.keys(start.disciplines)[0];
    const h = new DraftHistory<FighterDefinition>(start);
    h.update((d) => deleteAtPath(d, `disciplines.${disc}`), '*', 1000);
    h.update((d) => setAtPath(d, 'physical.power', 12), 'physical.power', 2000);
    h.undo();
    expect(h.current.disciplines).not.toHaveProperty(disc);
  });
  it('the creator wires every toast Undo to a restore point', () => {
    const src = readFileSync('src/app/screens/FighterCreator.tsx', 'utf8');
    expect(src).not.toMatch(/onAction: undo\b/);
    expect((src.match(/onAction: undoAction\(restore\)/g) ?? []).length).toBe(3);
  });
});

describe('6. batch results keep the names and seed they ran with', () => {
  it('renders from the snapshot once a run has started', () => {
    const run = { names: ['Alpha', 'Bravo'] as [string, string], master: 'seed-1' };
    const finished = { kind: 'finished', run, outcome: {}, agg: {} } as unknown as BatchPhase;
    expect(batchResultNames(finished, ['Changed', 'Bravo'])).toEqual(['Alpha', 'Bravo']);
    expect(batchResultNames({ kind: 'idle' }, ['Changed', 'Bravo'])).toEqual(['Changed', 'Bravo']);
    expect(batchCsvFileName(run)).toBe('boutlab-batch-seed_1.csv');
  });
});

describe('7. low-severity fixes', () => {
  it('an imported id near the limit stays within ID_MAX after the suffix', () => {
    const long = `fighter.${'x'.repeat(ID_MAX - 8)}`;
    expect(long.length).toBe(ID_MAX);
    const taken = new Set([long]);
    const first = freeId(long, taken);
    expect(first.length).toBeLessThanOrEqual(ID_MAX);
    expect(first.endsWith(' (imported)')).toBe(true);
    const second = freeId(long, new Set([long, first]));
    expect(second.length).toBeLessThanOrEqual(ID_MAX);
    expect(second).not.toBe(first);
    // And through the real import path: the stored definition validates.
    const def = { ...clone(ARCHETYPES['arch.thai_striker']), id: long };
    const text = toJson(exportRecords([makeRecord(def)], {}, true));
    const result = importAll(text, { fighterIds: [long] });
    expect(result.fighters).toHaveLength(1);
    expect(result.fighters[0].id.length).toBeLessThanOrEqual(ID_MAX);
    expect(validateFighter(result.fighters[0]).issues.filter((i) => i.path === 'id')).toEqual([]);
  });

  it('DQ, escaped and separated are labelled apart from draws, and a DQ win is not a decision', () => {
    expect(methodClass('dq')).toBe('other');
    expect(methodClass('escaped')).toBe('other');
    expect(methodClass('separated')).toBe('other');
    expect(methodClass('draw')).toBe('draw');
    expect(methodClass('noContest')).toBe('draw');
    const line = { sigL: 0, sigA: 0, kd: 0, tdL: 0, tdA: 0, sub: 0, ctrl: 0 };
    const s = (index: number, winner: BoutSummary['winner'], method: BoutSummary['method']): BoutSummary => ({
      index, winner, method, round: 1, totalSeconds: 100, digest: String(index), f: [line, line],
    });
    const agg = aggregate([s(0, 0, 'dq'), s(1, 1, 'decision.unanimous'), s(2, 'draw', 'draw')]);
    expect(agg.decisions).toBe(1);
    expect(agg.methodMix.other).toBeCloseTo(1 / 3);
    expect(agg.methodMix.draw).toBeCloseTo(1 / 3);
    expect(agg.fighters[0].methods.other).toBe(1);
    expect(agg.fighters[0].methods.draw).toBe(0);
  });

  it('cancelling a main-thread batch stops between bouts', async () => {
    const template: Omit<SimConfig, 'seed'> = {
      mode: '1v1',
      fighters: [ARCHETYPES['arch.regional_pro_allrounder'], { ...ARCHETYPES['arch.thai_striker'] }],
      teams: { teamOf: [0, 1] },
      ruleset: 'mma.unified.3r',
      arena: 'octagon_30',
      settings: { ...DEFAULT_SETTINGS, rounds: 1, roundSeconds: 25 },
    };
    counter.results = 0;
    let cancel = (): void => undefined;
    const h = runBatch({ template, master: 'cancel-main', bouts: 8 }, {
      workerFactory: null, chunkSize: 8, onSummary: () => cancel(),
    });
    cancel = h.cancel;
    const out = await h.promise;
    expect(out.cancelled).toBe(true);
    expect(out.ranOn).toBe('main');
    // Give a runaway chunk time to keep going if it were going to.
    await new Promise((r) => setTimeout(r, 400));
    expect(counter.results).toBeGreaterThanOrEqual(1);
    expect(counter.results).toBeLessThanOrEqual(2);
  });

  it('the batch CLI usage text shows the real affinity default', () => {
    const src = readFileSync('scripts/batch/run.ts', 'utf8');
    expect(src).toContain('[--affinity 1F]');
    expect(src).not.toContain('[--affinity 3F]');
    expect(src).toMatch(/affinity: str\(args, 'affinity', '1F'\)/);
  });
});
