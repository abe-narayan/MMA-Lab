/**
 * SYNTHETIC TIMELINES — recorded-shaped frames and events for one technique,
 * a footwork pattern or a knockdown, built exactly the way the sim builds them
 * (pending contact on the snapshot until the tick that resolves it, then the
 * strike event at `tick*100 + subMs`). Used by the dev technique browser and
 * the animation tests, so both exercise the same timing reconstruction the
 * real bouts do.
 */
import {
  ARCHETYPES, deriveRuntime, resolveArena, resolveParams, TECHNIQUES,
  type FighterDefinition, type FighterRuntime, type FighterSnapshot, type SimEvent, type StrikeEvent,
  type TickSnapshot,
} from '../../sim';
import type { BoutPresentation, FrameInput } from '../contract';
import { defaultRest, finishRest, type RestSkeleton } from '../rig/skeleton';

export type SynthResult = 'landed' | 'blocked' | 'evaded' | 'missed' | 'checked' | 'caught';

export interface SynthAction {
  fighter: number;
  technique: string;
  commitMs: number;
  result: SynthResult;
  defence?: string;
  region?: 'head' | 'body' | 'leadLeg' | 'rearLeg' | 'arms';
  subLocation?: string;
  forceN?: number;
  knockdown?: 'flash' | 'hurt' | 'ko' | 'body' | 'leg';
  /** How long the defender stays down (ms) after a knockdown. */
  downMs?: number;
}

export interface SynthMove {
  fighter: number;
  fromMs: number;
  toMs: number;
  /** World velocity, m/s. */
  vx: number;
  vz: number;
}

export interface Scenario {
  fighters: FighterDefinition[];
  runtimes?: FighterRuntime[];
  stances: ('orthodox' | 'southpaw')[];
  start: [number, number][];
  durationMs: number;
  actions: SynthAction[];
  moves?: SynthMove[];
  /** Constant fatigue (0-1) per fighter. */
  fatigue?: number[];
  states?: string[][];
  /** Exec-time multiplier (tier); default from the runtime. */
  execMult?: number[];
}

export interface SynthBout {
  bout: BoutPresentation;
  frames: TickSnapshot[];
  events: SimEvent[];
  rests: RestSkeleton[];
}

const TECH_BY_ID = new Map(TECHNIQUES.map((t) => [t.id, t]));

export function archetype(id: string): FighterDefinition {
  const a = Object.values(ARCHETYPES).find((x) => x.id === id);
  if (!a) throw new Error(`no archetype ${id}`);
  return a;
}

let params: ReturnType<typeof resolveParams> | null = null;
export function runtimeOf(def: FighterDefinition): FighterRuntime {
  params ??= resolveParams();
  return deriveRuntime(def, params, { explain: false });
}

export function restFor(rt: FighterRuntime | undefined): RestSkeleton {
  const base = defaultRest();
  const k = rt ? rt.body.heightM / 1.78 : 1;
  const h = base.head.map((v) => v * k);
  const t = base.tail.map((v) => v * k);
  return finishRest(h, t, base.statureM * k);
}

export function presentationFor(fighters: FighterDefinition[], runtimes: FighterRuntime[], seed = 'dev'): BoutPresentation {
  return {
    fighters, runtimes, teamOf: fighters.map((_, i) => i),
    arena: resolveArena('octagon_30'), rulesetId: 'mma.unified.3r', glove: 'mma4oz',
    cornerColours: ['#c0392b', '#2e6fd8', '#27ae60', '#f39c12'], blood: false, cosmeticSeed: seed,
  };
}

function baseSnap(id: number, x: number, z: number, facing: number, stance: 'orthodox' | 'southpaw'): FighterSnapshot {
  return {
    id, team: id, x, z, facing, vx: 0, vz: 0, stance, leadFoot: 0, againstFence: false, fenceNormalAngle: 0,
    posture: 'standing', position: 'pos.standing_open', role: 'none', partnerId: null,
    action: 'idle', actionPhase: 0, actionStage: 'none', actionResult: 'none', defence: 'def.neutral',
    actionDetail: {
      startTick: 0, totalMs: 0, contactTick: 0, contactOffsetMs: 0, target: 'none', subLocation: null,
      side: stance === 'orthodox' ? 'L' : 'R', targetId: null, forceNorm: 0, direction: 'front',
    },
    defenceDetail: { phase: 1, side: 'both' },
    stamina: { total: 1, burst: 1 }, damage: { head: 0, body: 0, legs: 0, cut: 0 }, state: 0, states: [],
    balance: 1, sub: { technique: null, stage: 0, progress: 0 }, sig: { landed: 0, attempted: 0 },
    intentTag: 'probe', grips: [],
    contacts: { footL: true, footR: true, kneeL: false, kneeR: false, handL: false, handR: false, hipL: false, hipR: false, back: false, chest: false, fence: false },
    damageVisual: { zones: [0, 0, 0, 0, 0, 0, 0, 0], swelling: [0, 0, 0, 0, 0, 0, 0, 0], cuts: [], bloodOnGloves: 0 },
    fatigueVisual: { f: 0, breathingRate: 14, handsDrop: 0, flatFeet: 0, chinUp: 0 },
  };
}

interface Timed {
  a: SynthAction;
  commit: number;
  contact: number;
  total: number;
  cTick: number;
  sub: number;
  endTick: number;
}

export function buildScenario(sc: Scenario): SynthBout {
  const runtimes = sc.runtimes ?? sc.fighters.map(runtimeOf);
  const n = sc.fighters.length;
  const ticks = Math.ceil(sc.durationMs / 100);
  const events: SimEvent[] = [];
  const timed: Timed[] = sc.actions.map((a) => {
    const spec = TECH_BY_ID.get(a.technique);
    const rt = runtimes[a.fighter];
    const fist = spec ? spec.weapon === 'fist' || spec.weapon === 'backfist' : true;
    const mult = sc.execMult?.[a.fighter] ?? (fist ? rt.execTimeMultPunch : rt.execTimeMultKick) ?? 1;
    const startup = spec ? Math.max(1, Math.round(spec.startupMs * mult)) : 300;
    const total = spec ? Math.round((spec.startupMs + spec.activeMs + spec.recoveryMs) * mult) : 700;
    const contact = a.commitMs + startup;
    return {
      a, commit: a.commitMs, contact, total,
      cTick: Math.floor(contact / 100), sub: contact % 100, endTick: Math.ceil((a.commitMs + total) / 100),
    };
  });
  // Positions: integrate moves.
  const pos = sc.start.map((p) => [p[0], p[1]] as [number, number]);
  const frames: TickSnapshot[] = [];
  const down: { f: number; from: number; to: number; kind: string }[] = [];
  for (const t of timed) {
    if (t.a.knockdown) {
      const target = t.a.fighter === 0 ? 1 : 0;
      down.push({ f: target, from: t.cTick + 1, to: t.cTick + 1 + Math.round((t.a.downMs ?? 2500) / 100), kind: t.a.knockdown });
    }
  }
  for (let k = 0; k <= ticks; k++) {
    const nowMs = k * 100;
    const fs: FighterSnapshot[] = [];
    for (let i = 0; i < n; i++) {
      let vx = 0, vz = 0;
      for (const m of sc.moves ?? []) if (m.fighter === i && nowMs >= m.fromMs && nowMs < m.toMs) { vx = m.vx; vz = m.vz; }
      if (k > 0) { pos[i][0] += vx * 0.1; pos[i][1] += vz * 0.1; }
      const o = (i + 1) % n;
      const f = baseSnap(i, pos[i][0], pos[i][1], 0, sc.stances[i] ?? 'orthodox');
      f.facing = Math.atan2(sc.start[o][0] - pos[i][0], sc.start[o][1] - pos[i][1]);
      f.vx = vx; f.vz = vz;
      f.actionDetail.targetId = o;
      f.actionDetail.startTick = k; f.actionDetail.contactTick = k;
      if (vx !== 0 || vz !== 0) f.action = 'move';
      const fat = sc.fatigue?.[i] ?? 0;
      f.fatigueVisual = { f: fat, breathingRate: 12 + 36 * fat, handsDrop: Math.max(0, fat - 0.3), flatFeet: Math.max(0, fat - 0.4), chinUp: Math.max(0, fat - 0.4) };
      f.states = [...(sc.states?.[i] ?? [])];
      fs.push(f);
    }
    for (const t of timed) {
      const f = fs[t.a.fighter];
      const commitTick = Math.floor(t.commit / 100);
      if (k < commitTick || k >= t.endTick) continue;
      f.action = t.a.technique;
      f.actionDetail.totalMs = t.total;
      f.actionDetail.targetId = t.a.fighter === 0 ? 1 : 0;
      if (k < t.cTick) {
        f.actionDetail.startTick = commitTick;
        f.actionDetail.contactTick = t.cTick;
        f.actionDetail.contactOffsetMs = t.sub;
        const el = nowMs - t.commit;
        f.actionPhase = el < 0 ? 0 : Math.min(1, el / t.total);
        f.actionStage = el < 0 ? 'none' : 'startup';
      } else {
        f.actionResult = t.a.result === 'checked' || t.a.result === 'caught' ? 'blocked' : t.a.result;
      }
      // The defender shows the defence around the contact.
      const d = fs[t.a.fighter === 0 ? 1 : 0];
      if (t.a.defence && nowMs >= t.contact - 350 && nowMs <= t.contact + 200) d.defence = t.a.defence;
    }
    for (const dn of down) {
      if (k >= dn.from && k < dn.to) {
        fs[dn.f].posture = 'down';
        fs[dn.f].states.push(dn.kind === 'ko' ? 'state.ko' : dn.kind === 'flash' ? 'state.knockdown_flash' : 'state.knockdown_hurt');
      }
      if (dn.kind === 'ko' && k >= dn.to) fs[dn.f].posture = 'down';
    }
    frames.push({
      v: 4, tick: k, t: nowMs / 1000, round: 1, roundTime: nowMs / 1000, phase: 'round',
      fighters: fs, engagements: [], referee: { state: 'watching' }, score: { hidden: true },
    });
  }
  for (const t of timed) {
    const spec = TECH_BY_ID.get(t.a.technique);
    const target = t.a.fighter === 0 ? 1 : 0;
    const region = t.a.region ?? (spec ? spec.targets[0] : 'head');
    const se: StrikeEvent = {
      tick: t.cTick, subMs: t.sub, round: 1, kind: 'strike', actor: t.a.fighter, target,
      text: `${t.a.technique} ${t.a.result}`,
      detail: {
        technique: t.a.technique, result: t.a.result, target: region,
        subLocation: t.a.subLocation, forceN: t.a.result === 'landed' ? (t.a.forceN ?? (spec ? spec.forceMedianN : 2000)) : 0,
        defence: t.a.defence, unseen: false,
      },
    };
    events.push(se);
    if (t.a.knockdown) {
      events.push({
        tick: t.cTick, subMs: t.sub, round: 1, kind: 'knockdown', actor: t.a.fighter, target,
        text: 'knockdown', detail: { kind: t.a.knockdown, cause: t.a.technique, region: 'head', severity: 1 },
      } as SimEvent);
    }
  }
  events.sort((x, y) => x.tick * 100 + x.subMs - (y.tick * 100 + y.subMs));
  const bout = presentationFor(sc.fighters, runtimes);
  return { bout, frames, events, rests: runtimes.map(restFor) };
}

/** FrameInput at sim time `tMs` (events up to and including the next frame's tick). */
export function frameAt(sb: { frames: TickSnapshot[]; events: SimEvent[] }, tMs: number, discontinuity = false, eventsThroughNext = true): FrameInput {
  const fr = sb.frames;
  const t0 = fr[0].t * 1000;
  const k = Math.max(0, Math.min(fr.length - 1, Math.floor((tMs - t0) / 100 + 1e-9)));
  const frame = fr[k];
  const next = k + 1 < fr.length ? fr[k + 1] : null;
  const alpha = next ? Math.max(0, Math.min(1, (tMs - frame.t * 1000) / ((next.t - frame.t) * 1000))) : 0;
  const lim = eventsThroughNext && next ? next.tick : frame.tick;
  const ev: SimEvent[] = [];
  for (const e of sb.events) {
    if (e.tick > lim) break;
    if (e.tick >= lim - 60) ev.push(e);
  }
  return {
    frame, next, alpha, simTime: tMs / 1000, events: ev, playbackRate: 1, replay: false, discontinuity,
  };
}

/** Events sorted by time are required by `frameAt`. */
export function sortEvents(ev: SimEvent[]): SimEvent[] {
  return [...ev].sort((a, b) => a.tick * 100 + a.subMs - (b.tick * 100 + b.subMs));
}
