/**
 * QA harness (Phase 9 edge-case QA). Shared helpers for the qa-*.ts probes and
 * tests/qa.edgecases.test.ts. Builds configs, runs bouts stepwise and checks
 * every snapshot for non-finite numbers and out-of-range condition values.
 */
import {
  ARCHETYPES, DEFAULT_SETTINGS, createSim, boutSeed,
  type FighterDefinition, type SimConfig, type MatchMode, type BoutResult, type TickSnapshot,
  SUB_SKILLS,
} from '../../src/sim';

export const ALL = Object.values(ARCHETYPES) as FighterDefinition[];
export const arch = (id: string): FighterDefinition => {
  const f = ALL.find((a) => a.id === id);
  if (!f) throw new Error(`no archetype ${id}`);
  return f;
};

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Copy with a unique id/short so a roster can contain the same template twice. */
export function withId(f: FighterDefinition, id: string): FighterDefinition {
  const c = clone(f);
  c.id = id;
  c.name = `${f.name} ${id}`;
  c.short = id.slice(0, 3).toUpperCase();
  return c;
}

export interface CfgOpts {
  mode?: MatchMode;
  teamOf?: number[];
  ruleset?: string;
  arena?: string;
  settings?: Partial<SimConfig['settings']>;
}

export function cfg(seed: string, fighters: FighterDefinition[], o: CfgOpts = {}): SimConfig {
  const mode = o.mode ?? '1v1';
  const teamOf = o.teamOf ?? fighters.map((_, i) => (mode === 'ffa' ? i : Math.min(i, 1)));
  return {
    seed,
    mode,
    fighters,
    teams: { teamOf },
    ruleset: (o.ruleset ?? (mode === 'crowd' ? 'street' : 'mma.unified.3r')) as SimConfig['ruleset'],
    arena: (o.arena ?? (mode === 'crowd' ? 'street_open' : 'octagon_30')) as SimConfig['arena'],
    settings: { ...DEFAULT_SETTINGS, ...(o.settings ?? {}) },
  };
}

export interface Checked {
  result: BoutResult;
  ticks: number;
  digest: string;
  problems: string[];
  events: number;
  eventKinds: Record<string, number>;
  ms: number;
  maxTicksHit: boolean;
}

function scan(s: TickSnapshot, problems: string[]): void {
  if (problems.length > 20) return;
  for (const f of s.fighters) {
    const nums: [string, number][] = [
      ['x', f.x], ['z', f.z], ['facing', f.facing], ['vx', f.vx], ['vz', f.vz],
      ['stamina.total', f.stamina.total], ['stamina.burst', f.stamina.burst],
      ['damage.head', f.damage.head], ['damage.body', f.damage.body],
      ['damage.legs', f.damage.legs], ['damage.cut', f.damage.cut], ['balance', f.balance],
      ['sub.progress', f.sub.progress], ['actionPhase', f.actionPhase],
    ];
    for (const [k, v] of nums) {
      if (!Number.isFinite(v)) problems.push(`t${s.tick} f${f.id} ${k}=${v}`);
    }
    for (const [k, v] of nums.slice(5, 12)) {
      if (v < -1e-9) problems.push(`t${s.tick} f${f.id} ${k} negative ${v}`);
    }
    if (Math.abs(f.x) > 1000 || Math.abs(f.z) > 1000) {
      problems.push(`t${s.tick} f${f.id} position runaway (${f.x}, ${f.z})`);
    }
  }
}

/** Run to the end, scanning a snapshot every `every` ticks (1 = every tick). */
export function runChecked(config: SimConfig, every = 10, maxTicks?: number): Checked {
  const t0 = performance.now();
  const sim = createSim(config, maxTicks ? { maxTicks } : {});
  const problems: string[] = [];
  scan(sim.snapshot(), problems);
  while (sim.step()) {
    if (sim.tick % every === 0) scan(sim.snapshot(), problems);
  }
  scan(sim.snapshot(), problems);
  const result = sim.result as BoutResult;
  const kinds: Record<string, number> = {};
  for (const e of sim.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  const cap = maxTicks ?? sim.world.params.get('core.maxTicks');
  if (!result) problems.push('no result');
  else {
    const n = config.fighters.length;
    const w = result.winner;
    if (typeof w === 'number' && (w < 0 || w >= n)) problems.push(`winner index ${w} out of range`);
    if (!Number.isFinite(result.totalSeconds) || result.totalSeconds < 0) problems.push(`totalSeconds ${result.totalSeconds}`);
    if (typeof w === 'number' && result.winningTeam !== null && config.teams.teamOf[w] !== result.winningTeam) {
      problems.push(`winner ${w} is on team ${config.teams.teamOf[w]} but winningTeam=${result.winningTeam}`);
    }
  }
  return {
    result, ticks: sim.tick, digest: sim.digest, problems, events: sim.events.length,
    eventKinds: kinds, ms: performance.now() - t0, maxTicksHit: sim.tick >= cap,
  };
}

// ---------------------------------------------------------------------------
// synthetic fighters
// ---------------------------------------------------------------------------

type Phys = FighterDefinition['physical'];
type Ment = FighterDefinition['mental'];

export function setAllPhysical(f: FighterDefinition, v: number): void {
  for (const k of Object.keys(f.physical) as (keyof Phys)[]) f.physical[k] = v;
}
export function setAllMental(f: FighterDefinition, v: number): void {
  for (const k of Object.keys(f.mental) as (keyof Ment)[]) f.mental[k] = v;
}
/** Every discipline present with every sub-skill at `v` and `years` years. */
export function setAllDisciplines(f: FighterDefinition, v: number, years: number): void {
  const d: Record<string, unknown> = {};
  for (const [id, subs] of Object.entries(SUB_SKILLS)) {
    d[id] = { years, sub: Object.fromEntries(subs.map((s) => [s, v])) };
  }
  f.disciplines = d as FighterDefinition['disciplines'];
}

/** A fighter with every 0-100 number at `v` (physical, mental, all sub-skills). */
export function flatFighter(id: string, v: number, years: number, base = 'arch.regional_pro_allrounder'): FighterDefinition {
  const f = withId(arch(base), id);
  setAllPhysical(f, v);
  setAllMental(f, v);
  setAllDisciplines(f, v, years);
  return f;
}

export { boutSeed };

/** Wilson 95% interval for k successes of n. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [c - h, c + h];
}
