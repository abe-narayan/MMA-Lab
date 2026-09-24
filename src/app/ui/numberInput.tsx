/**
 * A number box that lets the user type freely and commits on blur or Enter.
 *
 * Committing (and so clamping) on every keystroke makes many values
 * untypable: with a minimum of 40, the "7" of "75" snaps to 40 at once. So the
 * box keeps the typed text locally while focused and hands it to `onCommit`
 * only when the user is done: on blur or Enter. Escape drops the typed text
 * and shows the committed value again.
 */

import { useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';

export type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'defaultValue'> & {
  value: number;
  /** Called with the raw typed text; the caller clamps it (see `clampNumber`). */
  onCommit: (raw: string) => void;
};

/** What the box shows: the text being typed, else the committed value. */
export function numberInputText(draft: string | null, value: number): string {
  if (draft !== null) return draft;
  return Number.isFinite(value) ? String(value) : '0';
}

/** A range printed beside a number box, e.g. "40–150". */
export function rangeLabel(min: number | undefined, max: number | undefined): string | null {
  const ok = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && Math.abs(v) < 1e8;
  if (ok(min) && ok(max)) return `${min}–${max}`;
  if (ok(min)) return `≥ ${min}`;
  if (ok(max)) return `≤ ${max}`;
  return null;
}

export function NumberInput({ value, onCommit, onBlur, onKeyDown, ...rest }: NumberInputProps): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    setDraft(null);
    onCommit(draft);
  };
  return (
    <input
      {...rest}
      type="number"
      inputMode={rest.inputMode ?? 'decimal'}
      value={numberInputText(draft, value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => { commit(); onBlur?.(e); }}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape' && draft !== null) { e.stopPropagation(); setDraft(null); }
        onKeyDown?.(e);
      }}
    />
  );
}
