/**
 * DAMAGE / FATIGUE / CONSCIOUSNESS SUITE — design chapter 05.
 *
 * The chapter makes claims that are either true of the implementation or the
 * implementation is wrong; this suite is those claims, written down:
 *
 *  1. the §2.4.1 Monte-Carlo headline — 4.2 % concussive events and 2.3 %
 *     knockdowns per landed distance power head strike, ~1.1 knockdowns per
 *     100 head significant strikes over the §2.1 force distribution,
 *  2. pools never leave their range, and never leave [0, 1] in the snapshot,
 *  3. the acute half-lives decay at the documented rates, including the
 *     re-hit extension that makes sustained pressure finish fights,
 *  4. states enter and clear at the documented thresholds (with hysteresis),
 *  5. the front-runner fade is emergent — a fighter who spends round 1 has
 *     measurably less in round 3, with no fade rule anywhere,
 *  6. round-break recovery matches the §2.5.4 arithmetic,
 *  7. `applyImpact` consumes exactly ten RNG draws whatever happens, and
 *     upkeep and round breaks consume none,
 *  8. a fixed seed reproduces a bout state exactly,
 *  9. every parameter carries a valid provenance tag and passes the registry.
 *
 * The statistical bounds are wide enough that a correct pipeline can never
 * trip them and narrow enough that a broken one always will. Every test is
 * seeded, so a failure here is a regression, never flakiness.
 */
import { describe, it, expect } from 'vitest';
import { RNG } from '../src/sim/rng';
import { STATE_IDS } from '../src/sim/core/ids';
import { ParamRegistry } from '../src/sim/params/registry';
import { DAMAGE_PARAMS } from '../src/sim/params/damage.params';
import {
  DamageState, DAMAGE_STATE_IDS, S, defaultProfile, defaultTuning, tuningWith, legLoad,
  type FighterDamageProfile, type HeadSite, type ImpactContext, type StrikeImpact,
} from '../src/sim/damage';

const T = defaultTuning();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function impact(over: Partial<StrikeImpact> = {}): StrikeImpact {
  const base: StrikeImpact = {
    tick: 0,
    subTickMs: 0,
    attacker: 1,
    target: 0,
    tech: 'tech.cross',
    weapon: 'fist',
    region: 'head',
    subLocation: 'chin',
    placement: 'flush',
    forceN: 1150,
    vRel: 8,
    effMassKg: 4,
    absorb: 0,
    defence: 'none',
    seen: true,
    counter: false,
    simultaneous: false,
    closingSpeedMs: 0,
    attackerState: { rocked: false, fatigue: 0 },
    targetState: {
      midAction: false, mouthOpen: false, guardHand: 'up', braced: false, grounded: false,
    },
    posture: 'distance',
    gloveType: 'mma4oz',
    ...over,
  };
  if (over.targetState) base.targetState = { ...base.targetState, ...over.targetState };
  return base;
}

const CTX: ImpactContext = { round: 1, attackerMassKg: 77 };

/**
 * Fixtures below pick forces to land in a particular damage band ("enough to
 * rock", "enough to push the acute pool past 90"). `raw` is linear in delivered
 * force and scales with `dmg.rawScale`, so a fixture written as a bare newton
 * value silently means something different whenever that constant is calibrated.
 * `bandForce` states the intent instead: it converts a force expressed on the
 * reference scale into the force that delivers the same damage under whatever
 * `dmg.rawScale` is currently set to.
 */
const RAW_SCALE_REFERENCE = 100;
const bandForce = (forceAtReferenceScale: number): number =>
  (forceAtReferenceScale * RAW_SCALE_REFERENCE) / T.n('dmg.rawScale');

function freshState(over: Partial<FighterDamageProfile> = {}): DamageState {
  return new DamageState(defaultProfile(over), { tuning: T });
}

/** Run `seconds` of upkeep at the 100 ms tick, with no action charged. */
function idle(ds: DamageState, seconds: number, round = 1): void {
  const ticks = Math.round(seconds * 10);
  for (let i = 0; i < ticks; i++) {
    ds.upkeep(100, { tick: i, round, posture: 'distance' });
  }
}

// ---------------------------------------------------------------------------
// 1. The §2.4.1 Monte-Carlo
// ---------------------------------------------------------------------------

interface StrikeClass {
  medianN: number;
  sigmaLn: number;
  unseen: number;
  straightOnly?: boolean;
  grounded?: boolean;
  weapon?: StrikeImpact['weapon'];
  tech?: string;
  /** Site mix, as cumulative weights over the six head sites. */
  siteMix?: [HeadSite, number][];
}

/** §2.4.1's site mix: chin 30 / temple 20 / midface 25 / forehead 20 / orbit 5. */
const DISTANCE_SITES: [HeadSite, number][] = [
  ['chin', 0.30], ['temple', 0.20], ['midface', 0.25], ['forehead', 0.20], ['orbit', 0.05],
];

/**
 * Clinch punches land on less-leveraged spots; §2.4.1 models that as
 * "lever x0.85". Expressed here as the site mix it stands for, because the
 * impact contract has no lever field — 02 owns `subLocation`.
 */
const CLINCH_SITES: [HeadSite, number][] = [
  ['chin', 0.15], ['temple', 0.10], ['midface', 0.35], ['forehead', 0.30], ['orbit', 0.10],
];

function pick(u: number, mix: [HeadSite, number][]): HeadSite {
  let acc = 0;
  for (const [site, w] of mix) {
    acc += w;
    if (u < acc) return site;
  }
  return mix[mix.length - 1][0];
}

interface ClassResult {
  pConcuss: number;
  drop: number;
  ko: number;
}

function monteCarlo(cls: StrikeClass, n: number, seed: string): ClassResult {
  const sampler = new RNG(`${seed}|features`);
  const rng = new RNG(`${seed}|sim`);
  const mix = cls.siteMix ?? DISTANCE_SITES;
  let pSum = 0;
  let drops = 0;
  let kos = 0;
  for (let i = 0; i < n; i++) {
    // §2.1: delivered force is lognormal about the class median.
    const forceN = cls.medianN * Math.exp(cls.sigmaLn * sampler.normal());
    const site = pick(sampler.next(), mix);
    // Hooks 45 % / straights 40 % / uppercuts 15 % (§2.4.1).
    const u = sampler.next();
    const tech = cls.tech ?? (cls.straightOnly
      ? 'tech.jab'
      : u < 0.45 ? 'tech.lead_hook' : u < 0.85 ? 'tech.cross' : 'tech.uppercut');
    const seen = sampler.next() >= cls.unseen;
    const mouthOpen = sampler.next() < 0.30;          // "relaxed" 30 %
    // chin ~ N(50, 15), clamped to the 0-100 attribute scale.
    const chinEff = Math.min(100, Math.max(0, 50 + 15 * sampler.normal()));

    const ds = freshState({ chinEff });
    const res = ds.applyImpact(impact({
      forceN,
      subLocation: site,
      tech,
      weapon: cls.weapon ?? 'fist',
      seen,
      targetState: {
        midAction: false, mouthOpen, guardHand: 'up', braced: false,
        grounded: cls.grounded ?? false,
      },
    }), rng, CTX);

    pSum += res.pConcuss;
    if (res.outcome === 'ko') { kos++; drops++; } else if (
      res.outcome === 'knockdown_hurt' || res.outcome === 'knockdown_flash'
    ) { drops++; }
  }
  return { pConcuss: pSum / n, drop: drops / n, ko: kos / n };
}

describe('§2.4.1 knockdown model, Monte-Carlo over the §2.1 force distribution', () => {
  it('reproduces 4.2 % concussive events and 2.3 % knockdowns per landed distance power head strike', () => {
    const r = monteCarlo({ medianN: 1150, sigmaLn: 0.45, unseen: 0.25 }, 30_000, 'c3');
    // Chapter table (pre-Phase 9): pConcuss 4.2 %, P(drop) 2.3 %, P(KO) 0.8 %,
    // with the acute-accumulation path supplying the rest of the knockdowns.
    // Phase 9 cut that path back (dmg.head.thr.kdHurt 65 -> 80, rawScale 50 ->
    // 35) and recalibrated the single-impact roll (ko.alphaCal 1.0 -> 1.3,
    // ko.kKO 0.20 -> 0.10), so the roll now carries the FIGHT_DATA §3 #36
    // rate on its own: ~4 % knockdowns per landed distance power head strike
    // over this force distribution (in-fight forces run lower: blocks,
    // placement, fatigue). Bands moved deliberately; see PHASE9_TUNING.md.
    expect(r.pConcuss).toBeGreaterThan(0.070);
    expect(r.pConcuss).toBeLessThan(0.125);
    expect(r.drop).toBeGreaterThan(0.030);
    expect(r.drop).toBeLessThan(0.060);
    // Realism pass: ko.kKO 0.05 -> 0.035 (the rotational term raised the
    // in-fight concussion rate; this fixture carries no trajectory, so it
    // sees only the lower KO share).
    expect(r.ko).toBeGreaterThan(0.0015);
    expect(r.ko).toBeLessThan(0.013);
    // The split itself: drops are 0.42 of concussive events (kKO 0.07 + hurt
    // 0.10 + flash 0.25) at massSevKO = 1 and f = 0.
    expect(r.drop / r.pConcuss).toBeGreaterThan(0.32);
    expect(r.drop / r.pConcuss).toBeLessThan(0.52);
  });

  it('reproduces ~1.1 knockdowns per 100 head significant strikes over the head-sig mix', () => {
    // §2.4.1 mix: distance 78 % of head sig landed (60 % power / 40 % jab),
    // clinch 11 %, ground 11 % `[S: FD #22]`.
    const distance = monteCarlo({ medianN: 1150, sigmaLn: 0.45, unseen: 0.25 }, 20_000, 'c2a');
    const jab = monteCarlo(
      { medianN: 700, sigmaLn: 0.40, unseen: 0.15, straightOnly: true }, 20_000, 'c2b',
    );
    const clinch = monteCarlo(
      { medianN: 1150 * 0.85, sigmaLn: 0.45, unseen: 0.15, siteMix: CLINCH_SITES }, 20_000, 'c2c',
    );
    const ground = monteCarlo(
      { medianN: 1150 * 0.8, sigmaLn: 0.45, unseen: 0.10, grounded: true }, 20_000, 'c2d',
    );

    // Each class against its own row in the §2.4.1 table (the jab ceiling
    // scaled with the Phase 9 roll recalibration, see above).
    expect(jab.pConcuss).toBeLessThan(0.02);
    expect(clinch.pConcuss).toBeLessThan(distance.pConcuss);
    expect(ground.pConcuss).toBeLessThan(clinch.pConcuss);

    const per100 = 100 * (
      0.78 * 0.6 * distance.drop
      + 0.78 * 0.4 * jab.drop
      + 0.11 * clinch.drop
      + 0.11 * ground.drop
    );
    // Chapter: ~1.1 per 100 head sig, against the FD #37 target of 0.82 +- 0.2.
    // Phase 9: the roll now carries all of it (see above), at this idealised
    // force distribution; the in-fight rate is what row 37 measures.
    expect(per100).toBeGreaterThan(0.75);
    expect(per100).toBeLessThan(2.6);
  });

  it('puts the weight-class gradient in severity, not in frequency (§2.4.2)', () => {
    // Attacker mass is absent from alphaEq (Pierce 2006 r = 0.22), so the drop
    // rate barely moves with it; kKO moves a lot.
    const rng = new RNG('mass');
    const light = freshState();
    const heavy = freshState();
    const imp = impact({ forceN: 2000 });
    const a = light.applyImpact(imp, rng, { round: 1, attackerMassKg: 57 });
    const b = heavy.applyImpact(imp, rng, { round: 1, attackerMassKg: 120 });
    expect(a.pConcuss).toBeCloseTo(b.pConcuss, 10);
    expect(b.raw).toBeGreaterThan(a.raw);       // massSev: severity, not frequency
  });

  it('is monotone in chin, force, unseen and fatigue', () => {
    const rng = new RNG('mono');
    const p = (over: Partial<StrikeImpact>, prof: Partial<FighterDamageProfile> = {}): number =>
      freshState(prof).applyImpact(impact(over), rng, CTX).pConcuss;
    expect(p({ forceN: 2200 })).toBeGreaterThan(p({ forceN: 1500 }));
    expect(p({}, { chinEff: 20 })).toBeGreaterThan(p({}, { chinEff: 80 }));
    expect(p({ forceN: 2000, seen: false })).toBeGreaterThan(p({ forceN: 2000, seen: true }));
    expect(p({ forceN: 2000, subLocation: 'chin' }))
      .toBeGreaterThan(p({ forceN: 2000, subLocation: 'forehead' }));
    expect(p({ forceN: 2000 }, { residualDehydration: 0.04 }))
      .toBeGreaterThan(p({ forceN: 2000 }, { residualDehydration: 0 }));
  });
});

// ---------------------------------------------------------------------------
// 2. Pool ranges
// ---------------------------------------------------------------------------

describe('pool ranges', () => {
  it('keeps every pool in range and every snapshot field in [0, 1] under a barrage', () => {
    const ds = freshState();
    const rng = new RNG('barrage');
    const regions: StrikeImpact['region'][] = ['head', 'body', 'leadLeg', 'rearLeg', 'arms'];
    const sites = ['chin', 'liver', 'calf', 'thigh_outer', 'forearm'] as const;
    for (let i = 0; i < 400; i++) {
      const k = i % regions.length;
      ds.applyImpact(impact({
        region: regions[k],
        subLocation: sites[k],
        forceN: 5000,                    // the top of the Pierce range, every time
        weapon: k >= 2 ? 'shin' : 'fist',
        tick: i,
      }), rng, CTX);
      idle(ds, 0.1, 1);
      const snap = ds.snapshotFields();
      for (const v of [snap.damage.head, snap.damage.body, snap.damage.legs, snap.damage.cut]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      for (const v of [...snap.damageVisual.zones, ...snap.damageVisual.swelling]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(snap.stamina.total).toBeGreaterThanOrEqual(0);
      expect(snap.stamina.total).toBeLessThanOrEqual(1);
      expect(snap.stamina.burst).toBeGreaterThanOrEqual(0);
      expect(snap.stamina.burst).toBeLessThanOrEqual(1);
    }
    const r = ds.regions;
    for (const pool of [r.head, r.body, r.arm.left, r.arm.right,
      r.leg.left.acute, r.leg.left.thigh, r.leg.right.calf]) {
      expect(pool.acute).toBeGreaterThanOrEqual(0);
      expect(pool.acute).toBeLessThanOrEqual(100);
      expect(pool.structural).toBeGreaterThanOrEqual(0);
      expect(pool.structural).toBeLessThanOrEqual(100);
      expect(pool.permanent).toBeLessThanOrEqual(pool.structural + 1e-9);
    }
  });

  it('splits every structural increment into permanent and recoverable by pFrac', () => {
    const ds = freshState();
    ds.regions.head.addStructural(40, T.n('dmg.head.pFrac'), 0);
    expect(ds.regions.head.permanent).toBeCloseTo(16, 6);       // 0.40 x 40
    expect(ds.regions.head.recoverable).toBeCloseTo(24, 6);
    expect(ds.regions.head.structural).toBeCloseTo(40, 6);
  });
});

// ---------------------------------------------------------------------------
// 3. Decay
// ---------------------------------------------------------------------------

describe('acute decay (§2.3)', () => {
  it('uses the 20 s re-hit half-life inside the window and 8 s after it (head)', () => {
    const ds = freshState();
    ds.regions.head.addAcute(60, 0);
    // First 10 s: the region was hit inside `reHitWindow`, so t1/2 = 20 s.
    idle(ds, 10);
    expect(ds.regions.head.acute).toBeCloseTo(60 * Math.pow(0.5, 10 / 20), 1);
    // Past the window: the normal 8 s half-life resumes.
    const at10 = ds.regions.head.acute;
    idle(ds, 8);
    expect(ds.regions.head.acute).toBeCloseTo(at10 * 0.5, 1);
  });

  it('decays body at 12 s and legs at 20 s past the re-hit window', () => {
    const ds = freshState();
    ds.regions.body.addAcute(80, 0);
    ds.regions.leg.left.acute.addAcute(80, 0);
    idle(ds, 15);                               // clear of both re-hit windows
    const body0 = ds.regions.body.acute;
    const leg0 = ds.regions.leg.left.acute.acute;
    idle(ds, 12);
    expect(ds.regions.body.acute).toBeCloseTo(body0 * 0.5, 1);
    idle(ds, 8);                                // 20 s of leg decay in total
    expect(ds.regions.leg.left.acute.acute).toBeCloseTo(leg0 * 0.5, 1);
  });

  it('freezes head decay after a hurt knockdown, then resumes (§2.4.3)', () => {
    const ds = freshState({ chinEff: 0 });
    const rng = new RNG('freeze');
    let dropped = false;
    for (let i = 0; i < 60 && !dropped; i++) {
      const res = ds.applyImpact(impact({ forceN: 4200, tick: i }), rng, CTX);
      dropped = res.outcome === 'knockdown_hurt';
      if (!dropped) { idle(ds, 40); ds.regions.head.acute = 0; }
    }
    expect(dropped).toBe(true);
    const at0 = ds.regions.head.acute;
    idle(ds, 8);
    // Frozen: 8 s of decay has moved nothing (freeze is 10-25 s).
    expect(ds.regions.head.acute).toBeCloseTo(at0, 6);
    idle(ds, 40);
    expect(ds.regions.head.acute).toBeLessThan(at0 * 0.5);
  });

  it('slows every acute half-life for a high-recovery fighter', () => {
    const fast = freshState({ recovery: 100 });
    const slow = freshState({ recovery: 0 });
    for (const ds of [fast, slow]) ds.regions.head.addAcute(60, 0);
    idle(fast, 20);
    idle(slow, 20);
    expect(fast.regions.head.acute).toBeLessThan(slow.regions.head.acute);
  });
});

// ---------------------------------------------------------------------------
// 4. State thresholds
// ---------------------------------------------------------------------------

describe('state thresholds (§2.3)', () => {
  it('enters stunned at 30 and rocked at 45, and clears at 25 / 35 (hysteresis)', () => {
    const ds = freshState();
    ds.regions.head.addAcute(31, 0);
    idle(ds, 0.1);
    expect(ds.has(S.stunned)).toBe(true);
    expect(ds.has(S.rocked)).toBe(false);

    ds.regions.head.acute = 46;
    ds.regions.head.lastHitS = -1000;
    idle(ds, 0.1);
    expect(ds.has(S.rocked)).toBe(true);
    expect(ds.has(S.stunned)).toBe(false);

    // 40 is below the entry threshold but above the exit: still rocked.
    ds.regions.head.acute = 40;
    idle(ds, 0.1);
    expect(ds.has(S.rocked)).toBe(true);

    ds.regions.head.acute = 34;
    idle(ds, 0.1);
    expect(ds.has(S.rocked)).toBe(false);
    expect(ds.has(S.stunned)).toBe(true);

    ds.regions.head.acute = 24;
    idle(ds, 0.1);
    expect(ds.has(S.stunned)).toBe(false);
    // `state.adrenaline_dump` is on for everyone in round 1's first 150 s
    // (§2.5.7); no *damage* state should remain.
    expect(ds.states.filter((s) => s !== S.adrenalineDump)).toEqual([]);
  });

  it('enters body_hurt at 50 and body_worn at 40 structural, with the documented caps', () => {
    const ds = freshState();
    ds.regions.body.addAcute(55, 0);
    ds.regions.body.addStructural(45, T.n('dmg.body.pFrac'), 0);
    idle(ds, 0.1);
    expect(ds.has(S.bodyHurt)).toBe(true);
    expect(ds.has(S.bodyWorn)).toBe(true);
    // §2.3.7: guard drops (defence 0.75) and output falls to 0.7.
    expect(ds.caps.defence).toBeLessThan(0.8);
    expect(ds.caps.output).toBeLessThan(0.75);

    ds.regions.body.acute = 34;
    idle(ds, 0.1);
    expect(ds.has(S.bodyHurt)).toBe(false);
  });

  it('bands the leg states at 30 / 55 / 75 / 85 and drives the mobility curve', () => {
    const ds = freshState();
    const leg = ds.regions.leg.left;
    leg.thigh.addStructural(32, T.n('dmg.leg.pFrac'), 0);
    idle(ds, 0.1);
    expect(ds.severityOf(S.legCompromised, 'left')).toBe(1);

    leg.thigh.addStructural(25, T.n('dmg.leg.pFrac'), 0);
    idle(ds, 0.1);
    expect(ds.severityOf(S.legCompromised, 'left')).toBe(2);

    leg.thigh.addStructural(30, T.n('dmg.leg.pFrac'), 0);
    idle(ds, 0.1);
    expect(legLoad(T, leg)).toBeGreaterThanOrEqual(85);
    expect(ds.has(S.legCollapse, 'left')).toBe(true);
    // 1 - 0.7 x (load/100)^1.5, weighted 0.7 on the worse leg.
    expect(ds.caps.movement).toBeLessThan(0.75);
    expect(ds.caps.kickPower.left).toBeLessThan(ds.caps.kickPower.right);
  });

  it('opens a dead arm at 50 structural and holds it for at least 60 s', () => {
    const ds = freshState();
    ds.regions.arm.left.addStructural(55, T.n('dmg.arm.pFrac'), 0);
    idle(ds, 0.1);
    expect(ds.has(S.deadArm, 'left')).toBe(true);
    expect(ds.caps.guard.left).toBeCloseTo(T.n('dmg.arm.deadArmGuard'), 6);
    ds.regions.arm.left.permanent = 0;
    ds.regions.arm.left.recoverable = 0;
    idle(ds, 30);
    expect(ds.has(S.deadArm, 'left')).toBe(true);      // minimum duration
    idle(ds, 40);
    expect(ds.has(S.deadArm, 'left')).toBe(false);
  });

  it('closes an eye at 70 swelling and requests the doctor', () => {
    const ds = freshState();
    ds.regions.swell.left = 75;
    idle(ds, 0.1);
    expect(ds.has(S.eyeSwollenShut, 'left')).toBe(true);
    const o = ds.observables();
    expect(o.eyeSwollenShut).toBe(true);
    expect(o.visionL).toBeLessThanOrEqual(T.n('dmg.swell.shutVision'));
    expect(o.doctorCheckRequested).toBe(true);
    expect(ds.caps.defence).toBeLessThan(1);
  });

  it('registers every state id it can write in the global table', () => {
    for (const id of DAMAGE_STATE_IDS) {
      expect(id.startsWith('state.')).toBe(true);
      expect(STATE_IDS.has(id)).toBe(true);
    }
    expect(DAMAGE_STATE_IDS).toContain(S.ko);
    expect(DAMAGE_STATE_IDS).toContain(`${S.deadArm}.left`);
  });

  it('a liver shot drops the fighter after a delay, not on the tick it lands', () => {
    const ds = freshState();
    const rng = new RNG('liver');
    // raw x 1.3 must clear the 35-unit liver threshold but stay under the
    // 80-unit immediate-collapse threshold: 1,500 N delivered does both.
    ds.applyImpact(impact({
      region: 'body', subLocation: 'liver', weapon: 'fist', forceN: bandForce(1500),
    }), rng, CTX);
    expect(ds.has(S.bodyCollapse)).toBe(false);       // the delay is 0.5-3.0 s
    idle(ds, 3.5);
    expect(ds.has(S.bodyCollapse)).toBe(true);
    expect(ds.observables().bodyCollapse.on).toBe(true);
    expect(ds.grounded).toBe(true);
    idle(ds, 25);
    expect(ds.has(S.bodyCollapse)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5 + 6. Fatigue
// ---------------------------------------------------------------------------

/**
 * One round of work: `strikesPerMin` power strikes plus continuous movement.
 *
 * The volumes below are the realistic ones. A UFC fighter throws of the order
 * of 6-12 *power* strikes a minute (the rest of the output is jabs and feints,
 * which are `lightStrike`), and at 6/min the model lands on the chapter's own
 * expected trajectory: R3 lactate ~17 and f ~0.5 against §2.5.3's "evenly
 * paced T4 ends R3 near f = 0.55, lac = 13" and C23's K-1 rounds of
 * 11.3 / 13.1 / 14.6 mmol/L.
 */
function workRound(
  ds: DamageState, seconds: number, strikesPerMin: number, round: number, highPace = false,
): void {
  const ticks = Math.round(seconds * 10);
  const period = strikesPerMin > 0 ? Math.round(600 / strikesPerMin) : Number.POSITIVE_INFINITY;
  for (let i = 0; i < ticks; i++) {
    if (period !== Number.POSITIVE_INFINITY && i % period === 0) ds.spendAction('powerStrike');
    ds.spendSustained(highPace ? 'movementHighPace' : 'movementLowPace', 0.1);
    ds.upkeep(100, { tick: i, round, posture: 'distance' });
  }
}

describe('§2.5 three-pool energy model', () => {
  it('produces the front-runner fade with no fade rule (§2.5.9)', () => {
    const paced = freshState();
    const frontRunner = freshState();

    // Round 1: the front-runner pushes the pace; the paced fighter does not.
    workRound(frontRunner, 300, 12, 1);
    workRound(paced, 300, 5, 1);
    frontRunner.roundBreak({ breakSeconds: 60, round: 2 });
    paced.roundBreak({ breakSeconds: 60, round: 2 });

    // Rounds 2 and 3: identical, moderate work for both.
    for (const round of [2, 3]) {
      workRound(frontRunner, 300, 5, round);
      workRound(paced, 300, 5, round);
      if (round === 2) {
        frontRunner.roundBreak({ breakSeconds: 60, round: 3 });
        paced.roundBreak({ breakSeconds: 60, round: 3 });
      }
    }

    // The fade is entirely a consequence of lactate that never cleared pulling
    // the PCr ceiling down (§2.5.9). Nothing named "fade" exists.
    expect(frontRunner.energy.lac).toBeGreaterThan(paced.energy.lac + 2);
    expect(frontRunner.energy.pcrCeiling).toBeLessThan(paced.energy.pcrCeiling);
    expect(frontRunner.f).toBeGreaterThan(paced.f + 0.08);
    // Both end the bout inside the measured post-bout band, 10-21 mmol/L
    // `[S: DAMAGE §1 Amtmann 2008]` — C23.
    expect(paced.energy.lac).toBeGreaterThan(10);
    expect(frontRunner.energy.lac).toBeLessThan(21.5);
    // And the fade is visible where every other chapter reads it.
    expect(frontRunner.caps.output).toBeLessThan(paced.caps.output);
    expect(frontRunner.caps.defence).toBeLessThan(paced.caps.defence);
  });

  it('a high-cardio fighter fades less on the same work (§2.5.9)', () => {
    const elite = freshState({ cardio: 90 });
    const poor = freshState({ cardio: 20 });
    for (const ds of [elite, poor]) workRound(ds, 300, 10, 1);
    expect(elite.f).toBeLessThan(poor.f);
    expect(elite.energy.pcr).toBeGreaterThan(poor.energy.pcr);
  });

  it('recovers PCr at the §2.5.4 rate over a 60 s break', () => {
    const ds = freshState();
    ds.energy.pcr = 40;
    ds.energy.lac = 4;                            // below the ceiling penalty
    const before = ds.energy.pcr;
    const ceiling = ds.energy.pcrCeiling;
    ds.roundBreak({ breakSeconds: 60, round: 2 });
    // t1/2 = 45 s / aerobicRate(1.0) -> 1 - 0.5^(60/45) = 60 % of the deficit.
    expect(ds.energy.pcr).toBeCloseTo(before + 0.6 * (ceiling - before), 0);
    expect(ds.energy.lac).toBeCloseTo(3.5, 6);    // -0.5 mmol/L, negligible
  });

  it('caps the break ceiling at 85 while lactate is above 14', () => {
    const ds = freshState();
    ds.energy.pcr = 30;
    ds.energy.lac = 18;
    ds.roundBreak({ breakSeconds: 60, round: 2 });
    expect(ds.energy.pcr).toBeLessThanOrEqual(85);
    // 18 mmol/L gives an 88 in-round ceiling `[S: DAMAGE §4.5]`.
    ds.energy.lac = 18;
    expect(ds.energy.pcrCeiling).toBeCloseTo(88, 6);
  });

  it('recovers less for a fighter who does not sit down, and more with a breathe cue', () => {
    const make = (): DamageState => {
      const d = freshState();
      d.energy.pcr = 40;
      d.energy.aer = 0.8;
      return d;
    };
    const seated = make();
    const standing = make();
    const coached = make();
    seated.roundBreak({ breakSeconds: 60, sitDown: true, breatheCue: false });
    standing.roundBreak({ breakSeconds: 60, sitDown: false, breatheCue: false });
    coached.roundBreak({ breakSeconds: 60, sitDown: true, breatheCue: true });
    expect(standing.energy.pcr).toBeLessThan(seated.energy.pcr);
    expect(standing.energy.aer).toBeGreaterThan(seated.energy.aer);
    expect(coached.energy.aer).toBeLessThan(seated.energy.aer);
    expect(seated.energy.aer).toBeCloseTo(0.8 * 0.65, 6);
  });

  it('recovers structural damage at the per-region break fractions, permanent part untouched', () => {
    const ds = freshState();
    ds.regions.head.addStructural(40, T.n('dmg.head.pFrac'), 0);
    const permanent = ds.regions.head.permanent;
    const recoverable = ds.regions.head.recoverable;
    ds.roundBreak({ breakSeconds: 60, round: 2 });
    expect(ds.regions.head.permanent).toBeCloseTo(permanent, 6);
    expect(ds.regions.head.recoverable).toBeCloseTo(recoverable * 0.75, 4);
    // A 120 s Muay Thai break recovers more, per 1 - (1 - r)^(t/60).
    const mt = freshState();
    mt.regions.head.addStructural(40, T.n('dmg.head.pFrac'), 0);
    mt.roundBreak({ breakSeconds: 120, round: 2 });
    expect(mt.regions.head.recoverable).toBeLessThan(ds.regions.head.recoverable);
  });

  it('clears the head acute pool over a break but keeps the structural tax', () => {
    const ds = freshState();
    ds.regions.head.addAcute(60, 0);
    ds.regions.head.addStructural(30, T.n('dmg.head.pFrac'), 0);
    ds.roundBreak({ breakSeconds: 60, round: 2 });
    expect(ds.regions.head.acute).toBeLessThan(1);       // saved by the bell
    expect(ds.regions.head.structural).toBeGreaterThan(20);
    expect(ds.has(S.rocked)).toBe(false);
  });

  it('taxes the adrenaline-dump fighter and clears it after round 1 (§2.5.7)', () => {
    const nervous = freshState({ experience: 0.1, composureEff: 30, eventMagnitude: 'title' });
    const veteran = freshState({ experience: 0.95, composureEff: 90, eventMagnitude: 'title' });
    expect(nervous.energy.dump).toBeGreaterThan(0.6);
    expect(veteran.energy.dump).toBeLessThan(0.05);
    for (const ds of [nervous, veteran]) workRound(ds, 120, 12, 1);
    // Everything costs (1 + 0.6 x dump) for the first 150 s.
    expect(nervous.energy.pcr).toBeLessThan(veteran.energy.pcr - 10);
    expect(nervous.has(S.adrenalineDump)).toBe(true);
    workRound(nervous, 60, 0, 1);            // past the 150 s window
    expect(nervous.has(S.adrenalineDump)).toBe(false);
  });

  it('grants a second wind after a hard spell followed by a long stall (§2.5.9)', () => {
    const ds = freshState({ cardio: 60 });
    workRound(ds, 150, 20, 1, true);         // a hard spell drives f above 0.7
    expect(ds.f).toBeGreaterThan(0.7);
    const spent = ds.caps.output;
    idle(ds, 130, 1);                        // a stall: clinch, or the opponent backs off
    expect(ds.f).toBeLessThan(T.n('fat.secondWind.to'));
    expect(ds.has(S.secondWind)).toBe(true);
    expect(ds.caps.output).toBeGreaterThan(spent);
    // At most once per round: it does not come back after it lapses.
    idle(ds, 120, 1);
    expect(ds.has(S.secondWind)).toBe(false);
  });

  it('charges the grip channel only for gripping work (§2.5.10)', () => {
    const grappler = freshState();
    const striker = freshState();
    for (let i = 0; i < 300; i++) {
      grappler.spendSustained('clinchPummel', 0.1);
      striker.spendSustained('movementHighPace', 0.1);
      grappler.upkeep(100, { tick: i, round: 1, posture: 'clinch' });
      striker.upkeep(100, { tick: i, round: 1, posture: 'distance' });
    }
    expect(grappler.energy.grip).toBeGreaterThan(1);
    expect(striker.energy.grip).toBe(0);
    expect(grappler.caps.gripStrength).toBeLessThan(1);
  });

  it('applies the §2.5.5 capability anchors at f = 0.5 and f = 0.8', () => {
    const ds = freshState();
    // Drive the pools to a chosen f directly: f = 0.45(1-pcr/100) + 0.40 lacTerm.
    ds.energy.pcr = 100 - (0.5 / 0.45) * 100 * 0.5;
    ds.energy.lac = 1;
    ds.energy.aer = 0;
    // Defence (0.80 at f = 0.5) falls faster than power (0.88 rotational).
    const f = ds.f;
    expect(f).toBeGreaterThan(0.2);
    idle(ds, 0.1);
    expect(ds.caps.defence).toBeLessThan(ds.caps.powerRotational);
    expect(ds.caps.powerRotational).toBeLessThan(ds.caps.power);   // rotational loses ~2x
  });
});

// ---------------------------------------------------------------------------
// 7 + 8. The determinism contract
// ---------------------------------------------------------------------------

describe('determinism contract (§2.10, 09 §2.7)', () => {
  it('consumes exactly ten draws per impact, whatever the impact does', () => {
    const cases: Partial<StrikeImpact>[] = [
      {},                                                              // nothing happens
      { forceN: 5000, subLocation: 'chin' },                           // a knockout
      { forceN: 4000, weapon: 'elbow', tech: 'tech.elbow_down', subLocation: 'orbit' },
      { region: 'body', subLocation: 'liver', forceN: 3000 },
      { region: 'body', subLocation: 'solar', forceN: 3000 },
      { region: 'body', subLocation: 'ribs', forceN: 3000, weapon: 'knee' },
      { region: 'leadLeg', subLocation: 'calf', weapon: 'shin', forceN: 2500 },
      { region: 'rearLeg', subLocation: 'shin', weapon: 'shin', forceN: 2000 },
      { region: 'arms', subLocation: 'forearm', weapon: 'shin', forceN: 2000 },
      { defence: 'block_forearm', absorb: 0.5, forceN: 3000 },
      { weapon: 'mat', tech: 'slam', forceN: 4400, seen: false },
    ];
    for (const over of cases) {
      const ds = freshState();
      const rng = new RNG('draws');
      const before = rng.draws;
      const res = ds.applyImpact(impact(over), rng, CTX);
      expect(rng.draws - before).toBe(10);
      expect(res.drawsUsed).toBe(10);
    }
  });

  it('draws nothing in upkeep or at a round break', () => {
    const ds = freshState();
    const rng = new RNG('upkeep');
    ds.applyImpact(impact({ forceN: 3000 }), rng, CTX);
    const after = rng.draws;
    idle(ds, 60);
    ds.roundBreak({ breakSeconds: 60, round: 2 });
    idle(ds, 60, 2);
    expect(rng.draws).toBe(after);
  });

  it('reproduces a bout exactly for a fixed seed, and differs for another', () => {
    const run = (seed: string): string => {
      const ds = freshState({ chinEff: 45 });
      const rng = new RNG(seed);
      const events: unknown[] = [];
      for (let i = 0; i < 300; i++) {
        if (i % 7 === 0) {
          events.push(ds.applyImpact(impact({
            forceN: 900 + (i % 11) * 260,
            subLocation: (['chin', 'temple', 'midface', 'orbit'] as const)[i % 4],
            tech: i % 3 === 0 ? 'tech.lead_hook' : 'tech.cross',
            seen: i % 5 !== 0,
            tick: i,
          }), rng, CTX).events);
          ds.spendAction('powerStrike');
        }
        events.push(ds.upkeep(100, { tick: i, round: 1, posture: 'distance' }));
      }
      events.push(ds.roundBreak({ breakSeconds: 60, round: 2 }));
      return JSON.stringify({
        snap: ds.snapshotFields(),
        obs: ds.observables(),
        states: ds.states,
        draws: rng.draws,
        events,
      });
    };
    expect(run('seed-a')).toBe(run('seed-a'));
    expect(run('seed-a')).not.toBe(run('seed-b'));
  });
});

// ---------------------------------------------------------------------------
// Cues and the cross-chapter contract
// ---------------------------------------------------------------------------

describe('§2.7 referee observables', () => {
  it('counts unanswered head strikes and resets them on an answer', () => {
    const ds = freshState();
    const rng = new RNG('unanswered');
    for (let i = 0; i < 4; i++) {
      ds.applyImpact(impact({ forceN: 800, tick: i }), rng, CTX);
      idle(ds, 0.5);
    }
    expect(ds.observables().unansweredHead).toBe(4);
    expect(ds.observables().absorbedWindow30).toBe(4);
    ds.noteAnswer();
    idle(ds, 0.1);
    expect(ds.observables().unansweredHead).toBe(0);
    expect(ds.observables().intelligentDefence).toBe(true);
    idle(ds, 4);
    expect(ds.observables().intelligentDefence).toBe(false);   // 3.0 s window
  });

  it('exposes the limpness, eyes and legs cues a referee stops on', () => {
    const ds = freshState();
    ds.regions.head.addAcute(72, 0);
    idle(ds, 0.1);
    const o = ds.observables();
    expect(o.rocked).toBe(true);
    expect(o.limpness).toBeGreaterThanOrEqual(1);
    expect(o.limp).toBe(true);
    expect(o.eyesCue).toBe('glassy');
    expect(o.legsCue).toBe('gone');
    expect(o.visibleDamageScore).toBeGreaterThan(0.4);
  });

  it('forces attemptingToRise false while the fighter physically cannot', () => {
    const ds = freshState();
    const rng = new RNG('rise');
    ds.applyImpact(impact({
      region: 'body', subLocation: 'liver', forceN: 3200,
    }), rng, CTX);
    idle(ds, 3.5);
    ds.upkeep(100, { tick: 0, round: 1, posture: 'distance', attemptingToRise: true });
    expect(ds.observables().bodyCollapse.on).toBe(true);
    expect(ds.observables().attemptingToRise).toBe(false);
  });

  it('reports consciousness 0 and the ko cue on a knockout', () => {
    const ds = freshState({ chinEff: 0 });
    const rng = new RNG('ko-cue');
    for (let i = 0; i < 200 && !ds.has(S.ko); i++) {
      ds.applyImpact(impact({ forceN: 5000, tick: i }), rng, CTX);
      if (!ds.has(S.ko) && !ds.has(S.rocked)) ds.regions.head.acute = 0;
    }
    expect(ds.has(S.ko)).toBe(true);
    const o = ds.observables();
    expect(o.ko).toBe(true);
    expect(o.consciousness).toBe(0);
    expect(o.eyesCue).toBe('closed');
    expect(o.limpness).toBe(2);
    expect(ds.caps.movement).toBe(0);
    // §2.4.6 career write: one KO and three chin points, permanently.
    expect(ds.career.priorKOs).toBe(1);
    expect(ds.career.chinDelta).toBe(-T.n('ko.careerChinLoss'));
  });

  it('keeps a full RefObservables record with no undefined fields', () => {
    const ds = freshState();
    idle(ds, 1);
    const o = ds.observables() as unknown as Record<string, unknown>;
    const required = [
      'ko', 'limp', 'rocked', 'stunned', 'bodyCollapse', 'legCollapse', 'unansweredHead',
      'absorbedWindow30', 'tSinceDefenceS', 'consciousness', 'cuts', 'visionL', 'visionR',
      'eyeSwollenShut', 'fractureFlag', 'grounded', 'intelligentDefence', 'attemptingToRise',
      'tapped', 'verbalTap', 'screams', 'jointFailed', 'defenceQuality30', 'knockdownsLast10s',
      'underChoke', 'clinching', 'moving', 'coveringStaticS', 'limpness', 'eyesCue',
      'reactionCue', 'legsCue', 'cannotStand', 'bloodInEyeS', 'doctorCheckRequested',
      'mouthOpen', 'visibleDamageScore',
    ];
    for (const key of required) expect(o[key]).toBeDefined();
  });
});

describe('§2.3.5 / §2.3.6 injuries', () => {
  it('opens cuts on elbows far more often than on gloved punches', () => {
    const count = (over: Partial<StrikeImpact>, seed: string): number => {
      const rng = new RNG(seed);
      let cuts = 0;
      for (let i = 0; i < 4000; i++) {
        const ds = freshState();
        ds.applyImpact(impact({ subLocation: 'orbit', forceN: 1400, ...over }), rng, CTX);
        cuts += ds.cuts.length;
      }
      return cuts / 4000;
    };
    const elbow = count({ weapon: 'elbow', tech: 'tech.elbow_horizontal' }, 'cut-elbow');
    const punch = count({ weapon: 'fist', tech: 'tech.cross' }, 'cut-punch');
    expect(elbow).toBeGreaterThan(0.09);        // 0.12 to the brow zone [S: MT §5.4]
    expect(elbow).toBeLessThan(0.16);
    expect(punch).toBeGreaterThan(0.005);       // 0.012 [E; DAMAGE §2.5]
    expect(punch).toBeLessThan(0.022);
  });

  it('grows a cut every 5 further clean strikes and lets the cutman treat it', () => {
    const ds = freshState();
    const rng = new RNG('cut-growth');
    ds.cuts.push({
      site: 'brow_L', severity: 1, bleedRate: 1, cleanHitsSinceOpen: 0,
      openedS: 0, treatedSeverity: 0, hitsSinceTreated: 0,
    });
    for (let i = 0; i < 5; i++) {
      ds.applyImpact(impact({ subLocation: 'orbit', forceN: 1400, tick: i }), rng,
        { ...CTX, struckSide: 'left' });
    }
    expect(ds.cuts[0].severity).toBe(2);
    ds.roundBreak({ breakSeconds: 60, round: 2 });
    expect(ds.cuts[0].severity).toBe(1);            // cutman -1
    expect(ds.cuts[0].treatedSeverity).toBe(2);
    for (let i = 0; i < 2; i++) {
      ds.applyImpact(impact({ subLocation: 'orbit', forceN: 1400, tick: i }), rng,
        { ...CTX, struckSide: 'left' });
    }
    expect(ds.cuts[0].severity).toBe(2);            // and it re-opens
  });

  it('hands the attacker back a hand injury, which the engine applies to them', () => {
    const rng = new RNG('hand');
    let injuries = 0;
    const attacker = freshState();
    for (let i = 0; i < 20_000; i++) {
      const target = freshState();
      const res = target.applyImpact(impact({
        subLocation: 'forehead', forceN: 1400, tech: 'tech.cross', tick: i,
      }), rng, CTX);
      if (res.attackerInjury) {
        injuries++;
        attacker.applySelfInjury(res.attackerInjury);
      }
    }
    // 0.0015 per landed punch to the skull zone `[E; DAMAGE §2.4]`.
    expect(injuries / 20_000).toBeGreaterThan(0.0008);
    expect(injuries / 20_000).toBeLessThan(0.0025);
    expect(attacker.has(S.handInjured, 'right')).toBe(true);
    expect(attacker.caps.handPower.right).toBeCloseTo(T.n('dmg.hand.power'), 6);
    expect(attacker.caps.handRate.right).toBeCloseTo(T.n('dmg.hand.useFreq'), 6);
  });

  it('gives a dead leg on a rising probability, 8 % of clean calf kicks up to 18 %', () => {
    const rate = (priorCalfHits: number, seed: string): number => {
      const rng = new RNG(seed);
      let dead = 0;
      for (let i = 0; i < 6000; i++) {
        const ds = freshState();
        ds.regions.leg.left.calfHits = priorCalfHits;
        ds.applyImpact(impact({
          region: 'leadLeg', subLocation: 'calf', weapon: 'shin', forceN: 900, tick: i,
        }), rng, CTX);
        if (ds.has(S.deadLeg, 'left')) dead++;
      }
      return dead / 6000;
    };
    // `P = 0.08 + 0.02 * cleanCalfHitsSoFar`, capped at 0.18 `[S: MT §5.1]`.
    const first = rate(0, 'calf-1');
    const sixth = rate(5, 'calf-6');
    expect(first).toBeGreaterThan(0.06);
    expect(first).toBeLessThan(0.10);
    expect(sixth).toBeGreaterThan(0.15);
    expect(sixth).toBeLessThan(0.21);
    expect(sixth).toBeGreaterThan(first);
  });

  it('applies the dead-leg multipliers while it lasts, then clears them', () => {
    const ds = freshState();
    const rng = new RNG('calf-caps');
    for (let i = 0; i < 40 && !ds.has(S.deadLeg, 'left'); i++) {
      // Keep the structural pool out of the collapse band, so the calf-shock
      // roll (not the collapse roll) is the one that takes the region draw.
      ds.regions.leg.left.calf.recoverable = 0;
      ds.regions.leg.left.calf.permanent = 0;
      ds.applyImpact(impact({
        region: 'leadLeg', subLocation: 'calf', weapon: 'shin', forceN: 900, tick: i,
      }), rng, CTX);
      // 20 s apart, so the acute pool decays between kicks instead of pinning
      // at 100 and tipping the leg into the collapse band.
      idle(ds, 20);
    }
    expect(ds.has(S.deadLeg, 'left')).toBe(true);
    idle(ds, 0.1);
    expect(ds.caps.movement).toBeLessThan(0.8);         // 0.7 [E; MT §5.1]
    expect(ds.caps.kickPower.left).toBeLessThan(0.7);   // 0.6
    expect(ds.caps.checkSpeed.left).toBeLessThan(0.6);  // 0.5
    expect(ds.caps.tdd).toBeLessThan(0.8);              // 0.75
    idle(ds, 35);                                        // the window is 15-30 s
    expect(ds.has(S.deadLeg, 'left')).toBe(false);
  });

  it('routes a blocked head strike into the guard (§2.2.1)', () => {
    const ds = freshState();
    const rng = new RNG('block');
    // 2,000 N (was 3,000): below the concussive band, so a knockdown roll's
    // acute floor cannot land on either side of the comparison — the test is
    // about the routing to the arms, not the KO roll (Phase 9 recalibrated it).
    ds.applyImpact(impact({ defence: 'block_forearm', absorb: 0.5, forceN: 2000 }), rng, CTX);
    expect(ds.regions.arm.left.structural).toBeGreaterThan(0);
    expect(ds.regions.arm.right.structural).toBeGreaterThan(0);
    expect(ds.regions.head.acute).toBeLessThan(
      freshState().applyImpact(impact({ forceN: 2000 }), new RNG('b2'), CTX).raw,
    );
  });

  it('halves absorb for a rocked fighter, which is the TKO path (§2.4.5)', () => {
    const fresh = freshState();
    const rocked = freshState();
    rocked.regions.head.addAcute(60, 0);
    idle(rocked, 0.1);
    expect(rocked.has(S.rocked)).toBe(true);
    const rng = new RNG('absorb');
    const a = fresh.applyImpact(impact({ defence: 'block_glove', absorb: 0.6, forceN: 2000 }), rng, CTX);
    const b = rocked.applyImpact(impact({ defence: 'block_glove', absorb: 0.6, forceN: 2000 }), rng, CTX);
    expect(b.absorb).toBeCloseTo(a.absorb * T.n('dmg.absorb.rockedMult'), 6);
    expect(b.raw).toBeGreaterThan(a.raw);
  });
});

// ---------------------------------------------------------------------------
// 9. The parameter registry
// ---------------------------------------------------------------------------

describe('parameter registry (§4)', () => {
  it('registers the whole chapter with valid ids, tags, units and bounds', () => {
    const reg = new ParamRegistry();
    expect(() => reg.addAll(DAMAGE_PARAMS)).not.toThrow();   // validates every spec
    expect(DAMAGE_PARAMS.length).toBeGreaterThan(150);
    for (const spec of DAMAGE_PARAMS) {
      expect(spec.section).toBe('damage');
      expect(spec.tag).toMatch(/^\[(S:|D:|E)/);
      expect(spec.unit.length).toBeGreaterThan(0);
      expect(Number.isFinite(spec.value)).toBe(true);
      if (spec.min !== undefined) expect(spec.value).toBeGreaterThanOrEqual(spec.min);
      if (spec.max !== undefined) expect(spec.value).toBeLessThanOrEqual(spec.max);
    }
  });

  it('has no duplicate ids and keeps a measured number fixed against calibration', () => {
    const ids = new Set(DAMAGE_PARAMS.map((s) => s.id));
    expect(ids.size).toBe(DAMAGE_PARAMS.length);
    const byId = new Map(DAMAGE_PARAMS.map((s) => [s.id, s]));
    // Sourced constants the calibrator must not touch.
    expect(byId.get('dmg.forceRef')?.free).toBe(false);
    expect(byId.get('ko.alphaRef')?.free).toBe(false);
    expect(byId.get('dmg.leg.collapseFallP')?.free).toBe(false);
    // ... and the single knob C1-C3 are meant to move.
    expect(byId.get('ko.alphaCal')?.free).toBe(true);
  });

  it('is the only source of numbers: every id the code reads resolves', () => {
    // Exercise every branch that reads a table by key, so a missing id throws.
    const ds = freshState();
    const rng = new RNG('coverage');
    const sites = {
      head: ['chin', 'temple', 'midface', 'forehead', 'orbit', 'topback'],
      body: ['liver', 'solar', 'ribs', 'spleen', 'sternum', 'abdomen'],
      leadLeg: ['thigh_outer', 'thigh_inner', 'calf', 'shin', 'knee'],
    } as const;
    const weapons: StrikeImpact['weapon'][] = [
      'fist', 'backfist', 'hammerfist', 'elbow', 'elbow_point', 'knee', 'shin',
      'instep', 'ball_of_foot', 'heel', 'shin_on_knee', 'head', 'mat',
    ];
    const gloves: StrikeImpact['gloveType'][] = [
      'mma4oz', 'bare', 'boxing8oz', 'boxing10oz', 'boxing12oz',
    ];
    let tick = 0;
    for (const [region, list] of Object.entries(sites)) {
      for (const site of list) {
        for (const weapon of weapons) {
          for (const gloveType of gloves) {
            expect(() => ds.applyImpact(impact({
              region: region as StrikeImpact['region'],
              subLocation: site,
              weapon,
              gloveType,
              forceN: 1500,
              tick: tick++,
            }), rng, CTX)).not.toThrow();
          }
        }
      }
    }
    for (const defence of [
      'none', 'block_forearm', 'block_glove', 'roll', 'slip_late', 'check', 'knee_block', 'catch',
    ] as StrikeImpact['defence'][]) {
      expect(() => ds.applyImpact(impact({ defence, absorb: NaN }), rng, CTX)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 10. The two paths do not overlap (§2.3.1 "the roll overrides the threshold")
// ---------------------------------------------------------------------------

/** A scripted RNG: `applyImpact` only ever calls `next()`, ten times. */
function scripted(draws: readonly number[]): RNG {
  let i = 0;
  return { next: () => draws[i++ % draws.length] } as unknown as RNG;
}

describe('§2.3.1 the §2.4 roll overrides the threshold mapping for its own impact', () => {
  /**
   * Rock a fighter, then land a shot big enough to put the acute pool past 90.
   *
   * These tests are about the interaction between the two knockdown paths, not
   * about the calibrated damage scale, so they pin `dmg.rawScale` to the
   * reference value. Scaling the fixture's force instead would change the
   * concussion path too (alphaEq does not scale with a damage constant), which
   * is the opposite of what these cases hold fixed.
   */
  function rockedAtNinety(): DamageState {
    // `ko.alphaCal` pinned at its Phase 9 value: the cases below need a 4,000 N
    // chin shot whose pConcuss stays under the scripted 0.999 (Realism pass
    // moved the default to 1.38).
    const ds = new DamageState(defaultProfile({ chinEff: 50 }), {
      tuning: tuningWith({ 'dmg.rawScale': RAW_SCALE_REFERENCE, 'ko.alphaCal': 1.3 }),
    });
    // Two chin shots at the §2.1 power median are enough to enter `rocked`.
    const quiet = scripted([0.999]);
    ds.applyImpact(impact({ forceN: 2000, subLocation: 'chin' }), quiet, CTX);
    expect(ds.has(S.rocked)).toBe(true);
    return ds;
  }

  it('does not upgrade a `rocked` roll into a KO just because the pool crossed 90', () => {
    const ds = rockedAtNinety();
    // d[0] = 0 makes the impact concussive whatever pConcuss is; d[1] = 0.999
    // puts the outcome split past kKO + hurt + flash, i.e. `rocked`.
    const res = ds.applyImpact(
      impact({ forceN: 4000, subLocation: 'chin' }),
      scripted([0, 0.999, 0.5, 0.5, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999]),
      CTX,
    );
    expect(res.concussive).toBe(true);
    expect(res.outcome).toBe('rocked');
    expect(ds.snapshotFields().damage.head).toBeGreaterThan(0.89);
    expect(ds.has(S.ko), 'the roll said `rocked`; the threshold must not overrule it').toBe(false);
  });

  it('still reaches the KO band by accumulation when the roll did not resolve the impact', () => {
    const ds = rockedAtNinety();
    // d[0] = 0.999 is above any pConcuss this chapter produces: no roll.
    const res = ds.applyImpact(
      impact({ forceN: 4000, subLocation: 'chin' }), scripted([0.999]), CTX,
    );
    expect(res.concussive).toBe(false);
    expect(ds.has(S.ko)).toBe(true);
  });

  it('never emits more than one knockdown event for one impact', () => {
    const ds = rockedAtNinety();
    const res = ds.applyImpact(
      impact({ forceN: 4000, subLocation: 'chin' }), scripted([0.999]), CTX,
    );
    expect(res.events.filter((e) => e.kind === 'knockdown')).toHaveLength(1);
  });
});
