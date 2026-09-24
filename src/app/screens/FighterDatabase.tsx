/**
 * FIGHTER DATABASE — the list view.
 *
 * The screen is a render of one query object: search, four filters and a sort.
 * Nothing is hidden by a side effect, so the "showing 9 of 41" line can never
 * disagree with the table, and the filtering itself is pure and tested
 * (`model/filterModel`).
 *
 * Built-in archetypes and the user's own fighters share one list. They are the
 * same kind of thing; the only difference is that a built-in is read-only (it
 * is also a *preset*: open it and save, and you get your own copy).
 *
 * Every destructive action can be taken back: deleting shows an Undo toast
 * that restores the fighter exactly, and an import is previewed — fighter by
 * fighter, with the reason for every rejection — before anything is written
 * (`model/importModel`). Export and import are file-based and local; there is
 * no network anywhere in this app.
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
import { DISCIPLINE_LABELS, topDisciplineLabel, weightClassLabel } from '../model/fieldMeta';
import { metresToFeetInches, metresToInches } from '../model/units';
import { previewImport, type ImportPreview } from '../model/importModel';
import { NAME_MAX } from '../store/validate';
import {
  Alert, Button, Dialog, EmptyState, ErrorState, Field, StatusBadge, useConfirm, useToast,
  IconCopy, IconDice, IconDownload, IconEdit, IconPlus, IconSearch, IconTrash, IconUpload, IconUsers,
} from '../ui';

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
  const [message, setMessage] = useState<{ tone: 'ok' | 'alert' | 'info'; text: string } | null>(null);
  const [preview, setPreview] = useState<{ file: string; data: ImportPreview } | null>(null);
  const [renaming, setRenaming] = useState<{ record: FighterRecord; name: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirm, confirmUi] = useConfirm();
  const toast = useToast();

  const [readError, records] = useMemo<[string | null, FighterRecord[]]>(() => {
    try {
      return [null, store.list()];
    } catch (err) {
      // A corrupt localStorage must not blank the screen.
      return [`Could not read the fighter database: ${err instanceof Error ? err.message : String(err)}`, []];
    }
    // `revision` is the dependency that matters: the store is not reactive, so
    // the shell tells us when it has changed.
  }, [store, revision]);

  const visible = useMemo(() => applyQuery(records, query), [records, query]);
  const classes = useMemo(() => weightClassesPresent(records), [records]);
  const custom = useMemo(() => records.filter((r) => !r.builtIn).length, [records]);

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
      setMessage({ tone: 'ok', text: `Exported ${r.summary.name} as a BOUT LAB file (schema version 1).` });
    } catch (err) {
      setMessage({ tone: 'alert', text: `Export failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [store, download]);

  const exportVisible = useCallback(() => {
    try {
      download(store.exportJson(visible.map((r) => r.definition.id)), 'boutlab-fighters.json');
      setMessage({ tone: 'ok', text: `Exported ${visible.length} fighter${visible.length === 1 ? '' : 's'}.` });
    } catch (err) {
      setMessage({ tone: 'alert', text: `Export failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [store, visible, download]);

  const onImportFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const data = previewImport(text, records.map((r) => r.definition.id));
      setPreview({ file: file.name, data });
    } catch (err) {
      setMessage({ tone: 'alert', text: `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [records]);

  const commitImport = useCallback(() => {
    if (!preview?.data.normalised) return;
    try {
      const outcome = store.importJson(preview.data.normalised);
      setPreview(null);
      setMessage({
        tone: outcome.added > 0 ? 'ok' : 'alert',
        text: `Imported ${outcome.added} fighter${outcome.added === 1 ? '' : 's'}`
          + (outcome.skipped > 0 ? `, skipped ${outcome.skipped}.` : '.'),
      });
      onChanged();
    } catch (err) {
      setMessage({ tone: 'alert', text: `Import failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [store, preview, onChanged]);

  const remove = useCallback(async (r: FighterRecord) => {
    const ok = await confirm({
      title: `Delete ${r.summary.name}?`,
      body: 'The fighter is removed from this browser’s database. You can undo this from the notification for a few seconds; bouts already in History keep their copy.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const def = r.definition;
      store.remove(def.id);
      onChanged();
      toast({
        message: `Deleted ${r.summary.name}.`,
        actionLabel: 'Undo',
        onAction: () => {
          try {
            store.save(def);
            onChanged();
          } catch (err) {
            setMessage({ tone: 'alert', text: `Could not restore ${r.summary.name}: ${String(err)}` });
          }
        },
      });
    } catch (err) {
      setMessage({ tone: 'alert', text: `Could not delete: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [store, onChanged, confirm, toast]);

  const duplicate = useCallback((r: FighterRecord) => {
    try {
      const copy = store.duplicate(r.definition.id);
      onChanged();
      toast({
        message: `Duplicated as ${copy.summary.name}.`,
        actionLabel: 'Edit',
        onAction: () => onEdit(copy),
      });
    } catch (err) {
      setMessage({ tone: 'alert', text: `Could not duplicate: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [store, onChanged, toast, onEdit]);

  const commitRename = useCallback(() => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (name === '' || name.length > NAME_MAX) return;
    try {
      const before = renaming.record.definition;
      store.save({ ...before, name });
      setRenaming(null);
      onChanged();
      toast({
        message: `Renamed to ${name}.`,
        actionLabel: 'Undo',
        onAction: () => { store.save(before); onChanged(); },
      });
    } catch (err) {
      setMessage({ tone: 'alert', text: `Could not rename: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [renaming, store, onChanged, toast]);

  const filtered = query.search !== '' || query.discipline !== 'all' || query.tier !== 'all'
    || query.weightClass !== 'all' || query.origin !== 'all';

  return (
    <div className="fdb">
      <header className="page-head">
        <div>
          <h1 className="page-title">Fighters</h1>
          <p className="page-sub">
            {records.length - custom} built-in presets and {custom} of your own. Presets are read-only:
            open one and save it to make your own copy.
            {visible.length !== records.length
              ? <>{' '}<span className="fdb-count">Showing {visible.length} of {records.length}.</span></>
              : null}
            {/* Announced when a filter changes the list (visible only while filtered). */}
            <span className="visually-hidden" role="status">showing {visible.length} of {records.length} fighters</span>
          </p>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon={<IconPlus />} onClick={onNew}>New fighter</Button>
          <Button icon={<IconDice />} onClick={onRandom} title="A seeded, plausible fighter you can then edit">
            Random fighter
          </Button>
          <Button icon={<IconUpload />} onClick={() => fileInput.current?.click()}>Import</Button>
          <Button icon={<IconDownload />} onClick={exportVisible} disabled={visible.length === 0}>
            Export shown
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            aria-label="Import a fighter JSON file"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImportFile(file);
              // Reset so importing the same file twice still fires a change.
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {message ? (
        <Alert tone={message.tone} action={<Button size="sm" variant="ghost" onClick={() => setMessage(null)}>Dismiss</Button>}>
          {message.text}
        </Alert>
      ) : null}

      <div className="fdb-filters" role="search">
        <Field label="Search">
          {(p) => (
            <div className="fdb-search">
              <IconSearch aria-hidden="true" />
              <input
                id={p.id}
                className="field"
                type="search"
                value={query.search}
                placeholder="Name, nickname or tag"
                onChange={(e) => patch({ search: e.target.value })}
              />
            </div>
          )}
        </Field>

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

        <Button variant="ghost" onClick={() => setQuery(EMPTY_QUERY)} disabled={!filtered}>Reset filters</Button>
      </div>

      {readError ? (
        <ErrorState title="The fighter database could not be read" detail={readError}>
          Your browser storage may be full, blocked or damaged. Built-in archetypes are still
          available after a reload; exporting regularly keeps a copy of your own fighters safe.
        </ErrorState>
      ) : visible.length === 0 ? (
        records.length === 0 ? (
          <EmptyState icon={<IconUsers />} title="No fighters yet"
            actions={<><Button variant="primary" icon={<IconPlus />} onClick={onNew}>New fighter</Button><Button icon={<IconUpload />} onClick={() => fileInput.current?.click()}>Import a file</Button></>}>
            Start from a built-in archetype, roll a random one, or import a file.
          </EmptyState>
        ) : (
          <EmptyState icon={<IconSearch />} title="No fighter matches these filters"
            actions={<Button onClick={() => setQuery(EMPTY_QUERY)}>Reset filters</Button>}>
            Try a shorter search, or widen the tier and weight-class filters.
          </EmptyState>
        )
      ) : (
        <div className="table-wrap">
          <table className="fdb-table">
            <caption className="visually-hidden">
              Fighters in the database. Column headers sort; each row has edit, duplicate, export,
              rename and delete actions.
            </caption>
            <thead>
              <tr>
                {(['name', 'tier', 'weight', 'age', 'reach', 'updated'] as SortKey[]).map((key) => (
                  <th key={key} scope="col" className={key === 'age' || key === 'reach' ? 'num' : undefined}
                    aria-sort={query.sort === key ? (query.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="fdb-sort" onClick={() => toggleSort(key)}>
                      {SORT_LABELS[key]}
                      <span aria-hidden="true" className="fdb-sort-caret">{query.sort === key ? (query.dir === 'asc' ? '▴' : '▾') : '↕'}</span>
                    </button>
                  </th>
                ))}
                <th scope="col"><span className="fdb-sort fdb-sort--static">Top discipline</span></th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const s = r.summary;
                return (
                  <tr key={r.definition.id}>
                    <th scope="row" className="fdb-name">
                      <button type="button" className="fdb-name-btn" onClick={() => onEdit(r)} title={r.builtIn ? 'Open this preset' : 'Edit this fighter'}>
                        <span className="fdb-name-main">{s.name}</span>
                      </button>
                      <span className="fdb-name-sub mono">
                        {s.short}
                        {r.builtIn ? <StatusBadge tone="outline">preset</StatusBadge> : null}
                        {' · '}{s.recordLine}{' · '}{s.stance}
                      </span>
                    </th>
                    <td><TierBadge tier={s.overallTier} /></td>
                    <td>{weightClassLabel(s.weightClass)}</td>
                    <td className="num">{s.ageYears}</td>
                    <td className="num" title={`${s.heightCm} cm tall (${metresToFeetInches(s.heightCm / 100)})`}>
                      {s.reachCm} cm <span className="fdb-alt">{metresToInches(s.reachCm / 100)}</span>
                    </td>
                    <td className="mono fdb-when">{r.builtIn ? '—' : r.updatedAt.slice(0, 10)}</td>
                    <td>{topDisciplineLabel(s.topDiscipline)}</td>
                    <td className="fdb-row-actions">
                      <Button size="sm" icon={<IconEdit />} onClick={() => onEdit(r)}>
                        {r.builtIn ? 'Open' : 'Edit'}
                      </Button>
                      <Button size="sm" variant="ghost" iconOnly icon={<IconCopy />} onClick={() => duplicate(r)}
                        aria-label={`Duplicate ${s.name}`} title="Duplicate" />
                      <Button size="sm" variant="ghost" iconOnly icon={<IconDownload />} onClick={() => exportOne(r)}
                        aria-label={`Export ${s.name}`} title="Export as JSON" />
                      <Button size="sm" variant="ghost" onClick={() => setRenaming({ record: r, name: s.name })}
                        disabled={r.builtIn} aria-label={`Rename ${s.name}`}
                        title={r.builtIn ? 'Presets are read-only; duplicate it first' : 'Rename'}>
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon={<IconTrash />}
                        className="fdb-delete"
                        onClick={() => { void remove(r); }}
                        disabled={r.builtIn}
                        aria-label={`Delete ${s.name}`}
                        title={r.builtIn ? 'Built-in archetypes cannot be deleted' : 'Delete'}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview ? `Import ${preview.file}` : 'Import'}
        description={preview?.data.fatal ? undefined : 'Nothing has been written yet. Check the list, then import.'}
        wide
        footer={preview && !preview.data.fatal ? (
          <>
            <Button onClick={() => setPreview(null)}>Cancel</Button>
            <Button variant="primary" onClick={commitImport}
              disabled={!preview.data.fighters.some((f) => f.status !== 'rejected')}>
              Import {preview.data.fighters.filter((f) => f.status !== 'rejected').length} fighter
              {preview.data.fighters.filter((f) => f.status !== 'rejected').length === 1 ? '' : 's'}
            </Button>
          </>
        ) : <Button onClick={() => setPreview(null)}>Close</Button>}
      >
        {preview?.data.fatal ? (
          <ErrorState title="This file cannot be imported">{preview.data.fatal}</ErrorState>
        ) : preview ? (
          <div className="import-preview">
            {preview.data.schemaNote ? <Alert tone="info">{preview.data.schemaNote}</Alert> : null}
            {preview.data.otherContent.length > 0 ? (
              <Alert tone="info">The file also holds {preview.data.otherContent.join(', ')}; only fighters are imported here.</Alert>
            ) : null}
            <ul className="import-list">
              {preview.data.fighters.map((f) => (
                <li key={f.index} data-status={f.status}>
                  <div className="import-row">
                    <b>{f.name}</b>
                    {f.status === 'ok' ? <StatusBadge tone="ok" dot>Will import</StatusBadge> : null}
                    {f.status === 'renamed' ? <StatusBadge tone="info" dot>Will import as {f.finalId}</StatusBadge> : null}
                    {f.status === 'rejected' ? <StatusBadge tone="alert" dot>Rejected</StatusBadge> : null}
                  </div>
                  {f.problems.length > 0 ? (
                    <ul className="import-problems">
                      {f.problems.slice(0, 4).map((p) => <li key={p}>{p}</li>)}
                      {f.problems.length > 4 ? <li>…and {f.problems.length - 4} more.</li> : null}
                    </ul>
                  ) : null}
                  {f.warnings.length > 0 && f.status !== 'rejected' ? (
                    <p className="import-warn">{f.warnings.length} warning{f.warnings.length === 1 ? '' : 's'} (imported anyway): {f.warnings[0]}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename fighter"
        initialFocus="input"
        footer={(
          <>
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button variant="primary" onClick={commitRename} disabled={!renaming || renaming.name.trim() === '' || renaming.name.length > NAME_MAX}>Rename</Button>
          </>
        )}
      >
        {renaming ? (
          <Field label="Name"
            error={renaming.name.trim() === '' ? 'A fighter needs a name.'
              : renaming.name.length > NAME_MAX ? `At most ${NAME_MAX} characters.` : null}
            hint="The id stays the same, so matchups, tournaments and history that use this fighter keep working.">
            {(p) => (
              <input
                id={p.id}
                className="field"
                type="text"
                value={renaming.name}
                maxLength={NAME_MAX}
                aria-invalid={p.invalid || undefined}
                aria-describedby={p.describedBy}
                onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); }}
                style={{ width: '100%' }}
              />
            )}
          </Field>
        ) : null}
      </Dialog>
      {confirmUi}
    </div>
  );
}
