# Rules, Refereeing & Judging — Research for Bout Lab

Research date: 2026-09-22. Author: rules & judging research agent. Purpose: source-of-truth for `ruleset` definitions, referee logic and judge logic in the simulator. Nothing here is invented; where a figure is an inference or a design default rather than a rule, it is labelled **[ASSUMPTION]** or **[INFERRED]**. Where versions of a rule differ, the differences are listed.

Primary sources actually read for this document (full text, via PDF extraction or page fetch):

| ID | Source | URL |
|---|---|---|
| S1 | ABC *Unified Rules of Mixed Martial Arts* (rev. Aug 2026; incorporates the July 23, 2024 rule changes requested for Nov 2024 implementation) | https://www.abcboxing.com/wp-content/uploads/2026/08/Unified-Rules-of-MMA-8.2026.pdf |
| S2 | ABC *MMA Bout Scoring – Judging Criteria Clarification* (July 2025; committee incl. Foster, Dean, Goddard, McCarthy, Mullen, Ratner) | https://www.abcboxing.com/wp-content/uploads/2025/08/ABC-MMA-Scoring-Criteira-Clarification-7.2025.pdf |
| S3 | ABC *Unified Rules of Boxing* (amended to Aug 3, 2016) | https://www.abcboxing.com/unified-rules-boxing/ |
| S4 | ABC *Boxing Judge Manual* (rev. 06/2024) | https://www.abcboxing.com/wp-content/uploads/2025/10/ABC-BOXING-JUDGE-MANUAL.pdf |
| S5 | ABC *Boxing Referee Manual* (rev. 08/2025) | https://www.abcboxing.com/wp-content/uploads/2026/06/ABC-BOXING-REFEREE-MANUAL-rev8-2025.pdf |
| S6 | ABC *Unified Rules of Professional Muay Thai* (approved July 2024, impl. Nov 2024) | https://www.abcboxing.com/wp-content/uploads/2024/10/pro-muay-thai-unified-rules-rev2024.pdf |
| S7 | ABC *Unified Rules of Professional Kickboxing* | https://www.abcboxing.com/unified-rules-kickboxing/ |
| S8 | GLORY Kickboxing *Rules* (v2, as of March 16, 2026) | https://glory.pinkyellow.network/assets/rules/glory-rules-2026-v2.pdf (linked from https://glorykickboxing.com/rules) |
| S9 | IBJJF *Rule Book* v6.1 (June 2024) | https://ibjjf.com/books-videos (PDF `2024JUN_IBJJF_Rules_EN.pdf`) |
| S10 | ADCC *Rules & Regulations* (official site) | https://adcombat.com/adcc-rules-and-regulations/ |
| S11 | IJF *Sport and Organisation Rules – Refereeing Rules* (version 21.01.2026, 2025–2028 cycle) | https://www.ijf.org/documents → https://78884ca60822a34fb0e6-082b8fd5551e97bc65e327988b444396.ssl.cf3.rackcdn.com/up/2026/07/IJF_SOR_Refereeing_Rules_Versi-1784287698.pdf |
| S12 | UFC *Unified Rules* page (fouls list; glove note) | https://www.ufc.com/unified-rules-mixed-martial-arts |
| S13 | Wikipedia, *Unified Rules of MMA* / *MMA rules* (history dates; 4–6 oz glove note; ONE/PRIDE whole-fight scoring) | https://en.wikipedia.org/wiki/Unified_Rules_of_Mixed_Martial_Arts |
| S14 | Gift, P. (2018). *Performance Evaluation and Favoritism: Evidence From Mixed Martial Arts*. J. Sports Economics 19(8). DOI 10.1177/1527002517702422 (abstract via OpenAlex) | https://doi.org/10.1177/1527002517702422 |
| S15 | *Consistency of Judging Under the World Boxing 10-Point Must Scoring System…* Sports 14(9):403 (2026). DOI 10.3390/sports14090403 (abstract via OpenAlex) | https://doi.org/10.3390/sports14090403 |
| S16 | Collier, Johnson & Ruggiero (2011). *Aggression in MMA: An Analysis of the Likelihood of Winning a Decision*. In *Violence and Aggression in Sporting Contests* (Springer). DOI 10.1007/978-1-4419-6630-8_7 (abstract not retrievable; findings cited from memory, flagged) | https://doi.org/10.1007/978-1-4419-6630-8_7 |
| S17 | *Stubborn Scorecards: Belief Perseverance and Group Dynamics in MMA Judging* (SSRN 2025) DOI 10.2139/ssrn.5387214 (abstract not retrievable) | https://doi.org/10.2139/ssrn.5387214 |
| S18 | MMADecisions.com (judge database; "Minority Report", "10-10 Report") | https://mmadecisions.com/minority-report/ , https://mmadecisions.com/most-decisions-by-judge/ |
| S19 | Channon & Khomutova (2023). *Role Demands and Psychological Factors Underpinning Performance in MMA Refereeing*. Martial Arts Studies. DOI 10.18573/mas.174 | https://doi.org/10.18573/mas.174 |

Not retrievable in this session (web-search budget exhausted; sites 403/404): NSAC/CSAC state rule text, IFMA rulebook, WBC Muay Thai rulebook, WAKO/ISKA rulebooks, Thai stadium (Rajadamnern/Lumpinee) scoring guides, Big John McCarthy/Herb Dean interview transcripts, Fightnomics. Content for those is given from prior knowledge and clearly flagged **[UNVERIFIED]**.

---

## 1. Summary

* **MMA (Unified Rules, current).** 5-min rounds, 1-min rest, 3 or 5 rounds (max 25 min/day). The 2024 amendment (ABC vote July 23, 2024, requested implementation Nov 2024) **removed the "12-to-6" downward elbow foul entirely** and **redefined "grounded"**: a fighter is grounded (no knees/kicks to the head) only when *any part of the body other than the hands or feet* touches the canvas — so hands on the mat no longer count at all (pre-2017: one hand down = grounded; 2017–2024: both palms/fists down = grounded). Stomps to a grounded fighter remain illegal. 27-item foul list (S1). Intentional foul → mandatory 2-point deduction; fight-ending intentional foul → DQ. Accidental fight-ending foul → **No Contest** if before end of R2 (of 3) / R3 (of 5), otherwise **Technical Decision** on cards (partial round scored). Groin/eye poke → up to 5 min recovery. Judging: 10-point must, **Plan A/B/C** priority (effective striking/grappling → aggressiveness → area control; B and C only if A is *even*), with **Damage > Dominance > Duration** as the effectiveness constructs. **10-8 requires *significant damage* (or significant domination + some damage + near-zero offence from the loser); positional control alone is never a 10-8.** 10-10 in a completed round is "a failure to adjudicate" (S2). No scoring for defence.
* **Boxing (ABC unified).** 3-min rounds; mandatory 8 count; **no standing 8, no three-knockdown rule, no saved-by-the-bell**; 20-second count if knocked out of the ring. Judge manual: 10-9 routine; **10-8 = one KD or extremely decisive**; **10-7 = two KDs or dominant + ≥1 KD**; 10-6 = >2 KDs. Score the *whole* round — a KD can be 10-9 if the downed boxer decisively wins the rest. Accidental foul: No Decision before 4 completed rounds, Technical Decision after. Intentional foul: mandatory 2 points; injury later stops fight → TD/Technical Draw. Low blow: 5 minutes. Towel cannot stop a US pro bout (chief second → inspector → referee).
* **Kickboxing (ABC pro / GLORY).** 3×3 (5×3 titles), 8 oz <65 kg / 10 oz otherwise (GLORY). No elbows, no sweeps/throws/pushing, clinch only for one immediate knee then release (ABC: referee may allow ≤5 s of effective knees). GLORY has a **standing 8 count** and a **3 KD/round or 4 KD/fight** TKO rule (2/3 in tournaments); ABC pro KB: 3 KD in a round by head strikes = TKO. GLORY scoring: KD wins the round; 10-8 = KD or high-impact damage + domination; 10-7 = two KDs; "Sudden Victory" extra round on draws (judges cannot score it even).
* **Muay Thai (ABC pro).** 3×3 or 5×3, 1-min rest; punches/kicks/elbows/knees legal; kicking an opponent off the feet legal but **trips/sweeps with the side of the foot, hip/shoulder/leg throws, reaping and lifting are fouls**; catching a kick and taking >2 steps without striking is a foul. Mandatory 8, no standing 8, no saved-by-bell. Judging priority: **KD advantage never loses the round → cumulative damage → number/variety of clean Muay Thai techniques → aggression/control/effective defence.** 10-8 = overwhelming or KD; 10-7 = two KDs; **10-6 = three KDs**. Thai stadium culture (rounds 3–4 decisive, balance/"ruup") is **[UNVERIFIED]** and given as a culture preset.
* **Grappling.** IBJJF: 2 (takedown/sweep/knee-on-belly), 3 (pass), 4 (mount/back) after **3 s stabilisation**; advantages; 4-step penalty ladder (mark → advantage → 2 pts → DQ); 20-s stalling clock; 5/6/7/8/10-min adult matches by belt; heel hooks and knee reaping legal only in adult brown/black no-gi. ADCC: qualifiers 10 min (first 5 no points), finals 20 min (first 10 no positive points); pass 3, mount 2, back 3, KOB 2, takedown/sweep 2 (4 if past guard); **−1 for guard pulling, passivity, fleeing**; overtime; referee decision on dominance; slams only from a submission; 2-min recovery on accidental eye/groin.
* **Judo (IJF 2025–28).** 4 min + unlimited golden score; **yuko reinstated** (5–9 s osaekomi / side landing), waza-ari 10–19 s, ippon 20 s; two waza-ari = ippon; yuko never accumulates; 3rd shido = hansoku-make; leg grabbing is **shido** (not direct HM) in this cycle; head-diving, kani-basami, do-jime, ashi-garami, standing joint locks etc. are direct hansoku-make; 45-s attack clock after kumi-kata.
* **Judging in practice.** Gift (2018): judges biased toward larger betting favourites, fighters with insurmountable leads and the previous round's winner; no titleholder bias. World Boxing 2025: 98.2% of judge-round scores were 10-9, single-judge reliability ≈0.62–0.69, five-judge panel ≈0.89–0.92, 68.9% of decisions 5:0. MMADecisions: busiest UFC judge dissents in ≈5.6% of his 1,421 decisions → implied split-decision share ≈17–20% **[INFERRED]**.
* **Street mode** has no referee: bouts end on incapacitation, flight, surrender, third-party separation or weapon introduction; every "foul" is legal; hard-surface falls are the dominant injury mechanism; depict with restraint.

---

## 2. Ruleset definitions

### 2.1 Master table

Legend: ✓ legal · ✗ illegal · ◐ restricted (see notes). "Grounded" = ruleset's own definition.

| Ruleset | Rounds × min (rest) | Punch head/body | Kick head/body/leg | Knee head/body | Elbow | Ground strikes | Strikes to grounded opp. | Clinch limit | Throws / TD | Submissions | Win conditions | Scoring |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **MMA-unified** (S1) | 3×5 or 5×5 (1:00); 1–5 rounds allowed; ≤25 min/24 h | ✓/✓ | ✓/✓/✓ | ✓/✓ standing; head-knee ✗ if opp. grounded | ✓ any angle incl. 12-6 (since Nov 2024) | ✓ punches, elbows, hammerfists; knees/kicks to body ✓ | ✗ knees/kicks to head; ✗ stomps; ✗ spine/back-of-head | none (ref breaks on inactivity) | ✓ any arcing throw; ✗ pile-driver spike | ✓ all (✗ small-joint, ✗ trachea grab, ✗ fish-hook) | KO, TKO (ref/doctor/corner/didn't answer bell/bodily function), submission (tap/verbal/technical), decision (U/S/M), tech. decision, DQ, NC, draws | 10-pt must, Plan A/B/C |
| **MMA-3R** | 3×5 (1:00) | as above | | | | | | | | | as above; NC threshold = 2 completed rounds | as above |
| **MMA-5R** | 5×5 (1:00) | as above | | | | | | | | | NC threshold = 3 completed rounds | as above |
| **Boxing** (S3–S5) | 4–12×3 (1:00) | ✓/✓ (closed fist, front of glove) | ✗ | ✗ | ✗ | ✗ | ✗ (downed boxer may not be hit) | ref breaks; holding = foul | ✗ | ✗ | KO (10 count), TKO (ref/doctor/corner via inspector), decision, TD, tech. draw, DQ, No Decision | 10-pt must, KD-driven |
| **Kickboxing-GLORY** (S8) / ABC pro KB (S7) | 3×3, 5×3 titles (1:00; 1:30 before extra rounds) | ✓/✓ + spinning backfist | ✓/✓/✓ (leg only with arcing kicks; ✗ linear kicks to legs) | ✓/✓ | ✗ | ✗ | ✗ | one legal knee then release (ABC: ≤5 s if effective) | ✗ throws/sweeps/pushing | ✗ | KO, TKO (incl. 3 KD/round or 4 KD/fight; tournament 2/3), decision, extra-round "Sudden Victory", DQ, NC | 10-pt must, KD first |
| **Muay Thai** (S6) | 3×3 or 5×3 (1:00) | ✓/✓ | ✓/✓/✓ | ✓/✓ | ✓ | ✗ | ✗ | not timed in S6; ref breaks inactive clinch **[ASSUMPTION ~5 s inactive]** | ◐ kick-off-feet ✓; ✗ trips/sweeps with side of foot, hip/shoulder/leg throws, reaps, lifts; ✗ pile-drive | ✗ (no locks) | KO (10 count), TKO (ref/corner/outmatched/medical), decision, TD, tech. draw, DQ, NC/No Decision | 10-pt must, KD→damage→technique |
| **Grappling-IBJJF** (S9) | 1 × 5/6/7/8/10 min (white/blue/purple/brown/black adult); no rest | ✗ | ✗ | ✗ | ✗ | ✗ | – | – | ✓ (✗ slam, ✗ scissor TD, ✗ suplex on head/neck) | ◐ by belt (2.5) | submission, points, advantages, penalties, referee decision, DQ | positions 2/3/4 + advantages |
| **Grappling-ADCC** (S10) | 1 × 10 (5+5) qualifiers; 20 (10+10) finals; OT 5/10; trials 6 (3+3) / 8 (4+4) | ✗ | ✗ | ✗ | ✗ | ✗ | – | – | ✓; slam only from inside a submission | ✓ nearly all (✗ full nelson, crucifix, chin-twist neck cranks, both-shoulder downward neck cranks, windpipe hand choke) | submission, points, referee decision, DQ | points 2/3/4, −1 penalties |
| **Judo-IJF** (S11) | 1 × 4 min + golden score (no limit) | ✗ | ✗ | ✗ | ✗ | ✗ | – | 45-s attack clock after grips | ✓ (✗ leg grabs = shido; ✗ head dive, kani-basami, kawazu-gake = HM) | ◐ arm locks (elbow only) + chokes, only in ne-waza; ✗ do-jime, ashi-garami | ippon, 2×waza-ari, 3 shido→HM, golden score (any score), kiken-gachi | ippon/waza-ari/yuko |
| **Street** (§2.6) | none | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (all targets) | none | ✓ incl. spikes/slams on hard surface | ✓ all incl. small joints, eye, throat | incapacitation, flight, surrender, separation, weapon, arrival of others | none (survival/objective) |

### 2.2 MMA — Unified Rules detail (S1, S2, S12, S13)

**Version history (dates from S1 header and S13):** approved NJ April 3, 2001; adopted by ABC July 30, 2009; amended 2010; Aug 3, 2016 (new judging criteria, grounded definition, "extended fingers" foul, female attire — implemented Jan 1, 2017); procedures 2017, 2018, 2019, 2023; **rule changes July 23, 2024 (requested implementation Nov 2024)**; non-substantial changes July 1, 2025; **rule changes Aug 5, 2026 (requested implementation Nov 2027)** — the 2026 PDF marks new text in blue, which text extraction cannot show; the "Standing up or Breaking Fighters" paragraph and the rewritten foul #9 (fingers outstretched) are the likely 2026 additions **[INFERRED]**.

**Rounds:** "Each round shall consist of a five (5) minute duration (professional), with a one (1) minute rest period… No contests shall exceed five (5) rounds and/or twenty-five (25) minutes… Bouts may consist of one, two, three, four, or five rounds." A bout halted for non-combat reasons goes to the cards only if 2 of 3 / 3 of 5 rounds are complete.

**Weight classes (S1; kg conversions computed at 0.45359):**

| Class | Upper limit lb | kg |
|---|---|---|
| Atomweight | 105 | 47.6 |
| Strawweight | 115 | 52.2 |
| Flyweight | 125 | 56.7 |
| Bantamweight | 135 | 61.2 |
| Featherweight | 145 | 65.8 |
| Lightweight | 155 | 70.3 |
| Super Lightweight | 165 | 74.8 |
| Welterweight | 170 | 77.1 |
| Super Welterweight | 175 | 79.4 |
| Middleweight | 185 | 83.9 |
| Super Middleweight | 195 | 88.5 |
| Light Heavyweight | 205 | 93.0 |
| Cruiserweight | 225 | 102.1 |
| Heavyweight | 265 | 120.2 |
| Super Heavyweight | >265 | >120.2 |

Weight-miss catch weight: heavier fighter may not exceed the lighter by more than 5 lb. (UFC uses only 8 men's classes 125–265 plus women's 115/125/135/145 — the "super" classes exist in the ABC rules but are rarely used **[known, not re-verified]**.)

**Gloves:** S1 has no glove-weight clause. Common rule text and UFC practice: "approved light gloves (4–6 ounces)" with open fingers (S13, S12); UFC issues 4 oz, larger sizes up to 6 oz for big hands **[known, not re-verified]**. Hand wraps: ≤ 2″×15 yd gauze + ≤ 1.25″×10 ft tape per hand, knuckles uncovered (S1).

**Grounded-fighter definition (S1, 2024 text):** *"A fighter shall be considered grounded and may not be legally kneed or kicked to the head when any part of their body other than their hands or feet is in contact with the canvas (ground)."* Version comparison:

| Version | Grounded when… |
|---|---|
| 2001–2016 | any part other than soles of feet touches (one finger/hand = grounded) |
| 2017–Oct 2024 | "both hands palm/fist down, and/or any other body part other than a single hand" — one hand = not grounded; two hands = grounded (fighters were "playing the game") |
| Nov 2024– | hands never count; knee, shin, buttocks, back, head etc. do |

**12-to-6 elbows:** foul #10 in the 2019 list ("Downward pointing elbow strike (12-6)") was **deleted** by the July 23, 2024 amendment; the 2026 list runs 1–9, 11–27 with #10 absent (S1). UFC's own web page (S12) still lists "Downward pointing elbow strike ('12 to 6' strike)" — a stale page, not the governing rule. Implementation: commissions were asked to adopt by Nov 2024 **[adoption by NSAC/UFC in Nov 2024 known but not re-verified]**.

**Complete foul list (S1, 2026 rev., numbering as printed):**
1. Butting with the head (any use of the head as a striking instrument).
2. Eye gouging (fingers, chin, elbow) — legal strikes to the eye socket are legal.
3. Biting or spitting at an opponent.
4. Fish hooking (mouth/nose/ears).
5. Hair pulling (incl. using own hair to hold/choke).
6. Spiking to the canvas on head/neck (pile-driver); any *arcing* throw is legal; a fighter caught in a submission who can elevate the opponent may slam.
7. Strikes to the spine or back of the head (crown ±1″ down to occipital junction, full neck width, spine ±1″ to tailbone).
8. Throat strikes / trachea grabbing (a stand-up strike that happens to land in the throat is legal).
9. Fingers outstretched toward the face/eyes (standing; referees to instruct "close fist or point up").
10. *(deleted — was 12-6 elbow)*
11. Groin attacks (strike, grab, pinch, twist; men and women).
12. Kneeing/kicking the head of a grounded opponent.
13. Stomping a grounded fighter (axe kicks and standing foot-stomps are legal).
14. Holding opponent's gloves or shorts.
15. Holding/grabbing fence or ropes with fingers or toes (push-off allowed; a 1-pt deduction if the grab had substantial effect; if the grab produced a superior position, restart standing neutral).
16. Small-joint manipulation (fingers/toes; grabbing the majority at once is allowed).
17. Throwing opponent out of the ring/cage.
18. Finger in any orifice, cut or laceration.
19. Clawing, pinching, twisting flesh.
20. Timidity (avoiding contact, running, dropping mouthpiece, faking injury/foul to get time).
21. Abusive language.
22. Flagrant disregard of referee instructions.
23. Unsportsmanlike conduct causing injury (e.g., hitting a tapped/stopped opponent).
24. Attacking after the bell.
25. Attacking on or during the break.
26. Attacking an opponent under the referee's care.
27. Interference from the corner.

Plus: *loss of control of bodily function* (vomit/urine/feces) during a round = TKO medical stoppage; between rounds → doctor evaluates.

**Foul procedure (S1):** 1) call time; 2) check the fouled fighter; 3) decide whether they can continue / how much recovery; 4) if continuing, assess point deduction and/or time; 5) no coaching during the timeout.

| Situation | Outcome |
|---|---|
| Intentional foul, injury ends bout immediately | fouler loses by **DQ** |
| Intentional foul, injury, bout continues | **mandatory 2-point deduction**, authorities notified |
| Intentional foul causes cut/swelling; a later legal or illegal strike stops the fight after 2/3 or 3/5 rounds complete | injured fighter ahead → **Technical Decision**; behind/even → **Technical Draw** |
| Fighter injures self attempting an intentional foul | treated as injury from a fair blow |
| Accidental foul ends bout **before** 2/3 or 3/5 rounds complete | **No Contest** (or DQ if referee so finds) |
| Accidental foul ends bout **after** that threshold | **Technical Decision** to the fighter ahead; partial round scored (even if no action) |
| Groin foul or eye poke, fighter able to continue | up to **5 minutes** recovery |
| Foul severe enough to need doctor | up to 5 minutes for evaluation |
| Eye poke | cold compress/wet towel allowed; fighter must give a verbal "yes/no" on whether they can see; doctor may examine any time |
| Foul causing nausea | bucket may be brought; same 5-min limit; vomiting → doctor must clear |
| Cut from a foul | cutperson may enter during the 5-min break |
| Legal strike | referee may **never** call time to evaluate its effect, except for a laceration |
| Multiple fouls / flagrant disregard | DQ |

**Standing up / breaking (S1, 2026 text):** *"The Referee shall either stand up or break the fighters when neither fighter is able to or fails to demonstrate real, significant and/or sustained effort to advance towards finishing the fight by any method. Simply maintaining what may be perceived as a superior position will not be considered effort to advance…"* No numeric timing is in the rule — timing is referee discretion (see §3.3 and §5).

**Ways to win (S1):** Submission (tap, verbal tap incl. involuntary scream, technical submission = unconscious or broken/dislocated joint); TKO by referee stoppage (fighter *is not* intelligently defending: strikes, laceration, corner stoppage, did not answer bell); TKO medical (laceration, doctor, bodily function); KO by referee stoppage (fighter *cannot* intelligently defend due to strikes); DQ; No Contest; Unanimous/Split/Majority/Technical Decision; Unanimous/Majority/Split/Technical Draw.

**Judging criteria (S1 §A + S2):**
* Minimum three judges; 10-point must; 10 to the winner, 9 or fewer to the loser; 10-10 only for a rare even round.
* Priority: **Plan A** effective striking/grappling → **Plan B** effective aggressiveness → **Plan C** fighting-area control. "Plans B and C are not taken into consideration unless Plan A is weighed as being even."
* Effective striking = damage/effect of legal strikes *solely based on results*. Effective grappling = successful, impactful takedowns, submission attempts, advantageous positions, reversals. Striking and grappling are **equal** (S2). **No scoring for defence** (S2).
* Effectiveness constructs (S2): **Damage** ("legal techniques the results of which lessen an opponent's capacity and/or will to compete": knockdowns, heavy/concussive strikes to vital targets, strikes forcing retreat/purely defensive posture, visible injury, joint hyperextension/rotation, chokes causing visible distress; *immediate* damage > *cumulative* damage) → **Dominance** (sustained supremacy of position/action/volume intended to result in damage; "merely holding a dominant position shall not be considered demonstrating dominance") → **Duration** (time/percentage of the round spent imposing dominance or damage).
* **10-10**: no advantage; "generally reserved for partial rounds. Scoring completed rounds 10-10 is seen as a failure to adjudicate a score."
* **10-9**: offensive actions greater in degree and effectiveness; only if truly even fall to aggressiveness/area control.
* **10-8**: "offensive actions that may include dominance with duration, but that **must include significant damage** resulting from effort or attempts that by their implicit nature could finish the fight." Cumulative damage (loss of energy, confidence, stamina, spirit) can qualify. "Significant damage is enough by itself." "Significant domination along with some damage and little to no offensive actions from the losing fighter may be enough." "Significant domination such as positional control without damage is **not** enough."
* **10-7**: "overwhelming in both damage and domination throughout the duration of the round."
* Referee penalties are deducted from the judges' cards; partial rounds are scored when the fight becomes a technical decision.

### 2.3 Boxing — ABC Unified Rules + manuals (S3, S4, S5)

* Rounds: 3 min, 1-min rest; 3 judges; 10-point must; referee is sole arbiter and only one who may stop a contest (ringside physician in most jurisdictions may also, S5).
* Mandatory 8 count; **no standing 8**; **no three-knockdown rule** ("boxers knocked down 3 times in a round should be closely observed", S5); **cannot be saved by the bell in any round**; 20-second count if knocked out of the ring (mandatory 18 count if they return sooner, S5).
* Knockdown definition (S5): from a legal blow, any part other than the soles touches the canvas; hanging defencelessly on/through/over the ropes; ropes alone preventing a fall; or voluntarily taking a knee. Slip = "No knockdown". A boxer who is down may not be hit. Both down and both fail the 10 count → Technical Draw. "Referee's gait test" for unsteady boxers after the 8.
* Stoppage guidance (S5): stop "if one boxer is in any type of physical danger, or if the contest becomes too one-sided"; look for hands down, head snapping back, wobbly legs; eyes closed/spasms after a KD → stop the count and end it. Cuts: consult the doctor; "most cuts within the orbit of the eye (eyelid) should be stopped"; a cut above the orbit that impairs vision should be stopped; swelling that prevents examination should be stopped; give the corner the rest period to work on it when possible.
* Towel: "Throwing the towel cannot stop a professional boxing match. In the US, the chief second should notify the inspector… who will in turn inform the referee."
* Fouls (S3/S5): holding, low blows (reference = top of hip/beltline), rabbit punches, head butts, hitting on the break/after bell, hitting a downed boxer, etc. Procedure: warning → point deduction (referee only; judges do not adjust their own score, S4).
* **Intentional foul**: mandatory 2-point deduction; injury that ends the bout immediately → DQ; injury later stops fight after 4 rounds → Technical Decision/Technical Draw.
* **Accidental foul** (e.g., accidental headbutt cut): stopped before 4 completed rounds → **No Decision**; after 4 → **Technical Decision** to the boxer ahead, partial round scored (S3, S5).
* **Low blow**: up to 5 minutes; if the fouled boxer cannot continue after 5 min from an accidental low blow → **they lose by TKO** (S5).
* Judge criteria (S4): Clean & effective punching → effective aggressiveness → ring generalship → defence. Rule of thumb: **10-9** routine win; **10-8** one KD *or* extremely decisive/hurt opponent (incl. the case where one boxer does nothing offensively); **10-7** two KDs, or one KD plus clear domination; **10-6** more than two KDs (and lower with more). A KD round can be 10-9 if the downed boxer "decisively and dominantly" wins the rest *and* hurts the other; a flash KD late in a round the other boxer dominated → 10-9 to the KD scorer. "Do not let a fighter steal a round with a last-second flurry." Score each round independently.

### 2.4 Kickboxing — ABC pro rules (S7) and GLORY (S8)

| Item | ABC pro kickboxing | GLORY (2026) |
|---|---|---|
| Rounds | up to 10×3, ≥1:00 rest | 3×3 (1:00); 5×3 titles; tournament 3×3 or 2–3 × 2–3; extra round(s) with 1:30 rest; max 13 rounds/day |
| Gloves | "8 oz and 10 oz… industry standard" | 8 oz < 65 kg; 10 oz otherwise |
| Legal | boxing punches, spinning backfist, knees, all kicks above the belt line (low kicks per commission) | punches, spinning backfist (padded back only), all kicks incl. low kicks (only *arcing* kicks to legs), knees incl. jumping |
| Illegal | elbows/wrist strikes, thrusting knee kicks, throws/takedowns/sweeps, joint locks, excessive holding, leg holding without immediate strike | elbows, linear kicks to legs, throws/sweeps/pushing, wrestling/judo/submissions, open-glove hits, holding the leg without immediate strike (one strike + one step allowed), clinching for anything but one immediate knee, pulling opponent's lower back with both arms |
| Clinch | only to immediately launch knees; ref may allow ≤ 5 s if effective | one legal knee then must disengage immediately |
| Counts | mandatory 8; no standing 8; 3 KD in a round by head strikes = TKO; no saved by bell | mandatory 8; **standing 8 allowed**; **3 KD same round or 4 in match = TKO** (tournament: 2/3); both down → both counted |
| Scoring priority | KDs → cumulative effective impact → number of clean strikes → ring generalship/aggression; loser gets 9, 8 or 7 | KDs (KD wins round) → damage (high-impact wobble/stagger prioritised, cumulative counts) → number of clean strikes (spectacular techniques prioritised) → aggression/ring domination (attack > defence) |
| 10-8 / 10-7 | not specified | 10-8 = KD or high-intensity damage + significant domination; 10-7 = two KDs; penalties subtracted first (10-9 winner with a minus → 9-9) |
| Draws | — | "Sudden Victory" extra round; only that round counts; judges may not score it even; title fights: champion retains on draw after 5 rounds; tournament final up to two extra rounds |
| NC threshold | — | accidental foul before 2 of 3 / 3 of 5 rounds → No Contest; after → cards without the foul round |

**WAKO / K-1 / ISKA [UNVERIFIED — from prior knowledge]:** WAKO K-1 rules: 3×3 (amateur 3×2), knees legal, clinch limited to one knee/5 s, no elbows, no sweeps; three-knockdown rule (3 in a round or 4 in a bout in K-1 tradition; 2 in a round for tournament). ISKA "Oriental rules" allow sweeps and limited clinch; ISKA full-contact rules require ≥ 6–8 kicks per round above the waist. Treat as variants of the GLORY preset.

### 2.5 Muay Thai — ABC Unified Rules of Professional Muay Thai (S6)

* 3-min rounds, 1-min rest; **3 or 5 rounds**; pre-fight ritual (wai kru) allowed at commission discretion. Ring with ≥4 ropes; cage allowed if ≥16 ft.
* Legal: "punches, kicks, elbows, and knees." Kicking an opponent off their feet is legal (top of foot/shin, incl. hooking the foot).
* Fouls (A–AA): head butts; groin; thumbing/eye gouging; biting; spitting; hair pulling; throat; **striking a grounded opponent**; back of head/spine; **tripping or sweeping with the side of the foot**; **hip/shoulder/leg throws (no hip tosses, grape-vining, reaping, lifting)**; grasping the lower back while hyperextending the spine; intentionally falling on a downed opponent; wrestling/back/arm locks; pile-driving; **catching a kick and pushing > 2 steps without striking**; intentionally grounding oneself when a leg is caught; striking a downed/rope-entangled fighter; disobeying; on the break; after the bell; holding ropes/cage; holding shorts; timidity/delays; unsportsmanlike; attacking under referee's care; corner interference.
* Knockdown = touching the mat with anything but the soles from a legal damaging strike, *or* defenceless holding the opponent/hanging on the ropes. Mandatory 8; no standing 8; no saved by bell; through ropes → 8 count + time to re-enter; off the platform → mandatory 18 count, up by 20. Failing to rise from a "slip" after repeated commands → count → TKO at 10.
* TKO reasons: no will/incapable; not intelligently defending; doesn't come out; **outmatched** (health/safety); fighter or corner "throwing in the towel" — allowed in Muay Thai, unlike ABC boxing.
* Fouls/decisions mirror MMA: intentional → mandatory 2 pts; accidental → NC before 2/3 or 3/5, TD after; low blow up to 5 min; loss of bodily function = TKO.
* **Judging (S6):** "Judges shall consider damage, domination and duration" using prioritised criteria: (a) **a fighter with an advantage in number or quality of knockdowns shall never lose that round**; (b) else clear advantage in cumulative damage; (c) else greater number and/or variety of clean scoring Muay Thai techniques; (d) else aggressiveness, control or effective defence. 10-10 only for a dead partial round; **10-9** slight or clear advantage; **10-8** overwhelming without KD *or* won the round + 1 KD; **10-7** won + 2 KD; **10-6** won + 3 KD.
* Recommended weight classes: boxing-style 18 classes from Mini-Flyweight (≤105) to Super Heavyweight (>225).

**Thai stadium / WBC Muay Thai / IFMA culture [UNVERIFIED — prior knowledge, not fetched]:** stadium bouts 5×3 with **2-min** rest; judges score the fight as a whole with rounds 1–2 as "feeling-out", **rounds 3–4 decisive**, round 5 often coasted by the leader; clean kicks/knees to the body outrank punches unless punches visibly hurt; sweeps/off-balancing and "ruup" (composure/balance, not showing hurt) score; catching a kick and dumping is rewarded; the fighter who is knocked off balance loses face. WBC Muay Thai: 5×3, 2-min rest, 10-point must with per-round scores but with explicit emphasis on effect/damage; IFMA (amateur/elite): 3×3 with 1-min rest, protective gear, Olympic-style judging.

### 2.6 Grappling

**IBJJF v6.1 (S9):**
* Points (position must be **stabilised 3 s**, and the scorer must not be under submission threat): takedown 2, sweep 2, knee-on-belly 2, guard pass 3, mount 4, back mount/back control 4. Passing straight to mount scores pass and mount separately only if each is stabilised. Exiting the area to escape a submission → 2 pts to the attacker.
* Advantage: near-completed scoring position (< 3 s), or a submission attempt that put the opponent in real danger; awarded only once the chance to complete has gone.
* Tie-break: points → advantages → fewest penalties → referee decision (who showed more offence / came closer to scoring or submitting) → random pick (double injury in a final).
* Penalties: **Severe** (DQ immediately: disciplinary = out of the event; technical = out of the match). **Serious** ladder: 1st marked → 2nd advantage to opponent → 3rd two points to opponent → 4th DQ (U-15: 4th/5th = 2 pts, 6th DQ). **Lack of combativeness** uses the same ladder after a **20-s** count; not stalling when defending from mount/back/side/north-south; double guard pull → 20-s clock then both penalised and restarted standing; 50/50 lapel/belt grip → 20 s to progress.
* Durations: adult white 5, blue 6, purple 7, brown 8, black 10 min; juvenile 5; Master 1: 5/6/… (5 white/blue, 6 purple+); Masters 2+ 5 min; kids 2–4 min.
* Illegal for everyone: slam, spinal lock without choke, scissor takedown, bending fingers back, belt-throw onto head defending a single leg, suplex landing on head/neck, hand-on-windpipe/thumb chokes, blocking nose/mouth with hands. **[Belt matrix reconstructed — the PDF's column alignment was lost in extraction; cross-checked against the v6 illegal-moves poster from prior knowledge, verify before encoding]:**

| Division | Additionally banned (beyond the everyone list) |
|---|---|
| 4–12 yrs | leg-spreading subs, choke with spinal lock, straight footlock, Ezequiel, front guillotine, omoplata, triangle pulling the head, arm triangle, closed-guard rib/kidney compression, wrist lock, single-leg with head outside (no penalty), slicers, kneebar, toe hold, heel hook, reaping, twisting knee locks |
| 13–15 yrs | as above minus Ezequiel/guillotine/omoplata/triangle/arm-triangle (straight footlock still banned; wrist lock banned) |
| 16–17 yrs and adult **white** belts | wrist lock legal; straight footlock legal; **banned**: bicep slicer, calf slicer, kneebar, toe hold, heel hook, knee reaping, twisting knee locks, single-leg head-outside |
| Adult **blue/purple** (gi and no-gi) | banned: bicep/calf slicer, kneebar, toe hold, heel hook, knee reaping, twisting knee locks |
| Adult **brown/black gi** | banned: heel hook, knee reaping, twisting knee locks (kneebar, toe hold, slicers legal) |
| Adult **brown/black no-gi** | heel hook and knee reaping **legal** (since 2021); twisting knee locks still banned |

**ADCC (S10):**
* Durations: World Championship qualifiers **10 min** (first 5 no points; second 5 positive and negative points) + one 5-min OT; finals/absolute finals/superfights **20 min** (first 10: only negative points) + up to two 10-min OT; trials/nationals 6 (3+3) + 3 OT, finals 8 (4+4) + 4 OT.
* Points (3-s establishment, out of submission danger): **pass 3** (≥75 % of back on mat), **knee on stomach 2**, **mount 2** (both knees down, below shoulder line), **back mount with hooks/body triangle 3**, **takedown 2** (ending in guard/half guard) / **4 clean** (past guard, 75 % back), **sweep 2 / 4 clean**; reversals count as sweeps; re-scoring a position requires losing it ≥ 3 s; pass straight to mount scores the pass only; no sweep points for the defender when the top player initiated a submission and ended on bottom.
* Negative points (−1 each): pulling guard / going to a non-standing position ≥ 3 s (also shooting and pulling guard or turtling within 3 s), backing up and refusing to engage, passivity after two "WARNING PASSIVITY" (thereafter immediate), repeatedly fleeing the mat (and fleeing a submission more than once), bad language, disobeying. Passivity warnings in the no-points half convert to a minus when the scoring half starts. One or both knees down while both standing ≥ 3 s = minus.
* No score → **referee decision by dominance**. Referee stops if a competitor "is unable to defend himself or… his life is in danger".
* Legal: all chokes (except hand on windpipe), arm/shoulder/wrist locks, all leg locks incl. heel hooks, can opener, twister; slam only while locked in a submission. Illegal: strikes, both-shoulder downward neck cranks, full nelson, crucifix, spiking on head, forward roll with someone on the back, eye/ear/hair, < 4 fingers/5 toes, hands/knees/elbows on face, chin-twisting crossface guillotine, holding clothing, grease. Intentional strike or attempted illegal technique → immediate DQ. Accidental eye poke/groin/bleeding → 2 min to recover.

### 2.7 Judo — IJF Refereeing Rules 2025–2028 (S11)

* Contest: **4 min real time** (senior, U21, U18); 10 min rest between contests. Ends on ippon, waza-ari-awasete-ippon, hansoku-make, kiken-gachi, or time; then **golden score, no time limit**, carrying scores/shidos; won by yuko, waza-ari, ippon, hansoku-make (direct or 3rd shido) or kiken-gachi. Osaekomi starting in golden score: **5 s → yuko → contest ends**.
* Scores: **Ippon** = throw with speed, force, on the back, control to the end of landing; or osaekomi **20 s**; or two waza-ari. **Waza-ari** = landing > 90° of shoulder axis but not the back, or an ippon missing one criterion; osaekomi **10–19 s**. **Yuko (reinstated 2025)** = side landing ≥ 90° / upper-back / neck / shoulder-and-elbow/hand; landing on both buttocks or hands/elbows from an attack; osaekomi **5–9 s**. Yuko counts (1, 2, 3…) but never adds to a waza-ari. A penalty never scores for the opponent.
* Penalties: **two shido are warnings, the third is hansoku-make** (athlete may continue in the competition). Shido: non-combativity, false attacks, no attack **45 s** after conventional kumi-kata, stepping out intentionally, **leg grabbing/trouser grip/blocking legs (shido; direct HM in 2013–2024 cycles)**, ducking under the arm without attack, defensive sleeve-end grips, interlocked fingers, gripping inside trouser leg standing, bending fingers, breaking grip with two hands without keeping one, breaking grip with knee/leg, covering lapel, blocking hands, belt/jacket encircling, judogi in mouth, foot in belt/lapel, chokes with belt/jacket bottom/fingers only, over-stretching the leg, entangling without attack, kata-sankaku throw (low risk), attire/hair (one hair retie allowed), cadet head-throwing/defending, reverse seoi-nage for cadets. **Direct hansoku-make (may continue):** head-diving throws (uchi-mata, harai-goshi, seoi-nage, tai-otoshi, kata-guruma, tsuri-goshi…), somersaulting with uke on the back. **Direct hansoku-make (out of competition):** kawazu-gake, kani-basami, do-jime, ashi-garami, standing kansetsu/shime-waza without throw or with high injury risk, uke reaping tori's leg from behind, any action endangering neck/spine (high-risk kata-sankaku/ushiro-sankaku pressure), falling backwards with an athlete on the back, lifting and slamming without technique, disregarding the referee, derogatory remarks/gestures, hard objects in judogi, anti-judo (e.g., leaving the area while leading in the last seconds).

### 2.8 Street / crowd mode (no sanctioning body — design ruleset)

Sources are self-defence and criminology literature rather than rulebooks; treat as a synthesis **[UNVERIFIED citations: R. Miller *Meditations on Violence* (2008); G. Thompson *Dead or Alive*; Australian "one-punch/coward's punch" fatality reviews reporting ~90 deaths 2000–2012 with most fatal injuries from the head striking the ground; UK Home Office assault data]**.

Design rules for the game's `street` ruleset:
* **No referee, no rounds, no weight classes, no gloves** (bare knuckle → higher hand-fracture and laceration rates; lower KO-per-punch than gloved to the temple? — treat glove-less strikes as +cut, +hand-injury, ±KO per striking research file).
* **Everything is legal**: eye gouges, groin, throat, back of head, small joints, biting, hair, headbutts, stomps and soccer kicks to a downed opponent, slams/spikes. Soft-tissue attacks have high pain/flinch effect but low incapacitation reliability; stomps to a downed head and spikes onto a hard surface are the highest-lethality actions.
* **Surface** matters: falls/slams onto concrete carry a large multiplier for concussion/death relative to a mat (the dominant fatal mechanism in one-punch deaths is the secondary head impact).
* **Multiple attackers**: going to the ground is catastrophic when a third party is free; the sim should model "free attacker" strikes and stomps against a grounded fighter; clinch/ground time should be strongly penalised in threat assessment.
* **Ending conditions**: incapacitation (KO, unable to stand), injury that stops function, **flight** (a participant disengages and runs — the most common real ending), **surrender/compliance** (verbal, curling up, hands up), **third-party separation** (bystanders, security, police), **weapon drawn** (ends the "fight" phase; fighters respond by fleeing or the encounter escalates outside the sim's scope), **arrival of more people** (crowd dynamics can end or expand the fight).
* **Duration**: most unarmed altercations resolve in well under a minute of contact; use a hazard model with median 20–40 s to first ending condition **[ASSUMPTION]**.
* **Fatigue/adrenaline**: no rest; heavy adrenaline dump raises power early, wrecks fine motor and cardio after ~30–60 s **[ASSUMPTION]**.
* **Ethics/design note**: do not glamorise; no gore art; show consequences (injury, legal, fleeing is a "win"); frame the objective as *escape/protect* rather than "win"; consider an age gate/toggle; never model attacks on incapacitated targets as rewarded except for the "attacker" AI (so the player is not incentivised to stomp).

---

## 3. Referee logic (pseudocode)

All timings marked `cfg.*` come from the strictness preset (§5). Every check runs each tick (e.g., 100 ms) unless stated. State: `fighter.dmg` (accumulated head trauma), `fighter.consciousness`, `fighter.defending` (bool from action model), `unansweredStrikes`, `positionTimer`, `clinchTimer`, `cutSeverity`, `fouls[]`.

### 3.1 Stoppage checks — MMA / kickboxing / Muay Thai / boxing

```
function checkStoppage(state, cfg):
  for f in fighters:
    # 1. Knockout — cannot intelligently defend (S1: "KO by referee stoppage")
    if f.consciousness <= 0 or f.motorControl < cfg.koMotorThreshold:
        return end(KO, winner=other(f), reason="strikes")   # MMA: immediate
    # 2. Not intelligently defending — TKO by strikes (S1, S5)
    #    Signals from S5: hands down, head snapping back, wobbly legs; unanswered strikes.
    if f.isGrounded or f.isRocked:
        if f.unansweredStrikes >= cfg.tkoUnansweredStrikes
           and f.timeSinceLastDefensiveAction >= cfg.tkoNoDefenceSeconds:
            return end(TKO, other(f), "referee stoppage – strikes")
    #    "Not improving position" is NOT itself a stoppage criterion; it is a
    #    stand-up criterion (§3.3). Stoppage requires absence of intelligent defence.
    # 3. Submission
    if f.tapped or f.verbalTap or f.screamsInPain:      # S1 verbal tap incl. involuntary scream
        return end(SUB, other(f), "tap")
    if f.consciousness <= 0 and cause == choke:         # technical submission
        return end(SUB, other(f), "technical submission – unconscious")
    if f.jointBroken:                                   # S1 technical submission
        return end(SUB, other(f), "technical submission – injury")
    # 4. Doctor stoppage (called at referee's request; S5 cut criteria)
    if f.cut.severity >= cfg.cutDoctorCall or f.eyeSwollenShut:
        callDoctor(f) -> if doctor says stop: end(TKO, other(f), "doctor – laceration")
        # S5: cut inside eye orbit -> stop; cut above orbit impairing vision -> stop;
        #     swelling preventing examination -> stop. Give the corner the rest period first
        #     when the round is nearly over.
    # 5. Corner stoppage
    if f.corner.throwsIn:                                 # MMA/MT: allowed; boxing (US): via inspector
        return end(TKO, other(f), "corner stoppage")
    # 6. Did not answer the bell / bodily function
    if roundStart and not f.readyAtBell: return end(TKO, other(f), "did not answer bell")
    if f.lostBodilyFunction: return end(TKO, other(f), "medical – bodily function")
```

Referee reaction latency **[ASSUMPTION]**: `cfg.refReactionSeconds` (standard 0.6–1.0 s) between the criterion being met and the stoppage, during which additional strikes may land. This produces the familiar "one or two extra shots after the KO".

### 3.2 Knockdowns and counts — boxing / kickboxing / Muay Thai

```
function onKnockdown(f, cfg, ruleset):
  if not causedByLegalBlow: return signal("slip")        # S5; MT: refuses to rise after slip -> count
  send other(f) to farthest neutral corner
  count = 0
  while count < 8: count += 1 per second               # mandatory 8 (S3, S6, S7, S8)
  if f.canStand and f.passesGaitTest(cfg):             # S5 gait test; ref may stop early if eyes closed/spasms
      f.knockdownsThisRound += 1; f.knockdownsThisBout += 1
      if ruleset.threeKnockdownRule and (f.knockdownsThisRound >= 3 or f.knockdownsThisBout >= 4):
          return end(TKO, other(f), "three-knockdown rule")      # GLORY; ABC KB (3 in round by head strikes)
      resume()
  else:
      continue count to 10 -> end(KO, other(f), "count-out")     # boxing/MT/KB
  # Boxing: no saved-by-bell; timekeeper holds the bell until the 8 (S8) / count completes.
  # Out of ring: 20-second count (mandatory 18 if back sooner).
  # Standing 8: only in GLORY (S8); never in ABC boxing/MT/pro KB.
```

MMA has **no counts**: a knockdown is simply a damage event; the referee either lets ground action continue or stops under §3.1.

### 3.3 Stand-ups (MMA) and clinch separation

S1 rule text gives no timing; timings are **[ASSUMPTION]** calibrated to common practice (referees typically warn "work" then stand after roughly 30–60 s without progress in a neutral or stalled position; fence clinches are typically broken after ~15–30 s without strikes or takedown attempts; less experienced/regional referees stand up faster) and should be tuned in play-testing.

```
function checkStandup(ground, cfg):
  # Effort to finish = strikes landed, submission attempts, pass/sweep attempts, position changes.
  # "Simply maintaining a superior position" is NOT effort (S1 2026).
  if ground.secondsSinceLastEffortByEither >= cfg.standupWarnSeconds:
      referee.say("work!")                                # warning first
  if ground.secondsSinceLastEffortByEither >= cfg.standupSeconds:
      restart(standing, neutral)
  # Exception: the bottom fighter actively attacking (submission threats) resets the timer.

function checkClinchBreak(clinch, cfg):
  if clinch.secondsSinceLastStrikeOrTakedownAttempt >= cfg.clinchBreakSeconds:
      referee.say("break") ; restart(standing, neutral)
  # Kickboxing: cfg.clinchBreakSeconds ≈ 0–5 (one knee then release; ABC pro KB allows ≤5 s of effective knees).
  # Boxing: break on holding; repeated holding -> warning -> point deduction.
  # Muay Thai (ABC): no timer in the rule; referee separates when neither is working [ASSUMPTION 5–8 s].
```

### 3.4 Fouls — occurrence, detection, consequence

Per-action foul probabilities are **[ASSUMPTION]** placeholders to be calibrated by the striking/grappling research files; the *consequence* logic follows S1/S3/S5/S6.

```
FOUL_TABLE (MMA) — probability that a given action produces the foul
  action                       foul                    p_base   intent
  jab/straight (open hand)     eye poke (#2/#9)        0.004    accidental (intentional if fingers extended repeatedly)
  any front kick/knee to body  groin strike (#11)      0.006    accidental
  round kick to body           groin strike            0.003    accidental
  strike while opp. turns      back of head (#7)       0.015    accidental (intentional if repeated after warning)
  ground-and-pound on turtle   back of head            0.03     accidental
  knee to head vs opp. w/ knee down  grounded knee (#12) 0.02  accidental (misjudged status)
  head kick vs downed opp.     grounded kick (#12)     0.02
  takedown defence at fence    fence grab (#15)        0.08     usually intentional/reflexive
  clinch at fence              fence grab              0.03
  guard passing / GnP          finger in cut/orifice   0.002
  wrestling scramble           small joint (#16)       0.005
  running/backpedalling >N s   timidity (#20)          rate-based
  slam attempt                 spike (#6)              0.01 if opp. is inverted
  post-bell strike             after the bell (#24)    0.03 if strike in flight at bell

function onFoul(foul, fouler, victim, cfg):
  referee.callTime()
  assess victim
  intentional = foul.intent == INTENTIONAL or fouler.warningsFor(foul.type) >= cfg.warningsBeforeIntentional
  if victim.cannotContinue:
      if intentional: return end(DQ, victim)                                   # S1 A.1
      elif roundsCompleted >= threshold(scheduled):                            # 2 of 3 / 3 of 5 (boxing: 4 rounds)
           return end(TECHNICAL_DECISION or TECHNICAL_DRAW by cards incl. partial round)
      else: return end(NO_CONTEST)                                             # S1 B.1
  # recovery time
  if foul.type in {GROIN, EYE_POKE}: allow up to 300 s; victim decides ("yes/no can you see")
  if foul.needsDoctor: allow up to 300 s doctor evaluation
  # sanction
  if intentional: deductPoints(fouler, 2)                                      # mandatory (S1 A.2)
  else:
      if foul.type == FENCE_GRAB and foul.substantialEffect: deductPoints(fouler, 1); if gainedPosition: restartNeutral()
      elif fouler.warningsFor(foul.type) == 0 and cfg.warnFirst: warn(fouler)
      elif random() < cfg.pDeductAccidentalRepeat: deductPoints(fouler, 1)
      else: warn(fouler)
  if fouler.pointDeductions >= cfg.dqAfterDeductions or fouler.flagrant: end(DQ, victim)
  restart(positionBeforeFoul if fair else neutral standing)
```

Boxing differences: intentional foul → 2 points mandatory (S3); accidental headbutt cut that stops the bout → No Decision (< 4 rounds) or Technical Decision (≥ 4) (S3/S5); low blow → 5 min, victim loses by TKO if unable after 5 min (S5). Muay Thai: same NC/TD thresholds as MMA (S6). Kickboxing GLORY: NC before 2 of 3 / 3 of 5, otherwise cards without the foul round (S8).

### 3.5 Grappling referee (IBJJF / ADCC)

```
IBJJF tick:
  for each position change: if stabilised >= 3 s and not under submission -> awardPoints(table)
  elif nearly completed -> pendingAdvantage (award when chance is gone)
  stalling: if no positional progression by top/bottom for 20 s (and not defending from mount/back/side/N-S):
      penalty ladder: [mark, advantage-to-opp, 2-pts-to-opp, DQ]
  double guard pull: 20-s clock -> both penalised, restart standing
  illegal technique for division -> DQ (severe technical) ; disciplinary -> DQ from event
  on time: points -> advantages -> fewer penalties -> referee decision (offence/closeness)

ADCC tick:
  if t < halfTime: positive points off; passivity warnings accrue; 2 warnings then -1 each thereafter
  else: points on; guard pull / knee down >= 3 s -> -1; disengaging/backing up -> -1; fleeing mat -> -1
  positions need 3 s + no submission threat; re-score after losing position >= 3 s
  on time with tie: overtime (5/10 min, max 1/2); still tied -> referee decision by dominance
  intentional strike or attempted illegal technique -> DQ
  accidental eye/groin/bleeding -> 2 min recovery, else loses
```

### 3.6 Judo referee (IJF)

```
IJF tick:
  throw evaluation: back+speed+force+control -> ippon; >90° not on back -> waza-ari; side/upper-back/neck/buttocks -> yuko
  osaekomi timer: 5 s yuko, 10 s waza-ari, 20 s ippon (in golden score 5 s yuko ends contest)
  second waza-ari -> ippon
  shido triggers: no attack 45 s after kumi-kata, false attack, leg grab, stepping out, defensive grips…; 3rd shido -> hansoku-make
  direct hansoku-make: head dive, kani-basami, kawazu-gake, do-jime, ashi-garami, standing joint lock, neck/spine danger…
  at 4:00 with equal scores -> golden score until any score or hansoku-make
```

---

## 4. Judging logic (pseudocode)

### 4.1 MMA — 10-point must under S1/S2 with empirical weights

Empirical anchors: judges' round decisions are best predicted by significant-strike differential, knockdowns and (to a lesser, position-conditional degree) control time; Gift (S14) found no titleholder or point-deduction bias but **bias toward larger betting favourites, fighters with insurmountable leads, and the previous round's winner**; MMADecisions data imply per-judge dissent ≈ 5–6 % of decisions (S18, inferred). Collier et al. (S16) **[from memory]** found strikes landed and takedowns raised, and being taken down lowered, the probability of winning a decision. Weights below are **[INFERRED]** design values consistent with these sources and with the S2 rule that damage dominates.

```
function scoreRound(A, B, roundStats, judge):
  # --- Plan A: effective striking/grappling, measured by RESULT (damage) ---
  dmg(X) = 3.0*knockdowns(X)                       # "knockdowns" top of S2 damage list
         + 1.0*rockedEvents(X)                      # opponent wobbled/hurt
         + 0.10*sigStrikesLanded(X)                 # volume matters but less than effect
         + 0.35*powerStrikesToHead(X) + 0.20*powerStrikesToBody/Leg(X)
         + 0.8*visibleInjuryCaused(X)               # cut/swelling/hematoma
         + 1.2*nearSubmissions(X)                   # "chokes causing visible distress", joint hyperextension
         + 0.6*takedownsLanded(X) + 0.5*reversals(X) + 0.4*dominantPositionsAchieved(X)
         + 0.25*groundStrikesLanded(X)
  # Dominance (only counts when converted into offence — "merely holding is not dominance")
  dom(X) = 0.02*controlSecondsWithOffence(X) + 0.004*controlSecondsPassive(X)
         + 0.6*fractionOfRoundOpponentPurelyDefensive(X)
  # Duration
  dur(X) = fractionOfRoundImposing(X)             # 0..1
  effA = dmg(A) + dom(A)*(0.5+dur(A));  effB = likewise
  margin = effA - effB
  # judge noise & biases (S14): add favourite-bias, momentum-bias, judge-specific style
  margin += judge.noise * N(0,1) + judge.favBias*log(oddsRatio(A,B)) + judge.momentumBias*prevRoundWinner(A)
  if abs(margin) < judge.evenThreshold:            # Plan B then Plan C
      margin += 0.3*sign(aggression(A)-aggression(B))
      if still |margin| < threshold: margin += 0.2*sign(areaControl(A)-areaControl(B))
      if still ~0 and roundComplete: force a 10-9 by coin-flip weighted by tiny margin  # 10-10 "failure to adjudicate"
  winner = A if margin>0 else B
  # --- 10-8 / 10-7 tests (S2) ---
  sigDamage = knockdowns(winner)>=1 or rockedEvents(winner)>=2 or dmg(winner) >= cfg.tenEightDamage
  domination = dom(winner) >= cfg.tenEightDom and offence(loser) <= cfg.loserOffenceCeiling
  if sigDamage and domination and dur(winner) >= 0.8 and dmg(loser) < 0.15*dmg(winner): score = 10-7
  elif sigDamage or (domination and dmg(winner) >= 0.5*cfg.tenEightDamage): score = 10-8
  else: score = 10-9
  # positional control alone can never be 10-8 (S2)
  apply referee point deductions to the loser/fouler's side of the card
```

Bout decision: sum rounds per judge; per S1 decision types (U/S/M decision; U/M/S draw); technical decision uses partial round scoring. ONE Championship / PRIDE / RIZIN use whole-fight scoring (near-finish → damage → striking/ground control → takedowns → aggression) (S13) — provide as `mma-whole-fight` variant.

### 4.2 Boxing (S4)

```
function scoreRoundBoxing(A,B,stats,judge):
  base(X) = 1.0*cleanPowerPunchesLanded(X) + 0.5*cleanJabsLanded(X) + 0.8*bodyPunchesLanded(X)
          + 1.5*hurtEvents(X) + 0.3*effectiveAggression(X) + 0.2*ringGeneralship(X) + 0.15*defenceQuality(X)
  margin = base(A)-base(B) + judge.noise
  winner = sign(margin)
  kdW = knockdownsScored(winner); kdL = knockdownsScored(loser)
  if kdW == 0 and kdL == 0:
      score = (10-8 if margin >= cfg.decisiveMargin and loserOffence ~ 0 else 10-9)
  else:
      net = kdW - kdL
      # S4 Situation 2/3: a KD flips a slight lead; a flash KD in a dominated round -> 10-9
      if net == 1: score = 10-8 unless (loser decisively won the rest AND hurt the winner) -> 10-9
      if net == 1 and margin >= cfg.decisiveMargin: score = 10-7
      if net >= 2: score = 10-7 ; if net >= 3: 10-6 (and lower)
  10-10 only if truly nothing separates them ("should rarely happen")
```

Empirical calibration (S15, World Boxing 2025): 98.2 % of judge-round scores were 10-9 (amateur, no counts/KDs scored differently); single-judge reliability 0.62–0.69, panel-of-five 0.89–0.92; 68.9 % of decided bouts 5:0. Set `judge.noise` so that ~30 % of three-judge pro decisions are non-unanimous **[INFERRED]**.

### 4.3 Kickboxing — GLORY (S8) / ABC pro KB (S7)

```
if knockdowns(A) != knockdowns(B): winner = more KDs (cannot lose round unless point deductions)
else: winner by damage (high-impact wobble/stagger >> cumulative) -> clean strikes (spectacular bonus) -> aggression/ring domination
score: 10-9 default; 10-8 if KD or (highImpactDamage and significantDomination); 10-7 if two KDs; 10-10 only if no marginal advantage
minus points subtracted first (10-9 winner with −1 -> 9-9)
draw after scheduled rounds -> "Sudden Victory" round, judges must pick a winner
```

### 4.4 Muay Thai (S6 + stadium culture preset)

```
ABC-MT round:
  if kdAdvantage(A,B) != 0: winner = KD side (never loses)
  elif |cumDamage(A)-cumDamage(B)| > t1: winner = more damage
  elif cleanTechniqueScore differs: winner = more/varied clean MT techniques
       techniqueScore = 1.0*bodyKicks + 1.0*knees + 0.9*elbows + 0.6*punches + 0.5*lowKicks + 0.8*sweepsOffBalance(legal kick-offs)
       + 0.4*teeps landed with effect  (weights [ASSUMPTION] reflecting Thai valuation)
  else: aggression / control / effective defence
  score: 10-9 slight/clear; 10-8 overwhelming or won+1 KD; 10-7 won+2 KD; 10-6 won+3 KD
Stadium-culture modifier (preset `thai-stadium`, [UNVERIFIED]):
  roundWeight = [0.5, 0.75, 1.25, 1.25, 0.75]; whole-fight impression: sum(roundWeight*margin)
  composure bonus: fighter who visibly shows hurt/loses balance loses margin; fighter who catches & dumps gains
```

### 4.5 Grappling

```
IBJJF: winner = most points; tie -> advantages -> fewer penalties -> referee decision (offensive initiative)
ADCC:  winner = submission; else most points after the scoring half; tie -> OT; tie -> referee decision (dominance, aggression, near-submissions)
Judo:  ippon ends; else waza-ari count (2 = ippon); else yuko count; else golden score; shido never scores
```

---

## 5. Referee strictness presets

Numbers are **[ASSUMPTION]** design defaults (rules provide no numeric timings except the 5-min foul recovery, counts, and IBJJF/IJF clocks); tune in testing.

| Parameter | Lenient | Standard | Strict | Rule anchor |
|---|---|---|---|---|
| `tkoUnansweredStrikes` (grounded/rocked, undefended) | 8 | 5 | 3 | S1 "not intelligently defending"; S5 signals |
| `tkoNoDefenceSeconds` | 3.0 | 2.0 | 1.2 | — |
| `koMotorThreshold` (immediate KO) | 0.10 | 0.15 | 0.20 | — |
| `refReactionSeconds` | 1.2 | 0.8 | 0.5 | — |
| `cutDoctorCall` (severity 0–1) | 0.75 | 0.6 | 0.45 | S5 orbit/vision rule |
| Doctor stop probability at call, cut in orbit / vision impaired | 0.6 / 0.5 | 0.8 / 0.7 | 0.95 / 0.85 | S5 |
| `standupWarnSeconds` / `standupSeconds` (MMA ground, no effort by either) | 45 / 75 | 30 / 50 | 15 / 30 | S1 2026 stand-up text (no numbers) |
| Stand-up when top is passive but bottom is active | never | rarely (bottom effort resets) | same as above | S1 |
| `clinchBreakSeconds` (MMA fence clinch, no strikes/TD attempts) | 40 | 25 | 12 | — |
| Kickboxing clinch tolerance | 5 s if effective | 1 knee then break | 1 knee then immediate break | S7/S8 |
| Boxing holding: warnings before deduction | 3 | 2 | 1 | S5 |
| `warnFirst` for accidental fouls (fence grab, low blow, eye poke) | yes, 2 warnings | yes, 1 warning | deduct on first if any effect | S1 #15 "if substantial effect" |
| `pDeductAccidentalRepeat` | 0.3 | 0.6 | 0.9 | — |
| Intentional-foul deduction | 2 (mandatory) | 2 | 2 | S1/S3 |
| `dqAfterDeductions` | 4 | 3 | 2 | S1 "multiple fouls" |
| Timidity: seconds of non-engagement before warning | 60 | 40 | 25 | S1 #20 |
| Grounded-status judgment error (knee to head on borderline "grounded") | ref calls foul 70 % | 85 % | 97 % | S1 #12 |
| Boxing gait test strictness after 8 count (stop if unsteady) | p=0.3 | 0.5 | 0.8 | S5 |
| Muay Thai "outmatched" TKO threshold (damage ratio) | 6:1 | 4:1 | 3:1 | S6 D.1.d |
| IBJJF stalling clock | 20 s (rule) | 20 s | 20 s but earlier "Lute" cue | S9 |

Strictness also affects judging only indirectly (deductions on cards). Judge "culture" presets are separate: `unified-2025` (S2, damage-first), `legacy-2016` (volume/control friendlier; more 10-10s, fewer 10-8s), `thai-stadium`, `glory`, `boxing-abc`, `whole-fight` (ONE/PRIDE).

---

## 6. Data tables

### 6.1 Judge behaviour / agreement

| Statistic | Value | Source | Notes |
|---|---|---|---|
| World Boxing Championships 2025 (94 bouts, 5 judges): share of judge-round scores that were 10-9 | 98.2 % | S15 | amateur format; almost never 10-8 |
| Same: single-judge reliability R by round | 0.617 / 0.634 / 0.687 (R1/R2/R3) | S15 | five-judge aggregate 0.889 / 0.897 / 0.916 |
| Same: bouts decided 5:0 | 68.9 % | S15 | |
| MMA judges: bias toward larger betting favourites, fighters with insurmountable leads, and previous-round winner; no titleholder bias; no bias against fighters with point deductions | significant | S14 (NV & CA, 2001–2012, round-by-round) | effect sizes not in abstract |
| Busiest MMA judge (S. D'Amato): dissents / total decisions | 79 / 1,421 ≈ 5.6 % | S18 | Minority Report counts split-decision dissents only |
| Implied share of decisions that are split (3 × per-judge dissent rate, assuming uniform) | ≈ 17 % | **[INFERRED]** from S18 | widely quoted range for UFC is ~18–22 % **[UNVERIFIED]** |
| Share of UFC bouts going the distance | ≈ 45–52 % (recent years) | **[UNVERIFIED]** | earlier eras ~30–40 % |
| 10-10 rounds in MMA | rare; S2 calls completed-round 10-10 "a failure to adjudicate" | S2, S18 10-10 Report lists a few dozen bouts | |
| Predictors of a judge's round win in MMA | significant strikes landed differential (strongest), knockdowns (near-decisive), takedowns (positive), being taken down (negative), control time (positive but conditional on activity) | S16 **[from memory]**, S14, S2 | use §4.1 weights |
| Home advantage in combat sports (Olympics) | present for judged sports; smaller for objective-outcome sports | Franchini & Takito 2016 (DOI 10.1007/s11332-016-0286-9) **[abstract not retrievable; direction from memory]** | apply small `judge.homeBias` |
| Referee task load | referees describe stoppage timing, fighter-safety judgment and crowd/corner pressure as key demands | S19 | supports modelling reaction latency & pressure |

### 6.2 Counts, recovery and procedural timings (rule-fixed)

| Item | Value | Source |
|---|---|---|
| Mandatory count after knockdown (boxing, KB, MT) | 8; KO at 10 | S3, S6, S7, S8 |
| Out-of-ring count | 20 s (mandatory 18 if back sooner) | S3, S5, S6 |
| Standing 8 count | none in ABC boxing/MT/pro KB; allowed in GLORY | S3, S6, S7, S8 |
| Three-knockdown rule | none in ABC boxing; ABC pro KB: 3 in a round (head strikes) = TKO; GLORY 3/round or 4/bout (tournament 2/3) | S3, S7, S8 |
| Saved by the bell | never (boxing, MT, KB) | S3, S6, S7 |
| Groin / eye-poke recovery | up to 5 min | S1, S3, S5, S6 |
| Doctor evaluation after foul | up to 5 min | S1 |
| Knocked out of ring (MMA in a ring) | 5 min to return; doctor exam | S1 |
| No-contest threshold | MMA/MT/GLORY: 2 of 3 or 3 of 5 rounds complete; boxing: 4 rounds | S1, S6, S8, S3 |
| Intentional-foul deduction | 2 points mandatory | S1, S3, S6 |
| Rest between rounds | 1 min (MMA, boxing, MT-ABC, KB); GLORY 1.5 min before extra rounds; Thai stadium 2 min [UNVERIFIED] | S1, S3, S6, S8 |
| IBJJF stabilisation / stalling | 3 s / 20 s | S9 |
| ADCC position hold / accidental injury recovery | 3 s / 2 min | S10 |
| IJF osaekomi yuko/waza-ari/ippon | 5 / 10 / 20 s; golden-score osaekomi 5 s ends | S11 |
| IJF attack clock after grips | 45 s | S11 |

### 6.3 Foul frequency and stoppage timing (design placeholders)

| Item | Placeholder | Status |
|---|---|---|
| Eye pokes per UFC fight | ~0.15 (roughly 1 per 6–8 fights; time-outs) | **[ASSUMPTION]** |
| Low blows per fight | ~0.12 | **[ASSUMPTION]** |
| Fence grabs called per fight | ~0.2 (warnings); deductions ~1 per 60–100 fights | **[ASSUMPTION]** |
| Point deductions per UFC fight (all causes) | ~0.02–0.03 | **[ASSUMPTION]** |
| DQ share of UFC outcomes | < 0.5 % | **[ASSUMPTION]** |
| No-contest share | ~1 % | **[ASSUMPTION]** |
| Unanswered strikes before a typical MMA TKO stoppage | 4–8 over 2–5 s | **[ASSUMPTION]** |
| Typical MMA stand-up after stalled ground | 30–60 s of no progress | **[ASSUMPTION]** |
| Typical MMA fence-clinch break | 15–30 s without strikes/TD attempts | **[ASSUMPTION]** |

---

## 7. Assumptions and gaps

1. **Search budget** was exhausted at the start of the session; everything was obtained by direct fetch of known URLs and PDF extraction. NSAC/CSAC text, IFMA, WBC MT, WAKO, ISKA, Thai stadium guides, COMMAND/McCarthy/Dean interview material and Fightnomics were **not** retrieved. Items derived from them are flagged [UNVERIFIED].
2. The ABC 2026 PDF marks new language in blue; the plain-text extraction cannot distinguish 2024 vs 2026 wording. The 12-6 deletion and hands-don't-count grounded definition are 2024 (matches press coverage from that time); the "Standing up or Breaking Fighters" paragraph may be 2026 (requested implementation Nov 2027) — treat its effective date as uncertain.
3. The 2026 ABC weight-class table prints with a one-row offset in extraction; the table in §2.2 is the standard ABC ladder (Atomweight ≤105 … Heavyweight ≤265, Super Heavyweight >265).
4. IBJJF illegal-technique-by-belt matrix was reconstructed because the PDF's column layout collapsed; verify against the IBJJF "Technical Fouls & Illegal Moves" poster before encoding.
5. UFC's own rules page still lists the 12-6 elbow foul; simulators emulating specific commissions pre-Nov-2024 should keep the foul and the "two hands down" grounded definition (`mma-unified-2017` variant).
6. All numeric stand-up, clinch-break, unanswered-strike and foul-probability values are design defaults, not rules; they should be tuned against the striking/grappling research files and event footage.
7. Judging weights in §4.1 are inferred from the S2 hierarchy and study abstracts; the Collier et al. and Gift effect sizes were not readable in full text. A calibration pass against MMADecisions round data (scrapable per bout) is recommended.
8. Split-decision rate is inferred from one judge's dissent count; a direct aggregate was not available on the fetched pages.
9. Street ruleset is a design synthesis, not a sanctioned rule set; the fatality and duration figures should be validated from criminology sources before being cited in-game.
