/**
 * Chapter 04 - submissions.
 *
 * Three kinds of test live here.
 *
 *  1. Data integrity: every id the catalogue and the chain graph reference
 *     resolves, every probability is a probability, every duration is positive.
 *     These catch transcription slips in ~700 hand-entered numbers.
 *  2. The maths: the per-window derivation really does reproduce the stage
 *     probability and the mean stage duration it was built from, and a window
 *     consumes exactly the four RNG draws 09 §2.7 budgets for it.
 *  3. Calibration: seeded Monte Carlo against the numbers §8 names - the
 *     89/11 tap-versus-unconscious split, the time-to-finish distribution, the
 *     ~25 % conversion per logged attempt and the finishing-submission mix.
 */
import { describe, expect, it } from 'vitest';
import { RNG } from '../src/sim/rng';
import { ParamRegistry } from '../src/sim/params/registry';
import { SUBMISSION_PARAMS } from '../src/sim/params/submissions.params';
import {
  SUBMISSION_CATALOGUE, conversion, submission, resolveSubmissionId, hasSubmission,
  type SubmissionSpec,
} from '../src/sim/submissions/catalogue';
import {
  CHAIN_EDGES, CHAIN_PARAMS, chainAllowed, outgoingEdges, sampleChainEdge, totalChainP,
} from '../src/sim/submissions/chains';
import {
  DEFENCE_OPTIONS, MODIFIER_IDS, MODIFIERS, STANDARD_DEFENCE, baselineEnvironment, baselineFighter,
  defenceOption, isWrongOption, pAbandon, pAttempt, perWindowBases, resolveWindow, rockedOptions,
  slip, windowProbabilities, type DefenceOptionId, type WindowContext,
} from '../src/sim/submissions/stages';
import {
  LOCK_DRAW_COUNT, capabilityLoss, jointFailure, lockedEscapeHazard, pGoOut, pInjuryBeforeTap,
  pRefuse, resolveLockedClock, resolveSlam, stubbornness, vonFlueReleaseP, type TapProfile,
} from '../src/sim/submissions/finish';
import {
  RULESET_FLAGS, SUB_RULESET_IDS, classLegality, isSelectable, submissionLegality,
} from '../src/sim/submissions/legality';
import {
  POSITION_ALIASES, SUB_POSITION_IDS, isSubPositionId, resolvePositionId,
} from '../src/sim/submissions/positions';

const POSITIONS = new Set<string>(SUB_POSITION_IDS);
const SUB_IDS = new Set<string>(SUBMISSION_CATALOGUE.map((s) => s.id));
const T4: TapProfile = { tier: 4, heart: 50, subLosses: 0, refusesToTap: false, titleFight: false };

// ---------------------------------------------------------------------------
// 1. catalogue integrity
// ---------------------------------------------------------------------------

describe('catalogue', () => {
  it('holds the 54 entries of §3 with unique ids', () => {
    expect(SUBMISSION_CATALOGUE).toHaveLength(54);
    expect(SUB_IDS.size).toBe(54);
    for (const spec of SUBMISSION_CATALOGUE) expect(spec.id.startsWith('sub.')).toBe(true);
  });

  it('references only position ids this chapter declares, and every alias resolves', () => {
    for (const spec of SUBMISSION_CATALOGUE) {
      expect(spec.entryPositions.length).toBeGreaterThan(0);
      for (const entry of spec.entryPositions) {
        expect(POSITIONS.has(entry.pos), `${spec.id} entry ${entry.pos}`).toBe(true);
        expect(isSubPositionId(entry.pos)).toBe(true);
      }
      for (const esc of spec.escapes) {
        if (esc.pos !== null) expect(POSITIONS.has(esc.pos), `${spec.id} escape ${esc.pos}`).toBe(true);
      }
      if (spec.abandon.pos !== null) {
        expect(POSITIONS.has(spec.abandon.pos), `${spec.id} abandon`).toBe(true);
      }
    }
    // The alias map is the whole §03 reconciliation surface: it may only name
    // ids this chapter actually uses, or reconciliation silently misses one.
    for (const from of Object.keys(POSITION_ALIASES)) expect(POSITIONS.has(from)).toBe(true);
    expect(resolvePositionId('pos.leg_50_50')).toBe('pos.ground_5050');
    expect(resolvePositionId('pos.ground_back_hooks')).toBe('pos.ground_back_hooks');
  });

  it('declares 52 position ids', () => {
    expect(SUB_POSITION_IDS).toHaveLength(52);
    expect(new Set(SUB_POSITION_IDS).size).toBe(52);
  });

  it('gives every contested stage a probability in (0, 1) and a positive duration', () => {
    for (const spec of SUBMISSION_CATALOGUE) {
      expect(spec.stages).toHaveLength(4);
      expect(spec.stages[0].stage).toBe('setup');
      expect(spec.stages[0].baseP).toBeNull(); // S0 is availability, not a roll

      for (const stage of spec.stages.slice(1)) {
        if (stage.baseP === null) {
          // Only the von Flue skips a stage: it is entered at S2 (§2.17).
          expect(spec.id).toBe('sub.von_flue');
          continue;
        }
        expect(stage.baseP, `${spec.id} ${stage.stage}`).toBeGreaterThan(0);
        expect(stage.baseP, `${spec.id} ${stage.stage}`).toBeLessThan(1);
        expect(stage.dMeanMs, `${spec.id} ${stage.stage}`).toBeGreaterThan(0);
        const range = stage.durationMsRange!;
        expect(range[0]).toBeGreaterThan(0);
        expect(range[1]).toBeGreaterThanOrEqual(range[0]);
        expect(stage.dMeanMs!).toBeGreaterThanOrEqual(range[0]);
        expect(stage.dMeanMs!).toBeLessThanOrEqual(range[1]);
      }
    }
  });

  it('lists only real defence options, stage by stage', () => {
    const known = new Set<string>(DEFENCE_OPTIONS.map((o) => o.id));
    for (const spec of SUBMISSION_CATALOGUE) {
      for (const stage of spec.stages) {
        for (const d of stage.defences) {
          expect(known.has(d), `${spec.id} ${stage.stage} ${d}`).toBe(true);
        }
      }
    }
  });

  it('gives every entry a finish clock consistent with its family', () => {
    for (const spec of SUBMISSION_CATALOGUE) {
      const c = spec.finishClock;
      expect(c.tapMaxMs).toBeGreaterThan(c.tapMinMs);
      expect(c.escapeHazardPerS).toBeGreaterThan(0);
      expect(c.escapeHazardPerS).toBeLessThan(1);
      if (spec.family === 'choke') {
        expect(spec.chokeType, spec.id).toBeDefined();
        expect(c.locMeanS, spec.id).toBeGreaterThan(0);
        if (spec.chokeType === 'mixed') expect(c.pBlood, spec.id).toBeGreaterThan(0);
      } else if (c.injuryDelayMaxMs !== undefined) {
        expect(c.severity, spec.id).toBeDefined();
        expect(c.injuryJoint, spec.id).toBeDefined();
        expect(c.injuryDelayMaxMs).toBeGreaterThanOrEqual(c.injuryDelayMinMs!);
      } else {
        // A crank has no discrete failure: it accumulates strain instead.
        expect(c.neckStrainPer5s, spec.id).toBeGreaterThan(0);
      }
    }
  });

  it('normalises escape shares and keeps the finish-share targets summing to ~100 %', () => {
    for (const spec of SUBMISSION_CATALOGUE) {
      const total = spec.escapes.reduce((a, e) => a + e.share, 0);
      expect(total, `${spec.id} escape shares`).toBeCloseTo(1, 2);
    }
    const shares = SUBMISSION_CATALOGUE.reduce((a, s) => a + s.finishShareTarget, 0);
    // §3.8: the residual ~0.9 % is "other / gi / Schultz", not modelled.
    expect(shares).toBeGreaterThan(0.97);
    expect(shares).toBeLessThanOrEqual(1.0);
  });

  it('resolves the family-level ids §03 uses', () => {
    expect(resolveSubmissionId('sub.armbar')).toBe('sub.armbar_guard');
    expect(resolveSubmissionId('sub.armbar', 'pos.ground_mount_s')).toBe('sub.armbar_mount');
    expect(resolveSubmissionId('sub.rnc')).toBe('sub.rnc');
    expect(hasSubmission('sub.von_flue')).toBe(true);
    expect(() => resolveSubmissionId('sub.not_a_thing')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. chain graph
// ---------------------------------------------------------------------------

describe('chain graph', () => {
  it('has 100+ edges with unique ids', () => {
    expect(CHAIN_EDGES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(CHAIN_EDGES.map((e) => e.id)).size).toBe(CHAIN_EDGES.length);
  });

  it('references only real submission and position ids at both ends', () => {
    for (const e of CHAIN_EDGES) {
      for (const from of e.from) {
        if (e.fromKind === 'sub') expect(SUB_IDS.has(from), `${e.id} from ${from}`).toBe(true);
        else expect(POSITIONS.has(from), `${e.id} from ${from}`).toBe(true);
      }
      if (e.toKind === 'sub') expect(SUB_IDS.has(e.to), `${e.id} to ${e.to}`).toBe(true);
      else if (e.toKind === 'pos') expect(POSITIONS.has(e.to), `${e.id} to ${e.to}`).toBe(true);
      else expect(e.to.startsWith('evt.'), `${e.id} to ${e.to}`).toBe(true);

      expect(e.p, e.id).toBeGreaterThan(0);
      expect(e.p, e.id).toBeLessThanOrEqual(1);
      expect(e.tag).toMatch(/^\[(S:|D:|E)/);
    }
  });

  it('matches the edge ids the catalogue entries name', () => {
    const known = new Set(CHAIN_EDGES.map((e) => e.id));
    for (const spec of SUBMISSION_CATALOGUE) {
      for (const id of [...spec.chains.out, ...spec.chains.in]) {
        expect(known.has(id), `${spec.id} names ${id}`).toBe(true);
      }
    }
  });

  it('samples an edge from one draw and never chains below T2', () => {
    // T0 and T1 do not chain at all (§4 tier multiplier 0).
    expect(sampleChainEdge('sub.triangle_guard', 'entry', 1, 0.01)).toBeNull();
    expect(sampleChainEdge('sub.triangle_guard', 'entry', 0, 0.5)).toBeNull();

    const edges = outgoingEdges('sub.triangle_guard', 'entry');
    expect(edges.length).toBeGreaterThan(0);
    // The first non-defender edge owns the bottom of the unit interval.
    const first = edges.find((e) => !e.defenderEdge)!;
    expect(sampleChainEdge('sub.triangle_guard', 'entry', 4, 0)?.id).toBe(first.id);
    // Past the total there is no chain: the failure follows the catalogue.
    const total = totalChainP('sub.triangle_guard', 'entry', 4);
    expect(total).toBeLessThan(1);
    expect(sampleChainEdge('sub.triangle_guard', 'entry', 4, total + 1e-9)).toBeNull();
  });

  it('caps hops inside the chain window', () => {
    const start = { hops: CHAIN_PARAMS.hopCap, windowStartMs: 1000 };
    expect(chainAllowed(start, 2000, 4)).toBe(false);
    expect(chainAllowed(start, 1000 + CHAIN_PARAMS.hopWindowMs, 4)).toBe(true);
    expect(chainAllowed({ hops: 0, windowStartMs: 1000 }, 1100, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. defender options and modifiers
// ---------------------------------------------------------------------------

describe('defender options', () => {
  it('has the 34 options of §2.5 and the 24 modifiers of §2.3', () => {
    expect(DEFENCE_OPTIONS).toHaveLength(34);
    expect(new Set(DEFENCE_OPTIONS.map((o) => o.id)).size).toBe(34);
    expect(MODIFIER_IDS).toHaveLength(24);
    expect(MODIFIERS).toHaveLength(24);
    expect(new Set(MODIFIERS.map((m) => m.id))).toEqual(new Set(MODIFIER_IDS));
  });

  it('marks a right defence at the wrong stage as wrong', () => {
    // The hitchhiker is an S2 escape; at S1 the elbow has not been isolated yet.
    expect(isWrongOption('def.hitchhiker', 'entry')).toBe(true);
    expect(isWrongOption('def.hitchhiker', 'secure')).toBe(false);
    // The grip clasp does nothing at S1: the elbow can still be pulled out.
    expect(isWrongOption('def.grip_clasp', 'entry')).toBe(true);
    // The standard resistance is never wrong - it is the zero point.
    expect(isWrongOption(STANDARD_DEFENCE, 'finish')).toBe(false);
    expect(isWrongOption('def.none', 'secure')).toBe(true);
  });

  it('restricts a rocked defender to the late options', () => {
    const weak = rockedOptions(50);
    expect(weak).not.toContain('def.slam');
    expect(rockedOptions(75)).toContain('def.slam');
    for (const id of weak) expect(defenceOption(id as DefenceOptionId).availableWhenRocked).toBe(true);
  });

  it('raises the attacker probability when the defender does nothing', () => {
    const ctx = context('sub.rnc', 'secure', STANDARD_DEFENCE);
    const none = { ...ctx, option: 'def.none' as const };
    expect(windowProbabilities(none).pA).toBeGreaterThan(windowProbabilities(ctx).pA);
    expect(windowProbabilities(none).pE).toBeLessThan(windowProbabilities(ctx).pE);
  });

  it('lets a tired defender be taken more easily, and a rocked one much more', () => {
    const base = context('sub.rnc', 'entry', STANDARD_DEFENCE);
    const tired = { ...base, defender: baselineFighter({ fatigue: 0.9 }) };
    const rocked = { ...base, defender: baselineFighter({ rocked: true }) };
    expect(windowProbabilities(tired).pA).toBeGreaterThan(windowProbabilities(base).pA);
    expect(windowProbabilities(rocked).pA).toBeGreaterThan(windowProbabilities(tired).pA);
  });

  it('rises with skill and with SLIP over the course of a fight', () => {
    const base = context('sub.rnc', 'secure', STANDARD_DEFENCE);
    const better = { ...base, attacker: baselineFighter({ chokes: 95 }) };
    expect(windowProbabilities(better).pA).toBeGreaterThan(windowProbabilities(base).pA);

    const fresh = slip(baselineEnvironment({ fightTimeS: 0 }));
    const late = slip(baselineEnvironment({ fightTimeS: 600 }));
    expect(fresh).toBeCloseTo(0.2, 6);
    expect(late).toBeCloseTo(0.8, 6);
    expect(slip(baselineEnvironment({ fightTimeS: 600, bloodFlag: true, heavyClass: true })))
      .toBeCloseTo(1.0, 6);

    // A late, sweaty guillotine is harder to hold than a fresh one.
    const g = context('sub.guillotine_standard', 'finish', STANDARD_DEFENCE);
    const sweaty = { ...g, env: baselineEnvironment({ fightTimeS: 600 }) };
    expect(windowProbabilities(sweaty).pA).toBeLessThan(windowProbabilities(g).pA);
  });
});

// ---------------------------------------------------------------------------
// 4. the per-window derivation and the RNG budget
// ---------------------------------------------------------------------------

describe('stage resolution', () => {
  it('derives per-window hazards that reproduce P_stage and dMean', () => {
    const { pA0, pE0 } = perWindowBases(0.45, 2000, 500);
    expect(pA0).toBeCloseTo(0.1125, 6);
    expect(pE0).toBeCloseTo(0.1375, 6);
    expect(pA0 / (pA0 + pE0)).toBeCloseTo(0.45, 6);
    expect(500 / (pA0 + pE0)).toBeCloseTo(2000, 6);
  });

  it('rescales a short stage without moving P_stage', () => {
    const { pA0, pE0, scale } = perWindowBases(0.85, 1000, 1000);
    expect(scale).toBeLessThan(1);
    expect(pA0 + pE0).toBeCloseTo(0.9, 6);
    expect(pA0 / (pA0 + pE0)).toBeCloseTo(0.85, 6);
  });

  it('reproduces P_stage and dMean in simulation when no modifier applies', () => {
    // A synthetic entry with no modifier list is the clean test of the maths:
    // every real entry carries at least SLIP, which is never zero in a fight.
    const spec = { id: 'sub.test', family: 'choke' as const, modifiers: [], role: 'top' as const };
    const ctx: WindowContext = {
      spec, stage: 'secure', attacker: baselineFighter(), defender: baselineFighter(),
      env: baselineEnvironment({ glovesMma: false }), stageP: 0.5, dMeanMs: 4000,
      option: STANDARD_DEFENCE, chained: false,
    };
    const rng = new RNG('stage-derivation');
    let advanced = 0;
    let totalMs = 0;
    const N = 20000;
    for (let n = 0; n < N; n++) {
      for (let w = 1; w <= 500; w++) {
        const r = resolveWindow(rng, ctx);
        if (r.outcome === 'hold') continue;
        totalMs += w * 1000;
        if (r.outcome === 'advance') advanced++;
        break;
      }
    }
    // The defender rolls first (§2.4.2), so the attacker wins
    // pA(1-pE)/(pA(1-pE)+pE) = 0.4665 of the decided windows rather than the
    // idealised 0.5 - a documented 1.7 pp cost of resolving in a fixed order.
    expect(advanced / N).toBeGreaterThan(0.45);
    expect(advanced / N).toBeLessThan(0.49);
    // The mean stage time is quantised to whole windows, so it lands a little
    // above dMean; the geometric mean of a 1 s window on p 0.25 is 4 s.
    expect(totalMs / N).toBeGreaterThan(3600);
    expect(totalMs / N).toBeLessThan(4400);
  });

  it('consumes exactly four draws per window, whatever the outcome', () => {
    const ctx = context('sub.rnc', 'secure', STANDARD_DEFENCE);
    const rng = new RNG('draw-budget');
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const before = rng.draws;
      const r = resolveWindow(rng, ctx);
      expect(rng.draws - before).toBe(4);
      seen.add(r.outcome);
    }
    // All three branches were exercised, so the budget is not an artefact of
    // only ever taking the "hold" path.
    expect(seen.has('hold')).toBe(true);
    expect(seen.has('advance')).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic for a fixed seed and different for another', () => {
    const ctx = context('sub.triangle_guard', 'secure', 'def.stack');
    const run = (seed: string): string => {
      const rng = new RNG(seed);
      return Array.from({ length: 200 }, () => resolveWindow(rng, ctx).outcome).join(',');
    };
    expect(run('seed-a')).toBe(run('seed-a'));
    expect(run('seed-a')).not.toBe(run('seed-b'));
  });

  it('never abandons below T2 and abandons less as a sub-hunter', () => {
    const spec = submission('sub.triangle_guard');
    expect(pAbandon(spec, baselineFighter({ tier: 1 }))).toBe(0);
    const t4 = pAbandon(spec, baselineFighter({ tier: 4 }));
    const hunter = pAbandon(spec, baselineFighter({ tier: 4, subHunter: true }));
    expect(hunter).toBeCloseTo(t4 * 0.5, 6);
    // A tired attacker is less patient, so more likely to let go.
    expect(pAbandon(spec, baselineFighter({ fatigue: 1 }))).toBeGreaterThan(t4);
  });

  it('scales the attempt decision by style, state and ruleset', () => {
    const spec = submission('sub.triangle_guard');
    const attacker = baselineFighter();
    const base = pAttempt({
      spec, attacker, defenderRocked: false, ruleset: 'mma',
      womensDivision: false, trailingLateRound: false,
    });
    const rocked = pAttempt({
      spec, attacker, defenderRocked: true, ruleset: 'mma',
      womensDivision: false, trailingLateRound: false,
    });
    const trailing = pAttempt({
      spec, attacker, defenderRocked: false, ruleset: 'mma',
      womensDivision: false, trailingLateRound: true,
    });
    expect(rocked).toBeCloseTo(base * 1.5, 6);
    expect(trailing).toBeCloseTo(base * 0.51, 6);
  });
});

// ---------------------------------------------------------------------------
// 5. the locked clock
// ---------------------------------------------------------------------------

describe('finish mechanics', () => {
  it('reproduces the tier ladder of §6.3', () => {
    expect(pGoOut({ ...T4, tier: 0 })).toBeCloseTo(0.40, 6);
    expect(pGoOut({ ...T4, tier: 1 })).toBeCloseTo(0.19, 6);
    expect(pGoOut(T4)).toBeCloseTo(0.11, 6);
    expect(pGoOut({ ...T4, tier: 5 })).toBeCloseTo(0.05, 6);
    // A heart-90 champion is 1.4x more likely to go out than a heart-50 one.
    expect(pGoOut({ ...T4, tier: 5, heart: 90 })).toBeCloseTo(0.05 * 1.4, 6);
    // Joint locks: pain is a louder argument, except at T0.
    expect(pRefuse(T4)).toBeCloseTo(0.055, 6);
    expect(pRefuse({ ...T4, tier: 0 })).toBeCloseTo(0.40, 6);
    // Career submission losses and the refusesToTap trait.
    expect(stubbornness({ ...T4, subLosses: 2 })).toBeCloseTo(0.11 * 0.8, 6);
    expect(stubbornness({ ...T4, refusesToTap: true })).toBeCloseTo(0.5, 6);
    expect(pGoOut({ ...T4, titleFight: true })).toBeCloseTo(0.11 * 1.2, 6);
  });

  it('gives the heel hook its no-warning property and nothing else', () => {
    expect(pInjuryBeforeTap(submission('sub.heel_hook_inside'), 4)).toBeCloseTo(0.05 * 1.2, 6);
    expect(pInjuryBeforeTap(submission('sub.heel_hook_outside'), 4)).toBeCloseTo(0.05, 6);
    expect(pInjuryBeforeTap(submission('sub.heel_hook_inside'), 0)).toBeCloseTo(0.30 * 1.2, 6);
    expect(pInjuryBeforeTap(submission('sub.armbar_guard'), 0)).toBe(0);
    expect(pInjuryBeforeTap(submission('sub.rnc'), 0)).toBe(0);
  });

  it('reproduces the documented 89 % tap / 11 % unconscious split on blood chokes', () => {
    const attacker = baselineFighter();
    const defender = baselineFighter();
    let tap = 0;
    let loc = 0;
    const rng = new RNG('loc-split');
    for (const id of ['sub.rnc', 'sub.arm_triangle_mount', 'sub.triangle_guard']) {
      const spec = submission(id);
      for (let n = 0; n < 30000; n++) {
        const r = resolveLockedClock(rng, { spec, attacker, defender, tap: T4 });
        if (r.outcome === 'tap') tap++;
        else if (r.outcome === 'loc') loc++;
      }
    }
    const locShare = loc / (tap + loc);
    // C9: 11 % of chokes end in unconsciousness, +-4 pp. It lands slightly
    // under 11 % because a stubborn defender is exposed to the escape hazard
    // for the whole ~9 s rather than the ~4 s a tapper is.
    expect(locShare).toBeGreaterThan(0.07);
    expect(locShare).toBeLessThan(0.15);
    expect(locShare).toBeCloseTo(0.11, 1);
  });

  it('reproduces the time-to-finish distribution of §2.6.1', () => {
    const spec = submission('sub.rnc');
    const attacker = baselineFighter();
    const defender = baselineFighter();
    const rng = new RNG('loc-times');
    let tapSum = 0;
    let tapN = 0;
    let locSum = 0;
    let locN = 0;
    for (let n = 0; n < 40000; n++) {
      const r = resolveLockedClock(rng, { spec, attacker, defender, tap: T4 });
      if (r.outcome === 'tap') { tapSum += r.timeMs; tapN++; }
      if (r.outcome === 'loc') { locSum += r.timeMs; locN++; }
      // Every drawn unconsciousness time sits inside the clamped [6, 13] s band.
      expect(r.tLocS).toBeGreaterThanOrEqual(6);
      expect(r.tLocS).toBeLessThanOrEqual(13);
      // Nobody taps after they are already out.
      expect(r.tTapMs / 1000).toBeLessThanOrEqual(r.tLocS - 0.5 + 1e-9);
    }
    // Tap range 2-6 s, so the mean sits at 4 s.
    expect(tapSum / tapN / 1000).toBeGreaterThan(3.5);
    expect(tapSum / tapN / 1000).toBeLessThan(4.5);
    // The RNC mean time to unconsciousness is 8.9 s [S: P4].
    expect(locSum / locN / 1000).toBeGreaterThan(8.4);
    expect(locSum / locN / 1000).toBeLessThan(9.4);
  });

  it('keeps the joint-lock ladder at half the choke refusal rate', () => {
    const spec = submission('sub.armbar_guard');
    const rng = new RNG('armbar-clock');
    let tap = 0;
    let injury = 0;
    for (let n = 0; n < 40000; n++) {
      const r = resolveLockedClock(rng, {
        spec, attacker: baselineFighter(), defender: baselineFighter(), tap: T4,
      });
      if (r.outcome === 'tap') tap++;
      if (r.outcome === 'injury') injury++;
    }
    const share = injury / (tap + injury);
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.08);
  });

  it('consumes a constant number of draws at the lock', () => {
    const spec = submission('sub.rnc');
    const rng = new RNG('lock-draws');
    // One second of the clock always costs three more draws on top of the
    // seven the lock itself takes.
    const before = rng.draws;
    resolveLockedClock(rng, {
      spec, attacker: baselineFighter(), defender: baselineFighter(), tap: T4, msToBell: 1,
    });
    expect(rng.draws - before).toBe(LOCK_DRAW_COUNT + 3);
  });

  it('saves a defender on the bell', () => {
    const spec = submission('sub.triangle_guard');
    const rng = new RNG('bell');
    const r = resolveLockedClock(rng, {
      spec, attacker: baselineFighter(), defender: baselineFighter(), tap: T4, msToBell: 1,
    });
    expect(r.outcome).toBe('bellSave');
  });

  it('makes the locked escape hazard follow the skill gap', () => {
    const spec = submission('sub.rnc');
    const att = baselineFighter();
    const weakDef = baselineFighter({ escapes: 40 });
    const strongDef = baselineFighter({ escapes: 95 });
    expect(lockedEscapeHazard(spec, att, strongDef, true))
      .toBeGreaterThan(lockedEscapeHazard(spec, att, weakDef, true));
  });

  it('hands §05 an injury state with the right capability loss', () => {
    const armbar = jointFailure(submission('sub.armbar_guard'))!;
    expect(armbar.joint).toBe('elbow');
    expect(armbar.severity).toBe('high');
    expect(armbar.capability.strikePowerMult).toBeCloseTo(0.4, 6);
    expect(armbar.capability.gripLogit).toBeCloseTo(-1.0, 6);
    expect(armbar.doctorStopP).toBeCloseTo(0.8, 6);
    expect(armbar.layoffMonths).toBe(10);

    const heel = jointFailure(submission('sub.heel_hook_inside'))!;
    expect(heel.joint).toBe('knee');
    expect(heel.capability.kicksMult).toBe(0);

    // A crank has no discrete failure to hand over.
    expect(jointFailure(submission('sub.neck_crank_rear'))).toBeNull();
    expect(capabilityLoss('ankle', 'medium').mobilityMult).toBeCloseTo(0.75, 6);
  });

  it('builds a slam impact §05 can consume, in four draws', () => {
    const spec = submission('sub.triangle_guard');
    const defender = baselineFighter({ strength: 90, massKg: 95 });
    const attacker = baselineFighter({ strength: 50, massKg: 77 });
    const rng = new RNG('slam');
    const before = rng.draws;
    let impact: ReturnType<typeof resolveSlam>['impact'] = null;
    for (let i = 0; i < 200 && impact === null; i++) {
      impact = resolveSlam(rng, {
        spec, attacker, defender, attackerId: 0, defenderId: 1, tick: 10, subTickMs: 20,
      }).impact;
    }
    expect((rng.draws - before) % 4).toBe(0);
    expect(impact).not.toBeNull();
    expect(impact!.tech).toBe('slam');
    expect(impact!.weapon).toBe('mat');
    expect(impact!.region).toBe('head');
    expect(impact!.subLocation).toBe('topback');
    expect(impact!.targetState.grounded).toBe(true);
    expect(impact!.seen).toBe(false);
    // Force is a multiple of the DAMAGE §3.1 hook reference, 4400 N.
    expect(impact!.forceN).toBeGreaterThanOrEqual(0.8 * 4400);
    expect(impact!.forceN).toBeLessThanOrEqual(2.0 * 4400);
    // A harder floor hits harder.
    const hard = resolveSlam(new RNG('slam'), {
      spec, attacker, defender, attackerId: 0, defenderId: 1, tick: 10, subTickMs: 20,
      arena: { surfaceHardness: 2 },
    });
    if (hard.impact) expect(hard.impact.forceN).toBeGreaterThan(0.8 * 4400);
  });

  it('makes the von Flue a tier punishment', () => {
    expect(vonFlueReleaseP(4)).toBeCloseTo(0.8, 6);
    expect(vonFlueReleaseP(2)).toBeCloseTo(0.4, 6);
    expect(vonFlueReleaseP(1)).toBeCloseTo(0.1, 6);
  });
});

// ---------------------------------------------------------------------------
// 6. calibration
// ---------------------------------------------------------------------------

describe('calibration', () => {
  /** Run S2 then S3 with the standard resistance; true = the lock closes. */
  function convert(rng: RNG, spec: SubmissionSpec): boolean {
    for (const i of [2, 3] as const) {
      const stage = spec.stages[i];
      if (stage.baseP === null || stage.dMeanMs === null) continue;
      const ctx: WindowContext = {
        spec, stage: i === 2 ? 'secure' : 'finish',
        attacker: baselineFighter(), defender: baselineFighter(),
        env: baselineEnvironment({ glovesMma: false }),
        stageP: stage.baseP, dMeanMs: stage.dMeanMs, option: STANDARD_DEFENCE, chained: false,
      };
      let done = false;
      for (let w = 0; w < 500 && !done; w++) {
        const r = resolveWindow(rng, ctx);
        if (r.outcome === 'advance') done = true;
        else if (r.outcome !== 'hold') return false;
      }
      if (!done) return false;
    }
    return true;
  }

  it('reproduces the finishing-submission mix of C6 when attempts follow C7', () => {
    // C7 derives the attempt mix from the finish mix by dividing by the
    // catalogue's conversion, so sampling attempts that way and simulating the
    // battle has to give the finish mix back. What it actually tests is that
    // the per-window derivation preserves each entry's Conv.
    const pool = SUBMISSION_CATALOGUE
      .filter((s) => s.finishShareTarget > 0)
      .map((s) => ({ spec: s, weight: s.finishShareTarget / conversion(s) }));
    const totalWeight = pool.reduce((a, p) => a + p.weight, 0);

    const family = (id: string): string =>
      id.startsWith('sub.rnc') ? 'rnc'
        : id.startsWith('sub.guillotine') ? 'guillotine'
        : id.startsWith('sub.armbar') ? 'armbar'
        : id.startsWith('sub.arm_triangle') ? 'armTriangle'
        : id.startsWith('sub.triangle') ? 'triangle'
        : 'other';

    const rng = new RNG('finish-mix');
    const counts = new Map<string, number>();
    let finishes = 0;
    const N = 120000;
    for (let n = 0; n < N; n++) {
      let u = rng.next() * totalWeight;
      let k = 0;
      while (k < pool.length - 1 && u >= pool[k].weight) { u -= pool[k].weight; k++; }
      const spec = pool[k].spec;
      if (!convert(rng, spec)) continue;
      finishes++;
      const f = family(spec.id);
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }

    const share = (f: string): number => ((counts.get(f) ?? 0) / finishes) * 100;

    // C5: ~25 % of logged attempts are finished.
    expect(finishes / N).toBeGreaterThan(0.20);
    expect(finishes / N).toBeLessThan(0.30);

    // C6: RNC 39, guillotine 18, armbar 12, arm-triangle 7.5, triangle 6.
    // The tolerances are widened by ~1 pp over C6's because the simulation
    // carries the round-1 SLIP penalty (0.2), which costs the grip-heavy
    // guillotine family more than the limb-on-limb RNC - exactly the drift the
    // C6 selection weights exist to absorb.
    expect(share('rnc')).toBeGreaterThan(35);
    expect(share('rnc')).toBeLessThan(43);
    expect(share('guillotine')).toBeGreaterThan(14);
    expect(share('guillotine')).toBeLessThan(22);
    expect(share('armbar')).toBeGreaterThan(9);
    expect(share('armbar')).toBeLessThan(15);
    expect(share('armTriangle')).toBeGreaterThan(5.5);
    expect(share('armTriangle')).toBeLessThan(10);
    expect(share('triangle')).toBeGreaterThan(4);
    expect(share('triangle')).toBeLessThan(8.5);
  });

  it('keeps the documented family targets in the catalogue itself', () => {
    const sum = (prefix: string): number => SUBMISSION_CATALOGUE
      .filter((s) => s.id.startsWith(prefix))
      .reduce((a, s) => a + s.finishShareTarget, 0) * 100;
    expect(sum('sub.rnc')).toBeCloseTo(38.9, 1);     // SUB_FINISH §1a 659/1695
    expect(sum('sub.guillotine')).toBeCloseTo(17.6, 1); // 299/1695
    expect(sum('sub.armbar')).toBeCloseTo(11.9, 1);  // 202/1695
    expect(sum('sub.arm_triangle')).toBeCloseTo(7.7, 1);
    // The triangle and kimura families are the two whose [E] intra-family
    // splits round up past the measured family total (5.5 % and 2.7 %); §8 C6
    // tolerates +-2 pp there, so the over-allocation is inside the band.
    expect(sum('sub.triangle_')).toBeGreaterThan(5.0);
    expect(sum('sub.triangle_')).toBeLessThan(6.0);
    expect(sum('sub.kimura')).toBeGreaterThan(2.4);
    expect(sum('sub.kimura')).toBeLessThan(3.2);
    expect(sum('sub.heel_hook')).toBeCloseTo(1.4, 1);
  });

  it('keeps every catalogue conversion inside the C5 band it belongs to', () => {
    // C5 per-family: RNC ~40 %+, guillotine 10-15 %, armbar ~30 %,
    // triangle ~25 %, arm-triangle ~40 %, D'Arce/anaconda ~35 %.
    expect(conversion(submission('sub.rnc'))).toBeCloseTo(0.425, 3);
    expect(conversion(submission('sub.guillotine_standard'))).toBeCloseTo(0.14, 3);
    expect(conversion(submission('sub.armbar_guard'))).toBeCloseTo(0.2975, 3);
    expect(conversion(submission('sub.triangle_guard'))).toBeCloseTo(0.2475, 3);
    expect(conversion(submission('sub.arm_triangle_mount'))).toBeCloseTo(0.4125, 3);
    expect(conversion(submission('sub.darce'))).toBeCloseTo(0.35, 3);
  });
});

// ---------------------------------------------------------------------------
// 7. legality
// ---------------------------------------------------------------------------

describe('legality', () => {
  it('has a verdict for every technique under all ten rulesets', () => {
    expect(SUB_RULESET_IDS).toHaveLength(10);
    for (const spec of SUBMISSION_CATALOGUE) {
      for (const ruleset of SUB_RULESET_IDS) {
        const verdict = submissionLegality(ruleset, spec.id);
        expect(['legal', 'restricted', 'illegal']).toContain(verdict);
      }
      // Everything in the catalogue is legal in pro MMA and on the street.
      expect(submissionLegality('mma.pro', spec.id)).toBe('legal');
      expect(submissionLegality('street', spec.id)).toBe('legal');
    }
  });

  it('matches the §5 rows that matter', () => {
    // The rear-naked choke is legal everywhere.
    for (const r of SUB_RULESET_IDS) expect(submissionLegality(r, 'sub.rnc')).toBe('legal');

    // Heel hooks: no-gi brown/black and ADCC only among the grappling sets.
    expect(submissionLegality('ibjjf.white', 'sub.heel_hook_inside')).toBe('illegal');
    expect(submissionLegality('ibjjf.brownBlackGi', 'sub.heel_hook_inside')).toBe('illegal');
    expect(submissionLegality('ibjjf.brownBlackNoGi', 'sub.heel_hook_inside')).toBe('legal');
    expect(submissionLegality('adcc', 'sub.heel_hook_outside')).toBe('legal');
    expect(submissionLegality('judo', 'sub.heel_hook_inside')).toBe('illegal');
    expect(submissionLegality('mma.amateur', 'sub.heel_hook_inside')).toBe('illegal');

    // The twister is a spinal lock: ADCC yes, IBJJF and judo no.
    expect(submissionLegality('adcc', 'sub.twister')).toBe('legal');
    expect(submissionLegality('ibjjf.brownBlackNoGi', 'sub.twister')).toBe('illegal');
    expect(submissionLegality('judo', 'sub.twister')).toBe('illegal');

    // Neck cranks are banned in amateur MMA and everywhere in IBJJF.
    expect(submissionLegality('mma.amateur', 'sub.neck_crank_rear')).toBe('illegal');
    expect(submissionLegality('ibjjf.brownBlackNoGi', 'sub.neck_crank_generic')).toBe('illegal');
    // ADCC names the can opener as the one permitted crank.
    expect(submissionLegality('adcc', 'sub.can_opener')).toBe('legal');

    // The crucifix position is illegal in ADCC whatever is done from it.
    expect(submissionLegality('adcc', 'sub.crucifix_armlock')).toBe('illegal');
    expect(submissionLegality('adcc', 'sub.crucifix_choke')).toBe('illegal');

    // Standing shime-waza is hansoku-make.
    expect(submissionLegality('judo', 'sub.guillotine_standing')).toBe('illegal');
    expect(submissionLegality('judo', 'sub.guillotine_standard')).toBe('legal');
    expect(submissionLegality('judo', 'sub.triangle_flying')).toBe('restricted');

    // The neckties are chokes carrying a crank.
    expect(submissionLegality('mma.pro', 'sub.peruvian_necktie')).toBe('legal');
    expect(submissionLegality('ibjjf.bluePurple', 'sub.peruvian_necktie')).toBe('restricted');
    expect(submissionLegality('judo', 'sub.japanese_necktie')).toBe('illegal');

    // Toe holds and calf slicers: IBJJF brown and above only.
    expect(submissionLegality('ibjjf.bluePurple', 'sub.toe_hold')).toBe('illegal');
    expect(submissionLegality('ibjjf.brownBlackGi', 'sub.toe_hold')).toBe('legal');
    expect(submissionLegality('mma.amateur', 'sub.calf_slicer')).toBe('illegal');
    // The straight ankle lock is legal from adult white belt up.
    expect(submissionLegality('ibjjf.white', 'sub.ankle_lock_straight')).toBe('legal');
  });

  it('is a predicate over SubmissionClass', () => {
    expect(classLegality('ibjjf.white', 'heel_hook')).toBe('illegal');
    expect(classLegality('ibjjf.brownBlackNoGi', 'heel_hook')).toBe('legal');
    expect(classLegality('adcc', 'neck_crank')).toBe('restricted');
    expect(classLegality('judo', 'shoulder_lock')).toBe('restricted');
    // A class no ruleset mentions is illegal by default, not legal.
    expect(classLegality('judo', 'fish_hook')).toBe('illegal');
    expect(classLegality('street', 'fish_hook')).toBe('legal');
  });

  it('removes illegal techniques from the selection set', () => {
    expect(isSelectable('ibjjf.white', 'sub.heel_hook_inside')).toBe(false);
    expect(isSelectable('mma.pro', 'sub.heel_hook_inside')).toBe(true);
    // A restricted technique is still selectable; the referee may call it.
    expect(isSelectable('ibjjf.bluePurple', 'sub.peruvian_necktie')).toBe(true);
  });

  it('carries the non-submission flags of §5', () => {
    expect(RULESET_FLAGS['mma.pro'].slamsLegal).toBe(true);
    expect(RULESET_FLAGS['mma.pro'].spikingLegal).toBe(false);
    expect(RULESET_FLAGS['ibjjf.white'].slamsLegal).toBe(false);
    expect(RULESET_FLAGS.adcc.slamsOnlyFromLockedSub).toBe(true);
    expect(RULESET_FLAGS.adcc.strikesLegal).toBe(false);
    // No referee on the street, so no technical submission.
    expect(RULESET_FLAGS.street.refereeStopsOnLoc).toBe(false);
    expect(RULESET_FLAGS.street.techSubEnabled).toBe(false);
    expect(RULESET_FLAGS['ibjjf.brownBlackNoGi'].kneeReapLegal).toBe(true);
    expect(RULESET_FLAGS['ibjjf.brownBlackGi'].kneeReapLegal).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. parameter registry
// ---------------------------------------------------------------------------

describe('parameters', () => {
  it('registers every §7 parameter with a valid tag, unit, section and bounds', () => {
    expect(SUBMISSION_PARAMS.length).toBeGreaterThan(100);
    const ids = new Set<string>();
    for (const p of SUBMISSION_PARAMS) {
      expect(ids.has(p.id), `duplicate ${p.id}`).toBe(false);
      ids.add(p.id);
      // 00_CONVENTIONS §1: an untagged number is a bug.
      expect(p.tag, p.id).toMatch(/^\[(S:|D:|E)/);
      expect(p.id, p.id).toMatch(/^sub\./);
      expect(p.section).toBe('submissions');
      expect(p.unit, p.id).toBeTruthy();
      expect(Number.isFinite(p.value), p.id).toBe(true);
      expect(p.note, p.id).toBeTruthy();
      if (p.min !== undefined) expect(p.value, p.id).toBeGreaterThanOrEqual(p.min);
      if (p.max !== undefined) expect(p.value, p.id).toBeLessThanOrEqual(p.max);
    }
  });

  it('is accepted by the registry and resolves to a stable hash', () => {
    const build = (): ParamRegistry => {
      const r = new ParamRegistry();
      r.addAll(SUBMISSION_PARAMS);
      r.freeze();
      return r;
    };
    const a = build();
    const b = build();
    expect(a.hash()).toBe(b.hash());
    expect(a.bySection('submissions')).toHaveLength(SUBMISSION_PARAMS.length);
    // Moving a free parameter changes the hash, so a replay can never be
    // silently replayed under different numbers.
    expect(a.hash({ 'sub.kSkill.secure': 3.5 })).not.toBe(a.hash());
  });

  it('keeps measured numbers out of the calibrator', () => {
    const fixed = SUBMISSION_PARAMS.filter((p) => !p.free).map((p) => p.id);
    // The UFC 11 % unconsciousness anchor and the measured LOC times are
    // research values: moving them would make the sim disagree with a paper.
    expect(fixed).toContain('sub.pGoOut.t4');
    expect(fixed).toContain('sub.loc.meanArmTriangleS');
    expect(fixed).toContain('sub.pClampMax');
    expect(fixed).toContain('sub.strike.landedRate');
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function context(
  id: string,
  stage: 'entry' | 'secure' | 'finish',
  option: WindowContext['option'],
): WindowContext {
  const spec = submission(id);
  const index = stage === 'entry' ? 1 : stage === 'secure' ? 2 : 3;
  const s = spec.stages[index];
  return {
    spec,
    stage,
    attacker: baselineFighter(),
    defender: baselineFighter(),
    env: baselineEnvironment(),
    stageP: s.baseP ?? 0.5,
    dMeanMs: s.dMeanMs ?? 3000,
    option,
    chained: false,
  };
}
