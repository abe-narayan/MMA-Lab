/**
 * IMPORT / EXPORT — one JSON document, per 09 §3.6.
 *
 * The import rules are all consequences of one decision: a file from another
 * machine is *data*, not a command. So:
 *
 * - **Validate everything.** A definition with errors is skipped, never
 *   imported half-way; the issues come back with their paths intact so the UI
 *   can say which field of which fighter was wrong.
 * - **Preserve unknown fields.** A newer build's extra field must survive a
 *   round-trip through this one, or exporting from the old build silently
 *   deletes work. Nothing here rebuilds an object field by field — imports
 *   spread the parsed value and change only the id.
 * - **Never overwrite on an id collision.** The incoming fighter gets
 *   `"<id> (imported)"`; the local one is untouched. Presets and brackets that
 *   referenced the renamed id are repointed at the new one in the same pass,
 *   because a saved matchup whose fighters vanished is worse than no import.
 * - **Replays from another engine come in unverifiable.** The digest of a v4
 *   replay only means something against the engine that produced it, so a
 *   mismatch is recorded on the entry rather than used to reject it.
 */

import { SIM_ENGINE_VERSION, type FighterDefinition } from '../../sim';
import { NAME_MAX, validateFighter } from './validate';
import type {
  BoutLabExport, FighterRecord, HistoryEntry, MatchupPreset, Tournament, ValidationIssue,
} from './types';

/** 09 §3.6: a replay from another engine imports with its verification denied. */
export interface ImportedHistoryEntry extends HistoryEntry {
  verified?: boolean;
  verifyReason?: 'engine-version';
}

export interface ExportInput {
  fighters?: readonly FighterDefinition[];
  presets?: readonly MatchupPreset[];
  tournaments?: readonly Tournament[];
  history?: readonly HistoryEntry[];
  /** Injected so a test can pin the one wall-clock field in saved data. */
  nowIso?: string;
  /** Top-level keys carried over from a document a newer build wrote. */
  extra?: Record<string, unknown>;
}

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'engineVersion', 'exportedAt', 'fighters', 'presets', 'tournaments', 'history',
]);

export function exportAll(input: ExportInput = {}): BoutLabExport {
  return {
    ...(input.extra ?? {}),
    schemaVersion: 1,
    engineVersion: SIM_ENGINE_VERSION,
    exportedAt: input.nowIso ?? new Date().toISOString(),
    fighters: [...(input.fighters ?? [])],
    presets: [...(input.presets ?? [])],
    tournaments: [...(input.tournaments ?? [])],
    history: [...(input.history ?? [])],
  };
}

/**
 * The common case: share one fighter as a file. It is the same document with
 * one fighter in it, so an import needs no second code path and a user can
 * merge a single-fighter file into a full backup.
 */
export function exportFighter(def: FighterDefinition, nowIso?: string): BoutLabExport {
  return exportAll({ fighters: [def], nowIso });
}

/** Export the database. Built-ins are excluded: the receiving build has its own. */
export function exportRecords(
  records: readonly FighterRecord[], input: ExportInput = {}, includeBuiltIns = false,
): BoutLabExport {
  const kept = records.filter((r) => includeBuiltIns || !r.builtIn);
  return exportAll({ ...input, fighters: kept.map((r) => r.definition) });
}

export function toJson(doc: BoutLabExport, pretty = true): string {
  return JSON.stringify(doc, null, pretty ? 2 : 0);
}

// --------------------------------------------------------------------------
// Import
// --------------------------------------------------------------------------

export interface ImportContext {
  /** Ids already in use locally; collisions with these get suffixed. */
  fighterIds?: Iterable<string>;
  presetIds?: Iterable<string>;
  tournamentIds?: Iterable<string>;
  historyIds?: Iterable<string>;
  /** Defaults to this build's engine version. */
  engineVersion?: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  issues: ValidationIssue[];
  fighters: FighterDefinition[];
  presets: MatchupPreset[];
  tournaments: Tournament[];
  history: ImportedHistoryEntry[];
  /** Old id -> new id, for everything renamed on collision. */
  renamed: Record<string, string>;
  /** Top-level keys this build does not know, kept for a lossless re-export. */
  extra: Record<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function empty(): ImportResult {
  return {
    imported: 0, skipped: 0, issues: [], fighters: [], presets: [],
    tournaments: [], history: [], renamed: Object.create(null) as Record<string, string>, extra: {},
  };
}

/** `"<id> (imported)"`, then `(imported 2)`, … — never an overwrite (09 §3.6). */
function freeId(id: string, taken: Set<string>): string {
  if (!taken.has(id)) return id;
  const first = `${id} (imported)`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = `${id} (imported ${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

const prefixed = (issue: ValidationIssue, prefix: string): ValidationIssue => ({
  ...issue,
  path: issue.path === '' ? prefix : `${prefix}.${issue.path}`,
});

/**
 * Read a Bout Lab document. Accepts the JSON text or an already-parsed object,
 * because the file picker gives text and a drag-and-drop of an in-page object
 * gives neither a string nor a second chance to parse it.
 */
export function importAll(json: string | unknown, ctx: ImportContext = {}): ImportResult {
  const result = empty();

  let doc: unknown;
  if (typeof json === 'string') {
    try {
      doc = JSON.parse(json);
    } catch (err) {
      result.issues.push({ path: '', message: `not valid JSON: ${String(err)}`, severity: 'error' });
      return result;
    }
  } else {
    doc = json;
  }

  if (!isObject(doc)) {
    result.issues.push({ path: '', message: 'a Bout Lab export must be a JSON object', severity: 'error' });
    return result;
  }

  if (doc.schemaVersion !== undefined && doc.schemaVersion !== 1) {
    result.issues.push({
      path: 'schemaVersion',
      message: `this build reads schemaVersion 1, the file is ${JSON.stringify(doc.schemaVersion)}`,
      severity: 'error',
    });
    return result;
  }

  for (const [k, v] of Object.entries(doc)) if (!TOP_LEVEL_KEYS.has(k)) result.extra[k] = v;

  const fighterIds = new Set(ctx.fighterIds ?? []);
  importFighters(doc.fighters, fighterIds, result);
  importIdentified(doc.presets, 'presets', new Set(ctx.presetIds ?? []), result, (p) => {
    result.presets.push(repointPreset(p as unknown as MatchupPreset, result.renamed));
  });
  importIdentified(doc.tournaments, 'tournaments', new Set(ctx.tournamentIds ?? []), result, (t) => {
    result.tournaments.push(repointTournament(t as unknown as Tournament, result.renamed));
  });
  importHistory(doc.history, new Set(ctx.historyIds ?? []), ctx.engineVersion ?? SIM_ENGINE_VERSION, result);

  return result;
}

/** A single-fighter file is the same document; this only sharpens the return. */
export function importFighter(
  json: string | unknown, ctx: ImportContext = {},
): { definition: FighterDefinition | null; issues: ValidationIssue[] } {
  const result = importAll(json, ctx);
  return { definition: result.fighters[0] ?? null, issues: result.issues };
}

function importFighters(raw: unknown, taken: Set<string>, result: ImportResult): void {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    result.issues.push({ path: 'fighters', message: 'fighters must be an array', severity: 'error' });
    return;
  }

  raw.forEach((original, i) => {
    const at = `fighters[${i}]`;
    // An over-long name is the one identity problem worth repairing rather
    // than refusing: shorten it and say so.
    let entry = original;
    if (isObject(entry) && typeof entry.name === 'string' && entry.name.length > NAME_MAX) {
      const cut = entry.name.slice(0, NAME_MAX).trimEnd();
      result.issues.push({
        path: `${at}.name`,
        message: `the name was ${entry.name.length} characters; imported as "${cut.slice(0, 24)}…" (${NAME_MAX} max)`,
        severity: 'warning',
      });
      entry = { ...entry, name: cut };
    }
    const check = validateFighter(entry);
    for (const issue of check.issues) result.issues.push(prefixed(issue, at));
    if (!check.ok) {
      result.skipped++;
      return;
    }

    const def = entry as FighterDefinition;
    const id = freeId(def.id, taken);
    if (id !== def.id) {
      result.renamed[def.id] = id;
      result.issues.push({
        path: `${at}.id`,
        message: `"${def.id}" is already in use; imported as "${id}"`,
        severity: 'warning',
      });
    }
    taken.add(id);
    // Spread, not rebuild: fields this build has never heard of ride along.
    result.fighters.push({ ...def, id });
    result.imported++;
  });
}

/**
 * Presets, tournaments and history share one shape requirement — an `id` —
 * and one collision rule. Anything past that is the caller's `accept`.
 */
function importIdentified(
  raw: unknown, key: string, taken: Set<string>, result: ImportResult,
  accept: (value: Record<string, unknown>) => void,
): void {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    result.issues.push({ path: key, message: `${key} must be an array`, severity: 'error' });
    return;
  }

  raw.forEach((entry, i) => {
    const at = `${key}[${i}]`;
    if (!isObject(entry) || typeof entry.id !== 'string' || entry.id === '') {
      result.issues.push({ path: at, message: 'entry has no id', severity: 'error' });
      result.skipped++;
      return;
    }
    const id = freeId(entry.id, taken);
    if (id !== entry.id) {
      result.renamed[entry.id] = id;
      result.issues.push({
        path: `${at}.id`,
        message: `"${entry.id}" is already in use; imported as "${id}"`,
        severity: 'warning',
      });
    }
    taken.add(id);
    accept({ ...entry, id });
    result.imported++;
  });
}

function importHistory(raw: unknown, taken: Set<string>, engineVersion: string, result: ImportResult): void {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    result.issues.push({ path: 'history', message: 'history must be an array', severity: 'error' });
    return;
  }

  raw.forEach((entry, i) => {
    const at = `history[${i}]`;
    if (!isObject(entry) || typeof entry.id !== 'string' || entry.id === '') {
      result.issues.push({ path: at, message: 'entry has no id', severity: 'error' });
      result.skipped++;
      return;
    }
    const id = freeId(entry.id, taken);
    if (id !== entry.id) {
      result.renamed[entry.id] = id;
      result.issues.push({
        path: `${at}.id`,
        message: `"${entry.id}" is already in use; imported as "${id}"`,
        severity: 'warning',
      });
    }
    taken.add(id);

    const imported = { ...entry, id } as unknown as ImportedHistoryEntry;
    const replay = imported.replay as { format?: unknown; engineVersion?: unknown } | undefined;
    if (replay?.format === 4 && replay.engineVersion !== engineVersion) {
      // Imported, not rejected: the events are still readable, the digest just
      // cannot be reproduced by this engine (09 §3.6).
      imported.verified = false;
      imported.verifyReason = 'engine-version';
      result.issues.push({
        path: `${at}.replay`,
        message: `recorded by engine ${String(replay.engineVersion)}, this build is ${engineVersion}; imported as unverifiable`,
        severity: 'warning',
      });
    }
    result.history.push(imported);
    result.imported++;
  });
}

// --------------------------------------------------------------------------
// Reference repair
// --------------------------------------------------------------------------

/** The renamed id, reading only the map's own entries (ids are file-chosen). */
function renamedId(renamed: Record<string, string>, id: string): string {
  return Object.prototype.hasOwnProperty.call(renamed, id) ? renamed[id] : id;
}

function repointPreset(preset: MatchupPreset, renamed: Record<string, string>): MatchupPreset {
  if (!Array.isArray(preset.fighterIds)) return preset;
  return { ...preset, fighterIds: preset.fighterIds.map((id) => renamedId(renamed, id)) };
}

function repointTournament(t: Tournament, renamed: Record<string, string>): Tournament {
  const entrantIds = Array.isArray(t.entrantIds) ? t.entrantIds.map((id) => renamedId(renamed, id)) : t.entrantIds;
  const bracket = Array.isArray(t.bracket)
    ? t.bracket.map((round) => (Array.isArray(round)
      ? round.map((m) => ({
        ...m,
        a: m.a === null ? null : renamedId(renamed, m.a),
        b: m.b === null ? null : renamedId(renamed, m.b),
        winner: m.winner === null ? null : renamedId(renamed, m.winner),
      }))
      : round))
    : t.bracket;
  return { ...t, entrantIds, bracket };
}
