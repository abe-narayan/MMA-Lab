# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

A note on what a version number means here: the numbers this project produces
are downstream of hand-chosen constants in `src/engine/params.ts`, so any
release that touches those constants changes the `paramsHash`, changes every
recorded bout, and is a breaking change to the shipped corpus whatever the
version number says.

## [1.0.0] - 2026-09-22

Initial public release.

### Added

- **Deterministic bout engine** (`src/engine/`). A fixed-timestep state machine
  at `dt = 0.1 s`, three rounds of 300 s with 60 s breaks. Every bout is a pure
  function of `(seed, params, profiles)`: no clock, no environment, no global
  state, every random draw taken from one seeded `sfc32` generator in a fixed
  order. The six-phase tick loop and its ordering are part of the determinism
  contract.
- **Every modelling assumption in one file** (`src/engine/params.ts`), grouped
  and documented field by field, so the whole assumption set can be read in one
  sitting and disagreed with individually. Nothing is fitted to real fight data.
- **Athlete profile derivation** (`src/engine/fighter.ts`). Body metrics, three
  one-rep-max lifts, training history and a conditioning label are translated
  into derived attributes through four stated rules - lifting strength enters
  only as relative strength on a log scale, experience saturates, Taekwondo is
  discounted to 0.6 of a boxing year for this ruleset, and conditioning changes
  stamina economy only. Each step is recorded in a `derivationNotes` array the
  Model tab renders verbatim.
- **Action catalogue** (`src/engine/actions.ts`): 23 actions, each a timed
  multi-tick commitment with an explicit `resolve` tick. The renderer reads the
  same numbers, so an animation's contact frame is the frame the engine
  resolved on.
- **Handicap exhibition formats** from 1v1 up to 1v5, with no "numbers bonus"
  constant. How many opponents can act at once is emergent from geometry and
  reach; only `teamSpreadRadians`, `swarmStaminaPenalty`, `focusPenaltyLogit`
  and the `1 / sqrt(engagedBy)` defensive-cover scaling are added, and all of
  them apply to whoever is outnumbered in either direction.
- **Replay format** (`src/engine/recorder.ts`): seed + full event timeline +
  rolling FNV-1a state digest, with a `paramsHash` so a replay recorded under
  one parameter set cannot be silently replayed under another. About 57x
  smaller than storing frames.
- **3D replay viewer** (`src/render/`). Plain Three.js, no scene-graph
  framework and no imports from `three/examples`. Octagonal cage, one primitive
  humanoid rig per fighter with mass-scaled proportions, orbit / top / side /
  follow cameras, and interpolated playback decoupled from the tick rate.
  Impacts are an abstract ring marker and a short camera shake.
- **React application shell** (`src/ui/`) with Replay, Dashboard and Model tabs,
  including hand-written inline SVG charts, Wilson intervals on the batch
  analytics, and a Model tab that shows every derived attribute alongside the
  exact arithmetic that produced it.
- **Shipped corpus** of 1,000 bouts per format (5,000 total) under master seed
  `bout-lab-v1`, params hash `47a2bb37`, stored in a compact columnar encoding
  that keeps the single-file build at 2.1 MB.
- **Single-file build.** `npm run build:single` inlines all JavaScript, CSS and
  assets into `dist/standalone.html`, which opens from a `file://` URL on a
  machine with no network connection. `scripts/inline.mjs` audits its own output
  and exits non-zero if any reference that would cause a network request
  survives.
- **Test suite**: 128 seeded tests across `rng`, `engine`, `determinism` and
  `analytics`. The determinism suite includes negative controls - tampering with
  the digest, seed, opponent count, a parameter override or a profile each flips
  `verified` to `false` - so the guarantee is not vacuous.
- **Scripts**: `generate`, `verify`, `consistency`, `exportBout`, `calibrate`,
  `smoke` and `inline`.
- **Documentation**: a README that states what the model is and is not, and
  `CONTRACT.md`, the frozen inter-module contract the implementation was built
  against.

### Fixed

Two genuine engine defects found during development. Both are documented in the
README because of what they say about the failure mode of this kind of model:
neither crashed, neither violated a type, and neither looked obviously wrong on
screen.

- **Grapple and clinch relationships could be left one-sided.** Engagement was
  represented as per-fighter flags with nothing forcing both ends of a
  relationship to agree. In a handicap format a third attacker could walk into
  an existing exchange and displace a partner, leaving a fighter flagged as
  being on `top` with nobody underneath; an in-flight clinch break resolving
  after a takedown could leave stale ground flags in place for thousands of
  frames. Fixed by three changes together: every teardown - `exitGround`,
  `stopFighter`, the knockdown path, `startRound` and the end-of-round break -
  now routes through a single `clearEngagement(f)` that clears posture, ground
  role, ground position, ground opponent, submission progress and the stall
  counters as a unit; `enterGround` frees both fighters' prior engagements,
  including the third party on the other end of one, before establishing the new
  pair; and `actionStillValid(f, d)` re-checks each action's preconditions on
  its resolution tick, so a multi-tick commitment whose world has changed aborts
  as a miss instead of resolving into a state it no longer belongs to. The
  invariant is now asserted in `tests/engine.test.ts` and swept exhaustively by
  `scripts/consistency.ts`: 0 violations in 892,126 frames.
- **The ground game was silently absent from every statistic.** The referee's
  stand-up-for-inactivity check compared `tick - lastStruckTick` against
  `standUpAfterStalledSeconds`, but `lastStruckTick` initialises to `-999`, so
  the difference exceeded the threshold from tick 1 and fighters were stood back
  up almost immediately after every takedown. Ground exchanges could effectively
  not happen at all, and every published statistic was produced by a model with
  an entire phase of the sport missing from it. Fixed by tracking genuine
  inactivity in a `groundStallTicks` counter that any landed ground strike,
  position improvement or submission work resets on both fighters. It is worth
  assuming there are other defects of this shape that have not been found yet.

### Notes

- Nothing in this release is fitted to real data, and no output of it should be
  read as a prediction about any real person, event or organisation.
- No injury, gore or medical outcome is modelled or depicted. The damage index
  is an abstract bookkeeping scalar whose only function is to trigger an
  administrative referee stoppage.
- The 1v4 and 1v5 win rates are illustrative of the model's dynamics and are not
  estimates of anything. They are dominated by assumptions about how untrained
  fighters choose actions: tightening the clinch-entry close-range factor alone
  moved the 1v5 A-win rate from 77% to 24%.
