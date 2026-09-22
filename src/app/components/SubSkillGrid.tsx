/**
 * SUB-SKILL GRID — one discipline's named skills, with its live tier.
 *
 * The grid exists because a discipline is not one number. A judoka with
 * world-class throws and no newaza is a different fighter from one with the
 * means the other way round, and the only way to author that is to show every
 * named skill at once.
 *
 * The header carries the derived tier rather than a computed average, and says
 * so: the tier is gated by training years and, at T5, by fight IQ and
 * composure, so a grid full of 95s can still read T4. Showing the gate is more
 * useful than hiding it and letting the user wonder.
 *
 * Untrained disciplines are still listed, collapsed, with a button to take the
 * discipline up. "This fighter has no wrestling" is a fact worth seeing.
 */

import { AttributeSlider } from './AttributeSlider';
import { TierBadge } from './TierBadge';
import { DISCIPLINE_META } from '../model/fieldMeta';
import type { DisciplineSection } from '../model/editorModel';
import { clampNumber, describedByIdForPath, fieldIdForPath } from '../model/paths';

export interface SubSkillGridProps {
  section: DisciplineSection;
  /** Derived tier for this discipline; null while the definition will not derive. */
  tier: number | null;
  /** Mean of the effective sub-skills, after cross-discipline transfer. */
  effectiveMean: number | null;
  expanded: boolean;
  onToggleExpanded: (id: string) => void;
  onChange: (path: string, value: number) => void;
  onTrain: (id: string) => void;
  onUntrain: (id: string) => void;
  /** Paths that currently carry a validation error. */
  invalidPaths: ReadonlySet<string>;
}

export function SubSkillGrid({
  section, tier, effectiveMean, expanded, onToggleExpanded,
  onChange, onTrain, onUntrain, invalidPaths,
}: SubSkillGridProps): JSX.Element {
  const yearsId = fieldIdForPath(section.yearsPath);
  const qualityId = fieldIdForPath(section.qualityPath);
  const panelId = `${fieldIdForPath(section.id)}-panel`;

  return (
    <section className={`disc${section.trained ? '' : ' disc--untrained'}`} aria-labelledby={`${panelId}-h`}>
      <header className="disc-head">
        <button
          type="button"
          className="disc-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => onToggleExpanded(section.id)}
        >
          <span className="disc-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          <span className="disc-name" id={`${panelId}-h`}>{section.label}</span>
        </button>

        {tier === null ? (
          <span className="tag tag--alert">no tier</span>
        ) : (
          <TierBadge tier={tier} showName muted={!section.trained} />
        )}

        <span className="disc-meta mono">
          {section.trained ? `${section.years} yr` : 'untrained'}
          {effectiveMean !== null ? ` · eff. mean ${effectiveMean.toFixed(1)}` : ''}
        </span>

        {section.trained ? (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => onUntrain(section.id)}
            title="Remove this discipline. Sub-skills fall back to the 5-point untrained default."
          >
            Remove
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => onTrain(section.id)}>
            Train
          </button>
        )}
      </header>

      <div className="disc-body" id={panelId} hidden={!expanded}>
        {section.trained ? (
          <div className="disc-years">
            <div className="fc-field">
              <label htmlFor={yearsId}>{DISCIPLINE_META.years.label}</label>
              <input
                id={yearsId}
                className="field"
                type="number"
                min={DISCIPLINE_META.years.clamp?.min}
                max={DISCIPLINE_META.years.clamp?.max}
                step={0.5}
                value={section.years}
                aria-describedby={describedByIdForPath(section.yearsPath)}
                onChange={(e) =>
                  onChange(section.yearsPath, clampNumber(e.target.value, DISCIPLINE_META.years.clamp!, section.years))
                }
              />
              <p className="fc-help" id={describedByIdForPath(section.yearsPath)}>
                {DISCIPLINE_META.years.help}
              </p>
            </div>

            <div className="fc-field">
              <label htmlFor={qualityId}>{DISCIPLINE_META.trainingQuality.label}</label>
              <input
                id={qualityId}
                className="field"
                type="number"
                min={DISCIPLINE_META.trainingQuality.clamp?.min}
                max={DISCIPLINE_META.trainingQuality.clamp?.max}
                step={0.05}
                value={section.trainingQuality}
                aria-describedby={describedByIdForPath(section.qualityPath)}
                onChange={(e) =>
                  onChange(
                    section.qualityPath,
                    clampNumber(e.target.value, DISCIPLINE_META.trainingQuality.clamp!, section.trainingQuality),
                  )
                }
              />
              <p className="fc-help" id={describedByIdForPath(section.qualityPath)}>
                {DISCIPLINE_META.trainingQuality.help}
              </p>
            </div>
          </div>
        ) : (
          <p className="fc-note">
            Not trained. Every sub-skill sits at the 5-point untrained default, and the transfer
            matrix may still credit some of them from other disciplines &mdash; the derived panel
            shows the result.
          </p>
        )}

        <div className="subskill-grid">
          {section.subSkills.map((f) => (
            <AttributeSlider
              key={f.path}
              dense
              path={f.path}
              label={f.label}
              value={f.value}
              help={f.help}
              disabled={!section.trained}
              invalid={invalidPaths.has(f.path)}
              onChange={onChange}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
