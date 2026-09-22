# Literature Review B: Anthropometrics, Win Predictors, Expertise, and Tactical Analysis

Phase 1 literature review (part B) for the combat-sports bout simulator. Scope: peer-reviewed research on (1) anthropometrics/age/weight-cutting and outcomes, (2) statistical win predictors and forecasting, (3) skill acquisition and expert-novice differences, (4) tactical profiles of winners vs losers. Every paper below was located and its key numbers verified (from full text, abstract, or repository copy) during this review. Where only an abstract was accessible, this is stated in the quality note. Numbers in the "Sim implication" lines are proposals for DESIGN.md, not settled parameters.

Compiled 2026-09-22.

---

## 1. Summary of themes and conclusions

### What the evidence agrees on

1. **Height and reach barely move win probability in MMA once fighters are weight-matched.** Four separate Kirk datasets (278, 461, 474 and 2,229 bouts/competitors) find no reliable stature or armspan effect on who wins, with only isolated division-level anomalies (heavyweight armspan +2.2 cm for winners; welterweight taller fighters slightly favoured in one sample). A 264-bout UFC KO/TKO study shows reach/height changes *which* punch ends the fight (straights more likely for longer fighters), not *whether* the fight is won. The one striking-only sport dataset (heavyweight boxing, no weight cap) finds height and age effects that are "much stronger" than weight. Conclusion: reach/height should modulate *technique selection and effective striking distance*, not be a direct win-probability multiplier.

2. **Age is the most consistent anthropometric predictor, but the effect is small.** UFC winners are ~0.8 years younger than losers (29.8 vs 30.7 y; rank-biserial r = 0.18) across 2,229 bouts, in 4 of 5 years and 4 of 13 divisions. Older fighters are more likely to lose by strikes; decision winners are older than finish winners. Age also predicts professional boxing outcomes (logistic regression on 400 bouts) and heavyweight boxing outcomes. There is no peer-reviewed age *curve* with a defined peak; the "peak at ~27-32" figure comes from non-peer-reviewed analyses and should be treated as a design assumption.

3. **Weight regain after weigh-in is associated with winning in large regional/commission datasets, but not in small UFC/Bellator samples.** Faro et al. (1,474 fights): OR = 1.046 per 1% body-mass regain (about +4.6% odds per 1%). Baribeau et al. (2,100 athletes): +7% odds per 1% in MMA, +13% per 1% in boxing. Kirk et al. (124 UFC fighters) and Peacock et al. (20 Bellator fighters): no effect. Brechney et al.: losers *cut* more (10.6% vs 8.6%, d = 0.48), OR = 0.89 per extra 1% cut. Working synthesis: weight *cut magnitude* hurts (dehydration/fatigue), weight *regain* helps modestly (size advantage) but effect sizes are small and inconsistent at the elite level.

4. **Winning in MMA is best predicted by landed volume and accuracy, especially ground strikes and takedown accuracy, not by attempt volume.** James et al. (234 UFC bouts): decision tree with 76% cross-validated accuracy; >0.85 significant ground strikes landed/min gives 91.5% win rate; >4 significant ground strikes landed per bout gives 80.4%; takedown accuracy 50.9% (winners) vs 29.0% (losers), d = 0.62. Kirk (461 bouts): significant strikes landed distinguishes winners with d = 0.64-0.86 in every division. Ma et al. (8,461 bouts): winners' takedown success 50% vs 20%, control time per takedown 100 s vs 79 s.

5. **Judges weight knockdowns far above everything else.** Holmes' round-level logistic model of 5,800 UFC rounds: average marginal effect on P(win round) of a knockdown difference = +0.238; submission attempt = +0.096; reversal = +0.062; takedown landed = +0.049; significant head strike landed = +0.021; body strike = +0.015; leg strike = +0.013; control time = +0.0009 per second (~+5.4% per minute). Collier et al. and Gift (2018) independently find knockdowns and visible damage have the largest marginal effects, and that judges are biased toward betting favourites, higher-ranked fighters, the previous-round winner, and the home fighter.

6. **Pre-fight prediction is hard-capped around 60-67% accuracy.** A calibrated Markov-chain fight simulator (Holmes, McHale & Zychaluk 2023) hits 61.6% on 327 held-out UFC fights, statistically equal to bookmakers (61.2%). Peer-reviewed ML studies report 62-67%. Betting markets are largely efficient with no favourite-longshot bias (Miller & Nichols 2026), but odds-makers under-price youth and travel/home effects. Implication: a well-built sim should produce upset rates of roughly 35-40% even when one fighter is "better on paper".

7. **Home advantage exists and is mediated by subjective judging.** Balmer et al. (boxing): for equally matched boxers, P(home win) = 0.57 for KO, 0.66 for TKO, 0.74 for points decisions. Holmes (UFC): home fighter with a live crowd gains +3.6% round-win probability; no crowd, no effect. Ranking 10 places higher: +3.4% round-win probability from reputation bias alone.

8. **Southpaws are over-represented (17-19% vs ~11-13% population) but the win advantage is small or nil.** Richardson & Gilman (13,800 fighters): a random left-hander beats a random right-hander's record 52.4% (male boxing), 54.5% (female boxing), 53.5% (MMA) of the time. Baker & Schorer (1,468 MMA fighters): 64.0% vs 62.6% win rate, n.s. Pollet et al. (UFC): no advantage when facing right-handers. Sim: stance-mismatch bonus should be small (~+1-3% to win probability) and should decay with the opponent's exposure to southpaws.

9. **Experts anticipate, novices react.** Meta-analysis of 27 combat-sport studies: expert vs non-expert response accuracy SMD = 1.24 (83.3% vs 68.5% correct), reaction time SMD = -1.00, fixations SMD = -2.04 (experts fixate fewer locations, upper torso/head instead of hands/weapon). The advantage is in *choice* reaction to sport-specific cues, not in simple reaction time (Mori et al.). Beginners' automatic responses are defensive; experts' are counter-offensive (Ottoboni et al.). Under anxiety, novices' gaze scatters to peripheral body locations (Williams & Elliott).

10. **Technique quality scales with training level: elite rear-hand punch force is 2x novice** (4,800 N vs 2,381 N; lead hand 2,847 N vs 1,604 N; Smith et al.). Elite boxers produce more force at higher velocity than juniors with more efficient kinetic chain (less shoulder-dominant) contributions (Dinu & Louis).

11. **Winners in boxing/kickboxing/Muay Thai are more accurate, not busier.** Elite amateur boxing (Dunn et al.): winners 33% punches landed vs losers 23%, air-punches 17% vs 27%, total punches equal (76.8 vs 79.3); accuracy alone classifies 76.9% of winners; accuracy + movement style 84.6%. Novice boxing (Davis 2013): winners land 18 more punches, throw more lead-hand punches and combinations. World Championship boxing (Davis 2018): winners throw more straights in round 1 and land more in round 3. Kickboxing (Ouergui): winners use more hooks, combinations, foot defence and clinch. Amateur boxing generally (Thomson & Lamb): jab success 28%, power punches 33-40%, foot defence 70% successful.

### Conflicts and weak spots

- Weight-regain effects: positive in commission datasets, null in UFC/Bellator samples (see section 6 for detail).
- Reach: consistent null in MMA win/loss; positive in heavyweight boxing; popular "reach advantage wins 52%" figures are non-peer-reviewed.
- Southpaw: over-representation robust, advantage inconsistent (small positive in large records-based samples, null in matched-fight samples).
- Age curve shape: no peer-reviewed peak-age model; only direction (younger wins slightly).
- Beginner behaviours (flinching, eye closure, turning away, squaring up): no combat-sport-specific peer-reviewed quantification found; supported only indirectly by startle/anxiety literature and expert-novice gaze studies.
- Pressure vs counter: no MMA/boxing study directly compares pressure-fighter vs counter-fighter win rates; only indirect evidence (counter-attacks more effective for KOs in one hybrid-rules dataset; block-and-counter combinations 2.8 vs 0.1 per bout for novice boxing winners).

---

## 2. Theme 1: Anthropometrics, age, weight and outcomes

### 2.1 Kirk, C. (2016). The influence of age and anthropometric variables on winning and losing in professional mixed martial arts. *Facta Universitatis, Series: Physical Education and Sport*, 14(2), 227-236. https://casopisi.junis.ni.ac.rs/index.php/FUPhysEdSport/article/view/2070 (open copy: https://shura.shu.ac.uk/27850/)

- Sample: 278 professional MMA bouts (UFC), Bayes-factor analyses of age, stature, wingspan and stature:wingspan ratio for winners vs losers, overall and by division.
- Findings: anthropometric differences "for the most part have no effect on who wins the bout". Older participants were significantly more likely to lose, and to lose via strikes. Decision winners were significantly older than KO/submission winners. At welterweight, taller fighters more likely to win (anecdotal BF only); greater wingspan more likely to lose by submission. Taller losers more likely to lose via strikes.
- Quality: moderate sample, single-year, Bayesian; abstract-level numbers only for age (no means available here).
- **Sim implication:** No direct height/reach win-probability term. Add an age-dependent durability/chin term so older fighters are more likely to be finished by strikes, and an age-dependent "experience/pacing" term that shifts older fighters' outcomes toward decisions.

### 2.2 Kirk, C. (2016). Does stature or wingspan length have a positive effect on competitor rankings or attainment of world title bouts in international and elite mixed martial arts? *Sport Science Review*, 25(5-6), 334-349. https://doi.org/10.1515/ssr-2016-0018 (open copy: https://shura.shu.ac.uk/27848/)

- Sample: N = 474 elite/international MMA competitors on televised bouts across one year; ranking groups per division; title-fighters vs non-title-fighters.
- Findings: shorter competitors ranked higher at flyweight; shorter competitors more likely to fight for/win a title at featherweight and flyweight; weak-to-moderate negative correlations between stature and rank at lightweight and light heavyweight; mean stature:wingspan = 1 : 1.024. "Anthropometrical measurements cannot be used to predict success in elite and international MMA." Author attributes this to the large share of time in clinch/grappling.
- Quality: cross-sectional, ranking-based, one year; lower-tier journal.
- **Sim implication:** Do not give height/reach a rating bonus in fighter generation or matchmaking. Mean ape index for generated fighters: reach/height ≈ 1.024 (SD ≈ 0.028 from Kirk 2023).

### 2.3 Kirk, C. (2018). Does anthropometry influence technical factors in competitive mixed martial arts? *Human Movement*, 19(2), 46-59. https://doi.org/10.5114/hm.2018.74059 (open copy: https://shura.shu.ac.uk/27931/)

- Sample: 461 elite professional MMA bouts; Bayes-factor t-tests on technique counts for winners vs losers per division, plus Bayesian correlations between anthropometric differences and technique differences.
- Findings (winners vs losers, means): heavyweight significant strikes landed 66.5 vs 36.5 (BF10 = 399, d = 0.84); significant ground strikes landed 10.3 vs 2.3 (d = 0.75). Welterweight significant ground strikes landed 7.5 vs 1.3 (BF10 = 3.5e6, d = 0.69); significant strikes landed 59 vs 24.8 (d = 0.64); successful takedowns 1.8 vs 0.1 (d = 0.55). Lightweight significant strikes landed 42.4 vs 29.6 (d = 0.86); knockdowns 0.5 vs 0.1 (d = 0.49). Anthropometry: at heavyweight, wingspan difference correlated with significant-strikes-landed difference (Kendall tau = 0.469, BF10 = 170; regression ≈ +1.6 landed significant strikes per cm of stature advantage); at lightweight, predicted knockdown difference = 0.355 + 0.028 x wingspan difference (cm). Elsewhere anthropometry had negligible effect; "grappling and strikes to the head have been found to be the determining factors for success".
- Quality: good sample, robust Bayesian; tables partly reconstructed from repository PDF.
- **Sim implication:** Reach advantage should act on *striking output at range* (landed significant strikes) rather than on win probability directly, scaled up in heavier divisions: roughly +1.5% landed distance strikes per cm of reach advantage at heavyweight, ~0 at lighter divisions. Knockdown rate at lightweight: +0.028 knockdowns per bout per cm of reach advantage (small; cap at +/-10 cm).

### 2.4 Kirk, C. (2023). A 5-year analysis of age, stature and armspan in mixed martial arts. *Research Quarterly for Exercise and Sport*. https://doi.org/10.1080/02701367.2023.2252473 (open copy: https://shura.shu.ac.uk/32072/)

- Sample: 2,229 professional UFC bouts, 2017-2021 (1,858 male, 371 female); Bayesian Mann-Whitney / Wilcoxon on absolute and relative age, stature, armspan and armspan:stature (A:S).
- Findings: winners younger (29.8 +/- 4.0 vs 30.7 +/- 4.2 y; BF10 = 29,993; rank-biserial r = 0.18); relative age difference -0.82 +/- 5.3 y (BF10 = 239,368, r = 0.18). Supported in 4/5 years and in middleweight, welterweight, lightweight, featherweight, bantamweight (r = 0.17-0.29); null at light heavyweight and women's divisions. Stature difference winners-losers: 0.5 +/- 8.9 cm, null supported (BF01 = 7). Armspan difference: +0.6 cm overall (BF10 = 6, r = 0.08, trivial); heavyweight only real signal (+2.2 +/- 9.8 cm, BF10 = 10, r = 0.28; winners 198.4 vs losers 196.1 cm). A:S: greater ratio a *disadvantage* in women's strawweight only (winners 1.003 vs losers 1.010). No variable affected method of victory (BF01 = 29-122). Population: stature 177.5 +/- 9.5 cm, armspan 182.2 +/- 11.5 cm, A:S 1.026 +/- 0.028 (men+women pooled).
- Quality: largest and best-designed anthropometric study; Bayesian with robustness checks.
- **Sim implication:** Age effect on baseline win probability: about -1.5 to -2 percentage points per year of age difference (r = 0.18 with SD 5.3 y implies ~0.82 y mean gap; a logistic coefficient of ~0.06/yr reproduces this). Height difference: no effect. Reach difference: +0 except heavyweight (+~0.5% win prob per cm, capped). Fighter generation: A:S ~ N(1.026, 0.028).

### 2.5 Barley, O.R., Vial, S., Scanlan, M., Tapsell, L.C., Wilson, C., Giustiniano, J., Plush, M.G., & Doherty, C.S. (2025). Influence of height and reach on fight-ending punches in the Ultimate Fighting Championship mixed martial arts promotion. *International Journal of Sports Science & Coaching*, 20(5), 2137-2148. https://doi.org/10.1177/17479541251338509

- Sample: 264 UFC contests ending in KO/TKO by hook, straight, uppercut or overhand; multinomial logistic regression on reach, height and combined differences.
- Findings: fight-ending punch frequencies: hooks 51%, straights 35%, uppercuts and overhands the remainder. Straight more likely than overhand in all models (OR 1.06-1.10 per cm). At 0 and +20 cm reach difference, straights and uppercuts vs uppercut/overhand differ by 27-47 percentage points; at +40 cm height difference, straights 76% more likely than uppercuts/overhands. The study does *not* show reach changes the chance of winning.
- Quality: moderate sample; only KO/TKO bouts; punch types coded from video.
- **Sim implication:** Finishing-punch type distribution at zero reach difference: hook 0.51, straight 0.35, uppercut/overhand 0.14 combined. Shift +1 percentage point from hook/overhand/uppercut to straight per cm of reach advantage (cap +/- 20 cm); the longer fighter's KO tool is the straight, the shorter fighter's is the hook/overhand.

### 2.6 Fiala, V., Zywiczynski, P., Turecek, P., & Wacewicz, S. (2025). Somatometric profiles of successful male professional heavyweight boxers. *International Journal of Sports Science & Coaching*. https://doi.org/10.1177/17479541241311094

- Sample: BoxRec bout outcomes for all active male professional heavyweight boxers; Bayesian logistic regressions.
- Findings: population-level optimum body mass ≈ 110 kg (marginal benefit of extra weight falls to zero there). Effects of age and height on P(win) "much stronger than the effect of weight"; taller boxers with longer reach likelier to win. Heavyweights who had also fought at lower classes were 19.9% [5.6-31.1%] less likely to win at heavyweight.
- Quality: large observational dataset; effect sizes for height/age not extractable from the abstract.
- **Sim implication:** In uncapped (heavyweight) *striking-only* rulesets, apply a modest positive height/reach win modifier (suggest +0.3-0.5% win prob per cm, capped at +/- 15 cm) and a body-mass benefit that plateaus around 110 kg. Do not apply this in MMA divisions except heavyweight, and even there weight it lower.

### 2.7 Warnick, J.E., & Warnick, K. (2007). Specification of variables predictive of victories in the sport of boxing. *Perceptual and Motor Skills*, 105(1), 153-158. https://doi.org/10.2466/pms.105.1.153-158

- Sample: 400 male professional boxing contests in the USA in one month (BoxRec); logistic regression.
- Findings: only age, total wins, total losses, and result of the preceding contest significantly predicted outcome; weight change since last bout, country and title status did not.
- Quality: small, old, coefficients not available in abstract.
- **Sim implication:** Fighter "form" state: result of previous bout should carry a small carry-over (confidence/damage) modifier; record (wins, losses) is a valid proxy for latent skill in fighter generation.

### 2.8 Faro, H., de Lima-Junior, D., & Machado, D.G.S. (2023). Rapid weight gain predicts fight success in mixed martial arts - evidence from 1,400 weigh-ins. *European Journal of Sport Science*, 23(1), 8-17. https://doi.org/10.1080/17461391.2021.2013951

- Sample: 1,474 professional MMA fights (110 female) from 21 promotions regulated by the California State Athletic Commission; official weigh-in vs fight-day weight; logistic regression controlling for sex, division and weight difference from opponent.
- Findings: %weight regain (%WR) OR = 1.046 (95% CI 1.015-1.078, p = 0.004) per 1% of body mass regained (about +4.6% odds per 1%). Median %WR by division: bantamweight 9.72%, flyweight 9.42%, atomweight 9.35%, featherweight 8.95%, lightweight 8.45%, welterweight 8.24%, strawweight 8.06%, middleweight 5.82%; heavyweight/super-heavyweight smallest. Max individual 20.4%. Weight difference from opponent: OR = 1.000 (n.s.). Sex, division: n.s.
- Quality: large commission dataset, but %WR is confounded with fighter quality and hydration strategy; no control for skill.
- **Sim implication:** Model weight cut/regain as a fighter trait: expected regain 8-10% of division limit in light divisions, ~6% at middleweight, ~3% heavyweight. Convert regain to a small edge: multiply pre-fight win odds by 1.046^(regain% difference between fighters), capped at +/-5 percentage points.

### 2.9 Baribeau, V., Kirk, C., Le, D.Q., Bose, A., Mueller, A., French, D., Sarge, T., Langan-Evans, C., Reale, R., & Murugappan, K.R. (2023). Rapid weight gain and weight differential predict competitive success in 2100 professional combat-sport athletes. *International Journal of Sports Physiology and Performance*, 18(1), 85-94. https://doi.org/10.1123/ijspp.2022-0142 (open copy: https://shura.shu.ac.uk/31352/)

- Sample: 708 MMA athletes and 1,392 male boxers, professional events 2015-2019 (retrospective cohort).
- Findings: rapid weight gain winners vs losers: MMA 8.7 +/- 3.7% vs 7.9 +/- 3.8%; boxing 8.0 +/- 3.0% vs 6.9 +/- 3.2%. Each +1% body-mass regain: +7% odds of victory (MMA), +13% (boxing). Effects held for regional/international MMA and male boxers, not females. Weight differential (heavier on fight night) predicted victory in international MMA and boxers, and predicted KO/TKO outcomes in international MMA and regional boxing.
- Quality: large; observational; no skill control.
- **Sim implication:** Fight-night weight differential should feed the KO/TKO probability (heavier fighter's strikes carry more finishing power), suggest +2-3% relative KO probability per kg of fight-night weight advantage, capped at 5 kg. Combine with 2.8 for the regain-to-odds mapping (use OR ≈ 1.05-1.07 per 1%).

### 2.10 Kirk, C., Langan-Evans, C., & Morton, J.P. (2020). Worth the weight? Post weigh-in rapid weight gain is not related to winning or losing in professional mixed martial arts. *International Journal of Sport Nutrition and Exercise Metabolism*, 30(5), 357-361. https://doi.org/10.1123/ijsnem.2019-0347

- Sample: 62 winners vs 62 losers from five CSAC-sanctioned events with two weigh-ins (24 h and immediately pre-bout).
- Findings: no support for in-competition body mass (BF10 = 0.667, d = 0.23) or mass regained (BF10 = 0.821, d = 0.23) determining outcome; no difference by method of victory (BF10 = 0.69-0.73). Athletes compete at a body mass 1-2 divisions above weigh-in division.
- Quality: small, Bayesian, elite sample.
- **Sim implication:** Cap the weight-regain win modifier at a few percentage points; it must not dominate skill differences. Fight-night mass ≈ division limit + 8-10% is the norm, so "size advantage" is only relative regain, not absolute.

### 2.11 Brechney, G.C., Chia, E., & Moreland, A.T. (2021). Weight-cutting implications for competition outcomes in mixed martial arts cage fighting. *Journal of Strength and Conditioning Research*, 35(12), 3420-3424. https://doi.org/10.1519/JSC.0000000000003368

- Sample: 75 MMA athletes (59 amateur, 16 professional); self-report mass 7 days pre-weigh-in, official weigh-in, direct measurement pre-fight.
- Findings: losers cut more body mass (10.6%) than winners (8.6%), p = 0.04, d = 0.48 (95% CI 0.02-0.93); no difference by type of loss. Recovered mass: winners 6.8% vs losers 7.4%, n.s. Logistic: OR = 0.89 (0.79-1.00) per additional 1% of mass cut (B = -0.12, p = 0.048).
- Quality: modest, mostly amateur, self-report for the cut.
- **Sim implication:** Weight-cut *magnitude* should carry a performance penalty (cardio/durability), e.g. -1 to -2% to effective conditioning and chin per 1% of body mass cut beyond 5%, approximating OR 0.89 per 1%. Combined with regain benefits, the net effect of an aggressive cut is roughly neutral to slightly negative unless regain is efficient.

### 2.12 Peacock, C.A., Byers, P., Silver, T., Antonio, J., Sanders, G.J., Schwarz, A., & Stern, L. (2025). The impact of rapid weight regain on fight outcomes in Bellator mixed martial arts athletes. *Cureus*, 17(1), e77785. https://doi.org/10.7759/cureus.77785

- Sample: 20 Bellator fighters (16 M, 4 F).
- Findings: mean regain 9.47 +/- 4.57%; logistic regression p = 0.798; regain >= 10% not more likely to win.
- Quality: very small; low-tier journal; included only as a consistency check on the null side.
- **Sim implication:** Supports keeping the regain modifier small. Mean regain ~9.5% is a good default for fighter generation.

### 2.13 Coswig, V.S., Miarka, B., Pires, D.A., da Silva, L.M., Bartel, C., & Del Vecchio, F.B. (2019). Weight regain, but not weight loss, is related to competitive success in real-life mixed martial arts competition. *International Journal of Sport Nutrition and Exercise Metabolism*, 29(1), 1-8. https://doi.org/10.1123/ijsnem.2018-0034

- Sample: 15 MMA athletes after one real bout (8 winners, 7 losers), with time-motion and technical-tactical analysis.
- Findings: winners had more high-intensity time (median 58 s [10-98] vs 32 s [1-60]), more lower-limb (kick) sequences (3.5 vs 1.0) and more ground-and-pound actions (2.5 vs 0.0); logistic regression confirmed high-intensity time and lower-limb sequences as predictors.
- Quality: tiny sample; useful mainly for the pacing finding.
- **Sim implication:** Winners spend roughly 1.8x more time in high-intensity actions per round than losers; the sim's "aggression/output" state should be a strong driver of round scoring when accuracy is comparable.

### 2.14 Ma, K., Li, K., Zhu, Z., & Shao, H.T. (2026). Temporal trends and weight-class differences in takedown density in professional mixed martial arts: a retrospective analysis of 8,461 UFC bouts, 1997-2025. *BMC Sports Science, Medicine and Rehabilitation*, 18, 385. https://doi.org/10.1186/s13102-026-01804-8

- Sample: 8,461 UFC bouts (15,146 men's and 1,776 women's fighter-observations).
- Findings: men's takedown density declined -0.0043 takedowns/min/year (r = -0.75, p < 0.001; 2002-2025 subset -0.0020/min/year). Median takedown density is 0 in most men's divisions (flyweight 0.067/min). Winners vs losers: median takedown density 0.067 vs 0.000 per min; takedown success 50% vs 20%; control time per successful takedown 99.8 s vs 78.9 s. Women's trend non-significant.
- Quality: very large; descriptive; takedown data from public UFC stats.
- **Sim implication:** Modern-era baseline: ~0.1-0.2 takedown attempts/min with ~35% success pooled (winners 50%, losers 20%). A successful takedown should yield ~80-100 s of control on average (exponential with mean ~90 s, truncated by round end). Lighter divisions have higher takedown density; heavier divisions lower.

### 2.15 Ma, C. (2025). The correlation between weight divisions and methods used by winning mixed martial arts athletes. *The Sport Journal*. https://thesportjournal.org/article/the-correlation-between-weight-divisions-and-methods-used-by-winning-mixed-martial-arts-athletes/

- Sample: 174 ranked UFC athletes (127 M, 47 F), career win-method percentages.
- Findings: overall KO/TKO 40.2%, decision 36.8%, submission 23.0%. Males: KO/TKO 43.8%, decision 33.4%, submission 22.9%; females: decision 46.0%, KO/TKO 30.6%, submission 23.2%. Kruskal-Wallis across male divisions: KO/TKO chi2 = 30.1 (p < 0.01), decision chi2 = 33.2, submission chi2 = 15.8 (p = 0.027): heavier male divisions have more KO/TKO wins and fewer decisions/submissions; female outcomes independent of division.
- Quality: low-tier journal, ranked athletes only (survivorship); use as a sanity check on method-of-victory mix.
- **Sim implication:** Target win-method mix for ranked-level male MMA ≈ 44% KO/TKO, 33% decision, 23% submission, with KO share rising monotonically with weight class (roughly 30% at flyweight to 60%+ at heavyweight) and female mixes shifted toward decisions (46%).

---

## 3. Theme 2: Win-predictor, judging, forecasting and stance studies

### 3.1 James, L.P., Robertson, S., Haff, G.G., Beckman, E.M., & Kelly, V.G. (2017). Identifying the performance characteristics of a winning outcome in elite mixed martial arts competition. *Journal of Science and Medicine in Sport*, 20(3), 296-301. https://doi.org/10.1016/j.jsams.2016.08.001 (open copy: https://vuir.vu.edu.au/31281/)

- Sample: 234 decisive male UFC bouts (Jul-Dec 2014); 11 raw indicators + 3 accuracy indicators; Cohen's d, decision trees (10-fold CV) and discriminant function analysis.
- Findings: moderate effects favouring winners for total strikes landed/min, total attempted/min, significant strikes landed/min, significant strike accuracy, significant ground strikes landed/min, offensive passes; no large effects. Takedown accuracy: winners 50.9 +/- 32.5% vs losers 29.0 +/- 34.7% (d = 0.62). Decision tree (raw): 71.8% accuracy (sens 88.9%, spec 54.7%); >4 significant ground strikes landed per bout -> 80.4% win (111/138); plus takedown accuracy > 25% -> 84.9%. Decision tree (rate-scaled): 76.3% accuracy (sens 73.5%, spec 79.1%); >0.85 significant ground strikes landed/min -> 91.5% win (86/94); plus >4.19 total strikes landed/min -> 96.3% (79/82). DFA 71.4% / 71.2%. Attempt volume without accuracy did not contribute.
- Quality: strong, cross-validated; single 6-month window.
- **Sim implication:** Round/fight scoring should reward *landed* rate and accuracy, not attempts. Calibration targets: a fighter who lands > 0.85 significant ground strikes/min should win ~90% of bouts; takedown accuracy threshold 25% is the tipping point between "grappling helps" and "grappling hurts". Loser-profile: takedown success ~29%, winner ~51%.

### 3.2 James, L.P., Sweeting, A.J., Kelly, V.G., & Robertson, S. (2019). Longitudinal analysis of tactical strategy in the men's division of the Ultimate Fighting Championship. *Frontiers in Artificial Intelligence*, 2, 29. https://doi.org/10.3389/frai.2019.00029

- Sample: 2,831 decisive male UFC bouts, 2000-2015; 13 indicators per round; nMDS for era patterns, RIPPER rule induction for winning.
- Findings: erratic tactical change 2000-2008, stabilisation to 2014, renewed change 2015; post-2008 increase in distance striking attempts and execution. Rule model: train 77.0%, test 75.2%. Dominant rule: significant ground strikes landed >= 6 AND total strikes landed >= 81 -> win (559 true positives). Bout duration appeared in 3 of 8 rules; landing even 1 ground strike gave 77-79% win likelihood in very short or very long bouts.
- Quality: large, longitudinal, no weight-class stratification.
- **Sim implication:** Same signals as 3.1 at scale: ground striking is the single strongest discriminator. A "landed ground strikes" counter should have a step-like effect on judge scoring and finish probability. Era parameterisation: modern (post-2008) distance-striking share higher than early-era grappling-dominant profiles.

### 3.3 Miarka, B., Dal Vecchio, F.B., Camey, S., & Amtmann, J.A. (2016). Comparisons: technical-tactical and time-motion analysis of mixed martial arts by outcomes. *Journal of Strength and Conditioning Research*, 30(7), 1975-1984. https://doi.org/10.1519/JSC.0000000000001287

- Sample: 645 UFC rounds paired by outcome (215 winner/loser pairs per round, rounds 1-3).
- Findings: winners had higher total strikes, submission attempts and positional improvements in every round. Standing low-intensity time per round: R1 median 2:33.5 (IQR 1:20-3:56), R2 2:37, R3 2:07 (less low-intensity standing time in R3).
- Quality: good sample; paired design.
- **Sim implication:** Round 3 is ~17% less "low-intensity standing" than rounds 1-2, i.e. pace/urgency rises late. Effort-pause ratios should shift toward more engagement in the final round of a 3-round fight.

### 3.4 Holmes, B., McHale, I.G., & Zychaluk, K. (2023). A Markov chain model for forecasting results of mixed martial arts contests. *International Journal of Forecasting*, 39(2), 623-640. https://doi.org/10.1016/j.ijforecast.2022.01.007 (thesis with full tables: Holmes, B. (2022). *Quantitative essays on mixed martial arts*, University of Liverpool, https://livrepository.liverpool.ac.uk/3166169/)

- Sample: 4,678 UFC fights / 1,680 athletes (2001-2018); training to 2017, 327 test fights in 2018; per-fighter skill estimates for strike rates and accuracies (standing head/body, ground head/body), takedown and submission accuracy, knockdown/KO probability, control time per takedown, stand-up probability; fight simulated 10,000 times as a Markov chain of positions.
- Findings: result-market accuracy 61.6% (resample SD 0.53; range 59.9-63.0%) vs bookmakers 61.2%; disagreement rate with bookmakers ~41%. Method-of-victory market: model 38.8% vs bookmakers 32.7%. Profitable betting strategy demonstrated; accuracy roughly stable regardless of fighters' minimum prior fights.
- Quality: peer-reviewed, held-out testing, strong methodology; the most directly relevant model to this project.
- **Sim implication:** Architecture validation: a position-state Markov simulator with per-fighter rate/accuracy parameters is sufficient to match bookmaker accuracy. Target: when the sim is run on real fighter stats, ~61-62% of favourites should win and ~35-40% of "better on paper" fighters should lose. Method-of-victory predictability ~39%.

### 3.5 Holmes, B. (2022). Reputation bias and home crowd influence in judging: the case of MMA (thesis chapter 4). In *Quantitative essays on mixed martial arts* (PhD thesis, University of Liverpool). https://livrepository.liverpool.ac.uk/3166169/

- Sample: 17,105 judge scores over 5,800 rounds in 1,840 UFC fights (Feb 2013-Jun 2022), including 51 no-audience pandemic events (281 fights). Logistic regression (no intercept) on differences in in-round counts; average marginal effects (AME) on P(judge awards round).
- Findings (AME per unit difference): knockdowns +0.238; submission attempts +0.096; reversals +0.062; takedowns landed +0.049; home fighter with crowd +0.036; significant head strikes landed +0.021; significant body strikes landed +0.015; significant leg strikes landed +0.013; non-significant strikes missed +0.005; significant body missed +0.004; non-significant landed +0.003; control time +0.0009 per second (~+0.054 per minute); takedowns missed negative (~-0.02 per sqrt-unit); ranking 10 places higher +0.034 (reputation bias); home with no crowd ≈ 0 (-0.004). Crowd *size* did not matter, only presence. Judges value control time more when the controlling fighter has a high submission-win implied probability.
- Quality: PhD thesis (examined, not journal-reviewed) but the largest quantitative judging model available; numbers read from Table 4.2.
- **Sim implication:** Use these AMEs directly as the round-scoring weight vector: knockdown 1.0 (reference); submission attempt 0.40; reversal 0.26; takedown 0.21; sig head strike 0.09; sig body 0.06; sig leg 0.055; control time 0.0038 per second; non-significant strike 0.013; missed takedown -0.08. Add +3.6% round-win probability for home fighter with crowd, +0.34% per rank place of reputation.

### 3.6 Gift, P. (2018). Performance evaluation and favoritism: evidence from mixed martial arts. *Journal of Sports Economics*, 19(8), 1147-1173. https://doi.org/10.1177/1527002517702422

- Sample: round-by-round judge decisions at major MMA events in Nevada and California, 2001-2012, with after-the-fact video statistics; binary and ordered logit.
- Findings: no support for bias toward titleholders or against fighters with point deductions; significant bias toward larger betting favourites (reputation), fighters with insurmountable leads, and the previous-round winner (recency). Missed takedowns were the only significant negative action; tight submissions and knockdowns the most influential positive actions.
- Quality: peer-reviewed economics journal; coefficients not reproduced here (paywalled).
- **Sim implication:** Add judge-bias terms: (a) previous-round winner gets a small carry-over bonus in close rounds (suggest +3-5% round-win prob); (b) pre-fight favourite gets a similar bonus in close rounds; (c) missed takedowns count negatively.

### 3.7 Collier, T., Johnson, A.L., & Ruggiero, J. (2012). Aggression in mixed martial arts: an analysis of the likelihood of winning a decision. In R.T. Jewell (Ed.), *Violence and Aggression in Sporting Contests* (pp. 97-109). Springer. https://doi.org/10.1007/978-1-4419-6630-8_7

- Sample: UFC fights going to decision; probit on aggregate performance differences plus height, weight, age.
- Findings: knockdowns and visible damage are statistically significant and have the largest marginal effects on winning a decision; among non-performance variables only height was significant.
- Quality: book chapter; fight-level not round-level; numbers not extractable.
- **Sim implication:** Track a "visible damage" state (cuts, swelling, wobble) separate from strike counts and give it judge weight comparable to knockdowns' order of magnitude (e.g. 0.3-0.5 of a knockdown per damage event).

### 3.8 Dunn, E.C., Humberstone, C.E., Iredale, K.F., Martin, D.T., & Blazevich, A.J. (2017). Human behaviours associated with dominance in elite amateur boxing bouts: a comparison of winners and losers under the Ten Point Must System. *PLoS ONE*, 12(12), e0188675. https://doi.org/10.1371/journal.pone.0188675

- Sample: 19 elite bouts, 26 male boxers (12 winners, 14 losers).
- Findings: punch accuracy %Hit 33% (winners) vs 23% (losers), ES 1.39 in round 1; %Air 17% vs 27%, ES -1.08 in round 2; total punches 76.8 vs 79.3 (n.s.); winners used more bouncing, losers more stepping (moderate). Logistic classification: accuracy alone 76.9% correct; accuracy + movement index 84.6%; adding total punches 80.8%.
- Quality: small but tightly measured; judges' real decisions used as ground truth.
- **Sim implication:** In boxing scoring, landed-percentage difference should be the dominant term (a 10-point accuracy gap ≈ decisive). Elite accuracy baseline ≈ 0.28-0.33; "clean miss" rate 0.17-0.27. Give a small judge bonus for mobile/"bouncing" footwork as a dominance cue.

### 3.9 Balmer, N.J., Nevill, A.M., & Lane, A.M. (2005). Do judges enhance home advantage in European championship boxing? *Journal of Sports Sciences*, 23(4), 409-416. https://doi.org/10.1080/02640410400021583

- Sample: European championship professional boxing bouts; logistic models of home win by decision type, controlling for relative quality.
- Findings: for equally matched boxers, expected P(home win) = 0.57 for KO, 0.66 for TKO, 0.74 for points decisions; points-decision bouts had significantly more home wins than KO bouts.
- Quality: peer-reviewed; effect consistent across relative quality.
- **Sim implication:** Home advantage decomposition: ~+7% win probability via non-judging channels (KO share 0.57 vs 0.50), a further ~+9% via referee stoppage leniency (TKO 0.66), and ~+24% total in points decisions. For boxing rulesets, apply home bonus mostly inside the judging model (see 3.5 for the smaller MMA value).

### 3.10 Miller, K., & Nichols, M. (2026). Efficient market insights and favorite-longshot bias in mixed martial arts betting markets. *Journal of Economics and Finance*, 50(1). https://doi.org/10.1007/s12197-026-09757-x

- Sample: large tapology.com odds/outcome dataset.
- Findings: no favourite-longshot bias; market "largely efficient"; odds-makers do not fully price youth and travel advantages; favourites in women's contests slightly under-priced; out-of-sample strategies yield few significant positive returns.
- Quality: peer-reviewed; abstract-level detail only.
- **Sim implication:** Implied odds from a well-calibrated model should be (a) unbiased across the favourite range, (b) slightly under-weighting age and travel. When generating "market odds" in-game, add a small mis-pricing on age and travel to reproduce the inefficiency.

### 3.11 Yan, S., Liu, L., & Ubaldo, C. (2024). Artificial intelligence in UFC outcome prediction and fighter strategies optimization. *Proceedings of the 2024 9th International Conference on Intelligent Information Processing (ICIIP)*, 96-100. https://doi.org/10.1145/3696952.3696966

- Sample: UFC fight records with fighter physical attributes, performance stats and history; GLM, MLP, decision tree, gradient boosting.
- Findings: best reported accuracy 66.7% (as cited by a replication repository); features include punches landed, knockdowns, defence, age, height, weight, reach.
- Quality: conference paper; full text paywalled; treat the 66.7% as an upper bound for stats-only prediction.
- **Sim implication:** Reinforces the ~60-67% ceiling for pre-fight prediction; a sim whose outcomes are >70% predictable from ratings is under-randomised.

### 3.12 Berthet, V. (2024). Improving MMA judging with consensus scoring: a statistical analysis of MMA bouts from 2003 to 2023. arXiv:2401.03280. https://arxiv.org/abs/2401.03280

- Sample: 4,129 MMA bouts that went to decision.
- Findings: standard (majority of judges' fight totals) and consensus (majority per round) scoring agree in 97.5% of bouts; where they disagree, consensus aligns more with fan opinion (49.0% vs 43.8%). 10-8 rounds are the main source of divergence.
- Quality: preprint (not peer-reviewed); large dataset.
- **Sim implication:** Three-judge model with per-round independent noise should produce split/majority decisions in a realistic minority of decisions; scoring-method choice changes the outcome in only ~2.5% of decisions, so this is a low-priority feature.

### 3.13 Baker, J., & Schorer, J. (2013). The southpaw advantage? Lateral preference in mixed martial arts. *PLoS ONE*, 8(11), e79793. https://doi.org/10.1371/journal.pone.0079793

- Sample: 1,468 MMA fighters with stance data (from 2,053).
- Findings: 17.4% southpaw, 80.3% orthodox; win% southpaw 64.0 +/- 20.4 vs orthodox 62.6 +/- 21.3 (n.s.); southpaws had more fights (22.0 vs 19.7, small significant effect); southpaw proportion rises with career length.
- Quality: records-based; no matchup-level control.
- **Sim implication:** Southpaw prevalence for generated MMA fighters ≈ 17-19%; base win-rate difference ≈ +1.4 percentage points (not significant), so treat any stance bonus as <= +2%.

### 3.14 Pollet, T.V., Stulp, G., & Groothuis, T.G.G. (2013). Born to win? Testing the fighting hypothesis in realistic fights: left-handedness in the Ultimate Fighting Championship. *Animal Behaviour*, 86(4), 839-843. https://doi.org/10.1016/j.anbehav.2013.07.026

- Sample: UFC fighters with handedness data.
- Findings: left-handers strongly over-represented vs the general male population, but no advantage for left-handers when facing right-handers; "partial evidence" for the fighting hypothesis.
- Quality: peer-reviewed; effect sizes not in abstract.
- **Sim implication:** Over-representation without matchup advantage: implement southpaw as a *selection* effect (more likely to reach elite level) rather than a per-fight bonus, or keep per-fight bonus near zero.

### 3.15 Pollet, T.V., & Riegman, B.R. (2014). Opponent left-handedness does not affect fight outcomes for Ultimate Fighting Championship hall of famers. *Frontiers in Psychology*, 5, 375. https://doi.org/10.3389/fpsyg.2014.00375

- Sample: 182 fights of UFC hall of famers; 75 with complete opponent handedness; 9 right-handed hall of famers analysed.
- Findings: no difference in outcome vs left- vs right-handed opponents (chi2 = 0.17, p = 0.39; GLMM B = -0.214, p = 0.34).
- Quality: small; elite-only sample.
- **Sim implication:** Elite fighters should be modelled as fully adapted to southpaws (stance-mismatch penalty ~0 at high experience); the mismatch effect, if any, belongs at low experience levels.

### 3.16 Richardson, T., & Gilman, R.T. (2019). Left-handedness is associated with greater fighting success in humans. *Scientific Reports*, 9, 15402. https://doi.org/10.1038/s41598-019-51975-3

- Sample: 10,445 male boxers (1,779 left), 1,314 female boxers (164 left), 2,100 MMA fighters (393 left).
- Findings: left-hander prevalence 17.0% (male boxers), 12.5% (female boxers), 18.7% (MMA) vs population 12.6% (men) / 9.9% (women). Probability a random left-hander out-scores a random right-hander: 52.4% (male boxing, BoxRec score, p = 0.0007), 54.5% (female boxing, p = 0.031), 53.5% (MMA, p = 0.016).
- Quality: largest sample; records-based; small effects.
- **Sim implication:** Career-level southpaw edge ≈ +2.4 to +4.5 percentage points on probability of superiority, i.e. roughly +1-2% per-fight win probability. Implement as: southpaw vs orthodox with opponent southpaw-exposure < N fights: +2%; otherwise +0.5%.

---

## 4. Theme 3: Skill acquisition, expertise and perception-action

### 4.1 Zhang, Z., Piras, A., Chen, C., Kong, B., & Wang, D. (2022). A comparison of perceptual anticipation in combat sports between experts and non-experts: a systematic review and meta-analysis. *Frontiers in Psychology*, 13, 961960. https://doi.org/10.3389/fpsyg.2022.961960

- Sample: 27 studies, 233 datasets (fencing 16, karate 10, taekwondo 7, boxing 6, sanda 4, judo 3).
- Findings: response accuracy SMD = 1.24 [0.80-1.68] (experts 83.3% vs non-experts 68.5%); reaction time SMD = -1.00 [-1.14 to -0.86]; number of fixations SMD = -2.04 [-3.32 to -0.77] (experts fixate fewer locations); fixation duration SMD = 0.64 (n.s.). By sport (RT): karate -1.23, sanda -1.36, fencing -1.07, taekwondo -0.89, boxing -0.51 (p = 0.07). In-situ stimuli produce the largest gaps (accuracy SMD 7.71), static the smallest. Expert vs intermediate accuracy SMD 1.10; intermediate vs novice 1.37.
- Quality: high (meta-analysis), though heterogeneous tasks.
- **Sim implication:** Map skill tier to "read" probability: novice 0.55-0.65, intermediate 0.70-0.78, expert 0.80-0.88 chance of correctly anticipating an incoming attack type/target; reaction-time multiplier expert ≈ 0.8x novice for choice reactions. The largest step is novice -> intermediate; diminishing returns beyond.

### 4.2 Mori, S., Ohtani, Y., & Imanaka, K. (2002). Reaction times and anticipatory skills of karate athletes. *Human Movement Science*, 21(2), 213-230. https://doi.org/10.1016/S0167-9457(02)00103-3

- Sample: karate athletes vs novices; choice RT and simple RT to video attack scenes vs dots; occluded-video prediction of attack level.
- Findings: athletes faster in choice RT, more so for sport-specific video than for dots; *no* difference in simple RT; athletes had higher proportion of correct predictions at 7-frame cut-off.
- Quality: classic lab study; modest n; numbers in abstract only.
- **Sim implication:** Model expertise as *cue-based anticipation* (reduced effective latency vs telegraphed attacks), not as a global reflex bonus. Simple reaction latency should be similar across tiers (~200-250 ms); the expert edge should come from earlier cue pickup (e.g. 50-100 ms earlier), making telegraphed/slow techniques far less effective against experts.

### 4.3 Williams, A.M., & Elliott, D. (1999). Anxiety, expertise, and visual search strategy in karate. *Journal of Sport & Exercise Psychology*, 21(4), 362-375. https://doi.org/10.1123/jsep.21.4.362

- Sample: expert and novice karate performers responding to taped offensive sequences under low and high anxiety, eye-tracked.
- Findings: experts had superior anticipation in both conditions; anxiety increased fixation count and locations (search rate), more so in novices, with fixations drifting from central (head/chest) to peripheral limb locations; scan paths run along the body centre-line; performance was better under high anxiety in this task.
- Quality: seminal; small n.
- **Sim implication:** Under pressure/anxiety (e.g. after being hurt, or low composure rating), novices' defensive read probability should drop more than experts' (suggest -15% for novices vs -5% for experts). Experts' attention model: head/chest-centred (fewer, longer fixations).

### 4.4 Ottoboni, G., Russo, G., & Tessari, A. (2015). What boxing-related stimuli reveal about response behaviour. *Journal of Sports Sciences*, 33(10), 1019-1027. https://doi.org/10.1080/02640414.2014.977939

- Sample: expert boxers, beginner boxers, non-athletes; Simon-like task with images of boxers in attack postures.
- Findings: without instruction to attend to punch direction, beginners' automatic responses followed a *defence-related* spatial pattern, experts' a *counter-attack* pattern, non-athletes showed neither.
- Quality: peer-reviewed lab study; effect sizes not in abstract.
- **Sim implication:** "Beginner behaviour" rule: at low skill, the default reaction to an incoming attack is defensive (cover/retreat), with counter-attack probability near zero; at expert level, a successful read yields a counter with high probability (suggest counter-on-read probability: novice 0.05, intermediate 0.25, expert 0.5).

### 4.5 Witkowski, M., Tomczak, E., Bojkowski, L., Borysiuk, Z., & Tomczak, M. (2021). Do expert fencers engage the same visual perception strategies as beginners? *Journal of Human Kinetics*, 78, 187-196. https://doi.org/10.2478/hukin-2021-0045

- Sample: high-performance foil fencers vs beginners; eye-tracking during duels.
- Findings: beginners distributed attention over all areas (guard, blade, tip, armed hand, torso); experts paid significantly less attention to the weapon and picked up information from the upper torso and armed hand.
- Quality: peer-reviewed; small n.
- **Sim implication:** Feint susceptibility: feints that "sell" with the weapon/hand should deceive novices far more than experts (novice feint-bite probability ~0.6, expert ~0.25), since experts read torso/shoulder cues that a feint does not commit.

### 4.6 Allerdissen, M., Guldenpenning, I., Schack, T., & Blasing, B. (2017). Recognizing fencing attacks from auditory and visual information: a comparison between expert fencers and novices. *Psychology of Sport and Exercise*, 31, 123-130. https://doi.org/10.1016/j.psychsport.2017.04.009

- Sample: 15 expert fencers (mean age 17.2) vs 17 novices (mean age 23.4); temporal occlusion of raddoppio and fleche attacks in visual, auditory and audio-visual conditions.
- Findings: accuracy increased with later occlusion for both groups; experts outperformed novices in all conditions; adding sound did not improve prediction.
- Quality: peer-reviewed; small n.
- **Sim implication:** Anticipation accuracy should rise as the attack unfolds (earlier interception = lower accuracy). Expert curve sits above novice curve at all occlusion points; use a logistic "read" curve over attack elapsed-time with a skill offset.

### 4.7 Wu, C.-H., et al. (2025). Mental fatigue impairs temporal perceptual prediction: a study on boxing performance across skill levels. *Sports*, 13(5), 154. https://doi.org/10.3390/sports13050154

- Sample: 20 expert boxers (6.6 +/- 2.7 y training) vs 20 novices; 45-min Stroop to induce mental fatigue; video occlusion at -80 ms, -40 ms and action onset.
- Findings: at -40 ms, offensive-technique recognition accuracy experts 75.3% vs novices 64.3%; RT experts 811 ms vs novices 915 ms (offensive) and 729 vs 932 ms (defensive). Mental fatigue slowed RT (main effect) without lowering accuracy; fatigue effects more pronounced for experts' defensive recognition.
- Quality: peer-reviewed; small n; single fatigue protocol.
- **Sim implication:** Fatigue (mental or late-round) should increase reaction latency (~+10-15%) more than it reduces read accuracy; experts lose relatively more of their defensive edge when fatigued, compressing the expert-novice gap late in fights.

### 4.8 Bianco, V., Di Russo, F., Perri, R.L., & Berchicci, M. (2017). Different proactive and reactive action control in fencers' and boxers' brain. *Neuroscience*, 343, 260-268. https://doi.org/10.1016/j.neuroscience.2016.12.006

- Sample: fencers, boxers and controls in a discriminative response task with ERPs.
- Findings: sport-specific differences in preparatory (prefrontal negativity, Bereitschaftspotential) activity; larger prefrontal preparatory activity associated with fewer errors and larger motor preparation with faster responses; boxers and fencers differ in proactive vs reactive control balance.
- Quality: peer-reviewed neuroscience; abstract-level only.
- **Sim implication:** Style parameter "proactive vs reactive" is neurologically plausible as a trait separate from raw reaction speed; boxers can be modelled with more reactive (wait-and-counter) control and fencers more proactive, i.e. a per-fighter "initiative" trait.

### 4.9 Smith, M.S., Dyson, R.J., Hale, T., & Janaway, L. (2000). Development of a boxing dynamometer and its punch force discrimination efficacy. *Journal of Sports Sciences*, 18(6), 445-450. https://doi.org/10.1080/02640410050074377

- Sample: elite, intermediate and novice boxers punching an instrumented manikin.
- Findings: mean maximal force, lead / rear hand: elite 2,847 / 4,800 N; intermediate 2,283 / 3,722 N; novice 1,604 / 2,381 N (all group differences significant).
- Quality: small groups; classic reference values.
- **Sim implication:** Power scaling by tier: novice 0.50, intermediate 0.78, elite 1.00 of rear-hand force; lead hand ≈ 0.59 of rear hand at every tier. Use these as multipliers on strike damage before applying technique/accuracy.

### 4.10 Dinu, D., & Louis, J. (2020). Biomechanical analysis of the cross, hook, and uppercut in junior vs. elite boxers: implications for training and talent identification. *Frontiers in Sports and Active Living*, 2, 598861. https://doi.org/10.3389/fspor.2020.598861

- Sample: 15 potential Olympic medallists vs 8 well-trained juniors; 17-IMU suits; cross, hook, uppercut at maximal effort.
- Findings: elite produced more force at higher velocity for all three punches; juniors relied more on shoulder contribution (less efficient kinetic chain); front/rear foot GRF split in the cross ≈ 61/39% (elite) vs 54/46% (juniors), n.s. between groups.
- Quality: peer-reviewed; small n.
- **Sim implication:** Technique-quality trait should raise both force *and* hand speed (harder to see and harder to absorb) with training age, and should be modelled as kinetic-chain efficiency rather than raw strength: a strong but untrained fighter gets less of their strength into the punch.

### 4.11 Ju, Y.Y., Liu, Y.H., Cheng, C.H., Lee, Y.L., Chang, S.T., Sun, C.C., & Cheng, H.K. (2018). Effects of combat training on visuomotor performance in children aged 9 to 12 years - an eye-tracking study. *BMC Pediatrics*, 18, 39. https://doi.org/10.1186/s12887-018-1038-6

- Sample: 26 children in 8 weeks of combat-sport training vs 30 controls.
- Findings: earlier primary and secondary saccade onset latencies after training; hit-response time improved in both groups.
- Quality: small, short, children; weak transfer evidence.
- **Sim implication:** Early training gains are in eye-movement latency (looking to the right place sooner), consistent with 4.1-4.5; supports a fast initial learning curve for the "read" attribute.

### 4.12 Russo, G., & Ottoboni, G. (2019). The perceptual-cognitive skills of combat sports athletes: a systematic review. *Psychology of Sport and Exercise*, 44, 60-78. https://doi.org/10.1016/j.psychsport.2019.05.004

- Sample: narrative/systematic review of combat-sport perceptual-cognitive expertise.
- Findings: converging evidence that expert combat athletes use sport-specific anticipation, fewer/longer fixations on informative central regions, and action-specific (rather than generic) processing advantages; proposes a perception-action model for combat sports.
- Quality: review; cited for framing only.
- **Sim implication:** Perception-action loop in the sim: cue detection -> read -> decision -> execution, with expertise affecting the first three stages more than the last.

### 4.13 Martinez de Quel, O., & Bennett, S.J. (2019). Perceptual-cognitive expertise in combat sports: a narrative review and a model of perception-action. *RICYDE. Revista Internacional de Ciencias del Deporte*, 15(58), 323-338. https://doi.org/10.5232/ricyde2019.05802

- Sample: narrative review of combat-sport perception-action studies (boxing, karate, taekwondo, fencing, judo).
- Findings: experts' advantage is specific to sport-relevant dynamic stimuli, involves earlier use of kinematic cues from the opponent's trunk/shoulders, and is coupled to action (in-situ responses show larger expertise effects than button-press tasks); proposes a perception-action model for combat sports with deception/feints as a key manipulation of the opponent's read.
- Quality: review; open access; cited for framing only.
- **Sim implication:** Supports modelling feints as actions that exploit the *opponent's* read process (trigger a false read with probability that declines with opponent expertise) and modelling in-situ (live) skill differences as larger than lab tests would suggest.

---

## 5. Theme 4: Tactical analysis of bouts

### 5.1 Davis, P., Wittekind, A., & Beneke, R. (2013). Amateur boxing: activity profile of winners and losers. *International Journal of Sports Physiology and Performance*, 8(1), 84-91. https://doi.org/10.1123/ijspp.8.1.84

- Sample: 32 male novice-level amateur boxers (19.3 +/- 1.4 y; 62.6 kg), 3 x 2-min bouts, video + blood lactate.
- Findings: winners landed 18 +/- 11 more punches; more lead-hand punches in R1 (34.2 vs 26.5), more total head punches (121.3 vs 96.0), more block-and-counter combinations (2.8 vs 0.1 per bout), more punch combinations in R1 and R3 (44.3 vs 28.8). Post-bout lactate 11.8 mmol/L regardless of outcome (1.8 mmol/L/min production rate).
- Quality: small; novice level; analyst-defined winners.
- **Sim implication:** Novice-level boxing: winners out-land by ~18 punches per 6-min bout (~+3/min); combinations and counters after a block are strongly associated with winning (winners 2.8 vs 0.1 block-counters), so "counter after successful defence" should be a distinct, skill-gated action with a high hit rate.

### 5.2 Davis, P., Connorton, A.J., Driver, S., Anderson, S., & Waldock, R. (2018). The activity profile of elite male amateur boxing after the 2013 rule changes. *Journal of Strength and Conditioning Research*, 32(12), 3450-3455. https://doi.org/10.1519/JSC.0000000000001864

- Sample: 50 World Championship bouts, 60 male boxers (23.5 y, 176.2 cm, 71.7 kg).
- Findings: ~1.55 actions/s; ~21 punches, ~3.6 defensive movements and ~56 vertical hip movements per minute. Winners threw more straight punches and lead-hand straights in R1, landed more total punches in R3, and had a lower thrown:landed ratio in R3 and fewer "air" punches in R2-R3. Post-2013 style: long range, straight punches, more movement, fewer short-range hooks.
- Quality: elite level; real judges' decisions.
- **Sim implication:** Elite boxing output baseline ≈ 21 punches/min per boxer, 3.6 defensive actions/min. Winners' accuracy *increases* across rounds while losers' decays: implement a fatigue-accuracy coupling where higher conditioning/skill preserves accuracy into R3.

### 5.3 Thomson, E., & Lamb, K. (2016). The technical demands of amateur boxing: effect of contest outcome, weight and ability. *International Journal of Performance Analysis in Sport*, 16(1), 203-215. https://doi.org/10.1080/24748668.2016.11868881 (open copy: Chester repository)

- Sample: 84 boxers in 42 bouts across regional and national standards, three weight bands; 8 offensive and 4 defensive actions coded with outcome.
- Findings: ~25 punches and ~10 defences per minute; ~105 attacks and ~183 punches per bout; jab most frequent but least successful (28% landed); cross, lead hook and rear hook ~33-40% landed; foot defence 70% successful (most effective), arm/trunk defences less so. Winning associated with higher offensive frequency and success plus *fewer* arm/trunk defences; higher standard (national) associated with higher offensive and defensive frequencies; weight class effects inconsistent.
- Quality: moderate n; robust log-linear modelling; 12-cell design leaves some cells with n = 4.
- **Sim implication:** Landing probabilities by punch: jab 0.28, cross/hooks 0.33-0.40, uppercuts rare. Defence success by type: footwork 0.70, arm block/parry and trunk (slip/roll) lower (~0.5). Higher skill tier = higher action rate on both offence and defence (+~20% per tier).

### 5.4 El-Ashker, S. (2011). Technical and tactical aspects that differentiate winning and losing performances in boxing. *International Journal of Performance Analysis in Sport*, 11(2), 356-364. https://doi.org/10.1080/24748668.2011.11868555

- Sample: amateur boxing bouts, winners vs losers, notational analysis.
- Findings (as summarised in Thomson & Lamb and Davis): winners perform more offensive actions and more effective (landed) punches; defensive actions must convert into counter-attacks; consistent with 5.1-5.3.
- Quality: peer-reviewed; abstract not retrievable here, cited via secondary sources.
- **Sim implication:** Corroborates the accuracy-and-counter rule; no new numbers.

### 5.5 Ouergui, I., Hssin, N., Franchini, E., Gmada, N., & Bouhlel, E. (2013). Technical and tactical analysis of high level kickboxing matches. *International Journal of Performance Analysis in Sport*, 13(2), 294-309. https://doi.org/10.1080/24748668.2013.11868649

- Sample: 45 World Championship (2009, 2011) male kickboxing matches, 135 rounds.
- Findings: most used techniques: straight punches, roundhouse kick, block/parry, foot defence; punch combinations the most used combination type. Winners used more hooks, more foot defence and clinch, more punch combinations, more head/body offence, more lead and rear hand punches, and had higher technical effectiveness than losers.
- Quality: peer-reviewed; abstract-level numbers.
- **Sim implication:** In kickboxing rulesets winners' profile = more hooks and combinations plus clinch/footwork defence; roundhouse kick is the default kick. Accuracy again separates winners.

### 5.6 Bhumipol, P., Makaje, N., Kawjaratwilai, T., & Ruangthai, R. (2023). Match analysis of professional Muay Thai fighter between winner and loser. *Journal of Human Sport and Exercise*, 18(3). https://doi.org/10.14198/jhse.2023.183.12

- Sample: 8 professional fighters, 12 full 5 x 3-min matches without KO.
- Findings: winners threw more swing (hook) punches in R3 and landed them more accurately in R4; more round kicks in R1 and R5 and more accurate round kicks in R5 (p < 0.05).
- Quality: very small.
- **Sim implication:** Muay Thai judging emphasises late rounds; winners raise kick volume/accuracy in R5. Implement round-weighting in Muay Thai scoring (later rounds weighted higher) and let conditioning drive R4-R5 output.

### 5.7 Miarka, B., Brito, C.J., Dal Bello, F., & Amtmann, J. (2017). Motor actions and spatiotemporal changes by weight divisions of mixed martial arts: applications for training. *Human Movement Science*, 55, 73-80. https://doi.org/10.1016/j.humov.2017.07.009

- Sample: 2,814 UFC rounds across all divisions.
- Findings: keeping-distance standing time lowest at featherweight (131.4 s/round) and bantamweight (127.9 s); clinch-without-attack highest at flyweight (11.4 s) and welterweight ("half-middleweight", 12.6 s). Distance head strikes landed highest at welterweight (7 +/- 8 per round; attempted 24 +/- 22). Clinch head strikes highest at heavyweight (3 +/- 7 landed, 4 +/- 9 attempted). Ground head strikes highest at bantamweight (8 +/- 10 landed, 10 +/- 13 attempted).
- Quality: very large sample; per-round descriptive.
- **Sim implication:** Per-round phase budgets (5-min round): distance ~130-150 s standing at range, clinch ~10-15 s without attack plus attacking clinch time, ground the remainder in grappling-heavy divisions. Distance head-strike accuracy ≈ 7/24 ≈ 0.29 at welterweight; ground strike accuracy ≈ 0.8.

### 5.8 Dos Santos, D.A., Miarka, B., Dal Bello, F., Queiroz, A.C.C., de Carvalho, P.H.B., Brito, C.J., & Beneke, R. (2019). 10 years on time-motion and motor actions of paired mixed martial arts athletes. *International Journal of Sports Physiology and Performance*, 14(3), 399-406. https://doi.org/10.1123/ijspp.2018-0566

- Sample: 845 UFC rounds from 45 athletes observed 10 years apart (age 34-44 -> 44-54 bands).
- Findings (medians per round, earlier -> later): total strikes landed 22 -> 18; attempted 41 -> 35; single head strikes attempted 19 -> 16.5; standing combat time 2:10 -> 1:56; low-intensity time 2:11 -> 1:56. Over years, landed head/body/total strikes were positively associated with performance probability; attempted body strikes and submission attempts negatively.
- Quality: unique paired longitudinal design; older cohort.
- **Sim implication:** Ageing curve for output: ~-15 to -18% strike volume over a decade in late career (~-1.5%/yr), while accuracy is preserved or improves. Model ageing as declining output/pace and durability with stable-to-rising accuracy and decision quality.

### 5.9 Pinto, F.C.L., Neiva, H., Nunes, C., Marques, M.C., Sousa, A.C., Marinho, D.A., Branquinho, L., & Ferraz, R. (2020). Ultimate Full Contact: fight outcome characterization concerning their methods, occurrence times and technical-tactical developments. *International Journal of Environmental Research and Public Health*, 17(19), 7094. https://doi.org/10.3390/ijerph17197094

- Sample: 170 senior male WUFC (hybrid full-contact, 10-min bouts) fights, 2008-2017.
- Findings: outcome order: submission > decision = TKO > KO > doctor stoppage. Only 19.4% of fights went the full 10 min; 68.8% ended within 5 min. Chokes > joint locks, mostly single actions. Head punches and kicks were the KO tools, delivered mostly in combinations and *counter-attacks*; TKO always via combinations, mostly ground-and-pound. "In stand-up fighting, combination attacks and counter-attack are most effective."
- Quality: moderate n; different ruleset from UFC.
- **Sim implication:** KOs should be more likely from counters and combinations than from single lead attacks; TKOs arise from combination follow-ups (esp. ground-and-pound after a knockdown). Finishing-time distribution front-loaded (hazard highest early) for amateur/hybrid rules.

### 5.10 Menescardi, C., Falco, C., Ros, C., Morales-Sanchez, V., & Hernandez-Mendo, A. (2019). Development of a taekwondo combat model based on Markov analysis. *Frontiers in Psychology*, 10, 2188. https://doi.org/10.3389/fpsyg.2019.02188

- Sample: 11,474 male and 12,980 female Olympic taekwondo actions.
- Findings: 32 (male) / 30 (female) significant action sequences; roughly a third each initiated by attack, counter-attack and defensive action; most common: opening + dodge, direct attack + simultaneous counter, dodge + direct attack, indirect attack + simultaneous counter.
- Quality: large; Markov transition modelling.
- **Sim implication:** Exchange grammar: initiations split ≈ 1/3 attack, 1/3 counter, 1/3 defensive/positioning; simultaneous counters are a first-class transition from a direct attack, not a rare event.

### 5.11 Lamas, L., Heiner, M., Ferreira, M., Moura, A., Rangel, W., Fellingham, G., & Lage, V. (2024). No-gi Brazilian jiu-jitsu: a Markovian analysis of elite-level combat dynamics. *International Journal of Sports Science & Coaching*, 19(2). https://doi.org/10.1177/17479541231210979

- Sample: all 93 matches (90 competitors) of the 2019 ADCC (World Submission Fighting Championship); Bayesian transition estimates.
- Findings: most actions occur < 1 per competitor per match except submission attempts (1.03/match); highest within-competitor transition: guard pass -> guard pass (0.30); between-competitor: takedown attempt -> submission attempt (0.15); back-take has highest direct-to-submission probability (0.45); most actions have positive reward-risk balance.
- Quality: complete-tournament sample; elite; no-gi rules.
- **Sim implication:** Grappling state machine parameters: P(submission | back control) ≈ 0.45 per back-take at elite level; submission attempt rate ≈ 1 per 10-15 min match; guard-pass attempts chain (0.30 repeat probability).

### 5.12 Ma, K., Li, K., Zhu, Z., & Shao, H.T. (2026) - see 2.14 for takedown density and control-time norms (winners 100 s vs losers 79 s control per takedown).

### 5.13 Folhes, O., Reis, V.M., Marques, D.L., Neiva, H.P., & Marques, M.C. (2023). Influence of the competitive level and weight class on technical performance and physiological and psychophysiological responses during simulated mixed martial arts fights: a preliminary study. *Journal of Human Kinetics*, 86, 205-215. https://doi.org/10.5114/jhk/159453

- Sample: 20 male MMA athletes (elite vs professional; heavy vs light), four simulated 3 x 5-min fights.
- Findings: lightweight elite athletes landed more offensive touches than lightweight professionals; lightweights showed rising physiological demand and RPE across rounds; no lactate/readiness differences.
- Quality: small, simulated fights.
- **Sim implication:** Higher competitive level = higher landed output at the same weight; lighter weight = higher pace and steeper fatigue accumulation across rounds.

---

## 6. Numbers to carry into DESIGN.md

| Parameter | Value / range | Source |
|---|---|---|
| Age effect on win probability | winners 0.8 y younger on average; r = 0.18; ≈ -1.5 to -2 pp per year of age gap (logistic coef ≈ 0.06/yr), null at LHW and women's divisions | Kirk 2023 (2.4) |
| Age and method of victory | older fighters more likely to lose by strikes; decision winners older than finish winners | Kirk 2016 (2.1) |
| Late-career output decline | ~-15-18% strike volume per decade (~-1.5%/yr); accuracy preserved | Dos Santos 2019 (5.8) |
| Height difference -> win prob (MMA) | 0 (null supported, BF01 = 7) | Kirk 2023 (2.4) |
| Reach difference -> win prob (MMA) | ≈ 0; heavyweight only +0.5%/cm (winners +2.2 cm, r = 0.28) | Kirk 2023 (2.4) |
| Reach -> landed distance strikes (HW) | ≈ +1.5 landed significant strikes per bout per cm reach/stature advantage; tau 0.37-0.47 | Kirk 2018 (2.3) |
| Reach -> knockdowns (LW) | +0.028 knockdowns per bout per cm wingspan advantage | Kirk 2018 (2.3) |
| Reach -> finishing punch type | base KO punch mix hook 0.51 / straight 0.35 / uppercut+overhand 0.14; +1 pp toward straights per cm reach advantage | Barley 2025 (2.5) |
| Height/reach in uncapped striking (HW boxing) | positive, "much stronger than weight"; weight benefit plateaus ~110 kg; ex-lower-division HW -19.9% win | Fiala 2025 (2.6) |
| Ape index for generated fighters | A:S ~ N(1.026, 0.028); stature 177.5 +/- 9.5 cm; armspan 182 +/- 11.5 cm (UFC pooled) | Kirk 2023 (2.4), Kirk 2016 (2.2) |
| Weight regain -> odds | OR 1.046 per 1% (Faro); +7% MMA / +13% boxing per 1% (Baribeau); null in UFC/Bellator (Kirk 2020, Peacock) -> use OR ≈ 1.05, cap +/-5 pp | 2.8, 2.9, 2.10, 2.12 |
| Weight cut -> odds | losers cut 10.6% vs winners 8.6% (d = 0.48); OR 0.89 per extra 1% cut | Brechney 2021 (2.11) |
| Typical regain % | median 8-10% light divisions, 5.8% MW, ~3% HW; mean 9.5% (Bellator) | Faro 2023 (2.8), Peacock 2025 |
| Fight-night weight differential -> KO | heavier fighter more KO/TKO wins (international MMA, regional boxing) | Baribeau 2023 (2.9) |
| Win-method mix (ranked male MMA) | KO/TKO 44%, decision 33%, submission 23%; KO share rises with weight; women decision 46% | Ma 2025 (2.15) |
| Decision-tree win thresholds | > 0.85 sig ground strikes/min -> 91.5% win; > 4 sig ground strikes/bout -> 80.4%; + TD accuracy > 25% -> 84.9%; + > 4.19 strikes landed/min -> 96.3% | James 2017 (3.1) |
| Takedown accuracy winners vs losers | 50.9% vs 29.0% (d = 0.62); 50% vs 20% medians in 8,461 bouts | James 2017, Ma 2026 |
| Control time per successful takedown | winners 99.8 s, losers 78.9 s (mean ~90 s) | Ma 2026 (2.14) |
| Takedown density (modern men's UFC) | median ~0-0.07/min; declining -0.002 to -0.004/min/yr | Ma 2026 (2.14) |
| Significant strikes landed, winners vs losers | LW 42.4 vs 29.6 (d 0.86); WW 59 vs 24.8 (d 0.64); HW 66.5 vs 36.5 (d 0.84) per bout | Kirk 2018 (2.3) |
| Judge round-scoring weights (AME) | knockdown 0.238; sub attempt 0.096; reversal 0.062; TD landed 0.049; sig head 0.021; sig body 0.015; sig leg 0.013; non-sig landed 0.003; control 0.0009/s; missed TD ≈ -0.02 | Holmes 2022 (3.5) |
| Judge biases | home + crowd +3.6% round win; rank +10 places +3.4%; previous-round winner and betting favourite favoured | Holmes 2022, Gift 2018 |
| Home advantage (boxing, equal quality) | P(home win) 0.57 KO / 0.66 TKO / 0.74 points | Balmer 2005 (3.9) |
| Pre-fight predictability ceiling | 61.6% (Markov sim) ≈ bookmakers 61.2%; ML 62-67%; method-of-victory 39% | Holmes 2023, Yan 2024 |
| Betting market | no favourite-longshot bias; youth and travel under-priced | Miller & Nichols 2026 |
| Southpaw prevalence | 17-19% (MMA), 17% (male boxing), 12.5% (female boxing) | Richardson & Gilman 2019, Baker & Schorer 2013 |
| Southpaw advantage | P(superiority) 52.4-54.5% career-level; 64.0 vs 62.6% win rate n.s.; null in matched UFC fights -> per-fight bonus <= +2%, decays with opponent exposure | 3.13-3.16 |
| Expert vs novice anticipation | accuracy 83.3% vs 68.5% (SMD 1.24); RT SMD -1.00; fixations SMD -2.04; boxing RT SMD -0.51 | Zhang 2022 (4.1) |
| Expert vs novice recognition at -40 ms | 75.3% vs 64.3% accuracy; RT 811 vs 915 ms; fatigue +RT not -accuracy | Wu 2025 (4.7) |
| Simple RT | no expert advantage; choice/sport-specific RT only | Mori 2002 (4.2) |
| Beginner default reaction | defensive pattern (beginners) vs counter-attack pattern (experts) | Ottoboni 2015 (4.4) |
| Anxiety on gaze | novices' fixation count/locations rise more under anxiety | Williams & Elliott 1999 (4.3) |
| Punch force by tier (rear/lead) | elite 4,800/2,847 N; intermediate 3,722/2,283 N; novice 2,381/1,604 N | Smith 2000 (4.9) |
| Boxing punch landing rates | jab 0.28; cross/hooks 0.33-0.40; overall winners 0.33 vs losers 0.23; air-punch 0.17 vs 0.27 | Thomson & Lamb 2016, Dunn 2017 |
| Boxing defence success | footwork 0.70 (most effective); arm/trunk lower | Thomson & Lamb 2016 (5.3) |
| Boxing output | elite ~21 punches/min, 3.6 defences/min, 1.55 actions/s; amateur ~25 punches, ~10 defences/min | Davis 2018, Thomson & Lamb 2016 |
| Novice boxing winner margin | +18 landed punches per bout; block-and-counter 2.8 vs 0.1 | Davis 2013 (5.1) |
| Judge classification from accuracy | accuracy alone 76.9%; + movement 84.6% | Dunn 2017 (3.8) |
| MMA round phase budget | distance standing ~130-150 s per 5-min round; clinch-no-attack 10-13 s; distance head-strike accuracy ≈ 0.29 (WW: 7 of 24) | Miarka 2017 (5.7) |
| Round-3 pacing | low-intensity standing time falls from ~2:35 (R1-R2) to ~2:07 (R3) | Miarka 2016 (3.3) |
| Winner high-intensity time | ~58 s vs ~32 s per bout segment (1.8x) | Coswig 2019 (2.13) |
| KO mechanism | KOs mostly from combinations and counters; TKO always combinations, mostly ground-and-pound; 68.8% of hybrid-rules fights end < 5 min | Pinto 2020 (5.9) |
| Exchange initiation mix | ≈ 1/3 attack, 1/3 counter, 1/3 defensive action (taekwondo Markov) | Menescardi 2019 (5.10) |
| Grappling transitions (elite no-gi) | back-take -> submission 0.45; guard-pass chain 0.30; TD attempt -> sub attempt 0.15; sub attempts ≈ 1/match | Lamas 2024 (5.11) |

---

## 7. Weak or conflicting evidence

1. **Weight regain vs outcome.** Positive in large commission datasets (Faro OR 1.046; Baribeau +7%/+13% per 1%), null in small elite samples (Kirk 2020 d = 0.23; Peacock p = 0.80). None control for fighter skill. Treat as a small, capped effect.
2. **Reach advantage.** Consistent null on MMA win/loss (four Kirk studies); positive only in heavyweight (armspan +2.2 cm, r = 0.28) and in uncapped heavyweight boxing (Fiala). Widely quoted "reach-advantaged fighter wins 51.65%; -7 in reach wins 37%" figures come from a student analytics blog (Bruin Sports Analytics), not peer review, and were not used for parameters.
3. **Southpaw advantage.** Over-representation robust; advantage small in records-based samples (P-sup 52-55%) and null in matched-fight samples (Baker & Schorer; Pollet; Pollet & Riegman). Boxing-specific "southpaws win 10-15% more in title fights" claims circulating online could not be traced to a peer-reviewed source.
4. **Age curve.** Only direction (younger wins slightly, r = 0.18) and late-career output decline are peer-reviewed. "Peak age 27-32" and "win% peaks in career year 4 (64%) then declines" come from non-peer-reviewed sites and should be treated as design assumptions, not findings.
5. **Beginner behaviours (flinch, eye closure, turning away, square stance).** No combat-sport-specific quantitative study found. Indirect support only: beginners' automatic defensive response pattern (Ottoboni), novices' scattered gaze under anxiety (Williams & Elliott), generic startle-blink literature. Parameters here are judgement calls.
6. **Pressure vs counter styles.** No peer-reviewed head-to-head of pressure fighters vs counter fighters in MMA/boxing. Indirect: counters/combinations more effective for KOs (Pinto 2020, hybrid rules), block-and-counter associated with novice boxing wins (Davis 2013), counters ~1/3 of initiations in taekwondo (Menescardi).
7. **Judging weights.** The AME vector comes from a PhD thesis (Holmes 2022), examined but not journal-reviewed; the peer-reviewed Gift (2018) and Collier (2012) papers agree on the ordering (knockdowns/damage first, missed takedowns negative) but their coefficients were not accessible.
8. **Collier et al. height effect.** The one study reporting height as a significant predictor of winning decisions (Collier 2012) is a fight-level probit in a book chapter, contradicting the Kirk datasets; treat as low weight.
9. **ML accuracy claims.** Peer-reviewed figures (62-67%) are close to bookmakers; higher accuracies (70-80%) circulate in course projects and a withdrawn preprint (FightTracker, arXiv 2312.11067, withdrawn by author) and were excluded.
10. **Small-n tactical studies.** Coswig 2019 (n = 15), Bhumipol 2023 (n = 8), Folhes 2023 (n = 20), Dunn 2017 (19 bouts) give direction and rough magnitudes only.
11. **The Sport Journal papers** (Ma 2025 win-method mix) are peer-reviewed but low-tier and based on ranked athletes (survivorship); use for method-of-victory proportions only, cross-checked against Pinto 2020.
