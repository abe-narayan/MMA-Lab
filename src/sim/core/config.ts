/**
 * SIM CONFIGURATION — everything needed to reproduce a bout.
 *
 * A bout is a pure function of this object. A replay file stores it whole
 * (fighter definitions included, not referenced), so a replay never depends on
 * a database that may have changed underneath it.
 *
 * See docs/design/09 §1.3.1 and §3.
 */
import type { FighterDefinition } from '../fighter/types';
import type { ParamOverrides } from '../params';
import type { Ruleset, RulesetId } from '../rules/types';
import type { Arena, ArenaId } from '../rules/arenas/types';

export type MatchMode = '1v1' | 'teams' | 'ffa' | 'crowd';

/** Fighter index → team index. In `ffa` every entry is distinct. */
export interface TeamAssignment {
  teamOf: number[];
}

export type WeightClassId =
  | 'atomweight' | 'strawweight' | 'flyweight' | 'bantamweight' | 'featherweight'
  | 'lightweight' | 'superLightweight' | 'welterweight' | 'superWelterweight'
  | 'middleweight' | 'superMiddleweight' | 'lightHeavyweight' | 'cruiserweight'
  | 'heavyweight' | 'superHeavyweight';

export interface MatchSettings {
  /** Override the ruleset defaults. Never hard-code a round length anywhere else. */
  rounds?: number;
  roundSeconds?: number;
  restSeconds?: number;

  weightClass: WeightClassId | 'openweight' | 'catchweight';
  weighIn: 'none' | 'dayBefore' | 'sameDay';
  mismatchMode: 'classed' | 'openweight';

  refereeStrictness: 'lenient' | 'standard' | 'strict';
  judgingMode: 'hidden' | 'open';
  judgeCulture:
    | 'unified_2025' | 'legacy_2016' | 'thai_stadium' | 'glory' | 'boxing_abc' | 'whole_fight';

  damageRealism: 'realism' | 'arcade' | 'ironman';

  /** Presentation-only. Has no effect on the simulation. */
  blood: boolean;
  /** App-level. Has no effect on the simulation. */
  commentary: boolean;
  /** Playback only. Has no effect on the simulation. */
  speed: 0.1 | 0.25 | 0.5 | 1 | 2 | 4 | 8;

  /** Hard cap for rulesets with no clock (street). */
  maxSeconds?: number;
  /** Index of the fighter with the home crowd, for the judging bias. */
  homeFighter?: number;
}

export const DEFAULT_SETTINGS: MatchSettings = {
  weightClass: 'openweight',
  weighIn: 'none',
  mismatchMode: 'openweight',
  refereeStrictness: 'standard',
  judgingMode: 'hidden',
  judgeCulture: 'unified_2025',
  damageRealism: 'realism',
  blood: true,
  commentary: true,
  speed: 1,
};

export interface SimConfig {
  seed: string;
  mode: MatchMode;
  /** Index in this array is the fighter id. */
  fighters: FighterDefinition[];
  teams: TeamAssignment;
  ruleset: RulesetId | Ruleset;
  arena: ArenaId | Arena;
  settings: MatchSettings;
  paramOverrides?: ParamOverrides;
}

export type BoutMethod =
  | 'ko' | 'tko' | 'tko.doctor' | 'tko.corner' | 'tko.retirement'
  | 'submission' | 'submission.technical'
  | 'decision.unanimous' | 'decision.split' | 'decision.majority'
  | 'decision.technical' | 'draw' | 'draw.majority' | 'draw.split'
  | 'dq' | 'noContest'
  | 'allOpponentsStopped' | 'escaped' | 'separated' | 'timeLimit';

export interface BoutResult {
  /** Winning fighter id, winning team index, or a draw/no-contest. */
  winner: number | 'draw' | 'none';
  winningTeam: number | null;
  method: BoutMethod;
  /** Free-text detail, e.g. the submission id or the stoppage reason. */
  detail: string;
  round: number;
  /** Seconds into the final round. */
  timeSeconds: number;
  /** Total elapsed simulated seconds. */
  totalSeconds: number;
  /** [judge][round] per-fighter points; empty for a finish. */
  scorecards: number[][][];
  judgeTotals: number[][];
}

/** Seed for one bout in a batch: master seed plus mode and index. */
export function boutSeed(master: string, mode: string, index: number): string {
  return `${master}::v4::${mode}::bout-${index}`;
}
