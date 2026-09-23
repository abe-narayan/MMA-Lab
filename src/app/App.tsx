/**
 * APP SHELL (Phase 6).
 *
 * The same three tabs the page has always had — Replay, Dashboard, Model, still
 * rendered by the legacy `src/ui` components against the v3 engine — plus the
 * two new ones: the fighter database and the creator. Phase 7 retires the
 * legacy trio; until then both live here, which is why this file composes
 * `src/ui/*` rather than replacing it.
 *
 * This is also the one file that knows the concrete store module. The screens
 * are written against `FighterStoreApi`, so the mapping from that interface
 * onto `src/app/store` lives in `bindStore` below and nowhere else. If the
 * store's shape changes, exactly one function has to follow it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FighterDefinition } from '../sim';
import { ReplayView } from '../ui/ReplayView';
import { BOUT_COUNT, FORMATS } from '../ui/Controls';
import { ModelNotes } from '../ui/ModelNotes';
import { Dashboard } from '../ui/Dashboard';
import { REPLAY_INDEX } from '../data/replays';
import {
  allFighters, createFighter, deleteFighter, duplicateFighter, getFighter, updateFighter,
  validateFighter, blankFighter, randomFighter, exportRecords, toJson, importAll,
} from './store';
import type { FighterRecord } from './store/types';
import type { FighterStoreApi, ImportOutcome } from './storeApi';
import { FighterDatabase } from './screens/FighterDatabase';
import { FighterCreator } from './screens/FighterCreator';
import { MatchSetup } from './screens/MatchSetup';
import { Tournaments } from './screens/Tournaments';
import { History } from './screens/History';
import { BoutResultScreen } from './screens/BoutResult';
import { bindMatchStore } from './run/matchStore';
import { defaultDraft, newSeed, type MatchDraft } from './model/matchModel';
import type { BoutRunOutcome } from './run/runBout';
import type { BoutRun, SimConfig } from '../sim';
import { Watch } from './screens/Watch';

type TabId =
  | 'replay' | 'dashboard' | 'model' | 'fighters' | 'creator'
  | 'match' | 'watch' | 'result' | 'tournaments' | 'history';
type ThemeChoice = 'system' | 'light' | 'dark';

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'match', label: 'Match', hint: 'Build a bout: mode, fighters, ruleset, arena, settings, seed' },
  { id: 'watch', label: 'Watch', hint: 'Play a bout back, frame by frame' },
  { id: 'result', label: 'Result', hint: 'The last bout: scorecards and the full stat sheet' },
  { id: 'tournaments', label: 'Tournaments', hint: 'Brackets, seeding, carry-over' },
  { id: 'history', label: 'History', hint: 'Past bouts: re-watch, verify, export' },
  { id: 'replay', label: 'Replay', hint: 'Watch one simulated bout in 3D' },
  { id: 'dashboard', label: 'Dashboard', hint: 'Aggregate outcomes across every recorded bout' },
  { id: 'model', label: 'Model', hint: 'Derived attributes and every model parameter' },
  { id: 'fighters', label: 'Fighters', hint: 'The fighter database: search, import, export' },
  { id: 'creator', label: 'Creator', hint: 'Build or edit one fighter, with the derivation shown live' },
];

const THEME_KEY = 'bout-lab.theme';

const DISCLAIMER =
  'This is a modelling toy. Every probability in it is a hand-chosen assumption, ' +
  'not a figure fitted to real fight data — the output describes this model and ' +
  'is not a validated prediction about what would happen between real people.';

function readStoredTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* storage can be unavailable; the default is fine */
  }
  return 'system';
}

/**
 * Map the store module onto the interface the screens consume.
 *
 * This adapter is the seam between the screens and the store. The judgement
 * calls encoded here are (a) an explicit selection exports
 * built-ins too, because the user asked for those specific fighters, and (b) an
 * import writes each definition through `createFighter`, so imported ids go
 * through the same collision handling as anything the user makes.
 */
export function bindStore(): FighterStoreApi {
  return {
    list: () => allFighters(),
    get: (id) => getFighter(id),

    save(def: FighterDefinition): FighterRecord {
      const existing = getFighter(def.id);
      return existing
        ? updateFighter(def.id, def).record
        : createFighter(def).record;
    },

    remove(id: string): void {
      if (!deleteFighter(id)) {
        throw new Error('That fighter could not be deleted. Built-in archetypes are read-only.');
      }
    },

    duplicate(id: string): FighterRecord {
      const outcome = duplicateFighter(id);
      if (!outcome) throw new Error(`No fighter with id ${id}.`);
      return outcome.record;
    },

    validate: (def) => validateFighter(def),
    blank: () => blankFighter(),
    random: (seed) => randomFighter(seed),

    exportJson(ids) {
      const wanted = new Set(ids);
      const records = allFighters().filter((r) => wanted.has(r.definition.id));
      return toJson(exportRecords(records, {}, true));
    },

    importJson(text): ImportOutcome {
      const taken = allFighters().map((r) => r.definition.id);
      const result = importAll(text, { fighterIds: taken });
      let added = 0;
      for (const def of result.fighters) {
        createFighter(def);
        added++;
      }
      return {
        added,
        skipped: result.skipped,
        problems: result.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)),
      };
    },
  };
}

export function App(): JSX.Element {
  // `?watchDemo=1` opens straight onto the Watch screen with the demonstration
  // bout: the QA shortcut every Phase 8 capture script uses.
  const [tab, setTab] = useState<TabId>(() => (
    typeof location !== 'undefined' && new URLSearchParams(location.search).has('watchDemo') ? 'watch' : 'match'
  ));
  const [opponents, setOpponents] = useState(1);
  const [boutIndex, setBoutIndex] = useState(1);
  const [theme, setTheme] = useState<ThemeChoice>(readStoredTheme);

  const store = useMemo(() => bindStore(), []);
  const matchStore = useMemo(() => bindMatchStore(), []);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<{ def: FighterDefinition; fromBuiltIn: boolean } | null>(null);
  const [creatorDirty, setCreatorDirty] = useState(false);

  // Phase 7a state: the match draft, and the last bout that was run. The draft
  // lives here rather than in the screen so a rematch from the result screen
  // can pre-fill it, and so switching tabs never throws away a half-built card.
  const [draft, setDraft] = useState<MatchDraft>(() => defaultDraft(newSeed('bout', Date.now())));
  const [lastRun, setLastRun] = useState<BoutRun | null>(null);
  // What the replay view is showing. It takes a `SimConfig` and rebuilds the
  // frames itself (09 §4.5), so handing a bout over means handing over its
  // config — which is the same object whether the bout came from Match setup,
  // from a tournament, or from a replay file in History.
  const [watching, setWatching] = useState<SimConfig | null>(null);

  const watchRun = useCallback((run: BoutRun) => {
    setWatching(run.config);
    setLastRun(run);
    setTab('watch');
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* non-fatal */
    }
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme((t) => (t === 'system' ? 'dark' : t === 'dark' ? 'light' : 'system'));
  }, []);

  const openBout = useCallback((nextOpponents: number, index: number) => {
    const o = Math.min(5, Math.max(1, Math.round(nextOpponents)));
    setOpponents(o);
    setBoutIndex(Math.min(BOUT_COUNT, Math.max(1, Math.round(index))));
    setTab('replay');
  }, []);

  /**
   * The unsaved-changes guard for in-page navigation. `beforeunload` covers
   * closing the page; leaving the creator tab is script-driven, so it has to be
   * intercepted here — a tab switch that silently discards half an hour of
   * authoring is the single worst thing this screen could do.
   */
  const changeTab = useCallback((next: TabId) => {
    if (next === tab) return;
    if (tab === 'creator' && creatorDirty) {
      if (!window.confirm('This fighter has unsaved changes. Leave the creator and discard them?')) return;
      setCreatorDirty(false);
    }
    setTab(next);
  }, [tab, creatorDirty]);

  const editFighter = useCallback((record: FighterRecord) => {
    setEditing({ def: record.definition, fromBuiltIn: record.builtIn });
    setTab('creator');
  }, []);

  const newFighter = useCallback(() => {
    setEditing({ def: store.blank(), fromBuiltIn: false });
    setTab('creator');
  }, [store]);

  const rollFighter = useCallback(() => {
    // Seeded, not random: nothing in this project may call `Math.random`, and a
    // seed printed in the notes means a generated fighter can be reproduced.
    const seed = `creator.${Date.now().toString(36)}`;
    setEditing({ def: store.random(seed), fromBuiltIn: false });
    setTab('creator');
  }, [store]);

  /** A finished bout: remember it, refresh history, and show the card. */
  const onRan = useCallback((outcome: BoutRunOutcome) => {
    setLastRun(outcome.run);
    setRevision((r) => r + 1);
    setTab('result');
  }, []);

  /** Same fighters and settings, a new seed. */
  const rematch = useCallback((run: BoutRun) => {
    setDraft((d) => ({ ...d, seed: newSeed('bout', Date.now()) }));
    void run;
    setTab('match');
  }, []);

  const exportRun = useCallback((run: BoutRun) => {
    try {
      const entry = matchStore.history().find((e) => {
        const r = e.replay;
        return typeof r === 'object' && r !== null && 'digest' in r && r.digest === run.digest;
      });
      const text = JSON.stringify(entry?.replay ?? run, null, 2);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `bout-${run.digest.slice(0, 12)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* a refused download is not worth blanking the screen over */
    }
  }, [matchStore]);

  const onSaved = useCallback((record: FighterRecord) => {
    setRevision((r) => r + 1);
    setEditing({ def: record.definition, fromBuiltIn: false });
  }, []);

  const replays = useMemo(() => REPLAY_INDEX, []);

  const recordedCount = useMemo(
    () => FORMATS.reduce((sum, n) => sum + (replays[n]?.length ?? 0), 0),
    [replays],
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">Bout Lab</span>
          <span className="brand-sub">
            deterministic bout simulator &middot; seed-replayable &middot;{' '}
            {recordedCount > 0
              ? `${recordedCount.toLocaleString()} recorded bouts`
              : 'bouts recomputed on demand'}
          </span>
        </div>

        <div className="tabs" role="tablist" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              className="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              title={t.hint}
              onClick={() => changeTab(t.id)}
            >
              {t.label}
              {t.id === 'creator' && creatorDirty ? <span aria-hidden="true"> &bull;</span> : null}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="theme-btn"
          onClick={cycleTheme}
          aria-label={`Colour theme: ${theme}. Activate to change.`}
        >
          Theme: {theme}
        </button>
      </header>

      <p className="disclaimer">
        <b>Toy model</b>
        <span>{DISCLAIMER}</span>
      </p>

      <main className="app-main">
        <div
          className="tabpanel tabpanel--scroll"
          role="tabpanel"
          id="panel-match"
          aria-labelledby="tab-match"
          hidden={tab !== 'match'}
        >
          <MatchSetup
            store={store}
            matchStore={matchStore}
            revision={revision}
            draft={draft}
            onDraftChange={setDraft}
            onRan={onRan}
          />
        </div>

        <div
          className="tabpanel"
          role="tabpanel"
          id="panel-watch"
          aria-labelledby="tab-watch"
          hidden={tab !== 'watch'}
        >
          <Watch config={watching} active={tab === 'watch'} />
        </div>

        <div
          className="tabpanel tabpanel--scroll"
          role="tabpanel"
          id="panel-result"
          aria-labelledby="tab-result"
          hidden={tab !== 'result'}
        >
          <BoutResultScreen
            run={lastRun}
            onWatch={watchRun}
            onExport={exportRun}
            onRematch={rematch}
          />
        </div>

        <div
          className="tabpanel tabpanel--scroll"
          role="tabpanel"
          id="panel-tournaments"
          aria-labelledby="tab-tournaments"
          hidden={tab !== 'tournaments'}
        >
          <Tournaments
            store={store}
            matchStore={matchStore}
            revision={revision}
            onChanged={() => setRevision((r) => r + 1)}
            onRan={(outcome) => setLastRun(outcome.run)}
          />
        </div>

        <div
          className="tabpanel tabpanel--scroll"
          role="tabpanel"
          id="panel-history"
          aria-labelledby="tab-history"
          hidden={tab !== 'history'}
        >
          <History
            matchStore={matchStore}
            revision={revision}
            onChanged={() => setRevision((r) => r + 1)}
            onWatch={watchRun}
            onOpenResult={(run) => {
              setLastRun(run);
              setTab('result');
            }}
          />
        </div>

        <div
          className="tabpanel"
          role="tabpanel"
          id="panel-replay"
          aria-labelledby="tab-replay"
          hidden={tab !== 'replay'}
        >
          <ReplayView
            opponents={opponents}
            boutIndex={boutIndex}
            active={tab === 'replay'}
            onChangeOpponents={setOpponents}
            onChangeBout={setBoutIndex}
          />
        </div>

        <div
          className="tabpanel tabpanel--scroll"
          role="tabpanel"
          id="panel-dashboard"
          aria-labelledby="tab-dashboard"
          hidden={tab !== 'dashboard'}
        >
          <Dashboard replays={replays} onOpenBout={openBout} />
        </div>

        <div
          className="tabpanel tabpanel--scroll"
          role="tabpanel"
          id="panel-model"
          aria-labelledby="tab-model"
          hidden={tab !== 'model'}
        >
          <ModelNotes />
        </div>

        <div
          className="tabpanel tabpanel--scroll"
          role="tabpanel"
          id="panel-fighters"
          aria-labelledby="tab-fighters"
          hidden={tab !== 'fighters'}
        >
          <FighterDatabase
            store={store}
            revision={revision}
            onEdit={editFighter}
            onNew={newFighter}
            onRandom={rollFighter}
            onChanged={() => setRevision((r) => r + 1)}
          />
        </div>

        <div
          className="tabpanel tabpanel--scroll"
          role="tabpanel"
          id="panel-creator"
          aria-labelledby="tab-creator"
          hidden={tab !== 'creator'}
        >
          {editing === null ? (
            <div className="creator-blank">
              <p className="empty">
                Nothing open. Pick a fighter from the database, or start a new one.
              </p>
              <div className="fdb-actions">
                <button type="button" className="btn btn--play" onClick={newFighter}>New fighter</button>
                <button type="button" className="btn" onClick={rollFighter}>Random fighter</button>
                <button type="button" className="btn" onClick={() => changeTab('fighters')}>
                  Browse the database
                </button>
              </div>
            </div>
          ) : (
            <FighterCreator
              // Remounting on a different fighter is deliberate: the editor
              // holds a draft, and carrying one fighter's draft into another
              // is how an editor corrupts data.
              key={editing.def.id}
              store={store}
              initial={editing.def}
              fromBuiltIn={editing.fromBuiltIn}
              onSaved={onSaved}
              onCancel={() => {
                setCreatorDirty(false);
                setEditing(null);
                setTab('fighters');
              }}
              onDirtyChange={setCreatorDirty}
            />
          )}
        </div>
      </main>

      <footer className="app-footer">
        Bout Lab simulates a regulated, refereed contest under unified-style rules. Accumulated
        impact is an abstract 0&ndash;100 index whose only role is to trigger an administrative
        stoppage; no injury, medical outcome or lasting harm is modelled or shown. {DISCLAIMER}
      </footer>
    </div>
  );
}
