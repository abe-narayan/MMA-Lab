/** QA probe 6: customization extremes — validator verdicts and sim survival. */
import { deriveRuntime, resolveParams, SUB_SKILLS, type FighterDefinition } from '../../src/sim';
import { validateFighter } from '../../src/app/store/validate';
import { arch, cfg, runChecked, withId, setAllDisciplines } from './qa-lib';

const PARAMS = resolveParams();
const rpa = arch('arch.regional_pro_allrounder');
type Mut = (f: any) => void;
const V: [string, Mut][] = [
  ['baseline', () => {}],
  ['all disciplines years 0 skills 0', (f) => setAllDisciplines(f, 0, 0)],
  ['all disciplines years 60 skills 100', (f) => setAllDisciplines(f, 100, 60)],
  ['all disciplines years 1e6 skills 100', (f) => setAllDisciplines(f, 100, 1e6)],
  ['record all zeros, experienceOverride 0', (f) => { Object.assign(f.record, { proWins: 0, proLosses: 0, proDraws: 0, amWins: 0, amLosses: 0, koLosses: 0, knockdownsSuffered: 0, titleFights: 0, experienceOverride: 0, totalRounds: 0, yearsPro: 0 }); }],
  ['record huge, experienceOverride 100', (f) => { Object.assign(f.record, { proWins: 1e6, proLosses: 1e6, koLosses: 1e6, knockdownsSuffered: 1e6, totalRounds: 1e7, yearsPro: 30, experienceOverride: 100, oppositionLevel: 100, mainEvents: 1e6, warFights: 1e6 }); }],
  ['height 3.0 reach 3.5 legReach 2 (max valid)', (f) => { Object.assign(f.body, { heightM: 3, reachM: 3.5, legReachM: 2 }); }],
  ['height 0.01 reach 0.01 legReach 0.01 (min valid)', (f) => { Object.assign(f.body, { heightM: 0.01, reachM: 0.01, legReachM: 0.01 }); }],
  ['mass 0.01 kg (valid w/ warning?)', (f) => { f.body.massKg = 0.01; delete f.body.weighInKg; delete f.body.fightNightKg; delete f.body.naturalWeightKg; }],
  ['mass 500 kg', (f) => { f.body.massKg = 500; delete f.body.weighInKg; delete f.body.fightNightKg; delete f.body.naturalWeightKg; }],
  ['age 0.01', (f) => { f.body.ageYears = 0.01; }],
  ['age 120', (f) => { f.body.ageYears = 120; }],
  ['bodyFat 75', (f) => { f.body.bodyFatPct = 75; }],
  ['bodyFat 0.01', (f) => { f.body.bodyFatPct = 0.01; }],
  ['weighIn exactly at LW limit 70.3', (f) => { Object.assign(f.body, { massKg: 70.3, weighInKg: 70.3, fightNightKg: 75, weightClass: 'wc.lightweight' }); }],
  ['weighIn 0.1 over LW limit, class LW', (f) => { Object.assign(f.body, { massKg: 70.4, weighInKg: 70.4, weightClass: 'wc.lightweight' }); }],
  ['build blend all zero', (f) => { f.body.build = { ecto: 0, meso: 0, endo: 0 }; }],
  ['build blend negative', (f) => { f.body.build = { ecto: -1, meso: 2, endo: 0 }; }],
  ['handStrengthSplit 100, limbAsymmetry 50%', (f) => { f.body.handStrengthSplit = 100; f.body.limbAsymmetry = { armPct: 50, legPct: -50 }; }],
  ['style: pressureBias 0, whenLosing stall, initiative counter', (f) => { Object.assign(f.style, { pressureBias: 0, whenLosing: 'stall', initiative: 'counter', primaryMode: 'counter' }); }],
  ['style: pressureBias 100, gamble, submissionHunt', (f) => { Object.assign(f.style, { pressureBias: 100, whenLosing: 'gamble', initiative: 'pressure', primaryMode: 'submissionHunt', preferredRange: 'ground', losingBehaviour: 'gamble', tiredBehaviour: 'gamble', hurtBehaviour: 'trade' }); }],
  ['style: pacing outputMult 1e9 riskAppetite 1e9', (f) => { f.style.pacing = [1, 2, 3].map((round) => ({ round, outputMult: 1e9, riskAppetite: 1e9 })); }],
  ['style: pacing outputMult -5 riskAppetite -5', (f) => { f.style.pacing = [1, 2, 3].map((round) => ({ round, outputMult: -5, riskAppetite: -5 })); }],
  ['style: favourite technique weight 1e9 / negative', (f) => { f.style.favouriteTechniques = [{ techId: 'str.jab', weight: 1e9 }, { techId: 'str.cross', weight: -1e9 }]; }],
  ['style: refusesToTap + go-to subs only', (f) => { f.style.refusesToTap = true; }],
  ['injuries: every region severity 100 monthsAgo 0', (f) => { f.history = { injuries: ['head', 'eye', 'neck', 'shoulder', 'elbow', 'hand', 'ribs', 'back', 'hip', 'knee', 'ankle'].map((region) => ({ region, severity: 100, monthsAgo: 0, surgery: true, recurrent: true })), surgeries: 50 }; }],
  ['discipline monthsSinceTrained 1e6, coach 0, hours 0', (f) => { for (const d of Object.values(f.disciplines) as any[]) { d.monthsSinceTrained = 1e6; d.coachQuality = 0; d.hoursPerWeek = 0; d.sessionsPerWeek = 0; } }],
  ['discipline hours 168/wk sessions 100 sparring 100 coach 100 startAge 3', (f) => { for (const d of Object.values(f.disciplines) as any[]) { d.hoursPerWeek = 168; d.sessionsPerWeek = 100; d.sparringIntensity = 100; d.coachQuality = 100; d.startAge = 3; } }],
  ['weightCut 50% cut, 50% regain', (f) => { f.record.weightCut = { cutPct: 50, regainPct: 50 }; }],
  // Invalid inputs: validator must refuse, cleanly.
  ['INVALID height -1', (f) => { f.body.heightM = -1; }],
  ['INVALID height NaN', (f) => { f.body.heightM = NaN; }],
  ['INVALID height "tall"', (f) => { f.body.heightM = 'tall'; }],
  ['INVALID strength 101', (f) => { f.physical.strength = 101; }],
  ['INVALID strength -1', (f) => { f.physical.strength = -1; }],
  ['INVALID cardio Infinity', (f) => { f.physical.cardio = Infinity; }],
  ['INVALID physical missing', (f) => { delete f.physical; }],
  ['INVALID sub-skill 150', (f) => { const d = Object.values(f.disciplines)[0] as any; d.sub[Object.keys(d.sub)[0]] = 150; }],
  ['INVALID years -3', (f) => { (Object.values(f.disciplines)[0] as any).years = -3; }],
  ['INVALID unknown discipline', (f) => { f.disciplines.capoeira = { years: 3, sub: {} }; }],
  ['INVALID stance', (f) => { f.body.stance = 'crane'; }],
  ['INVALID mass 0', (f) => { f.body.massKg = 0; }],
  ['INVALID mass 501', (f) => { f.body.massKg = 501; }],
  ['INVALID disciplines null', (f) => { f.disciplines = null; }],
  ['INVALID pacing outputMult NaN', (f) => { f.style.pacing = [{ round: 1, outputMult: NaN, riskAppetite: 0.5 }]; }],
];

for (const [name, mut] of V) {
  const f = withId(rpa, 'x') as any;
  mut(f);
  let vr: ReturnType<typeof validateFighter> | null = null; let vthrew = '';
  try { vr = validateFighter(f); } catch (e) { vthrew = (e as Error).message; }
  const errs = vr?.issues.filter((i) => i.severity === 'error') ?? [];
  const warns = vr?.issues.filter((i) => i.severity === 'warning') ?? [];
  let derive = 'ok'; let sim = '';
  try {
    const rt = deriveRuntime(f as FighterDefinition, PARAMS, { explain: false }) as any;
    const bad: string[] = [];
    const walk = (o: any, p: string, depth: number) => {
      if (depth > 4 || bad.length > 5) return;
      if (typeof o === 'number' && !Number.isFinite(o)) bad.push(`${p}=${o}`);
      else if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) { if (k !== 'def') walk(v, `${p}.${k}`, depth + 1); }
    };
    walk(rt, 'rt', 0);
    if (bad.length) derive = `NON-FINITE ${bad.join(', ')}`;
  } catch (e) { derive = `THREW ${(e as Error).message}`; }
  if (!name.startsWith('INVALID') || vr?.ok) {
    const outs: string[] = [];
    for (let s = 0; s < 3; s++) {
      try {
        const r = runChecked(cfg(`qa-custom-${name}-${s}`, [f as FighterDefinition, withId(rpa, 'ref')]), 10);
        outs.push(`${r.result.method}/${r.result.winner}${r.problems.length ? ` PROBLEMS ${r.problems.slice(0, 3).join(';')}` : ''}`);
      } catch (e) { outs.push(`THREW ${(e as Error).message.slice(0, 120)}`); break; }
    }
    sim = outs.join(', ');
  }
  console.log(`${name}: valid=${vr?.ok}${vthrew ? ` VALIDATOR THREW ${vthrew}` : ''} errors=${errs.length} warns=${warns.length}${errs[0] ? ` first="${errs[0].path}: ${errs[0].message}"` : ''}${!errs[0] && warns[0] ? ` warn="${warns[0].path}: ${warns[0].message}"` : ''} | derive ${derive}${sim ? ` | sim ${sim}` : ''}`);
}
void SUB_SKILLS;
