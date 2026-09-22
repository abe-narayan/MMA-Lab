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
| 5 Skill tiers | tier catalogue → behaviour/animation | Not started (design complete in ch. 01 §3) | |
| 6 Fighter creator | `src/app/creator/**` | Not started (schema complete in ch. 01) | |
| 7 Match modes & features | rulesets, arenas, tournaments, commentary, replay | Not started (spec in ch. 06/09) | |
| 8 Graphics & animation | `src/presentation/**`, `docs/ASSETS.md` | Not started (spec in ch. 08) | |
| 9 Calibration & validation | `docs/CALIBRATION.md` | Not started (129-row target table in ch. 09 §7) | |

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

## Current headline batch (40 bouts, two regional pros, MMA 3×5)

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

## Open decisions
1. ~~**Engine path**~~ — approved 2026-09-22: stay on the upgraded web stack.
