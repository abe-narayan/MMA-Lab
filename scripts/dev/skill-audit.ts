/**
 * SKILL AUDIT — what actually decides who wins?
 *
 *   npx tsx scripts/dev/skill-audit.ts <runDir> [--plan baseline] [--group ufc] [--seed cal-2026-09]
 *
 * Rebuilds every bout's fighters from the plan (the plans are pure functions of
 * (planSeed, cell, i)), derives their runtimes, and fits a logistic regression
 * of "side A won" on the standardized A-B differences of the derived
 * composites. Reports each feature's coefficient (log-odds per population SD of
 * the difference), the univariate win rate of the fighter ahead on it, and the
 * rating-gap buckets of 09 §7.3 T6. Draws and no-decisions are dropped.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveRuntime, resolveParams, type FighterDefinition } from '../../src/sim';
import { PLANS, buildJob, type Cell } from '../batch/plans';

interface Row {
  cell: string; i: number; tags: { plan: string; group: string };
  res: { w: number | string; m: string };
  f: { m: { rating: number } }[];
}

const args = process.argv.slice(2);
const runDir = args[0];
const opt = (k: string, d: string): string => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const planId = opt('plan', 'baseline');
const group = opt('group', 'ufc');
const planSeed = opt('seed', 'cal-2026-09');
const cellFilter = new RegExp(opt('cell', '.'));

const rows: Row[] = readFileSync(join(runDir, 'results.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)
  .filter((r) => r.tags.plan === planId && (group === '*' || r.tags.group === group) && cellFilter.test(r.cell));

const plan = PLANS[planId];
const cells = new Map<string, Cell>(plan.cells(100000).map((c) => [c.id, c]));
const params = resolveParams();

type Feat = Record<string, number>;
function features(def: FighterDefinition, opp: FighterDefinition): Feat {
  const rt = deriveRuntime(def, params, { explain: false, opponentStance: opp.body.stance === 'southpaw' ? 'southpaw' : 'orthodox' });
  const d = rt.disciplines;
  return {
    rating: rt.mmaMean,
    striking: rt.strikingMean,
    grappling: rt.grapplingMean,
    integration: d.mmaIntegration.mean,
    wrestling: d.wrestling.mean,
    bjj: d.bjj.mean,
    strDef: rt.anticipation.striking.defSkill,
    tdd: rt.grappling.tdDefenceBase,
    subAtk: rt.grappling.subAttack,
    subDef: rt.grappling.subDefence,
    chin: rt.chinEff,
    cardio: rt.effective.cardio,
    power: rt.powerIndex.rearHand,
    handSpeed: rt.effective.handSpeed,
    reaction: rt.effective.reactionTime,
    reach: rt.body.reachM,
    kg: rt.body.fightNightKg,
    iq: def.mental.fightIQ,
    age: rt.body.ageYears,
    strMinusGrap: rt.strikingMean - rt.grapplingMean,
  };
}

const X: number[][] = [];
const y: number[] = [];
let names: string[] = [];
for (const r of rows) {
  if (r.res.w !== 0 && r.res.w !== 1) continue;
  const cell = cells.get(r.cell);
  if (!cell) continue;
  const job = buildJob(cell, r.i, planSeed);
  const [A, B] = job.config.fighters;
  const fa = features(A, B);
  const fb = features(B, A);
  names = Object.keys(fa);
  X.push(names.map((k) => fa[k] - fb[k]));
  y.push(r.res.w === 0 ? 1 : 0);
}
const n = X.length;
const k = names.length;
const sd = names.map((_, j) => {
  let s = 0;
  for (const x of X) s += x[j] * x[j];
  return Math.sqrt(s / n) || 1;
});
const Z = X.map((x) => x.map((v, j) => v / sd[j]));

function fit(cols: number[]): number[] {
  const w = new Array(cols.length).fill(0);
  for (let it = 0; it < 300; it++) {
    const g = new Array(cols.length).fill(0);
    for (let r = 0; r < n; r++) {
      let s = 0;
      for (let c = 0; c < cols.length; c++) s += w[c] * Z[r][cols[c]];
      const p = 1 / (1 + Math.exp(-s));
      for (let c = 0; c < cols.length; c++) g[c] += (y[r] - p) * Z[r][cols[c]];
    }
    for (let c = 0; c < cols.length; c++) w[c] += (0.5 * g[c]) / n - 0.001 * w[c];
  }
  return w;
}

console.log(`${n} decided bouts (${planId}/${group})`);
console.log('\nunivariate: win rate of the fighter ahead on the feature, and the 1-feature logistic slope per SD');
for (let j = 0; j < k; j++) {
  let ahead = 0; let tot = 0;
  for (let r = 0; r < n; r++) {
    if (X[r][j] === 0) continue;
    tot++;
    if ((X[r][j] > 0 ? 1 : 0) === y[r]) ahead++;
  }
  const [b] = fit([j]);
  console.log(`  ${names[j].padEnd(13)} sd(diff) ${sd[j].toFixed(3).padStart(8)}  ahead wins ${(100 * ahead / Math.max(1, tot)).toFixed(1).padStart(5)} %  slope ${b.toFixed(3)}`);
}
const all = names.map((_, j) => j).filter((j) => names[j] !== 'rating' && names[j] !== 'strMinusGrap' && names[j] !== 'striking' && names[j] !== 'grappling');
const w = fit(all);
console.log('\nmultivariate (standardized) coefficients:');
all.map((j, c) => [names[j], w[c]] as const).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  .forEach(([nm, v]) => console.log(`  ${nm.padEnd(13)} ${v >= 0 ? '+' : ''}${v.toFixed(3)}`));
let ll = 0; let ll0 = 0; let correct = 0;
for (let r = 0; r < n; r++) {
  let s = 0;
  for (let c = 0; c < all.length; c++) s += w[c] * Z[r][all[c]];
  const p = 1 / (1 + Math.exp(-s));
  ll += y[r] ? Math.log(p) : Math.log(1 - p);
  ll0 += Math.log(0.5);
  if ((p > 0.5 ? 1 : 0) === y[r]) correct++;
}
console.log(`  McFadden R2 ${(1 - ll / ll0).toFixed(3)}, in-sample accuracy ${(100 * correct / n).toFixed(1)} %`);

// T6 buckets on the rating gap.
const ri = names.indexOf('rating');
const buckets = [[0, 0.1], [0.1, 0.5], [0.5, 1.0], [1.0, 1.5], [1.5, 2.5], [2.5, 99]];
console.log(`\nrating (mmaMean) gap buckets, SD ${sd[ri].toFixed(2)} pts of the difference:`);
const popSd = sd[ri] / Math.SQRT2;
for (const [lo, hi] of buckets) {
  let a = 0; let t = 0;
  for (let r = 0; r < n; r++) {
    const g = Math.abs(X[r][ri]) / popSd;
    if (g < lo || g >= hi) continue;
    t++;
    if ((X[r][ri] > 0 ? 1 : 0) === y[r]) a++;
  }
  console.log(`  ${lo}-${hi} SD: better-rated wins ${(100 * a / Math.max(1, t)).toFixed(1)} % (n ${t})`);
}
