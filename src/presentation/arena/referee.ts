/**
 * REFEREE PLACEMENT — where the third person in the cage stands and faces.
 *
 * The referee is a humanoid built by the character module; this file owns the
 * logic only. `refereePlacement` is a pure function of the recorded frame (the
 * fighters' floor positions, their engagements, `referee.state`, the bout phase)
 * plus the interpolated sim time, so a replay puts the referee in the same place
 * every time. `RefereeTracker` adds a speed-limited follow so he walks rather
 * than teleports; it snaps on `FrameInput.discontinuity`.
 *
 * Broadcast behaviour it reproduces:
 *   - round start / end: standing between the fighters at the centre;
 *   - standing exchanges: circling at 2.3-2.8 m, off the fighters' line, on the
 *     side with more room so he is never pinned against the fence;
 *   - clinch: closer, about 1.6 m; ground work: 1.3-1.5 m and crouched;
 *   - separating / stopping: steps in between the fighters;
 *   - counting: over the downed fighter, between him and his opponent.
 *
 * It never stands inside a fighter (minimum centre distance `MIN_CLEARANCE_M`)
 * or outside the wall (margin `WALL_MARGIN_M`).
 */
import type { Arena, TickSnapshot } from '../../sim';
import { wallSegments } from './geometry';

export type RefereeGesture = 'watch' | 'start' | 'break' | 'stop' | 'count' | 'warn' | 'neutral';

export interface RefereePlacement {
  /** False when the arena has no referee (street). */
  present: boolean;
  x: number;
  z: number;
  /** Radians, atan2(dx, dz) — the sim's convention. */
  facing: number;
  /** 0 standing tall .. 1 deep crouch (ground work, counting, stoppages on the mat). */
  crouch: number;
  gesture: RefereeGesture;
  /** Fighter he is attending to (count, warning, stoppage), else -1. */
  focusId: number;
  /** Count shown by his hand, when counting. */
  count: number;
}

/** The subset of a snapshot the referee reads; a TickSnapshot satisfies it. */
export interface RefereeScene {
  phase: TickSnapshot['phase'];
  fighters: readonly Pick<TickSnapshot['fighters'][number], 'id' | 'x' | 'z' | 'posture'>[];
  engagements: readonly Pick<TickSnapshot['engagements'][number], 'a' | 'b' | 'kind'>[];
  referee: TickSnapshot['referee'];
}

export const MIN_CLEARANCE_M = 0.72;
export const WALL_MARGIN_M = 0.45;

interface Pt { x: number; z: number }

/** Signed distance to the wall (positive inside), using the same edge planes the sim uses. */
function insideDistance(arena: Arena, x: number, z: number): number {
  if (arena.shape === 'unbounded') return Infinity;
  if (arena.shape === 'circle') return (arena.apothemM ?? 0) - Math.hypot(x, z);
  let best = Infinity;
  for (const s of wallSegments(arena)) {
    const planeD = s.ax * s.nx + s.az * s.nz;
    const d = planeD - (x * s.nx + z * s.nz);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Where the referee may stand. Mats: he walks the safety area, so the limit is
 * the edge plus 2 m; fences and ropes: inside the wall with a body margin.
 */
function wallAllowance(arena: Arena): number {
  return arena.wall === 'edge' ? -2.0 : WALL_MARGIN_M;
}

function clampInside(arena: Arena, p: Pt): Pt {
  if (arena.shape === 'unbounded') return p;
  const m = wallAllowance(arena);
  let { x, z } = p;
  if (arena.shape === 'circle') {
    const r = Math.hypot(x, z);
    const max = (arena.apothemM ?? 0) - m;
    if (r > max && r > 0) { x = (x / r) * max; z = (z / r) * max; }
    return { x, z };
  }
  const segs = wallSegments(arena);
  for (let pass = 0; pass < 3; pass++) {
    for (const s of segs) {
      const planeD = s.ax * s.nx + s.az * s.nz - m;
      const over = x * s.nx + z * s.nz - planeD;
      if (over > 0) { x -= s.nx * over; z -= s.nz * over; }
    }
  }
  return { x, z };
}

function valid(arena: Arena, p: Pt, bodies: readonly Pt[]): boolean {
  if (insideDistance(arena, p.x, p.z) < wallAllowance(arena) - 1e-6) return false;
  for (const b of bodies) if (Math.hypot(p.x - b.x, p.z - b.z) < MIN_CLEARANCE_M) return false;
  return true;
}

/**
 * Put the referee at `radius` from `centre` along `angle`, or at the nearest
 * valid spot around that circle (deterministic search: alternating offsets of
 * 15 degrees, then larger radii).
 */
function resolveSpot(arena: Arena, centre: Pt, angle: number, radius: number, bodies: readonly Pt[]): Pt {
  const radii = [radius, radius + 0.4, radius + 0.9, Math.max(0.9, radius - 0.4), radius + 1.6];
  for (const r of radii) {
    for (let i = 0; i <= 12; i++) {
      const off = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
      const a = angle + off;
      const p = clampInside(arena, { x: centre.x + Math.sin(a) * r, z: centre.z + Math.cos(a) * r });
      if (valid(arena, p, bodies)) return p;
    }
  }
  // Last resort: the farthest valid-wall point from every body on a coarse grid.
  let best: Pt = clampInside(arena, centre);
  let bestD = -Infinity;
  for (let gx = -8; gx <= 8; gx++) {
    for (let gz = -8; gz <= 8; gz++) {
      const p = clampInside(arena, { x: centre.x + gx * 0.5, z: centre.z + gz * 0.5 });
      let d = Infinity;
      for (const b of bodies) d = Math.min(d, Math.hypot(p.x - b.x, p.z - b.z));
      if (d > bestD) { bestD = d; best = p; }
    }
  }
  return best;
}

const facingTo = (from: Pt, to: Pt): number => Math.atan2(to.x - from.x, to.z - from.z);

/**
 * Pure: the referee's target spot for this frame. Deterministic in its inputs.
 * `simTime` drives only the slow circling drift.
 */
export function refereePlacement(
  scene: RefereeScene, arena: Arena, simTime: number, hardCameraAngle = 0,
): RefereePlacement {
  const none: RefereePlacement = {
    present: false, x: 0, z: 0, facing: 0, crouch: 0, gesture: 'neutral', focusId: -1, count: 0,
  };
  if (arena.shape === 'unbounded') return none;

  const active = scene.fighters.filter((f) => f.posture !== 'out');
  const all = active.length > 0 ? active : scene.fighters;
  const bodies: Pt[] = all.map((f) => ({ x: f.x, z: f.z }));
  if (bodies.length === 0) {
    return { ...none, present: true, gesture: 'watch' };
  }

  // Centre of the action and the axis between the first two fighters.
  const a = all[0]!;
  const b = all[1] ?? all[0]!;
  const mid: Pt = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  let axis = Math.atan2(b.x - a.x, b.z - a.z);
  if (a === b) axis = Math.atan2(-a.x, -a.z); // alone: look at him from the centre side

  const ref = scene.referee;
  const byId = (id: number | undefined) => (id === undefined ? undefined : all.find((f) => f.id === id));

  const place = (p: Pt, focus: Pt, crouch: number, gesture: RefereeGesture, focusId = -1, count = 0): RefereePlacement => ({
    present: true, x: p.x, z: p.z, facing: facingTo(p, focus), crouch, gesture, focusId, count,
  });

  // --- officials' states override positioning --------------------------------
  if (ref.state === 'counting') {
    const downed = byId(ref.target) ?? all.find((f) => f.posture === 'down') ?? a;
    const other = all.find((f) => f !== downed) ?? downed;
    const toward = other === downed ? axis : Math.atan2(other.x - downed.x, other.z - downed.z);
    const spot = resolveSpot(arena, downed, toward, 1.05, bodies);
    return place(spot, downed, 0.35, 'count', downed.id, ref.count ?? 0);
  }
  if (ref.state === 'stopping') {
    const downed = byId(ref.target) ?? all.find((f) => f.posture === 'down' || f.posture === 'ground') ?? a;
    const other = all.find((f) => f !== downed) ?? downed;
    const toward = other === downed ? axis : Math.atan2(other.x - downed.x, other.z - downed.z);
    // Dives in between: just off the line from the hurt fighter toward the attacker.
    const spot = resolveSpot(arena, downed, toward + 0.5, 0.8, bodies);
    const grounded = downed.posture === 'down' || downed.posture === 'ground';
    return place(spot, downed, grounded ? 0.7 : 0.15, 'stop', downed.id);
  }
  if (ref.state === 'separating') {
    const spot = resolveSpot(arena, mid, axis + Math.PI / 2, 0.75, bodies);
    return place(spot, mid, 0.1, 'break');
  }
  if (ref.state === 'warning') {
    const f = byId(ref.target) ?? a;
    const spot = resolveSpot(arena, f, facingTo(mid, f) + Math.PI / 2, 1.1, bodies);
    return place(spot, f, 0, 'warn', f.id);
  }

  // --- phase -------------------------------------------------------------------
  if (scene.phase === 'pre' || scene.phase === 'ended') {
    // Between the fighters at the centre line, square to them.
    const spot = resolveSpot(arena, mid, axis + Math.PI / 2, 0.35, bodies);
    return place(spot, mid, 0, 'start');
  }
  if (scene.phase === 'break') {
    // Out of the way on the neutral side, a metre off the fence.
    const side = axis + Math.PI / 2;
    const target = clampInside(arena, { x: Math.sin(side) * 20, z: Math.cos(side) * 20 });
    const spot = resolveSpot(arena, mid, Math.atan2(target.x - mid.x, target.z - mid.z),
      Math.max(1.5, Math.hypot(target.x - mid.x, target.z - mid.z) - 0.8), bodies);
    return place(spot, mid, 0, 'neutral');
  }

  // --- live round: distance by engagement -----------------------------------
  let radius = 2.5;
  let crouch = 0;
  const e = scene.engagements[0];
  if (e) {
    if (e.kind === 'clinch') { radius = 1.6; crouch = 0.05; }
    else if (e.kind === 'takedown' || e.kind === 'throw' || e.kind === 'scramble') { radius = 1.6; crouch = 0.25; }
    else { radius = 1.4; crouch = 0.55; } // ground, knockdown
  } else if (a.posture === 'ground' || a.posture === 'down' || b.posture === 'ground' || b.posture === 'down') {
    radius = 1.5; crouch = 0.45;
  } else {
    const sep = Math.hypot(b.x - a.x, b.z - a.z);
    radius = 2.2 + Math.min(0.6, sep * 0.2);
  }

  // Off the fighters' line, on the side with more room; a slow drift gives the
  // circling a real referee does. The drift is in sim time, so replays agree.
  const drift = 0.35 * Math.sin(simTime * 0.23) + 0.15 * Math.sin(simTime * 0.071 + 1.3);
  const left = axis + Math.PI / 2 + drift;
  const right = axis - Math.PI / 2 + drift;
  const room = (ang: number) =>
    insideDistance(arena, mid.x + Math.sin(ang) * radius, mid.z + Math.cos(ang) * radius);
  // Prefer the side away from the hard camera so he does not screen the action,
  // unless that side is much tighter against the fence.
  const camX = Math.sin(hardCameraAngle);
  const camZ = Math.cos(hardCameraAngle);
  const away = (a: number) => -(Math.sin(a) * camX + Math.cos(a) * camZ) * 0.9;
  const bias = 0.25 * Math.sin(simTime * 0.05);
  const ang = room(left) + away(left) + bias >= room(right) + away(right) ? left : right;
  const spot = resolveSpot(arena, mid, ang, radius, bodies);
  return place(spot, mid, crouch, 'watch');
}

/**
 * Speed-limited follower around `refereePlacement`. Deterministic for a given
 * sequence of calls; `snap` (or a discontinuity) jumps straight to the target.
 */
export class RefereeTracker {
  x = 0;
  z = 0;
  facing = 0;
  crouch = 0;
  private primed = false;
  last: RefereePlacement | null = null;

  constructor(private readonly arena: Arena, private readonly maxSpeed = 3.2) {}

  update(scene: RefereeScene, simTime: number, dt: number, snap: boolean): RefereePlacement {
    const t = refereePlacement(scene, this.arena, simTime);
    this.last = t;
    if (!t.present) return t;
    if (snap || !this.primed || dt <= 0) {
      this.x = t.x; this.z = t.z; this.facing = t.facing; this.crouch = t.crouch;
      this.primed = true;
    } else {
      const dx = t.x - this.x;
      const dz = t.z - this.z;
      const d = Math.hypot(dx, dz);
      // Urgent states move faster (he runs in on a stoppage).
      const vmax = t.gesture === 'stop' || t.gesture === 'break' ? this.maxSpeed * 1.8 : this.maxSpeed;
      const step = Math.min(d, vmax * dt, d * Math.min(1, dt * 4));
      if (d > 1e-6) { this.x += (dx / d) * step; this.z += (dz / d) * step; }
      let df = t.facing - this.facing;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      this.facing += df * Math.min(1, dt * 6);
      this.crouch += (t.crouch - this.crouch) * Math.min(1, dt * 5);
      // Walking there must not take him through a fighter or the fence.
      const p = clampInside(this.arena, { x: this.x, z: this.z });
      for (const f of scene.fighters) {
        const ox = p.x - f.x;
        const oz = p.z - f.z;
        const od = Math.hypot(ox, oz);
        if (od < MIN_CLEARANCE_M) {
          const ux = od > 1e-6 ? ox / od : Math.sin(t.facing + Math.PI);
          const uz = od > 1e-6 ? oz / od : Math.cos(t.facing + Math.PI);
          p.x = f.x + ux * MIN_CLEARANCE_M;
          p.z = f.z + uz * MIN_CLEARANCE_M;
        }
      }
      const q = clampInside(this.arena, p);
      this.x = q.x; this.z = q.z;
    }
    return { ...t, x: this.x, z: this.z, facing: this.facing, crouch: this.crouch };
  }
}
