/**
 * THE REST PERIOD — stools in the corners and the fighters sitting on them.
 *
 * The sim leaves both fighters where the round ended for the whole break, so
 * the corner cameras used to show two men standing in guard at the centre.
 * Between rounds a broadcast shows each fighter on a stool in his corner,
 * back to the fence, facing the cage. This module stages that, presentation
 * only, from the recording:
 *
 *   - `breakWindows(frames, events)`: every break (roundEnd → next
 *     roundStart), with where each fighter stood when it began and where he
 *     stands when the next round starts;
 *   - `CornerRest` overwrites the animator's poses during a break: walk to the
 *     corner (a fighter's gait, `people/figure.ts`: loose arms, rolling
 *     shoulders, heel-to-toe steps planted along the path), sit down, sit
 *     (leaning back, forearms on the thighs, breathing), stand up ~7 s before
 *     the bell, walk to the next round's start mark, hand back to the animator
 *     with a crossfade;
 *   - the cornermen (`crew.ts`): the cutman brings the stool in and puts it
 *     down as his fighter walks back, the coach kneels in front of him; both
 *     get up at the warning and leave with the stool before the bell. Without
 *     a crew the stools simply appear for the break.
 *
 * Where: the painted corners of the octagon (the red and blue post caps,
 * `arena/octagon.ts`) and of the ring (`arena/ring.ts`); mats and the street
 * have no corners and no stools. 1v1 only (fighter 0 red, fighter 1 blue).
 *
 * Deterministic: every position, the gait phase included, is a function of
 * the recording and the sim time.
 */
import * as THREE from 'three/webgpu';
import type { Arena, SimEvent, TickSnapshot } from '../../sim';
import type { BoutPresentation, CharacterFactory, FrameInput, QualitySettings } from '../contract';
import {
  B, blendPose, copyPose, createPose, createWorldPose, forwardKinematics, mulQuat,
  type Pose, type RestSkeleton, type WorldPose,
} from '../rig/skeleton';
import { fadeKeepFeet } from '../anim/blend';
import { LIMBS, axisAngle, conjugateInto, solveTwoBone } from '../rig/ik';
import { FigurePoser } from '../people/figure';
import { cornerSpots, type CornerSpot } from './spots';
import { CornerCrew, type BreakTiming } from './crew';

export { cornerSpots, STOOL_INSET_M } from './spots';
export type { CornerSpot } from './spots';
export { CornerCrew, crewCue, crewSpots, crewDefinition } from './crew';
export type { BreakTiming, CrewCue, CrewRole } from './crew';

type V3 = [number, number, number];

const TICK_S = 0.1;
/** Seat height of the corner stool (m). */
export const STOOL_SEAT_M = 0.56;
/** Walking pace to and from the corner (m/s). */
const WALK_MPS = 1.25;
/** Stand up this long before the bell, and take this long to sit or rise. */
const RISE_BEFORE_BELL_S = 7;
const SIT_S = 1.1;
/** Crossfade with the animator at both ends of the break. */
const FADE_S = 0.6;

export interface BreakWindow {
  fromTick: number;
  toTick: number;
  /** Floor position of each fighter when the break begins and when the next round starts. */
  endPos: [number, number][];
  startPos: [number, number][];
  startFacing: number[];
}

function frameAt(frames: readonly TickSnapshot[], tick: number): TickSnapshot | null {
  let lo = 0;
  let hi = frames.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (frames[m]!.tick <= tick) lo = m;
    else hi = m - 1;
  }
  return frames[lo] ?? null;
}

/** Every rest period of a recorded bout. Pure. */
export function breakWindows(frames: readonly TickSnapshot[], events: readonly SimEvent[]): BreakWindow[] {
  const out: BreakWindow[] = [];
  const ends = events.filter((e) => e.kind === 'roundEnd').map((e) => e.tick);
  const starts = events.filter((e) => e.kind === 'roundStart').map((e) => e.tick);
  for (const end of ends) {
    const start = starts.find((s) => s > end);
    if (start === undefined) continue;
    const a = frameAt(frames, end);
    const b = frameAt(frames, start);
    if (!a || !b) continue;
    out.push({
      fromTick: end,
      toTick: start,
      endPos: a.fighters.map((f) => [f.x, f.z] as [number, number]),
      startPos: b.fighters.map((f) => [f.x, f.z] as [number, number]),
      startFacing: b.fighters.map((f, i) => {
        const o = b.fighters[1 - i];
        return o ? Math.atan2(o.x - f.x, o.z - f.z) : f.facing;
      }),
    });
  }
  return out;
}

export type RestPhase = 'none' | 'toCorner' | 'sitting' | 'seated' | 'rising' | 'toCentre' | 'waiting';

export interface RestState {
  phase: RestPhase;
  /** Floor position and facing of the body this instant. */
  x: number;
  z: number;
  facing: number;
  /** 0 standing .. 1 seated. */
  seat: number;
  /** 0..1 weight of this module's pose over the animator's. */
  weight: number;
  /** Distance walked on this break's paths so far (drives the gait), and the speed now. */
  walked: number;
  speed: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (t: number): number => { const x = clamp01(t); return x * x * (3 - 2 * x); };
const angleLerp = (a: number, b: number, t: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/**
 * Pure: where fighter `i` is and what he is doing `t` seconds into break `w`
 * (the break lasts `w.toTick - w.fromTick` ticks).
 */
export function restState(w: BreakWindow, i: number, spot: CornerSpot, t: number): RestState {
  const len = (w.toTick - w.fromTick) * TICK_S;
  const e = w.endPos[i] ?? [0, 0];
  const s = w.startPos[i] ?? e;
  const front: [number, number] = [spot.stool[0] + Math.sin(spot.facing) * 0.42, spot.stool[1] + Math.cos(spot.facing) * 0.42];
  const outD = Math.hypot(front[0] - e[0], front[1] - e[1]);
  const backD = Math.hypot(s[0] - front[0], s[1] - front[1]);
  const tm = breakTiming(w, i, spot);
  const walkOut = tm.arrive;
  const walkBack = Math.max(1.2, backD / WALK_MPS);
  const riseAt = tm.rise;
  const weight = Math.min(ease(t / FADE_S), ease((len - t) / FADE_S));
  const toward = (a: [number, number], b: [number, number]): number => Math.atan2(b[0] - a[0], b[1] - a[1]);
  const speedOf = (d: number, dur: number, u: number): number => (d * 6 * u * (1 - u)) / Math.max(1e-3, dur);
  if (t < 0 || t > len) return { phase: 'none', x: e[0], z: e[1], facing: spot.facing, seat: 0, weight: 0, walked: 0, speed: 0 };
  if (t < walkOut) {
    const r = t / walkOut;
    const u = ease(r);
    return {
      phase: 'toCorner', x: lerp(e[0], front[0], u), z: lerp(e[1], front[1], u), facing: toward(e, front), seat: 0, weight,
      walked: outD * u, speed: speedOf(outD, walkOut, r),
    };
  }
  if (t < walkOut + SIT_S) {
    // Turn round and sit: from the stool's front to over the stool.
    const u = ease((t - walkOut) / SIT_S);
    return {
      phase: 'sitting', x: lerp(front[0], spot.stool[0], u), z: lerp(front[1], spot.stool[1], u),
      facing: angleLerp(toward(e, front), spot.facing, ease((t - walkOut) / (SIT_S * 0.5))), seat: u, weight,
      walked: outD, speed: 0,
    };
  }
  if (t < riseAt) return { phase: 'seated', x: spot.stool[0], z: spot.stool[1], facing: spot.facing, seat: 1, weight, walked: outD, speed: 0 };
  if (t < riseAt + SIT_S) {
    const u = ease((t - riseAt) / SIT_S);
    return {
      phase: 'rising', x: lerp(spot.stool[0], front[0], u), z: lerp(spot.stool[1], front[1], u),
      facing: spot.facing, seat: 1 - u, weight, walked: outD, speed: 0,
    };
  }
  const tb = t - riseAt - SIT_S;
  if (tb < walkBack) {
    const r = tb / walkBack;
    const u = ease(r);
    return {
      phase: 'toCentre', x: lerp(front[0], s[0], u), z: lerp(front[1], s[1], u),
      facing: angleLerp(spot.facing, toward(front, s), ease(tb / 0.5)), seat: 0, weight,
      walked: outD + backD * u, speed: speedOf(backD, walkBack, r),
    };
  }
  return { phase: 'waiting', x: s[0], z: s[1], facing: w.startFacing[i] ?? spot.facing, seat: 0, weight, walked: outD + backD, speed: 0 };
}

/** When fighter `i` arrives at his corner, sits, rises and is off the stool in break `w`. Pure. */
export function breakTiming(w: BreakWindow, i: number, spot: CornerSpot): BreakTiming {
  const len = (w.toTick - w.fromTick) * TICK_S;
  const e = w.endPos[i] ?? [0, 0];
  const front: [number, number] = [spot.stool[0] + Math.sin(spot.facing) * 0.42, spot.stool[1] + Math.cos(spot.facing) * 0.42];
  const outD = Math.hypot(front[0] - e[0], front[1] - e[1]);
  const arrive = Math.max(1.2, outD / WALK_MPS);
  const rise = Math.max(arrive + SIT_S + 1, len - RISE_BEFORE_BELL_S);
  return { len, arrive, seated: arrive + SIT_S, rise, risen: rise + SIT_S };
}

/**
 * A seated pose on the stool: hips on the seat, leaning back a little, feet
 * flat and apart in front, forearms resting on the thighs, head up.
 */
export function seatedPose(out: Pose, world: WorldPose, rest: RestSkeleton, x: number, z: number, facing: number, breath: number): Pose {
  for (let i = 0; i < out.local.length; i += 4) {
    out.local[i] = 0; out.local[i + 1] = 0; out.local[i + 2] = 0; out.local[i + 3] = 1;
  }
  const fwd: V3 = [Math.sin(facing), 0, Math.cos(facing)];
  const left: V3 = [Math.cos(facing), 0, -Math.sin(facing)];
  const q1 = new Float32Array(4);
  const q2 = new Float32Array(4);
  out.rootPos[0] = x;
  out.rootPos[1] = STOOL_SEAT_M + 0.09;
  out.rootPos[2] = z;
  // Pelvis rolled back on the seat, chest leaning back against nothing (a slump).
  mulQuat(out.rootQuat, 0, axisAngle([0, 1, 0], facing), 0, axisAngle([1, 0, 0], -0.12), 0);
  const sp = axisAngle([1, 0, 0], 0.08 + breath * 0.02);
  for (const b of [B.spine, B.spine1, B.spine2]) out.local.set(sp, b * 4);
  out.local.set(axisAngle([1, 0, 0], -0.05), B.neck * 4);
  out.local.set(axisAngle([1, 0, 0], 0.06), B.head * 4);
  forwardKinematics(world, out, rest);
  const ankleY = rest.head[B.lFoot * 3 + 1];
  for (const s of [1, -1] as const) {
    const chain = s > 0 ? LIMBS.lLeg : LIMBS.rLeg;
    const hip = chain.upper * 3;
    const knee = rest.length[B.lUpLeg];
    const foot: V3 = [
      x + fwd[0] * (knee * 0.95) + left[0] * s * 0.24,
      ankleY,
      z + fwd[2] * (knee * 0.95) + left[2] * s * 0.24,
    ];
    const pole: V3 = [world.pos[hip] + fwd[0] * 1.2, world.pos[hip + 1] + 0.3, world.pos[hip + 2] + fwd[2] * 1.2];
    solveTwoBone(out, world, rest, chain, foot, pole);
  }
  forwardKinematics(world, out, rest);
  for (const s of [1, -1] as const) {
    const shin = s > 0 ? B.lLeg : B.rLeg;
    const footB = s > 0 ? B.lFoot : B.rFoot;
    conjugateInto(q1, world.quat.subarray(shin * 4, shin * 4 + 4));
    mulQuat(q2, 0, q1, 0, axisAngle([0, 1, 0], facing + s * 0.15), 0);
    out.local.set(q2, footB * 4);
  }
  forwardKinematics(world, out, rest);
  // Forearms on the thighs, hands hanging just past the knees.
  for (const s of [1, -1] as const) {
    const chain = s > 0 ? LIMBS.lArm : LIMBS.rArm;
    const kneeJ = (s > 0 ? B.lLeg : B.rLeg) * 3;
    const target: V3 = [
      world.pos[kneeJ] + fwd[0] * 0.06 + left[0] * s * 0.03,
      world.pos[kneeJ + 1] + 0.05,
      world.pos[kneeJ + 2] + fwd[2] * 0.06 + left[2] * s * 0.03,
    ];
    const sh = chain.upper * 3;
    const pole: V3 = [world.pos[sh] + left[0] * s * 0.6 - fwd[0] * 0.2, world.pos[sh + 1] - 0.6, world.pos[sh + 2] + left[2] * s * 0.6 - fwd[2] * 0.2];
    solveTwoBone(out, world, rest, chain, target, pole);
  }
  return out;
}

/** The two corner stools: padded seat on four legs, black. */
function buildStools(spots: readonly CornerSpot[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'corner-stools';
  const seatMat = new THREE.MeshStandardNodeMaterial({ color: 0x141416, roughness: 0.55, metalness: 0 });
  const legMat = new THREE.MeshStandardNodeMaterial({ color: 0x8a8d93, roughness: 0.35, metalness: 0.9 });
  const seatGeo = new THREE.CylinderGeometry(0.21, 0.2, 0.07, 20);
  const legGeo = new THREE.CylinderGeometry(0.013, 0.016, STOOL_SEAT_M - 0.03, 6);
  const ringGeo = new THREE.TorusGeometry(0.17, 0.008, 6, 20);
  for (const s of spots) {
    const stool = new THREE.Group();
    stool.position.set(s.stool[0], 0, s.stool[1]);
    const seat = new THREE.Mesh(seatGeo, seatMat);
    seat.position.y = STOOL_SEAT_M - 0.035;
    stool.add(seat);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(Math.sin(a) * 0.16, (STOOL_SEAT_M - 0.03) / 2, Math.cos(a) * 0.16);
      leg.rotation.set(Math.cos(a) * -0.12, 0, Math.sin(a) * 0.12);
      stool.add(leg);
    }
    const ring = new THREE.Mesh(ringGeo, legMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    stool.add(ring);
    stool.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    stool.rotation.y = s.facing;
    g.add(stool);
  }
  g.visible = false;
  return g;
}

export interface CornerOptions {
  /** The character module's factory (after `preload`) for real cornermen; null: capsule stand-ins; omitted: no crew. */
  factory?: CharacterFactory | null;
  quality?: QualitySettings | null;
}

export class CornerRest {
  readonly object3d: THREE.Group;
  readonly spots: [CornerSpot, CornerSpot] | null;
  /** The cornermen (null: none staged). */
  readonly crew: CornerCrew | null = null;
  private readonly stools: THREE.Group;
  private windows: BreakWindow[] = [];
  private readonly walkers: FigurePoser[];
  private readonly scratch: Pose[];
  private readonly worlds: WorldPose[];
  private readonly seated: Pose;
  private readonly finals: WorldPose[];
  /** The rest state per fighter after the last `apply` (debug, camera). */
  readonly state: RestState[] = [];

  constructor(bout: BoutPresentation, private readonly rests: readonly RestSkeleton[], opts: CornerOptions = {}) {
    const oneOnOne = bout.fighters.length === 2 && (bout.teamOf[0] ?? 0) !== (bout.teamOf[1] ?? 1);
    this.spots = oneOnOne ? cornerSpots(bout.arena) : null;
    this.object3d = new THREE.Group();
    this.object3d.name = 'corner';
    this.stools = this.spots ? buildStools(this.spots) : new THREE.Group();
    this.stools.visible = false;
    this.object3d.add(this.stools);
    if (this.spots && opts.factory !== undefined) {
      try {
        this.crew = new CornerCrew(bout, this.spots, opts.factory ?? null, opts.quality ?? null);
        this.object3d.add(this.crew.object3d);
      } catch (err) {
        console.warn('[corner] crew failed, stools only:', err);
      }
    }
    this.walkers = rests.map((r) => new FigurePoser(r));
    this.scratch = rests.map(() => createPose());
    this.seated = createPose();
    this.worlds = rests.map(() => createWorldPose());
    this.finals = rests.map(() => createWorldPose());
  }

  setRecording(frames: readonly TickSnapshot[], events: readonly SimEvent[]): void {
    this.windows = this.spots ? breakWindows(frames, events) : [];
  }

  /** The break containing sim time `simTime`, if any. */
  windowAt(simTime: number): BreakWindow | null {
    const tick = simTime / TICK_S;
    return this.windows.find((w) => tick >= w.fromTick && tick <= w.toTick) ?? null;
  }

  /** Overwrite `poses` (the animator's) during a rest period. Returns true while one is on. */
  apply(input: FrameInput, poses: Pose[], realDt: number): boolean {
    void realDt;
    this.state.length = 0;
    const w = this.spots ? this.windowAt(input.simTime) : null;
    this.stools.visible = !!w;
    if (!w || !this.spots) {
      this.crew?.apply(null, [], [], input.simTime);
      return false;
    }
    const t = input.simTime - w.fromTick * TICK_S;
    for (let i = 0; i < poses.length && i < 2; i++) {
      const spot = this.spots[i]!;
      const st = restState(w, i, spot, t);
      this.state.push(st);
      if (st.weight <= 0) continue;
      const rest = this.rests[i]!;
      const target = this.scratch[i]!;
      // Walking: a fighter's gait, arms loose, head a little down.
      this.walkers[i]!.evaluate({
        x: st.x, z: st.z, facing: st.facing, walked: st.walked, speed: st.speed, style: 'fighter', time: input.simTime,
      }, target, this.worlds[i]!);
      if (st.seat > 0) {
        const breath = Math.sin(input.simTime * 2.4 + i) * 0.5 + 0.5;
        seatedPose(this.seated, this.worlds[i]!, rest, st.x, st.z, st.facing, breath);
        blendPose(target, target, this.seated, st.seat);
      }
      // The animator's face (breathing, fatigue) stays.
      target.face.set(poses[i]!.face);
      // Over the planted feet (a plain pose blend dipped them 10 cm into the
      // canvas and skated them at the bell); a foot planted elsewhere steps.
      if (st.weight >= 1) copyPose(poses[i]!, target);
      else {
        forwardKinematics(this.worlds[i]!, target, rest);
        fadeKeepFeet(target, this.worlds[i]!, poses[i]!, 1 - st.weight, rest);
        copyPose(poses[i]!, target);
      }
    }
    const spots = this.spots;
    if (this.crew) {
      for (let i = 0; i < poses.length && i < 2; i++) forwardKinematics(this.finals[i]!, poses[i]!, this.rests[i]!);
      const timing = [0, 1].map((i) => breakTiming(w, i, spots[i]!));
      const stools = this.crew.apply(t, timing, this.finals, input.simTime);
      this.stools.children.forEach((g, i) => {
        const s = stools[i];
        g.visible = !!s;
        if (s) {
          g.position.set(s.x, s.y, s.z);
          g.rotation.y = s.yaw;
        }
      });
    } else {
      this.stools.children.forEach((g, i) => {
        const sp = spots[i]!;
        g.visible = true;
        g.position.set(sp.stool[0], 0, sp.stool[1]);
      });
    }
    return true;
  }

  /** Contact-shadow spheres for the arena (cornermen, stools on the canvas). */
  occluders(): [number, number, number, number][] {
    if (!this.stools.visible) return [];
    const out = this.crew ? this.crew.occluders() : [];
    for (const g of this.stools.children) {
      if (g.visible) out.push([g.position.x, g.position.y + 0.3, g.position.z, 0.2]);
    }
    return out;
  }

  /** Cornermen level of detail from the camera (the presenter's distance rule). */
  setLOD(cam: readonly number[], lodFor: (d: number) => 0 | 1 | 2 | 3): void {
    this.crew?.setLOD(cam, lodFor);
  }

  dispose(): void {
    this.crew?.dispose();
    this.object3d.removeFromParent();
    this.stools.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
  }
}
