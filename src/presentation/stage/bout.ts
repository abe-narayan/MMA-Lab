/**
 * BOUT PRESENTATION — the per-bout, never-changing inputs every module reads,
 * built from a bout as the Watch screen loaded it.
 *
 * Pure and GPU-free (the tests build it in Node). Reads the sim's public API
 * only, never writes to it.
 */
import {
  resolveArena, resolveRuleset,
  type FighterDefinition, type FighterRuntime, type Ruleset, type SimConfig,
} from '../../sim';
import type { BoutPresentation, GloveKind } from '../contract';

/** Broadcast corner colours: red and blue for a 1v1, as every fight broadcast does. */
export const CORNER_RED = '#c8262f';
export const CORNER_BLUE = '#2a5bb8';

/**
 * Team colours beyond two sides, chosen to stay distinct from each other and
 * from the canvas under arena lighting (no white, no near-black).
 */
export const TEAM_COLOURS: readonly string[] = [
  CORNER_RED, CORNER_BLUE, '#e0a526', '#2f9e5a', '#8a4fc0', '#e0672a', '#1fa3a8', '#c24f8f',
];

/** The glove a ruleset puts on the fighters' hands. */
export function gloveFor(rs: Pick<Ruleset, 'family' | 'gloves'>): GloveKind {
  const g = rs.gloves;
  if (rs.family === 'grappling' || rs.family === 'judo') return 'grappling';
  if (g.bareKnuckle || g.oz <= 0) return 'bare';
  if (g.fingerless) return 'mma4oz';
  return g.oz >= 14 ? 'boxing16oz' : 'boxing10oz';
}

/**
 * Corner colour per fighter: red/blue in a 1v1 (fighter 0 red), otherwise one
 * colour per team so teammates match and teams differ.
 */
export function cornerColoursFor(teamOf: readonly number[], fighterCount: number): string[] {
  if (fighterCount === 2 && (teamOf[0] ?? 0) !== (teamOf[1] ?? 1)) {
    return (teamOf[0] ?? 0) <= (teamOf[1] ?? 1) ? [CORNER_RED, CORNER_BLUE] : [CORNER_BLUE, CORNER_RED];
  }
  const out: string[] = [];
  for (let i = 0; i < fighterCount; i++) {
    const team = teamOf[i] ?? i;
    out.push(TEAM_COLOURS[team % TEAM_COLOURS.length]);
  }
  return out;
}

export interface BoutSource {
  config: SimConfig;
  fighters: readonly FighterDefinition[];
  runtimes: readonly FighterRuntime[];
}

/** Build the `BoutPresentation` for a loaded bout (e.g. a `WatchBout`). */
export function buildBoutPresentation(src: BoutSource): BoutPresentation {
  const { config } = src;
  const rs = resolveRuleset(config.ruleset);
  const teamOf = [...config.teams.teamOf];
  return {
    fighters: src.fighters,
    runtimes: src.runtimes,
    teamOf,
    arena: resolveArena(config.arena),
    rulesetId: rs.id,
    glove: gloveFor(rs),
    cornerColours: cornerColoursFor(teamOf, src.fighters.length),
    blood: config.settings.blood !== false,
    // Its own namespace so cosmetic streams can never collide with the sim RNG.
    cosmeticSeed: `cosmetic:${config.seed}`,
  };
}
