/**
 * DETERMINISM SUITE - the load-bearing tests of this repository.
 *
 * A replay file in this project is 30 KB, not 20 MB, because it stores the
 * SEED, the event timeline and a digest instead of nine thousand frames of
 * poses. That trade is only honest if re-executing the seed reproduces the
 * identical state stream. Everything else - the 3D viewer, the dashboard, the
 * "verified" badge in the UI - rests on that claim.
 *
 * So these tests do not merely check that two digests match. A digest is 32
 * bits and only covers six numbers per fighter per tick (x, z, stamina, damage,
 * balance, sigLanded); it says nothing about postures, actions, defensive
 * states or the event log. Each of the tests below therefore compares the FULL
 * reconstructed state stream field by field, the complete event list, and the
 * frame count, and separately proves that the verification machinery is not
 * vacuous by showing that a tampered file fails it.
 *
 * Read this file as four claims:
 *   1. Re-running a seed reproduces the bout exactly (frames, events, result).
 *   2. Serialising a replay to JSON and back loses nothing.
 *   3. Different seeds genuinely diverge - the engine is not ignoring its seed.
 *   4. `verified` means something - it goes false when the file is altered.
 */

import { describe, it, expect } from 'vitest';
import { recordBout, boutSeed, REPLAY_FORMAT_VERSION, type ReplayFile } from '../src/engine/recorder';
import { loadReplay } from '../src/replay/player';
import { BoutSimulation } from '../src/engine/engine';
import type { TickSnapshot } from '../src/engine/types';

const MASTER = 'determinism';
const FORMATS = [1, 2, 3, 4, 5] as const;

const record = (opponents: number, index: number, master = MASTER): ReplayFile =>
  recordBout(index, { seed: boutSeed(master, opponents, index), opponents });

/** A JSON round trip through a string, exactly as a replay file survives on disk or in a bundle. */
const roundTrip = (file: ReplayFile): ReplayFile => JSON.parse(JSON.stringify(file)) as ReplayFile;

/**
 * An independent fingerprint over EVERY field of EVERY frame - deliberately
 * wider than the engine's own digest, which ignores posture, action and
 * defensive state. Two runs agreeing on this agree on the whole state stream.
 */
function streamFingerprint(frames: TickSnapshot[]): string {
  let h = 0x811c9dc5;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  };
  for (const f of frames) {
    mix(`${f.tick}|${f.t}|${f.round}|${f.roundTime}|${f.phase}`);
    for (const x of f.fighters) {
      mix(`${x.id}|${x.x}|${x.z}|${x.facing}|${x.stamina}|${x.balance}|${x.damage}|${x.action}|` +
          `${x.actionPhase}|${x.actionResult}|${x.defense}|${x.posture}|${x.groundRole}|` +
          `${x.groundPosition}|${x.down}|${x.out}|${x.subProgress}|${x.score}|${x.sigLanded}|${x.sigAttempted}`);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('re-running a seed reproduces the bout', () => {
  it('produces byte-identical replay files for every format', () => {
    for (const opponents of FORMATS) {
      const a = record(opponents, 1);
      const b = record(opponents, 1);
      expect(a.digest, `1v${opponents} digest`).toBe(b.digest);
      expect(a.ticks, `1v${opponents} ticks`).toBe(b.ticks);
      expect(a.events.length, `1v${opponents} event count`).toBe(b.events.length);
      expect(a.result, `1v${opponents} result`).toEqual(b.result);
      // The whole file, analytics included.
      expect(JSON.stringify(a), `1v${opponents} full file`).toBe(JSON.stringify(b));
    }
  });

  it('reproduces every event, not just the count', () => {
    for (const opponents of FORMATS) {
      const a = record(opponents, 2);
      const b = record(opponents, 2);
      expect(a.events.length).toBeGreaterThan(10);
      for (let i = 0; i < a.events.length; i++) {
        expect(a.events[i], `1v${opponents} event ${i}`).toEqual(b.events[i]);
      }
    }
  });

  it('is order-independent: recording other bouts in between changes nothing', () => {
    // Proves no module-level RNG or cache leaks between bouts.
    const first = record(3, 4);
    record(1, 99);
    record(5, 7);
    new BoutSimulation({ seed: 'noise', opponents: 2 }).runToEnd();
    const second = record(3, 4);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('reproduces the whole state stream, not only the digested fields', () => {
    for (const opponents of FORMATS) {
      const file = record(opponents, 3);
      const a = loadReplay(file);
      const b = loadReplay(file);
      expect(streamFingerprint(a.frames), `1v${opponents}`).toBe(streamFingerprint(b.frames));
      expect(a.frames.length).toBe(b.frames.length);
      expect(JSON.stringify(a.frames)).toBe(JSON.stringify(b.frames));
    }
  });

  it('gives identical frames when the same replay is loaded three times', () => {
    for (const opponents of [1, 3] as const) {
      const file = record(opponents, 5);
      const loads = [loadReplay(file), loadReplay(file), loadReplay(file)];
      const counts = loads.map((l) => l.frames.length);
      expect(new Set(counts).size, `1v${opponents} frame counts ${counts.join(',')}`).toBe(1);
      const prints = loads.map((l) => streamFingerprint(l.frames));
      expect(new Set(prints).size, `1v${opponents} stream prints ${prints.join(',')}`).toBe(1);
      const serial = loads.map((l) => JSON.stringify(l.frames));
      expect(serial[0]).toBe(serial[1]);
      expect(serial[1]).toBe(serial[2]);
      // Frame-by-frame, field by field, for the first load against the third.
      for (let i = 0; i < loads[0].frames.length; i++) {
        expect(loads[0].frames[i], `1v${opponents} frame ${i}`).toEqual(loads[2].frames[i]);
      }
      expect(loads.every((l) => l.verified)).toBe(true);
    }
  });
});

describe('JSON round trip', () => {
  it('verifies after a round trip, for every format', () => {
    for (const opponents of FORMATS) {
      const original = record(opponents, 6);
      const revived = roundTrip(original);
      const loaded = loadReplay(revived);
      expect(loaded.verified, `1v${opponents} failed verification after a JSON round trip`).toBe(true);
      expect(loaded.digest, `1v${opponents} digest`).toBe(original.digest);
    }
  });

  it('keeps the frame count exactly one greater than the recorded tick count', () => {
    // runRecorded() writes the opening state plus one frame per tick, so a file
    // claiming N ticks must reconstruct to N + 1 frames or something drifted.
    for (const opponents of FORMATS) {
      const original = record(opponents, 6);
      const loaded = loadReplay(roundTrip(original));
      expect(loaded.frames.length, `1v${opponents}`).toBe(original.ticks + 1);
      expect(loaded.frames[loaded.frames.length - 1].tick).toBe(original.ticks);
      expect(loaded.frames[0].tick).toBe(0);
    }
  });

  it('reconstructs the identical frame stream from the revived file', () => {
    for (const opponents of FORMATS) {
      const original = record(opponents, 6);
      const direct = loadReplay(original);
      const revived = loadReplay(roundTrip(original));
      expect(revived.frames.length).toBe(direct.frames.length);
      expect(streamFingerprint(revived.frames), `1v${opponents}`).toBe(streamFingerprint(direct.frames));
      expect(JSON.stringify(revived.frames)).toBe(JSON.stringify(direct.frames));
    }
  });

  it('reconstructs every event identically to the ones stored in the file', () => {
    for (const opponents of FORMATS) {
      const original = record(opponents, 6);
      const loaded = loadReplay(roundTrip(original));
      expect(loaded.events.length, `1v${opponents} event count`).toBe(original.events.length);
      for (let i = 0; i < original.events.length; i++) {
        // The stored timeline and the re-executed timeline must be the same
        // timeline - this is what makes the stored event list trustworthy.
        expect(loaded.events[i], `1v${opponents} event ${i}`).toEqual(original.events[i]);
      }
      expect(loaded.file.result).toEqual(original.result);
    }
  });

  it('gives every event a frame index that actually exists', () => {
    for (const opponents of FORMATS) {
      const loaded = loadReplay(roundTrip(record(opponents, 6)));
      expect(loaded.eventFrameIndex.length).toBe(loaded.events.length);
      for (let i = 0; i < loaded.eventFrameIndex.length; i++) {
        const idx = loaded.eventFrameIndex[i];
        expect(idx, `1v${opponents} event ${i}`).toBeGreaterThanOrEqual(0);
        expect(idx, `1v${opponents} event ${i}`).toBeLessThan(loaded.frames.length);
        expect(loaded.frames[idx]).toBeDefined();
      }
    }
  });

  it('survives a double round trip and keeps its metadata', () => {
    const original = record(4, 8);
    const twice = roundTrip(roundTrip(original));
    expect(twice.format).toBe(REPLAY_FORMAT_VERSION);
    expect(twice.seed).toBe(original.seed);
    expect(twice.opponents).toBe(4);
    expect(twice.paramsHash).toBe(original.paramsHash);
    expect(twice.profiles).toEqual(original.profiles);
    const loaded = loadReplay(twice);
    expect(loaded.verified).toBe(true);
    expect(loaded.fighterLabels.length).toBe(5);
    expect(loaded.durationSeconds).toBeGreaterThan(0);
  });

  it('exposes labels and duration consistent with the reconstructed frames', () => {
    const loaded = loadReplay(roundTrip(record(2, 9)));
    expect(loaded.fighterLabels).toEqual(['A', 'B1', 'B2']);
    expect(loaded.durationSeconds).toBeCloseTo(loaded.frames[loaded.frames.length - 1].t, 6);
  });
});

describe('different seeds diverge', () => {
  it('gives a distinct digest for each of 24 seeds', () => {
    const digests = Array.from({ length: 24 }, (_, i) => record(1, i + 1).digest);
    expect(new Set(digests).size, `digests: ${digests.join(',')}`).toBe(digests.length);
  });

  it('gives a distinct full state stream, not just a distinct digest', () => {
    const prints = Array.from({ length: 12 }, (_, i) => streamFingerprint(loadReplay(record(2, i + 1)).frames));
    expect(new Set(prints).size).toBe(prints.length);
  });

  it('diverges within the first second of the bout', () => {
    // If the engine only diverged at the end, the seed would barely be used.
    const a = loadReplay(record(1, 1)).frames;
    const b = loadReplay(record(1, 2)).frames;
    const firstDifference = (() => {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (JSON.stringify(a[i].fighters) !== JSON.stringify(b[i].fighters)) return i;
      }
      return -1;
    })();
    expect(firstDifference).toBeGreaterThanOrEqual(0);
    expect(firstDifference).toBeLessThan(10); // within 10 ticks = 1 simulated second
  });

  it('separates the same bout index across formats', () => {
    const digests = FORMATS.map((n) => record(n, 3).digest);
    expect(new Set(digests).size).toBe(FORMATS.length);
  });

  it('separates two master seeds that differ by one character', () => {
    const a = recordBout(1, { seed: boutSeed('alpha', 1, 1), opponents: 1 });
    const b = recordBout(1, { seed: boutSeed('alpho', 1, 1), opponents: 1 });
    expect(a.digest).not.toBe(b.digest);
    expect(streamFingerprint(loadReplay(a).frames)).not.toBe(streamFingerprint(loadReplay(b).frames));
  });

  it('builds a different canonical seed for every (master, format, index)', () => {
    const seeds = new Set<string>();
    for (const n of FORMATS) for (let i = 1; i <= 50; i++) seeds.add(boutSeed(MASTER, n, i));
    expect(seeds.size).toBe(FORMATS.length * 50);
    expect(boutSeed(MASTER, 2, 7)).toContain(`v${REPLAY_FORMAT_VERSION}`);
    expect(boutSeed(MASTER, 2, 7)).toBe(boutSeed(MASTER, 2, 7));
  });
});

describe('verification is not vacuous', () => {
  it('reports verified === false when the digest is altered', () => {
    const file = record(1, 11);
    const tampered = roundTrip(file);
    tampered.digest = tampered.digest === '00000000' ? '11111111' : '00000000';
    const loaded = loadReplay(tampered);
    expect(loaded.verified).toBe(false);
    // ...and the player still returns a usable, self-consistent bout.
    expect(loaded.frames.length).toBeGreaterThan(1);
    expect(loaded.digest).toBe(file.digest);
  });

  it('reports verified === false when the seed is altered, proving the seed drives the bout', () => {
    const file = record(1, 12);
    const tampered = roundTrip(file);
    tampered.seed = `${file.seed}-tampered`;
    const loaded = loadReplay(tampered);
    expect(loaded.verified).toBe(false);
    expect(loaded.digest).not.toBe(file.digest);
  });

  it('reports verified === false when the opponent count is altered', () => {
    const file = record(2, 13);
    const tampered = roundTrip(file);
    tampered.opponents = 3;
    const loaded = loadReplay(tampered);
    expect(loaded.verified).toBe(false);
    expect(loaded.frames[0].fighters.length).toBe(4);
  });

  it('reports verified === false when a parameter override is injected', () => {
    const file = record(1, 14);
    const tampered = roundTrip(file);
    tampered.paramOverrides = { strikeBaseHit: 0.9 };
    expect(loadReplay(tampered).verified).toBe(false);
  });

  it('reports verified === false when an athlete profile is altered', () => {
    const file = record(1, 15);
    const tampered = roundTrip(file);
    tampered.profiles = { ...tampered.profiles, b: { ...tampered.profiles.b, weightLb: 260 } };
    expect(loadReplay(tampered).verified).toBe(false);
  });

  it('still verifies when only the human-readable event text is edited', () => {
    // The digest fingerprints the state stream, not the commentary, and the
    // player re-derives the events from the seed. Editing the stored prose is
    // therefore detectable by comparison but does not invalidate the replay.
    const file = record(1, 16);
    const tampered = roundTrip(file);
    tampered.events[1].text = 'edited commentary';
    const loaded = loadReplay(tampered);
    expect(loaded.verified).toBe(true);
    expect(loaded.events[1].text).not.toBe('edited commentary');
  });

  it('verifies every format straight out of the recorder', () => {
    for (const opponents of FORMATS) {
      for (let index = 20; index < 23; index++) {
        const file = record(opponents, index);
        expect(loadReplay(file).verified, `1v${opponents} #${index}`).toBe(true);
      }
    }
  });
});
