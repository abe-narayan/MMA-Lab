# DESIGN.md — Conventions (read before every section)

These conventions bind every section of the design. A section that needs to deviate says so explicitly.

## 1. Provenance tags — every number carries one
- `[S: FILE §n]` — sourced; FILE is a file in `research/` (e.g. `[S: FIGHT_DATA §3]`, `[S: LIT_REVIEW §4]`).
- `[D: …]` — derived arithmetically from sourced numbers; show the arithmetic once.
- `[E]` — estimate / assumption. Every `[E]` must also appear in the section's closing "Assumptions" list.
- A number with no tag is a bug.

## 2. Units and time
- SI: metres, kilograms, seconds, newtons, rad/s². Weight classes are quoted in lb *and* kg.
- Simulation tick: **dt = 0.1 s (100 ms)** for decisions and resolution (kept from the existing engine, see
  `docs/AUDIT.md`). Technique durations are specified in **milliseconds** in the design; the engine rounds to
  ticks and may carry a sub-tick offset for ordering simultaneous strikes.
- Rounds: ruleset-defined (MMA 5×60 s ×3 or ×5; boxing 3 min; etc.). Never hard-code 300 s.

## 3. Attribute and skill scales
- **Physical attributes**: 0–100 (50 = average trained adult male of the weight class; 80+ elite; 95+ freak).
  List: strength, explosiveness, speed (foot), handSpeed, kickSpeed, cardio, chin, bodyToughness, recovery,
  flexibility, balance, reactionTime (higher = better), plus body: heightM, reachM, legReachM, massKg, age,
  bodyFatPct, build (ecto/meso/endo blend), stance (orthodox/southpaw/switch), handedness.
- **Discipline sub-skills**: 0–100, per discipline (boxing, muayThai, kickboxing, wrestling, judo, bjj,
  karate, sambo, mmaIntegration…). Sub-skills are named in section 01.
- **Skill tiers** (per discipline, derived from sub-skill mean and years trained):
  | Tier | Name | Sub-skill band | Typical training |
  |---|---|---|---|
  | T0 | Brand new (untrained) | 0–10 | never trained |
  | T1 | Beginner | 10–30 | months |
  | T2 | Intermediate / amateur | 30–50 | 1–4 yr, amateur bouts |
  | T3 | Regional pro | 50–70 | 4–8 yr, regional pro record |
  | T4 | Elite / UFC level | 70–90 | 8+ yr, top-promotion level |
  | T5 | Champion | 90–100 | elite + exceptional IQ/consistency |
- **Mental**: fightIQ, aggression, composure, heart, discipline, adaptability — 0–100.

## 4. Probability convention
All contested outcomes are **logit-additive**:

```
P = sigmoid( logit(base) + Σ modifiers )
```

- `base` is the probability for **T4 vs T4 (UFC-average vs UFC-average), fresh, neutral state**, because the
  calibration data (`research/FIGHT_DATA.md`) is UFC data. If a research file quotes a base for a different
  reference (e.g. "T2 vs T2"), convert and say so with a `[D]` tag.
- Skill-gap modifier: `k_skill × (attackerSkill − defenderSkill) / 100` in logit units, where the relevant
  sub-skill(s) are named per edge. Quote `k_skill` per edge; typical range 1.0–3.0 logit per 100 points
  (≈ ±0.2–0.6 logit per tier step).
- Physical modifiers are expressed per unit (per 10 kg, per 10 cm reach, per 10 attribute points).
- State modifiers: fatigue (0–1), rocked, legDamage, cage contact, setup/feint bonus, telegraph penalty, etc.
- Randomness is drawn from the seeded engine RNG in a fixed order; the design never assumes wall-clock.

## 5. Naming
- snake_case ids with namespaces: positions `pos.standing_long`, `pos.clinch_double_under`,
  `pos.ground_mount_high`; techniques `tech.jab`, `tech.double_leg`, `tech.uchi_mata`; submissions `sub.rnc`,
  `sub.guillotine_high_elbow`; defences `def.check`, `def.sprawl`; states `state.rocked`.
- A section that introduces ids lists them in a table with a one-line definition.

## 6. Section skeleton (every section)
1. Purpose and scope (what this system owns; interfaces to other sections by section number).
2. Model (entities, states, formulas) — with tags.
3. Behaviour by skill tier (T0…T5) — what visibly changes.
4. Parameter registry — table `id | value | unit | tag` of every tunable introduced. These become
   `src/engine/params/*.ts`.
5. Calibration hooks — which `FIGHT_DATA` targets this section is responsible for.
6. Assumptions and open questions — every `[E]`, plus playability-vs-realism tradeoffs (default realism,
   state the tradeoff).

## 7. Existing engine vocabulary (for continuity; may be superseded)
Current `Posture`: standing | clinch | ground | down. `GroundPosition`: guard | half | side | mount | back.
`ActionKind` (23): idle, advance, retreat, circle, jab, cross, hook, uppercut, lowKick, bodyKick, headKick,
teep, clinchEntry, clinchKnee, breakClinch, shoot, sprawlDefend, groundStrike, passGuard, sweep, standUp,
submission, recover. `DefenseKind`: neutral, highGuard, slip, parry, sprawl, frame, subDefend. The determinism
contract (fixed tick order, seeded RNG, digest) is preserved — see `docs/AUDIT.md §3`.
