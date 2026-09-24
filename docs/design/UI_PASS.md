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
