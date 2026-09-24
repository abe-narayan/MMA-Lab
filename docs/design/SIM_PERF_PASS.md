# Simulation performance pass (2026-09-24)

Scope: `src/sim/**` only, plus the regression harness and benchmark scripts. Engine
`SIM_ENGINE_VERSION` stays **5.0.0**: nothing observable changed. For every bout of the
310-bout golden corpus the digest, tick count, RNG draw count, result, full event log,
stats and every recorded frame (at full float precision) are bit-identical to commit
`2720d60`, and a 1,000-bout batch run produces byte-identical result rows.

## 1. Results

Single thread, unrecorded `simulate()` (the batch hot path), bundled with esbuild, Node
24.19, Intel Core Ultra 7 256V. Medians of four interleaved before/after runs (the machine
was shared with other agents, so single runs swing by ±20 %; interleaving keeps the ratio
honest). "Before" is the committed `src/sim` of `2720d60`, "after" is this pass.

| Suite (fixed seeds) | bouts/s before | bouts/s after | ms/tick before | ms/tick after | speed-up |
| --- | ---: | ---: | ---: | ---: | ---: |
| 3R 1v1, 10 bouts, 65,508 ticks | 0.90 | **2.37** | 0.171 | **0.064** | **2.7x** |
| 5R 1v1, 8 bouts, 67,946 ticks | 0.70 | **1.83** | 0.170 | **0.065** | **2.6x** |
| 1v5 gauntlet, 16 bouts, 8,575 ticks | 2.81 | **6.60** | 0.664 | **0.283** | **2.3x** |

Measured on the same runs:

| | 3R before | 3R after | 5R before | 5R after | 1v5 before | 1v5 after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Allocated per tick (KB) | 76.1 | **52.0** | 98.4 | **64.2** | 405 | **271** |
| GC time for the suite (ms) | 236 | **170** | 233 | **162** | 132 | **102** |
| GC runs | 593 | 461 | 525 | 421 | 268 | 207 |
| Promoted to old space (KB/tick) | 0.9 | 0.9 | | | | |
| Peak `heapUsed` between bouts (MB) | 61 | **51** | 64 | **49** | 63 | **55** |
| Live heap during a bout, after a forced GC (MB) | ~7 | ~7 | ~7 | ~7 | | |
| Process peak RSS (MB) | 165–175 | 170–177 | 166–173 | 163–170 | 201 | 169–182 |

GC time is lower in absolute terms; as a share of the (now much shorter) wall time it rose
from ~2 % to ~4 %. The live state of a bout (fighters, ledgers, opponent models, perception
buffers, event log) was already small and is unchanged.

**Batch runner** (`scripts/batch/run.ts --plan identical --n 1000 --max-workers 2`, both
workers active the whole run):

| | wall | throughput |
| --- | ---: | ---: |
| Before | 756.4 s | 79 bouts/min |
| After | **293.6 s** | **205 bouts/min** (2.6x) |

All 1,000 `results.jsonl` rows are byte-identical between the two runs.

## 2. Methodology

### Golden harness (built first, before any change)

`scripts/dev/sim-golden-lib.ts` builds 310 deterministic cases from nothing but the sim's
own exports (archetypes, rulesets, arenas), so the corpus cannot drift when the app's
fighter generator changes:

- every one of the 14 rulesets x 13 archetype pairings, cycling all 9 arenas (182);
- the tier ladder, every archetype in a 3R and a 5R bout (30);
- extreme stats — all-0 / all-100 flat fighters, zero cardio, glass and iron chins,
  aggression 100 / discipline 0, no disciplines, zero reaction time — each in 3R and 5R (20);
- extreme bodies — 1.50 m / 50 kg vs 2.18 m / 160 kg, age 18 vs 48, 40 % vs 4 % body fat,
  reach extremes, a 130 kg grappler, southpaw vs switch — 3R and 5R (12);
- multi-fighter: teams 1v2, 1v3, 1v5, 2v2, 3v3 (x4), FFA-3/4/6 (x4), crowd 1v2/1v5/1v8
  (x3) and an untimed crowd, street 1v1 on both street arenas (6);
- match settings (arcade, ironman, lenient, strict, open judging, five judge cultures,
  1-round and 7-round overrides, home fighter, classed weigh-ins) and timestep overrides
  (`core.dtMs` 50 and 200, including a team bout).

Each case is run twice: unrecorded through `simulate()` (digest, ticks, RNG draws, SHA-1 of
the result, the event log and the stats), and stepped by hand with a `snapshot()` before the
first step, after every step and after the end (exactly how `simulate({ record: true })`
collects frames), hashing every snapshot's JSON. `JSON.stringify` prints the shortest
round-tripping decimal, so any changed bit of any number changes the hash; the world digest
alone quantises to 1e-3 and would not have been enough. The recorded run's digest must also
equal the unrecorded one (building snapshots never perturbs a bout).

- Full baseline: generated from the committed code before the first edit and stored outside
  the repo; `npx tsx scripts/dev/sim-golden.ts --check <file>` re-runs and diffs field by
  field. **Result: 310/310 identical** (checked after the first optimisation round and again
  after the last change).
- Committed fixture: `tests/fixtures/sim-golden.json`, 41 cases chosen to cover every
  ruleset, every mode, extremes, settings and timesteps at the lowest tick cost;
  `tests/sim.golden.test.ts` fails on any mismatch and says how to regenerate intentionally
  after a version bump: `npx tsx scripts/dev/sim-golden.ts --write tests/fixtures/sim-golden.json`
  (re-records the case ids already in the file). It takes ~30 s on its own on this machine
  (~80 s inside the full, parallel suite).
- The same test file also checks the two restructured hot paths against their originals
  directly: the fast scorer against `scoreAction` on 20,000 random inputs (edge values
  included) with `Object.is`, and the ledger's running counts against a full re-scan of the
  window on random traffic.

Every optimisation below was verified with the 41-case fixture before moving on, and the
full 310 at the milestones.

### Profiling

- CPU: `node --cpu-prof --cpu-prof-interval 200` on an esbuild bundle of
  `scripts/dev/sim-bench.ts` (the bundle keeps real line numbers; tsx's loader does not),
  aggregated by function, by source module (from the bundle's `// src/...` markers), by
  line (`positionTicks`), and by the direct callees of `BoutLoop.step` for the phase view.
- Allocation: the inspector's sampling heap profiler with
  `includeObjectsCollectedByMinorGC/MajorGC`, which attributes *all* allocation, not only
  what survives; with minor-GC objects excluded it shows what gets promoted.
- `scripts/dev/sim-bench.ts` reports bouts/s, wall and CPU ms per tick, GC time and runs
  (PerformanceObserver `gc`), peak heap, peak RSS and allocation per tick (the positive
  `heapUsed` deltas across each `step()`; steps that ran a scavenge are skipped, <1 %).

### Where the time went (3R, 8 bouts, 55,037 ticks, profiler on)

Per phase (inclusive time under `BoutLoop.step`; the profiler inflates absolute numbers):

| Phase | before (ms) | share | after (ms) | share |
| --- | ---: | ---: | ---: | ---: |
| P3 decide (+ commit, canAct) | 12,203 | 75.0 % | 4,736 | 67.4 % |
| P2 upkeep | 2,876 | 17.7 % | 1,433 | 20.4 % |
| P6 referee | 362 | 2.2 % | 253 | 3.6 % |
| P4 resolve | 289 | 1.8 % | 256 | 3.6 % |
| P5 move (integrate + separate) | 184 | 1.1 % | 47 | 0.7 % |
| P9 digest | 76 | 0.5 % | 84 | 1.2 % |
| P1 perception | 52 | 0.3 % | 24 | 0.3 % |
| P7 judges | 52 | 0.3 % | 41 | 0.6 % |
| P0 clock / breaks | < 5 | | < 5 | |
| **step total** | **16,277** | | **7,029** | |

Per module (self time):

| Module | before (ms) | after (ms) |
| --- | ---: | ---: |
| ai/policy.ts | 4,351 | 1,421 |
| ai/utility.ts | 2,305 | 836 |
| ai/perceive.ts | 2,220 | 411 |
| damage/state.ts | 1,750 | 564 |
| ai/actions.ts | 1,692 | 982 |
| damage/tuning.ts (parameter reads) | 508 | 360 |
| damage/fatigue.ts | 416 | 360 |
| rules/arenas/types.ts | 319 | 55 |
| damage/regions.ts | 331 | 183 |
| garbage collector | 346 | 319 |

Before the pass the single biggest cost was the AI re-reading its 30-second exchange
ledger: `signals()` asked for the hit rate of each of ~50 action families (two full scans
of a few hundred entries each) plus a `bestFamily` scan into a fresh Map — on every tick,
for every fighter, to feed an evaluation that happens every few seconds. That alone was
~22 % of all CPU. The next were the nineteen-axis utility score (a string `switch` and up
to fifteen `Set.has` calls per axis per candidate, for ~50 candidates a tick), the energy
model's fatigue index `f` (eight parameter-map reads, recomputed ~35 times per fighter per
tick), and per-tick string building for sided damage-state ids.

## 3. What changed

Every change preserves floating-point operation order (products multiply the same factors
in the same order; nothing was re-associated; no `Math.pow` was replaced by
multiplication), iteration order (fighters, candidates, Map insertion order where it
decides a tie) and RNG draw order.

**AI (P3)**

- `policy.evaluate`: `signals()` is pure, so it is built only after `evaluationDue` and the
  `pChange` roll pass instead of every tick.
- `ExchangeLedger` keeps running counts per kind and per (kind, family), updated by `note`
  and by window eviction; `hitRate`, `attempts`, `landed`, `cageExchanges` read integers.
  `bestFamily` computes the best rate from the counts and only consults the window (first
  appearance order) when two families tie. `paceEstimate` counts from a sorted index of
  strike-attempt times scanned back from the newest. Eviction splices in place instead of
  copying the window every tick.
- `OpponentModel.decay` walks only the contexts that have ever been noted: every other
  context's counts are exactly +0 and stay +0 under the decay (`0 * k = 0`).
- `ConsiderationScorer` (`ai/utility.ts`): per decision, each family's thirteen
  family-and-tick-dependent compensated factors are computed once; the per-candidate loop
  multiplies the same values in `CONSIDERATION_IDS` order. Family-set membership is one
  memoised bitmask per family; the compensation constant `1 - 1/sqrt(19)` is hoisted.
- Strike candidates: the filters that cannot change during a bout (tier, `counterOnly`,
  ruleset legality, tier repertoire) are computed once per fighter and ruleset;
  `rangeFitIn` takes the band and band limits the whole catalogue shares at one distance.
- `mk` fills the caller's fresh literal instead of spreading it into a second object (same
  keys, values and key order). `enumerateActions` appends with a loop instead of spread.
- `rankDefences` computes each defence's score once instead of inside every comparison
  (same comparator results, so the same permutation).
- `weightsFor` fills one scratch bundle that the scorer reads immediately.
- `isLegalUnderRuleset` reads the short legal-class list directly instead of building a Set
  per call; `bandIndex` is a Map lookup instead of `indexOf`.
- The live-fighter count for the draw budget is counted, not filtered into an array.

**Damage and energy (P2)**

- `EnergyState.f` is memoised against exactly its inputs (posture class, `pcr`, `lac`,
  `aer`, compared with `Object.is`); `fatigueCaps` is memoised on `f`; the body-mass cost
  multiplier (`Math.pow`) and the altitude multiplier are memoised on the profile fields
  they read.
- `sideId` returns memoised strings instead of concatenating (and then hashing) a new one
  for every sided state check; `['left', 'right']` literals in hot loops became `SIDES`.
- `recompute` folds the vision row straight into the capability vector.

**World and geometry**

- Arena polygons: edge angles and their sines/cosines are tabled once per side count with
  the same expressions (the same double in gives the same double out), removing ~50
  `Math.sin`/`Math.cos` calls per clamp.
- `nearestOpponent` and `liveTeams` no longer allocate filter arrays / Sets every tick.

**A memory lesson recorded for the next pass.** An early version reused one module-level
`Map` (cleared per call) in `familyShares`. That cut allocation but *tripled* the bytes
promoted to the old generation: every fresh backing table hanging off a long-lived Map
survives two scavenges and is tenured, so the old space filled with garbage and peak heap
rose from ~45 to ~75 MB. Short-lived scratch belongs in short-lived objects; it was
reverted, and promotion is back to the baseline 0.9 KB/tick.

## 4. Batch paths

- `scripts/batch/` (Node worker pool): workers are long-lived and reused for every bout;
  each job ships one `SimConfig` (a few KB) and returns one compact row, with the event log
  dropped inside the worker. The per-bout message cost is negligible next to the bout, so
  the throughput gain above is the sim's own. No change was needed.
- `src/app/workers/batchWorker.ts` / `batchProtocol.ts` (browser): workers are reused
  across chunks (a dynamic queue), bouts run unrecorded, and only a ~120-byte summary per
  bout crosses the thread boundary. One small possible saving, not made because `src/app`
  belongs to the UI pass: the chunk message carries the whole template (two fighter
  definitions) with every chunk of 4–8 bouts; sending it once per worker would trim a few
  KB per chunk. It does not affect throughput measurably.
- Snapshots are only built when recording, and stats are computed once at the end from the
  event log (a few ms per bout), so neither was worth changing.

## 5. What is left

The profile is now flat: the largest single items are candidate construction (~13 %),
the per-candidate score (~11 %), the damage capability recompute (~7 %) and ~660
parameter-map reads per tick spread across ~150 damage/fatigue parameters (~5 %). Further
gains would come from caching the tick-invariant parts of candidate construction per
fighter and node, and from reading the per-tick damage constants into fields once per bout
(the tuning is immutable within a bout). Both are larger refactors than this pass.

## 6. Reproducing

```
node scripts/dev/heavy.mjs npx tsx scripts/dev/sim-golden.ts --check tests/fixtures/sim-golden.json
node scripts/dev/heavy.mjs npx tsx scripts/dev/sim-golden.ts --write <outside-repo>/golden.json --all
node scripts/dev/heavy.mjs npx tsx scripts/dev/sim-bench.ts --n 10 --only 3r,5r,1v5
node scripts/dev/heavy.mjs npx tsx scripts/batch/run.ts --plan identical --n 1000 --seed perf-pass --out <dir> --max-workers 2
```

For before/after numbers, run the bench against a checkout of `2720d60` and the current
tree alternately; bundling it (`npx esbuild scripts/dev/sim-bench.ts --bundle
--platform=node --format=esm --outfile=bench.mjs`) removes tsx's loader from the timings
and gives the CPU profiler real line numbers.
