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
  ENDURANCE_SPORTS, INJURY_REGIONS, SUBMISSIONS, TECHNIQUES, WEIGHT_CLASS_LIMIT_KG, buildBlendOf,
  type CoreDisciplineId, type EnduranceSportId, type FighterDefinition, type FighterRuntime, type InjuryEntry,
  type InjuryRegion,
} from '../../sim';
import {
  BUILDS, GUARD_STYLES, HANDEDNESSES, HURT_BEHAVIOURS, INITIATIVES, LOSING_BEHAVIOURS,
  PRIMARY_MODES, RANGE_BANDS, SEXES, STANCES, TAKEDOWN_SETUPS, THAI_STYLES,
  TIRED_BEHAVIOURS, WEIGHT_CLASS_IDS, WHEN_LOSING, NAME_MAX, exportFighter, toJson,
} from '../store';
import type { FighterRecord, ValidationIssue, ValidationResult } from '../store/types';
import type { FighterStoreApi } from '../storeApi';
import { AttributeSlider } from '../components/AttributeSlider';
import { BodyDiagram } from '../components/BodyDiagram';
import { DerivedPanel } from '../components/DerivedPanel';
import { ProfileEditor } from '../components/ProfileEditor';
import { TierBadge } from '../components/TierBadge';
import {
  Alert, Button, Dialog, EmptyState, Segmented, StatusBadge, useConfirm, useToast,
  IconCompare, IconCopy, IconDownload, IconSearch, IconSliders, IconUndo, IconX,
} from '../ui';
import { noSimEffect } from '../model/profileModel';
import { SubSkillGrid } from '../components/SubSkillGrid';
import { ValidationList, errorPaths, focusPath } from '../components/ValidationList';
import {
  blankDisciplineBlock, comboSpecs, disciplineSections, idFromName, isDirty,
  takedownPrefs, weightedSubmissions, weightedTechniques,
} from '../model/editorModel';
import { deriveSafely, disciplineTierRows } from '../model/derivedModel';
import {
  BODY_META, BUILD_META, DISCIPLINE_LABELS, EXPERIENCE_META, HISTORY_META, MENTAL_META,
  PHYSICAL_GROUPS, PHYSICAL_META, RECORD_META, STYLE_META, humaniseKey, weightClassLabel,
  type FieldMeta,
} from '../model/fieldMeta';
import { clampNumber, deleteAtPath, describedByIdForPath, fieldIdForPath, getAtPath, setAtPath } from '../model/paths';
import { dualLength, dualMass } from '../model/units';

// --------------------------------------------------------------------------
// Sections
// --------------------------------------------------------------------------

type SectionId =
  | 'body' | 'appearance' | 'physical' | 'disciplines' | 'record'
  | 'experience' | 'history' | 'mental' | 'style';

const SECTIONS: readonly { id: SectionId; label: string; hint: string }[] = [
  { id: 'body', label: 'Body', hint: 'Frame, mass, age and stance' },
  { id: 'appearance', label: 'Appearance', hint: 'Cosmetic only; never read by the simulation' },
  { id: 'physical', label: 'Physical', hint: 'The fourteen physical attributes' },
  { id: 'disciplines', label: 'Disciplines', hint: 'Per-art career: grade, record, volume, rust and specialisations' },
  { id: 'record', label: 'Record', hint: 'Career counters and layoff' },
  { id: 'experience', label: 'Experience', hint: 'Rounds, opposition level, big-fight and damage history' },
  { id: 'history', label: 'Injuries & history', hint: 'Injuries, surgeries, cut history and endurance background' },
  { id: 'mental', label: 'Mental', hint: 'The six mental attributes' },
  { id: 'style', label: 'Style', hint: 'Game plan, favourites and behaviour under pressure' },
];

/**
 * Overall-experience fields live under `record` in the schema but under their
 * own tab in the editor, because the Record tab is already the longest in the
 * creator and these eight fields are a different question: not "what is the
 * record" but "what did it cost and who was it against".
 */
const EXPERIENCE_KEYS = [
  'totalRounds', 'yearsPro', 'oppositionLevel', 'mainEvents', 'titleWins',
  'warFights', 'hardSparringYears', 'experienceOverride',
] as const;

/** Body fields the Injuries & history tab owns rather than the Body tab. */
const HISTORY_BODY_KEYS = ['naturalWeightKg', 'handStrengthSplit', 'limbAsymmetry'] as const;

/** Which section owns a validation path, so clicking an issue can open it. */
export function sectionForPath(path: string): SectionId {
  const parts = path.split('.');
  const head = parts[0];
  if (head === 'record' && (EXPERIENCE_KEYS as readonly string[]).includes(parts[1])) return 'experience';
  if (head === 'body' && (HISTORY_BODY_KEYS as readonly string[]).includes(parts[1])) return 'history';
  switch (head) {
    case 'history': return 'history';
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

/** The "stored, not simulated" marker for raw fields the sim never reads. */
function NoEffect({ path }: { path: string }): JSX.Element | null {
  if (path.startsWith('appearance')) return null; // the whole tab says so once
  const why = noSimEffect(path);
  return why ? <> <StatusBadge tone="warn" title={why}>No effect on the bout</StatusBadge></> : null;
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
        <NoEffect path={path} />
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
      <label htmlFor={id}>{meta.label}<NoEffect path={path} /></label>
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
  /** Bumped by the shell when the database changes (the compare list reads it). */
  revision?: number;
}

type EditorView = 'basic' | 'advanced' | 'schema';

/** How long consecutive edits to one field merge into a single undo step. */
const UNDO_COALESCE_MS = 700;
const UNDO_LIMIT = 150;

/**
 * Apply an archetype's fighting attributes to the draft while keeping who the
 * fighter *is*: id, name, short code, nickname and notes survive; body,
 * physical, disciplines, mental, record, style and history come from the
 * preset. Appearance is kept too — a preset is a way of fighting, not a face.
 */
export function applyPreset(draft: FighterDefinition, preset: FighterDefinition): FighterDefinition {
  const copy = JSON.parse(JSON.stringify(preset)) as FighterDefinition;
  return {
    ...copy,
    id: draft.id,
    name: draft.name,
    short: draft.short,
    appearance: draft.appearance,
    ...(draft.notes !== undefined ? { notes: draft.notes } : {}),
  };
}

export function FighterCreator({
  store, initial, fromBuiltIn, onSaved, onCancel, onDirtyChange, revision = 0,
}: FighterCreatorProps): JSX.Element {
  const [baseline, setBaseline] = useState<FighterDefinition>(initial);
  const [draft, setDraftRaw] = useState<FighterDefinition>(initial);
  const [section, setSection] = useState<SectionId>('body');
  const [view, setView] = useState<EditorView>('basic');
  const [query, setQuery] = useState('');
  const [compareId, setCompareId] = useState('');
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(Object.keys(initial.disciplines)),
  );
  const [message, setMessage] = useState<{ tone: 'ok' | 'alert' | 'info'; text: string } | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const [confirm, confirmUi] = useConfirm();
  const toast = useToast();

  // ---- undo history -------------------------------------------------------
  // Past states, newest last. Edits to the same field within
  // UNDO_COALESCE_MS merge, so one slider drag is one undo step.
  const past = useRef<FighterDefinition[]>([]);
  const future = useRef<FighterDefinition[]>([]);
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const [, setHistoryTick] = useState(0);

  // The current draft, readable synchronously. History bookkeeping happens
  // here rather than inside a state updater, because StrictMode runs
  // updaters twice in development and would record every step twice.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const update = useCallback((fn: (d: FighterDefinition) => FighterDefinition, key = '*') => {
    const d = draftRef.current;
    const next = fn(d);
    if (next === d) return;
    const now = Date.now();
    const merge = lastEdit.current !== null && key !== '*' && lastEdit.current.key === key
      && now - lastEdit.current.at < UNDO_COALESCE_MS;
    if (!merge) {
      past.current.push(d);
      if (past.current.length > UNDO_LIMIT) past.current.shift();
    }
    future.current = [];
    lastEdit.current = { key, at: now };
    draftRef.current = next;
    setDraftRaw(next);
    setHistoryTick((t) => t + 1);
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(draftRef.current);
    draftRef.current = prev;
    setDraftRaw(prev);
    lastEdit.current = null;
    setHistoryTick((t) => t + 1);
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(draftRef.current);
    draftRef.current = next;
    setDraftRaw(next);
    lastEdit.current = null;
    setHistoryTick((t) => t + 1);
  }, []);

  // A new fighter arriving from the database replaces the whole editor state,
  // baseline included — otherwise the dirty flag would compare the new fighter
  // against the old one and claim unsaved changes immediately.
  useEffect(() => {
    setBaseline(initial);
    setDraftRaw(initial);
    past.current = [];
    future.current = [];
    setExpanded(new Set(Object.keys(initial.disciplines)));
    setMessage(null);
  }, [initial]);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl+Y, except inside a text box,
  // where the browser's own text undo is the one the user means.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && ['text', 'search'].includes((t as HTMLInputElement).type)));
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const dirty = useMemo(() => isDirty(baseline, draft), [baseline, draft]);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // The browser-level guard. It only fires for a real page unload; navigating
  // between our own pages is handled by the shell.
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
  const errorCount = useMemo(() => validation.issues.filter((i) => i.severity === 'error').length, [validation]);

  const records = useMemo<FighterRecord[]>(() => {
    try { return store.list(); } catch { return []; }
  }, [store, revision]);
  const compareRecord = records.find((r) => r.definition.id === compareId) ?? null;
  const compareDerived = useMemo(
    () => (compareRecord ? deriveSafely(compareRecord.definition) : null),
    [compareRecord],
  );
  const presets = useMemo(() => records.filter((r) => r.builtIn), [records]);

  const setField = useCallback((path: string, value: unknown) => {
    update((d) => setAtPath(d, path, value), path);
  }, [update]);

  const setNumber = useCallback((path: string, value: number) => {
    update((d) => setAtPath(d, path, value), path);
  }, [update]);

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
    setView('schema');
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
    update((d) => setAtPath(d, `disciplines.${id}`, blankDisciplineBlock(id as CoreDisciplineId)));
    setExpanded((prev) => new Set(prev).add(id));
  }, [update]);

  const untrainDiscipline = useCallback((id: string) => {
    update((d) => deleteAtPath(d, `disciplines.${id}`));
    toast({ message: `Removed ${DISCIPLINE_LABELS[id] ?? id} and its sub-skills.`, actionLabel: 'Undo', onAction: undo });
  }, [update, toast, undo]);

  const save = useCallback(() => {
    if (hasErrors) return;
    try {
      const saved = store.save(draft);
      setBaseline(saved.definition);
      draftRef.current = saved.definition;
      setDraftRaw(saved.definition);
      setMessage({ tone: 'ok', text: fromBuiltIn ? 'Saved as a new custom fighter (built-in archetypes are read-only).' : 'Saved.' });
      onSaved(saved);
    } catch (err) {
      setMessage({ tone: 'alert', text: `Could not save: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [store, draft, hasErrors, fromBuiltIn, onSaved]);

  const saveAsCopy = useCallback(() => {
    if (hasErrors) return;
    try {
      const name = `${draft.name} (copy)`;
      const saved = store.save({ ...draft, name, id: idFromName(name, Date.now().toString(36)) });
      setMessage({ tone: 'ok', text: `Saved a copy as “${saved.summary.name}”. You are now editing the copy.` });
      onSaved(saved);
    } catch (err) {
      setMessage({ tone: 'alert', text: `Could not save a copy: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [store, draft, hasErrors, onSaved]);

  const exportDraft = useCallback(() => {
    try {
      const text = toJson(exportFighter(draft));
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${draft.id || 'fighter'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({ tone: 'info', text: `Exported “${draft.name}” as a versioned BOUT LAB file (schema 1).${dirty ? ' The export includes the unsaved edits.' : ''}` });
    } catch (err) {
      setMessage({ tone: 'alert', text: `Export failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [draft, dirty]);

  const requestCancel = useCallback(async () => {
    if (dirty && !(await confirm({
      title: 'Close the editor?', body: 'This fighter has unsaved changes. Closing discards them.',
      confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true,
    }))) return;
    onCancel();
  }, [dirty, onCancel, confirm]);

  const revert = useCallback(() => {
    if (!dirty) return;
    update(() => baseline);
    toast({ message: 'Reverted to the last save.', actionLabel: 'Undo', onAction: undo });
  }, [dirty, baseline, update, toast, undo]);

  const usePreset = useCallback((record: FighterRecord) => {
    update((d) => applyPreset(d, record.definition));
    setPresetsOpen(false);
    toast({ message: `Applied the “${record.summary.name}” preset. Name, nickname and look were kept.`, actionLabel: 'Undo', onAction: undo });
  }, [update, toast, undo]);

  const sections = useMemo(() => disciplineSections(draft), [draft]);
  const runtimeDisciplines = derived.runtime?.disciplines ?? null;
  // The tier rows carry the §8.1 derived figures (rust, priors, what a year is
  // worth) that the per-art detail panel prints live.
  const derivedByDiscipline = useMemo(() => {
    const out: Record<string, ReturnType<typeof disciplineTierRows>[number]> = {};
    if (derived.runtime) for (const row of disciplineTierRows(derived.runtime)) out[row.id] = row;
    return out;
  }, [derived.runtime]);

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
              maxLength={NAME_MAX}
              value={draft.name}
              aria-invalid={badPaths.has('name') || undefined}
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
          <div className="creator-status" aria-live="polite">
            {fromBuiltIn ? <StatusBadge tone="outline" title="Built-in archetypes are read-only; saving creates your own copy">Built-in · saves as a copy</StatusBadge> : null}
            {dirty ? <StatusBadge tone="warn" dot>Unsaved changes</StatusBadge> : <StatusBadge tone="ok" dot>Saved</StatusBadge>}
            {hasErrors ? <StatusBadge tone="alert">{errorCount} error{errorCount === 1 ? '' : 's'}</StatusBadge> : null}
          </div>
          <div className="creator-buttons">
            <Button size="sm" variant="ghost" iconOnly icon={<IconUndo />} aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)"
              disabled={past.current.length === 0} onClick={undo} />
            <Button size="sm" variant="ghost" iconOnly icon={<IconUndo style={{ transform: 'scaleX(-1)' }} />} aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)"
              disabled={future.current.length === 0} onClick={redo} />
            <Button size="sm" icon={<IconSliders />} onClick={() => setPresetsOpen(true)} title="Start from one of the built-in archetypes">Presets</Button>
            <Button size="sm" icon={<IconDownload />} onClick={exportDraft} title="Download this fighter as a JSON file">Export</Button>
            <Button size="sm" icon={<IconCopy />} onClick={saveAsCopy} disabled={hasErrors} title="Save the current edits as a new fighter">Save as copy</Button>
            <Button size="sm" onClick={revert} disabled={!dirty}>Revert</Button>
            <Button size="sm" onClick={() => { void requestCancel(); }}>Close</Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={hasErrors}
              title={hasErrors ? 'Fix the errors listed below before saving.' : 'Save this fighter'}
            >
              Save
            </Button>
          </div>
        </div>
      </header>

      {message ? (
        <Alert tone={message.tone} action={<Button size="sm" variant="ghost" iconOnly icon={<IconX />} aria-label="Dismiss" onClick={() => setMessage(null)} />}>
          {message.text}
        </Alert>
      ) : null}

      <div className="creator-toolbar">
        <Segmented<EditorView>
          label="Editor view"
          value={view}
          onChange={setView}
          options={[
            { value: 'basic', label: 'Basic', title: 'The controls that define a fighter' },
            { value: 'advanced', label: 'Advanced', title: 'Every mapped control, with schema paths' },
            { value: 'schema', label: 'Full schema', title: 'Every raw field of the definition (expert)' },
          ]}
        />
        {view !== 'schema' ? (
          <div className="creator-search">
            <IconSearch aria-hidden="true" />
            <label className="visually-hidden" htmlFor="creator-search">Search attributes</label>
            <input
              id="creator-search"
              className="field"
              type="search"
              placeholder="Search attributes (e.g. reach, cardio, takedown)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        ) : null}
        <div className="creator-compare">
          <label htmlFor="creator-compare-select"><IconCompare aria-hidden="true" /> Compare with</label>
          <select
            id="creator-compare-select"
            className="field"
            value={compareId}
            onChange={(e) => setCompareId(e.target.value)}
          >
            <option value="">Nobody</option>
            {records.filter((r) => r.definition.id !== draft.id).map((r) => (
              <option key={r.definition.id} value={r.definition.id}>{r.summary.name} · T{r.summary.overallTier}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="creator-body">
        <div className="creator-form">
          {view !== 'schema' ? (
            <ProfileEditor
              draft={draft}
              onChange={(next, key) => update(() => next, key ?? 'profile')}
              mode={view}
              query={query}
              runtime={derived.runtime}
              compare={compareRecord?.definition ?? null}
              compareRuntime={compareDerived?.runtime ?? null}
            />
          ) : (
            <>
              <Alert tone="info">
                Every raw field of the fighter definition. Fields marked <StatusBadge tone="warn">No effect on the bout</StatusBadge>{' '}
                are stored and exported but not read by the simulation.
              </Alert>
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
            </>
          )}

          <div className={view !== 'schema' ? 'creator-schema-hidden' : undefined}>
            <div role="tabpanel" id="sectpanel-body" aria-labelledby="sect-body" hidden={view !== 'schema' || section !== 'body'}>
              <BodySection draft={draft} onNumber={setNumber} onField={setField} bad={badPaths} />
            </div>
            <div role="tabpanel" id="sectpanel-appearance" aria-labelledby="sect-appearance" hidden={view !== 'schema' || section !== 'appearance'}>
              <AppearanceSection draft={draft} onNumber={setNumber} onField={setField} />
            </div>
            <div role="tabpanel" id="sectpanel-physical" aria-labelledby="sect-physical" hidden={view !== 'schema' || section !== 'physical'}>
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
            <div role="tabpanel" id="sectpanel-disciplines" aria-labelledby="sect-disciplines" hidden={view !== 'schema' || section !== 'disciplines'}>
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
                      onField={setField}
                      onTrain={trainDiscipline}
                      onUntrain={untrainDiscipline}
                      invalidPaths={badPaths}
                      derived={derivedByDiscipline[s.id] ?? null}
                      effectiveSub={rt ? rt.effective : null}
                    />
                  );
                })}
              </div>
            </div>
            <div role="tabpanel" id="sectpanel-record" aria-labelledby="sect-record" hidden={view !== 'schema' || section !== 'record'}>
              <RecordSection draft={draft} onNumber={setNumber} onField={setField} bad={badPaths} />
            </div>
            <div role="tabpanel" id="sectpanel-experience" aria-labelledby="sect-experience" hidden={view !== 'schema' || section !== 'experience'}>
              <ExperienceSection
                draft={draft}
                onNumber={setNumber}
                onField={setField}
                bad={badPaths}
                derivedExperience={derived.runtime?.experienceDerived ?? null}
                usedExperience={derived.runtime?.experience ?? null}
              />
            </div>
            <div role="tabpanel" id="sectpanel-history" aria-labelledby="sect-history" hidden={view !== 'schema' || section !== 'history'}>
              <HistorySection draft={draft} onNumber={setNumber} onField={setField} bad={badPaths} />
            </div>
            <div role="tabpanel" id="sectpanel-mental" aria-labelledby="sect-mental" hidden={view !== 'schema' || section !== 'mental'}>
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
            <div role="tabpanel" id="sectpanel-style" aria-labelledby="sect-style" hidden={view !== 'schema' || section !== 'style'}>
              <StyleSection draft={draft} onNumber={setNumber} onField={setField} bad={badPaths} />
            </div>
          </div>

          <div className="fc-section creator-notes">
            <h3 className="fc-h fc-h--sub">Notes</h3>
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
          {compareRecord && compareDerived?.runtime && derived.runtime ? (
            <CompareCard me={derived.runtime} other={compareDerived.runtime} otherName={compareRecord.summary.name}
              onClear={() => setCompareId('')} />
          ) : null}
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

      <Dialog
        open={presetsOpen}
        onClose={() => setPresetsOpen(false)}
        title="Start from a preset"
        description="Each preset is one of the built-in archetypes. Applying one replaces the body, attributes, disciplines, record and style; the name, short code, nickname, look and notes stay. You can undo it."
        wide
      >
        {presets.length === 0 ? (
          <EmptyState compact title="No presets available">The built-in archetypes could not be read.</EmptyState>
        ) : (
          <ul className="preset-grid">
            {presets.map((r) => (
              <li key={r.definition.id}>
                <button type="button" className="preset-card" onClick={() => usePreset(r)}>
                  <span className="preset-name">{r.summary.name} <TierBadge tier={r.summary.overallTier} /></span>
                  <span className="preset-meta">{weightClassLabel(r.summary.weightClass)} · {r.summary.topDiscipline} · {r.summary.recordLine}</span>
                  {r.definition.notes ? <span className="preset-note">{r.definition.notes}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      {confirmUi}
    </div>
  );
}

/** Side-by-side derived composites for the comparison fighter. */
function CompareCard({
  me, other, otherName, onClear,
}: { me: FighterRuntime; other: FighterRuntime; otherName: string; onClear: () => void }): JSX.Element {
  const rows: [string, number, number, (v: number) => string][] = [
    ['Striking tier', me.strikingTier, other.strikingTier, (v) => `T${v}`],
    ['Grappling tier', me.grapplingTier, other.grapplingTier, (v) => `T${v}`],
    ['MMA tier', me.mmaTier, other.mmaTier, (v) => `T${v}`],
    ['Striking mean', me.strikingMean, other.strikingMean, (v) => v.toFixed(1)],
    ['Grappling mean', me.grapplingMean, other.grapplingMean, (v) => v.toFixed(1)],
    ['Experience', me.experience * 100, other.experience * 100, (v) => v.toFixed(0)],
    ['Reach (cm)', me.body.reachM * 100, other.body.reachM * 100, (v) => v.toFixed(0)],
    ['Fight-night kg', me.body.fightNightKg, other.body.fightNightKg, (v) => v.toFixed(1)],
    ['Age', me.body.ageYears, other.body.ageYears, (v) => v.toFixed(0)],
  ];
  return (
    <section className="ui-card compare-card" aria-labelledby="compare-h">
      <div className="ui-card-head">
        <h3 className="ui-card-title" id="compare-h">Compared with {otherName}</h3>
        <Button size="sm" variant="ghost" iconOnly icon={<IconX />} aria-label="Stop comparing" onClick={onClear} style={{ marginLeft: 'auto' }} />
      </div>
      <table className="ui-table compare-table">
        <thead><tr><th scope="col">Derived</th><th scope="col" className="num">This</th><th scope="col" className="num">Other</th><th scope="col" className="num">Δ</th></tr></thead>
        <tbody>
          {rows.map(([label, a, b, f]) => {
            const d = a - b;
            return (
              <tr key={label}>
                <th scope="row" style={{ fontWeight: 400 }}>{label}</th>
                <td className="num">{f(a)}</td>
                <td className="num">{f(b)}</td>
                <td className={`num ${d > 0.05 ? 'is-up' : d < -0.05 ? 'is-down' : ''}`}>{Math.abs(d) < 0.05 ? '·' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(label.includes('tier') ? 0 : 1)}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
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

/**
 * EXPERIENCE (01 §8.2) — what the record cost and who it was against.
 *
 * The Record tab counts bouts. This one asks the two questions a bout count
 * cannot answer: how much cage time is behind it, and how good was the
 * opposition. Both move derived numbers, and the override at the bottom exists
 * because sometimes the author knows something the counters do not — with the
 * derived value printed beside it so the override is an informed act.
 */
function ExperienceSection({
  draft, onNumber, onField, bad, derivedExperience, usedExperience,
}: SectionProps & {
  derivedExperience: number | null;
  usedExperience: number | null;
}): JSX.Element {
  const r = draft.record;
  const overrideSet = r.experienceOverride !== undefined;
  const v = (k: string): number => (r as unknown as Record<string, number>)[k] ?? 0;

  return (
    <div className="fc-section">
      <h3 className="fc-h">Experience and career depth</h3>
      <p className="fc-blurb">
        Two fighters at 10-0 are not the same fighter. One has thirty rounds behind him and has
        beaten ranked opposition; the other has ten first-round finishes against debutants. These
        fields are the difference, and every one of them moves the experience composite, composure
        or the chin.
      </p>

      <h4 className="fc-h fc-h--sub">Cage time and level</h4>
      <div className="fc-grid">
        <NumberField path="record.totalRounds" meta={EXPERIENCE_META.totalRounds} value={v('totalRounds')}
          onChange={onNumber} invalid={bad?.has('record.totalRounds')} />
        <NumberField path="record.yearsPro" meta={EXPERIENCE_META.yearsPro} value={v('yearsPro')} step={0.5}
          onChange={onNumber} invalid={bad?.has('record.yearsPro')} />
        <NumberField path="record.mainEvents" meta={EXPERIENCE_META.mainEvents} value={v('mainEvents')}
          onChange={onNumber} invalid={bad?.has('record.mainEvents')} />
        <NumberField path="record.titleWins" meta={EXPERIENCE_META.titleWins} value={v('titleWins')}
          onChange={onNumber} invalid={bad?.has('record.titleWins')} />
      </div>

      <div className="attr-list-grid">
        <AttributeSlider path="record.oppositionLevel" label={EXPERIENCE_META.oppositionLevel.label}
          help={EXPERIENCE_META.oppositionLevel.help} value={r.oppositionLevel ?? 50}
          onChange={onNumber} invalid={bad?.has('record.oppositionLevel')} />
      </div>

      <h4 className="fc-h fc-h--sub">Damage history</h4>
      <p className="fc-blurb">
        The mileage the KO column never shows. Both of these decay the chin permanently, on top of
        the age curve and the KO losses on the Record tab.
      </p>
      <div className="fc-grid fc-grid--tight">
        <NumberField path="record.warFights" meta={EXPERIENCE_META.warFights} value={v('warFights')}
          onChange={onNumber} invalid={bad?.has('record.warFights')} />
        <NumberField path="record.hardSparringYears" meta={EXPERIENCE_META.hardSparringYears}
          value={v('hardSparringYears')} step={0.5}
          onChange={onNumber} invalid={bad?.has('record.hardSparringYears')} />
      </div>

      <h4 className="fc-h fc-h--sub">Overall experience</h4>
      <p className="fc-blurb">
        {derivedExperience === null
          ? 'The draft will not derive, so the implied value is unavailable.'
          : `The record, rounds and opposition level imply ${(derivedExperience * 100).toFixed(1)} / 100. ` +
            `The sim is currently using ${((usedExperience ?? derivedExperience) * 100).toFixed(1)}.`}
      </p>
      <div className="fc-field fc-field--checkbox">
        <input
          id={fieldIdForPath('record.experienceOverride.enabled')}
          type="checkbox"
          checked={overrideSet}
          aria-describedby={describedByIdForPath('record.experienceOverride.enabled')}
          onChange={(e) =>
            onField(
              'record.experienceOverride',
              e.target.checked ? Math.round((derivedExperience ?? 0.5) * 100) : undefined,
            )
          }
        />
        <label htmlFor={fieldIdForPath('record.experienceOverride.enabled')}>
          Set overall experience by hand
        </label>
        <p className="fc-help" id={describedByIdForPath('record.experienceOverride.enabled')}>
          {EXPERIENCE_META.experienceOverride.help}
        </p>
      </div>
      {overrideSet ? (
        <div className="attr-list-grid">
          <AttributeSlider path="record.experienceOverride"
            label={EXPERIENCE_META.experienceOverride.label}
            help={EXPERIENCE_META.experienceOverride.help}
            value={r.experienceOverride ?? 50}
            onChange={onNumber} invalid={bad?.has('record.experienceOverride')} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * INJURIES AND HISTORY (01 §8.3, §8.4).
 *
 * The body carries its past. Everything on this tab lowers something: a
 * reconstructed knee costs balance, foot speed and the kick it can no longer
 * commit to; a walk-around mass twenty kilos above the limit costs residual
 * dehydration; ten years of hard sparring costs chin. Nothing here is
 * flavour — the derived panel shows exactly what each entry took.
 */
function HistorySection({ draft, onNumber, onField, bad }: SectionProps): JSX.Element {
  const b = draft.body;
  const h = draft.history ?? {};
  const injuries = h.injuries ?? [];
  const cut = h.weightCutHistory ?? { hardCuts: 0, worstCutPct: 0, missedWeight: 0 };
  const cardio = h.cardioBackground ?? { sport: 'none' as EnduranceSportId, years: 0 };
  const asym = b.limbAsymmetry ?? { armPct: 0, legPct: 0 };

  const setInjuries = (next: InjuryEntry[]): void => onField('history.injuries', next);
  const patch = (i: number, key: keyof InjuryEntry, value: unknown): void => {
    const next = injuries.slice();
    next[i] = { ...next[i], [key]: value };
    setInjuries(next);
  };

  return (
    <div className="fc-section">
      <h3 className="fc-h">Injuries and history</h3>
      <p className="fc-blurb">
        The body a fighter brings to the cage is the one his career left him. Every field here is
        read by the derivation &mdash; injuries take attribute points and can cap a capability
        outright, the cut history costs cardio and dehydration, and the endurance background gives
        some of it back.
      </p>

      <h4 className="fc-h fc-h--sub">Natural size and asymmetry</h4>
      <div className="fc-grid fc-grid--tight">
        <NumberField path="body.naturalWeightKg" meta={HISTORY_META.naturalWeightKg}
          value={b.naturalWeightKg ?? b.weighInKg ?? b.massKg} step={0.5}
          onChange={onNumber} invalid={bad?.has('body.naturalWeightKg')}
          suffix={dualMass(b.naturalWeightKg ?? b.weighInKg ?? b.massKg)} />
        <NumberField path="body.limbAsymmetry.armPct" meta={HISTORY_META.armAsymmetryPct}
          value={asym.armPct} step={0.1}
          onChange={(p, val) => onField('body.limbAsymmetry', { ...asym, armPct: val })}
          invalid={bad?.has('body.limbAsymmetry.armPct')} />
        <NumberField path="body.limbAsymmetry.legPct" meta={HISTORY_META.legAsymmetryPct}
          value={asym.legPct} step={0.1}
          onChange={(p, val) => onField('body.limbAsymmetry', { ...asym, legPct: val })}
          invalid={bad?.has('body.limbAsymmetry.legPct')} />
      </div>
      <div className="attr-list-grid">
        <AttributeSlider path="body.handStrengthSplit" label={HISTORY_META.handStrengthSplit.label}
          help={HISTORY_META.handStrengthSplit.help} value={b.handStrengthSplit ?? 50}
          onChange={onNumber} invalid={bad?.has('body.handStrengthSplit')} />
      </div>

      <h4 className="fc-h fc-h--sub">Conditioning background and weight-cut history</h4>
      <div className="fc-grid fc-grid--tight">
        <SelectField path="history.cardioBackground.sport" meta={HISTORY_META.cardioSport}
          value={cardio.sport} options={ENDURANCE_SPORTS}
          onChange={(p, val) => onField('history.cardioBackground', { ...cardio, sport: val })} />
        <NumberField path="history.cardioBackground.years" meta={HISTORY_META.cardioYears}
          value={cardio.years} step={0.5}
          onChange={(p, val) => onField('history.cardioBackground', { ...cardio, years: val })}
          invalid={bad?.has('history.cardioBackground.years')} />
        <NumberField path="history.weightCutHistory.hardCuts" meta={HISTORY_META.hardCuts}
          value={cut.hardCuts}
          onChange={(p, val) => onField('history.weightCutHistory', { ...cut, hardCuts: val })}
          invalid={bad?.has('history.weightCutHistory.hardCuts')} />
        <NumberField path="history.weightCutHistory.worstCutPct" meta={HISTORY_META.worstCutPct}
          value={cut.worstCutPct} step={0.5}
          onChange={(p, val) => onField('history.weightCutHistory', { ...cut, worstCutPct: val })}
          invalid={bad?.has('history.weightCutHistory.worstCutPct')} />
        <NumberField path="history.weightCutHistory.missedWeight" meta={HISTORY_META.missedWeight}
          value={cut.missedWeight}
          onChange={(p, val) => onField('history.weightCutHistory', { ...cut, missedWeight: val })}
          invalid={bad?.has('history.weightCutHistory.missedWeight')} />
        <NumberField path="history.surgeries" meta={HISTORY_META.surgeries} value={h.surgeries ?? 0}
          onChange={onNumber} invalid={bad?.has('history.surgeries')} />
      </div>

      <h4 className="fc-h fc-h--sub">Injury history</h4>
      <p className="fc-blurb">
        Each entry costs the attributes of its region, scaled by severity and decayed by
        e<sup>-months/18</sup>. An operated or recurrent injury never fully goes: it keeps a floor
        of 25 % or 35 % forever. A hand, shoulder, hip, knee or ankle injury additionally caps
        punch power, kick power or the head kick once it is bad enough.
      </p>
      <ul className="injury-list">
        {injuries.map((inj, i) => (
          <li className="injury-row" key={`${inj.region}:${i}`}>
            <SelectField path={`history.injuries.${i}.region`} meta={HISTORY_META.injuryRegion}
              value={inj.region} options={INJURY_REGIONS}
              onChange={(p, val) => patch(i, 'region', val as InjuryRegion)} />
            <NumberField path={`history.injuries.${i}.severity`} meta={HISTORY_META.injurySeverity}
              value={inj.severity} onChange={(p, val) => patch(i, 'severity', val)}
              invalid={bad?.has(`history.injuries.${i}.severity`)} />
            <NumberField path={`history.injuries.${i}.monthsAgo`} meta={HISTORY_META.injuryMonthsAgo}
              value={inj.monthsAgo} onChange={(p, val) => patch(i, 'monthsAgo', val)}
              invalid={bad?.has(`history.injuries.${i}.monthsAgo`)} />
            <div className="fc-field fc-field--checkbox">
              <input id={fieldIdForPath(`history.injuries.${i}.surgery`)} type="checkbox"
                checked={inj.surgery ?? false}
                aria-describedby={describedByIdForPath(`history.injuries.${i}.surgery`)}
                onChange={(e) => patch(i, 'surgery', e.target.checked)} />
              <label htmlFor={fieldIdForPath(`history.injuries.${i}.surgery`)}>{HISTORY_META.injurySurgery.label}</label>
              <p className="fc-help" id={describedByIdForPath(`history.injuries.${i}.surgery`)}>
                {HISTORY_META.injurySurgery.help}
              </p>
            </div>
            <div className="fc-field fc-field--checkbox">
              <input id={fieldIdForPath(`history.injuries.${i}.recurrent`)} type="checkbox"
                checked={inj.recurrent ?? false}
                aria-describedby={describedByIdForPath(`history.injuries.${i}.recurrent`)}
                onChange={(e) => patch(i, 'recurrent', e.target.checked)} />
              <label htmlFor={fieldIdForPath(`history.injuries.${i}.recurrent`)}>{HISTORY_META.injuryRecurrent.label}</label>
              <p className="fc-help" id={describedByIdForPath(`history.injuries.${i}.recurrent`)}>
                {HISTORY_META.injuryRecurrent.help}
              </p>
            </div>
            <button type="button" className="btn btn--quiet"
              onClick={() => setInjuries(injuries.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
        {injuries.length === 0 ? <li className="fc-note">No injuries recorded. A healthy fighter.</li> : null}
      </ul>
      <button
        type="button"
        className="btn"
        onClick={() => setInjuries([...injuries, { region: 'knee', severity: 40, monthsAgo: 12 }])}
      >
        Add injury
      </button>
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
          help={noSimEffect('style.stanceSwitching') ? `${STYLE_META.stanceSwitching.help} Not read by the simulation today: ${noSimEffect('style.stanceSwitching')}` : STYLE_META.stanceSwitching.help}
          value={s.stanceSwitching ?? 10} onChange={onNumber}
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
