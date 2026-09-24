/**
 * WATCH — the live spectator surface (docs/design/09 §4.4, §4.5, §5).
 *
 * The bout playing, with:
 *   - the HUD: names, records, the round clock, running and per-round stats,
 *     damage and stamina indicators;
 *   - the event timeline, clickable to seek;
 *   - the live commentary feed;
 *   - the **game-plan panel** — each fighter's mode, plan lines, active
 *     adjustments, score belief and emergency state, straight from
 *     `Sim.intents()`. This is the "visible game plan" the brief asks for.
 *
 * Spectator controls: pause, speed (0.1x-8x, true slow motion), frame and event
 * stepping, a loop range, instant replays, a camera selector and a debug
 * overlay exposing the state graph, the AI's decision state, the tier rows
 * currently firing and the stamina/damage pools.
 *
 * In 3D the picture is a broadcast: the camera director plans its edit from
 * the whole recording, the `ReplaySequencer` airs instant replays at natural
 * pauses (slow motion, extra angles, the REPLAY bug), and the broadcast
 * graphics (`BroadcastOverlay`) sit on the picture; the side panels stay.
 *
 * The screen imports the sim only through `src/sim`; the transport, the loader
 * and every derivation live in `src/app/replay`.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS, ARCHETYPES, eventWindow, resolveArena, resolveRuleset,
  type SimConfig,
} from '../../sim';
import { BoutPlayer, MAX_SPEED, MIN_SPEED, TICK_SECONDS } from '../replay/player';
import type { InstantReplayRequest } from '../replay/player';
import { loadWatchBout, type WatchBout } from '../replay/bout';
import {
  commentaryUpTo, cornerOf, debugRows, gamePlanRows, hudModel, intentsAt,
  roundBaselines, scorecardModel, statRows,
} from '../replay/viewModel';
import { Hud } from '../components/Hud';
import { EventTimeline, TIMELINE_GROUPS } from '../components/EventTimeline';
import { CommentaryFeed } from '../components/CommentaryFeed';
import { GamePlanPanel } from '../components/GamePlanPanel';
import { StatTable } from '../components/StatTable';
import { Scorecard } from '../components/Scorecard';
import { DebugOverlay } from '../components/DebugOverlay';
import { ArenaCanvas, CAMERA_MODES, type CameraMode } from '../components/ArenaCanvas';
import { Arena3D } from '../components/Arena3D';
import type { CameraMode as CameraMode3D, QualityLevel } from '../../presentation/contract';
import { buildBoutPresentation } from '../../presentation/stage/bout';
import { ReplaySequencer, planReplays } from '../../presentation/camera';
import { BroadcastOverlay, makeBroadcastBout } from '../components/broadcast';
import { EventIndex, advanceBroadcast, manualReplayPlan } from '../replay/broadcast';
import { gpuLikelyAvailable, isQualityLevel, QUALITY_LEVELS, QUALITY_PRESETS } from '../../presentation/stage/index';
import '../watch.css';

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 8] as const;

// The event log holds thousands of rows (7 000+ for a three-round bout) and the
// screen re-renders on every tick of playback; memoised with stable callbacks,
// the log re-renders only when the playhead crosses an event.
const MemoEventTimeline = memo(EventTimeline);
const MemoCommentaryFeed = memo(CommentaryFeed);

/** The 3D broadcast's camera modes (the 2D board keeps its own four). */
const CAMERA_MODES_3D: readonly { id: CameraMode3D; label: string; hint: string }[] = [
  { id: 'broadcast', label: 'Broadcast', hint: 'The director cuts between broadcast shots' },
  { id: 'cageside', label: 'Cageside', hint: 'Low, close, at the fence' },
  { id: 'overhead', label: 'Overhead', hint: 'From the truss, for the ground game' },
  { id: 'follow', label: 'Follow', hint: 'Tight on one fighter' },
  { id: 'orbit', label: 'Orbit', hint: 'A slow circle around the action' },
  { id: 'free', label: 'Free', hint: 'Drag to move the camera' },
];

/** The 3D camera mode that best matches each 2D board mode. */
const TO_3D: Record<CameraMode, CameraMode3D> = { broadcast: 'broadcast', top: 'overhead', follow: 'follow', free: 'free' };

interface ViewPrefs {
  view: '3d' | '2d' | null;
  quality: QualityLevel | null;
  scale: number | null;
}

const VIEW_PREFS_KEY = 'boutlab.watch.view.v1';

/** The viewer's saved 3D/2D choice and quality, if any. Never throws. */
function readViewPrefs(): ViewPrefs {
  try {
    const raw = window.localStorage.getItem(VIEW_PREFS_KEY);
    if (!raw) return { view: null, quality: null, scale: null };
    const v = JSON.parse(raw) as Partial<ViewPrefs>;
    return {
      view: v.view === '3d' || v.view === '2d' ? v.view : null,
      quality: isQualityLevel(v.quality) ? v.quality : null,
      scale: typeof v.scale === 'number' && Number.isFinite(v.scale) ? v.scale : null,
    };
  } catch {
    return { view: null, quality: null, scale: null };
  }
}

/**
 * QA overrides from the page URL, for capture scripts: `?view=3d|2d`,
 * `?quality=low|medium|high|ultra`, `?scale=0.7`, `?cam=cageside`,
 * `?seek=<tick>`, `?play=1`, `?demo=<seed>[:<archetype index A>:<index B>]`
 * (which demonstration bout to open). They are applied once and never persisted.
 */
function urlOverrides(): {
  view?: '3d' | '2d'; quality?: QualityLevel; scale?: number; cam?: CameraMode3D; seek?: number; play?: boolean;
  demo?: { seed: string; a: number; b: number };
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
  if (cam && CAMERA_MODES_3D.some((c) => c.id === cam)) out.cam = cam as CameraMode3D;
  const seek = Number(q.get('seek'));
  if (q.has('seek') && Number.isFinite(seek)) out.seek = seek;
  if (q.get('play') === '1') out.play = true;
  const demo = q.get('demo');
  if (demo) {
    const [seed, a, b] = demo.split(':');
    out.demo = { seed: seed || 'watch-demo', a: Number(a) || 0, b: b === undefined ? 1 : Number(b) || 0 };
  }
  return out;
}

function writeViewPrefs(p: ViewPrefs): void {
  try {
    window.localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(p));
  } catch {
    // Private mode or storage full: the choice just is not remembered.
  }
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

export function Watch(props: WatchProps): JSX.Element {
  const active = props.active !== false;
  const config = props.config ?? null;

  const [bout, setBout] = useState<WatchBout | null>(props.bout ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transport state. `frame` exists only to re-render; the player owns the truth.
  const playerRef = useRef<BoutPlayer | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [alpha, setAlpha] = useState(0);
  const [camera, setCamera] = useState<CameraMode>('broadcast');
  const [followId, setFollowId] = useState(0);
  const [debug, setDebug] = useState(false);
  const [colourOnly, setColourOnly] = useState(false);
  const [statRound, setStatRound] = useState(0);
  const [groups, setGroups] = useState<ReadonlySet<string>>(new Set());
  const [loopOn, setLoopOn] = useState(false);
  const [loopFrom, setLoopFrom] = useState(0);

  // ---- 3D view --------------------------------------------------------------
  // Default: 3D when a GPU path exists, unless the viewer chose otherwise.
  const [prefs] = useState(readViewPrefs);
  const [qa] = useState(urlOverrides);
  const [view, setView] = useState<'3d' | '2d'>(() => qa.view ?? prefs.view ?? (gpuLikelyAvailable() ? '3d' : '2d'));
  const [quality, setQuality] = useState<QualityLevel>(() => qa.quality ?? prefs.quality ?? 'high');
  const [renderScale, setRenderScale] = useState<number | null>(qa.scale ?? prefs.scale);
  const [camera3d, setCamera3d] = useState<CameraMode3D>(qa.cam ?? 'broadcast');
  const [notice3d, setNotice3d] = useState<string | null>(null);
  const [backend3d, setBackend3d] = useState<string | null>(null);
  // Bumped on every jump of the playhead that is not plain playback (seeks,
  // replay starts/angle changes/returns), so the 3D view snaps its smoothing
  // filters and drops temporal history. A ref, read by the 3D view in the same
  // instant as the frame, so one seek is exactly one discontinuity frame.
  const seekRef = useRef(0);
  const pendingPlayRef = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    writeViewPrefs({ view, quality, scale: renderScale });
  }, [view, quality, renderScale]);

  // ---- loading -----------------------------------------------------------
  useEffect(() => {
    if (props.bout) {
      setBout(props.bout);
      return;
    }
    // Rebuilding a bout with every frame kept is seconds of synchronous work.
    // The shell keeps this screen mounted behind a hidden tab, so nothing is
    // simulated until somebody actually opens it.
    if (!active && !bout) return;
    const target = config ?? (qa.demo ? demoConfig(qa.demo.seed, qa.demo.a, qa.demo.b) : demoConfig());
    setLoading(true);
    setError(null);
    // Deferred a frame so the "rebuilding" state paints before the sim runs;
    // this is a synchronous multi-thousand-tick simulation.
    const handle = setTimeout(() => {
      try {
        setBout(loadWatchBout(target));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }, 0);
    return () => clearTimeout(handle);
    // `bout` is read as a latch, not a trigger, so it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bout, config, active]);

  /**
   * The transport is built during render, not in an effect. Built in an effect
   * it would be missing for the first render after the bout arrives, and the
   * effect's `setFrame(0)` is a no-op when the frame is already 0 — so React
   * would bail out of the re-render and the screen would sit on "No bout
   * loaded" forever. This is that bug, fixed by construction.
   */
  const player = useMemo(() => {
    if (!bout) return null;
    const p = new BoutPlayer({ frames: bout.run.frames, events: bout.run.events });
    playerRef.current = p;
    return p;
  }, [bout]);

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

  useEffect(() => {
    if (!player) return;
    setFrame(0);
    setPlaying(false);
    setSpeed(player.speed);
    setAlpha(0);
    setLoopOn(false);
    setStatRound(0);
    if (qa.seek !== undefined) {
      player.seekTick(qa.seek);
      seqRef.current?.reset(player.tick);
      setFrame(player.frame);
      seekRef.current++;
    }
    if (qa.play) {
      // In 3D, start once the broadcast is on screen (see `onLive`), not
      // while the shaders are still compiling behind the loading card.
      if (viewRef.current === '3d') pendingPlayRef.current = true;
      else {
        player.play();
        setPlaying(true);
      }
    }
    // `qa` is read once, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  // ---- the animation loop -------------------------------------------------
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !active || !playing) return undefined;
    let raf = 0;
    let last = performance.now();
    const step = (now: number): void => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const { alpha: a, jumped } = advanceBroadcast(player, seqRef.current, dt);
      if (jumped) seekRef.current++;
      setFrame(player.frame);
      // Sub-tick alpha changes every display frame. The 2D board needs it as a
      // prop; the 3D view reads the player directly (`getPlayhead`), so in 3D
      // the screen re-renders at the sim's tick rate instead of 60 times a
      // second, which is what keeps the 3D view's frame budget for the GPU.
      if (viewRef.current === '2d') setAlpha(a);
      if (!player.playing) setPlaying(false);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, playing, bout]);

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
   * Run a transport action. `seek` actions (scrub, step, jump to an event)
   * first end any replay on air, and re-arm the replay schedule from the new
   * playhead afterwards.
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
    setFrame(p.frame);
    setPlaying(p.playing);
    setSpeed(p.speed);
    setAlpha(p.alpha);
  }, []);

  const seekToTick = useCallback((t: number) => apply((p) => {
    p.pause();
    p.seekTick(t);
  }, { seek: true }), [apply]);

  /** Every replay goes through the sequencer: slow motion, the REPLAY bug, the replay camera. */
  const replayLast = useCallback((seconds: number) => apply((p, seq) => {
    const tick = p.tick;
    const req = {
      fromTick: Math.max(0, tick - Math.round(seconds / TICK_SECONDS)), toTick: tick, speed: 0.3,
      label: `Last ${seconds}s`, eventIndex: -1,
    };
    if (seq) seq.play(manualReplayPlan(req, p.events), p);
    else p.startInstantReplay(req);
  }), [apply]);

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        apply((p) => p.toggle());
      } else if (e.code === 'ArrowLeft') {
        apply((p) => p.stepBy(e.shiftKey ? -10 : -1), { seek: true });
      } else if (e.code === 'ArrowRight') {
        apply((p) => p.stepBy(e.shiftKey ? 10 : 1), { seek: true });
      } else if (e.code === 'BracketLeft') {
        apply((p) => p.stepEvent(-1), { seek: true });
      } else if (e.code === 'BracketRight') {
        apply((p) => p.stepEvent(1), { seek: true });
      } else if (e.code === 'KeyR') {
        replayLast(8);
      } else if (e.code === 'KeyD') {
        setDebug((d) => !d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, apply, replayLast]);

  // ---- derived view-models ------------------------------------------------
  const teamOf = bout?.config.teams.teamOf ?? [0, 1];
  const corner = useCallback((id: number) => cornerOf(id, teamOf), [teamOf]);
  const arena = useMemo(
    () => resolveArena(bout?.config.arena ?? 'octagon_30'),
    [bout?.config.arena],
  );
  const boutPresentation = useMemo(
    () => (bout ? buildBoutPresentation({ config: bout.config, fighters: bout.fighters, runtimes: bout.runtimes }) : null),
    [bout],
  );
  const rounds = useMemo(() => {
    if (!bout) return 3;
    const rs = resolveRuleset(bout.config.ruleset);
    return bout.config.settings.rounds ?? rs.rounds.count;
  }, [bout]);

  const current = player?.current ?? null;
  const tick = current?.tick ?? 0;

  const roundStarts = useMemo(() => {
    const map: number[] = [];
    for (const e of bout?.run.events ?? []) if (e.kind === 'roundStart') map[e.round] = e.tick;
    return map;
  }, [bout]);
  const roundStartTick = useCallback((at: number): number => {
    let best = 0;
    for (const t of roundStarts) if (t !== undefined && t <= at) best = t;
    return best;
  }, [roundStarts]);

  const baselines = useMemo(
    () => (bout ? roundBaselines(bout.run.frames, bout.run.events) : undefined),
    [bout],
  );
  const hud = useMemo(
    () => (bout
      ? hudModel(current, bout.fighters, bout.runtimes, bout.run.stats, teamOf, rounds, baselines)
      : null),
    [bout, current, teamOf, rounds, baselines],
  );
  const liveIntents = useMemo(
    () => (bout ? intentsAt(bout.intents, tick) : []),
    [bout, tick],
  );
  const planRows = useMemo(
    () => (bout ? gamePlanRows(liveIntents, bout.fighters, teamOf) : []),
    [bout, liveIntents, teamOf],
  );
  const lines = useMemo(
    () => (bout ? commentaryUpTo(bout.commentary, tick) : []),
    [bout, tick],
  );
  const window10 = useMemo(
    () => (bout ? eventWindow(bout.run.events, tick - 12, tick).events : []),
    [bout, tick],
  );
  // The 3D view reads its per-frame event window through `getPlayhead`
  // (through the next tick); this is only the fallback prop.
  const window20 = useMemo(
    () => (bout ? eventWindow(bout.run.events, tick - 20, tick).events : []),
    [bout, tick],
  );
  const recording = useMemo(
    () => (bout ? { frames: bout.run.frames, events: bout.run.events } : undefined),
    [bout],
  );
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
  const cards = useMemo(
    () => (bout
      ? scorecardModel(bout.run.events, bout.run.result.judgeTotals, current?.score.hidden ?? true)
      : null),
    [bout, current?.score.hidden],
  );
  const statsRow = useMemo(() => {
    if (!bout) return undefined;
    return statRound === 0
      ? bout.run.stats.total
      : bout.run.stats.perRound.find((r) => r.round === statRound);
  }, [bout, statRound]);

  const names = bout?.fighters.map((f) => f.short) ?? [];
  const corners = bout?.fighters.map((_, i) => corner(i)) ?? [];
  const replays: readonly InstantReplayRequest[] = player?.availableReplays() ?? [];
  const replayState = sequencer?.state ?? null;

  // ---- render --------------------------------------------------------------
  if (error) {
    return (
      <div className="watch">
        <p className="empty">This bout could not be rebuilt: {error}</p>
      </div>
    );
  }
  if (!bout || !player) {
    return (
      <div className="watch">
        <p className="empty">{loading ? 'Rebuilding the bout from its seed…' : 'No bout loaded.'}</p>
      </div>
    );
  }

  return (
    <div className="watch">
      <div className="watch-main">
        {view === '3d' && boutPresentation ? (
          <Arena3D
            bout={boutPresentation}
            frame={current}
            next={player.next}
            alpha={alpha}
            events={window20}
            playbackRate={speed}
            replay={!!replayState}
            seekVersion={seekRef.current}
            getPlayhead={getPlayhead}
            recording={recording}
            camera={{ mode: camera3d, followId }}
            quality={quality}
            renderScale={renderScale ?? undefined}
            debug={debug}
            labels={false}
            tickSeconds={TICK_SECONDS}
            active={active}
            onBackend={(b) => setBackend3d(b)}
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
                <BroadcastOverlay
                  bout={broadcastBout}
                  frame={current}
                  events={bout.run.events}
                  replay={replayState}
                  replayWipeKey={sequencer?.wipeKey ?? 0}
                  shot={shot}
                />
              )
              : null}
          </Arena3D>
        ) : (
          <ArenaCanvas
            frame={current}
            next={player.next}
            alpha={alpha}
            arena={arena}
            window={window10}
            camera={camera}
            followId={followId}
            corners={corners}
            labels={names}
          />
        )}
        {notice3d ? <p className="keyhints" role="status">{notice3d}</p> : null}

        <section className="panel controls watch-controls" aria-label="Playback controls">
          <div className="scrub-row">
            <button
              type="button"
              className="btn btn--play"
              onClick={() => apply((p) => p.toggle())}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              className="scrub"
              type="range"
              min={0}
              max={Math.max(0, player.total - 1)}
              value={frame}
              aria-label="Scrub"
              onChange={(e) => apply((p) => {
                p.pause();
                p.seekFrame(Number(e.target.value));
              }, { seek: true })}
            />
            <span className="frame-read num">
              <b>{(tick * TICK_SECONDS).toFixed(1)}s</b> · tick {tick} / {player.total - 1}
            </span>
          </div>

          <div className="ctl-rows">
            <div className="group">
              <span className="group-label">Frame</span>
              <div className="group-row">
                <button type="button" className="btn btn--icon" onClick={() => apply((p) => p.stepBy(-10), { seek: true })}>&laquo;</button>
                <button type="button" className="btn btn--icon" onClick={() => apply((p) => p.stepBy(-1), { seek: true })}>&lsaquo;</button>
                <button type="button" className="btn btn--icon" onClick={() => apply((p) => p.stepBy(1), { seek: true })}>&rsaquo;</button>
                <button type="button" className="btn btn--icon" onClick={() => apply((p) => p.stepBy(10), { seek: true })}>&raquo;</button>
              </div>
            </div>

            <div className="group">
              <span className="group-label">Event</span>
              <div className="group-row">
                <button type="button" className="btn" onClick={() => apply((p) => p.stepEvent(-1), { seek: true })}>Prev</button>
                <button type="button" className="btn" onClick={() => apply((p) => p.stepEvent(1), { seek: true })}>Next</button>
              </div>
            </div>

            <div className="group">
              <span className="group-label">Speed &mdash; {speed}&times;</span>
              <div className="group-row">
                <span className="seg">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="btn"
                      aria-pressed={Math.abs(speed - s) < 1e-6}
                      onClick={() => apply((p) => p.setSpeed(s))}
                    >
                      {s}&times;
                    </button>
                  ))}
                </span>
                <input
                  type="range"
                  className="scrub watch-speed"
                  min={MIN_SPEED}
                  max={MAX_SPEED}
                  step={0.05}
                  value={speed}
                  aria-label="Playback speed"
                  onChange={(e) => apply((p) => p.setSpeed(Number(e.target.value)))}
                />
              </div>
            </div>

            <div className="group">
              <span className="group-label">Loop</span>
              <div className="group-row">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setLoopFrom(tick);
                    setLoopOn(false);
                    apply((p) => p.setLoop(null));
                  }}
                >
                  Set in ({loopFrom})
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-pressed={loopOn}
                  onClick={() => {
                    if (loopOn) {
                      setLoopOn(false);
                      apply((p) => p.setLoop(null));
                    } else {
                      setLoopOn(true);
                      apply((p) => p.setLoop({ fromTick: loopFrom, toTick: tick }));
                    }
                  }}
                >
                  {loopOn ? 'Looping' : 'Loop to here'}
                </button>
              </div>
            </div>

            <div className="group">
              <span className="group-label">Instant replay</span>
              <div className="group-row">
                <button type="button" className="btn" onClick={() => replayLast(8)}>
                  Last 8s
                </button>
                {replays.slice(-3).map((r) => {
                  // A planned broadcast replay of the same moment has its angles; else one angle.
                  const planned = sequencer?.plans.find((pl) => pl.eventIndex === r.eventIndex);
                  return (
                    <button
                      key={`${r.fromTick}-${r.eventIndex}`}
                      type="button"
                      className="btn"
                      title={r.label}
                      onClick={() => apply((p, seq) => {
                        if (seq) seq.play(planned ?? manualReplayPlan(r, p.events), p);
                        else p.startInstantReplay(r);
                      })}
                    >
                      {r.label.slice(0, 22)}
                    </button>
                  );
                })}
                {player.inInstantReplay || replayState ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => apply((p, seq) => {
                      if (seq?.state) seq.stop(p);
                      else p.stopInstantReplay();
                    })}
                  >
                    Back to live
                  </button>
                ) : null}
              </div>
            </div>

            <div className="group">
              <span className="group-label">Camera</span>
              <div className="group-row">
                <span className="seg">
                  {view === '3d'
                    ? CAMERA_MODES_3D.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="btn"
                        title={c.hint}
                        aria-pressed={camera3d === c.id}
                        onClick={() => setCamera3d(c.id)}
                      >
                        {c.label}
                      </button>
                    ))
                    : CAMERA_MODES.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="btn"
                        title={c.hint}
                        aria-pressed={camera === c.id}
                        onClick={() => {
                          setCamera(c.id);
                          setCamera3d(TO_3D[c.id]);
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                </span>
                {(view === '3d' ? camera3d === 'follow' : camera === 'follow') ? (
                  <select
                    className="field"
                    value={followId}
                    aria-label="Fighter to follow"
                    onChange={(e) => setFollowId(Number(e.target.value))}
                  >
                    {names.map((n, i) => <option key={n + i} value={i}>{n}</option>)}
                  </select>
                ) : null}
              </div>
            </div>

            <div className="group">
              <span className="group-label">
                View{view === '3d' && backend3d ? <> &mdash; {backend3d === 'webgpu' ? 'WebGPU' : 'WebGL2'}</> : null}
              </span>
              <div className="group-row">
                <span className="seg">
                  <button
                    type="button"
                    className="btn"
                    aria-pressed={view === '3d'}
                    onClick={() => { setNotice3d(null); setView('3d'); }}
                  >
                    3D
                  </button>
                  <button type="button" className="btn" aria-pressed={view === '2d'} onClick={() => setView('2d')}>
                    2D
                  </button>
                </span>
                {view === '3d' ? (
                  <>
                    <select
                      className="field"
                      value={quality}
                      aria-label="3D quality"
                      title="Low: weak integrated GPUs. High: the 60 fps target on a modern laptop. Ultra: discrete GPUs."
                      onChange={(e) => {
                        const q = e.target.value;
                        if (isQualityLevel(q)) {
                          setQuality(q);
                          setRenderScale(null);
                        }
                      }}
                    >
                      {QUALITY_LEVELS.map((q) => (
                        <option key={q} value={q}>{q[0].toUpperCase() + q.slice(1)}</option>
                      ))}
                    </select>
                    <label className="keyhints" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      Scale
                      <input
                        type="range"
                        className="scrub watch-speed"
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
              </div>
            </div>

            <div className="group">
              <span className="group-label">Overlays</span>
              <div className="group-row">
                <button type="button" className="btn" aria-pressed={debug} onClick={() => setDebug((d) => !d)}>
                  Debug
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-pressed={colourOnly}
                  onClick={() => setColourOnly((c) => !c)}
                >
                  Strategy only
                </button>
              </div>
            </div>
          </div>

          <p className="keyhints">
            <span><kbd>Space</kbd> play/pause</span>
            <span><kbd>&larr;</kbd><kbd>&rarr;</kbd> step a frame</span>
            <span><kbd>[</kbd><kbd>]</kbd> step an event</span>
            <span><kbd>R</kbd> replay the last 8s</span>
            <span><kbd>D</kbd> debug</span>
          </p>
        </section>

        <Hud model={hud} loading={loading} />

        <GamePlanPanel
          rows={planRows}
          trueCards={current?.score.hidden ? null : current?.score.cards ?? null}
          showTierRules={debug}
        />

        {debug ? (
          <DebugOverlay
            rows={debugRows(current, liveIntents, bout.fighters)}
            tick={tick}
            digest={bout.run.digest}
            rngDraws={bout.run.rngDraws}
          />
        ) : null}

        <StatTable
          title="Statistics"
          rows={statRows(statsRow)}
          names={names}
          corners={corners}
          rounds={bout.run.stats.perRound.map((r) => r.round)}
          selectedRound={statRound}
          onSelectRound={setStatRound}
        />

        <Scorecard
          model={cards ?? { hidden: true, judges: [], rounds: [] }}
          names={names}
          corners={corners}
          result={bout.run.result}
          reveal={current?.phase === 'ended'}
        />
      </div>

      <aside className="watch-side">
        <MemoCommentaryFeed
          lines={lines}
          cornerOf={corner}
          colourOnly={colourOnly}
          onSeekTick={seekToTick}
        />

        <div className="panel watch-filter">
          <div className="panel-head"><span className="panel-title">Timeline filter</span></div>
          <div className="group-row">
            {TIMELINE_GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                className="btn"
                aria-pressed={groups.has(g)}
                onClick={() => setGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(g)) next.delete(g);
                  else next.add(g);
                  return next;
                })}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <MemoEventTimeline
          events={bout.run.events}
          currentIndex={player.currentEventIndex()}
          cornerOf={corner}
          roundStartTick={roundStartTick}
          filter={groups}
          onSeekTick={seekToTick}
        />
      </aside>
    </div>
  );
}
