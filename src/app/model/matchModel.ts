/**
 * MATCH MODEL — everything the match-setup screen decides, as pure data.
 *
 * The screen is a render of one `MatchDraft` plus the functions below. Nothing
 * here touches React, storage or the clock, for the usual reason: a bout is a
 * pure function of its `SimConfig`, so the code that *builds* that config has
 * to be testable without a browser. `tests/match.setup.test.ts` drives every
 * function in this file directly.
 *
 * Sources: docs/design/09 §3.1 (modes), §3.2 (rulesets), §3.3 (arenas and the
 * legality table), §3.4 (match settings, weight classes, the damage-realism
 * tradeoff table).
 */

import {
  ARENAS, RULESETS, DEFAULT_SETTINGS, RNG, weightClassFor,
  type ArenaId, type FighterDefinition, type MatchMode, type MatchSettings,
  type RulesetId, type SimConfig, type TeamAssignment, type WeightClassId,
} from '../../sim';

// --------------------------------------------------------------------------
// Modes and team shapes (09 §3.1)
// --------------------------------------------------------------------------

export const MATCH_MODES: readonly { id: MatchMode; label: string; help: string }[] = Object.freeze([
  {
    id: '1v1',
    label: 'One on one',
    help: 'A standard bout. Finishes follow the ruleset; on the bell the judges decide.',
  },
  {
    id: 'teams',
    label: 'Teams',
    help: 'Two teams. A team loses when its last live fighter is stopped; on the bell the judges '
      + 'score team aggregates per round (09 §4.3). Friendly fire is off.',
  },
  {
    id: 'ffa',
    label: 'Free-for-all',
    help: 'Two to six fighters, every one on their own team. Last one standing wins; on time, the '
      + 'highest total effective score wins.',
  },
  {
    id: 'crowd',
    label: 'Crowd (one vs many)',
    help: 'One defender against two to eight attackers under the street ruleset. The defender wins '
      + 'by stopping everyone or by escaping; there is no clock, so the cap below ends it as '
      + '"separated" — which is roughly what happens to half of real street fights.',
  },
]);

export type TeamPresetId = '2v2' | '1v2' | '1v3' | '1v5' | '3v3';

/** The five team presets 09 §3.1 names, as (side A, side B) sizes. */
export const TEAM_PRESETS: Readonly<Record<TeamPresetId, readonly [number, number]>> = Object.freeze({
  '2v2': [2, 2],
  '1v2': [1, 2],
  '1v3': [1, 3],
  '1v5': [1, 5],
  '3v3': [3, 3],
});

export const TEAM_PRESET_IDS = Object.keys(TEAM_PRESETS) as TeamPresetId[];

export const FFA_MIN = 2;
export const FFA_MAX = 6;
export const CROWD_MIN_ATTACKERS = 2;
export const CROWD_MAX_ATTACKERS = 8;

/** The part of a draft that decides how many fighters go on which side. */
export interface MatchShape {
  mode: MatchMode;
  teamPreset: TeamPresetId;
  /** `ffa` only: total fighters, 2–6. */
  ffaCount: number;
  /** `crowd` only: attackers, 2–8. The defender is always slot 0. */
  crowdAttackers: number;
}

export const DEFAULT_SHAPE: MatchShape = Object.freeze({
  mode: '1v1',
  teamPreset: '2v2',
  ffaCount: 3,
  crowdAttackers: 3,
});

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));

/** Fighters per team, in team order. Team 0 is side A / the defender. */
export function sideCounts(shape: MatchShape): number[] {
  switch (shape.mode) {
    case '1v1':
      return [1, 1];
    case 'teams': {
      const [a, b] = TEAM_PRESETS[shape.teamPreset] ?? TEAM_PRESETS['2v2'];
      return [a, b];
    }
    case 'ffa':
      return new Array<number>(clampInt(shape.ffaCount, FFA_MIN, FFA_MAX)).fill(1);
    case 'crowd':
      return [1, clampInt(shape.crowdAttackers, CROWD_MIN_ATTACKERS, CROWD_MAX_ATTACKERS)];
    default:
      return [1, 1];
  }
}

export function slotCount(shape: MatchShape): number {
  return sideCounts(shape).reduce((a, b) => a + b, 0);
}

/**
 * Fighter index → team index (09 §1.3.1 `TeamAssignment`). Slots are laid out
 * team by team, so in `1v3` the defender is fighter 0 and the three attackers
 * are 1, 2 and 3 — which is also the order the crowd manager expects.
 */
export function teamAssignmentFor(shape: MatchShape): TeamAssignment {
  const teamOf: number[] = [];
  sideCounts(shape).forEach((n, team) => {
    for (let i = 0; i < n; i++) teamOf.push(team);
  });
  return { teamOf };
}

export interface SlotPlan {
  index: number;
  team: number;
  label: string;
}

/** One entry per fighter slot, with the label the setup screen puts on it. */
export function slotPlan(shape: MatchShape): SlotPlan[] {
  const counts = sideCounts(shape);
  const out: SlotPlan[] = [];
  let index = 0;
  counts.forEach((n, team) => {
    for (let i = 0; i < n; i++) {
      out.push({ index, team, label: slotLabel(shape.mode, team, i, n) });
      index++;
    }
  });
  return out;
}

function slotLabel(mode: MatchMode, team: number, within: number, teamSize: number): string {
  if (mode === '1v1') return team === 0 ? 'Red corner' : 'Blue corner';
  if (mode === 'ffa') return `Fighter ${team + 1}`;
  if (mode === 'crowd') return team === 0 ? 'Defender' : `Attacker ${within + 1}`;
  const side = team === 0 ? 'A' : 'B';
  return teamSize === 1 ? `Team ${side}` : `Team ${side} · ${within + 1}`;
}

// --------------------------------------------------------------------------
// Rulesets and arenas (09 §3.2, §3.3)
// --------------------------------------------------------------------------

export const RULESET_IDS = Object.keys(RULESETS) as RulesetId[];
export const ARENA_IDS = Object.keys(ARENAS) as ArenaId[];

/** Display names. `Ruleset` itself carries an id and a family, not a label. */
export const RULESET_LABELS: Readonly<Record<RulesetId, string>> = Object.freeze({
  'mma.unified.3r': 'MMA — Unified, 3 rounds',
  'mma.unified.5r': 'MMA — Unified, 5 rounds',
  'mma.unified.2017': 'MMA — Unified 2017 (no 12-6 elbows, legacy judging)',
  'mma.amateur': 'MMA — Amateur',
  'boxing.pro': 'Boxing — Professional',
  'kickboxing.glory': 'Kickboxing — Glory',
  'kickboxing.k1': 'Kickboxing — K-1',
  'muay_thai.abc': 'Muay Thai — ABC',
  'muay_thai.stadium': 'Muay Thai — Stadium',
  'grappling.ibjjf': 'Grappling — IBJJF',
  'grappling.adcc': 'Grappling — ADCC',
  'grappling.subonly': 'Grappling — Submission only',
  'judo.ijf': 'Judo — IJF',
  street: 'Street (no rounds, no referee, everything legal)',
});

/** The ruleset's own round structure, for the "leave blank to use" hints. */
export function rulesetClock(id: RulesetId): { rounds: number; roundSeconds: number; restSeconds: number } {
  const r = RULESETS[id].rounds;
  return { rounds: r.count, roundSeconds: r.lengthS, restSeconds: r.breakS };
}

const RINGS: readonly ArenaId[] = ['ring_16', 'ring_20', 'ring_24'];
const CAGES: readonly ArenaId[] = ['octagon_30', 'octagon_25'];

/**
 * The 09 §3.3 legality table, verbatim:
 *
 *   `mma_* × {octagon_*, ring_*}`, `boxing × ring_*`, `kickboxing_* × ring_*`,
 *   `muay_thai × ring_*` (cage ≥ 16 ft allowed), `grappling_* × mat_ibjjf`,
 *   `judo_ijf × tatami_ijf`, `street × street_*`.
 *
 * Every other pairing is *allowed* — it is simply marked "non-standard". This
 * is a warning, never a block: running judo on concrete is a legitimate thing
 * to want to simulate, and refusing it would make the tool less useful without
 * making any answer more correct.
 */
export const STANDARD_ARENAS: Readonly<Record<RulesetId, readonly ArenaId[]>> = Object.freeze({
  'mma.unified.3r': [...CAGES, ...RINGS],
  'mma.unified.5r': [...CAGES, ...RINGS],
  'mma.unified.2017': [...CAGES, ...RINGS],
  'mma.amateur': [...CAGES, ...RINGS],
  'boxing.pro': [...RINGS],
  'kickboxing.glory': [...RINGS],
  'kickboxing.k1': [...RINGS],
  // "cage ≥ 16 ft allowed" — both octagons are well over 16 ft across.
  'muay_thai.abc': [...RINGS, ...CAGES],
  'muay_thai.stadium': [...RINGS, ...CAGES],
  'grappling.ibjjf': ['mat_ibjjf'],
  'grappling.adcc': ['mat_ibjjf'],
  'grappling.subonly': ['mat_ibjjf'],
  'judo.ijf': ['tatami_ijf'],
  street: ['street_open', 'street_grass'],
});

export function isStandardPairing(ruleset: RulesetId, arena: ArenaId): boolean {
  return (STANDARD_ARENAS[ruleset] ?? []).includes(arena);
}

/** The sentence the setup screen shows under the arena picker, or null. */
export function pairingWarning(ruleset: RulesetId, arena: ArenaId): string | null {
  if (isStandardPairing(ruleset, arena)) return null;
  const standard = (STANDARD_ARENAS[ruleset] ?? []).map((a) => ARENAS[a].name).join(', ');
  return `Non-standard: ${RULESET_LABELS[ruleset] ?? ruleset} is normally contested in `
    + `${standard || 'no listed arena'}. The bout will run — surface hardness, wall behaviour and `
    + 'out-of-bounds policy all come from the arena, so the result is still meaningful, it is just '
    + 'not a pairing any sanctioning body uses.';
}

// --------------------------------------------------------------------------
// Weight classes (09 §3.4)
// --------------------------------------------------------------------------

export interface WeightClassRow {
  id: WeightClassId;
  label: string;
  limitLb: number;
  limitKg: number;
  /** Shown by default; the rest hide behind the "all ABC classes" toggle. */
  common: boolean;
}

/** 09 §3.4's table, kg at 0.45359 kg/lb. */
export const WEIGHT_CLASSES: readonly WeightClassRow[] = Object.freeze([
  { id: 'atomweight', label: 'Atomweight', limitLb: 105, limitKg: 47.6, common: false },
  { id: 'strawweight', label: 'Strawweight', limitLb: 115, limitKg: 52.2, common: true },
  { id: 'flyweight', label: 'Flyweight', limitLb: 125, limitKg: 56.7, common: true },
  { id: 'bantamweight', label: 'Bantamweight', limitLb: 135, limitKg: 61.2, common: true },
  { id: 'featherweight', label: 'Featherweight', limitLb: 145, limitKg: 65.8, common: true },
  { id: 'lightweight', label: 'Lightweight', limitLb: 155, limitKg: 70.3, common: true },
  { id: 'superLightweight', label: 'Super Lightweight', limitLb: 165, limitKg: 74.8, common: false },
  { id: 'welterweight', label: 'Welterweight', limitLb: 170, limitKg: 77.1, common: true },
  { id: 'superWelterweight', label: 'Super Welterweight', limitLb: 175, limitKg: 79.4, common: false },
  { id: 'middleweight', label: 'Middleweight', limitLb: 185, limitKg: 83.9, common: true },
  { id: 'superMiddleweight', label: 'Super Middleweight', limitLb: 195, limitKg: 88.5, common: false },
  { id: 'lightHeavyweight', label: 'Light Heavyweight', limitLb: 205, limitKg: 93.0, common: true },
  { id: 'cruiserweight', label: 'Cruiserweight', limitLb: 225, limitKg: 102.1, common: false },
  { id: 'heavyweight', label: 'Heavyweight', limitLb: 265, limitKg: 120.2, common: true },
  { id: 'superHeavyweight', label: 'Super Heavyweight', limitLb: 266, limitKg: 140.0, common: false },
]);

/** Catch-weight rule (09 §3.4): the heavier may not exceed the lighter by 5 lb. */
export const CATCHWEIGHT_MAX_GAP_KG = 5 * 0.45359;

const CLASS_ORDER: readonly string[] = WEIGHT_CLASSES.map((w) => `wc.${snake(w.id)}`);

function snake(id: string): string {
  return id.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`);
}

/** `superLightweight` → `wc.super_lightweight`, the id the fighter schema uses. */
export function fighterClassId(id: WeightClassId): string {
  return `wc.${snake(id)}`;
}

export function weightClassLabelOf(id: WeightClassId | 'openweight' | 'catchweight'): string {
  if (id === 'openweight') return 'Openweight';
  if (id === 'catchweight') return 'Catchweight';
  return WEIGHT_CLASSES.find((w) => w.id === id)?.label ?? id;
}

/** Fight-night mass, falling back through the optional fields the schema allows. */
export function fightNightKg(def: FighterDefinition): number {
  return def.body.fightNightKg ?? def.body.massKg;
}

function classIndexOf(def: FighterDefinition): number {
  const explicit = def.body.weightClass;
  const id = explicit && explicit !== 'wc.open'
    ? explicit
    : weightClassFor(def.body.weighInKg ?? def.body.massKg);
  const i = CLASS_ORDER.indexOf(id);
  return i === -1 ? CLASS_ORDER.length - 1 : i;
}

// --------------------------------------------------------------------------
// Mismatch warnings (09 §3.4)
// --------------------------------------------------------------------------

export interface MatchWarning {
  level: 'error' | 'warning' | 'note';
  text: string;
}

/** Tier gap at which the setup screen calls the pairing extreme. */
export const EXTREME_TIER_GAP = 2;
/** Fight-night mass ratio at which the setup screen calls the pairing extreme. */
export const EXTREME_MASS_RATIO = 1.25;

/**
 * Everything the screen says about whether this is a fair fight.
 *
 * `mismatchMode: 'classed'` is a *rule*: a violation is an error, because the
 * user asked for the class check. `'openweight'` turns the check off and the
 * screen instead reports the size effect it is buying (09 §3.4: +8–12 pp one
 * class up, +15–25 pp two), because a silent openweight bout is how a user
 * ends up mystified by a 90 % win rate.
 */
export function mismatchWarnings(
  defs: readonly FighterDefinition[],
  settings: MatchSettings,
  tierOf?: (def: FighterDefinition) => number,
): MatchWarning[] {
  const out: MatchWarning[] = [];
  const present = defs.filter((d): d is FighterDefinition => Boolean(d));
  if (present.length < 2) return out;

  const masses = present.map(fightNightKg);
  const classes = present.map(classIndexOf);
  const lightest = Math.min(...masses);
  const heaviest = Math.max(...masses);
  const classGap = Math.max(...classes) - Math.min(...classes);

  if (settings.mismatchMode === 'classed') {
    if (settings.weightClass === 'catchweight') {
      const gap = heaviest - lightest;
      if (gap > CATCHWEIGHT_MAX_GAP_KG + 1e-9) {
        out.push({
          level: 'error',
          text: `Catchweight allows the heavier fighter to exceed the lighter by ${CATCHWEIGHT_MAX_GAP_KG.toFixed(2)} kg `
            + `(5 lb); this pairing is ${gap.toFixed(1)} kg apart. Switch to openweight to run it anyway.`,
        });
      }
    } else if (settings.weightClass === 'openweight') {
      out.push({
        level: 'warning',
        text: 'Mismatch mode is "classed" but the bout has no class. Pick a weight class, or set '
          + 'mismatch mode to openweight.',
      });
    } else {
      const limit = WEIGHT_CLASSES.find((w) => w.id === settings.weightClass);
      const over = limit ? present.filter((d) => fightNightKg(d) > limit.limitKg) : [];
      if (limit && over.length > 0) {
        out.push({
          level: 'error',
          text: `${over.map((d) => d.short || d.name).join(', ')} `
            + `${over.length === 1 ? 'is' : 'are'} over the ${limit.label} limit of `
            + `${limit.limitKg.toFixed(1)} kg on fight-night mass. Weigh-in mass is what a `
            + 'commission checks; this is the mass the sim actually uses.',
        });
      }
      if (classGap > 0) {
        out.push({
          level: 'error',
          text: `The fighters sit ${classGap} weight ${classGap === 1 ? 'class' : 'classes'} apart, `
            + 'which the classed rule forbids.',
        });
      }
    }
  } else if (classGap > 0) {
    const shift = classGap === 1 ? '+8–12 pp' : '+15–25 pp';
    out.push({
      level: 'note',
      text: `Openweight: ${classGap} ${classGap === 1 ? 'class' : 'classes'} apart, so size and `
        + `reach effects are fully on. Expect roughly ${shift} of win probability to the `
        + 'bigger fighter before any skill difference is counted.',
    });
  }

  if (lightest > 0 && heaviest / lightest >= EXTREME_MASS_RATIO) {
    out.push({
      level: 'warning',
      text: `Extreme size gap: ${heaviest.toFixed(1)} kg against ${lightest.toFixed(1)} kg `
        + `(×${(heaviest / lightest).toFixed(2)}). Nothing in the calibration table covers a gap `
        + 'this large, so the numbers this bout produces describe the model, not a real matchup.',
    });
  }

  if (tierOf) {
    const tiers = present.map(tierOf);
    const gap = Math.max(...tiers) - Math.min(...tiers);
    if (gap >= EXTREME_TIER_GAP) {
      out.push({
        level: 'warning',
        text: `Extreme skill gap: T${Math.min(...tiers)} against T${Math.max(...tiers)}. `
          + 'Expect a short, one-sided bout; the calibration targets come from same-tier fights '
          + 'and do not apply here.',
      });
    }
  }

  return out;
}

// --------------------------------------------------------------------------
// Settings vocabulary and help (09 §3.4)
// --------------------------------------------------------------------------

export interface Choice<T extends string> {
  id: T;
  label: string;
  help: string;
}

export const WEIGH_INS: readonly Choice<MatchSettings['weighIn']>[] = Object.freeze([
  { id: 'none', label: 'No cut modelled', help: 'Fight-night mass is the walk-around mass. The default, and the only setting with no hydration penalty.' },
  { id: 'dayBefore', label: 'Day before', help: 'A full day to rehydrate: median regain 8–10 % at light weights, 5.8 % at middleweight, 3 % at heavyweight (01 §2.4.4).' },
  { id: 'sameDay', label: 'Same day', help: 'Hours, not a day. The cut is still in the legs — the largest performance penalty of the three.' },
]);

export const MISMATCH_MODES: readonly Choice<MatchSettings['mismatchMode']>[] = Object.freeze([
  { id: 'classed', label: 'Classed', help: 'Enforce the weight class. Catchweight allows a 5 lb gap; anything wider is refused.' },
  { id: 'openweight', label: 'Openweight', help: 'No class check, and the chapter 01 size effects are fully on. This is how you run a 60 kg fighter against a 120 kg one.' },
]);

export const REFEREE_STRICTNESS: readonly Choice<MatchSettings['refereeStrictness']>[] = Object.freeze([
  { id: 'lenient', label: 'Lenient', help: 'A long leash: more late stoppages, more damage taken after the fight is decided.' },
  { id: 'standard', label: 'Standard', help: 'The default. Calibrated to the stoppage-timing targets in chapter 09 §7.' },
  { id: 'strict', label: 'Strict', help: 'Early intervention: fewer extra strikes after a knockdown, more stoppages that fans would call premature.' },
]);

export const JUDGING_MODES: readonly Choice<MatchSettings['judgingMode']>[] = Object.freeze([
  { id: 'hidden', label: 'Hidden cards', help: 'The default, and what commissions actually do: cards are revealed with the decision.' },
  {
    id: 'open',
    label: 'Open scoring',
    help: 'Cards shown after every round, to you *and* to the fighters — their score belief becomes exact and corner cues become reliable. '
      + 'Expect fighters who are behind to chase the finish more and shoot fewer takedowns (09 §3.4).',
  },
]);

export const JUDGE_CULTURES: readonly Choice<MatchSettings['judgeCulture']>[] = Object.freeze([
  { id: 'unified_2025', label: 'Unified (2025)', help: 'The current ABC criteria: damage first, then grappling and striking effectiveness. The default.' },
  { id: 'legacy_2016', label: 'Unified (2016)', help: 'The pre-2017 reading, which rewarded volume and octagon control more than damage.' },
  { id: 'thai_stadium', label: 'Thai stadium', help: 'Whole-fight arc, late rounds weighted heaviest, visible effect prized over volume.' },
  { id: 'glory', label: 'Glory kickboxing', help: 'Knockdowns and clean power; clinch work largely discounted.' },
  { id: 'boxing_abc', label: 'Boxing (ABC)', help: 'Clean punching, effective aggression, ring generalship, defence — in that order.' },
  { id: 'whole_fight', label: 'Whole fight', help: 'One card for the whole bout rather than ten-point-must rounds. Useful for seeing what round scoring costs.' },
]);

export interface RealismRow {
  id: MatchSettings['damageRealism'];
  label: string;
  changes: string;
  tradeoff: string;
  /** True when the chapter 09 §7 calibration targets still apply. */
  calibrated: boolean;
}

/** 09 §3.4's damage-realism table, kept in the UI word for word. */
export const DAMAGE_REALISM: readonly RealismRow[] = Object.freeze([
  {
    id: 'realism',
    label: 'Realism (default)',
    changes: '×1.0 on everything; calibrated to the chapter 09 §7 targets.',
    tradeoff: 'Flash knockouts, one-punch finishes, doctor stoppages and long grinding decisions all '
      + 'happen at their real rates. It can feel unfair, because real fights are.',
    calibrated: true,
  },
  {
    id: 'arcade',
    label: 'Arcade',
    changes: 'Knockdown probability ×0.6, damage accumulation ×0.8, referee forced to lenient, '
      + 'between-round recovery ×1.3.',
    tradeoff: 'Longer, more back-and-forth fights; the finish rate falls from about 51 % to about 35 %. '
      + 'The calibration table no longer applies and every report from this setting is stamped "arcade".',
    calibrated: false,
  },
  {
    id: 'ironman',
    label: 'Ironman',
    changes: 'Knockdown ×0.5, no TKO from accumulated damage (only KO, submission or decision), no '
      + 'doctor stoppage.',
    tradeoff: 'For tournaments and story modes, where a fighter has to survive the night. Absorption '
      + 'is wildly unrealistic and nothing measured under it transfers to a real matchup.',
    calibrated: false,
  },
]);

export const SPEEDS: readonly MatchSettings['speed'][] = Object.freeze([0.1, 0.25, 0.5, 1, 2, 4, 8]);

export const SETTING_HELP: Readonly<Record<string, string>> = Object.freeze({
  rounds: 'Overrides the ruleset default. Leave blank to use the ruleset, which is the only place a round count should normally come from.',
  roundSeconds: 'Seconds per round, overriding the ruleset. Blank = the ruleset value (300 s for unified MMA, 180 s for boxing and Muay Thai).',
  restSeconds: 'Seconds between rounds. Longer rests mean more recovery, which favours the fighter taking damage.',
  maxSeconds: 'Street has no clock, so this is the hard cap. At the cap the bout ends "separated" — an indecisive ending, which is what happens to roughly half of real street fights. Default 180 s.',
  homeFighter: 'The fighter with the crowd. Worth about +3.6 pp of round-win probability to them on the cards; it changes nothing about the fighting itself.',
  blood: 'Presentation only. Has no effect whatsoever on the simulation — the same seed gives the same bout either way.',
  commentary: 'App-level. Generates the commentary line stream; no effect on the simulation.',
  speed: 'The speed Watch starts this bout at (0.1× to 4×; change it any time with the transport). Playback only: it never changes the fight.',
  seed: 'The whole bout is a pure function of this string plus the settings above. Same seed, same fight, on any machine — so copy it if you want to show someone exactly what you saw.',
});

// --------------------------------------------------------------------------
// Seeds
// --------------------------------------------------------------------------

/**
 * A fresh seed. Not `Math.random()`: this project has exactly one source of
 * randomness, and a seed the user can read, copy and retype is the point of
 * the whole determinism contract. `entropy` is normally `Date.now()`, which
 * makes the result unpredictable in practice while keeping the function pure
 * and testable.
 */
export function newSeed(prefix: string, entropy: number, counter = 0): string {
  const rng = new RNG(`${prefix}|${entropy}|${counter}`);
  const token = Math.floor(rng.next() * 0xffffffff).toString(36).padStart(6, '0');
  return `${prefix}.${entropy.toString(36)}.${token}`;
}

// --------------------------------------------------------------------------
// The draft, and the config it builds
// --------------------------------------------------------------------------

export interface MatchDraft extends MatchShape {
  /** Fighter ids per slot; `null` for an unfilled slot. */
  slots: (string | null)[];
  ruleset: RulesetId;
  arena: ArenaId;
  settings: MatchSettings;
  seed: string;
}

export function defaultDraft(seed: string): MatchDraft {
  return {
    ...DEFAULT_SHAPE,
    slots: [null, null],
    ruleset: 'mma.unified.3r',
    arena: 'octagon_30',
    settings: { ...DEFAULT_SETTINGS },
    seed,
  };
}

/** Grow or shrink `slots` to match the shape, keeping the picks that survive. */
export function resizeSlots(draft: MatchDraft): MatchDraft {
  const want = slotCount(draft);
  if (draft.slots.length === want) return draft;
  const slots = draft.slots.slice(0, want);
  while (slots.length < want) slots.push(null);
  return { ...draft, slots };
}

export interface BuildOutcome {
  config: SimConfig | null;
  /** Blocking reasons. A non-empty list means "Run" is disabled. */
  problems: string[];
}

/**
 * Turn a draft into a `SimConfig`. The only blocking conditions are structural
 * — an empty slot, an id the database no longer has, or a mode whose own
 * bounds are broken. Everything else (a non-standard arena, a wild size gap)
 * is a warning, because the user may well mean it.
 */
export function buildSimConfig(
  draft: MatchDraft,
  lookup: (id: string) => FighterDefinition | undefined,
): BuildOutcome {
  const problems: string[] = [];
  const plan = slotPlan(draft);
  const fighters: FighterDefinition[] = [];

  if (draft.seed.trim() === '') problems.push('The seed cannot be empty — a bout is defined by it.');

  for (const slot of plan) {
    const id = draft.slots[slot.index] ?? null;
    if (id === null || id === '') {
      problems.push(`${slot.label} has no fighter.`);
      continue;
    }
    const def = lookup(id);
    if (!def) {
      problems.push(`${slot.label}: no fighter with id "${id}" is in the database.`);
      continue;
    }
    fighters.push(def);
  }

  const ids = draft.slots.filter((s): s is string => Boolean(s));
  if (new Set(ids).size !== ids.length) {
    problems.push('The same fighter is in two slots. Duplicate one of them first — two entries '
      + 'sharing an id would be the same fighter twice, which the sim cannot represent.');
  }

  if (problems.length > 0) return { config: null, problems };

  const settings: MatchSettings = { ...draft.settings };
  if (draft.ruleset === 'street' && settings.maxSeconds === undefined) settings.maxSeconds = 180;
  if (settings.homeFighter !== undefined
    && (settings.homeFighter < 0 || settings.homeFighter >= fighters.length)) {
    delete settings.homeFighter;
  }

  return {
    config: {
      seed: draft.seed,
      mode: draft.mode,
      fighters,
      teams: teamAssignmentFor(draft),
      ruleset: draft.ruleset,
      arena: draft.arena,
      settings,
    },
    problems: [],
  };
}
