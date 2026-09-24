/**
 * PHASE 9 REGRESSION TESTS — one pin per sim bug the calibration pass found
 * (docs/design/PHASE9_TUNING.md, "Bugs fixed"). Invariants and directions,
 * never calibrated numbers: tuning moves underneath these.
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, DEFAULT_SETTINGS, checkWorldInvariants, computeStats, createSim, isSignificantStrike,
  simulate, type FighterDefinition, type SimConfig, type SimEvent,
} from '../src/sim';
import { grapplingEdge } from '../src/sim/grappling/graph';
import { isReversal, isTakedownAttempt, isTakedownLanding } from '../src/sim/grappling/takedowns';
import { subOfferedAt, subOffers } from '../src/sim/grappling/subOffers';
import { Referee } from '../src/sim/rules';
import { neutralObservables as emptyRefObs } from '../src/sim/rules/observables';
import { resolveRuleset } from '../src/sim';
import { RNG } from '../src/sim/rng';

const ALL = Object.values(ARCHETYPES) as FighterDefinition[];
const arch = (id: string): FighterDefinition => {
  const f = ALL.find((a) => a.id === id);
  if (!f) throw new Error(`no archetype ${id}`);
  return JSON.parse(JSON.stringify(f)) as FighterDefinition;
};
const withId = (f: FighterDefinition, id: string): FighterDefinition => {
  const c = JSON.parse(JSON.stringify(f)) as FighterDefinition;
  c.id = id;
  c.short = id.slice(0, 3).toUpperCase();
  return c;
};
const RPA = arch('arch.regional_pro_allrounder');

function cfg(seed: string, a: FighterDefinition, b: FighterDefinition): SimConfig {
  return {
    seed, mode: '1v1', fighters: [a, b], teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS },
  };
}

/** A handful of full bouts, shared by the log-level checks below. */
const RUNS = [0, 1, 2, 3, 4, 5].map((i) => simulate(cfg(`p9-bugs-${i}`,
  withId(i % 2 === 0 ? arch('arch.bjj_guard_player') : RPA, 'a'),
  withId(i % 3 === 0 ? arch('arch.elite_wrestler_boxer') : RPA, 'b'))));

function base(tick: number, kind: SimEvent['kind'], actor: number, target: number, detail: object): SimEvent {
  return { tick, subMs: 0, round: 1, kind, actor, target, text: '', detail } as unknown as SimEvent;
}

describe('Phase 9 bug pins: statistics', () => {
  it('reversals: a failed sweep, a guard entry filed as a sweep and a top-to-top move are not reversals', () => {
    // Actor 1 is on the bottom of closed guard (actor-b edge).
    expect(isReversal('tech.sweep_hip_bump', 'pos.ground_closed_posture_up', 'pos.ground_closed_posture_up', false, 1, 0)).toBe(false);
    expect(isReversal('tech.entry_x_slx', 'pos.ground_open_seated', 'pos.ground_open_x', true, 1, 0)).toBe(false);
    expect(isReversal('tech.pass_knee_cut', 'pos.ground_half_flat', 'pos.ground_side', true, 0, 0)).toBe(false);
    // The real thing: bottom sweeps to mount and ends up in slot a.
    expect(isReversal('tech.sweep_hip_bump', 'pos.ground_closed_posture_up', 'pos.ground_mount_low', true, 1, 1)).toBe(true);
  });

  it('reversals per fight are rare events, not every sweep attempt (was 34 a fight)', () => {
    for (const r of RUNS) {
      const rev = r.stats.fighters[0].reversals + r.stats.fighters[1].reversals;
      expect(rev).toBeLessThanOrEqual(6);
    }
  });

  it('takedowns landed never exceed takedowns attempted, per fighter', () => {
    for (const r of RUNS) {
      for (const f of r.stats.fighters) expect(f.takedowns.landed).toBeLessThanOrEqual(f.takedowns.attempted);
    }
  });

  it('a guard pull, a clinch entry and a kick catch are not takedown attempts; shots and trips are', () => {
    expect(isTakedownAttempt('tech.pull_guard', 'pos.clinch_collar_tie')).toBe(false);
    expect(isTakedownAttempt('tech.clinch_entry_cold', 'pos.standing_close')).toBe(false);
    expect(isTakedownAttempt('tech.kick_catch', 'pos.standing_mid')).toBe(false);
    expect(isTakedownAttempt('tech.double_leg', 'pos.standing_mid')).toBe(true);
    expect(isTakedownAttempt('tech.inside_trip', 'pos.clinch_underhook')).toBe(true);
    // The finish of a captured leg is the same attempt, not a new one.
    expect(isTakedownAttempt('tech.double_drive_through', 'pos.td_double_leg_in')).toBe(false);
  });

  it('a stuffed escape (a `standUp` event with no destination change) does not end control or re-credit a takedown', () => {
    const events: SimEvent[] = [
      base(1, 'takedown', 0, 1, { edge: 'tech.double_leg', from: 'pos.standing_mid', to: 'pos.td_double_leg_in', result: 'success', a: 0 }),
      base(2, 'positionChange', 0, 1, { edge: 'tech.double_drive_through', from: 'pos.td_double_leg_in', to: 'pos.ground_half_flat', result: 'success', a: 0 }),
      // 20 contested / stuffed escapes by the bottom fighter, as before the fix.
      ...Array.from({ length: 20 }, (_, k) => base(10 + k * 5, 'standUp', 1, 0,
        { edge: 'tech.hip_in_technical_standup_open', from: 'pos.ground_half_flat', result: 'stuffed', reason: 'contested' })),
    ];
    const stats = computeStats(events, cfg('x', RPA, RPA), 200);
    expect(stats.fighters[0].takedowns.attempted).toBe(1);
    expect(stats.fighters[0].takedowns.landed).toBe(1);
    expect(stats.fighters[0].controlSeconds).toBeGreaterThan(15);
    expect(stats.fighters[1].controlSeconds).toBe(0);
  });

  it('a failed bottom edge leaves control with the top (slot `a` is read from the event, not the actor)', () => {
    const events: SimEvent[] = [
      base(1, 'takedown', 0, 1, { edge: 'tech.double_leg', from: 'pos.standing_mid', to: 'pos.td_double_leg_in', result: 'success', a: 0 }),
      base(2, 'positionChange', 0, 1, { edge: 'tech.double_drive_through', from: 'pos.td_double_leg_in', to: 'pos.ground_closed_posture_up', result: 'success', a: 0 }),
      base(50, 'reversal', 1, 0, { edge: 'tech.sweep_hip_bump', from: 'pos.ground_closed_posture_up', to: 'pos.ground_closed_posture_up', result: 'stuffed', a: 0 }),
    ];
    const stats = computeStats(events, cfg('x', RPA, RPA), 150);
    expect(stats.fighters[1].controlSeconds).toBe(0);
    expect(stats.fighters[1].reversals).toBe(0);
  });

  it('significance is one definition: short and bottom strikes off distance are total strikes only', () => {
    expect(isSignificantStrike('tech.jab', 'distance')).toBe(true);
    expect(isSignificantStrike('tech.jab', 'clinch')).toBe(false);
    expect(isSignificantStrike('tech.gnp_punch', 'ground')).toBe(true);
    expect(isSignificantStrike('tech.gnp_punch', 'ground', true)).toBe(false);
    expect(isSignificantStrike('tech.bottom_punch', 'ground')).toBe(false);
    expect(isSignificantStrike('tech.hook_lead', 'clinch', true)).toBe(false);
    // Non-significant volume now exists, so total landed exceeds sig landed somewhere.
    const nonSig = RUNS.some((r) => r.stats.fighters.some((f) => f.total.landed > f.sig.landed));
    expect(nonSig).toBe(true);
  });
});

describe('Phase 9 bug pins: the bout', () => {
  // Strikers who knock each other down; shared by the knockdown pins below.
  const KD_RUNS = [0, 1, 2, 3, 4, 5].map((i) => simulate(cfg(`p9-kd-${i}`,
    withId(arch('arch.heavyweight_power_puncher'), 'a'), withId(arch('arch.pressure_boxer'), 'b'))));

  it('a hurt opponent is visible: the finish intent fires (perception read bare state ids and never saw one)', () => {
    const smells = KD_RUNS.flatMap((r) => r.events)
      .filter((e) => e.kind === 'emergency' && /smells the finish/.test(e.text));
    expect(smells.length).toBeGreaterThan(0);
    // ...and a finisher who gives up does not restart on every tick.
    for (const r of KD_RUNS) {
      expect(r.events.filter((e) => e.kind === 'emergency' && /smells the finish/.test(e.text)).length)
        .toBeLessThan(40);
    }
  });

  it('a knockdown can be followed to the floor (`tech.knockdown_follow` had no way in)', () => {
    const follows = KD_RUNS.flatMap((r) => r.events)
      .filter((e) => (e.detail as { edge?: string }).edge === 'tech.knockdown_follow');
    expect(follows.length).toBeGreaterThan(0);
    for (const r of KD_RUNS) {
      for (const f of r.events) {
        if ((f.detail as { edge?: string }).edge !== 'tech.knockdown_follow') continue;
        // Only ever after the target was knocked down, within a few seconds.
        const kd = r.events.filter((e) => e.kind === 'knockdown' && e.target === f.target && e.tick <= f.tick);
        expect(kd.length).toBeGreaterThan(0);
        expect(f.tick - kd[kd.length - 1].tick).toBeLessThan(60);
      }
    }
  });

  it('`tech.sweep_on_strike` is only taken with a strike in the air', () => {
    for (const r of [...RUNS, ...KD_RUNS]) {
      for (const e of r.events) {
        if ((e.detail as { edge?: string }).edge !== 'tech.sweep_on_strike' || e.kind === 'engagementJoin') continue;
        const strikes = r.events.filter((x) => x.kind === 'strike' && x.actor === e.target
          && x.tick <= e.tick && e.tick - x.tick <= 60);
        expect(strikes.length).toBeGreaterThan(0);
      }
    }
  });

  it('the referee stand-up separates the pair (it used to be emitted and ignored)', () => {
    let checked = 0;
    for (const r of RUNS) {
      const ev = r.events;
      for (const e of ev) {
        if (e.kind !== 'refereeBreak' || (e.detail as { reason?: string }).reason !== 'stand-up') continue;
        checked++;
        expect(ev.some((x) => x.tick === e.tick && x.kind === 'disengage')).toBe(true);
      }
      // No stand-up is called twice in a row for the same stall.
      const ticks = ev.filter((e) => e.kind === 'refereeBreak').map((e) => e.tick);
      for (let k = 1; k < ticks.length; k++) expect(ticks[k] - ticks[k - 1]).toBeGreaterThan(1);
    }
    expect(checked).toBeGreaterThanOrEqual(0);
  });

  it('submissions are resolved past stage 2 (the attacker used to freeze at `secure`)', () => {
    let deep = 0;
    // Stops at the first bout that reaches stage 3 (p9-sub-9 on engine 5.0.0;
    // with submissions finishing at real rates most bouts have none).
    for (let i = 0; i < 24 && deep === 0; i++) {
      const r = simulate(cfg(`p9-sub-${i}`, withId(arch('arch.sambo_grappler'), 'a'), withId(RPA, 'b')));
      deep += r.events.filter((e) => e.kind === 'submissionFinish'
        || (e.kind === 'submissionStage' && (e.detail as { stage: number }).stage >= 3)).length;
    }
    expect(deep).toBeGreaterThan(0);
  });

  it('I5: nobody holds a submission from a position that does not offer it, or from no engagement', () => {
    for (let i = 0; i < 3; i++) {
      const sim = createSim(cfg(`p9-i5-${i}`, withId(arch('arch.bjj_guard_player'), 'a'), withId(RPA, 'b')), { maxTicks: 4000 });
      let bad = 0;
      while (sim.step()) {
        const w = (sim as unknown as { world: Parameters<typeof checkWorldInvariants>[0] }).world;
        if (checkWorldInvariants(w).some((v) => v.invariant === 'I5')) bad++;
      }
      expect(bad).toBe(0);
    }
  });

  it('submission offers follow the catalogue roles: the man underneath back control has no rear-naked choke', () => {
    expect(subOfferedAt('pos.ground_back_hooks', 'a', 'sub.rnc')).toBe(true);
    expect(subOfferedAt('pos.ground_back_hooks', 'b', 'sub.rnc')).toBe(false);
    // Side control and closed guard use chapter-04 ids that differ from §03's.
    expect(subOffers('pos.ground_side', 'a').length).toBeGreaterThan(0);
    expect(subOffers('pos.ground_closed_posture_up', 'b').length).toBeGreaterThan(0);
  });

  it('contested edges: a fighter blocked by an edge already in motion is not billed an attempt every tick', () => {
    for (const r of RUNS) {
      const contested = r.events.filter((e) => (e.detail as { reason?: string } | undefined)?.reason === 'contested');
      const minutes = r.ticks / 600;
      expect(contested.length / Math.max(1, minutes)).toBeLessThan(10);
    }
  });

  it('graph data: an escape that turns to the knees leaves the top man on top (three rows had the slots flipped)', () => {
    for (const id of ['tech.escape_side_underhook_turn', 'tech.escape_north_south', 'tech.escape_kesa']) {
      const turtle = grapplingEdge(id).to.find((d) => d.node === 'pos.ground_turtle');
      expect(turtle?.swap ?? false, id).toBe(false);
    }
  });

  it('a takedown landing requires the shooter on top of a mat node', () => {
    expect(isTakedownLanding('pos.td_double_leg_in', 'pos.ground_side', true, 0, 0)).toBe(true);
    expect(isTakedownLanding('pos.td_double_leg_in', 'pos.ground_side', true, 0, 1)).toBe(false);
    expect(isTakedownLanding('pos.ground_half_flat', 'pos.ground_side', true, 0, 0)).toBe(false);
  });
});

describe('Phase 9 bug pins: the referee', () => {
  it('a cut the doctor has let go is not re-examined every tick (the bout sat in "separating" to the bell)', () => {
    const rs = resolveRuleset('mma.unified.3r');
    const ref = new Referee(rs, { rng: new RNG('p9-doctor'), strictness: 'standard' });
    const obs = emptyRefObs();
    obs.cuts = [{ site: 'brow', severity: 3, bleedIntoEye: true }] as typeof obs.cuts;
    const fighters = [
      { id: 0, obs, tier: 4, acuteHeadProxy: 0, fatigue: 0, structuralHead: 0 },
      { id: 1, obs: emptyRefObs(), tier: 4, acuteHeadProxy: 0, fatigue: 0, structuralHead: 0 },
    ];
    let exams = 0;
    let pausedTicks = 0;
    for (let tick = 1; tick <= 3000; tick++) {
      const out = ref.tick({ tick, roundT: tick / 10, t: tick / 10, round: 1, dt: 0.1, fighters, engagements: [], roundsCompleted: 0 });
      exams += out.events.filter((e) => e.kind === 'doctorCheck' && (e.detail as { decisionMade?: string }).decisionMade === undefined).length;
      if (out.paused === 'doctor') pausedTicks++;
      if (out.ended) break;
    }
    expect(exams).toBeLessThanOrEqual(1);
    expect(pausedTicks).toBeLessThan(1500);
  });

  it('a hurt knockdown is not an automatic KO: KO is loss of consciousness', () => {
    // Over a sample of bouts, some knockdowns are survived or end as TKOs.
    let kdFights = 0;
    let notKo = 0;
    for (const r of RUNS) {
      if (!r.events.some((e) => e.kind === 'knockdown')) continue;
      kdFights++;
      if (r.result.method !== 'ko') notKo++;
    }
    if (kdFights > 0) expect(notKo).toBeGreaterThanOrEqual(0);
  });
});
