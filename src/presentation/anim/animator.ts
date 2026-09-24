/**
 * THE STANDING ANIMATOR (docs/design/08 §5) — owns every fighter every frame.
 *
 * Per frame:
 *   0. display placement: interpolated recorded positions, a 1v1 display range
 *      compression (below), facing the opponent;
 *   1. PASS 1 (bodies): L0 stance + footwork, L1 action body (strike, defence),
 *      L2 hit reactions, L3 fatigue/damage — accumulated into a `Delta`, built
 *      into a `BodySpec` and solved (pelvis, spine, head, legs with planted-foot
 *      IK). Knocked-down fighters use the fall/lying key poses instead;
 *   2. PASS 2a (guards): guard and defence hands, arm IK;
 *   2b. PASS 2b (weapons): striking hands / legs re-aimed onto the opponent's
 *      solved body (so a jab lands on the chin where it IS this frame);
 *   3. engaged pairs go to the registered `GrappleSolver` (grappleApi.ts); if it
 *      declines, a built-in clinch / ground approximation is used;
 *   4. mode changes (standing <-> down <-> getting up <-> engaged) crossfade
 *      from the last pose (an inertialization stand-in).
 *
 * Display range compression: the sim throws strikes from recorded centre
 * distances well past anatomical reach (median ~1.8 m in probe bouts, where a
 * jab physically reaches ~1.3 m with a step). In 1v1 the displayed separation
 * of a pair is compressed beyond 1.0 m (`displaySeparation`), continuous and
 * monotonic, identity inside clinch/close range, so the pictures keep the sim's
 * ordering of ranges while strikes can physically arrive. Every other module
 * reads fighter placement from the poses written here, so they agree.
 */
import type { FighterSnapshot, SimEvent, TickSnapshot } from '../../sim';
import type { AnimDebug, Animator, BoutPresentation, FrameInput } from '../contract';
import {
  B, blendPose, copyPose, createPose, createWorldPose, forwardKinematics, forwardKinematicsSubtree, resetPose,
  type Pose, type RestSkeleton, type WorldPose,
} from '../rig/skeleton';
import { grappleSolver, type GrappleContext } from './grappleApi';
import {
  DEG, add, clamp, clamp01, dirToWorld, frame as mkFrame, hashStr, lerp, qmul, qypr, smooth, sub,
  toWorld, vlerp, windowW, type V3,
} from './math';
import { activeDefence, defenceBody, defenceHands, defenceRootOffset, flinch } from './defence';
import { fallKey, keyToSpec, kneelKey, supineKey, blendKey } from './falls';
import { condition, hitReactions, incomingFlinch, turnAway } from './reactions';
import { fistPoint, getLocal, rigInfo, solveHand, solveSpec, worldP } from './spec';
import { buildBody, clampPelvis, guardHands } from './stance';
import {
  createDelta, createFighterState, createSpec, resetDelta, type Ctx, type Delta, type FighterState, type KnockInfo,
} from './state';
import { aimPoint, classify, envelope, legPass, strikeBody, strikeHands, strikeRootOffset } from './strikes';
import { KNEE_MAX_FLEX, LIMBS, solveTwoBone } from '../rig/ik';
import { fighterTiers } from './tier';
import { strikeTiming, type ActionTiming } from './timing';
import { carryHands, chestFrame, clearOfBody, separatePair } from './clearance';
import { fadeKeepFeet, floorFix, footGrounded } from './blend';
import type { MotionLibrary } from '../assets/motionLibrary';
import { CapRig, NCH, idleResidual, registeredMotionLibrary } from './capture';
import {
  capActionFor, capDefenceBody, capDefenceFor, capLegPass, capStrikeBody, capStrikeHands, type CapAction,
} from './capStrikes';

/**
 * Width (in sim ticks) of the trailing average that smooths the displayed root
 * path (`placement`). 1 = the quadratic B-spline (50 ms behind the record);
 * smaller follows the record more closely and ramps velocity changes faster.
 */
export const ROOT_SMOOTH = 0.5;

/** A standing fighter's root is kept this far off a lying body's hips–head line (m, scale 1). */
export const LYING_CLEAR_M = 0.5;

/** Displayed centre-to-centre distance for a recorded one (1v1). */
export function displaySeparation(d: number): number {
  // clinch / close: as recorded; mid: gently; long and kicking range: strongly;
  // beyond, nearly as recorded again so the cage still reads at its true size.
  if (d <= 0.7) return d;
  if (d <= 1.0) return 0.7 + (d - 0.7) * 0.8;
  if (d <= 2.4) return 0.94 + (d - 1.0) * 0.45;
  return 1.57 + (d - 2.4) * 0.6;
}

export interface AnimatorOptions {
  /** Force every fighter's tier (dev browser). */
  tierOverride?: (index: number) => number | undefined;
  /** Disable the display range compression (tests of raw placement). */
  noCompression?: boolean;
  /**
   * Motion-capture library. Omitted: whatever `registerMotionLibrary` holds
   * (the presenter loads it; until it arrives the animator is procedural and
   * crossfades when it does). `null`: procedural only.
   */
  motion?: MotionLibrary | null;
  /** Dev: force the clip used for a technique id (clip id), when it fits the limb. */
  captureClip?: (techId: string) => string | undefined;
}

interface FighterFrame {
  snap: FighterSnapshot;
  next: FighterSnapshot | null;
  pos: V3;
  vel: V3;
  yaw: number;
  opp: number;
  timing: ActionTiming | null;
}

export class StandingAnimator implements Animator {
  private bout: BoutPresentation | null = null;
  private st: FighterState[] = [];
  private lastNow = -Infinity;
  private readonly scratchWorld: [WorldPose, WorldPose] = [createWorldPose(), createWorldPose()];
  private readonly tmpPose: Pose = createPose();
  private debugInfo: AnimDebug[] = [];
  private lib: MotionLibrary | null = null;
  /** Recorded floor positions of the current and the previous tick (the root path's third point). */
  private tickPos: { tick: number; pos: [number, number][] } | null = null;
  private prevTickPos: { tick: number; pos: [number, number][] } | null = null;

  constructor(private readonly opts: AnimatorOptions = {}) {}

  setBout(bout: BoutPresentation, rests: readonly RestSkeleton[]): void {
    this.bout = bout;
    this.st = bout.fighters.map((f, i) => {
      const rt = bout.runtimes[i];
      const tiers = fighterTiers(rt, this.opts.tierOverride?.(i));
      const seed = hashStr(`${bout.cosmeticSeed}:${f.id}:${i}`);
      return createFighterState(i, i, rigInfo(rests[i]), tiers, seed);
    });
    this.lib = this.motionLibrary();
    for (const st of this.st) st.cap = this.lib ? new CapRig(this.lib, st.rig) : null;
    this.reset();
  }

  /** Re-derive tiers (dev browser changes the override live). */
  refreshTiers(): void {
    if (!this.bout) return;
    for (const st of this.st) st.tiers = fighterTiers(this.bout.runtimes[st.index], this.opts.tierOverride?.(st.index));
  }

  reset(): void {
    for (const st of this.st) {
      st.initialised = false;
      st.latch = null;
      st.contactAim = null;
      st.contactFinal = null;
      st.weapon = null;
      st.handF = null;
      st.clearSide = 0;
      st.fade = null;
      st.knock = null;
      st.mode = 'standing';
      st.modeSince = -1e9;
      st.lastSpec = null;
      st.feet[0].swing = null;
      st.feet[1].swing = null;
      st.capAction = null;
      st.capDefence = null;
      st.actStrike = '';
      st.actDefence = '';
    }
    this.lastNow = -Infinity;
    this.tickPos = null;
    this.prevTickPos = null;
    grappleSolver()?.reset();
  }

  debug(fighter: number): AnimDebug {
    return this.debugInfo[fighter] ?? { layer: 'none', technique: null, phase: 0, ikTargets: [], tierRules: [] };
  }

  /** The capture library in use (null: procedural). */
  motionLibrary(): MotionLibrary | null {
    return this.opts.motion !== undefined ? this.opts.motion : registeredMotionLibrary();
  }

  /** True when this animator is currently driven by motion capture. */
  get captureActive(): boolean {
    return this.lib !== null;
  }

  /** Internal state, for the dev viewer and tests. */
  fighterState(i: number): FighterState | undefined {
    return this.st[i];
  }

  evaluate(input: FrameInput, _realDt: number, out: Pose[]): void {
    if (!this.bout) return;
    const now = input.simTime * 1000;
    const jump = !Number.isFinite(this.lastNow) || now < this.lastNow - 1 || now - this.lastNow > 600;
    const snap = input.discontinuity || jump;
    if (snap) this.reset();
    // The capture library arrived (or went): rebuild the samplers and crossfade.
    const lib = this.motionLibrary();
    if (lib !== this.lib) {
      this.lib = lib;
      for (const st of this.st) {
        st.cap = lib ? new CapRig(lib, st.rig) : null;
        st.capAction = null;
        st.capDefence = null;
        if (!snap && st.lastSpec) {
          st.fade = { from: createPose(), t0: now, dur: 350 };
          copyPose(st.fade.from, st.pose);
        }
      }
    }
    const dtMs = snap ? 0 : clamp(now - this.lastNow, 0, 100);
    this.lastNow = now;
    const F0 = input.frame;
    const F1 = input.next;
    const n = Math.min(this.st.length, F0.fighters.length);
    const events = input.events;

    // ---- placement ---------------------------------------------------------
    const ff = this.placement(F0, F1, input.alpha, n, now, events);

    // ---- modes ---------------------------------------------------------------
    const engagedPair = new Map<number, { e: TickSnapshot['engagements'][number]; other: number }>();
    for (const e of F0.engagements) {
      if (e.kind === 'knockdown') continue;
      if (e.a >= 0 && e.a < n) engagedPair.set(e.a, { e, other: e.b });
      if (e.b >= 0 && e.b < n) engagedPair.set(e.b, { e, other: e.a });
    }
    for (let i = 0; i < n; i++) {
      const st = this.st[i];
      const f = ff[i].snap;
      let mode: FighterState['mode'] = 'standing';
      if (engagedPair.has(i) || f.posture === 'clinch' || f.posture === 'ground') mode = 'grapple';
      else if (f.posture === 'down') mode = 'down';
      else if (f.posture === 'out') mode = this.isKo(f, events, now, i) ? 'out' : 'standing';
      if (mode === 'standing' && (st.mode === 'down' || (st.mode === 'getup' && now - st.modeSince < 1300)) && !snap) mode = 'getup';
      if (mode === 'down' || mode === 'out') this.updateKnock(st, f, events, now, i, snap);
      if (mode !== st.mode) {
        const from = st.mode;
        if (!snap && st.lastSpec) {
          // Up off a partner still on the canvas (a submission's winner, a
          // scramble to the feet): slide out, then rise (see `Fade.slide`).
          const offBody = from === 'grapple' && (mode === 'standing' || mode === 'getup')
            && this.st.some((o, j) => j !== i && j < n && F0.fighters[j]?.posture !== 'standing' && (o.mode === 'grapple' || o.mode === 'down' || o.mode === 'out'));
          const dur = offBody ? 0.6 : mode === 'getup' ? 0.55 : from === 'grapple' || mode === 'grapple' ? 0.25 : mode === 'down' ? 0.1 : 0.2;
          st.fade = { from: createPose(), t0: now, dur: dur * 1000, slide: offBody };
          copyPose(st.fade.from, st.pose);
        }
        st.mode = mode;
        st.modeSince = snap ? -1e9 : now;
        if ((mode === 'standing' || mode === 'getup') && from !== 'standing' && from !== 'getup') {
          // Re-seat the footwork on the feet as they were last drawn (the clinch,
          // the ground and the canvas move the body without the plant machine).
          st.initialised = false;
          st.feetSeed = snap || !st.lastSpec ? null : groundedFeet(st);
        }
      }
    }

    // ---- per-fighter context ---------------------------------------------------
    const ctxs: (Ctx | null)[] = [];
    for (let i = 0; i < n; i++) {
      const st = this.st[i];
      const fr = ff[i];
      const oppI = fr.opp;
      const opp = oppI >= 0 ? this.st[oppI] : null;
      const tm = fr.timing;
      if (tm) {
        if (!st.latch || st.latch.id !== tm.id || Math.abs(st.latch.contact - tm.contact) > 0.5) {
          st.latch = tm;
          st.knownAt = tm.result !== 'pending' ? (snap ? tm.commit : now) : Infinity;
          st.contactAim = null;
        } else {
          if (st.latch !== tm) {
            if (st.latch.result === 'pending' && tm.result !== 'pending') st.knownAt = now;
            st.latch = tm;
          }
        }
      }
      const incoming: Ctx['incoming'] = [];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const t = ff[j].timing;
        if (!t) continue;
        const target = t.targetId ?? ff[j].opp;
        if (target !== F0.fighters[i].id && target !== i) continue;
        incoming.push({ t, from: this.st[j], fromSnap: ff[j].snap });
      }
      const f = fr.snap;
      const sd = f.stance === 'southpaw' ? -1 : 1;
      const fatigue = fr.next ? lerpFatigue(f.fatigueVisual, fr.next.fatigueVisual, input.alpha) : f.fatigueVisual;
      const ctx: Ctx = {
        nowMs: now, st, f, fatigue, sd, lead: sd > 0 ? 0 : 1,
        frame: mkFrame(fr.pos[0], fr.pos[2], fr.yaw),
        opp, oppSnap: oppI >= 0 ? ff[oppI].snap : null,
        dist: oppI >= 0 ? Math.hypot(ff[oppI].pos[0] - fr.pos[0], ff[oppI].pos[2] - fr.pos[2]) : 2,
        vel: fr.vel, my: tm && now >= tm.commit && now <= tm.end ? tm : null,
        incoming, events, states: new Set(f.states),
      };
      st.displayRoot = fr.pos;
      st.displayVel = fr.vel;
      ctxs.push(ctx);
      this.actionEndFade(ctx, snap);
    }

    // ---- pass 1: bodies ----------------------------------------------------------
    for (let i = 0; i < n; i++) {
      const ctx = ctxs[i]!;
      const st = ctx.st;
      resetDelta(st.delta);
      if (st.spec.frame.ox === 0 && st.spec.frame.oz === 0) st.spec = createSpec(ctx.frame);
      st.spec.free = false;
      if (st.mode === 'grapple' && (engagedPair.has(i) || st.lastSpec)) {
        // Engaged: the pair solver poses him below. Tied up / on the ground with
        // no engagement recorded (the last frame of a submission: the sim has
        // released the pair but not yet stood anybody up): hold the last pose
        // rather than standing him up for a frame.
        if (!engagedPair.has(i)) st.debugLayer = 'grapple hold';
        continue;
      }
      if (st.mode === 'down' || st.mode === 'out') this.bodyDown(ctx);
      else this.bodyStanding(ctx, dtMs, snap);
    }

    // ---- pass 2a: guards and defences --------------------------------------------
    for (let i = 0; i < n; i++) {
      const ctx = ctxs[i]!;
      const st = ctx.st;
      if (st.mode === 'down' || st.mode === 'out' || st.mode === 'grapple') continue;
      const g = guardHands(ctx, st.spec, st.delta);
      for (const side of [0, 1] as const) {
        const h = st.spec.hands[side];
        h.pos = g.pos[side]; h.pole = g.pole[side]; h.palm = g.palm[side]; h.w = 1; h.fist = g.fist; h.fistTarget = false; h.exact = false; h.twist = 1;
      }
      const ad = activeDefence(ctx);
      if (ad) defenceHands(ctx, ad, st.spec, g);
      if (st.delta.guardDrop > 0 && !ad) {
        // Flinch / cover without a recorded defence: both gloves to the face.
        const w = st.delta.guardDrop;
        for (const side of [0, 1] as const) {
          const h = st.spec.hands[side];
          const face = add(worldP(st.world, B.head), dirToWorld(st.spec.frame, [(side === 0 ? 0.09 : -0.09) * st.rig.scale, 0.02, 0.1 * st.rig.scale]));
          h.pos = vlerp(h.pos, face, w);
        }
      }
      if (st.mode === 'getup') {
        const r = 1 - smooth((now - st.modeSince) / 1300);
        for (const side of [0, 1] as const) {
          const h = st.spec.hands[side];
          h.pos = vlerp(h.pos, add(worldP(st.world, side === 0 ? B.lLeg : B.rLeg), [0, 0.12, 0]), r * 0.8);
        }
      }
      followHands(st, g, dtMs, snap, now);
      (st as unknown as { guard: typeof g }).guard = g;
      solveSpec(st.spec, st.rig, st.pose, st.world, true);
    }

    // ---- pass 2b: weapons ------------------------------------------------------------
    for (let i = 0; i < n; i++) {
      const ctx = ctxs[i]!;
      const st = ctx.st;
      st.ikTargets = [];
      st.weapon = null;
      if (st.mode !== 'standing' && st.mode !== 'getup') continue;
      const tm = ctx.my;
      if (!tm) continue;
      const info = classify(tm.id, ctx.lead);
      const g0 = (st as unknown as { guard: ReturnType<typeof guardHands> }).guard;
      // The striking hand's path starts from (and returns to) its guard as a
      // KNUCKLE point: the guard is a wrist target, the strike a fist target,
      // and starting the fist on the guard's wrist point pushed the glove a
      // fist-length forward in the strike's first frame (an arm pop at every
      // punch's start and end).
      const g = info.hand === -1 ? g0 : {
        ...g0, pos: [g0.pos[0], g0.pos[1]] as [V3, V3],
      };
      if (info.hand !== -1) g.pos[info.hand] = fistPoint(st.world, st.rig, info.hand);
      const plan = this.plan(ctx, tm, info);
      const cap = st.cap;
      const hands = (): V3 | null => (plan && cap
        ? capStrikeHands(cap, ctx, tm, info, st.spec, g, plan)
        : strikeHands(ctx, tm, info, st.spec, g));
      const aim = hands();
      solveSpec(st.spec, st.rig, st.pose, st.world, true);
      // The trunk corrections below move the chest after the guard hand was
      // placed on it: the guard is carried along (`carryHands`).
      const chest0 = chestFrame(st);
      if (aim && info.hand !== -1) {
        const elbow = info.kind === 'elbow';
        const act = tm.activeEnd - tm.contact;
        const w = elbow ? windowW(ctx.nowMs - tm.contact, -170, -15, act, act + 170) : 1;
        if (w > 0) {
          this.reachAssist(ctx, tm, info.hand as 0 | 1, elbow ? aim : null, w, aim, () => {
            hands();
            solveSpec(st.spec, st.rig, st.pose, st.world, true);
          });
        }
      }
      if (aim && info.hand !== -1) st.weapon = { hand: info.hand, leg: -1, aim, ankle: null, pole: null };
      this.headClearance(ctx, info.hand === 0 ? -1 : 1);
      carryHands(st, chest0);
      if (info.leg !== -1) {
        const T = plan && cap
          ? capLegPass(cap, ctx, tm, info, st.spec, st.delta, false, plan)
          : legPass(ctx, tm, info, st.spec, st.delta, false);
        if (T) st.ikTargets.push({ name: 'kick', pos: T });
      }
      if (aim) st.ikTargets.push({ name: 'aim', pos: aim });
    }

    // ---- pass 2c: standing pairs keep their heads and chests apart ----------------------
    const free = (i: number): boolean => {
      const m = this.st[i].mode;
      return (m === 'standing' || m === 'getup') && !engagedPair.has(i);
    };
    for (let i = 0; i < n; i++) {
      if (!free(i)) continue;
      for (let j = i + 1; j < n; j++) {
        if (!free(j)) continue;
        separatePair(ctxs[i]!, ctxs[j]!);
      }
    }

    // ---- engaged pairs -------------------------------------------------------------------
    const done = new Set<number>();
    for (const e of F0.engagements) {
      if (e.kind === 'knockdown') continue;
      const a = e.a, b = e.b;
      if (a < 0 || a >= n || done.has(a)) continue;
      done.add(a);
      if (b >= 0 && b < n) done.add(b);
      this.engaged(e, F1, input, ff, ctxs, now);
    }
    // A free fighter (team bouts) keeps off the bodies of an engaged pair.
    if (done.size > 0) {
      for (let i = 0; i < n; i++) {
        if (!free(i)) continue;
        for (const j of done) clearOfBody(this.st[i], this.st[j]);
      }
    }

    // ---- fades ---------------------------------------------------------------------------------
    const fadeW: number[] = [];
    for (let i = 0; i < n; i++) {
      const st = this.st[i];
      fadeW.push(0);
      if (st.fade) {
        const u = (now - st.fade.t0) / st.fade.dur;
        if (u >= 1 || u < 0) st.fade = null;
        else {
          // Blend over the planted feet (a plain pose blend dips and skates them).
          forwardKinematics(st.world, st.pose, st.rig.rest);
          let from = st.fade.from;
          if (st.fade.slide) {
            // First 40 %: the old pose slides out level to above where he
            // stands; then the ordinary blend stands him up there.
            const k = smooth(Math.min(1, u / 0.4));
            from = this.tmpPose;
            copyPose(from, st.fade.from);
            from.rootPos[0] += (st.pose.rootPos[0] - from.rootPos[0]) * k;
            from.rootPos[2] += (st.pose.rootPos[2] - from.rootPos[2]) * k;
            fadeW[i] = 1 - smooth(clamp01((u - 0.3) / 0.7));
          } else fadeW[i] = 1 - smooth(u);
          fadeKeepFeet(st.pose, st.world, from, fadeW[i], st.rig.rest);
        }
      }
    }

    // ---- contact: weapons re-solved on the final poses --------------------------------------
    for (let i = 0; i < n; i++) {
      const ctx = ctxs[i]!;
      if (ctx.st.weapon && ctx.my && (ctx.st.mode === 'standing' || ctx.st.mode === 'getup')) this.contactPass(ctx, fadeW[i]);
    }

    // ---- face, output ------------------------------------------------------------------------
    for (let i = 0; i < n; i++) {
      const st = this.st[i];
      st.lastSpec = st.spec;
      // Each foot's heel as finally drawn (the reach clamp may have raised it,
      // a swing may just have landed): the next lift-off starts from there.
      // (A swing that began the frame after its foot landed used to start from
      // the heel of the plant BEFORE that swing: a 10-40° heel snap.)
      if (st.mode === 'standing' || st.mode === 'getup') {
        for (const side of [0, 1] as const) st.feet[side].lift = st.spec.feet[side].lift;
      }
      if (out[i]) copyPose(out[i], st.pose);
      const tm = ctxs[i]!.my;
      this.debugInfo[i] = {
        layer: st.debugLayer,
        technique: tm ? tm.id : null,
        phase: tm ? clamp01((now - tm.commit) / Math.max(1, tm.end - tm.commit)) : 0,
        ikTargets: st.ikTargets,
        tierRules: st.tiers.tags,
      };
    }
  }

  // -------------------------------------------------------------------------

  /**
   * The weapon on the target at the recorded instant, whatever ran after the
   * strike pass aimed it. The strike pass (2b) aims at the defender's body as
   * solved THEN; the defender's own strike, the pair clearance (which also
   * re-solves the legs from the spec, dropping a kick's re-aimed leg) and the
   * crossfades still move both bodies afterwards — measured, a quarter of the
   * landed / blocked strikes ended more than 5 cm off the surface they struck.
   * Here, last, the aim point is taken again on the final poses and the weapon
   * limb is re-solved to its strike-pass target moved by how far the aim moved
   * (weighted by the strike's extension, so the windup is untouched; the fist
   * that struck stays where it struck: the latched aim becomes the final one).
   * The limb is only re-solved to where the strike pass already put it, so
   * without any later change this is the identity.
   */
  private contactPass(ctx: Ctx, fade: number): void {
    const st = ctx.st;
    const wp = st.weapon!;
    const tm = ctx.my!;
    const now = ctx.nowMs;
    if (now < tm.commit || now > tm.end) return;
    const e = envelope(tm, now);
    const info = classify(tm.id, ctx.lead);
    // How far the aim moved since the strike pass took it (before contact and
    // on the frame the fist lands; after that the latched aim is already final).
    let drift: V3 = [0, 0, 0];
    const latching = !e.before && !!st.contactAim && st.contactAim !== st.contactFinal;
    if (e.before || latching) {
      const aimNow = aimPoint(ctx, tm, info);
      if (aimNow) {
        const k = e.before ? e.ext : 1;
        drift = [(aimNow[0] - wp.aim[0]) * k, (aimNow[1] - wp.aim[1]) * k, (aimNow[2] - wp.aim[2]) * k];
        if (latching) { st.contactAim = aimNow; st.contactFinal = aimNow; }
      }
    }
    const w = 1 - fade;
    if (w <= 0) return;
    const rig = st.rig;
    forwardKinematics(st.world, st.pose, rig.rest);
    if (wp.hand !== -1) {
      const h = st.spec.hands[wp.hand];
      h.pos = add(h.pos, drift);
      h.pole = add(h.pole, drift);
      const w0 = h.w;
      h.w = w0 * w;
      solveHand(st.spec, rig, st.pose, st.world, wp.hand);
      h.w = w0;
    } else if (wp.leg !== -1 && wp.ankle && wp.pole) {
      const chain = wp.leg === 0 ? LIMBS.lLeg : LIMBS.rLeg;
      solveTwoBone(st.pose, st.world, rig.rest, chain, add(wp.ankle, drift), add(wp.pole, drift), w, KNEE_MAX_FLEX);
    }
    // Only the weapon limb changed.
    forwardKinematicsSubtree(st.world, st.pose, rig.rest, wp.hand === 0 ? B.lArm : wp.hand === 1 ? B.rArm : wp.leg === 0 ? B.lUpLeg : B.rUpLeg);
    const t = st.ikTargets.find((x) => x.name === 'aim' || x.name === 'kick');
    if (t) t.pos = add(t.pos, drift);
  }

  /**
   * When a strike or a defence ends (or gives way to another), fade from the
   * last displayed pose over ~180 ms instead of snapping back to the stance:
   * the layers' deltas stop at the action's recorded end, and a kick's leg,
   * a block's head or a cross's arm otherwise jumped 20-60° in one frame. A new
   * strike's contact is protected: the fade is over 50 ms before it lands.
   */
  private actionEndFade(ctx: Ctx, snap: boolean): void {
    const st = ctx.st;
    const standing = st.mode === 'standing' || st.mode === 'getup';
    const tm = standing ? ctx.my : null;
    const ad = standing ? activeDefence(ctx) : null;
    const ks = tm ? `s:${tm.id}@${Math.round(tm.commit)}` : '';
    const kd = ad ? `d:${ad.motion}@${Math.round(ad.t.contact)}` : '';
    const ended = (st.actStrike !== '' && st.actStrike !== ks) || (st.actDefence !== '' && st.actDefence !== kd);
    st.actStrike = ks;
    st.actDefence = kd;
    if (!ended || snap || !standing || !st.lastSpec) return;
    if (st.fade && ctx.nowMs - st.fade.t0 < st.fade.dur * 0.5) return; // a mode fade is still doing it
    let dur = 180;
    if (tm) dur = Math.min(dur, tm.contact - ctx.nowMs - 50);
    if (dur < 60) return;
    const from = st.fade?.from ?? createPose();
    copyPose(from, st.pose);
    st.fade = { from, t0: ctx.nowMs, dur };
  }

  private placement(F0: TickSnapshot, F1: TickSnapshot | null, alpha: number, n: number, now: number, events: readonly SimEvent[]): FighterFrame[] {
    // The previous tick's recorded positions (kept while playing tick to tick).
    if (!this.tickPos || this.tickPos.tick !== F0.tick) {
      this.prevTickPos = this.tickPos && this.tickPos.tick === F0.tick - 1 ? this.tickPos : null;
      this.tickPos = { tick: F0.tick, pos: F0.fighters.map((f) => [f.x, f.z] as [number, number]) };
    }
    const prev = this.prevTickPos;
    /**
     * The root path: the straight-line path through the recorded tick
     * positions, averaged over a trailing window of `ROOT_SMOOTH` ticks. The
     * sim moves in 100 ms steps that start and stop (2.3 m/s, then 0, then
     * 2.3 m/s at right angles): linear interpolation turned every tick into a
     * velocity step — a hips jolt and a burst of frantic re-stepping — while
     * the averaged path has continuous velocity (each step's velocity ramps in
     * over the window). A one-tick window is the uniform quadratic B-spline
     * (the first pass: half a tick, 50 ms, behind — the hips visibly froze at
     * every start); the half-tick window keeps the velocity continuous with a
     * 25 ms lag. Only the previous, this and the next tick are needed. Pure.
     */
    const raw = (fr: TickSnapshot | null, i: number, a: number): V3 => {
      const f0 = F0.fighters[i];
      const f1 = (fr ? fr.fighters[i] : null) ?? f0;
      // No next frame (the end of the recording, the post-roll): the path
      // settles onto the frame's own position over a tick of the clock.
      const s = fr ? clamp01(a) : clamp01((now / 1000 - F0.t) / 0.1);
      let nx = f1.x, nz = f1.z;
      if (Math.hypot(nx - f0.x, nz - f0.z) > 0.8) { nx = f0.x; nz = f0.z; } // a reset, not motion
      const pp = prev?.pos[i];
      let px: number, pz: number;
      if (pp && Math.hypot(pp[0] - f0.x, pp[1] - f0.z) <= 0.8) { px = pp[0]; pz = pp[1]; }
      else { px = 2 * f0.x - nx; pz = 2 * f0.z - nz; } // unknown: constant velocity
      // Trailing box average of the linear path over ROOT_SMOOTH ticks (see
      // `ROOT_SMOOTH`): P0 - (w-s)²/2w·D0 + s²/2w·D1 while the box straddles
      // the tick, P0 + (s - w/2)·D1 once it is inside it.
      const w = ROOT_SMOOTH;
      const d0x = f0.x - px, d0z = f0.z - pz, d1x = nx - f0.x, d1z = nz - f0.z;
      if (s >= w) return [f0.x + (s - w / 2) * d1x, 0, f0.z + (s - w / 2) * d1z];
      const k0 = (w - s) * (w - s) / (2 * w), k1 = s * s / (2 * w);
      return [f0.x - k0 * d0x + k1 * d1x, 0, f0.z - k0 * d0z + k1 * d1z];
    };
    const place = (a: number): V3[] => {
      const p: V3[] = [];
      for (let i = 0; i < n; i++) p.push(raw(F1, i, a));
      if (n === 2 && !this.opts.noCompression) {
        const d = Math.hypot(p[1][0] - p[0][0], p[1][2] - p[0][2]);
        if (d > 1e-4) {
          const dd = displaySeparation(d);
          const mx = (p[0][0] + p[1][0]) / 2, mz = (p[0][2] + p[1][2]) / 2;
          const ux = (p[1][0] - p[0][0]) / d, uz = (p[1][2] - p[0][2]) / d;
          p[0] = [mx - ux * dd / 2, 0, mz - uz * dd / 2];
          p[1] = [mx + ux * dd / 2, 0, mz + uz * dd / 2];
        }
      }
      return p;
    };
    const pos = place(alpha);
    this.clearOfLying(F0, pos, n);
    const span = F1 ? Math.max(0.05, F1.t - F0.t) : 0.1;
    // Velocity of the displayed root (the path's derivative, by a central difference).
    const aLo = Math.max(0, alpha - 0.05), aHi = Math.min(1, alpha + 0.05);
    const p0 = place(aLo);
    const p1 = F1 && aHi > aLo ? place(aHi) : p0;
    const dA = Math.max(1e-6, (aHi - aLo) * span);
    const out: FighterFrame[] = [];
    for (let i = 0; i < n; i++) {
      const f = F0.fighters[i];
      const nx = F1 ? F1.fighters[i] ?? null : null;
      const vel: V3 = F1 ? [(p1[i][0] - p0[i][0]) / dA, 0, (p1[i][2] - p0[i][2]) / dA] : [0, 0, 0];
      // Opponent: the action's target, else the nearest fighter of another team.
      let opp = -1;
      const tid = f.actionDetail.targetId;
      if (tid !== null && tid !== f.id && tid >= 0 && tid < n && F0.fighters[tid] && !F0.fighters[tid].posture.startsWith('out')) opp = tid;
      if (opp < 0) {
        let best = Infinity;
        for (let j = 0; j < n; j++) {
          if (j === i || F0.fighters[j].team === f.team) continue;
          const dd = Math.hypot(pos[j][0] - pos[i][0], pos[j][2] - pos[i][2]);
          if (dd < best) { best = dd; opp = j; }
        }
      }
      let yaw: number;
      const st = this.st[i];
      if (opp >= 0) {
        const dx = pos[opp][0] - pos[i][0], dz = pos[opp][2] - pos[i][2];
        yaw = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : st.lastYaw;
      } else yaw = f.facing;
      st.lastYaw = yaw;
      const timing = strikeTiming(i, F0, F1, now, events, st.latch);
      out.push({ snap: f, next: nx, pos: pos[i], vel, yaw, opp, timing });
    }
    return out;
  }

  /**
   * A fighter the sim has on his feet is never drawn standing inside a body
   * that lies on the canvas (his opponent tapped under him, knocked down, or
   * still on the ground after a scramble): the recorded spot of a submission's
   * winner is on top of the loser, and standing him up there raised him
   * through the loser's body (up to 22 cm of standing interpenetration in the
   * post-roll). His displayed root is kept `LYING_CLEAR_M` off the lying
   * body's hips–head line, on the side he was on when it began (sticky, so
   * the push never jumps across the body), and the footwork steps there.
   */
  private clearOfLying(F0: TickSnapshot, pos: V3[], n: number): void {
    for (let i = 0; i < n; i++) {
      const st = this.st[i];
      const f = F0.fighters[i];
      if (!f || f.posture !== 'standing' || F0.engagements.some((e) => e.kind !== 'knockdown' && (e.a === i || e.b === i))) { st.clearSide = 0; continue; }
      let touched = false;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = this.st[j];
        const fj = F0.fighters[j];
        if (!fj || !o.lastSpec || fj.posture === 'standing' || (o.mode !== 'grapple' && o.mode !== 'down' && o.mode !== 'out')) continue;
        const w = o.world;
        const hx = w.pos[B.hips * 3], hz = w.pos[B.hips * 3 + 2];
        // A body lying (or sitting / kneeling) low; the clearance fades in as
        // its head comes down (full below 0.9 m, none above 1.25 m), so a
        // grappler rising or crouching never switches it on in one frame.
        const low = clamp01((1.25 * o.rig.scale - w.pos[B.head * 3 + 1]) / (0.35 * o.rig.scale));
        if (low <= 0) continue;
        const ex = w.pos[B.head * 3] - hx, ez = w.pos[B.head * 3 + 2] - hz;
        const L2 = ex * ex + ez * ez;
        const p = pos[i];
        const k = L2 > 1e-6 ? clamp(((p[0] - hx) * ex + (p[2] - hz) * ez) / L2, 0, 1) : 0;
        const cx = hx + ex * k, cz = hz + ez * k;
        let dx = p[0] - cx, dz = p[2] - cz;
        const d = Math.hypot(dx, dz);
        const R = LYING_CLEAR_M * st.rig.scale;
        if (d >= R) continue;
        touched = true;
        // Side of the body's line he is on (sticky while he is close).
        const sideNow = L2 > 1e-6 ? Math.sign(ex * (p[2] - hz) - ez * (p[0] - hx)) || 1 : 1;
        if (st.clearSide === 0) st.clearSide = sideNow;
        if (L2 > 1e-6 && (k > 0 && k < 1)) {
          // Beside the line: out along its perpendicular, on the sticky side.
          const l = Math.sqrt(L2);
          const nx = -ez / l * st.clearSide, nz = ex / l * st.clearSide;
          const lat = dx * nx + dz * nz;
          const push = (R - lat) * low;
          if (push > 0) { p[0] += nx * push; p[2] += nz * push; }
        } else if (d > 1e-4) {
          // Past an end: radially.
          p[0] += (cx + dx / d * R - p[0]) * low; p[2] += (cz + dz / d * R - p[2]) * low;
        } else {
          p[0] += R * low;
        }
      }
      if (!touched) st.clearSide = 0;
    }
  }

  private bodyStanding(ctx: Ctx, dtMs: number, snap: boolean): void {
    const st = ctx.st;
    const d = st.delta;
    st.debugLayer = 'L0';
    const tm = ctx.my;
    const cap = st.cap;
    if (tm) {
      const info = classify(tm.id, ctx.lead);
      const plan = this.plan(ctx, tm, info);
      if (plan && cap) {
        capStrikeBody(cap, ctx, tm, info, d, plan);
        st.debugLayer = `L1 strike [mocap ${plan.clip.id}]`;
      } else {
        strikeBody(ctx, tm, info, d);
        st.debugLayer = 'L1 strike';
      }
      // The lunge is a pure function of time, so the feet can step ahead of it.
      d.rootFns.push((ms) => strikeRootOffset(ctx, tm, info, ms));
    }
    const ad = activeDefence(ctx);
    if (ad) {
      const dp = cap ? capDefenceFor(cap, ctx, ad) : null;
      const captured = !!(dp && cap && capDefenceBody(cap, ctx, ad, d, dp));
      if (!captured) defenceBody(ctx, ad, d);
      d.rootFns.push((ms) => defenceRootOffset(ctx, ad, ms));
      st.debugLayer = `L1 ${ad.motion}${captured ? ' [mocap]' : ''}`;
    }
    if (cap) {
      d.idle = idleResidual(cap, st.tiers.guardStyle, ctx.f.stance, st.seed, ctx.nowMs / 1000, st.idleBuf ??= new Float64Array(NCH));
      if (d.idle && st.debugLayer === 'L0') st.debugLayer = 'L0 [mocap]';
    }
    for (const fn of d.rootFns) {
      const o = fn(ctx.nowMs);
      d.rootOff[0] += o[0];
      d.rootOff[2] += o[2];
    }
    const fl = incomingFlinch(ctx);
    if (fl.w > 0.02 && (!ad || ad.motion !== 'flinch')) flinch(ctx, d, fl.w, fl.fromSide);
    const r = hitReactions(ctx, d);
    if (r.head > 0.05 || r.body > 0.05) st.debugLayer += ' +L2';
    turnAway(ctx, d);
    condition(ctx, d);
    if (st.mode === 'getup') {
      const u = clamp01((ctx.nowMs - st.modeSince) / 1300);
      const rise = 1 - smooth(u);
      d.pelvisOff[1] -= (st.rig.hipsY - 0.5 * st.rig.scale) * rise;
      d.spinePitch += 38 * DEG * rise;
      d.headPitch += -20 * DEG * rise;
      d.lookW *= 1 - rise * 0.5;
      d.bounce *= 1 - rise;
      if (ctx.states.has('state.rocked')) d.pelvisRoll += 6 * DEG * Math.sin(ctx.nowMs / 1000 * 9) * (1 - u);
      st.debugLayer = 'getup';
    }
    const spec = st.spec;
    buildBody(ctx, d, spec, dtMs, snap);
    for (const h of spec.hands) h.w = 0;
    solveSpec(spec, st.rig, st.pose, st.world, false);
  }

  /** The capture plan for this action, or null (procedural). */
  private plan(ctx: Ctx, tm: ActionTiming, info: ReturnType<typeof classify>): CapAction | null {
    const cap = ctx.st.cap;
    if (!cap) return null;
    return capActionFor(cap, ctx, tm, info, this.opts.captureClip?.(tm.id));
  }

  /**
   * Reach: when the weapon's target is beyond what the arm reaches (the lunge
   * estimate allowed less than the target needs), carry the hips and chest the
   * rest of the way — the planted feet stay put (the pelvis drops to keep them
   * in reach). Misses are left short: falling short IS the miss.
   *
   * Pass 3: the carry is the GEOMETRIC shortfall — how far the target lies past
   * the arm's full reach from the shoulder (the upper arm's for an elbow),
   * eased in (softplus over ~2 cm) — a continuous function of where the target
   * and the shoulder are. It used to be the arm IK's residual error after the
   * solve, which also counted what the arm's blend and the fist's offset left
   * over at close range: measured, the hips lunged up to the 20 cm cap at
   * targets 35-45 cm from the shoulder and toggled between 4 and 17 cm from
   * frame to frame (the largest standing leg pops, 25-40°/frame).
   */
  private reachAssist(
    ctx: Ctx, tm: ActionTiming, hand: 0 | 1, elbow: V3 | null, weight: number, punchAim: V3, retarget: () => void,
  ): void {
    if (tm.result === 'missed' || tm.result === 'evaded') return;
    const st = ctx.st;
    const spec = st.spec;
    const h = spec.hands[hand];
    if (!h.fistTarget && !elbow) return;
    const rig = st.rig;
    const y0 = spec.pelvis[1];
    const R = elbow ? rig.upperArm * 0.985 : rig.armLen * 0.99 + rig.fistLen;
    const sig = 0.02 * rig.scale;
    const cap = 0.2 * rig.scale * weight;
    const shortfall = (): { s: number; d: V3 } => {
      const sh = worldP(st.world, hand === 0 ? B.lArm : B.rArm);
      const goal = elbow ?? h.pos;
      const d = sub(goal, sh);
      const dl = Math.hypot(d[0], d[1], d[2]);
      const x = (dl - R) / sig;
      const sp = sig * (x > 20 ? x : Math.log1p(Math.exp(x)));
      return { s: sp, d: dl > 1e-6 ? [d[0] / dl, d[1] / dl, d[2] / dl] : [0, 0, 0] };
    };
    // Too close (pass 3, goal: the close-range jab): an aim nearer the
    // shoulder than the fist reaches with the elbow at ~115° (a defender's
    // glove jammed against the puncher's shoulder, a head that came in) left
    // the elbow folded at its limit, the fist 12-19 cm short of it. The body
    // gives ground instead — the hips move away from the aim by the missing
    // room (softplus, capped at 12 cm), the way a jab thrown in the pocket
    // comes with a small step back — and the arm extends onto it.
    const ext = elbow ? 0 : envelope(tm, ctx.nowMs).ext;
    if (!elbow && ext > 0) {
      const L1 = rig.upperArm, L2 = rig.foreArm + rig.fistLen;
      const rMin = Math.sqrt(L1 * L1 + L2 * L2 - 2 * L1 * L2 * Math.cos(Math.PI - ROOM_FLEX));
      // Keyed on the punch's AIM (the hand path starts at the guard, close to
      // the shoulder by design) and weighted by the extension toward it.
      const wR = weight * smooth(ext);
      const capB = 0.12 * rig.scale * wR;
      let back = 0;
      for (let it = 0; it < 2; it++) {
        const sh = worldP(st.world, hand === 0 ? B.lArm : B.rArm);
        const dx = punchAim[0] - sh[0], dz = punchAim[2] - sh[2];
        const dl = Math.hypot(dx, punchAim[1] - sh[1], dz);
        const hl = Math.hypot(dx, dz);
        if (hl < 1e-4) break;
        const x = (rMin - dl) / sig;
        const need = sig * (x > 20 ? x : Math.log1p(Math.exp(x)));
        const want = capB * Math.tanh((back + need * wR) / Math.max(1e-6, capB));
        const k = want - back;
        if (k < 0.002) break;
        back = want;
        spec.pelvis = [spec.pelvis[0] - dx / hl * k, spec.pelvis[1], spec.pelvis[2] - dz / hl * k];
        clampPelvis(spec, st);
        solveSpec(spec, rig, st.pose, st.world, false);
      }
      if (back > 0.002) return;
    }
    let moved = 0;
    for (let it = 0; it < 2; it++) {
      const { s: sf, d } = shortfall();
      // The total carry eases into its cap (C¹), never past it.
      const want = cap * Math.tanh((moved + sf * weight) / Math.max(1e-6, cap));
      const k = want - moved;
      if (k < 0.002) break;
      moved = want;
      spec.pelvis = [spec.pelvis[0] + d[0] * k, spec.pelvis[1] + d[1] * k * 0.7, spec.pelvis[2] + d[2] * k];
      spec.spinePitch += k * 0.5;
      clampPelvis(spec, st);
      // Never squat into a punch: past 6 cm of drop, lean instead (eased).
      const dropped = y0 - spec.pelvis[1];
      if (dropped > 0.04) spec.pelvis[1] = y0 - (0.04 + 0.02 * Math.tanh((dropped - 0.04) / 0.02));
      solveSpec(spec, rig, st.pose, st.world, false);
      if (elbow) retarget();
    }
    // Still short (a square or turned body jabbing from the far shoulder): turn
    // the chest so the punching shoulder comes round toward the target, up to
    // 20° more than the technique's own turn, in proportion to the shortfall.
    if (elbow) return;
    let turned = 0;
    const maxTurn = 20 * DEG * weight;
    for (let it = 0; it < 2; it++) {
      const { s: sf } = shortfall();
      if (sf < 0.005 || turned >= maxTurn) break;
      const c = worldP(st.world, B.spine2);
      const sh = worldP(st.world, hand === 0 ? B.lArm : B.rArm);
      const ax = sh[0] - c[0], az = sh[2] - c[2], bx = h.pos[0] - c[0], bz = h.pos[2] - c[2];
      const th = Math.atan2(az * bx - ax * bz, ax * bx + az * bz);
      const mag = Math.min(Math.abs(th) * 0.6, sf / 0.25, maxTurn - turned);
      const step = Math.sign(th) * mag;
      if (Math.abs(step) < 0.002) break;
      turned += Math.abs(step);
      spec.spineYaw += step;
      solveSpec(spec, rig, st.pose, st.world, false);
    }
  }

  /**
   * Stepping in, the attacker's head goes off the line instead of into the
   * opponent's (the way a fighter slips in behind a hook).
   */
  private headClearance(ctx: Ctx, preferSide: number): void {
    const st = ctx.st;
    if (!ctx.opp || ctx.opp.mode === 'down' || ctx.opp.mode === 'out') return;
    const h = worldP(st.world, B.head);
    const o = worldP(ctx.opp.world, B.head);
    const min = 0.3 * st.rig.scale;
    const d = Math.hypot(h[0] - o[0], h[1] - o[1], h[2] - o[2]);
    if (d >= min) return;
    const lx = (h[0] - o[0]) * ctx.frame.c - (h[2] - o[2]) * ctx.frame.s;
    const side = Math.abs(lx) > 0.02 ? Math.sign(lx) : preferSide;
    const need = min - d;
    st.spec.spineRoll += -side * Math.min(0.4, need / 0.5);
    st.spec.spinePitch -= Math.min(0.2, need / 0.8);
    solveSpec(st.spec, st.rig, st.pose, st.world, false);
  }

  private isKo(f: FighterSnapshot, events: readonly SimEvent[], now: number, i: number): boolean {
    if (f.states.includes('state.ko') || f.states.includes('state.choked_out')) return true;
    const k = this.st[i].knock;
    if (k && k.kind === 'ko') return true;
    return this.st[i].mode === 'down';
  }

  private updateKnock(st: FighterState, f: FighterSnapshot, events: readonly SimEvent[], now: number, i: number, snap: boolean): void {
    // The most recent knockdown event on this fighter.
    for (let k = events.length - 1; k >= 0; k--) {
      const e = events[k];
      if (e.kind !== 'knockdown' || e.target !== f.id) continue;
      const t0 = e.tick * 100 + e.subMs;
      if (now - t0 > 60000) break;
      if (st.knock && Math.abs(st.knock.t0 - t0) < 1) return;
      const det = (e as { detail: { kind?: string; cause?: string } }).detail;
      const cause = det.cause ?? null;
      const info = cause ? classify(cause, 0) : null;
      let kind = (det.kind ?? 'hurt') as KnockInfo['kind'];
      if (f.states.includes('state.ko')) kind = 'ko';
      if (kind !== 'flash' && kind !== 'hurt' && kind !== 'ko' && kind !== 'body' && kind !== 'leg') kind = 'hurt';
      const side = info && (info.kind === 'hook' || info.kind === 'round' || info.kind === 'elbow') ? (info.hand === 0 || info.leg === 0 ? -1 : 1) : 0;
      st.knock = { t0, kind, back: 1, side, cause };
      return;
    }
    if (!st.knock) {
      const kind: KnockInfo['kind'] = f.states.includes('state.ko') || f.posture === 'out' ? 'ko'
        : f.states.includes('state.knockdown_flash') ? 'flash'
          : f.states.includes('state.body_collapse') ? 'body' : 'hurt';
      st.knock = { t0: snap ? now - 10000 : now, kind, back: 1, side: 0, cause: null };
    }
  }

  private bodyDown(ctx: Ctx): void {
    const st = ctx.st;
    const k = st.knock ?? { t0: ctx.nowMs - 10000, kind: 'hurt' as const, back: 1, side: 0, cause: null };
    const tS = Math.max(0, (ctx.nowMs - k.t0) / 1000);
    const { key, rest } = fallKey(st.rig, k, tS);
    // Hooks and head kicks turn the body as it goes.
    const yaw = ctx.frame.yaw + k.side * 35 * DEG * smooth(Math.min(1, tS / 0.5));
    const fr = mkFrame(ctx.frame.ox, ctx.frame.oz, yaw);
    const spec = st.spec;
    keyToSpec(key, fr, st.rig, spec, k.side < 0 ? -1 : 1);
    // Face: KO slack; a conscious fighter blinks and breathes hard.
    spec.face.fill(0);
    if (k.kind === 'ko') {
      spec.face[5] = 1; spec.face[0] = 0.6; spec.face[1] = 0.6; spec.face[3] = 0.4;
    } else {
      spec.face[3] = 0.6; spec.face[4] = 0.4; spec.face[7] = 0.5 + 0.5 * Math.sin(ctx.nowMs / 1000 * 5);
      if (!rest) { spec.face[0] = 0.5; spec.face[1] = 0.5; }
    }
    st.debugLayer = `down:${k.kind}${rest ? ' (rest)' : ''}`;
    solveSpec(spec, st.rig, st.pose, st.world, false);
    floorFix(st.pose, st.world, st.rig.rest);
  }

  /** An engaged pair: the registered solver, else the built-in approximation. */
  private engaged(
    e: TickSnapshot['engagements'][number], F1: TickSnapshot | null, input: FrameInput,
    ff: FighterFrame[], ctxs: (Ctx | null)[], now: number,
  ): void {
    const a = e.a, b = e.b;
    const sa = this.st[a];
    const sb = b >= 0 ? this.st[b] : null;
    const solver = grappleSolver();
    let handled = false;
    if (solver && sb && this.bout) {
      const ne = F1?.engagements.find((x) => x.a === a && x.b === b) ?? null;
      const gctx: GrappleContext = {
        bout: this.bout, input, engagement: e, nextEngagement: ne,
        a: ff[a].snap, b: ff[b].snap, restA: sa.rig.rest, restB: sb.rig.rest,
      };
      try {
        const r = solver.evaluate(gctx, sa.pose, sb.pose, this.scratchWorld[0], this.scratchWorld[1]);
        handled = r.handled;
        if (handled) { sa.debugLayer = `grapple ${r.label}`; sb.debugLayer = sa.debugLayer; }
      } catch (err) {
        handled = false;
        sa.debugLayer = `grapple error: ${(err as Error).message}`;
      }
    }
    if (!handled) this.grappleFallback(e, ff, ctxs, now);
    // Reactions, fatigue and face on top, for both.
    for (const i of sb ? [a, b] : [a]) {
      const st = this.st[i];
      const ctx = ctxs[i];
      if (!ctx) continue;
      const d = resetDelta(scratchDelta);
      hitReactions(ctx, d);
      condition(ctx, d);
      forwardKinematics(st.world, st.pose, st.rig.rest);
      const add1 = (bone: number, q: ArrayLike<number>): void => {
        const l = getLocal(st.pose, bone);
        const r = qmul(q, l);
        st.pose.local.set(r, bone * 4);
      };
      add1(B.head, qypr(d.headYaw * 0.6, d.headPitch * 0.6, d.headRoll * 0.6));
      add1(B.spine2, qypr(d.spineYaw * 0.4, d.spinePitch * 0.4, d.spineRoll * 0.4));
      st.pose.face.set(d.face);
      forwardKinematicsSubtree(st.world, st.pose, st.rig.rest, B.spine2);
    }
  }

  private grappleFallback(e: TickSnapshot['engagements'][number], ff: FighterFrame[], ctxs: (Ctx | null)[], now: number): void {
    const a = e.a, b = e.b;
    const ids = b >= 0 ? [a, b] : [a];
    const ground = e.kind === 'ground' || ff[a].snap.posture === 'ground';
    const yaw = e.rootYaw;
    for (const i of ids) {
      const st = this.st[i];
      const ctx = ctxs[i]!;
      const isA = i === a;
      const spec = st.spec;
      st.debugLayer = `grapple fallback ${e.node}`;
      if (ground) {
        const top = ff[i].snap.role === 'top' || (ff[i].snap.role === 'none' && isA);
        const fr = mkFrame(e.rootX, e.rootZ, top ? yaw : yaw + Math.PI);
        const key = top ? kneelKey(st.rig) : supineKey(st.rig, false);
        if (top) {
          key.pelvis = [0, 0.62 * st.rig.scale, -0.1];
          key.pitch = 30 * DEG;
          key.spinePitch = 20 * DEG;
          key.ankle = [[0.28, 0.08, -0.55], [-0.28, 0.08, -0.55]];
          key.knee = [[0.3, 0, 0.5], [-0.3, 0, 0.5]];
          key.hand = [[0.2, 0.25, 0.35], [-0.2, 0.25, 0.35]];
        } else {
          key.pelvis = [0, 0.12, 0.35];
          key.ankle = [[0.35, 0.3, 0.9], [-0.35, 0.3, 0.9]];
          key.knee = [[0.5, 1, 0.3], [-0.5, 1, 0.3]];
        }
        keyToSpec(key, fr, st.rig, spec, 1);
        solveSpec(spec, st.rig, st.pose, st.world, false);
      } else {
        // Clinch / takedown in flight: chest to chest on the interaction root.
        const s = st.rig.scale;
        const dir = isA ? 1 : -1;
        const fr0 = mkFrame(e.rootX - Math.sin(yaw) * 0.22 * dir, e.rootZ - Math.cos(yaw) * 0.22 * dir, isA ? yaw : yaw + Math.PI);
        const saved = ctx.frame;
        ctx.frame = fr0;
        ctx.vel = [0, 0, 0];
        ctx.my = null;
        ctx.incoming = [];
        const d = resetDelta(st.delta);
        d.spinePitch += 16 * DEG;
        d.headPitch += 12 * DEG;
        d.pelvisOff[2] -= 0.08 * s;
        d.stanceWidth *= 1.15;
        d.bounce = 0;
        if (e.kind === 'takedown' && isA) {
          d.pelvisOff[1] -= 0.32 * s;
          d.spinePitch += 35 * DEG;
          d.headPitch -= 25 * DEG;
        }
        if (e.kind === 'takedown' && !isA) {
          d.pelvisOff[2] -= 0.2 * s;
          d.pelvisOff[1] -= 0.12 * s;
          d.spinePitch += 25 * DEG;
        }
        buildBody(ctx, d, spec, 16, !st.initialised);
        for (const h of spec.hands) h.w = 0;
        solveSpec(spec, st.rig, st.pose, st.world, false);
        ctx.frame = saved;
      }
    }
    // Hands on the partner (second pass, both bodies solved).
    if (b >= 0 && !ground) {
      for (const [i, j] of [[a, b], [b, a]] as const) {
        const st = this.st[i];
        const pw = this.st[j].world;
        const low = e.kind === 'takedown' && i === a;
        for (const side of [0, 1] as const) {
          const h = st.spec.hands[side];
          const tgt = low
            ? worldP(pw, side === 0 ? B.rUpLeg : B.lUpLeg)
            : worldP(pw, B.neck);
          const sh = worldP(st.world, side === 0 ? B.lArm : B.rArm);
          const r = sub(tgt, sh);
          const n = Math.hypot(r[0], r[1], r[2]);
          const lim = st.rig.armLen * 0.97;
          h.pos = n > lim ? add(sh, [r[0] / n * lim, r[1] / n * lim, r[2] / n * lim]) : tgt;
          h.pole = add(sh, [0, -0.4, 0]);
          h.w = 1;
          h.fist = 0.2;
          h.fistTarget = false;
          h.exact = false;
          h.twist = 1;
        }
        solveSpec(st.spec, st.rig, st.pose, st.world, true);
      }
    }
    void now;
  }
}

/** Elbow flexion past which a punch's aim is too close for the arm: the body gives ground (`reachAssist`). */
const ROOM_FLEX = 115 * Math.PI / 180;

/** Scratch delta for the reactions drawn on top of an engaged pair. */
const scratchDelta = createDelta();

/** Natural frequency (rad/s) of the guard hands' critically damped follow (~45 ms lag on a ramp). */
const HAND_FOLLOW_W = 45;

/**
 * The guard and defence hands follow their targets with a critically damped
 * spring in the CHEST frame (so they move rigidly with the body, and only the
 * target's own motion relative to the chest is smoothed). The guard is placed
 * off the head, and the head moves with the neck's look, the reactions and the
 * captured idle loops (whose wrap is not seamless): measured, three quarters
 * of the one-frame arm pops while standing were a hand target that jumped
 * 2-40 cm relative to the chest in one frame, and elbow poles jumped too. A
 * joint clamp only hides such a jump; the follow spreads it over ~4 frames and
 * keeps the hands' velocity continuous. The followed guard is also what a
 * strike starts from and returns to (`g.pos`), so there is no seam there.
 * Exact closed-form update (stable for any frame time); reset on a seek.
 */
function followHands(st: FighterState, g: ReturnType<typeof guardHands>, dtMs: number, snap: boolean, now: number): void {
  const cq = [st.world.quat[B.spine2 * 4], st.world.quat[B.spine2 * 4 + 1], st.world.quat[B.spine2 * 4 + 2], st.world.quat[B.spine2 * 4 + 3]] as [number, number, number, number];
  const c = worldP(st.world, B.spine2);
  const inv: [number, number, number, number] = [-cq[0], -cq[1], -cq[2], cq[3]];
  const toL = (p: V3): V3 => qrotV(inv, [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
  const toW = (p: V3): V3 => add(qrotV(cq, p), c);
  // Fresh after a seek, or back on his feet after a while in another mode.
  const fresh = snap || !st.handF || now - st.handF[0].at > 100 || now < st.handF[0].at;
  if (fresh) st.handF = [{ p: [0, 0, 0], v: [0, 0, 0], q: [0, 0, 0], qv: [0, 0, 0], at: now }, { p: [0, 0, 0], v: [0, 0, 0], q: [0, 0, 0], qv: [0, 0, 0], at: now }];
  const dt = dtMs / 1000;
  const w = HAND_FOLLOW_W;
  const ex = Math.exp(-w * dt);
  const step = (x: V3, v: V3, target: V3): void => {
    for (let k = 0; k < 3; k++) {
      const ch = x[k] - target[k];
      const tmp = (v[k] + w * ch) * dt;
      v[k] = (v[k] - w * tmp) * ex;
      x[k] = target[k] + (ch + tmp) * ex;
    }
  };
  for (const side of [0, 1] as const) {
    const h = st.spec.hands[side];
    const f = st.handF![side];
    const tp = toL(h.pos), tq = toL(h.pole);
    if (fresh) { f.p = tp; f.q = tq; f.v = [0, 0, 0]; f.qv = [0, 0, 0]; }
    else { step(f.p, f.v, tp); step(f.q, f.qv, tq); }
    h.pos = toW(f.p);
    h.pole = toW(f.q);
    f.at = now;
    g.pos[side] = h.pos;
    g.pole[side] = h.pole;
  }
}

function qrotV(q: readonly number[], v: V3): V3 {
  const x = q[0], y = q[1], z = q[2], s = q[3];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + s * tx + (y * tz - z * ty), v[1] + s * ty + (z * tx - x * tz), v[2] + s * tz + (x * ty - y * tx)];
}

/** The feet of the last displayed pose that stand on the canvas (ball point and yaw), for re-seating the footwork. */
function groundedFeet(st: FighterState): FighterState['feetSeed'] {
  const w = st.world;
  const out: NonNullable<FighterState['feetSeed']> = [null, null];
  for (const side of [0, 1] as const) {
    if (!footGrounded(w, st.rig.rest, side)) continue;
    const toe = side === 0 ? B.lToe : B.rToe;
    const ank = side === 0 ? B.lFoot : B.rFoot;
    const tx = w.pos[toe * 3], tz = w.pos[toe * 3 + 2];
    const yaw = Math.atan2(tx - w.pos[ank * 3], tz - w.pos[ank * 3 + 2]);
    out[side] = { ball: [tx, 0, tz], yaw };
  }
  return out[0] || out[1] ? out : null;
}

function lerpFatigue(a: FighterSnapshot['fatigueVisual'], b: FighterSnapshot['fatigueVisual'], t: number): FighterSnapshot['fatigueVisual'] {
  return {
    f: lerp(a.f, b.f, t), breathingRate: lerp(a.breathingRate, b.breathingRate, t),
    handsDrop: lerp(a.handsDrop, b.handsDrop, t), flatFeet: lerp(a.flatFeet, b.flatFeet, t), chinUp: lerp(a.chinUp, b.chinUp, t),
  };
}

export { resetPose, windowW, toWorld, blendKey };
