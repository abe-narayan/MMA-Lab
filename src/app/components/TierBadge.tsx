/**
 * TIER BADGE — one consistent way to print T0-T5 anywhere in the creator.
 *
 * Tier is the vocabulary chapter 01 uses to say what a fighter visibly does,
 * so it appears on discipline headers, on database rows and in the derived
 * panel. Rendering it from one component keeps the colour ramp and the
 * spelling identical in all three, and gives every badge the same accessible
 * name ("Tier 4, Elite") rather than a bare "T4" a screen reader has to guess at.
 */

import { TIER_NAMES, type SkillTier } from '../../sim';

export interface TierBadgeProps {
  tier: number;
  /** Print the tier name beside the number. Off on dense rows. */
  showName?: boolean;
  /** Dim the badge for a discipline the fighter has never trained. */
  muted?: boolean;
  title?: string;
}

export function TierBadge({ tier, showName = false, muted = false, title }: TierBadgeProps): JSX.Element {
  const t = (Math.max(0, Math.min(5, Math.round(tier))) as SkillTier);
  const name = TIER_NAMES[t];
  return (
    <span
      className={`tier-badge tier-badge--t${t}${muted ? ' tier-badge--muted' : ''}`}
      data-tier={t}
      title={title ?? `Tier ${t} — ${name}`}
    >
      <span aria-hidden="true">T{t}</span>
      {showName ? <em>{name}</em> : null}
      <span className="visually-hidden">Tier {t}, {name}</span>
    </span>
  );
}
