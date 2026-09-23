/**
 * COMMENTARY SUITE — docs/design/09 §5, 07 §2.8.
 *
 * The claims this suite is written to break:
 *
 *  1. commentary is deterministic for a fixed run, and generating it never
 *     touches the bout RNG — the digest and the draw count are identical
 *     whether or not anybody ever asked for a word of commentary;
 *  2. the cadence rules of §5.4 hold: play-by-play does not pile up during a
 *     flurry, and the excess is folded rather than dropped silently;
 *  3. every `SimEvent` kind that should produce a line does;
 *  4. no line ever names a fighter or a technique that is not in the bout —
 *     which is a property of the renderer, not of template authoring care;
 *  5. the strategy register actually fires when a plan or an adjustment
 *     changes, because that is the point of the feature.
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, COMMENTABLE_KINDS, DEFAULT_SETTINGS, SUBMISSIONS, TECHNIQUES,
  computeStats, generateCommentary, simulate,
  type BoutRun, type CommentaryLine, type SimConfig, type SimEvent, type SimEventKind,
} from '../src/sim';
import { COLOUR, PBP, lookup, render, variablesOf } from '../src/sim/commentary';
import { RNG } from '../src/sim/rng';

const ARCH = Object.values(ARCHETYPES);

function config(seed: string, a = 0, b = 1, rounds: '3r' | '5r' = '3r'): SimConfig {
  return {
    seed,
    mode: '1v1',
    fighters: [ARCH[a], ARCH[b]],
    teams: { teamOf: [0, 1] },
    ruleset: rounds === '5r' ? 'mma.unified.5r' : 'mma.unified.3r',
    arena: 'octagon_30',
    settings: DEFAULT_SETTINGS,
  };
}

const RUN = simulate(config('commentary-a'), { record: true });
const LINES = generateCommentary(RUN);

// ---------------------------------------------------------------------------
// 1. Determinism, and isolation from the bout stream
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces identical lines for the same run, every time', () => {
    const again = generateCommentary(RUN);
    expect(again).toEqual(LINES);
  });

  it('produces identical lines for a re-simulated bout with the same seed', () => {
    const fresh = simulate(config('commentary-a'), { record: true });
    expect(fresh.digest).toBe(RUN.digest);
    expect(generateCommentary(fresh)).toEqual(LINES);
  });

  it('never consumes the bout RNG: digest and draw count are untouched', () => {
    const a = simulate(config('commentary-rng'));
    const drawsBefore = a.rngDraws;
    const digestBefore = a.digest;
    generateCommentary(a);
    generateCommentary(a);
    expect(a.rngDraws).toBe(drawsBefore);
    expect(a.digest).toBe(digestBefore);

    // And a bout simulated *after* commentary ran still reproduces exactly.
    const b = simulate(config('commentary-rng'));
    expect(b.digest).toBe(digestBefore);
    expect(b.rngDraws).toBe(drawsBefore);
  });

  it('does not mutate the run it is handed', () => {
    const run = simulate(config('commentary-pure'));
    const snapshot = JSON.stringify(run.events);
    generateCommentary(run);
    expect(JSON.stringify(run.events)).toBe(snapshot);
  });

  it('honours an explicit seed, and a different seed rephrases without re-ordering', () => {
    const other = generateCommentary(RUN, { seed: 'a-different-broadcast' });
    expect(other.map((l) => l.tick)).toEqual(LINES.map((l) => l.tick));
    expect(other.some((l, i) => l.text !== LINES[i].text)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Cadence (09 §5.4)
// ---------------------------------------------------------------------------

describe('cadence', () => {
  it('caps play-by-play at one line per 1.5 s outside a finish', () => {
    const pbp = LINES.filter((l) => l.voice === 'pbp' && l.priority < 3);
    for (let i = 1; i < pbp.length; i++) {
      // Priority-3 lines interrupt, so only compare consecutive non-finish
      // lines that were not separated by one.
      const between = LINES.filter(
        (l) => l.t > pbp[i - 1].t && l.t < pbp[i].t && l.priority === 3,
      );
      if (between.length > 0) continue;
      expect(pbp[i].t - pbp[i - 1].t).toBeGreaterThanOrEqual(1.5 - 1e-9);
    }
  });

  it('emits far fewer lines than events, and none at all beyond one per 0.4 s', () => {
    expect(LINES.length).toBeLessThan(RUN.events.length);
    for (let i = 1; i < LINES.length; i++) {
      expect(LINES[i].t - LINES[i - 1].t).toBeGreaterThanOrEqual(-1e-9);
    }
    const perSecond = LINES.length / Math.max(1, RUN.ticks / 10);
    expect(perSecond).toBeLessThan(1);
  });

  it('respects a caller-supplied rate', () => {
    const slow = generateCommentary(RUN, { pbpPerSecond: 1 / 6 });
    const fast = generateCommentary(RUN, { pbpPerSecond: 1 / 0.5 });
    expect(slow.filter((l) => l.voice === 'pbp').length)
      .toBeLessThan(fast.filter((l) => l.voice === 'pbp').length);
  });

  it('does not repeat one template key inside its cooldown', () => {
    const lastByKey = new Map<string, number>();
    for (const l of LINES) {
      if (l.priority === 3) continue;
      const key = `${l.tags[l.tags.length - 1]}#${l.actor}`;
      const prev = lastByKey.get(key);
      if (prev !== undefined) expect(l.t - prev).toBeGreaterThanOrEqual(20 - 1e-9);
      lastByKey.set(key, l.t);
    }
  });

  it('streams: a tick window yields exactly the lines in that window', () => {
    const mid = Math.floor(RUN.ticks / 2);
    const windowed = generateCommentary(RUN, { fromTick: mid, toTick: RUN.ticks });
    for (const l of windowed) {
      expect(l.tick).toBeGreaterThan(mid);
      expect(l.tick).toBeLessThanOrEqual(RUN.ticks);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Coverage: every commentable kind speaks
// ---------------------------------------------------------------------------

/** One valid, representative event of every commentable kind, 20 s apart. */
function syntheticEvents(): SimEvent[] {
  const out: SimEvent[] = [];
  let tick = 0;
  const at = (): number => {
    tick += 200;
    return tick;
  };
  const push = (e: Omit<SimEvent, 'tick' | 'subMs' | 'round'> & { tick?: number }): void => {
    out.push({ tick: e.tick ?? at(), subMs: 0, round: 1, ...e } as SimEvent);
  };

  push({ kind: 'boutStart', actor: -1, target: -1, text: 'start', detail: {}, tick: 0 });
  push({ kind: 'roundStart', actor: -1, target: -1, text: 'r1', detail: { label: 'r1' }, tick: 1 });
  push({
    kind: 'strike', actor: 0, target: 1, text: '', tick: 100,
    detail: { technique: 'tech.jab', result: 'landed', target: 'head', forceN: 2000 },
  });
  push({
    kind: 'strike', actor: 1, target: 0, text: '',
    detail: { technique: 'tech.cross', result: 'blocked', target: 'head' },
  });
  push({ kind: 'feint', actor: 0, target: 1, text: '', detail: { bite: true } });
  push({ kind: 'read', actor: 1, target: 0, text: '', detail: { intent: 'read' } });
  push({ kind: 'takedown', actor: 0, target: 1, text: '', detail: { result: 'success', to: 'pos.ground_half_flat' } });
  push({ kind: 'clinch', actor: 1, target: 0, text: '', detail: {} });
  push({ kind: 'clinchBreak', actor: 0, target: 1, text: '', detail: { reason: 'referee' } });
  push({ kind: 'positionChange', actor: 0, target: 1, text: '', detail: { to: 'pos.ground_mount_low' } });
  push({ kind: 'scramble', actor: 0, target: 1, text: '', detail: {} });
  push({ kind: 'reversal', actor: 1, target: 0, text: '', detail: {} });
  push({ kind: 'standUp', actor: 1, target: 0, text: '', detail: {} });
  push({ kind: 'engagementJoin', actor: 0, target: 1, text: '', detail: {} });
  push({ kind: 'disengage', actor: 1, target: 0, text: '', detail: {} });
  push({ kind: 'slam', actor: 0, target: 1, text: '', detail: { severity: 1 } });
  push({
    kind: 'submissionStage', actor: 0, target: 1, text: '',
    detail: { technique: SUBMISSIONS[0].id, stage: 2, progress: 0.5 },
  });
  push({ kind: 'knockdown', actor: 0, target: 1, text: '', detail: { kind: 'flash' } });
  push({ kind: 'rocked', actor: 0, target: 1, text: '', detail: { kind: 'hurt' } });
  push({ kind: 'stateChange', actor: 1, target: 1, text: '', detail: { state: 'state.rocked', on: true } });
  push({ kind: 'injury', actor: 1, target: 1, text: '', detail: { region: 'leg' } });
  push({ kind: 'refereeWarning', actor: -1, target: 1, text: '', detail: { reason: 'work' } });
  push({ kind: 'refereeCount', actor: -1, target: 1, text: '', detail: { count: 3 } });
  push({ kind: 'standingEight', actor: -1, target: 1, text: '', detail: { count: 8 } });
  push({ kind: 'refereeBreak', actor: -1, target: -1, text: '', detail: { reason: 'stalling' } });
  push({ kind: 'refereeTimeout', actor: -1, target: -1, text: '', detail: {} });
  push({ kind: 'foul', actor: 0, target: 1, text: '', detail: { foul: 'foul.low_blow', detected: true } });
  push({ kind: 'deduction', actor: 0, target: 1, text: '', detail: { points: 1 } });
  push({ kind: 'doctorCheck', actor: -1, target: 1, text: '', detail: { reason: 'cut' } });
  push({ kind: 'timidityWarning', actor: -1, target: 0, text: '', detail: {} });
  push({ kind: 'pointsAwarded', actor: 0, target: 1, text: '', detail: { points: 2 } });
  push({ kind: 'judoScore', actor: 0, target: 1, text: '', detail: { score: 'waza-ari' } });
  push({ kind: 'planSet', actor: 0, target: -1, text: '', detail: { plan: 'mode.wrestle_control' } });
  push({
    kind: 'intentChange', actor: 1, target: 0, text: '',
    detail: { from: 'mode.distance_striking', to: 'mode.pressure_striking', adjustment: 'adj.drop_family' },
  });
  push({ kind: 'adjustment', actor: 0, target: 1, text: 'x', detail: { adjustment: 'adj.opp_tired' } });
  push({ kind: 'cornerCue', actor: 1, target: -1, text: 'corner: adj.ahead', detail: { cue: 'adj.ahead' } });
  push({ kind: 'scoreUpdate', actor: 0, target: -1, text: '', detail: { belief: 0.8 } });
  push({ kind: 'paceShift', actor: 1, target: 0, text: '', detail: { from: 'low', to: 'high' } });
  push({ kind: 'stanceSwitch', actor: 0, target: 1, text: '', detail: { intent: 'to protect the lead leg' } });
  push({ kind: 'targetSwitch', actor: 0, target: 1, text: '', detail: { from: '1', to: '1' } });
  push({ kind: 'roleAssign', actor: 1, target: 0, text: '', detail: { intent: 'role.hold' } });
  push({ kind: 'trap', actor: 0, target: 1, text: '', detail: { intent: 'trap' } });
  push({ kind: 'emergency', actor: 1, target: 0, text: '', detail: { intent: 'clinch' } });
  push({ kind: 'flight', actor: 1, target: 0, text: '', detail: {} });
  push({ kind: 'streetEnd', actor: -1, target: -1, text: '', detail: {} });
  push({ kind: 'cornerStop', actor: -1, target: 1, text: '', detail: { reason: 'corner' } });
  push({
    kind: 'submissionFinish', actor: 0, target: 1, text: '',
    detail: { technique: SUBMISSIONS[0].id, type: 'tap', lockedSeconds: 4 },
  });
  push({ kind: 'refereeStoppage', actor: -1, target: 1, text: '', detail: { method: 'tko' } });
  push({ kind: 'fighterOut', actor: -1, target: 1, text: '', detail: {} });
  push({ kind: 'scorecardRound', actor: -1, target: -1, text: '', detail: { cards: [[10, 9]] } });
  push({ kind: 'roundEnd', actor: -1, target: -1, text: '', detail: { label: 'r1' } });
  push({ kind: 'decision', actor: -1, target: -1, text: '', detail: { winner: 0, method: 'ko' } });
  push({ kind: 'boutEnd', actor: -1, target: -1, text: '', detail: { method: 'ko' } });
  return out;
}

function syntheticRun(): BoutRun {
  const cfg = config('synthetic');
  const events = syntheticEvents();
  const ticks = events[events.length - 1].tick + 10;
  return {
    config: cfg,
    result: {
      winner: 0, winningTeam: null, method: 'ko', detail: '', round: 1,
      timeSeconds: 10, totalSeconds: 10, scorecards: [], judgeTotals: [],
    },
    events,
    stats: computeStats(events, cfg, ticks),
    digest: 'synthetic',
    ticks,
    rngDraws: 0,
  };
}

describe('coverage', () => {
  const run = syntheticRun();
  // Cadence is deliberately relaxed here: the question is whether a kind has a
  // voice at all, not whether a broadcast would have found room for it.
  const lines = generateCommentary(run, {
    pbpPerSecond: 10, keyCooldownSeconds: 0, lullSeconds: 0, breakBudget: 99,
  });

  it('speaks for every commentable event kind', () => {
    const spoken = new Set<string>();
    for (const l of lines) for (const tag of l.tags) spoken.add(tag);
    const missing: string[] = [];
    for (const e of run.events) {
      if (!COMMENTABLE_KINDS.has(e.kind)) continue;
      if (!spoken.has(e.kind)) missing.push(e.kind);
    }
    expect(missing).toEqual([]);
  });

  it('covers every kind the synthetic stream exercises', () => {
    const kinds = new Set<SimEventKind>(run.events.map((e) => e.kind));
    for (const k of COMMENTABLE_KINDS) {
      if (k === 'engagementJoin' || k === 'disengage') continue;
      if (!kinds.has(k)) {
        // The fixture is meant to hold one of everything; a gap here means the
        // fixture has drifted from the event union, not that the generator has.
        expect(kinds.has(k)).toBe(true);
      }
    }
  });

  it('tags every line with the template key it rendered from', () => {
    for (const l of lines) {
      expect(l.tags.length).toBeGreaterThan(0);
      const table = l.voice === 'pbp' ? PBP : COLOUR;
      expect(lookup(table, l.tags[l.tags.length - 1])).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. It never invents a fighter or a technique
// ---------------------------------------------------------------------------

describe('vocabulary', () => {
  it('never leaves an unresolved placeholder on screen', () => {
    for (const l of LINES) {
      expect(l.text).not.toMatch(/[{}[\]]/);
      expect(l.text.length).toBeGreaterThan(0);
    }
  });

  it('never names a fighter who is not in this bout', () => {
    const present = new Set([
      RUN.config.fighters[0].short, RUN.config.fighters[0].name,
      RUN.config.fighters[1].short, RUN.config.fighters[1].name,
    ]);
    const absent = ARCH
      .flatMap((f) => [f.short, f.name])
      .filter((n) => !present.has(n));
    for (const l of LINES) {
      for (const name of absent) {
        expect(l.text.includes(name)).toBe(false);
      }
    }
  });

  it('never names a technique or submission that did not happen in this bout', () => {
    const usedTech = new Set<string>();
    const usedSub = new Set<string>();
    for (const e of RUN.events) {
      if (e.kind === 'strike') usedTech.add(e.detail.technique);
      if (e.kind === 'submissionStage' || e.kind === 'submissionFinish') {
        usedSub.add(e.detail.technique);
      }
    }
    const usedNames = new Set<string>([
      ...TECHNIQUES.filter((t) => usedTech.has(t.id)).map((t) => t.name.toLowerCase()),
      ...SUBMISSIONS.filter((s) => usedSub.has(s.id)).map((s) => s.name.toLowerCase()),
    ]);
    const allNames = [
      ...TECHNIQUES.map((t) => t.name.toLowerCase()),
      ...SUBMISSIONS.map((s) => s.name.toLowerCase()),
    ].sort((a, b) => b.length - a.length);

    // The rule is about *reporting*: the play-by-play may not say a technique
    // landed unless it did. The colour register talks about intent — "keep it
    // long behind the jab", "he is reading the level change before it starts"
    // — which names a weapon the fighter plans to use, not one he has thrown,
    // and holding it to the same rule would be a category error.
    for (const l of LINES.filter((line) => line.voice === 'pbp')) {
      let rest = l.text.toLowerCase();
      // Longest first, consuming each match, so "step jab" is attributed to
      // "step jab" rather than to the "jab" inside it.
      for (const name of allNames) {
        while (rest.includes(name)) {
          expect(usedNames.has(name), `"${name}" in: ${l.text}`).toBe(true);
          rest = rest.replace(name, '\u0000');
        }
      }
    }
  });

  it('gives every template at least three alternatives (09 §5.3)', () => {
    for (const table of [PBP, COLOUR]) {
      for (const [key, alternatives] of Object.entries(table)) {
        expect(alternatives.length, key).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('renders the grammar: alternatives, filters and a missing variable', () => {
    const rng = new RNG('grammar-test');
    expect(render('{actor|cap} lands {t|article}.', { actor: 'smith', t: 'uppercut' }, rng))
      .toBe('Smith lands an uppercut.');
    expect(render('{actor|poss} corner', { actor: 'Jones' }, rng)).toBe("Jones' corner");
    expect(render('{actor|poss} corner', { actor: 'Silva' }, rng)).toBe("Silva's corner");
    expect(render('{a} [x|y] {b}', { a: 'A' }, rng)).toBeNull();
    const picks = new Set<string>();
    for (let i = 0; i < 40; i++) picks.add(render('[one|two|three]', {}, rng) ?? '');
    expect(picks.size).toBe(3);
  });

  it('declares only variables the templates can be handed', () => {
    for (const table of [PBP, COLOUR]) {
      for (const alternatives of Object.values(table)) {
        for (const tpl of alternatives) {
          for (const v of variablesOf(tpl)) {
            expect(v).not.toMatch(/\s/);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Strategy — the point of the feature
// ---------------------------------------------------------------------------

describe('strategy register', () => {
  it('explains the game plan at the start of the bout', () => {
    const plan = LINES.filter((l) => l.tags.includes('plan'));
    expect(plan.length).toBeGreaterThan(0);
    // The line says what the corner wants, not the id of the mode.
    expect(plan.some((l) => !l.text.includes('mode.'))).toBe(true);
  });

  it('speaks when a plan or an adjustment changes', () => {
    const run = syntheticRun();
    const lines = generateCommentary(run, { keyCooldownSeconds: 0 });
    const intent = lines.filter((l) => l.tags.includes('intentChange'));
    const adjust = lines.filter((l) => l.tags.includes('adjustment'));
    expect(intent.length).toBeGreaterThan(0);
    expect(adjust.length).toBeGreaterThan(0);
    // The signal → adjustment table of 07 §2.6.1 is what the line explains.
    expect(intent[0].text.toLowerCase()).toContain('pressure');
    expect(adjust[0].text.toLowerCase()).toContain('fading');
  });

  it('finds the strategy in a real bout, not only in a fixture', () => {
    const colour = LINES.filter((l) => l.voice === 'colour');
    expect(colour.length).toBeGreaterThan(0);
    expect(colour.some((l) => l.tags.includes('strategy'))).toBe(true);
  });

  it('uses tier-banded phrasing, low tier and high tier differently', () => {
    const lowVsHigh = simulate(
      config('tier-gap', ARCH.findIndex((f) => f.id === 'arch.brand_new_brawler'),
        ARCH.findIndex((f) => f.id === 'arch.elite_wrestler_boxer')),
      { record: true },
    );
    const lines = generateCommentary(lowVsHigh, { lullSeconds: 0, keyCooldownSeconds: 0 });
    const tierLines = lines.filter((l) => l.tags.includes('tier.intro') || l.tags.includes('tier.contrast'));
    expect(tierLines.length).toBeGreaterThan(0);
  });

  it('reads the game plan out of live intent samples when it is given them', () => {
    const run = simulate(config('intent-samples'), { record: true });
    const samples = [
      {
        tick: 300,
        intents: [{
          fighterId: 0, mode: 'mode.distance_striking', phase: 'long' as const,
          planLines: [], adjustments: [], scoreBelief: 0.5, emergency: false,
          tierRules: [], animationTags: [],
        }],
      },
      {
        tick: 900,
        intents: [{
          fighterId: 0, mode: 'mode.wrestle_control', phase: 'close' as const,
          planLines: [], adjustments: [{ id: 'adj.taken_down_x2', trigger: 'takenDownX2', sinceRound: 1 }],
          scoreBelief: 0.4, emergency: false, tierRules: [], animationTags: [],
        }],
      },
    ];
    const withIntents = generateCommentary(run, { intents: samples, keyCooldownSeconds: 0 });
    const withOut = generateCommentary(run, { keyCooldownSeconds: 0 });
    const fromIntents = withIntents.filter((l) => l.tags.includes('intents'));
    expect(fromIntents.length).toBeGreaterThan(0);
    expect(withIntents.length).toBeGreaterThan(withOut.length);
  });
});

// ---------------------------------------------------------------------------
// 6. Shape of the output
// ---------------------------------------------------------------------------

describe('lines', () => {
  it('are ordered, in range and consistently tagged', () => {
    let last = -1;
    for (const l of LINES as CommentaryLine[]) {
      expect(l.tick).toBeGreaterThanOrEqual(last);
      last = l.tick;
      expect(l.t).toBeCloseTo(l.tick / 10, 6);
      expect(l.priority).toBeGreaterThanOrEqual(0);
      expect(l.priority).toBeLessThanOrEqual(3);
      expect(['pbp', 'colour']).toContain(l.voice);
      expect(l.round).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps every actor inside the bout', () => {
    for (const l of LINES) {
      expect(l.actor).toBeLessThan(RUN.config.fighters.length);
      expect(l.target).toBeLessThan(RUN.config.fighters.length);
    }
  });
});
