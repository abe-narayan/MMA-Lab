/**
 * FREE CAMERA — the viewer's own lens (docs/design/08 §7.4).
 *
 * Mouse: left-drag orbits, right-drag (or shift-drag) pans, the wheel zooms.
 * Touch: one finger orbits, two fingers pinch to zoom and drag to pan.
 * Keyboard (when the element has focus): arrows orbit, +/- zoom.
 *
 * `orbit` keeps the pivot on the fighters (it follows the pair, the user's pan
 * is an offset); `free` leaves the pivot wherever the user put it. Either way
 * the controller only writes camera state — never the fight — and the
 * director still keeps the lens inside the building.
 */
import type { CameraState } from '../contract';
import { add, clamp, type V3 } from './math';

export class FreeCameraState {
  mode: 'free' | 'orbit' = 'orbit';
  /** Azimuth of the lens around the pivot (sim convention), radians. */
  yaw = Math.PI + 0.4;
  /** Elevation above the horizon, radians. */
  pitch = 0.42;
  distance = 8.5;
  fovDeg = 40;
  /** Free mode: the point orbited. */
  pivot: V3 = [0, 1, 0];
  /** Orbit mode: user offset from the pair's midpoint. */
  offset: V3 = [0, 1, 0];

  initFrom(s: CameraState, mode: 'free' | 'orbit'): void {
    this.mode = mode;
    const dx = s.position[0] - s.target[0];
    const dy = s.position[1] - s.target[1];
    const dz = s.position[2] - s.target[2];
    const d = Math.hypot(dx, dy, dz) || 8;
    this.distance = clamp(d, 1.5, 25);
    this.yaw = Math.atan2(dx, dz);
    this.pitch = clamp(Math.asin(clamp(dy / d, -1, 1)), 0.03, 1.5);
    this.fovDeg = clamp(s.fovDeg, 20, 75);
    this.pivot = [...s.target] as V3;
    this.offset = [0, clamp(s.target[1], 0.3, 2), 0];
  }

  orbitBy(dYaw: number, dPitch: number): void {
    this.yaw -= dYaw;
    this.pitch = clamp(this.pitch + dPitch, 0.03, 1.5);
  }

  /** Pan by a fraction of the view height (dx right, dy up). */
  panBy(fx: number, fy: number): void {
    const h = 2 * this.distance * Math.tan((this.fovDeg * Math.PI) / 360);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const move: V3 = [-rx * fx * h, fy * h, -rz * fx * h];
    if (this.mode === 'free') this.pivot = add(this.pivot, move);
    else {
      this.offset = add(this.offset, move);
      this.offset[1] = clamp(this.offset[1], 0.1, 4);
      this.offset[0] = clamp(this.offset[0], -6, 6);
      this.offset[2] = clamp(this.offset[2], -6, 6);
    }
    this.pivot[1] = clamp(this.pivot[1], 0.1, 6);
  }

  zoomBy(factor: number): void {
    this.distance = clamp(this.distance * factor, 1.5, 25);
  }
}

export function createFreeCameraState(): FreeCameraState {
  return new FreeCameraState();
}

export function freeCameraPose(
  s: FreeCameraState, kind: 'free' | 'orbit', mid: V3, _t: number,
): { position: V3; target: V3; fovDeg: number } {
  const pivot: V3 = kind === 'orbit' ? add([mid[0], 0, mid[2]], s.offset) : s.pivot;
  const cp = Math.cos(s.pitch);
  const position: V3 = [
    pivot[0] + Math.sin(s.yaw) * cp * s.distance,
    pivot[1] + Math.sin(s.pitch) * s.distance,
    pivot[2] + Math.cos(s.yaw) * cp * s.distance,
  ];
  return { position, target: pivot, fovDeg: s.fovDeg };
}

/**
 * Wire pointer, wheel and key input on `el` to a free-camera state. Returns a
 * detach function. `el` gets `touch-action: none` so a pinch zooms the camera,
 * not the page.
 */
export function attachFreeCamera(el: HTMLElement, state: FreeCameraState): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let panMode = false;
  let pinch = 0;
  const prevTouch = el.style.touchAction;
  el.style.touchAction = 'none';

  const h = (): number => Math.max(1, el.clientHeight);
  const centroid = (): { x: number; y: number } => {
    let x = 0;
    let y = 0;
    for (const p of pointers.values()) {
      x += p.x;
      y += p.y;
    }
    return { x: x / pointers.size, y: y / pointers.size };
  };
  const spread = (): number => {
    const ps = [...pointers.values()];
    return ps.length < 2 ? 0 : Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
  };

  const onDown = (e: PointerEvent): void => {
    el.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    panMode = e.button === 2 || e.shiftKey;
    pinch = spread();
  };
  const onMove = (e: PointerEvent): void => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size >= 2) {
      const c0 = centroid();
      p.x = e.clientX;
      p.y = e.clientY;
      const c1 = centroid();
      const s = spread();
      if (pinch > 0 && s > 0) state.zoomBy(pinch / s);
      pinch = s;
      state.panBy((c1.x - c0.x) / h(), (c1.y - c0.y) / h());
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (panMode) state.panBy(dx / h(), dy / h());
    else state.orbitBy((dx / h()) * Math.PI, (dy / h()) * Math.PI * 0.6);
  };
  const onUp = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    pinch = spread();
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    state.zoomBy(Math.exp(clamp(e.deltaY, -200, 200) * 0.0015));
  };
  const onKey = (e: KeyboardEvent): void => {
    const step = 0.08;
    if (e.key === 'ArrowLeft') state.orbitBy(-step, 0);
    else if (e.key === 'ArrowRight') state.orbitBy(step, 0);
    else if (e.key === 'ArrowUp') state.orbitBy(0, step);
    else if (e.key === 'ArrowDown') state.orbitBy(0, -step);
    else if (e.key === '+' || e.key === '=') state.zoomBy(0.9);
    else if (e.key === '-') state.zoomBy(1.1);
    else return;
    e.preventDefault();
  };
  const onMenu = (e: Event): void => e.preventDefault();

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('keydown', onKey);
  el.addEventListener('contextmenu', onMenu);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('contextmenu', onMenu);
    el.style.touchAction = prevTouch;
  };
}
