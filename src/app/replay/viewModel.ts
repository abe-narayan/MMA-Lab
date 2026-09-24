/**
 * WATCH VIEW-MODELS — every derivation the spectator screen needs, as pure
 * functions of (frame, run, intents).
 *
 * The components below `src/app/components` render these and nothing else. Two
 * reasons: the project has no DOM test environment, so the only way to test
 * what the panels say is to test the model they say it from; and the game-plan
 * panel is a *contract* with chapter 07 (09 §4.4) — `gamePlanRows` has to be
 * `Sim.intents()` rearranged, never re-derived, and that is checkable.
 */
import {
  COMMENTARY_MODES, POSITIONS, TIER_LABEL,
  type BoutStats, type CommentaryLine, type FighterDefinition, type FighterIntent,
  type FighterRuntime, type FighterSnapshot, type IntentSample, type RoundStats,
  type SimEvent, type TickSnapshot,
} from '../../sim';
import { FrameStore } from '../../sim/record/frames';

export const CORNERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type Corner = (typeof CORNERS)[number];

export function cornerOf(fighterId: number, teamOf: readonly number[]): Corner {
  const team = teamOf[fighterId] ?? fighterId;
  return CORNERS[Math.min(team, CORNERS.length - 1)];
}

export function clockString(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function recordString(def: FighterDefinition): string {
  const r = def.record;
  const draws = r.proDraws > 0 ? `-${r.proDraws}` : '';
  return `${r.proWins}-${r.proLosses}${draws}`;
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export interface HudFighterRow {
  id: number;
  corner: Corner;
  name: string;
  short: string;
  record: string;
  tier: string;
  /** 0-1 of the aerobic/glycolytic reserve. */
  stamina: number;
  burst: number;
  /** 0-1 of each damage pool; 1 on the head is the KO threshold. */
  damage: { head: number; body: number; legs: number; cut: number };
  posture: string;
  position: string;
  action: string;
  intentTag: string;
  states: readonly string[];
  /** Running significant strikes, from the frame. */
  sig: { landed: number; attempted: number };
  /** This round's significant strikes, from the recorded stats. */
  roundSig: { landed: number; attempted: number };
  down: boolean;
}

export interface HudModel {
  round: number;
  rounds: number;
  clock: string;
  phase: TickSnapshot['phase'];
  referee: TickSnapshot['referee'];
  fighters: HudFighterRow[];
  /** Open scoring only; `null` when the ruleset hides the cards. */
  cards: number[][] | null;
}

function positionName(id: string): string {
  const node = POSITIONS.find((p) => p.id === id);
  return node ? node.name : id;
}

/**
 * Each fighter's running significant-strike tally at the start of each round.
 *
 * The per-round numbers in `BoutStats` are the *finished* round's totals, so a
 * HUD that read them would show a spectator five seconds into round one the
 * figures for the whole round — the future, printed as the present. Subtracting
 * the tally at the round bell from the tally on the frame gives the number as
 * it stood when that frame was live, which is what a HUD is for.
 */
export function roundBaselines(
  frames: readonly TickSnapshot[], events: readonly SimEvent[],
): Map<number, { landed: number; attempted: number }[]> {
  const out = new Map<number, { landed: number; attempted: number }[]>();
  // Index, not frame: recorded frames decode on access (sim/record/frames.ts),
  // so holding every decoded frame in a map would rebuild the whole bout as
  // objects just to read a few of them.
  const store = FrameStore.of(frames);
  const byTick = new Map<number, number>();
  for (let i = 0; i < frames.length; i++) {
    const tick = store ? (store.tickAt(i) as number) : frames[i].tick;
    if (!byTick.has(tick)) byTick.set(tick, i);
  }
  for (const e of events) {
    if (e.kind !== 'roundStart' || out.has(e.round)) continue;
    const at = byTick.get(e.tick);
    if (at === undefined) continue;
    const frame = frames[at];
    out.set(e.round, frame.fighters.map((f) => ({ ...f.sig })));
  }
  return out;
}

export function hudModel(
  frame: TickSnapshot | null,
  fighters: readonly FighterDefinition[],
  runtimes: readonly FighterRuntime[],
  stats: BoutStats,
  teamOf: readonly number[],
  rounds: number,
  baselines?: ReadonlyMap<number, { landed: number; attempted: number }[]>,
): HudModel | null {
  if (!frame) return null;
  const round = stats.perRound.find((r) => r.round === frame.round);
  const base = baselines?.get(frame.round);
  return {
    round: frame.round,
    rounds,
    clock: clockString(frame.roundTime),
    phase: frame.phase,
    referee: frame.referee,
    cards: frame.score.hidden ? null : frame.score.cards ?? null,
    fighters: frame.fighters.map((f) => {
      const def = fighters[f.id];
      const rt = runtimes[f.id];
      const rs = round?.fighters.find((x) => x.fighter === f.id);
      return {
        id: f.id,
        corner: cornerOf(f.id, teamOf),
        name: def?.name ?? `Fighter ${f.id}`,
        short: def?.short ?? `F${f.id}`,
        record: def ? recordString(def) : '',
        tier: rt ? TIER_LABEL[Math.max(0, Math.min(5, rt.mmaTier))] : '',
        stamina: f.stamina.total,
        burst: f.stamina.burst,
        damage: { head: f.damage.head, body: f.damage.body, legs: f.damage.legs, cut: f.damage.cut },
        posture: f.posture,
        position: positionName(f.position),
        action: f.action,
        intentTag: f.intentTag,
        states: f.states,
        sig: f.sig,
        roundSig: base?.[f.id]
          ? {
            landed: Math.max(0, f.sig.landed - base[f.id].landed),
            attempted: Math.max(0, f.sig.attempted - base[f.id].attempted),
          }
          : rs ? rs.sig : { landed: 0, attempted: 0 },
        down: f.posture === 'down' || f.posture === 'out',
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Game-plan panel (09 §4.4) — the visible game plan
// ---------------------------------------------------------------------------

export interface GamePlanRow {
  fighterId: number;
  corner: Corner;
  name: string;
  /** The raw `mode.*` id, kept so the panel can be checked against `intents()`. */
  mode: string;
  modeLabel: string;
  /** The corner's line for this mode, from the commentary lexicon. */
  modeLine: string;
  phase: FighterIntent['phase'];
  planLines: readonly string[];
  adjustments: readonly { id: string; trigger: string; sinceRound: number }[];
  scoreBelief: number;
  scoreBeliefLabel: string;
  emergency: boolean;
  tierRules: readonly string[];
  animationTags: readonly string[];
}

/** The intent reading in force at `tick` — the last sample at or before it. */
export function intentsAt(
  samples: readonly IntentSample[], tick: number,
): readonly FighterIntent[] {
  let best: readonly FighterIntent[] = [];
  for (const s of samples) {
    if (s.tick > tick) break;
    best = s.intents;
  }
  return best.length > 0 ? best : (samples[0]?.intents ?? []);
}

/**
 * `Sim.intents()` rearranged for the panel. Every field is copied through:
 * nothing here recomputes a plan, so what the panel shows is what the AI
 * believes (09 §4.4).
 */
export function gamePlanRows(
  intents: readonly FighterIntent[],
  fighters: readonly FighterDefinition[],
  teamOf: readonly number[],
): GamePlanRow[] {
  return intents.map((intent) => {
    const words = COMMENTARY_MODES[intent.mode];
    const def = fighters[intent.fighterId];
    return {
      fighterId: intent.fighterId,
      corner: cornerOf(intent.fighterId, teamOf),
      name: def?.short ?? `F${intent.fighterId}`,
      mode: intent.mode,
      modeLabel: words ? words.name : intent.mode.replace(/^mode\./, '').replace(/_/g, ' '),
      modeLine: words ? words.plan : 'no plan on record',
      phase: intent.phase,
      planLines: intent.planLines,
      adjustments: intent.adjustments,
      scoreBelief: intent.scoreBelief,
      scoreBeliefLabel: beliefLabel(intent.scoreBelief),
      emergency: intent.emergency,
      tierRules: intent.tierRules,
      animationTags: intent.animationTags,
    };
  });
}

function beliefLabel(belief: number): string {
  if (belief >= 0.75) return 'thinks he is well ahead';
  if (belief >= 0.55) return 'thinks he is ahead';
  if (belief > 0.45) return 'thinks it is close';
  if (belief > 0.25) return 'thinks he is behind';
  return 'thinks he is well behind';
}

// ---------------------------------------------------------------------------
// Stat table and scorecards
// ---------------------------------------------------------------------------

export interface StatRow {
  label: string;
  values: string[];
  /** True when the larger number is the better one, for the lead marker. */
  higherIsBetter: boolean;
}

export function statRows(round: RoundStats | undefined): StatRow[] {
  if (!round || round.fighters.length === 0) return [];
  const f = round.fighters;
  const la = (pick: (i: number) => { landed: number; attempted: number }): string[] =>
    f.map((_, i) => {
      const v = pick(i);
      const pct = v.attempted > 0 ? Math.round((v.landed / v.attempted) * 100) : 0;
      return `${v.landed}/${v.attempted} (${pct}%)`;
    });
  const num = (pick: (i: number) => number, digits = 0): string[] =>
    f.map((_, i) => pick(i).toFixed(digits));
  return [
    { label: 'Significant strikes', values: la((i) => f[i].sig), higherIsBetter: true },
    { label: 'Total strikes', values: la((i) => f[i].total), higherIsBetter: true },
    { label: 'Head', values: la((i) => f[i].sigByTarget.head), higherIsBetter: true },
    { label: 'Body', values: la((i) => f[i].sigByTarget.body), higherIsBetter: true },
    { label: 'Leg', values: la((i) => f[i].sigByTarget.leg), higherIsBetter: true },
    { label: 'At distance', values: la((i) => f[i].sigByPosition.distance), higherIsBetter: true },
    { label: 'In the clinch', values: la((i) => f[i].sigByPosition.clinch), higherIsBetter: true },
    { label: 'On the ground', values: la((i) => f[i].sigByPosition.ground), higherIsBetter: true },
    { label: 'Takedowns', values: la((i) => f[i].takedowns), higherIsBetter: true },
    { label: 'Knockdowns', values: num((i) => f[i].knockdowns), higherIsBetter: true },
    { label: 'Submission attempts', values: num((i) => f[i].subAttempts), higherIsBetter: true },
    { label: 'Reversals', values: num((i) => f[i].reversals), higherIsBetter: true },
    { label: 'Control time (s)', values: num((i) => f[i].controlSeconds, 1), higherIsBetter: true },
    { label: 'Sig. absorbed', values: num((i) => f[i].sigAbsorbed), higherIsBetter: false },
  ];
}

export interface ScorecardModel {
  hidden: boolean;
  /** `[judge][round]` margins for fighter 0, positive when 0 is ahead. */
  judges: { name: string; rounds: number[][]; totals: number[] }[];
  rounds: number[];
}

export function scorecardModel(
  events: readonly SimEvent[], judgeTotals: readonly number[][], hidden: boolean,
): ScorecardModel {
  const byJudge: number[][][] = [];
  const rounds: number[] = [];
  for (const e of events) {
    if (e.kind !== 'scorecardRound') continue;
    const cards = (e as { detail: { cards?: number[][] } }).detail.cards;
    if (!cards) continue;
    rounds.push(e.round);
    cards.forEach((card, j) => {
      if (!byJudge[j]) byJudge[j] = [];
      byJudge[j].push(card);
    });
  }
  return {
    hidden,
    rounds,
    judges: byJudge.map((rows, j) => ({
      name: `Judge ${j + 1}`,
      rounds: rows,
      totals: judgeTotals[j] ? [...judgeTotals[j]] : rows.reduce<number[]>((acc, r) => {
        r.forEach((v, i) => {
          acc[i] = (acc[i] ?? 0) + v;
        });
        return acc;
      }, []),
    })),
  };
}

// ---------------------------------------------------------------------------
// Debug overlay
// ---------------------------------------------------------------------------

export interface DebugFighterRow {
  id: number;
  name: string;
  /** State-graph position: the node, the role and how long it has been held. */
  node: string;
  role: string;
  posture: string;
  balance: number;
  action: string;
  actionStage: string;
  actionPhase: number;
  defence: string;
  states: readonly string[];
  stamina: { total: number; burst: number };
  damage: { head: number; body: number; legs: number; cut: number };
  damageZones: readonly number[];
  /**
   * What the AI is weighing. `FighterIntent` exposes the decision's *outcome*
   * (mode, adjustments, belief, the tier rows that fired) rather than the raw
   * utility scores, so those are what this shows — labelled for what they are.
   */
  intentTag: string;
  mode: string;
  scoreBelief: number;
  adjustments: readonly string[];
  tierRules: readonly string[];
  animationTags: readonly string[];
}

export function debugRows(
  frame: TickSnapshot | null,
  intents: readonly FighterIntent[],
  fighters: readonly FighterDefinition[],
): DebugFighterRow[] {
  if (!frame) return [];
  return frame.fighters.map((f: FighterSnapshot) => {
    const intent = intents.find((i) => i.fighterId === f.id);
    return {
      id: f.id,
      name: fighters[f.id]?.short ?? `F${f.id}`,
      node: f.position,
      role: f.role,
      posture: f.posture,
      balance: f.balance,
      action: f.action,
      actionStage: f.actionStage,
      actionPhase: f.actionPhase,
      defence: f.defence,
      states: f.states,
      stamina: f.stamina,
      damage: f.damage,
      damageZones: f.damageVisual.zones,
      intentTag: f.intentTag,
      mode: intent?.mode ?? 'unknown',
      scoreBelief: intent?.scoreBelief ?? 0.5,
      adjustments: intent ? intent.adjustments.map((a) => `${a.id} (${a.trigger})`) : [],
      tierRules: intent?.tierRules ?? [],
      animationTags: intent?.animationTags ?? [],
    };
  });
}

// ---------------------------------------------------------------------------
// Commentary feed
// ---------------------------------------------------------------------------

/** The lines spoken at or before `tick`, newest last, capped at `limit`. */
export function commentaryUpTo(
  lines: readonly CommentaryLine[], tick: number, limit = 60,
): readonly CommentaryLine[] {
  let end = 0;
  while (end < lines.length && lines[end].tick <= tick) end++;
  return lines.slice(Math.max(0, end - limit), end);
}
