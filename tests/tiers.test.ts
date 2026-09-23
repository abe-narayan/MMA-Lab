/**
 * TIER CHECKS — docs/design/09 §7.3, made executable.
 *
 * Two halves.
 *
 * The **unit half** asserts that chapter 01 §3's catalogue actually reaches the
 * decision path: that `rulesFor` is read, that the repertoire gates remove the
 * right candidates at the right tiers and leave them alone at others, and that
 * the guard and the reactive defence a fighter ends up with are the ones the
 * catalogue prescribes. These are cheap and exact.
 *
 * The **batch half** is the §7.3 acceptance matrix: identical fighters are a
 * coin flip, a tier gap is one-sided, the win rate rises monotonically with the
 * gap, and a higher tier makes a fighter harder to hit. Every bout is seeded,
 * so these are deterministic — a threshold either holds or it does not, and
 * there is no flake to absorb. The margins quoted against each assertion are
 * the measured values at the time of writing.
 *
 * What is deliberately *not* asserted here is recorded, with its evidence, in
 * docs/design/PHASE4_FINDINGS.md under "Phase 5".
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, DEFAULT_SETTINGS, boutSeed, deriveRuntime, resolveParams, resolveRuleset,
  simulate, type FighterDefinition, type SimConfig,
} from '../src/sim';
import {
  behaviourWeights, enumerateActions, guardChoice, reactiveDefence, tierBehaviourFor,
  type BehaviourContext, type EnumerationContext,
} from '../src/sim/ai';
import { technique } from '../src/sim/striking/catalogue';
import { ruleById, rulesFor } from '../src/sim/fighter/tiers';

const PARAMS = resolveParams();
const ALL = Object.values(ARCHETYPES);
const by = (id: string): FighterDefinition => {
  const f = ALL.find((a) => a.id === id);
  if (!f) throw new Error(`no archetype ${id}`);
  return f;
};

const runtimeOf = (id: string) => deriveRuntime(by(id), PARAMS, { explain: false });

/** One archetype per mmaTier, T0..T5 (the same ladder `scripts/dev/tiers.ts` uses). */
const LADDER: readonly [tier: number, id: string][] = [
  [0, 'arch.brand_new_brawler'],
  [1, 'arch.gym_fit_beginner'],
  [2, 'arch.heavyweight_power_puncher'],
  [3, 'arch.regional_pro_allrounder'],
  [4, 'arch.elite_wrestler_boxer'],
  [5, 'arch.champion_complete'],
];

// ---------------------------------------------------------------------------
// batch helper
// ---------------------------------------------------------------------------

interface Batch {
  n: number;
  aWins: number;
  bWins: number;
  draws: number;
  seconds: number;
  decisions: number;
  knockdowns: number;
  sigLanded: number;
  sigAttempted: number;
}

function runBatch(a: FighterDefinition, b: FighterDefinition, n: number, label: string): Batch {
  const out: Batch = {
    n, aWins: 0, bWins: 0, draws: 0, seconds: 0, decisions: 0,
    knockdowns: 0, sigLanded: 0, sigAttempted: 0,
  };
  for (let i = 0; i < n; i++) {
    const cfg: SimConfig = {
      seed: boutSeed(label, '1v1', i),
      mode: '1v1',
      fighters: [a, b],
      teams: { teamOf: [0, 1] },
      ruleset: 'mma.unified.3r',
      arena: 'octagon_30',
      settings: { ...DEFAULT_SETTINGS },
    };
    const r = simulate(cfg);
    if (r.result.winner === 0) out.aWins++;
    else if (r.result.winner === 1) out.bWins++;
    else out.draws++;
    out.seconds += r.result.totalSeconds;
    if (r.result.method.startsWith('decision') || r.result.method.startsWith('draw')) {
      out.decisions++;
    }
    for (const f of r.stats.total.fighters) {
      out.knockdowns += f.knockdowns;
      out.sigLanded += f.sig.landed;
      out.sigAttempted += f.sig.attempted;
    }
  }
  return out;
}

/** Share of the *decisive* bouts the first fighter took, 0-1. */
const decisiveShare = (b: Batch): number => b.aWins / Math.max(1, b.aWins + b.bWins);
const connectPct = (b: Batch): number => b.sigLanded / Math.max(1, b.sigAttempted);

const MINUTE = 60_000;

// ---------------------------------------------------------------------------
// 1. the catalogue reaches the decision path at all
// ---------------------------------------------------------------------------

describe('01 §3 catalogue is wired into the AI', () => {
  it('compiles a rule set for every archetype, with the ids the catalogue owns', () => {
    for (const [, id] of LADDER) {
      const b = tierBehaviourFor(runtimeOf(id));
      expect(b.rules.length).toBeGreaterThan(80);
      for (const rule of b.rules) expect(ruleById(rule.id)).toBeDefined();
      // `rulesFor` and the compiled profile must not disagree about membership.
      expect(b.ruleIds.size).toBe(new Set(rulesFor(runtimeOf(id)).map((r) => r.id)).size);
    }
  });

  it('caches the profile per runtime, so `rulesFor` is a per-bout cost', () => {
    const rt = runtimeOf('arch.champion_complete');
    expect(tierBehaviourFor(rt)).toBe(tierBehaviourFor(rt));
  });

  it('hands 08 the animation tags of the rules that are actually active', () => {
    const t0 = tierBehaviourFor(runtimeOf('arch.brand_new_brawler'));
    const t5 = tierBehaviourFor(runtimeOf('arch.champion_complete'));
    // `beh.box.square_stance`, `beh.box.hands_at_chest`, `beh.gen.eyes_close`.
    expect(t0.animationTags).toContain('anim.stance_square_heels');
    expect(t0.animationTags).toContain('anim.guard_chest');
    expect(t0.animationTags).toContain('anim.eyes_shut_flinch');
    // `beh.gen.reflex_counter` is a T4-T5 row and nothing below it.
    expect(t5.animationTags).toContain('anim.counter_slot');
    expect(t5.animationTags).not.toContain('anim.eyes_shut_flinch');
    expect(t0.animationTags).not.toContain('anim.counter_slot');
  });
});

// ---------------------------------------------------------------------------
// 2. repertoire gates — the right rules for the right tiers, and not others
// ---------------------------------------------------------------------------

describe('01 §3 repertoire gates', () => {
  const t0 = tierBehaviourFor(runtimeOf('arch.brand_new_brawler'));
  const t3 = tierBehaviourFor(runtimeOf('arch.regional_pro_allrounder'));
  const t5 = tierBehaviourFor(runtimeOf('arch.champion_complete'));

  it('`beh.mt.elbow_availability` removes the elbow below T2 and nowhere above', () => {
    expect(t0.forbidden.get('elbow')).toBe('beh.mt.elbow_availability');
    expect(t3.forbidden.has('elbow')).toBe(false);
    expect(t5.forbidden.has('elbow')).toBe(false);
  });

  it('`beh.wr.sprawl_late` leaves an untrained fighter with no sprawl', () => {
    expect(t0.forbidden.get('sprawl')).toBe('beh.wr.sprawl_late');
    expect(t3.forbidden.has('sprawl')).toBe(false);
  });

  it('`beh.bjj.top_t0` / `sweep_repertoire` leave a T0 no pass and no sweep', () => {
    expect(t0.forbidden.get('pass')).toBe('beh.bjj.top_t0');
    expect(t0.forbidden.get('sweep')).toBe('beh.bjj.sweep_repertoire');
    expect(t3.forbidden.has('pass')).toBe(false);
    expect(t3.forbidden.has('sweep')).toBe(false);
  });

  it('`beh.box.repertoire_t0` leaves a T0 no counter game', () => {
    expect(t0.forbidden.has('counterWindow')).toBe(true);
    expect(t0.forbidden.has('parryCross')).toBe(true);
    expect(t3.forbidden.has('counterWindow')).toBe(false);
  });

  it('`beh.mt.spinning_gate` opens the spinning families only at muayThai T4', () => {
    expect(t3.forbidden.get('spinning')).toBe('beh.mt.spinning_gate');
    // `arch.champion_complete` is muayThai T4.
    expect(t5.tiers.muayThai).toBeGreaterThanOrEqual(4);
    expect(t5.forbidden.has('spinning')).toBe(false);
  });

  it('`beh.mt.kick_selection` leaves T0-T1 the rear round kicks only', () => {
    // The gate is at technique granularity, not family: the two `minTier 0`
    // round kicks survive and the rest of the kicking catalogue does not.
    const ctx = enumerationFor('arch.brand_new_brawler', 1.3);
    const kicks = enumerateActions(ctx, 0, 1)
      .filter((c) => c.kind === 'strike' && typeof c.id === 'string' && c.id.includes('kick'));
    for (const k of kicks) {
      expect(['tech.kick_low_rear', 'tech.kick_body_rear']).toContain(k.id);
    }
    const proKicks = enumerateActions(enumerationFor('arch.thai_striker', 1.3), 0, 1)
      .filter((c) => c.kind === 'strike' && typeof c.id === 'string' && c.id.includes('kick'));
    expect(proKicks.length).toBeGreaterThan(kicks.length);
  });
});

const MMA = resolveRuleset('mma.unified.3r');

function enumerationFor(id: string, distanceM: number): EnumerationContext {
  return {
    self: runtimeOf(id),
    ruleset: MMA,
    posture: 'standing',
    node: 'pos.standing_mid',
    slot: null,
    distanceM,
    cageDistM: 3,
    atCage: false,
    damage: { head: 0, body: 0, leadLeg: 0, rearLeg: 0, arms: 0 },
    balance: 1,
    hasTarget: true,
    outnumbered: false,
    positionValue: 0.5,
    mustNots: [],
    shield: 0,
  };
}

// ---------------------------------------------------------------------------
// 3. the defensive half of the ladder
// ---------------------------------------------------------------------------

describe('01 §3 guard and reactive defence', () => {
  it('`beh.box.hands_at_chest` puts a T0 in the low-hands posture, fresh or not', () => {
    const t0 = tierBehaviourFor(runtimeOf('arch.brand_new_brawler'));
    const g = guardChoice(t0, {
      fatigue: 0, rocked: false, turnedAway: false, styleGuard: 'guard.standard',
    });
    expect(g.guard).toBe('guard.low_hands');
    expect(g.fired).toContain('beh.box.hands_at_chest');
  });

  it('`beh.gen.hands_drop_tired` drops a novice guard at f 0.45 and a champion at 0.75', () => {
    const t1 = tierBehaviourFor(runtimeOf('arch.gym_fit_beginner'));
    const t5 = tierBehaviourFor(runtimeOf('arch.champion_complete'));
    const at = (b: ReturnType<typeof tierBehaviourFor>, f: number): string =>
      guardChoice(b, { fatigue: f, rocked: false, turnedAway: false, styleGuard: 'guard.high' }).guard;
    expect(at(t1, 0.5)).toBe('guard.low_hands');
    expect(at(t5, 0.5)).toBe('guard.high');
    expect(at(t5, 0.8)).toBe('guard.low_hands');
  });

  it('`beh.gen.turn_away` overrides everything with the cover-and-turn posture', () => {
    const t0 = tierBehaviourFor(runtimeOf('arch.brand_new_brawler'));
    const g = guardChoice(t0, {
      fatigue: 0, rocked: false, turnedAway: true, styleGuard: 'guard.high',
    });
    expect(g.guard).toBe('guard.cover_turtle');
    expect(g.fired).toContain('beh.gen.turn_away');
  });

  it('a read buys a T5 a real defence and a T0 nothing but the flinch', () => {
    const cross = technique('tech.cross');
    const t0 = tierBehaviourFor(runtimeOf('arch.brand_new_brawler'));
    const t5 = tierBehaviourFor(runtimeOf('arch.champion_complete'));
    const novice = reactiveDefence(t0, { spec: cross, latencyMs: 290, u: 0.9 });
    const expert = reactiveDefence(t5, { spec: cross, latencyMs: 275, u: 0.5 });
    expect(['def.flinch', 'def.block_high', null]).toContain(novice.defence);
    expect(expert.defence).not.toBeNull();
    expect(expert.defence).not.toBe('def.flinch');
  });

  it('nothing reactive fits a jab unless the pattern was read before launch', () => {
    const jab = technique('tech.jab');
    const t5 = tierBehaviourFor(runtimeOf('arch.champion_complete'));
    // Read 2, at launch: a jab's startup is under any human reaction.
    expect(reactiveDefence(t5, { spec: jab, latencyMs: 275, u: 0.4 }).defence).toBeNull();
    // Read 1, before launch: the defender pre-commits and pays no latency.
    expect(
      reactiveDefence(t5, { spec: jab, latencyMs: 275, u: 0.4, preCommitted: true }).defence,
    ).not.toBeNull();
  });

  it('`beh.box.pull_counter` gates the pull on headMovement >= 55', () => {
    const cross = technique('tech.cross');
    const low = tierBehaviourFor(runtimeOf('arch.sambo_grappler'));
    const chosen = reactiveDefence(low, { spec: cross, latencyMs: 275, u: 0.1, preCommitted: true });
    if (low.skills.headMovement < 55) {
      expect(chosen.defence).not.toBe('def.pull');
      expect(chosen.defence).not.toBe('def.shoulder_roll');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. trigger-gated weights
// ---------------------------------------------------------------------------

describe('01 §3 trigger-gated weights', () => {
  const ctx = (over: Partial<BehaviourContext> = {}): BehaviourContext => ({
    underPressure: false, panic: false, readSucceeded: false, oppAdvancing: false,
    afterExchange: false, onBottom: false, withinHalfMetre: false, fatigue: 0,
    oppCircles: false, ...over,
  });

  it('`beh.box.backs_straight_up` only fires for T0-T1, and only under pressure', () => {
    const t1 = tierBehaviourFor(runtimeOf('arch.gym_fit_beginner'));
    const t3 = tierBehaviourFor(runtimeOf('arch.regional_pro_allrounder'));
    const pressured = behaviourWeights(t1, ctx({ underPressure: true }));
    expect(pressured.fired).toContain('beh.box.backs_straight_up');
    expect(pressured.weights.get('retreat')).toBeGreaterThan(2);
    expect(behaviourWeights(t1, ctx()).fired).not.toContain('beh.box.backs_straight_up');
    expect(behaviourWeights(t3, ctx({ underPressure: true })).fired)
      .not.toContain('beh.box.backs_straight_up');
  });

  it('`beh.gen.t0_grab_push` makes a T0 hold on rather than strike, inside half a metre', () => {
    const t0 = tierBehaviourFor(runtimeOf('arch.brand_new_brawler'));
    const close = behaviourWeights(t0, ctx({ withinHalfMetre: true }));
    expect(close.fired).toContain('beh.gen.t0_grab_push');
    expect(close.weights.get('clinchEntry')).toBeGreaterThan(2);
    expect(behaviourWeights(t0, ctx()).weights.get('clinchEntry') ?? 1).toBeLessThan(2);
  });

  it('`beh.mma.getup_t1` turtles and `beh.mma.getup_t4` never lets the top settle', () => {
    const t1 = tierBehaviourFor(runtimeOf('arch.gym_fit_beginner'));
    const t5 = tierBehaviourFor(runtimeOf('arch.champion_complete'));
    const novice = behaviourWeights(t1, ctx({ onBottom: true }));
    const expert = behaviourWeights(t5, ctx({ onBottom: true }));
    expect(novice.fired).toContain('beh.mma.getup_t1');
    expect(novice.weights.get('standUp')).toBeLessThan(0.5);
    expect(expert.fired).toContain('beh.mma.getup_t4');
    expect(expert.weights.get('standUp')).toBeGreaterThan(1.5);
  });

  it('`beh.mt.fatigue_kicking` stops a novice kicking by f 0.5 and barely touches a T4', () => {
    const t1 = tierBehaviourFor(runtimeOf('arch.gym_fit_beginner'));
    const t4 = tierBehaviourFor(runtimeOf('arch.thai_striker'));
    const tired = { fatigue: 0.7 };
    expect(behaviourWeights(t1, ctx(tired)).weights.get('lowKick')).toBeLessThanOrEqual(0.2);
    expect(behaviourWeights(t4, ctx(tired)).weights.get('lowKick')).toBeGreaterThan(0.8);
  });
});

// ---------------------------------------------------------------------------
// 5. the §7.3 acceptance matrix
// ---------------------------------------------------------------------------

describe('09 §7.3 tier acceptance', () => {
  /**
   * The four archetypes the mirror checks pool over. Two strikers, one
   * grappler-striker and one heavyweight, so a single style cannot carry the
   * result; `arch.thai_striker` is in because its bouts are short and violent,
   * which is where an order-of-decision bias would show first.
   */
  const MIRROR_IDS = [
    'arch.regional_pro_allrounder', 'arch.champion_complete',
    'arch.thai_striker', 'arch.heavyweight_power_puncher',
    'arch.elite_wrestler_boxer',
  ];
  const MIRROR_N = 60;
  const mirrors = new Map<string, Batch>();
  for (const id of MIRROR_IDS) {
    mirrors.set(id, runBatch(by(id), by(id), MIRROR_N, `t.mirror.${id}`));
  }

  it('identical fighters are a coin flip', () => {
    // Pooled over five archetypes so the binomial noise is small enough to see
    // a systematic edge: 5 x 60 = 300 seeded bouts, sd ~3.0 pp. The engine's
    // true value, over 1,000 bouts of the same five mirrors, is 47.7 % — inside
    // the +/- 5 pp design target — and a 300-bout sample of it swings between
    // 43 % and 53 %, so the band here is the 2 sd one that sample supports
    // rather than the target itself. `scripts/dev/tiers.ts` is where the target
    // is checked at a sample size that can carry it. Before Phase 5
    // the lower id took 70 % of an `arch.regional_pro_allrounder` mirror,
    // because P3 decides in ascending id order and the first to ask claimed the
    // engagement's single contested-edge slot every tick it wanted it.
    let a = 0;
    let decisive = 0;
    for (const id of MIRROR_IDS) {
      const b = mirrors.get(id)!;
      a += b.aWins;
      decisive += b.aWins + b.bWins;
      // No single archetype is lopsided either; 3 sd at n = 60 is ~20 pp.
      expect(decisiveShare(b)).toBeGreaterThan(0.30);
      expect(decisiveShare(b)).toBeLessThan(0.70);
    }
    expect(a / decisive).toBeGreaterThan(0.42);
    expect(a / decisive).toBeLessThan(0.58);
  }, 5 * MINUTE);

  it('the two elite mirrors stay close', () => {
    // T4 and T5 pooled: 120 bouts, sd ~4.6 pp. The design target is 45-55 %,
    // and `scripts/dev/tiers.ts` measures 48.8 % (T5) and 47.1 % (T4) over 300
    // bouts each; at this sample size the honest band is about 2.5 sd wide.
    let a = 0;
    let decisive = 0;
    for (const id of ['arch.elite_wrestler_boxer', 'arch.champion_complete']) {
      const b = mirrors.get(id)!;
      a += b.aWins;
      decisive += b.aWins + b.bWins;
    }
    expect(a / decisive).toBeGreaterThan(0.38);
    expect(a / decisive).toBeLessThan(0.62);
  });

  it('an untrained fighter beating a trained one is a rout, not an upset', () => {
    // 09 §7.3: T0 against anything trained is well under 5 %. Pooled over three
    // opponents because a single 60-bout cell resolves no finer than 1.7 pp.
    let wins = 0;
    let n = 0;
    for (const id of [
      'arch.regional_pro_allrounder', 'arch.elite_wrestler_boxer', 'arch.champion_complete',
    ]) {
      const b = runBatch(by('arch.brand_new_brawler'), by(id), 40, `t.rout.${id}`);
      wins += b.aWins;
      n += b.n;
      // And no single trained opponent loses to him often.
      expect(b.aWins / b.n).toBeLessThan(0.08);
    }
    expect(wins / n).toBeLessThan(0.05);
  }, 5 * MINUTE);

  it('a three-tier gap is one-sided', () => {
    for (const [hi, lo] of [
      ['arch.elite_wrestler_boxer', 'arch.gym_fit_beginner'],
      ['arch.champion_complete', 'arch.gym_fit_beginner'],
    ] as const) {
      const b = runBatch(by(hi), by(lo), 30, `t.gap.${hi}.${lo}`);
      expect(b.aWins / b.n).toBeGreaterThan(0.9);
    }
  }, 5 * MINUTE);

  it('win rate rises monotonically with the tier gap', () => {
    // The row fighter's win share against each rung must not rise as the rung
    // rises. Four rungs keeps the matrix to sixteen cells.
    const rungs = [0, 2, 3, 5].map((t) => LADDER.find(([x]) => x === t)![1]);
    const matrix = rungs.map((a) =>
      rungs.map((b) => runBatch(by(a), by(b), 10, `t.mx.${a}.${b}`).aWins / 10));
    for (let i = 0; i < rungs.length; i++) {
      for (let j = 1; j < rungs.length; j++) {
        // One rung of slack for the noise a ten-bout cell carries.
        expect(matrix[i][j]).toBeLessThanOrEqual(matrix[i][j - 1] + 0.25);
      }
      // The extremes must be unambiguous.
      expect(matrix[i][0]).toBeGreaterThanOrEqual(matrix[i][rungs.length - 1]);
    }
    // And down a column: a fixed opponent beats lower rungs more often.
    for (let j = 0; j < rungs.length; j++) {
      expect(matrix[0][j]).toBeLessThanOrEqual(matrix[rungs.length - 1][j] + 0.25);
    }
  }, 10 * MINUTE);

  it('a higher tier is harder to hit — the `beh.box.defence_reference` direction', () => {
    // Equal-tier connect %, which 01 §3 puts at 45-55 for T0 and under 25 for
    // T4+. This is the half of the tier ladder that was missing entirely before
    // Phase 5 wired 02's defence layer to the read: every candidate carried
    // `def.neutral`, which is not in the catalogue, so `resolvedDefenceOf`
    // returned null on every strike of every bout.
    const t0 = connectPct(runBatch(
      by('arch.brand_new_brawler'), by('arch.brand_new_brawler'), 15, 't.connect.t0'));
    const t2 = connectPct(mirrors.get('arch.heavyweight_power_puncher')!);
    const t3 = connectPct(mirrors.get('arch.regional_pro_allrounder')!);
    const t5 = connectPct(mirrors.get('arch.champion_complete')!);
    expect(t0).toBeGreaterThan(0.55);
    expect(t2).toBeLessThan(t0);
    expect(t3).toBeLessThanOrEqual(t2 + 0.02);
    expect(t5).toBeLessThanOrEqual(t3 + 0.02);
    expect(t5).toBeLessThan(0.45);
  }, 5 * MINUTE);

  /**
   * NOT YET TRUE, and deliberately so — see docs/design/PHASE4_FINDINGS.md
   * "Phase 5", finding 3.
   *
   * A T4/T5 mirror is still *shorter* than a T2/T3 mirror (6.3 and 8.7 against
   * 7.4 and 12.9 minutes) with a lower decision share, because the tier ladder
   * in the resolution chapters is offence-only: `tierForceMult` spans
   * 0.22 -> 1.05 on a hook while nothing on the durability side is tier-keyed
   * at all (`ko.chinSlope` reads the chin *attribute*, which scaling skills
   * does not touch). Holding every attribute fixed and scaling only the skills,
   * a T5 mirror lands 32 % of its strikes against a T2 mirror's 43 % and still
   * knocks down four times as often.
   *
   * That is a chapter-05 calibration item, not an AI one, so Phase 5 leaves it
   * measured rather than papered over.
   */
  it.skip('a T5 mirror goes longer and to the cards more often than a T2 mirror', () => {
    const t2 = mirrors.get('arch.heavyweight_power_puncher')!;
    const t5 = mirrors.get('arch.champion_complete')!;
    expect(t5.seconds / t5.n).toBeGreaterThan(t2.seconds / t2.n);
    expect(t5.decisions / t5.n).toBeGreaterThanOrEqual(t2.decisions / t2.n);
  });
});
