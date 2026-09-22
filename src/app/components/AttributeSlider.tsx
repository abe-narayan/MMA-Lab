/**
 * ATTRIBUTE SLIDER — a 0-100 control that says what it feeds.
 *
 * Three decisions worth stating, because they are not free:
 *
 * 1. The range input and a number input are bound to the same value. The
 *    slider is for exploring, the box is for hitting 72 exactly. Dragging a
 *    slider to a specific integer is miserable, and typing is how anyone
 *    transcribing a fighter from a sheet actually works.
 * 2. The tier band behind the track is the *skill* band only. A discipline's
 *    real tier also depends on training years and, at T5, on fight IQ and
 *    composure, so the slider never claims to have set a tier — the derived
 *    panel says what the tier came out as.
 * 3. Out-of-range values are clamped on commit, never rejected mid-typing.
 *    An editor that blanks the field because you have typed "1" on the way to
 *    "100" is an editor that loses work.
 */

import { useId } from 'react';
import { bandOf, TIER_BANDS } from '../model/editorModel';
import { clampNumber, describedByIdForPath, fieldIdForPath } from '../model/paths';
import { ATTRIBUTE_CLAMP } from '../model/fieldMeta';

export interface AttributeSliderProps {
  /** Dotted path into the definition; also the control's DOM id. */
  path: string;
  label: string;
  value: number;
  /** What this attribute feeds, in the chapter's terms. */
  help: string;
  onChange: (path: string, value: number) => void;
  /** Marks the row when a validation issue points at this path. */
  invalid?: boolean;
  disabled?: boolean;
  /** Compact layout for the sub-skill grid. */
  dense?: boolean;
}

export function AttributeSlider({
  path, label, value, help, onChange, invalid = false, disabled = false, dense = false,
}: AttributeSliderProps): JSX.Element {
  const id = fieldIdForPath(path);
  const descId = describedByIdForPath(path);
  const band = bandOf(value);
  const helpId = useId();

  const commit = (raw: string): void => {
    onChange(path, clampNumber(raw, ATTRIBUTE_CLAMP, value));
  };

  return (
    <div
      className={`attr-slider${dense ? ' attr-slider--dense' : ''}${invalid ? ' attr-slider--invalid' : ''}`}
      data-path={path}
    >
      <label className="attr-slider-label" htmlFor={id}>
        {label}
      </label>

      <div className="attr-slider-track-wrap">
        {/* The band strip is decoration over the real input; it never receives
            pointer events, so dragging still works anywhere along the track. */}
        <div className="attr-slider-bands" aria-hidden="true">
          {TIER_BANDS.map((b) => (
            <span
              key={b.tier}
              className={`attr-slider-band${b.tier === band.tier ? ' is-active' : ''}`}
              style={{ flexGrow: b.hi - b.lo }}
              data-tier={b.tier}
            />
          ))}
        </div>
        <input
          id={id}
          className="attr-slider-range"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Number.isFinite(value) ? value : 0}
          disabled={disabled}
          aria-describedby={`${descId} ${helpId}`}
          aria-valuetext={`${Math.round(value)}, tier band ${band.tier} ${band.name}`}
          onChange={(e) => commit(e.target.value)}
        />
      </div>

      <input
        className="field attr-slider-number"
        type="number"
        min={0}
        max={100}
        step={1}
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        aria-label={`${label}, numeric entry`}
        aria-describedby={descId}
        onChange={(e) => commit(e.target.value)}
        // Clamp on blur as well: the number input will happily hold 9999 while
        // focused, and the definition must never see it.
        onBlur={(e) => commit(e.target.value)}
      />

      <span className="attr-slider-band-name" id={helpId} title={`Skill band ${band.lo}–${band.hi}`}>
        T{band.tier}
      </span>

      <p className="attr-slider-help" id={descId}>
        {help}
      </p>
    </div>
  );
}
