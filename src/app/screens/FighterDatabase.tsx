/**
 * FIGHTER DATABASE — the list view.
 *
 * The screen is a render of one query object: search, four filters and a sort.
 * Nothing is hidden by a side effect, so the "showing 9 of 41" line can never
 * disagree with the table, and the filtering itself is pure and tested
 * (`model/filterModel`).
 *
 * Built-in archetypes and the user's own fighters share one list rather than
 * two tabs. They are the same kind of thing, the only difference is that a
 * built-in is read-only — and the way to learn the schema is to open one, so
 * hiding them behind a second tab would hide the best documentation there is.
 * Editing a built-in is allowed; the store clones it on save.
 *
 * Export and import are file-based and local. There is no network anywhere in
 * this app, so "share a fighter" means "hand someone a JSON file".
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { DISCIPLINE_IDS, type CoreDisciplineId } from '../../sim';
import type { FighterRecord } from '../store/types';
import type { FighterStoreApi } from '../storeApi';
import { TierBadge } from '../components/TierBadge';
import {
  EMPTY_QUERY, SORT_LABELS, applyQuery, weightClassesPresent,
  type DatabaseQuery, type SortKey,
} from '../model/filterModel';
import { DISCIPLINE_LABELS, weightClassLabel } from '../model/fieldMeta';
import { metresToFeetInches, metresToInches } from '../model/units';

export interface FighterDatabaseProps {
  store: FighterStoreApi;
  /** Bumped by the shell after a save, so the list re-reads the store. */
  revision: number;
  onEdit: (record: FighterRecord) => void;
  onNew: () => void;
  onRandom: () => void;
  onChanged: () => void;
}

export function FighterDatabase({
  store, revision, onEdit, onNew, onRandom, onChanged,
}: FighterDatabaseProps): JSX.Element {
  const [query, setQuery] = useState<DatabaseQuery>(EMPTY_QUERY);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const records = useMemo<FighterRecord[]>(() => {
    try {
      return store.list();
    } catch (err) {
      // A corrupt localStorage must not blank the screen.
      setMessage(`Could not read the fighter database: ${String(err)}`);
      return [];
    }
    // `revision` is the dependency that matters: the store is not reactive, so
    // the shell tells us when it has changed.
  }, [store, revision]);

  const visible = useMemo(() => applyQuery(records, query), [records, query]);
  const classes = useMemo(() => weightClassesPresent(records), [records]);

  const patch = useCallback((p: Partial<DatabaseQuery>) => setQuery((q) => ({ ...q, ...p })), []);

  const toggleSort = useCallback((key: SortKey) => {
    setQuery((q) => (q.sort === key ? { ...q, dir: q.dir === 'asc' ? 'desc' : 'asc' } : { ...q, sort: key, dir: 'asc' }));
  }, []);

  const download = useCallback((text: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Revoking immediately is safe: the click has already handed the blob to
    // the download manager.
    URL.revokeObjectURL(url);
  }, []);

  const exportOne = useCallback((r: FighterRecord) => {
    try {
      download(store.exportJson([r.definition.id]), `${r.definition.id}.json`);
      setMessage(`Exported ${r.summary.name}.`);
    } catch (err) {
      setMessage(`Export failed: ${String(err)}`);
    }
  }, [store, download]);

  const exportVisible = useCallback(() => {
    try {
      download(store.exportJson(visible.map((r) => r.definition.id)), 'boutlab-fighters.json');
      setMessage(`Exported ${visible.length} fighter${visible.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setMessage(`Export failed: ${String(err)}`);
    }
  }, [store, visible, download]);

  const onImportFile = useCallback(async (file: File) => {
    try {
      const outcome = store.importJson(await file.text());
      setMessage(
        `Imported ${outcome.added}, skipped ${outcome.skipped}.` +
        (outcome.problems.length > 0 ? ` ${outcome.problems.slice(0, 3).join(' ')}` : ''),
      );
      onChanged();
    } catch (err) {
      setMessage(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [store, onChanged]);

  const remove = useCallback((r: FighterRecord) => {
    if (!window.confirm(`Delete ${r.summary.name}? This cannot be undone.`)) return;
    try {
      store.remove(r.definition.id);
      setMessage(`Deleted ${r.summary.name}.`);
      onChanged();
    } catch (err) {
      setMessage(`Could not delete: ${String(err)}`);
    }
  }, [store, onChanged]);

  const duplicate = useCallback((r: FighterRecord) => {
    try {
      const copy = store.duplicate(r.definition.id);
      setMessage(`Duplicated as ${copy.summary.name}.`);
      onChanged();
    } catch (err) {
      setMessage(`Could not duplicate: ${String(err)}`);
    }
  }, [store, onChanged]);

  return (
    <div className="fdb">
      <header className="fdb-head">
        <div className="fdb-title">
          <h2 className="fc-h">Fighters</h2>
          <span className="fdb-count mono">
            showing {visible.length} of {records.length}
          </span>
        </div>

        <div className="fdb-actions">
          <button type="button" className="btn btn--play" onClick={onNew}>New fighter</button>
          <button type="button" className="btn" onClick={onRandom} title="A seeded, plausible fighter you can then edit">
            Random fighter
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>Import</button>
          <button type="button" className="btn" onClick={exportVisible} disabled={visible.length === 0}>
            Export shown
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            aria-label="Import a fighter JSON file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImportFile(file);
              // Reset so importing the same file twice still fires a change.
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {message ? <p className="creator-message" role="status">{message}</p> : null}

      <div className="fdb-filters" role="search">
        <div className="fc-field">
          <label htmlFor="fdb-search">Search</label>
          <input
            id="fdb-search"
            className="field"
            type="search"
            value={query.search}
            placeholder="name, nickname, tag"
            onChange={(e) => patch({ search: e.target.value })}
          />
        </div>

        <div className="fc-field">
          <label htmlFor="fdb-discipline">Discipline</label>
          <select id="fdb-discipline" className="field" value={query.discipline}
            onChange={(e) => patch({ discipline: e.target.value as 'all' | CoreDisciplineId })}>
            <option value="all">Any</option>
            {DISCIPLINE_IDS.map((d) => (
              <option key={d} value={d}>{DISCIPLINE_LABELS[d] ?? d}</option>
            ))}
          </select>
        </div>

        <div className="fc-field">
          <label htmlFor="fdb-tier">Overall tier</label>
          <select id="fdb-tier" className="field" value={String(query.tier)}
            onChange={(e) => patch({ tier: e.target.value === 'all' ? 'all' : (Number(e.target.value) as 0 | 1 | 2 | 3 | 4 | 5) })}>
            <option value="all">Any</option>
            {[0, 1, 2, 3, 4, 5].map((t) => (
              <option key={t} value={t}>T{t} and up</option>
            ))}
          </select>
        </div>

        <div className="fc-field">
          <label htmlFor="fdb-class">Weight class</label>
          <select id="fdb-class" className="field" value={query.weightClass}
            onChange={(e) => patch({ weightClass: e.target.value })}>
            <option value="all">Any</option>
            {classes.map((c) => (
              <option key={c} value={c}>{weightClassLabel(c)}</option>
            ))}
          </select>
        </div>

        <div className="fc-field">
          <label htmlFor="fdb-origin">Source</label>
          <select id="fdb-origin" className="field" value={query.origin}
            onChange={(e) => patch({ origin: e.target.value as DatabaseQuery['origin'] })}>
            <option value="all">All</option>
            <option value="builtIn">Built-in archetypes</option>
            <option value="custom">My fighters</option>
          </select>
        </div>

        <button type="button" className="btn" onClick={() => setQuery(EMPTY_QUERY)}>Reset</button>
      </div>

      {visible.length === 0 ? (
        <p className="empty">
          {records.length === 0
            ? 'No fighters yet. Start from a built-in archetype, roll a random one, or import a file.'
            : 'No fighter matches these filters.'}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="fdb-table">
            <caption className="visually-hidden">
              Fighters in the database. Column headers sort; each row has edit, duplicate, export
              and delete actions.
            </caption>
            <thead>
              <tr>
                {(['name', 'tier', 'weight', 'age', 'reach', 'updated'] as SortKey[]).map((key) => (
                  <th key={key} scope="col" aria-sort={query.sort === key ? (query.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="fdb-sort" onClick={() => toggleSort(key)}>
                      {SORT_LABELS[key]}
                      {query.sort === key ? <span aria-hidden="true">{query.dir === 'asc' ? ' ▴' : ' ▾'}</span> : null}
                    </button>
                  </th>
                ))}
                <th scope="col">Top discipline</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const s = r.summary;
                return (
                  <tr key={r.definition.id}>
                    <th scope="row" className="fdb-name">
                      <span className="fdb-name-main">{s.name}</span>
                      <span className="fdb-name-sub mono">
                        {s.short}
                        {r.builtIn ? <em className="tag">built-in</em> : null}
                        {' · '}{s.recordLine}{' · '}{s.stance}
                      </span>
                    </th>
                    <td><TierBadge tier={s.overallTier} /></td>
                    <td>{weightClassLabel(s.weightClass)}</td>
                    <td className="num">{s.ageYears}</td>
                    <td className="num" title={`${s.heightCm} cm tall (${metresToFeetInches(s.heightCm / 100)})`}>
                      {s.reachCm} cm <span className="fdb-alt">{metresToInches(s.reachCm / 100)}</span>
                    </td>
                    <td className="mono fdb-when">{r.updatedAt.slice(0, 10)}</td>
                    <td>{s.topDiscipline}</td>
                    <td className="fdb-row-actions">
                      <button type="button" className="btn" onClick={() => onEdit(r)}>
                        {r.builtIn ? 'Open' : 'Edit'}
                      </button>
                      <button type="button" className="btn" onClick={() => duplicate(r)}>Duplicate</button>
                      <button type="button" className="btn" onClick={() => exportOne(r)}>Export</button>
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => remove(r)}
                        disabled={r.builtIn}
                        title={r.builtIn ? 'Built-in archetypes cannot be deleted' : 'Delete this fighter'}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
