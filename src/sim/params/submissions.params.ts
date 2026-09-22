/**
 * Parameters owned by design chapter: docs/design/04_SUBMISSIONS.md §7.
 *
 * The values are imported from the submissions module rather than re-typed, so
 * there is exactly one copy of every number in the codebase: the module is the
 * implementation, this file is its provenance, bounds and calibration metadata.
 *
 * Per-technique stage probabilities, durations, finish clocks and escape shares
 * are *not* listed here - they live in `submissions/catalogue.ts` (~700 values,
 * one per §3 entry) and the chain edge probabilities live in
 * `submissions/chains.ts`, exactly as §7 prescribes. This registry carries the
 * cross-cutting tunables: the stage machine, the 24 logit modifiers, the finish
 * clock, slams, tier behaviour and the attempt decision.
 */
import type { ParamSpec } from './registry';
import {
  BEHAVIOUR_PARAMS, MODIFIER_PARAMS, PATIENCE_BY_TIER, STAGE_PARAMS, TIER_DEF_SHIFT,
  ATTACKER_ENERGY_PER_S, ATTACKER_GRIP_ENERGY_ADD, ENERGY_PER_S, DECISION_LATENCY_S,
} from '../submissions/stages';
import {
  FINISH_PARAMS, LOC_MEAN_S, SLAM_PARAMS, MUTUAL_STRIKE_ABANDON_P, STRIKE_LANDED_RATE,
  STRIKE_DMG_MULT,
} from '../submissions/finish';
import { CHAIN_PARAMS } from '../submissions/chains';
import { ILLEGAL_ATTEMPT_P_T01 } from '../submissions/legality';

const S = 'submissions' as const;

export const SUBMISSION_PARAMS: ParamSpec[] = [
  // ---- §2.2-§2.4 the stage machine ---------------------------------------
  {
    id: 'sub.window.setupMs', value: STAGE_PARAMS.windowMs.setup, unit: 'ms', section: S,
    free: false, tag: '[S: 00_CONVENTIONS §2]', min: 100, max: 100,
    note: 'Availability (S0) is re-checked every tick.',
  },
  {
    id: 'sub.window.entryMs', value: STAGE_PARAMS.windowMs.entry, unit: 'ms', section: S,
    free: true, min: 200, max: 1000, tag: '[E: 04 §2.2]',
    note: 'Contested-roll window at S1. Shorter than the later stages: entries are explosive.',
  },
  {
    id: 'sub.window.secureMs', value: STAGE_PARAMS.windowMs.secure, unit: 'ms', section: S,
    free: true, min: 500, max: 2000, tag: '[E: 04 §2.2]',
    note: 'Contested-roll window at S2.',
  },
  {
    id: 'sub.window.finishMs', value: STAGE_PARAMS.windowMs.finish, unit: 'ms', section: S,
    free: true, min: 500, max: 2000, tag: '[E: 04 §2.2]',
    note: 'Contested-roll window at S3.',
  },
  {
    id: 'sub.window.lockedMs', value: STAGE_PARAMS.windowMs.locked, unit: 'ms', section: S,
    free: false, min: 1000, max: 1000, tag: '[E: 04 §2.2]',
    note: 'The locked clock runs per second; the per-second hazards are quoted in those units.',
  },
  {
    id: 'sub.dMaxFactor', value: STAGE_PARAMS.dMaxFactor, unit: 'ratio', section: S,
    free: true, min: 1.5, max: 5, tag: '[E: 04 §2.2]',
    note: 'dMax = this x dMean; reaching it starts the abandon rolls. The cinematic preset uses 2.0.',
  },
  {
    id: 'sub.windowRescaleCap', value: STAGE_PARAMS.windowRescaleCap, unit: 'probability', section: S,
    free: true, min: 0.5, max: 0.95, tag: '[E: 04 §2.3]',
    note: 'If p_a0 + p_e0 exceeds this on a short stage, both are scaled down together.',
  },
  {
    id: 'sub.pClampMin', value: STAGE_PARAMS.pClampMin, unit: 'probability', section: S,
    free: false, min: 0, max: 0.1, tag: '[S: SUBMISSIONS §5 preamble]',
    note: 'Nothing is ever impossible.',
  },
  {
    id: 'sub.pClampMax', value: STAGE_PARAMS.pClampMax, unit: 'probability', section: S,
    free: false, min: 0.9, max: 1, tag: '[S: SUBMISSIONS §5 preamble]',
    note: 'Nothing is ever certain.',
  },
  {
    id: 'sub.triggerWindowMs', value: STAGE_PARAMS.triggerWindowMs, unit: 'ms', section: S,
    free: true, min: 1000, max: 6000, tag: '[E: 04 §2.4.1]',
    note: 'How long a listed trigger event keeps an entry available.',
  },

  // ---- §2.3 M_SKILL ------------------------------------------------------
  {
    id: 'sub.kSkill.entry', value: MODIFIER_PARAMS.kSkillEntry, unit: 'logit', section: S,
    free: true, min: 0.5, max: 4,
    tag: '[D: SUBMISSIONS §5 rule 5 x(1+0.02 dSkill) converted at p~0.45; reproduces the 2.2-2.6x early-UFC rate ratio over three stages]',
    note: 'Per 100 points of family-skill advantage, at S1.',
  },
  {
    id: 'sub.kSkill.secure', value: MODIFIER_PARAMS.kSkillSecure, unit: 'logit', section: S,
    free: true, min: 0.5, max: 4, tag: '[D: as sub.kSkill.entry]',
    note: 'Per 100 points, at S2 - the least observable stage, and the main C5 knob.',
  },
  {
    id: 'sub.kSkill.finish', value: MODIFIER_PARAMS.kSkillFinish, unit: 'logit', section: S,
    free: true, min: 0.25, max: 2, tag: '[D: rule 5 halves the skill term at S3]',
    note: 'Per 100 points, at S3. Once the lock is on, skill matters half as much.',
  },
  {
    id: 'sub.kSkill.locked', value: MODIFIER_PARAMS.kSkillLocked, unit: 'logit', section: S,
    free: true, min: 0.25, max: 2, tag: '[D: rule 5]',
    note: 'Per 100 points, on the locked-clock escape hazard.',
  },

  // ---- §2.3 positional and setup terms -----------------------------------
  {
    id: 'sub.kCtrl', value: MODIFIER_PARAMS.kCtrl, unit: 'logit', section: S,
    free: true, min: 0, max: 0.4, tag: '[E: 04 §2.3]',
    note: 'Per §03 control point away from the neutral 5, at S1 and S2.',
  },
  {
    id: 'sub.kSetupStrike', value: MODIFIER_PARAMS.kSetupStrike, unit: 'logit', section: S,
    free: true, min: 0, max: 0.6, tag: '[S: BJJ_POS §3.3 STK]',
    note: 'Per strike landed in the last 5 s. GnP is the primary creator of arm-triangle entries.',
  },
  {
    id: 'sub.setupStrikeCap', value: MODIFIER_PARAMS.setupStrikeCap, unit: 'count', section: S,
    free: true, min: 1, max: 6, tag: '[S: BJJ_POS §3.3 STK]',
    note: 'Strikes counted by M_SETUP.',
  },
  {
    id: 'sub.chainBonus', value: MODIFIER_PARAMS.chainBonus, unit: 'logit', section: S,
    free: true, min: 0, max: 0.5, tag: '[D: rule 22 x1.2 on p~0.45 -> 0.54]',
    note: 'M_CHAIN: the grip is already half there when an attack is entered off a chain edge.',
  },
  {
    id: 'sub.chain.hopCap', value: CHAIN_PARAMS.hopCap, unit: 'count', section: S,
    free: true, min: 1, max: 6, tag: '[S: SUBMISSIONS §5 rule 22]',
    note: 'Loop guard: hops allowed inside one chain window.',
  },
  {
    id: 'sub.chain.hopWindowMs', value: CHAIN_PARAMS.hopWindowMs, unit: 'ms', section: S,
    free: true, min: 5000, max: 30000, tag: '[S: rule 22]',
    note: 'Loop guard window.',
  },
  {
    id: 'sub.chain.tierMult.t0', value: CHAIN_PARAMS.tierMult[0], unit: 'ratio', section: S,
    free: true, min: 0, max: 1, tag: '[E: BJJ_POS §3.3 "chaining: elite only"]',
    note: 'T0 never chains.',
  },
  {
    id: 'sub.chain.tierMult.t1', value: CHAIN_PARAMS.tierMult[1], unit: 'ratio', section: S,
    free: true, min: 0, max: 1, tag: '[E: as above]', note: 'T1 never chains.',
  },
  {
    id: 'sub.chain.tierMult.t2', value: CHAIN_PARAMS.tierMult[2], unit: 'ratio', section: S,
    free: true, min: 0, max: 1.5, tag: '[E: as above]', note: 'T2: the first chains appear.',
  },
  {
    id: 'sub.chain.tierMult.t3', value: CHAIN_PARAMS.tierMult[3], unit: 'ratio', section: S,
    free: true, min: 0, max: 1.5, tag: '[E: as above]', note: 'T3.',
  },
  {
    id: 'sub.chain.tierMult.t4', value: CHAIN_PARAMS.tierMult[4], unit: 'ratio', section: S,
    free: false, min: 1, max: 1, tag: '[E: as above]', note: 'T4 is the base the edge P values are quoted at.',
  },
  {
    id: 'sub.chain.tierMult.t5', value: CHAIN_PARAMS.tierMult[5], unit: 'ratio', section: S,
    free: true, min: 0.5, max: 2, tag: '[E: as above]', note: 'T5 chains more than the base.',
  },

  // ---- §2.3 physical terms ----------------------------------------------
  {
    id: 'sub.kStrFin', value: MODIFIER_PARAMS.kStrFin, unit: 'logit', section: S,
    free: true, min: 0, max: 0.5,
    tag: '[D: rule 13 x(1+0.008 dSTR): dSTR 50 -> x1.4 on p~0.5 -> +0.85 logit -> 0.17 per 10 points]',
    note: 'M_STR_FIN, per 10 points of strength advantage, on squeeze and rotation finishes.',
  },
  {
    id: 'sub.kStrDef', value: MODIFIER_PARAMS.kStrDef, unit: 'logit', section: S,
    free: true, min: 0, max: 0.5, tag: '[D: rule 13]',
    note: 'M_STR_DEF, per 10 points, on grip-break / stack / slam / leg-clear options.',
  },
  {
    id: 'sub.kMass', value: MODIFIER_PARAMS.kMass, unit: 'logit', section: S,
    free: true, min: 0, max: 0.3, tag: '[S: BJJ_POS §3.3 MASS]',
    note: 'M_MASS, per 5 kg, on pressure chokes.',
  },
  {
    id: 'sub.massCap', value: MODIFIER_PARAMS.massCap, unit: 'logit', section: S,
    free: true, min: 0.2, max: 1.5, tag: '[S: BJJ_POS §3.3]',
    note: 'Cap on M_MASS in either direction.',
  },
  {
    id: 'sub.kNeck', value: MODIFIER_PARAMS.kNeck, unit: 'logit', section: S,
    free: true, min: -3, max: 0, tag: '[E: 04 §2.3]',
    note: 'M_NECK, per unit of (neck/100 - 0.5): a thick neck resists every neck choke.',
  },
  {
    id: 'sub.kNeckTLocS', value: MODIFIER_PARAMS.kNeckTLocS, unit: 's', section: S,
    free: true, min: 0, max: 2, tag: '[E: 04 §2.6.1]',
    note: 'Seconds added to the time to unconsciousness at neck 100.',
  },
  {
    id: 'sub.kNeckGirth', value: MODIFIER_PARAMS.kNeckGirth, unit: 'logit', section: S,
    free: true, min: -1, max: 0, tag: '[D: rule 17 "HW guillotine/N-S S3 x0.85" ~ -0.3 logit at +15 kg]',
    note: 'Per 10 kg of defender mass above the class mean, guillotine family and north-south.',
  },
  {
    id: 'sub.kLenLeg', value: MODIFIER_PARAMS.kLenLeg, unit: 'logit', section: S,
    free: true, min: 0, max: 0.6, tag: '[D: rule 15 x(1+0.01 LEN) ~ +0.2-0.4 logit per 10 cm at p 0.45-0.55]',
    note: 'M_LEN_LEG, per 10 cm of attacker leg reach above the class mean.',
  },
  {
    id: 'sub.kLenLegMass', value: MODIFIER_PARAMS.kLenLegMass, unit: 'logit', section: S,
    free: true, min: -0.6, max: 0, tag: '[D: rule 15, torso girth proxy]',
    note: 'Per 10 kg of defender mass above the class mean, triangles and omoplata.',
  },
  {
    id: 'sub.kLenArm', value: MODIFIER_PARAMS.kLenArm, unit: 'logit', section: S,
    free: true, min: 0, max: 0.6, tag: '[D: rule 15]',
    note: "M_LEN_ARM, per 10 cm of attacker reach. Long arms finish D'Arces; short arms fail at S2.",
  },
  {
    id: 'sub.kLenArmMass', value: MODIFIER_PARAMS.kLenArmMass, unit: 'logit', section: S,
    free: true, min: -0.6, max: 0, tag: '[D: rule 15]',
    note: 'Per 10 kg of defender mass above the class mean, arm-in chokes.',
  },
  {
    id: 'sub.kFlxAttTri', value: MODIFIER_PARAMS.kFlxAttTri, unit: 'logit', section: S,
    free: true, min: 0, max: 0.3, tag: '[D: rule 14 x(0.8+0.4 FLX/100) -> +-0.4 logit over 0-100]',
    note: 'M_FLX_ATT, per 10 points above 50, on triangles.',
  },
  {
    id: 'sub.kFlxAttOmo', value: MODIFIER_PARAMS.kFlxAttOmo, unit: 'logit', section: S,
    free: true, min: 0, max: 0.4, tag: '[D: rule 14 x(0.7+0.6 FLX/100)]',
    note: 'The omoplata / gogoplata / rubber-guard slope; the catalogue carries it as weight 1.5.',
  },
  {
    id: 'sub.flxGate.gogoplata', value: 80, unit: '0-100', section: S,
    free: false, min: 0, max: 100, tag: '[S: SUBMISSIONS §5 rule 14]',
    note: 'Flexibility below this cannot put a shin on a throat.',
  },
  {
    id: 'sub.flxGate.rubberGuard', value: 70, unit: '0-100', section: S,
    free: false, min: 0, max: 100, tag: '[S: rule 14]',
    note: 'Flexibility gate on rubber-guard entries.',
  },
  {
    id: 'sub.flxGate.buggy', value: 70, unit: '0-100', section: S,
    free: true, min: 0, max: 100, tag: '[E: 04 §3.4]',
    note: 'Flexibility gate on the buggy choke.',
  },
  {
    id: 'sub.kFlxDef', value: MODIFIER_PARAMS.kFlxDef, unit: 'logit', section: S,
    free: true, min: 0, max: 0.3, tag: '[D: rule 14 x(1+0.5 FLX/100) -> +0.1 per 10]',
    note: 'M_FLX_DEF, per 10 points above 50, on kimura / americana / omoplata escapes.',
  },
  {
    id: 'sub.kFlxDefInjuryDelayS', value: MODIFIER_PARAMS.kFlxDefInjuryDelayS, unit: 's', section: S,
    free: true, min: 0, max: 0.1, tag: '[D: rule 14 "+1 s" at FLX 100 -> 0.02 s per point]',
    note: 'Seconds added to the joint-lock injury delay per flexibility point above 50.',
  },

  // ---- §2.3 SLIP ---------------------------------------------------------
  {
    id: 'sub.slip.base', value: MODIFIER_PARAMS.slipBase, unit: '0-1', section: S,
    free: true, min: 0, max: 0.5, tag: '[D: rule 10 gives R1 0.2 / R2 0.5 / R3+ 0.8]',
    note: 'SLIP at the opening bell.',
  },
  {
    id: 'sub.slip.perSecond', value: MODIFIER_PARAMS.slipPerSecond, unit: '0-1', section: S,
    free: true, min: 0, max: 0.005, tag: '[D: rule 10, linear fit 0.2 + t/1000]',
    note: 'SLIP accrued per second of fight time.',
  },
  {
    id: 'sub.slip.timeCap', value: MODIFIER_PARAMS.slipTimeCap, unit: '0-1', section: S,
    free: true, min: 0.5, max: 1, tag: '[D: rule 10]', note: 'Cap on the time-driven part of SLIP.',
  },
  {
    id: 'sub.slip.bloodAdd', value: MODIFIER_PARAMS.slipBloodAdd, unit: '0-1', section: S,
    free: true, min: 0, max: 0.3, tag: '[D: rule 10]', note: 'Added once a fighter is bleeding.',
  },
  {
    id: 'sub.slip.heavyClassAdd', value: MODIFIER_PARAMS.slipHeavyClassAdd, unit: '0-1', section: S,
    free: true, min: 0, max: 0.3, tag: '[D: rule 17]', note: 'Added at LHW and above.',
  },
  {
    id: 'sub.slip.totalCap', value: MODIFIER_PARAMS.slipTotalCap, unit: '0-1', section: S,
    free: false, min: 1, max: 1, tag: '[D: rule 10]', note: 'Absolute cap on SLIP.',
  },
  {
    id: 'sub.kSlipHigh', value: MODIFIER_PARAMS.kSlipHigh, unit: 'logit', section: S,
    free: true, min: -1.5, max: 0, tag: '[D: rule 10 x(1-0.30 SLIP) at SLIP 0.8 on p~0.5 -> -0.49 logit]',
    note: 'Per unit of SLIP, for grip-on-skin attacks (guillotine, north-south, kimura wrist grip).',
  },
  {
    id: 'sub.kSlipLow', value: MODIFIER_PARAMS.kSlipLow, unit: 'logit', section: S,
    free: true, min: -0.8, max: 0, tag: '[D: rule 10 x(1-0.10 SLIP)]',
    note: 'Per unit of SLIP, for limb-on-limb attacks (RNC, triangles, armbars).',
  },

  // ---- §2.3 fatigue, damage, equipment -----------------------------------
  {
    id: 'sub.kFatAttGrip', value: MODIFIER_PARAMS.kFatAttGrip, unit: 'logit', section: S,
    free: true, min: -2, max: 0, tag: '[D: rule 11 x(1-0.4 FAT) at FAT 1 on p 0.5 -> -0.85 logit]',
    note: 'Per unit of attacker fatigue, on grip-heavy attacks. The forearms go first.',
  },
  {
    id: 'sub.kFatAtt', value: MODIFIER_PARAMS.kFatAtt, unit: 'logit', section: S,
    free: true, min: -1, max: 0, tag: '[D: rule 11 x(1-0.15 FAT)]',
    note: 'Per unit of attacker fatigue, on everything else.',
  },
  {
    id: 'sub.kFatDefAtt', value: MODIFIER_PARAMS.kFatDefAtt, unit: 'logit', section: S,
    free: true, min: 0, max: 1.5, tag: '[D: rule 11, keeps P_stage consistent with the multiplicative rule]',
    note: 'Per unit of defender fatigue, added to the attacker at S1-S2.',
  },
  {
    id: 'sub.kFatDefEsc', value: MODIFIER_PARAMS.kFatDefEsc, unit: 'logit', section: S,
    free: true, min: -2, max: 0, tag: '[D: rule 11 defender defence x(1-0.5 FAT)]',
    note: 'Per unit of defender fatigue, on their own escape roll. Tired fighters give the back.',
  },
  {
    id: 'sub.kRocked', value: MODIFIER_PARAMS.kRocked, unit: 'logit', section: S,
    free: true, min: 0, max: 2, tag: '[D: rule 12 x1.6 on p 0.45 -> 0.72]',
    note: 'M_ROCKED on the attacker, every stage.',
  },
  {
    id: 'sub.kRockedDef', value: MODIFIER_PARAMS.kRockedDef, unit: 'logit', section: S,
    free: true, min: -2, max: 0, tag: '[D: rule 12 "defends a tier lower"]',
    note: 'M_ROCKED on the defender escape roll; their option set is restricted as well.',
  },
  {
    id: 'sub.kStructuralHead', value: MODIFIER_PARAMS.kStructuralHead, unit: 'logit', section: S,
    free: true, min: 0, max: 0.02, tag: '[E: 04 §2.3]',
    note: 'Per point of accumulated head damage, added to the attacker.',
  },
  {
    id: 'sub.structuralHeadCap', value: MODIFIER_PARAMS.structuralHeadCap, unit: 'logit', section: S,
    free: true, min: 0, max: 1.5, tag: '[E: 04 §2.3]', note: 'Cap on the structural-head term.',
  },
  {
    id: 'sub.gloves.rncShortShare', value: MODIFIER_PARAMS.glovesRncShortShare, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: SUBMISSIONS §5 rule 16]',
    note: 'Share of RNCs finished as the palm-to-palm short choke under 4 oz gloves.',
  },
  {
    id: 'sub.gloves.gripPenalty', value: MODIFIER_PARAMS.glovesGripPenalty, unit: 'logit', section: S,
    free: true, min: -0.5, max: 0, tag: '[D: rule 16 x0.9]',
    note: 'Gloves on grip-dependent finishes (kimura, toe hold, heel grip).',
  },
  {
    id: 'sub.gloves.defHandFightPenalty', value: MODIFIER_PARAMS.glovesDefHandFightPenalty, unit: 'logit', section: S,
    free: true, min: -0.5, max: 0, tag: '[E: 04 §2.3]',
    note: "Gloves on the defender's hand-fighting options - you cannot peel with a padded hand.",
  },
  {
    id: 'sub.gloves.ezekielBonus', value: MODIFIER_PARAMS.glovesEzekielBonus, unit: 'logit', section: S,
    free: true, min: 0, max: 0.6, tag: '[S: SUBMISSIONS §2.16 "MMA gloves help"; magnitude E]',
    note: 'The one technique gloves help: the glove edge replaces the gi sleeve.',
  },
  {
    id: 'sub.class.lightTriArmbar', value: MODIFIER_PARAMS.classLightTriArmbar, unit: 'logit', section: S,
    free: true, min: 0, max: 0.4, tag: '[D: rule 17 x1.1]',
    note: 'FLW/BW triangle and armbar entries.',
  },
  {
    id: 'sub.class.womenAttemptMult', value: MODIFIER_PARAMS.classWomenAttemptMult, unit: 'ratio', section: S,
    free: false, min: 1, max: 1.5, tag: '[S: rule 17]',
    note: "Attempt-rate multiplier in women's divisions.",
  },
  {
    id: 'sub.kCageTop', value: MODIFIER_PARAMS.kCageTop, unit: 'logit', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.3]',
    note: "Defender's shoulders on the fence: the top attacker gets S2 for free, there is no hip escape.",
  },
  {
    id: 'sub.kCageBottom', value: MODIFIER_PARAMS.kCageBottom, unit: 'logit', section: S,
    free: true, min: -1, max: 0, tag: '[E: 04 §2.3]',
    note: 'A guard player against the fence cannot cut the angle.',
  },
  {
    id: 'sub.kWrongDef', value: MODIFIER_PARAMS.kWrongDef, unit: 'logit', section: S,
    free: true, min: 0, max: 2,
    tag: '[E, anchored on SUBMISSIONS §4 Untrained "0.10x base" / Novice "0.4x at S1"]',
    note: 'M_WRONG_DEF: def.none, or the right defence at the wrong stage.',
  },

  // ---- §2.4.4 stall and abandon ------------------------------------------
  {
    id: 'sub.abandon.base', value: BEHAVIOUR_PARAMS.abandonBase, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.4.4]',
    note: 'P(abandon) per window once the stage clock passes dMax, before patience.',
  },
  {
    id: 'sub.abandon.patienceSlope', value: BEHAVIOUR_PARAMS.abandonPatienceSlope, unit: 'probability', section: S,
    free: true, min: 0, max: 0.35, tag: '[E: 04 §2.4.4]',
    note: 'How much patience removes from the abandon probability.',
  },
  {
    id: 'sub.abandon.subHunterMult', value: BEHAVIOUR_PARAMS.abandonSubHunterMult, unit: 'ratio', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.4.4]', note: 'A sub-hunter holds on twice as long.',
  },
  {
    id: 'sub.patience.t2', value: PATIENCE_BY_TIER[2], unit: '0-1', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §6.1]', note: 'T0-T1 never abandon voluntarily.',
  },
  {
    id: 'sub.patience.t3', value: PATIENCE_BY_TIER[3], unit: '0-1', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §6.1]', note: 'Regional-pro patience.',
  },
  {
    id: 'sub.patience.t4', value: PATIENCE_BY_TIER[4], unit: '0-1', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §6.1]', note: 'UFC-level patience.',
  },
  {
    id: 'sub.patience.t5', value: PATIENCE_BY_TIER[5], unit: '0-1', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §6.1]',
    note: 'A champion also abandons early to keep position when p_a stays under 0.15.',
  },
  {
    id: 'sub.bellSaveTarget', value: BEHAVIOUR_PARAMS.bellSaveTarget, unit: 'probability', section: S,
    free: false, min: 0, max: 0.2, tag: '[S: SUBMISSIONS §5 rule 9]',
    note: 'Calibration target C17: share of locked submissions saved by the bell. Emergent, not set.',
  },

  // ---- §2.6.1 chokes -----------------------------------------------------
  {
    id: 'sub.loc.meanPooledS', value: FINISH_PARAMS.locMeanPooledS, unit: 's', section: S,
    free: false, min: 5, max: 15, tag: '[S: SUB_PHYS §1 / P4 pooled mean 9.0 s, CI 8.3-9.9]',
    note: 'Time to unconsciousness where no per-technique measurement exists.',
  },
  {
    id: 'sub.loc.meanArmTriangleS', value: LOC_MEAN_S['sub.arm_triangle_mount'], unit: 's', section: S,
    free: false, min: 5, max: 15, tag: '[S: P4 / W5]', note: 'The fastest common choke.',
  },
  {
    id: 'sub.loc.meanRncS', value: LOC_MEAN_S['sub.rnc'], unit: 's', section: S,
    free: false, min: 5, max: 15, tag: '[S: P4]', note: 'Rear-naked choke.',
  },
  {
    id: 'sub.loc.meanGuillotineS', value: LOC_MEAN_S['sub.guillotine_standard'], unit: 's', section: S,
    free: false, min: 5, max: 15, tag: '[S: P4]', note: 'Standard guillotine, when functional.',
  },
  {
    id: 'sub.loc.meanNorthSouthS', value: LOC_MEAN_S['sub.north_south_choke'], unit: 's', section: S,
    free: false, min: 5, max: 15, tag: '[S: P4 / W8]', note: 'North-south choke.',
  },
  {
    id: 'sub.loc.meanTriangleS', value: LOC_MEAN_S['sub.triangle_guard'], unit: 's', section: S,
    free: false, min: 5, max: 15, tag: '[S: P4 / W6]', note: 'Triangle family.',
  },
  {
    id: 'sub.loc.meanArmInGuillotineS', value: LOC_MEAN_S['sub.guillotine_arm_in'], unit: 's', section: S,
    free: false, min: 5, max: 15, tag: '[S: P4 / W4]', note: 'Arm-in guillotine, the slowest measured.',
  },
  {
    id: 'sub.loc.sdS', value: FINISH_PARAMS.locSdS, unit: 's', section: S,
    free: true, min: 0.5, max: 4, tag: '[S: SUBMISSIONS §5 rule 7]',
    note: 'Standard deviation of the time to unconsciousness.',
  },
  {
    id: 'sub.loc.clampMinS', value: FINISH_PARAMS.locClampMinS, unit: 's', section: S,
    free: false, min: 3, max: 8, tag: '[S: rule 7]', note: 'Nobody goes out faster than this.',
  },
  {
    id: 'sub.loc.clampMaxS', value: FINISH_PARAMS.locClampMaxS, unit: 's', section: S,
    free: false, min: 10, max: 20, tag: '[S: rule 7]', note: 'Nobody holds out longer than this.',
  },
  {
    id: 'sub.enduranceFatigueAdd', value: FINISH_PARAMS.enduranceFatigueAdd, unit: '0-1', section: S,
    free: true, min: 0, max: 0.3, tag: '[E: 04 §2.6.1]',
    note: "Fatigue the attacker eats when a mixed choke never closes and the arms give out.",
  },
  {
    id: 'sub.hTapAir', value: FINISH_PARAMS.hTapAirT4, unit: 'probability', section: S,
    free: true, min: 0, max: 0.4, tag: '[E: 04 §2.6.1]',
    note: 'Per-second pain / air-hunger tap hazard on a non-functional mixed choke, T4.',
  },
  {
    id: 'sub.hTapAir.lowTierMult', value: FINISH_PARAMS.hTapAirLowTierMult, unit: 'ratio', section: S,
    free: true, min: 1, max: 4, tag: '[E: 04 §2.6.1]', note: 'T<=2 tap to air chokes twice as readily.',
  },
  {
    id: 'sub.hTapAir.t5Mult', value: FINISH_PARAMS.hTapAirT5Mult, unit: 'ratio', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.1]', note: 'T5 endures partial chokes to the bell.',
  },

  // ---- §2.6.2 / §2.6.5 the tap decision ----------------------------------
  {
    id: 'sub.pGoOut.t0', value: FINISH_PARAMS.pGoOutTier[0], unit: 'probability', section: S,
    free: false, min: 0, max: 1, tag: '[S: SUBMISSIONS §5 rule 24 "does not know to tap"]',
    note: 'T0 stubbornness base.',
  },
  {
    id: 'sub.pGoOut.t1', value: FINISH_PARAMS.pGoOutTier[1], unit: 'probability', section: S,
    free: false, min: 0, max: 1, tag: '[S: P9 judo cadet 18.9 %]', note: 'T1 stubbornness base.',
  },
  {
    id: 'sub.pGoOut.t2', value: FINISH_PARAMS.pGoOutTier[2], unit: 'probability', section: S,
    free: false, min: 0, max: 1, tag: '[S: P2 UFC 11 % LOC]', note: 'T2 stubbornness base.',
  },
  {
    id: 'sub.pGoOut.t3', value: FINISH_PARAMS.pGoOutTier[3], unit: 'probability', section: S,
    free: false, min: 0, max: 1, tag: '[S: P2]', note: 'T3 stubbornness base.',
  },
  {
    id: 'sub.pGoOut.t4', value: FINISH_PARAMS.pGoOutTier[4], unit: 'probability', section: S,
    free: false, min: 0, max: 1, tag: '[S: P2 - the C9 anchor]', note: 'T4 stubbornness base.',
  },
  {
    id: 'sub.pGoOut.t5', value: FINISH_PARAMS.pGoOutTier[5], unit: 'probability', section: S,
    free: false, min: 0, max: 1, tag: '[S: P9 judo senior 4.3 %]', note: 'T5 stubbornness base.',
  },
  {
    id: 'sub.pGoOut.stakesMult', value: FINISH_PARAMS.stakesTitleMult, unit: 'ratio', section: S,
    free: true, min: 1, max: 2, tag: '[E: 04 §2.6.2]', note: 'Title fights: people hold on longer.',
  },
  {
    id: 'sub.pGoOut.injuryHistoryMult', value: FINISH_PARAMS.injuryHistoryMult, unit: 'ratio', section: S,
    free: false, min: 0.5, max: 1, tag: '[S: 01_FIGHTER_MODEL §2.7.7; P15 direction]',
    note: 'Two or more career submission losses make a fighter tap sooner.',
  },
  {
    id: 'sub.stubbornness.min', value: FINISH_PARAMS.stubbornnessMin, unit: 'probability', section: S,
    free: false, min: 0, max: 0.1, tag: '[S: 01 §2.7.7 clamp]', note: 'Lower clamp on stubbornness.',
  },
  {
    id: 'sub.stubbornness.max', value: FINISH_PARAMS.stubbornnessMax, unit: 'probability', section: S,
    free: false, min: 0.2, max: 1, tag: '[S: 01 §2.7.7 clamp]', note: 'Upper clamp on stubbornness.',
  },
  {
    id: 'sub.refusesToTapFloor', value: FINISH_PARAMS.refusesToTapFloor, unit: 'probability', section: S,
    free: false, min: 0, max: 1, tag: '[S: 01 §2.7.7 trait]',
    note: 'The refusesToTap trait floors stubbornness here.',
  },
  {
    id: 'sub.pRefuseFactor', value: FINISH_PARAMS.pRefuseFactor, unit: 'ratio', section: S,
    free: true, min: 0, max: 1, tag: '[S: rule 7 "stubbornness x 0.5"]',
    note: 'Joint locks: pain is a louder argument than fading vision. T0 is exempt (rule 24).',
  },
  {
    id: 'sub.tapClampBeforeLocS', value: FINISH_PARAMS.tapClampBeforeLocS, unit: 's', section: S,
    free: true, min: 0, max: 2, tag: '[E: 04 §2.6.2]',
    note: 'A tapper always taps at least this long before unconsciousness would arrive.',
  },

  // ---- §2.6.2 / §2.6.5 locked escape hazards -----------------------------
  {
    id: 'sub.hEsc.bloodT4', value: FINISH_PARAMS.hEscBloodT4, unit: 'probability', section: S,
    free: true, min: 0, max: 0.3, tag: '[S: SUBMISSIONS §5 rule 8]',
    note: 'Per-second escape hazard from a locked blood choke, T4.',
  },
  {
    id: 'sub.hEsc.bloodT5', value: FINISH_PARAMS.hEscBloodT5, unit: 'probability', section: S,
    free: true, min: 0, max: 0.3, tag: '[S: rule 8]', note: 'T5.',
  },
  {
    id: 'sub.hEsc.bloodLowTier', value: FINISH_PARAMS.hEscBloodLowTier, unit: 'probability', section: S,
    free: true, min: 0, max: 0.3, tag: '[S: rule 8]', note: 'T<=2.',
  },
  {
    id: 'sub.hEsc.airT4', value: FINISH_PARAMS.hEscAirT4, unit: 'probability', section: S,
    free: true, min: 0, max: 0.5, tag: '[S: rule 8]',
    note: 'Per-second escape hazard from a mixed choke that never became functional, T4.',
  },
  {
    id: 'sub.hEsc.airT5', value: FINISH_PARAMS.hEscAirT5, unit: 'probability', section: S,
    free: true, min: 0, max: 0.5, tag: '[S: rule 8]', note: 'T5.',
  },
  {
    id: 'sub.hEsc.airLowTier', value: FINISH_PARAMS.hEscAirLowTier, unit: 'probability', section: S,
    free: true, min: 0, max: 0.5, tag: '[S: rule 8]', note: 'T<=2.',
  },
  {
    id: 'sub.hEsc.regressShareChoke', value: FINISH_PARAMS.escapeSplitRegressChoke, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.2]',
    note: 'A locked-choke escape usually only loosens it back to S2.',
  },
  {
    id: 'sub.hEsc.regressShareLock', value: FINISH_PARAMS.escapeSplitRegressLock, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.5]', note: 'As above, for joint locks.',
  },

  // ---- §2.6.3 / §2.6.4 referee and post-LOC ------------------------------
  {
    id: 'sub.refLag.locS', value: FINISH_PARAMS.locDetectS, unit: 's', section: S,
    free: false, min: 0, max: 3, tag: '[S: 06 §2.3.5 cfg.locDetectS - §06 owns referee latencies]',
    note: 'Median referee reaction to unconsciousness; lands inside SUB_PHYS\'s 2.4 s asymptomatic band.',
  },
  {
    id: 'sub.refLag.injuryMinS', value: FINISH_PARAMS.refLagInjuryMinS, unit: 's', section: S,
    free: true, min: 0, max: 3, tag: '[E: 04 §2.6.4]', note: 'Referee reaction to a visible break.',
  },
  {
    id: 'sub.refLag.injuryMaxS', value: FINISH_PARAMS.refLagInjuryMaxS, unit: 's', section: S,
    free: true, min: 0, max: 5, tag: '[E: 04 §2.6.4]', note: 'Upper end of that lag.',
  },
  {
    id: 'sub.pRefStopsOnInjury', value: FINISH_PARAMS.pRefStopsOnInjury, unit: 'probability', section: S,
    free: false, min: 0, max: 1, tag: '[S: rule 7 "p 0.3 continues"]',
    note: 'The other 30 % of broken limbs are fought on with.',
  },
  {
    id: 'sub.attackerRelease.t4', value: FINISH_PARAMS.attackerReleaseT4, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.3]',
    note: 'P(the attacker notices the limp body and lets go within 1 s).',
  },
  {
    id: 'sub.attackerRelease.t5', value: FINISH_PARAMS.attackerReleaseT5, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.3]', note: 'T5.',
  },
  {
    id: 'sub.attackerRelease.lowTier', value: FINISH_PARAMS.attackerReleaseLowTier, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.3]', note: 'T<=2 hold on far too long.',
  },
  {
    id: 'sub.postLoc.symptomHoldS', value: FINISH_PARAMS.postLocSymptomHoldS, unit: 's', section: S,
    free: false, min: 0, max: 10, tag: '[S: P9]',
    note: 'Hold past unconsciousness beyond which symptoms appear.',
  },
  {
    id: 'sub.postLoc.symptomP', value: FINISH_PARAMS.postLocSymptomP, unit: 'probability', section: S,
    free: false, min: 0, max: 1, tag: '[S: P9 61.5 % symptomatic, OR 6.7]',
    note: 'P(convulsions / staggering). Cosmetic plus §05 recovery time.',
  },

  // ---- §2.6.5 injury -----------------------------------------------------
  {
    id: 'sub.pInjBeforeTap.t0', value: FINISH_PARAMS.pInjBeforeTapTier[0], unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E, anchored on P10 RR 12.0 and P13 "failure can precede pain"]',
    note: 'Heel hook: P(the knee goes before the tap does), T0.',
  },
  {
    id: 'sub.pInjBeforeTap.t1', value: FINISH_PARAMS.pInjBeforeTapTier[1], unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: as above]', note: 'T1.',
  },
  {
    id: 'sub.pInjBeforeTap.t2', value: FINISH_PARAMS.pInjBeforeTapTier[2], unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: as above]', note: 'T2.',
  },
  {
    id: 'sub.pInjBeforeTap.t3', value: FINISH_PARAMS.pInjBeforeTapTier[3], unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: as above]', note: 'T3.',
  },
  {
    id: 'sub.pInjBeforeTap.t4', value: FINISH_PARAMS.pInjBeforeTapTier[4], unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: as above]', note: 'T4-T5.',
  },
  {
    id: 'sub.pInjBeforeTap.insideMult', value: 1.2, unit: 'ratio', section: S,
    free: true, min: 1, max: 2, tag: '[S: P13 "theoretically more dangerous"; magnitude E]',
    note: 'The inside heel hook has the smaller motion arc, so less warning.',
  },
  {
    id: 'sub.neckStrainPer5s', value: FINISH_PARAMS.neckStrainPer5s, unit: '0-1', section: S,
    free: true, min: 0, max: 0.5, tag: '[E: 04 §2.6.5; P17]',
    note: 'Cranks accumulate state.neck_cranked severity instead of a discrete injury.',
  },
  {
    id: 'sub.neckStrain.refThreshold', value: FINISH_PARAMS.neckStrainRefThreshold, unit: '0-1', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.5]',
    note: 'Above this the referee may stop it, and §05 applies a head-absorption penalty.',
  },
  {
    id: 'sub.neckStrain.refStopPerS', value: FINISH_PARAMS.neckStrainRefStopPerS, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.5]', note: 'Per-second stop chance past the threshold.',
  },
  {
    id: 'sub.injury.doctorStopHigh', value: FINISH_PARAMS.doctorStopHigh, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E; DAMAGE §5.2 owns the doctor logic]',
    note: 'Doctor stop at the round break after a high-severity joint failure.',
  },
  {
    id: 'sub.injury.doctorStopMedium', value: FINISH_PARAMS.doctorStopMedium, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E; DAMAGE §5.2]', note: 'Medium severity.',
  },
  {
    id: 'sub.injury.layoffMonthsHigh', value: FINISH_PARAMS.layoffMonthsHigh, unit: 'count', section: S,
    free: false, min: 0, max: 36, tag: '[S: P5 10.3 months]',
    note: 'Career layoff after a high-severity joint failure; commentary and career mode only.',
  },

  // ---- §2.6.6 slams ------------------------------------------------------
  {
    id: 'sub.slam.pAttempt', value: SLAM_PARAMS.pAttemptT4, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: SUBMISSIONS §5 rule 19]',
    note: 'Per window, T4. Realism keeps this low rather than boosting it for spectacle.',
  },
  {
    id: 'sub.slam.pAttemptWrestlerGnp', value: SLAM_PARAMS.pAttemptWrestlerGnp, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: rule 19]', note: 'Per window, wrestler-GnP style.',
  },
  {
    id: 'sub.slam.minStrength', value: SLAM_PARAMS.minStrength, unit: '0-100', section: S,
    free: false, min: 0, max: 100, tag: '[S: rule 19]', note: 'Below this the slam is not an option.',
  },
  {
    id: 'sub.slam.minMassAdvantageKg', value: SLAM_PARAMS.minMassAdvantageKg, unit: 'kg', section: S,
    free: true, min: 0, max: 40, tag: '[E: 04 §2.6.6]', note: 'Mass advantage that substitutes for strength.',
  },
  {
    id: 'sub.slam.pLiftBase', value: SLAM_PARAMS.pLiftBase, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.6]',
    note: 'P(the lift comes off) before the strength, mass and fatigue terms.',
  },
  {
    id: 'sub.slam.pBreakTriangle', value: SLAM_PARAMS.pBreak.triangle, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: rule 19]', note: 'P(the lock breaks) once the attacker is off the mat.',
  },
  {
    id: 'sub.slam.pBreakArmbar', value: SLAM_PARAMS.pBreak.armbar, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: rule 19]', note: 'Armbar.',
  },
  {
    id: 'sub.slam.pBreakGuillotine', value: SLAM_PARAMS.pBreak.guillotine, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: rule 19]', note: 'Guillotine - the hardest lock to shake loose.',
  },
  {
    id: 'sub.slam.pBreakOmoplata', value: SLAM_PARAMS.pBreak.omoplata, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.6]', note: 'Omoplata.',
  },
  {
    id: 'sub.slam.pBreakFlying', value: SLAM_PARAMS.pBreak.flying, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.6]', note: 'Flying attacks.',
  },
  {
    id: 'sub.slam.heightKnees', value: SLAM_PARAMS.heightDraw.knees, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.6]', note: 'Height draw: from the knees.',
  },
  {
    id: 'sub.slam.heightWaist', value: SLAM_PARAMS.heightDraw.waist, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.6]', note: 'Height draw: waist.',
  },
  {
    id: 'sub.slam.heightShoulder', value: SLAM_PARAMS.heightDraw.shoulder, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.6]', note: 'Height draw: shoulder.',
  },
  {
    id: 'sub.slam.heightOverhead', value: SLAM_PARAMS.heightDraw.overhead, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.6]', note: 'Height draw: overhead. Needs strength 80.',
  },
  {
    id: 'sub.slam.overheadMinStrength', value: SLAM_PARAMS.overheadMinStrength, unit: '0-100', section: S,
    free: false, min: 0, max: 100, tag: '[E: 04 §2.6.6]', note: 'Strength gate on an overhead slam.',
  },
  {
    id: 'sub.slam.forceMultKnees', value: SLAM_PARAMS.forceMult.knees, unit: 'ratio', section: S,
    free: true, min: 0, max: 4, tag: '[E: 04 §2.6.6 ladder]', note: 'x the hook reference force.',
  },
  {
    id: 'sub.slam.forceMultWaist', value: SLAM_PARAMS.forceMult.waist, unit: 'ratio', section: S,
    free: true, min: 0, max: 4, tag: '[E: 04 §2.6.6 ladder]', note: 'x the hook reference force.',
  },
  {
    id: 'sub.slam.forceMultShoulder', value: SLAM_PARAMS.forceMult.shoulder, unit: 'ratio', section: S,
    free: true, min: 0, max: 4, tag: '[E: 04 §2.6.6 ladder]', note: 'x the hook reference force.',
  },
  {
    id: 'sub.slam.forceMultOverhead', value: SLAM_PARAMS.forceMult.overhead, unit: 'ratio', section: S,
    free: true, min: 0, max: 4, tag: '[E: 04 §2.6.6 ladder]', note: 'x the hook reference force.',
  },
  {
    id: 'sub.slam.hookReferenceN', value: SLAM_PARAMS.hookReferenceN, unit: 'N', section: S,
    free: false, min: 1000, max: 10000, tag: '[S: DAMAGE §3.1 hook reference force]',
    note: 'The slam impact is quoted as a multiple of this, then scaled by Arena.surfaceHardness.',
  },
  {
    id: 'sub.slam.tooLateS', value: SLAM_PARAMS.tooLateS, unit: 's', section: S,
    free: true, min: 0, max: 5, tag: '[E: 04 §2.6.6]',
    note: 'A slam this close to unconsciousness no longer breaks the choke.',
  },

  // ---- §2.6.6 counters ---------------------------------------------------
  {
    id: 'sub.vonFlue.releaseT3', value: 0.8, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: SUBMISSIONS §5 rule 20]',
    note: 'P(a T3+ guillotine attacker lets go before the von Flue closes), per window.',
  },
  {
    id: 'sub.vonFlue.releaseT2', value: 0.4, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: rule 20]', note: 'T2.',
  },
  {
    id: 'sub.vonFlue.releaseT01', value: 0.1, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: rule 20]',
    note: 'T<=1 hold the lost choke - which is why the von Flue exists at all.',
  },
  {
    id: 'sub.mutual.strikeAbandonP', value: MUTUAL_STRIKE_ABANDON_P, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: rule 21]',
    note: 'Abandon roll after two strikes land inside one window of an entanglement.',
  },
  {
    id: 'sub.strike.landedRate', value: STRIKE_LANDED_RATE, unit: 'probability', section: S,
    free: false, min: 0, max: 1, tag: '[S: BJJ_POS §7.3]',
    note: 'Ground-strike landed rate used by def.strike_attacker.',
  },
  {
    id: 'sub.strike.dmgMultTopIntoEntanglement', value: STRIKE_DMG_MULT.topIntoEntanglement, unit: 'ratio', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.5]', note: 'Damage scaling for strikes down into an entanglement.',
  },
  {
    id: 'sub.strike.dmgMultInsideTriangle', value: STRIKE_DMG_MULT.insideTriangle, unit: 'ratio', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.5]', note: 'Damage scaling for strikes thrown from inside a triangle.',
  },
  {
    id: 'sub.triDiamondCounterShare', value: 0.05, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §2.6.6]',
    note: 'Share of guard-triangle failures that hand the defender a leg lock off the diamond.',
  },

  // ---- §2.8 energy -------------------------------------------------------
  {
    id: 'sub.energy.attackerEntry', value: ATTACKER_ENERGY_PER_S.entry, unit: 'ratio', section: S,
    free: true, min: 0, max: 5, tag: '[E: scaled to BJJ_POS §8 rule 19 ground drains]',
    note: "Per second, in §05's units where an average round is about 100.",
  },
  {
    id: 'sub.energy.attackerSecure', value: ATTACKER_ENERGY_PER_S.secure, unit: 'ratio', section: S,
    free: true, min: 0, max: 5, tag: '[E: as above]', note: 'Per second at S2.',
  },
  {
    id: 'sub.energy.attackerFinish', value: ATTACKER_ENERGY_PER_S.finish, unit: 'ratio', section: S,
    free: true, min: 0, max: 5, tag: '[E: as above]', note: 'Per second at S3 - the squeeze.',
  },
  {
    id: 'sub.energy.attackerLocked', value: ATTACKER_ENERGY_PER_S.locked, unit: 'ratio', section: S,
    free: true, min: 0, max: 5, tag: '[E: as above]', note: 'Per second while locked: just holding.',
  },
  {
    id: 'sub.energy.gripAdd', value: ATTACKER_GRIP_ENERGY_ADD, unit: 'ratio', section: S,
    free: true, min: 0, max: 2, tag: '[E: as above]', note: 'Added per second for grip-heavy attacks.',
  },
  {
    id: 'sub.energy.defStandard', value: ENERGY_PER_S.med, unit: 'ratio', section: S,
    free: true, min: 0, max: 5, tag: '[E: as above]', note: 'Standard defender option, per second.',
  },
  {
    id: 'sub.energy.defHigh', value: ENERGY_PER_S.high, unit: 'ratio', section: S,
    free: true, min: 0, max: 5, tag: '[E: as above]',
    note: 'High-cost options: stack, walk weak side, roll with, spin out, clear hooks, bridge, clear knee line.',
  },
  {
    id: 'sub.energy.defSlam', value: ENERGY_PER_S.veryHigh, unit: 'ratio', section: S,
    free: true, min: 0, max: 10, tag: '[E: as above]', note: 'Per slam attempt, not per second.',
  },
  {
    id: 'sub.energy.defEndure', value: ENERGY_PER_S.low, unit: 'ratio', section: S,
    free: true, min: 0, max: 5, tag: '[E: as above]', note: 'Enduring is cheap - that is the point of it.',
  },
  {
    id: 'sub.energy.defPanic', value: ENERGY_PER_S.panic, unit: 'ratio', section: S,
    free: true, min: 0, max: 5, tag: '[E: as above]', note: 'T0-T1 thrashing (def.none).',
  },

  // ---- §6 behaviour ------------------------------------------------------
  {
    id: 'sub.attempt.base', value: BEHAVIOUR_PARAMS.attemptBase, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: SUBMISSIONS §5 rule 2]',
    note: 'pAttempt intercept on an availability window. The main C2/C3 knob.',
  },
  {
    id: 'sub.attempt.skillSlope', value: BEHAVIOUR_PARAMS.attemptSkillSlope, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: rule 2]', note: 'pAttempt slope in family skill / 100.',
  },
  {
    id: 'sub.attempt.subHunterMult', value: BEHAVIOUR_PARAMS.attemptSubHunterMult, unit: 'ratio', section: S,
    free: true, min: 0.5, max: 4, tag: '[S: rule 2]', note: 'style.subHunter.',
  },
  {
    id: 'sub.attempt.wrestlerGnpMult', value: BEHAVIOUR_PARAMS.attemptWrestlerGnpMult, unit: 'ratio', section: S,
    free: true, min: 0, max: 1.5, tag: '[S: rule 2]', note: 'style.wrestlerGnp would rather punch.',
  },
  {
    id: 'sub.attempt.rockedMult', value: BEHAVIOUR_PARAMS.attemptRockedMult, unit: 'ratio', section: S,
    free: true, min: 1, max: 4, tag: '[S: rule 2]', note: 'The opponent is hurt: jump on it.',
  },
  {
    id: 'sub.attempt.fatigueMult', value: BEHAVIOUR_PARAMS.attemptFatigueMult, unit: 'ratio', section: S,
    free: true, min: 0, max: 1.5, tag: '[S: rule 2]',
    note: 'Above fatigue 0.7; the RNC and the arm-triangle are exempt.',
  },
  {
    id: 'sub.attempt.trailingMult', value: BEHAVIOUR_PARAMS.attemptTrailingMult, unit: 'ratio', section: S,
    free: false, min: 0, max: 1.5, tag: '[S: FIGHT_DATA #129 -49 %]',
    note: 'Trailing on the cards in R3+. Counter-intuitive, but that is what the data says.',
  },
  {
    id: 'sub.attempt.rulesetMmaMult', value: BEHAVIOUR_PARAMS.attemptRulesetMmaMult, unit: 'ratio', section: S,
    free: false, min: 1, max: 1, tag: '[E: 04 §6.1]', note: 'MMA is the reference.',
  },
  {
    id: 'sub.attempt.rulesetSubOnlyMult', value: BEHAVIOUR_PARAMS.attemptRulesetSubOnlyMult, unit: 'ratio', section: S,
    free: true, min: 0.5, max: 3, tag: '[E: 04 §6.1]', note: 'Sub-only: there is nothing else to win with.',
  },
  {
    id: 'sub.attempt.rulesetGrapplingMult', value: BEHAVIOUR_PARAMS.attemptRulesetGrapplingMult, unit: 'ratio', section: S,
    free: true, min: 0.5, max: 3, tag: '[E: 04 §6.1]', note: 'ADCC / IBJJF: no strikes to worry about.',
  },
  {
    id: 'sub.attempt.rulesetJudoMult', value: BEHAVIOUR_PARAMS.attemptRulesetJudoMult, unit: 'ratio', section: S,
    free: true, min: 0, max: 2, tag: '[E: 04 §6.1]', note: 'Judo ne-waza is time-limited.',
  },
  {
    id: 'sub.attempt.rulesetStreetMult', value: BEHAVIOUR_PARAMS.attemptRulesetStreetMult, unit: 'ratio', section: S,
    free: true, min: 0, max: 2, tag: '[E: 04 §6.1]', note: 'Street.',
  },
  {
    id: 'sub.attempt.latencyT0MinS', value: DECISION_LATENCY_S[0][0], unit: 's', section: S,
    free: false, min: 0, max: 20, tag: '[S: BJJ_POS §6 via 01 §2.3.4]',
    note: 'Decision latency between availability evaluations, T0.',
  },
  {
    id: 'sub.attempt.latencyT0MaxS', value: DECISION_LATENCY_S[0][1], unit: 's', section: S,
    free: false, min: 0, max: 20, tag: '[S: BJJ_POS §6 via 01 §2.3.4]', note: 'T0 upper bound.',
  },
  {
    id: 'sub.attempt.latencyT4MinS', value: DECISION_LATENCY_S[4][0], unit: 's', section: S,
    free: false, min: 0, max: 20, tag: '[S: BJJ_POS §6 via 01 §2.3.4]', note: 'T4 lower bound.',
  },
  {
    id: 'sub.attempt.latencyT4MaxS', value: DECISION_LATENCY_S[4][1], unit: 's', section: S,
    free: false, min: 0, max: 20, tag: '[S: BJJ_POS §6 via 01 §2.3.4]', note: 'T4 upper bound.',
  },
  {
    id: 'sub.attempt.latencyT5MinS', value: DECISION_LATENCY_S[5][0], unit: 's', section: S,
    free: false, min: 0, max: 20, tag: '[S: BJJ_POS §6 via 01 §2.3.4]', note: 'T5 lower bound.',
  },
  {
    id: 'sub.attempt.latencyT5MaxS', value: DECISION_LATENCY_S[5][1], unit: 's', section: S,
    free: false, min: 0, max: 20, tag: '[S: BJJ_POS §6 via 01 §2.3.4]', note: 'T5 upper bound.',
  },
  {
    id: 'sub.tierDefShift.t0', value: TIER_DEF_SHIFT[0].entry, unit: 'logit', section: S,
    free: true, min: -4, max: 0, tag: '[D: SUBMISSIONS §4 Untrained]',
    note: 'T0 escape roll, every stage: they do not recognise the danger.',
  },
  {
    id: 'sub.tierDefShift.t1Entry', value: TIER_DEF_SHIFT[1].entry, unit: 'logit', section: S,
    free: true, min: -3, max: 0, tag: '[D: SUBMISSIONS §4 Novice x0.4 on p~0.14]',
    note: 'T1 at S1: they know the name of the defence but use it at S3.',
  },
  {
    id: 'sub.tierDefShift.t1Secure', value: TIER_DEF_SHIFT[1].secure, unit: 'logit', section: S,
    free: true, min: -3, max: 0, tag: '[D: §4 Novice x0.6]', note: 'T1 at S2.',
  },
  {
    id: 'sub.tierDefShift.t2Entry', value: TIER_DEF_SHIFT[2].entry, unit: 'logit', section: S,
    free: true, min: -2, max: 0, tag: '[D: §4 Intermediate x0.8]', note: 'T2 at S1: they defend at S2.',
  },
  {
    id: 'sub.tierDefShift.t5Entry', value: TIER_DEF_SHIFT[5].entry, unit: 'logit', section: S,
    free: true, min: 0, max: 2, tag: '[D: §4 Elite x1.4 on p~0.14-0.5]', note: 'T5 at S1: early hand-fighting.',
  },
  {
    id: 'sub.tierDefShift.t5Secure', value: TIER_DEF_SHIFT[5].secure, unit: 'logit', section: S,
    free: true, min: 0, max: 2, tag: '[D: §4 Elite x1.25]', note: 'T5 at S2.',
  },
  {
    id: 'sub.tierDefShift.t5Finish', value: TIER_DEF_SHIFT[5].finish, unit: 'logit', section: S,
    free: true, min: 0, max: 2, tag: '[D: §4 Elite x1.1]', note: 'T5 at S3.',
  },
  {
    id: 'sub.t5.availabilityMult', value: BEHAVIOUR_PARAMS.t5AvailabilityMult, unit: 'ratio', section: S,
    free: true, min: 0, max: 1, tag: '[S: SUBMISSIONS §5 rule 23 "-40 %"]',
    note: 'T5 denies S0: they simply never give the position.',
  },
  {
    id: 'sub.t0.pressureTapPerS', value: BEHAVIOUR_PARAMS.t0PressureTapPerS, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[S: rule 24]',
    note: 'A T0 mounted or back-controlled by a T4+ attacker taps to the pressure alone.',
  },
  {
    id: 'sub.defPickBest.base', value: BEHAVIOUR_PARAMS.defPickBestBase, unit: 'probability', section: S,
    free: true, min: 0, max: 1, tag: '[E: 04 §6.2]',
    note: 'P(the defender picks the highest-EV option) rather than a random known one.',
  },
  {
    id: 'sub.defPickBest.tierSlope', value: BEHAVIOUR_PARAMS.defPickBestTierSlope, unit: 'probability', section: S,
    free: true, min: 0, max: 0.2, tag: '[E: 04 §6.2]', note: 'Per tier.',
  },
  {
    id: 'sub.defPickBest.iqSlope', value: BEHAVIOUR_PARAMS.defPickBestIqSlope, unit: 'probability', section: S,
    free: true, min: 0, max: 0.02, tag: '[E: 04 §6.2]', note: 'Per point of fightIQ above 50.',
  },
  {
    id: 'sub.illegalAttemptP.t01', value: ILLEGAL_ATTEMPT_P_T01, unit: 'probability', section: S,
    free: true, min: 0, max: 0.2, tag: '[E: 04 §5]',
    note: 'A T0-T1 fighter in a grappling ruleset tries a banned technique by mistake.',
  },
];
