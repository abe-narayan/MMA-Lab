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
 * The screen imports the sim only through `src/sim`; the transport, the loader
 * and every derivation live in `src/app/replay`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import '../watch.css';

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 8] as const;

/** A bout to show when the screen is opened without one — a demonstration. */
export function demoConfig(seed = 'watch-demo'): SimConfig {
  const list = Object.values(ARCHETYPES);
  return {
    seed,
    mode: '1v1',
    fighters: [list[0], list[1]],
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
    const target = config ?? demoConfig();
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

  useEffect(() => {
    if (!player) return;
    setFrame(0);
    setPlaying(false);
    setSpeed(player.speed);
    setAlpha(0);
    setLoopOn(false);
    setStatRound(0);
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
      const a = player.advance(dt);
      setFrame(player.frame);
      setAlpha(a);
      if (!player.playing) setPlaying(false);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, playing, bout]);

  const apply = useCallback((fn: (p: BoutPlayer) => void) => {
    const p = playerRef.current;
    if (!p) return;
    fn(p);
    setFrame(p.frame);
    setPlaying(p.playing);
    setSpeed(p.speed);
    setAlpha(p.alpha);
  }, []);

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
        apply((p) => p.stepBy(e.shiftKey ? -10 : -1));
      } else if (e.code === 'ArrowRight') {
        apply((p) => p.stepBy(e.shiftKey ? 10 : 1));
      } else if (e.code === 'BracketLeft') {
        apply((p) => p.stepEvent(-1));
      } else if (e.code === 'BracketRight') {
        apply((p) => p.stepEvent(1));
      } else if (e.code === 'KeyR') {
        apply((p) => p.showLastSeconds(8));
      } else if (e.code === 'KeyD') {
        setDebug((d) => !d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, apply]);

  // ---- derived view-models ------------------------------------------------
  const teamOf = bout?.config.teams.teamOf ?? [0, 1];
  const corner = useCallback((id: number) => cornerOf(id, teamOf), [teamOf]);
  const arena = useMemo(
    () => resolveArena(bout?.config.arena ?? 'octagon_30'),
    [bout?.config.arena],
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
              })}
            />
            <span className="frame-read num">
              <b>{(tick * TICK_SECONDS).toFixed(1)}s</b> · tick {tick} / {player.total - 1}
            </span>
          </div>

          <div className="ctl-rows">
            <div className="group">
              <span className="group-label">Frame</span>
              <div className="group-row">
                <button type="button" className="btn btn--icon" onClick={() => apply((p) => p.stepBy(-10))}>&laquo;</button>
                <button type="button" className="btn btn--icon" onClick={() => apply((p) => p.stepBy(-1))}>&lsaquo;</button>
                <button type="button" className="btn btn--icon" onClick={() => apply((p) => p.stepBy(1))}>&rsaquo;</button>
                <button type="button" className="btn btn--icon" onClick={() => apply((p) => p.stepBy(10))}>&raquo;</button>
              </div>
            </div>

            <div className="group">
              <span className="group-label">Event</span>
              <div className="group-row">
                <button type="button" className="btn" onClick={() => apply((p) => p.stepEvent(-1))}>Prev</button>
                <button type="button" className="btn" onClick={() => apply((p) => p.stepEvent(1))}>Next</button>
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
                <button type="button" className="btn" onClick={() => apply((p) => p.showLastSeconds(8))}>
                  Last 8s
                </button>
                {replays.slice(-3).map((r) => (
                  <button
                    key={`${r.fromTick}-${r.eventIndex}`}
                    type="button"
                    className="btn"
                    title={r.label}
                    onClick={() => apply((p) => p.startInstantReplay(r))}
                  >
                    {r.label.slice(0, 22)}
                  </button>
                ))}
                {player.inInstantReplay ? (
                  <button type="button" className="btn" onClick={() => apply((p) => p.stopInstantReplay())}>
                    Back to live
                  </button>
                ) : null}
              </div>
            </div>

            <div className="group">
              <span className="group-label">Camera</span>
              <div className="group-row">
                <span className="seg">
                  {CAMERA_MODES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="btn"
                      title={c.hint}
                      aria-pressed={camera === c.id}
                      onClick={() => setCamera(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </span>
                {camera === 'follow' ? (
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
        <CommentaryFeed
          lines={lines}
          cornerOf={corner}
          colourOnly={colourOnly}
          onSeekTick={(t) => apply((p) => {
            p.pause();
            p.seekTick(t);
          })}
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

        <EventTimeline
          events={bout.run.events}
          currentIndex={player.currentEventIndex()}
          cornerOf={corner}
          roundStartTick={roundStartTick}
          filter={groups}
          onSeekTick={(t) => apply((p) => {
            p.pause();
            p.seekTick(t);
          })}
        />
      </aside>
    </div>
  );
}
