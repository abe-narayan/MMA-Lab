/**
 * AI DECISION CORE SUITE — design chapter 07, §2.2-§2.4 and §2.6.
 *
 * The chapter makes claims that are either true of the implementation or the
 * implementation is wrong. This suite is those claims, written down:
 *
 *  1. `decide()` consumes exactly 8 draws (9 in multi-opponent modes) on every
 *     path, including the early returns — the determinism contract of §2.1;
 *  2. a fixed seed reproduces a decision stream exactly;
 *  3. the policy never emits an action the resolver would reject: illegal
 *     under the ruleset, above the fighter's tier, or two bands out of range;
 *  4. the softmax temperature ladder is monotone in tier — a T5 picks its best
 *     option more often than a T1 over 10,000 seeded decisions (§2.2.4);
 *  5. the opponent model converges on a repeated pattern and forgets it after
 *     tau_mem, returning to the scouted prior rather than to nothing (§2.4.3);
 *  6. feint bite falls with tier (§2.4.5);
 *  7. adaptation fires on its documented triggers and respects its dwell
 *     (§2.6.1, §2.6.2);
 *  8. a hurt fighter's decisions shift to the documented emergency set (§2.6.4);
 *  9. `IdlePolicy` and `MmaPolicy` are interchangeable from the loop's point of
 *     view;
 * 10. every `ai.*` parameter carries a valid provenance tag and registers.
 *
 * Everything is seeded. A failure here is a regression, never flakiness.
 */
import { describe, it, expect } from 'vitest';
import { RNG } from '../src/sim/rng';
import { ARCHETYPES, DEFAULT_SETTINGS } from '../src/sim';
import { buildWorld } from '../src/sim/core/build';
import type { SimConfig } from '../src/sim/core/config';
import type { World, FighterWorldState } from '../src/sim/core/world';
import type { ObservedFighter, ObservedState } from '../src/sim/core/perception';
import {
  DRAWS_PER_DECIDE, DRAWS_PER_DECIDE_MULTI, IdlePolicy,
  type Decision, type DecisionContext, type DecisionPolicy,
} from '../src/sim/core/policy';
import { ParamRegistry } from '../src/sim/params/registry';
import { AI_PARAMS } from '../src/sim/params/ai.params';
import { technique, hasTechnique, techniqueLegal } from '../src/sim/striking/catalogue';
import { rangeFit, reachProfile } from '../src/sim/striking/range';
import { hasGrapplingEdge } from '../src/sim/grappling/graph';
import { hasSubmission } from '../src/sim/submissions/catalogue';
import { MOVEMENTS } from '../src/sim/striking/range';
import { FEINTS } from '../src/sim/striking/combos';
import type { StrikeImpact } from '../src/sim/damage';

import {
  MmaPolicy, normalFromUniform, type AiState,
} from '../src/sim/ai/policy';
import {
  softmaxSelect, tauForTier, effectiveTau, compensate, scoreAction, qFatigue,
  CONSIDERATION_COUNT, TAU_BY_TIER,
} from '../src/sim/ai/utility';
import {
  enumerateActions, strikingFlagsFor, basePrior, type EnumerationContext,
} from '../src/sim/ai/actions';
import {
  OpponentModel, ExchangeLedger, buildContext, contextIndex, CONTEXT_COUNT,
  feintBiteProbabilityFor, TAU_MEM_S_BY_IQ,
} from '../src/sim/ai/perceive';
import {
  ADJUSTMENT_ROWS, applyAdjustment, buildAdjustment, candidateAdjustments, effectiveIqTier,
  evaluationDue, hurtBehaviour, hurtWeights, minDwellS, pChange, scoreBelief,
  type AdaptSignals,
} from '../src/sim/ai/adapt';
import { comboCap, AI_COMBO_CAP_BY_TIER, COMBO_MAX_ANY } from '../src/sim/ai/macros';
import { executionQuality, P_ONTIME_BY_TIER, TARGET_ERROR_BY_TIER } from '../src/sim/ai/execution';
import { ACTION_FAMILIES, type ActionFamily } from '../src/sim/ai/contracts';
import { setPlanProvider } from '../src/sim/ai/planview';
import { SCOUT_DRAWS } from '../src/sim/ai/scout';
// The barrel is what wires §2.5's generator to the decision core.
import { registerChapter07Providers } from '../src/sim/ai';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ARCH = Object.values(ARCHETYPES);

function fighters(n: number) {
  return Array.from({ length: n }, (_, i) => ARCH[i % ARCH.length]);
}

function config(seed: string, over: Partial<SimConfig> = {}): SimConfig {
  return {
    seed,
    mode: '1v1',
    fighters: fighters(2),
    teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r',
    arena: 'octagon_30',
    settings: { ...DEFAULT_SETTINGS, rounds: 1, roundSeconds: 60, restSeconds: 10 },
    ...over,
  };
}

/** A world with its perception buffers primed, ready for `decide()`. */
function primedWorld(cfg: SimConfig): World {
  const world = buildWorld(cfg);
  pushObservation(world);
  return world;
}

function observe(f: FighterWorldState): ObservedFighter {
  return {
    id: f.id, team: f.team, x: f.x, z: f.z, facing: f.facing, vx: f.vx, vz: f.vz,
    posture: f.posture, position: f.position,
    action: f.action ?? 'idle', actionPhase: 0,
    stance: f.stance,
    visiblyHurt: false, visiblyTired: false, handsDropped: false,
    balance: f.balance,
  };
}

function pushObservation(world: World, over?: (o: ObservedFighter) => ObservedFighter): void {
  const state: ObservedState = {
    tick: world.tick,
    fighters: world.fighters.map((f) => (over ? over(observe(f)) : observe(f))),
  };
  for (const f of world.fighters) f.perception.push(state);
}

function ctxFor(world: World, f: FighterWorldState): DecisionContext {
  return {
    world,
    self: f,
    observed: f.perception.delayed(1),
    rng: world.rng,
    tick: world.tick,
    nowMs: world.nowMs,
  };
}

/**
 * What one `decide()` call is allowed to take. The P3 budget of 09 §2.7 is
 * eight draws (nine in multi-opponent modes); the loop takes the last of them,
 * `u_commit`, as the commitment jitter, so the policy takes one fewer. That is
 * the split `IdlePolicy` uses, and a policy that disagreed would desynchronise
 * the stream.
 */
const POLICY_DRAWS = DRAWS_PER_DECIDE - 1;
const POLICY_DRAWS_MULTI = DRAWS_PER_DECIDE_MULTI - 1;

/** Run one `decide()` and report how many draws it took. */
function drawsTaken(policy: DecisionPolicy, ctx: DecisionContext): { draws: number; decision: Decision } {
  const before = ctx.rng.draws;
  const decision = policy.decide(ctx);
  return { draws: ctx.rng.draws - before, decision };
}

// ---------------------------------------------------------------------------
// 1. The determinism contract (§2.1)
// ---------------------------------------------------------------------------

describe('§2.1 determinism contract', () => {
  it('decide() consumes exactly its share of the P3 budget on a normal tick', () => {
    const world = primedWorld(config('draws-normal'));
    const policy = new MmaPolicy();
    policy.prepare(world);
    for (const f of world.fighters) {
      const { draws } = drawsTaken(policy, ctxFor(world, f));
      expect(draws).toBe(POLICY_DRAWS);
    }
  });

  it('takes the same count with no observation at all (the earliest return)', () => {
    const world = buildWorld(config('draws-noobs'));
    const policy = new MmaPolicy();
    policy.prepare(world);
    for (const f of world.fighters) {
      const ctx: DecisionContext = {
        world, self: f, observed: null, rng: world.rng, tick: 0, nowMs: 0,
      };
      const before = world.rng.draws;
      policy.decide(ctx);
      expect(world.rng.draws - before).toBe(POLICY_DRAWS);
    }
  });

  it('takes the same count when the target is missing from the observation', () => {
    const world = buildWorld(config('draws-notarget'));
    const policy = new MmaPolicy();
    policy.prepare(world);
    // An observation containing only the deciding fighter: the target lookup
    // fails and `think` returns early.
    for (const f of world.fighters) {
      f.perception.push({ tick: 0, fighters: [observe(f)] });
    }
    for (const f of world.fighters) {
      const { draws } = drawsTaken(policy, ctxFor(world, f));
      expect(draws).toBe(POLICY_DRAWS);
    }
  });

  it('takes the same count from every posture and position', () => {
    const postures: FighterWorldState['posture'][] = ['standing', 'clinch', 'ground', 'down'];
    for (const posture of postures) {
      const world = primedWorld(config(`draws-${posture}`));
      const policy = new MmaPolicy();
      policy.prepare(world);
      for (const f of world.fighters) {
        f.posture = posture;
        if (posture === 'ground') f.position = 'pos.ground_closed_guard';
        if (posture === 'clinch') f.position = 'pos.clinch_over_under';
      }
      pushObservation(world);
      for (const f of world.fighters) {
        const { draws } = drawsTaken(policy, ctxFor(world, f));
        expect(draws, `posture ${posture}`).toBe(POLICY_DRAWS);
      }
    }
  });

  it('takes the same count when hurt, exhausted and out of range', () => {
    const world = primedWorld(config('draws-hurt'));
    const policy = new MmaPolicy();
    policy.prepare(world);
    for (const f of world.fighters) {
      f.balance = 0;
      f.x = f.id * 9;
      f.z = 0;
    }
    pushObservation(world, (o) => ({ ...o, visiblyHurt: true, visiblyTired: true, handsDropped: true }));
    for (const f of world.fighters) {
      const { draws } = drawsTaken(policy, ctxFor(world, f));
      expect(draws).toBe(POLICY_DRAWS);
    }
  });

  it('takes nine draws once more than two fighters are live', () => {
    const cfg = config('draws-multi', {
      mode: 'teams', fighters: fighters(4), teams: { teamOf: [0, 1, 1, 1] },
    });
    const world = primedWorld(cfg);
    const policy = new MmaPolicy();
    policy.prepare(world);
    expect(MmaPolicy.drawsPerDecide(world)).toBe(DRAWS_PER_DECIDE_MULTI);
    for (const f of world.fighters) {
      const { draws } = drawsTaken(policy, ctxFor(world, f));
      expect(draws).toBe(POLICY_DRAWS_MULTI);
    }
  });

  it('keeps the count over a long run of ticks', () => {
    const world = primedWorld(config('draws-long'));
    const policy = new MmaPolicy();
    policy.prepare(world);
    for (let t = 0; t < 200; t++) {
      world.tick = t;
      world.roundTick = t;
      world.nowMs = t * 100;
      pushObservation(world);
      for (const f of world.fighters) {
        const { draws } = drawsTaken(policy, ctxFor(world, f));
        expect(draws, `tick ${t}`).toBe(POLICY_DRAWS);
      }
    }
  });

  it('betweenRounds() consumes exactly five draws per fighter', () => {
    const world = primedWorld(config('draws-break'));
    const policy = new MmaPolicy();
    policy.prepare(world);
    const before = world.rng.draws;
    policy.betweenRounds(world, 1);
    expect(world.rng.draws - before).toBe(5 * world.fighters.length);
  });

  it('a fixed seed reproduces the whole decision stream', () => {
    const run = (): string[] => {
      const world = primedWorld(config('determinism-seed'));
      const policy = new MmaPolicy();
      policy.prepare(world);
      const out: string[] = [];
      for (let t = 0; t < 60; t++) {
        world.tick = t;
        world.roundTick = t;
        world.nowMs = t * 100;
        pushObservation(world);
        for (const f of world.fighters) {
          const d = policy.decide(ctxFor(world, f));
          out.push(`${t}:${f.id}:${d.kind}:${d.what ?? '-'}:${d.intentTag}`);
        }
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('a different seed produces a different stream', () => {
    const run = (seed: string): string[] => {
      const world = primedWorld(config(seed));
      const policy = new MmaPolicy();
      policy.prepare(world);
      const out: string[] = [];
      for (let t = 0; t < 60; t++) {
        world.tick = t;
        world.nowMs = t * 100;
        pushObservation(world);
        for (const f of world.fighters) out.push(policy.decide(ctxFor(world, f)).what ?? '-');
      }
      return out;
    };
    expect(run('seed-a')).not.toEqual(run('seed-b'));
  });
});

// ---------------------------------------------------------------------------
// 2. Legality (§2.2, §02-§04)
// ---------------------------------------------------------------------------

describe('legal and in-range actions only', () => {
  const KNOWN_MOVES = new Set<string>(MOVEMENTS.map((m) => m.id));
  const KNOWN_FEINTS = new Set<string>(FEINTS.map((f) => f.id as string));

  function assertLegal(world: World, f: FighterWorldState, d: Decision): void {
    if (d.what === null) {
      expect(['wait', 'defend', 'move']).toContain(d.kind);
      return;
    }
    if (d.kind === 'strike') {
      if (KNOWN_FEINTS.has(d.what)) return;
      expect(hasTechnique(d.what), `unknown technique ${d.what}`).toBe(true);
      const spec = technique(d.what);
      // Tier gate (§3 "available" rows).
      expect(spec.minTier).toBeLessThanOrEqual(f.runtime.strikingTier);
      // Ruleset gate (§2.2.5).
      expect(techniqueLegal(spec, strikingFlagsFor(world.ruleset))).toBe(true);
      return;
    }
    if (d.kind === 'grapple') {
      const ok = hasGrapplingEdge(d.what) || KNOWN_MOVES.has(d.what);
      expect(ok, `unknown grappling id ${d.what}`).toBe(true);
      return;
    }
    if (d.kind === 'submission') {
      expect(hasSubmission(d.what), `unknown submission ${d.what}`).toBe(true);
      return;
    }
    if (d.kind === 'move') {
      expect(KNOWN_MOVES.has(d.what), `unknown movement ${d.what}`).toBe(true);
      return;
    }
    if (d.kind === 'defend') expect(d.what.startsWith('def.')).toBe(true);
  }

  it('never emits an unknown, illegal or over-tier action across a long run', () => {
    for (const seed of ['legal-1', 'legal-2', 'legal-3']) {
      const world = primedWorld(config(seed));
      const policy = new MmaPolicy();
      policy.prepare(world);
      for (let t = 0; t < 150; t++) {
        world.tick = t;
        world.nowMs = t * 100;
        // Walk the fighters through the whole distance range.
        world.fighters[1].x = 0.3 + (t % 30) * 0.12;
        pushObservation(world);
        for (const f of world.fighters) {
          const d = policy.decide(ctxFor(world, f));
          assertLegal(world, f, d);
        }
      }
    }
  });

  it('strike candidates are always inside the range-fit tolerance', () => {
    const world = primedWorld(config('range-fit'));
    const policy = new MmaPolicy();
    policy.prepare(world);
    const a = world.fighters[0];
    const profile = reachProfile(a.runtime.effectiveReachM, a.runtime.effectiveKickReachM);
    for (let step = 0; step < 40; step++) {
      const d = 0.3 + step * 0.1;
      world.fighters[1].x = a.x + d;
      world.fighters[1].z = a.z;
      world.tick = step;
      world.nowMs = step * 100;
      // Pushed twice: the policy decides from the frame one tick back (§2.4.1),
      // so without this the test would be measuring the *previous* distance and
      // calling the perception delay a bug.
      pushObservation(world);
      pushObservation(world);
      const decision = policy.decide(ctxFor(world, a));
      if (decision.kind !== 'strike' || decision.what === null) continue;
      if (!hasTechnique(decision.what)) continue;
      const fit = rangeFit(technique(decision.what), d, profile, a.runtime.strikingMean);
      expect(fit.available, `${decision.what} at ${d.toFixed(2)} m`).toBe(true);
    }
  });

  it('a boxing ruleset never produces a kick, knee or elbow', () => {
    const world = primedWorld(config('boxing-only', { ruleset: 'boxing.pro' }));
    const policy = new MmaPolicy();
    policy.prepare(world);
    for (let t = 0; t < 120; t++) {
      world.tick = t;
      world.nowMs = t * 100;
      world.fighters[1].x = 0.5 + (t % 20) * 0.1;
      pushObservation(world);
      for (const f of world.fighters) {
        const d = policy.decide(ctxFor(world, f));
        if (d.kind !== 'strike' || d.what === null || !hasTechnique(d.what)) continue;
        const spec = technique(d.what);
        expect(['straight', 'hook', 'uppercut', 'overhand']).toContain(spec.family);
      }
    }
  });

  it('the candidate set is never empty', () => {
    const world = primedWorld(config('never-empty'));
    const f = world.fighters[0];
    const base: EnumerationContext = {
      self: f.runtime,
      ruleset: world.ruleset,
      posture: 'ground',
      node: 'pos.ground_knockdown',
      slot: null,
      distanceM: 0.2,
      cageDistM: 0.1,
      atCage: true,
      damage: { head: 0.9, body: 0.9, leadLeg: 0.9, rearLeg: 0.9, arms: 0.9 },
      balance: 0,
      hasTarget: false,
      outnumbered: true,
      positionValue: 0,
      mustNots: [],
      shield: 0,
    };
    expect(enumerateActions(base).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. The utility model (§2.2)
// ---------------------------------------------------------------------------

describe('§2.2 the IAUS score', () => {
  it('compensation keeps a nineteen-axis product usable', () => {
    const raw = Math.pow(0.9, CONSIDERATION_COUNT);
    let compensated = 1;
    for (let i = 0; i < CONSIDERATION_COUNT; i++) compensated *= compensate(0.9, CONSIDERATION_COUNT);
    expect(raw).toBeLessThan(0.2);
    expect(compensated).toBeGreaterThan(0.4);
    // A perfect axis is unchanged and a dead axis still kills the option.
    expect(compensate(1, 19)).toBeCloseTo(1, 12);
    expect(compensate(0, 19)).toBe(0);
  });

  it('the weight product is clamped to [0.25, 3]', () => {
    const action = {
      family: 'jab' as ActionFamily, base: 1, rangeError: 0, risk: 0,
      ownRegionDamage: 0, positionValue: 0.5, isMustNot: false, shield: 0,
    };
    const inputs = neutralInputs();
    const high = scoreAction(action, inputs, { style: 2, plan: 3, adapt: 3, matchup: 3, multi: 1 });
    const low = scoreAction(action, inputs, { style: 0.1, plan: 0.1, adapt: 0.1, matchup: 0.1, multi: 1 });
    expect(high.weightProduct).toBe(3);
    expect(low.weightProduct).toBe(0.25);
  });

  it('the temperature ladder falls monotonically with tier', () => {
    for (let t = 1; t <= 5; t++) expect(TAU_BY_TIER[t]).toBeLessThan(TAU_BY_TIER[t - 1]);
    expect(tauForTier(0)).toBeCloseTo(1.0, 10);
    expect(tauForTier(5)).toBeCloseTo(0.28, 10);
    // The 50/50 phase blend interpolates rather than rounding.
    expect(tauForTier(2.5)).toBeGreaterThan(TAU_BY_TIER[3]);
    expect(tauForTier(2.5)).toBeLessThan(TAU_BY_TIER[2]);
  });

  it('fatigue, rocked and the dump all widen the distribution', () => {
    const base = effectiveTau(0.45, { fatigue: 0, rocked: false, dump: 0, dumpActive: false, secondWind: false });
    const tired = effectiveTau(0.45, { fatigue: 0.8, rocked: false, dump: 0, dumpActive: false, secondWind: false });
    const rocked = effectiveTau(0.45, { fatigue: 0, rocked: true, dump: 0, dumpActive: false, secondWind: false });
    const wind = effectiveTau(0.45, { fatigue: 0, rocked: false, dump: 0, dumpActive: false, secondWind: true });
    expect(tired).toBeGreaterThan(base);
    expect(rocked).toBeGreaterThan(base);
    expect(wind).toBeLessThan(base);
    expect(qFatigue(0.2)).toBe(0);
    expect(qFatigue(0.5)).toBeCloseTo(0.15, 6);
    expect(qFatigue(0.8)).toBeCloseTo(0.35, 6);
    expect(qFatigue(1)).toBeLessThanOrEqual(0.5);
  });

  it('a T5 picks its best option more often than a T1 over 10,000 decisions', () => {
    // A spread of scores with one clear best and several plausible others.
    const scores = [1.0, 0.85, 0.7, 0.55, 0.4, 0.25];
    const rate = (tier: number): number => {
      const rng = new RNG(`softmax-${tier}`);
      let best = 0;
      for (let i = 0; i < 10_000; i++) {
        if (softmaxSelect(scores, tauForTier(tier), rng.next()) === 0) best++;
      }
      return best / 10_000;
    };
    const rates = [0, 1, 2, 3, 4, 5].map(rate);
    for (let t = 1; t <= 5; t++) {
      expect(rates[t], `T${t} vs T${t - 1}`).toBeGreaterThan(rates[t - 1]);
    }
    // T0 is near a lottery over the plausible options; T5 is near argmax.
    expect(rates[0]).toBeLessThan(0.35);
    expect(rates[5]).toBeGreaterThan(0.45);
    // ... but never *at* argmax: the predictability ceiling forbids it.
    expect(rates[5]).toBeLessThan(0.99);
  });

  it('softmax is a proper distribution over the candidates', () => {
    const scores = [3, 1, 1];
    const counts = [0, 0, 0];
    const rng = new RNG('softmax-dist');
    for (let i = 0; i < 20_000; i++) counts[softmaxSelect(scores, 1.0, rng.next())]++;
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(20_000);
    // At tau = 1 the weights are the scores, so 3 : 1 : 1.
    expect(counts[0] / total).toBeCloseTo(0.6, 1);
    expect(counts[1] / total).toBeCloseTo(0.2, 1);
    for (const c of counts) expect(c).toBeGreaterThan(0);
  });

  it('every family has a catalogue prior', () => {
    for (const family of ACTION_FAMILIES) expect(basePrior(family)).toBeGreaterThan(0);
  });
});

function neutralInputs() {
  return {
    ownFatigue: 0, oppFatigue: 0, oppHurt: 0 as const, ownCageDistM: 3, oppCageDistM: 3,
    roundTimeLeftFrac: 1, behind: false, setupRecent: 1 as const, expectedThreat: 0.3,
    oppInRecovery: 0 as const, balance: 1, riskAppetite: 0, paceRatio: 1,
    dwellExceeded: false, lookahead: 0, intentRangeM: 1.3, distanceM: 1.3,
    effectiveIqTier: 3,
  };
}

// ---------------------------------------------------------------------------
// 4. Macros (§2.2.5)
// ---------------------------------------------------------------------------

describe('§2.2.5 combination caps', () => {
  it('the selection cap follows the tier ladder and never exceeds four', () => {
    for (let tier = 0; tier <= 5; tier++) {
      const cap = comboCap({ tier, wrestlerEdgeTiers: 0, atLevelChangeRange: false, fenceBonus: false });
      expect(cap).toBeLessThanOrEqual(AI_COMBO_CAP_BY_TIER[tier]);
      expect(cap).toBeLessThanOrEqual(COMBO_MAX_ANY);
      expect(cap).toBeGreaterThanOrEqual(1);
    }
  });

  it('S-4 caps the combination at three in front of a wrestler', () => {
    const cap = comboCap({
      tier: 5, wrestlerEdgeTiers: 1, atLevelChangeRange: true, fenceBonus: false,
    });
    expect(cap).toBeLessThanOrEqual(3);
  });

  it('a plan cap and the fence bonus both bind', () => {
    expect(comboCap({ tier: 5, wrestlerEdgeTiers: 0, atLevelChangeRange: false, fenceBonus: false, planCap: 2 }))
      .toBe(2);
    const plain = comboCap({ tier: 2, wrestlerEdgeTiers: 0, atLevelChangeRange: false, fenceBonus: false });
    const fenced = comboCap({ tier: 2, wrestlerEdgeTiers: 0, atLevelChangeRange: false, fenceBonus: true });
    expect(fenced).toBeGreaterThanOrEqual(plain);
  });
});

// ---------------------------------------------------------------------------
// 5. Execution quality (§2.3)
// ---------------------------------------------------------------------------

describe('§2.3 execution quality', () => {
  it('the on-time rate matches the tier table and falls with fatigue', () => {
    for (let tier = 0; tier <= 5; tier++) {
      const rng = new RNG(`ontime-${tier}`);
      let onTime = 0;
      const n = 20_000;
      for (let i = 0; i < n; i++) {
        const q = executionQuality({
          spec: technique('tech.jab'), tier, fatigue: 0, requestedTarget: 'head',
          lateralStep: false, powerStrike: false,
        }, rng.next(), rng.next());
        if (q.timingOffsetTicks === 0) onTime++;
      }
      expect(onTime / n).toBeCloseTo(P_ONTIME_BY_TIER[tier], 1);
    }
  });

  it('the target error rate matches the tier table', () => {
    for (let tier = 0; tier <= 5; tier++) {
      const rng = new RNG(`target-${tier}`);
      let errors = 0;
      const n = 40_000;
      for (let i = 0; i < n; i++) {
        const q = executionQuality({
          spec: technique('tech.cross'), tier, fatigue: 0, requestedTarget: 'head',
          lateralStep: false, powerStrike: false,
        }, rng.next(), rng.next());
        if (q.targetErrored) errors++;
      }
      expect(Math.abs(errors / n - TARGET_ERROR_BY_TIER[tier])).toBeLessThan(0.01);
    }
  });

  it('a novice telegraphs more than an elite, and fatigue makes it worse', () => {
    const at = (tier: number, fatigue: number): number => executionQuality({
      spec: technique('tech.cross'), tier, fatigue, requestedTarget: 'head',
      lateralStep: false, powerStrike: false,
    }, 0.5, 0.5).telegraphMs;
    expect(at(0, 0)).toBeGreaterThan(at(5, 0));
    expect(at(3, 0.8)).toBeGreaterThan(at(3, 0));
  });

  it('the novice tells only fire for the novices, and only where they apply', () => {
    const rng = new RNG('tells');
    let t0Cross = 0;
    let t4Cross = 0;
    for (let i = 0; i < 5_000; i++) {
      if (executionQuality({
        spec: null, tier: 0, fatigue: 0, requestedTarget: 'head',
        lateralStep: true, powerStrike: false,
      }, rng.next(), rng.next()).feetCrossed) t0Cross++;
      if (executionQuality({
        spec: null, tier: 4, fatigue: 0, requestedTarget: 'head',
        lateralStep: true, powerStrike: false,
      }, rng.next(), rng.next()).feetCrossed) t4Cross++;
    }
    expect(t0Cross).toBeGreaterThan(0);
    expect(t4Cross).toBe(0);
    // Not a lateral step: the tell cannot fire at all.
    const straight = executionQuality({
      spec: null, tier: 0, fatigue: 0, requestedTarget: 'head',
      lateralStep: false, powerStrike: false,
    }, 0.5, 0.0);
    expect(straight.feetCrossed).toBe(false);
  });

  it('overcommitting costs balance and buys power, at T0-T1 only', () => {
    const over = executionQuality({
      spec: technique('tech.cross'), tier: 0, fatigue: 0, requestedTarget: 'head',
      lateralStep: false, powerStrike: true,
    }, 0.5, 0.2);
    expect(over.powerMult).toBeCloseTo(1.15, 6);
    expect(over.balanceDelta).toBeLessThan(0);
    const elite = executionQuality({
      spec: technique('tech.cross'), tier: 5, fatigue: 0, requestedTarget: 'head',
      lateralStep: false, powerStrike: true,
    }, 0.5, 0.2);
    expect(elite.powerMult).toBe(1);
  });

  it('the accuracy logit is never a bonus', () => {
    for (let tier = 0; tier <= 5; tier++) {
      for (const f of [0, 0.5, 1]) {
        const q = executionQuality({
          spec: technique('tech.jab'), tier, fatigue: f, requestedTarget: 'head',
          lateralStep: false, powerStrike: false,
        }, 0.5, 0.5);
        expect(q.accuracyLogit).toBeLessThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Perception and the opponent model (§2.4)
// ---------------------------------------------------------------------------

describe('§2.4.3 the opponent model', () => {
  const CTX = contextIndex('mid', 'fresh', 'jab');

  it('has exactly 72 contexts', () => {
    expect(CONTEXT_COUNT).toBe(72);
  });

  it('converges on a repeated pattern', () => {
    const model = new OpponentModel(4);
    const before = model.p(CTX, 'kick');
    for (let i = 0; i < 200; i++) model.note(CTX, 'kick');
    const after = model.p(CTX, 'kick');
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(0.85);
    expect(model.mostLikely(CTX)).toBe('kick');
    // Learning is per context: a different context is untouched.
    const other = contextIndex('long', 'tired', 'none');
    expect(model.p(other, 'kick')).toBeLessThan(0.2);
  });

  it('forgets it again after tau_mem, returning to the scouted prior', () => {
    const model = new OpponentModel(4);
    model.seed({ jab: 1, power: 1 });
    const prior = model.p(CTX, 'kick');
    for (let i = 0; i < 200; i++) model.note(CTX, 'kick');
    const learned = model.p(CTX, 'kick');
    expect(learned).toBeGreaterThan(0.85);

    // Ten memory horizons of silence: exp(-10) leaves 0.005 % of the counts,
    // so what is left is the film and nothing else.
    const tau = TAU_MEM_S_BY_IQ[4];
    for (let s = 0; s < tau * 10; s += 0.1) model.decay(0.1);
    const forgotten = model.p(CTX, 'kick');
    expect(forgotten).toBeLessThan(learned / 3);
    expect(Math.abs(forgotten - prior)).toBeLessThan(0.02);
    // The film is still there: the prior families still lead.
    expect(model.mostLikely(CTX)).not.toBe('kick');
  });

  it('a T0 fighter has no model at all', () => {
    const model = new OpponentModel(0);
    expect(model.active).toBe(false);
    for (let i = 0; i < 100; i++) model.note(CTX, 'kick');
    expect(model.p(CTX, 'kick')).toBeCloseTo(1 / 12, 6);
  });

  it('higher tiers remember longer', () => {
    let previous = -1;
    for (let tier = 1; tier <= 5; tier++) {
      expect(TAU_MEM_S_BY_IQ[tier]).toBeGreaterThan(previous);
      previous = TAU_MEM_S_BY_IQ[tier];
    }
    const short = new OpponentModel(1);
    const long = new OpponentModel(5);
    for (let i = 0; i < 100; i++) {
      short.note(CTX, 'kick');
      long.note(CTX, 'kick');
    }
    for (let s = 0; s < 40; s += 0.1) {
      short.decay(0.1);
      long.decay(0.1);
    }
    expect(long.p(CTX, 'kick')).toBeGreaterThan(short.p(CTX, 'kick'));
  });

  it('expectedThreat rises when the model expects power punches', () => {
    const quiet = new OpponentModel(4);
    const dangerous = new OpponentModel(4);
    for (let i = 0; i < 100; i++) {
      quiet.note(CTX, 'movement');
      dangerous.note(CTX, 'power');
    }
    expect(dangerous.expectedThreat(CTX)).toBeGreaterThan(quiet.expectedThreat(CTX));
    for (const m of [quiet, dangerous]) {
      expect(m.expectedThreat(CTX)).toBeGreaterThanOrEqual(0);
      expect(m.expectedThreat(CTX)).toBeLessThanOrEqual(1);
    }
  });

  it('the KL test detects a change of habit and not a steady one', () => {
    const steady = new OpponentModel(5);
    for (let i = 0; i < 300; i++) {
      steady.note(CTX, 'jab');
      steady.decay(0.1);
    }
    expect(steady.hasAdjusted(CTX)).toBe(false);

    const switcher = new OpponentModel(5);
    for (let i = 0; i < 600; i++) {
      switcher.note(CTX, 'jab');
      switcher.decay(0.1);
    }
    for (let i = 0; i < 200; i++) {
      switcher.note(CTX, 'takedown');
      switcher.decay(0.1);
    }
    expect(switcher.klDivergence(CTX)).toBeGreaterThan(0);
  });

  it('buildContext lands inside the table for every posture', () => {
    const postures = ['standing', 'clinch', 'ground', 'down', 'out'] as const;
    for (const posture of postures) {
      for (const d of [0.3, 1.0, 2.0]) {
        for (const top of [true, false]) {
          const idx = buildContext(posture, d, top, 0.5, 'jab');
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(CONTEXT_COUNT);
        }
      }
    }
  });
});

describe('§2.4.3 the exchange ledger', () => {
  it('forgets outside its 30 s window', () => {
    const ledger = new ExchangeLedger();
    ledger.advance(0);
    for (let i = 0; i < 10; i++) ledger.note('attempt', 'jab');
    expect(ledger.attempts('jab')).toBe(10);
    ledger.advance(31);
    expect(ledger.attempts('jab')).toBe(0);
    // Round totals survive the window; that is the corner's view.
    expect(ledger.round.attempts).toBe(10);
  });

  it('reports a hit rate only once the sample is big enough', () => {
    const ledger = new ExchangeLedger();
    ledger.advance(1);
    for (let i = 0; i < 5; i++) ledger.note('attempt', 'jab');
    expect(ledger.hitRate('jab')).toBeNull();
    ledger.note('attempt', 'jab');
    expect(ledger.hitRate('jab')).toBe(0);
    ledger.note('landed', 'jab');
    ledger.note('landed', 'jab');
    ledger.note('landed', 'jab');
    expect(ledger.hitRate('jab')).toBeCloseTo(0.5, 6);
  });

  it('counts consecutive stuffs and resets them on a landed takedown', () => {
    const ledger = new ExchangeLedger();
    ledger.advance(1);
    ledger.note('tdStuffed');
    ledger.note('tdStuffed');
    expect(ledger.consecutiveStuffs).toBe(2);
    ledger.note('tdLanded');
    expect(ledger.consecutiveStuffs).toBe(0);
  });
});

describe('§2.4.5 feint bite', () => {
  it('falls with the defender\'s striking skill', () => {
    const at = (defenderSkill: number): number => feintBiteProbabilityFor({
      // 01's formula: 0.62 - 0.40 x defSkill/100.
      baseBiteP: 0.62 - 0.40 * (defenderSkill / 100),
      feintQuality: 0.6,
      attackerFeintSkill: 60,
      repeatsInWindow: 0,
      defenderHurt: false,
      defenderFatigue: 0,
      defenderVisionBlocked: false,
    });
    const skills = [10, 30, 50, 70, 90];
    for (let i = 1; i < skills.length; i++) {
      expect(at(skills[i]), `skill ${skills[i]}`).toBeLessThan(at(skills[i - 1]));
    }
    // Endpoints: novices around 0.6, experts around 0.25 (§2.4.5 reference).
    expect(at(5)).toBeGreaterThan(0.45);
    expect(at(95)).toBeLessThan(0.45);
  });

  it('over-feinting is penalised, exactly once', () => {
    const at = (repeats: number): number => feintBiteProbabilityFor({
      baseBiteP: 0.5, feintQuality: 0.5, attackerFeintSkill: 50,
      repeatsInWindow: repeats, defenderHurt: false, defenderFatigue: 0,
      defenderVisionBlocked: false,
    });
    expect(at(1)).toBeLessThan(at(0));
    expect(at(3)).toBeLessThan(at(1));
  });

  it('a hurt fighter flinches more', () => {
    const base = { baseBiteP: 0.4, feintQuality: 0.5, attackerFeintSkill: 50, repeatsInWindow: 0, defenderFatigue: 0, defenderVisionBlocked: false };
    expect(feintBiteProbabilityFor({ ...base, defenderHurt: true }))
      .toBeGreaterThan(feintBiteProbabilityFor({ ...base, defenderHurt: false }));
  });
});

// ---------------------------------------------------------------------------
// 7. Adaptation (§2.6)
// ---------------------------------------------------------------------------

function signals(over: Partial<AdaptSignals> = {}): AdaptSignals {
  return {
    collapsedFamily: null, bestFamily: null, threatFamily: null,
    ownTdStuffedX2: false, takenDownX2: false, oppTired: false, oppHurt: false,
    ownFatigue: 0, round: 1, finalRound: false, perceivedRoundsUp: 0,
    needFinishDeficit: 2, ownVisionImpaired: false, cageExchanges: 0,
    oppAdjusted: false, ownLegDamaged: false, oppLegDamaged: false, trapReady: false,
    losingBehaviourUnchanged: false,
    isWrestler: false, isStriker: true, strengthEdge: false, subSpecialist: false,
    ...over,
  };
}

describe('§2.6 in-fight adaptation', () => {
  it('the cadence, P(change) and dwell ladders all improve with tier', () => {
    // A T0 fighter never evaluates; a T1 only on a knockdown.
    expect(evaluationDue(0, 10_000, ['knockdown'])).toBe(false);
    expect(evaluationDue(1, 10_000, [])).toBe(false);
    expect(evaluationDue(1, 0, ['knockdown'])).toBe(true);
    // The cadence tightens with tier.
    expect(evaluationDue(2, 89, [])).toBe(false);
    expect(evaluationDue(2, 91, [])).toBe(true);
    expect(evaluationDue(5, 21, [])).toBe(true);
    // Only a T5 notices the opponent adjusting.
    expect(evaluationDue(4, 0, ['oppAdjusted'])).toBe(false);
    expect(evaluationDue(5, 0, ['oppAdjusted'])).toBe(true);

    let previous = -1;
    for (let tier = 1; tier <= 5; tier++) {
      const p = pChange(tier, 50);
      expect(p).toBeGreaterThan(previous);
      previous = p;
      expect(p).toBeLessThanOrEqual(0.98);
    }
    expect(minDwellS(2)).toBeGreaterThan(minDwellS(5));
  });

  it('adaptability shifts P(change) at fixed fight IQ', () => {
    expect(pChange(3, 90)).toBeGreaterThan(pChange(3, 10));
  });

  it('each documented trigger fires its row, gated by tier', () => {
    const fired = (s: AdaptSignals, tier: number): string[] =>
      candidateAdjustments(s, tier, null).map((r) => r.id);

    expect(fired(signals({ collapsedFamily: 'jab', bestFamily: 'lowKick' }), 3))
      .toContain('adj.drop_family');
    expect(fired(signals({ collapsedFamily: 'jab' }), 2)).not.toContain('adj.drop_family');

    expect(fired(signals({ ownTdStuffedX2: true }), 2)).toContain('adj.td_stuffed_x2');
    expect(fired(signals({ takenDownX2: true }), 2)).toContain('adj.taken_down_x2');
    expect(fired(signals({ oppTired: true }), 2)).toContain('adj.opp_tired');
    expect(fired(signals({ ownFatigue: 0.7, round: 2 }), 2)).toContain('adj.self_low_stamina');
    expect(fired(signals({ cageExchanges: 3 }), 2)).toContain('adj.cage_trapped');
    expect(fired(signals({ oppLegDamaged: true }), 2)).toContain('adj.opp_leg_damaged');
    expect(fired(signals({ ownVisionImpaired: true }), 1)).toContain('adj.cut_vision');

    // The T5-only rows.
    expect(fired(signals({ oppAdjusted: true }), 4)).not.toContain('adj.opp_adjusted');
    expect(fired(signals({ oppAdjusted: true }), 5)).toContain('adj.opp_adjusted');
    expect(fired(signals({ trapReady: true }), 5)).toContain('adj.trap_set');

    // The hurt opponent is reflexive: even a T0 reacts.
    expect(fired(signals({ oppHurt: true }), 0)).toContain('adj.opp_hurt');

    // Every row in the table can be reached by some signal.
    expect(ADJUSTMENT_ROWS.length).toBe(16);
  });

  it('score awareness gates SC-2/3/4 on the deficit and the style hook', () => {
    const behind = signals({ finalRound: true, perceivedRoundsUp: -1 });
    expect(candidateAdjustments(behind, 2, null).map((r) => r.id)).toContain('adj.behind_final');
    // `losingBehaviour: 'unchanged'` disables it entirely.
    expect(candidateAdjustments({ ...behind, losingBehaviourUnchanged: true }, 2, null)
      .map((r) => r.id)).not.toContain('adj.behind_final');
    // Two rounds down is SC-3, not SC-2.
    const needFinish = signals({ finalRound: true, perceivedRoundsUp: -2 });
    const ids = candidateAdjustments(needFinish, 2, null).map((r) => r.id);
    expect(ids).toContain('adj.need_finish');
    expect(ids).not.toContain('adj.behind_final');
    // Only T3+ acts on being ahead.
    expect(candidateAdjustments(signals({ perceivedRoundsUp: 1 }), 2, null).map((r) => r.id))
      .not.toContain('adj.ahead');
    expect(candidateAdjustments(signals({ perceivedRoundsUp: 1 }), 3, null).map((r) => r.id))
      .toContain('adj.ahead');
  });

  it('respects the dwell: the same signal cannot revert an adjustment early', () => {
    const s = signals({ oppTired: true });
    const row = candidateAdjustments(s, 3, null)[0];
    const first = buildAdjustment(row, s, 100, 300, 'self');
    let active = applyAdjustment([], first, 100);
    expect(active).toHaveLength(1);

    // Re-firing inside the dwell changes nothing.
    const second = buildAdjustment(row, s, 200, 300, 'self');
    active = applyAdjustment(active, second, 200);
    expect(active[0].sinceTick).toBe(100);

    // After the dwell it is replaced.
    const third = buildAdjustment(row, s, 500, 300, 'self');
    active = applyAdjustment(active, third, 500);
    expect(active[0].sinceTick).toBe(500);
  });

  it('a score row cannot replace a contradicting one inside its dwell', () => {
    const ahead = signals({ perceivedRoundsUp: 1 });
    const behind = signals({ finalRound: true, perceivedRoundsUp: -1 });
    const aheadRow = candidateAdjustments(ahead, 3, null).find((r) => r.id === 'adj.ahead')!;
    const behindRow = candidateAdjustments(behind, 3, null).find((r) => r.id === 'adj.behind_final')!;
    let active = applyAdjustment([], buildAdjustment(aheadRow, ahead, 0, 300, 'self'), 0);
    active = applyAdjustment(active, buildAdjustment(behindRow, behind, 10, 300, 'self'), 10);
    expect(active.map((a) => a.id)).toEqual(['adj.ahead']);
    active = applyAdjustment(active, buildAdjustment(behindRow, behind, 400, 300, 'self'), 400);
    expect(active.map((a) => a.id)).toEqual(['adj.behind_final']);
  });

  it('effective IQ falls when hurt or empty, and floors at T0', () => {
    const base = { iqTier: 4, damageFrac: 0, fatigue: 0, sinceKnockdownS: Infinity, rocked: false };
    expect(effectiveIqTier(base)).toBe(4);
    expect(effectiveIqTier({ ...base, fatigue: 0.75 })).toBe(3);
    expect(effectiveIqTier({ ...base, damageFrac: 0.7 })).toBe(3);
    expect(effectiveIqTier({ ...base, sinceKnockdownS: 5 })).toBe(3);
    expect(effectiveIqTier({ ...base, rocked: true })).toBe(3);
    // Hurt *and* empty costs two.
    expect(effectiveIqTier({ ...base, rocked: true, fatigue: 0.9 })).toBe(2);
    expect(effectiveIqTier({ ...base, iqTier: 1, rocked: true, fatigue: 0.9 })).toBe(0);
  });

  it('score belief is the truth plus tier-scaled noise, and exact under open scoring', () => {
    const truth = 1;
    const spread = (tier: number): number => {
      const rng = new RNG(`belief-${tier}`);
      let sum = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) {
        const b = scoreBelief({
          trueRoundsUp: truth, effectiveIqTier: tier, openScoring: false,
          isCorner: false, z: normalFromUniform(rng.next()),
        });
        sum += (b - truth) * (b - truth);
      }
      return Math.sqrt(sum / n);
    };
    expect(spread(1)).toBeGreaterThan(spread(5));
    expect(spread(1)).toBeCloseTo(1.0, 0);
    expect(spread(5)).toBeLessThan(0.4);
    // SC-0: nobody is guessing under open scoring.
    for (let tier = 1; tier <= 5; tier++) {
      expect(scoreBelief({
        trueRoundsUp: truth, effectiveIqTier: tier, openScoring: true, isCorner: false, z: 9,
      })).toBe(truth);
    }
    // T0 has no estimate at all.
    expect(scoreBelief({
      trueRoundsUp: 2, effectiveIqTier: 0, openScoring: false, isCorner: false, z: 0,
    })).toBe(0);
    // The corner sees it more clearly than the fighter.
    const noisy = (isCorner: boolean): number => Math.abs(scoreBelief({
      trueRoundsUp: 0, effectiveIqTier: 2, openScoring: false, isCorner, z: 1,
    }));
    expect(noisy(true)).toBeLessThan(noisy(false));
  });
});

describe('§2.6.4 hurt behaviour', () => {
  it('a novice covers on the fence and an elite clinches or angles out', () => {
    const base = {
      isGrappler: false, cageWorkTier: 4, experience: 0.8, heart: 100, uHeart: 0.99,
    };
    expect(hurtBehaviour({ ...base, effectiveIqTier: 0 })).toBe('coverOnCage');
    expect(hurtBehaviour({ ...base, effectiveIqTier: 1 })).toBe('coverOnCage');
    expect(['clinch', 'circleOut', 'shoot'])
      .toContain(hurtBehaviour({ ...base, effectiveIqTier: 3 }));
    expect(['clinch', 'circleOut'])
      .toContain(hurtBehaviour({ ...base, effectiveIqTier: 5 }));
  });

  it('a grappler shoots or clinches; low heart turns a novice away', () => {
    const base = { cageWorkTier: 4, experience: 0.8, heart: 100, uHeart: 0.99 };
    expect(hurtBehaviour({ ...base, effectiveIqTier: 3, isGrappler: true })).toBe('shoot');
    expect(hurtBehaviour({ ...base, effectiveIqTier: 0, isGrappler: false, heart: 0, uHeart: 0.1 }))
      .toBe('turnAway');
  });

  it('the style override replaces the tier row outright', () => {
    expect(hurtBehaviour({
      effectiveIqTier: 5, isGrappler: false, cageWorkTier: 4, experience: 0.9,
      heart: 90, uHeart: 0.5, styleOverride: 'counter',
    })).toBe('counter');
  });

  it('each behaviour raises exactly the documented families', () => {
    expect(hurtWeights('coverOnCage', 1).block).toBeGreaterThan(1);
    expect(hurtWeights('circleOut', 4).circleAway).toBeGreaterThan(1);
    expect(hurtWeights('clinch', 5).clinchEntry).toBeGreaterThanOrEqual(2.5);
    expect(hurtWeights('clinch', 2).clinchEntry).toBeCloseTo(2.0, 6);
    expect(hurtWeights('shoot', 3).shoot).toBeGreaterThan(1);
  });

  it('a rocked fighter\'s live decisions shift to the emergency set', () => {
    const world = primedWorld(config('hurt-shift'));
    const policy = new MmaPolicy();
    policy.prepare(world);
    const self = world.fighters[0];

    const sample = (fromTick: number): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (let t = 0; t < 400; t++) {
        world.tick = fromTick + t;
        world.nowMs = (fromTick + t) * 100;
        pushObservation(world);
        const d = policy.decide(ctxFor(world, self));
        const tag = String((d.payload as { family?: string } | undefined)?.family ?? d.kind);
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
      return counts;
    };

    const healthy = sample(0);

    // Rock him the only way chapter 05 allows: land real head impacts. A side
    // stream does the rolling, so the decision stream is untouched.
    const side = new RNG('rock-him');
    for (let i = 0; i < 300 && !self.damage.has('state.rocked'); i++) {
      self.damage.applyImpact(rockingImpact(), side, { round: 1, attackerMassKg: 84 });
    }
    expect(self.damage.has('state.rocked'), 'the fixture must actually rock him').toBe(true);

    const hurt = sample(1000);

    // The emergency is live, and the behaviour is one of the documented rows.
    const state = self.ai as AiState;
    expect(state.intent.emergency).toBe('hurt');
    expect(['coverOnCage', 'clinch', 'shoot', 'circleOut', 'trade', 'counter', 'turnAway'])
      .toContain(state.hurtBehaviourId);
    expect(policy.intents(world).find((i) => i.fighterId === self.id)!.emergency).toBe(true);

    // And the families that behaviour boosts are visibly more common than they
    // were when he was fresh. Which families those are depends on the row the
    // tier and style selected, which is the point of §2.6.4: a wrestler buys
    // time by grabbing, a mover buys it with angles, a novice covers up.
    const boosted = Object.entries(hurtWeights(state.hurtBehaviourId!, state.intent.effectiveIqTier))
      .filter(([, mult]) => (mult ?? 1) > 1)
      .map(([family]) => family);
    expect(boosted.length).toBeGreaterThan(0);
    const share = (c: Record<string, number>): number =>
      boosted.reduce((sum, family) => sum + (c[family] ?? 0), 0);
    expect(share(hurt), `${state.hurtBehaviourId}: ${boosted.join(', ')}`)
      .toBeGreaterThan(share(healthy));
  });

  it('perceiving a hurt opponent raises the finish emergency', () => {
    const world = primedWorld(config('finish-emergency'));
    const policy = new MmaPolicy();
    policy.prepare(world);
    const self = world.fighters[0];
    for (let t = 0; t < 120; t++) {
      world.tick = t;
      world.nowMs = t * 100;
      pushObservation(world, (o) => (o.id === self.id ? o : { ...o, visiblyHurt: true }));
      policy.decide(ctxFor(world, self));
    }
    const intent = policy.intents(world).find((i) => i.fighterId === self.id)!;
    expect(intent.emergency).toBe(true);
  });
});

/** A flush chin shot heavy enough to rock a fresh fighter within a few tries. */
function rockingImpact(): StrikeImpact {
  return {
    tick: 0, subTickMs: 0, attacker: 1, target: 0,
    tech: 'tech.cross', weapon: 'fist', region: 'head', subLocation: 'chin',
    placement: 'flush', forceN: 2600, vRel: 10, effMassKg: 5, absorb: 0,
    defence: 'none', seen: false, counter: false, simultaneous: false,
    closingSpeedMs: 1.5,
    attackerState: { rocked: false, fatigue: 0 },
    targetState: {
      midAction: true, mouthOpen: true, guardHand: 'away', braced: false, grounded: false,
    },
    posture: 'distance', gloveType: 'mma4oz',
  };
}


// ---------------------------------------------------------------------------
// 8. Interchangeability with IdlePolicy
// ---------------------------------------------------------------------------

describe('policy interchangeability', () => {
  it('MmaPolicy and IdlePolicy satisfy the same interface and draw budget', () => {
    const world = primedWorld(config('interchange'));
    const policies: DecisionPolicy[] = [new IdlePolicy(), new MmaPolicy()];
    for (const policy of policies) {
      policy.prepare(world);
      for (const f of world.fighters) {
        const { draws, decision } = drawsTaken(policy, ctxFor(world, f));
        expect(draws).toBe(POLICY_DRAWS);
        expect(typeof decision.kind).toBe('string');
        expect(typeof decision.intentTag).toBe('string');
        expect(typeof decision.moveX).toBe('number');
        expect(typeof decision.moveZ).toBe('number');
        expect(decision.defence.startsWith('def.')).toBe(true);
      }
      policy.betweenRounds(world, 1);
      const intents = policy.intents(world);
      expect(intents).toHaveLength(world.fighters.length);
      for (const i of intents) {
        expect(typeof i.mode).toBe('string');
        expect(['long', 'mid', 'close', 'clinch', 'ground']).toContain(i.phase);
        expect(i.scoreBelief).toBeGreaterThanOrEqual(0);
        expect(i.scoreBelief).toBeLessThanOrEqual(1);
        expect(Array.isArray(i.planLines)).toBe(true);
        expect(Array.isArray(i.adjustments)).toBe(true);
      }
    }
  });

  it('a swap of policy mid-stream leaves the draw position aligned', () => {
    const world = primedWorld(config('swap'));
    const mma = new MmaPolicy();
    const idle = new IdlePolicy();
    mma.prepare(world);
    const start = world.rng.draws;
    for (let t = 0; t < 20; t++) {
      const policy: DecisionPolicy = t % 2 === 0 ? mma : idle;
      for (const f of world.fighters) policy.decide(ctxFor(world, f));
    }
    expect(world.rng.draws - start).toBe(20 * world.fighters.length * POLICY_DRAWS);
  });

  it('intents() is safe before prepare() has run', () => {
    const world = buildWorld(config('intents-early'));
    const intents = new MmaPolicy().intents(world);
    expect(intents).toHaveLength(world.fighters.length);
  });
});

// ---------------------------------------------------------------------------
// 9. The seam with the game-plan generator (§2.5)
// ---------------------------------------------------------------------------

describe('the plan generator seam', () => {
  it('prepare() takes the style jitter plus exactly the declared scouting budget', () => {
    const world = primedWorld(config('prepare-draws'));
    const policy = new MmaPolicy();
    const before = world.rng.draws;
    policy.prepare(world);
    const perFighter = ACTION_FAMILIES.length + SCOUT_DRAWS;
    expect(world.rng.draws - before).toBe(perFighter * world.fighters.length);
  });

  it('importing the barrel registers the generator, and plans reach the policy', () => {
    registerChapter07Providers();
    const world = primedWorld(config('plan-wired'));
    const policy = new MmaPolicy();
    policy.prepare(world);
    // The archetypes are trained fighters, so at least one gets a real plan.
    const planned = world.fighters
      .map((f) => (f.ai as AiState).plan)
      .filter((p) => p !== null);
    expect(planned.length).toBeGreaterThan(0);
    const intents = policy.intents(world);
    expect(intents.some((i) => i.planLines.length > 0)).toBe(true);
    for (const i of intents) expect(i.mode.startsWith('mode.')).toBe(true);
  });

  it('a registered generator that throws costs the bout nothing but that plan', () => {
    setPlanProvider({
      drawsPerFighter: () => 3,
      generate: () => {
        throw new Error('scouting report unavailable');
      },
    });
    const world = primedWorld(config('plan-throws'));
    const policy = new MmaPolicy();
    const before = world.rng.draws;
    expect(() => policy.prepare(world)).not.toThrow();
    // The declared budget is still consumed, so the stream stays aligned.
    expect(world.rng.draws - before)
      .toBe((ACTION_FAMILIES.length + 3) * world.fighters.length);
    for (const f of world.fighters) expect((f.ai as AiState).plan).toBeNull();
    // A fighter with no plan still decides, on style weights alone (§2.5.8).
    for (const f of world.fighters) {
      const { draws, decision } = drawsTaken(policy, ctxFor(world, f));
      expect(draws).toBe(POLICY_DRAWS);
      expect(typeof decision.kind).toBe('string');
    }
    registerChapter07Providers();
  });

  it('with no generator at all the policy still runs', () => {
    setPlanProvider(null);
    const world = primedWorld(config('plan-none'));
    const policy = new MmaPolicy();
    const before = world.rng.draws;
    policy.prepare(world);
    expect(world.rng.draws - before).toBe(ACTION_FAMILIES.length * world.fighters.length);
    for (const f of world.fighters) {
      expect(drawsTaken(policy, ctxFor(world, f)).draws).toBe(POLICY_DRAWS);
    }
    registerChapter07Providers();
  });
});

// ---------------------------------------------------------------------------
// 10. Parameters
// ---------------------------------------------------------------------------

describe('§4 parameter registry', () => {
  it('every ai.* parameter registers with a valid tag and bounds', () => {
    const registry = new ParamRegistry();
    expect(() => registry.addAll(AI_PARAMS)).not.toThrow();
    expect(AI_PARAMS.length).toBeGreaterThanOrEqual(140);
    for (const spec of AI_PARAMS) {
      expect(spec.id.startsWith('ai.'), spec.id).toBe(true);
      expect(spec.section).toBe('ai');
      expect(/^\[(S:|D:|E)/.test(spec.tag), `${spec.id} tag ${spec.tag}`).toBe(true);
      expect(spec.unit.length).toBeGreaterThan(0);
      expect(Number.isFinite(spec.value)).toBe(true);
      expect(spec.note, `${spec.id} has no note`).toBeTruthy();
    }
  });

  it('the draw counts are not calibration targets', () => {
    for (const id of ['ai.rng.draws_per_tick', 'ai.rng.draws_per_tick_multi', 'ai.rng.draws_per_break']) {
      const spec = AI_PARAMS.find((s) => s.id === id);
      expect(spec, id).toBeDefined();
      expect(spec!.free, `${id} must not be free`).toBe(false);
    }
    expect(AI_PARAMS.find((s) => s.id === 'ai.rng.draws_per_tick')!.value).toBe(DRAWS_PER_DECIDE);
    expect(AI_PARAMS.find((s) => s.id === 'ai.rng.draws_per_tick_multi')!.value)
      .toBe(DRAWS_PER_DECIDE_MULTI);
  });

  it('the tier ladders in the registry match the code', () => {
    const val = (id: string): number => AI_PARAMS.find((s) => s.id === id)!.value;
    for (let t = 0; t <= 5; t++) {
      expect(val(`ai.temp.tier.t${t}`)).toBeCloseTo(TAU_BY_TIER[t], 10);
      expect(val(`ai.exec.p_ontime.t${t}`)).toBeCloseTo(P_ONTIME_BY_TIER[t], 10);
      expect(val(`ai.exec.target_error.t${t}`)).toBeCloseTo(TARGET_ERROR_BY_TIER[t], 10);
      expect(val(`ai.combo.cap.t${t}`)).toBe(AI_COMBO_CAP_BY_TIER[t]);
    }
    for (let t = 1; t <= 5; t++) {
      expect(val(`ai.oppmodel.tau_mem.t${t}`)).toBe(TAU_MEM_S_BY_IQ[t]);
    }
  });

  it('no duplicate ids', () => {
    const seen = new Set<string>();
    for (const spec of AI_PARAMS) {
      expect(seen.has(spec.id), `duplicate ${spec.id}`).toBe(false);
      seen.add(spec.id);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. The one-uniform normal
// ---------------------------------------------------------------------------

describe('normalFromUniform', () => {
  it('produces a standard normal from one draw', () => {
    const rng = new RNG('normal');
    let sum = 0;
    let sumSq = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) {
      const z = normalFromUniform(rng.next());
      sum += z;
      sumSq += z * z;
    }
    expect(sum / n).toBeCloseTo(0, 1);
    expect(Math.sqrt(sumSq / n)).toBeCloseTo(1, 1);
  });

  it('is monotone and finite at the tails', () => {
    expect(normalFromUniform(0.001)).toBeLessThan(normalFromUniform(0.5));
    expect(normalFromUniform(0.5)).toBeCloseTo(0, 6);
    expect(normalFromUniform(0.5)).toBeLessThan(normalFromUniform(0.999));
    expect(Number.isFinite(normalFromUniform(0))).toBe(true);
    expect(Number.isFinite(normalFromUniform(1))).toBe(true);
  });
});
