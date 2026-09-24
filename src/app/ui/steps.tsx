/**
 * DESIGN-SYSTEM STEPS — numbered step sections, a progressive-disclosure
 * block, and a label row with an optional info tooltip.
 *
 * Used by the setup screens (Match setup, Tournaments), which read top to
 * bottom as "1 · Fighters → 2 · Rules → 3 · Options → 4 · Run". Styling is in
 * src/app/theme.css under `.ui-step`, `.ui-disclosure` and `.ui-label-row`.
 *
 *  - `Step` is a `<section>` labelled by its heading; the number is
 *    decorative (the heading text carries the meaning) and a `status` badge
 *    says whether the step is complete ("2 fighters", "Needs a fighter").
 *  - `Disclosure` is a native `<details>`: keyboard and screen-reader support
 *    come from the browser; `summaryNote` shows how many advanced values are
 *    changed from their defaults, so a closed section never hides a surprise.
 *  - `LabelRow` puts an `InfoTip` beside a `<label>` without nesting the
 *    button inside the label (interactive content inside a label is invalid).
 */
import { useId, type ReactNode } from 'react';
import { InfoTip, StatusBadge, type Tone } from './primitives';

export function Step({
  n, title, sub, status, statusTone = 'neutral', children, actions, id,
}: {
  n: number;
  title: ReactNode;
  sub?: ReactNode;
  status?: ReactNode;
  statusTone?: Tone;
  children: ReactNode;
  actions?: ReactNode;
  id?: string;
}): JSX.Element {
  const auto = useId();
  const headId = `${id ?? `step${auto.replace(/:/g, '')}`}-title`;
  return (
    <section className="ui-step" aria-labelledby={headId} id={id}>
      <header className="ui-step-head">
        <span className="ui-step-num" aria-hidden="true">{n}</span>
        <div className="ui-step-heading">
          <h2 className="ui-step-title" id={headId}>{title}</h2>
          {sub ? <p className="ui-step-sub">{sub}</p> : null}
        </div>
        {status ? <StatusBadge tone={statusTone} dot>{status}</StatusBadge> : null}
        {actions ? <div className="ui-step-actions">{actions}</div> : null}
      </header>
      <div className="ui-step-body">{children}</div>
    </section>
  );
}

export function Disclosure({
  summary, summaryNote, children, defaultOpen = false, className,
}: {
  summary: ReactNode;
  summaryNote?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <details className={`ui-disclosure${className ? ` ${className}` : ''}`} open={defaultOpen || undefined}>
      <summary>
        <span className="ui-disclosure-chevron" aria-hidden="true" />
        <span className="ui-disclosure-label">{summary}</span>
        {summaryNote ? <span className="ui-disclosure-note">{summaryNote}</span> : null}
      </summary>
      <div className="ui-disclosure-body">{children}</div>
    </details>
  );
}

export function LabelRow({
  htmlFor, label, tip, id,
}: { htmlFor?: string; label: ReactNode; tip?: ReactNode; id?: string }): JSX.Element {
  return (
    <div className="ui-label-row">
      {htmlFor
        ? <label className="ui-field-label" htmlFor={htmlFor} id={id}>{label}</label>
        : <span className="ui-field-label" id={id}>{label}</span>}
      {tip ? <InfoTip text={tip} label={typeof label === 'string' ? `About ${label.toLowerCase()}` : 'More information'} /> : null}
    </div>
  );
}
