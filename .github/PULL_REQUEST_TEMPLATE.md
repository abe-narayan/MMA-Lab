# Pull request

## What this changes

<!-- One paragraph. What is different after this, and why. -->

## Type of change

- [ ] Documentation only
- [ ] UI / renderer (no effect on any simulation result)
- [ ] Engine or parameter change (**changes model behaviour** - fill in the section below)
- [ ] Tests, scripts or tooling
- [ ] Dependency change

---

## Does this change model behaviour?

- [ ] **No.** No parameter, weight, action definition, referee heuristic, resolution
      formula, tick-loop ordering or RNG draw was touched, and `npm run verify` passes
      against the committed corpus unchanged.
- [ ] **Yes.** Before/after win rates are below.

If yes, paste both tables. `N=200 npx tsx scripts/calibrate.ts` is the cheapest way to
get them.

| format | A wins before | A wins after |
| --- | --- | --- |
| 1v1 |  |  |
| 1v2 |  |  |
| 1v3 |  |  |
| 1v4 |  |  |
| 1v5 |  |  |

**Why the numbers moved, in your own words:**

<!--
Be honest about the size of the movement. In this project a single behavioural
tendency - when an untrained fighter reaches for a clinch - was worth more than fifty
percentage points at 1v5. If your change moves things a lot, that is information about
the model's fragility, not a discovery about fighting, and it should be described that
way.
-->

**New or changed constants** (all of them, with their old and new values):

<!-- Every one of these belongs in src/engine/params.ts with a comment saying it is an
     assumption. If a number is inline in the engine, this PR is not ready. -->

---

## Checks

- [ ] `npm test` - all 128 tests pass
- [ ] `npm run build` - typecheck (`tsc --noEmit`) is clean and the build succeeds
- [ ] `npm run verify` - every stored replay and a fresh sample re-execute to matching
      digests
- [ ] `npm run consistency` - grappling-pair invariant sweep reports 0 violations
- [ ] If the engine changed: `npm run generate` was re-run and the regenerated corpus
      (including `src/data/replays.ts`) is committed in this PR
- [ ] If the build changed: `npm run build:single` succeeds and `scripts/inline.mjs`
      reports no surviving network reference

Paste anything interesting from the output:

```
```

---

## Project rules

Tick each one, or explain underneath why it does not apply.

- [ ] Every new or changed constant lives in `src/engine/params.ts`, in the right group,
      with a comment saying what it means, what unit it is in, and that it is an
      assumption. Nothing numeric was typed inline into the engine.
- [ ] No term gives either athlete an advantage that is not present in their profile.
      Nothing is keyed on fighter id, team, or which side someone is on.
- [ ] The six-phase tick-loop ordering in `src/engine/engine.ts` is unchanged, or the
      change to it is called out explicitly above and the corpus was regenerated.
- [ ] No RNG draw was added, removed or reordered without regenerating the corpus.
- [ ] The grappling engagement invariant still holds: one teardown path through
      `clearEngagement`, `enterGround` frees both sides first, preconditions re-checked
      on the resolution tick.
- [ ] No gore, injury depiction or medical modelling was added, in the engine, the
      renderer, the copy or an asset. Impacts remain abstract.
- [ ] No runtime dependency was added that the single-file build cannot inline, and the
      page still makes zero network requests.
- [ ] The engine still has no DOM and no React, and imports nothing from `src/ui` or
      `src/render`.
- [ ] No existing disclaimer was removed or weakened, and nothing in this PR presents a
      model output as a prediction about the real world.

## Anything a reviewer should be sceptical about

<!--
Optional but valued. The two real defects found in this project were both silent: no
crash, no type error, nothing obviously wrong on screen. If some part of this change is
only supported by "it looked right when I ran it", say so here.
-->
