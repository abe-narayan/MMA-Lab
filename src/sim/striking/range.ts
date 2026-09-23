/**
 * RANGE AND GEOMETRY — chapter 02 §2.1, §2.7, §2.8.
 *
 * The one idea that runs through this file: **bands are asymmetric**. `d` is
 * the single centre-to-centre distance between the two fighters, but each
 * fighter reads it through their own reach, so a 10 cm reach advantage gives
 * the longer fighter a 5 cm shell where he can jab and the shorter cannot
 * (§2.1.1). That shell is the entire geometric content of "reach"; the accuracy
 * consequences (§2.8) are deliberately small, because the peer-reviewed
 * bout-level data show no reach effect on winning outside heavyweight.
 *
 * Nothing here rolls dice. Everything is a pure function of geometry and state;
 * the callers (resolve.ts, chapter 07) turn the returned logits into
 * probabilities.
 */
import type { RangeBand, TechniqueFamily, TechniqueSpec } from './catalogue';
import { BAND_ORDER } from './catalogue';

export type Stance = 'orthodox' | 'southpaw';

// ---------------------------------------------------------------------------
// §2.1.1 reach geometry
// ---------------------------------------------------------------------------

/** The per-weapon reaches derived from 01's two composites (§2.1.1 table). */
export interface ReachProfile {
  /** 01 §2.7 `(reachM - 0.20 x heightM)/2 + 0.10`; UFC pooled average 0.83 m. */
  effectiveReachM: number;
  /** 01's kick reach (leg reach + 0.15 m). */
  effectiveKickReachM: number;
  armLenM: number;
  jabReachM: number;
  crossReachM: number;
  hookReachM: number;
  uppercutReachM: number;
  elbowReachM: number;
  kneeReachM: number;
  kickReachM: number;
  teepReachM: number;
}

/** Additive constants of the §2.1.1 table; all [E] and all in `p.strike.geom.*`. */
export const GEOM = Object.freeze({
  /** lean +0.10, attacker shoulder-to-centre +0.05, defender face-to-centre +0.12. */
  jabReachAdd: 0.27,
  crossReachAdd: 0.04,
  armLenDrop: 0.10,
  hookReachAdd: 0.12,
  uppercutReachAdd: -0.05,
  elbowReachM: 0.55,
  kneeReachM: 0.65,
  /** pivot-foot travel plus defender torso on top of 01's kick reach. */
  kickReachAdd: 0.30,
  teepReachAdd: 0.25,
  stepGainMinM: 0.30,
  stepGainMaxM: 0.50,
  /** Bladedness lengthens the lead hand and shortens the rear hand (§2.1.2). */
  bladedReachM: 0.05,
});

/**
 * Build the per-weapon reaches. `bladedness` b in [0,1] moves the lead hand out
 * and the rear hand in by 0.05 m each (§2.1.2), which is why the profile — not
 * just the raw composites — is what the band test uses.
 */
export function reachProfile(
  effectiveReachM: number,
  effectiveKickReachM: number,
  bladedness = 0,
): ReachProfile {
  const b = clamp01(bladedness);
  const armLenM = effectiveReachM - GEOM.armLenDrop;
  const jabReachM = effectiveReachM + GEOM.jabReachAdd + GEOM.bladedReachM * b;
  return {
    effectiveReachM,
    effectiveKickReachM,
    armLenM,
    jabReachM,
    // The rear hand loses exactly what the lead hand gained.
    crossReachM: jabReachM + GEOM.crossReachAdd - 2 * GEOM.bladedReachM * b,
    hookReachM: armLenM + GEOM.hookReachAdd,
    uppercutReachM: armLenM + GEOM.uppercutReachAdd,
    elbowReachM: GEOM.elbowReachM,
    kneeReachM: GEOM.kneeReachM,
    kickReachM: effectiveKickReachM + GEOM.kickReachAdd,
    teepReachM: effectiveKickReachM + GEOM.teepReachAdd,
  };
}

/** Band boundaries of the §2.1.1 table; all [E]/[D] and in `p.strike.range.*`. */
export const BAND_BOUNDS = Object.freeze({
  /** two torso radii 0.18 m + 0.09 m. */
  clinchMax: 0.45,
  /** BOX §2 close < 0.5 m chest-to-chest, +0.2 m to centre-to-centre. */
  closeMax: 0.70,
  midToLongOffset: -0.15,
  longToKickOffset: 0.10,
});

export interface BandLimits {
  clinchMax: number;
  closeMax: number;
  /** mid ends / long starts here. */
  midMax: number;
  /** long ends / kick starts here. */
  longMax: number;
  /** kick ends / out starts here. */
  kickMax: number;
}

/** The attacker's own band edges, in metres of centre-to-centre distance. */
export function bandLimits(profile: ReachProfile): BandLimits {
  return {
    clinchMax: BAND_BOUNDS.clinchMax,
    closeMax: BAND_BOUNDS.closeMax,
    midMax: profile.jabReachM + BAND_BOUNDS.midToLongOffset,
    longMax: profile.jabReachM + BAND_BOUNDS.longToKickOffset,
    kickMax: profile.kickReachM,
  };
}

/** Which band the distance `d` sits in *for this fighter* (§2.1.1). */
export function bandFor(d: number, profile: ReachProfile): RangeBand {
  const l = bandLimits(profile);
  if (d < l.clinchMax) return 'clinch';
  if (d < l.closeMax) return 'close';
  if (d < l.midMax) return 'mid';
  if (d < l.longMax) return 'long';
  if (d < l.kickMax) return 'kick';
  return 'out';
}

/**
 * The shell where `a` can reach with a jab and `b` cannot — the concrete form of
 * "he has the reach advantage". Returns metres, 0 when `b` is the longer one.
 */
export function reachShellM(a: ReachProfile, b: ReachProfile): number {
  return Math.max(0, bandLimits(a).longMax - bandLimits(b).longMax);
}

// ---------------------------------------------------------------------------
// §2.1.1 range fit
// ---------------------------------------------------------------------------

export const RANGE_FIT = Object.freeze({
  /** Outer 10 cm of the home band. */
  edgeLogit: -0.30,
  edgeBandM: 0.10,
  wrongBandLogit: -0.60,
  forceEdgeMult: 0.70,
  forceSmotherMult: 0.60,
  /** Low-skill strikers suffer more out of band: (1 - skill/100) x k. */
  comfortK: 0.40,
});

export interface RangeFit {
  available: boolean;
  /** Logit added to arrival (§2.6.2 "Range fit"). */
  logit: number;
  /** Multiplier on delivered force (§2.6.4 `rangeFitMult`). */
  forceMult: number;
  /** How many bands away from home, 0 = in the home band. */
  bandsOut: number;
}

/**
 * §2.1.1: a technique may be thrown one band outside its home band with a
 * penalty and is unavailable two bands out. Hooks and kicks thrown *inside*
 * their band are smothered and lose force rather than accuracy.
 *
 * `skill` is the technique's own sub-skill (0-100); the direction of the
 * comfort term is sourced (medallists' timing is distance-invariant, novices'
 * is not), the magnitude is ours.
 */
/**
 * Can this technique connect from this band at all? 02 §2.1.1: a technique may
 * be thrown in its home band or one band either side (with a range-fit penalty),
 * but never from `range.out` — "nothing lands without a step". `out` is the
 * last band and has no outer edge, so without the explicit exclusion any
 * kick-band technique would count as "one band out" at any distance in the
 * cage. This is the single predicate the AI's candidate list and the contact
 * re-check both use, so they cannot disagree about what is in range.
 */
export function bandReachable(spec: TechniqueSpec, band: RangeBand): boolean {
  if (band === 'out') return false;
  return bandDistance(band, spec.band) <= 1;
}

export function rangeFit(spec: TechniqueSpec, d: number, profile: ReachProfile, skill = 50): RangeFit {
  const band = bandFor(d, profile);
  const home = spec.band;
  const comfort = (1 - clamp01(skill / 100)) * RANGE_FIT.comfortK;
  const bandsOut = bandDistance(band, home);
  if (!bandReachable(spec, band)) {
    return { available: false, logit: RANGE_FIT.wrongBandLogit - comfort, forceMult: 0, bandsOut };
  }

  if (bandsOut === 0) {
    // Inside the home band: only the outer 10 cm costs anything.
    const l = bandLimits(profile);
    const upper = bandUpperEdge(band, l);
    const atEdge = Number.isFinite(upper) && upper - d < RANGE_FIT.edgeBandM;
    if (atEdge) {
      return {
        available: true,
        logit: RANGE_FIT.edgeLogit - comfort,
        forceMult: RANGE_FIT.forceEdgeMult,
        bandsOut: 0,
      };
    }
    return { available: true, logit: 0, forceMult: 1, bandsOut: 0 };
  }
  if (bandsOut === 1) {
    // Smothered: a hook or kick thrown from inside its band keeps its accuracy
    // (the target is right there) but loses the arc that makes it hurt.
    const smothered = isInsideHome(band, home) && (spec.family === 'hook' || isKickish(spec.family));
    return {
      available: true,
      logit: RANGE_FIT.wrongBandLogit - comfort,
      forceMult: smothered ? RANGE_FIT.forceSmotherMult : RANGE_FIT.forceEdgeMult,
      bandsOut: 1,
    };
  }
  return { available: false, logit: RANGE_FIT.wrongBandLogit - comfort, forceMult: 0, bandsOut };
}

function isKickish(family: TechniqueFamily): boolean {
  return family === 'lowKick' || family === 'bodyKick' || family === 'headKick' || family === 'teep';
}

function bandIndex(band: RangeBand): number {
  return BAND_ORDER.indexOf(band);
}

/** Smallest number of bands between `band` and any of the technique's home bands. */
function bandDistance(band: RangeBand, home: readonly RangeBand[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const h of home) best = Math.min(best, Math.abs(bandIndex(band) - bandIndex(h)));
  return best;
}

/** True when the fighter is *closer* than every home band (smothering). */
function isInsideHome(band: RangeBand, home: readonly RangeBand[]): boolean {
  return home.every((h) => bandIndex(band) > bandIndex(h));
}

function bandUpperEdge(band: RangeBand, l: BandLimits): number {
  switch (band) {
    case 'clinch': return l.clinchMax;
    case 'close': return l.closeMax;
    case 'mid': return l.midMax;
    case 'long': return l.longMax;
    case 'kick': return l.kickMax;
    default: return Number.POSITIVE_INFINITY;
  }
}

// ---------------------------------------------------------------------------
// §2.1.2 stance bladedness
// ---------------------------------------------------------------------------

export interface BladednessEffects {
  jabLogit: number;
  jabReachM: number;
  rearReachM: number;
  shoulderRollLogit: number;
  /** Passed to 05 as `targetExposure` on the lead leg. */
  leadLegExposureMult: number;
  checkLogit: number;
  /** Owned by 03; quoted here for coherence (§2.1.2). */
  takedownDefenceLogit: number;
  lateralSpeedMult: number;
  /** Opponent's straights against this fighter: a bladed body is a smaller target. */
  opponentStraightLogit: number;
}

export const BLADED = Object.freeze({
  jab: 0.20,
  reach: 0.05,
  shoulderRoll: 0.40,
  legExposure: 0.15,
  check: -0.20,
  takedownDefence: -0.60,
  lateral: 0.15,
  target: -0.10,
  /** `def.shoulder_roll` and `guard.philly` both need at least this. */
  shoulderRollMinB: 0.5,
});

/** §2.1.2 effects of bladedness b. MMA 0.3-0.5, boxers 0.7-0.9, Thai ~0.6. */
export function bladednessEffects(b: number): BladednessEffects {
  const x = clamp01(b);
  return {
    jabLogit: BLADED.jab * x,
    jabReachM: BLADED.reach * x,
    rearReachM: -BLADED.reach * x,
    shoulderRollLogit: BLADED.shoulderRoll * x,
    leadLegExposureMult: 1 + BLADED.legExposure * x,
    checkLogit: BLADED.check * x,
    takedownDefenceLogit: BLADED.takedownDefence * x,
    lateralSpeedMult: 1 - BLADED.lateral * x,
    opponentStraightLogit: BLADED.target * x,
  };
}

// ---------------------------------------------------------------------------
// §2.1.3 angles and the lead-foot battle
// ---------------------------------------------------------------------------

export const ANGLE = Object.freeze({
  thresholdDeg: 30,
  straightPenalty: -0.60,
  hookPenalty: -0.20,
  kickPenalty: -0.30,
  rearHandBonus: 0.30,
  unseenP: 0.35,
  resquareMs: 300,
});

export interface AngleEffects {
  /** True while |angleOff| exceeds the threshold. */
  offAngle: boolean;
  /** Logits on the *off-angled* fighter's own strikes. */
  victimStraightLogit: number;
  victimHookLogit: number;
  victimKickLogit: number;
  /** Logit on the angle-holder's rear hand. */
  holderRearHandLogit: number;
  /** P that the angle-holder's strikes are `unseen` (§2.6.3 placement shift). */
  unseenP: number;
}

/**
 * §2.1.3. `angleOffDeg` is the angle between the defender's facing and the
 * vector defender -> attacker. BOX G27 measured -0.15 p on straights and -0.05 p
 * on hooks after a pivot; converted at p = 0.30 those are -0.60 / -0.20 logit.
 */
export function angleEffects(angleOffDeg: number): AngleEffects {
  const off = Math.abs(angleOffDeg) > ANGLE.thresholdDeg;
  return {
    offAngle: off,
    victimStraightLogit: off ? ANGLE.straightPenalty : 0,
    victimHookLogit: off ? ANGLE.hookPenalty : 0,
    victimKickLogit: off ? ANGLE.kickPenalty : 0,
    holderRearHandLogit: off ? ANGLE.rearHandBonus : 0,
    unseenP: off ? ANGLE.unseenP : 0,
  };
}

export const LEAD_FOOT = Object.freeze({
  thresholdM: 0.10,
  rearStraight: 0.20,
  rearKickOpenSide: 0.20,
  leadHook: 0.10,
  opponentRearStraight: -0.15,
  leadLegKick: 0.26,
  circleWeight: 1.5,
});

/** Same lead hand forward = closed stance; different = open stance (§2.7). */
export function isOpenStance(a: Stance, b: Stance): boolean {
  return a !== b;
}

export interface LeadFootState {
  /** True when A's lead foot is outside B's by >= the threshold. */
  dominant: boolean;
  /** Only meaningful in an open stance (§2.1.3). */
  openStance: boolean;
  aRearStraightLogit: number;
  aRearKickOpenSideLogit: number;
  aLeadHookLogit: number;
  aLeadLegKickLogit: number;
  bRearStraightLogit: number;
}

/**
 * §2.1.3 lead-foot battle. `lateralOffsetM` is A's lead foot minus B's lead
 * foot along the axis perpendicular to the A->B line, signed so that positive
 * means "A's foot is outside B's". Only applies in an open stance — in a closed
 * stance both lead feet fight for the same outside line and neither owns it.
 */
export function leadFootBattle(
  aStance: Stance,
  bStance: Stance,
  lateralOffsetM: number,
  thresholdM: number = LEAD_FOOT.thresholdM,
): LeadFootState {
  const openStance = isOpenStance(aStance, bStance);
  const dominant = openStance && lateralOffsetM >= thresholdM;
  return {
    dominant,
    openStance,
    aRearStraightLogit: dominant ? LEAD_FOOT.rearStraight : 0,
    aRearKickOpenSideLogit: dominant ? LEAD_FOOT.rearKickOpenSide : 0,
    aLeadHookLogit: dominant ? LEAD_FOOT.leadHook : 0,
    aLeadLegKickLogit: dominant ? LEAD_FOOT.leadLegKick : 0,
    bRearStraightLogit: dominant ? LEAD_FOOT.opponentRearStraight : 0,
  };
}

// ---------------------------------------------------------------------------
// §2.7 stance matchup table
// ---------------------------------------------------------------------------

export type StanceRule =
  | 'jab' | 'rearStraight' | 'leadHook' | 'rearBodyKick' | 'rearLowKick'
  | 'leadLegLowKick' | 'shoulderRoll' | 'parryCrossCounter';

/**
 * §2.7. Closed = same stance, open = orthodox vs southpaw. MIS quotes these as
 * selection multipliers (x0.75, x1.4); they are converted once with ln() [D].
 */
export const STANCE_MATCHUP: Readonly<Record<StanceRule, { closed: number; open: number }>> = Object.freeze({
  jab: { closed: 0.18, open: -0.30 },
  rearStraight: { closed: 0, open: 0.34 },
  // The open-stance lead hook needs the dominant angle to get its +0.10.
  leadHook: { closed: 0.10, open: 0.10 },
  rearBodyKick: { closed: -0.10, open: 0.34 },
  rearLowKick: { closed: 0.10, open: 0 },
  leadLegLowKick: { closed: 0, open: 0.26 },
  shoulderRoll: { closed: 0, open: -0.85 },
  parryCrossCounter: { closed: 0, open: 0.34 },
});

export function stanceMatchupLogit(rule: StanceRule, openStance: boolean): number {
  const row = STANCE_MATCHUP[rule];
  return openStance ? row.open : row.closed;
}

/** Which §2.7 row a technique falls under, or null when the table is silent. */
export function stanceRuleFor(spec: TechniqueSpec): StanceRule | null {
  if (spec.skill === 'boxing.jab') return 'jab';
  if (spec.family === 'straight' && spec.limb === 'rearHand') return 'rearStraight';
  if (spec.family === 'hook' && spec.limb === 'leadHand') return 'leadHook';
  if (spec.family === 'bodyKick' && spec.limb === 'rearLeg') return 'rearBodyKick';
  if (spec.family === 'lowKick' && spec.limb === 'rearLeg') return 'rearLowKick';
  if (spec.family === 'lowKick' && spec.limb === 'leadLeg') return 'leadLegLowKick';
  return null;
}

export const STANCE_FAMILIARITY = Object.freeze({
  /** 01 `stanceFamiliarity` = 1 - exp(-bouts/4); below 0.5 is roughly < 3 bouts. */
  threshold: 0.5,
  latencyMult: 1.10,
  counterLogit: -0.15,
  /** Share of lateral moves that step the wrong way (into the rear hand). */
  wrongWayP: 0.15,
  /** Non-switch fighters striking from the unfamiliar stance. */
  nonSwitchLogit: -0.40,
  nonSwitchTelegraphMult: 1.5,
  switchedAccuracyLogit: -0.40,
  switchedTakedownLogit: 0.40,
});

/** 01 §2.4.4: familiarity from the number of bouts faced against that stance. */
export function stanceFamiliarity(boutsVsStance: number): number {
  return 1 - Math.exp(-Math.max(0, boutsVsStance) / 4);
}

export interface FamiliarityPenalty {
  latencyMult: number;
  counterLogit: number;
  wrongWayP: number;
}

/**
 * §2.7 familiarity penalty, scaled by `(1 - familiarity)` per 01
 * `beh.gen.stance_familiarity`. T4+ are immune (07 ST-5).
 */
export function familiarityPenalty(familiarity: number, tier: number): FamiliarityPenalty {
  const f = clamp01(familiarity);
  if (tier >= 4 || f >= STANCE_FAMILIARITY.threshold) {
    return { latencyMult: 1, counterLogit: 0, wrongWayP: 0 };
  }
  const scale = 1 - f;
  return {
    latencyMult: 1 + (STANCE_FAMILIARITY.latencyMult - 1) * scale,
    counterLogit: STANCE_FAMILIARITY.counterLogit * scale,
    wrongWayP: STANCE_FAMILIARITY.wrongWayP * scale,
  };
}

// ---------------------------------------------------------------------------
// §2.8 reach exploitation
// ---------------------------------------------------------------------------

export const REACH = Object.freeze({
  perTenCmLogit: 0.12,
  capCm: 20,
  closePenaltyPerTenCm: -0.05,
  /** Selection-weight threshold used by 07 (MIS R-1). */
  weightThresholdCm: 5,
});

export type WeightClassScale = 'light' | 'middle' | 'heavy';

/** FLW-LW 0.7, WW-MW 1.0, LHW-HW 1.5 — reach only bites at heavyweight (LB §2.4). */
export const REACH_CLASS_SCALE: Readonly<Record<WeightClassScale, number>> = Object.freeze({
  light: 0.7, middle: 1.0, heavy: 1.5,
});

/**
 * §2.8(b). The whole accuracy content of reach: +0.12 logit per 10 cm, on
 * straights / teeps / round kicks, at `range.long` and `range.kick` only.
 * Hooks get nothing; at `range.close` the longer fighter is cramped instead.
 */
export function reachAccuracyLogit(
  reachAdvCm: number,
  band: RangeBand,
  family: TechniqueFamily,
  classScale: WeightClassScale = 'middle',
): number {
  const adv = clamp(reachAdvCm, -REACH.capCm, REACH.capCm);
  if (band === 'close' || band === 'clinch') {
    return family === 'straight' ? REACH.closePenaltyPerTenCm * (adv / 10) : 0;
  }
  if (band !== 'long' && band !== 'kick') return 0;
  const eligible = family === 'straight' || family === 'teep'
    || family === 'lowKick' || family === 'bodyKick' || family === 'headKick';
  if (!eligible) return 0;
  return REACH.perTenCmLogit * (adv / 10) * REACH_CLASS_SCALE[classScale];
}

// ---------------------------------------------------------------------------
// §2.1.4 cage zones and the cut-off state
// ---------------------------------------------------------------------------

export type CageZone = 'cage.centre' | 'cage.near' | 'cage.fence';

export const CAGE = Object.freeze({
  centreMinM: 2.0,
  fenceMaxM: 0.8,
  fenceEvasionLogit: -0.40,
  fenceStepOffLogit: -1.0,
  fenceComboCapBonus: 1,
  fenceBodyWeightMult: 1.4,
  fenceClinchWeightMult: 1.3,
});

export function cageZone(cageDistM: number): CageZone {
  if (cageDistM >= CAGE.centreMinM) return 'cage.centre';
  if (cageDistM < CAGE.fenceMaxM) return 'cage.fence';
  return 'cage.near';
}

export interface CageEffects {
  zone: CageZone;
  /** `def.pull` and `def.step_back` are unavailable on the fence. */
  pullAvailable: boolean;
  stepBackAvailable: boolean;
  /** Logit on every evasive defence of the fighter in the zone. */
  evasionLogit: number;
  stepOffLogit: number;
  /** Opponent's combination cap, body-shot and clinch-entry weights. */
  opponentComboCapBonus: number;
  opponentBodyWeightMult: number;
  opponentClinchWeightMult: number;
}

export function cageEffects(cageDistM: number): CageEffects {
  const zone = cageZone(cageDistM);
  const pinned = zone === 'cage.fence';
  return {
    zone,
    pullAvailable: !pinned,
    stepBackAvailable: !pinned,
    evasionLogit: pinned ? CAGE.fenceEvasionLogit : 0,
    stepOffLogit: pinned ? CAGE.fenceStepOffLogit : 0,
    opponentComboCapBonus: pinned ? CAGE.fenceComboCapBonus : 0,
    opponentBodyWeightMult: pinned ? CAGE.fenceBodyWeightMult : 1,
    opponentClinchWeightMult: pinned ? CAGE.fenceClinchWeightMult : 1,
  };
}

export const CUTOFF = Object.freeze({
  mirrorAngleDeg: 30,
  armSeconds: 0.5,
  failNear: 0.30,
  failFence: 0.60,
  /** `striking.cageCraft >= 30`, i.e. T2+. */
  minCageCraft: 30,
  smallCageMult: 1.15,
});

export interface CutoffInput {
  /** Seconds the pressure fighter has mirrored the mover's lateral velocity. */
  mirroredSeconds: number;
  /** Angle between the mover's escape vector and mover -> pressurer, degrees. */
  escapeAngleDeg: number;
  /** The mover's distance to the fence. */
  moverCageDistM: number;
  /** Pressure fighter's `striking.cageCraft`. */
  cageCraft: number;
  /** True when the pressure fighter is walking forward in a straight line. */
  straightLineChase: boolean;
  /** 25-ft cages make cutting off easier (MIS §10.21). */
  smallCage?: boolean;
}

export interface CutoffState {
  /** `state.cutoff` is armed. */
  armed: boolean;
  /** Mirroring accuracy 0.5 + 0.005 x cageCraft, capped at 1. */
  accuracy: number;
  /**
   * P that the mover's `def.step_back` / `def.step_off` fails outright, BEFORE
   * the normal roll (§2.1.4). Straight-line chasing never arms the state and
   * hands the mover the pivot and check-hook counters instead.
   */
  escapeFailP: number;
}

export function cutoffState(input: CutoffInput): CutoffState {
  const accuracy = Math.min(1, 0.5 + 0.005 * Math.max(0, input.cageCraft));
  const eligible = input.cageCraft >= CUTOFF.minCageCraft
    && !input.straightLineChase
    && input.mirroredSeconds >= CUTOFF.armSeconds
    && Math.abs(input.escapeAngleDeg) < CUTOFF.mirrorAngleDeg
    && input.moverCageDistM < CAGE.centreMinM;
  if (!eligible) return { armed: false, accuracy, escapeFailP: 0 };
  // BOX G28's 0.30 / 0.60 are the fail rates once the state is armed; the
  // pressure fighter's cageCraft enters through `accuracy` (07 rolls it per
  // tick to decide whether the mirror held), not a second time here.
  const base = input.moverCageDistM < CAGE.fenceMaxM ? CUTOFF.failFence : CUTOFF.failNear;
  const mult = input.smallCage ? CUTOFF.smallCageMult : 1;
  return { armed: true, accuracy, escapeFailP: Math.min(1, base * mult) };
}

// ---------------------------------------------------------------------------
// §2.1.5 movement primitives
// ---------------------------------------------------------------------------

export interface MovementSpec {
  id: string;
  ms: number;
  /** Displacement range, metres; [0,0] for in-place moves. */
  displacementM: readonly [number, number];
  minTier: number;
  note: string;
  tag: string;
}

/** §2.1.5. Striking reads these for timing; 07 chooses between them. */
export const MOVEMENTS: readonly MovementSpec[] = [
  {
    id: 'move.step_drag', ms: 200, displacementM: [0.30, 0.45], minTier: 0,
    note: 'Feet never cross; guard intact.', tag: '[S: BOX §4 150-250 ms; distance E]',
  },
  {
    id: 'move.step_in_strike', ms: 0, displacementM: [0.30, 0.50], minTier: 0,
    note: 'Folded into the `stepIn` techniques; balance briefly one-legged.', tag: '[S: BOX §2 #2]',
  },
  {
    id: 'move.pivot', ms: 300, displacementM: [0, 0], minTier: 1,
    note: '45-90 deg on the lead foot; sets angleOff; basis of the check hook.',
    tag: '[S: BOX §4 250-350 ms]',
  },
  {
    id: 'move.l_step', ms: 400, displacementM: [0.30, 0.50], minTier: 3,
    note: 'Lateral lead step plus rear step to 45 deg.', tag: '[S: BOX §4 350-450 ms]',
  },
  {
    id: 'move.shuffle', ms: 200, displacementM: [0.20, 0.35], minTier: 0,
    note: 'Lateral circling, per step.', tag: '[S: BOX §4]',
  },
  {
    id: 'move.level_change', ms: 200, displacementM: [0, 0], minTier: 1,
    note: 'Head drops 0.25-0.35 m; exposes to uppercut and knee; telegraph 120 ms.', tag: '[E]',
  },
  {
    id: 'move.shift', ms: 250, displacementM: [0.30, 0.50], minTier: 3,
    note: 'Step-through, temporary stance switch: power x1.15, defence -0.50 logit for 400 ms.',
    tag: '[S: BOX §4 "Shift"; magnitudes E]',
  },
  {
    id: 'move.switch_stance', ms: 300, displacementM: [0, 0], minTier: 1,
    note: '1 % stamina; reads suppressed; TD vulnerability +0.60 logit; low kick x1.3 on the switching leg.',
    tag: '[S: MIS ST-8]',
  },
  {
    id: 'move.retreat_straight', ms: 200, displacementM: [0.25, 0.40], minTier: 0,
    note: 'Novice default; loses cage distance fastest.', tag: '[E]',
  },
];

/** Novice error: crossing the feet on a lateral step (§2.1.5). */
export const FEET_CROSS_P: readonly number[] = [0.25, 0.10, 0.02, 0, 0, 0];
export const FEET_CROSS_MS = 300;

// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}
