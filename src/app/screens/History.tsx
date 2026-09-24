/**
 * FIGHT HISTORY — docs/design/09 §3.5, §3.6.
 *
 * Every bout the user has run, newest first, with the four things you can do
 * to a saved fight: watch it again, verify it, export it, delete it.
 *
 * **Verification is reported honestly, including the boring answer.** A replay
 * recorded by a different build of the engine cannot be verified at all — it
 * is not "probably fine", it is `engine-version`, and the screen says so with
 * both version strings. `verifyReplay` is the authority for that verdict and
 * this screen never second-guesses it.
 *
 * **A stub is not a failure.** The store evicts replay bodies under quota
 * pressure (09 §3.6) and keeps the seed and the digest. A stubbed row can
 * still be re-simulated from its seed — that is the entire point of a
 * deterministic engine — it just cannot be verified against a stored event
 * stream that no longer exists.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  SIM_ENGINE_VERSION, configFromReplay, verifyReplay,
  type BoutRun, type ReplayFileV4, type VerifyResult,
} from '../../sim';
import type { HistoryEntry } from '../store/types';
import type { MatchStoreApi } from '../run/matchStore';
import { runBout } from '../run/runBout';
import { clockOf, methodLabel, winnerLabel } from './BoutResult';
import { Button, EmptyState, useConfirm, useToast, IconHistory } from '../ui';

export interface HistoryProps {
  matchStore: MatchStoreApi;
  /** Bumped by the shell after a bout is run, so the list re-reads the store. */
  revision: number;
  onChanged: () => void;
  /** Hand a re-simulated bout to the replay view. */
  onWatch?: (run: BoutRun) => void;
  /** Open the post-fight screen for this run. */
  onOpenResult?: (run: BoutRun) => void;
}

type ReplayStub = { seed: string; digest: string; summary: string };

export function isFullReplay(replay: HistoryEntry['replay']): replay is ReplayFileV4 {
  return typeof replay === 'object' && replay !== null
    && (replay as { format?: unknown }).format === 4;
}

/** The sentence a verdict becomes. The unhappy paths get the most words. */
export function verdictLine(v: VerifyResult): string {
  if (v.verified) {
    return 'Verified: re-simulating this seed reproduced the stored digest, tick count, draw count '
      + 'and event stream exactly.';
  }
  switch (v.reason) {
    case 'engine-version':
      return `Cannot be verified: ${v.detail ?? 'this file was recorded by a different engine build'}. `
        + 'A replay is a claim about one engine; a different build may legitimately produce a '
        + 'different fight from the same seed, so this is not a corruption report.';
    case 'format':
      return 'Cannot be verified: the file is not a v4 replay.';
    case 'params-hash':
      return 'Failed: the stored parameter hash does not match the overrides in the file. The bout '
        + 'was recorded under different model parameters.';
    case 'digest':
      return 'Failed: re-simulating this seed produced a different state digest. The stored result '
        + 'did not come from this engine and these inputs.';
    case 'ticks':
      return 'Failed: the bout re-ran to a different length.';
    case 'draws':
      return 'Failed: the random stream advanced a different number of times — a determinism bug, '
        + 'or a file edited by hand.';
    case 'event-count':
    case 'event-mismatch':
      return 'Failed: the re-simulated event stream differs from the stored one.';
    case 'error':
      return `Failed: re-simulation threw — ${v.detail ?? 'no detail'}.`;
    default:
      return 'Failed, with no reason given. That is itself a bug worth reporting.';
  }
}

export function History({
  matchStore, revision, onChanged, onWatch, onOpenResult,
}: HistoryProps): JSX.Element {
  const [verdicts, setVerdicts] = useState<Record<string, VerifyResult | 'pending'>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, confirmUi] = useConfirm();
  const toast = useToast();

  const entries = useMemo(() => {
    const list = [...matchStore.history()];
    list.sort((a, b) => (b.playedAt ?? '').localeCompare(a.playedAt ?? ''));
    return list;
    // `revision` is the dependency that matters: the store is not reactive.
  }, [matchStore, revision]);

  const verify = useCallback((entry: HistoryEntry) => {
    if (!isFullReplay(entry.replay)) return;
    const file = entry.replay;
    setVerdicts((v) => ({ ...v, [entry.id]: 'pending' }));
    // Verification re-simulates the whole bout. It is deliberately the sync
    // `verifyReplay` rather than a worker round-trip, because that function is
    // the authority on what "verified" means and a reimplementation here could
    // drift from it. The deferral gives React one paint so the row can say
    // "verifying" instead of the page appearing to hang.
    setTimeout(() => {
      let result: VerifyResult;
      try {
        result = verifyReplay(file);
      } catch (err) {
        result = {
          verified: false,
          reason: 'error',
          engineVersionMatch: file.engineVersion === SIM_ENGINE_VERSION,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
      setVerdicts((v) => ({ ...v, [entry.id]: result }));
    }, 0);
  }, []);

  const watch = useCallback((entry: HistoryEntry) => {
    if (!isFullReplay(entry.replay)) {
      setMessage('This bout’s replay body was evicted to make room. It is still reproducible '
        + 'from its seed — paste the seed into Match setup with the same fighters and settings.');
      return;
    }
    const file = entry.replay;
    setBusy(entry.id);
    setMessage(null);
    // Frames are regenerated at load (09 §4.5), in the worker, so a long bout
    // does not freeze the page on its way to the replay view.
    runBout(configFromReplay(file), { record: true }).promise.then(
      (outcome) => {
        setBusy(null);
        if (outcome.run.digest !== file.digest) {
          setMessage('Re-simulated, but the digest does not match the stored one. Watch it if you '
            + 'like — it is not the bout that was recorded.');
        }
        if (onWatch) onWatch(outcome.run);
        else onOpenResult?.(outcome.run);
      },
      (err: unknown) => {
        setBusy(null);
        setMessage(`Could not re-simulate: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
  }, [onWatch, onOpenResult]);

  const exportOne = useCallback((entry: HistoryEntry) => {
    try {
      const text = JSON.stringify(entry.replay, null, 2);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entry.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('Exported.');
    } catch (err) {
      setMessage(`Export failed: ${String(err)}`);
    }
  }, []);

  // Deletes are immediate and undoable: the entry (replay body included) is
  // held by the toast and written back if the user asks.
  const remove = useCallback((entry: HistoryEntry) => {
    matchStore.removeHistory(entry.id);
    onChanged();
    toast({
      message: `Deleted ${entry.fighterNames.join(' vs ')} from history.`,
      actionLabel: 'Undo',
      onAction: () => { matchStore.putHistory(entry); onChanged(); },
    });
  }, [matchStore, onChanged, toast]);

  const clearAll = useCallback(async () => {
    const saved = matchStore.history();
    const ok = await confirm({
      title: `Clear all ${saved.length} bouts from history?`,
      body: 'Tournament brackets keep their results, but their bouts will no longer be re-watchable. You can undo this from the notification for a few seconds.',
      confirmLabel: 'Clear history',
      danger: true,
    });
    if (!ok) return;
    matchStore.clearHistory();
    onChanged();
    toast({
      message: `Cleared ${saved.length} bouts.`,
      actionLabel: 'Undo',
      onAction: () => { for (const e of [...saved].reverse()) matchStore.putHistory(e); onChanged(); },
    });
  }, [matchStore, onChanged, confirm, toast]);

  return (
    <div className="ms">
      <header className="ms-head page-head">
        <div>
          <h1 className="page-title">History</h1>
          <p className="page-sub">
            The last {entries.length} bout{entries.length === 1 ? '' : 's'}. The newest 50 keep a
            full replay; older ones keep the seed, the digest and a summary, which is enough to
            reproduce the fight but not to verify it against a stored stream.
          </p>
        </div>
        <div className="page-actions">
          <Button variant="danger" onClick={() => { void clearAll(); }} disabled={entries.length === 0}>
            Clear history
          </Button>
        </div>
      </header>

      {message ? <p className="ui-alert" role="status">{message}</p> : null}

      {entries.length === 0 ? (
        <EmptyState icon={<IconHistory />} title="No bouts yet">
          Run a bout in Match setup, or a tournament match, and it will appear here with its seed,
          result and a verifiable replay.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="fdb-table">
            <caption className="visually-hidden">Past bouts, newest first.</caption>
            <thead>
              <tr>
                <th scope="col">Bout</th>
                <th scope="col">Result</th>
                <th scope="col">Ruleset</th>
                <th scope="col">When</th>
                <th scope="col">Verification</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const full = isFullReplay(entry.replay);
                const stub = full ? null : entry.replay as ReplayStub;
                const seed = full ? (entry.replay as ReplayFileV4).seed : stub?.seed ?? '';
                const verdict = verdicts[entry.id];
                const rulesetId = full
                  ? (typeof (entry.replay as ReplayFileV4).ruleset === 'string'
                    ? (entry.replay as ReplayFileV4).ruleset as string
                    : ((entry.replay as ReplayFileV4).ruleset as { id: string }).id)
                  : '—';
                return (
                  <tr key={entry.id}>
                    <th scope="row" className="fdb-name">
                      <span className="fdb-name-main">{entry.fighterNames.join(' vs ')}</span>
                      <span className="fdb-name-sub mono">
                        seed {seed}
                        {entry.tournamentId ? <em className="tag">tournament</em> : null}
                        {full ? null : <em className="tag tag--alert">replay evicted</em>}
                      </span>
                    </th>
                    <td>
                      {winnerLabel(entry.result, entry.fighterNames, full ? (entry.replay as ReplayFileV4).teams?.teamOf : undefined)}
                      {' · '}{methodLabel(entry.result.method)}
                      <span className="mono"> · R{entry.result.round} {clockOf(entry.result.timeSeconds)}</span>
                    </td>
                    <td className="mono">{rulesetId}</td>
                    <td className="mono fdb-when">{entry.playedAt.slice(0, 16).replace('T', ' ')}</td>
                    <td className="ms-verdict-cell">
                      {verdict === undefined ? <span className="ms-dim">not checked</span> : null}
                      {verdict === 'pending' ? <span className="ms-dim">verifying…</span> : null}
                      {verdict && verdict !== 'pending' ? (
                        <span className={verdict.verified ? 'badge badge--ok' : 'badge badge--bad'}>
                          {verdict.verified ? 'verified' : verdict.reason ?? 'failed'}
                        </span>
                      ) : null}
                      {verdict && verdict !== 'pending' ? (
                        <span className="ms-verdict-text">{verdictLine(verdict)}</span>
                      ) : null}
                    </td>
                    <td className="fdb-row-actions">
                      <button
                        type="button"
                        className="btn btn--play"
                        onClick={() => watch(entry)}
                        disabled={!full || busy === entry.id}
                      >
                        {busy === entry.id ? 'Loading…' : 'Re-watch'}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => verify(entry)}
                        disabled={!full || verdict === 'pending'}
                        title={full ? 'Re-simulate and compare against the stored claim' : 'The replay body has been evicted'}
                      >
                        Verify
                      </button>
                      <button type="button" className="btn" onClick={() => exportOne(entry)}>Export</button>
                      <button type="button" className="btn btn--danger" onClick={() => remove(entry)}>
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

      <p className="fc-help">
        This build records with engine <code className="mono">{SIM_ENGINE_VERSION}</code>. A replay
        from another build is reported as an engine-version mismatch rather than as a failure,
        because a different engine is allowed to produce a different fight from the same seed.
      </p>
      {confirmUi}
    </div>
  );
}
