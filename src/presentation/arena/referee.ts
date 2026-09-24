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
import type { Arena, SimEvent, TickSnapshot } from '../../sim';
import { wallSegments } from './geometry';
import { cornerSpots } from '../corner/spots';

export type RefereeGesture =
  | 'watch' | 'start' | 'break' | 'stop' | 'count' | 'warn' | 'neutral'
  /** Over a downed fighter, hands out, ready to dive in. */
  | 'ready'
  /** Holding the winner's arm up at the end. */
  | 'raise';

/**
 * What the referee is doing on screen. The sim's display state
 * (`TickSnapshot.referee.state`: watching / counting / warning / separating /
 * stopping) is the primary input, read together with the frame (postures,
 * engagements, phase) and the recent events, because the display state alone
 * is not enough and sometimes stale:
 *
 *  - The sim reports `separating` for the whole of a doctor or foul pause, and
 *    in engine 4.3.0 that pause can outlive the action: in the capture bout
 *    (`watch-demo-5:1:2`) it stays `separating` from the doctor check at tick
 *    4019 to the end, through a knockdown, a takedown and ground work. A
 *    separation is only shown while there is something to separate: the pair
 *    clinched or standing close, nobody on the canvas, no strike just thrown.
 *  - Clinch breaks and stand-ups are events (`refereeBreak`), not a state;
 *    warnings are `refereeWarning`; a knockdown in MMA has no count, so the
 *    display stays `watching` while a fighter is down.
 *  - The end of the bout (`phase: 'ended'`) carries no winner; the events do.
 */
export type RefereeState =
  | 'watching' | 'separating' | 'counting' | 'warning' | 'stopping'
  /** A fighter is down (no count): standing over him, ready to stop it. */
  | 'knockdown'
  /** A downed fighter just got back up: close, watching him. */
  | 'standingUp'
  /** The bout was just stopped (referee stoppage / tap). */
  | 'stoppage'
  /** The bout is over and has a winner: raising his hand. */
  | 'raisingHand'
  | 'roundStart' | 'break';

export interface RefereeContext {
  /** Recent events, at least the last two seconds (`FrameInput.events`). */
  events?: readonly SimEvent[];
  /**
   * The side of the fighters' line he watched from last (+1 / -1, from the
   * previous placement's `side`): kept unless the other side is clearly
   * better, so he does not run across the action every time the scores tie.
   */
  preferSide?: number;
}

export interface RefereeDisplay {
  state: RefereeState;
  /** The fighter the state is about (downed, warned, winner), else -1. */
  focusId: number;
  /** The other fighter of a finish (the loser), else -1. */
  otherId: number;
}

/** A clinch break or stand-up call is shown this long after its event. */
export const BREAK_SHOW_S = 1.6;
/** A warning is shown this long after its event. */
export const WARN_SHOW_S = 1.8;
/** After a knockdown ends (the fighter is back up), he stays close this long. */
export const STANDUP_SHOW_S = 2.0;
/** A strike this recent means the fight is live: no separation is shown. */
const LIVE_STRIKE_S = 1.0;
const TICK_S = 0.1;

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
  /** Watching: which side of the fighters' line (+1 left of a→b, -1 right), else 0. */
  side?: number;
}

/** The subset of a snapshot the referee reads; a TickSnapshot satisfies it. */
export interface RefereeScene {
  phase: TickSnapshot['phase'];
  fighters: readonly Pick<TickSnapshot['fighters'][number], 'id' | 'x' | 'z' | 'posture'>[];
  engagements: readonly Pick<TickSnapshot['engagements'][number], 'a' | 'b' | 'kind'>[];
  referee: TickSnapshot['referee'];
  /**
   * Extra floor points he must keep clear of (the head and feet of a fighter
   * lying on the canvas, whose hips alone do not describe the body).
   */
  obstacles?: readonly { x: number; z: number }[];
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
 * Pure: the referee's presentation state for this frame (see `RefereeState`).
 * `scene.tick` is the frame's tick; events after it (the look-ahead part of
 * the window) are ignored, so a state never starts before its event.
 */
export function refereeDisplay(scene: RefereeScene & { tick?: number }, ctx: RefereeContext = {}): RefereeDisplay {
  const fs = scene.fighters;
  const ev = ctx.events ?? [];
  const tick = scene.tick ?? Infinity;
  const ids = fs.map((f) => f.id);
  const other = (id: number): number => ids.find((i) => i !== id) ?? -1;
  let lastStrike = -Infinity;
  let lastBreak = -Infinity;
  let lastWarn: SimEvent | null = null;
  let lastKd: SimEvent | null = null;
  let finish: SimEvent | null = null;
  let winner = -1;
  let loser = -1;
  let doctorOrFoul = -Infinity;
  let latest = -Infinity;
  for (const e of ev) {
    if (e.tick > tick) continue;
    latest = Math.max(latest, e.tick);
    switch (e.kind) {
      case 'strike': lastStrike = Math.max(lastStrike, e.tick); break;
      case 'refereeBreak': lastBreak = Math.max(lastBreak, e.tick); break;
      case 'refereeWarning': case 'timidityWarning': if (!lastWarn || e.tick >= lastWarn.tick) lastWarn = e; break;
      case 'knockdown': if (!lastKd || e.tick >= lastKd.tick) lastKd = e; break;
      case 'doctorCheck': case 'foul': doctorOrFoul = Math.max(doctorOrFoul, e.tick); break;
      case 'refereeStoppage': finish = e; if (e.target >= 0) winner = e.target; break;
      case 'submissionFinish': finish = e; if (e.actor >= 0) winner = e.actor; break;
      case 'fighterOut': if (e.actor >= 0) loser = e.actor; break;
      case 'decision': {
        const w = (e.detail as { winner?: unknown } | undefined)?.winner;
        if (typeof w === 'number') winner = w;
        break;
      }
      default: break;
    }
  }
  if (winner < 0 && loser >= 0) winner = other(loser);
  if (loser < 0 && winner >= 0) loser = other(winner);
  const now = Number.isFinite(tick) ? tick : Math.max(latest, 0);
  const ago = (t: number): number => (now - t) * TICK_S;

  if (scene.phase === 'pre') return { state: 'roundStart', focusId: -1, otherId: -1 };
  if (scene.phase === 'ended') {
    return winner >= 0
      ? { state: 'raisingHand', focusId: winner, otherId: loser }
      : { state: 'roundStart', focusId: -1, otherId: -1 };
  }
  if (scene.phase === 'break') return { state: 'break', focusId: -1, otherId: -1 };

  const ref = scene.referee;
  if (ref.state === 'counting') {
    const t = ref.target ?? fs.find((f) => f.posture === 'down')?.id ?? -1;
    return { state: 'counting', focusId: t, otherId: other(t) };
  }
  if (ref.state === 'stopping') {
    const t = ref.target ?? fs.find((f) => f.posture === 'down' || f.posture === 'ground')?.id ?? -1;
    return { state: 'stopping', focusId: t, otherId: other(t) };
  }
  if (finish) return { state: 'stoppage', focusId: loser, otherId: winner };

  const down = fs.find((f) => f.posture === 'down' || f.posture === 'out');
  if (down) return { state: 'knockdown', focusId: down.id, otherId: other(down.id) };

  if (ref.state === 'warning' || (lastWarn && ago(lastWarn.tick) <= WARN_SHOW_S)) {
    const t = ref.target ?? (lastWarn ? (lastWarn.target >= 0 ? lastWarn.target : lastWarn.actor) : -1);
    return { state: 'warning', focusId: t, otherId: -1 };
  }

  const grounded = fs.some((f) => f.posture === 'ground')
    || scene.engagements.some((e) => e.kind !== 'clinch');
  const clinched = scene.engagements.some((e) => e.kind === 'clinch') || fs.some((f) => f.posture === 'clinch');
  const close = fs.length >= 2 && Math.hypot(fs[0]!.x - fs[1]!.x, fs[0]!.z - fs[1]!.z) < 1.5;
  const live = ago(lastStrike) < LIVE_STRIKE_S;
  // A clinch break or stand-up call: he steps in between.
  if (ago(lastBreak) <= BREAK_SHOW_S && !live) return { state: 'separating', focusId: -1, otherId: -1 };
  // The sim's separation (doctor / foul pause) only while there is something to separate.
  if (ref.state === 'separating' && !grounded && !live && (clinched || close || ago(doctorOrFoul) <= 2)) {
    return { state: 'separating', focusId: -1, otherId: -1 };
  }

  if (lastKd && ago(lastKd.tick) <= STANDUP_SHOW_S + 1.5 && !grounded) {
    const t = lastKd.target >= 0 ? lastKd.target : lastKd.actor;
    return { state: 'standingUp', focusId: t, otherId: other(t) };
  }
  return { state: 'watching', focusId: -1, otherId: -1 };
}

/**
 * Pure: the referee's target spot for this frame. Deterministic in its inputs.
 * `simTime` drives only the slow circling drift; `ctx.events` (the recent
 * event window) lets the state follow breaks, warnings, knockdowns and the
 * finish (`refereeDisplay`).
 */
export function refereePlacement(
  scene: RefereeScene & { tick?: number }, arena: Arena, simTime: number, hardCameraAngle = 0, ctx: RefereeContext = {},
): RefereePlacement {
  const none: RefereePlacement = {
    present: false, x: 0, z: 0, facing: 0, crouch: 0, gesture: 'neutral', focusId: -1, count: 0,
  };
  if (arena.shape === 'unbounded') return none;

  const active = scene.fighters.filter((f) => f.posture !== 'out');
  const all = active.length > 0 ? active : scene.fighters;
  const bodies: Pt[] = scene.fighters.map((f) => ({ x: f.x, z: f.z }));
  if (bodies.length === 0) {
    return { ...none, present: true, gesture: 'watch' };
  }
  for (const o of scene.obstacles ?? []) bodies.push({ x: o.x, z: o.z });

  // Centre of the action and the axis between the first two fighters.
  const a = all[0]!;
  const b = all[1] ?? all[0]!;
  const mid: Pt = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  let axis = Math.atan2(b.x - a.x, b.z - a.z);
  if (a === b) axis = Math.atan2(-a.x, -a.z); // alone: look at him from the centre side

  const ref = scene.referee;
  const byId = (id: number | undefined) => (id === undefined || id < 0 ? undefined : scene.fighters.find((f) => f.id === id));

  const place = (p: Pt, focus: Pt, crouch: number, gesture: RefereeGesture, focusId = -1, count = 0): RefereePlacement => ({
    present: true, x: p.x, z: p.z, facing: facingTo(p, focus), crouch, gesture, focusId, count,
  });

  // The hard camera, far out on its azimuth: he keeps out of its line to the action.
  const camX = Math.sin(hardCameraAngle);
  const camZ = Math.cos(hardCameraAngle);
  const cam: Pt = { x: camX * 12, z: camZ * 12 };
  /** 0..1: how squarely `p` stands between the hard camera and `target`. */
  const screens = (p: Pt, target: Pt): number => {
    const tx = target.x - cam.x, tz = target.z - cam.z;
    const px = p.x - cam.x, pz = p.z - cam.z;
    const dt = Math.hypot(tx, tz), dp = Math.hypot(px, pz);
    if (dp >= dt || dt < 1e-6 || dp < 1e-6) return 0;
    const cos = (tx * px + tz * pz) / (dt * dp);
    const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
    return Math.max(0, 1 - ang / 0.16);
  };
  /** The valid spot around `centre` (candidate angles in order of preference) that screens `target` least. */
  const bestAround = (centre: Pt, angles: readonly number[], radius: number, target: Pt): Pt => {
    let best: Pt | null = null;
    let bestScore = Infinity;
    angles.forEach((ang, i) => {
      const p = resolveSpot(arena, centre, ang, radius, bodies);
      const displaced = Math.hypot(p.x - centre.x - Math.sin(ang) * radius, p.z - centre.z - Math.cos(ang) * radius);
      const score = screens(p, target) * 4 + i * 0.05 + displaced * 0.5;
      if (score < bestScore) { bestScore = score; best = p; }
    });
    return best ?? resolveSpot(arena, centre, angles[0] ?? 0, radius, bodies);
  };

  const d = refereeDisplay(scene, ctx);
  const focus = byId(d.focusId);
  const otherOf = (f: { id: number }) => all.find((x) => x.id !== f.id) ?? scene.fighters.find((x) => x.id !== f.id);
  const lineFrom = (f: Pt, o: Pt | undefined): number => (!o || o === f ? axis : Math.atan2(o.x - f.x, o.z - f.z));

  switch (d.state) {
    case 'counting': {
      const downed = byId(ref.target) ?? focus ?? all.find((f) => f.posture === 'down') ?? a;
      const spot = resolveSpot(arena, downed, lineFrom(downed, otherOf(downed)), 1.05, bodies);
      return place(spot, downed, 0.35, 'count', downed.id, ref.count ?? 0);
    }
    case 'stopping':
    case 'stoppage': {
      const downed = focus ?? all.find((f) => f.posture === 'down' || f.posture === 'ground') ?? a;
      const toward = lineFrom(downed, otherOf(downed));
      // Dives in between: just off the line from the hurt fighter toward the attacker.
      const spot = bestAround(downed, [toward + 0.5, toward - 0.5, toward + 0.9, toward - 0.9], 0.8, downed);
      const grounded = downed.posture === 'down' || downed.posture === 'ground' || downed.posture === 'out';
      return place(spot, downed, grounded ? 0.7 : 0.15, 'stop', downed.id);
    }
    case 'knockdown': {
      // MMA has no count: he stands over the downed fighter, between him and
      // the attacker but off their line, hands out, ready to dive in.
      const downed = focus ?? a;
      const toward = lineFrom(downed, otherOf(downed));
      const spot = bestAround(downed, [toward + 0.75, toward - 0.75, toward + 1.2, toward - 1.2], 1.15, downed);
      return place(spot, downed, 0.3, 'ready', downed.id);
    }
    case 'standingUp': {
      const f = focus ?? a;
      const toward = lineFrom(f, otherOf(f));
      const spot = bestAround(f, [toward + 1.1, toward - 1.1, toward + 1.6, toward - 1.6], 1.6, mid);
      return place(spot, f, 0.1, 'watch', f.id);
    }
    case 'separating': {
      const spot = bestAround(mid, [axis + Math.PI / 2, axis - Math.PI / 2], 0.75, mid);
      return place(spot, mid, 0.1, 'break');
    }
    case 'warning': {
      const f = focus ?? a;
      const side = facingTo(mid, f) + Math.PI / 2;
      const spot = bestAround(f, [side, side + Math.PI], 1.1, mid);
      return place(spot, f, 0, 'warn', f.id);
    }
    case 'raisingHand': {
      // Beside the winner, on the side away from the loser and turned toward
      // the hard camera, so his raised arm and the winner's face both read.
      const w = focus ?? a;
      const l = byId(d.otherId);
      const away = l ? Math.atan2(w.x - l.x, w.z - l.z) : axis;
      const toCam = Math.atan2(cam.x - w.x, cam.z - w.z);
      const lean = Math.atan2(Math.sin(toCam - away), Math.cos(toCam - away)) > 0 ? 0.6 : -0.6;
      const spot = bestAround(w, [away + lean, away - lean, away + lean * 2, away], 0.78, w);
      const p = place(spot, w, 0, 'raise', w.id);
      // Square to the audience between the camera and the winner.
      p.facing = facingTo(spot, { x: (cam.x + w.x) / 2, z: (cam.z + w.z) / 2 });
      return p;
    }
    case 'roundStart': {
      // Between the fighters at the centre line, square to them.
      const spot = resolveSpot(arena, mid, axis + Math.PI / 2, 0.35, bodies);
      return place(spot, mid, 0, 'start');
    }
    case 'break': {
      // Out of the way on the neutral side, a metre off the fence: square to
      // the red-blue corner line when the venue has painted corners (the
      // fighters sit there), else square to the fighters' line; the far side
      // from the hard camera.
      const spots = cornerSpots(arena);
      const cornerLine = spots
        ? Math.atan2(spots[1].post[0] - spots[0].post[0], spots[1].post[1] - spots[0].post[1])
        : axis;
      const s1 = cornerLine + Math.PI / 2;
      const s2 = cornerLine - Math.PI / 2;
      const facingCam = (a: number): number => Math.sin(a) * camX + Math.cos(a) * camZ;
      const side = spots ? (facingCam(s1) < facingCam(s2) ? s1 : s2) : axis + Math.PI / 2;
      const target = clampInside(arena, { x: Math.sin(side) * 20, z: Math.cos(side) * 20 });
      const spot = resolveSpot(arena, mid, Math.atan2(target.x - mid.x, target.z - mid.z),
        Math.max(1.5, Math.hypot(target.x - mid.x, target.z - mid.z) - 0.8), bodies);
      return place(spot, mid, 0, 'neutral');
    }
    default:
      break;
  }

  // --- watching: distance by engagement -------------------------------------
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
  // Room is capped: past 1.5 m to the fence more room is no reason to stand there.
  const room = (ang: number) =>
    Math.min(1.5, insideDistance(arena, mid.x + Math.sin(ang) * radius, mid.z + Math.cos(ang) * radius));
  // Prefer the side away from the hard camera so he does not screen the
  // action (weighted to win unless that side is pinned against the fence),
  // and never a spot on the camera's line to the pair.
  const away = (ang: number) => -(Math.sin(ang) * camX + Math.cos(ang) * camZ) * 1.4;
  const bias = 0.25 * Math.sin(simTime * 0.05);
  const score = (ang: number): number => {
    const p = { x: mid.x + Math.sin(ang) * radius, z: mid.z + Math.cos(ang) * radius };
    return room(ang) + away(ang) - screens(p, mid) * 3;
  };
  const keep = 0.9;
  const sl = score(left) + bias + (ctx.preferSide === 1 ? keep : 0);
  const sr = score(right) + (ctx.preferSide === -1 ? keep : 0);
  const side = sl >= sr ? 1 : -1;
  const spot = resolveSpot(arena, mid, side === 1 ? left : right, radius, bodies);
  const p = place(spot, mid, crouch, 'watch');
  p.side = side;
  return p;
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

  /**
   * `hardCameraAngle`: azimuth (atan2(x, z)) of the main broadcast camera, so
   * he keeps to the far side of the action from it (integration: the camera
   * module's `CameraArena.mainAzimuth`, passed through `ArenaOptions`).
   */
  constructor(
    private readonly arena: Arena, private readonly maxSpeed = 3.2, private readonly hardCameraAngle = 0,
  ) {}

  /** The side he watched from on the last update (hysteresis for `refereePlacement`). */
  private side = 0;

  update(
    scene: RefereeScene & { tick?: number }, simTime: number, dt: number, snap: boolean, ctx: RefereeContext = {},
  ): RefereePlacement {
    const t = refereePlacement(scene, this.arena, simTime, this.hardCameraAngle, {
      ...ctx, preferSide: snap || !this.primed ? undefined : this.side,
    });
    this.side = t.side ?? 0;
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
      // He walks with the action and runs only to intervene.
      const vmax = t.gesture === 'stop' || t.gesture === 'break' || t.gesture === 'ready'
        ? this.maxSpeed * 1.8 : this.maxSpeed * 0.6;
      const step = Math.min(d, vmax * dt, d * Math.min(1, dt * 4));
      if (d > 1e-6) { this.x += (dx / d) * step; this.z += (dz / d) * step; }
      let df = t.facing - this.facing;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      this.facing += df * Math.min(1, dt * 6);
      this.crouch += (t.crouch - this.crouch) * Math.min(1, dt * 5);
      // Walking there must not take him through a fighter or the fence.
      const p = clampInside(this.arena, { x: this.x, z: this.z });
      for (const f of [...scene.fighters, ...(scene.obstacles ?? [])]) {
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
