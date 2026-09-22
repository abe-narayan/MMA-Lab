/**
 * PLAN VIEW — what the decision core reads from a game plan, and how the plan
 * generator and the multi-opponent manager plug in.
 *
 * §2.5 (plan generation) and §2.7 (targeting) are the other half of chapter 07.
 * The action, perception and adaptation layers must not depend on *how* a plan
 * is produced, only on what it says, so this file declares the read side and a
 * registration hook instead of importing `./plan` and `./multi` directly. That
 * also means the decision core compiles and its tests run before those modules
 * exist.
 *
 * `bindings.ts` performs the registration for the in-tree implementations, so
 * importing the `ai` barrel gives a policy that plans. `PlanView` is
 * deliberately all-optional, so any superset of §2.5.2's field names is
 * structurally assignable to it: adding a field to `GamePlan` can never break
 * this side, and a partially-built plan is usable rather than a crash mid-bout.
 *
 * TODO(§2.7): `multi.ts` does not yet expose a `MultiTargetProvider`. Until it
 * does, targeting falls back to `tgt.nearest` — the documented T0-T1 policy.
 */
import type { World, FighterWorldState } from '../core/world';
import type { ObservedState } from '../core/perception';
import type { RNG } from '../rng';
import type {
  ActionFamily, CagePolicy, ClinchPolicy, GroundBottomPolicy, GroundTopPolicy,
  InitiativeId, ModeId, PhaseTarget, RangeTarget, RoleId, TargetPolicyId, TdPolicy,
} from './contracts';

export interface PlanRoundPacing {
  round: number;
  /** Strikes per minute the fighter intends to throw. */
  paceTarget?: number;
  tdAttemptTarget?: number;
  riskAppetite?: number;
  /** 0-1 share of the round budget spent hunting a finish. */
  finishSeeking?: number;
}

export interface PlanTrigger {
  /** The `adj.*` id this trigger may fire. */
  adjustment?: string;
  minIqTier?: number;
}

export interface PlanCornerCue {
  round?: number;
  /** The `adj.*` id the cue asks for, or `affirm` for CO-4. */
  adjustment?: string;
  text?: string;
  /** Pace cues take half uptake at T4+ (§2.5.7). */
  isPaceCue?: boolean;
}

/**
 * §2.5.2 as the action layer sees it. Every field is optional: a T1 plan is
 * `primaryMode` and nothing else (§2.5.8), and a partially-built plan must
 * still be usable rather than throwing mid-bout.
 */
export interface PlanView {
  primaryMode?: ModeId;
  fallbackMode?: ModeId | null;
  rangeTarget?: RangeTarget;
  phaseTarget?: PhaseTarget;
  initiative?: InitiativeId;
  primaryWeapons?: readonly ActionFamily[];
  secondaryWeapons?: readonly ActionFamily[];
  avoidList?: readonly ActionFamily[];
  mustNots?: readonly string[];
  /** Product of the matchup rules, already clamped to [0.25, 3]. */
  actionWeights?: Readonly<Partial<Record<ActionFamily, number>>>;
  tdPolicy?: TdPolicy;
  clinchPolicy?: ClinchPolicy;
  groundTopPolicy?: GroundTopPolicy;
  groundBottomPolicy?: GroundBottomPolicy;
  cagePolicy?: CagePolicy;
  roundPacing?: readonly PlanRoundPacing[];
  triggers?: readonly PlanTrigger[];
  cornerScript?: readonly PlanCornerCue[];
  quality?: number;
  /**
   * Optional limits. `null` means "the plan set no limit", which a generator
   * expresses differently from "the field is absent"; both are accepted so a
   * `GamePlan` from §2.5 assigns structurally without a translation step.
   */
  pocketDwellS?: number | null;
  clinchDwellS?: number | null;
  comboCapMax?: number | null;
}

/** `w_plan(a)`: the plan's multiplier for one family, 1.0 when it has none. */
export function planWeight(plan: PlanView | null, family: ActionFamily): number {
  if (!plan) return 1;
  const explicit = plan.actionWeights?.[family];
  if (explicit !== undefined && Number.isFinite(explicit)) return explicit;
  // A family on the soft avoid list is 0.6 even when no rule named it (§2.5.2).
  if (plan.avoidList?.includes(family)) return 0.6;
  return 1;
}

/** The pacing row for a round, falling back to the last row of the plan. */
export function pacingFor(plan: PlanView | null, round: number): PlanRoundPacing | null {
  const rows = plan?.roundPacing;
  if (!rows || rows.length === 0) return null;
  for (const r of rows) if (r.round === round) return r;
  return rows[rows.length - 1];
}

// ---------------------------------------------------------------------------
// Provider registration
// ---------------------------------------------------------------------------

/**
 * §2.5.3. Runs pre-bout, in fighter-id order, and may consume RNG draws
 * (scouting noise). `drawsPerFighter` lets the caller keep the stream in step
 * even for a fighter whose plan is null.
 */
export interface PlanProvider {
  drawsPerFighter(self: FighterWorldState): number;
  generate(world: World, self: FighterWorldState, rng: RNG): PlanView | null;
}

export interface TargetChoice {
  targetId: number | null;
  policy: TargetPolicyId;
  /** `w_multi` for engaging this target (§2.2.1); 1.0 in a plain 1v1. */
  weight: number;
  role: RoleId;
}

export interface MultiTargetProvider {
  /**
   * Called once per tick per fighter. `uSwitch` is draw 9 and has already been
   * consumed by the caller — the provider is handed the value, never the
   * generator, so it cannot move the stream.
   */
  select(
    world: World,
    self: FighterWorldState,
    observed: ObservedState | null,
    currentTargetId: number | null,
    uSwitch: number,
  ): TargetChoice;
}

let planProvider: PlanProvider | null = null;
let multiProvider: MultiTargetProvider | null = null;

export function setPlanProvider(p: PlanProvider | null): void {
  planProvider = p;
}

export function setMultiTargetProvider(p: MultiTargetProvider | null): void {
  multiProvider = p;
}

/** §2.5.8 T0 row: no report, no plan, style weights only. */
const NULL_PLAN_PROVIDER: PlanProvider = {
  drawsPerFighter: () => 0,
  generate: () => null,
};

/** §2.7.2 `tgt.nearest` — the current-engine behaviour, kept as the novice policy. */
const NEAREST_PROVIDER: MultiTargetProvider = {
  select(world, self, _observed, currentTargetId) {
    const near = world.nearestOpponent(self);
    return {
      targetId: near ? near.id : currentTargetId,
      policy: 'tgt.nearest',
      weight: 1,
      role: 'role.solo',
    };
  },
};

export function currentPlanProvider(): PlanProvider {
  return planProvider ?? NULL_PLAN_PROVIDER;
}

export function currentMultiTargetProvider(): MultiTargetProvider {
  return multiProvider ?? NEAREST_PROVIDER;
}
