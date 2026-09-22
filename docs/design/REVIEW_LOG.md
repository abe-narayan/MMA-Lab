# Design Review Log — cross-section consistency pass

Scope: `docs/design/01`–`09` against `00_CONVENTIONS.md`. Every edit made is tagged `[REVIEW: …]` inline in the
section file (stub rows are tagged `[REVIEW: added]`). Nothing outside `docs/design/` was modified. Sections were
not rewritten; edits are minimal and local.

Conventions used below: **fix** = reference renamed / value aligned in place; **stub** = missing definition added
in the owning section; **note** = ownership clarified without changing a number; **open** = not resolved here.

---

## 1. Id reconciliation

### 1.1 `pos.*` (owner: 03 §2.2 node catalogue, 74 ids, + §2.2.13 alias map for 04's 16 draft ids)

| used in | ids checked | unresolved before | resolution |
|---|---|---|---|
| 04 §0.1 | 51 | `pos.ground_closed_guard_broken` (03's alias row wrote it as `_broken` shorthand) | fix: 03 §2.2.13 row spelled out |
| 06 §2.3.6(a), §2.3.6b, §2.3.9 | wildcards + 3 | `pos.ground_kob`, `pos.ground_turtle_*` | fix: → `pos.ground_side_kob`, `pos.ground_turtle` / `pos.ground_referee`; positionMult list rewritten with 03 ids |
| 07 | 0 explicit pos ids | — | — |
| 08 §5.7 pose table | 72 rows | 03 nodes **missing** from the table: `pos.ground_ashi_cross`, `pos.ground_truck` (03 added them at 04's request); table header said "73 nodes" | stub: two rows added [REVIEW: added]; header → 74. `pos.sub_*` (08's own pose-set ids) noted as 08-owned; "30 submissions" → 54 |
| 09 §1.6 I2 | example ids | `pos.ground_mount_top` / `_bottom` do not exist (03 uses one node per pair with `a`/`b` slots) | fix: invariant I2 restated in 03's slot model |
| 01 archetypes | 0 pos ids | — | — |
| FIGHT_DATA rows | every `FD #n` / `FIGHT_DATA §3 row n` in 01–09 (≈ 140 citations) | all in 1–129 and on-topic (spot-checked #17, #36/#37, #46, #48, #49, #73, #84, #105–#110, #113–#129, #22, #24, #12, #2, #51, #54, #82, #41, #128, #127, #125, #126, #97, #98) | no change |

### 1.2 `tech.*` / `def.*` / `feint.*` / `ctr.*` / `move.*` (owners: 02 §2.2/§2.4/§2.5/§2.3.4/§2.1.5, 03 §2.3, 04 §2.5)

| used in | unresolved before | resolution |
|---|---|---|
| 01 §4 archetypes (31 ids) | `tech.lead_hook`, `tech.body_hook_lead/_rear`, `tech.overhand_rear`, `tech.low_kick_rear`, `tech.calf_kick`, `tech.round_kick_body_rear`, `tech.switch_kick_body`, `tech.round_kick_head_rear/_lead`, `tech.front_kick_body`, `tech.side_kick`, `tech.spinning_back_kick`, `tech.feint_jab`, `tech.feint_level`, `tech.blitz_step`, `tech.clinch_knee`, `tech.collar_tie_knee`, `tech.clinch_elbow`, `tech.gnp_cross`, `tech.clinch_entry_collar/_underhook`, `tech.body_lock_td`, `tech.kick_catch_sweep`, `tech.guard_pull`, `tech.arm_drag_back`, `tech.tackle`, `tech.headlock`, `tech.grab_push`, `def.slip_outside`, `def.pivot` | fix: alias table added at the top of 01 §4 [REVIEW: added] mapping each to the canonical 02/03 id; 01 §4 preamble already required "aliased, not silently dropped" |
| 03 | `tech.harai_gaeshi`, `tech.ouchi_gaeshi` | none needed — defined in the bundled `tech.osoto_gaeshi / …` row |
| 05 §2.1 examples | `tech.rear_low_kick`, `tech.gnp_elbow` | fix: examples replaced by the merged contract text (`tech.kick_low_rear`; `tech.gnp_elbow` now defined in 03 §5.1.1) |
| 07 §2.9, §2.4.4, §2.7.4 | `tech.feint_*`, `switchStance`, `wallWalk`, `hitOnBreak`, `def.neutral` | fix: → `feint.*` (02 §2.3.4), `move.switch_stance`, `tech.wall_walk`, `tech.hit_on_break` + `ctr.hit_on_break`; `def.neutral` defined as "no reactive defence" (02 §2.6.1 step 6), not an id |
| 08 §5.2 clip table, §9.2 example | `tech.low_kick`, `tech.head_kick`, `tech.switch_head_kick`, `tech.feint_jab`, `def.high_guard`, `def.slip` | fix: rows rewritten with 02 ids (`tech.kick_low_rear`, `tech.kick_head_rear`, `tech.kick_head_switch`, `feint.jab`, `def.block_high`, `def.slip_out/in`, `guard.cover_turtle`, …); `def.neutral` in 08's `DefenceId` kept as the "none" value |
| clinch / ground strike ids | **no section defined them** (02 §1 assigns tied clinch strikes and ground striking to 03; 03 §5.1 listed strike *types* only; 05 needs `tech`+`weapon`; 01 presets reference `tech.gnp_cross`, `tech.clinch_knee`) | stub: 03 §5.1.1 [REVIEW: added] — `tech.clinch_uppercut`, `tech.clinch_hook`, `tech.clinch_elbow`, `tech.clinch_knee`, `tech.gnp_punch`, `tech.gnp_hammerfist`, `tech.gnp_elbow`, `tech.gnp_knee_body`, `tech.upkick`, `tech.bottom_elbow`, `tech.bottom_punch`, each with weapon and the 02 Table B force row |

### 1.3 `sub.*` (owner: 04 §3, 54 ids, + §0.3 node-resolved aliases)

| used in | unresolved before | resolution |
|---|---|---|
| 01 archetypes | `sub.knee_bar`, `sub.headlock_squeeze` | fix: → `sub.kneebar`, `sub.bulldog` (edited in place, alias table row) |
| 03 | `sub.armbar`, `sub.triangle`, `sub.kimura`, `sub.arm_triangle`, `sub.ezekiel`, `sub.neck_crank`, `sub.straight_ankle`, `sub.crucifix_shoulder_lock`, `sub.electric_chair`, `sub.mounted_triangle`, `sub.mounted_guillotine` | none needed — all in 04 §0.3's alias list; `sub.guillotine_*` / `sub.heel_hook_*` wildcards resolve |
| 07, 08, 09 | 0 unresolved | — |

### 1.4 `state.*` (owner: 05 §2.10 for physiological states; 02 §2.9 and 04 §2.1 own transient technical states)

| used in | unresolved before | resolution |
|---|---|---|
| 02 | its own 16 transient ids (`state.jab_setup`, …) + 05's `state.rocked/stunned/body_hurt` | note: 02 §1.1 now states the namespace split |
| 04 | `state.unconscious`, `state.injured_limb`, `state.neck_strain` | fix: aliased to 05's `state.choked_out`, `state.joint_failure`, `state.neck_cranked` (04 §0.3, §2.1; 05 §2.3.8 cross-note) |
| 06 | `state.paused` (referee sim variable, not a fighter state) | no change |
| 08 §2.2, §5.11 | `state.flash_kd`, `state.dead_leg_lead/_rear`, `state.dead_arm_L/R`, `state.eye_swollen_L/R`, `state.tapped` | fix: replaced by 05 ids with a `:L/:R` or `:lead/:rear` side suffix convention; tap is an event |
| 03, 07, 09 | 0 unresolved | — |

### 1.5 `evt.*` / event kinds (owners: 04 §2.9, 06 §2.6, 07 §2.8; canonical union: 09 §1.4)

08 and 09 use no `evt.*` ids, so the literal check passes; the real defect was **four event vocabularies** (04
`evt.sub_*`, 06 camelCase `refWarning`…, 07 `evt.plan.set`…, 08 `ref_warning`…) with no mapping, and 04's nine
trigger events "from §03" that 03 never emitted.

- stub: 03 §2.3 M [REVIEW: added] — `evt.arm_crossed_centre`, `evt.hand_posted`, `evt.back_taken`,
  `evt.sprawl_front_headlock`, `evt.step_over_guard`, `evt.turn_away`, `evt.posture_broken`,
  `evt.underhook_from_bottom`, `evt.head_down_standing`, each with the emitting edge.
- stub: 09 §1.4 [REVIEW] — canonical `SimEvent.kind` list extended (`slam, injury, stateChange, refereeBreak,
  refereeTimeout, standingEight, scorecardRound, pointsAwarded, judoScore, streetEnd, timidityWarning, planSet,
  adjustment, read, emergency, paceShift, stanceSwitch, roleAssign, trap`) and a five-column mapping table from
  every 04 / 06 / 07 / 08 event name to the canonical kind. 06 §2.6 and 08 §2.3 now point at it.

### 1.6 Sub-skill and attribute ids (owner: 01 §2.2, §2.3.1, §2.7)

All `discipline.subSkill` references in 02–08 resolve to 01 §2.3.1 directly or through declared alias tables (02
§1.2, 03 §2.1.3, 04 §0.2). Attribute-level mismatches found and fixed:

| section | reference | resolution |
|---|---|---|
| 02 §2.7 | `stanceExposure[opp]` as a 0–100 attribute with threshold 30 | fix: 01 stores bout counts and derives `stanceFamiliarity` (0–1); threshold → familiarity < 0.5 (≈ < 3 bouts, = 07 ST-5) |
| 05 §1, §2.4.1 | `chin` | fix: `chinEff` (01 §2.4.3) — age and KO history already inside |
| 05 §2.2.2 | `kBrace` from a chin/strength blend | fix: 01 `neckMult` on the `neck` attribute (01 defined `neck` for this; 04 `M_NECK` already used it) |
| 05 §2.5.7 | own `experience = clamp(proFights/12, 0.1, 0.8)` | fix: 01 §2.4.1 `experience` |
| 05 §2.4.2 | `historyMult`, `priorKOs` | note: = 01 `kKOHistoryMult`, `koLosses` |
| 05 §1 | `massKg` | note: = 01 `fightNightKg` |
| 05 §2.5 | `aerobicRate` parameterisation vs 01 `energy.*` composites | note: identical at cardio 50, within 4 % over 20–80; 01 registry values authoritative |

---

## 2. Section-number cross-references

| file | wrong reference | fix |
|---|---|---|
| 03 §1 interface table | "§08 Multi-opponent … §08 owns targeting"; "Presentation" unnumbered | → §07 §2.7 (targeting) and §09 §3.1 (multi-opponent manager); "§08 Presentation" |
| 03 §7 heading and body (3×) | "interface to §08", "§08 targeting order", "§08 `focusPenaltyLogit`" | → §07 §2.7 / §09 §3.1 |
| 07 §1 numbering note | claimed 01 labels AI "06" and referee "07" | 01 already uses file numbering; note rewritten |
| 08 §1 | striking / damage / referee "not yet written, referenced by subject name" | section numbers 02 / 05 / 06 / 09 added |
| 01 | none — interface table already correct (06 Rules, 07 AI, 08 Presentation, 09 Architecture) | — |

---

## 3. Interface contracts

### 3.1 `StrikeImpact` (02 §2.6.5 → 05 §2.1) — **rewritten in both files, one merged interface**

Mismatches found: field names (`attacker` vs `attackerId`, `tech` vs `techId`, `closingSpeed` vs
`closingSpeedMs`, `subLocation` vs `site`, `placement` (4 values) vs `contact` (3)), weapon enums (02 had
backfist/elbow_point/instep/ball_of_foot/heel/shin_on_knee; 05 had hammerfist/head/mat), glove enums (`mma` vs
`mma4oz`), 02 passing `absorb` + `rot` while 05 derived absorb from a `defence` enum and rotation from `kWeapon`,
05 requiring `targetBraced/targetRelaxed/targetGrounded/posture/attackerMassKg/targetMassKg` that 02 never set,
and the **force scale**.

Resolution (02 §2.6.4 "Force-scale handoff", 05 §2.1 rewritten):
- `forceN` = **delivered** force (placement already applied) on the Pierce in-ring scale — the shared distribution.
- 05 keeps `F_REF = 3,400 N`, `ALPHA_REF = 6,300`, `ALPHA_50 = 8,500`, `ALPHA_SCALE = 1,000`, `dmg.rawScale = 100`
  and sets `cleanMult = 1.0` for any impact carrying `placement` (its 1.0/0.5/0.25 table is now a fallback for
  impacts built without one).
- Arithmetic: 02's `F_med` (flush cross 1,400 N, hooks 1,500–1,600, mean power ≈ 1,500) × placement mix
  0.20/0.35/0.30/0.15 at ×1.00/0.75/0.45/0.25 with `σ_F` 0.30 gives a 4-component lognormal mixture with medians
  ≈ 1,500 / 1,125 / 675 / 375 N; mixture median ≈ 1,100 N, log-spread ≈ 0.45–0.5 — the same distribution
  (median 1,150 N, σ_ln 0.45) 05 §2.4.1's Monte-Carlo was run on. Hence 05's **2.3 % KD per landed distance power
  head strike** (≈ 1.1 per 100 head sig) holds with no change to `F_med` or 05's damage scale. Residual tail
  differences (02 ≈ 3–5 % > 2,000 N vs Pierce 2–4 %) are the joint C1–C3 lever `ko.alphaCal`.
- `rot` dropped from the payload (05 `kWeapon` is per-newton; 02's hook `rot` 1.5 would double-count);
  `p.strike.glove.boxing.rotFactor` and `p.strike.force.refFlushCross` retired.
- `absorb`: 02's defence-outcome fraction (BOX §3 D1: blocked 0.45 MMA / 0.65 boxing) is used as `absorbBase`;
  05's table is the fallback; 05 still applies brace (max 0.3) and rocked ×0.5.
- `defence` enum added to the payload with 02's `def.*` → enum mapping; `targetState.braced/grounded`, `posture`,
  05's `gloveType` enum, 05's site names adopted; `attackerMassKg/targetMassKg` read from fighter records.
- 05's expectations on 02 rewritten: the "flush median 2,100 N rear straight" (peak scale) expectation and the
  kick/knee/teep/elbow *ratios* (1.3/1.4/0.7/0.9) are replaced by 02 Table B values; 05's Monte-Carlo rows for
  kicks/knees/elbows must be re-run in the C1–C3 batch (open, §6).
- 02 §5 rows 36–38: target changed from an assumed 3.9 % with guessed P(KD|placement) to 05's 2.3 % working
  target (05 C3 already ranks FD #37 above FD #36).

### 3.2 `RefObservables` (05 §2.7 → 06 §2.3.1)

Field names matched (05 wrote them to 06's list). Fields 06's pseudocode reads that neither draft listed were
added to both: `defenceQuality30` (02), `knockdownsLast10s` (06-derived), `underChoke` (04), `clinching` (03),
`moving` (02). LOC detection lag: 04 §2.6.4 had `U(0.8, 2.0)` s, 06 `locDetectS` 1.0 s median — 04 now defers to
06's parameter.

### 3.3 `TickSnapshot` / `PresentationFrame` (09 §1.4 ↔ 08 §2.2)

09's `FighterSnapshot` lacked most of what 08 consumes, and 08 said its adapter "imports engine internals", which
09 §1.1 forbids. Resolution: 09 `FighterSnapshot` extended [REVIEW] with `vx, vz, partnerId, againstFence,
fenceNormalAngle, actionDetail{…}, defenceDetail, grips[], contacts, damageVisual, fatigueVisual, balance,
states[]`; `EngagementSnapshot` defined with 03 §2.1.1's `kind, cage, underhookOwner, kuzushi{dir,mag}, posture,
inflight` plus the 08 interaction root. 08 §2.2 now states the adapter is a pure function of the public
`TickSnapshot`/`SimEvent`. 08 `subTarget` 'nose' → 'midface' and the full 05 site list; 08 `states[]` → 05 ids.

### 3.4 `GamePlanPanel` / `FighterIntent` (07 §2.6.7 ↔ 09 §4.4)

Already consistent — 07 §2.6.7 gives the 1:1 projection (`strikeRateTarget = paceTarget`, `takenUp = accepted`,
…). No change.

### 3.5 `Ruleset` (06 §2.1 ↔ 09 §3.2)

09 listed different ruleset ids (`mma_unified`, `boxing`, `kickboxing_abc`, …; 08 had `'mma_unified' |
'boxing_abc'`) and a prose "Ruleset object carries: … legal technique predicate, judging model id". Fix: 09 §3.2 now
lists 06's `Ruleset.id` values (`mma.unified.3r`, `boxing.pro`, `kickboxing.k1`, `muay_thai.stadium`,
`grappling.subonly`, …) and names 06 §2.1's fields; `MatchSettings.judgingMode 'open'` ↔
`Ruleset.scoring.openScoring 'after_each_round'`, `judgeCulture` ↔ `scoring.culture`,
`refereeStrictness` ↔ `referee.strictness`. 06 §2.6 notes 06's ids are canonical.

### 3.6 Slam handoff (04 §2.6.6 → 05)

04 emitted `evt.slam{height, forceMult, target, surface}`; 05 consumes only `StrikeImpact`. Fix: 04 §2.6.6 now
specifies the exact `StrikeImpact` (weapon `mat`, region/subLocation by target, `forceN = forceMult × 4,400 N`,
`× Arena.surfaceHardness`, placement flush, absorb 0, unseen, grounded). Arithmetic recorded there shows 05's
`kWeapon.mat` 0.35 yields ≈ 0.5 % `pConcuss` per waist slam vs 03's `grap.slamKoClassP` 3–8 % — **open** (§6).

### 3.7 03 engagement fields in 09

`kuzushi`, `underhookOwner`, `cage`, `posture`, `inflight` were absent from 09's snapshot — added (3.3 above).

---

## 4. Numeric conflicts and resolutions

| # | topic | sections / values | resolution |
|---|---|---|---|
| N1 | KO logistic midpoint/scale | 05: 8,500 / 1,000 (derivation recorded §2.4.1 from Rowson & Duma 2013); 01 §2.2.1 chin row quoted "units of 1,800 rad/s²", "+870 / +1,300 rad/s²" (DP's 6,383/1,800) | 01 row fixed to 05's scale: 0.02 z per chin point = 20 rad/s²; 80 → +600, 95 → +900. 02 and 07 carry no KO-curve numbers (confirmed by grep). |
| N2 | age term on KO | 01 §2.2.2 "05 must not add its own age multiplier on kKO"; 05 §2.4.2 had `ageMult = 1 + 0.04/yr (30–35) + 0.08/yr (35+)` | 05 `ageMult` removed (= 1.0), `ko.age.*` retired; age enters only via 01 `chinEff`; C-4/C27 tune `fm.age.chin.attenuation` |
| N3 | doctor-stoppage share | 05 C17 0.8–1.1 % (FD #109); 06 §2.3.7 / §5 0.8–1.1 % (FD over DMG's 2–4 %) | already agree — no change |
| N4 | ground unanswered-strike TKO count | 06 6/4/3 lenient/standard/strict (+ 8/6/4 standing, `tkoNoDefenceS` 3.0/2.0/1.2); 05 cues consistent ("3–5 fully undefended"); 03 §5.4 rolled its own `0.02 × dmg× …` after ≥ 3 unanswered; 07 finisher said "within the referee window" without numbers | 03 §5.4 marked superseded by 06 (formula kept as sanity check; `grap.gnpStoppageBase` annotated); 07 §2.6.5 now cites 06's 6/4/3 and 05's `unansweredHead`/`tSinceDefenceS` |
| N5 | KD per landed distance power head strike | 02 §5 3.9 % (FD #36) with assumed P(KD\|flush/solid/partial) 0.12/0.04/0.01; 05 §2.4.1 2.3 % (pipeline), C3 "C2 wins" | 02 row re-pointed at 05's 2.3 % working target; P(KD\|placement) are 05 outputs |
| N6 | kick catch base | 03 `tech.kick_catch` 0.25 vs body kick; 02 `def.kick_catch` 0.28 body / 0.35 teep / 0.10 head / 0.25 knee | 03 → 02's values (02 owns the catch roll); 03's 0.15 vs low kick kept |
| N7 | hit-on-the-break bonus | 03 `tech.hit_on_break` +0.63 logit; 02 `ctr.hit_on_break` +1.0 (MIS I-12 +20–30 % → D) | 03 → +1.0 |
| N8 | level-change read bonus | 03 `def.read_level_change` "+0.63 (§02)"; 02 `ctr.intercepting_knee` +0.60 / `ctr.uppercut_on_level_change` +0.70; 03 `tech.level_change_feint` bite 0.55 [E] vs 01 `feintBiteP` (T4 ≈ 0.30) | 03 rows now cite 02's bonuses and 01's bite formula (takedown domain) |
| N9 | read / counter-on-read / feint-bite by tier | 01 formulas (readP T0 0.57…T5 0.86; counter 0.05/0.22/0.44/0.53; bite 0.60…0.24); 02 tables (0.50…0.87; 0.05/0.12/0.25/0.35/0.50/0.60; 0.65…0.22); 07 tables (0.50…0.87; 0.02/0.05/0.15/0.25/0.40/0.50; 0.65…0.25); 02's cue-read formula also added `1.5 × (striking.read − 50)/100` to a base that already contained skill, and 07's `p_read` had its own slope/anxiety/familiarity terms | 01 §2.7.6 declared the single owner (note added); 02 cue-read formula rewritten on `readP_striking`; 02/07 tables marked reference-only and their registry rows retired (`p.strike.read.base/skillK/counterOnRead`, `p.strike.feint.bite`, `ai.read.p_tier/elapsed_slope/telegraph_coef/anxiety_pen/familiarity_pen`, `ai.read.counter_p`, `ai.feint.bite`, `ai.feint.repeat_*`); 02 keeps the situational modifiers, 07 keeps the opponent-model `patternMods` and the draws |
| N10 | kick hip-rotation tier multiplier | 01 `hipRotationMult` 0.50/0.60/0.75/1.00/1.05/1.10 (exported to 02); 02 `tierMult` kicks 0.50/0.75/0.90/1.00/1.05/1.10 | 02 → 01's values (T1, T2) |
| N11 | check rate by tier | 01 `beh.mt.check_rate` <0.10/0.10/0.25/0.50/0.60/0.70; 02 0.10/0.25/0.40/0.50/0.60/0.70 | 02 → 01 (T1 0.10, T2 0.25) |
| N12 | stumble after missed/checked kick | 01 T0–T1 0.35/0.45, T2 0.15/0.25; 02 T1 0.15/0.25, T2 0.08/0.15 | 02 → 01 |
| N13 | feet-cross probability | BOX §8 r32 25/10/2/0 %; 02 0.25/0.10/0.02 [S]; 01 `beh.box.cross_feet` 0.40/0.15 [E]; 07 `stance_break_p` 0.30/0.10 [E] | 01 and 07 → 0.25/0.10/0.02 (sourced value) |
| N14 | eyes-close tell | 01 `beh.gen.eyes_close` 0.70 (T0) / 0.30 (T1) per incoming power strike; 07 35 % / 15 % per exchange | 07 → 01 |
| N15 | telegraph representation | 01 `telegraphMod` (read-prob add) → 02 `telegraphAdd` ms (+150…−60); 07 `tele_mult` 1.6…0.7 on a 0–1 score | 07 → 02's ms values (+ fatigue term); `ai.exec.tele_mult.tier` retired |
| N16 | corner uptake | 01 `beh.gen.corner_uptake` 0.5/0.6/0.7/0.8/0.9 (iqTier 1–5, MIS §8); 07 CO-2 formula `0.5 + 0.1 × max(0, iq − 2)` = 0.5/0.5/0.6/0.7/0.8 while claiming to reproduce 01's ladder; 07 §3 table 0.5/0.5/0.5/0.6/0.7/0.8 | 07 → `0.4 + 0.1 × iqTier` (+ 01 adaptability term) |
| N17 | score-estimate σ | 01 "none / corner-only / 0.5 / 0.3 / 0.2"; 07 1.0 / 0.7 / 0.5 / 0.3 / 0.2 rounds | 01 → 07's numbers (both cite MIS §8; 07 needs a sampleable σ) |
| N18 | BJJ-tier tables | 01 §2.3.4 maps BJJ_POSITIONS tiers 0/1/2/3/4 → T0/T1/T2–T3/T4/T5; 03 §8.3 and 04 §6.1 used them one-for-one (T0…T4, T5 = T4), shifting stamina cost, decision latency, turns-back share, mount-escape attempts, sub-exit awareness, cage use, pass/sweep repertoires and guard-vs-strikes by one tier at T3+ | 03 §8.3 rows, `grap.tierStaminaMult`, `grap.decisionLatencyS`, 04 §6.1 latency, `param.sub.attempt.latencyS` re-mapped to 01's mapping (e.g. stamina 1.6/1.3/1.1/1.1/1.0/0.9) |
| N19 | grappling tier energy multiplier ownership | 01 `energy.actionCostMult`, 03 `grap.tierStaminaMult`, 04 §2.8, 05 `skillCostMult ±15 %` all touched the same effect | 05 applies 01's multiplier once for grappling action classes; its `skillCostMult` is striking-only; 03/04 rows point at 01 |
| N20 | wrestling T1 interpolations | 03 §8.1 sprawl T1 0.35 [E], retention T1 50 % [E]; 01 T0–T1 20 % / 55 % | 03 → 01 |
| N21 | chain-after-stall | 01 0.15/0.40/0.65/0.80–0.90 (WR §7 quotes); 03 §3.1 formula 0.15 + 0.008 × chains (0.15/0.31/0.47/0.63/0.79/0.91) | 01 row notes 03's formula is the engine value |
| N22 | experience | 05 `proFights/12` clamp; 01 `0.1 + 0.9(1 − e^{−fights/6})` | 05 → 01 |
| N23 | recovery attribute range | 01 `recoveryHalfLifeMult` ±30 %; 05 ±15 % on half-lives ("halved because rocked-exit also uses it") | note in 01: ±30 % is the total across the two channels |
| N24 | combination length cap | 02 availability 2/3/3/4/5/6; 07 selection 2/2/3/4/4/4 (Wittman ≤ 4) | both kept: 07's is the AI default selection cap and must be ≤ 02's availability cap (notes in both) |
| N25 | sub attempt rate / finish rate | 01 `beh.sub.attempt_rate` = 04 §6.1 `pAttempt` (same formula and multipliers); 03 #73 25 % = 04 C5 25 %; back-take → RNC 0.45 in both | already consistent — no change |
| N26 | stubbornness / tap bases | 01 §2.7.7 = 04 §2.6.2 = 04 §7 (0.40 / 0.19 / 0.11 / 0.05 by SUBDEF band) | consistent; 04 §6.2's per-tier 0.15 / 0.13 are band-averages (see open issues) |
| N27 | LOC referee lag | 04 U(0.8, 2.0) s; 06 1.0 s median | 04 → 06's `cfg.locDetectS` |
| N28 | stand-up / clinch-break timers | 03 §6.2 45/75 · 30/50 · 15/30 s and 40/25/12 s = 06 §2.3.12 | consistent — no change |
| N29 | sprawl tier table | 03 `def.sprawl` T0 0.20 / T2 0.50 / T3 0.70 / T4 0.85 = 01 `beh.wr.sprawl_*` | consistent |

---

## 5. Tier tables (task item 5)

01 §2.3.4 (`tierBySkill` bands 10/30/50/70/90, `tierByYears` 0.25/1/4/8 with the +1 cap, T5 gate IQ ≥ 80 ∧
composure ≥ 75, research-tier mapping table) is referenced, not redefined, by 02 §3, 03 §8, 04 §6, 05 §3, 06 §3,
07 §3, 08 §10. The only divergent *mapping* was the BJJ_POSITIONS five-tier ladder in 03 §8.3 / 04 §6.1 (N18,
fixed). 02 §3 header and 07 §1 already state they use 01's tiers; 07's `iqTier07 = overallTier == T0 ? 0 :
iqTier01` convention is consistent with 01 (`iqTier` 1–5).

---

## 6. RNG draw order (task item 6)

07 fixed 6 draws/fighter/tick; 09 §2.2 added a commit jitter draw in P3 that 07 did not count; 02 §2.6.1 rolled its
own pattern/cue reads inside the strike pipeline while 07 also drew `u_read`/`u_feint` per tick; 09 P2 claimed 05
draws in upkeep while 05 §2.10 draws only at impact; 05 (a)–(j) and 06 §2.3.6(a) fouls "after the hit roll" had no
place in 09's P4 description.

Resolution: **09 §2.7 "Per-tick RNG draw schedule (authoritative)"** [REVIEW: added] — P0 break block (5/fighter),
P1/P2 none, P3 8 per fighter (`u_pattern, u_read, u_feint, u_eval, u_select, u_timing, u_target, u_commit`; +1
`u_switch` multi), P4 per-contact fixed layouts (strike 6 + 05's 10 (+10 self-damage) + 2 foul; grappling edge
4 (+10) + 2; submission window 4; scramble 2; interrupt 1), P5 1 steering jitter per fighter, P6 state-derived
referee draws in fixed order, P7 3 per judge per round at round end, P8/P9 none, plus the pre-bout order. 07 §2.1
(now 8 draws), 07 registry `ai.rng.draws_per_tick`, 07 V-21, 07 A-2, 02 §2.6.1 header, 04 §2.4.3, 09 §2.1 P2–P6
rows all updated to point at it.

---

## 7. Determinism / performance flags (task item 7)

- No section reads wall-clock or `Math.random`; 08's `wallClockDt` affects only smoothing rates (P1) and
  cosmetic RNG is seeded; 09 §2.6 bans `Date`/`performance.now`/`Math.random` by lint; commentary uses a forked
  RNG (09 §5.1). **OK.**
- 06 §2.3.7 "20–60 s of wall time" → reworded to stopped-clock sim time [REVIEW]. 06 `ref.pending` iteration →
  annotated "array, insertion order — never Set/Map" [REVIEW].
- 04 §2.6.1 `tLoc ~ Normal` at lock = 2 RNG calls (`normal()`), plus `pGoOut` and `tTap` uniforms — recorded in
  04 §2.4.3 and the 09 schedule.
- 0.1 s tick contract: all technique/window durations are ms with 09's sub-tick offset; 04 windows (500/1,000 ms)
  and 05 per-second clocks are tick multiples; 07 cadences are seconds. 02 §6 item 20 keeps a "50 ms striking
  resolver" fallback in reserve — flagged as a contract change if ever taken (would change every draw schedule
  and `SIM_ENGINE_VERSION`).
- Performance: 07 opponent model (864 counters × exp decay per tick per fighter) and the T5 KL check are cheap;
  05's per-impact 10-draw block and the always-drawn `selfDamage` block add ≈ 20 RNG calls per strike — negligible
  against the ≤ 1.5 s/bout budget in 09 §6.2. No ordering hazard found in 03 (ascending id, `(a,b)` order) or 04
  (higher `sk.legLocks` first, then lower index).

---

## 8. File edits (complete list)

**01_FIGHTER_MODEL.md** — §2.2.1 `chin` row (KO scale 1,000 rad/s²); §2.2.1 `recoveryHalfLifeMult` note; §2.7.6
authority note on read/counter/feint formulas; §3.0 `beh.gen.score_awareness` σ values; §3.1 `beh.box.cross_feet`
0.25/0.10/0.02; §3.3 `beh.wr.chain_after_stall` → 03 formula; §4 preamble alias table (31 preset ids →
canonical) [REVIEW: added]; §4.7 `sub.headlock_squeeze` → `sub.bulldog`; §4.13 `sub.knee_bar` → `sub.kneebar`;
§5.7 `beh.box.cross_feet.p`.

**02_STRIKING.md** — §1.1 `state.*` namespace note; §2.3.4 bite probability → 01 `feintBiteP`; §2.4.3 cue-read
formula rewritten on `readP_striking`, `readBase` reference-only, counter-on-read → 01 formula; §2.6.1 pipeline
header (draw layout → 09 §2.7); §2.6.4 `tierMult` kicks → 01 values, rotational handoff and force-scale handoff
rewritten (resolved with 05, arithmetic shown); §2.6.5 `StrikeImpact` replaced by the merged contract; §2.7
familiarity → 01 `stanceFamiliarity`; §3 tier table rows (execution/telegraph unchanged; `readBase`, feint bite,
counter-on-read reference-only; check rate, stumble, combination cap notes); §4 registry rows retired/aligned
(`feint.bite`, `read.base`, `read.skillK`, `read.counterOnRead`, `force.tierKick`, `force.refFlushCross`,
`glove.boxing.rotFactor`, `stance.exposureThreshold` → `familiarityThreshold`, `tier.checkRate`,
`tier.stumbleMiss/Checked`); §5 rows 36–38 → 05's 2.3 % target; §6 item 11 marked resolved.

**03_GRAPPLING_STATE_GRAPH.md** — §1 interface rows (§07/§09/§08 numbering); §2.2.13 alias row spelled out;
§2.3 A `def.read_level_change`, `tech.level_change_feint`, `tech.kick_catch`, `tech.hit_on_break` bases →
02/01 owners; §2.3 M trigger-event table [REVIEW: added]; §5.1.1 clinch/ground strike id table [REVIEW: added];
§5.4 stoppage superseded by 06; §7 heading and three body references (§08 → §07/§09); §8.1 T1 sprawl/retention;
§8.3 eight rows re-mapped to 01's BJJ tier mapping; §9.1 `grap.tierStaminaMult`, `grap.decisionLatencyS`,
`grap.gnpStoppageBase` annotations.

**04_SUBMISSIONS.md** — §0.3 `state.*` row aliased to 05 ids; §2.1 state list; §2.4.3 draw count note;
§2.6.4 LOC lag → 06 `locDetectS`; §2.6.6 `evt.slam` → `StrikeImpact` mapping with arithmetic; §2.8 energy tier
multiplier ownership; §6.1 decision latency re-mapped; §7 `param.sub.attempt.latencyS`.

**05_DAMAGE_FATIGUE_CONSCIOUSNESS.md** — §1 interface row from 01 (chinEff, neck, experience, energy
composites, kKOHistoryMult); §2.1 `StrikeImpact` and expectations on 02 rewritten (merged contract, delivered
force); §2.2.1 `cleanMult` / `absorbBase` / `absorb` (payload-driven); §2.2.2 `kBrace` → 01 `neckMult`; §2.3.8
alias note; §2.4.1 `chinEff`; §2.4.2 `kKO` (ageMult removed), `historyMult` = 01, cross-check paragraph; §2.5.1
`skillCostMult` split striking/grappling; §2.5.7 `experience` → 01; §2.7 `RefObservables` five fields added; §4.1
`dmg.cleanMult` note; §4.3 `ko.kBrace`, `ko.neckBrace` (retired), `ko.historyPerKO`, `ko.age.*` (retired); §4.4
`fat.dump.exp*` (retired).

**06_RULES_REFEREE_JUDGING.md** — §2.3.1 four observable rows added; §2.3.2 `ref.pending` ordering note; §2.3.5
`locDetectS` note; §2.3.6(a) turtle row ids; §2.3.6b `positionMult` ids; §2.3.7 "wall time" wording; §2.3.9
`pos.ground_side_kob`; §2.6 canonical-event / ruleset-id note.

**07_STRATEGY_AND_AI.md** — §1 numbering note; §2.1 determinism contract (8 draws, table); §2.2.5 (via registry)
combo cap note; §2.3 `telegraph`, `stanceIntegrity`, `eyesClosed` rows; §2.4.4 `p_read` formula and
`p_counter`; §2.4.5 `p_bite`; §2.6.5 measured-finisher referee window; §2.6.6 CO-2 uptake; §2.9 canonical action
ids row; §3 tier table rows (p_read, counter, bite, corner uptake, tells); §4 registry rows
(`ai.rng.draws_per_tick`, `ai.combo.cap.tier`, `ai.exec.tele_mult.tier`, `ai.exec.stance_break_p`,
`ai.exec.eyes_closed_p`, `ai.read.*` ×6, `ai.feint.bite.tier`, `ai.feint.repeat_*`, `ai.corner.uptake`); §5 V-21;
§6 A-2.

**08_PRESENTATION.md** — §0 intro section numbers; §2.2 adapter note, `states[]` comment (05 ids + side suffix),
`target` note, `subTarget` list; §2.3 event-mapping note; §5.2 kicks / defence / feints clip rows → 02 ids; §5.7
header count 73 → 74, two pose rows added [REVIEW: added], `pos.sub_*` 30 → 54; §5.11 three state-id cells; §9.2
example ids.

**09_ARCHITECTURE_MODES_CALIBRATION.md** — §1.1 submissions count; §1.4 `FighterSnapshot` extension,
`EngagementSnapshot`, `SimEvent` kind list + five-column event-name map [REVIEW: added]; §1.6 I2; §2.1 P2–P6
draw columns; §2.7 per-tick RNG draw schedule [REVIEW: added]; §3.2 ruleset ids and `Ruleset` fields; §4.1
submission-attempt wording.

---

## 9. Open issues (not resolved here) with recommendations

1. **Slam KO-class chance.** 03 `grap.slamKoClassP` 3–8 % per slam vs 05's pipeline ≈ 0.5 % with
   `ko.kWeapon.mat` 0.35 (arithmetic in 04 §2.6.6). Recommend: treat 03's figure as the calibration target for
   FD #68-adjacent slam finishes and tune `ko.kWeapon.mat` (0.35 → ≈ 0.9 would give ≈ 3 %) in the C1–C3 batch; do
   not raise `forceMult`.
2. **05 Monte-Carlo rows for kicks/knees/elbows** were computed with force ratios (1.3/1.4/0.9 × straight) that
   02's Table B does not produce (rear body kick 1.15 ×, knee 1.6 ×, elbow 1.0 ×). Recommend re-running 05 §2.4.1's
   table from 02's catalogue before Phase 9; the head-kick/knee `pConcuss` (17 % / 16 %) will move.
3. **Tail of the force distribution.** 02's per-placement `σ_F` 0.30 vs 05's pooled 0.45 gives a slightly fatter
   > 2,000 N share (3–5 % vs 2–4 %). Recommend leaving `σ_F` and using `ko.alphaCal` (≈ 0.9 per 05 §5) once real
   target/position mixes are in.
4. **04 tap bases by tier** (§6.2 T2 0.15 / T3 0.13) are band-averages of 01's SUBDEF-band formula (20–39 → 0.19,
   40–79 → 0.11); the engine must use 01's formula, and 04 §6.2/§6.3 should be read as illustrative. Recommend a
   one-line note in 04 §6.2 by the 04 writer.
5. **02 bladedness effects owned by other sections** (TD defence −0.60·b "owned by 03"; lead-leg exposure to 05)
   have no matching term in 03 or 05. Recommend 03 add `BLADE` to §2.1.4 (or 02 drop the row) — not added here
   because the magnitude is 02's guess and 03's `def.sprawl` already carries a stance-geometry input via 02.
6. **05 §3 tier priors for chin/bodyToughness/recovery** (35 ± 15 … 60 ± 10) are not in 01's generator (01 gives
   mental priors only). Recommend 01 adopt them in §2.5's generator-prior paragraph or 05 mark the row advisory.
7. **Event vocabulary implementation.** The 09 §1.4 map makes one recorder possible, but 04/06/07/08 still
   *write* their own names. Recommend the implementation phase (09 §9.3 C3.x) rename at source; the map is the spec.
8. **08's `PairState.transition.edge` and `ActionState.result` vs 09** — 09's `actionResult` enum lacks
   `checked`/`caught` (02 stat details). Recommend adding them to 09 `FighterSnapshot.actionResult` when C3.3
   freezes the interface (additive).
9. **Multi-opponent parameter duplication.** 05 §2.9 (`swarm.*`: effective cap 2 + 0.5 per fringe, cone 60°),
   07 §2.7 (`ai.multi.*`: fringe weight 0.3, facing cone ±45°) and 09 §3.1 (threat formula, hysteresis 1.2 vs 07's
   1.25, bystander separation 0.10/10 s vs 06/07 hazard 0.010/s) each carry their own crowd constants. Recommend
   09 §3.1 defer to 07 §2.7 for targeting/threat and to 05 §2.9 for the defence/energy effects; only the slot/fringe
   geometry belongs in 09's manager. Not edited because each number is [E] and the sections disagree on ownership.
10. **`stanceExposure` threshold semantics.** 07 ST-5 uses "< 3 fights vs stance" (hard threshold, T4+ immune); 01
    scales ST-5 by `(1 − familiarity)` continuously. 02 now follows 01's continuous form with a 0.5 gate. Recommend
    07 adopt the continuous scaling to avoid a step at 3 bouts.
11. **02 §6 item 20 (50 ms striking resolver fallback)** would break the 0.1 s contract and the 09 §2.7 schedule;
    recommend it be struck or re-specified as a change requiring a `SIM_ENGINE_VERSION` bump.
12. **04 `evt.*` triggers as internal signals.** 09 §1.4 maps them to detail flags on `positionChange`/`strike`
    rather than separate events; if commentary or the game-plan panel needs them, promote to `stateChange` events.
