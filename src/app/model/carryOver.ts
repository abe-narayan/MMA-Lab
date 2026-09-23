/**
 * TOURNAMENT CARRY-OVER — docs/design/09 §3.5.
 *
 * Between two bouts of the same tournament a fighter can arrive fresh, arrive
 * beaten up from an hour ago, or arrive months older with another knockout on
 * the record. The chapter fixes the numbers:
 *
 *   none        nothing carries. The default.
 *   sameNight   30 % of head damage, 50 % of body and leg damage, cuts in
 *               full, stamina restored to 85 %.
 *   career      the same, plus the chapter 01 KO-history counter (odds ratio
 *               1.13 per prior knockout) and the fighter ages by the gap.
 *
 * **What this module can and cannot do.** `SimConfig` has no "start this
 * fighter damaged" input — a bout begins with both fighters at zero, and
 * changing that would mean changing `src/sim`. So the damage half of the carry
 * is applied where the sim *does* read the fighter's state: as a penalty on
 * the attributes that govern taking and surviving damage. That is an
 * approximation and the tournament screen says so. The arithmetic of the
 * carry itself — the fractions above — is exact, lives in `carriedAfter`, and
 * is what the tests check.
 */

import type { BoutResult, FighterDefinition, SimEvent } from '../../sim';
import type { Tournament } from '../store/types';

export type CarryOverMode = Tournament['carryOver'];

/** Damage one fighter took in one bout, in pool units (0–1 of each pool). */
export interface DamageLedger {
  head: number;
  body: number;
  legs: number;
  /** Cuts opened or reopened. */
  cuts: number;
  knockdownsSuffered: number;
  /** True when this fighter lost by knockout or strike TKO. */
  koLoss: boolean;
}

export const EMPTY_LEDGER: DamageLedger = Object.freeze({
  head: 0, body: 0, legs: 0, cuts: 0, knockdownsSuffered: 0, koLoss: false,
});

/** What a fighter carries into the next bout. */
export interface CarriedState {
  head: number;
  body: number;
  legs: number;
  cuts: number;
  /** Fraction of full stamina available at the first bell. 1 = fresh. */
  staminaPct: number;
}

export const FRESH: CarriedState = Object.freeze({
  head: 0, body: 0, legs: 0, cuts: 0, staminaPct: 1,
});

/** 09 §3.5's fractions, verbatim. `career` carries the same damage as `sameNight`. */
export const CARRY_FRACTIONS: Readonly<Record<CarryOverMode, Readonly<{
  head: number; body: number; legs: number; cuts: number; staminaPct: number;
}>>> = Object.freeze({
  none: { head: 0, body: 0, legs: 0, cuts: 0, staminaPct: 1 },
  sameNight: { head: 0.30, body: 0.50, legs: 0.50, cuts: 1, staminaPct: 0.85 },
  career: { head: 0.30, body: 0.50, legs: 0.50, cuts: 1, staminaPct: 0.85 },
});

/** Chapter 01's KO-history odds ratio, quoted here for the UI note. */
export const KO_HISTORY_ODDS_RATIO = 1.13;

/**
 * Days between rounds under `career`. 09 §3.5 says the fighter "ages by the
 * scheduled gap", and the saved `Tournament` document has no field for a
 * schedule, so this is the schedule: a quarter of a year between rounds, which
 * is roughly a real promotion's cadence. The tournament screen states it.
 */
export const CAREER_GAP_DAYS = 90;

// --------------------------------------------------------------------------
// Reading a bout
// --------------------------------------------------------------------------

/**
 * Total damage a fighter absorbed, summed off the event stream rather than off
 * `BoutStats`: `computeStats` reports absorbed *significant strikes*, which is
 * a count, and what is needed here is the damage those strikes did per region.
 * Every `strike` event carries that as `detail.damage`.
 */
export function damageLedger(
  events: readonly SimEvent[],
  fighter: number,
  result?: BoutResult,
): DamageLedger {
  const led: DamageLedger = { ...EMPTY_LEDGER };
  for (const e of events) {
    if (e.kind === 'strike') {
      if (e.target !== fighter) continue;
      const d = e.detail.damage;
      if (!d) continue;
      led.head += d.head ?? 0;
      led.body += d.body ?? 0;
      led.legs += d.legs ?? 0;
    } else if (e.kind === 'knockdown') {
      // Damage events are emitted by the fighter's own damage state, so actor
      // and target are both that fighter.
      if (e.actor === fighter) led.knockdownsSuffered++;
    } else if (e.kind === 'injury') {
      if (e.actor === fighter && /^cut|cut opens/.test(e.text)) led.cuts++;
    }
  }
  if (result) {
    const stoppedByStrikes = result.method === 'ko' || result.method === 'tko';
    led.koLoss = stoppedByStrikes && result.winner !== fighter && result.winner !== 'draw'
      && result.winner !== 'none';
  }
  return led;
}

// --------------------------------------------------------------------------
// The carry itself
// --------------------------------------------------------------------------

/**
 * What a fighter takes into the next bout, given what the last one did to them
 * and how much was already carried into *that* one. Carrying compounds: a
 * fighter on their third fight of the night is carrying 30 % of the head
 * damage of the second plus 30 % of what they carried into it.
 */
export function carriedAfter(
  before: CarriedState,
  ledger: DamageLedger,
  mode: CarryOverMode,
): CarriedState {
  const f = CARRY_FRACTIONS[mode];
  if (mode === 'none') return { ...FRESH };
  return {
    head: (before.head + ledger.head) * f.head,
    body: (before.body + ledger.body) * f.body,
    legs: (before.legs + ledger.legs) * f.legs,
    cuts: (before.cuts + ledger.cuts) * f.cuts,
    staminaPct: f.staminaPct,
  };
}

// --------------------------------------------------------------------------
// Applying it to a definition
// --------------------------------------------------------------------------

/**
 * How hard each carried pool bites. These are the approximation, not the
 * chapter: a full head pool costs 25 points of chin, a full body pool 25 of
 * body toughness, a full leg pool 20 of foot speed, and each carried cut 4 of
 * recovery. They are deliberately modest, because the alternative to
 * approximating here is not simulating carry-over at all.
 */
export const CARRY_PENALTIES = Object.freeze({
  chinPerHead: 25,
  bodyToughnessPerBody: 25,
  speedPerLeg: 20,
  recoveryPerCut: 4,
});

const clamp0to100 = (v: number): number => Math.max(1, Math.min(100, v));

/**
 * A copy of `def` carrying `state` into the next bout. `gapDays` is the
 * scheduled gap for `career` (0 for `sameNight`).
 *
 * `koLosses` and `knockdownsSuffered` are the chapter 01 counters the sim
 * already reads — the chin decay they drive is the KO-history effect, so the
 * `career` half of the carry needs no approximation at all.
 */
export function applyCarryOver(
  def: FighterDefinition,
  state: CarriedState,
  mode: CarryOverMode,
  ledger: DamageLedger = EMPTY_LEDGER,
  gapDays = 0,
): FighterDefinition {
  if (mode === 'none') return def;

  const next: FighterDefinition = JSON.parse(JSON.stringify(def)) as FighterDefinition;
  const p = next.physical;
  p.chin = clamp0to100(p.chin - CARRY_PENALTIES.chinPerHead * state.head);
  p.bodyToughness = clamp0to100(p.bodyToughness - CARRY_PENALTIES.bodyToughnessPerBody * state.body);
  p.speed = clamp0to100(p.speed - CARRY_PENALTIES.speedPerLeg * state.legs);
  p.recovery = clamp0to100(p.recovery - CARRY_PENALTIES.recoveryPerCut * state.cuts);
  p.cardio = clamp0to100(p.cardio * state.staminaPct);

  if (mode === 'career') {
    next.record.koLosses += ledger.koLoss ? 1 : 0;
    next.record.knockdownsSuffered += ledger.knockdownsSuffered;
    next.record.lastResultWasKoLoss = ledger.koLoss;
    next.body.ageYears = Math.round((next.body.ageYears + gapDays / 365.25) * 100) / 100;
    next.record.daysSinceLastBout = gapDays;
    next.record.layoffMonths = Math.round((gapDays / 30.44) * 100) / 100;
  } else {
    next.record.daysSinceLastBout = 0;
    next.record.layoffMonths = 0;
  }
  return next;
}

/** One line the tournament screen shows beside a carrying fighter. */
export function describeCarry(state: CarriedState, mode: CarryOverMode): string {
  if (mode === 'none' || (state.head === 0 && state.body === 0 && state.legs === 0 && state.cuts === 0)) {
    return 'Fresh.';
  }
  const parts: string[] = [];
  if (state.head > 0) parts.push(`head ${(state.head * 100).toFixed(0)} %`);
  if (state.body > 0) parts.push(`body ${(state.body * 100).toFixed(0)} %`);
  if (state.legs > 0) parts.push(`legs ${(state.legs * 100).toFixed(0)} %`);
  if (state.cuts > 0) parts.push(`${state.cuts.toFixed(0)} cut${state.cuts >= 2 ? 's' : ''}`);
  return `Carrying ${parts.join(', ')}; stamina ${(state.staminaPct * 100).toFixed(0)} %.`;
}
