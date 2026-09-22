/**
 * Chapter 07 part B — scouting, game-plan generation and the multi-opponent
 * manager.
 *
 * These are the §5 validation checks that can be made without running bouts:
 * the plan *mechanism* checks (V-1/V-3: a longer fighter plans to stay long, a
 * shorter one plans to get inside), the tier ladder of §2.5.8, the scouting
 * noise ladder, the ruleset gate, and the multi-opponent invariants of §2.7
 * and 09 §3.1 (two active slots, the fringe share, the threat formula, the
 * hysteresis and the one-draw-per-fighter contract).
 */
import { describe, expect, it } from 'vitest';
import { RNG } from '../src/sim/rng';
import { resolveParams } from '../src/sim/params';
import { MULTI_PARAMS } from '../src/sim/params/multi.params';
import { deriveRuntime } from '../src/sim/fighter';
import type { FighterDefinition, FighterRuntime } from '../src/sim/fighter';
import {
  ARCH_REGIONAL_PRO_ALLROUNDER, ARCH_BRAND_NEW_BRAWLER, ARCH_ELITE_WRESTLER_BOXER,
  ARCH_BJJ_GUARD_PLAYER, ARCH_THAI_STRIKER,
} from '../src/sim/fighter';
import { resolveRuleset } from '../src/sim/rules';
import { iqTier07Of, reportError, scoutOpponent, trueProfile } from '../src/sim/ai/scout';
import { generateGamePlan, scoutAndPlan } from '../src/sim/ai/plan';
import type { GamePlan } from '../src/sim/ai/plan';
import {
  ACTIVE_SLOTS, FRINGE_SHARE_BURST, FRINGE_SHARE_CALM, GROUNDED_DEFENDER_MULT,
  MultiManager, bystanderSeparationP, engagementSlots, groundedDefenderMultiplier,
  isOutnumbered, mayInitiateGround, multiManagerFor, outnumberedWeights, sampleEngages,
  setMultiManager, updateTargets,
} from '../src/sim/ai/multi';
import type { MultiFighterView, MultiWorldView } from '../src/sim/ai/contracts';

const params = resolveParams();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Mutate = (d: FighterDefinition) => void;

function build(base: FighterDefinition, mutate?: Mutate): FighterRuntime {
  const copy = JSON.parse(JSON.stringify(base)) as FighterDefinition;
  mutate?.(copy);
  return deriveRuntime(copy, params, { explain: false });
}

const MMA = resolveRuleset('mma.unified.3r');
const BOXING = resolveRuleset('boxing.pro');

/** A plan built with a fixed seed, so every assertion is reproducible. */
function planOf(self: FighterRuntime, opp: FighterRuntime, seed: string, ruleset = MMA): GamePlan | null {
  return scoutAndPlan(self, opp, ruleset, new RNG(seed));
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

describe('chapter 07 part B parameters', () => {
  it('registers every plan and multi-opponent parameter under section multi', () => {
    expect(MULTI_PARAMS.length).toBeGreaterThan(100);
    for (const spec of MULTI_PARAMS) {
      expect(spec.section).toBe('multi');
      expect(spec.tag).toMatch(/^\[(S:|D:|E)/);
      expect(spec.unit.length).toBeGreaterThan(0);
      expect(Number.isFinite(spec.value)).toBe(true);
    }
    // The registry resolves, i.e. no duplicate ids and no out-of-range defaults.
    expect(params.get('ai.multi.effective_attackers')).toBe(2);
    expect(params.get('ai.multi.fringe_share_burst')).toBeCloseTo(0.81, 6);
  });
});

// ---------------------------------------------------------------------------
// §2.5.4 R-1 / R-3 — the V-1 and V-3 mechanism checks
// ---------------------------------------------------------------------------

describe('physical-advantage rules (§2.5.4)', () => {
  const tall = build(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => {
    d.id = 'tall';
    d.body.reachM = 1.95;
    d.mental.fightIQ = 82;
  });
  const short = build(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => {
    d.id = 'short';
    d.body.reachM = 1.75;
    d.mental.fightIQ = 82;
  });

  const tallPlan = planOf(tall, short, 'reach-1')!;
  const shortPlan = planOf(short, tall, 'reach-2')!;

  it('the longer fighter plans to stay long: jab, teep and circling away go up', () => {
    expect(tallPlan.rangeTarget).toBe('long');
    expect(tallPlan.actionWeights.jab).toBeGreaterThan(1);
    expect(tallPlan.actionWeights.teep).toBeGreaterThan(1);
    expect(tallPlan.actionWeights.circleAway).toBeGreaterThan(1);
    expect(tallPlan.longGuard).toBe(true);
    // …and against the shorter fighter's own plan.
    expect(tallPlan.actionWeights.jab).toBeGreaterThan(shortPlan.actionWeights.jab);
    expect(tallPlan.actionWeights.teep).toBeGreaterThan(shortPlan.actionWeights.teep);
    expect(tallPlan.actionWeights.circleAway).toBeGreaterThan(shortPlan.actionWeights.circleAway);
  });

  it('the shorter fighter plans to get inside: level changes, clinch and body work go up', () => {
    expect(shortPlan.rangeTarget).toBe('short');
    expect(shortPlan.actionWeights.levelChange).toBeGreaterThan(1);
    expect(shortPlan.actionWeights.bodyHook).toBeGreaterThan(1);
    expect(shortPlan.actionWeights.slipEntry).toBeGreaterThan(1);
    expect(shortPlan.actionWeights.levelChange)
      .toBeGreaterThan(tallPlan.actionWeights.levelChange);
    expect(shortPlan.actionWeights.clinchEntry)
      .toBeGreaterThan(tallPlan.actionWeights.clinchEntry);
    expect(shortPlan.actionWeights.bodyHook).toBeGreaterThan(tallPlan.actionWeights.bodyHook);
    expect(shortPlan.mustNots).toContain('mn.stand_at_range');
  });

  it('reach changes the mix, never the odds: R-5 is recorded with no weights', () => {
    const r5 = tallPlan.rationale.find((r) => r.ruleId === 'R-5');
    expect(r5).toBeDefined();
    expect(Object.keys(r5!.weights)).toHaveLength(0);
    // No rule in the physical table may touch a hit-chance or win-rate field:
    // the plan simply has no such field to touch.
    expect(Object.keys(tallPlan)).not.toContain('winProbability');
    expect(Object.keys(tallPlan)).not.toContain('hitChanceBonus');
  });

  it('clamps every weight to the research range', () => {
    for (const v of Object.values(tallPlan.actionWeights)) {
      expect(v === 0 || (v >= 0.25 && v <= 3.0)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §2.5.8 plan quality by tier
// ---------------------------------------------------------------------------

describe('plan quality by fight-IQ tier (§2.5.8)', () => {
  const opponent = build(ARCH_ELITE_WRESTLER_BOXER, (d) => { d.id = 'opp'; });
  const iqFor = [25, 45, 65, 85, 97];

  const plans = iqFor.map((iq, i) => {
    const self = build(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => {
      d.id = `iq-${iq}`;
      d.mental.fightIQ = iq;
    });
    return { tier: i + 1, plan: planOf(self, opponent, `tier-${iq}`)! };
  });

  it('gives T0 no plan at all', () => {
    const t0 = build(ARCH_BRAND_NEW_BRAWLER, (d) => { d.id = 't0'; });
    expect(iqTier07Of(t0)).toBe(0);
    const plan = planOf(t0, opponent, 'brand-new');
    expect(plan).toBeNull();
  });

  it('sets quality to the fighter\'s own iq tier', () => {
    for (const { tier, plan } of plans) expect(plan.quality).toBe(tier);
  });

  it('gives T1 one line, no fallback, no must-nots and no triggers', () => {
    const t1 = plans[0].plan;
    expect(t1.planLines).toHaveLength(1);
    expect(t1.fallbackMode).toBeNull();
    expect(t1.mustNots).toHaveLength(0);
    expect(t1.triggers).toHaveLength(0);
  });

  it('adds features monotonically with tier', () => {
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i].plan.triggers.length)
        .toBeGreaterThanOrEqual(plans[i - 1].plan.triggers.length);
      expect(plans[i].plan.planLines.length)
        .toBeGreaterThanOrEqual(plans[i - 1].plan.planLines.length);
    }
    expect(plans[1].plan.fallbackMode).not.toBeNull();
    expect(plans[2].plan.triggers.length).toBeGreaterThanOrEqual(3);
  });

  it('gives T4 and T5 layered contingencies, and T5 the trap branch', () => {
    const t4 = plans[3].plan;
    const t5 = plans[4].plan;
    expect(t4.triggers.some((t) => (t.branch?.length ?? 0) > 0)).toBe(true);
    expect(t5.triggers.some((t) => t.id === 'adj.opp_adjusted')).toBe(true);
    expect(t5.triggers.find((t) => t.id === 'adj.opp_adjusted')?.branch?.[0].id)
      .toBe('adj.trap_set');
    expect(t5.planLines.length).toBeGreaterThan(plans[1].plan.planLines.length);
  });

  it('only makes the plan stance-aware from T3 (§2.5.8)', () => {
    const southpaw = build(ARCH_THAI_STRIKER, (d) => {
      d.id = 'southpaw';
      d.body.stance = 'southpaw';
    });
    const t2 = build(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => {
      d.id = 'st-t2';
      d.mental.fightIQ = 45;
    });
    const t4 = build(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => {
      d.id = 'st-t4';
      d.mental.fightIQ = 85;
    });
    const p2 = planOf(t2, southpaw, 'stance-2')!;
    const p4 = planOf(t4, southpaw, 'stance-4')!;
    expect(p2.rationale.some((r) => r.kind === 'stance' && r.ruleId.startsWith('ST-1'))).toBe(false);
    expect(p4.rationale.some((r) => r.kind === 'stance')).toBe(true);
    expect(p4.rationale.some((r) => r.ruleId === 'ST-3')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2.5.1 scouting noise
// ---------------------------------------------------------------------------

describe('scouting noise (§2.5.1)', () => {
  const opponent = build(ARCH_ELITE_WRESTLER_BOXER, (d) => { d.id = 'film'; });
  const truth = trueProfile(opponent);

  function meanError(fightIQ: number, samples = 200): number {
    const self = build(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => {
      d.id = `scout-${fightIQ}`;
      d.mental.fightIQ = fightIQ;
      d.body.ageYears = 28;
      d.record.daysSinceLastBout = 120;
    });
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      sum += reportError(scoutOpponent(self, opponent, new RNG(`scout-${fightIQ}-${i}`)), truth);
    }
    return sum / samples;
  }

  it('falls as fight IQ rises', () => {
    const t1 = meanError(25);
    const t3 = meanError(65);
    const t5 = meanError(97);
    expect(t1).toBeGreaterThan(t3);
    expect(t3).toBeGreaterThan(t5);
    expect(t5).toBeLessThan(0.15);
  });

  it('keeps physical traits exact from T1 (they are visible at the weigh-in)', () => {
    const self = build(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => {
      d.id = 'weighin';
      d.mental.fightIQ = 25;
    });
    const report = scoutOpponent(self, opponent, new RNG('weigh-in'));
    expect(report.opponent!.physical.reachM).toBe(truth.physical.reachM);
    expect(report.opponent!.physical.stance).toBe(truth.physical.stance);
    expect(report.opponent!.physical.massKg).toBe(truth.physical.massKg);
  });

  it('gives a T0 fighter no report at all, but still takes its pre-bout draws', () => {
    const t0 = build(ARCH_BRAND_NEW_BRAWLER, (d) => { d.id = 't0-scout'; });
    const pro = build(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => { d.id = 'pro-scout'; });
    const rngA = new RNG('draws');
    const rngB = new RNG('draws');
    const a = scoutOpponent(t0, opponent, rngA);
    scoutOpponent(pro, opponent, rngB);
    expect(a.knows).toBe(false);
    expect(a.opponent).toBeNull();
    // The draw count does not depend on the tier, so one fighter's tier can
    // never shift the other's stream.
    expect(rngA.draws).toBe(rngB.draws);
  });

  it('is reproducible for a seed', () => {
    const self = build(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => { d.id = 'repeat'; });
    const a = scoutOpponent(self, opponent, new RNG('same'));
    const b = scoutOpponent(self, opponent, new RNG('same'));
    expect(a.opponent).toEqual(b.opponent);
  });
});

// ---------------------------------------------------------------------------
// Author override and the ruleset gate
// ---------------------------------------------------------------------------

describe('game-plan override (01 §2.6, 07 §2.5.3)', () => {
  const opponent = build(ARCH_ELITE_WRESTLER_BOXER, (d) => { d.id = 'ovr-opp'; });

  it('wins over the generated plan', () => {
    const authored = build(ARCH_THAI_STRIKER, (d) => {
      d.id = 'authored';
      d.style.gamePlanOverride = {
        primaryMode: 'mode.clinch_grind',
        rangeTarget: 'short',
        tdPolicy: 'chain',
      };
    });
    const generated = planOf(build(ARCH_THAI_STRIKER, (d) => { d.id = 'gen'; }), opponent, 'ovr')!;
    const overridden = planOf(authored, opponent, 'ovr')!;
    expect(overridden.overridden).toBe(true);
    expect(overridden.primaryMode).toBe('mode.clinch_grind');
    expect(overridden.rangeTarget).toBe('short');
    expect(overridden.rationale[0].ruleId).toBe('override');
    expect(generated.overridden).toBe(false);
  });

  it('applies even to a T0 fighter, who otherwise has no plan', () => {
    const t0 = build(ARCH_BRAND_NEW_BRAWLER, (d) => {
      d.id = 't0-ovr';
      d.style.gamePlanOverride = { primaryMode: 'mode.pressure_striking' };
    });
    const plan = planOf(t0, opponent, 't0-ovr');
    expect(plan).not.toBeNull();
    expect(plan!.primaryMode).toBe('mode.pressure_striking');
    expect(plan!.overridden).toBe(true);
  });
});

describe('ruleset gate', () => {
  const boxer = build(ARCH_ELITE_WRESTLER_BOXER, (d) => { d.id = 'wrestler-in-boxing'; });
  const grappler = build(ARCH_BJJ_GUARD_PLAYER, (d) => { d.id = 'bjj-in-boxing'; });

  it('never yields a takedown plan under a boxing ruleset', () => {
    for (const [self, opp] of [[boxer, grappler], [grappler, boxer]] as const) {
      const plan = planOf(self, opp, `boxing-${self.id}`, BOXING)!;
      expect(plan.tdPolicy).toBe('never');
      expect(plan.actionWeights.shoot).toBe(0);
      expect(plan.actionWeights.nakedShot).toBe(0);
      expect(plan.actionWeights.levelChange).toBe(0);
      expect(plan.actionWeights.bodylockTd).toBe(0);
      expect(plan.actionWeights.trip).toBe(0);
      expect(plan.actionWeights.guardPull).toBe(0);
      expect(plan.actionWeights.submission).toBe(0);
      // Kicks, knees and elbows are fouls in boxing too.
      expect(plan.actionWeights.lowKick).toBe(0);
      expect(plan.actionWeights.knee).toBe(0);
      expect(plan.actionWeights.elbow).toBe(0);
      // …and the mode itself is a striking mode.
      expect(['mode.distance_striking', 'mode.pressure_striking', 'mode.counter_striking'])
        .toContain(plan.primaryMode);
      expect(plan.primaryWeapons).not.toContain('shoot');
      expect(plan.mustNots).not.toContain('mn.naked_shot');
      expect(plan.roundPacing.every((r) => r.tdAttemptTarget === 0)).toBe(true);
    }
  });

  it('still plans takedowns under MMA rules for the same wrestler', () => {
    const plan = planOf(boxer, grappler, 'mma-wrestler', MMA)!;
    expect(plan.tdPolicy).not.toBe('never');
    expect(plan.actionWeights.shoot).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-opponent fixtures
// ---------------------------------------------------------------------------

interface TestFighter extends MultiFighterView {
  x: number;
  z: number;
  facing: number;
  posture: 'standing' | 'clinch' | 'ground' | 'down' | 'out';
  out: boolean;
}

function fighter(
  id: number, team: number, x: number, z: number, iqTier = 4, facing = 0,
): TestFighter {
  return {
    id, team, x, z, facing, posture: 'standing', out: false, runtime: { iqTier },
  };
}

interface TestWorld extends MultiWorldView {
  tick: number;
  nowMs: number;
  fighters: TestFighter[];
  ruleset: { family: string };
}

function makeWorld(fighters: TestFighter[], family = 'mma'): TestWorld {
  return { tick: 0, nowMs: 0, fighters, ruleset: { family } };
}

// ---------------------------------------------------------------------------
// §2.7 / 09 §3.1 — threat, targeting and the draw contract
// ---------------------------------------------------------------------------

describe('multi-opponent targeting (§2.7.2, 09 §3.1)', () => {
  it('consumes exactly one draw per fighter', () => {
    const world = makeWorld([
      fighter(0, 0, 0, 0), fighter(1, 1, 1.0, 0), fighter(2, 1, 1.4, 0),
      fighter(3, 1, 2.5, 0), fighter(4, 1, 4.0, 0),
    ]);
    const rng = new RNG('draws-per-fighter');
    const before = rng.draws;
    updateTargets(world, rng);
    expect(rng.draws - before).toBe(world.fighters.length);

    // …and again on a tick where nobody is due to re-evaluate.
    world.tick = 1;
    world.nowMs = 100;
    const mid = rng.draws;
    updateTargets(world, rng);
    expect(rng.draws - mid).toBe(world.fighters.length);

    // …including when a fighter is out.
    world.fighters[1].out = true;
    const late = rng.draws;
    updateTargets(world, rng);
    expect(rng.draws - late).toBe(world.fighters.length);
  });

  it('implements the 09 §3.1 threat formula', () => {
    const world = makeWorld([fighter(0, 0, 0, 0), fighter(1, 1, 1.5, 0, 4, Math.PI)]);
    const mgr = setMultiManager(world, new MultiManager({ street: false, freeForAll: false }));
    const [self, other] = world.fighters;
    // d = 1.5, facing me (heading pi points back at the origin), no damage yet.
    expect(mgr.threat(world, self, other)).toBeCloseTo(0.5 / 2.0 + 0.2, 6);
    mgr.recordDamage(other.id, self.id, 25, 0);
    expect(mgr.threat(world, self, other)).toBeCloseTo(0.5 / 2.0 + 0.3 + 0.2, 6);
    // The damage term ages out after ten seconds.
    world.nowMs = 11_000;
    expect(mgr.threat(world, self, other)).toBeCloseTo(0.5 / 2.0 + 0.2, 6);
  });

  it('is deterministic for a seed', () => {
    const build2 = (): TestWorld => makeWorld([
      fighter(0, 0, 0, 0), fighter(1, 1, 1.0, 0), fighter(2, 1, 1.2, 0.3),
      fighter(3, 1, 2.0, -0.5),
    ]);
    const a = build2();
    const b = build2();
    const ra = new RNG('multi-seed');
    const rb = new RNG('multi-seed');
    for (let t = 0; t < 30; t++) {
      a.tick = t;
      b.tick = t;
      a.nowMs = t * 100;
      b.nowMs = t * 100;
      expect(updateTargets(a, ra)).toEqual(updateTargets(b, rb));
    }
    expect(ra.draws).toBe(rb.draws);
  });

  it('respects the 1.2x switching hysteresis and the minimum hold', () => {
    const world = makeWorld([
      fighter(0, 0, 0, 0), fighter(1, 1, 1.0, 0), fighter(2, 1, 1.1, 0),
    ]);
    const rng = new RNG('hysteresis');
    updateTargets(world, rng);
    const mgr = multiManagerFor(world);
    expect(mgr.state(0).targetId).toBe(1);

    // A slightly better candidate is not enough: 1.1 m vs 1.0 m is nowhere
    // near 1.2x the current threat.
    world.fighters[2].x = 0.95;
    for (let t = 1; t <= 20; t++) {
      world.tick = t;
      world.nowMs = t * 100;
      updateTargets(world, rng);
    }
    expect(mgr.state(0).targetId).toBe(1);

    // A hostile who closes to arm's length clears the bar.
    world.fighters[2].x = 0.2;
    world.tick = 30;
    world.nowMs = 3000;
    updateTargets(world, rng);
    expect(mgr.state(0).targetId).toBe(2);
    expect(mgr.state(0).switches).toBeGreaterThanOrEqual(2);
  });

  it('switches immediately when the current target goes down', () => {
    const world = makeWorld([
      fighter(0, 0, 0, 0), fighter(1, 1, 1.0, 0), fighter(2, 1, 1.6, 0),
    ]);
    const rng = new RNG('target-down');
    updateTargets(world, rng);
    const mgr = multiManagerFor(world);
    expect(mgr.state(0).targetId).toBe(1);
    world.fighters[1].out = true;
    world.tick = 1;
    world.nowMs = 100;
    updateTargets(world, rng);
    expect(mgr.state(0).targetId).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §2.7.3 / 09 §3.1 — engagement slots and the fringe
// ---------------------------------------------------------------------------

describe('engagement slots (§2.7.3, 09 §3.1)', () => {
  it('lets at most two attackers engage one defender, with five in the crowd', () => {
    const world = makeWorld([
      fighter(0, 0, 0, 0),
      fighter(1, 1, 0.8, 0), fighter(2, 1, 1.0, 0.2), fighter(3, 1, 1.2, -0.3),
      fighter(4, 1, 1.5, 0.4), fighter(5, 1, 1.6, -0.3),
    ], 'street');
    const mgr = setMultiManager(world, new MultiManager({ street: true, freeForAll: false }));
    const slots = engagementSlots(world, mgr, 0);
    expect(slots.engaged).toHaveLength(ACTIVE_SLOTS);
    expect(slots.fringe).toHaveLength(3);
    // engagedBy sees 2 + 0.3 per fringe attacker, not five.
    expect(slots.effectiveAttackers).toBeCloseTo(2 + 0.3 * 3, 6);

    // The roles the manager hands out agree: no more than two non-fringe.
    updateTargets(world, new RNG('slots'));
    const attackerRoles = world.fighters
      .filter((f) => f.team === 1)
      .map((f) => mgr.state(f.id).role);
    const active = attackerRoles.filter((r) => r !== 'role.fringe' && r !== 'role.bystander');
    expect(active.length).toBeLessThanOrEqual(ACTIVE_SLOTS);
  });

  it('matches the documented fringe engagement share over 10k samples', () => {
    const bursty = new RNG('fringe-burst');
    const calm = new RNG('fringe-calm');
    let engagedBurst = 0;
    let engagedCalm = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      if (sampleEngages(bursty, true)) engagedBurst++;
      if (sampleEngages(calm, false)) engagedCalm++;
    }
    expect(engagedBurst / N).toBeCloseTo(FRINGE_SHARE_BURST, 1);
    expect(Math.abs(engagedBurst / N - 0.81)).toBeLessThan(0.02);
    expect(engagedCalm / N).toBeCloseTo(FRINGE_SHARE_CALM, 1);
    expect(Math.abs(engagedCalm / N - 0.51)).toBeLessThan(0.02);
    // Exactly one draw per member sampled.
    expect(bursty.draws).toBe(N);
  });
});

// ---------------------------------------------------------------------------
// §2.7.3 / §2.7.6 — the outnumbered fighter and the street
// ---------------------------------------------------------------------------

describe('the outnumbered fighter (§2.7.3)', () => {
  const world = makeWorld([
    fighter(0, 0, 0, 0),
    fighter(1, 1, 1.0, 0), fighter(2, 1, -1.0, 0.5), fighter(3, 1, 0.2, 2.0),
  ], 'street');
  const mgr = setMultiManager(world, new MultiManager({ street: true, freeForAll: false }));

  it('recognises being outnumbered and refuses the ground', () => {
    const defender = world.fighters[0];
    expect(isOutnumbered(world, mgr, defender)).toBe(true);
    expect(mayInitiateGround(world, mgr, defender)).toBe(false);

    const w = outnumberedWeights({
      nowMs: 1000, lastStrikeMs: 900, grounded: false, shieldAvailable: false,
    });
    for (const family of ['shoot', 'nakedShot', 'levelChange', 'trip', 'bodylockTd', 'guardPull'] as const) {
      expect(w[family]).toBeLessThanOrEqual(0.05);
    }
    expect(w.bottomSubmission).toBe(0);
    expect(w.standUp).toBeGreaterThanOrEqual(3);
    expect(w.wallWalk).toBeGreaterThanOrEqual(3);
    // Strike and move: straights up, hooks down, movement doubled just after
    // a committed strike.
    expect(w.jab).toBeGreaterThan(1);
    expect(w.hook).toBeLessThan(1);
    expect(w.retreat).toBe(2);
    // The clinch is only allowed as a shield.
    expect(w.clinchEntry).toBeLessThanOrEqual(0.05);
    expect(outnumberedWeights({
      nowMs: 1000, lastStrikeMs: 900, grounded: false, shieldAvailable: true,
    }).clinchEntry).toBeGreaterThan(1);
  });

  it('applies the grounded-defender multiplier in the street only', () => {
    const grounded = { ...world.fighters[0], posture: 'ground' as const };
    const streetWorld = makeWorld([grounded, ...world.fighters.slice(1)], 'street');
    const streetMgr = setMultiManager(streetWorld, new MultiManager({ street: true, freeForAll: false }));
    expect(groundedDefenderMultiplier(streetWorld, streetMgr, grounded))
      .toBe(GROUNDED_DEFENDER_MULT);

    const cageWorld = makeWorld([grounded, ...world.fighters.slice(1)], 'mma');
    const cageMgr = setMultiManager(cageWorld, new MultiManager({ street: false, freeForAll: false }));
    expect(groundedDefenderMultiplier(cageWorld, cageMgr, grounded)).toBe(1);
  });

  it('only lets bystanders separate the fight once somebody is down', () => {
    const calm = makeWorld([fighter(0, 0, 0, 0), fighter(1, 1, 1, 0)], 'street');
    const calmMgr = setMultiManager(calm, new MultiManager({ street: true, freeForAll: false }));
    expect(bystanderSeparationP(calm, calmMgr, 10_000)).toBe(0);
    calm.fighters[1].posture = 'down';
    calm.nowMs = 5000;
    expect(bystanderSeparationP(calm, calmMgr, 10_000)).toBeCloseTo(0.10, 6);
  });

  it('never has an outnumbered fighter plan to go to the ground in street mode', () => {
    const streetRules = resolveRuleset('street');
    const self = build(ARCH_BJJ_GUARD_PLAYER, (d) => { d.id = 'bjj-street'; });
    const opp = build(ARCH_BRAND_NEW_BRAWLER, (d) => { d.id = 'thug'; });
    const plan = planOf(self, opp, 'street-plan', streetRules)!;
    // The plan may well want the ground one-on-one …
    const base = plan.actionWeights;
    // … but the outnumbered override the manager hands the action layer wins.
    const merged = { ...base, ...outnumberedWeights({
      nowMs: 0, lastStrikeMs: -1e9, grounded: false, shieldAvailable: false,
    }) };
    expect(merged.guardPull).toBeLessThanOrEqual(0.05);
    expect(merged.shoot).toBeLessThanOrEqual(0.05);
    expect(merged.submission).toBeLessThanOrEqual(0.05);
    expect(merged.standUp).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Sanity: a generated plan is internally consistent
// ---------------------------------------------------------------------------

describe('generated plans are internally consistent', () => {
  it('never lists a zero-weight family as a weapon, and pacing covers every round', () => {
    const a = build(ARCH_THAI_STRIKER, (d) => { d.id = 'a'; });
    const b = build(ARCH_ELITE_WRESTLER_BOXER, (d) => { d.id = 'b'; });
    const fiveRound = resolveRuleset('mma.unified.5r');
    const plan = generateGamePlan({
      self: a, opponent: b, ruleset: fiveRound,
      report: scoutOpponent(a, b, new RNG('consistency')),
    })!;
    expect(plan.roundPacing).toHaveLength(5);
    expect(plan.roundPacing.reduce((s, r) => s + r.finishSeeking, 0)).toBeGreaterThan(0.9);
    for (const fam of plan.primaryWeapons) expect(plan.actionWeights[fam]).toBeGreaterThan(1);
    for (const fam of plan.avoidList) expect(plan.actionWeights[fam]).toBeLessThanOrEqual(0.7);
    expect(plan.comboCap).toBeGreaterThanOrEqual(1);
    expect(plan.comboCap).toBeLessThanOrEqual(4);
    expect(plan.cornerScript.filter((c) => c.round === 1).length).toBeLessThanOrEqual(2);
  });
});
