/**
 * TOURNAMENT BRACKETS — docs/design/09 §3.5.
 *
 * Three formats: single elimination at 4/8/16/32, double elimination at 8/16,
 * round robin up to 8. Seeding by composite rating, manual order, or random —
 * and "random" here means an `RNG` seeded from the tournament id, so a bracket
 * is reproducible from the saved document alone. Nothing in this file calls
 * `Math.random()` or reads a clock.
 *
 * The store's `Tournament.bracket` is a flat `[round][match]` array, so the
 * structure of a double-elimination draw has to live somewhere. It lives in
 * `bracketPlan`, which describes every match once: where its winner goes and
 * where its loser goes. `applyResult` then needs no format-specific branches —
 * it follows the plan's pointers — and a bye is one rule applied everywhere:
 * a match with one entrant advances it, a match with none advances nobody.
 */

import { RNG } from '../../sim';
import type { Tournament } from '../store/types';

export type BracketFormat = Tournament['format'];

/** The sizes 09 §3.5 supports, per format. */
export const SUPPORTED_SIZES: Readonly<Record<BracketFormat, readonly number[]>> = Object.freeze({
  single: [4, 8, 16, 32],
  double: [8, 16],
  roundRobin: [3, 4, 5, 6, 7, 8],
});

export function isSupportedSize(format: BracketFormat, size: number): boolean {
  return SUPPORTED_SIZES[format].includes(size);
}

export type BracketSide = 'winners' | 'losers' | 'final' | 'group';

export interface SlotRef {
  round: number;
  match: number;
  slot: 'a' | 'b';
}

export interface MatchPlan {
  round: number;
  match: number;
  label: string;
  side: BracketSide;
  /** Where the winner goes, or null when the match decides the tournament. */
  winnerTo: SlotRef | null;
  /** Where the loser goes. Only double elimination ever sets this. */
  loserTo: SlotRef | null;
}

export interface BracketPlan {
  format: BracketFormat;
  size: number;
  rounds: MatchPlan[][];
  /** Round labels, for the column headers. */
  roundLabels: string[];
}

// --------------------------------------------------------------------------
// Seeding
// --------------------------------------------------------------------------

/**
 * Order the entrants for slotting into the draw.
 *
 * `rating` sorts by the supplied composite descending, ties broken by id so
 * the order never depends on the input array's order. `manual` is the list as
 * given. `random` shuffles with an RNG seeded from the tournament id — the
 * same id always produces the same draw, which is the whole point: a saved
 * tournament has to rebuild identically after a reload.
 */
export function seedOrder(
  entrantIds: readonly string[],
  seeding: Tournament['seeding'],
  tournamentId: string,
  ratingOf: (id: string) => number = () => 0,
): string[] {
  const ids = [...entrantIds];
  if (seeding === 'manual') return ids;
  if (seeding === 'rating') {
    return ids.sort((a, b) => {
      const d = ratingOf(b) - ratingOf(a);
      return d !== 0 ? d : a.localeCompare(b);
    });
  }
  // Fisher-Yates over a deterministic stream.
  const rng = new RNG(`${tournamentId}::seeding`);
  const sorted = ids.sort((a, b) => a.localeCompare(b));
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = sorted[i];
    sorted[i] = sorted[j];
    sorted[j] = tmp;
  }
  return sorted;
}

/**
 * Standard bracket slot order for `size` seeds: 1 meets the lowest seed, 2
 * meets the second lowest, and the two favourites can only meet in the final.
 * Returns seed numbers (1-based) in slot order.
 */
export function seedSlots(size: number): number[] {
  let slots = [1, 2];
  while (slots.length < size) {
    const n = slots.length * 2 + 1;
    const next: number[] = [];
    for (const s of slots) {
      next.push(s, n - s);
    }
    slots = next;
  }
  return slots;
}

// --------------------------------------------------------------------------
// Plans
// --------------------------------------------------------------------------

const ORDINAL_LABELS: Readonly<Record<number, string>> = Object.freeze({
  1: 'Final',
  2: 'Semi-finals',
  4: 'Quarter-finals',
  8: 'Round of 16',
  16: 'Round of 32',
});

function winnersRoundLabel(matches: number): string {
  return ORDINAL_LABELS[matches] ?? `Round of ${matches * 2}`;
}

export function bracketPlan(format: BracketFormat, size: number): BracketPlan {
  if (format === 'roundRobin') return roundRobinPlan(size);
  if (format === 'double') return doubleElimPlan(size);
  return singleElimPlan(size);
}

function singleElimPlan(size: number): BracketPlan {
  const k = Math.round(Math.log2(size));
  const rounds: MatchPlan[][] = [];
  const roundLabels: string[] = [];
  for (let r = 0; r < k; r++) {
    const matches = size >> (r + 1);
    roundLabels.push(winnersRoundLabel(matches));
    const row: MatchPlan[] = [];
    for (let m = 0; m < matches; m++) {
      row.push({
        round: r,
        match: m,
        label: `${winnersRoundLabel(matches)} · ${m + 1}`,
        side: r === k - 1 ? 'final' : 'winners',
        winnerTo: r === k - 1 ? null : { round: r + 1, match: m >> 1, slot: m % 2 === 0 ? 'a' : 'b' },
        loserTo: null,
      });
    }
    rounds.push(row);
  }
  return { format: 'single', size, rounds, roundLabels };
}

/**
 * Double elimination, the conventional layout.
 *
 * With `k = log2(size)` there are `k` winners rounds and `2k-2` losers rounds,
 * then one grand final: `2·size − 2` matches in total. Losers round `2i−1`
 * pairs up the survivors already in the losers bracket; losers round `2i`
 * feeds them the fighters just dropped out of winners round `i`. The drop is
 * cross-mapped (match `m` of the winners round lands in the *last* losers
 * match rather than the first) so a fighter does not immediately meet the
 * person who just beat them.
 *
 * There is no bracket reset: the grand final is one match, and the fighter
 * coming out of the losers bracket wins the tournament by winning it. That is
 * a simplification, stated here rather than hidden — a true reset needs a
 * conditional extra match, which the flat `[round][match]` document the store
 * persists cannot express.
 */
function doubleElimPlan(size: number): BracketPlan {
  const k = Math.round(Math.log2(size));
  const lbRounds = 2 * k - 2;
  const gfRound = k + lbRounds;

  const lbMatches = (j: number): number => size >> (Math.ceil(j / 2) + 1);
  const lbRoundIndex = (j: number): number => k + j - 1;

  const rounds: MatchPlan[][] = [];
  const roundLabels: string[] = [];

  // --- winners bracket ----------------------------------------------------
  for (let r = 0; r < k; r++) {
    const matches = size >> (r + 1);
    const isWbFinal = r === k - 1;
    roundLabels.push(isWbFinal ? 'Winners final' : `Winners ${winnersRoundLabel(matches)}`);
    const row: MatchPlan[] = [];
    for (let m = 0; m < matches; m++) {
      // Losers of winners round r drop into losers round `2r+1` when r = 0
      // (the pairing round) and into losers round `2r` otherwise.
      const dropJ = r === 0 ? 1 : 2 * r;
      const dropCount = lbMatches(dropJ);
      const loserTo: SlotRef = r === 0
        ? { round: lbRoundIndex(1), match: m >> 1, slot: m % 2 === 0 ? 'a' : 'b' }
        : { round: lbRoundIndex(dropJ), match: dropCount - 1 - m, slot: 'b' };
      row.push({
        round: r,
        match: m,
        label: isWbFinal ? 'Winners final' : `Winners ${winnersRoundLabel(matches)} · ${m + 1}`,
        side: 'winners',
        winnerTo: isWbFinal
          ? { round: gfRound, match: 0, slot: 'a' }
          : { round: r + 1, match: m >> 1, slot: m % 2 === 0 ? 'a' : 'b' },
        loserTo,
      });
    }
    rounds.push(row);
  }

  // --- losers bracket -----------------------------------------------------
  for (let j = 1; j <= lbRounds; j++) {
    const matches = lbMatches(j);
    const r = lbRoundIndex(j);
    roundLabels.push(j === lbRounds ? 'Losers final' : `Losers round ${j}`);
    const row: MatchPlan[] = [];
    for (let m = 0; m < matches; m++) {
      const isLast = j === lbRounds;
      let winnerTo: SlotRef;
      if (isLast) {
        winnerTo = { round: gfRound, match: 0, slot: 'b' };
      } else if (j % 2 === 1) {
        // Odd → the next round pairs us with a fresh drop-out, one for one.
        winnerTo = { round: lbRoundIndex(j + 1), match: m, slot: 'a' };
      } else {
        // Even → the next round halves the field.
        winnerTo = { round: lbRoundIndex(j + 1), match: m >> 1, slot: m % 2 === 0 ? 'a' : 'b' };
      }
      row.push({
        round: r,
        match: m,
        label: isLast ? 'Losers final' : `Losers round ${j} · ${m + 1}`,
        side: 'losers',
        winnerTo,
        loserTo: null,
      });
    }
    rounds.push(row);
  }

  // --- grand final --------------------------------------------------------
  roundLabels.push('Grand final');
  rounds.push([{
    round: gfRound,
    match: 0,
    label: 'Grand final',
    side: 'final',
    winnerTo: null,
    loserTo: null,
  }]);

  return { format: 'double', size, rounds, roundLabels };
}

/**
 * Round robin by the circle method: fix entrant 0, rotate the rest. With an
 * odd entrant count a `null` placeholder is added and whoever draws it sits
 * that round out.
 */
function roundRobinPlan(size: number): BracketPlan {
  const n = size % 2 === 0 ? size : size + 1;
  const roundCount = n - 1;
  const perRound = n / 2;
  const rounds: MatchPlan[][] = [];
  const roundLabels: string[] = [];
  for (let r = 0; r < roundCount; r++) {
    roundLabels.push(`Round ${r + 1}`);
    const row: MatchPlan[] = [];
    for (let m = 0; m < perRound; m++) {
      row.push({
        round: r,
        match: m,
        label: `Round ${r + 1} · match ${m + 1}`,
        side: 'group',
        winnerTo: null,
        loserTo: null,
      });
    }
    rounds.push(row);
  }
  return { format: 'roundRobin', size, rounds, roundLabels };
}

// --------------------------------------------------------------------------
// Filling the draw
// --------------------------------------------------------------------------

export type BracketMatch = Tournament['bracket'][number][number];

const emptyMatch = (): BracketMatch => ({ a: null, b: null, winner: null, historyId: null });

/**
 * Build the bracket document: the plan's shape, with the first round(s)
 * populated from `ordered`. Fewer entrants than `size` means byes — the extra
 * slots stay `null`, and `autoAdvance` walks them forward immediately.
 */
export function buildBracket(
  format: BracketFormat,
  size: number,
  ordered: readonly string[],
): BracketMatch[][] {
  const plan = bracketPlan(format, size);
  const bracket: BracketMatch[][] = plan.rounds.map((row) => row.map(emptyMatch));

  if (format === 'roundRobin') {
    fillRoundRobin(bracket, size, ordered);
  } else {
    const slots = seedSlots(size);
    for (let i = 0; i < size; i++) {
      const seed = slots[i];
      const id = ordered[seed - 1] ?? null;
      const match = i >> 1;
      if (i % 2 === 0) bracket[0][match].a = id;
      else bracket[0][match].b = id;
    }
  }
  return autoAdvance(plan, bracket);
}

function fillRoundRobin(bracket: BracketMatch[][], size: number, ordered: readonly string[]): void {
  const n = size % 2 === 0 ? size : size + 1;
  const ring: (string | null)[] = [];
  for (let i = 0; i < n; i++) ring.push(ordered[i] ?? null);

  const fixed = ring[0];
  let rotating = ring.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const row = [fixed, ...rotating];
    for (let m = 0; m < n / 2; m++) {
      const a = row[m];
      const b = row[n - 1 - m];
      bracket[r][m].a = a;
      bracket[r][m].b = b;
    }
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, rotating.length - 1)];
  }
}

/**
 * Resolve every bye in the draw, repeatedly, until nothing moves.
 *
 * One rule covers both a genuine bye and an unfilled double-elimination slot:
 * a match with exactly one entrant is already decided, and a match with none
 * decides nothing and passes `null` along. Round robin has no propagation, so
 * a `null` opponent there is simply a rest round.
 */
export function autoAdvance(plan: BracketPlan, bracket: BracketMatch[][]): BracketMatch[][] {
  if (plan.format === 'roundRobin') return bracket;
  const next = bracket.map((row) => row.map((m) => ({ ...m })));

  // Which slots are fed by which match. Every edge in every plan points at a
  // strictly later round, so one ascending pass settles the whole draw.
  const feeder = new Map<string, MatchPlan>();
  const key = (r: SlotRef): string => `${r.round}:${r.match}:${r.slot}`;
  for (const row of plan.rounds) {
    for (const p of row) {
      if (p.winnerTo) feeder.set(key(p.winnerTo), p);
      if (p.loserTo) feeder.set(key(p.loserTo), p);
    }
  }

  /** "This match's winner field is final", true even when that value is null. */
  const resolved: boolean[][] = plan.rounds.map((row) => row.map(() => false));
  const slotFinal = (ref: SlotRef): boolean => {
    const src = feeder.get(key(ref));
    return src === undefined || resolved[src.round][src.match];
  };

  for (const row of plan.rounds) {
    for (const p of row) {
      const m = next[p.round][p.match];
      const aFinal = slotFinal({ round: p.round, match: p.match, slot: 'a' });
      const bFinal = slotFinal({ round: p.round, match: p.match, slot: 'b' });

      if (m.winner === null) {
        // Undecided. It is a bye — and therefore already settled — only when
        // both slots are final and at most one of them holds a fighter.
        if (!aFinal || !bFinal) continue;
        if (m.a !== null && m.b !== null) continue;
        m.winner = m.a ?? m.b;
        m.historyId = null;
      }

      resolved[p.round][p.match] = true;
      const loser = m.winner === null ? null : (m.a === m.winner ? m.b : m.a);
      if (p.winnerTo) next[p.winnerTo.round][p.winnerTo.match][p.winnerTo.slot] = m.winner;
      if (p.loserTo) next[p.loserTo.round][p.loserTo.match][p.loserTo.slot] = loser;
    }
  }
  return next;
}

function planAt(plan: BracketPlan, round: number, match: number): MatchPlan | undefined {
  return plan.rounds[round]?.[match];
}

/**
 * Record a result and advance the bracket. Returns a new bracket; the input is
 * never mutated, so a failed persist cannot leave the screen holding a
 * half-advanced draw.
 */
export function applyResult(
  plan: BracketPlan,
  bracket: BracketMatch[][],
  round: number,
  match: number,
  winner: string,
  historyId: string | null,
): BracketMatch[][] {
  const p = planAt(plan, round, match);
  if (!p) throw new Error(`No match at round ${round}, match ${match}.`);
  const next = bracket.map((row) => row.map((m) => ({ ...m })));
  const target = next[round][match];
  if (target.a !== winner && target.b !== winner) {
    throw new Error(`${winner} is not in that match.`);
  }
  target.winner = winner;
  target.historyId = historyId;
  if (plan.format === 'roundRobin') return next;
  // A full recompute rather than a one-step push: it is idempotent, it fixes
  // any slot a previous partial write left stale, and it is cheap at 32.
  void p;
  return autoAdvance(plan, next);
}

// --------------------------------------------------------------------------
// Reading the draw
// --------------------------------------------------------------------------

export interface PendingMatch {
  round: number;
  match: number;
  label: string;
  a: string;
  b: string;
}

/** Every match that has both fighters and no winner, in bracket order. */
export function readyMatches(plan: BracketPlan, bracket: BracketMatch[][]): PendingMatch[] {
  const out: PendingMatch[] = [];
  for (const row of plan.rounds) {
    for (const p of row) {
      const m = bracket[p.round]?.[p.match];
      if (!m || m.winner !== null || m.a === null || m.b === null) continue;
      out.push({ round: p.round, match: p.match, label: p.label, a: m.a, b: m.b });
    }
  }
  return out;
}

/** The tournament winner, or null while it is still running. */
export function championOf(plan: BracketPlan, bracket: BracketMatch[][]): string | null {
  if (plan.format === 'roundRobin') {
    const table = standings(bracket);
    if (table.length === 0) return null;
    const played = bracket.flat().filter((m) => m.a !== null && m.b !== null);
    if (played.some((m) => m.winner === null)) return null;
    return table[0].id;
  }
  const last = plan.rounds[plan.rounds.length - 1][0];
  return bracket[last.round]?.[last.match]?.winner ?? null;
}

export interface StandingsRow {
  id: string;
  played: number;
  wins: number;
  losses: number;
}

/** Round-robin table: wins first, then fewest losses, then id. */
export function standings(bracket: readonly BracketMatch[][]): StandingsRow[] {
  const rows = new Map<string, StandingsRow>();
  const row = (id: string): StandingsRow => {
    let r = rows.get(id);
    if (!r) {
      r = { id, played: 0, wins: 0, losses: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const r of bracket) {
    for (const m of r) {
      if (m.a === null || m.b === null) continue;
      row(m.a);
      row(m.b);
      if (m.winner === null) continue;
      const loser = m.winner === m.a ? m.b : m.a;
      row(m.winner).wins++;
      row(m.winner).played++;
      row(loser).losses++;
      row(loser).played++;
    }
  }
  return [...rows.values()].sort(
    (x, y) => y.wins - x.wins || x.losses - y.losses || x.id.localeCompare(y.id),
  );
}

/** Total matches a completed draw of this shape contains. */
export function matchCount(plan: BracketPlan): number {
  return plan.rounds.reduce((n, row) => n + row.length, 0);
}
