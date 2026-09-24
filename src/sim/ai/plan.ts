/**
 * PRE-FIGHT GAME PLAN — chapter 07 §2.5.
 *
 * The strategic layer. Runs once, pre-bout, per fighter, and produces the
 * object the tactical and action layers read all night: a mode, a range, a
 * short list of weapons, a shorter list of must-nots, a pacing profile and a
 * set of triggers. It is built from the *scouting report* (`ai/scout.ts`), not
 * from the opponent — a badly scouted opponent yields a confidently wrong
 * plan, which is failure mode §2.5.9 (1).
 *
 * What the generator is not allowed to do:
 *  - plan an action the ruleset forbids (a boxing plan never plans takedowns);
 *  - hand a T0 fighter a plan at all (`quality 0` does not exist: `null` does);
 *  - convert a physical advantage into a win-probability term (see the header
 *    of `plans/physical.ts`).
 *
 * Every weight the rules produce is clamped to [0.25, 3.0]
 * `[S: MMA_INTEGRATION §10 rule 22]`; families the ruleset forbids are then
 * forced to 0, which is outside the clamp on purpose — "illegal" is not
 * "unattractive".
 */
import type { Ruleset } from '../rules/types';
import type { FighterRuntime } from '../fighter';
import type { RNG } from '../rng';
import {
  ACTION_FAMILIES, PLANNABLE_MODES, STRIKING_MODES,
  clampWeights, multiplyInto, unitWeights,
} from './contracts';
import type {
  ActionFamily, ActionWeights, CagePolicy, ClinchPolicy, GroundBottomPolicy, GroundTopPolicy,
  InitiativeId, IqTier07, ModeId, MustNotId, PhaseTarget, PlanPolicyPatch, PlanRuleHit,
  RangeTarget, TdPolicy,
} from './contracts';
import { bandTier, iqTier07Of, scoutOpponent, type ScoutingReport } from './scout';
import {
  advantageOf, rulesetFactsOf, stancePairOf, type PlanContext,
} from './plans/context';
import { physicalRules } from './plans/physical';
import { stanceRules } from './plans/stance';
import { styleRules } from './plans/style';
import {
  phaseTargetOf, planShareOf, preferencesFor, rangeTargetOf, type StylePreferences,
} from './preferences';

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface RoundPacing {
  round: number;
  /** Intended significant strikes landed per minute. */
  paceTarget: number;
  /** Intended takedown attempts in this round. */
  tdAttemptTarget: number;
  riskAppetite: -2 | -1 | 0 | 1 | 2;
  /** Share of the bout's finish budget spent in this round. */
  finishSeeking: number;
}

export interface Trigger {
  /** `adj.*` id from §2.6.1. */
  id: string;
  /** Human-readable signal the tactical layer watches for. */
  signal: string;
  minIqTier: IqTier07;
  /** What the adjustment does, for the panel. */
  action: string;
  /** T4/T5 contingencies: what to do if the first adjustment does not work. */
  branch?: Trigger[];
}

export interface CornerCue {
  round: number;
  kind: 'technical' | 'affirmation';
  text: string;
  ruleId?: string;
}

export interface PlanRationale {
  ruleId: string;
  kind: PlanRuleHit['kind'];
  label: string;
  tag: string;
  /** The multipliers this rule contributed, for the UI panel. */
  weights: Partial<Record<ActionFamily, number>>;
}

export interface GamePlan {
  primaryMode: ModeId;
  fallbackMode: ModeId | null;
  rangeTarget: RangeTarget;
  /** ST-4 adds 0.1 m in an open stance. */
  rangeOffsetM: number;
  phaseTarget: PhaseTarget;
  initiative: InitiativeId;
  primaryWeapons: ActionFamily[];
  secondaryWeapons: ActionFamily[];
  avoidList: ActionFamily[];
  mustNots: MustNotId[];
  actionWeights: ActionWeights;
  tdPolicy: TdPolicy;
  clinchPolicy: ClinchPolicy;
  groundTopPolicy: GroundTopPolicy;
  groundBottomPolicy: GroundBottomPolicy;
  cagePolicy: CagePolicy;
  roundPacing: RoundPacing[];
  triggers: Trigger[];
  cornerScript: CornerCue[];
  /** Selection-time combination cap (must be <= chapter 02's availability cap). */
  comboCap: number;
  /** Seconds the plan allows in the pocket / clinched before it wants out. */
  pocketDwellS: number | null;
  clinchDwellS: number | null;
  clinchTimeTargetS: number | null;
  controlGapTargetS: number | null;
  longGuard: boolean;
  weightBack: boolean;
  stanceSwitching: boolean;
  /**
   * 01 §2.6 `goToSubmissions`, expanded through chapter 04's families and
   * filtered by what this fighter's tier and sub-skills can actually attempt.
   * Strongest preference first; empty when the author named none.
   */
  submissionTargets: string[];
  /** = iqTier07 (§2.5.8 feature gating). */
  quality: 0 | 1 | 2 | 3 | 4 | 5;
  /** The corner's version, in the order it would be said. */
  planLines: string[];
  rationale: PlanRationale[];
  /** Mode fitness scores, kept for the Model tab and for `adj.opp_adjusted`. */
  modeFitness: { mode: ModeId; own: number; oppWeak: number; veto: number; fitness: number }[];
  /** True when `style.gamePlanOverride` replaced the generated plan. */
  overridden: boolean;
}

// ---------------------------------------------------------------------------
// Parameters mirrored in params/multi.params.ts
// ---------------------------------------------------------------------------

/** `ai.plan.fallback_ratio`. */
export const FALLBACK_RATIO = 0.6;
/** `ai.plan.finishing_mode_aggression`. */
export const FINISHING_MODE_AGGRESSION = 70;
/** `ai.pace.final_round_intent`. */
export const FINAL_ROUND_PACE_MULT = 1.10;
/** `ai.pace.finish_budget` for a three-round bout. */
export const FINISH_BUDGET_3R: readonly number[] = [0.53, 0.30, 0.15];
/** Extra rounds keep falling away `[E]`, renormalised below. */
export const FINISH_BUDGET_TAIL: readonly number[] = [0.10, 0.07];
/** `ai.combo.cap.tier` — the AI's own selection cap by tier. */
export const COMBO_CAP_BY_TIER: readonly number[] = [2, 2, 3, 4, 4, 4];
/** `ai.plan.max_triggers` by iqTier (§2.5.8: none, none, 1-2, 3-5, multi-branch, +traps). */
export const MAX_TRIGGERS_BY_TIER: readonly number[] = [0, 0, 2, 5, 7, 9];
/** `ai.plan.max_mustnots` by iqTier. */
export const MAX_MUSTNOTS_BY_TIER: readonly number[] = [0, 0, 2, 4, 5, 6];
/** `ai.corner.max_cues`. */
export const MAX_CORNER_CUES_PER_ROUND = 2;
/** Weight at or below which a family is listed as "avoid". */
export const AVOID_THRESHOLD = 0.7;
/** Weight above which a family is a "weapon". */
export const WEAPON_THRESHOLD = 1.0;

/** Families that can be a primary/secondary weapon (movement and defence cannot). */
const WEAPON_FAMILIES: readonly ActionFamily[] = [
  'jab', 'cross', 'hook', 'leadHook', 'uppercut', 'overhand', 'bodyHook', 'spinning',
  'teep', 'lowKick', 'leadLowKick', 'bodyKick', 'headKick', 'rearKick', 'knee', 'elbow',
  'shoot', 'shootOffStrikes', 'bodylockTd', 'trip', 'clinchEntry', 'clinchStrike',
  'groundStrike', 'pass', 'sweep', 'submission', 'backTake', 'frontHeadlock', 'counterWindow',
];

/** Lower-variance first: the T3+ tie-break "hedge so the worst case is acceptable". */
const LOWER_VARIANCE_ORDER: readonly ModeId[] = [
  'mode.counter_striking', 'mode.distance_striking', 'mode.wrestle_control',
  'mode.clinch_grind', 'mode.sprawl_and_brawl', 'mode.pressure_striking',
  'mode.submission_hunt',
];
/** Finish-first: the T<=2 / high-aggression tie-break. */
const FINISHING_ORDER: readonly ModeId[] = [
  'mode.pressure_striking', 'mode.submission_hunt', 'mode.distance_striking',
  'mode.wrestle_control', 'mode.clinch_grind', 'mode.counter_striking',
  'mode.sprawl_and_brawl',
];

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// Mode defaults
// ---------------------------------------------------------------------------

interface ModeDefaults {
  rangeTarget: RangeTarget;
  phaseTarget: PhaseTarget;
  initiative: InitiativeId;
  tdPolicy: TdPolicy;
  clinchPolicy: ClinchPolicy;
  groundTopPolicy: GroundTopPolicy;
  groundBottomPolicy: GroundBottomPolicy;
  cagePolicy: CagePolicy;
  weights: Partial<Record<ActionFamily, number>>;
}

export const MODE_DEFAULTS: Record<Exclude<ModeId, 'mode.outnumbered'>, ModeDefaults> = {
  'mode.distance_striking': {
    rangeTarget: 'long', phaseTarget: 'distance', initiative: 'mixed', tdPolicy: 'reactive',
    clinchPolicy: 'avoid', groundTopPolicy: 'standAndReset', groundBottomPolicy: 'standUpFirst',
    cagePolicy: 'centre',
    weights: { jab: 1.2, teep: 1.2, circle: 1.1, clinchEntry: 0.8 },
  },
  'mode.pressure_striking': {
    rangeTarget: 'mid', phaseTarget: 'distance', initiative: 'lead', tdPolicy: 'reactive',
    clinchPolicy: 'accept', groundTopPolicy: 'gnp', groundBottomPolicy: 'standUpFirst',
    cagePolicy: 'cut',
    weights: { advance: 1.3, bodyHook: 1.2, hook: 1.1, retreat: 0.8 },
  },
  'mode.counter_striking': {
    rangeTarget: 'long', phaseTarget: 'distance', initiative: 'counter', tdPolicy: 'reactive',
    clinchPolicy: 'break', groundTopPolicy: 'standAndReset', groundBottomPolicy: 'standUpFirst',
    cagePolicy: 'centre',
    weights: { counterWindow: 1.4, circle: 1.2, leadStrike: 0.8 },
  },
  'mode.sprawl_and_brawl': {
    rangeTarget: 'mid', phaseTarget: 'distance', initiative: 'mixed', tdPolicy: 'never',
    clinchPolicy: 'break', groundTopPolicy: 'standAndReset', groundBottomPolicy: 'standUpFirst',
    cagePolicy: 'centre',
    weights: { sprawl: 1.5, cross: 1.2, uppercut: 1.2, standUp: 1.5, shoot: 0.5 },
  },
  'mode.wrestle_control': {
    rangeTarget: 'mid', phaseTarget: 'groundTop', initiative: 'lead', tdPolicy: 'chain',
    clinchPolicy: 'seek', groundTopPolicy: 'gnp', groundBottomPolicy: 'standUpFirst',
    cagePolicy: 'cut',
    weights: { shoot: 1.3, levelChange: 1.3, cagePin: 1.2, ride: 1.2 },
  },
  'mode.clinch_grind': {
    rangeTarget: 'short', phaseTarget: 'clinch', initiative: 'lead', tdPolicy: 'chain',
    clinchPolicy: 'wall', groundTopPolicy: 'ride', groundBottomPolicy: 'standUpFirst',
    cagePolicy: 'cut',
    weights: { clinchEntry: 1.4, clinchStrike: 1.3, knee: 1.2, trip: 1.2 },
  },
  'mode.submission_hunt': {
    rangeTarget: 'short', phaseTarget: 'groundTop', initiative: 'mixed', tdPolicy: 'any',
    clinchPolicy: 'accept', groundTopPolicy: 'subHunt', groundBottomPolicy: 'subHunt',
    cagePolicy: 'centre',
    weights: { submission: 1.5, backTake: 1.4, frontHeadlock: 1.3, pass: 1.2 },
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export interface PlanInput {
  self: FighterRuntime;
  opponent: FighterRuntime;
  report: ScoutingReport;
  ruleset: Ruleset;
  /** Defaults to `ruleset.rounds.count` (1 becomes 1 "round" for street). */
  rounds?: number;
}

/** Scout and plan in one call; consumes exactly `SCOUT_DRAWS` uniforms. */
export function scoutAndPlan(
  self: FighterRuntime, opponent: FighterRuntime, ruleset: Ruleset, rng: RNG, rounds?: number,
): GamePlan | null {
  const report = scoutOpponent(self, opponent, rng);
  return generateGamePlan({ self, opponent, report, ruleset, rounds });
}

/**
 * Build the plan. Returns `null` for a T0 fighter with no author override:
 * he has no plan and fights on style weights alone (§2.5.8).
 */
export function generateGamePlan(input: PlanInput): GamePlan | null {
  const { self, opponent, report, ruleset } = input;
  const rounds = Math.max(1, input.rounds ?? ruleset.rounds.count);
  const iqTier = report.iqTier;
  const override = self.def.style.gamePlanOverride;

  if (!report.knows || report.opponent === null) {
    // T0: no report, therefore no plan. An author override still wins, because
    // the override is not generated — it is authored (§2.5.3, 01 §2.6).
    return override ? applyOverride(skeletonPlan(ruleset, rounds, iqTier), override) : null;
  }

  const facts = rulesetFactsOf(ruleset);
  const selfProfile = report.self;
  const oppProfile = report.opponent;
  const exposure = oppProfile.physical.stance === 'southpaw'
    ? selfProfile.familiarity.vsSouthpaw
    : selfProfile.familiarity.vsOrthodox;

  const ctx: PlanContext = {
    iqTier,
    self: selfProfile,
    opp: oppProfile,
    delta: advantageOf(selfProfile, oppProfile),
    stancePair: stancePairOf(selfProfile, oppProfile),
    stanceExposure: exposure,
    rules: facts,
    reactionTime: self.effective.reactionTime,
    aggression: self.def.mental.aggression,
    composure: self.composureEff,
    discipline: self.def.mental.discipline,
    adaptability: self.def.mental.adaptability,
  };

  // ---- steps 1-4: mode fitness -------------------------------------------
  const fitness = modeFitness(ctx);
  // Realism pass: the authored game plan (`style.primaryMode`) is the fighter's
  // own preference. The generator used to ignore it and pick by matchup
  // fitness alone, so the creator's "game plan" control changed nothing. A
  // preferred mode's fitness is raised x1.4: he fights his way unless the
  // matchup makes it a clearly worse idea (a smarter fighter reads the
  // matchup; the multiplier is the same, the fitness gaps he sees are not).
  const preferred = authoredMode(self.def.style.primaryMode);
  if (preferred !== null) {
    for (const f of fitness) {
      if (f.mode === preferred && f.fitness > 0) { f.fitness *= AUTHORED_MODE_BIAS; f.own *= AUTHORED_MODE_BIAS; }
    }
  }
  const available = fitness.filter((f) => f.fitness > 0);
  const primaryMode = pickPrimary(ctx, fitness);
  // The authored plan B, when it is a different, allowed mode, replaces the
  // generated fallback (T2+ plans have one at all, §2.5.8).
  const authoredB = authoredMode(self.def.style.fallbackMode);
  const fallbackMode = iqTier < 2 ? null
    : authoredB !== null && authoredB !== primaryMode && available.some((f) => f.mode === authoredB)
      ? authoredB : pickFallback(primaryMode, available);

  // ---- step 5: action weights --------------------------------------------
  // 01 §2.6's authored preferences come first so that the scouted rules of
  // §2.5.4-§2.5.6, which know something about *this* opponent, override the
  // author on the policy fields. On the weights they simply multiply.
  const prefs = preferencesFor(self);
  const hits: PlanRuleHit[] = [
    ...preferenceRules(ctx, prefs),
    ...physicalRules(ctx),
    ...styleRules(ctx),
    ...stanceRules(ctx),
  ];

  const weights = unitWeights();
  const defaults = MODE_DEFAULTS[primaryMode as Exclude<ModeId, 'mode.outnumbered'>];
  multiplyInto(weights, defaults.weights);
  for (const h of hits) multiplyInto(weights, h.weights);
  clampWeights(weights);
  const forbidden = forbiddenFamilies(ctx);
  for (const f of forbidden) weights[f] = 0;

  // ---- policies -----------------------------------------------------------
  const policy = mergePolicies(defaults, hits, facts);

  // ---- step 6: must-nots --------------------------------------------------
  const mustNots = buildMustNots(ctx, hits).slice(0, MAX_MUSTNOTS_BY_TIER[iqTier]);

  // ---- step 7: pacing -----------------------------------------------------
  const roundPacing = buildPacing(ctx, self, policy, rounds, primaryMode);

  // ---- step 8: triggers ---------------------------------------------------
  const triggers = buildTriggers(ctx).slice(0, MAX_TRIGGERS_BY_TIER[iqTier]);

  // ---- weapons ------------------------------------------------------------
  // §2.5.3 step 5 produced the weights; the weapon *list* is what the corner
  // would actually name, and a camp names the fighter's own shots before it
  // names whatever the discipline means happened to rank highest. So the
  // authored preferences seed the list and the weight ranking fills the rest
  // (F-3). Ruleset-forbidden families are already 0 and drop out here.
  // A preferred family still has to clear `WEAPON_THRESHOLD` after the matchup
  // rules have had their say: if S-1 has just told him not to kick the
  // wrestler, the corner does not then call the kick one of his weapons.
  const seeded = prefs.weaponOrder
    .filter((f) => WEAPON_FAMILIES.includes(f) && weights[f] > WEAPON_THRESHOLD);
  const ranked = WEAPON_FAMILIES
    .filter((f) => weights[f] > WEAPON_THRESHOLD && !seeded.includes(f))
    .sort((a, b) => (weights[b] - weights[a]) || (a < b ? -1 : 1));
  const ordered = [...seeded, ...ranked];
  const primaryWeapons = ordered.slice(0, 3);
  const secondaryWeapons = ordered.slice(3, 6);
  const avoidList = ACTION_FAMILIES
    .filter((f) => weights[f] > 0 && weights[f] <= AVOID_THRESHOLD)
    .sort((a, b) => (weights[a] - weights[b]) || (a < b ? -1 : 1));

  const rationale: PlanRationale[] = hits.map((h) => ({
    ruleId: h.id, kind: h.kind, label: h.label, tag: h.tag, weights: h.weights,
  }));

  const comboCap = Math.min(
    policy.comboCapMax ?? 99,
    COMBO_CAP_BY_TIER[iqTier] + (policy.comboCapDelta ?? 0),
  );

  const plan: GamePlan = {
    primaryMode,
    fallbackMode,
    rangeTarget: policy.rangeTarget ?? defaults.rangeTarget,
    rangeOffsetM: policy.rangeOffsetM ?? 0,
    phaseTarget: policy.phaseTarget ?? defaults.phaseTarget,
    initiative: policy.initiative ?? defaults.initiative,
    primaryWeapons,
    secondaryWeapons,
    avoidList: [...avoidList],
    mustNots,
    actionWeights: weights,
    tdPolicy: policy.tdPolicy ?? defaults.tdPolicy,
    clinchPolicy: policy.clinchPolicy ?? defaults.clinchPolicy,
    groundTopPolicy: policy.groundTopPolicy ?? defaults.groundTopPolicy,
    groundBottomPolicy: policy.groundBottomPolicy ?? defaults.groundBottomPolicy,
    cagePolicy: policy.cagePolicy ?? defaults.cagePolicy,
    roundPacing,
    triggers,
    cornerScript: buildCornerScript(ctx, hits, rounds),
    comboCap,
    pocketDwellS: policy.pocketDwellS ?? null,
    clinchDwellS: policy.clinchDwellS ?? null,
    clinchTimeTargetS: policy.clinchTimeTargetS ?? null,
    controlGapTargetS: policy.controlGapTargetS ?? null,
    longGuard: policy.longGuard ?? false,
    weightBack: policy.weightBack ?? false,
    stanceSwitching: policy.stanceSwitching ?? false,
    submissionTargets: facts.submissionsAllowed ? [...prefs.submissionTargets] : [],
    quality: iqTier,
    planLines: [],
    rationale,
    modeFitness: fitness,
    overridden: false,
  };

  plan.planLines = buildPlanLines(ctx, plan, hits);
  applyTierGating(plan, iqTier);

  return override ? applyOverride(plan, override) : plan;
}

// ---------------------------------------------------------------------------
// Authored style preferences (01 §2.6 -> §2.5.3 step 5)
// ---------------------------------------------------------------------------

/** How a `TakedownStyle.setup` shows up in the weights. `[E]`, from 01 §2.6. */
const TD_SETUP_WEIGHTS: Readonly<Record<string, Partial<Record<ActionFamily, number>>>> = {
  naked: { nakedShot: 1.15, shootOffStrikes: 0.95 },
  offSingleStrike: { shootOffStrikes: 1.15, nakedShot: 0.85 },
  offCombination: { shootOffStrikes: 1.15, nakedShot: 0.85 },
  offFeint: { shootOffStrikes: 1.12, feint: 1.10, nakedShot: 0.85 },
  reactive: { counterWindow: 1.10, sprawl: 1.10, nakedShot: 0.90 },
  offClinch: { clinchEntry: 1.15, trip: 1.10, bodylockTd: 1.10 },
};

/**
 * The rules 01 §2.6's Style tab is worth. Everything here is authored rather
 * than scouted, which is why it is pushed onto the hit list *first*: on the
 * weights it multiplies with everything else, and on the policy fields the
 * later (opponent-aware) rules of §2.5.4-§2.5.6 win, which is the right
 * precedence — the camp adapts the author's preference to the man in front of
 * them, it does not ignore him.
 *
 * Exported for `tests/style.test.ts` and the game-plan panel.
 */
export function preferenceRules(ctx: PlanContext, prefs: StylePreferences): PlanRuleHit[] {
  if (prefs.empty) return [];
  const out: PlanRuleHit[] = [];

  // The family channel carries a quarter of the opinion; the rest is applied
  // per technique id by `utility.scoreAction` (`w_pref`), which is the only
  // granularity that can tell a guillotine from an armbar. The two submission
  // families are left out entirely for exactly that reason.
  const weights: Partial<Record<ActionFamily, number>> = {};
  for (const [family, w] of prefs.families) {
    if (family === 'submission' || family === 'bottomSubmission') continue;
    weights[family] = planShareOf(w);
  }
  if (Object.keys(weights).length > 0) {
    const named = prefs.weaponOrder.slice(0, 3).join(', ');
    out.push({
      id: 'PR-1', kind: 'style',
      label: named.length > 0
        ? `These are his shots: ${named}. Fight the fight he trained for.`
        : 'Fight the fight he trained for.',
      weights, tag: '[S: 01 §2.6 style preferences]',
    });
  }

  const setup = prefs.takedownSetup;
  if (setup !== null && ctx.rules.takedownsAllowed && TD_SETUP_WEIGHTS[setup]) {
    out.push({
      id: 'PR-2', kind: 'style',
      label: `Entries come off ${setup === 'naked' ? 'nothing but speed' : setup}.`,
      weights: TD_SETUP_WEIGHTS[setup], tag: '[S: 01 §2.6 takedownPreferences.setup]',
    });
  }

  // `preferredRange` is where the author says this fighter wants the fight. It
  // sets the plan's range and phase targets unless a matchup rule later says
  // otherwise (`mergePolicies` takes the last writer).
  const rangeTarget = rangeTargetOf(prefs.preferredRange);
  const phase = phaseTargetOf(prefs.preferredRange);
  const phaseAllowed = phase === null
    || (phase === 'clinch' ? ctx.rules.clinchAllowed : ctx.rules.groundFightingAllowed);
  out.push({
    id: 'PR-3', kind: 'style',
    label: `He wants it at ${prefs.preferredRange} range.`,
    weights: {},
    policy: {
      rangeTarget,
      phaseTarget: phase !== null && phaseAllowed ? phase : undefined,
    },
    tag: '[S: 01 §2.6 preferredRange]',
  });

  // `takedownPreferences.cageBias`: a fighter who finishes on the fence cuts
  // the cage to get there; one who does not is happy in the centre.
  if (prefs.cageBias !== null && ctx.rules.takedownsAllowed) {
    if (prefs.cageBias >= 0.65) {
      out.push({
        id: 'PR-4', kind: 'style',
        label: 'He finishes on the fence: cut the cage to it.',
        weights: { cagePin: 1.2 }, policy: { cagePolicy: 'cut' },
        tag: '[S: 01 §2.6 takedownPreferences.cageBias]',
      });
    } else if (prefs.cageBias <= 0.35) {
      out.push({
        id: 'PR-4', kind: 'style',
        label: 'He does not need the fence.',
        weights: { cagePin: 0.85 }, policy: { cagePolicy: 'centre' },
        tag: '[S: 01 §2.6 takedownPreferences.cageBias]',
      });
    }
  }

  if (prefs.submissionTargets.length > 0 && ctx.rules.submissionsAllowed) {
    out.push({
      id: 'PR-5', kind: 'style',
      label: `His finishes: ${prefs.submissionTargets.slice(0, 3).join(', ')}.`,
      weights: {}, tag: '[S: 01 §2.6 goToSubmissions]',
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Mode fitness (§2.5.3)
// ---------------------------------------------------------------------------

export interface ModeFitness {
  mode: ModeId;
  own: number;
  oppWeak: number;
  veto: number;
  fitness: number;
}

export function modeFitness(ctx: PlanContext): ModeFitness[] {
  const s = ctx.self.skills;
  const o = ctx.opp.skills;
  const st = ctx.self.tiers;
  const ot = ctx.opp.tiers;
  const d = ctx.delta;
  const n = (x: number): number => clamp(x / 100, 0, 1);
  const t = (x: number): number => clamp(x / 5, 0, 1);
  const selfTdD = bandTier(s.tdDefence);
  const selfTdO = bandTier(s.tdOffence);
  const oppTdO = bandTier(o.tdOffence);
  const selfGetUps = bandTier(s.getUps);
  const selfBjjTop = bandTier(s.bjjTop);
  const oppBjjBottom = bandTier(o.bjjBottom);

  const rows: ModeFitness[] = [];
  const push = (mode: ModeId, own: number, oppWeak: number, veto: number): void => {
    rows.push({
      mode,
      own: Math.max(0, own),
      oppWeak: Math.max(0, oppWeak),
      veto,
      fitness: Math.max(0, own) * Math.max(0, oppWeak) * veto,
    });
  };

  // distance_striking
  push(
    'mode.distance_striking',
    ((n(s.boxing) + n(s.kicking)) / 2) * (1 + 0.02 * Math.max(0, d.reachCm)),
    1 - 0.5 * n(o.strikingDefence),
    (oppTdO >= selfTdD + 2 && selfGetUps <= 1) ? 0 : 1,
  );
  // pressure_striking
  push(
    'mode.pressure_striking',
    ((n(s.boxing) + n(s.clinch)) / 2) * t(st.cardio) * (1 + 0.1 * Math.max(0, -d.reachCm / 5)),
    1 - n(o.cageWork),
    st.cardio <= ot.cardio - 1 ? 0 : 1,
  );
  // counter_striking — a counter fighter facing a counter fighter halves, not vetoes
  push(
    'mode.counter_striking',
    n(s.boxing) * n(s.strikingDefence) * (0.7 + 0.3 * clamp(ctx.reactionTime / 100, 0, 1)),
    clamp(ctx.opp.tendencies.leadShare, 0, 1),
    ctx.opp.style.counter ? 0.5 : 1,
  );
  // sprawl_and_brawl — only attractive if he actually shoots
  push(
    'mode.sprawl_and_brawl',
    (n(s.boxing) + n(s.tdDefence)) / 2,
    t(oppTdO),
    1,
  );
  // wrestle_control
  push(
    'mode.wrestle_control',
    n(s.tdOffence) * (0.6 + 0.4 * n(s.cageWork)),
    1 - n(o.tdDefence),
    (oppBjjBottom >= selfBjjTop + 2) ? 0 : 1,
  );
  // clinch_grind
  push(
    'mode.clinch_grind',
    n(s.clinch) * (0.5 + 0.5 * t(st.strength)) * (1 + 0.05 * clamp(d.massPct, -20, 20)),
    1 - n(o.clinch),
    st.cardio <= ot.cardio - 2 ? 0 : 1,
  );
  // submission_hunt
  push(
    'mode.submission_hunt',
    ((n(s.bjjTop) + n(s.bjjBottom)) / 2) * (0.5 + 0.5 * n(s.tdOffence)),
    1 - n(o.subDefence),
    (ot.wrestling >= st.wrestling + 1 && ot.striking >= st.striking + 1) ? 0 : 1,
  );

  // Ruleset vetoes: a plan may not ask for something the rules forbid.
  for (const row of rows) {
    if (!modeAllowed(row.mode, ctx)) {
      row.veto = 0;
      row.fitness = 0;
    }
  }
  // Explicit "no takedowns, and he shoots" special case: sprawl_and_brawl is
  // meaningless if takedowns are not legal in the first place.
  return rows;
}

function modeAllowed(mode: ModeId, ctx: PlanContext): boolean {
  const r = ctx.rules;
  switch (mode) {
    case 'mode.wrestle_control':
      return r.takedownsAllowed && r.groundFightingAllowed;
    case 'mode.clinch_grind':
      return r.clinchAllowed;
    case 'mode.submission_hunt':
      return r.submissionsAllowed && r.groundFightingAllowed;
    case 'mode.sprawl_and_brawl':
      return r.takedownsAllowed;
    default:
      return true;
  }
}

/** Realism pass: weight of an authored `style.primaryMode` on its mode's fitness [E]. */
export const AUTHORED_MODE_BIAS = 1.4;

/** 01's authored mode labels onto 07's plan modes; null for "all-rounder" / unset. */
export function authoredMode(m: string | undefined | null): ModeId | null {
  switch (m) {
    case 'pressure': case 'pressureStriking': case 'volume': return 'mode.pressure_striking';
    case 'counter': return 'mode.counter_striking';
    case 'pointFighter': case 'distanceStriking': return 'mode.distance_striking';
    case 'power': return 'mode.sprawl_and_brawl';
    case 'grinder': case 'clinchGrind': return 'mode.clinch_grind';
    case 'scrambler': case 'wrestleControl': return 'mode.wrestle_control';
    case 'guardPlayer': case 'submissionHunt': return 'mode.submission_hunt';
    default: return null;
  }
}

function pickPrimary(ctx: PlanContext, fitness: ModeFitness[]): ModeId {
  const usable = fitness.filter((f) => modeAllowed(f.mode, ctx));
  const pool = usable.length > 0 ? usable : fitness;
  // T1 ignores the opponent entirely: argmax own(m) only.
  const key = (f: ModeFitness): number => (ctx.iqTier <= 1 ? f.own : f.fitness);
  let best = -Infinity;
  for (const f of pool) best = Math.max(best, key(f));
  const tied = pool.filter((f) => key(f) >= best * 0.98);
  if (tied.length === 1) return tied[0].mode;
  const order = (ctx.iqTier >= 3 && ctx.aggression < FINISHING_MODE_AGGRESSION)
    ? LOWER_VARIANCE_ORDER
    : FINISHING_ORDER;
  for (const m of order) {
    if (tied.some((f) => f.mode === m)) return m;
  }
  return tied[0].mode;
}

function pickFallback(primary: ModeId, available: ModeFitness[]): ModeId | null {
  const others = available.filter((f) => f.mode !== primary);
  if (others.length === 0) return null;
  const best = Math.max(...available.map((f) => f.fitness));
  const sameFamily = (m: ModeId): boolean =>
    STRIKING_MODES.includes(m) === STRIKING_MODES.includes(primary);
  const sorted = [...others].sort((a, b) => b.fitness - a.fitness);
  const otherFamily = sorted.filter((f) => !sameFamily(f.mode));
  const second = sorted[0];
  if (second && !sameFamily(second.mode)) return second.mode;
  if (second && second.fitness >= FALLBACK_RATIO * best && otherFamily.length === 0) {
    return second.mode;
  }
  return otherFamily.length > 0 ? otherFamily[0].mode : second.mode;
}

// ---------------------------------------------------------------------------
// Ruleset gating
// ---------------------------------------------------------------------------

/**
 * Families this ruleset forbids. These are forced to 0 — outside the [0.25, 3]
 * clamp — because a boxing plan must never contain a takedown at any weight.
 */
export function forbiddenFamilies(ctx: PlanContext): ActionFamily[] {
  const r = ctx.rules;
  const out: ActionFamily[] = [];
  const add = (...fs: ActionFamily[]): void => { out.push(...fs); };
  if (!r.punchesAllowed) {
    add('jab', 'cross', 'hook', 'leadHook', 'uppercut', 'overhand', 'bodyHook', 'spinning',
      'parryCross', 'baitCross');
  }
  if (!r.kicksAllowed) {
    add('teep', 'lowKick', 'leadLowKick', 'bodyKick', 'headKick', 'rearKick');
  }
  if (!r.kneesAllowed) add('knee');
  if (!r.elbowsAllowed) add('elbow');
  if (!r.takedownsAllowed) {
    add('shoot', 'nakedShot', 'shootOffStrikes', 'bodylockTd', 'trip', 'levelChange',
      'slipEntry', 'guardPull', 'sprawl');
  }
  if (!r.clinchAllowed) add('clinchEntry', 'clinchStrike', 'cagePin');
  if (!r.groundFightingAllowed) {
    add('groundStrike', 'pass', 'ride', 'sweep', 'bottomSubmission', 'wallWalk', 'backTake');
  }
  if (!r.submissionsAllowed) add('submission', 'bottomSubmission', 'frontHeadlock');
  if (!r.street) add('flee');
  return out;
}

// ---------------------------------------------------------------------------
// Policy merge
// ---------------------------------------------------------------------------

interface MergedPolicy extends PlanPolicyPatch {
  paceMult: number;
  r1PaceMult: number;
  tdAttemptMult: number;
  r1TdMult: number;
  r3TdMult: number;
  riskDelta: number;
}

function mergePolicies(
  defaults: ModeDefaults, hits: PlanRuleHit[], facts: ReturnType<typeof rulesetFactsOf>,
): MergedPolicy {
  const m: MergedPolicy = {
    paceMult: 1, r1PaceMult: 1, tdAttemptMult: 1, r1TdMult: 1, r3TdMult: 1, riskDelta: 0,
    mustNots: [],
  };
  for (const h of hits) {
    const p = h.policy;
    if (!p) continue;
    if (p.rangeTarget) m.rangeTarget = p.rangeTarget;
    if (p.rangeOffsetM !== undefined) m.rangeOffsetM = (m.rangeOffsetM ?? 0) + p.rangeOffsetM;
    if (p.phaseTarget) m.phaseTarget = p.phaseTarget;
    if (p.initiative) m.initiative = p.initiative;
    if (p.cagePolicy) m.cagePolicy = p.cagePolicy;
    if (p.tdPolicy) m.tdPolicy = p.tdPolicy;
    if (p.clinchPolicy) m.clinchPolicy = p.clinchPolicy;
    if (p.groundTopPolicy) m.groundTopPolicy = p.groundTopPolicy;
    if (p.groundBottomPolicy) m.groundBottomPolicy = p.groundBottomPolicy;
    if (p.paceMult !== undefined) m.paceMult *= p.paceMult;
    if (p.r1PaceMult !== undefined) m.r1PaceMult *= p.r1PaceMult;
    if (p.tdAttemptMult !== undefined) m.tdAttemptMult *= p.tdAttemptMult;
    if (p.r1TdMult !== undefined) m.r1TdMult *= p.r1TdMult;
    if (p.r3TdMult !== undefined) m.r3TdMult *= p.r3TdMult;
    if (p.riskDelta !== undefined) m.riskDelta += p.riskDelta;
    if (p.comboCapMax !== undefined) {
      m.comboCapMax = Math.min(m.comboCapMax ?? 99, p.comboCapMax);
    }
    if (p.comboCapDelta !== undefined) m.comboCapDelta = (m.comboCapDelta ?? 0) + p.comboCapDelta;
    if (p.pocketDwellS !== undefined) {
      m.pocketDwellS = Math.min(m.pocketDwellS ?? Infinity, p.pocketDwellS);
    }
    if (p.clinchDwellS !== undefined) {
      m.clinchDwellS = Math.min(m.clinchDwellS ?? Infinity, p.clinchDwellS);
    }
    if (p.clinchTimeTargetS !== undefined) m.clinchTimeTargetS = p.clinchTimeTargetS;
    if (p.controlGapTargetS !== undefined) m.controlGapTargetS = p.controlGapTargetS;
    if (p.longGuard) m.longGuard = true;
    if (p.weightBack) m.weightBack = true;
    if (p.stanceSwitching) m.stanceSwitching = true;
    if (p.mustNots) m.mustNots = [...(m.mustNots ?? []), ...p.mustNots];
  }

  // The ruleset has the last word, always.
  if (!facts.takedownsAllowed) m.tdPolicy = 'never';
  if (!facts.clinchAllowed) m.clinchPolicy = 'break';
  else if (facts.holdingIsFoul && m.clinchPolicy === 'seek') m.clinchPolicy = 'break';
  if (!facts.groundFightingAllowed) {
    m.groundTopPolicy = 'standAndReset';
    m.groundBottomPolicy = 'standUpFirst';
    if (m.phaseTarget === 'groundTop') m.phaseTarget = 'distance';
  }
  if (defaults.tdPolicy === 'never' && m.tdPolicy === undefined) m.tdPolicy = 'never';
  return m;
}

// ---------------------------------------------------------------------------
// Must-nots, pacing, triggers, corner
// ---------------------------------------------------------------------------

function buildMustNots(ctx: PlanContext, hits: PlanRuleHit[]): MustNotId[] {
  const out = new Set<MustNotId>();
  for (const h of hits) for (const mn of h.policy?.mustNots ?? []) out.add(mn);
  if (ctx.iqTier >= 2) {
    const o = ctx.opp;
    if (o.tendencies.kickCatchRate >= 0.55 && ctx.rules.takedownsAllowed) {
      out.add('mn.rear_kick_mid_range');
    }
    if (o.tendencies.guillotineRate >= 0.5 && ctx.rules.submissionsAllowed) {
      out.add('mn.head_outside_on_shots');
    }
    if (o.tendencies.counterRate >= 0.55) out.add('mn.lead_with_head');
    if (o.tiers.bjj >= ctx.self.tiers.bjj + 1 && ctx.rules.groundFightingAllowed) {
      out.add('mn.engage_guard');
    }
    if (o.style.pressure && ctx.self.style.counter) out.add('mn.back_to_fence');
  }
  // Nothing about the ground can be a must-not in a ruleset with no ground.
  if (!ctx.rules.groundFightingAllowed) {
    out.delete('mn.engage_guard');
    out.delete('mn.go_to_ground');
  }
  if (!ctx.rules.takedownsAllowed) {
    out.delete('mn.naked_shot');
    out.delete('mn.head_outside_on_shots');
    out.delete('mn.kick_the_wrestler');
    out.delete('mn.rear_kick_mid_range');
  }
  return [...out];
}

function buildPacing(
  ctx: PlanContext, self: FighterRuntime, policy: MergedPolicy, rounds: number, mode: ModeId,
): RoundPacing[] {
  const basePace = ctx.self.tendencies.paceSLpM;
  const perRoundMinutes = Math.max(1, ctx.rules.roundLengthS || 300) / 60;
  const baseTd = ctx.rules.takedownsAllowed && policy.tdPolicy !== 'never'
    ? ctx.self.tendencies.tdAttemptRate * (perRoundMinutes / 15)
    : 0;
  const baseRisk = Math.round((ctx.aggression - 50) / 25);
  const budget = finishBudget(rounds) .map((b) => b * finishClassMult(self));

  const out: RoundPacing[] = [];
  for (let r = 1; r <= rounds; r++) {
    let pace = basePace * policy.paceMult;
    let td = baseTd * policy.tdAttemptMult;
    if (r === 1) {
      pace *= policy.r1PaceMult;
      td *= policy.r1TdMult;
    }
    if (r >= 3) td *= policy.r3TdMult;
    // Final-round intent is +10 % from T2 (§2.5.7); T0-T1 pace flat.
    if (r === rounds && rounds > 1 && ctx.iqTier >= 2) pace *= FINAL_ROUND_PACE_MULT;
    // T1 has no pacing profile at all: one flat number for every round.
    if (ctx.iqTier <= 1) {
      pace = basePace;
      td = baseTd;
    }
    const risk = clamp(baseRisk + policy.riskDelta, -2, 2) as -2 | -1 | 0 | 1 | 2;
    out.push({
      round: r,
      paceTarget: Math.round(pace * 100) / 100,
      tdAttemptTarget: Math.round(td * 100) / 100,
      riskAppetite: ctx.iqTier <= 1 ? clamp(baseRisk, -2, 2) as -2 | -1 | 0 | 1 | 2 : risk,
      finishSeeking: Math.round((budget[r - 1] ?? 0) * 1000) / 1000,
    });
  }
  // A submission hunter never "paces" takedowns to zero in a grappling ruleset.
  if (mode === 'mode.submission_hunt' && ctx.rules.takedownsAllowed) {
    for (const p of out) p.tdAttemptTarget = Math.max(p.tdAttemptTarget, 1);
  }
  return out;
}

export function finishBudget(rounds: number): number[] {
  const raw = [...FINISH_BUDGET_3R];
  for (let i = 3; i < rounds; i++) raw.push(FINISH_BUDGET_TAIL[Math.min(i - 3, 1)]);
  const used = raw.slice(0, Math.max(1, rounds));
  const sum = used.reduce((a, b) => a + b, 0);
  return used.map((v) => v / sum);
}

function finishClassMult(self: FighterRuntime): number {
  const wc = self.body.weightClass;
  if (wc === 'wc.heavyweight' || wc === 'wc.super_heavyweight') return 1.4;
  if (self.body.sex === 'female' && (wc === 'wc.strawweight' || wc === 'wc.atomweight')) return 0.5;
  return 1;
}

function buildTriggers(ctx: PlanContext): Trigger[] {
  const all: Trigger[] = [];
  const push = (t: Trigger): void => { if (ctx.iqTier >= t.minIqTier) all.push(t); };

  push({
    id: 'adj.taken_down_x2', signal: 'taken down twice', minIqTier: 2,
    action: 'stand-up urgency x2, kicks x0.3, jab/teep x1.3, fight in the centre',
  });
  push({
    id: 'adj.opp_hurt', signal: 'opponent rocked or knocked down', minIqTier: 2,
    action: 'finisher logic (§2.6.5)',
  });
  push({
    id: 'adj.td_stuffed_x2', signal: 'two shots stuffed in a row', minIqTier: 2,
    action: ctx.self.style.wrestler
      ? 'W-4: clinch and cage chains for 60 s before shooting again'
      : 'rear kicks x1.2 (confidence)',
  });
  push({
    id: 'adj.opp_tired', signal: 'opponent pace down 20 % or visible tired cue', minIqTier: 2,
    action: 'pressure x1.3, combo +1, takedown attempts x1.2',
  });
  push({
    id: 'adj.self_low_stamina', signal: 'own fatigue >= 0.6 in R1/R2', minIqTier: 2,
    action: 'C-2 economy, clinch to rest, kicks x0.6',
  });
  push({
    id: 'adj.drop_family', signal: 'a family below 25 % hit rate over 6+ attempts', minIqTier: 3,
    action: 'that family x0.6, feints x1.3, best family x1.3',
    branch: ctx.iqTier >= 4
      ? [{
        id: 'adj.defend_family', signal: 'he counters the replacement too', minIqTier: 4,
        action: 'defensive bias on his counter, counter-window x1.3',
      }]
      : undefined,
  });
  push({
    id: 'adj.cage_trapped', signal: '3+ exchanges with your back on the fence in 30 s', minIqTier: 3,
    action: 'P-5 lead-initiative reset for 20 s, circle-off macro x1.5',
  });
  push({
    id: 'adj.behind_final', signal: 'perceived down a round entering the final round', minIqTier: 3,
    action: 'SC-2: pace x1.25, risk +1, last-60-s volume x1.3',
  });
  push({
    id: 'adj.opp_leg_damaged', signal: 'his lead leg is compromised', minIqTier: 3,
    action: 'low kick that leg x1.5, takedown attempts x1.2',
  });
  push({
    id: 'adj.opp_adjusted', signal: 'his action distribution has shifted (KL > 0.35 nats)',
    minIqTier: 5,
    action: 're-run the mode fitness against the observed profile and switch immediately',
    branch: [{
      id: 'adj.trap_set', signal: 'he has answered the same setup three times', minIqTier: 5,
      action: 'repeat the setup and pre-load the counter to his learned response',
    }],
  });
  // When the tier cap bites, the *most advanced* triggers survive: a T5 plan
  // that lost `adj.opp_adjusted` to a slice would not be a T5 plan. Stable
  // sort, so within a tier the table order of §2.6.1 is preserved.
  return all
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (b.t.minIqTier - a.t.minIqTier) || (a.i - b.i))
    .map((x) => x.t);
}

function buildCornerScript(ctx: PlanContext, hits: PlanRuleHit[], rounds: number): CornerCue[] {
  if (ctx.iqTier < 1) return [];
  const technical = hits.filter((h) => Object.keys(h.weights).length > 0);
  const out: CornerCue[] = [];
  for (let r = 1; r <= rounds; r++) {
    const rule = technical[(r - 1) % Math.max(1, technical.length)];
    if (rule) out.push({ round: r, kind: 'technical', text: rule.label, ruleId: rule.id });
    if (out.filter((c) => c.round === r).length < MAX_CORNER_CUES_PER_ROUND) {
      out.push({ round: r, kind: 'affirmation', text: 'You are winning this. Breathe.' });
    }
  }
  return out;
}

function buildPlanLines(ctx: PlanContext, plan: GamePlan, hits: PlanRuleHit[]): string[] {
  const modeLine = `${modeLabel(plan.primaryMode)} at ${plan.rangeTarget} range.`;
  if (ctx.iqTier <= 1) return [modeLine];
  const lines = [modeLine];
  const byWeight = hits
    .filter((h) => Object.keys(h.weights).length > 0)
    .slice(0, ctx.iqTier >= 4 ? 6 : ctx.iqTier === 3 ? 4 : 2);
  for (const h of byWeight) lines.push(h.label);
  if (plan.mustNots.length > 0) lines.push(`Never: ${plan.mustNots.join(', ')}.`);
  if (plan.fallbackMode) lines.push(`If it is not working: ${modeLabel(plan.fallbackMode)}.`);
  if (ctx.iqTier >= 5) {
    lines.push('He will change something in round two; the answer is already picked.');
  }
  return lines;
}

function modeLabel(mode: ModeId): string {
  switch (mode) {
    case 'mode.distance_striking': return 'Strike from range';
    case 'mode.pressure_striking': return 'Pressure him';
    case 'mode.counter_striking': return 'Counter him';
    case 'mode.sprawl_and_brawl': return 'Sprawl and brawl';
    case 'mode.wrestle_control': return 'Wrestle and control';
    case 'mode.clinch_grind': return 'Grind in the clinch';
    case 'mode.submission_hunt': return 'Hunt the submission';
    default: return 'Survive being outnumbered';
  }
}

/**
 * Strip the features a tier does not have (§2.5.8). Done after generation so
 * the generator stays one code path and the tier table stays one place.
 */
function applyTierGating(plan: GamePlan, iqTier: IqTier07): void {
  if (iqTier <= 1) {
    plan.fallbackMode = null;
    plan.mustNots = [];
    plan.triggers = [];
    plan.avoidList = [];
    plan.secondaryWeapons = [];
    plan.primaryWeapons = plan.primaryWeapons.slice(0, 1);
  }
  if (iqTier <= 2) {
    // Contingency branches are a T3+ feature; T4/T5 keep theirs.
    for (const t of plan.triggers) delete t.branch;
  }
  if (iqTier < 4) {
    for (const t of plan.triggers) if (t.minIqTier >= 4) delete t.branch;
  }
}

// ---------------------------------------------------------------------------
// Author override (01 §2.6, 07 §2.5.3)
// ---------------------------------------------------------------------------

/**
 * A `style.gamePlanOverride` bypasses the generator and is used verbatim.
 * Unknown keys are carried through untouched so an author can stash data the
 * engine does not yet read; known keys replace the generated value.
 */
export function applyOverride(base: GamePlan, override: Record<string, unknown>): GamePlan {
  const merged = { ...base, ...(override as Partial<GamePlan>) } as GamePlan;
  merged.overridden = true;
  merged.rationale = [
    {
      ruleId: 'override', kind: 'override',
      label: 'Author game-plan override: the generator was bypassed.',
      tag: '[S: 01 §2.6]', weights: {},
    },
    ...base.rationale,
  ];
  // The override may not smuggle in an action the ruleset forbids.
  if (override.actionWeights) {
    merged.actionWeights = { ...base.actionWeights, ...(override.actionWeights as ActionWeights) };
  }
  return merged;
}

/** The minimum viable plan: used only as the carrier for an author override. */
function skeletonPlan(ruleset: Ruleset, rounds: number, iqTier: IqTier07): GamePlan {
  const facts = rulesetFactsOf(ruleset);
  const defaults = MODE_DEFAULTS['mode.distance_striking'];
  const weights = unitWeights();
  return {
    primaryMode: 'mode.distance_striking',
    fallbackMode: null,
    rangeTarget: defaults.rangeTarget,
    rangeOffsetM: 0,
    phaseTarget: defaults.phaseTarget,
    initiative: defaults.initiative,
    primaryWeapons: [],
    secondaryWeapons: [],
    avoidList: [],
    mustNots: [],
    actionWeights: weights,
    tdPolicy: facts.takedownsAllowed ? defaults.tdPolicy : 'never',
    clinchPolicy: facts.clinchAllowed ? defaults.clinchPolicy : 'break',
    groundTopPolicy: facts.groundFightingAllowed ? defaults.groundTopPolicy : 'standAndReset',
    groundBottomPolicy: 'standUpFirst',
    cagePolicy: defaults.cagePolicy,
    roundPacing: Array.from({ length: rounds }, (_, i) => ({
      round: i + 1, paceTarget: 3.5, tdAttemptTarget: 0, riskAppetite: 0 as const,
      finishSeeking: finishBudget(rounds)[i] ?? 0,
    })),
    triggers: [],
    cornerScript: [],
    comboCap: COMBO_CAP_BY_TIER[iqTier],
    pocketDwellS: null,
    clinchDwellS: null,
    clinchTimeTargetS: null,
    controlGapTargetS: null,
    longGuard: false,
    weightBack: false,
    stanceSwitching: false,
    submissionTargets: [],
    quality: iqTier,
    planLines: [],
    rationale: [],
    modeFitness: PLANNABLE_MODES.map((m) => ({ mode: m, own: 0, oppWeak: 0, veto: 0, fitness: 0 })),
    overridden: false,
  };
}
