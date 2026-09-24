/**
 * PER-ART DETAIL PANEL — everything about one discipline except the sub-skills.
 *
 * Chapter 01 §8.1 makes a discipline a career rather than a number: when the
 * fighter started, how many hours a week, under whom, how live the sparring,
 * what grade they hold, what they won, what they specialise in, and how long
 * it has been. Each of those moves a derived value, and each control here says
 * which one — the same contract the rest of the creator keeps.
 *
 * The panel is deliberately dense and deliberately *live*: the derived strip
 * at the top shows the tier, the rust multiplier, the prior the grade and the
 * record attest, and what a training year in this art is currently worth. A
 * user moving "months since last trained" should watch the tier fall without
 * having to go looking for it.
 */

import {
  GRADE_RANKS, PLACING_IDS, SPECIALISATIONS_BY_DISCIPLINE,
  type CoreDisciplineId,
} from '../../sim';
import { COMPETITION_LEVELS } from '../store';
import {
  DISCIPLINE_COMPETITION_META, DISCIPLINE_META, GRADE_RANK_LABELS, GRADE_SYSTEMS_FOR_DISCIPLINE,
  GRADE_SYSTEM_LABELS, PLACING_LABELS, type FieldMeta,
} from '../model/fieldMeta';
import type { DisciplineSection } from '../model/editorModel';
import type { DisciplineTierRow } from '../model/derivedModel';
import { clampNumber, describedByIdForPath, fieldIdForPath } from '../model/paths';
import { NumberInput, rangeLabel } from '../ui/numberInput';

export interface DisciplineDetailProps {
  section: DisciplineSection;
  /** Live derived row for this discipline; null while the draft will not derive. */
  derived: DisciplineTierRow | null;
  onNumber: (path: string, value: number) => void;
  onField: (path: string, value: unknown) => void;
  invalidPaths: ReadonlySet<string>;
}

/** A compact number input that commits through `clampNumber`, never to NaN. */
function Num({
  path, meta, value, step = 1, onChange, invalid,
}: {
  path: string;
  meta: FieldMeta;
  value: number;
  step?: number;
  onChange: (path: string, v: number) => void;
  invalid?: boolean;
}): JSX.Element {
  const id = fieldIdForPath(path);
  const descId = describedByIdForPath(path);
  const clamp = meta.clamp ?? { min: -1e9, max: 1e9, dp: 2 };
  const commit = (raw: string): void => onChange(path, clampNumber(raw, clamp, value));
  const range = rangeLabel(clamp.min, clamp.max);
  return (
    <div className={`fc-field${invalid ? ' is-invalid' : ''}`} data-path={path}>
      <label htmlFor={id}>
        {meta.label}
        {meta.unit ? <span className="fc-unit"> ({meta.unit})</span> : null}
        {range ? <span className="fc-range mono"> {range}</span> : null}
      </label>
      <NumberInput
        id={id}
        className="field"
        min={clamp.min}
        max={clamp.max}
        step={step}
        value={value}
        aria-describedby={descId}
        onCommit={commit}
      />
      <p className="fc-help" id={descId}>{meta.help}</p>
    </div>
  );
}

function Pick({
  path, meta, value, options, labelFor, onChange,
}: {
  path: string;
  meta: FieldMeta;
  value: string;
  options: readonly string[];
  labelFor: (v: string) => string;
  onChange: (path: string, v: string) => void;
}): JSX.Element {
  const id = fieldIdForPath(path);
  const descId = describedByIdForPath(path);
  return (
    <div className="fc-field" data-path={path}>
      <label htmlFor={id}>{meta.label}</label>
      <select
        id={id}
        className="field"
        value={value}
        aria-describedby={descId}
        onChange={(e) => onChange(path, e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>{labelFor(o)}</option>
        ))}
      </select>
      <p className="fc-help" id={descId}>{meta.help}</p>
    </div>
  );
}

export function DisciplineDetail({
  section, derived, onNumber, onField, invalidPaths,
}: DisciplineDetailProps): JSX.Element {
  const d = section.detail;
  const id = section.id as CoreDisciplineId;
  const systems = GRADE_SYSTEMS_FOR_DISCIPLINE[id] ?? ['none'];
  // A system the definition carries but this discipline does not normally use
  // is still offered, so an import is never silently rewritten.
  const systemOptions = systems.includes(d.gradeSystem) ? systems : [...systems, d.gradeSystem];
  const ranks = GRADE_RANKS[d.gradeSystem as keyof typeof GRADE_RANKS] ?? ['none.unranked'];
  const rankOptions = ranks.includes(d.gradeRank) ? ranks : [...ranks, d.gradeRank];
  const specs = SPECIALISATIONS_BY_DISCIPLINE[id] ?? [];

  const setCompetition = (key: string, value: unknown): void => {
    // The competition block is written whole so the three required fields of
    // `DisciplineCompetition` always exist together; a partial write would be
    // a definition the validator refuses.
    onField(d.competitionPath, {
      ...d.competition,
      bouts: d.competition.bouts,
      wins: d.competition.wins,
      level: d.competition.level,
      [key]: value,
    });
  };

  const compNum = (key: keyof typeof d.competition, meta: FieldMeta): JSX.Element => (
    <Num
      path={`${d.competitionPath}.${key}`}
      meta={meta}
      value={d.competition[key] as number}
      onChange={(_p, v) => setCompetition(key, v)}
      invalid={invalidPaths.has(`${d.competitionPath}.${key}`)}
    />
  );

  return (
    <div className="disc-detail">
      {derived ? (
        <p className="disc-derived mono" role="status">
          <span>T{derived.tier} {derived.tierName}</span>
          <span>eff. mean {derived.mean.toFixed(1)}</span>
          <span>rust x{derived.rustMult.toFixed(3)}</span>
          <span>prior {derived.prior.toFixed(1)}</span>
          <span>yr worth x{derived.yearsQualityMult.toFixed(3)}</span>
          <span>{derived.effectiveYears.toFixed(2)} eff. yr</span>
          {derived.isBase ? <span>base art</span> : null}
        </p>
      ) : (
        <p className="fc-note">The draft will not derive, so there is no live tier to show yet.</p>
      )}

      <h5 className="fc-h fc-h--sub">Training</h5>
      <div className="fc-grid fc-grid--tight">
        <Num path={d.startAgePath} meta={DISCIPLINE_META.startAge} value={d.startAge}
          onChange={onNumber} invalid={invalidPaths.has(d.startAgePath)} />
        <Num path={d.hoursPath} meta={DISCIPLINE_META.hoursPerWeek} value={d.hoursPerWeek} step={0.5}
          onChange={onNumber} invalid={invalidPaths.has(d.hoursPath)} />
        <Num path={d.sessionsPath} meta={DISCIPLINE_META.sessionsPerWeek} value={d.sessionsPerWeek}
          onChange={onNumber} invalid={invalidPaths.has(d.sessionsPath)} />
        <Num path={d.coachPath} meta={DISCIPLINE_META.coachQuality} value={d.coachQuality}
          onChange={onNumber} invalid={invalidPaths.has(d.coachPath)} />
        <Num path={d.sparringPath} meta={DISCIPLINE_META.sparringIntensity} value={d.sparringIntensity}
          onChange={onNumber} invalid={invalidPaths.has(d.sparringPath)} />
        <Num path={d.rustPath} meta={DISCIPLINE_META.monthsSinceTrained} value={d.monthsSinceTrained}
          onChange={onNumber} invalid={invalidPaths.has(d.rustPath)} />
      </div>

      <div className="fc-field fc-field--checkbox">
        <input
          id={fieldIdForPath(d.isBasePath)}
          type="checkbox"
          checked={d.isBase}
          aria-describedby={describedByIdForPath(d.isBasePath)}
          onChange={(e) => onField(d.isBasePath, e.target.checked)}
        />
        <label htmlFor={fieldIdForPath(d.isBasePath)}>{DISCIPLINE_META.isBase.label}</label>
        <p className="fc-help" id={describedByIdForPath(d.isBasePath)}>{DISCIPLINE_META.isBase.help}</p>
      </div>

      <h5 className="fc-h fc-h--sub">Grade</h5>
      <div className="fc-grid fc-grid--tight">
        <Pick
          path={d.gradeSystemPath}
          meta={DISCIPLINE_META.grade}
          value={d.gradeSystem}
          options={systemOptions}
          labelFor={(v) => GRADE_SYSTEM_LABELS[v] ?? v}
          onChange={(_p, v) => {
            // Switching the system has to move the rank with it, or the grade
            // would name a belt the new system has never heard of and score 0.
            const first = (GRADE_RANKS[v as keyof typeof GRADE_RANKS] ?? ['none.unranked'])[0];
            onField(d.gradeSystemPath.replace(/\.system$/, ''), { system: v, rank: first, stripes: 0 });
          }}
        />
        <Pick
          path={d.gradeRankPath}
          meta={{ label: 'Rank', help: 'The rank held. Its prior floors every effective sub-skill in this art at 85 % of the listed value.' }}
          value={d.gradeRank}
          options={rankOptions}
          labelFor={(v) => GRADE_RANK_LABELS[v] ?? v}
          onChange={(p, v) => onField(p, v)}
        />
        {d.gradeSystem === 'bjjBelt' ? (
          <Num path={d.stripesPath} meta={DISCIPLINE_META.stripes} value={d.stripes}
            onChange={onNumber} invalid={invalidPaths.has(d.stripesPath)} />
        ) : null}
      </div>
      {derived ? (
        <p className="fc-note mono">
          grade prior {derived.gradePrior.toFixed(1)} &middot; competition prior {derived.competitionPrior.toFixed(1)}
          {' '}&rarr; floor {(0.85 * derived.prior).toFixed(1)} on every sub-skill
        </p>
      ) : null}

      <h5 className="fc-h fc-h--sub">Competition record in this art</h5>
      <div className="fc-grid fc-grid--tight">
        <Pick
          path={`${d.competitionPath}.level`}
          meta={DISCIPLINE_COMPETITION_META.level}
          value={d.competition.level}
          options={COMPETITION_LEVELS}
          labelFor={(v) => v.charAt(0).toUpperCase() + v.slice(1)}
          onChange={(_p, v) => setCompetition('level', v)}
        />
        {compNum('bouts', DISCIPLINE_COMPETITION_META.bouts)}
        {compNum('wins', DISCIPLINE_COMPETITION_META.wins)}
        {compNum('losses', DISCIPLINE_COMPETITION_META.losses)}
        {compNum('draws', DISCIPLINE_COMPETITION_META.draws)}
        {compNum('amateurBouts', DISCIPLINE_COMPETITION_META.amateurBouts)}
        {compNum('amateurWins', DISCIPLINE_COMPETITION_META.amateurWins)}
        {compNum('proBouts', DISCIPLINE_COMPETITION_META.proBouts)}
        {compNum('proWins', DISCIPLINE_COMPETITION_META.proWins)}
        <Pick
          path={`${d.competitionPath}.bestPlacing`}
          meta={DISCIPLINE_COMPETITION_META.bestPlacing}
          value={d.competition.bestPlacing}
          options={PLACING_IDS}
          labelFor={(v) => PLACING_LABELS[v] ?? v}
          onChange={(_p, v) => setCompetition('bestPlacing', v)}
        />
        {compNum('medals', DISCIPLINE_COMPETITION_META.medals)}
      </div>

      <h5 className="fc-h fc-h--sub">Specialisations</h5>
      <p className="fc-blurb">{DISCIPLINE_META.specialisations.help}</p>
      {specs.length === 0 ? (
        <p className="fc-note">No specialisations are catalogued for this discipline.</p>
      ) : (
        <div className="fc-chips" role="group" aria-label={`${section.label} specialisations`}>
          {specs.map((spec) => {
            const on = d.specialisations.includes(spec.id);
            const rank = d.specialisations.indexOf(spec.id);
            return (
              <button
                key={spec.id}
                type="button"
                className="btn btn--chip"
                aria-pressed={on}
                title={`${spec.note} +${spec.emphasis.join(', ')}${spec.tradeoff?.length ? ` / -${spec.tradeoff.join(', ')}` : ''}`}
                onClick={() =>
                  onField(
                    d.specialisationsPath,
                    on ? d.specialisations.filter((s) => s !== spec.id) : [...d.specialisations, spec.id],
                  )
                }
              >
                {spec.label}
                {on && rank > 0 ? <span className="chip-rank"> x{Math.pow(0.6, rank).toFixed(2)}</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
