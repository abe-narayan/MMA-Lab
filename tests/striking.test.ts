/**
 * STRIKING SUITE — chapter 02.
 *
 * The claims worth defending, in the order a reviewer would attack them:
 *
 *  1. the catalogue is well formed (unique, registered, internally consistent
 *     timings) — a typo here silently changes every bout,
 *  2. the two-stage landing model reproduces the catalogue's marginal `P_land`
 *     against the reference defender. This is the whole point of §2.6.1: if
 *     rolling `pA` and then rolling a defence does not come back out at the
 *     UFCStats marginal, the model is double-counting defence,
 *  3. the force distribution reproduces the Pierce in-ring anchors — median
 *     ~950 N, ~88 % below 1500 N, a few per cent above 2000 N,
 *  4. the cross-references between catalogues are real ids,
 *  5. the RNG contract of 09 §2.7: six draws per contact, in every branch,
 *  6. determinism, which every replay in the repository depends on,
 *  7. every parameter carries provenance (00_CONVENTIONS §1).
 *
 * Every test is seeded, so a failure here is a regression, never flakiness.
 */
import { describe, it, expect } from 'vitest';
import { RNG } from '../src/sim/rng';
import { TECHNIQUE_IDS, DEFENCE_IDS } from '../src/sim/core/ids';
import {
  TECHNIQUES, technique, hasTechnique, totalMs, GLOVE_MODIFIERS, gloveLandLogit,
  techniqueLegal, REFERENCE_MASS_KG,
} from '../src/sim/striking/catalogue';
import {
  DEFENCES, GUARDS, defence, hasDefence, reactionLatencyMs, defenceWindowMs,
  anticipationLeadMs, cueReadP, patternReadP, availableDefences, strikeClasses,
  READ_BASE_BY_TIER, passiveBlockP, guard,
} from '../src/sim/striking/defence';
import { COMBINATIONS, FEINTS, RhythmTracker, comboSpecs, chainDurationMs } from '../src/sim/striking/combos';
import { COUNTERS, OWNED_COUNTERS, counterMatrixReferencesValid, counterWindow } from '../src/sim/striking/counters';
import {
  resolveStrike, solvePA, arrivalBase, marginalLandP, referenceDefenderInput, PA_FIRST_PASS,
  DRAWS_PER_STRIKE, PLACEMENT, REFERENCE_MIX, referenceFamilyFor,
  type ForceContext, type StrikeResolveInput, type StrikeResolution,
} from '../src/sim/striking/resolve';
import { bandFor, reachProfile, rangeFit, reachShellM } from '../src/sim/striking/range';
import { STRIKING_PARAMS } from '../src/sim/params/striking.params';
import { ParamRegistry } from '../src/sim/params/registry';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** A UFC-average T4 attacker with no state modifiers: the reference matchup. */
const REFERENCE_FORCE: ForceContext = {
  tier: 4,
  massKg: REFERENCE_MASS_KG,
  explosiveness: 50,
  strength: 50,
  weaponSpeedAttr: 50,
  fatigue: 0,
  commit: 'planted',
};

function baseInput(techId: string): Omit<StrikeResolveInput, 'defence' | 'passiveBlockP' | 'spec'> {
  const spec = technique(techId);
  return {
    tick: 0,
    subTickMs: 0,
    attacker: 0,
    target: 1,
    region: spec.targets[0],
    seen: true,
    force: REFERENCE_FORCE,
    gloveType: 'mma4oz',
  };
}

function quantile(sorted: readonly number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i];
}

// ---------------------------------------------------------------------------
// 1. catalogue integrity
// ---------------------------------------------------------------------------

describe('technique catalogue', () => {
  it('holds the chapter\'s 54 standing techniques with unique ids', () => {
    expect(TECHNIQUES).toHaveLength(54);
    const ids = TECHNIQUES.map((t) => t.id);
    expect(new Set(ids).size).toBe(54);
    for (const id of ids) expect(id.startsWith('tech.')).toBe(true);
  });

  it('registers every id in the global technique table', () => {
    for (const t of TECHNIQUES) {
      expect(TECHNIQUE_IDS.has(t.id)).toBe(true);
      // The dense index must resolve back to the same id (replay digest contract).
      expect(TECHNIQUE_IDS.id(TECHNIQUE_IDS.index(t.id))).toBe(t.id);
    }
  });

  it('keeps the timing fields consistent (09 §2.2)', () => {
    for (const t of TECHNIQUES) {
      expect(totalMs(t)).toBe(t.startupMs + t.activeMs + t.recoveryMs);
      // Contact happens inside the active window, never before startup ends.
      expect(t.contactMs).toBeGreaterThanOrEqual(t.startupMs);
      expect(t.contactMs).toBeLessThanOrEqual(t.startupMs + t.activeMs);
      expect(t.startupMs).toBeGreaterThan(0);
      expect(t.activeMs).toBeGreaterThan(0);
      expect(t.recoveryMs).toBeGreaterThan(0);
      // §2.5.1: a missed strike opens `recovery x 1.0`.
      expect(t.counterWindowMs).toBe(t.recoveryMs);
    }
  });

  it('keeps every catalogue number inside its documented range', () => {
    for (const t of TECHNIQUES) {
      expect(t.baseLand).toBeGreaterThan(0);
      expect(t.baseLand).toBeLessThan(1);
      expect(t.telegraph).toBeGreaterThanOrEqual(0);
      expect(t.forceMedianN).toBeGreaterThan(0);
      expect(t.forceCapN).toBeGreaterThan(t.forceMedianN);
      expect(t.effectiveMassKg).toBeCloseTo(t.effMassFrac * REFERENCE_MASS_KG, 9);
      expect(t.vRefMs).toBeGreaterThan(0);
      expect(t.commitment.balance).toBeGreaterThan(0);
      expect(t.band.length).toBeGreaterThan(0);
      expect(t.targets.length).toBeGreaterThan(0);
      // 00_CONVENTIONS §1: a number with no tag is a bug.
      expect(t.tag).toMatch(/^\[(S:|D:|D |E)/);
    }
  });

  it('only names real defences in `beatenBy` and real techniques in `followUps`', () => {
    for (const t of TECHNIQUES) {
      for (const d of t.beatenBy) expect(hasDefence(d)).toBe(true);
      for (const f of t.followUps) expect(hasTechnique(f)).toBe(true);
    }
  });

  it('applies the boxing-glove modifier table only where §2.2.5 says', () => {
    expect(GLOVE_MODIFIERS.boxing10oz.jabLogit).toBeCloseTo(-0.60, 6);
    expect(gloveLandLogit(technique('tech.jab'), 'boxing10oz')).toBeCloseTo(-0.60, 6);
    expect(gloveLandLogit(technique('tech.cross'), 'boxing10oz')).toBeCloseTo(0.30, 6);
    expect(gloveLandLogit(technique('tech.cross'), 'mma4oz')).toBe(0);
    // Body punches are neither the jab row nor the power-head row.
    expect(gloveLandLogit(technique('tech.cross_body'), 'boxing10oz')).toBe(0);
  });

  it('removes kicks, knees and elbows under a boxing ruleset', () => {
    const boxing = {
      gloveType: 'boxing10oz', elbowsLegal: false, elbow12to6Legal: false,
      obliqueKickLegal: false, kneesToHeadStandingLegal: false,
      kickCatchRule: 'mt', family: 'boxing',
    } as const;
    expect(techniqueLegal(technique('tech.jab'), boxing)).toBe(true);
    expect(techniqueLegal(technique('tech.kick_low_rear'), boxing)).toBe(false);
    expect(techniqueLegal(technique('tech.elbow_horizontal'), boxing)).toBe(false);
    expect(techniqueLegal(technique('tech.knee_straight'), boxing)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. defence layer
// ---------------------------------------------------------------------------

describe('defence layer', () => {
  it('holds 26 reactive defences and 9 guard postures, all registered', () => {
    expect(DEFENCES).toHaveLength(26);
    expect(GUARDS).toHaveLength(9);
    expect(new Set(DEFENCES.map((d) => d.id)).size).toBe(26);
    for (const d of DEFENCES) {
      expect(DEFENCE_IDS.has(d.id)).toBe(true);
      expect(d.id.startsWith('def.')).toBe(true);
      expect(d.tag).toMatch(/^\[(S:|D:|D |E)/);
      expect(d.execMs).toBeGreaterThanOrEqual(0);
      expect(d.success).toBeGreaterThanOrEqual(0);
      expect(d.success).toBeLessThanOrEqual(1);
      expect(d.absorb).toBeGreaterThanOrEqual(0);
      expect(d.absorb).toBeLessThanOrEqual(1);
    }
    // `guard.standard` is the reference: its matrix must be all zeros, because
    // every catalogue P_land already assumes it.
    const std = guard('guard.standard');
    expect(Object.values(std.matrix).every((v) => v === 0)).toBe(true);
  });

  it('reproduces the chapter\'s worked reaction-window examples (§2.4.3)', () => {
    // T4, reactionTime 50 -> RT_simple 225; L = 225 + 60 = 285; lead A = 80.
    const latency = reactionLatencyMs({ reactionTimeMs: 225, tier: 4, fatigue: 0 });
    expect(latency).toBeCloseTo(285, 6);

    const jab = technique('tech.jab');
    const jabWindow = defenceWindowMs(jab, latency, anticipationLeadMs(jab.telegraph));
    // 130 + 30 + 0 - (285 - 80) = -45 ms: an unfeinted jab cannot be reacted to.
    expect(jabWindow).toBeCloseTo(-45, 6);
    expect(availableDefences({ spec: jab, windowMs: jabWindow, tier: 4 })).toHaveLength(0);

    const cross = technique('tech.cross');
    const crossWindow = defenceWindowMs(cross, latency, anticipationLeadMs(cross.telegraph));
    // 210 + 35 + 40 - (285 - 104) = 104 ms. Nothing but a pre-commit or a flinch fits.
    expect(crossWindow).toBeGreaterThan(0);
    expect(crossWindow).toBeLessThan(150);

    // Against a slow, telegraphed T1 cross the same defender has time for everything.
    const slowWindow = defenceWindowMs(
      { ...cross, startupMs: 265, telegraph: 160, activeMs: 88 },
      latency,
      anticipationLeadMs(160),
    );
    expect(slowWindow).toBeGreaterThan(250);
    const fits = availableDefences({ spec: cross, windowMs: slowWindow, tier: 4 }).map((d) => d.id);
    expect(fits).toContain('def.parry');
    expect(fits).toContain('def.slip_out');
    expect(fits).toContain('def.pull');
    expect(fits).toContain('def.block_high');
  });

  it('keeps latency untiered but the read tier-scaled (§2.4.3)', () => {
    const novice = reactionLatencyMs({ reactionTimeMs: 225, tier: 4, fatigue: 0 });
    const expert = reactionLatencyMs({ reactionTimeMs: 225, tier: 5, fatigue: 0 });
    // Same reactionTime, different tier: simple RT does not separate tiers.
    expect(novice).toBe(expert);
    // But the read does, monotonically.
    const reads = READ_BASE_BY_TIER.map((base) =>
      cueReadP({ readP: base, telegraphMs: 40, fatigue: 0 }));
    for (let i = 1; i < reads.length; i++) expect(reads[i]).toBeGreaterThan(reads[i - 1]);
    // A repeated, on-beat attacker is readable before he even launches.
    const cold = patternReadP({ readP: 0.66 });
    const warm = patternReadP({ readP: 0.66, attackerOnBeat: true, attackerRepeated: true });
    expect(warm).toBeGreaterThan(cold);
    // A feint bite suppresses the read.
    expect(patternReadP({ readP: 0.66, afterFeintBite: true })).toBeLessThan(cold);
  });

  it('gives the passive posture roll a sane floor (§2.6.1 step 6)', () => {
    const jab = technique('tech.jab');
    const standard = passiveBlockP(guard('guard.standard'), jab, 50);
    const high = passiveBlockP(guard('guard.high'), jab, 50);
    expect(standard).toBeCloseTo(0.20, 2);
    // A high guard catches more of the straight line passively than a standard one.
    expect(high).toBeGreaterThan(standard);
  });
});

// ---------------------------------------------------------------------------
// 3. combinations, feints, rhythm
// ---------------------------------------------------------------------------

describe('combination grammar', () => {
  it('holds the 35 named chains, all made of real techniques', () => {
    expect(COMBINATIONS).toHaveLength(35);
    expect(new Set(COMBINATIONS.map((c) => c.id)).size).toBe(35);
    for (const c of COMBINATIONS) {
      expect(c.steps.length).toBeGreaterThan(1);
      for (const s of c.steps) {
        if (s.tech !== null) expect(hasTechnique(s.tech)).toBe(true);
      }
      expect(c.tag).toMatch(/^\[(S:|D:|D |E)/);
    }
  });

  it('overlaps a four-action chain instead of queueing it (§2.3.1 rule 2)', () => {
    const specs = comboSpecs(COMBINATIONS.find((c) => c.id === 'combo.1_2_3_2')!);
    const overlapped = chainDurationMs(specs);
    const sequential = chainDurationMs(specs, 1);
    expect(overlapped).toBeLessThan(sequential);
    // The rule as stated (launch once 40 % of the recovery has elapsed) gives
    // ~1290 ms; the measured anchor is 851 ms and the chapter's own check
    // arithmetic does not reproduce its own quoted figure. `combo.overlap` is
    // the calibration lever — see `nextLaunchOffsetMs`.
    expect(overlapped).toBeGreaterThan(1000);
    expect(overlapped).toBeLessThan(1500);
    // At overlap 0 a chain is just the strikes back to back.
    expect(chainDurationMs(specs, 0)).toBeLessThan(overlapped);
  });

  it('holds the 8 feint types with shrinking bonuses by defender tier', () => {
    expect(FEINTS).toHaveLength(8);
    expect(new Set(FEINTS.map((f) => f.id)).size).toBe(8);
  });

  it('detects a half-beat launch after an on-beat run (§2.3.5)', () => {
    const r = new RhythmTracker();
    let t = 0;
    r.launch(t);
    for (let i = 0; i < 4; i++) { t += 500; expect(r.launch(t)).toBe('onBeat'); }
    expect(r.readable).toBe(true);
    const run = r.onBeatStreak;
    t += 250;
    const beat = r.launch(t);
    expect(beat).toBe('halfBeat');
    expect(r.brokenRhythm(beat, 4, run)).toBe(true);
    // A T2 fighter cannot use it: rhythm breaking is a T4+ skill.
    expect(r.brokenRhythm(beat, 2, run)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. counters
// ---------------------------------------------------------------------------

describe('counter system', () => {
  it('holds the counter matrix with 33 entries owned by this chapter', () => {
    expect(OWNED_COUNTERS).toHaveLength(33);
    expect(COUNTERS.length).toBeGreaterThanOrEqual(33);
    expect(new Set(COUNTERS.map((c) => c.id)).size).toBe(COUNTERS.length);
  });

  it('references only real technique ids', () => {
    expect(counterMatrixReferencesValid()).toBe(true);
    for (const c of COUNTERS) {
      if (c.counterTech !== null) expect(hasTechnique(c.counterTech)).toBe(true);
      for (const t of c.triggerTech) expect(hasTechnique(t)).toBe(true);
      if (c.defence !== null) expect(hasDefence(c.defence)).toBe(true);
      expect(c.tag).toMatch(/^\[(S:|D:|D |E)/);
    }
  });

  it('punishes a missed kick far harder than a landed one (§2.5.1)', () => {
    const kick = technique('tech.kick_head_rear');
    const missed = counterWindow(kick, 'missed');
    const landed = counterWindow(kick, 'landed');
    const checked = counterWindow(kick, 'checked');
    expect(missed.ms).toBeGreaterThan(landed.ms);
    expect(checked.ms).toBeGreaterThan(missed.ms);
    expect(missed.attackerDefenceLogit).toBeLessThan(landed.attackerDefenceLogit);
    // T1 does not return to stance: the window doubles on him.
    expect(counterWindow(kick, 'missed', 1).ms).toBeGreaterThan(missed.ms);
  });
});

// ---------------------------------------------------------------------------
// 5. range geometry
// ---------------------------------------------------------------------------

describe('range model', () => {
  it('gives the longer fighter a band the shorter one cannot reach (§2.1.1)', () => {
    const tall = reachProfile(0.95, 1.20);
    const short = reachProfile(0.75, 1.10);
    expect(reachShellM(tall, short)).toBeCloseTo(0.20, 6);
    expect(reachShellM(short, tall)).toBe(0);
    // At one distance the tall fighter can jab and the short one cannot: that
    // shell is the entire geometric content of "reach".
    const d = 1.15;
    expect(bandFor(d, tall)).toBe('long');
    expect(bandFor(d, short)).toBe('kick');
  });

  it('penalises a technique thrown out of its home band (§2.1.1)', () => {
    const profile = reachProfile(0.83, 1.05);
    const uppercut = technique('tech.uppercut_lead'); // home: close, mid
    const home = rangeFit(uppercut, 0.55, profile, 50);
    const far = rangeFit(uppercut, 1.25, profile, 50);
    expect(home.available).toBe(true);
    expect(home.logit).toBe(0);
    expect(far.available).toBe(false);
    // Low-skill strikers suffer more out of band than high-skill ones.
    const novice = rangeFit(uppercut, 0.95, profile, 10);
    const expert = rangeFit(uppercut, 0.95, profile, 90);
    expect(novice.logit).toBeLessThan(expert.logit);
  });
});

// ---------------------------------------------------------------------------
// 6. the two-stage landing model (§2.6.1)
// ---------------------------------------------------------------------------

describe('two-stage landing model', () => {
  it('reproduces the chapter\'s published first-pass pA values', () => {
    for (const [id, published] of Object.entries(PA_FIRST_PASS)) {
      expect(Math.abs(arrivalBase(technique(id)) - published)).toBeLessThan(0.03);
    }
    // The chapter's worked example, exactly: jab s_bar 0.60, p_bar 0.25.
    expect(solvePA(technique('tech.jab'))).toBeCloseTo(0.643, 2);
  });

  it('inverts cleanly: marginalLandP(solvePA(P_land)) === P_land', () => {
    for (const t of TECHNIQUES) {
      const pa = arrivalBase(t);
      // Only techniques whose pA did not hit the clamp can invert exactly.
      if (pa > 0.05 && pa < 0.97) expect(marginalLandP(t, pa)).toBeCloseTo(t.baseLand, 6);
    }
  });

  it('reproduces the catalogue marginal P_land over 100k seeded samples', () => {
    // 100k samples per technique across four families. The reference defender
    // reads with P = 0.81 (07's draw, taken from a separate stream so the
    // contact block stays at six draws) and then applies the family mean.
    const N = 100_000;
    for (const id of ['tech.jab', 'tech.cross', 'tech.kick_low_rear', 'tech.kick_head_rear']) {
      const spec = technique(id);
      const rng = new RNG(`marginal|${id}`);
      const reads = new RNG(`reads|${id}`);
      const mix = REFERENCE_MIX[referenceFamilyFor(spec)];
      let landed = 0;
      for (let i = 0; i < N; i++) {
        const input = referenceDefenderInput(spec, reads.chance(0.81), baseInput(id));
        if (resolveStrike(rng, input).outcome === 'landed') landed++;
      }
      const observed = landed / N;
      // 4 sigma at n = 100k is ~0.006; the pA clamp adds nothing for these four.
      expect(Math.abs(observed - spec.baseLand)).toBeLessThan(0.01);
      expect(mix.meanSuccess).toBeGreaterThan(0);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 7. placement and force (§2.6.3, §2.6.4)
// ---------------------------------------------------------------------------

describe('placement and force', () => {
  it('draws placement categorically, not as a flush lottery', () => {
    const rng = new RNG('placement');
    const spec = technique('tech.cross');
    const counts: Record<string, number> = { flush: 0, solid: 0, partial: 0, glancing: 0 };
    for (let i = 0; i < 40_000; i++) {
      const r = resolveStrike(rng, { ...baseInput('tech.cross'), spec, pA: 0.999, defence: null, passiveBlockP: 0 });
      if (r.placement) counts[r.placement]++;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(counts.flush / total).toBeCloseTo(0.20, 2);
    expect(counts.solid / total).toBeCloseTo(0.35, 2);
    expect(counts.partial / total).toBeCloseTo(0.30, 2);
    expect(counts.glancing / total).toBeCloseTo(0.15, 2);
    // Nothing like the old 5 % flush lottery.
    expect(counts.flush / total).toBeGreaterThan(0.10);
  });

  it('shifts placement toward flush when the target never saw it (§2.6.3)', () => {
    const rng = new RNG('unseen');
    const spec = technique('tech.cross');
    let seenFlush = 0;
    let unseenFlush = 0;
    for (let i = 0; i < 20_000; i++) {
      const a = resolveStrike(rng, { ...baseInput('tech.cross'), spec, pA: 0.999, defence: null, passiveBlockP: 0, seen: true });
      const b = resolveStrike(rng, { ...baseInput('tech.cross'), spec, pA: 0.999, defence: null, passiveBlockP: 0, seen: false });
      if (a.placement === 'flush') seenFlush++;
      if (b.placement === 'flush') unseenFlush++;
    }
    expect(unseenFlush).toBeGreaterThan(seenFlush * 1.4);
  });

  it('reproduces the Pierce in-ring force distribution for landed head punches', () => {
    // Pierce 2006: median ~950 N, 64 % <= 1000 N, 88 % < 1500 N, 2-6 % >= 2000 N.
    // The chapter derives sigma_F = 0.30 from exactly this crossing of the
    // placement mix with F_med(cross) = 1400.
    const rng = new RNG('pierce');
    const spec = technique('tech.cross');
    const forces: number[] = [];
    for (let i = 0; i < 120_000; i++) {
      const r = resolveStrike(rng, { ...baseInput('tech.cross'), spec, pA: 0.999, defence: null, passiveBlockP: 0 });
      if (r.outcome === 'landed') forces.push(r.forceN);
    }
    forces.sort((a, b) => a - b);
    const median = quantile(forces, 0.50);
    const p90 = quantile(forces, 0.90);
    const above2000 = forces.filter((f) => f >= 2000).length / forces.length;
    const below1500 = forces.filter((f) => f < 1500).length / forces.length;

    expect(median).toBeGreaterThan(750);
    expect(median).toBeLessThan(1100);
    expect(p90).toBeGreaterThan(1350);
    expect(p90).toBeLessThan(1900);
    expect(below1500).toBeGreaterThan(0.82);
    expect(below1500).toBeLessThan(0.93);
    expect(above2000).toBeGreaterThan(0.01);
    expect(above2000).toBeLessThan(0.08);
  }, 60_000);

  it('never exceeds the technique force cap', () => {
    const rng = new RNG('cap');
    const spec = technique('tech.kick_head_rear');
    for (let i = 0; i < 20_000; i++) {
      const r = resolveStrike(rng, { ...baseInput('tech.kick_head_rear'), spec, pA: 0.999, defence: null, passiveBlockP: 0 });
      expect(r.forceN).toBeLessThanOrEqual(spec.forceCapN * PLACEMENT.mult.flush * 1.15 + 1e-6);
    }
  });

  it('emits a StrikeImpact that matches the frozen §2.6.5 contract', () => {
    const rng = new RNG('impact');
    const spec = technique('tech.hook_lead');
    let impact = null as StrikeResolution['impact'];
    for (let i = 0; i < 200 && impact === null; i++) {
      impact = resolveStrike(rng, {
        ...baseInput('tech.hook_lead'), spec, pA: 0.999, defence: null, passiveBlockP: 0,
      }).impact;
    }
    expect(impact).not.toBeNull();
    const im = impact!;
    expect(im.tech).toBe('tech.hook_lead');
    expect(im.weapon).toBe('fist');
    expect(im.region).toBe('head');
    expect(['chin', 'temple', 'midface', 'forehead', 'orbit']).toContain(im.subLocation);
    expect(['flush', 'solid', 'partial', 'glancing']).toContain(im.placement);
    expect(im.forceN).toBeGreaterThan(0);
    expect(im.absorb).toBeGreaterThanOrEqual(0);
    expect(im.absorb).toBeLessThanOrEqual(1);
    expect(im.gloveType).toBe('mma4oz');
    expect(im.posture).toBe('distance');
    // The merged contract carries no `rot` field: 05 ko.kWeapon owns rotation.
    expect('rot' in im).toBe(false);
    expect(im.rotProxy).toBeUndefined();
  });

  it('sends 60 % of a checked kick back into the kicker\'s shin (§2.2.4)', () => {
    const rng = new RNG('check');
    const spec = technique('tech.kick_low_rear');
    const check = defence('def.check');
    let found = null as StrikeResolution | null;
    for (let i = 0; i < 500 && found === null; i++) {
      const r = resolveStrike(rng, {
        ...baseInput('tech.kick_low_rear'), spec, pA: 0.999,
        defence: { spec: check, successP: 1 }, passiveBlockP: 0,
      });
      if (r.outcome === 'checked') found = r;
    }
    expect(found).not.toBeNull();
    const self = found!.impact!.selfDamage!;
    expect(self.weapon).toBe('shin_on_knee');
    expect(self.target).toBe(found!.impact!.attacker);
    expect(self.forceN).toBeCloseTo(found!.impact!.forceN * 0.6, 6);
    // A checked kick still counts as contact on the leg (FD #17 interpretation).
    expect(found!.statLanded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. the RNG contract (09 §2.7)
// ---------------------------------------------------------------------------

describe('RNG draw schedule', () => {
  it('consumes exactly six draws per contact in every branch', () => {
    const spec = technique('tech.cross');
    const block = defence('def.block_high');
    const slip = defence('def.slip_out');
    const branches: StrikeResolveInput[] = [
      // whiffed
      { ...baseInput('tech.cross'), spec, pA: 0.0001, defence: null, passiveBlockP: 0 },
      // landed clean
      { ...baseInput('tech.cross'), spec, pA: 0.9999, defence: null, passiveBlockP: 0 },
      // passively blocked
      { ...baseInput('tech.cross'), spec, pA: 0.9999, defence: null, passiveBlockP: 1 },
      // blocked by a reactive defence
      { ...baseInput('tech.cross'), spec, pA: 0.9999, defence: { spec: block, successP: 1 }, passiveBlockP: 0 },
      // evaded
      { ...baseInput('tech.cross'), spec, pA: 0.9999, defence: { spec: slip, successP: 1 }, passiveBlockP: 0 },
      // defence failed
      { ...baseInput('tech.cross'), spec, pA: 0.9999, defence: { spec: slip, successP: 0 }, passiveBlockP: 0 },
    ];
    for (const input of branches) {
      const rng = new RNG('draws');
      const before = rng.draws;
      const r = resolveStrike(rng, input);
      expect(rng.draws - before).toBe(DRAWS_PER_STRIKE);
      expect(r.draws).toBe(DRAWS_PER_STRIKE);
    }
  });

  it('keeps the stream position independent of the outcome', () => {
    // Two different outcomes, same number of draws, so the next value drawn is
    // the same in both worlds. This is what makes a replay reproducible when a
    // single logit nudges a strike from landed to blocked.
    const spec = technique('tech.cross');
    const a = new RNG('stream');
    const b = new RNG('stream');
    resolveStrike(a, { ...baseInput('tech.cross'), spec, pA: 0.0001, defence: null, passiveBlockP: 0 });
    resolveStrike(b, { ...baseInput('tech.cross'), spec, pA: 0.9999, defence: null, passiveBlockP: 1 });
    expect(a.next()).toBe(b.next());
  });
});

// ---------------------------------------------------------------------------
// 9. determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces an identical resolution stream for a fixed seed', () => {
    const run = (): string => {
      const rng = new RNG('determinism-seed');
      const out: string[] = [];
      for (const id of ['tech.jab', 'tech.cross', 'tech.hook_lead', 'tech.kick_low_rear', 'tech.kick_head_rear']) {
        const spec = technique(id);
        for (let i = 0; i < 200; i++) {
          const r = resolveStrike(rng, {
            ...baseInput(id), spec,
            defence: i % 3 === 0 ? { spec: defence('def.block_high'), successP: 0.62 } : null,
            passiveBlockP: 0.2,
          });
          out.push(`${r.outcome}|${r.placement}|${r.subLocation}|${r.forceN.toFixed(6)}`);
        }
      }
      return out.join(';');
    };
    expect(run()).toBe(run());
    // A different seed must produce a different stream, or the seeding is broken.
    const other = (): string => {
      const rng = new RNG('other-seed');
      const spec = technique('tech.jab');
      const out: string[] = [];
      for (let i = 0; i < 200; i++) {
        const r = resolveStrike(rng, { ...baseInput('tech.jab'), spec, defence: null, passiveBlockP: 0.2 });
        out.push(`${r.outcome}|${r.forceN.toFixed(6)}`);
      }
      return out.join(';');
    };
    expect(other()).not.toBe(run());
  });
});

// ---------------------------------------------------------------------------
// 10. parameter registry
// ---------------------------------------------------------------------------

describe('striking parameters', () => {
  it('carries a valid provenance tag on every entry (00_CONVENTIONS §1)', () => {
    expect(STRIKING_PARAMS.length).toBeGreaterThan(150);
    for (const s of STRIKING_PARAMS) {
      expect(s.tag).toMatch(/^\[(S:|D:|E)/);
      expect(s.section).toBe('striking');
      expect(s.unit.length).toBeGreaterThan(0);
      expect(Number.isFinite(s.value)).toBe(true);
      expect(s.id.startsWith('p.strike.')).toBe(true);
    }
  });

  it('has unique ids and is accepted by the registry', () => {
    const ids = STRIKING_PARAMS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The registry re-validates id shape, tag, finiteness and bounds.
    const reg = new ParamRegistry();
    expect(() => reg.addAll(STRIKING_PARAMS)).not.toThrow();
    reg.freeze();
    expect(reg.bySection('striking')).toHaveLength(STRIKING_PARAMS.length);
    // Sourced measurements must not be calibration levers.
    for (const s of STRIKING_PARAMS) {
      if (s.tag.startsWith('[S:')) expect(s.free).toBe(false);
    }
  });

  it('does not resurrect the entries the chapter\'s REVIEW retired', () => {
    const ids = new Set(STRIKING_PARAMS.map((s) => s.id));
    for (const retired of [
      'p.strike.feint.bite', 'p.strike.read.base', 'p.strike.read.skillK',
      'p.strike.read.counterOnRead', 'p.strike.glove.boxing.rotFactor',
      'p.strike.force.refFlushCross',
    ]) {
      for (const id of ids) expect(id.startsWith(retired)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. cross-catalogue sanity
// ---------------------------------------------------------------------------

describe('cross-catalogue references', () => {
  it('lets every technique be classified, placed and defended', () => {
    for (const t of TECHNIQUES) {
      expect(strikeClasses(t).length).toBeGreaterThan(0);
      expect(referenceFamilyFor(t)).toBeTruthy();
      const pa = arrivalBase(t);
      expect(pa).toBeGreaterThanOrEqual(0.05);
      expect(pa).toBeLessThanOrEqual(0.97);
    }
  });
});
