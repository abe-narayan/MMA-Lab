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
import {
  Alert, Button, Disclosure, EmptyState, InfoTip, LabelRow, Segmented, StatusBadge, Step, useConfirm, useToast,
  IconPlay, IconPlus, IconTrash, IconTrophy, IconUsers,
} from '../ui';

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

const SEEDING_LABELS: Readonly<Record<Tournament['seeding'], string>> = Object.freeze({
  rating: 'By rating', manual: 'Pick order', random: 'Random',
});
const CARRY_SHORT: Readonly<Record<Tournament['carryOver'], string>> = Object.freeze({
  none: 'None', sameNight: 'Same night', career: 'Career',
});

const CARRY_LABELS: Readonly<Record<Tournament['carryOver'], string>> = Object.freeze({
  none: 'Every fighter starts each match fresh.',
  sameNight: 'Damage carries into the next match: 30 % of head damage, 50 % of body and leg, cuts in full, stamina at 85 %.',
  career: 'As same night, plus the knockout history and ageing between rounds.',
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
  // The builder is open by default only while there are no tournaments.
  const [creating, setCreating] = useState(false);
  const [entrantSearch, setEntrantSearch] = useState('');
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
    setCreating(false);
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

  const q = entrantSearch.trim().toLowerCase();
  const entrantList = useMemo(() => {
    const list = q === '' ? records : records.filter((r) => `${r.summary.name} ${r.summary.short} ${r.tags.join(' ')}`.toLowerCase().includes(q));
    return [...list].sort((a, b) => a.summary.name.localeCompare(b.summary.name));
  }, [records, q]);
  const topRated = useCallback(() => {
    const ranked = [...records].sort((a, b) => (b.summary.overallTier - a.summary.overallTier) || a.summary.name.localeCompare(b.summary.name));
    setDraft((d) => ({ ...d, entrants: ranked.slice(0, d.size).map((r) => r.definition.id) }));
  }, [records]);

  const nameError = draft.name.trim() === '' ? 'Give the tournament a name.' : null;
  const entrantError = draft.entrants.length < 2
    ? 'Pick at least two entrants.'
    : draft.entrants.length > draft.size
      ? `This draw holds ${draft.size}. Remove ${draft.entrants.length - draft.size}, or pick a bigger draw.`
      : null;
  const byes = draft.format === 'roundRobin' ? 0 : Math.max(0, draft.size - draft.entrants.length);
  const canCreate = !nameError && !entrantError;
  const pairing = pairingWarning(draft.ruleset, draft.arena);
  const showBuilder = creating || tournaments.length === 0;
  const advancedChanged = (draft.seeding !== 'rating' ? 1 : 0) + (draft.carryOver !== 'none' ? 1 : 0);

  return (
    <div className="ms setup tr-page">
      <header className="ms-head page-head">
        <div>
          <h1 className="page-title">Tournaments</h1>
          <p className="page-sub">
            Put fighters in a bracket and run it match by match; winners advance until one is left.
            The same tournament always produces the same draw and the same fights.
          </p>
        </div>
        {!showBuilder ? (
          <div className="page-actions">
            <Button variant="primary" icon={<IconPlus />} onClick={() => setCreating(true)}>New tournament</Button>
          </div>
        ) : null}
      </header>

      {message ? <Alert tone="info">{message}</Alert> : null}

      <div className="tr-layout">
        {showBuilder ? (
          <>
            <Step
              n={1}
              title="Format"
              sub={`${FORMAT_LABELS[draft.format]}, ${draft.size} places`}
              status={nameError ? 'Needs a name' : undefined}
              statusTone="warn"
              actions={tournaments.length > 0 ? <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button> : undefined}
            >
              <div className="setup-row">
                <div className="setup-field setup-field--grow" data-invalid={nameError ? true : undefined}>
                  <LabelRow htmlFor="tr-name" label="Name" />
                  <input
                    id="tr-name" className="field" type="text" value={draft.name} maxLength={80}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? 'tr-name-err' : undefined}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                  {nameError ? <p className="ui-field-error" id="tr-name-err">{nameError}</p> : null}
                </div>
                <div className="setup-field">
                  <LabelRow
                    label="Format"
                    tip="Single elimination: one loss and you are out. Double elimination: a second chance through the losers bracket (no bracket reset: the grand final is one match). Round robin: everyone fights everyone."
                  />
                  <Segmented<BracketFormat>
                    label="Format"
                    value={draft.format}
                    onChange={(format) => setDraft((d) => ({
                      ...d,
                      format,
                      size: SUPPORTED_SIZES[format].includes(d.size) ? d.size : SUPPORTED_SIZES[format][0],
                    }))}
                    options={(Object.keys(FORMAT_LABELS) as BracketFormat[]).map((f) => ({ value: f, label: FORMAT_LABELS[f] }))}
                  />
                </div>
                <div className="setup-field">
                  <LabelRow label={draft.format === 'roundRobin' ? 'Fighters' : 'Draw size'} tip="With fewer entrants than places, the top seeds get byes into the next round." />
                  <Segmented<string>
                    label="Draw size"
                    value={String(draft.size)}
                    onChange={(v) => setDraft((d) => ({ ...d, size: Number(v) }))}
                    options={SUPPORTED_SIZES[draft.format].map((s) => ({ value: String(s), label: String(s) }))}
                  />
                </div>
              </div>
            </Step>

            <Step
              n={2}
              title="Entrants"
              sub={`${draft.entrants.length} of ${draft.size} picked${byes > 0 && draft.entrants.length >= 2 ? ` · ${byes} bye${byes === 1 ? '' : 's'}` : ''}`}
              status={entrantError ? (draft.entrants.length > draft.size ? 'Too many' : 'Too few') : 'Ready'}
              statusTone={entrantError ? 'warn' : 'ok'}
            >
              <div className="tr-entrant-tools">
                <input
                  className="field"
                  type="search"
                  placeholder="Filter by name or tag"
                  aria-label="Filter entrants"
                  value={entrantSearch}
                  onChange={(e) => setEntrantSearch(e.target.value)}
                />
                <Button size="sm" onClick={topRated}>Pick the top {draft.size} by rating</Button>
                <Button size="sm" variant="ghost" disabled={draft.entrants.length === 0} onClick={() => setDraft((d) => ({ ...d, entrants: [] }))}>Clear</Button>
              </div>
              {records.length === 0 ? (
                <EmptyState compact icon={<IconUsers />} title="No fighters to enter">Add or import fighters on the Fighters page first.</EmptyState>
              ) : (
                <div className="tr-entrants" role="group" aria-label="Entrants" aria-describedby={entrantError ? 'tr-entrants-err' : undefined}>
                  {entrantList.map((r) => {
                    const on = draft.entrants.includes(r.definition.id);
                    const order = draft.entrants.indexOf(r.definition.id);
                    return (
                      <label key={r.definition.id} className={`tr-entrant${on ? ' is-on' : ''}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleEntrant(r.definition.id)} />
                        <span className="tr-entrant-text">
                          <span className="tr-entrant-name">{r.summary.name}</span>
                          <span className="tr-entrant-meta">
                            {draft.seeding === 'manual' && on ? `Seed ${order + 1} · ` : ''}T{r.summary.overallTier} · {r.summary.weightClass}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  {entrantList.length === 0 ? <p className="ui-field-hint">No fighter matches “{entrantSearch}”.</p> : null}
                </div>
              )}
              {entrantError ? <p className="ui-field-error" id="tr-entrants-err">{entrantError}</p> : null}
            </Step>

            <Step
              n={3}
              title="Rules"
              sub={`${RULESET_LABELS[draft.ruleset]} · ${ARENAS[draft.arena].name}`}
              status={pairing ? 'Non-standard venue' : undefined}
              statusTone="warn"
            >
              <div className="setup-grid">
                <div className="setup-field">
                  <LabelRow htmlFor="tr-ruleset" label="Ruleset" tip="Every match in the tournament uses this ruleset, with its default rounds." />
                  <select
                    id="tr-ruleset" className="field" value={draft.ruleset}
                    onChange={(e) => setDraft((d) => ({ ...d, ruleset: e.target.value as RulesetId }))}
                  >
                    {RULESET_IDS.map((id) => <option key={id} value={id}>{RULESET_LABELS[id]}</option>)}
                  </select>
                </div>
                <div className="setup-field" data-invalid={pairing ? 'warn' : undefined}>
                  <LabelRow htmlFor="tr-arena" label="Arena" />
                  <select
                    id="tr-arena" className="field" value={draft.arena}
                    onChange={(e) => setDraft((d) => ({ ...d, arena: e.target.value as ArenaId }))}
                  >
                    {ARENA_IDS.map((id) => <option key={id} value={id}>{ARENAS[id].name}</option>)}
                  </select>
                  {pairing ? (
                    <p className="setup-warn">
                      Not where this ruleset is normally held. It will still run.
                      <InfoTip text={pairing} label="Why is this venue non-standard?" />
                    </p>
                  ) : null}
                </div>
              </div>

              <Disclosure summary="Seeding and carry-over" summaryNote={advancedChanged > 0 ? `${advancedChanged} changed` : 'Defaults'}>
                <div className="setup-row">
                  <div className="setup-field">
                    <LabelRow label="Seeding" tip="Who meets whom in the first round. Random is seeded from the tournament, so the draw is still reproducible." />
                    <Segmented<Tournament['seeding']>
                      label="Seeding"
                      value={draft.seeding}
                      onChange={(v) => setDraft((d) => ({ ...d, seeding: v }))}
                      options={(['rating', 'manual', 'random'] as const).map((v) => ({ value: v, label: SEEDING_LABELS[v] }))}
                    />
                  </div>
                  <div className="setup-field">
                    <LabelRow
                      label="Carry-over"
                      tip={`Whether damage from earlier matches follows a fighter into the next. It is applied as a penalty on chin, body toughness, foot speed, recovery and cardio (an approximation). Career also adds the knockout to the fighter's record (odds ratio ${KO_HISTORY_ODDS_RATIO} per prior KO) and ages them ${CAREER_GAP_DAYS} days between rounds.`}
                    />
                    <Segmented<Tournament['carryOver']>
                      label="Carry-over"
                      value={draft.carryOver}
                      onChange={(v) => setDraft((d) => ({ ...d, carryOver: v }))}
                      options={(['none', 'sameNight', 'career'] as const).map((v) => ({ value: v, label: CARRY_SHORT[v] }))}
                    />
                    <p className="ui-field-hint">{CARRY_LABELS[draft.carryOver]}</p>
                  </div>
                </div>
              </Disclosure>
            </Step>

            <Step
              n={4}
              title="Create"
              sub={canCreate ? `${draft.name.trim()} · ${draft.entrants.length} entrants` : 'Fix the items above to create the bracket.'}
              status={canCreate ? 'Ready' : 'Not ready'}
              statusTone={canCreate ? 'ok' : 'alert'}
            >
              {!canCreate ? (
                <ul className="setup-problems" aria-label="Before you can create the bracket">
                  {[nameError, entrantError].filter(Boolean).map((p) => <li key={p as string}>{p}</li>)}
                </ul>
              ) : null}
              <div className="setup-run">
                <Button variant="primary" size="lg" icon={<IconTrophy />} disabled={!canCreate} onClick={create}>
                  Create bracket
                </Button>
              </div>
            </Step>
          </>
        ) : null}

        {tournaments.length > 0 ? (
          <section className="ui-step" aria-labelledby="tr-saved-title">
            <header className="ui-step-head">
              <div className="ui-step-heading">
                <h2 className="ui-step-title" id="tr-saved-title">Your tournaments</h2>
                <p className="ui-step-sub">Open one to see its bracket and run the next match.</p>
              </div>
            </header>
            <div className="ui-step-body">
              <div className="tr-saved">
                {tournaments.map((t) => {
                  const plan = bracketPlan(t.format, t.size);
                  const done = (t.bracket as BracketMatch[][]).flat().filter((m) => m.winner !== null).length;
                  return (
                    <div key={t.id} className="tr-card" data-selected={selected === t.id || undefined}>
                      <button type="button" className="tr-card-open" aria-pressed={selected === t.id} onClick={() => { setSelected(t.id); setCreating(false); }}>
                        <b>{t.name}</b>
                        <span>{FORMAT_LABELS[t.format]} · {t.entrantIds.length} fighters · {done} of {matchCount(plan)} decided</span>
                      </button>
                      <Button size="sm" variant="ghost" iconOnly aria-label={`Delete ${t.name}`} title="Delete" icon={<IconTrash />} onClick={() => { void remove(t); }} />
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}

        {current && !showBuilder ? (
          <TournamentView
            t={current}
            nameOf={nameOf}
            running={running}
            onRun={(round, match) => runMatch(current, round, match)}
            carry={carryStates(current, historyById)}
          />
        ) : null}
        {!current && !showBuilder && tournaments.length > 0 ? (
          <EmptyState compact icon={<IconTrophy />} title="Pick a tournament">Open one of your tournaments above to see its bracket.</EmptyState>
        ) : null}
      </div>
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
    <section className="ui-step" aria-labelledby="tr-view-title">
      <header className="ui-step-head">
        <div className="ui-step-heading">
          <h2 className="ui-step-title" id="tr-view-title">{t.name}</h2>
          <p className="ui-step-sub">
            {FORMAT_LABELS[t.format]} · {t.entrantIds.length} fighters · seeding {SEEDING_LABELS[t.seeding].toLowerCase()} ·
            {' '}carry-over {CARRY_SHORT[t.carryOver].toLowerCase()}
          </p>
        </div>
        <StatusBadge tone={champion ? 'ok' : 'info'} dot>
          {champion ? 'Finished' : `${played} of ${matchCount(plan)} matches decided`}
        </StatusBadge>
      </header>
      <div className="ui-step-body">

      {champion ? (
        <Alert tone="ok">
          <b>{nameOf(champion)}</b> wins {t.name}.
        </Alert>
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
          <h3 className="section-title">Next up</h3>
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
                {t.carryOver === 'none' ? <span /> : (
                  <span className="ms-dim tr-next-carry">
                    {describeCarry(carry.state.get(m.a) ?? FRESH, t.carryOver)}
                    {' '}
                    {describeCarry(carry.state.get(m.b) ?? FRESH, t.carryOver)}
                  </span>
                )}
                <Button
                  variant="primary"
                  icon={<IconPlay />}
                  disabled={running !== null}
                  busy={running === key}
                  onClick={() => onRun(m.round, m.match)}
                >
                  {running === key ? 'Running…' : 'Run match'}
                </Button>
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

      <p className="ui-field-hint">
        Every match is saved in History with its round label. Seeds are derived from the tournament
        (the first is <code>{boutSeed(t.id, 'tournament', 0)}</code>), so the same draw always
        produces the same night of fights; a finish at {clockOf(0)} means the opening bell.
      </p>
      </div>
    </section>
  );
}
