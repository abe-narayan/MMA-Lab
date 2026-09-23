/**
 * Dev probe: do a fighter's authored STYLE PREFERENCES change what he throws?
 *
 * This is the acceptance measurement for Phase 4 finding F-3. It takes one
 * archetype, clones it into variants that differ in *nothing but*
 * `style.favouriteTechniques` / `goToSubmissions` / `takedownPreferences` /
 * `favouriteCombos`, runs the same seeded batch of bouts of each against the
 * same fixed opponent, and prints how often each variant's own preference
 * actually shows up in the event log.
 *
 * The `control` fighter is the same man with every preference list emptied; it
 * is run once per group and counted against every variant's watch list, so the
 * "off" column is the same batch for all of them. A preference that does not
 * move its own technique's usage above the control row is not wired.
 *
 * Usage: `npx tsx scripts/dev/style.ts [bouts] [self] [opponent] [group]`
 *        group = all | subs | strikes | takedowns | combos
 */
import {
  simulate, ARCHETYPES, DEFAULT_SETTINGS, boutSeed, resolveSubmissionFamily,
  type SimConfig, type FighterDefinition, type SimEvent,
} from '../../src/sim';

const ARCH = Object.values(ARCHETYPES);
const by = (id: string): FighterDefinition => {
  const found = ARCH.find((a) => a.id === id);
  if (!found) throw new Error(`no archetype ${id}; have ${ARCH.map((a) => a.id).join(', ')}`);
  return found;
};

const N = Number(process.argv[2] ?? 200);
const SELF = by(process.argv[3] ?? 'arch.regional_pro_allrounder');
const OPP = by(process.argv[4] ?? 'arch.regional_pro_allrounder');
const GROUP = process.argv[5] ?? 'all';

function expand(family: string): string[] {
  const out = resolveSubmissionFamily(family).map((s) => s.id);
  if (out.length === 0) throw new Error(`no submission family ${family}`);
  return out;
}

// ---------------------------------------------------------------------------
// Variants: identical fighters, different Style tab
// ---------------------------------------------------------------------------

type StyleBlock = FighterDefinition['style'];
type Group = 'subs' | 'strikes' | 'takedowns' | 'combos';

interface Variant {
  group: Group;
  label: string;
  /** What this variant claims to prefer; the ids we then count. */
  watch: string[];
  style: Partial<StyleBlock>;
}

const clone = (d: FighterDefinition): FighterDefinition =>
  JSON.parse(JSON.stringify(d)) as FighterDefinition;

/** Every authored preference list emptied — the control fighter. */
const BLANK: Partial<StyleBlock> = {
  favouriteTechniques: [],
  favouriteCombos: [],
  goToSubmissions: [],
  takedownPreferences: { prefs: [], setup: 'naked', cageBias: 0.5 },
};

function withStyle(patch: Partial<StyleBlock>): FighterDefinition {
  const def = clone(SELF);
  def.style = { ...def.style, ...BLANK, ...patch } as StyleBlock;
  return def;
}

const sub = (id: string, weight = 2.0): { subId: string; weight: number } => ({ subId: id, weight });
const tech = (id: string, weight = 2.0): { techId: string; weight: number } => ({ techId: id, weight });

const VARIANTS: Variant[] = [
  // --- submissions: specialists who all share the `submission` family ------
  {
    group: 'subs', label: 'guillotine specialist',
    watch: expand('sub.guillotine'),
    style: { goToSubmissions: [sub('sub.guillotine')] },
  },
  {
    group: 'subs', label: 'armbar specialist',
    watch: expand('sub.armbar'),
    style: { goToSubmissions: [sub('sub.armbar')] },
  },
  {
    group: 'subs', label: 'kimura specialist (family)',
    watch: expand('sub.kimura'),
    style: { goToSubmissions: [sub('sub.kimura')] },
  },
  {
    group: 'subs', label: 'leg-locker',
    watch: [...expand('sub.heel_hook'), ...expand('sub.kneebar')],
    style: { goToSubmissions: [sub('sub.heel_hook'), sub('sub.kneebar')] },
  },
  {
    group: 'subs', label: 'strangler (rnc, arm triangle)',
    watch: [...expand('sub.rnc'), ...expand('sub.arm_triangle')],
    style: { goToSubmissions: [sub('sub.rnc'), sub('sub.arm_triangle')] },
  },

  // --- strikes -------------------------------------------------------------
  {
    group: 'strikes', label: 'head-kick lover',
    watch: ['tech.kick_head_rear', 'tech.kick_head_switch', 'tech.kick_head_question'],
    style: {
      favouriteTechniques: [tech('tech.kick_head_rear'), tech('tech.kick_head_switch')],
    },
  },
  {
    group: 'strikes', label: 'body puncher',
    watch: ['tech.hook_rear_body', 'tech.hook_lead_body', 'tech.jab_body', 'tech.uppercut_body'],
    style: {
      favouriteTechniques: [
        tech('tech.hook_rear_body'), tech('tech.hook_lead_body'), tech('tech.jab_body'),
      ],
    },
  },
  {
    group: 'strikes', label: 'leg kicker',
    watch: ['tech.kick_low_rear', 'tech.kick_low_lead', 'tech.kick_calf'],
    style: {
      favouriteTechniques: [
        tech('tech.kick_low_rear'), tech('tech.kick_low_lead'), tech('tech.kick_calf'),
      ],
    },
  },
  {
    group: 'strikes', label: 'jabber',
    watch: ['tech.jab', 'tech.jab_step', 'tech.jab_body'],
    style: { favouriteTechniques: [tech('tech.jab'), tech('tech.jab_step')] },
  },

  // --- takedowns -----------------------------------------------------------
  {
    group: 'takedowns', label: 'double-leg wrestler',
    watch: ['tech.double_leg'],
    style: {
      takedownPreferences: {
        prefs: [tech('tech.double_leg')], setup: 'offCombination', cageBias: 0.8,
      },
    },
  },
  {
    group: 'takedowns', label: 'single-leg wrestler',
    watch: ['tech.single_leg'],
    style: {
      takedownPreferences: {
        prefs: [tech('tech.single_leg')], setup: 'offCombination', cageBias: 0.8,
      },
    },
  },
  {
    group: 'takedowns', label: 'judo thrower',
    watch: ['tech.uchi_mata', 'tech.osoto_gari', 'tech.kouchi_gari'],
    style: {
      takedownPreferences: {
        prefs: [tech('tech.uchi_mata'), tech('tech.osoto_gari'), tech('tech.kouchi_gari')],
        setup: 'offClinch', cageBias: 0.3,
      },
    },
  },

  // --- combinations: the watch list is the combination's *tail* ------------
  {
    group: 'combos', label: 'one-two man',
    watch: ['tech.cross'],
    style: {
      favouriteCombos: [{ id: 'combo.one_two', sequence: ['tech.jab', 'tech.cross'], weight: 2.0 }],
    },
  },
  {
    group: 'combos', label: 'jab-cross-low-kick',
    watch: ['tech.kick_low_rear'],
    style: {
      favouriteCombos: [{
        id: 'combo.jab_cross_low',
        sequence: ['tech.jab', 'tech.cross', 'tech.kick_low_rear'],
        weight: 2.0,
      }],
    },
  },
];

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

interface Counts {
  /** Events of the watched ids. */
  hits: number;
  /** Events of the category the watched ids belong to. */
  total: number;
}

interface Batch {
  seconds: number;
  strikes: number;
  grapples: number;
  subStages: number;
  /** Per watch-list index. */
  strikeHits: number[];
  grappleHits: number[];
  subHits: number[];
  finishes: number[];
  methods: Record<string, number>;
  wins: number;
}

const GRAPPLE_KINDS = new Set<SimEvent['kind']>([
  'takedown', 'clinch', 'positionChange', 'scramble', 'reversal', 'standUp',
]);

/** One seeded batch, counted against several watch lists at once. */
function runBatch(def: FighterDefinition, watchLists: readonly (readonly string[])[]): Batch {
  const sets = watchLists.map((w) => new Set(w));
  const b: Batch = {
    seconds: 0, strikes: 0, grapples: 0, subStages: 0,
    strikeHits: sets.map(() => 0),
    grappleHits: sets.map(() => 0),
    subHits: sets.map(() => 0),
    finishes: sets.map(() => 0),
    methods: {}, wins: 0,
  };
  for (let i = 0; i < N; i++) {
    const cfg: SimConfig = {
      seed: boutSeed('style', '1v1', i),
      mode: '1v1',
      fighters: [def, OPP],
      teams: { teamOf: [0, 1] },
      ruleset: 'mma.unified.3r',
      arena: 'octagon_30',
      settings: { ...DEFAULT_SETTINGS },
    };
    const r = simulate(cfg);
    b.seconds += r.result.totalSeconds;
    b.methods[r.result.method] = (b.methods[r.result.method] ?? 0) + 1;
    if (r.result.winner === 0) b.wins += 1;
    for (const e of r.events) {
      if (e.actor !== 0) continue;
      if (e.kind === 'strike') {
        const id = (e as { detail: { technique: string } }).detail.technique;
        b.strikes += 1;
        sets.forEach((s, k) => { if (s.has(id)) b.strikeHits[k] += 1; });
      } else if (GRAPPLE_KINDS.has(e.kind)) {
        const id = (e as { detail?: { edge?: string } }).detail?.edge;
        if (!id) continue;
        b.grapples += 1;
        sets.forEach((s, k) => { if (s.has(id)) b.grappleHits[k] += 1; });
      } else if (e.kind === 'submissionStage') {
        const d = (e as { detail: { technique: string; stage: number } }).detail;
        if (d.stage < 1) continue;
        b.subStages += 1;
        sets.forEach((s, k) => { if (s.has(d.technique)) b.subHits[k] += 1; });
      } else if (e.kind === 'submissionFinish') {
        const id = (e as { detail: { technique: string } }).detail.technique;
        sets.forEach((s, k) => { if (s.has(id)) b.finishes[k] += 1; });
      }
    }
  }
  return b;
}

function countsFor(b: Batch, group: Group, k: number): Counts {
  if (group === 'subs') return { hits: b.subHits[k], total: b.subStages };
  if (group === 'takedowns') return { hits: b.grappleHits[k], total: b.grapples };
  return { hits: b.strikeHits[k], total: b.strikes };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const pct = (a: number, b: number): string => (b > 0 ? `${((100 * a) / b).toFixed(2)}%` : '  -   ');
const per15 = (n: number, seconds: number): number =>
  (seconds > 0 ? (n / (seconds / 60)) * 15 : 0);

const groups: Group[] = GROUP === 'all'
  ? ['subs', 'strikes', 'takedowns', 'combos']
  : [GROUP as Group];

console.log(`${SELF.name} style variants vs ${OPP.name}  |  ${N} seeded bouts each`);
console.log('Variants differ in style preferences ONLY; the seed batch is identical.');
console.log('"off" is the same fighter with every preference list emptied.\n');

for (const group of groups) {
  const rows = VARIANTS.filter((v) => v.group === group);
  if (rows.length === 0) continue;
  const watchLists = rows.map((v) => v.watch);
  const control = runBatch(withStyle({}), watchLists);

  console.log(`--- ${group} (control: ${(control.seconds / N / 60).toFixed(1)} min mean, `
    + `${control.wins}/${N} wins) ---`);
  console.log(
    'preference'.padEnd(30)
    + 'off/15m'.padStart(9)
    + 'on/15m'.padStart(9)
    + 'ratio'.padStart(8)
    + '     share off -> on'
    + '     finishes',
  );

  rows.forEach((v, k) => {
    const on = runBatch(withStyle(v.style), [v.watch]);
    const a = countsFor(control, group, k);
    const b = countsFor(on, group, 0);
    const ra = per15(a.hits, control.seconds);
    const rb = per15(b.hits, on.seconds);
    console.log(
      v.label.padEnd(30)
      + ra.toFixed(2).padStart(9)
      + rb.toFixed(2).padStart(9)
      + (ra > 0 ? `x${(rb / ra).toFixed(2)}` : (rb > 0 ? '  new' : '   -')).padStart(8)
      + `     ${pct(a.hits, a.total)} -> ${pct(b.hits, b.total)}`
      + `     ${control.finishes[k]} -> ${on.finishes[0]}`,
    );
  });
  console.log('');
}
