/**
 * ARCHETYPE PRESETS — design chapter 01 §4.
 *
 * Fifteen complete `FighterDefinition` literals spanning the tier ladder from
 * "big guy from the bar" to "complete lightweight champion". They exist for
 * three jobs: the creator's starting points, the calibration ladder of §6
 * (C-1 skill gap, C-3 age, C-9 punch force, C-11 tier priors), and the
 * regression tests that keep the tier arithmetic honest.
 *
 * All archetype values are `[E]` design data placed inside the `CONV §3` tier
 * bands and the population priors of §2.1; the derived checks quoted in the
 * chapter are `[D]` from the §2.7 formulas and are asserted in
 * `tests/fighter.test.ts`. Disciplines not listed are untrained (every
 * sub-skill 5, `yearsTrained 0`) and the transfer matrix fills them in.
 *
 * Technique and submission ids belong to chapters 02-04. The presets were
 * written before those chapters fixed their ids, so §4's alias map is applied
 * here at construction time rather than silently dropping an id that does not
 * resolve.
 *
 * ## The §8 depth fields, and one rule about them
 *
 * Every preset carries the chapter §8 detail: a start age, a weekly volume, a
 * coach quality, a base art, a grade, a competition record in each art, its
 * specialisations, the overall-experience block and a biography. They are
 * there to be exemplary — a user opening the Olympic Judoka should see what a
 * fully described fighter looks like.
 *
 * The rule is that **no §8 field on a preset may double-count something the
 * preset's own numbers already encode.** These fifteen are the calibration
 * fixtures of §6 (C-1 skill gap, C-3 age, C-9 punch force, C-11 tier priors),
 * and their sub-skills and attributes were authored as the *finished* picture
 * of each fighter. So:
 *
 *  - `sparringIntensity` stays at the neutral 50. The presets' sub-skills are
 *    already what the fighter can do against resistance; a second multiplier
 *    on top would move the whole ladder.
 *  - `monthsSinceTrained` stays at 0 except where an archetype's story is that
 *    he has stopped training something (the ageing veteran's Muay Thai).
 *  - the grade and the competition record are authored honestly and simply do
 *    not bite, because §8.1.3 floors the art's *mean* and every preset is
 *    already authored at or above what its grade attests. That is the check
 *    working, not the check being avoided.
 *  - specialisations are mean-neutral by construction (§8.1.4), so they
 *    reshape a preset without moving its tier.
 *  - injuries are listed only where they are part of the fighter — the ageing
 *    veteran's two reconstructions and recurrent hand. A preset in peak camp
 *    has none, which is a claim, not an omission.
 */

import {
  weightClassFor, DISCIPLINE_IDS,
  type CoreDisciplineId, type DisciplineGrade, type DisciplineSkills, type DisciplineCompetition,
  type FighterHistory, type InjuryEntry,
  type BjjSkills, type BoxingSkills, type BuildBlend, type CareerRecord, type ComboSpec,
  type FighterDefinition, type FighterDisciplines, type FightRecord, type GuardStyle,
  type Handedness, type Initiative, type JudoSkills, type KarateSkills, type KickboxingSkills,
  type LosingBehaviour, type HurtBehaviour, type MentalAttributes, type MmaIntegrationSkills,
  type MuayThaiSkills, type PrimaryMode, type RangeBand, type SamboSkills, type Stance,
  type StyleSpec, type TaekwondoSkills, type ThaiStyle, type TiredBehaviour, type TakedownStyle,
  type WeightClassId, type WeightedSubmission, type WeightedTechnique, type WrestlingSkills,
} from './types';

// --------------------------------------------------------------------------
// §4 preset id alias map
// --------------------------------------------------------------------------

/**
 * Preset ids that resolve to the canonical ids owned by 02 (§2.2 / §2.3.4 /
 * §2.4.2), 03 (§2.3 / §5.1) and 04 (§3). Ids not listed already match.
 */
export const PRESET_ID_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'tech.lead_hook': 'tech.hook_lead',
  'tech.body_hook_lead': 'tech.hook_lead_body',
  'tech.body_hook_rear': 'tech.hook_rear_body',
  'tech.overhand_rear': 'tech.overhand',
  'tech.low_kick_rear': 'tech.kick_low_rear',
  'tech.calf_kick': 'tech.kick_calf',
  'tech.round_kick_body_rear': 'tech.kick_body_rear',
  'tech.switch_kick_body': 'tech.kick_body_switch',
  'tech.round_kick_head_rear': 'tech.kick_head_rear',
  // 02 has no non-switch lead head kick.
  'tech.round_kick_head_lead': 'tech.kick_head_switch',
  'tech.front_kick_body': 'tech.kick_front_snap',
  'tech.side_kick': 'tech.kick_side',
  'tech.spinning_back_kick': 'tech.kick_spinning_back',
  // Feints are `feint.*`, not `tech.*` (02 §2.3.4).
  'tech.feint_jab': 'feint.jab',
  'tech.feint_level': 'feint.level_change',
  // Karate blitz = step-in jab entry; 02 has no separate blitz technique.
  'tech.blitz_step': 'tech.jab_step',
  'tech.collar_tie_knee': 'tech.clinch_knee',
  'tech.gnp_cross': 'tech.gnp_punch',
  // 03 §2.3 A: destination weights collar tie 0.5 / underhook 0.15.
  'tech.clinch_entry_collar': 'tech.clinch_entry_strikes',
  'tech.clinch_entry_underhook': 'tech.clinch_entry_strikes',
  // The AI may also pick tech.inside_trip from the lock.
  'tech.body_lock_td': 'tech.body_lock_lift_return',
  'tech.kick_catch_sweep': 'tech.kick_catch_takedown',
  'tech.guard_pull': 'tech.pull_guard',
  'tech.arm_drag_back': 'tech.arm_drag',
  // 03 §8.1 T0 row: a tackle is a double leg with no level change.
  'tech.tackle': 'tech.double_leg',
  // T0 headlock = head-and-arm tie.
  'tech.headlock': 'tech.clinch_entry_cold',
  'tech.grab_push': 'tech.clinch_entry_cold',
  'def.slip_outside': 'def.slip_out',
  'def.pivot': 'def.step_off',
  'sub.knee_bar': 'sub.kneebar',
  'sub.headlock_squeeze': 'sub.bulldog',
});

export function resolvePresetId(id: string): string {
  return PRESET_ID_ALIASES[id] ?? id;
}

// --------------------------------------------------------------------------
// Construction helper
// --------------------------------------------------------------------------

interface PresetBody {
  heightM: number; reachM: number; legReachM: number;
  weighInKg: number; fightNightKg: number; weightClass?: WeightClassId;
  ageYears: number; bodyFatPct: number; build: BuildBlend;
  stance: Stance; handedness?: Handedness;
}

/** The chapter's thirteen; `gripStrength` is filled from strength when absent. */
interface PresetPhysical {
  strength: number; explosiveness: number; speed: number; handSpeed: number; kickSpeed: number;
  cardio: number; chin: number; bodyToughness: number; recovery: number; flexibility: number;
  balance: number; reactionTime: number; neck: number; gripStrength?: number;
}

interface PresetCareer {
  pro: FightRecord;
  amateur: FightRecord;
  titleFights?: number;
  bigFightComposure: number;
  careerKnockdownsAbsorbed: number;
  winStreak?: number;
  lastResult?: CareerRecord['lastResult'];
  lastResultWasKoLoss?: boolean;
  daysSinceLastBout?: number;
  stanceExposure?: { orthodox: number; southpaw: number };
  weightCut?: { cutPct: number; regainPct: number; residualDehydration: number };

  // --- 01 §8.2 overall experience ----------------------------------------
  /** Defaults to 3 x pro bouts + 2 x amateur bouts if omitted. */
  totalRounds?: number;
  yearsPro?: number;
  /** 0-100; defaults to 50 (the neutral value of the §8.2 scaling). */
  oppositionLevel?: number;
  mainEvents?: number;
  titleWins?: number;
  warFights?: number;
  hardSparringYears?: number;
}

/**
 * Per-discipline §8.1 depth for a preset.
 *
 * Only the fields that cannot be inferred are written per archetype. The rest
 * — start age, volume, sessions, coach quality — are derived in `preset()`
 * from the age, the years and the training quality the archetype already
 * declares, because a preset that restated them would be a preset that could
 * contradict itself.
 */
interface PresetDepth {
  grade?: DisciplineGrade;
  competition?: DisciplineCompetition;
  specialisations?: string[];
  /** Overrides the `age - years` default; set it where the story needs it. */
  startAge?: number;
  /** Months out of this art. 0 for everything the fighter still trains. */
  monthsSinceTrained?: number;
  /** Overrides the flag `preset()` puts on the longest-trained art. */
  isBase?: boolean;
}

interface PresetStyle {
  preferredRange: RangeBand;
  initiative: Initiative;
  pressureBias: number;
  primaryMode: PrimaryMode;
  fallbackMode: PrimaryMode;
  favouriteTechniques: WeightedTechnique[];
  combos: ComboSpec[];
  goToSubmissions: WeightedSubmission[];
  takedowns: TakedownStyle;
  bottomPriority?: StyleSpec['bottomPriority'];
  topPriority?: StyleSpec['topPriority'];
  hurtBehaviour: HurtBehaviour;
  losingBehaviour: LosingBehaviour;
  tiredBehaviour: TiredBehaviour;
  stanceSwitching?: number;
  guardStyle?: GuardStyle;
  thaiStyle?: ThaiStyle;
}

interface PresetInput {
  id: string;
  name: string;
  short: string;
  notes: string;
  body: PresetBody;
  physical: PresetPhysical;
  mental: MentalAttributes;
  disciplines: FighterDisciplines;
  career: PresetCareer;
  style: PresetStyle;
  /** 01 §8.1 per-art depth, keyed by discipline id. */
  depth?: Partial<Record<CoreDisciplineId, PresetDepth>>;
  /** 01 §8.3, §8.4 biography. Omitted means an unmarked, uninjured fighter. */
  history?: FighterHistory;
  /** 01 §8.3: walk-around mass, hand split and limb asymmetry. */
  physique?: {
    naturalWeightKg?: number;
    handStrengthSplit?: number;
    limbAsymmetry?: { armPct: number; legPct: number };
  };
}

const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Fill one discipline block's §8.1 depth.
 *
 * Three of the fields are *derived* rather than authored, because the preset
 * already contains the information they encode:
 *
 *  - `startAge = age - yearsTrained`. An archetype who has wrestled eighteen
 *    years at twenty-nine started at eleven, and saying so twice is an
 *    invitation to disagree with yourself.
 *  - volume and sessions from `trainingQuality`, on the §8.1.2 reference of
 *    8 h across 5 sessions at q = 1.0: `h = 3 + 12(q - 0.55)`, which puts the
 *    0.6 hobbyist at 3.6 h/week and the 1.15 elite camp at 10.2.
 *  - `coachQuality = 20 + 130(q - 0.6)`, the same claim on the 0-100 scale.
 *
 * `sparringIntensity` stays at the neutral 50 and `monthsSinceTrained` at 0
 * for every preset unless the archetype says otherwise. That is deliberate and
 * it is not laziness: the presets are the calibration fixtures of §6, and
 * their sub-skills are authored as the *finished* picture of each art — what
 * the fighter can actually do, sparring included. Applying a second
 * sparring-intensity multiplier on top would double-count it and move the
 * whole calibration ladder. A user's own fighter, authored from a coach's
 * estimate rather than from an outcome, is exactly the case the multiplier is
 * for.
 */
function withDepth(
  block: DisciplineSkills, ageYears: number, depth: PresetDepth | undefined, isBase: boolean,
): DisciplineSkills {
  const q = block.trainingQuality ?? 1;
  return {
    ...block,
    startAge: depth?.startAge ?? Math.round(clampN(ageYears - block.years, 5, 45)),
    hoursPerWeek: round1(clampN(3 + 12 * (q - 0.55), 1, 28)),
    sessionsPerWeek: Math.round(clampN(2 + 4 * (q - 0.55), 1, 12)),
    coachQuality: Math.round(clampN(20 + 130 * (q - 0.6), 5, 98)),
    sparringIntensity: 50,
    monthsSinceTrained: depth?.monthsSinceTrained ?? 0,
    isBase: depth?.isBase ?? isBase,
    specialisations: depth?.specialisations ?? [],
    ...(depth?.grade ? { grade: depth.grade } : {}),
    ...(depth?.competition ? { competition: depth.competition } : block.competition ? {} : {}),
  };
}

const LOSING_TO_LEGACY: Readonly<Record<LosingBehaviour, StyleSpec['whenLosing']>> = Object.freeze({
  finishSeek: 'press',
  stealRound: 'press',
  unchanged: 'hold',
  shell: 'stall',
  gamble: 'gamble',
});

const total = (r: FightRecord): number => r.wins + r.losses + (r.draws ?? 0) + (r.noContests ?? 0);

function preset(input: PresetInput): FighterDefinition {
  const b = input.body;
  const proTotal = total(input.career.pro);
  const days = input.career.daysSinceLastBout ?? 120;
  const regainPct = b.weighInKg > 0 ? (b.fightNightKg / b.weighInKg - 1) * 100 : 0;
  const style = input.style;

  const record: CareerRecord = {
    proWins: input.career.pro.wins,
    proLosses: input.career.pro.losses,
    proDraws: input.career.pro.draws ?? 0,
    amWins: input.career.amateur.wins,
    amLosses: input.career.amateur.losses,
    koLosses: input.career.pro.koLosses ?? 0,
    knockdownsSuffered: input.career.careerKnockdownsAbsorbed,
    titleFights: input.career.titleFights ?? 0,
    layoffMonths: days / 30.4375,
    bigFightComposure: input.career.bigFightComposure,
    pro: input.career.pro,
    amateur: input.career.amateur,
    daysSinceLastBout: days,
    lastResult: input.career.lastResult ?? 'win',
    lastResultWasKoLoss: input.career.lastResultWasKoLoss ?? false,
    stanceExposure: input.career.stanceExposure ?? { orthodox: 0.8 * proTotal, southpaw: 0.2 * proTotal },
    // The cut is modelled as residual dehydration only; the regain benefit
    // enters purely through fightNightKg (01 §7.2 (7)).
    weightCut: input.career.weightCut ?? { cutPct: 7, regainPct, residualDehydration: 0.01 },
    winStreak: input.career.winStreak ?? 0,

    // --- 01 §8.2 -----------------------------------------------------------
    // Rounds default to three per pro bout and two per amateur bout, which is
    // what a mixed record of finishes and decisions averages to. That is above
    // the bout count, so the §8.2 surplus term is non-zero for every preset and
    // the ladder is exercised rather than merely present.
    totalRounds: input.career.totalRounds ?? Math.round(3 * proTotal + 2 * total(input.career.amateur)),
    yearsPro: input.career.yearsPro ?? round1(proTotal / 2.5),
    oppositionLevel: input.career.oppositionLevel ?? 50,
    mainEvents: input.career.mainEvents ?? 0,
    titleWins: input.career.titleWins ?? 0,
    warFights: input.career.warFights ?? 0,
    hardSparringYears: input.career.hardSparringYears ?? 0,
  };

  // §8.1: the base art is the one with the most years behind it, unless an
  // archetype names a different one.
  let baseArt: CoreDisciplineId | null = null;
  let bestYears = -1;
  for (const id of DISCIPLINE_IDS) {
    const block = input.disciplines[id];
    if (block && block.years > bestYears) {
      bestYears = block.years;
      baseArt = id;
    }
  }
  const disciplines: FighterDisciplines = {};
  for (const id of DISCIPLINE_IDS) {
    const block = input.disciplines[id];
    if (!block) continue;
    (disciplines as Record<string, DisciplineSkills>)[id] =
      withDepth(block, b.ageYears, input.depth?.[id], id === baseArt);
  }

  return {
    schema: 1,
    id: input.id,
    name: input.name,
    short: input.short,
    notes: input.notes,
    body: {
      heightM: b.heightM,
      reachM: b.reachM,
      legReachM: b.legReachM,
      massKg: b.fightNightKg,
      weighInKg: b.weighInKg,
      fightNightKg: b.fightNightKg,
      weightClass: b.weightClass ?? weightClassFor(b.weighInKg),
      ageYears: b.ageYears,
      bodyFatPct: b.bodyFatPct,
      build: b.build,
      stance: b.stance,
      handedness: b.handedness ?? 'right',
      dominantLeg: b.handedness ?? 'right',
      sex: 'male',
      // §8.3. The walk-around default reproduces the cut the preset already
      // implies through `weightCut.cutPct`, so the severity floor introduced
      // in §8.3 never exceeds what the archetype was calibrated with.
      naturalWeightKg: input.physique?.naturalWeightKg
        ?? round1(b.weighInKg / (1 - (input.career.weightCut?.cutPct ?? 7) / 100)),
      handStrengthSplit: input.physique?.handStrengthSplit ?? 50,
      limbAsymmetry: input.physique?.limbAsymmetry ?? { armPct: 0, legPct: 0 },
    },
    // Appearance does not affect the simulation; the creator/generator fills it.
    appearance: {
      skinTone: 0.5, hair: 'short', face: 'preset0', tattoos: [],
      shorts: 'mma_short', gloves: 'mma_4oz',
    },
    physical: {
      strength: input.physical.strength,
      explosiveness: input.physical.explosiveness,
      speed: input.physical.speed,
      handSpeed: input.physical.handSpeed,
      kickSpeed: input.physical.kickSpeed,
      cardio: input.physical.cardio,
      chin: input.physical.chin,
      bodyToughness: input.physical.bodyToughness,
      recovery: input.physical.recovery,
      flexibility: input.physical.flexibility,
      balance: input.physical.balance,
      reactionTime: input.physical.reactionTime,
      // Grip is not one of the chapter's fourteen; it tracks strength for
      // presets and the creator may set it independently. [E]
      gripStrength: input.physical.gripStrength ?? Math.round(0.7 * input.physical.strength + 15),
      neckStrength: input.physical.neck,
    },
    disciplines,
    mental: input.mental,
    record,
    history: input.history ?? {
      injuries: [],
      surgeries: 0,
      weightCutHistory: { hardCuts: 0, worstCutPct: input.career.weightCut?.cutPct ?? 7, missedWeight: 0 },
      cardioBackground: { sport: 'none', years: 0 },
    },
    style: {
      primaryMode: style.primaryMode,
      preferredRange: style.preferredRange,
      favouriteTechniques: style.favouriteTechniques.map((t) => ({ techId: resolvePresetId(t.techId), weight: t.weight })),
      favouriteCombos: style.combos.map((c) => ({ ...c, sequence: c.sequence.map(resolvePresetId) })),
      goToSubmissions: style.goToSubmissions.map((s) => ({ subId: resolvePresetId(s.subId), weight: s.weight })),
      takedownPreferences: {
        ...style.takedowns,
        prefs: style.takedowns.prefs.map((t) => ({ techId: resolvePresetId(t.techId), weight: t.weight })),
      },
      whenLosing: LOSING_TO_LEGACY[style.losingBehaviour],
      initiative: style.initiative,
      pressureBias: style.pressureBias,
      fallbackMode: style.fallbackMode,
      bottomPriority: style.bottomPriority ?? ['standUp', 'sweep', 'submit'],
      topPriority: style.topPriority ?? ['control', 'strike', 'pass', 'submit'],
      hurtBehaviour: style.hurtBehaviour,
      losingBehaviour: style.losingBehaviour,
      tiredBehaviour: style.tiredBehaviour,
      stanceSwitching: style.stanceSwitching ?? 10,
      pacing: [],
      guardStyle: style.guardStyle,
      thaiStyle: style.thaiStyle,
    },
  };
}

// Discipline block shorthands — `years`/`sub` are the schema's names for the
// chapter's `yearsTrained`/`native`.
const box = (years: number, q: number, tags: string[], sub: BoxingSkills) => ({ years, trainingQuality: q, styleTags: tags, sub });
const mt = (years: number, q: number, tags: string[], sub: MuayThaiSkills) => ({ years, trainingQuality: q, styleTags: tags, sub });
const kb = (years: number, q: number, tags: string[], sub: KickboxingSkills) => ({ years, trainingQuality: q, styleTags: tags, sub });
const wr = (years: number, q: number, tags: string[], sub: WrestlingSkills) => ({ years, trainingQuality: q, styleTags: tags, sub });
const ju = (years: number, q: number, tags: string[], sub: JudoSkills) => ({ years, trainingQuality: q, styleTags: tags, sub });
const bjj = (years: number, q: number, tags: string[], sub: BjjSkills) => ({ years, trainingQuality: q, styleTags: tags, sub });
const kar = (years: number, q: number, tags: string[], sub: KarateSkills) => ({ years, trainingQuality: q, styleTags: tags, sub });
const sam = (years: number, q: number, tags: string[], sub: SamboSkills) => ({ years, trainingQuality: q, styleTags: tags, sub });
const tkd = (years: number, q: number, tags: string[], sub: TaekwondoSkills) => ({ years, trainingQuality: q, styleTags: tags, sub });
const mma = (years: number, q: number, tags: string[], sub: MmaIntegrationSkills) => ({ years, trainingQuality: q, styleTags: tags, sub });

// --------------------------------------------------------------------------
// §4.1 — §4.15
// --------------------------------------------------------------------------

/** §4.1 "the modern UFC welterweight": wrestling T4, boxing T3, mmaTier T4. */
export const ARCH_ELITE_WRESTLER_BOXER = preset({
  id: 'arch.elite_wrestler_boxer', name: 'Elite Wrestler-Boxer', short: 'EWB',
  depth: {
    wrestling: {
      grade: { system: 'wrestlingCredential', rank: 'wr.allAmerican' },
      competition: { level: 'national', bouts: 150, wins: 128, losses: 22, amateurBouts: 150, amateurWins: 128, bestPlacing: 'nationalPodium', medals: 2 },
      specialisations: ['spec.wr.chain', 'spec.wr.cage'],
    },
    boxing: { grade: { system: 'boxingAmateur', rank: 'box.open' }, specialisations: ['spec.box.outside'] },
    bjj: { grade: { system: 'bjjBelt', rank: 'bjj.brown', stripes: 2 }, specialisations: ['spec.bjj.pressurePassing'] },
    mmaIntegration: { },
  },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 8, worstCutPct: 9, missedWeight: 0 },
    cardioBackground: { sport: 'crossCountry', years: 3 },
  },
  notes: 'The modern UFC welterweight: folkstyle base, functional boxing, cage wrestling.',
  body: { heightM: 1.80, reachM: 1.85, legReachM: 1.04, weighInKg: 77.1, fightNightKg: 84.1, weightClass: 'wc.welterweight', ageYears: 29, bodyFatPct: 8, build: { ecto: 0.15, meso: 0.75, endo: 0.10 }, stance: 'orthodox' },
  physical: { strength: 78, explosiveness: 76, speed: 66, handSpeed: 72, kickSpeed: 55, cardio: 80, chin: 70, bodyToughness: 72, recovery: 74, flexibility: 50, balance: 82, reactionTime: 60, neck: 78 },
  mental: { fightIQ: 78, aggression: 66, composure: 78, heart: 80, discipline: 84, adaptability: 72 },
  disciplines: {
    wrestling: wr(18, 1.15, ['folkstyle'], { shots: 86, takedownDefence: 88, topControl: 84, scrambles: 82, cageWrestling: 84, clinch: 80, chains: 84, finishes: 82, getUps: 80, matReturns: 82 }),
    boxing: box(9, 1.1, [], { jab: 74, power: 74, combinations: 66, headMovement: 60, footwork: 72, guard: 72, bodyWork: 58, counters: 62, feints: 66, ringCraft: 76 }),
    bjj: bjj(8, 1.0, ['no-gi'], { guard: 55, passing: 74, topControl: 80, backControl: 78, chokes: 66, jointLocks: 52, legLocks: 30, escapes: 72, sweeps: 50, subDefence: 78, subAttack: 60, wrestleUps: 84 }),
    mmaIntegration: mma(10, 1.15, [], { levelChanges: 86, clinchStriking: 76, cageWork: 86, groundAndPound: 82, getUps: 82, transitions: 80, subDefenceUnderStrikes: 78, gameplanExecution: 82 }),
  },
  career: {
    pro: { wins: 19, losses: 3, draws: 0, noContests: 0, koWins: 6, subWins: 3, decWins: 10, koLosses: 0, subLosses: 1, decLosses: 2 },
    amateur: { wins: 6, losses: 1 }, titleFights: 1, bigFightComposure: 74, careerKnockdownsAbsorbed: 1, winStreak: 4,
  },
  style: {
    preferredRange: 'mid', initiative: 'pressure', pressureBias: 70, primaryMode: 'wrestleControl', fallbackMode: 'pressureStriking',
    favouriteTechniques: [{ techId: 'tech.jab', weight: 1.4 }, { techId: 'tech.cross', weight: 1.3 }, { techId: 'tech.double_leg', weight: 1.6 }],
    combos: [
      { id: 'combo.jab_cross_double', sequence: ['tech.jab', 'tech.cross', 'tech.double_leg'], weight: 1.5 },
      { id: 'combo.jab_jab_cross', sequence: ['tech.jab', 'tech.jab', 'tech.cross'], weight: 1.2 },
    ],
    goToSubmissions: [{ subId: 'sub.rnc', weight: 1.5 }, { subId: 'sub.arm_triangle', weight: 1.0 }],
    takedowns: { prefs: [{ techId: 'tech.double_leg', weight: 1.5 }, { techId: 'tech.body_lock_td', weight: 1.2 }, { techId: 'tech.single_leg', weight: 1.0 }], setup: 'offCombination', cageBias: 0.8 },
    hurtBehaviour: 'shoot', losingBehaviour: 'stealRound', tiredBehaviour: 'clinchRest', guardStyle: 'highGuard',
  },
});

/** §4.2 "Muay Femur turned MMA lightweight": muayThai T4, grappling T2. */
export const ARCH_THAI_STRIKER = preset({
  id: 'arch.thai_striker', name: 'Thai Striker', short: 'THA',
  depth: {
    muayThai: {
      grade: { system: 'thaiRecord', rank: 'mt.bangkokStadium' },
      competition: { level: 'international', bouts: 84, wins: 66, losses: 18, proBouts: 84, proWins: 66, bestPlacing: 'nationalTitle', medals: 1 },
      specialisations: ['spec.mt.kicking', 'spec.mt.clinch'],
    },
    boxing: { grade: { system: 'boxingAmateur', rank: 'box.novice' } },
    wrestling: { },
    mmaIntegration: { },
  },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 10, worstCutPct: 8, missedWeight: 0 },
    cardioBackground: { sport: 'running', years: 6 },
  },
  notes: 'Muay Femur turned MMA lightweight: elite kicks and clinch, thin ground game.',
  body: { heightM: 1.78, reachM: 1.83, legReachM: 1.05, weighInKg: 70.3, fightNightKg: 76.1, weightClass: 'wc.lightweight', ageYears: 27, bodyFatPct: 8, build: { ecto: 0.45, meso: 0.50, endo: 0.05 }, stance: 'orthodox' },
  physical: { strength: 58, explosiveness: 74, speed: 70, handSpeed: 70, kickSpeed: 86, cardio: 78, chin: 62, bodyToughness: 80, recovery: 70, flexibility: 84, balance: 86, reactionTime: 58, neck: 60 },
  mental: { fightIQ: 66, aggression: 58, composure: 82, heart: 72, discipline: 74, adaptability: 60 },
  disciplines: {
    muayThai: mt(16, 1.15, ['muayFemur'], { kicks: 90, teep: 88, knees: 84, elbows: 82, clinch: 86, checks: 86, catches: 82, hands: 62 }),
    boxing: box(4, 0.9, [], { jab: 58, power: 56, combinations: 52, headMovement: 34, footwork: 56, guard: 62, bodyWork: 44, counters: 50, feints: 60, ringCraft: 52 }),
    wrestling: wr(3, 1.0, [], { shots: 22, takedownDefence: 52, topControl: 30, scrambles: 40, cageWrestling: 44, clinch: 60, chains: 15, finishes: 20, getUps: 50, matReturns: 15 }),
    bjj: bjj(3, 0.9, [], { guard: 40, passing: 30, topControl: 32, backControl: 28, chokes: 34, jointLocks: 30, legLocks: 12, escapes: 44, sweeps: 30, subDefence: 46, subAttack: 28, wrestleUps: 48 }),
    mmaIntegration: mma(4, 1.0, [], { levelChanges: 40, clinchStriking: 82, cageWork: 54, groundAndPound: 40, getUps: 56, transitions: 44, subDefenceUnderStrikes: 48, gameplanExecution: 62 }),
  },
  career: {
    pro: { wins: 12, losses: 4, draws: 0, noContests: 0, koWins: 8, subWins: 0, decWins: 4, koLosses: 0, subLosses: 3, decLosses: 1 },
    // The Thai stadium record is counted as amateur here.
    amateur: { wins: 40, losses: 12 }, titleFights: 0, bigFightComposure: 76, careerKnockdownsAbsorbed: 1, winStreak: 2,
  },
  style: {
    preferredRange: 'long', initiative: 'counter', pressureBias: 35, primaryMode: 'distanceStriking', fallbackMode: 'clinchGrind',
    favouriteTechniques: [{ techId: 'tech.round_kick_body_rear', weight: 1.6 }, { techId: 'tech.teep_lead', weight: 1.5 }, { techId: 'tech.clinch_knee', weight: 1.4 }, { techId: 'tech.elbow_horizontal', weight: 1.2 }],
    combos: [
      { id: 'combo.teep_kick', sequence: ['tech.teep_lead', 'tech.round_kick_body_rear'], weight: 1.4 },
      { id: 'combo.jab_cross_low', sequence: ['tech.jab', 'tech.cross', 'tech.low_kick_rear'], weight: 1.2 },
    ],
    goToSubmissions: [{ subId: 'sub.guillotine_high_elbow', weight: 1.0 }],
    takedowns: { prefs: [{ techId: 'tech.kick_catch_sweep', weight: 1.4 }, { techId: 'tech.inside_trip', weight: 1.0 }], setup: 'offClinch', cageBias: 0.3 },
    hurtBehaviour: 'clinch', losingBehaviour: 'finishSeek', tiredBehaviour: 'retreat', guardStyle: 'longGuard', thaiStyle: 'muayFemur',
  },
});

/** §4.3 "black-belt world medallist, striking still catching up". */
export const ARCH_BJJ_GUARD_PLAYER = preset({
  id: 'arch.bjj_guard_player', name: 'BJJ Guard Player', short: 'BJJ',
  depth: {
    bjj: {
      grade: { system: 'bjjBelt', rank: 'bjj.black', stripes: 1 },
      competition: { level: 'international', bouts: 120, wins: 92, losses: 28, bestPlacing: 'worldMedal', medals: 4 },
      specialisations: ['spec.bjj.guardPlaying', 'spec.bjj.legLocks'],
    },
    judo: { grade: { system: 'judoKyuDan', rank: 'judo.kyu1' }, specialisations: ['spec.ju.newaza'] },
    wrestling: { },
    mmaIntegration: { },
  },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 5, worstCutPct: 8, missedWeight: 0 },
    cardioBackground: { sport: 'none', years: 0 },
  },
  notes: 'Black-belt world medallist; chooses to play guard because the sport instinct says so.',
  body: { heightM: 1.75, reachM: 1.78, legReachM: 1.01, weighInKg: 65.8, fightNightKg: 71.7, weightClass: 'wc.featherweight', ageYears: 31, bodyFatPct: 9, build: { ecto: 0.40, meso: 0.50, endo: 0.10 }, stance: 'southpaw', handedness: 'left' },
  physical: { strength: 55, explosiveness: 58, speed: 56, handSpeed: 48, kickSpeed: 46, cardio: 74, chin: 58, bodyToughness: 64, recovery: 68, flexibility: 90, balance: 74, reactionTime: 52, neck: 56 },
  mental: { fightIQ: 72, aggression: 48, composure: 76, heart: 78, discipline: 70, adaptability: 66 },
  disciplines: {
    bjj: bjj(19, 1.15, ['gi', 'no-gi', 'guardPlayer'], { guard: 96, passing: 84, topControl: 82, backControl: 92, chokes: 92, jointLocks: 90, legLocks: 78, escapes: 92, sweeps: 94, subDefence: 94, subAttack: 94, wrestleUps: 80 }),
    judo: ju(4, 0.8, [], { gripFighting: 46, throws: 38, footSweeps: 42, counters: 40, kuzushi: 40, newaza: 70, ukemi: 66 }),
    wrestling: wr(4, 1.0, [], { shots: 40, takedownDefence: 56, topControl: 60, scrambles: 70, cageWrestling: 44, clinch: 42, chains: 30, finishes: 36, getUps: 66, matReturns: 40 }),
    boxing: box(5, 0.9, [], { jab: 44, power: 38, combinations: 34, headMovement: 30, footwork: 40, guard: 48, bodyWork: 30, counters: 32, feints: 36, ringCraft: 30 }),
    muayThai: mt(2, 0.8, [], { kicks: 30, teep: 28, knees: 34, elbows: 20, clinch: 36, checks: 34, catches: 22, hands: 30 }),
    mmaIntegration: mma(6, 1.0, [], { levelChanges: 46, clinchStriking: 36, cageWork: 56, groundAndPound: 58, getUps: 62, transitions: 72, subDefenceUnderStrikes: 84, gameplanExecution: 64 }),
  },
  career: {
    pro: { wins: 11, losses: 5, draws: 0, noContests: 0, koWins: 0, subWins: 9, decWins: 2, koLosses: 1, subLosses: 0, decLosses: 4 },
    amateur: { wins: 3, losses: 0 }, titleFights: 0, bigFightComposure: 78, careerKnockdownsAbsorbed: 2, winStreak: 1,
  },
  style: {
    preferredRange: 'ground', initiative: 'counter', pressureBias: 40, primaryMode: 'submissionHunt', fallbackMode: 'wrestleControl',
    favouriteTechniques: [{ techId: 'tech.jab', weight: 1.1 }, { techId: 'tech.guard_pull', weight: 1.3 }, { techId: 'tech.single_leg', weight: 1.2 }],
    combos: [{ id: 'combo.jab_shoot', sequence: ['tech.jab', 'tech.single_leg'], weight: 1.3 }],
    goToSubmissions: [{ subId: 'sub.triangle', weight: 1.6 }, { subId: 'sub.rnc', weight: 1.4 }, { subId: 'sub.armbar_guard', weight: 1.3 }, { subId: 'sub.heel_hook_inside', weight: 0.8 }],
    takedowns: { prefs: [{ techId: 'tech.single_leg', weight: 1.2 }, { techId: 'tech.guard_pull', weight: 1.4 }, { techId: 'tech.arm_drag_back', weight: 1.1 }], setup: 'offSingleStrike', cageBias: 0.5 },
    // Inverted on purpose: beh.bjj.mma_bottom_priority does not override it
    // because mmaIntegration.getUps = 62 >= 30. This fighter chooses guard.
    bottomPriority: ['sweep', 'submit', 'standUp'], topPriority: ['pass', 'submit', 'control', 'strike'],
    hurtBehaviour: 'shoot', losingBehaviour: 'gamble', tiredBehaviour: 'clinchRest', guardStyle: 'highGuard',
  },
});

/** §4.4 "Olympic-level judoka, three years into MMA". */
export const ARCH_JUDOKA = preset({
  id: 'arch.judoka', name: 'Olympic Judoka', short: 'JUD',
  depth: {
    judo: {
      grade: { system: 'judoKyuDan', rank: 'judo.sandan' },
      competition: { level: 'international', bouts: 240, wins: 188, losses: 52, bestPlacing: 'olympicMedal', medals: 5 },
      specialisations: ['spec.ju.gripping', 'spec.ju.footSweeps'],
    },
    bjj: { grade: { system: 'bjjBelt', rank: 'bjj.purple', stripes: 3 }, specialisations: ['spec.bjj.pressurePassing'] },
    wrestling: { },
    mmaIntegration: { },
  },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 12, worstCutPct: 10, missedWeight: 0 },
    cardioBackground: { sport: 'none', years: 0 },
  },
  notes: 'Olympic-level judoka three years into MMA: world-class grips and throws, raw hands.',
  body: { heightM: 1.83, reachM: 1.86, legReachM: 1.06, weighInKg: 83.9, fightNightKg: 91.5, weightClass: 'wc.middleweight', ageYears: 30, bodyFatPct: 10, build: { ecto: 0.10, meso: 0.70, endo: 0.20 }, stance: 'orthodox' },
  physical: { strength: 80, explosiveness: 72, speed: 54, handSpeed: 52, kickSpeed: 44, cardio: 70, chin: 64, bodyToughness: 76, recovery: 66, flexibility: 62, balance: 90, reactionTime: 56, neck: 84 },
  mental: { fightIQ: 68, aggression: 62, composure: 80, heart: 82, discipline: 88, adaptability: 56 },
  disciplines: {
    judo: ju(22, 1.15, ['international'], { gripFighting: 94, throws: 95, footSweeps: 92, counters: 90, kuzushi: 94, newaza: 78, ukemi: 96 }),
    bjj: bjj(4, 1.0, ['no-gi'], { guard: 40, passing: 56, topControl: 74, backControl: 58, chokes: 50, jointLocks: 60, legLocks: 14, escapes: 56, sweeps: 36, subDefence: 62, subAttack: 46, wrestleUps: 58 }),
    wrestling: wr(3, 1.0, [], { shots: 30, takedownDefence: 66, topControl: 62, scrambles: 48, cageWrestling: 60, clinch: 70, chains: 24, finishes: 50, getUps: 54, matReturns: 60 }),
    boxing: box(3, 1.0, [], { jab: 44, power: 46, combinations: 36, headMovement: 28, footwork: 40, guard: 50, bodyWork: 30, counters: 30, feints: 34, ringCraft: 38 }),
    mmaIntegration: mma(3, 1.1, [], { levelChanges: 38, clinchStriking: 62, cageWork: 64, groundAndPound: 66, getUps: 52, transitions: 56, subDefenceUnderStrikes: 54, gameplanExecution: 66 }),
  },
  career: {
    pro: { wins: 7, losses: 1, draws: 0, noContests: 0, koWins: 3, subWins: 2, decWins: 2, koLosses: 0, subLosses: 0, decLosses: 1 },
    amateur: { wins: 0, losses: 0 }, titleFights: 0, bigFightComposure: 84, careerKnockdownsAbsorbed: 1, winStreak: 3,
  },
  style: {
    preferredRange: 'clinch', initiative: 'pressure', pressureBias: 68, primaryMode: 'clinchGrind', fallbackMode: 'wrestleControl',
    favouriteTechniques: [{ techId: 'tech.uchi_mata', weight: 1.6 }, { techId: 'tech.osoto_gari', weight: 1.4 }, { techId: 'tech.collar_tie_knee', weight: 1.1 }],
    combos: [
      { id: 'combo.cross_clinch', sequence: ['tech.cross', 'tech.clinch_entry_collar'], weight: 1.4 },
      { id: 'combo.kouchi_uchimata', sequence: ['tech.kouchi_gari', 'tech.uchi_mata'], weight: 1.5 },
    ],
    goToSubmissions: [{ subId: 'sub.kimura', weight: 1.3 }, { subId: 'sub.arm_triangle', weight: 1.1 }],
    takedowns: { prefs: [{ techId: 'tech.uchi_mata', weight: 1.6 }, { techId: 'tech.osoto_gari', weight: 1.4 }, { techId: 'tech.body_lock_td', weight: 1.1 }], setup: 'offClinch', cageBias: 0.7 },
    hurtBehaviour: 'clinch', losingBehaviour: 'unchanged', tiredBehaviour: 'clinchRest', guardStyle: 'highGuard',
  },
});

/** §4.5 "Olympic-style boxer who walks you down". */
export const ARCH_PRESSURE_BOXER = preset({
  id: 'arch.pressure_boxer', name: 'Pressure Boxer', short: 'PBX',
  depth: {
    boxing: {
      grade: { system: 'boxingAmateur', rank: 'box.national' },
      competition: { level: 'national', bouts: 96, wins: 78, losses: 18, amateurBouts: 96, amateurWins: 78, bestPlacing: 'nationalTitle', medals: 2 },
      specialisations: ['spec.box.inside', 'spec.box.power'],
    },
    wrestling: { },
    mmaIntegration: { },
  },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 9, worstCutPct: 9, missedWeight: 1 },
    cardioBackground: { sport: 'running', years: 4 },
  },
  notes: 'Olympic-style boxer who walks you down; heart 86 plus aggression 80 is the brawler-in-trouble profile.',
  body: { heightM: 1.75, reachM: 1.80, legReachM: 1.00, weighInKg: 70.3, fightNightKg: 76.3, weightClass: 'wc.lightweight', ageYears: 28, bodyFatPct: 8, build: { ecto: 0.25, meso: 0.65, endo: 0.10 }, stance: 'orthodox' },
  physical: { strength: 62, explosiveness: 74, speed: 72, handSpeed: 80, kickSpeed: 48, cardio: 84, chin: 76, bodyToughness: 74, recovery: 76, flexibility: 48, balance: 72, reactionTime: 64, neck: 70 },
  mental: { fightIQ: 64, aggression: 80, composure: 72, heart: 86, discipline: 66, adaptability: 54 },
  disciplines: {
    boxing: box(15, 1.15, ['pressure', 'peekaboo'], { jab: 84, power: 84, combinations: 90, headMovement: 80, footwork: 78, guard: 82, bodyWork: 88, counters: 70, feints: 72, ringCraft: 84 }),
    wrestling: wr(5, 1.0, [], { shots: 30, takedownDefence: 66, topControl: 44, scrambles: 50, cageWrestling: 56, clinch: 58, chains: 20, finishes: 28, getUps: 62, matReturns: 26 }),
    bjj: bjj(5, 0.9, [], { guard: 46, passing: 36, topControl: 40, backControl: 34, chokes: 40, jointLocks: 34, legLocks: 10, escapes: 54, sweeps: 34, subDefence: 56, subAttack: 30, wrestleUps: 58 }),
    muayThai: mt(2, 0.8, [], { kicks: 34, teep: 26, knees: 38, elbows: 30, clinch: 40, checks: 40, catches: 20, hands: 84 }),
    mmaIntegration: mma(6, 1.05, [], { levelChanges: 50, clinchStriking: 74, cageWork: 66, groundAndPound: 60, getUps: 66, transitions: 52, subDefenceUnderStrikes: 60, gameplanExecution: 62 }),
  },
  career: {
    pro: { wins: 14, losses: 2, draws: 1, noContests: 0, koWins: 9, subWins: 0, decWins: 5, koLosses: 0, subLosses: 1, decLosses: 1 },
    amateur: { wins: 60, losses: 14 }, titleFights: 0, bigFightComposure: 70, careerKnockdownsAbsorbed: 2, winStreak: 5,
  },
  style: {
    preferredRange: 'short', initiative: 'pressure', pressureBias: 88, primaryMode: 'pressureStriking', fallbackMode: 'clinchGrind',
    favouriteTechniques: [{ techId: 'tech.lead_hook', weight: 1.5 }, { techId: 'tech.body_hook_rear', weight: 1.5 }, { techId: 'tech.uppercut_rear', weight: 1.2 }],
    combos: [
      { id: 'combo.jab_cross_hook_body', sequence: ['tech.jab', 'tech.cross', 'tech.lead_hook', 'tech.body_hook_rear'], weight: 1.6 },
      { id: 'combo.body_head', sequence: ['tech.body_hook_lead', 'tech.lead_hook'], weight: 1.4 },
      { id: 'combo.slip_counter', sequence: ['def.slip_outside', 'tech.cross'], weight: 1.2 },
    ],
    goToSubmissions: [{ subId: 'sub.guillotine_arm_in', weight: 0.8 }],
    takedowns: { prefs: [{ techId: 'tech.body_lock_td', weight: 1.0 }], setup: 'offClinch', cageBias: 0.6 },
    // Deliberately worse than the T4 default (beh.gen.hurt_t4).
    hurtBehaviour: 'trade', losingBehaviour: 'finishSeek', tiredBehaviour: 'gamble', guardStyle: 'peekaboo',
  },
});

/** §4.6 "karate/kickboxing counter puncher, southpaw" — the one T5 striker. */
export const ARCH_COUNTER_STRIKER = preset({
  id: 'arch.counter_striker', name: 'Counter Striker', short: 'CTR',
  depth: {
    karate: {
      grade: { system: 'karateDan', rank: 'kar.nationalSquad' },
      competition: { level: 'international', bouts: 180, wins: 150, losses: 30, bestPlacing: 'continentalMedal', medals: 3 },
      specialisations: ['spec.kar.pointSniping'],
    },
    kickboxing: { },
    boxing: { grade: { system: 'boxingAmateur', rank: 'box.open' } },
    mmaIntegration: { },
  },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 6, worstCutPct: 8, missedWeight: 0 },
    cardioBackground: { sport: 'none', years: 0 },
  },
  notes: 'Karate/kickboxing counter puncher, switch stance, 33 years old: the ageing chin is visible.',
  body: { heightM: 1.88, reachM: 1.96, legReachM: 1.10, weighInKg: 83.9, fightNightKg: 90.6, weightClass: 'wc.middleweight', ageYears: 33, bodyFatPct: 9, build: { ecto: 0.55, meso: 0.40, endo: 0.05 }, stance: 'switch', handedness: 'left' },
  physical: { strength: 60, explosiveness: 78, speed: 80, handSpeed: 82, kickSpeed: 80, cardio: 76, chin: 66, bodyToughness: 60, recovery: 66, flexibility: 80, balance: 84, reactionTime: 70, neck: 62 },
  mental: { fightIQ: 82, aggression: 36, composure: 86, heart: 62, discipline: 78, adaptability: 80 },
  disciplines: {
    karate: kar(24, 1.15, ['kyokushin-point hybrid'], { distanceControl: 94, blitz: 88, kicks: 84, counters: 92, footwork: 92, timing: 94 }),
    kickboxing: kb(10, 1.1, [], { punches: 78, kicks: 82, lowKicks: 72, combinations: 66, footwork: 88, checks: 74, spinning: 80, defence: 84 }),
    boxing: box(6, 1.0, [], { jab: 76, power: 68, combinations: 58, headMovement: 78, footwork: 86, guard: 60, bodyWork: 50, counters: 88, feints: 90, ringCraft: 80 }),
    wrestling: wr(6, 1.0, [], { shots: 26, takedownDefence: 76, topControl: 40, scrambles: 56, cageWrestling: 58, clinch: 48, chains: 16, finishes: 26, getUps: 70, matReturns: 20 }),
    bjj: bjj(6, 0.9, [], { guard: 56, passing: 34, topControl: 38, backControl: 30, chokes: 44, jointLocks: 36, legLocks: 16, escapes: 60, sweeps: 40, subDefence: 62, subAttack: 30, wrestleUps: 66 }),
    mmaIntegration: mma(9, 1.1, [], { levelChanges: 44, clinchStriking: 50, cageWork: 78, groundAndPound: 46, getUps: 74, transitions: 56, subDefenceUnderStrikes: 64, gameplanExecution: 84 }),
  },
  career: {
    pro: { wins: 21, losses: 6, draws: 0, noContests: 1, koWins: 11, subWins: 1, decWins: 9, koLosses: 1, subLosses: 2, decLosses: 3 },
    amateur: { wins: 10, losses: 2 }, titleFights: 2, bigFightComposure: 84, careerKnockdownsAbsorbed: 3, winStreak: 1,
    stanceExposure: { orthodox: 22, southpaw: 6 },
  },
  style: {
    preferredRange: 'long', initiative: 'counter', pressureBias: 18, primaryMode: 'counter', fallbackMode: 'distanceStriking',
    favouriteTechniques: [{ techId: 'tech.cross', weight: 1.4 }, { techId: 'tech.front_kick_body', weight: 1.3 }, { techId: 'tech.round_kick_head_lead', weight: 1.2 }, { techId: 'tech.spinning_back_kick', weight: 1.0 }],
    combos: [
      { id: 'combo.pull_cross', sequence: ['def.pull', 'tech.cross'], weight: 1.6 },
      { id: 'combo.blitz', sequence: ['tech.blitz_step', 'tech.jab', 'tech.cross'], weight: 1.3 },
      { id: 'combo.feint_feint_cross', sequence: ['tech.feint_jab', 'tech.feint_level', 'tech.cross'], weight: 1.4 },
    ],
    goToSubmissions: [{ subId: 'sub.guillotine_high_elbow', weight: 0.8 }],
    takedowns: { prefs: [{ techId: 'tech.single_leg', weight: 0.8 }], setup: 'reactive', cageBias: 0.2 },
    hurtBehaviour: 'circleOut', losingBehaviour: 'stealRound', tiredBehaviour: 'retreat', stanceSwitching: 80, guardStyle: 'longGuard',
  },
});

/** §4.7 "big guy from the bar, never trained" — every discipline T0. */
export const ARCH_BRAND_NEW_BRAWLER = preset({
  id: 'arch.brand_new_brawler', name: 'Brand New Brawler', short: 'BNB',
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 0, worstCutPct: 0, missedWeight: 0 },
    cardioBackground: { sport: 'none', years: 0 },
  },
  notes: 'Never trained. Every T0 tell in the catalogue fires: eyes shut, turns away, football tackle, no tap.',
  body: { heightM: 1.84, reachM: 1.86, legReachM: 1.04, weighInKg: 95, fightNightKg: 95, weightClass: 'wc.cruiserweight', ageYears: 24, bodyFatPct: 22, build: { ecto: 0.10, meso: 0.35, endo: 0.55 }, stance: 'orthodox' },
  physical: { strength: 38, explosiveness: 35, speed: 32, handSpeed: 42, kickSpeed: 30, cardio: 26, chin: 50, bodyToughness: 48, recovery: 36, flexibility: 30, balance: 34, reactionTime: 48, neck: 46 },
  mental: { fightIQ: 20, aggression: 82, composure: 24, heart: 55, discipline: 20, adaptability: 30 },
  disciplines: {},
  career: {
    pro: { wins: 0, losses: 0, draws: 0, noContests: 0, koWins: 0, subWins: 0, decWins: 0, koLosses: 0, subLosses: 0, decLosses: 0 },
    amateur: { wins: 0, losses: 0 }, titleFights: 0, bigFightComposure: 15, careerKnockdownsAbsorbed: 0, winStreak: 0,
    lastResult: 'none', daysSinceLastBout: 0, weightCut: { cutPct: 0, regainPct: 0, residualDehydration: 0 },
  },
  style: {
    preferredRange: 'short', initiative: 'pressure', pressureBias: 90, primaryMode: 'pressureStriking', fallbackMode: 'clinchGrind',
    favouriteTechniques: [{ techId: 'tech.overhand_rear', weight: 2.0 }, { techId: 'tech.lead_hook', weight: 1.5 }, { techId: 'tech.grab_push', weight: 1.4 }, { techId: 'tech.headlock', weight: 1.3 }],
    combos: [{ id: 'combo.wild_three', sequence: ['tech.overhand_rear', 'tech.lead_hook', 'tech.overhand_rear'], weight: 1.5 }],
    goToSubmissions: [{ subId: 'sub.headlock_squeeze', weight: 1.0 }],
    takedowns: { prefs: [{ techId: 'tech.tackle', weight: 1.5 }], setup: 'naked', cageBias: 0.0 },
    hurtBehaviour: 'turnAway', losingBehaviour: 'gamble', tiredBehaviour: 'gamble', guardStyle: 'highGuard',
  },
});

/** §4.8 "six months of boxing and BJJ, trains four days a week". */
export const ARCH_GYM_FIT_BEGINNER = preset({
  id: 'arch.gym_fit_beginner', name: 'Gym-Fit Beginner', short: 'GFB',
  depth: {
    boxing: { grade: { system: 'boxingAmateur', rank: 'box.novice' } },
    bjj: { grade: { system: 'bjjBelt', rank: 'bjj.white', stripes: 2 } },
  },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 0, worstCutPct: 3, missedWeight: 0 },
    cardioBackground: { sport: 'cycling', years: 5 },
  },
  notes: 'Six months in: knows the names, taps late, drops the hands after every punch.',
  body: { heightM: 1.78, reachM: 1.80, legReachM: 1.02, weighInKg: 79, fightNightKg: 79, weightClass: 'wc.super_welterweight', ageYears: 26, bodyFatPct: 14, build: { ecto: 0.30, meso: 0.55, endo: 0.15 }, stance: 'orthodox' },
  physical: { strength: 52, explosiveness: 50, speed: 50, handSpeed: 46, kickSpeed: 40, cardio: 58, chin: 50, bodyToughness: 50, recovery: 54, flexibility: 46, balance: 44, reactionTime: 50, neck: 48 },
  mental: { fightIQ: 32, aggression: 52, composure: 34, heart: 58, discipline: 60, adaptability: 40 },
  disciplines: {
    boxing: box(0.5, 0.8, [], { jab: 18, power: 14, combinations: 14, headMovement: 10, footwork: 14, guard: 20, bodyWork: 10, counters: 8, feints: 6, ringCraft: 8 }),
    bjj: bjj(0.5, 0.8, ['gi'], { guard: 16, passing: 12, topControl: 12, backControl: 10, chokes: 14, jointLocks: 12, legLocks: 4, escapes: 14, sweeps: 12, subDefence: 16, subAttack: 12, wrestleUps: 10 }),
    mmaIntegration: mma(0, 0.8, [], { levelChanges: 6, clinchStriking: 6, cageWork: 5, groundAndPound: 6, getUps: 8, transitions: 5, subDefenceUnderStrikes: 8, gameplanExecution: 8 }),
  },
  career: {
    pro: { wins: 0, losses: 0, draws: 0, noContests: 0, koWins: 0, subWins: 0, decWins: 0, koLosses: 0, subLosses: 0, decLosses: 0 },
    amateur: { wins: 0, losses: 0 }, titleFights: 0, bigFightComposure: 20, careerKnockdownsAbsorbed: 0, winStreak: 0,
    lastResult: 'none', daysSinceLastBout: 0, weightCut: { cutPct: 0, regainPct: 0, residualDehydration: 0 },
  },
  style: {
    preferredRange: 'mid', initiative: 'balanced', pressureBias: 50, primaryMode: 'distanceStriking', fallbackMode: 'clinchGrind',
    favouriteTechniques: [{ techId: 'tech.jab', weight: 1.3 }, { techId: 'tech.cross', weight: 1.3 }],
    combos: [
      { id: 'combo.one_two', sequence: ['tech.jab', 'tech.cross'], weight: 1.5 },
      { id: 'combo.one_two_three', sequence: ['tech.jab', 'tech.cross', 'tech.lead_hook'], weight: 1.0 },
    ],
    goToSubmissions: [{ subId: 'sub.rnc', weight: 1.0 }, { subId: 'sub.armbar_guard', weight: 0.8 }],
    takedowns: { prefs: [{ techId: 'tech.double_leg', weight: 1.0 }], setup: 'naked', cageBias: 0.1 },
    hurtBehaviour: 'coverOnCage', losingBehaviour: 'unchanged', tiredBehaviour: 'retreat', guardStyle: 'highGuard',
  },
});

/** §4.9 "8-3 on the regional circuit" — the T3 vs T3 reference fighter. */
export const ARCH_REGIONAL_PRO_ALLROUNDER = preset({
  id: 'arch.regional_pro_allrounder', name: 'Regional Pro All-Rounder', short: 'RPA',
  depth: {
    boxing: { grade: { system: 'boxingAmateur', rank: 'box.regional' } },
    muayThai: { },
    wrestling: {
      grade: { system: 'wrestlingCredential', rank: 'wr.statePlacer' },
      competition: { level: 'local', bouts: 60, wins: 42, losses: 18, amateurBouts: 60, amateurWins: 42, bestPlacing: 'localPodium' },
      specialisations: ['spec.wr.cage'],
    },
    bjj: { grade: { system: 'bjjBelt', rank: 'bjj.purple' }, specialisations: ['spec.bjj.defensive'] },
    mmaIntegration: { },
  },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 4, worstCutPct: 8, missedWeight: 0 },
    cardioBackground: { sport: 'football', years: 8 },
  },
  notes: 'The T3 vs T3 reference fighter for the tier-prior rows of FD §5 and calibration hook C-1.',
  body: { heightM: 1.80, reachM: 1.84, legReachM: 1.03, weighInKg: 77.1, fightNightKg: 83.4, weightClass: 'wc.welterweight', ageYears: 27, bodyFatPct: 9, build: { ecto: 0.25, meso: 0.60, endo: 0.15 }, stance: 'orthodox' },
  physical: { strength: 58, explosiveness: 58, speed: 56, handSpeed: 58, kickSpeed: 56, cardio: 62, chin: 58, bodyToughness: 58, recovery: 58, flexibility: 54, balance: 58, reactionTime: 54, neck: 56 },
  mental: { fightIQ: 52, aggression: 58, composure: 54, heart: 66, discipline: 58, adaptability: 50 },
  disciplines: {
    boxing: box(6, 1.0, [], { jab: 60, power: 58, combinations: 56, headMovement: 50, footwork: 56, guard: 60, bodyWork: 50, counters: 50, feints: 48, ringCraft: 52 }),
    muayThai: mt(6, 1.0, [], { kicks: 60, teep: 54, knees: 56, elbows: 50, clinch: 54, checks: 56, catches: 46, hands: 58 }),
    wrestling: wr(6, 1.0, ['folkstyle'], { shots: 58, takedownDefence: 62, topControl: 58, scrambles: 56, cageWrestling: 60, clinch: 56, chains: 50, finishes: 54, getUps: 58, matReturns: 52 }),
    bjj: bjj(6, 1.0, ['no-gi'], { guard: 56, passing: 56, topControl: 58, backControl: 56, chokes: 58, jointLocks: 52, legLocks: 34, escapes: 60, sweeps: 50, subDefence: 62, subAttack: 54, wrestleUps: 58 }),
    mmaIntegration: mma(6, 1.0, [], { levelChanges: 58, clinchStriking: 58, cageWork: 60, groundAndPound: 60, getUps: 58, transitions: 56, subDefenceUnderStrikes: 60, gameplanExecution: 56 }),
  },
  career: {
    pro: { wins: 8, losses: 3, draws: 0, noContests: 0, koWins: 3, subWins: 2, decWins: 3, koLosses: 1, subLosses: 1, decLosses: 1 },
    amateur: { wins: 5, losses: 2 }, titleFights: 0, bigFightComposure: 46, careerKnockdownsAbsorbed: 2, winStreak: 2,
  },
  style: {
    preferredRange: 'mid', initiative: 'balanced', pressureBias: 55, primaryMode: 'pressureStriking', fallbackMode: 'wrestleControl',
    favouriteTechniques: [{ techId: 'tech.jab', weight: 1.2 }, { techId: 'tech.low_kick_rear', weight: 1.3 }, { techId: 'tech.double_leg', weight: 1.1 }],
    combos: [{ id: 'combo.jab_cross_low', sequence: ['tech.jab', 'tech.cross', 'tech.low_kick_rear'], weight: 1.4 }],
    goToSubmissions: [{ subId: 'sub.rnc', weight: 1.4 }, { subId: 'sub.guillotine_high_elbow', weight: 1.0 }],
    takedowns: { prefs: [{ techId: 'tech.double_leg', weight: 1.2 }, { techId: 'tech.body_lock_td', weight: 1.0 }], setup: 'offSingleStrike', cageBias: 0.6 },
    hurtBehaviour: 'clinch', losingBehaviour: 'stealRound', tiredBehaviour: 'clinchRest', guardStyle: 'highGuard',
  },
});

/** §4.10 "former champion at 38, chin gone, brain intact" — calibration C-3. */
export const ARCH_AGEING_VETERAN = preset({
  id: 'arch.ageing_veteran', name: 'Ageing Veteran', short: 'VET',
  depth: {
    boxing: { grade: { system: 'boxingAmateur', rank: 'box.national' } },
    wrestling: {
      grade: { system: 'wrestlingCredential', rank: 'wr.ncaaD1' },
      competition: { level: 'national', bouts: 130, wins: 96, losses: 34, amateurBouts: 130, amateurWins: 96, bestPlacing: 'nationalPodium' },
      specialisations: ['spec.wr.matReturns'],
    },
    bjj: { grade: { system: 'bjjBelt', rank: 'bjj.black' }, specialisations: ['spec.bjj.defensive'] },
    muayThai: { monthsSinceTrained: 30 },
    mmaIntegration: { },
  },
  history: {
    // The one preset that carries its career on it. Every entry is old and
    // decayed; what still bites is the residue the two reconstructions and the
    // recurrent hand leave behind, which is the point of the archetype.
    injuries: [
      { region: 'knee', severity: 70, monthsAgo: 60, surgery: true },
      { region: 'shoulder', severity: 60, monthsAgo: 44, surgery: true },
      { region: 'hand', severity: 45, monthsAgo: 28, recurrent: true },
    ],
    surgeries: 2,
    weightCutHistory: { hardCuts: 18, worstCutPct: 11, missedWeight: 1 },
    cardioBackground: { sport: 'none', years: 0 },
  },
  notes: 'Former champion at 38: chinEff ~32 after age and KO history, skills and IQ untouched. Calibration archetype C-3.',
  body: { heightM: 1.88, reachM: 1.93, legReachM: 1.08, weighInKg: 93.0, fightNightKg: 101.0, weightClass: 'wc.light_heavyweight', ageYears: 38, bodyFatPct: 12, build: { ecto: 0.15, meso: 0.65, endo: 0.20 }, stance: 'orthodox' },
  physical: { strength: 74, explosiveness: 60, speed: 52, handSpeed: 66, kickSpeed: 54, cardio: 62, chin: 78, bodyToughness: 80, recovery: 50, flexibility: 42, balance: 74, reactionTime: 56, neck: 80 },
  mental: { fightIQ: 86, aggression: 50, composure: 90, heart: 88, discipline: 80, adaptability: 78 },
  disciplines: {
    boxing: box(20, 1.15, [], { jab: 84, power: 80, combinations: 74, headMovement: 70, footwork: 66, guard: 82, bodyWork: 70, counters: 84, feints: 86, ringCraft: 88 }),
    wrestling: wr(16, 1.1, ['greco'], { shots: 62, takedownDefence: 84, topControl: 80, scrambles: 66, cageWrestling: 88, clinch: 88, chains: 62, finishes: 70, getUps: 74, matReturns: 78 }),
    bjj: bjj(14, 1.0, ['no-gi'], { guard: 62, passing: 74, topControl: 80, backControl: 76, chokes: 72, jointLocks: 68, legLocks: 30, escapes: 78, sweeps: 52, subDefence: 86, subAttack: 66, wrestleUps: 74 }),
    muayThai: mt(8, 1.0, [], { kicks: 60, teep: 62, knees: 76, elbows: 78, clinch: 74, checks: 70, catches: 56, hands: 80 }),
    mmaIntegration: mma(18, 1.15, [], { levelChanges: 78, clinchStriking: 88, cageWork: 90, groundAndPound: 84, getUps: 76, transitions: 74, subDefenceUnderStrikes: 84, gameplanExecution: 90 }),
  },
  career: {
    pro: { wins: 28, losses: 9, draws: 0, noContests: 0, koWins: 14, subWins: 6, decWins: 8, koLosses: 4, subLosses: 1, decLosses: 4 },
    amateur: { wins: 4, losses: 1 }, titleFights: 6, bigFightComposure: 92, careerKnockdownsAbsorbed: 8, winStreak: 0,
    // 240 d after a KO loss: the layoff penalty applies, the < 60 d rule does not.
    lastResult: 'loss', lastResultWasKoLoss: true, daysSinceLastBout: 240,
    stanceExposure: { orthodox: 28, southpaw: 9 },
  },
  style: {
    preferredRange: 'clinch', initiative: 'counter', pressureBias: 40, primaryMode: 'clinchGrind', fallbackMode: 'counter',
    favouriteTechniques: [{ techId: 'tech.jab', weight: 1.3 }, { techId: 'tech.clinch_elbow', weight: 1.4 }, { techId: 'tech.body_lock_td', weight: 1.3 }],
    combos: [
      { id: 'combo.jab_clinch', sequence: ['tech.jab', 'tech.clinch_entry_underhook'], weight: 1.4 },
      { id: 'combo.check_hook', sequence: ['def.pivot', 'tech.check_hook'], weight: 1.2 },
    ],
    goToSubmissions: [{ subId: 'sub.arm_triangle', weight: 1.3 }, { subId: 'sub.rnc', weight: 1.2 }],
    takedowns: { prefs: [{ techId: 'tech.body_lock_td', weight: 1.5 }, { techId: 'tech.inside_trip', weight: 1.2 }], setup: 'offClinch', cageBias: 0.9 },
    hurtBehaviour: 'clinch', losingBehaviour: 'stealRound', tiredBehaviour: 'clinchRest', guardStyle: 'highGuard',
  },
});

/** §4.11 "one-punch heavyweight, 118 kg, two-round gas tank". */
export const ARCH_HEAVYWEIGHT_POWER_PUNCHER = preset({
  id: 'arch.heavyweight_power_puncher', name: 'Heavyweight Power Puncher', short: 'HWP',
  depth: {
    boxing: { grade: { system: 'boxingAmateur', rank: 'box.regional' }, specialisations: ['spec.box.power'] },
    kickboxing: { },
    mmaIntegration: { },
  },
  physique: { handStrengthSplit: 78 },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 0, worstCutPct: 4, missedWeight: 0 },
    cardioBackground: { sport: 'none', years: 0 },
  },
  notes: 'Highest rearHand of the presets by mass, not skill; expected to lead KD-per-landed-power-strike both dealt and absorbed.',
  body: { heightM: 1.93, reachM: 2.01, legReachM: 1.12, weighInKg: 117.0, fightNightKg: 118.0, weightClass: 'wc.heavyweight', ageYears: 31, bodyFatPct: 18, build: { ecto: 0.05, meso: 0.55, endo: 0.40 }, stance: 'orthodox' },
  physical: { strength: 82, explosiveness: 70, speed: 40, handSpeed: 64, kickSpeed: 42, cardio: 38, chin: 62, bodyToughness: 66, recovery: 44, flexibility: 34, balance: 56, reactionTime: 50, neck: 86 },
  mental: { fightIQ: 48, aggression: 74, composure: 60, heart: 64, discipline: 46, adaptability: 44 },
  disciplines: {
    boxing: box(10, 1.0, [], { jab: 56, power: 84, combinations: 48, headMovement: 40, footwork: 42, guard: 54, bodyWork: 44, counters: 58, feints: 46, ringCraft: 50 }),
    kickboxing: kb(4, 0.9, [], { punches: 80, kicks: 40, lowKicks: 52, combinations: 44, footwork: 40, checks: 38, spinning: 10, defence: 46 }),
    wrestling: wr(5, 0.9, [], { shots: 30, takedownDefence: 58, topControl: 56, scrambles: 34, cageWrestling: 60, clinch: 58, chains: 20, finishes: 36, getUps: 44, matReturns: 40 }),
    bjj: bjj(5, 0.8, [], { guard: 30, passing: 40, topControl: 52, backControl: 34, chokes: 36, jointLocks: 30, legLocks: 8, escapes: 40, sweeps: 24, subDefence: 46, subAttack: 26, wrestleUps: 40 }),
    mmaIntegration: mma(7, 1.0, [], { levelChanges: 34, clinchStriking: 62, cageWork: 56, groundAndPound: 70, getUps: 44, transitions: 38, subDefenceUnderStrikes: 44, gameplanExecution: 44 }),
  },
  career: {
    pro: { wins: 15, losses: 5, draws: 0, noContests: 0, koWins: 13, subWins: 0, decWins: 2, koLosses: 2, subLosses: 1, decLosses: 2 },
    amateur: { wins: 2, losses: 1 }, titleFights: 0, bigFightComposure: 52, careerKnockdownsAbsorbed: 4, winStreak: 3,
    weightCut: { cutPct: 1, regainPct: 1, residualDehydration: 0 },
  },
  style: {
    preferredRange: 'mid', initiative: 'pressure', pressureBias: 62, primaryMode: 'pressureStriking', fallbackMode: 'clinchGrind',
    favouriteTechniques: [{ techId: 'tech.overhand_rear', weight: 1.7 }, { techId: 'tech.lead_hook', weight: 1.4 }, { techId: 'tech.uppercut_rear', weight: 1.2 }, { techId: 'tech.jab', weight: 0.9 }],
    combos: [
      { id: 'combo.jab_overhand', sequence: ['tech.jab', 'tech.overhand_rear'], weight: 1.5 },
      { id: 'combo.hook_cross', sequence: ['tech.lead_hook', 'tech.cross'], weight: 1.2 },
    ],
    goToSubmissions: [],
    takedowns: { prefs: [{ techId: 'tech.body_lock_td', weight: 1.0 }], setup: 'offClinch', cageBias: 0.7 },
    hurtBehaviour: 'trade', losingBehaviour: 'finishSeek', tiredBehaviour: 'gamble', guardStyle: 'highGuard',
  },
});
// The two-round gas tank is authored as an explicit per-round pacing override.
ARCH_HEAVYWEIGHT_POWER_PUNCHER.style.pacing = [
  { round: 1, outputMult: 1.15, riskAppetite: 0.8 },
  { round: 2, outputMult: 0.9, riskAppetite: 0.7 },
  { round: 3, outputMult: 0.7, riskAppetite: 0.9 },
];

/** §4.12 "8 significant strikes a minute, never stops moving". */
export const ARCH_FLYWEIGHT_VOLUME_STRIKER = preset({
  id: 'arch.flyweight_volume_striker', name: 'Flyweight Volume Striker', short: 'FVS',
  depth: {
    kickboxing: {
      grade: { system: 'thaiRecord', rank: 'mt.provincial' },
      competition: { level: 'national', bouts: 40, wins: 32, losses: 8, proBouts: 40, proWins: 32, bestPlacing: 'nationalPodium' },
      specialisations: ['spec.kb.volume', 'spec.kb.lowKicks'],
    },
    boxing: { },
    wrestling: { },
    mmaIntegration: { },
  },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 0, worstCutPct: 10, missedWeight: 0 },
    cardioBackground: { sport: 'none', years: 0 },
  },
  notes: 'Dutch-style volume: light but technically sharp, ~8-9 significant attempts a minute.',
  body: { heightM: 1.65, reachM: 1.68, legReachM: 0.94, weighInKg: 56.7, fightNightKg: 61.9, weightClass: 'wc.flyweight', ageYears: 26, bodyFatPct: 7, build: { ecto: 0.45, meso: 0.50, endo: 0.05 }, stance: 'switch' },
  physical: { strength: 44, explosiveness: 80, speed: 92, handSpeed: 88, kickSpeed: 84, cardio: 92, chin: 64, bodyToughness: 62, recovery: 86, flexibility: 78, balance: 82, reactionTime: 72, neck: 48 },
  mental: { fightIQ: 66, aggression: 70, composure: 74, heart: 76, discipline: 72, adaptability: 68 },
  disciplines: {
    kickboxing: kb(12, 1.1, ['dutch'], { punches: 76, kicks: 80, lowKicks: 84, combinations: 90, footwork: 92, checks: 76, spinning: 62, defence: 74 }),
    boxing: box(6, 1.0, [], { jab: 78, power: 56, combinations: 84, headMovement: 66, footwork: 90, guard: 62, bodyWork: 64, counters: 62, feints: 72, ringCraft: 70 }),
    wrestling: wr(6, 1.0, ['freestyle'], { shots: 48, takedownDefence: 74, topControl: 46, scrambles: 70, cageWrestling: 58, clinch: 52, chains: 40, finishes: 44, getUps: 78, matReturns: 34 }),
    bjj: bjj(6, 0.9, [], { guard: 60, passing: 44, topControl: 44, backControl: 50, chokes: 54, jointLocks: 40, legLocks: 20, escapes: 70, sweeps: 52, subDefence: 66, subAttack: 40, wrestleUps: 76 }),
    mmaIntegration: mma(7, 1.05, [], { levelChanges: 60, clinchStriking: 58, cageWork: 70, groundAndPound: 52, getUps: 78, transitions: 66, subDefenceUnderStrikes: 64, gameplanExecution: 66 }),
  },
  career: {
    pro: { wins: 13, losses: 3, draws: 0, noContests: 0, koWins: 3, subWins: 2, decWins: 8, koLosses: 0, subLosses: 1, decLosses: 2 },
    amateur: { wins: 9, losses: 2 }, titleFights: 0, bigFightComposure: 66, careerKnockdownsAbsorbed: 1, winStreak: 3,
  },
  style: {
    preferredRange: 'long', initiative: 'pressure', pressureBias: 72, primaryMode: 'distanceStriking', fallbackMode: 'pressureStriking',
    favouriteTechniques: [{ techId: 'tech.jab', weight: 1.4 }, { techId: 'tech.low_kick_rear', weight: 1.4 }, { techId: 'tech.calf_kick', weight: 1.3 }, { techId: 'tech.switch_kick_body', weight: 1.2 }],
    combos: [
      { id: 'combo.dutch_1', sequence: ['tech.jab', 'tech.cross', 'tech.lead_hook', 'tech.low_kick_rear'], weight: 1.6 },
      { id: 'combo.dutch_2', sequence: ['tech.cross', 'tech.lead_hook', 'tech.round_kick_body_rear'], weight: 1.4 },
      { id: 'combo.jab_jab_switch', sequence: ['tech.jab', 'tech.jab', 'tech.switch_kick_body'], weight: 1.2 },
    ],
    goToSubmissions: [{ subId: 'sub.rnc', weight: 1.2 }],
    takedowns: { prefs: [{ techId: 'tech.double_leg', weight: 0.8 }], setup: 'offCombination', cageBias: 0.4 },
    hurtBehaviour: 'circleOut', losingBehaviour: 'stealRound', tiredBehaviour: 'coast', stanceSwitching: 60, guardStyle: 'hybrid', thaiStyle: 'dutch',
  },
});

/** §4.13 "combat sambo master of sport, lightweight". */
export const ARCH_SAMBO_GRAPPLER = preset({
  id: 'arch.sambo_grappler', name: 'Sambo Grappler', short: 'SAM',
  depth: {
    sambo: {
      grade: { system: 'samboRank', rank: 'sam.internationalMaster' },
      competition: { level: 'international', bouts: 160, wins: 130, losses: 30, bestPlacing: 'worldMedal', medals: 3 },
      specialisations: ['spec.sam.combat', 'spec.sam.legLocks'],
    },
    wrestling: { grade: { system: 'wrestlingCredential', rank: 'wr.statePlacer' } },
    judo: { grade: { system: 'judoKyuDan', rank: 'judo.kyu1' } },
    bjj: { grade: { system: 'bjjBelt', rank: 'bjj.purple' } },
    mmaIntegration: { },
  },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 7, worstCutPct: 9, missedWeight: 0 },
    cardioBackground: { sport: 'none', years: 0 },
  },
  notes: 'Combat sambo master of sport: throws into ground-and-pound, cage-heavy, 9-fight win streak.',
  body: { heightM: 1.75, reachM: 1.78, legReachM: 1.00, weighInKg: 70.3, fightNightKg: 76.3, weightClass: 'wc.lightweight', ageYears: 28, bodyFatPct: 8, build: { ecto: 0.15, meso: 0.75, endo: 0.10 }, stance: 'orthodox' },
  physical: { strength: 72, explosiveness: 70, speed: 60, handSpeed: 56, kickSpeed: 50, cardio: 82, chin: 66, bodyToughness: 78, recovery: 78, flexibility: 56, balance: 86, reactionTime: 56, neck: 76 },
  mental: { fightIQ: 70, aggression: 72, composure: 84, heart: 84, discipline: 86, adaptability: 58 },
  disciplines: {
    sambo: sam(20, 1.15, ['combat'], { throws: 90, takedowns: 88, legLocks: 74, gripFighting: 86, topControl: 90, transitions: 84, strikingToGrappling: 88 }),
    wrestling: wr(8, 1.05, ['freestyle'], { shots: 74, takedownDefence: 84, topControl: 86, scrambles: 76, cageWrestling: 86, clinch: 82, chains: 78, finishes: 80, getUps: 74, matReturns: 84 }),
    judo: ju(6, 1.0, [], { gripFighting: 70, throws: 74, footSweeps: 66, counters: 62, kuzushi: 68, newaza: 56, ukemi: 80 }),
    bjj: bjj(6, 1.0, ['no-gi'], { guard: 44, passing: 68, topControl: 84, backControl: 72, chokes: 62, jointLocks: 66, legLocks: 70, escapes: 66, sweeps: 40, subDefence: 76, subAttack: 62, wrestleUps: 70 }),
    boxing: box(5, 1.0, [], { jab: 50, power: 54, combinations: 40, headMovement: 34, footwork: 44, guard: 56, bodyWork: 36, counters: 40, feints: 44, ringCraft: 46 }),
    mmaIntegration: mma(7, 1.15, [], { levelChanges: 84, clinchStriking: 72, cageWork: 88, groundAndPound: 86, getUps: 70, transitions: 82, subDefenceUnderStrikes: 74, gameplanExecution: 78 }),
  },
  career: {
    pro: { wins: 16, losses: 1, draws: 0, noContests: 0, koWins: 5, subWins: 6, decWins: 5, koLosses: 0, subLosses: 0, decLosses: 1 },
    amateur: { wins: 30, losses: 6 }, titleFights: 0, bigFightComposure: 80, careerKnockdownsAbsorbed: 0, winStreak: 9,
  },
  style: {
    preferredRange: 'clinch', initiative: 'pressure', pressureBias: 78, primaryMode: 'wrestleControl', fallbackMode: 'clinchGrind',
    favouriteTechniques: [{ techId: 'tech.overhand_rear', weight: 1.3 }, { techId: 'tech.single_leg', weight: 1.4 }, { techId: 'tech.body_lock_td', weight: 1.4 }, { techId: 'tech.gnp_cross', weight: 1.4 }],
    combos: [
      { id: 'combo.overhand_shoot', sequence: ['tech.overhand_rear', 'tech.double_leg'], weight: 1.5 },
      { id: 'combo.cage_trip', sequence: ['tech.clinch_entry_underhook', 'tech.inside_trip'], weight: 1.4 },
    ],
    goToSubmissions: [{ subId: 'sub.rnc', weight: 1.3 }, { subId: 'sub.kimura', weight: 1.2 }, { subId: 'sub.knee_bar', weight: 0.9 }],
    takedowns: { prefs: [{ techId: 'tech.single_leg', weight: 1.4 }, { techId: 'tech.body_lock_td', weight: 1.4 }, { techId: 'tech.inside_trip', weight: 1.2 }, { techId: 'tech.double_leg', weight: 1.0 }], setup: 'offSingleStrike', cageBias: 0.9 },
    hurtBehaviour: 'shoot', losingBehaviour: 'unchanged', tiredBehaviour: 'clinchRest', guardStyle: 'highGuard',
  },
});

/** §4.14 the legacy Athlete A with creator-spread sub-skills. */
export const ARCH_TKD_CONVERT = preset({
  id: 'arch.tkd_convert', name: 'TKD Convert', short: 'TKD',
  depth: {
    taekwondo: {
      grade: { system: 'taekwondoDan', rank: 'tkd.sam_dan' },
      competition: { level: 'national', bouts: 110, wins: 88, losses: 22, bestPlacing: 'nationalPodium', medals: 2 },
      specialisations: ['spec.tkd.headHunting', 'spec.tkd.footwork'],
    },
    boxing: { },
  },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 1, worstCutPct: 6, missedWeight: 0 },
    cardioBackground: { sport: 'running', years: 3 },
  },
  notes: 'legacy.toFighter(ATHLETE_A) with creator-spread sub-skills: competent striking, zero ground game.',
  body: { heightM: 1.778, reachM: 1.824, legReachM: 1.022, weighInKg: 90.7, fightNightKg: 90.7, weightClass: 'wc.super_middleweight', ageYears: 20, bodyFatPct: 12, build: { ecto: 0.20, meso: 0.62, endo: 0.18 }, stance: 'orthodox' },
  physical: { strength: 74, explosiveness: 64, speed: 57, handSpeed: 54, kickSpeed: 62, cardio: 70, chin: 50, bodyToughness: 50, recovery: 70, flexibility: 60, balance: 58, reactionTime: 50, neck: 55 },
  mental: { fightIQ: 42, aggression: 55, composure: 47, heart: 50, discipline: 70, adaptability: 49 },
  disciplines: {
    taekwondo: tkd(5, 0.9, ['WT sport'], { kicks: 56, headKicks: 60, spinning: 58, footwork: 54, distance: 52, counters: 44 }),
    boxing: box(3, 0.9, [], { jab: 46, power: 44, combinations: 40, headMovement: 34, footwork: 42, guard: 46, bodyWork: 34, counters: 36, feints: 32, ringCraft: 30 }),
    mmaIntegration: mma(0, 0.9, [], { levelChanges: 5, clinchStriking: 5, cageWork: 5, groundAndPound: 5, getUps: 5, transitions: 5, subDefenceUnderStrikes: 5, gameplanExecution: 5 }),
  },
  career: {
    pro: { wins: 0, losses: 0, draws: 0, noContests: 0, koWins: 0, subWins: 0, decWins: 0, koLosses: 0, subLosses: 0, decLosses: 0 },
    amateur: { wins: 0, losses: 0 }, titleFights: 0, bigFightComposure: 30, careerKnockdownsAbsorbed: 0, winStreak: 0,
    lastResult: 'none', daysSinceLastBout: 0, weightCut: { cutPct: 0, regainPct: 0, residualDehydration: 0 },
  },
  style: {
    preferredRange: 'long', initiative: 'counter', pressureBias: 40, primaryMode: 'distanceStriking', fallbackMode: 'pressureStriking',
    favouriteTechniques: [{ techId: 'tech.round_kick_head_rear', weight: 1.3 }, { techId: 'tech.side_kick', weight: 1.2 }, { techId: 'tech.jab', weight: 1.1 }],
    combos: [
      { id: 'combo.jab_cross', sequence: ['tech.jab', 'tech.cross'], weight: 1.2 },
      { id: 'combo.jab_body_kick', sequence: ['tech.jab', 'tech.round_kick_body_rear'], weight: 1.1 },
    ],
    goToSubmissions: [],
    takedowns: { prefs: [], setup: 'naked', cageBias: 0.0 },
    hurtBehaviour: 'coverOnCage', losingBehaviour: 'unchanged', tiredBehaviour: 'retreat', guardStyle: 'highGuard',
  },
});

/** §4.15 "the T5 reference: complete lightweight champion". */
export const ARCH_CHAMPION_COMPLETE = preset({
  id: 'arch.champion_complete', name: 'Complete Champion', short: 'CHM',
  depth: {
    boxing: { grade: { system: 'boxingAmateur', rank: 'box.national' } },
    muayThai: { },
    wrestling: {
      grade: { system: 'wrestlingCredential', rank: 'wr.allAmerican' },
      competition: { level: 'national', bouts: 170, wins: 148, losses: 22, amateurBouts: 170, amateurWins: 148, bestPlacing: 'nationalTitle', medals: 3 },
      specialisations: ['spec.wr.chain'],
    },
    bjj: { grade: { system: 'bjjBelt', rank: 'bjj.black' }, specialisations: ['spec.bjj.backAttack'] },
    mmaIntegration: { specialisations: ['spec.mma.gameplan', 'spec.mma.cageControl'] },
  },
  history: {
    injuries: [],
    surgeries: 0,
    weightCutHistory: { hardCuts: 10, worstCutPct: 9, missedWeight: 0 },
    cardioBackground: { sport: 'swimming', years: 6 },
  },
  notes: 'The T5 reference. mmaIntegration mean 92.8 with IQ 94 and composure 94 passes the T5 mental gate.',
  body: { heightM: 1.78, reachM: 1.83, legReachM: 1.03, weighInKg: 70.3, fightNightKg: 76.3, weightClass: 'wc.lightweight', ageYears: 30, bodyFatPct: 7, build: { ecto: 0.30, meso: 0.62, endo: 0.08 }, stance: 'switch' },
  physical: { strength: 70, explosiveness: 82, speed: 80, handSpeed: 82, kickSpeed: 78, cardio: 90, chin: 80, bodyToughness: 80, recovery: 84, flexibility: 74, balance: 90, reactionTime: 68, neck: 78 },
  mental: { fightIQ: 94, aggression: 60, composure: 94, heart: 92, discipline: 92, adaptability: 90 },
  disciplines: {
    boxing: box(14, 1.15, [], { jab: 92, power: 84, combinations: 88, headMovement: 86, footwork: 92, guard: 88, bodyWork: 82, counters: 92, feints: 94, ringCraft: 92 }),
    muayThai: mt(10, 1.1, [], { kicks: 86, teep: 84, knees: 86, elbows: 84, clinch: 82, checks: 88, catches: 78, hands: 88 }),
    wrestling: wr(14, 1.15, ['folkstyle'], { shots: 86, takedownDefence: 94, topControl: 88, scrambles: 90, cageWrestling: 90, clinch: 86, chains: 86, finishes: 84, getUps: 92, matReturns: 84 }),
    bjj: bjj(12, 1.1, ['no-gi'], { guard: 82, passing: 86, topControl: 90, backControl: 92, chokes: 90, jointLocks: 80, legLocks: 60, escapes: 92, sweeps: 78, subDefence: 96, subAttack: 84, wrestleUps: 94 }),
    mmaIntegration: mma(14, 1.15, [], { levelChanges: 94, clinchStriking: 88, cageWork: 94, groundAndPound: 90, getUps: 94, transitions: 92, subDefenceUnderStrikes: 94, gameplanExecution: 96 }),
  },
  career: {
    pro: { wins: 26, losses: 1, draws: 0, noContests: 0, koWins: 10, subWins: 8, decWins: 8, koLosses: 0, subLosses: 0, decLosses: 1 },
    amateur: { wins: 12, losses: 1 }, titleFights: 7, bigFightComposure: 96, careerKnockdownsAbsorbed: 1, winStreak: 14,
  },
  style: {
    preferredRange: 'mid', initiative: 'balanced', pressureBias: 55, primaryMode: 'distanceStriking', fallbackMode: 'wrestleControl',
    favouriteTechniques: [{ techId: 'tech.jab', weight: 1.3 }, { techId: 'tech.cross', weight: 1.2 }, { techId: 'tech.low_kick_rear', weight: 1.2 }, { techId: 'tech.double_leg', weight: 1.2 }],
    combos: [
      { id: 'combo.feint_level_cross', sequence: ['tech.feint_level', 'tech.cross'], weight: 1.5 },
      { id: 'combo.jab_cross_double', sequence: ['tech.jab', 'tech.cross', 'tech.double_leg'], weight: 1.4 },
      { id: 'combo.body_kick_cross', sequence: ['tech.round_kick_body_rear', 'tech.cross'], weight: 1.2 },
    ],
    goToSubmissions: [{ subId: 'sub.rnc', weight: 1.5 }, { subId: 'sub.arm_triangle', weight: 1.2 }, { subId: 'sub.guillotine_high_elbow', weight: 1.0 }],
    takedowns: { prefs: [{ techId: 'tech.double_leg', weight: 1.3 }, { techId: 'tech.single_leg', weight: 1.1 }, { techId: 'tech.body_lock_td', weight: 1.2 }], setup: 'offFeint', cageBias: 0.7 },
    hurtBehaviour: 'counter', losingBehaviour: 'stealRound', tiredBehaviour: 'clinchRest', stanceSwitching: 50, guardStyle: 'hybrid',
  },
});

/** Every preset, keyed by its `arch.*` id (01 §4.16). */
export const ARCHETYPES: Readonly<Record<string, FighterDefinition>> = Object.freeze({
  [ARCH_ELITE_WRESTLER_BOXER.id]: ARCH_ELITE_WRESTLER_BOXER,
  [ARCH_THAI_STRIKER.id]: ARCH_THAI_STRIKER,
  [ARCH_BJJ_GUARD_PLAYER.id]: ARCH_BJJ_GUARD_PLAYER,
  [ARCH_JUDOKA.id]: ARCH_JUDOKA,
  [ARCH_PRESSURE_BOXER.id]: ARCH_PRESSURE_BOXER,
  [ARCH_COUNTER_STRIKER.id]: ARCH_COUNTER_STRIKER,
  [ARCH_BRAND_NEW_BRAWLER.id]: ARCH_BRAND_NEW_BRAWLER,
  [ARCH_GYM_FIT_BEGINNER.id]: ARCH_GYM_FIT_BEGINNER,
  [ARCH_REGIONAL_PRO_ALLROUNDER.id]: ARCH_REGIONAL_PRO_ALLROUNDER,
  [ARCH_AGEING_VETERAN.id]: ARCH_AGEING_VETERAN,
  [ARCH_HEAVYWEIGHT_POWER_PUNCHER.id]: ARCH_HEAVYWEIGHT_POWER_PUNCHER,
  [ARCH_FLYWEIGHT_VOLUME_STRIKER.id]: ARCH_FLYWEIGHT_VOLUME_STRIKER,
  [ARCH_SAMBO_GRAPPLER.id]: ARCH_SAMBO_GRAPPLER,
  [ARCH_TKD_CONVERT.id]: ARCH_TKD_CONVERT,
  [ARCH_CHAMPION_COMPLETE.id]: ARCH_CHAMPION_COMPLETE,
});

export const ARCHETYPE_IDS: readonly string[] = Object.keys(ARCHETYPES);
