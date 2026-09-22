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

type TabId = 'replay' | 'dashboard' | 'model' | 'fighters' | 'creator';
type ThemeChoice = 'system' | 'light' | 'dark';

const TABS: { id: TabId; label: string; hint: string }[] = [
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
  const [tab, setTab] = useState<TabId>('replay');
  const [opponents, setOpponents] = useState(1);
  const [boutIndex, setBoutIndex] = useState(1);
  const [theme, setTheme] = useState<ThemeChoice>(readStoredTheme);

  const store = useMemo(() => bindStore(), []);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<{ def: FighterDefinition; fromBuiltIn: boolean } | null>(null);
  const [creatorDirty, setCreatorDirty] = useState(false);

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
