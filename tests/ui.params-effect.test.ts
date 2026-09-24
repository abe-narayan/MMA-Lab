/**
 * PARAMETER EFFECT — every control the fighter editor exposes must change
 * what the simulation does.
 *
 * Three layers, cheapest first:
 *
 *  1. **Bout level (the profile editor).** For every `PROFILE_PARAMS` entry
 *     with `status: 'live'`, run a small deterministic batch with the
 *     parameter at its probe's low value and again at its high value — same
 *     seeds, same opponent (a paired comparison). Two kinds of probe:
 *       - *Directional*: a causally related statistic (strike force, output,
 *         damage taken, takedown attempts, submission threats faced…) moves
 *         by at least the probe's threshold (5 % by default) the declared way.
 *       - *Divergence* (`boutsChanged`): at least the stated share of the
 *         paired bouts end with a different digest. Used where the effect is
 *         real but no single statistic moved the same way on independent
 *         seed sets at test sample sizes (bouts are chaotic, and 16 short
 *         bouts cannot resolve a 5 % shift in, say, clinch share). It proves
 *         the simulation reads the control and changes what happens; it does
 *         not claim a direction. docs/design/UI_PASS.md says which is which.
 *     Harness: `src/app/model/paramEffect.ts`. Probes marked `slow` need full
 *     three-round bouts (the effect lives in round breaks or in rare events);
 *     their test names carry "[slow]". All of them run by default.
 *  2. **Derivation level (the raw schema editor).** Every sub-skill of every
 *     discipline and every per-discipline career field changes
 *     `deriveRuntime` — the only door into the simulation a fighter has.
 *     (That the runtime values then move bouts is layer 1's job, through the
 *     TECHNICAL composites that shift those same sub-skills.)
 *  3. **Honest labels.** Every path in `NO_SIM_EFFECT_PATHS`, and every
 *     profile control shown as "not read by the simulation" (`status:
 *     'presentation'`), really has no effect: changing it leaves the bout
 *     digest byte-identical. If one of these ever starts to matter, this
 *     fails and the label must come off (promote it to `live` with a probe).
 *
 * Everything is seeded; a failure is a regression, never flakiness. Run the
 * table printer (`scripts/dev/param-effects.ts`) to see the measured values.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, SUB_SKILLS, createSim, deriveRuntime, resolveParams,
  type CoreDisciplineId, type FighterDefinition, type SimConfig,
} from '../src/sim';
import { NO_SIM_EFFECT_PATHS, PROFILE_PARAMS } from '../src/app/model/profileModel';
import { probeBase, probeOpponent, probeParam } from '../src/app/model/paramEffect';
import { getAtPath, setAtPath } from '../src/app/model/paths';

const base = probeBase();
const params = resolveParams();

/** Runtime without the echoed definition, as a stable string. */
function runtimeKey(def: FighterDefinition): string {
  const rt = deriveRuntime(def, params, { explain: false }) as unknown as Record<string, unknown>;
  return JSON.stringify(rt, (key, value: unknown) => {
    if (key === 'def') return undefined;
    if (value instanceof Map) return [...value.entries()];
    if (value instanceof Set) return [...value.values()];
    return value;
  });
}

function digestOf(subject: FighterDefinition, seed = 'ui-noeffect-0', seconds = 150): string {
  const config: SimConfig = {
    seed, mode: '1v1', fighters: [subject, probeOpponent('mirror')], teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30',
    settings: { ...DEFAULT_SETTINGS, rounds: 1, roundSeconds: seconds },
  };
  const sim = createSim(config);
  while (sim.step()) { /* run to the end */ }
  return sim.digest;
}

// ---------------------------------------------------------------------------
// 1. Bout level
// ---------------------------------------------------------------------------

describe('every live profile parameter moves a related bout statistic', () => {
  const live = PROFILE_PARAMS.filter((p) => p.status === 'live');

  it('gives every live parameter a probe (or a named derivation-level check)', () => {
    const derivationOnly = new Set(['style.refusesToTap']);
    const missing = live.filter((p) => !p.probe && !derivationOnly.has(p.id)).map((p) => p.id);
    expect(missing).toEqual([]);
  });

  for (const p of live) {
    if (!p.probe) continue;
    const probe = p.probe;
    const what = probe.metric === 'boutsChanged'
      ? `changes at least ${Math.round((probe.minRel ?? 0.5) * 100)} % of paired bouts`
      : `moves ${probe.metric}${probe.dir === 1 ? ' up' : probe.dir === -1 ? ' down' : ''}`;
    const name = `${p.label} (${p.id}): ${probe.lo} → ${probe.hi} ${what}${probe.slow ? ' [slow]' : ''}`;
    it(name, () => {
      const r = probeParam(p, base);
      const detail = probe.metric === 'boutsChanged'
        ? `${(r.hi * 100).toFixed(0)} % of ${r.seeds} paired bouts diverged, need ${((probe.minRel ?? 0.5) * 100).toFixed(0)} %`
        : `${r.metric}: ${r.lo.toFixed(4)} → ${r.hi.toFixed(4)} `
          + `(${(r.relChange * 100).toFixed(1)} %, need ${((probe.minRel ?? 0.05) * 100).toFixed(0)} %`
          + `${probe.dir !== 0 ? `, direction ${probe.dir > 0 ? '+' : '-'}` : ''}) over ${r.seeds} paired seeds`;
      expect(r.pass, detail).toBe(true);
    }, probe.slow ? 240_000 : 120_000);
  }

  it('Refuses to tap (style.refusesToTap) changes the derived submission resistance', () => {
    const p = PROFILE_PARAMS.find((x) => x.id === 'style.refusesToTap')!;
    expect(runtimeKey(p.set(base, true))).not.toBe(runtimeKey(p.set(base, false)));
  });
});

// ---------------------------------------------------------------------------
// 2. Derivation level: the raw schema editor's discipline fields
// ---------------------------------------------------------------------------

describe('every discipline field the raw editor exposes reaches deriveRuntime', () => {
  const reference = runtimeKey(base);

  it('every sub-skill of every discipline', () => {
    const dead: string[] = [];
    for (const d of Object.keys(SUB_SKILLS) as CoreDisciplineId[]) {
      for (const s of SUB_SKILLS[d]) {
        const path = `disciplines.${d}.sub.${s}`;
        const v = getAtPath(base, path) as number;
        const next = setAtPath(base, path, v >= 50 ? v - 35 : v + 35);
        if (runtimeKey(next) === reference) dead.push(path);
      }
    }
    expect(dead).toEqual([]);
  });

  // Each value is chosen to differ from the probe base's own (`isBase` flips).
  const CAREER: readonly [string, (d: CoreDisciplineId) => unknown][] = [
    ['years', () => 18],
    ['trainingQuality', () => 0.6],
    ['startAge', () => 8],
    ['hoursPerWeek', () => 25],
    ['sessionsPerWeek', () => 12],
    ['sparringIntensity', () => 95],
    ['monthsSinceTrained', () => 60],
    ['coachQuality', () => 95],
    ['isBase', (d) => !(base.disciplines[d]?.isBase ?? false)],
    ['grade', (d) => ({
      system: {
        boxing: 'boxingAmateur', muayThai: 'thaiRecord', kickboxing: 'thaiRecord', karate: 'karateDan',
        taekwondo: 'taekwondoDan', wrestling: 'wrestlingCredential', judo: 'judoKyuDan', bjj: 'bjjBelt',
        sambo: 'samboRank', mmaIntegration: 'none',
      }[d],
      rank: {
        boxing: 'box.olympian', muayThai: 'mt.worldTitle', kickboxing: 'mt.worldTitle', karate: 'kar.nationalSquad',
        taekwondo: 'tkd.nationalSquad', wrestling: 'wr.olympian', judo: 'judo.yondan', bjj: 'bjj.coral',
        sambo: 'sam.worldMedallist', mmaIntegration: 'none.unranked',
      }[d],
    })],
    ['competition', () => ({ level: 'international', bouts: 120, wins: 100, bestPlacing: 'worldMedal', medals: 4 })],
  ];

  for (const [field, value] of CAREER) {
    it(`disciplines.*.${field}`, () => {
      const dead: string[] = [];
      for (const d of Object.keys(SUB_SKILLS) as CoreDisciplineId[]) {
        // MMA integration has no grading system in the schema.
        if (field === 'grade' && d === 'mmaIntegration') continue;
        const next = setAtPath(base, `disciplines.${d}.${field}`, value(d));
        if (runtimeKey(next) === reference) dead.push(d);
      }
      expect(dead).toEqual([]);
    });
  }

  it('disciplines.*.specialisations', async () => {
    const { SPECIALISATIONS_BY_DISCIPLINE } = await import('../src/sim');
    const dead: string[] = [];
    for (const d of Object.keys(SUB_SKILLS) as CoreDisciplineId[]) {
      const spec = SPECIALISATIONS_BY_DISCIPLINE[d]?.[0];
      if (!spec) continue;
      const next = setAtPath(base, `disciplines.${d}.specialisations`, [spec.id]);
      if (runtimeKey(next) === reference) dead.push(d);
    }
    expect(dead).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. The "No effect on the bout" badges are true
// ---------------------------------------------------------------------------

describe('fields labelled "No effect on the bout" really have none', () => {
  const reference = digestOf(base);
  const CHANGES: Readonly<Record<string, (d: FighterDefinition) => FighterDefinition>> = {
    'body.build': (d) => setAtPath(d, 'body.build', { ecto: 0.05, meso: 0.25, endo: 0.7 }),
    appearance: (d) => setAtPath(setAtPath(d, 'appearance.skinTone', 0.95), 'appearance.nickname', 'The Test'),
    'style.tiredBehaviour': (d) => setAtPath(d, 'style.tiredBehaviour', d.style.tiredBehaviour === 'gamble' ? 'retreat' : 'gamble'),
    'style.thaiStyle': (d) => setAtPath(d, 'style.thaiStyle', 'muayKhao'),
    'style.topPriority': (d) => setAtPath(d, 'style.topPriority', ['submit', 'strike', 'pass', 'control']),
    'style.bottomPriority': (d) => setAtPath(d, 'style.bottomPriority', ['submit', 'sweep', 'standUp']),
    'style.pacing': (d) => setAtPath(d, 'style.pacing', [{ round: 1, outputMult: 1.5, riskAppetite: 2 }]),
    'style.stanceSwitching': (d) => setAtPath(d, 'style.stanceSwitching', 95),
    notes: (d) => setAtPath(d, 'notes', 'nothing in here is read'),
  };

  it('has a change for every listed path', () => {
    expect(NO_SIM_EFFECT_PATHS.map((r) => r.path).filter((p) => !CHANGES[p])).toEqual([]);
  });

  // Profile controls shown as "not read by the simulation" must be exactly
  // that. If one starts to matter, promote it to `live` and give it a probe.
  for (const p of PROFILE_PARAMS.filter((x) => x.status === 'presentation' && x.probe)) {
    it(`${p.label} (${p.id}, shown as not read) leaves the bout byte-identical`, () => {
      expect(digestOf(p.set(base, p.probe!.hi))).toBe(digestOf(p.set(base, p.probe!.lo)));
    }, 60_000);
  }

  for (const row of NO_SIM_EFFECT_PATHS) {
    it(`${row.path} leaves the bout byte-identical`, () => {
      const change = CHANGES[row.path];
      expect(change).toBeDefined();
      expect(digestOf(change(base))).toBe(reference);
    }, 60_000);
  }
});
