# Progress

Live status of the realism overhaul. Updated at the end of every phase. Commits are staged so any phase can
be rolled back independently.

## Phase status

| Phase | Deliverable | Status | Commits |
| --- | --- | --- | --- |
| 0 Audit & engine decision | `docs/AUDIT.md`, `docs/ENGINE_DECISION.md` | **Done** — awaiting user approval of the engine path | `ea637e7`, `1123ed5` |
| 1 Literature review | `research/LIT_REVIEW.md`, `research/BIBLIOGRAPHY.md` | **Done** — 12 themes, ~240 entries, 118-row parameter table, 26 assumptions | `75d0d96` |
| 2 Discipline research → design | 16 files in `research/`, `docs/DESIGN.md` + 9 chapters in `docs/design/` | **Done** (review pass in progress) | `1123ed5` … `b09241a` |
| 3 Core sim architecture | `src/sim/**` | Not started — blocked on engine decision | |
| 4 Strategy & game plans | `src/sim/ai/**` | Not started | |
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

## Open decisions
1. **Engine path** — user approval required before Phase 3 (see `docs/ENGINE_DECISION.md`).
