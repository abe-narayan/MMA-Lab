/**
 * CAMERAS - the four broadcast angles plus a hand-written pointer-drag orbit.
 *
 * Nothing is imported from `three/examples` or `three/addons`: the drag / wheel
 * handling below is the whole of the orbit control, so the bundle only ever
 * resolves the single `three` module.
 *
 *   orbit   free camera around the action, user-draggable
 *   top     near-vertical tactical view of the whole cage
 *   side    fixed low side angle, the classic broadcast hard camera
 *   follow  chase camera behind one fighter, pointed at the engagement
 */

import * as THREE from 'three';
import { CAGE_RADIUS, clamp, damp } from './arena';

export type CameraMode = 'orbit' | 'top' | 'side' | 'follow';

const DEFAULTS = {
  azimuth: 0.55,       // radians, 0 = looking from +Z
  elevation: 0.30,     // radians above the horizon
  distance: 6.4,
};

const LIMITS = {
  elevationMin: 0.05,
  elevationMax: 1.42,
  distanceMin: 2.6,
  distanceMax: 24,
};

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private mode: CameraMode = 'orbit';

  // User-controlled orbit state (shared by orbit and follow).
  private azimuth = DEFAULTS.azimuth;
  private elevation = DEFAULTS.elevation;
  private distance = DEFAULTS.distance;

  // Framing supplied by the renderer each frame.
  private focus = new THREE.Vector3(0, 1.1, 0);
  private spread = 2.5;
  private followPoint = new THREE.Vector3();
  private followLook = new THREE.Vector3();
  private hasFollow = false;

  // Smoothed camera state.
  private position = new THREE.Vector3(0, 4, 11);
  private lookAt = new THREE.Vector3(0, 1.1, 0);

  private shakeAmp = 0;
  private clockT = 0;

  // pointer state
  private el: HTMLElement | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private activePointer = -1;
  private prevTouchAction = '';

  private onPointerDown = (e: PointerEvent): void => {
    if (this.dragging) return;
    this.dragging = true;
    this.activePointer = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || e.pointerId !== this.activePointer) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.azimuth -= dx * 0.0065;
    this.elevation = clamp(this.elevation + dy * 0.005, LIMITS.elevationMin, LIMITS.elevationMax);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    this.dragging = false;
    this.activePointer = -1;
    try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const k = Math.exp(clamp(e.deltaY, -240, 240) * 0.0012);
    this.distance = clamp(this.distance * k, LIMITS.distanceMin, LIMITS.distanceMax);
  };

  constructor(el: HTMLElement, aspect = 1.6) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 200);
    this.camera.position.copy(this.position);
    this.attach(el);
  }

  // -------------------------------------------------------------- input

  private attach(el: HTMLElement): void {
    this.el = el;
    this.prevTouchAction = el.style.touchAction;
    el.style.touchAction = 'none';    // let us own drag gestures on the canvas
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private detach(): void {
    const el = this.el;
    if (!el) return;
    el.style.touchAction = this.prevTouchAction;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    this.el = null;
  }

  // -------------------------------------------------------------- API

  setMode(mode: CameraMode): void {
    this.mode = mode;
  }

  getMode(): CameraMode {
    return this.mode;
  }

  reset(): void {
    this.azimuth = DEFAULTS.azimuth;
    this.elevation = DEFAULTS.elevation;
    this.distance = DEFAULTS.distance;
  }

  /**
   * Where the action is this frame.
   * @param centre centroid of the fighters still in the bout
   * @param spread how far the furthest of them is from that centroid
   */
  setFocus(centre: THREE.Vector3, spread: number): void {
    this.focus.set(centre.x, 1.05, centre.z);
    this.spread = clamp(spread, 0.6, CAGE_RADIUS);
  }

  /**
   * Follow-camera inputs; pass null to fall back to the general focus. The
   * vectors are copied, so the caller can keep reusing its own scratch values.
   */
  setFollow(point: THREE.Vector3 | null, look: THREE.Vector3 | null): void {
    this.hasFollow = !!point;
    if (point) this.followPoint.copy(point);
    if (look) this.followLook.copy(look);
    else this.followLook.copy(this.focus);
  }

  /** Brief decaying camera shake. `intensity` is roughly 0..1. */
  shake(intensity: number): void {
    this.shakeAmp = Math.min(0.14, this.shakeAmp + clamp(intensity, 0, 1) * 0.055);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------- per frame

  /** Compute, smooth and apply the camera transform. `dt` is wall seconds. */
  update(dt: number): void {
    this.clockT += dt;

    const wantPos = new THREE.Vector3();
    const wantLook = new THREE.Vector3();
    let posLambda = 5.0;
    let lookLambda = 6.5;

    switch (this.mode) {
      case 'top': {
        // Near-vertical, with a small tilt so the scene keeps some depth and
        // the look-at never becomes degenerate with the up vector.
        const h = clamp(this.spread * 1.9 + 7.0, 8.5, 15);
        wantPos.set(this.focus.x * 0.35, h, this.focus.z * 0.35 + 1.1);
        wantLook.set(this.focus.x * 0.5, 0.35, this.focus.z * 0.5);
        posLambda = 3.0;
        break;
      }
      case 'side': {
        // Fixed hard camera on the +X side of the cage, at shoulder height.
        const d = clamp(this.spread * 0.9 + 8.2, 8.5, 13);
        wantPos.set(d, 2.35, this.focus.z * 0.25);
        wantLook.set(this.focus.x * 0.45, 1.12, this.focus.z * 0.45);
        posLambda = 3.2;
        break;
      }
      case 'follow': {
        const target = this.hasFollow ? this.followPoint : this.focus;
        const look = this.hasFollow ? this.followLook : this.focus;
        // Sit behind the followed fighter relative to whatever they are facing,
        // then let the user's drag rotate that offset.
        const bx = look.x - target.x;
        const bz = look.z - target.z;
        const behind = Math.atan2(bx, bz) + Math.PI;
        const az = behind + (this.azimuth - DEFAULTS.azimuth);
        const dist = clamp(this.distance * 0.42, 2.4, 7.5);
        const el = clamp(this.elevation, 0.12, 1.1);
        wantPos.set(
          target.x + Math.sin(az) * Math.cos(el) * dist,
          0.95 + Math.sin(el) * dist,
          target.z + Math.cos(az) * Math.cos(el) * dist
        );
        wantLook.set(
          (target.x + look.x) * 0.5,
          1.05,
          (target.z + look.z) * 0.5
        );
        posLambda = 4.2;
        lookLambda = 5.5;
        break;
      }
      case 'orbit':
      default: {
        // Pull back a little when the fighters are spread across the cage.
        const dist = clamp(this.distance + this.spread * 0.5, LIMITS.distanceMin, LIMITS.distanceMax);
        const el = this.elevation;
        wantPos.set(
          this.focus.x * 0.4 + Math.sin(this.azimuth) * Math.cos(el) * dist,
          0.9 + Math.sin(el) * dist,
          this.focus.z * 0.4 + Math.cos(this.azimuth) * Math.cos(el) * dist
        );
        wantLook.set(this.focus.x * 0.6, 1.05, this.focus.z * 0.6);
        break;
      }
    }

    this.position.x = damp(this.position.x, wantPos.x, posLambda, dt);
    this.position.y = damp(this.position.y, wantPos.y, posLambda, dt);
    this.position.z = damp(this.position.z, wantPos.z, posLambda, dt);
    this.lookAt.x = damp(this.lookAt.x, wantLook.x, lookLambda, dt);
    this.lookAt.y = damp(this.lookAt.y, wantLook.y, lookLambda, dt);
    this.lookAt.z = damp(this.lookAt.z, wantLook.z, lookLambda, dt);

    // Decaying shake. Deterministic waveform - nothing here uses Math.random.
    this.shakeAmp = damp(this.shakeAmp, 0, 7.5, dt);
    const s = this.shakeAmp;
    let ox = 0, oy = 0, oz = 0;
    if (s > 0.0008) {
      const t = this.clockT;
      ox = Math.sin(t * 47.3) * s;
      oy = Math.sin(t * 61.9 + 1.7) * s * 0.7;
      oz = Math.sin(t * 38.1 + 2.9) * s * 0.6;
    }

    this.camera.position.set(this.position.x + ox, this.position.y + oy, this.position.z + oz);
    this.camera.lookAt(this.lookAt);
  }

  dispose(): void {
    this.detach();
  }
}

/** Exposed for tests / debugging: the default orbit framing. */
export const CAMERA_DEFAULTS = DEFAULTS;
