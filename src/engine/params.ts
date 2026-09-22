/**
 * ALL MODELLING ASSUMPTIONS LIVE IN THIS FILE.
 *
 * ############################################################################
 * #  NOTHING HERE IS FITTED TO REAL FIGHT DATA.                              #
 * #  Every constant below is a hand-chosen modelling assumption. The output   #
 * #  of this simulator describes THIS MODEL, not the real world. It is not a  #
 * #  validated predictor of what would happen between two actual people.      #
 * ############################################################################
 *
 * Scope: regulated, refereed, unified-rules-style competition with gloves,
 * a doctor present and a referee empowered to stop the contest. The model
 * represents accumulated impact as an abstract damage index (nominally 0-100, scaled per fighter
 * into a durability of roughly 110-130 for these two profiles) that
 * triggers an administrative stoppage. No injury, wound, medical outcome or
 * lasting harm is modelled or depicted.
 */

export interface Params {
  // ---- time base -------------------------------------------------------
  dt: number;             // seconds per simulation tick
  rounds: number;
  roundSeconds: number;
  breakSeconds: number;

  // ---- arena -----------------------------------------------------------
  cageRadius: number;     // metres

  // ---- attribute derivation -------------------------------------------
  refBodyMassKg: number;    // reference mass for the mass index
  refRelStrength: number;   // reference (bench+squat+dead)/bodyweight
  tkdTransfer: number;      // 1 yr Taekwondo counted as this many yrs of MMA-relevant striking
  boxTransfer: number;      // 1 yr boxing counted as this many yrs
  tauStriking: number;      // saturation constant, years
  tauGrappling: number;
  tauTechnical: number;
  strengthWeight: number;   // how much log-relative-strength feeds the power index
  massPowerWeight: number;  // how much log-relative-mass feeds the power index

  // ---- movement physics ------------------------------------------------
  baseSpeed: number;        // m/s at full stamina for a technique index of 0
  speedSkillBonus: number;  // extra m/s at technique index 1
  speedMassPenalty: number; // m/s lost per unit of log mass ratio
  accel: number;            // m/s^2
  drag: number;             // velocity damping per second
  staminaSpeedFactor: number;

  // ---- stamina ---------------------------------------------------------
  staminaMax: number;
  staminaRegenStanding: number;   // per second, at conditioning 0
  staminaRegenConditioning: number;
  staminaDrainMove: number;       // per second while moving at full speed
  staminaDrainClinch: number;
  staminaDrainGroundTop: number;
  staminaDrainGroundBottom: number;
  staminaDrainDamage: number;     // per unit of damage taken
  breakRecovery: number;          // fraction of missing stamina restored between rounds

  // ---- balance ---------------------------------------------------------
  balanceMax: number;
  balanceRegen: number;

  // ---- striking --------------------------------------------------------
  /** Base probability that a strike lands cleanly against a neutral defender. */
  strikeBaseHit: number;
  /** Logit gain per unit of (attacker striking index - defender striking index). */
  strikeSkillGain: number;
  /** Logit gain per unit of technique difference (feints, timing, ring craft). */
  strikeTechniqueGain: number;
  /** Logit penalty applied by an active block / guard. */
  blockLogit: number;
  /** Logit penalty applied by a successful evasion attempt. */
  evadeLogit: number;
  /** Logit penalty per unit of attacker fatigue (0-1). */
  strikeFatigueLogit: number;
  /** Logit penalty per unit of defender fatigue (defender gets slower). */
  defenceFatigueLogit: number;

  // ---- damage ----------------------------------------------------------
  damagePowerScale: number;   // multiplies the per-strike base damage
  damageVariation: number;    // lognormal sd of the per-strike damage roll
  damageBlockedFraction: number;
  /**
   * Placement lottery. A small fraction of landed strikes connect flush -
   * on the button, on the liver, on an unbraced neck - and do far more than an
   * average connection. This is the model's "puncher's chance": it is what lets
   * a much weaker fighter occasionally end a bout, and it applies to BOTH sides
   * on identical terms.
   */
  flushChance: number;
  flushMultiplier: number;
  knockdownThreshold: number; // single-strike damage that can drop someone
  knockdownChance: number;    // at the threshold
  tkoDamage: number;          // damage index at which the referee stops it
  damageRecoveryPerRound: number;

  // ---- grappling -------------------------------------------------------
  takedownBaseChance: number;
  takedownStrengthGain: number;  // logit gain per unit strength-index difference
  takedownMassGain: number;      // logit gain per unit log mass ratio
  takedownSkillGain: number;     // logit gain per unit grappling-index difference
  sprawlLogit: number;
  clinchBaseChance: number;
  clinchStrengthGain: number;
  /** Per-tick probability of advancing ground position, scaled by the same indices. */
  passBase: number;
  sweepBase: number;
  standUpBase: number;
  /** Submission progress per tick when unopposed; tap at progress >= 1. */
  subProgressBase: number;
  subEscapeBase: number;

  // ---- referee ---------------------------------------------------------
  refCheckSeconds: number;      // how often the ref evaluates a battered fighter
  groundedStrikeStopCount: number; // unanswered ground strikes before a stoppage
  standUpAfterStalledSeconds: number;

  // ---- scoring ---------------------------------------------------------
  scoreSigStrike: number;
  scoreTakedown: number;
  scoreControlPerSecond: number;
  scoreSubAttempt: number;
  judgeNoise: number;           // per-judge, per-round noise on the score margin

  // ---- stochastic variation -------------------------------------------
  formSd: number;              // per-bout "day form" multiplier sd (log scale)
  tendencySd: number;          // per-bout jitter on action tendencies
  decisionNoise: number;       // softmax temperature on action selection

  // ---- 1-vs-N handicap exhibition -------------------------------------
  /**
   * PURELY GEOMETRIC. There is no "numbers bonus" constant: how many
   * opponents can act on the lone fighter at once emerges from positions in
   * the cage and each attacker's own reach. The only extra assumptions are:
   */
  teamSpreadRadians: number;   // how widely the group fans out around the target
  swarmStaminaPenalty: number; // extra stamina drain per additional engaged opponent
  focusPenaltyLogit: number;   // defensive logit lost per additional engaged opponent
}

export const DEFAULT_PARAMS: Params = {
  dt: 0.1,
  rounds: 3,
  roundSeconds: 300,
  breakSeconds: 60,

  cageRadius: 4.6,

  refBodyMassKg: 68.0,
  refRelStrength: 3.0,
  tkdTransfer: 0.6,
  boxTransfer: 1.0,
  tauStriking: 4.0,
  tauGrappling: 4.0,
  tauTechnical: 3.0,
  strengthWeight: 0.55,
  massPowerWeight: 0.75,

  baseSpeed: 1.7,
  speedSkillBonus: 0.45,
  speedMassPenalty: 0.8,
  accel: 6.0,
  drag: 5.0,
  staminaSpeedFactor: 0.45,

  staminaMax: 100,
  staminaRegenStanding: 1.15,
  staminaRegenConditioning: 1.95,
  staminaDrainMove: 1.6,
  staminaDrainClinch: 3.1,
  staminaDrainGroundTop: 2.4,
  staminaDrainGroundBottom: 3.4,
  staminaDrainDamage: 0.55,
  breakRecovery: 0.45,

  balanceMax: 100,
  balanceRegen: 14,

  strikeBaseHit: 0.33,
  strikeSkillGain: 1.35,
  strikeTechniqueGain: 0.80,
  blockLogit: -1.35,
  evadeLogit: -1.15,
  strikeFatigueLogit: -1.5,
  defenceFatigueLogit: 1.2,

  damagePowerScale: 0.34,
  damageVariation: 0.50,
  damageBlockedFraction: 0.22,
  flushChance: 0.05,
  flushMultiplier: 2.3,
  knockdownThreshold: 5.2,
  knockdownChance: 0.35,
  tkoDamage: 100,
  damageRecoveryPerRound: 6,

  takedownBaseChance: 0.34,
  takedownStrengthGain: 1.1,
  takedownMassGain: 2.2,
  takedownSkillGain: 2.4,
  sprawlLogit: -1.0,
  clinchBaseChance: 0.58,
  clinchStrengthGain: 0.9,
  passBase: 0.055,
  sweepBase: 0.035,
  standUpBase: 0.05,
  subProgressBase: 0.075,
  subEscapeBase: 0.06,

  refCheckSeconds: 1.0,
  groundedStrikeStopCount: 5,
  standUpAfterStalledSeconds: 25,

  scoreSigStrike: 1.0,
  scoreTakedown: 4.0,
  scoreControlPerSecond: 0.12,
  scoreSubAttempt: 2.5,
  judgeNoise: 1.6,

  formSd: 0.16,
  tendencySd: 0.22,
  decisionNoise: 0.35,

  teamSpreadRadians: 2.1,
  swarmStaminaPenalty: 1.1,
  focusPenaltyLogit: 1.05,
};

export function cloneParams(p: Params = DEFAULT_PARAMS): Params {
  return { ...p };
}
