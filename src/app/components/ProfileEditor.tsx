/**
 * PROFILE EDITOR — the organised view of a fighter (model/profileModel.ts).
 *
 * Six categories (Physical, Athletic, Technical, Style & game plan, Mental,
 * Experience) as tabs, each a list of controls that read and write real
 * schema paths. Basic mode shows the handful of controls that define a
 * fighter; Advanced shows every mapped control; a search looks through all of
 * them regardless of mode. With a comparison fighter chosen, every row shows
 * that fighter's value and the difference.
 *
 * Nothing here holds state about the fighter: the draft belongs to the
 * creator, and every edit goes through `onChange(nextDefinition)`, which is
 * what makes the creator's undo and dirty tracking cover this view too.
 */

import { useMemo, useState } from 'react';
import { SUB_SKILLS, TIER_NAMES, type CoreDisciplineId, type FighterDefinition, type FighterRuntime } from '../../sim';
import {
  PROFILE_CATEGORIES, PROFILE_PARAMS, UNMODELLED_CONCEPTS, formatParamValue, visibleParams,
  type ProfileCategory, type ProfileParam,
} from '../model/profileModel';
import { DISCIPLINE_LABELS } from '../model/fieldMeta';
import { setAtPath } from '../model/paths';
import { TierBadge } from './TierBadge';
import {
  EmptyState, InfoTip, Select, Slider, StatusBadge, Switch, TabPanel, Tabs, IconSearch,
} from '../ui';

export interface ProfileEditorProps {
  draft: FighterDefinition;
  /** `key` groups consecutive edits of one control into one undo step. */
  onChange: (next: FighterDefinition, key?: string) => void;
  mode: 'basic' | 'advanced';
  query: string;
  runtime: FighterRuntime | null;
  compare: FighterDefinition | null;
  compareRuntime: FighterRuntime | null;
}

const ID_PREFIX = 'profile';

export function ProfileEditor({
  draft, onChange, mode, query, runtime, compare, compareRuntime,
}: ProfileEditorProps): JSX.Element {
  const [category, setCategory] = useState<ProfileCategory>('physical');
  const visible = useMemo(() => visibleParams(PROFILE_PARAMS, mode, query), [mode, query]);
  const searching = query.trim() !== '';

  const byCategory = useMemo(() => {
    const m = new Map<ProfileCategory, ProfileParam[]>();
    for (const c of PROFILE_CATEGORIES) m.set(c.id, []);
    for (const p of visible) m.get(p.category)?.push(p);
    return m;
  }, [visible]);

  const renderCategory = (c: (typeof PROFILE_CATEGORIES)[number]): JSX.Element => {
    const params = byCategory.get(c.id) ?? [];
    const unmodelled = UNMODELLED_CONCEPTS.filter((u) => u.category === c.id);
    return (
      <section className="pe-cat" aria-labelledby={searching ? `pe-h-${c.id}` : undefined} key={c.id}>
        {searching ? <h3 className="pe-cat-title" id={`pe-h-${c.id}`}>{c.label}</h3> : <p className="pe-cat-blurb">{c.blurb}</p>}
        {c.id === 'technical' && !searching ? <TierStrip runtime={runtime} compareRuntime={compareRuntime} /> : null}
        <div className="pe-rows">
          {params.map((p) => (
            <ParamRow key={p.id} param={p} draft={draft} onChange={onChange} compare={compare}
              runtime={runtime} showPaths={mode === 'advanced'} />
          ))}
        </div>
        {c.id === 'experience' && !searching ? (
          <DisciplineYears draft={draft} onChange={onChange} runtime={runtime} compare={compare} />
        ) : null}
        {unmodelled.length > 0 && !searching ? (
          <div className="pe-unmodelled">
            <span className="pe-unmodelled-h">Not modelled as separate attributes</span>
            <ul>
              {unmodelled.map((u) => <li key={u.concept}><b>{u.concept}</b> — {u.carriedBy}</li>)}
            </ul>
          </div>
        ) : null}
      </section>
    );
  };

  if (searching) {
    const hits = PROFILE_CATEGORIES.filter((c) => (byCategory.get(c.id) ?? []).length > 0);
    return (
      <div className="pe" aria-live="polite">
        {hits.length === 0 ? (
          <EmptyState compact icon={<IconSearch />} title={`No attribute matches “${query.trim()}”`}>
            Search covers every profile control in both modes, by name, description and schema path.
            The Full schema view has the remaining raw fields.
          </EmptyState>
        ) : hits.map(renderCategory)}
      </div>
    );
  }

  return (
    <div className="pe">
      <Tabs<ProfileCategory>
        idPrefix={ID_PREFIX}
        label="Attribute categories"
        value={category}
        onChange={setCategory}
        items={PROFILE_CATEGORIES.map((c) => ({ id: c.id, label: c.label, count: byCategory.get(c.id)?.length ?? 0 }))}
      />
      {PROFILE_CATEGORIES.map((c) => (
        <TabPanel key={c.id} idPrefix={ID_PREFIX} id={c.id} active={category === c.id}>
          {renderCategory(c)}
        </TabPanel>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------

function ParamRow({
  param: p, draft, onChange, compare, runtime, showPaths,
}: {
  param: ProfileParam;
  draft: FighterDefinition;
  onChange: (next: FighterDefinition, key?: string) => void;
  compare: FighterDefinition | null;
  runtime: FighterRuntime | null;
  showPaths: boolean;
}): JSX.Element {
  const value = p.get(draft);
  const disabled = p.disabledReason?.(draft) ?? null;
  const other = compare ? p.get(compare) : undefined;
  const statusNote = p.status !== 'live' ? (p.statusNote ?? 'Stored, but not read by the simulation.') : null;
  const help = (
    <>
      {p.help}
      {showPaths ? <><br /><span className="pe-paths">Schema: {p.paths.slice(0, 3).join(', ')}{p.paths.length > 3 ? ` +${p.paths.length - 3} more` : ''}</span></> : null}
    </>
  );

  let control: JSX.Element;
  const label = (
    <span className="pe-label">
      {p.label}
      <InfoTip text={help} label={`About ${p.label}`} />
      {p.status !== 'live' ? <StatusBadge tone="warn">No effect on the bout</StatusBadge> : null}
    </span>
  );

  if (p.id === 'experience.overall' && value === null) {
    // Derived unless overridden: offer the override with the derived value shown.
    const derived = runtime ? Math.round(runtime.experienceDerived * 100) : 50;
    control = (
      <div className="pe-override">
        <span className="pe-label">{p.label} <InfoTip text={help} label={`About ${p.label}`} /></span>
        <span className="pe-derived mono">derived: {derived} / 100</span>
        <Switch checked={false} label="Set by hand" onChange={() => onChange(p.set(draft, derived))} />
      </div>
    );
  } else if (p.control.kind === 'range') {
    const c = p.control;
    control = (
      <Slider
        label={label}
        value={typeof value === 'number' ? value : c.min}
        min={c.min}
        max={c.max}
        step={c.step}
        format={c.format}
        withNumber
        disabled={disabled !== null}
        onChange={(v) => onChange(p.set(draft, v), p.id)}
      />
    );
  } else if (p.control.kind === 'select') {
    control = (
      <Select<string>
        label={label}
        value={String(value ?? '')}
        options={p.control.options}
        disabled={disabled !== null}
        onChange={(v) => onChange(p.set(draft, v), p.id)}
      />
    );
  } else {
    control = (
      <div className="pe-toggle">
        {label}
        <Switch checked={Boolean(value)} label={value ? 'On' : 'Off'} onChange={(v) => onChange(p.set(draft, v), p.id)} />
      </div>
    );
  }

  let delta: JSX.Element | null = null;
  if (compare && other !== undefined) {
    const same = other === value;
    const diff = typeof value === 'number' && typeof other === 'number' ? value - other : null;
    delta = (
      <p className="pe-compare" data-same={same || undefined}>
        <span>{compare.short || compare.name}: <b className="mono">{formatParamValue(p, other)}</b></span>
        {diff !== null && Math.abs(diff) > 1e-9 ? (
          <span className={`mono ${diff > 0 ? 'is-up' : 'is-down'}`}>
            {diff > 0 ? '+' : '−'}{p.control.kind === 'range' && p.control.step < 1 ? Math.abs(diff).toFixed(2) : Math.round(Math.abs(diff))}
          </span>
        ) : same ? <span className="pe-same">same</span> : null}
      </p>
    );
  }

  return (
    <div className="pe-row" data-param={p.id} data-status={p.status} data-disabled={disabled !== null || undefined}>
      {control}
      {p.id === 'experience.overall' && value !== null ? (
        <Switch checked label="Set by hand (turn off to use the derived value)"
          onChange={() => onChange(setAtPath(draft, 'record.experienceOverride', undefined), p.id)} />
      ) : null}
      {disabled ? <p className="pe-note">{disabled}</p> : null}
      {statusNote ? <p className="pe-note">{statusNote}</p> : null}
      {delta}
    </div>
  );
}

/** Per-discipline tier chips: the "what does this fighter look like" line. */
function TierStrip({ runtime, compareRuntime }: { runtime: FighterRuntime | null; compareRuntime: FighterRuntime | null }): JSX.Element | null {
  if (!runtime) return null;
  const ids = (Object.keys(runtime.disciplines) as CoreDisciplineId[]).filter((d) => runtime.disciplines[d].trained);
  return (
    <div className="pe-tiers" aria-label="Derived tiers">
      <div className="pe-tier-main">
        <span>Striking <TierBadge tier={runtime.strikingTier} showName /></span>
        <span>Grappling <TierBadge tier={runtime.grapplingTier} showName /></span>
        <span>MMA <TierBadge tier={runtime.mmaTier} showName /></span>
      </div>
      <ul className="pe-tier-list">
        {ids.map((d) => {
          const t = runtime.disciplines[d].tier;
          const other = compareRuntime?.disciplines[d];
          return (
            <li key={d} title={`${DISCIPLINE_LABELS[d] ?? d}: tier ${t} (${TIER_NAMES[t]}), effective mean ${runtime.disciplines[d].mean.toFixed(1)}`}>
              <TierBadge tier={t} />
              <span>{DISCIPLINE_LABELS[d] ?? d}</span>
              {other ? <span className="pe-tier-vs mono">vs T{other.tier}</span> : null}
            </li>
          );
        })}
      </ul>
      <p className="pe-cat-blurb" style={{ margin: 0 }}>
        Tiers are derived from sub-skills, training years and (for T5) fight IQ and composure; they update as you edit.
      </p>
    </div>
  );
}

/** Per-discipline experience: years trained for every art the fighter trains. */
function DisciplineYears({
  draft, onChange, runtime, compare,
}: {
  draft: FighterDefinition;
  onChange: (next: FighterDefinition, key?: string) => void;
  runtime: FighterRuntime | null;
  compare: FighterDefinition | null;
}): JSX.Element {
  const ids = (Object.keys(SUB_SKILLS) as CoreDisciplineId[]).filter((d) => draft.disciplines[d] !== undefined);
  return (
    <div className="pe-disc">
      <h4 className="pe-sub-h">Experience per discipline <InfoTip text="Years trained cap each art's tier and scale what a year of practice is worth. Add or remove arts, and edit grades, records, rust and specialisations, in Full schema → Disciplines." /></h4>
      {ids.length === 0 ? <p className="pe-note">No discipline trained yet.</p> : null}
      <div className="pe-rows">
        {ids.map((d) => {
          const block = draft.disciplines[d]!;
          const rt = runtime?.disciplines[d];
          const other = compare?.disciplines[d];
          return (
            <div className="pe-row" key={d} data-param={`experience.years.${d}`}>
              <Slider
                label={(
                  <span className="pe-label">
                    {DISCIPLINE_LABELS[d] ?? d}
                    {rt ? <TierBadge tier={rt.tier} /> : null}
                  </span>
                )}
                value={block.years}
                min={0}
                max={30}
                step={0.5}
                format={(v) => `${v} yr`}
                withNumber
                onChange={(v) => onChange(setAtPath(draft, `disciplines.${d}.years`, v), `years.${d}`)}
              />
              {compare ? (
                <p className="pe-compare">
                  <span>{compare.short || compare.name}: <b className="mono">{other ? `${other.years} yr` : 'untrained'}</b></span>
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
