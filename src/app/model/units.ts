/**
 * UNIT DISPLAY — metric is stored, both are shown.
 *
 * The definition is metric and stays metric: a fighter exported in one country
 * must import in another and produce a bit-identical bout, which rules out
 * storing whatever unit the author happened to type. The creator therefore
 * edits the metric value and prints the imperial reading beside it, so an
 * author who thinks in feet and pounds can still tell whether 1.88 m is the
 * height they meant.
 */

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

/** 1.88 -> `6' 2"`. */
export function metresToFeetInches(m: number): string {
  if (!Number.isFinite(m)) return '—';
  const totalInches = Math.round((m * 100) / CM_PER_IN);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches - feet * 12;
  return `${feet}' ${inches}"`;
}

/** 1.96 -> `77"` — reach is quoted in bare inches, not feet. */
export function metresToInches(m: number): string {
  if (!Number.isFinite(m)) return '—';
  return `${Math.round((m * 100) / CM_PER_IN)}"`;
}

export function kgToLb(kg: number): string {
  if (!Number.isFinite(kg)) return '—';
  return `${Math.round(kg / KG_PER_LB)} lb`;
}

export function metresToCm(m: number): string {
  if (!Number.isFinite(m)) return '—';
  return `${Math.round(m * 100)} cm`;
}

/** The dual reading the body tab prints under each measurement input. */
export function dualLength(m: number, kind: 'height' | 'reach'): string {
  return kind === 'height'
    ? `${metresToCm(m)} · ${metresToFeetInches(m)}`
    : `${metresToCm(m)} · ${metresToInches(m)}`;
}

export function dualMass(kg: number): string {
  if (!Number.isFinite(kg)) return '—';
  return `${kg.toFixed(1)} kg · ${kgToLb(kg)}`;
}
