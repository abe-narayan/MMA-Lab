/**
 * BLANK AND RANDOM FIGHTERS.
 *
 * Two generators with one requirement in common: whatever comes out must pass
 * `validateFighter` and derive without a surprise, because both feed straight
 * into the creator's form.
 *
 * `blankFighter` is the "create new" template — an average trained professional
 * at every attribute (50 is the chapter's anchor, 00 §3), untrained, with a
 * style neutral enough that the first thing the user changes is the thing they
 * came to change.
 *
 * `randomFighter` is the "randomise" button and Phase 9's batch opponent
 * source. It is seeded, and it draws from `RNG` rather than `Math.random()` for
 * the same reason the sim does: a batch of 500 matchups has to be re-runnable
 * from its seed, and "the fighter who broke it" has to be recoverable from the
 * seed alone.
 *
 * Internal consistency is what makes a random fighter usable rather than
 * merely legal. Every number is generated *from* something else in the
 * chapter's own order: class fixes height, height fixes reach and leg reach,
 * the tier fixes the training years, the years fix the sub-skills through the
 * §2.3.2 prior, and the years fix the record. Nothing is drawn independently
 * and then reconciled, so no combination can come out contradicting itself.
 */

import {
  RNG, SUB_SKILLS, SUBMISSIONS, TECHNIQUES, WEIGHT_CLASS_LIMIT_KG,
  type BodySpec, type CoreDisciplineId, type DisciplineSkills, type FighterDefinition,
  type FighterDisciplines, type GuardStyle, type PrimaryMode, type RangeBand, type Sex,
  type Stance, type StyleSpec, type ThaiStyle,
} from '../../sim';

type FighterWeightClassId = NonNullable<BodySpec['weightClass']>;

// --------------------------------------------------------------------------
// Blank template
// --------------------------------------------------------------------------

/** An average welterweight with nothing decided yet. */
export function blankFighter(id = 'fighter.new', name = 'New Fighter'): FighterDefinition {
  return {
    schema: 1,
    id,
    name,
    short: 'NEW',
    body: {
      heightM: 1.78,
      reachM: 1.83,
      legReachM: 1.02,
      massKg: 77.1,
      weighInKg: 77.1,
      fightNightKg: 77.1,
      weightClass: 'wc.welterweight',
      ageYears: 27,
      bodyFatPct: 12,
      build: { ecto: 0.25, meso: 0.60, endo: 0.15 },
      stance: 'orthodox',
      handedness: 'right',
      dominantLeg: 'right',
      sex: 'male',
    },
    appearance: {
      skinTone: 0.5,
      hair: 'short',
      face: 'preset0',
      tattoos: [],
      shorts: 'mma_short',
      gloves: 'mma_4oz',
    },
    physical: {
      strength: 50, explosiveness: 50, speed: 50, handSpeed: 50, kickSpeed: 50,
      cardio: 50, chin: 50, bodyToughness: 50, recovery: 50, flexibility: 50,
      balance: 50, reactionTime: 50, gripStrength: 50, neckStrength: 50,
    },
    disciplines: {
      // The 5-point floor is what the derivation fills untrained disciplines
      // with anyway; showing one block gives the creator something to edit.
      mmaIntegration: {
        years: 0,
        trainingQuality: 1.0,
        sub: {
          levelChanges: 5, clinchStriking: 5, cageWork: 5, groundAndPound: 5,
          getUps: 5, transitions: 5, subDefenceUnderStrikes: 5, gameplanExecution: 5,
        },
      },
    },
    mental: {
      fightIQ: 50, aggression: 50, composure: 50, heart: 50, discipline: 50, adaptability: 50,
    },
    record: {
      proWins: 0, proLosses: 0, proDraws: 0, amWins: 0, amLosses: 0,
      koLosses: 0, knockdownsSuffered: 0, titleFights: 0, layoffMonths: 0, bigFightComposure: 50,
      pro: { wins: 0, losses: 0, draws: 0, noContests: 0, koWins: 0, subWins: 0, decWins: 0, koLosses: 0, subLosses: 0, decLosses: 0 },
      amateur: { wins: 0, losses: 0 },
      daysSinceLastBout: 0,
      lastResult: 'none',
      lastResultWasKoLoss: false,
      stanceExposure: { orthodox: 0, southpaw: 0 },
      weightCut: { cutPct: 0, regainPct: 0, residualDehydration: 0 },
      winStreak: 0,
    },
    style: {
      primaryMode: 'allRounder',
      preferredRange: 'mid',
      favouriteTechniques: [{ techId: 'tech.jab', weight: 1 }, { techId: 'tech.cross', weight: 1 }],
      favouriteCombos: [],
      goToSubmissions: [],
      takedownPreferences: { prefs: [], setup: 'naked', cageBias: 0.5 },
      whenLosing: 'hold',
      initiative: 'balanced',
      pressureBias: 50,
      fallbackMode: 'grinder',
      bottomPriority: ['standUp', 'sweep', 'submit'],
      topPriority: ['control', 'strike', 'pass', 'submit'],
      hurtBehaviour: 'clinch',
      losingBehaviour: 'unchanged',
      tiredBehaviour: 'coast',
      stanceSwitching: 10,
      pacing: [],
      guardStyle: 'highGuard',
    },
    notes: '',
  };
}

// --------------------------------------------------------------------------
// Population tables (01 §2.1)
// --------------------------------------------------------------------------

interface ClassProfile {
  /** Mean male stature for the class, m (01 §2.1 "height by class prior"). */
  heightM: number;
  bodyFatPct: number;
  /** Median post-weigh-in regain, % (LIT_B §2.8). */
  regainPct: number;
  /** Relative frequency in the generator, roughly the real roster shape. */
  weight: number;
}

const CLASS_PROFILES: Readonly<Record<string, ClassProfile>> = {
  'wc.flyweight': { heightM: 1.66, bodyFatPct: 8, regainPct: 9.4, weight: 8 },
  'wc.bantamweight': { heightM: 1.69, bodyFatPct: 8, regainPct: 9.7, weight: 12 },
  'wc.featherweight': { heightM: 1.72, bodyFatPct: 8, regainPct: 9.0, weight: 14 },
  'wc.lightweight': { heightM: 1.76, bodyFatPct: 8, regainPct: 8.5, weight: 18 },
  'wc.welterweight': { heightM: 1.80, bodyFatPct: 9, regainPct: 8.2, weight: 16 },
  'wc.middleweight': { heightM: 1.83, bodyFatPct: 9, regainPct: 5.8, weight: 12 },
  'wc.light_heavyweight': { heightM: 1.87, bodyFatPct: 10, regainPct: 4.5, weight: 10 },
  'wc.heavyweight': { heightM: 1.90, bodyFatPct: 14, regainPct: 3.0, weight: 10 },
};

const CLASS_IDS = Object.keys(CLASS_PROFILES) as FighterWeightClassId[];

/** Realistic tier mix: most fighters are regional, almost nobody is a champion. */
const TIER_WEIGHTS = [4, 10, 20, 32, 24, 10];

/** Training years that put a discipline squarely in each tier through §2.3.2. */
const TIER_YEARS = [0.2, 0.8, 2.5, 6, 11, 17];
const TIER_QUALITY = [0.6, 0.7, 0.85, 0.95, 1.05, 1.15];

const STRIKING_POOL: CoreDisciplineId[] = ['boxing', 'muayThai', 'kickboxing', 'karate', 'taekwondo'];
const GRAPPLING_POOL: CoreDisciplineId[] = ['wrestling', 'judo', 'bjj', 'sambo'];

const FIRST_NAMES = [
  'Alex', 'Marcus', 'Dmitri', 'Kai', 'Tomas', 'Ibrahim', 'Sione', 'Rafael', 'Jun', 'Liam',
  'Ana', 'Mira', 'Yuki', 'Nadia', 'Elena', 'Priya', 'Sofia', 'Amara', 'Ingrid', 'Rosa',
];
const LAST_NAMES = [
  'Vargas', 'Okafor', 'Petrov', 'Lindqvist', 'Nakamura', 'Silva', 'Duarte', 'Kowalski',
  'Ferreira', 'Mwangi', 'Halvorsen', 'Tanaka', 'Rivera', 'Bokhari', 'Novak', 'Delgado',
  'Sorensen', 'Adeyemi', 'Castillo', 'Marchetti',
];

// --------------------------------------------------------------------------
// Random fighter
// --------------------------------------------------------------------------

export interface RandomOptions {
  weightClass?: FighterWeightClassId;
  sex?: Sex;
  /** Force the overall level, 0-5. Phase 9 uses this to build a tier ladder. */
  tier?: number;
  name?: string;
  /** Force the leading discipline rather than drawing one. */
  primaryDiscipline?: CoreDisciplineId;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const round = (v: number, dp = 2): number => Math.round(v * 10 ** dp) / 10 ** dp;

/** 01 §2.3.2 years -> skill prior. The single source of a generated skill level. */
export function yearsToSkill(years: number, quality: number): number {
  return clamp(100 * quality * years / (years + 3.5), 0, 100);
}

/**
 * A plausible, internally consistent fighter. Deterministic in `seed`: the same
 * seed and options always produce a byte-identical definition.
 */
export function randomFighter(seed: string, opts: RandomOptions = {}): FighterDefinition {
  const rng = new RNG(`fighter::${seed}`);

  // ---- identity ----------------------------------------------------------
  const sex: Sex = opts.sex ?? (rng.chance(0.25) ? 'female' : 'male');
  const first = FIRST_NAMES[sex === 'female' ? 10 + rng.int(10) : rng.int(10)];
  const last = LAST_NAMES[rng.int(LAST_NAMES.length)];
  const name = opts.name ?? `${first} ${last}`;
  const short = last.slice(0, 3).toUpperCase();

  // ---- level -------------------------------------------------------------
  const tier = opts.tier !== undefined ? clamp(Math.round(opts.tier), 0, 5) : rng.weighted(TIER_WEIGHTS);

  // ---- body (§2.1) -------------------------------------------------------
  const weightClass = opts.weightClass ?? CLASS_IDS[rng.weighted(CLASS_IDS.map((c) => CLASS_PROFILES[c].weight))];
  const profile = CLASS_PROFILES[weightClass] ?? CLASS_PROFILES['wc.welterweight'];
  const limit = WEIGHT_CLASS_LIMIT_KG[weightClass];

  // Women are shorter at the same limit; the class limit already sets the mass.
  const heightM = round(clamp(rng.normal(profile.heightM - (sex === 'female' ? 0.09 : 0), 0.05), 1.50, 2.02), 3);
  const reachM = round(clamp(heightM * rng.normal(1.026, 0.028), heightM * 0.92, heightM * 1.14), 3);
  const legReachM = round(clamp(heightM * rng.normal(0.575, 0.020), heightM * 0.52, heightM * 0.63), 3);

  const weighInKg = round(clamp(limit - rng.range(0, 1.2), 40, 160), 1);
  const fightNightKg = round(weighInKg * (1 + profile.regainPct / 100), 1);
  const bodyFatPct = round(clamp(rng.normal(profile.bodyFatPct + (sex === 'female' ? 5 : 0), 1.5), 5, 28), 1);

  const stance: Stance = (['orthodox', 'southpaw', 'switch'] as const)[rng.weighted([76.6, 17.1, 6.1])];
  // `P(left-handed | southpaw) = 0.60`; otherwise the population base rate.
  const leftChance = stance === 'southpaw' ? 0.60 : sex === 'female' ? 0.099 : 0.126;
  const handedness = rng.chance(leftChance) ? 'left' : 'right';

  // ---- training (§2.3) ---------------------------------------------------
  const years = TIER_YEARS[tier];
  const quality = TIER_QUALITY[tier];
  const primary = opts.primaryDiscipline
    ?? (rng.chance(0.55) ? STRIKING_POOL[rng.int(STRIKING_POOL.length)] : GRAPPLING_POOL[rng.int(GRAPPLING_POOL.length)]);
  const complementPool = STRIKING_POOL.includes(primary) ? GRAPPLING_POOL : STRIKING_POOL;
  const secondary = complementPool[rng.int(complementPool.length)];

  const disciplines: FighterDisciplines = {};
  assign(disciplines, primary, discipline(rng, primary, years * rng.range(0.8, 1.0), quality));
  assign(disciplines, secondary, discipline(rng, secondary, years * rng.range(0.30, 0.60), quality * 0.9));
  assign(disciplines, 'mmaIntegration', discipline(rng, 'mmaIntegration', years * rng.range(0.4, 0.8), quality));

  // An 18-year-old with eleven years of training would be a warning, so age is
  // built up from the training instead of drawn beside it.
  const ageYears = round(clamp(17 + years + rng.normal(4, 2.5), 18, 44), 1);

  // ---- attributes (§2.2, §2.5) -------------------------------------------
  const athleticBase = 34 + tier * 7;
  const attr = (offset = 0, sd = 6): number =>
    Math.round(clamp(rng.normal(athleticBase + offset, sd), 5, 96));
  // Heavier fighters trade cardio and speed for strength (01 §2.2.1).
  const heavy = clamp((fightNightKg - 70) / 50, -0.4, 1);
  const physical = {
    strength: attr(10 * heavy),
    explosiveness: attr(4 * heavy),
    speed: attr(-6 * heavy),
    handSpeed: attr(-4 * heavy),
    kickSpeed: attr(-6 * heavy),
    cardio: attr(-10 * heavy),
    chin: attr(),
    bodyToughness: attr(),
    recovery: attr(-4 * heavy),
    flexibility: attr(),
    balance: attr(),
    reactionTime: attr(),
    gripStrength: attr(6 * heavy),
    neckStrength: attr(6 * heavy),
  };

  // The T5 gate (§2.3.4) is a mental gate, so a champion is generated with the
  // head to match; anything else derives back down to T4.
  const mentalBase = tier >= 5 ? 86 : 30 + tier * 11;
  const iqFloor = tier >= 5 ? 80 : 5;
  const composureFloor = tier >= 5 ? 75 : 5;
  const mental = {
    fightIQ: Math.round(clamp(rng.normal(mentalBase, 5), iqFloor, 97)),
    aggression: Math.round(clamp(rng.normal(52, 14), 5, 95)),
    composure: Math.round(clamp(rng.normal(mentalBase - 2, 5), composureFloor, 97)),
    heart: Math.round(clamp(rng.normal(58, 12), 10, 97)),
    discipline: Math.round(clamp(rng.normal(mentalBase - 4, 8), 10, 97)),
    adaptability: Math.round(clamp(rng.normal(mentalBase - 6, 7), 5, 95)),
  };

  // ---- record (§2.4) -----------------------------------------------------
  const record = careerFor(rng, tier, mental.composure);

  return {
    schema: 1,
    id: `fighter.${seed.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'random'}`,
    name,
    short,
    body: {
      heightM,
      reachM,
      legReachM,
      massKg: fightNightKg,
      weighInKg,
      fightNightKg,
      weightClass,
      ageYears,
      bodyFatPct,
      build: buildBlendFor(rng, heavy),
      stance,
      handedness,
      dominantLeg: handedness,
      sex,
    },
    appearance: {
      skinTone: round(rng.next(), 2),
      hair: 'short',
      face: `preset${rng.int(8)}`,
      tattoos: [],
      shorts: 'mma_short',
      gloves: 'mma_4oz',
    },
    physical,
    disciplines,
    mental,
    record,
    style: styleFor(rng, primary, tier, mental),
    notes: `Generated from seed "${seed}".`,
  };
}

function assign(into: FighterDisciplines, id: CoreDisciplineId, block: DisciplineSkills): void {
  // The typed per-discipline blocks are narrower than the generic one this
  // builds, and the sub-skill keys come from `SUB_SKILLS` so they do match.
  (into as Record<string, DisciplineSkills>)[id] = block;
}

/** Sub-skills as `S(years, quality) + N(0, 8)`, exactly as 01 §2.3.2 specifies. */
function discipline(rng: RNG, id: CoreDisciplineId, years: number, quality: number): DisciplineSkills {
  const level = yearsToSkill(years, quality);
  const sub: Record<string, number> = {};
  for (const key of SUB_SKILLS[id]) sub[key] = Math.round(clamp(level + rng.normal(0, 8), 1, 99));
  return { years: round(years, 1), trainingQuality: round(clamp(quality, 0.6, 1.15), 2), sub, styleTags: [] };
}

function buildBlendFor(rng: RNG, heavy: number): { ecto: number; meso: number; endo: number } {
  const endo = round(clamp(0.10 + 0.15 * heavy + rng.range(-0.04, 0.04), 0.02, 0.40));
  const ecto = round(clamp(0.28 - 0.18 * heavy + rng.range(-0.05, 0.05), 0.02, 0.50));
  // Meso absorbs the rounding so the blend still sums to 1 (01 §2.1).
  return { ecto, meso: round(1 - ecto - endo), endo };
}

/** Bouts, then the method split, so the counters never contradict each other. */
function careerFor(rng: RNG, tier: number, composure: number): FighterDefinition['record'] {
  const bouts = [0, 1, 4, 11, 20, 28][tier] + rng.int(4);
  const wins = Math.round(bouts * rng.range(0.55, 0.88));
  const losses = bouts - wins;
  const split = (n: number): [number, number, number] => {
    const ko = rng.int(n + 1);
    const sub = rng.int(n - ko + 1);
    return [ko, sub, n - ko - sub];
  };
  const [koWins, subWins, decWins] = split(wins);
  const [koLosses, subLosses, decLosses] = split(losses);
  const amWins = rng.int(6);
  const amLosses = rng.int(4);
  const days = 60 + rng.int(500);

  return {
    proWins: wins,
    proLosses: losses,
    proDraws: 0,
    amWins,
    amLosses,
    koLosses,
    knockdownsSuffered: koLosses + rng.int(3),
    titleFights: tier >= 4 ? rng.int(4) : 0,
    layoffMonths: round(days / 30.4375, 1),
    bigFightComposure: Math.round(clamp(composure + rng.normal(-6, 8), 5, 95)),
    pro: { wins, losses, draws: 0, noContests: 0, koWins, subWins, decWins, koLosses, subLosses, decLosses },
    amateur: { wins: amWins, losses: amLosses },
    daysSinceLastBout: days,
    lastResult: bouts === 0 ? 'none' : rng.chance(0.7) ? 'win' : 'loss',
    lastResultWasKoLoss: false,
    stanceExposure: { orthodox: Math.round(bouts * 0.8), southpaw: Math.round(bouts * 0.2) },
    weightCut: {
      cutPct: round(rng.range(3, 9), 1),
      regainPct: round(rng.range(3, 9), 1),
      residualDehydration: round(rng.range(0, 0.02), 3),
    },
    winStreak: losses === 0 ? wins : rng.int(4),
  };
}

// --------------------------------------------------------------------------
// Style
// --------------------------------------------------------------------------

interface StyleSeed {
  mode: PrimaryMode;
  fallback: PrimaryMode;
  range: RangeBand;
  guard: GuardStyle;
  thai?: ThaiStyle;
}

const STYLE_BY_DISCIPLINE: Readonly<Record<CoreDisciplineId, StyleSeed>> = {
  boxing: { mode: 'pressureStriking', fallback: 'clinchGrind', range: 'mid', guard: 'highGuard' },
  muayThai: { mode: 'pressureStriking', fallback: 'clinchGrind', range: 'short', guard: 'thai', thai: 'muayFemur' },
  kickboxing: { mode: 'distanceStriking', fallback: 'pressureStriking', range: 'mid', guard: 'hybrid' },
  karate: { mode: 'counter', fallback: 'distanceStriking', range: 'long', guard: 'philly' },
  taekwondo: { mode: 'pointFighter', fallback: 'distanceStriking', range: 'long', guard: 'longGuard' },
  wrestling: { mode: 'wrestleControl', fallback: 'clinchGrind', range: 'short', guard: 'highGuard' },
  judo: { mode: 'clinchGrind', fallback: 'wrestleControl', range: 'clinch', guard: 'highGuard' },
  bjj: { mode: 'guardPlayer', fallback: 'submissionHunt', range: 'ground', guard: 'hybrid' },
  sambo: { mode: 'submissionHunt', fallback: 'wrestleControl', range: 'ground', guard: 'hybrid' },
  mmaIntegration: { mode: 'allRounder', fallback: 'grinder', range: 'mid', guard: 'hybrid' },
};

/**
 * Favourites are drawn from the live catalogues rather than written down here,
 * so a generated fighter can never reference an id chapter 02 or 04 has
 * renamed, and a T1 never nominates a spinning technique he cannot throw.
 */
function styleFor(
  rng: RNG, primary: CoreDisciplineId, tier: number, mental: { aggression: number },
): StyleSpec {
  const seed = STYLE_BY_DISCIPLINE[primary];
  const legal = TECHNIQUES.filter((t) => t.minTier <= tier);
  const pool = legal.length > 0 ? legal : TECHNIQUES;

  const picked = new Set<string>();
  const favouriteTechniques = [];
  for (let i = 0; i < 3 && picked.size < pool.length; i++) {
    let id = pool[rng.int(pool.length)].id;
    while (picked.has(id)) id = pool[rng.int(pool.length)].id;
    picked.add(id);
    favouriteTechniques.push({ techId: id, weight: round(rng.range(1.0, 1.5), 2) });
  }

  const subs = new Set<string>();
  const goToSubmissions = [];
  for (let i = 0; i < 2 && subs.size < SUBMISSIONS.length; i++) {
    let id = SUBMISSIONS[rng.int(SUBMISSIONS.length)].id;
    while (subs.has(id)) id = SUBMISSIONS[rng.int(SUBMISSIONS.length)].id;
    subs.add(id);
    goToSubmissions.push({ subId: id, weight: round(rng.range(0.8, 1.5), 2) });
  }

  const pressureBias = Math.round(clamp(mental.aggression + rng.normal(0, 10), 0, 100));
  const grappler = GRAPPLING_POOL.includes(primary);

  return {
    primaryMode: seed.mode,
    preferredRange: seed.range,
    favouriteTechniques,
    // Combos are left to 07's generator: a random sequence of catalogue ids is
    // as likely to be nonsense as it is to be a combination.
    favouriteCombos: [],
    goToSubmissions,
    takedownPreferences: {
      prefs: [],
      setup: grappler ? 'offSingleStrike' : 'reactive',
      cageBias: round(grappler ? rng.range(0.4, 0.8) : rng.range(0.1, 0.4), 2),
    },
    whenLosing: rng.chance(0.6) ? 'press' : 'hold',
    initiative: pressureBias > 60 ? 'pressure' : pressureBias < 40 ? 'counter' : 'balanced',
    pressureBias,
    fallbackMode: seed.fallback,
    bottomPriority: grappler ? ['sweep', 'submit', 'standUp'] : ['standUp', 'sweep', 'submit'],
    topPriority: grappler ? ['control', 'pass', 'submit', 'strike'] : ['control', 'strike', 'pass', 'submit'],
    hurtBehaviour: rng.chance(0.5) ? 'clinch' : 'coverOnCage',
    losingBehaviour: rng.chance(0.5) ? 'stealRound' : 'finishSeek',
    tiredBehaviour: rng.chance(0.5) ? 'clinchRest' : 'coast',
    stanceSwitching: Math.round(clamp(rng.normal(12, 8), 0, 100)),
    pacing: [],
    guardStyle: seed.guard,
    ...(seed.thai ? { thaiStyle: seed.thai } : {}),
  };
}
