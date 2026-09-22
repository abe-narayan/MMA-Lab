# Annotated Bibliography (Phase 1)

Compiled 2026-09-22 from `LIT_A_performance_biomech_physio_injury.md`, `LIT_B_anthropometrics_predictors_expertise_tactics.md`, `LIT_C_animation_ai_rendering_assets.md`, and the citation appendices of `DAMAGE_PHYSIOLOGY.md` and `SUBMISSION_PHYSIOLOGY_DATA.md`. De-duplicated; alphabetical by first author within each section. Only entries that carry a DOI, URL, PMID or PMCID in the source files are included (PubMed/PMC URLs are constructed from the identifier given in the source and marked "(from PMID/PMCID)"). No citations added from memory. Provenance flags ([S], [S-mem], ESTIMATE/[EST], [PRESS], unverified, snippet only) are carried from the inputs; "Used for:" names the simulator system each entry informs. Section A = peer-reviewed papers; B = theses, reports, preprints and position statements; C = technical/industry sources (animation, game AI, rendering, cinematography, assets/licences).

Items cited in the inputs **without** any identifier and therefore excluded: Rossen, Kabat & Anderson 1943 (Arch Neurol Psychiatry 50:510-528); Strangulation Training Institute timeline; Demartini 2017; Martinet 2025; Kreiswirth 2014 (World No-Gi 2009 injuries); Stellpflug 2024/2025 (King-Devick / carotid IMT); Reay & Holloway 1982; ABC Unified Rules of MMA ([S-mem]; Wikipedia summary, no URL recorded); UFC Performance Institute reports (2018, 2021); Jack Slack essays; Fightnomics; Bruin Sports Analytics reach blog; FightTracker (arXiv 2312.11067, withdrawn — excluded by the source); Three.js example assets (Soldier.glb/Xbot); Peng et al. DeepMimic 2018 (no URL in source; AMP/ASE are listed).

---

## A. Peer-reviewed papers

**Allerdissen M, Güldenpenning I, Schack T, Bläsing B (2017).** Recognizing fencing attacks from auditory and visual information: a comparison between expert fencers and novices. *Psychology of Sport and Exercise* 31:123-130. https://doi.org/10.1016/j.psychsport.2017.04.009
- 15 expert fencers (mean age 17.2) vs 17 novices; temporal occlusion of raddoppio and flèche attacks in visual, auditory and audio-visual conditions.
- Accuracy rose with later occlusion in both groups; experts better in all conditions; adding sound did not help.
- Used for: perception model — logistic "read" curve over attack elapsed time with a skill offset.

**Almeida TBC, et al. (2017).** [Elite BJJ armbar injury series.] PMC5608741. https://pmc.ncbi.nlm.nih.gov/articles/PMC5608741/ (from PMCID)
- 5 elite BJJ athletes injured by armbar; imaging series.
- UCL rupture 100%, flexor tendon rupture 100%, bone contusion 60%, no fracture/dislocation.
- Used for: submission injury model (armbar structural failure mode).

**Amtmann JA, Amtmann KA, Spath WK (2008).** Lactate and rate of perceived exertion responses of athletes training for and competing in a mixed martial arts event. *J Strength Cond Res* 22(2):645-647. PMID 18550986. https://pubmed.ncbi.nlm.nih.gov/18550986/ (from PMID) [S]
- Official MMA competition blood sampling.
- Post-bout [La] 10.2-20.7 mmol/L; RPE 13-19 (Borg 6-20).
- Used for: glycolytic pool range (1-22 mmol/L) in the fatigue model.

**Andreato LV, Franchini E, de Moraes SM, et al. (2013).** Physiological and technical-tactical analysis in Brazilian jiu-jitsu competition. *Asian J Sports Med* 4(2):137-143. https://doi.org/10.5812/asjsm.34496
- 35 white-brown-belt athletes, 22 regional fights; time-motion + blood/grip measures.
- E:P 6:1; HI actions ~4 s; LI:HI 8:1; [La] 4.4 → 10.1; handgrip 45.9 → 40.1 kgf (R, -13%), 44.2 → 37.0 (L, -16%); RPE 15.
- Used for: ground-phase pacing; grip-fatigue channel (submission escape / sweep failure rise late).

**Andreato LV, Julio UF, Panissa VLG, et al., Franchini E (2015).** Brazilian jiu-jitsu simulated competition part II: physical performance, time-motion, technical-tactical analyses, and perceptual responses. *J Strength Cond Res* 29(7):2015-2025. https://doi.org/10.1519/JSC.0000000000000819
- n = 10, 4 × 10-min simulated matches.
- Handgrip fell after matches 3-4; E:P unchanged across matches; RPE, recovery, reaction time, flexibility unchanged; CMJ potentiated after match 2.
- Used for: tournament mode — constant BJJ time structure with degrading grip-dependent success.

**Andreato LV, Lara FJD, Andrade A, Branco BHM (2017).** Physical and physiological profiles of Brazilian jiu-jitsu athletes: a systematic review. *Sports Med Open* 3:9. https://doi.org/10.1186/s40798-016-0069-5
- 58 studies, 1,496 subjects.
- VO2max 42-52 mL/kg/min; aerobic fitness does not discriminate level; maximal/isometric/endurance strength associate with success; 4-6 matches per competition day.
- Used for: grappler attribute weighting (strength/grip endurance > aerobic).

**Antoniettô NR, Bello FD, Queiroz ACC, et al., Miarka B (2023).** Suggestions for professional mixed martial arts training with pacing strategy and technical-tactical actions by rounds. *J Strength Cond Res* 37(6):1306-1314. https://doi.org/10.1519/JSC.0000000000003018
- 1,564 KO/TKO-ended UFC rounds split by ending round.
- Standing preparatory time 95.6 ± 62.9 s (R1-ending) / 93.6 ± 67.9 s (R2-ending) vs 160.5 ± 87.4 s (R2 of R3-ending) / 144.0 ± 88.5 s (R3); ground activity 23.4 ± 45.5 / 25.3 ± 41.9 s vs 50.4 ± 69.9 / 52.9 ± 74.2 s; standing combat activity did not differ.
- Used for: engagement-rate parameter (early finishes = less neutral time, not longer exchanges).

**Baird LC, Newman CB, Volk H, Svinth JR, Conklin J, Levy ML (2010).** Mortality resulting from head injury in professional boxing. *Neurosurgery* 67(5):1444-1450. https://doi.org/10.1227/NEU.0b013e3181e5e2cd
- 339 boxing deaths 1950-2007, registry review.
- 64% associated with KO, 15% TKO; more in lower weight classes; 61% collapsed in ring; post-1983 decline attributed to exposure reduction and medical oversight, not the 15 → 12 round change.
- Used for: career-mode catastrophic outcomes (tie to cumulative concussive load, not weight class).

**Baker J, Schorer J (2013).** The southpaw advantage? Lateral preference in mixed martial arts. *PLoS ONE* 8(11):e79793. https://doi.org/10.1371/journal.pone.0079793
- 1,468 MMA fighters with stance data (from 2,053); records-based.
- 17.4% southpaw, 80.3% orthodox; win% 64.0 ± 20.4 vs 62.6 ± 21.3 (n.s.); southpaws more fights (22.0 vs 19.7); southpaw share rises with career length.
- Used for: fighter generation (southpaw prevalence 17-19%); stance bonus ≤ +2%.

**Baker [first author] et al. (2010).** [MMA fighter ACL + MCL rupture from heel hook, case report.] PMID 19629437. https://pubmed.ncbi.nlm.nih.gov/19629437/ (from PMID)
- Single case.
- Heel hook produced combined ACL and MCL rupture.
- Used for: heel-hook injury mode (zero warning, ligament failure).

**Balmer NJ, Nevill AM, Lane AM (2005).** Do judges enhance home advantage in European championship boxing? *J Sports Sci* 23(4):409-416. https://doi.org/10.1080/02640410400021583
- European championship pro bouts; logistic models of home win by decision type controlling for relative quality.
- Equally matched boxers: P(home win) 0.57 KO, 0.66 TKO, 0.74 points; points bouts had significantly more home wins than KO bouts.
- Used for: home-advantage decomposition inside the judging and stoppage models (boxing rulesets).

**Baribeau V, Kirk C, Le DQ, et al., Murugappan KR (2023).** Rapid weight gain and weight differential predict competitive success in 2100 professional combat-sport athletes. *Int J Sports Physiol Perform* 18(1):85-94. https://doi.org/10.1123/ijspp.2022-0142 (open copy: https://shura.shu.ac.uk/31352/)
- 708 MMA athletes and 1,392 male boxers, pro events 2015-2019, retrospective cohort; no skill control.
- Regain winners vs losers MMA 8.7 ± 3.7% vs 7.9 ± 3.8%, boxing 8.0 ± 3.0% vs 6.9 ± 3.2%; +7% odds (MMA) / +13% (boxing) per 1% regain; held for regional/international MMA and male boxers, not females; fight-night weight differential predicted victory and KO/TKO.
- Used for: weight-regain odds modifier (OR ≈ 1.05-1.07/1%) and fight-night weight → KO probability.

**Barley OR, Vial S, Scanlan M, et al., Doherty CS (2025).** Influence of height and reach on fight-ending punches in the Ultimate Fighting Championship mixed martial arts promotion. *Int J Sports Sci Coach* 20(5):2137-2148. https://doi.org/10.1177/17479541251338509
- 264 UFC KO/TKO contests ended by hook, straight, uppercut or overhand; multinomial logistic regression.
- Fight-ending punches: hooks 51%, straights 35%, uppercuts/overhands remainder; straight vs overhand OR 1.06-1.10 per cm; at +40 cm height difference straights 76% more likely than uppercuts/overhands; reach does not change win chance.
- Used for: finishing-punch type distribution and its shift with reach.

**Barreto LBM, Miarka B, et al., Brito CJ (2022).** The effects of weight categories on the time-motion analysis of female high-level judo athletes between the 2016 and 2020 Olympic cycles. *Front Psychol* 13:1012517. https://doi.org/10.3389/fpsyg.2022.1012517
- 1,332 female judo combats.
- E:P 2.5:1-3.4:1 (2016), 2.8:1-3:1 (2020); 2020 rules reduced gripping, attack, defence, groundwork and pause times.
- Used for: grappling E:P ~3:1; ruleset as a parameter shifting phase durations.

**Bartsch AJ, Benzel EC, Miele VJ, Morr DR, Prakash V (2012).** Boxing and mixed martial arts: preliminary traumatic neuromechanical injury risk analyses from laboratory impact dosage data. *J Neurosurg* 116(5):1070-1080. https://doi.org/10.3171/2011.12.JNS111478
- Hybrid III, 54 pendulum hook impacts at 27-29 J and 54-58 J; MMA glove, boxing glove, headgear; 17 risk metrics + FE brain.
- All padding reduced linear but not rotational dosage; MMA glove + bare head gave higher rotational dosage than boxing glove + bare head at equal energy; boxing glove + headgear best.
- Used for: glove-type modifiers (MMA glove KO coefficient ×1.1-1.2, higher cut probability).

**Bernick C, et al. (2015).** [Professional Fighters Brain Health Study: exposure vs thalamic/caudate volume and processing speed.] *Br J Sports Med*. PMID 25633832. https://pubmed.ncbi.nlm.nih.gov/25633832/ (from PMID) [S]
- Longitudinal cohort of professional fighters.
- Cumulative fight exposure negatively associated with thalamic/caudate volume and processing speed; Fight Exposure Score predicts impairment.
- Used for: career-mode cumulative damage.

**Bhumipol P, Makaje N, Kawjaratwilai T, Ruangthai R (2023).** Match analysis of professional Muay Thai fighter between winner and loser. *J Hum Sport Exerc* 18(3). https://doi.org/10.14198/jhse.2023.183.12
- 8 professional fighters, 12 full 5 × 3-min matches without KO.
- Winners threw more swing (hook) punches in R3 and landed them more accurately in R4; more round kicks in R1 and R5 and more accurate round kicks in R5 (p < 0.05).
- Used for: Muay Thai round weighting (later rounds heavier) and conditioning-driven R4-R5 output.

**Bianco V, Di Russo F, Perri RL, Berchicci M (2017).** Different proactive and reactive action control in fencers' and boxers' brain. *Neuroscience* 343:260-268. https://doi.org/10.1016/j.neuroscience.2016.12.006
- Fencers, boxers, controls; discriminative response task with ERPs.
- Larger prefrontal preparatory activity ↔ fewer errors; larger motor preparation ↔ faster responses; sports differ in proactive vs reactive balance.
- Used for: per-fighter "initiative" (proactive vs reactive) trait.

**Bledsoe GH, Li G, Levy F (2005).** Injury risk in professional boxing. *South Med J* 98(10):994-998. https://doi.org/10.1097/01.smj.0000182498.19288.e2
- 524 pro boxing bouts, Nevada 2001-03.
- 17.1 injuries/100 boxer-matches; 3.4/100 boxer-rounds; facial laceration 51%, hand 17%, eye 14%, nose 5%; men 3.6 vs women 1.2 per 100 boxer-rounds; losers ~2× risk; KO losers 2× other losers.
- Used for: boxing cut hazard (~1.7%/boxer-round) and hand injury (~0.6%/boxer-round).

**Bledsoe GH, et al. (2006).** [Incidence of injury in professional MMA competitions, Nevada 2001-04.] *J Sports Sci Med* 5(CSSI):136-142. PMID 24357986. https://pubmed.ncbi.nlm.nih.gov/24357986/ (from PMID) [S]
- Nevada commission records.
- 28.6 injuries/100 fight participations; facial laceration 47.9%, hand 13.5%, nose 10.4%, eye 8.3%.
- Used for: injury type split; attacker hand-injury rate anchor.

**Bogdanis GC, et al. (1995).** [Recovery of power output and muscle metabolites following 30 s of maximal sprint cycling.] *J Physiol* 482:467-480. PMID 7714837. https://pubmed.ncbi.nlm.nih.gov/7714837/ (from PMID) [S]
- Muscle biopsy after 30-s sprint; non-combat exercise physiology.
- PCr 19.7% of rest at end, 65.0% at 1.5 min, 85.5% at 6 min; half-time 56.6 ± 7.3 s; muscle pH 6.72 → 6.79 at 6 min; peak power recovery tracks PCr.
- Used for: phosphagen (burst) pool recharge kinetics; 60-s break restores ~half.

**Brechney GC, Chia E, Moreland AT (2021).** Weight-cutting implications for competition outcomes in mixed martial arts cage fighting. *J Strength Cond Res* 35(12):3420-3424. https://doi.org/10.1519/JSC.0000000000003368
- 75 MMA athletes (59 amateur, 16 pro); self-report 7-day mass, official weigh-in, pre-fight measurement.
- Losers cut 10.6% vs winners 8.6% (p = 0.04, d = 0.48, 95% CI 0.02-0.93); recovered mass 6.8% vs 7.4% n.s.; OR 0.89 (0.79-1.00) per additional 1% cut.
- Used for: weight-cut magnitude penalty (-1 to -2% conditioning/chin per 1% beyond 5%).

**Brown DA, Gross G (2025).** Assessing the incidence of head trauma in Australian mixed martial arts. *Sports Health* 17(4):689-696. https://doi.org/10.1177/19417381241263332
- 143 events 2020-23, video review.
- Head-strike KO/TKO per 100 AE: male amateur 16.6, male pro 18.7, female amateur 12.6, female pro 7.4; 34% of male vs 23% of female bouts; LHW/HW greater odds.
- Used for: KO hazard by sex and level (women ~40-60% of men's).

**Chaabène H, Mkaouer B, Franchini E, et al. (2014).** Physiological responses and performance analysis difference between official and simulated karate combat conditions. *Asian J Sports Med* 5(1):21-29. PMID 24868428. https://pubmed.ncbi.nlm.nih.gov/24868428/ (from PMID)
- 10 elite karateka, official vs simulated bouts.
- Official: activity 10.0 s / rest 16.2 s (E:R 1:1.5); HI actions 1.5 ± 0.3 s (HI:rest 1:11); 14 ± 6 HI actions/match; [La] 11.1 official vs 7.8 simulated; RPE 14 vs 12.
- Used for: "official bout" intensity multiplier ×1.3-1.4 when calibrating from sparring data.

**Cimadoro G, Mahaffey R, Babault N (2018).** Acute neuromuscular, cognitive and physiological responses to a Japanese kickboxing competition in semi-professional fighters. *J Sports Med Phys Fitness* 58(12):1720-1727. https://doi.org/10.23736/S0022-4707.17.07859-8
- 8 K-1 fighters, official bouts.
- 86 ± 23 blows per fight; 32.7/32.6/34.7% by round; punches ≈ kicks > knees; peak [La] 15.3 ± 1.6; simple RT slowed post-fight; CMJ unchanged; R1+R2 strikes ↔ Δ[La] r = 0.76.
- Used for: kickboxing strike volume; reaction-time degradation with accumulated volume/lactate.

**Collier T, Johnson AL, Ruggiero J (2012).** Aggression in mixed martial arts: an analysis of the likelihood of winning a decision. In Jewell RT (ed.), *Violence and Aggression in Sporting Contests*, pp. 97-109. Springer (book chapter). https://doi.org/10.1007/978-1-4419-6630-8_7
- UFC decisions; fight-level probit on performance differences plus height, weight, age; coefficients not extractable.
- Knockdowns and visible damage have the largest marginal effects; height the only significant non-performance variable (contradicts Kirk; low weight).
- Used for: "visible damage" judge state (~0.3-0.5 of a knockdown per event).

**Collins CL, et al. (2014).** [Neck strength as a predictor of concussion risk in high-school athletes.] *J Prim Prev*. PMID 24930131. https://pubmed.ncbi.nlm.nih.gov/24930131/ (from PMID) [S]
- 6,704-athlete cohort.
- Each 1 lb of neck strength lowered concussion odds 5% (OR 0.95, 95% CI 0.92-0.98).
- Used for: neck-brace attribute multiplier on equivalent rotational acceleration.

**Connor J, et al. (2022).** [Rapid weight loss of ~5.3% with > 24 h recovery and performance.] *Eur J Appl Physiol*. PMID 35833967. https://pubmed.ncbi.nlm.nih.gov/35833967/ (from PMID) [S]
- Controlled RWL protocol.
- ~5.3% cut followed by > 24 h recovery did not impair performance indices.
- Used for: penalise residual dehydration at fight time, not the cut itself.

**Coswig VS, Ramos SdP, Del Vecchio FB (2016).** Time-motion and biological responses in simulated mixed martial arts sparring matches. *J Strength Cond Res* 30(8):2156-2163. https://doi.org/10.1519/JSC.0000000000001340
- n = 13 (25 ± 5 y, 81 kg, 39 ± 25 months MMA), 3 × 5 min, 1-min rest.
- HI:LI 1:2; E:P 1:3; [La] 4.0 ± 1.7 → 15.6 ± 4.8; glucose 80 → 157 mg/dL; CK up at 48 h; no performance-test decrement.
- Used for: MMA default intensity ratio; end-of-R3 lactate target.

**Coswig VS, et al. (2016).** [Biochemical differences between official and simulated MMA fights.] *Asian J Sports Med*. PMID 27625756. https://pubmed.ncbi.nlm.nih.gov/27625756/ (from PMID) [S]
- Official vs simulated MMA bouts, blood markers.
- Similar high-intensity glycolytic demand; pre-fight glucose 6.1 ± 1.2 vs 4.4 ± 0.7 mmol/L.
- Used for: pre-fight stress ("adrenaline dump") justification; official-vs-simulated calibration.

**Coswig VS, Miarka B, Pires DA, da Silva LM, Bartel C, Del Vecchio FB (2019).** Weight regain, but not weight loss, is related to competitive success in real-life mixed martial arts competition. *Int J Sport Nutr Exerc Metab* 29(1):1-8. https://doi.org/10.1123/ijsnem.2018-0034
- 15 MMA athletes after one real bout (8 winners, 7 losers); time-motion + technical-tactical.
- Winners more HI time (median 58 s [10-98] vs 32 s [1-60]), more kick sequences (3.5 vs 1.0), more ground-and-pound (2.5 vs 0.0); HI time and kick sequences predicted outcome.
- Used for: aggression/output as a round-scoring driver (winners ~1.8× HI time).

**Crighton B, Close GL, Morton JP (2016).** Alarming weight cutting behaviours in mixed martial arts: a cause for concern and a call for action. *Br J Sports Med*. PMID 26459278. https://pubmed.ncbi.nlm.nih.gov/26459278/ (from PMID) [S: title only]
- Editorial.
- Used only to justify the ESTIMATE that typical fight-week cuts are 5-10% of body mass.
- Used for: weight-cut prevalence assumption.

**Crisafulli A, Vitelli S, Cappai I, Milia R, Tocco F, Melis F, Concu A (2009).** Physiological responses and energy cost during a simulation of a Muay Thai boxing match. *Appl Physiol Nutr Metab* 34(2):143-150. https://doi.org/10.1139/H09-002
- n = 10, portable gas analyser.
- Energy expenditure 10.75 ± 1.58 kcal/min (9.4 METs); VO2 and HR always above anaerobic threshold; CO2-excess peaks in R1 (636 mL/min) then falls.
- Used for: fast-recharging anaerobic pool drawn in R1 + slow aerobic ceiling.

**Curran-Sills G, Abedin T (2018).** Risk factors associated with injury and concussion in sanctioned amateur and professional mixed martial arts bouts in Calgary, Alberta. *BMJ Open Sport Exerc Med* 4:e000348. https://doi.org/10.1136/bmjsem-2018-000348
- Commission records 2010-15.
- Injury 23.6/100 AE; 4.1 injuries per 100 min exposure; concussion 14.7/100 AE; head most common; KO/TKO/corner/physician stoppages predicted injury.
- Used for: injury hazard per fighter-minute (~0.04); concussion per fighter-bout (~0.15).

**Davis P, Wittekind A, Beneke R (2013).** Amateur boxing: activity profile of winners and losers. *Int J Sports Physiol Perform* 8(1):84-91. https://doi.org/10.1123/ijspp.8.1.84
- 32 male novice amateurs (19.3 ± 1.4 y; 62.6 kg), 3 × 2 min, video + lactate.
- Winners landed 18 ± 11 more punches; lead-hand punches R1 34.2 vs 26.5; head punches 121.3 vs 96.0; block-and-counter combinations 2.8 vs 0.1 per bout; combinations R1+R3 44.3 vs 28.8; post-bout [La] 11.8 mmol/L (1.8 mmol/L/min).
- Used for: "counter after successful defence" as a skill-gated, high-hit-rate action; novice boxing winner margin.

**Davis P, Leithäuser RM, Beneke R (2014).** [The energetics of semiheavyweight amateur boxing.] *Int J Sports Physiol Perform* 9:233-239. PMID 24572964. https://pubmed.ncbi.nlm.nih.gov/24572964/ (from PMID) [S]
- 3 × 2-min amateur boxing energetics.
- Aerobic energy dominant (526 kJ aerobic); PCr recovery in breaks key to sustained output.
- Used for: aerobic ceiling and break-recovery logic.

**Davis P, Benson PR, Pitty JD, Connorton AJ, Waldock R (2015).** The activity profile of elite male amateur boxing. *Int J Sports Physiol Perform* 10(1):53-57. https://doi.org/10.1123/ijspp.2013-0474
- 29 Olympic semi/finals, 39 boxers, 3 × 3 min.
- ~1.4 actions/s; ~20 punches/min; ~2.5 defensive movements/min; ~47 vertical hip movements/min; rounds ~200 s effective; winners more punches landed and lower thrown:landed in R3, more rear hooks landed R2-R3, fewer defensive movements.
- Used for: elite boxing output (~60 punches/round); R3 accuracy bonus for the fitter/better boxer.

**Davis P, Connorton AJ, Driver S, Anderson S, Waldock R (2018).** The activity profile of elite male amateur boxing after the 2013 rule changes. *J Strength Cond Res* 32(12):3441-3446 (LIT_B gives 3450-3455). https://doi.org/10.1519/JSC.0000000000001864
- 50 World Championship bouts, 60 boxers (23.5 y, 176.2 cm, 71.7 kg).
- ~1.55 actions/s; ~21 punches, ~3.6 defensive movements, ~56 hip movements per minute; winners more straights/lead straights in R1, more landed in R3, better thrown:landed R3, fewer air punches R2-R3; post-2013 style long-range/straight/mobile.
- Used for: boxing output baseline; fatigue-accuracy coupling (winners' accuracy rises R1 → R3).

**del Vecchio FB, Hirata SM, Franchini E (2011).** A review of time-motion analysis and combat development in mixed martial arts matches at regional level tournaments. *Percept Mot Skills* 112(2):639-648. https://doi.org/10.2466/05.25.PMS.112.2.639-648 (PMID 21667772)
- 52 regional MMA athletes (24 ± 5 y, 5 ± 3 y experience); video time-motion.
- E:P 1:2 to 1:4; only round effect: ground LI longer in R2 than R3; most bouts ended in R3 with high-intensity actions, mostly on the ground.
- Used for: MMA HI fraction (~20-33% of round); 3-4 HI sequences per round.

**Dinu D, Louis J (2020).** Biomechanical analysis of the cross, hook, and uppercut in junior vs. elite boxers: implications for training and talent identification. *Front Sports Act Living* 2:598861. https://doi.org/10.3389/fspor.2020.598861
- 15 potential Olympic medallists vs 8 juniors; 17-IMU suit; maximal cross, hook, uppercut.
- Elite more force at higher velocity for all three; juniors more shoulder-dominant; cross front/rear foot GRF ≈ 61/39% elite vs 54/46% junior (n.s.).
- Used for: "kinetic-chain efficiency" technique attribute multiplying force and hand speed.

**Dos Santos DA, Miarka B, Dal Bello F, et al., Beneke R (2019).** 10 years on time-motion and motor actions of paired mixed martial arts athletes. *Int J Sports Physiol Perform* 14(3):399-402 (LIT_B: 399-406). https://doi.org/10.1123/ijspp.2018-0566
- 845 UFC rounds; 45 athletes compared at baseline (34-44 y) and 10 years later.
- Medians per round younger → older: landed 22 (13-34) → 18 (10-31.7); attempted 41 (24.5-62) → 35; head attempts 19 (9-34.5) → 16.5; body landed 1 (0-4); TD attempts 1 (0-2); standing combat 2:10 → 1:56; LI 2:11 → 1:56; landed strikes positively, attempted body strikes and submission attempts negatively associated with performance.
- Used for: per-round strike budget; ageing curve (-15-18% volume/decade, accuracy preserved).

**Dunn EC, Humberstone CE, Iredale KF, Martin DT, Blazevich AJ (2017).** Human behaviours associated with dominance in elite amateur boxing bouts: a comparison of winners and losers under the Ten Point Must System. *PLoS ONE* 12(12):e0188675. https://doi.org/10.1371/journal.pone.0188675
- 19 elite bouts, 26 boxers (12 winners, 14 losers); judges' decisions as ground truth.
- %Hit 33% vs 23% (ES 1.39, R1); %Air 17% vs 27% (ES -1.08, R2); total punches 76.8 vs 79.3 (n.s.); winners bounce, losers step; accuracy alone classifies 76.9%, + movement 84.6%, + total punches 80.8%.
- Used for: boxing judging (accuracy-difference dominant; footwork bonus).

**Dunn EC, Humberstone CE, Franchini E, Iredale FK, Blazevich AJ (2022).** The effect of fatiguing lower-body exercise on punch forces in highly-trained boxers. *Eur J Sport Sci* 22(7):964-972. https://doi.org/10.1080/17461391.2021.1916085
- 28 highly trained amateurs; 3-min max punch test before/after 9 × 1-min rowing.
- Significant force reductions for all punch types; RFD delayed for all except jab; larger effect for crosses and hooks.
- Used for: fatigue → force multiplier ~2× stronger for rotational punches than the jab.

**Eckner JT, et al. (2014).** [Effect of neck muscle strength and anticipatory cervical activation on head kinematics.] *Am J Sports Med*. PMID 24488820. https://pubmed.ncbi.nlm.nih.gov/24488820/ (from PMID) [S]
- Laboratory impulsive loading of the head.
- Anticipatory neck activation and neck strength both reduce head ΔV and Δω in all planes.
- Used for: "unseen strike" multiplier (direction supported; ×1.35 magnitude ESTIMATE).

**El-Ashker S (2011).** Technical and tactical aspects that differentiate winning and losing performances in boxing. *Int J Perform Anal Sport* 11(2):356-364. https://doi.org/10.1080/24748668.2011.11868555
- Amateur boxing notational analysis (cited via Thomson & Lamb and Davis; abstract not retrieved).
- Winners perform more offensive actions and more effective punches; defensive actions must convert into counters.
- Used for: corroboration of the accuracy-and-counter rule.

**Estevan I, Alvarez O, Falco C, Molina-García J, Castillo I (2011).** Impact force and time analysis influenced by execution distance in a roundhouse kick to the head in taekwondo. *J Strength Cond Res* 25(10):2851-2856. https://doi.org/10.1519/JSC.0b013e318207ef72
- 27 male TKD (13 medallists, 14 non-medallists).
- Medallists kick harder and faster from non-preferred distances; non-medallists' timing suffers with distance change.
- Used for: "range comfort" penalty scaled by (1 - skill).

**Falco C, Alvarez O, Castillo I, et al. (2009).** Influence of the distance in a roundhouse kick's execution time and impact force in Taekwondo. *J Biomech* 42(3):242-248. https://doi.org/10.1016/j.jbiomech.2008.10.041
- 31 TKD athletes (expert vs novice).
- Experts' impact force independent of distance; novices' force correlates with body mass (p < .01); experts faster at all three distances.
- Used for: novice kick force scaled by body mass; expert force distance-invariant, execution time distance-dependent.

**Fares MY, Salhab HA, Fares J, et al. (2021).** Craniofacial and traumatic brain injuries in mixed martial arts. *Phys Sportsmed* 49(4):420-428. https://doi.org/10.1080/00913847.2020.1847623
- 816 UFC fighters (NSAC 2016-19); 288 head injuries in 408 fights.
- Head injuries 35/100 AE; TBI 16/100 AE; males 37 vs females 23/100 AE; highest after KO/TKO; rising with weight.
- Used for: post-fight injury generation tied to finish type and weight class.

**Fares MY, Stadler R, Mao J, et al. (2026).** Technical and medical trends of upper limb submissions in mixed martial arts. *J Sports Med Phys Fitness* 66(8):915-923. https://doi.org/10.23736/S0022-4707.26.17426-X (PMID 42484431)
- 2,859 UFC PPV fights.
- 523 submissions (18.3%); upper-limb 18.5% of subs (armbar 67% of those); women 3× (3.03×) more likely to finish/lose by upper-limb sub; serious injury 7/97 (LIT_A) or ~7 of 80 filmed (~9%) (SUBMISSION appendix), avg 10.3 months to return; time from grappling initiation to submission lengthening.
- Used for: submission share (~18%), arm-lock share, serious-injury rate per sub, era parameter for submission speed.

**Faro H, de Lima-Junior D, Machado DGS (2023).** Rapid weight gain predicts fight success in mixed martial arts - evidence from 1,400 weigh-ins. *Eur J Sport Sci* 23(1):8-17. https://doi.org/10.1080/17461391.2021.2013951
- 1,474 pro MMA fights (110 female), 21 promotions under CSAC; official vs fight-day weight; logistic regression controlling for sex, division, weight difference.
- %WR OR 1.046 (95% CI 1.015-1.078, p = 0.004) per 1%; median regain BW 9.72%, FLW 9.42%, atomweight 9.35%, FW 8.95%, LW 8.45%, WW 8.24%, SW 8.06%, MW 5.82%, HW/SHW smallest; max 20.4%; weight difference OR 1.000 (n.s.).
- Used for: regain-by-division defaults and regain → odds modifier (capped ±5 pp).

**Fiala V, Zywiczynski P, Turecek P, Wacewicz S (2025).** Somatometric profiles of successful male professional heavyweight boxers. *Int J Sports Sci Coach*. https://doi.org/10.1177/17479541241311094
- All active male pro heavyweights on BoxRec; Bayesian logistic regressions (abstract-level effect sizes).
- Optimum body mass ≈ 110 kg; age and height effects "much stronger" than weight; taller/longer boxers likelier to win; former lower-class heavyweights 19.9% [5.6-31.1%] less likely to win.
- Used for: uncapped striking rulesets — modest height/reach modifier and body-mass plateau.

**Fife GP, et al. (2013).** [Head acceleration from taekwondo kicks on a helmeted headform.] *Br J Sports Med*. PMID 22930694. https://pubmed.ncbi.nlm.nih.gov/22930694/ (from PMID) [S]
- Instrumented helmeted headform; linear acceleration only.
- Turning kick 130.1 ± 51.7 g; axe kick 55.0 ± 20.1 g.
- Used for: head-kick force scaling (1.5-2× hook — ESTIMATE, since rotation was not measured).

**Finlay MJ, Greig M, Page RM (2018).** Quantifying the physical response to a contemporary amateur boxing simulation. *J Strength Cond Res* 32(4):1005-1012. https://doi.org/10.1519/JSC.0000000000001926
- 9 elite amateurs; 3 × 3-min notational-analysis-based non-contact protocol.
- [La] 2.4 → 3.3 → 4.3 mmol/L; HRavg 150 → 156 → ~150+; peak 162 → 166 → 169 bpm.
- Used for: contact/opponent pressure as the main metabolic multiplier (real bouts 2-4× higher).

**Folhes O, Reis VM, Marques DL, Neiva HP, Marques MC (2023).** Influence of the competitive level and weight class on technical performance and physiological and psychophysiological responses during simulated MMA fights. *J Hum Kinet* 86:205-215. https://doi.org/10.5114/jhk/159453
- 20 male MMA (HW elite 6, LW elite 3, HW pro 4, LW pro 7); four 3 × 5-min simulated bouts.
- LW elite landed more offensive touches than LW pro; HW pro higher HR after R1; LW pro HR rose more R1 → R2; no [La] differences; RPE higher in pro (R1, R3); LW elite larger RPE rise.
- Used for: weight-dependent early cost and escalation; RPE cost per action inverse to skill.

**Follmer B, Dellagrana RA, Zehr EP (2019).** [Head trauma exposure in MMA varies according to sex and weight class.] *Sports Health*. PMID 30768376. https://pubmed.ncbi.nlm.nih.gov/30768376/ (from PMID) [S]
- 1,903 bouts 2014-17.
- KO/TKO per 100 AE: MW 19.53 / LHW 20.8 / HW 26.09; share of bouts ending KO/TKO: women's SW 7.9% vs men's HW 52.1%.
- Used for: KO hazard gradient by weight class and sex.

**Franchini E, Del Vecchio FB, Matsushigue KA, Artioli GG (2011).** Physiological profiles of elite judo athletes. *Sports Med* 41(2):147-166. https://doi.org/10.2165/11538580-000000000-00000
- Review.
- VO2max ~50-55 (M) / 40-45 (F) mL/kg/min; heavyweights lower aerobic power; upper-body anaerobic power/capacity discriminates elite; aerobic power does not.
- Used for: heavyweight grappler aerobic ceiling (-10-15%); upper-body anaerobic attribute.

**Franchini E, Takito MY, Alves ED, Shiroma SA, Julio UF, Humberstone C (2019).** Effects of different fatigue levels on physiological responses and pacing in judo matches. *J Strength Cond Res* 33(3):783-792. https://doi.org/10.1519/JSC.0000000000003006
- 12 judoka; 3 × 4-min matches after warm-up / 90-min session / all-out uchi-komi HIIT.
- Pre-fatigue changed HR, [La], recovery perception; attacks, feints and RPE preserved; grip-dispute time cut, no-contact displacement increased.
- Used for: fatigue → longer reset/circling segments rather than fewer attacks.

**Franchini E (2020).** High-intensity interval training prescription for combat-sport athletes. *Int J Sports Physiol Perform* 15(6):767-776. https://doi.org/10.1123/ijspp.2020-0289
- Synthesis of E:P and HIA/LIA structure across combat sports.
- Supports sport-specific HIA/LIA/pause ratios.
- Used for: discipline state-machine framing.

**Frey A, et al. (2019).** [Choke-induced loss of consciousness in French judo.] *Orthop J Sports Med*. PMC6545656. https://pmc.ncbi.nlm.nih.gov/articles/PMC6545656/ (from PMCID)
- 421,670 French judo fights.
- 47 choke-LOC cases (~0.11/1000 fights).
- Used for: rarity of choke LOC in point-based grappling.

**Gavagan CJ, Sayers MGL (2017).** A biomechanical analysis of the roundhouse kicking technique of expert practitioners: a comparison between Muay Thai, Karate, and Taekwondo. *PLoS ONE* 12(8):e0182645. https://doi.org/10.1371/journal.pone.0182645
- 8 experts per style; 500 Hz mocap; strain-gauge pad.
- Impact force Muay Thai 1400 ± 419 N, karate 1211 ± 219 N, TKD 1547 ± 530 N (n.s.); foot velocity at impact 7.22/5.57/6.36 m/s; max 13.2-14.7 m/s; execution Muay Thai 1.02 ± 0.15 s vs TKD 1.54 ± 0.52 s; r(v, F) = 0.66.
- Used for: roundhouse damage/execution-time parameters; style speed differences.

**Ghoul N, Tabben M, Miarka B, Tourny C, Chamari K, Coquart J (2019).** Mixed martial arts induces significant fatigue and muscle damage up to 24 hours post-combat. *J Strength Cond Res* 33(6):1570-1579. https://doi.org/10.1519/JSC.0000000000002078 (PMID 28658085)
- 12 fighters, 3 × 5-min simulated MMA.
- HR, RPE, [La] high; leukocytes, cortisol, LDH, uric acid elevated; CMJ lower at 30 min; damage markers persist 24 h.
- Used for: post-fight recovery (≥ 24-48 h) in career mode; end-of-R3 power loss.

**Gift P (2018).** Performance evaluation and favoritism: evidence from mixed martial arts. *J Sports Econ* 19(8):1147-1173. https://doi.org/10.1177/1527002517702422
- Round-by-round judge decisions, Nevada/California 2001-2012, with video statistics; binary and ordered logit (coefficients paywalled).
- Bias toward larger betting favourites, fighters with insurmountable leads and the previous-round winner; no bias toward titleholders or against point deductions; missed takedowns the only significant negative action; tight submissions and knockdowns most influential.
- Used for: judge-bias terms (previous-round winner, favourite; missed takedowns negative).

**Guskiewicz KM, et al. (2003).** [Cumulative effects of recurrent concussion in collegiate football players (NCAA Concussion Study).] *JAMA* 290:2549-2555. PMID 14625331. https://pubmed.ncbi.nlm.nih.gov/14625331/ (from PMID) [S]
- Prospective cohort.
- 3+ prior concussions → OR 3.0 (1.6-5.6) for another; 91.7% of same-season repeats within 10 days.
- Used for: career KO-history multiplier; near-zero within-bout recovery of structural vulnerability.

**Hasegawa [first author] et al. (2026).** [Anatomical review of submission-hold injuries.] *Hawaii J Health Soc Welf*. PMC13233104. https://pmc.ncbi.nlm.nih.gov/articles/PMC13233104/ (from PMCID)
- Anatomical review (full PDF not retrievable).
- Structures loaded by armbar (UCL, common flexor tendon, olecranon, anterior capsule), kimura, americana, heel hook, kneebar, toe hold, neck crank.
- Used for: submission injury anatomy per technique.

**Hinz [first author] et al. (2021).** [Injuries from opponents' submissions in grappling athletes.] PMC8721390. https://pmc.ncbi.nlm.nih.gov/articles/PMC8721390/ (from PMCID)
- 1,140 athletes surveyed.
- 23.4% of injuries from an opponent's submission: armbar 55 (22.4%), kimura 31 (12.6%), heel hook 27 (11%), triangle 19, toe hold 14, straight ankle 8, RNC 8; ACL tears: 41% never returned.
- Used for: submission injury distribution by technique.

**Hutchison MG, Lawrence DW, Cusimano MD, Schweizer TA (2014).** Head trauma in mixed martial arts. *Am J Sports Med* 42(6):1352-1358. https://doi.org/10.1177/0363546514526151 (PMID 24658345)
- All KO/TKO from numbered UFC events 2006-12 (844 bouts); logistic regression + video.
- KO 6.4/100 AE (12.7%); TKO-by-strikes 9.5/100 AE (19.1%); combined 15.9/100 AE (31.9%); risk factors heavier class, earlier in round, earlier round, older age; KO also match significance and prior KO/TKO; all KOs direct head impact, 53.9% mandibular; KO strike → stoppage 3.5 s (0-20) with 2.6 (0-20) extra head strikes; TKO 18.5 (5-46) strikes in final 30 s, 92.3% head.
- Used for: base KO/TKO hazards, jaw multiplier, post-KO window, TKO trigger, referee logic.

**James LP, Haff GG, Kelly VG, Beckman EM (2016).** Towards a determination of the physiological characteristics distinguishing successful mixed martial arts athletes: a systematic review. *Sports Med* 46(10):1525-1551. https://doi.org/10.1007/s40279-016-0493-1
- 23 studies across MMA and feeder sports.
- Strength, neuromuscular power and anaerobic variables discriminate level; aerobic power less so.
- Used for: attribute weighting for level differences.

**James LP, Robertson S, Haff GG, Beckman EM, Kelly VG (2017).** Identifying the performance characteristics of a winning outcome in elite mixed martial arts competition. *J Sci Med Sport* 20(3):296-301. https://doi.org/10.1016/j.jsams.2016.08.001 (open copy: https://vuir.vu.edu.au/31281/)
- 234 decisive male UFC bouts (Jul-Dec 2014); Cohen's d, 10-fold CV decision trees, DFA.
- TD accuracy 50.9 ± 32.5% vs 29.0 ± 34.7% (d = 0.62); raw tree 71.8% (> 4 sig ground strikes/bout → 80.4%; + TD acc > 25% → 84.9%); rate tree 76.3% (> 0.85 sig ground strikes/min → 91.5%; + > 4.19 landed/min → 96.3%); DFA 71.4/71.2%; attempts without accuracy did not contribute.
- Used for: scoring on landed rate/accuracy; ground-strike and TD-accuracy calibration targets.

**James LP, Sweeting AJ, Kelly VG, Robertson S (2019).** Longitudinal analysis of tactical strategy in the men's division of the Ultimate Fighting Championship. *Front Artif Intell* 2:29. https://doi.org/10.3389/frai.2019.00029
- 2,831 decisive male UFC bouts 2000-2015; nMDS + RIPPER rule induction.
- Erratic change 2000-08, stable to 2014, renewed 2015; more distance striking post-2008; rules train 77.0% / test 75.2%; sig ground strikes ≥ 6 AND total landed ≥ 81 → win (559 TP); 1 ground strike → 77-79% win in very short/long bouts.
- Used for: step-like ground-strike effect; era parameterisation.

**Jones AJ, Hasnain F, Shipchandler TZ, Vernon DJ, Elghouche AN (2023).** Characteristics of facial trauma in professional mixed martial arts. *Facial Plast Surg Aesthet Med* 25(4):332-337. https://doi.org/10.1089/fpsam.2022.0097
- 1,462 UFC fighters (NSAC 2010-20).
- ≥ 3 rounds 59.4%; decision 50.5%, KO 31.2%; facial injury 15.8% (lacerations 12.0%, fractures 3.6%); predictors male, heavier, more rounds, losing, non-submission outcome.
- Used for: per-fighter-bout cut/fracture probabilities; finish mix.

**Ju YY, Liu YH, Cheng CH, et al. (2018).** Effects of combat training on visuomotor performance in children aged 9 to 12 years - an eye-tracking study. *BMC Pediatr* 18:39. https://doi.org/10.1186/s12887-018-1038-6
- 26 children, 8 weeks of combat training vs 30 controls.
- Earlier primary/secondary saccade onset after training; hit-response time improved in both groups.
- Used for: fast initial learning curve for the "read" attribute.

**Karpman S, et al. (2016).** [MMA vs boxing injuries, Edmonton 2000-13.] *Clin J Sport Med* 26:332-334. PMID 26327287. https://pubmed.ncbi.nlm.nih.gov/26327287/ (from PMID) [S]
- 1,181 MMA / 550 boxers, commission records.
- Boxers more often uninjured (59.4% vs 49.8%); MMA more contusions; boxing more LOC/eye injuries.
- Used for: ruleset-specific injury profiles.

**Kirk C (2016a).** The influence of age and anthropometric variables on winning and losing in professional mixed martial arts. *Facta Universitatis, Series: Physical Education and Sport* 14(2):227-236. https://casopisi.junis.ni.ac.rs/index.php/FUPhysEdSport/article/view/2070 (open copy: https://shura.shu.ac.uk/27850/)
- 278 UFC bouts; Bayes factors on age, stature, wingspan, stature:wingspan.
- Anthropometrics "for the most part have no effect"; older fighters more likely to lose, and via strikes; decision winners older than finish winners; taller welterweights slightly favoured (anecdotal); greater wingspan → more submission losses; taller losers lose via strikes.
- Used for: age-dependent chin/durability and pacing terms; no height/reach win term.

**Kirk C (2016b).** Does stature or wingspan length have a positive effect on competitor rankings or attainment of world title bouts in international and elite mixed martial arts? *Sport Science Review* 25(5-6):334-349. https://doi.org/10.1515/ssr-2016-0018 (open copy: https://shura.shu.ac.uk/27848/)
- 474 elite competitors; rankings and title bouts per division.
- Shorter competitors ranked higher at flyweight; more likely to fight for/win titles at FW/FLW; weak negative stature-rank at LW/LHW; stature:wingspan 1:1.024; anthropometry cannot predict success.
- Used for: no height/reach bonus in generation; ape-index mean.

**Kirk C (2018).** Does anthropometry influence technical factors in competitive mixed martial arts? *Hum Mov* 19(2):46-59. https://doi.org/10.5114/hm.2018.74059 (open copy: https://shura.shu.ac.uk/27931/)
- 461 elite pro bouts; Bayesian t-tests and correlations per division.
- HW sig strikes landed 66.5 vs 36.5 (BF10 = 399, d = 0.84), ground 10.3 vs 2.3 (d = 0.75); WW ground 7.5 vs 1.3 (BF10 = 3.5e6, d = 0.69), sig strikes 59 vs 24.8 (d = 0.64), TDs 1.8 vs 0.1 (d = 0.55); LW sig strikes 42.4 vs 29.6 (d = 0.86), KDs 0.5 vs 0.1 (d = 0.49); HW wingspan Δ ↔ sig-strike Δ τ = 0.469 (≈ +1.6 per cm); LW KD Δ = 0.355 + 0.028 × wingspan Δ.
- Used for: reach → landed output (HW) and knockdowns (LW); winner/loser output targets.

**Kirk C, Langan-Evans C, Morton JP (2020).** Worth the weight? Post weigh-in rapid weight gain is not related to winning or losing in professional mixed martial arts. *Int J Sport Nutr Exerc Metab* 30(5):357-361. https://doi.org/10.1123/ijsnem.2019-0347
- 62 winners vs 62 losers, five CSAC events with two weigh-ins.
- No support for mass (BF10 = 0.667, d = 0.23) or regain (BF10 = 0.821, d = 0.23) determining outcome; athletes compete 1-2 divisions above weigh-in class.
- Used for: capping the regain modifier; fight-night mass ≈ limit + 8-10%.

**Kirk C, Clark DR, Langan-Evans C, Morton JP (2020).** The physical demands of mixed martial arts: a narrative review using the ARMSS model. *J Sports Sci* 38(24):2819-2841. https://doi.org/10.1080/02640414.2020.1802093 (PMID 32783581)
- 70 articles.
- MMA research mostly descriptive; competition loads not adequately identified; predictors of success not established.
- Used for: treating MMA tuning numbers as priors to validate against fight records.

**Kirk C (2023/2024).** A 5-year analysis of age, stature and armspan in mixed martial arts. *Res Q Exerc Sport* 95(2):450-457. https://doi.org/10.1080/02701367.2023.2252473 (open copy: https://shura.shu.ac.uk/32072/)
- 2,229 UFC bouts 2017-21 (1,858 male, 371 female); Bayesian Mann-Whitney/Wilcoxon.
- Winners 29.8 ± 4.0 vs 30.7 ± 4.2 y (BF10 = 29,993; r = 0.18); Δage -0.82 ± 5.3 y (BF10 = 239,368); supported 4/5 years and at MW/WW/LW/FW/BW (r 0.17-0.29), null LHW/women; stature Δ 0.5 ± 8.9 cm (BF01 = 7); armspan +0.6 cm (BF10 = 6, r = 0.08), HW +2.2 ± 9.8 cm (BF10 = 10, r = 0.28; 198.4 vs 196.1); A:S disadvantage women's SW only (1.003 vs 1.010); no effect on method of victory (BF01 29-122); population 177.5 ± 9.5 cm, 182.2 ± 11.5 cm, A:S 1.026 ± 0.028.
- Used for: age coefficient (~0.06/yr), fighter-generation anthropometrics, HW reach term.

**Kochhar T, et al. (2005).** [Neck forces in judo/grappling neck manipulation.] *Br J Sports Med*. PMID 15976168. https://pubmed.ncbi.nlm.nih.gov/15976168/ (from PMID) [S]
- Biomechanical estimate (Newton values not retrievable).
- Guillotine/neck-manipulation forces of the same order as whiplash.
- Used for: neck-crank/guillotine strain modelling.

**Koiwai EK (1987).** Deaths allegedly caused by the use of "choke holds" (shime-waza). *J Forensic Sci* 32:419-432. PMID 3572335. https://pubmed.ncbi.nlm.nih.gov/3572335/ (from PMID); also https://judoinfo.com/chokes6/
- Forensic/physiological review of judo chokes.
- Properly applied shime-waza → LOC in 10-20 s; ~300 mmHg on the carotid triangle suffices; airway needs ~6× more pressure; O2 saturation normal within 13.7 s of release; no judo shime-waza deaths since 1882.
- Used for: choke LOC timing and recovery bounds; air vs blood choke pressure ratio.

**Kraemer WJ, Fry AC, Rubin MR, et al. (2001).** Physiological and performance responses to tournament wrestling. *Med Sci Sports Exerc* 33(8):1367-1378. https://doi.org/10.1097/00005768-200108000-00019
- 12 D-I wrestlers, 6% weight loss, 2-day simulated tournament.
- Lower-body power and upper-body isometric strength fell progressively; lactate, cortisol, catecholamines rose after every match; resting testosterone fell later.
- Used for: multi-bout tournament carry-over deficit.

**Lamas L, Heiner M, Ferreira M, et al. (2024).** No-gi Brazilian jiu-jitsu: a Markovian analysis of elite-level combat dynamics. *Int J Sports Sci Coach* 19(2). https://doi.org/10.1177/17479541231210979
- All 93 matches (90 competitors) of 2019 ADCC; Bayesian transition estimates.
- Most actions < 1 per competitor per match except submission attempts (1.03); guard pass → guard pass 0.30; TD attempt → sub attempt 0.15; back-take → submission 0.45; most actions positive reward-risk.
- Used for: grappling state-machine transition probabilities.

**Lawrence DW, Hutchison MG, Cusimano MD, Singh T, Li L (2014).** Interrater agreement of an observational tool to code knockouts and technical knockouts in mixed martial arts. *Clin J Sport Med* 24(5):397-402. https://doi.org/10.1097/JSM.0000000000000047
- MMA-KT 20-factor tool on 125 KO/TKO events.
- Mean κ 0.86 (0.59-1.0).
- Used for: event-log schema (competitor state, mechanism, follow-up strikes) and defensibility of a rule-based stoppage state machine.

**Le Flao E, Lenetsky S, Siegmund GP, Borotkanics R (2024).** Capturing head impacts in boxing: a video-based comparison of three wearable sensors. *Ann Biomed Eng* 52(2):270-281. https://doi.org/10.1007/s10439-023-03369-w
- 7 boxers, 115 sparring rounds, 5,168 video-identified head contacts.
- ~45 contacts per 2-min round; sensitivity mouthguard 35%, skin patch 86%, headgear patch 78%.
- Used for: preferring video-coded competition exposure rates over sensor counts.

**Lenetsky S, Nates RJ, Brughelli M, Harris NK (2015).** Is effective mass in combat sports punching above its weight? *Hum Mov Sci* 40:89-97. https://doi.org/10.1016/j.humov.2014.11.016
- Review of effective mass, double-peak muscle activation, calculation methods.
- Punching adds force during impact beyond a rigid-mass model (joint stiffening).
- Used for: impact quality = effective mass × velocity × stiffness; commitment/plant state multiplier.

**Liu Y, et al. (2022).** Biomechanics of the lead straight punch of different level boxers. *Front Physiol* 13:1015154. https://doi.org/10.3389/fphys.2022.1015154
- Elite (n = 8, 24 y) vs junior (n = 8, 17 y).
- Peak fist velocity 7.16 ± 0.48 vs 6.32 ± 0.42 m/s; contact velocity 5.56 vs 4.87; peak force 1508 ± 411 vs 1035 ± 220 N (21.0 vs 15.6 N/kg); impulse 24.7 vs 16.8 N·ms; lead-leg RFD 16.9 vs 10.3 N/ms.
- Used for: jab force (1000-1500 N), leg-drive attribute.

**Loosemore M, et al. (2017).** [Hand and wrist injuries in elite boxing (GB).] *Hand (N Y)*. PMID 28344531. https://pubmed.ncbi.nlm.nih.gov/28344531/ (from PMID) [S]
- GB elite boxing injury surveillance.
- Hand/wrist competition injury rate 347/1000 h.
- Used for: attacker hand-injury probability per landed punch (ESTIMATE anchor).

**Lota KS, Malliaropoulos N, Blach W, et al., Maffulli N (2022).** Rotational head acceleration and traumatic brain injury in combat sports: a systematic review. *Br Med Bull* 141(1):33-46. https://doi.org/10.1093/bmb/ldac002
- 22 studies.
- RA ranges: boxing hooks 1,740-9,306; front/jaw 1,530-14,065 / 6,896-8,605; MMA hook 5,550; MMA competition 3,773 vs sparring 1,766; judo throws 276-5,081; TKD turning kick 10,927, roundhouse 5,908; straight 9,556; concussive MMA 7,561 vs non-injury 5,056-7,070; boxing LOC 11,280 vs 6,146; thresholds concussion ~4,500, DAI/ASDH ~10,000 rad/s².
- Used for: strike → RA map and KO logistic midpoint (~8,000-9,000).

**Loturco I, Nakamura FY, Artioli GG, et al., Franchini E (2016).** Strength and power qualities are highly associated with punching impact in elite amateur boxers. *J Strength Cond Res* 30(1):109-116. https://doi.org/10.1519/JSC.0000000000001075
- 15 Brazilian national team (9 M, 6 F).
- Impact ↔ jump/squat/bench power r = 0.67-0.85 (lower-limb strongest); self-selected distance > fixed for jab impact.
- Used for: single "power" attribute dominated by lower-body power; range-preference impact bonus.

**Loturco I, Pereira LA, Kobal R, et al., McGuigan M (2021).** Transference effect of short-term optimum power load training on the punching impact of elite boxers. *J Strength Cond Res* 35(9):2373-2378. https://doi.org/10.1519/JSC.0000000000003165
- n = 8; one-week OPL block.
- Punch impact +~8%; jump-squat/half-squat power +12-14%; transfer ≈ 0.80.
- Used for: career-mode training-block effect sizes (~5-10%).

**Lystad RP, Gregory K, Wilson J (2014).** The epidemiology of injuries in mixed martial arts: a systematic review and meta-analysis. *Orthop J Sports Med* 2(1):2325967113518492. https://doi.org/10.1177/2325967113518492 (PMID 26535267)
- 6 studies pooled.
- 228.7/1000 AE (95% CI 110-474); head 66.8-78.0%; wrist/hand 6-12%; laceration 36.7-59.4%, fracture 7.4-43.3%, concussion 3.8-20.4%; losers 3× winners; KO/TKO bouts > 2× submission bouts.
- Used for: injury probability and type split; loser/finish multipliers.

**Ma C (2025).** The correlation between weight divisions and methods used by winning mixed martial arts athletes. *The Sport Journal*. https://thesportjournal.org/article/the-correlation-between-weight-divisions-and-methods-used-by-winning-mixed-martial-arts-athletes/
- 174 ranked UFC athletes (127 M, 47 F), career win methods; low-tier journal, survivorship bias.
- KO/TKO 40.2%, decision 36.8%, submission 23.0%; males 43.8/33.4/22.9%; females 30.6/46.0/23.2%; heavier male divisions more KO/TKO (χ² 30.1, 33.2, 15.8); females independent of division.
- Used for: win-method mix sanity check by division and sex.

**Ma K, Li K, Zhu Z, Shao HT (2026).** Temporal trends and weight-class differences in takedown density in professional mixed martial arts: 8,461 UFC bouts, 1997-2025. *BMC Sports Sci Med Rehabil* 18:385. https://doi.org/10.1186/s13102-026-01804-8
- 8,461 bouts; 15,146 men's + 1,776 women's fighter-observations.
- Men's TD density -0.0043/min/yr (r = -0.75; 2002-25 -0.0020); median 0 in most divisions (FLW 0.067); winners 0.067 vs losers 0.000/min; TD success 50% vs 20%; control 99.8 vs 78.9 s per TD; weight-class ε² 0.005-0.007; women n.s.
- Used for: TD rate, success, control time, era trend; no weight-class scaling.

**Mańka-Malara K, Mierzwińska-Nastalska E (2022).** Head trauma exposure in mixed martial arts. *Int J Environ Res Public Health* 19(20):13050. https://doi.org/10.3390/ijerph192013050
- 2,488 UFC fights (2000-21), 4,976 fighter-bouts; scorecards + video.
- 6.30 head strikes/min and 2.41 significant/min received (W 7.73/2.95, M 6.20/2.37); 31.6% of fights ended by head trauma (M 32.2%, W 23.1%); 88.1% of KO/TKOs head trauma; HW ~54%, LHW ~38%, FLW ~12.5%; mean time to head-trauma KO 6:06 (5 s-24:10); title 8:57 vs 5:30.
- Used for: head-strike exposure, KO hazard by class, KO timing distribution.

**Mańka-Malara K, et al. (2025).** [Submission types in UFC fights.] *J Clin Med*. PMC12610064. https://pmc.ncbi.nlm.nih.gov/articles/PMC12610064/ (from PMCID)
- 2,488 UFC fights.
- 18.7% by submission; chokes 68.6% of subs (RNC 154, guillotine 89, triangle 35, arm-triangle 26); arm/hand locks 27.1% (armbar 63, kimura 21).
- Used for: submission technique mix.

**Martinez de Quel O, Bennett SJ (2019).** Perceptual-cognitive expertise in combat sports: a narrative review and a model of perception-action. *RICYDE* 15(58):323-338. https://doi.org/10.5232/ricyde2019.05802
- Narrative review (boxing, karate, TKD, fencing, judo).
- Expert advantage specific to sport-relevant dynamic stimuli; earlier use of trunk/shoulder cues; larger in-situ than button-press effects; feints manipulate the opponent's read.
- Used for: feint mechanics that exploit the opponent's read process.

**McClain R, Wasserman J, Mayfield C, et al. (2014).** Injury profile of mixed martial arts competitors. *Clin J Sport Med* 24(6):497-501. https://doi.org/10.1097/JSM.0000000000000078
- 711 bouts, 1,422 participations (KS/MO).
- Injury 8.5% of participations / 5.6% of rounds; higher for pro, more rounds, KO/TKO; men more altered-mental-state injuries.
- Used for: regional/amateur injury lower bound; per-round hazard.

**Menescardi C, Falco C, Ros C, Morales-Sánchez V, Hernández-Mendo A (2019).** Development of a taekwondo combat model based on Markov analysis. *Front Psychol* 10:2188. https://doi.org/10.3389/fpsyg.2019.02188
- 11,474 male and 12,980 female Olympic TKD actions.
- 32 (M) / 30 (F) significant sequences; initiations ≈ 1/3 attack, 1/3 counter, 1/3 defensive; common: opening + dodge, direct attack + simultaneous counter, dodge + direct attack, indirect attack + simultaneous counter.
- Used for: exchange grammar (initiation mix; simultaneous counters as first-class transitions).

**Miarka B, Panissa VL, Julio UF, Del Vecchio FB, Calmet M, Franchini E (2012).** A comparison of time-motion performance between age groups in judo matches. *J Sports Sci* 30(9):899-905. https://doi.org/10.1080/02640414.2012.679675
- 1,811 judo matches across age groups.
- Median 7 (IQR 3-12) combat/pause cycles per match; seniors longest groundwork.
- Used for: judo engagement-cycle count; ground share 10-20% for seniors.

**Miarka B, Vecchio FB, Camey S, Amtmann JA (2016).** Comparisons: technical-tactical and time-motion analysis of mixed martial arts by outcomes. *J Strength Cond Res* 30(7):1975-1984. https://doi.org/10.1519/JSC.0000000000001287
- 645 UFC rounds paired winner/loser (215 pairs per round).
- Winners > losers in total strikes, submission attempts, positional improvements in all rounds; standing LI R1 2:33.5 (1:20-3:56), R2 2:37 (1:24-3:59), R3 2:07 (1:06-3:39).
- Used for: neutral-standing time budget; R3 urgency; winner-determination signals.

**Miarka B, Brito CJ, Dal Bello F, Amtmann J (2017).** Motor actions and spatiotemporal changes by weight divisions of mixed martial arts: applications for training. *Hum Mov Sci* 55:73-80. https://doi.org/10.1016/j.humov.2017.07.009
- 2,814 UFC rounds, all divisions.
- Keeping-distance time lowest FW 131.4 s, BW 127.9 s; clinch-without-attack FLW 11.4 s, WW 12.6 s; distance head strikes WW 7 ± 8 landed / 24 ± 22 attempted; clinch head HW 3 ± 7 / 4 ± 9; ground head BW 8 ± 10 / 10 ± 13.
- Used for: per-division phase budgets; distance (~0.29) and ground (~0.8) head-strike accuracy.

**Miarka B, Brito CJ, Moreira DG, Amtmann J (2018).** Differences by ending rounds and other rounds in time-motion analysis of mixed martial arts. *J Strength Cond Res* 32(2):534-544. https://doi.org/10.1519/JSC.0000000000001804
- 1,564 rounds / 678 pro bouts not decided on points.
- KO/TKO ≈ 60% of finish rounds; submissions > 30% of finishes in R1-R2; standing LI in ending rounds 91.5 ± 71.4 / 93.4 ± 67.5 / 143.2 ± 87.4 s; standing HI 7.4 ± 9.2 / 9.7 ± 18.0 / 17.7 ± 29.1 s.
- Used for: exchange-time distribution; finish-type weights by round.

**Miarka B, Nascimento de Carvalho G, Valenzuela Pérez DI, Aedo-Muñoz E, Brito CJ (2021).** Comparisons of pacing strategy and technical-tactical behaviors in female mixed martial arts rounds. *Front Psychol* 11:548546. https://doi.org/10.3389/fpsyg.2020.548546
- 74 female KO/TKO fights, 174 rounds, 13,572 sequences (2014-18).
- Standing preparatory 1:51-2:27; standing fighting 15-19 s; ground 47-52 s; ending-round strikes attempted 24.5/61.5/57.5, head 12/48/36, landed 15.5/36.5/30; TDs 1.1 ± 1.3 attempted, 0.4 ± 0.7 landed.
- Used for: per-round strike budget (~55-60 attempts, ~55-60% landed); TD success ~35-40%; stationary non-ending rounds.

**Miarka B, Soto DAS, Aedo-Muñoz EA, et al., Brito CJ (2022).** Concussion vs. resignation by submission: technical-tactical behavior analysis considering injury in mixed martial arts. *Front Neurol* 13:941829. https://doi.org/10.3389/fneur.2022.941829 (PMID 36119707)
- 990 concussion-ended vs 627 submission-ended rounds.
- ~90% of concussions from head trauma; distance head strikes 13 (6-25) vs 9 (4-18); clinch head 1 (0-4) vs 1 (0-3); ground head 1 (0-8) vs 2 (0-10); TDs 0 (0-1) vs 1 (0-2).
- Used for: distance striking as the KO channel; takedown rounds skew to submissions.

**Miele VJ, Bailes JE (2007).** Objectifying when to halt a boxing match: a video analysis of fatalities. *Neurosurgery* 60(2):307-316. https://doi.org/10.1227/01.NEU.0000249247.48299.5B
- CompuBox comparison of fatal bouts vs 4,000 controls vs "classic" competitive bouts.
- Fatal bouts had more punches landed/round, power punches landed/round and power punches thrown by losers than average, but not vs highly competitive bouts.
- Used for: cumulative damage accumulator with stoppage keyed on damage state, not counts.

**Mihalik JP, et al. (2010).** [Collision type and player anticipation affect head impact severity in youth ice hockey.] *Pediatrics*. PMID 20478933. https://pubmed.ncbi.nlm.nih.gov/20478933/ (from PMID) [S]
- Instrumented helmets, youth hockey.
- Unanticipated collisions more severe, especially in the 50th-75th percentile band.
- Used for: unseen-strike multiplier (direction).

**Miller K, Nichols M (2026).** Efficient market insights and favorite-longshot bias in mixed martial arts betting markets. *J Econ Finance* 50(1). https://doi.org/10.1007/s12197-026-09757-x
- Large tapology.com odds/outcome dataset (abstract-level).
- No favourite-longshot bias; market largely efficient; youth and travel not fully priced; women's favourites slightly under-priced; few significant out-of-sample returns.
- Used for: in-game market-odds generation (unbiased, slight age/travel mis-pricing).

**Mitchell JR, et al. (2012).** [Cerebral blood flow and consciousness during vascular neck restraint.] *J Appl Physiol* 112:396-402. PMID 22096121. https://pubmed.ncbi.nlm.nih.gov/22096121/
- 24 police officers; transcranial Doppler.
- MCA velocity reduced ~80-83%; ocular fixation/LOC in 16/24 at 9.5 ± 0.4 s; released ~2 s after fixation; full consciousness ~2 s later; mechanism reduced cerebral blood flow (vagal minor).
- Used for: choke LOC timing and recovery.

**Mori S, Ohtani Y, Imanaka K (2002).** Reaction times and anticipatory skills of karate athletes. *Hum Mov Sci* 21(2):213-230. https://doi.org/10.1016/S0167-9457(02)00103-3
- Karate athletes vs novices; choice/simple RT; occluded-video prediction.
- Athletes faster in choice RT (more for sport-specific video); no simple-RT difference; more correct predictions at 7-frame cut-off.
- Used for: expertise as cue-based anticipation (50-100 ms earlier), not global reflex.

**Ngai KM, Levy F, Hsu EB (2008).** Injury trends in sanctioned mixed martial arts competition: a 5-year review from 2002 to 2007. *Br J Sports Med* 42(8):686-689. https://doi.org/10.1136/bjsm.2007.044891 (PMID 18308883)
- 635 pro bouts, 1,270 exposures (Nevada).
- Injury 23.6/100 participations; lacerations and upper limb most common; severe concussion 15.4/1000 AE (3% of matches); age/weight/experience not predictive.
- Used for: LOC-type KO floor (~1.5% of fighter-bouts).

**Nilsson J, Csergö S, Gullstrand L, Tveit P, Refsnes PE (2002).** Work-time profile, blood lactate concentration and rating of perceived exertion in the 1998 Greco-Roman Wrestling World Championship. *J Sports Sci* 20(11):939-945. https://doi.org/10.1080/026404102320761822
- 42 senior wrestlers, 94 matches.
- Match 427 s (324-535); work 317 s, rest 110 s; work period 37.2 s, rest 13.8 s; [La] 14.8 (6.9-20.6); RPE 13.8; forearm flexors most fatigued (53%), deltoids 17%, biceps 12%.
- Used for: clinch/wrestling work-bout structure; grip/forearm local fatigue channel.

**Ottoboni G, Russo G, Tessari A (2015).** What boxing-related stimuli reveal about response behaviour. *J Sports Sci* 33(10):1019-1027. https://doi.org/10.1080/02640414.2014.977939
- Expert boxers, beginners, non-athletes; Simon-like task with attack-posture images.
- Beginners' automatic responses defence-related; experts' counter-attack pattern; non-athletes neither.
- Used for: counter-on-read probability by tier (0.05 / 0.25 / 0.5); beginner default = cover/retreat.

**Ouergui I, Hammouda O, Chtourou H, Zarrouk N, Rebai H, Chaouachi A (2013).** Anaerobic upper and lower body power measurements and perception of fatigue during a kick boxing match. *J Sports Med Phys Fitness* 53(5):455-460. PMID 23903524. https://pubmed.ncbi.nlm.nih.gov/23903524/ (from PMID)
- 18 kickboxers, 3 × 2-min sparring.
- SJ 27.9 → 25.3 cm (-9%), CMJ 29.8 → 28.5 (-4%); arm Wingate PP 5.89 → 5.26 W/kg (-11%), MP 4.51 → 4.12 (-9%); [La], HR, RPE rose each round.
- Used for: within-bout power-loss cap (~10% by end of R3).

**Ouergui I, Hssin N, Franchini E, Gmada N, Bouhlel E (2013).** Technical and tactical analysis of high level kickboxing matches. *Int J Perform Anal Sport* 13(2):294-309. https://doi.org/10.1080/24748668.2013.11868649
- 45 World Championship (2009, 2011) male matches, 135 rounds.
- Most used: straight punches, roundhouse, block/parry, foot defence; winners more hooks, foot defence, clinch, punch combinations, head/body offence, lead/rear punches, higher effectiveness.
- Used for: kickboxing winner profile and default technique set.

**Ouergui I, Hssin N, Haddad M, et al. (2014).** Time-motion analysis of elite male kickboxing competition. *J Strength Cond Res* 28(12):3537-3543. https://doi.org/10.1519/JSC.0000000000000579
- 45 World Championship bouts.
- HIA 2.2 ± 1.2 s; LIA 2.3 ± 0.8 s; pauses 5.4 ± 4.3 s; 3.4 ± 1.2 s between HIAs; fighting:non-fighting 1:1; HIA/round 27.1/25.1/24.9; pause time 12.8/22.3/24.6 s; no weight-class effect.
- Used for: exchange burst/gap structure; pause growth across rounds.

**Ouergui I, Benyoussef A, Houcine N, et al. (2021).** Physiological responses and time-motion analysis of kickboxing: differences between full contact, light contact, and point fighting contests. *J Strength Cond Res* 35(9):2558-2563. https://doi.org/10.1519/JSC.0000000000003190
- Three kickboxing rulesets.
- More time in HR zones 4-5 (80-100% HRmax); HIA < LIA; full contact more HIA than point fighting every round; RPE higher for light/full contact.
- Used for: HR ≥ 85% HRmax in full-contact rounds; ruleset → HIA count.

**Peacock CA, Byers P, Silver T, et al. (2025).** The impact of rapid weight regain on fight outcomes in Bellator mixed martial arts athletes. *Cureus* 17(1):e77785. https://doi.org/10.7759/cureus.77785
- 20 Bellator fighters (16 M, 4 F); very small.
- Regain 9.47 ± 4.57%; logistic p = 0.798; ≥ 10% regain not more likely to win.
- Used for: null-side check; default mean regain ~9.5%.

**Piekarski [first author] et al. (2026).** [Knee injuries in heel-hook-legal IBJJF divisions.] *Sports Health*. PMID 41549501. https://pubmed.ncbi.nlm.nih.gov/41549501/ (from PMID)
- IBJJF competition injury records (full PDF not retrievable).
- Knee injury 26.5/1000 matches (heel-hook-legal) vs 2.2/1000 unexposed, RR 12.0.
- Used for: heel-hook injury risk multiplier.

**Pierce JD, Reinbold KA, Lyngard BC, Goldman RJ, Pastore CM (2006).** Direct measurement of punch force during six professional boxing matches. *J Quant Anal Sports* 2(2): Article 3. https://doi.org/10.2202/1559-0410.1004
- 12 pro boxers, 6 bouts, instrumented gloves, 1,675 landed punches.
- Mean landed force 866.6-1149.2 N; r(mass) = 0.22; JLW lead 1003 / rear 964 N, 64.3% ≤ 1000, 87.7% < 1500, 7/227 ≥ 2000; HW lead 1125 / rear 1098, 50.3% < 1000, 79.7% < 1500, 27/443 ≥ 2000; HW distribution 50/29/14/4/2% by 500-N bins; max 5358 N; landed per round 56.8 vs 73.8; cumulative 55.7 vs 82.1 kN; no round decline (JLW last round 1098 vs 898); more punches + more cumulative force won all 3 decisions.
- Used for: landed-force distribution (log-normal, median ~950 N); judge proxy; no force decay by round.

**Pinto FCL, Neiva H, Nunes C, et al. (2020).** Ultimate Full Contact: fight outcome characterization concerning their methods, occurrence times and technical-tactical developments. *Int J Environ Res Public Health* 17(19):7094. https://doi.org/10.3390/ijerph17197094
- 170 senior male WUFC (hybrid rules, 10-min bouts) fights 2008-2017.
- Outcome order submission > decision = TKO > KO > doctor stoppage; 19.4% went 10 min; 68.8% ended < 5 min; chokes > joint locks; KOs from head punches/kicks in combinations and counters; TKO always combinations, mostly ground-and-pound.
- Used for: KO from counters/combinations; front-loaded finish hazard under amateur/hybrid rules.

**Pollet TV, Stulp G, Groothuis TGG (2013).** Born to win? Testing the fighting hypothesis in realistic fights: left-handedness in the Ultimate Fighting Championship. *Anim Behav* 86(4):839-843. https://doi.org/10.1016/j.anbehav.2013.07.026
- UFC fighters with handedness data.
- Left-handers over-represented vs population; no advantage vs right-handers.
- Used for: southpaw as a selection effect, not a per-fight bonus.

**Pollet TV, Riegman BR (2014).** Opponent left-handedness does not affect fight outcomes for Ultimate Fighting Championship hall of famers. *Front Psychol* 5:375. https://doi.org/10.3389/fpsyg.2014.00375
- 182 hall-of-famer fights; 75 with opponent handedness; 9 right-handed hall of famers.
- No outcome difference vs left- vs right-handed opponents (χ² = 0.17, p = 0.39; GLMM B = -0.214, p = 0.34).
- Used for: stance-mismatch penalty ~0 at high experience.

**Rau R, et al. (1998).** [EEG and clinical effects of judo chokes (juji-jime).] PMID 9741603. https://pubmed.ncbi.nlm.nih.gov/9741603/ (from PMID)
- 6 judoka choked to unconsciousness.
- Mean 8 s to LOC; EEG changes ≤ 20 s after release; no neuropsychological symptoms.
- Used for: choke LOC timing and post-release recovery.

**Razm SS, Márquez-Flórez K, Caprioli L, et al. (2026).** Mechanical efficiency and injury risk in leg kicks across combat sports: a narrative review of stance, hip rotation, and striking surface effects. *Healthcare* 14(4):430. https://doi.org/10.3390/healthcare14040430
- 23 studies, narrative.
- High impact linked to pivoted support leg and proximal-to-distal sequencing; shin vs instep trades tibial stress for foot/ankle trauma; support-knee rotational stress.
- Used for: kicker self-injury channel; flags absence of leg-kick dose-response data.

**Richardson T, Gilman RT (2019).** Left-handedness is associated with greater fighting success in humans. *Sci Rep* 9:15402. https://doi.org/10.1038/s41598-019-51975-3
- 10,445 male boxers (1,779 left), 1,314 female boxers (164), 2,100 MMA fighters (393).
- Prevalence 17.0% / 12.5% / 18.7% vs population 12.6% (M) / 9.9% (F); P(left out-scores right) 52.4% (male boxing, p = 0.0007), 54.5% (female, p = 0.031), 53.5% (MMA, p = 0.016).
- Used for: southpaw prevalence and small career-level edge (+1-2%/fight).

**Rodriguez G, et al. (1991).** [Cerebral effects of judo chokes to syncope.] PMID 1806742. https://pubmed.ncbi.nlm.nih.gov/1806742/ (from PMID)
- 7 judoka choked to syncope.
- No permanent CNS change.
- Used for: absence of lasting harm from brief choke syncope.

**Ross AJ, Ross BJ, Zeoli TC, Brown SM, Mulcahey MK (2021).** Injury profile of mixed martial arts competitions in the United States. *Orthop J Sports Med* 9(3). https://doi.org/10.1177/2325967121991560
- 503 contests (WI/AZ 2018-19).
- 57% of matches ≥ 1 injury (pro 68%, amateur 51%); losers 48% vs winners 24%; pros more lacerations (39% vs 23%); winners more fractures (19% vs 9%, hand); losers more concussions (17% vs 2%).
- Used for: per-bout injury by winner/loser and type.

**Rowson S, et al. (2012).** [Rotational head kinematics in football impacts: an injury risk function for concussion.] *Ann Biomed Eng* 40:1-13. PMID 22012081. https://pubmed.ncbi.nlm.nih.gov/22012081/ (from PMID) [S]
- 300,977 instrumented football impacts.
- Sub-concussive avg 1230; concussive avg 5022 rad/s² (22.3 rad/s); 50% risk 6383 rad/s² (28.3 rad/s).
- Used for: KO logistic midpoint (6383) and spread (1800 ESTIMATE).

**Rowson S, Duma SM (2013).** Brain injury prediction: assessing the combined probability of concussion using linear and rotational head acceleration. *Ann Biomed Eng* 41(5):873-882. https://doi.org/10.1007/s10439-012-0731-0
- 63,011 instrumented football impacts (37 diagnosed, adjusted to 244); validated on 58 NFL reconstructions.
- CP = 1/(1 + exp(-(β0 + β1·a + β2·α + β3·a·α))), β0 = -10.2, β1 = 0.0433/g, β2 = 0.000873 per rad/s², β3 = -9.2e-7; concussive impacts 104 ± 30 g, 4,726 ± 1,931 rad/s²; worked: Walilko straight CP ≈ 0.08, Viano hook ≈ 0.60, Stojsih peak ≈ 1.0.
- Used for: per-strike concussion probability (with rotation weight raised ×1.3-1.5 for combat).

**Russo G, Ottoboni G (2019).** The perceptual-cognitive skills of combat sports athletes: a systematic review. *Psychol Sport Exerc* 44:60-78. https://doi.org/10.1016/j.psychsport.2019.05.004
- Systematic review.
- Experts use sport-specific anticipation, fewer/longer central fixations, action-specific processing.
- Used for: perception-action loop framing (cue detection → read → decision → execution).

**Sasaki [first author] et al. (2022).** [Loss of consciousness from shime-waza at Judo World Championships 2015-2021.] *J Sci Med Sport*. PMID 36167661. https://pubmed.ncbi.nlm.nih.gov/36167661/ (from PMID)
- 7,426 World Championship bouts.
- Shime-waza ended 4.1% (cadet 6.0%, junior 4.4%, senior 3.0%); LOC in 18.9% / 14.6% / 4.3% of choke finishes; 61.5% of 39 LOC cases convulsions/staggering; LOC → release 5.0 ± 3.5 s (symptomatic) vs 2.4 ± 2.0 s; ≥ 4 s post-LOC predicts symptoms (OR 6.7).
- Used for: post-LOC release rules and sequelae.

**Scoggin JF, et al. (2014).** [Injuries in BJJ tournament competition.] PMC4555620. https://pmc.ncbi.nlm.nih.gov/articles/PMC4555620/ (from PMCID)
- 5,022 match exposures.
- 46 injuries (9.2/1000); armbar caused 10/14 elbow injuries; only 1 choke injury.
- Used for: choke vs joint-lock injury asymmetry.

**Singerman [first author] et al. (2026).** [Laryngopharyngeal symptoms after chokes in BJJ/MMA.] *OTO Open*. PMID 42256725. https://pubmed.ncbi.nlm.nih.gov/42256725/ (from PMID)
- 160 BJJ/MMA athletes surveyed.
- 88% laryngopharyngeal symptoms after chokes; 15% permanent voice change; 8/18 who sought care had hyolaryngeal fracture.
- Used for: air-choke injury channel.

**Slimani M, Chaabène H, Davis P, Franchini E, Cheour F, Chamari K (2017).** Performance aspects and physiological responses in male amateur boxing competitions: a brief review. *J Strength Cond Res* 31(4):1132-1141. https://doi.org/10.1519/JSC.0000000000001643
- Review.
- Activity:rest 18:1 elite vs 9:1 novice; novice rounds 16:1, 8:1, 6:1; winning ↔ triple-punch combos, block-and-counter, head punches, effectiveness; [La] rises R1 → R3 in novices, higher in official bouts; %HRmax and %VO2max highest in R3.
- Used for: boxing pause fractions; combination/counter win value.

**Slimani M, Chaabène H, Miarka B, Chamari K (2017).** The activity profile of elite low-kick kickboxing competition. *Int J Sports Physiol Perform* 12(2):182-189. https://doi.org/10.1123/ijspp.2015-0659 (DAMAGE_PHYSIOLOGY cites the same numbers as "Ouergui et al. 2017, IJSPP, PMID 27197115"; attribution discrepancy unresolved)
- 72 kickboxers, 36 bouts.
- E:P ~1:1.5 overall (HW 1:1); HI:pause ~1:6; E:P by round 1:1, 1:1.5, ~1:2; males upper limb 63.4% / lower 36.6%; head 56.9% / body-leg 43.1%; winners > losers in head-targeted actions, counterattacks, jab-cross, total punches; E:P did not differ.
- Used for: technique mix, effort-ratio degradation across rounds.

**Slimani M, Davis P, Franchini E, Moalla W (2017).** Rating of perceived exertion for quantification of training and combat loads during combat sport-specific activities: a short review. *J Strength Cond Res* 31(10):2889-2902. https://doi.org/10.1519/JSC.0000000000002047
- Review.
- RPE higher in MMA than BJJ or kickboxing; RPE-[La] r = 0.81 striking vs 0.53 grappling; RPE-HR 0.52-0.95.
- Used for: separate isometric/grip fatigue channel for grapplers.

**Smith MS, Dyson RJ, Hale T, Janaway L (2000).** Development of a boxing dynamometer and its punch force discrimination efficacy. *J Sports Sci* 18(6):445-450. https://doi.org/10.1080/02640410050074377
- 7 elite, 8 intermediate, 8 novice boxers; straight punches on a manikin dynamometer.
- Rear 4800 ± 227 / 3722 ± 133 / 2381 ± 116 N; lead 2847 ± 225 / 2283 ± 126 / 1604 ± 97 N; rear > lead (p < .001).
- Used for: force ceiling by tier (0.50 / 0.78 / 1.00); lead ≈ 0.59 × rear.

**Smith [first author] et al. (2011).** [Effects of prolonged carotid occlusion.] PMID 21532128. https://pubmed.ncbi.nlm.nih.gov/21532128/ (from PMID)
- Cited for prolonged (100 s) occlusion consequences.
- Dilated pupils, tonic/clonic movements with prolonged occlusion.
- Used for: post-LOC convulsion modelling if a choke is held.

**Stellpflug SJ, et al. (2020).** Time to unconsciousness from sportive chokes in fully resisting highly trained combatants. *Int J Perform Anal Sport* 20(4):720-728. https://doi.org/10.1080/24748668.2020.1780873
- 81 real choke sequences, video.
- Choke-established → LOC mean 9.0 s (95% CI 8.3-9.9); neck-only 8.9 s, arm-in 9.0 s (n.s.); per-type 6.2-10.5 s (RNC ~8.9, standard guillotine ~8.9, arm-in guillotine ~10.2).
- Used for: locked-choke LOC timer (~9 s, range 6-13).

**Stellpflug SJ, et al. (2020).** [Survey of grapplers on choke-induced unconsciousness.] PMID 32271638. https://pubmed.ncbi.nlm.nih.gov/32271638/ (from PMID)
- 4,307 grapplers surveyed.
- 27.8% choked unconscious at least once; 0.05% ongoing symptoms.
- Used for: long-term choke sequelae (negligible).

**Stellpflug SJ, et al. (2022).** [Fight-ending chokes in UFC history.] *Phys Sportsmed*. PMID 33347362. https://pubmed.ncbi.nlm.nih.gov/33347362/ (from PMID)
- Every fight-ending choke in UFC history.
- 904 chokes = 15.5% of outcomes, 76.2% of grappling submissions; RNC 49.1% of choke finishes; 11% ended in LOC, ~89% tap.
- Used for: choke share of finishes; LOC vs tap split.

**Stellpflug SJ, et al. (2022).** [Cervical artery injury after sportive chokes: case series.] *J Emerg Med*. PMID 35934648. https://pubmed.ncbi.nlm.nih.gov/35934648/ (from PMID)
- 10 cases.
- 5 carotid dissections, 3 vertebral, 2 strokes.
- Used for: rare catastrophic choke outcome (career mode only).

**Sterkowicz-Przybycień K, Miarka B, Fukuda DH (2017).** Sex and weight category differences in time-motion analysis of elite judo athletes. *J Strength Cond Res* 31(3):817-825. https://doi.org/10.1519/JSC.0000000000001597
- 1,411 matches (2012 Olympic qualifiers), 111,203 situations.
- Combat sequence median 23.9-28.5 s; pause 4.0-8.8 s; heavyweights longer groundwork and pauses.
- Used for: judo/grappling engagement cycle (~26 s + ~6 s).

**Stojsih S, Boitano M, Wilhelm M, Bir C (2010).** A prospective study of punch biomechanics and cognitive function for amateur boxers. *Br J Sports Med* 44(10):725-730. https://doi.org/10.1136/bjsm.2008.052845
- 30 M + 30 F amateurs, instrumented headgear, 4 × 2-min sparring.
- Peak PLA 191 g (M) / 184 g (F); peak RA 17,156 / 13,113 rad/s²; peak HIC 1652 / 1079; most impacts sub-threshold; only delayed memory fell.
- Used for: heavy-tailed per-strike acceleration sampling.

**Thomas RE, Thomas BC (2018).** Systematic review of injuries in mixed martial arts. *Phys Sportsmed* 46(2):155-167. https://doi.org/10.1080/00913847.2018.1430451
- 5,374 male / 108 female fighters compiled.
- Weighted injury rate 246.4/1000 AE (M), 101.9 (F); pros 135.5 vs amateurs 71.0; stoppages per 1000 AE: KO/TKO 173.9, submission 228.6, decision 98.2.
- Used for: amateur ≈ half pro injury; finish-type mix as a level/ruleset parameter.

**Thomson E, Lamb K (2016).** The technical demands of amateur boxing: effect of contest outcome, weight and ability. *Int J Perform Anal Sport* 16(1):203-215. https://doi.org/10.1080/24748668.2016.11868881
- 84 boxers, 42 bouts, regional and national, three weight bands; log-linear modelling.
- ~25 punches, ~10 defences/min; ~105 attacks, ~183 punches per bout; jab 28% landed; cross/lead hook/rear hook 33-40%; foot defence 70% successful; winning ↔ more offence and fewer arm/trunk defences; national standard higher frequencies.
- Used for: landing probabilities by punch type; defence success by type; tier action-rate scaling.

**Vagner M, Cleather DJ, Olah V, Vacek J, Stastny P (2023).** A systematic review of dynamic forces and kinematic indicators of front and roundhouse kicks across varied conditions and participant experience. *Sports (Basel)* 11(8):141. https://doi.org/10.3390/sports11080141
- 43 articles.
- Front kick force 47% / 92% / 120% higher than roundhouse (novice / sub-elite / elite); roundhouse max foot velocity 44-48% higher; instruments heterogeneous.
- Used for: front kick = force tool, roundhouse = speed tool; skill widens the gap.

**Viano DC, Casson IR, Pellman EJ, Bir CA, Zhang L, Sherman DC, Boitano MA (2005).** Concussion in professional football: comparison with boxing head impacts - part 10. *Neurosurgery* 57(6):1154-1172. https://doi.org/10.1227/01.neu.0000187541.87937.d9 (PMID 16331164)
- 11 Olympic boxers (51-130 kg), 78 blows on Hybrid III + FE brain.
- Hook: hand Δv 11.0 ± 3.4 m/s; force 4405 ± 2318 N; PLA 71.2 ± 32.2 g; RA 9306 ± 4485 rad/s²; neck 855 N (± 537); effective radius 65 vs 34 mm (football); peak midbrain strain late in pulse; HIC lower than NFL despite similar levels.
- Used for: hook RA (~1.5 × straight); rotational KO mechanism; jaw lever reasoning.

**Walilko TJ, Viano DC, Bir CA (2005).** Biomechanics of the head for Olympic boxer punches to the face. *Br J Sports Med* 39(10):710-719. https://doi.org/10.1136/bjsm.2004.014126 (PMID 16183766)
- 7 Olympic boxers (5 classes), 18 straight punches to a Hybrid III frangible face.
- Force 3427 ± 811 N; hand velocity 9.14 ± 2.06 m/s; effective mass 2.9 ± 2.0 kg; jaw load 876 ± 288 N; PLA 58 ± 13 g; RA 6343 ± 1789 rad/s²; neck shear 994 ± 318 N; force rises with weight via effective mass.
- Used for: straight-punch head-acceleration anchor; effective-mass scaling.

**Wan J, Liu Y (2026).** Kinematic and kinetic differences between lead and rear straight punches in elite boxers. *BMC Sports Sci Med Rehabil* 18:292. https://doi.org/10.1186/s13102-026-01738-1
- 17 elite orthodox boxers; Vicon + force plates + force target.
- Lead straight shorter completion time; rear straight greater trunk ROM/rotational velocity, higher peak force, peak velocity, impact velocity (p < .05).
- Used for: lead = speed/low-telegraph, rear = power (jab +10-15% hit chance, 0.5-0.6 × damage).

**Warnick JE, Warnick K (2007).** Specification of variables predictive of victories in the sport of boxing. *Percept Mot Skills* 105(1):153-158. https://doi.org/10.2466/pms.105.1.153-158
- 400 US pro boxing contests in one month (BoxRec); logistic regression.
- Only age, total wins, total losses, and previous-contest result predicted outcome; weight change, country, title status did not.
- Used for: "form" carry-over; record as a latent-skill proxy.

**Wehrlin JP, Hallén J (2006).** [Linear decrease in VO2max and performance with increasing altitude in endurance athletes.] *Eur J Appl Physiol*. PMID 16311764. https://pubmed.ncbi.nlm.nih.gov/16311764/ (from PMID) [S]
- Un-acclimatised endurance athletes.
- VO2max -6.3%/1000 m (4.6-7.5); time to exhaustion -14.5%/1000 m from ~800 m.
- Used for: venue-altitude aerobic penalty.

**Williams AM, Elliott D (1999).** Anxiety, expertise, and visual search strategy in karate. *J Sport Exerc Psychol* 21(4):362-375. https://doi.org/10.1123/jsep.21.4.362
- Expert and novice karateka; taped sequences under low/high anxiety; eye-tracking.
- Experts superior anticipation in both conditions; anxiety raised fixation count/locations more in novices, drifting from head/chest to peripheral limbs.
- Used for: pressure/anxiety penalty on defensive read (-15% novice vs -5% expert).

**Witkowski M, Tomczak E, Bojkowski Ł, Borysiuk Z, Tomczak M (2021).** Do expert fencers engage the same visual perception strategies as beginners? *J Hum Kinet* 78:187-196. https://doi.org/10.2478/hukin-2021-0045
- High-performance foil fencers vs beginners; eye-tracking in duels.
- Beginners distribute attention over all areas; experts attend less to the weapon, more to upper torso and armed hand.
- Used for: feint-bite probability (novice ~0.6, expert ~0.25).

**Wu C-H, et al. (2025).** Mental fatigue impairs temporal perceptual prediction: a study on boxing performance across skill levels. *Sports* 13(5):154. https://doi.org/10.3390/sports13050154
- 20 expert boxers (6.6 ± 2.7 y) vs 20 novices; 45-min Stroop; occlusion -80/-40 ms/onset.
- At -40 ms accuracy 75.3% vs 64.3%; RT 811 vs 915 ms (offensive), 729 vs 932 ms (defensive); fatigue slowed RT without lowering accuracy, more for experts' defensive recognition.
- Used for: fatigue → latency (+10-15%) not accuracy; late-fight compression of expert edge.

**Yan S, Liu L, Ubaldo C (2024).** Artificial intelligence in UFC outcome prediction and fighter strategies optimization. *Proc. 2024 9th Int. Conf. on Intelligent Information Processing (ICIIP)*, 96-100. https://doi.org/10.1145/3696952.3696966
- UFC records; GLM, MLP, decision tree, gradient boosting (paywalled; 66.7% as cited by a replication repository).
- Best accuracy 66.7%.
- Used for: pre-fight predictability ceiling (60-67%).

**Zazryn TR, et al. (2009).** [Injury rates in professional boxing, Victoria 1997-2005.] *Clin J Sport Med*. PMID 19124979. https://pubmed.ncbi.nlm.nih.gov/19124979/ (from PMID) [S]
- Commission records.
- 23.6 injuries/100 fights, mostly head/face lacerations; age and fight count predictive.
- Used for: lacerations as the majority boxing injury (punches cut too).

**Zhang L, Yang KH, King AI (2004).** A proposed injury threshold for mild traumatic brain injury. *J Biomech Eng* 126(2):226-236. https://doi.org/10.1115/1.1691446 (PMID 15179853)
- 24 NFL head-to-head collisions reconstructed with a validated FE head model; brainstem shear predictor.
- 25/50/80% MTBI at ≈ 66/82/106 g and ≈ 4,600/5,900/7,900 rad/s²; HIC ~136/235/333; brainstem shear tolerance 7.8 kPa [S-mem: from paper body, not re-verified].
- Used for: cross-check of KO logistic against the 25-50% rotation band.

**Zhang Z, Piras A, Chen C, Kong B, Wang D (2022).** A comparison of perceptual anticipation in combat sports between experts and non-experts: a systematic review and meta-analysis. *Front Psychol* 13:961960. https://doi.org/10.3389/fpsyg.2022.961960
- 27 studies, 233 datasets (fencing 16, karate 10, TKD 7, boxing 6, sanda 4, judo 3).
- Accuracy SMD 1.24 [0.80-1.68] (83.3% vs 68.5%); RT SMD -1.00 [-1.14 to -0.86]; fixations SMD -2.04; fixation duration 0.64 (n.s.); RT by sport karate -1.23, sanda -1.36, fencing -1.07, TKD -0.89, boxing -0.51 (p = 0.07); in-situ accuracy SMD 7.71; expert-intermediate 1.10, intermediate-novice 1.37.
- Used for: read probability by tier; choice-RT multiplier (expert ≈ 0.8 × novice).

**[Authors not captured] (2025).** Systematic review of MMA injury rates after the Unified Rules. *Orthop J Sports Med*. PMID 40620723. https://pubmed.ncbi.nlm.nih.gov/40620723/ (from PMID) [S]
- Systematic review.
- Injury 23.6-54.5/100 AE; concussion 14.7-16.1/100 AE.
- Used for: concussion-rate range.

**[Unverified] (2025).** [Effective mass by punch type; leg-drive contribution elite vs novice.] *Applied Sciences* (MDPI) 15(7):4008. https://doi.org/10.3390/app15074008 — page could not be fetched; numbers (straights > hooks in effective mass; elite leg-drive ~39% vs novice 16%) come from a search-engine summary. **Unverified; do not cite externally.**
- Used for: nothing yet; flagged in LIT_REVIEW §14.

---

## B. Theses, reports, preprints and position statements

**Association of Ringside Physicians (2024).** [Position statement on the older combat-sports athlete.] *Phys Sportsmed*. PMID 38708547. https://pubmed.ncbi.nlm.nih.gov/38708547/ (from PMID) [S]; consensus-statement index: https://ringsidearp.org/consensus-statements/ [S: index fetched; individual statements not readable]
- Position statement (concussion, weight management, eye conditions, older fighter, high-risk fighter statements listed on the index).
- "Older fighter" threshold > 35 years.
- Used for: age → KO-susceptibility breakpoint; doctor-stoppage practice (ESTIMATE anchors).

**Berthet V (2024).** Improving MMA judging with consensus scoring: a statistical analysis of MMA bouts from 2003 to 2023. arXiv:2401.03280 (preprint). https://arxiv.org/abs/2401.03280
- 4,129 MMA decisions.
- Standard vs consensus scoring agree 97.5%; consensus aligns more with fan opinion (49.0% vs 43.8%); 10-8 rounds drive divergence.
- Used for: three-judge model; scoring-method choice low priority.

**Holmes B (2022).** *Quantitative essays on mixed martial arts.* PhD thesis, University of Liverpool (examined, not journal-reviewed). https://livrepository.liverpool.ac.uk/3166169/ — chapter 4: Reputation bias and home crowd influence in judging; also full tables for Holmes, McHale & Zychaluk 2023.
- 17,105 judge scores, 5,800 rounds, 1,840 UFC fights (Feb 2013-Jun 2022) incl. 51 no-audience events (281 fights); logistic regression (no intercept) on in-round count differences; AMEs from Table 4.2.
- Knockdowns +0.238; submission attempts +0.096; reversals +0.062; TDs landed +0.049; home + crowd +0.036; rank +10 places +0.034; sig head +0.021; sig body +0.015; sig leg +0.013; non-sig missed +0.005; sig body missed +0.004; non-sig landed +0.003; control +0.0009/s; missed TD ≈ -0.02/√unit; home no crowd -0.004; crowd size irrelevant; control valued more with high sub-win probability.
- Used for: round-scoring weight vector and judge-bias terms.

**Holmes B, McHale IG, Zychaluk K (2023).** A Markov chain model for forecasting results of mixed martial arts contests. *International Journal of Forecasting* 39(2):623-640. https://doi.org/10.1016/j.ijforecast.2022.01.007 (peer-reviewed; listed here beside the thesis that holds its full tables)
- 4,678 UFC fights / 1,680 athletes (2001-2018); train to 2017, 327 test fights 2018; per-fighter rates/accuracies by position, TD/sub accuracy, KD/KO probability, control per TD, stand-up probability; 10,000 simulations per fight.
- 61.6% result accuracy (SD 0.53; 59.9-63.0%) vs bookmakers 61.2%; ~41% disagreement; method-of-victory 38.8% vs 32.7%; profitable; stable vs minimum prior fights.
- Used for: architecture validation (position-state Markov sim) and upset-rate calibration (35-40%).

---

## C. Technical and industry sources (animation, game AI, rendering, cinematography, assets/licences)

### C.1 Character animation

**Aristidou A, Lasenby J (2011).** FABRIK: a fast, iterative solver for the inverse kinematics problem. *Graphical Models* 73(5). https://www.sciencedirect.com/science/article/abs/pii/S1524070311000178
- Iterative IK; converges in few iterations, supports constraints and multiple end effectors, no matrices.
- Used for: spine IK on fence leans.

**Balint-H.** mm-online — browser-hosted motion matching. https://github.com/Balint-H/mm-online
- Demonstrates MM running in a browser.
- Used for: feasibility of render-layer MM in TypeScript/WASM.

**Bergamin K, Clavet S, Holden D, Forbes JR (2019).** DReCon: data-driven responsive control of physics-based characters. *ACM TOG* 38(6). https://www.theorangeduck.com/media/uploads/other_stuff/DReCon.pdf
- MM kinematic front-end + PD-tracked ragdoll; low runtime cost, low-frequency sim.
- Used for: reference for a future physics-tracking "hero replay" mode; not authoritative sim.

**Bollo D (2018).** Inertialization: high-performance animation transitions in Gears of War. GDC 2018. https://www.gdcvault.com/play/1025331/Inertialization-High-Performance-Animation-Transitions (PDF: https://media.gdcvault.com/gdc2018/presentations/bollo_david_inertialization_high_performance.pdf; video: https://www.youtube.com/watch?v=BYyv4KTegJI)
- Transition as post-process: offset x0 = old - new and velocity v0 decayed by a quintic over t1 (clamped to -5·x0/v0); only the new pose evaluated; quaternions as axis-angle offsets.
- Used for: pose-buffer inertialization (0.05-0.3 s blend times).

**Cen Z, et al. (2025).** Ready-to-React: online reaction policy for two-character interaction generation. ICLR 2025. https://arxiv.org/abs/2502.20370
- Autoregressive + diffusion head; streaming; evaluated on boxing.
- Used for: research-track only (licence/determinism).

**Clavet S (2016).** Motion Matching and The Road to Next-Gen Animation. GDC 2016. https://gdcvault.com/play/1023280/Motion-Matching-and-The-Road (slides mirror: https://archive.org/details/GDC2016Clavet)
- MM replaces blend trees; "5 or 10 minutes" of captured locomotion; For Honor hybrid (MM locomotion, authored attacks).
- Used for: locomotion architecture.

**"Environment-aware Motion Matching" (2025).** *ACM TOG*. https://dl.acm.org/doi/10.1145/3763334
- Recent MM extension.
- Used for: awareness of MM state of the art; not needed for v1.

**Fussell L, Bergamin K, Holden D (2021).** SuperTrack: motion tracking for physically simulated characters using supervised learning. *ACM TOG* 40(6). https://dl.acm.org/doi/10.1145/3478513.3480527 (Ubisoft summary: https://www.ubisoft.com/en-us/studio/laforge/news/7fMzaMaDgnd0gqPsCaJZYb/supertrack-motion-tracking-for-physically-simulated-characters-using-supervised-learning)
- World model + backprop tracking; faster training, higher quality than RL.
- Used for: offline hero-replay research track.

**GDC (EA).** Physics Driven Ragdolls and Animation at EA: From Sports to Star Wars. https://www.gdcvault.com/play/1025210/Physics-Driven-Ragdolls-and-Animation
- Frostbite driven ragdolls following animation; blend weight controls physicality.
- Used for: cosmetic driven-ragdoll knockdowns.

**GDC (Respawn).** Physical Animation in Star Wars Jedi: Fallen Order. https://gdcvault.com/play/1026848/Physical-Animation-in-Star-Wars
- Shipped active-ragdoll practice.
- Used for: driven-ragdoll parameters.

**Goel P, et al. (2022).** Interaction Mix and Match (cHGAN). SCA 2022. https://arxiv.org/abs/2208.00774
- Close-interaction synthesis incl. fighting.
- Used for: research track only.

**Holden D, Kanoun O, Perepichka M, Popa T (2020).** Learned Motion Matching. *ACM TOG* 39(4). https://dl.acm.org/doi/10.1145/3386569.3392440
- Decompressor/Stepper/Projector networks replace the MM database for scale.
- Used for: justification that plain MM suffices for a minutes-scale DB.

**Holden D.** Code vs Data Driven Displacement (blog) and Motion-Matching reference implementation (C++/raylib, MIT; compiles with emscripten). https://theorangeduck.com/page/code-vs-data-driven-displacement ; https://github.com/orangeduck/Motion-Matching
- Simulation-object vs character split; spring-driven capsule; drift clamp (max_adjustment_ratio = 0.5); 27-D feature vector and weights. Code MIT; bundled LAFAN1 data CC BY-NC-ND (not redistributable).
- Used for: MM feature design and engine/character decoupling; port ideas, not data.

**Jacasch (Medium).** Analysis of active ragdolls in games. https://medium.com/@jacasch/analysis-of-active-ragdolls-in-games-82c95f8ed7a5
- Overview of active-ragdoll practice.
- Used for: background on driven ragdolls.

**"Half Pound Filter for Real-Time Animation Blending" (2026).** arXiv:2602.21702. https://arxiv.org/abs/2602.21702
- 1-Euro-filter variant with data-driven tuning and automatic triggering on motion-derivative discontinuities; evaluated on LAFAN1.
- Used for: alternative blending filter (optional).

**Liang H, et al. (2024).** InterGen: diffusion-based multi-human motion generation under complex interactions (InterHuman dataset). *IJCV*. https://tr3e.github.io/intergen-page/ ; https://github.com/tr3e/InterGen (CC BY-NC-SA 4.0)
- Two-person boxing/fencing/dance dataset (107 M frames) and diffusion model.
- Used for: research track only; never bundle.

**Peng XB, et al. (2021).** AMP: adversarial motion priors for stylized physics-based character control. SIGGRAPH 2021. https://www.researchgate.net/publication/353626682_AMP_adversarial_motion_priors_for_stylized_physics-based_character_control
- RL tracking via discriminator.
- Used for: research track only.

**Peng XB, et al. (2022).** ASE: large-scale reusable adversarial skill embeddings for physically simulated characters. *ACM TOG* 41(4). https://dl.acm.org/doi/10.1145/3528223.3530110
- Reusable skill embeddings.
- Used for: research track only.

**PDP (2024).** Physics-based character animation via diffusion policy. https://arxiv.org/pdf/2406.00960
- Diffusion-policy control.
- Used for: research track only.

**"Simulation and Retargeting of Complex Multi-Character Interactions" (2023).** SIGGRAPH 2023. https://dl.acm.org/doi/10.1145/3588432.3591491
- Physics-based multi-character retargeting.
- Used for: awareness; far from production for grappling.

**Siyao L, et al. (2024).** Duolando: follower GPT with off-policy RL for dance accompaniment. ICLR 2024. https://arxiv.org/pdf/2403.18811 ; **DuetGen** SIGGRAPH 2025 https://dl.acm.org/doi/10.1145/3721238.3730741
- Two-person reactive motion generation.
- Used for: research track only.

**Shum H, Komura T, et al.** Generating realistic fighting scenes by game tree. https://arxiv.org/pdf/2006.11620
- Game-tree search for two-character fight scenes.
- Used for: background for grappling/exchange choreography.

**Starke S, et al. (2021).** Neural Animation Layering for Synthesizing Martial Arts Movements. SIGGRAPH 2021 (AI4Animation). https://github.com/sebastianstarke/AI4Animation (code research-only; data CC BY-NC 4.0)
- Layered neural martial-arts synthesis.
- Used for: research track; never bundle.

**"3D Human Interaction Generation: A Survey" (2025).** https://arxiv.org/pdf/2503.13120
- Survey of two-person motion generation.
- Used for: research-track orientation.

**Won J, Gopinath D, Hodgins J (2021).** Control strategies for physically simulated characters performing two-player competitive sports (boxing, fencing). SIGGRAPH 2021. https://dl.acm.org/doi/10.1145/3450626.3459761
- Emergent boxing tactics from learned controllers; GPU-days of training.
- Used for: research track only.

**Xu L, et al. (2024).** Inter-X: towards versatile human-human interaction analysis. CVPR 2024. https://github.com/liangxuy/Inter-X (research licence; SMPL-X dependency)
- 40 two-person action categories at 120 fps.
- Used for: never bundle.

**Younes A, et al. (2023).** MAAIP: multi-agent adversarial interaction priors for imitation from fighting demonstrations. https://arxiv.org/abs/2311.02502
- Boxing + full-body martial-art imitation.
- Used for: research track only.

**Zhang [first author], Chang, Men, Shum (2026).** Physics-based motion tracking of contact-rich interacting characters. https://arxiv.org/abs/2604.07984
- Progressive experts for dense two-character contact.
- Used for: awareness of grappling-contact research.

**Zhu [first author], et al. (2023).** Neural Categorical Priors for physics-based character control. SIGGRAPH Asia 2023. https://arxiv.org/abs/2308.07200
- VQ-VAE priors; two-player boxing with emergent defence/dodging.
- Used for: research track only.

**Game Developer — two-joint IK for foot placement.** https://www.gamedeveloper.com/programming/inverse-kinematics-two-joints-for-foot-placement
- Analytic law-of-cosines two-bone IK.
- Used for: ~60-line two-bone solver.

**ozz-animation — foot IK sample.** https://guillaumeblanc.github.io/ozz-animation/samples/foot_ik/
- Two-bone + aim IK, pelvis offset, raycast ground.
- Used for: foot planting and pelvis drop.

**Unreal Engine docs — IK setups (4.27).** https://dev.epicgames.com/documentation/en-us/unreal-engine/ik-setups?application_version=4.27
- Two-bone for limbs; aim IK for ankle.
- Used for: IK conventions.

**Three.js examples — skinning blending, additive blending, CCDIKSolver.** https://threejs.org/examples/webgl_animation_skinning_blending.html ; https://threejs.org/examples/webgl_animation_skinning_ik.html
- AnimationMixer crossfade (dual evaluation), makeClipAdditive, CCD IK addon.
- Used for: clip sampling only; CCD for prototyping.

**EA Sports UFC 5 — Presentation Deep Dive; Gameplay Deep Dive.** https://www.ea.com/games/ufc/ufc-5/news/ufc-5-presentation ; https://www.ea.com/games/ufc/ufc-5/news/ufc-5-gameplay
- "Real Impact": 8 body regions × 5 damage levels; ragdoll and cloth in replays; cinematic KO replay places cameras by limb/strike; doctor-stoppage close-ups on six injury zones; dual-lobe skin shader; GPU emitter-graph sweat/blood; strand hair.
- Used for: hit-reaction matrix, damage HUD, replay director, sweat/blood look.

### C.2 Game AI

**Neal J, Hayles P (2016).** Designing AI for Competitive Games (Killer Instinct Shadow AI). GDC 2016. https://www.gdcvault.com/play/1022992/Designing-AI-for-Competitive ; write-up: https://www.gamedeveloper.com/programming/the-killer-groove-the-shadow-ai-of-killer-instinct
- Case-based reasoning: 400-700 patterns per match with world-state context; 40+ similarity metrics; value ranking with occasional lower-ranked picks; reaction time inherited from recorded human timing; strategy shifts when punished.
- Used for: online opponent model with forgetting; unpredictability.

**Tekken 8 "Ghost" AI.** https://gamermatters.com/killer-instinct-2013-coolest-feature-lives-on-in-tekken-8/
- Real-time learned player replicas.
- Used for: precedent for online opponent modelling.

**Mark D, Lewis K.** Infinite Axis Utility System. GDC AI Summit 2013/2015. https://www.gdcvault.com/play/1018040/Architecture-Tricks-Managing-Behaviors-in ; https://www.gameai.com/iaus.php
- Score actions as products of response-curve considerations; pick max or weighted top-k.
- Used for: per-tick reactive utility layer and per-fighter style weights.

**Orkin J (2006).** Three States and a Plan: the AI of F.E.A.R. GDC 2006. https://www.gamedevs.org/uploads/three-states-plan-ai-of-fear.pdf
- GOAP.
- Used for: rejected for fighting (replanning every frame); informs tiny HTN macro.

**Straatman R, et al. (Guerrilla).** Killzone 2/3 multiplayer bots (HTN, ≈ 500 plans/s); Game AI Pro ch. 29; HTN planning in Decima. https://www.guerrilla-games.com/read/killzone-2-multiplayer-bots ; http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter29_Hierarchical_AI_for_Multiplayer_Bots_in_Killzone_3.pdf ; https://www.guerrilla-games.com/read/htn-planning-in-decima
- HTN for squad plans.
- Used for: HTN-style macro replanned each tick.

**Neufeld X, Mostaghim S, Perez-Liebana D (2017).** HTN Fighter: planning in a highly-dynamic game. IEEE CIG 2017. http://diego-perez.net/papers/HTNFighter.pdf (404 at review time)
- HTN in FightingICE; must replan continuously.
- Used for: justification for utility-first design.

**Yoshida S, et al. (2016).** Application of Monte-Carlo tree search in a fighting game AI. IEEE GCCE 2016. https://ieeexplore.ieee.org/document/7800536/ ; Applying and improving MCTS in a fighting game AI, ACE 2016. https://dl.acm.org/doi/10.1145/3001773.3001797 ; MCTS with personas: https://www.semanticscholar.org/paper/ed182da2e64f0a2be27fb38997bae1dba071a53d
- MCTS beats rule-based AI within a 16.67 ms budget with a cheap forward model; personas via rollout rewards.
- Used for: optional MCTS lookahead (N ≈ 64, 3-5 ticks, ≤ 2 ms).

**"Opponent modeling based on action table for MCTS-based fighting game AI" (2017).** https://researchgate.net/publication/320742121_Opponent_modeling_based_on_action_table_for_MCTS-based_fighting_game_AI
- Action-table opponent model improves MCTS.
- Used for: P(opp_action | range, stamina) table.

**MCTS for dynamic difficulty adjustment (CIG 2017).** https://exertiongameslab.org/wp-content/uploads/2018/02/monte_carlo_cig2017.pdf ; **DDA with player-state models in MCTS (ESWA 2022).** https://www.sciencedirect.com/science/article/abs/pii/S0957417422009757
- DDA by biasing rollout rewards.
- Used for: difficulty via reward shaping, not cheating inputs.

**"Adaptive AI for Fighting Games" (dynamic scripting).** https://www.researchgate.net/publication/228760068_Adaptive_AI_for_Fighting_Games
- Rule-weight adaptation.
- Used for: background.

**EA Sports UFC (2015).** The Fight for Believable Characters in Games. GDC 2015. https://www.gdcvault.com/play/1021652/EA-Sports-UFC-The-Fight
- Tendency-driven CPU behaviour with stochastic outcome resolution.
- Used for: confirmation that tendency ratings + dice-roll resolution fit the engine.

**Operation Sports — sports-game CPU AI practice.** https://www.operationsports.com/arc-raiders-ai-controversy-sports-games/
- Tendency ratings in Madden/2K.
- Used for: background.

### C.3 Rendering and hardware

**Penner E, Borshukov G (2011).** Pre-Integrated Skin Shading. *GPU Pro 2* / SIGGRAPH 2011 course. https://www.taylorfrancis.com/chapters/edit/10.1201/b11325-9/pre-integrated-skin-shading-eric-penner-george-borshukov ; notes: https://simonstechblog.blogspot.com/2015/02/pre-integrated-skin-shading.html
- 2-D LUT over N·L × curvature plus normal blur; no extra passes.
- Used for: skin shader on an iGPU/forward renderer.

**Jimenez J, et al. (2015).** Separable Subsurface Scattering. *CGF* 34 (EGSR 2015). https://onlinelibrary.wiley.com/doi/10.1111/cgf.12529 ; code: https://github.com/iryoku/separable-sss ; screen-space SSS (2009): https://www.iryoku.com/screen-space-subsurface-scattering/
- Two 1-D passes, 7 samples/px, < 0.5 ms.
- Used for: quality step-up SSS pass (custom in Three.js).

**Jimenez J (2013).** Next Generation Character Rendering. GDC 2013. https://gdcvault.com/play/1018270/Next-Generation-Character ; https://www.iryoku.com/next-generation-life/
- SSS, eyes (sclera/cornea, refraction, caustic, meniscus), DoF, grain, bloom, tone mapping; 180 fps on GTX 680.
- Used for: eye shader (close-ups), post look.

**Jimenez J, Wu X-C, Pesce A, Jarabo A (2016).** Practical Real-Time Strategies for Accurate Indirect Occlusion (GTAO). HPG 2016. https://www.iryoku.com/downloads/Practical-Realtime-Strategies-for-Accurate-Indirect-Occlusion.pdf ; Intel XeGTAO (MIT): https://github.com/GameTechDev/XeGTAO
- GTAO 0.5 ms on console; XeGTAO 2.39 ms at 1080p high on Iris Xe (i7-1195G7), ~0.56 ms on RTX 2060.
- Used for: AO budget (≈ 1.5-2.5 ms at 1440p on Arc 140V).

**Unreal Engine — Subsurface Profile / Burley SSS.** https://dev.epicgames.com/documentation/en-us/unreal-engine/subsurface-profile-shading-model-in-unreal-engine
- Reference for what is *not* affordable on the target.
- Used for: engine decision.

**Unity HDRP — subsurface scattering.** https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.2/manual/skin-and-diffusive-surfaces-subsurface-scattering.html
- Screen-space blur with diffusion profiles.
- Used for: engine decision.

**Three.js examples, TSL docs, migration guide.** https://threejs.org/examples/webgl_materials_subsurface_scattering.html ; https://threejs.org/examples/webgl_postprocessing_gtao.html ; https://threejs.org/examples/webgpu_postprocessing_ao.html ; https://threejs.org/examples/ (list: https://threejs.org/examples/files.json) ; https://threejs.org/docs/pages/TSL.html ; https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- r169 WebGL2 (GTAO/SMAA/bloom/thickness SSS); r17x WebGPU node post stack (TRAA, SSGI, SSR, DoF, motion blur, AO, bloom, SMAA, 3D LUT; `MeshSSSNodeMaterial`); `webgpu_postprocessing_sss` is screen-space shadows.
- Used for: r169 → r17x migration plan; TSL skin material.

**Babylon.js — SubSurfaceScatteringPostProcess.** https://doc.babylonjs.com/typedoc/classes/BABYLON.SubSurfaceScatteringPostProcess
- Built-in screen-space SSS since 4.2.
- Used for: comparison; Three.js needs a custom pass.

**"Real-Time Hair Rendering with Hair Meshes" (SIGGRAPH 2024).** https://doi.org/10.1145/3641519.3657521 ; **Strands2Cards (SIGGRAPH Asia 2025).** https://dl.acm.org/doi/10.1145/3757377.3763864 ; **Three-Hair demo.** https://github.com/AEspinosaDev/Three-Hair
- Hair meshes/cards as the affordable alternative to strands.
- Used for: short-hair cards/textures only.

**EA Sports UFC 6 reveal.** https://www.ufc.com/news/ea-sports-ufc-6-reveals-major-changes-fighter-likeness-gameplay-physics-and-presentation
- Layer-based moisture/damage reflecting overhead lighting.
- Used for: sweat/damage layering reference.

**web.dev — WebGPU supported in major browsers.** https://web.dev/blog/webgpu-supported-major-browsers ; **gpuweb implementation status.** https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- Chrome/Edge 113+, Firefox 141+ (Windows), Safari 26.
- Used for: WebGPU migration timing.

**PCWorld — Lunar Lake gaming test.** https://www.pcworld.com/article/2491309/tested-intel-lunar-lake-brings-real-gaming-to-thin-light-laptops.html ; **Tom's Hardware — Arc 140V benchmarks.** https://www.tomshardware.com/pc-components/gpus/we-benchmarked-intels-lunar-lake-gpu-with-core-ultra-9-drivers-still-holding-back-arc-graphics-140v-performance ; **Intel driver update notes.** https://game.intel.com/stories/performance-update-for-intel-arc-140v-and-130v-built-in-gpus/
- Arc 140V: 8 Xe2 cores @ 2.05 GHz; Time Spy ≈ 3.6-4.2k; 1080p Cyberpunk medium ≈ 40-48 fps, FFXIV high ≈ 45-52, Civ VI high ≈ 72.
- Used for: 1440p-internal performance contract.

### C.4 Broadcast cinematography

**Sports Video Group (2020).** UFC creates live-production ecosystem from scratch on "Fight Island". https://www.sportsvideo.org/2020/07/17/ufc-creates-live-production-ecosystem-from-scratch-on-fight-island-in-abu-dhabi/
- 6 Octagon cameras (4 handheld HDC-4300 + 2 Talon robotic heads: overhead truss and outside truss), RF Steadicam, 24-ft jib at 6 o'clock, 2 × 6× super-slow-mo, 2 apron robotic corner POVs.
- Used for: `BroadcastDirector` shot set.

**Fstoppers.** How the UFC films its pay-per-view events and promos. https://fstoppers.com/originals/how-ufc-films-its-pay-view-events-and-promos-238825
- Cage-side Alexa Mini handheld 19-90 mm ~f/4; promo MoVI 35 mm f/2.8-4; operators on raised platforms.
- Used for: handheld shot parameters and replay DoF look.

**Ferro Productions.** Shooting camera for HBO boxing. https://www.ferroproductions.com/shooting-camera-for-hbo-boxing/ ; **SVG (2017).** HBO dual aerial cameras for Álvarez-Golovkin. https://www.sportsvideo.org/2017/09/13/hbo-boxing-to-unleash-first-ever-dual-aerial-camera-attack-for-massive-alvarez-golovkin-bout/
- Two hard cameras (head-to-toe, head-to-waist), 90° camera, two apron handhelds, robotic, super-slow-mo, JitaCam/SkyCam.
- Used for: HARD_WIDE / HARD_TIGHT idioms.

**He L, Cohen MF, Salesin DH (1996).** The Virtual Cinematographer (film idioms as state machines). SIGGRAPH 1996 — cited via Christie et al. 2008. **Christie M, Olivier P, Normand J-M (2008).** Camera Control in Computer Graphics (survey). *CGF*. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-8659.2008.01181.x
- Shot idioms with entry/exit conditions.
- Used for: shot-idiom state machine design.

**Jiang H, et al. (2020).** Example-driven virtual cinematography by learning camera behaviors. *ACM TOG*. https://history.siggraph.org/learning/example-driven-virtual-cinematography-by-learning-camerabehaviors-by-jiang-wang-wang-christie-and-chen/ ; **Camera Keyframing with Style and Control (2021).** https://dl.acm.org/doi/10.1145/3478513.3480533 ; **DanceCamera3D (2024).** https://arxiv.org/html/2403.13667v1
- Learning camera style from footage.
- Used for: later tuning of cut cadence from real UFC clips.

### C.5 Assets and licences

**CMU Graphics Lab Motion Capture Database.** http://mocap.cs.cmu.edu (boxing: http://mocap.cs.cmu.edu/search.php?maincat=4&subcat=8); re3data record: https://www.re3data.org/repository/r3d100012183 ; community FBX conversion: https://huggingface.co/datasets/gbionics/cmu-fbx
- ~2,600 trials, 140+ subjects; boxing, walking, stumbling, falling; ASF/AMC, C3D; "may be copied, modified, or redistributed without permission", NSF EIA-0196217 acknowledgement requested (snippet only — re-verify).
- Used for: bundle (with acknowledgement) after retargeting.

**ACCAD Open Motion Project (Ohio State).** https://accad.osu.edu/research/motion-lab/mocap-system-and-data
- Male 2: martial-arts stances (15), kicks (21), punches (15), walks/turns (22), falls; C3D/BVH/FBX/TXT; CC BY 3.0.
- Used for: primary fighting-specific animation source (bundle with attribution).

**100STYLE (Mason, Starke, Komura).** https://zenodo.org/records/8127870
- 100 locomotion styles incl. aggressive/tired/stealth; BVH; CC BY 4.0.
- Used for: fatigue/style footwork variation (bundle with attribution).

**Rokoko free packs.** https://www.rokoko.com/resources/rokoko-mocap-13-free-fight-animations ; https://www.rokoko.com/resources/rokoko-mocap-6-free-martial-arts-animations ; https://www.rokoko.com/free-resources
- Punches, kicks, blocks, fight idles; FBX (Mixamo skeleton, 30 fps); "commercial use" stated, no formal licence text, sign-up required.
- Used for: ship inside builds; written OK before committing raw FBX.

**Mixamo (Adobe).** https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html (403 at review; terms via https://www.licenseorg.com/guide/3d-assets/mixamo)
- Royalty-free commercial use, no credit; no redistribution of standalone assets.
- Used for: no raw files in repo; baked-in only.

**Ubisoft LAFAN1.** https://github.com/ubisoft/ubisoft-laforge-animation-dataset
- Fight (3), fall/get-up (6), push-stumble (5), sprint; 4.6 h, 30 fps; CC BY-NC-ND 4.0.
- Used for: never bundle.

**Bandai Namco Research Motion Dataset.** https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset
- Fighting styles + locomotion; CC BY-NC-ND 4.0.
- Used for: never bundle.

**AMASS.** https://amass.is.tue.mpg.de/license.html ; **SMPL-X.** https://smpl-x.is.tue.mpg.de (licence page 404) ; **HumanML3D.** https://github.com/EricGuo5513/HumanML3D ; **Motion-X.** https://motion-x-dataset.github.io/ ; **KIT Whole-Body Motion DB.** https://download.is.tue.mpg.de/amass/licences/kit.html ; **SFU MoCap.** https://mocap.cs.sfu.ca/ ; **Motorica Dance Dataset.** https://github.com/simonalexanderson/MotoricaDanceDataset
- All non-commercial / research-only / no-redistribution.
- Used for: never bundle; use CMU/ACCAD originals instead.

**Quaternius Universal Base Characters.** https://quaternius.com/packs/universalbasecharacters.html
- 6 rigged humanoids (~13k tris), 20 hairstyles; glTF/FBX/OBJ/Blend; CC0.
- Used for: stand-in bodies.

**MakeHuman / MPFB2.** https://github.com/makehumancommunity/mpfb2 ; licence: https://static.makehumancommunity.org/about/license.html
- Parametric realistic humans with body-shape sliders; software GPLv3/AGPL; generated characters and bundled assets CC0.
- Used for: primary route to weight-class-accurate fighter bodies.

**Kenney.** https://kenney.nl
- CC0 stylised characters/props/UI.
- Used for: UI/icons only.

**Sketchfab CC0 rigs.** https://sketchfab.com/3d-models/cc0-free-rigged-character-bf75eb2ffcb9444a90b62c3aeee04be2 ; https://sketchfab.com/3d-models/boxer-3d-human-riged-model-51edfec934004084b0ec3ec13e0b87bc
- Per-model licences; filter CC0/CC-BY.
- Used for: case-by-case.

**Ready Player Me — terms of use.** https://docs.readyplayer.me/ready-player-me/support/terms-of-use
- Website avatars CC BY-NC-SA 4.0; commercial via SDK; no redistribution.
- Used for: never bundle.
