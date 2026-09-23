/**
 * MOTION-CAPTURE SEAM. The procedural animator stands on its own; when the
 * asset pipeline (`static/assets/motion/`, loader in `src/presentation/assets/`)
 * provides clips retargeted onto the canonical skeleton, they plug in here.
 *
 * How a clip is used (effector retargeting, so a clip never fights the IK):
 *   1. the clip is time-warped so its `contact` marker lands on the recorded
 *      contact instant (`warpClipTime`), with separate rates before and after
 *      contact (docs/design/08 §5.4), clamped to [0.6, 1.6];
 *   2. it is sampled onto the canonical skeleton at the fighter's rest
 *      proportions and forward-kinematised;
 *   3. its TORSO (pelvis yaw/pitch/roll and spine) replaces the procedural
 *      L1 torso curves, and its striking-hand / foot trajectory RELATIVE TO THE
 *      CHEST replaces the procedural path — then the same aim IK as the
 *      procedural strike pulls the weapon onto the target at contact, and the
 *      footwork layer keeps planted feet locked.
 *
 * Nothing registers a library yet; `clipFor` returns null and the procedural
 * path runs. The interface is deliberately small so the loader can implement
 * it without importing animator internals.
 */
import type { Pose } from '../rig/skeleton';

export interface ClipMarkers {
  /** Normalised clip time of the moment of impact (strikes). */
  contact?: number;
  /** End of the wind-up. */
  windupEnd?: number;
  /** Guard restored. */
  recoverEnd?: number;
}

export interface MotionClip {
  id: string;
  durationS: number;
  markers: ClipMarkers;
  /** e.g. 'tech.jab', 'stance.orthodox', 'footwork.advance', 'tier.novice'. */
  tags: readonly string[];
  /** Mirrored for southpaw by the loader, or mirror at sample time. */
  stance: 'orthodox' | 'southpaw' | 'any';
  /** Sample at clip seconds into a canonical-skeleton pose (root in clip space). */
  sample(tS: number, out: Pose): void;
}

export interface ClipQuery {
  technique?: string;
  family?: string;
  locomotion?: 'idle' | 'advance' | 'retreat' | 'circleL' | 'circleR';
  stance: 'orthodox' | 'southpaw';
  tier: number;
}

export interface ClipLibrary {
  find(q: ClipQuery): MotionClip | null;
}

let library: ClipLibrary | null = null;

export function registerClipLibrary(lib: ClipLibrary | null): void {
  library = lib;
}

export function clipFor(q: ClipQuery): MotionClip | null {
  return library ? library.find(q) : null;
}

/**
 * Clip seconds for sim time `nowMs` of an action whose commit/contact/end are
 * known: the contact marker lands exactly on `contactMs`.
 */
export function warpClipTime(clip: MotionClip, commitMs: number, contactMs: number, endMs: number, nowMs: number): number {
  const c = (clip.markers.contact ?? 0.4) * clip.durationS;
  const clampRate = (r: number): number => Math.min(1.6, Math.max(0.6, r));
  if (nowMs <= contactMs) {
    const rate = clampRate(c / Math.max(1e-3, (contactMs - commitMs) / 1000));
    return Math.max(0, c - ((contactMs - nowMs) / 1000) * rate);
  }
  const rate = clampRate((clip.durationS - c) / Math.max(1e-3, (endMs - contactMs) / 1000));
  return Math.min(clip.durationS, c + ((nowMs - contactMs) / 1000) * rate);
}
