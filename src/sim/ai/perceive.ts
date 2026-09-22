/**
 * PERCEPTION AND THE OPPONENT MODEL — §2.4.
 *
 * The organising claim is that expertise in a fight is *anticipation*, not
 * reflex: simple reaction time barely differs between a novice and an expert,
 * but reading a setup before it completes differs a lot (83 % vs 69 %). So the
 * delay is nearly flat across tiers (chapter 09 owns the ring buffer; §2.4.1
 * sets its values) and the interesting variation lives in three places:
 *
 *   - the *read* (§2.4.4): did the fighter correctly interpret what they saw?
 *   - the *model* (§2.4.3): what do they expect next, given the context?
 *   - the *bite* (§2.4.5): does a feint buy the reaction it is selling?
 *
 * The model is a 72-context x 12-family count table with Laplace smoothing and
 * exponential forgetting. The forgetting horizon (20-120 s by tier) is a
 * deliberate deviation from the literature's ~6 s: six seconds cannot
 * accumulate the six attempts the adjustment rules of §2.6.1 need. The short
 * horizon is carried instead by the 30 s exchange ledger, which is a separate
 * object here for exactly that reason.
 */
import {
  cueReadP, counterOnReadP as counterOnReadPOf, feintBiteP as feintBitePOf,
  HURT_PENALTY_BY_TIER, READ_BASE_BY_TIER, sigmoid, logit,
} from '../striking/defence';
import { feintBiteProbability } from '../striking/combos';
import type { FighterRuntime } from '../fighter';
import type { ActionFamily } from './contracts';
import {
  MY_LAST_FAMILIES, MY_LAST_FAMILY_COUNT, OPP_FAMILIES, OPP_FAMILY_COUNT,
  THREAT_WEIGHT, oppFamilyIndex, oppFamilyOf, myLastFamilyOf,
  type MyLastFamily, type OppFamily,
} from './families';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const tierIndex = (t: number): number => Math.max(0, Math.min(5, Math.round(t)));

// ---------------------------------------------------------------------------
// §2.4.1 — perception delay
// ---------------------------------------------------------------------------

/** `ai.percept.base_ms.tier`. */
export const PERCEPT_BASE_MS_BY_TIER: readonly number[] = [300, 300, 200, 200, 100, 100];
export const PERCEPT_FATIGUE_MS = 50;
export const PERCEPT_ROCKED_MS = 150;
export const PERCEPT_FAMILIARITY_MS = 20;
/** `ai.read.familiarity_threshold`: fights against a stance before it is familiar. */
export const FAMILIARITY_THRESHOLD_FIGHTS = 3;

export interface PerceptionLagInput {
  tier: number;
  /** The 0-100 attribute, not the latency. */
  reactionTime: number;
  fatigue: number;
  rocked: boolean;
  /** 0-1; below 1 means the opponent's stance is not yet familiar. */
  stanceFamiliarity: number;
}

/**
 * `base(tier) - 1 ms x (reactionTime - 50) + 50 [f >= 0.7] + 150 [rocked] + famMs`.
 * Deterministic: no draw. Whether the delayed observation is *understood* is
 * the read roll's business, not the delay's.
 */
export function perceptionLagMs(x: PerceptionLagInput): number {
  const tier = tierIndex(x.tier);
  let ms = PERCEPT_BASE_MS_BY_TIER[tier];
  ms -= x.reactionTime - 50;
  if (clamp01(x.fatigue) >= 0.7) ms += PERCEPT_FATIGUE_MS;
  if (x.rocked) ms += PERCEPT_ROCKED_MS;
  // T4+ are fully adapted to both stances; below that an unfamiliar stance costs.
  if (tier <= 3 && x.stanceFamiliarity < 1) {
    ms += PERCEPT_FAMILIARITY_MS * (1 - clamp01(x.stanceFamiliarity));
  }
  return Math.max(0, ms);
}

/** `lagTicks = round(perceptionLagMs / 100)`, clamped to [1, 3] (§2.4.1). */
export function perceptionLagTicks(ms: number, dtMs = 100): number {
  return clamp(Math.round(ms / dtMs), 1, 3);
}

// ---------------------------------------------------------------------------
// §2.4.3 — contexts
// ---------------------------------------------------------------------------

export const RANGE_BUCKETS = ['long', 'mid', 'short', 'clinch', 'groundTop', 'groundBottom'] as const;
export type RangeBucket = (typeof RANGE_BUCKETS)[number];

export const FATIGUE_BUCKETS = ['fresh', 'tired'] as const;
export type FatigueBucket = (typeof FATIGUE_BUCKETS)[number];

/** 6 ranges x 2 fatigue buckets x 6 "what I threw last" = 72. */
export const CONTEXT_COUNT = RANGE_BUCKETS.length * FATIGUE_BUCKETS.length * MY_LAST_FAMILY_COUNT;

export function contextIndex(
  range: RangeBucket,
  fatigue: FatigueBucket,
  myLast: MyLastFamily,
): number {
  const r = RANGE_BUCKETS.indexOf(range);
  const f = FATIGUE_BUCKETS.indexOf(fatigue);
  const m = MY_LAST_FAMILIES.indexOf(myLast);
  return (r * FATIGUE_BUCKETS.length + f) * MY_LAST_FAMILY_COUNT + m;
}

export function describeContext(index: number): string {
  const m = index % MY_LAST_FAMILY_COUNT;
  const rest = Math.floor(index / MY_LAST_FAMILY_COUNT);
  const f = rest % FATIGUE_BUCKETS.length;
  const r = Math.floor(rest / FATIGUE_BUCKETS.length);
  return `${RANGE_BUCKETS[r]}/${FATIGUE_BUCKETS[f]}/${MY_LAST_FAMILIES[m]}`;
}

/** The range bucket a distance and posture put the pair in. */
export function rangeBucketFor(
  posture: 'standing' | 'clinch' | 'ground' | 'down' | 'out',
  distanceM: number,
  onTop: boolean,
): RangeBucket {
  if (posture === 'clinch') return 'clinch';
  if (posture === 'ground' || posture === 'down') return onTop ? 'groundTop' : 'groundBottom';
  if (distanceM < 0.9) return 'short';
  if (distanceM < 1.5) return 'mid';
  return 'long';
}

export function fatigueBucketFor(f: number): FatigueBucket {
  return f < 0.4 ? 'fresh' : 'tired';
}

/** `ai.oppmodel.n_prior.tier` and `ai.oppmodel.tau_mem.tier`. */
export const N_PRIOR_BY_IQ: readonly number[] = [0, 2, 4, 8, 12, 16];
export const TAU_MEM_S_BY_IQ: readonly number[] = [0, 20, 40, 60, 90, 120];
/** `ai.oppmodel.laplace_alpha`. */
export const LAPLACE_ALPHA = 1;
/** `ai.oppmodel.kl_adjust_threshold`, in nats. */
export const KL_ADJUST_THRESHOLD = 0.35;

// ---------------------------------------------------------------------------
// The tendency table
// ---------------------------------------------------------------------------

/**
 * `N[context][oppActionFamily]` with Laplace smoothing and exponential
 * forgetting. 72 x 12 = 864 doubles per fighter, which is the whole point of
 * the coarse granularity.
 *
 * The scouted prior is held in a *separate*, non-decaying array. That is what
 * makes forgetting mean something: observed counts decay toward zero, so the
 * posterior slides back to what the film said rather than to nothing. A T0
 * fighter has no model at all — `nPrior` 0 and `tauMem` 0 disable every update.
 */
export class OpponentModel {
  /** Decaying observation counts, context-major. */
  private readonly counts: Float64Array;
  /** Non-decaying scouted pseudo-counts. */
  private readonly prior: Float64Array;
  /** A short trailing copy for the KL "he has adjusted" test (§2.4.3). */
  private readonly recent: Float64Array;
  private readonly older: Float64Array;

  readonly iqTier: number;
  readonly tauMemS: number;
  readonly nPrior: number;

  constructor(iqTier: number) {
    const tier = tierIndex(iqTier);
    this.iqTier = tier;
    this.tauMemS = TAU_MEM_S_BY_IQ[tier];
    this.nPrior = N_PRIOR_BY_IQ[tier];
    const size = CONTEXT_COUNT * OPP_FAMILY_COUNT;
    this.counts = new Float64Array(size);
    this.prior = new Float64Array(size);
    this.recent = new Float64Array(size);
    this.older = new Float64Array(size);
  }

  /** True when the fighter keeps a model at all (T0 does not). */
  get active(): boolean {
    return this.tauMemS > 0;
  }

  /**
   * Seed the scouted tendency profile as pseudo-counts. `mix` is a
   * distribution over families; it is spread across every context because the
   * film gives a fighter's habits, not his habits at short range with a tired
   * opponent after a jab.
   */
  seed(mix: Readonly<Partial<Record<OppFamily, number>>>): void {
    if (!this.active) return;
    let total = 0;
    for (const f of OPP_FAMILIES) total += Math.max(0, mix[f] ?? 0);
    if (total <= 0) return;
    for (let c = 0; c < CONTEXT_COUNT; c++) {
      for (let k = 0; k < OPP_FAMILY_COUNT; k++) {
        const share = Math.max(0, mix[OPP_FAMILIES[k]] ?? 0) / total;
        this.prior[c * OPP_FAMILY_COUNT + k] = this.nPrior * share;
      }
    }
  }

  /** Record one observed opponent action in a context. */
  note(context: number, family: OppFamily, weight = 1): void {
    if (!this.active) return;
    if (context < 0 || context >= CONTEXT_COUNT) return;
    const i = context * OPP_FAMILY_COUNT + oppFamilyIndex(family);
    this.counts[i] += weight;
    this.recent[i] += weight;
  }

  /** Record what *we* did, so the caller can build the next context. */
  noteFromAction(context: number, family: ActionFamily, weight = 1): void {
    this.note(context, oppFamilyOf(family), weight);
  }

  /** `N <- N x exp(-dt / tau_mem)` per tick (§2.4.3). */
  decay(dtS: number): void {
    if (!this.active || dtS <= 0) return;
    const k = Math.exp(-dtS / this.tauMemS);
    for (let i = 0; i < this.counts.length; i++) this.counts[i] *= k;
    // The KL windows use their own, faster horizons: 30 s recent, 60 s prior.
    const kr = Math.exp(-dtS / 30);
    const ko = Math.exp(-dtS / 60);
    for (let i = 0; i < this.recent.length; i++) {
      this.older[i] = this.older[i] * ko + this.recent[i] * (1 - kr);
      this.recent[i] *= kr;
    }
  }

  /** Total smoothed mass in a context. */
  private mass(context: number): number {
    let sum = OPP_FAMILY_COUNT * LAPLACE_ALPHA;
    const base = context * OPP_FAMILY_COUNT;
    for (let k = 0; k < OPP_FAMILY_COUNT; k++) sum += this.counts[base + k] + this.prior[base + k];
    return sum;
  }

  /** `P(oppFamily | context)`, Laplace-smoothed over the prior. */
  p(context: number, family: OppFamily): number {
    if (context < 0 || context >= CONTEXT_COUNT) return 1 / OPP_FAMILY_COUNT;
    const i = context * OPP_FAMILY_COUNT + oppFamilyIndex(family);
    return (this.counts[i] + this.prior[i] + LAPLACE_ALPHA) / this.mass(context);
  }

  /** The whole distribution for a context, in `OPP_FAMILIES` order. */
  distribution(context: number): number[] {
    const out = new Array<number>(OPP_FAMILY_COUNT);
    for (let k = 0; k < OPP_FAMILY_COUNT; k++) out[k] = this.p(context, OPP_FAMILIES[k]);
    return out;
  }

  /** `expectedThreat = sum_f P(f | context) x threatWeight(f)`, in [0, 1]. */
  expectedThreat(context: number): number {
    let sum = 0;
    for (let k = 0; k < OPP_FAMILY_COUNT; k++) {
      sum += this.p(context, OPP_FAMILIES[k]) * THREAT_WEIGHT[OPP_FAMILIES[k]];
    }
    return clamp01(sum);
  }

  /** The family the model expects next, for counter and feint selection. */
  mostLikely(context: number): OppFamily {
    let best: OppFamily = OPP_FAMILIES[0];
    let bestP = -1;
    for (const f of OPP_FAMILIES) {
      const p = this.p(context, f);
      if (p > bestP) {
        bestP = p;
        best = f;
      }
    }
    return best;
  }

  /**
   * §2.4.3 pattern detection: KL divergence in nats between the last-30 s and
   * the prior-60 s distributions in one context. Above 0.35 nats the T5
   * trigger `adj.opp_adjusted` fires.
   */
  klDivergence(context: number): number {
    if (context < 0 || context >= CONTEXT_COUNT) return 0;
    const base = context * OPP_FAMILY_COUNT;
    let recentSum = OPP_FAMILY_COUNT * LAPLACE_ALPHA;
    let olderSum = OPP_FAMILY_COUNT * LAPLACE_ALPHA;
    for (let k = 0; k < OPP_FAMILY_COUNT; k++) {
      recentSum += this.recent[base + k];
      olderSum += this.older[base + k];
    }
    let kl = 0;
    for (let k = 0; k < OPP_FAMILY_COUNT; k++) {
      const p = (this.recent[base + k] + LAPLACE_ALPHA) / recentSum;
      const q = (this.older[base + k] + LAPLACE_ALPHA) / olderSum;
      kl += p * Math.log(p / q);
    }
    return kl;
  }

  /** True when the opponent has demonstrably changed what they do here. */
  hasAdjusted(context: number, threshold = KL_ADJUST_THRESHOLD): boolean {
    return this.klDivergence(context) > threshold;
  }

  /** Observed mass in a context, ignoring the prior — "how much have I seen?" */
  observedMass(context: number): number {
    let sum = 0;
    const base = context * OPP_FAMILY_COUNT;
    for (let k = 0; k < OPP_FAMILY_COUNT; k++) sum += this.counts[base + k];
    return sum;
  }

  /** Top families by probability, for the game-plan panel. */
  topFamilies(context: number, n = 3): { family: OppFamily; p: number }[] {
    return OPP_FAMILIES
      .map((f) => ({ family: f, p: this.p(context, f) }))
      .sort((a, b) => b.p - a.p || OPP_FAMILIES.indexOf(a.family) - OPP_FAMILIES.indexOf(b.family))
      .slice(0, n);
  }
}

// ---------------------------------------------------------------------------
// §2.4.3 — the 30 s exchange ledger
// ---------------------------------------------------------------------------

export type LedgerEventKind =
  | 'attempt' | 'landed' | 'absorbed' | 'absorbedHeavy' | 'knockdown'
  | 'tdLanded' | 'tdStuffed' | 'takenDown' | 'counterEaten' | 'cageExchange';

interface LedgerEntry {
  tS: number;
  kind: LedgerEventKind;
  family: ActionFamily | null;
}

/** `ai.ledger.window`. */
export const LEDGER_WINDOW_S = 30;

/**
 * The 30 s sliding window the adjustment signals read. Kept as a flat ring of
 * entries rather than per-family counters because the rules ask questions the
 * counters would not answer ("hit-rate over the last six attempts with *this*
 * family"), and 30 s of one fighter's actions is a few hundred entries.
 */
export class ExchangeLedger {
  private entries: LedgerEntry[] = [];
  private nowS = 0;

  /** Per-round totals survive the window, for the corner and the judges' view. */
  readonly round = {
    attempts: 0, landed: 0, absorbed: 0, knockdowns: 0,
    tdLanded: 0, tdAttempted: 0, tdStuffed: 0, takenDown: 0,
    controlS: 0, clinchS: 0,
  };

  /** Consecutive stuffed shots, for `adj.td_stuffed_x2`. */
  consecutiveStuffs = 0;
  /** Takedowns conceded this bout, for `adj.taken_down_x2`. */
  timesTakenDown = 0;
  /** Cage exchanges in the window, for `adj.cage_trapped`. */
  get cageExchanges(): number {
    return this.countKind('cageExchange');
  }

  advance(nowS: number): void {
    this.nowS = nowS;
    const cutoff = nowS - LEDGER_WINDOW_S;
    if (this.entries.length > 0 && this.entries[0].tS < cutoff) {
      let i = 0;
      while (i < this.entries.length && this.entries[i].tS < cutoff) i++;
      this.entries = this.entries.slice(i);
    }
  }

  note(kind: LedgerEventKind, family: ActionFamily | null = null): void {
    this.entries.push({ tS: this.nowS, kind, family });
    switch (kind) {
      case 'attempt': this.round.attempts += 1; break;
      case 'landed': this.round.landed += 1; break;
      case 'absorbed': case 'absorbedHeavy': this.round.absorbed += 1; break;
      case 'knockdown': this.round.knockdowns += 1; break;
      case 'tdLanded':
        this.round.tdLanded += 1;
        this.round.tdAttempted += 1;
        this.consecutiveStuffs = 0;
        break;
      case 'tdStuffed':
        this.round.tdStuffed += 1;
        this.round.tdAttempted += 1;
        this.consecutiveStuffs += 1;
        break;
      case 'takenDown':
        this.round.takenDown += 1;
        this.timesTakenDown += 1;
        break;
      default: break;
    }
  }

  private countKind(kind: LedgerEventKind, family?: ActionFamily): number {
    let n = 0;
    for (const e of this.entries) {
      if (e.kind !== kind) continue;
      if (family !== undefined && e.family !== family) continue;
      n++;
    }
    return n;
  }

  attempts(family?: ActionFamily): number {
    return this.countKind('attempt', family);
  }

  landed(family?: ActionFamily): number {
    return this.countKind('landed', family);
  }

  /** Hit rate over the window; null when the sample is too small to mean anything. */
  hitRate(family: ActionFamily, minAttempts = 6): number | null {
    const a = this.attempts(family);
    if (a < minAttempts) return null;
    return this.landed(family) / a;
  }

  /** `adj.defend_family`: heavy strikes absorbed from one technique family. */
  heavyAbsorbedFrom(family: ActionFamily): number {
    return this.countKind('absorbedHeavy', family);
  }

  /** The family with the best hit rate over the window, for `adj.drop_family`. */
  bestFamily(minAttempts = 3): ActionFamily | null {
    const byFamily = new Map<ActionFamily, { a: number; l: number }>();
    for (const e of this.entries) {
      if (e.family === null) continue;
      if (e.kind !== 'attempt' && e.kind !== 'landed') continue;
      const row = byFamily.get(e.family) ?? { a: 0, l: 0 };
      if (e.kind === 'attempt') row.a += 1;
      else row.l += 1;
      byFamily.set(e.family, row);
    }
    let best: ActionFamily | null = null;
    let bestRate = -1;
    for (const [family, row] of byFamily) {
      if (row.a < minAttempts) continue;
      const rate = row.l / row.a;
      if (rate > bestRate) {
        bestRate = rate;
        best = family;
      }
    }
    return best;
  }

  /** Strikes thrown per minute over the window — the `c.pace` numerator. */
  pacePerMin(): number {
    const span = Math.min(LEDGER_WINDOW_S, Math.max(1, this.nowS));
    return (this.attempts() * 60) / span;
  }

  /** Strikes *landed* per minute: P-6 says pressure without landing wins nothing. */
  landedPerMin(): number {
    const span = Math.min(LEDGER_WINDOW_S, Math.max(1, this.nowS));
    return (this.landed() * 60) / span;
  }

  resetRound(): void {
    this.round.attempts = 0;
    this.round.landed = 0;
    this.round.absorbed = 0;
    this.round.knockdowns = 0;
    this.round.tdLanded = 0;
    this.round.tdAttempted = 0;
    this.round.tdStuffed = 0;
    this.round.takenDown = 0;
    this.round.controlS = 0;
    this.round.clinchS = 0;
  }
}

// ---------------------------------------------------------------------------
// §2.4.4 — anticipation
// ---------------------------------------------------------------------------

/** Reference ladder (§2.4.4); 01's `readP_dom` is authoritative when available. */
export const READ_P_BY_TIER: readonly number[] = [0.50, 0.58, 0.68, 0.75, 0.83, 0.87];
/** `ai.read.counter_mult`. */
export const COUNTER_ON_READ_MULT = 2.5;
/** `ai.feint.walkthrough_drop`: a non-bite drops that family's threat 30 % for 5 s. */
export const WALKTHROUGH_DROP = 0.30;
export const WALKTHROUGH_S = 5;
/** `ai.feint.hurt_bonus` / `ai.finish.trap_bite_bonus`. */
export const HURT_BITE_BONUS = 0.20;
/** `ai.feint.quality_coef`. */
export const FEINT_QUALITY_COEF = 0.3;

export interface ReadInput {
  /** 01 `readP_dom` for the domain; falls back to the tier ladder. */
  basePRead: number;
  /** The reader's striking tier, for the hurt-penalty ladder. */
  tier: number;
  /** The attacker's telegraph, ms, from the execution layer. */
  telegraphMs: number;
  /** Own fatigue, 0-1. */
  fatigue: number;
  /** Own rocked / anxious state. */
  hurt: boolean;
  /** 01 `anxietyReadPenalty`, in probability units. */
  anxietyPenalty: number;
  /** §02 `state.vision_blocked`. */
  visionBlocked: boolean;
  /** 0-1: how familiar the opponent's stance is. */
  stanceFamiliarity: number;
  /**
   * §2.4.3 term, in logit units: how strongly the model expected *this*
   * family. Positive when the tendency table already predicted it.
   */
  patternMods: number;
  /** True while a bite is being paid off — the read is skipped (draw still taken). */
  suppressed: boolean;
}

/** `ai.read.familiarity_pen`: §02 §2.7's penalty scaled by (1 - familiarity). */
export const FAMILIARITY_READ_LOGIT = 0.45;

/**
 * 01's `anxietyReadPenalty` is in probability units; §2.4.4 converts its T0-T1
 * value of -0.15 to a logit shift of -0.65, which is this ratio.
 */
export const ANXIETY_LOGIT_PER_P = 0.65 / 0.15;

/**
 * `p_read = sigmoid(logit(readP) + 0.004 x telegraph_ms - feintSuppression
 *           - 0.5 f - hurtPenalty - 0.4 visionBlocked + patternMods)`.
 *
 * Chapter 02 owns every term but the last: 01 supplies the base (skill and
 * fightIQ are already inside `readP_dom`), 02 the telegraph slope, the fatigue
 * and vision terms and the hurt penalty. This section owns the opponent-model
 * `patternMods` and the draw that consumes the result.
 *
 * Fatigue appears here as chapter 02 has it; §2.4.4's note that mental fatigue
 * lowers RT more than accuracy is honoured by the *delay* carrying the larger
 * share (§2.4.1), so neither half is counted twice.
 */
export function readProbability(x: ReadInput): number {
  if (x.suppressed) return 0;
  const tier = tierIndex(x.tier);
  const familiarityPenalty = FAMILIARITY_READ_LOGIT * (1 - clamp01(x.stanceFamiliarity));
  const base = cueReadP({
    readP: clamp(x.basePRead, 0.01, 0.99),
    telegraphMs: Math.max(0, x.telegraphMs),
    fatigue: clamp01(x.fatigue),
    hurtPenalty: x.hurt ? HURT_PENALTY_BY_TIER[tier] : 0,
    visionBlocked: x.visionBlocked,
  });
  // The opponent-model and familiarity terms are this section's, so they are
  // folded in afterwards in the same logit space 02 works in.
  const l = logit(clamp(base, 1e-4, 1 - 1e-4))
    + x.patternMods
    - familiarityPenalty
    - Math.max(0, x.anxietyPenalty) * ANXIETY_LOGIT_PER_P;
  return clamp01(sigmoid(l));
}

/** The base read probability for a domain, preferring 01's derived value. */
export function baseReadP(rt: FighterRuntime, domain: 'striking' | 'takedown' | 'submission'): number {
  const block = rt.anticipation[domain];
  if (block && Number.isFinite(block.readP) && block.readP > 0) return block.readP;
  return READ_P_BY_TIER[tierIndex(rt.strikingTier)];
}

/**
 * §2.4.4 consequence 2: `counterOnReadP` = 01's
 * `0.05 + 0.45 x clamp((boxing.counters - 10) / 80, 0, 1)`. The tier table the
 * chapter prints (0.02 -> 0.50) is reference only; 01 owns the formula and 02
 * uses the same one, so a fighter's counter rate follows his counter *skill*
 * rather than a band he happens to fall in.
 */
export function counterOnRead(rt: FighterRuntime): number {
  const block = rt.anticipation.striking;
  if (block && Number.isFinite(block.counterOnReadP)) return clamp01(block.counterOnReadP);
  return counterOnReadPOf(rt.disciplines.boxing.effective.counters ?? 10);
}

/**
 * §2.4.5: `p_bite = feintBiteP(B) x (1 + 0.3 x feintQuality(A))`, then §02's
 * logit modifiers (sell skill, habituation, vision, fatigue). The habituation
 * term is §02's -0.7 logit per repeat; this section's older `0.6^(n-2)` rule is
 * retired so over-feinting is penalised exactly once.
 */
export interface FeintBiteInput {
  /** The defender's base bite probability (01 `feintBiteP`). */
  baseBiteP: number;
  /** 0-1: the feinter's striking tier index x composure factor. */
  feintQuality: number;
  /** The attacker's `boxing.feints` sub-skill, 0-100. */
  attackerFeintSkill: number;
  /** How many times this feint has been shown inside 20 s without a strike. */
  repeatsInWindow: number;
  /** The defender is hurt: hurt fighters flinch (+0.20). */
  defenderHurt: boolean;
  defenderFatigue: number;
  defenderVisionBlocked: boolean;
}

/**
 * The bite probability, with this section's two terms applied to the base
 * before §02 takes over: the quality coefficient (+0.3 x quality) and the
 * hurt-flinch bonus (+0.20). Over-feinting is penalised *once*, by 02's
 * habituation term (-0.7 logit per repeat) — this section's older
 * `0.6^(n-2)` rule is retired so the two do not stack.
 */
export function feintBiteProbabilityFor(x: FeintBiteInput): number {
  const scaled = clamp01(x.baseBiteP) * (1 + FEINT_QUALITY_COEF * clamp01(x.feintQuality));
  const withHurt = x.defenderHurt ? scaled + HURT_BITE_BONUS : scaled;
  return clamp01(feintBiteProbability({
    baseBiteP: clamp(withHurt, 0.01, 0.99),
    attackerFeintSkill: clamp(x.attackerFeintSkill, 0, 100),
    repeatsInWindow: Math.max(0, x.repeatsInWindow),
    defenderVisionBlocked: x.defenderVisionBlocked,
    defenderFatigue: clamp01(x.defenderFatigue),
  }));
}

/** The defender's base bite probability, preferring 01's derived value. */
export function baseFeintBiteP(rt: FighterRuntime): number {
  const block = rt.anticipation.striking;
  if (block && Number.isFinite(block.feintBiteP)) return clamp01(block.feintBiteP);
  // 01's formula: 0.62 - 0.40 x defSkill/100.
  return clamp01(0.62 - 0.40 * (rt.strikingMean / 100));
}

/** 0-1 feint quality: tier index scaled by composure (§2.4.5). */
export function feintQuality(rt: FighterRuntime): number {
  const tier = tierIndex(rt.strikingTier);
  if (tier < 2) return 0;
  return clamp01((tier / 5) * (0.6 + 0.4 * (rt.composureEff / 100)));
}

// ---------------------------------------------------------------------------
// §2.4.2 — the cue set
// ---------------------------------------------------------------------------

/**
 * What a fighter has *noticed*, as opposed to what is true. Built once per
 * tick from the delayed observation; the hurt and tired cues are gated by tier
 * so a T1 fighter genuinely does not know the opponent is fading.
 */
export interface Cues {
  oppHurt: boolean;
  oppTired: boolean;
  oppCut: boolean;
  oppLegDamaged: boolean;
  oppInRecovery: boolean;
  /** 0-1 estimate of the opponent's fatigue, from the pace-drop cue. */
  oppFatigueEstimate: number;
  /** 0-1 estimate of the damage we have done. */
  oppDamageEstimate: number;
}

export interface CueInput {
  iqTier: number;
  /** `ObservedFighter.visiblyHurt`. */
  visiblyHurt: boolean;
  visiblyTired: boolean;
  handsDropped: boolean;
  /** §05's visible cut / leg flags. */
  cut: boolean;
  legDamaged: boolean;
  /** The opponent is mid-recovery of a technique (perceived). */
  inRecovery: boolean;
  /** Fractional drop in the opponent's pace vs their first-minute pace. */
  paceDrop: number;
  /** Fraction of the TKO threshold we have put on them, as we perceive it. */
  perceivedDamage: number;
  /** The hurt cue is rolled per tick; the caller supplies the outcome. */
  hurtCueSeen: boolean;
}

/** `ai.percept.tired_cue_pace_drop`. */
export const TIRED_CUE_PACE_DROP = 0.20;

export function readCues(x: CueInput): Cues {
  const tier = tierIndex(x.iqTier);
  // T2+ read the tired cue for themselves; T1 only hears it from the corner.
  const tiredReadable = tier >= 2
    && (x.paceDrop > TIRED_CUE_PACE_DROP || (x.visiblyTired && x.handsDropped));
  return {
    oppHurt: x.visiblyHurt && x.hurtCueSeen,
    oppTired: tiredReadable,
    // Cuts and leg damage are visible from T1.
    oppCut: tier >= 1 && x.cut,
    oppLegDamaged: tier >= 1 && x.legDamaged,
    oppInRecovery: x.inRecovery,
    oppFatigueEstimate: tiredReadable ? clamp01(0.4 + x.paceDrop) : clamp01(x.paceDrop * 0.5),
    oppDamageEstimate: clamp01(x.perceivedDamage),
  };
}

/** `ai.percept.hurt_cue_p`: p_read(tier) per tick while the state lasts; T0 0.5. */
export function hurtCueP(rt: FighterRuntime): number {
  const tier = tierIndex(rt.strikingTier);
  if (tier === 0) return 0.5;
  return READ_P_BY_TIER[tier];
}

/** The context a fighter is in right now, ready for `note`/`p`. */
export function buildContext(
  posture: 'standing' | 'clinch' | 'ground' | 'down' | 'out',
  distanceM: number,
  onTop: boolean,
  oppFatigue: number,
  myLastAction: ActionFamily | null,
): number {
  return contextIndex(
    rangeBucketFor(posture, distanceM, onTop),
    fatigueBucketFor(oppFatigue),
    myLastFamilyOf(myLastAction),
  );
}
