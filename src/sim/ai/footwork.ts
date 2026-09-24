/**
 * FOOTWORK — range management keyed to *both* fighters' reach (Realism pass).
 *
 * Before this pass a fighter's intended distance was the midpoint of his own
 * band ("long" = the middle of his own long band), read through a movement
 * lottery re-drawn every 100 ms. Two consequences, both measured
 * (REALISM_PASS §2): every pairing fought at the same ~1.15 m whatever the
 * reaches were, and fighters reversed direction ~48 times a minute. Reach
 * could not matter because nobody used it.
 *
 * Here the preferred distance is where the *plan* wants to fight given the
 * geometry of this matchup (02 §2.1.1: the bands are asymmetric, so a longer
 * fighter owns a shell where he reaches and his opponent does not):
 *
 *   long   the outfighter stands at the end of his own jab, and, if he has
 *          the longer arms, just outside the other man's jab: in his shell.
 *   mid    the inside of his own mid band (hooks, uppercuts, body work).
 *   short  the close band, where the clinch starts.
 *
 * Movement is scored against that distance with a dead band (no in/out
 * wobble when he is where he wants to be) and committed for the duration of
 * the step (02 §2.1.5: 200-400 ms), so footwork reads as steps, not jitter.
 */
import type { FighterRuntime } from '../fighter';
import { BAND_BOUNDS, bandLimits, reachProfile, MOVEMENTS } from '../striking/range';
import { strikingCraft } from '../striking/tactics';

export const FOOTWORK = Object.freeze({
  /** Half-width of the band around the preferred distance where he holds [E]. */
  deadbandM: 0.10,
  /** Margin outside the opponent's jab the outfighter keeps, metres [E]. */
  outsideMarginM: 0.04,
  /** Margin inside his own jab end, so the jab is not thrown from the edge [E]. */
  ownEdgeMarginM: 0.06,
  /**
   * Backward is slower than forward: stepping back costs ~20 % of foot speed
   * (the rear foot has to lead; [E], consistent with BOX §4's retreat note).
   */
  retreatSpeedMult: 0.8,
  /** How far a landed or blocked straight/teep pushes an advancing opponent back, metres [E]. */
  pushbackM: { jab: 0.08, cross: 0.10, teep: 0.30, bodyKick: 0.12 } as Readonly<Record<string, number>>,
  /** Radial speed toward the opponent that counts as walking in, m/s [E]. */
  enteringSpeedMs: 0.5,
  /** Exposure a walk-in opens (02 §2.5.1 applied to an unguarded step, ms) [E]. */
  entryExposureMs: 250,
  /** A radial reversal this soon after the last step, near the wanted range, becomes a lateral step [E]. */
  momentumMs: 600,
});

export type RangeIntent = 'long' | 'mid' | 'short';

export interface PreferredDistance {
  /** Centre-to-centre metres. */
  dStar: number;
  deadband: number;
}

/**
 * Where this fighter wants to stand against this opponent. `pressure` in
 * [0, 1] shades "long" toward "mid" for a fighter whose plan leads with
 * pressure; `craft` (footwork/distance, 0-100) narrows the dead band — a
 * fighter who reads distance well holds it more precisely.
 */
export function preferredDistance(
  self: FighterRuntime, opp: FighterRuntime, intent: RangeIntent,
): PreferredDistance {
  const mine = bandLimits(reachProfile(self.effectiveReachM, self.effectiveKickReachM));
  const theirs = bandLimits(reachProfile(opp.effectiveReachM, opp.effectiveKickReachM));
  const craft = strikingCraft(self);
  const precision = Math.max(craft.footwork, craft.distance) / 100;
  const deadband = FOOTWORK.deadbandM * (1.3 - 0.6 * precision);
  let dStar: number;
  if (intent === 'long') {
    const ownJabEnd = mine.longMax - FOOTWORK.ownEdgeMarginM;
    const outsideHis = theirs.longMax + FOOTWORK.outsideMarginM;
    // In the shell if there is one; otherwise at the end of his own jab.
    dStar = outsideHis <= ownJabEnd ? outsideHis + 0.5 * (ownJabEnd - outsideHis) : ownJabEnd;
    // Never closer than the middle of the long band.
    dStar = Math.max(dStar, (mine.midMax + mine.longMax) / 2);
  } else if (intent === 'mid') {
    dStar = mine.closeMax + 0.45 * (mine.midMax - mine.closeMax);
  } else {
    dStar = (BAND_BOUNDS.clinchMax + mine.closeMax) / 2;
  }
  return { dStar, deadband };
}

/** A committed step's duration, ms (§2.1.5). */
export function stepMs(moveId: string): number {
  for (const m of MOVEMENTS) if (m.id === moveId) return m.ms > 0 ? m.ms : 200;
  return 200;
}
