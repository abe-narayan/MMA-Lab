# Independent review — Phases 8 and 9 (committed code at d470cc8)

Scope: committed code only (`git show HEAD:`), because other agents were editing the working tree during the review. The review read code and ran only small experiments, using a HEAD export in the scratchpad. Line numbers are HEAD line numbers.

Findings are ranked by severity. "Verified" means the reviewer reproduced the problem or traced it end to end in the code.

---

## HIGH

### H1. In a real browser the Worker never receives the bout: `runBout` hangs forever (verified)
`src/app/run/runBout.ts:98-159`

- **What is wrong:** `runBout` builds `message` (line 99), creates the Worker and attaches `onmessage` and `onerror`, but never calls `worker.postMessage(message)`. The only `postMessage` in the file is the cancel message (line 131). This bug dates back to Phase 7 (0540e9a); Phase 9 changed the same block (`fromWire`) and did not notice.
- **What happens:**
  - The worker loads and sits idle, so the promise never settles.
  - Match setup, History "Watch" and Tournament "Run" all get stuck on "Running…".
  - In Tournaments, every Run button stays disabled (`running !== null`).
- **Why tests miss it:** they only exercise `forceMainThread: true` (tests/match.setup.test.ts:782) or drive `createRunner` directly.
- **Fix:** add `worker.postMessage(message)` after the handlers are attached, then add a test with a fake `Worker` global that checks the run message is posted.

### H2. The significant-strike rule makes nearly every strike "significant", so rows 5–7 can never calibrate (verified)
`src/sim/record/stats.ts:182-185`, mirrored in `scripts/batch/summarize.ts:53-55`

- **The design rule:** 09 §4.1 says sig = every strike at distance, plus *power* strikes in clinch or on the ground. "Short/non-power clinch and ground strikes are total-only."
- **What the code does:** `isSignificant` returns true for everything except ids that start with `tech.jab`. So `tech.gnp_punch`, `tech.gnp_hammerfist`, `tech.bottom_punch` (a half-force jab-row strike) and clinch hooks and uppercuts all count as significant.
- **Evidence:** the committed baseline (docs/CALIBRATION.md) reports sig:total = **0.97** against a target of 0.72 (row 7). It also reports total landed/min 1.98 against 5.4 (row 5).
- **Why it matters for calibration:** under this definition no amount of behaviour tuning reaches 0.72, because the non-sig bucket is structurally near empty. Tuning rows 5 and 7 would push strike volume or accuracy toward the wrong number.
- **Knock-on effects:** the definition also inflates clinch and ground sig counts. That affects rows 16, 18, 19, 22, 23 and 81, and the ground/clinch accuracy targets.
- **Fix:** define significance per technique (for example a `power`/`short` flag in the technique and GnP tables), mark short GnP, bottom and clinch-short strikes as total-only, and keep summarize.ts calling the *same* exported function instead of restating it.
- **Note:** `src/sim/record/stats.ts` is being edited in the working tree, so coordinate before changing it.

### H3. Switching bouts leaves the old venue in the scene (verified)
`src/presentation/arena/index.ts:508-525` (`Venue.dispose`), `src/presentation/presenter.ts:412-427` (`clearBout`)

- **What is wrong:** `Venue.dispose()` disposes geometry, materials and the environment, but never removes `object3d` from the scene. `clearBout` does not remove it either. Actors, corner, referee and the placeholder arena all remove themselves; the venue does not.
- **What happens:** Watch stays mounted and `Arena3D` has no `key`, so opening a second bout leaves the old cage or ring, crowd, LED boards and light rig in the scene. The light rig includes a second shadow-casting key light. three re-uploads the disposed resources on the next draw, so two venues render, lighting doubles and draw calls and memory grow with every switch.
- **Fix:** add `this.object3d.removeFromParent()` in `Venue.dispose()`.

---

## MEDIUM

### M1. A reserved key in an imported fighter crashes the validator and aborts the whole import (verified)
`src/app/store/validate.ts:436-445`, `:490`

- **What is wrong:** `DISCIPLINE_KEYS` is a plain object literal. For a discipline key such as `toString`, `constructor`, `hasOwnProperty` or `__proto__`, `DISCIPLINE_KEYS[key]` returns an inherited value instead of `undefined`. `SUB_SKILLS[canonical]` is then `undefined`, and `expected.includes` throws.
- **Reproduced:** `validateFighter` and `importAll` both throw `Cannot read properties of undefined (reading 'filter')`.
- **What happens:** `FighterDatabase.onImportFile` catches the error, but the whole file is rejected with a cryptic message, including every valid fighter in it. The creator's live validation can hit the same throw.
- **Same pattern elsewhere:** `io.ts` `result.renamed` is a plain `{}`, so `renamed[id] ?? id` maps ids like `constructor` to `Object`.
- **Fix:** use `Object.hasOwn(DISCIPLINE_KEYS, key)` (or a `Map` / `Object.create(null)`), and do the same for `renamed`. Wrap each fighter's validation in try/catch so one bad entry only skips itself.

### M2. Presentation leaks GPU resources on every bout switch (from the presentation sub-review; M2a verified by reading)
- **M2a. Arena textures used through TSL nodes are never disposed** (`arena/index.ts:516-518` vs `materials.ts:110,143,317`). `Venue.dispose` only disposes textures that are direct properties of a material. It misses:
  - the 2048²/4096² floor canvas textures
  - the LED board texture
  - the loaded arena JPEGs

  Fix: track every created texture (as `extraTextures` already does).
- **M2b. A new character factory is built for every bout and never disposed** (`presenter.ts:267`, `character/index.ts:29-59`). Each switch re-fetches and re-decodes the mask JPEGs, rebuilds the 2048² skin maps, detail textures and materials, and never frees them. `FighterActor.dispose` skips materials because they are "owned by the factory". Fix: create the factory once per presenter, or give it a `dispose()`.
- **M2c. `StagePipeline` leaks post nodes** (`pipeline.ts:287,304`). The `smaa()` nodes (up to 3, each with 2 render targets plus area and search textures) and the motion-blur `rtt()` are not in `disposables`, so every quality or render-scale change leaks them.

### M3. A failure in `setBout` or the warm-up leaves Watch on "Preparing broadcast…" for good
`src/app/components/Arena3D.tsx:213-215`

- **What is wrong:** the catch only logs with `console.error`. The loop never starts, `onUnavailable` is never called (so there is no 2D fallback), and a pending QA play never fires.
- **Calls that are not guarded:**
  - in `setBout`: `animator.setBout`, `camera.setBout` (which runs `planShots`), `createRefereeActor` and `applyShadowPolicy`
  - WebGL2 shader or node build errors, which surface in `warmUpAsync`
- **Fix:** in the catch (when not cancelled), set a failed status and call `onUnavailable(msg)`.

### M4. A quality change during a bout switch can leave an orphan referee in the scene
`src/presentation/presenter.ts:516-526, 301`

- **What is wrong:** `clearBout` does not null `this.factory`. A `setQuality` that runs while `setBout(B)` is awaiting therefore rebuilds actors and a referee from the old factory. `setBout` then overwrites `this.referee` (line 301) without disposing the one `setQuality` built, so it stays in the scene at rest pose.
- **Fix:** null the factory in `clearBout`, skip rebuilds while `setBout` is in flight, and dispose the old referee before reassigning it.

### M5. No handling for WebGPU device loss or WebGL context loss
`src/presentation/stage/index.ts:117-157`

- **What is wrong:** nothing sets `renderer.onDeviceLost` or listens for `webglcontextlost`.
- **What happens:** after a GPU reset or TDR the rAF loop renders into a dead device, logging errors every frame, with no recovery and no 2D fallback.

### M6. `scripts/dev/heavy.mjs`: argument mangling and lock reclaim (from the batch sub-review; verified by reading)
- **M6a. Arguments are mangled** (`heavy.mjs:142`). `spawn(cmd[0], args, { shell: true })` joins the arguments unquoted. An argument with a space splits in two, and `&`, `|` or `>` run extra commands. The sub-reviewer reproduced this: `"pre-tuning baseline" "a&b"` reached the child as three arguments, and `b` then ran as its own command. Node also prints DEP0190. Fix: quote each argument for cmd.exe, or spawn without a shell using `npx.cmd`.
- **M6b. Live locks are reclaimed after 30 minutes** (`heavy.mjs:93`). Staleness is judged only by the lock dir's mtime, which is never refreshed, so any job over 30 minutes (a real calibration batch) loses its slot. `release()` then deletes the *next* owner's lock. Together these break the 93 % cap coordination. A hard kill on Windows (TerminateProcess) also leaks the slot for 30 minutes. Fix: write the pid into the lock, reclaim only when that pid is dead, and in `release()` delete only a lock we still own.
- **M6c. Memory is checked before the slot is taken** (`heavy.mjs:103-104`). Two waiters can both pass `memoryAllows()` in the same poll window, each needing 1.6 GB, while only 1.6 GB of headroom exists.

### M7. Batch runner resume and stop edge cases (from the batch sub-review)
- **M7a. `--resume` without manifest.json re-runs every bout** (`scripts/batch/batch.ts:120`; verified). Completed rows are only loaded when the manifest exists. Without it, every bout is re-run and appended to results.jsonl, and `readResults` and the report do no de-duplication by `(cell,i)`, so every metric counts those bouts twice. Fix: read results whenever `--resume` is set and fail if the manifest is missing; de-duplicate by `rowKey` in `readResults`.
- **M7b. Ctrl-C is ignored while the pool is paused** (`pool.ts:92-100,192-201`). `stop` only takes effect inside `dispatch`/`checkDone`, and nothing calls those while paused. A second Ctrl-C exits without writing the manifest session.
- **M7c. A pause can last forever with no log output** (`monitor.ts:107-110`). The hysteresis resumes a single worker only below 91 %, so RAM that settles at 91–93 % never resumes. The "waiting" log only fires at zero workers.
- **M7d. A job-construction error crashes the process** (`plans.ts` `buildJob` throw, called from `pool.ts:204` inside event handlers). The process dies with no manifest session written and in-flight rows lost.
- **M7e. Crash handling is too coarse** (`pool.ts:155-167`):
  - a single global crash counter (21 unrelated crashes abort a long run)
  - no per-job timeout
  - workers are not terminated when the run aborts

### M8. Tournament results are written back to a stale bracket copy
`src/app/screens/Tournaments.tsx:217-302`

- **What is wrong:** the `.then` writes `{...t, bracket: …}` using the `t` captured when the match started.
- **Failure scenario:** buttons are disabled while one match runs, but navigating away and back resets `running`. If a second match is then started, whichever match finishes last overwrites the other's result (lost update).
- **Fix:** re-read the tournament from `matchStore` inside the callback.

---

## LOW

- **L1. FrameStore `push` throws after `view()` exists** (`frames.ts:635`; verified). `(this.viewCache).length = this.n` goes through the Proxy's `set` trap, which is `readOnly`, so it throws "Recorded frames are read-only". This is latent today because all callers create the view after the last push, but any future live or streaming recording would break. Fix: set `target.length` on the kept target array, not through the proxy.
- **L2. `pack()` transfers the live chunk buffers** (`frames.ts:720-734`; verified). Afterwards the source store still reports its length but decodes `undefined` (`get(3).tick === undefined`), and a second pack throws DataCloneError. `FrameStore.from(view)` returns the same store, so `packFrames(run.frames)` on the main thread would silently destroy the Watch screen's frames. Only the worker does this today. Fix: mark the store as detached and throw on use, or copy the buffers when the caller keeps the store.
- **L3. Decoded frames are cached and shared by reference** (`frames.ts:639-651`). A consumer that mutates a frame changes later reads of that index. No committed consumer mutates one (checked). Consider `Object.freeze` in dev builds.
- **L4. Row 48 and the finish rows include non-strike stoppages.**
  - `startsWith('tko')` includes `tko.doctor`, `tko.corner` and `tko.retirement` in "strikes in final 30 s before TKO" (metrics.ts:440). For stoppages between rounds, the 30 s window is break time or the end of the previous round.
  - summarize.ts:356-365 records the "finishing strike" (rows 27–29, 82, 83) for those same stoppages as the winner's last landed strike, which is often from an earlier round.
  - Fix: restrict both to `ko`/`tko`.
- **L5. Round-robin ties are broken by alphabetical id** (`bracket.ts:503-505`). Because every match now gets a winner, all entrants have played the same number of matches. "Fewest losses" is therefore redundant, and a multi-way tie on wins goes to the alphabetically first id. Head-to-head or the fight-stat tie-break would be fairer.
- **L6. Presentation per-frame allocations** (from the presentation sub-review): `animator.evaluate` (Map, Set, Float64Array and three V3 arrays per fighter per frame), `director` `sight`/occlusion (`segSeg` allocates 5 arrays per call, thousands per frame while occlusion avoidance is active), `arena.feedOccluders`, and `skinnedVelocity` (`new Set` plus a full `scene.traverse` every frame). This is steady GC churn at 60 fps; hoist the scratch buffers.
- **L7. Other presentation lows:**
  - `Arena3D` calls `setRecording` before `setBout`, which runs a wasted `planShots` over the whole recording against the old arena.
  - Concurrent `precompile` when bouts are switched quickly.
  - A failed motion-library load is cached for the session (`motionLibrary.ts:513`).
  - `Stage.create` leaks the renderer and canvas if `rebuild()` throws after `init()`.
- **L8. Batch lows:**
  - A Ctrl-C'd run exits 0 (`run.ts:97`).
  - Resuming with a smaller `--n` keeps the rows beyond it.
  - `readResults` does not sort, so report tie orders depend on file order. An experiment with one plan was byte-identical across orders.
  - The pool can shrink to zero workers (retiring slots are counted in the `<= 1` guard).
- **L9. `importJson` silently drops the imported presets, tournaments and history.** App.tsx:119-131 only creates fighters.

---

## Checked and found sound

- **Determinism:**
  - No `Math.random`, `Date.now` or `performance.now` in `src/sim`, `scripts/batch` result rows, `scripts/calibrate`, `app/model` or `app/replay`. The clock appears only in manifests, logs, `recordedAt` meta and the tournament id (which is then saved).
  - Presentation never writes into snapshots, events or sim state (searched), and `src/sim` imports nothing from presentation.
  - The worker runner slices only *when* `step()` runs.
- **FrameStore round-trip (experiment on a full 4,008-frame 1v1):**
  - Every field decodes with no shape differences.
  - The maximum error is 7.63e-6 on the unorm 16-bit fields, as claimed (1/131,070).
  - Float32 fields are within 1.5e-7.
  - `tick`, `t` and `roundTime` are exact, and there were no fallback exceptions in a normal bout.
  - Values outside 0–1 (for example `damage.head` > 1), fractions in int columns and extra keys fall back to verbatim storage correctly. The only unorm-encoded fields are ones the contract defines as 0–1.
  - Interning keys keep strings, numbers, null and NaN apart. The small ref-key collisions (−0 vs 0; NaN vs null *inside* objects) do not occur in current ref fields.
  - `toWire`/`fromWire` decode exactly what was packed.
- **Bracket model:**
  - Seed derivation is deterministic (`matchSeed` suffix only from attempt ≥ 1), and `flatMatchIndex` is stable.
  - `entrantIds` is the *seeded* order, so the higher-seed tie-break is right.
  - The tie-break order (KD, sig landed, TD landed, sub attempts, control, seed) matches its documentation.
  - Double-elimination drop mapping, byes (`autoAdvance`) and round-robin circle scheduling with an odd count are correct.
  - The rematch counter rule gives a tie-break on the 3rd level run.
- **Validator bounds (QA-12/13/14):** the new ranges are correct and inclusive at the hard lower bounds. `stanceExposure` may omit a side, and the derivation defaults it.
- **Calibration metrics:** all 129 rows were read against FIGHT_DATA §3 and 09 §7.1.
  - Pooled per-fighter-minute rates use Σ/Σ(2 × fight minutes, breaks excluded), which matches the [GH]/[GH-G] definitions.
  - Per-15 rates match GH-G's "(Σboth/2)/min × 15".
  - Row 50 uses per-fighter-bout rates, which matches HTE's (range 0–51).
  - KD rows use the right tuple fields (`by` = x[2], kind = x[5]); head-kind filtering is applied where the source is head-strike based.
  - Decision rows exclude technical decisions and draws correctly.
  - The class-row quota (≥ 6/8 men, all but one women) matches the §7.1 preamble.
  - Estimators (Wilson, delta-method ratio) and the §6.6 verdict rule are correct.
  - Beyond H2 and L4, no definition errors were found. Rows 36/38 use documented approximations (all head-kind KDs; per-round scaling).
- **Batch runner:** partial last line repaired on resume; stable row keys and seeds; seed, params and engine checks on resume; no duplicate rows within a session; CPU and RAM sampling correct on Windows.
- **Presentation lifecycle:** StrictMode double mount, `ResizeObserver`, rAF, free-camera listeners, Watch key and rAF hooks, the `boutToken` guard against stale `setBout`, asset-failure fallbacks (procedural materials, debug skeletons, placeholders, procedural animation) and the WebGPU → WebGL2 fallback path are all handled.
