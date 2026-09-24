# QA2: browser stress test and bug hunt

Independent browser-level QA of the app, run 2026-09-24 with headless Chromium on the real GPU (ANGLE/D3D11 + WebGPU, Intel Arc 140V).
Every run went through `scripts/dev/heavy.mjs`, one browser at a time. Each harness also had its own RAM watchdog. It first stopped runs at 92.5 %, later at 90 %. Peak machine RAM seen was 93.6 %, once, when another agent's load and a GPU leak run overlapped; that run stopped itself.

**Build under test.** The working tree as of ~11:27, in two forms:
- **Snapshot:** built with `vite build` into the scratchpad and served to Playwright through request interception, with no server process. Every finding below is measured on this unless the row says otherwise.
- **Shared dev server (5180):** used for smoke tests only. It was unreliable while other agents edited:
  - HMR reloads came mid-test, and one module failed to transform (a 500).
  - `corner/index.ts` was served stale for about 30 minutes. It called `displayed()`, but the served copy had no definition, so every bout logged "corner staging failed: displayed is not defined". It has since cleared.
  - The 3D view on the dev server never reached a first frame, because of depth-stencil "Required member is undefined" pipeline errors. The snapshot of the same tree rendered cleanly.

  So the dev-server-only errors are **not** reported as bugs.

**Scripts** (all in `scripts/dev/`): `qa2-lib.mjs` (harness; `QA2_SNAP=1` selects the snapshot), `qa2-smoke`, `qa2-watch`, `qa2-toggle`, `qa2-quality`, `qa2-fighters`, `qa2-fighters2`, `qa2-modes`, `qa2-cancel`, `qa2-cancel2`, `qa2-leak`, `qa2-leak-attrib`, `qa2-leak-types`, `qa2-batch`, `qa2-refresh`, `qa2-sigcount.ts`, `qa2-teamwin.ts`.

## Findings, ranked

| # | Sev. | What | Repro | Evidence | Suspected root cause |
|---|---|---|---|---|---|
| 1 | **critical** | **The WebGPU 3D view never comes back after a presenter rebuild or a pipeline rebuild.** Switching 3D → 2D → 3D at Medium or High leaves it on "Preparing broadcast… Compiling shaders · 22–27 %" indefinitely (more than 90 s, 2 of 2 cycles). The same failure happens in about half of in-place bout switches: in 6 of 13 Re-watch switches the bout never finished loading within 120 s. | Watch → View settings → 2D board → 3D broadcast (`qa2-toggle.mjs high` or `medium`). Bout switching: `qa2-leak.mjs 24`. | 22–23 errors per cycle: `Render pipeline creation failed … Color target has no corresponding fragment stage output but writeMask … is not zero. While validating targets[1]`, then `Async render pipeline creation failed` for skin, cloth (`cloth-trousers-corner0c`) and standard/physical materials. On switches, `Destroyed texture [Texture "depth"/"normal"/"velocity"] used in a submit` also appears. **Low quality recovers** (no MRT outputs), and **WebGL2 recovers** (High: 2 of 2 cycles, 0 errors; 14 of 14 switches OK). | The WebGPU MRT scene pass (`stage/pipeline.ts` ~250–292: `output` + `normal` + `velocity` targets) meets materials or programs whose fragment stage does not write target 1. It only happens once something has already been compiled (a second presenter, a quality rebuild, a new bout). **Ruled out:** the module-level `MRT_CACHE` (`pipeline.ts:198`). Disabling it in a patched copy of the bundle did not help. **Candidates:** program/node caches shared across render contexts. That includes the prototype patches in `stage/programSharing.ts` (shared uniform names and canonical code order can make two builds' code collide) and `stage/skinnedVelocity.ts` (its comment says "a program built for another pass may be the one reused"). The "Destroyed texture" errors suggest the old pipeline's render targets are disposed while a submit still references them (`StagePipeline` rebuild during `setBout` or `setQuality`). |
| 2 | **major** | **Quality switching during playback crashes or freezes on both backends.** A shadow-map size change throws an uncaught `TypeError: Cannot read properties of null (reading 'depthTexture') at updateShadow`. On WebGPU the first switches LOW→HIGH, →ULTRA and →MEDIUM rendered **0 frames for more than 7 s**. On WebGL2 one switching run had a **15.9 s main-thread long task**. | Watch, play, View settings → Quality: low → high → ultra → medium → low → ultra → … (`qa2-quality.mjs switch`, plus `webgl2`). | WebGPU: 93 errors in 12 switches (MRT errors as in #1, plus 3× the `depthTexture` page error). WebGL2: the `depthTexture` page error on low→ultra, low→medium and ultra→medium, which are exactly the switches that change `shadowMapSize`. | `presentation/arena/lighting.ts:57-60`, `configureShadow`: when the size changes it calls `l.shadow.map?.dispose()` and sets `l.shadow.map = null` itself. In three's WebGPU renderer the ShadowNode owns that render target, and its `updateShadow` then dereferences null. The freeze is synchronous shader compilation on the new preset (no warm-up on a quality change). |
| 3 | **major** | **Memory and GPU leak when switching bouts in Watch.** Every Re-watch leaves the previous bout's scene graph alive. | Run N bouts, then Re-watch each from History (`qa2-leak.mjs 14 --webgl`, `qa2-leak-types.mjs 5`). | WebGL2, 14 switches, heap **after forced GC** 42 → **182 MB** (about +10 MB per switch). Renderer geometries 111 → 659, textures 62 → 122. DOM nodes (~2,600) and listeners (~300) flat. Scene graph constant (~380 objects), but live JS objects kept growing: Object3D 483 → 3,197, BufferGeometry 141 → 896, Material 82 → 237, Texture 90 → 241, BufferAttribute 670 → 5,023 over 5 switches. Only 1 Presenter alive. WebGPU: geometries 59 → 919 and programs 85 → 345 over 12 switches. | Something outside the scene keeps references to every old bout's objects. The Presenter itself is not duplicated, and `clearBout` (`presenter.ts:538`) disposes actors, arena, referee and corner. Look for module-level registries that hold per-bout Object3Ds or materials and are never cleared on dispose. **Candidates:** `referee/clothing.ts:420` (`materials` Map; keys include corner/colour variants), the character module factory kept per presenter (`moduleFactory`, M2b) caching per-bout bodies, the crowd/corner crew (`corner/crew.ts`), and director or overlay references. A CDP heap snapshot's retainers of an old `SkinnedMesh` will pin it. |
| 4 | **major** | **Team bouts that a team wins are shown as "No contest"** on the Result screen and in History. | Teams 1v3 (seed `qa2-Teams-1v3`), 3v3, 2v2 with default archetypes. | UI: "No contest · KO (strikes)", "No contest · TKO (hurt and not defending)", "No contest · Time limit reached (team scoring)". Sim (`qa2-teamwin.ts`, same digests 9cc31ee9, 17991b77, 91e854fb): `winner: 'none', winningTeam: 0`. | `src/app/screens/BoutResult.tsx:72-76` `winnerLabel` treats `winner === 'none'` as no contest and ignores `winningTeam`. Also used in `History.tsx:258` and by the library's `resultLine` (`replay/library.ts:59`, which prints "· none"). Related sim inconsistency: QA-10 in `QA_FINDINGS.md`. |
| 5 | **major (UX)** | **Long names break dialogs and the page layout.** A 300-character name, which Rename accepts, pushes the Delete confirm dialog's buttons off-screen, so they can't be clicked. A 2,000-character name in an imported file hides the "Import" button the same way. A 100,000-character name pushes the whole import preview outside the viewport, leaving a dimmed page with no visible dialog. | Fighters → Rename to `'x'×300` → Delete. Import a fighter with `name: 'L'×2000` or `'W'×100000` (`qa2-fighters.mjs`, `qa2-fighters2.mjs`). | Screenshots `fighters-fail-6.png` and `fighters-fail-16.png` (scratchpad). The fighter table also overflows horizontally. | `src/app/theme.css:975-996`: `.ui-dialog-backdrop { display:grid; place-items:center }` with no `min-width:0` or `overflow-wrap:anywhere` on `.ui-dialog` or its title, so an unbreakable string sets the dialog's minimum width. `src/app/store/validate.ts:276` checks that `name` is a non-empty string but sets no maximum length, and neither does the editor's Name input nor the Rename field. |
| 6 | minor | **The fighter bar's significant strikes disagree with the Stats tab** (for example 104/**162** vs 104/**161** at the end of the demo bout). | Watch the demo bout `?watchDemo=1&demo=qa2-watch:3:5` → end → compare the right fighter bar with Analytics → Stats. | Sim level (`qa2-sigcount.ts`): in **16 of 30** bouts the attempts differ by 1–2 at the end, including decisions. Landed always matches. | Two counters: the snapshot counts `sigAttempted` when the strike is **thrown** (`src/sim/core/bind.ts:941`, posture at throw time), while `computeStats` counts at the **contact event** (`src/sim/record/stats.ts:368`, position from the pair node). Strikes interrupted before contact (a stoppage, the bell, a scramble), or classified differently, count in one and not the other. The fighter bar reads the snapshot (`replay/viewModel.ts:150`). |
| 7 | minor | **Double-clicking "Run bout" runs nothing,** with no message. | Match setup → double-click Run bout (`qa2-cancel.mjs`). | No progress, no result, no History entry. Geometry while running: Run moves from x=1315 to 1238 and **Cancel** appears at x=1353, where the Run button was, so the second click cancels. Single click and real Cancel both work: the bout stops, the button resets, and a re-run takes 3 s. | `MatchSetup.tsx:199-212`: the Cancel button is inserted into the right-aligned `.page-actions` beside Run. The cancelled branch (`:179`) also shows no "Cancelled" notice. |
| 8 | minor | **Stacked scrubber markers can't be clicked.** Events close in time overlap exactly; the knockdown at R3 1:07 sits under the finish marker at 1:06. | Demo bout (`qa2-watch.mjs`): 3 of 12 markers could not be clicked. | Playwright: the element is visible but another marker intercepts the click. `[` `]` and `,` `.` still reach them. | `components/watch/Scrubber.tsx:57-65` places each marker at `left: at%` with no collision handling or stacking (`watch.css:250-276`). |
| 9 | minor | **"Playback speed" in Match setup does nothing.** Its help says "0.1× to 8×", but no code reads `settings.speed`. Watch always starts at 1× and tops out at 4×. | Match setup → Playback speed 8× → run → Watch. | `grep settings.speed src` finds only the select. | `MatchSetup.tsx:540-546`; `model/matchModel.ts:501` help text. |
| 10 | minor | The Watch clocks read differently: the transport shows "R3 · 1:06" (time remaining), the centre card "3:54 Final" (elapsed), and the finish graphic "ROUND 3 · 3:55". The library row prints raw method ids ("DECISION.UNANIMOUS", "TKO"). | Demo bout at the end. | `watch-end.png` | `FighterBar.tsx` `Clock` vs `TransportBar`; `library.ts:63` uppercases `method`. |
| 11 | minor (perf) | A cold 3D start takes 17–22 s to the first frame on WebGPU High (13–18 s of it shader compilation); WebGL2 High takes about 27 s. Multi-fighter bouts drop to 24–44 fps (2v2: 24, 3v3: 44, ffa4 and crowd4: 35) against 50–60 for 1v1. | `?watchDemo=1` (`__ttff`), `qa2-modes.mjs`. | `__ttff = {deviceMs 991, boutMs 2516, compileMs 18477, firstFrameMs 22036}`. | Known area (perf pass). |

## What passed (with numbers)

**Smoke and navigation (snapshot).** All 9 screens load with 0 console errors. Three quick round trips through every screen: 0 errors, 0 unhandled rejections. JS heap 25–105 MB, DOM up to 5,400 nodes (About, with the parameter registry).

**Watch and replay** (demo bout `qa2-watch:3:5`, WebGPU High, 60 fps / 16.7 ms, GPU 5–7 ms):
- Play, pause (tick held 101 → 101) and resume (→ 116) work. Restart (Home) works.
- Speeds are exact: 0.1× = 2, 0.25× = 5, 0.5× = 10, 1× = 20, 2× = 40 and 4× = 81 ticks per 2 s. J/L clamp at 0.1× and 4×; Shift+K resets to 1×.
- 60 random seeks, a reverse click-sweep and a drag scrub: 0 seek mismatches.
- Frame stepping: +25, −10, Shift ±1 s, clamps at 0 and at 9547.
- Cameras 1–9 twice and all 10 menu entries: each shot matched the key.
- 9 markers jumped to their events (apart from #8). `[` `]` `,` `.` worked.
- 4 instant replays (R) and Back to live worked. The loop (3000 → 3040) cycled correctly at 4×.
- Analytics tabs, debug, help and resize all worked.
- **After all that, the digest (390bc116), the full Stats table and the fighter bars were byte-identical to before.**

**Replay library and files.**
- Save ×3 gives 1 library entry (deduplicated by digest, 286–307 KB). Open from the library gives the same digest.
- Download, then import the `.boutreplay`: same digest.
- Corrupted imports all gave exact toasts and kept the current bout: empty, text, foreign JSON, `__proto__` JSON, random bytes, one flipped byte ("checksum mismatch") and truncated ("1734 of 3484 bytes").

**Fighters.**
- Create; edit Basic (5 sliders), Advanced (8), search, undo/redo; and Full schema across all 9 sections (126 numeric fields). Save, export and the unsaved-changes guard work.
- Duplicate and rename work. Built-in fighters can't be renamed. Export shown: 17 fighters, 141 KB.
- Import:
  - A valid file imports.
  - An id collision imports as `(imported 2)`.
  - Truncated, empty and binary files give clear messages.
  - A bare array is read as an export.
  - Partial fighters are rejected with field paths.
  - Extreme values (1e308, −1, 0.0001 kg) are rejected with ranges.
  - A 20,000-level nested array is rejected.
  - A 400-fighter file (1.17 MB) imports in 6 s.
- **No prototype pollution** from `__proto__` or `constructor.prototype` payloads, at the top level and nested.
- Ids `__proto__`, `constructor` and `toString` store, reload and **run a bout correctly**.
- HTML/script names are rendered as text, and no handler fired.
- Everything persisted across reload (409 custom fighters, 93 KB with 5 fighters in localStorage).

**Simulation modes.** 1v1, teams 2v2/1v3/3v3, ffa4 and crowd4 (street) all completed, with none stuck on "Running…". Each opened in 3D Watch with 0 errors and a matching digest. Cancel works and a re-run completes. An 8-entrant single-elimination tournament ran 7 of 7 matches in 6.9 s and named a champion.

**Batch** (4 workers, 8 cores):

| Bouts | Time | Long tasks | Peak heap | Main-thread latency (rAF round trip) | Other |
|---|---|---|---|---|---|
| 100 | 19 s | 0 | 14 MB | median 15 ms, max 75 ms | 0 errors |
| 1,000 | 2 m 21 s and 2 m 13 s | 0 | 17.5 MB | median 15–54 ms, max 951 ms | two runs, identical fingerprint `418f8563` |
| 5,000 | 10 m 11 s | 0 | about 15 MB | median 17 ms, max 319 ms | peak machine RAM 77 %, 0 errors |

- Cancel at 310 of 1,000 shows a clear partial-results message and leaves 0 workers.
- Reload mid-batch: 0 workers after, 0 errors.

**Refresh mid-operation.**
- Reload during a running bout: the worker is gone after the reload, 0 errors. The bout is lost, which is expected.
- Reload during a Watch load and during playback: the view comes back each time.
- Save to library, then reload 150 ms later: the entry persisted.

## Not covered / caveats
- The 20+ bout-switch run on WebGPU stopped at 13 switches, and the WebGL2 run completed 14 switches (a 15th bout was not attempted). In both cases the RAM watchdog stopped the run, because machine RAM, including other agents' load, reached the cap. The leak trend was unambiguous by then.
- Fullscreen was not captured (headless).
- The dev-server errors (HMR, stale `corner/index.ts`, depth-stencil pipeline errors) were not triaged further, because the snapshot of the same tree was clean. If the dev server looks broken again, a hard reload or restarting Vite (by its owner) is the first thing to try.
