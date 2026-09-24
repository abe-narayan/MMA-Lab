# BOUT LAB: final report

This report covers the state of the project at the end of the overnight polish pass (HEAD `fdc9dfd` plus
the uncommitted work listed under "Pending at time of writing"). Every number here is copied from a
measurement document in the repository, which is named next to it. Numbers not measured are marked
**(not measured)**. The development and measurement machine throughout was an Intel Core Ultra 7 256V (8
cores) with 15.6 GB of RAM and an Intel Arc 140V integrated GPU, on Windows. Other agents' jobs were often
sharing that machine while measurements ran, so absolute timings are upper bounds. Where a pass used A/B
methods, its relative results are the ones to trust.

---

## Final quality gate

Run on a clean checkout of `main` at `3f80e0d` (the code this report ships with; this commit only adds docs),
engine **5.0.0**, on the development laptop (Core Ultra 7 256V, 16 GB, Node 24):

| Check | Command | Result |
|---|---|---|
| Unit, integration, replay and determinism tests | `npm test` | **49 / 49 files, 1,471 passed, 0 failed**, 2 skipped, 1 todo (422 s) |
| Typecheck | `npx tsc --noEmit` | **0 errors** |
| Production build | `npx vite build` | **ok**, built in 10 s, `dist/` 22 MB (first-screen JS 375 KB gzip) |
| Golden corpus | `npm run golden:check` | **41 / 41 bouts identical**; recorded and unrecorded runs share every digest |
| Engine version | `src/sim/record/recorder.ts` | `5.0.0` |

Notes: the batch-runner determinism test (`calibration.infra`, 1 vs 2 workers) needs about 3 minutes and hit its
180 s timeout once when the whole suite ran beside other heavy jobs; it passes on its own and in this run. The
lint step is `tsc` (the project has no separate linter). Browser smoke tests were done by the QA2 pass
(`docs/design/QA2_FINDINGS.md`) and the per-pass capture scripts, not in CI.

**Realism pass: not merged.** It is parked on branch `realism-6.0` (commit `262b6ce`, engine 6.0.0) and
`main` stays at engine **5.0.0**. Its structural fixes work and its sim tests are green, but it was not
recalibrated before the deadline: takedown accuracy (26 % vs 38 %), knockdown rate (0.48 vs 0.30 per 15 min),
outcome mix (28 / 13 / 58 vs 32 / 18 / 49) and KD-to-finish (38 % vs 65 %) moved out of tolerance on a 330-bout
run, it is ~25–30 % slower per tick, and four UI/presentation tests depend on the old bout content. What it found
(dead code, not bad numbers) is the most important next step; see §29 and `docs/design/REALISM_PASS.md` on that
branch: grappling skills were never applied (alias mismatch), the chapter 02 tactical layer was never used at
contact, feints did nothing, the counter boost never switched off, movement lasted one tick, score belief read a
field nothing wrote, plan labels were ignored, no rotational KO term. On that branch handedness, balance, grip
strength, initiative, game plan, plan B, risk-when-behind and heart all affect bouts; on `main` they are still
badged "No effect on the bout" in the editor (§20).

**Leak fix and UI pass 2** landed in `d8717f5` (with rendering pass 2); final-review fixes in `e516c59`, `3f80e0d`.
Leak fix: GPU geometries/textures/programs and scene objects flat across 20 bout switches on WebGPU and WebGL2
(QA2 measured +~40 geometries and ~10 MB heap per switch before); the JS heap still drifts ~0.4 MB per switch
(cause not found). UI pass 2: first-screen JS 1,048 → 375 KB gzip, desktop ready 458 → 302 ms.

---

## 1. Project overview

BOUT LAB is a browser application with three layers:

1. **A deterministic simulation** of MMA-style bouts (`src/sim`). It covers fighters, striking, grappling,
   submissions, damage and fatigue, rules, the referee, judges and AI. The sim advances on a 0.1 s tick. It runs
   the same in Node, in a Web Worker and on the main thread.
2. **A three.js broadcast viewer** (`src/presentation`) that renders a recorded bout. It builds stat-driven
   bodies, animates them from motion capture plus procedural animation and IK, stages arenas and lighting,
   cuts between cameras and plays instant replays. It never writes back into the sim.
3. **A React app** (`src/app`). Its screens are the fighter database and editor, Match setup, Batch simulation,
   Tournaments, Watch, Result, History and About the model. It runs bouts in workers, keeps a replay library, and
   saves, imports and exports files.

The work followed a phased plan (`docs/PROGRESS.md`): an audit and engine decision (Phase 0), literature and
discipline research (1–2), the core sim (3), strategy AI (4), skill tiers (5), the fighter creator (6), match
modes (7), graphics and animation (8), calibration (9), and then an overnight polish pass of independent,
measured passes (§ "Overnight polish" in `docs/PROGRESS.md`).

It is a modelling toy. Its numbers come from a parameter registry of stated assumptions. §28 covers how far
calibration against published fight statistics got and where it falls short.

## 2. Current architecture

```
            ┌───────────────────────── src/app (React) ─────────────────────────┐
            │ screens · design system (theme.css, ui/*) · store (localStorage)  │
            │ replay/ (player, archive, IndexedDB library, statsAt, markers)    │
            │ workers/ (bout worker, batch worker pool)   run/ (runBout, load)  │
            └──────────────┬───────────────────────────────┬────────────────────┘
                           │ SimConfig + seed              │ recording (frames, events)
                           ▼                               ▼
   ┌────────── src/sim (pure TS, no DOM) ──────────┐   ┌──── src/presentation (three r186) ────┐
   │ core/ tick loop P0–P9, bind, scheduler, world │   │ presenter.ts → animator (anim/, rig/) │
   │ fighter/ striking/ grappling/ submissions/    │──▶│ character/ arena/ referee/ corner/    │
   │ damage/ rules/ ai/ params/ rng/ record/       │   │ finish/ camera/ stage/ (WebGPU/WebGL2)│
   │ commentary/ (forked RNG, post-hoc)            │   └───────────────────────────────────────┘
   └───────────────────────────────────────────────┘
```

- **One-way data flow.** `src/sim` imports nothing from `src/app` or `src/presentation`. The presentation reads
  snapshots and events and never writes into sim state. The review checked this by search
  (`docs/design/REVIEW_PHASE8_9.md`, "Checked and found sound").
- **Workers.** Single bouts run in a bout worker (`src/app/workers/simProtocol.ts`). A parity test checks that the
  worker and the main thread produce identical digests, ticks, draws, events and stats. Batches run on a worker
  pool (`batchWorker.ts`). The CLI runner uses Node `worker_threads` (`scripts/batch/`).
- **Rendering.** `WebGPURenderer` (three r186), with its own fallback to WebGL2 and a TSL post-processing
  chain. Watch falls back to the 2D board if 3D cannot start or the device is lost twice.

## 3. Major systems

| System | Where | Size / scope (source) |
|---|---|---|
| Fighter model | `src/sim/fighter` | schema, derivation (`deriveRuntime`), 196-rule tier catalogue, 15 archetypes (`docs/PROGRESS.md` Phases 3, 5) |
| Striking | `src/sim/striking` | 54 techniques, range bands, reactive defence, counters, two-stage landing, force model |
| Grappling | `src/sim/grappling` | 74-position state graph, 187 edges, engagement registry with invariants I1–I8, cage, ground-and-pound |
| Submissions | `src/sim/submissions` | 54 techniques, 4-stage battle, 132 chain edges, tap / loss-of-consciousness model |
| Damage, fatigue, consciousness | `src/sim/damage` | regional damage, cuts, knockdowns and KOs, three-pool fatigue, recovery |
| Rules | `src/sim/rules` | 14 rulesets, 9 arenas, referee, judges |
| AI | `src/sim/ai` | scouting, game plans, utility selection, opponent model, adaptation, corner advice |
| Parameter registry | `src/sim/params` | 2,160 tunables, each with a unit and provenance tag (`docs/PROGRESS.md` Phase 3) |
| Recording and replay | `src/sim/record`, `src/app/replay` | replay v4, typed-array frame store, archive container, IndexedDB library |
| Characters | `src/presentation/character` | MakeHuman/MPFB2 bodies fitted to each fighter's stats, skin, hair, kit, damage |
| Animation | `src/presentation/anim`, `rig` | mocap + procedural standing animator, paired grapple solver, IK |
| Arena and lighting | `src/presentation/arena` | all 9 arenas at the sim's exact wall geometry, crowd, fight marks |
| Referee, corners, finish | `referee/`, `corner/`, `finish/` | referee body and placement, cornermen between rounds, post-fight ceremony |
| Camera | `src/presentation/camera` | broadcast director, shot planner, replay planner, occlusion, manual cameras |
| Stage | `src/presentation/stage` | renderer, post chain, quality profiles, dynamic resolution |
| Batch | `scripts/batch`, `scripts/calibrate`, `src/app/screens/BatchSim.tsx` | CLI runner with resource governor, calibration metrics, in-app batch screen |
| Resource governor | `scripts/dev/heavy.mjs` | slot, memory and CPU gates for heavy local commands |

## 4. How the simulation works

**Time base.** A fixed step of **0.1 s** (`core.dtMs` = 100; the golden corpus also runs 50 and 200 ms as
overrides). Actions commit at millisecond resolution inside a tick. Contacts go into a sub-tick queue and resolve
in `(subMs, actorId, seq)` order, so two fighters who commit in the same tick land in arrival order and can trade
(`docs/PROGRESS.md` Phase 3).

**The tick loop** (`src/sim/core/loop.ts`). The phase order is part of the determinism contract:

| Phase | Work |
|---|---|
| P0 clock | round and break transitions, break recovery |
| P1 perception | push last tick's observed state into each fighter's ring buffer |
| P2 upkeep | fatigue, damage decay, timers, engagement counters (no RNG draws) |
| P3 decide | the AI chooses from **delayed** perception (reaction latency in ticks); the scheduler enqueues contacts |
| P4 resolve | every contact due this tick, in arrival order; a knockdown can cancel a punch already on its way |
| P5 move | steering, integration, separation, arena walls |
| P6 referee | stoppages, counts, stand-ups, fouls, doctor |
| P7 judges | accumulate round signals; score at the bell |
| P8 commentary | nothing at run time (commentary is built afterwards from the event log on a forked RNG) |
| P9 digest | fold this tick's state into the fingerprint |

Loops over fighters run in ascending id order. Loops over engagements run in ascending `(a,b)` order.

**RNG and the draw schedule.** One seeded generator per bout (`src/sim/rng/rng.ts`, sfc32 seeded through
xmur3 string hashing). Its draw position depends only on how many fighters are live, never on what they
chose:
- In P3, every live fighter consumes exactly `DRAWS_PER_DECIDE` = **8** draws per tick. It is **9** when more
  than two fighters are live (one extra for target switching). A policy that uses fewer has the remainder taken
  for it. The last draw is the commit jitter. A policy that overdraws is a bug, and tests catch it.
- P5 takes `DRAWS_PER_MOVE` = 1 draw per live fighter (steering jitter).
- Each strike resolution takes `DRAWS_PER_STRIKE` = 6 draws. Each contested grapple edge takes
  `GRAPPLE_EDGE_DRAWS` = 4.
- The Phase 9 tuning added governors and rules that are all draw-free or reuse an existing draw, so the schedule
  did not change (`docs/design/PHASE9_TUNING.md` §3, "Determinism").

**Digest.** `src/sim/rng/digest.ts` is a 32-bit FNV-1a rolling hash over state quantised to 1e-3, updated in P9.
The golden harness also hashes full-precision JSON of every snapshot, because the quantised digest alone could miss
a changed low bit (`docs/design/SIM_PERF_PASS.md` §2).

**Public API.** `src/sim/index.ts` exposes `simulate()`, `createSim()`, the derivation, the archetypes, rulesets and
arenas, `computeStats`, `verifyReplay` and `SIM_ENGINE_VERSION`.

## 5. How fighters are represented

A `FighterDefinition` (authored data) is turned into a runtime fighter by `deriveRuntime`
(`src/sim/fighter/derive.ts`). The live derived panel in the editor shows that arithmetic word for word.

- **Body:** height, reach, leg reach, fight-night and walk-around mass, age, stance, handedness, body fat, somatotype.
- **Physical / athletic:** strength, explosiveness, speed, hand and kick speed, reaction time, cardio, recovery, chin,
  body toughness, neck strength, flexibility, balance, grip strength.
- **Disciplines** (ten arts): sub-skills per art, and per-art career data added in the deep-customisation work
  (`docs/PROGRESS.md`, "Deep fighter customization"). That covers months since trained (rust), start age, hours
  and sessions per week, coach quality, grade (belts, dan/kyu, credentials), competition record, a 31-entry
  specialisation catalogue and sparring intensity.
- **Record / experience:** pro record, total rounds, opposition level, layoff, an experience override.
- **Mental:** fight IQ, composure, discipline, adaptability, aggression, heart.
- **Style:** preferred range, pressure, guard style, takedown preferences, behaviour when hurt, favourite
  techniques and submissions, pacing.
- **Injuries** in 11 regions, which map to attribute penalties and capability caps.
- **Appearance:** cosmetic only (face preset, skin tone, hair, tattoos).

**Tiers.** Each discipline derives a skill tier from T0 (untrained) to T5 (elite). The 196-rule tier catalogue
gates repertoire (a T0 has no teep, no sprawl and no guard pass), execution quality, novice tells and defence
coverage. For example, reactive defence coverage is 5 % at T0, 43 % at T3 and 72 % at T5 (`docs/PROGRESS.md`
Phase 5). Grades and competition raise an art's *mean* by a uniform offset, so the authored skill shape
survives. Specialisations reshape skills mean-neutrally.

**Storage and validation.** `src/app/store/validate.ts` validates with field-level paths and physical bounds
(height, mass, pacing ranges, a 60-character name cap). Fighters persist in localStorage. Import and export are
lossless JSON with a schema version.

## 6. AI and decision-making

Chapter 07 of the design, in `src/sim/ai`:

- **Scouting** with noise scaled by fight IQ, then **game-plan generation** from skills, physique, pressure and
  scouting. Style preferences drive plan generation and action selection. Measured over 150 seeded bouts per
  variant, a preference raises that technique's usage (guillotine ×1.46, armbar ×1.64, leg kick ×1.32; commit `0540e9a`).
- **Utility selection (IAUS)** over roughly 50 candidates per decision, with nineteen consideration axes and a
  softmax whose temperature scales with tier (`docs/design/SIM_PERF_PASS.md` §2).
- **A 72-context opponent model** with forgetting, and a **30-second exchange ledger** of hit rates by action family.
- **16 adaptation rules**, and **corner advice** between rounds.
- **Phase 9 governors** set pace, takedown rate, clinch entry, grapple tempo and feints, plus a submission hazard
  by position. Unfamiliar strikes land more often until a fighter has read his opponent
  (`docs/design/PHASE9_TUNING.md` §3).
- Every applied tier rule id is exposed on `FighterIntent`, which feeds the debug overlay and the animation layer.
- **Delayed information only.** The policy sees `ObservedState` from the fighter's perception buffer, lagged by his
  reaction latency, never the live world.
- The multi-opponent manager (`ai/multi.ts`) exists, but only tests import it. Target selection in live
  multi-fighter bouts falls back to the nearest opponent (`docs/design/AUDIT_FINAL.md` M2).

## 7. Animation

The chain is **simulation state → targets → IK → pose**. The sim records positions, facing, posture, the
committed action and its contact instant, engagement nodes and events at 10 Hz. The animator
(`src/presentation/anim/animator.ts`) turns those into a pose for every fighter on every display frame:

0. **Placement.** Interpolated recorded positions, fighters facing their opponent, and a monotonic display-range
   compression for 1v1 beyond 1.0 m. The sim throws from centre distances past anatomical reach, so this
   compression lets strikes arrive while keeping the sim's ordering of ranges.
1. **Bodies.** Layer 0 is stance and footwork. Layer 1 is the action body (strike or defence). Layer 2 is hit
   reactions. Layer 3 is fatigue and damage posture. The layers accumulate into a `BodySpec`, which is solved for
   pelvis, spine and head, with planted-foot leg IK.
2. **Guards and weapons.** Guard hands come first. Then the striking hand or leg is re-aimed onto the opponent's
   *solved* body, so a jab lands on the chin where it is on this frame, at the recorded contact instant.
3. **Grappling.** Engaged pairs go to the paired grapple solver (`anim/grapple/`). It has bespoke poses for all 74
   position nodes, motion for 115 of 187 transitions, and all 54 submissions staged to a tap or a loss of
   consciousness. Grips are solved against the partner's actual body to within 3 cm across size mismatches
   (commit `7f1a94b`).
4. **Mode changes** (standing, down, getting up, engaged) crossfade from the last pose with foot-preserving blends
   (`anim/blend.ts`).

**Motion capture.** There are 99 clips retargeted from ACCAD (CC BY 3.0) and CMU (commit `c6b858b`, `docs/ASSETS.md`).
36 of the 54 techniques, slips and blocks, the idle rhythm and step dynamics come from capture (commit `3b0eccc`).
Retargeting is by effector, not bone playback. Each sample is forward-kinematised on the fighter's own skeleton and
reduced to the quantities the procedural layers already use. Contact frames are then mapped onto the recorded
strike instant, with a contact error of 0.1–1.4 cm. The animator stays procedural until the motion library has
loaded, then crossfades onto the capture. Knees, elbows, spinning techniques, switch kicks, feints, level changes
and falls are still procedural (`PHASE8_NOTES.md`, "Standing animation").

**The post-fight ceremony and corners** (`finish/`, `corner/`, commit `b9525ab`): the wave-off, the loser down
and attended, the winner's celebration, and the centre announcement with the referee raising the winner's hand.
Between rounds, cornermen bring stools.

**Measured quality.** The automated audit (`scripts/dev/anim-audit.ts`) replays recorded bouts through the
presenter's own chain at 60 fps (137–140 k frames).

| Metric | Start of pass 1 | After pass 3 | Source |
|---|---|---|---|
| Unexplained one-frame pops per fighter-minute | 335 | 26 | commits `f04dea9`, `9a0adf1`, `de1507f` |
| Standing planted-foot slide > 0.5 cm per frame | 9.32 % | 1.13 % | PHASE8_NOTES, passes 1–3 |
| Standing slide p99 | 6.62 cm | 0.56 cm | same |
| Strikes > 5 cm off target at contact | 18.4 % (pass 2 start) | 1.31 % (4 of 305) | same |
| Elbow over-flexion (% of fighter-frames) | 4.32 % | 0.17 % | same |
| Get-up floor penetration | 37.8 % | 0 | commit `f04dea9` |
| `animator.evaluate`, 2 fighters, p95 | 0.50 ms (pass 3 start) | 0.36 ms | commit `de1507f` |

## 8. IK and procedural correction

- **Two-bone IK** (`rig/ik.ts`) with anatomical hinge axes. It reports the range shortfall and has an optional
  flexion limit. The canonical skeleton is 52 bones, generated from MPFB2's Mixamo-compatible rig, with
  identity-rest conventions. FK was verified to 1.7e-8 m (commit `cbcec1f`).
- **Planted-foot IK** with a pelvis clamp that counts stepping feet. A reach assist moves the pelvis only by the
  geometric shortfall beyond full reach, capped with a softplus. At close range the hips give ground by up to
  12 cm (pass 3).
- **Contact re-aim.** A final pass re-aims fists and shins on the finished poses, after the defender's own
  corrections, and latches the aim through the contact frame (pass 2).
- **Floor fix** on grapple and fall poses. Hinge-aware knee handling. A soft elbow-fold limit with a shoulder shrug.
  Damped torso separation for firm-capsule overlap. Head-to-head clearance for the striker.
- **Speed-planned steps** (pass 3). Stride grows with speed and is capped at 46 cm per foot, scaled by guard style
  and tier. The hips lead and the trailing heel pushes off.
- **Clinch stoppages** walk the pair apart to 1.35 m during the post-roll.
- Tried and backed out, with reasons, in each pass's notes: a 150° elbow limit in standing IK, knee-pole rules,
  rigid grip re-attachment and others.

## 9. Rendering

**Backend.** `WebGPURenderer` from three r186 (upgraded from 0.169 in commit `cbcec1f`). On WebGPU it uses the
GPU directly; three falls back to WebGL2 by itself. The Watch "View" label reports which backend ran. With no GPU,
or after a 3D failure, Watch shows the 2D board. A device or context loss rebuilds the presenter once, and a
second loss falls back to 2D (`WATCH_REPLAY_PASS.md`, review fix M5).

**Post chain** (TSL, `stage/pipeline.ts`; `PHASE8_NOTES.md` "Stage"): scene pass with MRT (colour, packed normal,
velocity) → GTAO at internal resolution → AO composite → TAAU (TRAA at native on Ultra; FXAA on Low) → replay-only
depth of field and motion blur. The live handheld cameras use a half-resolution lens DoF (`stage/lensDof.ts`).
Then bloom → ACES and sRGB → a procedural 32³ broadcast LUT → RCAS sharpen folded into the final quad with the
vignette and deterministic grain. The live and replay pipelines share everything up to the temporal resolve, so
an instant replay needs no shader rebuild. Cuts and seeks re-seed the temporal history.

**Quality profiles** (`stage/profiles.ts`): LOW, MEDIUM, HIGH, ULTRA. `recommendQuality()` combines adapter facts with
a ~0.2 s GPU probe:
- ≤ 1.3× the reference time → High;
- ≤ 2.6× → Medium;
- otherwise Low;
- software rasterisers → Low;
- WebGL2 is capped at Medium;
- Ultra is never chosen automatically.

Watch starts on a URL override (development only), else the viewer's saved explicit choice, else the
recommendation, with Medium until the probe returns (commit `4e9f4c4`). Measured cost per profile is in §15.

**Dynamic resolution.** On WebGPU, GPU-timed (`GpuDynamicResolution`): every 4th frame's timestamp drives the
internal scale toward a **15 ms** budget within the preset's range (High 0.6–0.8). It uses a dead band, 0.05 steps,
at most one change per 0.6 s and a per-shot memory applied on cuts, and it can raise the scale when there is
headroom. WebGL2 keeps the older frame-interval controller (`PHASE8_NOTES.md`, "Performance pass").

**Shader compile management.** Programs are shared across bodies through stable uniform-buffer names and a
canonical order for helper functions (`stage/programSharing.ts`). The warm-up compiles exactly the variants that
will be drawn, in four parallel lanes. All async GPU jobs (probe, warm-up) run on one serial queue, and the page's
frames are held while a warm-up runs. That queue is the fix for QA2 #1, the WebGPU view hanging after a rebuild.
WebGL2 uses a lighter skin variant, which saves compile time, not frame time.

**Look.** One shadowed 5600 K key spot 15.6 m above the canvas, image-based fill from a procedural environment,
anti-aliased procedural chain-link, haze and beams, and a seeded crowd that reacts to recorded events. Sweat and
blood marks are baked deterministically from the recording, and blood only appears when the Blood setting is on
(commits `7f1a94b`, `fe1d335`, `91abcaa`). Sponsor marks are fictional.

## 10. Camera system

**Director** (`camera/director.ts`, `planner.ts`, `shots.ts`). With the whole recording available, the planner
lays out a broadcast edit ahead of time. The shots are MAIN, MAIN TIGHT, CAGESIDE, CAGESIDE LOW, OVERHEAD,
REVERSE, the wide jib, CORNER between rounds and FINISH handhelds.

**Cut rules:**
- a 4 s minimum shot, with a planned median of 9.7 s;
- no cut within ±6 ticks of any strike (the knockdown exception, `kdStrikeLookbackTicks`, is counted apart);
- the line of action is kept;
- MAIN ↔ MAIN TIGHT is a 1.1 s zoom by one operator, not a cut.

**Operators** (`PHASE8_NOTES.md`, "Camera polish pass"):
- *Predictive framing.* Each fighter's framing points are shifted toward a centred average of his recorded future
  position around `now + lead`, capped at 1.6 m. The lens arrives with the action instead of behind it.
- *Dead zones* on aim and zoom, so limb motion does not steer the lens.
- *Continuous safety widening* instead of snaps.
- In a 2v2, focus on the engaged pair.

**Occlusion** (`camera/occlusion.ts`). The referee, cornermen, posts and top rail are occluders. Operators dodge
by walking their own stretch of apron, lifting, or crossing to the other side. The planner re-places a
handheld that stays blocked for 1.2 s. The corner camera avoids the crew with a 5 % hidden threshold
(performance pass 2).

**Replays** (`camera/replay.ts`, `replay/broadcast.ts`). The instant-replay planner airs multi-angle slow-motion
replays after knockdowns and other moments. `R` replays the last 8 s, choosing the most important moment in that
window: knockdown > stoppage > slam > rocked > takedown > hardest landed shot. It plays a slow cageside angle and
then a wider second angle.

**Overrides.** Keys 1–9: 1 is the director; 2–7 pin one operator (main, tight, cageside, low, overhead, reverse);
8 follows a fighter (press again to switch); 9 is a free orbit. Handing an override back cuts cleanly to the
planned shot.

**Measured** over 64,915 audited frames of 8 bouts (camera polish pass):

| Metric | Before | After |
|---|---|---|
| Clipping frames | 156 | 0 |
| Aim jerk p95 (screens/s³) | 3.75 | 2.13 |
| Pan reversals per minute | 5.9 | 2.5 |
| Replay camera max speed (screens/s) | 11.3 | 0.64 |
| Frames > 30 % hidden | 0.38 % | 0.18 % |
| Cuts within ±6 ticks of a strike | 0 | 0 |

## 11. Replays

**The sim's format.** `ReplayFileV4` (`src/sim/record/replay.ts`) stores the seed, the full setup (fighters, rules,
arena, settings, parameter overrides), the engine version and the claim: digest, ticks, RNG draws, result and
event log. It is a complete replay because a bout is a pure function of that setup and seed.

**Recorded frames.** `src/sim/record/frames.ts` stores frames as a `FrameStore` of compact typed-array columns
behind a read-only `TickSnapshot[]` view. Unit-range fields are 16-bit unorm (max error 7.63e-6), and values out of
range fall back to verbatim storage. Frames transfer between worker and main thread as buffers
(commit `8ae9ad4`; round-trip verified in `REVIEW_PHASE8_9.md`).

**App container** (`src/app/replay/archive.ts`, `WATCH_REPLAY_PASS.md`). The header is the `'BLRP'` magic, container
version, flags, body length and a CRC-32 of the body. The body is gzip (`CompressionStream`) of a JSON payload plus
a binary blob. There are two profiles:
- **Portable** (downloads, `.boutreplay`): seed, setup and claim. It is re-simulated and verified when opened.
  **3.3–3.5 KB** per bout.
- **Library**: portable plus the event log, game-plan samples and the frame columns, stored losslessly (integers
  delta-coded, floats XOR-ed with the previous bits, byte-shuffled, then gzip). It opens without re-simulating,
  and the worker re-checks the digest in the background. **270–380 KB** for a full three-round bout.

The previous format, a bare v4 JSON, is still read.

**Library** (`replay/library.ts`). Stored in IndexedDB, with a `meta` store and a `blobs` store. Ids come from the
digest, so saving the same bout twice replaces it. The newest 12 entries keep their frame cache, older ones are
re-encoded as portable, and the library holds at most 300 entries. It falls back to memory without IndexedDB.

**Verification.** Opening a replay reports `verified`, `mismatch` (the digest was tampered with or differs) or
`other-engine`. Damaged files produce typed errors, never exceptions, and each case is tested: empty, not a replay,
malformed JSON, unsupported version, truncated, checksum mismatch, damage behind a recomputed checksum, missing
fields, and a frame cache that does not match the bout. History's **Verify** re-simulates and compares.

**Playback guarantees** (tested in `tests/replay.polish.test.ts`):
- Frame progression is independent of the display refresh rate (24–240 Hz).
- A single-frame step is exactly one recorded frame.
- Scrubbing, speed changes, replays and every panel run over a deep-frozen event log and never mutate the bout.
- Statistics at the playhead equal the statistics of the same bout simulated only up to that tick.

## 12. Determinism

- **One seeded RNG** per bout with the fixed draw schedule in §4. The sim contains no `Math.random`, `Date.now` or
  `performance.now` (`REVIEW_PHASE8_9.md`). Commentary uses a forked RNG, so it cannot change a bout.
- **Locale-independent ordering.** Sim tie-breaks sort with plain `<`/`>` instead of `localeCompare` (audit C2,
  fixed in `2720d60`).
- **Digest** folded every tick (§4), plus full-precision hashing in the golden harness.
- **Engine version.** `SIM_ENGINE_VERSION` in `src/sim/record/recorder.ts` is **5.0.0** at the time of writing
  (the realism pass targets 6.0.0; see "Pending"). A change that alters results must bump it and regenerate the
  golden fixture. A replay from another engine version opens as `other-engine` and is not silently replayed.
- **Golden fixture.** `tests/fixtures/sim-golden.json` holds 41 bouts covering every ruleset, every mode, extreme
  builds and bodies, match settings, and 50 and 200 ms timesteps. `tests/sim.golden.test.ts` and
  `npm run golden:check` compare the digest, ticks, draws and hashes of the result, events, stats and every frame.
  They also assert that the recorded and unrecorded runs end on the same digest. CI runs both (the `determinism`
  job in `.github/workflows/ci.yml`). The full 310-bout harness (`scripts/dev/sim-golden.ts --all`) was used for
  the performance pass (`SIM_PERF_PASS.md` §2).
- **Scope of the guarantee: identical within one JavaScript engine.** That covers worker and main thread, Node and
  Chromium (all V8). The sim uses `Math.exp`, `Math.pow`, `Math.log`, `Math.sin` and `Math.atan2`, which the
  language does not require to be bit-identical across engines. So a replay recorded in a V8 browser is not
  guaranteed to re-verify in SpiderMonkey or JavaScriptCore (`AUDIT_FINAL.md` H6, `CONTRIBUTING.md`). The RNG
  itself is pure uint32 arithmetic and is portable. **Cross-browser verification has not been tested.**

## 13. Batch simulation

**CLI runner** (`scripts/batch/run.ts`, `npm run batch`):
- 12 plans (`--list`), including `baseline`, `ufc_population`, `tier_matrix`, `identical`, `physical_sweeps`,
  `style_matrix`, `judging`, `mma_5r`, `rematch`, `multi`, `rules_arenas` and `edge_cases`.
- Bout seed = `boutSeed(seed, cellId, i)`, so a bout's seed does not depend on which worker ran it or in what order.
- Output goes to `runs/<id>/`: `manifest.json`, `results.jsonl` (one ~2 KB row per bout, no frames), `errors.jsonl`
  and `monitor.jsonl`.
- `--resume` skips completed rows. `--params` takes damage-parameter overrides (§20 explains why only damage
  parameters).

**Governor built into the runner:**
- The process lowers its own priority and pins itself to 5 of 8 cores (affinity `1F`).
- The monitor samples machine CPU and RAM every 2 s. It pauses dispatch above **88 %** and resumes below
  **80 %** (commit `07960bb`), and it never starts while RAM is already over the cap.
- The pool defaults to `--max-workers 2` on this shared machine.
- `npm run calibrate:report -- runs/<id> [--baseline runs/<prev>]` regenerates a calibration report from
  `results.jsonl` alone.

**In-app Batch screen** (`src/app/screens/BatchSim.tsx`, `UI_PASS.md` §1, §5):
- Two fighters, ruleset, arena, damage realism, referee, a master seed and 10 / 100 / 1,000 / 5,000 / custom
  (≤ 20,000) bouts.
- A **Workers** option; Auto is cores − 2, at most 4.
- Progress, rate, a smoothed ETA, cancel, per-bout error capture, worker-crash recovery and a main-thread fallback.
- Results: win % per corner with 95 % Wilson intervals, draws, finish rate, length, method mix by winner, round of
  finish and per-fighter averages, with CSV export.
- The **digest fingerprint** is identical for 1, 2 and 4 workers (`tests/ui.batch.test.ts`). Bout *i* of a batch is
  byte-identical to a Match-setup bout with seed `master::v4::batch::bout-i`.

**Resource governor for all heavy local commands** (`scripts/dev/heavy.mjs`):
- semaphore slots (default 3);
- a memory gate: start only if RAM would stay under 90 % with `HEAVY_NEED_GB` (1.6) more;
- a CPU gate: start below 70 %;
- a bounded V8 heap;
- confinement to 5 of 8 cores at below-normal priority, inherited by every child process;
- a start gate held 8 s after each start;
- a lock is reclaimed only when its owner process is dead (commits `0688ff3`, `4b72613`, `f97be32`, `7a5b42f`,
  `1ea0bd9`).

## 14. Performance optimisation

**Simulation** (`docs/design/SIM_PERF_PASS.md`). The pass was profile-driven, and every change preserves
floating-point operation order, iteration order and RNG draw order:
- lazy plan-evaluation signals, with running counts in the exchange ledger instead of window rescans (that rescan
  alone was ~22 % of CPU);
- opponent-model decay that skips never-seen contexts;
- per-family consideration factors computed once per decision, with bitmask family membership;
- per-fighter static strike filters;
- memoised fatigue index and body-mass multipliers;
- memoised sided state ids;
- tabled arena wall trigonometry;
- allocation-free nearest-opponent and team scans.

Result: 310/310 golden bouts bit-identical, and 1,000 batch rows byte-identical.

**Rendering** (`PHASE8_NOTES.md`, "Performance pass", "Performance pass 2"):
- the half-resolution lens DoF (4.0 → 0.7–1.0 ms);
- GTAO radius held to 15 % of frame height (CORNER 5.6 → 3.4 ms in A/B);
- skin shader branches for terms that are exactly zero;
- RCAS folded into the final pass;
- GPU-timed dynamic resolution;
- shared programs (331 → 148 compiles on a WebGL2 cold load; WebGPU 220 → 145 programs);
- the skin graph emitted once (−11 % to −23 % of the scene pass on close shots);
- canonical helper order;
- a lite WebGL2 skin;
- four compile lanes;
- non-blocking first draws.

**Watch screen** (`WATCH_REPLAY_PASS.md`). `BoutPlayer` is the only source of truth for the playhead. Panels
subscribe at their own rates: scrubber 20 Hz; time, fighters and graphics 10 Hz; stats, commentary and plan 4 Hz;
the event log only when the playhead crosses an event; the 2D board every frame. Bouts load in the worker with
progress instead of a 2–2.6 s main-thread freeze.

**Camera and animation.** Per-frame allocations were removed from the director's framing and occlusion. The
animator uses incremental FK, and the anim passes trimmed the costs they had added.

**Memory:** see §16.

**Bundle.** The cleanup removed 31 MB of never-loaded assets and the legacy v3 stack (commit `f54d16e`). UI pass 2
split the single 3,561 KB chunk (1,075 KB gzip) using `React.lazy`:
- The first screen loads the shell, Match setup, Fighters, Result and the sim.
- Watch, the 3D stack (three.webgpu is 1,091 KB raw), Batch, Tournaments, History, the editor and About load on
  first use, and are prefetched on nav hover.
- A test fails if the static import graph from `main.tsx` reaches three.js or those screens.

The whole sim engine still sits in the first chunk, because of side-effect registration through the sim barrel
(`UI_PASS.md`, "UI pass 2" §1, §6).

**App per-frame costs** (UI pass 2, audit H4):
- `getPlayhead` reuses one object.
- `Arena3D` no longer spreads its props every frame.
- `publishStats()` returns early in production.
- The 2D view measured 8.2–9.4 ms/s of React work at 1×–4×.
- Watch no longer re-simulates its bout on every tab switch.

## 15. Before and after performance numbers

| Area | Before | After | Source |
|---|---|---|---|
| Sim, 3R 1v1 (bouts/s, single thread) | 0.90 | **2.37 (2.7×)** | SIM_PERF_PASS §1 |
| Sim, 5R 1v1 | 0.70 | **1.83 (2.6×)** | same |
| Sim, 1v5 gauntlet | 2.81 | **6.60 (2.3×)** | same |
| Sim ms per tick (3R) | 0.171 | 0.064 | same |
| Allocated per tick (3R) | 76.1 KB | 52.0 KB | same |
| 1,000-bout CLI batch (2 workers) | 756.4 s (79 bouts/min) | **293.6 s** (205 bouts/min) | same |
| Watch React work at 4× | 82.8 ms/s | **19.8 ms/s** (8.3 % → 2 % of main thread) | WATCH_REPLAY_PASS |
| Watch React work at 1×, per sim tick | 2.30 ms | 1.52 ms | same |
| Replay size, 3-round bout | v4 JSON 25.5–227.7 KB | **portable 3.3–3.5 KB**; library with frames 270–380 KB | same |
| Recorded frames, 1v1 5R, heap | +45.8 MB | **+4.9 MB** | commit `8ae9ad4` (QA-8 had measured +56 MB at an earlier HEAD) |
| Production `dist/` | 53.3 MB | **18.4 MB** (`static/` 47.5 → 16.5 MB) | commit `f54d16e` |
| JS before the first screen | 3,480 KB raw / 1,048 KB gzip | **1,352 KB / 375 KB** | UI_PASS "UI pass 2" §1 |
| First screen ready / TTI, desktop (slow network + 4× CPU) | 458 ms (2,009 ms) | **302 ms** (1,513 ms) | same (median of 5, production build) |
| Watch 2D view, React work | ~130 ms/s (estimate, not measured) | 8.2 ms/s at 1×, 9.4 at 4× | UI_PASS "UI pass 2" §4 |
| WebGL2 cold load, time to live | 187 s (97 s in an earlier polish pass) | 31–43 s (pass 1) → **9.7–16.0 s** (pass 2, busy machine) | PHASE8_NOTES perf passes |
| WebGL2 cold load, longest main-thread task | 31.0 s | **1.6–1.9 s** | same |
| WebGL2 shaders compiled on a cold load | 331 | 148 | same |
| WebGPU fresh profile, time to live | not measured | 17.8–20.7 s, longest task 0.53–0.84 s | same |
| WebGPU CAGESIDE shot, High (baseline dynres) | 19.9 ms | p25 14.5 ms (GPU-timed dynres, busy GPU); 9.5–11.7 ms quiet | same |
| QA2 WebGPU rebuild (3D → 2D → 3D) | never recovered, 22–23 errors per cycle | recovers in 9–10 s, 0 errors | PHASE8_NOTES perf pass 2 |
| Quality switching, 12 switches | WebGPU 93 errors | 0 errors; longest task 0.93 s (WebGL2 still 15.3 s) | same |
| Watch bout-switch leak (WebGL2 heap, forced GC) | 42 → 182 MB over 14 switches | 39.6 → 49.4 MB over 20; renderer counts flat per venue | PHASE8_NOTES "Leak fix" (uncommitted) |
| Camera `director.update` | 0.0179 ms mean, 0.058 p99 | 0.0166 ms, 0.055 p99; GC 43 → 14 collections per 54 k updates | camera polish pass |
| `animator.evaluate`, 2 fighters | p95 0.50 ms | p95 0.36 ms (mean ~0.17–0.24 ms) | anim passes 1–3 |

**GPU ms per quality profile** (fixed scale, busy GPU, p25; MAIN / CAGESIDE; `PHASE8_NOTES.md` "Performance pass"):
Low **4.3 / 7.9**, Medium **7.4 / 11.5**, High **12.4 / 15.1**, Ultra **22.1 / 28.0**. Ultra renders at native
2080×1170 there and is meant for a discrete GPU. At 3840×2160, Ultra measured 160 ms per frame with the real
modules on this iGPU (Stage section).

**Multi-fighter frame rate** (QA2 #11, not re-measured since): 1v1 50–60 fps; 2v2 24; 3v3 44; ffa4 and crowd4 35.

## 16. Memory findings

- **FrameStore** (QA-8 → commit `8ae9ad4`). Recorded frames used to be plain snapshot objects: a 1v1 5R recording
  added ~46–56 MB of heap, and a 1v5 5R recording 163 MB. The worker then structured-cloned them to the main
  thread. The typed-array columns cut the 1v1 5R case to +4.9 MB and transfer as buffers. Two latent hazards
  were noted: `push` after `view()` throws, and `pack()` transfers the live buffers (`REVIEW_PHASE8_9.md` L1, L2).
  Current callers do not hit either.
- **Sim heap.** A bout's live state is ~7 MB after a forced GC. Peak `heapUsed` between bouts dropped from 61–64 MB
  to 49–55 MB. Process peak RSS is 163–182 MB. A module-level scratch `Map` was tried and reverted, because it
  tripled old-generation promotion (`SIM_PERF_PASS.md` §1, §3).
- **Leaks found and fixed:**
  - the old venue left in the scene on a bout switch (review H3, `075d641`);
  - arena textures behind TSL nodes never disposed (M2a);
  - a new character factory per bout (M2b);
  - post nodes leaked on every quality or scale change (M2c; uniform buffers 953 → 920 over ten switches instead
    of → 2,360);
  - MRT nodes per rebuild;
  - the per-frame `Set` in `snapshotPreviousBones`.
- **The Watch bout-switch leak** (QA2 #3; `PHASE8_NOTES.md` "Leak fix", uncommitted at the time of writing).
  Five retainers held old bouts alive:
  1. three r186's render-object set for shared materials (fixed by `releaseFromRenderer`);
  2. warm-ups that outlived their bout;
  3. undisposed PMREM generators;
  4. lights kept in never-pruned bind-group caches (fixed with per-role light free lists);
  5. a closure in the mouthguard material.

  Renderer and object counts now repeat exactly per venue visit on both backends. **Still open:** a heap drift of
  about 0.4 MB per switch with identical object counts (undiagnosed). A warm-up also cannot yet be cancelled when
  the bout changes.
- **Batch memory:**
  - CLI: the pool budgets 200 MB per worker, and rows carry no frames.
  - In-app, 5,000 bouts on 2 workers: page heap 47 MB at start, 68 MB peak, machine RAM peak 88 %
    (`UI_PASS.md` §5).
  - QA2 on 4 workers: peak heap 14–17.5 MB for 100–5,000 bouts, 0 long tasks, and 0 workers left after cancel
    or reload (`QA2_FINDINGS.md`).
- **History** still keeps full v4 JSON replays (160–230 KB each) in localStorage, which is capped near 5 MB
  (`WATCH_REPLAY_PASS.md`, "Still weak").

## 17. File structure

```
src/
  main.tsx                 app entry
  sim/                     deterministic simulation (no DOM, no React)
    core/                  tick loop (loop.ts), binding (bind.ts), scheduler, world, invariants, config
    fighter/               schema, derive.ts, tiers, archetypes, legacy importer
    striking/ grappling/ submissions/ damage/ rules/ ai/   one design chapter each
    params/                parameter registry (unit + provenance on every tunable)
    rng/                   sfc32 RNG, FNV-1a digest
    record/                recorder (SIM_ENGINE_VERSION), replay v4, frames (FrameStore), stats, events
    commentary/            post-hoc commentary on a forked RNG
    index.ts               public API
  presentation/            three.js broadcast viewer
    presenter.ts contract.ts devFlags.ts
    stage/                 renderer, post pipeline, profiles, dynres, lens DoF, program sharing
    character/ arena/ referee/ corner/ finish/ people/
    anim/ (grapple/) rig/  animator, mocap, grapple solver, skeleton, IK
    camera/                director, planner, shots, framing, occlusion, replay, free camera
    assets/ placeholders/  manifest, motion library, fallbacks
  app/
    App.tsx theme.css base.css *.css devFlags.ts storeApi.ts
    screens/               About, BatchSim, BoutResult, FighterCreator, FighterDatabase, History,
                           MatchSetup, Tournaments, Watch
    components/            Arena3D, HUD, watch/* (transport, scrubber, library dialog, …)
    ui/                    design-system components
    model/ store/ replay/ run/ workers/
static/assets/             runtime files the 3D view fetches: body/, motion/, textures/, fonts/
dev/                       lookdev pages (stage, anim, grapple, character, arena, camera, assets)
scripts/
  batch/                   CLI batch runner (run.ts, pool, monitor, plans, summarize)
  calibrate/               metrics, checks, report.ts
  assets/                  body, rig, mocap and skin-map builders
  dev/                     heavy.mjs, golden harness, benches, audits, QA and capture scripts
  inline.mjs               lite single-file page
tests/                     vitest suites (sim, presentation, replay, UI, QA, golden) + fixtures/
docs/                      DESIGN.md, design/ chapters and pass notes, CALIBRATION.md, ASSETS.md, PROGRESS.md
research/                  literature review, bibliography, discipline research
runs/                      batch run directories (results.jsonl, manifest.json)
```

## 18. Important configuration files

| File | What it controls |
|---|---|
| `package.json` | scripts (`dev`, `build`, `build:single`, `preview`, `test`, `batch`, `calibrate:report`, `golden:check`); Node ≥ 20.19; runtime deps are React, React DOM and three only |
| `tsconfig.json` | strict TypeScript |
| `vite.config.ts` | `publicDir: 'static'` (served at `/assets/*`), ES2022 target, code splitting (single chunk in `--mode single`), vitest environment |
| `.github/workflows/ci.yml` | jobs: typecheck + tests; determinism (golden test + `golden:check`); build + lite standalone page artifact |
| `src/sim/record/recorder.ts` | `SIM_ENGINE_VERSION` |
| `tests/fixtures/sim-golden.json` | the golden corpus (regenerate with `npx tsx scripts/dev/sim-golden.ts --write tests/fixtures/sim-golden.json`) |
| `src/sim/params/*` | the parameter registry |
| `src/sim/core/policy.ts`, `striking/resolve.ts`, `grappling/resolve.ts` | the RNG draw schedule constants |
| `src/presentation/stage/profiles.ts`, `stage/quality.ts` | quality profiles and the recommendation rule |
| `src/presentation/assets/manifest.ts` | the exact list of shipped textures (a test fails on any unlisted file) |
| `src/presentation/devFlags.ts` | the gate for debug URL switches and `window.__*` globals |
| `src/app/theme.css` | design tokens (the stable UI contract) |
| `scripts/batch/plans.ts` | batch plans and cells |
| `scripts/dev/heavy.mjs` | governor env vars: `HEAVY_SLOTS`, `HEAVY_NEED_GB`, `HEAVY_HEAP_MB`, `HEAVY_CAP`, `HEAVY_CPU_START`, `HEAVY_AFFINITY` |
| `docs/ASSETS.md` | licence list; an unlisted asset must not be in the repository |

## 19. How to create a fighter

1. **Fighters** → **New fighter** (blank), **Random fighter** (seeded and plausible), or open one of the 15
   built-in archetypes and save it as your own copy. Presets are read-only.
2. The **Fighter editor** opens on the profile view: Physical, Athletic, Technical, Style & game plan, Mental and
   Experience. **Basic** shows the main controls. **Advanced** shows everything, including controls badged "No
   effect on the bout". Search finds an attribute in either mode.
3. **Technical** composites (Striking, Boxing, Kicking, Wrestling, Grappling, Clinch, Defence, Timing, Footwork,
   Distance management, Positional awareness) are views over sub-skills. Moving one shifts each of its sub-skills
   by the same amount across the arts the fighter has trained. A composite over arts the fighter never trained is
   disabled, with the reason shown.
4. Watch the live derived panel (tiers, derived composites). Compare against any other fighter if useful.
5. **Save** (or **Save as copy**). The name is capped at 60 characters. Undo and redo cover the whole session.
6. **Full schema** exposes every raw field of `FighterDefinition` (nine sections), including per-art career data
   and injuries.

## 20. How to modify attributes

**Groups** (`src/app/model/profileModel.ts`; every profile control writes a real `FighterDefinition` path):
- Physical: weight, height, reach, leg reach, age, stance, mobility.
- Athletic: strength, explosiveness, endurance, recovery, chin, body toughness, neck strength, hand and kick speed,
  reaction.
- Technical: the composites listed in §19.
- Style: preferred range, pace & aggression, pressure, takedown setup, clinch & cage tendency, defensive tendency
  when hurt, guard style, refuses to tap.
- Mental: fight IQ, composure, discipline, adaptability.
- Experience: overall experience, rounds fought, opposition level, KO losses, layoff, pro wins.

`tests/ui.params-effect.test.ts` runs paired, seeded batches for every live control and asserts a measurable change.
Examples (engine 5.0.0, `UI_PASS.md` §3):
- Weight 62 → 100 kg: damage dealt +44 %.
- Explosiveness 10 → 95: strike force +34.8 %.
- Endurance 5 → 95: strikes attempted per minute +62.6 %.
- Chin 5 → 95: head damage taken −36.1 %.
- Wrestling 20 → 90: takedown attempts +76.5 %.

The weakest live control is **adaptability**: 13 % of full bouts changed.

**Settings with no effect on a bout** (engine 5.0.0; `UI_PASS.md` §4). Each is badged in the editor, and a test
fails the day the sim starts reading one:
- Handedness.
- Balance.
- Grip strength (read only by hand and elbow injuries).
- Initiative (only a stand-in for Pressure when Pressure is unset).
- Game plan (primary mode) and Plan B (fallback mode). These are labels only; the AI generates its plan.
- Risk when behind: only "Unchanged" is read.
- Heart: no measurable effect in full bouts.
- In Full schema: somatotype, the numeric stance-switching tendency, tired behaviour, Thai style, top and bottom
  priority, per-round pacing and notes.
- Appearance is cosmetic by design.

The editor shows coordination, acceleration, agility, fatigue resistance and movement style as information only,
because the model does not represent them separately. **Caveat:** the pending realism pass touches plan
generation (`authoredMode` in `ai/plan.ts`), so this list may change once it lands; `REALISM_PASS.md` is still a draft.

**Parameters, not attributes.** Only chapter 05 (damage) and parts of 01, 03 and 06 read `src/sim/params` at run
time. The striking, submission and AI registry entries are mirrors that no code reads, so batch `--params`
overrides move damage parameters only (`PHASE9_TUNING.md`, "Registry caveat").

## 21. How to run a simulation

**Match setup** runs in four steps (UI pass 2). A first visit opens on a bout that is ready to run: Counter
Striker vs Olympic Judoka.
1. **Fighters.** Choose the format with a segmented control:
   - 1v1;
   - teams: 2v2, 1v2, 1v3, 1v5, 3v3;
   - free-for-all: 2–6 fighters;
   - crowd: 1 vs 2–8.

   Then pick the fighters. "Swap corners" moves the home crowd along with the fighter.
2. **Rules.** One of the **14 rulesets** and one of the **9 arenas**. A non-standard pairing shows a warning with
   the reason; it is not blocked.
3. **Options.**
   - Damage realism.
   - Playback speed; Watch opens at it.
   - Commentary.
   - **Blood**, which is presentation only.
   - Two collapsed sections, *Round timing and weigh-in* and *Referee, judges and crowd*, each noting how many
     values differ from the defaults.
4. **Run.** A summary, the size and level warnings, and the **seed** with **New seed** and **Copy**. The same setup
   and seed always give the same bout.

Validation is inline, and the step headers show their status. **Run bout**, in the page header or at the end of
the steps, runs the bout in the bout worker, and **Cancel** is in the progress strip. The result goes to **Result**
and **History**. **Watch the fight** (on Result), or Watch from the nav, plays the latest bout.

**Tournaments** also runs in four steps: Format → Entrants → Rules → Create.
- Single elimination (4/8/16/32), double elimination (8/16) or round-robin (up to 8).
- Seeding by rating, manual or random.
- Carry-over of none, same night or career.
- A draw is re-run on deterministic rematch seeds, with a tie-break after three indecisive runs.

## 22. Batch simulations

- **In the app:** see §13. Pick the matchup, count and workers, then run. Read the win rates with their 95 %
  intervals, not the point estimates. Export CSV. The fingerprint identifies the result exactly.
- **CLI:** `npm run batch -- --plan <ids> --seed <s> --out runs/<id> [--n N | plan=N,…] [--max-workers 2]
  [--resume] [--params file.json] [--filter cell=LW]`. Then run
  `npm run calibrate:report -- runs/<id> [--out file] [--baseline runs/<prev>]`. On Windows, `npm run` drops quoted
  arguments, so call `npx tsx scripts/calibrate/report.ts …` directly when you need `--label "…"`
  (`docs/CALIBRATION.md`, "How to run calibration").
- For a model change, run the same plan and seed before and after (common random numbers) and report the Δ column
  (`CONTRIBUTING.md`).

## 23. Watching replays

- **Watch** opens the last bout, a History entry (**Re-watch**), a library entry, or an imported `.boutreplay` or
  v4 `.json` file (**Library** dialog). With no bout, it offers the demonstration bout.
- Controls and shortcuts: see README, or press `?`.
- The scrubber shows round boundaries and a lane of clickable markers (finish, knockdown, submission attempt,
  takedown, slam, big strike, round end). A marker jumps to 1.5 s before its moment, and markers closer than about
  12 px stack into rows.
- **Analytics** (`A`) has Stats, Cards, Commentary, Events, Plan and Debug, all at the playhead. Scorecards show
  only the rounds already scored.
- **View settings:** 3D or 2D, quality, render scale, debug.
- **Save** puts the bout in the IndexedDB library. The download button writes a portable `.boutreplay` (~3.4 KB).
  A verification badge shows `verified`, `mismatch` or `other-engine`.

## 24. Export and import configurations

| What | Where | Format |
|---|---|---|
| One fighter / the fighters shown | Fighters → row export / **Export shown** | BOUT LAB JSON, schema version 1 |
| Fighters in | Fighters → **Import** | a preview lists Will import / Will import as `<new id>` / Rejected (field-level reasons) before anything is written. Id collisions are renamed. Over-long names are shortened with a warning. Prototype-named keys are safe. |
| A bout (setup + seed + claim) | Watch → download | `.boutreplay` (portable archive) |
| A bout in | Watch → Library → import | `.boutreplay` or a v4 `.json` replay; verified on open |
| A history entry | History → **Export** | v4 replay JSON |
| Batch results | Batch → **Export CSV** | CSV |
| Batch parameter overrides (CLI) | `--params overrides.json` | `ParamOverrides` JSON (damage parameters take effect, §20) |

Limitation: `importJson` in `App.tsx` creates fighters only. Presets, tournaments and history in an imported file
are dropped (`REVIEW_PHASE8_9.md` L9; whether this was fixed was not verified).

## 25. Tests

- `npm test` runs every vitest suite (50 test files at the time of writing; counts go in the final quality gate).
  Every test is seeded, so a failure always reproduces.
- **Load-bearing suites:**
  - `sim.golden.test.ts`: the golden corpus.
  - `sim.core.test.ts`: the engagement invariants I1–I8 swept per tick across modes.
  - `runBout.worker.test.ts`: a fake Worker checks that the run message is posted.
  - `phase9.bugs.test.ts`: pins for the Phase 9 bugs B1–B27.
  - `qa.edgecases.test.ts`.
  - `replay.polish.test.ts`: 31 replay guarantees.
  - `ui.batch.test.ts`: worker-count invariance.
  - `ui.params-effect.test.ts`: every live control changes the bout, and every "no effect" control does not.
  - `presentation.*`: anim quality, camera quality, perf, leak, stage, grapple and others.
- `npm run golden:check` runs the corpus through the CLI and also asserts that recorded and unrecorded runs agree.
- `npx tsc --noEmit` is the typecheck. `npm run build` runs it first.
- CI (`.github/workflows/ci.yml`) runs typecheck and tests, determinism, and the build with the lite page artifact
  on Node 22.
- Browser-level QA is scripted in `scripts/dev/qa2-*.mjs`, `leak-switch.mjs` and the capture scripts. These are
  run manually through the governor, not in CI.

## 26. Production build

- `npm run build`: `tsc --noEmit`, then `vite build` to `dist/`. Serve `dist/` with any static server, or use
  `npm run preview` (port 4173). The 3D view needs `/assets/*` served next to the page.
- `npm run build:single`: a single-chunk build plus `scripts/inline.mjs`, which writes `dist/standalone.html`.
  That lite page runs the creator, sim, main-thread batches and the 2D view offline, but not the 3D broadcast or
  the workers.
- In a production build, debug URL switches and `window.__*` globals are off unless the URL has `?capture=1`.
- Size: `dist/` was 18.4 MB after the cleanup (commit `f54d16e`). The body asset `body.bin` alone is ~6 MB. The
  total `dist/` size after UI pass 2 was not measured; its chunk sizes are in `UI_PASS.md`, "UI pass 2" §1. The
  first screen downloads 375 KB of gzipped JS.

## 27. Troubleshooting

**The 3D view says WebGPU is unavailable, or shows the 2D board.**
- The browser or GPU has no WebGPU, so three falls back to WebGL2 by itself. Watch's View label shows the backend.
- If WebGL2 also fails, or 3D throws during setup, Watch shows the 2D board with the reason.
- Check the browser's GPU status page (`chrome://gpu`) and update the GPU driver.
- To test the WebGL2 path, run from the dev server with `?backend=webgl2`; in production that needs `?capture=1`.

**The first 3D load takes a long time ("Preparing broadcast… Compiling shaders").**
- Shaders compile the first time a browser profile sees them. On the Arc 140V, measured on a busy machine:
  - WebGPU, fresh profile: ~18–21 s to live.
  - WebGL2, cold driver cache: 9.7–16 s after performance pass 2 (31–43 s before it).
- The page stays responsive; the longest main-thread task is under 2 s.
- Later loads use the shader caches and are faster.
- The first switch to a new quality preset compiles again, and the last frame stays on screen meanwhile. On
  WebGL2, a switch to Ultra can still block for ~15 s. WebGL2 is capped at Medium by default for that reason.

**The dev server shows errors that look like rendering bugs.**
- With several people or agents editing, Vite has served stale modules. For example, `corner/index.ts` was once
  served stale for ~30 minutes ("displayed is not defined").
- Mid-test HMR reloads and one-off 500s from failed transforms also happened.
- Fix: hard-reload, touch the file, or restart Vite.
- Confirm a rendering bug on a production build (`npm run build && npm run preview`) before reporting it
  (`QA2_FINDINGS.md`, `PHASE8_NOTES.md` perf pass 2).

**A heavy command sits waiting under `heavy.mjs`.**
- The governor waits for a free slot, enough free memory (RAM must stay under 90 % after the job's
  `HEAVY_NEED_GB`) and CPU below 70 %. That is by design: the machine rule is ≤ 93 % CPU and RAM.
- Close other load, or wait.
- Locks live in `<tmpdir>/boutlab-heavy-locks`. A lock whose owner process is dead is reclaimed automatically.
- The environment variables in §18 adjust the gates.

**A CLI batch pauses.** The monitor paused dispatch because machine CPU or RAM went above 88 %. It resumes below
80 %. `monitor.jsonl` records the samples.

**A replay opens as `other-engine` or `mismatch`.**
- `other-engine`: the replay was recorded under a different `SIM_ENGINE_VERSION`.
- `mismatch`: the digest differs. This can also happen when the replay was recorded in a browser with a different
  JavaScript engine (§12).

## 28. Known limitations

The calibration below is for engine 5.0.0, which is what `main` ships. The realism pass (branch `realism-6.0`)
changes these numbers and is not yet recalibrated (see the note at the top of this report).

**Calibration (engine 5.0.0; `docs/CALIBRATION.md`, `PHASE9_TUNING.md` §4–§5):**
- The master table passes **23 of 125** applicable rows (22 WIDE, 80 FAIL). Core rows pass 23/99, class rows 0/22
  and proxy rows 0/4. The baseline was 1 PASS.
- Strategy checks pass 0/8. Tier checks pass 0/8. Edge-case QA passes 12/21.
- The per-class rows fail largely on sample size: ~120 bouts per class against the 2,000 the plan intends, which
  would take about a day on this machine.
- **Tier populations.** Regional T3×T3 bouts finish 40 % of the time against a 69 % target. Better-rated fighters
  win only 51 % at a 0.5–1 SD gap. This needs a model decision, not tuning.
- **Finishes.** Knockdown → KO/TKO conversion is 51 % (target 65 %). Hooks end too few fights, because there is no
  rotational-acceleration KO term.
- **Knockdowns** still rise with weight class.
- **Leg strikes.** There are none in the clinch or on the ground.
- **Grappling.** Takedown rate by class runs the wrong way. There are no choke unconsciousness outcomes. Back
  control with a body triangle is near-permanent.
- **Reach.** The longer fighter does not use his range. Trailing fighters do not take more risk late.
- **Street crowds.** An all-T0 street crowd never produces a KO.
- **The parameter registry** is only live for damage and parts of other chapters (§20).

**Animation** (`PHASE8_NOTES.md`, the "Still wrong" sections of anim passes 1–3):
- Standing pops remain: ~1,367 rotation and 87 translation over the audit. Grapple-solver pops remain (641 engaged).
- Worst standing slides of 18–27 cm per frame, from the rear round kick's hand-back.
- Firm-body interpenetration in 1.3 % of engaged frames (throws, sprawls).
- 4 of 305 contacts > 5 cm off target.
- The rear-naked-choke defender's elbow is over-flexed.
- Knees, elbows, spinning techniques, feints and falls are procedural. A KO always falls backward.
- The captured celebration is a karate lunge.
- The ACCAD performer's style shows on crosses and teeps.

**Camera** (camera polish pass, "Still weak"):
- The follow camera still hunts (20 reversals per minute).
- REVERSE is hidden by the referee 4 % of the time.
- CAGESIDE LOW can lose ground work behind a crouched referee for 1–2 s.
- At the opening bell the referee often blocks MAIN.
- Replays frame the pair, not the landing punch.

**Rendering and look:**
- Close shots at a fixed 0.7 scale exceed 16 ms on a busy GPU. The dynamic-resolution floor is what holds
  the budget.
- GTAO costs as much as the scene pass on handheld shots.
- On WebGL2, a switch to Ultra has a ~15 s long task.
- Two skin programs remain on WebGL2.
- The crowd is low-poly up close.
- The truss fixtures are emissive discs, and the LED boards are static pages.
- Fight marks are flat stamps.
- Referee and cornermen clothes have no cloth dynamics.
- Cornermen appear at the post; there is no cage door.
- The fence writes no depth.
- Multi-fighter bouts run at 24–44 fps.
- In some headless runs, three's `createRenderPipelineAsync` logs depth-stencil format errors (43 per load). The
  same thing happens in the build from before UI pass 2. It has not been triaged (`UI_PASS.md`, "UI pass 2" §6).

**UI** (`UI_PASS.md`, "UI pass 2" §6):
- The whole sim engine loads with the first screen.
- Batch setup has not been converted to the step pattern.
- The tournament bracket has no connector lines.
- The Watch analytics tab bar is cramped at 400 px.

**Load times.** Cold 3D loads take ~10–21 s on this machine (§27). A returning viewer is faster.

**Memory.** A residual heap drift of ~0.4 MB per bout switch. Warm-ups cannot be cancelled. History stores fat v4
JSON in localStorage.

**Determinism scope.** Guaranteed within one JavaScript engine only. Cross-browser-family verification is neither
guaranteed nor tested (§12).

**QA leftovers:**
- The fighter bar's significant-strike attempts could differ from the Stats tab by 1–2 (QA2 #6). The realism
  pass works on this (`abandonContact` in `loop.ts`) but had not landed.
- QA-9 (a submission in a multi-fighter bout ends the whole bout) is still an `it.todo`.
- `ai/multi.ts` target selection is not wired in.

**Tooling.** Several suites were measured while other agents were editing the tree. The final quality gate at the
top of this report is the authoritative state.

## 29. Future improvements (ranked)

1. **Finish and merge the realism pass (branch `realism-6.0`).** It already fixes the dead code behind most
   calibration misses (grappling skills never applied, tactical layer unused at contact, feints, counter boost,
   one-tick movement, scorecard belief, plan labels, rotational KO term) and makes the eight "no effect" settings
   work. Remaining: retune takedown accuracy, knockdown rate, outcome mix and KD-to-finish back into tolerance,
   recover the ~25–30 % per-tick cost, re-pick the four content-dependent UI/presentation test seeds, then run the
   full per-class sample (~2,000 bouts per class) and merge as engine 6.0.0.
2. **Remaining model decisions** after that: defence-skill-by-tier term and within-tier spread, clinch and ground
   leg strikes, an unconscious outcome for chokes, judo-based styles losing too often.
3. **Wire the registry mirrors** for striking, submissions and AI, so `--params` tuning reaches them without code
   changes.
4. **Cross-engine determinism.** Use a deterministic math library for the few transcendental functions in the sim,
   then test replays across Chromium, Firefox and Safari.
5. **Rendering cost.** Cheaper GTAO on handheld shots; a veil material for defocused fence panels; warm-up
   cancellation on bout switch; removing the WebGL2 Ultra-switch long task; multi-fighter frame rate.
6. **History on the replay library.** Store the portable profile, about 50× smaller than today.
7. **Animation.** Grapple-solver pops and interpenetration; more capture for knees, elbows, spins and falls;
   directional KO falls; a better celebration take.
8. **Camera.** A proper chase rig for the follow camera; replay angles that frame the landing strike; referee-aware
   REVERSE choice.
9. **Settings that do nothing.** Either make game-plan mode, risk when behind and heart matter, or remove them (the
   realism pass may address the first).
10. **Look.** Crowd detail up close, modelled truss lamps, live LED boards, cloth for officials, a cage door.
11. **Code health.** Split the >1,500-line files (`grappling/graph.ts` 3,494 lines); wire or remove `ai/multi.ts`;
    trim the ~1,100 unused exports (`AUDIT_FINAL.md` M2, M3, L4).

## 30. Exact commands

```bash
# setup and run
npm ci
npm run dev                                   # http://localhost:5173

# checks
npm test
npx tsc --noEmit
npm run golden:check
npx vitest run tests/sim.golden.test.ts       # the golden test alone

# build
npm run build
npm run preview                               # http://localhost:4173
npm run build:single                          # + dist/standalone.html (lite)

# batches and calibration
npx tsx scripts/batch/run.ts --list
npm run batch -- --plan identical --n 1000 --seed perf-pass --out runs/identical --max-workers 2
npm run batch -- --plan ufc_population --seed cal-2026-09 --out runs/ufc --max-workers 2 --resume
npm run calibrate:report -- runs/ufc --out runs/ufc/CALIBRATION.md --baseline runs/prev

# the golden corpus after an intentional engine change (bump SIM_ENGINE_VERSION first)
npx tsx scripts/dev/sim-golden.ts --write tests/fixtures/sim-golden.json

# benchmarks and audits (through the governor)
node scripts/dev/heavy.mjs npx tsx scripts/dev/sim-bench.ts --n 10 --only 3r,5r,1v5
node scripts/dev/heavy.mjs npx tsx scripts/dev/sim-golden.ts --check tests/fixtures/sim-golden.json
node scripts/dev/heavy.mjs npx tsx scripts/dev/anim-audit.ts
node scripts/dev/heavy.mjs npx tsx scripts/dev/cam-audit.ts
node scripts/dev/heavy.mjs npx tsx scripts/dev/replay-sizes.ts

# any heavy command on a shared machine
node scripts/dev/heavy.mjs <command...>
```
