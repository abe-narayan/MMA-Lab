/**
 * PARAMETER-EFFECT HARNESS — proof that a creator control changes a bout.
 *
 * For one `ProfileParam` with a probe, run the same seeds twice: once with
 * the parameter at its probe's low value and once at its high value, against
 * the same opponent, and measure the named statistic. Common seeds on both
 * sides (paired comparison) keep the noise down enough that a handful of
 * short bouts separates a real effect from none.
 *
 * Environment-free and deterministic: used by `tests/ui.params-effect.test.ts`
 * and by `scripts/dev/param-effects.ts`, which prints the table in
 * docs/design/UI_PASS.md.
 */

import {
  computeStats, createSim, DEFAULT_SETTINGS, SUB_SKILLS, ARCHETYPES,
  type CoreDisciplineId, type FighterDefinition, type SimConfig, type StrikeEvent, type GrappleEvent,
} from '../../sim';
import type { EffectProbe, MetricId, ProfileParam } from './profileModel';
import { setComposite, TECHNICAL_GROUPS } from './profileModel';
import { deleteAtPath, setAtPath } from './paths';

export const PROBE_DEFAULTS = Object.freeze({
  seeds: 16,
  rounds: 1,
  roundSeconds: 60,
  sampleEveryTicks: 10,
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * The probe base: the regional-pro reference fighter (T3, the calibration
 * anchor) with every art he has not trained added at an ordinary 50, so a
 * TECHNICAL composite has something to move in every group.
 */
export function probeBase(): FighterDefinition {
  const src = ARCHETYPES['arch.regional_pro_allrounder'];
  if (!src) throw new Error('the regional-pro reference archetype is missing');
  let def = clone(src);
  def = { ...def, id: 'probe.subject', name: 'Probe Subject', short: 'PRB' };
  for (const d of Object.keys(SUB_SKILLS) as CoreDisciplineId[]) {
    if (def.disciplines[d]) continue;
    const sub: Record<string, number> = {};
    for (const s of SUB_SKILLS[d]) sub[s] = 50;
    def = setAtPath(def, `disciplines.${d}`, { years: 5, sub, trainingQuality: 1 });
  }
  return def;
}

export function probeOpponent(kind: EffectProbe['opponent'] = 'mirror'): FighterDefinition {
  let def = probeBase();
  def = { ...def, id: 'probe.opponent', name: 'Probe Opponent', short: 'OPP' };
  if (kind === 'striker') {
    def = setComposite(def, TECHNICAL_GROUPS.striking, 75);
    def = setAtPath(def, 'style.pressureBias', 75);
    def = setAtPath(def, 'style.primaryMode', 'pressureStriking');
  } else if (kind === 'grappler') {
    def = setComposite(def, TECHNICAL_GROUPS.wrestling, 80);
    def = setComposite(def, TECHNICAL_GROUPS.grappling, 80);
    def = setAtPath(def, 'style.primaryMode', 'wrestleControl');
    def = setAtPath(def, 'style.preferredRange', 'clinch');
  } else if (kind === 'power') {
    def = setAtPath(def, 'physical.strength', 92);
    def = setAtPath(def, 'physical.explosiveness', 90);
    def = setComposite(def, TECHNICAL_GROUPS.boxing, 78);
    def = setAtPath(def, 'style.pressureBias', 80);
    def = setAtPath(def, 'style.primaryMode', 'pressureStriking');
  }
  return def;
}

/** Every metric but `boutsChanged`, which compares two runs and is computed in `probeParam`. */
export type MetricBag = Record<Exclude<MetricId, 'boutsChanged'>, number>;

/** Metrics that need per-tick snapshots (the rest come from events and stats). */
const SNAPSHOT_METRICS: ReadonlySet<MetricId> = new Set<MetricId>([
  'staminaMean', 'staminaEnd', 'headDamageTaken', 'bodyDamageTaken', 'legDamageTaken', 'damageDealt',
]);

export function needsSnapshots(metric: MetricId): boolean {
  return SNAPSHOT_METRICS.has(metric);
}

interface Tally {
  bouts: number; minutes: number;
  sigA: number; sigL: number; oppSigA: number; oppSigL: number;
  head: number; body: number; leg: number;
  tdA: number; tdL: number; oppTdA: number; oppTdL: number;
  control: number; subs: number; kdFor: number; kdAgainst: number;
  posG: number; posC: number; posD: number;
  stamSum: number; stamN: number; stamEnd: number;
  headTaken: number; bodyTaken: number; legTaken: number; dealt: number; dmgN: number;
  wins: number; finishes: number; absorbed: number; reversals: number;
  // event-level
  forceSum: number; forceN: number; dmgOutSum: number; dmgOutN: number; dmgInSum: number; dmgInN: number;
  oppStrikes: number; oppDefended: number; counters: number; landedAll: number;
  adjustments: number; subStagesAgainst: number; grapples: number; cageGrapples: number;
}

function emptyTally(): Tally {
  return {
    bouts: 0, minutes: 0, sigA: 0, sigL: 0, oppSigA: 0, oppSigL: 0, head: 0, body: 0, leg: 0,
    tdA: 0, tdL: 0, oppTdA: 0, oppTdL: 0, control: 0, subs: 0, kdFor: 0, kdAgainst: 0,
    posG: 0, posC: 0, posD: 0, stamSum: 0, stamN: 0, stamEnd: 0,
    headTaken: 0, bodyTaken: 0, legTaken: 0, dealt: 0, dmgN: 0, wins: 0, finishes: 0, absorbed: 0, reversals: 0,
    forceSum: 0, forceN: 0, dmgOutSum: 0, dmgOutN: 0, dmgInSum: 0, dmgInN: 0,
    oppStrikes: 0, oppDefended: 0, counters: 0, landedAll: 0, adjustments: 0, subStagesAgainst: 0,
    grapples: 0, cageGrapples: 0,
  };
}

export interface ProbeRunOptions {
  seeds?: number;
  rounds?: number;
  roundSeconds?: number;
  seedPrefix?: string;
  /** Sample per-tick snapshots (stamina and damage metrics). Default true. */
  snapshots?: boolean;
}

const DEFENDED: ReadonlySet<string> = new Set(['blocked', 'evaded', 'checked', 'caught']);

/** Run `subject` (fighter 0) against `opponent` over N seeds and measure. */
export function measure(
  subject: FighterDefinition, opponent: FighterDefinition, o: ProbeRunOptions = {},
): MetricBag {
  const seeds = o.seeds ?? PROBE_DEFAULTS.seeds;
  const snapshots = o.snapshots ?? true;
  const t = emptyTally();
  for (let i = 0; i < seeds; i++) {
    const config: SimConfig = {
      seed: `${o.seedPrefix ?? 'ui-probe'}-${i}`,
      mode: '1v1',
      fighters: [subject, opponent],
      teams: { teamOf: [0, 1] },
      ruleset: 'mma.unified.3r',
      arena: 'octagon_30',
      settings: {
        ...DEFAULT_SETTINGS,
        rounds: o.rounds ?? PROBE_DEFAULTS.rounds,
        roundSeconds: o.roundSeconds ?? PROBE_DEFAULTS.roundSeconds,
      },
    };
    const sim = createSim(config);
    let n = 0;
    let lastStam = 1;
    while (sim.step()) {
      if (!snapshots || ++n % PROBE_DEFAULTS.sampleEveryTicks !== 0) continue;
      const snap = sim.snapshot();
      const me = snap.fighters[0];
      const them = snap.fighters[1];
      t.stamSum += me.stamina.total;
      t.stamN += 1;
      lastStam = me.stamina.total;
      t.headTaken += me.damage.head;
      t.bodyTaken += me.damage.body;
      t.legTaken += me.damage.legs;
      t.dealt += them.damage.head + them.damage.body + them.damage.legs;
      t.dmgN += 1;
    }
    const result = sim.result;
    if (!result) throw new Error('bout ended without a result');
    const events = [...sim.events];
    for (const e of events) {
      if (e.kind === 'strike') {
        const d = (e as StrikeEvent).detail;
        const dmg = (d.damage?.head ?? 0) + (d.damage?.body ?? 0) + (d.damage?.legs ?? 0);
        if (e.actor === 0) {
          if (d.result === 'landed') {
            t.landedAll += 1;
            if (d.counter) t.counters += 1;
            // Power strikes only: the sim's short clinch/ground strikes (Phase 9,
            // `detail.short`) carry a fixed fraction of the force by design, and
            // their share of the mix would otherwise swamp a strength effect.
            if (typeof d.forceN === 'number' && d.short !== true) { t.forceSum += d.forceN; t.forceN += 1; }
            t.dmgOutSum += dmg; t.dmgOutN += 1;
          }
        } else if (e.actor === 1 && e.target === 0) {
          t.oppStrikes += 1;
          if (DEFENDED.has(d.result)) t.oppDefended += 1;
          if (d.result === 'landed') { t.dmgInSum += dmg; t.dmgInN += 1; }
        }
      } else if ((e.kind === 'adjustment' || e.kind === 'intentChange') && e.actor === 0) {
        t.adjustments += 1;
      } else if (e.kind === 'submissionStage' && e.target === 0) {
        t.subStagesAgainst += 1;
      } else if ((e.kind === 'takedown' || e.kind === 'clinch' || e.kind === 'positionChange') && e.actor === 0) {
        t.grapples += 1;
        if ((e as GrappleEvent).detail.cage) t.cageGrapples += 1;
      }
    }
    const stats = computeStats(events, config, sim.tick);
    const me = stats.fighters[0];
    const them = stats.fighters[1];
    t.bouts += 1;
    t.minutes += Math.max(1e-6, result.totalSeconds / 60);
    t.sigA += me.sig.attempted; t.sigL += me.sig.landed;
    t.oppSigA += them.sig.attempted; t.oppSigL += them.sig.landed;
    t.head += me.sigByTarget.head.landed; t.body += me.sigByTarget.body.landed; t.leg += me.sigByTarget.leg.landed;
    t.tdA += me.takedowns.attempted; t.tdL += me.takedowns.landed;
    t.oppTdA += them.takedowns.attempted; t.oppTdL += them.takedowns.landed;
    t.control += me.controlSeconds; t.subs += me.subAttempts;
    t.kdFor += me.knockdowns; t.kdAgainst += them.knockdowns;
    t.posG += stats.total.positionSeconds.ground;
    t.posC += stats.total.positionSeconds.clinch;
    t.posD += stats.total.positionSeconds.distance;
    t.stamEnd += lastStam;
    t.wins += result.winner === 0 ? 1 : result.winner === 'draw' ? 0.5 : 0;
    t.finishes += result.method.startsWith('decision') || result.method.startsWith('draw') ? 0 : 1;
    t.absorbed += me.sigAbsorbed;
    t.reversals += me.reversals;
  }
  const pos = Math.max(1e-6, t.posG + t.posC + t.posD);
  const landed = Math.max(1e-6, t.head + t.body + t.leg);
  return {
    sigAttemptedPerMin: t.sigA / t.minutes,
    sigLandedPerMin: t.sigL / t.minutes,
    sigAccuracy: t.sigA > 0 ? t.sigL / t.sigA : 0,
    strikeDefence: t.oppSigA > 0 ? 1 - t.oppSigL / t.oppSigA : 0,
    headLandedShare: t.head / landed,
    bodyLandedShare: t.body / landed,
    legLandedShare: t.leg / landed,
    tdAttempts: t.tdA / t.bouts,
    tdLanded: t.tdL / t.bouts,
    tdAccuracy: t.tdA > 0 ? t.tdL / t.tdA : 0,
    tdDefence: t.oppTdA > 0 ? 1 - t.oppTdL / t.oppTdA : 1,
    controlSeconds: t.control / t.bouts,
    subAttempts: t.subs / t.bouts,
    knockdownsFor: t.kdFor / t.bouts,
    knockdownsAgainst: t.kdAgainst / t.bouts,
    groundShare: t.posG / pos,
    clinchShare: t.posC / pos,
    distanceShare: t.posD / pos,
    staminaMean: t.stamN > 0 ? t.stamSum / t.stamN : 1,
    staminaEnd: t.stamEnd / t.bouts,
    headDamageTaken: t.dmgN > 0 ? t.headTaken / t.dmgN : 0,
    bodyDamageTaken: t.dmgN > 0 ? t.bodyTaken / t.dmgN : 0,
    legDamageTaken: t.dmgN > 0 ? t.legTaken / t.dmgN : 0,
    damageDealt: t.dmgN > 0 ? t.dealt / t.dmgN : 0,
    winShare: t.wins / t.bouts,
    finishShare: t.finishes / t.bouts,
    sigAbsorbedPerMin: t.absorbed / t.minutes,
    reversals: t.reversals / t.bouts,
    strikeForce: t.forceN > 0 ? t.forceSum / t.forceN : 0,
    damagePerLanded: t.dmgOutN > 0 ? t.dmgOutSum / t.dmgOutN : 0,
    damagePerLandedTaken: t.dmgInN > 0 ? t.dmgInSum / t.dmgInN : 0,
    defendedShare: t.oppStrikes > 0 ? t.oppDefended / t.oppStrikes : 0,
    counterShare: t.landedAll > 0 ? t.counters / t.landedAll : 0,
    adjustments: t.adjustments / t.bouts,
    subStagesAgainst: t.subStagesAgainst / t.bouts,
    cageShare: t.grapples > 0 ? t.cageGrapples / t.grapples : 0,
  };
}

/** Share of seeds on which the two subjects produce a different bout digest. */
export function boutsChanged(
  a: FighterDefinition, b: FighterDefinition, opponent: FighterDefinition, o: ProbeRunOptions = {},
): number {
  const seeds = o.seeds ?? PROBE_DEFAULTS.seeds;
  let differ = 0;
  for (let i = 0; i < seeds; i++) {
    const digest = (subject: FighterDefinition): string => {
      const sim = createSim({
        seed: `${o.seedPrefix ?? 'ui-probe'}-${i}`, mode: '1v1', fighters: [subject, opponent], teams: { teamOf: [0, 1] },
        ruleset: 'mma.unified.3r', arena: 'octagon_30',
        settings: { ...DEFAULT_SETTINGS, rounds: o.rounds ?? PROBE_DEFAULTS.rounds, roundSeconds: o.roundSeconds ?? PROBE_DEFAULTS.roundSeconds },
      });
      while (sim.step()) { /* to the end */ }
      return sim.digest;
    };
    if (digest(a) !== digest(b)) differ += 1;
  }
  return differ / seeds;
}

export interface EffectOutcome {
  paramId: string;
  metric: MetricId;
  lo: number;
  hi: number;
  /** (hi - lo) / max(|lo|, |hi|). */
  relChange: number;
  expectedDir: -1 | 0 | 1;
  pass: boolean;
  seeds: number;
}

/** Run one parameter's probe. `base` defaults to `probeBase()`. */
export function probeParam(
  param: ProfileParam, base: FighterDefinition = probeBase(), o: ProbeRunOptions = {},
): EffectOutcome {
  const probe = param.probe;
  if (!probe) throw new Error(`${param.id} has no probe`);
  const opp = probeOpponent(probe.opponent);
  for (const [path, value] of Object.entries(probe.baseOverrides ?? {})) {
    base = value === null ? deleteAtPath(base, path) : setAtPath(base, path, value);
  }
  const seeds = o.seeds ?? probe.seeds ?? PROBE_DEFAULTS.seeds;
  if (probe.metric === 'boutsChanged') {
    const changed = boutsChanged(param.set(base, probe.lo), param.set(base, probe.hi), opp, {
      rounds: probe.rounds, roundSeconds: probe.roundSeconds, ...o, seeds,
    });
    const minShare = probe.minRel ?? 0.5;
    return {
      paramId: param.id, metric: probe.metric, lo: 0, hi: changed, relChange: changed,
      expectedDir: probe.dir, pass: changed >= minShare, seeds,
    };
  }
  const run: ProbeRunOptions = {
    rounds: probe.rounds, roundSeconds: probe.roundSeconds, snapshots: needsSnapshots(probe.metric), ...o, seeds,
  };
  const lo = measure(param.set(base, probe.lo), opp, run)[probe.metric];
  const hi = measure(param.set(base, probe.hi), opp, run)[probe.metric];
  const denom = Math.max(Math.abs(lo), Math.abs(hi), 1e-9);
  const relChange = (hi - lo) / denom;
  const minRel = probe.minRel ?? 0.05;
  const sizeOk = Math.abs(relChange) >= minRel;
  const dirOk = probe.dir === 0 || Math.sign(relChange) === probe.dir;
  return {
    paramId: param.id, metric: probe.metric, lo, hi, relChange,
    expectedDir: probe.dir, pass: sizeOk && dirOk, seeds,
  };
}
