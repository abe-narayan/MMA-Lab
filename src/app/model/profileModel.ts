/**
 * FIGHTER PROFILE — the organised, honest face of the fighter schema.
 *
 * The raw schema (01 §2) is organised the way the *derivation* reads it:
 * body, physical, disciplines × sub-skills, mental, record, style. A person
 * building a fighter thinks in four other buckets — PHYSICAL (the frame),
 * ATHLETIC (the engine), TECHNICAL (the skills) and STYLE (the choices) —
 * plus the career that sits behind them. This module maps those buckets onto
 * the real fields, and nothing else: every control here reads and writes an
 * existing `FighterDefinition` path, so a profile edit and a raw-editor edit
 * are the same edit.
 *
 * Three rules:
 *
 *   1. **No invented settings.** A concept the model has no field for (e.g.
 *      "coordination") is listed with `status: 'unmodelled'` and never
 *      rendered as a working control. `UNMODELLED_CONCEPTS` below is the list
 *      the UI shows, and the one docs/design/UI_PASS.md reports.
 *   2. **Composites are views, not new state.** A TECHNICAL composite such as
 *      "Footwork" is the mean of named sub-skills across the arts the fighter
 *      has actually trained. Moving it shifts each of those sub-skills by the
 *      same amount (clamped 0-100), so the authored *shape* survives and the
 *      raw sub-skills remain the single source of truth.
 *   3. **Every live parameter carries a probe**: a low value, a high value
 *      and either the bout statistic that must move between them or the share
 *      of paired bouts that must diverge (see paramEffect.ts).
 *      `tests/ui.params-effect.test.ts` runs that probe for every entry, so a
 *      control that stops affecting the simulation fails a test rather than
 *      silently becoming decoration.
 */

import {
  SUB_SKILLS, type CoreDisciplineId, type FighterDefinition,
} from '../../sim';
import { getAtPath, setAtPath } from './paths';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type ProfileCategory = 'physical' | 'athletic' | 'technical' | 'style' | 'mental' | 'experience';

export const PROFILE_CATEGORIES: readonly { id: ProfileCategory; label: string; blurb: string }[] = Object.freeze([
  { id: 'physical', label: 'Physical', blurb: 'The frame: size, reach, age, stance and how the body moves.' },
  { id: 'athletic', label: 'Athletic', blurb: 'The engine: strength, speed, reactions, gas tank and durability.' },
  { id: 'technical', label: 'Technical', blurb: 'Skill composites over the sub-skills of every art the fighter has trained.' },
  { id: 'style', label: 'Style & game plan', blurb: 'What the fighter chooses to do with the body and the skills.' },
  { id: 'mental', label: 'Mental', blurb: 'Decision quality, nerve and how they respond to the fight going wrong.' },
  { id: 'experience', label: 'Experience', blurb: 'Record, cage time and opposition, which feed the experience composite and the chin.' },
]);

/**
 * `live`         read by the simulation, with a probe proving it (tested).
 * `presentation` stored and drawn, never read by a formula (shown, labelled).
 * `unmodelled`   a concept the model has no field for (listed, not editable).
 */
export type ParamStatus = 'live' | 'presentation' | 'unmodelled';

/** Statistics the effect probe can measure. See `paramEffect.ts`. */
export type MetricId =
  | 'sigAttemptedPerMin' | 'sigLandedPerMin' | 'sigAccuracy' | 'strikeDefence'
  | 'headLandedShare' | 'legLandedShare' | 'bodyLandedShare'
  | 'tdAttempts' | 'tdLanded' | 'tdAccuracy' | 'tdDefence'
  | 'controlSeconds' | 'subAttempts' | 'knockdownsFor' | 'knockdownsAgainst'
  | 'groundShare' | 'clinchShare' | 'distanceShare'
  | 'staminaMean' | 'staminaEnd' | 'headDamageTaken' | 'bodyDamageTaken' | 'legDamageTaken'
  | 'damageDealt' | 'winShare' | 'finishShare' | 'sigAbsorbedPerMin' | 'reversals'
  // Event-level: isolate the mechanism from volume.
  | 'strikeForce' | 'damagePerLanded' | 'damagePerLandedTaken' | 'defendedShare' | 'counterShare'
  | 'adjustments' | 'subStagesAgainst' | 'cageShare'
  // Share of paired bouts whose digest differs: proof the bout changed, for a
  // parameter with a real but non-directional effect.
  | 'boutsChanged';

export interface EffectProbe {
  lo: number | string;
  hi: number | string;
  metric: MetricId;
  /** +1: the metric should rise from lo to hi; -1: fall; 0: change either way. */
  dir: 1 | -1 | 0;
  /** Bouts per side. Defaults to the harness default. */
  seeds?: number;
  /** Opponent archetype override (defaults to the harness's mirror). */
  opponent?: 'mirror' | 'striker' | 'grappler' | 'power';
  /** Minimum relative change accepted (default 0.05 = 5 %). */
  minRel?: number;
  /** Mark long-running probes; the test file labels them. */
  slow?: boolean;
  /** Bout shape override (default: one 180 s round). */
  rounds?: number;
  roundSeconds?: number;
  /**
   * Schema paths set on the probe base before measuring, for a parameter
   * whose effect is conditional (e.g. heart only matters to a fighter whose
   * hurt reflex is not already fixed by an explicit style override).
   * `null` deletes the field.
   */
  baseOverrides?: Readonly<Record<string, unknown>>;
}

export type ParamControl =
  | { kind: 'range'; min: number; max: number; step: number; unit?: string; format?: (v: number) => string }
  | { kind: 'select'; options: readonly { value: string; label: string }[] }
  | { kind: 'toggle' };

export interface ProfileParam {
  id: string;
  category: ProfileCategory;
  label: string;
  help: string;
  /** Basic mode shows only `basic`; advanced shows everything. */
  level: 'basic' | 'advanced';
  control: ParamControl;
  /** The schema paths this control reads and writes — for search and provenance. */
  paths: readonly string[];
  status: ParamStatus;
  statusNote?: string;
  keywords?: readonly string[];
  get(def: FighterDefinition): number | string | boolean | null;
  set(def: FighterDefinition, value: number | string | boolean): FighterDefinition;
  /** Disabled for this fighter (e.g. a composite over arts they never trained). */
  disabledReason?(def: FighterDefinition): string | null;
  probe?: EffectProbe;
}

// --------------------------------------------------------------------------
// Builders
// --------------------------------------------------------------------------

const ATTR = { kind: 'range', min: 0, max: 100, step: 1 } as const;
const round = (v: number, dp: number): number => Math.round(v * 10 ** dp) / 10 ** dp;

function numberAt(path: string, fallback: number) {
  return (def: FighterDefinition): number => {
    const v = getAtPath(def, path);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
}

function simple(
  id: string, category: ProfileCategory, level: 'basic' | 'advanced', path: string, label: string,
  help: string, probe: EffectProbe | undefined, opts: {
    control?: ParamControl; fallback?: number; keywords?: readonly string[]; status?: ParamStatus; statusNote?: string;
  } = {},
): ProfileParam {
  const control = opts.control ?? ATTR;
  return {
    id, category, level, label, help, control, paths: [path],
    status: opts.status ?? 'live',
    ...(opts.statusNote ? { statusNote: opts.statusNote } : {}),
    ...(opts.keywords ? { keywords: opts.keywords } : {}),
    get: numberAt(path, opts.fallback ?? 50),
    set: (def, v) => setAtPath(def, path, Number(v)),
    ...(probe ? { probe } : {}),
  };
}

function choice(
  id: string, category: ProfileCategory, level: 'basic' | 'advanced', path: string, label: string,
  help: string, options: readonly { value: string; label: string }[], probe: EffectProbe | undefined,
  fallback: string, opts: { status?: ParamStatus; statusNote?: string; keywords?: readonly string[] } = {},
): ProfileParam {
  return {
    id, category, level, label, help, control: { kind: 'select', options }, paths: [path],
    status: opts.status ?? 'live',
    ...(opts.statusNote ? { statusNote: opts.statusNote } : {}),
    ...(opts.keywords ? { keywords: opts.keywords } : {}),
    get: (def) => {
      const v = getAtPath(def, path);
      return typeof v === 'string' ? v : fallback;
    },
    set: (def, v) => setAtPath(def, path, String(v)),
    ...(probe ? { probe } : {}),
  };
}

const opts = (...values: string[]): { value: string; label: string }[] =>
  values.map((v) => ({ value: v, label: v.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()) }));

// --------------------------------------------------------------------------
// Mass: the sim reads fight-night mass when present, so "weight" moves all
// three mass fields together and keeps their authored gaps (cut, regain).
// --------------------------------------------------------------------------

function fightMass(def: FighterDefinition): number {
  return def.body.fightNightKg ?? def.body.massKg;
}

function setFightMass(def: FighterDefinition, kg: number): FighterDefinition {
  const delta = kg - fightMass(def);
  let next = setAtPath(def, 'body.massKg', round(def.body.massKg + delta, 1));
  if (def.body.fightNightKg !== undefined) next = setAtPath(next, 'body.fightNightKg', round(def.body.fightNightKg + delta, 1));
  if (def.body.weighInKg !== undefined) next = setAtPath(next, 'body.weighInKg', round(def.body.weighInKg + delta, 1));
  if (def.body.naturalWeightKg !== undefined) next = setAtPath(next, 'body.naturalWeightKg', round(def.body.naturalWeightKg + delta, 1));
  // A weight class set by hand would now disagree with the mass; let it derive.
  if (next.body.weightClass !== undefined) next = setAtPath(next, 'body.weightClass', undefined);
  return next;
}

// --------------------------------------------------------------------------
// TECHNICAL composites
// --------------------------------------------------------------------------

/** `discipline.subSkill` references. Only arts the fighter trains contribute. */
export type SkillRef = `${CoreDisciplineId}.${string}`;

const ALL = (d: CoreDisciplineId): SkillRef[] => SUB_SKILLS[d].map((s) => `${d}.${s}` as SkillRef);

export const TECHNICAL_GROUPS: Readonly<Record<string, readonly SkillRef[]>> = Object.freeze({
  striking: [...ALL('boxing'), ...ALL('muayThai'), ...ALL('kickboxing'), ...ALL('karate'), ...ALL('taekwondo')],
  boxing: [...ALL('boxing'), 'muayThai.hands', 'kickboxing.punches', 'kickboxing.combinations'],
  kicking: [
    'muayThai.kicks', 'muayThai.teep', 'kickboxing.kicks', 'kickboxing.lowKicks', 'kickboxing.spinning',
    'karate.kicks', 'taekwondo.kicks', 'taekwondo.headKicks', 'taekwondo.spinning',
  ],
  wrestling: [...ALL('wrestling'), 'sambo.takedowns', 'mmaIntegration.levelChanges'],
  grappling: [...ALL('bjj'), 'judo.newaza', 'sambo.legLocks', 'sambo.topControl', 'sambo.transitions', 'mmaIntegration.groundAndPound'],
  clinch: [
    'muayThai.clinch', 'muayThai.knees', 'muayThai.elbows', 'wrestling.clinch', 'wrestling.cageWrestling',
    'judo.gripFighting', 'judo.throws', 'sambo.gripFighting', 'sambo.throws', 'mmaIntegration.clinchStriking',
  ],
  defence: [
    'boxing.guard', 'boxing.headMovement', 'kickboxing.defence', 'muayThai.checks', 'kickboxing.checks',
    'muayThai.catches', 'wrestling.takedownDefence', 'bjj.escapes', 'bjj.subDefence', 'mmaIntegration.subDefenceUnderStrikes',
  ],
  timing: ['boxing.counters', 'boxing.feints', 'karate.timing', 'karate.counters', 'taekwondo.counters', 'judo.counters'],
  footwork: ['boxing.footwork', 'kickboxing.footwork', 'karate.footwork', 'taekwondo.footwork'],
  distance: ['karate.distanceControl', 'taekwondo.distance', 'boxing.ringCraft', 'boxing.jab', 'muayThai.teep'],
  positional: [
    'bjj.topControl', 'bjj.backControl', 'bjj.passing', 'wrestling.topControl', 'wrestling.matReturns',
    'mmaIntegration.cageWork', 'mmaIntegration.transitions', 'mmaIntegration.getUps', 'wrestling.getUps',
  ],
});

/** The refs of a group that this fighter actually has (trained arts only). */
export function presentRefs(def: FighterDefinition, refs: readonly SkillRef[]): SkillRef[] {
  return refs.filter((ref) => {
    const [d, s] = ref.split('.') as [CoreDisciplineId, string];
    const block = def.disciplines[d];
    return block !== undefined && typeof block.sub[s] === 'number';
  });
}

export function compositeValue(def: FighterDefinition, refs: readonly SkillRef[]): number | null {
  const here = presentRefs(def, refs);
  if (here.length === 0) return null;
  let sum = 0;
  for (const ref of here) {
    const [d, s] = ref.split('.') as [CoreDisciplineId, string];
    sum += def.disciplines[d]!.sub[s];
  }
  return sum / here.length;
}

/**
 * Move a composite to `target` by shifting each present sub-skill by the
 * same delta, clamped to 0-100. Clamping means a composite cannot always
 * reach the exact target (a sub-skill pinned at 100 cannot rise), which the
 * UI shows by reading the composite back rather than echoing the input.
 */
export function setComposite(def: FighterDefinition, refs: readonly SkillRef[], target: number): FighterDefinition {
  const current = compositeValue(def, refs);
  if (current === null) return def;
  const delta = target - current;
  let next = def;
  for (const ref of presentRefs(def, refs)) {
    const [d, s] = ref.split('.') as [CoreDisciplineId, string];
    const v = def.disciplines[d]!.sub[s];
    next = setAtPath(next, `disciplines.${d}.sub.${s}`, Math.max(0, Math.min(100, Math.round(v + delta))));
  }
  return next;
}

function composite(
  id: string, level: 'basic' | 'advanced', label: string, help: string, group: keyof typeof TECHNICAL_GROUPS,
  probe: EffectProbe, keywords: readonly string[] = [],
): ProfileParam {
  const refs = TECHNICAL_GROUPS[group];
  return {
    id, category: 'technical', level, label, help, control: ATTR,
    paths: refs.map((r) => `disciplines.${r.replace('.', '.sub.')}`),
    status: 'live', keywords,
    get: (def) => {
      const v = compositeValue(def, refs);
      return v === null ? null : Math.round(v);
    },
    set: (def, v) => setComposite(def, refs, Number(v)),
    disabledReason: (def) => (presentRefs(def, refs).length === 0
      ? 'No art that feeds this skill is trained. Add one on the Disciplines tab (Advanced).'
      : null),
    probe,
  };
}

// --------------------------------------------------------------------------
// The catalogue
// --------------------------------------------------------------------------

const RANGE_OPTIONS = opts('long', 'mid', 'short', 'close', 'clinch', 'ground');
const MODE_OPTIONS = opts(
  'pressure', 'counter', 'pointFighter', 'volume', 'power', 'grinder', 'scrambler', 'guardPlayer', 'allRounder',
  'distanceStriking', 'pressureStriking', 'wrestleControl', 'clinchGrind', 'submissionHunt',
);

export const PROFILE_PARAMS: readonly ProfileParam[] = Object.freeze([
  // ---------------------------------------------------------------- PHYSICAL
  {
    id: 'physical.height', category: 'physical', level: 'basic', label: 'Height',
    help: 'Stature. Sets the rig, the centre-of-mass height used by takedown and throw leverage, and the reference frame for reach.',
    control: { kind: 'range', min: 1.5, max: 2.1, step: 0.01, unit: 'm', format: (v) => `${Math.round(v * 100)} cm` },
    paths: ['body.heightM'], status: 'live', keywords: ['size', 'tall', 'stature'],
    get: numberAt('body.heightM', 1.8), set: (d, v) => setAtPath(d, 'body.heightM', round(Number(v), 2)),
    probe: { lo: 1.6, hi: 2.0, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 },
  },
  {
    id: 'physical.weight', category: 'physical', level: 'basic', label: 'Weight (fight night)',
    help: 'Fight-night mass. Moves the weigh-in and walk-around masses with it. Feeds punch power, grappling strength and the energy cost of carrying the body.',
    control: { kind: 'range', min: 50, max: 130, step: 0.5, unit: 'kg', format: (v) => `${v.toFixed(1)} kg` },
    paths: ['body.fightNightKg', 'body.massKg', 'body.weighInKg'], status: 'live', keywords: ['mass', 'size', 'heavy'],
    get: fightMass, set: (d, v) => setFightMass(d, Number(v)),
    probe: { lo: 62, hi: 100, metric: 'damageDealt', dir: 1 },
  },
  {
    id: 'physical.reach', category: 'physical', level: 'basic', label: 'Reach',
    help: 'Fingertip-to-fingertip span. Sets effective punching range, which decides who is in range first.',
    control: { kind: 'range', min: 1.5, max: 2.2, step: 0.01, unit: 'm', format: (v) => `${Math.round(v * 100)} cm` },
    paths: ['body.reachM'], status: 'live', keywords: ['wingspan', 'arms', 'range'],
    get: numberAt('body.reachM', 1.83), set: (d, v) => setAtPath(d, 'body.reachM', round(Number(v), 2)),
    probe: { lo: 1.6, hi: 2.1, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 },
  },
  {
    id: 'physical.legReach', category: 'physical', level: 'advanced', label: 'Leg reach (proportions)',
    help: 'Hip-to-heel length: the kicking range and, with height, the body proportions. Also used by leg-entanglement geometry.',
    control: { kind: 'range', min: 0.8, max: 1.25, step: 0.01, unit: 'm', format: (v) => `${Math.round(v * 100)} cm` },
    paths: ['body.legReachM'], status: 'live', keywords: ['legs', 'kick range', 'proportions'],
    get: numberAt('body.legReachM', 1.03), set: (d, v) => setAtPath(d, 'body.legReachM', round(Number(v), 2)),
    probe: { lo: 0.85, hi: 1.2, metric: 'boutsChanged', dir: 0, roundSeconds: 180, seeds: 4, minRel: 0.5 },
  },
  {
    id: 'physical.age', category: 'physical', level: 'basic', label: 'Age',
    help: 'Applies the age curves to every physical attribute and to the chin. The anthropometric that matters most (DESIGN §5).',
    control: { kind: 'range', min: 18, max: 45, step: 1, unit: 'yr', format: (v) => `${v} yr` },
    paths: ['body.ageYears'], status: 'live', keywords: ['old', 'young', 'veteran'],
    get: numberAt('body.ageYears', 28), set: (d, v) => setAtPath(d, 'body.ageYears', Math.round(Number(v))),
    probe: { lo: 24, hi: 42, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 },
  },
  choice('physical.stance', 'physical', 'basic', 'body.stance', 'Stance',
    'Lead side for every technique. Open vs closed stance changes which kicks and hooks are free (plans ST-1..ST-8); switch stance enables stance changes.',
    opts('orthodox', 'southpaw', 'switch'),
    { lo: 'orthodox', hi: 'southpaw', metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, 'orthodox', { keywords: ['southpaw', 'orthodox', 'lead'] }),
  choice('physical.handedness', 'physical', 'advanced', 'body.handedness', 'Handedness',
    'Which hand is the power hand, and the default dominant leg. With stance, decides whether the power hand is the rear hand.',
    opts('right', 'left'),
    { lo: 'right', hi: 'left', metric: 'damageDealt', dir: 0 }, 'right', {
      keywords: ['power hand', 'dominant'], status: 'presentation',
      statusNote: 'Stored and derived (dominant leg, power-hand split) but no bout mechanic reads it yet: bouts are byte-identical either way. Stance is what sets the lead side.',
    }),
  simple('physical.mobility', 'physical', 'basic', 'physical.speed', 'Mobility (foot speed)',
    'Foot speed: movement, closing and retreating distance, and how quickly the fighter can take or deny range. Also stands in for agility and acceleration, which the model does not separate.',
    { lo: 15, hi: 95, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, { keywords: ['agility', 'acceleration', 'speed', 'movement'] }),
  simple('physical.flexibility', 'physical', 'advanced', 'physical.flexibility', 'Flexibility',
    'Range of motion: guard retention, high kicks and resisting joint locks.',
    { lo: 5, hi: 95, metric: 'boutsChanged', dir: 0, rounds: 3, roundSeconds: 300, seeds: 6, minRel: 0.15, slow: true }, { keywords: ['mobility', 'guard', 'kicks'] }),
  simple('physical.balance', 'physical', 'basic', 'physical.balance', 'Balance',
    'Staying upright: takedown defence, recovering from kicks and the balance meter itself.',
    { lo: 5, hi: 95, metric: 'tdDefence', dir: 1, opponent: 'grappler' }, {
      keywords: ['stability', 'takedown defence', 'coordination'], status: 'presentation',
      statusNote: 'Stored and derived (takedown-defence base, clinch power, stumble multiplier) but none of those derived numbers is read in a bout yet: bouts are byte-identical from 5 to 95. The live balance meter comes from damage and technique commitment.',
    }),

  // ---------------------------------------------------------------- ATHLETIC
  simple('athletic.strength', 'athletic', 'basic', 'physical.strength', 'Strength',
    'Maximal force: power index, clinch and grappling strength, takedown finishes and pins.',
    { lo: 10, hi: 95, metric: 'strikeForce', dir: 1 }, { keywords: ['power', 'force'] }),
  simple('athletic.explosiveness', 'athletic', 'basic', 'physical.explosiveness', 'Explosiveness',
    'Rate of force: burst entries, shot speed and the phosphagen pool.',
    { lo: 10, hi: 95, metric: 'strikeForce', dir: 1 }, { keywords: ['burst', 'acceleration', 'power'] }),
  simple('athletic.handSpeed', 'athletic', 'advanced', 'physical.handSpeed', 'Hand speed',
    'How fast punches arrive: shorter startup, harder to read.',
    { lo: 10, hi: 95, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75, opponent: 'striker' }, { keywords: ['speed', 'punch'] }),
  simple('athletic.kickSpeed', 'athletic', 'advanced', 'physical.kickSpeed', 'Kick speed',
    'How fast kicks arrive, and how often they are caught.',
    { lo: 10, hi: 95, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, { keywords: ['speed', 'kick'] }),
  simple('athletic.reaction', 'athletic', 'basic', 'physical.reactionTime', 'Reaction',
    'Perceptual-motor latency: how late the fighter sees and answers a strike.',
    { lo: 5, hi: 95, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, { keywords: ['reflexes', 'reaction time', 'defence'] }),
  simple('athletic.endurance', 'athletic', 'basic', 'physical.cardio', 'Endurance (cardio)',
    'Aerobic capacity: how fast the stamina pools drain and how much output survives into later rounds.',
    { lo: 5, hi: 95, metric: 'sigAttemptedPerMin', dir: 1 }, { keywords: ['cardio', 'gas tank', 'stamina', 'fatigue resistance'] }),
  simple('athletic.recovery', 'athletic', 'basic', 'physical.recovery', 'Recovery',
    'How fast stamina and acute damage come back, within a round and between rounds.',
    { lo: 5, hi: 95, metric: 'bodyDamageTaken', dir: -1 }, { keywords: ['recover', 'rest', 'fatigue resistance'] }),
  simple('athletic.chin', 'athletic', 'basic', 'physical.chin', 'Chin',
    'Resistance to being knocked down or out by a head shot.',
    { lo: 5, hi: 95, metric: 'headDamageTaken', dir: -1 }, { keywords: ['durability', 'ko', 'knockout'] }),
  simple('athletic.bodyToughness', 'athletic', 'advanced', 'physical.bodyToughness', 'Body toughness',
    'Resistance to body shots and to the body-collapse state.',
    { lo: 5, hi: 95, metric: 'bodyDamageTaken', dir: -1 }, { keywords: ['durability', 'body shots'] }),
  simple('athletic.neck', 'athletic', 'advanced', 'physical.neckStrength', 'Neck strength',
    'Damps the rotational acceleration of head shots; part of the knockout logistic.',
    { lo: 5, hi: 95, metric: 'boutsChanged', dir: 0, opponent: 'power', rounds: 3, roundSeconds: 300, seeds: 8, minRel: 0.25, slow: true }, { keywords: ['durability', 'ko'] }),
  simple('athletic.grip', 'athletic', 'advanced', 'physical.gripStrength', 'Grip strength',
    'Holding grips, wrist control and finishing chokes and locks.',
    { lo: 5, hi: 95, metric: 'controlSeconds', dir: 0, opponent: 'grappler' }, {
      keywords: ['grappling', 'clinch'], status: 'presentation',
      statusNote: 'Stored; only a hand or elbow injury reads it. Bouts are byte-identical from 5 to 95.',
    }),

  // --------------------------------------------------------------- TECHNICAL
  composite('technical.striking', 'basic', 'Striking (overall)',
    'Every striking sub-skill of every striking art trained (boxing, Muay Thai, kickboxing, karate, taekwondo).',
    'striking', { lo: 20, hi: 90, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, ['stand-up']),
  composite('technical.boxing', 'advanced', 'Boxing',
    'Punching: jab, power, combinations, head movement, guard, body work, counters, feints.',
    'boxing', { lo: 20, hi: 90, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, ['punching', 'hands']),
  composite('technical.kicking', 'advanced', 'Kicking',
    'Kicks, teeps, low kicks and spinning kicks across the kicking arts.',
    'kicking', { lo: 20, hi: 90, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, ['kicks', 'low kick', 'teep']),
  composite('technical.wrestling', 'basic', 'Wrestling',
    'Shots, finishes, chains, top control, cage wrestling, get-ups and level changes.',
    'wrestling', { lo: 20, hi: 90, metric: 'tdAttempts', dir: 1 }, ['takedowns', 'shots']),
  composite('technical.grappling', 'basic', 'Grappling (ground)',
    'Guard, passing, back control, submissions and escapes on the mat.',
    'grappling', { lo: 20, hi: 90, metric: 'boutsChanged', dir: 0, opponent: 'grappler', roundSeconds: 90, seeds: 4, minRel: 0.75 }, ['bjj', 'jiu-jitsu', 'submissions', 'ground']),
  composite('technical.clinch', 'advanced', 'Clinch',
    'Plum, knees, elbows, grip fighting, throws and cage clinch work.',
    'clinch', { lo: 20, hi: 90, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75, opponent: 'grappler' }, ['plum', 'knees', 'throws']),
  composite('technical.defence', 'basic', 'Defence',
    'Guard, head movement, checks, kick catches, takedown defence, escapes and submission defence.',
    'defence', { lo: 20, hi: 90, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, ['guard', 'head movement', 'escapes']),
  composite('technical.timing', 'advanced', 'Timing',
    'Counters, feints and timing across the striking arts and judo.',
    'timing', { lo: 20, hi: 90, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, ['counters', 'feints']),
  composite('technical.footwork', 'advanced', 'Footwork',
    'Boxing, kickboxing, karate and taekwondo footwork.',
    'footwork', { lo: 20, hi: 90, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, ['angles', 'movement']),
  composite('technical.distance', 'advanced', 'Distance management',
    'Distance control, ring craft, the jab and the teep: owning the gap.',
    'distance', { lo: 20, hi: 90, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, ['range', 'ring craft', 'jab']),
  composite('technical.positional', 'advanced', 'Positional awareness',
    'Top and back control, passing, mat returns, cage work, transitions and get-ups.',
    'positional', { lo: 20, hi: 90, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, ['control', 'transitions', 'cage']),

  // ------------------------------------------------------------------ STYLE
  choice('style.range', 'style', 'basic', 'style.preferredRange', 'Preferred range',
    'The range band the fighter tries to fight at; the plan and the movement policy steer toward it.',
    RANGE_OPTIONS, { lo: 'long', hi: 'clinch', metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, 'mid', { keywords: ['distance', 'range'] }),
  simple('style.pace', 'style', 'basic', 'mental.aggression', 'Pace & aggression',
    'How hard the fighter pushes the pace and how much risk the plan accepts. Stored as the mental attribute "aggression".',
    { lo: 5, hi: 95, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, { keywords: ['pace', 'output', 'aggression', 'risk tolerance', 'work rate'] }),
  simple('style.pressure', 'style', 'basic', 'style.pressureBias', 'Pressure',
    'Walk forward (high) or give ground and counter (low). Picks the default striking mode.',
    { lo: 5, hi: 95, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75, opponent: 'striker' }, { keywords: ['forward', 'pressure fighter', 'movement'] }),
  choice('style.initiative', 'style', 'basic', 'style.initiative', 'Initiative (counter vs lead)',
    'Who starts the exchanges: pressure, counter, point-fighting or balanced.',
    opts('balanced', 'pressure', 'counter', 'point'), { lo: 'pressure', hi: 'counter', metric: 'sigAttemptedPerMin', dir: 0 }, 'balanced',
    {
      keywords: ['counter', 'counter striker', 'lead'], status: 'presentation',
      statusNote: 'Only used as a stand-in for Pressure when Pressure is unset. Set Pressure instead (low = counter, high = lead).',
    }),
  choice('style.primaryMode', 'style', 'basic', 'style.primaryMode', 'Game plan (primary mode)',
    'The plan the fighter walks out with. The AI still adapts inside the fight.',
    MODE_OPTIONS, { lo: 'distanceStriking', hi: 'wrestleControl', metric: 'tdAttempts', dir: 1 }, 'allRounder',
    {
      keywords: ['game plan', 'strategy', 'mode'], status: 'presentation',
      statusNote: 'A label only: the AI generates the game plan from skills, physique, Pressure and scouting (07 §2.5). Bouts are byte-identical whatever it says.',
    }),
  choice('style.fallbackMode', 'style', 'advanced', 'style.fallbackMode', 'Plan B (fallback mode)',
    'What the fighter switches to when plan A is not working.',
    MODE_OPTIONS, { lo: 'distanceStriking', hi: 'wrestleControl', metric: 'tdAttempts', dir: 0, seeds: 10 }, 'allRounder',
    {
      keywords: ['game plan', 'plan b'], status: 'presentation',
      statusNote: 'A label only: the plan generator picks its own fallback from the modes the fighter can execute.',
    }),
  {
    id: 'style.takedowns', category: 'style', level: 'advanced', label: 'Takedown setup',
    help: 'How takedowns are set up: naked shots, off a strike, off a combination, off a feint, reactive, or from the clinch.',
    control: { kind: 'select', options: opts('naked', 'offSingleStrike', 'offCombination', 'offFeint', 'reactive', 'offClinch') },
    paths: ['style.takedownPreferences.setup'], status: 'live', keywords: ['takedown tendency', 'shots'],
    get: (d) => (Array.isArray(d.style.takedownPreferences) ? 'naked' : d.style.takedownPreferences.setup),
    set: (d, v) => setAtPath(d, 'style.takedownPreferences', {
      ...(Array.isArray(d.style.takedownPreferences) ? { prefs: [], cageBias: 0.5 } : d.style.takedownPreferences),
      setup: String(v),
    }),
    probe: { lo: 'naked', hi: 'offClinch', metric: 'boutsChanged', dir: 0, roundSeconds: 300, seeds: 6, minRel: 0.3 },
  },
  {
    id: 'style.cageBias', category: 'style', level: 'advanced', label: 'Clinch & cage tendency',
    help: 'How much the fighter looks to pin the opponent on the fence and wrestle there (0 = open mat, 100 = always the cage).',
    control: ATTR, paths: ['style.takedownPreferences.cageBias'], status: 'live', keywords: ['clinch tendency', 'cage', 'fence'],
    get: (d) => Math.round((Array.isArray(d.style.takedownPreferences) ? 0.5 : d.style.takedownPreferences.cageBias) * 100),
    set: (d, v) => setAtPath(d, 'style.takedownPreferences', {
      ...(Array.isArray(d.style.takedownPreferences) ? { prefs: [], setup: 'naked' } : d.style.takedownPreferences),
      cageBias: round(Number(v) / 100, 2),
    }),
    probe: { lo: 0, hi: 100, metric: 'boutsChanged', dir: 0, rounds: 3, roundSeconds: 300, seeds: 4, minRel: 0.5, slow: true },
  },
  choice('style.whenLosing', 'style', 'advanced', 'style.losingBehaviour', 'Risk when behind',
    'What the fighter does when losing on the cards. The simulation only distinguishes "Unchanged" (switches off the behind-on-the-cards adjustment rules SC-2/SC-3) from everything else; the other four choices behave identically.',
    opts('finishSeek', 'stealRound', 'unchanged', 'shell', 'gamble'),
    { lo: 'unchanged', hi: 'finishSeek', metric: 'sigAttemptedPerMin', dir: 0 }, 'unchanged', {
      keywords: ['risk tolerance', 'losing'], status: 'presentation',
      statusNote: 'Read only to switch two late-fight adjustment rules off ("Unchanged"). Across 12 full three-round test bouts, including ones the fighter was losing, it changed nothing, so it is not presented as a working control.',
    }),
  choice('style.hurt', 'style', 'advanced', 'style.hurtBehaviour', 'Defensive tendency when hurt',
    'The reflex when rocked: cover up on the fence, clinch, shoot, circle out, trade, counter or turn away.',
    opts('coverOnCage', 'clinch', 'shoot', 'circleOut', 'trade', 'counter', 'turnAway'),
    { lo: 'turnAway', hi: 'clinch', metric: 'boutsChanged', dir: 0, opponent: 'power', rounds: 3, roundSeconds: 300, seeds: 8, minRel: 0.5, slow: true } /* Phase 9: 8 seeds — with real knockdown rates a fighter is hurt in fewer bouts */, 'coverOnCage',
    { keywords: ['defensive tendency', 'hurt', 'rocked'] }),
  choice('style.guard', 'style', 'advanced', 'style.guardStyle', 'Guard style',
    'Hand and frame shape: which reactive defences are available (e.g. the shoulder roll needs the Philly shell).',
    opts('highGuard', 'philly', 'longGuard', 'peekaboo', 'thai', 'hybrid'),
    { lo: 'highGuard', hi: 'longGuard', metric: 'boutsChanged', dir: 0, roundSeconds: 180, seeds: 8, minRel: 0.75 } /* Phase 9: longer — the paced sim throws less in 90 s */, 'highGuard', { keywords: ['defensive tendency', 'guard'] }),
  {
    id: 'style.refusesToTap', category: 'style', level: 'advanced', label: 'Refuses to tap',
    help: 'Holds on in joint locks past the point of injury, which ends in a technical submission or a doctor stoppage instead of a tap.',
    control: { kind: 'toggle' }, paths: ['style.refusesToTap'], status: 'live', keywords: ['tap', 'submission', 'heart'],
    get: (d) => d.style.refusesToTap ?? false,
    set: (d, v) => setAtPath(d, 'style.refusesToTap', Boolean(v)),
    // Measured at the derivation layer (the lock resistance it grants); a
    // bout-level probe needs dozens of locked-in joint locks to show.
  },

  // ----------------------------------------------------------------- MENTAL
  simple('mental.fightIQ', 'mental', 'basic', 'mental.fightIQ', 'Fight IQ',
    'Plan quality, reading the opponent, adaptation cadence; gates tier 5.',
    { lo: 5, hi: 95, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, { keywords: ['intelligence', 'strategy', 'reads'] }),
  simple('mental.composure', 'mental', 'advanced', 'mental.composure', 'Composure',
    'Keeps technique together under damage and in big moments; gates tier 5.',
    { lo: 5, hi: 95, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, { keywords: ['nerve', 'calm'] }),
  simple('mental.heart', 'mental', 'advanced', 'mental.heart', 'Heart',
    'Keeps fighting when hurt; holds out longer in a locked-in submission.',
    { lo: 5, hi: 95, metric: 'sigAttemptedPerMin', dir: 0 }, {
      keywords: ['will', 'toughness'], status: 'presentation',
      statusNote: 'Read in two narrow cases only: the rocked reflex of a novice (fight IQ tier 2 or lower) with no "when hurt" reflex set, and tap timing once a submission is locked. Across 12 full test bouts it changed nothing, so it is not presented as a working control.',
    }),
  simple('mental.discipline', 'mental', 'advanced', 'mental.discipline', 'Discipline',
    'Sticks to the plan, keeps the hands up when tired, makes weight cleanly.',
    { lo: 5, hi: 95, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, { keywords: ['game plan', 'consistency'] }),
  simple('mental.adaptability', 'mental', 'advanced', 'mental.adaptability', 'Adaptability',
    'How readily the fighter changes the plan when it is not working.',
    { lo: 5, hi: 95, metric: 'boutsChanged', dir: 0, rounds: 3, roundSeconds: 300, seeds: 8, minRel: 0.125, slow: true }, { keywords: ['adjust', 'plan b'] }),

  // ------------------------------------------------------------- EXPERIENCE
  {
    id: 'experience.overall', category: 'experience', level: 'basic', label: 'Overall experience',
    help: 'Sets the experience composite directly (0-100). When off, it is derived from the record, rounds and opposition level below.',
    control: ATTR, paths: ['record.experienceOverride'], status: 'live', keywords: ['experience', 'veteran', 'novice'],
    get: (d) => (d.record.experienceOverride === undefined ? null : d.record.experienceOverride),
    set: (d, v) => setAtPath(d, 'record.experienceOverride', Math.round(Number(v))),
    probe: { lo: 5, hi: 95, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 },
  },
  simple('experience.rounds', 'experience', 'advanced', 'record.totalRounds', 'Rounds fought',
    'Professional rounds of cage time. Feeds the derived experience composite.',
    { lo: 0, hi: 120, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, { control: { kind: 'range', min: 0, max: 200, step: 1 }, fallback: 0, keywords: ['cage time'] }),
  simple('experience.opposition', 'experience', 'advanced', 'record.oppositionLevel', 'Opposition level',
    'How good the opposition behind the record was (50 = regional).',
    { lo: 5, hi: 95, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 }, { keywords: ['strength of schedule'] }),
  // The three record counters below have a legacy flat field and a detailed
  // `record.pro` / `record.daysSinceLastBout` form; the derivation prefers the
  // detailed one when present (every archetype has it), so these controls read
  // and write whichever the sim will actually use, keeping both in step.
  {
    id: 'experience.koLosses', category: 'experience', level: 'advanced', label: 'KO losses',
    help: 'Each KO loss permanently decays the chin and raises the knockout odds.',
    control: { kind: 'range', min: 0, max: 20, step: 1 },
    paths: ['record.pro.koLosses', 'record.koLosses'], status: 'live', keywords: ['chin', 'durability'],
    get: (d) => d.record.pro?.koLosses ?? d.record.koLosses ?? 0,
    set: (d, v) => {
      const n = Math.max(0, Math.round(Number(v)));
      let next = setAtPath(d, 'record.koLosses', n);
      const pro = d.record.pro;
      if (pro) {
        const losses = Math.max(pro.losses, n + (pro.subLosses ?? 0) + (pro.decLosses ?? 0));
        next = setAtPath(next, 'record.pro', { ...pro, koLosses: n, losses });
        next = setAtPath(next, 'record.proLosses', losses);
      } else if (n > d.record.proLosses) {
        next = setAtPath(next, 'record.proLosses', n);
      }
      return next;
    },
    probe: { lo: 0, hi: 8, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75, opponent: 'power' },
  },
  {
    id: 'experience.layoff', category: 'experience', level: 'advanced', label: 'Layoff',
    help: 'Months since the last bout: ring rust costs composure, reaction and cardio.',
    control: { kind: 'range', min: 0, max: 60, step: 1, unit: 'mo', format: (v) => `${v} mo` },
    paths: ['record.daysSinceLastBout', 'record.layoffMonths'], status: 'live', keywords: ['ring rust'],
    get: (d) => (d.record.daysSinceLastBout !== undefined
      ? Math.round(d.record.daysSinceLastBout / 30.4375)
      : d.record.layoffMonths),
    set: (d, v) => {
      const months = Math.max(0, Math.round(Number(v)));
      const next = setAtPath(d, 'record.layoffMonths', months);
      return d.record.daysSinceLastBout !== undefined
        ? setAtPath(next, 'record.daysSinceLastBout', Math.round(months * 30.4375))
        : next;
    },
    probe: { lo: 0, hi: 36, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 },
  },
  {
    id: 'experience.proWins', category: 'experience', level: 'advanced', label: 'Pro wins',
    help: 'Professional wins; with losses and draws this sets the derived experience composite.',
    control: { kind: 'range', min: 0, max: 60, step: 1 },
    paths: ['record.pro.wins', 'record.proWins'], status: 'live', keywords: ['record'],
    get: (d) => d.record.pro?.wins ?? d.record.proWins,
    set: (d, v) => {
      const n = Math.max(0, Math.round(Number(v)));
      let next = setAtPath(d, 'record.proWins', n);
      const pro = d.record.pro;
      if (pro) {
        // Keep the method breakdown summing to the total: KO, then sub, then decisions.
        const ko = Math.min(pro.koWins ?? 0, n);
        const sub = Math.min(pro.subWins ?? 0, n - ko);
        next = setAtPath(next, 'record.pro', { ...pro, wins: n, koWins: ko, subWins: sub, decWins: n - ko - sub });
      }
      return next;
    },
    probe: { lo: 0, hi: 30, metric: 'boutsChanged', dir: 0, roundSeconds: 90, seeds: 4, minRel: 0.75 },
  },
] as ProfileParam[]);

/**
 * Concepts the brief asked for that the fighter model does not represent as
 * a separate quantity. They are shown in the editor as information only, with
 * the field that carries the idea, so nobody moves a slider that does
 * nothing.
 */
export const UNMODELLED_CONCEPTS: readonly { concept: string; category: ProfileCategory; carriedBy: string }[] = Object.freeze([
  { concept: 'Coordination', category: 'physical', carriedBy: 'No separate attribute. Execution quality comes from sub-skills and the tier behaviour rules; balance covers staying organised under load.' },
  { concept: 'Acceleration', category: 'athletic', carriedBy: 'Not separate from foot speed (Mobility) and explosiveness.' },
  { concept: 'Agility', category: 'athletic', carriedBy: 'Not separate from foot speed (Mobility).' },
  { concept: 'Fatigue resistance', category: 'athletic', carriedBy: 'Not a separate attribute: Endurance (cardio) sets the drain, Recovery the refill.' },
  { concept: 'Movement style', category: 'style', carriedBy: 'Expressed through Pressure, Initiative and Preferred range.' },
]);

/**
 * Stored fields the simulation does not read today. The raw editor keeps
 * them (they round-trip through import/export and some drive the renderer)
 * but badges them "No effect on the bout". Verified by grep of `src/sim/**`
 * and by the parameter-effect suite.
 */
export const NO_SIM_EFFECT_PATHS: readonly { path: string; why: string }[] = Object.freeze([
  { path: 'body.build', why: 'Somatotype drives the rig proportions only.' },
  { path: 'appearance', why: 'Cosmetic by contract.' },
  { path: 'style.tiredBehaviour', why: 'Authored and validated, not read by the AI yet.' },
  { path: 'style.thaiStyle', why: 'A descriptive tag; no AI rule reads it.' },
  { path: 'style.topPriority', why: 'Authored in archetypes, not read by the AI.' },
  { path: 'style.bottomPriority', why: 'Authored in archetypes, not read by the AI.' },
  { path: 'style.pacing', why: 'Per-round output/risk schedule: validated, not read by the plan generator.' },
  { path: 'style.stanceSwitching', why: 'The numeric tendency is not read; choosing the "switch" stance is what enables stance changes.' },
  { path: 'notes', why: 'Free text.' },
]);

export function noSimEffect(path: string): string | null {
  for (const row of NO_SIM_EFFECT_PATHS) {
    if (path === row.path || path.startsWith(`${row.path}.`)) return row.why;
  }
  return null;
}

// --------------------------------------------------------------------------
// Search
// --------------------------------------------------------------------------

export function paramMatches(p: ProfileParam, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const hay = [p.label, p.help, p.id, ...(p.keywords ?? []), ...p.paths.slice(0, 4)].join(' ').toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export function visibleParams(
  params: readonly ProfileParam[], mode: 'basic' | 'advanced', query: string,
): ProfileParam[] {
  const q = query.trim();
  // A search looks through everything: finding a field should not depend on
  // remembering which mode it lives in.
  // Basic mode shows only controls that change the bout; the stored-but-unread
  // ones stay reachable (clearly badged) in Advanced and in search.
  return params.filter((p) => (q !== '' || mode === 'advanced' || (p.level === 'basic' && p.status === 'live'))
    && paramMatches(p, q));
}

export function formatParamValue(p: ProfileParam, value: number | string | boolean | null): string {
  if (value === null) return '—';
  if (p.control.kind === 'toggle') return value ? 'On' : 'Off';
  if (p.control.kind === 'select') {
    return p.control.options.find((o) => o.value === value)?.label ?? String(value);
  }
  const n = Number(value);
  return p.control.format ? p.control.format(n) : String(Math.round(n * 100) / 100);
}
