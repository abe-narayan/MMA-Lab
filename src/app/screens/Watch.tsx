/**
 * WATCH — the spectator surface (docs/design/09 §4.4, §4.5, §5; layout and
 * replay pass: docs/design/WATCH_REPLAY_PASS.md).
 *
 * Hierarchy, top to bottom: the fight picture (3D broadcast, or the 2D
 * board), the transport right under it (play/pause, frame step, speed,
 * camera, the scrubber with highlight markers, round and time), the fighters
 * (names, records, gas tank and damage, strikes, the round clock), then the
 * replay row (instant replays, loop, save/open/library). Analytics — stats
 * and scorecards at the playhead, commentary, the event log, the game plan,
 * debug — are an optional side panel, closed by default (`A`).
 *
 * Keyboard (`?` shows them): Space/K play-pause, ←/→ frame step (Shift: 1 s),
 * J/L slower/faster, [ ] events, , . highlights, Home/End, 1-9 cameras, R
 * instant replay, F fullscreen, A analytics, D debug.
 *
 * Rendering: the `BoutPlayer` is the single source of truth for the
 * playhead. One rAF loop advances it and signals the change
 * (`PlayheadSignal`); each panel subscribes at the rate it needs
 * (`usePlayhead`), the 3D view reads the player from its own loop, so the
 * screen itself re-renders only when play state, speed, the replay on air or
 * a setting changes — not per tick, never per display frame.
 *
 * Determinism: nothing here writes to the bout. The transport, the sequencer
 * and every panel only read the recorded frames and events (asserted in
 * tests/replay.polish.test.ts against the run's digest).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS, ARCHETYPES, configFromReplay, resolveArena, resolveRuleset,
  type SimConfig,
} from '../../sim';
import { BoutPlayer, TICK_SECONDS, stepSpeed } from '../replay/player';
import type { WatchBout } from '../replay/bout';
import { cornerOf, roundBaselines } from '../replay/viewModel';
import { Arena3D } from '../components/Arena3D';
import type { QualityLevel } from '../../presentation/contract';
import { buildBoutPresentation } from '../../presentation/stage/bout';
import { ReplaySequencer, planReplays, type ReplayPlan } from '../../presentation/camera';
import { makeBroadcastBout } from '../components/broadcast';
import { EventIndex, advanceBroadcast, lastSecondsReplayPlan, replayKey } from '../replay/broadcast';
import { gpuLikelyAvailable, isQualityLevel, QUALITY_LEVELS, QUALITY_PRESETS } from '../../presentation/stage/index';
import { initialQuality, readQualityChoice, writeQualityChoice } from '../../presentation/stage/profiles';
import { PlayheadSignal } from '../replay/playhead';
import { timelineMarkers, adjacentMarker, type TimelineMarker } from '../replay/markers';
import { shortcutFor, type WatchAction } from '../replay/shortcuts';
import { replayLibrary, type ReplayMeta } from '../replay/library';
import {
  encodePortable, openReplay, replayFileFor, replayFileName, saveToLibrary, type Verification,
} from '../replay/saved';
import { runBout } from '../run/runBout';
import { loadWatchBoutAsync, type WatchLoadProgress } from '../run/watchLoad';
import { WatchProfiler } from '../components/watch/profile';
import { usePlayhead } from '../components/watch/usePlayhead';
import { TransportBar } from '../components/watch/TransportBar';
import { FighterBar } from '../components/watch/FighterBar';
import { ReplayBar } from '../components/watch/ReplayBar';
import { AnalyticsPanel, type AnalyticsTab } from '../components/watch/AnalyticsPanel';
import { HelpOverlay } from '../components/watch/HelpOverlay';
import { LibraryDialog, formatBytes } from '../components/watch/LibraryDialog';
import { Board2D, LiveOverlay } from '../components/watch/Live';
import { roundClockLabel } from '../components/watch/Scrubber';
import { CAMERA_SLOTS, cameraById, cameraBySlot, cameraFromMode } from '../components/watch/cameras';
import { IconGear } from '../components/watch/icons';
import { Button, ErrorState, useToast } from '../ui';
import '../watch.css';

// ---------------------------------------------------------------------------
// Preferences and QA switches
// ---------------------------------------------------------------------------

interface ViewPrefs {
  view: '3d' | '2d' | null;
  quality: QualityLevel | null;
  scale: number | null;
  analytics: boolean;
  tab: AnalyticsTab;
}

const VIEW_PREFS_KEY = 'boutlab.watch.view.v1';
const TABS: readonly AnalyticsTab[] = ['stats', 'cards', 'commentary', 'events', 'plan', 'debug'];

/** The viewer's saved view, quality and panel choices, if any. Never throws. */
function readViewPrefs(): ViewPrefs {
  const none: ViewPrefs = { view: null, quality: null, scale: null, analytics: false, tab: 'stats' };
  try {
    const raw = window.localStorage.getItem(VIEW_PREFS_KEY);
    if (!raw) return none;
    const v = JSON.parse(raw) as Partial<ViewPrefs>;
    return {
      view: v.view === '3d' || v.view === '2d' ? v.view : null,
      quality: isQualityLevel(v.quality) ? v.quality : null,
      scale: typeof v.scale === 'number' && Number.isFinite(v.scale) ? v.scale : null,
      analytics: v.analytics === true,
      tab: TABS.includes(v.tab as AnalyticsTab) ? (v.tab as AnalyticsTab) : 'stats',
    };
  } catch {
    return none;
  }
}

function writeViewPrefs(p: ViewPrefs): void {
  try {
    window.localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(p));
  } catch {
    // Private mode or storage full: the choice just is not remembered.
  }
}

/**
 * QA overrides from the page URL, for capture scripts: `?view=3d|2d`,
 * `?quality=low|medium|high|ultra`, `?scale=0.7`, `?cam=<camera id or mode>`,
 * `?seek=<tick>`, `?play=1`, `?demo=<seed>[:<archetype index A>:<index B>]`,
 * `?analytics=1`. Applied once and never persisted.
 */
function urlOverrides(): {
  view?: '3d' | '2d'; quality?: QualityLevel; scale?: number; cam?: string; seek?: number; play?: boolean;
  demo?: { seed: string; a: number; b: number }; analytics?: boolean;
} {
  if (typeof location === 'undefined') return {};
  const q = new URLSearchParams(location.search);
  const out: ReturnType<typeof urlOverrides> = {};
  const v = q.get('view');
  if (v === '3d' || v === '2d') out.view = v;
  const ql = q.get('quality');
  if (isQualityLevel(ql)) out.quality = ql;
  const sc = Number(q.get('scale'));
  if (q.has('scale') && Number.isFinite(sc)) out.scale = sc;
  const cam = q.get('cam');
  const camSlot = cam ? cameraFromMode(cam) : null;
  if (camSlot) out.cam = camSlot.id;
  const seek = Number(q.get('seek'));
  if (q.has('seek') && Number.isFinite(seek)) out.seek = seek;
  if (q.get('play') === '1') out.play = true;
  if (q.has('analytics')) out.analytics = q.get('analytics') === '1';
  const demo = q.get('demo');
  if (demo) {
    const [seed, a, b] = demo.split(':');
    out.demo = { seed: seed || 'watch-demo', a: Number(a) || 0, b: b === undefined ? 1 : Number(b) || 0 };
  }
  return out;
}

/** A bout to show when the screen is opened without one — a demonstration. */
export function demoConfig(seed = 'watch-demo', a = 0, b = 1): SimConfig {
  const list = Object.values(ARCHETYPES);
  return {
    seed,
    mode: '1v1',
    fighters: [list[a] ?? list[0], list[b] ?? list[1]],
    teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r',
    arena: 'octagon_30',
    settings: DEFAULT_SETTINGS,
  };
}

export interface WatchProps {
  /** The bout to watch. `null` opens the demonstration bout. */
  config?: SimConfig | null;
  /** A bout already loaded elsewhere; skips the rebuild. */
  bout?: WatchBout | null;
  /** False while the tab is hidden: the animation loop stops. */
  active?: boolean;
}

const NO_PLANS: readonly ReplayPlan[] = [];

type VerificationState = { kind: Verification | 'checking'; message: string } | null;

function saveBlob(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function Watch(props: WatchProps): JSX.Element {
  const active = props.active !== false;
  const config = props.config ?? null;
  const toast = useToast();

  const [bout, setBout] = useState<WatchBout | null>(props.bout ?? null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationState>(null);

  // ---- view and panels ------------------------------------------------------
  const [prefs] = useState(readViewPrefs);
  const [qa] = useState(urlOverrides);
  const [view, setView] = useState<'3d' | '2d'>(() => qa.view ?? prefs.view ?? (gpuLikelyAvailable() ? '3d' : '2d'));
  // The preset: a URL override, else the viewer's explicit choice, else the
  // machine's recommendation once the renderer can be probed (Medium until then).
  const [quality, setQuality] = useState<QualityLevel>(() => qa.quality ?? initialQuality(readQualityChoice(), null));
  const qualityChosenRef = useRef(qa.quality !== undefined || readQualityChoice() !== null);
  const [renderScale, setRenderScale] = useState<number | null>(qa.scale ?? prefs.scale);
  const [cameraId, setCameraId] = useState<string>(qa.cam ?? 'auto');
  const [followId, setFollowId] = useState(0);
  const [debug, setDebug] = useState(false);
  const [analytics, setAnalytics] = useState<boolean>(qa.analytics ?? prefs.analytics);
  const [tab, setTab] = useState<AnalyticsTab>(prefs.tab);
  const [helpOpen, setHelpOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice3d, setNotice3d] = useState<string | null>(null);
  const [backend3d, setBackend3d] = useState<string | null>(null);
  const [cameraToast, setCameraToast] = useState<{ n: number; text: string } | null>(null);
  const [loopOn, setLoopOn] = useState(false);
  const [loopFrom, setLoopFrom] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedDigest, setSavedDigest] = useState<string | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  // Bumped on every jump of the playhead that is not plain playback (seeks,
  // replay starts/angle changes/returns), so the 3D view snaps its smoothing
  // filters and drops temporal history. A ref, read by the 3D view in the same
  // instant as the frame, so one seek is exactly one discontinuity frame.
  const seekRef = useRef(0);
  const pendingPlayRef = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const signal = useMemo(() => new PlayheadSignal(), []);
  const library = useMemo(() => replayLibrary(), []);

  useEffect(() => {
    writeViewPrefs({ view, quality: null, scale: renderScale, analytics, tab });
  }, [view, quality, renderScale, analytics, tab]);

  // ---- loading -----------------------------------------------------------
  /** "Simulating… round 2 · 1:23 of fight time" while the worker runs. */
  const progressLabel = useCallback((what: string) => (p: WatchLoadProgress) => {
    setLoading(`${what} Round ${p.round} · ${Math.floor(p.tick / 600)}:${String(Math.floor((p.tick / 10) % 60)).padStart(2, '0')} simulated`);
  }, []);

  /** Build a bout in the worker (the page stays live and shows progress). */
  const rebuild = useCallback((what: string, target: SimConfig) => {
    setLoading(what);
    setError(null);
    const job = loadWatchBoutAsync(target, progressLabel(what));
    let live = true;
    job.promise.then((b) => {
      if (live) setBout(b);
    }, (err: unknown) => {
      if (live) setError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (live) setLoading(null);
    });
    return () => {
      live = false;
      job.cancel();
    };
  }, [progressLabel]);

  useEffect(() => {
    if (props.bout) {
      setBout(props.bout);
      return undefined;
    }
    // Rebuilding a bout with every frame kept is seconds of synchronous work.
    // The shell keeps this screen mounted behind a hidden tab, so nothing is
    // simulated until somebody actually opens it.
    if (!active && !bout) return undefined;
    const target = config ?? (qa.demo ? demoConfig(qa.demo.seed, qa.demo.a, qa.demo.b) : demoConfig());
    setVerification(null);
    return rebuild('Rebuilding the bout from its seed…', target);
    // `bout` is read as a latch, not a trigger, so it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bout, config, active]);

  // ---- transport ------------------------------------------------------------
  /** Built during render, not in an effect (else missing on the first render with the bout). */
  const player = useMemo(() => (bout ? new BoutPlayer({ frames: bout.run.frames, events: bout.run.events }) : null), [bout]);
  const playerRef = useRef<BoutPlayer | null>(null);
  playerRef.current = player;

  // The instant-replay schedule (camera module) and the per-frame event window.
  const sequencer = useMemo(
    () => (bout ? new ReplaySequencer(planReplays(bout.run.events, bout.run.frames)) : null),
    [bout],
  );
  const seqRef = useRef<ReplaySequencer | null>(null);
  seqRef.current = sequencer;
  if (sequencer) sequencer.auto = view === '3d';
  const eventIndex = useMemo(() => (bout ? new EventIndex(bout.run.events) : null), [bout]);
  const eventIndexRef = useRef<EventIndex | null>(null);
  eventIndexRef.current = eventIndex;

  // The screen re-renders only when one of these changes (not with the clock).
  usePlayhead(signal, () => {
    const p = playerRef.current;
    const s = seqRef.current;
    if (!p) return '';
    return `${p.playing ? 1 : 0}|${p.speed}|${replayKey(s?.state)}|${p.inInstantReplay ? 1 : 0}`;
  }, Infinity);
  const playing = player?.playing ?? false;
  const speed = player?.speed ?? 1;
  const replayState = sequencer?.state ?? null;
  const replayTitle = replayState
    ? `${replayState.plan.id.startsWith('manual-') ? replayState.plan.label : `${replayState.plan.title} · ${replayState.plan.label}`} · angle ${replayState.segmentIndex + 1}/${replayState.plan.segments.length} · ${speed}×`
    : player?.inInstantReplay ? `${player.instantReplay?.label ?? 'Replay'} · ${speed}×` : null;

  useEffect(() => {
    if (!player) return;
    setLoopOn(false);
    setLoopFrom(null);
    if (qa.seek !== undefined) {
      player.seekTick(qa.seek);
      seqRef.current?.reset(player.tick);
      seekRef.current++;
    }
    if (qa.play) {
      // In 3D, start once the broadcast is on screen (see `onLive`), not
      // while the shaders are still compiling behind the loading card.
      if (viewRef.current === '3d') pendingPlayRef.current = true;
      else player.play();
    }
    signal.notify();
    // `qa` is read once, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  // ---- the clock ------------------------------------------------------------
  // One loop while the screen is visible: advance the transport when playing;
  // when paused at the end, let a due finish replay wait out the live
  // post-fight picture (`ReplaySequencer.holding`); signal the panels only
  // when something changed (in 2D every display frame: the board interpolates).
  useEffect(() => {
    if (!player || !active) return undefined;
    let raf = 0;
    let last = performance.now();
    const step = (now: number): void => {
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      const seq = seqRef.current;
      if (player.playing) {
        const before = player.frame;
        const { jumped } = advanceBroadcast(player, seq, dt);
        if (jumped) seekRef.current++;
        if (player.frame !== before || jumped || !player.playing || viewRef.current === '2d') signal.notify();
      } else if (seq?.holding) {
        seq.update(player, dt);
        if (seq.state) {
          seekRef.current++;
          signal.notify();
        }
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [player, active, signal]);

  const getPlayhead = useCallback(() => {
    const p = playerRef.current;
    const frame = p?.current ?? null;
    const next = p?.next ?? null;
    const state = seqRef.current?.state ?? null;
    return {
      frame,
      next,
      alpha: p?.alpha ?? 0,
      replay: !!state,
      playbackRate: p?.speed ?? 1,
      // Two seconds back through the next tick: strikes resolving before the
      // next frame are already known, so misses and blocks aim correctly.
      events: frame && eventIndexRef.current ? eventIndexRef.current.forFrame(frame, next) : [],
      replayState: state,
      seekVersion: seekRef.current,
    };
  }, []);

  /**
   * Run a transport action. `seek` actions (scrub, step, jump) first end any
   * replay on air, and re-arm the replay schedule from the new playhead.
   */
  const apply = useCallback((fn: (p: BoutPlayer, seq: ReplaySequencer | null) => void, opts: { seek?: boolean } = {}) => {
    const p = playerRef.current;
    if (!p) return;
    const seq = seqRef.current;
    const before = p.frame;
    const replayBefore = seq?.state ?? null;
    if (opts.seek && seq?.state) seq.stop(p);
    fn(p, seq);
    if (opts.seek) seq?.reset(p.tick);
    if (p.frame !== before || (seq?.state ?? null) !== replayBefore) seekRef.current++;
    signal.notify();
  }, [signal]);

  const seekToTick = useCallback((t: number) => apply((p) => {
    p.pause();
    p.seekTick(t);
  }, { seek: true }), [apply]);
  const seekFrame = useCallback((f: number) => apply((p) => {
    p.pause();
    p.seekFrame(f);
  }, { seek: true }), [apply]);
  const toggle = useCallback(() => apply((p) => p.toggle()), [apply]);
  const restart = useCallback(() => apply((p) => p.restart(), { seek: true }), [apply]);
  const stepFrames = useCallback((n: number) => apply((p) => p.stepBy(n), { seek: true }), [apply]);
  const setSpeed = useCallback((s: number) => apply((p) => p.setSpeed(s)), [apply]);

  /** Every replay goes through the sequencer: slow motion, the REPLAY bug, the replay camera. */
  const playPlan = useCallback((plan: ReplayPlan) => apply((p, seq) => {
    seq?.play(plan, p);
  }), [apply]);
  /** R: replay the last seconds, the camera framing the moment that mattered in them. */
  const replayLast = useCallback((seconds = 8) => apply((p, seq) => {
    const tick = p.tick;
    const from = Math.max(0, tick - Math.round(seconds / TICK_SECONDS));
    if (seq) {
      seq.play(lastSecondsReplayPlan(from, tick, p.events, (t) => p.frames[p.indexForTick(t)]), p);
    } else {
      p.startInstantReplay({ fromTick: from, toTick: tick, speed: 0.3, label: `Last ${seconds}s`, eventIndex: -1 });
    }
  }), [apply]);
  const backToLive = useCallback(() => apply((p, seq) => {
    if (seq?.state) seq.stop(p);
    else p.stopInstantReplay();
  }), [apply]);

  // ---- derived, per bout ------------------------------------------------------
  const teamOf = bout?.config.teams.teamOf;
  const arena = useMemo(() => resolveArena(bout?.config.arena ?? 'octagon_30'), [bout?.config.arena]);
  const boutPresentation = useMemo(
    () => (bout ? buildBoutPresentation({ config: bout.config, fighters: bout.fighters, runtimes: bout.runtimes }) : null),
    [bout],
  );
  const rounds = useMemo(() => {
    if (!bout) return 3;
    const rs = resolveRuleset(bout.config.ruleset);
    return bout.config.settings.rounds ?? rs.rounds.count;
  }, [bout]);
  const roundStarts = useMemo(() => {
    const list: { round: number; tick: number }[] = [];
    for (const e of bout?.run.events ?? []) {
      if (e.kind === 'roundStart' && !list.some((r) => r.round === e.round)) list.push({ round: e.round, tick: e.tick });
    }
    return list;
  }, [bout]);
  const roundStartTick = useCallback((at: number): number => {
    let best = 0;
    for (const r of roundStarts) if (r.tick <= at) best = r.tick;
    return best;
  }, [roundStarts]);
  const roundSeconds = useMemo(() => {
    if (!bout) return 300;
    return bout.config.settings.roundSeconds ?? resolveRuleset(bout.config.ruleset).rounds.lengthS;
  }, [bout]);
  const label = useMemo(() => roundClockLabel(roundStarts, TICK_SECONDS, roundSeconds), [roundStarts, roundSeconds]);
  const markers = useMemo(
    () => (player && bout ? timelineMarkers(bout.run.events, (t) => player.indexForTick(t), player.total) : []),
    [player, bout],
  );
  const roundMarks = useMemo(() => {
    if (!player) return [];
    const span = Math.max(1, player.total - 1);
    return roundStarts.map((r) => ({ ...r, at: player.indexForTick(r.tick) / span }));
  }, [player, roundStarts]);
  const baselines = useMemo(() => (bout ? roundBaselines(bout.run.frames, bout.run.events) : undefined), [bout]);
  const recording = useMemo(() => (bout ? { frames: bout.run.frames, events: bout.run.events } : undefined), [bout]);
  const broadcastBout = useMemo(() => {
    if (!bout || !boutPresentation) return null;
    const rs = resolveRuleset(bout.config.ruleset);
    const s = bout.config.settings;
    return makeBroadcastBout({
      fighters: bout.fighters,
      runtimes: bout.runtimes,
      cornerColours: boutPresentation.cornerColours,
      stats: bout.run.stats,
      result: bout.run.result,
      rounds: s.rounds ?? rs.rounds.count,
      roundSeconds: s.roundSeconds ?? rs.rounds.lengthS,
      breakSeconds: s.restSeconds ?? rs.rounds.breakS,
    });
  }, [bout, boutPresentation]);
  const names = useMemo(() => bout?.fighters.map((f) => f.short) ?? [], [bout]);
  const corners = useMemo(() => bout?.fighters.map((_, i) => cornerOf(i, teamOf ?? [0, 1])) ?? [], [bout, teamOf]);

  const onMarker = useCallback((m: TimelineMarker) => {
    // Land a beat before the moment, so it plays in.
    const lead = m.kind === 'roundEnd' ? 0 : 15;
    seekToTick(Math.max(0, m.tick - lead));
  }, [seekToTick]);

  // ---- cameras ----------------------------------------------------------------
  const camera = cameraById(cameraId);
  const cameraChoices = useMemo(
    () => CAMERA_SLOTS.filter((c) => view === '3d' || ['auto', 'overhead', 'follow', 'free'].includes(c.id)).map((c) => c.id),
    [view],
  );
  const cameraIdRef = useRef(cameraId);
  cameraIdRef.current = cameraId;
  const chooseCamera = useCallback((id: string) => {
    const c = cameraById(id);
    if (cameraIdRef.current === 'follow' && c.id === 'follow') setFollowId((f) => (f + 1) % Math.max(2, names.length));
    setCameraId(c.id);
    setCameraToast((t) => ({ n: (t?.n ?? 0) + 1, text: c.slot ? `Camera ${c.slot} · ${c.label}` : c.label }));
  }, [names.length]);
  useEffect(() => {
    if (!cameraToast) return undefined;
    const h = setTimeout(() => setCameraToast(null), 1600);
    return () => clearTimeout(h);
  }, [cameraToast]);

  // ---- fullscreen ---------------------------------------------------------------
  const toggleFullscreen = useCallback(() => {
    const el = viewerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else if (typeof el.requestFullscreen === 'function') {
      void el.requestFullscreen().catch(() => toast({ message: 'Fullscreen is not available here.', tone: 'alert' }));
    }
  }, [toast]);
  useEffect(() => {
    const on = (): void => setFullscreen(!!viewerRef.current && document.fullscreenElement === viewerRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // ---- saving and opening -----------------------------------------------------
  const save = useCallback(async () => {
    if (!bout) return;
    setSaving(true);
    try {
      const meta = await saveToLibrary(library, bout, new Date().toISOString());
      setSavedDigest(bout.run.digest);
      setLibraryRevision((r) => r + 1);
      toast({ message: `Saved to the replay library (${formatBytes(meta.bytes)}).` });
    } catch (err) {
      toast({ message: `The replay could not be saved: ${err instanceof Error ? err.message : String(err)}`, tone: 'alert' });
    } finally {
      setSaving(false);
    }
  }, [bout, library, toast]);

  const download = useCallback(async () => {
    if (!bout) return;
    try {
      const file = replayFileFor(bout);
      saveBlob(await encodePortable(file), replayFileName(file));
    } catch (err) {
      toast({ message: `The replay file could not be written: ${err instanceof Error ? err.message : String(err)}`, tone: 'alert' });
    }
  }, [bout, toast]);

  /** Open replay bytes (library or file): decode, verify or re-simulate, show. */
  const openBytes = useCallback((bytesP: Promise<Uint8Array | ArrayBuffer | null>, what: string) => {
    setLibraryOpen(false);
    setLoading(`Opening ${what}…`);
    void (async () => {
      try {
        const bytes = await bytesP;
        if (!bytes) throw new Error('the saved replay is missing from the library');
        // Let the loading state paint before a synchronous re-simulation.
        await new Promise((r) => setTimeout(r, 30));
        const res = await openReplay(bytes, (file) => loadWatchBoutAsync(configFromReplay(file), progressLabel(`Re-simulating ${what}…`)).promise);
        if (!res.ok) {
          toast({ message: res.error.message, tone: 'alert', duration: 9000 });
          return;
        }
        const o = res.opened;
        setError(null);
        setBout(o.bout);
        setVerification({ kind: o.verification, message: o.message });
        toast({ message: o.message, tone: o.verification === 'mismatch' ? 'alert' : 'default' });
        if (o.verification === 'cached') {
          // Opened from stored frames: re-check the digest off the main thread.
          setVerification({ kind: 'checking', message: 'Opened from the saved recording; re-simulating in the background to verify it.' });
          runBout(configFromReplay(o.file), { record: false }).promise.then((out) => {
            const same = out.run.digest === o.file.digest && out.run.ticks === o.file.ticks;
            setVerification(same
              ? { kind: 'verified', message: 'Opened from the saved recording; its seed re-simulates to the same digest.' }
              : { kind: 'mismatch', message: 'The saved recording no longer matches a re-simulation of its seed.' });
          }, () => setVerification({ kind: 'cached', message: 'Opened from the saved recording (background verification unavailable).' }));
        }
      } catch (err) {
        toast({ message: `Could not open ${what}: ${err instanceof Error ? err.message : String(err)}`, tone: 'alert' });
      } finally {
        setLoading(null);
      }
    })();
  }, [toast, progressLabel]);

  const openMeta = useCallback((m: ReplayMeta) => openBytes(library.get(m.id), `“${m.label}”`), [library, openBytes]);
  const downloadMeta = useCallback((m: ReplayMeta) => {
    void (async () => {
      const bytes = await library.get(m.id);
      if (bytes) saveBlob(bytes, `${m.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${m.digest.slice(0, 8)}.boutreplay`);
    })();
  }, [library]);
  const importFile = useCallback((f: File) => openBytes(f.arrayBuffer(), `“${f.name}”`), [openBytes]);

  // ---- QA hook ------------------------------------------------------------------
  // For capture scripts (scripts/dev/polish-shots.mjs, watch-profile.mjs):
  // several captures from one page load instead of recompiling every shader.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const hook = {
      seek: (t: number) => seekToTick(t),
      play: () => apply((p) => p.play()),
      pause: () => apply((p) => p.pause()),
      speed: (s: number) => setSpeed(s),
      camera: (m: string) => {
        const c = cameraFromMode(m);
        if (c) chooseCamera(c.id);
      },
      tick: () => playerRef.current?.tick ?? -1,
      events: () => (playerRef.current?.events ?? []).map((e) => ({ kind: e.kind, tick: e.tick, actor: e.actor, target: e.target })),
      analytics: (on: boolean, t?: AnalyticsTab) => {
        setAnalytics(on);
        if (t) setTab(t);
      },
      help: (on: boolean) => setHelpOpen(on),
      replayLast: () => replayLast(8),
      digest: () => bout?.run.digest ?? null,
    };
    const w = window as unknown as { __watch?: typeof hook };
    w.__watch = hook;
    return () => { if (w.__watch === hook) delete w.__watch; };
  }, [seekToTick, apply, setSpeed, chooseCamera, replayLast, bout]);

  // ---- keyboard ---------------------------------------------------------------
  const runAction = useCallback((a: WatchAction) => {
    const p = playerRef.current;
    switch (a.type) {
      case 'togglePlay': toggle(); break;
      case 'pause': apply((x) => x.pause()); break;
      case 'step': stepFrames(a.frames); break;
      case 'event': apply((x) => x.stepEvent(a.dir), { seek: true }); break;
      case 'marker': {
        if (!p) break;
        // Skip the landing beat onMarker leaves before a moment.
        const m = adjacentMarker(markers.filter((x) => x.kind !== 'bigStrike'), p.tick + (a.dir > 0 ? 15 : -16), a.dir);
        if (m) onMarker(m);
        break;
      }
      case 'speed': if (p) setSpeed(stepSpeed(p.speed, a.dir)); break;
      case 'speedReset': setSpeed(1); break;
      case 'restart': restart(); break;
      case 'end': if (p) seekFrame(p.total - 1); break;
      case 'camera': {
        const c = cameraBySlot(a.slot);
        if (c && cameraChoices.includes(c.id)) chooseCamera(c.id);
        else if (c) toast({ message: `${c.label} needs the 3D view.` });
        break;
      }
      case 'fullscreen': toggleFullscreen(); break;
      case 'help': setHelpOpen((h) => !h); break;
      case 'escape': setHelpOpen(false); break;
      case 'replayLast': replayLast(8); break;
      case 'analytics': setAnalytics((x) => !x); break;
      case 'debug': setDebug((d) => !d); break;
      default: break;
    }
  }, [toggle, apply, stepFrames, markers, onMarker, setSpeed, restart, seekFrame, cameraChoices, chooseCamera, toast, toggleFullscreen, replayLast]);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (tag === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
      // A dialog handles its own keys (Escape closes it).
      if (t?.closest?.('[role="dialog"]')) return;
      // A focused slider moves itself with the arrow keys.
      if (tag === 'INPUT' && /^(Arrow|Home|End|Page)/.test(e.code)) return;
      const action = shortcutFor(e);
      if (!action) return;
      // Space on a focused button would also click it: the shortcut wins.
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      runAction(action);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && (e.target as HTMLElement | null)?.tagName === 'BUTTON') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [active, runAction]);

  const toggleLoop = useCallback(() => {
    if (loopOn) {
      setLoopOn(false);
      apply((p) => p.setLoop(null));
      return;
    }
    const p = playerRef.current;
    if (!p || loopFrom === null) return;
    setLoopOn(true);
    apply((x) => x.setLoop({ fromTick: loopFrom, toTick: p.tick }));
  }, [loopOn, loopFrom, apply]);
  const setIn = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    setLoopFrom(p.tick);
    setLoopOn(false);
    apply((x) => x.setLoop(null));
  }, [apply]);
  const toggleAnalytics = useCallback(() => setAnalytics((x) => !x), []);
  const openLibrary = useCallback(() => setLibraryOpen(true), []);
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const onSave = useCallback(() => { void save(); }, [save]);
  const onDownload = useCallback(() => { void download(); }, [download]);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  const libraryDialog = (
    <LibraryDialog
      open={libraryOpen}
      onClose={closeLibrary}
      library={library}
      revision={libraryRevision}
      currentDigest={bout?.run.digest ?? null}
      onOpen={openMeta}
      onDownload={downloadMeta}
      onImport={importFile}
    />
  );

  // ---- render ---------------------------------------------------------------
  if (error && !bout) {
    return (
      <div className="watch watch--state">
        <ErrorState
          title="This bout could not be rebuilt"
          detail={error}
          actions={(
            <>
              <Button variant="primary" onClick={() => rebuild('Rebuilding the demonstration bout…', demoConfig())}>
                Open the demonstration bout
              </Button>
              <Button onClick={openLibrary}>Saved replays…</Button>
            </>
          )}
        />
        {libraryDialog}
      </div>
    );
  }
  if (!bout || !player) {
    return (
      <div className="watch watch--state">
        <div className="watch-viewer" role="status" aria-live="polite">
          <div className="watch-stage-wrap">
            <div className="watch-stage watch-stage--skeleton">
              <span className="ui-spinner" aria-hidden="true" />
              <span>{loading ?? 'No bout loaded.'}</span>
            </div>
          </div>
          <div className="watch-transport watch-transport--skeleton" aria-hidden="true" />
        </div>
      </div>
    );
  }

  const stage = view === '3d' && boutPresentation ? (
    <Arena3D
      bout={boutPresentation}
      frame={player.current}
      next={player.next}
      alpha={player.alpha}
      events={[]}
      playbackRate={speed}
      replay={!!replayState}
      seekVersion={seekRef.current}
      getPlayhead={getPlayhead}
      recording={recording}
      camera={{ mode: camera.mode, followId }}
      cameraOverride={camera.override}
      quality={quality}
      onRecommendedQuality={(level) => { if (!qualityChosenRef.current) setQuality(level); }}
      renderScale={renderScale ?? undefined}
      debug={debug}
      labels={false}
      tickSeconds={TICK_SECONDS}
      active={active}
      onBackend={setBackend3d}
      onNotice={(m) => { if (m) toast({ message: m }); }}
      onLive={() => {
        if (!pendingPlayRef.current) return;
        pendingPlayRef.current = false;
        apply((p) => p.play());
      }}
      onUnavailable={(reason) => {
        setNotice3d(`3D view unavailable (${reason}); showing the 2D board.`);
        setView('2d');
        if (pendingPlayRef.current) {
          pendingPlayRef.current = false;
          apply((p) => p.play());
        }
      }}
    >
      {broadcastBout
        ? ({ shot }) => (
          <LiveOverlay
            player={player}
            signal={signal}
            sequencer={sequencer}
            bout={broadcastBout}
            events={bout.run.events}
            shot={shot}
          />
        )
        : null}
    </Arena3D>
  ) : (
    <div className="watch-stage watch-stage--2d">
      <Board2D
        player={player}
        signal={signal}
        bout={bout}
        arena={arena}
        camera={camera.board}
        followId={followId}
        corners={corners}
        labels={names}
      />
    </div>
  );

  return (
    <WatchProfiler id="watch">
      <div className="watch" data-analytics={analytics || undefined}>
        <div className="watch-main">
          <div className="watch-viewer" ref={viewerRef} data-fullscreen={fullscreen || undefined}>
            <div className="watch-stage-wrap">
              {stage}
              {cameraToast ? <span key={cameraToast.n} className="watch-cam-toast" role="status">{cameraToast.text}</span> : null}
              {view === '2d' && replayTitle ? <span className="watch-2d-replay">REPLAY · {replayTitle}</span> : null}
              {loading ? (
                <div className="watch-stage-loading" role="status" aria-live="polite">
                  <span className="ui-spinner" aria-hidden="true" />
                  <span>{loading}</span>
                </div>
              ) : null}
            </div>
            <WatchProfiler id="transport">
              <TransportBar
                player={player}
                signal={signal}
                markers={markers}
                rounds={roundMarks}
                label={label}
                playing={playing}
                speed={speed}
                replay={replayTitle}
                cameraId={camera.id}
                cameraChoices={cameraChoices}
                fullscreen={fullscreen}
                onToggle={toggle}
                onRestart={restart}
                onStep={stepFrames}
                onSpeed={setSpeed}
                onSeekFrame={seekFrame}
                onMarker={onMarker}
                onCamera={chooseCamera}
                onReplayLast={replayLast}
                onBackToLive={backToLive}
                onFullscreen={toggleFullscreen}
                onHelp={openHelp}
              />
            </WatchProfiler>
          </div>
          {notice3d ? <p className="watch-notice" role="status">{notice3d}</p> : null}

          <WatchProfiler id="fighters">
            <FighterBar player={player} signal={signal} bout={bout} rounds={rounds} roundSeconds={roundSeconds} baselines={baselines} />
          </WatchProfiler>

          <ReplayBar
            player={player}
            signal={signal}
            plans={sequencer?.plans ?? NO_PLANS}
            onPlan={playPlan}
            label={label}
            loopOn={loopOn}
            loopFrom={loopFrom}
            onSetIn={setIn}
            onToggleLoop={toggleLoop}
            onSave={onSave}
            saving={saving}
            savedHere={savedDigest === bout.run.digest}
            onLibrary={openLibrary}
            onDownload={onDownload}
            verification={verification}
            analyticsOpen={analytics}
            onAnalytics={toggleAnalytics}
          />

          <details className="watch-settings">
            <summary>
              <IconGear />
              View settings
              <span className="ws-now">
                {view === '3d' ? `3D broadcast${backend3d ? ` · ${backend3d === 'webgpu' ? 'WebGPU' : 'WebGL2'}` : ''} · ${quality}` : '2D board'}
              </span>
            </summary>
            <div className="ws-row">
              <div className="ui-seg" role="radiogroup" aria-label="View">
                <button type="button" role="radio" aria-checked={view === '3d'} onClick={() => { setNotice3d(null); setView('3d'); }}>3D broadcast</button>
                <button type="button" role="radio" aria-checked={view === '2d'} onClick={() => setView('2d')}>2D board</button>
              </div>
              {view === '3d' ? (
                <>
                  <label className="wt-select" title="Low: weak integrated GPUs. High: the 60 fps target on a modern laptop. Ultra: discrete GPUs.">
                    <span className="wt-select-label">Quality</span>
                    <select
                      value={quality}
                      aria-label="3D quality"
                      onChange={(e) => {
                        const q = e.target.value;
                        if (isQualityLevel(q)) {
                          qualityChosenRef.current = true;
                          writeQualityChoice(q);
                          setQuality(q);
                          setRenderScale(null);
                        }
                      }}
                    >
                      {QUALITY_LEVELS.map((q) => <option key={q} value={q}>{q[0].toUpperCase() + q.slice(1)}</option>)}
                    </select>
                  </label>
                  <label className="wt-select" title="Internal render resolution">
                    <span className="wt-select-label">Scale</span>
                    <input
                      type="range"
                      min={0.5}
                      max={1}
                      step={0.05}
                      value={renderScale ?? QUALITY_PRESETS[quality].renderScale}
                      aria-label="Render scale"
                      onChange={(e) => setRenderScale(Number(e.target.value))}
                    />
                    <span className="num">{Math.round((renderScale ?? QUALITY_PRESETS[quality].renderScale) * 100)}%</span>
                  </label>
                </>
              ) : null}
              <button type="button" className="wa-chip" aria-pressed={debug} onClick={() => setDebug((d) => !d)} title="Debug skeletons and readouts (D)">
                Debug
              </button>
            </div>
          </details>
        </div>

        {analytics ? (
          <WatchProfiler id="analytics">
            <div id="watch-analytics" className="watch-side">
              <AnalyticsPanel
                player={player}
                signal={signal}
                bout={bout}
                names={names}
                corners={corners}
                onSeekTick={seekToTick}
                tab={tab}
                onTab={setTab}
                debug={debug}
                label={label}
                roundStartTick={roundStartTick}
              />
            </div>
          </WatchProfiler>
        ) : null}

        <HelpOverlay open={helpOpen} onClose={closeHelp} />
        {libraryDialog}
      </div>
    </WatchProfiler>
  );
}
