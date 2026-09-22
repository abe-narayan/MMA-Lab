# Literature Review A: Performance Analysis, Strike Biomechanics, Physiology/Fatigue, Injury & Knockout Mechanisms

Scope: peer-reviewed evidence for a combat-sports (MMA / boxing / Muay Thai-kickboxing / judo / wrestling / BJJ) bout simulator. Every paper below was located and its abstract (or full text where open) was read via PubMed E-utilities, PMC, PLOS, Frontiers, OUP or the publisher PDF on 2026-09-22. Numbers are quoted from those sources. Where a number comes from a secondary summary rather than the primary text, it is flagged.

Notation: AE = athlete-exposure (one fighter in one bout). E:P = effort:pause ratio. HIA/LIA = high-/low-intensity activity. [La] = blood lactate (mmol/L). RA = rotational (angular) acceleration. PLA = peak linear acceleration.

---

## 0. Summary of themes and conclusions

### What the evidence agrees on

1. **Combat is intermittent, and MMA is the "slowest" striking sport.** MMA high-intensity effort to (low-intensity + pause) sits at about **1:2 to 1:4** (del Vecchio 2011; Coswig 2016: HI:LI 1:2, E:P 1:3). Kickboxing/low-kick is ~1:1 to 1:1.5 fighting:non-fighting, with HIA bursts of ~2 s (Ouergui 2014; Slimani 2017). Elite amateur boxing is near-continuous (activity:rest 18:1 elite, 9:1 novice; Slimani 2017 review) at ~20 punches/min per boxer (Davis 2015, 2018). Grappling sits between: judo combat sequences ~24-29 s with 4-9 s pauses (E:P ~2.5-3.4:1), Greco-Roman wrestling work 37 s / rest 14 s, BJJ E:P ~6:1 with ~4 s high-intensity actions.
2. **Most MMA round time is low-intensity standing.** Median standing low-intensity time per 5-min round is ~2:07-2:37 (Miarka 2016); standing high-intensity ("exchanges") totals only ~7-18 s per round, ground fighting activity ~25-53 s per round (Miarka 2018; Antoniettô 2023; Miarka 2021 female). Per round an athlete attempts a median ~35-41 strikes and lands ~18-22; ~1 takedown attempt per round (Dos Santos 2019).
3. **Head strikes decide fights.** ~32% of all UFC fights end from head trauma (Hutchison 2014: KO 6.4/100 AE + TKO 9.5/100 AE = 15.9/100 AE, 31.9% of bouts; Mańka-Malara 2022: 31.6%, 88% of KO/TKO). KO risk rises with weight class (HW ~54% of bouts ending by head-trauma vs FLW ~12.5%), earlier in the round/fight, older age, prior KOs. 54% of KOs are jaw/mandible impacts. TKO by strikes is preceded by ~18.5 strikes in the last 30 s, 92% to the head.
4. **Punch force is level- and hand-dependent, and in-fight forces are far below lab maxima.** Lab maxima: elite rear straight ~4800 N, lead ~2850 N; novice ~2380/1600 N (Smith 2000). Olympic straights on a Hybrid III: 3427 ± 811 N, hand 9.1 m/s, effective mass 2.9 kg, 58 g / 6343 rad/s² (Walilko 2005); hooks 4405 N, 11 m/s, 71 g / 9306 rad/s² (Viano 2005). In real pro bouts mean landed force is only **~870-1150 N**, 64% of punches ≤1000 N, ~88% <1500 N, only ~2-4% ≥2000 N, max 5358 N (Pierce 2006).
5. **Rotational acceleration is the KO driver.** Concussive MMA impacts ~7560 rad/s² vs 5060-7070 non-injury; boxing LOC punches ~11,280 rad/s² vs ~6150 non-LOC (Lota 2022 review). Gloves and headgear cut linear but not rotational dosage; at equal impact energy MMA glove + bare head gives *higher* rotational dosage than boxing glove + bare head (Bartsch 2012).
6. **Fatigue is real but pace is largely preserved by tactical adaptation.** [La] climbs to ~15-16 mmol/L in MMA sparring and ~15 in K-1, ~15 in wrestling; RPE and HR rise round to round. Lower-body fatigue cuts punch force and RFD, more in crosses/hooks than jabs (Dunn 2022). But punch force in pro boxing did not fall across rounds (Pierce 2006), judoka keep attack counts by cutting grip-fight time (Franchini 2019), BJJ E:P is unchanged across 4 matches while grip strength falls ~13-16% (Andreato 2013, 2015).
7. **Losers get hurt.** Losers incur ~3x injuries of winners; KO/TKO bouts ~2x the injuries of submission bouts (Lystad 2014). Lacerations are the dominant injury (37-59% of MMA injuries; 51% in pro boxing; 12% of UFC fighters per bout). Facial injury risk rises with male sex, heavier weight, more rounds, losing, non-submission finish (Jones 2023).

### What conflicts
- **Effect of fatigue on striking output.** Lab (Dunn 2022) and kickboxing (Ouergui 2013: jump/Wingate down 4-11%) show clear decrements; in-ring pro boxing (Pierce 2006) shows constant or even rising force in the last round; Davis 2018 shows winners *increase* accuracy in round 3. Resolution: model fatigue mainly as reduced *volume and output-quality variance* plus tactical shifts, not a monotonic force collapse.
- **Weight vs force.** Lab: force rises with weight class via effective mass (Walilko). In-ring: mean landed force uncorrelated with body mass (r = 0.22, Pierce). Heavier boxers throw more and deliver more cumulative force per round (82 kN vs 56 kN) but similar per-punch force.
- **Round-by-round MMA pacing.** del Vecchio 2011 found only one round difference (ground LI longer in R2 than R3); Miarka 2016 found LI standing time lowest in R3; Ouergui 2014 (kickboxing) found HIA count falls and pauses grow across rounds; Cimadoro 2018 (K-1) found blows evenly distributed 33/33/35%.
- **Concussion thresholds.** Zhang 2004 (football reconstructions) gives 50% MTBI at ~82 g / ~5900 rad/s²; Rowson & Duma 2013 (instrumented football) give a combined logistic curve where concussive impacts averaged 104 g / 4726 rad/s²; Lota 2022 quotes a 4500 rad/s² concussion threshold. None is combat-sport-specific; boxing punches produce proportionally more rotation and shorter pulses than football hits (Viano 2005), so HIC under-predicts.

### What is weak
- Almost no controlled data on **leg-kick or body-shot accumulation effects** on performance; no published dose-response for leg kicks. Only narrative biomechanics (Razm 2026).
- **Flash knockdown vs accumulated damage** is not separately quantified anywhere; the closest is Hutchison's "2.6 extra strikes / 3.5 s to stoppage" and Miele & Bailes' punch-count differences in fatal bouts.
- **Referee stoppage** has no formal model; only descriptive counts (Hutchison 2014; Miarka 2022).
- Time-motion percentages for **clinch** as a distinct phase in MMA are rarely reported (most studies code only standing vs ground).
- Nearly all MMA physiology is from **simulated** bouts with n = 8-20; official-bout blood data are scarce.
- Kick force values are from pads/dummies with heterogeneous instruments (Vagner 2023 review).

---

## 1. Performance / notational / time-motion analysis

### 1.1 MMA

**del Vecchio FB, Hirata SM, Franchini E (2011). A review of time-motion analysis and combat development in mixed martial arts matches at regional level tournaments. Perceptual and Motor Skills 112(2):639-648. doi:10.2466/05.25.PMS.112.2.639-648**
- n = 52 regional MMA athletes (24 ± 5 y, 5 ± 3 y experience). Video time-motion.
- E:P (high-intensity effort : low-intensity + pauses), intervals excluded: **1:2 to 1:4**. Only round effect: ground low-intensity time longer in R2 than R3. Most bouts ended in R3 with high-intensity actions, mostly on the ground.
- Quality: small regional sample; coding scheme coarse.
- **Sim implication:** per round, sample ~20-33% of elapsed time as high-intensity segments; remainder low-intensity/pauses. Segment the round into 3-4 high-intensity "sequences" (search summary indicates 3-4 sequences early, fewer later).

**Coswig VS, Ramos SdP, Del Vecchio FB (2016). Time-motion and biological responses in simulated mixed martial arts sparring matches. J Strength Cond Res 30(8):2156-2163. doi:10.1519/JSC.0000000000001340**
- n = 13 (25 ± 5 y, 81 kg, 39 ± 25 months MMA), 3 × 5 min, 1-min rest.
- **HI:LI = 1:2; E:P = 1:3.** [La] 4.0 ± 1.7 → 15.6 ± 4.8; glucose 80 → 157 mg/dL; CK up at 48 h; no performance-test decrement.
- **Sim implication:** confirms 1:2-1:3 as the default MMA intensity ratio; sparring-level fights reach [La] ~15 by end of R3.

**Miarka B, Vecchio FB, Camey S, Amtmann JA (2016). Comparisons: technical-tactical and time-motion analysis of mixed martial arts by outcomes. J Strength Cond Res 30(7):1975-1984. doi:10.1519/JSC.0000000000001287**
- 645 professional rounds paired winner/loser (215 pairs per round).
- Winners > losers in total strikes, submissions, positional improvements in **all rounds**. Standing low-intensity time per round: **R1 median 2:33.5 (IQR 1:20-3:56), R2 2:37 (1:24-3:59), R3 2:07 (1:06-3:39)**.
- Quality: large, pro-level, but rounds treated independently.
- **Sim implication:** base "neutral standing" time ≈ 150 s of a 300-s round with wide variance (IQR ±75 s); shave ~20 s in R3 (more urgency). Winner determination should correlate with strike volume landed, sub attempts and positional advances, in every round.

**Miarka B, Brito CJ, Moreira DG, Amtmann J (2018). Differences by ending rounds and other rounds in time-motion analysis of mixed martial arts. J Strength Cond Res 32(2):534-544. doi:10.1519/JSC.0000000000001804**
- 1,564 rounds / 678 pro bouts not decided on points.
- **KO/TKO ≈ 60% of finish rounds**; submissions >30% of finishes in R1-R2. Standing LI time in ending rounds: R1 91.5 ± 71.4 s, R2 93.4 ± 67.5 s, R3 143.2 ± 87.4 s. Standing HI time: 7.4 ± 9.2, 9.7 ± 18.0, 17.7 ± 29.1 s.
- **Sim implication:** total standing "exchange" time per round is small: mean ~7-18 s with SD ≈ mean or larger (heavily right-skewed). Finishes: draw KO/TKO with ~60% weight, submission ~30-35%, with submission share higher in R1-R2 and falling in R3.

**Antoniettô NR, Bello FD, Queiroz ACC, et al., Miarka B (2023). Suggestions for professional mixed martial arts training with pacing strategy and technical-tactical actions by rounds. J Strength Cond Res 37(6):1306-1314. doi:10.1519/JSC.0000000000003018**
- Same 1,564-round KO/TKO-ended dataset, split by ending round.
- Standing preparatory time: bouts ending R1 95.6 ± 62.9 s; R2-ending 93.6 ± 67.9 s; vs 160.5 ± 87.4 s (R2 of R3-ending) and 144.0 ± 88.5 s (R3). Ground combat activity: 23.4 ± 45.5 s and 25.3 ± 41.9 s (early finishes) vs 50.4 ± 69.9 and 52.9 ± 74.2 s (R3-ending bouts). Standing combat activity did not differ.
- **Sim implication:** early finishes are associated with *less* time spent in neutral standing (i.e., more aggression / earlier engagement), not longer exchanges. A fighter's "engagement rate" parameter should raise finish probability per round while reducing prep time.

**Miarka B, Nascimento de Carvalho G, Valenzuela Pérez DI, Aedo-Muñoz E, Brito CJ (2021). Comparisons of pacing strategy and technical-tactical behaviors in female mixed martial arts rounds. Front Psychol 11:548546. doi:10.3389/fpsyg.2020.548546**
- 74 female KO/TKO fights, 174 rounds, 13,572 sequences (2014-18).
- Per round: standing preparatory 1:51-2:27; **standing fighting 15-19 s**; ground fighting 47-52 s. Medians in ending rounds: strikes attempted 24.5 (R1 finish), 61.5 (R2), 57.5 (R3); head strikes attempted 12/48/36; landed total 15.5/36.5/30. Takedowns 1.1 ± 1.3 attempted, 0.4 ± 0.7 landed per round.
- **Sim implication:** rough per-round budget (either sex): ~55-60 strike attempts, ~30-37 landed (≈55-60% landed for "total strikes"), ~1 TD attempt with ~35-40% success. Non-ending rounds are statistically similar to each other, so keep per-round action rates roughly stationary and let fatigue/damage state modulate.

**Dos Santos DA, Miarka B, Dal Bello F, et al., Beneke R (2019). 10 years on time-motion and motor actions of paired mixed martial arts athletes. Int J Sports Physiol Perform 14(3):399-402. doi:10.1123/ijspp.2018-0566**
- 845 UFC rounds, 45 athletes compared young (34-44 y at M2 baseline) vs 10 y later.
- Younger: total strikes landed **22 (13-34)** vs 18 (10-31.7) median per round; attempted **41 (24.5-62)** vs 35; head strikes attempted 19 (9-34.5); body strikes landed 1 (0-4); takedowns attempted 1 (0-2); standing combat time 2:10 vs 1:56; low-intensity time 2:11 vs 1:56.
- **Sim implication:** per fighter per 5-min round: ~40 attempts, ~22 landed (≈54%), ~half of attempts to the head, ~1 TD attempt. Age ≥ ~40 y: -10-15% volume. Body-strike attempts have low "success value" (negative association with performance probability).

**Kirk C (2024). A 5-year analysis of age, stature and armspan in mixed martial arts. Res Q Exerc Sport 95(2):450-457. doi:10.1080/02701367.2023.2252473**
- n = 2,229 pro bouts. Winners 29.8 ± 4 y vs losers 30.7 ± 4.2 y (winners 0.82 ± 5.3 y younger). Armspan advantage only in HW (198.4 vs 196.1 cm); armspan:stature disadvantage in women's SW only. No morphological variable affected *how* bouts were won.
- **Sim implication:** reach/height should be a weak modifier (≤ a few % on distance-striking success), not a headline attribute. Age should feed a small win-probability penalty (~1-2% per year past ~30) via attribute decay.

**Ma K, Li K, Zhu Z, Shao HT (2026). Temporal trends and weight-class differences in takedown density in professional mixed martial arts: 8,461 UFC bouts, 1997-2025. BMC Sports Sci Med Rehabil 18:385. doi:10.1186/s13102-026-01804-8**
- 16,922 fighter-bouts. Men's takedowns/min declined -0.0043/yr. Winners: median TDpM 0.067 vs 0.000; **TD success 50% vs 20%**; control time per successful TD **99.8 s vs 78.9 s**. Weight-class differences tiny (ε² 0.005-0.007).
- **Sim implication:** default TD success ~35% (winner 50%, loser 20%); each successful TD yields ~80-100 s of control unless a scramble/stand-up fires; TD attempts per minute ~0.1-0.3 in modern era; do not scale TD rate by weight class.

**Mańka-Malara K, Mierzwińska-Nastalska E (2022). Head trauma exposure in mixed martial arts. Int J Environ Res Public Health 19(20):13050. doi:10.3390/ijerph192013050**
- 2,488 UFC fights (2000-21), 4,976 fighter-bouts, scorecards + video.
- **6.30 total head strikes/min and 2.41 significant head strikes/min received** per athlete (women 7.73/2.95, men 6.20/2.37). 31.6% of fights ended by head trauma (men 32.2%, women 23.1%); 88.1% of KO/TKOs involved head trauma. Head-trauma finish share by class: HW ~54%, LHW ~38%, FLW ~12.5%. Mean time to head-trauma KO 6:06 (5 s - 24:10); title fights 8:57 vs 5:30 non-title.
- **Sim implication:** each fighter absorbs ~6 head strikes/min (~2.4 "significant"); scale head-KO hazard by weight class roughly 4x from FLW to HW; median KO time ~6 min implies KO hazard is front-loaded but persistent.

### 1.2 Boxing

**Davis P, Benson PR, Pitty JD, Connorton AJ, Waldock R (2015). The activity profile of elite male amateur boxing. Int J Sports Physiol Perform 10(1):53-57. doi:10.1123/ijspp.2013-0474**
- 29 Olympic semi/finals, 39 boxers, 3 × 3 min.
- **~1.4 actions/s; ~20 punches/min; ~2.5 defensive movements/min; ~47 vertical hip movements/min**; rounds ~200 s effective. Winners: more punches landed and lower thrown:landed ratio in R3; more rear hooks landed R2-R3; fewer defensive movements.
- **Sim implication:** elite boxer output ≈ 60 punches per 3-min round; winners separate late via accuracy, not volume alone. Round 3 accuracy bonus for the fresher/better-conditioned fighter.

**Davis P, Connorton AJ, Driver S, Anderson S, Waldock R (2018). The activity profile of elite male amateur boxing after the 2013 rule changes. J Strength Cond Res 32(12):3441-3446. doi:10.1519/JSC.0000000000001864**
- 50 World Championship bouts, 60 boxers. ~1.55 actions/s; **~21 punches, ~3.6 defensive movements, ~56 hip movements per minute**. Winners threw more straight punches / lead straights in R1, more landed in R3, better thrown:landed ratio in R3 and fewer "air punches" in R2-R3.
- **Sim implication:** straight punches are the highest-value tool at range; give winners a rising accuracy curve (R1 → R3) as a fitness/skill expression; missed punches ("air") count as a fatigue cost with no score.

**Slimani M, Chaabène H, Davis P, Franchini E, Cheour F, Chamari K (2017). Performance aspects and physiological responses in male amateur boxing competitions: a brief review. J Strength Cond Res 31(4):1132-1141. doi:10.1519/JSC.0000000000001643**
- Review. Activity:rest **18:1 elite vs 9:1 novice**; novice rounds 16:1, 8:1, 6:1 (stop-time and stop-frequency increase across rounds). Winning associated with triple-punch combos, block-and-counter combos, head punches, effectiveness metrics. [La] rises R1→R3 in novices; higher in official vs simulated bouts; %HRmax and %VO2max highest in R3.
- **Sim implication:** boxing pause fraction ≈ 5% elite, 10% novice, and novices' pause fraction roughly doubles each round (6% → 11% → 14%). Combination punching (3-punch) and counters should carry extra win value.

**Pierce JD, Reinbold KA, Lyngard BC, Goldman RJ, Pastore CM (2006). Direct measurement of punch force during six professional boxing matches. J Quantitative Analysis in Sports 2(2): Article 3. doi:10.2202/1559-0410.1004**
- 12 pro boxers, 6 bouts, instrumented gloves, 1,675 landed punches.
- **Mean landed force 866.6-1149.2 N by bout; not correlated with body mass (r = 0.22).** Junior lightweights: lead 1003 N, rear 964 N (no hand difference); 64.3% of punches ≤1000 N, 87.7% <1500 N, only 7/227 ≥2000 N. Heavyweights: lead 1125 N, rear 1098 N; 50.3% <1000 N, 79.7% <1500 N, 27/443 ≥2000 N (6%). Distribution (HW): 500-999 N 50%, 1000-1499 N 29%, 1500-1999 N 14%, 2000-2499 N 4%, ≥2500 N 2%. Max punch 5358 N (cruiserweight); hardest HW punch 3554 N. Punches landed per round (both boxers): 56.8 (JLW) vs 73.8 (HW); cumulative force/round 55.7 kN vs 82.1 kN. Force did not decline across rounds (JLW last round actually higher: 1098 vs 898 N). In all 3 decisions, the boxer with more punches and more cumulative force won unanimously.
- Quality: n small, but the only in-competition direct force data.
- **Sim implication:** model landed-strike force as a right-skewed distribution (log-normal, median ≈ 950 N, ~2-6% of punches ≥2000 N, cap ≈ 5000-5500 N); this is the "power punch" tail that drives KO. Cumulative landed force + landed count is a good judge-decision proxy. Do not decay per-punch force with round number in the base model; instead reduce volume/accuracy.

**Miele VJ, Bailes JE (2007). Objectifying when to halt a boxing match: a video analysis of fatalities. Neurosurgery 60(2):307-316. doi:10.1227/01.NEU.0000249247.48299.5B**
- CompuBox comparison of fatal bouts vs 4,000 control bouts vs "classic" competitive bouts.
- Fatal bouts had significantly more punches landed/round, power punches landed/round and power punches *thrown* by losers than average bouts; but no difference vs highly competitive bouts.
- **Sim implication:** cumulative landed power punches on a fighter is a valid damage accumulator, but its false-positive rate in competitive fights is high, so referee/doctor stoppage should key on damage state (response to strikes), not counts alone.

### 1.3 Kickboxing / Muay Thai / karate

**Ouergui I, Hssin N, Haddad M, Franchini E, Behm DG, Wong DP, Gmada N, Bouhlel E (2014). Time-motion analysis of elite male kickboxing competition. J Strength Cond Res 28(12):3537-3543. doi:10.1519/JSC.0000000000000579**
- 45 World Championship bouts. **HIA 2.2 ± 1.2 s; LIA 2.3 ± 0.8 s; pauses 5.4 ± 4.3 s; 3.4 ± 1.2 s between HIAs; fighting:non-fighting 1:1.** HIA count/round 27.1, 25.1, 24.9; pause time/round 12.8, 22.3, 24.6 s (R1→R3). No weight-class effect.
- **Sim implication:** striking exchange = ~2 s burst; ~25-27 exchanges per 3-min round; inter-exchange gap ~3.4 s; pauses nearly double after R1. Exchanges/round drop ~8% from R1 to R3.

**Slimani M, Chaabene H, Miarka B, Chamari K (2017). The activity profile of elite low-kick kickboxing competition. Int J Sports Physiol Perform 12(2):182-189. doi:10.1123/ijspp.2015-0659**
- 72 kickboxers, 36 bouts. E:P ~1:1.5 overall (HW 1:1); HI actions:pause ~1:6; E:P by round 1:1, 1:1.5, ~1:2. Males: **upper limb 63.4% / lower limb 36.6% of techniques; head target 56.9% / body-leg 43.1%**; more jab-cross, fewer low kicks than females. Winners > losers in head-targeted actions, counterattacks, jab-cross, total punches. E:P did not differ winners vs losers.
- **Sim implication:** default kickboxing/MMA-striker technique mix ≈ 63% punches / 37% kicks-knees, 57% to head; counters and jab-cross are win-discriminating; effort ratio degrades 1:1 → 1:2 across rounds.

**Cimadoro G, Mahaffey R, Babault N (2018). Acute neuromuscular, cognitive and physiological responses to a Japanese kickboxing competition in semi-professional fighters. J Sports Med Phys Fitness 58(12):1720-1727. doi:10.23736/S0022-4707.17.07859-8**
- n = 8 K-1 fighters, official bouts. **86 ± 23 total blows per fight; 32.7/32.6/34.7% by round.** Punches ≈ kicks > knees. Peak [La] 15.3 ± 1.6; simple reaction time slowed post-fight; CMJ unchanged. Strikes in R1+R2 correlated with Δ[La] (r = 0.76).
- **Sim implication:** for 3 × 3 min kickboxing ~29 strikes/round/fighter, evenly spread; reaction-time (defence) degrades with accumulated strike volume/lactate; do not model leg power loss within a single bout.

**Crisafulli A, Vitelli S, Cappai I, Milia R, Tocco F, Melis F, Concu A (2009). Physiological responses and energy cost during a simulation of a Muay Thai boxing match. Appl Physiol Nutr Metab 34(2):143-150. doi:10.1139/H09-002**
- n = 10, portable gas analyser. Energy expenditure 10.75 ± 1.58 kcal/min (9.4 METs); VO2 and HR always above anaerobic threshold; CO2-excess (glycolysis index) peaks in R1 (636 mL/min) then falls as aerobic supply rises.
- **Sim implication:** anaerobic "burst" capacity is drawn heavily in R1 and thereafter fighters ride aerobic supply; implement a fast-recharging anaerobic pool plus a slow aerobic ceiling.

**Chaabène H, Mkaouer B, Franchini E, et al. (2014). Physiological responses and performance analysis difference between official and simulated karate combat conditions. Asian J Sports Med 5(1):21-29. PMID 24868428**
- n = 10 elite. Official: activity 10.0 s / rest 16.2 s (E:R 1:1.5); high-intensity actions 1.5 ± 0.3 s (HI:rest 1:11); 14 ± 6 HI actions per match; [La] 11.1 official vs 7.8 simulated; RPE 14 vs 12.
- **Sim implication:** point-fighting reference: HI bursts ~1.5 s. Official bouts run ~40% more lactate than sparring: apply an "official bout" intensity multiplier ~1.3-1.4 when calibrating from sparring data.

### 1.4 Judo

**Sterkowicz-Przybycień K, Miarka B, Fukuda DH (2017). Sex and weight category differences in time-motion analysis of elite judo athletes. J Strength Cond Res 31(3):817-825. doi:10.1519/JSC.0000000000001597**
- 1,411 matches (2012 Olympic qualifiers), 111,203 situations. **Individual combat sequence median 23.9-28.5 s; pause 4.0-8.8 s.** Heavyweights: longer groundwork and pauses.
- **Sim implication:** judo/grappling standing engagement cycle ≈ 26 s combat + 6 s reset; heavyweights +pause and +ground time.

**Miarka B, Panissa VL, Julio UF, Del Vecchio FB, Calmet M, Franchini E (2012). A comparison of time-motion performance between age groups in judo matches. J Sports Sci 30(9):899-905. doi:10.1080/02640414.2012.679675**
- 1,811 matches across age groups. Median **7 (IQR 3-12) combat/pause cycles per match**; seniors have the longest groundwork time.
- **Sim implication:** judo match ≈ 7 engagement cycles; ground phases ~10-20% of seniors' match.

**Barreto LBM, Miarka B, et al., Brito CJ (2022). The effects of weight categories on the time-motion analysis of female high-level judo athletes between the 2016 and 2020 Olympic cycles. Front Psychol 13:1012517. doi:10.3389/fpsyg.2022.1012517**
- 1,332 combats. **E:P 2.5:1-3.4:1 (2016), 2.8:1-3:1 (2020)**; 2020 rules reduced gripping, attack, defence, groundwork and pause times.
- **Sim implication:** grappling E:P ~3:1; rule set should be a parameter that shifts phase durations.

### 1.5 Wrestling

**Nilsson J, Csergö S, Gullstrand L, Tveit P, Refsnes PE (2002). Work-time profile, blood lactate concentration and rating of perceived exertion in the 1998 Greco-Roman Wrestling World Championship. J Sports Sci 20(11):939-945. doi:10.1080/026404102320761822**
- 42 senior wrestlers, 94 matches. Match 427 s (324-535); **work 317 s, rest 110 s; mean work period 37.2 s, rest 13.8 s**. [La] 14.8 (6.9-20.6), higher in long matches; RPE 13.8; forearm flexors most fatigued (53%), deltoids 17%, biceps 12%.
- **Sim implication:** wrestling/clinch work bouts ~37 s with ~14 s resets; grip/forearm fatigue is the dominant local fatigue channel for clinch and ground control.

**Kraemer WJ, Fry AC, Rubin MR, et al. (2001). Physiological and performance responses to tournament wrestling. Med Sci Sports Exerc 33(8):1367-1378. doi:10.1097/00005768-200108000-00019**
- 12 D-I wrestlers, 6% weight loss, 2-day simulated tournament. Lower-body power and upper-body isometric strength fell progressively; lactate, cortisol, catecholamines rose after every match; resting testosterone fell in later matches.
- **Sim implication:** multi-bout tournament mode should carry over a strength/power deficit (a few % per match) that does not fully recover same-day.

### 1.6 Brazilian jiu-jitsu

**Andreato LV, Franchini E, de Moraes SM, et al. (2013). Physiological and technical-tactical analysis in Brazilian jiu-jitsu competition. Asian J Sports Med 4(2):137-143. doi:10.5812/asjsm.34496**
- 35 athletes (white-brown belt), 22 regional fights. **E:P 6:1; HI actions ~4 s; LI:HI 8:1.** [La] 4.4 → 10.1; handgrip 45.9 → 40.1 kgf (R, -13%), 44.2 → 37.0 (L, -16%); RPE 15.
- **Sim implication:** BJJ/ground phases are mostly continuous moderate work with brief 4-s bursts every ~30 s; grip strength decays ~15% per 10-min match, which should raise submission-escape and sweep-failure odds late.

**Andreato LV, Julio UF, Panissa VLG, et al., Franchini E (2015). Brazilian jiu-jitsu simulated competition part II: physical performance, time-motion, technical-tactical analyses, and perceptual responses. J Strength Cond Res 29(7):2015-2025. doi:10.1519/JSC.0000000000000819**
- n = 10, 4 × 10-min matches. Handgrip fell after matches 3-4; **E:P unchanged across matches**; RPE, recovery, reaction time, flexibility unchanged; CMJ showed post-activation potentiation after match 2.
- **Sim implication:** across a tournament, keep BJJ pacing constant but degrade grip-dependent success rates; no need to slow the time structure.

**Andreato LV, Lara FJD, Andrade A, Branco BHM (2017). Physical and physiological profiles of Brazilian jiu-jitsu athletes: a systematic review. Sports Med Open 3:9. doi:10.1186/s40798-016-0069-5**
- 58 studies, 1,496 subjects. VO2max 42-52 mL/kg/min; aerobic fitness does not discriminate level; maximal, isometric and endurance strength associate with success; 4-6 matches per competition day.
- **Sim implication:** for grapplers, strength/grip-endurance attributes should weigh more than aerobic capacity in ground-phase resolution.

---

## 2. Strike biomechanics and impact forces

**Smith MS, Dyson RJ, Hale T, Janaway L (2000). Development of a boxing dynamometer and its punch force discrimination efficacy. J Sports Sci 18(6):445-450. doi:10.1080/02640410050074377**
- 7 elite, 8 intermediate, 8 novice boxers, straight punches on a manikin dynamometer.
- Rear hand: **4800 ± 227 / 3722 ± 133 / 2381 ± 116 N**; lead hand: **2847 ± 225 / 2283 ± 126 / 1604 ± 97 N** (elite/intermediate/novice). Rear > lead for all (p < .001).
- **Sim implication:** peak (lab) punch force scales ≈ linearly with skill tier: novice 0.5, intermediate 0.78, elite 1.0 of max. Rear straight ≈ 1.6-1.7 × lead straight. Use these as the *ceiling* of the per-punch force distribution; in-fight median is ~25-30% of ceiling (Pierce 2006).

**Walilko TJ, Viano DC, Bir CA (2005). Biomechanics of the head for Olympic boxer punches to the face. Br J Sports Med 39(10):710-719. doi:10.1136/bjsm.2004.014126**
- 7 Olympic boxers (5 weight classes), 18 straight punches to Hybrid III frangible face.
- **Force 3427 ± 811 N; hand velocity 9.14 ± 2.06 m/s; effective mass 2.9 ± 2.0 kg; jaw load 876 ± 288 N; PLA 58 ± 13 g; RA 6343 ± 1789 rad/s²; neck shear 994 ± 318 N.** Force rises with weight class mainly via effective mass.
- **Sim implication:** head acceleration from a clean straight ≈ 58 g / 6300 rad/s² at Olympic level; scale with (effective mass × hand velocity). Effective mass ~2-4 kg (3-4% of body mass) for straights; weight-class scaling enters through effective mass, not velocity.

**Viano DC, Casson IR, Pellman EJ, Bir CA, Zhang L, Sherman DC, Boitano MA (2005). Concussion in professional football: comparison with boxing head impacts - part 10. Neurosurgery 57(6):1154-1172. doi:10.1227/01.neu.0000187541.87937.d9**
- 11 Olympic boxers (51-130 kg), 78 blows (hooks, uppercuts, straights to forehead/jaw), Hybrid III + FE brain model.
- **Hook: hand Δv 11.0 ± 3.4 m/s; force 4405 ± 2318 N; PLA 71.2 ± 32.2 g; RA 9306 ± 4485 rad/s²; neck 855 N** - levels consistent with NFL concussions, but HIC lower (shorter pulse). Boxing punches give proportionally more rotational than translational acceleration; effective radius 65 mm vs 34 mm in football. Peak brain strain in the midbrain, late in the pulse.
- **Sim implication:** hooks are the highest-rotation punch (≈ 1.5 × straight RA) - give hooks/overhands the highest per-landed-strike KO coefficient, straights the highest accuracy, uppercuts intermediate. Use RA (not HIC) as the KO driver.

**Liu Y, et al. (2022). Biomechanics of the lead straight punch of different level boxers. Front Physiol 13:1015154. doi:10.3389/fphys.2022.1015154**
- Elite (n = 8, 24 y) vs junior (n = 8, 17 y). Lead straight: **peak fist velocity 7.16 ± 0.48 vs 6.32 ± 0.42 m/s; contact velocity 5.56 vs 4.87 m/s; peak force 1508 ± 411 vs 1035 ± 220 N (21.0 vs 15.6 N/kg)**; impulse 24.7 vs 16.8 N·ms; lead-leg RFD 16.9 vs 10.3 N/ms.
- **Sim implication:** jab ≈ 1000-1500 N, ~30-45% of rear-hand max; elite jab ≈ 1.45 × junior; leg-drive (RFD) attribute should modulate punch force ~ +40% elite vs developing.

**Dinu D, Louis J (2020). Biomechanical analysis of the cross, hook, and uppercut in junior vs. elite boxers. Front Sports Act Living 2:598861. doi:10.3389/fspor.2020.598861**
- 15 elite (potential Olympic medallists) vs 8 juniors; 17-IMU suit. Elite produced more force at higher velocity for all three punches; juniors rely more on shoulder contribution; cross has front/rear foot GRF split ~60/40.
- **Sim implication:** skill tier raises both force and velocity for every punch type; technique attribute could be modelled as "kinetic-chain efficiency" multiplying force.

**Wan J, Liu Y (2026). Kinematic and kinetic differences between lead and rear straight punches in elite boxers. BMC Sports Sci Med Rehabil 18:292. doi:10.1186/s13102-026-01738-1**
- 17 elite orthodox boxers, Vicon + force plates + force target. Lead straight: shorter completion time; rear straight: greater trunk ROM and rotational velocity, **higher peak force, peak velocity and impact velocity** (p < .05).
- **Sim implication:** lead hand = speed/low-telegraph (higher land probability, lower damage); rear hand = power (lower land probability, higher damage). Give jabs ~+10-15% hit chance and ~0.5-0.6× damage relative to the cross.

**Loturco I, Nakamura FY, Artioli GG, et al., Franchini E (2016). Strength and power qualities are highly associated with punching impact in elite amateur boxers. J Strength Cond Res 30(1):109-116. doi:10.1519/JSC.0000000000001075**
- 15 Brazilian national team (9 M, 6 F). Impact ↑ for males and for self-selected vs fixed distance (jab). Correlations of impact with jump/squat/bench power **r = 0.67-0.85**; lower-limb power the strongest.
- **Sim implication:** "power" attribute can be a single scalar dominated by lower-body power; distance choice affects jab impact (self-selected > fixed) - fighters fighting at their preferred range hit harder.

**Loturco I, Pereira LA, Kobal R, et al., McGuigan M (2021). Transference effect of short-term optimum power load training on the punching impact of elite boxers. J Strength Cond Res 35(9):2373-2378. doi:10.1519/JSC.0000000000003165**
- n = 8; one week OPL training: punch impact +~8%, jump-squat/half-squat power +12-14%; transfer coefficient ~0.80.
- **Sim implication:** training/camp effects on strike power are modest per block (~5-10%); useful for career-mode tuning.

**Lenetsky S, Nates RJ, Brughelli M, Harris NK (2015). Is effective mass in combat sports punching above its weight? Hum Mov Sci 40:89-97. doi:10.1016/j.humov.2014.11.016**
- Review of effective mass, double-peak muscle activation (joint stiffening at impact), calculation methods. Argues punching adds force *during* impact beyond a rigid-mass model.
- **Sim implication:** treat impact "quality" as effective mass × velocity with a stiffness term; a "commitment/plant" state (feet set, no retreat) multiplies effective mass; strikes thrown while moving backward get reduced effective mass.

**Dunn EC, Humberstone CE, Franchini E, Iredale FK, Blazevich AJ (2022). The effect of fatiguing lower-body exercise on punch forces in highly-trained boxers. Eur J Sport Sci 22(7):964-972. doi:10.1080/17461391.2021.1916085**
- 28 highly trained amateur boxers; 3-min max punch test before/after 9 × 1-min rowing. **Significant force reductions for all punch types; RFD delayed for all except the jab**; larger effect in crosses and hooks (trunk rotation) than jab.
- **Sim implication:** lower-body/trunk fatigue reduces rear-hand and hook force and speed more than jab; implement fatigue → force multiplier that is ~2× stronger for rotational punches (cross/hook) than for the jab.

**Gavagan CJ, Sayers MGL (2017). A biomechanical analysis of the roundhouse kicking technique of expert practitioners: a comparison between Muay Thai, Karate, and Taekwondo. PLoS ONE 12(8):e0182645. doi:10.1371/journal.pone.0182645**
- 8 experts per style, 500 Hz mocap, strain-gauge pad. **Impact force: Muay Thai 1400 ± 419 N, Karate 1211 ± 219 N, TKD 1547 ± 530 N** (n.s.); foot velocity at impact 7.22 / 5.57 / 6.36 m/s; max foot velocity 13.2-14.7 m/s; **execution time Muay Thai 1.02 ± 0.15 s vs TKD 1.54 ± 0.52 s**. Foot velocity at impact ↔ force r = 0.66.
- **Sim implication:** roundhouse kick ≈ 1200-1550 N on a pad (comparable to a hard punch in-ring) but with ~1.0-1.5 s execution (telegraph/commit window vs ~0.1-0.3 s punch); Muay Thai style = fastest, highest relative force. Kick landing probability should be lower than punches at equal skill, but damage comparable or higher per landed kick.

**Vagner M, Cleather DJ, Olah V, Vacek J, Stastny P (2023). A systematic review of dynamic forces and kinematic indicators of front and roundhouse kicks across varied conditions and participant experience. Sports (Basel) 11(8):141. doi:10.3390/sports11080141**
- 43 articles. **Front kick impact force 47% / 92% / 120% higher than roundhouse (novice / sub-elite / elite); roundhouse max foot velocity 44-48% higher than front kick.**
- **Sim implication:** front kick / teep = push/force tool (body damage, distance control); roundhouse = speed tool. Elite widens the gap.

**Falco C, Alvarez O, Castillo I, et al. (2009). Influence of the distance in a roundhouse kick's execution time and impact force in Taekwondo. J Biomech 42(3):242-248. doi:10.1016/j.jbiomech.2008.10.041**
- 31 TKD athletes (expert vs novice). Experts: impact force independent of distance; novices: force correlates with body mass (p < .01); experts faster at all three distances.
- **Sim implication:** for novices scale kick force with body mass; for experts make force distance-invariant but execution time distance-dependent.

**Estevan I, Alvarez O, Falco C, Molina-García J, Castillo I (2011). Impact force and time analysis influenced by execution distance in a roundhouse kick to the head in taekwondo. J Strength Cond Res 25(10):2851-2856. doi:10.1519/JSC.0b013e318207ef72**
- 27 male TKD (13 medallists, 14 non). Medallists kick harder and faster from any distance other than their preferred combat distance; non-medallists' timing suffers with distance change.
- **Sim implication:** range mismatch penalises low-skill strikers' speed/timing much more than high-skill; implement a "range comfort" term scaled by (1 - skill).

**Bartsch AJ, Benzel EC, Miele VJ, Morr DR, Prakash V (2012). Boxing and mixed martial arts: preliminary traumatic neuromechanical injury risk analyses from laboratory impact dosage data. J Neurosurg 116(5):1070-1080. doi:10.3171/2011.12.JNS111478**
- Hybrid III, 54 pendulum hook impacts at 27-29 J and 54-58 J; MMA glove, boxing glove, headgear conditions; 17 risk metrics + FE brain.
- **All padding reduced linear but not rotational dosage. MMA glove + bare head produced higher rotational dosage than boxing glove + bare head at equal energy.** Boxing glove + headgear best overall. FE showed brain-strain risk despite reduced linear dosage.
- **Sim implication:** glove type modifies linear-damage (cuts/fractures) more than KO risk; MMA gloves: KO coefficient ≥ boxing gloves (suggest ×1.1-1.2 rotational), cut probability higher (thin padding, exposed knuckle - see injury section).

**Stojsih S, Boitano M, Wilhelm M, Bir C (2010). A prospective study of punch biomechanics and cognitive function for amateur boxers. Br J Sports Med 44(10):725-730. doi:10.1136/bjsm.2008.052845**
- 30 M + 30 F amateur boxers, instrumented headgear, 4 × 2-min sparring. **Peak PLA 191 g (M) / 184 g (F); peak RA 17,156 / 13,113 rad/s²; peak HIC 1652 / 1079.** Majority of impacts under mild-TBI thresholds; only delayed-memory score fell post-bout.
- **Sim implication:** the *tail* of the head-impact distribution in sparring reaches 2-3× concussive means; sample per-strike acceleration from a heavy-tailed distribution so rare "perfect" shots can exceed thresholds even from lighter fighters.

**Le Flao E, Lenetsky S, Siegmund GP, Borotkanics R (2024). Capturing head impacts in boxing: a video-based comparison of three wearable sensors. Ann Biomed Eng 52(2):270-281. doi:10.1007/s10439-023-03369-w**
- 7 boxers, 115 sparring rounds, **5,168 video-identified head contacts (~45 per round)**; mouthguard sensitivity 35%, skin patch 86%, headgear patch 78%.
- **Sim implication:** sparring-level head-contact rate ~45/round (2-min) is far above competition's ~6/min; sensor-derived exposure studies under-count. Use video-coded competition rates (Mańka-Malara) for the sim.

---

## 3. Physiological demands, fatigue, recovery

**Ghoul N, Tabben M, Miarka B, Tourny C, Chamari K, Coquart J (2019). Mixed martial arts induces significant fatigue and muscle damage up to 24 hours post-combat. J Strength Cond Res 33(6):1570-1579. doi:10.1519/JSC.0000000000002078**
- 12 fighters, 3 × 5-min simulated MMA. HR, RPE, [La] high during; leukocytes, cortisol, LDH, uric acid elevated; CMJ lower at 30 min; damage markers persist 24 h.
- **Sim implication:** post-fight recovery state ≥ 24-48 h (career mode); within-fight, CMJ-type power loss appears by the end of R3.

**Folhes O, Reis VM, Marques DL, Neiva HP, Marques MC (2023). Influence of the competitive level and weight class on technical performance and physiological and psychophysiological responses during simulated MMA fights. J Hum Kinet 86:205-215. doi:10.5114/jhk/159453**
- 20 male MMA (HW elite 6, LW elite 3, HW pro 4, LW pro 7), four 3 × 5-min bouts. LW elite landed more offensive touches than LW pro; HW pro had higher HR after R1 than LW pro, but LW pro HR rose more R1→R2; no [La] differences; RPE higher in pro than elite (R1, R3) while LW elite showed larger RPE rise across rounds.
- **Sim implication:** heavier fighters start at higher relative HR (higher early cost per action); lighter fighters escalate through rounds. Elite skill = more output at same/lower perceived cost: map RPE cost per action inversely to skill.

**James LP, Haff GG, Kelly VG, Beckman EM (2016). Towards a determination of the physiological characteristics distinguishing successful mixed martial arts athletes: a systematic review. Sports Med 46(10):1525-1551. doi:10.1007/s40279-016-0493-1**
- 23 studies across MMA and feeder sports. Strength, neuromuscular power and anaerobic variables discriminate higher- from lower-level athletes; aerobic power less so.
- **Sim implication:** attribute weighting for level differences: strength/power/anaerobic > aerobic.

**Kirk C, Clark DR, Langan-Evans C, Morton JP (2020). The physical demands of mixed martial arts: a narrative review using the ARMSS model. J Sports Sci 38(24):2819-2841. doi:10.1080/02640414.2020.1802093**
- 70 articles; MMA research mostly descriptive; internal/external loads of competition not adequately identified; predictors of success not established.
- **Sim implication:** treat all MMA-specific tuning numbers as priors to be validated against fight-record data, not as established facts.

**Slimani M, Davis P, Franchini E, Moalla W (2017). Rating of perceived exertion for quantification of training and combat loads during combat sport-specific activities: a short review. J Strength Cond Res 31(10):2889-2902. doi:10.1519/JSC.0000000000002047**
- RPE higher in MMA than BJJ or kickboxing matches; RPE-[La] r = 0.81 in striking vs 0.53 in grappling; RPE-HR training-load correlations 0.52-0.95.
- **Sim implication:** a single "exertion" state can be driven by lactate-like accumulation for strikers, but grapplers need an extra isometric/grip fatigue channel that RPE/lactate misses.

**Finlay MJ, Greig M, Page RM (2018). Quantifying the physical response to a contemporary amateur boxing simulation. J Strength Cond Res 32(4):1005-1012. doi:10.1519/JSC.0000000000001926**
- 9 elite amateurs, 3 × 3-min notational-analysis-based protocol. [La] 2.4 → 3.3 → 4.3 by round; HRavg 150 → 156 → ~150+ (peak 162 → 166 → 169 bpm).
- **Sim implication:** a shadow/boxing-pattern protocol without contact produces mild lactate; real bouts run 2-4× higher (see Slimani review, Cimadoro). Contact and opponent pressure are the main metabolic multipliers.

**Ouergui I, Hammouda O, Chtourou H, Zarrouk N, Rebai H, Chaouachi A (2013). Anaerobic upper and lower body power measurements and perception of fatigue during a kick boxing match. J Sports Med Phys Fitness 53(5):455-460. PMID 23903524**
- 18 kickboxers, 3 × 2-min sparring. **SJ 27.9 → 25.3 cm (-9%), CMJ 29.8 → 28.5 (-4%); arm Wingate PP 5.89 → 5.26 W/kg (-11%), MP 4.51 → 4.12 (-9%)**; [La], HR, RPE rose each round.
- **Sim implication:** within a 3-round striking bout, lower-body explosive output falls ~5-10% and upper-body anaerobic power ~10%: cap fatigue-driven force loss around 10% by end of R3 for a normally conditioned fighter (more if pace is extreme).

**Ouergui I, Benyoussef A, Houcine N, et al. (2021). Physiological responses and time-motion analysis of kickboxing: differences between full contact, light contact, and point fighting contests. J Strength Cond Res 35(9):2558-2563. doi:10.1519/JSC.0000000000003190**
- More time in HR zones 4-5 (80-100% HRmax) than lower zones; HIA < LIA; full contact elicits more HIA than point fighting in every round; RPE higher for light/full contact.
- **Sim implication:** HR should sit ≥ 85% HRmax for most of a full-contact round; ruleset (full vs light contact) alters HIA count.

**Franchini E, Takito MY, Alves ED, Shiroma SA, Julio UF, Humberstone C (2019). Effects of different fatigue levels on physiological responses and pacing in judo matches. J Strength Cond Res 33(3):783-792. doi:10.1519/JSC.0000000000003006**
- 12 judoka, 3 × 4-min matches after warm-up / 90-min session / all-out uchi-komi HIIT. Pre-fatigue changed HR, [La], recovery perception, but **attacks, feints and RPE were preserved**; athletes cut grip-dispute time and increased no-contact displacement.
- **Sim implication:** fatigued grapplers keep attack frequency but spend more time disengaged and less time in grip battles; implement fatigue → longer "reset/circling" segments rather than fewer attacks.

**Franchini E, Del Vecchio FB, Matsushigue KA, Artioli GG (2011). Physiological profiles of elite judo athletes. Sports Med 41(2):147-166. doi:10.2165/11538580-000000000-00000**
- VO2max ~50-55 (M) / 40-45 (F) mL/kg/min; heavyweights lower aerobic power; upper-body anaerobic power/capacity discriminates elite; aerobic power does not.
- **Sim implication:** heavyweight grapplers: lower aerobic ceiling (-10-15%); upper-body anaerobic capacity is a key grappling attribute.

**Franchini E (2020). High-intensity interval training prescription for combat-sport athletes. Int J Sports Physiol Perform 15(6):767-776. doi:10.1123/ijspp.2020-0289**
- Synthesises E:P and HIA/LIA structure across combat sports as the basis for training prescription.
- **Sim implication:** supports modelling every discipline as HIA/LIA/pause state machine with sport-specific ratios.

---

## 4. Injury, knockout mechanisms, stoppages

**Hutchison MG, Lawrence DW, Cusimano MD, Schweizer TA (2014). Head trauma in mixed martial arts. Am J Sports Med 42(6):1352-1358. doi:10.1177/0363546514526151**
- All KO/TKO from numbered UFC events 2006-12 (n = 844 bouts), logistic regression + video.
- **KO 6.4/100 AE (12.7% of bouts); TKO-by-strikes 9.5/100 AE (19.1%); combined 15.9/100 AE (31.9%).** Risk factors: heavier weight class, earlier in round, earlier round, older age (both); match significance and prior KO/TKO (KO). **All KOs from direct head impact; 53.9% to the mandibular region. KO strike → stoppage 3.5 s (0-20 s) with 2.6 (0-20) additional head strikes. TKO: 18.5 (5-46) strikes in final 30 s, 92.3% to head.**
- **Sim implication:** base per-bout P(KO) ≈ 0.13, P(TKO strikes) ≈ 0.19 in UFC-level 3-round fights. Jaw hits carry ~2× KO coefficient vs other head zones. After a KO-quality strike, allow 0-20 s (mean 3.5 s) and 0-20 (mean 2.6) follow-up strikes before stoppage - this is the "damage after the KO" window. TKO rule: ~15-20 strikes landed with ~90% to head within 30 s on a fighter not intelligently defending.

**Lawrence DW, Hutchison MG, Cusimano MD, Singh T, Li L (2014). Interrater agreement of an observational tool to code knockouts and technical knockouts in mixed martial arts. Clin J Sport Med 24(5):397-402. doi:10.1097/JSM.0000000000000047**
- MMA-KT 20-factor coding tool; mean κ 0.86 (0.59-1.0) across 125 KO/TKO events.
- **Sim implication:** the situational factors used (competitor state, mechanism, follow-up strikes) are reliably codable; useful template for the sim's event log schema.

**Miarka B, Soto DAS, Aedo-Muñoz EA, et al., Brito CJ (2022). Concussion vs. resignation by submission: technical-tactical behavior analysis considering injury in mixed martial arts. Front Neurol 13:941829. doi:10.3389/fneur.2022.941829**
- 990 concussion-ended rounds vs 627 submission-ended. ~90% of concussions from head trauma. Concussion rounds: **distance head strikes 13 (6-25) vs 9 (4-18)**; clinch head strikes 1 (0-4) vs 1 (0-3); ground head strikes 1 (0-8) vs 2 (0-10); takedowns 0 (0-1) vs 1 (0-2).
- **Sim implication:** distance striking is the main KO channel (median 13 distance head strikes landed in a KO round); rounds with a takedown skew toward submission finishes.

**Brown DA, Gross G (2025). Assessing the incidence of head trauma in Australian mixed martial arts. Sports Health 17(4):689-696. doi:10.1177/19417381241263332**
- 143 events 2020-23, video. Head-strike KO/TKO: **male amateur 16.6, male pro 18.7, female amateur 12.6, female pro 7.4 per 100 AE**; 34% of male vs 23% of female bouts; LHW/HW at greater odds.
- **Sim implication:** amateur vs pro head-KO rates are similar for men (~17-19/100 AE); women ~40-60% of men's rate; heavy divisions elevated.

**Fares MY, Salhab HA, Fares J, et al. (2021). Craniofacial and traumatic brain injuries in mixed martial arts. Phys Sportsmed 49(4):420-428. doi:10.1080/00913847.2020.1847623**
- 816 UFC fighters (NSAC 2016-19), 288 head injuries in 408 fights: **35/100 AE head injuries; TBI 16/100 AE** (> fractures); males 37 vs females 23/100 AE; KO/TKO finishes had the highest head injury rate; rates increase with weight division.
- **Sim implication:** ~1 in 6 fighter-bouts ends with a recorded TBI; ~1 in 3 with some head injury. Tie post-fight injury generation to finish type and weight class.

**Lystad RP, Gregory K, Wilson J (2014). The epidemiology of injuries in mixed martial arts: a systematic review and meta-analysis. Orthop J Sports Med 2(1):2325967113518492. doi:10.1177/2325967113518492**
- 6 studies. Pooled injury incidence **228.7/1000 AE (95% CI 110-474)**. Head 66.8-78.0% of injuries; wrist/hand 6-12%. Types: laceration 36.7-59.4%, fracture 7.4-43.3%, concussion 3.8-20.4%. **Losers 3× injuries of winners; KO/TKO bouts >2× injuries of submission bouts.**
- **Sim implication:** P(any recorded injury | fighter-bout) ≈ 0.23; conditional split ~50% laceration, ~20% fracture, ~12% concussion; multiply for losers ×3 and KO/TKO bouts ×2.

**Thomas RE, Thomas BC (2018). Systematic review of injuries in mixed martial arts. Phys Sportsmed 46(2):155-167. doi:10.1080/00913847.2018.1430451**
- 5,374 male / 108 female fighters. Weighted injury rate 246.4/1000 AE (M), 101.9 (F); pros 135.5 vs amateurs 71.0/1000 AE; stoppage reasons (per 1000 AE): KO/TKO 173.9 (M), submission 228.6, decision 98.2 in the compiled sample.
- **Sim implication:** amateur injury rate ≈ half of pro; older regional samples show submissions ≥ KO/TKO as a finish type - finish-type mix must be a ruleset/level parameter (UFC-modern: KO/TKO ~31%, sub ~18%, decision ~50%).

**Fares MY, Stadler R, Mao J, et al. (2026). Technical and medical trends of upper limb submissions in mixed martial arts. J Sports Med Phys Fitness 66(8):915-923. doi:10.23736/S0022-4707.26.17426-X**
- 2,859 UFC PPV fights: **523 submissions (18.3%)**; upper-limb 18.5% of subs (armbar 67% of those); women 3× more likely to finish by upper-limb sub; time from grappling initiation to submission has lengthened over the years; 7 serious injuries / 97.
- **Sim implication:** modern UFC submission share ≈ 18% of bouts; ~80% of subs are chokes/lower-limb, ~18% arm attacks; serious injury from a sub ≈ 7%.

**Ross AJ, Ross BJ, Zeoli TC, Brown SM, Mulcahey MK (2021). Injury profile of mixed martial arts competitions in the United States. Orthop J Sports Med 9(3). doi:10.1177/2325967121991560**
- 503 contests (WI/AZ 2018-19). 57% of matches had ≥1 injury (pro 68%, amateur 51%). **Losers 48% vs winners 24% injured.** Pros more lacerations (39% vs 23%), amateurs more contusions; winners more fractures (19% vs 9%; hand), losers more concussions (17% vs 2%).
- **Sim implication:** per bout, ~50% chance loser is injured, ~25% for winner; winner injuries skew to hand fractures (from hitting), loser to concussion/laceration.

**Curran-Sills G, Abedin T (2018). Risk factors associated with injury and concussion in sanctioned amateur and professional mixed martial arts bouts in Calgary, Alberta. BMJ Open Sport Exerc Med 4:e000348. doi:10.1136/bmjsem-2018-000348**
- 2010-15 records. Injury 23.6/100 AE; **4.1 injuries per 100 min exposure; concussion 14.7/100 AE**; head most common; KO/TKO/corner/physician stoppages predicted injury.
- **Sim implication:** injury hazard ≈ 0.04 per fighter-minute; concussion ≈ 0.15 per fighter-bout.

**McClain R, Wasserman J, Mayfield C, Berry AC, Grenier G, Suminski RR (2014). Injury profile of mixed martial arts competitors. Clin J Sport Med 24(6):497-501. doi:10.1097/JSM.0000000000000078**
- 711 bouts, 1,422 fight participations (KS/MO). Injury 8.5% of participations / 5.6% of rounds; higher for pro, more rounds, KO/TKO; men more altered-mental-state injuries.
- **Sim implication:** lower bound on injury rate for regional/amateur cards (~0.09 per fighter-bout); injury hazard per round ~0.056.

**Ngai KM, Levy F, Hsu EB (2008). Injury trends in sanctioned mixed martial arts competition: a 5-year review from 2002 to 2007. Br J Sports Med 42(8):686-689. doi:10.1136/bjsm.2007.044891**
- 635 pro bouts, 1,270 exposures (Nevada). Injury **23.6/100 fight participations**; lacerations and upper-limb most common; **severe concussion 15.4/1000 AE (3% of matches)**; age/weight/experience not predictive.
- **Sim implication:** "severe" concussion (loss of consciousness-type KO) ≈ 1.5% of fighter-bouts, ~3% of bouts in early sanctioned MMA; use as the floor for the LOC-type KO.

**Jones AJ, Hasnain F, Shipchandler TZ, Vernon DJ, Elghouche AN (2023). Characteristics of facial trauma in professional mixed martial arts. Facial Plast Surg Aesthet Med 25(4):332-337. doi:10.1089/fpsam.2022.0097**
- 1,462 UFC fighters (NSAC 2010-20). Fights: ≥3 rounds 59.4%; decision 50.5%, KO 31.2%. **Facial injury 15.8% of fighters: lacerations 12.0%, fractures 3.6%.** Predictors: male, heavier, more rounds, losing, non-submission outcome.
- **Sim implication:** per fighter-bout P(cut) ≈ 0.12, P(facial fracture) ≈ 0.036, rising with rounds fought and weight; submissions protect against facial injury.

**Bledsoe GH, Li G, Levy F (2005). Injury risk in professional boxing. South Med J 98(10):994-998. doi:10.1097/01.smj.0000182498.19288.e2**
- 524 pro bouts (Nevada 2001-03). **17.1 injuries/100 boxer-matches; 3.4/100 boxer-rounds**; facial laceration 51%, hand 17%, eye 14%, nose 5%; men 3.6 vs women 1.2 per 100 boxer-rounds; losers ~2× risk; KO losers 2× other losers; men more KO/TKO.
- **Sim implication:** boxing cut hazard ≈ 1.7% per boxer-round (3.4% injury/round × 51%); hand injury ≈ 0.6% per boxer-round for the puncher.

**Baird LC, Newman CB, Volk H, Svinth JR, Conklin J, Levy ML (2010). Mortality resulting from head injury in professional boxing. Neurosurgery 67(5):1444-1450. doi:10.1227/NEU.0b013e3181e5e2cd**
- 339 deaths 1950-2007; 64% associated with KO, 15% TKO; more in lower weight classes; 61% collapsed in ring; decline after 1983 attributed to exposure reduction and medical oversight, not the 15→12 round change.
- **Sim implication:** catastrophic outcomes are rare and not needed in the core loop; if modelled, tie to cumulative concussive load across career and KO endings, not to weight class.

**Lota KS, Malliaropoulos N, Blach W, et al., Maffulli N (2022). Rotational head acceleration and traumatic brain injury in combat sports: a systematic review. Br Med Bull 141(1):33-46. doi:10.1093/bmb/ldac002**
- 22 studies. RA ranges: boxing hooks 1,740-9,306; boxing front/jaw impacts 1,530-14,065 / 6,896-8,605; MMA hook 5,550; MMA competition impacts 3,773 vs sparring 1,766; judo throws 276-5,081 (mostly below thresholds); TKD turning kick 10,927, roundhouse 5,908 peak; straight punch 9,556 rad/s². **Concussive MMA impacts 7,561 vs non-injury 5,056-7,070 rad/s²; boxing LOC punches 11,280 vs 6,146 non-LOC.** Threshold cited: concussion ~4,500 rad/s²; DAI/ASDH ~10,000 rad/s². Direct head strikes ≫ throws/takedowns.
- **Sim implication:** map strike → RA: jab ~3-5k, cross ~6-7k, hook ~7-9k (elite max), head kick 6-11k; being thrown/taken down ~0.3-5k (rarely concussive). P(KO | strike) as a logistic in RA with midpoint ~8,000-9,000 rad/s² (between the non-injury and LOC means) and LOC nearly certain above ~11-12k.

**Rowson S, Duma SM (2013). Brain injury prediction: assessing the combined probability of concussion using linear and rotational head acceleration. Ann Biomed Eng 41(5):873-882. doi:10.1007/s10439-012-0731-0**
- 63,011 instrumented football impacts (37 diagnosed, adjusted to 244 for under-reporting); validated on 58 NFL reconstructions.
- **CP = 1 / (1 + exp(-(β0 + β1·a + β2·α + β3·a·α))), β0 = -10.2, β1 = 0.0433 (per g), β2 = 0.000873 (per rad/s²), β3 = -9.2e-7.** Concussive impacts averaged 104 ± 30 g and 4,726 ± 1,931 rad/s².
- Worked values with boxing inputs: Walilko straight (58 g, 6,343 rad/s²) → CP ≈ 0.08; Viano hook (71 g, 9,306) → CP ≈ 0.60; Stojsih peak (191 g, 17,156) → ≈ 1.0.
- **Sim implication:** usable as-is for per-strike concussion probability if the sim generates (g, rad/s²) per landed head strike; note it is calibrated on helmeted football and likely under-weights rotation for bare-knuckle/glove impacts - consider raising β2 by ~1.3-1.5× or using the Lota LOC midpoint.

**Zhang L, Yang KH, King AI (2004). A proposed injury threshold for mild traumatic brain injury. J Biomech Eng 126(2):226-236. doi:10.1115/1.1691446**
- 24 NFL head-to-head collisions reconstructed with a validated FE head model; brainstem shear stress as predictor. The paper's results (widely cited; not in the abstract) give **25/50/80% MTBI probability at ≈66/82/106 g linear and ≈4,600/5,900/7,900 rad/s²**, with a shear-stress tolerance of 7.8 kPa in the brainstem.
- **Sim implication:** cross-check for the KO logistic: Olympic straight (58 g / 6,343) sits near the 25-50% band on rotation, consistent with Rowson's ~8% combined estimate being conservative for boxing.

**Razm SS, Márquez-Flórez K, Caprioli L, et al. (2026). Mechanical efficiency and injury risk in leg kicks across combat sports: a narrative review of stance, hip rotation, and striking surface effects. Healthcare 14(4):430. doi:10.3390/healthcare14040430**
- 23 studies. High impact linked to pivoted support leg and proximal-to-distal sequencing; shin vs instep trades tibial stress for foot/ankle trauma; support-knee rotational stress.
- **Sim implication:** kicking carries a self-injury channel (shin/foot) that increases with checked kicks; there is *no* quantitative dose-response for leg-kick effects on the receiver in the literature - any leg-damage → mobility model is a design assumption.

---

## 5. Numbers to carry into DESIGN.md

| Parameter | Value / range | Source |
|---|---|---|
| MMA high-intensity : (low + pause) ratio | 1:2 to 1:4 (use 1:3) | del Vecchio 2011; Coswig 2016 |
| MMA standing low-intensity time per 5-min round | median 127-157 s (IQR ~80-236 s); lowest in R3 | Miarka 2016 |
| MMA standing high-intensity (exchange) time per round | 7-18 s mean, SD ≥ mean; higher in R3 | Miarka 2018; Miarka 2021 |
| MMA ground fighting activity per round | ~25 s (early-finish bouts) to ~50 s (3-round bouts) | Antoniettô 2023; Miarka 2021 |
| MMA strike attempts / landed per fighter per round | ~40 attempted (IQR 25-62), ~22 landed (13-34); ~50% to head | Dos Santos 2019; Miarka 2021 |
| Head strikes received per athlete | 6.3 total / 2.4 significant per min | Mańka-Malara 2022 |
| Takedown attempts per round | ~1 (IQR 0-2); 1.1 att / 0.4 landed (female) | Dos Santos 2019; Miarka 2021 |
| Takedown success | winners 50%, losers 20% → base ~35% | Ma 2026 |
| Control time per successful TD | 80-100 s | Ma 2026 |
| Finish mix (modern UFC) | decision ~50%, KO/TKO ~31%, submission ~18% | Jones 2023; Fares 2026; Mańka-Malara 2022 |
| KO/TKO-by-strikes per bout | KO 12.7%, TKO 19.1%, combined 31.9% | Hutchison 2014 |
| Head-trauma finish share by class | FLW ~12.5% → LHW ~38% → HW ~54% | Mańka-Malara 2022 |
| KO strike location | 54% mandible | Hutchison 2014 |
| Post-KO window before stoppage | 3.5 s (0-20); 2.6 (0-20) extra head strikes | Hutchison 2014 |
| TKO trigger pattern | 18.5 (5-46) strikes in last 30 s, 92% head | Hutchison 2014 |
| Distance head strikes landed in KO round | median 13 (IQR 6-25) vs 9 in sub rounds | Miarka 2022 |
| Median time to head-trauma KO | 6:06 (5 s - 24:10) | Mańka-Malara 2022 |
| Winner age effect | winners 0.8 y younger; reach irrelevant except HW | Kirk 2024 |
| Elite amateur boxing output | 20-21 punches/min, 1.4-1.55 actions/s; activity:rest 18:1 (elite) 9:1 (novice) | Davis 2015/2018; Slimani 2017 |
| Novice boxing E:P by round | 16:1 → 8:1 → 6:1 | Slimani 2017 |
| Pro boxing landed force distribution | median ~950 N; 64% ≤1000 N; 88% <1500 N; 2-6% ≥2000 N; max 5358 N; force not correlated with body mass | Pierce 2006 |
| Pro boxing landed punches per round (both boxers) | 57 (JLW) - 74 (HW) | Pierce 2006 |
| Lab max punch force (rear/lead straight) | elite 4800/2847 N; intermediate 3722/2283; novice 2381/1604 | Smith 2000 |
| Olympic straight punch on dummy | 3427 N, 9.1 m/s, eff. mass 2.9 kg, 58 g, 6343 rad/s² | Walilko 2005 |
| Olympic hook on dummy | 4405 N, 11.0 m/s, 71 g, 9306 rad/s² | Viano 2005 |
| Jab (lead straight) force | elite 1508 N (7.2 m/s), junior 1035 N | Liu 2022 |
| Roundhouse kick force / execution time | 1200-1550 N; 1.0 s (Muay Thai) - 1.5 s (TKD); foot 5.6-7.2 m/s at impact | Gavagan & Sayers 2017 |
| Front kick vs roundhouse | front kick force +47% (novice) to +120% (elite); roundhouse foot speed +44-48% | Vagner 2023 |
| Fatigue → punch force | significant drop after lower-body fatigue; cross/hook > jab | Dunn 2022 |
| Within-bout power loss (kickboxing) | jump -4-9%, arm Wingate -9-11% | Ouergui 2013 |
| RA: concussive vs non-concussive (MMA) | 7,560 vs 5,060-7,070 rad/s² | Lota 2022 |
| RA: LOC vs non-LOC (boxing) | 11,280 vs 6,146 rad/s² | Lota 2022 |
| Concussion thresholds | 50% at ~82 g / ~5,900 rad/s² (Zhang); concussion ~4,500, DAI ~10,000 rad/s² (Lota) | Zhang 2004; Lota 2022 |
| Combined concussion probability | logistic: -10.2 + 0.0433 g + 0.000873 rad/s² - 9.2e-7 g·rad/s² | Rowson & Duma 2013 |
| Sparring peak head loads | 191 g / 17,156 rad/s² | Stojsih 2010 |
| Glove effect | padding cuts linear not rotational; MMA glove > boxing glove rotational dosage | Bartsch 2012 |
| Kickboxing exchange structure | HIA 2.2 s, LIA 2.3 s, pause 5.4 s, gap 3.4 s; ~25-27 HIA/round; pauses double after R1 | Ouergui 2014 |
| Kickboxing technique mix | 63% upper / 37% lower limb; 57% head-targeted | Slimani 2017 (IJSPP) |
| K-1 strikes per fight | 86 ± 23, evenly by round; [La] 15.3 | Cimadoro 2018 |
| MMA sparring lactate | 4 → 15.6 mmol/L; official ≈ 1.3-1.4× simulated | Coswig 2016; Chaabène 2014 |
| Judo engagement cycle | combat 24-29 s, pause 4-9 s; ~7 cycles/match; E:P ~3:1 | Sterkowicz 2017; Miarka 2012; Barreto 2022 |
| Wrestling work/rest | 37 s / 14 s; match 427 s; [La] 14.8; forearm most fatigued | Nilsson 2002 |
| BJJ structure | E:P 6:1; HI bursts ~4 s; grip -13-16% per match; time structure stable across matches | Andreato 2013, 2015 |
| Injury incidence (MMA) | 229/1000 AE pooled; 23.6/100 AE; 4.1/100 fighter-min | Lystad 2014; Ngai 2008; Curran-Sills 2018 |
| Injury type split (MMA) | laceration 37-59%, fracture 7-43%, concussion 4-20%; head 67-78% | Lystad 2014 |
| Loser vs winner injury | 3× (pooled); 48% vs 24% per bout | Lystad 2014; Ross 2021 |
| Cut probability per fighter-bout (UFC) | 12.0%; facial fracture 3.6% | Jones 2023 |
| Cut hazard per boxer-round | ~1.7% (3.4% injury × 51% laceration) | Bledsoe 2005 |
| Severe (LOC) concussion | 15.4/1000 AE (3% of bouts, early NSAC); concussion 14.7/100 AE (Calgary) | Ngai 2008; Curran-Sills 2018 |
| Head injury / TBI per UFC fighter-bout | 35 / 16 per 100 AE | Fares 2021 |

---

## 6. Weak or conflicting evidence

1. **Leg kicks / body shots:** no quantitative data on accumulated effect on mobility, guard, or finish probability. Only narrative biomechanics (Razm 2026). Any leg-damage model is a design assumption to be tuned against fight records.
2. **Flash knockdown vs accumulated damage:** not separated in any study. Hutchison's "2.6 extra strikes / 3.5 s" and Miele & Bailes' fatal-bout punch counts are the only proxies. The sim should treat KO as (a) single-strike RA exceedance and (b) cumulative-load threshold, but weights for (b) are unsupported.
3. **Fatigue → striking force:** lab decrements (Dunn 2022; Ouergui 2013) vs no in-ring force decline in pro boxing (Pierce 2006, n = 4 boxers analysed by round). Treat force loss as ≤10% by end of a 3-round bout and put most fatigue effects into volume, accuracy and defensive lapses.
4. **Round-by-round pacing in MMA:** inconsistent (del Vecchio vs Miarka vs Antoniettô); female rounds look stationary. Use flat base rates with fighter-state modulation.
5. **Weight class and per-strike force:** lab says heavier = harder via effective mass; in-ring landed force uncorrelated with mass. KO rate clearly rises with weight (4× FLW→HW), so weight should enter via KO susceptibility/effective-mass tail rather than mean force.
6. **Concussion thresholds** are all from football or dummies; none from combat-sport clinical outcomes except the Lota-reviewed concussive vs non-concussive means (small n). Boxing pulses are shorter and more rotational than football, so HIC-based criteria under-predict.
7. **Clinch as a phase** is almost never coded separately in MMA time-motion studies; clinch rates/durations must be borrowed from wrestling (37 s work bouts) and judo (24-29 s) or from LIT-B fight-record data.
8. **Referee/doctor stoppage logic** is only described (strike bursts, damage), never modelled; kappa for coding the situations is high (0.86) so a rule-based state machine is defensible but its thresholds are guesses.
9. **Simulated vs official bouts:** most physiology is from sparring with n = 8-20; official karate bouts ran ~40% higher lactate than sparring, so simulated-bout numbers are likely underestimates for real fights.
10. **Effective mass by punch type** (straights higher effective mass than hooks; elite ~39% leg-drive contribution vs 16% novice) came from a search-engine summary of an MDPI Applied Sciences 2025 paper (15(7):4008, doi:10.3390/app15074008) whose page could not be fetched; treat as unverified.
11. **Head-contact counts from sensors** disagree by 2-3× depending on device (Le Flao 2024); rely on video-coded rates for exposure.
