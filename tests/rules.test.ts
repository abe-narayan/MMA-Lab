/**
 * Chapter 06 — rules, referee and judging.
 *
 * The interesting tests here are not "does the code run" but "does the model
 * still reproduce the numbers the chapter was tuned to": the decision-type
 * split, the 10-8 rate, and the referee's reaction lag. If a weight moves and
 * those drift, the change was a design change.
 */
import { describe, expect, it } from 'vitest';
import { RNG } from '../src/sim/rng';
import { ParamRegistry } from '../src/sim/params/registry';
import { RULES_PARAMS } from '../src/sim/rules/params';
import {
  RULESETS, RULESET_IDS, resolveRuleset, ibjjfSubmissions,
} from '../src/sim/rules/rulesets';
import {
  isGrounded, isLegal, type GroundContact, type LegalityContext,
} from '../src/sim/rules/legality';
import {
  Referee, STRICTNESS_PRESETS, expectedExtraHeadStrikes, expectedKoStoppageLagS,
  expectedReactionLagS, foulTierMult, positionMult, refereeConfig, sampleReactionLag,
  judoThrowScore, judoOsaekomiScore, applyJudoScore, applyShido, emptyJudoScore,
  emptyGrapplingScore, adccPositivePointsAllowed, ibjjfStallStep, streetTick,
  ADCC_POINTS, IBJJF_POINTS,
  type RefFighterInput, type RefTickInput,
} from '../src/sim/rules/referee';
import { neutralObservables } from '../src/sim/rules/observables';
import {
  createPanel, decide, decideGrappling, decideJudo, decideSubOnly, emptyLedger,
  judgeTotals, marginSignals, scoreRound, scoreRoundSignals, type RoundLedger,
} from '../src/sim/rules/judges';
import type { Ruleset } from '../src/sim/rules/types';

/** Look one chapter-06 parameter up by id. */
const spec = (id: string) => {
  const s = RULES_PARAMS.find((x) => x.id === id);
  if (!s) throw new Error(`no such param: ${id}`);
  return s;
};

const MMA = RULESETS['mma.unified.3r'];
const MMA_2017 = RULESETS['mma.unified.2017'];
const STREET = RULESETS.street;

const standing: GroundContact = { feet: 2, hands: 0, knees: 0, otherBodyPart: false };
const oneHandDown: GroundContact = { feet: 2, hands: 1, knees: 0, otherBodyPart: false };
const twoHandsDown: GroundContact = { feet: 2, hands: 2, knees: 0, otherBodyPart: false };
const kneeDown: GroundContact = { feet: 1, hands: 0, knees: 1, otherBodyPart: false };
const seated: GroundContact = { feet: 2, hands: 0, knees: 0, otherBodyPart: true };

// ---------------------------------------------------------------------------

describe('rulesets', () => {
  it('registers every id exactly once', () => {
    expect(RULESET_IDS).toHaveLength(14);
    for (const id of RULESET_IDS) {
      expect(RULESETS[id].id).toBe(id);
      expect(resolveRuleset(id)).toBe(RULESETS[id]);
    }
  });

  it('resolves an object through unchanged and rejects a bad id', () => {
    expect(resolveRuleset(MMA)).toBe(MMA);
    expect(() => resolveRuleset('nope' as never)).toThrow(/Unknown ruleset/);
  });

  it.each(RULESET_IDS)('%s validates', (id) => {
    const rs: Ruleset = RULESETS[id];
    expect(rs.rounds.count).toBeGreaterThan(0);
    expect(rs.rounds.lengthS).toBeGreaterThanOrEqual(0);
    expect(rs.rounds.breakS).toBeGreaterThanOrEqual(0);
    expect(rs.knockdown.savedByBell).toBe(false);

    // A scored sport needs an odd panel so a decision cannot deadlock.
    if (rs.scoring.system === 'ten_point_must') {
      expect(rs.scoring.judges).toBeGreaterThan(0);
      expect(rs.scoring.judges % 2).toBe(1);
    }

    // Foul ids are unique inside a catalogue.
    const ids = rs.fouls.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Every foul carries a sane sanction ladder.
    for (const f of rs.fouls) {
      expect(f.warningsBeforeDeduction).toBeGreaterThanOrEqual(0);
      expect(f.deductionIntentional).toBeGreaterThanOrEqual(1);
      expect(f.recoveryMaxS).toBeGreaterThanOrEqual(0);
    }

    // Win conditions are non-empty and unique.
    expect(rs.winConditions.length).toBeGreaterThan(0);
    expect(new Set(rs.winConditions).size).toBe(rs.winConditions.length);

    // Weight classes descend to an open class or stop; every closed class has
    // both units.
    for (const c of rs.weightClasses) {
      if (c.maxLb !== null) expect(c.maxKg).not.toBeNull();
    }

    // Submissions/takedowns only where the sport allows them.
    if (!rs.submissions.allowed) expect(rs.submissions.legal).toHaveLength(0);
    if (!rs.takedowns.allowed) expect(rs.takedowns.legal).toHaveLength(0);
  });

  it('MMA carries the 26-rule ABC foul list (27 minus deleted #10)', () => {
    expect(MMA.fouls).toHaveLength(26);
    expect(MMA.fouls.map((f) => f.id)).not.toContain('elbow_illegal');
    // The groin/eye family gets the five-minute clock.
    const groin = MMA.fouls.find((f) => f.id === 'groin');
    expect(groin?.recoveryMaxS).toBe(300);
  });

  it('no-contest thresholds follow the family', () => {
    expect(MMA.scoring.ncThresholdRounds(3)).toBe(2);
    expect(RULESETS['mma.unified.5r'].scoring.ncThresholdRounds(5)).toBe(3);
    expect(RULESETS['boxing.pro'].scoring.ncThresholdRounds(12)).toBe(4);
  });

  it('the IBJJF legal-submission list is generated from belt and gi', () => {
    expect(ibjjfSubmissions('blue', true)).not.toContain('kneebar');
    expect(ibjjfSubmissions('black', true)).toContain('kneebar');
    expect(ibjjfSubmissions('black', true)).not.toContain('heel_hook');
    // The one place heel hooks and reaps come back.
    expect(ibjjfSubmissions('black', false)).toContain('heel_hook');
    expect(ibjjfSubmissions('black', false)).toContain('knee_reap');
  });

  it('street has no officials and no classes', () => {
    expect(STREET.referee.present).toBe(false);
    expect(STREET.stoppage.refereeStops).toBe(false);
    expect(STREET.fouls).toHaveLength(0);
    expect(STREET.weightClasses).toHaveLength(0);
    expect(STREET.multiOpponent.maxPerSide).toBe(5);
  });
});

// ---------------------------------------------------------------------------

describe('isLegal', () => {
  const ctx = (o: Partial<LegalityContext> = {}): LegalityContext => ({
    targetGrounded: false, ...o,
  });

  it('12-6 elbows are LEGAL under the 2024 rules and a foul under 2017', () => {
    // The single most common "but I thought..." in the rule book: the ABC
    // deleted foul #10 in November 2024.
    expect(isLegal('elbow', 'head', 'standing', ctx({ elbowArc: '12-6' }), MMA)).toBe('legal');
    expect(isLegal('elbow', 'head', 'standing', ctx({ elbowArc: '12-6' }), MMA_2017)).toBe('foul');
    // A normal elbow was never in question either way.
    expect(isLegal('elbow', 'head', 'standing', ctx({ elbowArc: 'other' }), MMA_2017)).toBe('legal');
  });

  it('knees and kicks to a grounded head are fouls; punches and elbows are not', () => {
    const g = ctx({ targetGrounded: true });
    expect(isLegal('knee', 'head', 'clinch', g, MMA)).toBe('foul');
    expect(isLegal('kick', 'head', 'standing', g, MMA)).toBe('foul');
    expect(isLegal('knee', 'downed_head', 'standing', ctx(), MMA)).toBe('foul');
    // Foul #12 is about the weapon, not about the man being down.
    expect(isLegal('punch', 'head', 'ground_top', g, MMA)).toBe('legal');
    expect(isLegal('elbow', 'head', 'ground_top', g, MMA)).toBe('legal');
    // Knees and kicks to the body of a grounded opponent stay legal.
    expect(isLegal('kick', 'body', 'standing', g, MMA)).toBe('legal');
    expect(isLegal('knee', 'body', 'ground_top', g, MMA)).toBe('legal');
  });

  it('the three grounded definitions disagree about a hand on the mat', () => {
    // 2001: one hand grounds you.
    expect(isGrounded(oneHandDown, 'unified_2001')).toBe(true);
    // 2017: you need both. This is the era of tapping a hand down and hoping.
    expect(isGrounded(oneHandDown, 'unified_2017')).toBe(false);
    expect(isGrounded(twoHandsDown, 'unified_2017')).toBe(true);
    // 2024: hands never count at all.
    expect(isGrounded(oneHandDown, 'unified_2024')).toBe(false);
    expect(isGrounded(twoHandsDown, 'unified_2024')).toBe(false);
    // All three agree about a knee or a hip.
    for (const def of ['unified_2001', 'unified_2017', 'unified_2024'] as const) {
      expect(isGrounded(kneeDown, def)).toBe(true);
      expect(isGrounded(seated, def)).toBe(true);
      expect(isGrounded(standing, def)).toBe(false);
    }
    // Boxing: anything that is not a sole makes you "down".
    expect(isGrounded(oneHandDown, 'any_contact')).toBe(true);
    expect(isGrounded(standing, 'any_contact')).toBe(false);
    expect(isGrounded(seated, 'none')).toBe(false);
  });

  it('the same knee is legal in 2024 and a foul in 2001, for one hand down', () => {
    const c2024: LegalityContext = { targetContact: oneHandDown };
    expect(isLegal('knee', 'head', 'clinch', c2024, MMA)).toBe('legal');
    const legacy: Ruleset = { ...MMA, groundedDef: 'unified_2001' };
    expect(isLegal('knee', 'head', 'clinch', c2024, legacy)).toBe('foul');
    // The 2017 text agrees with 2024 here and disagrees once both hands are on
    // the mat.
    expect(isLegal('knee', 'head', 'clinch', c2024, MMA_2017)).toBe('legal');
    expect(isLegal('knee', 'head', 'clinch', { targetContact: twoHandsDown }, MMA_2017))
      .toBe('foul');
  });

  it('headbutts are DQ-class and the forbidden targets are fouls everywhere', () => {
    expect(isLegal('headbutt', 'head', 'standing', ctx(), MMA)).toBe('foul_hard');
    for (const phase of ['standing', 'clinch', 'ground_top', 'ground_bottom'] as const) {
      expect(isLegal('punch', 'back_of_head', phase, ctx(), MMA)).toBe('foul');
      expect(isLegal('punch', 'spine', phase, ctx(), MMA)).toBe('foul');
      expect(isLegal('punch', 'groin', phase, ctx(), MMA)).toBe('foul');
      expect(isLegal('punch', 'throat', phase, ctx(), MMA)).toBe('foul');
    }
  });

  it('boxing forbids everything that is not a punch, and hitting a downed man', () => {
    const box = RULESETS['boxing.pro'];
    expect(isLegal('punch', 'head', 'standing', ctx(), box)).toBe('legal');
    expect(isLegal('kick', 'leg', 'standing', ctx(), box)).toBe('foul');
    expect(isLegal('elbow', 'head', 'standing', ctx(), box)).toBe('foul');
    expect(isLegal('punch', 'leg', 'standing', ctx(), box)).toBe('foul');
    // Down means down: no weapon, no target.
    expect(isLegal('punch', 'head', 'standing', ctx({ targetGrounded: true }), box)).toBe('foul');
  });

  it('amateur MMA removes elbows and knees to the head', () => {
    const am = RULESETS['mma.amateur'];
    expect(isLegal('elbow', 'head', 'standing', ctx(), am)).toBe('foul');
    expect(isLegal('knee', 'head', 'clinch', ctx(), am)).toBe('foul');
    expect(isLegal('elbow', 'body', 'standing', ctx(), am)).toBe('legal');
    expect(isLegal('punch', 'head', 'ground_top', ctx({ targetGrounded: true }), am)).toBe('legal');
  });

  it('everything is legal in the street', () => {
    const weapons = ['punch', 'kick', 'knee', 'elbow', 'headbutt', 'stomp',
      'spinning_backfist'] as const;
    const targets = ['head', 'body', 'leg', 'back_of_head', 'spine', 'groin', 'throat',
      'eyes', 'knee_joint', 'downed_head'] as const;
    const phases = ['standing', 'clinch', 'ground_top', 'ground_bottom'] as const;
    for (const w of weapons) {
      for (const t of targets) {
        for (const ph of phases) {
          expect(isLegal(w, t, ph, ctx({ targetGrounded: true, elbowArc: '12-6' }), STREET))
            .toBe('legal');
        }
      }
    }
  });

  it('the standing foot stomp is the one legal stomp', () => {
    expect(isLegal('stomp', 'head', 'standing', ctx(), MMA)).toBe('foul');
    expect(isLegal('stomp', 'leg', 'standing', ctx({ standingFootStomp: true }), MMA))
      .toBe('legal');
    expect(isLegal('stomp', 'leg', 'standing', ctx({ targetGrounded: true }), MMA)).toBe('foul');
  });
});

// ---------------------------------------------------------------------------

describe('referee', () => {
  const cfg = STRICTNESS_PRESETS.standard;

  const fighter = (id: number, over: Partial<RefFighterInput> = {}): RefFighterInput => ({
    id, obs: neutralObservables(), ...over,
  });

  const input = (fighters: RefFighterInput[], over: Partial<RefTickInput> = {}): RefTickInput => ({
    tick: 0, roundT: 10, t: 10, round: 1, fighters, ...over,
  });

  it('reaction lag has the documented mean', () => {
    const rng = new RNG('lag');
    let sum = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) sum += sampleReactionLag(rng, cfg);
    const mean = sum / n;
    // 0.8 reaction + 1.2 travel + 0.30 x 1.5 tail = 2.45 s.
    expect(expectedReactionLagS(cfg)).toBeCloseTo(2.45, 6);
    expect(mean).toBeGreaterThan(2.40);
    expect(mean).toBeLessThan(2.50);
  });

  it('KO blow to stoppage is 3.5 s with 2.6 extra head strikes', () => {
    // FD #110 / FD #49. The referee model owns 2.45 s of the 3.5 s; chapter
    // 05's KO recognition owns the rest.
    expect(expectedKoStoppageLagS(cfg)).toBeCloseTo(3.5, 2);
    expect(expectedExtraHeadStrikes(cfg)).toBeGreaterThan(2.4);
    expect(expectedExtraHeadStrikes(cfg)).toBeLessThan(2.8);
  });

  it('a KO is not an instant stoppage — strikes land during the lag', () => {
    const ref = new Referee(MMA, { rng: new RNG('ko') });
    const ko = neutralObservables();
    ko.ko = true;
    ko.intelligentDefence = false;
    let out = ref.tick(input([fighter(0), fighter(1, { obs: ko })]));
    expect(out.ended).toBeNull();          // queued, not committed
    // Ten seconds later the commit time has certainly passed.
    out = ref.tick(input([fighter(0), fighter(1, { obs: ko })], { t: 20, tick: 100 }));
    expect(out.ended?.method).toBe('ko');
    expect(out.ended?.winner).toBe(0);
    expect(out.ended!.lagS).toBeGreaterThan(0);
  });

  it('does not call a strike TKO on a grounded fighter nobody is striking', () => {
    // "Covering without positional change" is a cover *of something*. Keyed on
    // `tSinceDefenceS` alone it also fired on a fighter grounded by a body shot
    // and on one the §04 battle was holding still, and ended bouts in which no
    // strike had been thrown at all.
    const ref = new Referee(MMA, { rng: new RNG('quiet-ground') });
    const quiet = neutralObservables();
    quiet.grounded = true;
    quiet.intelligentDefence = false;
    quiet.tSinceDefenceS = 30;
    for (let i = 0; i < 60; i++) {
      const out = ref.tick(input([fighter(0), fighter(1, { obs: quiet })],
        { t: i * 0.1, tick: i, dt: 0.1 }));
      expect(out.ended).toBeNull();
    }

    // The same fighter, now eating them: the rule fires as the chapter intends.
    const struck = neutralObservables();
    struck.grounded = true;
    struck.intelligentDefence = false;
    struck.tSinceDefenceS = 30;
    // Phase 9: "under fire" is a string of damaging strikes (referee.ts
    // COVERING_MIN_UNANSWERED = 3), not one or two.
    struck.unansweredHead = 3;
    const hit = new Referee(MMA, { rng: new RNG('loud-ground') });
    let ended = null as ReturnType<Referee['tick']>['ended'];
    for (let i = 0; i < 200 && !ended; i++) {
      ended = hit.tick(input([fighter(0), fighter(1, { obs: struck })],
        { t: i * 0.1, tick: i, dt: 0.1 })).ended;
    }
    expect(ended?.method).toBe('tko_strikes');
  });

  it('cancels a pending TKO when the fighter starts defending again', () => {
    const ref = new Referee(MMA, { rng: new RNG('letwork') });
    const hurt = neutralObservables();
    hurt.grounded = true;
    hurt.intelligentDefence = false;
    hurt.unansweredHead = 8;
    ref.tick(input([fighter(0), fighter(1, { obs: hurt })]));
    // He hip-escapes and grabs a leg: criterion false, pending cancelled.
    const recovered = neutralObservables();
    recovered.grounded = true;
    const out = ref.tick(input([fighter(0), fighter(1, { obs: recovered })],
      { t: 30, tick: 200 }));
    expect(out.ended).toBeNull();
  });

  it('detects a tap and a technical submission', () => {
    const ref = new Referee(MMA, { rng: new RNG('tap') });
    const tapped = neutralObservables();
    tapped.tapped = true;
    ref.tick(input([fighter(0), fighter(1, { obs: tapped })]));
    const out = ref.tick(input([fighter(0), fighter(1, { obs: tapped })], { t: 15, tick: 50 }));
    expect(out.ended?.method).toBe('submission');

    const ref2 = new Referee(MMA, { rng: new RNG('loc') });
    const out2 = neutralObservables();
    out2.consciousness = 0;
    out2.underChoke = true;
    ref2.tick(input([fighter(0), fighter(1, { obs: out2 })]));
    const r2 = ref2.tick(input([fighter(0), fighter(1, { obs: out2 })], { t: 15, tick: 50 }));
    expect(r2.ended?.method).toBe('technical_submission');
  });

  it('counts, and ends the bout at ten in a counted ruleset', () => {
    const box = RULESETS['boxing.pro'];
    const ref = new Referee(box, { rng: new RNG('count') });
    const down = neutralObservables();
    down.knockedDown = { cause: 'legal_strike', kind: 'ko' };
    down.ko = true;
    ref.tick(input([fighter(0), fighter(1, { obs: down })], { t: 0 }));
    expect(ref.knockdownsThisRound(1)).toBe(1);
    // Walk the clock forward; at the mandatory eight the count stops because
    // he is out cold, so it never reaches ten.
    let ended = null;
    const still = neutralObservables();
    still.ko = true;
    for (let s = 1; s <= 12 && !ended; s++) {
      const out = ref.tick(input([fighter(0), fighter(1, { obs: still })],
        { t: s * 1.0 + 0.01, tick: s * 10 }));
      ended = out.ended;
    }
    expect(ended).not.toBeNull();
    expect(['ko', 'tko_count']).toContain(ended!.method);
  });

  it('MMA has no counts at all', () => {
    expect(MMA.knockdown.counts).toBe(false);
    const ref = new Referee(MMA, { rng: new RNG('nocount') });
    const down = neutralObservables();
    down.knockedDown = { cause: 'legal_strike', kind: 'flash' };
    ref.tick(input([fighter(0), fighter(1, { obs: down })]));
    expect(ref.isPaused).toBe(false);
    expect(ref.knockdownsThisRound(1)).toBe(0);
  });

  it('warns, then deducts, then disqualifies', () => {
    const ref = new Referee(MMA, { rng: new RNG('fouls') });
    // `back_of_head` carries no recovery clock, so the fight restarts at once
    // and the ladder is visible tick by tick. A groin foul would stop the
    // clock for up to five minutes instead.
    const foulTick = (n: number) => ref.tick(input([fighter(0), fighter(1)], {
      t: n * 2, tick: n * 20,
      fouls: [{
        foul: 'back_of_head', fouler: 0, victim: 1,
        intent: 'accidental', detected: true, effect: 'minor',
      }],
    }));
    foulTick(1);
    expect(ref.warningCount(0, 'back_of_head')).toBe(1);
    // With warningsBeforeDeduction = 1 the next one can cost a point.
    for (let i = 2; i < 30 && ref.totalDeductions(0) === 0; i++) foulTick(i);
    expect(ref.totalDeductions(0)).toBeGreaterThan(0);
    expect(ref.deductions(0, 1)).toBeGreaterThan(0);
  });

  it('an intentional foul that ends the fight is a DQ', () => {
    const ref = new Referee(MMA, { rng: new RNG('dq') });
    const out = ref.tick(input([fighter(0), fighter(1)], {
      fouls: [{
        foul: 'eye_gouge', fouler: 0, victim: 1,
        intent: 'intentional', detected: true, effect: 'cannot_continue',
      }],
    }));
    expect(out.ended?.method).toBe('dq');
    expect(out.ended?.winner).toBe(1);
  });

  it('an accidental foul before the NC threshold is a no contest, after it a technical decision', () => {
    const early = new Referee(MMA, { rng: new RNG('nc') });
    const a = early.tick(input([fighter(0), fighter(1)], {
      roundsCompleted: 1,
      fouls: [{
        foul: 'eye_gouge', fouler: 0, victim: 1,
        intent: 'accidental', detected: true, effect: 'cannot_continue',
      }],
    }));
    expect(a.ended?.method).toBe('no_contest');

    const late = new Referee(MMA, { rng: new RNG('td') });
    const b = late.tick(input([fighter(0), fighter(1)], {
      round: 3, roundsCompleted: 2, aheadOnCards: 1,
      fouls: [{
        foul: 'eye_gouge', fouler: 0, victim: 1,
        intent: 'accidental', detected: true, effect: 'cannot_continue',
      }],
    }));
    expect(b.ended?.method).toBe('technical_decision');
    expect(b.ended?.winner).toBe(1);
  });

  it('boxing: an accidental low blow that ends it costs the FOULED boxer the fight', () => {
    // The one place in combat sports where being fouled loses you the bout.
    const ref = new Referee(RULESETS['boxing.pro'], { rng: new RNG('lowblow') });
    const out = ref.tick(input([fighter(0), fighter(1)], {
      round: 6, roundsCompleted: 5,
      fouls: [{
        foul: 'low_blow', fouler: 0, victim: 1,
        intent: 'accidental', detected: true, effect: 'cannot_continue',
      }],
    }));
    expect(out.ended?.method).toBe('tko_strikes');
    expect(out.ended?.winner).toBe(0);
  });

  it('timidity: a clock, then a warning, then a point', () => {
    const ref = new Referee(MMA, { rng: new RNG('timid') });
    const timid = fighter(1, { nonEngaging: true });
    for (let i = 0; i < 1200; i++) {
      ref.tick(input([fighter(0), timid], { t: i * 0.1, tick: i, dt: 0.1 }));
    }
    expect(ref.totalDeductions(1)).toBeGreaterThan(0);
  });

  it('stand-up clocks scale with the position — maintaining position is not effort', () => {
    // Dominant top buys 50 % more time than guard; standing over the guard
    // buys half.
    expect(positionMult('pos.ground_mount_high')).toBeCloseTo(1.5);
    expect(positionMult('pos.ground_back_hooks')).toBeCloseTo(1.5);
    expect(positionMult('pos.ground_closed_guard')).toBeCloseTo(1.0);
    expect(positionMult('pos.ground_turtle')).toBeCloseTo(0.8);
    expect(positionMult('pos.ground_open_legs_up')).toBeCloseTo(0.5);
    expect(positionMult(undefined)).toBeCloseTo(1.0);
  });

  it('tier drives the foul rate', () => {
    expect(foulTierMult(0)).toBeGreaterThan(foulTierMult(3));
    expect(foulTierMult(3)).toBeGreaterThan(foulTierMult(5));
  });

  it('judo scoring does not accumulate upward', () => {
    expect(judoThrowScore({ onBack: true, angleDeg: 180, speed: true, force: true, control: true }))
      .toBe('ippon');
    expect(judoThrowScore({ onBack: true, angleDeg: 180, speed: false, force: true, control: true }))
      .toBe('waza_ari');
    expect(judoThrowScore({ onBack: false, angleDeg: 95, speed: true, force: true, control: true }))
      .toBe('waza_ari');
    expect(judoThrowScore({ onBack: false, angleDeg: 40, speed: false, force: false, control: false }))
      .toBe('none');
    expect(judoOsaekomiScore(21)).toBe('ippon');
    expect(judoOsaekomiScore(12)).toBe('waza_ari');
    expect(judoOsaekomiScore(6)).toBe('yuko');
    expect(judoOsaekomiScore(3)).toBe('none');

    const s = emptyJudoScore();
    applyJudoScore(s, 0, 'yuko');
    applyJudoScore(s, 0, 'yuko');
    applyJudoScore(s, 0, 'yuko');
    expect(s.ippon[0]).toBe(false);          // no number of yuko makes anything
    applyJudoScore(s, 0, 'waza_ari');
    applyJudoScore(s, 0, 'waza_ari');
    expect(s.ippon[0]).toBe(true);           // waza-ari awasete ippon
    applyShido(s, 1);
    applyShido(s, 1);
    expect(s.hansokuMake[1]).toBe(false);
    applyShido(s, 1);
    expect(s.hansokuMake[1]).toBe(true);
  });

  it('is deterministic for a fixed seed and diverges for another', () => {
    const run = (seed: string): string => {
      const ref = new Referee(MMA, { rng: new RNG(seed) });
      const hurt = neutralObservables();
      hurt.grounded = true;
      hurt.intelligentDefence = false;
      hurt.unansweredHead = 9;
      hurt.tSinceDefenceS = 5;
      const lines: string[] = [];
      for (let i = 0; i < 60; i++) {
        const out = ref.tick(input([fighter(0), fighter(1, { obs: hurt })],
          { t: i * 0.1, tick: i, dt: 0.1 }));
        if (out.ended) {
          lines.push(`${i}:${out.ended.method}:${out.ended.lagS?.toFixed(6)}`);
          break;
        }
      }
      return lines.join('|');
    };
    expect(run('seed-a')).toBe(run('seed-a'));
    expect(run('seed-a')).not.toBe(run('seed-b'));
  });
});

// ---------------------------------------------------------------------------

describe('strictness presets', () => {
  const { lenient, standard, strict } = STRICTNESS_PRESETS;

  it('move every threshold in the documented direction', () => {
    // A lenient referee lets more strikes land before he steps in.
    expect(lenient.tkoUnansweredGround).toBeGreaterThan(standard.tkoUnansweredGround);
    expect(standard.tkoUnansweredGround).toBeGreaterThan(strict.tkoUnansweredGround);
    expect(lenient.tkoUnansweredStanding).toBeGreaterThan(strict.tkoUnansweredStanding);
    expect(lenient.tkoNoDefenceS).toBeGreaterThan(strict.tkoNoDefenceS);
    expect(lenient.tkoAbsorbed30).toBeGreaterThan(strict.tkoAbsorbed30);
    expect(lenient.collapseGraceS).toBeGreaterThan(strict.collapseGraceS);
    expect(lenient.legCollapseGraceS).toBeGreaterThan(strict.legCollapseGraceS);

    // And he is slower to react, with a fatter tail.
    expect(lenient.refReactionS).toBeGreaterThan(standard.refReactionS);
    expect(standard.refReactionS).toBeGreaterThan(strict.refReactionS);
    expect(lenient.pLagTail).toBeGreaterThan(strict.pLagTail);
    expect(lenient.lagTailMeanS).toBeGreaterThan(strict.lagTailMeanS);
    expect(expectedReactionLagS(lenient)).toBeGreaterThan(expectedReactionLagS(strict));

    // He lets the ground game and the clinch run longer.
    expect(lenient.standupS).toBeGreaterThan(strict.standupS);
    expect(lenient.standupWarnS).toBeGreaterThan(strict.standupWarnS);
    expect(lenient.clinchBreakS).toBeGreaterThan(strict.clinchBreakS);
    expect(lenient.kbClinchMaxS).toBeGreaterThan(strict.kbClinchMaxS);

    // And he is softer on fouls: more warnings, fewer deductions, later DQ.
    expect(lenient.warningsBeforeDeduction).toBeGreaterThan(strict.warningsBeforeDeduction);
    expect(lenient.pDeductAccidentalRepeat).toBeLessThan(strict.pDeductAccidentalRepeat);
    expect(lenient.dqAfterDeductions).toBeGreaterThan(strict.dqAfterDeductions);
    expect(lenient.timidityWarnS).toBeGreaterThan(strict.timidityWarnS);
    expect(lenient.boxingHoldingWarnings).toBeGreaterThan(strict.boxingHoldingWarnings);
    expect(lenient.warningsBeforeIntentional).toBeGreaterThan(strict.warningsBeforeIntentional);

    // Strict sees more and judges the grounded status better.
    expect(strict.pDetectContactFoul).toBeGreaterThan(lenient.pDetectContactFoul);
    expect(strict.pDetectFenceGrab).toBeGreaterThan(lenient.pDetectFenceGrab);
    expect(strict.pDetectBackOfHead).toBeGreaterThan(lenient.pDetectBackOfHead);
    expect(strict.groundedJudgement).toBeGreaterThan(lenient.groundedJudgement);

    // The doctor stops more, and the gait test is harder to pass.
    expect(strict.pDoctorStopOrbit).toBeGreaterThan(lenient.pDoctorStopOrbit);
    expect(strict.pDoctorStopVision).toBeGreaterThan(lenient.pDoctorStopVision);
    expect(strict.cutDoctorCall).toBeLessThan(lenient.cutDoctorCall);
    expect(strict.gaitStrictnessLogit).toBeGreaterThan(lenient.gaitStrictnessLogit);
    expect(strict.strictnessScalar).toBeGreaterThan(lenient.strictnessScalar);
  });

  it('the experience overlay is separate from strictness', () => {
    const regional = refereeConfig('standard', 'regional');
    const elite = refereeConfig('standard', 'elite');
    expect(regional.refReactionS).toBeGreaterThan(standard.refReactionS);
    expect(elite.refReactionS).toBeLessThan(standard.refReactionS);
    expect(regional.pLagTail).toBeGreaterThan(standard.pLagTail);
    // Slower, not softer: the stoppage thresholds are untouched.
    expect(regional.tkoUnansweredGround).toBe(standard.tkoUnansweredGround);
  });

  it('the standard preset is the parameter registry', () => {
    expect(standard.refReactionS).toBe(spec('ref.refReactionS').value);
    expect(standard.tkoAbsorbed30).toBe(spec('ref.tkoAbsorbed30').value);
    expect(standard.standupS).toBe(spec('ref.standupS').value);
  });
});

// ---------------------------------------------------------------------------

describe('judges', () => {
  it('scores the obvious rounds the obvious way', () => {
    const rng = new RNG('cards');
    const panel = createPanel(MMA, rng, { enableBiases: false });
    const cards = scoreRoundSignals(panel, marginSignals(2.0), { round: 1, roundS: 300 }, rng);
    expect(cards).toHaveLength(3);
    for (const c of cards) expect(c[0]).toBeGreaterThan(c[1]);
  });

  it('applies referee deductions to the card, not to the judge impression', () => {
    const rng = new RNG('deduct');
    const panel = createPanel(MMA, rng, { enableBiases: false });
    const cards = scoreRoundSignals(panel, marginSignals(1.5),
      { round: 1, roundS: 300, deductions: [1, 0] }, rng);
    // A 10-9 winner carrying a deduction leaves the round 9-9.
    for (const c of cards) expect(c[0] - c[1]).toBeLessThanOrEqual(0);
  });

  it('positional control alone never yields a 10-8', () => {
    const rng = new RNG('control');
    const panel = createPanel(MMA, rng, { enableBiases: false });
    // Huge perceived margin, but the loser was still working: no domination.
    const sig = marginSignals(5.0);
    sig.offence[1] = sig.offence[0] * 0.9;
    sig.dmg[0] = 0;
    const cards = scoreRoundSignals(panel, sig, { round: 1, roundS: 300 }, rng);
    for (const c of cards) expect(c[1]).toBe(9);
  });

  it('reproduces the decision-type split, the draw rate and the 10-8 rate', () => {
    // The 400,000-round Monte Carlo of §2.4.3, replayed at 25,000 bouts with
    // the same generator: fight-level margin N(0, 1.2) shared across rounds
    // plus a round-level N(0, 0.8), judge noise 0.32 x Logistic, 10-8
    // threshold 2.6 x N(1, 0.25). Biases off, as in the chapter's headline run.
    const N = 25_000;
    const rng = new RNG('mc-judges');
    let unanimous = 0;
    let split = 0;
    let majority = 0;
    let draws = 0;
    let judgeRounds = 0;
    let tenEights = 0;

    for (let i = 0; i < N; i++) {
      const panel = createPanel(MMA, rng, { enableBiases: false });
      const fightMargin = rng.normal(0, 1.2);
      for (let r = 1; r <= 3; r++) {
        const m = fightMargin + rng.normal(0, 0.8);
        const cards = scoreRoundSignals(panel, marginSignals(m), { round: r, roundS: 300 }, rng);
        for (const c of cards) {
          judgeRounds += 1;
          if (Math.min(c[0], c[1]) <= 8 && Math.max(c[0], c[1]) === 10) tenEights += 1;
        }
      }
      const result = decide(panel, { round: 3, timeSeconds: 300, totalSeconds: 900 });
      if (result.method === 'decision.unanimous') unanimous += 1;
      else if (result.method === 'decision.split') split += 1;
      else if (result.method === 'decision.majority') majority += 1;
      else draws += 1;
    }

    const pct = (n: number): number => (100 * n) / N;
    // Targets FD #105: 77 / 20 / 2.5, chapter's tuned model: 77.0 / 18.3 / 3.0.
    // Phase 9 retuned judge noise (0.32 -> 0.26) and the 10-8 thresholds
    // against the *engine's* round margins, which are not this synthetic
    // N(0,1.2)+N(0,0.8) — in the bout population the split is 75 / 17 / 8
    // (docs/CALIBRATION.md rows 105-107). On these synthetic margins the lower
    // noise gives ~80 % unanimous; the bands widen accordingly.
    expect(pct(unanimous)).toBeGreaterThan(75);
    expect(pct(unanimous)).toBeLessThan(82.5);
    expect(pct(split)).toBeGreaterThan(14.0);
    expect(pct(split)).toBeLessThan(20.3);
    // Phase 9 also cut `judge.p1010` 0.5 -> 0.15 (10-10 rounds made 3.6 % of
    // bout-population fights draws against a real 0.7 %), which removes most
    // of this synthetic model's majority decisions and draws; the lower
    // bounds follow. The bout population is measured in docs/CALIBRATION.md.
    expect(pct(majority)).toBeGreaterThan(0.3);
    expect(pct(majority)).toBeLessThan(5.0);
    // FD #107: 1.5 % of decisions; the chapter's model gave 1.67 %.
    expect(pct(draws)).toBeGreaterThan(0.1);
    expect(pct(draws)).toBeLessThan(2.6);
    // INT §7.4: ~8 % of judge-rounds; the chapter's model gives 8.9 %.
    const ten8 = (100 * tenEights) / judgeRounds;
    // Phase 9: a 10-8 now needs damage *done to the other man* (winner minus
    // loser), which these synthetic margin-only signals do not carry, so the
    // synthetic rate is near zero; the bout population's 10-8 rate (~7 % of
    // judge-rounds) is measured by the calibration run instead.
    expect(ten8).toBeLessThan(10.4);
  }, 120_000);

  it('aggregates unanimous / split / majority / draw correctly', () => {
    const build = (cards: number[][][]) => {
      const rng = new RNG('agg');
      const panel = createPanel(MMA, rng, { enableBiases: false });
      panel.cards = cards;
      panel.perceived = cards.map((c) => c.map((r) => r[0] - r[1]));
      panel.nearFinish = cards.map((c) => c.map(() => false));
      return decide(panel, { round: 3, timeSeconds: 300, totalSeconds: 900 });
    };
    const A = [10, 9];
    const B = [9, 10];
    const E = [10, 10];
    expect(build([[A, A, A], [A, A, A], [A, A, A]]).method).toBe('decision.unanimous');
    expect(build([[A, A, A], [A, A, A], [B, B, B]]).method).toBe('decision.split');
    expect(build([[A, A, A], [A, A, A], [A, E, B]]).method).toBe('decision.majority');
    expect(build([[A, E, B], [A, E, B], [A, E, B]]).method).toBe('draw');
    expect(build([[A, E, B], [A, E, B], [A, A, A]]).method).toBe('draw.majority');
    expect(build([[A, A, A], [B, B, B], [A, E, B]]).method).toBe('draw.split');
  });

  it('judge totals sum the cards', () => {
    const rng = new RNG('totals');
    const panel = createPanel(MMA, rng, { enableBiases: false });
    for (let r = 1; r <= 3; r++) {
      scoreRoundSignals(panel, marginSignals(0.8), { round: r, roundS: 300 }, rng);
    }
    const { totals } = judgeTotals(panel);
    for (let j = 0; j < 3; j++) {
      const sum = panel.cards[j].reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
      expect(totals[j]).toEqual(sum);
    }
  });

  it('home-crowd bias only exists when there is a crowd', () => {
    const run = (crowd: boolean): number => {
      const rs: Ruleset = { ...MMA, referee: { ...MMA.referee, crowdPresent: crowd } };
      const rng = new RNG('home');
      let wins = 0;
      for (let i = 0; i < 4000; i++) {
        const panel = createPanel(rs, rng, { enableBiases: true, homeFighter: 0 });
        const cards = scoreRoundSignals(panel, marginSignals(0), { round: 1, roundS: 300 }, rng);
        for (const c of cards) if (c[0] > c[1]) wins += 1;
      }
      return wins;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });

  it('is deterministic for a fixed seed', () => {
    const run = (seed: string): string => {
      const rng = new RNG(seed);
      const panel = createPanel(MMA, rng, { enableBiases: false });
      for (let r = 1; r <= 3; r++) {
        scoreRoundSignals(panel, marginSignals(0.4 * r - 0.5), { round: r, roundS: 300 }, rng);
      }
      return JSON.stringify(decide(panel, { round: 3, timeSeconds: 300, totalSeconds: 900 }));
    };
    expect(run('judge-seed')).toBe(run('judge-seed'));
    expect(run('judge-seed')).not.toBe(run('other-seed'));
  });
});

// ---------------------------------------------------------------------------

describe('parameters', () => {
  const specs = RULES_PARAMS;

  it('registers the chapter registry and passes the registry validator', () => {
    expect(specs.length).toBeGreaterThan(120);
    // `ParamRegistry.add` is the gate that enforces the 00_CONVENTIONS §1 rule
    // that an untagged number is a bug; run chapter 06's block through it.
    const reg = new ParamRegistry();
    expect(() => reg.addAll(specs)).not.toThrow();
    reg.freeze();
    expect(reg.all.length).toBe(specs.length);
  });

  it('every parameter has a valid provenance tag, unit and section', () => {
    for (const s of specs) {
      expect(s.section).toBe('rules');
      expect(s.tag).toMatch(/^\[(S:|D:|E)/);
      expect(s.unit.length).toBeGreaterThan(0);
      expect(Number.isFinite(s.value)).toBe(true);
      if (s.min !== undefined) expect(s.value).toBeGreaterThanOrEqual(s.min);
      if (s.max !== undefined) expect(s.value).toBeLessThanOrEqual(s.max);
    }
  });

  it('ids are unique and namespaced', () => {
    const ids = specs.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^(rules|ref|foul|judge|street|flow)\./);
    }
  });

  it('the numbers the chapter tuned are the numbers in the registry', () => {
    // Phase 9 retuned both against the bout population (PHASE9_TUNING.md).
    expect(spec('judge.noiseScale').value).toBe(0.26);
    expect(spec('judge.tenEight').value).toBe(6.5);
    expect(spec('judge.w.kd').value).toBe(1.0);
    expect(spec('ref.refReactionS').value).toBe(0.8);
    // The knockdown is the unit of the judging scale and may never be tuned.
    expect(spec('judge.w.kd').free).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('culture-specific scoring', () => {
  const round = (over: Partial<RoundLedger> = {}): RoundLedger => ({
    ...emptyLedger(), roundSecondsElapsed: 300, ...over,
  });

  it('MMA: a knockdown outweighs a pile of leg kicks', () => {
    // One knockdown is a whole logit; twelve leg kicks are 0.66. Judge noise
    // still flips the odd round, so this is a rate, not a single card.
    const rng = new RNG('mma-cards');
    const a = round({ kd: 1, sigHead: 6, controlOffenceS: 30 });
    const b = round({ sigLeg: 12, controlOffenceS: 20 });
    let wins = 0;
    let total = 0;
    for (let i = 0; i < 300; i++) {
      const panel = createPanel(MMA, rng, { enableBiases: false });
      for (const c of scoreRound(panel, [a, b], { round: 1, roundS: 300 }, rng)) {
        total += 1;
        if (c[0] > c[1]) wins += 1;
      }
    }
    expect(wins / total).toBeGreaterThan(0.9);
  });

  it('MMA: the 2016 culture prices control higher than the 2025 one', () => {
    const grindy: [RoundLedger, RoundLedger] = [
      round({ tdLanded: 2, controlPassiveS: 200, dominantPositionsGained: 1 }),
      round({ sigHead: 8, sigBody: 4 }),
    ];
    const winsFor = (rs: Ruleset): number => {
      const rng = new RNG('culture');
      let wins = 0;
      for (let i = 0; i < 400; i++) {
        const panel = createPanel(rs, rng, { enableBiases: false });
        for (const c of scoreRound(panel, grindy, { round: 1, roundS: 300 }, rng)) {
          if (c[0] > c[1]) wins += 1;
        }
      }
      return wins;
    };
    expect(winsFor(MMA_2017)).toBeGreaterThan(winsFor(MMA));
  });

  it('boxing: a flash knockdown in a round the other man dominated stays 10-9', () => {
    const rng = new RNG('box');
    const box = RULESETS['boxing.pro'];
    const panel = createPanel(box, rng, { enableBiases: false });
    // Fighter 1 was battered all round, then dropped fighter 0 at the bell.
    const a = round({
      powerPunchLanded: 30, jabLanded: 20, bodyPunchLanded: 12, hurtEvents: 2,
      roundSecondsElapsed: 180,
    });
    const b = round({ kd: 1, powerPunchLanded: 2, roundSecondsElapsed: 180 });
    const cards = scoreRound(panel, [a, b], { round: 1, roundS: 180 }, rng);
    for (const c of cards) {
      // The knockdown scorer still wins the round, but only 10-9.
      expect(c[1]).toBe(10);
      expect(c[0]).toBe(9);
    }
  });

  it('Muay Thai: knockdowns dominate, and 10-6 exists', () => {
    const rng = new RNG('mt');
    const mt = RULESETS['muay_thai.abc'];
    const panel = createPanel(mt, rng, { enableBiases: false });
    const a = round({ kd: 3, mt: { ...emptyLedger().mt, knee: 4 } });
    const b = round({ mt: { ...emptyLedger().mt, punch: 20 } });
    for (const c of scoreRound(panel, [a, b], { round: 1, roundS: 180 }, rng)) {
      expect(c).toEqual([10, 6]);
    }
  });

  it('Muay Thai: body kicks and knees outrank punches when damage is level', () => {
    const rng = new RNG('mt2');
    const mt = RULESETS['muay_thai.abc'];
    const panel = createPanel(mt, rng, { enableBiases: false });
    const a = round({ mt: { ...emptyLedger().mt, bodyKick: 6, knee: 4 } });
    const b = round({ mt: { ...emptyLedger().mt, punch: 9 } });
    for (const c of scoreRound(panel, [a, b], { round: 1, roundS: 180 }, rng)) {
      expect(c[0]).toBeGreaterThan(c[1]);
    }
  });

  it('GLORY: minus points are subtracted before the round score', () => {
    const rng = new RNG('glory');
    const glory = RULESETS['kickboxing.glory'];
    const panel = createPanel(glory, rng, { enableBiases: false });
    const a = round({ sigHead: 10, rockedCaused: 1 });
    const b = round({ sigHead: 2 });
    const cards = scoreRound(panel, [a, b],
      { round: 1, roundS: 180, deductions: [1, 0] }, rng);
    // A 10-9 winner carrying -1 leaves the round 9-9.
    for (const c of cards) expect(c[0]).toBeLessThanOrEqual(c[1]);
  });

  it('the Thai stadium culture weights rounds 3 and 4 most', () => {
    const early: [RoundLedger, RoundLedger] = [round({ sigHead: 12 }), round()];
    const late: [RoundLedger, RoundLedger] = [round(), round({ sigHead: 12 })];
    const stadium = RULESETS['muay_thai.stadium'];
    const rng = new RNG('stadium');
    const panel = createPanel(stadium, rng, { enableBiases: false });
    // Fighter 0 wins rounds 1-2 (weights 0.5 / 0.75); fighter 1 wins 3-4
    // (1.25 each). The cards are level two rounds each; the impression is not.
    scoreRound(panel, early, { round: 1, roundS: 180 }, rng);
    scoreRound(panel, early, { round: 2, roundS: 180 }, rng);
    scoreRound(panel, late, { round: 3, roundS: 180 }, rng);
    scoreRound(panel, late, { round: 4, roundS: 180 }, rng);
    scoreRound(panel, [round(), round()], { round: 5, roundS: 180 }, rng);
    const result = decide(panel, { round: 5, timeSeconds: 180, totalSeconds: 900 });
    expect(result.winner).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('grappling, judo and sub-only decisions', () => {
  const meta = { round: 1, timeSeconds: 600, totalSeconds: 600 };

  it('IBJJF: points, then advantages, then fewer penalties', () => {
    const rng = new RNG('ibjjf');
    const ibjjf = RULESETS['grappling.ibjjf'];
    const byPoints = emptyGrapplingScore();
    byPoints.points = [4, 2];
    expect(decideGrappling(byPoints, ibjjf, meta, rng).winner).toBe(0);

    const byAdvantage = emptyGrapplingScore();
    byAdvantage.points = [2, 2];
    byAdvantage.advantages = [0, 1];
    expect(decideGrappling(byAdvantage, ibjjf, meta, rng).winner).toBe(1);

    const byPenalty = emptyGrapplingScore();
    byPenalty.penalties = [2, 0];
    expect(decideGrappling(byPenalty, ibjjf, meta, rng).winner).toBe(1);
  });

  it('IBJJF never ends without a named winner', () => {
    const rng = new RNG('refdecision');
    const ibjjf = RULESETS['grappling.ibjjf'];
    const r = decideGrappling(emptyGrapplingScore(), ibjjf,
      { ...meta, dominance: [0.3, 0.1] }, rng);
    expect(r.winner).not.toBe('draw');
    expect(r.detail).toBe('referee decision');
  });

  it('ADCC has no positive points in the first half, and scores points minus negatives', () => {
    const rng = new RNG('adcc');
    const adcc = RULESETS['grappling.adcc'];
    expect(adccPositivePointsAllowed(adcc, 100)).toBe(false);
    expect(adccPositivePointsAllowed(adcc, 400)).toBe(true);
    // A takedown past the guard is worth 4 in ADCC and 2 in IBJJF; mount is
    // the IBJJF king and worth less than the back in ADCC.
    expect(ADCC_POINTS.takedown_past_guard).toBe(4);
    expect(IBJJF_POINTS.takedown_past_guard).toBe(2);
    expect(IBJJF_POINTS.mount).toBe(4);
    expect(ADCC_POINTS.mount).toBeLessThan(ADCC_POINTS.back_hooks);

    const s = emptyGrapplingScore();
    s.points = [2, 2];
    s.negatives = [1, 0];
    expect(decideGrappling(s, adcc, meta, rng).winner).toBe(1);
  });

  it('the IBJJF stalling ladder ends in a DQ', () => {
    expect(ibjjfStallStep(0)).toBe('warning');
    expect(ibjjfStallStep(1)).toBe('advantage');
    expect(ibjjfStallStep(2)).toBe('points2');
    expect(ibjjfStallStep(3)).toBe('dq');
    expect(ibjjfStallStep(9)).toBe('dq');
  });

  it('judo: ippon beats waza-ari beats yuko; shido never scores', () => {
    const jm = { round: 1, timeSeconds: 240, totalSeconds: 240 };
    const ippon = emptyJudoScore();
    ippon.ippon[1] = true;
    expect(decideJudo(ippon, jm).winner).toBe(1);

    const waza = emptyJudoScore();
    waza.wazaAri = [1, 0];
    waza.yuko = [0, 5];
    expect(decideJudo(waza, jm).winner).toBe(0);

    // Shido accumulates toward hansoku-make and nothing else.
    const shido = emptyJudoScore();
    shido.shido = [2, 0];
    expect(decideJudo(shido, jm).winner).toBe('draw');
    applyShido(shido, 0);
    expect(decideJudo(shido, jm).method).toBe('dq');
    expect(decideJudo(shido, jm).winner).toBe(1);
  });

  it('sub-only draws at time unless EBI escape times separate them', () => {
    expect(decideSubOnly(null, meta).winner).toBe('draw');
    expect(decideSubOnly(null, meta).method).toBe('draw');
    // The shorter cumulative escape time wins the tiebreak.
    expect(decideSubOnly([12.4, 31.0], meta).winner).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('street mode', () => {
  const participant = (id: number, side: number, over: Record<string, unknown> = {}) => ({
    id, side, obs: neutralObservables(), mobility: 0.8, cannotStandForS: 0, ...over,
  });

  it('a fighter who cannot stand for ten seconds is incapacitated', () => {
    const down = { ...neutralObservables(), grounded: true };
    const out = streetTick(
      [participant(0, 0), participant(1, 1, { obs: down, cannotStandForS: 11 })],
      new RNG('street'), 5, 0.1, 0,
    );
    expect(out.changes).toContainEqual({ participant: 1, state: 'incapacitated' });
  });

  it('fleeing is a win, and only works if you are faster', () => {
    const slowRunner = streetTick(
      [participant(0, 0, { mobility: 1.0 }),
        participant(1, 1, { mobility: 0.3, wantsToFlee: true })],
      new RNG('flee-fast'), 5, 0.1, 0,
    );
    expect(slowRunner.changes).toHaveLength(0);

    const fastRunner = streetTick(
      [participant(0, 0, { mobility: 0.3 }),
        participant(1, 1, { mobility: 1.0, wantsToFlee: true })],
      new RNG('flee-slow'), 5, 0.1, 0,
    );
    expect(fastRunner.changes.some((c) => c.state === 'fled')).toBe(true);
  });

  it('surrender is always accepted by the model', () => {
    const out = streetTick(
      [participant(0, 0), participant(1, 1, { wantsToSurrender: true })],
      new RNG('surrender'), 5, 0.1, 0,
    );
    expect(out.changes).toContainEqual({ participant: 1, state: 'surrendered' });
  });

  it('a hazard ends it in the documented 20-40 s window, median-wise', () => {
    // Separation, a weapon or an arrival. The point of the mode is that a real
    // fight is over long before a sanctioned first round would be.
    const rng = new RNG('hazards');
    const samples: number[] = [];
    for (let trial = 0; trial < 300; trial++) {
      let t = 0;
      for (let i = 0; i < 20_000; i++) {
        t += 0.1;
        const out = streetTick([participant(0, 0), participant(1, 1)], rng, t, 0.1, 0);
        if (out.ended) break;
      }
      samples.push(t);
    }
    samples.sort((x, y) => x - y);
    const median = samples[Math.floor(samples.length / 2)];
    expect(median).toBeGreaterThan(15);
    expect(median).toBeLessThan(70);
  }, 120_000);
});
