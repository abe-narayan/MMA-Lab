/**
 * SKILL TIERS AND THE TIER BEHAVIOUR CATALOGUE — design chapter 01 §2.3.4, §3.
 *
 * Two things live here.
 *
 * 1. The tier arithmetic: the 0-100 sub-skill bands, the years-trained cap and
 *    the T5 mental gate. Tier is *per discipline*: a T4 boxer with T0 wrestling
 *    shows T0 wrestling tells the moment he is shot on, which is the whole
 *    point of keying behaviour on discipline rather than on one rating.
 *
 * 2. The catalogue itself — ~196 rows of "what a fighter of tier Tn visibly
 *    does and cannot do", transcribed from 01 §3 as data. This table is the
 *    Phase-5 contract between 01, the AI (07), the resolution chapters (02-05)
 *    and presentation (08): it is what makes a white belt look like a white
 *    belt rather than a weaker black belt. Magnitudes that Phase 9 may tune are
 *    registered in `params/fighter.params.ts` under the rule's own id
 *    (`beh.<domain>.<name>.<param>`, 01 §5.7); the `effect` string here is the
 *    human-readable statement the Model tab and the implementing section read.
 *
 * Core principle restated for implementers: no rule in this catalogue changes
 * `reactionTimeMs`. Simple reaction latency does not differ between experts and
 * novices `[S: LIT_B §4.2]`; what tiers scale is the read, the cue-pickup lead,
 * counter-on-read, feint susceptibility, telegraph, execution time, repertoire,
 * energy cost and decision weights.
 */

import type { CoreDisciplineId, SkillTier } from './types';

// --------------------------------------------------------------------------
// 1. Tier derivation (01 §2.3.4)
// --------------------------------------------------------------------------

/** Sub-skill band upper edges: <10 T0, <30 T1, <50 T2, <70 T3, <90 T4, else T5. */
export const TIER_SKILL_BANDS: readonly number[] = [10, 30, 50, 70, 90];

/** Years-trained band upper edges: <0.25 T0, <1 T1, <4 T2, <8 T3, else T4. */
export const TIER_YEARS_BANDS: readonly number[] = [0.25, 1, 4, 8];

/** fightIQ band upper edges for `iqTier` 1-5 (01 §2.3.4). */
export const IQ_BANDS: readonly number[] = [30, 50, 70, 90];

/** Tier implied by the mean of the effective sub-skills `[S: CONV §3]`. */
export function tierBySkill(mean: number, bands: readonly number[] = TIER_SKILL_BANDS): SkillTier {
  for (let i = 0; i < bands.length; i++) {
    if (mean < bands[i]) return i as SkillTier;
  }
  return 5;
}

/** Tier implied by training age alone; caps out at T4 `[S: CONV §3]`. */
export function tierByYears(years: number, bands: readonly number[] = TIER_YEARS_BANDS): SkillTier {
  for (let i = 0; i < bands.length; i++) {
    if (years < bands[i]) return i as SkillTier;
  }
  return 4;
}

export interface TierGateInput {
  /** Mean of the *effective* sub-skills (native ⊕ transfers). */
  mean: number;
  /** Years trained plus the transfer-years credit (01 §2.3.4). */
  effectiveYears: number;
  fightIQ: number;
  composure: number;
  /** Cap offset: a fast learner may sit this many tiers above his training age. */
  yearsCapOffset?: number;
  t5IqGate?: number;
  t5ComposureGate?: number;
  skillBands?: readonly number[];
  yearsBands?: readonly number[];
}

/**
 * The full tier rule: skill band, capped by training age + 1, with a mental
 * gate on T5.
 *
 * The `+1` cap lets a fast learner sit one tier above his training age but no
 * more — a six-month prodigy cannot be T4. The T5 gate exists because `CONV §3`
 * defines champion as "elite plus exceptional IQ/consistency", so a maxed-out
 * skill slider alone never produces one.
 */
export function tierOf(input: TierGateInput): SkillTier {
  const bySkill = tierBySkill(input.mean, input.skillBands);
  const byYears = tierByYears(input.effectiveYears, input.yearsBands);
  const cap = Math.min(5, byYears + (input.yearsCapOffset ?? 1)) as SkillTier;
  let tier = Math.min(bySkill, cap) as SkillTier;
  if (tier === 5) {
    const gated =
      input.mean >= (input.skillBands ?? TIER_SKILL_BANDS)[4] &&
      input.fightIQ >= (input.t5IqGate ?? 80) &&
      input.composure >= (input.t5ComposureGate ?? 75);
    if (!gated) tier = 4;
  }
  return tier;
}

/** `iqTier` 1-5, the vocabulary `MIS §6.4`/`§8` uses for decision quality. */
export function iqTierOf(fightIQ: number, bands: readonly number[] = IQ_BANDS): 1 | 2 | 3 | 4 | 5 {
  for (let i = 0; i < bands.length; i++) {
    if (fightIQ < bands[i]) return (i + 1) as 1 | 2 | 3 | 4 | 5;
  }
  return 5;
}

// --------------------------------------------------------------------------
// 2. Catalogue schema (01 §3)
// --------------------------------------------------------------------------

export type BehaviourDomain = 'gen' | 'box' | 'mt' | 'wr' | 'ju' | 'bjj' | 'sub' | 'mma';

/**
 * Which number a rule keys on. The discipline ids key on that discipline's own
 * tier; `subDefence`/`subAttack` key on the 0-100 composite band (04's
 * SUBDEF/SUB); `experience` keys on the 0-1 scalar of 01 §2.4.1.
 */
export type TierKey =
  | CoreDisciplineId
  | 'subDefence' | 'subAttack'
  | 'mmaTier' | 'iqTier' | 'strikingTier' | 'grapplingTier'
  | 'experience';

/** Keys whose range is a 0-100 band rather than an integer tier. */
const BAND_KEYS: ReadonlySet<TierKey> = new Set<TierKey>(['subDefence', 'subAttack', 'experience']);

export interface TierBehaviourRule {
  /** `beh.<domain>.<name>`. */
  id: string;
  domain: BehaviourDomain;
  /** The tier this rule reads (01 §3.8: always the discipline it belongs to). */
  discipline: TierKey;
  /** Inclusive tier range, or band range for `subDefence`/`subAttack`/`experience`. */
  tiers: [min: number, max: number];
  /** Engine predicate id evaluated by 07; `always` means unconditional. */
  trigger: string;
  /** What the rule does, in the chapter's own words. */
  effect: string;
  /** Animation set / overlay this rule turns on (01 §3.9). */
  animationTag?: string[];
  /** Provenance `[S: …]` / `[D: …]` / `[E]`. */
  tag: string;
}

/** Anything with per-key tier numbers can be matched against the catalogue. */
export interface TierSource {
  readonly tiers: Readonly<Partial<Record<TierKey, number>>>;
}

function inRange(value: number, [min, max]: [number, number], band: boolean): boolean {
  if (!band) return value >= min && value <= max;
  // Bands are half-open so that 19.9 is "untrained" and 20.0 is "novice";
  // the top band closes so a perfect 100 still matches.
  return value >= min && (value < max || max >= 100);
}

export interface RulesForOptions {
  domain?: BehaviourDomain | BehaviourDomain[];
  /** Only rules whose trigger is one of these (plus `always`). */
  trigger?: string | string[];
  /** Restrict to a single keyed tier, e.g. only the wrestling rows. */
  discipline?: TierKey | TierKey[];
}

/**
 * Every catalogue row active for this fighter. 07 calls it once per bout and
 * caches the result; nothing here depends on per-tick state, so the returned
 * list is stable for the whole bout.
 */
export function rulesFor(source: TierSource, options: RulesForOptions = {}): TierBehaviourRule[] {
  const domains = options.domain === undefined
    ? undefined
    : new Set(Array.isArray(options.domain) ? options.domain : [options.domain]);
  const triggers = options.trigger === undefined
    ? undefined
    : new Set(Array.isArray(options.trigger) ? options.trigger : [options.trigger]);
  const disciplines = options.discipline === undefined
    ? undefined
    : new Set(Array.isArray(options.discipline) ? options.discipline : [options.discipline]);

  const out: TierBehaviourRule[] = [];
  for (const rule of TIER_BEHAVIOUR_CATALOGUE) {
    if (domains && !domains.has(rule.domain)) continue;
    if (disciplines && !disciplines.has(rule.discipline)) continue;
    if (triggers && rule.trigger !== 'always' && !triggers.has(rule.trigger)) continue;
    const value = source.tiers[rule.discipline];
    if (value === undefined) continue;
    if (!inRange(value, rule.tiers, BAND_KEYS.has(rule.discipline))) continue;
    out.push(rule);
  }
  return out;
}

/** One rule by id, for the tests and the Model tab. */
export function ruleById(id: string): TierBehaviourRule | undefined {
  return TIER_BEHAVIOUR_CATALOGUE.find((r) => r.id === id);
}

/** Every animation tag the active rules ask 08 for. */
export function animationTagsFor(source: TierSource, options: RulesForOptions = {}): string[] {
  const tags = new Set<string>();
  for (const rule of rulesFor(source, options)) {
    for (const t of rule.animationTag ?? []) tags.add(t);
  }
  return [...tags].sort();
}

// --------------------------------------------------------------------------
// 3. Per-tier execution and telegraph modifiers (01 §2.7.8)
// --------------------------------------------------------------------------

/** Kick execution time multiplier by tier `[S: MT §6]`; T1 interpolated `[E]`. */
export const EXEC_TIME_MULT: readonly number[] = [1.50, 1.40, 1.25, 1.00, 0.90, 0.85];
/** Added to the defender's read probability `[S: MT §6]`. */
export const TELEGRAPH_MOD: readonly number[] = [0.25, 0.20, 0.15, 0, -0.05, -0.10];
/** Kick power scaling from hip rotation quality `[S: MT §6]`. */
export const HIP_ROTATION_MULT: readonly number[] = [0.50, 0.60, 0.75, 1.00, 1.05, 1.10];
/** Grappling action energy cost by bjj tier `[S: BJJ §6]` (`beh.bjj.energy`). */
export const TIER_ENERGY_COST_MULT: readonly number[] = [1.6, 1.3, 1.1, 1.1, 1.0, 0.9];

/** Animation tags this catalogue introduces (01 §3.9); 08 owns the clips. */
export const ANIMATION_TAGS: Readonly<Record<string, string>> = Object.freeze({
  'anim.flinch_cover': 'Reflexive cover-up with head tuck, no counter posture',
  'anim.counter_slot': 'Pre-loaded counter posture (weight on rear leg, hand cocked)',
  'anim.gaze_scatter': 'Head/eye darting to limbs; visible nervousness',
  'anim.eyes_shut_flinch': 'Eyes closed, head turns on incoming power strike',
  'anim.turn_away_cover': 'Turns side/back to opponent, arms over head',
  'anim.guard_low_mouth_open': 'Hands at chest/waist, mouth open, chin up',
  'anim.feet_flat': 'Flat-footed shuffle, no bounce',
  'anim.windmill': 'Wild alternating overhand swings, head down',
  'anim.hit_react_big': 'Exaggerated hit reaction (head snap, stagger, facial)',
  'anim.grab_push': 'Untrained two-hand push / lapel grab',
  'anim.headlock_pull': 'Side headlock with pulling',
  'anim.clinch_hands_busy': 'Hands holding the opponent, head unguarded',
  'anim.stance_square_heels': 'Square stance, weight back on heels',
  'anim.step_cross': 'Feet crossing during lateral movement',
  'anim.chin_up': 'Chin lifted, neck extended',
  'anim.guard_chest': 'Hands held at chest height',
  'anim.punch_arm_only': 'Punch without hip/shoulder rotation, elbow flared',
  'anim.fist_drop_windup': 'Fist dips before launching',
  'anim.overreach': 'Over-extended punch with forward lean, stumble on miss',
  'anim.retreat_straight': 'Straight-line backward retreat',
  'anim.kick_windup_leanback': 'Visible chamber/lean-back before a kick',
  'anim.kick_instep': 'Kick contacting with foot/instep rather than shin',
  'anim.kick_no_reset': 'Lands square with hands down after kicking',
  'anim.neck_grab_pull': 'Untrained neck grab and pull in the clinch',
  'anim.shot_bent_waist': 'Takedown attempt bending at the waist, head down/outside',
  'anim.turn_to_knees_back_exposed': 'Turns to knees away from the opponent, exposing the back',
  'anim.judo_stiff_arm_bent': 'Stiff-arm, forward-bent grip posture',
  'anim.fall_flat': 'Flat back landing without breakfall',
  'anim.breakfall': 'Slapping breakfall, rolls to base',
  'anim.mount_bottom_straight_arm': 'Straight-arm push against the chest from mount bottom',
  'anim.turtle_panic': 'Turns to belly and covers head under strikes',
});

// --------------------------------------------------------------------------
// 4. THE CATALOGUE (01 §3.0-§3.7)
// --------------------------------------------------------------------------

const ALL: [number, number] = [0, 5];

/** 01 §3.0 — perception, arousal, fatigue and hurt behaviour. */
const GEN_RULES: TierBehaviourRule[] = [
  { id: 'beh.gen.read', domain: 'gen', discipline: 'strikingTier', tiers: ALL,
    trigger: 'opponentInitiatesTechnique',
    effect: 'P(read) = readP_dom (§2.7.6). Read → reactive defence/counter allowed; no read → positional defence only.',
    tag: '[S: LIT_B §4.1]' },
  { id: 'beh.gen.simple_rt_untiered', domain: 'gen', discipline: 'strikingTier', tiers: ALL,
    trigger: 'always',
    effect: 'Latency = reactionTimeMs x fatigueRtMult; no tier term anywhere.',
    tag: '[S: LIT_B §4.2]' },
  { id: 'beh.gen.cue_lead', domain: 'gen', discipline: 'strikingTier', tiers: [2, 5],
    trigger: 'opponentWindUp',
    effect: 'Effective latency reduced by cueLeadMs (0-100 ms) against a telegraphed attack.',
    tag: '[S: LIT_B §4.2]' },
  { id: 'beh.gen.reflex_defensive', domain: 'gen', discipline: 'strikingTier', tiers: [0, 1],
    trigger: 'readSucceeded',
    effect: 'w(cover, step back) x3, w(counter) x0.2 -> counterOnReadP ~ 0.05.',
    animationTag: ['anim.flinch_cover'], tag: '[S: LIT_B §4.4]' },
  { id: 'beh.gen.reflex_counter', domain: 'gen', discipline: 'strikingTier', tiers: [4, 5],
    trigger: 'readSucceeded',
    effect: 'Counter fires with counterOnReadP (~0.45-0.53).',
    animationTag: ['anim.counter_slot'], tag: '[S: LIT_B §4.4]' },
  { id: 'beh.gen.feint_bite', domain: 'gen', discipline: 'strikingTier', tiers: ALL,
    trigger: 'opponentFeints',
    effect: 'P(bite) = feintBiteP (T0 0.60 … T5 0.24); a bite commits a defensive action and grants the attacker 02\'s setup bonus.',
    tag: '[S: LIT_B §4.5]' },
  { id: 'beh.gen.anxiety_gaze', domain: 'gen', discipline: 'strikingTier', tiers: [0, 3],
    trigger: 'highArousalWindow',
    effect: 'readP -= anxietyReadPenalty (T0 ~ -0.155, T4 ~ -0.07 at composure 50). Triggers: first 60 s of R1, 20 s after being hurt, behind in the final round, hostile crowd.',
    animationTag: ['anim.gaze_scatter'], tag: '[S: LIT_B §4.3]; triggers [E]' },
  { id: 'beh.gen.fatigue_rt', domain: 'gen', discipline: 'strikingTier', tiers: ALL,
    trigger: 'fatigueAbove0p4',
    effect: 'Latency x (1 + 0.125 f); readP unchanged — the expert defensive edge compresses late.',
    tag: '[S: LIT_B §4.7]' },
  { id: 'beh.gen.eyes_close', domain: 'gen', discipline: 'strikingTier', tiers: [0, 0],
    trigger: 'incomingPowerStrike',
    effect: 'P = 0.70: readP = 0 for the exchange, absorb -0.15.',
    animationTag: ['anim.eyes_shut_flinch'], tag: '[S: BOX §8 r31] (-0.15); P [E]' },
  { id: 'beh.gen.eyes_close_t1', domain: 'gen', discipline: 'strikingTier', tiers: [1, 1],
    trigger: 'incomingPowerStrikeInExchange',
    effect: 'P = 0.30, same effect as beh.gen.eyes_close.',
    animationTag: ['anim.eyes_shut_flinch'], tag: '[E]' },
  { id: 'beh.gen.turn_away', domain: 'gen', discipline: 'strikingTier', tiers: [0, 0],
    trigger: 'hitCleanOrThreeInTwoSeconds',
    effect: 'P = 0.50: turns side/back; absorb 0 for follow-ups; back-of-head exposure gives the attacker a foul roll (06).',
    animationTag: ['anim.turn_away_cover'], tag: '[S: BOX §6]; P [E]' },
  { id: 'beh.gen.hands_drop_tired', domain: 'gen', discipline: 'strikingTier', tiers: ALL,
    trigger: 'fatigueThresholdByTier',
    effect: 'T0-T1 at f > 0.45, T2 at f > 0.6, T3+ at f > 0.75: guard height -30 % (T0-T1) / -15 % (T2+).',
    animationTag: ['anim.guard_low_mouth_open', 'anim.feet_flat'], tag: '[S: BOX §6]; thresholds [E]' },
  { id: 'beh.gen.adrenaline_dump', domain: 'gen', discipline: 'experience', tiers: [0, 0.5],
    trigger: 'round1First150s',
    effect: 'dump = (1 - experience)(1 - composureEff/100) x eventMagnitude; costs x(1 + 0.6 dump), decision -20 % dump, output +15 % dump for 45 s then -25 % dump.',
    tag: '[S: DP §4.6]' },
  { id: 'beh.gen.t0_burst_collapse', domain: 'gen', discipline: 'strikingTier', tiers: [0, 0],
    trigger: 'anyEngagement',
    effect: 'Output bursts 15-25 attempts/min for <= 20 s, then output x0.4; energy costs x1.8.',
    tag: '[S: FD §5]; x0.4 / x1.8 [E]' },
  { id: 'beh.gen.panic_flurry', domain: 'gen', discipline: 'strikingTier', tiers: [0, 1],
    trigger: 'rushedOrAcuteHeadAbove30',
    effect: 'w(wild swing) x3, w(defence) x0.5; costs x2.',
    animationTag: ['anim.windmill'], tag: '[S: MIS §7.5 D-3] pattern; values [E]' },
  { id: 'beh.gen.hurt_t0', domain: 'gen', discipline: 'mmaTier', tiers: [0, 0],
    trigger: 'rocked',
    effect: "hurtBehaviour = 'turnAway': w(cover) x2, w(turn away) per beh.gen.turn_away; backs straight to the fence.",
    tag: '[S: MIS §8]' },
  { id: 'beh.gen.hurt_t1', domain: 'gen', discipline: 'mmaTier', tiers: [1, 1],
    trigger: 'rocked',
    effect: "'coverOnCage': w(cover) x2, w(retreat straight) x2.",
    tag: '[S: MIS §8]' },
  { id: 'beh.gen.hurt_t2', domain: 'gen', discipline: 'mmaTier', tiers: [2, 2],
    trigger: 'rocked', effect: "'clinch' x2.", tag: '[S: MIS §8]' },
  { id: 'beh.gen.hurt_t3', domain: 'gen', discipline: 'mmaTier', tiers: [3, 3],
    trigger: 'rocked',
    effect: "'clinch' or 'shoot' x2 (shoot if wrestling tier >= T3).", tag: '[S: MIS §8]' },
  { id: 'beh.gen.hurt_t4', domain: 'gen', discipline: 'mmaTier', tiers: [4, 4],
    trigger: 'rocked',
    effect: "'clinch' or 'circleOut' x2 (circleOut if boxing.footwork >= 60).", tag: '[S: MIS §8]' },
  { id: 'beh.gen.hurt_t5', domain: 'gen', discipline: 'mmaTier', tiers: [5, 5],
    trigger: 'rocked',
    effect: "'counter': w(counter) x1.5; rocked decision penalty x0.7 of the 05 value.",
    tag: '[S: MIS §8]; x0.7 [E]' },
  { id: 'beh.gen.hurt_behaviour_duration', domain: 'gen', discipline: 'mmaTier', tiers: ALL,
    trigger: 'rocked',
    effect: 'The chosen hurt behaviour persists 10-20 s with effectiveIQ -1.',
    tag: '[S: MIS §7.5 D-1]' },
  { id: 'beh.gen.pacing_t0', domain: 'gen', discipline: 'strikingTier', tiers: [0, 0],
    trigger: 'round1',
    effect: 'Pace target x1.5 for 60 s; no reserve (see beh.gen.t0_burst_collapse).',
    tag: '[S: BOX §6]' },
  { id: 'beh.gen.pacing_t1', domain: 'gen', discipline: 'strikingTier', tiers: [1, 1],
    trigger: 'round2OrLater',
    effect: 'Output x0.70 in R2, x0.55 in R3 unless cardioEff >= 70.',
    tag: '[S: BOX §6], R3/R1 0.70 [S: FD §5]; R2 [E]' },
  { id: 'beh.gen.pacing_t2', domain: 'gen', discipline: 'strikingTier', tiers: [2, 2],
    trigger: 'always', effect: 'R3/R1 output ratio ~ 0.80.', tag: '[S: FD §5]' },
  { id: 'beh.gen.pacing_t3', domain: 'gen', discipline: 'strikingTier', tiers: [3, 3],
    trigger: 'always', effect: 'R3/R1 ~ 0.85; corner-driven pace changes.',
    tag: '[S: FD §5], [S: BOX §6]' },
  { id: 'beh.gen.pacing_t4', domain: 'gen', discipline: 'strikingTier', tiers: [4, 5],
    trigger: 'always',
    effect: 'R3/R1 ~ 0.85-0.90; late surge when the own score estimate says behind (T5 adjusts pace to score).',
    tag: '[S: FD §5], [S: BOX §6]' },
  { id: 'beh.gen.compose_sell', domain: 'gen', discipline: 'strikingTier', tiers: [3, 5],
    trigger: 'hitByLowPowerStrike',
    effect: 'No hit-reaction animation; the judges\' visible-damage cue is suppressed.',
    tag: '[S: MT §6], [S: MT §8 r24]' },
  { id: 'beh.gen.show_pain', domain: 'gen', discipline: 'strikingTier', tiers: [0, 1],
    trigger: 'anyCleanHit',
    effect: 'Visible-damage judge cue x1.5.',
    animationTag: ['anim.hit_react_big'], tag: '[S: MT §6]; x1.5 [E]' },
  { id: 'beh.gen.score_awareness', domain: 'gen', discipline: 'iqTier', tiers: [1, 5],
    trigger: 'roundEndOrFinal60s',
    effect: 'Score-estimate sigma (rounds) 1.0 / 0.7 / 0.5 / 0.3 / 0.2 by iqTier; T0 (untrained) has no estimate.',
    tag: '[S: MIS §8]' },
  { id: 'beh.gen.corner_uptake', domain: 'gen', discipline: 'iqTier', tiers: [1, 5],
    trigger: 'roundBreak',
    effect: 'Corner-instruction uptake 0.5 / 0.6 / 0.7 / 0.8 / 0.9 by iqTier, plus the adaptability term (§2.5).',
    tag: '[S: MIS §8]' },
  { id: 'beh.gen.adapt_cadence', domain: 'gen', discipline: 'iqTier', tiers: [1, 5],
    trigger: 'inRound',
    effect: 'T_eval never / 90 / 60 / 30 / 20 s; P(change|signal) 0.3 / 0.5 / 0.7 / 0.85 / 0.95 x adaptability term; dwell — / 45 / 30 / 20 / 15 s.',
    tag: '[S: MIS §7.3]' },
  { id: 'beh.gen.plan_abandon', domain: 'gen', discipline: 'mmaTier', tiers: ALL,
    trigger: 'hitCleanTwiceInTenSeconds',
    effect: 'P = 0.6 x (1 - discipline/100): plan weights off, favouriteTechniques x2 (fights on instinct).',
    tag: '[E]; failure mode [S: MIS §7.8 (3)]' },
  { id: 'beh.gen.second_wind', domain: 'gen', discipline: 'mmaTier', tiers: ALL,
    trigger: 'fatigueRecoveredBelow0p55',
    effect: 'f falls from > 0.7 to < 0.55 via >= 40 s low intensity: +10 % output and decision quality for 60 s.',
    tag: '[S: DP §4.5]' },
  { id: 'beh.gen.finisher_reckless', domain: 'gen', discipline: 'iqTier', tiers: [1, 2],
    trigger: 'opponentHurt',
    effect: 'w(swing) x2, defence x0.5, drain x2. Also fires at any iqTier when aggression >= 75.',
    tag: '[S: MIS §7.5 D-3]; aggression gate [E]' },
  { id: 'beh.gen.finisher_measured', domain: 'gen', discipline: 'iqTier', tiers: [3, 5],
    trigger: 'opponentHurt',
    effect: 'Straights/knees x1.5, keep balance >= 60 %, cut the cage; stop if hit-rate < 40 % over 8 attempts.',
    tag: '[S: MIS §7.5 D-3]' },
  { id: 'beh.gen.stance_familiarity', domain: 'gen', discipline: 'mmaTier', tiers: ALL,
    trigger: 'unfamiliarOpponentStance',
    effect: 'ST-5 penalties x (1 - stanceFamiliarity): reaction +10 %, counter accuracy -10 %, wrong-side step 15 %/exchange at familiarity 0.',
    tag: '[S: MIS §5.1]' },
  { id: 'beh.gen.t0_grab_push', domain: 'gen', discipline: 'mmaTier', tiers: [0, 0],
    trigger: 'opponentWithinHalfMetre',
    effect: 'w(grab / push / headlock) x3 over strikes.',
    animationTag: ['anim.grab_push', 'anim.headlock_pull'], tag: '[S: FD §6] pattern; x3 [E]' },
  { id: 'beh.gen.t0_fall_together', domain: 'gen', discipline: 'grapplingTier', tiers: [0, 0],
    trigger: 'clinchLongerThanThreeSeconds',
    effect: 'P(both fall) 0.35 per 5 s against another T0; landing position random (top/bottom 50/50).',
    tag: '[E]; [S: FD §5 "who hits the ground"]' },
  { id: 'beh.gen.t0_no_guard_when_grabbed', domain: 'gen', discipline: 'mmaTier', tiers: [0, 0],
    trigger: 'grabbedOrClinched',
    effect: 'Hands stop guarding: head absorb 0 against clinch strikes.',
    animationTag: ['anim.clinch_hands_busy'], tag: '[E]' },
  { id: 'beh.gen.crowd_mode_size', domain: 'gen', discipline: 'mmaTier', tiers: [0, 0],
    trigger: 'openWeightVsT0',
    effect: 'Size dominates: 02/03 mass terms unmodified, but readP floors at 0.45 for both (no anticipation on either side).',
    tag: '[S: FD §5 rule (4)]; floor [E]' },
];

/** 01 §3.1 — boxing, keyed on the boxing tier. */
const BOX_RULES: TierBehaviourRule[] = [
  { id: 'beh.box.square_stance', domain: 'box', discipline: 'boxing', tiers: [0, 0],
    trigger: 'standing',
    effect: 'Squareness 0.8, weight on heels, chin up: P(hit lands on chin/jaw sub-location) +0.15; takedown vulnerability +20 %.',
    animationTag: ['anim.stance_square_heels'], tag: '[S: BOX §6]; values [E]' },
  { id: 'beh.box.cross_feet', domain: 'box', discipline: 'boxing', tiers: [0, 2],
    trigger: 'lateralMovement',
    effect: 'P(feet cross per step) 0.25 / 0.10 / 0.02 (T0 / T1 / T2); while crossed: balance -40 %, punch power x0.5, P(stumble on contact) 0.3.',
    animationTag: ['anim.step_cross'], tag: '[S: BOX §6, §8 r32]' },
  { id: 'beh.box.chin_up_mouth_open', domain: 'box', discipline: 'boxing', tiers: [0, 1],
    trigger: 'alwaysT0TiredT1',
    effect: "T0 always, T1 at f > 0.5: 05's relaxed/mouth-open x1.2 on alphaEq permanently on.",
    animationTag: ['anim.chin_up'], tag: '[S: DP §3.2], [S: BOX §6]' },
  { id: 'beh.box.hands_at_chest', domain: 'box', discipline: 'boxing', tiers: [0, 0],
    trigger: 'guardPosture',
    effect: 'Guard height -40 %: head absorb (blocked) 0.5 -> 0.2.',
    animationTag: ['anim.guard_chest'], tag: '[S: BOX §6]; 0.2 [E]' },
  { id: 'beh.box.arm_punch', domain: 'box', discipline: 'boxing', tiers: [0, 0],
    trigger: 'anyPunch',
    effect: 'techGate ~ 0.50; elbows flare; wide loops give hook telegraph +0.25.',
    animationTag: ['anim.punch_arm_only'], tag: '[S: LIT_B §4.9], [S: BOX §6]' },
  { id: 'beh.box.fist_drop_telegraph', domain: 'box', discipline: 'boxing', tiers: [0, 1],
    trigger: 'beforeEachPunch',
    effect: 'Telegraph +0.25 (T0) / +0.15 (T1).',
    animationTag: ['anim.fist_drop_windup'], tag: '[S: BOX §6]; values [S: MT §6 telegraph]' },
  { id: 'beh.box.overcommit', domain: 'box', discipline: 'boxing', tiers: [0, 1],
    trigger: 'powerPunch',
    effect: 'Commitment cost +2 (T0) / +1 (T1); on miss P(stumble) 0.35 / 0.15; counter window x2.',
    animationTag: ['anim.overreach'], tag: '[S: BOX §6]; stumble P [S: MT §6]' },
  { id: 'beh.box.repertoire_t0', domain: 'box', discipline: 'boxing', tiers: [0, 0],
    trigger: 'always',
    effect: 'Available: {1, 2, wild 1-2-3, high guard, back-straight-up}; combo accuracy x0.6 per punch after the first; no feints, no counters.',
    tag: '[S: BOX §8 r31]; decay [E]' },
  { id: 'beh.box.repertoire_t1', domain: 'box', discipline: 'boxing', tiers: [1, 1],
    trigger: 'always',
    effect: 'Adds {3, 4, 5/6 (accuracy x0.7), 1-2, 1-2-3, block, one slip direction}.',
    tag: '[S: BOX §8 r31]' },
  { id: 'beh.box.repertoire_t2', domain: 'box', discipline: 'boxing', tiers: [2, 2],
    trigger: 'always',
    effect: 'Adds {all punches, body work, parry/catch/slip/roll (one direction well), 1 feint type, basic counters, pivot}.',
    tag: '[S: BOX §8 r31]' },
  { id: 'beh.box.repertoire_t3', domain: 'box', discipline: 'boxing', tiers: [3, 3],
    trigger: 'always',
    effect: 'Adds {check hook, shoulder roll (if guardStyle = philly), set-up chains, ring cutting, L-step, pull counter}.',
    tag: '[S: BOX §8 r31]' },
  { id: 'beh.box.repertoire_t4', domain: 'box', discipline: 'boxing', tiers: [4, 4],
    trigger: 'always',
    effect: 'Adds {delayed counters, rhythm breaking, layered feints, per-round adaptation}.',
    tag: '[S: BOX §8 r31]' },
  { id: 'beh.box.repertoire_t5', domain: 'box', discipline: 'boxing', tiers: [5, 5],
    trigger: 'always',
    effect: 'Adds {within-exchange adaptation, style switch}; opponent-tendency noise sigma -> 5 % by the end of R2.',
    tag: '[S: BOX §8 r31], [S: BOX §6]' },
  { id: 'beh.box.high_guard_only', domain: 'box', discipline: 'boxing', tiers: [1, 1],
    trigger: 'incomingPunchRead',
    effect: 'Defence choice = high guard 90 %; when slipping, P(wrong direction) 0.30 -> eats the punch at x1.2 damage.',
    tag: '[S: BOX §6]; x1.2 [E]' },
  { id: 'beh.box.hands_drop_after_punch', domain: 'box', discipline: 'boxing', tiers: [1, 1],
    trigger: 'afterEveryPunch',
    effect: 'Guard -25 % for 300 ms; opponent counter window x1.5.',
    tag: '[S: BOX §6]; values [E]' },
  { id: 'beh.box.backs_straight_up', domain: 'box', discipline: 'boxing', tiers: [0, 1],
    trigger: 'underPressure',
    effect: 'w(retreat straight) x3, w(circle) x0.3.',
    animationTag: ['anim.retreat_straight'], tag: '[S: BOX §6], [S: MIS §8]' },
  { id: 'beh.box.rear_hand_home', domain: 'box', discipline: 'boxing', tiers: [2, 2],
    trigger: 'jabbing',
    effect: 'Rear hand stays in guard: absorb vs the opponent lead hook +0.2.',
    tag: '[S: BOX §6]; +0.2 [E]' },
  { id: 'beh.box.one_direction_slip', domain: 'box', discipline: 'boxing', tiers: [2, 2],
    trigger: 'slipping',
    effect: "Slips to one side only; the opponent gets 02's setup bonus after observing 3 slips.",
    tag: '[S: BOX §6]' },
  { id: 'beh.box.holds_stance', domain: 'box', discipline: 'boxing', tiers: [2, 2],
    trigger: 'always',
    effect: 'Squareness 0.2; small pivots; stance breaks only when hit or f > 0.7.',
    tag: '[S: BOX §6]' },
  { id: 'beh.box.hip_rotation_appears', domain: 'box', discipline: 'boxing', tiers: [1, 5],
    trigger: 'punches',
    effect: 'techGate is read from `power`; T1 still overcommits.',
    tag: '[S: BOX §6], [S: LIT_B §4.10]' },
  { id: 'beh.box.volume_target', domain: 'box', discipline: 'boxing', tiers: ALL,
    trigger: 'proLengthRound',
    effect: 'Thrown per round: T0 20-35 (wild), T1 35-50, T2 45-60, T3 50-60, T4 40-70 (style), T5 style-dependent; MMA rulesets scale to 02\'s per-minute targets.',
    tag: '[S: BOX §6]' },
  { id: 'beh.box.accuracy_reference', domain: 'box', discipline: 'boxing', tiers: ALL,
    trigger: 'equalTierReference',
    effect: 'Power/jab landed %: T0 ~15/10, T1 25/12, T2 30/15, T3 35/18, T4 40-48/20-25, T5 45-50 power.',
    tag: '[S: BOX §6] (T0 [E] there)' },
  { id: 'beh.box.defence_reference', domain: 'box', discipline: 'boxing', tiers: ALL,
    trigger: 'equalTierReference',
    effect: 'Opponent connect %: T0 45-55, T1 40, T2 33, T3 29, T4 20-25, T5 < 20.',
    tag: '[S: BOX §6]' },
  { id: 'beh.box.block_counter', domain: 'box', discipline: 'boxing', tiers: [2, 5],
    trigger: 'successfulBlockOrParry',
    effect: 'Counter available with P = counterOnReadP; T0-T1 ~ 0 (novice winners 2.8 vs losers 0.1 block-counters per bout).',
    tag: '[S: LIT_B §5.1]' },
  { id: 'beh.box.angles', domain: 'box', discipline: 'boxing', tiers: [3, 5],
    trigger: 'afterAnExchange',
    effect: 'w(pivot / L-step) x1.5 (T3), x2 (T4+); T4+ controls the lead foot against southpaws (MIS §5.1 ST-1).',
    tag: '[S: BOX §6]; multipliers [E]' },
  { id: 'beh.box.economy_inside', domain: 'box', discipline: 'boxing', tiers: [3, 5],
    trigger: 'shortRange',
    effect: 'Short punches: exec x0.85, commitment -1.',
    tag: '[S: BOX §6]; values [E]' },
  { id: 'beh.box.feint_layering', domain: 'box', discipline: 'boxing', tiers: [4, 5],
    trigger: 'settingUpPowerShot',
    effect: ">= 2 feints precede; sell quality = `feints`; the opponent's feintBiteP applies to each.",
    tag: '[S: BOX §6]' },
  { id: 'beh.box.delayed_counter', domain: 'box', discipline: 'boxing', tiers: [4, 5],
    trigger: 'opponentCombinationEnds',
    effect: 'Half-beat counter: accuracy +0.10.',
    tag: '[S: BOX §6]; +0.10 [E]' },
  { id: 'beh.box.pull_counter', domain: 'box', discipline: 'boxing', tiers: [3, 5],
    trigger: 'opponentJabsOrCrosses',
    effect: 'Available if headMovement >= 55; T3 executes at 0.7 quality, T4+ at full.',
    tag: '[S: BOX §8 r31]; gate [E]' },
  { id: 'beh.box.body_work', domain: 'box', discipline: 'boxing', tiers: ALL,
    trigger: 'opponentGuardHighOrOnFence',
    effect: 'w(body punches) x1.3 (T2+); x0.3 (T0-T1 head-hunt).',
    tag: '[S: BOX §6]; multipliers [E]' },
  { id: 'beh.box.ring_cutting', domain: 'box', discipline: 'boxing', tiers: ALL,
    trigger: 'opponentCircles',
    effect: '`ringCraft` gates cut-off stepping (T3-T5); T0-T1 chase straight (w(advance straight) x2).',
    tag: '[S: BOX §6], [S: MIS §8]' },
  { id: 'beh.box.reads_adapt', domain: 'box', discipline: 'boxing', tiers: ALL,
    trigger: 'always',
    effect: 'T0 none; T1 responds only to being hit; T2 sticks to plan; T3 corner-driven; T4 self-adjusts per round; T5 within exchanges.',
    tag: '[S: BOX §6]' },
  { id: 'beh.box.guard_style_gate', domain: 'box', discipline: 'boxing', tiers: [3, 5],
    trigger: 'guardStylePhilly',
    effect: 'Shoulder roll at 0.65 quality only if guard >= 55 and headMovement >= 55, else the amateur 0.40 version.',
    tag: '[S: BOX §4 D9]; gate [E]' },
  { id: 'beh.box.eyes_on_torso', domain: 'box', discipline: 'boxing', tiers: [2, 5],
    trigger: 'exchange',
    effect: 'No flinch flag; fixation on chest/shoulders -> readP as computed (fewer fixations).',
    tag: '[S: LIT_B §4.1]' },
  { id: 'beh.box.lead_hand_use', domain: 'box', discipline: 'boxing', tiers: ALL,
    trigger: 'round1',
    effect: 'w(jab) x1.2 for T2+, x0.8 for T0-T1 (winners threw 34.2 vs 26.5 lead-hand punches in R1 at novice level).',
    tag: '[S: LIT_B §5.1]; multipliers [E]' },
];

/** 01 §3.2 — Muay Thai and kickboxing. */
const MT_RULES: TierBehaviourRule[] = [
  { id: 'beh.mt.kick_exec_time', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'kick',
    effect: 'Exec time x execTimeMult (1.50 / 1.40 / 1.25 / 1.00 / 0.90 / 0.85).',
    tag: '[S: MT §6]' },
  { id: 'beh.mt.kick_telegraph', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'kick',
    effect: 'Defender read + telegraphMod (+0.25 … -0.10); T0 shows a lean-back wind-up.',
    animationTag: ['anim.kick_windup_leanback'], tag: '[S: MT §6]' },
  { id: 'beh.mt.hip_rotation', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'roundKick',
    effect: 'Power x hipRotationMult (0.50 … 1.10); T0-T1 kick with the foot/instep, self-injury (foot) P x3.',
    animationTag: ['anim.kick_instep'], tag: '[S: MT §6], [S: MT §2 S1]; x3 [E]' },
  { id: 'beh.mt.balance_after_kick', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'kickMissedOrChecked',
    effect: 'P(fall or stumble) miss/checked: T0-T1 0.35/0.45, T2 0.15/0.25, T3 0.05/0.10, T4 0.03/0.06, T5 0.02/0.04; x balanceStumbleMult.',
    tag: '[S: MT §6]' },
  { id: 'beh.mt.no_return_to_stance', domain: 'mt', discipline: 'muayThai', tiers: [0, 1],
    trigger: 'afterAnyKick',
    effect: 'P 0.60 (T0) / 0.30 (T1): stays square with hands down -> counter window x2.',
    animationTag: ['anim.kick_no_reset'], tag: '[S: MT §6] (x2); P [E]' },
  { id: 'beh.mt.check_rate', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'incomingLowKickRead',
    effect: 'P(attempt check): T0 < 0.10, T1 0.10, T2 0.25, T3 0.50, T4 0.60, T5 0.70 (and reads feints).',
    tag: '[S: MT §6]' },
  { id: 'beh.mt.kick_selection', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'always',
    effect: 'T0-T1 rear low/body only, no teep, no switch; T2 + teep, switch kick; T3 full catalogue; T4 + question-mark, spinning; T5 + deception layers.',
    tag: '[S: MT §6]' },
  { id: 'beh.mt.catch_behaviour', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'bodyKickCaught',
    effect: 'T0-T1 attempt on anything (w(catch) x2, success x0.5, punched during the catch P 0.4); T2 catches, no follow-up; T3 catch -> sweep/knee; T4 chooses the counter by the opponent\'s balance; T5 catches and dumps, baits kicks.',
    tag: '[S: MT §6]; T0 values [E]' },
  { id: 'beh.mt.clinch_behaviour', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'clinch',
    effect: 'T0-T1 grab the neck, pull, get turned (P 0.6); T2 basic plum, snap-down; T3 frame, swim, turn; T4 positional cycling; T5 controls exchanges and off-balances at will.',
    animationTag: ['anim.neck_grab_pull'], tag: '[S: MT §6]; P [E]' },
  { id: 'beh.mt.compose_scoring', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'hit',
    effect: 'T0-T1 react to every hit; T2 some; T3 neutral; T4 sells composure, walks off kicks; T5 manipulates judges, stalls the last round when ahead (Thai rules).',
    tag: '[S: MT §6]' },
  { id: 'beh.mt.fatigue_kicking', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'fatigue',
    effect: 'Kick weight: T0-T1 x0.2 once f > 0.5 ("stops kicking by R2"); T2 by R3; T3 ~ 80 % retained by R5; T4 ~ 90 %; T5 ~ 95 %.',
    tag: '[S: MT §6]' },
  { id: 'beh.mt.dutch_gating', domain: 'mt', discipline: 'kickboxing', tiers: ALL,
    trigger: 'lowKickWithDutchStyle',
    effect: '60 % of low kicks follow a punch combination (+0.10 accuracy, -0.15 telegraph).',
    tag: '[S: MT §8 r23]' },
  { id: 'beh.mt.thai_style', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'thaiRulesetWithThaiStyle',
    effect: 'Body kicks / clinch knees / teeps preferred by thaiStyle; minimal punching for score; coasts R5 if ahead.',
    tag: '[S: MT §8 r24]' },
  { id: 'beh.mt.lean_back_t0', domain: 'mt', discipline: 'muayThai', tiers: [0, 0],
    trigger: 'anyKick',
    effect: 'Torso lean >= 20 deg: head kick unavailable; body-kick range -0.10 m.',
    tag: '[E]' },
  { id: 'beh.mt.head_kick_gate', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'headKick',
    effect: 'Available only if flexibility >= 40 and (muayThai.kicks >= 30 or taekwondo.headKicks >= 30); quality x flexKickQualityMult.',
    tag: '[E]' },
  { id: 'beh.mt.teep_usage', domain: 'mt', discipline: 'muayThai', tiers: [2, 5],
    trigger: 'opponentAdvancing',
    effect: 'w(teep) x (1 + teep/100); T0-T1 have no teep.',
    tag: '[S: MT §6]; multiplier [E]' },
  { id: 'beh.mt.spinning_gate', domain: 'mt', discipline: 'muayThai', tiers: [4, 5],
    trigger: 'opponentSquareOrAfterSetup',
    effect: 'Spinning techniques available (also unlocked at any tier by taekwondo.spinning >= 50).',
    tag: '[S: MT §6]' },
  { id: 'beh.mt.shin_conditioning', domain: 'mt', discipline: 'muayThai', tiers: ALL,
    trigger: 'ownKickChecked',
    effect: "Attacker's share of checked-kick damage: x1.3 (T0-T1), x1.0 (T2), x0.8 (T3+) on 05's 60 % base.",
    tag: '[S: DP §2.3] base; multipliers [E]' },
  { id: 'beh.mt.elbow_availability', domain: 'mt', discipline: 'muayThai', tiers: [2, 5],
    trigger: 'shortRangeOrClinch',
    effect: 'Elbows available; T0-T1 have w(elbow) = 0.',
    tag: '[E]' },
  { id: 'beh.mt.knee_availability', domain: 'mt', discipline: 'muayThai', tiers: [1, 5],
    trigger: 'clinch',
    effect: 'Curved knees from T1; straight and long knees from T2.',
    tag: '[E]' },
  { id: 'beh.mt.question_mark_setup', domain: 'mt', discipline: 'muayThai', tiers: [4, 5],
    trigger: 'twoPriorLowKicksLanded',
    effect: 'Question-mark kick accuracy 0.15 -> 0.35.',
    tag: '[S: MT §2 K6]' },
  { id: 'beh.mt.calf_kick_targeting', domain: 'mt', discipline: 'muayThai', tiers: [2, 5],
    trigger: 'opponentSquareOrFrontHeavy',
    effect: 'w(calf kick) x1.5 against squareness > 0.5.',
    tag: '[S: MT §2 K7]; x1.5 [E]' },
  { id: 'beh.mt.kb_winner_profile', domain: 'mt', discipline: 'kickboxing', tiers: [3, 5],
    trigger: 'always',
    effect: "Hooks x1.2, punch combinations x1.2, foot defence and clinch x1.2 (the winners' profile).",
    tag: '[S: LIT_B §5.5]; multipliers [E]' },
];

/** 01 §3.3 — wrestling. */
const WR_RULES: TierBehaviourRule[] = [
  { id: 'beh.wr.no_level_change', domain: 'wr', discipline: 'wrestling', tiers: [0, 1],
    trigger: 'shot',
    effect: 'Bends at the waist and reaches with the arms: shot success -20 pp; eats a counter strike on 30 % of shots.',
    animationTag: ['anim.shot_bent_waist'], tag: '[S: WR §7]' },
  { id: 'beh.wr.level_change_rate', domain: 'wr', discipline: 'wrestling', tiers: [2, 5],
    trigger: 'shot',
    effect: 'Proper level change 60 % (T2) / 90 % (T3) / always (T4+, feinted and mixed with strikes: level-change uppercut, jab-to-double).',
    tag: '[S: WR §7]' },
  { id: 'beh.wr.head_position', domain: 'wr', discipline: 'wrestling', tiers: ALL,
    trigger: 'shot',
    effect: 'Head down-outside-low: T0-T1 guillotine catch window x2.5; T2 correct 60 %; T3 85 %; T4+ correct.',
    tag: '[S: WR §7]' },
  { id: 'beh.wr.sprawl_late', domain: 'wr', discipline: 'wrestling', tiers: [0, 1],
    trigger: 'opponentShoots',
    effect: 'Sprawl reaction >= 0.6 s (fires only if the shot exec >= 600 ms); denies ~ 20 %.',
    tag: '[S: WR §7]' },
  { id: 'beh.wr.sprawl_rate', domain: 'wr', discipline: 'wrestling', tiers: [2, 5],
    trigger: 'shotOnSelf',
    effect: 'Denies ~ 50 % (T2) / 65-75 % (T3) / 80-90 % (T4+, elite examples 91-93 %).',
    tag: '[S: WR §7]' },
  { id: 'beh.wr.chain_after_stall', domain: 'wr', discipline: 'wrestling', tiers: ALL,
    trigger: 'shotStalledInSprawl',
    effect: "P(re-attack) = 03's 0.15 + 0.008 x wrestling.chains (T0 0.15 … T5 0.91 at band midpoints); T0-T1 stall in pos.td_sprawl; T4+ chain steps retain the full base %.",
    tag: '[S: WR §7, §9 r9]' },
  { id: 'beh.wr.timing_shots', domain: 'wr', discipline: 'wrestling', tiers: ALL,
    trigger: 'opponentCommitsStrike',
    effect: 'Reactive shots: T0-T1 never; T2 10 % of shots; T3 30 %; T4+ >= 50 % reactive/setup (reactive +15 pp).',
    tag: '[S: WR §7]' },
  { id: 'beh.wr.finish_selection', domain: 'wr', discipline: 'wrestling', tiers: ALL,
    trigger: 'shotInOnLegs',
    effect: 'T0-T1 one finish (drive), repeated; T2 two; T3 3-4, switches on the whizzer; T4+ full tree, takes what the defence gives.',
    tag: '[S: WR §7]' },
  { id: 'beh.wr.cage_use', domain: 'wr', discipline: 'wrestling', tiers: ALL,
    trigger: 'openMatStall',
    effect: 'Drives to the fence: T0-T1 never (loses SINGLE_LEG_IN to hops/limp leg); T2 50 %; T3 75 %; T4+ 90 %.',
    tag: '[S: WR §7]' },
  { id: 'beh.wr.bottom_turns_away', domain: 'wr', discipline: 'wrestling', tiers: [0, 1],
    trigger: 'bottomStandUpAttempt',
    effect: 'Turns away: 30 % of attempts cost BACK_CONTROL.',
    animationTag: ['anim.turn_to_knees_back_exposed'], tag: '[S: WR §7]' },
  { id: 'beh.wr.standup_rate', domain: 'wr', discipline: 'wrestling', tiers: [2, 5],
    trigger: 'bottomStandUpAttempt',
    effect: 'Technical stand-up 25 % (T2) / wall walk + kimura grip 35 % (T3) / 45-55 % (T4+), rarely giving the back.',
    tag: '[S: WR §7]' },
  { id: 'beh.wr.energy', domain: 'wr', discipline: 'wrestling', tiers: ALL,
    trigger: 'shot',
    effect: 'T0-T1 shoot from far: 2x energy per attempt. T4+ attempts per landed TD ~ 1.6 (population 2.5).',
    tag: '[S: WR §7]' },
  { id: 'beh.wr.ride_retention', domain: 'wr', discipline: 'wrestling', tiers: ALL,
    trigger: 'afterATakedown',
    effect: 'Loses position within 30 s: T0-T1 55 %, T2 40 %, T3 25 %, T4+ 15 %.',
    tag: '[S: WR §7]' },
  { id: 'beh.wr.setup_class', domain: 'wr', discipline: 'iqTier', tiers: [1, 5],
    trigger: 'shotDecision',
    effect: 'Naked / off a single strike / off combinations / off feints and reactions / off tendencies.',
    tag: '[S: MIS §8]' },
  { id: 'beh.wr.background_offsets', domain: 'wr', discipline: 'wrestling', tiers: ALL,
    trigger: 'always',
    effect: 'Style-tag offsets on the effective sub-skills (leg attacks / upper-body / mat returns / scrambles): freestyle +10/0/+5/+5, folkstyle +8/+2/+10/+10, greco -5/+15/+5/0, judo-sambo -5/+10/+5/0, bjj-only -15/-5/-5/+5.',
    tag: '[S: WR §7] (greco +15 [S->E])' },
  { id: 'beh.wr.t0_tackle', domain: 'wr', discipline: 'wrestling', tiers: [0, 0],
    trigger: 'grapplingUrge',
    effect: 'Head-down football tackle: success 20-30 % against another T0 (no sprawl), ~ 5 % against T2+ (eats guillotine / knee).',
    tag: '[S: FD §5]; vs T2+ [E]' },
  { id: 'beh.wr.stall_in_sprawl', domain: 'wr', discipline: 'wrestling', tiers: [0, 1],
    trigger: 'sprawledOn',
    effect: "Stays head-down in SPRAWL_TOP; the opponent's guillotine / D'Arce entry weight x2.",
    tag: '[S: WR §7]; x2 [E]' },
  { id: 'beh.wr.underhook_pummel', domain: 'wr', discipline: 'wrestling', tiers: ALL,
    trigger: 'clinch',
    effect: 'T3+ w(pummel for underhooks) x1.5; T0-T1 w(headlock, over-hook squeeze) x2.',
    tag: '[E]; [S: JU §6 MMA specifics]' },
  { id: 'beh.wr.tired_defence', domain: 'wr', discipline: 'wrestling', tiers: ALL,
    trigger: 'fatigue',
    effect: 'Takedown defence -15 % at f = 0.5, -35 % at f = 0.8.',
    tag: '[S: DP §4.3]' },
  { id: 'beh.wr.control_time_target', domain: 'wr', discipline: 'wrestling', tiers: [4, 5],
    trigger: 'afterTakedown',
    effect: 'Expected control ~ 100 s per takedown (winners) vs 79 s (losers) — emergent from ride_retention; calibration check only.',
    tag: '[S: LIT_B §2.14]' },
];

/** 01 §3.4 — judo. */
const JU_RULES: TierBehaviourRule[] = [
  { id: 'beh.ju.posture_t0', domain: 'ju', discipline: 'judo', tiers: [0, 1],
    trigger: 'gripOrClinch',
    effect: 'Stiff arms, bent forward, head down, weight on toes: opponent snap-down / koshi-guruma / sumi-gaeshi x1.5; collar tie and arm drag +15 pp.',
    animationTag: ['anim.judo_stiff_arm_bent'], tag: '[S: JU §6]; values [E]' },
  { id: 'beh.ju.grip_t0', domain: 'ju', discipline: 'judo', tiers: [0, 1],
    trigger: 'gripExchange',
    effect: 'Grabs whatever is offered, never breaks grips: opponent dominant-grip P 0.75.',
    tag: '[S: JU §6]; P [E]' },
  { id: 'beh.ju.grip_t2', domain: 'ju', discipline: 'judo', tiers: [2, 3],
    trigger: 'gripExchange',
    effect: 'Breaks grips; preferred grip ~ 50 % of exchanges; over-relies on one grip (readable after 3 exchanges).',
    tag: '[S: JU §6]' },
  { id: 'beh.ju.grip_t4', domain: 'ju', discipline: 'judo', tiers: [4, 5],
    trigger: 'gripExchange',
    effect: 'Wins the grip 65-70 % against intermediates; varies tsurite; dictates ai/kenka-yotsu.',
    tag: '[S: JU §6]' },
  { id: 'beh.ju.kuzushi_t0', domain: 'ju', discipline: 'judo', tiers: [0, 1],
    trigger: 'throwAttempt',
    effect: 'No kuzushi; throws from the arms; P(throws himself) 0.30; mirror counters / tani otoshi succeed > 50 %.',
    tag: '[S: JU §6]; 0.30 [E]' },
  { id: 'beh.ju.kuzushi_t2', domain: 'ju', discipline: 'judo', tiers: [2, 3],
    trigger: 'throw',
    effect: 'One-direction kuzushi, telegraphed (+0.15 read).',
    tag: '[S: JU §6]; +0.15 [E]' },
  { id: 'beh.ju.kuzushi_t4', domain: 'ju', discipline: 'judo', tiers: [4, 5],
    trigger: 'throw',
    effect: "Multi-directional; action-reaction on 34.8 % of attacks; uses uke's step.",
    tag: '[S: JU §6], [S: JU §7.4]' },
  { id: 'beh.ju.attack_pattern', domain: 'ju', discipline: 'judo', tiers: ALL,
    trigger: 'always',
    effect: 'T0-T1 single telegraphed attempts in one direction; T2-T3 two directions, occasional combination; T4-T5 3-4 directions with chains (ko-uchi -> uchi-mata, o-uchi -> uchi-mata, seoi -> ko-uchi) and counters ready.',
    tag: '[S: JU §6]' },
  { id: 'beh.ju.attack_rate', domain: 'ju', discipline: 'judo', tiers: ALL,
    trigger: 'perMatch',
    effect: 'Real attempts per match: 1-3 (T0-T1, many false attacks) / 4-6 (T2-T3) / 6-9 (T4-T5).',
    tag: '[S: JU §6], [S: JU §7.2]' },
  { id: 'beh.ju.failure_mode', domain: 'ju', discipline: 'judo', tiers: ALL,
    trigger: 'failedThrow',
    effect: 'T0-T1 thrown by their own momentum; after a failed drop seoi they fall to the knees -> pinned / back taken (P 0.5). T2-T3 lose the grip and reset; T4-T5 clean reset keeping the grip, countered ~ 3 % of attempts.',
    tag: '[S: JU §6]; P 0.5 [E]' },
  { id: 'beh.ju.defence_posture', domain: 'ju', discipline: 'judo', tiers: ALL,
    trigger: 'opponentAttacks',
    effect: 'T0-T1 stiff-arm, bend forward, retreat; T2-T3 hips back, arm block, can be pulled; T4-T5 hips in, head up, step around.',
    tag: '[S: JU §6]' },
  { id: 'beh.ju.mma_t0', domain: 'ju', discipline: 'judo', tiers: [0, 1],
    trigger: 'mmaClinch',
    effect: 'Clinch-shy, arms extended -> easy collar tie / arm drag; falls into guard on any trip.',
    tag: '[S: JU §6]' },
  { id: 'beh.ju.mma_t2', domain: 'ju', discipline: 'judo', tiers: [2, 3],
    trigger: 'mmaClinch',
    effect: 'Knows under/over-hooks but gives up the body lock.',
    tag: '[S: JU §6]' },
  { id: 'beh.ju.mma_t4', domain: 'ju', discipline: 'judo', tiers: [4, 5],
    trigger: 'mmaClinch',
    effect: "Pummels for inside position; uses strikes as kuzushi; times uke's shot or punch.",
    tag: '[S: JU §6]' },
  { id: 'beh.ju.tier_mult', domain: 'ju', discipline: 'judo', tiers: ALL,
    trigger: 'throwResolutionCrossTier',
    effect: 'Novice vs elite: elite success x2.5 (cap 75 %), novice x0.25; counter-launch novice x0.3, elite x1.5 (against intermediates).',
    tag: '[S: JU §6]' },
  { id: 'beh.ju.ukemi', domain: 'ju', discipline: 'judo', tiers: ALL,
    trigger: 'beingThrown',
    effect: 'ukemi < 30 lands flat (+10 acute body, 05); 30-70 lands on the side; >= 70 lands in guard / turtles to base.',
    animationTag: ['anim.fall_flat', 'anim.breakfall'], tag: '[E]' },
];

/** 01 §3.5 — BJJ and ground positional play. */
const BJJ_RULES: TierBehaviourRule[] = [
  { id: 'beh.bjj.bottom_t0', domain: 'bjj', discipline: 'bjj', tiers: [0, 0],
    trigger: 'onBottom',
    effect: 'Flat on the back; closed guard only by luck; turns to belly under strikes 90 %; straight-arm push from mount bottom (armbar exposure x3).',
    animationTag: ['anim.mount_bottom_straight_arm', 'anim.turtle_panic'], tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.bottom_t1', domain: 'bjj', discipline: 'bjj', tiers: [1, 1],
    trigger: 'onBottom',
    effect: 'Closed guard, holds and stalls (referee stand-ups); hip escape known but slow (duration x1.5).',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.bottom_t2', domain: 'bjj', discipline: 'bjj', tiers: [2, 3],
    trigger: 'onBottom',
    effect: 'Half-guard game: knee shield, underhook, dogfight; some butterfly; wall walks.',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.bottom_t4', domain: 'bjj', discipline: 'bjj', tiers: [4, 4],
    trigger: 'onBottom',
    effect: 'Full guard retention; butterfly / SLX entries; wrestle-ups; leg-lock threats deter passes; cage-savvy.',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.bottom_t5', domain: 'bjj', discipline: 'bjj', tiers: [5, 5],
    trigger: 'onBottom',
    effect: "Never flat; chains sweep -> sub -> get-up; wrestle-ups from every seated guard; uses the strikes' openings (upa on posts).",
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.top_t0', domain: 'bjj', discipline: 'bjj', tiers: [0, 0],
    trigger: 'onTop',
    effect: 'Lies in guard, punches wildly, posts hands (opponent upa +20 pp); swept from mount by upa 2x.',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.top_t1', domain: 'bjj', discipline: 'bjj', tiers: [1, 1],
    trigger: 'onTop',
    effect: 'Passes only knee-cut / stack; holds side control without advancing; ground-and-pound from half at a low rate.',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.top_t2', domain: 'bjj', discipline: 'bjj', tiers: [2, 3],
    trigger: 'onTop',
    effect: 'Knee cut + smash pass + cross-face GnP from half; takes mount; loses back control by rushing the RNC.',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.top_t4', domain: 'bjj', discipline: 'bjj', tiers: [4, 4],
    trigger: 'onTop',
    effect: 'Chain passing (pass -> pass 0.30); body lock; floating; strikes to pass; systematic back control (hooks -> body triangle -> hand fight).',
    tag: '[S: BJJ §6], [S: LIT_B §5.11]' },
  { id: 'beh.bjj.top_t5', domain: 'bjj', discipline: 'bjj', tiers: [5, 5],
    trigger: 'onTop',
    effect: 'Positional chains with minimal risk; turtle -> back 60 %+; GnP volume without giving up posture; finishes from every dominant node.',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.energy', domain: 'bjj', discipline: 'bjj', tiers: ALL,
    trigger: 'grappling',
    effect: 'Action cost x1.6 (T0: panics, holds breath, gassed by 90 s of scrambling), x1.3 (T1), x1.1 (T2-T3), x1.0 (T4), x0.9 (T5).',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.decision_latency', domain: 'bjj', discipline: 'bjj', tiers: ALL,
    trigger: 'betweenEdgeAttempts',
    effect: 'Latency 4-8 s (T0) / 3-5 (T1) / 2-4 (T2-T3) / 1.5-3 (T4) / 1-2 s (T5).',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.turns_back', domain: 'bjj', discipline: 'bjj', tiers: ALL,
    trigger: 'sideControlEscape',
    effect: 'Gives up the back 60 % / 40 % / 20 % / 8 % / 3 % (T5 turns only with a plan: wall walk / roll).',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.mount_escape_attempts', domain: 'bjj', discipline: 'bjj', tiers: ALL,
    trigger: 'underMountPer30s',
    effect: 'Attempts per 30 s: 1 (bridge-and-push) / 2 / 3 / 4 / 5 (kipping + elbow-knee + frames).',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.sub_exit_awareness', domain: 'bjj', discipline: 'bjj', tiers: ALL,
    trigger: 'postingOrStriking',
    effect: 'T0 none (arm extended -> armbar 5 % per 10 s); T1 low; T2-T3 medium; T4 high; T5 very high.',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.cage_use', domain: 'bjj', discipline: 'bjj', tiers: ALL,
    trigger: 'groundNearFence',
    effect: 'T0 no; T1 rarely; T2-T3 wall walk; T4 both sides; T5 also denies the opponent\'s use (knee pin, body-lock pinning).',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.pass_repertoire', domain: 'bjj', discipline: 'bjj', tiers: ALL,
    trigger: 'choosePass',
    effect: 'T0 stack 60 / knee-cut 40; T1 knee-cut 50 / stack 30 / toreando 20; T2-T3 knee-cut 35 / smash 25 / toreando 20 / over-under 10 / body lock 10; T4 knee-cut 25 / body lock 20 / leg drag 15 / toreando 15 / HQ 15 / float 10; T5 body lock 25 / float 20 / knee-cut 20 / leg drag 15 / toreando 10 / cage 10.',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.sweep_repertoire', domain: 'bjj', discipline: 'bjj', tiers: ALL,
    trigger: 'chooseSweep',
    effect: 'T0 none (bucks); T1 hip bump / scissor / basic butterfly; T2-T3 butterfly / underhook half / knee-shield wrestle-up; T4 + X / SLX, deep half, arm drag; T5 + K-guard, leg entanglements, matrix back takes.',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.guard_vs_strikes', domain: 'bjj', discipline: 'bjj', tiers: ALL,
    trigger: 'strikesLandedFromTop',
    effect: 'Guard opens after 3 landed (T0) / 5 (T1); T2-T3 hold and re-guard; T4 hold with frames + wrist control; T5 counter strikes with sweeps / subs.',
    tag: '[S: BJJ §6]' },
  { id: 'beh.bjj.mma_bottom_priority', domain: 'bjj', discipline: 'mmaTier', tiers: [2, 5],
    trigger: 'onBottom',
    effect: 'Stand > sweep > submit; a fighter with bjj.mean >= 50 and mmaIntegration.getUps < 30 inverts it (submit first).',
    tag: '[S: BJJ §6 (a)]; gate [E]' },
  { id: 'beh.bjj.head_control_first', domain: 'bjj', discipline: 'bjj', tiers: [3, 5],
    trigger: 'justAfterTakedownOnTop',
    effect: 'First action = cross-face / chin control (kills the wrestle-up and the wall walk).',
    tag: '[S: BJJ §6 (c)]' },
  { id: 'beh.bjj.leg_entanglement_rarity', domain: 'bjj', discipline: 'bjj', tiers: ALL,
    trigger: 'legLockEntryUnderMmaRules',
    effect: 'w(leg entanglement) x0.3 unless legLocks >= 75 (the head is exposed to punches during entries).',
    tag: '[S: BJJ §6 (e)]; x0.3 [E]' },
  { id: 'beh.bjj.t0_hold_breath', domain: 'bjj', discipline: 'bjj', tiers: [0, 0],
    trigger: 'anyGrappling',
    effect: 'Lactate accumulation x1.4.',
    tag: '[S: BJJ §6] direction; x1.4 [E]' },
  { id: 'beh.bjj.knee_on_belly_pressure', domain: 'bjj', discipline: 'bjj', tiers: [3, 5],
    trigger: 'sideControlOnTurningOpponent',
    effect: 'w(knee-on-belly, turtle strikes) x1.4 (the fastest way to force the back).',
    tag: '[S: BJJ §6 (d)]; x1.4 [E]' },
];

/** 01 §3.6 — submissions, keyed on the 0-100 SUBDEF / SUB composite bands. */
const SUB_RULES: TierBehaviourRule[] = [
  { id: 'beh.sub.untrained_no_tap', domain: 'sub', discipline: 'subDefence', tiers: [0, 20],
    trigger: 'caught',
    effect: "Doesn't recognise danger: defence rolls x0.10 at S1/S2; time-to-tap +50 %; no_tap 40 % -> LOC (P 0.5 in chokes) or injury (P 0.3 in joint locks); taps to cranks and pressure; gives the back under any pressure.",
    tag: '[S: SUB §4]' },
  { id: 'beh.sub.novice_late', domain: 'sub', discipline: 'subDefence', tiers: [20, 40],
    trigger: 'caught',
    effect: 'Defends only at S3 (x0.4 at S1, x0.6 at S2, x1.0 at S3); taps to americanas, can-openers, neck cranks, shoulder chokes; leaves arms extended; steps over guards into leg locks.',
    tag: '[S: SUB §4]' },
  { id: 'beh.sub.intermediate', domain: 'sub', discipline: 'subDefence', tiers: [40, 60],
    trigger: 'caught',
    effect: 'Defends at S2 (x0.8 at S1); good RNC hand-fighting, answers the phone against guillotine / triangle; still gives the arm-triangle under GnP; rarely taps to cranks.',
    tag: '[S: SUB §4]' },
  { id: 'beh.sub.advanced', domain: 'sub', discipline: 'subDefence', tiers: [60, 80],
    trigger: 'caught',
    effect: 'Defends at S1 (x1.0 everywhere); positional escapes; submitted only when hurt, exhausted, or by a specialist.',
    tag: '[S: SUB §4]' },
  { id: 'beh.sub.elite', domain: 'sub', discipline: 'subDefence', tiers: [80, 100],
    trigger: 'always',
    effect: 'Prevents S0 (never gives the position); early hand-fighting; endures cranks and partial chokes to the bell; x1.4 S1, x1.25 S2, x1.1 S3; needs damage/fatigue or a skill gap >= 20 to be finished with regularity.',
    tag: '[S: SUB §4]' },
  { id: 'beh.sub.stubbornness', domain: 'sub', discipline: 'subDefence', tiers: [0, 100],
    trigger: 'stage3LockedBloodChoke',
    effect: 'stubbornness (§2.7.7): base 0.19 / 0.11 / 0.05 by band; no tap -> LOC at N(9.0, 1.5) s clamped to [6, 13].',
    tag: '[S: SUB §4, §5 r7]' },
  { id: 'beh.sub.attempt_rate', domain: 'sub', discipline: 'subAttack', tiers: [0, 100],
    trigger: 'submissionAvailable',
    effect: 'p_attempt = 0.15 + 0.35 x SUB/100; x2 submissionHunt, x0.5 wrestler/GnP style, x1.5 opponent rocked, x0.5 at fatigue > 70 % (RNC / arm-triangle exempt).',
    tag: '[S: SUB §5 r2]' },
  { id: 'beh.sub.specialist_conversion', domain: 'sub', discipline: 'subAttack', tiers: [85, 100],
    trigger: 'attempts',
    effect: "~ 30 % of recorded attempts convert vs a roster 17-22 % — must emerge from SUB §5 r5's skill-gap term; calibration check only.",
    tag: '[S: SUB §4]' },
  { id: 'beh.sub.arm_extension_t0', domain: 'sub', discipline: 'subDefence', tiers: [0, 20],
    trigger: 'pushingTheTopFighter',
    effect: 'Straight-arm push -> armbar / kimura availability P 0.05 per 10 s from mount.',
    tag: '[S: BJJ §6]' },
  { id: 'beh.sub.neck_when_hurt', domain: 'sub', discipline: 'mmaTier', tiers: ALL,
    trigger: 'rockedAndShotOnOrSnappedDown',
    effect: 'With mmaIntegration.subDefenceUnderStrikes < 30: gives the neck; guillotine S1 +20 pp; turning grants RNC S0.',
    tag: '[S: SUB §4] direction; +20 pp [E]' },
  { id: 'beh.sub.tap_early_injury_history', domain: 'sub', discipline: 'subDefence', tiers: [0, 100],
    trigger: 'twoOrMoreSubLosses',
    effect: 'stubbornness x0.8.',
    tag: '[S: SUB §4 Hinz 2021]; x0.8 [E]' },
  { id: 'beh.sub.early_hand_fight', domain: 'sub', discipline: 'subDefence', tiers: [60, 100],
    trigger: 'backTaken',
    effect: "Hand-fighting begins at S0 (before the choke arm is in): 04's S1 base x0.8 for the attacker.",
    tag: '[S: SUB §4] ("defends at S1"); x0.8 [E]' },
];

/** 01 §3.7 — MMA integration and fight IQ. */
const MMA_RULES: TierBehaviourRule[] = [
  { id: 'beh.mma.range_t1', domain: 'mma', discipline: 'iqTier', tiers: [1, 1],
    trigger: 'standing',
    effect: "Stands at the end of the opponent's reach: range error +0.15 m toward the opponent's optimum.",
    tag: '[S: MIS §8]; 0.15 m [E]' },
  { id: 'beh.mma.range_t2', domain: 'mma', discipline: 'iqTier', tiers: [2, 2],
    trigger: 'pressured',
    effect: 'Knows own range, forgets it: the same error while pressured.',
    tag: '[S: MIS §8]' },
  { id: 'beh.mma.range_t3', domain: 'mma', discipline: 'iqTier', tiers: [3, 3],
    trigger: 'always',
    effect: 'At the planned range 80 % of standing time.',
    tag: '[S: MIS §8]; 80 % [E]' },
  { id: 'beh.mma.range_t4', domain: 'mma', discipline: 'iqTier', tiers: [4, 5],
    trigger: 'always',
    effect: "Manipulates range with feints; T5 controls the opponent's perception (opponent range error +0.10 m).",
    tag: '[S: MIS §8]; 0.10 m [E]' },
  { id: 'beh.mma.kick_vs_wrestler_t1', domain: 'mma', discipline: 'mmaTier', tiers: [0, 1],
    trigger: 'vsWrestlingTierT3Plus',
    effect: "Kicks with the rear leg regardless -> the opponent's reactive-shot bonus applies.",
    tag: '[S: MIS §8]' },
  { id: 'beh.mma.kick_vs_wrestler_t2', domain: 'mma', discipline: 'mmaTier', tiers: [2, 2],
    trigger: 'afterBeingTakenDown',
    effect: 'w(kick) x0.3 for the rest of the fight.',
    tag: '[S: MIS §8]; x0.3 [E]' },
  { id: 'beh.mma.kicks_as_bait', domain: 'mma', discipline: 'iqTier', tiers: [4, 5],
    trigger: 'vsWrestler',
    effect: 'Uses kicks to bait shots for counters (MIS I-6).',
    tag: '[S: MIS §8]' },
  { id: 'beh.mma.cage_t1', domain: 'mma', discipline: 'iqTier', tiers: [1, 1],
    trigger: 'pressured', effect: 'Backs straight up.', tag: '[S: MIS §8]' },
  { id: 'beh.mma.cage_t2', domain: 'mma', discipline: 'iqTier', tiers: [2, 2],
    trigger: 'pressured',
    effect: 'Circles, the wrong way against a southpaw (P 0.5).',
    tag: '[S: MIS §8]; P [E]' },
  { id: 'beh.mma.cage_t3', domain: 'mma', discipline: 'iqTier', tiers: [3, 3],
    trigger: 'pressured',
    effect: 'Circles correctly, still gets caught (population fence time).',
    tag: '[S: MIS §8]' },
  { id: 'beh.mma.cage_t4', domain: 'mma', discipline: 'iqTier', tiers: [4, 5],
    trigger: 'pressured',
    effect: 'Rarely on the fence, escapes on angles; T5 uses the fence offensively (cage pins, wall-walk denial).',
    tag: '[S: MIS §8]' },
  { id: 'beh.mma.td_setup', domain: 'mma', discipline: 'iqTier', tiers: [1, 5],
    trigger: 'shoot',
    effect: 'Naked / off a single strike / off combinations / off feints and reactions / off the opponent\'s tendencies.',
    tag: '[S: MIS §8]' },
  { id: 'beh.mma.getup_t1', domain: 'mma', discipline: 'mmaTier', tiers: [0, 1],
    trigger: 'onBottom', effect: 'Turtles / covers.', tag: '[S: MIS §8]' },
  { id: 'beh.mma.getup_t2', domain: 'mma', discipline: 'mmaTier', tiers: [2, 2],
    trigger: 'onBottom', effect: 'Wall walk late (after ~ 20 s).', tag: '[S: MIS §8]; 20 s [E]' },
  { id: 'beh.mma.getup_t3', domain: 'mma', discipline: 'mmaTier', tiers: [3, 3],
    trigger: 'onBottom', effect: 'Wall walk immediately.', tag: '[S: MIS §8]' },
  { id: 'beh.mma.getup_t4', domain: 'mma', discipline: 'mmaTier', tiers: [4, 5],
    trigger: 'onBottom',
    effect: 'Never lets the top fighter settle (attempt every <= 8 s); T5 stand-ups lead into offence.',
    tag: '[S: MIS §8]; 8 s [E]' },
  { id: 'beh.mma.finisher', domain: 'mma', discipline: 'iqTier', tiers: [1, 5],
    trigger: 'opponentHurt',
    effect: 'Reckless / reckless / measured against good chins / measured / traps.',
    tag: '[S: MIS §8]' },
  { id: 'beh.mma.plan_quality', domain: 'mma', discipline: 'iqTier', tiers: [1, 5],
    trigger: 'preFight',
    effect: 'Scouting fidelity, plan features and failure modes per MIS §6.4 (sigma 30/20/12/8/5 %).',
    tag: '[S: MIS §6.4]' },
  { id: 'beh.mma.adapt_triggers', domain: 'mma', discipline: 'iqTier', tiers: [1, 5],
    trigger: 'inFight',
    effect: "Event-triggered evaluation: KD only / + TD / + stuffed TD x2 and hurt / + hit-rate collapse / + the opponent's adjustment detected.",
    tag: '[S: MIS §7.3]' },
  { id: 'beh.mma.effective_iq_degrade', domain: 'mma', discipline: 'mmaTier', tiers: ALL,
    trigger: 'damagedOrDrainedOrKnockedDown',
    effect: 'Damage > 60 % or stamina < 30 %: effectiveIQ -1; a knockdown costs another -1 for 20 s.',
    tag: '[S: MIS §7.3]' },
  { id: 'beh.mma.score_behind', domain: 'mma', discipline: 'iqTier', tiers: [3, 5],
    trigger: 'behindEnteringFinalRound',
    effect: "0-2 down -> finishSeek; 1-1 -> stealRound (volume).",
    tag: '[S: MIS §7.4]' },
  { id: 'beh.mma.trailing_td_drop', domain: 'mma', discipline: 'mmaTier', tiers: ALL,
    trigger: 'behindOnOwnEstimate',
    effect: 'Takedown attempts -38 %, submission attempts -49 %; strike volume unchanged.',
    tag: '[S: MIS §7.4], [S: FD #129]' },
  { id: 'beh.mma.level_change_striking', domain: 'mma', discipline: 'mmaIntegration', tiers: ALL,
    trigger: 'strikingExchange',
    effect: 'With levelChanges >= 50: jab-to-double, level-change uppercut and feint-shoot become available.',
    tag: '[S: MIS §2.1]; gate [E]' },
  { id: 'beh.mma.gnp_posture_t0', domain: 'mma', discipline: 'mmaIntegration', tiers: ALL,
    trigger: 'topWithLowGroundAndPound',
    effect: 'groundAndPound < 20: punches wildly, posts hands -> opponent upa +20 pp.',
    tag: '[S: BJJ §6]' },
  { id: 'beh.mma.gnp_posture_t3', domain: 'mma', discipline: 'mmaIntegration', tiers: ALL,
    trigger: 'topWithGoodGroundAndPound',
    effect: 'groundAndPound >= 50: strikes to pass; keeps posture; GnP volume 2-4 per control minute.',
    tag: '[S: BJJ §6], [S: BJJ §7.2]' },
  { id: 'beh.mma.corner_uptake', domain: 'mma', discipline: 'iqTier', tiers: [1, 5],
    trigger: 'roundBreak',
    effect: 'Corner uptake 0.5 / 0.6 / 0.7 / 0.8 / 0.9 by iqTier.',
    tag: '[S: MIS §8]' },
  { id: 'beh.mma.clinch_striking_gate', domain: 'mma', discipline: 'mmaIntegration', tiers: ALL,
    trigger: 'clinch',
    effect: 'w(dirty boxing, clinch elbows/knees) x (0.3 + 0.7 x clinchStriking/100).',
    tag: '[E]' },
  { id: 'beh.mma.hurt_shoot_smart', domain: 'mma', discipline: 'grapplingTier', tiers: [3, 5],
    trigger: 'rocked',
    effect: 'With iqTier >= 3: shoot / clinch immediately (the lowest KO-continuation risk).',
    tag: '[S: MIS §7.5 D-1]' },
  { id: 'beh.mma.t0_rule_ignorance', domain: 'mma', discipline: 'mmaTier', tiers: [0, 0],
    trigger: 'clinchOrGroundAndPound',
    effect: 'Grabs the fence or shorts P 0.2 per clinch; strikes to the back of the head P 0.1 per GnP burst (foul rolls -> 06).',
    tag: '[E]' },
  { id: 'beh.mma.fatigue_decision', domain: 'mma', discipline: 'mmaTier', tiers: ALL,
    trigger: 'fatigue',
    effect: 'Decision quality -15 % at f = 0.5, -35 % at f = 0.8.',
    tag: '[S: DP §4.3]' },
];

/**
 * The whole catalogue. Frozen because 07 caches slices of it per bout and a
 * mutated row would silently change a replay that had already been verified.
 */
export const TIER_BEHAVIOUR_CATALOGUE: readonly TierBehaviourRule[] = Object.freeze([
  ...GEN_RULES, ...BOX_RULES, ...MT_RULES, ...WR_RULES,
  ...JU_RULES, ...BJJ_RULES, ...SUB_RULES, ...MMA_RULES,
]);
