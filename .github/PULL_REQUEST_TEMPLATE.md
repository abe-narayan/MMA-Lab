# Pull request

## What this changes

<!-- One paragraph. What is different after this, and why. -->

## Type of change

- [ ] Documentation only
- [ ] UI / presentation (no effect on any simulation result)
- [ ] Simulation or parameter change (**changes model behaviour** - fill in the section below)
- [ ] Tests, scripts or tooling
- [ ] Dependency change

---

## Does this change model behaviour?

- [ ] **No.** No parameter, weight, technique definition, referee heuristic, resolution
      formula, tick-loop ordering or RNG draw was touched, and `npm run golden:check`
      reproduces the committed golden corpus (`tests/fixtures/sim-golden.json`) unchanged.
- [ ] **Yes.** `SIM_ENGINE_VERSION` (`src/sim/record/recorder.ts`) is bumped, the golden
      fixture is regenerated (`npx tsx scripts/dev/sim-golden.ts --write
      tests/fixtures/sim-golden.json`), and before/after calibration numbers are below.

If yes, run the same calibration batch before and after (same plan and seed, so the
bouts are common random numbers) and paste the report's delta table:

```sh
npm run batch -- --plan ufc_population --n 200 --seed cal-2026-09 --out runs/after
npm run calibrate:report -- runs/after --baseline runs/before
```

(docs/CALIBRATION.md, "How to run calibration", has the details and the governor.)

**Why the numbers moved, in your own words:**

<!--
Be honest about the size of the movement. In this project a single behavioural
tendency - when an untrained fighter reaches for a clinch - was worth more than fifty
percentage points at 1v5. If your change moves things a lot, that is information about
the model's fragility, not a discovery about fighting, and it should be described that
way.
-->

**New or changed constants** (all of them, with their old and new values):

<!-- Every one of these belongs in the src/sim/params registry with its unit and a
     provenance tag ([S: ...], [D: ...] or [E]). If a number is inline in the sim, this PR
     is not ready. -->

---

## Checks

- [ ] `npm test` - every test passes (they are all seeded; a failure is never flaky)
- [ ] `npm run build` - typecheck (`tsc --noEmit`) is clean and the build succeeds
- [ ] `npm run golden:check` - the golden corpus reproduces bit for bit, and each bout's
      recorded and unrecorded runs end on the same digest
- [ ] If the simulation changed on purpose: `SIM_ENGINE_VERSION` is bumped and the
      regenerated `tests/fixtures/sim-golden.json` is committed in this PR
- [ ] If the build changed: `npm run build:single` succeeds and `scripts/inline.mjs`
      reports no surviving markup reference

Paste anything interesting from the output:

```
```

---

## Project rules

Tick each one, or explain underneath why it does not apply.

- [ ] Every new or changed constant lives in the `src/sim/params/` registry, in the right
      chapter file, with its unit and a provenance tag. Nothing numeric was typed inline
      into the sim.
- [ ] No term gives any fighter an advantage that is not present in their definition.
      Nothing is keyed on fighter id, team, or which side someone is on.
- [ ] The tick-loop ordering in `src/sim/core/` is unchanged, or the change to it is
      called out explicitly above and the golden fixture was regenerated.
- [ ] No RNG draw was added, removed or reordered without bumping `SIM_ENGINE_VERSION`
      and regenerating the golden fixture.
- [ ] The engagement invariants (I1-I8, `tests/sim.core.test.ts`) still hold.
- [ ] Blood and injury depiction stays behind the viewer's blood/injury setting (restrained
      by default; docs/design/08_PRESENTATION.md), with no gore in the renderer, the copy or
      an asset.
- [ ] No runtime dependency was added, and nothing new is fetched from the network: the
      only runtime fetches are the 3D view's own files under `/assets/*` (`static/assets/`,
      each listed in `docs/ASSETS.md`).
- [ ] `src/sim` still has no DOM, no React and no import from `src/app` or
      `src/presentation`; the presentation never affects a result.
- [ ] No existing disclaimer was removed or weakened, and nothing in this PR presents a
      model output as a prediction about the real world.

## Anything a reviewer should be sceptical about

<!--
Optional but valued. The two real defects found in this project were both silent: no
crash, no type error, nothing obviously wrong on screen. If some part of this change is
only supported by "it looked right when I ran it", say so here.
-->
