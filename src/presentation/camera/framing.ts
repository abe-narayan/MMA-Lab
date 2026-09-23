/**
 * Framing: where to aim and how wide to open so a set of points sits inside a
 * chosen fraction of the frame.
 *
 * Camera convention (identical to three.js `camera.lookAt(target)` with world
 * up +Y, followed by `camera.rotateZ(rollRad)`): the lens looks from
 * `position` toward `target`, `fovDeg` is the vertical field of view, and the
 * horizon is level unless `rollRad` says otherwise.
 *
 * Work is done in *tangent space*: a point's (u, v) is (x/z, y/z) in camera
 * coordinates, so "inside a fraction s of the frame" is simply
 * |u| <= s·tan(fov/2)·aspect and |v| <= s·tan(fov/2).
 */
import type { CameraState } from '../contract';
import { add, cross, dot, norm, scale, sub, type V3 } from './math';

export interface Basis {
  fwd: V3;
  right: V3;
  up: V3;
}

const WORLD_UP: V3 = [0, 1, 0];

export function lookBasis(pos: V3, target: V3, roll = 0): Basis {
  let fwd = norm(sub(target, pos));
  // Straight up/down: nudge so lookAt stays defined (three.js does the same).
  if (Math.abs(fwd[1]) > 0.99999) fwd = norm([fwd[0] + 1e-4, fwd[1], fwd[2] + 1e-4]);
  const back = scale(fwd, -1);
  let right = norm(cross(WORLD_UP, back));
  let up = cross(back, right);
  if (roll !== 0) {
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    const r2: V3 = add(scale(right, c), scale(up, s));
    const u2: V3 = add(scale(right, -s), scale(up, c));
    right = r2;
    up = u2;
  }
  return { fwd, right, up };
}

/** Tangent-space coordinates of `p`; z <= 0 means behind the lens. */
export function tangent(pos: V3, b: Basis, p: V3): [number, number, number] {
  const d = sub(p, pos);
  const z = dot(d, b.fwd);
  const zz = Math.max(z, 1e-3);
  return [dot(d, b.right) / zz, dot(d, b.up) / zz, z];
}

/** Normalised device coordinates of `p` for a camera state (x, y in [-1, 1] on screen). */
export function projectNdc(state: CameraState, aspect: number, p: V3): [number, number, number] {
  const b = lookBasis(state.position, state.target, state.rollRad);
  const [u, v, z] = tangent(state.position, b, p);
  const t = Math.tan((state.fovDeg * Math.PI) / 360);
  return [u / (t * aspect), v / t, z];
}

/** The tan(half vertical fov) at which every point just touches the frame edge. */
export function requiredTanHalf(pos: V3, target: V3, pts: readonly V3[], aspect: number, roll = 0): number {
  const b = lookBasis(pos, target, roll);
  let need = 0;
  for (const p of pts) {
    const [u, v, z] = tangent(pos, b, p);
    if (z < 0.05) return Infinity;
    need = Math.max(need, Math.abs(u) / aspect, Math.abs(v));
  }
  return need;
}

export interface FramingGoal {
  target: V3;
  tanHalf: number;
}

/**
 * Aim at the centre of the points' angular bounding box, then open the lens
 * until they fill `safe` of the frame. `bias` moves the aim within the box, in
 * fractions of its half size ((0, 0.1) leaves a little more floor than sky).
 */
export function solveFraming(
  pos: V3, pts: readonly V3[], aspect: number, safe: number, bias: [number, number] = [0, 0],
): FramingGoal {
  if (pts.length === 0) return { target: add(pos, [0, 0, 1]), tanHalf: 0.3 };
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p[0]; cy += p[1]; cz += p[2];
  }
  let aim: V3 = [cx / pts.length, cy / pts.length, cz / pts.length];
  const depth = Math.max(0.5, Math.hypot(aim[0] - pos[0], aim[1] - pos[1], aim[2] - pos[2]));
  for (let iter = 0; iter < 3; iter++) {
    const b = lookBasis(pos, aim);
    let umin = Infinity;
    let umax = -Infinity;
    let vmin = Infinity;
    let vmax = -Infinity;
    for (const p of pts) {
      const [u, v] = tangent(pos, b, p);
      umin = Math.min(umin, u); umax = Math.max(umax, u);
      vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
    }
    const uc = (umin + umax) / 2 + bias[0] * (umax - umin) / 2;
    const vc = (vmin + vmax) / 2 + bias[1] * (vmax - vmin) / 2;
    const dir = norm(add(b.fwd, add(scale(b.right, uc), scale(b.up, vc))));
    aim = add(pos, scale(dir, depth));
  }
  const need = requiredTanHalf(pos, aim, pts, aspect);
  return { target: aim, tanHalf: need / safe };
}

export const tanHalfToFov = (t: number): number => (Math.atan(t) * 360) / Math.PI;
export const fovToTanHalf = (fovDeg: number): number => Math.tan((fovDeg * Math.PI) / 360);
