/**
 * DESIGN-SYSTEM PRIMITIVES — Button, StatusBadge, Tooltip/InfoTip, Switch,
 * Segmented, Field, Select, Slider, Alert, Progress.
 *
 * Styling lives in src/app/theme.css under the `ui-` prefix; these components
 * only own structure and accessibility wiring (labels, `aria-describedby`,
 * keyboard behaviour). They are deliberately thin: a screen should be able to
 * read like plain JSX, and every one of these renders under
 * `react-dom/server` so the creator tests can assert on real markup.
 */

import {
  forwardRef, useId, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode,
} from 'react';

// --------------------------------------------------------------------------
// Button
// --------------------------------------------------------------------------

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'danger-solid';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Shows a spinner and sets aria-busy; the button stays focusable. */
  busy?: boolean;
  /** Icon-only buttons must carry an aria-label; this enforces the shape. */
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon, busy = false, iconOnly = false, className, children, type, ...rest },
  ref,
) {
  const cls = [
    'ui-btn',
    variant !== 'default' ? `ui-btn--${variant}` : '',
    size !== 'md' ? `ui-btn--${size}` : '',
    iconOnly ? 'ui-btn--icon' : '',
    className ?? '',
  ].filter(Boolean).join(' ');
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cls}
      aria-busy={busy || undefined}
      data-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="ui-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

// --------------------------------------------------------------------------
// StatusBadge
// --------------------------------------------------------------------------

export type Tone = 'neutral' | 'ok' | 'warn' | 'alert' | 'info' | 'accent' | 'outline';

export function StatusBadge({
  tone = 'neutral', dot = false, children, title,
}: { tone?: Tone; dot?: boolean; children: ReactNode; title?: string }): JSX.Element {
  return (
    <span className="ui-badge" data-tone={tone} data-dot={dot || undefined} title={title}>
      {children}
    </span>
  );
}

// --------------------------------------------------------------------------
// Tooltip / InfoTip
// --------------------------------------------------------------------------

/**
 * A CSS tooltip that shows on hover *and* keyboard focus of anything inside
 * it. The tip text is also wired as the trigger's accessible description via
 * `aria-describedby`, so screen readers get it without hovering.
 */
export function Tooltip({
  content, children, side = 'top',
}: { content: ReactNode; children: (describedBy: string) => ReactNode; side?: 'top' | 'bottom' | 'right' }): JSX.Element {
  const id = useId();
  return (
    <span className="ui-tip-wrap">
      {children(id)}
      <span role="tooltip" id={id} className="ui-tip" data-side={side}>{content}</span>
    </span>
  );
}

/** The small "i" button with an explanation tooltip. */
export function InfoTip({ text, label = 'More information' }: { text: ReactNode; label?: string }): JSX.Element {
  return (
    <Tooltip content={text}>
      {(id) => (
        <button type="button" className="ui-info" aria-label={label} aria-describedby={id}>i</button>
      )}
    </Tooltip>
  );
}

// --------------------------------------------------------------------------
// Switch and Segmented
// --------------------------------------------------------------------------

export function Switch({
  checked, onChange, label, disabled, id,
}: { checked: boolean; onChange: (next: boolean) => void; label: ReactNode; disabled?: boolean; id?: string }): JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      className="ui-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch-track" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

/**
 * A radio group drawn as a segmented control. Arrow keys move the selection
 * (the WAI-ARIA radio pattern), and only the selected option is in the tab
 * order.
 */
export function Segmented<T extends string>({
  value, options, onChange, label,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}): JSX.Element {
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = options.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('button');
    buttons[next]?.focus();
  };
  return (
    <div className="ui-seg" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------
// Field, Select, Slider
// --------------------------------------------------------------------------

export interface FieldRenderProps {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

/**
 * A labelled field with an optional hint and a validation message. The
 * control is rendered by the caller (any input) with the id and
 * `aria-describedby` this provides, so the message is announced with it.
 */
export function Field({
  label, hint, error, id: fixedId, children, className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  id?: string;
  className?: string;
  children: (p: FieldRenderProps) => ReactNode;
}): JSX.Element {
  const auto = useId();
  const id = fixedId ?? `f${auto.replace(/:/g, '')}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`ui-field${className ? ` ${className}` : ''}`} data-invalid={error ? true : undefined}>
      <label className="ui-field-label" htmlFor={id}>{label}</label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? <p className="ui-field-error" id={errId} role="alert">{error}</p> : null}
      {hint ? <p className="ui-field-hint" id={hintId}>{hint}</p> : null}
    </div>
  );
}

export function Select<T extends string>({
  label, value, options, onChange, hint, error, disabled, id,
}: {
  label: ReactNode;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  hint?: ReactNode;
  error?: string | null;
  disabled?: boolean;
  id?: string;
}): JSX.Element {
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      {(p) => (
        <select
          id={p.id}
          className="field"
          value={value}
          disabled={disabled}
          aria-invalid={p.invalid || undefined}
          aria-describedby={p.describedBy}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * A range slider with its value printed beside the label and an optional
 * number box for exact entry. The filled part of the track follows the value
 * through a CSS custom property, so it works in every engine.
 */
export function Slider({
  label, value, min, max, step = 1, onChange, format, disabled, hint, withNumber = false, id: fixedId,
  describedBy: extraDescribedBy,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
  hint?: ReactNode;
  withNumber?: boolean;
  id?: string;
  describedBy?: string;
}): JSX.Element {
  const auto = useId();
  const id = fixedId ?? `s${auto.replace(/:/g, '')}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const fill = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  const text = format ? format(value) : String(value);
  const describedBy = [hintId, extraDescribedBy].filter(Boolean).join(' ') || undefined;
  return (
    <div className="ui-slider">
      <div className="ui-slider-head">
        <label className="ui-slider-label" htmlFor={id}>{label}</label>
        {withNumber ? null : <span className="ui-slider-value" aria-hidden="true">{text}</span>}
      </div>
      <input
        id={id}
        className="ui-slider-input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : min}
        disabled={disabled}
        aria-valuetext={text}
        aria-describedby={describedBy}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {withNumber ? (
        <input
          className="field ui-slider-number"
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : min}
          disabled={disabled}
          aria-label={typeof label === 'string' ? `${label} (exact value)` : 'Exact value'}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value !== '' && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
        />
      ) : <span />}
      {hint ? <p className="ui-field-hint" id={hintId} style={{ gridColumn: '1 / -1' }}>{hint}</p> : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// Alert and Progress
// --------------------------------------------------------------------------

export function Alert({
  tone = 'info', children, action, role,
}: { tone?: 'info' | 'ok' | 'warn' | 'alert'; children: ReactNode; action?: ReactNode; role?: 'status' | 'alert' }): JSX.Element {
  return (
    <div className="ui-alert" data-tone={tone} role={role ?? (tone === 'alert' ? 'alert' : 'status')}>
      <div className="ui-alert-body">{children}</div>
      {action}
    </div>
  );
}

export function Progress({
  value, label, indeterminate = false,
}: { value: number; label: string; indeterminate?: boolean }): JSX.Element {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div
      className="ui-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      data-indeterminate={indeterminate || undefined}
      style={{ ['--value' as string]: `${pct}%` }}
    >
      <i />
    </div>
  );
}
