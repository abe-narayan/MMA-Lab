/**
 * APP SHELL.
 *
 * A left navigation rail grouped by task (Simulate / Review / Library /
 * Reference), a top bar that names the current page, a one-line model
 * notice, and one panel per page. Every panel stays mounted once visited, so
 * switching pages never throws away a half-built match card, a running
 * tournament or a batch in progress.
 *
 * The legacy v3 views (Replay, Dashboard and the v3 Model notes) were retired
 * with the v3 engine: Watch replaces the replay view, the Batch screen carries
 * the aggregate analytics, and "About the model" shows the v4 rulebook summary
 * and the live parameter registry (see docs/design/UI_PASS.md).
 *
 * Code splitting (UI pass 2): the shell, Match setup and the simulation load
 * with the page; Watch (and, inside it, the 3D broadcast), Batch, Tournaments,
 * History, the fighter editor and About are separate chunks fetched the first time the
 * page is opened (or prefetched when the pointer or focus reaches its nav
 * item), behind the design system's loading state.
 *
 * This is also the one file that knows the concrete store module. The screens
 * are written against `FighterStoreApi`, so the mapping from that interface
 * onto `src/app/store` lives in `bindStore` below and nowhere else. If the
 * store's shape changes, exactly one function has to follow it.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { FighterDefinition } from '../sim';
import {
  allFighters, createFighter, deleteFighter, duplicateFighter, getFighter, nextFighterId, updateFighter,
  validateFighter, blankFighter, randomFighter, exportRecords, toJson, importAll,
} from './store';
import type { FighterRecord } from './store/types';
import type { FighterStoreApi, ImportOutcome } from './storeApi';
import { FighterDatabase } from './screens/FighterDatabase';
import { MatchSetup } from './screens/MatchSetup';
import { BoutResultScreen } from './screens/BoutResult';
import { bindMatchStore } from './run/matchStore';
import { defaultDraft, newSeed, type MatchDraft } from './model/matchModel';
import type { BoutRunOutcome } from './run/runBout';
import type { BoutRun, SimConfig } from '../sim';
import { devParams } from './devFlags';
import {
  Button, EmptyState, LoadingState, Segmented, ToastProvider, useConfirm,
  IconBatch, IconBook, IconEdit, IconHistory, IconMatch, IconMonitor, IconMoon, IconPlay,
  IconPlus, IconDice, IconResult, IconSidebar, IconSun, IconTrophy, IconUsers,
} from './ui';

// ---- lazily loaded screens ---------------------------------------------------
// One loader per chunk, shared by React.lazy and the nav prefetch (a dynamic
// import is fetched once, whichever asks first).
const LOADERS = {
  watch: () => import('./screens/Watch'),
  batch: () => import('./screens/BatchSim'),
  tournaments: () => import('./screens/Tournaments'),
  creator: () => import('./screens/FighterCreator'),
  model: () => import('./screens/About'),
  history: () => import('./screens/History'),
} as const;
const Watch = lazy(() => LOADERS.watch().then((m) => ({ default: m.Watch })));
const BatchSim = lazy(() => LOADERS.batch().then((m) => ({ default: m.BatchSim })));
const Tournaments = lazy(() => LOADERS.tournaments().then((m) => ({ default: m.Tournaments })));
const FighterCreator = lazy(() => LOADERS.creator().then((m) => ({ default: m.FighterCreator })));
const About = lazy(() => LOADERS.model().then((m) => ({ default: m.About })));
const History = lazy(() => LOADERS.history().then((m) => ({ default: m.History })));

function prefetch(id: string): void {
  const load = (LOADERS as Record<string, (() => Promise<unknown>) | undefined>)[id];
  if (load) void load().catch(() => { /* the lazy boundary reports it when the page opens */ });
}

/** The first bout a new user sees: two contrasting built-in fighters, ready to run. */
// Same weight class and level, striker against grappler: no size or skill
// warning on the first screen, and a fight that shows both games.
const DEFAULT_MATCHUP = ['arch.counter_striker', 'arch.judoka'] as const;

type TabId =
  | 'match' | 'batch' | 'tournaments' | 'watch' | 'result' | 'history'
  | 'fighters' | 'creator' | 'model';
type ThemeChoice = 'system' | 'light' | 'dark';
type NavPref = 'auto' | 'expanded' | 'collapsed';

interface NavItem {
  id: TabId;
  label: string;
  title: string;
  hint: string;
  icon: JSX.Element;
  /**
   * The page draws its own title (a page header with an h1). The top bar then
   * shows only the model notice, so the name is not printed twice; pages
   * without one (Watch, the editor) get their name in the top bar.
   */
  ownHeader?: boolean;
}

const NAV: readonly { group: string; items: readonly NavItem[] }[] = [
  {
    group: 'Simulate',
    items: [
      { id: 'match', label: 'Match setup', title: 'Match setup', hint: 'Pick fighters and rules, run one bout', icon: <IconMatch />, ownHeader: true },
      { id: 'batch', label: 'Batch simulation', title: 'Batch simulation', hint: 'Run one matchup thousands of times and read the odds', icon: <IconBatch />, ownHeader: true },
      { id: 'tournaments', label: 'Tournaments', title: 'Tournaments', hint: 'Run a bracket of fighters, match by match', icon: <IconTrophy />, ownHeader: true },
    ],
  },
  {
    group: 'Review',
    items: [
      { id: 'watch', label: 'Watch', title: 'Watch', hint: 'Play a bout back in 3D or 2D, frame by frame', icon: <IconPlay /> },
      { id: 'result', label: 'Result', title: 'Bout result', hint: 'The last bout: scorecards and the full stat sheet', icon: <IconResult />, ownHeader: true },
      { id: 'history', label: 'History', title: 'History', hint: 'Past bouts: re-watch, verify, export', icon: <IconHistory />, ownHeader: true },
    ],
  },
  {
    group: 'Library',
    items: [
      { id: 'fighters', label: 'Fighters', title: 'Fighter database', hint: 'Browse, search, import and export fighters', icon: <IconUsers />, ownHeader: true },
      { id: 'creator', label: 'Fighter editor', title: 'Fighter editor', hint: 'Build or edit one fighter, with the derivation shown live', icon: <IconEdit /> },
    ],
  },
  {
    group: 'Reference',
    items: [
      { id: 'model', label: 'About the model', title: 'About the model', hint: 'What the simulation models, its calibration targets and every parameter', icon: <IconBook />, ownHeader: true },
    ],
  },
];

const ALL_ITEMS: readonly NavItem[] = NAV.flatMap((g) => g.items);

const THEME_KEY = 'bout-lab.theme';
const NAV_KEY = 'bout-lab.nav';

export const DISCLAIMER =
  'This is a modelling toy. Every probability in it is a hand-chosen or literature-derived assumption, '
  + 'not a validated prediction: the output describes this model, not what would happen between real people.';

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null && (allowed as readonly string[]).includes(raw)) return raw as T;
  } catch {
    /* storage can be unavailable; the default is fine */
  }
  return fallback;
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* non-fatal */
  }
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
    // Each blank gets an id no stored fighter has (fighter.new, then
    // fighter.new.2, …), so saving a second new fighter creates it rather than
    // overwriting the first through `updateFighter`.
    blank: () => blankFighter(nextFighterId(allFighters().map((r) => r.definition.id), 'new')),
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

/** The fighter editor's React key: the fighter plus the editing session. */
export function editorKey(fighterId: string, session: number): string {
  return `${fighterId}#${session}`;
}

export function App(): JSX.Element {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell(): JSX.Element {
  // `?watchDemo=1` opens straight onto the Watch screen with the demonstration
  // bout: the QA shortcut every Phase 8 capture script uses. Development or
  // `?capture=1` only (src/app/devFlags.ts).
  const [tab, setTab] = useState<TabId>(() => (
    devParams().has('watchDemo') ? 'watch' : 'match'
  ));
  // Panels mount on first visit and then stay mounted (state survives).
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set([tab]));
  const [theme, setTheme] = useState<ThemeChoice>(() => readStored(THEME_KEY, ['system', 'light', 'dark'] as const, 'system'));
  const [navPref, setNavPref] = useState<NavPref>(() => readStored(NAV_KEY, ['auto', 'expanded', 'collapsed'] as const, 'auto'));
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1100);
  const [confirm, confirmUi] = useConfirm();

  const store = useMemo(() => bindStore(), []);
  const matchStore = useMemo(() => bindMatchStore(), []);

  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<{ def: FighterDefinition; fromBuiltIn: boolean } | null>(null);
  const [creatorDirty, setCreatorDirty] = useState(false);
  // Part of the editor's key: bumping it remounts the editor on its initial
  // fighter, which is how "Discard and leave" really discards the draft (the
  // panel itself stays mounted) and restarts dirty tracking.
  const [editorSession, setEditorSession] = useState(0);

  // The match draft lives here rather than in the screen so a rematch from
  // the result screen can pre-fill it, and so switching pages never throws
  // away a half-built card.
  // A new user lands on a runnable bout: two built-in fighters are
  // pre-picked (when the database still has them), so "Run bout" works first.
  const [draft, setDraft] = useState<MatchDraft>(() => {
    const d = defaultDraft(newSeed('bout', Date.now()));
    let ids: Set<string>;
    try { ids = new Set(store.list().map((r) => r.definition.id)); } catch { return d; }
    return DEFAULT_MATCHUP.every((id) => ids.has(id)) ? { ...d, slots: [...DEFAULT_MATCHUP] } : d;
  });
  const [lastRun, setLastRun] = useState<BoutRun | null>(null);
  // What the replay view is showing. It takes a `SimConfig` and rebuilds the
  // frames itself (09 §4.5), so handing a bout over means handing over its
  // config — the same object whether the bout came from Match setup, a
  // tournament, or a replay file in History.
  const [watching, setWatching] = useState<SimConfig | null>(null);

  useEffect(() => {
    const onResize = (): void => setNarrow(window.innerWidth < 1100);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    writeStored(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => { writeStored(NAV_KEY, navPref); }, [navPref]);

  // "auto" collapses the rail where width matters most: narrow windows and
  // the Watch screen, whose 3D stage wants every pixel.
  const collapsed = navPref === 'collapsed' || (navPref === 'auto' && (narrow || tab === 'watch'));

  const go = useCallback((next: TabId) => {
    setTab(next);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
  }, []);

  /**
   * The unsaved-changes guard for in-page navigation. `beforeunload` covers
   * closing the page; leaving the editor is script-driven, so it has to be
   * intercepted here — a page switch that silently discards half an hour of
   * authoring is the single worst thing this app could do.
   */
  const changeTab = useCallback(async (next: TabId) => {
    if (next === tab) return;
    if (tab === 'creator' && creatorDirty) {
      const ok = await confirm({
        title: 'Leave the editor?',
        body: 'This fighter has unsaved changes. Leaving now discards them.',
        confirmLabel: 'Discard and leave',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      if (!ok) return;
      setCreatorDirty(false);
      setEditorSession((n) => n + 1);
    }
    // Opening Watch from the navigation shows the latest bout (run, opened
    // from History, or a tournament match), not the demonstration bout.
    if (next === 'watch' && lastRun && watching !== lastRun.config) setWatching(lastRun.config);
    go(next);
  }, [tab, creatorDirty, confirm, go, lastRun, watching]);

  const watchRun = useCallback((run: BoutRun) => {
    setWatching(run.config);
    setLastRun(run);
    go('watch');
  }, [go]);

  const editFighter = useCallback((record: FighterRecord) => {
    setEditing({ def: record.definition, fromBuiltIn: record.builtIn });
    setEditorSession((n) => n + 1);
    go('creator');
  }, [go]);

  const newFighter = useCallback(() => {
    setEditing({ def: store.blank(), fromBuiltIn: false });
    setEditorSession((n) => n + 1);
    go('creator');
  }, [store, go]);

  const rollFighter = useCallback(() => {
    // Seeded, not random: nothing in this project may call `Math.random`, and a
    // seed printed in the notes means a generated fighter can be reproduced.
    const seed = `creator.${Date.now().toString(36)}`;
    setEditing({ def: store.random(seed), fromBuiltIn: false });
    setEditorSession((n) => n + 1);
    go('creator');
  }, [store, go]);

  /** A finished bout: remember it, refresh history, and show the card. */
  const onRan = useCallback((outcome: BoutRunOutcome) => {
    setLastRun(outcome.run);
    setRevision((r) => r + 1);
    go('result');
  }, [go]);

  /** Same fighters and settings, a new seed. */
  const rematch = useCallback((run: BoutRun) => {
    setDraft((d) => ({ ...d, seed: newSeed('bout', Date.now()) }));
    void run;
    go('match');
  }, [go]);

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

  const current = ALL_ITEMS.find((i) => i.id === tab) ?? ALL_ITEMS[0];
  const fighterCount = useMemo(() => {
    try { return store.list().length; } catch { return 0; }
  }, [store, revision]);

  const panel = (id: TabId, scroll: boolean, body: () => JSX.Element): JSX.Element => (
    <div
      className={`tabpanel${scroll ? ' tabpanel--scroll' : ''}`}
      role="region"
      id={`panel-${id}`}
      aria-label={ALL_ITEMS.find((i) => i.id === id)?.title}
      hidden={tab !== id}
    >
      {visited.has(id) ? (
        <Suspense fallback={<LoadingState label={`Loading ${ALL_ITEMS.find((i) => i.id === id)?.title ?? 'page'}…`} lines={3} />}>
          {body()}
        </Suspense>
      ) : null}
    </div>
  );

  return (
    <div className="shell" data-collapsed={collapsed}>
      <nav className="nav" aria-label="Main">
        <div className="nav-brand">
          <span className="nav-logo" aria-hidden="true">BL</span>
          <span className="nav-wordmark">
            <b>Bout Lab</b>
            <span>Deterministic bout simulator</span>
          </span>
        </div>
        <div className="nav-scroll">
          {NAV.map((g) => (
            <div className="nav-group" key={g.group} role="group" aria-label={g.group}>
              <div className="nav-group-label" aria-hidden="true">{g.group}</div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  id={`tab-${it.id}`}
                  className="nav-item"
                  aria-current={tab === it.id ? 'page' : undefined}
                  aria-label={collapsed ? it.label : undefined}
                  title={collapsed ? `${it.label} — ${it.hint}` : it.hint}
                  onClick={() => { void changeTab(it.id); }}
                  onPointerEnter={() => prefetch(it.id)}
                  onFocus={() => prefetch(it.id)}
                >
                  <span className="nav-icon">{it.icon}</span>
                  <span className="nav-label">{it.label}</span>
                  {it.id === 'creator' && creatorDirty ? <span className="nav-dot" title="Unsaved changes" /> : null}
                  {it.id === 'fighters' && fighterCount > 0 ? <span className="nav-count">{fighterCount}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="nav-foot">
          <button
            type="button"
            className="nav-item"
            aria-pressed={!collapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={() => setNavPref(collapsed ? 'expanded' : 'collapsed')}
          >
            <span className="nav-icon"><IconSidebar /></span>
            <span className="nav-label">{collapsed ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          {current.ownHeader ? null : (
            <div className="topbar-title">
              <b>{current.title}</b>
              <span>{current.hint}</span>
            </div>
          )}
          <p className="topbar-notice">
            <b>Toy model</b>
            <span title={DISCLAIMER}>Results describe this model, not what would happen between real fighters.</span>
            {tab !== 'model' ? (
              <Button size="sm" variant="ghost" onClick={() => { void changeTab('model'); }}>How it works</Button>
            ) : null}
          </p>
          <div className="topbar-actions">
            <Segmented<ThemeChoice>
              label="Colour theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'system', label: <span className="nav-icon" style={{ width: 16, height: 16 }}><IconMonitor width={15} height={15} /><span className="visually-hidden">System</span></span>, title: 'Follow the system theme' },
                { value: 'light', label: <span className="nav-icon" style={{ width: 16, height: 16 }}><IconSun width={15} height={15} /><span className="visually-hidden">Light</span></span>, title: 'Light theme' },
                { value: 'dark', label: <span className="nav-icon" style={{ width: 16, height: 16 }}><IconMoon width={15} height={15} /><span className="visually-hidden">Dark</span></span>, title: 'Dark theme' },
              ]}
            />
          </div>
        </header>

        <main className="app-main">
          {panel('match', true, () => (
            <div className="page">
              <MatchSetup
                store={store}
                matchStore={matchStore}
                revision={revision}
                draft={draft}
                onDraftChange={setDraft}
                onRan={onRan}
              />
            </div>
          ))}

          {panel('batch', true, () => (
            <div className="page page--wide">
              <BatchSim store={store} revision={revision} />
            </div>
          ))}

          {panel('watch', false, () => <Watch config={watching} active={tab === 'watch'} />)}

          {panel('result', true, () => (
            <div className="page">
              <BoutResultScreen
                run={lastRun}
                onWatch={watchRun}
                onExport={exportRun}
                onRematch={rematch}
              />
            </div>
          ))}

          {panel('tournaments', true, () => (
            <div className="page page--wide">
              <Tournaments
                store={store}
                matchStore={matchStore}
                revision={revision}
                onChanged={() => setRevision((r) => r + 1)}
                onRan={(outcome) => setLastRun(outcome.run)}
              />
            </div>
          ))}

          {panel('history', true, () => (
            <div className="page">
              <History
                matchStore={matchStore}
                revision={revision}
                onChanged={() => setRevision((r) => r + 1)}
                onWatch={watchRun}
                onOpenResult={(run) => {
                  setLastRun(run);
                  go('result');
                }}
              />
            </div>
          ))}

          {panel('fighters', true, () => (
            <div className="page page--wide">
              <FighterDatabase
                store={store}
                revision={revision}
                onEdit={editFighter}
                onNew={newFighter}
                onRandom={rollFighter}
                onChanged={() => setRevision((r) => r + 1)}
              />
            </div>
          ))}

          {panel('creator', true, () => (
            <div className="page page--wide">
              {editing === null ? (
                <EmptyState
                  icon={<IconEdit />}
                  title="No fighter open"
                  actions={(
                    <>
                      <Button variant="primary" icon={<IconPlus />} onClick={newFighter}>New fighter</Button>
                      <Button icon={<IconDice />} onClick={rollFighter}>Random fighter</Button>
                      <Button icon={<IconUsers />} onClick={() => { void changeTab('fighters'); }}>Browse the database</Button>
                    </>
                  )}
                >
                  Pick a fighter from the database to edit it, start from a blank fighter or a preset
                  archetype, or roll a seeded random one.
                </EmptyState>
              ) : (
                <FighterCreator
                  // Remounting on a different fighter is deliberate: the editor
                  // holds a draft, and carrying one fighter's draft into another
                  // is how an editor corrupts data.
                  key={editorKey(editing.def.id, editorSession)}
                  store={store}
                  initial={editing.def}
                  fromBuiltIn={editing.fromBuiltIn}
                  revision={revision}
                  onSaved={onSaved}
                  onCancel={() => {
                    setCreatorDirty(false);
                    setEditing(null);
                    go('fighters');
                  }}
                  onDirtyChange={setCreatorDirty}
                  active={tab === 'creator'}
                />
              )}
            </div>
          ))}

          {panel('model', true, () => (
            <div className="page">
              <About />
            </div>
          ))}
        </main>
      </div>
      {confirmUi}
    </div>
  );
}
