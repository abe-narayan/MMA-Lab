/**
 * ARENA 3D — the React wrapper over `Presenter3D` (docs/design/09 §1.3.2).
 *
 * Owns the presenter's lifecycle (mount on first render, dispose on unmount),
 * a ResizeObserver, and its own requestAnimationFrame loop. The loop runs even
 * while playback is paused, because the picture still moves when the fight
 * does not: the camera settles, temporal AA converges, a replay's depth of
 * field pulls focus. It reads the latest props through a ref, so a React
 * re-render per frame is not needed for the 3D view to animate.
 *
 * Opening a bout: build the set and bodies (`setBout`), pose the first frame,
 * then compile every material off the critical path (`warmUpAsync`) behind a
 * "Preparing broadcast…" card with a progress bar, and only then start the
 * frame loop; the card lifts after the first frames are drawn. Without this the first
 * frame compiled every shader synchronously (7 s on WebGPU, 25 s on WebGL2,
 * a frozen page). `window.__ttff` records the timings.
 *
 * Broadcast wiring (integration): the whole recording goes to the director
 * (`recording`), the instant replay on air comes with the playhead
 * (`getPlayhead().replayState`), the free/orbit cameras get pointer control,
 * and the on-picture graphics are `children` — a render function receives
 * the current camera shot for the shot label.
 *
 * Backend fallback: WebGPU, then WebGL2 (three does this inside the renderer),
 * then `onUnavailable`, which the Watch screen answers by showing the 2D view.
 *
 * `window.__presenter` exposes the live presenter for QA scripts.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SimEvent, TickSnapshot } from '../../sim';
import type {
  BoutPresentation, CameraRequest, CameraState, FrameInput, QualityLevel,
} from '../../presentation/contract';
import type { ReplayState, ShotKind } from '../../presentation/camera';
import { createPresenter, type Presenter } from '../../presentation/presenter';
import { SeekDetector } from '../replay/broadcast';

export interface Playhead {
  frame: TickSnapshot | null;
  next: TickSnapshot | null;
  alpha: number;
  replay: boolean;
  playbackRate: number;
  /** `FrameInput.events` for this frame (through `next.tick`); overrides the prop. */
  events?: readonly SimEvent[];
  /** The instant replay on air, for the director. */
  replayState?: ReplayState | null;
  /** Seek counter read at the same instant as the frame (one discontinuity per seek). */
  seekVersion?: number;
}

export interface Arena3DProps {
  bout: BoutPresentation;
  frame: TickSnapshot | null;
  next: TickSnapshot | null;
  alpha: number;
  /** Recent events, at least the last two seconds. */
  events: readonly SimEvent[];
  playbackRate: number;
  replay: boolean;
  /**
   * Read the playhead straight from the transport at render time. When given,
   * it takes precedence over frame/next/alpha/replay/playbackRate (and events,
   * seekVersion when it returns them), so the host need not re-render every
   * display frame just to move alpha.
   */
  getPlayhead?: () => Playhead;
  /** Bumped by the host on every seek; the next frame is a discontinuity. */
  seekVersion: number;
  /** The whole recorded bout, for the broadcast director's edit and replays. */
  recording?: { frames: readonly TickSnapshot[]; events: readonly SimEvent[] };
  camera: CameraRequest;
  quality: QualityLevel;
  renderScale?: number;
  debug: boolean;
  labels: boolean;
  /** Tick length in seconds, for the interpolated sim time. */
  tickSeconds: number;
  /** False while the Watch tab is hidden: the frame loop stops. */
  active?: boolean;
  onBackend?: (backend: 'webgpu' | 'webgl2') => void;
  /** The preset this machine should start on (stage/profiles.ts), once the renderer is up. */
  onRecommendedQuality?: (level: QualityLevel) => void;
  onUnavailable?: (reason: string) => void;
  /** The loading card has lifted and the broadcast is on screen. */
  onLive?: () => void;
  /**
   * Manual camera in broadcast mode (the Watch screen's camera keys): one of
   * the director's operators, or null for the director's own edit.
   */
  cameraOverride?: ShotKind | null;
  /** Transient status for the host (e.g. "GPU device lost, rebuilding"). */
  onNotice?: (message: string | null) => void;
  /** DOM overlays drawn over the picture (broadcast graphics); a function gets the camera shot. */
  children?: ReactNode | ((ctx: { shot: CameraState | null }) => ReactNode);
}

type BoutPhase = 'idle' | 'building' | 'compiling' | 'ready';

/** Frames to draw behind the loading card before revealing the picture. */
const REVEAL_AFTER_FRAMES = 3;

interface Ttff {
  mountMs: number;
  deviceMs?: number;
  boutMs?: number;
  compileMs?: number;
  sceneCompileMs?: number;
  postCompileMs?: number;
  firstFrameMs?: number;
  revealMs?: number;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function publishTtff(t: Ttff): void {
  (window as unknown as { __ttff?: Ttff }).__ttff = { ...t };
}

function inputFor(p: Arena3DProps & Playhead, tickSeconds: number, discontinuity: boolean): FrameInput | null {
  if (!p.frame) return null;
  const nextT = p.next?.t ?? p.frame.t + tickSeconds;
  return {
    frame: p.frame,
    next: p.next,
    alpha: p.alpha,
    simTime: p.frame.t + (nextT - p.frame.t) * p.alpha,
    events: p.events,
    playbackRate: p.playbackRate,
    replay: p.replayState !== undefined ? !!p.replayState || p.replay : p.replay,
    discontinuity,
  };
}

export function Arena3D(props: Arena3DProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const presenterRef = useRef<Presenter | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const ttffRef = useRef<Ttff>({ mountMs: now() });
  const [status, setStatus] = useState<'starting' | 'ready' | 'failed'>('starting');
  const [backend, setBackend] = useState<string>('');
  const [phase, setPhase] = useState<BoutPhase>('idle');
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [shot, setShot] = useState<CameraState | null>(null);
  // Bumped to rebuild the presenter from scratch (after a GPU device loss).
  const [generation, setGeneration] = useState(0);
  const lossesRef = useRef(0);

  const playhead = (): Arena3DProps & Playhead => {
    const p0 = propsRef.current;
    return p0.getPlayhead ? { ...p0, ...p0.getPlayhead() } : p0;
  };

  /** Give up on 3D: the host shows the 2D board with this reason. */
  const fail = (reason: string): void => {
    setStatus('failed');
    propsRef.current.onUnavailable?.(reason);
  };

  // ---- mount / dispose ----------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let disposed = false;
    const presenter = createPresenter();
    presenterRef.current = presenter;
    presenter.setQuality(propsRef.current.quality, propsRef.current.renderScale);
    ttffRef.current = { mountMs: now() };
    if (generation > 0) {
      setStatus('starting');
      setPhase('idle');
      setRevealed(false);
    }

    // Device / context loss (review M5): rebuild the renderer once; a second
    // loss (or a failed rebuild) falls back to the 2D board with the reason.
    const offLost = presenter.onDeviceLost((reason) => {
      if (disposed) return;
      lossesRef.current += 1;
      console.warn(`[Arena3D] ${reason}`);
      if (lossesRef.current <= 1) {
        propsRef.current.onNotice?.('The graphics device was reset; rebuilding the 3D view…');
        setGeneration((g) => g + 1);
      } else {
        fail(`${reason}; the device was lost twice`);
      }
    });

    presenter.mount(host).then(({ backend: b }) => {
      // Unmounted while the device was being created (React StrictMode mounts
      // twice in development): release the renderer that just arrived.
      if (disposed) { presenter.dispose(); return; }
      ttffRef.current.deviceMs = Math.round(now() - ttffRef.current.mountMs);
      setBackend(b);
      setStatus('ready');
      (window as unknown as { __presenter?: Presenter }).__presenter = presenter;
      propsRef.current.onBackend?.(b);
      if (propsRef.current.onRecommendedQuality) {
        presenter.recommendedQuality().then((rec) => {
          if (!disposed) propsRef.current.onRecommendedQuality?.(rec.level);
        }).catch(() => { /* keep the starting preset */ });
      }
    }).catch((err: unknown) => {
      if (disposed) return;
      fail(err instanceof Error ? err.message : String(err));
    });

    const ro = new ResizeObserver(() => presenter.resize());
    ro.observe(host);
    return () => {
      disposed = true;
      offLost();
      ro.disconnect();
      presenter.dispose();
      presenterRef.current = null;
      const w = window as unknown as { __presenter?: Presenter };
      if (w.__presenter === presenter) delete w.__presenter;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  // ---- bout: build, pose the first frame, compile, then go live -----------
  useEffect(() => {
    const presenter = presenterRef.current;
    if (!presenter || status !== 'ready') return;
    let cancelled = false;
    setPhase('building');
    setRevealed(false);
    setProgress(null);
    const t = ttffRef.current;
    const t0 = now();
    const rec = propsRef.current.recording;
    // setBout first: its synchronous part drops the old director, so the
    // recording is planned once, against the new arena (review L7).
    const building = presenter.setBout(props.bout);
    if (rec) presenter.setRecording(rec.frames, rec.events);
    building.then(async () => {
      if (cancelled || presenterRef.current !== presenter) return;
      t.boutMs = Math.round(now() - t0);
      setPhase('compiling');
      // Pose the opening frame so the camera, bodies and referee are where the
      // first picture will have them, then compile everything.
      const input = inputFor(playhead(), propsRef.current.tickSeconds, true);
      if (input) presenter.update(input, 0);
      const t1 = now();
      const w = await presenter.warmUpAsync((loaded, total) => {
        if (!cancelled && (loaded === total || loaded % 4 === 0)) setProgress({ loaded, total });
      });
      if (cancelled) return;
      t.compileMs = Math.round(now() - t1);
      t.sceneCompileMs = w.sceneMs;
      t.postCompileMs = w.postMs;
      publishTtff(t);
      setPhase('ready');
    }).catch((err: unknown) => {
      // Review M3: a throw while building or compiling used to leave the
      // loading card up for good. Show the 2D board with the reason instead.
      console.error('[Arena3D] setBout failed', err);
      if (cancelled || presenterRef.current !== presenter) return;
      fail(`the 3D scene could not be built (${err instanceof Error ? err.message : String(err)})`);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bout, status]);

  // A new recording for the same presentation (rare) goes straight through.
  useEffect(() => {
    const rec = props.recording;
    if (rec && status === 'ready') presenterRef.current?.setRecording(rec.frames, rec.events);
  }, [props.recording, status]);

  // ---- settings -----------------------------------------------------------
  // `status` is a dependency so a rebuilt presenter (device loss) gets them too.
  useEffect(() => {
    presenterRef.current?.setQuality(props.quality, props.renderScale);
  }, [props.quality, props.renderScale, status]);

  useEffect(() => {
    presenterRef.current?.setCamera(props.camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.camera.mode, props.camera.followId, status]);

  useEffect(() => {
    presenterRef.current?.setCameraOverride(props.cameraOverride ?? null);
  }, [props.cameraOverride, status]);

  useEffect(() => {
    presenterRef.current?.setFlags({ debug: props.debug, labels: props.labels });
  }, [props.debug, props.labels, status]);

  // Free and orbit cameras: drag to orbit, right/shift-drag to pan, wheel to zoom.
  useEffect(() => {
    const host = hostRef.current;
    const presenter = presenterRef.current;
    if (!host || !presenter || phase !== 'ready') return undefined;
    if (props.camera.mode !== 'free' && props.camera.mode !== 'orbit') return undefined;
    return presenter.attachFreeCamera(host);
  }, [props.camera.mode, phase]);

  // ---- the frame loop -----------------------------------------------------
  useEffect(() => {
    if (status !== 'ready' || phase !== 'ready' || props.active === false) return undefined;
    let raf = 0;
    let last = now();
    let frames = 0;
    const seek = new SeekDetector();
    let lastShotName = '';
    const step = (t: number): void => {
      raf = requestAnimationFrame(step);
      const presenter = presenterRef.current;
      const p = playhead();
      if (!presenter || !p.frame) return;
      const realDt = Math.min(0.1, Math.max(0, (t - last) / 1000));
      last = t;
      const discontinuity = seek.next(p.frame.tick, p.seekVersion);
      if (p.replayState !== undefined) presenter.setReplay(p.replayState);
      const input = inputFor(p, p.tickSeconds, discontinuity);
      if (!input) return;
      presenter.update(input, realDt);
      presenter.render();
      frames++;
      const tt = ttffRef.current;
      if (frames === 1) tt.firstFrameMs = Math.round(now() - tt.mountMs);
      if (frames === REVEAL_AFTER_FRAMES) {
        tt.revealMs = Math.round(now() - tt.mountMs);
        publishTtff(tt);
        setRevealed(true);
        propsRef.current.onLive?.();
      }
      // The graphics only need the shot when it changes.
      const s = presenter.shot();
      if (s && (s.cut || s.shotName !== lastShotName)) {
        lastShotName = s.shotName;
        setShot({ ...s });
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [status, phase, props.active]);

  const loading = status === 'starting' || (status === 'ready' && !revealed);
  const pct = progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : null;
  const hint = status === 'starting' ? 'Starting the graphics device'
    : phase === 'building' ? 'Building the arena and the fighters'
      : phase === 'compiling' ? (pct !== null ? `Compiling shaders · ${pct}%` : 'Compiling shaders')
        : 'First frames';
  const children = typeof props.children === 'function' ? props.children({ shot }) : props.children;

  return (
    <div
      className="watch-stage watch-stage--3d"
      // flexShrink 0: the Watch column is a flex container, and without an
      // intrinsic size (the canvas is absolutely positioned) the stage would
      // otherwise collapse to its min-height instead of keeping 16:9.
      style={{ aspectRatio: '16 / 9', background: '#050608', flexShrink: 0 }}
      data-backend={backend || undefined}
      data-phase={revealed ? 'live' : phase}
    >
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {revealed ? children : null}
      {loading ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#050608',
            color: '#c9d1da', zIndex: 5,
          }}
        >
          <div style={{ display: 'grid', gap: 10, justifyItems: 'center', fontFamily: 'inherit' }}>
            <span style={{ letterSpacing: '0.18em', fontSize: 13, textTransform: 'uppercase', color: '#e2c26b' }}>
              Preparing broadcast…
            </span>
            {/*
              A compositor-driven sweep (a CSS transform animation): it keeps
              moving even while the main thread is blocked, e.g. when a WebGL2
              driver compiles shaders on the first draw.
            */}
            <style>{'@keyframes boutlab-sweep { from { transform: translateX(-100%); } to { transform: translateX(320%); } }'}</style>
            <div style={{ width: 220, height: 2, background: '#12161b', borderRadius: 1, overflow: 'hidden' }}>
              <div
                style={{
                  width: '30%', height: '100%', background: 'linear-gradient(90deg, transparent, #8a939e, transparent)',
                  animation: 'boutlab-sweep 1.1s linear infinite', willChange: 'transform',
                }}
              />
            </div>
            <div style={{ width: 220, height: 3, background: '#1b2027', borderRadius: 2, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%', background: '#e2c26b', transition: 'width 120ms linear',
                  width: `${phase === 'building' ? 8 : phase === 'compiling' ? 10 + (pct ?? 0) * 0.85 : phase === 'ready' ? 100 : 3}%`,
                }}
              />
            </div>
            <span style={{ fontSize: 12, color: '#8a939e' }}>{hint}</span>
          </div>
        </div>
      ) : null}
      {status === 'failed' ? (
        <p className="empty" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', margin: 0, color: '#9aa3ad' }}>
          3D view unavailable on this device.
        </p>
      ) : null}
    </div>
  );
}
