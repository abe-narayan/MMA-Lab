# Bout Lab — Simulator Design Rulebook

Version 1.0 (2026-09-22). Status: research-traced design, reviewed for cross-section consistency
(`docs/design/REVIEW_LOG.md`). This document is the index and the binding summary; the full rulebook is
the nine chapters in `docs/design/`, ~12,300 lines, every number tagged with its source.

To read the whole rulebook as one file: `node scripts/bundleDesign.mjs` writes `docs/DESIGN_FULL.md`.

## 1. What this is

The complete specification of the simulation: every system, formula, probability and tuning number, each
traced to `research/LIT_REVIEW.md`, `research/BIBLIOGRAPHY.md` or one of the sixteen discipline/data
files in `research/`. Where evidence does not exist, the number is tagged `[E]` and listed in that
chapter's "Assumptions" section. **Realism is the default; where playability conflicts, the chapter states
the tradeoff and the alternative.**

## 2. Reading order and chapters

| Ch. | File | Owns | Size |
| --- | --- | --- | --- |
| 00 | `design/00_CONVENTIONS.md` | Provenance tags, units, dt = 0.1 s, 0–100 attribute scale, T0–T5 tiers, logit-additive probability convention (base = UFC-average vs UFC-average), id naming, section skeleton | 0.1k lines |
| 01 | `design/01_FIGHTER_MODEL.md` | Body, 14 physical attributes with age curves, 10 disciplines × named sub-skills, 56-row transfer matrix, tier derivation, record/career effects, 6 mental attributes, style schema, derived composites, **~190-rule tier behaviour catalogue**, 15 archetypes | 2.0k |
| 02 | `design/02_STRIKING.md` | Asymmetric range bands, 54-technique catalogue (timing, P_land, force model), 35 combos, 8 feint types, 9 guards + 26 reactive defences, 33-entry counter matrix, 11-step hit pipeline → `StrikeImpact` | 1.4k |
| 03 | `design/03_GRAPPLING_STATE_GRAPH.md` | **74 position nodes, 186 edges** (takedowns, 24 no-gi judo throws, clinch, passes, sweeps, escapes, get-ups, scrambles), chains, cage model, GnP, stand-up timers, multi-opponent engagement invariant | 1.2k |
| 04 | `design/04_SUBMISSIONS.md` | 4-stage battle (setup → entry → secure → finish), 54-entry catalogue, 34 defences, choke LOC/tap model, joint-lock refusal → injury, 100+ chain edges, 10-ruleset legality matrix | 1.4k |
| 05 | `design/05_DAMAGE_FATIGUE_CONSCIOUSNESS.md` | Six regions with acute/structural pools, states (stunned/rocked/KD/KO, dead leg, body collapse, cuts, swelling), rotational-acceleration KO logistic, three-pool fatigue, recovery, referee observables, AI hooks | 1.4k |
| 06 | `design/06_RULES_REFEREE_JUDGING.md` | `Ruleset` schema with 13 instances (MMA 3R/5R/amateur, boxing, GLORY, K-1, Muay Thai ×2, IBJJF, ADCC, sub-only, judo, street), tick-level referee, foul machine, doctor/corner, judging (10-point must with empirical weights, per-judge bias/noise), strictness presets | 1.2k |
| 07 | `design/07_STRATEGY_AND_AI.md` | Four-layer decision architecture (plan → intent → utility → execution), perception/opponent model, pre-fight game plan generator (physical/style/stance rules), 16 adaptation rules, score/damage awareness, corners, multi-opponent target policies and team roles, 22 commentary hooks, 22 validation checks | 1.3k |
| 08 | `design/08_PRESENTATION.md` | Sim→presentation frame contract, character pipeline (MPFB2 bodies, stat morphs), skin/sweat/damage look, post stack + presets, animation layers (motion matching, phase-aligned clips, IK, paired poses for all 74 positions, hit reactions, ragdoll), broadcast director, HUD, asset/licence plan | 1.1k |
| 09 | `design/09_ARCHITECTURE_MODES_CALIBRATION.md` | Module layout, frozen interfaces, replay v4, P0–P9 tick phases, modes/rulesets/arenas/settings, stats, commentary grammar, batch runner under the 93% cap, **129-row calibration acceptance table**, tuning method, Phase 3–9 checkpoints | 1.2k |

Suggested reading: 00 → 09 §1–2 (architecture and tick) → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 §3–9.

## 3. The model in one page

- **Time.** Fixed 0.1 s tick; actions commit with startup/contact/recovery in ms; a total order
  `(subMs, actorId, seq)` resolves simultaneous events; all randomness from the seeded RNG in the order
  fixed in 09 §2. A bout is a pure function of (seed, fighters, ruleset, arena, settings).
- **Fighters.** Body + 14 physical attributes (0–100) + per-discipline sub-skills (0–100) → tiers T0–T5 per
  discipline + 6 mental attributes + style. Experts differ from novices in anticipation, accuracy and
  economy, not reaction time (LIT_B).
- **Standing.** Range is asymmetric (each fighter's effective reach). A strike is a landing roll
  (logit-additive: skill gap, setup, feint, fatigue, defence read) → placement category → force drawn from
  a right-skewed in-ring distribution (median ≈ 950 N, uncorrelated with mass) → `StrikeImpact`.
  Defence is reactive and read-based; counters live in the attacker's recovery window.
- **Grappling.** A graph: 74 positions, 186 edges. Every takedown, throw, pass, sweep, escape and get-up is
  an edge with duration, base P (UFC-average vs UFC-average), sub-skill gains, physical/state modifiers and
  counters. Chains are explicit. The cage is a state on every relevant edge.
- **Submissions.** Four contested stages; the defender fights every stage. Chokes put you out at ~9 s once
  locked; 89% of finishes are taps; joint locks hurt before they break; heel hooks give no warning.
- **Damage.** Six regions with acute and structural pools. Knockdown/KO is a logistic on a rotational-
  acceleration equivalent (jaw, unseen, fatigue, chin, history). Fatigue is three pools; lactate-like load
  never fully clears, so front-runners fade without a special rule.
- **Officials.** Referees act on observable cues with a measured lag (3.5 s / 2.6 strikes after a KO
  blow); judges use the ABC criteria with empirically fitted weights (knockdown ≫ sub attempt ≫ takedown ≫
  strike) plus per-judge noise and bias tuned to 77/18/3 unanimous/split/majority.
- **Strategy.** A game plan is generated pre-fight from scouting, scaled by fight IQ (T0 has none). Intent
  updates on a tier-dependent cadence from what the fighter noticed. Trailing fighters raise output and hunt
  stand-up finishes (they do not shoot more); leaders do not coast. Corners give ≤ 2 cues.
- **Crowd / teams.** Kept and improved: threat assessment, target policies, line-keeping against the
  fence, teammates' roles by tier, street end-conditions (flight, incapacitation, separation).

## 4. Calibration anchors (modern UFC, per fighter unless stated) — `research/FIGHT_DATA.md §3`

| Metric | Target | Metric | Target |
| --- | --- | --- | --- |
| Sig. strikes landed / min | 3.9 ± 0.4 | Sig. accuracy | 46% ± 3 |
| Accuracy head / body / leg | 38 / 70 / 81% | Fight time distance / clinch / ground | 61 / 15 / 24% |
| Knockdowns per fighter per 15 min | 0.30 | KD → KO/TKO | 65% |
| TD attempts / landed per 15 min | 4.0 / 1.45 | TD accuracy / defence | 38% / 62% |
| Sub attempts per 15 min | 0.45–0.6 | Sub finish per attempt | ~17–25% (RNC ~40%) |
| KO/TKO / SUB / DEC | 32 / 18 / 49% ± 3 | Finish share in R1 | 53% |
| Decision split U/S/M | 77 / 20 / 2.5% | Predictability of evenly-rated bouts | 60–65% |

The full 129-row acceptance table with tolerances is in chapter 09 §7; tier and strategy checks in 09 §7
and 07 §5.

## 5. Findings that overrule intuition (and are followed)

1. **Height and reach do not change UFC win probability** (only heavyweight shows a small reach signal).
   Reach changes *how* fighters fight — jab/teep/range/circling weights — not the odds. (LIT_B, FIGHT_DATA)
2. **Age is the anthropometric that matters** (≈ −1.5 to −2 pp per year of gap). (LIT_B)
3. **Fatigue costs volume, accuracy and defence, not punch force** (force loss ≤ 10%). (LIT_A)
4. **Fighters behind on the cards cut takedowns and hunt stand-up finishes**; they do not gamble on the
   ground. Only ~15% of finishes come in round 3. (MMA_INTEGRATION_STRATEGY)
5. **A realistic sim is only ~62% predictable** in evenly-rated matchups; anything above ~70% is
   under-randomised. (LIT_B)
6. **Judges weight knockdowns ~5× a takedown and ~11× a significant strike.** (LIT_B)
7. **12-6 elbows are legal** under the 2024 Unified Rules; "grounded" no longer depends on hands. (RULES_JUDGING)

## 6. Realism-vs-playability tradeoffs (defaults are realism)

| Topic | Realistic default | Playable alternative (setting) | Where |
| --- | --- | --- | --- |
| Fight tempo | ~1:3 work:rest; long neutral spells | "Arcade" pacing multiplier | 09 §3 |
| Finish rates | ~50% decisions at T4 vs T4 | Damage-realism slider raises finishes | 05 §6, 09 §3 |
| Grappling duration | 60 s median ground stints, referee stand-ups | Shorter stand-up timers | 03 §6, 06 §2 |
| Upsets | 35–40% in even matchups | Lower decision noise (not recommended) | 07 §2, 09 §8 |
| Injury from refused taps | Abstract injury states, doctor stoppage | Off | 04 §2, 05 §2.3 |
| Visual damage | Swelling, cuts, blood | Blood off (presentation only) | 08 §4 |

## 7. Known weak evidence (marked ASSUMPTION throughout)

Rocked-state durations; leg-kick and body-shot dose–response; cut rates by weapon; referee stoppage
thresholds; judging coefficients (thesis-level evidence); per-technique submission attempt→finish rates;
setup-conditional takedown success; corner-advice content; multi-attacker dynamics (LIT_REVIEW §14 lists 26
items). These are the first candidates for tuning in Phase 9 and the first to revisit if new data appears.

## 8. Cross-section interfaces (authoritative definitions)

| Interface | Defined in | Consumed by |
| --- | --- | --- |
| Fighter definition, attributes, tiers, composites | 01 | all |
| `StrikeImpact` (region, force, rotational proxy, seen/unseen, weapon) | 02 §2.6 | 05 §2.1 |
| Position/edge ids, engagement state, kuzushi/underhook fields | 03 §2 | 04, 07, 08, 09 |
| Submission ids, stage state, slam handoff | 04 | 03, 05, 07, 08 |
| Capability multipliers, `state.*`, `RefObservables` | 05 | 02, 03, 04, 06, 07, 08 |
| `Ruleset`, referee/judge events (`evt.*`) | 06 | 07, 08, 09 |
| `GamePlan`, `FighterIntent`, `GamePlanPanel`, commentary hooks | 07 | 08, 09 |
| `PresentationFrame`, event stream | 08 §2 / 09 §1 | presentation |
| Tick phases P0–P9, RNG schedule, replay v4, module layout | 09 | all |

Conflicts found and resolved during review are recorded in `design/REVIEW_LOG.md`.
