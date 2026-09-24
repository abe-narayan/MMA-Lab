/**
 * UI PASS 2 (docs/design/UI_PASS.md, "UI pass 2").
 *
 *  - Code splitting: the first-load module graph (static imports from
 *    src/main.tsx) never reaches three.js, the presenter or the Watch screen.
 *  - Debug switches (audit H3): one gate, development or `?capture=1`, and the
 *    capture scripts' URL helper adds the flag.
 *  - Per-frame cost (audit H4): the Watch event window is cached per frame.
 *  - Match setup and Tournaments: numbered steps, sensible defaults, inline
 *    validation.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ARCHETYPES, type SimEvent, type TickSnapshot } from '../src/sim';
import { switchesEnabled } from '../src/presentation/devFlags';
import { withCapture } from '../scripts/dev/capture-url.mjs';
import { EventIndex } from '../src/app/replay/broadcast';
import { MatchSetup } from '../src/app/screens/MatchSetup';
import { Tournaments } from '../src/app/screens/Tournaments';
import { memoryMatchStore } from '../src/app/run/matchStore';
import { defaultDraft, type MatchDraft } from '../src/app/model/matchModel';
import { blankFighter, makeRecord, validateFighter } from '../src/app/store';
import type { FighterStoreApi } from '../src/app/storeApi';

const ROOT = resolve(__dirname, '..');

// --------------------------------------------------------------------------
// First-load graph
// --------------------------------------------------------------------------

/** Static, value-level imports of one source file (type-only and dynamic imports excluded). */
function staticImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /^(?:import|export)\s+(?!type\b)([^;]*?)\s*from\s*'([^']+)'|^import\s+'([^']+)'/gms;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const spec = m[2] ?? m[3];
    // `import { type A, type B } from` is type-only too.
    if (m[1] && /^\{[^}]*\}$/s.test(m[1].trim()) && m[1].replace(/[{}\s]/g, '').split(',').filter(Boolean).every((n) => n.startsWith('type'))) continue;
    out.push(spec);
  }
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && !c.endsWith('.css') && /\.(ts|tsx)$/.test(c)) return c;
  }
  return null;
}

function firstLoadGraph(): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [join(ROOT, 'src/main.tsx')];
  while (queue.length) {
    const f = queue.pop() as string;
    if (files.has(f)) continue;
    files.add(f);
    for (const spec of staticImports(f)) {
      if (spec.endsWith('.css')) continue;
      const local = resolveLocal(f, spec);
      if (local) queue.push(local);
      else if (!spec.startsWith('.')) packages.add(spec);
    }
  }
  return { files, packages };
}

describe('code splitting: the first screen', () => {
  const graph = firstLoadGraph();
  const rel = [...graph.files].map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'));

  it('never statically reaches three.js', () => {
    expect([...graph.packages].filter((p) => p === 'three' || p.startsWith('three/'))).toEqual([]);
  });

  it('does not load the presenter, the 3D stage, Watch or the other heavy screens', () => {
    for (const heavy of [
      'src/presentation/presenter.ts', 'src/presentation/stage/index.ts', 'src/app/components/Arena3D.tsx',
      'src/app/screens/Watch.tsx', 'src/app/screens/BatchSim.tsx', 'src/app/screens/About.tsx',
      'src/app/screens/FighterCreator.tsx', 'src/app/screens/Tournaments.tsx', 'src/app/screens/History.tsx',
    ]) {
      expect(rel).not.toContain(heavy);
    }
  });

  it('keeps Match setup and the simulation available', () => {
    expect(rel).toContain('src/app/screens/MatchSetup.tsx');
    expect(rel).toContain('src/sim/index.ts');
  });

  it('the Watch screen itself loads the 3D view lazily', () => {
    const watch = staticImports(join(ROOT, 'src/app/screens/Watch.tsx'));
    expect(watch.some((s) => s.endsWith('components/Arena3D'))).toBe(false);
    expect(watch.some((s) => s.endsWith('presentation/stage/index'))).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Debug switches
// --------------------------------------------------------------------------

describe('debug and capture switches (audit H3)', () => {
  it('are on in development and off in production unless ?capture=1', () => {
    expect(switchesEnabled(true, '')).toBe(true);
    expect(switchesEnabled(false, '?quality=ultra&backend=webgl2')).toBe(false);
    expect(switchesEnabled(undefined, '?watchDemo=1')).toBe(false);
    expect(switchesEnabled(false, '?watchDemo=1&capture=1')).toBe(true);
    expect(switchesEnabled(false, '?capture=0')).toBe(false);
  });

  it('the capture scripts add the flag once, before any hash', () => {
    expect(withCapture('http://x/')).toBe('http://x/?capture=1');
    expect(withCapture('http://x/?watchDemo=1')).toBe('http://x/?watchDemo=1&capture=1');
    expect(withCapture('http://x/?capture=1&a=2')).toBe('http://x/?capture=1&a=2');
    expect(withCapture('http://x/?a=1#h')).toBe('http://x/?a=1&capture=1#h');
  });

  it('no source file reads the query string or writes a QA global except through the gate', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(name) || name === 'devFlags.ts') continue;
        const code = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        if (/URLSearchParams\(\s*location\.search\s*\)/.test(code)) offenders.push(`${p}: location.search`);
        if (/\(window as unknown as \{ __\w+\??: [^}]*\}\)\.__\w+\s*=/.test(code)) {
          // The presenter's __stats is published behind an early return on the gate.
          const gated = /if \(typeof window === 'undefined' \|\| !DEV_SWITCHES\) return;/.test(code);
          if (!gated) offenders.push(`${p}: window global`);
        }
      }
    };
    walk(join(ROOT, 'src/app'));
    walk(join(ROOT, 'src/presentation'));
    expect(offenders).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Per-frame cost
// --------------------------------------------------------------------------

describe('per-frame cost (audit H4)', () => {
  it('the event window for a frame is computed once and reused until the frame changes', () => {
    const events = Array.from({ length: 50 }, (_, i) => ({ kind: 'strike', tick: i * 3 })) as unknown as SimEvent[];
    const idx = new EventIndex(events);
    const f = (tick: number) => ({ tick }) as unknown as TickSnapshot;
    const a = idx.forFrame(f(60), f(61));
    const b = idx.forFrame(f(60), f(61));
    expect(b).toBe(a);
    const c = idx.forFrame(f(63), f(64));
    expect(c).not.toBe(a);
    expect(c.every((e) => e.tick > 63 - 20 && e.tick <= 64)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Match setup and Tournaments
// --------------------------------------------------------------------------

function storeWith(ids?: string[]): FighterStoreApi {
  const defs = Object.values(ARCHETYPES).filter((d) => !ids || ids.includes(d.id));
  const records = defs.map((d) => makeRecord(d, { builtIn: true }));
  return {
    list: () => records, get: (id: string) => records.find((r) => r.definition.id === id),
    validate: validateFighter, blank: blankFighter,
  } as unknown as FighterStoreApi;
}

function setup(draft: MatchDraft, store = storeWith()): string {
  return renderToStaticMarkup(
    <MatchSetup store={store} matchStore={memoryMatchStore()} revision={0}
      draft={draft} onDraftChange={() => undefined} onRan={() => undefined} />,
  );
}

const PAIR = ['arch.regional_pro_allrounder', 'arch.thai_striker'];

describe('Match setup', () => {
  it('reads as four numbered steps: fighters, rules, options, run', () => {
    const html = setup({ ...defaultDraft('s'), slots: [...PAIR] });
    const titles = [...html.matchAll(/class="ui-step-title"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(titles).toEqual(['Fighters', 'Rules', 'Options', 'Run']);
  });

  it('with two fighters picked, everything else defaults and Run is enabled', () => {
    const html = setup({ ...defaultDraft('s'), slots: [...PAIR] });
    const runs = [...html.matchAll(/<button[^>]*>(?:(?!<\/button>).)*Run bout<\/button>/gs)].map((m) => m[0]);
    expect(runs.length).toBeGreaterThan(0);
    for (const b of runs) expect(b).not.toMatch(/disabled/);
    expect(html).toContain('Ready');
    expect(html).not.toContain('ui-field-error');
  });

  it('keeps advanced settings closed and says whether any differ from the defaults', () => {
    const html = setup({ ...defaultDraft('s'), slots: [...PAIR] });
    expect(html).toMatch(/<details class="ui-disclosure">/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain('Ruleset defaults');
    const changed = setup({ ...defaultDraft('s'), slots: [...PAIR], settings: { ...defaultDraft('s').settings, refereeStrictness: 'strict', rounds: 5 } });
    expect(changed).toContain('1 changed');
  });

  it('shows validation inline at the field: empty slot, repeated fighter, empty seed', () => {
    const empty = setup({ ...defaultDraft('s'), slots: [PAIR[0], null] });
    expect(empty).toMatch(/id="ms-slot-1-err"[^>]*>Pick a fighter\./);
    const dup = setup({ ...defaultDraft('s'), slots: [PAIR[0], PAIR[0]] });
    expect(dup).toMatch(/id="ms-slot-1-err"[^>]*>Already fighting as Red corner/);
    const noSeed = setup({ ...defaultDraft(''), slots: [...PAIR] });
    expect(noSeed).toMatch(/id="ms-seed-err"/);
    for (const html of [empty, dup, noSeed]) {
      const header = html.slice(html.indexOf('page-actions'), html.indexOf('</header>'));
      expect(header).toMatch(/disabled/);
    }
  });

  it('help is a tooltip beside the label, not a paragraph under every field', () => {
    const html = setup({ ...defaultDraft('s'), slots: [...PAIR] });
    expect((html.match(/class="ui-info"/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(html).not.toContain('fc-help');
  });
});

describe('Tournaments', () => {
  const render = (): string => renderToStaticMarkup(
    <Tournaments store={storeWith()} matchStore={memoryMatchStore()} revision={0} onChanged={() => undefined} onRan={() => undefined} />,
  );

  it('opens the builder as numbered steps when there are no tournaments', () => {
    const html = render();
    const titles = [...html.matchAll(/class="ui-step-title"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(titles).toEqual(['Format', 'Entrants', 'Rules', 'Create']);
  });

  it('explains why Create is unavailable, inline', () => {
    const html = render();
    expect(html).toMatch(/id="tr-entrants-err"[^>]*>Pick at least two entrants\./);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Create bracket/s);
  });
});
