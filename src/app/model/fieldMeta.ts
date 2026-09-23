/**
 * FIELD METADATA — what every editable field means, in the chapter's own terms.
 *
 * The creator's tooltips are not decoration. A number the user can move but
 * cannot interpret is a slot machine; the point of this table is that every
 * control says which formula downstream reads it, so moving a slider is an
 * informed act. Every sentence here is a compression of
 * docs/design/01_FIGHTER_MODEL.md §2.1-§2.7 — when that chapter changes, this
 * table is what has to change with it.
 *
 * Bounds are the editor's clamp, not the sim's: the sim tolerates anything,
 * but a definition outside these ranges is one the calibration ladder has
 * never seen, so the creator keeps the user inside them.
 */

import type { ClampSpec } from './paths';

export interface FieldMeta {
  label: string;
  /** One sentence: what this field feeds. Shown as a tooltip and helper line. */
  help: string;
  /** Unit suffix shown beside the value, e.g. 'm', 'kg', '%'. */
  unit?: string;
  clamp?: ClampSpec;
}

/** The 0-100 attribute scale every physical, mental and sub-skill shares. */
export const ATTRIBUTE_CLAMP: ClampSpec = { min: 0, max: 100, dp: 0 };

export const ATTRIBUTE_SCALE_NOTE =
  '0-100. 50 is an average trained professional in this weight class, 80+ is elite, ' +
  '95+ is an outlier.';

// --------------------------------------------------------------------------
// Physical (01 §2.2) — fourteen attributes
// --------------------------------------------------------------------------

export const PHYSICAL_META: Readonly<Record<string, FieldMeta>> = Object.freeze({
  strength: {
    label: 'Strength',
    help: 'Maximal force. Feeds the power index, grappling strength, clinch power, takedown finishes and pins. 50 = 4.0x bodyweight lift total, 80 = 5.5x.',
    clamp: ATTRIBUTE_CLAMP,
  },
  explosiveness: {
    label: 'Explosiveness',
    help: 'Rate of force development. Feeds strike acceleration, shot and sprawl speed, and PCr burst efficiency. 50 = 40 cm jump, 80 = 52 cm.',
    clamp: ATTRIBUTE_CLAMP,
  },
  speed: {
    label: 'Foot speed',
    help: 'Footwork velocity; drives in-and-out movement, angles and cage escapes. footSpeed = 2.0 + 0.0133x(speed-50) m/s.',
    clamp: ATTRIBUTE_CLAMP,
  },
  handSpeed: {
    label: 'Hand speed',
    help: 'Fist velocity at impact. Scales punch execution time, telegraph and the hand term of the power index. handSpeed = 8.0 + 0.0433x(v-50) m/s.',
    clamp: ATTRIBUTE_CLAMP,
  },
  kickSpeed: {
    label: 'Kick speed',
    help: 'Foot velocity at impact on a roundhouse. Scales kick execution time and kick force. kickSpeed = 6.5 + 0.0267x(v-50) m/s.',
    clamp: ATTRIBUTE_CLAMP,
  },
  cardio: {
    label: 'Cardio',
    help: 'Aerobic capacity. Sets PCr refill half-life, lactate clearance and the AI’s pace targets. 50 = VO2max 55 ml/kg/min, 95 = 70.',
    clamp: ATTRIBUTE_CLAMP,
  },
  chin: {
    label: 'Chin',
    help: 'Tolerance to rotational head acceleration. Shifts the knockout logistic by -0.02 per point above 50, after age and KO-history decay.',
    clamp: ATTRIBUTE_CLAMP,
  },
  bodyToughness: {
    label: 'Body toughness',
    help: 'Pain tolerance for body and leg trauma. Moves the body/leg state thresholds by up to +/-25%.',
    clamp: ATTRIBUTE_CLAMP,
  },
  recovery: {
    label: 'Recovery',
    help: 'Speed of acute recovery from rocked and body-hurt states, and the between-round refill. Scales acute half-lives by up to +/-30%.',
    clamp: ATTRIBUTE_CLAMP,
  },
  flexibility: {
    label: 'Flexibility',
    help: 'Hip, hamstring and shoulder range. Gates head kicks and their quality, plus rubber guard, triangles and some lock escapes.',
    clamp: ATTRIBUTE_CLAMP,
  },
  balance: {
    label: 'Balance',
    help: 'Single-leg and post-contact stability. Cuts post-kick stumbles and feeds the takedown-defence base and sweep/trip resistance.',
    clamp: ATTRIBUTE_CLAMP,
  },
  reactionTime: {
    label: 'Reaction time',
    help: 'Simple visual reaction latency, higher is faster. latency = 225 - 0.65x(v-50) ms, so 50 = 225 ms and 95 = 196 ms. Gates the slip and sprawl windows.',
    clamp: ATTRIBUTE_CLAMP,
  },
  gripStrength: {
    label: 'Grip strength',
    help: 'Grip edges in the clinch and on the ground: control, squeezes and submission grips. Fatigue erodes it faster than raw strength.',
    clamp: ATTRIBUTE_CLAMP,
  },
  neckStrength: {
    label: 'Neck strength',
    help: 'Neck bracing that damps head acceleration in the KO model. neckMult = 1.15 - 0.30x(v/100), so 80 gives x0.91 effective impact.',
    clamp: ATTRIBUTE_CLAMP,
  },
});

/** Editing order for the physical tab — grouped the way a coach would list them. */
export const PHYSICAL_GROUPS: readonly { title: string; keys: readonly string[] }[] = Object.freeze([
  { title: 'Force', keys: ['strength', 'explosiveness', 'gripStrength'] },
  { title: 'Velocity', keys: ['speed', 'handSpeed', 'kickSpeed', 'reactionTime'] },
  { title: 'Engine', keys: ['cardio', 'recovery'] },
  { title: 'Durability', keys: ['chin', 'neckStrength', 'bodyToughness'] },
  { title: 'Control', keys: ['balance', 'flexibility'] },
]);

// --------------------------------------------------------------------------
// Mental (01 §2.5) — six attributes
// --------------------------------------------------------------------------

export const MENTAL_META: Readonly<Record<string, FieldMeta>> = Object.freeze({
  fightIQ: {
    label: 'Fight IQ',
    help: 'Perception, planning and decision quality. Sets the scouting-noise tier, plan branching, score-estimate error and read probability. Also gates tier 5.',
    clamp: ATTRIBUTE_CLAMP,
  },
  aggression: {
    label: 'Aggression',
    help: 'Initiative and finishing appetite. attackShare = 0.33 + 0.30x(v-50)/50; 75+ switches on reckless finishing.',
    clamp: ATTRIBUTE_CLAMP,
  },
  composure: {
    label: 'Composure',
    help: 'Resistance to arousal. Scales the adrenaline dump, the rocked-state decision penalty and corner uptake. Low composure burns round 1 and pays in round 2.',
    clamp: ATTRIBUTE_CLAMP,
  },
  heart: {
    label: 'Heart',
    help: 'Willingness to keep working hurt, tired or behind. Sets submission stubbornness, continuing under body damage and corner-stoppage resistance.',
    clamp: ATTRIBUTE_CLAMP,
  },
  discipline: {
    label: 'Discipline',
    help: 'Adherence to the game plan and to pacing. P(abandon plan when hit) = 0.6x(1 - v/100); also lowers the residual dehydration of a weight cut.',
    clamp: ATTRIBUTE_CLAMP,
  },
  adaptability: {
    label: 'Adaptability',
    help: 'Willingness to change behaviour on evidence — fight IQ decides whether the change is a good one. Raises P(change | signal) and shortens minimum dwell.',
    clamp: ATTRIBUTE_CLAMP,
  },
});

// --------------------------------------------------------------------------
// Body (01 §2.1)
// --------------------------------------------------------------------------

export const BODY_META: Readonly<Record<string, FieldMeta>> = Object.freeze({
  heightM: {
    label: 'Height',
    unit: 'm',
    help: 'Stature. Drives the whole rig — shoulder width 0.20xH, head 0.13xH, torso — and the reference mass 23.5xH². Pooled mean is 1.775 m.',
    clamp: { min: 1.40, max: 2.20, dp: 3 },
  },
  reachM: {
    label: 'Reach',
    unit: 'm',
    help: 'Fingertip-to-fingertip wingspan. Sets arm length and effective reach, which striking and the AI scale by reach leverage. Typical is height x 1.026.',
    clamp: { min: 1.40, max: 2.40, dp: 3 },
  },
  legReachM: {
    label: 'Leg reach',
    unit: 'm',
    help: 'Hip joint to heel. Becomes the rig’s leg length and sets effective kick reach = legReach + 0.15 m. Typically 0.575 x height.',
    clamp: { min: 0.70, max: 1.35, dp: 3 },
  },
  massKg: {
    label: 'Mass',
    unit: 'kg',
    help: 'Single-mass fallback. Fills weigh-in and fight-night mass when those are left blank; otherwise the two below are what the sim reads.',
    clamp: { min: 40, max: 180, dp: 1 },
  },
  weighInKg: {
    label: 'Weigh-in mass',
    unit: 'kg',
    help: 'Official weigh-in mass. Chooses the weight class and, with the regain, the fight-night mass.',
    clamp: { min: 40, max: 180, dp: 1 },
  },
  fightNightKg: {
    label: 'Fight-night mass',
    unit: 'kg',
    help: 'Mass at the first bell. This is the mass the sim actually uses: mass index ln(kg/77.1), the physique term of punch power, grappling strength and the fatigue cost of carrying it.',
    clamp: { min: 40, max: 200, dp: 1 },
  },
  ageYears: {
    label: 'Age',
    unit: 'yr',
    help: 'Age at the fight. Applies the age curves to every physical attribute and the cumulative chin decay; pace drops 1.5%/yr past 33. Skill and mental do not age.',
    clamp: { min: 16, max: 55, dp: 1 },
  },
  bodyFatPct: {
    label: 'Body fat',
    unit: '%',
    help: 'Conditioning marker. Widens the waist of the rig and cuts muscle definition; it is not a performance term on its own.',
    clamp: { min: 3, max: 45, dp: 1 },
  },
});

export const BUILD_META: Readonly<Record<string, FieldMeta>> = Object.freeze({
  ecto: {
    label: 'Ecto',
    help: 'Linear share of the somatotype. Narrows the chest and limbs.',
    clamp: { min: 0, max: 1, dp: 2 },
  },
  meso: {
    label: 'Meso',
    help: 'Muscular share. Widens shoulders and chest, so two fighters of equal height clinch differently.',
    clamp: { min: 0, max: 1, dp: 2 },
  },
  endo: {
    label: 'Endo',
    help: 'Round share. Adds bulk through the waist.',
    clamp: { min: 0, max: 1, dp: 2 },
  },
});

// --------------------------------------------------------------------------
// Record (01 §2.4)
// --------------------------------------------------------------------------

export const RECORD_META: Readonly<Record<string, FieldMeta>> = Object.freeze({
  proWins: { label: 'Pro wins', help: 'Professional wins. The pro total feeds the experience scalar and the default big-fight composure.', clamp: { min: 0, max: 120, dp: 0 } },
  proLosses: { label: 'Pro losses', help: 'Professional losses. Counted in the experience total alongside wins.', clamp: { min: 0, max: 120, dp: 0 } },
  proDraws: { label: 'Pro draws', help: 'Professional draws, counted in the total bouts contested.', clamp: { min: 0, max: 40, dp: 0 } },
  amWins: { label: 'Amateur wins', help: 'Amateur wins. Amateur bouts count half toward the experience scalar.', clamp: { min: 0, max: 200, dp: 0 } },
  amLosses: { label: 'Amateur losses', help: 'Amateur losses. Also counted at half weight.', clamp: { min: 0, max: 200, dp: 0 } },
  koLosses: {
    label: 'Losses by KO',
    help: 'Permanently decays the chin: -3 points per KO loss, capped at four, and raises the KO-history multiplier to 1 + 0.25x that count.',
    clamp: { min: 0, max: 30, dp: 0 },
  },
  knockdownsSuffered: {
    label: 'Knockdowns suffered',
    help: 'Career knockdowns absorbed. -1 chin point each, capped at five — the gradient behind the real 13.9% to 25.3% KO-loss rise.',
    clamp: { min: 0, max: 60, dp: 0 },
  },
  titleFights: {
    label: 'Title fights',
    help: 'Championship bouts contested. Raises the default big-fight composure by 3 each, capped at five.',
    clamp: { min: 0, max: 30, dp: 0 },
  },
  layoffMonths: {
    label: 'Layoff',
    unit: 'mo',
    help: 'Months since the last bout. Past ~7 months costs composure, reaction, cardio and reads; past a year the penalty doubles.',
    clamp: { min: 0, max: 120, dp: 1 },
  },
  bigFightComposure: {
    label: 'Big-fight composure',
    help: 'Composure under maximum event magnitude. The bout blends it with composure by how big the card is: 1.0 title, 0.6 regional, 0.3 amateur.',
    clamp: ATTRIBUTE_CLAMP,
  },
});

// --------------------------------------------------------------------------
// Style (01 §2.6)
// --------------------------------------------------------------------------

export const STYLE_META: Readonly<Record<string, FieldMeta>> = Object.freeze({
  primaryMode: {
    label: 'Primary mode',
    help: 'The default game-plan archetype the AI keys its plan table on. Descriptive, not prescriptive: a mode the sub-skills cannot support is still selected and simply executed badly.',
  },
  fallbackMode: {
    label: 'Fallback mode',
    help: 'What the plan becomes when the primary mode stops working.',
  },
  preferredRange: {
    label: 'Preferred range',
    help: 'Where this fighter wants the fight. Biases the range-seeking action weights.',
  },
  initiative: {
    label: 'Initiative',
    help: 'Whether the fighter leads, waits, or points-fights. Sits alongside the pressure bias.',
  },
  pressureBias: {
    label: 'Pressure bias',
    help: 'Multiplies the AI’s pressure-versus-counter action weights. 0 is a pure counter fighter, 100 walks you down.',
    clamp: ATTRIBUTE_CLAMP,
  },
  stanceSwitching: {
    label: 'Stance switching',
    help: 'Propensity to switch mid-fight, which resets lead-side geometry and the opponent’s stance familiarity. Needs the switch stance for full effect.',
    clamp: ATTRIBUTE_CLAMP,
  },
  whenLosing: {
    label: 'When losing',
    help: 'What the fighter does once they believe they are behind on their own score estimate.',
  },
  losingBehaviour: {
    label: 'Losing behaviour',
    help: 'The richer form of the same decision, read by the AI’s plan table.',
  },
  hurtBehaviour: {
    label: 'When hurt',
    help: 'The reflex when rocked. Discipline and heart decide whether the fighter actually manages it.',
  },
  tiredBehaviour: {
    label: 'When tired',
    help: 'The reflex once the aerobic debt bites.',
  },
  guardStyle: { label: 'Guard style', help: 'Hands and frame shape; feeds strike-defence geometry and the presentation rig.' },
  thaiStyle: { label: 'Thai style', help: 'Muay Thai sub-style tag: femur, khao, mat, tae or Dutch.' },
  refusesToTap: {
    label: 'Refuses to tap',
    help: 'Floors submission stubbornness at 0.5. A fighter who will break before they tap.',
  },
  cageBias: {
    label: 'Cage bias',
    help: 'Preference for finishing takedowns on the fence rather than in open space. 0 to 1.',
    clamp: { min: 0, max: 1, dp: 2 },
  },
  takedownSetup: {
    label: 'Takedown setup',
    help: 'How the level change is entered. A naked shot against a good wrestler is the T0/T1 tell.',
  },
});

export const DISCIPLINE_META: Readonly<Record<string, FieldMeta>> = Object.freeze({
  years: {
    label: 'Years trained',
    unit: 'yr',
    help: 'Training age. Caps the derived tier: under 0.25 yr is T0, under 1 T1, under 4 T2, under 8 T3, and a fighter may sit one tier above the cap. What one year is worth is then scaled by the volume, camp and start age below.',
    clamp: { min: 0, max: 45, dp: 1 },
  },
  trainingQuality: {
    label: 'Training quality',
    help: 'Camp quality, 0.6 hobbyist to 1.15 elite. The generator uses it to set the sub-skills; the per-art coach quality below is what the derivation reads.',
    clamp: { min: 0.5, max: 1.2, dp: 2 },
  },

  // --- 01 §8.1 per-art depth ---------------------------------------------
  startAge: {
    label: 'Start age',
    unit: 'yr',
    help: 'Age at the first session in this art. Below 18 each training year counts for more — up to x1.20 for a childhood start — because the motor programme laid down then is deeper. 18 or above is neutral.',
    clamp: { min: 3, max: 45, dp: 0 },
  },
  hoursPerWeek: {
    label: 'Hours / week',
    unit: 'h',
    help: 'Mat or ring hours in a normal block. Scales what a training year is worth as sqrt(hours/8), so doubling the hours is worth about 40 % more, not 100 %. Capped at x1.6 with sessions.',
    clamp: { min: 0, max: 40, dp: 1 },
  },
  sessionsPerWeek: {
    label: 'Sessions / week',
    unit: '#',
    help: 'How the hours are spread. Frequency helps — distributed practice beats massed — but at a quarter power, so it matters less than total volume. 5 is neutral.',
    clamp: { min: 0, max: 14, dp: 0 },
  },
  sparringIntensity: {
    label: 'Sparring intensity',
    help: 'How live the training is. Multiplies every effective sub-skill in this art by 1 ± 6 % across the range: skill learned against a resisting partner is the skill that shows up. 50 is ordinary club sparring.',
    clamp: ATTRIBUTE_CLAMP,
  },
  monthsSinceTrained: {
    label: 'Months since last trained',
    unit: 'mo',
    help: 'Rust. Every sub-skill in this art decays exp(-(months - 3)/54), floored at x0.70 — technique is retained for years, but not untouched. Rusted values are also what transfers to other arts.',
    clamp: { min: 0, max: 360, dp: 0 },
  },
  coachQuality: {
    label: 'Coach quality',
    help: 'The coaching in this art specifically, 0-100. Moves what a training year is worth by ±15 %, which moves the years cap on the derived tier. 50 is neutral.',
    clamp: ATTRIBUTE_CLAMP,
  },
  isBase: {
    label: 'Base art',
    help: 'The art this fighter came up in. Each training year in it counts x1.15, because the base art is the one everything else was hung on. Set it on at most one discipline.',
  },
  grade: {
    label: 'Grade',
    help: 'Belt, dan, credential or amateur class. A grade is an independent observation of the art, so it floors every effective sub-skill at 85 % of the rank prior rather than adding to them — it cannot make a skill worse, and it will not push a good one higher.',
  },
  stripes: {
    label: 'Stripes',
    help: 'BJJ stripes on the current belt; each adds 2.5 points to the rank prior. Ignored by every other grading system.',
    clamp: { min: 0, max: 4, dp: 0 },
  },
  specialisations: {
    label: 'Specialisations',
    help: 'What this fighter actually does in this art. Each adds 6 points to the emphasised sub-skills and takes 2.5 off the traded ones; each further specialisation in the same art is worth 60 % of the last, because nobody has the hours for four.',
  },
});

/** Per-art competition record (01 §8.1.3). */
export const DISCIPLINE_COMPETITION_META: Readonly<Record<string, FieldMeta>> = Object.freeze({
  level: {
    label: 'Level',
    help: 'The circuit competed on. Sets the ceiling of the competition prior: local 35, national 55, international 72 — the tier band of the room, whatever your record in it.',
  },
  bouts: {
    label: 'Bouts',
    help: 'Total contests in this art. The prior saturates as 1 - e^(-bouts/12): the first few prove something, the twenty-first proves almost nothing new.',
    clamp: { min: 0, max: 400, dp: 0 },
  },
  wins: {
    label: 'Wins',
    help: 'Wins of those bouts. The win rate scales the prior between x0.70 and x1.30 — losing at a high level still means being in the room.',
    clamp: { min: 0, max: 400, dp: 0 },
  },
  losses: { label: 'Losses', help: 'Recorded for the fighter card and the win-rate sanity check.', clamp: { min: 0, max: 400, dp: 0 } },
  draws: { label: 'Draws', help: 'Recorded for the fighter card.', clamp: { min: 0, max: 100, dp: 0 } },
  amateurBouts: { label: 'Amateur bouts', help: 'The amateur share of the total, for the card. Boxing amateur counts belong here.', clamp: { min: 0, max: 400, dp: 0 } },
  amateurWins: { label: 'Amateur wins', help: 'Wins of the amateur bouts.', clamp: { min: 0, max: 400, dp: 0 } },
  proBouts: { label: 'Pro bouts', help: 'The professional share of the total, for the card.', clamp: { min: 0, max: 400, dp: 0 } },
  proWins: { label: 'Pro wins', help: 'Wins of the professional bouts.', clamp: { min: 0, max: 400, dp: 0 } },
  bestPlacing: {
    label: 'Best placing',
    help: 'The best result ever achieved. Added to the prior outright — 3 for a local podium up to 26 for an Olympic medal — because a medal is a fact about the tail, not the average.',
  },
  medals: {
    label: 'Medals',
    help: 'Medals or podiums beyond the best placing. 2 points each, capped at five.',
    clamp: { min: 0, max: 30, dp: 0 },
  },
});

/** Overall experience block (01 §8.2). */
export const EXPERIENCE_META: Readonly<Record<string, FieldMeta>> = Object.freeze({
  totalRounds: {
    label: 'Rounds fought',
    unit: '#',
    help: 'Competitive rounds actually contested. Counts as a surplus over the bout total at half weight: ten decisions teach more than ten first-round finishes, and this is the only field that knows the difference.',
    clamp: { min: 0, max: 600, dp: 0 },
  },
  yearsPro: {
    label: 'Years pro',
    unit: 'yr',
    help: 'Time in the sport since turning professional. Shown on the card and checked against age and the bout count by the validator.',
    clamp: { min: 0, max: 40, dp: 1 },
  },
  oppositionLevel: {
    label: 'Opposition level',
    help: 'Average level of the opposition faced. 50 regional, 75 ranked, 90 champions. Scales the experience composite by ±20 % and composure by ±5 points: 20-0 against nobody is worth less than 12-4 against everybody.',
    clamp: ATTRIBUTE_CLAMP,
  },
  mainEvents: {
    label: 'Main events',
    unit: '#',
    help: 'Main and co-main bouts contested. +0.8 composure each up to eight — habituation to the big room, separate from the title count.',
    clamp: { min: 0, max: 60, dp: 0 },
  },
  titleWins: {
    label: 'Titles won',
    unit: '#',
    help: 'Titles actually won of the title fights contested. Card and validator; the composure credit comes from the title fights themselves.',
    clamp: { min: 0, max: 30, dp: 0 },
  },
  warFights: {
    label: 'Hard fights taken',
    unit: '#',
    help: 'Wars: five-round grinds, fights finished on heart. -1.2 chin points each up to six. Below the per-KO-loss cost because a war is repeated sub-concussive load, not one knockout.',
    clamp: { min: 0, max: 40, dp: 0 },
  },
  hardSparringYears: {
    label: 'Hard-sparring years',
    unit: 'yr',
    help: 'Years of habitual hard sparring. -0.4 chin points per year up to fifteen: the damage a record never shows.',
    clamp: { min: 0, max: 40, dp: 1 },
  },
  experienceOverride: {
    label: 'Overall experience (override)',
    help: 'Set the experience composite directly, 0-100. When set it is what the sim uses; the derived panel keeps showing what the bouts, rounds and opposition imply beside it. Leave unset to let the record speak.',
    clamp: ATTRIBUTE_CLAMP,
  },
});

/** Physique and biography (01 §8.3, §8.4). */
export const HISTORY_META: Readonly<Record<string, FieldMeta>> = Object.freeze({
  naturalWeightKg: {
    label: 'Walk-around mass',
    unit: 'kg',
    help: 'Off-camp mass — how big this fighter naturally is. The cut it implies, (natural - weigh-in)/natural, is a floor under the authored cut percentage, so a huge natural size is paid for in residual dehydration. Leave equal to the weigh-in for a fighter who does not cut.',
    clamp: { min: 40, max: 220, dp: 1 },
  },
  handStrengthSplit: {
    label: 'Hand strength split',
    help: 'How lopsided the power is. 50 is even; 100 is everything in the dominant hand, which scales lead-hand power down by 35 %. The one-punch knockout artist with nothing on the jab lives at 85.',
    clamp: ATTRIBUTE_CLAMP,
  },
  armAsymmetryPct: {
    label: 'Arm asymmetry',
    unit: '%',
    help: 'Lead arm longer (+) or shorter (-) than the rear. Half of it reaches the effective reach, because the wingspan measurement already averages the two. ±3 % is the realistic band.',
    clamp: { min: -8, max: 8, dp: 1 },
  },
  legAsymmetryPct: {
    label: 'Leg asymmetry',
    unit: '%',
    help: 'Lead leg longer (+) or shorter (-). Half of it reaches the effective kick reach.',
    clamp: { min: -8, max: 8, dp: 1 },
  },
  surgeries: {
    label: 'Career surgeries',
    unit: '#',
    help: 'Total operations. -1.5 recovery points each up to six, on top of anything the injury list below says.',
    clamp: { min: 0, max: 30, dp: 0 },
  },
  cardioSport: {
    label: 'Endurance background',
    help: 'An endurance sport trained before or alongside fighting. Aerobic base is the most durable trained quality there is, so it is worth +0.8 cardio points per year up to ten.',
  },
  cardioYears: {
    label: 'Endurance years',
    unit: 'yr',
    help: 'Years of that sport. Counted to a maximum of ten.',
    clamp: { min: 0, max: 40, dp: 1 },
  },
  hardCuts: {
    label: 'Career hard cuts',
    unit: '#',
    help: 'Cuts beyond 8 % of walk-around mass over the whole career. -0.35 cardio points each up to twelve: chronic cutting is a chronic cost, separate from this week’s dehydration.',
    clamp: { min: 0, max: 60, dp: 0 },
  },
  worstCutPct: {
    label: 'Worst cut',
    unit: '%',
    help: 'The worst single cut ever made. Recorded for the card and flagged by the validator past 12 %.',
    clamp: { min: 0, max: 30, dp: 1 },
  },
  missedWeight: {
    label: 'Missed weigh-ins',
    unit: '#',
    help: 'Times the fighter missed weight. +0.004 residual dehydration each up to three — evidence the cut has stopped working.',
    clamp: { min: 0, max: 10, dp: 0 },
  },
  injuryRegion: { label: 'Region', help: 'Where the injury is. The region decides which attributes it costs and whether it caps a capability outright.' },
  injurySeverity: {
    label: 'Severity',
    help: '20 a strain, 50 a partial tear, 80 a rupture, 95 a reconstruction. Scales the whole penalty linearly.',
    clamp: ATTRIBUTE_CLAMP,
  },
  injuryMonthsAgo: {
    label: 'Months ago',
    unit: 'mo',
    help: 'How long the body has had to deal with it. The penalty decays as e^(-months/18) — unless it was operated on or keeps recurring, which leave a permanent floor of 25 % and 35 %.',
    clamp: { min: 0, max: 360, dp: 0 },
  },
  injurySurgery: { label: 'Operated', help: 'Leaves a permanent 25 % floor under the penalty. A reconstructed joint is never the joint it was.' },
  injuryRecurrent: { label: 'Recurrent', help: 'A joint that keeps going. Leaves a permanent 35 % floor — the worst of the two applies, they do not stack.' },
});

/** Human labels for the grading systems. */
export const GRADE_SYSTEM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  none: 'Ungraded',
  bjjBelt: 'BJJ belt',
  judoKyuDan: 'Judo kyu / dan',
  wrestlingCredential: 'Wrestling credential',
  boxingAmateur: 'Boxing amateur class',
  thaiRecord: 'Muay Thai standing',
  karateDan: 'Karate dan',
  taekwondoDan: 'Taekwondo dan',
  samboRank: 'Sambo rank',
});

/** Human labels for the grade ranks. */
export const GRADE_RANK_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'none.unranked': 'Ungraded',
  'bjj.white': 'White belt', 'bjj.blue': 'Blue belt', 'bjj.purple': 'Purple belt',
  'bjj.brown': 'Brown belt', 'bjj.black': 'Black belt', 'bjj.black2': 'Black belt, 2nd degree',
  'bjj.coral': 'Coral belt',
  'judo.kyu5': '5th kyu', 'judo.kyu3': '3rd kyu', 'judo.kyu1': '1st kyu',
  'judo.shodan': 'Shodan (1st dan)', 'judo.nidan': 'Nidan', 'judo.sandan': 'Sandan', 'judo.yondan': 'Yondan',
  'wr.club': 'Club', 'wr.highSchool': 'High school', 'wr.statePlacer': 'State placer',
  'wr.ncaaD2': 'NCAA Division II', 'wr.ncaaD1': 'NCAA Division I', 'wr.allAmerican': 'All-American',
  'wr.ncaaChampion': 'NCAA champion', 'wr.worldTeam': 'World team', 'wr.olympian': 'Olympian',
  'box.novice': 'Novice', 'box.open': 'Open class', 'box.regional': 'Regional',
  'box.national': 'National', 'box.international': 'International', 'box.olympian': 'Olympian',
  'mt.gymFighter': 'Gym fighter', 'mt.provincial': 'Provincial', 'mt.bangkokStadium': 'Bangkok stadium',
  'mt.stadiumChampion': 'Stadium champion', 'mt.worldTitle': 'World title',
  'kar.kyu': 'Kyu grade', 'kar.shodan': 'Shodan', 'kar.nidan': 'Nidan', 'kar.sandan': 'Sandan',
  'kar.nationalSquad': 'National squad',
  'tkd.kyu': 'Geup grade', 'tkd.il_dan': '1st dan', 'tkd.i_dan': '2nd dan', 'tkd.sam_dan': '3rd dan',
  'tkd.nationalSquad': 'National squad',
  'sam.club': 'Club', 'sam.candidateMaster': 'Candidate master', 'sam.master': 'Master of sport',
  'sam.internationalMaster': 'International master', 'sam.worldMedallist': 'World medallist',
});

/** Grading systems that make sense for each discipline, most natural first. */
export const GRADE_SYSTEMS_FOR_DISCIPLINE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  bjj: ['bjjBelt', 'none'],
  judo: ['judoKyuDan', 'none'],
  wrestling: ['wrestlingCredential', 'none'],
  boxing: ['boxingAmateur', 'none'],
  muayThai: ['thaiRecord', 'none'],
  kickboxing: ['thaiRecord', 'none'],
  karate: ['karateDan', 'none'],
  taekwondo: ['taekwondoDan', 'none'],
  sambo: ['samboRank', 'none'],
  mmaIntegration: ['none'],
});

export const PLACING_LABELS: Readonly<Record<string, string>> = Object.freeze({
  none: 'No placing',
  localPodium: 'Local podium',
  nationalPodium: 'National podium',
  nationalTitle: 'National title',
  continentalMedal: 'Continental medal',
  worldMedal: 'World medal',
  olympicMedal: 'Olympic medal',
});

/** Human labels for the discipline ids. */
export const DISCIPLINE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  boxing: 'Boxing',
  muayThai: 'Muay Thai',
  kickboxing: 'Kickboxing',
  karate: 'Karate',
  taekwondo: 'Taekwondo',
  wrestling: 'Wrestling',
  judo: 'Judo',
  bjj: 'Brazilian jiu-jitsu',
  sambo: 'Sambo',
  mmaIntegration: 'MMA integration',
  mma: 'MMA integration',
});

/**
 * Sub-skill help is generated rather than tabulated: there are 88 of them and a
 * hand-written sentence each would rot the first time a discipline gains a
 * skill. The name plus the shared scale note is the honest minimum.
 */
export function subSkillHelp(discipline: string, skill: string): string {
  const label = humaniseKey(skill);
  return `${label} within ${DISCIPLINE_LABELS[discipline] ?? discipline}. ${ATTRIBUTE_SCALE_NOTE} ` +
    'Cross-discipline transfer may raise the effective value above what you set here — the derived panel shows both.';
}

/** `subDefenceUnderStrikes` -> `Sub defence under strikes`. */
export function humaniseKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** `wc.light_heavyweight` -> `Light heavyweight`. */
export function weightClassLabel(id: string): string {
  return humaniseKey(id.replace(/^wc\./, ''));
}
