# Watch screen and replay pass

Owner: Watch screen and replay system. This pass reworks the Watch screen's layout and rendering, hardens the replay
system (determinism, scrubbing, speeds, stepping, statistics at the playhead, camera override), and adds compressed
replay storage with a replay library. Tests: `tests/replay.polish.test.ts` (31 tests). Screenshots:
`docs/screenshots/watch-*.png`. Measurement tools: `scripts/dev/watch-profile.mjs` (React render cost) and
`scripts/dev/replay-sizes.ts` (replay sizes and load times).

## Layout

The screen is ordered by what a viewer needs most, top to bottom (`watch-before.png` shows the old screen,
`watch-analytics.png` the new one at full height):

1. **The picture.** The 3D broadcast, or the 2D board. The column is as wide as the picture can be without pushing
   the transport below the fold (`--watch-chrome`), and centred, so wide screens get no letterbox bars.
2. **Transport**, directly under the picture:
   - restart, frame back, play/pause, frame forward;
   - the round clock ("R2 · 1:14", counting down like the on-screen clock bug) and the bout time and tick;
   - a **REPLAY** tag with "Back to live" while a replay is on air;
   - speed (0.1×–4×), camera (1–9), a slow-motion replay of the last 8 s, fullscreen and help;
   - the **scrubber**: the played part, round boundaries, a hover readout of the round clock, and a lane of
     clickable **markers** (finish, knockdown, submission attempt, takedown, slam, big strike, round end).
     Clicking a marker jumps 1.5 s before the moment.
3. **Fighters**: name, record, gas tank and head/body/leg damage bars, significant strikes for the bout and the
   round, position, and a DOWN, ROCKED or other state flag. The round clock sits in the middle.
4. **Replay row**:
   - highlight chips: the broadcast's planned multi-angle replays whose moment has passed;
   - loop in and loop to here;
   - a verification badge, Save (to the library), download a `.boutreplay` file, the Library dialog;
   - the Analytics toggle.
5. **Analytics** (optional, closed by default, `A`, remembered): a side panel with tabs for Stats, Cards,
   Commentary, Events, Plan and Debug. View settings (3D/2D, quality, render scale, debug) are in a collapsed
   row below.

Keyboard, from one table (`replay/shortcuts.ts`) that also drives the `?` overlay:

| Keys | Action |
|---|---|
| Space, K | play/pause |
| ←, → | step one frame (Shift: one second) |
| J, L | slower, faster |
| Shift+K | back to 1× |
| [, ] | previous/next event |
| , and . | previous/next highlight |
| Home, End | restart, jump to the end |
| 1–9 | cameras |
| R | instant replay of the last 8 s |
| F | fullscreen |
| A | analytics |
| D | debug |
| ? | help |
| Esc | close help, leave fullscreen |

Space on a focused button does not also click it. A focused slider keeps its own arrow keys. Keys are ignored while
a dialog is open. Every control has a tooltip that names its key.

Loading and error states:

- **Loading a bout.** The bout is now simulated in the bout worker (`run/watchLoad.ts`, `simProtocol.runWatchJob`)
  with live progress ("Round 2 · 1:23 simulated"). Before, a synchronous rebuild froze the page for 2–2.6 s on a
  three-round bout. The main thread is the fallback when no worker can start.
- **A bout that cannot be built** shows an error state with "Open the demonstration bout" and "Saved replays…".
- **A bad replay file** gives a toast with the exact reason (see Corrupted files below).
- **3D failures** fall back to the 2D board with the reason (see the review fixes below).

The design system is used throughout: tokens from `theme.css` and `Button`, `Tabs`, `Dialog`, `StatusBadge`,
`Switch`, `EmptyState`, `ErrorState`, `LoadingState` and toasts from `src/app/ui`. Transport icons are local
(`components/watch/icons.tsx`) because the shared icon file belongs to the design system.

## Rendering: before and after

**Before.** The screen held the frame index in React state and set it on every sim tick. The whole screen
re-rendered at the sim's tick rate: the HUD, all tables, the game plan, the 7,000-row event log (memoised) and the
broadcast graphics. That is 10 re-renders a second at 1× and 40 at 4×. In the 2D view the sub-tick alpha was also
state, so the whole screen re-rendered every display frame.

**After.** `BoutPlayer` is the only source of truth for the playhead.

- One rAF loop advances it and calls `PlayheadSignal.notify()`, but only when the frame, the play state or the
  replay on air changed.
- Each panel subscribes through `usePlayhead(signal, selector, hz)`:

  | Panel | Refresh |
  |---|---|
  | scrubber | 20 Hz |
  | time readout, fighters, broadcast graphics | 10 Hz |
  | stats, commentary, plan | 4 Hz |
  | event log | only when the playhead crosses an event |
  | 2D board | every display frame (only that component) |

- The `Throttle` has 25 % slack, so a tick that lands one display frame early still shares the commit the other
  panels make for it.
- The screen itself re-renders only when the play state, speed, replay or a setting changes.
- The 3D view drives itself from its own rAF loop through `getPlayhead`, as before.

Measured with `scripts/dev/watch-profile.mjs` (React `<Profiler>` around the screen, `?profile=1`). Settings: 3D
view, WebGPU, quality Medium, default demo bout, 8 s of playback per speed, headless Chromium on the Arc 140V with
other agents' jobs running. In headless mode, 1× playback ran slower than real time (46 and 34 ticks in 8 s), so
the per-tick columns are the fair comparison.

| Speed | | Commits/s | React ms/s | ms per commit | Commits per sim tick | React ms per sim tick |
|---|---|---|---|---|---|---|
| 1× | before | 6.0 | 13.3 | 2.21 | 1.04 | 2.30 |
| 1× | after | 5.0 | 6.5 | 1.29 | 1.18 | **1.52** |
| 4× | before | 37.5 | 82.8 | 2.21 | 0.94 | 2.07 |
| 4× | after | 26.3 | 19.8 | 0.75 | 0.66 | **0.49** (4.2× less) |

- **4×:** React work fell from 83 to 20 ms per second (8.3 % to 2 % of the main thread).
- **2D view, after:** 76 commits/s at 1× (16.4 ms/s) and 85 commits/s at 4× (19.5 ms/s), at 0.22 ms per commit,
  because only the board re-renders per display frame.
- **2D view, before:** not measured (the old build was gone by then). By the code, it re-rendered the whole screen
  every display frame. At the measured 2.2 ms per whole-screen commit, that is about 130 ms/s.

## Replay robustness

The code that guarantees each behaviour, and the tests in `tests/replay.polish.test.ts` that check it:

- **Exact deterministic replay.** A saved replay re-simulates to the same digest, tick count, RNG draws, event log
  (verified fields) and every recorded frame (content hash over all frames). Checked in both archive profiles,
  for the previous format (a bare v4 JSON as History exports it) and across the worker boundary (`runWatchJob`
  through a structured clone). A tampered digest opens as `mismatch`; a file from another engine opens as
  `other-engine`.
- **Frame progression independent of the display refresh rate.**
  - `BoutPlayer.advance` snaps the frame boundary within 1e-6 of a frame. Without the snap, 6 × 1/60 s could land
    a rounding error short of the next frame.
  - Test: at every speed from 0.1× to 4× and 24–240 Hz, the frame shown after T seconds is exactly
    `floor(T·speed·10)`. Jittery intervals land on the same frame as steady ones.
- **Single-frame stepping.** A step is exactly one recorded frame, pauses playback, can be undone, and clamps at
  both ends.
- **Scrubbing and speed never mutate the bout.**
  - Test: every speed (0.1× to 8×), about 100 seeks, steps, event steps, a loop, ten replays and every panel
    derivation all run over a deep-frozen event log. Any write would throw.
  - Afterwards the event hash, the frames' content hash and the re-simulated digest are unchanged, and the frames
    view rejects writes.
- **Statistics at the playhead** (`replay/statsAt.ts`).
  - Before, the stat table and scorecards showed the finished bout's numbers wherever the playhead was.
  - Now `StatsTimeline.at(t)` = `computeStats(events up to t, config, t)`, cached. Test: equal to the statistics
    of the same bout simulated only up to t, at five ticks. Also equal to `run.stats` at the end, and never
    decreasing along the way.
  - Scorecards show only rounds already scored; the official totals appear only at the end.
- **Markers with jump-to** (`replay/markers.ts`). Test: every knockdown and landed takedown and every round end is
  marked, in order, and each marker's click lands on its event's tick.
- **Camera override and back to auto** (`Presenter.setCameraOverride(kind | null)`).
  - It pins one of the director's operators, 2–7: main, tight, cageside, low, overhead, reverse. Replays still air
    their own angles. It is kept across bouts and director rebuilds.
  - 8 is follow (press again to switch fighter), 9 is the free orbit (drag, right-drag, wheel), 1 is the director.
  - Test: the director reports `source: 'locked'` and shot `overhead`, then `plan` after `null`.
- **Replays frame the event** (`lastSecondsReplayPlan`).
  - "Replay the last 8 s" (`R`) now finds the moment that mattered in the window: knockdown > stoppage > slam >
    rocked > takedown > hardest landed shot.
  - It plays a slow cageside angle that focuses on the fighter it happened to, then a second, wider angle of the
    moment (overhead on the ground, reverse standing).
  - With nothing notable in the window it is one slow angle of the pair.
  - Highlight chips air the broadcast's planned multi-angle replays.

## Replay storage

**Format** (`replay/archive.ts`). The container is: `'BLRP'` magic, container version, flags, body length, CRC-32
of the stored body, then a gzip body (`CompressionStream`). The body is a JSON payload followed by a binary blob of
typed arrays. The previous format, a bare `ReplayFileV4` JSON (format 4), is still read. `ReplayFileV4`, the sim's
`src/sim/record/` code and `SIM_ENGINE_VERSION` are unchanged. The container is app-level.

There are two profiles:

- **Portable** (downloads, older library entries). The seed, the setup (fighters, rules, arena, settings,
  parameter overrides) and the claim (engine version, digest, ticks, RNG draws, result). It re-simulates exactly
  and is verified on open.
- **Library** (recent saves). The portable data plus the event log, the game-plan samples and the recorded
  `FrameStore` columns, so the bout opens without re-simulating. The columns are stored bit for bit with lossless
  transforms: integer arrays delta-coded, floats XOR-ed with the previous value's bits, every array byte-shuffled
  into planes, then gzip. The digest is re-checked in the background by the worker.

**Library** (`replay/library.ts`). It lives in IndexedDB, not localStorage, which is capped near 5 MB and must
parse its whole history document to list it.

- Two object stores: `meta`, with small records listed without reading any replay bytes, and `blobs`, read only
  when a replay is opened.
- Ids come from the digest, so saving the same bout twice replaces it.
- The newest 12 entries keep their frame cache; older ones are re-encoded as portable. The library keeps at most
  300 entries.
- Without IndexedDB (private mode, tests) it falls back to memory.

**Measured** (`scripts/dev/replay-sizes.ts`, KB; "v4 JSON" is the replay file as History stores it in
localStorage today):

| Bout | Ticks | Events | v4 JSON | v4 JSON gz | **Portable** | **Library** (with frames) | Frames in memory | Frames as JSON | Frames JSON gz |
|---|---|---|---|---|---|---|---|---|---|
| watch-demo:0:1 | 642 | 52 | 25.5 | 5.4 | **3.3** | **30.5** | 204.5 | 1,864.5 | 122.1 |
| watch-demo-4:1:3 | 8,387 | 538 | 159.9 | 20.8 | **3.4** | **268.4** | 2,272.9 | 26,975.4 | 1,511.7 |
| watch-demo-5:1:2 | 10,200 | 77 | 32.1 | 6.0 | **3.5** | **378.1** | 1,917.2 | 29,010.4 | 1,761.1 |
| polish-3:3:4 | 10,200 | 690 | 205.8 | 25.0 | **3.4** | **323.4** | 2,827.6 | 33,955.7 | 1,863.0 |
| transport-3:0:1 | 10,200 | 783 | 227.7 | 27.3 | **3.4** | **337.8** | 2,569.8 | 33,151.1 | 1,811.6 |

- **Portable:** 3.3–3.5 KB against 25–228 KB for the v4 JSON, 8–67× smaller.
- **Library** (frames included): 270–380 KB. That is about 100× smaller than the frames as JSON, 5–7× smaller than
  gzipped frame JSON, and 7× smaller than the in-memory columns (3.4–4.5 MB for the same archive uncompressed).
- **Open times, full three-round bouts:**
  - library archive (no re-simulation): 165–245 ms;
  - portable archive (re-simulated and verified): 2.05–2.6 s, now in the worker with progress.
- **Encode times:** portable 4–64 ms; library 67–85 ms.

**Corrupted and partial files** are detected and reported as typed errors, never exceptions. Each is tested:

- empty;
- not a replay (random bytes, text, foreign JSON);
- malformed JSON;
- unsupported version (container v9, replay format 3);
- truncated (header, body);
- checksum mismatch (one flipped byte);
- damage behind a recomputed checksum (caught by gzip);
- an archive whose payload is missing required fields;
- a frame cache that does not match the bout.

The Watch screen shows the message in a toast and keeps the current bout.

## Review fixes (coordinator's list)

- **M3 — Watch stuck on "Preparing broadcast…".** `Arena3D` now catches a throw in `setBout` or the warm-up, marks
  3D failed and calls `onUnavailable`. The Watch screen shows the 2D board with the reason.
- **M5 — device or context loss.**
  - The presenter wraps three's `renderer.onDeviceLost`, which covers WebGPU `device.lost` and WebGL
    `webglcontextlost`. It stops rendering and notifies `onDeviceLost` listeners.
  - `Arena3D` rebuilds the presenter once, with a toast. A second loss falls back to 2D with the reason.
  - `dispose` tolerates a dead device.
- **M4 — orphan referee after a quality change during a bout switch.**
  - `setBout` sets `building`, and `setQuality` skips the body/referee rebuild while it is set (`setBout` builds
    from the current quality).
  - `clearBout` nulls `factory`.
  - `setBout` disposes any referee before assigning a new one.
  - Test: the scene child count with the race equals the count without it.
- **M2b — a new character factory per bout, never freed.**
  - The module factory is now created once per presenter and reused; its `preload` is idempotent.
  - I did not add a `dispose()` to `character/` (the perf agent owns it). `Presenter.dispose` calls one if a
    factory ever has it.
  - Test: `createCharacterFactory` is called once across three bouts.
- **M2a — arena textures used through TSL nodes.** `Venue.dispose` now walks every material's node graph
  (`getChildren`) and disposes each `TextureNode`'s texture: floor canvases, LED boards, loaded photo maps, the
  shared slope noise. three re-uploads a disposed texture on its next use, so disposing shared ones is safe.
- **L7 — wasted `planShots`.** `Arena3D` starts `setBout` before `setRecording`, so the recording is planned once,
  against the new arena.

## Still weak

- **Headless timing.** The render-cost numbers come from a shared machine. 1× playback in headless Chromium runs
  below real time, hence the per-tick normalisation. The 2D "before" figure is an estimate, not a measurement.
- **Fullscreen** is implemented (`F`, the button, a letterboxed picture with the transport under it) but not
  captured. Headless Chromium does not enter real fullscreen.
- **History still stores the fat format.** The History screen (not mine) still keeps full v4 JSON replays
  (160–230 KB each) in localStorage. Pointing it at the replay library, or storing the portable profile there
  instead, would cut that about 50×.
- **Main-thread re-simulation** still happens in two cases: when a worker cannot start, and in `openReplay`'s
  default (tests, tools). The Watch screen always passes the worker loader.
- **Camera 8 (follow)** cycles fighters by pressing it again; there is no picker in the menu. The camera menu is a
  native `<select>`, not a design-system component, because the system has no menu primitive yet.
- **Scorecards in hidden judging mode** stay blank until the decision, which is by design, but the Cards tab is
  empty for most of a bout.
- **The analytics tab bar is cramped** at 400 px, with six tabs and "Debug" at the edge.
- **Test suite.** Other suites (`style`, `tiers`, `ui.params-effect`) fail against the sim being tuned, and
  `tsc` reports errors in other agents' files (`presentation.finish.test.ts`, `model/paramEffect.ts`). All of the
  Watch, replay and presentation suites pass.
