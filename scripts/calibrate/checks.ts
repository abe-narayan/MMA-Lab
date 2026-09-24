/**
 * §7.2 STRATEGY CHECKS (S1–S7), §7.3 TIER CHECKS (T1–T8) and the §7.4
 * EDGE-CASE QA LIST, with the numeric pass criteria of docs/design/09.
 *
 * Every check is a list of parts judged like master-row components
 * (`metrics.ts judgeComp`): bands use the §6.6 rule, one-sided criteria
 * ("≥ 2x", "≤ 5 %") pass when the whole 95 % CI clears the threshold. A part
 * the sim cannot measure yet is listed with its reason and not gated.
 */
import type { ResultRow } from '../batch/types';
import { Dataset, fighterUnits, fmin, isDec, isFinish, isKoTko, isSub, cardTotals } from './data';
import {
  combine, edgeWinRate, judgeComp, ratingBuckets, trailing, SWEEP_REACH_7,
  type Comp, type CompResult,
} from './metrics';
import { NONE, mean, median, proportion, ratio, type Estimate, type Verdict } from './stats';

export interface CheckResult {
  id: string;
  title: string;
  criterion: string;
  population: string;
  parts: CompResult[];
  /** Parts not measurable by this sim yet, with the reason. */
  unmeasured: string[];
  verdict: Verdict;
  note?: string;
}

const band = (label: string, est: Estimate, lo: number, hi: number, unit: Comp['unit'] = 'pct'): Comp =>
  ({ label, est, target: (lo + hi) / 2, tol: (hi - lo) / 2, unit });
const ge = (label: string, est: Estimate, thr: number, unit: Comp['unit'] = 'num'): Comp =>
  ({ label, est, target: thr, tol: 0, unit, kind: 'ge' });
const le = (label: string, est: Estimate, thr: number, unit: Comp['unit'] = 'pct'): Comp =>
  ({ label, est, target: thr, tol: 0, unit, kind: 'le' });
const info = (label: string, est: Estimate, unit: Comp['unit'] = 'pct'): Comp =>
  ({ label, est, target: 0, tol: 0, unit, info: true });
const bool = (label: string, ok: boolean | null): Comp =>
  ({ label, est: ok === null ? NONE : { value: ok ? 1 : 0, ci: 0, n: 1 }, target: 1, tol: 0, unit: 'bool' });

function check(id: string, title: string, criterion: string, population: string, comps: Comp[], unmeasured: string[] = [], note?: string): CheckResult {
  const parts = comps.map(judgeComp);
  return { id, title, criterion, population, parts, unmeasured, verdict: combine(parts.map((p) => p.verdict)), note };
}

/** Win rate of side `side` over rows (draws half). */
function sideWin(rows: readonly ResultRow[], side: number): Estimate {
  const k = rows.filter((r) => r.res.w === side).length + 0.5 * rows.filter((r) => typeof r.res.w !== 'number').length;
  return proportion(k, rows.length);
}

/** Win rate of tier `a` against tier `b` pooled over both orientations of the matrix. */
function tierWin(d: Dataset, a: number, b: number): Estimate {
  const ab = d.tiers(a, b);
  const ba = d.tiers(b, a);
  const k = ab.filter((r) => r.res.w === 0).length + ba.filter((r) => r.res.w === 1).length
    + 0.5 * [...ab, ...ba].filter((r) => typeof r.res.w !== 'number').length;
  return proportion(k, ab.length + ba.length);
}

/** Rows of the style cell for `a` vs `b`, with the side index of `a`, both orientations. */
function styleRows(d: Dataset, a: string, b: string): { r: ResultRow; side: number }[] {
  const ab = d.cell(`style_matrix/${a}x${b}`).map((r) => ({ r, side: 0 }));
  if (a === b) return ab;
  return [...ab, ...d.cell(`style_matrix/${b}x${a}`).map((r) => ({ r, side: 1 }))];
}

function styleWin(d: Dataset, a: string, b: string): Estimate {
  const rs = styleRows(d, a, b);
  const k = rs.filter(({ r, side }) => r.res.w === side).length + 0.5 * rs.filter(({ r }) => typeof r.res.w !== 'number').length;
  return proportion(k, rs.length);
}

// ---------------------------------------------------------------------------
// §7.2 strategy checks
// ---------------------------------------------------------------------------

export function strategyChecks(d: Dataset): CheckResult[] {
  const out: CheckResult[] = [];
  const reach7 = SWEEP_REACH_7.flatMap((v) => d.sweep('reach', v));

  // S1 --------------------------------------------------------------------
  {
    const standing = reach7.filter((r) => r.res.fs > 0 && r.pos[0] / r.res.fs >= 0.6);
    const ground = reach7.filter((r) => r.res.fs > 0 && r.pos[2] / r.res.fs >= 0.7);
    const us = fighterUnits(d.ufc).filter((u) => u.f.m.reach > u.opp.m.reach && typeof u.row.res.w === 'number');
    out.push(check('S1', 'Taller/longer fights longer',
      'reach ≥ 7 cm: long-range time ≥ 1.15x; win 60 ± 4 % when ≥ 60 % standing; 63 ± 4 % at ≥ 17.8 cm; 49 ± 4 % when ≥ 70 % ground; population 51.7 ± 2 %',
      'physical_sweeps reach ≥ 7.5 cm; ufc population', [
        band('win, ≥ 60 % standing', edgeWinRate(standing), 0.56, 0.64),
        band('win, reach +18 cm', edgeWinRate(d.sweep('reach', 18)), 0.59, 0.67),
        band('win, ≥ 70 % ground', edgeWinRate(ground), 0.45, 0.53),
        band('population, any reach edge', proportion(us.filter((u) => u.won).length, us.length), 0.497, 0.537),
      ], ['time at long range per fighter: the row stores no per-fighter range-band time (needs a range-band tally in computeStats or the recorder)']));
  }

  // S2 --------------------------------------------------------------------
  {
    const sum = (rs: ResultRow[], pick: (r: ResultRow, side: number) => number, shorter: boolean): number[] =>
      rs.map((r) => pick(r, shorter ? 1 - r.bt!.edge! : r.bt!.edge!));
    const rs = reach7.filter((r) => r.bt?.edge !== undefined);
    const rel = (pick: (r: ResultRow, side: number) => number): Estimate => ratio(sum(rs, pick, true), sum(rs, pick, false));
    out.push(check('S2', 'Shorter closes/clinches more',
      'reach ≥ 7 cm cells: shorter fighter\'s clinch entries and clinch time ≥ 1.2x the longer\'s; feints ≥ 1.3x',
      'physical_sweeps reach ≥ 7.5 cm', [
        ge('clinch entries shorter / longer', rel((r, s) => r.f[s].cle), 1.2),
        ge('clinch time initiated shorter / longer', rel((r, s) => r.f[s].cls), 1.2),
        ge('feints shorter / longer', rel((r, s) => r.f[s].fe), 1.3),
      ]));
  }

  // S3 --------------------------------------------------------------------
  {
    const wd = styleRows(d, 'wrestler', 'distance');
    const wres = wd.map(({ r, side }) => ({ r, w: r.f[side], won: r.res.w === side, lost: r.res.w === 1 - side }));
    const td15 = ratio(wres.map((x) => x.w.td[1]), wres.map((x) => fmin(x.r)), 15);
    const acc = (xs: typeof wres) => ratio(xs.map((x) => x.w.td[0]), xs.map((x) => x.w.td[1]));
    const strikerShare = (rows: { r: ResultRow; side: number }[], strikerSide: (x: { r: ResultRow; side: number }) => number): Estimate =>
      ratio(rows.map((x) => x.r.f[strikerSide(x)].rk), rows.map((x) => x.r.f[strikerSide(x)].tot[1]));
    const vsWrestler = strikerShare(wd, (x) => 1 - x.side);
    const vsStriker = strikerShare(styleRows(d, 'distance', 'distance'), () => 0);
    const relShare: Estimate = vsWrestler.value !== null && vsStriker.value !== null && vsStriker.value > 0
      ? { value: vsWrestler.value / vsStriker.value, ci: null, n: vsWrestler.n } : NONE;
    out.push(check('S3', 'Grapplers take down more',
      'wrestler vs distance striker: wrestler TD attempts/15 ≥ 8.0; TD accuracy 45–51 % winning, 26–29 % losing; striker\'s rear-kick share ≤ 0.4x its share vs another striker',
      'style_matrix wrestler x distance (both orders)', [
        ge('wrestler TD att/15', td15, 8.0),
        band('wrestler TD acc when winning', acc(wres.filter((x) => x.won)), 0.45, 0.51),
        band('wrestler TD acc when losing', acc(wres.filter((x) => x.lost)), 0.26, 0.29),
        { ...le('striker rear-kick share vs wrestler / vs striker', { ...relShare, ci: relShare.value === null ? null : 0 }, 0.4, 'num') },
      ], [], 'Rear-kick share = rear-leg kicks attempted / all strikes attempted.'));
  }

  // S4 --------------------------------------------------------------------
  {
    const t = trailing(d.ufc);
    out.push(check('S4', 'Behind on cards raises output',
      'behind after R2 (true cards): R3 sig attempts ≥ +15 % vs own R2; TD attempts −38 ± 15 %, sub attempts −49 ± 15 % vs the fighter ahead',
      'ufc population, bouts reaching R3 with a card leader', [
        ge('R3 vs R2 sig attempts (behind)', t.sigUp, 0.15, 'pct'),
        band('TD attempts behind vs ahead', t.td, -0.53, -0.23),
        band('sub attempts behind vs ahead', t.sub, -0.64, -0.34),
      ]));
  }

  // S4b -------------------------------------------------------------------
  {
    const behindR1 = (rows: ResultRow[]) => {
      const fin: number[] = [];
      const grap: number[] = [];
      for (const r of rows) {
        if (r.f.length !== 2) continue;
        const c = cardTotals(r, 1);
        if (!c || c[0] === c[1]) continue;
        const b = c[0] < c[1] ? 0 : 1;
        fin.push(isFinish(r.res.m) && r.res.w === b ? 1 : 0);
        grap.push((r.f[b].rta[1] ?? 0) + (r.f[b].rta[2] ?? 0) + (r.f[b].rsu[1] ?? 0) + (r.f[b].rsu[2] ?? 0));
      }
      return { fin: mean(fin), grap: mean(grap) };
    };
    const hidden = behindR1(d.cell('judging/hidden/unified_2025'));
    const open = behindR1(d.cell('judging/open/unified_2025'));
    const diff = (a: Estimate, b: Estimate): Estimate => a.value === null || b.value === null ? NONE
      : { value: a.value - b.value, ci: Math.sqrt((a.ci ?? 0) ** 2 + (b.ci ?? 0) ** 2), n: Math.min(a.n, b.n) };
    out.push(check('S4b', 'Open scoring',
      'finishes by the fighter behind after R1 rise from hidden to open by ≥ +5 pp; TD/sub attempts by the fighter behind fall',
      'judging hidden vs open (unified_2025)', [
        ge('Δ finishes by R1-trailer (open − hidden)', diff(open.fin, hidden.fin), 0.05, 'pct'),
        le('Δ R2–R3 TD+sub attempts by R1-trailer (open − hidden)', diff(open.grap, hidden.grap), 0, 'num'),
      ]));
  }

  // S5 --------------------------------------------------------------------
  {
    const fall = (tiers: number[]): Estimate => {
      let preL = 0; let preA = 0; let postL = 0; let postA = 0;
      const rows = [...d.ufc, ...d.plan('tier_matrix'), ...d.plan('identical')];
      for (const r of rows) for (const f of r.f) {
        if (!tiers.includes(f.m.tier)) continue;
        preL += f.ad[0]; preA += f.ad[1]; postL += f.ad[2]; postA += f.ad[3];
      }
      if (preA === 0 || postA === 0 || preL === 0) return NONE;
      const p0 = preL / preA;
      const p1 = postL / postA;
      const ci = 1.96 * Math.sqrt(p1 * (1 - p1) / postA) / p0;
      return { value: 1 - p1 / p0, ci, n: postA };
    };
    out.push(check('S5', 'Elites adapt',
      'after a technique lands twice within 30 s on a T4/T5 defender, its landing rate over the next 60 s falls ≥ 20 % relative; for a T1 defender ≤ 5 %',
      'ufc, tier_matrix and identical rows, by the defender\'s derived tier', [
        ge('relative fall, T4/T5 defenders', fall([4, 5]), 0.20, 'pct'),
        le('relative fall, T1 defenders', fall([1]), 0.05),
      ], [], 'Baseline rate = the same attacker\'s same technique on that defender before the trigger.'));
  }

  // S6 --------------------------------------------------------------------
  {
    const rs = d.sweep('cardio', 14).filter((r) => r.bt?.edge !== undefined);
    const r3 = rs.filter((r) => r.res.r >= 3);
    const ratioR3 = ratio(r3.map((r) => r.f[r.bt!.edge!].rsl[2] ?? 0), r3.map((r) => r.f[1 - r.bt!.edge!].rsl[2] ?? 0));
    const finBy = (rows: ResultRow[], round: number) => proportion(rows.filter((r) => isFinish(r.res.m) && r.res.r === round && r.res.w === r.bt!.edge).length, rows.length);
    const h1 = finBy(rs, 1);
    const h3 = finBy(r3, 3);
    out.push(check('S6', 'Cardio edge pays late',
      'cardio +2 tiers: R3 sig landed ratio (edge / opponent) ≥ 1.3; edge fighter\'s R3 finish rate not higher than R1',
      'physical_sweeps cardio +14 (≈ +2 generator tiers)', [
        ge('R3 sig landed edge / opp', ratioR3, 1.3),
        bool('R3 finish hazard ≤ R1 (edge fighter)', h1.value === null || h3.value === null ? null : h3.value <= h1.value),
        info('R1 finish rate by edge', h1),
        info('R3 finish rate by edge | reached', h3),
      ]));
  }

  // S7 --------------------------------------------------------------------
  {
    const labels = ['distance', 'pressure', 'counter', 'wrestler', 'clinch', 'bjj'];
    let outside = 0;
    let pairs = 0;
    let worst = 0.5;
    for (let a = 0; a < labels.length; a++) for (let b = a + 1; b < labels.length; b++) {
      const w = styleWin(d, labels[a], labels[b]);
      if (w.value === null) continue;
      pairs++;
      if (w.value < 0.3 || w.value > 0.7) outside++;
      if (Math.abs(w.value - 0.5) > Math.abs(worst - 0.5)) worst = w.value;
    }
    out.push(check('S7', 'Style-matchup sanity',
      'wrestler beats BJJ ≥ 55 %; pressure vs counter within 45–55 %; volume vs power within 45–55 %; no archetype pair outside 30–70 % at equal tier',
      'style_matrix (both orders pooled)', [
        ge('wrestler vs BJJ', styleWin(d, 'wrestler', 'bjj'), 0.55, 'pct'),
        band('pressure vs counter', styleWin(d, 'pressure', 'counter'), 0.45, 0.55),
        bool(`no pair outside 30–70 % (${outside} of ${pairs} outside; most lopsided ${(100 * worst).toFixed(0)} %)`, pairs === 0 ? null : outside === 0),
      ], ['volume vs power: the style_matrix has no volume or power archetype (the six §6.5 archetypes are distance, pressure, counter, wrestler, clinch grinder, BJJ)']));
  }
  return out;
}

// ---------------------------------------------------------------------------
// §7.3 tier checks
// ---------------------------------------------------------------------------

/** One-parameter logistic fit P(fav wins) = 1 / (1 + e^(−b·gap)), and the 5-pp calibration R². */
export function calibrationR2(points: { gap: number; win: number }[]): { b: number; r2: number | null; buckets: number } {
  if (points.length < 20) return { b: 0, r2: null, buckets: 0 };
  let b = 0.5;
  for (let it = 0; it < 50; it++) {
    let g = 0;
    let h = 0;
    for (const p of points) {
      const q = 1 / (1 + Math.exp(-b * p.gap));
      g += (p.win - q) * p.gap;
      h -= q * (1 - q) * p.gap * p.gap;
    }
    if (h === 0) break;
    const step = g / h;
    b -= step;
    if (Math.abs(step) < 1e-9) break;
  }
  const buckets = new Map<number, { n: number; pred: number; obs: number }>();
  for (const p of points) {
    const q = 1 / (1 + Math.exp(-b * p.gap));
    const k = Math.min(9, Math.floor((q - 0.5) / 0.05));
    const bk = buckets.get(k) ?? { n: 0, pred: 0, obs: 0 };
    bk.n++;
    bk.pred += q;
    bk.obs += p.win;
    buckets.set(k, bk);
  }
  const used = [...buckets.values()].filter((x) => x.n >= 20).map((x) => ({ n: x.n, pred: x.pred / x.n, obs: x.obs / x.n }));
  if (used.length < 2) return { b, r2: null, buckets: used.length };
  const tot = used.reduce((s, x) => s + x.n, 0);
  const mo = used.reduce((s, x) => s + x.n * x.obs, 0) / tot;
  const ssRes = used.reduce((s, x) => s + x.n * (x.obs - x.pred) ** 2, 0);
  const ssTot = used.reduce((s, x) => s + x.n * (x.obs - mo) ** 2, 0);
  return { b, r2: ssTot > 0 ? 1 - ssRes / ssTot : null, buckets: used.length };
}

export function tierChecks(d: Dataset): CheckResult[] {
  const out: CheckResult[] = [];

  out.push(check('T1', 'T0 vs any trained ≈ never wins',
    'T0 vs T2, T3, T4, T5 (same size): T0 win rate ≤ 5 %; T0 vs T1 ≤ 25 %', 'tier_matrix (both orders pooled)', [
      le('T0 vs T1', tierWin(d, 0, 1), 0.25),
      le('T0 vs T2', tierWin(d, 0, 2), 0.05),
      le('T0 vs T3', tierWin(d, 0, 3), 0.05),
      le('T0 vs T4', tierWin(d, 0, 4), 0.05),
      le('T0 vs T5', tierWin(d, 0, 5), 0.05),
    ]));

  {
    const rows = [...d.tiers(4, 1), ...d.tiers(1, 4)];
    out.push(check('T2', 'T4 vs T1 one-sided',
      'T4 wins ≥ 95 %; finish rate ≥ 85 %; median duration ≤ 4 min', 'tier_matrix T4 x T1 (both orders)', [
        ge('T4 win rate', tierWin(d, 4, 1), 0.95, 'pct'),
        ge('finish rate', proportion(rows.filter((r) => isFinish(r.res.m)).length, rows.length), 0.85, 'pct'),
        le('median duration', median(rows.map(fmin)), 4, 'min'),
      ]));
  }

  {
    const rows = d.tiers(4, 4);
    const r1 = rows.filter((r) => r.f.length === 2);
    const perMin = (pick: (f: ResultRow['f'][number]) => number) => ratio(r1.map((r) => pick(r.f[0]) + pick(r.f[1])), r1.map((r) => 2 * fmin(r)));
    const acc = ratio(r1.map((r) => r.f[0].sig[0] + r.f[1].sig[0]), r1.map((r) => r.f[0].sig[1] + r.f[1].sig[1]));
    const sh = (pred: (m: string) => boolean) => proportion(rows.filter((r) => pred(r.res.m)).length, rows.length);
    out.push(check('T3', 'T4 vs T4 close',
      'side bias 50 ± 3 %; outcome mix within row 88; SLpM / attempts / accuracy within rows 1–3', 'tier_matrix T4 x T4', [
        band('side A win rate', sideWin(rows, 0), 0.47, 0.53),
        band('KO/TKO', sh(isKoTko), 0.29, 0.35),
        band('SUB', sh(isSub), 0.15, 0.21),
        band('DEC', sh(isDec), 0.46, 0.52),
        band('SLpM', perMin((f) => f.sig[0]), 3.5, 4.3, 'num'),
        band('sig att/min', perMin((f) => f.sig[1]), 7.8, 9.0, 'num'),
        band('sig accuracy', acc, 0.43, 0.49),
      ]));
  }

  out.push(check('T4', 'Big weight gaps matter',
    '+2.7 kg → 54.5 ± 3 %; +6.8 kg → 58–62 %; +13.6 kg → 65–75 %; openweight T4 FLW vs T4 HW → HW ≥ 80 %', 'physical_sweeps mass / openweight', [
      band('+2.7 kg', edgeWinRate(d.sweep('mass', 2.7)), 0.515, 0.575),
      band('+6.8 kg (one class)', edgeWinRate(d.sweep('mass', 6.8)), 0.58, 0.62),
      band('+13.6 kg (two classes)', edgeWinRate(d.sweep('mass', 13.6)), 0.65, 0.75),
      ge('HW vs FLW', edgeWinRate(d.sweep('openweight', 'FLWvHW')), 0.80, 'pct'),
    ]));

  {
    const rows = d.plan('identical');
    const methodGap = (pred: (m: string) => boolean): Estimate => {
      const a = proportion(rows.filter((r) => r.res.w === 0 && pred(r.res.m)).length, rows.length);
      const b = proportion(rows.filter((r) => r.res.w === 1 && pred(r.res.m)).length, rows.length);
      if (a.value === null || b.value === null) return NONE;
      return { value: Math.abs(a.value - b.value), ci: Math.sqrt((a.ci ?? 0) ** 2 + (b.ci ?? 0) ** 2), n: rows.length };
    };
    out.push(check('T5', 'Identical fighters ≈ 50/50',
      'A wins 50 ± 2 pp (n = 4,000 → Wilson half-width 1.55 pp); no method asymmetry > 2 pp', 'identical', [
        band('A win rate', sideWin(rows, 0), 0.48, 0.52),
        le('KO/TKO asymmetry', methodGap(isKoTko), 0.02),
        le('SUB asymmetry', methodGap(isSub), 0.02),
        le('DEC asymmetry', methodGap(isDec), 0.02),
      ]));
  }

  {
    const b = ratingBuckets(d.ufc);
    const cal = calibrationR2(b.points);
    // Method predictability: favourite + the population's modal method class.
    const classes = ['ko', 'sub', 'dec'] as const;
    const cls = (m: string): string => (isKoTko(m) ? 'ko' : isSub(m) ? 'sub' : isDec(m) ? 'dec' : 'other');
    const counts = new Map<string, number>();
    for (const r of d.ufc) counts.set(cls(r.res.m), (counts.get(cls(r.res.m)) ?? 0) + 1);
    const modal = classes.reduce((best, c) => ((counts.get(c) ?? 0) > (counts.get(best) ?? 0) ? c : best), 'dec' as string);
    const rs = d.ufc.filter((r) => r.f.length === 2 && Number.isFinite(r.f[0].m.rating));
    const hits = rs.filter((r) => {
      const fav = r.f[0].m.rating >= r.f[1].m.rating ? 0 : 1;
      return r.res.w === fav && cls(r.res.m) === modal;
    }).length;
    out.push(check('T6', 'Predictability of evenly-rated ≈ 60–65 %',
      'better-rated wins 60–65 % at gap 0.5–1.0 SD, 88–93 % at ≥ 2.5 SD; calibration R² ≥ 0.95 over 5-pp buckets; method of victory predictable ≤ 45 %',
      'ufc population; rating = derived mmaMean', [
        band('gap 0.5–1.0 SD', b.typical, 0.60, 0.65),
        band('gap ≥ 2.5 SD', b.heavy, 0.88, 0.93),
        ge('calibration R² (5-pp buckets, ≥ 20 bouts each)', cal.r2 === null ? NONE : { value: cal.r2, ci: 0, n: cal.buckets }, 0.95),
        le(`winner + method predicted (modal method "${modal}")`, proportion(hits, rs.length), 0.45),
      ], [], `Rating SD in this population: ${b.sdRating.toFixed(2)} mmaMean points; logistic slope ${cal.b.toFixed(2)} per SD over ${cal.buckets} bucket(s).`));
  }

  {
    const t2 = d.tiers(2, 2);
    const t3 = [...d.all.filter((r) => r.tags.group === 'regional'), ...d.tiers(3, 3)];
    const sh = (rs: ResultRow[], pred: (m: string) => boolean) => proportion(rs.filter((r) => pred(r.res.m)).length, rs.length);
    const perMin = (rs: ResultRow[], pick: (f: ResultRow['f'][number]) => number, scale = 1) => {
      const r1 = rs.filter((r) => r.f.length === 2);
      return ratio(r1.map((r) => pick(r.f[0]) + pick(r.f[1])), r1.map((r) => 2 * fmin(r)), scale);
    };
    out.push(check('T7', 'Tier populations reproduce tier priors',
      'T2xT2 finish ≈ 60 % (DEC 40, TKO 28, SUB 23, KO 8 ± 5 pp); T3xT3 ≈ 69 % (DEC 31, TKO 30, SUB 26, KO 12); T2 sig att 6–7/min, T3 7.5–8; T2 sub att/15 0.7–1.0, T3 0.6–0.8',
      'tier_matrix T2xT2; baseline regional + tier_matrix T3xT3', [
        band('T2 finish', sh(t2, isFinish), 0.55, 0.65),
        band('T2 DEC', sh(t2, isDec), 0.35, 0.45),
        band('T2 TKO', sh(t2, (m) => m.startsWith('tko')), 0.23, 0.33),
        band('T2 SUB', sh(t2, isSub), 0.18, 0.28),
        band('T2 KO', sh(t2, (m) => m === 'ko'), 0.03, 0.13),
        band('T3 finish', sh(t3, isFinish), 0.64, 0.74),
        band('T3 DEC', sh(t3, isDec), 0.26, 0.36),
        band('T3 TKO', sh(t3, (m) => m.startsWith('tko')), 0.25, 0.35),
        band('T3 SUB', sh(t3, isSub), 0.21, 0.31),
        band('T3 KO', sh(t3, (m) => m === 'ko'), 0.07, 0.17),
        band('T2 sig att/min', perMin(t2, (f) => f.sig[1]), 6, 7, 'num'),
        band('T3 sig att/min', perMin(t3, (f) => f.sig[1]), 7.5, 8, 'num'),
        band('T2 sub att/15', perMin(t2, (f) => f.sub, 15), 0.7, 1.0, 'num'),
        band('T3 sub att/15', perMin(t3, (f) => f.sub, 15), 0.6, 0.8, 'num'),
      ]));
  }

  {
    const vars = ['reach', 'mass', 'cardio', 'chin', 'speed', 'strength', 'skill'];
    const control = edgeWinRate(d.sweep('control', 0));
    const parts: Comp[] = [];
    const lines: string[] = [];
    for (const v of vars) {
      const vals = [...new Set(d.all.filter((r) => r.tags.sweepVar === v).map((r) => Number(r.tags.sweepVal)))]
        .filter((x) => Number.isFinite(x) && (v !== 'mass' || x <= 6.8))
        .sort((a, b) => a - b);
      if (vals.length === 0) continue;
      const pts = [...vals.map((x) => ({ x, e: edgeWinRate(d.sweep(v, x)) })), { x: 0, e: control }].sort((a, b) => a.x - b.x);
      let worstDrop = 0;
      let sureViolation = false;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1].e;
        const b = pts[k].e;
        if (a.value === null || b.value === null) continue;
        const drop = a.value - b.value;
        if (drop > worstDrop) worstDrop = drop;
        if (drop > 0.02 && drop - Math.sqrt((a.ci ?? 0) ** 2 + (b.ci ?? 0) ** 2) > 0.02) sureViolation = true;
      }
      lines.push(`${v}: ${pts.map((p) => `${p.x}→${p.e.value === null ? '—' : (100 * p.e.value).toFixed(0)}`).join(', ')}`);
      const est: Estimate = { value: worstDrop, ci: null, n: pts.length };
      const forced: Verdict = worstDrop <= 0.02 ? 'PASS' : sureViolation ? 'FAIL' : 'WIDE';
      parts.push({ ...le(`${v}: largest adjacent drop`, est, 0.02), forced });
    }
    out.push(check('T8', 'Monotone in every attribute',
      'win rate non-decreasing in reach, mass (same class), cardio, chin, speed, strength and sub-skill mean; adjacent drops > 2 pp fail',
      'physical_sweeps (edge win % by point)', parts, [],
      `Edge win % by point — ${lines.join('; ')}. A drop larger than 2 pp that is not also larger than its CI is reported WIDE.`));
  }
  return out;
}

// ---------------------------------------------------------------------------
// §7.4 edge-case QA
// ---------------------------------------------------------------------------

export interface QaResult {
  id: string;
  expectation: string;
  observed: string;
  verdict: Verdict | 'N/A';
  n: number;
}

function violationIds(rows: readonly ResultRow[]): string {
  const m = new Map<string, number>();
  for (const r of rows) for (const [k, v] of Object.entries(r.qa?.viol ?? {})) m.set(k, (m.get(k) ?? 0) + v);
  return [...m.entries()].map(([k, v]) => `${k}: ${v} tick(s)`).join(', ') || 'none';
}

function violations(rows: readonly ResultRow[]): number {
  return rows.reduce((s, r) => s + Object.values(r.qa?.viol ?? {}).reduce((a, b) => a + b, 0), 0);
}

function methodMix(rows: readonly ResultRow[]): string {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.res.m, (m.get(r.res.m) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
}

function combineQa(...vs: Verdict[]): Verdict {
  if (vs.includes('FAIL')) return 'FAIL';
  if (vs.includes('WIDE')) return 'WIDE';
  if (vs.includes('NO DATA')) return 'NO DATA';
  return 'PASS';
}

const pctS = (x: number | null): string => (x === null ? '—' : `${(100 * x).toFixed(0)} %`);

function qa(id: string, expectation: string, rows: readonly ResultRow[], observed: string, ok: boolean | Verdict | null, na = false): QaResult {
  const v: Verdict | 'N/A' = na ? 'N/A' : rows.length === 0 ? 'NO DATA' : ok === null ? 'INFO'
    : typeof ok === 'string' ? ok : ok ? 'PASS' : 'FAIL';
  return { id, expectation, observed, n: rows.length, verdict: v };
}

/**
 * A proportion against a band: PASS inside it, WIDE when the point is outside
 * but the 95 % CI still reaches it (small QA cells), FAIL otherwise.
 */
function inBand(e: Estimate, lo: number, hi: number): Verdict {
  if (e.value === null) return 'NO DATA';
  if (e.value >= lo && e.value <= hi) return 'PASS';
  const ci = e.ci ?? Infinity;
  return e.value + ci >= lo && e.value - ci <= hi ? 'WIDE' : 'FAIL';
}

/** Combine a statistical verdict with hard (must-hold) conditions. */
function withHard(v: Verdict, hard: boolean): Verdict {
  return hard ? v : 'FAIL';
}

export function edgeCaseChecks(d: Dataset): QaResult[] {
  const out: QaResult[] = [];
  const nan = (rows: readonly ResultRow[]) => rows.reduce((s, r) => s + (r.qa?.nan ?? 0), 0);
  const capped = (rows: readonly ResultRow[]) => rows.filter((r) => r.qa?.capped).length;

  {
    const rows = d.cell('multi/1v5');
    const maxAtk = Math.max(0, ...rows.map((r) => r.qa?.maxAtk ?? 0));
    const t4 = proportion(rows.filter((r) => r.res.w === 0).length, rows.length);
    out.push(qa('1v5 (T4 vs 5xT2, teams)', 'terminates; invariants I1–I8 hold; ≤ 2 attackers engaged at once; T4 win rate reported',
      rows, `capped ${capped(rows)}; invariant violations ${violations(rows)} (${violationIds(rows)}); most distinct attackers striking one fighter in 1 s: ${maxAtk}; T4 wins ${pctS(t4.value)}`,
      capped(rows) === 0 && violations(rows) === 0 && maxAtk <= 2));
  }
  for (const id of ['multi/1v2', 'multi/1v3', 'multi/2v2', 'multi/ffa4']) {
    const rows = d.cell(id);
    out.push(qa(id.replace('multi/', ''), 'terminates; invariants hold (report win rates)', rows,
      `capped ${capped(rows)}; violations ${violations(rows)} (${violationIds(rows)}); side/team 0 wins ${pctS(proportion(rows.filter((r) => r.res.w === 0).length, rows.length).value)}; ${methodMix(rows)}`,
      capped(rows) === 0 && violations(rows) === 0));
  }
  {
    const rows = [...d.cell('multi/crowd_T5v5T0'), ...d.cell('edge_cases/crowd_T5v5T0')];
    const gr = rows.reduce((s, r) => s + (r.f[0]?.inGr ?? 0), 0);
    const con = rows.reduce((s, r) => s + (r.f[0]?.con ?? 0), 0);
    const share = con > 0 ? gr / con : null;
    const within = rows.every((r) => r.res.ts <= 181);
    out.push(qa('Crowd T5 vs 5xT0 (street)', 'terminates ≤ maxSeconds (180 s); endings reported; defender ground time ≤ 10 % of contact time',
      rows, `max elapsed ${Math.max(0, ...rows.map((r) => r.res.ts)).toFixed(0)} s; defender ground/contact ${pctS(share)}; endings: ${methodMix(rows)}`,
      within && share !== null && share <= 0.10));
  }
  {
    const rows = d.cell('edge_cases/crowd_T0_3v3');
    const med = median(rows.map((r) => r.res.ts)).value;
    const koE = proportion(rows.filter((r) => isKoTko(r.res.m) || r.res.m === 'allOpponentsStopped').length, rows.length);
    const indE = proportion(rows.filter((r) => ['separated', 'timeLimit', 'escaped'].includes(r.res.m) || r.res.w === 'draw' || r.res.w === 'none').length, rows.length);
    const ko = koE.value;
    const indecisive = indE.value;
    out.push(qa('All-T0 crowd (3xT0 vs 3xT0, street)', 'median contact time ≤ 60 s; ≈ 25 % KO endings; ≈ 45–50 % indecisive (±10 pp)',
      rows, `median duration ${med === null ? '—' : med.toFixed(0)} s; KO/stopped ${pctS(ko)}; indecisive ${pctS(indecisive)}; ${methodMix(rows)}`,
      med === null ? null : withHard(combineQa(inBand(koE, 0.15, 0.35), inBand(indE, 0.35, 0.60)), med <= 60)));
  }
  {
    const rows = d.plan('identical');
    const distinct = new Set(rows.map((r) => r.digest)).size;
    out.push(qa('Identical fighters', 'T5 holds; digests differ across seeds; same seed → same digest (tests)',
      rows, `${distinct} distinct digests over ${rows.length} bouts; A wins ${pctS(sideWin(rows, 0).value)} (see T5)`, rows.length === 0 ? null : distinct === rows.length));
  }
  {
    const rows = d.cell('edge_cases/zero_stats');
    const tiers = [...new Set(rows.flatMap((r) => r.f.map((f) => f.m.tier)))].sort();
    out.push(qa('Zero stats (all 0)', 'terminates; no NaN; both fighters T0; ends by KO/exhaustion or the clock',
      rows, `NaN ticks ${nan(rows)}; capped ${capped(rows)}; derived tiers ${tiers.join('/') || '—'}; valid ${rows.every((r) => r.qa?.valid.every(Boolean)) ? 'yes' : 'no'}; ${methodMix(rows)}`,
      nan(rows) === 0 && capped(rows) === 0 && tiers.every((t) => t <= 0)));
  }
  {
    const rows = d.cell('edge_cases/max_stats');
    out.push(qa('Max stats (all 100)', 'terminates; no probability outside [0,1]; logit clamp hits counted',
      rows, `NaN ticks ${nan(rows)}; capped ${capped(rows)}; ${methodMix(rows)}; logit-clamp hits: not measurable (the sim exposes no clamp counter)`,
      nan(rows) === 0 && capped(rows) === 0));
  }
  {
    const rows = d.cell('edge_cases/zero_vs_max');
    const e = edgeWinRate(rows);
    out.push(qa('Zero vs max', 'terminates; max-stat fighter wins ≥ 95 %', rows,
      `max-stat side wins ${pctS(e.value)}; NaN ${nan(rows)}`, withHard(inBand(e, 0.95, 1), nan(rows) === 0 && capped(rows) === 0)));
  }
  {
    const rows = d.cell('edge_cases/extreme_anthro');
    const e = edgeWinRate(rows);
    out.push(qa('Extreme anthropometrics (140 cm/45 kg vs 210 cm/150 kg)', 'terminates; larger fighter ≥ 80 %; no geometry assertion failures',
      rows, `larger wins ${pctS(e.value)}; invariant violations ${violations(rows)} (${violationIds(rows)}); NaN ${nan(rows)}`,
      withHard(inBand(e, 0.8, 1), violations(rows) === 0 && nan(rows) === 0 && capped(rows) === 0)));
  }
  {
    const rows = d.cell('edge_cases/age_18_vs_45');
    const e = edgeWinRate(rows);
    const w = e.value;
    const oldKo = proportion(rows.filter((r) => isKoTko(r.res.m) && r.res.w === r.bt!.edge).length, rows.length).value;
    const youngKo = proportion(rows.filter((r) => isKoTko(r.res.m) && r.res.w === 1 - r.bt!.edge!).length, rows.length).value;
    out.push(qa('Age 18 vs 45, equal skill', 'younger 58–62 %; older KO-loss share higher', rows,
      `younger wins ${pctS(w)}; KO losses older ${pctS(oldKo)} vs younger ${pctS(youngKo)}`,
      w === null || oldKo === null || youngKo === null ? null : withHard(inBand(e, 0.58, 0.62), oldKo > youngKo)));
  }
  {
    const rows = d.plan('rules_arenas');
    const vocabBad = rows.filter((r) => {
      const rs = r.tags.ruleset;
      if ((rs.startsWith('boxing') || rs.startsWith('kickboxing') || rs.startsWith('muay_thai')) && isSub(r.res.m)) return true;
      if (rs === 'street' && isDec(r.res.m)) return true;
      if ((rs.startsWith('grappling') || rs === 'judo.ijf') && isKoTko(r.res.m)) return true;
      return false;
    });
    const cells = new Set(rows.map((r) => r.cell)).size;
    out.push(qa('Rulesets x arenas (every standard pair + 6 non-standard)', 'invariants; illegal techniques only with a foul event; correct win-condition vocabulary',
      rows, `${cells} cells; capped ${capped(rows)}; invariant violations ${violations(rows)} (${violationIds(rows)}); fouls ${rows.reduce((s, r) => s + (r.qa?.fouls ?? 0), 0)}; vocabulary violations ${vocabBad.length}${vocabBad.length ? ` (${[...new Set(vocabBad.map((r) => `${r.tags.ruleset}:${r.res.m}`))].slice(0, 4).join(', ')})` : ''}`,
      capped(rows) === 0 && violations(rows) === 0 && vocabBad.length === 0));
  }
  {
    const rows = d.all.filter((r) => r.tags.plan === 'rules_arenas' && r.tags.ruleset === 'boxing.pro');
    const autoTko = rows.filter((r) => (r.qa?.maxKdRound ?? 0) >= 3 && r.res.m.startsWith('tko') && r.kd.filter((k) => k[0] === r.res.r).length === 3).length;
    out.push(qa('Boxing: three-knockdown rule absent; 20-s count when knocked through ropes', 'no auto-TKO on 3 KDs; rope count event',
      rows, `bouts with ≥ 3 KDs in a round: ${rows.filter((r) => (r.qa?.maxKdRound ?? 0) >= 3).length}; ended TKO on exactly the 3rd: ${autoTko}; referee counts ${rows.reduce((s, r) => s + (r.qa?.counts ?? 0), 0)}. Through-the-ropes: not measurable from rows (no rope event)`,
      autoTko === 0));
  }
  {
    const rows = d.all.filter((r) => r.tags.plan === 'rules_arenas' && r.tags.ruleset === 'kickboxing.glory');
    const three = rows.filter((r) => (r.qa?.maxKdRound ?? 0) >= 3);
    const ok = three.every((r) => r.res.m.startsWith('tko'));
    out.push(qa('GLORY: 3 KD/round → TKO; standing 8', 'asserted', rows,
      `bouts with a 3-KD round ${three.length} (all TKO: ${ok ? 'yes' : 'no'}); standing eights ${rows.reduce((s, r) => s + (r.qa?.eights ?? 0), 0)}`,
      rows.length === 0 ? null : ok));
  }
  {
    const rows = d.all.filter((r) => r.tags.plan === 'rules_arenas' && r.tags.ruleset === 'judo.ijf');
    out.push(qa('Judo: golden score unbounded; 3rd shido → hansoku-make', 'terminates', rows,
      `capped ${capped(rows)}; max elapsed ${Math.max(0, ...rows.map((r) => r.res.ts)).toFixed(0)} s; ${methodMix(rows)}`, capped(rows) === 0));
  }
  out.push(qa('IBJJF: 3-s stabilisation before points', 'asserted', [], 'not measurable from batch rows (needs the points timeline); no unit test covers it yet', null, true));
  {
    const len = d.cell('rules_arenas/mma.unified.3r@octagon_30/lenient');
    const str = d.cell('rules_arenas/mma.unified.3r@octagon_30/strict');
    const koDur = (rows: ResultRow[]) => mean(rows.filter((r) => isKoTko(r.res.m)).map(fmin)).value;
    const ded = (rows: ResultRow[]) => mean(rows.map((r) => r.qa?.deductions ?? 0)).value;
    const post = (rows: ResultRow[]) => mean(rows.filter((r) => r.lag).map((r) => r.lag![1])).value;
    const [kl, ks, dl, ds, pl, ps] = [koDur(len), koDur(str), ded(len), ded(str), post(len), post(str)];
    const f2 = (x: number | null) => (x === null ? '—' : x.toFixed(2));
    out.push(qa('Referee strictness lenient vs strict', 'strict: shorter KO/TKO duration, more deductions, fewer post-KO strikes',
      [...len, ...str], `KO/TKO min ${f2(kl)} → ${f2(ks)}; deductions/bout ${f2(dl)} → ${f2(ds)}; post-KO strikes ${f2(pl)} → ${f2(ps)}`,
      kl === null || ks === null || dl === null || ds === null || pl === null || ps === null ? null : ks < kl && ds >= dl && ps <= pl));
  }
  out.push(qa('Worker vs main thread', 'identical digest for the same config', [], 'tests/calibration.infra.test.ts (1 vs 2 worker_threads, byte-identical rows) and tests/match.setup.test.ts', null, true));
  out.push(qa('Resume mid-batch', '--resume reproduces results.jsonl (modulo ordering)', [], 'tests/calibration.infra.test.ts (interrupted run + partial line + resume == uninterrupted run)', null, true));
  return out;
}
