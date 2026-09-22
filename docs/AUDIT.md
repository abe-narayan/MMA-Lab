# Bout Lab — Phase 0 Codebase Audit

Date: 2026-09-22. Audited at commit `9bcdbd7` ("Bout Lab: deterministic, seed-replayable bout simulator").
Test status at audit time: `npm test` → 4 files, 128 tests passing; `tsc --noEmit` clean.

Target machine (measured during the audit): Intel Core Ultra 7 256V (8 cores / 8 threads, no SMT),
15.6 GB RAM (≈5.5 GB free at audit time), Intel Arc 140V integrated GPU (8 GB shared), Windows 11,
Node 24.19. This is a thin-and-light laptop, not a workstation — it constrains the engine decision
(see `ENGINE_DECISION.md`) and the headless batch sizing for Phase 9.

---

## 1. What exists today (codebase map)

| Layer | Files | LoC | Summary |
| --- | --- | --- | --- |
| Engine | `src/engine/{engine,params,fighter,actions,types,rng,recorder}.ts` | ~1,930 | Deterministic fixed-timestep (0.1 s) state machine. 23 actions, 7 defence postures, 4 postures, 6 ground positions. sfc32 RNG, FNV-1a digest. |
| Replay | `src/replay/player.ts` | 117 | Re-executes engine from seed; verifies digest; frame transport. |
| Render | `src/render/{renderer,arena,fighterRig,cameras,index}.ts` | ~2,520 | Three.js r169. Procedural capsule humanoid posed from snapshots; octagon; 4 cameras; ring/flash impact sprites; ACES tone-mapping, PCF soft shadows. |
| UI | `src/ui/*.tsx`, `*.css` | ~4,930 | React 18. Replay / Dashboard / Model tabs. Format (1v1..1v5) + bout index selector over a **pre-generated 5,000-bout corpus**. HUD, timeline, hand-written SVG charts. |
| Scripts | `scripts/*.ts` | ~1,140 | generate / verify / consistency / exportBout / calibrate / inline (single-file build). |
| Tests | `tests/*.test.ts` | ~1,580 | RNG, engine invariants, determinism/replay guarantee, analytics vs event log. |
| Data | `src/data/replays.ts`, `public/replays/**` | — | 5 formats × 1,000 bouts (seed + digest + summary), 100 full event files per format. |

**Stack:** TypeScript 5.6, Vite 5, React 18, Three.js 0.169, Vitest 2, tsx. No physics library, no
animation library, no state-management library, no worker (the `src/workers/` directory named in the
README does not exist). Build target ES2022; single-file offline build via `scripts/inline.mjs`.

### 1.1 Simulation

- **Tick loop** (`engine.ts:step`): clock → upkeep → actions (ascending id) → steering/integration →
  referee → digest. Order is part of the determinism contract. Sound foundation; worth keeping.
- **Fighter representation**: `AthleteProfile` = height, weight, age, three 1RM lifts, TKD/boxing/
  grappling years, conditioning 0–1, training days/week. `deriveAttributes()` collapses this into
  ~10 scalars (`strikingIndex`, `grapplingIndex`, `techniqueIndex`, `powerIndex`, `speed`, stamina,
  `durability`). Reach is `height × 0.51` — **identical for any two fighters of equal height**, so reach
  advantage does not exist in the model. There is no age curve, no chin, no hand speed, no flexibility,
  no fight IQ, no per-discipline sub-skills, no style, no stance, no handedness.
- **Movement**: 2-D point masses (x, z) with accel/drag/speed cap, cage clamp, pairwise body
  separation. Steering is "advance / retreat / circle relative to nearest opponent" with a preferred
  range derived from `strikingIndex`. No cage awareness (no cutting off, no wall pressure), no angles,
  no lead-foot position, no stance geometry.
- **Combat**: every resolution is one logit → sigmoid roll. Strikes: 10 kinds, one `baseDamage` each,
  one scalar `damage` per fighter (no head/body/leg regions), `flushChance` 5 % placement lottery.
  Defence is a single posture chosen at action commit (`highGuard`/`slip`/`parry`/…) and applied as a
  logit offset — no reactive defence, no counters, no feints, no combinations, no range management
  beyond `d <= range`.
- **Grappling**: clinch is a single undifferentiated state. Ground is a 4-rung ladder
  `guard → half → side → mount` plus an unreachable `back` (nothing ever sets it). One `submission`
  action with a scalar `subProgress`; no named submissions, no stages, no chains, no escapes other
  than a `subDefend` flag. No takedown types, no sprawl-and-reattack, no scrambles, no cage wrestling,
  no wrestle-ups, no ground-and-pound positional differences beyond a mount/side multiplier.
- **Damage/fatigue**: one stamina pool, one damage scalar, one balance scalar. Knockdown = damage
  above a threshold; TKO = damage ≥ durability. No rocked state, no KO (only referee stoppage), no
  cuts, no leg damage, no body damage, no per-round physiology, no adrenaline dump.
- **Referee/judges**: accumulated damage, unanswered ground strikes, downed-and-hit, stall stand-up.
  Three judges on a scalar margin with Gaussian noise; 10-9 only; no 10-8s, no fouls, no doctor.
- **AI**: weighted random draw (`chooseAction`) over posture-appropriate actions with distance gates,
  a per-bout tendency jitter and a softmax temperature. **No goals, no plan, no memory, no opponent
  model, no adaptation, no score awareness.** A fighter cannot "notice" anything.
- **Multi-opponent** (1vN): emergent from geometry plus three constants (`swarmStaminaPenalty`,
  `focusPenaltyLogit`, `1/sqrt(engagedBy)` defensive cover). Team B fan-out, soft teammate repulsion.
  There is no target selection beyond "nearest", no flanking, no threat prioritisation, no teams
  other than A vs B, no free-for-all.

### 1.2 Presentation

- **Fighter model**: procedural capsules (pelvis, chest, yoke, head, 4 limbs × 2 segments, gloves)
  with a hand-authored pose per action keyed to `actionPhase`. Smoothing is an exponential filter on
  joint angles. No skeletal mesh, no skinning, no textures, no faces, no IK, no ragdoll, no contact
  between the two bodies (clinch/ground poses are approximations placed by offset).
- **Arena**: octagon posts/panels/rails, canvas floor, apron, hemisphere + key/fill/rim + ambient
  lights, one shadow-casting directional light. No crowd, no environment, no HDR environment map,
  no post-processing (no bloom/DoF/motion blur/AO/TAA), no broadcast graphics beyond a React HUD.
- **Cameras**: orbit / top / side / follow. No automatic broadcast cutting, no instant replay, no
  slow motion (playback speed exists, 0.25×–4×, but no replay-of-a-moment system).
- **Renderer settings**: `antialias: true`, ACES, sRGB, PCF soft shadows, pixel ratio capped (needs
  confirming in `resize()`). No quality presets.

### 1.3 Product surface

- Users can only choose one of 5,000 canned matchups between two hard-coded profiles (`ATHLETE_A`
  vs N × `ATHLETE_B`). There is **no fighter creator, no live simulation from the UI, no ruleset
  choice, no round/time settings, no tournaments, no history, no commentary, no game-plan panel**.
- Analytics dashboard and Model tab are strong for what they cover (Wilson CIs, trajectories,
  parameter table with derivations) and should survive as the calibration/debug surface.

### 1.4 Engineering quality

Strong: determinism contract and digest verification; engagement invariant with a sweep script;
every assumption in one `params.ts`; honest documentation; CI regenerates the corpus and diffs it.
Weak: `engine.ts` is a 1,000-line god class; actions/resolution/AI/referee/judging are interleaved;
there is no scripting of matchups beyond the two profiles; the renderer reads `ATHLETE_A/B` directly
(`renderer.ts:athleteAttributes`), so it cannot draw arbitrary fighters; the README's `src/workers/`
and `scripts/smoke.ts` do not exist.

---

## 2. Ranked gaps (largest first)

Ranking criterion: how far the system is from "watching a real UFC broadcast with fighters who fight
like real people", weighted by how much downstream work depends on it.

| # | Gap | Area | Why it ranks here |
| --- | --- | --- | --- |
| 1 | **No decision-making** — action choice is a weighted lottery; fighters have no intent, plan, memory, opponent model, or adaptation. | Strategy / AI | Everything in Phase 4 and 5 (game plans, physical-advantage exploitation, tier behaviours, adaptation) needs a real decision layer. Nothing today can be extended into it. |
| 2 | **Fighter model is ~10 scalars derived from lifts and years.** No reach, chin, hand/kick speed, flexibility, fight IQ, composure, stance, handedness, per-discipline sub-skills, style, tendencies. | Realism / Depth | The Fighter Creator (Phase 6) and tier realism (Phase 5) are impossible on this representation. The whole attribute/skill schema must be redesigned. |
| 3 | **Grappling is a 4-rung ladder with one anonymous "submission".** No named positions beyond 5, no back control, no turtle, no half-guard variants, no clinch positions, no takedown types, no cage, no scrambles, no chains, no escapes. | Realism / Depth | Phase 3's positional state graph is a from-scratch build. Current ground game cannot produce a technical exchange between two elite grapplers. |
| 4 | **Striking has no range management, combinations, feints, counters, or reactive defence.** Single-roll hit model; defence is a pre-chosen posture. | Realism | Elite striking exchanges (feint → read → counter) cannot occur. Reach/height advantages cannot be expressed. |
| 5 | **One damage scalar; no KO, rocked state, regions, cuts, leg/body damage; single stamina pool.** | Realism | Finish types are limited to "referee stoppage" and "tap"; no flash KOs, no leg-kick TKOs, no doctor stoppages; no visible hurt behaviour. |
| 6 | **Visuals: capsule mannequins, no mesh/skin/face/IK/contact, no post-processing, no crowd.** | Visuals | Furthest from the "4K broadcast" target. Fixable only after the engine decision. |
| 7 | **Animation: hand-authored per-action poses, no mocap, no blending graph, no two-body constraints.** Clinch/ground bodies do not actually touch. | Visuals / Animation | Every new technique needs readable motion; current pose system does not scale to 100+ techniques. |
| 8 | **No rulesets, arenas, match settings, tournaments, history, commentary, game-plan panel, replay-of-moment.** | Features | Phase 7 in its entirety. |
| 9 | **Referee/judging are placeholders** — no fouls, no 10-8s, no doctor, no unified-rules criteria, no strictness. | Realism | Outcome distributions cannot match real data without real stoppage/judging logic. |
| 10 | **Multi-opponent AI is "attack the nearest".** No target selection, flanking, threat management, teams beyond A/B, free-for-all. | Depth | The user wants to keep and improve these; current geometry-driven design is a good base but the AI is empty. |
| 11 | **UI only plays a canned corpus** — no live sim from the browser, no custom matchups. | Features | Blocks every interactive feature. Live sim path exists in code (`BoutSimulation`) and is cheap (50–300 ms per bout). |
| 12 | **`engine.ts` monolith** — AI, resolution, referee, judging, movement in one class. | Engineering | Must be decomposed before 10× growth; the tick-order determinism contract must be preserved through the split. |
| 13 | **No calibration to real data** (by design, stated honestly). | Calibration | Phase 9 needs the FIGHT_DATA targets and a headless batch runner with worker pooling under the CPU/RAM cap. |
| 14 | **Renderer coupled to `ATHLETE_A/B`** and to the engine's `ACTIONS` table. | Engineering | Must be replaced by a presentation contract driven by the snapshot + fighter appearance data. |

---

## 3. What to keep

- The determinism contract, digest verification, replay-by-seed, and the CI that enforces them.
- The engagement invariant idea (grappling pairs are always consistent) — generalise it to the new
  state graph.
- `params.ts` as the single home for tunables — extend to a research-traced parameter registry.
- The analytics dashboard and Model tab as the calibration/inspection surface.
- Multi-opponent geometry (fan-out, repulsion, emergent engagement counts) as the base of crowd mode.
- The fixed 0.1 s tick for the decision/resolution layer. (Animation runs at display rate on top; a
  finer sub-tick may be needed for strike timing — see DESIGN.md.)

## 4. Constraints that shape the redesign

- **Hardware**: integrated GPU and 16 GB RAM. Headless batches must be sized to ≤ 7 workers and
  monitored; realistic rendering must be budgeted for an iGPU at 1440p–4K (see ENGINE_DECISION.md).
- **Offline single-file build** is a current feature; heavy assets (models, mocap) will break the
  "one HTML file" property. Recommendation: keep a "lite" single-file build with the procedural rig
  and make the high-fidelity asset pack an optional, separately-served bundle.
- **Determinism** must survive: the new decision layer and every new resolution must draw from the
  seeded RNG in a fixed order; presentation must remain a pure function of recorded state.
