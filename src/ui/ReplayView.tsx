/**
 * REPLAY TAB
 *
 * Owns three things and nothing else:
 *   1. loading a bout (off the render path - re-running the simulation costs
 *      roughly 50-300 ms of CPU, so the loading state paints first and the work
 *      happens in a later task),
 *   2. the three.js animation loop, which is imperative and never re-renders
 *      React more often than the frame counter actually changes,
 *   3. the keyboard transport.
 *
 * Everything the viewer reads lives in Hud / Timeline / Controls.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArenaRenderer, type CameraMode } from '../render';
import { loadReplay, ReplayPlayer, type LoadedReplay } from '../replay/player';
import { recordBout, boutSeed, type ReplayFile } from '../engine/recorder';
import { deriveAttributes } from '../engine/fighter';
import { DEFAULT_PARAMS } from '../engine/params';
import { REPLAY_INDEX, MASTER_SEED } from '../data/replays';
import { Controls, FORMATS, SPEEDS, BOUT_COUNT, clock } from './Controls';
import { Hud } from './Hud';
import { Timeline } from './Timeline';

export { FORMATS, SPEEDS, BOUT_COUNT, clock };

export interface ReplayViewProps {
  opponents: number;
  boutIndex: number;
  /** False while another tab is showing: the loop stops touching WebGL. */
  active: boolean;
  onChangeOpponents(n: number): void;
  onChangeBout(n: number): void;
}

type Status = 'loading' | 'ready' | 'error';
type Source = 'recorded' | 'recomputed';

/**
 * A bout that is not in the generated index is recomputed from its canonical
 * seed. That is the same bout - the engine is a pure function of the seed - it
 * is simply simulated again rather than read from the bundle.
 */
function resolveReplay(opponents: number, index: number): { file: ReplayFile; source: Source } {
  const list = REPLAY_INDEX[opponents];
  if (list && list.length) {
    const hit = list.find((f) => f.analytics && f.analytics.index === index) ?? list[index - 1];
    if (hit) return { file: hit, source: 'recorded' };
  }
  return {
    file: recordBout(index, { seed: boutSeed(MASTER_SEED, opponents, index), opponents }),
    source: 'recomputed',
  };
}

export function ReplayView(props: ReplayViewProps) {
  const { opponents, boutIndex, active, onChangeOpponents, onChangeBout } = props;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<ArenaRenderer | null>(null);
  const playerRef = useRef<ReplayPlayer | null>(null);
  const lastFrameRef = useRef(-1);
  const lastPlayingRef = useRef(false);
  const wasPlayingRef = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;

  const [status, setStatus] = useState<Status>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedReplay | null>(null);
  const [source, setSource] = useState<Source>('recomputed');
  const [loadMs, setLoadMs] = useState(0);

  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [camera, setCamera] = useState<CameraMode>('orbit');
  const [followId, setFollowId] = useState(0);

  // ----------------------------------------------------------- render loop
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    let renderer: ArenaRenderer | null = null;
    try {
      renderer = new ArenaRenderer(el);
      rendererRef.current = renderer;
    } catch (err) {
      setLoadError(`3D view unavailable: ${(err as Error).message}`);
    }

    const ro = new ResizeObserver(() => {
      try {
        rendererRef.current?.resize();
      } catch {
        /* a resize during teardown is harmless */
      }
    });
    ro.observe(el);

    let raf = 0;
    let last = performance.now();
    let broken = false;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;

      const p = playerRef.current;
      const r = rendererRef.current;
      if (!p || !activeRef.current) return;

      const alpha = p.advance(dt);
      const frame = p.current;
      if (r && frame && !broken) {
        const next = p.frames[p.frame + 1] ?? null;
        try {
          r.update(frame, next, alpha);
          r.render();
        } catch (err) {
          broken = true;
          setLoadError(`3D view stopped: ${(err as Error).message}`);
        }
      }

      if (p.frame !== lastFrameRef.current) {
        lastFrameRef.current = p.frame;
        setFrameIndex(p.frame);
      }
      if (p.playing !== lastPlayingRef.current) {
        lastPlayingRef.current = p.playing;
        wasPlayingRef.current = p.playing;
        setPlaying(p.playing);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      rendererRef.current = null;
      try {
        renderer?.dispose();
      } catch {
        /* dispose is best-effort on teardown */
      }
      while (el.firstChild) el.removeChild(el.firstChild);
    };
  }, []);

  // Re-measure when this tab comes back into view (it had zero size while hidden).
  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => {
      try {
        rendererRef.current?.resize();
      } catch {
        /* non-fatal */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [active]);

  // ------------------------------------------------------------- bout load
  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    playerRef.current = null;
    lastFrameRef.current = -1;
    setStatus('loading');
    setLoadError(null);

    // Paint the loading state first, then do the ~50-300 ms of simulation in a
    // later task so the frame that shows "loading" is never the frame that
    // blocks.
    const raf = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        const t0 = performance.now();
        try {
          const { file, source: src } = resolveReplay(opponents, boutIndex);
          const next = loadReplay(file);
          if (cancelled) return;

          const player = new ReplayPlayer(next);
          player.speed = speed;
          playerRef.current = player;

          const teams = next.fighterLabels.map((_, i) => (i === 0 ? 'A' : 'B') as 'A' | 'B');
          try {
            rendererRef.current?.setFighters(next.fighterLabels, teams);
            rendererRef.current?.setFollowTarget(0);
            rendererRef.current?.setCameraMode(camera);
          } catch (err) {
            setLoadError(`3D view error: ${(err as Error).message}`);
          }

          setLoaded(next);
          setSource(src);
          setFollowId(0);
          setFrameIndex(0);
          setLoadMs(Math.round(performance.now() - t0));
          setStatus('ready');

          if (wasPlayingRef.current) player.play();
          lastPlayingRef.current = player.playing;
          setPlaying(player.playing);
        } catch (err) {
          if (cancelled) return;
          setLoadError((err as Error).message);
          setStatus('error');
        }
      }, 0);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
    // `speed` and `camera` are read as initial values only; changing them is
    // handled by their own effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opponents, boutIndex]);

  useEffect(() => {
    if (playerRef.current) playerRef.current.speed = speed;
  }, [speed]);

  useEffect(() => {
    try {
      rendererRef.current?.setCameraMode(camera);
    } catch {
      /* non-fatal */
    }
  }, [camera]);

  useEffect(() => {
    try {
      rendererRef.current?.setFollowTarget(followId);
    } catch {
      /* non-fatal */
    }
  }, [followId]);

  // --------------------------------------------------------------- transport
  const sync = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    lastFrameRef.current = p.frame;
    lastPlayingRef.current = p.playing;
    wasPlayingRef.current = p.playing;
    setFrameIndex(p.frame);
    setPlaying(p.playing);
  }, []);

  const toggle = useCallback(() => {
    playerRef.current?.toggle();
    sync();
  }, [sync]);

  const restart = useCallback(() => {
    playerRef.current?.restart();
    sync();
  }, [sync]);

  const step = useCallback(
    (n: number) => {
      playerRef.current?.stepBy(n);
      sync();
    },
    [sync],
  );

  const seek = useCallback(
    (frame: number) => {
      playerRef.current?.seek(frame);
      sync();
    },
    [sync],
  );

  const randomBout = useCallback(() => {
    onChangeBout(1 + Math.floor(Math.random() * BOUT_COUNT));
  }, [onChangeBout]);

  // Keyboard transport. Ignored while a form control has focus so that typing a
  // bout number never plays the replay.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          step(e.shiftKey ? -10 : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          step(e.shiftKey ? 10 : 1);
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          restart();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, toggle, step, restart]);

  // ------------------------------------------------------------- derived data
  const frame = loaded ? loaded.frames[Math.min(frameIndex, loaded.frames.length - 1)] : null;
  const totalFrames = loaded ? loaded.frames.length : 0;

  const teams = useMemo<('A' | 'B')[]>(
    () => (loaded ? loaded.fighterLabels.map((_, i) => (i === 0 ? 'A' : 'B')) : []),
    [loaded],
  );

  /** Per-fighter stamina pool and stoppage threshold, for the HUD meters. */
  const scales = useMemo(() => {
    if (!loaded) return [];
    const params = loaded.file.paramOverrides
      ? { ...DEFAULT_PARAMS, ...loaded.file.paramOverrides }
      : DEFAULT_PARAMS;
    const a = deriveAttributes(loaded.file.profiles.a, params);
    const b = deriveAttributes(loaded.file.profiles.b, params);
    return loaded.fighterLabels.map((_, i) => {
      const attr = i === 0 ? a : b;
      return { staminaMax: attr.staminaMax, durability: attr.durability };
    });
  }, [loaded]);

  /** Index of the latest event at or before the playhead. */
  const currentEventIndex = useMemo(() => {
    if (!loaded || !frame) return -1;
    const ev = loaded.events;
    let lo = 0;
    let hi = ev.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ev[mid].tick <= frame.tick) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }, [loaded, frame]);

  const busy = status === 'loading';
  const result = loaded?.file.result;

  return (
    <div className="replay">
      <div className="stage-col">
        <div className="provenance">
          <span className="prov-title">
            1v{opponents} &middot; bout {boutIndex}
          </span>

          {loaded ? (
            <>
              <span className={`badge ${loaded.verified ? 'badge--ok' : 'badge--bad'}`}>
                {loaded.verified ? 'verified' : 'digest mismatch'}
              </span>
              <span className="badge badge--info">{source}</span>
              <span className="chip" title="The seed the engine was run from">
                <b>seed</b>
                <span>{loaded.file.seed}</span>
              </span>
              <span className="chip" title="Fingerprint of the whole per-tick state stream">
                <b>digest</b>
                <span>{loaded.digest}</span>
              </span>
              <span className="chip">
                <b>ticks</b>
                <span>{loaded.frames.length.toLocaleString()}</span>
              </span>
              <span className="chip">
                <b>load</b>
                <span>{loadMs} ms</span>
              </span>
              {result ? (
                <span className="chip">
                  <b>result</b>
                  <span>
                    {result.winner === 'draw' ? 'draw' : `${result.winner} wins`} &middot;{' '}
                    {result.method} &middot; R{result.round} {clock(result.timeSeconds)}
                  </span>
                </span>
              ) : null}
            </>
          ) : (
            <span className="badge badge--info">{busy ? 'simulating' : 'no bout'}</span>
          )}
        </div>

        <div className="stage-wrap">
          <div className="stage-canvas" ref={stageRef} aria-hidden="true" />

          {frame && !busy ? (
            <div className="stage-scorebug">
              <span className="rd">R{frame.round}</span>
              <span className="ck">{clock(frame.roundTime)}</span>
              <span className="ph">{frame.phase}</span>
            </div>
          ) : null}

          {busy ? (
            <div className="stage-overlay">
              <span>Simulating bout {boutIndex} &middot; 1v{opponents}</span>
              <div className="loader" role="progressbar" aria-label="Loading bout">
                <span />
              </div>
              <p>
                Replays store a seed, not frames. The engine is re-run from that seed to rebuild
                every tick, then the result is checked against the recorded digest.
              </p>
            </div>
          ) : null}

          {status === 'error' ? (
            <div className="stage-overlay">
              <span>Bout could not be loaded</span>
              <p>{loadError ?? 'Unknown error.'}</p>
            </div>
          ) : null}

          <p className="visually-hidden" aria-live="polite">
            {busy
              ? `Loading bout ${boutIndex}`
              : frame
                ? `Round ${frame.round}, ${clock(frame.roundTime)}, frame ${frameIndex + 1} of ${totalFrames}`
                : ''}
          </p>
        </div>

        {loadError && status !== 'error' ? (
          <p className="disclaimer" role="status">
            <b>Note</b>
            <span>{loadError}</span>
          </p>
        ) : null}

        <Controls
          opponents={opponents}
          boutIndex={boutIndex}
          boutCount={BOUT_COUNT}
          playing={playing}
          frame={frameIndex}
          totalFrames={totalFrames}
          seconds={frame ? frame.t : 0}
          durationSeconds={loaded ? loaded.durationSeconds : 0}
          speed={speed}
          camera={camera}
          followId={followId}
          labels={loaded ? loaded.fighterLabels : []}
          teams={teams}
          disabled={busy || !loaded}
          onChangeOpponents={onChangeOpponents}
          onChangeBout={onChangeBout}
          onRandomBout={randomBout}
          onToggle={toggle}
          onRestart={restart}
          onStep={step}
          onSeek={seek}
          onChangeSpeed={setSpeed}
          onChangeCamera={setCamera}
          onResetCamera={() => {
            try {
              rendererRef.current?.resetCamera();
            } catch {
              /* non-fatal */
            }
          }}
          onChangeFollow={setFollowId}
        />
      </div>

      <div className="side-col">
        <Hud
          frame={frame}
          labels={loaded ? loaded.fighterLabels : []}
          teams={teams}
          scales={scales}
          totalFrames={totalFrames}
          frameIndex={frameIndex}
          loading={busy}
        />

        <Timeline
          events={loaded ? loaded.events : []}
          eventFrameIndex={loaded ? loaded.eventFrameIndex : []}
          currentIndex={currentEventIndex}
          teams={teams}
          loading={busy}
          onSeek={seek}
        />
      </div>
    </div>
  );
}
