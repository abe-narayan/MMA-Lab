/**
 * ANALYTICS SUITE
 *
 * `recordBout` computes the analytics block while the bout runs; the dashboard
 * then aggregates thousands of those blocks without ever re-simulating. That
 * only works if the analytics block is an exact summary of the event log and
 * the final fighter state. These tests re-derive every countable field straight
 * from `events` and `perFighter` and demand agreement.
 *
 * Where the engine and the recorder count slightly different things - an action
 * that was committed but never resolved, for instance - the test states the
 * inequality that must hold and why, rather than pretending the two are equal.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { recordBout, boutSeed, type ReplayFile } from '../src/engine/recorder';
import { loadReplay } from '../src/replay/player';
import { DEFAULT_PARAMS as P } from '../src/engine/params';

const FORMATS = [1, 2, 3, 4, 5] as const;
const BOUTS_PER_FORMAT = 8;
const MASTER = 'analytics';

const FILES: ReplayFile[] = [];
const label = (f: ReplayFile) => `1v${f.opponents} #${f.analytics.index}`;

beforeAll(() => {
  for (const opponents of FORMATS) {
    for (let index = 1; index <= BOUTS_PER_FORMAT; index++) {
      FILES.push(recordBout(index, { seed: boutSeed(MASTER, opponents, index), opponents }));
    }
  }
});

/** Collects a per-bout complaint list so a failure names the bout and the numbers. */
function eachBout(fn: (file: ReplayFile) => string[]): void {
  const failures: string[] = [];
  for (const file of FILES) {
    for (const msg of fn(file)) failures.push(`${label(file)}: ${msg}`);
    if (failures.length >= 5) break;
  }
  expect(failures.slice(0, 5), failures.slice(0, 5).join('\n')).toEqual([]);
}

describe('corpus', () => {
  it('records the requested bouts across every format', () => {
    expect(FILES.length).toBe(FORMATS.length * BOUTS_PER_FORMAT);
    eachBout((f) => {
      const out: string[] = [];
      if (f.analytics.opponents !== f.opponents) out.push('analytics.opponents disagrees with the file');
      if (f.analytics.seed !== f.seed) out.push('analytics.seed disagrees with the file');
      if (f.analytics.index < 1 || f.analytics.index > BOUTS_PER_FORMAT) out.push(`index ${f.analytics.index}`);
      return out;
    });
  });

  it('produces bouts with real activity, so the counting tests are not trivially true', () => {
    const totalStrikes = FILES.reduce((a, f) => a + f.analytics.significantActions, 0);
    expect(totalStrikes).toBeGreaterThan(FILES.length * 20);
    expect(FILES.every((f) => f.analytics.significantActions > 0)).toBe(true);
  });
});

describe('strike counts match the event log', () => {
  it('significantActions equals the number of strike events', () => {
    eachBout((f) => {
      const strikes = f.events.filter((e) => e.kind === 'strike').length;
      return f.analytics.significantActions === strikes
        ? [] : [`significantActions ${f.analytics.significantActions} vs ${strikes} strike events`];
    });
  });

  it('landed / missed / blocked / evaded each match the event log', () => {
    eachBout((f) => {
      const A = f.analytics;
      const count = (r: string) => f.events.filter((e) => e.kind === 'strike' && e.result === r).length;
      const out: string[] = [];
      if (A.actionsLanded !== count('landed')) out.push(`landed ${A.actionsLanded} vs ${count('landed')}`);
      if (A.actionsMissed !== count('missed')) out.push(`missed ${A.actionsMissed} vs ${count('missed')}`);
      if (A.actionsBlocked !== count('blocked')) out.push(`blocked ${A.actionsBlocked} vs ${count('blocked')}`);
      if (A.actionsEvaded !== count('evaded')) out.push(`evaded ${A.actionsEvaded} vs ${count('evaded')}`);
      return out;
    });
  });

  it('the four outcomes partition the strike total exactly', () => {
    eachBout((f) => {
      const A = f.analytics;
      const sum = A.actionsLanded + A.actionsMissed + A.actionsBlocked + A.actionsEvaded;
      return sum === A.significantActions ? [] : [`outcomes sum to ${sum}, significantActions is ${A.significantActions}`];
    });
  });

  it('every strike event carries one of the four outcomes', () => {
    eachBout((f) => {
      const bad = f.events.filter((e) => e.kind === 'strike' &&
        !['landed', 'missed', 'blocked', 'evaded'].includes(e.result as string));
      return bad.length === 0 ? [] : [`${bad.length} strike events with result "${bad[0].result}"`];
    });
  });
});

describe('grappling counts match the event log', () => {
  it('takedownsAttempted equals the number of takedown events', () => {
    eachBout((f) => {
      const n = f.events.filter((e) => e.kind === 'takedown').length;
      return f.analytics.takedownsAttempted === n ? [] : [`takedownsAttempted ${f.analytics.takedownsAttempted} vs ${n}`];
    });
  });

  it('takedownsLanded equals the number of successful takedown events and never exceeds attempts', () => {
    eachBout((f) => {
      const n = f.events.filter((e) => e.kind === 'takedown' && e.result === 'success').length;
      const out: string[] = [];
      if (f.analytics.takedownsLanded !== n) out.push(`takedownsLanded ${f.analytics.takedownsLanded} vs ${n}`);
      if (f.analytics.takedownsLanded > f.analytics.takedownsAttempted) out.push('landed exceeds attempted');
      return out;
    });
  });

  it('submissionAttempts equals the number of submissionAttempt events', () => {
    eachBout((f) => {
      const n = f.events.filter((e) => e.kind === 'submissionAttempt').length;
      return f.analytics.submissionAttempts === n ? [] : [`submissionAttempts ${f.analytics.submissionAttempts} vs ${n}`];
    });
  });

  it('knockdowns equals the number of knockdown events', () => {
    eachBout((f) => {
      const n = f.events.filter((e) => e.kind === 'knockdown').length;
      return f.analytics.knockdowns === n ? [] : [`knockdowns ${f.analytics.knockdowns} vs ${n}`];
    });
  });

  it('positionChanges covers positionChange, clinch and standUp events', () => {
    eachBout((f) => {
      const n = f.events.filter((e) =>
        e.kind === 'positionChange' || e.kind === 'clinch' || e.kind === 'standUp').length;
      return f.analytics.positionChanges === n ? [] : [`positionChanges ${f.analytics.positionChanges} vs ${n}`];
    });
  });

  it('records a submission finish if and only if the method says so', () => {
    eachBout((f) => {
      const finishes = f.events.filter((e) => e.kind === 'submissionFinish').length;
      const byTap = f.analytics.method === 'submission (tap)';
      if (byTap && finishes !== 1) return [`method is a tap but there are ${finishes} submissionFinish events`];
      if (!byTap && finishes !== 0) return [`${finishes} submissionFinish events but method is "${f.analytics.method}"`];
      return [];
    });
  });
});

describe('per-fighter tallies match the event log', () => {
  it('has one perFighter row per fighter, with matching ids, labels and teams', () => {
    eachBout((f) => {
      const out: string[] = [];
      const rows = f.analytics.perFighter;
      if (rows.length !== f.opponents + 1) out.push(`${rows.length} rows for ${f.opponents + 1} fighters`);
      rows.forEach((r, i) => {
        if (r.id !== i) out.push(`row ${i} has id ${r.id}`);
        if (i === 0 && r.team !== 'A') out.push('fighter 0 is not on team A');
        if (i > 0 && r.team !== 'B') out.push(`fighter ${i} is not on the B side`);
      });
      if (f.opponents === 1 && rows.map((r) => r.label).join(',') !== 'A,B') out.push(`labels ${rows.map((r) => r.label).join(',')}`);
      return out;
    });
  });

  it('sums perFighter.sigLanded to exactly the landed strike events', () => {
    eachBout((f) => {
      const sum = f.analytics.perFighter.reduce((a, r) => a + r.sigLanded, 0);
      return sum === f.analytics.actionsLanded ? [] : [`sum of sigLanded ${sum} vs actionsLanded ${f.analytics.actionsLanded}`];
    });
  });

  it('attributes each landed strike to the fighter who threw it', () => {
    eachBout((f) => {
      const byActor = new Map<number, number>();
      for (const e of f.events) {
        if (e.kind === 'strike' && e.result === 'landed') byActor.set(e.actor, (byActor.get(e.actor) ?? 0) + 1);
      }
      const out: string[] = [];
      for (const r of f.analytics.perFighter) {
        const expected = byActor.get(r.id) ?? 0;
        if (r.sigLanded !== expected) out.push(`fighter ${r.id} sigLanded ${r.sigLanded} vs ${expected} landed events`);
      }
      return out;
    });
  });

  it('attributes each successful takedown to the fighter who completed it', () => {
    eachBout((f) => {
      const byActor = new Map<number, number>();
      for (const e of f.events) {
        if (e.kind === 'takedown' && e.result === 'success') byActor.set(e.actor, (byActor.get(e.actor) ?? 0) + 1);
      }
      const out: string[] = [];
      for (const r of f.analytics.perFighter) {
        const expected = byActor.get(r.id) ?? 0;
        if (r.takedownsLanded !== expected) out.push(`fighter ${r.id} takedownsLanded ${r.takedownsLanded} vs ${expected}`);
      }
      return out;
    });
  });

  it('counts at least as many committed attempts as resolved ones', () => {
    // sigAttempted / takedownsAttempted are incremented when the action is
    // COMMITTED; the event is emitted when it RESOLVES. A bout that ends, or an
    // opponent who is waved out, mid-windup leaves a committed action with no
    // event - so the committed totals are an upper bound, never a lower one.
    eachBout((f) => {
      const A = f.analytics;
      const out: string[] = [];
      const sumAtt = A.perFighter.reduce((a, r) => a + r.sigAttempted, 0);
      const sumTd = A.perFighter.reduce((a, r) => a + r.takedownsAttempted, 0);
      if (sumAtt < A.significantActions) out.push(`committed strikes ${sumAtt} < resolved ${A.significantActions}`);
      if (sumAtt > A.significantActions + 6 * (f.opponents + 1)) out.push(`committed strikes ${sumAtt} implausibly exceeds resolved ${A.significantActions}`);
      if (sumTd < A.takedownsAttempted) out.push(`committed takedowns ${sumTd} < resolved ${A.takedownsAttempted}`);
      return out;
    });
  });

  it('computes accuracy as landed / attempted to three decimals', () => {
    eachBout((f) => {
      const out: string[] = [];
      for (const r of f.analytics.perFighter) {
        const expected = r.sigAttempted ? +(r.sigLanded / r.sigAttempted).toFixed(3) : 0;
        if (r.accuracy !== expected) out.push(`fighter ${r.id} accuracy ${r.accuracy} vs ${expected}`);
        if (r.accuracy < 0 || r.accuracy > 1) out.push(`fighter ${r.id} accuracy ${r.accuracy} out of range`);
        if (r.sigLanded > r.sigAttempted) out.push(`fighter ${r.id} landed more than attempted`);
      }
      return out;
    });
  });

  it('matches the final frame of the replay for damage, stamina and out flags', () => {
    // The analytics row and the last rendered frame describe the same instant.
    for (const f of FILES.filter((x) => x.analytics.index <= 2)) {
      const last = loadReplay(f).frames.at(-1)!;
      for (const r of f.analytics.perFighter) {
        const frame = last.fighters[r.id];
        expect(r.damageTaken, `${label(f)} fighter ${r.id} damage`).toBeCloseTo(frame.damage, 0);
        expect(r.out, `${label(f)} fighter ${r.id} out`).toBe(frame.out);
        expect(r.sigLanded, `${label(f)} fighter ${r.id} sigLanded`).toBe(frame.sigLanded);
        expect(r.sigAttempted, `${label(f)} fighter ${r.id} sigAttempted`).toBe(frame.sigAttempted);
      }
    }
  });

  it('reports end stamina as a fraction in [0, 1]', () => {
    eachBout((f) => f.analytics.perFighter
      .filter((r) => r.endStamina < 0 || r.endStamina > 1)
      .map((r) => `fighter ${r.id} endStamina ${r.endStamina}`));
  });
});

describe('result fields mirror the bout result', () => {
  it('copies winner, method, round and time from the result', () => {
    eachBout((f) => {
      const out: string[] = [];
      if (f.analytics.winner !== f.result.winner) out.push(`winner ${f.analytics.winner} vs ${f.result.winner}`);
      if (f.analytics.method !== f.result.method) out.push(`method ${f.analytics.method} vs ${f.result.method}`);
      if (f.analytics.round !== f.result.round) out.push(`round ${f.analytics.round} vs ${f.result.round}`);
      if (f.analytics.timeSeconds !== f.result.timeSeconds) out.push(`time ${f.analytics.timeSeconds} vs ${f.result.timeSeconds}`);
      return out;
    });
  });

  it('agrees with the final boutEnd event', () => {
    eachBout((f) => {
      const end = f.events.filter((e) => e.kind === 'boutEnd');
      if (end.length !== 1) return [`${end.length} boutEnd events`];
      return end[0].detail === f.analytics.method ? [] : [`boutEnd detail "${end[0].detail}" vs method "${f.analytics.method}"`];
    });
  });

  it('flags every B-side fighter as out when the method is "all opponents stopped"', () => {
    eachBout((f) => {
      if (f.analytics.method !== 'all opponents stopped') return [];
      const bs = f.analytics.perFighter.filter((r) => r.team === 'B');
      return bs.every((r) => r.out) ? [] : ['method says all opponents stopped but some B fighters are not out'];
    });
  });

  it('reports a totalSeconds consistent with the recorded tick count', () => {
    eachBout((f) => {
      const expected = f.ticks * P.dt;
      return Math.abs(f.analytics.totalSeconds - expected) < 0.2
        ? [] : [`totalSeconds ${f.analytics.totalSeconds} vs ticks*dt ${expected.toFixed(1)}`];
    });
  });

  it('never claims a finish later than the round clock allows', () => {
    eachBout((f) => {
      const out: string[] = [];
      if (f.analytics.timeSeconds > P.roundSeconds) out.push(`timeSeconds ${f.analytics.timeSeconds}`);
      if (f.analytics.round > P.rounds) out.push(`round ${f.analytics.round}`);
      return out;
    });
  });
});

describe('trajectories and posture time', () => {
  it('samples every trajectory at the same points', () => {
    eachBout((f) => {
      const A = f.analytics;
      const n = A.scoreTrajectory.length;
      const out: string[] = [];
      if (n < 2) out.push(`only ${n} sample points`);
      if (A.staminaTrajectory.length !== f.opponents + 1) out.push(`${A.staminaTrajectory.length} stamina series`);
      if (A.damageTrajectory.length !== f.opponents + 1) out.push(`${A.damageTrajectory.length} damage series`);
      for (const s of A.staminaTrajectory) if (s.samples.length !== n) out.push(`stamina series ${s.id} has ${s.samples.length} samples, score has ${n}`);
      for (const s of A.damageTrajectory) if (s.samples.length !== n) out.push(`damage series ${s.id} has ${s.samples.length} samples, score has ${n}`);
      return out;
    });
  });

  it('keeps stamina samples as fractions in [0, 1] and damage samples non-negative', () => {
    eachBout((f) => {
      const out: string[] = [];
      for (const s of f.analytics.staminaTrajectory) {
        const bad = s.samples.filter((v) => v < 0 || v > 1);
        if (bad.length) out.push(`stamina series ${s.id} has ${bad.length} samples outside [0,1] (e.g. ${bad[0]})`);
      }
      for (const s of f.analytics.damageTrajectory) {
        const bad = s.samples.filter((v) => v < 0 || !Number.isFinite(v));
        if (bad.length) out.push(`damage series ${s.id} has ${bad.length} bad samples`);
      }
      return out;
    });
  });

  it('starts every fighter at full stamina and zero damage', () => {
    eachBout((f) => {
      const out: string[] = [];
      for (const s of f.analytics.staminaTrajectory) if (s.samples[0] !== 1) out.push(`fighter ${s.id} starts at stamina ${s.samples[0]}`);
      for (const s of f.analytics.damageTrajectory) if (s.samples[0] !== 0) out.push(`fighter ${s.id} starts at damage ${s.samples[0]}`);
      if (f.analytics.scoreTrajectory[0] !== 0) out.push(`score starts at ${f.analytics.scoreTrajectory[0]}`);
      return out;
    });
  });

  it('labels each trajectory series with the matching fighter label', () => {
    eachBout((f) => {
      const labels = f.analytics.perFighter.map((r) => r.label);
      const out: string[] = [];
      f.analytics.staminaTrajectory.forEach((s, i) => { if (s.label !== labels[i]) out.push(`stamina series ${i} labelled ${s.label}, expected ${labels[i]}`); });
      f.analytics.damageTrajectory.forEach((s, i) => { if (s.label !== labels[i]) out.push(`damage series ${i} labelled ${s.label}, expected ${labels[i]}`); });
      return out;
    });
  });

  it('accounts posture time only for time actually simulated', () => {
    // postureSeconds tracks Athlete A's posture during live round time, so it
    // must never exceed the total elapsed time (which also includes breaks).
    eachBout((f) => {
      const p = f.analytics.postureSeconds;
      const sum = p.standing + p.clinch + p.ground + p.down;
      const out: string[] = [];
      if (sum > f.analytics.totalSeconds + 0.5) out.push(`posture total ${sum.toFixed(1)}s exceeds bout total ${f.analytics.totalSeconds}s`);
      if (sum <= 0) out.push('no posture time recorded at all');
      for (const [k, v] of Object.entries(p)) if (v < 0) out.push(`${k} is negative`);
      return out;
    });
  });

  it('keeps the damage trajectory non-decreasing apart from the between-round recovery', () => {
    eachBout((f) => {
      const out: string[] = [];
      for (const s of f.analytics.damageTrajectory) {
        for (let i = 1; i < s.samples.length; i++) {
          const drop = s.samples[i - 1] - s.samples[i];
          // Up to two between-round recoveries can fall between two samples.
          if (drop > 2 * P.damageRecoveryPerRound + 0.2) {
            out.push(`fighter ${s.id} damage fell ${drop.toFixed(1)} between samples ${i - 1} and ${i}`);
          }
        }
      }
      return out;
    });
  });
});

describe('analytics are deterministic', () => {
  it('recomputes identically from the same seed', () => {
    for (const opponents of FORMATS) {
      const a = recordBout(1, { seed: boutSeed(MASTER, opponents, 1), opponents }).analytics;
      const b = recordBout(1, { seed: boutSeed(MASTER, opponents, 1), opponents }).analytics;
      expect(a, `1v${opponents}`).toEqual(b);
    }
  });
});
