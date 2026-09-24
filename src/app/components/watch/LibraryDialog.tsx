/**
 * SAVED REPLAYS — the library dialog (IndexedDB, replay/library.ts).
 *
 * Lists the saved bouts from the small metadata records only (no replay
 * bytes are read until one is opened), newest first, with size, whether it
 * opens instantly (stored frames) or re-simulates, and an engine-mismatch
 * warning. Import a `.boutreplay` (or a v4 `.json` replay) from disk here too.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SIM_ENGINE_VERSION } from '../../../sim';
import {
  Button, Dialog, EmptyState, ErrorState, LoadingState, StatusBadge, IconDownload, IconTrash, IconUpload,
} from '../../ui';
import type { LibraryBackend, ReplayMeta } from '../../replay/library';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export interface LibraryDialogProps {
  open: boolean;
  onClose(): void;
  library: LibraryBackend;
  /** Bumped by the host after a save so the list refreshes. */
  revision: number;
  currentDigest: string | null;
  onOpen(meta: ReplayMeta): void;
  onDownload(meta: ReplayMeta): void;
  onImport(file: File): void;
}

export function LibraryDialog(props: LibraryDialogProps): JSX.Element | null {
  const { open, library } = props;
  const [items, setItems] = useState<ReplayMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    library.list().then(setItems, (err: unknown) => {
      setItems([]);
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [library]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh, props.revision]);

  const remove = async (m: ReplayMeta): Promise<void> => {
    try {
      await library.remove(m.id);
    } finally {
      refresh();
    }
  };

  const total = (items ?? []).reduce((s, m) => s + m.bytes, 0);

  return (
    <Dialog
      open={open}
      onClose={props.onClose}
      wide
      title="Saved replays"
      description={items && items.length > 0
        ? `${items.length} saved · ${formatBytes(total)} in this browser (IndexedDB). A saved replay re-simulates from its seed; recent ones also keep their frames and open instantly.`
        : 'Replays you save are kept in this browser. A replay stores the seed and setup; the bout re-simulates exactly from it.'}
      footer={(
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".boutreplay,.json,application/json,application/octet-stream"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) props.onImport(f);
            }}
          />
          <Button icon={<IconUpload />} onClick={() => fileRef.current?.click()}>Import a replay file…</Button>
          <Button variant="primary" onClick={props.onClose}>Done</Button>
        </>
      )}
    >
      {items === null ? (
        <LoadingState label="Reading the library…" />
      ) : error ? (
        <ErrorState title="The replay library could not be read">{error}</ErrorState>
      ) : items.length === 0 ? (
        <EmptyState title="No saved replays yet" compact>
          Use <b>Save</b> under the picture to keep this bout, or import a <code>.boutreplay</code> file.
        </EmptyState>
      ) : (
        <ul className="wl-list">
          {items.map((m) => (
            <li key={m.id} className="wl-row" data-current={m.digest === props.currentDigest || undefined}>
              <div className="wl-main">
                <span className="wl-title">{m.label}</span>
                <span className="wl-sub">{m.fighterNames.join(' vs ')} · {m.resultLine}</span>
                <span className="wl-meta">
                  {when(m.savedAt)} · {formatBytes(m.bytes)} · seed <code>{m.seed}</code>
                  {' '}
                  <StatusBadge tone={m.profile === 'library' ? 'ok' : 'neutral'} title={m.profile === 'library' ? 'Frames stored: opens without re-simulating' : 'Re-simulates from the seed when opened'}>
                    {m.profile === 'library' ? 'instant' : 're-sim'}
                  </StatusBadge>
                  {m.engineVersion !== SIM_ENGINE_VERSION ? (
                    <StatusBadge tone="warn" title={`Recorded with engine ${m.engineVersion}; this build is ${SIM_ENGINE_VERSION}`}>
                      engine {m.engineVersion}
                    </StatusBadge>
                  ) : null}
                </span>
              </div>
              <div className="wl-actions">
                <Button size="sm" variant="primary" onClick={() => props.onOpen(m)}>Open</Button>
                <Button size="sm" iconOnly aria-label={`Download ${m.label}`} title="Download as a file" icon={<IconDownload />} onClick={() => props.onDownload(m)} />
                <Button size="sm" iconOnly variant="danger" aria-label={`Delete ${m.label}`} title="Delete" icon={<IconTrash />} onClick={() => { void remove(m); }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
