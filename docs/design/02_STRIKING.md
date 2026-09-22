# 02 — Standing Striking

Status: design, v1. Binding conventions: `docs/design/00_CONVENTIONS.md`. Replaces the strike model described in
`docs/AUDIT.md §1.1` (single logit roll, 10 strike kinds, pre-chosen defence posture, 5 % flush lottery).

## 0. Source key and local conventions

Provenance tags follow conventions §1. `FILE` abbreviations used in `[S: FILE §n]` tags:

| Key | File in `research/` |
|---|---|
| BOX | `BOXING.md` |
| MTK | `MUAY_THAI_KICKBOXING.md` |
| LA | `LIT_A_performance_biomech_physio_injury.md` |
| LB | `LIT_B_anthropometrics_predictors_expertise_tactics.md` |
| FD | `FIGHT_DATA.md` (`FD #n` = row n of the §3 master calibration table) |
| MIS | `MMA_INTEGRATION_STRATEGY.md` |
| DP | `DAMAGE_PHYSIOLOGY.md` |

**Probability-point → logit conversion.** Research files quote many modifiers as probability points ("+0.05").
Conventions §4 makes every contested outcome logit-additive, so each such modifier is converted once at the base it
was quoted against: `Δlogit = Δp / (p·(1−p))`. Worked once: BOX rule B5 "+0.10 after a landed jab" was quoted against
a power-punch base p ≈ 0.30 → `0.10 / (0.30 × 0.70) = +0.48 logit` [D]. At p ≈ 0.30, +0.05 p ≈ +0.24 logit; at
p ≈ 0.60, +0.05 p ≈ +0.21 logit. Multiplicative "×1.4" weights from MIS are converted as `ln(1.4) = +0.34` when they
are applied to a hit chance rather than to a selection weight [D]. Selection weights that stay selection weights (AI
layer, section 07) are left as multipliers.

**Reference matchup.** Every `base` below is T4 vs T4 (UFC-average vs UFC-average), fresh, neutral, MMA ruleset,
4-oz gloves, at the technique's home range band, thrown *cold* (no set-up, no combination, no feint). MTK quotes its
bases for "T2 vs T2" on its own 5-tier scale (its T2 = regional pro ≈ our T3); BOX quotes "competent defender"
(≈ our T3). Where those were used they were re-anchored to the UFC accuracy matrix [S: FD #17–19] and tagged [D].

**Two-stage landing model (read this before the tables).** UFCStats "accuracy" is a *marginal*: it already contains
every defence the reference defender made. The catalogue therefore carries two numbers per technique:

- `P_land` — the marginal probability that the strike is recorded as landed vs the reference defender. This is the
  calibration anchor ("base P(land)" in the tables).
- `pA` ("arrival") — the probability that the strike reaches its target *before* the defender's reactive response is
  applied. It is **derived** so that `P_land` is reproduced against the reference defender (§2.6.1) and is the number
  the engine rolls.

Engineers implement `pA`, the defence layer (§2.4) and the placement roll (§2.6.3); the calibration batch checks that
the marginal comes out at `P_land` (§5).

**Time.** Durations are in ms at T4 execution. The engine rounds to the 100 ms tick and carries a sub-tick offset
(0–99 ms) per action: a 130 ms jab launched at offset 40 contacts at offset 170 → tick +1, offset 70. Strikes in the
same tick resolve in ascending absolute contact time, ties by ascending fighter id (determinism contract,
`docs/AUDIT.md §3`).

---

## 1. Purpose and scope

This section owns everything that happens while **both fighters are standing and not tied up**: geometry (range,
angle, cage), the standing technique catalogue, timing, combinations and feints, the reactive defence layer, counters,
and hit resolution up to the point where a landed strike becomes a `StrikeImpact` payload for the damage model.

| Interface | Direction | What crosses it |
|---|---|---|
| 01 Fighter model | in | attributes (conventions §3), composites `effectiveReachM`, `effectiveKickReachM`, `reachAdvCm`, `powerIndex.*`, `handSpeedMs`, `kickSpeedMs`, `reactionTimeMs`, `execTimeMult`, `telegraphMod`, `anticipation.readP`, style, and the sub-skills in §1.2 |
| 03 Grappling state graph (clinch, takedowns, ground) | out/in | `def.clinch_up`, clinch entries, kick-catch → clinch / takedown branches, set-up flags for level changes off strikes (`state.jab_setup`, `state.cross_setup`, `state.hook_bodylock_window`), `def.duck_under`, the post-check single-leg window. Clinch-range strikes **with a tie** (dirty boxing, clinch knees, elbows from a collar tie) are owned by 03; this section owns elbows/knees thrown at `range.close` **without** a tie. 03 resolves takedowns. |
| 05 Damage, fatigue, consciousness | in/out | out: `StrikeImpact` payload (§2.6.5); 05 owns KO/rocked/knockdown, cuts, hand and shin injury. in: fatigue index `f` (0–1), region pools, mobility. Per-action energy costs (DP §4.2) are owned by 05; this section emits `commitment` per action so 05 can price it. |
| 06 Rules, referee, judging | in | ruleset flags: `gloveType`, `elbowsLegal`, `elbow12to6Legal`, `obliqueKickLegal`, `kneesToHeadStandingLegal`, `kickCatchRule ∈ {mt, kb, mma}`; the `significant` flag rule for stats. |
| 07 Strategy and AI | in/out | 07 chooses techniques, defences (when a read succeeds) and feints; this section exposes availability (§3), selection-weight tables (§2.7, §2.8) and opponent-model hooks (§2.3.4, §2.5.4). |
| 08 Presentation | out | `BoutEvent` results and placement/sub-location for impact visuals (§2.6.5). |

Section numbers in the body follow this table (03 = clinch and takedowns, 05 = damage and fatigue, 06 = rules,
07 = AI). Out of scope: ground striking, clinch striking with a tie, takedown resolution, judging, the KO logistic.

### 1.1 Identifiers introduced

| Namespace | Meaning |
|---|---|
| `range.*` | range bands (§2.1.1) |
| `cage.*` | cage zones (§2.1.4) |
| `tech.*` | offensive techniques (§2.2); `move.*` movement primitives (§2.1.5) |
| `guard.*` | guard postures — continuous positional state (§2.4.1) |
| `def.*` | reactive defences (§2.4.2) |
| `ctr.*` | named counters (§2.5.2) |
| `feint.*` | feint actions (§2.3.4) |
| `combo.*` | named legal chains (§2.3.2) |
| `state.*` | transient striking states (§2.9) |
| `p.strike.*` | tunables (§4) |

### 1.2 Sub-skills consumed (aliases used in this section → section 01 §2.3.1 fields)

The body of this section uses short aliases; each resolves to a section-01 sub-skill (or the max of several, so a
kickboxer and a Thai boxer both get credit for the same act). "Effective" values (01 §2.3) are used throughout.

| Alias here | Section 01 field(s) | Used for |
|---|---|---|
| `boxing.jab` | `boxing.jab` | jab family accuracy |
| `boxing.power` | `boxing.power` | cross/hook/uppercut/overhand accuracy and force quality |
| `boxing.combos` | `boxing.combinations` (punches), `kickboxing.combinations` (punch→kick) | chain legality, per-step bonus, combo length cap |
| `boxing.headMovement` | `boxing.headMovement` | slip, roll, duck, pull, shoulder roll |
| `boxing.guard` | max(`boxing.guard`, `kickboxing.defence`) | block, parry, catch, cover, frame; passive posture quality |
| `boxing.footwork` | max(`boxing.footwork`, `kickboxing.footwork`) | step-back, pivot, L-step, range control |
| `boxing.counters` | `boxing.counters` | counter bonus realisation, simultaneous counters |
| `boxing.bodyWork` | `boxing.bodyWork` | body punches, liver shot |
| `striking.feints` | `boxing.feints` | feint sell quality, rhythm breaking |
| `striking.read` | `anticipation.readP` (01 composite; §2.4.3 tier table is the default it replaces) | read probability |
| `striking.cageCraft` | `boxing.ringCraft` | cutting off the cage, escaping the fence |
| `kickboxing.roundKick` | max(`muayThai.kicks`, `kickboxing.kicks`, `kickboxing.lowKicks` for low/calf) | round kicks, calf, question mark |
| `kickboxing.teep` | `muayThai.teep` | teeps, stop-kicks, teep-jam |
| `kickboxing.checks` | max(`muayThai.checks`, `kickboxing.checks`) | check, knee-raise |
| `kickboxing.catches` | `muayThai.catches` | kick catch and post-catch tree |
| `kickboxing.spinning` | `kickboxing.spinning` | spinning techniques |
| `muayThai.elbows` | `muayThai.elbows` | elbows at close range |
| `muayThai.knees` | `muayThai.knees` | straight / intercepting / flying knees |
| `mma.levelChangeDefence` | `wrestling.takedownDefence` (03) combined with `anticipation.readP` | reading level changes; intercepting knee/uppercut |

`tier.striking` = the conventions-§3 tier of the mean of the effective striking sub-skills present (01 §2.3.4).
Where 01 supplies a composite that overlaps a number here (`execTimeMult`, `telegraphMod`, `reactionTimeMs`,
`anticipation.readP`, `effectiveReachM`), 01's value is authoritative and this section states the mapping.

---

## 2. Model

### 2.1 Range and geometry

#### 2.1.1 Range bands

`d` is the horizontal centre-to-centre distance between the two point masses (as in the current engine). Bands are
**asymmetric**: each fighter has their own band relative to the opponent, computed from their own reach.

| Quantity (m) | Formula | Tag / anchor |
|---|---|---|
| `effectiveReachM` | from 01 §2.7: `(reachM − 0.20·heightM)/2 + 0.10` (fist reach from stance incl. shoulder turn) | [S: 01 §2.7]; UFC pooled reach 182.2 ± 11.5 cm, height 177.5 ± 9.5 cm [S: LB §6] → 0.83 m |
| `armLen` | `effectiveReachM − 0.10` | [D] ≈ 0.73 m |
| `jabReach` | `effectiveReachM + 0.27` | [E] lean +0.10, attacker shoulder-to-centre +0.05, defender face-to-centre +0.12 → 1.10 m at 182 cm reach |
| `crossReach` | `jabReach + 0.04` | [E] |
| `hookReach` | `armLen + 0.12` | [E] ≈ 0.85 m |
| `uppercutReach` | `armLen − 0.05` | [E] |
| `elbowReach` | `0.55` | [E] |
| `kneeReach` | `0.65` | [E] |
| `kickReach` | `effectiveKickReachM + 0.30` | [E] 01's kick reach (+0.15 m on leg reach) plus pivot-foot travel and defender torso; legReach ≈ 1.05 m → 1.50 m |
| `teepReach` | `effectiveKickReachM + 0.25` | [E] |
| `stepGain` | `0.30–0.50` per step | [S: BOX §2 #2] step jab closes 30–50 cm |

| Band id | Interval on `d` (attacker *A*) | Meaning | Anchor |
|---|---|---|---|
| `range.clinch` | `d < 0.45` | bodies in contact; ties available (→ 03) | [E] two torso radii 0.18 m + 0.09 m |
| `range.close` | `0.45 ≤ d < 0.70` | uppercuts, short/shovel hooks, elbows, knees, body work | [S: BOX §2] close < 0.5 m chest-to-chest; +0.2 m to centre-to-centre [D] |
| `range.mid` | `0.70 ≤ d < jabReach_A − 0.15` | all punches without a step; hooks optimal 0.75–0.95 | [S: BOX §2] mid 0.6–0.9 m chest-to-chest [D] |
| `range.long` | `jabReach_A − 0.15 ≤ d < jabReach_A + 0.10` | jab/cross at full extension, teeps, round kicks with a short pivot | [S: BOX §2] long 1.0–1.3 m chest-to-chest [D] |
| `range.kick` | `jabReach_A + 0.10 ≤ d < kickReach_A` | only kicks/teeps land without a step; punches need a step-in | [E] |
| `range.out` | `d ≥ kickReach_A` | nothing lands without a step | [E] |

A 10 cm reach advantage moves *A*'s `range.long` 5 cm further out than *B*'s: the longer fighter has a band where he
can jab and the shorter cannot. That is the whole geometric content of "reach"; the accuracy consequences (§2.8) are
deliberately small.

Techniques may be thrown one band outside their home band with a **range-fit penalty**: `p.strike.rangeFit.edge =
−0.30` logit in the outer 10 cm of home band, `p.strike.rangeFit.wrongBand = −0.60` logit one band out, unavailable
two bands out [E]. Force in the outer 10 cm × `p.strike.rangeFit.forceEdge = 0.70` [E]; hooks/kicks thrown *inside*
their band (smothered) × `p.strike.rangeFit.forceSmother = 0.60` [E]. Low-skill strikers suffer more out of band:
add `(1 − skill/100) × p.strike.rangeComfort.k`, `k = 0.40` logit, to every range-fit penalty [E; direction S: LA §2
Estevan 2011 / Falco 2009 — medallists' timing is distance-invariant, novices' is not].

#### 2.1.2 Stance geometry

Per fighter: `stance ∈ {orthodox, southpaw}` (current), `canSwitch` (section 01 `stance = switch`, or
`boxing.footwork ≥ 60` [E]), and `bladedness b ∈ [0,1]` (0 square, 1 fully bladed), chosen by 07 per situation.
Effects of `b` [S: BOX §4 "Stances", §8 G30; magnitudes E]:

| Effect | Formula |
|---|---|
| jab accuracy | `+0.20·b` logit |
| jab reach / rear-hand reach | `+0.05·b` m / `−0.05·b` m |
| shoulder-roll success | `+0.40·b` logit; `def.shoulder_roll` requires `b ≥ 0.5` |
| lead-leg kick damage taken | `× (1 + 0.15·b)` (passed to 05 as `targetExposure`) |
| checks | `−0.20·b` logit (weight back, lead leg light: quick lift but late) |
| takedown defence | `−0.60·b` logit (owned by 03; quoted for coherence) |
| lateral movement to open side | speed `× (1 − 0.15·b)` |
| opponent's straights | `−0.10·b` logit (smaller target) |

MMA strikers sit at `b ≈ 0.3–0.5`, boxers `0.7–0.9`, Thai fighters `≈ 0.6` with weight back [E].

#### 2.1.3 Angles and the lead-foot battle

`angleOff_B` = angle between *B*'s facing and the vector *B*→*A*. While `|angleOff_B| > 30°` [E]: *B*'s straights
`−0.60` logit, hooks `−0.20`, kicks `−0.30`; *A*'s rear hand `+0.30`, and *A*'s strikes are `unseen` with P = 0.35
(§2.6.3) [S: BOX §8 G27 −0.15 p straights / −0.05 hooks after a pivot → D; unseen share E]. *B* re-squares in
`p.strike.angle.resquareMs = 300` ms unless *A* keeps pivoting [E].

**Lead-foot battle (open stance only).** `dominantAngle_A` is true when *A*'s lead foot is outside *B*'s lead foot
by ≥ `p.strike.leadFoot.threshold = 0.10` m [E]. Effects [S: MIS ST-1, ST-3, ST-6 → D]: *A* rear straight `+0.20`
logit, *A* rear kick to the open side `+0.20`, *A* lead hook `+0.10`, *B* rear straight `−0.15`, *A* lead-leg
low/calf kick `+0.26` (ln 1.3). Circle-to-outside selection weight ×1.5 for both (07). Dominance also feeds 03
(outside angle → single-leg lane).

#### 2.1.4 Cage position and cutting off the cage

`cageDist` = distance from a fighter's centre to the nearest fence panel.

| Zone | `cageDist` | Effects on the fighter in the zone |
|---|---|---|
| `cage.centre` | `≥ 2.0` m [E] | none |
| `cage.near` | `0.8–2.0` m [E] | AI awareness; pressure fighter's cut-off can arm |
| `cage.fence` | `< 0.8` m [E] | `def.pull`, `def.step_back` unavailable; evasive defences `−0.40` logit; `def.step_off` `−1.0` logit [S: BOX §8 C12 (−0.10 p, "unavailable") → D]; opponent's combination cap +1, body-shot weight ×1.4, clinch-entry weight ×1.3 [S: MIS P-3] |

**Cut-off.** Pressure fighter *P* holds `state.cutoff` on mover *M* when for ≥ 0.5 s *P*'s lateral velocity mirrors
*M*'s (angle between *M*'s escape vector and *M*→*P* < 30°) and `cageDist_M < 2.0` m [E]. In `state.cutoff`, *M*'s
`def.step_back` / `def.step_off` fail outright with `p.strike.cutoff.failNear = 0.30` / `p.strike.cutoff.failFence =
0.60` before the normal roll [S: BOX §8 G28]. Cutting off requires T2+ (`striking.cageCraft ≥ 30`) and *P*'s
mirroring accuracy = `0.5 + 0.005 × cageCraft` [E; S: BOX §4 "a year or more"]. Straight-line chasing never arms
`state.cutoff` and hands *M* the pivot / check-hook counters (§2.5). In a 25-ft cage cut-off success × 1.15
[S: MIS §10.21]. Boxing rings: a cornered fighter (two ropes within 0.8 m) also loses lateral steps [S: BOX §8 C12].

#### 2.1.5 Movement primitives used by striking

| id | ms | Displacement | Notes | Tag |
|---|---|---|---|---|
| `move.step_drag` | 200 | 0.30–0.45 m, feet never cross | guard intact | [S: BOX §4 150–250 ms; distance E] |
| `move.step_in_strike` | folded into `tech.*_step` | 0.30–0.50 m | balance briefly one-legged | [S: BOX §2 #2] |
| `move.pivot` | 300 | 45–90° on lead foot | sets `angleOff` on opponent; basis of check hook | [S: BOX §4 250–350 ms] |
| `move.l_step` | 400 | lateral lead step + rear step to 45° | T3+ | [S: BOX §4 350–450 ms] |
| `move.shuffle` | 200/step | lateral | circling; side rules §2.7 | [S: BOX §4] |
| `move.level_change` | 200 | head drops 0.25–0.35 m | precedes body punches and shots; exposes to uppercut/knee | [E] |
| `move.shift` | 250 | step-through, temporary stance switch | power ×1.15, defence `−0.50` logit for 400 ms | [S: BOX §4 "Shift"; magnitudes E] |
| `move.switch_stance` | 300 | none | 1 % stamina; reads suppressed during; TD vulnerability `+0.60` logit; low kick on switching leg damage ×1.3 | [S: MIS ST-8] |
| `move.retreat_straight` | 200/step | backwards | novice default; loses `cageDist` fastest | [E] |

Novice error: crossing feet on a lateral step (T0 25 %, T1 10 %, T2 2 %, T3+ 0 %) sets `state.feet_crossed` for
300 ms: balance −10, evasive defences unavailable [S: BOX §8 H32].

### 2.2 Technique catalogue

Column key. **Range**: home band(s) (§2.1.1). **Target**: default region (`head`, `body`, `body.liver`, `leadLeg`,
`rearLeg`, `arms`); the AI may retarget within the technique's `targets` list. **Startup / contact / recovery**: ms
at T4 (launch→impact, uncancelable impact phase, impact→guard restored); tier multipliers in §3. **P_land**: marginal
base (see §0). **Telegraph**: readable cue before launch, ms (added to the defender's window, §2.4.3). **Commit**:
balance cost in balance points (0–100 scale) *and* guard exposure class (L/M/H). **Tag** covers the row's P_land and
timing; anchors are named.

Anchors used for P_land: distance head 31 %, body 63 %, leg 80 % [S: FD #17]; distance jab 29 %, distance power-head
25 % (2013 era; overall accuracy has since risen 42 → 46 % [S: FD §2.1 note b], so power-head splits are set ≈ +0.05
p above FN) [S: FD #25–26]; CompuBox boxing jab 17–20 %, power 35–36 % [S: BOX §7.1]; MTK §2 kick bases (re-anchored,
D). Per-punch-type splits within "power" are [E] (BOX §9.1: no public per-type data).

#### 2.2.1 Table A — punches

| id | Range | Target | Startup | Contact | Recovery | P_land | Telegraph | Commit | Tag |
|---|---|---|---|---|---|---|---|---|---|
| `tech.jab` | long, mid | head | 130 | 60 | 150 | 0.30 | 0 | 2 / L | [S: BOX §2 #1 100–160/120–180 ms; P_land D from FD #26 0.29 + era drift] |
| `tech.jab_step` | kick→long (closes 0.3–0.5 m) | head | 200 | 60 | 230 | 0.32 | 40 | 5 / M | [S: BOX §2 #2; P E +0.1 logit] |
| `tech.jab_power` | long | head | 220 | 70 | 280 | 0.27 | 60 | 6 / M-H | [S: BOX §2 #3] |
| `tech.jab_double` | long | head | 130 + 130 | 60 each | 180 | 0.30 then 0.37 | 0 | 3 / L | [S: BOX §2 #4 second jab lands more] |
| `tech.jab_flicker` | long | head (vision) | 110 | 50 | 120 | 0.22 clean / 0.60 touch | 0 | 1 / L | [S: BOX §2 #5]; touch sets `state.vision_blocked` 300 ms |
| `tech.jab_up` | long, mid | head | 150 | 60 | 190 | 0.31 (+0.3 logit vs `guard.high`) | 20 | 3 / L-M | [S: BOX §2 #6]; needs `guard.low_hands` or `guard.long` |
| `tech.jab_body` | long, mid | body | 180 | 60 | 230 | 0.52 | 40 | 5 / M (head dips) | [S: BOX §2 #7 0.45–0.55; FD #17 body 0.63] |
| `tech.jab_backstep` | long | head | 170 | 60 | 200 | 0.24 | 20 | 3 / L | [S: BOX §4 "back-step jab"; P E] |
| `tech.jab_pivot` | mid | head | 180 | 60 | 250 (pivot ends) | 0.27 | 30 | 4 / M | [S: BOX §2 note "pivot jab"; P E] |
| `tech.cross` | mid (long with step) | head | 210 | 70 | 290 | 0.30 | 40 | 6 / M-H | [S: BOX §2 #8 180–250/250–330; rear hand to target 183 ms §7.5; P D] |
| `tech.cross_step` | long | head | 250 | 70 | 320 | 0.28 | 60 | 8 / H | [E] |
| `tech.cross_body` | mid | body | 240 | 70 | 310 | 0.50 | 50 | 7 / M-H | [S: BOX §2 #17–18 0.45; FD #17] |
| `tech.cross_shift` | mid→close | head | 260 | 70 | 350 | 0.28 | 80 | 12 / H | [S: BOX §4 shift; E] force ×1.15 |
| `tech.hook_lead` | mid, close | head | 190 | 70 | 260 | 0.28 | 60 | 6 / M | [S: BOX §2 #9 150–230/220–300] |
| `tech.hook_rear` | mid, close | head | 240 | 70 | 320 | 0.25 | 80 | 8 / H | [S: BOX §2 #10] |
| `tech.hook_lead_body` | mid, close | body | 200 | 70 | 270 | 0.50 | 60 | 6 / M | [S: BOX §2 #16; FD #17] |
| `tech.hook_liver` | mid, close | body.liver | 220 | 70 | 280 | 0.45 | 60 | 6 / M | [S: BOX §2 #16 0.40 → D] |
| `tech.hook_rear_body` | mid, close | body | 250 | 70 | 310 | 0.48 | 80 | 8 / H | [E] |
| `tech.shovel_hook` | close | body / head | 190 | 60 | 250 | 0.42 body / 0.32 head | 40 | 5 / M | [S: BOX §2 #15] |
| `tech.uppercut_lead` | close (mid) | head | 220 | 70 | 280 | 0.35 close / 0.24 mid | 60 | 7 / M-H | [S: BOX §2 #11 0.30/0.40 → D] |
| `tech.uppercut_rear` | close (mid) | head | 240 | 70 | 320 | 0.36 close / 0.23 mid | 70 | 9 / H | [S: BOX §2 #12] |
| `tech.uppercut_body` | close | body | 210 | 60 | 270 | 0.48 | 50 | 6 / M | [E] |
| `tech.overhand` | mid | head | 300 | 80 | 400 | 0.23 | 100 | 12 / H | [S: BOX §2 #13 250–350/350–450; 0.26–0.32 vs competent → D] |
| `tech.check_hook` | mid (counter) | head | 190 | 70 | 300 | 0.20 lead / 0.40 as counter | 40 | 5 / M | [S: BOX §2 #14] |
| `tech.bolo` | mid | body / head | 320 | 80 | 350 | 0.16 | 150 | 10 / H | [S: BOX §2 #19]; optional |
| `tech.superman_punch` | long→mid | head | 350 | 80 | 450 | 0.20 | 150 | 14 / H | [E]; optional, MMA |
| `tech.spinning_backfist` | mid | head | 450 | 80 | 550 | 0.15 | 200 | 15 / H | [E]; optional |

#### 2.2.2 Table A — elbows, knees, kicks

Elbow rows are for `range.close` **without a tie**; with a tie they belong to 03 (clinch head accuracy 58 %
[S: FD #18]). Legality per ruleset flags (§1).

| id | Range | Target | Startup | Contact | Recovery | P_land | Telegraph | Commit | Tag |
|---|---|---|---|---|---|---|---|---|---|
| `tech.elbow_horizontal` | close | head | 170 | 50 | 200 | 0.36 | 40 | 4 / M | [S: MTK §2 E1 150–250; 0.45–0.55 T2→ close-no-tie D] cut roll (05) |
| `tech.elbow_upward` | close | head | 180 | 50 | 200 | 0.32 | 40 | 4 / M | [S: MTK E2] |
| `tech.elbow_downward` | close | head | 250 | 60 | 300 | 0.28 | 80 | 6 / M-H | [S: MTK E3]; `elbow12to6Legal` |
| `tech.elbow_diagonal` | close | head | 180 | 50 | 200 | 0.36 | 40 | 4 / M | [S: MTK E4] |
| `tech.elbow_spinning` | close→mid | head | 500 | 60 | 600 | 0.17 | 200 | 15 / H | [S: MTK E5 0.20–0.30 → D]; optional |
| `tech.knee_straight` | close, mid (with step) | body (head if legal) | 340 | 90 | 420 | 0.42 | 80 | 9 / H | [S: MTK N1 300–450/400–500 ×0.85; 0.45 → D] |
| `tech.knee_intercepting` | mid (counter vs level change / duck) | head / body | 300 | 90 | 400 | 0.55 vs level change | 60 | 9 / H | [S: MTK §8.18 +0.15; MIS I-6] |
| `tech.knee_flying` | long→mid | head | 550 | 100 | 750 | 0.20 | 200 | 25 / H | [S: MTK N4]; optional |
| `tech.teep_lead` | long, kick | body | 270 | 80 | 280 | 0.55 | 40 | 3 / L | [S: MTK T1 250–350; 0.55–0.65 incl. pushes → D] push effect §2.2.4 |
| `tech.teep_rear` | kick, long | body | 360 | 90 | 430 | 0.50 | 60 | 7 / M | [S: MTK T2] |
| `tech.teep_stop` | long (counter vs step-in) | leadLeg / hip | 250 | 70 | 270 | 0.60 | 30 | 3 / L | [S: MTK T3] |
| `tech.teep_face` | long | head | 400 | 90 | 480 | 0.18 | 100 | 9 / H | [S: MTK T4 0.20] |
| `tech.kick_low_rear` | long, mid | leadLeg (thigh) | 360 | 100 | 400 | 0.78 | 80 | 6 / M | [S: MTK K1 350–450/350–500 ×0.85; FD #17 leg 0.80] |
| `tech.kick_low_lead` | mid, long | rearLeg / leadLeg inner | 300 | 90 | 300 | 0.74 | 50 | 4 / M | [S: MTK K5] |
| `tech.kick_inside_low` | mid | leadLeg (inner thigh) | 330 | 90 | 360 | 0.76 | 60 | 5 / M | [E] |
| `tech.kick_calf` | long, mid | leadLeg (calf) | 270 | 90 | 300 | 0.83 vs square stance / 0.65 vs bladed | 50 | 4 / L-M | [S: MTK K7 0.60–0.70 / 0.45 → D with FD #17] |
| `tech.kick_oblique` | long, kick | leadLeg (knee) | 260 | 80 | 270 | 0.60 | 40 | 3 / L | [S: MTK K8 0.50 → D]; `obliqueKickLegal` |
| `tech.kick_body_rear` | long, kick | body | 400 | 110 | 450 | 0.55 | 100 | 9 / H | [S: MTK K2 0.45–0.55; FD #17 body] |
| `tech.kick_body_switch` | long, kick | body | 450 | 110 | 450 | 0.52 | 130 | 9 / H | [S: MTK K4 switch adds 100–150 ms] |
| `tech.kick_head_rear` | long, kick | head | 470 | 120 | 540 | 0.20 | 120 | 12 / H | [S: MTK K3 0.20–0.35 → D low end (FD head 0.31 includes punches)] |
| `tech.kick_head_switch` | long, kick | head | 500 | 120 | 540 | 0.19 | 140 | 12 / H | [S: MTK K4] |
| `tech.kick_question_mark` | long | head | 480 | 120 | 540 | 0.15 → 0.33 with setup | 100 → 50 | 12 / H | [S: MTK K6 0.15 → 0.35]; setup = ≥2 prior low-line kicks this bout |
| `tech.kick_front_snap` | long, kick | body | 300 | 80 | 320 | 0.50 | 60 | 5 / M | [E]; optional (karate/TKD) |
| `tech.kick_side` | kick | body | 380 | 100 | 450 | 0.40 | 120 | 9 / H | [E]; optional |
| `tech.kick_spinning_back` | kick | body | 540 | 120 | 630 | 0.25 | 200 | 12 / H | [S: MTK S1 0.25]; optional |
| `tech.kick_wheel` | kick | head | 600 | 120 | 700 | 0.15 | 220 | 15 / H | [E]; optional |
| `tech.kick_axe` | kick | head / body | 500 | 110 | 600 | 0.20 | 200 | 12 / H | [E]; optional |

#### 2.2.3 Table B — force inputs, follow-ups, defences

`F_med` = median delivered force (N) of a **flush, committed, unfatigued T4** landing; `F_cap` = hard ceiling (N);
`v_ref` = weapon speed at impact (m/s); `m_eff` = effective mass as fraction of body mass; `rot` = rotational factor
relative to a straight punch of equal force (05 multiplies its `alphaEq` by it); `weapon` names the striking surface.
Force anchors: in-fight landed punches median ≈ 950 N, 64 % ≤ 1000 N, 88 % < 1500 N, 2–6 % ≥ 2000 N, max 5358 N
[S: LA §1.2 Pierce 2006]; lab maxima elite rear straight 4800 N, lead 2847 N [S: LA §2 Smith 2000]; Olympic straight
3427 N / 9.1 m/s / m_eff 2.9 kg / 6343 rad/s², hook 4405 N / 11.0 m/s / 9306 rad/s² [S: LA §2 Walilko, Viano];
elite jab 1508 N at 7.2 m/s [S: LA §2 Liu 2022]; elite hook/uppercut 3.0–3.2 kN [S: BOX §7.4 PMC7739747]; MT
roundhouse 1400 ± 419 N on a pad, 7.2 m/s at impact, 1.02 s onset→impact with step [S: LA §2 Gavagan 2017]; low kick
≈ 1850 N in-match [S: MTK §7.1]; roundhouse literature range 172–6400 N, front kick 466–7790 N, side kick to 9015 N
[S: MTK §7.1 review]; knee ≈ 8242 N (provisional) [S: MTK §7.1]. `F_med` for punches is derived so that the placement
mix of §2.6.3 reproduces the Pierce distribution (shown once in §2.6.4); every other `F_med` is [E] anchored on the
lab numbers above; all `rot` values [E] except hook (1.5× straight RA [S: LA §2 Viano]).

| id | F_med | F_cap | v_ref | m_eff | rot | weapon | Follow-up options | Beaten by (defence ids) |
|---|---|---|---|---|---|---|---|---|
| `tech.jab` (all jab variants unless noted) | 900 | 2850 | 7.2 | 0.030 | 1.0 | fist | cross, lead hook, body jab, low kick (Dutch), level change (03), teep | `def.catch`, `def.parry`, `def.slip_out`, `def.slip_in`, `def.pull`, `def.block_high`, `guard.long` |
| `tech.jab_power` | 1150 | 2850 | 7.6 | 0.034 | 1.0 | fist | cross, lead hook | as jab + `def.shoulder_roll` weak |
| `tech.jab_body` | 850 | 2500 | 7.0 | 0.030 | 0.5 | fist | jab head, lead hook head, overhand | `def.elbow_tuck`, `def.step_back`, `def.pull`, `def.knee_intercept` (MMA) |
| `tech.cross` | 1400 | 4800 | 7.8 | 0.038 | 1.0 | fist | lead hook, lead uppercut, rear low kick, single-leg (03) | `def.slip_out`, `def.parry`, `def.shoulder_roll`, `def.pull`, `def.block_high`, `def.catch` (lead hand) |
| `tech.cross_body` | 1300 | 4000 | 7.5 | 0.038 | 0.5 | fist | lead hook head, lead uppercut | `def.elbow_tuck`, `def.pivot`, `def.pull` |
| `tech.cross_shift` | 1600 | 4800 | 8.2 | 0.045 | 1.0 | fist | hook from new stance | `def.step_off`, `def.pull` |
| `tech.hook_lead` | 1500 | 4400 | 11.0 | 0.036 | 1.5 | fist | cross, rear uppercut, rear hook, body hook, body lock (03) | `def.roll`, `def.block_high`, `def.lean_back`, `def.step_in_smother`, `def.catch` (rear hand) |
| `tech.hook_rear` | 1600 | 4400 | 11.2 | 0.040 | 1.5 | fist | lead hook, lead uppercut | `def.roll`, `def.block_high`, `def.lean_back`, `def.step_in_smother`, `def.duck` |
| `tech.hook_lead_body` / `tech.hook_liver` | 1400 | 4000 | 10.0 | 0.036 | 0.4 | fist | lead hook head (3b-3), rear uppercut, cross | `def.elbow_tuck`, `def.step_back`, `def.frame`, `def.clinch_up` |
| `tech.hook_rear_body` | 1500 | 4000 | 10.0 | 0.040 | 0.4 | fist | lead hook head | `def.elbow_tuck`, `def.pivot` |
| `tech.shovel_hook` | 1200 | 3500 | 9.5 | 0.034 | 1.1 | fist | rear uppercut, elbow | `def.elbow_tuck`, `def.clinch_up`, `def.frame` |
| `tech.uppercut_lead` | 1450 | 3250 | 10.2 | 0.034 | 1.2 | fist | cross, rear hook, lead hook (5-2, 5-3) | `def.catch` (rear hand), `def.step_back`, `def.pull` (upright), `def.frame` |
| `tech.uppercut_rear` | 1500 | 3250 | 10.2 | 0.038 | 1.2 | fist | lead hook (6-3) | `def.catch` (lead hand), `def.lean_back`, `def.frame`, `def.clinch_up` |
| `tech.uppercut_body` | 1300 | 3000 | 9.5 | 0.034 | 0.4 | fist | rear uppercut head, hook | `def.elbow_tuck`, `def.frame` |
| `tech.overhand` | 1550 | 4400 | 10.5 | 0.045 | 1.4 | fist | lead hook, level change double (03), clinch | `def.duck`, `def.roll`, `def.lean_back`, `def.step_off` (outside lead foot), `def.catch` (lead), `def.block_high` partial (−0.3 logit) |
| `tech.check_hook` | 1300 | 4400 | 11.0 | 0.034 | 1.5 | fist | cross on the pivot, exit on angle | stop the charge; `feint.step` (bait the pivot) |
| `tech.bolo` | 1300 | 3500 | 9.0 | 0.036 | 1.2 | fist | — | `def.step_off`, straight counters |
| `tech.superman_punch` | 1500 | 4400 | 9.0 | 0.050 | 1.0 | fist | low kick | `def.step_back`, `def.parry`, single-leg (03) |
| `tech.spinning_backfist` | 1300 | 4000 | 12.0 | 0.030 | 1.6 | back of fist | — | `def.step_in_smother`, `def.step_back`, takedown (03) |
| `tech.elbow_*` (horizontal, diagonal, upward) | 1400 | 4400 | 8.0 | 0.045 | 1.4 | elbow | second elbow, knee, clinch entry | `def.block_high` (forearm), `def.frame`, `def.step_back`, `def.lean_back`, `def.clinch_up` |
| `tech.elbow_downward` | 1600 | 4400 | 7.0 | 0.055 | 1.2 | elbow point | knee | `def.frame`, posture up, level change (03) |
| `tech.elbow_spinning` | 1800 | 5000 | 11.0 | 0.055 | 1.6 | elbow | — | `def.step_back`, `def.step_in_smother`, takedown (03) |
| `tech.knee_straight` / `tech.knee_intercepting` | 2200 | 8200 | 6.5 | 0.10 | 1.5 (head) / 0.5 (body) | knee | elbow, clinch entry (03) | `def.forearm_block_kick`, `def.step_off`, `def.frame`, `def.kick_catch` (knee catch → dump), takedown (03) |
| `tech.knee_flying` | 2600 | 8200 | 7.5 | 0.14 | 1.5 | knee | — | `def.step_off`, `def.block_high`, takedown on landing (03) |
| `tech.teep_lead` / `tech.teep_stop` | 1500 | 7800 | 5.5 | 0.15 | 0.4 | ball of foot | cross, low kick, jab | `def.parry_down_teep`, `def.step_off`, `def.kick_catch` |
| `tech.teep_rear` | 1900 | 7800 | 6.0 | 0.18 | 0.4 | ball of foot | cross, body kick | `def.parry_down_teep`, `def.kick_catch`, `def.step_off` |
| `tech.teep_face` | 1500 | 5000 | 6.5 | 0.12 | 1.2 | ball of foot | — | `def.parry_down_teep`, `def.step_off`, `def.kick_catch` |
| `tech.kick_low_rear` | 1700 | 6400 | 7.2 | 0.12 | n/a | shin | cross (leg committed), rear hand, low kick again | `def.check`, `def.step_back`, `def.step_in_smother`, `def.knee_raise_block` |
| `tech.kick_low_lead` / `tech.kick_inside_low` | 1200 | 5000 | 6.5 | 0.10 | n/a | shin | cross, hook | `def.check`, `def.step_back` |
| `tech.kick_calf` | 1300 | 5000 | 7.0 | 0.09 | n/a | shin | cross, overhand, calf kick again | `def.check` (short window), `def.step_back`, `move.switch_stance`, lead-leg retract |
| `tech.kick_oblique` | 1200 | 5000 | 5.5 | 0.12 | n/a | ball of foot | jab, cross | `def.check` (knee raise), `move.switch_stance`, `def.step_back` |
| `tech.kick_body_rear` / `tech.kick_body_switch` | 1600 | 6400 | 7.2 | 0.13 | 0.5 | shin | punch over the kick, return kick | `def.forearm_block_kick`, `def.kick_catch`, `def.step_in_smother`, `def.teep_jam`, `def.step_back` |
| `tech.kick_head_rear` / `tech.kick_head_switch` / `tech.kick_question_mark` | 1500 | 6400 | 7.5 | 0.12 | 1.7 | shin / instep | punch as hip opens (for defender), clinch | `def.forearm_block_kick`, `def.lean_back`, `def.step_in_smother`, `def.duck_under` (MMA), `def.block_high` |
| `tech.kick_front_snap` | 1400 | 6000 | 7.0 | 0.11 | 0.6 | ball of foot | cross | `def.parry_down_teep`, `def.step_off` |
| `tech.kick_side` | 2200 | 9000 | 7.0 | 0.16 | 0.5 | heel / blade | — | `def.step_off`, `def.forearm_block_kick` |
| `tech.kick_spinning_back` | 2500 | 9000 | 8.0 | 0.18 | 0.8 | heel | — | `def.step_off` (to spin side), `def.forearm_block_kick`, punch the back (§2.5) |
| `tech.kick_wheel` / `tech.kick_axe` | 1600 | 6400 | 9.0 | 0.12 | 1.7 | heel | — | `def.step_in_smother`, `def.step_off`, `def.block_high` |

#### 2.2.4 Technique-specific effects (beyond force)

- **Teeps** on contact push the target back one band with P = 0.70 (lead) / 0.85 (rear) and cost the target 1 / 2
  balance-tier steps (−5 / −10 balance points); pressure momentum (`state.cutoff`) resets [S: MTK §8.10; balance
  points E]. `tech.teep_stop` as a counter to a step-in cancels the opponent's action and costs them 10 balance
  [S: MTK §8.11 P = 0.55 if read].
- **Calf kick**: damage goes to region `leadLeg` sub-location `calf`; the neurological "dead leg" roll is owned by
  05 (DP §2.3: 5 % per clean landing) — this section passes `subLocation = calf` and `placement`.
- **Oblique kick**: region `leadLeg`, sub-location `knee`; acute joint-event roll owned by 05.
- **Liver shot** (`tech.hook_liver`, `tech.shovel_hook` to body.liver, rear body kick to the open side in open
  stance): passes `subLocation = liver`; the delayed collapse is owned by 05 (DP §2.2).
- **Flicker jab** touch (not clean) sets `state.vision_blocked` on the target for 300 ms: their read `−0.40` logit
  [E; S: BOX §2 #5 vision-blocking].
- **Question-mark kick** is only selectable when `lowLineKicksThisBout ≥ 2` [S: MTK §2 K6]; with setup its telegraph
  halves and P_land rises to 0.33.
- **Switch kicks** (`*_switch`) expose the switch: the defender may `def.teep_jam` the switch at 0.40 if read
  [S: MTK §8.7], and any punch thrown by the defender during the 100–150 ms switch gets `+0.45` logit [S: MTK §2 K4
  "visible tell"; magnitude E].
- **Spinning techniques**: while spinning (startup) the attacker's back is to the opponent: any strike or takedown by
  the defender in that window gets `+0.60` logit and is `unseen` [E; S: MTK E5/S1 "punch the exposed back"].
- **Elbows** carry the cut channel: 05 owns `P(cut)`; this section marks `weapon = elbow` and `subLocation`.
- **Checked kicks** create a self-damage `StrikeImpact` on the kicker's shin (region `rearLeg`/`leadLeg` of the
  kicking leg, `weapon = shin_on_knee`, force = 0.6 × delivered) [S: DP §2.3 attacker takes 60 %]; the kicker's
  `shin` pool (05) drives the observed drop in kick output [S: MTK §5.2].

#### 2.2.5 Boxing-glove and ruleset modifiers

Applied when `gloveType = boxing` (8–12 oz). Rationale: bigger gloves block more and are counted differently
(CompuBox counts range-finding jabs thrown). Targets: jab 17–20 %, power 35–36 %, total 28–29 % [S: FD §2.6; BOX §7.1].

| Modifier | Value | Tag |
|---|---|---|
| `p.strike.glove.boxing.jabLogit` | `−0.60` logit on `tech.jab*` P_land | [D] logit(0.19) − logit(0.30) |
| `p.strike.glove.boxing.powerLogit` | `+0.30` logit on head power punches | [D] logit(0.36) − logit(0.29) |
| `p.strike.glove.boxing.blockLogit` | `+0.90` logit on `def.block_high`, `def.catch`, `def.parry` success | [D] logit(0.80) − logit(0.62); S: MIS §2.4 "block ×0.67 in MMA", BOX §4 "guard 30–40 % less effective in MMA" |
| `p.strike.glove.boxing.blockPassthrough` | 0.35 of force passes a successful block (MMA 0.55) | [S: BOX §3 D1 30–50 % / 50–60 %] |
| `p.strike.glove.boxing.rotFactor` | `× 0.87` on `rot` (MMA glove = ×1.0; 05 also applies its own glove term — do not double count: this section passes `gloveType` and leaves the KO coefficient to 05) | [S: LA §2 Bartsch 2012 MMA glove ↑ rotational dosage; magnitude E] |
| `p.strike.glove.boxing.cutMult` | passed as `gloveType` to 05 | — |
| Kicks/knees/elbows | unavailable under boxing ruleset; elbows unavailable under `kb` | [S: MTK §9] |
| `kickCatchRule` | `mt`: ≤2 forward steps, sweeps legal; `kb`: one strike then release; `mma`: any takedown | [S: MTK §3.1] |

### 2.3 Combination grammar

#### 2.3.1 Chain rules

1. **Flow rule.** A chain is legal when consecutive strikes alternate hands/legs, or repeat the same limb only with a
   hip reload (`+100` ms startup, `−0.50` logit on the repeat) [S: BOX §5 flow rules; §8 B6 −0.10 p / +100 ms → D].
   The recovery position of strike *n* must be the launch position of strike *n+1* (encoded as `flowsTo` lists on each
   technique; the tables in §2.2.3 "Follow-up options" are that list).
2. **Overlap.** Strike *n+1* may launch when strike *n* has completed `p.strike.combo.overlap = 0.40` of its recovery
   [E]. Check against the measured 4-action combo of 851 ms [S: BOX §7.4]: 1-2-3-2 = 130+60 + (210−0.6·150) + 70 +
   (190−0.6·290) + 70 + (210−0.6·260) + 70 ≈ 780 ms [D] — within the anchor.
3. **Per-step bonus.** The 2nd and 3rd strike of a legal chain get `+0.24` logit each, cumulative, cap `+0.48`,
   *only* if the chain moves the guard as encoded (`1-2 → 3` narrows the guard and opens the hook; `1-3 → 2` widens
   it and opens the middle) [S: BOX §5, §8 B6 +0.05 p each cap +0.15 → D]. Chains without a guard-moving relation get
   the flow but no bonus.
4. **After a landed jab** the next strike in the same chain gets `+0.48` logit; after a *defended* jab that moved the
   defender's hand (catch/parry/block) `+0.24` [S: BOX §8 B5 → D].
5. **Body–head window.** A landed body strike lowers the target's guard for `p.strike.combo.bodyHeadMs = 600` ms:
   head strikes `+0.48` logit; a landed head strike raises the elbows: body strikes `+0.48` for 600 ms [S: BOX §8
   B9 → D]. A body `structural ≥ 40` (05) makes the guard drop persistent: head kicks `+0.45` logit [S: MTK §5.3].
6. **Dutch gate (punch → kick).** A low/body kick launched within `p.strike.combo.dutchMs = 300` ms of a punch
   (landed or blocked) gets `+0.45` logit and the defender's read of the kick `−0.15` (absolute on P(read)) — hands
   are occupied, weight is on the lead leg [S: MTK §8.3–4, D1: +0.10 p / −0.15 read]. Check probability, if the read
   still succeeds, is halved because the hands are up [E].
7. **Kick → punch.** A punch launched within 300 ms of a *landed* kick gets `+0.24` logit (defender absorbing /
   re-planting) [E]; after a *checked* kick the kicker's next action is delayed by the recovery and the defender's
   follow-up punch gets `+0.50` (kicker re-planting) [S: MTK §8.13 +0.10 p → D].
8. **Length cap by tier** (`p.strike.combo.cap[tier]`): T0 2, T1 3, T2 3, T3 4, T4 5, T5 6 [E; direction S: BOX §6
   "available techniques"]; vs an opponent with `wrestling ≥ own TD defence + 1 tier` the AI caps at 3 [S: MIS S-4].
9. **Illegal chain** (same hand, no reload; wrong launch position): `−0.50` logit and `+100` ms on the offending
   strike; T0–T1 attempt illegal chains 30 % / 15 % of the time [E].
10. **Rhythm** (§2.3.5) is tracked per exchange from the inter-launch intervals.

#### 2.3.2 Named chains (07 selects by weight; all legal; numbering 1 jab, 2 cross, 3 lead hook, 4 rear hook,
5 lead uppercut, 6 rear uppercut, `b` body, `L` rear low kick, `K` body kick, `H` head kick, `E` elbow, `N` knee,
`T` teep, `F` feint, `S` slip, `P` pivot)

| id | Chain | Guard-moving bonus steps | Min tier | Tag |
|---|---|---|---|---|
| `combo.1_1` | 1-1 | 2nd | T0 | [S: BOX §5 basic] |
| `combo.1_2` | 1-2 | 2nd | T0 | [S: BOX §5] |
| `combo.1_1_2` | 1-1-2 | 2nd, 3rd | T1 | [S: BOX §5] |
| `combo.1_2_3` | 1-2-3 | 2nd, 3rd | T1 | [S: BOX §5] |
| `combo.1_2_3_2` | 1-2-3-2 | 2nd, 3rd | T2 | [S: BOX §5] |
| `combo.2_3_2` | 2-3-2 | 2nd, 3rd | T2 | [S: BOX §5] |
| `combo.1_2_5_2` | 1-2-5-2 | 2nd, 3rd | T2 | [S: BOX §5] |
| `combo.1b_2` | 1b-2 | 2nd (body-head) | T2 | [S: BOX §5] |
| `combo.1_2b` | 1-2b | 2nd | T2 | [S: BOX §5] |
| `combo.1_2b_3` | 1-2b-3 | 2nd, 3rd | T2 | [S: BOX §5 set-up chains] |
| `combo.3b_3` | 3b-3 (liver → head) | 2nd | T2 | [S: BOX §5] |
| `combo.2b_2` | 2b-2 (reload) | 2nd | T3 | [S: BOX §5 "requires hip reload"] |
| `combo.1_6_3` | 1-6-3 | 2nd, 3rd | T2 | [S: BOX §5] |
| `combo.3b_6` | 3b-6 | 2nd | T3 | [S: BOX §5] |
| `combo.F1_2` | F1-2 | feint (§2.3.4) | T2 | [S: BOX §5] |
| `combo.F2_3` | F2-3 | feint | T2 | [S: BOX §5] |
| `combo.1_F2_3` | 1-F2-3 | 2nd + feint | T3 | [S: BOX §5] |
| `combo.1_2_P` | 1-2-P (exit on angle) | 2nd | T2 | [S: BOX §5] |
| `combo.1_P_3` | 1-P-3 | 3rd from new angle (+0.30 angle bonus §2.1.3) | T3 | [S: BOX §5] |
| `combo.1_2_S_3` | 1-2-S-3 (delayed counter) | 2nd; 3rd is a counter (§2.5.4) | T3 | [S: BOX §5] |
| `combo.1_2_L` | 1-2-L (Dutch) | 2nd; kick gets Dutch gate | T2 | [S: MTK D1] |
| `combo.1_L` | 1-L | Dutch gate | T1 | [S: MTK §8.23] |
| `combo.2_3_L` | 2-3-L | 2nd; Dutch gate | T2 | [S: MTK D1 "liver hook → low kick" family] |
| `combo.3b_L` | 3b-L (liver hook → low kick) | Dutch gate | T3 | [S: MTK D1] |
| `combo.1_2_K` | 1-2-K | 2nd; Dutch gate | T2 | [E] |
| `combo.1_T` | 1-T | none (range reset) | T1 | [E] |
| `combo.T_2` | T-2 | kick→punch +0.24 | T2 | [E] |
| `combo.L_2` | L-2 | kick→punch +0.24 | T2 | [S: MTK §2 K1 "straight punch as kick lands" inverted for attacker; E] |
| `combo.calf_2` | calf-2 | kick→punch +0.24 | T2 | [E] |
| `combo.1_2_N` | 1-2-N (Thai) | 2nd | T3 | [E] |
| `combo.3_E` | 3-E (hook → elbow, close) | 2nd | T3 | [E] |
| `combo.1_2_E` | 1-2-E | 2nd, 3rd | T3 | [E] |
| `combo.1_2_switchK` | 1-2-switch body kick | 2nd; Dutch gate | T3 | [E] |
| `combo.1b_overhand` | 1b-overhand (body jab lifts the hands) | 2nd (body-head) | T3 | [S: BOX §2 #7 note] |
| `combo.Flevel_6` | F(level change)-6 / -N | feint-level | T3 | [S: MIS I-6] |

#### 2.3.3 Common technique mix targets (for 07 and calibration)

Kickboxing/MMA striker default mix ≈ 63 % punches / 37 % kicks+knees, 57 % head-targeted [S: LA §1.3 Slimani 2017];
UFC share of significant attempts head 77 % / body 13.5 % / leg 9 % [S: FD #20]; jabs ≈ 40–45 % of boxing punches
thrown [S: BOX §8 F23]. 07 owns the weights; §5 lists the resulting calibration rows.

#### 2.3.4 Feints

A feint is an action with `startup 80–150 ms`, no contact phase, `recovery 100 ms`, negligible stamina [S: BOX §5
feints]. It targets the defender's **read process** (§2.4.3): the defender rolls a *bite*; on a bite the defender
executes the reaction the feint sells, which opens the follow-up.

| id | Cue | Sells | Reaction drawn on bite | Opening created (on bite, for `p.strike.feint.windowMs = 400` ms) | Tag |
|---|---|---|---|---|---|
| `feint.jab` | shoulder/hand twitch | jab | `def.catch` / `def.parry` / `def.pull` | rear hand `+bonus`, hook around the parry `+bonus` | [S: BOX §5] |
| `feint.rear_hand` | hip/shoulder load | cross/overhand | `def.shoulder_roll` / `def.block_high` / `def.slip` | lead hook `+bonus`, body `+bonus` | [S: BOX §5] |
| `feint.level_change` | knees bend, head drops | body punch or shot | sprawl posture / hands drop (`state.sprawl_ready`) | `tech.uppercut_*`, `tech.knee_intercepting`, `tech.overhand` `+0.70` logit | [S: MIS I-6 +15–25 % → D; BOX §5 "takedown feint pulls the hands down"] |
| `feint.step` | foot stomp / half step | step-in strike | `def.pull` / `def.step_back` / check hook attempt | step-in strike after the reaction `+bonus`; draws the check hook early (attacker can then counter the counter) | [S: BOX §5] |
| `feint.kick` | hip turn / knee lift | round kick | `def.check` (single-leg 250 ms) | punches `+0.50` logit while the defender is on one leg; takedown `+0.65` (03) | [S: MTK §8.13; §3 "opponent feints the kick"] |
| `feint.teep` | lead knee lift | teep | `def.parry_down_teep` / `def.step_off` | cross over the dropped hand `+bonus` | [E] |
| `feint.eyes` | look at target | strike to looked-at region | guard shifts to that region | strike to the *other* region `+bonus` | [S: BOX §5 "look-away/eye feint"; E] |
| `feint.shoulder_roll_bait` (T4+) | offer the roll | opponent's rear hand | opponent throws | counter window (§2.5) | [E] |

Bite probability by **defender** tier (`p.strike.feint.bite[tier]`): T0 0.65, T1 0.60, T2 0.50, T3 0.40, T4 0.30,
T5 0.22 [D from LB §4.5: novice ≈ 0.6, expert ≈ 0.25; intermediate interpolated]. Modified by: attacker
`striking.feints` (`+1.5 × (skill − 50)/100` logit), same feint repeated within 20 s without a strike (`−0.7` logit
per repeat, habituation) [E], defender `state.vision_blocked` (`+0.4`), defender fatigue (`+0.5·f`) [E].

**Bonus on the follow-up** (`p.strike.feint.bonus[defenderTier]`): `+0.40` logit vs T0–T2, `+0.20` vs T3, `+0.10` vs
T4–T5 [S: BOX §8 B7 +0.08 / +0.04 / +0.02 p → D]; the level-change feint's `+0.70` replaces this. On a bite the
defender's **read is suppressed** for the follow-up (reaction only, §2.4.3) — that is why the bonus is small at high
tiers: experts do not bite, and when they do they still have reflexes. A feint the defender does *not* bite on
costs the attacker nothing except tempo, but the third consecutive feint without a strike gives the defender a free
`ctr.counter_jab` roll at 0.30 [S: BOX §8 B7]. The first feint of an exchange also writes the defender's reaction
into the attacker's opponent model (07): "first feint is information, second is the set-up, third is when you go"
[S: BOX §5].

#### 2.3.5 Rhythm and broken rhythm

Exchange cadence at pro level is ≈ 1 action per 400–700 ms [D: BOX §5 from cycle times 442/667 ms]. The engine keeps
each fighter's last three inter-launch intervals; a launch is **on-beat** if within ±15 % of the running mean and
**half-beat** if at 40–60 % or 140–160 % of it [E]. A half-beat launch after ≥ 2 on-beat actions sets
`state.broken_rhythm`: the strike gets `+0.30` logit and the defender's *anticipatory* (pre-committed, §2.4.3)
defences fail automatically for that action; guard-based defences still roll [S: BOX §8 B8 +0.06 p → D]. Available
from T4 (`striking.feints ≥ 70`) [S: BOX §8 H31 "Elite: rhythm breaking"]. Conversely, a fighter who has been on-beat
for ≥ 4 actions is *readable*: the defender's pattern read gets `+0.30` logit [E].

#### 2.3.6 Level changes off strikes (hand-off to 03)

`tech.jab` and `tech.cross` landed or blocked set `state.jab_setup` / `state.cross_setup` for 0.8 s / 0.6 s;
`tech.hook_lead` that carries the attacker inside `range.close` sets `state.hook_bodylock_window` for 0.4 s
[S: MIS I-2, I-3, I-4 timing windows]. 03 reads these flags for its set-up bonuses (+10–15 pts jab→double etc.).
`move.level_change` without a strike is readable at telegraph 120 ms [E] and, if read, draws `def.sprawl_posture`
or `tech.knee_intercepting`.

### 2.4 Defence layer

Defence is **reactive, not pre-chosen**. Two layers exist: a continuous *guard posture* (always in effect, no roll)
and a *reactive defence* selected per incoming strike **only when the defender has read the strike in time**
(§2.4.3). The old `DefenseKind` posture roll is retired.

#### 2.4.1 Guard postures (positional; switching costs 200 ms, no stamina)

Effects are logits added to the **attacker's** strike (negative = defended) when no reactive defence fires, plus
posture-level costs. Base P_land already assumes `guard.standard`; the matrix is relative to it [S: BOX §8 C11
guard-type matrix in p-points → D at p ≈ 0.30; MMA-glove scaling S: MIS §2.4].

| id | Description | Straights head | Hooks head | Uppercuts | Overhand | Body | Head kicks | Low/calf kicks (check speed) | Vision / read | Other |
|---|---|---|---|---|---|---|---|---|---|---|
| `guard.standard` | hands at cheek/chin, elbows in | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | reference |
| `guard.high` | gloves on forehead, elbows tight, forward | −0.35 | −0.35 | +0.35 | −0.20 | +0.45 | −0.30 | +0.10 (slower checks) | read −0.30 | passive block roll (§2.6.1) `+0.6` logit; stamina +10 % under fire [E] |
| `guard.long` | lead arm extended into opponent | −0.20 | +0.20 (around the frame) | +0.35 | −0.40 | +0.10 | −0.10 | 0 | 0 | lead hand unavailable for jab; eye-poke foul risk 0.3–0.6 %/s [S: MIS §2.4]; measures range: opponent's step-in strikes −0.30 [S: BOX §3 D10] |
| `guard.philly` | lead shoulder up, rear hand at chin, bladed | −0.60 (same stance) / +0.40 (open stance) | +0.60 (lead hook) | +0.10 | −0.30 | +0.30 | +0.20 | +0.10 | 0 | enables `def.shoulder_roll`; requires `b ≥ 0.5`, `boxing.headMovement ≥ 60`; "hundreds of rounds" [S: BOX §3 D9] |
| `guard.low_hands` | hands low/loose, upright (Thai/MMA counter stance) | +0.50 | +0.50 | +0.10 | +0.40 | −0.10 | +0.10 | −0.20 (checks faster) | read +0.20 (better vision) | enables `tech.jab_up`; pull/lean defences +0.20 [E] |
| `guard.peekaboo` | gloves on cheeks, elbows in, constant bob | −0.35 | −0.10 | +0.10 | −0.10 | +0.35 | −0.20 | +0.10 | 0 | stamina +15 %; enables 6-4 body-uppercut chains [S: BOX §3 D11] |
| `guard.cross_arm` | forearms folded across | −0.20 | −0.35 | +0.50 | −0.30 | −0.10 | −0.10 | +0.10 | read −0.20 | mobility −10 %; slow to counter (counter bonus halved) [S: BOX §3 D12] |
| `guard.square_wrestler` | hands mid, wide square base | +0.30 | +0.20 | 0 | +0.20 | +0.10 | 0 | +0.20 (heavy lead leg) | 0 | TD defence bonus owned by 03; calf-kick target exposed [S: MTK §1.4] |
| `guard.cover_turtle` (T0–T1 default under fire) | both arms wrapped, chin down, turned away | −0.30 | −0.30 | +0.60 | −0.20 | +0.60 | −0.20 | +0.20 | read −0.60 | no counters; referee attention (06); "eyes closed" tells §3 |

#### 2.4.2 Reactive defences

Columns: **Exec** = time the defence needs from decision to being in place (the *reaction window* it must fit in,
§2.4.3); **Success** = P(defence works | strike would have arrived, read succeeded, strike is in the defence's "vs"
list) for T4 vs T4 unfeinted, MMA gloves; **k** = logit per 100 sub-skill points of (defender sub-skill − attacker's
technique sub-skill); **On success** = strike outcome and absorb fraction passed to 05 (DP §3.3 vocabulary);
**Counter** = counter window quality created (§2.5); **Cost**. Sources: BOX §3 D1–D15 (boxing-glove, competent
defender) and MTK §3 (T2 vs T2); MMA re-anchoring per MIS §2.4 (block ×0.67 → −0.90 logit) and FD accuracy
matrix; every Success value is [D] from those unless tagged [E].

| id | vs (strike families) | Weak vs | Exec ms | Success (MMA) | k / sub-skill | On success | Counter created | Cost / risk |
|---|---|---|---|---|---|---|---|---|
| `def.block_high` | hooks, overhand, cross, elbows (head) | body, uppercuts, kicks, takedowns | 120 | 0.62 (boxing 0.80) | 1.5 / `boxing.guard` | `blocked`, absorb 0.45 (MMA) / 0.65 (boxing); 40 % of absorbed → `arms` (05) | small: block → hook `+0.24` | vision −; stamina; blocked strikes that move the head count as landed-partial (stat) with P 0.30 [E] |
| `def.forearm_block_kick` | body kicks, head kicks, knees | low kicks, takedowns | 150 | 0.58 body / 0.52 head | 1.5 / `kickboxing.checks` | `blocked`, absorb 0.65; 25–40 % of raw to `arms` pool | small: block → return kick `+0.24` | cannot punch during block; arm fatigue [S: MTK §3] |
| `def.parry` | jab, cross, straight body punches | hooks, uppercuts, feints | 100 | 0.62 | 2.0 / `boxing.guard` | `evaded`, 0 damage | **large**: parry → cross over the top `+0.70`, parry → jab `+0.50` | parrying a feint = hand off chin (`−0.40` for 400 ms) [S: BOX §3 D2] |
| `def.catch` | jab (rear palm), lead uppercut (rear hand), rear uppercut (lead hand) | everything else | 90 | 0.70 | 1.5 / `boxing.guard` | `blocked`, absorb 0.85 | medium: catch → jab / cross `+0.50` | low [S: BOX §3 D3] |
| `def.slip_out` | jab, cross | hooks (slip into them), feints, knees/head kicks (MMA) | 150 | 0.55 | 2.5 / `boxing.headMovement` | `evaded` | **very large**: slip-out jab → cross `+0.90`; slip-out cross → lead hook (`ctr.cross_counter`) `+0.90` | fail → placement shifts flush `+0.15` and attacker's next strike `+0.48`; MMA: head off-line → opponent's knee/head kick `+0.50` for 400 ms [S: BOX §3 D4; §8 C10, C12] |
| `def.slip_in` | jab | the cross that follows | 150 | 0.48 | 2.5 / `boxing.headMovement` | `evaded` | large: → body cross / lead hook `+0.70` | riskier than outside slip [S: BOX §3 D5] |
| `def.roll` (weave) | lead/rear hook, overhand | uppercuts, knees, straights | 220 | 0.55 | 2.5 / `boxing.headMovement` | `evaded` | large: roll → hook / cross on the way up `+0.70` | eyes off target 200 ms (read −0.5 for next strike); stamina; MMA: opponent may substitute knee `+0.70` [S: BOX §3 D6; §8 C12] |
| `def.duck` | hooks, overhand, high straights | uppercuts, knees, smother | 180 | 0.50 | 2.0 / `boxing.headMovement` | `evaded` | medium: duck → cross to body `+0.50` | chin drops, balance forward [S: BOX §3 D7] |
| `def.pull` (lean-back) | jab, cross, hook at long range | step-in strikes, low kicks, takedowns | 150 | 0.58 at long / 0.35 at mid | 2.5 / `boxing.headMovement` | `evaded` | **large**: pull → cross (`ctr.pull_counter`) `+0.90`, pull → lead hook `+0.70` | weight on rear foot; unavailable `cage.fence`; if attacker steps in, defender eats it chin-up (placement flush +0.15) [S: BOX §3 D8] |
| `def.shoulder_roll` | rear straight, rear overhand (same stance) | lead hook, long jab, body, open-stance straights | 140 | 0.60 (T2 ≈ 0.35 via k) | 3.0 / `boxing.headMovement` | `evaded` (10–20 % glancing → `glancing`) | **very large**: roll → rear straight / uppercut `+0.90` | requires `guard.philly`; `−0.85` logit in open stance [S: BOX §3 D9; §8 C11] |
| `def.lean_back` (sway) | head kick, question mark, elbows, spinning, teep to face | punches with step-in, low kicks | 200 | 0.45 | 2.0 / `boxing.headMovement` | `evaded`; kicker balance −10, back exposed 400 ms | large: counter kick / punch `+0.70` | over-lean → falls/eats follow-up; on fail head kick lands at 0.6 × force [S: MTK §3] |
| `def.check` | low kick, calf kick, oblique, lead-leg kicks | body/head kicks (check-high 0.30), punches while single-legged, takedowns | 180 (calf: 130) | 0.55 low / 0.35 calf / 0.30 body (check-high) | 2.0 / `kickboxing.checks` | `checked`: defender absorb 0.85 to `shin`; kicker self-damage 60 % of raw to own shin (§2.2.4); kicker balance −10 | medium: return kick/punch while kicker re-plants `+0.50` | single-leg 250 ms: attacker's punch `+0.50`, takedown `+0.65` (03); late check = kick lands on knee/ankle (placement `flush`) [S: MTK §3, §8.12–13] |
| `def.knee_raise_block` | body kick (with elbow), straight knee, low kick | punches | 180 | 0.45 body / 0.50 low | 2.0 / `kickboxing.checks` | `blocked`, absorb 0.70; kicker shin/foot self-damage 40 % | small | as check, slower return [S: MTK §3] |
| `def.kick_catch` | body kick (primary), teep, straight knee; head kick (discouraged) | low kicks (almost never), calf | 200 | 0.28 body kick / 0.35 teep / 0.10 head kick / 0.25 knee | 3.0 / `kickboxing.checks` (catcher) vs `kickboxing.roundKick` (kicker) | `caught` → post-catch tree §2.5.3; the kick still delivers absorb 0.4 to body on a caught body kick [E] | tree | fail → guard low: kicker's follow-up punch `+0.50` [S: MTK §3 catch 0.30 T2 / 0.45 T4-vs-T2 / 0.10 vs T4 → k = 3.0 D] |
| `def.teep_jam` | body kick, switch kick, flying knee, spinning techniques | punches | 250 (needs read of the wind phase) | 0.40 | 2.5 / `kickboxing.teep` | attacker's action cancelled, attacker balance −10, defender scores a clean `tech.teep_stop` | defender's follow-up `+0.50` | T2+; both strikes land if it fails [S: MTK §3, §8.7] |
| `def.step_back` | any single strike | step-in combos, double jab, cut-off | 200 | 0.65 punches / 0.50 low kick / 0.55 calf / 0.40 body kick | 2.0 / `boxing.footwork` | `evaded` (whiff); kicker balance −5 | small: back-step jab `+0.24` | gives ground (judging, 06); fails outright in `state.cutoff` (§2.1.4); unavailable on fence [S: BOX §3 D13; MTK §3] |
| `def.step_off` (pivot / L-step) | straight-line pressure, rear hand, step-in strikes | — | 300 | 0.60 | 2.5 / `boxing.footwork` | `evaded` + attacker gets `angleOff` (§2.1.3) | **large**: `ctr.check_hook`, jab off the pivot `+0.70` | needs space: `−1.0` on fence [S: BOX §3 D14] |
| `def.step_in_smother` | kicks, spinning techniques, wide hooks | knees, elbows on entry | 200 | 0.45 | 2.0 / `striking.cageCraft` | `landed_partial` at 0.4 × force (kick lands on thigh/upper body); defender enters `range.close`/clinch | clinch entry (03) `+0.50` | exposes to knees/elbows [S: MTK §3] |
| `def.frame` (stiff-arm / long-guard frame) | entries, overhands, elbows, straight knee | uppercuts inside, hooks around | 150 | 0.55 | 1.5 / `boxing.guard` | `evaded` (redirected) | medium: frame → cross `+0.50` | lead hand unavailable; boxing referees may call holding [S: BOX §3 D10] |
| `def.clinch_up` | everything at close range once locked | knees/TDs (MMA), referee break (boxing) | 300 | 0.60 vs a power puncher pressing in | 2.0 / `muayThai.clinch` (03) | hand-off to 03 | none until break | short punches/uppercuts land during the 300 ms at `+0.30` [S: BOX §3 D15; MTK §4] |
| `def.parry_down_teep` | teeps, front kicks | round kicks | 150 | 0.55 | 2.0 / `kickboxing.teep` | `evaded` (redirected), kicker turned (balance −5) | medium: punch or leg-catch window `+0.50` | low [S: MTK §3] |
| `def.elbow_tuck` | body punches, liver shot, body knee | head strikes in the same beat | 100 | 0.55 | 1.5 / `boxing.guard` | `blocked`, absorb 0.60 → `arms` | small | head guard opens: head strikes `+0.30` for 300 ms [E] |
| `def.duck_under` (MMA) | head kick, question mark, flying knee | knees (× 1.5 damage on fail), uppercuts | 250 | 0.40 | 2.0 / `mma.levelChangeDefence` | `evaded` → takedown entry with `+0.60` (03) | takedown | fail vs knee: `placement = flush`, `unseen` [S: MTK §3] |
| `def.sprawl_posture` | level change (03) | uppercuts, knees, overhand (`feint.level_change` bite) | 150 | owned by 03 | — | — | — | hands drop: head strikes `+0.50` for 400 ms [S: MIS I-6] |
| `def.flinch` (reflex, no read) | any strike with startup ≥ reaction latency | — | 100 | 0.25 (as `def.block_high` at `−1.6` logit) | 0.5 / `boxing.guard` | `blocked` absorb 0.30 | none | T0–T1 flinch = eyes closed (§3) |

#### 2.4.3 Reaction, anticipation and the read roll

The literature is unambiguous: simple reaction time does not separate tiers; **cue-based anticipation** does
[S: LB §4.2 Mori 2002; §4.1 Zhang 2022 meta-analysis: expert response accuracy 83.3 % vs 68.5 %, choice-RT SMD −1.0,
boxing −0.51]. Reaction only matters *inside its window*; everything faster than the window is defended by posture or
by prediction. Jab startup ≈ 130 ms is below any human reaction (≈ 200–250 ms) [S: BOX §7.5, §1.5] — so jabs are
defended positionally or by pattern reads, never by seeing them.

**Latency.** `RT_simple = reactionTimeMs` from 01 §2.2.1 (`225 − 0.65 × (reactionTime − 50)` ms: 50 → 225,
80 → 205, 95 → 196) [S: 01 §2.2.1; range anchored on 200–250 ms trained simple RT S: BOX §7.5]. **No tier term**
touches it [S: LB §4.2; 01 `beh.gen.simple_rt_untiered`]. Choice cost `+60` ms [E; the only measured choice RTs, LB
§4.7 ≈ 0.8–0.9 s on video, are not transferable]. Modifiers: fatigue `× (1 + 0.15·f)` [S: LB §4.7 +10–15 %];
`state.rocked` `× 1.15` [S: DP §2.1]; T0/T1 `+30` ms per tier below T2 on the *choice* cost only (decision, not
reflex) [S: BOX §8 C13]; stance-familiarity penalty `× 1.10` (§2.7) [S: MIS ST-5]; `state.vision_blocked` `+80` ms
[E]. Effective latency `L = RT_simple + 60 + modifiers`.

**Two reads, in order.**

1. *Pattern read* (before launch; uses 07's opponent model): P = `sigmoid(logit(readBase[tier]) + patternMods)`,
   where `patternMods` = `+0.30` if the attacker has been on-beat for ≥ 4 actions, `+0.60` if the attacker has thrown
   the same strike ≥ 3 times this round without variation [S: MTK §8.3 +0.15 → D], `+0.40` if the attacker has a
   recorded habitual entry (07), `−0.60` after a feint bite (§2.3.4). Success lets the defender **pre-commit** a
   defence for the predicted strike: it is in place at launch (no latency), succeeds at its base if the strike is the
   predicted one (or in the same family), and **fails automatically** if the actual strike is a different family, a
   feint, or `state.broken_rhythm` [S: BOX §8 B8, §5 "delayed counter"].
2. *Cue read* (at launch + telegraph): P = `sigmoid(logit(readBase[tier]) + 0.004 × telegraph_ms + 1.5 ×
   (striking.read − 50)/100 − feintSuppression − 0.5·f − hurtPenalty − 0.4·visionBlocked)` [E for slope terms;
   readBase D]. Success gives an **anticipation lead** `A = 80 + 0.6 × telegraph_ms` ms [E; S: LB §4.2 "50–100 ms
   earlier cue pickup"] and the defender may choose any reactive defence with `Exec ≤ startup + contact/2 +
   telegraph − (L − A)`. If no reactive defence fits, only posture and `def.flinch` apply.

`readBase[tier]`: T0 0.50, T1 0.58, T2 0.66, T3 0.74, T4 0.81, T5 0.87 [D from LB §4.1: novice 0.55–0.65,
intermediate 0.70–0.78, expert 0.80–0.88; largest step novice → intermediate]. Under pressure (opponent landed
≥ 3 strikes in the last 10 s, or `state.rocked`, or composure < 40): `hurtPenalty` = 0.65 logit for T0–T1, 0.40 for
T2–T3, 0.20 for T4–T5 [S: LB §4.3 novices −15 %, experts −5 % → D].

Worked example (jab vs T4, reactionTime 50): `L = 225 + 60 = 285`; cue read succeeds (0.81): `A = 80`; available
window = `130 + 30 + 0 − 205 = −45` ms → **no reactive defence**; the jab is resolved against posture. With a
pattern read (pre-commit `def.catch`), the catch is in place and rolls at 0.70. A cross (startup 210, telegraph 40):
window = `210 + 35 + 40 − 205 = 80` ms → nothing fits except a pre-committed defence or `def.flinch`; with the
attacker at T1 (telegraph +120, execution ×1.26 for punches): window = `265 + 44 + 160 − 205 = 264` → parry, slip,
pull, catch, block, shoulder roll all fit. This is the mechanism by which slow, telegraphed strikes become useless against experts
while remaining effective between novices [S: LB §4.2 sim implication].

**Counter-on-read.** When a read succeeds the defender may choose a counter *instead of or after* the defence
(§2.5) with P = `counterOnRead[tier]`: T0 0.05, T1 0.12, T2 0.25, T3 0.35, T4 0.50, T5 0.60 [D from LB §4.4:
novice 0.05, intermediate 0.25, expert 0.5]. 07 may override with style (pressure vs counter).

**Defence selection when several fit** (07 default policy): highest `Success × counterValue` subject to the "weak
vs" list of the likely follow-up (e.g. never `def.slip_in` a jab when a cross is loaded). T0–T1 pick `def.block_high`
/ `def.cover_turtle` 80 % of the time regardless [S: LB §4.4 beginners' automatic response is defence-shaped].

### 2.5 Counter system

#### 2.5.1 Counter windows

Every strike opens a window on the attacker after its contact phase [S: BOX §8 D14; MTK §8.2]:

| Attacker's strike outcome | Window length | Attacker's defence in window | Tag |
|---|---|---|---|
| missed / evaded | `recovery_ms × 1.0` | read `−0.50` logit; the striking hand/leg is away: strikes to that side `+0.30`; after a missed *kick* defence `−30 %` (all defence success `−0.60` logit) and balance −5 | [S: BOX §8 D14; MTK §8.2] |
| checked kick | `recovery_ms × 1.2` | as missed kick, plus `state.re_planting` (§2.4.2 check row) | [S: MTK §8.13] |
| blocked | `recovery_ms × 0.6` | read `−0.30`; hand away `+0.30` | [E] |
| landed | `recovery_ms × 0.4` | read `−0.15`; defence `−10 %` after a landed kick (`−0.20` logit) | [S: MTK §8.2] |

Inside the window the defender's strikes get: listed *best counter* for that attack `+0.70` logit, any other strike
`+0.24` [S: BOX §8 D14 +0.15 / +0.05 p → D], realised through `boxing.counters` (`k = 2.0` on the bonus: a T2
counter-puncher realises 60 % of it, a T5 120 % [E]).

**Simultaneous (intercepting) counters** resolve *before* the incoming strike when the counter's absolute contact time
is earlier; if the counter lands, the incoming strike is cancelled with P = 0.50 or its force halved (head
displaced) [S: BOX §8 D15; split E]. They require a cue read (§2.4.3) and a counter whose `startup ≤ remaining
time to the attacker's contact`.

**Pre-emptive counters** ("the straight beats the hook if thrown first"): when the defender reads a hook/overhand
wind-up, `tech.jab`/`tech.cross` launched in the window count as simultaneous counters with `+0.50` [S: BOX §2 #9–10].

#### 2.5.2 Counter matrix

| id | Trigger (attacker's strike) | Defence + counter | Bonus (logit) | Min tier | Notes / tag |
|---|---|---|---|---|---|
| `ctr.counter_jab` | jab | intercept with jab (simultaneous) | +0.50 | T1 | [S: BOX §3 counters] |
| `ctr.catch_jab` | jab | `def.catch` → jab or cross | +0.50 | T2 | [S: BOX §5 counter chains] |
| `ctr.parry_cross` | jab | `def.parry` (down) → cross over the top | +0.70 | T2 | [S: BOX §3 "7 easy counters"] |
| `ctr.slip_cross` | jab | `def.slip_out` → cross | +0.90 | T2 | [S: BOX §3 D4] |
| `ctr.slip_in_body` | jab | `def.slip_in` → cross/jab to body | +0.70 | T2 | [S: BOX §5] |
| `ctr.slip_in_hook` | jab | `def.slip_in` → lead hook | +0.70 | T3 | [S: BOX §5] |
| `ctr.pull_counter` | jab, cross, step-in | `def.pull` → cross | +0.90; closing speed applies (§2.6.4) | T3 | [S: BOX §3 D8, §8 D16] |
| `ctr.cross_counter` | cross | `def.slip_out` → lead hook | +0.90 | T2 | [S: BOX §2 #8] |
| `ctr.cross_simultaneous` | cross | `def.slip_out` + simultaneous cross | +0.50 | T3 | [S: BOX §3 Ringsport] |
| `ctr.shoulder_roll_return` | cross, overhand (same stance) | `def.shoulder_roll` → rear straight/uppercut | +0.90 | T3 (style) | [S: BOX §3 D9] |
| `ctr.duck_body` | cross, hooks | `def.duck` → cross to body | +0.50 | T2 | [S: BOX §5] |
| `ctr.block_hook` | cross, hook | `def.block_high` → lead hook "as the hand peels away" | +0.24 | T1 | [S: BOX §3 "10 counters"] |
| `ctr.inside_hook` | rear hook, cross | lead hook inside, thrown as the rear hand leaves the chin (pre-emptive) | +0.50 | T3 | [S: BOX §2 #10] |
| `ctr.roll_hook` | lead hook, rear hook | `def.roll` → rear hook / cross on the way up | +0.70 | T2 | [S: BOX §3 D6] |
| `ctr.straight_beats_hook` | lead/rear hook | jab or cross first (pre-emptive) | +0.50 | T2 | [S: BOX §2 #9] |
| `ctr.lean_back_cross` | lead hook | `def.lean_back` → cross | +0.70 | T2 | [S: BOX §5] |
| `ctr.check_hook` | step-in / lunge / straight-line charge | `tech.check_hook` (lead hook + pivot) | +0.90 as counter (P_land 0.40); force ×1.5 via closing speed | T3 | [S: BOX §2 #14, §8 D16] |
| `ctr.duck_uppercut` | overhand | `def.duck` → rear uppercut | +0.70 | T3 | [S: BOX §5] |
| `ctr.outside_step_hook` | overhand | `def.step_off` outside lead foot → lead hook | +0.70 | T3 | [S: BOX §5] |
| `ctr.level_change_double` (03) | overhand, wide hooks | `move.level_change` → double leg | +0.60 to the takedown (03) | T2 | [S: BOX §5; MIS I-1] |
| `ctr.uppercut_over_top` | lead uppercut (hand drops) | cross over the top | +0.70 | T2 | [S: BOX §2 #11] |
| `ctr.cross_on_kick` | rear low/body kick (wind phase) | straight punch as the kick starts (simultaneous) | P_land 0.45 flat (replaces base) | T2 | [S: MTK §8.23 counter-Dutch 0.45; §2 K1] |
| `ctr.return_low_kick` | low kick (landed or checked) | rear low kick to the planted leg | +0.50 | T1 | [S: MTK §2 K1] |
| `ctr.punch_on_switch` | switch kick (during switch) | any punch | +0.45 | T2 | [S: MTK §2 K4] |
| `ctr.teep_jam` | body kick, switch, flying knee, spin | `def.teep_jam` | see §2.4.2 | T2 | [S: MTK §3] |
| `ctr.punch_spinning_back` | spinning back kick / elbow / backfist | punch or takedown while the back is turned | +0.60, `unseen` | T1 | [S: MTK E5, S1] |
| `ctr.intercepting_knee` | level change, duck, shot entry | `tech.knee_intercepting` | +0.60; force ×1.3 (closing) | T3 | [S: MIS I-6; MTK §8.18] |
| `ctr.uppercut_on_level_change` | level change / sprawl-bait bite | `tech.uppercut_*` | +0.70 | T2 | [S: MIS I-6] |
| `ctr.knee_on_duck` (MMA) | `def.duck`, `def.roll` by the opponent | knee substituted for the planned punch | +0.70 | T2 | [S: BOX §8 C12] |
| `ctr.kick_catch_tree` | body kick, teep, knee | `def.kick_catch` → §2.5.3 | tree | T1 (catch), T2 (follow-up) | [S: MTK §3.1] |
| `ctr.smother_clinch` | kicks, wide hooks | `def.step_in_smother` → clinch entry (03) | +0.50 | T2 | [S: MTK §3] |
| `ctr.frame_cross` | entry, overhand | `def.frame` → cross | +0.50 | T2 | [S: BOX §3 D10] |
| `ctr.backstep_jab` | step-in | `def.step_back` + `tech.jab_backstep` | +0.24 | T2 | [S: BOX §4] |
| `ctr.hit_on_break` | opponent breaks clinch (03) | one short strike | +1.0 (+20–30 % p → D) | T2 | [S: MIS I-12] |

#### 2.5.3 Post-catch tree (`def.kick_catch` succeeded)

Ruleset gate: `mt` (≤ 2 forward steps, shin sweeps / hip dumps legal, no hip throws), `kb` (one strike, then release),
`mma` (any takedown) [S: MTK §3.1, §9]. Catcher chooses; P for T4 catcher vs T4 kicker re-anchored from MTK's T2 vs T2
by the k-rule (equal skill → same value) [D]:

| Action | P(success) | Kicker outcome | Rulesets | Tag |
|---|---|---|---|---|
| sweep the standing leg (shin) | 0.45 (+0.15 after a step-and-pull; −0.20 vs a T5 kicker) | on the canvas, ~0 damage, "loses the exchange" (06) | mt | [S: MTK §3.1] |
| pull-and-dump → knee/elbow on the way in | 0.40 dump; follow-up lands 0.50 | falls into a power-4 strike | mt | [S: MTK §3.1] |
| knee to body/thigh while holding | 0.65 | body/thigh damage | mt (unlimited), kb (one), mma | [S: MTK §3.1] |
| punch (cross/overhand) while holding | 0.60 | head strike, `unseen` 0.5 | all | [S: MTK §3.1] |
| return kick to the standing leg | 0.55 | leg damage, balance −10, fall 0.4 | mt, mma | [S: MTK §3.1] |
| walk forward and dump (≤ 2 steps) | 0.35 | fall | mt | [S: MTK §3.1] |
| leg-catch takedown (run the pipe / trip / lift) → 03 | 0.55 (= cold single leg `+0.20` p) | bottom position | mma | [S: MTK §3.1; MIS I-5 45–55 %] |
| release and reset | 1.0 | neutral | all | [S: MTK §3.1] |

Kicker escapes, rolled once per 300 ms of hold: immediate pull-back before the grip closes 0.35 (T2) / 0.55 (T4);
hop and frame 0.30 per beat; collar-tie + knee shield 0.30; punch/elbow while held lands 0.45 and forces release 0.25;
re-teep with the free leg 0.20; aggressive twisting raises the catcher's sweep by +0.15 [S: MTK §3.1].

#### 2.5.4 Delayed counters and habitual returns (T3+)

After throwing, a T3+ fighter may move the head off-line (`def.slip_*` pre-committed) to where the opponent's
*habitual return* will come; if the opponent has produced the same return ≥ 2 times in a row (07 opponent model), the
return misses automatically and the follow-up gets `+0.70` logit [S: BOX §8 D17 +0.15 p → D; §5 Duran]. Exchange
initiations at elite level split ≈ ⅓ lead, ⅓ counter, ⅓ defensive/positioning [S: LB §5.10 taekwondo Markov] —
07 should keep counter initiations first-class, not rare.

### 2.6 Hit resolution

#### 2.6.1 Pipeline (per strike, in order; every roll from the seeded RNG in this order)

```
1  legality: band check (§2.1.1), ruleset flags, availability by tier (§3)
2  timeline: t_launch (+sub-tick), t_contact = t_launch + startup, t_recover = t_contact + contact + recovery
3  defender reads: pattern read (pre-commit), then cue read at t_launch + telegraph        (§2.4.3)
4  defender response D ∈ {reactive defence | counter | none}; counter may be simultaneous  (§2.5)
5  arrival roll: P_A = sigmoid(logit(pA) + Σ attacker/defender modifiers)                  (§2.6.2)
      fail → outcome 'missed' (whiff: no contact, attacker window opens)
6  if D is a reactive defence and available: roll Success_D (+k·skillGap + D modifiers)
      success → outcome per D ('evaded' | 'blocked' | 'checked' | 'caught')
      fail    → continue with 'defenceFailed = D' (placement shifts, §2.6.3)
   if no D: passive posture roll: P_pass = sigmoid(logit(0.20) + guard.passive[strikeFamily] + 0.8·(guard−50)/100)
      success → 'blocked' (absorb 0.45)                                                     [E base 0.20]
7  placement roll → {flush, solid, partial, glancing}                                       (§2.6.3)
8  sub-location roll within the region                                                       (§2.6.3)
9  force draw + multipliers → F, v_rel, m_eff                                                (§2.6.4)
10 emit StrikeImpact to 05; emit BoutEvent 'strike' with result; open counter window (§2.5.1)
11 self-damage impacts (checked kick shin, punch on skull) emitted to 05
```

`pA` is solved offline for each technique from `P_land = pA × (1 − r·s̄_D − (1−r)·p̄_pass)`, where `r = 0.81` (T4
read), `s̄_D` = mean Success of the defences the reference defender picks for that family (weighted by 07's default
policy) and `p̄_pass` = passive block rate for that family. Worked example, `tech.jab`: `s̄ = 0.60` (catch 0.70,
parry 0.62, slip 0.55, block 0.62 mixed), `p̄_pass = 0.25` → denominator `1 − 0.486 − 0.048 = 0.466` → `pA = 0.30 /
0.466 = 0.64` [D]. First-pass `pA` values (all [D] by the same arithmetic; the calibration script re-solves them):
jab 0.64, step jab 0.69, power jab 0.58, body jab 0.92, cross 0.60, cross body 0.88, lead hook 0.56, rear hook 0.50,
body hooks 0.88, uppercuts 0.48 (mid) / 0.70 (close), overhand 0.46, check hook 0.40 / 0.80 counter, elbows 0.60,
straight knee 0.70, teep lead 0.95, teep rear 0.85, low kick rear 0.89, calf 0.92, oblique 0.75, body kick 0.95, head
kick 0.36, question mark 0.27 → 0.60. `pA` is clamped to `[0.05, 0.97]`.

Stat counting (for 06/analytics and calibration): `landed` = {flush, solid, partial}; `checked` low kicks count as
attempted **and landed-partial** (UFCStats credits contact on the leg; this is what makes leg accuracy 80 %)
[S: FD #17; interpretation E]; `blocked` body/head strikes count as landed-partial with P 0.30 when they move the
head [E], otherwise attempted only; `evaded`, `missed`, `caught` = attempted only. `significant` flag = every
distance strike, plus clinch/ground power strikes (06 rule).

#### 2.6.2 Arrival modifiers (logit; attacker side unless stated)

| Modifier | Value | Tag |
|---|---|---|
| Skill gap | `k_skill × (attacker technique sub-skill − defender defence sub-skill) / 100`, `k_skill = 2.0` for punches, 2.5 for kicks/knees/elbows | [E within conventions 1.0–3.0; anchored: ±0.05 p per tier step, cap ±0.20 p S: BOX §8 A3 → 0.24 logit per 20 pts ≈ k 1.2–2.4] |
| Set-up / combination | §2.3.1 rules 3–7 | [S: BOX, MTK] |
| Feint bite / broken rhythm | §2.3.4–2.3.5 | [S: BOX] |
| Range fit | §2.1.1 | [E] |
| Angle / lead foot / stance | §2.1.3, §2.7 | [S: MIS, BOX] |
| Reach | §2.8: `+0.12 × (reachAdv_cm/10) × classScale` at `range.long`/`range.kick` on straights, teeps, kicks; 0 elsewhere; hooks 0 | [E; calibrated to FD #116] |
| Attacker fatigue | `−0.35·f` (accuracy −8 % at f 0.5, −18 % at 0.8 [S: DP §4.3] → D) | [D] |
| Defender fatigue | `+0.45·f_def` (defender's head movement/footwork −20 % / −45 % [S: DP §4.3] → D) | [D] |
| Defender `state.rocked` | `+0.80`; `state.stunned` `+0.30`; `state.body_hurt` `+0.50` head | [S: DP §2.1 defence −35 % / −10 % / head exposure +30 % → D] |
| Attacker `state.rocked` | `−0.60` (accuracy −25 %) | [S: DP §2.1 → D] |
| Defender leg damage | `+0.25 × (1 − mobility)` per 05's mobility (cannot move out of range) | [E] |
| Defender `state.re_planting` / single-leg (after a check) | `+0.50` | [S: MTK §8.13] |
| Defender mid-switch | `+0.45` | [S: MTK K4] |
| Defender back turned (spin) | `+0.60`, unseen | [E] |
| Attacker `state.feet_crossed` | `−0.50` | [E] |
| Guard-hand-away (defender's hand off chin after their own punch/parry) | `+0.30` to that side | [E] |
| `state.vision_blocked` on defender | `+0.30` | [E] |
| Attacker's eyes closed (T0 tell) | `−0.60` | [E; S: BOX §6 "eyes close on contact"] |
| Age (attacker output, not accuracy) | 0 here — accuracy preserved with age; volume owned by 07/05 | [S: LB §5.8] |

#### 2.6.3 Placement and sub-location

Placement is a categorical draw, **not** a flush lottery. Base weights for a strike that arrives on a **seen**
target through `guard.standard` with no defence fired [E, tuned so §5 hook KD-per-landed-strike holds]:

| Family | flush | solid | partial | glancing | Tag |
|---|---|---|---|---|---|
| head punches | 0.20 | 0.35 | 0.30 | 0.15 | [E] |
| head elbows / knees | 0.25 | 0.35 | 0.25 | 0.15 | [E] |
| head kicks | 0.25 | 0.30 | 0.25 | 0.20 | [E] |
| body strikes | 0.30 | 0.40 | 0.20 | 0.10 | [E] |
| leg kicks (shin) | 0.45 | 0.35 | 0.15 (foot/instep) | 0.05 | [E] |
| teeps | 0.35 | 0.40 | 0.20 | 0.05 | [E] |

Shifts (applied as weight multipliers then renormalised): **unseen** (no read, or angle/spin/back-turned, or defender
mid-action) flush ×1.75, glancing ×0.65 [E; S: DP §3.2 unseen ×1.35 on alphaEq is separately applied by 05 — do not
double-count: this section passes `seen=false`, and the placement shift models *where* it lands, the 05 term models
neck bracing]; **defence failed narrowly** (evasive D rolled within 0.15 of success): glancing ×2.5, flush ×0.5
("rolled with"); **blocked**: partial 0.70 / glancing 0.30 only; **late check** (check failed): flush; attacker
precision `(boxing.power or roundKick − 50)/100 × 0.5` added to flush weight; defender `boxing.headMovement` `−0.4 ×
(skill−50)/100` on flush [E]; `state.rocked` defender flush ×1.5 [E].

Placement force multipliers (`p.strike.placement.mult`): flush 1.00, solid 0.75, partial 0.45, glancing 0.25 [E;
consistent with DP §3.1 cleanMult 1.0 / 0.5 / 0.25]. Absorb fraction passed to 05: flush 0, solid 0, partial 0.45
(blocked) or 0.6 (rolled with), glancing 0.6 [S: DP §3.3].

**Sub-location** (region `head`) by family, weights [E anchored on KO location mandible 53.9 % / maxilla 20 % /
temporal 20 % S: FD §2.1 [HUT], which describes KO-quality landings, so flush hooks/overhands are chin/temple-heavy]:

| Family | chin | temple | midface | forehead | orbit |
|---|---|---|---|---|---|
| straights | 0.25 | 0.05 | 0.40 | 0.20 | 0.10 |
| hooks / overhand | 0.35 | 0.25 | 0.20 | 0.05 | 0.15 |
| uppercuts | 0.60 | 0.05 | 0.30 | 0.00 | 0.05 |
| elbows | 0.20 | 0.25 | 0.20 | 0.15 | 0.20 |
| head kicks | 0.30 | 0.35 | 0.15 | 0.10 | 0.10 |
| knees (head) | 0.35 | 0.10 | 0.40 | 0.10 | 0.05 |

Body sub-locations: liver 0.15 (0.60 for `tech.hook_liver` / open-stance rear kick to the open side), solar plexus
0.20, ribs 0.45, spleen 0.10, abdomen 0.10 [E]. Leg: thigh outer/inner, calf, knee per technique target.

#### 2.6.4 Force model

```
F = F_med(tech) × exp(N(0, σ_F)) × placementMult × tierMult(tech family, tier) × powerMult × massMult
      × fatigueMult × commitMult × rangeFitMult × closingMult,     capped at F_cap(tech) × 1.15
v_rel   = v_ref × (0.85 + 0.003 × handSpeed|kickSpeed) × (1 − 0.18·f) + k_close × closingSpeed
m_eff   = m_eff_frac(tech) × massKg × commitMult
```

| Term | Value | Tag |
|---|---|---|
| `σ_F` | 0.30 | [D] chosen with the §2.6.3 placement mix so that landed head punches reproduce Pierce: with placement weights 0.20/0.35/0.30/0.15 and multipliers 1/0.75/0.45/0.25, mean multiplier = 0.20+0.26+0.135+0.04 = 0.64; `F_med(cross) = 1400` → mean ≈ 900–1000 N, ≈ 87 % < 1500 N, ≈ 3–5 % ≥ 2000 N [S: LA §1.2 Pierce: median ≈ 950 N, 88 % < 1500, 2–6 % ≥ 2000] |
| `tierMult` straights | T0 0.50, T1 0.60, T2 0.72, T3 0.85, T4 1.00, T5 1.05 | [D: LA §2 Smith 2000 novice 0.50 / intermediate 0.78 / elite 1.0] |
| `tierMult` hooks/uppercuts/overhand | T0 0.22, T1 0.35, T2 0.55, T3 0.78, T4 1.00, T5 1.05 | [D: BOX §1.4 junior hooks/uppercuts 20–25 % of elite; LA §2 Dinu 2020] |
| `tierMult` kicks/knees | T0 0.50, T1 0.75, T2 0.90, T3 1.00, T4 1.05, T5 1.10 | [S: MTK §6 hip rotation ×0.5/0.75/1.0/1.05/1.1 (their T0–T4 → our T0–T5 with T2/T3 interpolated D)] |
| `powerMult` | `1 + 0.008 × (power − 50)`, `power = 0.6·explosiveness + 0.4·strength` | [E; S: LA §2 Loturco r 0.67–0.85 lower-body power ↔ impact; elite lead-leg RFD +40 % S: BOX §7.4] |
| `massMult` punches | `(massKg / 77)^0.5` | [E; S: BOX §8 E19 weight ±15 %; LA §0 in-ring force uncorrelated with mass r 0.22] |
| `massMult` kicks/knees | `(massKg / 77)^0.8` | [E] |
| `fatigueMult` straights | `1 − 0.28·f` | [D: DP §4.3 power −12 % at f 0.5, −25 % at 0.8] |
| `fatigueMult` hooks/uppercuts/kicks | `1 − 0.40·f` | [S: LA §2 Dunn 2022 rotational punches ≈ 2× jab decrement; D] |
| rear-hand fatigue | `f_hand = min(1, 1.2·f)` for rear-hand punches | [S: BOX §8 F25] |
| `commitMult` | planted/stepping in 1.0; thrown while retreating 0.70; arm punch (no hip; T0 default, T1 50 %) 0.60; touch/flicker 0.50; kick with instep instead of shin 0.70 | [E; S: LA §2 Lenetsky effective mass; MTK §2 "kicking with the foot is a T0/T1 tell"] |
| `rangeFitMult` | §2.1.1 | [E] |
| `closingMult` | via `k_close = 1.6` in `v_rel`; force ∝ `v_rel / v_ref` (linear in impact velocity, `F ≈ m_eff·Δv/Δt`). Opponent stepping in 1.5 m/s → cross ×1.31; lunge 2.5 m/s → ×1.51; check hook (v_ref 11) vs lunge ×1.36 plus its pivot → treated as ×1.5 | [D: reproduces BOX §8 D16 ×1.25 stepping-in / ×1.5 check-hook-vs-lunge] |
| `closingSpeed` for the *defender moving into* a strike | passed in the payload; 05 owns the KO-side term `(1 + 0.5·closing/3)` [S: DP §3.2] — this section does **not** also multiply F for the defender's motion | — |
| Head-kick / knee force at `F_cap` | never exceeds 6400 / 8200 N | [S: MTK §7.1 review upper bounds] |

Rotational handoff: `rot` from Table B × `weapon` is passed unchanged; 05 multiplies its `alphaEq`. Note for 05: our
`F` is the *delivered* in-fight force (Pierce scale), whereas DP §3.1 anchors `alphaEq = 6300 × F/3400` on a lab
flush straight (Walilko). A T4 flush cross here is ≈ 1400 × 1.0 × lognormal ≈ 1400 N median, so 05 must either
re-anchor its reference force to `p.strike.force.refFlushCross = 1400` N or accept that only the lognormal tail
(≥ 3400 N, ≈ 0.2 % of flush crosses) reaches Walilko levels. §5 hook 36 gives the target that decides this.

#### 2.6.5 `StrikeImpact` payload (to 05)

```ts
interface StrikeImpact {
  tick: number; subTickMs: number;
  attacker: number; target: number;
  tech: string;                        // tech.*
  weapon: 'fist'|'backfist'|'elbow'|'elbow_point'|'knee'|'shin'|'instep'|'ball_of_foot'|'heel'|'shin_on_knee';
  region: 'head'|'body'|'leadLeg'|'rearLeg'|'arms';
  subLocation: string;                 // chin|temple|midface|forehead|orbit|liver|solar|ribs|spleen|abdomen|thigh|calf|knee|shin|forearm
  placement: 'flush'|'solid'|'partial'|'glancing';
  forceN: number; vRel: number; effMassKg: number; rot: number;
  absorb: number;                      // 0..1 from the defence outcome (DP §3.3)
  seen: boolean; counter: boolean; simultaneous: boolean;
  closingSpeed: number;                // defender's velocity component toward the attacker, m/s (05 KO term)
  attackerState: { rocked: boolean; fatigue: number };
  targetState:   { midAction: boolean; mouthOpen: boolean; guardHand: 'up'|'away' };
  gloveType: 'mma'|'boxing'|'bare';
  selfDamage?: StrikeImpact;           // checked-kick shin, punch-on-skull hand roll owned by 05
}
```

05 returns nothing synchronously; state changes (`state.rocked`, knockdown, `state.body_hurt`, leg mobility) are read
from the fighter state on the next tick. `BoutEvent.result` for the recorder: `landed` (flush/solid/partial),
`blocked`, `evaded`, `missed`; new `detail` values `checked`, `caught`.

### 2.7 Stance and matchup rules

Data: orthodox 76.6 % / southpaw 17.1 % / switch 6.1 % of UFC fighters; southpaw-vs-orthodox head-to-head 34–34; any
edge is familiarity [S: MIS §5; FD #120 use ≈ 52 %]. Open-stance bouts finish 18 % more often [S: FD §2.4].

| Rule | Closed stance (same) | Open stance (orthodox vs southpaw) | Tag |
|---|---|---|---|
| jab | `+0.18` (clear lane) | `−0.30` both (lead hands collide) | [S: MIS ST-2, ST-7 ×0.75 / ×1.2 → D] |
| rear straight | 0 | `+0.34` (lane down the middle); + lead-foot dominance §2.1.3 | [S: MIS ST-3 ×1.4] |
| lead hook | `+0.10` | `+0.10` with dominant angle (over the jab) | [S: MIS ST-3, ST-7; BOX §8 G29] |
| rear body kick | `−0.10` (lands on the closed side / arm) | `+0.34` to the open side (liver for a southpaw's left kick vs orthodox) | [S: MIS ST-3, ST-7] |
| rear low kick | `+0.10` inside/outside lead leg | 0 | [S: MIS ST-7] |
| lead-leg low / calf kick | 0 | `+0.26` with dominant angle (outside of the lead leg) | [S: MIS ST-6] |
| shoulder roll | available | `−0.85` (the straight comes from the wrong side) | [S: BOX §8 G29 −0.20 p → D] |
| parry → cross counter | 0 | `+0.34` (lead-hand fighting replaces the jab) | [S: MIS ST-2 ×1.4] |
| preferred range | 0 | `+0.10` m for both; clinch entry weight ×0.9 | [S: MIS ST-4] |
| circling | both directions equal | to the outside foot ×1.5 selection (07); orthodox steps left, southpaw right | [S: MIS ST-1] |

**Familiarity.** `stanceExposure[opponentStance]` (0–100, section 01). Below `p.strike.stance.exposureThreshold =
30` [E]: latency ×1.10, counter bonus `−0.15` logit, wrong-way circling (steps into the rear hand) 15 % of lateral
moves → `unseen` rear hand for that exchange [S: MIS ST-5 +10 % RT, −10 % counter, 15 % footwork errors]. Applied to
the less-exposed fighter; by default the orthodox one. Calibrate so equally exposed pairs are 50/50 and inexperienced
orthodox vs southpaw ≈ 45/55 [S: MIS §10.11].

**Switching** (`move.switch_stance`, §2.1.5). Only `canSwitch` fighters switch without penalty; others get `−0.40`
logit on every strike from the unfamiliar stance and telegraph ×1.5 [E]. 07 triggers: opponent landed ≥ 3 strikes on
the same side in 30 s, or lead leg `structural ≥ 55` (05) [S: MIS ST-8; DP §2.3]. A stance switch removes the calf
target for one exchange but sets `state.switched_stance` (own accuracy `−0.40` logit, TD vulnerability `+0.40`) for
non-switch fighters [S: MTK §8.8 −0.10 / +0.10 → D].

### 2.8 Reach and height exploitation (behaviour, not win-rate multipliers)

**Caveat first.** Bout-level peer-reviewed data show no reach or height effect on winning except at heavyweight
(winners' armspan +2.2 cm, r 0.28) [S: LB §2.4 Kirk 2023]; the longer fighter wins 51.65 % overall, 62.6 % beyond
7 in, and only in standing-heavy fights does a ≥ 2.5 in edge reach ≈ 60 % [S: FD §2.4, #116]. Reach changes *how*
finishes happen (+1 pp toward straights per cm) more than *whether* [S: LB §2.5 Barley 2025]. Height without reach
is nothing [S: FD §2.4 Fightnomics 48 %/46 % controlled]. Therefore reach enters this section as (a) the band
geometry of §2.1.1, (b) one small accuracy term, and (c) technique-mix weights for 07. It never enters a win
probability directly.

**(b) Accuracy term.** `+0.12 logit × (reachAdv_cm / 10) × classScale` on straights, teeps and round kicks thrown at
`range.long` / `range.kick`; 0 at mid/close/clinch/ground; hooks 0; `classScale` FLW–LW 0.7, WW–MW 1.0, LHW–HW 1.5;
cap `|reachAdv| ≤ 20` cm [E; anchored: HW +1.5 landed sig strikes per cm S: LB §2.3 Kirk 2018; LHW ≥ 3 in → 68 %
S: FD §2.4; ≈ 0 at BW/FLW S: FD §4]. At `range.close` the *longer* fighter's straights get `−0.05 × (reachAdv_cm/10)`
(cramped) [E].

**(c) Selection weights for 07** [S: MIS R-1..R-6; all multipliers S, thresholds S]:

| Condition | Weights |
|---|---|
| `reachAdv ≥ 5` cm | preferredRange = `range.long`; jab ×1.6, teep ×1.5, cross ×1.3, hook ×0.8; `guard.long` available (block +0.10 logit, eye-poke risk); circle-away ×1.4 vs pressure; clinch entry ×0.6; when opponent is inside own optimal range: retreat-with-jab / pivot ×1.5 for 1–2 s, no hook trades at close range |
| `reachAdv ≤ −5` cm | feint ×1.5; slip / level-change entries ×1.6; body hook / uppercut on entry ×1.4; low kick to lead leg ×1.3; clinch entry ×1.3; shoot off strikes ×1.2 (03); constant lateral motion; "draw the lead": half-step back to bait the jab then step-in cross/overhand ×1.5 |
| any | reach weights apply only while `range ∈ {long, mid}`; zero in clinch/ground; height affects only clinch leverage (+5 %, owned by 03) |

Expected emergent outcomes (calibration, §5): fight-ending punch mix hook 51 % / straight 35 % / uppercut+overhand
14 % at zero reach gap, shifting +1 pp toward straights per cm [S: LB §2.5]; reach-edge win rate 51.7 % overall.

### 2.9 Transient striking states

| id | Set by | Duration | Effect |
|---|---|---|---|
| `state.jab_setup` / `state.cross_setup` | landed/blocked jab / cross | 0.8 s / 0.6 s | 03 set-up bonus [S: MIS I-2/I-3] |
| `state.hook_bodylock_window` | lead hook carrying attacker inside | 0.4 s | 03 body lock 50–60 % [S: MIS I-4] |
| `state.body_head_window` | landed body strike | 0.6 s | head strikes +0.48 [S: BOX §8 B9] |
| `state.head_body_window` | landed head strike | 0.6 s | body strikes +0.48 [S: BOX §8 B9] |
| `state.guard_hand_away` | own punch/parry | until recovery ends | opponent +0.30 to that side [E] |
| `state.feint_bite` | feint bite | 0.4 s | read suppressed; follow-up bonus (§2.3.4) |
| `state.broken_rhythm` | half-beat launch | that action | §2.3.5 |
| `state.cutoff` | §2.1.4 | while mirrored | step-back/step-off fail rolls |
| `state.re_planting` | checked / missed kick | recovery ×1.2 | defence −0.60; punch +0.50 / TD +0.65 against |
| `state.switched_stance` | switch by non-switch fighter | one exchange | accuracy −0.40; TD vulnerability +0.40 |
| `state.vision_blocked` | flicker touch, blood (05) | 0.3 s | read −0.40; +80 ms latency |
| `state.feet_crossed` | novice lateral step | 0.3 s | balance −10; evasions unavailable |
| `state.sprawl_ready` | level-change feint bite / sprawl posture | 0.4 s | head strikes +0.50 against |
| `state.back_turned` | spinning technique startup | startup | opponent +0.60, unseen |
| `state.angle` | pivot / L-step | until re-square (300 ms) | §2.1.3 |

---

## 3. Behaviour by skill tier (T0–T5)

Tier changes **what is possible and how it looks**, not only the dice [S: BOX §1.8, §6; MTK §6]. Cross-tier accuracy
is handled by the skill-gap term (§2.6.2); the multipliers below are the *within-tier* execution properties.
Sources: BOX §6 table and §8 H31–32, MTK §6 (their 5 tiers mapped: MTK T0→T0/T1, T1→T2, T2→T3, T3→T4, T4→T5), FD §5
priors, LB §4. Every cell without a tag is [E] anchored on the row's source.

| Dimension | T0 brand-new | T1 beginner | T2 amateur | T3 regional pro | T4 UFC level | T5 champion | Tag |
|---|---|---|---|---|---|---|---|
| Execution-time multiplier, kicks (01 `execTimeMult` ÷ 0.90 so that the §2.2 T4 times are ×1.0) | 1.67 | 1.56 | 1.39 | 1.11 | 1.00 | 0.94 | [D: 01 §2.7 `execTimeMult` 1.50/1.40/1.25/1.00/0.90/0.85, S: MTK §6] |
| Execution-time multiplier, punches/elbows/knees (01: `0.5 + 0.5 × execTimeMult`, ÷ 0.95) | 1.32 | 1.26 | 1.18 | 1.05 | 1.00 | 0.97 | [D: 01 §2.7] |
| Telegraph add (ms) = 01 `telegraphMod` × 600 | +150 | +120 | +90 | 0 | −30 | −60 | [D: 01 §2.7 `telegraphMod` +0.25/+0.20/+0.15/0/−0.05/−0.10, S: MTK §6; the ×600 ms/probability-point conversion is E] |
| `readBase` (§2.4.3; replaced by 01 `anticipation.readP` when supplied) | 0.50 | 0.58 | 0.66 | 0.74 | 0.81 | 0.87 | [D: LB §4.1] |
| Feint bite (as defender) | 0.65 | 0.60 | 0.50 | 0.40 | 0.30 | 0.22 | [D: LB §4.5] |
| Counter-on-read | 0.05 | 0.12 | 0.25 | 0.35 | 0.50 | 0.60 | [D: LB §4.4] |
| Feints per strike thrown (07 rate) | 0 | 0.05 | 0.15 | 0.30 | 0.50 | 0.70 | [E; S: BOX §6 "no feints" → "layered feints"] |
| Feint types available | none | none | 1 (`feint.jab`) | + rear-hand, step, kick, level-change | + eyes, layered (2 feints before a strike) | all, chosen per opponent | [S: BOX §8 H31] |
| Combination cap | 2 | 3 | 3 | 4 | 5 | 6 | [E] |
| Punches available | jab, cross, wild lead hook | + rear hook, uppercuts (poor), 1-2, 1-2-3 | + all punches, body work | + check hook, shoulder roll (style), overhand set-ups | + delayed counters, rhythm breaking | everything | [S: BOX §8 H31] |
| Kicks available | rear low / body only (instep, "leg swing") | + teep, switch kick | full round-kick set, calf, oblique | + question mark, spinning | + deception layers (question mark disguise) | all | [S: MTK §6, §8.26] |
| Elbows / knees | none | straight knee | + horizontal/diagonal elbow | + upward/downward | + spinning | all | [S: MTK §8.26: T0 no K6/E5/N4/S1; T1 no K6/E5] |
| Defences available | `guard.cover_turtle`, `def.flinch`, backs straight up, turns away | `guard.high`, `def.block_high`, one slip direction | + `def.parry`, `def.catch`, `def.slip_*`, `def.roll` (one side), `def.check`, `def.step_back` | + all defences; `def.shoulder_roll` if style; `def.step_off`, `def.pull`, `def.kick_catch` follow-ups, cage cutting | anticipatory (pattern) defence; defences become counters | defence that creates the *next* opening | [S: BOX §6, §8 H31; MTK §6] |
| Check rate (of readable low kicks) | 0.10 | 0.25 | 0.40 | 0.50 | 0.60 | 0.70 | [S: MTK §6 <10 % / 25 / 50 / 60 / 70 → mapped] |
| Kick-catch behaviour | attempts on anything, poor grip | catches, no follow-up | catch → knee / sweep | chooses by opponent balance | catches and dumps, baits kicks | — | [S: MTK §6] |
| P(stumble after missed / checked kick) | 0.35 / 0.45 | 0.15 / 0.25 | 0.08 / 0.15 | 0.05 / 0.10 | 0.03 / 0.06 | 0.02 / 0.04 | [S: MTK §6 mapped] |
| Return to stance after kick | skipped (counter window ×2) | slow (×1.5) | normal | fast | reset is part of the kick | — | [S: MTK §6] |
| Force `tierMult` | see §2.6.4 | | | | | | [D] |
| `commitMult` default | arm punches 0.60; overcommits (balance cost ×1.5) | hip rotation appears; 0.80; overcommits ×1.3 | full chain on the 2; 1.0 | economical inside | elite RFD | + deception on every punch | [S: BOX §6 "punch mechanics"] |
| Novice tells (see below) | all | most | rear hand stays home | — | — | — | [S: BOX §6 "guard tells"] |
| Fatigue tells | f > 0.6: `guard.low_hands` forced, chin up, mouth open (`mouthOpen` to 05), feet flat | same later (f > 0.75) | — | — | — | — | [S: BOX §8 F26] |
| Footwork error (feet cross) | 25 % | 10 % | 2 % | 0 | 0 | 0 | [S: BOX §8 H32] |
| Cage awareness | backs straight up | circles, wrong way vs southpaw | circles correctly, still gets caught | cuts the cage; escapes on angles rarely | rarely on the fence | uses the fence offensively | [S: MIS §8] |
| Adaptation latency (07) | round breaks only | round breaks | 90 s | 60 s | 30 s | 20 s | [S: MIS §8] |
| Volume (07 prior, sig attempts/min, MMA) | bursts 15–25/min for ≤ 20 s then collapse | 6–7 | 7–7.5 | 7.5–8 | 8.4 | style-dependent | [S: FD §5] |
| Accuracy prior at equal tier (distance head) | 0.15–0.20 (no defence either) | 0.22–0.26 | 0.26–0.29 | 0.27–0.30 | 0.31 | 0.31–0.35 | [S: FD §5]; equal-tier lower tiers land slightly *more* per attempt because defence is worse; produced by the read/defence tables, not by a separate multiplier |

**Novice tells (T0; T1 at half rate)** [S: BOX §6 sources; LB §7.5 notes no quantitative study — all magnitudes E]:

| Tell | Trigger | Effect |
|---|---|---|
| eyes close on incoming power strike | any read attempt vs a power strike | read fails; `def.flinch` only; defence `−0.60` logit |
| chin up / mouth open | always (T0), f > 0.6 (T1) | `mouthOpen = true` to 05; head strikes `+0.30` against |
| hands drop after every punch | own punch recovery | `state.guard_hand_away` on both hands for the full recovery |
| turns away / back-straight-up under fire | opponent lands ≥ 2 in 3 s | `state.back_turned` 0.5 s (opponent `+0.60`, unseen); loses `cageDist` 0.4 m |
| fist drops before punching, elbows flare | every punch | telegraph +150 ms (already in the row above); `commitMult` 0.60 |
| kicks with the instep, no hip | every kick | `commitMult` 0.70; foot injury roll (05) ×3 |
| square stance, weight on heels | always | `b = 0`; `def.pull` unavailable; low kicks `+0.30` against |
| empties the tank | 07 pacing | output ×1.3 in the first 60 s, then 05's collapse curve |
| no return to stance | after kicks | counter window ×2 |

---

## 4. Parameter registry

The tables of §2.2 (A and B) are registry entries keyed `p.strike.tech.<id>.<field>` (fields: `startupMs`,
`contactMs`, `recoveryMs`, `pLand`, `pA`, `telegraphMs`, `commitBalance`, `commitClass`, `fMedN`, `fCapN`,
`vRef`, `mEffFrac`, `rot`, `weapon`, `targets`, `bands`, `flowsTo`, `beatenBy`); the tables of §2.4.1–2.4.2 are
`p.strike.guard.<id>.<family>` and `p.strike.def.<id>.<field>` (`execMs`, `success`, `k`, `subSkill`, `absorb`,
`counterBonus`); §2.5.2 is `p.strike.ctr.<id>.bonus`; §2.5.3 `p.strike.catchTree.<action>`; §2.3.2 `p.strike.combo.<id>`;
§2.3.4 `p.strike.feint.<id>`. They are not repeated here. Everything else:

| id | value | unit | tag |
|---|---|---|---|
| `p.strike.geom.jabReachAdd` | 0.27 (on 01 `effectiveReachM`) | m | [E] |
| `p.strike.geom.crossReachAdd` | 0.04 | m | [E] |
| `p.strike.geom.hookReachAdd` | 0.12 | m | [E] |
| `p.strike.geom.uppercutReachAdd` | −0.05 | m | [E] |
| `p.strike.geom.elbowReach` | 0.55 | m | [E] |
| `p.strike.geom.kneeReach` | 0.65 | m | [E] |
| `p.strike.geom.kickReachAdd` | 0.30 (on 01 `effectiveKickReachM`) | m | [E] |
| `p.strike.geom.teepReachAdd` | 0.25 | m | [E] |
| `p.strike.geom.stepGainMin/Max` | 0.30 / 0.50 | m | [S: BOX §2 #2] |
| `p.strike.range.clinchMax` | 0.45 | m | [E] |
| `p.strike.range.closeMax` | 0.70 | m | [D: BOX §2] |
| `p.strike.range.midToLongOffset` | −0.15 | m | [E] |
| `p.strike.range.longToKickOffset` | +0.10 | m | [E] |
| `p.strike.rangeFit.edge` | −0.30 | logit | [E] |
| `p.strike.rangeFit.wrongBand` | −0.60 | logit | [E] |
| `p.strike.rangeFit.forceEdge` | 0.70 | × | [E] |
| `p.strike.rangeFit.forceSmother` | 0.60 | × | [E] |
| `p.strike.rangeComfort.k` | 0.40 | logit | [E] |
| `p.strike.stance.bladedJab` | 0.20 | logit × b | [E] |
| `p.strike.stance.bladedReach` | ±0.05 | m × b | [E] |
| `p.strike.stance.bladedShoulderRoll` | 0.40 | logit × b | [E] |
| `p.strike.stance.bladedLegExposure` | 0.15 | × b | [E] |
| `p.strike.stance.bladedCheck` | −0.20 | logit × b | [E] |
| `p.strike.stance.bladedLateral` | 0.15 | × b speed loss | [E] |
| `p.strike.stance.bladedTarget` | −0.10 | logit × b | [E] |
| `p.strike.angle.threshold` | 30 | deg | [E] |
| `p.strike.angle.straightPenalty` | −0.60 | logit | [D: BOX §8 G27] |
| `p.strike.angle.hookPenalty` | −0.20 | logit | [D: BOX §8 G27] |
| `p.strike.angle.kickPenalty` | −0.30 | logit | [E] |
| `p.strike.angle.rearHandBonus` | 0.30 | logit | [E] |
| `p.strike.angle.unseenP` | 0.35 | prob | [E] |
| `p.strike.angle.resquareMs` | 300 | ms | [E] |
| `p.strike.leadFoot.threshold` | 0.10 | m | [E] |
| `p.strike.leadFoot.rearStraight` | 0.20 | logit | [D: MIS ST-1] |
| `p.strike.leadFoot.rearKickOpenSide` | 0.20 | logit | [D: MIS ST-1] |
| `p.strike.leadFoot.leadHook` | 0.10 | logit | [D: MIS ST-3] |
| `p.strike.leadFoot.oppRearStraight` | −0.15 | logit | [D: MIS ST-1] |
| `p.strike.leadFoot.leadLegKick` | 0.26 | logit | [D: MIS ST-6] |
| `p.strike.leadFoot.circleWeight` | 1.5 | × | [S: MIS ST-1] |
| `p.strike.cage.centreMin` | 2.0 | m | [E] |
| `p.strike.cage.fenceMax` | 0.8 | m | [E] |
| `p.strike.cage.fenceEvasion` | −0.40 | logit | [D: BOX §8 C12] |
| `p.strike.cage.fenceStepOff` | −1.0 | logit | [E] |
| `p.strike.cage.fenceComboCap` | +1 | strikes | [S: MIS P-3] |
| `p.strike.cage.fenceBodyWeight` | 1.4 | × | [S: MIS P-3] |
| `p.strike.cage.fenceClinchWeight` | 1.3 | × | [S: MIS P-3] |
| `p.strike.cutoff.mirrorAngle` | 30 | deg | [E] |
| `p.strike.cutoff.armSeconds` | 0.5 | s | [E] |
| `p.strike.cutoff.failNear` | 0.30 | prob | [S: BOX §8 G28] |
| `p.strike.cutoff.failFence` | 0.60 | prob | [S: BOX §8 G28] |
| `p.strike.cutoff.minTier` | T2 | tier | [S: BOX §4] |
| `p.strike.cutoff.accuracy` | 0.5 + 0.005 × cageCraft | prob | [E] |
| `p.strike.cutoff.smallCageMult` | 1.15 | × | [S: MIS §10.21] |
| `p.strike.move.stepDragMs` | 200 | ms | [S: BOX §4] |
| `p.strike.move.pivotMs` | 300 | ms | [S: BOX §4] |
| `p.strike.move.lStepMs` | 400 | ms | [S: BOX §4] |
| `p.strike.move.levelChangeMs` | 200 | ms | [E] |
| `p.strike.move.levelChangeTelegraph` | 120 | ms | [E] |
| `p.strike.move.shiftPower` | 1.15 | × | [E] |
| `p.strike.move.shiftDefence` | −0.50 / 400 | logit / ms | [E] |
| `p.strike.move.switchMs` | 300 | ms | [S: MIS ST-8] |
| `p.strike.move.switchStamina` | 1 | % | [S: MIS ST-8] |
| `p.strike.move.switchTdVuln` | 0.60 | logit | [D: MIS ST-8 +15 %] |
| `p.strike.move.switchLegDamage` | 1.3 | × | [S: MIS ST-8] |
| `p.strike.move.feetCrossP[T0..T5]` | 0.25 / 0.10 / 0.02 / 0 / 0 / 0 | prob | [S: BOX §8 H32] |
| `p.strike.move.feetCrossMs` | 300 | ms | [S: BOX §8 H32] |
| `p.strike.combo.overlap` | 0.40 | fraction of recovery | [E] |
| `p.strike.combo.stepBonus` | 0.24 | logit/step | [D: BOX §8 B6] |
| `p.strike.combo.stepBonusCap` | 0.48 | logit | [D: BOX §8 B6] |
| `p.strike.combo.afterLandedJab` | 0.48 | logit | [D: BOX §8 B5] |
| `p.strike.combo.afterDefendedJab` | 0.24 | logit | [D: BOX §8 B5] |
| `p.strike.combo.bodyHeadMs` | 600 | ms | [S: BOX §8 B9] |
| `p.strike.combo.bodyHeadBonus` | 0.48 | logit | [D: BOX §8 B9] |
| `p.strike.combo.bodyPoolHeadKick` | 0.45 | logit at body structural ≥ 40 | [D: MTK §5.3] |
| `p.strike.combo.dutchMs` | 300 | ms | [S: MTK §8.3] |
| `p.strike.combo.dutchBonus` | 0.45 | logit | [D: MTK §8.4 +0.10] |
| `p.strike.combo.dutchReadPenalty` | −0.15 | P(read) | [S: MTK §8.3] |
| `p.strike.combo.dutchCheckMult` | 0.5 | × | [E] |
| `p.strike.combo.kickThenPunch` | 0.24 | logit | [E] |
| `p.strike.combo.afterCheckPunch` | 0.50 | logit | [D: MTK §8.13] |
| `p.strike.combo.cap[T0..T5]` | 2 / 3 / 3 / 4 / 5 / 6 | strikes | [E] |
| `p.strike.combo.capVsWrestler` | 3 | strikes | [S: MIS S-4] |
| `p.strike.combo.illegalPenalty` | −0.50 / +100 | logit / ms | [D: BOX §8 B6] |
| `p.strike.combo.illegalRate[T0,T1]` | 0.30 / 0.15 | prob | [E] |
| `p.strike.feint.startupMs` | 80–150 | ms | [S: BOX §5] |
| `p.strike.feint.windowMs` | 400 | ms | [E] |
| `p.strike.feint.bite[T0..T5]` | 0.65 / 0.60 / 0.50 / 0.40 / 0.30 / 0.22 | prob | [D: LB §4.5] |
| `p.strike.feint.sellK` | 1.5 | logit / 100 pts | [E] |
| `p.strike.feint.habituation` | −0.70 | logit per repeat in 20 s | [E] |
| `p.strike.feint.bonus[defTier]` | 0.40 (T0–2) / 0.20 (T3) / 0.10 (T4–5) | logit | [D: BOX §8 B7] |
| `p.strike.feint.levelChangeBonus` | 0.70 | logit | [D: MIS I-6] |
| `p.strike.feint.overFeintN` | 3 | feints | [S: BOX §8 B7] |
| `p.strike.feint.overFeintCounterP` | 0.30 | prob | [S: BOX §8 B7] |
| `p.strike.feint.kickFeintPunch` | 0.50 | logit | [D: MTK §8.13] |
| `p.strike.rhythm.onBeatTol` | 0.15 | fraction | [E] |
| `p.strike.rhythm.halfBeat` | 0.40–0.60 / 1.40–1.60 | fraction | [E] |
| `p.strike.rhythm.brokenBonus` | 0.30 | logit | [D: BOX §8 B8] |
| `p.strike.rhythm.minTier` | T4 | tier | [S: BOX §8 H31] |
| `p.strike.rhythm.readableBonus` | 0.30 | logit after 4 on-beat | [E] |
| `p.strike.rhythm.cadenceMs` | 400–700 | ms | [D: BOX §5] |
| `p.strike.setup.jabSetupMs` | 800 | ms | [S: MIS I-2] |
| `p.strike.setup.crossSetupMs` | 600 | ms | [S: MIS I-3] |
| `p.strike.setup.hookBodylockMs` | 400 | ms | [S: MIS I-4] |
| `p.strike.guard.switchMs` | 200 | ms | [E] |
| `p.strike.guard.highPassiveBonus` | 0.60 | logit | [E] |
| `p.strike.guard.highStamina` | 1.10 | × | [E] |
| `p.strike.guard.longPokeRate` | 0.3–0.6 | %/s | [S: MIS §2.4] |
| `p.strike.guard.longStepInPenalty` | −0.30 | logit | [D: BOX §3 D10] |
| `p.strike.guard.phillyMinB` | 0.5 | b | [E] |
| `p.strike.guard.phillyMinSkill` | 60 | headMovement | [E] |
| `p.strike.guard.peekabooStamina` | 1.15 | × | [E] |
| `p.strike.guard.crossArmMobility` | 0.90 | × | [S: BOX §8 C11 −0.10] |
| `p.strike.guard.passiveBase` | 0.20 | prob | [E] |
| `p.strike.guard.passiveK` | 0.8 | logit / 100 pts | [E] |
| `p.strike.glove.boxing.jabLogit` | −0.60 | logit | [D] |
| `p.strike.glove.boxing.powerLogit` | +0.30 | logit | [D] |
| `p.strike.glove.boxing.blockLogit` | +0.90 | logit | [D: MIS §2.4] |
| `p.strike.glove.boxing.blockPassthrough` | 0.35 (MMA 0.55) | fraction | [S: BOX §3 D1] |
| `p.strike.glove.boxing.rotFactor` | 0.87 | × | [E; S: LA Bartsch] |
| `p.strike.react.rtSimple` | 01 `reactionTimeMs` (225 − 0.65 × (reactionTime − 50)) | ms | [S: 01 §2.2.1] |
| `p.strike.react.choiceMs` | 60 | ms | [E] |
| `p.strike.react.fatigueMult` | 0.15 | × f | [S: LB §4.7] |
| `p.strike.react.rockedMult` | 1.15 | × | [S: DP §2.1] |
| `p.strike.react.noviceAddMs` | 30 | ms per tier below T2 | [S: BOX §8 C13] |
| `p.strike.react.visionBlockedMs` | 80 | ms | [E] |
| `p.strike.read.base[T0..T5]` | 0.50 / 0.58 / 0.66 / 0.74 / 0.81 / 0.87 (default; 01 `anticipation.readP` overrides) | prob | [D: LB §4.1] |
| `p.strike.read.telegraphSlope` | 0.004 | logit / ms | [E] |
| `p.strike.read.skillK` | 1.5 | logit / 100 pts | [E] |
| `p.strike.read.fatigue` | −0.50 | logit × f | [E] |
| `p.strike.read.hurtPenalty[T]` | 0.65 (T0–1) / 0.40 (T2–3) / 0.20 (T4–5) | logit | [D: LB §4.3] |
| `p.strike.read.visionBlocked` | −0.40 | logit | [E] |
| `p.strike.read.leadBaseMs` | 80 | ms | [E; S: LB §4.2] |
| `p.strike.read.leadTelegraphFrac` | 0.6 | × telegraph | [E] |
| `p.strike.read.patternOnBeat` | 0.30 | logit | [E] |
| `p.strike.read.patternRepeat3` | 0.60 | logit | [D: MTK §8.3] |
| `p.strike.read.patternHabit` | 0.40 | logit | [E] |
| `p.strike.read.afterBite` | −0.60 | logit | [E] |
| `p.strike.read.counterOnRead[T0..T5]` | 0.05 / 0.12 / 0.25 / 0.35 / 0.50 / 0.60 | prob | [D: LB §4.4] |
| `p.strike.read.noviceDefaultBlockP` | 0.80 | prob | [S: LB §4.4] |
| `p.strike.ctr.windowMissed` | 1.0 | × recovery | [S: BOX §8 D14] |
| `p.strike.ctr.windowChecked` | 1.2 | × recovery | [E] |
| `p.strike.ctr.windowBlocked` | 0.6 | × recovery | [E] |
| `p.strike.ctr.windowLanded` | 0.4 | × recovery | [E] |
| `p.strike.ctr.readPenaltyMissed` | −0.50 | logit | [E] |
| `p.strike.ctr.kickMissDefence` | −0.60 | logit | [S: MTK §8.2 −30 %] |
| `p.strike.ctr.kickLandDefence` | −0.20 | logit | [S: MTK §8.2 −10 %] |
| `p.strike.ctr.bestBonus` | 0.70 | logit | [D: BOX §8 D14] |
| `p.strike.ctr.otherBonus` | 0.24 | logit | [D: BOX §8 D14] |
| `p.strike.ctr.skillK` | 2.0 | × on bonus / 100 pts | [E] |
| `p.strike.ctr.simulCancelP` | 0.50 | prob | [E] |
| `p.strike.ctr.simulHalve` | 0.5 | × force | [S: BOX §8 D15] |
| `p.strike.ctr.preemptStraight` | 0.50 | logit | [E] |
| `p.strike.ctr.habitualN` | 2 | repeats | [S: BOX §8 D17] |
| `p.strike.ctr.delayedBonus` | 0.70 | logit | [D: BOX §8 D17] |
| `p.strike.ctr.kClose` | 1.6 | s/m on v_rel | [D: BOX §8 D16] |
| `p.strike.ctr.stepInSpeed` | 1.5 | m/s | [E] |
| `p.strike.ctr.lungeSpeed` | 2.5 | m/s | [E] |
| `p.strike.ctr.hitOnBreak` | 1.0 | logit | [D: MIS I-12] |
| `p.strike.catch.escapePullBack[T2/T4]` | 0.35 / 0.55 | prob | [S: MTK §3.1] |
| `p.strike.catch.escapeBeatMs` | 300 | ms | [S: MTK §3.1] |
| `p.strike.catch.stepLimitMT` | 2 | steps | [S: MTK §3.1] |
| `p.strike.catch.caughtKickAbsorb` | 0.4 | fraction | [E] |
| `p.strike.placement.base[family]` | §2.6.3 | weights | [E] |
| `p.strike.placement.unseenFlush` | 1.75 | × | [E] |
| `p.strike.placement.unseenGlancing` | 0.65 | × | [E] |
| `p.strike.placement.narrowFailGlancing` | 2.5 | × | [E] |
| `p.strike.placement.narrowFailFlush` | 0.5 | × | [E] |
| `p.strike.placement.narrowFailMargin` | 0.15 | prob | [E] |
| `p.strike.placement.blocked` | partial 0.70 / glancing 0.30 | weights | [E] |
| `p.strike.placement.precisionK` | 0.5 | flush weight / 100 pts | [E] |
| `p.strike.placement.headMovementK` | −0.4 | flush weight / 100 pts | [E] |
| `p.strike.placement.rockedFlush` | 1.5 | × | [E] |
| `p.strike.placement.mult` | 1.00 / 0.75 / 0.45 / 0.25 | × force | [E; S: DP §3.1] |
| `p.strike.placement.absorb` | 0 / 0 / 0.45 (blocked) or 0.6 (rolled) / 0.6 | fraction | [S: DP §3.3] |
| `p.strike.placement.subHead[family]` | §2.6.3 | weights | [E; S: FD [HUT]] |
| `p.strike.placement.subBody` | liver 0.15 (0.60 targeted) / solar 0.20 / ribs 0.45 / spleen 0.10 / abdomen 0.10 | weights | [E] |
| `p.strike.force.sigma` | 0.30 | ln units | [D] |
| `p.strike.force.tierStraight[T0..T5]` | 0.50 / 0.60 / 0.72 / 0.85 / 1.00 / 1.05 | × | [D: LA Smith 2000] |
| `p.strike.force.tierHook[T0..T5]` | 0.22 / 0.35 / 0.55 / 0.78 / 1.00 / 1.05 | × | [D: BOX §1.4, LA Dinu] |
| `p.strike.force.tierKick[T0..T5]` | 0.50 / 0.75 / 0.90 / 1.00 / 1.05 / 1.10 | × | [D: MTK §6] |
| `p.strike.force.powerSlope` | 0.008 | × per attribute pt | [E] |
| `p.strike.force.powerMix` | 0.6 explosiveness / 0.4 strength | weights | [E] |
| `p.strike.force.massExpPunch` | 0.5 | exponent on massKg/77 | [E] |
| `p.strike.force.massExpKick` | 0.8 | exponent | [E] |
| `p.strike.force.fatigueStraight` | 0.28 | × f | [D: DP §4.3] |
| `p.strike.force.fatigueRotational` | 0.40 | × f | [D: LA Dunn 2022] |
| `p.strike.force.rearHandFatigue` | 1.2 | × f | [S: BOX §8 F25] |
| `p.strike.force.speedBase/Slope` | 0.85 / 0.003 | × per attribute pt | [E] |
| `p.strike.force.speedFatigue` | 0.18 | × f | [D: DP §4.3 hand speed −8 / −18 %] |
| `p.strike.force.commitRetreat` | 0.70 | × | [E; S: LA Lenetsky] |
| `p.strike.force.commitArmPunch` | 0.60 | × | [E] |
| `p.strike.force.commitTouch` | 0.50 | × | [E] |
| `p.strike.force.commitInstep` | 0.70 | × | [E] |
| `p.strike.force.capOvershoot` | 1.15 | × F_cap | [E] |
| `p.strike.force.refFlushCross` | 1400 | N (for 05 re-anchoring) | [D] |
| `p.strike.reach.perTenCm` | 0.12 | logit | [E] |
| `p.strike.reach.classScale` | 0.7 (FLW–LW) / 1.0 (WW–MW) / 1.5 (LHW–HW) | × | [E; S: LB §2.3, FD §4] |
| `p.strike.reach.cap` | 20 | cm | [E] |
| `p.strike.reach.closePenalty` | −0.05 | logit per 10 cm | [E] |
| `p.strike.reach.weightThreshold` | 5 | cm | [S: MIS R-1] |
| `p.strike.stance.open.*` / `.closed.*` | §2.7 table | logit | [D: MIS §5] |
| `p.strike.stance.exposureThreshold` | 30 | attribute | [E] |
| `p.strike.stance.famLatency` | 1.10 | × | [S: MIS ST-5] |
| `p.strike.stance.famCounter` | −0.15 | logit | [D: MIS ST-5] |
| `p.strike.stance.famWrongWay` | 0.15 | prob per lateral move | [S: MIS ST-5] |
| `p.strike.stance.nonSwitchPenalty` | −0.40 / ×1.5 | logit / telegraph | [E] |
| `p.strike.stance.switchedState` | −0.40 / +0.40 | logit accuracy / TD vuln | [D: MTK §8.8] |
| `p.strike.stance.switchTriggerHits` | 3 in 30 s | strikes | [S: MIS ST-8] |
| `p.strike.tier.execMultKick[T0..T5]` | 1.67 / 1.56 / 1.39 / 1.11 / 1.00 / 0.94 (= 01 `execTimeMult` ÷ 0.90) | × | [D: 01 §2.7] |
| `p.strike.tier.execMultPunch[T0..T5]` | 1.32 / 1.26 / 1.18 / 1.05 / 1.00 / 0.97 | × | [D: 01 §2.7] |
| `p.strike.tier.telegraphAdd[T0..T5]` | 150 / 120 / 90 / 0 / −30 / −60 (= 01 `telegraphMod` × 600) | ms | [D: 01 §2.7; ×600 E] |
| `p.strike.tier.feintRate[T0..T5]` | 0 / 0.05 / 0.15 / 0.30 / 0.50 / 0.70 | per strike | [E] |
| `p.strike.tier.checkRate[T0..T5]` | 0.10 / 0.25 / 0.40 / 0.50 / 0.60 / 0.70 | prob | [S: MTK §6] |
| `p.strike.tier.stumbleMiss[T0..T5]` | 0.35 / 0.15 / 0.08 / 0.05 / 0.03 / 0.02 | prob | [S: MTK §6] |
| `p.strike.tier.stumbleChecked[T0..T5]` | 0.45 / 0.25 / 0.15 / 0.10 / 0.06 / 0.04 | prob | [S: MTK §6] |
| `p.strike.tier.noReturnWindow[T0,T1]` | 2.0 / 1.5 | × counter window | [S: MTK §6] |
| `p.strike.tier.overcommit[T0,T1]` | 1.5 / 1.3 | × balance cost | [E] |
| `p.strike.tier.fatigueTellF[T0,T1]` | 0.60 / 0.75 | f | [S: BOX §8 F26] |
| `p.strike.tell.eyesClosed` | −0.60 | logit | [E] |
| `p.strike.tell.chinUp` | 0.30 | logit against | [E; S: BOX §8 F26 +0.10 p] |
| `p.strike.tell.turnAwayTrigger` | 2 landed in 3 s | — | [E] |
| `p.strike.tell.turnAwayMs` | 500 | ms | [E] |
| `p.strike.tell.instepFootInjury` | 3 | × 05 roll | [E] |
| `p.strike.tell.squareLowKick` | 0.30 | logit against | [E] |
| `p.strike.tell.burstOutput` | 1.3 for 60 s | × | [E] |
| `p.strike.effect.teepPushP` | 0.70 / 0.85 | prob (lead / rear) | [E; S: MTK §8.10] |
| `p.strike.effect.teepBalance` | −5 / −10 | balance pts | [E] |
| `p.strike.effect.stopKickBalance` | −10 | balance pts | [E] |
| `p.strike.effect.flickerVisionMs` | 300 | ms | [E] |
| `p.strike.effect.qmSetupKicks` | 2 | low-line kicks | [S: MTK §2 K6] |
| `p.strike.effect.switchTellBonus` | 0.45 | logit | [E] |
| `p.strike.effect.spinBackBonus` | 0.60 | logit | [E] |
| `p.strike.effect.checkedShinFrac` | 0.60 | fraction of raw | [S: DP §2.3] |
| `p.strike.effect.checkedDefenderAbsorb` | 0.85 | fraction | [D: MTK §8.12 0–20 % taken] |
| `p.strike.stat.blockedCountsLandedP` | 0.30 | prob | [E] |
| `p.strike.stat.checkedCountsLanded` | true | — | [E interpretation of FD #17] |
| `p.strike.pa.clamp` | 0.05–0.97 | prob | [E] |
| `p.strike.pa.refRead` | 0.81 | prob | [D] |

---

## 5. Calibration hooks

This section is responsible for the following `FD §3` rows (headless batch ≥ 2,000 bouts, tolerance per FD):

| FD # | Metric | Target | Levers in this section |
|---|---|---|---|
| 1–2 | SLpM 3.9; sig attempts/min 8.4 | ±0.4 / ±0.6 | 07 volume priors; execution times and recovery (cap on attempt rate); range-band time share |
| 3–4 | sig accuracy 46 %; defence 54 % | ±3 pp | `pA` solve, read base, defence success table |
| 5–7 | total strikes landed/min 5.4; total accuracy 53 %; sig:total 0.72 | ±0.6 / ±3 pp / ±0.05 | `significant` flag rule (08) + this section's non-sig strikes (flicker touches, clinch-range taps) |
| 9–10 | winner/loser SLpM 4.3 / 2.9; accuracy 50 / 41 % | ±0.4 / ±3 pp | skill-gap `k`, counter bonuses, damage-state modifiers |
| 11–14 | SLpM / attempts / accuracy by class and sex | per row | `massMult`, class `reach.classScale`; volume priors by class (07) |
| 15–17 | accuracy by target head 38 / body 70 / leg 81 %; distance head 31 / body 63 / leg 80 % | ±3 pp | `P_land` per technique; checked-counts-landed rule |
| 20–21 | attempt share head 77 / body 13.5 / leg 9 %; landed share 63 / 21 / 16 % | ±3 pp | 07 technique mix; body/leg `P_land` |
| 22–24 | landed share and fight-time share by position (distance 78 % / 61 % of time) | ±4–5 pp | range-band dwell, clinch-entry weights (with 03) |
| 25–26 | distance power-head accuracy 25 % (SD 7.8 pp); jab 29 % | ±3 pp; SD ±2 pp | power-punch `P_land` splits; fighter-level variance via sub-skill spread (01) |
| 27 | KO-causing strike type punch 85 / knee 6 / kick 8 % | ±5 pp | `rot`, `F_med` for knees/kicks vs punches; head-kick `P_land` |
| 29 | fight-ending punch type rear straight 29 / lead hook 27 / rear hook 24 / other 20 % | ±6 pp | hook `rot` 1.5 vs straight accuracy; reach mix shift (§2.8) |
| 36–38 | KD per landed distance power head strike 3.9 %; by round ×1.0 / ×0.45 / ×0.28 | ±1 pp | **shared with 05**: placement weights (flush 0.20) × 05's P(KD | placement) must give 0.039; §2.6.3 arithmetic assumes P(KD|flush) ≈ 0.12, solid 0.04, partial 0.01 [D]; round decay comes from 05 fatigue and vulnerability, not from this section |
| 44–46 | KO/TKO winner sig landed 38 / 29; head 27 / 20; loser head absorbed 11 / 6 | ±5 | volume in rocked windows (`state.rocked` +0.80) |
| 48 | 18.5 strikes in the final 30 s before TKO, 92 % head | ±4 | combination cap, rocked-defender modifiers, overlap 0.40 |
| 50–52 | head sig absorbed 2.4 / min; 26 per fight; total head strikes 6.3 / min | ±0.3 / ±4 / ±0.8 | head `P_land`, 07 head share |
| 116 | reach edge win 51.7 % overall; ≥ 6.4 cm standing-heavy 60 %; > 17.8 cm 63 % | ±3 pp | `reach.perTenCm`, `classScale`, §2.8 weights |
| 120 | southpaw vs orthodox ≈ 52 % | ±3 pp | familiarity penalty, open-stance table |
| 128 | high-intensity action count −8 % R1 → R3 | ±5 % | fatigue terms on read/latency/accuracy (with 05) |
| Boxing (FD §2.6) | 51–58 thrown / 15–16 landed per round; connect 28–29 %; jab 17–20 %; power 35–36 % | ±3 pp | `glove.boxing.*` modifiers; 07 boxing volume |
| Boxing amateur | winners 33 % vs losers 23 %; ~21 punches/min; 3.6 defences/min | ±3 pp | skill-gap `k`, tier tables |
| Kickboxing (FD §2.6) | 63 % upper / 37 % lower limb; 57 % head; HIA 2.2 s bursts, 25–27 per 3-min round | ±5 pp | 07 mix; exchange cadence 400–700 ms |
| MTK §10.3 (T3 vs T3 sanity) | low kicks land ≈ 60 % *clean*, body kicks 50 % clean, head kicks 25 %, catches on ≈ 10 % of body kicks, sweeps on 45 % of catches | ±5 pp | `P_land` minus partial share; `def.kick_catch` 0.28 × chosen-rate; catch tree |
| LB §5.3 (amateur boxing) | jab 0.28; cross/hooks 0.33–0.40; footwork defence 0.70, arm/trunk ≈ 0.5 | ±5 pp | tier T2 rows; `def.step_back` 0.65 vs `def.block_high` 0.62 / slips 0.48–0.55 |

Calibration procedure specific to this section: (1) solve `pA` per technique against the reference defender
(§2.6.1); (2) run T4-vs-T4 batches and check rows 3, 15–17, 25–26; (3) sweep tiers T2–T5 pairwise and check the
FD §5 accuracy priors (equal-tier accuracy should *rise slightly* as tier falls); (4) hand `StrikeImpact` streams to
05 and jointly fit rows 36–38 and 27–29; (5) boxing ruleset batch vs CompuBox rows.

---

## 6. Assumptions and open questions

Every `[E]` in this section is a registry entry in §4 (or a catalogue cell in §2.2–2.5 tagged [E]); they are grouped
here by what they assume, with the tradeoff stated. Default is realism.

1. **Range geometry in metres** (`p.strike.geom.*`, `p.strike.range.*`). BOX §9.11 warns all metre values are
   estimates and bands should be ordinal. We keep metres so that reach differences produce asymmetric bands, and
   calibrate the additive constants (`jabReachAdd = 0.37` etc.) against the rendered rig, not against data.
2. **Cage zones, cut-off geometry and fail rates** (`p.strike.cage.*`, `p.strike.cutoff.*`). Fail rates 0.30 / 0.60
   are BOX's own estimates; the mirroring-angle test and 0.5 s arming are ours. No published data on cage cutting.
3. **Per-technique P_land splits** inside "power" and inside "leg"/"body" are estimates around measured aggregates
   (BOX §9.1, MTK §10.1). The `pA` numbers are derived from those estimates and the reference defender's assumed
   defence mix; the solve in §5 step 1 is authoritative.
4. **Execution times** are bracketed from lab cycle times (442 / 667 ms, 1.02 s kick with step), Boxing Science's
   183 ms rear hand and 60–100 ms contact, and the 180 ms/punch record (BOX §9.3; MTK §10.2). Per-technique ms are
   estimates inside those brackets.
5. **Telegraph ms**, **read slopes** (`read.telegraphSlope`, `read.leadBaseMs`, `read.leadTelegraphFrac`) and the
   **latency model** (`react.*`) are design numbers that reproduce the qualitative literature (simple RT equal
   across tiers; experts pick up cues 50–100 ms earlier; unfeinted jabs cannot be reacted to). The 60 ms choice cost
   is a placeholder — the only measured choice RTs (LB §4.7, ≈ 0.8–0.9 s on video) are not transferable.
6. **Defence success bases** are back-solved from connect rates and coaching descriptions (BOX §9.2; MTK §10.3); no
   public measurement exists. A sparring-annotation study would replace them. `def.block_high` 0.62 in MMA comes from
   MIS's "block ×0.67" which is itself directional.
7. **Feint bite / bonus / habituation** (`feint.*`) — bite endpoints from LB §4.5 (fencing eye-tracking), interior
   interpolated; bonus from BOX B7 (estimate). Habituation −0.7 logit per repeat is ours.
8. **Rhythm detection** (`rhythm.*`) — cadence derived from cycle times; the half-beat window and thresholds are ours.
9. **Counter bonuses and windows** (`ctr.*`) — BOX D14–D17 magnitudes are estimates; window fractions after
   blocked/landed strikes are ours. Closing-speed constants (`kClose`, `stepInSpeed`, `lungeSpeed`) are chosen to
   reproduce BOX's ×1.25 / ×1.5 and are consistent with `F ∝ Δv`.
10. **Placement distribution** (`placement.*`) — entirely a design distribution. It is constrained only through the
    joint fit with 05 on knockdown rate per landed power head strike (3.9 %) and the Pierce force distribution. The
    assumed split P(KD | flush / solid / partial) = 0.12 / 0.04 / 0.01 is an open question for 05.
11. **Force scale mismatch with 05** — our `F` is in-fight delivered force (Pierce scale, median ≈ 950 N landed);
    DP §3.1 anchors rotational acceleration on a 3427 N lab punch. One of the two references must move
    (`force.refFlushCross = 1400` N is our proposal). Resolved in the joint calibration of §5 rows 36–38.
12. **Force multipliers** (`force.powerSlope`, `massExp*`, `commit*`, `speed*`) — directions from LA (Loturco,
    Lenetsky, Walilko effective mass; Pierce's null on mass); magnitudes ours. Tier multipliers are derived from
    Smith 2000 / Dinu 2020 / MTK §6 but the T1–T3 interior points are interpolated.
13. **Sub-location weights** — anchored only on KO-location shares (Hutchison), which describe KO-quality landings,
    not all landings.
14. **Reach accuracy term** (`reach.*`) — set small on purpose; peer-reviewed data say ≈ 0 outside heavyweight. The
    class scaling and cap are ours. Playability note: users will expect reach to matter more than it does; the
    technique-mix weights make it *visible* without making it decisive.
15. **Stance familiarity** (`stance.exposureThreshold`, `nonSwitchPenalty`) — mechanism from analyst literature
    (MIS §11), not peer-reviewed; the threshold and non-switcher penalty are ours.
16. **Tier tables** (§3) — MTK's 5 tiers were mapped onto our 6; T0 tells have no quantitative study (LB §7.5) and
    are judgement calls with visible-behaviour intent.
17. **Stat-counting rules** (`stat.*`) — whether checked kicks and blocked strikes are "landed" in UFCStats is not
    documented; we chose the interpretation that reproduces 80 % leg accuracy. If wrong, `P_land` for kicks must
    drop to ≈ 0.60 and checks become misses.
18. **Boxing-glove modifiers** — derived from CompuBox vs UFC marginals, which mix a counting convention (pawing
    jabs thrown) with a physical effect (bigger gloves block). We do not separate the two.
19. **Guard posture matrix** — BOX C11 estimates converted to logits; `guard.low_hands`, `guard.square_wrestler`
    and `guard.cover_turtle` rows are ours.
20. **Sub-tick ordering** — the 100 ms tick is coarser than a jab (130 ms startup); the sub-tick offset scheme is a
    design choice to keep the existing tick without a finer simulation step. If strike-on-strike ordering proves
    visually wrong, a 50 ms tick for the striking resolver is the fallback (cost ≈ 2× resolver work).
21. **Open questions for other sections**: (a) 05 — reference force and P(KD | placement) (items 10–11); (b) 03 —
    which elbows/knees at `range.close` without a tie count as clinch strikes for the stat model; (c) 03 — whether
    `def.kick_catch` → takedown uses our 0.55 or its own single-leg table +0.20; (d) 07 — default defence-selection
    policy (§2.4.3) and feint cadence; (e) 06 — the `significant` flag rule and eye-poke handling for `guard.long`;
    (f) 01 — final sub-skill names (§1.2) and whether `striking.read` is a sub-skill or a derived quantity of
    `fightIQ` and years trained.
