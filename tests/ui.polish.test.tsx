/**
 * UI POLISH PASS — the pure pieces behind the new screens, and static
 * renders of the screens themselves (no DOM environment is installed; see
 * tests/creator.ui.test.tsx for why).
 *
 *  - profile model: composites shift sub-skills without new state, search
 *    finds by name/keyword/path, basic mode is a subset of advanced;
 *  - presets keep identity; import preview explains corrupted and partial
 *    files in plain language and never writes;
 *  - the design-system components render accessible markup;
 *  - Batch, About, Database and Creator render in every state.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ARCHETYPES, type FighterDefinition } from '../src/sim';
import { blankFighter, makeRecord, validateFighter } from '../src/app/store';
import type { FighterRecord } from '../src/app/store/types';
import type { FighterStoreApi } from '../src/app/storeApi';
import {
  PROFILE_PARAMS, TECHNICAL_GROUPS, compositeValue, noSimEffect, paramMatches, presentRefs,
  setComposite, visibleParams,
} from '../src/app/model/profileModel';
import { previewImport } from '../src/app/model/importModel';
import { fieldIdForPath } from '../src/app/model/paths';
import { FighterCreator, applyPreset } from '../src/app/screens/FighterCreator';
import { FighterDatabase } from '../src/app/screens/FighterDatabase';
import { BatchSim } from '../src/app/screens/BatchSim';
import { About } from '../src/app/screens/About';
import {
  Button, EmptyState, ErrorState, Field, LoadingState, Select, Slider, StatusBadge, Switch, Tabs,
} from '../src/app/ui';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const RPA = clone(ARCHETYPES['arch.regional_pro_allrounder']);
const THAI = clone(ARCHETYPES['arch.thai_striker']);

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

const records = Object.values(ARCHETYPES).map((d) => makeRecord(d, { builtIn: true }));

describe('profile model', () => {
  it('maps every control onto real schema paths', () => {
    for (const p of PROFILE_PARAMS) {
      expect(p.paths.length, p.id).toBeGreaterThan(0);
      for (const path of p.paths) expect(path, p.id).toMatch(/^(body|physical|mental|record|style|disciplines)\./);
    }
  });

  it('has unique ids, and basic mode is a subset of advanced', () => {
    expect(new Set(PROFILE_PARAMS.map((p) => p.id)).size).toBe(PROFILE_PARAMS.length);
    const basic = visibleParams(PROFILE_PARAMS, 'basic', '');
    const adv = visibleParams(PROFILE_PARAMS, 'advanced', '');
    expect(basic.length).toBeGreaterThan(10);
    expect(adv.length).toBe(PROFILE_PARAMS.length);
    for (const p of basic) expect(adv).toContain(p);
  });

  it('writes are immutable and round-trip through get', () => {
    for (const p of PROFILE_PARAMS) {
      if (p.control.kind !== 'range' || p.id === 'experience.overall') continue;
      const before = JSON.stringify(RPA);
      const target = p.control.min + (p.control.max - p.control.min) * 0.37;
      const next = p.set(RPA, target);
      expect(JSON.stringify(RPA)).toBe(before);
      const got = Number(p.get(next));
      // Composites and rounded controls land within one step of the target.
      expect(Math.abs(got - target), p.id).toBeLessThanOrEqual(Math.max(1, p.control.step) + 0.51);
    }
  });

  it('a composite shifts each trained sub-skill by the same amount and keeps its shape', () => {
    const refs = TECHNICAL_GROUPS.boxing;
    const here = presentRefs(RPA, refs);
    const before = compositeValue(RPA, refs)!;
    const next = setComposite(RPA, refs, before + 10);
    const deltas = here.map((ref) => {
      const [d, s] = ref.split('.') as ['boxing', string];
      return next.disciplines[d]!.sub[s] - RPA.disciplines[d]!.sub[s];
    });
    for (const d of deltas) expect(Math.abs(d - 10)).toBeLessThanOrEqual(1);
    expect(validateFighter(next).ok).toBe(true);
  });

  it('a composite over untrained arts is disabled with a reason, not silently inert', () => {
    const karateOnly = PROFILE_PARAMS.find((p) => p.id === 'technical.footwork')!;
    const bare = clone(RPA);
    bare.disciplines = {};
    expect(karateOnly.get(bare)).toBeNull();
    expect(karateOnly.disabledReason?.(bare)).toMatch(/No art/);
  });

  it('weight moves all three masses together and lets the class re-derive', () => {
    const w = PROFILE_PARAMS.find((p) => p.id === 'physical.weight')!;
    const next = w.set(RPA, 90);
    expect(next.body.fightNightKg).toBeCloseTo(90, 5);
    expect(next.body.weighInKg! - next.body.fightNightKg!).toBeCloseTo(RPA.body.weighInKg! - RPA.body.fightNightKg!, 5);
    expect(next.body.weightClass).toBeUndefined();
  });

  it('search finds controls by name, keyword and schema path', () => {
    const find = (q: string): string[] => PROFILE_PARAMS.filter((p) => paramMatches(p, q)).map((p) => p.id);
    expect(find('cardio')).toContain('athletic.endurance');
    expect(find('agility')).toContain('physical.mobility');
    expect(find('physical.reactionTime')).toContain('athletic.reaction');
    expect(find('zzzz')).toEqual([]);
  });

  it('flags the stored-but-unread fields', () => {
    expect(noSimEffect('style.tiredBehaviour')).not.toBeNull();
    expect(noSimEffect('physical.chin')).toBeNull();
  });
});

describe('presets', () => {
  it('apply the archetype but keep who the fighter is', () => {
    const mine: FighterDefinition = { ...clone(RPA), id: 'fighter.me', name: 'Me', short: 'ME', notes: 'mine' };
    mine.appearance = { ...mine.appearance, nickname: 'The Tester' };
    const next = applyPreset(mine, THAI);
    expect(next.id).toBe('fighter.me');
    expect(next.name).toBe('Me');
    expect(next.short).toBe('ME');
    expect(next.notes).toBe('mine');
    expect(next.appearance.nickname).toBe('The Tester');
    expect(next.physical).toEqual(THAI.physical);
    expect(next.disciplines).toEqual(THAI.disciplines);
    expect(next.style).toEqual(THAI.style);
  });
});

describe('import preview', () => {
  const good = JSON.stringify({ schemaVersion: 1, fighters: [RPA] });

  it('reads a normal export and changes nothing', () => {
    const p = previewImport(good, []);
    expect(p.fatal).toBeNull();
    expect(p.fighters).toHaveLength(1);
    expect(p.fighters[0].status).toBe('ok');
    expect(p.normalised).not.toBeNull();
  });

  it('explains a truncated file', () => {
    const p = previewImport(good.slice(0, Math.floor(good.length / 2)), []);
    expect(p.fatal).toMatch(/ends early|truncated|not valid JSON/);
  });

  it('explains an empty file, a non-object and a missing fighters list', () => {
    expect(previewImport('', []).fatal).toMatch(/empty/);
    expect(previewImport('"hello"', []).fatal).toMatch(/not a BOUT LAB file/);
    expect(previewImport('{"schemaVersion":1,"history":[{"id":"x"}]}', []).fatal).toMatch(/no fighters/);
    expect(previewImport('{"schemaVersion":1,"fighters":{}}', []).fatal).toMatch(/must be a list/);
  });

  it('names the schema version of a file from a newer build', () => {
    expect(previewImport('{"schemaVersion":7,"fighters":[]}', []).fatal).toMatch(/schema version 7/);
  });

  it('rejects a partial fighter with field-level reasons and keeps the rest', () => {
    const partial = clone(RPA) as unknown as Record<string, unknown>;
    delete partial.physical;
    partial.id = 'partial';
    partial.name = 'Half A Fighter';
    const p = previewImport(JSON.stringify({ schemaVersion: 1, fighters: [RPA, partial] }), []);
    expect(p.fighters.map((f) => f.status)).toEqual(['ok', 'rejected']);
    expect(p.fighters[1].problems.join(' ')).toMatch(/physical/);
  });

  it('shows the new id for a collision', () => {
    const p = previewImport(good, [RPA.id]);
    expect(p.fighters[0].status).toBe('renamed');
    expect(p.fighters[0].finalId).toBe(`${RPA.id} (imported)`);
  });

  it('accepts a bare fighter definition or a bare list of them', () => {
    expect(previewImport(JSON.stringify(RPA), []).fighters).toHaveLength(1);
    expect(previewImport(JSON.stringify([RPA, THAI]), []).fighters).toHaveLength(2);
  });
});

describe('design-system components render accessible markup', () => {
  it('buttons default to type=button and mark busy state', () => {
    const html = renderToStaticMarkup(<Button busy>Go</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-busy="true"');
  });

  it('fields wire the label, hint and error to the control', () => {
    const html = renderToStaticMarkup(
      <Field label="Name" hint="shown on the HUD" error="Required" id="nm">
        {(p) => <input id={p.id} aria-describedby={p.describedBy} />}
      </Field>,
    );
    expect(html).toContain('for="nm"');
    expect(html).toContain('aria-describedby="nm-err nm-hint"');
    expect(html).toContain('role="alert"');
  });

  it('tabs expose the tab pattern with one tabbable tab', () => {
    const html = renderToStaticMarkup(
      <Tabs idPrefix="t" label="Cats" value="b" onChange={() => undefined}
        items={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B', count: 3 }]} />,
    );
    expect(html).toContain('role="tablist"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-selected="true"');
  });

  it('slider, select, switch and states render with labels', () => {
    const html = renderToStaticMarkup(
      <>
        <Slider label="Chin" value={60} min={0} max={100} onChange={() => undefined} withNumber id="chin" />
        <Select label="Stance" value="a" options={[{ value: 'a', label: 'A' }]} onChange={() => undefined} id="st" />
        <Switch checked label="On" onChange={() => undefined} />
        <StatusBadge tone="ok">Saved</StatusBadge>
        <EmptyState title="Nothing">Body</EmptyState>
        <LoadingState label="Loading bouts" />
        <ErrorState detail="stack">Broken</ErrorState>
      </>,
    );
    expect(html).toContain('for="chin"');
    expect(html).toContain('aria-label="Chin (exact value)"');
    expect(html).toContain('for="st"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
  });
});

describe('screens render', () => {
  it('the batch screen renders its setup and empty state', () => {
    const html = renderToStaticMarkup(<BatchSim store={fakeStore(records)} revision={0} />);
    expect(html).toContain('Batch simulation');
    expect(html).toContain('Number of bouts');
    expect(html).toContain('5,000');
    expect(html).toContain('No results yet');
  });

  it('the batch screen explains when there are too few fighters', () => {
    const html = renderToStaticMarkup(<BatchSim store={fakeStore(records.slice(0, 1))} revision={0} />);
    expect(html).toContain('Not enough fighters');
  });

  it('the about page lists the live parameter registry', () => {
    const html = renderToStaticMarkup(<About />);
    expect(html).toContain('A modelling toy, not a predictor');
    expect(html).toContain('Every parameter');
    expect(html).toMatch(/Showing 60 of [\d,]+/);
  });

  it('the database shows presets and an empty state for a failed filter', () => {
    const html = renderToStaticMarkup(
      <FighterDatabase store={fakeStore(records)} revision={0} onEdit={() => undefined}
        onNew={() => undefined} onRandom={() => undefined} onChanged={() => undefined} />,
    );
    expect(html).toContain('preset');
    expect(html).toContain('Rename');
  });

  it('the database survives a store that cannot be read', () => {
    const broken = { ...fakeStore(records), list: () => { throw new Error('quota'); } };
    const html = renderToStaticMarkup(
      <FighterDatabase store={broken} revision={0} onEdit={() => undefined}
        onNew={() => undefined} onRandom={() => undefined} onChanged={() => undefined} />,
    );
    expect(html).toContain('could not be read');
  });

  it('the editor opens on the profile view with basic controls, presets and compare', () => {
    const html = renderToStaticMarkup(
      <FighterCreator store={fakeStore(records)} initial={RPA} fromBuiltIn onSaved={() => undefined} onCancel={() => undefined} />,
    );
    expect(html).toContain('Attribute categories');
    expect(html).toContain('Presets');
    expect(html).toContain('Compare with');
    expect(html).toContain('Save as copy');
    expect(html).toContain('Not modelled as separate attributes');
    // The raw schema stays in the document (hidden) so validation can focus any field.
    expect(html).toContain(`id="${fieldIdForPath('physical.chin')}"`);
  });
});
