# FIGHT_DATA — Baseline Fight Statistics for Simulator Calibration

Compiled 2026-09-22. Every number carries a source URL. Tags: **[S]** = read from the cited source (page fetched or search-engine excerpt of that page, the latter marked "[snippet]"), **[D]** = derived arithmetically from sourced numbers (arithmetic shown), **[E]** = ESTIMATE — our own judgement, anchored where possible; treat as a tunable default, not a fact. Where sources conflict both are listed. Nothing is invented.

Related discipline files in this folder (technique-level, not duplicated here): `BOXING.md`, `MUAY_THAI_KICKBOXING.md`, `WRESTLING.md`, `JUDO.md`, `SUBMISSION_FINISH_DATA.md`, `LIT_A_performance_biomech_physio_injury.md`.

---

## 1. Summary

<!-- SUMMARY_PLACEHOLDER -->

---

## 2. Statistics by topic

### 2.1 Striking

Source keys used below: **[PI1]** UFC Performance Institute, *A Cross-Sectional Performance Analysis and Projection of the UFC Athlete* Vol 1 (2018), ~3,900 bouts 2002–2017 — https://media.ufc.tv/ufcpi/UFCPI_Book_2018.pdf · **[PI2]** UFC PI Vol 2 (2021), §1 Competition Analysis, 1,443 bouts 2017–2019 — https://media.ufc.tv/ufcpi/UFC_PI-CrossSectionalAnalysis_Volume2_2021.pdf (via https://www.ufcpi.com/journal) · **[GH]** computed by our research agent from the open UFCStats scrape (round-by-round per-fighter stats, all UFC through UFC 331, 19 Sep 2026; 5-minute-round bouts only; "pooled" = Σstrikes/Σminutes across fighter-fights) — https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fight_stats.csv · **[CQ]** CageQuant medians for fighters with 5+ UFC appearances — https://www.cagequant.com/learn/ufc-fighter-stats-explained · **[HUT]** Hutchison et al. 2014, Am J Sports Med, 844 UFC bouts 2006–12 — https://journals.sagepub.com/doi/abs/10.1177/0363546514526151 (mirror https://d.docksci.com/head-trauma-in-mixed-martial-arts_5af2d214d64ab2d50bc0a74d.html) · **[HTE]** Mańka-Malara et al. 2022, 2,488 UFC fights 2000–21 — https://pmc.ncbi.nlm.nih.gov/articles/PMC9603147/ · **[FSM]** Fightshow strike map, 646,947 sig strikes to 19 Sep 2026 — https://fightshow.pro/analysis/strike-map · **[FN]** Fightnomics (Reed Kuhn, 2013; FightMetric data to Apr 2013) full text — https://archive.org/stream/pdfy-yiL1jFk4ZOeZkg4d/Fightnomics+%5BThe+Hidden+Numbers+And+Science+Of+Martial+Arts%5D_djvu.txt

| Statistic | Value | Population / era | Source |
|---|---|---|---|
| **Output** | | | |
| Median SLpM / SApM | 3.42 / 3.33 [S] | UFC fighters 5+ fights | [CQ] |
| Pooled SLpM (= SApM per fighter) | 3.83 (2015–26); 4.02 (2020–26); 3.56 (2005–26) [S-computed] | UFC | [GH] |
| Per-fighter-fight SLpM mean / median | 4.18 / 3.53 [S-computed] | 2015–26 | [GH] |
| Sig strikes attempted per fighter per min | 8.36 (2015–26); 8.48 (2020–26); 7.96 (2005–26) [S-computed] | UFC | [GH] |
| Sig attempted / landed per min | 8.56 / 3.73 in 30-ft cage (n=1,398); 9.09 / 4.57 in 25-ft cage (n=174) [S] | 2017–19 | [PI2] p.27 |
| Men: sig landed/min; total landed/min; total attempted/min | 3.4 ; 4.9 ; 9.2 [S] | 2002–17 | [PI1] Table 1.3 |
| Women: same | 4.2 ; 6.2 ; 11.6 [S] | 2002–17 | [PI1] Table 1.3 |
| Sig head strikes landed/min | men 2.2, women 2.8 [S] | 2002–17 | [PI1] |
| Strikes attempted/min over time | 4.25 (2002) → 8.5 (2017) [S]; Fightnomics: 2.8 SSApM in 1990s → 7.1 since 2008; 9.3 total strikes/fighter/min [S] | UFC | [PI1] Fig 1.6; [FN] |
| Strikes attempted/min by class | HW 6.72 · LHW 7.43 · MW 7.07 · WW 7.62 · LW 7.69 · FW 7.81 · BW 8.12 · FLW 6.98 · W-BW 8.87 · W-SW 8.90 [S] | 2002–17 | [PI1] Fig 1.7 |
| SLpM by class (pooled) | FLW 3.45 · BW 3.85 · FW 3.96 · LW 3.94 · WW 3.70 · MW 3.73 · LHW 3.86 · HW 3.74 · W-SW 4.07 · W-FLW 4.01 · W-BW 3.68 · W-FW 3.61 [S-computed] | 2015–26 | [GH] |
| SLpM by class (pooled, recent) | FLW 3.81 · BW 4.02 · FW 4.09 · LW 4.27 · WW 4.04 · MW 3.95 · LHW 4.08 · HW 3.92 · W-SW 3.99 · W-FLW 3.99 · W-BW 3.72 [S-computed] | 2020–26 | [GH] |
| Sig attempted/min by class (pooled) | FLW 7.77 · BW 8.65 · FW 8.75 · LW 8.56 · WW 8.12 · MW 7.91 · LHW 7.82 · HW 7.53 · W-SW 9.13 · W-FLW 9.30 · W-BW 8.05 · W-FW 7.61 [S-computed] | 2015–26 | [GH] |
| Winner vs loser SLpM by class | FLW 3.59/2.33 · BW 4.31/3.13 · FW 4.99/3.29 · LW 4.44/2.89 · WW 4.10/2.82 · MW 4.11/2.76 · LHW 3.99/2.58 · HW 4.26/2.89 · W-SW 5.20/3.39 · W-FLW 4.48/3.49 · W-BW 4.43/3.40 · W-FW 4.88/2.44 [S] | 2017–19 | [PI2] Fig 1.3B |
| Winner vs loser sig attempts/min by class | FLW 7.84/6.56 · BW 9.40/7.25 · FW 10.61/8.71 · LW 9.25/7.25 · WW 8.83/7.35 · MW 8.68/6.64 · LHW 7.72/5.90 · HW 8.16/6.60 · W-SW 11.25/8.86 · W-FLW 10.37/9.39 · W-BW 9.51/8.31 · W-FW 9.10/6.92 [S, PDF-extraction caveat] | 2017–19 | [PI2] Fig 1.3A |
| Lighter divisions vs HW volume | Lighter divisions throw 10.7% more sig strikes than HW at identical landing rates [S] | UFC | https://fightstats.online/ |
| Small-cage effect | Fighters throw >20% more strikes/min in the smaller WEC/TUF cage, and finish more [S] | UFC/WEC | [FN] |
| **Accuracy and defence** | | | |
| Median sig-strike accuracy | 45% [S]; pooled 45.8% (2015–26), 47.4% (2020–26), 44.8% (2005–26) [S-computed]; men 45.1% / women 45.0% [S]; overall 45% [S]; Fightnomics 42% (since 2005) / 41% [S] | UFC | [CQ]; [GH]; [PI1]; [FSM]; [FN] |
| Total-strike accuracy | men 52.6% / women 53.3% [S]; pooled 52.8% [S-computed] | UFC | [PI1]; [GH] |
| Accuracy 30-ft vs 25-ft cage | 43.6% vs 50.3% [D from PI2 row] | 2017–19 | [PI2] |
| Winner vs loser accuracy | Pooled 50.1% vs 40.9% [S-computed]; by class (W/L %): FLW 46/36 · BW 46/38 · FW 47/38 · LW 48/40 · WW 46/38 · MW 47/42 · LHW 52/44 · HW 52/44 · W-SW 46/38 · W-FLW 43/37 · W-BW 47/41 · W-FW 54/35 [S] | 2015–26; 2017–19 | [GH]; [PI2] Fig 1.9 |
| Accuracy by class (pooled) | FLW 44.4 · BW 44.5 · FW 45.2 · LW 46.0 · WW 45.6 · MW 47.2 · LHW 49.3 · HW 49.6 · W-SW 44.6 · W-FLW 43.2 · W-BW 45.6 (%) [S-computed] | 2015–26 | [GH] |
| Accuracy by target | head 37.5% · body 69.1% · leg 81.1% (2015–26); head 38.8 · body 70.7 · leg 82.1 (2020–26) [S-computed] | UFC | [GH] |
| Accuracy by position | distance 41.6% · clinch 71.6% · ground 71.8% (2015–26); 43.8 / 73.8 / 71.9 (2020–26) [S-computed]; distance 40% · clinch 70% · ground 69% [S] | UFC | [GH]; [FSM] |
| Accuracy by position × target | Distance: head 31% · body 63% · leg 80%; Clinch: 58 / 86 / 91%; Ground: 67 / 94 / 87% [S] | 646,947 sig strikes to Sep 2026 | [FSM] |
| UFC's own model | Standing head strikes land ≈33%; ground body strikes ≈93% [S] | UFC 2025 | https://www.ufc.com/news/does-striking-accuracy-accurately-measure-striking |
| Fightnomics distance accuracy | Distance power head strikes: mean 25% (SD 7.8%, 16–32% covers ~68% of fighters); jab (head) 29%; clinch: all strike types >80% except power head ≈50%; ground: body jab 97%, head jab 89%, head power 81%, body power 83%, leg 92–94% [S] | UFC to 2013 | [FN] |
| Striking defence | Median 54% [S]; pooled 54.2% (2015–26), 52.6% (2020–26) [D = 100 − opponent accuracy] | UFC | [CQ]; [GH] |
| **Per-fight volumes; total vs significant** | | | |
| Per fighter-fight | sig landed mean 42.3 / median 35; sig attempted 92.2; total landed 59.1; total attempted 111.9 (2015–26); 44.4 / 36 ; 93.7 ; 62.1 ; 114.6 (2020–26) [S-computed] | UFC | [GH] |
| Ratio sig:total landed | 0.715 (2015–26); 0.684 (2005–26) [S-computed]; 3.4/4.9 = 0.69 [D] | UFC | [GH]; [PI1] |
| Ratio sig:total attempted | 0.824 [S-computed] | 2015–26 | [GH] |
| Total strikes landed / attempted per min | 5.36 / 10.14 [S-computed] | 2015–26 | [GH] |
| Winner vs loser sig landed per fight | 50.6 vs 33.8 (all W/L); decisions 68.3 vs 48.9 (median 62 vs 42) [S-computed] | 2015–26 | [GH] |
| Mean bout duration by class | FLW 11:14 · BW 11:10 · FW 11:47 · LW 10:39 · WW 11:22 · MW 11:06 · LHW 9:13 · HW 9:40 · W-SW 12:45 · W-FLW 12:04 · W-BW 12:47 · W-FW 11:44 [S]; +30.3 s per weight class step down (2002–17) [S] | 2017–19; 2002–17 | [PI2] Fig 1.1; [PI1] p.19 |
| **Strike distribution** | | | |
| Share of attempts by target | head 77.98% · body 13.07% · legs 8.95% [S]; head 77.0 / body 13.8 / leg 9.1% [S-computed]; Fightnomics "80-10-10" standing, body share rising 6.1% (2002–07) → 9.2% (2008+) → 10% (2013) [S] | 2017–19; 2015–26; 2013 | [PI2] Fig 1.8; [GH]; [FN] |
| Share of landed by target | head 63.0% · body 20.9% · leg 16.2% [S-computed] | 2015–26 | [GH] |
| Share of landed by position | distance 77.9% · clinch 11.3% · ground 10.8% (2015–26); 80.8 / 9.8 / 9.5 (2020–26); 74.6 / 12.9 / 12.5 (2005–26) [S-computed]; strike map: distance head 46%, distance body 14%, distance leg 15%, clinch 13%, ground 12% [S] | UFC | [GH]; [FSM] |
| Share of attempts by position | distance 85.9% · clinch 7.2% · ground 6.9% [S-computed] | 2015–26 | [GH] |
| Fight time by position | distance 61/60/62% · clinch 15/14/15% · misc ground 9/10/10% · guard 6/6/5% · half guard 3/4/3% · back control 2/2/3% · side control 2/2/1% · mount 1/1/1% (2017/18/19) [S]; Fightnomics: clinch 18% of fight time (2013) [S] | UFC | [PI2] Fig 1.2; [FN] |
| Clinch strikes trend | −27% per fighter since 2015 [S] | UFC | https://fightstats.online/ |
| Punch / kick / knee / elbow split of sig strikes | **Not published** (UFCStats codes target/position, not strike type). Proxies: KO-causing strike = punch 84.6% (55/65), knee 6.2%, shin kick 4.6%, foot kick 3.1%, heel 1.5% [S]; punches' share of strike finishes 77.4% (2003–04) → 86.1% (2023–24), kicks 20.5% → 11.3% [S]; ground finishes: punches+elbows 82%, elbows 14%, knees 3% [S] | UFC | [HUT]; https://www.mdpi.com/2076-3417/16/4/2034 ; [FN] |
| Finish-method share by class (punches / elbows / knees / kicks, % of finishes) | HW 67.4/4.2/3.4/4.2 · LHW 56.7/3.2/5.3/4.0 · MW 41.9/5.1/4.8/6.6 · WW 41.8/4.9/7.1/4.6 · LW 33.9/2.5/3.3/6.8 · FW 49.0/2.0/4.8/2.0 · BW 39.6/3.0/3.0/2.2 · FLW 39.3/3.6/3.6/1.8 · W-BW 28.9/15.8/7.9/7.9 · W-SW 13.8/3.4/0.0/3.4; all-class punches 45% [S] | 2002–17 | [PI1] Table 1.1 |
| Strike-finish share by class, recent | HW punches 57.9%, knees 8.7%, elbows 7.2% · LHW punches 50%, elbows 7.5%, knees 6.3% · MW punches 48.1%, kicks 12.9% · WW punches 46.9%, knees 8.8%, kicks 7.9% · LW punches 43.6%, knees 7.3%, kicks 6.4% · FW punches 49.3% · BW punches 33.8%, elbows 7.4%, kicks 7.4% · FLW punches 40.6%, kicks 6.3% · W-SW punches 23%, kicks 3.8% · W-FLW punches 17.4%, elbows 8.7% · W-BW punches 47.6%, elbows 9.5%, kicks 9.5% [S] | 2017–19 | [PI2] p.25 |
| Fight-ending punch type | Rear straight 29.2% (77/271) · lead hook 26.9% · rear hook 23.9%; hooks 51%, straights 35% in follow-up [S] | UFC KO/TKOs 2020–22 | https://journals.sagepub.com/doi/10.1177/17479541241296615 ; https://doi.org/10.1177/17479541251338509 |
| **Knockdowns** | | | |
| Knockdowns per fighter per 15 min | 0.298 (2015–26); 0.296 (2020–26); 0.308 (2005–26) [S-computed]; "1 KD per 48:29 of cage time" = 0.309/15 min [S] | UFC | [GH]; https://x.com/numbersmma/status/1412147698275336192 |
| Knockdowns per fighter-fight / per fight | 0.219 / 0.439 (2015–26); per fight 0.436 (2020–26) [S-computed] | UFC | [GH] |
| Share of fights with ≥1 KD | 36.2% (2015–26); distribution 0/1/2/3/4+ KDs = 63.8 / 30.0 / 5.0 / 1.0 / 0.2% [S-computed]; 2026 season 43.9% (154/351, "highest in 15 years") [S] — conflict (era/denominator) | UFC | [GH]; https://fightstats.online/ |
| KD per 15 min by class (per fighter) | FLW 0.285 · BW 0.323 · FW 0.330 · LW 0.311 · WW 0.362 · MW 0.352 · LHW 0.439 · HW 0.333 · W-SW 0.103 · W-FLW 0.098 · W-BW 0.118 [S-computed] | 2015–26 | [GH] |
| % fights with ≥1 KD by class | FLW 34.5 · BW 38.7 · FW 39.9 · LW 37.1 · WW 41.8 · MW 41.3 · LHW 46.1 · HW 38.5 · W-SW 15.7 · W-FLW 15.4 · W-BW 18.3 [S-computed] | 2015–26 | [GH] |
| Knockdown rate per landed distance power head strike | UFC avg 3.9% (1 per ~26); rises monotonically with weight class (FLW–FW below avg, WW at avg, MW–HW above); R1 5.3% → R2 2.4% → R3 1.5%; clinch power head strikes have a much lower KD rate [S] | UFC to 2013 | [FN] |
| KDs per 100 sig strikes landed | all 0.52; FLW 0.55 · BW 0.56 · FW 0.56 · LW 0.53 · WW 0.65 · MW 0.63 · LHW 0.76 · HW 0.59 · W-SW 0.17 · W-FLW 0.16 · W-BW 0.21 [S-computed] | 2015–26 | [GH] |
| KDs per 100 HEAD sig strikes landed | all 0.82; LHW 1.20 · WW 1.03 · MW 0.98 · HW 0.92 · BW 0.90 · FW 0.88 · FLW 0.87 · LW 0.83; women 0.26–0.35 [S-computed] | 2015–26 | [GH] |
| Ranked-fighter KD rates | KD/15 min 0.51; KDs allowed/15 min 0.19 (snippet, unverified); ranked FLW 0.45 [S] | ranked UFC c.2021–22 | https://fightforecast.substack.com/p/deiveson-figueiredo-has-shown-uncommon |
| KD → finish conversion | Of fights with ≥1 KD: 64.6% end KO/TKO (2015–26), 65.4% (2020–26), 63.8% (2005–26); any finish 73.8% [S-computed] | UFC | [GH] |
| KD → same-round KO/TKO | 56.5% of fighter-rounds with a KD end with the KD scorer winning by KO/TKO in that round (n=1,254); per KD event 57.5% (n=1,375) [S-computed] | 2015–26 | [GH] |
| Fighter scoring ≥1 KD | wins 85.8%; wins by KO/TKO 60.9% (n=1,185) [S-computed] | 2015–26 | [GH] |
| KO/TKO fights containing a KD | 73.9%; winner scored ≥1 KD in 72.3% (n=998) [S-computed] | 2015–26 | [GH] |
| KD-fight → KO/TKO by class | FLW 53.2 · BW 57.7 · FW 59.3 · LW 67.0 · WW 65.4 · MW 69.3 · LHW 74.5 · HW 83.9 · W-SW 43.9 · W-FLW 46.5 · W-BW 52.5 (%) [S-computed] | 2015–26 | [GH] |
| Judging | Each extra knockdown ↔ +5.6 pp chance of a 10–8 round (5,976 judge-rounds 2016–19) [S] | UFC | https://agentmma.com/mma-lab/ufc-knockdown-definition |
| **Strikes before KO/TKO; head-strike exposure** | | | |
| KO/TKO fights: winner sig landed | mean 37.7 / median 29 (2015–26, n=998); 38.3 / 29 (2020–26); 33.4 / 25 (2005–26) [S-computed] | UFC | [GH] |
| KO/TKO fights: winner HEAD sig landed | mean 26.9 / median 20 [S-computed] | 2015–26 | [GH] |
| KO/TKO fights: loser sig absorbed; loser head sig absorbed; loser total absorbed | 19.6 / 13 ; 11.1 / 6 ; 24.8 (mean/median) [S-computed] | 2015–26 | [GH] |
| KO/TKO fights: winner head-sig per minute | mean 6.02 / median 4.46 [S-computed] | 2015–26 | [GH] |
| KO/TKO fight duration | mean 6.12 / median 4.85 min [S-computed]; 6.0 min [S] | 2015–26; 2014–26 | [GH]; fightalpha |
| Strikes in final 30 s before TKO | mean 18.5 (5–46), 92.3% to head; "5–10 in last 10 s" [S] | 2006–12 | [HUT] |
| Post-KO strikes; time to stoppage | 2.6 extra head strikes (0–20); 3.5 s (0–20 s) [S] | 2006–12 | [HUT] |
| KO location | mandible 53.9%, maxilla 20.0%, temporal 20.0%; highest risk in first minute of a round [S] | 2006–12 | [HUT] |
| Sig head strikes absorbed per minute (per fighter) | mean 2.41, median 1.67 (0–51); men 2.37, women 2.95 [S]; head sig landed per fighter-fight 26.6, per min 2.41, attempted/min 6.44 (2015–26) [S-computed] | UFC 2000–21; 2015–26 | [HTE]; [GH] |
| Total head strikes per minute | 6.30 (men 6.20, women 7.73) [S] | UFC 2000–21 | [HTE] |
| Fights ended by head trauma | 31.6% of all; 88.1% of 855 KO-ended fights; men 32.2% vs women 23.1%; by class FLW 12.5% · BW 28.7% · LHW 38% · HW 54% [S] | UFC 2000–21 | [HTE] |
| **Power by weight class** | | | |
| KO/TKO % by class (5-min-round bouts) | FLW 22.6 · BW 26.9 · FW 30.2 · LW 32.1 · WW 33.3 · MW 38.7 · LHW 46.3 · HW 45.6 · W-SW 13.2 · W-FLW 15.7 · W-BW 19.3 [S-computed] | 2015–26 | [GH] |
| Win methods by class (DEC / KO-TKO / SUB %) | FLW 54.3/24.3/21.4 · BW 55.3/24.3/20.4 · FW 53.7/30.2/16.0 · LW 49.3/33.6/17.1 · WW 50.4/34.6/14.9 · MW 46.5/35.4/18.1 · LHW 34.4/45.9/19.7 · HW 35.5/49.5/15.0 · W-SW 72.9/9.4/17.1 · W-FLW 66.7/11.6/21.7 · W-BW 58.8/27.5/13.7 · W-FW 41.7/33.3/25.0; pooled 51.05/31.45/17.50 [S] | 2017–19 | [PI2] Fig 1.6–1.7 |
| PI1 finish rates by class | HW 73.5 · LHW 62 · MW 61.1 · WW 52.5 · LW 50.5 · FW 45 · BW 49.8 · FLW 39.7 · W-BW 45.9 · W-SW 34.1 (%); HW KO/TKO 60.1% with the lowest strike rate (6.72/min); W-SW 7.1% KO, 27.1% sub, 65.9% dec [S] | 2002–17 | [PI1] p.14–16 |
| KO/TKO per 100 sig strikes landed (both fighters) | FLW 0.28 · BW 0.30 · FW 0.34 · LW 0.39 · WW 0.40 · MW 0.49 · LHW 0.64 · HW 0.64 · W-SW 0.13 · W-FLW 0.15 · W-BW 0.21 [S-computed] | 2015–26 | [GH] |
| KO/TKO per 100 HEAD sig strikes landed | FLW 0.44 · BW 0.49 · FW 0.53 · LW 0.61 · WW 0.64 · MW 0.77 · LHW 1.01 · HW 0.99 · W-SW 0.21 · W-FLW 0.25 · W-BW 0.34 [S-computed] | 2015–26 | [GH] |
| Head-strike KO/TKO per 100 AE (regional) | HW 29.1 · LHW 25.0 · WW 19.0 · MW 18.5 · FW 16.1 · LW 15.1 · BW 12.7 · FLW 11.7; overall 16.7 [S] | 1,473 Australian bouts 2020–23 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11569551/ |
| Winners' combined offensive success | HW 56% (max) vs W-SW/W-BW 41% (min); winners 16–32 pp above losers [S] | 2017–19 | [PI2] p.24 |
| Landmine punch-throw peak power (W) | HW 1777 · LHW 1677 · MW 1676 · WW 1826 · LW 1525 · FW 1868 · BW 1408 · FLW 1218 · W-FW 1632 · W-BW 940 · W-FLW 930 · W-SW 990 [S, label pairing approximate] | UFC PI athletes | [PI2] Fig 11.3 |
| KPI ranking | 72% of top-5 KPIs per class are striking metrics; "total strikes landed" = #1 KPI for men and women [S] | 2002–17 | [PI1] p.16–17 |
| Win-method trend | KO/TKO 54.7% (2002) → 31.9% (2017); decisions 28.3% → 50.3% [S] | UFC | [PI1] p.14 |

Notes: (a) UFC PI per-minute figures are per fighter, not per bout (verified against per-fighter rates computed from UFCStats within ~0.5/min). (b) Accuracy conflict: CageQuant/PI/scrape ≈45–47% vs Fightnomics 41–42% (2013 data) vs one blog's "~40% of punches" — the modern value is 45–47%. (c) [PI2] Fig 1.3A attempted-strike pairs and Fig 11.3 power values were recovered from PDF text order; 1.3A cross-validates against Fig 1.9 except BW loser (7.25 implies 43% vs printed 38%). (d) fightstats.online's 43.9% KD-fight share for 2026 vs 36% pooled 2015–26 may be a real uptick plus a definitional difference.

### 2.2 Grappling

Additional keys: **[GH-G]** computed by our research agent from the same UFCStats scrape (https://github.com/Greco1899/scrape_ufc_stats), bouts from 2008 with full round stats, n = 8,048 bouts (16,096 fighter-bouts, 3,839 decisions); "per fighter per 15 min" = (Σ both fighters ÷ 2) ÷ fight minutes × 15. · **[BMC]** takedown-density paper, 8,461 UFC bouts 1997–2025 — https://pmc.ncbi.nlm.nih.gov/articles/PMC13523191/ · **[RM]** Roy & Murphy video-coded 91 UFC FLW/BW/FW bouts 2014–15 — https://www.cambridgepublish.com/css/article/download/243/250/797 · **[JAM]** James et al. 2016, 234 UFC male bouts 2014 — https://vuir.vu.edu.au/31281/1/James%20et%20al%20(2016).pdf · **[FA-S]** FightAlpha submissions, 1,695 subs to Jun 2026 — https://fightalpha.com/articles/most-common-ufc-submissions

| Statistic | Value | Population / era | Source |
|---|---|---|---|
| **Takedowns** | | | |
| TD attempts per fighter per 5-min round | 1.5 (≈4.5 per 15 min); ≈1 attempt per minute spent in the clinch [S] | UFC 2008–Apr 2013 (>8,000 attempts) | [FN] |
| TD landed / attempted per fighter per 15 min (pooled) | **1.47 / 3.99; accuracy 36.9%; implied TDD 63.1%** [S-computed] | UFC 2008–26 | [GH-G] |
| Same by era | 2008–13: 1.70 / 4.40 (38.7%) · 2014–19: 1.41 / 3.89 (36.3%) · 2020–26: 1.42 / 3.90 (36.4%) [S-computed] | UFC | [GH-G] |
| TD landed per 15 min, league median (fighters 5+ bouts) | 1.38; accuracy median 40%; defence median 63% [S] | UFC 2026 | [CQ] |
| TD accuracy / defence (Fightnomics) | 39–40% success → 60% defence benchmark; shooting <1 in 3, lower-body clinch higher, upper-body clinch highest; shooting ≈50% of attempts, upper-body clinch <10% [S] | UFC 2008–13 | [FN] |
| TD success KPI mean | 43.2% all / 46.3% women / 39.5% men (per-fighter mean, inflates small samples) [S] | 2002–17 | [PI1] Table 1.3 |
| TD landed per fighter per 15 min by men's class | FLW 1.79 · BW 1.54 · FW 1.56 · LW 1.58 · WW 1.48 · MW 1.44 · LHW 1.34 · HW 1.17 [S-computed] | 2008–26 | [GH-G] |
| TD attempted per fighter per 15 min by men's class | FLW 4.84 · BW 4.35 · FW 4.21 · LW 4.32 · WW 3.98 · MW 3.98 · LHW 3.69 · HW 3.07 [S-computed] | 2008–26 | [GH-G] |
| TD accuracy by men's class | FLW 37.0 · BW 35.3 · FW 37.2 · LW 36.5 · WW 37.2 · MW 36.3 · LHW 36.2 · HW 38.2% [S-computed] | 2008–26 | [GH-G] |
| Women's classes (landed / attempted per 15; accuracy) | W-SW 1.36 / 3.71 / 36.7% · W-FLW 1.29 / 3.30 / 39.2% · W-BW 1.24 / 3.18 / 39.1% · W-FW 0.94 / 3.32 / 28.2% (n=30) [S-computed] | 2008–26 | [GH-G] |
| TD density per fighter-bout (median / P75 / P90, TD·min⁻¹) | FLW 0.067/0.200/0.344 · BW 0/0.133/0.279 · FW 0/0.149/0.333 · LW 0/0.200/0.333 · WW 0/0.158/0.328 · MW 0/0.162/0.333 · LHW 0/0.133/0.333 · HW 0/0.120/0.299 (P90 ≈ 4.2–5.2 TD/15 min); women SW/FLW/BW/FW medians 0.067/0.067/0.020/0 [S] | 8,461 UFC bouts 1997–2025 | [BMC] |
| TD density trend | −0.00426 TD·min⁻¹ per year (1997–2025, r=−0.753) [S] | UFC | [BMC] |
| Lighter-class video-coded TDs | 323/1,023 = 31.6% success; lower-body 39.8%, upper-body 13.8%, combined 44%; 4.33 attempts per round (both) [S] | 91 UFC bouts 2014–15 | [RM] |
| Slam rate per landed TD | 9.4%; clinch TDs slammed 2–3× more than shots [S] | UFC 2008–13 | [FN] |
| TDs reaching half guard | "less than half" of landed TDs [S] | UFC | [FN] |
| **Takedowns per fight distribution** | | | |
| TD landed per bout (both fighters) | mean 2.13; median 2; P75 3; P90 5; 0: 28.5% · 1: 21.3% · 2: 16.4% · 3: 11.4% · 4: 8.3% · 5: 5.9% · 6+: 8.2% [S-computed] | 2008–26 | [GH-G] |
| Bouts with zero TD landed / zero attempts | 28.5% / 12.5%; zero-TD share by era 24.1% → 28.6% → 30.5% [S-computed] | UFC | [GH-G] |
| Zero-TD bouts by class | FLW 20.6 · BW 28.1 · FW 26.9 · LW 27.1 · WW 27.9 · MW 29.9 · LHW 38.5 · HW 43.5%; W-SW 17.4, W-FLW 17.1, W-BW 21.5% [S-computed] | 2008–26 | [GH-G] |
| Per fighter-bout | 54.9% land zero TDs; mean 1.06 landed [S-computed]; median TD density 0 in every men's class except FLW [S] | UFC | [GH-G]; [BMC] |
| **Submissions** | | | |
| Sub attempts per 15-min fight (both) | "1–2" [S]; computed 0.70 per bout / 0.48 per fighter per 15 min; era 1.02 → 0.64 → 0.58 per bout; 59.6% of bouts have zero attempts [S-computed]; median fighter 0.6 per 15 min [S] | UFC 2007–12; 2008–26; 2026 | [FN]; [GH-G]; [CQ] |
| Sub attempts per fighter per 15 min by class | FLW 0.63 · BW 0.48 · FW 0.53 · LW 0.56 · WW 0.47 · MW 0.51 · LHW 0.36 · HW 0.31 [S-computed] | 2008–26 | [GH-G] |
| Sub finish rate per attempt | 20% ("one in five"); RNC >40%; guillotine/shoulder locks "very low" despite ≈2× RNC's attempts [S]; UFC average 21% overall, 23% of wins by sub [S]; computed finishes ÷ logged attempts 1,471/5,601 = 26.3% (20.1% 2008–13 → 30.0% 2020–26; HW 35.0, LHW 34.6, MW 28.4, LW 26.3, BW 26.5, WW 23.8, FLW 22.2, FW 20.9%) [S-computed; UFCStats logs only locked-in attempts] | UFC | [FN]; [GH-G] |
| Sub success by round | R3 attempts succeed at "barely half" the R1–R2 rate [S] | UFC 2007–12 | [FN] |
| LW vs HW | Lightweights attempt ≈2× as many subs; locked-in share >2× HW [S] | UFC | [FN] |
| Share of fights ending by submission | 19.4% (1,695/8,745) [S]; 19.3% [S]; 20.0% all-time, 17.9% 2014–20 [S] | UFC | [FA-S]; grapplerhq; https://www.mmahive.com/ufc-submission-statistics/ |
| Finishing-submission mix | RNC 38.9% (659) · guillotine 17.6% (299) · armbar 11.9% (202) · arm-triangle 7.7% (130) · triangle 5.5% (94) · D'Arce 2.8% · kimura 2.7% · anaconda 2.4% · heel hook 1.4% · kneebar 1.2%; top-5 = 81.7% [S]; chokes 78.8%, arm joint-locks 15.0%, leg locks 3.3% [S] | UFC to Jun 2026 | [FA-S]; grapplerhq |
| Choke study | 904 fight-ending chokes = 76.2% of subs, 15.5% of all outcomes; RNC 49.1% of chokes, guillotine 13.7%, arm-in guillotine 9.7%, triangle 8.8%, arm-triangle 8.2%; ~11% of chokes rendered opponent unconscious [S] | UFC 1993–2020 | https://combatsportslaw.com/2020/12/26/physician-reviews-and-analyzes-all-choke-submissions-in-ufc-history/ |
| Sub share by class | Athlete-record means: overall 23.0%; FLW 37.4%, HW 14.2% [S]; W-SW highest sub-win share 27.1% [S] | ranked athletes 2022; 2002–17 | https://thesportjournal.org/article/the-correlation-between-weight-divisions-and-methods-used-by-winning-mixed-martial-arts-athletes/ ; [PI1] |
| **Control time and phase time-share** | | | |
| Control time per fighter per bout | mean 2.17 min; median 0.95; P75 3.2; P90 6.3; control (both) = 40.1% of fight time; era 47.1% → 39.0% → 37.8% [S-computed] | 2008–26 | [GH-G] |
| Control time per fighter per bout by class | FLW 2.33 · BW 2.08 · FW 2.18 · LW 2.15 · WW 2.31 · MW 2.06 · LHW 1.82 · HW 1.76 min; W-SW 2.64, W-FLW 2.54, W-BW 2.97 [S-computed] | 2008–26 | [GH-G] |
| Winners vs losers, all bouts | control 2.98 vs 1.37 min; TD landed 1.46 vs 0.67; TD attempted 3.22 vs 2.55; sub att 0.49 vs 0.21; ground sig strikes 7.7 vs 1.7; pooled TD accuracy 45.4% vs 26.1% [S-computed] | 2008–26 | [GH-G] |
| Winners vs losers, decisions | control 4.3 vs 1.9 min; TD landed 2.11 vs 0.90 [S-computed]; medians TD density 0.067 vs 0; TD success 50% vs 20%; control per TD 99.8 s vs 78.9 s [S]; TD accuracy 50.9 ± 32.5% vs 29.0 ± 34.7% (d = 0.62) [S] | UFC | [GH-G]; [BMC]; [JAM] |
| Time in total control (KPI mean) | 12.8 s/min all (women 14.1, men 11.5) [S, column mapping approximate] | 2002–17 | [PI1] Table 1.3 |
| Fight time by phase | 2013: ≈50% distance / 18% clinch / <33% ground; 2001: ~26% distance / 16% clinch / 58% ground [S]; 2017–19: distance 60–62%, clinch 14–15%, ground positions 23–26% [S]; lighter classes 2014–15: standing 49.6%, ground 36.2%, clinch 13.4%; cage time 20.9% [S] | UFC | [FN]; [PI2] Fig 1.2; [RM] |
| Keeping-distance / clinch / ground time per round by division | Keeping distance lowest FW 131.4 s, BW 127.9 s; clinch-without-attack highest FLW 11.4 s, WW 12.6 s; BW most ground strikes (8 ± 10 landed/round) [S] | 2,814 UFC rounds | https://www.sciencedirect.com/science/article/abs/pii/S0167945717305328 |
| Standing low-intensity time per round (median) | R1 2:33.5 · R2 2:37 · R3 2:07; winners > losers in strikes, subs and positional improvements every round [S] | 645 UFC rounds | Miarka 2016 JSCR https://api.crossref.org/works/10.1519/jsc.0000000000001287 |
| Ending vs non-ending rounds | Standing low-intensity 91.5 ± 71.4 s (R1 endings) / 93.4 ± 67.5 (R2) / 143.2 ± 87.4 (R3); KO/TKO ≈60% of ending rounds; submissions >30% of R1–R2 endings [S] | 1,564 rounds, 678 bouts | Miarka 2018 JSCR DOI 10.1519/jsc.0000000000001804 |
| **Reversals, passes** | | | |
| Reversals per bout (both) | 0.26; 82.7% of bouts have none; FLW 0.39 · BW 0.32 · FW 0.34 · LW 0.25 · WW 0.25 · MW 0.22 · LHW 0.15 · HW 0.12; W-SW 0.35, W-FLW 0.31, W-BW 0.28 [S-computed] | 2008–26 | [GH-G] |
| Offensive passes | 0.1 per minute (≈1.5 per 15 min) [S] | 2002–17 | [PI1] |
| Share of ground time in control | UFC average 50% by construction (Fightnomics TIP metric) [S] | UFC | [FN] |
| **Ground-and-pound and finishing position** | | | |
| Share of sig strikes landed on the ground | 12.1% ground / 75.2% distance / 12.7% clinch; ground share 17.2% → 13.4% → 9.5% by era [S-computed]; by class FLW 12.0 · BW 10.7 · FW 11.5 · LW 12.2 · WW 12.5 · MW 13.2 · LHW 14.9 · HW 14.3% [S-computed] | 2008–26 | [GH-G] |
| Ground head strikes attempted / landed | 1.8 / 1.4 per minute (KPI means) [S] | 2002–17 | [PI1] |
| KO/TKO by position | distance 58.0% · ground 28.3% · clinch 13.7% (n=2,458); ground share by era 32.4% → 23.5% → 30.2% [S-computed]; Fightnomics: distance KOs ≈ half of all KO/TKOs, 85% of distance finishes by punches [S] | 2008–26 | [GH-G]; [FN] |
| Ground KO/TKO share by class | FLW 27.4 · BW 22.5 · FW 23.3 · LW 28.3 · WW 21.4 · MW 30.3 · LHW 31.0 · HW 32.3%; W-SW 42.0, W-FLW 38.6, W-BW 47.2% [S-computed] | 2008–26 | [GH-G] |
| **Grappling and winning** | | | |
| Decisions won by fighter with more control time | 68.2% (3,850); gap 0–1 min 51.0% · 1–3 min 57.2% · 3–5 min 70.3% · 5+ min 87.4% [S]; computed 67.5% [S-computed] | UFC | https://thefightalgorithm.com/articles/the-invisible-round ; [GH-G] |
| Decisions won by fighter with more… | TD landed 69.2% · sig strikes 78.5% · ground sig strikes 76.8% · sub attempts 54.2% · reversals 51.4% (ties excluded) [S-computed] | 2008–26 | [GH-G] |
| When grappling and striking conflict | More TDs but fewer sig strikes → TD fighter wins 39.9% (513/1,286); more control but fewer sig strikes → 37.2% [S-computed] | 2008–26 decisions | [GH-G] |
| Decision winner profile | more strikes AND control 44.2% · only strikes 22.6% · only control 22.3% · neither 10.9% [S] | UFC (Kaggle) | https://medium.com/@eduardocbjacob/ufc-data-report-309eaaf94fa3 |
| Ground strikes → win | >4 sig ground strikes landed → 80.4% win (111/138); + TD accuracy >25% → 84.9%; >0.85 sig ground strikes/min → 91.5% (86/94); TD attempt *rate* not predictive [S] | 234 UFC bouts 2014 | [JAM] |
| RIPPER rules | "Significant ground strikes landed" in all 8 winner rules; e.g. SGS ≥6 & total strikes ≥81 → 559/61 [S] | 2,831 UFC bouts 2000–15 | https://www.frontiersin.org/articles/10.3389/frai.2019.00029/full |
| Trailing-fighter behaviour | TD-attempt rate −38%, sub-attempt rate −49% when trailing [S, snippet — verify] | 3,646 UFC bouts | https://journals.sagepub.com/doi/10.3233/JSA-200478 |
| Model coefficient | Odds of winning ×1.324 per +1 takedown differential [S, snippet] | UFC | https://dl.acm.org/doi/10.1145/3696952.3696966 |
| Grappling injury severity | Takedown-caused injuries 112 days, grappling 129 days mean duration (highest) [S] | UFC PI | https://mymmanews.com/ufc-performance-institute-groundbreaking-analysis/ |

Notes: (a) TD volume: three estimates agree (Fightnomics ≈4.5 attempts/15 min in 2008–13; computed 3.99 attempted / 1.47 landed; median fighter 1.38 landed). (b) Accuracy clusters at 37–40% (defence 60–63%); PI1's 43.2% is a per-fighter mean. (c) Weight-class gradient is real but small (ε² = 0.0066 in [BMC]); mostly in the tails. (d) No clean UFC-wide distance/clinch/ground time-share table by class exists; UFCStats "control time" (≈38–40% of fight minutes for both fighters combined) is clinch + ground control, not ground time. (e) Era splits of clinch vs ground KO share probably reflect tagging changes. (f) UFC PI Vol 2's grappling tables were not retrievable by the grappling agent; the striking agent did obtain Vol 2 §1 (positions, durations).

### 2.3 Outcomes

| Statistic | Value | Population / era | Source |
|---|---|---|---|
| Overall UFC outcome mix | KO/TKO 32.6% (2,800) · SUB 19.3% (1,659) · DEC 46.8% (4,016) · other 1.4% (116); finish 51.9% [S] | 8,591 UFC bouts 1993–Mar 2026 | https://www.grapplerhq.com/mma/ufc-statistics/ |
| Overall UFC outcome mix (2nd) | KO/TKO 33.5% · SUB 19.7% · DEC 46.5%; finish 53.2%; mean finish round 1.7 [S] | all UFC to 2026 | https://mma.social/stats/finish-rates |
| Overall UFC outcome mix (3rd) | KO 33% · SUB 19% · DEC 47% · other 1% [S] | 8,692 fights since 1994 | https://sports-statistics.com/ufc/ufc-fight-statistics/ |
| KO vs TKO split | KO ≈11.5%, TKO ≈22.4% of fights [S, snippet] | UFC | https://carltonjchin.medium.com/the-ufc-overview-data-the-odds-of-a-knockout-d65017ea9fa3 |
| KO vs TKO split (head-strike stoppages) | 182/642 bouts (28.3%) stopped by head strikes: 34% KO / 66% TKO [S, snippet] | MMA | https://nsuworks.nova.edu/cgi/viewcontent.cgi?article=2788&context=ijahsp/ |
| Fightnomics all-time mix (to Apr 2013) | KO/TKO 36% · SUB 25% · DEC 39%; draws 0.7%, NC 0.8% [S] | UFC 1993–2013 | https://archive.org/stream/pdfy-yiL1jFk4ZOeZkg4d/Fightnomics+%5BThe+Hidden+Numbers+And+Science+Of+Martial+Arts%5D_djvu.txt |
| Heavyweight | KO/TKO 48.3% · SUB 21.2% · DEC 29.2% · other 1.3%; n=920 [S] | UFC to Mar 2025 | https://www.fightmatrix.com/ufc-records/ufc-fight-outcomes-by-weight-class/ |
| Light heavyweight | KO/TKO 44.4% · SUB 18.6% · DEC 35.3%; n=835 [S] | same | same |
| Middleweight | KO/TKO 36.8% · SUB 21.6% · DEC 40.2%; n=1,146 [S] | same | same |
| Welterweight | KO/TKO 32.8% · SUB 19.1% · DEC 47.0%; n=1,443 [S] | same | same |
| Lightweight | KO/TKO 29.6% · SUB 22.0% · DEC 47.4%; n=1,505 [S] | same | same |
| Featherweight | KO/TKO 29.2% · SUB 17.5% · DEC 52.3%; n=946 [S] | same | same |
| Bantamweight | KO/TKO 25.7% · SUB 19.2% · DEC 53.6%; n=824 [S] | same | same |
| Flyweight | KO/TKO 24.8% · SUB 21.8% · DEC 52.6%; n=464 [S] | same | same |
| Women's featherweight | KO/TKO 23.7% · SUB 21.1% · DEC 55.3%; n=38 (unstable) [S] | same | same |
| Women's bantamweight | KO/TKO 22.1% · SUB 16.7% · DEC 60.5%; n=258 [S] | same | same |
| Women's flyweight | KO/TKO 16.8% · SUB 19.6% · DEC 63.5%; n=285 [S] | same | same |
| Women's strawweight | KO/TKO 14.2% · SUB 19.6% · DEC 65.7%; n=388 [S] | same | same |
| By division, 2nd source | HW 52.5/15/32.1 · LHW 46.3/17.3/36 · MW 38.5/21.4/39.7 · LW 30.4/22.2/47.3 · WW 33.6/18.7/47.4 · FW 30.1/16.9/52.9 · BW 26.7/20.1/53.1 · FLW 23.9/22.1/53.8 · W-BW 22.2/17.3/60.5 · W-FLW 16.9/20.1/62.9 · W-SW 14/20.1/65.3 (KO/SUB/DEC %) [S] | mma.social live DB | https://mma.social/stats/finish-rates |
| Finish rate by division, 3rd source | HW 66.1% · LHW 61.3% · MW 59.0% · WW 51.7% · LW 51.0% · FW 45.4% · FLW 45.1% · BW 45.0% · W-BW 39.0% · W-FLW 36.7% · W-SW 32.8% [S] | 1993–Mar 2026 | https://www.grapplerhq.com/mma/ufc-statistics/ |
| UFC PI Vol 1 (2018) headline | HW 60.1% of wins by KO/TKO; men's FLW 60.3% decisions; MW 38.2% KO/TKO, 22.9% SUB, 38.9% DEC; avg bout 10:43; HW 8:02 shortest, W-SW 12:35 longest; bout duration +32.2% over 16 yrs; 8.5 strikes attempted/min (doubled since 2002) [S] | 3,900+ UFC bouts 2002–2017 | https://mymmanews.com/ufc-performance-institute-groundbreaking-analysis/ ; https://www.sherdog.com/news/news/UFC-Performance-Institute-Releases-Detailed-Journal-Analyzing-Fighter-Tendencies-in-MMA-138251 (PDF: http://media.ufc.tv/ufcpi/UFCPI_Book_2018.pdf) |
| Era finish rates | 1994–2004: 74.0% (419) · 2005–2014: 54.8% (2,608) · 2015–2025: 49.0% (5,448) [S] | UFC | https://www.grapplerhq.com/mma/ufc-statistics/ |
| Fightnomics era notes | 1993 subs 63% of fights; 2005 KO/TKO peak 49%; "stabilized around 50%" finishes [S] | UFC | Fightnomics archive.org text (above) |
| Year-by-year (finish/KO/SUB/DEC %) | 2010 51.2/27.6/23.6/48.4 · 2012 52.6/31.5/21.0/46.8 · 2014 50.0/30.8/19.2/49.8 · 2015 52.4/33.4/19.0/47.2 · 2016 50.1/31.7/18.4/49.9 · 2017 50.7/32.7/17.9/49.1 · 2018 51.4/32.2/19.2/48.4 · 2019 46.0/30.2/15.8/53.8 · 2020 49.8/31.3/18.5/49.8 · 2021 49.1/34.4/14.7/50.5 · 2022 53.2/33.8/19.4/46.6 · 2023 51.8/31.5/20.2/48.0 · 2024 44.8/28.7/16.2/54.8 · 2025 50.7/32.8/17.9/49.3 [S] | UFC | https://mma.social/stats/finish-rates |
| 2024 Sherdog count | 517 fights: 59 KO, 87 TKO, 84 SUB, 281 DEC, 0 draws, 4 NC, 2 DQ → KO+TKO 28.2%, SUB 16.2%, DEC 54.4% [S; % D] | UFC 2024 | https://www.sherdog.com/news/articles/Fight-Facts-UFC-2024-a-Year-in-Review-195800 |
| 2025 Sherdog count | 520 fights: 65 KO, 103 TKO, 92 SUB, 253 DEC, 4 draws, 3 NC → KO+TKO 32.3%, SUB 17.7%, DEC 48.7%, draws 0.77% [S; % D] | UFC 2025 | https://www.sherdog.com/news/articles/Fight-Facts-UFC-2025-a-Year-in-Review-199577 |
| 2024 glove-change effect | KO rate 31.4–33.9% in 2021–23; ~10% fewer KO finishes after new gloves (UFC 302, Jun 2024) [S, snippet] | UFC 2024 | https://www.mmamania.com/2024/10/11/24267724/ufc-knockout-rate-drops-10-percent-since-new-glove-debut |
| Non-UFC promotions 2024 | Finish rate: Cage Warriors 65.9% · KSW 63.0% · RIZIN 61.8% · PFL 53.0% · UFC 44.8% (last of 10); UFC R1-finish 20.3% [S, snippet] | 2024 | https://bloodyelbow.com/2025/01/06/mma-study-reveals-the-ufc-ranks-last-in-several-major-categories-compared-to-rival-promotions/ |
| ONE Championship claim | ~70% finish rate (promoter claim, unaudited) [S, snippet] | ONE | https://www.sportskeeda.com/mma/news-chatri-sityodtong-says-one-championship-s-finishing-rate-double-ufc |
| Regional MMA (Australia) male mix | Amateur (n=1,029): DEC 40.3% · TKO 28.2% · SUB 23.4% · KO 7.8%; Pro (n=330): DEC 31.2% · TKO 30.0% · SUB 25.8% · KO 12.4% [S] | 1,473 bouts 2020–23 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11569551/ |
| Regional MMA (Australia) female mix | Amateur (n=87): DEC 58% · TKO 28% · SUB 15%; Pro (n=27): DEC 59% · TKO 11% · SUB 26% [S] | same | same |
| Share of finishes by round | R1 52.9% (2,457) · R2 30.4% · R3 14.9% · R4–5 1.8% (85); 4,643 finishes [S] | UFC 1994–2026 | https://www.fightsincage.com/insights/round-of-finish-by-year |
| Round-1 share of finishes by era | 2001–12: 55.2%; 2013–25: 49.7%; trend −4.0 pp/decade; low 44.3% (2021), 2025 54.6% [S] | UFC | same |
| Share of ALL fights ending in R1 | 27.3% (2,349/8,591) [S]; 28.2% [S, mma.social]; 24.9% (2014–2026 sample) [S] | UFC | grapplerhq / mma.social / https://fightalpha.com/articles/how-long-do-ufc-fights-last |
| Share of all fights by ending | R1 24.9% · R1–R2 cumulative 40.8% (→ R2 15.9% [D]) · decision 49.7% · remainder R3+ finishes & other ≈9.4% [D] | 6,024 UFC fights 2014–Jun 2026 | https://fightalpha.com/articles/how-long-do-ufc-fights-last |
| Conditional finish hazard per round (3R) | P(end in R1)=0.249; P(end in R2 \| reach R2)=15.9/75.1=0.21; P(end in R3 \| reach R3)≈9.4/59.2=0.16 [D] | same | same (derived) |
| Average / median fight duration | Mean 10:37, median 13:48 [S]; modern sample mean 11.0 min, median 15.0 [S] | UFC | grapplerhq; fightalpha |
| 3-round vs 5-round | 3R mean 10.6 min, median 15.0, decision 50.7% (n=5,452) · 5R mean 15.5, median 16.6, decision 40.6% (n=572) [S] | 2014–2026 | https://fightalpha.com/articles/how-long-do-ufc-fights-last |
| Mean duration by finish type | DEC 15.8 min · KO/TKO 6.0 · SUB 6.8 · doctor stoppage 9.4 [S] | same | same |
| Mean duration by division (min) | HW 9.6 · LHW 9.4 · MW 10.5 · LW 10.6 · WW 11.1 · FW 11.3 · BW 11.5 · FLW 11.6 · W-BW 12.4 · W-SW 12.7 · W-FLW 12.8 [S] | same | same |
| Title vs non-title | Title-fight finish 57.4% (225/392) vs non-title 51.6%; within first 15 min title 46.7% vs non-title 51.1% [S] | UFC all-time | https://www.grapplerhq.com/mma/ufc-statistics/ |
| Decision type split | Unanimous 77.2% (3,098) · Split 20.4% (818) · Majority 2.5% (100) of 4,016 decisions; split = 9.5% of all fights [S] | UFC all-time | same |
| Decision type split, recent | 836 judged outcomes 2023–25: 78.6% unanimous, 19.3% split, 1.1% majority, 1.1% draws [S, snippet] | UFC 2023–25 | https://agentmma.com/mma-lab/ufc-unanimous-split-majority-decision |
| Judge disagreement on winner | 23% of all UFC decisions to 2013 [S]; 26% in 2017, 24% in 2016 [S] | UFC | Fightnomics text; https://abcnews.com/amp/Sports/mma-fights-end-submission-victories/story?id=52755704 |
| Judge round agreement | All three judges agree on 76.9% of rounds (4,029/5,238); sig-strike-count rule matches majority round winner 77.8% [S] | 1,670 UFC decisions 2011–2020 | https://agentmma.com/mma-lab/ufc-round-judging-criteria (JudgeAI analysis) |
| Draw rate | 64/8,954 = 0.71% of fights; 1.53% of decisions [S]; Fightnomics 0.7% [S] | UFC 1993–2026 | https://agentmma.com/mma-lab/ufc-draw-rate |
| Draws by division (% of decisions) | HW 3.0% · LHW 2.7% · MW 0.7% · WW 1.2% · LW 1.7% · FW 1.8% · BW 1.6% · FLW 1.3% · W-FLW 2.2% [S] | same | same |
| NC + DQ | 1.32% of fights [S, snippet]; "other" 1.4% [S]; Fightnomics NC 0.8% rising to 1.0–2.3% after 2011 [S] | UFC | https://fightomic.com/ufc-finish-rates-by-weight-class/ ; grapplerhq; Fightnomics |
| Doctor stoppages | 1.09% of fights [S]; 46/6,024 = 0.76% of fights, ≈2.4% of strike stoppages [D] | UFC 2012–21 / 2014–26 | https://nsuworks.nova.edu/ijahsp/vol23/iss3/21/ ; fightalpha |
| Injury by outcome | TKO outcomes 52.9% injury rate; 78% of facial fractures and 83% of eye injuries in KO/TKO outcomes [S, snippet] | UFC 2-yr | https://acofp.org/news-and-publications/journal/article-detail/vol-7-no-2-(2015)/ultimate-fighting-championship-injuries-two-year-retrospective-fight-injury-study |
| Referee stoppage timing | Mean 3.5 s (0–20 s) from KO strike to stoppage; KO'd athlete absorbed 2.6 ± 3.0 extra head strikes [S] | 844 UFC bouts 2006–12 (Hutchison 2014) | https://combatsportslaw.com/2014/03/27/university-of-toronto-study-finds-rates-of-kos-and-tkos-in-mma-are-higher-than-previously-reported/ ; https://journals.sagepub.com/doi/abs/10.1177/0363546514526151 |
| Strikes before TKO | 18.5 ± 8.8 strikes in final 30 s (5–46), 92.3% to head; 53.9% of KOs from a strike to the mandible [S] | same | same; https://www.espn.com/mma/story/_/id/10690370/study-shows-mma-brain-injury-risk-higher-boxing |
| KO/TKO incidence | KO 6.4/100 athlete-exposures (12.7% of bouts); TKO-by-strikes 9.5/100 AE (19.1%); combined 15.9/100 AE (31.9%) [S] | same | same |
| Within-round timing | "Earlier time in a round" and "earlier round" are significant KO/TKO risk factors (stoppages cluster early) [S]; only 3 UFC fights ever ended in the final second [S] | UFC | same; https://www.cbssports.com/mma/news/last-second-finishes-in-ufc-history-where-max-holloways-stunning-ko-ranks-among-the-five-latest-stoppages/ |
| Head-KO fight length | Head-trauma KO/TKO fights average ~6 min (5 s–24:10) [S] | 2,488 UFC fights 2000–21 | https://pmc.ncbi.nlm.nih.gov/articles/PMC9603147/ |
| Fastest finishes | KO 5 s (Masvidal–Askren 2019); SUB 9 s (Taktarov–Macias UFC 6) [S] | UFC | https://www.espn.co.uk/mma/story/_/id/27136533/masvidal-5-second-ko-fastest-ufc-history ; https://www.sherdog.com/news/news/Ronda-Rouseys-14Second-Tapout-of-Cat-Zingano-Ranks-Among-Quickest-UFC-Submissions-107253 |
| Women vs men finish rate | Women 217/579 = 37% finished; men 3,284/6,039 = 54% [S] | UFC to May 2022 | https://forums.sherdog.com/threads/ufc-wmma-finish-percentage.4239005/ |
| KO/TKO by sex (peer-reviewed) | 26.0% female vs 36.5% male bouts end KO/TKO; male HW head-KO 54% vs FLW 12.5% [S] | 2,488 UFC fights 2000–21 | https://pmc.ncbi.nlm.nih.gov/articles/PMC9603147/ |
| KO/TKO by class (Follmer 2019) | W-SW 7.9% vs male HW 52.1% of fights end KO/TKO; per 100 AE: MW 19.5, LHW 20.8, HW 26.1; risk vs reference +80% MW, +100% LHW, +206% HW, −62% FLW [S] | 1,903 UFC fights 2014–17 | https://journals.sagepub.com/doi/10.1177/1941738119827966 |
| Elite win methods by sex | Male top-15: KO/TKO 43.8%, DEC 33.4%, SUB 22.9% · Female top-15: DEC 46.0%, KO/TKO 30.6%, SUB 23.2% [S] | 174 ranked athletes 2023 | https://thesportjournal.org/article/an-analysis-of-weight-and-fighting-styles-as-predictors-of-winning-outcomes-of-elite-mixed-martial-arts-athletes/ |
| Rematches | First-fight winner wins title rematch 63.2%; sub-170 lb first-fight loser won only 12% [S]; all rematches 52–26 (66%) [S, snippet] | UFC | https://sports.yahoo.com/mma/article/ufc-316-mailbag-what-do-the-stats-tell-us-about-who-wins-title-rematches-merab-dvalishvili-sean-omalley-175028355.html ; https://www.sportsbettingdime.com/guides/how-to/ufc-betting-trends/ |
| Red corner | Red (higher-billed) wins 55–60% [S]; Kaggle 57.66% since 2010 [S] | UFC | https://www.stat.cmu.edu/capstoneresearch/fall2024/315files_f24/team11.html ; https://www.kaggle.com/datasets/rajeevw/ufcdata |
| Early no-time-limit MMA (Ultimate Full Contact) | 170 bouts: SUB 49.4% · DEC 19.4% · TKO 19.4% · KO 10.6% · doctor 1.2%; 68.8% ended before 5:00; mean 254 s; RNC 17.1%, armbar 10%, guillotine 8.8%; ground-and-pound TKO 12.4% vs standing TKO 7.1% [S] | 1990s-style vale-tudo ruleset | https://pmc.ncbi.nlm.nih.gov/articles/PMC7579074/ |

Notes: (a) The three all-time tallies converge on KO/TKO 32.6–33.5%, SUB 19.3–19.7%, DEC 46.5–47%. (b) Level differences by division across sources (e.g., HW KO/TKO 48.3% vs 52.5%) come from cut-off date and whether "other" is in the denominator. (c) No public source gives a within-round finish-time histogram; Hutchison's regression (earlier in round = higher risk) plus mean KO/TKO time of 6.0 min imply a mildly front-loaded within-round hazard [E]. (d) The Suarez doctor-stoppage abstract's "4.19% male vs 0.98% female" cannot both sit under 1.09% overall; denominators were probably mixed — cite cautiously.

### 2.4 Mismatch effects

| Factor | Effect size / win-probability shift | Population / era | Source |
|---|---|---|---|
| Reach advantage (any) | Longer-reach fighter won 51.65% [S] | UFC 1993–2021 (Bruin Sports Analytics) | https://agentmma.com/mma-lab/ufc-reach-advantage |
| Reach gap > 7 in | Longer-reach fighter ≈62.6% (shorter 37.4%) [S] | same | same |
| Reach gap ≥ 3 in by division | Longer fighter's win rate rises with weight, 68% at LHW [S] | same | same |
| Reach gap (Fightnomics) | Advantage only appears at ≥2 in; 2.5–6 in → "over a 10-point swing"; ≥6.5 in → "almost two-thirds"; in fights ≥70% standing, ≥2.5 in reach edge → 60% (longest gaps → ~75%); in fights ≥70% on the ground → 49% (nullified) [S] | UFC 2006–2013 | Fightnomics archive.org text |
| Reach + takedown interaction | With one takedown landed the short-armed fighter's win rate rises ~49% → 64% [S, snippet, unverified] | UFC (Bruin) | https://www.bruinsportsanalytics.com/post/mma_reach |
| Armspan per cm (career) | +0.2 pp career win% per cm (≈+1 pp per 5 cm), R² ≈ 0.008 [S] | 1,660 pro fighters (Richardson) | https://agentmma.com/mma-lab/ufc-reach-advantage ; https://shura.shu.ac.uk/32072/8/Kirk-5-YearAnalysisAge%28VoR%29.pdf |
| Armspan, bout-level (Kirk 2023) | No overall effect (winners 182.2 vs losers 181.6 cm); HW only: 198.4 ± 6.6 vs 196.1 ± 7.7 cm [S] | 2,229 UFC bouts 2017–21 | https://shura.shu.ac.uk/32072/8/Kirk-5-YearAnalysisAge%28VoR%29.pdf |
| Height, bout-level | No effect (177.5 vs 177.0 cm) [S] | same | same |
| Height advantage (any) | Taller won 52.2% of 7,063 fights; 4+ in 52.5% (735); 6+ in 51.6% (223); 8+ in 62.5% (24); 10+ in 75% (8) [S] | UFC | https://fightalpha.com/articles/biggest-height-mismatch-ufc |
| Height 4+ in by division | LHW 59.1% · WW 58.1% · MW 56.1% · HW 55.0% · LW 46.0% · FW 43.5% [S] | UFC | same |
| Height controlled for reach (Fightnomics) | Taller by ≥2 in won 54% raw, 56% at ≥3 in; after controlling for reach/age/stance: 48% (≥2 in), 46% (≥3 in) — "height advantage is a myth" [S] | UFC 2006–13 | Fightnomics text |
| Height ≥10 cm in title fights | Shorter fighter 31–29 overall, 20–9 in lighter divisions [S] | UFC title fights | https://agentmma.com/news/80993-ufc-title-fight-data-shows-shorter-fighters-win-more-often-against-taller-oppone |
| Age, bout-level (Kirk) | Winners 29.8 ± 4.0 vs losers 30.7 ± 4.2 yrs; paired diff −0.82 yr; R = .18 — the only anthropometric separating winners [S] | 2,229 UFC bouts | Kirk 2023 PDF (above) |
| Age gap ≥ 3 yrs | Younger fighter won 324/556 = 58% [S] | UFC (Fight Matrix) | https://www.fightmatrix.com/2026/07/24/what-fightmatrix-rankings-reveal-about-ufc-favorites-and-underdogs/ |
| Age gap ≥ 4 yrs (Fightnomics) | Younger wins "nearly 60%" with no other advantages; fighters in 20s win >50%, no 30s cohort >50% [S] | UFC 2006–13 | Fightnomics text |
| Win rate by age band | <25: 58.1% · 25–27: 55.1% · 28–30: 52.3% · 31–33: 48.3% · 34–36: 42.5% · 37+: 37.7% (≈ −0.7 pp/yr) [S] | 16,429 UFC appearances since 2005 | https://www.ufcalendar.com/blog/when-do-ufc-fighters-get-washed |
| KO-loss susceptibility by age | Stopped by strikes: <25 ≈ 1 in 10; 37+ 24.6% [S]; Fightnomics: strikes-per-knockdown-absorbed falls to one-third from early 20s to 40s [S] | UFC | same; Fightnomics text |
| KO susceptibility by KD history | KO-loss rate: never dropped 13.9%; 5+ career knockdowns 25.3%; after 4th KO loss 29.3% [S] | UFC | https://www.ufcalendar.com/blog/when-do-ufc-fighters-get-washed |
| Consecutive KO losses | 22.7% of 705 KO'd athletes suffered a 2nd consecutive KO; prior KO history OR = 1.13 [S] | UFC | https://pubmed.ncbi.nlm.nih.gov/41674479/ |
| Peak age | Median peak 30.6 (IQR 28.0–33.2); post-peak win rate 30.8% [S]; 80% of 174 champions/top-15 aged 26–35, mean 31.8 [S] | UFC | ufcalendar; https://agentmma.com/mma-lab/ufc-fighter-peak-age |
| Winners' mean age by division | BW 28.7 · FW 28.9 · LW 29.8 · MW 29.9 · LHW 30.7 · WW 30.8 · HW 32.0 [S] | Kirk 2017–21 | https://agentmma.com/mma-lab/ufc-fighter-peak-age |
| UFC debutant vs veteran | Debutant won 209/486 = 43% [S, snippet] | UFC | https://www.betmma.tips/ufc_debut_statistics.php |
| Career cage minutes | <30 min 48.7% · 120–179 min 52.0% · >180 min 44.1% (experience effect ≈ age effect) [S] | UFC | ufcalendar (above) |
| Win streak ≥ 5 | 61% (1,797/2,960) [S] | UFC | fightmatrix 2026/07/24 (above) |
| Heavier at weigh-in by 1.75–6 lb | Heavier won 54.55% (3,120/5,719) [S] | 26,383 pro MMA bouts | https://www.fightmatrix.com/2018/05/26/fighters-missing-weight-win-percentage/ |
| Missed weight (UFC) | 2020: 9–18 (33%); 2021: 14–13 (52%) [S] | UFC | https://www.actionnetwork.com/mma/ufc-weigh-in-results-fighters-miss-weight-odds-betting |
| Weight regain | Regain% not a W/L predictor (p=0.798, n=20; p=0.089, n=308) but high regain → more KO/TKO finishes (p=0.038) [S] | CSAC pro MMA | https://pmc.ncbi.nlm.nih.gov/articles/PMC11842001/ ; https://pmc.ncbi.nlm.nih.gov/articles/PMC12379698/ |
| Weight-cut magnitude | −6.7% BW in 72 h pre-weigh-in [S] | 616 UFC fighters 2020–22 | https://pmc.ncbi.nlm.nih.gov/articles/PMC9782639/ |
| Per weight class up | **No published number.** [E] see §4 | — | — |
| Champion retention | 112–45 (71.3%) 2013–22; 59.4% in 2021–22 [S]; 70.6% historical [S] | UFC | https://sports.yahoo.com/ufc-champions-are-no-slam-dunk-to-win-once-they-earn-a-belt-as-israel-adesanya-learned-the-hard-way-042106695.html ; https://www.mmaoddsbreaker.com/news/1277-76the-numbers-behind-ufc-title-defenses/ |
| Southpaw prevalence | Orthodox 80.3% / southpaw 17.4% / other 2.3% [S]; current UFC 76.6 / 17.1 / switch 6.1% [S]; Fightnomics 20–22% unorthodox, male population 11.6% left-handed [S] | MMA | https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0079793 ; https://agentmma.com/mma-lab/ufc-southpaw-vs-orthodox-advantage ; Fightnomics |
| Southpaw win rate | Career: 64.0% vs 62.6% NS [S]; left-oriented 53.5% chance of better record [S]; head-to-head UFC 2010–12: 34–34 [S]; Fightnomics head-to-head after removing reach/age gaps: southpaw 57% [S] | MMA | PLOS (above); https://www.nature.com/articles/s41598-019-51975-3 ; agentmma; Fightnomics |
| Open-stance matchups | Finish inside distance 18% more often than same-stance [S] | UFC | https://mmabettingtrends.com/ |
| Favourite win rate | 68.1% (483/709), calibrated [S]; ≈65% over 10 yrs (2013 ≈72%, 2015 ≈62%) [S]; ≈69% "always pick favourite", market Brier 0.2024 [S]; Fightnomics: 32% upsets, 12% pick'em, main events 23% upsets, "puncher's chance" 10–15% [S] | UFC | https://www.mmaoddsbreaker.com/news/2493-92long-term-betting-trends-when-do-upsets-occur-in-the-ufc/ ; https://www.mmahive.com/ufc-favorites-vs-underdogs/ ; https://github.com/Vincent-Onggo/ufc-fight-prediction ; Fightnomics |
| Win rate by odds bucket | −400 to −900: 88–93%; near-even (+100 to −122): 51% [S]; underdogs +122 to +150: 44% [S] | UFC 2013– | https://mmabettingtrends.com/ ; mmahive |
| Odds calibration | Actual vs implied in 5% buckets R² ≈ .99, slope ≈ 1 [S] | UFC 2008– | https://github.com/iankotliar/UFC_Final |
| Pre-fight model ceiling | Leak-free ML 59–61% accuracy; odds ≈ 65–69% [S] | UFC | https://agentmma.com/mma-lab/ai-ufc-prediction-model |
| Model feature importance | Odds of winning ×1.324 per +1 takedown differential; age, sig strikes landed, control time significant [S, snippet]; SLpM differential strongest, TD-defence next [S] | UFC | https://dl.acm.org/doi/10.1145/3696952.3696966 ; https://medium.com/@bjeong16_86854/predicting-winners-of-ufc-fights-18882cb0e902 |
| Pace advantage (Fightnomics) | Low-pace fighters −11 pp vs baseline win rate; high-pace +7 pp; low-pace group won only 82% of odds-implied wins [S] | UFC | Fightnomics text |
| Layoff ≥ 1 yr | 35% win rate [S] (conflict: an unsourced 35–26 count claims 57%) ; >210 days inactivity 41% [S] | UFC | Fightnomics text; fightmatrix 2026/07/24 |
| <60 days after KO loss | 2/16 won (13%) [S] | UFC 2009–18 | https://www.espn.com/mma/story/_/id/23232314/what-quick-turnarounds-mean-mma-fighters |
| Late replacement | Won 179/489 = 37% [S] | UFC | https://forums.sherdog.com/threads/stats-60-of-late-replacement-fights-are-lost-by-the-fighter-who-had-the-short-camp.4313427/ |
| Home cage | Brazil at home 65% (149/229), edge gone by 2019; UK/US no over-performance [S]; Fightnomics: Brazilian home rate 80%+ mid-2013, implied 51% either way after odds [S] | UFC | https://www.espn.com/mma/story/_/id/23585786/does-home-cage-advantage-exist-mma ; Fightnomics |

### 2.5 Round-by-round dynamics

| Statistic | Value | Population / era | Source |
|---|---|---|---|
| Knockdown rate by round | Knockdowns per landed distance power head strike: R1 5.3% → R2 2.4% → R3 1.5%; no R5 knockdown in sample; BW R3 only 0.4% [S] | UFC to 2013 | Fightnomics text (archive.org, above) |
| Finish share by round | R1 52.9% · R2 30.4% · R3 14.9% · R4–5 1.8% of finishes [S] | UFC 1994–2026 | https://www.fightsincage.com/insights/round-of-finish-by-year |
| Conditional hazard | P(finish in R1)=0.25; P(finish R2 \| reach R2)≈0.21; P(finish R3 \| reach R3)≈0.16 [D from fightalpha shares] | UFC 2014–26 | https://fightalpha.com/articles/how-long-do-ufc-fights-last |
| R3 share rising | R3 share of finishes ~10% (2005–09) → 14–21% (2014–24) [S] | UFC | fightsincage |
| Effort time per round, HW vs others (Miarka) | R1: HW 212.4 ± 101.5 s vs others 257.6 ± 79.9 s; R2: BW lowest 132.8 ± 90.9 s vs 171.7 ± 81.5; R3: HW 246.3 ± 89.1 s [S] | 2,814 UFC rounds 2014 | https://www.researchgate.net/publication/284177781_Comparisons_of_Time-motion_Analysis_of_Mixed_Martial_Arts_Rounds_by_Weight_Divisions |
| Winner vs loser rounds (Miarka 2016) | 645 rounds (215 W / 215 L per round number) analysed for R1–R3 technical-tactical differences [S; values behind paywall] | UFC | https://www.researchgate.net/publication/287151852_Comparisons_Technical-Tactical_and_Time-Motion_Analysis_of_Mixed_Martial_Arts_by_Outcomes |
| Kickboxing (K1 rules) output by round | High-intensity actions R1 27.1 ± 7.1 → R2 25.1 ± 6.6 → R3 24.9 ± 6.1 (−8%); pauses lengthen; blow share 32.7/32.6/34.7% [S] | 45 world-championship bouts | https://www.researchgate.net/publication/279026730_Time-Motion_Analysis_of_Elite_Male_Kickboxing_Competition |
| Kickboxing physiology by round | HR 178 → 182 → 185 bpm; lactate 11.3 → 13.1 → 14.6 mmol/L [S] | 15 elite K1 bouts | https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2021.691028/full |
| Elite Muay Thai winners vs losers | Losers had higher lactate in R4 (g=−1.50) and R5 (g=−1.11); winners escalate active-to-passive ratio by R4 (U-shaped pacing) [S] | 8 pro 5-round bouts | https://sportrxiv.org/index.php/server/preprint/view/687 |
| Boxing fatigue | Punch force −4.26% post-fatigue protocol [S]; late-round output −15–25% (CompuBox-based reporting, see BOXING.md) | lab / pro boxing | https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12729554/ |
| Amateur boxing by round | Winners land more and have lower thrown:landed ratio in R3; accuracy + movement index classify 85% of outcomes; winners hit 33% vs losers 23% [S] | Olympic-level | https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0188675 ; https://pubmed.ncbi.nlm.nih.gov/24912199/ |
| Judges: stats vs scoring | Fighter with more sig strikes matches majority round winner 77.8%; judges unanimous on 76.9% of rounds [S] | 5,238 UFC rounds 2011–20 | https://agentmma.com/mma-lab/ufc-round-judging-criteria |
| Split decisions | 20.4% of decisions [S]; 23% disagreement to 2013 [S] | UFC | grapplerhq; Fightnomics |
| Round-1 winner wins fight | **No published figure found.** Structural bound for 3R decisions: R1 winner loses only if losing both R2 and R3; with independent 50/50 rounds → 75% [D]; plausible range 75–85% once finishes and momentum are included [E] | — | — |
| Comeback after losing R1 & R2 | No published figure. Finishes in R3 = 14.9% of finishes ≈ 7–8% of all fights [D]; only a subset are comebacks [E] | — | fightsincage |
| Fighter knocked down still wins | No published UFC figure found; Fightnomics notes a section on "knockdown but fight continues" (values not in text extract). [gap] | — | — |
| 10–8 / 30–27 frequencies | Not found in public sources. [gap] | — | — |

### 2.6 Other combat sports

**Boxing (pro, CompuBox)**

| Statistic | Value | Population / era | Source |
|---|---|---|---|
| Light heavyweight division averages | 51.2 thrown/rd · 14.9 landed/rd · 29.1% connect · jab 20.1% (4.6 landed/rd) · power 36.4% (10.3 landed/rd) [S] | CompuBox 2024 | https://africa.espn.com/boxing/story/_/id/41718875/what-boxing-numbers-tell-us-artur-beterbiev-vs-dmitry-bivol-boxing-title-fight |
| Junior middleweight / featherweight averages | JMW 55.5 thrown, 16.0 landed, 28.8%, jab 18.9%, power 36.0%; FW 57.7 thrown, 16.0 landed, 27.7%, jab 16.7%, power 35.1% [S] | CompuBox 2025 | https://www.espn.com/boxing/story/_/id/45802956/xander-zayas-jorge-garcia-shu-shu-carrington-mateus-heita-key-stats-numbers-ahead-boxing-rematch |
| Middleweight averages (derived) | Hagler 28.4 landed/rd = "13 more than middle. avg" → ≈15.4 landed/rd; 43.2% connect = "14% higher" → ≈29%; 19.5 power landed ≈ "2×" → ≈10; 47% power = "18% higher" → ≈29% [D] | CompuBox historical | https://beta.compuboxdata.com/reports/93 |
| All-division landed/rd | Joshua's opponents landed 6.6/rd = "10 fewer than the CompuBox average" → ≈16.6 landed/rd [D] | CompuBox | https://www.boxingscene.com/top-heavyweights-boxing-compubox--122447 (snippet) |
| Jabs thrown, power connect | CompuBox average jabs thrown/rd = 23; average power connect 36.9% [S, snippet] | CompuBox 2019 | https://www.badlefthook.com/2019/3/19/18272492/errol-spence-rises-to-the-top-of-compubox-stats-in-power-punching |
| Heavyweight volume | 30–60 punches/rd; Joshua 37.7 thrown/11.7 landed per rd vs Ngannou [S] | pro HW | https://www.infinitudefight.com/how-many-punches-are-thrown-in-boxing-fight/ |
| Heavyweight accuracy examples | Wilder 42.8% total, 56.6% power; Miller 66.6 thrown/23.1 landed per rd [S, snippet] | CompuBox | https://www.boxingscene.com/top-heavyweights-boxing-compubox--122447 |
| Elite outliers | Usyk 41.5 jabs/rd; Gonzalez 30.1 landed/rd; Stevenson +20.2 plus/minus; Ruiz 4.1 opp. power landed/rd [S] | CompuBox | https://grokipedia.com/page/CompuBox |
| KO % by weight class (career KO% of wins) | Heavyweight 79% · strawweight 51% [S; secondary, method = KO share of wins] | pro boxing | https://boxingreviewer.com/most-popular-boxing-statistics |
| In-ring punch force | Mean force per landed punch 866.6 N (super middle) – 1,149.2 N (light middle); in all 3 decision bouts the boxer with greater cumulative force and more punches won unanimously [S] | 6 pro bouts | https://www.researchgate.net/publication/4744109_Direct_Measurement_of_Punch_Force_During_Six_Professional_Boxing_Matches |
| Elite vs novice punch force | Elite lead 2,847 N / rear 4,800 N vs novice 1,604 / 2,381 N [S]; elite 3–6× junior force at similar size [S] | lab | https://www.researchgate.net/figure/Direct-Measures-of-Punch-Force-in-Newtons-and-Number-of-Hits-by-Boxer-for-Six_tbl2_4744109 ; https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7739747/ |
| Head acceleration | Olympic straight punch: 58 g, 6,343 rad/s²; hook 71.2 g, 9,306 rad/s² (concussive range); fist ≥10 m/s → >50 g [S] | lab | https://pubmed.ncbi.nlm.nih.gov/16183766/ ; https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9351374/ |

**Amateur / Olympic boxing**

| Statistic | Value | Population / era | Source |
|---|---|---|---|
| Output | ≈1.4 actions/s; ~20 punches/min (men, 3×3), ~16/min (women, 4 rds) [S] | elite amateur | https://pubmed.ncbi.nlm.nih.gov/24912199/ ; https://pubmed.ncbi.nlm.nih.gov/25933441/ |
| Accuracy | Winners 33% hit vs losers 23%; air punches 17% vs 27% [S] | Olympic level | https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0188675 |
| Stoppage rates | Olympic 1952–2011 (29,357 bouts): RSC 9.7–13.1% with head guards; KO fell 6.44% → 2.09% with computer scoring (1992); RSC 13.15% (5×2) → 5.91% (4×2) [S]; 1980 Olympics 11% KO, 6.4% RSC-H [S] | Olympic/AIBA | https://www.researchgate.net/publication/234124074_Amateur_boxing_in_the_last_59_years_Impact_of_rules_changes_on_the_type_of_verdicts_recorded_and_implications_on_boxers'_health |

**Kickboxing / Muay Thai**

| Statistic | Value | Population / era | Source |
|---|---|---|---|
| GLORY 2025 | 97 fights: 34 (T)KO = 35.05%, 62 decisions; HW 46.0% KO (50 fights), LHW 44.4%, WW 21.4%, FW 15.8% [S] | GLORY 2025 | https://beyondkick.com/opinion/glory-knockout-count-in-2025-a-full-breakdown/ |
| GLORY 2024 | 104 fights, 33 (T)KO = 31.7%; LHW 54.6% (22 fights); HW 34.8% [S] | GLORY 2024 | https://beyondkick.com/opinion/glory-s-knockout-count-in-2024-a-full-breakdown/ |
| K1-rules time structure | HIA 2.2 ± 1.2 s; LIA 2.3 ± 0.8 s; pauses 5.4 ± 4.3 s; fight:non-fight 1:1; punches ≈ kicks >> knees [S] | 45 WC bouts | https://www.researchgate.net/publication/279026730_Time-Motion_Analysis_of_Elite_Male_Kickboxing_Competition |
| Amateur MT vs KB effort bouts | Effort duration MT 8.7 s vs KB 5.5 s; observation phase dominates both [S] | 13 amateur bouts | https://www.researchgate.net/publication/228828864_Time-Motion_analysis_in_Muay-Thai_and_Kick-Boxing_amateur_matches |
| Thai vs UK Muay Thai technique use | Thai fighters use more knees, body round kicks, push kicks; more leg catches, leg blocks, sways [S; counts in PDF not extractable] | elite | https://www.scirp.org/pdf/APE_2013111910352073.pdf |
| ONE Championship | ~70% finish claim (promoter) [S, snippet]; no audited striking-only rate found [gap] | ONE | sportskeeda (above) |

**Grappling competitions**

| Statistic | Value | Population / era | Source |
|---|---|---|---|
| ADCC 2024 submission rate | 125 matches, 53 subs = 42% (male 43/95 = 45%; female 10/30 = 33%) [S, snippet]; same article also reports "34%" (likely different denominator incl. superfights/absolute) — conflict noted; 65% of subs were chokes, 20% arm attacks; 4 heel hooks of 53; 62 takedowns in male division [S] | ADCC 2024 | https://www.bjjheroes.com/editorial/adcc-2024-after-math-data-compilation-and-analysis |
| ADCC 2022 | 36% submission rate; only 5 heel-hook finishes (lowest of last 3 ADCCs) [S, snippet] | ADCC 2022 | https://www.bjjheroes.com/editorial/adcc-2022-after-math-data-compliation-and-analysis |
| ADCC most common subs | Inside heel hook 21%, RNC 20% of subs (2023 compilation); leg locks 28–30% of finishes (secondary) [S] | ADCC | https://bjjequipment.com/bjj-statistics/ |
| CJI 2024 | 36% submission rate [S, snippet] | Craig Jones Invitational | bjjheroes ADCC 2024 article |
| IBJJF Worlds 2023 (black belt, QF→F) | 47/128 = 36.7%; male 22/70 = 31.4%; female 25/58 = 43.1%; choke from back 44.7%, armbar 21.3%, triangle ~8.5% [S] | IBJJF 2023 | https://ibjjf.com/news/2023-world-championships-submission-breakdown |
| IBJJF Worlds 2024 (black belt finals) | 61% submission rate in finals; back chokes 4, straight ankle locks 3 [S] | IBJJF 2024 | https://ibjjf.com/news/2024-ibjjf-world-championship-submission-breakdown |
| IBJJF Worlds 2026 | 335 matches, 115 subs = 34% [S, snippet] | IBJJF 2026 | https://www.bjjheroes.com/bjj-news/ibjjf-world-championship-2026-results |
| IBJJF Worlds 2015 (adult male BB) | 61/145 = 42% [S, snippet] | IBJJF 2015 | https://www.bjjheroes.com/editorial/crunching-numbers |
| UFC choke shares | RNC 49.6% of choke finishes (539/1,086), guillotine 21% [S, secondary] | UFC | https://bjjequipment.com/bjj-statistics/ |

**Judo**

| Statistic | Value | Population / era | Source |
|---|---|---|---|
| Tokyo 2020 | 450 matches; 294 (65.3%) ended in regular time, 156 (34.6%) golden score; ippons 142 regular / 75 GS; waza-ari 177 / 85; penalty-decided 11 / 31 (73.8% of penalty decisions in GS); ne-waza: pins 30, joint locks 16, chokes 7; hand throws 116, foot 96, sacrifice 73, hip 51 [S] | Olympic | https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2022.960365/full |
| Win by ippon share | Tokyo 2020: 65.4% of matches won by ippon; Rio 2016: 60% (men) / 50% (women) [S] | Olympic | same; https://www.tandfonline.com/doi/full/10.1080/24748668.2025.2499330 |
| Golden score share | 34% Tokyo 2020 vs 19–20% at 2018–19 Worlds [S] | IJF | Frontiers (above) |
| Women's ippon techniques | Nage-waza 92.3% of waza-ari; katame-waza 61.1% of ippon (Rio 2016 + Tokyo 2020 women) [S] | Olympic women | https://www.mdpi.com/2076-3417/15/13/7455 |
| Top scoring throws (London 2012) | Men: morote seoi nage > uchi mata > harai goshi; Women: uchi mata > ko uchi gari/harai goshi > ippon seoi/o uchi [S, ranks only] | Olympic | https://kokakids.co.uk/the-top-scoring-judo-techniques-for-olympic-judo |
| Per-attempt effectiveness | See `JUDO.md` §7.4 (Sacripanti): ~9% uchi mata (men) to ~25% tai otoshi direct attacks; counters 46–100% [S via JUDO.md] | London 2012 | https://arxiv.org/pdf/1506.01812 |

**Wrestling** — see `WRESTLING.md` (UFC TD accuracy ≈38–42%, TD defence ≈58–62% baseline; technique tables). No pin-rate data compiled here [gap].

### 2.7 Multi-attacker / street context — see §6.

---

## 3. Calibration targets (master table)

Targets are for a **modern (2015–2026) UFC-level, 3 × 5-min, mixed-division men's population** unless stated. "Tolerance" is the band inside which a headless-sim batch (≥2,000 fights) should land before we call the metric calibrated; it reflects spread between sources plus era drift, not sampling error. Per-division rows use the same tolerance logic. Women's divisions are separate rows. Paste into CALIBRATION.md.

| # | Metric | Target | Tolerance | Source |
|---|---|---|---|---|
| **Striking output** | | | | |
| 1 | Sig strikes landed per fighter per min (SLpM), pooled | 3.9 | ±0.4 | [GH] 3.83 (2015–26) / 4.02 (2020–26); [PI2] 3.73; [CQ] median 3.42 |
| 2 | Sig strikes attempted per fighter per min | 8.4 | ±0.6 | [GH] 8.36 / 8.48; [PI2] 8.56 |
| 3 | Sig strike accuracy (landed/attempted), pooled | 46% | ±3 pp | [GH] 45.8 / 47.4; [CQ] 45; [PI1] 45.1; [FSM] 45 |
| 4 | Striking defence (1 − opponent accuracy) | 54% | ±3 pp | [CQ] 54; [GH] 54.2 |
| 5 | Total strikes landed per fighter per min | 5.4 | ±0.6 | [GH] 5.36; [PI1] 4.9 (men, 2002–17) |
| 6 | Total strike accuracy | 53% | ±3 pp | [PI1] 52.6; [GH] 52.8 |
| 7 | Sig landed : total landed ratio | 0.72 | ±0.05 | [GH] 0.715; [PI1] 0.69 |
| 8 | Sig strikes landed per fighter per fight (mean / median) | 42 / 35 | ±6 / ±5 | [GH] 42.3 / 35 |
| 9 | Winner − loser SLpM gap (all outcomes) | winner ≈ 4.3, loser ≈ 2.9 | ±0.4 each | [PI2] Fig 1.3B (class means 3.6–5.0 vs 2.3–3.5) |
| 10 | Winner vs loser sig accuracy | 50% vs 41% | ±3 pp each | [GH] 50.1 / 40.9; [PI2] 46–52 vs 36–44 |
| 11 | SLpM by men's class | FLW 3.5 · BW 3.9 · FW 4.0 · LW 3.9 · WW 3.7 · MW 3.7 · LHW 3.9 · HW 3.7 | ±0.4 | [GH] 2015–26 |
| 12 | Sig attempts/min by men's class | FLW 7.8 · BW 8.7 · FW 8.8 · LW 8.6 · WW 8.1 · MW 7.9 · LHW 7.8 · HW 7.5 | ±0.6 | [GH] 2015–26; [PI1] Fig 1.7 lower (6.7–8.1, older era) |
| 13 | Sig accuracy by men's class | FLW 44 · BW 45 · FW 45 · LW 46 · WW 46 · MW 47 · LHW 49 · HW 50 (%) | ±3 pp | [GH] |
| 14 | Women's SLpM / attempts / accuracy | W-SW 4.1 / 9.1 / 45% · W-FLW 4.0 / 9.3 / 43% · W-BW 3.7 / 8.1 / 46% | ±0.4 / ±0.6 / ±3 pp | [GH]; [PI1] women 4.2 landed, 11.6 total attempted |
| 15 | Accuracy by target (sig) | head 38% · body 70% · leg 81% | ±3 pp | [GH] 37.5–38.8 / 69.1–70.7 / 81.1–82.1 |
| 16 | Accuracy by position (sig) | distance 42% · clinch 72% · ground 72% | ±3 pp | [GH]; [FSM] 40 / 70 / 69 |
| 17 | Accuracy distance × target | head 31% · body 63% · leg 80% | ±3 pp | [FSM]; UFC.com ≈33% standing head |
| 18 | Accuracy clinch × target | head 58% · body 86% · leg 91% | ±4 pp | [FSM] |
| 19 | Accuracy ground × target | head 67% · body 94% · leg 87% | ±4 pp | [FSM]; UFC.com ≈93% ground body |
| 20 | Share of sig attempts by target | head 77% · body 13.5% · leg 9% | ±3 pp | [PI2] 78.0/13.1/9.0; [GH] 77.0/13.8/9.1 |
| 21 | Share of sig landed by target | head 63% · body 21% · leg 16% | ±3 pp | [GH] |
| 22 | Share of sig landed by position | distance 78% · clinch 11% · ground 11% | ±4 pp | [GH] 2015–26 (80.8/9.8/9.5 in 2020–26) |
| 23 | Share of sig attempts by position | distance 86% · clinch 7% · ground 7% | ±3 pp | [GH] |
| 24 | Fight time by phase | distance 61% · clinch 15% · ground (all positions) 24% | ±5 pp | [PI2] Fig 1.2 (2017–19); Fightnomics 2013 ≈50/18/<33 |
| 25 | Distance strike power/jab: distance power-head accuracy | 25% (fighter-level SD 7.8 pp) | ±3 pp; SD ±2 pp | [FN] |
| 26 | Distance jab (head) accuracy | 29% | ±3 pp | [FN] |
| 27 | Strike-type share of KO-causing strikes | punch 85% · knee 6% · kick 8% · other 1% | ±5 pp | [HUT] 84.6/6.2/7.7; MDPI: punches 86% of strike finishes 2023–24 |
| 28 | Ground finishing strikes | punches ≈83% · elbows 14% · knees 3% | ±5 pp | [FN] |
| 29 | Fight-ending punch type (KO/TKO) | rear straight 29% · lead hook 27% · rear hook 24% · other 20% | ±6 pp | Barley 2025 |
| **Knockdowns** | | | | |
| 30 | Knockdowns per fighter per 15 min | 0.30 | ±0.05 | [GH] 0.296–0.308; numbersmma 0.309 |
| 31 | Knockdowns per fight (both fighters) | 0.44 | ±0.06 | [GH] |
| 32 | Share of fights with ≥1 KD | 36% | ±5 pp (2026 season shows 44%) | [GH]; fightstats.online |
| 33 | KDs per fight distribution (0/1/2/3/4+) | 64 / 30 / 5 / 1 / 0.2 % | ±4 pp on 0 and 1 | [GH] |
| 34 | KD per 15 min by men's class | FLW 0.29 · BW 0.32 · FW 0.33 · LW 0.31 · WW 0.36 · MW 0.35 · LHW 0.44 · HW 0.33 | ±0.06 | [GH] |
| 35 | KD per 15 min, women | W-SW 0.10 · W-FLW 0.10 · W-BW 0.12 (≈⅓ of men) | ±0.04 | [GH] |
| 36 | KD per landed distance power head strike | 3.9% overall (FLW–FW below, WW at, MW–HW above avg) | ±1 pp | [FN] |
| 37 | KD per 100 head sig landed, by class | FLW 0.87 · BW 0.90 · FW 0.88 · LW 0.83 · WW 1.03 · MW 0.98 · LHW 1.20 · HW 0.92; women 0.26–0.35 | ±0.2 | [GH] |
| 38 | KD rate by round (per landed distance power head strike) | R1 5.3% → R2 2.4% → R3 1.5% | ±1 pp | [FN] |
| 39 | KD → KO/TKO conversion (fight level) | 65% of fights with ≥1 KD end KO/TKO; 74% end in any finish | ±5 pp | [GH] |
| 40 | KD → same-round KO/TKO by KD scorer | 57% | ±5 pp | [GH] |
| 41 | KD-fight → KO/TKO by class | FLW 53 · BW 58 · FW 59 · LW 67 · WW 65 · MW 69 · LHW 75 · HW 84; W-SW 44 · W-FLW 47 · W-BW 53 (%) | ±7 pp | [GH] |
| 42 | Fighter scoring ≥1 KD wins | 86% (61% by KO/TKO) | ±4 pp | [GH] |
| 43 | KO/TKO fights containing ≥1 KD | 74% | ±5 pp | [GH] |
| **Strikes to finish / absorption** | | | | |
| 44 | KO/TKO fights: winner sig landed (mean / median) | 38 / 29 | ±5 / ±4 | [GH] |
| 45 | KO/TKO fights: winner head sig landed (mean / median) | 27 / 20 | ±4 / ±3 | [GH] |
| 46 | KO/TKO fights: loser head sig absorbed before stoppage (mean / median) | 11 / 6 | ±3 / ±2 | [GH] |
| 47 | KO/TKO fight duration (mean / median) | 6.1 / 4.9 min | ±0.7 / ±0.6 | [GH]; fightalpha 6.0 |
| 48 | Strikes in final 30 s before TKO | 18.5 (5–46), 92% to head | ±4 | [HUT] |
| 49 | Post-KO strikes before referee intervenes; time to stoppage | 2.6 (0–20); 3.5 s (0–20) | ±1; ±1.5 s | [HUT] |
| 50 | Head sig strikes absorbed per fighter per min (mean / median) | 2.4 / 1.7 | ±0.3 / ±0.3 | [HTE] 2.41 / 1.67; [GH] 2.41 |
| 51 | Head sig strikes absorbed per fighter per fight | 26 | ±4 | [GH] 26.6 |
| 52 | Total head strikes per min (both, incl. non-sig) | 6.3 | ±0.8 | [HTE] |
| 53 | KO/TKO per 100 sig strikes landed (both), by class | FLW 0.28 · BW 0.30 · FW 0.34 · LW 0.39 · WW 0.40 · MW 0.49 · LHW 0.64 · HW 0.64; W-SW 0.13 · W-FLW 0.15 · W-BW 0.21 | ±20% relative | [GH] |
| 54 | KO/TKO per 100 head sig landed, by class | FLW 0.44 · BW 0.49 · FW 0.53 · LW 0.61 · WW 0.64 · MW 0.77 · LHW 1.01 · HW 0.99 | ±20% relative | [GH] |
| **Grappling** | | | | |
| 55 | TD attempts per fighter per 15 min | 4.0 | ±0.5 | [GH-G] 3.99 (3.90 in 2020–26); Fightnomics 4.5 (2008–13) |
| 56 | TD landed per fighter per 15 min | 1.45 | ±0.2 | [GH-G] 1.47 / 1.42; [CQ] median 1.38 |
| 57 | TD accuracy | 38% | ±3 pp | [GH-G] 36.9; [FN] 39–40; [CQ] 40 |
| 58 | TD defence | 62% | ±3 pp | 1 − #57; [CQ] 63 |
| 59 | TD landed per 15 by men's class | FLW 1.8 · BW 1.5 · FW 1.6 · LW 1.6 · WW 1.5 · MW 1.4 · LHW 1.3 · HW 1.2 | ±0.25 | [GH-G] |
| 60 | TD attempted per 15 by men's class | FLW 4.8 · BW 4.4 · FW 4.2 · LW 4.3 · WW 4.0 · MW 4.0 · LHW 3.7 · HW 3.1 | ±0.5 | [GH-G] |
| 61 | TD accuracy by class | flat 35–38% (HW 38) | ±3 pp | [GH-G] |
| 62 | Women's TD landed / attempted per 15 | W-SW 1.4 / 3.7 · W-FLW 1.3 / 3.3 · W-BW 1.2 / 3.2 | ±0.25 / ±0.5 | [GH-G] |
| 63 | TD landed per fight (both), mean / median | 2.1 / 2 | ±0.3 | [GH-G] |
| 64 | TD-per-fight distribution (0/1/2/3/4/5/6+) | 28.5 / 21 / 16 / 11 / 8 / 6 / 8 % | ±4 pp on 0 | [GH-G] |
| 65 | Zero-TD-landed fights by class | FLW 21 · BW 28 · FW 27 · LW 27 · WW 28 · MW 30 · LHW 39 · HW 44% | ±5 pp | [GH-G] |
| 66 | Fighter-bouts with zero TD landed | 55% | ±4 pp | [GH-G] |
| 67 | Winner vs loser TD accuracy | 45–51% vs 26–29% | ±4 pp | [GH-G]; [JAM] |
| 68 | Slam share of landed TDs | 9% | ±3 pp | [FN] |
| 69 | Sub attempts per fighter per 15 min | 0.45 | ±0.15 | [GH-G] 0.48 (0.40 in 2020–26); [CQ] median 0.6 |
| 70 | Sub attempts per fight (both) | 0.65 | ±0.15 | [GH-G] 0.70 / 0.58 |
| 71 | Fights with zero sub attempts | 60% | ±5 pp | [GH-G] |
| 72 | Sub attempts per 15 by class | FLW 0.63 · BW 0.48 · FW 0.53 · LW 0.56 · WW 0.47 · MW 0.51 · LHW 0.36 · HW 0.31 | ±0.15 | [GH-G] |
| 73 | Sub finish rate per (locked-in) attempt | 25% (RNC ≈40%+; guillotine ≈10%) | ±5 pp | [GH-G] 26.3 (30 in 2020–26); [FN] 20–21; bjjequipment guillotine 9.3% |
| 74 | Finishing-sub mix | RNC 39 · guillotine 18 · armbar 12 · arm-triangle 7.5 · triangle 6 · D'Arce 3 · kimura 3 · anaconda 2.5 · heel hook 1.5 · kneebar 1 · other 7.5 (%) | ±3 pp on RNC | [FA-S]; grapplerhq |
| 75 | Chokes / arm locks / leg locks share of subs | 79 / 15 / 3 % | ±4 pp | grapplerhq |
| 76 | Chokes ending in unconsciousness | 11% | ±4 pp | combatsportslaw choke study |
| 77 | Control time per fighter per fight (mean / median) | 2.2 / 1.0 min | ±0.4 / ±0.3 | [GH-G] |
| 78 | Control time as share of fight minutes (both fighters) | 39% | ±5 pp | [GH-G] 40.1 (37.8 in 2020–26) |
| 79 | Winner vs loser control (all / decisions) | 3.0 vs 1.4 min / 4.3 vs 1.9 min | ±0.5 | [GH-G] |
| 80 | Reversals per fight | 0.26 (83% of fights none) | ±0.1 | [GH-G] |
| 81 | Share of sig strikes landed on the ground | 11% (2015–26), trending to 9.5% | ±3 pp | [GH] 10.8; [GH-G] 12.1 (2008–26) |
| 82 | KO/TKO by position | distance 58 · ground 28 · clinch 14 % | ±6 pp | [GH-G] |
| 83 | Ground KO/TKO share by class | men 21–32% (rising with weight); women 39–47% | ±7 pp | [GH-G] |
| 84 | Decisions won by fighter with more control time | 68% (gap <1 min 51%; 1–3 57%; 3–5 70%; 5+ 87%) | ±4 pp | Fight Algorithm; [GH-G] 67.5 |
| 85 | Decisions won by fighter with more sig strikes | 78% | ±4 pp | [GH-G]; JudgeAI 77.8% round-level |
| 86 | Decisions won by fighter with more TDs | 69% | ±4 pp | [GH-G] |
| 87 | Striker wins when more strikes but fewer TDs/control | 60–63% | ±5 pp | [GH-G] |
| **Outcomes** | | | | |
| 88 | Outcome mix (all divisions, modern) | KO/TKO 32% · SUB 18% · DEC 49% · other 1% | ±3 pp each | mma.social 2015–25 band; grapplerhq era 2015–25 finish 49.0% |
| 89 | Outcome mix (all-time) | KO/TKO 33% · SUB 19.5% · DEC 47% · other 1.4% | ±2 pp | grapplerhq; mma.social; sports-statistics |
| 90 | KO : TKO ratio | ≈ 1 : 2 (KO 11.5%, TKO 22.4% of fights; head-strike stoppages 34% KO / 66% TKO) | ±5 pp | Carlton Chin; NSU ringside study |
| 91 | Finish rate by men's class | HW 66 · LHW 61 · MW 59 · WW 52 · LW 51 · FW 45 · FLW 45 · BW 45 (%) | ±4 pp | grapplerhq (Fight Matrix, mma.social within ±3) |
| 92 | KO/TKO % by men's class | HW 48 · LHW 44 · MW 37 · WW 33 · LW 30 · FW 29 · BW 26 · FLW 25 | ±4 pp | Fight Matrix (all-time); [GH] 2015–26 within ±3 |
| 93 | SUB % by men's class | HW 21 · LHW 19 · MW 22 · WW 19 · LW 22 · FW 17.5 · BW 19 · FLW 22 | ±3 pp | Fight Matrix |
| 94 | Women's outcome mix | W-SW 14 / 20 / 66 · W-FLW 17 / 20 / 63 · W-BW 22 / 17 / 60 (KO / SUB / DEC %) | ±4 pp | Fight Matrix; mma.social |
| 95 | Women vs men finish rate | 37% vs 54% | ±4 pp | Sherdog/Fight Matrix to 2022 |
| 96 | Era drift (finish rate) | 1994–2004 74% · 2005–14 55% · 2015–25 49%; annual band 44.5–53.2% since 2010 | — | grapplerhq; mma.social |
| 97 | Regional / amateur finish rate | male amateur ~60% (DEC 40, TKO 28, SUB 23, KO 8); male regional pro ~69% (DEC 31, TKO 30, SUB 26, KO 12); 2024 rival promotions 53–66% | ±5 pp | PMC11569551; Bloody Elbow/Latshaw |
| 98 | Share of finishes by round | R1 53 · R2 30 · R3 15 · R4–5 2 (%) (modern R1 ≈50) | ±4 pp | fightsincage |
| 99 | Share of ALL fights ending in R1 | 26% | ±3 pp | grapplerhq 27.3; mma.social 28.2; fightalpha 24.9 |
| 100 | Conditional finish hazard per round (3R) | R1 0.25 · R2 \| reached 0.21 · R3 \| reached 0.16 | ±0.04 | derived from fightalpha |
| 101 | Mean / median fight duration (3R) | 10.6 / 15.0 min | ±0.8 / — | fightalpha; grapplerhq 10:37 / 13:48 |
| 102 | 5R fights: mean duration / decision rate | 15.5 min / 41% | ±1.0 / ±5 pp | fightalpha |
| 103 | Mean duration by finish type | KO/TKO 6.0 · SUB 6.8 · DEC 15.8 · doctor 9.4 min | ±0.7 | fightalpha |
| 104 | Mean duration by class (min) | HW 9.6 · LHW 9.4 · MW 10.5 · LW 10.6 · WW 11.1 · FW 11.3 · BW 11.5 · FLW 11.6 · W-BW 12.4 · W-SW 12.7 · W-FLW 12.8 | ±0.8 | fightalpha; [PI2] Fig 1.1 similar |
| 105 | Decision type split | unanimous 77 · split 20 · majority 2.5 (%) | ±3 pp | grapplerhq; agentmma 2023–25 78.6/19.3/1.1 |
| 106 | Split-or-majority as share of all fights | 9.5–11% | ±2 pp | grapplerhq |
| 107 | Draws | 0.7% of fights (1.5% of decisions); HW/LHW 3% of decisions | ±0.3 pp | agentmma draw-rate |
| 108 | No contest + DQ | 1.3% of fights | ±0.5 pp | fightomic; grapplerhq "other" 1.4% |
| 109 | Doctor stoppages | ≈0.8–1.1% of fights (≈2.4% of strike stoppages) | ±0.4 pp | Suarez; fightalpha |
| 110 | Referee stoppage lag after KO blow | 3.5 s; 2.6 extra head strikes | ±1.5 s | [HUT] |
| 111 | Within-round finish timing | Hazard highest in first minute of a round, declining toward the horn; final-second finishes ≈0 | qualitative — implement as mild front-load [E] | [HUT]; CBS |
| 112 | Title-fight finish rate (5R) | 57% (47% within first 15 min) | ±5 pp | grapplerhq |
| 113 | Rematch: first-fight winner repeats | 63–66% | ±5 pp | Yahoo/UFCStats; sportsbettingdime |
| 114 | Judge round agreement (3/3 same winner) | 77% | ±4 pp | JudgeAI via agentmma |
| **Mismatch** | | | | |
| 115 | Favourite (better-skilled) win rate at typical odds (−215 / +270) | 65–69% overall; −400 to −900 → 88–93%; pick'em → 50–51%; 5-pp buckets calibrated R² .99 | ±3 pp | multiple (§2.4) |
| 116 | Reach edge win rate | any 51.7%; ≥2.5 in standing-heavy 60%; >7 in 63%; ground-heavy 49% | ±3 pp | Bruin; Fightnomics |
| 117 | Age edge win rate | ≥3–4 yr younger → 58–60% | ±3 pp | Fight Matrix; Fightnomics |
| 118 | Win rate by absolute age | <25 58% → 28–30 52% → 34–36 42.5% → 37+ 38% | ±3 pp | ufcalendar |
| 119 | KO-loss rate by age / KD history | <25 ≈10% → 37+ 25%; never-dropped 14% → 5+ KDs 25% | ±4 pp | ufcalendar |
| 120 | Southpaw vs orthodox | 50–57% for southpaw (use ≈52%) | ±3 pp | Pollet; Fightnomics; Richardson |
| 121 | Heavier at weigh-in (≤6 lb) | 54.5% | ±3 pp | Fight Matrix |
| 122 | Debutant vs veteran | 43% | ±4 pp | betmma |
| 123 | Late replacement | 37% | ±4 pp | betmma via Sherdog |
| 124 | Layoff >210 d / ≥1 yr | 41% / 35% | ±5 pp | Fight Matrix; Fightnomics |
| **Round dynamics** | | | | |
| 125 | Knockdown-rate decay by round | ×1.0 (R1) → ×0.45 (R2) → ×0.28 (R3) relative to R1 | ±0.1 | [FN] 5.3/2.4/1.5% |
| 126 | Submission success decay | R3 ≈ 0.5× R1–R2 success per attempt | ±0.15 | [FN] |
| 127 | Standing low-intensity time per round (median) | R1 154 s · R2 157 s · R3 127 s | ±20 s | Miarka 2016 |
| 128 | High-intensity action count decline (striking sports) | −8% R1→R3 (kickboxing proxy) | ±5% | Ouergui |
| 129 | Trailing fighter TD / sub attempts | −38% / −49% | ±15% | JSA-200478 (snippet, verify) |

Boxing / kickboxing / grappling-sport / judo calibration rows (for those rulesets) are in §2.6; the key ones: pro boxing 51–58 thrown / 15–16 landed per round, connect 28–29%, jab 17–20%, power 35–36%; GLORY (T)KO 32–35%; ADCC/IBJJF elite submission rate 34–42%; Olympic judo ippon ≈65% of matches, golden score ≈35%.

---

## 4. Mismatch effect-size table (for the matchup model)

| Gap | Recommended effect | Basis | Tag |
|---|---|---|---|
| Reach, per inch (2.54 cm) of advantage | +0.5 pp win probability per inch on average; 0 below a 2-in gap; steeper at heavier weights (LHW ≥3 in → 68%), ~0 at BW/FLW; multiply by ~1.5 when the fight stays standing, ×0 when ≥70% on the ground; cap ≈ +15 pp | 51.65% overall → 62.6% at >7 in (Bruin); Fightnomics 60% at ≥2.5 in standing, 49% ground; Kirk bout-level null except HW | [E] built on [S] |
| Reach, per cm | ≈ +0.2 pp per cm (career-level regression, R² .008) | Richardson | [S] |
| Height, per inch (reach held equal) | 0 to slightly negative (−1 pp per inch beyond 2 in at LW/FW); +1 pp per inch at MW–LHW | Fightnomics 48%/46% controlled; fightalpha 4+ in: 46% LW, 43.5% FW vs 56–59% MW–LHW | [E] built on [S] |
| Age, per year of gap | −0.7 pp per year older (linear), effect only material beyond ~3–4 yr gap; ≥3 yr younger → 58%, ≥4 yr → ~60% | ufcalendar bands (58.1% <25 → 37.7% 37+); Fight Matrix 58%; Fightnomics ~60%; Kirk −0.82 yr | [S]/[D] |
| Age, KO susceptibility | Chin durability multiplier: 1.0 at ≤25, ×0.75 at 30, ×0.5 at 35, ×0.33 at 40+ (strikes-per-knockdown falls to one-third from early 20s to 40s); KO-loss rate 10% (<25) → 24.6% (37+) | Fightnomics; ufcalendar | [S]→[E] curve |
| Prior knockdowns / KO losses | KO-loss rate 13.9% (never dropped) → 25.3% (5+ KDs) → 29.3% (after 4th KO loss); OR 1.13 per prior KO for another KO | ufcalendar; PubMed 41674479 | [S] |
| Peak age | 28–32 (median 30.6); by division BW 28.7 … HW 32.0 | ufcalendar; Kirk | [S] |
| Experience (fights) | Debutant vs UFC vet 43/57; treat as ≈ +7 pp for the veteran at debut level; beyond that, experience ≈ age (48.7% <30 min → 52.0% at 120–179 min → 44.1% >180 min) | betmma; ufcalendar | [S]→[E] |
| Weight, small gap (same class) | Heavier by 1.75–6 lb at weigh-in → 54.5% (+4.5 pp) | Fight Matrix 5,719 bouts | [S] |
| Weight, one class up (≈10–15 lb) | **ESTIMATE +8 to +12 pp** for the larger fighter at equal skill; **+15 to +25 pp** two classes up. Basis: small-gap +4.5 pp; knockdown rate rises monotonically with class (Fightnomics; KO risk +80% MW, +100% LHW, +206% HW vs reference — Follmer); size effects only detectable at HW in Kirk; early open-weight UFC showed skill asymmetry dominates size (Gracie, 175 lb, won 3 of first 4 tournaments). No published per-class number exists. | [E] |
| Stance (southpaw vs orthodox) | +0 to +3 pp for the southpaw; Fightnomics head-to-head 57% (after removing reach/age gaps) is the high end; Pollet 50%, career-level 53.5% chance of better record; open-stance bouts finish 18% more often | multiple | [S]→[E] |
| Record quality / streak | 5+ win streak → 61%; champion retention ~66–71%; first-fight winner repeats rematch 63–66% | Fight Matrix; Yahoo; sportsbettingdime | [S] |
| Pace (SSApM) | Low-pace −11 pp, high-pace +7 pp vs baseline | Fightnomics | [S] |
| Layoff | >210 days → 41%; ≥1 yr → 35% (conflicting 57% count unverified); <60 days after KO loss → 13% (n=16) | Fight Matrix; Fightnomics; ESPN | [S] |
| Short-notice replacement | 37% win | betmma via Sherdog | [S] |
| Betting favourite (skill-gap proxy) | Favourites 65–69% overall; −400 to −900 → 88–93%; near-even → 50–51%; upsets 30–32% of fights with a clear favourite | multiple | [S] |

---

## 5. Skill-tier priors

<!-- SKILLTIER_PLACEHOLDER -->

---

## 6. Multi-attacker / street evidence

### 6.1 The "90% of fights go to the ground" claim — provenance and validity

| Claim / statistic | Value | Context | Source | Data or opinion |
|---|---|---|---|---|
| Origin of the study | LAPD Sgt. Greg Dossey (exercise physiologist), 1991 analysis of all 1988 use-of-force narratives: 316,525 arrests; 5,617 (1.7%) use-of-force reports; 2,031 (0.6%) qualified as altercations; 5.6 altercations/day | LAPD 1988 | https://ejmas.com/jnc/2007jnc/jncart_Leblanc_0701.html | Data |
| Actual finding | "Nearly two-thirds of the 1988 altercations (62%) ended with the officer and subject on the ground with the officer applying a joint lock and handcuffing the subject" | same | same | Data |
| Altercation patterns (95% of cases) | Subject pulls away 33.7% (46% ended with takedown) · punches/kicks 25.4% (35% takedown) · refuses search position 19.3% (36.5%) · flees 10.5% (39.5%) · combative posture only 6.8% (41% ended with baton) | same | same | Data |
| Officer injury mechanisms | Kicks 23.4% of injuries · punches 16% · thrown/tripped 15% · bites 11.4%; most common ground injury = strained lower back | same | same | Data |
| Post-training follow-up (1991) | Altercations 5.6 → 1.7/day; officer injuries −17.7%; suspect injuries −34.6% | LAPD | same | Data |
| Calibre Press survey (2003, ~1,400 officers) | 52% reported takedown attempts by suspects; 60% of attempts succeeded; 77% continued grappling after going down; 21% of ground fights involved disarm attempts, 5% successful | US police | same | Data (survey) |
| The "90%" | Not in the study. Popularised by Rorion Gracie / Gracie marketing in the late 1980s–90s; the study concerns arrests where officers are trained to take suspects to the ground to cuff them — not two civilians fighting | — | https://sgskravmaga.com.au/fights-end-up-on-the-ground-fact-or-fiction/ ; https://wimsblog.com/2013/01/the-myth-of-90-percent-of-fights-go-to-the-ground/ ; http://cbd.atspace.com/articles/90percentmyth/90percentmyth.html | Critique (opinion + the primary data above) |
| YouTube sample 1 (Gracie Combatives student, 100 fights) | Ground fighting in 73% of fights (83% excluding ≤10 s KOs); 23% ended by KO, 64% of those in first 10 s; 26% had third-party involvement (68% of those = "friend jumps in"); 48.4% ended indecisively; men clinch 50%, women 79% | YouTube, self-selected | https://ccwbreakaways.com/blog/street-fight-statistics/ (via BJJEE) | Data (weak: non-random, pro-grappling coder) |
| YouTube sample 2 | Both fighters went to the ground in only 42% of fights | YouTube | https://jiujitsuwanderer.wordpress.com/2012/01/04/what-percentage-of-fights-go-to-the-ground/ (as reported in search) | Data (weak) |

Verdict: the only primary datum is 62% of *LAPD arrests that became altercations* ending on the ground, with the officer deliberately taking the suspect down. YouTube-fight samples range 42–73% for "someone went to the ground", biased toward filmed, prolonged fights. A defensible simulator prior [E]: **40–60% of untrained one-on-one fights involve at least one participant hitting the ground; ~25% end in a KO within the first 10–30 s; ~45–50% end indecisively (separated/stopped)**.

### 6.2 Number of assailants and outcomes

| Claim / statistic | Value | Context | Source | Data or opinion |
|---|---|---|---|---|
| Assaults on police by 2+ assailants | "40 percent of all assaults against police officers are by two or more assailants" (no primary citation given) | US police | https://www.policemag.com/articles/wolf-pack-multiple-assailants | Data (secondary, uncited) |
| Officer assault injury rate | 2016: 28.9% of 57,180 assaulted officers injured; 2018: 30.6% of 58,866; 2021: 35.2% of 43,649 | FBI LEOKA | https://ucr.fbi.gov/leoka/2018/resource-pages/about-leoka ; https://leb.fbi.gov/bulletin-highlights/additional-highlights/crime-data-law-enforcement-officers-assaulted-in-2021 | Data |
| Violent incidents with injury, number of assailants | 70% single assailant; 13% involved four or more assailants | CSEW (England & Wales) serious-violence victims 2011–17 | https://library.college.police.uk/docs/college-of-policing/Victim_of_serious_violence.pdf (snippet; fetch blocked) | Data |
| Gang-perpetrated share | ~8% of violent incidents perpetrated by people believed to be gang members | CSEW | https://www.ons.gov.uk/peoplepopulationandcommunity/crimeandjustice/compendium/focusonviolentcrimeandsexualoffences/yearendingmarch2015/chapter1overviewofviolentcrimeandsexualoffences | Data |
| Alcohol in stranger violence | 64% of stranger violence alcohol-related (vs 52% acquaintance, 36% domestic) | CSEW | https://www.ons.gov.uk/peoplepopulationandcommunity/crimeandjustice/compendium/focusonviolentcrimeandsexualoffences/2015-02-12/chapter5violentcrimeandsexualoffencesalcoholrelatedviolence | Data |
| Group fights on video (Weenink & Bruggeman) | 42 videos (YouTube/LiveLeak/WorldStar), mean clip 101 s (30 s–5 min); 25 of 84 potential groups attacked a single individual; mean group size 3.6 (dyads 40.7%, triads 18.6%, 4+ 40.7%; one group of 14); violence "bursts" (≥half the group joins within 2 s) in 39% of groups; non-fighter share 0.19 in bursts vs 0.49 in non-bursts; predicted participation threshold 1/3 | street group violence | https://arxiv.org/html/2112.05088 ; https://www.frontiersin.org/journals/physics/articles/10.3389/fphy.2026.1853069/full | Data |
| Who actually fights in groups | "Fighting tends to start in small groups or in small subgroups of larger groups"; violent subgroups "3 to maximally 6 individuals"; per Collins, small subgroups briefly attack "stumbling, isolated or otherwise vulnerable individuals" while the rest are an audience | video analyses | https://ar5iv.arxiv.org/html/1312.6809 ; https://journals.sagepub.com/doi/10.1177/0003122411428221 | Data + theory |
| Bystanders | In 9 of 10 public conflicts at least one bystander intervenes (N=219 CCTV, UK/NL/ZA); more bystanders → more likely someone intervenes | CCTV | https://research.vu.nl/en/publications/would-i-be-helped-cross-national-cctv-footage-shows-that-interven/ | Data |
| Bystanders (Levine 2011) | 42 CCTV assaults, 228 bystanders: third parties mostly de-escalate; tendency increases with group size; multiple conciliators succeed more often | CCTV | https://doi.org/10.1177/0956797611398495 | Data |
| Third-party aggression | Third parties mirror antagonists' aggression level (video-based) | video | https://doi.org/10.1177/08862605211023503 | Data |
| Multiple-assailant survival tactics (police doctrine) | "A multiple-assailant situation is ... a survival situation"; screening/stacking ("putting assailants between each other"), moving between assailants, redirecting momentum, using door frames/hallways as funnels; "as little as 14 seconds can make the difference"; target leadership, cause visible injury | police trainer | https://www.policemag.com/articles/wolf-pack-multiple-assailants | Expert opinion |
| Self-defence doctrine (Krav Maga et al.) | Stay mobile, line attackers up so only one can engage, never go to the ground voluntarily, escape as the objective | instructors | https://www.bostonkravmaga.com/blog/krav-maga/krav-maga-strategies-principles/multiple-assailants.html ; https://kravstore.nl/nine-street-fighting-tactics-for-a-multiple-attacker-fight/ | Expert opinion |
| "500 encounters" figures | Avg 8.7 s; 73% end <10 s; avg 4.3 participants; 91% loss rate vs 3+ attackers; 31% weapons; 68% win rate for first strike; 78% loss when going to ground voluntarily | self-defence school blog, **no method, no source** | https://www.cvpsd.org/post/lesson-from-500-violence-encounter-research-real-fights-avoidance-wins-every-time | UNVERIFIED — do not calibrate on this |

### 6.3 Untrained fight dynamics: duration, injuries, KO

| Claim / statistic | Value | Context | Source | Data or opinion |
|---|---|---|---|---|
| Duration (≈200 street fights) | Mean 45 s; only 20% >1 min; KO wins generally inside first 30 s; fights >1 min seldom had a clear winner | blog analysis of online videos (original post now 404) | https://www.writersdigest.com/write-better-fiction/10-myths-writers-shouldnt-believe-about-fighting-fightwrite (citing highpercentagemartialarts.com) | Data (weak) |
| Duration (group-fight clips) | Clip length 101 ± 59 s (left-truncated) | Weenink/Bruggeman | https://arxiv.org/html/2112.05088 | Data |
| KO timing | 23% of 100 filmed fights ended in KO; 64% of those in first 10 s | YouTube | ccwbreakaways (above) | Data (weak) |
| Assault injury mechanism | Punching in 72% of assaults, kicking 42%; knife 6%, glass 11%; 26% had ≥1 fracture; facial = 83% of fractures; nasal 27%, zygoma 22%, mandible body 12%/angle 12%/condyle 9%; 17% admitted; those kicked most likely to need admission | 539 A&E assault victims, UK 1986 | https://pmc.ncbi.nlm.nih.gov/articles/PMC1292500/ | Data |
| Assault mechanism combos | Combinations of mechanisms 57.5%; victim fell in 50.1% of assaults; fist used in 67% | assault facial fractures | https://www.sciencedirect.com/science/article/pii/S0901502721002095 (snippet) | Data |
| One-punch ("coward punch") deaths, Australia | 90 deaths 2000–2012; 80 deaths 2012–2018 (169 since 2000); almost all male; victim median age 43.5; alcohol detected in 47/71 (66.2%) of victims with toxicology; mechanism = punch causes fall, fatal injury usually from secondary head impact on ground | national forensic data | https://www.sciencedirect.com/science/article/pii/S0379073823000713 ; https://pubmed.ncbi.nlm.nih.gov/36878145/ ; https://www.vifm.org/combatting-coward-punch-assaults-research-legislation/ | Data |
| One-punch convictions | 287 convictions 1990–2020; offender median age 26; 65% in public places, mostly 6 pm–6 am; alcohol 39% of cases; self-defence succeeded 2.1% | Australia | https://phys.org/news/2025-05-coward-fatalities-australia.html ; https://journals.sagepub.com/doi/10.1177/00258024251316669 | Data |
| Ground-impact vs punch | Two-stage profile: punch incapacitates → secondary head impact "typically causes the fatal injury" | forensic | https://www.vifm.org/combatting-coward-punch-assaults-research-legislation/ | Data (qualitative) |
| Untrained punch force | Novice boxers 1,604 N lead / 2,381 N rear vs elite 2,847 / 4,800 N (lab); in-ring pro mean per-punch 867–1,149 N | lab / ring | see §2.6 | Data |
| Concussive threshold | Hook 71.2 g / 9,306 rad/s² "consistent with concussive NFL impacts"; straight 58 g; fist ≥10 m/s → >50 g | lab | https://pubmed.ncbi.nlm.nih.gov/16183766/ | Data |
| Trained-fighter vs multiple untrained | No empirical dataset found. [gap] | — | — | — |
| Sustained max-effort budget | K1 lactate 11.3 mmol/L after one 2-min round, 14.6 after three; HR 178–185 bpm | elite kickboxers | Frontiers 2021 (above) | Data |

### 6.4 Simulator implications for "crowd" mode [E, anchored on the above]

1. **Engagement geometry**: model at most 2 attackers able to strike a single defender effectively at any instant, with the rest in a "fringe" queue (Collins/Weenink: violent subgroups 3–6, and sub-groups attack isolated individuals; police doctrine of stacking/funnels). No number exists for the fringe fraction; use non-fighter share 0.19 (burst) / 0.49 (non-burst) from Weenink for how many of a hostile group actually engage.
2. **Timing**: untrained one-on-one fights are short — median well under a minute; KOs mostly inside 10–30 s; ~half end indecisively. Group attacks "burst" within ~1–2 s once half the group commits.
3. **Ground = catastrophic risk when outnumbered**: kicks were the injury mechanism most likely to require hospital admission (1986 A&E series) and 23.4% of LAPD officer injuries; the fatal mechanism in one-punch deaths is the head hitting the ground. Apply a large per-second damage multiplier for a downed defender with ≥1 standing attacker.
4. **Untrained striking**: novice punch force ≈ 50–60% of elite; accuracy prior ≈ amateur losers' 23% hit rate (Olympic boxing losers) or below; volume in bursts. Alcohol present in ~2/3 of stranger violence.
5. **Bystanders**: in 9/10 public conflicts someone intervenes; 26% of filmed fights had a third party join, usually as a "friend jumps in". A crowd is not all hostile.

---

## 7. Assumptions and gaps

<!-- GAPS_PLACEHOLDER -->
