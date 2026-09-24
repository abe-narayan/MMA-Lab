/**
 * BATCH ROW FORMAT — one compact summary per bout (docs/design/09 §6.4).
 *
 * A row is everything the §7 calibration metrics read and nothing they do not:
 * no frames, no event log. It is a pure function of `(plan, cell, i, planSeed,
 * param overrides)`, so the same row comes out of any worker, in any order, on
 * any run — which is what lets `--resume` and the 1-vs-N-worker determinism
 * test compare files byte for byte after sorting. Nothing wall-clock-derived is
 * ever written into a row.
 *
 * Keys are short on purpose (a 2,000-bout-per-cell plan writes tens of
 * thousands of these); every one is documented here.
 */

/** `[landed, attempted]`. */
export type LA = [number, number];

/** Cell-level labels copied into every row of the cell (plan generators set them). */
export interface CellTags {
  plan: string;
  /** Plan-local group, e.g. `ufc`, `regional`, `sweep`, `crowd`. */
  group: string;
  /** Class code (`FLW` … `HW`, `W-SW`, `W-FLW`, `W-BW`) or `open`. */
  wc: string;
  sex: 'male' | 'female' | 'mixed';
  mode: string;
  ruleset: string;
  arena: string;
  /** Nominal (generator) tiers, per side. */
  tierA?: number;
  tierB?: number;
  /** physical_sweeps: the swept variable and its value. */
  sweepVar?: string;
  sweepVal?: number | string;
  /** style_matrix: archetype labels per side. */
  styleA?: string;
  styleB?: string;
  /** judging / rules_arenas settings of note. */
  judgingMode?: string;
  judgeCulture?: string;
  strictness?: string;
  /** edge_cases / multi: the §7.4 case id. */
  qaCase?: string;
  standard?: boolean;
}

/** Per-bout labels that vary inside a cell (set by the plan's `make`). */
export interface BoutTags {
  /** physical_sweeps: which fighter carries the swept edge (sides alternate by `i`). */
  edge?: number;
  /** rematch: the pair index (bouts `2k` and `2k+1` are the same two fighters). */
  pair?: number;
}

/** Static facts about a fighter, for the mismatch rows and the tier checks. */
export interface FighterMeta {
  /** Derived `mmaTier` (not the generator's nominal tier). */
  tier: number;
  /** §01 composite rating: `mmaMean`. */
  rating: number;
  exp: number;
  h: number;
  reach: number;
  kg: number;
  age: number;
  stance: string;
  sex: string;
  /** Pro bouts on the record. */
  bouts: number;
  /** Career knockdowns suffered. */
  kdHist: number;
  team: number;
}

export interface FighterRow {
  sig: LA;
  tot: LA;
  /**
   * Significant strikes by position x target, `[L, A]` pairs flattened in the
   * order distance-head, distance-body, distance-leg, clinch-head … ground-leg
   * (18 numbers).
   */
  pt: number[];
  /** Significant jabs to the head at distance. */
  jab: LA;
  /** Every strike to the head, significant or not (row 52). */
  hd: LA;
  kd: number;
  td: LA;
  sub: number;
  rev: number;
  /** Control seconds. */
  ctrl: number;
  /** Sig strikes absorbed / head sig strikes absorbed. */
  abs: number;
  habs: number;
  /** Per round (index r-1): sig attempted, sig landed, head sig landed, TD attempted, sub attempts, all strikes attempted. */
  rsa: number[];
  rsl: number[];
  rhl: number[];
  rta: number[];
  rsu: number[];
  rst: number[];
  /** Clinch entries attempted, clinch seconds initiated, feints, rear-leg kicks attempted. */
  cle: number;
  cls: number;
  fe: number;
  rk: number;
  /** Seconds this fighter spent in a clinch pair / a ground pair; "contact" seconds (§7.4 crowd). */
  inCl: number;
  inGr: number;
  con: number;
  /** As defender: adaptation windows `[preL, preA, postL, postA]` (§7.2 S5). */
  ad: [number, number, number, number];
  m: FighterMeta;
}

/** One knockdown: `[round, secondsIntoRound, by, target, causeTechnique, kind]`. */
export type KdRow = [number, number, number, number, string, string];

export interface FinishRow {
  /** 'strike' | 'sub' */
  k: string;
  /** Technique / submission id. */
  id: string;
  /** Weapon class (`punch` `kick` `knee` `elbow` `other`) or submission family. */
  cls: string;
  /** Target bucket (strike) or finish type (sub: tap / loc / verbal / injury). */
  tgt: string;
  /** Position phase at the finishing blow / sub. */
  pos: string;
}

export interface QaRow {
  /** validateFighter().ok per fighter. */
  valid: boolean[];
  /** Invariant violations by id (I1..I8), counted per tick. */
  viol: Record<string, number>;
  /** Ticks with a non-finite fighter coordinate or stat. */
  nan: number;
  /** Most distinct attackers throwing at one fighter inside any 1 s window. */
  maxAtk: number;
  /** Fouls, deductions, standing eights, referee counts. */
  fouls: number;
  deductions: number;
  eights: number;
  counts: number;
  /** Most knockdowns scored by one fighter in one round. */
  maxKdRound: number;
  /** Ticks the bout ran vs the cap it was allowed. */
  capped: boolean;
}

export interface ResultRow {
  cell: string;
  i: number;
  seed: string;
  digest: string;
  ticks: number;
  draws: number;
  /** Engine version and params hash, so the JSONL is self-describing. */
  ev: string;
  ph: string;
  tags: CellTags;
  bt?: BoutTags;
  res: {
    /** Winning fighter id (1v1) / team (multi), 'draw' or 'none'. */
    w: number | 'draw' | 'none';
    team: number | null;
    m: string;
    r: number;
    /** Seconds into the final round. */
    t: number;
    /** Fight seconds (live round time only). */
    fs: number;
    /** Elapsed seconds including breaks. */
    ts: number;
    det: string;
  };
  /** Round length, seconds (0 = untimed). */
  rl: number;
  /** Live seconds at distance / clinch / ground (shared phase, 09 §4.1 row 24). */
  pos: [number, number, number];
  /** Per round: live seconds, low-intensity seconds (distance, no strike attempt within 2 s). */
  live: number[];
  low: number[];
  f: FighterRow[];
  kd: KdRow[];
  fin?: FinishRow;
  /** Referee stoppage: `[lagS, strikes landed by the winner inside the lag]`. */
  lag?: [number, number];
  /** Strike attempts by the winner in the last 30 s, and how many went to the head. */
  l30?: [number, number];
  /** `[judge][round][fighter]` from the scorecards. */
  cards?: number[][][];
  /** Landed slams. */
  slam: number;
  qa?: QaRow;
}

/** Main thread -> worker. */
export interface JobMessage {
  type: 'job';
  key: string;
  cell: string;
  i: number;
  tags: CellTags;
  bt?: BoutTags;
  config: import('../../src/sim').SimConfig;
  qa: boolean;
  valid: boolean[];
}

/** Worker -> main thread. */
export type WorkerReply =
  | { type: 'ready' }
  | { type: 'row'; key: string; row: ResultRow }
  | { type: 'error'; key: string; message: string };

export const rowKey = (cell: string, i: number): string => `${cell}#${i}`;
