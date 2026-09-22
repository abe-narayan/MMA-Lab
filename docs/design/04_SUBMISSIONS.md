# SECTION 04 — Submissions (the submission battle system)

Binding conventions: `docs/design/00_CONVENTIONS.md`. Provenance tags: `[S: FILE §n]` sourced, `[D: …]` derived (arithmetic shown once), `[E]` estimate (all `[E]` repeated in §9). Times in **ms** unless a research quote is repeated in seconds. Probabilities are **logit-additive** on a **T4-vs-T4, fresh, neutral** base. Research file abbreviations: `SUBMISSIONS` = `research/SUBMISSIONS.md`, `SUB_FINISH` = `research/SUBMISSION_FINISH_DATA.md`, `SUB_PHYS` = `research/SUBMISSION_PHYSIOLOGY_DATA.md`, `SUB_COACH` = `research/SUBMISSION_COACHING_SOURCES.md`, `FIGHT_DATA` = `research/FIGHT_DATA.md`, `BJJ_POS` = `research/BJJ_POSITIONS.md`, `RULES` = `research/RULES_JUDGING.md`, `DAMAGE` = `research/DAMAGE_PHYSIOLOGY.md`.

**Baseline mapping.** `SUBMISSIONS §2` quotes every per-stage probability "vs a competent defender of equal skill = Advanced tier (UFC roster, SUBDEF 60–79)". That tier is the UFC-average population our conventions call **T4** (sub-skill 70–90, "Elite / UFC level"); the research's "Elite (80–100)" is our **T5**. The research base values are therefore used unchanged as T4-vs-T4 bases `[D: tier mapping SUBMISSIONS §4 → 00_CONVENTIONS §3, no numeric change]`. Where this section changes a research value to hit a `FIGHT_DATA` calibration row, the change is tagged `[D]` with the reason.

---

## 0. Identifiers introduced or referenced by this section

### 0.1 Position ids referenced (for §03 reconciliation)

Ids follow conventions §5. Suffix `_bottom` on guard nodes is part of the **node name** (the guard player is underneath); the attacker's role in each catalogue entry is given separately as `role: top | bottom | either`. **§03 owns the nodes and its ids are authoritative**: `03_GRAPPLING_STATE_GRAPH.md §2.2.13` carries the alias map from every id below to the §03 id (e.g. `pos.ground_side_control` → `pos.ground_side`, `pos.leg_saddle` → `pos.ground_saddle`, `pos.leg_50_50` → `pos.ground_5050`, `pos.standing_sprawl` → `pos.td_sprawl`, `pos.ground_scramble` → `pos.scramble`, `pos.ground_mount_gnp` → any mount node with `posture = 'postured'`, `pos.ground_back_crucifix`/`pos.ground_crucifix_side` → `pos.ground_crucifix` with an origin flag). The implementation resolves the alias once at load time. `BJJ_POS` id = the research node id.

| Position id | BJJ_POS id / definition | Submission relevance |
|---|---|---|
| `pos.standing_long` | — / neutral striking range, both standing | flying triangle / flying armbar (entry only) |
| `pos.clinch_collar_tie` | — / single or double collar tie, standing | standing guillotine (snap-down), flying attacks |
| `pos.clinch_over_under` | — / over-under standing clinch | standing kimura (whizzer arm), standing arm-triangle |
| `pos.clinch_whizzer` | — / one fighter has an overhook (whizzer) on a single-leg or in the clinch | standing kimura / kimura-trap grip |
| `pos.clinch_rear_body_lock` | `BACK_STANDING` / standing rear body lock | standing RNC (rare) → mat return to `pos.ground_back_hooks` |
| `pos.standing_front_headlock` | `FRONT_HEADLOCK` (standing variant) / attacker upright, opponent bent with head controlled | standing guillotine, guillotine (jump guard), D'Arce/anaconda after a drop |
| `pos.standing_sprawl` | `SPRAWL` / post-shot sprawl, attacker's hips back | guillotine, D'Arce, anaconda, front headlock family |
| `pos.ground_front_headlock` | `FRONT_HEADLOCK` / kneeling or sprawled front headlock over a turtled/kneeling opponent | guillotine family, D'Arce, anaconda, Peruvian necktie, Japanese necktie |
| `pos.ground_turtle` | `TURTLE` / bottom on hands and knees, top beside/behind | back take → RNC, anaconda/D'Arce on turn-in, crucifix, bulldog, rolling toe hold |
| `pos.ground_scramble` | `SCRAMBLE` / neither has control | guillotine / front-headlock chokes for whoever wins the head |
| `pos.ground_mount_low` | `MOUNT_LOW` | arm-triangle (cross-face), Ezekiel top, americana |
| `pos.ground_mount_high` | `MOUNT_HIGH` | armbar, arm-triangle, mounted triangle, mounted guillotine, americana |
| `pos.ground_mount_s` | `MOUNT_S` | armbar (primary), mounted triangle |
| `pos.ground_mount_technical` | `MOUNT_TECH` | armbar (far arm), arm-triangle, back take → RNC |
| `pos.ground_mount_gnp` | `MOUNT_GNP` sub-state / top postured, striking | armbar vs straight-arm push (bottom mistake), Ezekiel from bottom (bottom attacks a low, heavy top only) |
| `pos.ground_back_hooks` | `BACK_HOOKS` | RNC, short choke, armbar from back, rear triangle, neck crank, Suloev stretch |
| `pos.ground_back_body_triangle` | `BACK_BODY_TRI` | RNC, arm-in RNC |
| `pos.ground_back_one_hook` | `BACK_ONE_HOOK` | rushed RNC, twister, truck entry |
| `pos.ground_back_seatbelt_no_hooks` | `BACK_SEATBELT_NOHOOKS` | RNC if chin exposed, crucifix entry |
| `pos.ground_back_crucifix` | `BACK_CRUCIFIX` | one-arm RNC, crucifix crank/armlock, neck crank |
| `pos.ground_crucifix_side` | `CRUCIFIX_SIDE` | crucifix armlock, arm-in chokes |
| `pos.ground_truck` | — / 10th-Planet "truck" (twister side control: one leg triangled, back partially taken) | twister, calf slicer, banana split |
| `pos.ground_side_control` | `SIDE_CONTROL` | arm-triangle (side), kimura, americana, D'Arce/anaconda on turn-in, north-south choke, von Flue (when bottom holds a guillotine) |
| `pos.ground_side_control_wall` | `SIDE_CONTROL_WALL` | as side control (cage modifier) |
| `pos.ground_kesa_gatame` | `KESA_GATAME` | scarf armlocks, bulldog-type head/arm cranks |
| `pos.ground_reverse_kesa` | `REVERSE_KESA` | kimura |
| `pos.ground_knee_on_belly` | `KNEE_ON_BELLY` | far-arm armbar, D'Arce on turn-in |
| `pos.ground_north_south` | `NORTH_SOUTH` | north-south choke, north-south kimura, spinning armbar |
| `pos.ground_half_flat` | `HALF_FLAT` | top: arm-triangle, D'Arce, kimura; bottom: kimura, guillotine, Ezekiel (bottom) |
| `pos.ground_half_knee_shield` | `HALF_KNEE_SHIELD` (= Z-guard) | bottom: kimura, triangle, SLX/leg-entanglement entries |
| `pos.ground_half_underhook` | `HALF_UNDERHOOK` | bottom: back take (→ RNC), kimura-trap; top: D'Arce over the underhook |
| `pos.ground_half_dogfight` | `HALF_DOGFIGHT` | top (whizzer side): guillotine, D'Arce; bottom: kimura on whizzer |
| `pos.ground_half_deep` | `HALF_DEEP` | top: kimura; bottom: sweeps only |
| `pos.ground_half_lockdown` | `HALF_LOCKDOWN` | bottom: electric chair / banana split |
| `pos.ground_half_butterfly` | `HALF_BUTTERFLY` | bottom: SLX entries → leg locks |
| `pos.ground_closed_guard_bottom` | `CLOSED_POSTURE_UP` / closed guard, top postured | bottom: kimura on a posting arm; (armbar/triangle only after posture break) |
| `pos.ground_closed_guard_broken` | `CLOSED_POSTURE_BROKEN` / closed guard, top's posture broken | bottom: triangle, armbar, kimura, guillotine, omoplata; top: can opener, Ezekiel top (rare) |
| `pos.ground_high_guard` | `CLOSED_HIGH_GUARD` | bottom: triangle, armbar, omoplata |
| `pos.ground_rubber_guard` | `CLOSED_RUBBER` | bottom: gogoplata, omoplata, triangle |
| `pos.ground_closed_guard_standing_top` | `CLOSED_STANDING_TOP` / top has stood in closed guard | bottom: kneebar / heel hook via SLX entry; slam window for the top |
| `pos.ground_open_guard_kneeling_top` | `OPEN_GUARD_KNEELING_TOP` | bottom: armbar, triangle, omoplata |
| `pos.ground_open_supine_legs_up` | `OPEN_SUPINE_LEGS_UP` | bottom: SLX / ankle-lock entries |
| `pos.ground_butterfly` | `BUTTERFLY` | bottom: guillotine (rare), arm-drag → back; top: guillotine/D'Arce on head-down entries |
| `pos.ground_seated_shin_to_shin` | `SEATED_SHIN_TO_SHIN` | bottom: SLX / ankle attacks |
| `pos.ground_x_guard` | `X_GUARD` | bottom: leg-lock entries |
| `pos.leg_ashi_slx` | `SLX` / single-leg X, ashi garami | straight ankle lock, outside heel hook (ruleset), toe hold |
| `pos.leg_outside_ashi` | — / outside ashi garami (attacker's outside leg across the hip, knee line blocked) | outside heel hook, ankle lock |
| `pos.leg_saddle` | — / inside sankaku, 411, "honey hole" | inside heel hook, kneebar, calf slicer, toe hold |
| `pos.leg_50_50` | — / 50-50 leg entanglement (mutual access) | heel hooks (both fighters), ankle lock, toe hold, back take |
| `pos.leg_cross_ashi` | — / cross ashi garami | outside heel hook, kneebar |
| `pos.ground_hq` | `HQ` / headquarters passing position | bottom: SLX / 50-50 entries if the top leg is exposed |
| `pos.ground_cage_seated_bottom` | `CAGE_SEATED_BOTTOM` | top: guillotine if the bottom ducks in |

### 0.2 Skill ids used (for §01 reconciliation)

| Skill id | Meaning | Used as |
|---|---|---|
| `sk.chokes` | `0.5 × bjj.chokes + 0.5 × subAttack` where `subAttack` (SUB) is the §01 §2.7 composite `[E: blend]`; `bjj.chokes` is the §01 effective value across disciplines | attacker skill for `family: choke` |
| `sk.jointLocks` | `0.5 × bjj.jointLocks + 0.5 × subAttack` `[E]` | attacker skill for `family: jointLock` |
| `sk.legLocks` | `0.5 × bjj.legLocks + 0.5 × subAttack` `[E]` (§01 transfers sambo.legLocks) | attacker skill for `family: legLock` |
| `sk.cranks` | neck/spine crank and compression-lock skill; default = `0.7·sk.chokes + 0.3·sk.jointLocks` `[E]` | attacker skill for `family: crank` and `family: compression` |
| `sk.escapes` | `subDefence` (SUBDEF), the §01 §2.7 composite `0.7 × bjj.subDefence + 0.2 × bjj.escapes + 0.1 × mmaIntegration.subDefenceUnderStrikes` | defender skill at every stage |
| `sk.control` | `bjj.top_control` (§03 alias of `max(bjj.topControl, wrestling.topControl)`) | attacker skill in the **setup** stage from top positions; defender skill against bottom attacks' setup |
| `sk.guard` | `bjj.retention` (§03 alias of `bjj.guard`) | attacker skill in the setup stage from bottom positions; defender skill against top attacks' setup |
| `sk.scramble` | `wr.scramble` (§03) | tie-break in `pos.ground_scramble` outcomes |

§01 resolves each `bjj.*` as the fighter's *effective* value across disciplines with its transfer factors (`xfer.*`); this section consumes the effective values only. **Tier** for the ladders in §2.6 and §6 is the fighter's bjj tier from §01 (conventions §3 bands); §01's `beh.sub.untrained_no_tap` (SUBDEF < 20) is this section's T0 behaviour.

### 0.3 Other ids introduced

| Id family | Examples | Defined in |
|---|---|---|
| `sub.*` | `sub.rnc`, `sub.guillotine_high_elbow`, `sub.heel_hook_inside` | §3 catalogue |
| `def.*` | `def.hand_fight`, `def.stack`, `def.hitchhiker`, `def.slam` | §2.5 |
| `state.*` | `state.sub_attempt`, `state.sub_attacking`, `state.sub_defending`, `state.sub_locked`, `state.post_loc_symptoms` (this section's transient states); the physiological outcomes use §05's ids: `state.choked_out` (was `state.unconscious`), `state.joint_failure[joint]` (was `state.injured_limb`), `state.neck_cranked` (was `state.neck_strain`; the cumulative 0–1 strain value is carried as its severity) [REVIEW: aliased to 05 §2.3.8 / §2.10 so referee, career layer and presentation see one vocabulary] | §2.1, §2.6 |
| `evt.*` | `evt.sub_attempt_logged`, `evt.tap`, `evt.technical_submission`, `evt.injury`, `evt.slam`, `evt.sub_escape`, `evt.sub_chain` | §2.9 |
| `edge.sub.*` | `edge.sub.tri_to_armbar` | §4 chain graph |
| `param.sub.*` | `param.sub.k_skill_entry` | §7 registry |

**Submission-id aliases used by §03.** §03's node tables reference family-level ids; they resolve to this catalogue by the node the attack is entered from: `sub.armbar` → `sub.armbar_guard` (guard nodes) / `sub.armbar_mount` (mount nodes) / `sub.armbar_back` (back nodes) / `sub.armbar_belly_down` (side, KOB, N-S); `sub.triangle` → `sub.triangle_guard`; `sub.mounted_triangle` → `sub.triangle_mounted`; `sub.mounted_guillotine` → `sub.guillotine_mounted`; `sub.arm_triangle` → `sub.arm_triangle_mount` (mount) / `sub.arm_triangle_side` (side, half, kesa); `sub.kimura` → `sub.kimura_guard` / `sub.kimura_half` / `sub.kimura_side` / `sub.kimura_north_south` / `sub.kimura_grip` by node; `sub.ezekiel` → `sub.ezekiel_top` / `sub.ezekiel_bottom` by role; `sub.neck_crank` → `sub.neck_crank_rear` (back nodes) / `sub.neck_crank_generic`; `sub.straight_ankle` → `sub.ankle_lock_straight`; `sub.crucifix_shoulder_lock` → `sub.crucifix_armlock`; `sub.electric_chair` → `sub.banana_split` (lockdown entry); `sub.guillotine` (unqualified) → `sub.guillotine_standard`.

---

## 1. Purpose and scope

This section owns everything that happens from the moment a fighter **commits** to a submission until it ends in a tap, unconsciousness, injury, escape, abandonment or the bell:

1. the four-stage battle model (setup → entry → secure → finish) with contested rolls, durations, modifiers and the defender's per-stage options (§2.2–2.5);
2. finish mechanics — choke time-to-unconsciousness, the tap decision, referee detection lag, joint-lock pain/refusal/injury, heel-hook no-warning, slams as counters (§2.6);
3. a catalogue of 54 submissions with per-stage data (§3), the chain graph (§4) and the ruleset legality matrix (§5);
4. behaviour by tier (§6), the parameter registry (§7), calibration hooks (§8) and assumptions (§9).

**Interfaces.**

| Direction | Section | What crosses the boundary |
|---|---|---|
| in | §01 attributes/skills | `bjj.*` effective sub-skills and the `subAttack`/`subDefence` composites (§0.2); physical attributes (strength, flexibility, reachM, legReachM, massKg, cardio, `neck`); mental (heart, composure, fightIQ, discipline); `stubbornness`, `refusesToTap`, `pro.subLosses` (§01 §2.7.7); style flags `style.subHunter`, `style.wrestlerGnp` (§01 style catalogue) |
| in | §03 ground/positions | current node id, attacker role, node control value `ctrl` (0–10, `BJJ_POS §2`), **trigger events** (`evt.arm_crossed_centre`, `evt.hand_posted`, `evt.back_taken`, `evt.sprawl_front_headlock`, `evt.step_over_guard`, `evt.turn_away`, `evt.posture_broken`, `evt.underhook_from_bottom`, `evt.head_down_standing`), `strikesLandedLast5s`, `nearFence`, `underhookOwner` |
| out | §03 | on any non-finish outcome: the **return node** for both fighters (§2.7 outcome routing); positional side effects of chains (sweep, back take) |
| in | §05 damage/physiology | `fatigue f` (0–1), `state.rocked`, `structuralHead`, `bloodFlag`; from §01: `neck` (0–100), `stubbornness`, `refusesToTap`, `pro.subLosses` |
| out | §05 | `evt.slam` impact spec (§2.6.6); `state.unconscious` (choke LOC), `state.injured_limb`, `state.neck_strain`; energy costs per stage (§2.8) |
| in/out | §06 rules/referee/judging | ruleset flags (§5): `subLegality[sub]`, `slamsLegal`, `spikingLegal`, `glovesMma`, `strikesLegal`, `refereeStopsOnLoc`, `techSubEnabled`; out: `evt.sub_attempt_logged` (UFCStats-style attempt for judging), `evt.near_submission` (judging "visible distress") |
| in | §07 strategy & AI | the attempt decision (§6.1 gives the policy; the AI section may override selection weights) |
| out | commentary/animation | stage/variant/outcome events (§2.9) |

Out of scope here: how positions are reached (§03), ground striking damage (§05), takedowns/mat returns (§03 with the wrestling edges), judging weights (§06), fighter decision policy beyond §6.1 (§07).

---

## 2. Model

### 2.1 Entities and states

```
SubmissionSpec {                       // one per catalogue entry (§3); static data
  id: 'sub.rnc' …; family: 'choke'|'jointLock'|'legLock'|'crank'|'compression';
  chokeType?: 'blood'|'air'|'mixed';   // chokes only
  entries: [{pos, role, requires: [grip/control flags], trigger?: evt}];
  stages: { entry:{p, dMeanMs, dMinMs, dMaxMs}, secure:{…}, finish:{…} };
  finishClock: { tapMinMs, tapMaxMs, locMeanMs?, pBlood?, injuryDelayMinMs?, injuryDelayMaxMs?, severity?, escapeHazardPerS };
  defences: { entry:[def ids], secure:[…], finish:[…] };
  outcomes: { escape:[{pos, roleAtt, share}], abandon:{pos, roleAtt}, regress: stage };
  chains: [edge ids];  counters: [def / sub ids];  modifiers: [modifier ids];
  targetShare: number;                 // share of MMA submission finishes (calibration)
}

SubmissionAttempt {                    // live state.sub_attempt; at most one per fighter pair per role
  spec, attacker, defender, stage: 'entry'|'secure'|'finish'|'locked',
  stageElapsedMs, windowElapsedMs, chainHops, chainWindowStartMs,
  logged: boolean,                     // evt.sub_attempt_logged fired (S1 success)
  lockedAtMs?, tLocMs?, tTapMs?, stubborn?: boolean, refuse?: boolean,
  functionalChoke?: boolean,           // mixed chokes: did it become a blood choke?
  defenderChoice: def id per window
}
```

States set on fighters by this section: `state.sub_attacking`, `state.sub_defending`, `state.sub_locked` (finish clock running), `state.choked_out` (→ §05/referee; §05's id, was `state.unconscious` [REVIEW]), `state.joint_failure{side, joint, severity}` (§05's id, was `state.injured_limb` [REVIEW]), `state.neck_cranked` with severity = cumulative strain 0–1 (§05's id, was `state.neck_strain` [REVIEW]), `state.post_loc_symptoms` (cosmetic; feeds commentary and §05 `recovery_time`). Wherever the rest of this section says `state.unconscious` / `state.injured_limb` / `state.neck_strain`, read the §05 id.

### 2.2 The four stages

| Stage | Meaning (`[S: SUBMISSIONS §2.0]`) | Window `w` (ms) `[E]` | Stage clock | Attacker needs | Defender's job |
|---|---|---|---|---|---|
| **S0 setup** | position + control + a trigger that makes the attack *available* | checked every tick (100 ms) | none (continuous) | node ∈ `entries`, required grips, trigger event | positional defence (§03 edges): posture, frames, hiding limbs; T5 "S0 denial" (§6) |
| **S1 entry** | commitment: isolate the limb / thread the arm / throw the legs | 500 | `dMean` 1,000–4,000; `dMax` = 3 × `dMean` | commitment; exposes the attacker to counters on failure | early defence: pull the limb out, turn, deny the grip |
| **S2 secure** | close the lock: grip connected, angle set, posture broken, hooks/legs locked | 1,000 | `dMean` 2,000–10,000; `dMax` = 3 × `dMean` | grip strength, flexibility, correct angle | late defence: hand-fight the finishing grip, chin tuck, stack, elbow-to-hip, hide the heel |
| **S3 finish** | pressure applied until the lock is fully closed | 1,000 | `dMean` per technique; `dMax` = 3 × `dMean` | pressure direction, patience, squeeze/hip extension | last-ditch: explosive escape, slam, roll, endure to the bell |
| **locked** (finish clock) | the lock is fully closed; tap / LOC / injury clock runs (§2.6) | per second | technique clock | hold | tap, or endure (rare escape hazard) |

"S1 success" = the UFCStats-style **attempt** (`evt.sub_attempt_logged`) — the hold is applied `[S: SUBMISSIONS §5 rule 3; A1 FightMetric definition]`. `dMax = 3 × dMean` `[E]`: reaching `dMax` without advancing triggers the **stall rule** (§2.4.4).

### 2.3 The per-window contested roll

Each stage is a three-outcome hazard process resolved once per window `w` (deterministic RNG order: defender's option roll, then attacker's advance roll — see §2.4.3):

```
advance  : p_a = sigmoid( logit(p_a0) + Σ attacker modifiers )
escape   : p_e = sigmoid( logit(p_e0) + Σ defender modifiers )      // defender's own roll
hold     : otherwise (stage clock keeps running)
```

Per-window bases are **derived** from the catalogue's stage probability `P_stage` (probability that the stage is eventually won by the attacker, T4 vs T4) and mean stage duration `dMean`:

```
p_a0 = P_stage      × w / dMean            // so that  P(advance before escape) = p_a0 / (p_a0 + p_e0) = P_stage
p_e0 = (1 − P_stage) × w / dMean           // and mean stage time (no holds) = w / (p_a0 + p_e0) = dMean
```
`[D: e.g. sub.rnc S1: P=0.45, dMean=2,000 ms, w=500 ms → p_a0 = 0.1125, p_e0 = 0.1375 per window]`. If `p_a0 + p_e0 > 0.9` (short stages), rescale both by `0.9/(p_a0+p_e0)` and shorten `dMean` accordingly `[E]`. Final per-window probabilities are clamped to `[0.01, 0.97]` `[S: SUBMISSIONS §5 preamble]`.

**Modifier terms (logit units).** Every catalogue entry lists which apply (`modifiers:`). Physical attributes are on the 0–100 scale; Δ = attacker − defender.

| Modifier id | Term | Applies to | Tag |
|---|---|---|---|
| `M_SKILL` | `k_skill × (skAtt − skDef)/100`; `k_skill` = **2.0** at S1 and S2, **1.0** at S3 and on the locked-clock escape hazard; `skAtt` = family skill (`sk.chokes` / `sk.jointLocks` / `sk.legLocks` / `sk.cranks`), `skDef` = `sk.escapes` | attacker `p_a` (+), defender `p_e` (− same term) | `[D: SUBMISSIONS §5 rule 5 gives ×(1+0.02·Δ) at S1/S2, half at S3; ×1.4 at Δ=20 on p≈0.45 ≈ +0.5 logit, ×2.0 at Δ=50 saturates; 2.0/100 reproduces ×1.22 at Δ=20 and, over three stages, a 2.8× conversion gain at Δ=65 (0.45→0.75, 0.50→0.79, 0.85→0.92; product 0.54 vs 0.19), matching the early-UFC 2.2–2.6× rate ratio in SUBMISSIONS §4 once availability is included]` |
| `M_CTRL` | `+0.12 × (ctrl − 5)` where `ctrl` is the §03 node control value (0–10) of the attacker's node for top attacks; for bottom attacks use `(5 − ctrl)` of the top player's node | S1 and S2 `p_a` | `[E]` |
| `M_SETUP` | `+0.25 × min(strikesLandedLast5s, 3)` by the attacker (GnP → frames → arm across; RNC hand-fighting under punches) | S1 `p_a` of top attacks and RNC | `[S: BJJ_POS §3.3 STK]` |
| `M_CHAIN` | `+0.18` when the attempt was entered through a chain edge (§4) | S1 `p_a` | `[D: SUBMISSIONS §5 rule 22 ×1.2 on p≈0.45 → 0.54 → +0.18 logit]` |
| `M_STR_FIN` | `+0.17 × ΔSTR/10` on squeeze/rotation finishes (RNC, arm-triangle family, guillotine family, kimura, americana, ankle lock, cranks, north-south, Ezekiel, bulldog, necktie family) | S3 `p_a` | `[D: rule 13 ×(1+0.008·ΔSTR): ΔSTR=50 → ×1.4 on p≈0.5 → 0.7 → +0.85 logit → 0.17 per 10 pts]` |
| `M_STR_DEF` | `+0.17 × (STRdef − STRatt)/10` on the defender's grip-break / stack / slam / leg-clear options | S2–S3 `p_e` | `[D: same rule]` |
| `M_MASS` | `+0.08 × Δkg/5`, cap ±0.6, on pressure chokes (arm-triangle family, north-south, von Flue, mounted guillotine, buggy) | S2–S3 `p_a` | `[S: BJJ_POS §3.3 MASS]` |
| `M_NECK` | `−1.2 × (neck/100 − 0.5)` (defender's §01 `neck` attribute, 0–100; §05 uses the same attribute as `neckMult`) on all neck chokes | S2–S3 `p_a`; also `+0.5 s × (neck/100 − 0.5)/0.5` on `tLoc` | `[E]` |
| `M_NECK_GIRTH` | `−0.2 per 10 kg` of defender mass above the class mean, guillotine family and north-south | S3 `p_a` | `[D: rule 17 "HW guillotine/N-S S3 ×0.85" ≈ −0.3 logit at +15 kg]` |
| `M_LEN_LEG` | `+0.25 per 10 cm` of attacker `legReachM` above class mean, `−0.25 per 10 kg` of defender mass above class mean (torso girth proxy) — triangles, omoplata, gogoplata | S2 `p_a` | `[D: rule 15 ×(1+0.01·LEN) with LEN in cm-equivalents; ±10 cm ≈ ×1.1 ≈ +0.2–0.4 logit at p 0.45–0.55 → 0.25]` |
| `M_LEN_ARM` | `+0.25 per 10 cm` of attacker `reachM` above class mean, `−0.2 per 10 kg` of defender mass above class mean — D'Arce, anaconda, arm-triangle, necktie family, buggy | S2 `p_a` | `[D: as above]` |
| `M_FLX_ATT` | `+0.08 per 10 pts` of attacker flexibility above 50 on triangles; `+0.12 per 10` on omoplata/gogoplata/rubber-guard entries; gates: gogoplata requires flexibility ≥ 80, rubber guard ≥ 70 | S1–S2 `p_a` | `[D: rule 14 ×(0.8+0.4·FLX/100) → ±0.4 logit over 0–100 → 0.08/10; omoplata ×(0.7+0.6·FLX/100) → 0.12/10; gates S: rule 14]` |
| `M_FLX_DEF` | `+0.10 per 10 pts` of defender flexibility above 50 on kimura / americana / omoplata escapes; `+0.02 s per point above 50` added to the joint-lock injury delay | S2–S3 `p_e`; injury clock | `[D: rule 14 ×(1+0.5·FLX/100) → +0.1/10; "+1 s" at FLX 100 → 0.02 s/pt]` |
| `M_SLIP_HIGH` | `−0.6 × SLIP` for guillotine family, D'Arce, anaconda, arm-triangle, north-south, Ezekiel, heel-hook heel grip, kimura wrist grip, toe hold, omoplata | S2–S3 `p_a` | `[D: rule 10 ×(1−0.30·SLIP) on p≈0.5 at SLIP 0.8 → 0.38 → −0.49 logit → −0.6·SLIP]` |
| `M_SLIP_LOW` | `−0.2 × SLIP` for RNC, triangles, armbars, necktie family, calf slicer | S2–S3 `p_a` | `[D: rule 10 ×(1−0.10·SLIP)]` |
| `SLIP` (state) | `SLIP = clamp(0.2 + 0.001 × tFightS, 0.2, 0.9) + 0.1 × bloodFlag + 0.1 × [class ≥ LHW]`, cap 1.0 | — | `[D: rule 10 gives R1 0.2 / R2 0.5 / R3+ 0.8 → linear 0.2 + t/1000; +0.1 blood; HW/LHW +0.1 rule 17]` |
| `M_FAT_ATT_GRIP` | `−0.85 × fAtt` for grip-heavy attacks (guillotine family, kimura, D'Arce/anaconda, ankle lock, toe hold, north-south, Ezekiel) | S2–S3 `p_a` | `[D: rule 11 ×(1−0.4·FAT) at FAT 1 on p 0.5 → 0.3 → −0.85 logit]` |
| `M_FAT_ATT` | `−0.3 × fAtt` for all other attacks | S2–S3 `p_a` | `[D: rule 11 ×(1−0.15·FAT) → −0.3 logit]` |
| `M_FAT_DEF` | `+0.5 × fDef` on attacker `p_a` at S1–S2 and `−0.7 × fDef` on defender `p_e` at S1–S2 (tired fighters stop hand-fighting and give the back) | S1–S2 | `[D: rule 11 defender defence ×(1−0.5·FAT) → −0.7 logit on p_e; the attacker-side +0.5 keeps P_stage consistent with the multiplicative rule]` |
| `M_ROCKED` | `+1.0` on attacker `p_a` at every stage while the defender is `state.rocked`; the defender's option set is restricted to *late* options (§2.5) and their `p_e` gets `−0.7`; additionally `+0.006 × structuralHead` (cap +0.6) | all stages | `[D: rule 12 ×1.6 on p 0.45 → 0.72 → +1.15 logit; defender "tier one lower" ≈ −0.7; structural term E]` |
| `M_GLOVES` | MMA gloves (`glovesMma`): RNC uses the palm-to-palm/short variant 50 % of the time with S3 `−0.1`; kimura and toe-hold grips `−0.1`; defender hand-fighting options `−0.15` on `p_e`; Ezekiel-from-bottom enabled only when true | per catalogue | `[S: rule 16 for ×0.9 → ≈ −0.1 logit; defender −0.15 E]` |
| `M_CLASS` | flyweight/bantamweight: triangle and armbar S1 `+0.1`; women's divisions: attempt rate ×1.15 (§6.1) | S1 | `[D: rule 17 ×1.1 → +0.1 logit; ×1.15 S: rule 17]` |
| `M_CAGE` | defender's shoulders on the fence (`nearFence` and top attacker): `+0.3` on S2 for top attacks (no hip escape); bottom attacker against the fence: `−0.3` on S2 for guard attacks (cannot cut the angle) | S2 | `[E]` |
| `M_WRONG_DEF` | `+0.8` on `p_a` when the defender's chosen option is `def.none` or a mis-timed option (§2.5 "wrong" column) | stage of the choice | `[E, anchored on SUBMISSIONS §4 Untrained "0.10× base" / Novice "0.4× at S1"]` |
| `M_MUTUAL` | 50-50 / cross-ashi: both fighters run attempts concurrently (§2.6.6) | — | `[S: rule 21]` |

Sum the applicable terms; nothing else multiplies. The stage clock advances every tick regardless of the outcome.

### 2.4 Stage resolution rules

#### 2.4.1 Setup (S0) — availability and the attempt decision
A submission is *available* on a tick when the attacker is in one of its `entries` nodes with the listed role, the listed grips/controls are true in §03 state, and (where listed) the trigger event fired within the last 3,000 ms `[S: SUBMISSIONS §5 rule 1; 3 s window E]`. Availability ≠ attempt: the attempt decision is in §6.1 (`pAttempt`). Some entries are **continuous** (no trigger: RNC from `pos.ground_back_hooks`, heel hooks from `pos.leg_saddle`, von Flue when the grip persists); for those the decision is re-evaluated every decision-latency interval (§6.1).

#### 2.4.2 Entry, secure, finish (S1–S3)
Each window: (1) the defender selects an option from the stage's list (§2.5, AI policy §6.3); (2) compute `p_e` for that option, roll `u_def`; on success apply the option's outcome distribution (escape → return node; regress → previous stage with stage clock reset; hold → nothing); (3) if no escape/regress, compute `p_a`, roll `u_att`; on success advance one stage (S1 → S2 fires `evt.sub_attempt_logged`; S3 → `locked` fires `evt.sub_locked` and starts the finish clock §2.6); (4) accrue energy (§2.8). Both fighters remain in their §03 node throughout; §03 edges are suspended for the pair while `state.sub_attempt` exists except the counters listed in the catalogue (slam, strikes, counter-submission), which are resolved as defender options here.

#### 2.4.3 Roll order and determinism
Per window, in this order from the seeded RNG: `u_def`, `u_att`, then any outcome-split draw, then chain draw — always four draws per window, consumed whether or not each applies (09 §2.7 [REVIEW]); the lock-time draws (`pGoOut` uniform, `tLoc` normal = 2 calls, `tTap` uniform) are taken once at `lockedAtMs` in that order. In a mutual-exposure entanglement (§2.6.6) the fighter with the higher `sk.legLocks` resolves first; ties → lower fighter index `[E]`.

#### 2.4.4 Stall and abandon
When `stageElapsedMs ≥ dMax`, each further window the attacker rolls **abandon** with `pAbandon = 0.35 − 0.25 × patience` where `patience = clamp((sk_family − 50)/50, 0, 1) × (1 − 0.5 × fAtt)` `[E]`; a `style.subHunter` halves `pAbandon`; a T≤1 attacker never abandons voluntarily (§6). Abandon → the catalogue's `abandon` node (usually the origin position retained for top attacks; guard retained for bottom attacks). Long, stalled triangles (30–60 s) are produced by this rule with `dMax` = 3 × 6,500 ms plus the re-rolls `[S: SUBMISSIONS §2.6 "held 30–60 s"]`.

#### 2.4.5 Bell
At round end: `locked` attempts whose finish clock has not reached `tTap`/`tLoc`/injury time are released (defender saved); S1–S3 attempts are released with both fighters standing `[S: rule 9]`. Target: ≈ 3 % of locked submissions saved by the bell `[S: rule 9 ESTIMATE]`.

### 2.5 Defender options (`def.*`)

Each option: stages it can be chosen in, the shift it applies to the attacker's `p_a` (`Δa`, logit), the shift on the defender's own `p_e` (`Δe`, logit; the base `p_e0` already assumes the *standard* option at that stage, so the standard option has `Δe = 0`), the outcome split when `p_e` succeeds, minimum tier that knows it (§6), energy cost class (§2.8), and the "wrong" condition (choosing it there applies `M_WRONG_DEF` instead). Escape destinations use the catalogue's `outcomes.escape` list unless the option names a specific node. All `Δ` values `[E]` unless tagged; outcome splits `[S: SUBMISSIONS §2.x escape shares]` are cited per catalogue entry.

| Option id | Stages | Δa | Δe | Outcome on success | Min tier | Cost | Wrong when |
|---|---|---|---|---|---|---|---|
| `def.none` | any | +0.8 (`M_WRONG_DEF`) | −2.0 | hold | T0 | low | always (T0 default; also the rocked/exhausted default) |
| `def.tap` | S3, locked | — | — | `evt.tap` (fight ends) | T1 | — | never (early taps are a tier behaviour, §6) |
| `def.posture_up` | S1, S2 | −0.3 | 0 (S1) / −0.4 (S2) | escape → origin guard node, attacker keeps guard (bottom attacks: triangle, armbar, guillotine, omoplata, gogoplata, kimura from guard) | T1 | med | S3 of triangle/armbar (arm already straight / lock closed) |
| `def.hand_fight` | S1, S2 | −0.3 | 0 | regress one stage (RNC, arm-triangle, guillotine, north-south, Ezekiel, neck cranks); 20 % escape → attacker's back control retained with hooks cleared (RNC) | T2 | med | S3 once the second hand is in (`Δa` becomes 0) |
| `def.two_on_one` | S1 (RNC, rear cranks) | −0.4 | +0.2 | regress to S0 (attacker keeps back control); `M_GLOVES −0.15` | T2 | med | S2/S3 |
| `def.chin_tuck` | S1, S2 (all neck chokes) | −0.2 | −0.2 | hold (buys time: adds +1,000 ms to `dMax`) | T1 | low | not wrong, but weak alone; T1 default |
| `def.answer_phone` | S1 (guillotine), S2 (triangle, arm-triangle) | −0.3 | 0 | regress one stage; guillotine: 30 % escape → pass to side control on the choking side | T2 | low | S3 (lock closed) |
| `def.walk_weak_side` | S2, S3 (guillotine family) | −0.4 | +0.3 | escape → `pos.ground_side_control` (defender top, on the choking-arm side) 50 % / stand up 25 % / attacker abandons to keep guard 25 % `[S: SUBMISSIONS §2.2]` | T3 | high | standing guillotine (use `def.posture_up`/`def.lift_and_dump`) |
| `def.stack` | S2, S3 (triangle, armbar from guard, guillotine from guard, omoplata) | −0.3 | 0; `M_STR_DEF` | escape: triangle → stack-pass to `pos.ground_side_control` 25 % / posture out to guard 55 % / round-end 10 % `[S: §2.6]`; armbar → side control 25 %, guard 45 % `[S: §2.7]` | T2 | high | vs mounted/back variants (no stack possible) |
| `def.hitchhiker` | S2 (armbar, all variants); locked (armbar) at 0.25× | −0.2 | +0.2 (S2) / −1.5 (locked) | escape → top position: `pos.ground_side_control` (guard armbar) / `pos.ground_half_flat` top (mount armbar) / `pos.ground_half_flat` top (back armbar), 15 % share `[S: §2.7 "hitchhiker/spin-out 15 %"]`; fails outright if the attacker chains to a triangle (`edge.sub.armbar_to_tri`) | T3 | med | once the arm is straight (locked) `[S: SUB_COACH armbar]` |
| `def.grip_clasp` | S2 (armbar, kimura, americana) | −0.4 | 0 | hold; every 3 consecutive holds regress to S1 | T2 | med | S1 (elbow can still be pulled) |
| `def.pull_elbow` | S1 (armbar, kimura, americana, arm-triangle S0/S1) | −0.3 | 0 | regress to S0 (position retained by whoever had it) | T2 | low | S2+ |
| `def.straighten_arm` | S1, S2 (kimura, americana) | −0.3 | 0 | escape → same position 60 % / hold 40 % `[S: §2.8]`; risk: `edge.sub.kimura_to_armbar` / `edge.sub.americana_to_armbar` fires on 25 % of successes `[S: §3]` | T2 | low | S3 (rotation begun) |
| `def.roll_with` | S2, S3 (kimura, D'Arce, anaconda, omoplata forward roll, toe hold, heel hook direction-correct roll, twister) | −0.2 | +0.2 | escape distributions per catalogue (roll-through often reverses: D'Arce 20 % → attacker on bottom half guard; kimura 25 % → attacker keeps grip and ends on top = "kimura trap" `[S: §2.3, §2.8]`) | T3 | high | heel hook rolled the wrong way → `Δa +0.6` (tightens it) `[S: SUB_COACH heel hooks "rolling away tightens it"]` |
| `def.spin_out` | S2 (armbar), S3 (armbar at 0.3×) | −0.2 | 0 | escape → top of a scramble `pos.ground_scramble` | T3 | high | locked |
| `def.clear_hooks_turn_in` | S0/S1 (RNC, rear triangle, back armbar) | −0.3 | 0 | escape → attacker's guard/half guard (`pos.ground_closed_guard_bottom`, attacker bottom) 55 % / turtle-and-stand 25 % / roll over the shoulder → top of scramble 10 % / round end 10 % `[S: §2.1]` | T2 | high | body triangle locked (`Δe −0.7`) |
| `def.slide_to_choking_side` | S3 (RNC) | −0.2 | +0.3 | escape → same split as `clear_hooks_turn_in` | T3 | high | — |
| `def.turn_in_bridge` | S2, S3 (arm-triangle, north-south, americana, bulldog, kesa attacks) | −0.3 | 0 | escape → attacker's guard/turtle 50 % / attacker retains side control or mount without the choke 40 % / reversal 10 % `[S: §2.5]` | T2 | high | — |
| `def.swim_arm` | S1, S2 (D'Arce, arm-in guillotine, Japanese necktie) | −0.4 | +0.2 | escape → bottom half guard (arm free) 40 % `[S: §2.3]` | T3 | med | S3 |
| `def.go_flat` | S1 (D'Arce, anaconda) | −0.3 | +0.1 | regress to S0 (attacker must post; front headlock retained) `[S: SUB_COACH brabo defence]` | T3 | low | S2+ |
| `def.post_against_roll` | S2 (anaconda gator roll, D'Arce walk-around) | −0.4 | +0.2 | escape → turtle 40 % / reverse onto top 20 % `[S: §2.4]` | T3 | high | — |
| `def.head_up_sit_out` | S0/S1 (front-headlock family) | −0.3 | 0 | escape → `pos.ground_scramble` or top (sit-out) | T2 | med | S2+ |
| `def.hide_heel` (boot / toes pointed / knee turned in) | S1 (heel hooks, toe hold, ankle lock) | −0.5 | 0 | regress to S0 (entanglement persists) | T2 (legLocks ≥ 30) | low | S3 |
| `def.clear_knee_line` | S1, S2 (all leg locks) | −0.3 | 0 | escape → clear the leg and stand: attacker on bottom open guard / neutral 50 % / pass over the entanglement → side control 20 % `[S: §2.11]` | T3 | high | locked |
| `def.strike_attacker` | S1–S3 (leg locks, omoplata sit-up, triangle from guard when the defender is upright, any bottom attack in MMA) | −0.35 per landed strike (max 2 per window, landed rate 58.6 % `[S: BJJ_POS §7.3]`) | 0 | on 2 landed strikes in a window the attacker rolls abandon at 0.2 `[S: rule 21 "0.2 per tick forcing release"]`; strike damage → §05 (`dmg× 0.6` for top striking down into an entanglement, 0.3 from inside a triangle `[E]`) | T2 | med | ruleset without strikes (unavailable) |
| `def.slam` | S1–S3 (triangle/armbar/guillotine/omoplata from guard with the defender standing or kneeling, flying attacks, standing guillotine lift) | see §2.6.6 | see §2.6.6 | lock breaks with p 0.7 triangle / 0.8 armbar / 0.5 guillotine / 0.6 omoplata; `evt.slam` → §05 | T2 (strength ≥ 60 or mass advantage ≥ 10 kg) | very high | illegal ruleset (unavailable); attacker's back on the mat (unavailable) |
| `def.lift_and_dump` | S1–S2 (standing guillotine) | −0.2 | +0.3 | escape → top position after dump (`pos.ground_half_flat` top) 40 % `[S: §2.26]`; damage as a slam at height 'waist' | T2 | high | attacker has already jumped guard (→ `def.stack`/`def.slam`) |
| `def.release_grip` | any (guillotine attacker who is being passed / von Flue threatened) | — | — | the *attacker* releases; converts to positional defence in §03 (bottom side control) | T3 knows; T2 40 %, T1 10 % `[S: rule 20]` | low | — |
| `def.frame_and_bridge` | S1–S2 (Ezekiel from bottom, mounted subs, americana) | −0.3 | 0 | regress / escape → half guard 20–30 % `[S: §2.9, §2.16]` | T2 | high | — |
| `def.turn_head_toward` | S2 (twister, neck cranks, bulldog) | −0.4 | +0.2 | regress | T3 | low | — |
| `def.step_over_head` | S3 (omoplata) | −0.2 | +0.2 | escape → sit into the attacker's guard (`pos.ground_closed_guard_bottom`, defender top) | T3 | med | — |
| `def.pull_head_back` | S1–S2 (gogoplata, bulldog, Ezekiel top, can opener) | −0.3 | 0 | regress | T2 | low | — |
| `def.endure` | S3, locked (air/mixed chokes, cranks, pain subs: ankle lock, calf slicer, bulldog, can opener, Ezekiel, ten-finger, standard guillotine) | 0 | per-second escape hazard (§2.6.2) instead of a window roll | T2 | med | vs a functional blood choke (`Δe −1.5`) |
| `def.counter_sub` | S1–S2 in `pos.leg_50_50` / `pos.leg_cross_ashi` (heel hook vs heel hook, ankle lock vs ankle lock, kneebar counter), S2 of guillotine when passed (von Flue), S2 of a guard triangle with crossed ankles (kneebar/ankle counter) | 0 | — | starts the defender's own `SubmissionAttempt` at S1 with `M_CHAIN` (§2.6.6) | T4 (legLocks ≥ 60 for leg counters; T3 for von Flue) | high | — |

Option availability is filtered by tier (`Min tier`), by state (`state.rocked` → only `def.none`, `def.chin_tuck`, `def.endure`, `def.tap`, `def.slam` if strength ≥ 70 `[E]`), and by ruleset (strikes, slams).

### 2.6 Finish mechanics (the `locked` clock)

Once S3 succeeds the lock is fully closed (`evt.sub_locked`, `state.sub_locked`). The clock runs per second (10 ticks). The defender's only options are `def.tap`, `def.endure` (escape hazard) and, where listed, a 0.25× `def.hitchhiker` / 0.3× `def.spin_out` / `def.slam`.

#### 2.6.1 Chokes — time to unconsciousness (LOC)
- `functionalChoke`: **blood** chokes are functional with p 1.0; **mixed** chokes become functional (both carotids) with `pBlood` per technique (standard guillotine 0.5, ten-finger 0.5, arm-in guillotine 0.6, Ezekiel 0.5, bulldog 0.3, Peruvian/Japanese necktie 0.6, forearm/short choke 0.7) `[E]`; **air** chokes (pure trachea) never produce LOC in the sim (`[S: SUB_PHYS §1 "air chokes take tens of seconds to minutes"]`; laryngeal-injury path is commentary only).
- If functional: `tLoc ~ Normal(μ_type, 1.5 s)` clamped `[6, 13]` s, counted from `lockedAtMs` `[S: SUBMISSIONS §5 rule 7; P4 mean 9.0 s, CI 8.3–9.9]`. Per-type μ: arm-triangle **7.2 s**, RNC **8.9 s**, standard guillotine **8.9 s**, north-south **9.4 s**, triangle **9.5 s**, arm-in guillotine **10.2 s** `[S: SUB_PHYS §1 / P4 / W3–W6]`; D'Arce, anaconda, von Flue, buggy, rear/side/inverted/mounted triangle variants, Ezekiel, necktie family, bulldog, high-elbow/ten-finger/mounted/standing guillotine: **9.0 s** (population mean) `[D: P4 pooled mean applied where no per-type value exists]`. Add `+0.5 s × (neck/100 − 0.5)/0.5` `[E]`.
- If not functional (mixed choke that failed to become blood): no LOC; the defender uses `def.endure` with the air-choke escape hazard; the attacker's forearms fatigue: after `enduranceMs` (standard guillotine 15,000, ten-finger 12,000, arm-in 20,000, Ezekiel 12,000, bulldog 15,000, neckties 15,000 `[E]`) the attempt regresses to S2 with `fAtt += 0.05` `[E]`. Pain/air-hunger taps still occur at hazard `hTapAir = 0.06/s` (T4), ×2.0 T≤2, ×0.5 T5 `[E]`.

#### 2.6.2 Chokes — the tap decision
At `lockedAtMs` draw once:

```
pGoOut = stubbornness × stakes                       // stubbornness is the §01 §2.7.7 fighter value:
stubbornness = clamp(tierBase × (0.5 + heart/100), 0.02, 0.5) × (pro.subLosses ≥ 2 ? 0.8 : 1.0); refusesToTap trait → max(stubbornness, 0.5)
tierBase (by SUBDEF band, §01): < 20 → 0.40 (T0, no_tap flag) · 20–39 → 0.19 (T1) · 40–79 → 0.11 (T2–T4) · ≥ 80 → 0.05 (T5)
stakes  : 1.2 in title fights, 1.0 otherwise
```
`[S: SUBMISSIONS §4/§5 rule 7: UFC 11 % LOC (P2), Novice 0.19 / Advanced 0.11 / Elite 0.05 from the judo cadet→senior 18.9 %→4.3 % gradient (P9); T0 0.40 "does not know to tap" rule 24]` `[S: 01_FIGHTER_MODEL §2.7.7 for the heart term (0.5 + heart/100), the clamp, the refusesToTap trait and the ×0.8 injury-history factor]` `[E: stakes ×1.2]`. At heart 50 the tier bases are reproduced exactly; a heart-90 fighter is 1.4× more likely to go out.

- **Tapper** (`u > pGoOut`): `tTap ~ U(tapMin, tapMax)` (technique range, §3), clamped to `≤ tLoc − 0.5 s` when functional `[S: SUB_PHYS §4 "typical tap 3–7 s after full lock", bounded by the 9 s LOC window]`. Equivalent per-second tap hazard for engines that prefer hazards: `hTap(t) = 1/(tapMax − t)` for `t ∈ [tapMin, tapMax)` `[D: uniform → hazard]`.
- **Stubborn** (`u ≤ pGoOut`): no tap. If functional → `state.unconscious` at `tLoc` → referee technical submission (§2.6.4). If not functional → endure path (§2.6.1).
- **Escape hazard while locked** (`def.endure` or any option): blood chokes `hEsc = 0.02/s` at T4; T5 0.04; T≤2 0.005 `[S: rule 8]`; non-functional mixed chokes 0.06 / 0.10 / 0.02 `[S: rule 8]`. Apply `M_SKILL` (k = 1.0) on the logit of `hEsc`. Success → regress to S2 (choke slipped, 60 %) or full escape per catalogue (40 %) `[E]`.

#### 2.6.3 Post-LOC hold
The attacker releases when the referee intervenes (§2.6.4). Attacker awareness: a T4+ attacker notices the limp body and releases within 1 s with p 0.6 (T5 0.8, T≤2 0.2) `[E]`. If the hold persists ≥ 4 s past `tLoc`, set `state.post_loc_symptoms` with p 0.6 (convulsions/staggering; commentary + §05 recovery time) `[S: rule 7; P9 OR 6.7, 61.5 % symptomatic]`. Consciousness returns 2–5 s after release (coherent within 1–2 min) `[S: SUB_PHYS §1 working numbers]` — §05 owns the recovery state.

#### 2.6.4 Referee detection lag (technical submission)
- Choke LOC: referee stops after §06's `cfg.locDetectS` (1.0 s median, §06 §2.3.5) [REVIEW: was `U(0.8, 2.0)` s from rule 7 "+1–2 s"; §06 owns referee latencies and its 1.0 s + the attacker-release 0.5–1.5 s lands in SUBPHYS's 2.4 s asymptomatic band]; in a ruleset with `refereeStopsOnLoc = false` (street) there is no stop.
- Joint-lock injury (§2.6.5): referee stops `U(0.5, 1.5)` s after `evt.injury` with p 0.7 (visible break / scream); otherwise the fight continues with `state.injured_limb` `[S: rule 7 "p 0.3 continues"]` `[E: lag]`.
- Verbal tap / tapping on the opponent are treated as `evt.tap` with zero lag `[S: SUB_PHYS §3]`.
- `evt.near_submission` is raised for judging when an attempt reaches S3 or `locked` `[S: RULES §2 "chokes causing visible distress, joint hyperextension"]`.

#### 2.6.5 Joint locks, cranks, compressions — pain precedes failure
At `lockedAtMs` draw once: `pRefuse = 0.5 × pGoOut` (T0: 0.40 "does not know to tap") `[S: rule 7 "stubbornness × 0.5"; rule 24]`.

- **Tapper**: `tTap ~ U(tapMin, tapMax)` (armbar 0–3 s, kimura 1–4, americana 2–6, heel hook 1–3, kneebar 1–3, ankle lock 3–8, toe hold 1–3, omoplata 3–8, calf slicer 2–6, twister 1–5, cranks 2–10, crucifix armlock 2–6, banana split 2–6, Suloev 2–6) `[S: SUBMISSIONS §2.x lock→tap]`.
- **Refuser**: `evt.injury` at `lockedAtMs + U(injuryDelayMin, injuryDelayMax) + M_FLX_DEF` with severity: armbar 1–3 s **high** (elbow: UCL/flexor rupture, fracture/dislocation `[S: SUB_PHYS §2 P14, WR2]`), kimura 1–3 s **high** (shoulder / humeral fracture `[S: WR2 Mir–Nogueira]`), americana 2–4 s **medium**, heel hook 0–1 s **high** (ACL/PCL/MCL or posterolateral corner `[S: P13, P16]`), kneebar 1–2 s **high**, toe hold 1–2 s **medium**, straight ankle 4–10 s **medium**, omoplata 3–6 s **medium**, calf slicer 3–6 s **medium**, twister 2–4 s **high** (spine), crucifix armlock 1–3 s **high**, banana split 3–6 s **medium**, neck crank / can opener: no discrete injury; instead `state.neck_strain += 0.15` per 5 s locked (cumulative; at ≥ 0.6 the referee may stop with p 0.3/s and §05 applies a −10 % head-strike absorption penalty) `[S: rule 7 "cranks = medium-cumulative"; P17]` `[E: strain rate, delays]`.
- **Heel hook no-warning**: *even a tapper* is injured before the tap with `pInjBeforeTap` = 0.05 (T4–5), 0.10 (T3), 0.15 (T2), 0.25 (T1), 0.30 (T0) `[E, anchored on P10 RR 12.0 for heel-hook-legal divisions and P13 "failure can precede pain"]`. Inside heel hook ×1.2 (smaller motion arc) `[S: P13 "theoretically more dangerous"]`.
- **Escape hazard while locked**: armbar 0.02/s, kimura 0.03, americana 0.05, heel hook 0.01, kneebar 0.02, ankle lock 0.08, toe hold 0.02, omoplata 0.10, calf slicer 0.03, cranks 0.10, twister 0.02, crucifix 0.03 `[E, ordered by SUBMISSIONS §2.x escape notes: "grind through" ankle locks, forward-roll omoplata, elite endure cranks]`; `M_SKILL` k = 1.0; `M_FLX_DEF` where listed. Success → regress to S2 (70 %) / escape per catalogue (30 %) `[E]`.
- **Injury consequences** (`state.injured_limb{side, joint, severity}`, handed to §05): capability loss while the state persists — **arm (high)**: strikes with that arm −60 % power and −70 % usage, grip-dependent grappling edges (§03) −1.0 logit, `sk.escapes` effective −20 for grip-based options; **arm (medium)**: −30 % / −40 % / −0.5 logit; **knee (high)**: mobility −50 % (§05 leg model at structural 75), takedowns −1.0 logit, kicks with that leg disabled, `def.clear_knee_line` unavailable; **ankle (medium)**: mobility −25 %, kicks −40 % `[E]`. Doctor check at the round break with stop probability 0.8 (high) / 0.3 (medium) `[E; DAMAGE §5.2 owns the doctor logic]`. After any injury, the fighter's `pRefuse` and `pGoOut` are set to 0 for the rest of the bout `[E]`. Career layoff for commentary/career mode: high ≈ 10 months `[S: P5 10.3 months]`.

#### 2.6.6 Counters as attacks

**Slam (`def.slam`).** Available when the defender is standing or kneeling, the attacker's back/hips are off the mat (guard triangle, guard armbar, guard guillotine when the attacker has jumped, omoplata during sit-up, flying attacks, standing guillotine with `def.lift_and_dump`), the ruleset has `slamsLegal` (IBJJF/judo: no; ADCC/sub-only: only from inside a locked submission `[S: RULES §2.6]`; MMA: yes but `spikingLegal = false` — pile-driver/spike is a foul `[S: RULES §2.1 item 6]`). Per window `pSlamAttempt` = 0.15 (T4), 0.30 if `style.wrestlerGnp` `[S: rule 19 "0.15/s (Advanced), 0.30 (wrestler style)"]`, only if defender strength ≥ 60 or Δmass ≥ +10 kg `[S: rule 19; mass E]`. Resolution: `pLift = sigmoid(logit(0.6) + 0.17 × (STRdef − STRatt)/10 + 0.08 × Δkg/5 − 0.3 × fDef)` `[E: 0.6 base; strength/mass terms reuse M_STR_DEF/M_MASS]`; on lift the lock breaks with p 0.7 (triangle) / 0.8 (armbar) / 0.5 (guillotine) / 0.6 (omoplata) / 0.8 (flying attacks) `[S: rule 19; omoplata/flying E]` and `evt.slam` is emitted with:

```
evt.slam { slammed: attackerId, height: 'knees'|'waist'|'shoulder'|'overhead', spike: false,
           forceMult: knees 0.8 · waist 1.2 · shoulder 1.6 · overhead 2.0   // × the hook-punch reference force, DAMAGE §3.1
           target: 'head_back'|'upper_back', surface: 'mat'|'concrete' }
```
`[E: forceMult ladder; SUBMISSIONS rule 19 placeholder "8–25 head-damage units" superseded by handing the impact to §05's alphaEq model with its ground ×0.7 rotational / ×1.3 structural rule]`. [REVIEW: §05 §2.1 consumes only `StrikeImpact`; `evt.slam` is therefore delivered as `StrikeImpact { tech: 'slam', weapon: 'mat', region: 'head', subLocation: 'topback' (target 'head_back') or region 'body', subLocation 'sternum' (target 'upper_back'), placement: 'flush', forceN: forceMult × 4,400 N (DAMAGE §3.1 hook reference), absorb: 0, defence: 'none', seen: false, closingSpeedMs: 0, targetState.grounded: true, posture: 'groundTop', gloveType per ruleset }`, `forceN` further × `Arena.surfaceHardness` (§09 §3.3). With §05's `ko.kWeapon.mat` 0.35 and `kLever.topback` 0.7 a waist slam gives `alphaEq ≈ 6,300 × (5,280/3,400) × 0.35 × 0.7 × 1.35 (unseen) ≈ 3,200 rad/s²` → `pConcuss ≈ 0.5 %` [D] — well below §03's 3–8 % "KO-class chance per slam" (`grap.slamKoClassP`); the two are reconciled in calibration via `ko.kWeapon.mat`, not here (REVIEW_LOG open issue).] Height draw: knees 0.35 / waist 0.40 / shoulder 0.20 / overhead 0.05 `[E]` (overhead requires strength ≥ 80). If the lock survives the slam (1 − p above), the attacker's finish clock, if `locked`, continues (the Rampage–Arona and Hughes–Newton cases are lock-break successes that also hurt the attacker `[S: W7]`). If the slammed fighter is KO'd by §05, the attempt ends. A slam while the attacker is `locked` on a **functional choke** that is past `tLoc − 2 s` does not save the defender `[E]`.

**Von Flue (`def.counter_sub` → `sub.von_flue`).** When a guillotine attacker retains the grip after the defender passes to the choking-arm side (`def.walk_weak_side` success path 50 % → side control), the defender may start `sub.von_flue` at S2 (entry skipped) `[S: rule 20]`. The bottom fighter releases (`def.release_grip`) with p 0.8 (T3+), 0.4 (T2), 0.1 (T≤1) per window before S3 `[S: rule 20]`.

**Mutual leg entanglement (`M_MUTUAL`).** In `pos.leg_50_50` and `pos.leg_cross_ashi` both fighters may run a `SubmissionAttempt` concurrently; each window both resolve (§2.4.3 order); the first to reach `locked` wins the exchange and the other's attempt is cancelled `[S: rule 21]`. The *top* fighter (the one whose head is free) may `def.strike_attacker` each window; two landed strikes force an abandon roll at 0.2 `[S: rule 21]`. A failed heel hook in 50-50 routes 10 % of failures to the defender's counter heel hook (`edge.sub.hh_counter`) `[S: §3 edge list]`.

**Triangle-diamond leg counter.** When a guard triangle is at S2 with crossed ankles ("diamond"), a T4+ defender with `sk.legLocks ≥ 60` may `def.counter_sub` → `sub.kneebar` or `sub.ankle_lock_straight` at S1 with `M_CHAIN` `[S: SUBMISSIONS §2.6 counters "Ryan Hall style"]`; share 0.05 of triangle failures `[E]`.

### 2.7 Outcome routing (what §03 receives)

| Outcome | Return node (attacker / defender) | Source |
|---|---|---|
| `evt.tap` / `evt.technical_submission` | fight over | — |
| Escape (defender `p_e` success with escape split) | catalogue `outcomes.escape` list with shares (each entry gives `pos` and the attacker's new role) | `[S: SUBMISSIONS §2.x "escapes and where you end up"]` |
| Regress | previous stage, same nodes | — |
| Abandon (§2.4.4) | catalogue `abandon` node | `[S: §2.x; rule 18 positional cost]` |
| Chain (§4) | new `SubmissionAttempt` at S1 with `M_CHAIN`; positional chains (sweep / back take) hand the new node to §03 | `[S: §3]` |
| Bell | both standing (MMA) / referee restart (grappling rulesets) | `[S: rule 9]` |
| Slam | §05 impact; attacker in `pos.ground_scramble` (bottom) unless the lock held | `[S: rule 19]` |

**Positional cost of failure** is encoded in each catalogue entry's `abandon`/escape nodes; the highest-risk entries (attacker loses top position) are armbar from mount 0.35, rolling kneebar from top half guard 0.50, omoplata/triangle from guard while stacked 0.25, flying attacks 0.65 land in guard / 0.25 slammed `[S: rule 18]`.

### 2.8 Energy

Per-second energy costs in §05's units (one "average" round ≈ 100): attacker S1 0.9, S2 0.7, S3 0.9 (squeeze), locked 0.6; grip-heavy attacks (guillotine family, kimura, D'Arce/anaconda, ankle lock, toe hold) +0.3/s; defender: standard options 0.7/s, high-cost options (`def.stack`, `def.walk_weak_side`, `def.roll_with`, `def.spin_out`, `def.clear_hooks_turn_in`, `def.turn_in_bridge`, `def.clear_knee_line`, `def.post_against_roll`) 1.4/s, `def.slam` 4.0 per attempt, `def.endure` 0.5/s, panic (`def.none` for T0–T1) 1.6/s `[E, scaled to BJJ_POS §8 rule 19 ground drains 1.0/1.4/1.6 and 01's `energy.actionCostMult` tier multipliers T0 ×1.6, T1 ×1.3, T2–T3 ×1.1, T4 ×1.0, T5 ×0.9 (S: BJJ_POS §6 via 01 §2.3.4) — §05 applies the multiplier, this section only names the action classes [REVIEW]]`.

### 2.9 Events and logging

Emit `evt.sub_start{sub, attacker, pos}`, `evt.sub_stage{stage}`, `evt.sub_attempt_logged` (S1 success — the judging/statistics attempt), `evt.sub_locked`, `evt.tap`, `evt.technical_submission{reason: loc|injury}`, `evt.injury{limb, severity}`, `evt.sub_escape{def, toPos}`, `evt.sub_regress`, `evt.sub_abandon`, `evt.sub_chain{edge}`, `evt.slam`, `evt.near_submission`, `evt.bell_save`. Log per attempt: `technique, variant, stage_reached, time_in_stage, chain_path, outcome ∈ {tap, unconscious, injury, escape, round_end, abandoned, slammed}, end_position` `[S: rule 26]`.

---

## 3. Catalogue (54 submissions)

**Reading the entries.** `Stages` gives `P_stage / dMean (dMin–dMax) ms` for S1 · S2 · S3 at T4 vs T4 (§2.3 derives per-window values). `Conv` = P(finish | attempt logged at S1 success) = S2 × S3 `[D]`. `Finish clock` gives the tap range once locked, the LOC mean for chokes (§2.6.1) or the injury delay/severity for locks (§2.6.5), and the locked escape hazard. `Escapes` are the outcome split when the defender's `p_e` succeeds (§2.5), with the attacker's resulting role; `Abandon` is the stall/abandon node (§2.4.4). `Chains` reference §4 edge ids. `Modifiers` list the §2.3 terms that apply (all entries get `M_SKILL`, `M_FAT_DEF`, `M_ROCKED`, `M_WRONG_DEF`, `M_CHAIN` implicitly). `Share` = target share of MMA submission finishes (§8). Research stage values are `[S: SUBMISSIONS §2.x]` unless a `[D]`/`[E]` note says otherwise; stage durations are the research ranges where given, otherwise `[E]`.

### 3.1 Back attacks

#### `sub.rnc` — Rear-naked choke (figure-four) · choke · blood
- **Entries:** `pos.ground_back_hooks` (top; seatbelt + ≥ 1 hook; continuous) · `pos.ground_back_body_triangle` (top; continuous) · `pos.ground_back_seatbelt_no_hooks` (top; requires chin exposed) · `pos.ground_turtle` (top; trigger `evt.turn_away`; S1 at −0.3) · `pos.clinch_rear_body_lock` (standing; must complete a mat return first; S1 at −0.6 `[E]`).
- **Grips/controls:** seatbelt (over/under), chest-to-back, hooks or body triangle `[S: §2.1]`; S1 = choking arm under the chin ("width of the wrist"); S2 = second hand in (figure-four or palm-down on the far shoulder) `[S: SUB_COACH RNC / D1]`.
- **Stages:** S1 0.45 / 2,000 (1,000–3,000) · S2 **0.50** / 4,000 (2,000–6,000) · S3 **0.85** / 3,000 (2,000–6,000). `[S: §2.1 table gives 0.45/0.60/0.90; S2 and S3 lowered D: to meet FIGHT_DATA #73 "RNC ≈ 40 %+" conversion from a logged attempt: 0.50 × 0.85 = 0.425]`. S1 re-rolls continuously while back control persists `[S: §2.1 "re-rollable"]`. **Conv 0.43.**
- **Finish clock:** tap 2,000–6,000 ms `[S: §2.1]`; `tLoc` μ 8.9 s `[S: P4]`; `hEsc` 0.02/s.
- **Defences:** S1 `def.two_on_one`, `def.hand_fight`, `def.chin_tuck`, `def.clear_hooks_turn_in` · S2 `def.hand_fight`, `def.chin_tuck` · S3 `def.slide_to_choking_side`, `def.tap` `[S: §2.1 defences by stage; K1; EV6]`.
- **Escapes → positions:** clear hook + turn in → attacker's closed/half guard (attacker bottom) 55 % · scoot out → `pos.ground_turtle` then stand 25 % · roll over the shoulder → `pos.ground_scramble` (defender top) 10 % · round end 10 % `[S: §2.1]`. **Abandon:** `pos.ground_back_hooks` retained.
- **Counters:** none once locked; aggressive turn-in lands in the attacker's guard (T3+) `[S: §2.1]`.
- **Chains:** out `edge.sub.rnc_to_armbar_back`, `edge.sub.rnc_to_rear_tri`, `edge.sub.rnc_to_neck_crank`, `edge.sub.rnc_to_body_tri_gnp`, `edge.sub.rnc_to_mount`; in `edge.pos.turtle_to_rnc`, `edge.sub.guillotine_to_back`, `edge.sub.armbar_guard_to_back`, `edge.sub.darce_to_back`, `edge.sub.armbar_back_to_rnc`.
- **Modifiers:** `M_CTRL`, `M_SETUP` (GnP from the back), `M_STR_FIN`, `M_NECK`, `M_SLIP_LOW`, `M_FAT_ATT`, `M_FAT_DEF` (large), `M_GLOVES` (palm-to-palm 50 %, S3 −0.1).
- **Share:** **38.9 %** of MMA sub finishes `[S: SUB_FINISH §1a 659/1,695]`; back control is the finishing context of ≈ 45 % of modern submissions `[S: SUBMISSIONS §1.2 MD1]`.

#### `sub.rnc_short` — Short choke / palm-to-palm RNC (Marcelo Garcia) · choke · mixed (`pBlood` 0.7)
- **Entries:** as `sub.rnc`; selected automatically 50 % of the time under `glovesMma`, or by choice when the figure-four is denied at S2 (`edge.sub.rnc_to_short`).
- **Grips/controls:** gable/palm-to-palm behind the neck, no figure-four `[S: SUB_COACH "Short choke"; W3]`.
- **Stages:** S1 0.45 / 2,000 · S2 0.55 / 3,000 (2,000–5,000) · S3 0.75 / 3,000 `[D: from sub.rnc; S2 +0.05 (no second-hand placement), S3 −0.10 (less head control, more air) per SUBMISSIONS §2.1 "more pressure but less head control and is more often air/mixed"]`. **Conv 0.41.**
- **Finish clock:** tap 2,000–8,000 ms `[E]`; `tLoc` μ 9.0 s (pooled) `[D]`; `hEsc` 0.03/s `[E]`; `pBlood` 0.7 `[E]`.
- **Defences / Escapes / Abandon / Chains / Modifiers:** as `sub.rnc`; `M_STR_FIN` weight ×1.5 (it is a squeeze) `[E]`.
- **Share:** folded into RNC (logged as RNC by UFCStats) `[S: SUBMISSIONS §1.2 note]`.

#### `sub.armbar_back` — Armbar from the back · jointLock
- **Entries:** `pos.ground_back_hooks` / `pos.ground_back_body_triangle` (top; trigger: defender's arm high defending the RNC, i.e. via `edge.sub.rnc_to_armbar_back`, or `evt.hand_posted` on the choking arm).
- **Grips/controls:** control of the defending wrist, leg slides over the face, fall to the side `[S: §2.7 entry]`.
- **Stages:** S1 0.45 / 2,000 (1,000–3,000) · S2 0.45 / 4,000 (2,000–8,000) · S3 0.80 / 1,500 (1,000–3,000) `[S: §2.7 table; S2 0.55 → 0.45 D: armbar S2 lowered 0.10 across variants to meet FIGHT_DATA #73 with attempts logged at S1]`. **Conv 0.36.**
- **Finish clock:** tap 0–3,000 ms `[S: §2.7]`; refusal → injury 1,000–3,000 ms, severity high (elbow) `[S: P14]`; `hEsc` 0.02/s.
- **Defences:** S1 `def.pull_elbow`, `def.clear_hooks_turn_in` · S2 `def.grip_clasp`, `def.hitchhiker`, `def.spin_out` · S3 `def.hitchhiker` (0.25×), `def.tap`.
- **Escapes:** defender escapes to top of half guard (`pos.ground_half_flat`, attacker bottom) 50 % · attacker retains back control 50 % `[S: §3 "Armbar (from back) → HALF_GUARD_TOP 0.50 / RNC 0.50"]`. **Abandon:** `pos.ground_back_hooks` retained if hooks were kept (60 %) else `pos.ground_half_flat` (attacker bottom) `[E]`.
- **Counters:** defender comes up on top when the attacker falls off `[S: §2.7 counters]`.
- **Chains:** out `edge.sub.armbar_back_to_rnc` (0.50), `edge.sub.armbar_to_tri` (rear/side triangle variant); in `edge.sub.rnc_to_armbar_back`.
- **Modifiers:** `M_CTRL`, `M_STR_DEF` (grip break), `M_SLIP_LOW`, `M_FAT_ATT`, `M_GLOVES` (clasp harder for the defender: `def.grip_clasp` −0.15 `[E]`), `M_LEN_LEG` (leg over the face).
- **Share:** ≈ 1.5 % `[E split of armbar 11.9 %]`.

#### `sub.triangle_rear` — Rear triangle (from the back) · choke · blood
- **Entries:** `pos.ground_back_hooks` (top; trigger: defender's arm trapped inside the seatbelt, `edge.sub.rnc_to_rear_tri`).
- **Grips/controls:** leg over the far shoulder, figure-four of the legs behind the head, arm trapped `[S: §2.6]`.
- **Stages:** S1 0.45 / 2,500 (1,000–4,000) · S2 0.50 / 5,000 (3,000–8,000) · S3 0.60 / 4,000 (2,000–8,000) `[S: §2.6 table "Rear"]`. **Conv 0.30.**
- **Finish clock:** tap 5,000–15,000 ms `[S: §2.6]`; `tLoc` μ 9.5 s `[S: P4 triangle]`; `hEsc` 0.02/s.
- **Defences:** S1 `def.hand_fight`, `def.clear_hooks_turn_in` · S2 `def.answer_phone`, `def.chin_tuck` · S3 `def.endure` (blood: −1.5), `def.tap`.
- **Escapes:** posture/turn → attacker retains back 50 % · scramble to top (`pos.ground_scramble`, defender top) 30 % · attacker's guard 20 % `[E]`. **Abandon:** `pos.ground_back_hooks`.
- **Chains:** out `edge.sub.rear_tri_to_armbar`; in `edge.sub.rnc_to_rear_tri`.
- **Modifiers:** `M_CTRL`, `M_LEN_LEG`, `M_FLX_ATT`, `M_NECK`, `M_SLIP_LOW`, `M_FAT_ATT`.
- **Share:** ≈ 0.3 % `[E split of triangle 5.5 %]`.

#### `sub.neck_crank_rear` — Rear neck crank (arm over the face / "RNC gone wrong") · crank
- **Entries:** `pos.ground_back_hooks`, `pos.ground_back_body_triangle` (top; via `edge.sub.rnc_to_neck_crank` when the arm lands on the jaw) · `pos.ground_back_crucifix` (top).
- **Grips/controls:** forearm across the jaw/chin, second hand behind the head, cervical flexion/rotation `[S: §2.22]`.
- **Stages:** S1 0.50 / 1,500 · S2 0.50 / 3,000 (2,000–5,000) · S3 0.35 / 4,000 (2,000–8,000) `[S: §2.22 "S3 0.35 vs Advanced / 0.80 vs Novice"]` — the tier gap is produced by `M_SKILL` plus the T≤1 `def.none` default. **Conv 0.175.**
- **Finish clock:** tap 2,000–10,000 ms `[S: §2.22]`; no discrete injury: `state.neck_strain` +0.15 per 5 s `[E]`; `hEsc` 0.10/s (elite endure) `[S: §2.22]`.
- **Defences:** S1 `def.two_on_one`, `def.hand_fight` · S2 `def.turn_head_toward`, `def.chin_tuck` · S3 `def.endure`, `def.tap`.
- **Escapes:** as `sub.rnc` split. **Abandon:** `pos.ground_back_hooks`.
- **Chains:** out `edge.sub.crank_to_rnc` (hand-fighting loop 0.40 `[E]`); in `edge.sub.rnc_to_neck_crank`.
- **Modifiers:** `M_CTRL`, `M_STR_FIN` (large), `M_NECK` (×1.5 weight `[E]`), `M_FAT_ATT`; no `M_SLIP`.
- **Share:** neck cranks (all positions) **1.3 %** `[S: SUB_FINISH §1b fight.tv 22]`; rear variant ≈ 0.6 % `[E]`. Illegal in amateur MMA and IBJJF (§5).

#### `sub.suloev_stretch` — Suloev stretch · jointLock (hamstring/hip)
- **Entries:** `pos.ground_back_hooks` (top; trigger: defender turtled/flat with a leg reachable; `evt.hand_posted` not required).
- **Grips/controls:** grab the far ankle, pull toward the shoulder while keeping the back `[S: §2.29]`.
- **Stages:** S1 0.25 / 2,000 · S2 0.40 / 3,000 · S3 0.60 / 2,000 `[S: §2.29]`. **Conv 0.24.**
- **Finish clock:** tap 2,000–6,000 ms `[E]`; refusal → injury 3,000–6,000 ms, medium (hamstring) `[E]`; `hEsc` 0.05/s `[E]`.
- **Defences:** S1 `def.hide_heel` (tuck the leg), S2 `def.roll_with`, S3 `def.endure`, `def.tap`.
- **Escapes:** back retained by the attacker 70 % · scramble 30 % `[E]`. **Abandon:** `pos.ground_back_hooks`.
- **Chains:** in/out `pos.ground_back_hooks` only.
- **Modifiers:** `M_CTRL`, `M_FLX_DEF` (hamstring flexibility ×1.5 weight `[E]`), `M_STR_FIN`.
- **Share:** 0.18 % `[S: SUB_FINISH §1a 3/1,695]`.

#### `sub.crucifix_armlock` — Crucifix straight armlock / shoulder crank · jointLock
- **Entries:** `pos.ground_back_crucifix`, `pos.ground_crucifix_side` (top; requires one arm trapped between the legs).
- **Grips/controls:** leg-trapped arm extended by hip pressure; other arm controlled `[S: §2.25]`.
- **Stages:** S1 0.35 / 3,000 · S2 0.45 / 4,000 · S3 0.55 / 2,000 `[S: §2.25]`. **Conv 0.25.**
- **Finish clock:** tap 2,000–6,000 ms `[S: §2.25]`; refusal → injury 1,000–3,000 ms, high (shoulder/elbow) `[E]`; `hEsc` 0.03/s.
- **Defences:** S1 `def.pull_elbow` ("never let the arm between the legs"), S2 `def.roll_with` (roll to the trapped-arm side), S3 `def.endure`, `def.tap` `[S: §2.25]`.
- **Escapes:** roll → `pos.ground_scramble` 40 % · attacker keeps the crucifix 60 % `[S: §2.25]`. **Abandon:** crucifix retained.
- **Chains:** out `edge.sub.crucifix_to_choke`, `edge.sub.crucifix_to_crank`, `edge.pos.crucifix_to_gnp` (TKO route, §03/§05); in `edge.pos.turtle_to_crucifix`.
- **Modifiers:** `M_CTRL` (crucifix ctrl 9), `M_STR_FIN`, `M_FLX_DEF`.
- **Share:** crucifix submissions ≈ 0.2 % `[S: §2.25 "ESTIMATE 3–6 UFC"]`. Crucifix cranks illegal in ADCC (§5).

#### `sub.crucifix_choke` — One-arm RNC / arm-in choke from the crucifix · choke · blood
- **Entries:** `pos.ground_back_crucifix`, `pos.ground_crucifix_side` (top).
- **Grips/controls:** free arm under the chin, defender's near arm trapped by the legs; palm on own shoulder or forearm choke `[S: BJJ_POS §2.2 BACK_CRUCIFIX]`.
- **Stages:** S1 0.40 / 2,000 · S2 0.45 / 4,000 · S3 0.65 / 3,000 `[E: between sub.rnc_short and sub.crucifix_armlock; the defender has one hand to fight with]`. **Conv 0.29.**
- **Finish clock:** tap 3,000–8,000 ms `[E]`; `tLoc` μ 9.0 s `[D]`; `hEsc` 0.02/s.
- **Defences:** S1 `def.hand_fight` (one hand: `Δe −0.3`), `def.chin_tuck` · S2 `def.roll_with` · S3 `def.tap`.
- **Escapes / Abandon / Chains:** as `sub.crucifix_armlock`. **Modifiers:** `M_CTRL`, `M_STR_FIN`, `M_NECK`, `M_SLIP_LOW`.
- **Share:** ≈ 0.1 % (UFCStats "forearm choke" 5 finishes partly here) `[E; S: SUB_FINISH §1a forearm choke 5]`.

### 3.2 Front-headlock family

#### `sub.guillotine_standard` — Standard (arm-out) guillotine · choke · mixed (`pBlood` 0.5)
- **Entries:** `pos.ground_front_headlock` (top; trigger `evt.sprawl_front_headlock`) · `pos.standing_sprawl` (top) · `pos.ground_closed_guard_broken` / `pos.ground_butterfly` (bottom; requires head control, trigger `evt.posture_broken`) · `pos.ground_half_flat` (bottom; trigger `evt.posture_broken`) · `pos.ground_scramble` (whoever wins the head) · `pos.ground_cage_seated_bottom` (top; trigger: bottom ducks in) `[S: §2.2 required positions]`.
- **Grips/controls:** chin strap (blade of the wrist on the throat), palm-on-wrist clasp, opponent's head on the attacker's own hip side; finish from closed guard (best) or kneeling `[S: §2.2]`.
- **Stages:** S1 0.55 / 1,500 (1,000–3,000) · S2 **0.40** / 4,000 (2,000–6,000) · S3 **0.35** / 4,000 (2,000–8,000) `[S: §2.2 table 0.55/0.45/0.45; S2 −0.05 and S3 −0.10 D: to meet FIGHT_DATA #73 "guillotine ≈ 10 %" / SUBMISSIONS rule 25 10–15 % conversion given logging at S1: 0.40 × 0.35 = 0.14]`. **Conv 0.14.**
- **Finish clock:** tap 4,000–12,000 ms `[S: §2.2]`; `tLoc` μ 8.9 s `[S: P4]` when functional (`pBlood` 0.5 `[E]`), else endure path (`enduranceMs` 15,000); `hEsc` 0.02/s functional, 0.06/s otherwise `[S: rule 8]`.
- **Defences:** S0 `def.head_up_sit_out` · S1 `def.answer_phone`, `def.chin_tuck` · S2 `def.walk_weak_side`, `def.posture_up` (if standing/kneeling) · S3 `def.walk_weak_side`, `def.stack`, `def.slam` (if the attacker jumped guard and the defender is upright), `def.endure`, `def.tap` `[S: §2.2; K2; EV7]`.
- **Escapes:** pass to `pos.ground_side_control` on the choking side (defender top) 50 % · stand up (both standing) 25 % · attacker abandons to keep guard 25 % `[S: §2.2]`. **Abandon:** guard retained (bottom entries) / `pos.ground_front_headlock` retained (top entries).
- **Counters:** `sub.von_flue` (defender, after the pass with the grip retained) `[S: §2.17]`; pick-up-and-slam (`def.slam`) `[S: §2.2]`; back take when the attacker rolls (`edge.sub.guillotine_to_back` fires for the *defender* 10 % `[E]`).
- **Chains:** out `edge.sub.guillotine_to_darce`, `edge.sub.guillotine_to_anaconda`, `edge.sub.guillotine_to_mounted`, `edge.sub.guillotine_to_back`, `edge.sub.guillotine_to_tri`, `edge.sub.guillotine_to_armbar`, `edge.sub.guillotine_to_von_flue` (defender's); in `edge.pos.sprawl_to_fhl`, `edge.sub.kimura_to_guillotine`, `edge.sub.standing_guillotine_to_guard`, `edge.sub.ezekiel_bottom_to_guillotine`.
- **Modifiers:** `M_SLIP_HIGH` (largest: "sweaty necks slide out"), `M_GLOVES`, `M_STR_FIN`, `M_LEN_ARM` (weight 0.5), `M_NECK`, `M_NECK_GIRTH`, `M_FAT_ATT_GRIP` (large), `M_CTRL` (front headlock ctrl 5), `M_CAGE`.
- **Share:** guillotine (all variants) **17.6 %** `[S: SUB_FINISH §1a 299/1,695]`; standard ≈ 9.5 % `[E split]`. The most-attempted technique with the lowest conversion of the big five `[S: §2.2]`.

#### `sub.guillotine_arm_in` — Arm-in guillotine · choke · mixed (`pBlood` 0.6)
- **Entries:** as standard, plus `pos.ground_half_flat` (bottom, finishing "off the side" — closed guard weakens the arm-in) `[S: §2.2]`.
- **Grips/controls:** trapped arm inside the loop, shoulder pressure, hips angled away from the trapped-head side `[S: §2.2]`.
- **Stages:** S1 0.55 / 1,500 · S2 **0.35** / 5,000 (3,000–8,000) · S3 **0.30** / 5,000 (3,000–10,000) `[S: §2.2 0.55/0.40/0.40; S2 −0.05, S3 −0.10 D: as standard]`. **Conv 0.105.**
- **Finish clock:** tap 6,000–20,000 ms `[S: §2.2]`; `tLoc` μ 10.2 s `[S: P4 / W4]`; `enduranceMs` 20,000; `hEsc` 0.02 / 0.06.
- **Defences:** as standard plus `def.swim_arm` (S1–S2: push the trapped arm through) `[S: §2.2 "Arm-in: swim it"]`.
- **Escapes / Abandon / Counters:** as standard. **Chains:** out `edge.sub.guillotine_to_darce` (weight ×2: the arm is already in) `[S: §3 "arm-in"]`, others as standard.
- **Modifiers:** as standard; `M_MASS` (shoulder pressure) `[E]`.
- **Share:** ≈ 4.5 % `[D: P2 arm-in = 9.7 % of chokes ≈ 0.55 × standard's 13.7 %; applied to the 17.6 % family]`.

#### `sub.guillotine_high_elbow` — High-elbow guillotine ("Marcelotine") · choke · blood
- **Entries:** as standard; strongly favours `pos.ground_closed_guard_broken` / `pos.ground_butterfly` (bottom) and `pos.ground_front_headlock` (top).
- **Grips/controls:** choking hand to the opposite shoulder, elbow up and over the shoulder, elbows squeeze + hip thrust `[S: SUB_COACH "Marcelotine"; D3]`.
- **Stages:** S1 0.45 / 2,000 · S2 0.55 / 3,500 (2,000–5,000) · S3 0.65 / 3,000 (2,000–5,000) `[S: §2.2 table]`. **Conv 0.36.**
- **Finish clock:** tap 3,000–8,000 ms `[S: §2.2]`; `tLoc` μ 9.0 s `[D pooled]`; `hEsc` 0.02/s.
- **Defences / Escapes / Abandon / Counters / Chains:** as standard (`def.answer_phone` is weaker: `Δa −0.15` `[E]`).
- **Modifiers:** as standard but `M_SLIP_HIGH` weight ×0.7 (elbow, not forearm) `[E]`; requires `sk.chokes ≥ 60` to be selected `[E]`.
- **Share:** ≈ 1.5 % `[E split]`.

#### `sub.guillotine_ten_finger` — Ten-finger / power guillotine · choke · mixed (`pBlood` 0.5)
- **Entries:** `pos.ground_front_headlock`, `pos.standing_sprawl`, `pos.standing_front_headlock` (top, kneeling or standing), `pos.ground_scramble`.
- **Grips/controls:** interlocked fingers under the chin, attacker stays kneeling/standing, sits hips back and lifts the chest `[S: §2.2]`.
- **Stages:** S1 0.60 / 1,000 (500–2,000) · S2 0.40 / 3,000 (2,000–5,000) · S3 0.45 / 4,000 (2,000–8,000) `[S: §2.2 table]`. **Conv 0.18.**
- **Finish clock:** tap 5,000–15,000 ms `[S: §2.2]`; `tLoc` μ 9.0 s `[D]`; `enduranceMs` 12,000; `hEsc` 0.02 / 0.06.
- **Defences:** S1 `def.answer_phone`, `def.chin_tuck` · S2 `def.posture_up`, `def.walk_weak_side` · S3 `def.endure`, `def.lift_and_dump` (if the attacker stands), `def.tap`.
- **Escapes:** posture out → `pos.ground_scramble` / turtle 55 % · lift-and-dump → defender top 20 % · attacker abandons 25 % `[E]`. **Abandon:** `pos.ground_front_headlock`.
- **Chains:** as standard; `edge.sub.guillotine_to_darce` weight ×0.5 (no arm control) `[E]`.
- **Modifiers:** as standard; `M_STR_FIN` weight ×1.5 (a power choke) `[E]`.
- **Share:** ≈ 0.6 % `[E split]`.

#### `sub.guillotine_standing` — Standing guillotine (finished standing) · choke · mixed (`pBlood` 0.5)
- **Entries:** `pos.standing_front_headlock`, `pos.clinch_collar_tie` (snap-down), `pos.standing_sprawl` (attacker upright); trigger `evt.head_down_standing` (opponent ducks, level-changes, or is hurt with the head down) `[S: §2.26; §3 "standing hurt with head down → Standing Guillotine p ≈ 0.2"]`.
- **Grips/controls:** chin strap while standing; pull up and arch; if the opponent lifts, the attacker must jump guard (`edge.sub.standing_guillotine_to_guard`) `[S: §2.26]`.
- **Stages:** S1 0.50 / 1,000 · S2 0.35 / 3,000 (2,000–5,000) · S3 0.45 / 3,000 (2,000–6,000) `[S: §2.26]`. **Conv 0.16.**
- **Finish clock:** tap 3,000–8,000 ms `[S: §2.26]`; `tLoc` μ 9.0 s `[D]`; `hEsc` 0.04/s (standing) `[E]`; Jones–Machida is the LOC exemplar `[S: WR2]`.
- **Defences:** S1 `def.posture_up`, `def.answer_phone` · S2 `def.lift_and_dump`, `def.walk_weak_side` (walk to the fence) · S3 `def.lift_and_dump`, `def.endure`, `def.tap` `[S: §2.26; K2c]`.
- **Escapes:** posture → clinch (`pos.clinch_collar_tie`) 60 % · lift-and-dump → defender top (`pos.ground_half_flat`) 40 % with slam damage at height 'waist' `[S: §2.26]`. **Abandon:** `pos.clinch_collar_tie`.
- **Counters:** lift/slam; driving the head to the far side.
- **Chains:** out `edge.sub.standing_guillotine_to_guard` (0.50), `edge.sub.standing_guillotine_dumped` (0.25), `edge.sub.guillotine_to_mounted` (after a dump keeping the grip), `edge.sub.guillotine_to_darce` (if the attacker ends on top); in `edge.pos.snapdown_to_standing_guillotine`, `edge.sub.kimura_to_guillotine`.
- **Modifiers:** `M_SLIP_HIGH`, `M_STR_FIN`, `M_NECK`, `M_NECK_GIRTH`, `M_FAT_ATT_GRIP`, `M_ROCKED` (very large: hurt fighters duck), `M_MASS` inverse (a lighter attacker cannot hold a heavier lifter: −0.08 per 5 kg deficit) `[E]`.
- **Share:** ≈ 0.5 % `[S: §2.26 "ESTIMATE 10–20 UFC" → 15/1,695]`.

#### `sub.guillotine_mounted` — Mounted guillotine · choke · blood-leaning mixed (`pBlood` 0.7)
- **Entries:** `pos.ground_mount_high`, `pos.ground_mount_low` (top; trigger: chin cupped after GnP posture, `evt.arm_crossed_centre` not required) · via `edge.sub.guillotine_to_mounted` (sweep keeping the grip) · `pos.ground_half_flat` (top, after a dump with the grip kept).
- **Grips/controls:** cup the chin, pull to sit, lock, finish in place or roll to guard `[S: §2.2]`.
- **Stages:** S1 0.50 / 1,500 · S2 0.55 / 3,000 (2,000–5,000) · S3 0.70 / 3,000 (2,000–5,000) `[S: §2.2 table "Mounted"]`. **Conv 0.385.**
- **Finish clock:** tap 4,000–10,000 ms `[S: §2.2]`; `tLoc` μ 9.0 s `[D]`; `hEsc` 0.02/s.
- **Defences:** S1 `def.answer_phone`, `def.pull_head_back` · S2 `def.frame_and_bridge`, `def.hand_fight` · S3 `def.endure`, `def.tap`.
- **Escapes:** bridge → attacker keeps mount without the choke 75 % · bottom recovers half guard 25 % `[S: §2.28 "retains mount/side control ~75 %"]`. **Abandon:** mount retained.
- **Chains:** out `edge.sub.mounted_guillotine_to_arm_tri` (0.20 `[E]`); in `edge.sub.guillotine_to_mounted`, `edge.sub.arm_tri_to_mounted_guillotine`.
- **Modifiers:** `M_CTRL` (mount 8), `M_MASS`, `M_STR_FIN`, `M_SLIP_HIGH`, `M_NECK`, `M_FAT_ATT_GRIP`, `M_SETUP`.
- **Share:** ≈ 1.0 % `[E split; Jones–Gane 2023 logged as "guillotine" S: §1.2]`.

#### `sub.darce` — D'Arce / brabo choke · choke · blood
- **Entries:** `pos.ground_front_headlock` (top; opponent's near arm inside) · `pos.ground_half_flat` (top; trigger `evt.underhook_from_bottom` — the biggest MMA creator) · `pos.ground_turtle` (top; trigger `evt.turn_away` into the attacker) · `pos.ground_side_control` (top; bottom turns in) · `pos.standing_sprawl` (top; head-inside single) · `pos.ground_knee_on_belly` (top; turn-in) · `pos.ground_half_dogfight` (whizzer side) `[S: §2.3; BJJ_POS §2]`.
- **Grips/controls:** thread palm-up under the near arm and across the throat, grab own biceps (brabo grip); free hand behind the head; sprawl/walk toward the head `[S: §2.3]`.
- **Stages:** S1 0.45 / 2,000 (1,000–3,000) · S2 0.50 / 5,500 (3,000–8,000) · S3 0.70 / 4,000 (2,000–6,000) `[S: §2.3 table]`. **Conv 0.35.**
- **Finish clock:** tap 3,000–10,000 ms `[S: §2.3]`; `tLoc` μ 9.0 s `[D]`; `hEsc` 0.02/s.
- **Defences:** S0 keep the elbow tight / stay low at the hip · S1 `def.swim_arm`, `def.go_flat`, `def.head_up_sit_out` · S2 `def.post_against_roll` (turn toward the attacker, belly-down, walk the legs), `def.chin_tuck` · S3 `def.roll_with` (rolling escape), `def.tap` `[S: §2.3; K8]`.
- **Escapes:** to knees/`pos.ground_turtle` (attacker keeps the front headlock) 40 % · roll through → attacker on bottom in `pos.ground_half_flat` 20 % · arm free → bottom half guard (attacker top) 40 % `[S: §2.3]`. **Abandon:** `pos.ground_front_headlock` / `pos.ground_half_flat` top retained.
- **Counters:** roll-through reversal; bridge into the attacker on a loose grip; low-elbow escape then single-leg (§03) `[S: §2.3]`.
- **Chains:** out `edge.sub.darce_to_anaconda` (0.30), `edge.sub.darce_to_arm_tri` (0.20), `edge.sub.darce_to_back` (0.20), `edge.sub.darce_to_necktie` (0.10), `edge.sub.darce_to_guillotine`; in `edge.sub.guillotine_to_darce`, `edge.sub.anaconda_to_darce`, `edge.sub.kimura_side_to_darce`.
- **Modifiers:** `M_LEN_ARM` (very large: weight ×1.5 `[S: §2.3 "long arms finish; short arms fail S2"]`), `M_SLIP_HIGH`, `M_STR_FIN`, `M_NECK`, `M_FAT_ATT_GRIP`, `M_CTRL`, `M_MASS` (weight 0.5).
- **Share:** **2.8 %** `[S: SUB_FINISH §1a 47/1,695]`.

#### `sub.anaconda` — Anaconda choke · choke · blood
- **Entries:** `pos.ground_front_headlock`, `pos.standing_sprawl`, `pos.ground_turtle` (top; arm threads under the neck first, out under the far armpit) `[S: §2.4]`.
- **Grips/controls:** gator grip (hand on own biceps), trapped elbow driven into the neck; the "gator roll" across the trapped side; walk the hips toward the head `[S: §2.4]`.
- **Stages:** S1 0.40 / 2,000 · S2 0.50 / 5,500 (3,000–8,000) · S3 0.70 / 4,000 `[S: §2.4]`. **Conv 0.35.**
- **Finish clock:** tap 3,000–10,000 ms `[S: §2.4]`; `tLoc` μ 9.0 s `[D]`; `hEsc` 0.02/s.
- **Defences:** S1 keep the elbow tight (`def.pull_elbow`), `def.head_up_sit_out` · S2 `def.post_against_roll` (post the free hand, walk *against* the roll) · S3 `def.roll_with` (roll *with* it fast to come out on top), `def.swim_arm`, `def.tap` `[S: §2.4]`.
- **Escapes:** back to `pos.ground_turtle` 40 % · reverse onto top (`pos.ground_half_flat`, attacker bottom) 20 % · arm free → bottom side/half (attacker top) 40 % `[S: §2.4]`. **Abandon:** `pos.ground_front_headlock`.
- **Counters:** roll counter; single-leg from turtle on a loose grip (§03).
- **Chains:** out `edge.sub.anaconda_to_darce` (0.30), `edge.sub.anaconda_to_arm_tri` (0.20), `edge.sub.darce_to_back` (shared), `edge.sub.darce_to_guillotine` (shared); in `edge.sub.guillotine_to_anaconda`, `edge.sub.darce_to_anaconda`.
- **Modifiers:** as `sub.darce`.
- **Share:** **2.4 %** `[S: SUB_FINISH §1a 40/1,695]`.

#### `sub.peruvian_necktie` — Peruvian necktie · choke · mixed + crank (`pBlood` 0.6)
- **Entries:** `pos.ground_front_headlock` (top; opponent turtled; attacker at the head with the near arm in).
- **Grips/controls:** ten-finger or figure-four arm-in grip; sit to the hip with one leg over the neck and one over the back `[S: §2.18]`.
- **Stages:** S1 0.40 / 2,000 · S2 0.45 / 3,000 (2,000–5,000) · S3 0.60 / 3,000 `[S: §2.18]`. **Conv 0.27.**
- **Finish clock:** tap 4,000–10,000 ms `[S: §2.18]`; `tLoc` μ 9.0 s `[D]`; `enduranceMs` 15,000; `hEsc` 0.02 / 0.06.
- **Defences:** S1 `def.head_up_sit_out`, `def.swim_arm` · S2 `def.posture_up` (posture backward as the attacker sits; walk the knees in) · S3 `def.roll_with` (toward the choking arm), `def.endure`, `def.tap` `[S: §2.18]`.
- **Escapes:** posture out → `pos.ground_turtle`/`pos.ground_scramble` 55 % · roll → attacker on bottom 30 % · round end 15 % `[S: §2.18]`. **Abandon:** attacker on bottom open guard (positional cost) `[E]`.
- **Chains:** `edge.sub.necktie_family` (↔ Japanese necktie ↔ D'Arce ↔ anaconda ↔ guillotine) `[S: §2.18]`.
- **Modifiers:** `M_LEN_ARM`, `M_SLIP_LOW`, `M_STR_FIN`, `M_FLX_ATT` (weight 0.5), `M_FAT_ATT_GRIP`.
- **Share:** 0.12 % `[S: SUB_FINISH §1a 2/1,695 (+1 Pace choke)]`. Neck-crank component → illegal where cranks are (§5, ◐).

#### `sub.japanese_necktie` — Japanese necktie · choke · mixed + crank (`pBlood` 0.6)
- **Entries:** `pos.ground_front_headlock`, `pos.ground_turtle` (top; D'Arce grip, step the far leg over the back, drop to the opposite hip) `[S: §2.19]`.
- **Grips/controls:** D'Arce grip + leg across the back; head forced to the chest `[S: §2.19; EV9]`.
- **Stages:** S1 0.40 / 2,000 · S2 0.40 / 3,000 · S3 0.60 / 3,000 `[S: §2.19]`. **Conv 0.24.**
- **Finish clock:** tap 4,000–10,000 ms `[S: §2.19]`; `tLoc` μ 9.0 s `[D]`; `enduranceMs` 15,000; `hEsc` 0.02 / 0.06.
- **Defences:** as `sub.darce` plus `def.head_up_sit_out` ("sit through toward the attacker's legs") `[S: §2.19]`.
- **Escapes:** as `sub.darce`. **Abandon:** `pos.ground_front_headlock`. **Chains:** `edge.sub.necktie_family`. **Modifiers:** as `sub.darce`.
- **Share:** ≈ 0.06 % `[S: SUB_FINISH §6 "≥ 1"]`.

#### `sub.bulldog` — Bulldog choke (side headlock choke) · choke · mixed + crank (`pBlood` 0.3)
- **Entries:** `pos.ground_scramble` (head won from the side), `pos.ground_turtle` (top, beside the opponent), `pos.ground_kesa_gatame` (top; head in the armpit) `[S: §2.20]`.
- **Grips/controls:** head in the armpit, forearm across the throat, hand clasp; drop to the hip, pull the head and turn the face up with the hip `[S: §2.20]`.
- **Stages:** S1 0.35 / 1,500 · S2 0.40 / 3,000 · S3 0.45 / 5,000 (3,000–8,000) `[S: §2.20]`. **Conv 0.18.**
- **Finish clock:** tap 6,000–15,000 ms `[S: §2.20]`; `tLoc` μ 9.0 s `[D]` only when functional (`pBlood` 0.3 `[E]`); `enduranceMs` 15,000; `hEsc` 0.06/s (non-functional) — "the defender can often endure to the round end" `[S: §2.20]`.
- **Defences:** S1 `def.pull_head_back`, `def.turn_in_bridge` · S2 `def.turn_head_toward` · S3 `def.endure`, back take on the attacker (`def.counter_sub` → §03 back take, T3+), `def.tap` `[S: §2.20]`.
- **Escapes:** head out → **defender takes the attacker's back** (`pos.ground_back_hooks`, defender top) 40 % · neutral `pos.ground_scramble` 60 % `[S: §2.20]`. **Abandon:** `pos.ground_kesa_gatame` (top retained) `[S: §2.20 "outbound → scarf-hold"]`.
- **Chains:** out `edge.pos.bulldog_to_kesa`; in `edge.pos.scramble_to_bulldog`.
- **Modifiers:** `M_STR_FIN` (large), `M_SKILL` (heavily gap-dependent: works on beginners or in chaos `[S: §2.20]`), `M_ROCKED`, `M_SLIP_HIGH`.
- **Share:** 0.4 % `[S: SUBMISSIONS §1.2 "≥ 6"]`.

### 3.3 Mount and side-control attacks

#### `sub.arm_triangle_mount` — Arm-triangle (kata-gatame) from mount · choke · blood
- **Entries:** `pos.ground_mount_high`, `pos.ground_mount_low`, `pos.ground_mount_technical` (top; trigger `evt.arm_crossed_centre` — ≈ 60 % follow GnP framing `[S: §2.5]`) · `pos.ground_half_flat` (top; knee-slide arm-triangle) · via `edge.sub.darce_to_arm_tri` / `edge.sub.anaconda_to_arm_tri`.
- **Grips/controls:** opponent's arm across their own neck, attacker's head on the far side, arm under the neck (hand to own biceps or gable), then **dismount to the opposite side** and sprawl `[S: §2.5]`.
- **Stages:** S1 0.50 / 2,000 (1,000–3,000) · S2 0.55 / 7,000 (4,000–10,000) · S3 0.75 / 5,000 (3,000–8,000) `[S: §2.5]`. **Conv 0.41.**
- **Finish clock:** tap 5,000–15,000 ms `[S: §2.5]`; `tLoc` μ **7.2 s** (fastest common choke) `[S: P4 / W5]`; 13 of 92 UFC victims went out `[S: SK4]`; `hEsc` 0.02/s.
- **Defences:** S0 elbows to the hips, frame on the hip not the face · S1 `def.pull_elbow`, `def.turn_in_bridge` (turn *into* the attacker) · S2 `def.answer_phone` (trapped hand to own ear), `def.turn_in_bridge` (bridge toward the attacker as they dismount, get the knee in) · S3 `def.turn_in_bridge` (walk the legs toward the attacker), `def.endure` (blood: −1.5), `def.tap` `[S: §2.5; BJ2]`.
- **Escapes:** bridge-and-turn → attacker's guard or `pos.ground_turtle` 50 % · attacker retains side control/mount without the choke 40 % · reversal (defender top) 10 % `[S: §2.5]`. **Abandon:** `pos.ground_mount_low` retained (45 %) / `pos.ground_side_control` `[S: §3 "Arm-Triangle → MOUNT retained 0.45"]`.
- **Counters:** bridge into the attacker as they step over; from half guard, underhook and come up to a single (§03) `[S: §2.5]`.
- **Chains:** out `edge.sub.arm_tri_to_americana_kimura` (0.20), `edge.sub.arm_tri_to_mounted_tri` (0.10), `edge.sub.arm_tri_to_back` (0.15), `edge.sub.arm_tri_to_mounted_guillotine`; in `edge.pos.mount_gnp_to_arm_tri`, `edge.sub.darce_to_arm_tri`, `edge.sub.anaconda_to_arm_tri`, `edge.sub.kimura_side_to_arm_tri`, `edge.sub.americana_to_arm_tri`.
- **Modifiers:** `M_CTRL`, `M_SETUP` (GnP is the primary creator), `M_MASS` (large: "bigger attacker = better"), `M_STR_FIN`, `M_SLIP_HIGH` (HW chests slide), `M_NECK`, `M_LEN_ARM`, `M_FAT_ATT`, `M_ROCKED` (very large).
- **Share:** arm-triangle (all) **7.7 %** `[S: SUB_FINISH §1a 130/1,695]`; mount ≈ 5.5 % `[E split]`.

#### `sub.arm_triangle_side` — Arm-triangle from side control / half guard top · choke · blood
- **Entries:** `pos.ground_side_control`, `pos.ground_half_flat` (top; trigger `evt.arm_crossed_centre` or the bottom's underhook pushed across), `pos.ground_kesa_gatame` (top; head-and-arm already trapped) `[S: §2.5 required positions; BJJ_POS §2.3]`.
- **Grips/controls:** as mount but without the dismount step; walk toward the head, hips low.
- **Stages:** S1 0.45 / 2,000 · S2 0.50 / 6,000 (3,000–9,000) · S3 0.70 / 5,000 `[E: mount values −0.05 at each stage — no dismount leverage but no mount-loss risk; consistent with §2.5 "most common in MMA from mount"]`. **Conv 0.35.**
- **Finish clock / Defences / Escapes / Counters / Chains / Modifiers:** as `sub.arm_triangle_mount`; **Abandon:** `pos.ground_side_control` retained.
- **Share:** ≈ 2.0 % `[E split]`.

#### `sub.arm_triangle_standing` — Standing arm-triangle (clinch / cage) · choke · blood
- **Entries:** `pos.clinch_over_under`, `pos.clinch_collar_tie` (either; requires the opponent's arm pushed across and head-and-arm grip; trigger: opponent shoots or ducks with an arm up) `[E]`.
- **Grips/controls:** head-and-arm grip standing; finished by walking the opponent to the fence or dragging to the mat (→ `sub.arm_triangle_side` via `edge.sub.standing_arm_tri_to_ground`).
- **Stages:** S1 0.30 / 2,000 · S2 0.30 / 4,000 · S3 0.50 / 5,000 `[E: rare standing finish; the usual route is to take it to the ground]`. **Conv 0.15.**
- **Finish clock:** tap 5,000–15,000 ms `[E]`; `tLoc` μ 7.2 s `[S: P4 arm-triangle]`; `hEsc` 0.05/s (standing) `[E]`.
- **Defences:** S1 `def.pull_elbow`, `def.posture_up` · S2 `def.answer_phone`, `def.hand_fight` · S3 `def.endure`, `def.tap`.
- **Escapes:** pull out → `pos.clinch_over_under` 70 % · takedown on the attacker (§03) 30 % `[E]`. **Abandon:** clinch retained.
- **Chains:** out `edge.sub.standing_arm_tri_to_ground` (0.50 `[E]`); in none.
- **Modifiers:** `M_MASS`, `M_STR_FIN`, `M_SLIP_HIGH`, `M_NECK`, `M_LEN_ARM`, `M_CAGE` (+0.3 when the defender's back is on the fence `[E]`).
- **Share:** ≈ 0.2 % `[E]`.

#### `sub.armbar_mount` — Armbar from mount (S-mount / spinning) · jointLock
- **Entries:** `pos.ground_mount_s` (top; primary), `pos.ground_mount_high` (top; trigger `evt.hand_posted` — bottom pushes off the chest / posts), `pos.ground_mount_technical` (far arm), `pos.ground_mount_gnp` (bottom's straight-arm push, T0–T1 behaviour), `pos.ground_knee_on_belly` (far-arm "shotgun") `[S: §2.7; SUB_COACH armbar]`.
- **Grips/controls:** arm isolated at the wrist/elbow, knee high on the chest, step over the head, fall back or stay belly-down `[S: §2.7]`.
- **Stages:** S1 0.55 / 2,000 (1,000–3,000) · S2 **0.40** / 5,000 (3,000–10,000) · S3 0.85 / 1,500 (1,000–3,000) `[S: §2.7 table 0.55/0.50/0.85; S2 −0.10 D: armbar family calibration]`. **Conv 0.34.**
- **Finish clock:** tap 0–3,000 ms; refusal → injury 1,000–3,000 ms, high `[S: §2.7; P14]`; `hEsc` 0.02/s.
- **Defences:** S0 keep the elbows in, never post far from the hip · S1 `def.pull_elbow`, `def.posture_up` (drive the head to the chest) · S2 `def.grip_clasp`, `def.hitchhiker`, `def.spin_out`, `def.stack` (unavailable: no stack from the bottom) · S3 `def.hitchhiker` (0.25×), `def.tap` `[S: §2.7; K3; EV2]`.
- **Escapes:** posture + pull out → **defender comes up into the attacker's guard** (`pos.ground_closed_guard_bottom`, attacker bottom) 45 % · hitchhiker/spin-out → defender top of `pos.ground_half_flat` 15 % · attacker abandons to keep mount 25 % · defender takes the back if the attacker falls off 15 % `[D: §2.7 shares re-split for the mount variant using §3 "Armbar (mount) → GUARD_TOP_FOR_DEFENDER 0.35 / Back take 0.10"]`. **Abandon:** `pos.ground_mount_low` retained (positional cost applies only on escape).
- **Counters:** the defender's stand-up-into-guard; back take when the attacker falls `[S: §2.7 counters]`.
- **Chains:** out `edge.sub.armbar_mount_to_mounted_tri` (0.20), `edge.sub.armbar_mount_to_back` (0.10), `edge.sub.armbar_to_tri`; in `edge.sub.americana_to_armbar`, `edge.sub.mounted_tri_to_armbar`, `edge.pos.throw_to_mount_armbar` (Rousey route), `edge.sub.arm_tri_to_americana_kimura`.
- **Modifiers:** `M_CTRL`, `M_SETUP`, `M_STR_DEF` (grip break), `M_FLX_ATT` (weight 0.5), `M_LEN_LEG`, `M_SLIP_LOW`, `M_GLOVES`, `M_CLASS`, `M_FAT_ATT`.
- **Share:** armbar (all) **11.9 %** `[S: SUB_FINISH §1a 202/1,695]`; mount ≈ 5.0 % `[E split]`. Women 3.03× more likely to lose by an upper-limb lock `[S: P5]` → the women's attempt-weight multiplier (§6.1).

#### `sub.armbar_belly_down` — Belly-down / straight armbar from top (knee-on-belly, side, north-south spin) · jointLock
- **Entries:** `pos.ground_knee_on_belly`, `pos.ground_side_control`, `pos.ground_north_south` (top; trigger `evt.hand_posted` / push on the chest) `[S: §2.7 variants]`.
- **Grips/controls:** arm trapped against the attacker's chest, spin to belly-down, hips over the elbow.
- **Stages:** S1 0.50 / 1,500 · S2 **0.40** / 3,500 (2,000–6,000) · S3 0.85 / 1,500 `[S: §2.7 table 0.50/0.50/0.85; S2 −0.10 D]`. **Conv 0.34.**
- **Finish clock:** as `sub.armbar_mount`.
- **Defences:** S1 `def.pull_elbow` · S2 `def.grip_clasp`, `def.hitchhiker`, `def.spin_out` · S3 `def.tap`.
- **Escapes:** pull out → attacker retains side control 45 % · spin-out → `pos.ground_scramble` 30 % · defender to top of half guard 25 % `[E: from §2.7 shares]`. **Abandon:** `pos.ground_side_control` retained.
- **Chains:** out `edge.sub.armbar_to_tri` (side triangle), `edge.sub.armbar_side_to_kimura` (0.15 `[E]`); in `edge.sub.kimura_to_armbar`, `edge.sub.ns_choke_to_kimura` (shared N-S family).
- **Modifiers:** as `sub.armbar_mount`.
- **Share:** ≈ 0.5 % `[E split]`.

#### `sub.americana` — Americana / keylock · jointLock (shoulder)
- **Entries:** `pos.ground_mount_high`, `pos.ground_mount_low`, `pos.ground_side_control`, `pos.ground_kesa_gatame` (top; trigger: bottom's arm bent above the shoulder line — blocking punches or pushing the chest) `[S: §2.9]`.
- **Grips/controls:** wrist pinned, figure-four under the elbow, "paint brush" the knuckles along the mat `[S: §2.9; EV3]`.
- **Stages:** S1 0.45 / 1,500 · S2 0.40 / 3,000 (2,000–5,000) · S3 0.75 / 2,000 `[S: §2.9]`. **Conv 0.30.**
- **Finish clock:** tap 2,000–6,000 ms `[S: §2.9]`; refusal → injury 2,000–4,000 ms, medium (labrum/cuff) `[S: SUB_PHYS §2]`; `hEsc` 0.05/s.
- **Defences:** S0 elbows to the ribs · S1 `def.straighten_arm`, `def.pull_elbow` · S2 `def.frame_and_bridge` (bridge into the attacker, elbow to the mat), `def.grip_clasp` · S3 `def.roll_with` (from side control), grab own head, `def.tap` `[S: §2.9]`.
- **Escapes:** straighten → position retained by the top fighter 80 % · bridge → `pos.ground_half_flat` (attacker top) 20 % `[S: §2.9]`. **Abandon:** position retained.
- **Chains:** out `edge.sub.americana_to_kimura` (0.30), `edge.sub.americana_to_armbar` (0.25), `edge.sub.americana_to_arm_tri`; in `edge.sub.arm_tri_to_americana_kimura`, `edge.sub.kimura_to_americana`.
- **Modifiers:** `M_CTRL`, `M_STR_FIN` (large), `M_FLX_DEF` (large), `M_SETUP`. Against T5 defenders the effective conversion ≈ 0.03 `[S: §2.9]` — produced by `M_SKILL` plus `def.straighten_arm` at S1.
- **Share:** ≈ 0.7 % `[S: §1.2 "ESTIMATE 10–15 UFC"]`; high finish rate on beginners, near zero on T4+ `[S: §2.9]`.

#### `sub.kimura_side` — Kimura from side control / top half guard / reverse kesa · jointLock (shoulder)
- **Entries:** `pos.ground_side_control`, `pos.ground_half_flat` (top), `pos.ground_reverse_kesa`, `pos.ground_half_deep` (top) (trigger `evt.hand_posted` or the bottom's underhook wrapped) `[S: §2.8; BJJ_POS §2]`.
- **Grips/controls:** figure-four on the wrist, elbow pinned to the attacker's chest, opponent's arm trapped by the leg or the "hip in" to stop the roll `[S: §2.8]`.
- **Stages:** S1 0.55 / 2,000 · S2 0.55 / 4,000 (2,000–6,000) · S3 0.80 / 2,000 (1,000–4,000) `[S: §2.8 table "Side/N-S top"]`. **Conv 0.44.**
- **Finish clock:** tap 1,000–4,000 ms `[S: §2.8]`; refusal → injury 1,000–3,000 ms, high (humeral fracture: Mir–Nogueira) `[S: WR2; P15 second-most injurious]`; `hEsc` 0.03/s.
- **Defences:** S0 don't post away from the hip · S1 `def.straighten_arm` (grab own shorts/thigh), `def.pull_elbow` · S2 `def.roll_with` (roll over the shoulder), `def.grip_clasp`, `def.turn_in_bridge` · S3 `def.roll_with`, `def.tap` `[S: §2.8; K4]`.
- **Escapes:** straighten and pull out → same position 60 % · roll through → attacker keeps the grip and usually stays on top (kimura trap) 25 % · reversal 15 % `[S: §2.8]`. **Abandon:** side control / mount retained `[S: §2.8 "failed kimura from top → mount / side control retained"]`.
- **Counters:** the bottom fighter's roll can reverse (15 %) `[S: §2.8]`.
- **Chains:** out `edge.sub.kimura_side_to_ns_choke` (0.20), `edge.sub.kimura_side_to_arm_tri` (0.15), `edge.sub.kimura_to_armbar` (0.10), `edge.sub.kimura_to_americana`, `edge.sub.kimura_side_to_darce` (bottom turns in `[E]`); in `edge.sub.americana_to_kimura`, `edge.sub.arm_tri_to_americana_kimura`, `edge.sub.ns_choke_to_kimura`.
- **Modifiers:** `M_STR_FIN` (large — "the strong man's submission"), `M_SLIP_HIGH` (wrist grip), `M_GLOVES` (−0.1), `M_FLX_DEF` (large), `M_CTRL`, `M_FAT_ATT_GRIP`.
- **Share:** kimura (all) **2.7 %** `[S: SUB_FINISH §1a 46/1,695]`; side/top ≈ 1.3 % `[E split]`.

#### `sub.kimura_north_south` — North-south kimura · jointLock (shoulder)
- **Entries:** `pos.ground_north_south` (top; trigger: bottom's arm free/posted).
- **Grips/controls:** as `sub.kimura_side` with the attacker's chest over the shoulder; the "two grips = 90 % of finishes" position `[S: SUB_COACH kimura]`.
- **Stages / Finish clock / Defences:** as `sub.kimura_side` `[S: §2.8 pools "Side/N-S top"]`. **Conv 0.44.**
- **Escapes:** as `sub.kimura_side`; **Abandon:** `pos.ground_north_south` retained.
- **Chains:** out `edge.sub.kimura_side_to_ns_choke` (↔ north-south choke 0.20), `edge.sub.kimura_to_armbar`; in `edge.sub.ns_choke_to_kimura`.
- **Share:** ≈ 0.3 % `[E split]`.

#### `sub.north_south_choke` — North-south choke · choke · blood
- **Entries:** `pos.ground_north_south`, `pos.ground_side_control` (top; transition to the head) `[S: §2.15]`.
- **Grips/controls:** arm around the neck, shoulder in the throat, chest on the face, hips low, heads side by side; grip hands or own shoulder `[S: §2.15; FS3]`.
- **Stages:** S1 0.45 / 2,000 · S2 0.45 / 5,000 (3,000–8,000) · S3 0.55 / 8,000 (5,000–12,000) `[S: §2.15]` — slow. **Conv 0.25.**
- **Finish clock:** tap 8,000–20,000 ms `[S: §2.15 "slow; the defender often thinks they are fine and then goes out"]`; `tLoc` μ **9.4 s** `[S: P4 / W8]`; `hEsc` 0.02/s.
- **Defences:** S1 `def.turn_in_bridge` (elbow to the neck) · S2 `def.frame_and_bridge` (bridge, pull the head out backwards), `def.chin_tuck` · S3 turn the head toward the elbow and walk the shoulders out (`def.turn_in_bridge`), `def.endure` (blood: −1.5), `def.tap` `[S: §2.15]`.
- **Escapes:** bridge and turn to knees → `pos.ground_turtle` (attacker top) 50 % · attacker resets `pos.ground_side_control` 50 % `[S: §2.15]`. **Abandon:** `pos.ground_north_south` retained.
- **Chains:** out `edge.sub.ns_choke_to_kimura` (0.20), `edge.sub.ns_choke_to_arm_tri`, `edge.pos.ns_to_mount`; in `edge.sub.kimura_side_to_ns_choke`.
- **Modifiers:** `M_SLIP_HIGH` (very large: weight ×1.3 `[S: §2.15 "the worst offender in sweat"]`), `M_MASS` (bigger attacker better), `M_STR_FIN`, `M_NECK`, `M_NECK_GIRTH`, `M_FAT_ATT_GRIP`, `M_CTRL`.
- **Share:** 0.3 % `[S: SUB_FINISH §1a 5/1,695]`.

#### `sub.ezekiel_top` — Ezekiel choke from mount / inside guard (no-gi, glove-assisted) · choke · mixed (`pBlood` 0.5)
- **Entries:** `pos.ground_mount_low`, `pos.ground_mount_high` (top; trigger: head-and-arm wrap during GnP), `pos.ground_closed_guard_broken` (top; rare), `pos.ground_back_hooks` (top; rare) `[S: §2.16]`.
- **Grips/controls:** one arm behind the head, other hand grips own opposite wrist/glove edge, forearm across the neck ("fist in the throat") `[S: §2.16]`.
- **Stages:** S1 0.40 / 1,500 · S2 0.40 / 3,000 · S3 0.45 / 5,000 (3,000–8,000) `[S: §2.16 top]`. **Conv 0.18.**
- **Finish clock:** tap 5,000–15,000 ms `[S: §2.16]`; `tLoc` μ 9.0 s `[D]` when functional; `enduranceMs` 12,000; `hEsc` 0.02 / 0.06.
- **Defences:** S1 keep the head out (`def.pull_head_back`) · S2 `def.posture_up`, pull the hand off the throat (`def.hand_fight`), turn the chin to the elbow (`def.chin_tuck`) · S3 `def.endure`, `def.tap` `[S: §2.16]`.
- **Escapes:** posture → mount retained 70 % · frame-and-bridge → half guard 30 % `[S: §2.16]`. **Abandon:** mount retained.
- **Chains:** out `edge.sub.ezekiel_to_arm_tri` (0.20 `[E]`); in `edge.pos.mount_gnp_to_ezekiel`.
- **Modifiers:** `M_STR_FIN` (large), `M_SLIP_HIGH`, `M_GLOVES` (*helps*: +0.2 with gloves `[S: §2.16 "MMA gloves help"]`), `M_CTRL`, `M_MASS` (weight 0.5).
- **Share:** Ezekiel (both) 0.3 % `[S: SUB_FINISH §1a 5/1,695]`; top ≈ 0.2 % `[E split]`.

#### `sub.ezekiel_bottom` — Ezekiel from the bottom of mount / half guard (Oleinik) · choke · mixed (`pBlood` 0.5)
- **Entries:** `pos.ground_mount_low`, `pos.ground_mount_gnp` (bottom; trigger: top stays low and heavy, head within reach), `pos.ground_half_flat` (bottom) `[S: §2.16]`. **Enabled only when `glovesMma`** `[S: rule 16]`.
- **Grips/controls:** as top; the bottom fighter hugs the head and drives the forearm.
- **Stages:** S1 0.30 / 2,000 · S2 0.35 / 4,000 · S3 0.40 / 6,000 `[S: §2.16 bottom]`. **Conv 0.14.**
- **Finish clock:** as top.
- **Defences:** S1–S3 `def.posture_up` (the top fighter postures and strikes — `def.strike_attacker` available; this is why it works only on fighters who stay low) `[S: §2.16]`.
- **Escapes:** top postures out → mount retained with GnP window 90 % · bottom recovers half guard 10 % `[E]`. **Abandon:** mount retained (bottom).
- **Chains:** out `edge.sub.ezekiel_bottom_to_guillotine` (top pulls out → 0.20 `[S: §2.16]`).
- **Modifiers:** `M_STR_FIN`, `M_SLIP_HIGH`, `M_GLOVES` (+0.2), `M_LEN_ARM`, opponent's `sk.control` via `M_CTRL` inverse.
- **Share:** ≈ 0.1 % `[S: §2.16 Oleinik ×2]`.

#### `sub.von_flue` — Von Flue choke · choke · blood
- **Entries:** `pos.ground_side_control` (top; **requires** the bottom fighter to be holding a guillotine/head-and-arm grip after being passed to the choking-arm side — only via `edge.sub.guillotine_to_von_flue`, `def.counter_sub`) `[S: §2.17]`.
- **Grips/controls:** shoulder driven into the neck, hands clasped behind the head, hips dropped `[S: §2.17; GA1]`.
- **Stages:** S1 skipped (entered at S2) · S2 0.60 / 3,000 (2,000–5,000) · S3 0.65 / 4,000 (2,000–6,000) `[S: §2.17]`. **Conv 0.39.**
- **Finish clock:** tap 4,000–10,000 ms `[S: §2.17]`; `tLoc` μ 9.0 s `[D]`; `hEsc` 0.02/s.
- **Defences:** S2 `def.release_grip` (the whole counter depends on the bottom fighter's stubbornness: release p 0.8 T3+, 0.4 T2, 0.1 T≤1 per window `[S: rule 20]`), `def.turn_in_bridge` · S3 `def.release_grip` (0.5×), `def.tap`.
- **Escapes:** release → bottom `pos.ground_side_control` (attacker top) 100 % `[S: §2.17 "the escape is releasing"]`. **Abandon:** side control retained.
- **Chains:** in only (`edge.sub.guillotine_to_von_flue`).
- **Modifiers:** `M_MASS`, `M_STR_FIN`, `M_SKILL` (defender's `sk.escapes` drives the release), `M_NECK`.
- **Share:** ≈ 0.5 % `[S: §1.2 "≈ 8"]`; a classic "beginner tap".

#### `sub.triangle_mounted` — Mounted triangle · choke · blood
- **Entries:** `pos.ground_mount_s`, `pos.ground_mount_high` (top; trigger `evt.arm_crossed_centre` or a framing arm inside), via `edge.sub.tri_to_mounted_tri` (sweep from a guard triangle), `edge.sub.arm_tri_to_mounted_tri`, `edge.sub.armbar_mount_to_mounted_tri` `[S: §2.6]`.
- **Grips/controls:** S-mount, step over the head, figure-four the legs; roll or finish in place `[S: §2.6]`.
- **Stages:** S1 0.55 / 2,000 · S2 0.55 / 5,000 (3,000–8,000) · S3 0.70 / 4,000 `[S: §2.6 table "Mounted"]`. **Conv 0.385.**
- **Finish clock:** tap 5,000–15,000 ms `[S: §2.6]`; `tLoc` μ 9.5 s `[S: P4]`; `hEsc` 0.02/s.
- **Defences:** S1 `def.pull_elbow`, `def.frame_and_bridge` · S2 `def.answer_phone`, `def.chin_tuck` · S3 `def.turn_in_bridge`, `def.endure` (−1.5), `def.tap`.
- **Escapes:** attacker retains `pos.ground_side_control`/mount 75 % · bottom recovers half guard 25 % `[S: §2.28; §3 "Mounted Triangle → SIDE_CONTROL retained 0.45"]`. **Abandon:** side control retained.
- **Chains:** out `edge.sub.mounted_tri_to_armbar` (0.35); in as listed.
- **Modifiers:** `M_CTRL`, `M_LEN_LEG`, `M_FLX_ATT`, `M_NECK`, `M_SLIP_LOW`, `M_FAT_ATT`, `M_SETUP`, `M_CLASS`.
- **Share:** ≈ 1.0 % `[E split of triangle 5.5 %]`.

### 3.4 Guard attacks (bottom)

#### `sub.triangle_guard` — Front triangle from guard · choke · blood
- **Entries:** `pos.ground_closed_guard_broken`, `pos.ground_high_guard`, `pos.ground_open_guard_kneeling_top`, `pos.ground_rubber_guard`, `pos.ground_butterfly` (bottom; requires one arm in / one arm out; trigger `evt.hand_posted` (opponent posts to strike / pushes the hip to pass) or `evt.posture_broken`) · `pos.ground_half_knee_shield` (bottom; knee-shield removal) `[S: §2.6; BJJ_POS §2.5]`.
- **Grips/controls:** leg over the shoulder, diamond or immediate figure-four, cut the angle, head pulled down, trapped arm across the throat, shin behind the knee `[S: §2.6]`.
- **Stages:** S1 0.50 / 2,000 (1,000–3,000) · S2 0.45 / 6,500 (3,000–10,000) · S3 0.55 / 5,000 (3,000–8,000) `[S: §2.6 table "Guard"]`. **Conv 0.25.**
- **Finish clock:** tap 5,000–15,000 ms `[S: §2.6]`; `tLoc` μ **9.5 s** `[S: P4 / W6]`; `hEsc` 0.02/s; stalled triangles up to 30–60 s arise from `dMax` re-rolls (§2.4.4).
- **Defences:** S0 posture, hands on the hips · S1 `def.posture_up` (pull the head out before the lock), elbow-bar across the hip · S2 `def.answer_phone`, `def.stack`, `def.posture_up` (hands on the belly, look at the ceiling), `def.strike_attacker` (elbows to the thigh are legal) · S3 `def.stack` (walk to the trapped-arm side), `def.slam`, "Henderson escape" (`def.posture_up` at 0.3× `[E]`), `def.counter_sub` (leg attack on a diamond, T4+ legLocks ≥ 60), `def.endure` (−1.5), `def.tap` `[S: §2.6; EV5; FS2]`.
- **Escapes:** posture out → back in the attacker's guard (`pos.ground_closed_guard_bottom`) 55 % · stack-pass → `pos.ground_side_control` (defender top) 25 % · slam → top of `pos.ground_scramble` 10 % (often a KO) · round end 10 % `[S: §2.6]`. **Abandon:** guard retained (`pos.ground_closed_guard_bottom`) 75 % / `pos.ground_open_guard_kneeling_top` 25 % `[E]`.
- **Counters:** `def.slam` (legal in MMA; rare, very effective at LHW/HW) `[S: §2.6; W7]`; knee-slice through the diamond (§03 pass edge with +0.3 `[E]`); strikes to the body; leg-lock counter on the diamond `[S: §2.6]`.
- **Chains:** out `edge.sub.tri_to_armbar` (0.30), `edge.sub.tri_to_omoplata` (0.15), `edge.sub.tri_to_mounted_tri` (0.10, sweep), `edge.sub.tri_to_gogoplata` (0.03, FLX gate), `edge.sub.tri_slam` (defender) ; in `edge.sub.armbar_to_tri`, `edge.sub.guillotine_to_tri`, `edge.sub.omoplata_to_tri`, `edge.sub.rnc_to_rear_tri` (rear variant), `edge.pos.arm_drag_to_tri`, `edge.sub.kimura_grip_to_tri`.
- **Modifiers:** `M_FLX_ATT` (large), `M_LEN_LEG` (very large: weight ×1.5 `[S: §2.6 "leg length vs opponent torso very large"]`), `M_STR_DEF` (stack/slam), `M_SLIP_LOW`, `M_FAT_ATT` (legs cramp), `M_CLASS`, `M_CAGE` (−0.3), `M_CTRL` inverse.
- **Share:** triangle (all) **5.5 %** `[S: SUB_FINISH §1a 94/1,695]` (6.9 % in G1 `[S: SUBMISSIONS §1.2]`); guard ≈ 4.0 % `[E split]`. Paul Craig holds the UFC record `[S: FS2]`.

#### `sub.triangle_side` — Side triangle (yoko-sankaku) from top / from a failed armbar · choke · blood
- **Entries:** `pos.ground_side_control`, `pos.ground_north_south`, `pos.ground_knee_on_belly` (top; trigger: bottom's arm extended/pushed across), via `edge.sub.armbar_to_tri` from `sub.armbar_belly_down` / `sub.armbar_back` `[S: SUB_COACH triangle "side (yoko-sankaku)"; K3 "alternatives side triangle"]`.
- **Grips/controls:** legs figure-four around the neck and one arm from the side, attacker perpendicular.
- **Stages:** S1 0.40 / 2,500 · S2 0.45 / 5,000 · S3 0.60 / 4,000 `[E: between guard and mounted values; entered mostly as a chain]`. **Conv 0.27.**
- **Finish clock:** tap 5,000–15,000 ms `[E]`; `tLoc` μ 9.5 s `[S: P4 triangle]`; `hEsc` 0.02/s.
- **Defences:** S1 `def.pull_elbow`, `def.posture_up` · S2 `def.answer_phone`, `def.turn_in_bridge` · S3 `def.endure` (−1.5), `def.tap`.
- **Escapes:** defender to top of half guard 40 % · attacker retains side control 60 % `[E]`. **Abandon:** side control retained.
- **Chains:** out `edge.sub.tri_to_armbar` (side variant); in `edge.sub.armbar_to_tri`.
- **Modifiers:** as `sub.triangle_mounted`.
- **Share:** ≈ 0.1 % `[E]`.

#### `sub.triangle_inverted` — Inverted / reverse triangle · choke · blood
- **Entries:** `pos.ground_side_control` (bottom; opponent's head and arm caught when passing), `pos.ground_north_south` (bottom), `pos.ground_open_guard_kneeling_top` (inverted guard) `[S: §2.6 "reverse/inverted (very rare in MMA)"]`.
- **Grips/controls:** legs locked around the neck and one arm with the attacker inverted/underneath.
- **Stages:** S1 0.30 / 2,500 · S2 0.40 / 5,000 · S3 0.60 / 4,000 `[E]`. **Conv 0.24.** Requires `sk.chokes ≥ 60` and flexibility ≥ 60 to be selected `[E]`.
- **Finish clock:** as `sub.triangle_guard`.
- **Defences:** S1 `def.posture_up` · S2 `def.stack`, `def.answer_phone` · S3 `def.slam` (if upright), `def.endure` (−1.5), `def.tap`.
- **Escapes:** pass/pull out → defender retains top 70 % · attacker sweeps to top 30 % `[E]`. **Abandon:** attacker bottom open guard.
- **Chains:** out `edge.sub.tri_to_armbar`, `edge.sub.inverted_tri_to_kimura` (Rockhold UFC 172 `[S: §1.2]`); in none.
- **Modifiers:** `M_FLX_ATT` (weight ×2), `M_LEN_LEG`, `M_STR_DEF`, `M_SLIP_LOW`.
- **Share:** 0.24 % `[S: SUB_FINISH §1a 4/1,695]`.

#### `sub.armbar_guard` — Armbar from guard (juji-gatame) · jointLock
- **Entries:** `pos.ground_closed_guard_broken`, `pos.ground_high_guard`, `pos.ground_open_guard_kneeling_top`, `pos.ground_rubber_guard` (bottom; trigger `evt.hand_posted` — opponent posts on the mat to strike/base — or `evt.posture_broken` with the arm across the centre) `[S: §2.7]`.
- **Grips/controls:** wrist/elbow control, hips under the shoulder, leg over the face, cut the angle; knees pinched, thumb up, elbow above the hip `[S: §2.7]`.
- **Stages:** S1 0.45 / 2,000 (1,000–3,000) · S2 **0.35** / 6,000 (3,000–12,000) · S3 0.85 / 1,500 (1,000–3,000) `[S: §2.7 table 0.45/0.45/0.85; S2 −0.10 D: armbar family calibration]`. **Conv 0.30.**
- **Finish clock:** tap 0–3,000 ms; refusal → injury 1,000–3,000 ms, high `[S: §2.7; P14; WR2 Mir–Sylvia, Rousey–Tate]`; `hEsc` 0.02/s.
- **Defences:** S0 never post far from the hip · S1 `def.pull_elbow`, `def.posture_up` (drive the head to the chest) · S2 `def.grip_clasp`, `def.hitchhiker`, `def.stack`, `def.spin_out`, `def.slam` · S3 `def.hitchhiker` (0.25×), `def.slam`, `def.tap` `[S: §2.7; K3; EV2]`.
- **Escapes:** posture + pull out → back in the guard (`pos.ground_closed_guard_bottom`) 45 % · stack & pass → `pos.ground_side_control` (defender top) 25 % · hitchhiker/spin-out → defender top 15 % · attacker abandons 15 % `[S: §2.7]`. **Abandon:** guard retained.
- **Counters:** `def.slam` (lock breaks 0.8) `[S: rule 19]`; stack-pass.
- **Chains:** out `edge.sub.armbar_to_tri` (0.30), `edge.sub.armbar_to_omoplata` (0.10), `edge.sub.armbar_guard_to_back` (0.15, spin under); in `edge.sub.tri_to_armbar`, `edge.sub.kimura_to_armbar`, `edge.sub.omoplata_to_armbar`, `edge.sub.guillotine_to_armbar`, `edge.sub.flying_armbar_landed`.
- **Modifiers:** `M_FLX_ATT` (weight 0.5), `M_LEN_LEG`, `M_STR_DEF` (large: grip break / slam), `M_SLIP_LOW`, `M_GLOVES`, `M_CLASS`, `M_CAGE` (−0.3), `M_FAT_ATT`.
- **Share:** ≈ 4.5 % `[E split of armbar 11.9 %]`.

#### `sub.kimura_guard` — Kimura from closed guard · jointLock (shoulder)
- **Entries:** `pos.ground_closed_guard_bottom`, `pos.ground_closed_guard_broken`, `pos.ground_butterfly` (bottom; trigger `evt.hand_posted` — opponent posts a hand on the mat) `[S: §2.8]`.
- **Grips/controls:** figure-four on the wrist, sit up, hip out, elbow pinned; weak without a hip angle `[S: §2.8]`.
- **Stages:** S1 0.50 / 2,000 · S2 0.35 / 4,000 (2,000–6,000) · S3 0.65 / 2,500 `[S: §2.8 table "Guard"]`. **Conv 0.23.**
- **Finish clock:** as `sub.kimura_side`.
- **Defences:** S1 `def.straighten_arm`, `def.posture_up` (stay heavy, pull the arm free) · S2 `def.roll_with`, `def.grip_clasp`, `def.posture_up` · S3 `def.roll_with`, `def.tap` `[S: §2.8; K4 "spin to the back vs closed-guard kimura"]`.
- **Escapes:** straighten and pull out → guard retained 60 % · roll through → attacker sweeps to top (kimura trap) 25 % · stand up out of the guard 15 % `[S: §2.8]`. **Abandon:** guard retained.
- **Counters:** the top fighter passes over the kimura leg (§03 pass +0.3 `[E]`) `[S: §2.8]`.
- **Chains:** out `edge.sub.kimura_to_sweep` (0.35), `edge.sub.kimura_to_back` (0.20, kimura trap), `edge.sub.kimura_to_armbar` (0.10), `edge.sub.kimura_grip_to_tri` `[E]`; in `edge.sub.omoplata_to_kimura`, `edge.sub.tri_to_omoplata` (shared guard family).
- **Modifiers:** as `sub.kimura_side` plus `M_CTRL` inverse (top's posture).
- **Share:** ≈ 0.7 % `[E split]`.

#### `sub.kimura_half` — Kimura from bottom half guard · jointLock (shoulder)
- **Entries:** `pos.ground_half_flat`, `pos.ground_half_knee_shield`, `pos.ground_half_dogfight` (bottom, on the whizzer arm), `pos.ground_half_underhook` (bottom; kimura-trap grip) `[S: §2.8; BJJ_POS §2.4]`.
- **Stages:** S1 0.45 / 2,000 · S2 0.35 / 4,000 · S3 0.60 / 2,500 `[S: §2.8 table "Half-guard bottom"]`. **Conv 0.21.**
- **Finish clock / Defences:** as `sub.kimura_guard` (`K4`: butterfly lift and T-kimura reversal are the top's counters `[S: SUB_COACH kimura]`).
- **Escapes:** as `sub.kimura_guard` (roll-through 25 % = the attacker's sweep). **Abandon:** half guard retained.
- **Chains:** out `edge.sub.kimura_to_sweep` (0.35), `edge.sub.kimura_to_back` (0.20 — the half-guard kimura back take `[S: K4b]`), `edge.sub.kimura_to_armbar`; in `edge.pos.underhook_to_kimura_trap`.
- **Modifiers:** as `sub.kimura_side`.
- **Share:** ≈ 0.5 % `[E split]`.

#### `sub.kimura_grip` — Kimura as a grip/position (standing, whizzer, kimura trap) · jointLock (control-first)
- **Entries:** `pos.clinch_whizzer`, `pos.clinch_over_under` (either; opponent's arm exposed on a single-leg or whizzer), `pos.ground_half_dogfight`, `pos.ground_turtle` (top: rolling kimura), `pos.ground_half_underhook` (bottom) `[S: §2.8 "as a sweep / back-take grip"; BJ7 Avellan system; FS4]`.
- **Grips/controls:** the figure-four grip is the constant through transitions; the finish is secondary.
- **Stages (as a finish):** S1 0.35 / 2,000 · S2 0.30 / 4,000 · S3 0.50 / 3,000 `[S: §2.8 table "Standing/clinch"]`. **Conv 0.15.**
- **Stages (as control):** S1 success (grip secured, 0.50 `[E]`) immediately rolls the chain table instead of proceeding to S2 with weights: sweep 0.35 / back take 0.20 / takedown (standing) 0.20 / armbar 0.10 / guillotine (head drops) 0.10 / hold 0.05 `[S: §3 "Kimura (guard/half) → Sweep 0.35, Back Take 0.20, Armbar 0.10, Guillotine 0.10"; takedown E]`.
- **Finish clock / Defences:** as `sub.kimura_side`; S1 `def.straighten_arm` is the standard answer.
- **Escapes:** pull the arm out → same clinch/position 70 % · scramble 30 % `[E]`. **Abandon:** position retained.
- **Chains:** out `edge.sub.kimura_to_sweep`, `edge.sub.kimura_to_back`, `edge.sub.kimura_to_takedown`, `edge.sub.kimura_to_armbar`, `edge.sub.kimura_to_guillotine`; in `edge.pos.single_leg_to_kimura_trap` (strongest counter to the single leg `[S: SUB_COACH kimura]`).
- **Modifiers:** `M_STR_FIN` (large), `M_SLIP_HIGH`, `M_GLOVES`, `M_FLX_DEF`.
- **Share:** ≈ 0.2 % as a finish `[E]`; most kimura grips are used for control/sweeps `[S: §2.8]`.

#### `sub.omoplata` — Omoplata · jointLock (shoulder) / sweep engine
- **Entries:** `pos.ground_closed_guard_broken`, `pos.ground_high_guard`, `pos.ground_rubber_guard`, `pos.ground_open_guard_kneeling_top` (bottom; opponent's arm outside the hip; trigger `evt.hand_posted`), via `edge.sub.tri_to_omoplata`, `edge.sub.armbar_to_omoplata`, and as a counter to a knee-slice pass (§03) `[S: §2.10]`.
- **Grips/controls:** leg over the shoulder, sit up perpendicular, control the hip/belt to stop the forward roll, flatten the opponent `[S: §2.10]`.
- **Stages:** S1 0.45 / 2,000 · S2 0.35 / 4,000 (2,000–6,000) · S3 0.30 / 3,000 `[S: §2.10]`. **Conv 0.105** as a submission; as a **sweep** S1 0.45 × 0.85 ≈ 0.40 `[S: §2.10]` (handled by `edge.sub.omoplata_to_sweep`).
- **Finish clock:** tap 3,000–8,000 ms `[S: §2.10]`; refusal → injury 3,000–6,000 ms, medium (shoulder) `[E]`; `hEsc` 0.10/s (the forward roll).
- **Defences:** S1 `def.posture_up` (pull the arm out early) · S2 `def.roll_with` (forward roll — easiest and most common), drive the hip through and stand (`def.posture_up`), `def.strike_attacker` (strike the face during the sit-up) · S3 `def.step_over_head`, `def.stack` (into the attacker if the leg is loose), `def.tap` `[S: §2.10; K5]`.
- **Escapes:** forward roll → **attacker often gets the sweep / top** 45 % (→ `edge.sub.omoplata_to_sweep`) · posture out → back in guard 35 % · stand up → free (both standing) 20 % `[S: §2.10]`; the low-angle cartwheel lands the *defender* in side control (T4+, 20 % of posture-outs `[E; S: K5]`). **Abandon:** guard retained.
- **Counters:** stack into the attacker; strikes during the sit-up `[S: §2.10]`.
- **Chains:** out `edge.sub.omoplata_to_sweep` (0.45), `edge.sub.omoplata_to_tri` (0.15), `edge.sub.omoplata_to_armbar` / `edge.sub.omoplata_to_kimura` (0.10), `edge.sub.omoplata_to_back` (0.10), `edge.sub.omoplata_to_gogoplata` (rubber guard); in `edge.sub.tri_to_omoplata`, `edge.sub.armbar_to_omoplata`, `edge.pos.knee_slice_to_omoplata`.
- **Modifiers:** `M_FLX_ATT` (very large: 0.12/10), `M_LEN_LEG`, `M_SLIP_HIGH` ("slips when sweaty"), `M_STR_DEF`, `M_CAGE` (−0.3).
- **Share:** 0.12 % `[S: SUB_FINISH §1a 2/1,695]`.

#### `sub.gogoplata` — Gogoplata · choke · blood (shin across the throat)
- **Entries:** `pos.ground_rubber_guard` (bottom; requires flexibility ≥ 80 `[S: rule 14]`), via `edge.sub.omoplata_to_gogoplata`, `edge.sub.tri_to_gogoplata`; mounted gogoplata from `pos.ground_mount_s` (top; flexibility ≥ 80) `[S: §2.23]`.
- **Grips/controls:** foot to the throat via mission control, hands pull the head down onto the shin `[S: §2.23]`.
- **Stages:** S1 0.25 / 2,500 · S2 0.35 / 4,000 · S3 0.50 / 4,000 `[S: §2.23]`. **Conv 0.175.**
- **Finish clock:** tap 4,000–10,000 ms `[S: §2.23]`; `tLoc` μ 9.0 s `[D]`; `hEsc` 0.03/s `[E]`.
- **Defences:** S1 `def.posture_up` (rubber guard is beaten by posture and strikes), `def.strike_attacker` · S2 `def.pull_head_back`, push the shin off (`def.hand_fight`) · S3 `def.endure` (−1.5), `def.tap` `[S: §2.23]`.
- **Escapes:** posture → back in guard 100 % `[S: §2.23]`. **Abandon:** guard retained.
- **Chains:** `edge.sub.gogoplata_family` (↔ omoplata ↔ triangle).
- **Modifiers:** `M_FLX_ATT` (gate + 0.12/10), `M_LEN_LEG`, `M_SLIP_LOW`, `M_STR_FIN` (weight 0.5).
- **Share:** 0 official UFC `[S: SUB_FINISH §6]`; target ≈ 0.02 % (flavour; PRIDE/regional precedents) `[E]`.

#### `sub.buggy_choke` — Buggy choke (arm-triangle from bottom side control) · choke · blood
- **Entries:** `pos.ground_side_control`, `pos.ground_kesa_gatame` (bottom; requires the top's head on the attacker's near side and the attacker's leg free; flexibility ≥ 70 `[E]`) `[S: §1.2 "first in Cage Warriors 2024; TUF 34 exhibition"]`.
- **Grips/controls:** bottom fighter threads the near arm around the top's head, grabs own leg/shin, closes the arm-triangle with the leg.
- **Stages:** S1 0.30 / 2,500 · S2 0.35 / 5,000 · S3 0.55 / 4,000 `[E: rare, positionally weak; between gogoplata and side arm-triangle]`. **Conv 0.19.**
- **Finish clock:** tap 4,000–12,000 ms `[E]`; `tLoc` μ 9.0 s `[D]`; `hEsc` 0.03/s `[E]`.
- **Defences:** S1 `def.posture_up` (lift the head), `def.strike_attacker` · S2 `def.answer_phone`, `def.turn_in_bridge` (move to north-south) · S3 `def.endure` (−1.5), `def.tap`.
- **Escapes:** top postures/passes to `pos.ground_north_south` 70 % · attacker sweeps to top 30 % `[E]`. **Abandon:** bottom side control (attacker bottom).
- **Chains:** out `edge.sub.buggy_to_sweep` (0.20 `[E]`).
- **Modifiers:** `M_FLX_ATT` (0.12/10, gate 70), `M_LEN_ARM`, `M_MASS` inverse, `M_SLIP_HIGH`, `M_STR_FIN`.
- **Share:** 0 in UFC `[S: SUB_FINISH §6]`; target ≈ 0.02 % `[E]`.

#### `sub.can_opener` — Can opener (from inside closed guard) · crank
- **Entries:** `pos.ground_closed_guard_bottom` (top; opponent holds closed guard) `[S: §2.22]`.
- **Grips/controls:** hands clasped behind the head, pull the head to the chest (cervical flexion); primarily a guard-opening tool `[S: §2.22]`.
- **Stages:** S1 0.50 / 1,500 · S2 0.50 / 3,000 · S3 0.30 / 5,000 `[S: §2.22 crank values; S3 0.35 → 0.30 E: the guard usually opens first]`. **Conv 0.15.**
- **Finish clock:** tap 2,000–10,000 ms; `state.neck_strain` +0.15 per 5 s; `hEsc` 0.10/s `[S: §2.22]`.
- **Defences:** S1–S2 `def.posture_up` (open the guard, hands on the mat — this *is* the intended outcome), `def.chin_tuck` · S3 `def.endure`, `def.tap`.
- **Escapes:** guard opens → `pos.ground_open_guard_kneeling_top` (attacker top) 90 % · guard retained 10 % `[S: §2.22 "can opener is a pass tool"]`. **Abandon:** guard opened.
- **Chains:** out `edge.pos.can_opener_to_pass`.
- **Modifiers:** `M_STR_FIN`, `M_NECK` (×1.5), `M_SKILL` (T≤1 tap to it; T4+ never `[S: §2.22]`).
- **Share:** ≈ 0.1 % (inside "neck crank" 1.3 %) `[E]`. Illegal in IBJJF, amateur MMA (§5).

### 3.5 Leg locks

#### `sub.heel_hook_inside` — Inside heel hook (saddle / 411 / inside sankaku) · legLock
- **Entries:** `pos.leg_saddle` (either; continuous), `pos.leg_50_50` (either; mutual), via Imanari roll from `pos.standing_long`/`pos.ground_open_supine_legs_up` (§03 edge), `pos.ground_closed_guard_standing_top` (bottom; trigger `evt.step_over_guard`), `pos.ground_hq` (bottom) `[S: §2.11]`.
- **Grips/controls:** knee line trapped between the thighs, heel in the armpit, figure-four under the heel; **control the knee line before the heel** `[S: §2.11; D2; L1; CJ1]`.
- **Stages:** S1 0.45 / 2,000 (1,000–3,000) · S2 0.50 / 5,000 (2,000–8,000) · S3 0.85 / 1,500 (1,000–3,000) `[S: §2.11 table "Inside (411)"]`. **Conv 0.425.**
- **Finish clock:** tap 1,000–3,000 ms `[S: §2.11]`; refusal → injury 0–1,000 ms, **high** (posterolateral corner; the tear can precede pain) `[S: P13]`; `pInjBeforeTap` per §2.6.5 × 1.2; `hEsc` 0.01/s.
- **Defences:** S0 don't step over the guard, keep the knee off the centreline · S1 `def.hide_heel` (turn the knee toward the hooking leg, toes pointed, "boot") · S2 `def.clear_knee_line`, `def.roll_with` (correct direction: roll *away* for the inside heel hook `[S: §2.11 "direction matters"]`), `def.strike_attacker` (**the main MMA defence**) · S3 `def.roll_with` (sprint-roll, 0.3×), `def.tap` `[S: §2.11; EV8]`.
- **Escapes:** clear the leg and stand → attacker on bottom open guard / neutral 50 % · pass over the entanglement → `pos.ground_side_control` (defender top) 20 % · counter heel hook (`def.counter_sub`, 50-50 only) 10 % · attacker abandons for strikes 20 % `[S: §2.11]`. **Abandon:** `pos.leg_saddle` released → attacker bottom open guard.
- **Counters:** heel hook vs heel hook in 50-50 (first to `locked` wins) `[S: rule 21]`; GnP from the top on the entangled attacker; kneebar counter when the attacker extends `[S: §2.11]`.
- **Chains:** out `edge.sub.hh_to_kneebar` (0.20), `edge.sub.hh_to_toe_hold` (0.15), `edge.sub.hh_to_ankle` (0.15), `edge.sub.hh_to_calf_slicer` (0.05, 411 only), `edge.sub.hh_to_sweep_back` (0.15), `edge.sub.hh_counter` (0.10, 50-50); in `edge.pos.step_over_to_entanglement`, `edge.pos.imanari`, `edge.sub.kneebar_to_hh`, `edge.sub.ankle_to_hh`, `edge.sub.slx_sweep_fail_to_hh`.
- **Modifiers:** `M_SKILL` (very large: weight ×1.5 — "the largest skill-gap effect of any submission" `[S: §2.11]`), `M_FLX_DEF` (large), `M_STR_FIN` (moderate), `M_SLIP_HIGH` (sweaty heels), `M_GLOVES` (−0.1 heel grip `[E]`), `M_FAT_ATT` (cheap to hold: weight 0.5).
- **Share:** heel hooks (both) **1.4 %** `[S: SUB_FINISH §1a 24/1,695]`; inside ≈ 0.8 % `[E split]`. ADCC context: leg locks 22–30 % of finishes `[S: BH1/BH2]` — the ruleset attempt weights (§6.1) carry this difference, not the base probabilities.

#### `sub.heel_hook_outside` — Outside heel hook (ashi garami / outside ashi / 50-50) · legLock
- **Entries:** `pos.leg_ashi_slx`, `pos.leg_outside_ashi`, `pos.leg_50_50`, `pos.leg_cross_ashi` (either), `pos.ground_x_guard`, `pos.ground_seated_shin_to_shin` (bottom) `[S: §2.11]`.
- **Grips/controls:** outside leg hooks the opponent's leg to block the knee turn; heel captured; rotate the heel away from the body `[S: §2.11]`.
- **Stages:** S1 0.40 / 2,000 · S2 0.40 / 5,000 (2,000–8,000) · S3 0.70 / 1,500 `[S: §2.11 table "Outside"]`. **Conv 0.28.**
- **Finish clock:** tap 1,000–3,000 ms; refusal → injury 0–1,000 ms, **high** (ACL/PCL/MCL/medial meniscus) `[S: P13; P16]`; `pInjBeforeTap` per §2.6.5; `hEsc` 0.01/s.
- **Defences:** as inside but `def.roll_with` direction = roll *into* it `[S: §2.11]`; `def.clear_knee_line` `Δa` −0.4 (the outside hook is weaker on the knee line) `[E]`.
- **Escapes / Abandon / Counters / Chains / Modifiers:** as inside (`edge.sub.hh_to_calf_slicer` unavailable).
- **Share:** ≈ 0.6 % `[E split]`. Legal in IBJJF only at brown/black no-gi (§5).

#### `sub.kneebar` — Kneebar · legLock
- **Entries:** `pos.leg_saddle`, `pos.leg_50_50`, `pos.leg_cross_ashi` (either; leg extended across the hips), `pos.ground_half_flat` (top; rolling kneebar — positional risk 0.50 `[S: rule 18]`), `pos.ground_back_hooks` (top; Suloev-adjacent), `pos.ground_closed_guard_bottom` (top; when the bottom crosses the ankles), via `edge.sub.hh_to_kneebar` `[S: §2.12]`.
- **Grips/controls:** knees pinched, heel under the armpit, hips in line with the knee `[S: §2.12]`.
- **Stages:** S1 0.40 / 2,000 · S2 0.45 / 4,000 (2,000–6,000) · S3 0.80 / 1,500 `[S: §2.12]`. **Conv 0.36.**
- **Finish clock:** tap 1,000–3,000 ms; refusal → injury 1,000–2,000 ms, **high** (posterior capsule / cruciates) `[S: §2.12; P13]`; `hEsc` 0.02/s.
- **Defences:** S1 bend the knee, heel to the buttock (`def.hide_heel`) · S2 turn the kneecap away (`def.roll_with`), figure-four own legs (`def.clear_knee_line`), `def.strike_attacker` · S3 roll toward the attacker's head (`def.roll_with` 0.3×), `def.tap` `[S: §2.12]`.
- **Escapes:** leg freed → defender top, attacker on bottom 55 % · `pos.ground_scramble` 35 % · reversal to the attacker's back 10 % `[S: §2.12]`. **Abandon:** for the rolling kneebar from top half guard → attacker on **bottom** (50 %) `[S: rule 18]`; otherwise entanglement retained.
- **Counters:** counter kneebar / heel hook in 50-50; GnP `[S: §2.12]`.
- **Chains:** out `edge.sub.kneebar_to_hh` (0.20), `edge.sub.kneebar_to_toe_hold`, `edge.sub.kneebar_to_ankle`; in `edge.sub.hh_to_kneebar`, `edge.sub.tri_diamond_counter`.
- **Modifiers:** `M_STR_FIN` (moderate), `M_FLX_DEF` (large: hamstring), `M_SKILL`; no `M_SLIP`.
- **Share:** **1.2 %** `[S: SUB_FINISH §1a 20/1,695]`.

#### `sub.ankle_lock_straight` — Straight ankle lock / Achilles lock · legLock
- **Entries:** `pos.leg_ashi_slx` (primary), `pos.leg_50_50`, `pos.leg_outside_ashi` (either), `pos.ground_open_supine_legs_up`, `pos.ground_seated_shin_to_shin` (bottom vs a standing opponent), leg-drag pass (top, §03) `[S: §2.13]`.
- **Grips/controls:** foot under the armpit, forearm blade under the Achilles, gable/figure-four, knee controlled by the attacker's leg `[S: §2.13]`.
- **Stages:** S1 0.50 / 1,500 · S2 0.45 / 3,000 (2,000–5,000) · S3 0.45 / 4,000 (2,000–8,000) `[S: §2.13]`. **Conv 0.20.**
- **Finish clock:** tap 3,000–8,000 ms `[S: §2.13]`; pain-driven: refusal → injury 4,000–10,000 ms, medium (ankle ligaments / Achilles strain) `[S: §2.13; P15]`; `hEsc` 0.08/s ("grind through").
- **Defences:** S1 `def.hide_heel` (dorsiflex, toes toward the attacker) · S2 stand up out of it (`def.clear_knee_line`), push the knee down, `def.strike_attacker` · S3 `def.endure`, pull the foot (`def.clear_knee_line` 0.3×), `def.tap` `[S: §2.13]`.
- **Escapes:** stand and strike → defender top 60 % · pull out → neutral 40 % `[S: §2.13]`. **Abandon:** entanglement released, attacker bottom open guard.
- **Counters:** counter ankle lock in 50-50; GnP.
- **Chains:** out `edge.sub.ankle_to_hh` (0.20), `edge.sub.ankle_to_toe_hold`, `edge.sub.ankle_to_slx_sweep` (0.30); in `edge.sub.hh_to_ankle`, `edge.sub.kneebar_to_ankle`.
- **Modifiers:** `M_STR_FIN`, pain tolerance ⇒ defender `heart`: `−0.3 × (heart − 50)/50` on S3 `[E]`, `M_FLX_DEF`, `M_FAT_ATT_GRIP`, `M_SLIP_HIGH` (weight 0.5).
- **Share:** ≈ 0.6 % `[S: §1.2 "ESTIMATE 8–14"]`; "one of the rarest MMA finishes — well defended, low injury threat" `[S: BJ1]`. IBJJF Worlds 2024 finals: 3 straight ankle locks `[S: FIGHT_DATA §2.6]` → grappling-ruleset weight higher (§6.1).

#### `sub.toe_hold` — Toe hold · legLock
- **Entries:** `pos.leg_saddle`, `pos.leg_50_50`, `pos.leg_ashi_slx` (either), `pos.ground_half_flat` (top), `pos.ground_turtle` (top; rolling toe hold), via `edge.sub.ankle_to_toe_hold`, `edge.sub.hh_to_toe_hold` `[S: §2.14]`.
- **Grips/controls:** figure-four on the foot (hand on the toes, other hand under the shin on own wrist); knee controlled; rotate the foot toward the buttock `[S: §2.14]`.
- **Stages:** S1 0.45 / 1,500 · S2 0.45 / 3,000 · S3 0.70 / 1,500 `[S: §2.14]`. **Conv 0.315.**
- **Finish clock:** tap 1,000–3,000 ms; refusal → injury 1,000–2,000 ms, medium (ankle ligaments, sometimes knee) `[S: §2.14; P15 "toe hold + ankle lock = 61 % of ligamentous ankle injuries"]`; `hEsc` 0.02/s.
- **Defences:** S1 dorsiflex, straighten the leg (`def.hide_heel`) · S2 turn with it, knee to chest (`def.roll_with`, `def.clear_knee_line`) · S3 `def.roll_with` (0.3×), `def.tap` `[S: §2.14]`.
- **Escapes / Abandon:** as `sub.ankle_lock_straight`.
- **Chains:** ↔ heel hook, ankle lock, kneebar (`edge.sub.toe_hold_family`).
- **Modifiers:** `M_GLOVES` (−0.1 grip), `M_STR_FIN`, `M_FLX_DEF`, `M_SLIP_HIGH`.
- **Share:** 0.06 % `[S: SUB_FINISH §1a 1/1,695]` — "mechanically sound but almost never attempted in MMA" `[S: §2.14]`.

#### `sub.calf_slicer` — Calf slicer (calf crush) · compression
- **Entries:** `pos.ground_truck` (top), `pos.ground_back_hooks`/`pos.ground_turtle` (top; leg bent), `pos.ground_half_flat` (top; bottom's knee bent), `pos.leg_saddle` (via `edge.sub.hh_to_calf_slicer`) `[S: §2.24]`.
- **Grips/controls:** shin/forearm behind the knee, legs figure-four the leg, pull the ankle toward the buttock `[S: §2.24]`.
- **Stages:** S1 0.35 / 2,000 · S2 0.45 / 3,000 · S3 0.65 / 2,000 `[S: §2.24]`. **Conv 0.29.**
- **Finish clock:** tap 2,000–6,000 ms (very painful) `[S: §2.24]`; refusal → injury 3,000–6,000 ms, medium (calf / knee capsule); `hEsc` 0.03/s.
- **Defences:** S1 straighten the leg early (`def.hide_heel`) · S2 turn toward the attacker (`def.roll_with`) · S3 `def.endure` (pain), `def.tap` `[S: §2.24]`.
- **Escapes:** leg freed → attacker retains back/truck 70 % · scramble 30 % `[S: §2.24]`. **Abandon:** `pos.ground_truck` / back retained.
- **Chains:** `edge.sub.truck_family` (truck ↔ twister ↔ calf slicer); in `edge.sub.hh_to_calf_slicer`.
- **Modifiers:** `M_STR_FIN` (large), `M_CTRL`, `M_SLIP_LOW`; pain tolerance term as ankle lock.
- **Share:** 0.18 % `[S: SUB_FINISH §1a 3/1,695 (4 with Walker Jul 2026)]`. Illegal below IBJJF brown (§5).

### 3.6 Spine, crank and truck attacks

#### `sub.twister` — Twister (guillotine of the spine) · crank (spinal)
- **Entries:** `pos.ground_truck`, `pos.ground_back_one_hook` (top; near leg triangled, far arm controlled, head pulled to the opposite shoulder) `[S: §2.21]`.
- **Grips/controls:** lockdown on the near leg, hand behind the head or full nelson, chest on the shoulder `[S: §2.21]`.
- **Stages:** S1 0.30 / 2,500 · S2 0.40 / 4,000 · S3 0.75 / 2,000 `[S: §2.21]`. **Conv 0.30.**
- **Finish clock:** tap 1,000–5,000 ms `[S: §2.21]`; refusal → injury 2,000–4,000 ms, **high** (cervical/thoracic) `[S: §2.21]`; `hEsc` 0.02/s.
- **Defences:** S1 tuck the free knee (`def.hide_heel` analogue), `def.clear_hooks_turn_in` · S2 `def.turn_head_toward`, clear the arm (`def.hand_fight`) · S3 `def.roll_with`, `def.tap` `[S: §2.21]`.
- **Escapes:** clear the leg → attacker retains back 60 % · scramble to top 40 % `[S: §2.21]`. **Abandon:** `pos.ground_back_one_hook`.
- **Chains:** `edge.sub.truck_family` (↔ truck → calf slicer / banana split), `edge.sub.twister_to_rnc` (both hooks come in 0.25 `[S: §2.21]`).
- **Modifiers:** `M_CTRL`, `M_STR_FIN`, `M_NECK` (×1.5), `M_FLX_DEF` (spine, ×1.5 `[E]`).
- **Share:** 0.24 % `[S: SUB_FINISH §1a 4/1,695]`. Illegal in IBJJF, judo, amateur MMA; legal ADCC/pro MMA (§5).

#### `sub.neck_crank_generic` — Neck cranks from other positions (face crank from mount, cattle-catch, crucifix crank, chin-twist) · crank
- **Entries:** `pos.ground_mount_high` (top), `pos.ground_back_crucifix` / `pos.ground_crucifix_side` (top), `pos.ground_kesa_gatame` (top), any choke that "went wrong" (arm on the jaw) via `edge.sub.choke_to_crank` `[S: §2.22]`.
- **Stages / Finish clock / Defences / Modifiers:** as `sub.neck_crank_rear` (S1 0.50 · S2 0.50 · S3 0.35) `[S: §2.22]`. **Conv 0.175.**
- **Escapes:** position retained by the attacker 80 % · scramble 20 % `[E]`. **Abandon:** position retained.
- **Chains:** `edge.sub.crank_to_rnc` (crucifix), `edge.sub.crucifix_to_crank`.
- **Share:** ≈ 0.6 % (the balance of neck crank 1.3 %) `[E]`.

#### `sub.banana_split` — Banana split / electric chair (groin/hip stretch) · jointLock (hip)
- **Entries:** `pos.ground_truck` (top), `pos.ground_half_lockdown` (bottom; electric chair) `[S: §2.30]`.
- **Grips/controls:** one leg triangled/locked down, other leg pulled away by the arms.
- **Stages:** S1 0.25 / 2,500 · S2 0.40 / 4,000 · S3 0.55 / 3,000 `[S: §2.30]`. **Conv 0.22.**
- **Finish clock:** tap 2,000–6,000 ms `[E]`; refusal → injury 3,000–6,000 ms, medium (adductor/hip) `[E]`; `hEsc` 0.05/s `[E]`.
- **Defences:** S1 `def.hide_heel` (keep the legs together), S2 `def.roll_with`, S3 `def.endure`, `def.tap`.
- **Escapes:** truck/lockdown retained 60 % · scramble 40 % `[E]`; the electric chair is usually a **sweep** (`edge.sub.electric_chair_to_sweep` 0.50 `[S: BJJ_POS §2.4 "electric chair (sub/sweep)"]`).
- **Chains:** `edge.sub.truck_family`.
- **Modifiers:** `M_FLX_DEF` (×2), `M_STR_FIN`, `M_CTRL`.
- **Share:** ≈ 0.05 % `[S: §2.30 "0–2 UFC"]`. Illegal in IBJJF below brown (leg-spreading) and in judo (§5).

### 3.7 Standing and flying attacks

#### `sub.triangle_flying` — Flying triangle · choke · blood
- **Entries:** `pos.standing_long` (close range), `pos.clinch_collar_tie` (attacker; requires wrist/collar control and a stationary opponent) `[S: §2.27]`.
- **Grips/controls:** jump, leg over the shoulder; land in the lock or in guard.
- **Stages:** S1 0.30 / 1,000 · S2 0.35 / 3,000 · S3 0.55 / 4,000 `[S: §2.27]`. **Conv 0.19.** Requires `sk.chokes ≥ 70` and explosiveness ≥ 60 to be selected `[E]`.
- **Finish clock:** as `sub.triangle_guard`.
- **Defences:** S0 step back · S1 `def.slam` (the norm — the attacker is in the air), drop to the knees (`def.stack`) · S2 `def.stack`, `def.slam`, `def.posture_up` · S3 `def.slam`, `def.endure` (−1.5), `def.tap` `[S: §2.27]`.
- **Escapes:** attacker lands in guard (`pos.ground_closed_guard_bottom`, attacker bottom) 60 % · slammed → bottom + damage 25 % · lock finishes 15 % `[S: §2.27]` (the 15 % is the conversion path, not an escape). **Abandon:** `pos.ground_closed_guard_bottom` (attacker bottom).
- **Chains:** out `edge.sub.flying_landed_guard` (→ `sub.triangle_guard` at S2 with the same clock), `edge.sub.flying_slammed`.
- **Modifiers:** `M_FLX_ATT`, `M_LEN_LEG`, `M_STR_DEF` (slam), `M_ROCKED` (opponent hurt and static), slam risk 0.40 on failure `[S: §2.27]`.
- **Share:** 0.18 % `[S: SUB_FINISH §1a 3/1,695]`.

#### `sub.armbar_flying` — Flying armbar · jointLock
- **Entries:** as `sub.triangle_flying` (arm extended: collar tie or wrist grip) `[S: §2.27]`.
- **Stages:** S1 0.30 / 1,000 · S2 0.35 / 2,500 · S3 0.55 / 1,500 `[S: §2.27]`. **Conv 0.19.**
- **Finish clock:** as `sub.armbar_guard`.
- **Defences / Escapes / Abandon / Chains / Modifiers:** as `sub.triangle_flying` (`edge.sub.flying_landed_guard` → `sub.armbar_guard` at S2).
- **Share:** ≈ 0.4 % (logged as "armbar": DJ–Borg suplex-to-armbar; Sato 6 s, Namajunas 12 s outside UFC) `[S: §2.27; BJ6]` `[E split]`.

### 3.8 Summary table (all 54 entries)

| id | family | S1 | S2 | S3 | Conv (S2×S3) | tap range / LOC μ or injury | share target |
|---|---|---|---|---|---|---|---|
| `sub.rnc` | choke | 0.45 | 0.50 | 0.85 | 0.43 | 2–6 s / 8.9 s | 38.9 % (incl. short) |
| `sub.rnc_short` | choke | 0.45 | 0.55 | 0.75 | 0.41 | 2–8 s / 9.0 s | (in RNC) |
| `sub.armbar_back` | jointLock | 0.45 | 0.45 | 0.80 | 0.36 | 0–3 s / high 1–3 s | 1.5 % |
| `sub.triangle_rear` | choke | 0.45 | 0.50 | 0.60 | 0.30 | 5–15 s / 9.5 s | 0.3 % |
| `sub.neck_crank_rear` | crank | 0.50 | 0.50 | 0.35 | 0.175 | 2–10 s / strain | 0.6 % |
| `sub.suloev_stretch` | jointLock | 0.25 | 0.40 | 0.60 | 0.24 | 2–6 s / medium | 0.18 % |
| `sub.crucifix_armlock` | jointLock | 0.35 | 0.45 | 0.55 | 0.25 | 2–6 s / high | 0.2 % |
| `sub.crucifix_choke` | choke | 0.40 | 0.45 | 0.65 | 0.29 | 3–8 s / 9.0 s | 0.1 % |
| `sub.guillotine_standard` | choke (mixed) | 0.55 | 0.40 | 0.35 | 0.14 | 4–12 s / 8.9 s | 9.5 % |
| `sub.guillotine_arm_in` | choke (mixed) | 0.55 | 0.35 | 0.30 | 0.105 | 6–20 s / 10.2 s | 4.5 % |
| `sub.guillotine_high_elbow` | choke | 0.45 | 0.55 | 0.65 | 0.36 | 3–8 s / 9.0 s | 1.5 % |
| `sub.guillotine_ten_finger` | choke (mixed) | 0.60 | 0.40 | 0.45 | 0.18 | 5–15 s / 9.0 s | 0.6 % |
| `sub.guillotine_standing` | choke (mixed) | 0.50 | 0.35 | 0.45 | 0.16 | 3–8 s / 9.0 s | 0.5 % |
| `sub.guillotine_mounted` | choke | 0.50 | 0.55 | 0.70 | 0.385 | 4–10 s / 9.0 s | 1.0 % |
| `sub.darce` | choke | 0.45 | 0.50 | 0.70 | 0.35 | 3–10 s / 9.0 s | 2.8 % |
| `sub.anaconda` | choke | 0.40 | 0.50 | 0.70 | 0.35 | 3–10 s / 9.0 s | 2.4 % |
| `sub.peruvian_necktie` | choke (mixed) | 0.40 | 0.45 | 0.60 | 0.27 | 4–10 s / 9.0 s | 0.12 % |
| `sub.japanese_necktie` | choke (mixed) | 0.40 | 0.40 | 0.60 | 0.24 | 4–10 s / 9.0 s | 0.06 % |
| `sub.bulldog` | choke (mixed) | 0.35 | 0.40 | 0.45 | 0.18 | 6–15 s / 9.0 s | 0.4 % |
| `sub.arm_triangle_mount` | choke | 0.50 | 0.55 | 0.75 | 0.41 | 5–15 s / 7.2 s | 5.5 % |
| `sub.arm_triangle_side` | choke | 0.45 | 0.50 | 0.70 | 0.35 | 5–15 s / 7.2 s | 2.0 % |
| `sub.arm_triangle_standing` | choke | 0.30 | 0.30 | 0.50 | 0.15 | 5–15 s / 7.2 s | 0.2 % |
| `sub.armbar_mount` | jointLock | 0.55 | 0.40 | 0.85 | 0.34 | 0–3 s / high | 5.0 % |
| `sub.armbar_belly_down` | jointLock | 0.50 | 0.40 | 0.85 | 0.34 | 0–3 s / high | 0.5 % |
| `sub.americana` | jointLock | 0.45 | 0.40 | 0.75 | 0.30 | 2–6 s / medium | 0.7 % |
| `sub.kimura_side` | jointLock | 0.55 | 0.55 | 0.80 | 0.44 | 1–4 s / high | 1.3 % |
| `sub.kimura_north_south` | jointLock | 0.55 | 0.55 | 0.80 | 0.44 | 1–4 s / high | 0.3 % |
| `sub.north_south_choke` | choke | 0.45 | 0.45 | 0.55 | 0.25 | 8–20 s / 9.4 s | 0.3 % |
| `sub.ezekiel_top` | choke (mixed) | 0.40 | 0.40 | 0.45 | 0.18 | 5–15 s / 9.0 s | 0.2 % |
| `sub.ezekiel_bottom` | choke (mixed) | 0.30 | 0.35 | 0.40 | 0.14 | 5–15 s / 9.0 s | 0.1 % |
| `sub.von_flue` | choke | — | 0.60 | 0.65 | 0.39 | 4–10 s / 9.0 s | 0.5 % |
| `sub.triangle_mounted` | choke | 0.55 | 0.55 | 0.70 | 0.385 | 5–15 s / 9.5 s | 1.0 % |
| `sub.triangle_guard` | choke | 0.50 | 0.45 | 0.55 | 0.25 | 5–15 s / 9.5 s | 4.0 % |
| `sub.triangle_side` | choke | 0.40 | 0.45 | 0.60 | 0.27 | 5–15 s / 9.5 s | 0.1 % |
| `sub.triangle_inverted` | choke | 0.30 | 0.40 | 0.60 | 0.24 | 5–15 s / 9.5 s | 0.24 % |
| `sub.armbar_guard` | jointLock | 0.45 | 0.35 | 0.85 | 0.30 | 0–3 s / high | 4.5 % |
| `sub.kimura_guard` | jointLock | 0.50 | 0.35 | 0.65 | 0.23 | 1–4 s / high | 0.7 % |
| `sub.kimura_half` | jointLock | 0.45 | 0.35 | 0.60 | 0.21 | 1–4 s / high | 0.5 % |
| `sub.kimura_grip` | jointLock | 0.35 | 0.30 | 0.50 | 0.15 | 1–4 s / high | 0.2 % |
| `sub.omoplata` | jointLock | 0.45 | 0.35 | 0.30 | 0.105 | 3–8 s / medium | 0.12 % |
| `sub.gogoplata` | choke | 0.25 | 0.35 | 0.50 | 0.175 | 4–10 s / 9.0 s | 0.02 % |
| `sub.buggy_choke` | choke | 0.30 | 0.35 | 0.55 | 0.19 | 4–12 s / 9.0 s | 0.02 % |
| `sub.can_opener` | crank | 0.50 | 0.50 | 0.30 | 0.15 | 2–10 s / strain | 0.1 % |
| `sub.heel_hook_inside` | legLock | 0.45 | 0.50 | 0.85 | 0.425 | 1–3 s / high 0–1 s | 0.8 % |
| `sub.heel_hook_outside` | legLock | 0.40 | 0.40 | 0.70 | 0.28 | 1–3 s / high 0–1 s | 0.6 % |
| `sub.kneebar` | legLock | 0.40 | 0.45 | 0.80 | 0.36 | 1–3 s / high | 1.2 % |
| `sub.ankle_lock_straight` | legLock | 0.50 | 0.45 | 0.45 | 0.20 | 3–8 s / medium | 0.6 % |
| `sub.toe_hold` | legLock | 0.45 | 0.45 | 0.70 | 0.315 | 1–3 s / medium | 0.06 % |
| `sub.calf_slicer` | compression | 0.35 | 0.45 | 0.65 | 0.29 | 2–6 s / medium | 0.18 % |
| `sub.twister` | crank | 0.30 | 0.40 | 0.75 | 0.30 | 1–5 s / high | 0.24 % |
| `sub.neck_crank_generic` | crank | 0.50 | 0.50 | 0.35 | 0.175 | 2–10 s / strain | 0.6 % |
| `sub.banana_split` | jointLock | 0.25 | 0.40 | 0.55 | 0.22 | 2–6 s / medium | 0.05 % |
| `sub.triangle_flying` | choke | 0.30 | 0.35 | 0.55 | 0.19 | 5–15 s / 9.5 s | 0.18 % |
| `sub.armbar_flying` | jointLock | 0.30 | 0.35 | 0.55 | 0.19 | 0–3 s / high | 0.4 % |

Share targets sum to ≈ 100 % of MMA submission finishes `[D: FightAlpha itemised counts SUB_FINISH §1a with [E] intra-family splits; residual 0.9 % "other/gi/Schultz" not modelled]`.

---

## 4. Chain graph

**Semantics.** An edge fires when the source stage **fails** (defender `p_e` success that is routed to "regress/hold" rather than a full escape, or a stall/abandon roll) *for the listed trigger*, or, for `POS` sources, when the positional event occurs. `P` is the share of the source's failures that route to the target at T4 (`[S: SUBMISSIONS §3]` unless noted); the remainder follows the catalogue's escape/abandon routing. A chain target starts at **S1** with `M_CHAIN` (+0.18) `[S: rule 22]`; chains marked `@S2` enter at S2 (the grip is already there). **Cap: 3 hops per 15,000 ms window**, then return to position `[S: rule 22]`. Chain probability scales with tier: multiply `P` by 0.0 (T0–T1), 0.5 (T2), 0.8 (T3), 1.0 (T4), 1.2 (T5, cap 1.0 total) `[E, consistent with BJJ_POS §3.3 "Chaining: elite only (advanced 0.15)"]`. Edges whose target is a **position** hand the new node to §03. `DEF` marks an edge that gives the *defender* a new attack.

| Edge id | From | To | Trigger | P | Tag |
|---|---|---|---|---|---|
| `edge.pos.back_to_rnc` | `pos.ground_back_hooks` (POS) | `sub.rnc` | always available; back-take → immediate attempt p 0.45 | 0.45 per back take | `[S: BJJ_POS §1 Lamas 2024]` |
| `edge.sub.rnc_to_armbar_back` | `sub.rnc` S1/S2 | `sub.armbar_back` | hands defended, defender's arm high | 0.20 | `[S: §3]` |
| `edge.sub.rnc_to_rear_tri` | `sub.rnc` S2 | `sub.triangle_rear` | arm trapped inside the seatbelt | 0.10 | `[S: §3]` |
| `edge.sub.rnc_to_neck_crank` | `sub.rnc` S2/S3 | `sub.neck_crank_rear` | arm on the jaw | 0.15 | `[S: §3]` |
| `edge.sub.rnc_to_body_tri_gnp` | `sub.rnc` any | `pos.ground_back_body_triangle` + GnP (§03/§05 TKO path) | hands defended, attacker chooses damage | 0.25 | `[S: §3]` |
| `edge.sub.rnc_to_mount` | `sub.rnc` any | `pos.ground_mount_low` (attacker top) | defender turns in and stops | 0.15 | `[S: §3]` |
| `edge.sub.rnc_to_short` | `sub.rnc` S2 | `sub.rnc_short` @S2 | figure-four denied | 0.30 | `[E]` |
| `edge.sub.armbar_back_to_rnc` | `sub.armbar_back` S1/S2 | `sub.rnc` @S1 | defender turns back in | 0.50 | `[S: §3]` |
| `edge.sub.rear_tri_to_armbar` | `sub.triangle_rear` S2/S3 | `sub.armbar_back` | trapped arm extended | 0.30 | `[E]` |
| `edge.sub.crank_to_rnc` | `sub.neck_crank_rear` / `sub.neck_crank_generic` any | `sub.rnc` / `sub.crucifix_choke` | hand-fighting loop, chin exposed | 0.40 | `[S: §3 "RNC → neck crank → RNC loop"; P E]` |
| `edge.sub.twister_to_rnc` | `sub.twister` S1/S2 | `sub.rnc` | both hooks come in | 0.25 | `[S: §2.21]` |
| `edge.sub.truck_family` | `pos.ground_truck` / `sub.twister` / `sub.calf_slicer` / `sub.banana_split` | each other (truck ↔ twister ↔ calf slicer ↔ banana split) | leg already in the truck | 0.20 each way | `[S: §3 "BACK_CONTROL (one hook) ↔ Twister ↔ Truck → Calf Slicer / Banana Split"; P E]` |
| `edge.pos.turtle_to_rnc` | `pos.ground_turtle` (POS) | `sub.rnc` | back take completed (§03 T9) | per §03 | `[S: BJJ_POS §8 rule 13]` |
| `edge.pos.turtle_to_crucifix` | `pos.ground_turtle` (POS) | `sub.crucifix_armlock` / `sub.crucifix_choke` | arm trapped between the legs | 0.15 per turtle window | `[E]` |
| `edge.sub.crucifix_to_choke` / `edge.sub.crucifix_to_crank` / `edge.pos.crucifix_to_gnp` | `sub.crucifix_armlock` fail | `sub.crucifix_choke` / `sub.neck_crank_generic` / GnP (TKO path) | arm still trapped | 0.25 / 0.15 / 0.40 | `[S: §2.25 "TKO from crucifix far more common"; P E]` |
| `edge.pos.sprawl_to_fhl` | `pos.standing_sprawl` (POS) | `pos.ground_front_headlock` → guillotine / D'Arce / anaconda / neckties | sprawl on a shot | 0.6 per desperate shot | `[S: §3 "sprawl on a desperate shot → FRONT_HEADLOCK p ≈ 0.6"]` |
| `edge.pos.snapdown_to_standing_guillotine` | `pos.clinch_collar_tie` (POS) | `sub.guillotine_standing` | `evt.head_down_standing`; hurt opponent with the head down | 0.2 per event | `[S: §3 "standing hurt with head down → Standing Guillotine p ≈ 0.2"]` |
| `edge.sub.guillotine_to_darce` | any guillotine S1/S2 | `sub.darce` | opponent's arm on the same side (arm-in ×2 weight) | 0.20 | `[S: §3]` |
| `edge.sub.guillotine_to_anaconda` | any guillotine S1 | `sub.anaconda` | head slides out under the arm | 0.10 | `[S: §3]` |
| `edge.sub.guillotine_to_mounted` | guard guillotine S2/S3 | `sub.guillotine_mounted` @S2 | sweep to top keeping the grip | 0.10 | `[S: §3]` |
| `edge.sub.guillotine_to_back` | any guillotine S1/S2 | `pos.ground_back_hooks` (attacker top) → `sub.rnc` | opponent turns / go-behind | 0.15 | `[S: §3]` |
| `edge.sub.guillotine_to_tri` | guard guillotine S2 | `sub.triangle_guard` | head pops out with the arm in | 0.10 | `[S: §3]` |
| `edge.sub.guillotine_to_armbar` | guard guillotine S2 | `sub.armbar_guard` | defender posts | 0.05 | `[S: §2.2 chains; P E]` |
| `edge.sub.guillotine_to_von_flue` (DEF) | guard/half guillotine S2/S3 | `sub.von_flue` @S2 for the **defender** | defender passes to the choking side and the attacker keeps the grip | 0.15 | `[S: §3]` |
| `edge.sub.standing_guillotine_to_guard` | `sub.guillotine_standing` S2 | `sub.guillotine_standard` @S2 (jump guard; `pos.ground_closed_guard_broken`) | opponent lifts / attacker chooses | 0.50 | `[S: §3]` |
| `edge.sub.standing_guillotine_dumped` | `sub.guillotine_standing` S1/S2 | `evt.slam` (waist) + `pos.ground_half_flat` (attacker bottom) | `def.lift_and_dump` | 0.25 | `[S: §3]` |
| `edge.sub.darce_to_anaconda` / `edge.sub.anaconda_to_darce` | `sub.darce` / `sub.anaconda` S1/S2 | each other | head/arm position flips | 0.30 each way | `[S: §3]` |
| `edge.sub.darce_to_arm_tri` | `sub.darce` S2/S3 | `sub.arm_triangle_side` @S2 | attacker ends on top with the arm trapped | 0.20 | `[S: §3]` |
| `edge.sub.anaconda_to_arm_tri` | `sub.anaconda` S2/S3 | `sub.arm_triangle_side` @S2 | after the roll | 0.20 | `[S: §3]` |
| `edge.sub.darce_to_back` | `sub.darce` / `sub.anaconda` S1/S2 | `pos.ground_back_hooks` → `sub.rnc` | opponent turns away | 0.20 | `[S: §3]` |
| `edge.sub.darce_to_necktie` | `sub.darce` S1/S2 | `sub.peruvian_necktie` / `sub.japanese_necktie` | opponent stays turtled | 0.10 | `[S: §3]` |
| `edge.sub.darce_to_guillotine` | `sub.darce` / `sub.anaconda` S1 | `sub.guillotine_standard` | arm slips out | 0.10 | `[S: §2.3 chains; P E]` |
| `edge.sub.necktie_family` | `sub.peruvian_necktie` / `sub.japanese_necktie` S1/S2 | D'Arce / anaconda / guillotine / each other | front headlock retained | 0.15 each | `[S: §2.18; P E]` |
| `edge.sub.kimura_side_to_darce` | `sub.kimura_side` S1 | `sub.darce` | bottom turns in to escape | 0.10 | `[E]` |
| `edge.pos.mount_gnp_to_arm_tri` | `pos.ground_mount_gnp` (POS) | `sub.arm_triangle_mount` / `sub.americana` | framing under GnP → `evt.arm_crossed_centre` | 0.3 per frame event | `[S: §3 "framing under mount GnP → arm across p ≈ 0.3"]` |
| `edge.pos.mount_gnp_to_ezekiel` | `pos.ground_mount_gnp` (POS) | `sub.ezekiel_top` | head wrapped during GnP | 0.05 per frame event | `[E]` |
| `edge.sub.arm_tri_to_americana_kimura` | `sub.arm_triangle_mount` S2 | `sub.americana` / `sub.kimura_side` | arm across, dismount fails | 0.20 | `[S: §3]` |
| `edge.sub.arm_tri_to_mounted_tri` | `sub.arm_triangle_mount` S2 | `sub.triangle_mounted` | arm across, attacker stays mounted | 0.10 | `[S: §3]` |
| `edge.sub.arm_tri_to_back` | `sub.arm_triangle_mount` / `_side` S1/S2 | `pos.ground_back_hooks` → `sub.rnc` | defender turns away | 0.15 | `[S: §3]` |
| `edge.sub.arm_tri_to_mounted_guillotine` | `sub.arm_triangle_mount` S1 | `sub.guillotine_mounted` | chin available as the arm is released | 0.05 | `[S: §2.5 chains; P E]` |
| `edge.sub.mounted_guillotine_to_arm_tri` | `sub.guillotine_mounted` S2 | `sub.arm_triangle_mount` | arm crosses while defending | 0.20 | `[E]` |
| `edge.sub.ezekiel_to_arm_tri` | `sub.ezekiel_top` S2 | `sub.arm_triangle_mount` | arm across | 0.20 | `[S: §2.16 chains; P E]` |
| `edge.sub.ezekiel_bottom_to_guillotine` | `sub.ezekiel_bottom` S1/S2 | `sub.guillotine_standard` (bottom) | top pulls the head out | 0.20 | `[S: §2.16 chains; P E]` |
| `edge.sub.americana_to_kimura` / `edge.sub.kimura_to_americana` | `sub.americana` ↔ `sub.kimura_side` S1/S2 | each other | arm flips | 0.30 | `[S: §3]` |
| `edge.sub.americana_to_armbar` | `sub.americana` S1/S2 | `sub.armbar_mount` / `sub.armbar_belly_down` | defender straightens | 0.25 | `[S: §3; EV3]` |
| `edge.sub.americana_to_arm_tri` | `sub.americana` S1 | `sub.arm_triangle_mount` | arm pushed across | 0.10 | `[S: §2.9 chains; P E]` |
| `edge.sub.armbar_mount_to_mounted_tri` | `sub.armbar_mount` S1/S2 | `sub.triangle_mounted` | arm retracts, leg already over | 0.20 | `[S: §3]` |
| `edge.sub.armbar_mount_to_back` | `sub.armbar_mount` S1/S2 | `pos.ground_back_hooks` (attacker top) | defender turns | 0.10 | `[S: §3]` |
| `edge.sub.armbar_mount_lost` | `sub.armbar_mount` S2/S3 escape | `pos.ground_closed_guard_bottom` (attacker **bottom**) | defender pulls out and comes up | 0.35 of escapes | `[S: §3 "GUARD_TOP_FOR_DEFENDER 0.35"]` |
| `edge.sub.mounted_tri_to_armbar` | `sub.triangle_mounted` S2/S3 | `sub.armbar_mount` | arm isolated across | 0.35 | `[S: §3]` |
| `edge.sub.armbar_side_to_kimura` | `sub.armbar_belly_down` S2 | `sub.kimura_side` | arm bends | 0.15 | `[E]` |
| `edge.sub.kimura_side_to_ns_choke` / `edge.sub.ns_choke_to_kimura` | `sub.kimura_side` / `sub.kimura_north_south` ↔ `sub.north_south_choke` | each other | attacker moves to the head / arm free | 0.20 each way | `[S: §3]` |
| `edge.sub.kimura_side_to_arm_tri` | `sub.kimura_side` S2 | `sub.arm_triangle_side` | arm pushed across | 0.15 | `[S: §3]` |
| `edge.sub.ns_choke_to_arm_tri` | `sub.north_south_choke` S2 | `sub.arm_triangle_side` | arm caught | 0.10 | `[S: §2.15 chains; P E]` |
| `edge.pos.ns_to_mount` | `sub.north_south_choke` abandon | `pos.ground_mount_low` | attacker steps over | 0.20 | `[S: §2.15 chains; P E]` |
| `edge.pos.throw_to_mount_armbar` | judo throw → `pos.ground_mount_high` (POS, §03) | `sub.armbar_mount` | opponent posts on landing | 0.25 per throw-to-mount | `[E; S: §2.7 "Rousey route"]` |
| `edge.sub.tri_to_armbar` | `sub.triangle_guard` S1/S2 | `sub.armbar_guard` | arm pinned across the throat is isolated | 0.30 | `[S: §3]` |
| `edge.sub.tri_to_omoplata` | `sub.triangle_guard` S1/S2 | `sub.omoplata` | arm ends outside the leg | 0.15 | `[S: §3; K6]` |
| `edge.sub.tri_to_mounted_tri` | `sub.triangle_guard` S2 | `sub.triangle_mounted` @S2 (sweep) | opponent's base breaks | 0.10 | `[S: §3]` |
| `edge.sub.tri_to_gogoplata` | `sub.triangle_guard` S2 | `sub.gogoplata` | flexibility ≥ 80 | 0.03 | `[S: §3]` |
| `edge.sub.tri_slam` (DEF) | `sub.triangle_guard` / `sub.armbar_guard` any | `evt.slam` | `def.slam` | per §2.6.6 | `[S: §3 "Triangle (defended by slam) → damage event, attacker keeps guard 0.5 / loses 0.5"]` |
| `edge.sub.tri_diamond_counter` (DEF) | `sub.triangle_guard` S2 (diamond) | `sub.kneebar` / `sub.ankle_lock_straight` for the **defender** | T4+ legLocks ≥ 60 | 0.05 | `[E; S: §2.6 counters]` |
| `edge.sub.armbar_to_tri` | `sub.armbar_guard` / `sub.armbar_mount` / `sub.armbar_belly_down` / `sub.armbar_back` S2 | `sub.triangle_guard` / `sub.triangle_mounted` / `sub.triangle_side` / `sub.triangle_rear` | defender clasps the grip; throw the leg over the head (kills `def.hitchhiker`) | 0.30 | `[S: §3]` |
| `edge.sub.armbar_to_omoplata` | `sub.armbar_guard` S1/S2 | `sub.omoplata` | arm pulled back outside the leg | 0.10 | `[S: §3]` |
| `edge.sub.armbar_guard_to_back` | `sub.armbar_guard` S1/S2 | `pos.ground_back_hooks` (attacker top) → `sub.rnc` | attacker spins under as the defender pulls out | 0.15 | `[S: §3]` |
| `edge.sub.omoplata_to_sweep` | `sub.omoplata` S2/S3 | `pos.ground_side_control` / `pos.ground_mount_low` (attacker top) | defender's forward roll | 0.45 | `[S: §3]` |
| `edge.sub.omoplata_to_tri` | `sub.omoplata` S1/S2 | `sub.triangle_guard` | re-enter | 0.15 | `[S: §3]` |
| `edge.sub.omoplata_to_armbar` / `edge.sub.omoplata_to_kimura` | `sub.omoplata` S2 | `sub.armbar_guard` / `sub.kimura_guard` | straight arm / roll | 0.10 | `[S: §3]` |
| `edge.sub.omoplata_to_back` | `sub.omoplata` S2 | `pos.ground_back_hooks` (attacker top) | opponent rolls and stops on the side | 0.10 | `[S: §3]` |
| `edge.sub.omoplata_to_gogoplata` / `edge.sub.gogoplata_family` | `sub.omoplata` ↔ `sub.gogoplata` ↔ `sub.triangle_guard` (rubber guard) | each other | flexibility ≥ 80 | 0.10 | `[S: §2.23; P E]` |
| `edge.pos.knee_slice_to_omoplata` | knee-slice pass attempt (§03, POS) | `sub.omoplata` for the bottom | top's arm outside the hip | 0.05 per pass attempt | `[E; S: §2.10]` |
| `edge.pos.arm_drag_to_tri` | arm-drag from guard (§03) | `sub.triangle_guard` | failed drag leaves one arm in | 0.15 | `[E; S: §2.6 inbound]` |
| `edge.sub.kimura_to_sweep` | `sub.kimura_guard` / `sub.kimura_half` / `sub.kimura_grip` S1/S2 | `pos.ground_mount_low` / `pos.ground_half_flat` (attacker top) | hip-bump / roll | 0.35 | `[S: §3]` |
| `edge.sub.kimura_to_back` | `sub.kimura_guard` / `sub.kimura_half` / `sub.kimura_grip` S1/S2 | `pos.ground_back_hooks` (attacker top) → `sub.rnc` | kimura trap | 0.20 | `[S: §3; K4b; BJ7]` |
| `edge.sub.kimura_to_armbar` | any kimura S1/S2 | `sub.armbar_guard` / `sub.armbar_belly_down` | defender straightens the arm | 0.10 | `[S: §3]` |
| `edge.sub.kimura_to_guillotine` | `sub.kimura_grip` (standing whizzer) S1 | `sub.guillotine_standing` / `sub.guillotine_standard` | head drops | 0.10 | `[S: §3]` |
| `edge.sub.kimura_to_takedown` | `sub.kimura_grip` (standing) S1 | takedown edge (§03/wrestling, attacker top) | grip secured standing | 0.20 | `[E; S: §2.8 "standing kimura from the clinch → take down"]` |
| `edge.sub.kimura_grip_to_tri` | `sub.kimura_guard` S1 | `sub.triangle_guard` | kimura-trap grip pulls the arm in | 0.10 | `[E; S: §2.6 inbound "Kimura-trap grip"]` |
| `edge.pos.single_leg_to_kimura_trap` / `edge.pos.underhook_to_kimura_trap` | single-leg defence (wrestling) / `pos.ground_half_underhook` (POS) | `sub.kimura_grip` / `sub.kimura_half` | opponent's arm exposed | 0.15 per event | `[E; S: SUB_COACH kimura trap]` |
| `edge.sub.inverted_tri_to_kimura` | `sub.triangle_inverted` S2 | `sub.kimura_side` | arm caught | 0.20 | `[E; S: §1.2 Rockhold]` |
| `edge.sub.buggy_to_sweep` | `sub.buggy_choke` S2 | `pos.ground_mount_low` (attacker top) | top's base breaks | 0.20 | `[E]` |
| `edge.pos.can_opener_to_pass` | `sub.can_opener` any | guard opened → `pos.ground_open_guard_kneeling_top` | guard opens | 0.90 | `[S: §2.22]` |
| `edge.pos.step_over_to_entanglement` | guard pass step-over (§03, POS) | `pos.leg_saddle` / `pos.leg_ashi_slx` for the bottom → heel hooks | `evt.step_over_guard` | trigger (§03 rate) | `[S: §3 "Guard-pass attempt (step-over) → LEG_ENTANGLEMENT"]` |
| `edge.pos.imanari` | `pos.standing_long` / `pos.ground_open_supine_legs_up` | `pos.leg_saddle` → `sub.heel_hook_inside` | Imanari roll (legLocks ≥ 70) | §03 edge p 0.30 `[E]` | `[S: §2.11 entries]` |
| `edge.sub.hh_to_kneebar` / `edge.sub.kneebar_to_hh` | `sub.heel_hook_*` ↔ `sub.kneebar` S2 | each other | rotation fails → extension / extension fails → rotation | 0.20 | `[S: §3]` |
| `edge.sub.hh_to_toe_hold` | `sub.heel_hook_*` S2 | `sub.toe_hold` | heel slips, toes available | 0.15 | `[S: §3]` |
| `edge.sub.hh_to_ankle` | `sub.heel_hook_*` S1/S2 | `sub.ankle_lock_straight` | fallback | 0.15 | `[S: §3]` |
| `edge.sub.hh_to_calf_slicer` | `sub.heel_hook_inside` (411) S2 | `sub.calf_slicer` | leg bent | 0.05 | `[S: §3]` |
| `edge.sub.hh_to_sweep_back` | `sub.heel_hook_*` (saddle/50-50) S1/S2 | sweep to top / `pos.ground_back_hooks` | opponent turns | 0.15 | `[S: §3]` |
| `edge.sub.hh_counter` (DEF) | `sub.heel_hook_*` in `pos.leg_50_50` S1/S2 | `sub.heel_hook_*` for the **defender** | mutual exposure | 0.10 | `[S: §3]` |
| `edge.sub.ankle_to_hh` | `sub.ankle_lock_straight` S1/S2 | `sub.heel_hook_outside` (ruleset) | heel exposed as the opponent turns | 0.20 | `[S: §3]` |
| `edge.sub.ankle_to_slx_sweep` | `sub.ankle_lock_straight` S1/S2 | SLX sweep → attacker top (§03) | opponent stands/defends | 0.30 | `[S: §3]` |
| `edge.sub.ankle_to_toe_hold` / `edge.sub.kneebar_to_toe_hold` / `edge.sub.kneebar_to_ankle` / `edge.sub.toe_hold_family` | leg-lock family | leg-lock family | foot/knee available | 0.10 each | `[S: §2.12–2.14 "↔"; P E]` |
| `edge.sub.slx_sweep_fail_to_hh` | SLX sweep failure (§03) | `sub.heel_hook_outside` | leg still entangled | 0.20 | `[E; S: §2.11 inbound]` |
| `edge.sub.electric_chair_to_sweep` | `sub.banana_split` (lockdown) S1/S2 | sweep → attacker top | opponent posts | 0.50 | `[S: BJJ_POS §2.4]` |
| `edge.sub.standing_arm_tri_to_ground` | `sub.arm_triangle_standing` S1/S2 | `sub.arm_triangle_side` @S2 | attacker drags to the mat | 0.50 | `[E]` |
| `edge.sub.flying_landed_guard` | `sub.triangle_flying` / `sub.armbar_flying` S1/S2 | `sub.triangle_guard` / `sub.armbar_guard` @S2 | attacker lands in guard | 0.60 | `[S: §3]` |
| `edge.sub.flying_slammed` (DEF) | `sub.triangle_flying` / `sub.armbar_flying` S1 | `evt.slam` + attacker bottom | `def.slam` | 0.25 | `[S: §3]` |
| `edge.pos.scramble_to_bulldog` | `pos.ground_scramble` (POS) | `sub.bulldog` | attacker wins the head from the side | 0.10 per scramble (T≤2 defenders: 0.20) | `[E; S: §2.20 "chaotic scrambles"]` |
| `edge.pos.bulldog_to_kesa` | `sub.bulldog` abandon | `pos.ground_kesa_gatame` | attacker keeps the headlock | 0.60 | `[S: §2.20; P E]` |
| `edge.sub.choke_to_crank` | any neck choke S3 fail | `sub.neck_crank_generic` | arm ends on the jaw | 0.10 | `[S: §2.22 "a choke that went wrong"; P E]` |
| `edge.pos.gnp_turn_away_to_back` | GnP event with `evt.turn_away` (§03) | `pos.ground_back_hooks` → `sub.rnc` | rocked/turtled after strikes | 0.5 per turn-away event | `[S: §3 "rocked or turtled after strikes → BACK_CONTROL p ≈ 0.5"]` |

**Loop guard.** The `chainHops` counter and 15 s window prevent infinite `rnc ↔ crank`, `darce ↔ anaconda`, `americana ↔ kimura` and leg-lock family loops `[S: rule 22]`.

---

## 5. Ruleset legality matrix

Columns: **MMA-pro** (Unified Rules) · **MMA-am** (amateur / IMMAF-style) · **IBJJF-W** (adult white) · **IBJJF-BP** (blue/purple) · **IBJJF-BB-gi** (brown/black gi) · **IBJJF-BB-nogi** (brown/black no-gi) · **ADCC** · **Judo** (IJF, ne-waza only) · **Sub-only** (EBI-style no-gi) · **Street**. ✓ legal · ✗ illegal (attempt = foul: pro MMA point deduction / DQ per the rules section; IBJJF/ADCC DQ) · ◐ restricted (note). Sources: MMA `[S: RULES §2.1]`; IBJJF belt matrix `[S: RULES §2.5 — reconstructed, verify before encoding]`; ADCC `[S: RULES §2.6]`; judo `[S: RULES §2.7; JUDO]`; amateur MMA and sub-only `[E: IMMAF/EBI rule sets from general knowledge — verify]`; street `[S: RULES §2.8 "everything is legal"]`.

| Submission | MMA-pro | MMA-am | IBJJF-W | IBJJF-BP | IBJJF-BB-gi | IBJJF-BB-nogi | ADCC | Judo | Sub-only | Street |
|---|---|---|---|---|---|---|---|---|---|---|
| `sub.rnc`, `sub.rnc_short` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (hadaka-jime) | ✓ | ✓ |
| `sub.armbar_*` (guard/mount/back/belly-down) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (juji-gatame) | ✓ | ✓ |
| `sub.armbar_flying`, `sub.triangle_flying` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ (standing entry into a lock = hansoku-make unless from a throw) `[S: RULES §2.7 "standing kansetsu/shime-waza without throw"]` | ✓ | ✓ |
| `sub.triangle_guard/_mounted/_rear/_side/_inverted` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (sankaku-jime) | ✓ | ✓ |
| `sub.guillotine_standard/_arm_in/_high_elbow/_ten_finger/_mounted` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (no chin-twist) | ✓ (mae-hadaka-jime) | ✓ | ✓ |
| `sub.guillotine_standing` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (standing shime-waza) | ✓ | ✓ |
| `sub.darce`, `sub.anaconda`, `sub.arm_triangle_*`, `sub.north_south_choke`, `sub.von_flue`, `sub.crucifix_choke`, `sub.buggy_choke` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (crucifix position ◐: crucifix listed illegal `[S: RULES §2.6]` — treat `crucifix_choke` ✗) | ✓ (kata-gatame family) | ✓ | ✓ |
| `sub.ezekiel_top`, `sub.ezekiel_bottom` | ✓ (bottom requires gloves) | ✓ | ✓ | ✓ | ✓ | ✓ (no-gi variant) | ✓ | ✓ (sode-guruma-jime, gi) | ✓ | ✓ |
| `sub.kimura_*` (all), `sub.americana` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (ude-garami; elbow-joint classification) | ✓ | ✓ |
| `sub.omoplata` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ (sankaku-garami on the elbow only; shoulder-only cranking ✗) `[E]` | ✓ | ✓ |
| `sub.gogoplata` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (kakato-jime) | ✓ | ✓ |
| `sub.peruvian_necktie`, `sub.japanese_necktie` | ✓ | ◐ (crank component: ✗ where spine locks are banned) `[E]` | ◐ (legal as a choke; referee may call a spinal lock) `[E]` | ◐ | ◐ | ◐ | ✓ | ✗ (spine) `[E]` | ✓ | ✓ |
| `sub.bulldog` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ (choke variants ✓, crank ✗) | ✓ | ✓ |
| `sub.neck_crank_rear`, `sub.neck_crank_generic`, `sub.can_opener` | ✓ | ✗ `[S: SUBMISSIONS §2.22 W9 "banned in amateur MMA"]` | ✗ (spinal lock without choke) | ✗ | ✗ | ✗ | ◐ (can opener ✓; both-shoulder downward / chin-twist cranks ✗) `[S: RULES §2.6]` | ✗ | ✓ | ✓ |
| `sub.twister` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ `[S: RULES §2.6 "twister legal"]` | ✗ | ✓ | ✓ |
| `sub.crucifix_armlock` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (crucifix) `[S: RULES §2.6]` | ◐ (elbow only) | ✓ | ✓ |
| `sub.heel_hook_inside`, `sub.heel_hook_outside` | ✓ | ✗ `[E: IMMAF bans heel hooks / twisting knee locks — verify]` | ✗ | ✗ | ✗ | ✓ (since 2021) `[S: RULES §2.5]` | ✓ | ✗ (ashi-garami = hansoku-make) | ✓ | ✓ |
| `sub.kneebar` | ✓ | ◐ `[E: verify IMMAF]` | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| `sub.ankle_lock_straight` | ✓ | ✓ | ✓ (straight footlock legal at adult white) | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| `sub.toe_hold` | ✓ | ✗ (twisting) `[E]` | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| `sub.calf_slicer` | ✓ | ✗ `[E]` | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| `sub.banana_split` (leg-spreading) | ✓ | ◐ `[E]` | ✗ | ✗ (leg-spreading banned below brown `[S: RULES §2.5]`) | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| `sub.suloev_stretch` | ✓ | ◐ `[E]` | ✗ (treat as leg-spreading) | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| Knee reaping during leg entries (`pos.leg_saddle`, `pos.leg_cross_ashi` entries) | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ |
| `def.slam` | ✓ (no spiking) | ✓ (no spiking) `[E]` | ✗ | ✗ | ✗ | ✗ | ◐ (only from inside a locked submission) | ✗ | ◐ (EBI: as ADCC) `[E]` | ✓ (surface = concrete → §05 multiplier) |
| `def.strike_attacker` | ✓ | ✓ (no elbows to the head in most amateur sets `[E]`) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Referee technical submission on LOC | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (no referee: the attacker decides when to release; hold ≥ 4 s past LOC p 0.6 symptoms) |

**Ruleset flags consumed:** `subLegality[sub.id] ∈ {legal, restricted, illegal}`, `slamsLegal`, `slamsOnlyFromLockedSub`, `spikingLegal`, `strikesLegal`, `glovesMma`, `giGrips` (enables gi-only variants not modelled here), `refereeStopsOnLoc`, `techSubEnabled`, `kneeReapLegal`. An `illegal` submission is removed from the attacker's selection set; a T≤1 attacker in a grappling ruleset attempts an illegal technique by mistake with p 0.02 per availability window → foul handling in §06 `[E]`.

---

## 6. Behaviour by skill tier (T0–T5)

Tier = the fighter's grappling tier from §01 (sub-skill mean of `sk.chokes/jointLocks/legLocks/escapes`). The research tier ladder maps Untrained → T0, Novice → T1, Intermediate → T2–T3, Advanced → T4, Elite → T5 `[D: SUBMISSIONS §4 ↔ 00_CONVENTIONS §3]`.

### 6.1 Attempt decision (attacker)

On each availability window (§2.4.1) the attacker attempts with

```
pAttempt = (0.15 + 0.35 × skFamily/100) × styleMult × stateMult × rulesetMult × classMult
styleMult   : 2.0 subHunter · 0.5 wrestlerGnp · 1.0 otherwise
stateMult   : ×1.5 if the opponent is rocked · ×0.5 if fAtt > 0.7 (except RNC and arm-triangle: ×1.0) · ×0.51 when trailing on the cards in R3+ (−49 %)
rulesetMult : MMA 1.0 · sub-only 1.6 · ADCC/IBJJF 1.3 (no strikes to worry about) · judo 0.6 (ne-waza time-limited) · street 0.8
classMult   : women's divisions ×1.15
```
`[S: SUBMISSIONS §5 rule 2 (base, style, rocked, fatigue); FIGHT_DATA #129 trailing −49 %; rule 17 women ×1.15]` `[E: rulesetMult]`. Decision latency between evaluations = 01 `beh.bjj.decision_latency`: T0 4–8 s, T1 3–5 s, T2–T3 2–4 s, T4 1.5–3 s, T5 1–2 s `[S: BJJ_POS §6 decision latency via 01 §2.3.4 tier mapping]` [REVIEW: was T3 1.5–3 / T4 1.5–2.5, which used BJJ_POS's five tiers one-for-one; 01 maps BJJ tier 2 to T2–T3].

**Selection weights** among available submissions (relative, multiplied by the catalogue's `Conv` so that high-percentage attacks dominate; §8 tunes them to the attempt-mix targets):

| Tier | Repertoire and weights | Source |
|---|---|---|
| T0 | headlock/bulldog 50 · "squeeze anything" (guillotine standard, arm-out, from any angle) 30 · americana/keylock 10 · neck crank 10; never leg locks, never chains; holds a guillotine while being passed (von Flue bait) | `[S: SUBMISSIONS §4 Untrained; §2.20]` |
| T1 | guillotine standard 35 · RNC 25 · americana 15 · armbar (guard/mount) 10 · kimura 10 · can opener 5; attempts from bad positions (guillotine while mounted); leaves the arm straight after a failed armbar | `[S: §4 Novice; E weights]` |
| T2 | RNC 30 · guillotine (std/arm-in) 30 · armbar 15 · triangle 10 · kimura 5 · arm-triangle 5 · ankle lock 5; first chains (triangle → armbar) at 0.5 × edge P | `[E]` |
| T3 | RNC 30 · guillotine 25 · armbar 12 · arm-triangle 10 · triangle 8 · D'Arce/anaconda 8 · kimura 4 · heel hook/kneebar 3 (if `sk.legLocks ≥ 50`); chains at 0.8 × | `[E]` |
| T4 | attempt-mix target §8 row "attempt mix": RNC 25 · guillotine 32 · armbar 10 · triangle 8 · arm-triangle 5.5 · kimura 3.8 · D'Arce 2.3 · anaconda 1.9 · heel hook 1 · kneebar 1 · other 9 (%) | `[D: §8 attempt-mix derivation]` |
| T5 | as T4 but positional-first: 40 % of T5 attempts are "positional" submissions (mounted/back/side variants) with retained position on failure; specialists (`style.subHunter` or `sk.legLocks ≥ 85`) re-weight toward their family ×3; chains at 1.2 × | `[S: §4 Elite; §2.28; E weights]` |

**Patience** (`pAbandon`, §2.4.4): T0–T1 never abandon voluntarily (hold until escaped or the round ends — "grip and squeeze"); T2 patience 0.2; T3 0.5; T4 0.7; T5 0.9 (T5 also abandons *early* for position when `p_a` < 0.15 for 2 consecutive windows: the "release to keep top" behaviour, Adesanya on the guillotine's cost) `[S: §2.2 W4; E values]`.

**Novice attacker mistakes (T0–T1):** ×1.5 energy cost (§2.8); after a failed armbar/triangle from guard the attacker stays flat with the guard open → §03 pass +0.4 logit for the opponent `[E]`; attempts the guillotine from the bottom of mount (available at S1 −1.0 `[E]`); leg-lock attempts only via `edge.pos.step_over_to_entanglement` fumbles with `def.none` on the counter (they don't hide their own heel while attacking: opponent's `edge.sub.hh_counter` ×2 `[E]`).

### 6.2 Defender behaviour: early vs late defence

| Tier | When they defend | Options known (§2.5 `Min tier`) | Modelling |
|---|---|---|---|
| T0 | does not recognise danger; `def.none` until S3, then `def.endure` or panic; taps to pressure (`evt.tap` p 0.05/s while mounted or back-controlled by a T4+ attacker `[S: rule 24]`); turns *into* chokes (turn-away under GnP 60 % → back exposure `[S: BJJ_POS §6]`); gives the arm on a straight-arm push from mount (armbar exposure ×3) | `def.none`, `def.endure`, `def.tap` (if they know to: 60 %) | S1/S2 `p_e` at `Δe −2.0`; `M_WRONG_DEF` +0.8 on every window; `pGoOut` 0.40, `pRefuse` 0.40 → LOC/injury instead of tap `[S: §4 Untrained; rule 24]` |
| T1 | knows the *name* of the defence but applies it at S3; taps to americanas, can openers, cranks, "shoulder chokes"; leaves arms extended; steps over guards into leg locks (`evt.step_over_guard` ×2 rate `[E]`); holds the guillotine into a von Flue (release p 0.1) | `def.chin_tuck`, `def.posture_up`, `def.tap`; S3-only use of anything else | S1 `Δe −0.9`, S2 `Δe −0.5` (≈ ×0.4 / ×0.6 on `p_e` per SUBMISSIONS §4 Novice `[D: ×0.4 on p≈0.14 → −0.95 logit; ×0.6 → −0.55]`); `pGoOut` 0.19 |
| T2 | defends at S2; good hand-fighting on the RNC; answers the phone vs guillotine/triangle; still gives the arm-triangle under GnP; rarely taps to cranks; releases a guillotine when passed 40 % | + `def.hand_fight`, `def.two_on_one`, `def.answer_phone`, `def.stack`, `def.grip_clasp`, `def.pull_elbow`, `def.straighten_arm`, `def.clear_hooks_turn_in`, `def.turn_in_bridge`, `def.hide_heel`, `def.strike_attacker`, `def.slam`, `def.frame_and_bridge`, `def.endure` | S1 `Δe −0.2` (≈ ×0.8 `[D]`), S2–S3 0; `pGoOut` 0.15 |
| T3 | defends at S1 for the big five; positional escapes; regional-pro level | + `def.walk_weak_side`, `def.hitchhiker`, `def.roll_with`, `def.spin_out`, `def.swim_arm`, `def.go_flat`, `def.post_against_roll`, `def.clear_knee_line`, `def.turn_head_toward`, `def.step_over_head`, `def.release_grip` (p 0.8), `def.slide_to_choking_side`, `def.counter_sub` (von Flue) | `Δe 0`; `pGoOut` 0.13 |
| T4 | the baseline: defends at S1; only submitted when hurt, exhausted, or by a specialist | all except leg-lock counters below `sk.legLocks 60` | baseline; `pGoOut` 0.11 |
| T5 | prevents S0 ("never gives the position"): availability trigger rate ×0.6 `[S: rule 23 "−40 %"]`; early hand-fighting; endures cranks and partial chokes to the bell; cannot be finished by pain subs (bulldog, can opener, ankle lock, neck crank) unless `structuralHead ≥ 50` or `f ≥ 0.8` `[S: rule 23]`; will accept a 30 s stalled triangle rather than tap | all, including `def.counter_sub` leg counters | S1 `Δe +0.35`, S2 `+0.25`, S3 `+0.1` `[D: SUBMISSIONS §4 Elite ×1.4/×1.25/×1.1 on p≈0.14–0.5 → +0.35/+0.25/+0.1 logit]`; `pGoOut` 0.05; pain-sub S3 `p_a` = 0 under the rule-23 condition |

**Option choice policy (per window):** the defender AI ranks the options available at its tier by `expected value = p_e(option) × (escapeShare + 0.5 × regressShare) − energyCost × fatigueWeight`, then picks the best with probability `0.6 + 0.08 × tier` and a random known option otherwise (mistakes) `[E]`; a `state.rocked` defender picks from the restricted set (§2.5). `fightIQ` shifts the pick-best probability by `+0.002 × (fightIQ − 50)` `[E]`.

### 6.3 Tapping behaviour

| Tier | Chokes (`pGoOut`) | Joint locks (`pRefuse`) | Notes |
|---|---|---|---|
| T0 | 0.40 (does not know to tap) | 0.40 | 30 % heel-hook injury before the tap; taps to non-submissions (pressure) |
| T1 | 0.19 | 0.095 | 25 % heel-hook injury before the tap; taps early to pain subs (cranks, americana) — `tTap` ×0.5 for pain subs `[E]` |
| T2 | 0.11 | 0.055 | 15 % |
| T3 | 0.11 | 0.055 | 10 % |
| T4 | 0.11 | 0.055 | 5 %; the UFC 11 % LOC anchor `[S: P2]` |
| T5 | 0.05 | 0.025 | 5 %; pride-driven refusals modelled by `heart` (a heart-90 champion: 0.05 × 1.4 = 0.07) and the `refusesToTap` trait (0.5) |

`[S: SUBMISSIONS §4 stubbornness ladder as encoded in 01_FIGHTER_MODEL §2.7.7; §2.6.2/2.6.5 formulas; E: heel-hook pre-tap injury ladder]`. Two or more career submission losses lower all values by 20 % `[S: 01 §2.7.7; P15 direction]`.

### 6.4 What visibly changes, tier by tier (summary for animation/commentary)

- **T0 vs T0:** submissions are headlocks and "neck squeezes"; the fight ends by LOC or by a pressure tap; nobody hand-fights; the mounted fighter pushes on the chest with straight arms.
- **T1:** guillotines from everywhere, held too long; armbars finished on straight-armed opponents; the first kimura from side control; heel hooks cause injuries because the victim doesn't tap.
- **T2:** RNC hand-fights that last 10–15 s; triangles that stall; first chains (triangle → armbar); escapes at S2.
- **T3:** early defence on the big five; guillotine release when passed; D'Arce/anaconda appear; leg locks from specialists only.
- **T4:** the UFC picture: ≈ 0.45 logged attempts per fighter per 15 min, ≈ 25 % conversion, RNC ≈ 39 % of finishes, strikes create most entries.
- **T5:** near-unsubmittable without damage or fatigue (GSP/Jones/Khabib archetype `[S: SUBMISSIONS §4]`); attacks are positional and chained (Oliveira/Maia archetype: ~30 % conversion, 2–2.6 attempts per 15 min `[S: C1; A1]`).

---

## 7. Parameter registry

All ids prefixed `param.sub.`; catalogue stage values are registered as `param.sub.<subId>.<stage>.p` / `.dMeanMs` / `.dMinMs` / `.dMaxMs`, finish-clock values as `param.sub.<subId>.clock.*`, escape shares as `param.sub.<subId>.escape[i].share`, and chain edges as `param.sub.edge.<edgeId>.p` — they are listed in §3/§4 and not repeated here. These become `src/engine/params/submissions.ts`.

| id | value | unit | tag |
|---|---|---|---|
| `param.sub.window.entryMs` | 500 | ms | `[E]` |
| `param.sub.window.secureMs` | 1000 | ms | `[E]` |
| `param.sub.window.finishMs` | 1000 | ms | `[E]` |
| `param.sub.window.lockedMs` | 1000 | ms | `[E]` |
| `param.sub.dMaxFactor` | 3.0 | × dMean | `[E]` |
| `param.sub.windowRescaleCap` | 0.9 | prob | `[E]` |
| `param.sub.pClamp` | [0.01, 0.97] | prob | `[S: SUBMISSIONS §5]` |
| `param.sub.triggerWindowMs` | 3000 | ms | `[E]` |
| `param.sub.k_skill_entry` | 2.0 | logit / 100 pts | `[D: §2.3]` |
| `param.sub.k_skill_secure` | 2.0 | logit / 100 pts | `[D]` |
| `param.sub.k_skill_finish` | 1.0 | logit / 100 pts | `[D]` |
| `param.sub.k_skill_locked` | 1.0 | logit / 100 pts | `[D]` |
| `param.sub.k_ctrl` | 0.12 | logit per ctrl point above 5 | `[E]` |
| `param.sub.k_setup_strike` | 0.25 (max 3) | logit per landed strike / 5 s | `[S: BJJ_POS §3.3]` |
| `param.sub.chainBonus` | 0.18 | logit | `[D]` |
| `param.sub.chainHopCap` | 3 per 15000 ms | count | `[S: rule 22]` |
| `param.sub.chainTierMult` | T0–1 0 · T2 0.5 · T3 0.8 · T4 1.0 · T5 1.2 | × | `[E]` |
| `param.sub.k_str_fin` | 0.17 | logit per 10 pts ΔSTR | `[D]` |
| `param.sub.k_str_def` | 0.17 | logit per 10 pts ΔSTR | `[D]` |
| `param.sub.k_mass` | 0.08 per 5 kg, cap ±0.6 | logit | `[S: BJJ_POS §3.3]` |
| `param.sub.k_neck` | −1.2 × (neck/100 − 0.5) | logit | `[E]` |
| `param.sub.k_neck_tLoc` | +0.5 s per 0.5 of neck/100 | s | `[E]` |
| `param.sub.k_neck_girth` | −0.2 per 10 kg above class mean | logit | `[D]` |
| `param.sub.k_len_leg` | +0.25 per 10 cm legReach; −0.25 per 10 kg defender mass | logit | `[D]` |
| `param.sub.k_len_arm` | +0.25 per 10 cm reach; −0.2 per 10 kg defender mass | logit | `[D]` |
| `param.sub.k_flx_att_tri` | 0.08 per 10 pts | logit | `[D]` |
| `param.sub.k_flx_att_omo` | 0.12 per 10 pts | logit | `[D]` |
| `param.sub.flxGate.gogoplata` | 80 | attribute | `[S: rule 14]` |
| `param.sub.flxGate.rubberGuard` | 70 | attribute | `[S: rule 14]` |
| `param.sub.flxGate.buggy` | 70 | attribute | `[E]` |
| `param.sub.k_flx_def` | 0.10 per 10 pts | logit | `[D]` |
| `param.sub.k_flx_def_injuryDelay` | 0.02 s per pt above 50 | s | `[D]` |
| `param.sub.slip.base` | 0.2 | — | `[D: rule 10]` |
| `param.sub.slip.perSecond` | 0.001 | per s | `[D]` |
| `param.sub.slip.cap` | 0.9 (+0.1 blood, +0.1 LHW/HW; total cap 1.0) | — | `[D]` |
| `param.sub.k_slip_high` | −0.6 | logit × SLIP | `[D]` |
| `param.sub.k_slip_low` | −0.2 | logit × SLIP | `[D]` |
| `param.sub.k_fat_att_grip` | −0.85 | logit × f | `[D]` |
| `param.sub.k_fat_att` | −0.3 | logit × f | `[D]` |
| `param.sub.k_fat_def_att` | +0.5 | logit × fDef on p_a | `[D]` |
| `param.sub.k_fat_def_esc` | −0.7 | logit × fDef on p_e | `[D]` |
| `param.sub.k_rocked` | +1.0 | logit | `[D]` |
| `param.sub.k_rocked_def` | −0.7 | logit on p_e | `[D]` |
| `param.sub.k_structural_head` | +0.006 per point, cap +0.6 | logit | `[E]` |
| `param.sub.gloves.rncShortShare` | 0.5 | prob | `[S: rule 16]` |
| `param.sub.gloves.gripPenalty` | −0.1 | logit | `[D: rule 16]` |
| `param.sub.gloves.defHandFightPenalty` | −0.15 | logit | `[E]` |
| `param.sub.gloves.ezekielBonus` | +0.2 | logit | `[S: §2.16; magnitude E]` |
| `param.sub.class.lightTriArmbar` | +0.1 | logit (FLW/BW S1) | `[D: rule 17]` |
| `param.sub.class.womenAttemptMult` | 1.15 | × | `[S: rule 17]` |
| `param.sub.k_cage_top` | +0.3 | logit | `[E]` |
| `param.sub.k_cage_bottom` | −0.3 | logit | `[E]` |
| `param.sub.k_wrong_def` | +0.8 | logit | `[E]` |
| `param.sub.abandon.base` | 0.35 | prob / window past dMax | `[E]` |
| `param.sub.abandon.patienceSlope` | 0.25 | — | `[E]` |
| `param.sub.abandon.subHunterMult` | 0.5 | × | `[E]` |
| `param.sub.bellSaveTarget` | 0.03 | share of locked subs | `[S: rule 9]` |
| `param.sub.loc.meanS` | 9.0 (pooled); per type: armTri 7.2 · rnc 8.9 · guillotine 8.9 · ns 9.4 · triangle 9.5 · armIn 10.2 | s | `[S: P4]` |
| `param.sub.loc.sdS` | 1.5 | s | `[S: rule 7]` |
| `param.sub.loc.clamp` | [6, 13] | s | `[S: rule 7]` |
| `param.sub.pBlood.*` | std guillotine 0.5 · ten-finger 0.5 · arm-in 0.6 · Ezekiel 0.5 · bulldog 0.3 · neckties 0.6 · short choke 0.7 | prob | `[E]` |
| `param.sub.enduranceMs.*` | std 15000 · ten 12000 · arm-in 20000 · Ezekiel 12000 · bulldog 15000 · neckties 15000 | ms | `[E]` |
| `param.sub.enduranceFatigueAdd` | 0.05 | f | `[E]` |
| `param.sub.hTapAir` | 0.06 (T4) · ×2.0 T≤2 · ×0.5 T5 | per s | `[E]` |
| `param.sub.pGoOut.tier` | T0 0.40 · T1 0.19 · T2–T4 0.11 · T5 0.05 (= §01 `stubbornnessBase`) | prob | `[S: P2/P9/rule 24; 01 §2.7.7]` |
| `param.sub.pGoOut.heartSlope` | 0.5 + heart/100, clamp [0.02, 0.5] (= §01 `stubbornness`) | × | `[S: 01 §2.7.7]` |
| `param.sub.pGoOut.injuryHistoryMult` | 0.8 if `pro.subLosses ≥ 2` (= §01) | × | `[S: 01 §2.7.7]` |
| `param.sub.pGoOut.stakesMult` | 1.2 title / 1.0 | × | `[E]` |
| `param.sub.pRefuseFactor` | 0.5 × pGoOut (T0: 0.40) | prob | `[S: rule 7; rule 24]` |
| `param.sub.tapClampBeforeLocS` | 0.5 | s | `[E]` |
| `param.sub.hEsc.blood` | 0.02 T4 · 0.04 T5 · 0.005 T≤2 | per s | `[S: rule 8]` |
| `param.sub.hEsc.air` | 0.06 · 0.10 · 0.02 | per s | `[S: rule 8]` |
| `param.sub.hEsc.lockSplit` | regress 0.6 / escape 0.4 (chokes); 0.7 / 0.3 (locks) | prob | `[E]` |
| `param.sub.refLag.locS` | U(0.8, 2.0) | s | `[D: rule 7]` |
| `param.sub.refLag.injuryS` | U(0.5, 1.5) | s | `[E]` |
| `param.sub.pRefStopsOnInjury` | 0.7 | prob | `[S: rule 7]` |
| `param.sub.attackerReleaseOnLoc` | within 1 s: T4 0.6 · T5 0.8 · T≤2 0.2 | prob | `[E]` |
| `param.sub.postLocSymptomHoldS` | 4 | s | `[S: P9]` |
| `param.sub.postLocSymptomP` | 0.6 | prob | `[S: P9 61.5 %]` |
| `param.sub.pInjBeforeTap.heelHook` | T4–5 0.05 · T3 0.10 · T2 0.15 · T1 0.25 · T0 0.30; inside ×1.2 | prob | `[E; S: P13 direction]` |
| `param.sub.neckStrainPer5s` | 0.15 | — | `[E]` |
| `param.sub.neckStrainRefStop` | ≥ 0.6 → 0.3/s | prob | `[E]` |
| `param.sub.injury.capabilityLoss` | arm-high −60 % power / −70 % usage / −1.0 logit grips; arm-medium −30/−40/−0.5; knee-high mobility −50 %, TD −1.0, kicks off; ankle-medium mobility −25 %, kicks −40 % | — | `[E]` |
| `param.sub.injury.doctorStop` | high 0.8 · medium 0.3 (round break) | prob | `[E]` |
| `param.sub.injury.layoffMonths.high` | 10 | months | `[S: P5]` |
| `param.sub.slam.pAttempt` | 0.15 T4 · 0.30 wrestlerGnp | per window | `[S: rule 19]` |
| `param.sub.slam.minStrength` | 60 (or Δmass ≥ 10 kg) | attribute | `[S: rule 19; mass E]` |
| `param.sub.slam.pLiftBase` | 0.6 | prob | `[E]` |
| `param.sub.slam.pBreak` | triangle 0.7 · armbar 0.8 · guillotine 0.5 · omoplata 0.6 · flying 0.8 | prob | `[S: rule 19; omoplata/flying E]` |
| `param.sub.slam.heightDraw` | knees 0.35 · waist 0.40 · shoulder 0.20 · overhead 0.05 (overhead needs strength ≥ 80) | prob | `[E]` |
| `param.sub.slam.forceMult` | knees 0.8 · waist 1.2 · shoulder 1.6 · overhead 2.0 × hook reference | × | `[E]` |
| `param.sub.slam.tooLateS` | 2 | s before tLoc | `[E]` |
| `param.sub.vonFlue.releaseP` | T3+ 0.8 · T2 0.4 · T≤1 0.1 | prob / window | `[S: rule 20]` |
| `param.sub.mutual.strikeAbandonP` | 0.2 | prob per window with 2 landed strikes | `[S: rule 21]` |
| `param.sub.strike.landedRate` | 0.586 | prob | `[S: BJJ_POS §7.3]` |
| `param.sub.strike.dmgMult` | 0.6 top-into-entanglement · 0.3 inside triangle | × | `[E]` |
| `param.sub.triDiamondCounterShare` | 0.05 | prob | `[E]` |
| `param.sub.energy.*` | attacker S1 0.9 · S2 0.7 · S3 0.9 · locked 0.6 · grip +0.3; defender std 0.7 · high 1.4 · slam 4.0 · endure 0.5 · panic 1.6 | units / s | `[E]` |
| `param.sub.attempt.base` | 0.15 + 0.35 × sk/100 | prob per availability window | `[S: rule 2]` |
| `param.sub.attempt.styleMult` | subHunter 2.0 · wrestlerGnp 0.5 | × | `[S: rule 2]` |
| `param.sub.attempt.rockedMult` | 1.5 | × | `[S: rule 2]` |
| `param.sub.attempt.fatigueMult` | 0.5 at f > 0.7 (RNC/arm-tri exempt) | × | `[S: rule 2]` |
| `param.sub.attempt.trailingMult` | 0.51 (R3+, trailing) | × | `[S: FIGHT_DATA #129]` |
| `param.sub.attempt.rulesetMult` | MMA 1.0 · sub-only 1.6 · ADCC/IBJJF 1.3 · judo 0.6 · street 0.8 | × | `[E]` |
| `param.sub.attempt.latencyS` | T0 4–8 · T1 3–5 · T2–T3 2–4 · T4 1.5–3 · T5 1–2 (= 01 `beh.bjj.decision_latency`) [REVIEW] | s | `[S: BJJ_POS §6 via 01 §2.3.4]` |
| `param.sub.patience.tier` | T0–1 never · T2 0.2 · T3 0.5 · T4 0.7 · T5 0.9 | — | `[E]` |
| `param.sub.t5.availabilityMult` | 0.6 | × | `[S: rule 23]` |
| `param.sub.t5.painSubImmunity` | structuralHead < 50 and f < 0.8 | condition | `[S: rule 23]` |
| `param.sub.t0.pressureTapPerS` | 0.05 | per s | `[S: rule 24]` |
| `param.sub.tierDefShift` | T0 −2.0 · T1 S1 −0.9 / S2 −0.5 · T2 S1 −0.2 · T3 0 · T4 0 · T5 +0.35 / +0.25 / +0.1 | logit on p_e | `[D: SUBMISSIONS §4]` |
| `param.sub.defPickBest` | 0.6 + 0.08 × tier (+0.002 × (fightIQ − 50)) | prob | `[E]` |
| `param.sub.illegalAttemptP.T01` | 0.02 | prob per availability window (grappling rulesets) | `[E]` |

---

## 8. Calibration hooks

Batch of ≥ 2,000 simulated 3 × 5-min MMA bouts, mixed men's divisions, T4-vs-T4 roster unless stated. Rows cite the `FIGHT_DATA §3` master table and `SUBMISSIONS §5 rule 25`.

| # | Metric | Target | Tolerance | Source | Knobs |
|---|---|---|---|---|---|
| C1 | Share of bouts ending by submission | 18 % | ±3 pp | `FIGHT_DATA #88` (all-time 19.5 % #89) | `param.sub.attempt.base`, §03 trigger rates |
| C2 | Sub attempts (logged at S1) per fighter per 15 min | 0.45 | ±0.15 | `FIGHT_DATA #69` (median 0.6 `[C1]`) | attempt base, availability |
| C3 | Sub attempts per fight (both) / fights with zero attempts | 0.65 / 60 % | ±0.15 / ±5 pp | `FIGHT_DATA #70, #71` | as C2 |
| C4 | Attempts per 15 by class | FLW 0.63 · BW 0.48 · FW 0.53 · LW 0.56 · WW 0.47 · MW 0.51 · LHW 0.36 · HW 0.31 | ±0.15 | `FIGHT_DATA #72` | class ground-time (§03) + `M_CLASS` |
| C5 | Finish rate per logged attempt | 25 % (RNC ≈ 40 %+, guillotine ≈ 10–15 %, armbar ≈ 30 %, triangle ≈ 25 %, arm-triangle ≈ 40 %, kimura ≈ 20 %, D'Arce/anaconda ≈ 35 %, heel hook ≈ 30–40 %) | ±5 pp | `FIGHT_DATA #73`; `SUBMISSIONS rule 25` (17–25 %) | S2 values (the least observable stage) |
| C6 | Finishing-sub mix | RNC 39 · guillotine 18 · armbar 12 · arm-triangle 7.5 · triangle 6 · D'Arce 3 · kimura 3 · anaconda 2.5 · heel hook 1.5 · kneebar 1 · other 7.5 (%) | ±3 pp on RNC, ±2 pp others | `FIGHT_DATA #74`; `SUB_FINISH §1a` | selection weights (§6.1) |
| C7 | Attempt mix (implied) | RNC 25 · guillotine 32 · armbar 10 · triangle 8 · arm-triangle 5.5 · kimura 3.8 · D'Arce 2.3 · anaconda 1.9 · heel hook 1 · kneebar 1 · other 9 (%) | ±4 pp | `[D: finish share ÷ Conv: e.g. RNC 39/0.43 = 91, guillotine 17.6/0.16 = 110, armbar 11.9/0.34 = 35, triangle 5.5/0.25 = 22 (+mounted), arm-tri 7.7/0.40 = 19, kimura 2.7/0.22 = 12, D'Arce 2.8/0.35 = 8, anaconda 2.4/0.35 = 7, heel hook 1.4/0.4 = 3.5, kneebar 1.2/0.36 = 3.3, other ≈ 31; normalised; weighted conversion Σ share × Conv ≈ 0.30]` | selection weights |
| C8 | Chokes / arm locks / leg locks share of subs | 79 / 15 / 3 % | ±4 pp | `FIGHT_DATA #75` | family weights |
| C9 | Chokes ending in unconsciousness | 11 % | ±4 pp | `FIGHT_DATA #76`; `[P2]` | `pGoOut` |
| C10 | Round split of submission finishes (3R) | R1 51 · R2 32 · R3 16 (%) | ±4 pp | `SUBMISSIONS §6.5 [FA2]`; `FIGHT_DATA #98` | fatigue terms, `M_FAT_DEF` |
| C11 | Round split (5R) | R1 40 · R2 25 · R3 15 · R4 12 · R5 8 (%) | ±5 pp | `SUBMISSIONS rule 25 ESTIMATE` | as C10 |
| C12 | Submission success decay | R3 per-attempt success ≈ 0.5 × R1–R2 | ±0.15 | `FIGHT_DATA #126` | `M_FAT_ATT_GRIP`, `SLIP` |
| C13 | Trailing fighter sub attempts | −49 % | ±15 % | `FIGHT_DATA #129` | `attempt.trailingMult` |
| C14 | Mean duration of sub finishes | 6.8 min | ±0.7 | `FIGHT_DATA #103` | — (emergent) |
| C15 | SUB % by men's class | HW 21 · LHW 19 · MW 22 · WW 19 · LW 22 · FW 17.5 · BW 19 · FLW 22 (Fight Matrix) vs HW 15 · LHW 17 · MW 21 · WW 19 · LW 22 · FW 17 · BW 20 · FLW 22 (MMA.SOCIAL) | ±3 pp | `FIGHT_DATA #93`; `SUB_FINISH §2c` (prefer MMA.SOCIAL for HW) | no direct class scaling (rule 17); KO model shifts the share |
| C16 | Women's outcome mix (SUB %) | W-SW 20 · W-FLW 20 · W-BW 17 | ±4 pp | `FIGHT_DATA #94` | `womenAttemptMult` |
| C17 | Bell saves | ≈ 3 % of locked submissions | ±2 pp | `SUBMISSIONS rule 9` | — |
| C18 | Skill-gap effect | T4-vs-T2 cards: 35–45 % of bouts end by submission; T0-vs-T4: sub finish per attempt ≈ 40 % | ±5 pp | `SUBMISSIONS rule 25`; `FIGHT_DATA §5 tier priors` | `k_skill`, `tierDefShift` |
| C19 | Amateur / regional sub share of outcomes | amateur 23 % · regional pro 26 % | ±5 pp | `FIGHT_DATA #97, §5` | tier defaults |
| C20 | Era/meta preset | RNC share 16 % (2003-04) → 47 % (2023-24); back control ≈ 45 % of finishing contexts (modern) | ±5 pp | `SUBMISSIONS §1.2 [MD1]`, rule 25 | selection weights per era preset |
| C21 | Grappling rulesets | ADCC/IBJJF black-belt submission rate 34–42 %; ADCC leg locks 22–30 % of finishes, chokes 65 %; IBJJF Worlds back chokes 44.7 %, armbar 21.3 % | ±5 pp | `FIGHT_DATA §2.6`; `SUB_FINISH §3` | `attempt.rulesetMult`, family weights per ruleset |
| C22 | Elite specialists | 2.0–2.6 attempts per 15 min, ≈ 30 % conversion | ±0.5 / ±5 pp | `SUBMISSIONS §1.1 [C1][A1]` | `style.subHunter`, `M_SKILL` |
| C23 | Heel-hook injury share (heel-hook-legal grappling batch) | knee injury RR ≈ 12 vs a no-heel-hook batch | ±4 | `[P10]` | `pInjBeforeTap`, `pRefuse` |
| C24 | Choke finishes in a lower-weight video-coded sample | RNC 38 %, armbar 15 %, guillotine 10.5 %, triangle 11.5 % per attempt | indicative (n small) | `BJJ_POS §7.3` Roy & Murphy | S2 values |

**Order of tuning:** C2/C3 (attempt volume via §03 triggers) → C5 (S2 per family) → C6/C7 (selection weights) → C9/C10 → C18/C19 (tier terms) → C21 (rulesets).

---

## 9. Assumptions and open questions

### 9.1 Every `[E]` in this section
1. Stage windows 500/1,000/1,000/1,000 ms; `dMax = 3 × dMean`; per-window rescale cap 0.9; 3 s trigger window (§2.2–2.4).
2. `M_CTRL` 0.12 logit per control point; `M_NECK` −1.2 × (neck/100 − 0.5) and +0.5 s on `tLoc`; `M_CAGE` ±0.3; `M_WRONG_DEF` +0.8; `M_ROCKED` structural-head term +0.006/pt cap 0.6; `M_GLOVES` defender hand-fight −0.15 and Ezekiel +0.2 magnitude; mass threshold for slams (10 kg).
3. All `Δa`/`Δe` values in the defender option table (§2.5), option minimum tiers, energy cost classes, the rocked-defender option restriction, the strike-damage multipliers 0.6/0.3.
4. `pAbandon` formula (0.35 − 0.25 × patience), sub-hunter halving, T≤1 never abandoning; tier patience ladder.
5. `pBlood` per mixed choke (0.3–0.7); `enduranceMs` per mixed choke; `enduranceFatigueAdd` 0.05; `hTapAir` 0.06/s with tier multipliers; pooled 9.0 s LOC mean applied to chokes without a per-type measurement (`[D]` but the applicability is an assumption).
6. `pGoOut` title-fight ×1.2 (the heart scaling, clamp and injury-history factor are §01's); tap clamp 0.5 s before LOC; the uniform tap-time distribution.
7. Locked-clock escape hazards for joint locks (0.01–0.10/s) and the regress/escape split (0.6/0.4 chokes, 0.7/0.3 locks); attacker release-on-LOC awareness (0.6/0.8/0.2).
8. Referee injury lag U(0.5, 1.5) s; joint-lock injury delays per technique; `state.neck_strain` rate and referee threshold; `pInjBeforeTap` heel-hook ladder (0.05–0.30) and inside ×1.2; injury capability-loss table; doctor-stop probabilities 0.8/0.3; post-injury `pRefuse = 0`.
9. Slam: `pLiftBase` 0.6, height draw, `forceMult` ladder, overhead strength gate 80, omoplata/flying break probabilities, the "too late" 2 s rule, triangle-diamond counter share 0.05.
10. Mutual-entanglement tie-break (higher `sk.legLocks` first); chain tier multipliers; every chain `P` marked `[E]` in §4 (rear-triangle → armbar 0.30, crank ↔ RNC 0.40, truck family 0.20, crucifix splits, necktie family 0.15, kimura-side → D'Arce 0.10, mounted-guillotine ↔ arm-triangle 0.20, Ezekiel edges 0.20, armbar-side → kimura 0.15, N-S → arm-triangle 0.10, N-S → mount 0.20, throw-to-mount armbar 0.25, knee-slice → omoplata 0.05, arm-drag → triangle 0.15, kimura → takedown 0.20, kimura grip → triangle 0.10, single-leg/underhook → kimura trap 0.15, inverted triangle → kimura 0.20, buggy → sweep 0.20, Imanari 0.30, SLX-fail → heel hook 0.20, leg-lock family cross edges 0.10, standing arm-triangle → ground 0.50, scramble → bulldog 0.10/0.20, bulldog → kesa 0.60, choke → crank 0.10, guillotine → armbar 0.05, D'Arce → guillotine 0.10, arm-triangle → mounted guillotine 0.05, turtle → crucifix 0.15, RNC → short 0.30).
11. Catalogue values marked `[E]`: `sub.rnc_short` stage shifts and tap range; `sub.arm_triangle_side` (−0.05 per stage), `sub.arm_triangle_standing`, `sub.triangle_side`, `sub.triangle_inverted`, `sub.crucifix_choke`, `sub.buggy_choke`, `sub.can_opener` S3 0.30, `sub.banana_split` clock, `sub.suloev_stretch` clock; all intra-family finish-share splits; escape splits marked `[E]` (rear triangle, crucifix choke, belly-down armbar, side/inverted triangle, standing arm-triangle, Ezekiel bottom, kimura grip, banana split, gogoplata/buggy, ten-finger, mounted-armbar re-split); selection gates (`sk.chokes ≥ 60/70`, flexibility ≥ 60 for the inverted triangle, explosiveness ≥ 60 for flying attacks); modifier weight multipliers (×0.5, ×1.3, ×1.5, ×2) noted per entry; the standing-guillotine mass-deficit term; the ankle-lock/calf-slicer heart (pain tolerance) term; the guillotine `M_LEN_ARM` weight 0.5; Suloev flexibility weight; kimura-guard pass bonus +0.3 for the top.
12. Legality: amateur MMA (IMMAF-style) column, sub-only column, judo classification of omoplata/necktie/bulldog, the "crucifix" ADCC interpretation, T≤1 illegal-attempt p 0.02.
13. Behaviour: `rulesetMult` for attempts; tier selection weights (T0–T3, T5); T5 positional share 40 % and specialist ×3; novice mistake magnitudes (pass +0.4, step-over ×2, counter ×2, guillotine from bottom of mount −1.0); defender option-choice policy (pick-best 0.6 + 0.08 × tier, fightIQ slope 0.002); `tTap` ×0.5 for T1 pain subs; injury-history 30 %.
14. Energy costs (§2.8) scaled from `BJJ_POS`.
15. `sk.cranks` default blend 0.7/0.3.

### 9.2 `[D]` conversions that changed a research number
- RNC S2 0.60 → 0.50 and S3 0.90 → 0.85; guillotine standard S2 0.45 → 0.40, S3 0.45 → 0.35; arm-in S2 0.40 → 0.35, S3 0.40 → 0.30; all armbar variants S2 −0.10 — to reconcile "attempt logged at S1 success" with `FIGHT_DATA #73` conversions. If §03 logs attempts differently (e.g. at S1 *start*), revert to the research values and re-run C5.
- Multiplicative research modifiers converted to logit terms at p ≈ 0.45–0.5; the conversions are exact only near that base and will under/over-shoot at extreme bases (e.g. S3 0.85) — accepted (conventions §4).

### 9.3 Open questions
1. **Attempt logging point.** UFCStats' "attempt" is inconsistently applied `[S: SUB_FINISH §4]`; this section logs at S1 success. The judging section must use the same event.
2. **Availability trigger rates** live in §03; C2/C3 cannot be met by this section alone. The required product is `triggerRate × pAttempt × P_S1 ≈ 0.45 / 15 min / fighter`.
3. **`neck`** is the §01 attribute (0–100; default `40 + 0.2 × strength` per §01 §3); this section uses `neck/100` wherever the research spoke of a neck-brace fraction.
4. **Amateur MMA legality** (heel hooks, kneebars, toe holds, calf slicers, neck cranks, elbows) must be verified against the IMMAF Unified Amateur Rules before encoding; the IBJJF belt matrix is flagged "reconstructed" in `RULES §2.5`.
5. **Per-technique attempt-to-finish data** does not exist publicly (`SUBMISSIONS §7 3b`); C5's per-family targets are estimates and should be validated by scraping UFCStats fight-detail pages (`SUBMISSIONS §6.6`).
6. **Lock-to-tap latency** has no direct measurement (`SUBMISSIONS §7 3c`); all tap ranges are bounded by the 9 s LOC window (chokes) and "pain precedes failure" (locks).
7. **Gi rulesets** (collar chokes, bow-and-arrow, lapel guards) are out of scope; `giGrips` is a placeholder flag.
8. **Era presets** (C20) need selection-weight tables per era; only the modern meta is specified here.

### 9.4 Playability-vs-realism tradeoffs (default: realism)
- **Stalled triangles of 30–60 s** are realistic but dull; a "cinematic" preset may set `param.sub.dMaxFactor = 2.0` (stated tradeoff: shorter, more decisive sub battles; C5 shifts down ≈ 3 pp).
- **T0 injuries without a tap** (heel hooks, armbars) are realistic and are kept; the presentation layer should depict them with restraint (`RULES §2.8` ethics note).
- **Rare submissions** (gogoplata, buggy, banana split, Suloev) are kept at flavour-level priors so that specialist fighters and T0–T1 opponents can produce them; they do not affect C6 within tolerance.
- **Slam KOs** from inside submissions are rare but spectacular; realism keeps `pSlamAttempt` at 0.15 per window rather than boosting it for spectacle.
- **Post-LOC hold** is cosmetic (commentary/recovery) rather than a health system — deliberate abstraction per the brief.
