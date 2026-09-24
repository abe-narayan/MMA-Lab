# Final-pass audit (committed tree, HEAD d470cc8)

Read-only audit made at the start of the overnight polish pass, verified against HEAD with `git grep` / `git show`. Items are the working checklist for the cleanup, determinism and documentation phases; each is marked when resolved in the commit that resolves it.

## Critical

- **C1. CI determinism checks cover the legacy v3 engine only.** The `determinism` CI job (`npm run generate` + `npm run verify`) and `npm run consistency`, plus `tests/determinism.test.ts` and `tests/rng.test.ts`, all import `src/engine/*` (v3). The v4 sim (`src/sim`) has no golden-digest check for fixed seeds across modes and rulesets. Files: `.github/workflows/ci.yml`, `scripts/{generate,verify,consistency}.ts`. **Resolved (cleanup):** the v3 job, scripts and tests are gone; CI's `determinism` job runs `tests/sim.golden.test.ts` and `npm run golden:check` (which also asserts recorded and unrecorded runs share a digest); `tests/rng.test.ts` now targets `src/sim/rng`.
- **C2. Locale-dependent tie-breaks in the sim.** `src/sim/striking/defence.ts:840` and `src/sim/striking/counters.ts:325` sort with `a.id.localeCompare(b.id)` (ICU/locale dependent). Use plain `<`/`>`. Cosmetic cases: `presentation/character/geom.ts:187`, `presentation/referee/clothing.ts:299`.
- **C3. The legacy v3 stack still ships.** `src/app/App.tsx:18-22` imports `ui/ReplayView`, `ui/Dashboard`, `ui/ModelNotes`, `ui/Controls`, `data/replays`, pulling in `src/engine` (~1.8k lines), `src/render` (~2.5k, a second three.js renderer), `src/replay/player.ts` and `src/data/replays.ts` (1.98 MB generated JSON). `npm run calibrate`, `scripts/exportBout.ts` and `scripts/consistency.ts` are v3-only but look current (the real calibration is `scripts/calibrate/*` + `scripts/batch/*`). **Resolved (cleanup):** `src/engine`, `src/render`, `src/ui`, `src/replay`, `src/data` and the v3-only scripts (`generate`, `verify`, `consistency`, `calibrate`, `exportBout`) are deleted; `npm run calibrate` removed in favour of `batch` + `calibrate:report`.
- **C4. Stale top-level docs.** README says all parameters live in `src/engine/params.ts`, describes a single abstract damage index with no blood or injury, "5,000 bouts in 2.1 MB, no network access", a three r169 badge and "128 passing"; the sim now models cuts, blood and injuries, the 3D view fetches `/assets/*`, three is ^0.186. `docs/PROGRESS.md` lists Phases 8–9 as not started. Mentions of `src/engine`/`params.ts`/`public/replays`: README 15, CONTRIBUTING 14, `docs/design/09` 18, CONTRACT 6, CHANGELOG 6, PR template 3. **Partly resolved (cleanup):** CONTRIBUTING, CHANGELOG, CONTRACT (marked historical), the PR and issue templates and 09 (status note) no longer point at `src/engine`/`public/replays`; README is left to the docs pass.

## High

- **H1. ~32 MB of `static/` is never loaded at runtime** (`publicDir: 'static'` copies all of it to `dist`). Shipped code loads only `canvas/normal`, `vinyl/normal`, `asphalt/{color,normal,roughness}` (`presentation/arena/assets.ts:47-52`) besides body/motion data. The 4 HDRIs (~11.3 MB) are used only by `dev/assets.ts`; metal, leather, satin, concrete, rubber_mat sets and canvas/vinyl color/roughness/ao are unused. **Resolved (cleanup):** HDRIs and every unloaded texture map/set deleted (31.0 MB); `manifest.ts` lists exactly the shipped maps and a test fails on any unlisted texture; `dev/assets.html` uses `RoomEnvironment`.
- **H2. Standalone build claim is false for the 3D view.** `scripts/inline.mjs` inlines scripts/CSS only; runtime fetches (`body.bin` 6 MB, `motion.bin`, textures) and the bout worker chunk are not handled; `main.tsx:4-6` says nothing talks to the network. **Resolved (cleanup):** `scripts/inline.mjs`, CI and CONTRIBUTING now describe the standalone page as a lite build (creator, sim, batch on the main thread, 2D view) and the script lists the worker chunks and `/assets/*` it does not carry; `main.tsx` comment corrected.
- **H3. Debug URL switches and window globals are live in production:** `?watchDemo ?view ?quality ?scale ?cam ?seek ?play ?demo` (`Watch.tsx:100-130`), `?placeholders ?gpuTiming ?stagePost` (`presenter.ts`), `?backend ?skinVelFix` (`stage/index.ts`); `window.__presenter`, `__ttff`, `__stats`, `__skinVelocityFix`. Gate behind `import.meta.env.DEV` or an explicit capture flag.
- **H4. Per-frame cost in the render hot path.** `Presenter.render()` calls `publishStats()` every frame (nested objects, string formatting, `animator.debug()` per fighter); `Watch.getPlayhead()` allocates per frame; `camera/director.ts` per-frame filter/map/spread copies; in 2D view `setAlpha` rerenders the whole Watch screen at 60 Hz.
- **H5. `Math.random()` in shipped `src/ui/ReplayView.tsx:288`** (legacy random-bout button). **Resolved (cleanup):** file deleted with `src/ui`.
- **H6. Cross-engine determinism.** The sim uses `Math.exp/pow/log/sin/atan2` in ~10 files; results are identical within one JS engine (worker and main thread) but not guaranteed across browsers, so shared replays may not reproduce between V8 and SpiderMonkey. Document the guarantee's scope. AI plan providers are registered by a side-effect import (`sim/ai/bindings.ts` via `core/bind.ts:26`).

## Medium

- **M1.** `presentation/arena/referee.ts` (placement/gesture logic, `RefereeTracker`) vs `presentation/referee/` (body, clothing, pose): sensible split, confusing names. `referee/index.ts` builds the body from `placeholders/debugSkeleton` on the shipped path.
- **M2.** Dead or test-only code: `src/sim/ai/multi.ts` (1,049 lines, only `tests/plans.test.ts` imports it; `bindings.ts:58-62` target provider TODO falls back to `tgt.nearest`), `src/ui/App.tsx` (unimported), `presentation/anim/synth.ts` (dev/tests only), `sim/fighter/legacy.ts` (tests only). Stale `TODO(chapter 0x)` notes: `grappling/engagement.ts:176,620`, `graph.ts:3233`, `record/snapshot.ts:187-232`, `grappling/resolve.ts:65-111`.
- **M3.** Files over 1,500 lines: `sim/grappling/graph.ts` 3,494 (best split candidate), `sim/submissions/catalogue.ts` 2,098, `sim/core/bind.ts` 1,692, `sim/fighter/derive.ts` 1,648, `sim/ai/policy.ts` 1,627, `sim/rules/referee.ts` 1,621.
- **M4.** Two replay players (`src/replay/player.ts` v3, `src/app/replay/player.ts` v4) and two HUDs (`src/ui/Hud.tsx`, `src/app/components/Hud.tsx`). **Resolved (cleanup):** the v3 player and HUD are deleted.
- **M5.** Stale comments: `vite.config.ts` names `base.bin` (real: `body.bin`); `App.tsx`/`main.tsx` "Phase 7 retires"; `data/replays.ts` mentions `public/replays/`. **Resolved (cleanup)** for `vite.config.ts`, `main.tsx` and `data/replays.ts` (deleted); `src/app` comments that still name the deleted v3 paths are listed in the cleanup report (not edited during the UI agent's run).
- **M6.** Wall clock in data: `recorder.ts:274` `meta.recordedAt` (outside the digest, documented); UI-created bouts seed from `Date.now()` (fine because the seed is saved with the draft).

## Low

- **L1.** Duplicated helpers: `clamp` in 25 files, `clamp01` 20, `lerp` 7, `wrapAngle` 4, `hashString` 2, `mulberry32` 2; three RNG homes (`sim/rng`, `engine/rng.ts` shim, `presentation/arena/rng.ts`).
- **L2.** `docs/screenshots` is 143 MB (152 PNGs); 17 (~7.9 MB) are referenced nowhere: `phase6-*` (2), `phase7b-watch*` (2), `phase8-assets-*` (7), `phase8-polish-velocity-*` (2), `phase8-stage-pipeline-{low,replay}`, `phase8-stage-watch-{3d,placeholders}`. **Resolved (cleanup):** 11 deleted (`phase6-*`, `phase7b-watch*`, `phase8-assets-*`, 4.1 MB). The other 6 are referenced from PHASE8_NOTES by shorthand (`-pipeline-low.png`, `phase8-polish-velocity-{before,after}.png`, ...) and are kept.
- **L3.** One-off probes in `scripts/dev`: `ref-state.ts`, `ref-state2.ts`, `checkids.ts`, `trace.ts`, `fk-check.ts`, `ik-check.ts`, `facing-check.ts`, `strike-range.ts`, plus `scripts/assets/probe-body.ts`, `shots.sh`. Keep documented tools: `heavy.mjs`, `shot.mjs`, `polish-shots.mjs`, `load-timeline.mjs`, `qa-*` (listed in QA_FINDINGS), `probe.ts`, `forces.ts`, `style.ts`, `tiers.ts`. **Resolved (cleanup):** the ten listed probes deleted (nothing referenced them).
- **L4.** ~1,100 exported names unused outside their file (heuristic scan): hides the real public API.
- **L5.** `package.json` placeholder `USERNAME` repository/bugs/homepage URLs. **Resolved (cleanup):** fields removed (no repository URL is known).
- **L6.** `src/sim/rng/index.ts` is 2 lines (fine).
- **L7.** Mark `docs/AUDIT.md` (Phase 0) as historical. **Resolved (cleanup).**

## Architecture map (HEAD line counts)

| Module | Responsibility | Key files | Lines |
|---|---|---|---|
| src/sim/ai | decisions, scouting, plans, adaptation | policy.ts 1627, plan.ts 1069, multi.ts 1049 (unwired) | 10,051 |
| src/sim/grappling | position graph, engagements, ground-and-pound | graph.ts 3494 | 5,960 |
| src/sim/fighter | fighter model, derived attributes, tiers, archetypes | derive.ts 1648, archetypes.ts 1165, tiers.ts 1088 | 5,162 |
| src/sim/submissions | catalogue, stages, finishes | catalogue.ts 2098, stages.ts 1045 | 4,890 |
| src/sim/striking | catalogue, resolution, defence, combos | resolve.ts 975, catalogue.ts 965 | 4,730 |
| src/sim/rules | rulesets, referee, judges, arenas | referee.ts 1621, judges.ts 1020 | 4,684 |
| src/sim/params | parameter registry | submissions.params.ts 983 | 4,518 |
| src/sim/damage | damage, fatigue, knockouts, observables | state.ts 1357 | 3,564 |
| src/sim/core | tick loop, binding, scheduler | bind.ts 1692 | 3,394 |
| src/sim/record, commentary, rng | replay v4, frames, commentary, RNG | recorder.ts, frames.ts, generate.ts 980 | 2,138 / 1,883 / 130 |
| src/presentation/anim | procedural, mocap and grapple animation | strikes.ts 1049 | 11,152 |
| src/presentation/character | body, skin, kit, hair, eyes | actor.ts, skinMaterial.ts, kit.ts | 5,042 |
| src/presentation/arena | venues, crowd, lighting, referee placement | referee.ts 556 | 4,898 |
| src/presentation/camera | broadcast director, planner, replay | planner.ts 916, director.ts 903 | 3,488 |
| src/presentation/{stage,rig,referee,corner,placeholders,assets} | renderer + post, skeleton/IK, referee body, corners, fallbacks, manifest | presenter.ts + contract.ts 915 | 1,521 / 1,339 / 926 / 381 / 851 / 697 |
| src/app | shell, screens, components, model, store, replay, run + worker | FighterCreator.tsx 1279, Watch.tsx 948, validate.ts 1134 | ~17,900 |
| Legacy v3 (src/engine, render, ui, replay, data) | old engine, renderer and UI, still bundled | engine.ts 1017, fighterRig.ts 1155, Dashboard.tsx 913, replays.ts (1.98 MB) | 1,821 / 2,524 / 3,420 / 117 / 89 |
| tests / scripts / dev | vitest, CLI + batch/calibration, lookdev pages | — | 20,199 / 9,940 / 3,914 |

`src` ≈ 110k lines; `static/` 47.4 MB; `docs/screenshots` 142.8 MB.
