/**
 * FIGHTER CREATOR — the editor for one `FighterDefinition`.
 *
 * Organised as sections that mirror the schema rather than as a wizard,
 * because authoring a fighter is not a linear task: you set a height, look at
 * the derived reach, go back, change the build, check the tier. Sections are
 * tabs so the form stays short, and the derived panel is pinned beside them so
 * the consequence of an edit is always on screen.
 *
 * Two rules the whole file is built around.
 *
 * 1. **Invalid is editable.** Validation runs on every keystroke and decides
 *    one thing: whether Save is enabled. It never reverts a value, never
 *    refuses a keystroke and never moves the user. Anything else loses work.
 * 2. **Numbers clamp, they never become NaN.** Every numeric control commits
 *    through `clampNumber`, which falls back to the previous value for a
 *    half-typed entry rather than snapping to a bound.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SUBMISSIONS, TECHNIQUES, WEIGHT_CLASS_LIMIT_KG, buildBlendOf,
  type CoreDisciplineId, type FighterDefinition,
} from '../../sim';
import {
  BUILDS, GUARD_STYLES, HANDEDNESSES, HURT_BEHAVIOURS, INITIATIVES, LOSING_BEHAVIOURS,
  PRIMARY_MODES, RANGE_BANDS, SEXES, STANCES, TAKEDOWN_SETUPS, THAI_STYLES,
  TIRED_BEHAVIOURS, WEIGHT_CLASS_IDS, WHEN_LOSING,
} from '../store';
import type { FighterRecord, ValidationIssue, ValidationResult } from '../store/types';
import type { FighterStoreApi } from '../storeApi';
import { AttributeSlider } from '../components/AttributeSlider';
import { BodyDiagram } from '../components/BodyDiagram';
import { DerivedPanel } from '../components/DerivedPanel';
import { SubSkillGrid } from '../components/SubSkillGrid';
import { ValidationList, errorPaths, focusPath } from '../components/ValidationList';
import {
  blankDisciplineBlock, comboSpecs, disciplineSections, isDirty,
  takedownPrefs, weightedSubmissions, weightedTechniques,
} from '../model/editorModel';
import { deriveSafely } from '../model/derivedModel';
import {
  BODY_META, BUILD_META, DISCIPLINE_LABELS, MENTAL_META, PHYSICAL_GROUPS, PHYSICAL_META,
  RECORD_META, STYLE_META, humaniseKey, weightClassLabel, type FieldMeta,
} from '../model/fieldMeta';
import { clampNumber, deleteAtPath, describedByIdForPath, fieldIdForPath, getAtPath, setAtPath } from '../model/paths';
import { dualLength, dualMass } from '../model/units';

// --------------------------------------------------------------------------
// Sections
// --------------------------------------------------------------------------

type SectionId = 'body' | 'appearance' | 'physical' | 'disciplines' | 'record' | 'mental' | 'style';

const SECTIONS: readonly { id: SectionId; label: string; hint: string }[] = [
  { id: 'body', label: 'Body', hint: 'Frame, mass, age and stance' },
  { id: 'appearance', label: 'Appearance', hint: 'Cosmetic only; never read by the simulation' },
  { id: 'physical', label: 'Physical', hint: 'The fourteen physical attributes' },
  { id: 'disciplines', label: 'Disciplines', hint: 'Years trained and every named sub-skill' },
  { id: 'record', label: 'Record', hint: 'Career counters and layoff' },
  { id: 'mental', label: 'Mental', hint: 'The six mental attributes' },
  { id: 'style', label: 'Style', hint: 'Game plan, favourites and behaviour under pressure' },
];

/** Which section owns a validation path, so clicking an issue can open it. */
export function sectionForPath(path: string): SectionId {
  const head = path.split('.')[0];
  switch (head) {
    case 'body': return 'body';
    case 'appearance': return 'appearance';
    case 'physical': return 'physical';
    case 'disciplines': return 'disciplines';
    case 'record': return 'record';
    case 'mental': return 'mental';
    case 'style': return 'style';
    // Identity fields (name, short, id, notes) live in the header strip, which
    // is always visible; the body tab is the harmless place to land.
    default: return 'body';
  }
}

/** The discipline a path belongs to, for expanding the right accordion. */
export function disciplineForPath(path: string): string | null {
  const parts = path.split('.');
  return parts[0] === 'disciplines' && parts.length > 1 ? parts[1] : null;
}

// Appearance vocabularies. They live here rather than in the validator because
// nothing in appearance may enter a simulation formula, so there is nothing for
// the validator to protect — these lists exist purely to populate dropdowns.
const HAIR_LENGTHS = ['shaved', 'short', 'medium', 'tied'] as const;
const FACIAL_HAIRS = ['none', 'stubble', 'goatee', 'full', 'moustache'] as const;
const SHORTS_STYLES = ['mma_short', 'vale_tudo', 'boxing_trunk', 'thai_short', 'compression'] as const;
const GLOVE_TYPES = ['mma_4oz', 'boxing_8oz', 'boxing_10oz', 'kb_10oz', 'bare'] as const;
const TATTOO_SLOTS = [
  'leftArmFull', 'rightArmFull', 'leftForearm', 'rightForearm', 'chest', 'stomach',
  'back', 'neck', 'leftLeg', 'rightLeg', 'leftCalf', 'rightCalf',
] as const;

// --------------------------------------------------------------------------
// Small shared controls
// --------------------------------------------------------------------------

interface CommonFieldProps {
  path: string;
  meta: FieldMeta;
  invalid?: boolean;
}

function NumberField({
  path, meta, value, onChange, step = 1, invalid = false, suffix,
}: CommonFieldProps & {
  value: number;
  onChange: (path: string, v: number) => void;
  step?: number;
  suffix?: string;
}): JSX.Element {
  const id = fieldIdForPath(path);
  const descId = describedByIdForPath(path);
  const clamp = meta.clamp ?? { min: -1e9, max: 1e9, dp: 3 };
  const commit = (raw: string): void => onChange(path, clampNumber(raw, clamp, value));
  return (
    <div className={`fc-field${invalid ? ' is-invalid' : ''}`} data-path={path}>
      <label htmlFor={id}>
        {meta.label}
        {meta.unit ? <span className="fc-unit"> ({meta.unit})</span> : null}
      </label>
      <div className="fc-input-row">
        <input
          id={id}
          className="field"
          type="number"
          inputMode="decimal"
          min={clamp.min}
          max={clamp.max}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          aria-describedby={descId}
          onChange={(e) => commit(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
        />
        {suffix ? <span className="fc-suffix mono">{suffix}</span> : null}
      </div>
      <p className="fc-help" id={descId}>{meta.help}</p>
    </div>
  );
}

function SelectField<T extends string>({
  path, meta, value, options, onChange, invalid = false, allowEmpty = false, labelFor,
}: CommonFieldProps & {
  value: T | undefined;
  options: readonly T[];
  onChange: (path: string, v: string) => void;
  allowEmpty?: boolean;
  labelFor?: (v: T) => string;
}): JSX.Element {
  const id = fieldIdForPath(path);
  const descId = describedByIdForPath(path);
  return (
    <div className={`fc-field${invalid ? ' is-invalid' : ''}`} data-path={path}>
      <label htmlFor={id}>{meta.label}</label>
      <select
        id={id}
        className="field"
        value={value ?? ''}
        aria-describedby={descId}
        onChange={(e) => onChange(path, e.target.value)}
      >
        {allowEmpty ? <option value="">(unset)</option> : null}
        {options.map((o) => (
          <option key={o} value={o}>{labelFor ? labelFor(o) : humaniseKey(o)}</option>
        ))}
      </select>
      <p className="fc-help" id={descId}>{meta.help}</p>
    </div>
  );
}

function TextField({
  path, meta, value, onChange, invalid = false, placeholder,
}: CommonFieldProps & {
  value: string;
  onChange: (path: string, v: string) => void;
  placeholder?: string;
}): JSX.Element {
  const id = fieldIdForPath(path);
  const descId = describedByIdForPath(path);
  return (
    <div className={`fc-field${invalid ? ' is-invalid' : ''}`} data-path={path}>
      <label htmlFor={id}>{meta.label}</label>
      <input
        id={id}
        className="field"
        type="text"
        value={value}
        placeholder={placeholder}
        aria-describedby={descId}
        onChange={(e) => onChange(path, e.target.value)}
      />
      <p className="fc-help" id={descId}>{meta.help}</p>
    </div>
  );
}

// --------------------------------------------------------------------------
// The editor
// --------------------------------------------------------------------------

export interface FighterCreatorProps {
  store: FighterStoreApi;
  /** The record being edited. A fresh definition when creating. */
  initial: FighterDefinition;
  /** True when `initial` is a built-in archetype, which saves as a clone. */
  fromBuiltIn: boolean;
  onSaved: (record: FighterRecord) => void;
  onCancel: () => void;
  /** Lets the shell warn before it swaps this screen out. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function FighterCreator({
  store, initial, fromBuiltIn, onSaved, onCancel, onDirtyChange,
}: FighterCreatorProps): JSX.Element {
  const [baseline, setBaseline] = useState<FighterDefinition>(initial);
  const [draft, setDraft] = useState<FighterDefinition>(initial);
  const [section, setSection] = useState<SectionId>('body');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(Object.keys(initial.disciplines)),
  );
  const [message, setMessage] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);

  // A new fighter arriving from the database replaces the whole editor state,
  // baseline included — otherwise the dirty flag would compare the new fighter
  // against the old one and claim unsaved changes immediately.
  useEffect(() => {
    setBaseline(initial);
    setDraft(initial);
    setExpanded(new Set(Object.keys(initial.disciplines)));
    setMessage(null);
  }, [initial]);

  const dirty = useMemo(() => isDirty(baseline, draft), [baseline, draft]);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // The browser-level guard. It only fires for a real page unload; navigating
  // between our own tabs is handled by `requestCancel` below, because the
  // native dialog cannot be triggered from script.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const validation: ValidationResult = useMemo(() => {
    try {
      return store.validate(draft);
    } catch (err) {
      // A validator that throws must not take the editor with it.
      return {
        ok: false,
        issues: [{ path: '', severity: 'error', message: `Validator failed: ${String(err)}` }],
      };
    }
  }, [store, draft]);

  const derived = useMemo(() => deriveSafely(draft), [draft]);
  const badPaths = useMemo(() => errorPaths(validation), [validation]);
  const hasErrors = useMemo(() => validation.issues.some((i) => i.severity === 'error'), [validation]);

  const setField = useCallback((path: string, value: unknown) => {
    setDraft((d) => setAtPath(d, path, value));
  }, []);

  const setNumber = useCallback((path: string, value: number) => {
    setDraft((d) => setAtPath(d, path, value));
  }, []);

  // Focus has to happen after the section has actually rendered: focusing a
  // control inside a `hidden` panel silently does nothing.
  useEffect(() => {
    const path = pendingFocus.current;
    if (path === null) return;
    pendingFocus.current = null;
    const handle = window.setTimeout(() => focusPath(path), 0);
    return () => window.clearTimeout(handle);
  });

  const goToIssue = useCallback((issue: ValidationIssue) => {
    if (!issue.path) return;
    setSection(sectionForPath(issue.path));
    const disc = disciplineForPath(issue.path);
    if (disc !== null) setExpanded((prev) => new Set(prev).add(disc));
    pendingFocus.current = issue.path;
  }, []);

  const toggleDiscipline = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const trainDiscipline = useCallback((id: string) => {
    setDraft((d) => setAtPath(d, `disciplines.${id}`, blankDisciplineBlock(id as CoreDisciplineId)));
    setExpanded((prev) => new Set(prev).add(id));
  }, []);

  const untrainDiscipline = useCallback((id: string) => {
    setDraft((d) => deleteAtPath(d, `disciplines.${id}`));
  }, []);

  const save = useCallback(() => {
    if (hasErrors) return;
    try {
      const saved = store.save(draft);
      setBaseline(saved.definition);
      setDraft(saved.definition);
      setMessage(fromBuiltIn ? 'Saved as a new custom fighter (built-ins are read-only).' : 'Saved.');
      onSaved(saved);
    } catch (err) {
      setMessage(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [store, draft, hasErrors, fromBuiltIn, onSaved]);

  const requestCancel = useCallback(() => {
    if (dirty && !window.confirm('This fighter has unsaved changes. Discard them?')) return;
    onCancel();
  }, [dirty, onCancel]);

  const revert = useCallback(() => {
    if (!dirty || window.confirm('Discard every change since the last save?')) setDraft(baseline);
  }, [dirty, baseline]);

  const sections = useMemo(() => disciplineSections(draft), [draft]);
  const runtimeDisciplines = derived.runtime?.disciplines ?? null;

  return (
    <div className="creator">
      <header className="creator-head">
        <div className="creator-identity">
          <div className="fc-field fc-field--wide">
            <label htmlFor={fieldIdForPath('name')}>Name</label>
            <input
              id={fieldIdForPath('name')}
              className="field creator-name"
              type="text"
              value={draft.name}
              onChange={(e) => setField('name', e.target.value)}
            />
          </div>
          <div className="fc-field fc-field--narrow">
            <label htmlFor={fieldIdForPath('short')}>Short code</label>
            <input
              id={fieldIdForPath('short')}
              className="field"
              type="text"
              maxLength={4}
              value={draft.short}
              onChange={(e) => setField('short', e.target.value.toUpperCase())}
            />
          </div>
          <div className="fc-field fc-field--wide">
            <label htmlFor={fieldIdForPath('appearance.nickname')}>Nickname</label>
            <input
              id={fieldIdForPath('appearance.nickname')}
              className="field"
              type="text"
              value={draft.appearance.nickname ?? ''}
              placeholder="shown on the HUD"
              onChange={(e) => setField('appearance.nickname', e.target.value)}
            />
          </div>
        </div>

        <div className="creator-actions">
          {dirty ? <span className="badge badge--info">unsaved changes</span> : null}
          {fromBuiltIn ? <span className="tag">built-in &middot; saves as a copy</span> : null}
          <button type="button" className="btn" onClick={revert} disabled={!dirty}>Revert</button>
          <button type="button" className="btn" onClick={requestCancel}>Close</button>
          <button
            type="button"
            className="btn btn--play"
            onClick={save}
            disabled={hasErrors}
            title={hasErrors ? 'Fix the errors listed below before saving.' : 'Save this fighter'}
          >
            Save
          </button>
        </div>
      </header>

      {message ? (
        <p className="creator-message" role="status">{message}</p>
      ) : null}

      <div className="creator-body">
        <div className="creator-form">
          <div className="tabs creator-tabs" role="tablist" aria-label="Fighter sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                id={`sect-${s.id}`}
                className="tab"
                aria-selected={section === s.id}
                aria-controls={`sectpanel-${s.id}`}
                title={s.hint}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id="sectpanel-body" aria-labelledby="sect-body" hidden={section !== 'body'}>
            <BodySection draft={draft} onNumber={setNumber} onField={setField} bad={badPaths} />
          </div>
          <div role="tabpanel" id="sectpanel-appearance" aria-labelledby="sect-appearance" hidden={section !== 'appearance'}>
            <AppearanceSection draft={draft} onNumber={setNumber} onField={setField} />
          </div>
          <div role="tabpanel" id="sectpanel-physical" aria-labelledby="sect-physical" hidden={section !== 'physical'}>
            <AttributeSection
              title="Physical attributes"
              blurb="The fourteen attributes of chapter 01 §2.2. Stored values are what you author; age and career history move them before the first bell, and the derived panel shows both."
              meta={PHYSICAL_META}
              groups={PHYSICAL_GROUPS}
              prefix="physical"
              values={draft.physical as unknown as Record<string, number>}
              onChange={setNumber}
              bad={badPaths}
            />
          </div>
          <div role="tabpanel" id="sectpanel-disciplines" aria-labelledby="sect-disciplines" hidden={section !== 'disciplines'}>
            <div className="fc-section">
              <h3 className="fc-h">Disciplines</h3>
              <p className="fc-blurb">
                Tier is per discipline, and derived: sub-skills set the band, training years cap it,
                and tier 5 additionally gates on fight IQ 80 and composure 75. A T4 boxer with T0
                wrestling shows T0 wrestling the moment he is shot on.
              </p>
              {sections.map((s) => {
                const rt = runtimeDisciplines?.[s.id] ?? null;
                return (
                  <SubSkillGrid
                    key={s.id}
                    section={s}
                    tier={rt ? rt.tier : null}
                    effectiveMean={rt ? rt.mean : null}
                    expanded={expanded.has(s.id)}
                    onToggleExpanded={toggleDiscipline}
                    onChange={setNumber}
                    onTrain={trainDiscipline}
                    onUntrain={untrainDiscipline}
                    invalidPaths={badPaths}
                  />
                );
              })}
            </div>
          </div>
          <div role="tabpanel" id="sectpanel-record" aria-labelledby="sect-record" hidden={section !== 'record'}>
            <RecordSection draft={draft} onNumber={setNumber} onField={setField} bad={badPaths} />
          </div>
          <div role="tabpanel" id="sectpanel-mental" aria-labelledby="sect-mental" hidden={section !== 'mental'}>
            <AttributeSection
              title="Mental attributes"
              blurb="Six attributes that decide what the fighter does with the body above. They do not age: a 40-year-old keeps his fight IQ and loses his legs."
              meta={MENTAL_META}
              groups={[{ title: 'Mental', keys: Object.keys(MENTAL_META) }]}
              prefix="mental"
              values={draft.mental as unknown as Record<string, number>}
              onChange={setNumber}
              bad={badPaths}
            />
          </div>
          <div role="tabpanel" id="sectpanel-style" aria-labelledby="sect-style" hidden={section !== 'style'}>
            <StyleSection draft={draft} onNumber={setNumber} onField={setField} bad={badPaths} />
          </div>

          <div className="fc-section">
            <h3 className="fc-h">Notes</h3>
            <label className="visually-hidden" htmlFor={fieldIdForPath('notes')}>Notes</label>
            <textarea
              id={fieldIdForPath('notes')}
              className="field fc-textarea"
              rows={3}
              value={draft.notes ?? ''}
              placeholder="Free-form. Never read by the simulation."
              onChange={(e) => setField('notes', e.target.value)}
            />
          </div>
        </div>

        <aside className="creator-side" aria-label="Live derivation and validation">
          <BodyDiagram
            body={{
              heightM: draft.body.heightM,
              reachM: draft.body.reachM,
              legReachM: draft.body.legReachM,
              massKg: draft.body.fightNightKg ?? draft.body.massKg,
              bodyFatPct: draft.body.bodyFatPct,
              build: buildBlendOf(draft.body.build),
              stance: draft.body.stance,
            }}
          />
          <ValidationList result={validation} onSelectIssue={goToIssue} />
          <DerivedPanel runtime={derived.runtime} error={derived.error} />
        </aside>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Sections
// --------------------------------------------------------------------------

interface SectionProps {
  draft: FighterDefinition;
  onNumber: (path: string, v: number) => void;
  onField: (path: string, v: unknown) => void;
  bad?: ReadonlySet<string>;
}

function BodySection({ draft, onNumber, onField, bad }: SectionProps): JSX.Element {
  const b = draft.body;
  const blend = buildBlendOf(b.build);
  const isBlend = typeof b.build !== 'string';
  const limit = b.weightClass ? WEIGHT_CLASS_LIMIT_KG[b.weightClass] : undefined;

  return (
    <div className="fc-section">
      <h3 className="fc-h">Body</h3>
      <p className="fc-blurb">
        Stored in metres and kilograms so a fighter exported here imports identically anywhere;
        the imperial reading beside each field is a display, not a second source of truth.
      </p>

      <div className="fc-grid">
        <NumberField path="body.heightM" meta={BODY_META.heightM} value={b.heightM} step={0.01}
          onChange={onNumber} invalid={bad?.has('body.heightM')} suffix={dualLength(b.heightM, 'height')} />
        <NumberField path="body.reachM" meta={BODY_META.reachM} value={b.reachM} step={0.01}
          onChange={onNumber} invalid={bad?.has('body.reachM')} suffix={dualLength(b.reachM, 'reach')} />
        <NumberField path="body.legReachM" meta={BODY_META.legReachM} value={b.legReachM} step={0.01}
          onChange={onNumber} invalid={bad?.has('body.legReachM')} suffix={dualLength(b.legReachM, 'reach')} />
        <NumberField path="body.massKg" meta={BODY_META.massKg} value={b.massKg} step={0.5}
          onChange={onNumber} invalid={bad?.has('body.massKg')} suffix={dualMass(b.massKg)} />
        <NumberField path="body.weighInKg" meta={BODY_META.weighInKg} value={b.weighInKg ?? b.massKg} step={0.1}
          onChange={onNumber} invalid={bad?.has('body.weighInKg')} suffix={dualMass(b.weighInKg ?? b.massKg)} />
        <NumberField path="body.fightNightKg" meta={BODY_META.fightNightKg} value={b.fightNightKg ?? b.massKg} step={0.1}
          onChange={onNumber} invalid={bad?.has('body.fightNightKg')} suffix={dualMass(b.fightNightKg ?? b.massKg)} />
        <NumberField path="body.ageYears" meta={BODY_META.ageYears} value={b.ageYears} step={0.5}
          onChange={onNumber} invalid={bad?.has('body.ageYears')} />
        <NumberField path="body.bodyFatPct" meta={BODY_META.bodyFatPct} value={b.bodyFatPct} step={0.5}
          onChange={onNumber} invalid={bad?.has('body.bodyFatPct')} />

        <SelectField path="body.stance" meta={{ label: 'Stance', help: 'Picks the lead side for every technique, and is what the opponent’s stance familiarity is measured against.' }}
          value={b.stance} options={STANCES} onChange={(p, v) => onField(p, v)} invalid={bad?.has('body.stance')} />
        <SelectField path="body.handedness" meta={{ label: 'Handedness', help: 'Sets the default dominant leg and, with stance, whether the power hand is the rear hand.' }}
          value={b.handedness} options={HANDEDNESSES} onChange={(p, v) => onField(p, v)} invalid={bad?.has('body.handedness')} />
        <SelectField path="body.sex" meta={{ label: 'Sex', help: 'Selects the population priors and the rig; the ruleset decides the round length.' }}
          value={b.sex} options={SEXES} onChange={(p, v) => onField(p, v)} allowEmpty />
        <SelectField path="body.dominantLeg" meta={{ label: 'Dominant leg', help: 'Defaults to the handedness side. Drives which kick is the power kick.' }}
          value={b.dominantLeg} options={['right', 'left'] as const} onChange={(p, v) => onField(p, v)} allowEmpty />
        <SelectField
          path="body.weightClass"
          meta={{
            label: 'Weight class',
            help: limit !== undefined && Number.isFinite(limit)
              ? `Limit ${limit} kg. Leave unset to derive it from the weigh-in mass.`
              : 'Leave unset to derive it from the weigh-in mass.',
          }}
          value={b.weightClass}
          options={WEIGHT_CLASS_IDS}
          labelFor={weightClassLabel}
          onChange={(p, v) => onField(p, v === '' ? undefined : v)}
          allowEmpty
          invalid={bad?.has('body.weightClass')}
        />
      </div>

      <h4 className="fc-h fc-h--sub">Build</h4>
      <p className="fc-blurb">
        Somatotype. Drives the rig proportions only &mdash; no simulation formula reads it &mdash;
        but two fighters of equal height and mass with different blends clinch and look different.
      </p>
      {isBlend ? (
        <div className="fc-grid fc-grid--tight">
          {(['ecto', 'meso', 'endo'] as const).map((k) => (
            <NumberField key={k} path={`body.build.${k}`} meta={BUILD_META[k]} value={blend[k]} step={0.05}
              onChange={onNumber} invalid={bad?.has(`body.build.${k}`)} />
          ))}
          <p className="fc-note">
            Sum {(blend.ecto + blend.meso + blend.endo).toFixed(2)} &mdash; the blend should add to 1.00.
          </p>
        </div>
      ) : (
        <div className="fc-grid fc-grid--tight">
          <SelectField path="body.build" meta={{ label: 'Somatotype', help: 'The single-label form. Switch to the blend for finer control.' }}
            value={b.build as (typeof BUILDS)[number]} options={BUILDS} onChange={(p, v) => onField(p, v)} />
          <button type="button" className="btn" onClick={() => onField('body.build', blend)}>
            Convert to blend
          </button>
        </div>
      )}
    </div>
  );
}

function AppearanceSection({ draft, onNumber, onField }: SectionProps): JSX.Element {
  const a = draft.appearance;
  const tattoos = a.tattooPlacements ?? [];

  const toggleSlot = (slot: string): void => {
    const has = tattoos.some((t) => t.slot === slot);
    const next = has
      ? tattoos.filter((t) => t.slot !== slot)
      : [...tattoos, { slot: slot as (typeof TATTOO_SLOTS)[number], textureId: 'ink.default' }];
    onField('appearance.tattooPlacements', next);
    // The legacy flat list is kept in step so an older reader still sees them.
    onField('appearance.tattoos', next.map((t) => t.slot));
  };

  return (
    <div className="fc-section">
      <h3 className="fc-h">Appearance</h3>
      <p className="fc-blurb">
        Cosmetic only. Nothing on this tab may ever enter a simulation formula &mdash; two fighters
        identical but for their appearance produce bit-identical bouts. Glove type is normally set
        by the ruleset; the field here is the visual override.
      </p>

      <div className="fc-grid">
        <NumberField path="appearance.skinTone" meta={{ label: 'Skin tone', help: 'Position on the renderer’s tone ramp, 0 to 1.', clamp: { min: 0, max: 1, dp: 2 } }}
          value={a.skinTone} step={0.05} onChange={onNumber} />
        <SelectField path="appearance.hairStyle.length" meta={{ label: 'Hair length', help: 'Rig hair length. Tied hair behaves differently in the clinch visually only.' }}
          value={a.hairStyle?.length} options={HAIR_LENGTHS} onChange={(p, v) => onField(p, v)} allowEmpty />
        <TextField path="appearance.hair" meta={{ label: 'Hair (legacy label)', help: 'Free-text hair id kept for definitions written against the original schema.' }}
          value={a.hair} onChange={(p, v) => onField(p, v)} />
        <SelectField path="appearance.facialHair" meta={{ label: 'Facial hair', help: 'Beard preset.' }}
          value={a.facialHair} options={FACIAL_HAIRS} onChange={(p, v) => onField(p, v)} allowEmpty />
        <TextField path="appearance.face" meta={{ label: 'Face preset', help: 'Face preset id. The renderer resolves it; the sim never sees it.' }}
          value={a.face} onChange={(p, v) => onField(p, v)} />
        <SelectField path="appearance.shortsKit.style" meta={{ label: 'Shorts', help: 'Kit silhouette.' }}
          value={a.shortsKit?.style} options={SHORTS_STYLES} onChange={(p, v) => onField(p, v)} allowEmpty />
        <SelectField path="appearance.gloveKit.type" meta={{ label: 'Gloves', help: 'Visual override; the ruleset normally decides this.' }}
          value={a.gloveKit?.type} options={GLOVE_TYPES} onChange={(p, v) => onField(p, v)} allowEmpty />
        <TextField path="appearance.flag" meta={{ label: 'Flag', help: 'ISO country code shown on the chyron.' }}
          value={a.flag ?? ''} onChange={(p, v) => onField(p, v)} placeholder="e.g. BR" />
      </div>

      <h4 className="fc-h fc-h--sub">Tattoos</h4>
      <div className="fc-chips" role="group" aria-label="Tattoo placements">
        {TATTOO_SLOTS.map((slot) => {
          const on = tattoos.some((t) => t.slot === slot);
          return (
            <button
              key={slot}
              type="button"
              className="btn btn--chip"
              aria-pressed={on}
              onClick={() => toggleSlot(slot)}
            >
              {humaniseKey(slot)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AttributeSection({
  title, blurb, meta, groups, prefix, values, onChange, bad,
}: {
  title: string;
  blurb: string;
  meta: Readonly<Record<string, FieldMeta>>;
  groups: readonly { title: string; keys: readonly string[] }[];
  prefix: string;
  values: Record<string, number>;
  onChange: (path: string, v: number) => void;
  bad?: ReadonlySet<string>;
}): JSX.Element {
  return (
    <div className="fc-section">
      <h3 className="fc-h">{title}</h3>
      <p className="fc-blurb">{blurb}</p>
      {groups.map((g) => (
        <fieldset className="fc-fieldset" key={g.title}>
          <legend>{g.title}</legend>
          <div className="attr-list-grid">
            {g.keys.map((key) => {
              const path = `${prefix}.${key}`;
              const m = meta[key];
              if (!m) return null;
              return (
                <AttributeSlider
                  key={path}
                  path={path}
                  label={m.label}
                  help={m.help}
                  value={values[key] ?? 0}
                  invalid={bad?.has(path)}
                  onChange={onChange}
                />
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function RecordSection({ draft, onNumber, onField, bad }: SectionProps): JSX.Element {
  const r = draft.record;
  const cut = r.weightCut ?? { cutPct: 0, regainPct: 0, residualDehydration: 0 };
  return (
    <div className="fc-section">
      <h3 className="fc-h">Record</h3>
      <p className="fc-blurb">
        The counters are not decoration: KO losses and knockdowns permanently decay the chin, the
        layoff costs composure, reaction and cardio, and the totals set the experience scalar.
      </p>
      <div className="fc-grid">
        {(['proWins', 'proLosses', 'proDraws', 'amWins', 'amLosses', 'koLosses',
          'knockdownsSuffered', 'titleFights', 'layoffMonths'] as const).map((k) => (
          <NumberField key={k} path={`record.${k}`} meta={RECORD_META[k]}
            value={(r as unknown as Record<string, number>)[k] ?? 0}
            step={k === 'layoffMonths' ? 0.5 : 1}
            onChange={onNumber} invalid={bad?.has(`record.${k}`)} />
        ))}
        <AttributeSlider
          path="record.bigFightComposure"
          label={RECORD_META.bigFightComposure.label}
          help={RECORD_META.bigFightComposure.help}
          value={r.bigFightComposure}
          invalid={bad?.has('record.bigFightComposure')}
          onChange={onNumber}
        />
      </div>

      <h4 className="fc-h fc-h--sub">Fight week</h4>
      <div className="fc-grid fc-grid--tight">
        <NumberField path="record.weightCut.cutPct"
          meta={{ label: 'Cut', unit: '%', help: 'Mass lost during fight week as a percentage of walk-around mass.', clamp: { min: 0, max: 20, dp: 1 } }}
          value={cut.cutPct} step={0.5} onChange={onNumber} />
        <NumberField path="record.weightCut.regainPct"
          meta={{ label: 'Regain', unit: '%', help: 'Mass regained after the weigh-in. The benefit enters purely through fight-night mass.', clamp: { min: 0, max: 25, dp: 1 } }}
          value={cut.regainPct} step={0.5} onChange={onNumber} />
        <NumberField path="record.weightCut.residualDehydration"
          meta={{ label: 'Residual dehydration', help: 'What the cut leaves behind: 0 to 0.05, read as aerobic, burst and chin penalties. Discipline lowers it.', clamp: { min: 0, max: 0.05, dp: 3 } }}
          value={cut.residualDehydration} step={0.005} onChange={onNumber} />
        <NumberField path="record.shortNoticeDays"
          meta={{ label: 'Short notice', unit: 'days', help: 'Days of camp when replacing an opponent. Under 21 raises the AI’s scouting noise by half.', clamp: { min: 0, max: 200, dp: 0 } }}
          value={r.shortNoticeDays ?? 60} step={1} onChange={onNumber} />
        <SelectField path="record.lastResult" meta={{ label: 'Last result', help: 'Outcome of the previous bout; a recent KO loss compounds with the layoff.' }}
          value={r.lastResult} options={['win', 'loss', 'draw', 'none'] as const} onChange={(p, v) => onField(p, v)} allowEmpty />
        <NumberField path="record.winStreak"
          meta={{ label: 'Win streak', help: 'Consecutive wins going in.', clamp: { min: 0, max: 40, dp: 0 } }}
          value={r.winStreak ?? 0} step={1} onChange={onNumber} />
      </div>
    </div>
  );
}

function StyleSection({ draft, onNumber, onField, bad }: SectionProps): JSX.Element {
  const s = draft.style;
  const favourites = weightedTechniques(s.favouriteTechniques);
  const combos = comboSpecs(s.favouriteCombos);
  const subs = weightedSubmissions(s.goToSubmissions);
  const tdPrefs = takedownPrefs(s.takedownPreferences);
  const tdStyle = Array.isArray(s.takedownPreferences) ? null : s.takedownPreferences;

  const setWeighted = (key: 'favouriteTechniques' | 'goToSubmissions', list: unknown[]): void =>
    onField(`style.${key}`, list);

  return (
    <div className="fc-section">
      <h3 className="fc-h">Style</h3>
      <p className="fc-blurb">
        Style is descriptive, not prescriptive: it multiplies the AI&rsquo;s action weights. A style
        the sub-skills cannot support is still selected and simply executed badly &mdash; that is
        what a tier-1 &ldquo;counter striker&rdquo; looks like.
      </p>

      <div className="fc-grid">
        <SelectField path="style.primaryMode" meta={STYLE_META.primaryMode} value={s.primaryMode}
          options={PRIMARY_MODES} onChange={(p, v) => onField(p, v)} invalid={bad?.has('style.primaryMode')} />
        <SelectField path="style.fallbackMode" meta={STYLE_META.fallbackMode} value={s.fallbackMode}
          options={PRIMARY_MODES} onChange={(p, v) => onField(p, v)} allowEmpty />
        <SelectField path="style.preferredRange" meta={STYLE_META.preferredRange} value={s.preferredRange}
          options={RANGE_BANDS} onChange={(p, v) => onField(p, v)} invalid={bad?.has('style.preferredRange')} />
        <SelectField path="style.initiative" meta={STYLE_META.initiative} value={s.initiative}
          options={INITIATIVES} onChange={(p, v) => onField(p, v)} allowEmpty />
        <SelectField path="style.whenLosing" meta={STYLE_META.whenLosing} value={s.whenLosing}
          options={WHEN_LOSING} onChange={(p, v) => onField(p, v)} invalid={bad?.has('style.whenLosing')} />
        <SelectField path="style.losingBehaviour" meta={STYLE_META.losingBehaviour} value={s.losingBehaviour}
          options={LOSING_BEHAVIOURS} onChange={(p, v) => onField(p, v)} allowEmpty />
        <SelectField path="style.hurtBehaviour" meta={STYLE_META.hurtBehaviour} value={s.hurtBehaviour}
          options={HURT_BEHAVIOURS} onChange={(p, v) => onField(p, v)} allowEmpty />
        <SelectField path="style.tiredBehaviour" meta={STYLE_META.tiredBehaviour} value={s.tiredBehaviour}
          options={TIRED_BEHAVIOURS} onChange={(p, v) => onField(p, v)} allowEmpty />
        <SelectField path="style.guardStyle" meta={STYLE_META.guardStyle} value={s.guardStyle}
          options={GUARD_STYLES} onChange={(p, v) => onField(p, v)} allowEmpty />
        <SelectField path="style.thaiStyle" meta={STYLE_META.thaiStyle} value={s.thaiStyle}
          options={THAI_STYLES} onChange={(p, v) => onField(p, v)} allowEmpty />
      </div>

      <div className="attr-list-grid">
        <AttributeSlider path="style.pressureBias" label={STYLE_META.pressureBias.label}
          help={STYLE_META.pressureBias.help} value={s.pressureBias ?? 50} onChange={onNumber}
          invalid={bad?.has('style.pressureBias')} />
        <AttributeSlider path="style.stanceSwitching" label={STYLE_META.stanceSwitching.label}
          help={STYLE_META.stanceSwitching.help} value={s.stanceSwitching ?? 10} onChange={onNumber}
          invalid={bad?.has('style.stanceSwitching')} />
      </div>

      <div className="fc-field fc-field--checkbox">
        <input
          id={fieldIdForPath('style.refusesToTap')}
          type="checkbox"
          checked={s.refusesToTap ?? false}
          onChange={(e) => onField('style.refusesToTap', e.target.checked)}
          aria-describedby={describedByIdForPath('style.refusesToTap')}
        />
        <label htmlFor={fieldIdForPath('style.refusesToTap')}>{STYLE_META.refusesToTap.label}</label>
        <p className="fc-help" id={describedByIdForPath('style.refusesToTap')}>{STYLE_META.refusesToTap.help}</p>
      </div>

      <WeightedList
        title="Favourite techniques"
        blurb="Multiplies the AI's weight for each technique. A favourite the fighter has no skill for is still thrown, and still misses."
        idKey="techId"
        options={TECHNIQUES.map((t) => ({ id: t.id, name: t.name }))}
        entries={favourites as unknown as Record<string, unknown>[]}
        pathPrefix="style.favouriteTechniques"
        onChange={(list) => setWeighted('favouriteTechniques', list)}
      />

      <WeightedList
        title="Go-to submissions"
        blurb="Which finishes this fighter hunts. Entry position and stage timing come from the submission catalogue."
        idKey="subId"
        options={SUBMISSIONS.map((x) => ({ id: x.id, name: x.name }))}
        entries={subs as unknown as Record<string, unknown>[]}
        pathPrefix="style.goToSubmissions"
        onChange={(list) => setWeighted('goToSubmissions', list)}
      />

      <h4 className="fc-h fc-h--sub">Favourite combinations</h4>
      <p className="fc-blurb">Sequences the AI prefers to chain. Ids are resolved against the technique catalogue.</p>
      <ul className="combo-list">
        {combos.map((c, i) => (
          <li key={`${c.id}:${i}`} className="combo-row">
            <code className="mono">{c.sequence.join(' → ')}</code>
            <label className="visually-hidden" htmlFor={fieldIdForPath(`style.favouriteCombos.${i}.weight`)}>
              Weight for {c.id}
            </label>
            <input
              id={fieldIdForPath(`style.favouriteCombos.${i}.weight`)}
              className="field combo-weight"
              type="number"
              min={0}
              max={5}
              step={0.1}
              value={c.weight}
              onChange={(e) => {
                const next = combos.slice();
                next[i] = { ...c, weight: clampNumber(e.target.value, { min: 0, max: 5, dp: 2 }, c.weight) };
                onField('style.favouriteCombos', next);
              }}
            />
            <button type="button" className="btn btn--quiet"
              onClick={() => onField('style.favouriteCombos', combos.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
        {combos.length === 0 ? <li className="fc-note">No combinations set; the AI will build its own.</li> : null}
      </ul>

      <h4 className="fc-h fc-h--sub">Takedown preferences</h4>
      <div className="fc-grid fc-grid--tight">
        <SelectField path="style.takedownPreferences.setup" meta={STYLE_META.takedownSetup}
          value={tdStyle?.setup} options={TAKEDOWN_SETUPS}
          onChange={(p, v) => onField(p, v)} allowEmpty />
        <NumberField path="style.takedownPreferences.cageBias" meta={STYLE_META.cageBias}
          value={tdStyle?.cageBias ?? 0.5} step={0.05} onChange={onNumber} />
      </div>
      <WeightedList
        title="Preferred takedowns"
        blurb="Which entries this fighter reaches for. Setup class matters more than the entry itself."
        idKey="techId"
        options={TECHNIQUES.map((t) => ({ id: t.id, name: t.name }))}
        entries={tdPrefs as unknown as Record<string, unknown>[]}
        pathPrefix="style.takedownPreferences.prefs"
        onChange={(list) => onField('style.takedownPreferences', { ...(tdStyle ?? { setup: 'naked', cageBias: 0.5 }), prefs: list })}
      />
    </div>
  );
}

/**
 * A weighted id list (favourite techniques, go-to submissions, takedown prefs).
 *
 * One component for all three because the shape is identical bar the id key —
 * three near-copies would be three places for the "weight clamps to 0-5" rule
 * to drift.
 */
function WeightedList({
  title, blurb, idKey, options, entries, pathPrefix, onChange,
}: {
  title: string;
  blurb: string;
  idKey: 'techId' | 'subId';
  options: readonly { id: string; name: string }[];
  entries: readonly Record<string, unknown>[];
  pathPrefix: string;
  onChange: (next: Record<string, unknown>[]) => void;
}): JSX.Element {
  const [pick, setPick] = useState('');
  const addId = `${fieldIdForPath(pathPrefix)}-add`;

  const add = (): void => {
    if (pick === '' || entries.some((e) => e[idKey] === pick)) return;
    onChange([...entries, { [idKey]: pick, weight: 1 }]);
    setPick('');
  };

  const nameOf = (id: string): string => options.find((o) => o.id === id)?.name ?? id;

  return (
    <section className="weighted">
      <h4 className="fc-h fc-h--sub">{title}</h4>
      <p className="fc-blurb">{blurb}</p>
      <ul className="weighted-list">
        {entries.map((e, i) => {
          const id = String(e[idKey]);
          const weight = typeof e.weight === 'number' ? e.weight : 1;
          const wId = fieldIdForPath(`${pathPrefix}.${i}.weight`);
          return (
            <li key={`${id}:${i}`} className="weighted-row">
              <span className="weighted-name">{nameOf(id)}</span>
              <code className="mono weighted-id">{id}</code>
              <label className="visually-hidden" htmlFor={wId}>Weight for {nameOf(id)}</label>
              <input
                id={wId}
                className="field weighted-weight"
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={weight}
                onChange={(ev) => {
                  const next = entries.slice();
                  next[i] = { ...e, weight: clampNumber(ev.target.value, { min: 0, max: 5, dp: 2 }, weight) };
                  onChange(next);
                }}
              />
              <button type="button" className="btn btn--quiet"
                onClick={() => onChange(entries.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          );
        })}
        {entries.length === 0 ? <li className="fc-note">Nothing set; the AI falls back to its own weights.</li> : null}
      </ul>
      <div className="weighted-add">
        <label className="visually-hidden" htmlFor={addId}>Add to {title}</label>
        <select id={addId} className="field" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Add&hellip;</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <button type="button" className="btn" onClick={add} disabled={pick === ''}>Add</button>
      </div>
    </section>
  );
}

/** Re-exported for the tests, which check the path-to-section mapping. */
export const __testables = { sectionForPath, disciplineForPath, getAtPath, DISCIPLINE_LABELS };
