# Contributing to Bout Lab

Thanks for looking at this. Before anything else, please read
[the disclaimer at the top of the README](README.md#read-this-before-you-read-anything-else)
and take it literally. This is a modelling toy. Every probability, coefficient
and threshold in it is a hand-chosen assumption, nothing is fitted to real fight
data, and the output describes `src/engine/params.ts` rather than the world.
Contributions are very welcome; contributions that quietly turn it into
something that looks like a predictor are not.

The most useful contribution is usually not code. It is an argued case that one
of the constants in `src/engine/params.ts` is wrong, with the reasoning written
down. There is an issue template for exactly that.

---

## Setting up

Node 22 is required. `scripts/inline.mjs` is ESM with no dependencies outside
`node:` builtins and assumes a Node 22 runtime; the rest of the toolchain is
Vite 5 / TypeScript 5 / Vitest 2.

```bash
npm install            # no network access is used at runtime, only at install
npm run generate       # regenerate the replay corpus + src/data/replays.ts
npm run dev            # development server on http://localhost:5173
```

`npm run generate` is not optional on a fresh clone if you intend to change the
engine - see [The determinism contract](#the-determinism-contract) below. If you
are only touching the UI or the renderer, the committed corpus is enough.

Other scripts:

```bash
npm run build          # tsc --noEmit, then vite build to dist/
npm run build:single   # build, then inline everything into dist/standalone.html
npm run preview        # serve the production build on http://localhost:4173
```

## Checks to run before opening a PR

```bash
npm test               # 128 tests across four suites, all seeded
npm run build          # this is the typecheck: tsc --noEmit runs first
npm run verify         # re-execute stored replays + a fresh sample
npm run consistency    # grappling-pair invariant sweep
```

All four must pass. None of them is flaky: every test is seeded, so a failure is
always reproducible and always means something.

`npm run verify` re-executes every replay in `public/replays/*.json` plus a
regenerated sample per format, and compares digest, frame count, event count and
result. `npm run consistency` sweeps 60 bouts x 5 formats frame by frame and
exits non-zero on the first violation of the grappling invariant.

## Repository layout

The full tree is in the [README](README.md#project-structure). The short version
of what lives where, and what that implies for a change:

| path | what it is | what you need to know |
| --- | --- | --- |
| `src/engine/params.ts` | every modelling assumption, in one file | new constants go here, never inline |
| `src/engine/engine.ts` | the fixed-timestep state machine | the tick-loop ordering is a contract, see below |
| `src/engine/fighter.ts` | athlete profile -> derived attributes | each step is a judgement call and is annotated as one |
| `src/engine/actions.ts` | the action catalogue, durations in ticks | the renderer reads the same numbers |
| `src/engine/rng.ts` | seeded sfc32 + FNV-1a state digest | every draw is ordered; do not add a second source of randomness |
| `src/engine/recorder.ts` | `ReplayFile`, analytics, `boutSeed()` | changing the replay format is a breaking change to the corpus |
| `src/replay/`, `src/render/` | player transport and the Three.js renderer | display only; must never affect a result |
| `src/ui/` | the React shell (Replay / Dashboard / Model tabs) | |
| `tests/` | four seeded suites | `determinism.test.ts` is the load-bearing one |
| `scripts/` | generate, verify, consistency, export, inline | |
| `CONTRACT.md` | the frozen inter-module contract the implementation was built against | |

`CONTRACT.md` is deliberately frozen. If a change requires the contract to move,
say so explicitly in the PR rather than editing it in passing.

---

## The rules that actually matter here

### The determinism contract

Every bout is a pure function of `(seed, params, profiles)`. The engine reads no
clock, no environment and no global state, and takes every random draw from one
seeded generator in a fixed order.

**The six-phase tick-loop ordering in `src/engine/engine.ts` is part of that
contract.** Clock and round management, per-fighter upkeep, action advance and
resolution in ascending fighter id, steering and integration, referee checks,
digest update - in that order, every tick. Reordering those phases, or changing
the iteration order within one of them, does not "slightly adjust" the model: it
changes every bout that has ever been recorded and invalidates the shipped
corpus. So does inserting or removing an RNG draw anywhere in the loop.

If you change anything in the engine, the workflow is:

```bash
npm run generate       # rebuild the corpus and src/data/replays.ts
npm run verify         # prove the new corpus re-executes to itself
npm test
npm run consistency
```

Skipping `npm run generate` leaves a corpus whose digests no longer match the
code, and `npm run verify` will tell you so. Commit the regenerated corpus with
the change that caused it, in the same PR.

Changing any parameter changes the `paramsHash` stored in every replay file, so
a replay recorded under one parameter set can never be silently replayed under
another. That is working as intended; it is not a merge conflict to paper over.

### Every parameter goes in `params.ts`

One file holds every assumption. That is the whole basis on which a reader can
disagree with this model in one sitting, and it stops being true the first time
a magic number is typed into the engine.

So: no new numeric constant may appear inline in `src/engine/engine.ts`,
`fighter.ts` or anywhere else in the engine. It goes in `src/engine/params.ts`,
in the group it belongs to, with a comment that says **what it means, what unit
it is in, and that it is an assumption**. If you cannot write that comment
honestly, that is information about the change.

Follow the existing tone. `// logit penalty per unit of attacker fatigue (0-1)`
is the house style; `// tuning` is not.

### No hidden advantage

**Never add a term that gives either athlete an advantage that is not present in
their profile.** Everything a fighter is good at has to trace back through
`deriveAttributes` to body metrics, lifts, training history or the conditioning
label. No constant may be keyed on which fighter it is, on `id === 0`, on team,
or on anything else that amounts to putting a thumb on the scale.

The same applies in the other direction to the handicap formats. There is
deliberately no "numbers bonus" constant; how many opponents can act on the lone
fighter at once is emergent from geometry and reach. If you find yourself adding
one, the PR needs to argue for it in the open.

The gap between the two columns in the derived-attributes table exists because
of the profile inputs and four stated translation rules. It must stay that way.

### The grappling engagement invariant

Grappling is the one place where a fighter's state is not private: being on top
only means something if somebody is underneath. The engine maintains a hard
invariant that the renderer and the analytics layer are allowed to rely on:

> In every frame: the grounded fighters decompose exactly into `top`/`bottom`
> pairs (equal counts, each with a single partner recorded in `groundOpponent`);
> the number of fighters in the clinch is even; and `groundRole` /
> `groundPosition` are `'none'` on everyone who is not on the floor.

Three mechanisms enforce it, and all three must survive your change:

1. **One teardown path.** Everything that ends a grapple or clinch routes
   through `clearEngagement(f)`. Do not add a second way to half-release a
   fighter.
2. **Entry frees both sides first.** `enterGround` clears any engagement either
   fighter was already in, including the third party on the other end of it.
3. **Preconditions are re-checked on the resolution tick.** `actionStillValid(f, d)`
   re-tests an action's preconditions at the moment it resolves, so a multi-tick
   commitment aborts as a miss rather than resolving into a state it no longer
   belongs to.

Check it with:

```bash
npm run consistency
# grappling-pair invariant: 0 violations in 892126 frames
```

`tests/engine.test.ts` asserts the same invariant as ordinary regression tests.
This invariant was broken once already and it did not crash, did not look wrong
on screen and was caught only by the sweep. Treat a violation as a real defect,
never as a tolerance to widen.

### If your PR changes model behaviour, report the numbers

Any change that can move an outcome - a parameter, a weight, an action
definition, a referee heuristic, a resolution formula - must state **what the
win rates were before and after**, per format. The cheapest way to get them:

```bash
N=200 npx tsx scripts/calibrate.ts      # batch statistics per format
```

Paste both tables into the PR. This is not bureaucracy. The single most
important finding in this project is that tightening one behavioural tendency -
when an untrained fighter reaches for a clinch - moved the 1v5 A-win rate from
77% to 24% with nothing changed about strength, mass, reach or any striking
parameter. Changes here are not local, and a PR that does not show the movement
is hiding the only thing that would let a reviewer judge it.

If the number moves a lot, that is information about the model's fragility. It
is not a discovery about fighting, and the PR should not describe it as one.

### No gore, injury depiction or medical modelling

This is a hard line, in the engine and in the renderer.

The model carries a single abstract scalar called the **damage index**. Its only
function is to trigger an administrative referee stoppage. It does not represent
a wound, a diagnosis, a medical state or any lasting harm.

Not accepted, in code, in the renderer, in copy or in an asset:

- blood, wounds, swelling, cuts, bruising or any visual injury depiction
- ragdoll physics, death states, or a fighter who does not get up
- any named injury, medical outcome, diagnosis, recovery time or long-term harm
- renaming the damage index to something clinical, or adding a second scalar
  that models anything medical
- pain, distress or suffering as a modelled quantity

Impacts stay an abstract ring marker and a short camera shake. A stopped fighter
is faded out and seated at the cage edge. The scope of the model is regulated
competition with a referee and a doctor present, and it stays there.

### No network, ever, and no dependency the single-file build cannot inline

Two constraints, both enforced:

- **The page must never make a network request.** No CDN imports, no web fonts,
  no telemetry, no analytics, no external assets, no `fetch` at runtime.
  `scripts/inline.mjs` re-reads its own output and exits non-zero if any script,
  link, image, media, CSS `url()`, `@import` or sibling-chunk import would still
  hit the network.
- **No runtime dependency may be added that the single-file build cannot
  inline.** The renderer is plain Three.js with no imports from
  `three/examples`, and orbit control is about forty lines of pointer-drag maths
  written by hand, specifically so that nothing has to be resolved at runtime. A
  dependency that ships worker files, wasm fetched at load, dynamic imports by
  URL or a runtime asset pipeline cannot go in.

Dev dependencies are a different matter and are judged normally. Runtime
dependencies are close to a closed set: React, React DOM and Three.

---

## Style and scope

- TypeScript is `strict`. `npm run build` runs `tsc --noEmit` first; keep it
  clean rather than reaching for `any` or a `@ts-expect-error`.
- The engine has no DOM and no React, and imports nothing from `src/ui` or
  `src/render`. It runs identically in Node and in the browser, which is the
  only reason the test suite can check the same code the page runs. Keep it that
  way.
- Charts are hand-written inline SVG in `src/ui/charts.tsx`. That is a
  consequence of the no-runtime-dependency rule, not an accident.
- British spelling in prose, to match what is already there.
- Keep the honest register. Where the README says a number was chosen and not
  measured, it means it, and new documentation should read the same way.

## Reporting a bug

Use the bug report template. Every bout is reproducible from three things - the
**seed**, the **format** (1v1 to 1v5) and the **bout index** - so please include
all three. With those, anyone can get the identical bout:

```bash
npx tsx scripts/exportBout.ts 3 42     # full tick-by-tick dump of bout 42, 1v3
```

## Arguing with an assumption

Use the modelling-question template. Name the parameter in
`src/engine/params.ts`, say what you think it should be, and say what evidence
or reasoning supports that. "This produces a bout that looks implausible on
screen" is a legitimate argument here and is, honestly, how most of the current
values were chosen - but say so plainly rather than presenting it as data.

Please do not open issues asking the project to predict a real matchup, to model
a named person, or to be validated against real fight records. That is not what
this is, and the README says so at length.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you are expected to uphold it.
