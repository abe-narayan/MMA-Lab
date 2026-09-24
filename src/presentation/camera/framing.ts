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

/**
 * Scratch basis for the per-frame solvers (camera polish pass): the framing
 * maths runs every frame on a dozen points, so it works on scalars and one
 * reused basis instead of allocating tuples per point.
 */
const SB = { fx: 0, fy: 0, fz: 1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 };

/** `lookBasis(pos, target)` (roll 0 or `roll`) into `SB`. */
function basisInto(px: number, py: number, pz: number, tx: number, ty: number, tz: number, roll = 0): void {
  let fx = tx - px, fy = ty - py, fz = tz - pz;
  let l = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  fx /= l; fy /= l; fz /= l;
  if (Math.abs(fy) > 0.99999) {
    fx += 1e-4; fz += 1e-4;
    l = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    fx /= l; fy /= l; fz /= l;
  }
  // right = up x back, back = -fwd: (0,1,0) x (-f) = (-fz, 0, fx)
  let rx = -fz, rz = fx;
  const rl = Math.sqrt(rx * rx + rz * rz) || 1;
  rx /= rl; rz /= rl;
  // up = back x right = (-f) x r
  let ux = -fy * rz;
  let uy = fx * rz - fz * rx;
  let uz = fy * rx;
  let ry = 0;
  if (roll !== 0) {
    const c = Math.cos(roll);
    const sn = Math.sin(roll);
    const r2x = rx * c + ux * sn, r2y = ry * c + uy * sn, r2z = rz * c + uz * sn;
    const u2x = -rx * sn + ux * c, u2y = -ry * sn + uy * c, u2z = -rz * sn + uz * c;
    rx = r2x; ry = r2y; rz = r2z; ux = u2x; uy = u2y; uz = u2z;
  }
  SB.fx = fx; SB.fy = fy; SB.fz = fz; SB.rx = rx; SB.ry = ry; SB.rz = rz; SB.ux = ux; SB.uy = uy; SB.uz = uz;
}

/** The tan(half vertical fov) at which every point just touches the frame edge. */
export function requiredTanHalf(pos: V3, target: V3, pts: readonly V3[], aspect: number, roll = 0): number {
  basisInto(pos[0], pos[1], pos[2], target[0], target[1], target[2], roll);
  let need = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const dx = p[0] - pos[0], dy = p[1] - pos[1], dz = p[2] - pos[2];
    const z = dx * SB.fx + dy * SB.fy + dz * SB.fz;
    if (z < 0.05) return Infinity;
    const u = Math.abs(dx * SB.rx + dy * SB.ry + dz * SB.rz) / z / aspect;
    const v = Math.abs(dx * SB.ux + dy * SB.uy + dz * SB.uz) / z;
    if (u > need) need = u;
    if (v > need) need = v;
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
 * `out` (optional) receives the result instead of a new object.
 */
export function solveFraming(
  pos: V3, pts: readonly V3[], aspect: number, safe: number, bias: readonly [number, number] = NO_BIAS,
  out?: FramingGoal,
): FramingGoal {
  const res: FramingGoal = out ?? { target: [0, 0, 0], tanHalf: 0 };
  if (pts.length === 0) {
    res.target[0] = pos[0]; res.target[1] = pos[1]; res.target[2] = pos[2] + 1;
    res.tanHalf = 0.3;
    return res;
  }
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    cx += p[0]; cy += p[1]; cz += p[2];
  }
  let ax = cx / pts.length, ay = cy / pts.length, az = cz / pts.length;
  const depth = Math.max(0.5, Math.hypot(ax - pos[0], ay - pos[1], az - pos[2]));
  for (let iter = 0; iter < 3; iter++) {
    basisInto(pos[0], pos[1], pos[2], ax, ay, az);
    let umin = Infinity;
    let umax = -Infinity;
    let vmin = Infinity;
    let vmax = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const dx = p[0] - pos[0], dy = p[1] - pos[1], dz = p[2] - pos[2];
      const z = Math.max(dx * SB.fx + dy * SB.fy + dz * SB.fz, 1e-3);
      const u = (dx * SB.rx + dy * SB.ry + dz * SB.rz) / z;
      const v = (dx * SB.ux + dy * SB.uy + dz * SB.uz) / z;
      if (u < umin) umin = u;
      if (u > umax) umax = u;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    const uc = (umin + umax) / 2 + bias[0] * (umax - umin) / 2;
    const vc = (vmin + vmax) / 2 + bias[1] * (vmax - vmin) / 2;
    let dx = SB.fx + SB.rx * uc + SB.ux * vc;
    let dy = SB.fy + SB.ry * uc + SB.uy * vc;
    let dz = SB.fz + SB.rz * uc + SB.uz * vc;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= l; dy /= l; dz /= l;
    ax = pos[0] + dx * depth; ay = pos[1] + dy * depth; az = pos[2] + dz * depth;
  }
  res.target[0] = ax; res.target[1] = ay; res.target[2] = az;
  res.tanHalf = requiredTanHalf(pos, res.target, pts, aspect) / safe;
  return res;
}

const NO_BIAS: readonly [number, number] = [0, 0];

export const tanHalfToFov = (t: number): number => (Math.atan(t) * 360) / Math.PI;
export const fovToTanHalf = (fovDeg: number): number => Math.tan((fovDeg * Math.PI) / 360);
