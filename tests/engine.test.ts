/**
 * ENGINE INVARIANT SUITE
 *
 * These tests do not check that the model is *right* - nothing in this project
 * is fitted to real data and no test could establish that. They check that the
 * state machine is *well formed*: that it always terminates, that it never
 * emits a state the renderer or the analytics layer could not interpret, and
 * that its bookkeeping is self-consistent.
 *
 * Strategy: simulate a fixed corpus of bouts once (every format, 1v1 through
 * 1v5, with fixed seeds so failures are reproducible) and then assert each
 * invariant across every frame and every event of that corpus. The corpus is
 * deliberately small enough to keep the suite fast, and every bout is recorded
 * frame-by-frame, so the assertions see the real state stream rather than a
 * summary of it.
 *
 * The grappling-pair tests near the end of this file began life as `it.fails`
 * markers recording a real engine defect: grapple and clinch relationships were
 * per-fighter flags with nothing forcing the two ends to agree, so a third
 * attacker could leave a displaced partner flagged "top" with nobody underneath,
 * and a clinch break or a referee stoppage could leave the flags set on a
 * standing fighter. The engine now enforces the invariant, so they are ordinary
 * regression tests asserted across every format. scripts/consistency.ts runs the
 * same check over a much larger corpus.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { BoutSimulation } from '../src/engine/engine';
import { boutSeed } from '../src/engine/recorder';
import { DEFAULT_PARAMS as P } from '../src/engine/params';
import { ACTIONS } from '../src/engine/actions';
import { ATHLETE_A, ATHLETE_B, deriveAttributes } from '../src/engine/fighter';
import type { BoutEvent, BoutResult, TickSnapshot } from '../src/engine/types';

const FORMATS = [1, 2, 3, 4, 5] as const;
const BOUTS_PER_FORMAT = 6;
const MASTER = 'engine-invariants';

interface Run {
  opponents: number;
  index: number;
  label: string;
  frames: TickSnapshot[];
  events: BoutEvent[];
  result: BoutResult;
  ticks: number;
  finished: boolean;
}

const CORPUS: Run[] = [];

/** The absolute stamina ceiling for each fighter id, derived the same way the engine derives it. */
const STAMINA_MAX = {
  a: deriveAttributes(ATHLETE_A, P).staminaMax,
  b: deriveAttributes(ATHLETE_B, P).staminaMax,
};
const staminaMaxFor = (id: number) => (id === 0 ? STAMINA_MAX.a : STAMINA_MAX.b);

const ACTION_KINDS = new Set(Object.keys(ACTIONS));
const DEFENSE_KINDS = new Set(['neutral', 'highGuard', 'slip', 'parry', 'sprawl', 'frame', 'subDefend']);
const POSTURES = new Set(['standing', 'clinch', 'ground', 'down']);
const GROUND_POSITIONS = new Set(['none', 'guard', 'half', 'side', 'mount', 'back']);
const GROUND_ROLES = new Set(['none', 'top', 'bottom']);
const RESULTS = new Set(['none', 'landed', 'blocked', 'evaded', 'missed']);
const EVENT_KINDS = new Set([
  'boutStart', 'roundStart', 'roundEnd', 'boutEnd', 'strike', 'takedown', 'clinch',
  'clinchBreak', 'positionChange', 'submissionAttempt', 'submissionFinish',
  'knockdown', 'standUp', 'refereeStoppage', 'fighterOut', 'decision',
]);

/** The theoretical maximum length of a bout: every round plus every break. */
const MAX_TICKS = (P.rounds * P.roundSeconds + (P.rounds - 1) * P.breakSeconds) / P.dt;

beforeAll(() => {
  for (const opponents of FORMATS) {
    for (let index = 1; index <= BOUTS_PER_FORMAT; index++) {
      const sim = new BoutSimulation({ seed: boutSeed(MASTER, opponents, index), opponents });
      const frames = sim.runRecorded();
      CORPUS.push({
        opponents, index, label: `1v${opponents} #${index}`,
        frames, events: sim.events, result: sim.result!, ticks: sim.tick, finished: sim.finished,
      });
    }
  }
});

/** Runs a per-frame predicate over the whole corpus and reports the first failure with context. */
function eachFrame(fn: (frame: TickSnapshot, run: Run, prev: TickSnapshot | null) => string | null): void {
  const failures: string[] = [];
  for (const run of CORPUS) {
    for (let i = 0; i < run.frames.length; i++) {
      const msg = fn(run.frames[i], run, i > 0 ? run.frames[i - 1] : null);
      if (msg) {
        failures.push(`${run.label} tick ${run.frames[i].tick}: ${msg}`);
        if (failures.length >= 5) break;
      }
    }
    if (failures.length >= 5) break;
  }
  expect(failures, failures.join('\n')).toEqual([]);
}

describe('corpus construction', () => {
  it('covers every format from 1v1 to 1v5', () => {
    expect(CORPUS.length).toBe(FORMATS.length * BOUTS_PER_FORMAT);
    expect(new Set(CORPUS.map((r) => r.opponents))).toEqual(new Set(FORMATS));
  });

  it('gives each bout the right number of fighters with contiguous ids', () => {
    eachFrame((frame, run) => {
      if (frame.fighters.length !== run.opponents + 1) return `expected ${run.opponents + 1} fighters, got ${frame.fighters.length}`;
      for (let i = 0; i < frame.fighters.length; i++) {
        if (frame.fighters[i].id !== i) return `fighter at slot ${i} has id ${frame.fighters[i].id}`;
      }
      return null;
    });
  });
});

describe('termination', () => {
  it('every bout finishes and produces exactly one result', () => {
    for (const run of CORPUS) {
      expect(run.finished, `${run.label} did not finish`).toBe(true);
      expect(run.result, `${run.label} has no result`).toBeTruthy();
      expect(['A', 'B', 'draw']).toContain(run.result.winner);
      expect(typeof run.result.method).toBe('string');
      expect(run.result.method.length).toBeGreaterThan(0);
    }
  });

  it('emits exactly one boutStart and exactly one boutEnd per bout', () => {
    for (const run of CORPUS) {
      expect(run.events.filter((e) => e.kind === 'boutStart').length, run.label).toBe(1);
      expect(run.events.filter((e) => e.kind === 'boutEnd').length, run.label).toBe(1);
      expect(run.events[0].kind).toBe('boutStart');
      expect(run.events[run.events.length - 1].kind).toBe('boutEnd');
    }
  });

  it('never exceeds the maximum possible bout length', () => {
    for (const run of CORPUS) {
      expect(run.ticks, run.label).toBeGreaterThan(0);
      expect(run.ticks, run.label).toBeLessThanOrEqual(MAX_TICKS);
      // The recorder writes one frame for the opening state plus one per tick.
      expect(run.frames.length).toBe(run.ticks + 1);
    }
  });

  it('ends in the "ended" phase and stays there', () => {
    for (const run of CORPUS) {
      const last = run.frames[run.frames.length - 1];
      expect(last.phase, run.label).toBe('ended');
    }
  });

  it('never goes past the scheduled number of rounds', () => {
    for (const run of CORPUS) {
      expect(run.result.round, run.label).toBeGreaterThanOrEqual(1);
      expect(run.result.round, run.label).toBeLessThanOrEqual(P.rounds);
      expect(run.result.timeSeconds).toBeGreaterThanOrEqual(0);
      expect(run.result.timeSeconds).toBeLessThanOrEqual(P.roundSeconds);
    }
    eachFrame((frame) =>
      frame.round >= 1 && frame.round <= P.rounds ? null : `round ${frame.round} out of range`
    );
  });

  it('never rewinds the round counter or the clock', () => {
    eachFrame((frame, _run, prev) => {
      if (!prev) return null;
      if (frame.round < prev.round) return `round went ${prev.round} -> ${frame.round}`;
      if (frame.tick !== prev.tick + 1) return `tick jumped ${prev.tick} -> ${frame.tick}`;
      if (frame.t < prev.t) return `clock went backwards ${prev.t} -> ${frame.t}`;
      return null;
    });
  });
});

describe('fighter state bounds', () => {
  it('keeps stamina inside [0, staminaMax] for every fighter on every tick', () => {
    eachFrame((frame) => {
      for (const f of frame.fighters) {
        const max = staminaMaxFor(f.id);
        if (f.stamina < 0) return `fighter ${f.id} stamina ${f.stamina} < 0`;
        if (f.stamina > max + 1e-6) return `fighter ${f.id} stamina ${f.stamina} > max ${max}`;
      }
      return null;
    });
  });

  it('keeps balance inside [0, balanceMax]', () => {
    eachFrame((frame) => {
      for (const f of frame.fighters) {
        if (f.balance < 0) return `fighter ${f.id} balance ${f.balance} < 0`;
        if (f.balance > P.balanceMax + 1e-6) return `fighter ${f.id} balance ${f.balance} > ${P.balanceMax}`;
      }
      return null;
    });
  });

  it('keeps damage non-negative and actionPhase / subProgress in range', () => {
    eachFrame((frame) => {
      for (const f of frame.fighters) {
        if (f.damage < 0) return `fighter ${f.id} damage ${f.damage} < 0`;
        if (!Number.isFinite(f.damage)) return `fighter ${f.id} damage is not finite`;
        if (f.actionPhase < 0 || f.actionPhase > 1) return `fighter ${f.id} actionPhase ${f.actionPhase}`;
        if (f.subProgress < 0 || f.subProgress > 1.2 + 1e-6) return `fighter ${f.id} subProgress ${f.subProgress}`;
      }
      return null;
    });
  });

  it('never lets the damage index fall inside a round', () => {
    // Damage is only ever reduced by the between-rounds recovery term, which is
    // applied at the instant a new round starts. Inside a live round it must be
    // monotonically non-decreasing, otherwise the analytics damage trajectory is
    // not a cumulative quantity.
    eachFrame((frame, _run, prev) => {
      if (!prev) return null;
      if (prev.phase !== 'round' || frame.phase !== 'round') return null;
      if (prev.round !== frame.round) return null;
      for (let i = 0; i < frame.fighters.length; i++) {
        const before = prev.fighters[i].damage, after = frame.fighters[i].damage;
        if (after < before - 1e-9) return `fighter ${i} damage fell ${before} -> ${after} inside round ${frame.round}`;
      }
      return null;
    });
  });

  it('never decrements the significant-strike tallies, and landed never exceeds attempted', () => {
    eachFrame((frame, _run, prev) => {
      for (const f of frame.fighters) {
        if (f.sigLanded > f.sigAttempted) return `fighter ${f.id} landed ${f.sigLanded} > attempted ${f.sigAttempted}`;
      }
      if (!prev) return null;
      for (let i = 0; i < frame.fighters.length; i++) {
        if (frame.fighters[i].sigLanded < prev.fighters[i].sigLanded) return `fighter ${i} sigLanded decreased`;
        if (frame.fighters[i].sigAttempted < prev.fighters[i].sigAttempted) return `fighter ${i} sigAttempted decreased`;
      }
      return null;
    });
  });

  it('never brings a fighter back once the referee has pulled them out', () => {
    eachFrame((frame, _run, prev) => {
      if (!prev) return null;
      for (let i = 0; i < frame.fighters.length; i++) {
        if (prev.fighters[i].out && !frame.fighters[i].out) return `fighter ${i} was reinstated after being waved out`;
      }
      return null;
    });
  });
});

describe('cage geometry', () => {
  it('never places a fighter outside the cage', () => {
    eachFrame((frame) => {
      for (const f of frame.fighters) {
        const r = Math.hypot(f.x, f.z);
        if (!Number.isFinite(r)) return `fighter ${f.id} has a non-finite position`;
        if (r > P.cageRadius) return `fighter ${f.id} is ${r.toFixed(3)} m out, cage radius is ${P.cageRadius}`;
      }
      return null;
    });
  });

  it('keeps facing angles finite and within +/- 2pi', () => {
    eachFrame((frame) => {
      for (const f of frame.fighters) {
        if (!Number.isFinite(f.facing)) return `fighter ${f.id} facing is not finite`;
        if (Math.abs(f.facing) > 2 * Math.PI + 1e-6) return `fighter ${f.id} facing ${f.facing} out of range`;
      }
      return null;
    });
  });

  it('never lets two upright fighters occupy the same point', () => {
    eachFrame((frame) => {
      const live = frame.fighters.filter((f) => !f.out && f.posture !== 'ground' && f.posture !== 'down');
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const d = Math.hypot(live[i].x - live[j].x, live[i].z - live[j].z);
          if (d < 0.2) return `fighters ${live[i].id} and ${live[j].id} are ${d.toFixed(3)} m apart`;
        }
      }
      return null;
    });
  });
});

describe('action catalogue', () => {
  it('never emits an action outside the catalogue', () => {
    eachFrame((frame) => {
      for (const f of frame.fighters) {
        if (!ACTION_KINDS.has(f.action)) return `fighter ${f.id} is doing "${f.action}", which is not in ACTIONS`;
      }
      return null;
    });
  });

  it('never emits a defensive state, posture, ground role or result outside its enum', () => {
    eachFrame((frame) => {
      for (const f of frame.fighters) {
        if (!DEFENSE_KINDS.has(f.defense)) return `fighter ${f.id} defense "${f.defense}"`;
        if (!POSTURES.has(f.posture)) return `fighter ${f.id} posture "${f.posture}"`;
        if (!GROUND_ROLES.has(f.groundRole)) return `fighter ${f.id} groundRole "${f.groundRole}"`;
        if (!GROUND_POSITIONS.has(f.groundPosition)) return `fighter ${f.id} groundPosition "${f.groundPosition}"`;
        if (!RESULTS.has(f.actionResult)) return `fighter ${f.id} actionResult "${f.actionResult}"`;
      }
      return null;
    });
  });

  it('exercises a broad slice of the catalogue rather than one or two actions', () => {
    // A corpus that only ever produced `idle` would pass every test above.
    const seen = new Set<string>();
    for (const run of CORPUS) for (const frame of run.frames) for (const f of frame.fighters) seen.add(f.action);
    expect(seen.size).toBeGreaterThanOrEqual(12);
    for (const required of ['jab', 'cross', 'hook', 'clinchEntry', 'shoot', 'advance', 'retreat', 'circle', 'idle']) {
      expect(seen, `corpus never produced "${required}"`).toContain(required);
    }
  });

  it('marks down === (posture is down) consistently', () => {
    eachFrame((frame) => {
      for (const f of frame.fighters) {
        if (f.down !== (f.posture === 'down')) return `fighter ${f.id} down=${f.down} but posture=${f.posture}`;
      }
      return null;
    });
  });
});

describe('event log', () => {
  it('places every event on a tick that exists inside the bout', () => {
    const bad: string[] = [];
    for (const run of CORPUS) {
      for (const e of run.events) {
        if (e.tick < 0 || e.tick > run.ticks) bad.push(`${run.label}: ${e.kind} at tick ${e.tick}, bout is ${run.ticks} ticks`);
        if (run.frames[e.tick] === undefined) bad.push(`${run.label}: ${e.kind} at tick ${e.tick} has no frame`);
      }
    }
    expect(bad.slice(0, 5), bad.slice(0, 5).join('\n')).toEqual([]);
  });

  it('orders events by tick and keeps the timestamp consistent with the tick', () => {
    const bad: string[] = [];
    for (const run of CORPUS) {
      let last = -1;
      for (const e of run.events) {
        if (e.tick < last) bad.push(`${run.label}: ${e.kind} at tick ${e.tick} follows tick ${last}`);
        last = e.tick;
        if (Math.abs(e.t - e.tick * P.dt) > 0.06) bad.push(`${run.label}: ${e.kind} t=${e.t} but tick=${e.tick}`);
      }
    }
    expect(bad.slice(0, 5), bad.slice(0, 5).join('\n')).toEqual([]);
  });

  it('uses only declared event kinds, rounds and results', () => {
    const ok = new Set(['landed', 'blocked', 'evaded', 'missed', 'success', 'stuffed']);
    const bad: string[] = [];
    for (const run of CORPUS) {
      for (const e of run.events) {
        if (!EVENT_KINDS.has(e.kind)) bad.push(`${run.label}: unknown kind "${e.kind}"`);
        if (e.round < 1 || e.round > P.rounds) bad.push(`${run.label}: ${e.kind} in round ${e.round}`);
        if (e.result !== undefined && !ok.has(e.result)) bad.push(`${run.label}: ${e.kind} result "${e.result}"`);
        if (typeof e.text !== 'string' || e.text.length === 0) bad.push(`${run.label}: ${e.kind} has no text`);
      }
    }
    expect(bad.slice(0, 5), bad.slice(0, 5).join('\n')).toEqual([]);
  });

  it('addresses only fighters that exist (or -1 for the referee)', () => {
    const bad: string[] = [];
    for (const run of CORPUS) {
      for (const e of run.events) {
        if (e.actor < -1 || e.actor > run.opponents) bad.push(`${run.label}: ${e.kind} actor ${e.actor}`);
        if (e.target < -1 || e.target > run.opponents) bad.push(`${run.label}: ${e.kind} target ${e.target}`);
      }
    }
    expect(bad.slice(0, 5), bad.slice(0, 5).join('\n')).toEqual([]);
  });

  it('opens each round exactly once and never announces a round it did not reach', () => {
    for (const run of CORPUS) {
      const starts = run.events.filter((e) => e.kind === 'roundStart').map((e) => e.detail);
      expect(new Set(starts).size, run.label).toBe(starts.length);
      expect(starts.length, run.label).toBe(run.result.round);
      expect(starts[0]).toBe('r1');
    }
  });

  it('agrees with the frame stream about when a fighter was pulled out', () => {
    for (const run of CORPUS) {
      for (const e of run.events.filter((x) => x.kind === 'fighterOut')) {
        const frame = run.frames[e.tick];
        expect(frame, `${run.label} fighterOut at tick ${e.tick} has no frame`).toBeTruthy();
        expect(frame.fighters[e.target].out, `${run.label} fighter ${e.target} not flagged out at tick ${e.tick}`).toBe(true);
      }
    }
  });
});

describe('posture pairing', () => {
  /** Frames in which the set of ground fighters does not decompose into top/bottom pairs. */
  const unpairedGroundFrames = (runs: Run[]): string[] => {
    const bad: string[] = [];
    for (const run of runs) {
      for (const frame of run.frames) {
        const tops = frame.fighters.filter((f) => f.posture === 'ground' && f.groundRole === 'top').length;
        const bottoms = frame.fighters.filter((f) => f.posture === 'ground' && f.groundRole === 'bottom').length;
        if (tops !== bottoms) bad.push(`${run.label} tick ${frame.tick}: ${tops} top / ${bottoms} bottom`);
      }
    }
    return bad;
  };

  /** Frames in which an odd number of fighters are in the clinch, i.e. someone is clinching nobody. */
  const unpairedClinchFrames = (runs: Run[]): string[] => {
    const bad: string[] = [];
    for (const run of runs) {
      for (const frame of run.frames) {
        const n = frame.fighters.filter((f) => f.posture === 'clinch').length;
        if (n % 2 !== 0) bad.push(`${run.label} tick ${frame.tick}: ${n} fighters in the clinch`);
      }
    }
    return bad;
  };

  it('always assigns a role and a position to a grounded fighter', () => {
    eachFrame((frame) => {
      for (const f of frame.fighters) {
        if (f.posture === 'ground') {
          if (f.groundRole === 'none') return `fighter ${f.id} is on the ground with no role`;
          if (f.groundPosition === 'none') return `fighter ${f.id} is on the ground with no position`;
        }
      }
      return null;
    });
  });

  it('pairs every top with a bottom in one-on-one and 1v2 bouts', () => {
    const runs = CORPUS.filter((r) => r.opponents <= 2);
    expect(runs.length).toBeGreaterThan(0);
    const bad = unpairedGroundFrames(runs);
    expect(bad.slice(0, 5), bad.slice(0, 5).join('\n')).toEqual([]);
  });

  it('keeps the clinch pairwise in one-on-one bouts', () => {
    const runs = CORPUS.filter((r) => r.opponents === 1);
    const bad = unpairedClinchFrames(runs);
    expect(bad.slice(0, 5), bad.slice(0, 5).join('\n')).toEqual([]);
  });

  /* --------------------------------------------------------------------- *
   * GRAPPLING-PAIR INVARIANT
   *
   * Grappling and clinch relationships are per-fighter flags, so nothing in the
   * type system forces the two ends to agree. They used not to: with three or
   * more opponents a second attacker could take down a fighter who was already
   * engaged and the displaced partner kept a stale "top" flag, and a clinch
   * break or a referee stoppage could leave groundRole/groundPosition set on a
   * fighter who was standing. Both were fixed by routing every teardown through
   * BoutSimulation.clearEngagement, re-checking each action's preconditions on
   * its resolution tick rather than only at commitment, and freeing prior
   * engagements inside enterGround.
   *
   * These three tests are the regression guard for that fix. They are asserted
   * across every format, not just 1v1/1v2.
   * --------------------------------------------------------------------- */
  it('pairs every top with a bottom in every format, including 1v3..1v5', () => {
    const runs = CORPUS.filter((r) => r.opponents >= 3);
    expect(runs.length).toBeGreaterThan(0);
    const bad = unpairedGroundFrames(runs);
    expect(bad.slice(0, 5), bad.slice(0, 5).join('\n')).toEqual([]);
  });

  it('keeps the clinch pairwise in every format, including 1v3..1v5', () => {
    const runs = CORPUS.filter((r) => r.opponents >= 3);
    const bad = unpairedClinchFrames(runs);
    expect(bad.slice(0, 5), bad.slice(0, 5).join('\n')).toEqual([]);
  });

  it('clears groundRole and groundPosition as soon as a fighter leaves the ground', () => {
    const bad: string[] = [];
    for (const run of CORPUS) {
      for (const frame of run.frames) {
        for (const f of frame.fighters) {
          if (f.posture !== 'ground' && (f.groundRole !== 'none' || f.groundPosition !== 'none')) {
            bad.push(`${run.label} tick ${frame.tick}: fighter ${f.id} posture=${f.posture} role=${f.groundRole} pos=${f.groundPosition}`);
          }
        }
      }
    }
    expect(bad.slice(0, 5), bad.slice(0, 5).join('\n')).toEqual([]);
  });
});

describe('determinism of the engine object itself', () => {
  it('two simulations from the same seed agree frame for frame', () => {
    const a = new BoutSimulation({ seed: boutSeed(MASTER, 2, 1), opponents: 2 }).runRecorded();
    const b = new BoutSimulation({ seed: boutSeed(MASTER, 2, 1), opponents: 2 }).runRecorded();
    expect(a.length).toBe(b.length);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('runToEnd and runRecorded reach the same result from the same seed', () => {
    // The fast batch path must not consume the RNG differently from the
    // frame-recording path, or analytics and replays would disagree.
    const seed = boutSeed(MASTER, 3, 2);
    const fast = new BoutSimulation({ seed, opponents: 3 });
    fast.runToEnd();
    const recorded = new BoutSimulation({ seed, opponents: 3 });
    recorded.runRecorded();
    expect(fast.digest.value).toBe(recorded.digest.value);
    expect(fast.tick).toBe(recorded.tick);
    expect(fast.result).toEqual(recorded.result);
    expect(fast.events.length).toBe(recorded.events.length);
  });
});
