/**
 * FIGHTER DEFINITION — what the creator edits, what a replay stores.
 *
 * This is the authored, serialisable description of a fighter. It is never
 * mutated during a bout: the sim derives a `FighterRuntime` from it once, and
 * everything that changes (damage, fatigue, position, plan) lives there.
 *
 * Owner: design chapter 01. See docs/design/01_FIGHTER_MODEL.md.
 *
 * Attribute convention (00_CONVENTIONS §3): every attribute and sub-skill is
 * 0-100, where 50 is an average trained professional in that weight class, 80+
 * is elite and 95+ is an outlier. Tiers T0-T5 are derived, never authored.
 *
 * Nothing here is a function or a class: a definition must survive
 * `JSON.parse(JSON.stringify(def))` unchanged, because a replay file stores
 * fighters whole rather than by reference (09 §1.3.1).
 *
 * Chapter 01 names a few fields differently from the skeleton this file grew
 * from; where that happened the original name is authoritative and the
 * chapter's name is documented on the field (`yearsTrained` = `years`,
 * `native` = `sub`, `neck` = `neckStrength`). Everything else is additive.
 */

export type Sex = 'male' | 'female';
export type Stance = 'orthodox' | 'southpaw' | 'switch';
export type Handedness = 'right' | 'left';

/** Legacy single-label somatotype. Chapter 01 §2.1 prefers the blend below. */
export type Build = 'ectomorph' | 'mesomorph' | 'endomorph';

/** Somatotype as a blend summing to 1 (01 §2.1). Drives rig proportions only. */
export interface BuildBlend {
  ecto: number;
  meso: number;
  endo: number;
}

/** Per-discipline tier, derived from sub-skills and years (01 §2.3.4). */
export type SkillTier = 0 | 1 | 2 | 3 | 4 | 5;

export const TIER_NAMES: Readonly<Record<SkillTier, string>> = Object.freeze({
  0: 'Brand new',
  1: 'Beginner',
  2: 'Amateur',
  3: 'Regional pro',
  4: 'Elite',
  5: 'Champion',
});

/**
 * Weight classes of the Unified Rules (01 §2.1, `[S: RJ §2.2]`). Boxing and
 * kickboxing rulesets map onto the same ids, so a bout never has to translate
 * between two class vocabularies.
 */
export type WeightClassId =
  | 'wc.atomweight' | 'wc.strawweight' | 'wc.flyweight' | 'wc.bantamweight' | 'wc.featherweight'
  | 'wc.lightweight' | 'wc.super_lightweight' | 'wc.welterweight' | 'wc.super_welterweight'
  | 'wc.middleweight' | 'wc.super_middleweight' | 'wc.light_heavyweight' | 'wc.cruiserweight'
  | 'wc.heavyweight' | 'wc.super_heavyweight' | 'wc.open';

/** Upper limit of each class in kg (01 §2.1). `wc.open` has none. */
export const WEIGHT_CLASS_LIMIT_KG: Readonly<Record<WeightClassId, number>> = Object.freeze({
  'wc.atomweight': 47.6,
  'wc.strawweight': 52.2,
  'wc.flyweight': 56.7,
  'wc.bantamweight': 61.2,
  'wc.featherweight': 65.8,
  'wc.lightweight': 70.3,
  'wc.super_lightweight': 74.8,
  'wc.welterweight': 77.1,
  'wc.super_welterweight': 79.4,
  'wc.middleweight': 83.9,
  'wc.super_middleweight': 88.5,
  'wc.light_heavyweight': 93.0,
  'wc.cruiserweight': 102.1,
  'wc.heavyweight': 120.2,
  'wc.super_heavyweight': 140.0,
  'wc.open': Number.POSITIVE_INFINITY,
});

export type DisciplineId =
  | 'boxing' | 'muayThai' | 'kickboxing' | 'karate' | 'taekwondo'
  | 'wrestling' | 'judo' | 'bjj' | 'sambo' | 'mma' | 'mmaIntegration';

/**
 * The ten disciplines chapter 01 §2.3 models. `mma` is kept as an accepted
 * alias of `mmaIntegration` so definitions written against the skeleton schema
 * still load; `deriveRuntime` folds it into `mmaIntegration`.
 */
export const DISCIPLINE_IDS = [
  'boxing', 'muayThai', 'kickboxing', 'karate', 'taekwondo',
  'wrestling', 'judo', 'bjj', 'sambo', 'mmaIntegration',
] as const;

export type CoreDisciplineId = (typeof DISCIPLINE_IDS)[number];

/** Disciplines that count toward `strikingMean` (01 §2.3.4). */
export const STRIKING_DISCIPLINES = ['boxing', 'muayThai', 'kickboxing', 'karate', 'taekwondo'] as const;
/** Disciplines that count toward `grapplingMean` (01 §2.3.4). */
export const GRAPPLING_DISCIPLINES = ['wrestling', 'judo', 'bjj', 'sambo'] as const;

// --------------------------------------------------------------------------
// Sub-skill sets (01 §2.3.1). Declared as type *aliases*, not interfaces, so
// they keep TypeScript's implicit index signature and stay assignable to the
// `Record<string, number>` the generic definition schema stores.
// --------------------------------------------------------------------------

export type BoxingSkills = {
  jab: number; power: number; combinations: number; headMovement: number; footwork: number;
  guard: number; bodyWork: number; counters: number; feints: number; ringCraft: number;
};
export type MuayThaiSkills = {
  kicks: number; teep: number; knees: number; elbows: number; clinch: number;
  checks: number; catches: number; hands: number;
};
export type KickboxingSkills = {
  punches: number; kicks: number; lowKicks: number; combinations: number; footwork: number;
  checks: number; spinning: number; defence: number;
};
export type WrestlingSkills = {
  shots: number; takedownDefence: number; topControl: number; scrambles: number; cageWrestling: number;
  clinch: number; chains: number; finishes: number; getUps: number; matReturns: number;
};
export type JudoSkills = {
  gripFighting: number; throws: number; footSweeps: number; counters: number; kuzushi: number;
  newaza: number; ukemi: number;
};
export type BjjSkills = {
  guard: number; passing: number; topControl: number; backControl: number; chokes: number;
  jointLocks: number; legLocks: number; escapes: number; sweeps: number; subDefence: number;
  subAttack: number; wrestleUps: number;
};
export type KarateSkills = {
  distanceControl: number; blitz: number; kicks: number; counters: number; footwork: number; timing: number;
};
export type SamboSkills = {
  throws: number; takedowns: number; legLocks: number; gripFighting: number; topControl: number;
  transitions: number; strikingToGrappling: number;
};
export type TaekwondoSkills = {
  kicks: number; headKicks: number; spinning: number; footwork: number; distance: number; counters: number;
};
export type MmaIntegrationSkills = {
  levelChanges: number; clinchStriking: number; cageWork: number; groundAndPound: number; getUps: number;
  transitions: number; subDefenceUnderStrikes: number; gameplanExecution: number;
};

/** The sub-skill names of every discipline, in catalogue order (01 §2.3.1). */
export const SUB_SKILLS: Readonly<Record<CoreDisciplineId, readonly string[]>> = Object.freeze({
  boxing: ['jab', 'power', 'combinations', 'headMovement', 'footwork', 'guard', 'bodyWork', 'counters', 'feints', 'ringCraft'],
  muayThai: ['kicks', 'teep', 'knees', 'elbows', 'clinch', 'checks', 'catches', 'hands'],
  kickboxing: ['punches', 'kicks', 'lowKicks', 'combinations', 'footwork', 'checks', 'spinning', 'defence'],
  wrestling: ['shots', 'takedownDefence', 'topControl', 'scrambles', 'cageWrestling', 'clinch', 'chains', 'finishes', 'getUps', 'matReturns'],
  judo: ['gripFighting', 'throws', 'footSweeps', 'counters', 'kuzushi', 'newaza', 'ukemi'],
  bjj: ['guard', 'passing', 'topControl', 'backControl', 'chokes', 'jointLocks', 'legLocks', 'escapes', 'sweeps', 'subDefence', 'subAttack', 'wrestleUps'],
  karate: ['distanceControl', 'blitz', 'kicks', 'counters', 'footwork', 'timing'],
  sambo: ['throws', 'takedowns', 'legLocks', 'gripFighting', 'topControl', 'transitions', 'strikingToGrappling'],
  taekwondo: ['kicks', 'headKicks', 'spinning', 'footwork', 'distance', 'counters'],
  mmaIntegration: ['levelChanges', 'clinchStriking', 'cageWork', 'groundAndPound', 'getUps', 'transitions', 'subDefenceUnderStrikes', 'gameplanExecution'],
});

export type CompetitionLevel = 'none' | 'local' | 'national' | 'international';

/**
 * Best result achieved in the discipline's own competition circuit (01 §8.2).
 * A placing is evidence the years and the sub-skills may not carry on their
 * own: an Olympic medallist's wrestling is not "eleven years of training", it
 * is eleven years that survived the only test that sorts the top 0.1 %.
 */
export type PlacingId =
  | 'none' | 'localPodium' | 'nationalPodium' | 'nationalTitle'
  | 'continentalMedal' | 'worldMedal' | 'olympicMedal';

export const PLACING_IDS = [
  'none', 'localPodium', 'nationalPodium', 'nationalTitle',
  'continentalMedal', 'worldMedal', 'olympicMedal',
] as const;

export interface DisciplineCompetition {
  bouts: number;
  wins: number;
  level: CompetitionLevel;

  // --- 01 §8.2 additions (all optional, all default to "not recorded") ----
  losses?: number;
  draws?: number;
  /** Bouts contested as an amateur in this art, of the `bouts` total. */
  amateurBouts?: number;
  amateurWins?: number;
  /** Bouts contested professionally in this art, of the `bouts` total. */
  proBouts?: number;
  proWins?: number;
  /** Best placing achieved; raises the art's prior on its own. */
  bestPlacing?: PlacingId;
  /** Medals or podiums collected at `level`. Diminishing, capped. */
  medals?: number;
}

/**
 * The grading systems the modelled arts actually use (01 §8.1). A grade is not
 * a skill — it is an *independent observation* of one, awarded by somebody who
 * watched the fighter train for years. It therefore raises the art's prior
 * rather than replacing the sub-skills the user authored.
 */
export type GradeSystem =
  | 'none' | 'bjjBelt' | 'judoKyuDan' | 'wrestlingCredential'
  | 'boxingAmateur' | 'thaiRecord' | 'karateDan' | 'taekwondoDan' | 'samboRank';

export const GRADE_SYSTEMS = [
  'none', 'bjjBelt', 'judoKyuDan', 'wrestlingCredential',
  'boxingAmateur', 'thaiRecord', 'karateDan', 'taekwondoDan', 'samboRank',
] as const;

export interface DisciplineGrade {
  system: GradeSystem;
  /** Rank id inside the system; see {@link GRADE_RANKS}. */
  rank: string;
  /** BJJ stripes, 0-4. Ignored by the other systems. */
  stripes?: number;
}

/** The ranks each system admits, lowest first. */
export const GRADE_RANKS: Readonly<Record<GradeSystem, readonly string[]>> = Object.freeze({
  none: ['none.unranked'],
  bjjBelt: ['bjj.white', 'bjj.blue', 'bjj.purple', 'bjj.brown', 'bjj.black', 'bjj.black2', 'bjj.coral'],
  judoKyuDan: ['judo.kyu5', 'judo.kyu3', 'judo.kyu1', 'judo.shodan', 'judo.nidan', 'judo.sandan', 'judo.yondan'],
  wrestlingCredential: ['wr.club', 'wr.highSchool', 'wr.statePlacer', 'wr.ncaaD2', 'wr.ncaaD1', 'wr.allAmerican', 'wr.ncaaChampion', 'wr.worldTeam', 'wr.olympian'],
  boxingAmateur: ['box.novice', 'box.open', 'box.regional', 'box.national', 'box.international', 'box.olympian'],
  thaiRecord: ['mt.gymFighter', 'mt.provincial', 'mt.bangkokStadium', 'mt.stadiumChampion', 'mt.worldTitle'],
  karateDan: ['kar.kyu', 'kar.shodan', 'kar.nidan', 'kar.sandan', 'kar.nationalSquad'],
  taekwondoDan: ['tkd.kyu', 'tkd.il_dan', 'tkd.i_dan', 'tkd.sam_dan', 'tkd.nationalSquad'],
  samboRank: ['sam.club', 'sam.candidateMaster', 'sam.master', 'sam.internationalMaster', 'sam.worldMedallist'],
});

/**
 * Prior skill level each grade attests, on the 0-100 sub-skill scale
 * (`CONV §3`). Calibrated against the tier bands rather than against time
 * served: a BJJ black belt is a T4 grappler by definition of the band (70-90),
 * an NCAA All-American is the same claim from a different sport, and a
 * five-kyu judoka is a beginner however long he has held it. `[E]`, placed
 * inside the `CONV §3` bands.
 */
export const GRADE_PRIORS: Readonly<Record<string, number>> = Object.freeze({
  'none.unranked': 0,
  'bjj.white': 12, 'bjj.blue': 33, 'bjj.purple': 50, 'bjj.brown': 64,
  'bjj.black': 76, 'bjj.black2': 82, 'bjj.coral': 88,
  'judo.kyu5': 12, 'judo.kyu3': 26, 'judo.kyu1': 38, 'judo.shodan': 54,
  'judo.nidan': 64, 'judo.sandan': 72, 'judo.yondan': 78,
  'wr.club': 15, 'wr.highSchool': 28, 'wr.statePlacer': 42, 'wr.ncaaD2': 54,
  'wr.ncaaD1': 64, 'wr.allAmerican': 76, 'wr.ncaaChampion': 84, 'wr.worldTeam': 88, 'wr.olympian': 91,
  'box.novice': 24, 'box.open': 40, 'box.regional': 52, 'box.national': 66,
  'box.international': 78, 'box.olympian': 86,
  'mt.gymFighter': 34, 'mt.provincial': 50, 'mt.bangkokStadium': 70,
  'mt.stadiumChampion': 84, 'mt.worldTitle': 88,
  'kar.kyu': 18, 'kar.shodan': 44, 'kar.nidan': 56, 'kar.sandan': 66, 'kar.nationalSquad': 78,
  'tkd.kyu': 18, 'tkd.il_dan': 42, 'tkd.i_dan': 54, 'tkd.sam_dan': 64, 'tkd.nationalSquad': 78,
  'sam.club': 20, 'sam.candidateMaster': 42, 'sam.master': 60,
  'sam.internationalMaster': 74, 'sam.worldMedallist': 86,
});

/** Points each BJJ stripe adds to the belt's prior (four stripes per belt). */
export const GRADE_STRIPE_POINTS = 2.5;

/**
 * A specialisation is the answer to "what does this fighter actually *do* in
 * this art". It biases the art's effective sub-skills: the emphasised ones up,
 * the traded ones down. Nobody is a leg-locker *and* a pressure passer to the
 * same depth in the same number of mat hours, so the trade-off is part of the
 * spec rather than an afterthought. `[E]`.
 */
export interface SpecialisationSpec {
  id: string;
  discipline: CoreDisciplineId;
  label: string;
  /** What this focus buys. */
  emphasis: readonly string[];
  /** What it quietly costs. */
  tradeoff?: readonly string[];
  note: string;
}

export const SPECIALISATIONS: readonly SpecialisationSpec[] = Object.freeze([
  // boxing
  { id: 'spec.box.inside', discipline: 'boxing', label: 'Inside fighting', emphasis: ['bodyWork', 'combinations', 'headMovement'], tradeoff: ['ringCraft'], note: 'Lives in the phone booth; gives up the outside game.' },
  { id: 'spec.box.outside', discipline: 'boxing', label: 'Outside boxing', emphasis: ['jab', 'footwork', 'ringCraft'], tradeoff: ['bodyWork'], note: 'Long-range point boxing off the jab.' },
  { id: 'spec.box.counter', discipline: 'boxing', label: 'Counter punching', emphasis: ['counters', 'headMovement', 'feints'], tradeoff: ['combinations'], note: 'Waits, reads, returns.' },
  { id: 'spec.box.power', discipline: 'boxing', label: 'Power punching', emphasis: ['power', 'counters'], tradeoff: ['footwork', 'guard'], note: 'Loads every shot; leaves gaps doing it.' },
  // muay thai
  { id: 'spec.mt.clinch', discipline: 'muayThai', label: 'Clinch and knees', emphasis: ['clinch', 'knees', 'elbows'], tradeoff: ['teep'], note: 'Muay Khao: walks through the range to the plum.' },
  { id: 'spec.mt.kicking', discipline: 'muayThai', label: 'Kicking game', emphasis: ['kicks', 'teep', 'checks'], tradeoff: ['hands'], note: 'Muay Tae: kick volume and the long guard.' },
  { id: 'spec.mt.elbows', discipline: 'muayThai', label: 'Elbow specialist', emphasis: ['elbows', 'clinch'], tradeoff: ['kicks'], note: 'Cuts in the pocket.' },
  // kickboxing
  { id: 'spec.kb.lowKicks', discipline: 'kickboxing', label: 'Low-kick game', emphasis: ['lowKicks', 'checks'], tradeoff: ['spinning'], note: 'Dutch chaining into the leg.' },
  { id: 'spec.kb.volume', discipline: 'kickboxing', label: 'Volume combinations', emphasis: ['combinations', 'punches', 'footwork'], tradeoff: ['defence'], note: 'Output over defence.' },
  // karate
  { id: 'spec.kar.blitz', discipline: 'karate', label: 'Blitz entries', emphasis: ['blitz', 'footwork', 'timing'], tradeoff: ['distanceControl'], note: 'Closes the gap in one explosive step.' },
  { id: 'spec.kar.pointSniping', discipline: 'karate', label: 'Point sniping', emphasis: ['distanceControl', 'counters', 'timing'], tradeoff: ['blitz'], note: 'In, touch, out.' },
  // taekwondo
  { id: 'spec.tkd.headHunting', discipline: 'taekwondo', label: 'Head kicking', emphasis: ['headKicks', 'spinning'], tradeoff: ['counters'], note: 'Everything above the shoulders.' },
  { id: 'spec.tkd.footwork', discipline: 'taekwondo', label: 'Range footwork', emphasis: ['footwork', 'distance', 'counters'], tradeoff: ['spinning'], note: 'Manages the gap rather than jumping it.' },
  // wrestling
  { id: 'spec.wr.chain', discipline: 'wrestling', label: 'Chain wrestling', emphasis: ['chains', 'shots', 'finishes'], tradeoff: ['matReturns'], note: 'Shot to re-shot to finish; never stops on the first attempt.' },
  { id: 'spec.wr.matReturns', discipline: 'wrestling', label: 'Mat returns', emphasis: ['matReturns', 'topControl'], tradeoff: ['shots'], note: 'Folkstyle riding: he gets up, he goes back down.' },
  { id: 'spec.wr.defensive', discipline: 'wrestling', label: 'Defensive wrestling', emphasis: ['takedownDefence', 'scrambles', 'getUps'], tradeoff: ['shots'], note: 'Wrestles to stay standing, not to take you down.' },
  { id: 'spec.wr.cage', discipline: 'wrestling', label: 'Cage wrestling', emphasis: ['cageWrestling', 'clinch', 'finishes'], tradeoff: ['scrambles'], note: 'Bodylock to the fence; an MMA-only sub-game.' },
  // judo
  { id: 'spec.ju.gripping', discipline: 'judo', label: 'Grip fighting', emphasis: ['gripFighting', 'kuzushi'], tradeoff: ['newaza'], note: 'Wins the exchange before the throw.' },
  { id: 'spec.ju.footSweeps', discipline: 'judo', label: 'Ashi-waza', emphasis: ['footSweeps', 'kuzushi', 'counters'], tradeoff: ['throws'], note: 'Trips and sweeps rather than big throws.' },
  { id: 'spec.ju.newaza', discipline: 'judo', label: 'Newaza', emphasis: ['newaza', 'ukemi'], tradeoff: ['footSweeps'], note: 'Turnovers and pins on the mat.' },
  // bjj
  { id: 'spec.bjj.legLocks', discipline: 'bjj', label: 'Leg locks', emphasis: ['legLocks', 'sweeps', 'subAttack'], tradeoff: ['passing', 'topControl'], note: 'Modern leg-lock game; enters from the bottom.' },
  { id: 'spec.bjj.pressurePassing', discipline: 'bjj', label: 'Pressure passing', emphasis: ['passing', 'topControl', 'backControl'], tradeoff: ['guard', 'legLocks'], note: 'Heavy, slow, inevitable.' },
  { id: 'spec.bjj.guardPlaying', discipline: 'bjj', label: 'Guard playing', emphasis: ['guard', 'sweeps', 'subAttack'], tradeoff: ['passing'], note: 'Happy to be underneath.' },
  { id: 'spec.bjj.backAttack', discipline: 'bjj', label: 'Back attacks', emphasis: ['backControl', 'chokes'], tradeoff: ['legLocks'], note: 'Everything ends in a strangle.' },
  { id: 'spec.bjj.defensive', discipline: 'bjj', label: 'Defensive jiu-jitsu', emphasis: ['escapes', 'subDefence'], tradeoff: ['subAttack'], note: 'Very hard to finish, rarely finishes.' },
  // sambo
  { id: 'spec.sam.legLocks', discipline: 'sambo', label: 'Sambo leg locks', emphasis: ['legLocks', 'transitions'], tradeoff: ['topControl'], note: 'Ankle and knee attacks from every entry.' },
  { id: 'spec.sam.combat', discipline: 'sambo', label: 'Combat sambo', emphasis: ['strikingToGrappling', 'takedowns'], tradeoff: ['legLocks'], note: 'Strikes into the throw; the MMA-shaped sambo.' },
  // mma integration
  { id: 'spec.mma.cageControl', discipline: 'mmaIntegration', label: 'Cage control', emphasis: ['cageWork', 'clinchStriking'], tradeoff: ['getUps'], note: 'Owns the fence on both sides of it.' },
  { id: 'spec.mma.groundAndPound', discipline: 'mmaIntegration', label: 'Ground and pound', emphasis: ['groundAndPound', 'transitions'], tradeoff: ['getUps'], note: 'Damage from the top, not submissions.' },
  { id: 'spec.mma.scrambling', discipline: 'mmaIntegration', label: 'Scrambling', emphasis: ['getUps', 'transitions', 'levelChanges'], tradeoff: ['groundAndPound'], note: 'Never stays anywhere long enough to be held.' },
  { id: 'spec.mma.gameplan', discipline: 'mmaIntegration', label: 'Game-plan execution', emphasis: ['gameplanExecution', 'subDefenceUnderStrikes'], tradeoff: ['groundAndPound'], note: 'Does the thing the corner asked for.' },
]);

/** Specialisation ids grouped by the discipline they belong to. */
export const SPECIALISATIONS_BY_DISCIPLINE: Readonly<Record<string, readonly SpecialisationSpec[]>> =
  Object.freeze(
    SPECIALISATIONS.reduce<Record<string, SpecialisationSpec[]>>((acc, s) => {
      (acc[s.discipline] ??= []).push(s);
      return acc;
    }, {}),
  );

/**
 * One discipline's stored experience (01 §2.3, extended by §8). `years` is the
 * chapter's `yearsTrained`; `sub` is the chapter's `native` map. Nothing
 * derived is stored here — `effective`, `mean`, `rustMult` and `tier` live on
 * the runtime.
 *
 * Every field below `competition` is additive and optional: a definition
 * written against the original schema derives bit-identically, because each
 * new field's default is the neutral value of its own formula.
 */
export interface DisciplineSkills<S extends Record<string, number> = Record<string, number>> {
  /** Years trained, used for the tier derivation and the experience prior. */
  years: number;
  /** Named sub-skills; the set differs per discipline (see 01 §2.3). */
  sub: S;
  /** 0.6 hobbyist … 1.15 elite camp (01 §2.3.2). Defaults to 1.0. */
  trainingQuality?: number;
  /** Discipline-specific tags, e.g. wrestling `folkstyle`, Thai `muayFemur`. */
  styleTags?: string[];
  competition?: DisciplineCompetition;

  // --- 01 §8 additions ----------------------------------------------------
  /**
   * Age at the first session in this art. Under 18 buys a deeper motor
   * programme per year trained; defaults to 18 (no youth credit).
   */
  startAge?: number;
  /** Belt, dan, credential or amateur class. Defaults to ungraded. */
  grade?: DisciplineGrade;
  /** Mat/ring hours per week during a normal training block. Defaults to 8. */
  hoursPerWeek?: number;
  /** Sessions per week; two four-hour days is not the same as eight one-hour days. Defaults to 5. */
  sessionsPerWeek?: number;
  /** 0-100: how live the sparring is. 50 is ordinary club sparring. */
  sparringIntensity?: number;
  /** Months since this art was last trained. Rust. Defaults to 0. */
  monthsSinceTrained?: number;
  /** Ids from {@link SPECIALISATIONS} for this discipline. */
  specialisations?: string[];
  /** 0-100 coaching quality for *this* art specifically. Defaults to 50. */
  coachQuality?: number;
  /** True for the art the fighter came up in. At most one should be set. */
  isBase?: boolean;
}

/**
 * Per-discipline blocks with their sub-skill names typed. The intersection with
 * the generic record keeps the block assignable to the loose schema a JSON
 * import produces, while giving the creator and the archetypes real key
 * checking.
 */
export type FighterDisciplines = Partial<Record<DisciplineId, DisciplineSkills>> & {
  boxing?: DisciplineSkills<BoxingSkills>;
  muayThai?: DisciplineSkills<MuayThaiSkills>;
  kickboxing?: DisciplineSkills<KickboxingSkills>;
  wrestling?: DisciplineSkills<WrestlingSkills>;
  judo?: DisciplineSkills<JudoSkills>;
  bjj?: DisciplineSkills<BjjSkills>;
  karate?: DisciplineSkills<KarateSkills>;
  sambo?: DisciplineSkills<SamboSkills>;
  taekwondo?: DisciplineSkills<TaekwondoSkills>;
  mmaIntegration?: DisciplineSkills<MmaIntegrationSkills>;
};

export interface BodySpec {
  heightM: number;
  /** Fingertip-to-fingertip span; the creator may derive it from height. */
  reachM: number;
  /** Hip-to-floor, drives kick range. */
  legReachM: number;
  /** Fight-night mass. Kept as the single required mass for older definitions. */
  massKg: number;
  ageYears: number;
  bodyFatPct: number;
  build: Build | BuildBlend;
  stance: Stance;
  handedness: Handedness;

  // --- chapter 01 §2.1 additions -----------------------------------------
  sex?: Sex;
  /** Official weigh-in mass. Defaults to `massKg` (no cut modelled). */
  weighInKg?: number;
  /** Mass at the first bell after regain. Defaults to `massKg`. */
  fightNightKg?: number;
  /** Derived from `weighInKg` when omitted, unless the ruleset is open-weight. */
  weightClass?: WeightClassId;
  /** Defaults to the handedness side. */
  dominantLeg?: 'right' | 'left';

  // --- chapter 01 §8.3 additions ------------------------------------------
  /**
   * Off-camp walk-around mass. The honest measure of how big this fighter
   * really is: `(natural - weighIn) / natural` is the *cut severity* the
   * fight-week dehydration model reads when `weightCut.cutPct` is left at its
   * default. Defaults to `weighInKg` (a natural, uncut fighter).
   */
  naturalWeightKg?: number;
  /**
   * 0-100. 50 is an even fighter; 100 is everything in the dominant hand.
   * Scales the lead hand's share of the power index — a one-handed puncher
   * hits nothing with the jab and everything with the cross.
   */
  handStrengthSplit?: number;
  /**
   * Percentage difference between the lead-side and rear-side limb, positive
   * when the lead side is longer. Real, small (±3 %) and it moves the reach
   * that matters: the jab arm and the lead kick. Defaults to 0.
   */
  limbAsymmetry?: { armPct: number; legPct: number };
}

/** Regions an injury can be recorded against (01 §8.4). */
export type InjuryRegion =
  | 'head' | 'eye' | 'neck' | 'shoulder' | 'elbow' | 'hand'
  | 'ribs' | 'back' | 'hip' | 'knee' | 'ankle';

export const INJURY_REGIONS = [
  'head', 'eye', 'neck', 'shoulder', 'elbow', 'hand',
  'ribs', 'back', 'hip', 'knee', 'ankle',
] as const;

/**
 * One entry in the injury history (01 §8.4). Severity is the tissue insult,
 * `monthsAgo` is how long the body has had to deal with it, and `surgery` /
 * `recurrent` are what stop it ever fully going away.
 */
export interface InjuryEntry {
  region: InjuryRegion;
  /** 0-100: 20 a strain, 50 a partial tear, 80 a rupture, 95 a reconstruction. */
  severity: number;
  /** Months since the injury. 0 is "carrying it into this fight". */
  monthsAgo: number;
  surgery?: boolean;
  /** A joint that keeps going. Leaves a permanent residue. */
  recurrent?: boolean;
  note?: string;
}

/** Endurance sports that leave a measurable aerobic base (01 §8.3). */
export type EnduranceSportId =
  | 'none' | 'running' | 'swimming' | 'cycling' | 'rowing' | 'football' | 'crossCountry' | 'triathlon';

export const ENDURANCE_SPORTS = [
  'none', 'running', 'swimming', 'cycling', 'rowing', 'football', 'crossCountry', 'triathlon',
] as const;

/** Career fight-week weight management, as distinct from *this* week's cut. */
export interface WeightCutHistory {
  /** Career count of cuts beyond 8 % of walk-around mass. */
  hardCuts: number;
  /** The worst single cut ever made, % of walk-around mass. */
  worstCutPct: number;
  /** Times the fighter missed weight. Evidence the cut is no longer working. */
  missedWeight: number;
}

/**
 * Biography the sim reads (01 §8.4). Everything here is optional and everything
 * here has a consumer; a field that only reads well on a fighter card belongs
 * in `notes`.
 */
export interface FighterHistory {
  injuries?: InjuryEntry[];
  /** Total career surgeries, including ones with no entry above. */
  surgeries?: number;
  weightCutHistory?: WeightCutHistory;
  /** Endurance-sport background before or alongside the fight career. */
  cardioBackground?: { sport: EnduranceSportId; years: number };
}

export type HairLength = 'shaved' | 'short' | 'medium' | 'tied';
export type FacialHairId = 'none' | 'stubble' | 'goatee' | 'full' | 'moustache';
export type TattooSlot =
  | 'leftArmFull' | 'rightArmFull' | 'leftForearm' | 'rightForearm' | 'chest' | 'stomach'
  | 'back' | 'neck' | 'leftLeg' | 'rightLeg' | 'leftCalf' | 'rightCalf';
export type ShortsStyle = 'mma_short' | 'vale_tudo' | 'boxing_trunk' | 'thai_short' | 'compression';
export type GloveType = 'mma_4oz' | 'boxing_8oz' | 'boxing_10oz' | 'kb_10oz' | 'bare';

/**
 * Appearance (01 §2.1.1). Read only by chapter 08; no field here may ever enter
 * a simulation formula. Glove *type* is normally set by the ruleset — this
 * field is the visual override.
 */
export interface AppearanceSpec {
  skinTone: number;
  hair: string;
  face: string;
  tattoos: string[];
  shorts: string;
  gloves: string;
  /** Free-text nickname shown on the HUD. */
  nickname?: string;

  // --- chapter 01 §2.1.1 additions ---------------------------------------
  hairStyle?: { styleId: string; colorId: string; length: HairLength };
  facialHair?: FacialHairId;
  facePreset?: number;
  faceMorphs?: Record<string, number>;
  tattooPlacements?: Array<{ slot: TattooSlot; textureId: string; tint?: string }>;
  shortsKit?: {
    style: ShortsStyle; primary: string; secondary: string; trim: string; sponsorSet?: string;
  };
  gloveKit?: { type: GloveType; color: string };
  handWrapColor?: string;
  mouthguardColor?: string;
  shinGuards?: boolean;
  /** ISO country code for chyrons. */
  flag?: string;
}

/**
 * The fourteen physical attributes of 01 §2.2, 0-100 each.
 *
 * `neckStrength` is the chapter's `neck` (05's KO model reads it directly,
 * `[S: DP §3.2 Collins 2014]`); `gripStrength` is carried from the skeleton and
 * feeds 03's grip edges.
 */
export interface PhysicalAttributes {
  strength: number;
  explosiveness: number;
  speed: number;
  handSpeed: number;
  kickSpeed: number;
  cardio: number;
  chin: number;
  bodyToughness: number;
  recovery: number;
  flexibility: number;
  balance: number;
  /** Higher is better; converted to a latency in ms by 01 §2.2.1. */
  reactionTime: number;
  gripStrength: number;
  neckStrength: number;
}

/** 0-100 each (01 §2.5). */
export interface MentalAttributes {
  fightIQ: number;
  aggression: number;
  composure: number;
  heart: number;
  discipline: number;
  adaptability: number;
}

/** One line of a career record (01 §2.4). */
export interface FightRecord {
  wins: number;
  losses: number;
  draws?: number;
  noContests?: number;
  koWins?: number;
  subWins?: number;
  decWins?: number;
  koLosses?: number;
  subLosses?: number;
  decLosses?: number;
}

export type LastResult = 'win' | 'loss' | 'draw' | 'none';

/** Fight-week weight management (01 §2.4.4). */
export interface WeightCut {
  /** Mass lost during fight week, % of walk-around mass. */
  cutPct: number;
  /** Mass regained after the weigh-in, % of weigh-in mass. */
  regainPct: number;
  /** 0-0.05; 05 reads it for the aerobic/PCr/chin penalties (`[S: DP §4.7]`). */
  residualDehydration: number;
}

/**
 * Record, experience and career state (01 §2.4). The flat counters are the
 * skeleton's; the `pro` / `amateur` blocks are chapter 01's richer form and win
 * where both are present.
 */
export interface CareerRecord {
  proWins: number;
  proLosses: number;
  proDraws: number;
  amWins: number;
  amLosses: number;
  /** Losses by knockout; feeds the chin decay in 01 §2.4.3. */
  koLosses: number;
  /** Knockdowns suffered across the career. */
  knockdownsSuffered: number;
  titleFights: number;
  /** Months since the last bout; long layoffs cost performance (LIT_B). */
  layoffMonths: number;
  bigFightComposure: number;

  // --- chapter 01 §2.4 additions -----------------------------------------
  pro?: FightRecord;
  amateur?: FightRecord;
  /** Preferred over `layoffMonths` when present. */
  daysSinceLastBout?: number;
  /** Days of camp when replacing an opponent; < 21 is short notice. */
  shortNoticeDays?: number;
  lastResult?: LastResult;
  lastResultWasKoLoss?: boolean;
  /** Bouts contested against each stance; drives `stanceFamiliarity`. */
  stanceExposure?: { orthodox: number; southpaw: number };
  weightCut?: WeightCut;
  winStreak?: number;

  // --- chapter 01 §8.2 additions: overall experience ----------------------
  /**
   * Competitive rounds actually fought, professional and amateur. Two fighters
   * at 10-0 are not the same fighter if one has 30 rounds and the other has 10
   * first-round finishes; this is the field that separates them.
   */
  totalRounds?: number;
  /** Years since turning professional. Time *in* the sport, not time training. */
  yearsPro?: number;
  /**
   * 0-100: the average level of the opposition faced. 50 is regional, 75 is
   * ranked, 90 is champions. Scales the experience composite and composure —
   * a 20-0 record against nobody is worth less than 12-4 against everybody.
   */
  oppositionLevel?: number;
  /** Main-event and co-main bouts. Big-room experience, separate from titles. */
  mainEvents?: number;
  /** Titles actually won, of `titleFights` contested. */
  titleWins?: number;
  /**
   * Hard fights taken: wars, five-round grinds, fights finished on heart. The
   * damage history the chin pays for beyond the KO count.
   */
  warFights?: number;
  /** Years of habitual hard sparring. Cumulative sub-concussive exposure. */
  hardSparringYears?: number;
  /**
   * 0-100 authored override for the experience composite. When set, it *is*
   * the experience the sim uses (scaled to 0-1); the derived value is still
   * computed and reported on the derivation line beside it.
   */
  experienceOverride?: number;
}

/**
 * Plan archetype. The first nine values are the skeleton's; the six `MIS §6.2`
 * modes chapter 01 §2.6 names are added because 07 keys its plan table on them.
 */
export type PrimaryMode =
  | 'pressure' | 'counter' | 'pointFighter' | 'volume' | 'power'
  | 'grinder' | 'scrambler' | 'guardPlayer' | 'allRounder'
  | 'distanceStriking' | 'pressureStriking' | 'wrestleControl' | 'clinchGrind' | 'submissionHunt';

export type RangeBand = 'long' | 'mid' | 'short' | 'close' | 'clinch' | 'ground';
export type Initiative = 'pressure' | 'counter' | 'point' | 'balanced';
export type HurtBehaviour =
  | 'coverOnCage' | 'clinch' | 'shoot' | 'circleOut' | 'trade' | 'counter' | 'turnAway';
export type LosingBehaviour = 'finishSeek' | 'stealRound' | 'unchanged' | 'shell' | 'gamble';
export type TiredBehaviour = 'clinchRest' | 'coast' | 'gamble' | 'retreat';
export type GuardStyle = 'highGuard' | 'philly' | 'longGuard' | 'peekaboo' | 'thai' | 'hybrid';
export type ThaiStyle = 'muayFemur' | 'muayKhao' | 'muayMat' | 'muayTae' | 'dutch';
export type TakedownSetup =
  | 'naked' | 'offSingleStrike' | 'offCombination' | 'offFeint' | 'reactive' | 'offClinch';
export type BottomPriority = 'standUp' | 'sweep' | 'submit';
export type TopPriority = 'control' | 'strike' | 'pass' | 'submit';

export interface WeightedTechnique {
  techId: string;
  weight: number;
}

export interface ComboSpec {
  id: string;
  sequence: string[];
  weight: number;
}

export interface WeightedSubmission {
  subId: string;
  weight: number;
}

export interface TakedownStyle {
  prefs: WeightedTechnique[];
  setup: TakedownSetup;
  /** 0-1 preference to finish on the fence. */
  cageBias: number;
}

/**
 * Style is descriptive, not prescriptive (01 §2.6): it multiplies 07's action
 * weights. A style the sub-skills cannot support is still selected and simply
 * executed badly — that is how a T1 "counter striker" looks.
 */
export interface StyleSpec {
  primaryMode: PrimaryMode;
  /** Where this fighter wants the fight: 0 = far range, 1 = on the ground. */
  preferredRange: RangeBand;
  favouriteTechniques: string[] | WeightedTechnique[];
  favouriteCombos: string[][] | ComboSpec[];
  goToSubmissions: string[] | WeightedSubmission[];
  takedownPreferences: string[] | TakedownStyle;
  /** What they do when losing: press, stall, gamble, or hold the plan. */
  whenLosing: 'press' | 'stall' | 'gamble' | 'hold';
  /** Optional author override that replaces the generated game plan (07 §2.5). */
  gamePlanOverride?: Record<string, unknown>;

  // --- chapter 01 §2.6 additions -----------------------------------------
  initiative?: Initiative;
  /** 0 pure counter … 100 pure pressure. */
  pressureBias?: number;
  fallbackMode?: PrimaryMode;
  bottomPriority?: BottomPriority[];
  topPriority?: TopPriority[];
  hurtBehaviour?: HurtBehaviour;
  losingBehaviour?: LosingBehaviour;
  tiredBehaviour?: TiredBehaviour;
  /** 0-100 propensity; needs stance 'switch' for full effect. */
  stanceSwitching?: number;
  pacing?: Array<{ round: number; outputMult: number; riskAppetite: number }>;
  guardStyle?: GuardStyle;
  thaiStyle?: ThaiStyle;
  /** `SUB §4` trait: floors `stubbornness` at 0.5. */
  refusesToTap?: boolean;
}

export interface FighterDefinition {
  /** Schema version inside the definition, so imports can be migrated. */
  schema: 1;
  id: string;
  name: string;
  short: string;
  body: BodySpec;
  appearance: AppearanceSpec;
  physical: PhysicalAttributes;
  /** Only the disciplines this fighter has actually trained need to appear. */
  disciplines: FighterDisciplines;
  mental: MentalAttributes;
  record: CareerRecord;
  style: StyleSpec;
  /** Injury, surgery, weight-cut and endurance background (01 §8.4). */
  history?: FighterHistory;
  /** Free-form notes shown in the creator; never read by the sim. */
  notes?: string;
}

/** Total bouts on a record line, tolerating the optional counters. */
export function recordTotal(r: FightRecord | undefined): number {
  if (!r) return 0;
  return r.wins + r.losses + (r.draws ?? 0) + (r.noContests ?? 0);
}

/**
 * The 0-100 prior a grade attests, stripes included. Unknown ranks are worth
 * nothing rather than throwing: an import from a future build that invents a
 * belt must still load (09 §3.6).
 */
export function gradePriorOf(grade: DisciplineGrade | undefined): number {
  if (!grade || grade.system === 'none') return 0;
  const base = GRADE_PRIORS[grade.rank];
  if (base === undefined) return 0;
  const stripes = grade.system === 'bjjBelt' ? Math.max(0, Math.min(4, grade.stripes ?? 0)) : 0;
  return Math.min(100, base + GRADE_STRIPE_POINTS * stripes);
}

const SPEC_BY_ID: Readonly<Record<string, SpecialisationSpec>> = Object.freeze(
  SPECIALISATIONS.reduce<Record<string, SpecialisationSpec>>((acc, s) => {
    acc[s.id] = s;
    return acc;
  }, {}),
);

/** Look a specialisation up by id; `undefined` for one this build does not know. */
export function specialisationById(id: string): SpecialisationSpec | undefined {
  return SPEC_BY_ID[id];
}

/** Normalise the two accepted somatotype spellings onto the blend. */
export function buildBlendOf(build: Build | BuildBlend): BuildBlend {
  if (typeof build !== 'string') return build;
  if (build === 'ectomorph') return { ecto: 0.7, meso: 0.25, endo: 0.05 };
  if (build === 'endomorph') return { ecto: 0.05, meso: 0.35, endo: 0.60 };
  return { ecto: 0.20, meso: 0.70, endo: 0.10 };
}

/** The lightest class whose limit the weigh-in mass does not exceed. */
export function weightClassFor(weighInKg: number): WeightClassId {
  const ordered: WeightClassId[] = [
    'wc.atomweight', 'wc.strawweight', 'wc.flyweight', 'wc.bantamweight', 'wc.featherweight',
    'wc.lightweight', 'wc.super_lightweight', 'wc.welterweight', 'wc.super_welterweight',
    'wc.middleweight', 'wc.super_middleweight', 'wc.light_heavyweight', 'wc.cruiserweight',
    'wc.heavyweight', 'wc.super_heavyweight',
  ];
  for (const id of ordered) {
    if (weighInKg <= WEIGHT_CLASS_LIMIT_KG[id]) return id;
  }
  return 'wc.super_heavyweight';
}
