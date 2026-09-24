# UI polish pass (overnight, 2026-09-24)

Scope: the design system, the app shell and navigation, and every screen except Watch (Watch,
its HUD, broadcast overlay, event timeline, scorecard and 3D canvas belong to the Watch pass).
Nothing under `src/sim/**` or `src/presentation/**` was edited. Screenshots: `docs/screenshots/ui-before-*.png`
(the pre-pass app) and `ui-after-*.png`.

## 1. What changed

| Area | Before | After |
| --- | --- | --- |
| Shell | Ten flat uppercase tabs in a wrapping header, a permanent amber disclaimer banner and a two-line fixed footer; content flush against the window edge. | Left navigation grouped by task (Simulate / Review / Library / Reference) with icons, a collapsible 60 px rail (auto-collapses under 1,100 px and on Watch, so the 3D stage gets the width), a top bar naming the page, a one-line "Toy model" notice linking to About, a System/Light/Dark segmented theme switch, and padded, width-capped pages. Pages mount on first visit and then stay mounted, so a half-built match, a running tournament or a running batch survives navigation. |
| Legacy v3 tabs | Replay, Dashboard and Model rendered the old v3 engine, a second three.js renderer and a 2 MB replay corpus. | Removed from the app. Watch replaces Replay; the Batch screen carries the aggregate analytics the Dashboard had (win rate with Wilson intervals, method mix, round of finish, per-fighter averages); **About the model** replaces the v3 notes with the v4 rulebook summary, calibration anchors and a searchable view of the live 2,000+ entry parameter registry. The app no longer imports anything under `src/ui`, `src/engine`, `src/render`, `src/replay` or `src/data` (see §6). |
| Design system | Tokens scattered across three sheets; mono uppercase micro-labels everywhere; selects styled like text boxes; `window.confirm` dialogs. | `src/app/theme.css` (tokens + component look) and `src/app/ui/*` (components). Sentence-case headings in the UI face, mono kept for numbers, real select chevrons, focus rings on every control, reduced-motion support, in-app confirm dialogs and Undo toasts. |
| Fighter editor | Nine schema-shaped tabs, 287 raw inputs. | Opens on a **profile view**: Physical / Athletic / Technical / Style & game plan / Mental / Experience, with a Basic ⇄ Advanced toggle, attribute search across both modes, live tier strip, per-discipline experience, presets, comparison with any other fighter (per-row values and deltas plus a derived-composite card), undo/redo (Ctrl+Z / Ctrl+Shift+Z; one slider drag is one step), Save as copy, Export. The complete raw schema is one click away ("Full schema"), with every field the simulation does not read badged **No effect on the bout**. |
| Fighter database | Text buttons per row, confirm-and-lose deletes, import that wrote first and reported later. | Icon actions with labels/tooltips, click-a-name-to-edit, Rename (id kept, undoable), Delete with an Undo toast that restores the fighter exactly, Duplicate with an "Edit" shortcut, and an **import preview** that lists every fighter in the file as Will import / Will import as `<new id>` / Rejected (with field-level reasons) before anything is written. Corrupted, truncated, empty, wrong-version and partial files get plain-language explanations. |
| Batch simulation | Did not exist in the app. | New screen: two fighters, ruleset, arena, damage realism, referee; 10 / 100 / 1,000 / 5,000 / custom (≤ 20,000) bouts; master seed. Runs on a Web Worker pool (cores − 2, max 4), with progress, completed count, rate, elapsed and a smoothed ETA, cancel, per-bout error capture, worker-crash recovery and a main-thread fallback. Results: win % per corner with 95 % Wilson intervals, draws, finish rate, bout length, method mix by winner, round of finish, per-fighter averages with 95 % intervals, CSV export and a digest fingerprint that proves the result is identical for any worker count. |
| Match / Tournaments / History / Result | Mono section labels, `window.confirm`, "Nothing yet." text. | Page headers, spinner in the run strip, confirm dialogs, Undo on deleting a tournament, a history entry or all history, designed empty states. |

## 2. Design tokens (the stable contract)

Declared on `:root` in `src/app/theme.css` with a complete dark set, a complete light set for
"system light" (guarded so an explicit dark choice wins) and the same set for `[data-theme="light"]`.
The header comment of that file is the authoritative list; the Watch pass consumes the same names.

| Group | Tokens |
| --- | --- |
| Surfaces | `--bg` `--surface` `--surface-2` `--surface-3` `--surface-raised` `--overlay` |
| Lines | `--line` `--line-soft` `--line-strong` |
| Text | `--text` `--muted` `--faint` `--text-on-accent` |
| Accent | `--accent` `--accent-hover` `--accent-ink` `--accent-soft` (scoreboard amber, the only UI accent) |
| Fighter identity | `--corner-a` `--corner-a-dim` `--corner-b` `--corner-b-dim` |
| Status | `--ok` `--ok-soft` `--warn` `--warn-soft` `--alert` `--alert-soft` `--info` `--info-soft` |
| Focus | `--focus` `--focus-ring` |
| Charts | `--chart-1..4` (blue, orange, aqua, yellow; fixed order; CVD-validated on both surfaces; always paired with legend and labels) |
| Tiers | `--tier-0..5` `--tier-ink` (creator.css) |
| Type | `--sans` `--mono`; `--fs-2xs` 10.5 · `--fs-xs` 11.5 · `--fs-sm` 12.5 · `--fs-md` 14 · `--fs-lg` 16 · `--fs-xl` 19 · `--fs-2xl` 24 · `--fs-3xl` 30; `--fw-regular/medium/semibold/bold`; `--lh-tight/snug/normal`; `--tracking-caps` |
| Space | `--sp-0..9` = 0, 4, 8, 12, 16, 20, 24, 32, 40, 56 px |
| Radius | `--r-xs` 2 · `--r-sm` 3 · `--r-md` 6 · `--r-lg` 10 · `--r-xl` 14 · `--r-pill` |
| Elevation | `--elev-0..3`, `--shadow` (alias of `--elev-1`) |
| Motion | `--dur-instant` 60 · `--dur-fast` 120 · `--dur-med` 200 · `--dur-slow` 320 ms; `--ease-out`, `--ease-in-out`; all durations collapse to 0 under `prefers-reduced-motion` |
| Layout | `--nav-w` 220 · `--nav-w-collapsed` 60 · `--page-max` 1240 · `--gutter` 24 (18 under 1,180 px, 16 under 760) · `--control-h` 32 |
| Z-index | `--z-sticky` `--z-nav` `--z-popover` `--z-dialog` `--z-toast` |

Components (`src/app/ui`): `Button` (default / primary / ghost / danger / danger-solid; sm / md / lg;
icon-only requires an aria-label; busy state), `Tabs` + `TabPanel` (WAI-ARIA tabs, arrow/Home/End),
`Segmented` (radio group with arrow keys), `Slider` (range + exact number box, value text for screen
readers), `Select`, `Field` (label + hint + validation message wired through `aria-describedby`),
`Switch`, `Dialog` (modal, focus trap, Escape, focus return) and `useConfirm`, `Tooltip` / `InfoTip`
(hover *and* focus, also exposed as the accessible description), `StatusBadge`, `EmptyState`,
`LoadingState`, `ErrorState`, `Alert`, `Progress`, `ToastProvider` / `useToast` (with Undo), and an
inline SVG icon set. Legacy classes (`.btn`, `.field`, `.badge`, `.creator-tabs .tab`, `.fc-*`, `.fdb-*`,
`.ms-*`) are re-seated on the same tokens so older markup matches.

## 3. Fighter editor ↔ the real model

Every profile control reads and writes an existing `FighterDefinition` path
(`src/app/model/profileModel.ts`); a profile edit and a raw-schema edit are the same edit.
TECHNICAL composites are views over sub-skills: the value is the mean of the named sub-skills
across the arts the fighter has trained, and moving it shifts each of them by the same amount
(clamped 0–100), so the authored shape survives and there is no new state. A composite over arts
the fighter never trained is disabled with a reason rather than silently doing nothing.

### Parameter-effect verification (`tests/ui.params-effect.test.ts`)

For every profile control the test runs a deterministic, paired batch: the same seeds with the
control at a low and a high value against the same opponent, and asserts a measurable change.
Two kinds of assertion are used, because the calibration agent was retuning `src/sim/**` during
this pass and single-outcome statistics moved under it (age's effect on strike force went from
−39 % to −2.5 % between two sim builds):

- **Direction probes**, where a mechanism-level statistic held across three seed sets and several
  sim builds: the statistic must move at least 5 % in the stated direction.
- **Divergence probes** for everything else: the share of paired bouts whose digest differs must
  reach a threshold. This proves the simulation reads the control and changes the fight, without
  claiming a direction the model does not guarantee.

Measured on the final build (default probe: 16 seeds of one 60 s round unless noted; the whole file
runs in 4 to 5 minutes under the resource governor; probes marked [slow] use full bouts):

| Control (category) | Schema path(s) | Probe | Low → high | Measured | Result |
| --- | --- | --- | --- | --- | --- |
| Weight (Physical) | `body.fightNightKg` (+ mass, weigh-in) | damage dealt ↑ | 62 → 100 kg | 0.083 → 0.148 (+44.0 %) | pass |
| Strength (Athletic) | `physical.strength` | strike force ↑ | 10 → 95 | 525 → 615 N (+14.6 %) | pass |
| Explosiveness (Athletic) | `physical.explosiveness` | strike force ↑ | 10 → 95 | 528 → 810 N (+34.8 %) | pass |
| Endurance (Athletic) | `physical.cardio` | strikes attempted / min ↑ | 5 → 95 | 5.4 → 14.5 (+62.6 %) | pass |
| Recovery (Athletic) | `physical.recovery` | body damage taken ↓ | 5 → 95 | 0.023 → 0.020 (−13.5 %) | pass |
| Chin (Athletic) | `physical.chin` | head damage taken ↓ | 5 → 95 | 0.102 → 0.065 (−36.1 %) | pass |
| Body toughness (Athletic) | `physical.bodyToughness` | body damage taken ↓ | 5 → 95 | 0.029 → 0.018 (−37.7 %) | pass |
| Wrestling (Technical) | 12 wrestling-family sub-skills | takedown attempts ↑ | 20 → 90 | 0.25 → 1.06 (+76.5 %) | pass |
| Height, Reach, Age, Stance, Mobility (Physical); Hand speed, Kick speed, Reaction (Athletic) | `body.heightM/reachM/ageYears/stance`, `physical.speed/handSpeed/kickSpeed/reactionTime` | bouts changed | low → high | 100 % of 4 (need 75 %) | pass |
| Leg reach (Physical) | `body.legReachM` | bouts changed | 0.85 → 1.20 m | 75 % of 4 × 180 s (need 50 %) | pass |
| Flexibility (Physical) [slow] | `physical.flexibility` | bouts changed | 5 → 95 | 50 % of 6 full bouts (need 15 %) | pass |
| Neck strength (Athletic) [slow] | `physical.neckStrength` | bouts changed vs a power puncher | 5 → 95 | 100 % of 8 (need 25 %) | pass |
| Striking, Boxing, Kicking, Grappling, Clinch, Defence, Timing, Footwork, Distance management, Positional awareness (Technical) | sub-skill groups (`TECHNICAL_GROUPS`) | bouts changed | 20 → 90 | 100 % of 4 each | pass |
| Preferred range, Pace & aggression, Pressure (Style) | `style.preferredRange`, `mental.aggression`, `style.pressureBias` | bouts changed | low → high | 100 % of 4 | pass |
| Takedown setup (Style) | `style.takedownPreferences.setup` | bouts changed | naked → offClinch | 100 % of 6 × 300 s (need 30 %) | pass |
| Clinch & cage tendency (Style) [slow] | `style.takedownPreferences.cageBias` | bouts changed | 0 → 100 | 75 % of 4 full bouts (need 50 %) | pass |
| Defensive tendency when hurt (Style) [slow] | `style.hurtBehaviour` | bouts changed | circleOut → trade | 100 % of 4 full bouts (need 50 %) | pass |
| Guard style (Style) | `style.guardStyle` | bouts changed | highGuard → longGuard | 75 % of 4 (need 75 %) | pass (at threshold) |
| Fight IQ, Composure, Discipline (Mental) | `mental.*` | bouts changed | 5 → 95 | 100 % of 4 | pass |
| Adaptability (Mental) [slow] | `mental.adaptability` | bouts changed | 5 → 95 | 13 % of 8 full bouts (need 13 %) | pass (weakest) |
| Overall experience, Rounds fought, Opposition level, KO losses, Layoff, Pro wins (Experience) | `record.experienceOverride`, `record.totalRounds`, `record.oppositionLevel`, `record.pro.*`, `record.daysSinceLastBout` | bouts changed | low → high | 100 % of 4 each | pass |
| Refuses to tap (Style) | `style.refusesToTap` | derived submission-resistance floor | off → on | changes `deriveRuntime` output | pass |

The same file also checks, at the derivation layer, that every sub-skill of all ten disciplines and
every per-discipline career field the Full-schema editor exposes (years, training quality, start
age, hours and sessions per week, sparring intensity, months since trained, coach quality, base art,
grade, competition, specialisations) changes the derived fighter, and that every field labelled
**No effect on the bout** really leaves the bout byte-identical, so the label fails a test the day
the simulation starts reading it.

The probes also caught a mapping bug, now fixed. "Pro wins", "KO losses" and "Layoff" wrote the flat
legacy fields (`record.proWins`, `record.koLosses`, `record.layoffMonths`), but the simulation
reads `record.pro` and `record.daysSinceLastBout`, which every archetype sets. So the three
controls did nothing. They now write both and keep the pro win/loss breakdown consistent.

## 4. Hidden or marked, and why

**Concepts from the brief that the model does not represent.** The editor shows these in an
information box, never as a slider:
- Coordination: there is no attribute for it. Execution quality comes from sub-skills and tier rules.
- Acceleration and Agility: not separate from foot speed and explosiveness. The Mobility control says so.
- Fatigue resistance: Endurance sets the drain and Recovery the refill.
- Movement style: expressed through Pressure, Initiative and Preferred range.

**Controls that exist in the schema but do not change a bout.** In testing, 0 of 12 full bouts
changed. Basic mode does not show them. Advanced mode and search show them with a **No effect on
the bout** badge and a one-line reason. The test fails if the sim starts reading one of them, so
the label can then be removed.

| Control | Path | Why |
| --- | --- | --- |
| Handedness | `body.handedness` | Feeds the derived dominant leg and power-hand split, which no bout mechanic reads. Stance sets the lead side. |
| Balance | `physical.balance` | Feeds the derived takedown-defence base, clinch power and stumble multiplier, none of which a bout reads. The live balance meter comes from damage and technique commitment. |
| Grip strength | `physical.gripStrength` | Read only by hand and elbow injuries. |
| Initiative | `style.initiative` | Only a stand-in for Pressure when Pressure is unset. |
| Game plan (primary mode), Plan B (fallback mode) | `style.primaryMode`, `style.fallbackMode` | Labels only. The AI generates its plan from skills, physique, Pressure and scouting. |
| Risk when behind | `style.losingBehaviour` | Only "Unchanged" is read (it turns off two late-fight rules). The other four choices behave identically. |
| Heart | `mental.heart` | Read in two narrow cases: a novice's reflex when rocked with no "when hurt" style set, and tap timing once a submission is locked. No measurable effect in full bouts. |

**Raw-schema fields badged "No effect on the bout" in Full schema.** All were confirmed
byte-identical: somatotype (build blend), the numeric stance-switching tendency, tired behaviour,
Thai style, top and bottom priority, per-round pacing and notes. The Appearance tab is cosmetic by
design.

These are findings for whoever owns `src/sim/**`, not UI decisions. Game-plan mode, risk when
behind and heart are the three a user would most expect to matter.

## 5. Batch simulation: determinism and the 5,000-bout run

- Bout *i* always has seed `boutSeed(master, 'batch', i)` = `master::v4::batch::bout-i`, whichever
  worker runs it; a batch bout is byte-identical to a Match-setup bout with that seed
  (`tests/ui.batch.test.ts` compares digests and summaries with `simulate()`).
- Workers take chunks of indices from one queue; summaries are keyed by index and every number is
  computed from the index-sorted list, so the order bouts finish in never reaches the screen.
  1, 2 and 4 workers produce identical summaries, aggregate and fingerprint (tested through fake
  Workers that run the real protocol across a message boundary).
- Only a ~120-byte summary per bout crosses the thread boundary; event streams are dropped in the
  worker.

**The 5,000-bout run** (`scripts/dev/ui-batch5000.mjs`, run once, headless, through the governor,
against the shared dev server). The run was Regional Pro All-Rounder vs Thai Striker, MMA Unified
3×5, Octagon 30 ft, realism, on 2 workers (the Workers option in the setup card; Auto would be 4
here). The script sampled machine RAM, CPU and the page heap every 20 s. It cancels from the UI if
RAM goes over 93 %, or CPU goes over 93 % on two samples running, or the page reloads or stalls.

| | |
| --- | --- |
| Completed | 5,000 of 5,000, 0 errors, in 36 min 16 s (2.3 bouts/s on 2 workers; the machine was shared with the calibration batches) |
| Result | Thai Striker 78.7 % (95 % CI 77.5–79.8), Regional Pro 20.4 % (19.3–21.6), draws 0.9 %; finish rate 57.8 %; mean length 12.0 min |
| Fingerprint | `42522a80` |
| Page JS heap | 47 MB at start, 68 MB peak; the UI stayed responsive and the ETA settled within a minute |
| Machine | RAM peak 88 %; CPU mostly 68–85 %, with single 20 s samples at 93, 95 and 97 % while other agents' jobs were also running |

What happened along the way, for the record:
- **First attempt, stopped by me.** A Vite hot reload, triggered by another agent's source edit,
  wiped the page's batch, and the script sat waiting. The script now stubs Vite's HMR client, so
  the page cannot reload.
- **Second attempt, stopped by me at 2,028 bouts.** With the default 4 workers and other jobs on the
  machine, CPU read 96 %. That is why the Workers option exists, and why the script now has a CPU
  guard.
- **Third attempt: the full 5,000.** It ran on 2 workers. The CPU guard trips only on two samples
  running above 93 %; three single samples reached 93–97 %.

The 1/2/4-worker equivalence is proven in `tests/ui.batch.test.ts` rather than by repeating the
36-minute run.

## 6. Legacy files the app no longer references

`src/ui/*` (App, charts, Controls, Dashboard, Hud, ModelNotes, ReplayView, Timeline, styles.css,
dashboard.css), `src/engine/*`, `src/render/*`, `src/replay/player.ts`, `src/data/replays.ts`
(and the `public/replays` corpus it loads). They are still used by the legacy tests
(`tests/analytics|determinism|engine|fighter|rng.test.ts`) and scripts (`scripts/calibrate|consistency|exportBout|generate|verify.ts`),
so they were left in place for the cleanup pass. The base stylesheet moved to `src/app/base.css`.

## 7. Accessibility and responsiveness

- Every control has a visible label or an aria-label; icon-only buttons are labelled; the
  navigation marks the current page with `aria-current`; tooltips show on focus as well as hover.
- Focus ring on every interactive element (`--focus`), including custom controls.
- Keyboard: tabs and segmented controls follow the arrow-key patterns; dialogs trap focus and close
  on Escape; the editor has undo/redo shortcuts that step aside inside text boxes.
- `prefers-reduced-motion` zeroes every duration and stops the spinner's rotation.
- Layout: full at ≥ 1,280 px; the rail collapses under 1,100 px; the editor's side panel and the
  batch setup stack under ~1,080 px; the navigation becomes a horizontal strip under 760 px.

## 8. Fixes from review and browser QA (with tests)

| Finding | Fix | Test |
| --- | --- | --- |
| Import crashed on discipline keys or ids named `toString`, `constructor` or `__proto__` | Lookups keyed by file-chosen strings read only the table's own entries; prototype-named grade ranks are an error | `tests/ui.store-hardening.test.ts` |
| Tournament lost update: a result was written onto a stale copy of the bracket | `commitMatchResult` updates the current stored bracket as a function of its present state, and refuses if the slot changed or the tournament was deleted | same |
| QA2-4: team wins shown as "No contest" | `winnerLabel` / `resultLine` name the winning team (and members) when `winningTeam` is set | `tests/ui.qa2.test.tsx` |
| QA2-5: long names broke dialogs | Names are capped at 60 characters (validation error, input `maxLength`); import shortens an over-long name with a warning; dialogs wrap long text, clamp the title, scroll the body and keep the footer visible | same |
| QA2-7: double-clicking Run cancelled the bout | Cancel moved into the progress strip, ignores clicks for 700 ms after Run, and a cancel says "Cancelled" | same |
| QA2-8: overlapping scrubber markers | Markers closer than about 12 px are stacked into up to three rows | same |
| QA2-9: "Playback speed" did nothing | Watch opens a bout at that speed, snapped to the transport's steps; the options are limited to what Watch supports (0.1× to 4×) | same |
| QA2-10: raw method ids, mixed clock rounding | One formatter (`src/app/model/format.ts`): "Unanimous decision", not "DECISION.UNANIMOUS"; result and finish times are elapsed and floored everywhere (3:54, not 3:55); the live round clock counts down | same |


---

# UI pass 2 (2026-09-24)

Scope: bundle splitting, a redesign of Match setup and Tournaments, the debug-switch gate (audit H3), app-side
per-frame costs (audit H4), and a first-time-user walk through every screen of a production build. Nothing under
`src/sim/**` changed. Presentation files got only one-line gates (see §3). Screenshots: `docs/screenshots/ui2-*.png`,
all at or under 250 KB. The Watch capture is a 3D frame scaled to 42 % so it fits the limit.

## 1. Code splitting and first-load cost

`vite.config.ts` no longer forces `inlineDynamicImports`. `npm run build:single` builds with `--mode single`, which
keeps the old single chunk, because `scripts/inline.mjs` has to inline one script into one page.

| Chunk | Loaded when | Raw | Gzip |
| --- | --- | --- | --- |
| `index` (shell, Match setup, Fighters, Result, store, the sim, React) | first screen | 1,381 KB | 385 KB |
| `Watch` (transport, panels, camera planner, animation module) | Watch opens | 315 KB | 111 KB |
| `Arena3D` + `index` (presentation stage) + `three.webgpu` + `three.tsl` | the 3D view mounts | 403 + 146 + 1,091 + 25 KB | 148 + 65 + 300 + 8 KB |
| `simProtocol` (main-thread bout runner) | Watch, or a bout runs without a worker | 37 KB | 13 KB |
| `BatchSim`, `Tournaments`, `History`, `FighterCreator` (+ `profileModel`), `About` | first visit to that page, or pointer/focus on its nav item (prefetch) | 24, 26, 8, 80 (+29), 10 KB | 9, 9, 3, 24 (+9), 4 KB |

Before, all of this was one 3,561 KB chunk (1,075 KB gzip). How it was done:
- `React.lazy` + `Suspense` in `App.tsx`. The fallback is the design system's `LoadingState` ("Loading Watch…").
  One loader per chunk is shared by `lazy()` and the nav-hover prefetch.
- Inside Watch, `Arena3D` is lazy too, with a "Loading the 3D broadcast…" skeleton in the picture. Watch now
  imports `stage/quality` (not `stage/index`, which pulls in three/webgpu). It also gets its GPU check from
  `components/watch/gpu.ts`, a copy of `gpuLikelyAvailable`, so the 2D board never downloads three.js.
- The bout worker's wire format moved to `workers/simWire.ts`. `simProtocol.ts` re-exports it for existing
  importers. `runBout` now imports the runner only for the main-thread fallback.
- `tests/ui.pass2.test.tsx` walks the static import graph from `src/main.tsx`. It fails if the graph reaches
  three.js, the presenter, `stage/index`, `Arena3D`, Watch, Batch, Tournaments, History, the editor or About.

**Load measurements** come from `scripts/dev/load-first-screen.mjs`. It builds nothing: it serves a production
build (`vite build --outDir <scratch>`) from its own static server with gzip, in a fresh headless-Chromium context,
median of 5 runs. "Ready" means the Run button is on screen. TTI is the end of the last long task before a 2 s quiet
window. "Slow" is a 9 Mbit/s, 150 ms RTT network with a 4× CPU slowdown.

| | JS before first screen | FCP | Ready / TTI | Long-task time |
| --- | --- | --- | --- | --- |
| Before, desktop | 3,480 KB raw / 1,048 KB gzip | 440 ms | 458 ms | 108 ms |
| After, desktop | 1,352 KB raw / 375 KB gzip (−61 % / −64 %) | 280 ms | **302 ms (−34 %)** | 0 ms |
| Before, slow | same | 1,936 ms | 2,009 ms | 294 ms |
| After, slow | same | 1,396 ms | **1,513 ms (−25 %)** | 240 ms |

The Watch 3D view's time to live picture did not change (about 19–20 s headless, 3 alternating runs each). The
lazy chunks add about 0.6 s before mount on a local server.

**What still sits in the first chunk.** The whole simulation engine is still in it: the AI (229 KB), striking,
rules and damage, though the first screen only needs fighter derivation, rulesets and arenas. The app imports the
sim through its barrel `src/sim/index.ts`, and some sim modules have top-level side effects (the AI plan providers
register themselves via `core/bind.ts`), so Rollup keeps them. Deep imports in the app, or side-effect-free
registration in the sim (the sim owner's call), would cut about another 700 KB raw. Separately,
`presentation/finish/timeline.ts` imports `anim/animator` for one helper (`displaySeparation`). That puts the
224 KB animation module in the Watch chunk rather than the 3D chunk.

## 2. Match setup and Tournaments

New design-system pieces in `src/app/ui/steps.tsx`, styled in `theme.css`:
- `Step`: a numbered section with a status badge.
- `Disclosure`: a native `<details>` for advanced options. Its note shows how many values differ from the
  defaults, so nothing hidden is a surprise.
- `LabelRow`: a label with an `InfoTip` beside it rather than nested inside the label.

**Match setup** reads *1 Fighters → 2 Rules → 3 Options → 4 Run*:
- **Defaults.** A new user lands on a runnable bout: Counter Striker vs Olympic Judoka are pre-picked. Both are
  middleweight T3, so no size or level warning shows up on the first screen, and it is a striker against a grappler.
  Every other setting has its default.
- **Controls.** Format, team sizes and fighter counts are segmented controls, so a count cannot be invalid.
  Damage and playback speed are segmented too, and Commentary and Blood are switches. "Swap corners" moves the
  home crowd along with the fighter.
- **Progressive disclosure.** Round timing, weigh-in and size mismatch are in *Round timing and weigh-in*.
  Referee, scorecards, judging criteria and home crowd are in *Referee, judges and crowd*. Both are closed by
  default and show "n changed".
- **Inline validation.**
  - An empty slot says "Pick a fighter."
  - The same fighter twice says "Already fighting as Red corner…".
  - A fighter deleted from the database gets its own message.
  - An empty seed says "Enter a seed, or press New seed."
  - Round numbers keep what was typed and flag an out-of-range value rather than clamping it silently.
  - The Run step lists the blocking problems, and the step headers carry a status ("2 ready", "1 to fix").
- **Help.** The long help paragraphs under every field became tooltips beside the label, plus one-line hints
  where the choice matters (damage realism, the non-standard venue warning with a "why" tooltip).
- **Run step.** A summary (bout, rules, arena, damage), the size and level warnings, and the seed with New seed and
  Copy. Run is in the page header and at the end of the steps.
- A dismissible **"New to Bout Lab?"** card explains the app in three steps. It is remembered in localStorage.

**Tournaments** reads *1 Format → 2 Entrants → 3 Rules → 4 Create*:
- Format and draw size are segmented. The entrants step has a filter, "Pick the top N by rating" and Clear, with
  entrant cards (name, then tier and class) and a bye count.
- Seeding and carry-over sit behind a disclosure. Each has one line saying what it does, and the carry-over
  mechanics are in a tooltip.
- Validation is inline: no name; fewer than two entrants; more entrants than the draw holds.
- Once a tournament exists, the builder folds away behind **New tournament**. Saved tournaments are cards showing
  progress ("1 of 7 decided"), and the bracket is a step card with a status badge. "Next up" shows **Run match**
  buttons, and the carry column is hidden when carry-over is off (it used to read "Fresh. Fresh.").

**Duplicated title.** The top bar no longer repeats the page's h1. Pages with their own header (all except Watch
and the editor) show only the model notice there. That notice ("Toy model — results describe this model, not
real fighters · How it works") also replaces the separate notice strip, saving a row on every page.

## 3. Debug and capture switches (audit H3)

There is one gate, `src/presentation/devFlags.ts`, re-exported by `src/app/devFlags.ts`. Switches are live only when
`import.meta.env.DEV` is true or the URL has `?capture=1`. It provides:
- `devParams()`, `devParam()` and `devSearch()` in place of `new URLSearchParams(location.search)`;
- `exposeDevGlobal()` and `clearDevGlobal()` in place of `window.__x = …`;
- `switchesEnabled()`, the pure rule, which is tested.

`?quality` is only documented as a QA switch (PHASE8_NOTES), and users already choose and save quality in View
settings, so it is gated too.

| Where | Switches and globals now behind the gate |
| --- | --- |
| `App.tsx` | `?watchDemo` |
| `screens/Watch.tsx` | `?view ?quality ?scale ?cam ?seek ?play ?demo ?analytics`, `window.__watch` |
| `components/watch/profile.tsx` | `?profile`, `window.__watchProfile` |
| `components/Arena3D.tsx` | `window.__presenter`, `window.__ttff` |
| `presentation/presenter.ts` | `?gpuTiming ?stagePost ?fixedRes ?placeholders`, and `window.__stats`: `publishStats()` returns before building its per-frame object, so production no longer pays that per-frame cost (H4) |
| `presentation/stage/index.ts` | `?backend ?skinVelFix ?shareProgs ?gpuDynres ?aoClamp`, `window.__precompile` |
| `presentation/stage/pipeline.ts` | `?mrtBlend` |
| `presentation/stage/skinnedVelocity.ts` | `window.__skinVelocityFix` |
| `presentation/character/skinMaterial.ts` | `?skinLite ?skinGate`, `window.__skinGatesOff` |

The presentation edits are single-line swaps plus one import line each, made while the rendering and leak-fix
agents had those files open. A test scans `src/app` and `src/presentation` for any remaining direct
`location.search` read or `window.__*` write.

**Capture scripts.** `scripts/dev/capture-url.mjs` provides `withCapture(url)` and `captureGoto(page)`. They are
wired into `qa2-lib.mjs` (which covers every `qa2-*` script and `leak-switch.mjs`), and into `shot`, `polish-shots`,
`perf-shots`, `perf-ab`, `perf-compare-shots`, `cam-shots`, `load-timeline` and `watch-profile`. These keep working
against the dev server and against production builds.

**Verified in a production build** (`ui2-shots.mjs`):
- `?watchDemo=1&quality=ultra&backend=webgl2` opens Match setup, with no `window.__*` globals.
- `?watchDemo=1&capture=1` opens Watch, with `window.__watch` present.

The markup-coupled QA probes (`qa2-modes`, `qa2-cancel`, `qa2-cancel2`, `qa2-refresh`, `qa2-fighters2`) were
updated to the new controls.

## 4. Per-frame costs, app side (audit H4)

- **`Watch.getPlayhead()`**, read by the 3D view every display frame, rewrites one reused object in place instead
  of allocating one. `Arena3D` no longer spreads its whole props object into a new one every frame. `EventIndex`
  caches its window with two numbers instead of building a string key every frame.
- **The 2D view does not re-render the whole screen per frame.** Measured with `watch-profile.mjs` on a production
  build with React's profiling renderer, 2D view, 8 s per speed:

  | Speed | Commits/s in the Watch tree | React ms/s | ms per commit |
  | --- | --- | --- | --- |
  | 1× | 75 | 8.2 | 0.11 |
  | 4× | 84 | 9.4 | 0.11 |

  0.11 ms per commit is the board alone; a whole-screen commit costs about 2.2 ms. So this confirms the
  WATCH_REPLAY_PASS fix: about 8 ms/s, against an estimated 130 ms/s before it.
- **Watch re-simulated its bout on every tab switch.** The load effect depended on `active` and rebuilt the bout
  both when the tab was hidden and when it came back, discarding a replay opened from the library. It now loads
  each config once.

## 5. First-time-user walk (`scripts/dev/ui2-shots.mjs`)

Fixed:
- **First screen:** the purpose of the app is stated in the page lead and the intro card, and the bout is runnable
  immediately.
- **Result:**
  - Page title and verdict use full names ("Counter Striker vs Olympic Judoka"), not the three-letter codes.
  - Ticks and RNG draws moved into a tooltip on the seed line.
  - The mode is in words, and the realism warning no longer cites "chapter 09 §7".
  - The actions use design-system buttons ("Watch the fight").
- **Watch from the nav** showed the demonstration bout even after the user had just run one. It now opens the
  latest bout.
- **Fighter summaries** show "T4 Muay Thai", not "T4 muayThai" (Match setup, Fighters, Batch, editor presets).
- **Size and skill warnings** no longer mention "chapter 01" or "chapter 09 §7".
- **History** shows ruleset names, not ids.
- **Fighters** subtitle: "15 built-in presets and 0 of your own…". The "showing n of m" count appears only when
  filtered; screen readers still get it through a status line.

## 6. Still weak / not done

- **Sim barrel side effects** keep the whole engine in the first chunk (see §1).
- **Screens only restyled in pass 1:** Batch setup still shows help text beside every control and has its own
  fighter pickers. Converting it to the step pattern is the natural next pass.
- **Tournament round labels:** the bracket is still a horizontal list of rounds, with no connector lines.
- **Headless WebGPU console errors:** in some runs, both before and after this pass, three's
  `createRenderPipelineAsync` fails with a depthStencil format error, 43 times per load. It happens on some loads
  and not others, identically in the pre-pass build, so it is not caused by the splitting. It is for the rendering
  agent.
- **Watch screenshot:** a 3D frame PNG only fits in 250 KB when scaled down (42 %).
