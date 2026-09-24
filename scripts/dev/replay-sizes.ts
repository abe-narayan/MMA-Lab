/**
 * Replay size and load-time measurements for docs/design/WATCH_REPLAY_PASS.md.
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/replay-sizes.ts
 *
 * Per demo bout: re-simulation time (`loadWatchBout`), the replay file as the
 * History screen stores it (v4 JSON, raw and gzipped), the portable and
 * library archives, the frames (in-memory columns vs plain JSON), and the time
 * to open each archive.
 */
import { gzipSync } from 'node:zlib';
import { ARCHETYPES, DEFAULT_SETTINGS, toReplayFile, type SimConfig } from '../../src/sim';
import { loadWatchBout } from '../../src/app/replay/bout';
import { FrameStore } from '../../src/sim/record/frames';
import { encodeForLibrary, encodePortable, openReplay, replayFileFor } from '../../src/app/replay/saved';
import { encodeArchive } from '../../src/app/replay/archive';

function demoConfig(seed: string, a: number, b: number): SimConfig {
  const l = Object.values(ARCHETYPES);
  return {
    seed, mode: '1v1', fighters: [l[a], l[b]], teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: DEFAULT_SETTINGS,
  };
}

const kb = (n: number): string => (n / 1024).toFixed(1);

const bouts: [string, number, number][] = [
  ['watch-demo', 0, 1], ['watch-demo-4', 1, 3], ['watch-demo-5', 1, 2], ['polish-3', 3, 4], ['transport-3', 0, 1],
];
for (const [seed, a, b] of bouts) {
  const t0 = performance.now();
  const bout = loadWatchBout(demoConfig(seed, a, b));
  const loadMs = performance.now() - t0;
  const file = toReplayFile(bout.run);
  const json = Buffer.byteLength(JSON.stringify(file));
  const gz = gzipSync(JSON.stringify(file), { level: 9 }).length;
  const store = FrameStore.of(bout.run.frames)!;
  let framesJson = 0;
  for (let i = 0; i < bout.run.frames.length; i++) framesJson += Buffer.byteLength(JSON.stringify(bout.run.frames[i]));
  const framesJsonGz = gzipSync(JSON.stringify([...bout.run.frames])).length;

  const t1 = performance.now();
  const portable = await encodePortable(replayFileFor(bout));
  const t2 = performance.now();
  const library = await encodeForLibrary(bout);
  const t3 = performance.now();
  const libraryRaw = await encodeArchive({ replay: replayFileFor(bout), frames: bout.run.frames, intents: bout.intents }, { profile: 'library', compress: false });
  const t4 = performance.now();
  const openCached = await openReplay(library);
  const t5 = performance.now();
  const openPortable = await openReplay(portable);
  const t6 = performance.now();

  console.log(JSON.stringify({
    seed: `${seed}:${a}:${b}`,
    ticks: bout.run.ticks,
    events: bout.run.events.length,
    resimMs: Math.round(loadMs),
    v4JsonKB: kb(json),
    v4JsonGzKB: kb(gz),
    portableKB: kb(portable.length),
    libraryKB: kb(library.length),
    libraryUncompressedKB: kb(libraryRaw.length),
    framesInMemoryKB: kb(store.byteSize()),
    framesJsonKB: kb(framesJson),
    framesJsonGzKB: kb(framesJsonGz),
    encodePortableMs: Math.round(t2 - t1),
    encodeLibraryMs: Math.round(t3 - t2),
    openLibraryMs: Math.round(t5 - t4),
    openPortableMs: Math.round(t6 - t5),
    verdicts: [openCached.ok && openCached.opened.verification, openPortable.ok && openPortable.opened.verification],
  }));
}
