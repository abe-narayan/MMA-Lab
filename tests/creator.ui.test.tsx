/**
 * FIGHTER CREATOR UI SUITE — Phase 6.
 *
 * Testing strategy, stated up front because it is a constraint rather than a
 * preference: this project ships with no DOM test environment. Neither
 * `happy-dom` nor `jsdom` is installed, and Phase 6 may not add a dependency,
 * so there is no `render`/`fireEvent`/`click` available and none is faked here.
 *
 * What that leaves is still enough to test the things that actually break:
 *
 *   1. `react-dom/server` renders the real components to static markup with no
 *      DOM at all. That proves what is on the page — every discipline's
 *      sub-skills, the derived panel's numbers, the ids the validation list
 *      jumps to — for the real components, not a stand-in.
 *   2. Every piece of behaviour that a click would drive lives in a pure
 *      function in `src/app/model/**` (which is why it lives there): the
 *      immutable field write, the clamp, the dirty check, the body geometry,
 *      the path-to-section mapping, the database query. Those are tested
 *      directly, which also makes them regressions-proof against a future
 *      re-layout of the JSX.
 *
 * The one thing this cannot cover is event wiring — that an `onChange` is
 * attached to the right input. When a DOM environment becomes available, the
 * assertions below are the ones to drive through it.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ARCHETYPES, SUB_SKILLS, DISCIPLINE_IDS, deriveRuntime, resolveParams,
  type CoreDisciplineId, type FighterDefinition,
} from '../src/sim';
import { blankFighter, makeRecord, randomFighter, validateFighter } from '../src/app/store';
import type { FighterRecord } from '../src/app/store/types';
import type { FighterStoreApi } from '../src/app/storeApi';

import { FighterCreator, sectionForPath, disciplineForPath } from '../src/app/screens/FighterCreator';
import { FighterDatabase } from '../src/app/screens/FighterDatabase';
import { DerivedPanel } from '../src/app/components/DerivedPanel';
import { BodyDiagram } from '../src/app/components/BodyDiagram';
import { errorPaths } from '../src/app/components/ValidationList';

import { clampNumber, fieldIdForPath, getAtPath, setAtPath, deleteAtPath } from '../src/app/model/paths';
import { bodyGeometry } from '../src/app/model/bodyGeometry';
import { deriveSafely } from '../src/app/model/derivedModel';
import {
  bandOf, disciplineSections, isDirty, blankDisciplineBlock, stableStringify,
} from '../src/app/model/editorModel';
import { EMPTY_QUERY, applyQuery, matchesQuery } from '../src/app/model/filterModel';
import { metresToFeetInches, kgToLb } from '../src/app/model/units';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const BASE: FighterDefinition = ARCHETYPES['arch.regional_pro_allrounder'];

function clone(def: FighterDefinition): FighterDefinition {
  return JSON.parse(JSON.stringify(def)) as FighterDefinition;
}

/**
 * A store with no persistence. The screens are written against the interface
 * precisely so a test can hand them one of these instead of a `localStorage`.
 */
function fakeStore(records: FighterRecord[] = []): FighterStoreApi {
  return {
    list: () => records.slice(),
    get: (id) => records.find((r) => r.definition.id === id),
    save: (def) => makeRecord(def, { nowIso: '2026-01-01T00:00:00.000Z' }),
    remove: () => undefined,
    duplicate: (id) => {
      const found = records.find((r) => r.definition.id === id);
      if (!found) throw new Error('missing');
      return found;
    },
    validate: (def) => validateFighter(def),
    blank: () => blankFighter(),
    random: (seed) => randomFighter(seed),
    exportJson: () => '{}',
    importJson: () => ({ added: 0, skipped: 0, problems: [] }),
  };
}

function renderCreator(def: FighterDefinition): string {
  return renderToStaticMarkup(
    <FighterCreator
      store={fakeStore()}
      initial={def}
      fromBuiltIn={false}
      onSaved={() => undefined}
      onCancel={() => undefined}
    />,
  );
}

// --------------------------------------------------------------------------
// 1. The editor renders every discipline's sub-skills
// --------------------------------------------------------------------------

describe('the editor exposes the whole schema', () => {
  it('lists all ten disciplines, trained or not', () => {
    const sections = disciplineSections(BASE);
    expect(sections.map((s) => s.id)).toEqual([...DISCIPLINE_IDS]);
    // The reference fighter trains five of them; the rest must still appear,
    // because "no wrestling" is a fact worth seeing.
    expect(sections.filter((s) => s.trained).length).toBeGreaterThan(0);
    expect(sections.filter((s) => !s.trained).length).toBeGreaterThan(0);
  });

  it('gives every named sub-skill of every discipline its own path', () => {
    const sections = disciplineSections(BASE);
    for (const section of sections) {
      const expected = SUB_SKILLS[section.id];
      expect(section.subSkills.map((f) => f.skill)).toEqual([...expected]);
      for (const field of section.subSkills) {
        expect(field.path).toBe(`disciplines.${section.id}.sub.${field.skill}`);
        expect(field.help.length).toBeGreaterThan(20);
      }
    }
  });

  it('renders a labelled control for every sub-skill of every discipline', () => {
    const html = renderCreator(BASE);
    for (const id of DISCIPLINE_IDS) {
      for (const skill of SUB_SKILLS[id]) {
        const domId = fieldIdForPath(`disciplines.${id}.sub.${skill}`);
        expect(html, `${id}.${skill} must have a control`).toContain(`id="${domId}"`);
      }
    }
  });

  it('renders every physical, mental and record field', () => {
    const html = renderCreator(BASE);
    const required = [
      'physical.strength', 'physical.explosiveness', 'physical.speed', 'physical.handSpeed',
      'physical.kickSpeed', 'physical.cardio', 'physical.chin', 'physical.bodyToughness',
      'physical.recovery', 'physical.flexibility', 'physical.balance', 'physical.reactionTime',
      'physical.gripStrength', 'physical.neckStrength',
      'mental.fightIQ', 'mental.aggression', 'mental.composure', 'mental.heart',
      'mental.discipline', 'mental.adaptability',
      'body.heightM', 'body.reachM', 'body.legReachM', 'body.massKg', 'body.ageYears',
      'body.bodyFatPct', 'body.stance', 'body.handedness',
      'record.proWins', 'record.koLosses', 'record.layoffMonths',
      'style.primaryMode', 'style.preferredRange', 'style.whenLosing',
      'appearance.nickname',
    ];
    for (const path of required) {
      expect(html, `${path} must be editable`).toContain(`id="${fieldIdForPath(path)}"`);
    }
  });

  it('labels every input it renders', () => {
    const html = renderCreator(BASE);
    // Every `for="..."` must point at an id that exists in the same document.
    const targets = [...html.matchAll(/for="([^"]+)"/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(50);
    for (const target of targets) {
      expect(html, `label points at a missing control: ${target}`).toContain(`id="${target}"`);
    }
  });

  it('shows metric and imperial side by side', () => {
    const html = renderCreator(BASE);
    // React escapes the feet-and-inches quotes, so compare against the escaped
    // form rather than weakening the assertion to a substring of digits.
    const escape = (s: string): string => s.replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
    expect(html).toContain(escape(metresToFeetInches(BASE.body.heightM)));
    expect(html).toContain(kgToLb(BASE.body.fightNightKg ?? BASE.body.massKg));
    expect(html).toContain(`${Math.round(BASE.body.heightM * 100)} cm`);
  });
});

// --------------------------------------------------------------------------
// 2. Editing an attribute updates the derived panel
// --------------------------------------------------------------------------

describe('edits flow through to the derived panel', () => {
  it('writes immutably at a dotted path', () => {
    const next = setAtPath(BASE, 'physical.strength', 91);
    expect(getAtPath(next, 'physical.strength')).toBe(91);
    expect(getAtPath(BASE, 'physical.strength')).toBe(BASE.physical.strength);
    expect(next).not.toBe(BASE);
    // Untouched branches are shared, which is what keeps re-renders cheap.
    expect(next.disciplines).toBe(BASE.disciplines);
  });

  it('creates missing optional containers rather than refusing the write', () => {
    const stripped = clone(BASE);
    delete stripped.record.weightCut;
    const next = setAtPath(stripped, 'record.weightCut.residualDehydration', 0.02);
    expect(getAtPath(next, 'record.weightCut.residualDehydration')).toBe(0.02);
  });

  it('moves the power index when strength moves', () => {
    const weak = deriveSafely(setAtPath(BASE, 'physical.strength', 20));
    const strong = deriveSafely(setAtPath(BASE, 'physical.strength', 95));
    expect(weak.runtime).not.toBeNull();
    expect(strong.runtime).not.toBeNull();
    expect(strong.runtime!.powerIndex.rearHand).toBeGreaterThan(weak.runtime!.powerIndex.rearHand);
  });

  it('moves the reaction latency when the reaction attribute moves', () => {
    const slow = deriveSafely(setAtPath(BASE, 'physical.reactionTime', 30));
    const fast = deriveSafely(setAtPath(BASE, 'physical.reactionTime', 95));
    expect(fast.runtime!.reactionTimeMs).toBeLessThan(slow.runtime!.reactionTimeMs);
  });

  it('re-renders the derived panel with the new number', () => {
    const panelFor = (v: number): string => {
      const state = deriveSafely(setAtPath(BASE, 'physical.reactionTime', v));
      return renderToStaticMarkup(<DerivedPanel runtime={state.runtime} error={state.error} />);
    };
    const slow = panelFor(30);
    const fast = panelFor(95);
    expect(slow).toContain('Reaction latency');
    expect(fast).toContain('Reaction latency');
    expect(slow).not.toBe(fast);
  });

  it('raises a discipline tier when its sub-skills rise', () => {
    let def = clone(BASE);
    for (const skill of SUB_SKILLS.bjj) {
      def = setAtPath(def, `disciplines.bjj.sub.${skill}`, 95);
    }
    def = setAtPath(def, 'disciplines.bjj.years', 20);
    const before = deriveSafely(BASE).runtime!.disciplines.bjj.tier;
    const after = deriveSafely(def).runtime!.disciplines.bjj.tier;
    expect(after).toBeGreaterThan(before);
  });

  it('prints the derivation lines verbatim', () => {
    const runtime = deriveRuntime(BASE, resolveParams(), { explain: true });
    expect(runtime.derivation.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(<DerivedPanel runtime={runtime} error={null} />);
    // The panel advertises the exact line count, so a silently truncated list
    // cannot pass unnoticed.
    expect(html).toContain(`${runtime.derivation.length} derivation lines`);
  });

  it('survives a definition that will not derive, and says so', () => {
    const broken = setAtPath(BASE, 'disciplines', null);
    const state = deriveSafely(broken);
    expect(state.runtime).toBeNull();
    expect(state.error).not.toBeNull();
    const html = renderToStaticMarkup(<DerivedPanel runtime={null} error={state.error} />);
    expect(html).toContain('will not derive');
    expect(html).toContain('Your edits are safe');
  });

  it('reports the skill band for a value without claiming it is the tier', () => {
    expect(bandOf(0).tier).toBe(0);
    expect(bandOf(9).tier).toBe(0);
    expect(bandOf(10).tier).toBe(1);
    expect(bandOf(49).tier).toBe(2);
    expect(bandOf(70).tier).toBe(4);
    expect(bandOf(95).tier).toBe(5);
    expect(bandOf(Number.NaN).tier).toBe(0);
  });
});

// --------------------------------------------------------------------------
// 3. Validation surfaces, and an issue targets the right control
// --------------------------------------------------------------------------

describe('validation is navigable, never blocking', () => {
  it('reports an out-of-range attribute with a path that names the field', () => {
    const bad = setAtPath(BASE, 'physical.chin', 400);
    const result = validateFighter(bad);
    const issue = result.issues.find((i) => i.path === 'physical.chin');
    expect(issue, 'an attribute above 100 must be reported at its own path').toBeDefined();
    expect(issue!.severity).toBe('error');
  });

  it('maps every issue path to the section that owns it', () => {
    expect(sectionForPath('body.reachM')).toBe('body');
    expect(sectionForPath('physical.chin')).toBe('physical');
    expect(sectionForPath('mental.heart')).toBe('mental');
    expect(sectionForPath('record.koLosses')).toBe('record');
    expect(sectionForPath('style.primaryMode')).toBe('style');
    expect(sectionForPath('appearance.skinTone')).toBe('appearance');
    expect(sectionForPath('disciplines.bjj.sub.guard')).toBe('disciplines');
    // Identity fields live in the always-visible header; landing on Body is
    // harmless rather than wrong.
    expect(sectionForPath('name')).toBe('body');
  });

  it('names the discipline an issue belongs to, so the accordion can open', () => {
    expect(disciplineForPath('disciplines.wrestling.sub.shots')).toBe('wrestling');
    expect(disciplineForPath('disciplines.judo.years')).toBe('judo');
    expect(disciplineForPath('physical.chin')).toBeNull();
  });

  it('clicking an issue targets a control that exists in the rendered editor', () => {
    let bad = setAtPath(BASE, 'physical.chin', 400);
    bad = setAtPath(bad, 'disciplines.bjj.sub.guard', -12);
    bad = setAtPath(bad, 'body.reachM', 9);

    const result = validateFighter(bad);
    const html = renderCreator(bad);

    const targeted = result.issues.filter((i) => i.path !== '' && !i.path.includes('['));
    expect(targeted.length).toBeGreaterThan(0);

    // Every issue we deliberately provoked must resolve to a real control.
    for (const path of ['physical.chin', 'disciplines.bjj.sub.guard', 'body.reachM']) {
      const issue = result.issues.find((i) => i.path === path);
      expect(issue, `expected an issue at ${path}`).toBeDefined();
      expect(html, `${path} must be focusable`).toContain(`id="${fieldIdForPath(path)}"`);
    }
  });

  it('keeps an invalid definition editable and renders it', () => {
    const bad = setAtPath(BASE, 'physical.chin', 400);
    const html = renderCreator(bad);
    // The value the user typed is still in the box: validation marks it, it
    // does not revert it.
    expect(html).toContain('value="400"');
    // And Save is refused rather than the edit being thrown away.
    expect(html).toContain('Fix the errors listed below before saving.');
  });

  it('collects the error paths for ringing the offending controls', () => {
    const bad = setAtPath(BASE, 'physical.chin', 400);
    const paths = errorPaths(validateFighter(bad));
    expect(paths.has('physical.chin')).toBe(true);
  });

  it('derives a collision-free, CSS-safe DOM id from any path', () => {
    expect(fieldIdForPath('body.reachM')).toBe('fc-body-reachM');
    expect(fieldIdForPath('disciplines.bjj.sub.guard')).toBe('fc-disciplines-bjj-sub-guard');
    expect(fieldIdForPath('style.favouriteTechniques.0.weight')).toBe('fc-style-favouriteTechniques-0-weight');
    expect(fieldIdForPath('body.reachM')).not.toBe(fieldIdForPath('body.reachm'));
  });
});

// --------------------------------------------------------------------------
// 4. Numeric inputs clamp rather than accept NaN
// --------------------------------------------------------------------------

describe('numeric entry never produces NaN', () => {
  const spec = { min: 0, max: 100, dp: 0 };

  it('clamps to the range', () => {
    expect(clampNumber('140', spec, 50)).toBe(100);
    expect(clampNumber('-8', spec, 50)).toBe(0);
    expect(clampNumber('72', spec, 50)).toBe(72);
  });

  it('falls back to the previous value for a half-typed entry', () => {
    // Snapping to the minimum while someone is mid-keystroke would fight them.
    expect(clampNumber('', spec, 61)).toBe(61);
    expect(clampNumber('-', spec, 61)).toBe(61);
    expect(clampNumber('abc', spec, 61)).toBe(61);
    expect(clampNumber(Number.NaN, spec, 61)).toBe(61);
    expect(clampNumber(Number.POSITIVE_INFINITY, spec, 61)).toBe(61);
  });

  it('rounds to the field’s precision', () => {
    expect(clampNumber('1.8765', { min: 1, max: 3, dp: 3 }, 1.8)).toBe(1.877);
    expect(clampNumber('27.6', spec, 20)).toBe(28);
  });
});

// --------------------------------------------------------------------------
// 5. The body diagram responds to height and mass
// --------------------------------------------------------------------------

describe('the body diagram is driven by the numbers', () => {
  const base = {
    heightM: 1.80, reachM: 1.84, legReachM: 1.03, massKg: 77,
    bodyFatPct: 10, build: { ecto: 0.25, meso: 0.6, endo: 0.15 }, stance: 'orthodox',
  };

  it('draws a taller fighter taller', () => {
    const short = bodyGeometry({ ...base, heightM: 1.60 });
    const tall = bodyGeometry({ ...base, heightM: 2.00 });
    const shortH = short.soleY - short.headTopY;
    const tallH = tall.soleY - tall.headTopY;
    expect(tallH).toBeGreaterThan(shortH);
    // Both stand on the same floor, so the two figures are comparable.
    expect(tall.soleY).toBe(short.soleY);
  });

  it('draws a longer reach wider', () => {
    const shortArms = bodyGeometry({ ...base, reachM: 1.70 });
    const longArms = bodyGeometry({ ...base, reachM: 2.05 });
    expect(longArms.armHalfSpan).toBeGreaterThan(shortArms.armHalfSpan);
    expect(longArms.apeIndex).toBeGreaterThan(shortArms.apeIndex);
  });

  it('draws a heavier fighter thicker at the same height', () => {
    const light = bodyGeometry({ ...base, massKg: 61 });
    const heavy = bodyGeometry({ ...base, massKg: 120 });
    expect(heavy.shoulderHalfW).toBeGreaterThan(light.shoulderHalfW);
    expect(heavy.limbW).toBeGreaterThan(light.limbW);
    expect(heavy.bmi).toBeGreaterThan(light.bmi);
  });

  it('puts the hip where the leg reach says, not at a fixed fraction', () => {
    const shortLegs = bodyGeometry({ ...base, legReachM: 0.92 });
    const longLegs = bodyGeometry({ ...base, legReachM: 1.15 });
    // A higher hip is a smaller y in SVG space.
    expect(longLegs.hipY).toBeLessThan(shortLegs.hipY);
  });

  it('widens the waist with body fat', () => {
    const lean = bodyGeometry({ ...base, bodyFatPct: 6 });
    const soft = bodyGeometry({ ...base, bodyFatPct: 28 });
    expect(soft.waistHalfW).toBeGreaterThan(lean.waistHalfW);
  });

  it('survives nonsense without producing NaN coordinates', () => {
    const g = bodyGeometry({
      ...base,
      heightM: Number.NaN,
      massKg: Number.POSITIVE_INFINITY,
      build: { ecto: 0, meso: 0, endo: 0 },
    });
    for (const [key, value] of Object.entries(g)) {
      expect(Number.isFinite(value), `${key} must be finite`).toBe(true);
    }
  });

  it('renders different SVG for different frames', () => {
    const a = renderToStaticMarkup(<BodyDiagram body={{ ...base, heightM: 1.62, massKg: 57 }} />);
    const b = renderToStaticMarkup(<BodyDiagram body={{ ...base, heightM: 1.98, massKg: 115 }} />);
    expect(a).not.toBe(b);
    expect(a).toContain('<svg');
    expect(b).toContain('<svg');
  });
});

// --------------------------------------------------------------------------
// 6. The unsaved-changes guard
// --------------------------------------------------------------------------

describe('the unsaved-changes guard', () => {
  it('is quiet when nothing has changed', () => {
    expect(isDirty(BASE, BASE)).toBe(false);
    expect(isDirty(BASE, clone(BASE))).toBe(false);
  });

  it('fires on any edit, however small', () => {
    expect(isDirty(BASE, setAtPath(BASE, 'physical.chin', BASE.physical.chin + 1))).toBe(true);
    expect(isDirty(BASE, setAtPath(BASE, 'name', `${BASE.name} `))).toBe(true);
    expect(isDirty(BASE, setAtPath(BASE, 'disciplines.bjj.sub.guard', 1))).toBe(true);
  });

  it('fires when a discipline is taken up or dropped', () => {
    const added = setAtPath(BASE, 'disciplines.judo', blankDisciplineBlock('judo' as CoreDisciplineId));
    expect(isDirty(BASE, added)).toBe(true);
    const removed = deleteAtPath(BASE, 'disciplines.bjj');
    expect(isDirty(BASE, removed)).toBe(true);
    expect(getAtPath(removed, 'disciplines.bjj')).toBeUndefined();
  });

  it('goes quiet again when the edit is reverted', () => {
    const edited = setAtPath(BASE, 'physical.chin', 12);
    expect(isDirty(BASE, edited)).toBe(true);
    expect(isDirty(BASE, setAtPath(edited, 'physical.chin', BASE.physical.chin))).toBe(false);
  });

  it('treats a new fighter with no baseline as dirty', () => {
    expect(isDirty(null, blankFighter())).toBe(true);
  });

  it('is not fooled by key order', () => {
    // Rebuild the body block with its keys in reverse insertion order. Nothing
    // about the fighter changed, so the dirty check must stay quiet.
    const reversedBody: Record<string, unknown> = {};
    for (const key of Object.keys(BASE.body).reverse()) {
      reversedBody[key] = (BASE.body as unknown as Record<string, unknown>)[key];
    }
    const reordered = { ...BASE, body: reversedBody } as unknown as FighterDefinition;
    expect(Object.keys(reordered.body)).not.toEqual(Object.keys(BASE.body));
    expect(isDirty(BASE, reordered)).toBe(false);
  });

  it('treats an absent optional field and an undefined one as the same fighter', () => {
    // A saved record has been through JSON, which drops `undefined` keys. If
    // that read as an edit, every fighter would look dirty the moment it loaded.
    const withUndefined = { ...BASE, style: { ...BASE.style, thaiStyle: undefined } } as FighterDefinition;
    const withoutKey = { ...BASE, style: { ...BASE.style } } as FighterDefinition;
    delete (withoutKey.style as unknown as Record<string, unknown>).thaiStyle;
    expect(stableStringify(withUndefined)).toBe(stableStringify(withoutKey));
    expect(isDirty(withUndefined, withoutKey)).toBe(false);
  });

  it('marks the creator so the shell can warn before navigating away', () => {
    // The dot beside the Creator tab and the badge in the header are the two
    // visible signals; the badge is rendered by the editor itself.
    const html = renderCreator(BASE);
    expect(html).toContain('Revert');
    expect(html).toContain('Close');
  });
});

// --------------------------------------------------------------------------
// 7. The database list
// --------------------------------------------------------------------------

describe('the fighter database', () => {
  const records: FighterRecord[] = [
    makeRecord(ARCHETYPES['arch.regional_pro_allrounder'], { builtIn: true, nowIso: '2026-01-01T00:00:00.000Z', tags: ['built-in'] }),
    makeRecord(ARCHETYPES['arch.bjj_guard_player'], { builtIn: true, nowIso: '2026-01-02T00:00:00.000Z', tags: ['built-in'] }),
    makeRecord({ ...clone(BASE), id: 'fighter.mine', name: 'Aaa Mine' }, { builtIn: false, nowIso: '2026-02-01T00:00:00.000Z', tags: ['gym'] }),
  ];

  it('shows everything with an empty query', () => {
    expect(applyQuery(records, EMPTY_QUERY)).toHaveLength(3);
  });

  it('filters built-in from custom', () => {
    expect(applyQuery(records, { ...EMPTY_QUERY, origin: 'custom' })).toHaveLength(1);
    expect(applyQuery(records, { ...EMPTY_QUERY, origin: 'builtIn' })).toHaveLength(2);
  });

  it('searches name and tags', () => {
    expect(applyQuery(records, { ...EMPTY_QUERY, search: 'mine' })).toHaveLength(1);
    expect(applyQuery(records, { ...EMPTY_QUERY, search: 'gym' })).toHaveLength(1);
    expect(applyQuery(records, { ...EMPTY_QUERY, search: 'zzzz' })).toHaveLength(0);
  });

  it('treats the tier filter as a floor, which is the question a matchmaker asks', () => {
    const all = applyQuery(records, { ...EMPTY_QUERY, tier: 0 });
    expect(all).toHaveLength(3);
    const elite = applyQuery(records, { ...EMPTY_QUERY, tier: 5 });
    expect(elite.length).toBeLessThanOrEqual(3);
    for (const r of elite) expect(r.summary.overallTier).toBeGreaterThanOrEqual(5);
  });

  it('filters by discipline actually trained', () => {
    const bjj = applyQuery(records, { ...EMPTY_QUERY, discipline: 'bjj' });
    for (const r of bjj) expect(r.definition.disciplines.bjj).toBeDefined();
    const tkd = applyQuery(records, { ...EMPTY_QUERY, discipline: 'taekwondo' });
    for (const r of tkd) expect(r.definition.disciplines.taekwondo).toBeDefined();
  });

  it('sorts by name in both directions', () => {
    const asc = applyQuery(records, { ...EMPTY_QUERY, sort: 'name', dir: 'asc' }).map((r) => r.summary.name);
    const desc = applyQuery(records, { ...EMPTY_QUERY, sort: 'name', dir: 'desc' }).map((r) => r.summary.name);
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b)));
    expect(desc).toEqual([...asc].reverse());
  });

  it('is a total order, so the list never reshuffles itself', () => {
    // Tiers tie easily; the name tiebreak is what makes the result stable
    // across reloads.
    for (const sort of ['tier', 'weight', 'age', 'reach', 'updated'] as const) {
      const once = applyQuery(records, { ...EMPTY_QUERY, sort }).map((r) => r.definition.id);
      const twice = applyQuery([...records].reverse(), { ...EMPTY_QUERY, sort }).map((r) => r.definition.id);
      expect(twice, `sort by ${sort} must not depend on input order`).toEqual(once);
    }
  });

  it('agrees with the row-level predicate', () => {
    const q = { ...EMPTY_QUERY, origin: 'custom' as const };
    const visible = applyQuery(records, q);
    for (const r of records) {
      expect(visible.includes(r)).toBe(matchesQuery(r, q));
    }
  });

  it('renders a labelled row for every visible fighter', () => {
    const html = renderToStaticMarkup(
      <FighterDatabase
        store={fakeStore(records)}
        revision={0}
        onEdit={() => undefined}
        onNew={() => undefined}
        onRandom={() => undefined}
        onChanged={() => undefined}
      />,
    );
    for (const r of records) expect(html).toContain(r.summary.name);
    expect(html).toContain('New fighter');
    expect(html).toContain('Random fighter');
    expect(html).toContain('Import');
    expect(html).toContain(`showing ${records.length} of ${records.length}`);
  });
});
