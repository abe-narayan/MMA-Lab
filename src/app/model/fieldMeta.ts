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
    help: 'Training age. Caps the derived tier: under 0.25 yr is T0, under 1 T1, under 4 T2, under 8 T3, and a fighter may sit one tier above the cap.',
    clamp: { min: 0, max: 45, dp: 1 },
  },
  trainingQuality: {
    label: 'Training quality',
    help: 'Camp quality, 0.6 hobbyist to 1.15 elite. Scales how much the stored sub-skills are worth.',
    clamp: { min: 0.5, max: 1.2, dp: 2 },
  },
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
