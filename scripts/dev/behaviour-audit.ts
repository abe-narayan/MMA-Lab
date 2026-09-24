/**
 * BEHAVIOUR AUDIT — is the fighting coherent, varied and style-specific?
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/behaviour-audit.ts \
 *       [--plan style_matrix] [--n 4] [--seed audit-1] [--cell regex] [--json out.json]
 *
 * Steps every bout of the chosen plan cells by hand (the batch plans are pure
 * functions of (seed, cell, i)) and watches both fighters tick by tick. It
 * reads only what a spectator could: the decision each fighter committed on a
 * tick (`intentTag` when `lastActionTick === tick`), positions and velocities,
 * the event log and the judges' round cards; plus the AI's own score belief,
 * which is the one internal it reports so that "does he know he is behind?"
 * can be separated from "does he act on it?".
 *
 * Metrics (per fighter-bout, then pooled and per style label):
 *
 *  Repetition
 *   - sameAsLast: share of strikes identical to the previous strike, against
 *     the chance rate sum(p_i^2) of that fighter's own technique mix (a
 *     ratio > 1 means sequences repeat more than the mix alone explains);
 *   - trigramRepeat: share of strike trigrams equal to the trigram just
 *     before it, against the same statistic on a seeded shuffle of the same
 *     sequence;
 *   - longest run of one technique; longest run of consecutive feints;
 *   - the most frequent 3-strike sequence's share of all trigrams.
 *  Movement
 *   - in/out reversals per standing minute (the radial velocity flips from
 *     in to out or back: the committed step's sense on engine 6.0, the radial
 *     velocity (|v| > 0.5 m/s) on older engines that had no steps);
 *   - stop-go: the share of movement runs (consecutive ticks with a nonzero
 *     velocity command) lasting a single 0.1 s tick;
 *   - ping-pong: A-B-A-B decision patterns among movement tags per minute.
 *  Style
 *   - pace (sig attempts / min), mean standing distance, share of strikes
 *     flagged as counters, share of exchanges this fighter initiated, clinch
 *     entries and clinch share of fight time, TD attempts / 15, ground share.
 *  Score state (bouts that reach the last round with a card leader after the
 *   second-to-last round, true cards = majority of judges)
 *   - own last-round sig attempts vs own previous round, behind / ahead / even;
 *   - last-minute pace of the last round vs its first four minutes;
 *   - TD attempts in the last round, behind vs ahead; AI belief sign agreement.
 *  Fatigue
 *   - sig attempts and sig accuracy by round; mean fatigue index at each bell.
 *  Adaptation
 *   - across (fighter, strike family) with >= 6 attempts in R1: correlation of
 *     the family's R1 landing rate with the change in its share of attempts
 *     from R1 to R2 (positive = more of what works).
 */
import { writeFileSync } from 'node:fs';
import {
  computeStats, createSim, hasTechnique, isSignificantStrike, technique,
  type SimConfig, type SimEvent, type StrikeEvent,
} from '../../src/sim';
import { PLANS, buildJob } from '../batch/plans';

const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const planId = arg('plan', 'style_matrix');
const nPer = Number(arg('n', '4'));
const seed = arg('seed', 'audit-1');
const cellRe = new RegExp(arg('cell', '.'));
const jsonOut = arg('json', '');

interface FB {
  style: string;
  strikes: string[];
  families: string[];
  counters: number;
  strikeCount: number;
  feintRunMax: number;
  moveRuns: number[];
  inOutFlips: number;
  standingS: number;
  pingPong: number;
  distSum: number;
  distN: number;
  leads: number;
  exchanges: number;
  rsa: number[];
  rsl: number[];
  rta: number[];
  lastMinSa: number;
  preLastMinSa: number;
  fatigueAtBell: number[];
  famR: Record<string, { a1: number; l1: number; a2: number }>;
  belief: number[];
  sig: number;
  secs: number;
  td: number;
  clinchEntries: number;
  clinchS: number;
  groundS: number;
  won: boolean;
}

function newFB(style: string): FB {
  return {
    style, strikes: [], families: [], counters: 0, strikeCount: 0, feintRunMax: 0, moveRuns: [],
    inOutFlips: 0, standingS: 0, pingPong: 0, distSum: 0, distN: 0, leads: 0, exchanges: 0,
    rsa: [], rsl: [], rta: [], lastMinSa: 0, preLastMinSa: 0, fatigueAtBell: [], famR: {},
    belief: [], sig: 0, secs: 0, td: 0, clinchEntries: 0, clinchS: 0, groundS: 0, won: false,
  };
}

function familyOfTech(id: string): string {
  if (!hasTechnique(id)) return 'other';
  const s = technique(id);
  return `${s.family}:${s.targets[0]}`;
}

interface BoutOut { fb: [FB, FB]; lastRound: number; cardUp: number[] | null; rounds: number }

function runBout(config: SimConfig, styles: [string, string]): BoutOut {
  const sim = createSim(config);
  const w = sim.world;
  const fb: [FB, FB] = [newFB(styles[0]), newFB(styles[1])];
  const curMove: string[] = ['', ''];
  const curRun = [0, 0];
  const lastRadial = [0, 0];
  const moveHist: string[][] = [[], []];
  let lastStrikeTick = -1_000;
  const rounds = w.ruleset.rounds.count;
  const roundLenTicks = (w.ruleset.rounds.lengthS * 1000) / w.params.get('core.dtMs');
  while (sim.step()) {
    if (w.phase !== 'round' || w.fighters.length !== 2) continue;
    const [A, B] = w.fighters;
    const bothStanding = A.posture === 'standing' && B.posture === 'standing';
    const d = Math.hypot(A.x - B.x, A.z - B.z);
    for (const [k, f, o] of [[0, A, B], [1, B, A]] as const) {
      const b = fb[k];
      if (bothStanding) {
        b.standingS += 0.1;
        b.distSum += d; b.distN++;
        // The sense of the committed step (in / out / around). Measured on
        // the velocity it produced a lateral step read as in or out whenever
        // the other man moved; the step's own sense is what "in/out" means.
        const st = (f as { step?: { radial: number; untilMs: number } }).step;
        let sgn = 0;
        if (st && w.nowMs < st.untilMs) sgn = st.radial > 0.5 ? 1 : st.radial < -0.5 ? -1 : 0;
        else {
          const ux = (o.x - f.x) / (d || 1);
          const uz = (o.z - f.z) / (d || 1);
          const vr = f.vx * ux + f.vz * uz;
          if (!st) sgn = vr > 0.5 ? 1 : vr < -0.5 ? -1 : 0;
        }
        if (sgn !== 0) {
          if (lastRadial[k] !== 0 && sgn !== lastRadial[k]) b.inOutFlips++;
          lastRadial[k] = sgn;
        }
      }
      if (f.lastActionTick === w.tick) {
        const tag = f.intentTag;
        const moving = tag.startsWith('move.') || tag === 'circle.away';
        if (moving && bothStanding) {
          if (curMove[k] === tag) curRun[k]++;
          else {
            if (curRun[k] > 0) b.moveRuns.push(curRun[k]);
            curMove[k] = tag; curRun[k] = 1;
          }
          const h = moveHist[k];
          h.push(tag);
          if (h.length > 4) h.shift();
          if (h.length === 4 && h[0] === h[2] && h[1] === h[3] && h[0] !== h[1]) b.pingPong++;
        } else if (curRun[k] > 0) {
          b.moveRuns.push(curRun[k]); curRun[k] = 0; curMove[k] = '';
          if (!moving) moveHist[k].length = 0;
        }
      }
      if (w.roundTick === roundLenTicks - 1) {
        b.fatigueAtBell[w.round - 1] = f.damage.f;
      }
    }
    void lastStrikeTick;
  }
  // Events.
  const ev = sim.events as readonly SimEvent[];
  let feintRun = [0, 0];
  let lastStrikeAny = -1_000;
  const stats = computeStats(ev, config, sim.tick);
  const lastRound = sim.round;
  for (const e of ev) {
    if (e.kind === 'feint' && e.actor >= 0 && e.actor < 2) {
      feintRun[e.actor]++;
      fb[e.actor].feintRunMax = Math.max(fb[e.actor].feintRunMax, feintRun[e.actor]);
    }
    if (e.kind === 'strike' && e.actor >= 0 && e.actor < 2) {
      const s = e as StrikeEvent;
      feintRun[e.actor] = 0;
      const b = fb[e.actor];
      if (s.detail.short) continue;
      b.strikes.push(s.detail.technique);
      const fam = familyOfTech(s.detail.technique);
      b.families.push(fam);
      b.strikeCount++;
      if (s.detail.counter) b.counters++;
      if (e.tick - lastStrikeAny > 15) {
        b.leads++;
        b.exchanges++;
        fb[1 - e.actor].exchanges++;
      }
      lastStrikeAny = e.tick;
      const r = e.round;
      const rec = (b.famR[fam] ??= { a1: 0, l1: 0, a2: 0 });
      const landed = s.detail.result === 'landed' || s.detail.result === 'checked';
      if (r === 1) { rec.a1++; if (landed) rec.l1++; }
      if (r === 2) rec.a2++;
      // Last-round pace split (only for distance sig strikes in the last scheduled round).
      if (r === rounds) {
        const roundStartTick = ev.find((x) => x.kind === 'roundStart' && x.round === r)?.tick ?? 0;
        const into = (e.tick - roundStartTick) / 10;
        if (isSignificantStrike(s.detail.technique, 'distance')) {
          if (into >= w.ruleset.rounds.lengthS - 60) b.lastMinSa++;
          else b.preLastMinSa++;
        }
      }
    }
    if (e.kind === 'clinch' && e.actor >= 0 && e.actor < 2) fb[e.actor].clinchEntries++;
    if (e.kind === 'scoreUpdate' && e.actor >= 0 && e.actor < 2) {
      fb[e.actor].belief.push(Number((e as { detail: { belief?: number } }).detail.belief ?? 0));
    }
  }
  const secs = stats.total.seconds;
  for (const k of [0, 1] as const) {
    const b = fb[k];
    const fs = stats.fighters[k];
    b.sig = fs.sig.attempted;
    b.secs = secs;
    b.td = fs.takedowns.attempted;
    b.clinchS = stats.total.positionSeconds.clinch;
    b.groundS = stats.total.positionSeconds.ground;
    for (const rs of stats.perRound) {
      b.rsa[rs.round - 1] = rs.fighters[k].sig.attempted;
      b.rsl[rs.round - 1] = rs.fighters[k].sig.landed;
      b.rta[rs.round - 1] = rs.fighters[k].takedowns.attempted;
    }
    if (curRun[k] > 0) b.moveRuns.push(curRun[k]);
    b.won = sim.result?.winner === k;
  }
  // True cards through the second-to-last round.
  let cardUp: number[] | null = null;
  if (lastRound >= rounds && rounds >= 2) {
    const judgeRounds: number[][][] = [];
    for (const e of ev) {
      if (e.kind === 'scorecardRound') {
        const c = (e as { detail: { cards?: number[][] } }).detail.cards;
        if (c) judgeRounds.push(c);
      }
    }
    const upto = judgeRounds.slice(0, rounds - 1);
    if (upto.length === rounds - 1) {
      const nJ = upto[0].length;
      let votesA = 0; let votesB = 0;
      for (let j = 0; j < nJ; j++) {
        let a = 0; let bb = 0;
        for (const rc of upto) { a += rc[j][0]; bb += rc[j][1]; }
        if (a > bb) votesA++; else if (bb > a) votesB++;
      }
      const s = votesA > votesB ? 1 : votesB > votesA ? -1 : 0;
      cardUp = [s, -s];
    }
  }
  return { fb, lastRound, cardUp, rounds };
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function mulberry(seedN: number): () => number {
  let a = seedN >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function repetition(seq: string[], rnd: () => number): { same: number; chance: number; tri: number; triShuf: number; runMax: number; topTri: number } {
  const n = seq.length;
  if (n < 8) return { same: NaN, chance: NaN, tri: NaN, triShuf: NaN, runMax: 0, topTri: NaN };
  let same = 0;
  let run = 1; let runMax = 1;
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    counts.set(seq[i], (counts.get(seq[i]) ?? 0) + 1);
    if (i > 0 && seq[i] === seq[i - 1]) { same++; run++; runMax = Math.max(runMax, run); } else run = 1;
  }
  let chance = 0;
  for (const c of counts.values()) chance += (c / n) * (c / n);
  const triRep = (s: string[]): number => {
    let hit = 0; let tot = 0;
    for (let i = 3; i + 2 < s.length; i++) {
      tot++;
      if (s[i] === s[i - 3] && s[i + 1] === s[i - 2] && s[i + 2] === s[i - 1]) hit++;
    }
    return tot ? hit / tot : NaN;
  };
  const sh = seq.slice();
  for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
  const tri = new Map<string, number>();
  for (let i = 0; i + 2 < n; i++) {
    const k = `${seq[i]}|${seq[i + 1]}|${seq[i + 2]}`;
    tri.set(k, (tri.get(k) ?? 0) + 1);
  }
  let top = 0;
  for (const c of tri.values()) top = Math.max(top, c);
  return { same: same / (n - 1), chance, tri: triRep(seq), triShuf: triRep(sh), runMax, topTri: top / Math.max(1, n - 2) };
}

const mean = (xs: number[]): number => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};
const f2 = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : '—');
function corr(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = mean(xs); const my = mean(ys);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const plan = PLANS[planId];
const cells = plan.cells(nPer).filter((c) => cellRe.test(c.id));
const all: FB[] = [];
const bouts: BoutOut[] = [];
const t0 = Date.now();
for (const cell of cells) {
  for (let i = 0; i < nPer; i++) {
    const job = buildJob(cell, i, seed);
    const styles: [string, string] = [
      String(cell.tags.styleA ?? cell.tags.group ?? 'x'), String(cell.tags.styleB ?? cell.tags.group ?? 'x'),
    ];
    const out = runBout(job.config, styles);
    bouts.push(out);
    all.push(...out.fb);
  }
}
const rnd = mulberry(12345);

console.log(`behaviour audit: plan ${planId}, ${cells.length} cells x ${nPer}, ${bouts.length} bouts, ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// Repetition.
const reps = all.map((b) => repetition(b.strikes, rnd));
const famReps = all.map((b) => repetition(b.families, rnd));
const report: Record<string, unknown> = {};
const rep = {
  sameAsLast: mean(reps.map((r) => r.same)),
  sameChance: mean(reps.map((r) => r.chance)),
  trigramRepeat: mean(reps.map((r) => r.tri)),
  trigramRepeatShuffled: mean(reps.map((r) => r.triShuf)),
  longestRun: mean(reps.map((r) => r.runMax)),
  topTrigramShare: mean(reps.map((r) => r.topTri)),
  famSameAsLast: mean(famReps.map((r) => r.same)),
  famSameChance: mean(famReps.map((r) => r.chance)),
  feintRunMax: mean(all.map((b) => b.feintRunMax)),
};
report.repetition = rep;
console.log('\nREPETITION (strike sequences, per fighter-bout)');
console.log(`  same technique as last   ${f2(100 * rep.sameAsLast, 1)} %  (chance from own mix ${f2(100 * rep.sameChance, 1)} %, ratio ${f2(rep.sameAsLast / rep.sameChance)})`);
console.log(`  same family as last      ${f2(100 * rep.famSameAsLast, 1)} %  (chance ${f2(100 * rep.famSameChance, 1)} %, ratio ${f2(rep.famSameAsLast / rep.famSameChance)})`);
console.log(`  trigram = previous       ${f2(100 * rep.trigramRepeat, 2)} %  (shuffled ${f2(100 * rep.trigramRepeatShuffled, 2)} %)`);
console.log(`  longest same-tech run    ${f2(rep.longestRun, 1)}   top trigram share ${f2(100 * rep.topTrigramShare, 1)} %   longest feint run ${f2(rep.feintRunMax, 1)}`);

// Movement.
const mv = {
  inOutPerMin: mean(all.map((b) => (b.standingS > 30 ? b.inOutFlips / (b.standingS / 60) : NaN))),
  stopGo: mean(all.map((b) => (b.moveRuns.length > 5 ? b.moveRuns.filter((r) => r === 1).length / b.moveRuns.length : NaN))),
  meanMoveRunS: mean(all.map((b) => (b.moveRuns.length ? mean(b.moveRuns) / 10 : NaN))),
  pingPongPerMin: mean(all.map((b) => (b.standingS > 30 ? b.pingPong / (b.standingS / 60) : NaN))),
};
report.movement = mv;
console.log('\nMOVEMENT (standing, both fighters free)');
console.log(`  in/out reversals / min   ${f2(mv.inOutPerMin, 1)}`);
console.log(`  single-tick move runs    ${f2(100 * mv.stopGo, 1)} %   mean move run ${f2(mv.meanMoveRunS, 2)} s   A-B-A-B move patterns / min ${f2(mv.pingPongPerMin, 1)}`);

// Styles.
const styles = [...new Set(all.map((b) => b.style))];
const perStyle: Record<string, Record<string, number>> = {};
console.log('\nSTYLE (pooled over opponents)');
console.log('  style      n   sigAtt/min  dist(m)  counter%  lead%   clinchEnt/15  clinch%  TDatt/15  ground%  win%');
for (const s of styles) {
  const bs = all.filter((b) => b.style === s);
  const row = {
    n: bs.length,
    pace: mean(bs.map((b) => b.sig / (b.secs / 60))),
    dist: mean(bs.map((b) => b.distSum / Math.max(1, b.distN))),
    counter: mean(bs.map((b) => (b.strikeCount ? b.counters / b.strikeCount : NaN))),
    lead: mean(bs.map((b) => (b.exchanges ? b.leads / b.exchanges : NaN))),
    clinchEnt: mean(bs.map((b) => b.clinchEntries / (b.secs / 900))),
    clinch: mean(bs.map((b) => b.clinchS / b.secs)),
    td: mean(bs.map((b) => b.td / (b.secs / 900))),
    ground: mean(bs.map((b) => b.groundS / b.secs)),
    win: mean(bs.map((b) => (b.won ? 1 : 0))),
  };
  perStyle[s] = row;
  console.log(`  ${s.padEnd(9)} ${String(row.n).padStart(3)}   ${f2(row.pace).padStart(8)}  ${f2(row.dist).padStart(7)}  ${f2(100 * row.counter, 1).padStart(7)}  ${f2(100 * row.lead, 1).padStart(6)}  ${f2(row.clinchEnt, 1).padStart(12)}  ${f2(100 * row.clinch, 1).padStart(7)}  ${f2(row.td, 2).padStart(8)}  ${f2(100 * row.ground, 1).padStart(7)}  ${f2(100 * row.win, 0).padStart(4)}`);
}
report.styles = perStyle;

// Score state.
const byState: Record<string, { r: number[]; td: number[]; lm: number[]; beliefAgree: number[] }> = {
  behind: { r: [], td: [], lm: [], beliefAgree: [] },
  ahead: { r: [], td: [], lm: [], beliefAgree: [] },
  even: { r: [], td: [], lm: [], beliefAgree: [] },
};
for (const bo of bouts) {
  if (!bo.cardUp) continue;
  const R = bo.rounds;
  for (const k of [0, 1]) {
    const b = bo.fb[k];
    const st = bo.cardUp[k] > 0 ? 'ahead' : bo.cardUp[k] < 0 ? 'behind' : 'even';
    const prev = b.rsa[R - 2] ?? 0;
    const last = b.rsa[R - 1] ?? 0;
    if (prev >= 5) byState[st].r.push(last / prev - 1);
    byState[st].td.push(b.rta[R - 1] ?? 0);
    const pre = b.preLastMinSa / Math.max(1, (w0(R) - 60) / 60);
    if (b.preLastMinSa >= 5) byState[st].lm.push(b.lastMinSa / pre - 1);
    const bel = b.belief[R - 2];
    if (bel !== undefined && st !== 'even') byState[st].beliefAgree.push(Math.sign(bel) === (st === 'ahead' ? 1 : -1) ? 1 : 0);
  }
}
function w0(_r: number): number { return 300; }
report.scoreState = Object.fromEntries(Object.entries(byState).map(([k, v]) => [k, {
  n: v.r.length, lastVsPrev: mean(v.r), tdLast: mean(v.td), lastMinVsRest: mean(v.lm), beliefCorrect: mean(v.beliefAgree),
}]));
console.log('\nSCORE STATE (true cards after the second-to-last round)');
for (const [k, v] of Object.entries(byState)) {
  console.log(`  ${k.padEnd(6)} n ${String(v.r.length).padStart(4)}  last-round sig att vs prev ${f2(100 * mean(v.r), 1).padStart(6)} %   last-minute pace vs rest ${f2(100 * mean(v.lm), 1).padStart(6)} %   TD att last round ${f2(mean(v.td), 2)}   belief sign right ${f2(100 * mean(v.beliefAgree), 0)} %`);
}

// Fatigue.
const maxR = Math.max(...all.map((b) => b.rsa.length));
const fat: Record<string, number[]> = { att: [], acc: [], f: [] };
for (let r = 0; r < maxR; r++) {
  const bs = all.filter((b) => b.rsa.length > r && (b.rsa[r] ?? 0) > 0 && b.rsa.length > r + 0);
  // Only rounds that ran their full length: the round was not the last one, or the bout went the distance.
  fat.att.push(mean(bs.filter((b) => b.rsa.length > r + 1 || b.secs >= (r + 1) * 300 - 1).map((b) => b.rsa[r])));
  fat.acc.push(mean(bs.map((b) => b.rsl[r] / b.rsa[r])));
  fat.f.push(mean(all.map((b) => b.fatigueAtBell[r]).filter((x) => x !== undefined)));
}
report.fatigue = fat;
console.log('\nFATIGUE (full rounds only for attempts)');
console.log(`  sig att by round  ${fat.att.map((x) => f2(x, 1)).join(' / ')}`);
console.log(`  sig acc by round  ${fat.acc.map((x) => f2(100 * x, 1)).join(' / ')} %`);
console.log(`  fatigue f at bell ${fat.f.map((x) => f2(x, 2)).join(' / ')}`);

// Adaptation.
const xs: number[] = []; const ys: number[] = [];
for (const b of all) {
  const tot1 = Object.values(b.famR).reduce((a, r) => a + r.a1, 0);
  const tot2 = Object.values(b.famR).reduce((a, r) => a + r.a2, 0);
  if (tot1 < 20 || tot2 < 20) continue;
  for (const r of Object.values(b.famR)) {
    if (r.a1 < 6) continue;
    xs.push(r.l1 / r.a1);
    ys.push(r.a2 / tot2 - r.a1 / tot1);
  }
}
report.adaptation = { pairs: xs.length, corr: corr(xs, ys) };
console.log('\nADAPTATION');
console.log(`  corr(R1 landing rate of a family, R1->R2 change in its share) = ${f2(corr(xs, ys), 3)} over ${xs.length} fighter-families`);

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
