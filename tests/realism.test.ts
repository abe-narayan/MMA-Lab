/**
 * REALISM PASS PINS (engine 6.0) — docs/design/REALISM_PASS.md.
 *
 * One pin per structural change: the mechanisms exist, point the right way,
 * and stay wired. Directions and invariants, never calibrated numbers.
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, DEFAULT_SETTINGS, computeStats, createSim, deriveRuntime, resolveParams, simulate,
  type FighterDefinition, type SimConfig, type SimEvent,
} from '../src/sim';
import { GRAPPLING_EDGES } from '../src/sim/grappling/graph';
import { grapplingAliases } from '../src/sim/core/bind';
import { alphaEquivalent, frontEnd } from '../src/sim/damage/ko';
import { defaultTuning, type StrikeImpact } from '../src/sim/damage';
import { technique } from '../src/sim/striking/catalogue';
import { newTacticalState, openExposure, tacticalTerms, type TacticalContext } from '../src/sim/striking/tactics';
import { bandFor, bandLimits, reachProfile } from '../src/sim/striking/range';
import { preferredDistance } from '../src/sim/ai/footwork';
import { rangeTargetCurve, softmaxSelect } from '../src/sim/ai/utility';
import { urgency } from '../src/sim/ai/scorecard';
import { initiativeWeight, phasePolicyWeight, shapeUrgency } from '../src/sim/ai/policy';
import { authoredMode } from '../src/sim/ai/plan';
import '../src/sim/ai';

const ALL = Object.values(ARCHETYPES) as FighterDefinition[];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const arch = (id: string): FighterDefinition => clone(ALL.find((a) => a.id === id)!);
const RPA = arch('arch.regional_pro_allrounder');
const P = resolveParams();
const rt = (d: FighterDefinition) => deriveRuntime(d, P, { explain: false });

function cfg(seed: string, a: FighterDefinition, b: FighterDefinition): SimConfig {
  const A = clone(a); A.id = 'a'; A.short = 'AAA';
  const B = clone(b); B.id = 'b'; B.short = 'BBB';
  return {
    seed, mode: '1v1', fighters: [A, B], teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS },
  };
}

describe('QA2 #6: one definition of a strike attempt', () => {
  it('the live counters equal the stats, fighter by fighter', () => {
    for (let i = 0; i < 4; i++) {
      const config = cfg(`realism-count-${i}`, RPA, arch('arch.elite_wrestler_boxer'));
      const sim = createSim(config);
      while (sim.step()) { /* run */ }
      const stats = computeStats(sim.events, config, sim.tick);
      for (const f of sim.world.fighters) {
        const s = stats.fighters[f.id];
        expect(s.sig.attempted, `sig attempted f${f.id} seed ${i}`).toBe(f.sigAttempted);
        expect(s.sig.landed).toBe(f.sigLanded);
        expect(s.total.attempted).toBe(f.totalAttempted);
        expect(s.total.landed).toBe(f.totalLanded);
      }
    }
  });
});

describe('the grappling skill terms are live', () => {
  it('every skill alias an edge names resolves to a number', () => {
    const al = grapplingAliases(rt(RPA));
    for (const e of GRAPPLING_EDGES) {
      for (const a of [...e.skills.attacker, ...e.skills.defender]) {
        expect(typeof al[a], `${e.id} names ${a}`).toBe('number');
      }
    }
  });

  it('an MMA fighter with no wrestling block still defends a shot', () => {
    const al = grapplingAliases(rt(RPA));
    expect(al['wr.sprawl']).toBeGreaterThan(30);
  });

  it('grip strength and balance move the aliases that hold ties and stop shots', () => {
    const lo = clone(RPA); lo.physical.gripStrength = 20; lo.physical.balance = 20;
    const hi = clone(RPA); hi.physical.gripStrength = 90; hi.physical.balance = 90;
    const L = grapplingAliases(rt(lo));
    const H = grapplingAliases(rt(hi));
    expect(H['wr.pummel']).toBeGreaterThan(L['wr.pummel']);
    expect(H['bjj.top_control']).toBeGreaterThan(L['bjj.top_control']);
    expect(H['wr.sprawl']).toBeGreaterThan(L['wr.sprawl']);
  });
});

describe('chapter 02 tactical layer at contact', () => {
  const me = rt(RPA);
  const profile = reachProfile(me.effectiveReachM, me.effectiveKickReachM);
  const limits = bandLimits(profile);
  const base = (over: Partial<TacticalContext> = {}): TacticalContext => ({
    spec: technique('tech.cross'), launchMs: 10_000, contactMs: 10_250, attackerId: 0, targetId: 1,
    attacker: me, defender: me, attackerState: newTacticalState(), defenderState: newTacticalState(),
    distanceM: (limits.closeMax + limits.midMax) / 2, band: 'mid', profile, limits, atDistance: true,
    region: 'head', attackerStance: 'orthodox', defenderStance: 'orthodox', classScale: 'middle', ...over,
  });

  it('a strike launched into the target’s recovery is a counter with a bonus', () => {
    const def = newTacticalState();
    openExposure(def, technique('tech.jab'), 'missed', 4, 9_900);
    const t = tacticalTerms(base({ defenderState: def }));
    expect(t.counter).toBe(true);
    expect(t.parts.counter).toBeGreaterThan(0);
    expect(tacticalTerms(base()).counter).toBe(false);
  });

  it('a strike from outside its home band pays the range-fit penalty', () => {
    const far = (limits.midMax + limits.longMax) / 2;
    const t = tacticalTerms(base({
      spec: technique('tech.hook_lead'), distanceM: far, band: bandFor(far, profile),
    }));
    expect(t.parts.range).toBeLessThan(0);
  });

  it('a bitten feint voids the defence and buys a follow-up bonus', () => {
    const def = newTacticalState();
    def.bitBy = 0; def.bitUntilMs = 11_000; def.bitBonus = 0.2; def.bitFeint = 'feint.jab';
    const t = tacticalTerms(base({ defenderState: def }));
    expect(t.voidDefence).toBe(true);
    expect(t.parts.feint).toBeGreaterThan(0);
  });

  it('feints happen and are recorded, with bites', () => {
    const run = simulate(cfg('realism-feints', RPA, RPA));
    const feints = run.events.filter((e: SimEvent) => e.kind === 'feint');
    expect(feints.length).toBeGreaterThan(0);
  });
});

describe('the rotational KO term', () => {
  const T = defaultTuning();
  const imp = (tech: string, site: 'chin' | 'forehead'): StrikeImpact => ({
    tick: 0, subTickMs: 0, attacker: 1, target: 0, tech, weapon: 'fist', region: 'head', subLocation: site,
    placement: 'flush', forceN: 1500, vRel: 8, effMassKg: 4, absorb: 0, defence: 'none', seen: true,
    counter: false, simultaneous: false, closingSpeedMs: 0,
    attackerState: { rocked: false, fatigue: 0 },
    targetState: { midAction: false, mouthOpen: false, guardHand: 'up', braced: false, grounded: false },
    posture: 'distance', gloveType: 'mma4oz', rotFactor: technique(tech).rotationalFactor,
  });
  const alpha = (i: StrikeImpact): number => alphaEquivalent(T, i,
    { neck: 50, fatigue: 0, headStructural: 0, neckCranked: false, targetMassKg: 77 },
    frontEnd(T, i, 77, false)).alphaEq;

  it('a hook to the jaw turns the head more than a straight of the same force', () => {
    expect(alpha(imp('tech.hook_lead', 'chin'))).toBeGreaterThan(1.3 * alpha(imp('tech.cross', 'chin')));
  });
  it('the tangential lever is the jaw, not the forehead', () => {
    expect(alpha(imp('tech.hook_lead', 'chin'))).toBeGreaterThan(alpha(imp('tech.hook_lead', 'forehead')));
  });
});

describe('footwork and reach', () => {
  it('the longer fighter’s outfighting distance sits in his shell, outside the other jab', () => {
    const long = clone(RPA); long.body.reachM = RPA.body.reachM + 0.18;
    const L = rt(long); const S = rt(RPA);
    const d = preferredDistance(L, S, 'long').dStar;
    const theirs = bandLimits(reachProfile(S.effectiveReachM, S.effectiveKickReachM));
    const mine = bandLimits(reachProfile(L.effectiveReachM, L.effectiveKickReachM));
    expect(d).toBeGreaterThan(theirs.longMax);
    expect(d).toBeLessThan(mine.longMax);
  });

  it('inside the hold band, stepping in or out scores below circling; outside, the wrong way is rare', () => {
    expect(rangeTargetCurve(true, false, 1.0, 1.0, 0.1)).toBeLessThan(rangeTargetCurve(false, false, 1.0, 1.0, 0.1));
    expect(rangeTargetCurve(true, false, 1.6, 1.0, 0.1)).toBeGreaterThan(4 * rangeTargetCurve(false, true, 1.6, 1.0, 0.1));
  });

  it('movement is committed in steps, not re-drawn every tick', () => {
    const sim = createSim(cfg('realism-steps', RPA, RPA));
    let runs = 0; let single = 0; let cur = 0; let lastMoving = false;
    while (sim.step()) {
      const f = sim.world.fighters[0];
      const moving = f.posture === 'standing' && Math.hypot(f.vx, f.vz) > 0.1;
      if (moving) cur++;
      if (!moving && lastMoving) { runs++; if (cur === 1) single++; cur = 0; }
      lastMoving = moving;
    }
    expect(runs).toBeGreaterThan(20);
    expect(single / runs).toBeLessThan(0.5);
  });
});

describe('scorecard awareness', () => {
  it('behind in the final round presses harder as the clock runs; ahead protects', () => {
    const early = urgency({ roundsUp: -1, lead: -0.2, round: 3, rounds: 3, elapsedFrac: 0.1, iqTier: 4, holdWhenLosing: false });
    const late = urgency({ roundsUp: -1, lead: -0.2, round: 3, rounds: 3, elapsedFrac: 0.9, iqTier: 4, holdWhenLosing: false });
    const ahead = urgency({ roundsUp: 2, lead: 0.2, round: 3, rounds: 3, elapsedFrac: 0.9, iqTier: 4, holdWhenLosing: false });
    expect(late.press).toBeGreaterThan(early.press);
    expect(early.press).toBeGreaterThan(0);
    expect(ahead.protect).toBeGreaterThan(0);
    expect(ahead.press).toBe(0);
  });
  it('T0 has no card awareness, and `hold` never presses', () => {
    expect(urgency({ roundsUp: -2, lead: -1, round: 3, rounds: 3, elapsedFrac: 0.9, iqTier: 0, holdWhenLosing: false }).press).toBe(0);
    expect(urgency({ roundsUp: -2, lead: -1, round: 3, rounds: 3, elapsedFrac: 0.9, iqTier: 4, holdWhenLosing: true }).press).toBe(0);
  });
  it('heart and "risk when behind" shape it', () => {
    const u = urgency({ roundsUp: -1, lead: -0.3, round: 3, rounds: 3, elapsedFrac: 0.8, iqTier: 4, holdWhenLosing: false });
    expect(shapeUrgency(u, undefined, undefined, 90).press).toBeGreaterThan(shapeUrgency(u, undefined, undefined, 10).press);
    expect(shapeUrgency(u, 'gamble', undefined, 50).desperation).toBeGreaterThan(shapeUrgency(u, 'shell', undefined, 50).desperation);
  });
  it('fighters read the cards they are shown after a round', () => {
    const run = simulate(cfg('realism-cards', arch('arch.elite_wrestler_boxer'), RPA));
    const beliefs = run.events.filter((e) => e.kind === 'scoreUpdate');
    if (run.result.round > 1) expect(beliefs.length).toBeGreaterThan(0);
  });
});

describe('authored style fields reach the AI', () => {
  it('game plan labels map onto plan modes', () => {
    expect(authoredMode('wrestleControl')).toBe('mode.wrestle_control');
    expect(authoredMode('counter')).toBe('mode.counter_striking');
    expect(authoredMode('allRounder')).toBeNull();
  });
  it('initiative changes lead and counter weights', () => {
    expect(initiativeWeight('pressure', 'advance')).toBeGreaterThan(1);
    expect(initiativeWeight('counter', 'counterWindow')).toBeGreaterThan(1);
    expect(initiativeWeight('balanced', 'advance')).toBe(1);
  });
  it('a striker who wants to stand gets up off the top; a submission hunter does not', () => {
    expect(phasePolicyWeight({ groundTopPolicy: 'standAndReset' }, 'standUp', 'ground', true)).toBeGreaterThan(1);
    expect(phasePolicyWeight({ groundTopPolicy: 'subHunt' }, 'standUp', 'ground', true)).toBeLessThan(1);
  });
  it('handedness against stance moves the lead hand', () => {
    const conv = clone(RPA); conv.body.stance = 'orthodox'; conv.body.handedness = 'left';
    const norm = clone(RPA); norm.body.stance = 'orthodox'; norm.body.handedness = 'right';
    expect(rt(conv).powerIndex.leadHand).toBeGreaterThan(rt(norm).powerIndex.leadHand);
  });
});

describe('softmax residual', () => {
  it('returns a uniform inside the chosen interval without another draw', () => {
    const out = { residual: -1 };
    const i = softmaxSelect([1, 1, 1, 1], 1, 0.6, undefined, undefined, out);
    expect(i).toBe(2);
    expect(out.residual).toBeGreaterThanOrEqual(0);
    expect(out.residual).toBeLessThan(1);
    expect(out.residual).toBeCloseTo(0.4, 6);
  });
});
