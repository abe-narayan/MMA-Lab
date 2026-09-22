# MMA Integration, Strategy and Fight IQ — Research Brief for the Bout Lab AI

Research agent output. Feeds game-plan construction, in-fight adaptation, and style-matchup logic for the TypeScript bout simulator (`src/engine`). Where a number is sourced it carries a citation; where it is a design estimate it is labelled **ESTIMATE**. Vocabulary is aligned to the current engine (`Posture = standing|clinch|ground|down`, `GroundPosition = guard|half|side|mount|back`, `ActionKind = jab|cross|hook|uppercut|lowKick|bodyKick|headKick|teep|clinchEntry|clinchKnee|breakClinch|shoot|sprawlDefend|groundStrike|passGuard|sweep|standUp|submission|...`); rules that need new actions say so.

Research constraint: the session's web-search budget was exhausted early, so discovery was done via PubMed E-utilities, arXiv API, direct fetches and a small number of Brave queries. Fetched sources are cited with URLs; a few well-known coaching principles could not be re-fetched and are marked "(recalled; not re-verified this session)".

---

## 1. Summary

1. **Striking volume and precision decide most fights; offensive grappling decides the rest.** In 2,831 UFC bouts (2000–2015), landing even one significant ground strike gave a 77–79% chance of victory, and rule-mining on 167 fight metrics found precision (sig. strikes landed) and offensive passes/ground strikes as the recurring predictors, with 75% out-of-sample accuracy (Frontiers AI 2019). The UFC PI's own KPI ranking puts *total strikes landed* first for both sexes; takedown success is 3rd for women but only 19th for men (UFC PI Vol. 1). UFC PI Vol. 2 found the fighter who threw more strikes won in every weight class.
2. **Takedowns are worth far more than their raw frequency.** Winners of 8,461 UFC bouts landed at median 0.067 TD/min vs 0 for losers, converted 50% vs 20%, and held ~100 s vs 79 s per takedown (Kirk et al. 2026). 68.2% of decisions go to the fighter with more control time, rising to 87% when the control gap exceeds 5 minutes (The Fight Algorithm, n=3,850). But control without offence loses: controllers who lose average 49 vs 70 sig. strikes.
3. **Physical advantages are weak on their own, decisive when converted.** Reach advantage wins only ~52% of bouts overall; the effect is real only at heavyweight in peer-reviewed data (Kirk 2024), yet 7+ inch deficits win only 37% and reach increases the odds of straight-punch finishes (Barley et al. 2025). Age is a stronger predictor than any body measurement (winners 0.82 years younger). Southpaw vs orthodox is 34–34 in head-to-head UFC data; any southpaw edge is a familiarity effect, not a stance effect.
4. **Fighters change behaviour when they know they are losing, and mostly in the wrong direction:** trailing fighters attempt fewer takedowns and submissions and chase the stand-up KO (Gift 2025). Only ~15% of finishes happen in round 3, so "steal the round" behaviour usually means volume, not finishes.
5. **The design consequence:** the AI should model (a) plan construction from scouting, (b) matchup-specific weightings on action selection, (c) an adaptation loop with tier-dependent latency and (d) explicit score/damage awareness that changes risk appetite — with all four degraded by fatigue and damage.

---

## 2. Integration Mechanics Catalogue

Base success rates are for a neutral skill matchup, fresh fighters, mid-round. All "base %" values are **ESTIMATE** unless cited. Apply skill differential, fatigue, damage and cage-position modifiers on top (Section 10).

### 2.1 Striking → Wrestling (level changes)

| ID | Transition | From → To | Requirements | Timing window | Base success | Counters | Notes / sources |
|---|---|---|---|---|---|---|---|
| I-1 | Naked double-leg shot | standing (distance) → ground (top, guard/half) | wrestling ≥ moderate; stamina > 40%; opponent not in sprawl-ready posture | Any; best when opponent's weight is on front foot or mid-kick | 25–30% **ESTIMATE** (league avg all TDs 39% per Fightnomics; naked shots sit below average) | sprawl, front headlock/guillotine, knee/uppercut on entry, cage wall | Fightnomics: 1.5 TD attempts/round, 39% success; three families (shot, lower-body clinch, upper-body clinch) with different rates. |
| I-2 | Jab → double leg | standing → ground (top) | jab thrown in the prior 0.4–0.8 s; opponent guard raised or stepping back | On opponent's reaction to the jab (hands up / weight back) | base + 10–15 pts **ESTIMATE** (≈ 40–45%) | pull hands down + sprawl; counter-jab into knee; frame and circle off | "Most common MMA setup is off the jab—throw a jab to get their hands up, then level change into the double" (fightscience.com). Dober: the jab also buys the *defender* half a second — model symmetric information. |
| I-3 | Cross → single leg / high-crotch | standing → ground or → clinch (cage single) | rear hand extended, opponent circles to the lead side | 0.3–0.6 s after cross, on the opponent's lateral step | base + 8–12 pts **ESTIMATE** (≈ 38–42%); finishes often need cage | limp-leg/whizzer, sprawl on one leg, hop to cage and hip-in | Single legs are lower % in open space, higher on the cage; convert to I-8 if within 1.5 m of cage. |
| I-4 | Hook → body lock | standing → clinch (bodylock) | hook thrown and opponent covers/ducks; distance < 1.0 m | Immediately after hook rotation carries the fighter inside | 50–60% to secure clinch **ESTIMATE**; TD from bodylock 45–55% **ESTIMATE** | frame on hip, underhook, hitting on the entry (elbow/uppercut) | Hook rotation naturally chambers the rear arm around the waist; "attack by combination forces defensive covers, creating openings" (Slack, Three Initiatives). |
| I-5 | Kick-catch takedown | standing → ground (top) or → clinch | opponent throws bodyKick/lowKick at ≥ mid height; catcher's balance ≥ 60% | On kick contact; 0.2 s window | 45–55% if the kick is caught **ESTIMATE**; catch probability vs bodyKick ≈ 20–30% **ESTIMATE** (drops with kicker skill) | kicker hops/strikes while caught, pulls leg, or throws punches with the caught leg (rare) | Kicking with the rear leg vs a wrestler is the classic "don't" (Section 4). |
| I-6 | Level-change feint → uppercut/knee (the counter) | standing → standing | opponent has shown sprawl reaction | On the sprawl reaction | +15–25% hit chance on the follow-up strike **ESTIMATE** | none specific; costs stamina | "Fake a move for the legs and let the opponent duck onto an uppercut" (mixingmartialarts.com). |
| I-7 | Sprawl → front headlock → guillotine / go-behind | sprawlDefend → ground (top) or standing (back) | successful sprawl; opponent's head outside | Immediately post-sprawl | go-behind 30–40%, guillotine attempt lands as sub threat 15–25% **ESTIMATE** | shooter drives to cage, hand-fights head, pulls guard | Anti-wrestling counters are how strikers turn stuffed shots into offence. |
| I-8 | Cage-pinned single/double → finish on the fence | clinch (cage) → ground (top) | opponent's back on cage; wrestler has head on inside; opponent stamina < 60% helps | Sustained; 5–20 s chains | 45–60% eventually **ESTIMATE**, rising with time pinned | wall-walk (I-14), underhook + hip-in, whizzer + circle, hitting on the break | Khabib's "twist" bodylock kills the underhook by straightening the arm; opponent's three options (stall → lifted; lower base → tripped; circle → walks into double) (The Fight Site). |

### 2.2 Clinch game

| ID | Transition | From → To | Requirements | Base success | Counters | Notes / sources |
|---|---|---|---|---|---|---|
| I-9 | Clinch entry off strikes (collar tie / underhook) | standing → clinch | distance < 1.0 m; thrown 2+ strikes | 40–55% **ESTIMATE** | frame, pivot off, knee on entry, hitting on the entry | Fightnomics: clinch ≈ 18% of fight time; clinch strikes target body more, higher accuracy, lower power. |
| I-10 | Dirty boxing (collar-tie / single-collar + short punches, uppercuts, elbows, knees) | clinch → clinch | control ≥ one tie | short strikes land 55–70% **ESTIMATE**; lower knockdown rate than distance | pummel for double underhooks, head position, break | Knockdown rate lower in clinch than at distance (Fightnomics). Elbows are ~3–5% of stoppages, up to 15.8% at women's bantamweight (UFC PI Vol. 1 Table 1.1). |
| I-11 | Cage clinch (pin) with knees/elbows | clinch (cage) → clinch (cage) | opponent's back on cage | control ticks accrue; knees land 50–65% **ESTIMATE** | underhook + turn, hip escape, elbows off the break | Fighters currently "over two-thirds" of time standing; clinch share of standing time has fallen (Fightnomics). |
| I-12 | Hitting on the break | clinch → standing | either fighter initiates breakClinch | +20–30% hit chance for the fighter who breaks with a strike vs one who steps out clean **ESTIMATE** | step out with hand up / pivot | Classic Anderson Silva / Couture principle; implement as: the fighter initiating `breakClinch` may chain a free `hook`/`uppercut`/`clinchKnee` with a 0.3 s advantage. |
| I-13 | Wrestle-up / duck-under from clinch | clinch → ground (top) or back | double underhooks or duck-under angle | 35–50% **ESTIMATE** | whizzer, hip-in, sag, cage | Upper-body clinch TDs are in Fightnomics' three-family split. |

### 2.3 Ground → standing and the strike/ground interface

| ID | Transition | From → To | Requirements | Base success | Counters | Notes / sources |
|---|---|---|---|---|---|---|
| I-14 | Wall walk | ground (bottom, cage) → clinch (cage) → standing | back within 0.5 m of cage; bottom fighter's balance > 30% | 40–60% per 5 s cycle **ESTIMATE**; higher vs strikers, lower vs elite riders | top fighter flattens hips, leg ride, wrist control, twist bodylock | Mechanics: turn to hip, post, plant bottom foot on cage, push up using the cage, keep head tight, then underhook or whizzer + circle (Evolve). |
| I-15 | Hip-in / technical stand-up (open mat) | ground (bottom, guard/half) → standing | frames set; top fighter posturing to strike | 25–40% per attempt **ESTIMATE** | top fighter stays chest-to-chest, controls wrists, punishes with GnP | Getting up costs the stand-up window; use when ground damage rate > threshold (Section 7). |
| I-16 | Ground-and-pound as passing | ground (top, guard) → half/side/mount | top fighter stamina > 40%; posture up | +10–20 pts on `passGuard` success when 2+ ground strikes landed in prior 5 s **ESTIMATE** | bottom fighter frames, sweeps on posture break, up-kicks | "Offensive passes ≥3 with ground strikes ≥1" is a Frontiers AI 2019 victory rule (414 TP / 120 FP). Judges reward ground strikes; Khabib ≈ 4.0 ground strikes per control-minute vs Covington 0.9; league median ≈ 2.0 (The Fight Algorithm). |
| I-17 | Up-kicks | ground (bottom, open guard) → standing (opponent standing over) | top fighter standing, not engaged; legal target only when both are grounded per rules | land 15–25% **ESTIMATE**, KO rare (<2%) | step around, dive into guard, let referee stand | Grounded-opponent rules vary: kicks/knees to the head of a grounded opponent are illegal in unified rules. Up-kicks from bottom to a standing opponent's head are legal. |
| I-18 | Sweep on a strike | ground (bottom) → ground (top) | top fighter posts/overcommits on a strike | 20–30% **ESTIMATE**, 2× vs tired top fighter | keep elbows in, base | Strikes change the ground game: attacking from top opens sweeps, attacking from bottom is weak (Fightnomics: bottom strikes "generally weak"). |
| I-19 | Referee stand-up | ground → standing | low activity: no significant action for ~20–30 s **ESTIMATE** (varies by referee) | deterministic after threshold | keep striking/passing | Fightnomics notes referees separating stalemates contributed to the declining clinch share. |
| I-20 | Sprawl-and-brawl loop | standing ↔ sprawlDefend | striker with TD defence ≥ opponent wrestling | each stuffed shot costs the shooter 2–3× the striker's stamina **ESTIMATE**; striker gets a free strike window 0.5 s | wrestler chains to cage, uses strikes to set up | The classic Liddell model: stuff, punish, reset to distance. |

### 2.4 Glove and rules effects (MMA-specific)

- **4 oz gloves reduce blocking coverage.** "It's harder to block shots with smaller gloves, making footwork and evasion more critical than passive coverage" (bangtaomuaythai.com); "smaller gloves let more hits go through" traditional blocks (Sherdog forums). Sim: `highGuard` block probability should be lower than a boxing model by roughly a third **ESTIMATE**; `slip`/`parry`/footwork relatively more valuable; short shots (hooks/uppercuts/elbows inside) get a higher KO coefficient.
- **Eye pokes are common and change outcomes.** 369 eye injuries in 2,208 Nevada MMA fights (2001–2020); 62.8% of eye-injured fighters lost (Fliotsos et al. 2021). Glove design matters: Bellator's curved-finger glove produced significantly fewer eye pokes than UFC and PFL gloves (p=0.03, 0.02) (Combat Sports Law 2025). Sim: an extended-hand range-finding posture (long guard) carries a small foul chance per second **ESTIMATE 0.3–0.6%/s**; a poke triggers a pause, a potential point deduction on repeat, and a temporary vision penalty (accuracy −10–20%) **ESTIMATE**.
- **Elbows and knees are stoppage tools in the clinch and on the ground:** punches cause 45% of stoppages overall, elbows 2–5% (15.8% in WBW), knees 3–7% (UFC PI Vol. 1 Table 1.1).
- **Cage size:** the 25-ft cage produced 5% more KOs and 8% more submissions than the 30-ft cage; decisions 39% vs 51% (UFC PI Vol. 2 via ESPN). Sim: `cageRadius` should scale cage-cut success and finish rates.

---

## 3. Style-Matchup Playbook

Each rule is written as a weighting on action selection (multipliers on the base preference of an `ActionKind` or defensive posture) plus a range/positioning target. "Weight ×1.6" means multiply the selection probability of that action family by 1.6 before renormalising.

### 3.1 Striker vs Grappler (wrestler)

**Historical winning pattern for the striker (sprawl-and-brawl):** keep distance, make the wrestler shoot from far away, punish entries, fight off the cage, never kick with the rear leg at close range, get up immediately when taken down (wall walk before the top fighter settles). Successful examples: Liddell, Aldo's early career, Holloway vs wrestlers, Adesanya, Pereira vs Rountree (recalled).

**Winning pattern for the wrestler:** strike to set up shots (I-2, I-3), take the centre, walk the striker to the fence, chain wrestle on the cage (I-8), ground strikes to pass and score (I-16), reset ride every stand-up attempt; accept losing striking exchanges 1:2 as long as takedowns land.

Rules (striker side):
- S-1 `if oppWrestling − ownTDDefence > 1 tier: preferredRange = long; teep ×1.4; jab ×1.4; rearLegKick (bodyKick/headKick/lowKick with rear leg) ×0.4; lead lowKick ×0.8; uppercut/knee on level-change reaction ×1.8`. Rationale: rear-leg kicks are the highest catch-risk strikes; leads and straights are hard to catch (Slack: "straight strikes are king").
- S-2 `circleAway weight ×1.5 when distanceToCage < 1.5 m` (cage = wrestler's finishing tool; I-8).
- S-3 `on takedown landed: standUp/wallWalk weight ×2.0 for the first 8 s; submission-from-bottom ×0.5` unless BJJ tier ≥ opponent's +1.
- S-4 `sprawlDefend readiness: keep weight on back foot (Dober); reduce combination length to ≤3 strikes; do not throw the 4th strike when opponent is at level-change distance`.
- S-5 Prefer `clinchEntry` never; if clinched, `breakClinch` ×1.8 with I-12 hit-on-the-break.

Rules (wrestler side):
- W-1 `shoot only after ≥1 strike in prior 1 s (I-2/I-3) unless opponent balance < 50% or opponent mid-kick (I-5)`; naked shots ×0.4.
- W-2 `advance ×1.5; take centre; when opponent's back within 1.5 m of cage: clinchEntry ×1.8; shoot ×1.4`.
- W-3 `ground: groundStrike ×1.3 in guard/half (scores + opens passes, I-16); passGuard after 2 landed ground strikes ×1.4; control ≥ 3 min gap is the target (70% decision win, 87% at 5+ min; The Fight Algorithm)`.
- W-4 `if takedowns stuffed twice in a row: switch to clinch entries and cage chains (I-8, I-13) for 60 s before shooting again`.
- W-5 Pace: wrestlers win more in early rounds; "grapplers perform better in early rounds; risks in later rounds may not be advisable due to fatigue" (Fightnomics). Front-load takedown attempts: R1 ×1.2, R3 ×0.9 unless behind.

### 3.2 Wrestler vs BJJ player

**Historical pattern:** the wrestler wins by taking top position and *not* engaging the guard (posture, short GnP, stand up and re-enter, or ride from half-guard/side); the BJJ player wins by pulling guard or accepting bottom, attacking sweeps/submissions on the wrestler's posture-ups, or by wrestling-up to the back. Fightnomics: fighters "increasingly reluctant to engage in full guard due to submission risk"; RNC is ~49% of all fight-ending chokes (Stellpflug et al. 2022) — back-takes are the BJJ player's highest-value target.

Rules:
- WB-1 (wrestler) `if opponent BJJ ≥ own BJJ + 1 tier: on takedown landed prefer passGuard-by-strikes (I-16) and standUp-to-reset over sustained guard engagement; submission attempts ×0.3; never dive into guard after a knockdown; ride from half/side with wrist control`.
- WB-2 (wrestler) `if opponent pulls guard: prefer standUp + referee-stand-up loop or GnP from standing (posture); do not pass at all costs`.
- WB-3 (BJJ) `if taken down: sweep ×1.6 on top fighter's strike attempts (I-18); submission ×1.4 when top posture breaks; wallWalk ×0.8 (prefer to stay and attack) unless damage accumulation > 6 ground strikes landed in 30 s`.
- WB-4 (BJJ) `standing: accept clinch (clinchEntry ×1.3) to pull guard / trip / jump guard only if wrestling tier < opponent − 1; otherwise strike at range and hunt the front-headlock/guillotine on shots (I-7)`.

### 3.3 Pressure vs Counter

**Mechanics:** the pressure fighter wins by *cutting* the cage (lateral steps, not chasing), forcing exchanges on the fence, body work, and volume; the counter fighter wins by making the pressure fighter lead into delayed counters ("make 'em miss, make 'em pay") or intercepting counters (Slack's Three Initiatives: leads, delayed counters, simultaneous counters).

Rules:
- P-1 (pressure) `advance ×1.5 but only along the line that closes the opponent's circling side; if opponent circles left, step left (cut), not forward`. Implement cage-cutting as: target position = opponent position projected toward nearest wall, not opponent's current position.
- P-2 (pressure) `feints ×1.5 first (Dober: "feints first, angles second, centre-line third") to draw counters before committing`.
- P-3 (pressure) `when opponent within 1 m of cage: combination length +1; hook/bodyKick to the body ×1.4; clinchEntry ×1.3`.
- P-4 (counter) `retreat/circle ×1.4; lead strikes ×0.7; counter-window strikes (cross/hook on opponent's action recovery phase) ×1.8; check-hook and pivot when within 1.5 m of cage`.
- P-5 (counter) `if 3+ consecutive exchanges happen on the cage: switch to lead initiative (P-1 style) for 20 s to reset centre` — counter-only fighters lose rounds on activity/aggression tiebreakers.
- P-6 Judging feedback: aggression and cage control are *tiebreakers only* under 2025 ABC criteria (agentmma), so pure pressure without landed strikes does not win rounds; effective offence rules.

### 3.4 Volume vs Power

- V-1 (volume) `strike rate target ≥ 1.3× opponent; jab/teep/lowKick ×1.4; head-only targeting ×0.8 (mix body)`; exploit that the fighter who throws more wins across all weight classes (UFC PI Vol. 2) and total strikes landed is KPI #1 (Vol. 1).
- V-2 (volume) `exchange discipline: never trade in the pocket for > 2 s vs power puncher with KO tier ≥ own chin tier + 1; exit on angle`.
- V-3 (power) `feint ×1.4; counter windows ×1.5; single heavy shots (cross/hook/headKick) ×1.3; combination length ≤ 3; pace ×0.8 in R1 to conserve; body shots ×1.2 to slow volume fighter`.
- V-4 (power) Knockdown likelihood decreases across rounds and with fatigue (Fightnomics) — power fighters should front-load big-shot attempts in R1–R2 unless the plan is to drown the volume fighter late.

### 3.5 Southpaw vs Orthodox (open stance) — see Section 5 for stance rules.

### 3.6 Taller/longer vs shorter — see Section 4.

---

## 4. Physical-Advantage Exploitation Rules

Evidence first: body measurements are weak standalone predictors. Across 2,229 professional bouts only age (winners 0.82 y younger) separated winners and losers; armspan mattered only at heavyweight (198.4 vs 196.1 cm) and greater armspan:stature was a *disadvantage* at women's strawweight (Kirk 2024). Longer-reach fighters win 51.65% overall (agentmma, 1993–2021), but fighters giving up 7+ inches win only 37.4%, and at light heavyweight a 3+ inch edge wins 68%. Reach shifts *how* KOs happen (each cm raises hook odds 8% and straight odds 10% over overhands; Barley et al. 2025) more than *whether* they happen. Fightnomics: a 2.5+ inch reach advantage raises win rate "especially in striking-heavy fights", and reach matters at distance, not on the ground. Design: physical advantages should be modest global modifiers and large *conditional* modifiers that only pay when the fighter fights in the mode that uses them.

### 4.1 Reach / height

- R-1 `reachAdv = ownReach − oppReach (cm). If reachAdv ≥ 5: preferredRange = long; jab ×1.6; teep ×1.5; cross ×1.3; hook ×0.8; long guard posture available (block ×1.1, foul chance per 2.4); circleAway ×1.4 vs pressure; clinchEntry ×0.6`. Straight strikes "cannot be stepped inside if properly placed"; rounded strikes can (Slack, Point of a Spear).
- R-2 `if reachAdv ≥ 5 and opponent inside own optimal range: retreat-with-jab or pivot ×1.5 for 1–2 s, then re-establish; do not trade hooks at close range`.
- R-3 `if reachAdv ≤ −5 (shorter): feint ×1.5; slip/level-change entries ×1.6; body hook/uppercut on entry ×1.4; lowKick to the lead leg ×1.3; clinchEntry ×1.3; shoot off strikes ×1.2; constant lateral motion (Frazier/Tyson pattern) — never stand at the end of the long man's jab`. "Once an opponent is in his own punching range, and inside of yours, the advantage is gone" (Slack on Cerrone).
- R-4 `shorter fighter: draw the lead (delayed counter): retreat half-step to bait jab, then step-in cross/overhand ×1.5` (Hari vs Schilt cross-check-and-step pattern).
- R-5 Convert reach only when at distance: `reach modifier on hit chance applies only when range == long or mid; zero in clinch/ground`.
- R-6 Height without reach is not an advantage (Fightnomics); use `reach`, not `height`, for R-1..R-5; use height only for clinch leverage (heavier/taller gets +5% on clinch control) **ESTIMATE**.

### 4.2 Heavier / stronger (same division, weight differential on fight night)

- H-1 Rapid weight regain and fight-night weight differential predict victory: each 1% body-mass regained → +7% odds of victory in MMA; weight differential predicted KO/TKO wins in international MMA (Baribeau et al. 2023, n=708 MMA). A contrary study found no relation ("Worth the Weight?", Kirk 2020). Sim: fight-night mass differential of 3% → +5% clinch control and +5% takedown finish **ESTIMATE**, with strength-tier as the main driver.
- H-2 `if strengthAdv ≥ 1 tier: clinchEntry ×1.4; cage pin (I-11) ×1.5; lean-on-the-fence control accrues +stamina drain to opponent 1.5×; bodylock TD ×1.3; GnP damage ×1.15`.
- H-3 Wear-down plan: `pace ×0.9 in R1; clinch time target ≥ 60 s/round; in R3+ pressure ×1.3 when opponent stamina < 50%`.

### 4.3 Faster / lighter

- F-1 `if speedAdv ≥ 1 tier: in-and-out entries ×1.5 (advance→strike→retreat within 1.2 s); angles (circle) ×1.4; volume target ×1.3; clinch avoidance: breakClinch ×1.8 and never hold; hook exchange dwell ≤ 1 s`.
- F-2 `avoid being held: when clinched > 3 s with heavier opponent, prioritise breakClinch even at a strike cost; when on the cage, wall walk immediately (I-14 weight ×2)`.

### 4.4 Better cardio

- C-1 Push pace early, win late: `if cardioAdv ≥ 1 tier: strike rate ×1.2 in R1 (make opponent work), takedown attempts ×1.2 in R1 (force scrambles), pressure ×1.3 from R2, expect opponent's output to drop`. Evidence: standing low-intensity time falls in R3 (2:33 → 2:07 median; Miarka 2016); knockdown/submission success drops in later rounds (Fightnomics), so the cardio fighter's late advantage is mainly *volume and control*, not finishes.
- C-2 `if cardioAdv ≤ −1 tier: economy mode: strike rate ×0.8, single power shots ×1.2 early, minimise clinch and scrambles, avoid failed takedown attempts (each costs 2–3× the defender's stamina; ESTIMATE)`.

### 4.5 Age

- A-1 Winners are on average 0.82 years younger; the effect holds in 4/5 years sampled (Kirk 2024). Same fighters ten years on land fewer strikes and attempt fewer takedowns, and their success shifts toward head strikes landed and away from body-strike and submission attempts (dos Santos 2019). Sim: `age > 34: speed −1 sub-tier per 2 years ESTIMATE; recovery between rounds −5%/yr over 34 ESTIMATE; fight IQ/plan quality +`.

---

## 5. Stance-Matchup Rules

Data: orthodox 76.6%, southpaw 17.1%, switch 6.1% of 3,567 UFC fighters (agentmma). Southpaw vs orthodox UFC bouts went 34–34 (Pollet, Stulp & Groothuis 2013); career win% 64.0 vs 62.6 with no significant difference in 1,468 fighters (Baker & Schorer 2013); a 53.5% comparative-probability edge in 2,100 fighters' career records (Richardson & Gilman 2019). Any edge is a *familiarity* effect: southpaws facing orthodox fighters with limited southpaw experience perform "meaningfully above" the aggregate; those facing experienced opponents sit near 50% (agentmma). Fightnomics attributes it to orthodox fighters "reverting to instinctive circling patterns that play into the southpaw's advantage".

### 5.1 Open stance (orthodox vs southpaw)

- ST-1 **Lead-foot battle.** Each tick, whoever has their lead foot outside the opponent's lead foot has `dominantAngle = true`. Effects: `rearStraight hit chance +15%`, `rear kick to open side (liver/body) hit chance +15%`, opponent's `rearStraight −10%` **ESTIMATE**. Both fighters' `circle` toward the outside-foot side gets ×1.5; typical contest: orthodox steps left, southpaw steps right (fightencyclopedia; evolve-mma).
- ST-2 **Jabs collide.** `jab ×0.75 for both` ("lead hands deflect each other; the rear straight gains a clearer path"; fightencyclopedia). Lead-hand *fighting* (hand-trapping, parry-and-cross) replaces the jab: `parry→cross counter ×1.4`.
- ST-3 **Straight down the middle.** `cross ×1.4 (rear straight has the clearer lane)`; `rear bodyKick to the open side ×1.4` (the liver for a southpaw's left kick vs orthodox, the spleen side vice versa); `lead hook ×1.1 when dominant angle` (lead hook lands around the opponent's lead hand).
- ST-4 **Range.** Open-stance fights are "generally fought at longer range because the angles are less intuitive for inside work" (scienceinsights) → `preferredRange += 0.1 m` for both; clinch entries ×0.9.
- ST-5 **Familiarity penalty.** `if fighter.stanceExposure[opponentStance] < threshold (few fights vs that stance): defensive reaction time +10%, counter accuracy −10%, footwork errors (steps to wrong side) probability 15%/exchange` **ESTIMATE**. This is the actual "southpaw advantage": apply it to the orthodox fighter by default (less exposure), to neither when both are experienced.
- ST-6 **Lead-leg low kick / calf kick** targets the *outside* of the lead leg in open stance and is easy to land: `lowKick to lead leg ×1.3 with dominant angle` **ESTIMATE**.

### 5.2 Closed stance (same stance)

- ST-7 `jab ×1.2 (clear lane), lead hook ×1.1, rear lowKick to the inside/outside lead leg ×1.1, rear cross ×1.0, rear bodyKick ×0.9 (lands on the arm/closed side)`; no lead-foot battle; circling both directions equal; inside fighting more natural: `clinchEntry ×1.1`.

### 5.3 Stance switching

- ST-8 A `switch` fighter can toggle stance as an action costing ~0.3 s and 1% stamina **ESTIMATE**. Benefits: reset the lead-foot battle (`dominantAngle` recalculated), unlock rear-side weapons from the new side, force the opponent's familiarity penalty. Cost: during the switch tick, `defense = neutral`, takedown vulnerability +15% **ESTIMATE**, and a low kick landed on the switching leg has ×1.3 damage. Rule: `switchStance weight ×1.5 when opponent has landed 3+ strikes on the same side in the last 30 s, or when opponent's lead leg is damaged`.

---

## 6. Game-Plan Construction Procedure

Real camps build plans from film (opponent tendencies, entries, exits, what they do when hurt/tired), physical mismatches, and a short list of "musts and must-nots". Greg Jackson: study "fighters' strengths, weaknesses, and temperament to create tailor-made strategies"; "look at an opponent's tape and break down their habits and predict their next ten moves"; "sometimes things change in the fight, you have to have the ability to adjust to that"; uses OODA-loop framing (Jackson Wink / dynamicstriking / Bleacher Report). Zahabi's principles (recalled; not re-verified this session): hedge exchanges so the worst case is acceptable, "fight where the opponent is weakest and you are strongest", never gamble on low-percentage actions when ahead, wear opponents down by making them carry weight. Wittman's in-fight distillation: "Keep it simple… you are breaking him, but it's your jab that's going to break him… we don't need more than 4-punch combinations" (The Fight Site).

### 6.1 Inputs

```
Scouting report (per opponent):
  stance, reach, height, weight (fight-night), age, cardio tier, chin tier, KO power tier
  skill tiers: boxing, kicking, wrestling (off/def), clinch, BJJ (top/bottom), cage work
  tendencies (from film = replays of prior sim bouts or authored profiles):
    strike mix (jab/cross/hook/kick shares), average combo length, pace by round
    takedown attempt rate, setups used (naked / off strikes / off clinch), success by type
    reaction to pressure (circles left/right, backs to cage, clinches)
    reaction when hurt (covers / shoots / clinches / runs), when tired (pace drop %)
    scoring habits (control-heavy? volume?), finish history by round
  familiarity: fights vs southpaws, vs wrestlers, vs pressure
Own profile: same fields
Fight context: rounds (3/5), cage size, judging regime
```

### 6.2 Plan structure (machine form)

```
plan = {
  primaryMode:   'distanceStriking' | 'pressureStriking' | 'wrestleControl' | 'clinchGrind' | 'counter' | 'submissionHunt',
  fallbackMode:  ...,                       // switched to by the adaptation loop
  rangeTarget:   'long' | 'mid' | 'short',  // from R-1/R-3
  actionWeights: Record<ActionKind, number>,// product of matchup rules (Sections 3–5)
  mustNots:      ['rearKickInRange', 'trade in pocket', 'engage guard', ...],
  roundPacing:   [{round, strikeRateTarget, tdAttemptTarget, riskAppetite}],
  triggers:      [{signal, threshold, adjustment}],  // Section 7
  cornerScript:  [...]                      // one or two cues per round
}
```

### 6.3 Procedure

1. Compute advantage vector: reach, speed, strength, cardio, chin, power, each skill delta (own − opp), stance pair.
2. Choose `primaryMode` = the mode with the largest (ownStrength × oppWeakness) product where the physical rules (Section 4) don't veto it. Ties → prefer the mode with the lower variance (decision-safe) for high-IQ planners; prefer the finishing mode for low-IQ or "go for broke" personalities.
3. Apply matchup multipliers (Sections 3–5) to `actionWeights`.
4. Add `mustNots` from the opponent's best weapons (e.g., opponent's kick-catch rate high → forbid rear kicks at mid range).
5. Set pacing by cardio delta and rounds (C-1/C-2), and by finish-probability profile: ~53% of finishes happen in R1, 30% R2, 15% R3 (fightsincage, n=4,643); heavyweights finish 73.5% of fights, women's strawweights 34.1% (UFC PI Vol. 1). Heavy-hitters plan for early finishes; light divisions plan for 15 minutes.
6. Set triggers (Section 7) with tier-dependent thresholds.
7. Corner script: one primary cue per round (technical), one motivational; the corner will overwrite it from live observations.

### 6.4 Plan quality by fight-IQ tier

| Tier | Scouting fidelity | Plan features | Failure modes |
|---|---|---|---|
| Novice (IQ 1) | Only obvious attributes (size, "he's a wrestler") | Single mode, no fallback, no mustNots, flat pacing | Fights opponent's fight; no adjustment; adrenaline-dump pacing (see 7.6) |
| Regional (IQ 2) | Attributes + 1–2 tendencies | Primary + fallback, 1–2 mustNots, pacing by round | Adapts only after a knockdown/takedown; abandons plan when hit |
| UFC-level (IQ 3) | Full tendency profile with noise ±20% | Full structure, 3–5 triggers, stance-aware | Slow trigger latency (60–90 s); over-commits to primary mode |
| Elite (IQ 4) | Full profile ±10%, plus opponent's *adjustment* tendencies | Multi-branch triggers, exploits known reactions (feints tuned to opponent's flinch) | Rare; occasionally over-thinks (passivity) |
| Generational (IQ 5) | As elite + in-fight discovery within 30 s | Plans for the opponent's plan; builds traps across rounds | — |

Noise model: scouted tendencies = true tendencies + N(0, σ) with σ = 30%/20%/12%/8%/5% by tier **ESTIMATE**.

---

## 7. In-Fight Adaptation Model

### 7.1 Signals (observed by fighter and corner)

- Exchange ledger per 30 s window: strikes landed/absorbed by family, hit rates per action, knockdowns, takedowns landed/stuffed, control seconds, clinch time, position changes, damage delta, stamina delta.
- Opponent-state estimates: is hurt (accuracy/tempo drop, defensive-only actions), is tired (pace drop > 20%, mouth-open animation trigger), is cut, has damaged lead leg.
- Round score estimate (see 7.4).

### 7.2 Adjustment table (signal → adjustment)

| Signal (window) | Adjustment |
|---|---|
| Action family hit-rate < 25% over ≥ 6 attempts | weight ×0.6 on that family; +weight to feints and to the family with best hit-rate |
| Absorbed ≥ 2 heavy strikes from same technique | add defensive bias vs that technique (e.g., raise guard side, check kicks); counter-window weight ×1.3 |
| Takedown stuffed ×2 in a row | W-4 (switch to clinch/cage chains for 60 s); or if striker, S-1 confidence +: rear kicks ×1.2 |
| Taken down ×2 | S-3 stand-up urgency ×2; stop kicking; jab/teep ×1.3; move away from cage; if plan was striking, switch `primaryMode` → `counter` at long range |
| Opponent tired (pace −20%) | pressure ×1.3; combination length +1; clinch grind ×1.2 if strength ≥; takedown attempts ×1.2 (tired fighters defend TDs poorly) |
| Opponent hurt | see 7.5 finisher logic |
| Own stamina < 40% in R1/R2 | economy mode (C-2); clinch to rest if strength ≥ opponent; reduce kicks; conserve for the round's last 60 s (judges' recency) |
| Behind on estimated score entering final round | see 7.4 |
| Cut over the eye / eye poke | accuracy −10–20%; retreat weight ×1.2 for 20 s; corner instruction "get inside" for the fighter whose vision is impaired on the lead side |

### 7.3 Adaptation rate by tier

Decision cadence: fighters re-evaluate in *bursts* — after being hurt, after a takedown, and at round breaks — not continuously. Model an evaluation every `T_eval` seconds plus event-triggered evaluations, with a probability of actually changing behaviour when the signal exceeds threshold.

| Tier | T_eval | Event-triggered eval | P(change | signal) | Min dwell before revert |
|---|---|---|---|---|
| IQ 1 | never mid-round; corner only | knockdown only | 0.3 | — |
| IQ 2 | 90 s | knockdown, takedown | 0.5 | 45 s |
| IQ 3 | 60 s | + stuffed TD ×2, hurt | 0.7 | 30 s |
| IQ 4 | 30 s | + hit-rate collapse | 0.85 | 20 s |
| IQ 5 | 20 s | + opponent's adjustment detected | 0.95 | 15 s |

All **ESTIMATE**. Damage and fatigue degrade the tier: `effectiveIQ = IQ − 1 if damage > 60% or stamina < 30%`; a knockdown drops effectiveIQ by 1 for 20 s (composure model).

Empirical anchors: fight-level tactics in UFC data shift year by year but the *victory factors* didn't change (Frontiers AI 2019), which supports keeping the evaluation function fixed and only the policy adapting. Fighters with higher rank are more successful at "positional improvements" (Miarka 2016), i.e., they convert signals into position changes.

### 7.4 Score awareness

Evidence:
- Under open scoring (UFC 2016–2023 proxy: unanimous 20–18 vs split cards), fighters *ahead* did not coast; fighters *behind* attempted and landed fewer takedowns and submissions, with no change in strike volume — they shift toward the stand-up KO (Gift 2025, "Outcome certainty in MMA", SAGE). KO/TKOs are three times more likely to start from standing than from the ground.
- Open scoring in a small sample raised finishes by the fighter behind after R1 from 28.5% to 40% (6/15; Bloody Elbow 2021) — directionally, knowing you're behind increases finish-seeking.
- Only ~15% of finishes occur in R3 (fightsincage), so a fighter behind in R3 mostly wins by *stealing the round* on volume, not by finishing; and the rules reward it: total strikes landed is KPI #1 and a strike-count-only model predicts judges' round winners at 77.8% (multi-factor 83.3%) (agentmma / JSA).
- 10–8 rounds are 8% of judge-round observations (2016–2019), so a fighter down two rounds cannot realistically expect a 10–8 to save them; the rational behaviour when down 0–2 is finish-seeking, when down 1–1 it is round-stealing.

Rules:
- SC-1 Each fighter keeps `perceivedScore` = true score + N(0, σ_tier) with σ = 1.0/0.7/0.5/0.3/0.2 rounds **ESTIMATE**; corner reduces σ by 50% at the break (corners see the fight better but are still often wrong).
- SC-2 `if perceivedScore says down 1 round entering final round: strikeRate ×1.25; takedown ×0.8 (matches Gift); riskAppetite +1; keep volume in last 60 s ×1.3` (judges' recency; recalled convention, not sourced).
- SC-3 `if down 2 rounds (3-round fight) or 3 in 5-round: finish-seeking: power strikes ×1.5, takedown ×0.6 (unless submission tier ≥ opp bottom tier + 2, then takedown ×1.3 and submission ×1.6), defensive weights ×0.7, accept exchanges`.
- SC-4 `if ahead: no coasting (data), but risk appetite −1: takedown-to-control ×1.2 if wrestler, counter mode ×1.2 if striker, shorter combos, avoid the cage`. Low-IQ fighters ignore SC-4 and keep fighting the same way (which is what the data shows on average).

### 7.5 Damage awareness

Hurt fighter (recalled coaching consensus; behaviours are the standard ones seen on film):
- D-1 `on hurt (damage spike or knockdown): choose among {clinch, shoot, coverUp, run/circle} by tiers: wrestler → shoot/clinch ×2; striker with good footwork → circle-away ×2; low-IQ → coverUp on the cage ×2 (worst option; ground/cage pins follow); elite → clinch or level-change immediately (buys time; also the lowest KO-continuation risk)`. Behaviour lasts 10–20 s with `effectiveIQ −1`.
- D-2 Recovery: KO risk after a knockdown decays over ~20–30 s if not hit again **ESTIMATE**; clinch time and ground time count as recovery.

Finisher's choice:
- D-3 `on opponentHurt: reckless (IQ ≤ 2 or personality 'killer'): swing ×2, defence ×0.5, stamina drain ×2 — succeeds more often vs low-tier chins, gasses and gets countered vs high-tier`. `measured (IQ ≥ 3): straight punches and knees ×1.5, keep balance ≥ 60%, cut the cage, take the back/mount if the opponent shoots or covers; stop when hit-rate on the hurt fighter falls below 40% over 8 attempts`.
- D-4 Ground finish preference: when a hurt opponent falls, wrestlers should ride and GnP (referee stoppage), strikers should stand and strike or GnP from a posture that permits standing back up; never dive into the guard of a BJJ specialist who is only slightly hurt (WB-1).

### 7.6 Composure and the adrenaline dump

- The classic pattern: a nervous or inexperienced fighter starts at an unsustainable pace, gasses at ~2–3 minutes, and has a large output drop in R2. Empirically, elite boxers given false feedback between rounds did not change pacing (Halperin 2019) — high-tier fighters pace by internal cues, not by the corner. Model: `composure ∈ [0,1]`; low composure → R1 pace ×1.3 and stamina drain ×1.4 for the first 120 s, then output ×0.7 in R2 **ESTIMATE**. Composure rises with experience tier and falls with layoff, hostile-crowd and championship-round context.
- Standing "preparatory" (low-intensity) time is shorter in rounds that end early by KO (95.6 s vs 144–160 s in bouts that reach R3; Antoniettô 2023): fights that end early are fights where someone committed early. Use as a design anchor for the trade-off between pace and finish probability.

### 7.7 Corner advice model

What corners do (five functions from a microethnographic study of a Muay Thai bout: *diagnosis, strategy, implementation, affirmation, consolidation*; Hjortborg, Downey & Sutton 2026) and what good corners actually say (Wittman: one or two simple cues, framed positively, tied to what is already working — "it's your jab that's going to break him"; Jackson: adjust when things change; both emphasise simplicity).

Model:
- CO-1 At each break the corner emits ≤ 2 cues chosen from the adjustment table (7.2) using the *corner's* observation (σ halved vs the fighter's), plus a score estimate. Cue quality by corner tier: probability the cue is the *right* adjustment = 0.4/0.55/0.7/0.85/0.95 **ESTIMATE**.
- CO-2 Fighter uptake probability = f(fighter IQ, composure, damage): 0.5 base, +0.1 per IQ tier above 2, −0.2 if damage > 60%, −0.1 if the cue contradicts the fighter's primary mode. If accepted, the cue rewrites `actionWeights` for the next round and resets the dwell timer.
- CO-3 Corner also sets round-level `riskAppetite` from perceived score (SC-2/3/4) and can call "you need a finish" only when its σ-adjusted estimate supports it; low-tier corners are more often wrong about the score.
- CO-4 Motivational cues: modelled as a composure +0.1 bump (affirmation function), no technical change.

### 7.8 Why game plans fail (catalogue for the sim's failure modes)

1. Scouting was wrong (opponent changed camp/stance/weight) → tendencies noise.
2. Plan required a physical attribute the fighter lost to a weight cut (cardio) → plan collapses at R2.
3. Plan was right but the fighter abandoned it when hurt (composure/IQ).
4. Plan had no fallback for the opponent's counter-adjustment (IQ ≤ 3).
5. Plan was too safe: winning rounds but not damaging → loses on a late finish or a bad card (Jackson's "safety-first" critique on Deadspin).
6. Plan required the fence and the fight was in a 30-ft cage / opponent's footwork denied it.

---

## 8. Skill-Tier Fight-IQ Behaviours

| Behaviour | IQ 1 (novice) | IQ 2 (regional) | IQ 3 (UFC) | IQ 4 (elite) | IQ 5 (generational) |
|---|---|---|---|---|---|
| Range management | Stands at the end of the opponent's reach | Knows own range, forgets it when pressured | Fights at planned range most of the time | Manipulates range with feints | Controls range and the opponent's perception of it |
| Level-change hygiene | Kicks with the rear leg vs wrestlers | Same, after being taken down stops kicking | Follows S-1 | Uses kicks as bait for counters (I-6) | — |
| Cage awareness | Backs straight up | Circles, but wrong way vs southpaw | Circles correctly, still gets caught | Rarely on the fence; escapes on angles | Uses the fence offensively |
| Takedown setup | Naked shots | Shoots off a single strike | Off combinations | Off feints and reactions | Off the opponent's tendencies |
| Getting up | Turtles / covers | Wall walk late | Wall walk immediately | Never lets the top fighter settle | Stand-up leads into offence |
| Score awareness | None | Corner-driven only | Own estimate, σ 0.5 | σ 0.3, adjusts last 60 s | σ 0.2, plans rounds |
| Hurt behaviour | Cover on fence | Clinch | Clinch/shoot | Clinch or angle out | Counters while hurt |
| Finisher | Reckless | Reckless | Measured vs good chins | Measured | Traps |
| Corner uptake | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 |
| Adaptation latency | Round breaks only | 90 s | 60 s | 30 s | 20 s |

All tier numbers are **ESTIMATE**; the direction is anchored in the tendencies data (winners take more, better-set-up takedowns; make more positional improvements; higher-ranked fighters land more precise offence).

---

## 9. Data Tables with Sources

### 9.1 Outcome and tactical statistics

| Statistic | Value | Source |
|---|---|---|
| UFC bouts with any sig. ground strike landed → win probability | 77–79% | Frontiers AI 2019, n=2,831 (https://pmc.ncbi.nlm.nih.gov/articles/PMC7861226/) |
| RIPPER rule model accuracy (win/loss) | 75.2% test | same |
| Winners vs losers takedown density (median) | 0.0667 vs 0.000 TD/min | Kirk et al. 2026, 8,461 UFC bouts (https://pmc.ncbi.nlm.nih.gov/articles/PMC13523191/) |
| Winners vs losers takedown success | 50.0% vs 20.0% | same |
| Control time per successful takedown (winners vs losers) | 99.75 s vs 78.88 s | same |
| Men's takedown density trend | β = −0.00426 TD·min⁻¹·yr⁻¹, r = −0.753 | same |
| Highest takedown density division (median) | Flyweight 0.067/min; HW/LHW lowest (P50 = 0) | same |
| League avg takedown attempts / success | 1.5 per round; 39% | Fightnomics (Kuhn 2013) via summary (https://cdn.bookey.app/files/pdf/book/en/fightnomics.pdf) |
| Submission attempts / success | 1–2 per bout; 20% | Fightnomics |
| Clinch share of fight time | ~18% | Fightnomics |
| Strikes targeted at head | ~80% | Fightnomics |
| Winners vs losers (645 paired rounds) | winners: more total strikes, submissions, positional improvements in all rounds | Miarka et al. 2016 (https://pubmed.ncbi.nlm.nih.gov/26670995/) |
| Standing low-intensity time by round (median) | R1 2:33.5, R2 2:37, R3 2:07 | same |
| Standing preparatory time, bouts ending in R1 vs reaching R3 | 95.6 s vs 144–160 s | Antoniettô et al. 2023 (https://pubmed.ncbi.nlm.nih.gov/30694967/) |
| Decisions won by fighter with more control time | 68.2% (n=3,850) | The Fight Algorithm (https://thefightalgorithm.com/articles/the-invisible-round) |
| by control-time gap: 0–1 / 1–3 / 3–5 / 5+ min | 51.0% / 57.2% / 70.3% / 87.4% | same |
| Sig. strikes when controller loses (controller vs opp.) | 49.1 vs 69.6 | same |
| Ground strikes per control minute (Khabib / Covington / median) | 4.0 / 0.9 / ~2.0 | same |
| Decision winners with both more sig. strikes AND more control | 44.2% | Medium UFC data report (https://medium.com/@eduardocbjacob/ufc-data-report-309eaaf94fa3) |
| 10–8 rounds share (2016–2019) | 8% of 5,976 judge-rounds | JSA-200478 via agentmma (https://agentmma.com/mma-lab/ufc-round-judging-criteria) |
| Round-winner prediction from strike counts alone / multi-factor | 77.8% / 83.3% | same |
| Finishes by round (all UFC finishes) | R1 52.9%, R2 30.4%, R3 14.9% (n=4,643) | fightsincage via Brave snippet; grapplerhq: 52.7% R1 of 8,591 bouts |
| Overall finish rate (UFC history) | 51.9% finish; 46.8% decision | grapplerhq.com/mma/ufc-statistics/ |
| Fights reaching R3 (3-round) | 53% | FightTracker (https://arxiv.org/abs/2312.11067) |
| Trailing fighters under score certainty | fewer TD attempts and landed, fewer sub attempts; strike volume unchanged; leaders don't coast | Gift 2025 (https://journals.sagepub.com/doi/10.1177/22150218251346419; summary https://combatsportslaw.com/2025/06/20/study-mma-fighters-dont-coast-to-victory-when-knowing-theyre-ahead) |
| KO/TKO initiated standing vs ground | 3× more likely standing | same |
| Finishes by fighter behind after R1, closed vs open scoring | 28.5% → 40% (6/15) | Bloody Elbow 2021 (https://bloodyelbow.com/2021/2/25/22300662) |
| Fight-ending chokes | 904 = 15.5% of outcomes, 76.2% of subs; RNC 49.1%; 11% LOC | Stellpflug et al. 2022 (https://pubmed.ncbi.nlm.nih.gov/33347362/) |
| Distance head strikes, KO-ending vs sub-ending rounds | 13 (6–25) vs 9 (4–18) | Miarka et al. 2022 (https://pubmed.ncbi.nlm.nih.gov/36119707/) |

### 9.2 UFC Performance Institute reports

Vol. 1 (2018), "A Cross-Sectional Performance Analysis and Projection of the UFC Athlete", PDF: http://media.ufc.tv/ufcpi/UFCPI_Book_2018.pdf (TLS certificate expired; fetch with certificate check disabled). Vol. 2 (2021), 484 pp, 2017–2019 data, journal site https://ufc-pi.webflow.io/ (announcement: https://www.ufc.com/news/ufc-performance-institute-publishes-pivotal-follow-groundbreaking-mma-study-read; ESPN summary https://www.espn.com/mma/story/_/id/31388286/ufc-outlines-first-official-concussion-protocol-part-484-page-study).

| Statistic | Value | Source |
|---|---|---|
| Average fight duration 2002 → 2016 | 8:06 → 10:54 | Vol. 1 Fig 1.1 |
| Duration by class | HW 8.02 min → WSW 12.35 min (near-linear) | Vol. 1 Fig 1.2 |
| KO/TKO share 2002 → 2017 | 54.7% → 31.9%; decisions 50.3% in 2016 | Vol. 1 Fig 1.3 |
| HW KO/TKO / decision | 60.1% / 26.5% | Vol. 1 |
| FLW KO/TKO / decision | 20.5% / 60.3% | Vol. 1 |
| WSW KO/TKO | 7.1%; finish rate 34.1% vs HW 73.5% | Vol. 1 Fig 1.5 |
| Stoppages by punches (all / HW / LHW / WSW) | 45% / 67.4% / 56.7% / 13.8% | Vol. 1 Table 1.1 |
| Elbows / knees share of stoppages | 2–5% (WBW 15.8%) / 3–7% | Vol. 1 Table 1.1 |
| RNC share of submission finishes | 48.9% (guillotine 25.3%) | Vol. 1 |
| Strikes attempted per minute 2002 → 2017 | 4.25 → 8.5 | Vol. 1 Fig 1.6 |
| HW strikes/min | 6.72 (lowest) | Vol. 1 |
| KPI #1 both sexes | Total strikes landed | Vol. 1 Table 1.3 |
| Takedown success rank (women / men) | 3rd / 19th | Vol. 1 Table 1.3 |
| Sig. strikes landed rank (men / women) | 5th / 10th | Vol. 1 Table 1.3 |
| Injury duration, takedowns/ground | longest of all mechanisms (~112–120 days avg) | Vol. 1 Ch. 2 |
| Fighter throwing more strikes wins | in every weight class | Vol. 2 via ESPN |
| 25-ft vs 30-ft cage | +5% KOs, +8% subs; decisions 39% vs 51% | Vol. 2 via ESPN |

### 9.3 Physical attributes and stance

| Statistic | Value | Source |
|---|---|---|
| Winners younger | 29.8 vs 30.7 y; relative −0.82 y | Kirk 2024, n=2,229 (https://pubmed.ncbi.nlm.nih.gov/37826856/) |
| Armspan effect | HW only (198.4 vs 196.1 cm); A:S disadvantage in WSW; no effect on method | same |
| Longer-reach fighter win rate (1993–2021) | 51.65% | agentmma (https://agentmma.com/mma-lab/ufc-reach-advantage) |
| Giving up 7+ in reach | 37.4% win | same |
| 3+ in reach at LHW | 68% win | same |
| Reach and finishing punch type | +8% hook odds, +10% straight odds per cm over overhands; 1.6–2.0% variance; n=264 | Barley et al. 2025 (https://journals.sagepub.com/doi/10.1177/17479541251338509) |
| Reach 2.5+ in advantage | higher win rate in striking-heavy fights | Fightnomics |
| Reach/height advantage vs age advantage (forum model) | 53% vs 70% | Sherdog forum analysis (https://forums.sherdog.com/threads/a-nerdy-boring-statistical-analysis-of-reach-advantage-age-and-win-probability-part-ii.3544497/) — non-peer-reviewed |
| RWG and victory | +7% odds per 1% body mass regained (MMA); WD predicts KO wins | Baribeau et al. 2023 (https://pubmed.ncbi.nlm.nih.gov/36473482/); contra Kirk 2020 (https://pubmed.ncbi.nlm.nih.gov/32663387/) |
| Stance prevalence (UFC) | orthodox 76.6%, southpaw 17.1%, switch 6.1% | agentmma (https://agentmma.com/mma-lab/ufc-southpaw-vs-orthodox-advantage) |
| SP vs OR head-to-head | 34–34 (68 bouts) | Pollet, Stulp & Groothuis 2013, via agentmma |
| Career win% SP vs OR | 64.0% vs 62.6%, n.s.; southpaws have more fights | Baker & Schorer 2013 (https://pubmed.ncbi.nlm.nih.gov/24260301/) |
| Left-oriented higher career win% probability | 53.5% (n=2,100) | Richardson & Gilman 2019, via agentmma |
| Opponent left-handedness and UFC HoF outcomes | no effect | Pollet & Riegman 2014 (https://pubmed.ncbi.nlm.nih.gov/24817857/) |

### 9.4 Gloves, fouls, coaching

| Statistic | Value | Source |
|---|---|---|
| Eye injuries, Nevada pro MMA 2001–2020 | 369 in 2,208 fights; 62.8% of injured lost | Fliotsos et al. 2021 (https://pubmed.ncbi.nlm.nih.gov/34211265/) |
| Glove design and eye pokes | Bellator < UFC, PFL (p=0.03, 0.02) | Combat Sports Law 2025 (https://combatsportslaw.com/2025/09/24/ringside-doctors-call-for-curved-finger-mma-glove-design-to-reduce-eye-pokes/) |
| False feedback between rounds, elite boxers | no change in force, pacing or RPE (≤2%) | Halperin et al. 2019 (https://pubmed.ncbi.nlm.nih.gov/29863966/) |
| Coaching functions in a bout | diagnosis, strategy, implementation, affirmation, consolidation | Hjortborg et al. 2026 (https://pubmed.ncbi.nlm.nih.gov/40874285/) |
| 10-year same-athlete change | fewer strikes landed/attempted, fewer TD attempts; head strikes landed most associated with success | dos Santos et al. 2019 (https://pubmed.ncbi.nlm.nih.gov/30160583/) |

### 9.5 Tactical writers (qualitative)

- Jack Slack, "On the Point of a Spear: The Game of Reach and Range" — https://www.vice.com/en/article/on-the-point-of-a-spear-the-game-of-reach-and-range/
- Jack Slack, "Ringcraft Companion: Mastering the Three Initiatives" — https://www.vice.com/en/article/ez3ygp/ringcraft-companion-mastering-the-three-initiatives
- Jack Slack, Ringcraft series hub (Fightland) — https://fightland.vice.com/ringcraft (dead host; episodes on YouTube: "The Three Initiatives" https://www.youtube.com/watch?v=eO11bqOrbTY)
- Jack Slack current writing — https://www.patreon.com/JackSlack
- The Fight Site, Khabib cage wrestling — https://www.thefight-site.com/home/ufc-254-khabib-nurmagomedov-cage-wrestling
- The Fight Site, Trevor Wittman — https://www.thefight-site.com/home/trevor-wittman-breakdown
- BJJ Scout, Khabib studies — https://www.youtube.com/bjjscout (video; not transcribed here)
- Drew Dober, Striking for MMA — https://drewdober.com/blog/striking/
- Evolve MMA, cage wall escapes — https://evolve-mma.com/blog/how-to-use-the-cage-wall-to-escape-takedowns-in-mma/
- Open-stance mechanics — https://fightencyclopedia.com/blog/blog-southpaw-stance-fighting; https://evolve-mma.com/blog/the-beginners-guide-on-boxing-as-a-southpaw/
- Greg Jackson quotes — https://bleacherreport.com/articles/386264; https://www.jacksonwink.com/news/greg-jacksons-legacy
- Lawrence Kenshin, Firas Zahabi, Eric Nicksick: video sources only; not fetched this session.

---

## 10. Sim Rules to Implement (numbered)

Engine-facing. Multipliers apply to action-selection weights unless stated. New actions/fields are flagged.

1. **Add `feint`, `switchStance`, `wallWalk`, `hitOnBreak` (chained strike on `breakClinch`), and `cageProximity` (metres to wall) to the engine.** Add `stance: 'orthodox'|'southpaw'`, `reachCm`, `fightIQ (1–5)`, `composure (0–1)`, `stanceExposure`.
2. **Takedown base success = 39%; modifiers: off-strike setup +10–15 pts (jab→double), +8–12 (cross→single), body lock from hook 45–55% finish; naked shot −10 pts; on cage +10 pts and chains continue for up to 20 s; kick-catch 45–55% when caught.** Winners in data convert 50%, losers 20% — skill delta should span that range.
3. **Each stuffed shot costs the shooter 2–3× the defender's stamina and grants the defender a 0.5 s free strike window (sprawl-and-brawl); go-behind 30–40%, guillotine threat 15–25%.**
4. **Ground strikes drive passing and scoring:** `passGuard +10–20 pts after ≥2 ground strikes in 5 s`; judges' round score adds control seconds only when `groundStrikes/min ≥ 1`; control gaps of 3 and 5 minutes map to 70% and 87% round-win odds in the decision model.
5. **Standing up:** `wallWalk` 40–60% per 5-s cycle when back is within 0.5 m of cage; open-mat technical stand-up 25–40%; top fighter's ride skill subtracts. A referee stand-up after 20–30 s of inactivity.
6. **Hit on the break:** the fighter initiating `breakClinch` may chain one short strike at +20–30% hit chance.
7. **Glove model:** `highGuard` block chance ×0.67 vs a boxing baseline; short inside strikes (hook/uppercut/elbow) KO coefficient ×1.2; long-guard posture adds 0.3–0.6%/s eye-poke foul risk with a 10–20% accuracy penalty for 60 s on the victim.
8. **Takedown-threat tax on striking:** vs an opponent with wrestling ≥ own TD defence: rear-leg kicks ×0.4, combos capped at 3, weight-back stance reduces punch power ×0.9 but raises sprawl success +10 pts.
9. **Reach rules R-1..R-6:** ≥5 cm → jab ×1.6, teep ×1.5, cross ×1.3, hook ×0.8, circle-away ×1.4, clinch ×0.6; ≤ −5 cm → feint ×1.5, slip/level entries ×1.6, body shots ×1.4, lead-leg kicks ×1.3, clinch ×1.3. Reach modifies hit chance at long/mid range only; global win-rate effect should calibrate to ~52% overall and ~63% at a 7+ inch gap.
10. **Age:** winners 0.8 y younger on average; > 34 y: speed −1 sub-tier per 2 years, recovery −5%/yr, IQ +.
11. **Open-stance rules ST-1..ST-6:** lead-foot dominance flag; jab ×0.75 both; cross ×1.4; rear body kick to open side ×1.4; lead-leg low kick ×1.3 with dominance; range +0.1 m; familiarity penalty (reaction +10%, counter accuracy −10%, wrong-way circle 15%) on the less-exposed fighter. Calibrate so SP-vs-OR is ~50/50 between equally experienced fighters and ~55/45 when the orthodox fighter is inexperienced vs southpaws.
12. **Closed stance ST-7; switching ST-8** (0.3 s, defence neutral during switch, TD vulnerability +15%, low-kick damage ×1.3 on the switching leg).
13. **Plan construction (Section 6.3) runs pre-bout** and yields `actionWeights`, `mustNots`, pacing and triggers; scouting noise σ = 30/20/12/8/5% by IQ tier.
14. **Adaptation loop (7.3):** periodic evaluation every 90/60/30/20 s (IQ 2–5; IQ 1 only at breaks) plus event triggers; P(change | signal) 0.3–0.95; minimum dwell 15–45 s; `effectiveIQ −1` when damage > 60% or stamina < 30% or within 20 s of a knockdown.
15. **Score awareness (7.4):** `perceivedScore` noise σ = 1.0/0.7/0.5/0.3/0.2 rounds; behind by 1 → volume ×1.25, TD ×0.8; behind by 2+ → power ×1.5, TD ×0.6 (unless sub specialist), defence ×0.7; ahead → no coasting, risk −1. Corners halve the noise at breaks.
16. **Damage awareness (7.5):** hurt behaviour chosen by style/IQ (shoot/clinch/circle/cover); cover-on-cage is the low-IQ default; finisher reckless vs measured by IQ with the stated multipliers; knockdown KO-risk decay 20–30 s.
17. **Composure/adrenaline dump (7.6):** low composure → R1 pace ×1.3 and drain ×1.4 for 120 s, then output ×0.7 in R2; composure improves with experience and is reduced by layoff/title-fight context.
18. **Corner model (7.7):** ≤ 2 cues per break; cue correctness 0.4–0.95 by corner tier; uptake 0.5 base ± IQ/damage/contradiction; affirmation adds +0.1 composure.
19. **Pacing priors:** finish-seeking weight by round = 0.53/0.30/0.15 of a fighter's finish budget; heavyweights' finish weights ×1.4, women's strawweight ×0.5; volume rises and low-intensity time falls in R3 (2:33 → 2:07 median standing low-intensity).
20. **Judging model coherence:** score rounds primarily on effective strikes landed (strike count alone reproduces judges 78%); control seconds are secondary and only with activity; aggression/cage control are tiebreakers; 10–8 in ~8% of rounds requiring damage or domination + minimal opposing offence.
21. **Cage size:** finish probability ×1.05 (KO) and ×1.08 (sub) and cage-cut success ×1.15 when `cageRadius` corresponds to a 25-ft cage vs 30-ft.
22. **Style-matchup weights (Section 3) are multiplicative and renormalised**; cap any single action weight at ×3 and floor at ×0.25 to avoid degenerate policies.

---

## 11. Assumptions and Gaps

- **No direct data on takedown success conditional on strike setup.** The +10–15 pt setup bonus is inferred from coaching consensus and the winners' 50% vs losers' 20% spread; a UFCStats event-sequence study would let this be calibrated.
- **Control-time and open-scoring analyses are from analyst sites and a single peer-reviewed paper (Gift 2025)** whose full text was paywalled; numbers are from its abstract and a legal-blog summary. "Steal the round" pacing (last-60-s volume bump) is convention, not measured.
- **Corner-advice content analysis does not exist in the literature found**; the corner model is built from one microethnography (Muay Thai), a null result on false feedback in elite boxers, and Wittman/Jackson quotes. Treat cue-correctness and uptake numbers as design parameters.
- **Southpaw effect:** peer-reviewed head-to-head data show no stance effect; the familiarity mechanism is inferred from the analyst literature (Fightnomics, agentmma). The sim's ST-5 penalty is the lever to reproduce the small observed career-record edge.
- **Reach:** peer-reviewed data (Kirk 2024) say morphology is "greatly overstated" outside heavyweight; analyst data show modest effects growing with the gap. The design keeps reach as a conditional modifier so both can be true.
- **UFC PI Vol. 2** could not be downloaded (site returned 404 for the journal path); its numbers here come from ESPN's summary. Vol. 1 was downloaded and read directly (Chapter 1 tables).
- **Jack Slack's open-stance and cage-cutting pieces** could not be fetched (Fightland host is dead; Vice search blocked); open-stance mechanics are cited from secondary coaching sites that restate the same principles. Lawrence Kenshin, BJJ Scout, Zahabi and Nicksick material is video-only and was not transcribed; Zahabi principles are marked as recalled.
- **Up-kick, hitting-on-the-break, sweep-on-strike and wall-walk success rates** have no quantitative source; all are ESTIMATE.
- **Decision cadence** (how often a fighter changes approach) has no published measurement; the 20–90 s evaluation intervals are design choices meant to reproduce visible behaviour (adjustments after knockdowns/takedowns and at breaks).
- **Judging regime:** rules above follow the 2025 ABC clarifications (damage first; control/aggression as tiebreakers). If the sim targets older eras (2000–2016), control time should weigh more, matching the 68% control-time decision rate.
