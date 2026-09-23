/**
 * BROADCAST GRAPHICS MODEL — what the on-screen graphics show, as a pure
 * function of (bout, frame, events, replay state).
 *
 * Timeline-driven by construction: a seek, a scrub or an instant replay lands
 * on exactly the graphics a live viewer would have seen at that moment — the
 * clock as it stood, the running strike counts, the round card at a bell, the
 * knockdown flash just after a knockdown, the stat comparison in the break,
 * the result at the end. No wall clock, no component state.
 */
import type {
  BoutResult, BoutStats, FighterDefinition, FighterRuntime, RoundStats, SimEvent, TickSnapshot,
} from '../../../sim';

export interface BroadcastFighter {
  id: number;
  /** Given names (small line) and surname (the big one). */
  first: string;
  last: string;
  nickname: string | null;
  short: string;
  colour: string;
  cornerLabel: string;
  record: string;
  age: number;
  heightCm: number;
  reachCm: number;
  weightKg: number;
  weightClass: string;
  stance: string;
  base: string;
}

export interface BroadcastBout {
  /** Event line on the tale of the tape. */
  eventTitle: string;
  rulesetLabel: string;
  rounds: number;
  roundSeconds: number;
  breakSeconds: number;
  fighters: BroadcastFighter[];
  stats: BoutStats | null;
  result: BoutResult | null;
}

const titleCase = (s: string): string => s.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { first: '', last: name.trim() };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function recordOf(def: FighterDefinition): string {
  const r = def.record;
  return `${r.proWins}-${r.proLosses}${r.proDraws > 0 ? `-${r.proDraws}` : ''}`;
}

function baseDiscipline(rt: FighterRuntime | undefined): string {
  if (!rt) return '—';
  let best = '';
  let bestMean = -1;
  for (const [id, d] of Object.entries(rt.disciplines ?? {})) {
    if (!d || d.yearsTrained <= 0) continue;
    if (d.mean > bestMean) {
      bestMean = d.mean;
      best = id;
    }
  }
  const names: Record<string, string> = {
    bjj: 'Jiu-Jitsu', muayThai: 'Muay Thai', mmaIntegration: 'MMA', taekwondo: 'Taekwondo', kickboxing: 'Kickboxing',
  };
  return best ? names[best] ?? titleCase(best) : '—';
}

export interface MakeBroadcastBoutArgs {
  fighters: readonly FighterDefinition[];
  runtimes: readonly FighterRuntime[];
  cornerColours: readonly string[];
  stats?: BoutStats | null;
  result?: BoutResult | null;
  rounds: number;
  roundSeconds: number;
  breakSeconds?: number;
  rulesetLabel?: string;
  eventTitle?: string;
}

/** Build the static half of the graphics from the fighter definitions and runtimes. */
export function makeBroadcastBout(a: MakeBroadcastBoutArgs): BroadcastBout {
  const labels = ['RED CORNER', 'BLUE CORNER'];
  return {
    eventTitle: a.eventTitle ?? 'BOUT LAB · MAIN EVENT',
    rulesetLabel: a.rulesetLabel ?? `${a.rounds} × ${Math.round(a.roundSeconds / 60)} MIN`,
    rounds: a.rounds,
    roundSeconds: a.roundSeconds,
    breakSeconds: a.breakSeconds ?? 60,
    stats: a.stats ?? null,
    result: a.result ?? null,
    fighters: a.fighters.map((def, i) => {
      const rt = a.runtimes[i];
      const { first, last } = splitName(def.name);
      const body = rt?.body;
      return {
        id: i,
        first,
        last,
        nickname: def.appearance?.nickname ?? null,
        short: def.short,
        colour: a.cornerColours[i] ?? (i === 0 ? '#d23a3a' : '#2f6fe0'),
        cornerLabel: labels[i] ?? `CORNER ${i + 1}`,
        record: recordOf(def),
        age: Math.round(body?.ageYears ?? def.body.ageYears),
        heightCm: Math.round((body?.heightM ?? def.body.heightM) * 100),
        reachCm: Math.round((body?.reachM ?? def.body.reachM) * 100),
        weightKg: Math.round((body?.weighInKg ?? def.body.massKg) * 10) / 10,
        weightClass: titleCase(String(body?.weightClass ?? '').replace(/^wc\./, '')),
        stance: titleCase(String(body?.stance ?? def.body.stance)),
        base: baseDiscipline(rt),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Formatting (imperial alongside metric, 00_CONVENTIONS §2)
// ---------------------------------------------------------------------------

export function feetInches(cm: number): string {
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}' ${inches % 12}"`;
}
export const inchesOf = (cm: number): string => `${Math.round(cm / 2.54)}"`;
export const poundsOf = (kg: number): string => `${Math.round(kg * 2.20462)} lb`;
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// The scene: which graphics are up at this frame
// ---------------------------------------------------------------------------

export interface ClockBugModel {
  round: number;
  rounds: number;
  /** "3:41", or "END R1" / "BREAK" between rounds. */
  clock: string;
  status: 'live' | 'break' | 'final';
  sig: { landed: number; attempted: number }[];
}

export interface StatLine {
  label: string;
  values: [string, string];
  /** Share of the bar for fighter 0 (0-1), or null for no bar. */
  share: number | null;
}

export interface RoundStatsModel {
  title: string;
  lines: StatLine[];
}

export interface FinishModel {
  method: string;
  detail: string;
  round: number;
  time: string;
  winner: number | null;
}

export interface ScorecardsModel {
  judges: { name: string; totals: [number, number] }[];
  verdict: string;
  winner: number | null;
}

export interface KnockdownModel {
  /** The fighter who went down. */
  downed: number;
  by: number;
  /** Event tick, used as the React key so a second knockdown re-animates. */
  tick: number;
}

export interface BroadcastScene {
  tape: boolean;
  clock: ClockBugModel | null;
  roundCard: { round: number; rounds: number; key: number } | null;
  roundStats: RoundStatsModel | null;
  knockdown: KnockdownModel | null;
  finish: FinishModel | null;
  scorecards: ScorecardsModel | null;
}

const FINISH_LABEL: Record<string, string> = {
  ko: 'KO', tko: 'TKO', 'tko.doctor': "TKO · DOCTOR'S STOPPAGE", 'tko.corner': 'TKO · CORNER STOPPAGE',
  'tko.retirement': 'TKO · RETIREMENT', submission: 'SUBMISSION', 'submission.technical': 'TECHNICAL SUBMISSION',
  dq: 'DISQUALIFICATION', noContest: 'NO CONTEST',
};
const DECISION_LABEL: Record<string, string> = {
  'decision.unanimous': 'UNANIMOUS DECISION', 'decision.split': 'SPLIT DECISION',
  'decision.majority': 'MAJORITY DECISION', 'decision.technical': 'TECHNICAL DECISION',
  draw: 'DRAW', 'draw.majority': 'MAJORITY DRAW', 'draw.split': 'SPLIT DRAW',
};

function sumStats(perRound: readonly RoundStats[], upTo: number): RoundStats | null {
  const rs = perRound.filter((r) => r.round <= upTo);
  if (rs.length === 0) return null;
  const out: RoundStats = JSON.parse(JSON.stringify(rs[0]));
  for (const r of rs.slice(1)) {
    out.seconds += r.seconds;
    r.fighters.forEach((f, i) => {
      const o = out.fighters[i];
      if (!o) return;
      o.sig.landed += f.sig.landed; o.sig.attempted += f.sig.attempted;
      o.total.landed += f.total.landed; o.total.attempted += f.total.attempted;
      o.takedowns.landed += f.takedowns.landed; o.takedowns.attempted += f.takedowns.attempted;
      o.knockdowns += f.knockdowns; o.subAttempts += f.subAttempts; o.controlSeconds += f.controlSeconds;
    });
  }
  return out;
}

export function roundStatLines(r: RoundStats): StatLine[] {
  const [a, b] = r.fighters;
  if (!a || !b) return [];
  const share = (x: number, y: number): number | null => (x + y > 0 ? x / (x + y) : null);
  const la = (v: { landed: number; attempted: number }): string => `${v.landed}/${v.attempted}`;
  const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  return [
    { label: 'SIG. STRIKES', values: [la(a.sig), la(b.sig)], share: share(a.sig.landed, b.sig.landed) },
    { label: 'TOTAL STRIKES', values: [la(a.total), la(b.total)], share: share(a.total.landed, b.total.landed) },
    { label: 'TAKEDOWNS', values: [la(a.takedowns), la(b.takedowns)], share: share(a.takedowns.landed, b.takedowns.landed) },
    { label: 'KNOCKDOWNS', values: [String(a.knockdowns), String(b.knockdowns)], share: share(a.knockdowns, b.knockdowns) },
    { label: 'SUB. ATTEMPTS', values: [String(a.subAttempts), String(b.subAttempts)], share: share(a.subAttempts, b.subAttempts) },
    { label: 'CONTROL TIME', values: [mmss(a.controlSeconds), mmss(b.controlSeconds)], share: share(a.controlSeconds, b.controlSeconds) },
  ];
}

export interface SceneOptions {
  /** Show the tale of the tape on the opening frame (default true). */
  taleOfTheTape?: boolean;
  /** True while an instant replay is on air: transient graphics step aside. */
  replay?: boolean;
}

/**
 * Which graphics are on screen at `frame`. `events` is the whole recorded
 * stream (only events at or before the frame are read).
 */
export function broadcastScene(
  bout: BroadcastBout, frame: TickSnapshot | null, events: readonly SimEvent[], opts: SceneOptions = {},
): BroadcastScene {
  const empty: BroadcastScene = {
    tape: false, clock: null, roundCard: null, roundStats: null, knockdown: null, finish: null, scorecards: null,
  };
  if (!frame) return empty;
  const tick = frame.tick;
  const replay = opts.replay ?? false;
  const scene: BroadcastScene = { ...empty };

  // Walk the stream once, up to the playhead.
  let lastRoundEnd: SimEvent | null = null;
  let lastRoundStart: SimEvent | null = null;
  let lastKd: SimEvent | null = null;
  let boutEnd: SimEvent | null = null;
  let decision: SimEvent | null = null;
  for (const e of events) {
    if (e.tick > tick) break;
    if (e.kind === 'roundEnd') lastRoundEnd = e;
    else if (e.kind === 'roundStart') lastRoundStart = e;
    else if (e.kind === 'knockdown') lastKd = e;
    else if (e.kind === 'boutEnd') boutEnd = e;
    else if (e.kind === 'decision') decision = e;
  }

  if (frame.phase === 'pre' || tick === 0) {
    scene.tape = opts.taleOfTheTape !== false;
    return scene;
  }

  const ended = boutEnd !== null || frame.phase === 'ended';
  const sig = frame.fighters.map((f) => ({ ...f.sig }));

  if (ended && !replay) {
    const res = bout.result;
    const method = res?.method ?? String((boutEnd?.detail as { method?: string } | undefined)?.method ?? '');
    if (method.startsWith('decision') || method.startsWith('draw')) {
      const cards = res?.judgeTotals ?? [];
      const w = res && typeof res.winner === 'number' ? res.winner : (decision?.detail as { winner?: number | 'draw' } | undefined)?.winner;
      scene.scorecards = {
        judges: cards.map((c, j) => ({ name: `JUDGE ${String.fromCharCode(65 + j)}`, totals: [c[0] ?? 0, c[1] ?? 0] as [number, number] })),
        verdict: DECISION_LABEL[method] ?? 'DECISION',
        winner: typeof w === 'number' ? w : null,
      };
    } else if (method) {
      const round = res?.round ?? frame.round;
      scene.finish = {
        method: FINISH_LABEL[method] ?? method.toUpperCase(),
        detail: res?.detail ? titleCase(res.detail.replace(/^tech\./, '')) : '',
        round,
        time: clock(res?.timeSeconds ?? frame.roundTime),
        winner: res && typeof res.winner === 'number' ? res.winner : null,
      };
    }
    return scene;
  }

  // The clock bug.
  if (!replay) {
    if (frame.phase === 'break') {
      const endedRound = lastRoundEnd?.round ?? Math.max(1, frame.round - 1);
      const since = lastRoundEnd ? (tick - lastRoundEnd.tick) * 0.1 : 0;
      scene.clock = {
        round: endedRound, rounds: bout.rounds, clock: `END R${endedRound}`, status: 'break', sig,
      };
      // End-of-round comparison, while the corners work.
      if (since >= 3 && since <= bout.breakSeconds - 14 && bout.stats) {
        const r = bout.stats.perRound.find((x) => x.round === endedRound);
        if (r) scene.roundStats = { title: `END OF ROUND ${endedRound}`, lines: roundStatLines(r) };
      }
    } else {
      scene.clock = {
        round: frame.round, rounds: bout.rounds, clock: clock(bout.roundSeconds - frame.roundTime),
        status: 'live', sig,
      };
      if (frame.roundTime < 4.5 && lastRoundStart) {
        scene.roundCard = { round: frame.round, rounds: bout.rounds, key: lastRoundStart.tick };
      }
      if (lastKd && tick - lastKd.tick <= 45) {
        const downed = lastKd.target >= 0 ? lastKd.target : lastKd.actor;
        scene.knockdown = { downed, by: lastKd.target >= 0 ? lastKd.actor : -1, tick: lastKd.tick };
      }
    }
  }
  return scene;
}

/** Bout totals up to and including `round`, for a "so far" comparison. */
export function totalsThrough(bout: BroadcastBout, round: number): StatLine[] {
  if (!bout.stats) return [];
  const s = sumStats(bout.stats.perRound, round);
  return s ? roundStatLines(s) : [];
}
