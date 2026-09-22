/**
 * APP SHELL
 *
 * Three tabs over one shared selection (format + bout number): the 3D replay,
 * the aggregate dashboard, and the model notes. The dashboard can hand a bout
 * back to the replay tab through `onOpenBout`, so the two views stay pinned to
 * the same contest.
 *
 * Theme handling follows the artifact convention: the stylesheet declares the
 * complete dark palette on :root, redefines the tokens for system-light and for
 * an explicit light stamp, and this component only ever sets or clears the
 * `data-theme` attribute.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReplayView } from './ReplayView';
import { BOUT_COUNT, FORMATS } from './Controls';
import { ModelNotes } from './ModelNotes';
import { Dashboard } from './Dashboard';
import { REPLAY_INDEX } from '../data/replays';

type TabId = 'replay' | 'dashboard' | 'model';
type ThemeChoice = 'system' | 'light' | 'dark';

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'replay', label: 'Replay', hint: 'Watch one simulated bout in 3D' },
  { id: 'dashboard', label: 'Dashboard', hint: 'Aggregate outcomes across every recorded bout' },
  { id: 'model', label: 'Model', hint: 'Derived attributes and every model parameter' },
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

export function App() {
  const [tab, setTab] = useState<TabId>('replay');
  const [opponents, setOpponents] = useState(1);
  const [boutIndex, setBoutIndex] = useState(1);
  const [theme, setTheme] = useState<ThemeChoice>(readStoredTheme);

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
              onClick={() => setTab(t.id)}
            >
              {t.label}
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
      </main>

      <footer className="app-footer">
        Bout Lab simulates a regulated, refereed contest under unified-style rules. Accumulated
        impact is an abstract 0&ndash;100 index whose only role is to trigger an administrative
        stoppage; no injury, medical outcome or lasting harm is modelled or shown. {DISCLAIMER}
      </footer>
    </div>
  );
}
