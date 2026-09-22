/**
 * FAMILY SETS — how the decision core groups the shared `ActionFamily`
 * vocabulary of `contracts.ts`.
 *
 * `contracts.ts` owns the family *list* (it is the join between the plan
 * generator and the action layer). This file owns the *partitions* the
 * consideration curves of §2.2.2 read: which families are strikes, which are
 * kicks, which are counter-window entries, which are exits. Keeping them here
 * rather than inline in `utility.ts` means the tier catalogue, the adjustment
 * table and the opponent model all agree on what "kicks x0.6" means.
 *
 * A second vocabulary lives here too: `OppFamily`, the twelve coarse buckets
 * the online tendency table of §2.4.3 counts. It is deliberately smaller than
 * `ActionFamily` because 72 contexts x 12 families is the memory budget the
 * chapter sets, and because a fighter does not learn "he throws lead hooks" —
 * he learns "he throws power punches".
 */
import type { TechniqueFamily } from '../striking/catalogue';
import { ACTION_FAMILIES, type ActionFamily } from './contracts';

export { ACTION_FAMILIES };
export type { ActionFamily };

const FAMILY_SET: ReadonlySet<string> = new Set<string>(ACTION_FAMILIES);

export function isActionFamily(s: string): s is ActionFamily {
  return FAMILY_SET.has(s);
}

// ---------------------------------------------------------------------------
// §2.4.3 — the opponent model's twelve buckets
// ---------------------------------------------------------------------------

export const OPP_FAMILIES = [
  'jab', 'power', 'kick', 'knee', 'elbow', 'levelChange', 'clinchEntry',
  'takedown', 'groundStrike', 'submission', 'movement', 'defend',
] as const;

export type OppFamily = (typeof OPP_FAMILIES)[number];

export const OPP_FAMILY_COUNT = OPP_FAMILIES.length;

const OPP_INDEX: ReadonlyMap<string, number> =
  new Map(OPP_FAMILIES.map((f, i) => [f as string, i] as const));

export function oppFamilyIndex(f: OppFamily): number {
  return OPP_INDEX.get(f) ?? 0;
}

/** §2.4.3 context axis: the six buckets of "what I threw last". */
export const MY_LAST_FAMILIES = [
  'none', 'jab', 'power', 'kick', 'levelChange', 'clinchEntry',
] as const;

export type MyLastFamily = (typeof MY_LAST_FAMILIES)[number];

export const MY_LAST_FAMILY_COUNT = MY_LAST_FAMILIES.length;

// ---------------------------------------------------------------------------
// Catalogue joins
// ---------------------------------------------------------------------------

const set = (...xs: ActionFamily[]): ReadonlySet<ActionFamily> => new Set(xs);

/**
 * §02 `TechniqueFamily` + limb -> our family. Chapter 02 only knows "straight";
 * the plan rules distinguish the jab from the cross (R-1 raises them by
 * different amounts), so the limb decides.
 */
export function familyForTechnique(
  family: TechniqueFamily,
  limb: 'leadHand' | 'rearHand' | 'leadLeg' | 'rearLeg' | 'both',
  target?: 'head' | 'body' | 'leadLeg' | 'rearLeg' | 'arms',
): ActionFamily {
  switch (family) {
    case 'straight': return limb === 'leadHand' ? 'jab' : 'cross';
    case 'hook':
      if (target === 'body') return 'bodyHook';
      return limb === 'leadHand' ? 'leadHook' : 'hook';
    case 'uppercut': return 'uppercut';
    case 'overhand': return 'overhand';
    case 'elbow': return 'elbow';
    case 'knee': return 'knee';
    case 'teep': return 'teep';
    case 'lowKick': return limb === 'leadLeg' ? 'leadLowKick' : 'lowKick';
    case 'bodyKick': return limb === 'leadLeg' ? 'bodyKick' : 'rearKick';
    case 'headKick': return 'headKick';
    case 'spinning': return 'spinning';
    default: return 'jab';
  }
}

/** Collapse an action family onto the coarse bucket the opponent model counts. */
export function oppFamilyOf(f: ActionFamily): OppFamily {
  switch (f) {
    case 'jab': return 'jab';
    case 'cross': case 'hook': case 'leadHook': case 'uppercut': case 'overhand':
    case 'bodyHook': case 'spinning': case 'baitCross': case 'parryCross':
    case 'counterWindow': case 'leadStrike':
      return 'power';
    case 'teep': case 'lowKick': case 'leadLowKick': case 'bodyKick':
    case 'headKick': case 'rearKick': case 'check':
      return 'kick';
    case 'knee': return 'knee';
    case 'elbow': return 'elbow';
    case 'levelChange': case 'feint': case 'slipEntry':
      return 'levelChange';
    case 'clinchEntry': case 'clinchStrike': case 'breakClinch': case 'cagePin':
    case 'frontHeadlock':
      return 'clinchEntry';
    case 'shoot': case 'nakedShot': case 'shootOffStrikes': case 'bodylockTd':
    case 'trip': case 'guardPull':
      return 'takedown';
    case 'groundStrike': case 'pass': case 'ride': case 'backTake':
      return 'groundStrike';
    case 'submission': case 'bottomSubmission':
      return 'submission';
    case 'advance': case 'retreat': case 'circle': case 'circleAway': case 'lateral':
    case 'pivot': case 'inOut': case 'standUp': case 'wallWalk': case 'sweep':
    case 'flee': case 'switchStance':
      return 'movement';
    default:
      return 'defend';
  }
}

/** The `myLastFamily` context axis (§2.4.3). */
export function myLastFamilyOf(f: ActionFamily | null): MyLastFamily {
  if (f === null) return 'none';
  const coarse = oppFamilyOf(f);
  switch (coarse) {
    case 'jab': return 'jab';
    case 'power': return 'power';
    case 'kick': return 'kick';
    case 'levelChange': case 'takedown': return 'levelChange';
    case 'clinchEntry': return 'clinchEntry';
    default: return 'none';
  }
}

/**
 * §2.4.3 `threatWeight(family)`: expected damage per attempt, normalised so
 * `expectedThreat = sum_f P(f) x threatWeight(f)` lands in [0, 1].
 */
export const THREAT_WEIGHT: Readonly<Record<OppFamily, number>> = Object.freeze({
  jab: 0.20,
  power: 0.90,
  kick: 0.60,
  knee: 0.75,
  elbow: 0.80,
  levelChange: 0.35,
  clinchEntry: 0.30,
  takedown: 0.55,
  groundStrike: 0.50,
  submission: 0.85,
  movement: 0.05,
  defend: 0.02,
});

// ---------------------------------------------------------------------------
// Partitions the consideration curves read
// ---------------------------------------------------------------------------

export const PUNCH_FAMILIES = set(
  'jab', 'cross', 'hook', 'leadHook', 'uppercut', 'overhand', 'bodyHook',
  'baitCross', 'parryCross',
);

export const KICK_FAMILIES = set(
  'teep', 'lowKick', 'leadLowKick', 'bodyKick', 'headKick', 'rearKick', 'spinning',
);

/** Everything that puts a strike in the air. */
export const STRIKE_FAMILIES = set(
  'jab', 'cross', 'hook', 'leadHook', 'uppercut', 'overhand', 'bodyHook', 'spinning',
  'teep', 'lowKick', 'leadLowKick', 'bodyKick', 'headKick', 'rearKick', 'knee', 'elbow',
  'clinchStrike', 'groundStrike', 'baitCross', 'parryCross', 'counterWindow', 'leadStrike',
);

/** Level changes and takedown entries — the `c.setup` and W-1 families. */
export const SHOT_FAMILIES = set(
  'levelChange', 'shoot', 'nakedShot', 'shootOffStrikes', 'bodylockTd', 'trip', 'guardPull',
);

/** Pressure, clinch and TD families — `c.opp_fatigue` and the cage rules. */
export const PRESSURE_FAMILIES = set(
  'advance', 'clinchEntry', 'clinchStrike', 'cagePin', 'shoot', 'shootOffStrikes',
  'nakedShot', 'bodylockTd', 'trip', 'levelChange', 'pass', 'ride',
);

/** Finish-seeking families (§2.6.5). */
export const FINISH_FAMILIES = set(
  'cross', 'hook', 'leadHook', 'uppercut', 'overhand', 'spinning', 'headKick',
  'rearKick', 'knee', 'elbow', 'groundStrike', 'submission', 'backTake',
);

/** Defensive families — damped when the opponent is hurt, boosted when we are. */
export const DEFENSIVE_FAMILIES = set(
  'block', 'check', 'longGuard', 'sprawl', 'retreat', 'circle', 'circleAway',
  'pivot', 'wait', 'standUp', 'wallWalk', 'breakClinch',
);

/** Families that relocate the fighter; `c.range_target` applies only to these. */
export const MOVEMENT_FAMILIES = set(
  'advance', 'retreat', 'circle', 'circleAway', 'lateral', 'pivot', 'inOut', 'flee',
);

/** Families that close distance. */
export const ADVANCING_FAMILIES = set('advance', 'inOut');

/** Families that open distance. */
export const RETREATING_FAMILIES = set('retreat', 'circleAway', 'flee');

/** Counter-window families (§2.2.2 `c.expected_threat`, §2.4.4 counter-on-read). */
export const COUNTER_FAMILIES = set(
  'counterWindow', 'parryCross', 'baitCross', 'cross', 'overhand', 'leadHook',
  'uppercut', 'knee', 'teep', 'headKick', 'check', 'sprawl',
);

/** Lead families — damped when the opponent is about to attack. */
export const LEAD_FAMILIES = set(
  'jab', 'leadStrike', 'teep', 'lowKick', 'leadLowKick', 'feint', 'advance',
  'levelChange', 'shoot', 'shootOffStrikes', 'nakedShot', 'clinchEntry',
);

/** Exit families the `c.dwell` limit boosts (§2.2.2, V-2 / F-2). */
export const EXIT_FAMILIES = set(
  'retreat', 'circle', 'circleAway', 'lateral', 'pivot', 'breakClinch',
  'standUp', 'wallWalk', 'flee', 'inOut',
);

/** Families whose accuracy depends on the legs (`c.balance`). */
export const BALANCE_FAMILIES = set(
  'teep', 'lowKick', 'leadLowKick', 'bodyKick', 'headKick', 'rearKick', 'spinning',
  'shoot', 'nakedShot', 'shootOffStrikes', 'bodylockTd', 'trip', 'levelChange',
);

/** Families that rest rather than spend — clinch-as-recovery. */
export const REST_FAMILIES = set('clinchEntry', 'cagePin', 'ride', 'wait', 'wallWalk');

/** Families the `adj.*` rows call "swinging" (the reckless finisher). */
export const SWING_FAMILIES = set('hook', 'leadHook', 'overhand', 'spinning', 'uppercut');

/** Straight punches and knees — the measured finisher's tools. */
export const STRAIGHT_FAMILIES = set('jab', 'cross', 'knee', 'teep');

/** Ground-bottom families. */
export const BOTTOM_FAMILIES = set('sweep', 'bottomSubmission', 'standUp', 'wallWalk', 'guardPull');

/** A neutral weight vector: every family at 1.0. */
export function neutralFamilyWeights(): Record<ActionFamily, number> {
  const out = {} as Record<ActionFamily, number>;
  for (const f of ACTION_FAMILIES) out[f] = 1;
  return out;
}
