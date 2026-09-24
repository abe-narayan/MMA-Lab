/**
 * BOUT -> ROW. Pure, read-only reduction of a `BoutRun` to the compact
 * `ResultRow` of docs/design/09 §6.4.
 *
 * Most numbers come straight from `run.stats` (the §4.1 UFCStats tallies,
 * `computeStats`). The rest — position x target cross-tabs, knockdown timing,
 * the finishing blow, low-intensity time, clinch initiative, adaptation windows
 * — need the event stream, so this file replays it once with the *same* pair
 * reconstruction `computeStats` uses (a fighter's strike position is the phase
 * of the pair it is in; a knockdown, stand-up, break or finish clears the
 * pair). `tests/calibration.infra.test.ts` checks the cross-tabs sum back to
 * `stats.total` exactly, so the two views cannot drift apart.
 *
 * Nothing here draws a random number, reads a clock or mutates the run.
 */
import {
  POSITIONS, SIM_ENGINE_VERSION, TECHNIQUES, SUBMISSIONS, createSim, checkWorldInvariants,
  computeStats, deriveRuntime, hashParams, isSignificantStrike, isStatLanded, resolveParams, resolveRuleset,
  type BoutRun, type FighterDefinition, type SimConfig, type SimEvent,
} from '../../src/sim';
import type {
  BoutTags, CellTags, FighterMeta, FighterRow, FinishRow, KdRow, LA, QaRow, ResultRow,
} from './types';

type Phase = 'distance' | 'clinch' | 'ground';
const PHASES: readonly Phase[] = ['distance', 'clinch', 'ground'];
const TARGETS = ['head', 'body', 'leg'] as const;
type TargetBucket = (typeof TARGETS)[number];

const FAMILY = new Map<string, string>(POSITIONS.map((p) => [p.id as string, p.family as string]));
const WEAPON = new Map<string, string>(TECHNIQUES.map((t) => [t.id as string, t.weapon as string]));
const SUB_FAMILY = new Map<string, string>(
  SUBMISSIONS.map((s) => [s.id as string, String((s as { family?: string }).family ?? 'other')]),
);

/** `stats.ts` phaseOf, restated on the public position table. */
export function phaseOfNode(node: string | null | undefined): Phase {
  if (!node) return 'distance';
  const fam = FAMILY.get(node);
  if (fam === undefined || fam === 'standingFree') return 'distance';
  if (fam === 'clinch') return 'clinch';
  return 'ground';
}

function targetBucket(region: string): TargetBucket | null {
  if (region === 'head') return 'head';
  if (region === 'body') return 'body';
  if (region === 'leadLeg' || region === 'rearLeg') return 'leg';
  return null;
}

/** §4.1 significance: the sim's one shared definition (`isSignificantStrike`). */
function isSignificant(technique: string, phase: Phase, short = false): boolean {
  return isSignificantStrike(technique, phase, short);
}

/** Weapon class for rows 27–29: punch / kick / knee / elbow / other. */
export function weaponClass(technique: string): string {
  const w = WEAPON.get(technique);
  if (w !== undefined) {
    if (w === 'fist' || w === 'backfist' || w === 'hammerfist') return 'punch';
    if (w === 'knee') return 'knee';
    if (w === 'elbow' || w === 'elbow_point') return 'elbow';
    if (w === 'shin' || w === 'instep' || w === 'ball_of_foot' || w === 'heel' || w === 'shin_on_knee') return 'kick';
    return 'other';
  }
  // Ground strikes are chapter-03 ids outside the §02 catalogue.
  const id = technique.toLowerCase();
  if (id.includes('elbow')) return 'elbow';
  if (id.includes('knee')) return 'knee';
  if (id.includes('kick') || id.includes('stomp') || id.includes('teep') || id.includes('soccer')) return 'kick';
  if (/punch|hammer|fist|jab|cross|hook|uppercut|overhand|gnp/.test(id)) return 'punch';
  return 'other';
}

function isRearKick(technique: string): boolean {
  return (technique.includes('kick') || technique.includes('teep')) && technique.endsWith('_rear');
}

const la = (): LA => [0, 0];

function roundLengthS(config: SimConfig): number {
  if (config.settings.roundSeconds !== undefined) return config.settings.roundSeconds;
  try {
    const rs = resolveRuleset(config.ruleset);
    return rs.rounds?.lengthS ?? 0;
  } catch {
    return 0;
  }
}

function metaOf(def: FighterDefinition, team: number, overrides: SimConfig['paramOverrides']): FighterMeta {
  const params = resolveParams(overrides);
  let tier = -1;
  let rating = NaN;
  let exp = NaN;
  try {
    const rt = deriveRuntime(def, params, { explain: false });
    tier = rt.mmaTier;
    rating = round3(rt.mmaMean);
    exp = round3(rt.experience);
  } catch { /* an edge-case definition that does not derive: leave the markers */ }
  const r = def.record;
  return {
    tier,
    rating,
    exp,
    h: def.body.heightM,
    reach: def.body.reachM,
    kg: def.body.fightNightKg ?? def.body.massKg,
    age: def.body.ageYears,
    stance: def.body.stance,
    sex: def.body.sex ?? 'male',
    bouts: (r?.proWins ?? 0) + (r?.proLosses ?? 0) + (r?.proDraws ?? 0),
    kdHist: r?.knockdownsSuffered ?? 0,
    team,
  };
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const round1 = (v: number): number => Math.round(v * 10) / 10;

interface PairState {
  node: string;
  a: number;
  b: number;
  /** Who put the pair into its current clinch spell (-1 if not a clinch). */
  clinchBy: number;
}

interface StrikeRec {
  tick: number;
  actor: number;
  target: number;
  tech: string;
  landed: boolean;
  region: string;
  ph: Phase;
}

/**
 * Reduce a finished run to its row. `qa` is attached by `runQaBout`.
 */
export function summarizeRun(
  run: BoutRun, cell: string, i: number, tags: CellTags, bt: BoutTags | undefined, qa?: QaRow,
): ResultRow {
  const config = run.config;
  const n = config.fighters.length;
  const params = resolveParams(config.paramOverrides);
  const dt = params.get('core.dtMs') / 1000;
  const events = run.events;

  // ---- per-fighter accumulators -----------------------------------------
  const pt = Array.from({ length: n }, () => new Array<number>(18).fill(0));
  const jab = Array.from({ length: n }, la);
  const hd = Array.from({ length: n }, la);
  const cle = new Array<number>(n).fill(0);
  const cls = new Array<number>(n).fill(0);
  const fe = new Array<number>(n).fill(0);
  const rk = new Array<number>(n).fill(0);
  const inCl = new Array<number>(n).fill(0);
  const inGr = new Array<number>(n).fill(0);
  const con = new Array<number>(n).fill(0);
  const lastContactTick = new Array<number>(n).fill(-1e9);

  const pos: [number, number, number] = [0, 0, 0];
  const live: number[] = [];
  const low: number[] = [];
  const kd: KdRow[] = [];
  const strikes: StrikeRec[] = [];
  let slam = 0;
  let fin: FinishRow | undefined;
  let lagS: number | undefined;

  const byTick = new Map<number, SimEvent[]>();
  for (const e of events) {
    const list = byTick.get(e.tick);
    if (list) list.push(e);
    else byTick.set(e.tick, [e]);
  }

  const pairOf = new Map<number, PairState>();
  const clearAfterTick: number[] = [];
  const clearPair = (id: number): void => {
    const p = pairOf.get(id);
    if (!p) return;
    pairOf.delete(p.a);
    pairOf.delete(p.b);
  };
  const setPair = (a: number, b: number, node: string, actor: number): void => {
    const prev = pairOf.get(a);
    const wasClinch = prev !== undefined && phaseOfNode(prev.node) === 'clinch'
      && ((prev.a === a && prev.b === b) || (prev.a === b && prev.b === a));
    const carriedBy = wasClinch ? prev.clinchBy : -1;
    clearPair(a);
    clearPair(b);
    const ph = phaseOfNode(node);
    if (ph === 'distance') return;
    const p: PairState = { node, a, b, clinchBy: ph === 'clinch' ? (carriedBy >= 0 ? carriedBy : actor) : -1 };
    pairOf.set(a, p);
    pairOf.set(b, p);
  };

  let round = 1;
  let isLive = true;
  let lastStrikeTick = -1e9;
  let roundStartTick = 0;
  const ensureRound = (r: number): void => {
    while (live.length < r) {
      live.push(0);
      low.push(0);
    }
  };
  ensureRound(1);

  const apply = (e: SimEvent): void => {
    if (e.round > 0) round = e.round;
    switch (e.kind) {
      case 'roundStart':
        isLive = true;
        roundStartTick = e.tick;
        ensureRound(e.round);
        break;
      case 'roundEnd':
        isLive = false;
        // The engine separates every pair for the break.
        pairOf.clear();
        break;
      case 'strike': {
        const d = e.detail;
        const pair = pairOf.get(e.actor);
        const ph = phaseOfNode(pair ? pair.node : null);
        const landed = isStatLanded(d.result);
        lastStrikeTick = e.tick;
        if (e.actor >= 0 && e.actor < n) lastContactTick[e.actor] = e.tick;
        if (e.target >= 0 && e.target < n) lastContactTick[e.target] = e.tick;
        if (e.actor < 0 || e.actor >= n) break;
        strikes.push({ tick: e.tick, actor: e.actor, target: e.target, tech: d.technique, landed, region: d.target, ph });
        if (isRearKick(d.technique)) rk[e.actor]++;
        if (d.target === 'head') {
          hd[e.actor][1]++;
          if (landed) hd[e.actor][0]++;
        }
        if (!isSignificant(d.technique, ph, d.short === true)) break;
        const bucket = targetBucket(d.target);
        if (!bucket) break;
        const k = (PHASES.indexOf(ph) * 3 + TARGETS.indexOf(bucket)) * 2;
        pt[e.actor][k + 1]++;
        if (landed) pt[e.actor][k]++;
        if (ph === 'distance' && bucket === 'head' && d.technique.startsWith('tech.jab')) {
          jab[e.actor][1]++;
          if (landed) jab[e.actor][0]++;
        }
        break;
      }
      case 'feint':
        if (e.actor >= 0 && e.actor < n) fe[e.actor]++;
        break;
      case 'knockdown': {
        const d = e.detail;
        kd.push([
          e.round, round1((e.tick - roundStartTick) * dt), e.actor, e.target,
          String(d.cause ?? ''), String(d.kind ?? ''),
        ]);
        // As in stats.ts: the causing strike is logged after its knockdown on
        // the same tick; clear the pair once the tick is done.
        clearAfterTick.push(e.target);
        break;
      }
      case 'takedown':
      case 'clinch':
      case 'engagementJoin':
      case 'positionChange':
      case 'scramble':
      case 'reversal':
      case 'standUp':
      case 'clinchBreak':
      case 'disengage': {
        const d = e.detail;
        if (d.reason === 'contested') break;
        const edge = d.edge ?? '';
        const toClinch = d.to !== undefined && phaseOfNode(d.to) === 'clinch';
        if (e.kind === 'takedown' && e.actor >= 0 && e.actor < n && (edge.includes('clinch_entry') || toClinch)) cle[e.actor]++;
        if (e.kind !== 'engagementJoin' && d.result === 'success' && edge.includes('slam')) slam++;
        // Slot `a` of the destination (who is on top) is `detail.a`; the
        // event's actor is only the fighter who attempted the edge.
        const slotA = d.a ?? e.actor;
        const other = slotA === e.actor ? e.target : e.actor;
        if (d.to) setPair(slotA, other, d.to, e.actor);
        else if (d.result === 'success' && (e.kind === 'standUp' || e.kind === 'clinchBreak' || e.kind === 'disengage')) {
          clearPair(e.actor);
          clearPair(e.target);
        }
        break;
      }
      case 'submissionFinish': {
        const pair = pairOf.get(e.actor);
        fin = {
          k: 'sub',
          id: e.detail.technique,
          cls: SUB_FAMILY.get(e.detail.technique) ?? 'other',
          tgt: e.detail.type,
          pos: phaseOfNode(pair ? pair.node : null),
        };
        clearPair(e.actor);
        clearPair(e.target);
        break;
      }
      case 'fighterOut':
        clearPair(e.actor);
        clearPair(e.target);
        break;
      case 'refereeStoppage':
        if (typeof e.detail.lagS === 'number') lagS = e.detail.lagS;
        break;
      default:
        break;
    }
  };

  // Events at tick 0 (bout start) first, then integrate tick by tick.
  const lastTick = Math.max(run.ticks, events.length > 0 ? events[events.length - 1].tick : 0);
  for (const e of byTick.get(0) ?? []) apply(e);
  for (let tick = 1; tick <= lastTick; tick++) {
    const here = byTick.get(tick);
    if (here) {
      for (const e of here) apply(e);
      for (const id of clearAfterTick) clearPair(id);
      clearAfterTick.length = 0;
    }
    if (!isLive) continue;
    ensureRound(round);
    live[round - 1] += dt;
    const pairs = [...new Set(pairOf.values())];
    const ph: Phase = pairs.length === 0 ? 'distance' : phaseOfNode(pairs[0].node);
    pos[PHASES.indexOf(ph)] += dt;
    if (ph === 'distance' && tick - lastStrikeTick > Math.round(2 / dt)) low[round - 1] += dt;
    for (const p of pairs) {
      const pp = phaseOfNode(p.node);
      if (pp === 'clinch' && p.clinchBy >= 0 && p.clinchBy < n) cls[p.clinchBy] += dt;
    }
    for (let f = 0; f < n; f++) {
      const p = pairOf.get(f);
      const fph = phaseOfNode(p ? p.node : null);
      if (fph === 'clinch') inCl[f] += dt;
      else if (fph === 'ground') inGr[f] += dt;
      if (p || tick - lastContactTick[f] <= Math.round(1 / dt)) con[f] += dt;
    }
  }

  // ---- result ------------------------------------------------------------
  const result = run.result;
  const multi = config.mode !== '1v1';
  const w: number | 'draw' | 'none' = multi
    ? (result.winningTeam ?? (typeof result.winner === 'number' ? config.teams.teamOf[result.winner] ?? result.winner : result.winner))
    : result.winner;
  const fs = live.reduce((s, x) => s + x, 0);

  // Finishing strike: the winner's last landed strike before the end.
  const method = result.method;
  const isStrikeFinish = method === 'ko' || method.startsWith('tko');
  let l30: [number, number] | undefined;
  let lag: [number, number] | undefined;
  if (typeof result.winner === 'number' && !multi) {
    const winner = result.winner;
    if (isStrikeFinish) {
      for (let k = strikes.length - 1; k >= 0; k--) {
        const s = strikes[k];
        if (s.actor === winner && s.landed) {
          fin = {
            k: 'strike', id: s.tech, cls: weaponClass(s.tech), tgt: targetBucket(s.region) ?? 'other', pos: s.ph,
          };
          break;
        }
      }
      const endTick = run.ticks;
      const from = endTick - Math.round(30 / dt);
      let att = 0;
      let head = 0;
      for (const s of strikes) {
        if (s.actor !== winner || s.tick <= from) continue;
        att++;
        if (s.region === 'head') head++;
      }
      l30 = [att, head];
      if (lagS !== undefined) {
        const lagFrom = endTick - Math.round(lagS / dt);
        let extra = 0;
        for (const s of strikes) if (s.actor === winner && s.landed && s.tick > lagFrom) extra++;
        lag = [round3(lagS), extra];
      }
    }
  }

  // ---- adaptation windows (§7.2 S5), per defender ------------------------
  const ad = Array.from({ length: n }, () => [0, 0, 0, 0] as [number, number, number, number]);
  {
    const byKey = new Map<string, StrikeRec[]>();
    for (const s of strikes) {
      if (s.target < 0 || s.target >= n) continue;
      const key = `${s.actor}|${s.target}|${s.tech}`;
      const list = byKey.get(key);
      if (list) list.push(s);
      else byKey.set(key, [s]);
    }
    const w30 = Math.round(30 / dt);
    const w60 = Math.round(60 / dt);
    for (const list of byKey.values()) {
      const d = list[0].target;
      let lastLand = -1e9;
      let windowEnd = -1;
      let preL = 0;
      let preA = 0;
      for (let k = 0; k < list.length; k++) {
        const s = list[k];
        if (s.tick <= windowEnd) continue;
        // Trigger: a second landing inside 30 s, outside any open window.
        if (s.landed && s.tick - lastLand <= w30) {
          ad[d][0] += preL;
          ad[d][1] += preA;
          windowEnd = s.tick + w60;
          for (let j = k + 1; j < list.length && list[j].tick <= windowEnd; j++) {
            ad[d][3]++;
            if (list[j].landed) ad[d][2]++;
          }
          preL = 0;
          preA = 0;
          lastLand = -1e9;
          continue;
        }
        preA++;
        if (s.landed) {
          preL++;
          lastLand = s.tick;
        }
      }
    }
  }

  // ---- per fighter -------------------------------------------------------
  const st = run.stats;
  const rounds = Math.max(1, ...st.perRound.map((r) => r.round), live.length);
  type FStat = (typeof st.total.fighters)[number];
  const perRound = (f: number, pick: (x: FStat) => number): number[] => {
    const out = new Array<number>(rounds).fill(0);
    for (const rs of st.perRound) {
      if (rs.round < 1) continue;
      const x = rs.fighters[f];
      if (x) out[rs.round - 1] += pick(x);
    }
    return out;
  };

  const fighters: FighterRow[] = config.fighters.map((def, f) => {
    const t = st.total.fighters[f];
    return {
      sig: [t.sig.landed, t.sig.attempted],
      tot: [t.total.landed, t.total.attempted],
      pt: pt[f],
      jab: jab[f],
      hd: hd[f],
      kd: t.knockdowns,
      td: [t.takedowns.landed, t.takedowns.attempted],
      sub: t.subAttempts,
      rev: t.reversals,
      ctrl: round1(t.controlSeconds),
      abs: t.sigAbsorbed,
      habs: t.headSigAbsorbed,
      rsa: perRound(f, (x) => x.sig.attempted),
      rsl: perRound(f, (x) => x.sig.landed),
      rhl: perRound(f, (x) => x.sigByTarget.head.landed),
      rta: perRound(f, (x) => x.takedowns.attempted),
      rsu: perRound(f, (x) => x.subAttempts),
      rst: perRound(f, (x) => x.total.attempted),
      cle: cle[f],
      cls: round1(cls[f]),
      fe: fe[f],
      rk: rk[f],
      inCl: round1(inCl[f]),
      inGr: round1(inGr[f]),
      con: round1(con[f]),
      ad: ad[f],
      m: metaOf(def, config.teams.teamOf[f] ?? f, config.paramOverrides),
    };
  });

  const row: ResultRow = {
    cell,
    i,
    seed: config.seed,
    digest: run.digest,
    ticks: run.ticks,
    draws: run.rngDraws,
    ev: SIM_ENGINE_VERSION,
    ph: hashParams(config.paramOverrides),
    tags,
    ...(bt && Object.keys(bt).length > 0 ? { bt } : {}),
    res: {
      w,
      team: result.winningTeam,
      m: method,
      r: result.round,
      t: round1(result.timeSeconds),
      fs: round1(fs),
      ts: round1(result.totalSeconds),
      det: result.detail,
    },
    rl: roundLengthS(config),
    pos: [round1(pos[0]), round1(pos[1]), round1(pos[2])],
    live: live.map(round1),
    low: low.map(round1),
    f: fighters,
    kd,
    ...(fin ? { fin } : {}),
    ...(lag ? { lag } : {}),
    ...(l30 ? { l30 } : {}),
    ...(st.cards.length > 0 ? { cards: st.cards } : {}),
    slam,
    ...(qa ? { qa } : {}),
  };
  return row;
}

// ---------------------------------------------------------------------------
// QA bouts (§7.4): the same bout, stepped by hand so the world can be checked
// ---------------------------------------------------------------------------

/**
 * Run a bout with the §1.6 invariant sweep and NaN checks on every tick. The
 * checks only read the world, so the digest equals a plain `simulate()`'s.
 */
export function runQaBout(config: SimConfig, valid: boolean[]): { run: BoutRun; qa: QaRow } {
  const sim = createSim(config);
  const viol: Record<string, number> = {};
  let nan = 0;
  const cap = sim.world.params.get('core.maxTicks');
  const check = (): void => {
    for (const v of checkWorldInvariants(sim.world)) viol[v.invariant] = (viol[v.invariant] ?? 0) + 1;
    for (const f of sim.world.fighters) {
      if (!Number.isFinite(f.x) || !Number.isFinite(f.z) || !Number.isFinite(f.vx) || !Number.isFinite(f.vz)) {
        nan++;
        break;
      }
    }
  };
  check();
  while (sim.step()) check();
  const result = sim.result;
  if (!result) throw new Error('A bout must always end with a BoutResult');
  const events = [...sim.events];
  const run: BoutRun = {
    config,
    result,
    events,
    stats: computeStats(events, config, sim.tick),
    digest: sim.digest,
    ticks: sim.tick,
    rngDraws: sim.rngDraws,
  };

  // Stat block sanity: any non-finite number is a NaN hit.
  if (!Number.isFinite(run.stats.total.seconds)) nan++;
  for (const f of run.stats.total.fighters) {
    if (!Number.isFinite(f.controlSeconds) || !Number.isFinite(f.sig.landed)) nan++;
  }

  // Most distinct attackers on one fighter inside a 1 s window.
  const win = Math.round(1000 / sim.world.params.get('core.dtMs'));
  let maxAtk = 0;
  const recent = new Map<number, Map<number, number>>();
  let fouls = 0;
  let deductions = 0;
  let eights = 0;
  let counts = 0;
  const kdPerRound = new Map<string, number>();
  let maxKdRound = 0;
  for (const e of events) {
    if (e.kind === 'strike' && e.target >= 0) {
      let m = recent.get(e.target);
      if (!m) recent.set(e.target, (m = new Map()));
      m.set(e.actor, e.tick);
      let c = 0;
      for (const t of m.values()) if (e.tick - t <= win) c++;
      if (c > maxAtk) maxAtk = c;
    } else if (e.kind === 'foul') fouls++;
    else if (e.kind === 'deduction') deductions++;
    else if (e.kind === 'standingEight') eights++;
    else if (e.kind === 'refereeCount') counts++;
    else if (e.kind === 'knockdown') {
      const k = `${e.round}|${e.actor}`;
      const v = (kdPerRound.get(k) ?? 0) + 1;
      kdPerRound.set(k, v);
      if (v > maxKdRound) maxKdRound = v;
    }
  }
  return {
    run,
    qa: { valid, viol, nan, maxAtk, fouls, deductions, eights, counts, maxKdRound, capped: sim.tick >= cap },
  };
}
