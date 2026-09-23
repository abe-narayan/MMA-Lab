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
 * Backend fallback: WebGPU, then WebGL2 (three does this inside the renderer),
 * then `onUnavailable`, which the Watch screen answers by showing the 2D view.
 *
 * `window.__presenter` exposes the live presenter for QA scripts.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SimEvent, TickSnapshot } from '../../sim';
import type { BoutPresentation, CameraRequest, FrameInput, QualityLevel } from '../../presentation/contract';
import { createPresenter, type Presenter } from '../../presentation/presenter';

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
   * it takes precedence over frame/next/alpha/replay/playbackRate, so the host
   * need not re-render every display frame just to move alpha.
   */
  getPlayhead?: () => {
    frame: TickSnapshot | null; next: TickSnapshot | null; alpha: number; replay: boolean; playbackRate: number;
  };
  /** Bumped by the host on every seek; the next frame is a discontinuity. */
  seekVersion: number;
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
  onUnavailable?: (reason: string) => void;
  /** DOM overlays drawn over the picture (broadcast graphics). */
  children?: ReactNode;
}

/** A forward jump larger than this many frames is treated as a seek. */
const MAX_CONTINUOUS_JUMP = 12;

export function Arena3D(props: Arena3DProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const presenterRef = useRef<Presenter | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [status, setStatus] = useState<'starting' | 'ready' | 'failed'>('starting');
  const [backend, setBackend] = useState<string>('');
  const [boutReady, setBoutReady] = useState(false);

  // ---- mount / dispose ----------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let disposed = false;
    const presenter = createPresenter();
    presenterRef.current = presenter;
    presenter.setQuality(propsRef.current.quality, propsRef.current.renderScale);

    presenter.mount(host).then(({ backend: b }) => {
      // Unmounted while the device was being created (React StrictMode mounts
      // twice in development): release the renderer that just arrived.
      if (disposed) { presenter.dispose(); return; }
      setBackend(b);
      setStatus('ready');
      (window as unknown as { __presenter?: Presenter }).__presenter = presenter;
      propsRef.current.onBackend?.(b);
    }).catch((err: unknown) => {
      if (disposed) return;
      setStatus('failed');
      propsRef.current.onUnavailable?.(err instanceof Error ? err.message : String(err));
    });

    const ro = new ResizeObserver(() => presenter.resize());
    ro.observe(host);
    return () => {
      disposed = true;
      ro.disconnect();
      presenter.dispose();
      presenterRef.current = null;
      const w = window as unknown as { __presenter?: Presenter };
      if (w.__presenter === presenter) delete w.__presenter;
    };
  }, []);

  // ---- bout ---------------------------------------------------------------
  useEffect(() => {
    const presenter = presenterRef.current;
    if (!presenter || status !== 'ready') return;
    let cancelled = false;
    setBoutReady(false);
    presenter.setBout(props.bout).then(() => {
      if (cancelled) return;
      presenter.warmUp();
      setBoutReady(true);
    }).catch((err: unknown) => {
      console.error('[Arena3D] setBout failed', err);
    });
    return () => { cancelled = true; };
  }, [props.bout, status]);

  // ---- settings -----------------------------------------------------------
  useEffect(() => {
    presenterRef.current?.setQuality(props.quality, props.renderScale);
  }, [props.quality, props.renderScale]);

  useEffect(() => {
    presenterRef.current?.setCamera(props.camera);
  }, [props.camera.mode, props.camera.followId]);

  useEffect(() => {
    presenterRef.current?.setFlags({ debug: props.debug, labels: props.labels });
  }, [props.debug, props.labels]);

  // ---- the frame loop -----------------------------------------------------
  useEffect(() => {
    if (status !== 'ready' || !boutReady || props.active === false) return undefined;
    let raf = 0;
    let last = performance.now();
    let lastTick = -1;
    let lastSeek = -1;
    const step = (now: number): void => {
      raf = requestAnimationFrame(step);
      const presenter = presenterRef.current;
      const props0 = propsRef.current;
      const p = props0.getPlayhead ? { ...props0, ...props0.getPlayhead() } : props0;
      if (!presenter || !p.frame) return;
      const realDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const tick = p.frame.tick;
      const discontinuity = lastTick < 0
        || p.seekVersion !== lastSeek
        || tick < lastTick
        || tick - lastTick > MAX_CONTINUOUS_JUMP;
      lastTick = tick;
      lastSeek = p.seekVersion;
      const nextT = p.next?.t ?? p.frame.t + p.tickSeconds;
      const input: FrameInput = {
        frame: p.frame,
        next: p.next,
        alpha: p.alpha,
        simTime: p.frame.t + (nextT - p.frame.t) * p.alpha,
        events: p.events,
        playbackRate: p.playbackRate,
        replay: p.replay,
        discontinuity,
      };
      presenter.update(input, realDt);
      presenter.render();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [status, boutReady, props.active]);

  return (
    <div
      className="watch-stage watch-stage--3d"
      // flexShrink 0: the Watch column is a flex container, and without an
      // intrinsic size (the canvas is absolutely positioned) the stage would
      // otherwise collapse to its min-height instead of keeping 16:9.
      style={{ aspectRatio: '16 / 9', background: '#050608', flexShrink: 0 }}
      data-backend={backend || undefined}
    >
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {status === 'starting' || (status === 'ready' && !boutReady) ? (
        <p className="empty" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', margin: 0, color: '#9aa3ad' }}>
          Setting up the arena…
        </p>
      ) : null}
      {status === 'failed' ? (
        <p className="empty" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', margin: 0, color: '#9aa3ad' }}>
          3D view unavailable on this device.
        </p>
      ) : null}
      {props.children}
    </div>
  );
}
