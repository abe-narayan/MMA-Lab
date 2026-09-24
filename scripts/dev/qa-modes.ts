/** QA probe 1: 1vN / teams / ffa / crowd completion, NaN, bookkeeping. */
import { ALL, arch, cfg, runChecked, withId } from './qa-lib';

const SEEDS = Number(process.argv[2] ?? 6);
const rpa = arch('arch.regional_pro_allrounder');
const chm = arch('arch.champion_complete');
const bnb = arch('arch.brand_new_brawler');

const roster = (tpl: typeof rpa, n: number, pfx: string) =>
  Array.from({ length: n }, (_, i) => withId(tpl, `${pfx}${i}`));

interface Case { name: string; make: (s: number) => ReturnType<typeof cfg> }
const cases: Case[] = [];
for (const [a, b] of [[1, 2], [1, 3], [1, 5], [2, 2], [3, 3]] as const) {
  cases.push({
    name: `teams ${a}v${b} RPA`,
    make: (s) => {
      const f = [...roster(rpa, a, 'a'), ...roster(rpa, b, 'b')];
      return cfg(`qa-teams-${a}v${b}-${s}`, f, { mode: 'teams', teamOf: f.map((_, i) => (i < a ? 0 : 1)) });
    },
  });
}
cases.push({
  name: 'teams 1v5 CHM vs 5 BNB',
  make: (s) => {
    const f = [withId(chm, 'hero'), ...roster(bnb, 5, 'n')];
    return cfg(`qa-1v5-chm-${s}`, f, { mode: 'teams', teamOf: [0, 1, 1, 1, 1, 1] });
  },
});
for (const n of [2, 4, 6]) {
  cases.push({
    name: `ffa ${n}`,
    make: (s) => cfg(`qa-ffa${n}-${s}`, ALL.slice(0, n).map((f, i) => withId(f, `f${i}`)), { mode: 'ffa' }),
  });
}
for (const n of [2, 5, 8]) {
  cases.push({
    name: `crowd 1v${n}`,
    make: (s) => {
      const f = [withId(chm, 'def'), ...roster(rpa, n, 'at')];
      return cfg(`qa-crowd${n}-${s}`, f, { mode: 'crowd', teamOf: f.map((_, i) => (i === 0 ? 0 : 1)), settings: { maxSeconds: 180 } });
    },
  });
}
cases.push({
  name: 'crowd 1v3 no maxSeconds (street untimed)',
  make: (s) => {
    const f = [withId(rpa, 'def'), ...roster(rpa, 3, 'at')];
    return cfg(`qa-crowd-nocap-${s}`, f, { mode: 'crowd', teamOf: [0, 1, 1, 1] });
  },
});

const filter = process.argv[3];
for (const c of cases) {
  if (filter && !c.name.includes(filter)) continue;
  const methods: Record<string, number> = {};
  const winners: Record<string, number> = {};
  let ms = 0, ticks = 0, capHits = 0;
  const probs: string[] = [];
  for (let s = 0; s < SEEDS; s++) {
    const config = c.make(s);
    const r = runChecked(config, 5);
    ms += r.ms; ticks += r.ticks;
    if (r.maxTicksHit) capHits++;
    methods[r.result.method] = (methods[r.result.method] ?? 0) + 1;
    const wk = `${r.result.winner}/${r.result.winningTeam}`;
    winners[wk] = (winners[wk] ?? 0) + 1;
    for (const p of r.problems) probs.push(`seed ${s}: ${p}`);
    if (s === 0) console.log(`   sample: ${JSON.stringify({ ...r.result, scorecards: r.result.scorecards.length, judgeTotals: r.result.judgeTotals })}`);
  }
  console.log(`${c.name}: avg ${(ms / SEEDS).toFixed(0)} ms, ${(ticks / SEEDS).toFixed(0)} ticks, cap hits ${capHits}`);
  console.log(`   methods ${JSON.stringify(methods)} winners(w/team) ${JSON.stringify(winners)}`);
  if (probs.length) console.log(`   PROBLEMS: ${probs.slice(0, 8).join(' | ')}`);
}
