/**
 * THE POST-FIGHT STAGING — the bodies after the bout, from the script.
 *
 * `timeline.ts` says who goes where and when (pure). This module turns it
 * into pictures while the playhead rests on the last recorded frame:
 *
 *   - the post clock: seconds of live picture at the end. It runs while the
 *     playhead rests on the last frame, pauses while an instant replay is on
 *     air (the finish replay airs part-way through, `timeline.replayAt`) and
 *     starts again from zero after any seek;
 *   - the fighters: the animator keeps evaluating the last frame with its
 *     clock advanced by the post clock (so breathing, blinks and the lying
 *     pose carry on), and this layer blends scripted poses over it
 *     (`people/figure.ts`: walking away with the fighter gait, arms up to the
 *     crowd, sitting up and getting up off the canvas, standing on the marks,
 *     the raised arm);
 *   - the referee: a scripted placement (handed to the arena set so his
 *     contact shadow follows) and scripted hands: waving it off, down on a knee
 *     beside the loser, then the wrists — palm centres solved exactly onto the
 *     fighters' wrist joints (`grip.ts`), low, then the winner's raised.
 *
 * Deterministic: the paths, marks and timing are pure functions of the
 * recording and the post clock. What the layer captures when the post-roll
 * starts (where the loser's body lies, where the referee was standing) comes
 * from poses that are themselves functions of the recording. Presentation
 * only: nothing here reads or writes sim state.
 */
import type { SimEvent, TickSnapshot } from '../../sim';
import type { BoutPresentation, FrameInput } from '../contract';
import {
  B, blendPose, copyPose, createPose, createWorldPose, forwardKinematics,
  type Pose, type RestSkeleton, type WorldPose,
} from '../rig/skeleton';
import type { RefereeGesture, RefereePlacement } from '../arena/referee';
import type { RefereeExtras } from '../referee/pose';
import { FigurePoser, floorSitPose, type FigureCue, type HandGoal, type V3 } from '../people/figure';
import { makeCameraArena } from '../camera/geometry';
import { palmTargetFor } from './grip';
import { fadeKeepFeet } from '../anim/blend';
import { LYING_CLEAR_M } from '../anim/animator';
import { FinishCapture, celebrationStart, type PlacedClip, type RiseWindow } from './capture';
import { registeredMotionLibrary } from '../anim/capture';
import type { MotionLibrary } from '../assets/motionLibrary';
import {
  CLINCH_BREAK_S, RAISE_S, celebrationSpot, ceremonyMarks, clinchBreakAt, clinchEnd, displayedEnd, displayedPair,
  finishResult, finishTimeline, keepInside, samplePath, separatePoints, smooth, toward,
  type CeremonyMarks, type ClinchEnd, type FinishResult, type FinishTimeline, type Leg, type P2,
} from './timeline';

export * from './timeline';
export * from './grip';

/** Seconds the captured get-up takes to hand the loser over to the standing figure. */
const GETUP_HANDOVER_S = 0.6;

/** The referee's rest when none is given (a 1.80 m official). */
const REF_K = 1.8 / 1.733;

interface Lying {
  hips: P2;
  chest: P2;
  /** Where his legs point (hips to feet). */
  facing: number;
  points: P2[];
}

interface Script {
  /** Fighter indices: `a` stands on the winner's mark (fighter 0 when nobody won). */
  a: number;
  b: number;
  marks: CeremonyMarks;
  aLegs: Leg[];
  bLegs: Leg[];
  refLegs: Leg[];
  /** The winner's celebration spot (stoppage) or where `a` goes to (decision). */
  cel: P2;
  lying: Lying | null;
  /** Where the loser stands up. */
  up: P2;
  attend: P2 | null;
  /** The downed / hurt fighter's chest (what the referee reaches toward). */
  chest: P2;
  /**
   * The loser's get-up from the capture (`ground.get_up_*`): the placed take,
   * its rise, and the post time the rise starts (it ends on `standUp[1]`).
   */
  getup: { clip: PlacedClip; rise: RiseWindow; ts: number; rate: number } | null;
  /** The winner's celebration from the capture (`celebrate.victory_*`), from post time `t0`. */
  celebrate: { clip: PlacedClip; t0: number; t1: number } | null;
}

export interface FinishRefereeScript {
  placement: RefereePlacement;
  extra: RefereeExtras;
}

const outward = (p: P2): number => (Math.hypot(p[0], p[1]) > 0.05 ? Math.atan2(p[0], p[1]) : 0);

/** `p` moved (if needed) to at least `r` from the segment h→e, on its own side. */
function offBodyLine(p: P2, h: P2, e: P2, r: number): P2 {
  const ex = e[0] - h[0], ez = e[1] - h[1];
  const L2 = ex * ex + ez * ez;
  const k = L2 > 1e-6 ? Math.max(0, Math.min(1, ((p[0] - h[0]) * ex + (p[1] - h[1]) * ez) / L2)) : 0;
  const cx = h[0] + ex * k, cz = h[1] + ez * k;
  let dx = p[0] - cx, dz = p[1] - cz;
  let d = Math.hypot(dx, dz);
  if (d >= r) return p;
  if (d < 1e-4) {
    // On the line: out to the side (perpendicular), or away from the hips.
    if (L2 > 1e-6) { const l = Math.sqrt(L2); dx = -ez / l; dz = ex / l; } else { dx = 1; dz = 0; }
    d = 1;
  }
  return [cx + dx / d * r, cz + dz / d * r];
}

export class FinishStage {
  result: FinishResult | null = null;
  timeline: FinishTimeline | null = null;
  /**
   * The bout ended with the pair tied up on their feet: the referee's break.
   * The animator is shown the pair released and stepping apart (standing, the
   * engagement gone, positions opening to `CLINCH_BREAK_M` over the first
   * 0.65 s), so the footwork walks them out of the clinch facing each other
   * before the scripted poses take over — instead of ~0.8 s of the clinch pose
   * blending out chest to chest while the referee steps in.
   */
  clinch: ClinchEnd | null = null;
  /** Seconds of live post-roll so far, or null outside it. */
  postTime: number | null = null;
  private lastTick = Infinity;
  private frames: readonly TickSnapshot[] = [];
  private clockS = 0;
  private wasReplay = false;
  private atEndBefore = false;
  private script: Script | null = null;
  private refStart: RefereePlacement | null = null;
  /** Sticky separation directions of the walkers (see `separatePoints`), per script. */
  private sepMemo = new Map<string, P2>();
  private readonly posers: FigurePoser[];
  private readonly scratch: Pose[];
  private readonly worlds: WorldPose[];
  private readonly sit: Pose;
  private readonly sitWorld: WorldPose;
  /** Motion capture per fighter for the get-up and the celebration (built when a library is registered). */
  private fcap: (FinishCapture | null)[] = [];
  private fcapLib: MotionLibrary | null = null;
  private readonly capPose: Pose = createPose();
  private readonly capWorld: WorldPose = createWorldPose();
  private refPlacement: RefereePlacement | null = null;
  private refGesture: RefereeGesture = 'watch';
  /** How far the fighters' held hands are on their wrist goals this frame (0..1). */
  private gripW = 0;
  private readonly ca;
  readonly hardCamera: V3;

  constructor(private readonly bout: BoutPresentation, private readonly rests: readonly RestSkeleton[], private readonly refRest: RestSkeleton | null = null) {
    this.posers = rests.map((r) => new FigurePoser(r));
    this.scratch = rests.map(() => createPose());
    this.worlds = rests.map(() => createWorldPose());
    this.sit = createPose();
    this.sitWorld = createWorldPose();
    this.ca = makeCameraArena(bout.arena, null);
    const az = this.ca.mainAzimuth;
    const r = this.ca.mainRadius || 8;
    this.hardCamera = [Math.sin(az) * r, 4.3, Math.cos(az) * r];
  }

  /** Once per bout: the result and the timing of the script. */
  setRecording(frames: readonly TickSnapshot[], events: readonly SimEvent[]): void {
    this.frames = frames;
    const oneOnOne = this.bout.fighters.length === 2 && this.rests.length === 2 && this.bout.arena.shape !== 'unbounded';
    this.result = oneOnOne ? finishResult(frames, events) : null;
    this.timeline = this.result ? finishTimeline(this.result) : null;
    this.clinch = this.result ? clinchEnd(frames) : null;
    this.lastTick = frames.length ? frames[frames.length - 1]!.tick : Infinity;
    this.script = null;
    this.clockS = 0;
    this.postTime = null;
  }

  /**
   * Advance the post clock for this frame. Returns the post time (seconds of
   * live picture since the end) or null when the post-roll is not showing.
   */
  clock(input: FrameInput, realDt: number): number | null {
    if (!this.timeline) { this.postTime = null; return null; }
    if (input.replay) {
      this.wasReplay = true;
      this.postTime = null;
      return null;
    }
    const atEnd = input.frame.tick >= this.lastTick;
    if (!atEnd) {
      this.clockS = 0;
      this.atEndBefore = false;
      this.wasReplay = false;
      this.script = null;
      this.postTime = null;
      return null;
    }
    if (!this.atEndBefore || (input.discontinuity && !this.wasReplay)) {
      // Arrived at the end (by playing or seeking): the post-roll starts.
      this.clockS = 0;
      this.script = null;
    } else {
      this.clockS += Math.max(0, Math.min(0.25, realDt));
    }
    this.atEndBefore = true;
    this.wasReplay = false;
    this.postTime = this.clockS;
    return this.clockS;
  }

  /** The animator's input during the post-roll: the last frame, its clock advanced. */
  animatorInput(input: FrameInput): FrameInput {
    const t = this.postTime;
    if (t === null) return input;
    const c = this.clinch;
    if (!c) return { ...input, next: null, alpha: 0, simTime: input.simTime + t };
    // The referee's break: released, standing, stepping apart.
    const sep = clinchBreakAt(c, t);
    const f0 = input.frame;
    const frame: TickSnapshot = {
      ...f0,
      engagements: f0.engagements.filter((e) => e.kind === 'knockdown'),
      fighters: f0.fighters.map((f, i) => ({
        ...f,
        x: sep[i]?.[0] ?? f.x,
        z: sep[i]?.[1] ?? f.z,
        posture: f.posture === 'clinch' ? 'standing' : f.posture,
        role: 'none',
        partnerId: null,
      })),
    };
    return { ...input, frame, next: null, alpha: 0, simTime: input.simTime + t };
  }

  /**
   * Overwrite the animator's `poses` for the post-roll. `referee` is where the
   * official stands right now (before this frame's script), used once as the
   * start of his path.
   */
  apply(poses: Pose[], referee: RefereePlacement | null): boolean {
    const t = this.postTime;
    const tl = this.timeline;
    const r = this.result;
    this.refPlacement = null;
    this.gripW = 0;
    if (t === null || !tl || !r || poses.length < 2) return false;
    if (!this.script) { this.script = this.build(poses, referee); this.sepMemo.clear(); }
    const sc = this.script;
    if (!sc) return false;

    const stoppage = tl.kind === 'stoppage';
    // ---- where everyone is -------------------------------------------------
    const pa = samplePath(sc.aLegs, t);
    const pb = samplePath(sc.bLegs, t);
    const pr = samplePath(sc.refLegs, t);
    const bStanding = !sc.lying || (tl.standUp !== null && t >= tl.standUp[1]);
    const attending = !!tl.attend && t >= tl.attend[0] && t <= tl.attend[1];
    const pts: P2[] = [[pr.x, pr.z], [pa.x, pa.z]];
    const fixed = [attending, false];
    if (bStanding) { pts.push([pb.x, pb.z]); fixed.push(false); }
    const obstacles = sc.lying && !bStanding ? sc.lying.points.map((p) => ({ p, r: 0.42 })) : [];
    // Once the referee holds them everyone is on his mark (the separation is
    // off). The switch used to be a step at hold - 0.25 s: a fighter the
    // separation had kept off his mark (up to 48 cm) jumped onto it in one
    // frame. Now the separated points ease onto the marks over the 0.6 s
    // before it.
    const holdW = smooth((t - (tl.hold - 0.85)) / 0.6);
    const sep = holdW >= 1 ? pts.map((p) => [p[0], p[1]] as P2) : separatePoints(pts, fixed, 0.58, obstacles, this.sepMemo);
    if (holdW > 0 && holdW < 1) {
      for (let k = 0; k < sep.length; k++) {
        if (k === 0 && attending) continue;
        sep[k] = [sep[k]![0] + (pts[k]![0] - sep[k]![0]) * holdW, sep[k]![1] + (pts[k]![1] - sep[k]![1]) * holdW];
      }
    }
    // The referee may kneel close to the downed man; the obstacles keep the others off him.
    const refXZ = attending ? pts[0]! : sep[0]!;
    const aXZ = sep[1]!;
    const bXZ = bStanding ? sep[2]! : [pb.x, pb.z] as P2;

    // ---- the grips (hold and raise) ---------------------------------------------
    const m = sc.marks;
    const F: V3 = [Math.sin(m.facing), 0, Math.cos(m.facing)];
    const raiseE = tl.raises ? smooth((t - tl.raise) / RAISE_S) : 0;
    const gripW = smooth((t - (tl.hold - 0.6)) / 0.6);
    this.gripW = t >= tl.hold - 0.6 ? gripW : 0;
    const drawRaise = r.kind === 'decision' && r.winner < 0;
    const G = (fighter: number, side: 1 | -1, up: boolean): V3 => {
      const lo = this.gripLow(fighter, side);
      if (!up || raiseE <= 0) return lo;
      const hi = this.gripHigh(fighter, side);
      const bulge = Math.sin(Math.PI * raiseE) * 0.12;
      return [
        lo[0] + (hi[0] - lo[0]) * raiseE + F[0] * bulge,
        lo[1] + (hi[1] - lo[1]) * raiseE,
        lo[2] + (hi[2] - lo[2]) * raiseE + F[2] * bulge,
      ];
    };
    // `a` holds his inner (referee-side) hand on side s (body-left terms), `b` on -s.
    const s = m.side;
    const aRaised = tl.raises && (r.winner >= 0 || drawRaise);
    const bRaised = drawRaise;

    // ---- fighter a: the winner (or fighter 0) --------------------------------------
    {
      const i = sc.a;
      const cue = this.baseCue(pa, aXZ, t);
      // After a clinch the animator walks him out of it first (see `clinch`).
      const brk = this.clinch ? CLINCH_BREAK_S[0] + CLINCH_BREAK_S[1] - 0.15 : 0;
      let w = smooth((t - brk) / (this.clinch ? 0.6 : 0.8));
      const hands: [HandGoal | null, HandGoal | null] = [null, null];
      const cel = tl.celebrate;
      const upW = smooth((t - (tl.walkOff[0] + 0.4)) / 0.9) * (1 - smooth((t - (cel[1] - 0.2)) / 0.7));
      if (upW > 0) {
        const amp = t > cel[0] ? 0.5 + 0.5 * Math.sin(1.3 * (t - cel[0]) - Math.PI / 2) : 0;
        const ph = 5.2 * t;
        hands[0] = { kind: 'up', w: upW, spread: 0.45, pump: amp * (0.5 + 0.5 * Math.sin(ph)) };
        hands[1] = { kind: 'up', w: upW, spread: 0.45, pump: amp * (0.5 + 0.5 * Math.sin(ph + Math.PI)) };
        if (t > cel[0] && t < cel[1]) {
          // Turn to the crowd: a slow sweep either side of facing out, turned
          // into from (and back to) his path's facing — the celebration of a
          // decision starts while he is still walking off, and snapping to face
          // out flipped the body (and its planted feet) in one frame.
          const u = (t - cel[0]) / (cel[1] - cel[0]);
          const crowd = outward(sc.cel) + 0.75 * Math.sin(2 * Math.PI * u) * smooth((t - cel[0]) / 0.8);
          const into = smooth((t - cel[0]) / 0.8) * (1 - smooth((t - (cel[1] - 0.8)) / 0.8));
          cue.facing = cue.facing + Math.atan2(Math.sin(crowd - cue.facing), Math.cos(crowd - cue.facing)) * into;
          cue.look = [sc.cel[0] + Math.sin(cue.facing) * 9, 3.6, sc.cel[1] + Math.cos(cue.facing) * 9];
        }
      }
      if (t >= tl.hold - 0.6) {
        const inner = s > 0 ? 0 : 1;
        hands[inner] = { kind: 'at', p: G(i, s, aRaised), w: gripW, pole: this.innerPole(aXZ, m, s) };
        const outer = 1 - inner;
        const outW = aRaised && !drawRaise ? smooth((t - (tl.raise + 0.3)) / 0.6) : 0;
        hands[outer] = outW > 0 ? { kind: 'up', w: outW, spread: 0.35, pump: 0.15 } : null;
        cue.look = raiseE > 0.5 && aRaised ? [aXZ[0] + F[0] * 6, 2.6, aXZ[1] + F[2] * 6] : [aXZ[0] + F[0] * 8, 1.75, aXZ[1] + F[2] * 8];
      }
      cue.hands = hands;
      if (!stoppage && t < 0.8 && !this.clinch) w = smooth(t / 0.8);
      this.pose(i, cue, poses, w);
      if (sc.celebrate) this.poseCelebration(i, sc, t, poses);
      if (stoppage || aRaised) poses[i]!.face[3] = 0.25 + 0.25 * Math.sin(t * 2.3); // breathing hard, mouth open
    }

    // ---- fighter b: the loser (or fighter 1) ------------------------------------------
    {
      const i = sc.b;
      const cue = this.baseCue(pb, bXZ, t);
      cue.look = [bXZ[0] + Math.sin(cue.facing) * 1.6, 0.2, bXZ[1] + Math.cos(cue.facing) * 1.6];
      cue.bend = 0.12;
      const hands: [HandGoal | null, HandGoal | null] = [null, null];
      const brkB = this.clinch ? CLINCH_BREAK_S[0] + CLINCH_BREAK_S[1] - 0.15 : 0;
      let w = smooth((t - brkB) / (this.clinch ? 0.6 : 0.8));
      if (!stoppage) {
        // A decision: he celebrates too (he thinks he won), then walks in.
        const cel = tl.celebrate;
        const upW = smooth((t - (tl.walkOff[0] + 0.5)) / 0.9) * (1 - smooth((t - (cel[1] - 0.3)) / 0.7));
        if (upW > 0) {
          hands[0] = { kind: 'up', w: upW * 0.9, spread: 0.5, pump: 0.2 };
          hands[1] = { kind: 'up', w: upW * 0.9, spread: 0.5, pump: 0.2 };
          cue.look = [bXZ[0] + Math.sin(cue.facing) * 9, 3.4, bXZ[1] + Math.cos(cue.facing) * 9];
        }
        cue.bend = 0;
      } else if (tl.bentOver) {
        // Hurt on his feet: bent over, hands on his knees, then straightens.
        const bo = smooth((t - tl.bentOver[0]) / 0.8) * (1 - smooth((t - (tl.bentOver[1] - 0.9)) / 0.9));
        cue.bend = 0.12 + 0.7 * bo;
        cue.crouch = 0.22 * bo;
        hands[0] = { kind: 'knee', w: bo };
        hands[1] = { kind: 'knee', w: bo };
        w = this.clinch ? smooth((t - brkB) / 0.6) : smooth((t - 0.2) / 0.8);
      } else if (bStanding && tl.standUp && t < tl.regroup[1] - 1.5) {
        // Up, catching his breath: hands on hips.
        const hw = smooth((t - tl.standUp[1]) / 0.6) * (1 - smooth((t - (tl.regroup[1] - 2.6)) / 0.8));
        hands[0] = { kind: 'hips', w: hw * 0.9 };
        hands[1] = { kind: 'hips', w: hw * 0.9 };
      }
      if (t >= tl.hold - 0.6) {
        const inner = s > 0 ? 1 : 0;
        hands[inner] = { kind: 'at', p: G(i, (-s) as 1 | -1, bRaised), w: gripW, pole: this.innerPole(bXZ, m, (-s) as 1 | -1) };
        cue.look = bRaised ? [bXZ[0] + F[0] * 8, 1.75, bXZ[1] + F[2] * 8] : [bXZ[0] + F[0] * 3, 0.9, bXZ[1] + F[2] * 3];
        cue.bend = bRaised ? 0 : 0.08;
      }
      cue.hands = hands;
      if (sc.getup && tl.standUp && t < tl.standUp[1] + GETUP_HANDOVER_S) {
        this.poseGetUpCapture(i, sc, tl.standUp[1], t, cue, poses, w);
      } else if (sc.lying && stoppage && tl.sitUp && tl.standUp && t < tl.standUp[1]) {
        this.poseGettingUp(i, sc, tl, t, cue, poses);
      } else {
        this.pose(i, cue, poses, w);
      }
    }

    // ---- the referee -------------------------------------------------------------
    let gesture: RefereeGesture = 'watch';
    let focusId = -1;
    let crouch = 0;
    if (tl.wave && t < tl.wave[1]) { gesture = 'waveOff'; focusId = sc.b; crouch = sc.lying ? 0.25 : 0.05; }
    else if (attending) { gesture = 'attend'; focusId = sc.b; }
    if (t >= tl.hold - 0.3) { gesture = raiseE > 0 ? 'raise' : 'present'; focusId = raiseE > 0 ? sc.a : -1; }
    this.refGesture = gesture;
    const facing = attending || gesture === 'waveOff' ? pr.facing : pr.facing;
    this.refPlacement = {
      present: true, x: refXZ[0], z: refXZ[1], facing, crouch, gesture, focusId, count: 0,
    };
    return true;
  }

  /** The referee's scripted placement this frame (after `apply`), or null. */
  refereePlacement(): RefereePlacement | null {
    return this.refPlacement;
  }

  /**
   * The referee's script for this frame, from the fighters' final world poses
   * (after `apply` and forward kinematics): his placement, the wave, the knee,
   * the hand on the loser and the grips on both wrists.
   */
  refereeScript(worlds: readonly WorldPose[]): FinishRefereeScript | null {
    const t = this.postTime;
    const tl = this.timeline;
    const sc = this.script;
    const place = this.refPlacement;
    if (t === null || !tl || !sc || !place) return null;
    const extra: RefereeExtras = { time: t };
    if (tl.wave) extra.wave = smooth(t / 0.25) * (1 - smooth((t - (tl.wave[1] - 0.45)) / 0.45));
    const fwd: V3 = [Math.sin(place.facing), 0, Math.cos(place.facing)];
    const left: V3 = [Math.cos(place.facing), 0, -Math.sin(place.facing)];
    if (tl.attend && t >= tl.attend[0] - 0.3 && t <= tl.attend[1] + 0.3) {
      const lw = worlds[sc.b];
      if (sc.lying) {
        extra.kneel = smooth((t - (tl.attend[0] + 0.3)) / 0.6) * (1 - smooth((t - (tl.attend[1] - 0.5)) / 0.5));
      }
      if (lw) {
        // One hand on him: his near shoulder once he is up on his seat, over his chest while he is down.
        const sat = !sc.lying || (tl.sitUp !== null && t >= tl.sitUp[1] - 0.2);
        const target = this.nearShoulder(lw, place, sat);
        const near = (target[0] - place.x) * left[0] + (target[2] - place.z) * left[2] > 0 ? 0 : 1;
        const reach: [V3 | null, V3 | null] = [null, null];
        reach[near] = target;
        // The other hand on his own knee (kneeling) or in front of him.
        reach[1 - near] = [
          place.x + fwd[0] * 0.3 + left[0] * (near === 0 ? -0.18 : 0.18),
          sc.lying ? 0.55 : 0.95,
          place.z + fwd[2] * 0.3 + left[2] * (near === 0 ? -0.18 : 0.18),
        ];
        extra.reach = reach;
      }
    }
    // In the centre he looks out at the hard camera (the crowd), not at his feet.
    if (t >= tl.regroup[1] - 0.6) extra.look = [this.hardCamera[0], 1.7, this.hardCamera[2]];
    if (t >= tl.hold - 0.8) {
      // The wrists: reached for (smoothed) while the fighters' hands come in,
      // then held exactly (palm centre on the wrist) from the hold on.
      const m = sc.marks;
      const s = m.side;
      const palms: [V3 | null, V3 | null] = [null, null];
      // Referee hand toward a (the winner's side: his body side -s), toward b (side s).
      for (const [fi, refSide, fighterSide] of [[sc.a, (-s) as 1 | -1, s], [sc.b, s, (-s) as 1 | -1]] as const) {
        const w = worlds[fi];
        if (!w) continue;
        const hand = fighterSide > 0 ? B.lHand : B.rHand;
        const wrist: V3 = [w.pos[hand * 3], w.pos[hand * 3 + 1], w.pos[hand * 3 + 2]];
        palms[refSide > 0 ? 0 : 1] = palmTargetFor(wrist, this.refShoulder(refSide));
      }
      if (this.gripW >= 0.999) extra.grips = palms;
      else extra.reach = palms;
    }
    return { placement: place, extra };
  }

  // -------------------------------------------------------------------------

  private baseCue(p: { x: number; z: number; facing: number; walked: number; speed: number }, xz: P2, t: number): FigureCue {
    return { x: xz[0], z: xz[1], facing: p.facing, walked: p.walked, speed: p.speed, time: t, style: 'fighter' };
  }

  private pose(i: number, cue: FigureCue, poses: Pose[], w: number): void {
    const out = poses[i];
    if (!out || w <= 0) return;
    const face = new Float32Array(out.face);
    const target = this.scratch[i]!;
    this.posers[i]!.evaluate(cue, target, this.worlds[i]!);
    target.face.set(face);
    if (w >= 1) { copyPose(out, target); return; }
    // Over the planted feet: the animator's last pose and the script's figure
    // rarely stand on the same spot, and a plain blend dipped and skated the feet.
    forwardKinematics(this.worlds[i]!, target, this.rests[i]!);
    fadeKeepFeet(target, this.worlds[i]!, out, 1 - w, this.rests[i]!);
    copyPose(out, target);
  }

  /**
   * The loser from the canvas to his feet from the capture: the animator's
   * lying pose crossfades onto the take's own lying frame (0.8 s before the
   * rise), the take plays the rise at its own speed (faster only if the script
   * leaves less time) ending on `standUp`, then hands over to the standing
   * figure over `GETUP_HANDOVER_S`.
   */
  private poseGetUpCapture(i: number, sc: Script, standUp: number, t: number, cue: FigureCue, poses: Pose[], w: number): void {
    const g = sc.getup!;
    const fc = this.fcap[i];
    const out = poses[i]!;
    if (!fc) return;
    const lead = 0.8;
    if (t < g.ts - lead) return; // still the animator's lying pose (breathing)
    const clipT = g.rise.start + (t - g.ts) * g.rate;
    const face = new Float32Array(out.face);
    if (t >= standUp) this.pose(i, cue, poses, w); // the figure he hands over to
    fc.pose(g.clip, clipT, this.capPose, this.capWorld);
    this.capPose.face.set(face);
    const wIn = smooth((t - (g.ts - lead)) / lead);
    const wOut = 1 - smooth((t - standUp) / GETUP_HANDOVER_S);
    blendPose(out, out, this.capPose, Math.min(wIn, wOut));
  }

  /** The winner's celebration from the capture, blended over the scripted figure. */
  private poseCelebration(i: number, sc: Script, t: number, poses: Pose[]): void {
    const c = sc.celebrate!;
    const fc = this.fcap[i];
    if (!fc || t < c.t0 || t > c.t1) return;
    const out = poses[i]!;
    const wc = smooth((t - c.t0) / 0.7) * (1 - smooth((t - (c.t1 - 0.7)) / 0.7));
    if (wc <= 0) return;
    fc.pose(c.clip, c.clip.from + (t - c.t0), this.capPose, this.capWorld);
    this.capPose.face.set(out.face);
    blendPose(out, out, this.capPose, wc);
  }

  /** The capture as seen by fighter `i` (null without a motion library). */
  private capFor(i: number): FinishCapture | null {
    const lib = registeredMotionLibrary();
    if (lib !== this.fcapLib) {
      this.fcapLib = lib;
      this.fcap = this.rests.map(() => null);
    }
    if (!lib) return null;
    if (!this.fcap[i]) this.fcap[i] = new FinishCapture(lib, this.rests[i]!);
    return this.fcap[i]!;
  }

  /** The loser from the canvas to his feet: lying (the animator) → sitting → a knee → standing. */
  private poseGettingUp(i: number, sc: Script, tl: FinishTimeline, t: number, cue: FigureCue, poses: Pose[]): void {
    const out = poses[i]!;
    const ly = sc.lying!;
    const sitUp = tl.sitUp!;
    const up = tl.standUp!;
    const rest = this.rests[i]!;
    if (t < sitUp[0]) return; // still down: the animator's lying pose
    const breath = Math.sin(t * 2.2);
    const slump = 1 - 0.6 * smooth((t - sitUp[1]) / 2);
    floorSitPose(this.sit, this.sitWorld, rest, ly.hips[0], ly.hips[1], ly.facing, slump, breath);
    this.sit.face.set(out.face);
    if (this.result?.ko) this.sit.face[5] = Math.max(this.sit.face[5]!, 0.4 * slump);
    if (t < up[0]) {
      blendPose(out, out, this.sit, smooth((t - sitUp[0]) / (sitUp[1] - sitUp[0])));
      return;
    }
    // Up: over a knee, then standing.
    const kneelEnd = up[0] + 0.8;
    const k = t < kneelEnd ? 1 : 1 - smooth((t - kneelEnd) / (up[1] - kneelEnd));
    const c: FigureCue = {
      ...cue, x: sc.up[0], z: sc.up[1], facing: ly.facing, walked: 0, speed: 0, kneel: k, bend: 0.35 * k + 0.12,
      hands: [{ kind: 'knee', w: k }, { kind: 'knee', w: 0.6 * k }],
    };
    this.posers[i]!.evaluate(c, this.scratch[i]!, this.worlds[i]!);
    this.scratch[i]!.face.set(out.face);
    if (t < kneelEnd) {
      copyPose(out, this.sit);
      blendPose(out, out, this.scratch[i]!, smooth((t - up[0]) / 0.8));
    } else {
      copyPose(out, this.scratch[i]!);
    }
  }

  /** Where the referee's hand goes on the loser: his near shoulder (up) or over his chest (down). */
  private nearShoulder(w: WorldPose, place: RefereePlacement, up: boolean): V3 {
    if (!up) {
      const c = B.spine2 * 3;
      return [w.pos[c] + (place.x - w.pos[c]) * 0.2, w.pos[c + 1] + 0.28, w.pos[c + 2] + (place.z - w.pos[c + 2]) * 0.2];
    }
    const l = B.lArm * 3;
    const r = B.rArm * 3;
    const dl = Math.hypot(w.pos[l] - place.x, w.pos[l + 2] - place.z);
    const dr = Math.hypot(w.pos[r] - place.x, w.pos[r + 2] - place.z);
    const j = dl < dr ? l : r;
    return [w.pos[j], w.pos[j + 1] + 0.07, w.pos[j + 2]];
  }

  /** Estimated shoulder (upper-arm head) of the referee standing on the centre mark; side +1 = his left. */
  private refShoulder(side: 1 | -1): V3 {
    const m = this.script!.marks;
    const rr = this.refRest;
    const k = rr ? rr.statureM / 1.733 : REF_K;
    const x = rr ? Math.abs(rr.head[B.lArm * 3]) : 0.175 * k;
    const y = (rr ? rr.head[B.lArm * 3 + 1] : 1.403 * k) - 0.03 * k;
    const f = m.facing;
    return [m.centre[0] + Math.cos(f) * side * x + Math.sin(f) * 0.02, y, m.centre[1] - Math.sin(f) * side * x + Math.cos(f) * 0.02];
  }

  /** Estimated shoulder of fighter `i` standing on his mark, arm on body side `side`. */
  private fighterShoulder(i: number, side: 1 | -1): V3 {
    const m = this.script!.marks;
    const rest = this.rests[i]!;
    const at = i === this.script!.a ? m.winner : m.loser;
    const x = Math.abs(rest.head[B.lArm * 3]);
    const k = rest.statureM / 1.733;
    const y = rest.head[B.lArm * 3 + 1] - 0.04 * k;
    const f = m.facing;
    return [at[0] + Math.cos(f) * side * x + Math.sin(f) * 0.05 * k, y, at[1] - Math.sin(f) * side * x + Math.cos(f) * 0.05 * k];
  }

  private armOf(rest: RestSkeleton | null, k = REF_K): number {
    return rest ? rest.length[B.lArm] + rest.length[B.lForeArm] : 0.486 * k;
  }

  /** The wrist point held low (hanging hands, between the referee and fighter `i`). */
  private gripLow(i: number, side: 1 | -1): V3 {
    const A = this.refShoulder((-side) as 1 | -1);
    const Bs = this.fighterShoulder(i, side);
    const reach = 0.9 * Math.min(this.armOf(this.refRest), this.armOf(this.rests[i]!));
    const f = this.script!.marks.facing;
    const half = Math.hypot(A[0] - Bs[0], A[2] - Bs[2]) / 2;
    const dy = Math.sqrt(Math.max(0.01, reach * reach - half * half - 0.1 * 0.1));
    return [(A[0] + Bs[0]) / 2 + Math.sin(f) * 0.1, Math.min(A[1], Bs[1]) - dy, (A[2] + Bs[2]) / 2 + Math.cos(f) * 0.1];
  }

  /** The wrist point raised overhead between the referee's shoulder and fighter `i`'s. */
  private gripHigh(i: number, side: 1 | -1): V3 {
    const A = this.refShoulder((-side) as 1 | -1);
    const Bs = this.fighterShoulder(i, side);
    const reach = 0.9 * Math.min(this.armOf(this.refRest), this.armOf(this.rests[i]!));
    const f = this.script!.marks.facing;
    const half = Math.hypot(A[0] - Bs[0], A[2] - Bs[2]) / 2;
    const dy = Math.sqrt(Math.max(0.01, reach * reach - half * half - 0.08 * 0.08));
    return [(A[0] + Bs[0]) / 2 + Math.sin(f) * 0.08, Math.min(A[1], Bs[1]) + dy, (A[2] + Bs[2]) / 2 + Math.cos(f) * 0.08];
  }

  /** Elbow pole for a fighter's held arm: out from his side, a little back. */
  private innerPole(at: P2, m: CeremonyMarks, side: 1 | -1): V3 {
    const f = m.facing;
    return [at[0] + Math.cos(f) * side * 0.9 - Math.sin(f) * 0.3, 1.0, at[1] - Math.sin(f) * side * 0.9 - Math.cos(f) * 0.3];
  }

  /** Build the script once, when the post-roll starts. */
  private build(poses: Pose[], referee: RefereePlacement | null): Script | null {
    const r = this.result!;
    const tl = this.timeline!;
    const arena = this.bout.arena;
    // After a clinch the script starts where the break leaves them.
    const brkEnd = this.clinch ? clinchBreakAt(this.clinch, 99) : null;
    const ends = brkEnd ? displayedPair(brkEnd[0], brkEnd[1]) : displayedEnd(this.frames);
    if (!ends) return null;
    const a = r.winner >= 0 ? r.winner : 0;
    const b = r.winner >= 0 ? r.loser : 1;
    let A0 = ends[a]!;
    const B0 = ends[b]!;
    // Ended on the canvas (a submission, a stoppage on the ground): the winner's
    // recorded spot is on or under the loser. He stands up beside the body, as
    // the animator draws him (`LYING_CLEAR_M` off its hips–head line), not in it.
    const lastF = this.frames[this.frames.length - 1];
    if (lastF && lastF.fighters[b] && lastF.fighters[b]!.posture !== 'standing' && poses[b]) {
      const w = this.worlds[b]!;
      forwardKinematics(w, poses[b]!, this.rests[b]!);
      A0 = offBodyLine(A0, [w.pos[B.hips * 3]!, w.pos[B.hips * 3 + 2]!], [w.pos[B.head * 3]!, w.pos[B.head * 3 + 2]!], LYING_CLEAR_M * this.rests[a]!.statureM / 1.7332);
    }
    const marks = ceremonyMarks(arena, A0, B0);
    // The downed fighter as the animator lays him (it keeps evaluating the last frame).
    let lying: Lying | null = null;
    if (tl.kind === 'stoppage' && r.loserDown) {
      const w = this.worlds[b]!;
      forwardKinematics(w, poses[b]!, this.rests[b]!);
      const P = (bone: number): P2 => [w.pos[bone * 3], w.pos[bone * 3 + 2]];
      const hips = P(B.hips);
      const feet: P2 = [(w.pos[B.lFoot * 3] + w.pos[B.rFoot * 3]) / 2, (w.pos[B.lFoot * 3 + 2] + w.pos[B.rFoot * 3 + 2]) / 2];
      const head = P(B.head);
      const legDir = Math.hypot(feet[0] - hips[0], feet[1] - hips[1]) > 0.15 ? toward(hips, feet) : toward(head, hips);
      lying = { hips, chest: P(B.spine2), facing: legDir, points: [hips, head, feet, P(B.spine2)] };
    }
    const chest: P2 = lying ? lying.chest : B0;
    const refFrom: P2 = referee ? [referee.x, referee.z] : [(A0[0] + B0[0]) / 2 + 0.8, (A0[1] + B0[1]) / 2];
    const refFace0 = referee ? referee.facing : toward(refFrom, chest);
    const aLegs: Leg[] = [];
    const bLegs: Leg[] = [];
    const refLegs: Leg[] = [];
    let cel: P2;
    let up: P2 = B0;
    let attend: P2 | null = null;
    if (tl.kind === 'stoppage') {
      cel = celebrationSpot(arena, A0, lying ? lying.hips : B0, marks);
      aLegs.push({ t0: tl.walkOff[0], t1: tl.walkOff[1], from: A0, to: cel, face0: toward(A0, B0), face1: outward(cel) });
      aLegs.push({ t0: tl.regroup[0], t1: tl.regroup[1], from: cel, to: marks.winner, face0: outward(cel), face1: marks.facing });
      if (lying) {
        up = keepInside(arena, [lying.hips[0] + Math.sin(lying.facing) * 0.32, lying.hips[1] + Math.cos(lying.facing) * 0.32], 0.7);
        const go = Math.max(tl.standUp![1], tl.regroup[0]) + 0.15;
        bLegs.push({ t0: go, t1: Math.max(go + 1.8, tl.hold - 0.3), from: up, to: marks.loser, face0: lying.facing, face1: marks.facing });
      } else {
        bLegs.push({ t0: tl.regroup[0] + 0.3, t1: tl.regroup[1] + 0.2, from: B0, to: marks.loser, face0: toward(B0, A0), face1: marks.facing });
      }
      // Referee: in between (wave), then beside the loser, then the centre.
      const dx = A0[0] - chest[0];
      const dz = A0[1] - chest[1];
      const dl = Math.hypot(dx, dz) || 1;
      // Between the two (after a clinch: in the gap the break opened).
      const wave = this.clinch && !lying
        ? keepInside(arena, [(A0[0] + chest[0]) / 2 + (-dz / dl) * 0.12, (A0[1] + chest[1]) / 2 + (dx / dl) * 0.12], 0.5)
        : keepInside(arena, [chest[0] + (dx / dl) * 0.85 + (-dz / dl) * 0.12, chest[1] + (dz / dl) * 0.85 + (dx / dl) * 0.12], 0.5);
      // Beside his chest, on the side away from where the winner celebrates.
      const axis = lying ? lying.facing : toward(B0, A0);
      const px = Math.cos(axis);
      const pz = -Math.sin(axis);
      const sideAway = (px * (cel[0] - chest[0]) + pz * (cel[1] - chest[1])) > 0 ? -1 : 1;
      attend = keepInside(arena, [chest[0] + px * sideAway * (lying ? 0.6 : 0.72), chest[1] + pz * sideAway * (lying ? 0.6 : 0.72)], 0.5);
      refLegs.push({ t0: 0, t1: 0.7, from: refFrom, to: wave, face0: refFace0, face1: toward(wave, chest) });
      refLegs.push({ t0: tl.wave![1], t1: tl.attend![0] + 0.3, from: wave, to: attend, face0: toward(wave, chest), face1: toward(attend, chest) });
      refLegs.push({ t0: tl.attend![1] + 0.1, t1: tl.regroup[1] - 0.2, from: attend, to: marks.centre, face0: toward(attend, chest), face1: marks.facing });
    } else {
      const away = (p: P2, q: P2): P2 => {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
        return keepInside(arena, [p[0] + ((p[0] - q[0]) / d) * 1.2, p[1] + ((p[1] - q[1]) / d) * 1.2]);
      };
      cel = away(A0, B0);
      const bcel = away(B0, A0);
      aLegs.push({ t0: tl.walkOff[0], t1: tl.walkOff[1], from: A0, to: cel, face0: toward(A0, B0), face1: outward(cel) });
      aLegs.push({ t0: tl.regroup[0], t1: tl.regroup[1], from: cel, to: marks.winner, face0: outward(cel), face1: marks.facing });
      bLegs.push({ t0: tl.walkOff[0] + 0.1, t1: tl.walkOff[1] + 0.1, from: B0, to: bcel, face0: toward(B0, A0), face1: outward(bcel) });
      bLegs.push({ t0: tl.regroup[0] + 0.1, t1: tl.regroup[1] + 0.1, from: bcel, to: marks.loser, face0: outward(bcel), face1: marks.facing });
      refLegs.push({ t0: tl.regroup[0] - 0.4, t1: tl.regroup[1] - 0.6, from: refFrom, to: marks.centre, face0: refFace0, face1: marks.facing });
    }
    this.refStart = referee;
    // Motion capture for the get-up and the celebration, when the library is loaded.
    let getup: Script['getup'] = null;
    let celebrate: Script['celebrate'] = null;
    const last = this.frames[this.frames.length - 1];
    const clipStance = (k: number): string => (last?.fighters[k]?.stance === 'southpaw' ? 'southpaw' : 'orthodox');
    if (tl.kind === 'stoppage' && lying && tl.sitUp && tl.standUp) {
      const fc = this.capFor(b);
      if (fc) {
        // Which take: by how he lies (on his back, face down, on his side).
        const w = this.worlds[b]!;
        const q = B.spine2 * 4;
        const x = w.quat[q]!, y = w.quat[q + 1]!, z = w.quat[q + 2]!, qw = w.quat[q + 3]!;
        const chestFwd: V3 = [2 * (x * z + qw * y), 2 * (y * z - qw * x), 1 - 2 * (x * x + y * y)];
        const kind = chestFwd[1] > 0.35 ? 'back' : chestFwd[1] < -0.35 ? 'face_down' : 'side';
        const ids = [`ground.get_up_${kind}.${clipStance(b)}`, `ground.get_up_${kind}.${clipStance(b) === 'orthodox' ? 'southpaw' : 'orthodox'}`].filter((id) => fc.has(id));
        let best: { id: string; score: number } | null = null;
        for (const id of ids) {
          const rise = fc.riseWindow(id);
          const lieT = Math.max(0, rise.start - 0.8);
          const place = fc.placeLying(id, lieT, lying.hips, lying.facing);
          // Match the side he lies on: the take's chest direction against his.
          const f0 = fc.frame(id, lieT);
          const cf: V3 = [Math.sin(f0.chYaw) * Math.cos(f0.chPitch), -Math.sin(f0.chPitch), Math.cos(f0.chYaw) * Math.cos(f0.chPitch)];
          const cw: V3 = [cf[0] * place.c + cf[2] * place.s, cf[1], -cf[0] * place.s + cf[2] * place.c];
          const score: number = cw[0] * chestFwd[0] + cw[1] * chestFwd[1] + cw[2] * chestFwd[2] - (best ? 0.05 : 0);
          if (!best || score > best.score) best = { id, score };
        }
        if (best) {
          const id = best.id;
          const rise = fc.riseWindow(id);
          const lieT = Math.max(0, rise.start - 0.8);
          const clip: PlacedClip = {
            id, h: fc.lib.handle(id), from: lieT, to: fc.lib.info(id).duration,
            place: fc.placeLying(id, lieT, lying.hips, lying.facing),
          };
          const riseDur = rise.end - rise.start;
          const room = tl.standUp[1] - tl.sitUp[0];
          const rate = riseDur > room ? riseDur / room : 1;
          const ts = tl.standUp[1] - riseDur / rate;
          getup = { clip, rise, ts, rate };
          // He stands where the take stands, and walks to his mark from there.
          const stood = keepInside(arena, fc.hipsAt(clip, rise.end), 0.7);
          up = stood;
          if (bLegs[0]) bLegs[0] = { ...bLegs[0], from: stood };
        }
      }
    }
    if (tl.kind === 'stoppage') {
      const fc = this.capFor(a);
      const id = `celebrate.victory_1.${clipStance(a)}`;
      if (fc && fc.has(id)) {
        const t0 = tl.celebrate[0] - 0.4;
        const t1 = tl.celebrate[1] + 0.3;
        const from = celebrationStart(fc, id, t1 - t0);
        const clip: PlacedClip = {
          id, h: fc.lib.handle(id), from, to: from + (t1 - t0),
          place: fc.placeStanding(id, from, cel, outward(cel)),
        };
        celebrate = { clip, t0, t1 };
      }
    }
    return { a, b, marks, aLegs, bLegs, refLegs, cel, lying, up, attend, chest, getup, celebrate };
  }
}

