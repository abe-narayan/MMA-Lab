/**
 * APP STATE CONTRACT.
 *
 * The app layer owns three things the simulation deliberately knows nothing
 * about: what the user has saved, what they are currently editing, and how the
 * two are persisted. Everything here is plain data so it can round-trip through
 * JSON without loss — a fighter exported on one machine must import on another
 * and produce bit-identical bouts.
 *
 * See docs/design/09 §3.5 (tournaments, saved matchups, history) and §3.6
 * (persistence and the export schema).
 */
import type {
  FighterDefinition, MatchSettings, MatchMode, TeamAssignment,
  RulesetId, ArenaId, ReplayFileV4, BoutResult,
} from '../../sim';

/** localStorage keys. Versioned so a schema change cannot corrupt old data. */
export const STORAGE_KEYS = {
  fighters: 'boutlab.v1.fighters',
  presets: 'boutlab.v1.presets',
  history: 'boutlab.v1.history',
  settings: 'boutlab.v1.settings',
  tournaments: 'boutlab.v1.tournaments',
} as const;

/** A fighter in the user's database, plus the bookkeeping the sim never sees. */
export interface FighterRecord {
  definition: FighterDefinition;
  /** Built-in archetypes are read-only; a user edit clones them first. */
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
  /** Free-text tags for filtering the database screen. */
  tags: string[];
  /** Denormalised for the list view, so it never has to derive a runtime. */
  summary: FighterSummary;
}

/** What the database list shows without deriving a full runtime. */
export interface FighterSummary {
  name: string;
  short: string;
  recordLine: string;
  weightClass: string;
  heightCm: number;
  reachCm: number;
  ageYears: number;
  stance: string;
  /** Highest discipline tier and its discipline, e.g. "T4 bjj". */
  topDiscipline: string;
  /** Overall tier, for sorting and for the matchmaking warning. */
  overallTier: number;
}

export interface MatchupPreset {
  id: string;
  name: string;
  mode: MatchMode;
  fighterIds: string[];
  teams: TeamAssignment;
  ruleset: RulesetId;
  arena: ArenaId;
  settings: MatchSettings;
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  /** Full replay for recent bouts; a stub once evicted for quota. */
  replay: ReplayFileV4 | { seed: string; digest: string; summary: string };
  result: BoutResult;
  fighterNames: string[];
  tournamentId?: string;
  playedAt: string;
}

export interface Tournament {
  id: string;
  name: string;
  format: 'single' | 'double' | 'roundRobin';
  size: number;
  seeding: 'rating' | 'manual' | 'random';
  carryOver: 'none' | 'sameNight' | 'career';
  entrantIds: string[];
  /** `[round][match]` — null until the match has been simulated. */
  bracket: ({ a: string | null; b: string | null; winner: string | null; historyId: string | null })[][];
  ruleset: RulesetId;
  arena: ArenaId;
  settings: MatchSettings;
  createdAt: string;
}

/** The single JSON document import/export uses (09 §3.6). */
export interface BoutLabExport {
  schemaVersion: 1;
  engineVersion: string;
  /** ISO timestamp. The only place a wall clock appears in saved data. */
  exportedAt: string;
  fighters: FighterDefinition[];
  presets: MatchupPreset[];
  tournaments: Tournament[];
  history: HistoryEntry[];
}

/** Result of validating an imported or edited definition. */
export interface ValidationIssue {
  /** Dotted path into the definition, e.g. `body.reachM`. */
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}
