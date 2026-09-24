# Progress

Live status of the realism overhaul. Updated at the end of every phase. Commits are staged so any phase can
be rolled back independently.

## Phase status

| Phase | Deliverable | Status | Commits |
| --- | --- | --- | --- |
| 0 Audit & engine decision | `docs/AUDIT.md`, `docs/ENGINE_DECISION.md` | **Done** — awaiting user approval of the engine path | `ea637e7`, `1123ed5` |
| 1 Literature review | `research/LIT_REVIEW.md`, `research/BIBLIOGRAPHY.md` | **Done** — 12 themes, ~240 entries, 118-row parameter table, 26 assumptions | `75d0d96` |
| 2 Discipline research → design | 16 files in `research/`, `docs/DESIGN.md` + 9 chapters in `docs/design/` | **Done** (review pass in progress) | `1123ed5` … `b09241a` |
| 3 Core sim architecture | `src/sim/**` | **Done** — six modules, tick loop, replay v4, public API | `18ba5e7` … `ef383c0` |
| 4 Strategy & game plans | `src/sim/ai/**` | **Done** — scouting, plans, utility AI, adaptation, corners, multi-opponent | `bffe627` … `f0f2371` |
| 5 Skill tiers | tier catalogue → behaviour/animation | **Done** — 196 rules wired into decisions, execution and defence | `b8215e6` |
| 6 Fighter creator | `src/app/**` | **Done** — database, 7-section editor, live derived panel, import/export | `06c47ac` … `d26d5a3` |
| 7 Match modes & features | match setup, tournaments, history, commentary, replay, spectator | **Done** — all modes, 14 rulesets x 9 arenas, worker-run bouts | see Phase 7 summary |
| 8 Graphics & animation | `src/presentation/**`, `docs/ASSETS.md`, `docs/design/PHASE8_NOTES.md` | **Done**: three r186 WebGPU/WebGL2 stage with TSL post, stat-driven MakeHuman bodies, mocap + procedural animation with IK, paired grapple solver, 9 arenas, broadcast director and replays, referee, corners and post-fight ceremony. Polished further in the overnight passes below | `cbcec1f` … `d470cc8` |
| 9 Calibration & validation | `docs/CALIBRATION.md`, `docs/design/PHASE9_TUNING.md`, `QA_FINDINGS.md` | **Done (partial calibration)**: batch runner and 125 metric functions, edge-case QA (QA-1..14), 31 sim bugs fixed, engine 5.0.0. Master rows PASS 1 → 23 of 125 (22 WIDE, 80 FAIL) over 8,180 bouts | `3a78295` … `2720d60` |

## Phase 0 — summary
- Existing engine: deterministic 0.1 s tick, seeded RNG, digest-verified replays, 128 passing tests; but a
  ~10-scalar fighter model, lottery action choice, 4-rung ground ladder, one damage scalar, capsule rig.
- Machine: Intel Core Ultra 7 256V (8 cores), 15.6 GB, Intel Arc 140V iGPU. Recommendation: stay on the
  web stack, upgraded (Three.js ≥ r170 WebGPU + WebGL2 fallback, skinned glTF, custom SSS, mocap + IK,
  post stack). Desktop engines rejected for this machine/team; tradeoffs recorded.

## Phase 1–2 — summary
- 12 research agents + 3 sub-agents; ~8,700 lines of sourced research; every `research/*.md` ends with
  numbered "sim rules" and an assumptions list. Web-search quota was exhausted mid-run; agents fell back to
  PubMed/Europe PMC/Crossref APIs and direct rulebook PDFs — gaps are flagged per file.
- Design: nine chapters written in parallel against `docs/design/00_CONVENTIONS.md`; an independent
  reviewer reconciles ids and numeric conflicts (`docs/design/REVIEW_LOG.md`).
- Headline design sizes: 74 positions / 186 grappling edges; 54 strikes; 54 submissions; ~190 tier
  behaviour rules; 13 rulesets; 129 calibration targets.

## Resource use
- All research/design work ran in cloud agents; local CPU/RAM stayed at idle levels. Local heavy work
  (batches, builds) begins in Phase 3 and will be sized to ≤ 93% via the monitor in ch. 09 §6.

## Phase 3 — summary
- `src/sim/` replaces the 1,000-line engine class: fighter, striking, grappling, submissions,
  damage and rules modules behind a frozen public API, composed by a P0–P9 tick loop.
- Millisecond action commitment with sub-tick contact ordering `(subMs, actorId, seq)`, so two
  fighters who commit in the same tick land in arrival order and can trade.
- Determinism preserved: seeded RNG with a fixed per-tick draw schedule, digest-verified replay v4,
  and engagement invariants I1–I8 checked every tick in four match modes.
- 646 tests pass (128 legacy + 518 new); `tsc --noEmit` clean.
- Parameter registry: 2,160 tunables, each carrying a unit, provenance tag and owning chapter.
  749 sourced, 198 derived, 1,213 explicit assumptions; an untagged number throws at registration.

## Phase 4 — summary
- Chapter 07 implemented: scouting with IQ-scaled noise, game-plan generation, IAUS utility
  selection with tier-scaled temperature, a 72-context opponent model with forgetting, 16
  adaptation rules, corner advice, and the multi-opponent manager.
- Running it exposed six integration defects that unit tests could not see, all fixed: strikes were
  mathematically unreachable (a mis-counted pace ledger zeroed their utility), fighters parked
  outside every range band in a graph node with no edges, setup and referee edges leaked into the
  candidate set, takedown completion was being erased by the stats layer, knockdowns were credited
  to the fighter who fell, and a TKO rule fired without reading the strike observable it exists for.
- `dmg.rawScale` corrected against chapter 05's own acceptance row (see
  `docs/design/PHASE4_FINDINGS.md`). Bouts now run 10.8 min with a realistic method mix.

## Phase 4 headline batch (historical: 40 bouts, two regional pros, MMA 3×5; current numbers in `docs/CALIBRATION.md`)

| Metric | Sim | Target |
| --- | --- | --- |
| Mean duration | 10.8 min | 10.6 |
| Method mix | 13 KO / 8 TKO / 19 dec | ~32% KO-TKO, ~49% dec |
| Knockdowns /15 min | 0.37 | 0.30 |
| Sig. accuracy | 42% | 46% |
| SLpM | 1.52 | 3.9 |
| Takedowns /15 min | 2.04 @ 72% | 1.45 @ 38% |
| Control minutes | 3.46 | 2.2 |

Duration, method mix and knockdown rate are on target. Output volume, takedown accuracy and
submission conversion are not, and are carried into Phase 9 with evidence in
`docs/design/PHASE4_FINDINGS.md`.

## Phase 5 — summary
- The 196-rule tier behaviour catalogue was dead data: `rulesFor()` was never called. It now gates
  repertoire (a T0 has no teep, no sprawl, no guard pass), drives execution quality and the novice
  tells, and every applied rule id is exposed on `FighterIntent` for the debug overlay and Phase 8.
- Two defects that only a running bout could reveal:
  - **Identical fighters won 70/30 by index.** The "one contested edge per engagement" slot was
    claimed first-come, and P3 iterates ascending id, so fighter 0 took it every tick he wanted it
    (448 vs 212 takedowns; striking was dead even). The slot is now contested by the intra-tick
    commit offset. 400 mirror bouts: 51%; 1,000 bouts: 47.7%.
  - **Chapter 02's entire reactive defence layer was dead.** Every candidate carried `def.neutral`
    rather than a catalogue id, so the defence resolver returned null on *every strike ever
    simulated*. Coverage now scales with tier: T0 5%, T3 43%, T5 72%, and connect rate falls
    monotonically from 69% (T0) to 36% (T5).
- Win matrix is now monotone in both directions; a brand-new fighter beats a regional pro 0–3% of
  the time (was 30%).

## Phase 6 — summary
- Fighter database + 7-section editor (Body, Appearance, Physical, Disciplines, Record, Mental,
  Style), 287 inputs, with per-field helper text explaining what each stat drives in the sim.
- Live derived panel shows per-discipline tiers and `deriveRuntime`'s arithmetic verbatim, so the
  numbers the simulation will actually use are visible while editing.
- Validation with field-level paths; persistence that survives storage failure and quota
  exhaustion; lossless JSON import/export preserving unknown fields.
- Verified in a real browser, not just compiled: 15 archetypes listed, opening one loads the full
  editor, no console errors.

## Phase 7 — summary
- **Match setup**: every mode (1v1, teams with 2v2/1v2/1v3/1v5/3v3, free-for-all 2-6, crowd 1-vs-2-8),
  all 14 rulesets x 9 arenas with a non-standard-pairing warning that warns rather than blocks,
  the full settings block, and a visible, copyable seed — a bout is a pure function of it.
- **Bouts run in a Web Worker** so the UI never freezes, with a parity test asserting the worker and
  main thread produce an identical digest, ticks, draw count, events and stats across five
  mode/ruleset/arena families. A worker must not be able to change a fight.
- **Tournaments**: single elimination 4/8/16/32, double 8/16, round-robin <=8; seeding by rating,
  manual or random (seeded from the tournament id); byes handled by one rule; carry-over none /
  sameNight / career with the documented damage and stamina fractions.
- **History**: re-watch, export, delete, and verification that reports `engine-version` mismatches
  honestly rather than silently failing.
- **Commentary** explains strategy, not just strikes, driven by plans, adjustments, corner cues and
  score belief ("EWB's corner asked for exactly this between rounds - he is headhunting for it").
  It runs on a forked RNG, so commentary provably cannot change a bout.
- **Watch screen**: frame-accurate transport with 0.1x-8x speed, event seek, loop, instant replay,
  four cameras, the visible game-plan panel, live stats, filterable event log and a debug overlay.

## Deep fighter customization — summary
Chapter 01 gained §8, "the fighter as a career". Every field is optional and defaults to its
formula's identity value; backward compatibility was proved by deriving a pre-change fighter and
comparing byte-for-byte.
- **Per art**: months since trained (rust decays that art's effective sub-skills *and* what it
  transfers out), start age, hours and sessions per week, coach quality, base-art flag, grade
  (BJJ belts and stripes, judo kyu/dan, wrestling credentials, amateur boxing class, Thai/karate/
  TKD/sambo ranks), competition record in that art, a 31-entry specialisation catalogue, and
  sparring intensity.
- **Overall**: total rounds fought, opposition level, main events, war fights, hard sparring years,
  years pro, title wins, and a direct experience override shown beside the derived value.
- **Physique and biography**: natural weight (cut severity), hand strength split, limb asymmetry,
  cardio background, weight-cut history, surgeries.
- **Injuries**: 11 regions mapping to attribute penalties and capability caps.
- Design choices worth noting: grade and competition raise an art's *mean* with a uniform offset so
  the authored skill shape survives; specialisations reshape mean-neutrally so nobody climbs a tier
  by ticking boxes.

## Phase 8 — summary (details: `docs/design/PHASE8_NOTES.md`)
- **Foundation** (`cbcec1f`, `ad1f83f`): three.js 0.169 → 0.186. A canonical 52-bone skeleton from MPFB2's rig,
  with FK verified to 1.7e-8 m. Two-bone IK. The presentation contract. The resource governor (`scripts/dev/heavy.mjs`).
- **Stage, camera, standing animation, assets** (`c6b858b`):
  - WebGPURenderer with a WebGL2 fallback, a TSL post chain (GTAO, TAAU/TRAA, bloom, ACES, broadcast LUT) and four
    quality presets;
  - a broadcast director (4 s minimum shot, no cut on a strike) and instant replays;
  - all 54 techniques landing on the recorded contact instant;
  - 99 retargeted ACCAD/CMU clips.
- **Arenas and grappling** (`7f1a94b`): the 9 arenas at the sim's wall geometry; paired poses for all 74 positions;
  115 of 187 transitions animated; 54 submissions staged.
- **Characters** (`84c1ecc`, `4a967da`): stat-driven MakeHuman bodies whose height and reach land within 1 mm of the
  fighter's stats. Skin with subsurface, sweat and zoned damage; hair; kit. Baked detail maps; 380 targets.
- **Integration and mocap** (`020bb14`, `3b0eccc`): the broadcast integrated in Watch. 36 of 54 techniques plus
  defences and idle driven by capture.
- **Broadcast polish** (`d470cc8`): a real referee body with clothing and occlusion avoidance; live cageside DoF;
  corner shots between rounds.
- **Sim fixes surfaced by the animation work:**
  - strikes from any distance (engine 4.1.0, `d49ec09`);
  - facing while moving and the engagement approach line (4.2.0, `93703b2`);
  - the referee's "Work!" warning emitted every tick (4.3.0, `c876264`).

## Phase 9 — summary (details: `docs/design/PHASE9_TUNING.md`, `docs/CALIBRATION.md`)
- **Batch runner and metrics** (`3a78295`): a worker-thread runner with a CPU/RAM governor; 12 plans (229 cells);
  metric functions for 125 of the 129 targets. The pre-tuning baseline (engine 4.3.0, 1,187 bouts) passed 1 row.
- **Edge-case QA** (`d610ff6`, `8ae9ad4`): QA-1..14.
  - The multi-fighter referee latch, street/crowd endings, grappling rulesets throwing strikes, unreachable fouls
    and tournament stalls were fixed in Phase 9.
  - Recorded frames moved to typed-array columns: 1v1 5R heap +45.8 → +4.9 MB.
- **Tuning** (`2720d60`, engine 5.0.0): 31 sim bugs fixed, most with pins in `tests/phase9.bugs.test.ts`. Over
  8,180 bouts:
  - master rows PASS/WIDE/FAIL went from 1/5/107 to 23/22/80;
  - SLpM 3.95 (target 3.90);
  - outcome mix KO-TKO/SUB/DEC 29/21/49 (target 32/18/49);
  - 3R duration 10.6 min (10.6);
  - identical fighters win 51.7 % as side A.
- **Misses carried forward:** tier populations, KD → finish conversion, KD by weight class, grappling shape by
  class, strategy checks. Several need model decisions rather than parameters.

## Overnight polish (2026-09-23/24)

A series of independent, measured passes after Phases 8–9. Each has a write-up with before/after numbers.
`FINAL_REPORT.md` collects them.

| Pass | What it did (headline numbers) | Write-up | Commits |
| --- | --- | --- | --- |
| Final-pass audit | Read-only checklist (C1–C4, H1–H6, M, L) that drove the cleanup, determinism and docs work | `docs/design/AUDIT_FINAL.md` | `d47dff5` |
| Independent review of Phases 8–9 | Found that bouts run from the app never started (the worker was never posted its message) and that the old venue was left in the scene, both fixed in `075d641`. Its other findings (import crash on prototype keys, GPU leaks, the heavy.mjs locks, Watch stuck on "Preparing broadcast…", device loss) were fixed in the passes below | `docs/design/REVIEW_PHASE8_9.md` | `075d641` |
| Resource governor | Arguments quoted for cmd.exe, locks reaped only when the owner is dead, a start gate, 3 slots, pinning to 5 of 8 cores, a 90 % memory gate | `scripts/dev/heavy.mjs` header | `0688ff3`, `4b72613`, `f97be32`, `7a5b42f`, `1ea0bd9` |
| Watch screen and replays; finish and corner | Viewport-first layout, keyboard map, stats at the playhead. Compressed archives (portable 3.4 KB vs 25–228 KB v4 JSON). IndexedDB library. React work at 4× 83 → 20 ms/s. 2D fallback on device loss. Post-fight ceremony and cornermen | `docs/design/WATCH_REPLAY_PASS.md`, PHASE8_NOTES "Finish and corner pass" | `b9525ab` |
| Animation quality 1–3 | Automated audit over ~140 k frames. Pops 335 → 26 per fighter-minute. Standing slide > 0.5 cm 9.3 % → 1.1 %. Contact misses 18.4 % → 1.3 %. Evaluate p95 0.50 → 0.36 ms | PHASE8_NOTES "Animation quality pass" 1–3 | `f04dea9`, `9a0adf1`, `de1507f` |
| Camera polish | Automated audit over 64,915 frames. Clipping 156 → 0. Aim jerk p95 3.75 → 2.13. Pan reversals 5.9 → 2.5 per minute. Replay camera max speed 11.3 → 0.64 screens/s | PHASE8_NOTES "Camera polish pass" | `3d1d80a` |
| Calibration tuning (Phase 9) | Engine 5.0.0. Master rows PASS 1 → 23 | `docs/design/PHASE9_TUNING.md` | `2720d60` |
| Arena and lighting lookdev | Canvas banding fixed. Near-fence lens blur. Fight marks (sweat, blood from recorded cuts) baked deterministically and wired to the recording | PHASE8_NOTES "Arena and lighting lookdev pass" | `fe1d335`, `91abcaa` |
| Rendering performance 1 | Lens DoF 4 → ~1 ms. GPU-timed dynamic resolution. Shared programs 331 → 148 compiles. WebGL2 cold longest freeze 31 s → 1.7 s. LOW–ULTRA profiles with an automatic default | PHASE8_NOTES "Performance pass" | `37fa643`, `4e9f4c4` |
| Simulation performance | 2.3–2.7× faster with results bit-identical (310/310 golden). 1,000-bout batch 756 → 294 s. New 41-bout golden test | `docs/design/SIM_PERF_PASS.md` | `23d329a` |
| Browser QA2 | 11 findings, including the WebGPU rebuild hang, the quality-switch crash, the bout-switch leak, and team wins shown as no contest | `docs/design/QA2_FINDINGS.md` | `1ea0bd9` |
| UI/UX overhaul (UI pass 1) | Design system; fighter editor profile view with parameter-effect tests; Batch screen (5,000 bouts, 0 errors, fingerprint identical for any worker count); QA2 #4, #5, #7–#10 fixed | `docs/design/UI_PASS.md` | `d1f14bf`, `55c7d66` |
| Batch runner headroom | Pauses at 88 % CPU/RAM, resumes below 80 % | `scripts/batch/monitor.ts` | `07960bb` |
| Cleanup | Legacy v3 stack retired. CI determinism on the v4 golden corpus. 31 MB of unused assets removed. `dist/` 53.3 → 18.4 MB | AUDIT_FINAL (resolved items) | `f54d16e`, `fdc9dfd` |
| Rendering performance 2 | WebGL2 cold load 38.9 s → 9.7–16.0 s. Close-shot scene pass −11 to −23 %. Corner camera clear of the crew. QA2 #1 (WebGPU rebuild hang) and #2 (quality-switch crash) fixed | PHASE8_NOTES "Performance pass 2" | _uncommitted at time of writing_ |
| Leak fix | QA2 #3: five retainers found. WebGL2 heap over bout switches 42 → 182 MB before, 39.6 → 49.4 MB over 20 switches after; renderer counts flat | PHASE8_NOTES "Leak fix" | _uncommitted at time of writing_ |
| UI pass 2 | Code splitting: first-screen JS 1,048 → 375 KB gzip; TTI 458 → 302 ms. Step-based Match setup and Tournaments. Debug switches gated (audit H3). App per-frame costs (H4) | UI_PASS "UI pass 2" | _uncommitted at time of writing_ |
| Realism pass | Engine 6.0.0 (draft) | `docs/design/REALISM_PASS.md` | _placeholder: to be filled when it lands_ |
| Final documentation | README rewrite, `FINAL_REPORT.md`, this section | `FINAL_REPORT.md` | _uncommitted at time of writing_ |

## Known gaps carried forward

(Historical list from Phases 4–6. F-3 was closed in `0540e9a`. The T2/T3 separation, durability and output items
went to Phase 9: output volume now meets its target, and tier populations remain open (`PHASE9_TUNING.md` §5).
The current list is in `FINAL_REPORT.md` §28.)

- **Style preferences do not affect a bout** (F-3). Favourite techniques, combos, go-to submissions
  and takedown preferences are authored, validated and stored, but no AI code reads them. Phase 7.
- **T2 and T3 are not separated** in the win matrix (~37-43% both directions). The tier *logic* is
  monotone; these two archetypes are close in attributes. Phase 9.
- **Nothing on the durability side is tier-keyed** while `tierForceMult` spans 0.22–1.05, so an
  elite fighter hits much harder but is no harder to hurt. Documented with a controlled ladder in
  `docs/design/PHASE4_FINDINGS.md`; the duration-ordering test is skipped with a pointer rather
  than weakened. Phase 9.
- Output volume (SLpM), takedown accuracy and submission conversion remain off target — Phase 9.

## Open decisions
1. ~~**Engine path**~~ — approved 2026-09-22: stay on the upgraded web stack.

## UI polish pass — summary (details: `docs/design/UI_PASS.md`)
- Design system: `src/app/theme.css` (stable token contract, light/dark, reduced motion) and
  `src/app/ui/*` (Button, Tabs, Segmented, Slider, Select, Field, Switch, Dialog/confirm, Tooltip,
  StatusBadge, Empty/Loading/Error states, Alert, Progress, Toasts with Undo, icons).
- Shell: grouped left navigation with a collapsible rail; legacy v3 Replay/Dashboard/Model tabs
  removed (the app no longer imports `src/ui|engine|render|replay|data`); new "About the model".
- Fighter editor: Physical / Athletic / Technical / Style / Mental / Experience profile view with
  Basic/Advanced, search, presets, comparison, undo/redo; every live control is verified to change
  the bout by `tests/ui.params-effect.test.ts`; seven stored-but-unread controls are labelled.
- New Batch simulation screen on a Web Worker pool with ETA, cancel, CIs and a digest fingerprint
  that is identical for any worker count.
- Fixed: import crash on prototype-named keys; tournament lost update.
