# Final review: overnight session (`2720d60..HEAD`, HEAD = fdc9dfd)

This is an independent, read-only review of the committed tree. It covers src/app, src/presentation, scripts/batch, CI and package.json. Line numbers refer to HEAD.

To check CI, I ran the committed tree as an export: `git archive HEAD` into a scratch directory, with node_modules linked.
- `tsc --noEmit` passed.
- `npm run golden:check` passed: 41/41 bouts identical, and the recorded and unrecorded runs agree.
- `vitest run` results are at the end of this file.

## Bugs, ranked by severity

### 1. A second "New fighter" silently overwrites the first (data loss)
- **Where:** `src/app/App.tsx:155` binds `blank: () => blankFighter()`, and `src/app/store/defaults.ts:43` defaults the id to `'fighter.new'`. `bindStore.save` (`App.tsx:133-137`) then routes an existing id to `updateFighter`.
- **Repro:** Fighters → New fighter → rename → Save. Then New fighter again → rename → Save. The first custom fighter is replaced. The editor key is the same both times, so it does not even remount.
- **Fix:** `blank: () => blankFighter(idFromName('new', Date.now().toString(36)))`, or have `save` treat an id it did not load as a create.

### 2. "Discard and leave" does not discard, and the unsaved-changes guard stays off afterwards
- **Where:** `App.tsx:249-262` (`changeTab`) calls `setCreatorDirty(false)`. The creator panel stays mounted, because panels persist once visited. `FighterCreator.tsx:387` reports `dirty` only when the value changes.
- **Repro:**
  1. Edit a fighter.
  2. Click Match setup and choose "Discard and leave".
  3. Go back to the Fighter editor. The edits are still there and there is no nav dot.
  4. Edit more, then leave. There is no prompt.
  5. Click Edit on another fighter. The editor remounts and all of that work is gone.
- **Fix:** on confirm, really discard: `setEditing(null)`, or bump a reset key on `<FighterCreator>`.

### 3. Ctrl+Z / Ctrl+Y edit the hidden fighter draft from any other screen
- **Where:** `FighterCreator.tsx:371-383`. The `window` keydown listener is not gated on the tab being visible, and the creator stays mounted while hidden. Watch gates its own listener with `active` (`Watch.tsx:673`); the creator does not.
- **Repro:** edit a fighter, go to Match setup or Batch, focus a select, a button or the page body, then press Ctrl+Z. The hidden draft is undone. Ctrl+Y is also swallowed with `preventDefault` on every screen.
- **Fix:** pass `active={tab === 'creator'}` and return early when it is false.

### 4. Number fields clamp on every keystroke, so many values cannot be typed
- **Where:** `FighterCreator.tsx:159,178` (`NumberField` commits `clampNumber` in `onChange`) and `ui/primitives.tsx:306-309` (the Slider's number box).
- **Repro:** weight has a minimum of 40. Select the value and type `75`. The `7` becomes 40 immediately, and then `405` clamps to the maximum. Age and height behave the same way.
- **Fix:** keep a local string while typing, and clamp only on blur or Enter.

### 5. Additive "air" layers add into the normal and velocity render targets (WebGPU High/Medium)
The presentation sub-review found this. I checked the code and it is highly plausible.
- **Where:** `stage/pipeline.ts:268-269,284` now blends the `normal` and `velocity` MRT outputs with `MaterialBlending`. `arena/materials.ts:35-38` `airMRT()` overrides only `output` and `normal`, with a vec3 whose alpha is therefore 1. It is used by the haze column (`venue.ts:162`), the light shafts (`venue.ts:230`) and the lamp halos (`street.ts:219`).
- **Effect:**
  - Normal: the up-normal is added onto the surface normal behind the layer, so the GTAO input saturates.
  - Velocity: the layer's motion vector is added to the background's, which gives TAA ghosting behind the haze during camera moves.
- **Repro:** cage venue with a moving camera. Compare `?stagePost=view:velocity` with `?mrtBlend=0`.
- **Fix:** have `airMRT()` return `mrt({ output, normal: vec4(0), velocity: vec4(0) })`, which adds nothing under additive blending.

### 6. The toast "Undo" undoes the latest edit, not the action it names
- **Where:** `FighterCreator.tsx:470,525,531` (`onAction: undo`).
- **Repro:** remove a discipline, move a slider, then click Undo on the "Removed ..." toast. The slider move is undone and the discipline stays deleted.
- **Fix:** capture `const before = draftRef.current` and use `onAction: () => update(() => before)`.

### 7. Batch results relabel themselves after the run
- **Where:** `screens/BatchSim.tsx:171`. `names` comes from the *current* corner selections. `exportCsv` (`:165`) likewise names the file from the current `master` input.
- **Repro:** run a batch, then change Red corner. The finished results now show the new fighter's name against the old fighter's win probability. Changing the seed field changes the CSV file name.
- **Fix:** store the names and seed in the `finished` phase (`{ outcome, agg, names, master }`) and render from that.

### 8. Low severity
- **`store/io.ts:123-131` (`freeId`):** the `" (imported)"` suffix is added after the ID_MAX (160) check, so an imported id near 160 characters is stored over the limit and every later Save fails validation. Fix: truncate before adding the suffix.
- **`FighterCreator.tsx:480,492`:** "Save as copy" and saving a built-in change the id, so the editor remounts and the "You are now editing the copy" message never shows.
- **Stale editor baseline:** renaming or deleting a fighter in the database while it is open in the editor leaves the old baseline. The next Save restores the old name or re-creates the deleted fighter.
- **Batch cancel on the main-thread fallback (`run/batchRun.ts:153-167`):** `cancel()` settles the batch at once, but `runOnMain` finishes its current chunk of up to 8 bouts, because the inner runner is never sent `cancel`. The results are discarded, so this only wastes CPU. Fix: call `runner.handle({ type: 'cancel', jobId })` in `cancel()`.
- **`methodClass` (`model/batchModel.ts:41-46`):** `dq`, `escaped` and `separated` fall into `'draw'`. A DQ win is then counted as a "decision" in `aggregate` (line 193) and shown under "Draw / NC". Only the labels are affected.
- **`stage/profiles.ts:196-223` `probeGpu`:** if it throws, the render target is not restored and `rt`, `mat` and `tex` are not disposed. This is latent, because nothing calls `Stage.recommendQuality()`. Fix: restore and dispose in `finally`.
- **`stage/index.ts:270`:** GPU dynamic resolution re-seeds on a shot-name change without a cut, which can cause a visible resolution pop. Fix: gate on `s.cut` only.
- **`arena/materials.ts:375,378`:** the fence normal has alpha 1 and so fully replaces the normal behind it, contrary to its own comment. Fix: output `vec4(0.5, 0.5, 1, opacity)`.
- **`ui/overlays.tsx:195-203` `useConfirm`:** a second `confirm()` issued before the first resolves orphans the first promise. Nothing does that today.
- **`scripts/batch/run.ts:7`:** the usage text still shows `[--affinity 3F]`, but the default is now `1F`. Documentation only.

## Checked and found sound
- **package.json and ci.yml:** every script path exists at HEAD. That covers `scripts/batch/run.ts`, `scripts/calibrate/report.ts`, `scripts/dev/sim-golden.ts` and its lib, `tests/fixtures/sim-golden.json`, `tests/sim.golden.test.ts`, `scripts/inline.mjs`, and every module those scripts import. The removed `generate`, `verify` and `consistency` scripts are no longer referenced by CI.
- **Determinism:**
  - There is no `Math.random`, `Date.now` or `performance.now` anywhere in `src/sim`. The sim changes in this range reproduce the regenerated golden corpus bit for bit.
  - Batch seeds are `boutSeed(master, 'batch', i)` whichever worker runs a bout, and `aggregate` and `fingerprint` sort by index. Worker count therefore cannot change the numbers.
  - Presentation randomness (`arena/marks.ts`) is hashed from the cosmetic seed and the tick.
- **Batch orchestrator (`run/batchRun.ts`):**
  - A dead worker's unfinished indices go back on the queue, and when every worker is gone the rest falls back to the main thread.
  - Messages from other job ids, or arriving after the batch settles, are ignored.
  - `finish` is idempotent and terminates every worker.
  - Cancelling on unmount is wired (`BatchSim.tsx:95`).
  - A worker that fails to start falls back cleanly, including `file://` in the lite page.
- **Watch:**
  - `startSpeed` snaps the start speed to `SPEED_STEPS`.
  - The recommended-quality callback is dropped after dispose (`Arena3D.tsx:202`).
  - The keyboard listener is gated on `active`.
  - The quality choice is persisted separately.
- **Replay library `resultLine`:** team winners and draws are handled. There is no serialization change.
- **Import hardening:** the own-key lookups in `validate.ts` and `io.ts` close off the `__proto__` / `toString` keys. The preview-to-import index mapping is correct.
- **Tournaments and History:** result commits re-read the live bracket, and Delete + Undo and clear-all + Undo both work.
- **Presentation disposal:**
  - `lensDof.ts` frees its 3 render targets and 3 materials, and clamps a zero-size resize.
  - In `pipeline.ts`, the new passes are pushed to `disposables`, and the MRT cache is keyed on the output layout.
  - In `programSharing.ts`, buffer names are distinct and installation is idempotent.
  - `dynres.ts` guards against NaN and zero samples.
  - No new listeners or observers were added.
- **Overlays:** the dialog's focus trap and focus return work, and toast timers are cleared.

## Full test suite (vitest)
The suite on the HEAD export had not finished when I handed back: 192 tests had passed and 0 had failed at that point. The full log is at scratchpad/head/vitest.log.
