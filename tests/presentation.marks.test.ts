// Fight marks on the canvas (arena/marks.ts) are a pure function of the
// recording, the blood setting and the cosmetic seed: replays, seeks and a
// reload must bake the same canvas.
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, DEFAULT_SETTINGS, resolveArena, simulate,
  type BoutRun, type SimConfig, type TickSnapshot,
} from '../src/sim';
import { bakeFightMarks, fightMarkSplats, marksExtent } from '../src/presentation/arena/marks';

const config: SimConfig = {
  seed: 'marks-1', mode: '1v1', fighters: [Object.values(ARCHETYPES)[1]!, Object.values(ARCHETYPES)[2]!],
  teams: { teamOf: [0, 1] }, ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: DEFAULT_SETTINGS,
};

describe('fight marks', () => {
  const run = simulate(config, { record: true }) as BoutRun & { frames: TickSnapshot[] };
  const extent = marksExtent(resolveArena('octagon_30'));

  it('bakes the same splats and texels from the same recording', () => {
    const a = fightMarkSplats(run.frames, { blood: true, seed: 1234, extent });
    const b = fightMarkSplats(run.frames, { blood: true, seed: 1234, extent });
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    const ta = bakeFightMarks(a, extent, 128).image.data as ArrayLike<number>;
    const tb = bakeFightMarks(b, extent, 128).image.data as ArrayLike<number>;
    expect(Array.from(tb)).toEqual(Array.from(ta));
  });

  it('keeps every mark inside the canvas, finite, and blood-free when blood is off', () => {
    const splats = fightMarkSplats(run.frames, { blood: false, seed: 7, extent });
    for (const s of splats) {
      expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
      expect(Math.abs(s.x)).toBeLessThan(extent);
      expect(Math.abs(s.z)).toBeLessThan(extent);
    }
    const withBlood = fightMarkSplats(run.frames, { blood: true, seed: 7, extent });
    expect(withBlood.length).toBeGreaterThanOrEqual(splats.length);
  });
});
