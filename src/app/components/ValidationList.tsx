/**
 * VALIDATION LIST — errors and warnings, each one a way back to the field.
 *
 * The rule the editor is built around: invalid state stays editable. Validation
 * never blocks a keystroke, never reverts a value and never closes a tab; it
 * only decides whether Save is enabled. So this list has to do the opposite of
 * a modal — it has to get the user *to* the problem. Clicking an issue focuses
 * the control that owns its `path`, which is why every control's DOM id is
 * derived from its path rather than hand-assigned.
 *
 * Errors and warnings are shown together and ranked, because a warning ("this
 * fighter is 2.08 m tall") is often the interesting one: it means the
 * definition is legal but outside anything the model was calibrated on.
 */

import { fieldIdForPath } from '../model/paths';
import type { ValidationIssue, ValidationResult } from '../store/types';

export interface ValidationListProps {
  result: ValidationResult;
  /** Called with the issue's path so the editor can open the owning section first. */
  onSelectIssue: (issue: ValidationIssue) => void;
  /** Shown when there is nothing to report. */
  emptyText?: string;
}

/**
 * Move focus to the control for `path`.
 *
 * Exported because the editor calls it *after* switching tabs: focusing a
 * control inside a hidden panel silently does nothing, so the section has to
 * open first and the focus has to happen on the next frame.
 */
export function focusPath(path: string): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.getElementById(fieldIdForPath(path));
  if (!el) return false;
  (el as HTMLElement).focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

export function ValidationList({ result, onSelectIssue, emptyText }: ValidationListProps): JSX.Element {
  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  const ordered = [...errors, ...warnings];

  return (
    <div className="validation">
      <div className="validation-head">
        <span className={`badge ${errors.length > 0 ? 'badge--bad' : 'badge--ok'}`}>
          {errors.length === 0 ? 'saveable' : `${errors.length} error${errors.length === 1 ? '' : 's'}`}
        </span>
        {warnings.length > 0 ? (
          <span className="badge badge--info">
            {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {ordered.length === 0 ? (
        <p className="fc-note">{emptyText ?? 'Nothing to report. This definition derives cleanly.'}</p>
      ) : (
        <ul className="validation-list">
          {ordered.map((issue, i) => (
            <li key={`${issue.path}:${i}`} className={`validation-item validation-item--${issue.severity}`}>
              <button
                type="button"
                className="validation-jump"
                onClick={() => onSelectIssue(issue)}
                // The accessible name has to carry the field, not just the
                // message: a list of twelve "must be between 0 and 100" buttons
                // is unusable read aloud.
                aria-label={`${issue.severity}: ${issue.message} (${issue.path}). Activate to edit this field.`}
              >
                <code className="validation-path">{issue.path}</code>
                <span className="validation-message">{issue.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Paths carrying at least one error, for ringing the offending controls. */
export function errorPaths(result: ValidationResult): Set<string> {
  const out = new Set<string>();
  for (const issue of result.issues) {
    if (issue.severity === 'error') out.add(issue.path);
  }
  return out;
}
