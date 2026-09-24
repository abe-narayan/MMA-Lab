# Contributing to Bout Lab

Thanks for looking at this. Before anything else, please read
[the disclaimer at the top of the README](README.md#read-this-before-you-read-anything-else)
and take it literally. This is a modelling toy. Every probability, coefficient
and threshold in it is a modelling assumption, and the output describes the
parameter registry in `src/sim/params/` rather than the world.
Contributions are very welcome; contributions that quietly turn it into
something that looks like a predictor are not.

The most useful contribution is usually not code. It is an argued case that one
of the parameters in `src/sim/params/` is wrong, with the reasoning written
down. There is an issue template for exactly that.

---

## Setting up

Node 20.19 or later is required (CI uses Node 22). `scripts/inline.mjs` is ESM
with no dependencies outside `node:` builtins; the rest of the toolchain is
Vite 5 / TypeScript 5 / Vitest 2.

```bash
npm install
npm run dev            # development server on http://localhost:5173
```

Other scripts:

```bash
npm run build          # tsc --noEmit, then vite build to dist/
npm run build:single   # build, then inline scripts and CSS into dist/standalone.html
npm run preview        # serve the production build on http://localhost:4173
npm run golden:check   # re-run the committed golden corpus bit for bit
npm run batch          # headless calibration batches (scripts/batch/, see docs/CALIBRATION.md)
npm run calibrate:report  # calibration report from a batch run directory
```

`dist/standalone.html` is a lite page: opened from disk it runs the fighter
creator, the simulator, batches (on the main thread) and the 2D view. The 3D
broadcast view loads its body mesh, motion library, textures and font from
`/assets/*` at runtime, so for the full app serve `dist/` (`npm run preview`).

On a shared or small machine, run heavy commands (tsc, vitest, builds, batches)
through the resource governor: `node scripts/dev/heavy.mjs <command...>`.

## Checks to run before opening a PR

```bash
npm test               # every suite, all seeded
npm run build          # this is the typecheck: tsc --noEmit runs first
npm run golden:check   # the golden corpus reproduces bit for bit
```

All three must pass. None of them is flaky: every test is seeded, so a failure is
always reproducible and always means something.

`npm run golden:check` re-simulates the ~40 bouts in
`tests/fixtures/sim-golden.json` (every ruleset, the multi-fighter modes, crowd and
street, extreme builds, non-default timesteps) and compares the digest, tick and
RNG-draw counts and hashes of the result, the event log, the stats and every
recorded frame. It also checks that each bout's recorded run and its unrecorded
hot path (what batches use) end on the same digest. `tests/sim.golden.test.ts`
runs the same comparison inside `npm test`, and CI runs both.

## Repository layout

The full tree is in the [README](README.md#project-structure). The short version
of what lives where, and what that implies for a change:

| path | what it is | what you need to know |
| --- | --- | --- |
| `src/sim/params/` | the parameter registry: every tunable number, with unit and provenance tag | new constants go here, never inline |
| `src/sim/core/` | the fixed-timestep tick loop (`loop.ts`), world state, scheduler, invariants | the phase order is a contract, see below |
| `src/sim/fighter/` | fighter definitions -> derived runtime attributes, tiers, archetypes | each step is a judgement call and is annotated as one |
| `src/sim/striking/`, `grappling/`, `submissions/`, `damage/`, `rules/`, `ai/` | the model, one design chapter each (docs/design/01-07) | |
| `src/sim/rng/` | seeded generator + state digest | every draw is ordered; do not add a second source of randomness |
| `src/sim/record/` | the v4 replay format (`ReplayFileV4`), recorder, `verifyReplay`, `SIM_ENGINE_VERSION` | changing results means bumping the engine version |
| `src/presentation/` | the three.js broadcast view (arena, characters, animation, camera, stage) | display only; must never affect a result |
| `src/app/` | the React app: creator, database, match setup, Watch, batch, tournaments | |
| `tests/` | vitest suites, all seeded | `sim.golden.test.ts` and `sim.core.test.ts` are the load-bearing ones |
| `scripts/` | batch runner, calibration report, asset pipeline, dev probes, `inline.mjs` | |
| `docs/design/` | the design chapters the sim and presentation implement | |
| `docs/CONTRACT.md` | the frozen v3 inter-module contract (historical) | |

`docs/CONTRACT.md` is kept frozen as a record of the v3 build. The live contracts
are the design chapters and `src/presentation/contract.ts`; if a change requires
one of those to move, say so explicitly in the PR rather than editing it in passing.

---

## The rules that actually matter here

### The determinism contract

Every bout is a pure function of its config (fighters, mode, ruleset, arena,
match settings, parameter overrides) and its seed. The sim reads no clock, no
environment and no global state, and takes every random draw from one seeded
generator in a fixed order.

**The tick-loop phase order in `src/sim/core/loop.ts` is part of that
contract.** Clock, perception, upkeep, decide, resolve, move, referee, judges,
commentary, digest - in that order, every tick, with every loop over fighters in
ascending id and every queued contact resolved in (time, actor, sequence) order.
Reordering those phases, or changing the iteration order within one of them,
does not "slightly adjust" the model: it changes every bout that has ever been
recorded. So does inserting or removing an RNG draw anywhere in the loop.

If you change results on purpose, the workflow is:

```bash
# 1. bump SIM_ENGINE_VERSION in src/sim/record/recorder.ts
# 2. regenerate the golden fixture
npx tsx scripts/dev/sim-golden.ts --write tests/fixtures/sim-golden.json
# 3. check
npm test
npm run golden:check
```

Commit the regenerated fixture with the change that caused it, in the same PR.
If you did **not** mean to change results and `golden:check` fails, the change
altered the simulation: it prints every differing field.

A replay file records the engine version it was made with. `verifyReplay`
re-simulates it and reports a digest or version mismatch instead of silently
replaying a bout under different rules. That is working as intended; it is not a
conflict to paper over.

Scope of the guarantee: results are bit-identical within one JavaScript engine
(worker and main thread, Node and Chromium, all V8). The sim uses `Math.exp`,
`Math.pow` and friends, which the language does not require to be bit-identical
across engines, so a replay recorded in one browser family is not guaranteed to
re-verify in another.

### Every parameter goes in the registry

Every tunable number lives in `src/sim/params/`, in the chapter file it belongs
to, with its **unit** and a **provenance tag**: `[S: source §n]` for a sourced
value, `[D: ...]` for one derived from others, `[E]` for an estimate. That is
the whole basis on which a reader can disagree with this model one number at a
time, and it stops being true the first time a magic number is typed into the
sim.

So: no new numeric constant may appear inline in `src/sim/`. If you cannot write
an honest tag for it, that is information about the change.

### No hidden advantage

**Never add a term that gives a fighter an advantage that is not present in
their definition.** Everything a fighter is good at has to trace back through
`src/sim/fighter/derive.ts` to their body, disciplines, skills, age and style. No
constant may be keyed on which fighter it is, on `id === 0`, on team, or on
anything else that amounts to putting a thumb on the scale.

The same applies in the other direction to the handicap formats. There is
deliberately no "numbers bonus" constant; how many opponents can act on the lone
fighter at once is emergent from geometry and reach. If you find yourself adding
one, the PR needs to argue for it in the open.

### The engagement invariants

Grappling is the one place where a fighter's state is not private: being on top
only means something if somebody is underneath. The sim maintains the
engagement invariants I1-I8 of docs/design/09 §1.6 (`src/sim/core/invariants.ts`):
engagements are owned by one registry (`src/sim/grappling/engagement.ts`) rather
than by per-fighter flags, so the two ends of a grapple or clinch cannot
disagree. The renderer and the analytics are allowed to rely on them.

`tests/sim.core.test.ts` sweeps them across every mode. The v3 engine broke its
version of this invariant once, and it did not crash, did not look wrong on
screen and was caught only by a sweep. Treat a violation as a real defect, never
as a tolerance to widen.

### If your PR changes model behaviour, report the numbers

Any change that can move an outcome - a parameter, a weight, a technique
definition, a referee heuristic, a resolution formula - must state **what the
calibration numbers were before and after**. Run the same batch plan with the
same seed before and after (the bouts are then common random numbers) and paste
the report's delta table:

```bash
npm run batch -- --plan ufc_population --n 200 --seed cal-2026-09 --out runs/after
npm run calibrate:report -- runs/after --baseline runs/before
```

docs/CALIBRATION.md, "How to run calibration", has the plans and flags. This is
not bureaucracy. In the v3 engine, tightening one behavioural tendency - when an
untrained fighter reaches for a clinch - moved a handicap-format win rate from
77% to 24% with nothing changed about strength, mass, reach or any striking
parameter. Changes here are not local, and a PR that does not show the movement
is hiding the only thing that would let a reviewer judge it.

If the number moves a lot, that is information about the model's fragility. It
is not a discovery about fighting, and the PR should not describe it as one.

### Blood and injury stay restrained

The sim models damage by region, cuts and injuries because referees and doctors
stop fights for them. The presentation shows them only as far as the viewer's
blood/injury setting allows (restrained by default; docs/design/08_PRESENTATION.md),
and the setting has no effect on the simulation. Not accepted, in code, copy or
an asset: gore, lingering on injury, or language that glorifies harm. The scope
of the model is regulated competition with a referee and a doctor present (plus
the separately documented street mode, written in a restrained register).

### Network and runtime dependencies

- **No telemetry, analytics, CDN imports or remote fonts.** The only runtime
  fetches are the 3D view's own files under `/assets/*` (`static/assets/`),
  each of which must be listed with its source and licence in `docs/ASSETS.md`.
  Anything in `static/` ships, so it holds only files the runtime loads.
- **Runtime dependencies are close to a closed set:** React, React DOM and
  three. Dev dependencies are judged normally.

---

## Style and scope

- TypeScript is `strict`. `npm run build` runs `tsc --noEmit` first; keep it
  clean rather than reaching for `any` or a `@ts-expect-error`.
- `src/sim` has no DOM and no React, and imports nothing from `src/app` or
  `src/presentation`. It runs identically in Node, in a worker and on the main
  thread, which is the only reason the test suite can check the same code the
  page runs. Keep it that way.
- Charts are hand-written inline SVG. That is a consequence of the
  no-runtime-dependency rule, not an accident.
- British spelling in prose, to match what is already there.
- Keep the honest register. Where the README says a number was chosen and not
  measured, it means it, and new documentation should read the same way.

## Reporting a bug

Use the bug report template. Every bout is reproducible from its replay file:
the download button on the Watch screen saves a `.boutreplay` file with the seed
and the full setup, and importing it (Watch, Library) re-simulates the identical
bout. Please attach it.

## Arguing with an assumption

Use the modelling-question template. Name the parameter id in
`src/sim/params/`, say what you think it should be, and say what evidence
or reasoning supports that. "This produces a bout that looks implausible on
screen" is a legitimate argument here and is, honestly, how most of the current
values were chosen - but say so plainly rather than presenting it as data.

Please do not open issues asking the project to predict a real matchup, to model
a named person, or to be validated against real fight records. That is not what
this is, and the README says so at length.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you are expected to uphold it.
