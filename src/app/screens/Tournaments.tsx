/**
 * TOURNAMENTS — docs/design/09 §3.5.
 *
 * Create a draw, run it match by match, watch the bracket fill in. Three
 * formats (single elimination 4/8/16/32, double elimination 8/16, round robin
 * up to 8), three seeding methods, three carry-over settings.
 *
 * The bracket arithmetic is all in `model/bracket.ts` and the carry-over
 * arithmetic in `model/carryOver.ts`; this file is the wiring. That split is
 * deliberate — a double-elimination draw with byes is the kind of thing that
 * is wrong in one corner for months unless it is tested directly, and it
 * cannot be tested directly through JSX.
 *
 * Carry-over state is *derived*, not stored: it is recomputed by walking the
 * tournament's own completed matches and folding the documented fractions
 * forward. That keeps the saved document exactly the shape 09 §3.6 defines,
 * and it means a tournament loaded from an export carries correctly without a
 * migration.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ARENAS, DEFAULT_SETTINGS, boutSeed,
  type ArenaId, type FighterDefinition, type RulesetId,
} from '../../sim';
import type { FighterRecord, HistoryEntry, Tournament } from '../store/types';
import type { FighterStoreApi } from '../storeApi';
import type { MatchStoreApi } from '../run/matchStore';
import { historyEntryFor, runBout, type BoutRunOutcome } from '../run/runBout';
import {
  ARENA_IDS, RULESET_IDS, RULESET_LABELS, pairingWarning,
} from '../model/matchModel';
import {
  MAX_NO_DECISION_RUNS, SUPPORTED_SIZES, applyResult, bracketPlan, buildBracket, championOf,
  flatMatchIndex, matchCount, matchSeed, readyMatches, recordNoDecision, resolveMatch, seedOrder,
  standings, type BracketFormat, type BracketMatch,
} from '../model/bracket';
import {
  CAREER_GAP_DAYS, FRESH, KO_HISTORY_ODDS_RATIO, applyCarryOver, carriedAfter, damageLedger,
  describeCarry, EMPTY_LEDGER, type CarriedState, type DamageLedger,
} from '../model/carryOver';
import { clockOf, methodLabel } from './BoutResult';
import { EmptyState, useConfirm, useToast, IconTrophy } from '../ui';

export interface TournamentsProps {
  store: FighterStoreApi;
  matchStore: MatchStoreApi;
  revision: number;
  onChanged: () => void;
  onRan: (outcome: BoutRunOutcome) => void;
}

const FORMAT_LABELS: Readonly<Record<BracketFormat, string>> = Object.freeze({
  single: 'Single elimination',
  double: 'Double elimination',
  roundRobin: 'Round robin',
});

const CARRY_LABELS: Readonly<Record<Tournament['carryOver'], string>> = Object.freeze({
  none: 'None — every fighter starts fresh',
  sameNight: 'Same night — 30 % head, 50 % body and leg, cuts in full, stamina 85 %',
  career: 'Career — the same, plus KO history and ageing',
});

// --------------------------------------------------------------------------
// Derived carry-over
// --------------------------------------------------------------------------

/**
 * Fold every completed match forward to get each entrant's condition now.
 *
 * A stubbed replay contributes an empty ledger: the body that held the event
 * stream was evicted under quota, and inventing damage for it would be worse
 * than carrying none. The screen says which entrants that applies to.
 */
export function carryStates(
  t: Tournament,
  historyById: (id: string) => HistoryEntry | undefined,
): { state: Map<string, CarriedState>; ledger: Map<string, DamageLedger>; incomplete: string[] } {
  const state = new Map<string, CarriedState>();
  const ledger = new Map<string, DamageLedger>();
  const incomplete: string[] = [];
  if (t.carryOver === 'none') return { state, ledger, incomplete };

  for (const round of t.bracket) {
    for (const m of round) {
      if (!m.historyId || m.a === null || m.b === null) continue;
      const entry = historyById(m.historyId);
      const replay = entry?.replay;
      const events = replay && typeof replay === 'object' && 'events' in replay
        ? replay.events
        : null;
      if (!events) {
        if (entry) incomplete.push(m.historyId);
        continue;
      }
      [m.a, m.b].forEach((id, index) => {
        const led = damageLedger(events, index, entry?.result);
        const before = state.get(id) ?? FRESH;
        state.set(id, carriedAfter(before, led, t.carryOver));
        ledger.set(id, led);
      });
    }
  }
  return { state, ledger, incomplete };
}

// --------------------------------------------------------------------------
// Committing a result
// --------------------------------------------------------------------------

type ResolvedMatch = ReturnType<typeof resolveMatch>;

/**
 * Write one match's outcome through a functional update of the tournament's
 * *current* stored state. Returns null (and writes nothing) when the
 * tournament no longer exists, or the slot no longer holds the pairing that
 * was run, or it already has a winner: in every one of those cases writing
 * would overwrite something newer than this bout.
 */
export function commitMatchResult(
  matchStore: Pick<MatchStoreApi, 'tournaments' | 'putTournament'>,
  tournamentId: string,
  round: number,
  match: number,
  ranSlot: { a: string | null; b: string | null },
  update: (current: Tournament, liveSlot: Tournament['bracket'][number][number]) => { next: Tournament; res: ResolvedMatch },
): ResolvedMatch | null {
  const current = matchStore.tournaments().find((x) => x.id === tournamentId);
  const liveSlot = current?.bracket[round]?.[match];
  if (!current || !liveSlot) return null;
  if (liveSlot.a !== ranSlot.a || liveSlot.b !== ranSlot.b || liveSlot.winner !== null) return null;
  const { next, res } = update(current, liveSlot);
  matchStore.putTournament(next);
  return res;
}

// --------------------------------------------------------------------------
// Screen
// --------------------------------------------------------------------------

export function Tournaments({
  store, matchStore, revision, onChanged, onRan,
}: TournamentsProps): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [confirm, confirmUi] = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState({
    name: 'New tournament',
    format: 'single' as BracketFormat,
    size: 8,
    seeding: 'rating' as Tournament['seeding'],
    carryOver: 'none' as Tournament['carryOver'],
    ruleset: 'mma.unified.3r' as RulesetId,
    arena: 'octagon_30' as ArenaId,
    entrants: [] as string[],
  });

  const records = useMemo<FighterRecord[]>(() => {
    try {
      return store.list();
    } catch {
      return [];
    }
  }, [store, revision]);

  const recordById = useMemo(() => {
    const m = new Map<string, FighterRecord>();
    for (const r of records) m.set(r.definition.id, r);
    return m;
  }, [records]);

  const tournaments = useMemo(
    () => matchStore.tournaments(),
    [matchStore, revision],
  );

  const historyById = useCallback(
    (id: string) => matchStore.history().find((e) => e.id === id),
    [matchStore],
  );

  const current = useMemo(
    () => tournaments.find((t) => t.id === selected) ?? null,
    [tournaments, selected],
  );

  const nameOf = useCallback(
    (id: string | null): string => (id === null ? '—' : recordById.get(id)?.summary.name ?? id),
    [recordById],
  );

  // ---- creation ----------------------------------------------------------

  const toggleEntrant = useCallback((id: string) => {
    setDraft((d) => ({
      ...d,
      entrants: d.entrants.includes(id) ? d.entrants.filter((x) => x !== id) : [...d.entrants, id],
    }));
  }, []);

  const create = useCallback(() => {
    if (draft.entrants.length < 2) {
      setMessage('A tournament needs at least two entrants.');
      return;
    }
    if (draft.entrants.length > draft.size) {
      setMessage(`That draw holds ${draft.size}; you have picked ${draft.entrants.length}.`);
      return;
    }
    const id = `tour.${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'tournament'}.`
      + `${Date.now().toString(36)}`;
    const ordered = seedOrder(
      draft.entrants,
      draft.seeding,
      id,
      (fid) => recordById.get(fid)?.summary.overallTier ?? 0,
    );
    const t: Tournament = {
      id,
      name: draft.name,
      format: draft.format,
      size: draft.size,
      seeding: draft.seeding,
      carryOver: draft.carryOver,
      entrantIds: ordered,
      bracket: buildBracket(draft.format, draft.size, ordered),
      ruleset: draft.ruleset,
      arena: draft.arena,
      settings: { ...DEFAULT_SETTINGS },
      createdAt: new Date().toISOString(),
    };
    matchStore.putTournament(t);
    setSelected(id);
    setMessage(null);
    onChanged();
  }, [draft, matchStore, onChanged, recordById]);

  const remove = useCallback(async (t: Tournament) => {
    const ok = await confirm({
      title: `Delete “${t.name}”?`,
      body: 'The bracket is removed; its bouts stay in History. You can undo this from the notification for a few seconds.',
      confirmLabel: 'Delete tournament',
      danger: true,
    });
    if (!ok) return;
    matchStore.removeTournament(t.id);
    if (selected === t.id) setSelected(null);
    onChanged();
    toast({
      message: `Deleted “${t.name}”.`,
      actionLabel: 'Undo',
      onAction: () => { matchStore.putTournament(t); onChanged(); },
    });
  }, [matchStore, onChanged, selected, confirm, toast]);

  // ---- running a match ---------------------------------------------------

  const runMatch = useCallback((t: Tournament, round: number, match: number) => {
    const slot = t.bracket[round][match];
    if (slot.a === null || slot.b === null) return;
    const defs = [slot.a, slot.b].map((id) => recordById.get(id)?.definition);
    if (!defs[0] || !defs[1]) {
      setMessage('One of those fighters is no longer in the database.');
      return;
    }

    const { state, ledger } = carryStates(t, historyById);
    const prepared = ([slot.a, slot.b] as string[]).map((id, i) => {
      const def = defs[i] as FighterDefinition;
      const carried = state.get(id);
      if (!carried || t.carryOver === 'none') return def;
      return applyCarryOver(
        def, carried, t.carryOver, ledger.get(id) ?? EMPTY_LEDGER,
        t.carryOver === 'career' ? CAREER_GAP_DAYS : 0,
      );
    });

    // A flat, stable index so a match's seed never changes when the bracket
    // grows around it.
    // A rematch after a draw salts that seed with the attempt number (QA-7):
    // a new bout, but the same one every time the tournament is replayed.
    const flat = flatMatchIndex(t.bracket, round, match);
    const attempts = slot.attempts ?? 0;
    const seed = matchSeed(boutSeed(t.id, 'tournament', flat), attempts);

    const key = `${round}:${match}`;
    setRunning(key);
    setMessage(null);
    runBout({
      seed,
      mode: '1v1',
      fighters: prepared,
      teams: { teamOf: [0, 1] },
      ruleset: t.ruleset,
      arena: t.arena,
      settings: t.settings,
    }, { record: true }).promise.then(
      (outcome) => {
        setRunning(null);
        const entry = historyEntryFor(outcome.run, {
          tournamentId: t.id,
          tournamentSlot: { roundIndex: round, matchIndex: match },
          label: `${t.name} — ${bracketPlan(t.format, t.size).rounds[round][match].label}`,
        });
        matchStore.putHistory(entry);

        const r = outcome.run.result;
        const plan = bracketPlan(t.format, t.size);
        // Resolve against the tournament as it is *now*, not the copy this
        // closure captured when the bout started: another match may have
        // finished (or the tournament been deleted) while this one ran, and
        // writing the stale copy back would erase that result.
        const committed = commitMatchResult(matchStore, t.id, round, match, slot, (current, liveSlot) => {
          const res = resolveMatch(liveSlot, current.entrantIds, r.winner, outcome.run.stats.fighters);
          if (res.kind === 'rematch') {
            return { next: { ...current, bracket: recordNoDecision(current.bracket as BracketMatch[][], round, match) }, res };
          }
          return {
            next: { ...current, bracket: applyResult(plan, current.bracket as BracketMatch[][], round, match, res.winnerId, entry.id) },
            res,
          };
        });
        if (committed === null) {
          setMessage('The bout finished, but its tournament was deleted or that match was already decided, '
            + 'so the bracket was left as it is. The bout is in History.');
          onRan(outcome);
          onChanged();
          return;
        }
        const outcomeForBracket = committed;
        if (outcomeForBracket.kind === 'rematch') {
          // A draw or a no-contest has no winner to advance. The match stays
          // open for a rematch on a fresh, derived seed (model/bracket.ts).
          setMessage(`${methodLabel(r.method)} — no winner to advance. Run the match again for a `
            + `rematch on a new seed (run ${outcomeForBracket.nextAttempt + 1} of ${MAX_NO_DECISION_RUNS}; `
            + 'if that is level too, it is decided on knockdowns, significant strikes, takedowns, '
            + 'submission attempts, control time, then seeding).');
          onRan(outcome);
          onChanged();
          return;
        }
        const winnerId = outcomeForBracket.winnerId;
        if (outcomeForBracket.tieBreak) {
          setMessage(`${methodLabel(r.method)} again after ${MAX_NO_DECISION_RUNS} runs — `
            + `${nameOf(winnerId)} advances on the tie-break.`);
        }
        onRan(outcome);
        onChanged();
      },
      (err: unknown) => {
        setRunning(null);
        setMessage(`The bout failed: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
  }, [historyById, matchStore, nameOf, onChanged, onRan, recordById]);

  // ---- render ------------------------------------------------------------

  return (
    <div className="ms">
      <header className="ms-head page-head">
        <div>
          <h1 className="page-title">Tournaments</h1>
          <p className="page-sub">
            Brackets are generated from the entrant list and the seeding method; a random draw is
            seeded from the tournament id, so the same tournament always produces the same bracket.
            Byes fill the gap when there are fewer entrants than places.
          </p>
        </div>
      </header>

      {message ? <p className="ui-alert" role="status">{message}</p> : null}

      <section className="fc-section">
        <h3 className="fc-h fc-h--sub">New tournament</h3>
        <div className="fc-grid">
          <div className="fc-field">
            <label htmlFor="tr-name">Name</label>
            <input
              id="tr-name" className="field" type="text" value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
          <div className="fc-field">
            <label htmlFor="tr-format">Format</label>
            <select
              id="tr-format" className="field" value={draft.format}
              onChange={(e) => {
                const format = e.target.value as BracketFormat;
                setDraft((d) => ({
                  ...d,
                  format,
                  size: SUPPORTED_SIZES[format].includes(d.size)
                    ? d.size
                    : SUPPORTED_SIZES[format][0],
                }));
              }}
            >
              {(Object.keys(FORMAT_LABELS) as BracketFormat[]).map((f) => (
                <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
              ))}
            </select>
            <p className="fc-help">
              Double elimination has no bracket reset: the grand final is one match, and whoever
              comes out of the losers bracket wins the tournament by winning it.
            </p>
          </div>
          <div className="fc-field fc-field--narrow">
            <label htmlFor="tr-size">Draw size</label>
            <select
              id="tr-size" className="field" value={String(draft.size)}
              onChange={(e) => setDraft((d) => ({ ...d, size: Number(e.target.value) }))}
            >
              {SUPPORTED_SIZES[draft.format].map((s) => (
                <option key={s} value={String(s)}>{s}</option>
              ))}
            </select>
          </div>
          <div className="fc-field">
            <label htmlFor="tr-seeding">Seeding</label>
            <select
              id="tr-seeding" className="field" value={draft.seeding}
              onChange={(e) => setDraft((d) => ({ ...d, seeding: e.target.value as Tournament['seeding'] }))}
            >
              <option value="rating">By rating</option>
              <option value="manual">Manual (the order you pick them)</option>
              <option value="random">Random (seeded from the tournament id)</option>
            </select>
          </div>
          <div className="fc-field">
            <label htmlFor="tr-carry">Carry-over</label>
            <select
              id="tr-carry" className="field" value={draft.carryOver}
              onChange={(e) => setDraft((d) => ({ ...d, carryOver: e.target.value as Tournament['carryOver'] }))}
            >
              {(Object.keys(CARRY_LABELS) as Tournament['carryOver'][]).map((c) => (
                <option key={c} value={c}>{CARRY_LABELS[c]}</option>
              ))}
            </select>
            <p className="fc-help">
              The engine has no "start this fighter damaged" input, so a carried pool is applied as
              a penalty on chin, body toughness, foot speed, recovery and cardio. The fractions are
              exact; the mapping onto attributes is an approximation. Under <b>career</b> a fighter
              also takes the knockout onto their record (odds ratio {KO_HISTORY_ODDS_RATIO} per
              prior KO) and ages {CAREER_GAP_DAYS} days between rounds.
            </p>
          </div>
          <div className="fc-field">
            <label htmlFor="tr-ruleset">Ruleset</label>
            <select
              id="tr-ruleset" className="field" value={draft.ruleset}
              onChange={(e) => setDraft((d) => ({ ...d, ruleset: e.target.value as RulesetId }))}
            >
              {RULESET_IDS.map((id) => <option key={id} value={id}>{RULESET_LABELS[id]}</option>)}
            </select>
          </div>
          <div className="fc-field">
            <label htmlFor="tr-arena">Arena</label>
            <select
              id="tr-arena" className="field" value={draft.arena}
              onChange={(e) => setDraft((d) => ({ ...d, arena: e.target.value as ArenaId }))}
            >
              {ARENA_IDS.map((id) => <option key={id} value={id}>{ARENAS[id].name}</option>)}
            </select>
            {pairingWarning(draft.ruleset, draft.arena)
              ? <p className="ms-warn ms-warn--warning">{pairingWarning(draft.ruleset, draft.arena)}</p>
              : null}
          </div>
        </div>

        <fieldset className="fc-fieldset">
          <legend>Entrants — {draft.entrants.length} of {draft.size}</legend>
          <div className="tr-entrants">
            {records.map((r) => (
              <label key={r.definition.id} className="tr-entrant">
                <input
                  type="checkbox"
                  checked={draft.entrants.includes(r.definition.id)}
                  onChange={() => toggleEntrant(r.definition.id)}
                />
                <span>{r.summary.name}</span>
                <span className="mono ms-dim">T{r.summary.overallTier} · {r.summary.weightClass}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="fdb-actions">
          <button type="button" className="btn btn--play" onClick={create}>Create bracket</button>
        </div>
      </section>

      <section className="fc-section">
        <h3 className="fc-h fc-h--sub">Saved tournaments</h3>
        {tournaments.length === 0 ? (
          <EmptyState compact icon={<IconTrophy />} title="No tournaments yet">Pick a format and at least two entrants above, then create the bracket.</EmptyState>
        ) : (
          <div className="fdb-actions tr-list">
            {tournaments.map((t) => (
              <span key={t.id} className="tr-chip">
                <button
                  type="button"
                  className="btn btn--chip"
                  aria-pressed={selected === t.id}
                  onClick={() => setSelected(t.id)}
                >
                  {t.name} · {FORMAT_LABELS[t.format]} {t.size}
                </button>
                <button type="button" className="btn btn--danger btn--chip" onClick={() => { void remove(t); }}>
                  Delete
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {current ? (
        <TournamentView
          t={current}
          nameOf={nameOf}
          running={running}
          onRun={(round, match) => runMatch(current, round, match)}
          carry={carryStates(current, historyById)}
        />
      ) : null}
      {confirmUi}
    </div>
  );
}

// --------------------------------------------------------------------------
// One bracket
// --------------------------------------------------------------------------

function TournamentView({
  t, nameOf, running, onRun, carry,
}: {
  t: Tournament;
  nameOf: (id: string | null) => string;
  running: string | null;
  onRun: (round: number, match: number) => void;
  carry: ReturnType<typeof carryStates>;
}): JSX.Element {
  const plan = useMemo(() => bracketPlan(t.format, t.size), [t.format, t.size]);
  const bracket = t.bracket as BracketMatch[][];
  const ready = readyMatches(plan, bracket);
  const champion = championOf(plan, bracket);
  const table = t.format === 'roundRobin' ? standings(bracket) : [];
  const played = bracket.flat().filter((m) => m.winner !== null).length;

  return (
    <section className="fc-section">
      <header className="ms-head">
        <div>
          <h3 className="fc-h fc-h--sub">{t.name}</h3>
          <p className="ms-sub mono">
            {FORMAT_LABELS[t.format]} · {t.size} places · {t.entrantIds.length} entrants ·{' '}
            {played} of {matchCount(plan)} matches decided · seeding {t.seeding} ·{' '}
            carry-over {t.carryOver}
          </p>
        </div>
      </header>

      {champion ? (
        <p className="ms-warn ms-warn--note">
          <b>{nameOf(champion)}</b> wins {t.name}.
        </p>
      ) : null}

      {carry.incomplete.length > 0 ? (
        <p className="ms-warn ms-warn--warning">
          {carry.incomplete.length} earlier bout
          {carry.incomplete.length === 1 ? '' : 's'} had their replay body evicted under storage
          pressure, so no damage could be carried from them. Carry-over below is therefore an
          underestimate.
        </p>
      ) : null}

      {ready.length > 0 ? (
        <div className="tr-next">
          <h4 className="fc-h fc-h--sub">Next up</h4>
          {ready.map((m) => {
            const key = `${m.round}:${m.match}`;
            return (
              <div key={key} className="tr-next-row">
                <span className="tr-next-label">{m.label}</span>
                <span className="tr-next-fighters">
                  {nameOf(m.a)}
                  <span className="ms-dim"> vs </span>
                  {nameOf(m.b)}
                </span>
                <span className="mono ms-dim">
                  {describeCarry(carry.state.get(m.a) ?? FRESH, t.carryOver)}
                  {' '}
                  {describeCarry(carry.state.get(m.b) ?? FRESH, t.carryOver)}
                </span>
                <button
                  type="button"
                  className="btn btn--play"
                  disabled={running !== null}
                  onClick={() => onRun(m.round, m.match)}
                >
                  {running === key ? 'Running…' : 'Run'}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="tr-bracket">
        {plan.rounds.map((row, r) => (
          <div key={r} className="tr-round">
            <h4 className="tr-round-head">{plan.roundLabels[r]}</h4>
            {row.map((p) => {
              const m = bracket[r]?.[p.match];
              if (!m) return null;
              const bye = m.winner !== null && m.historyId === null && (m.a === null || m.b === null);
              return (
                <div key={p.match} className={`tr-match${m.winner ? ' is-done' : ''}`}>
                  <span className={m.winner === m.a && m.a !== null ? 'tr-side is-winner' : 'tr-side'}>
                    {nameOf(m.a)}
                  </span>
                  <span className={m.winner === m.b && m.b !== null ? 'tr-side is-winner' : 'tr-side'}>
                    {nameOf(m.b)}
                  </span>
                  {bye ? <span className="tag">bye</span> : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {t.format === 'roundRobin' ? (
        <div className="table-wrap">
          <table className="fdb-table">
            <caption className="visually-hidden">Round-robin standings.</caption>
            <thead>
              <tr>
                <th scope="col">Fighter</th>
                <th scope="col">Played</th>
                <th scope="col">Won</th>
                <th scope="col">Lost</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{nameOf(row.id)}</th>
                  <td className="num mono">{row.played}</td>
                  <td className="num mono">{row.wins}</td>
                  <td className="num mono">{row.losses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="fc-help mono">
        Each match runs on the seed <code>{boutSeed(t.id, 'tournament', 0)}</code> and its siblings,
        so a tournament re-run from the same draw produces the same night of fights.
        {' '}Bouts appear in History with their round label; a finish at {clockOf(0)} means the
        opening bell.
      </p>
    </section>
  );
}
