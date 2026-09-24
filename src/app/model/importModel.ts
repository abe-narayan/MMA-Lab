/**
 * IMPORT PREVIEW — read a fighter file, explain it, change nothing.
 *
 * The database's Import button shows this preview before anything is
 * written: which fighters the file holds, which will be imported (and under
 * what id, when one collides), which are rejected and exactly why. The
 * messages are written for a person holding a file, not for a developer
 * holding a stack trace:
 *
 *   - an empty or truncated file says so ("the file ends early"),
 *   - a file from a newer build names its schema version,
 *   - a fighter that fails validation lists its first problems by field,
 *   - a lone fighter definition or a bare array of them (both common when a
 *     file is hand-edited) is accepted by wrapping it in the export envelope.
 *
 * `normalised` is the JSON text to hand to the store's importer when the user
 * confirms, so the preview and the import can never disagree.
 */

import { importAll } from '../store';

export interface PreviewFighter {
  index: number;
  name: string;
  id: string;
  finalId: string | null;
  status: 'ok' | 'renamed' | 'rejected';
  problems: string[];
  warnings: string[];
}

export interface ImportPreview {
  /** A reason the file cannot be read at all; null when it could be parsed. */
  fatal: string | null;
  fighters: PreviewFighter[];
  /** Presets, tournaments and history in the file, which the database ignores. */
  otherContent: string[];
  normalised: string | null;
  schemaNote: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function looksLikeFighter(v: unknown): boolean {
  return isObject(v) && isObject(v.body) && isObject(v.physical) && typeof v.name === 'string';
}

function parseProblem(err: unknown, text: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/unexpected end|end of json|unterminated/i.test(msg)) {
    return 'The file ends early. It looks truncated or only partly downloaded — export it again and retry.';
  }
  const pos = /position (\d+)/i.exec(msg);
  if (pos) {
    const at = Number(pos[1]);
    const line = text.slice(0, at).split('\n').length;
    return `This is not valid JSON: the text breaks at line ${line}. The file may have been edited by hand or damaged.`;
  }
  return `This is not valid JSON (${msg}).`;
}

export function previewImport(text: string, takenIds: readonly string[]): ImportPreview {
  const empty: ImportPreview = { fatal: null, fighters: [], otherContent: [], normalised: null, schemaNote: null };
  if (text.trim() === '') return { ...empty, fatal: 'The file is empty.' };

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { ...empty, fatal: parseProblem(err, text) };
  }

  // Accept the two shapes people produce by hand.
  let schemaNote: string | null = null;
  if (Array.isArray(doc) && doc.length > 0 && doc.every(looksLikeFighter)) {
    doc = { schemaVersion: 1, fighters: doc };
    schemaNote = 'A bare list of fighter definitions; read as a BOUT LAB export.';
  } else if (looksLikeFighter(doc)) {
    doc = { schemaVersion: 1, fighters: [doc] };
    schemaNote = 'A single fighter definition; read as a BOUT LAB export.';
  }

  if (!isObject(doc)) {
    return { ...empty, fatal: 'This JSON is not a BOUT LAB file: expected an export object with a "fighters" list.' };
  }
  if (doc.schemaVersion !== undefined && doc.schemaVersion !== 1) {
    return {
      ...empty,
      fatal: `This file was written with schema version ${JSON.stringify(doc.schemaVersion)}; this build reads version 1. `
        + 'Open it in the build that exported it, or export it again from there.',
    };
  }
  if (doc.schemaVersion === undefined && schemaNote === null) {
    schemaNote = 'No schemaVersion in the file; read as version 1.';
  }
  if (doc.fighters !== undefined && !Array.isArray(doc.fighters)) {
    return { ...empty, fatal: 'The "fighters" entry must be a list. The file may be damaged or hand-edited.' };
  }
  const raw = (doc.fighters as unknown[] | undefined) ?? [];
  if (raw.length === 0) {
    const has = ['presets', 'tournaments', 'history'].filter((k) => Array.isArray(doc && (doc as Record<string, unknown>)[k]));
    return {
      ...empty,
      fatal: has.length > 0
        ? `This file holds ${has.join(', ')} but no fighters. Import it from the screen that owns that data.`
        : 'This file contains no fighters.',
    };
  }

  const otherContent = ['presets', 'tournaments', 'history']
    .filter((k) => Array.isArray(doc && (doc as Record<string, unknown>)[k]) && ((doc as Record<string, unknown[]>)[k]).length > 0)
    .map((k) => `${((doc as Record<string, unknown[]>)[k]).length} ${k}`);

  // Run the real importer on just the fighters, against the ids in use.
  const result = importAll({ schemaVersion: 1, fighters: raw }, { fighterIds: takenIds });
  const accepted = [...result.fighters];
  const fighters: PreviewFighter[] = raw.map((entry, index) => {
    const at = `fighters[${index}]`;
    const mine = result.issues.filter((i) => i.path === at || i.path.startsWith(`${at}.`));
    const errors = mine.filter((i) => i.severity === 'error')
      .map((i) => `${i.path.slice(at.length + 1) || 'fighter'}: ${i.message}`);
    const warnings = mine.filter((i) => i.severity === 'warning' && !i.path.endsWith('.id'))
      .map((i) => `${i.path.slice(at.length + 1) || 'fighter'}: ${i.message}`);
    const e = isObject(entry) ? entry : {};
    const id = typeof e.id === 'string' ? e.id : '(no id)';
    const rawName = typeof e.name === 'string' && e.name.trim() !== '' ? e.name : `Fighter ${index + 1}`;
    const name = rawName.length > 60 ? `${rawName.slice(0, 60).trimEnd()}…` : rawName;
    if (errors.length > 0) {
      return { index, name, id, finalId: null, status: 'rejected', problems: errors, warnings };
    }
    const def = accepted.shift();
    const finalId = def?.id ?? id;
    return { index, name, id, finalId, status: finalId === id ? 'ok' : 'renamed', problems: [], warnings };
  });

  return {
    fatal: null,
    fighters,
    otherContent,
    normalised: JSON.stringify({ schemaVersion: 1, fighters: raw }),
    schemaNote,
  };
}
