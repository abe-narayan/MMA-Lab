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
  B, blendPose, copyPose, createPose, createWorldPose, forwardKinematics, resetPose,
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
import { fistPoint, getLocal, rigInfo, solveSpec, worldP } from './spec';
import { buildBody, clampPelvis, guardHands } from './stance';
import {
  createDelta, createFighterState, createSpec, type Ctx, type Delta, type FighterState, type KnockInfo,
} from './state';
import { classify, legPass, strikeBody, strikeHands, strikeRootOffset } from './strikes';
import { fighterTiers } from './tier';
import { strikeTiming, type ActionTiming } from './timing';
import { separatePair } from './clearance';
import type { MotionLibrary } from '../assets/motionLibrary';
import { CapRig, NCH, idleResidual, registeredMotionLibrary } from './capture';
import {
  capActionFor, capDefenceBody, capDefenceFor, capLegPass, capStrikeBody, capStrikeHands, type CapAction,
} from './capStrikes';

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
      st.fade = null;
      st.knock = null;
      st.mode = 'standing';
      st.modeSince = -1e9;
      st.lastSpec = null;
      st.feet[0].swing = null;
      st.feet[1].swing = null;
      st.capAction = null;
      st.capDefence = null;
    }
    this.lastNow = -Infinity;
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
          const dur = mode === 'getup' ? 0.55 : from === 'grapple' || mode === 'grapple' ? 0.25 : mode === 'down' ? 0.1 : 0.2;
          st.fade = { from: createPose(), t0: now, dur: dur * 1000 };
          copyPose(st.fade.from, st.pose);
        }
        st.mode = mode;
        st.modeSince = snap ? -1e9 : now;
        if (mode === 'standing' || mode === 'getup') st.initialised = st.initialised && from !== 'down' && from !== 'out';
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
    }

    // ---- pass 1: bodies ----------------------------------------------------------
    for (let i = 0; i < n; i++) {
      const ctx = ctxs[i]!;
      const st = ctx.st;
      st.delta = createDelta();
      if (st.spec.frame.ox === 0 && st.spec.frame.oz === 0) st.spec = createSpec(ctx.frame);
      st.spec.free = false;
      if (st.mode === 'down' || st.mode === 'out') this.bodyDown(ctx);
      else this.bodyStanding(ctx, dtMs, snap);
    }

    // ---- pass 2a: guards and defences --------------------------------------------
    for (let i = 0; i < n; i++) {
      const ctx = ctxs[i]!;
      const st = ctx.st;
      if (st.mode === 'down' || st.mode === 'out') continue;
      const g = guardHands(ctx, st.spec, st.delta);
      for (const side of [0, 1] as const) {
        const h = st.spec.hands[side];
        h.pos = g.pos[side]; h.pole = g.pole[side]; h.palm = g.palm[side]; h.w = 1; h.fist = g.fist; h.fistTarget = false;
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
      (st as unknown as { guard: typeof g }).guard = g;
      solveSpec(st.spec, st.rig, st.pose, st.world, true);
    }

    // ---- pass 2b: weapons ------------------------------------------------------------
    for (let i = 0; i < n; i++) {
      const ctx = ctxs[i]!;
      const st = ctx.st;
      st.ikTargets = [];
      if (st.mode !== 'standing' && st.mode !== 'getup') continue;
      const tm = ctx.my;
      if (!tm) continue;
      const info = classify(tm.id, ctx.lead);
      const g = (st as unknown as { guard: ReturnType<typeof guardHands> }).guard;
      const plan = this.plan(ctx, tm, info);
      const cap = st.cap;
      const hands = (): V3 | null => (plan && cap
        ? capStrikeHands(cap, ctx, tm, info, st.spec, g, plan)
        : strikeHands(ctx, tm, info, st.spec, g));
      const aim = hands();
      solveSpec(st.spec, st.rig, st.pose, st.world, true);
      if (aim && info.hand !== -1) {
        const elbow = info.kind === 'elbow';
        const act = tm.activeEnd - tm.contact;
        const w = elbow ? windowW(ctx.nowMs - tm.contact, -170, -15, act, act + 170) : 1;
        if (w > 0) {
          this.reachAssist(ctx, tm, info.hand as 0 | 1, elbow ? aim : null, w, () => {
            hands();
            solveSpec(st.spec, st.rig, st.pose, st.world, true);
          });
        }
      }
      this.headClearance(ctx, info.hand === 0 ? -1 : 1);
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

    // ---- fades, face, output ---------------------------------------------------------------
    for (let i = 0; i < n; i++) {
      const st = this.st[i];
      if (st.fade) {
        const u = (now - st.fade.t0) / st.fade.dur;
        if (u >= 1 || u < 0) st.fade = null;
        else {
          blendPose(st.pose, st.fade.from, st.pose, smooth(u));
          forwardKinematics(st.world, st.pose, st.rig.rest);
        }
      }
      st.lastSpec = st.spec;
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

  private placement(F0: TickSnapshot, F1: TickSnapshot | null, alpha: number, n: number, now: number, events: readonly SimEvent[]): FighterFrame[] {
    const raw = (fr: TickSnapshot | null, i: number, a: number): V3 => {
      const f0 = F0.fighters[i];
      const f1 = fr ? fr.fighters[i] : null;
      if (!f1) return [f0.x, 0, f0.z];
      return [lerp(f0.x, f1.x, a), 0, lerp(f0.z, f1.z, a)];
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
    const p0 = place(0);
    const p1 = F1 ? place(1) : p0;
    const span = F1 ? Math.max(0.05, F1.t - F0.t) : 0.1;
    const out: FighterFrame[] = [];
    for (let i = 0; i < n; i++) {
      const f = F0.fighters[i];
      const nx = F1 ? F1.fighters[i] ?? null : null;
      const vel: V3 = F1 ? [(p1[i][0] - p0[i][0]) / span, 0, (p1[i][2] - p0[i][2]) / span] : [0, 0, 0];
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
      d.idle = idleResidual(cap, st.tiers.guardStyle, ctx.f.stance, st.seed, ctx.nowMs / 1000, new Float64Array(NCH));
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
   * Closed-loop reach: when the arm cannot reach its path point (the target is
   * further than the lunge estimate allowed), carry the hips and chest the
   * rest of the way — the planted feet stay put (the pelvis drops to keep them
   * in reach). Misses are left short: falling short IS the miss.
   */
  private reachAssist(
    ctx: Ctx, tm: ActionTiming, hand: 0 | 1, elbow: V3 | null, weight: number, retarget: () => void,
  ): void {
    if (tm.result === 'missed' || tm.result === 'evaded') return;
    const st = ctx.st;
    const spec = st.spec;
    const h = spec.hands[hand];
    if (!h.fistTarget && !elbow) return;
    const y0 = spec.pelvis[1];
    let moved = 0;
    const cap = 0.14 * st.rig.scale * weight;
    for (let it = 0; it < 4; it++) {
      const wp = elbow ? worldP(st.world, hand === 0 ? B.lForeArm : B.rForeArm) : fistPoint(st.world, st.rig, hand);
      const goal = elbow ?? h.pos;
      const err = sub(goal, wp);
      const e3 = Math.hypot(err[0], err[1], err[2]);
      if (e3 < 0.003 || moved >= cap) break;
      const k = Math.min(e3 * weight, cap - moved) / e3;
      moved += e3 * k;
      spec.pelvis = [spec.pelvis[0] + err[0] * k, spec.pelvis[1] + err[1] * k * 0.7, spec.pelvis[2] + err[2] * k];
      spec.spinePitch += e3 * k * 0.5;
      clampPelvis(spec, st);
      // Never squat into a punch: past 6 cm of drop, lean instead.
      if (spec.pelvis[1] < y0 - 0.06) spec.pelvis[1] = y0 - 0.06;
      solveSpec(spec, st.rig, st.pose, st.world, false);
      if (elbow) retarget();
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
      const d = createDelta();
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
      forwardKinematics(st.world, st.pose, st.rig.rest);
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
        st.delta = createDelta();
        const d = st.delta;
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
        }
        solveSpec(st.spec, st.rig, st.pose, st.world, true);
      }
    }
    void now;
  }
}

function lerpFatigue(a: FighterSnapshot['fatigueVisual'], b: FighterSnapshot['fatigueVisual'], t: number): FighterSnapshot['fatigueVisual'] {
  return {
    f: lerp(a.f, b.f, t), breathingRate: lerp(a.breathingRate, b.breathingRate, t),
    handsDrop: lerp(a.handsDrop, b.handsDrop, t), flatFeet: lerp(a.flatFeet, b.flatFeet, t), chinUp: lerp(a.chinUp, b.chinUp, t),
  };
}

export { resetPose, windowW, toWorld, blendKey };
