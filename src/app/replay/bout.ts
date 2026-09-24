/**
 * LOADING A BOUT FOR THE WATCH SCREEN.
 *
 * 09 §4.5 asks for frames to be regenerated at load rather than stored, so a
 * seek is an array index. That is what this does: it steps `createSim` to the
 * end, keeping every `TickSnapshot`, sampling `Sim.intents()` on the way (the
 * game-plan panel needs the plan *as it was at that tick*, which no event
 * carries), and finishing with the commentary the same run always produces.
 *
 * `Sim.intents()` is documented as a read-only view and takes no RNG draws, so
 * sampling it cannot change the bout; `digestMatches` below is the assertion of
 * that, and the transport suite checks it against a plain `simulate()`.
 */
import {
  computeStats, createSim, generateCommentary, deriveRuntime, resolveParams,
  type BoutRun, type CommentaryLine, type FighterDefinition, type FighterRuntime,
  type IntentSample, type SimConfig, type TickSnapshot,
} from '../../sim';
import { FrameStore } from '../../sim/record/frames';

export interface WatchBout {
  config: SimConfig;
  /** The run, always with `frames` — the Watch screen cannot work without them. */
  run: BoutRun & { frames: TickSnapshot[] };
  /** `Sim.intents()` readings, in tick order. */
  intents: IntentSample[];
  commentary: CommentaryLine[];
  fighters: readonly FighterDefinition[];
  runtimes: readonly FighterRuntime[];
}

export interface LoadOptions {
  /** How often to sample the game plan, in simulated seconds. Default 1 s. */
  intentEverySeconds?: number;
  maxTicks?: number;
  /** Called every `progressEveryTicks` simulated ticks (the worker reports it). */
  onProgress?: (tick: number, round: number) => void;
  progressEveryTicks?: number;
}

export function loadWatchBout(config: SimConfig, opts: LoadOptions = {}): WatchBout {
  const every = Math.max(1, Math.round((opts.intentEverySeconds ?? 1) * 10));
  const sim = createSim(config, { maxTicks: opts.maxTicks });
  const progressEvery = Math.max(1, Math.round(opts.progressEveryTicks ?? 200));
  // Compact columnar frames (09 §4.5, sim/record/frames.ts); `run.frames`
  // is a read-only TickSnapshot[] view over them.
  const store = new FrameStore();
  const intents: IntentSample[] = [];

  const sample = (): void => {
    intents.push({ tick: sim.tick, intents: sim.intents().map((i) => ({ ...i })) });
  };

  store.push(sim.snapshot());
  while (sim.step()) {
    store.push(sim.snapshot());
    // The first sample is taken after the first step, never before it: the
    // policy builds its plans in `prepare()`, which the loop runs on that
    // step, so a pre-step reading would report "no plan at all" for every
    // fighter and the panel would open on a lie.
    if (sim.tick === 1 || sim.tick % every === 0) sample();
    if (opts.onProgress && sim.tick % progressEvery === 0) opts.onProgress(sim.tick, sim.round);
  }
  store.push(sim.snapshot());
  sample();
  const frames = store.view();

  const result = sim.result;
  if (!result) throw new Error('A bout must always end with a BoutResult');
  const events = [...sim.events];
  const run = {
    config,
    result,
    events,
    stats: computeStats(events, config, sim.tick),
    digest: sim.digest,
    ticks: sim.tick,
    rngDraws: sim.rngDraws,
    frames,
  };

  return watchBoutFromRun(config, run, intents);
}

/** A Watch bout from parts already computed (the worker sends the commentary). */
export function assembleWatchBout(
  config: SimConfig, run: WatchBout['run'], intents: IntentSample[], commentary: CommentaryLine[],
): WatchBout {
  const params = resolveParams(config.paramOverrides);
  return {
    config,
    run,
    intents,
    commentary,
    fighters: config.fighters,
    runtimes: config.fighters.map((f) => deriveRuntime(f, params, { explain: false })),
  };
}

/**
 * The Watch bout for a run that already has its frames (a freshly simulated
 * one above, or a saved replay's frame cache, replay/archive.ts): the
 * commentary and the fighters' runtimes are derived the same way either way.
 */
export function watchBoutFromRun(
  config: SimConfig, run: WatchBout['run'], intents: IntentSample[],
): WatchBout {
  return assembleWatchBout(config, run, intents, generateCommentary(run, { intents }));
}
