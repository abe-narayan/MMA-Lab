# Damage, Consciousness, Fatigue and Recovery: Research Brief for the MMA Simulator

Research agent output, 2026-09-22. Sports-science research for a game; injury is treated abstractly.

Labelling convention used throughout:

- **[S]** = number taken directly from a cited source (abstract verified via Europe PMC / PubMed on 2026-09-22 unless noted).
- **[S-mem]** = number attributed to a real, cited paper but quoted from memory; the abstract could not be re-verified in this session. Treat as "probably right, check before publishing".
- **ESTIMATE** = agent's calibrated guess for a sim parameter, informed by the cited evidence and by fight observation; no source gives this number directly.

Note on method: the session's web-search budget was exhausted before this task began, so the literature was pulled by direct DOI/PMID abstract fetches from Europe PMC. Everything marked [S] was read in the abstract; nothing marked [S] is invented. Grey-literature sources (UFC Performance Institute reports, Jack Slack essays, Fightnomics) could not be fetched and are cited only as [S-mem] or used to justify ESTIMATEs.

---

## 1. Summary

**What the literature actually pins down**

- Match-ending head trauma in the UFC: KO 6.4 / 100 athlete-exposures (12.7 % of bouts), TKO-by-strikes 9.5 / 100 AE (19.1 %), combined 31.9 % of bouts (Hutchison 2014, 844 UFC bouts 2006-12) [S]. Rates scale steeply with weight: KO/TKO in 7.9 % of women's strawweight bouts vs 52.1 % of male heavyweight bouts (Follmer 2019, 1903 bouts 2014-17) [S].
- Every KO in the Hutchison video review came from a direct head impact; 53.9 % to the mandibular region (jaw/chin). Mean 3.5 s (range 0-20 s) from KO strike to referee stoppage, with 2.6 (0-20) additional head strikes landing on the defenceless fighter. In TKOs, the loser absorbed a mean 18.5 strikes (5-46) in the final 30 s, 92.3 % to the head [S].
- Risk factors for KO/TKO (logistic regression): heavier weight class, earlier in the round, earlier round, older age, and (for KO) prior KO/TKO history and match significance [S].
- An Olympic straight punch to a Hybrid III jaw: 3427 ± 811 N, hand speed 9.14 m/s, effective mass 2.9 kg, head 58 ± 13 g translational, 6343 ± 1789 rad/s² rotational (Walilko 2005) [S]. Hooks are worse: 4405 ± 2318 N, 71.2 ± 32.2 g, 9306 ± 4485 rad/s² (Viano 2005) [S]. The nominal 50 % concussion point from 300,977 instrumented football impacts is 6383 rad/s² with 28.3 rad/s (Rowson 2012) [S]. So an average clean elite punch to the jaw sits right at the 50 % concussion line; an average hook is above it. That is why "clean" matters more than "hard".
- Rotational (angular) acceleration is the KO mechanism; the jaw is the longest lever arm on the skull, and boxing punches produce proportionately more rotational than translational acceleration (65 mm effective radius vs 34 mm in football) with peak strain in the midbrain late in the impulse (Viano 2005) [S]. Anticipation and neck bracing measurably reduce head velocity change (Eckner 2014) [S]; unanticipated collisions are more severe (Mihalik 2010) [S]; each 1 lb of neck strength lowered concussion odds by 5 % in a 6,704-athlete cohort (Collins 2014) [S].
- A history of 3+ concussions tripled the odds of another (OR 3.0, 95 % CI 1.6-5.6), and 92 % of within-season repeat concussions occurred within 10 days (Guskiewicz 2003) [S]. Cumulative fight exposure lowers thalamic/caudate volume and processing speed (Bernick 2015, PFBHS) [S]. Age > 35 is a formal "older fighter" risk category (ARP 2024) [S].
- Energy systems: MMA post-bout blood lactate 10.2-20.7 mmol/L, RPE 13-19 (Amtmann 2008) [S]; official bouts induce "similar high-intensity glycolytic demands" to sparring but with elevated pre-fight glucose (Coswig 2016) [S]; effort:pause 1:2 to 1:4 in MMA (Del Vecchio 2011) [S]; amateur boxing is "predominantly aerobic" in total energy accounting, with PCr recovery in the break being the key to sustained output (Davis 2014) [S]. Fatigue and muscle damage persist 24 h post-bout (Ghoul 2019) [S].
- PCr after a 30-s all-out effort: 19.7 % of rest at the end, 65 % after 90 s, only 85.5 % after 6 min; half-time 56.6 s; peak power recovery tracks PCr (Bogdanis 1995) [S]. A 60-s round break therefore restores roughly half of the "burst" pool but almost none of the glycolytic acidosis.
- Altitude: VO2max falls ~6.3 %/1000 m (4.6-7.5 %) and time-to-exhaustion ~14.5 %/1000 m for un-acclimatised athletes (Wehrlin 2006) [S].

**What the literature does not pin down (and where the sim must use ESTIMATEs)**: durations of "rocked" states, knockdown-to-finish conversion, per-strike power decline with fatigue, body-shot and leg-kick thresholds, cut rates by weapon, and the "chin" attribute. Those are modelled below with explicit ESTIMATE labels.

---

## 2. Multi-region damage model

Regions: `head`, `body`, `leadLeg`, `rearLeg`, `arms`, `cuts` (a per-site list). Each region carries two pools:

- **acute** (0-100): short-lived shock; drives rocked/knockdown/collapse; decays in seconds.
- **structural** (0-100): accumulated tissue damage; drives long-term capability loss; decays over minutes/rounds, and some fraction is permanent for the bout.

Damage input per landed strike: `raw = P_weapon * v_rel * cleanMult * targetMult * (1 - absorb)`, where `absorb` comes from guard/roll/brace (see 3.3). The tables below give region-specific parameters.

### 2.1 Head

| Parameter | Value | Basis |
|---|---|---|
| Acute decay half-life | 8 s while not being hit; 20 s if hit again within the window | ESTIMATE. Referees allow a hurt fighter who is defending intelligently to continue; the visible "legs return" window observed in fights is ~10-30 s. No published in-fight measurement exists. |
| Structural decay | 25 % of accumulated structural head damage clears across a 60-s break; 0 % clears within a round | ESTIMATE, anchored by Guskiewicz 2003 (repeat-injury window measured in days, so within-bout recovery of vulnerability should be near-zero) [S]. |
| Permanent (bout-scope) fraction | 40 % of every structural increment never decays during the bout | ESTIMATE; represents progressive vulnerability. Hutchison 2014 found earlier-round KO/TKO risk is *higher*, so vulnerability must not dominate the "fresh fighter" effect (fresh fighters throw harder, unseen shots are more common early) [S]. |
| Rocked threshold | acute >= 45 | ESTIMATE |
| Knockdown threshold | acute >= 65 or single-impact rotational-equivalent above the KD line (Section 3) | ESTIMATE |
| KO (unconscious) threshold | acute >= 90 or Section 3 P(KO) roll succeeds | ESTIMATE |
| Progressive vulnerability | each landed head strike multiplies the *next* head strike's damage by `1 + 0.006 * structuralHead` (max 1.6x) | ESTIMATE. Direction supported by Guskiewicz 2003 [S] and Hutchison 2014's prior-KO risk factor [S]; slope is a guess. |

**Sub-locations** (multiplier on `acute`, applied before threshold check). Basis: rotational-lever reasoning (Viano 2005 [S]) and Hutchison 2014's 53.9 % mandibular share of KO blows [S]; individual multipliers are ESTIMATE:

| Sub-location | acute mult | structural mult | Notes |
|---|---|---|---|
| Chin / jaw (mandible) | 1.35 | 0.9 | longest lever; rotation about the atlanto-occipital joint; P(KO) hotspot |
| Temple / behind ear (mastoid) | 1.25 | 1.0 | lateral rotation; classic "off-switch" from hooks and head kicks |
| Nose / mouth (mid-face) | 0.85 | 1.15 | eyes water, breathing impaired, nose breaks; low KO share |
| Forehead / crown | 0.6 | 0.9 | "hardest bone"; hand-injury risk to the attacker (see 2.5) |
| Top / back of head (illegal targets aside) | 0.7 | 1.0 | |
| Eye socket (orbit) | 0.8 | 1.3 | cut and swelling site; doctor-stoppage risk |

**State effects (head)**

| State | Duration | Capability change | Behaviour change | Basis |
|---|---|---|---|---|
| **Stunned** (acute 30-45) | 2-6 s | reaction time +15 %, accuracy -10 %, defence -10 % | none forced; AI may switch to clinch/retreat | ESTIMATE |
| **Rocked** (acute 45-65) | 5-25 s, exponential recovery once the attacker stops landing (t½ 8 s) | movement/footwork -40 % ("legs gone"), guard/head-movement -35 %, accuracy -25 %, power -15 %, decision quality -40 % ("fighting on instinct": throws instinctive counters, forgets game plan), takedown defence -30 % | referee attention raised; opponent aggression sharply increased; experienced fighters bias to clinch/grab/shoot, inexperienced fighters bias to trade | Durations ESTIMATE. Behaviour described consistently by ringside physicians and analysts; no quantitative study. |
| **Flash knockdown** (single clean impact, acute 65-80 but not KO) | on the floor 1-3 s; can stand immediately; residual rocked for 5-15 s | as Rocked, plus grounded exposure to follow-up strikes | opponent follow-up attack; referee watching for intelligent defence | ESTIMATE. Hutchison 2014's 0-20 s stoppage range shows some fighters recover under fire [S]. |
| **Knockdown (hurt)** (acute 65-90) | rocked 15-40 s; must survive follow-up | as Rocked but worse (defence -50 %); "turtle/cover/grab a leg" behaviours | see Section 5 for stoppage | ESTIMATE |
| **KO** (acute >= 90) | fight over; unconscious 5-90 s | n/a | n/a | Hutchison 2014: mean 3.5 s to stoppage, 2.6 extra strikes [S]. |

### 2.2 Body

Targets: liver (right side, under ribs), solar plexus/diaphragm, ribs/floating ribs, spleen (left), sternum/heart, lower abdomen.

| Parameter | Value | Basis |
|---|---|---|
| Acute decay | t½ 12 s; body pain lingers longer than head shock but rarely ends the fight if the fighter survives the first 10 s | ESTIMATE |
| Structural decay | 15 % per round break; body damage taxes cardio for the rest of the fight | ESTIMATE |
| Liver-shot delayed collapse | trigger on a clean liver strike with `raw >= 35`: 0.5-3 s delay, then involuntary drop; fighter usually conscious, cannot rise for 5-20 s (vagal/hypotensive response + diaphragm spasm) | ESTIMATE. Mechanism (vagal reflex, hepatic capsule stretch) is standard ringside-physician explanation; no biomechanical threshold is published. |
| Solar plexus | "wind knocked out": 3-15 s of unable-to-breathe; recovery is quick if not followed up | ESTIMATE |
| Body damage -> fatigue coupling | each 10 points of body `structural` raises per-action energy cost by 4 % and lowers aerobic recovery rate by 6 % | ESTIMATE, reflecting diaphragm splinting and breathing-guard behaviour; direction widely reported by coaches, not quantified in literature. |
| Body-shot finish share | ~4-6 % of all KO/TKOs | ESTIMATE from fight observation; Hutchison 2014 found *all* KOs (loss of consciousness) were head impacts [S], so body finishes are always TKO/"KO" by collapse, never true unconsciousness. |

State: **Body-hurt** (acute >= 50): guard drops to protect body (head exposure +30 %), movement -20 %, output -30 %, 8-20 s. **Body collapse** (liver/solar trigger or acute >= 80): grounded, cannot intelligently defend for 5-20 s; referee stoppage logic applies (Section 5).

### 2.3 Lead leg and rear leg (separate pools)

| Parameter | Value | Basis |
|---|---|---|
| Acute decay | t½ 20 s | ESTIMATE |
| Structural decay | 10 % per round break; leg damage is close to cumulative within a bout | ESTIMATE. Muscle-damage markers stay elevated 24 h post-bout (Ghoul 2019) [S]. |
| Thigh (outer/inner) kick damage | raw x 1.0 | baseline |
| Calf/peroneal kick | raw x 0.8 acute, x 1.5 structural, plus 5 % chance per clean landing of "foot drop" event (peroneal nerve): -50 % mobility instantly for 30-90 s | ESTIMATE. Mechanism: common peroneal nerve at the fibular head; widely discussed after the 2019-21 calf-kick wave; no controlled data. |
| Checked kick | attacker takes 60 % of the damage to shin (`arms/legs` structural), defender 15 %; 0.3 % chance per checked hard kick of a catastrophic attacker shin injury (fight over) | ESTIMATE; catastrophic tibial fractures are rare but well documented (e.g., Silva-Weidman 2013). |
| Mobility loss curve | mobility = 1 - 0.7 * (structural/100)^1.5 per leg; combined mobility uses the worse leg at 70 % weight | ESTIMATE |
| Leg-kick TKO | structural >= 85 on a leg or acute >= 70: fighter cannot stand/base -> referee TKO if unable to continue | ESTIMATE. Leg-kick TKOs are ~1-2 % of UFC finishes (ESTIMATE, no study). |

Effects at thresholds: structural 30 -> stance visibly compromised, lead-leg check/kick output -20 %, power -10 %; structural 55 -> fighter switches stance or stops planting, takedown defence -25 %, power on rear-hand -20 %; structural 75 -> limps, stalks flat-footed, cannot chase; TKO risk.

Compartment syndrome: real but rare and typically post-fight; do not model in-fight.

### 2.4 Arms (guard, forearms, hands)

Arm damage arises from blocked kicks and elbows on the forearm/biceps ("dead arm"), and from the attacker's own hand strikes on the opponent's skull.

| Parameter | Value | Basis |
|---|---|---|
| Blocked head kick to the arm | 40 % of raw to arm structural | ESTIMATE |
| Dead-arm state (arm structural >= 50) | that side's guard height -25 %, punch power -20 %, 60 s minimum | ESTIMATE; observed (e.g., fighters dropping a lead hand after eating kicks). |
| Broken/injured hand on the attacker | per landed **punch** to skull (forehead/crown/temple): 0.15 % chance; to jaw/soft targets: 0.04 %; hammerfists/elbows: 0.02 %; hand injury -> that hand's power -35 %, pain -> use frequency -50 % | ESTIMATE anchored on epidemiology: hand injuries 13.5 % of MMA injuries (Bledsoe 2006) [S], wrist/hand 6-12 % (Lystad 2014) [S]; hand/wrist competition injury rate in GB elite boxing 347 / 1000 h (Loosemore 2017) [S]. A 15-min MMA bout with ~150 punches each is a large fraction of an hour, so 1-3 % of fighters per bout incurring a meaningful hand injury is consistent. |
| Broken foot (attacker) | per landed kick on an elbow/knee: 0.3 % | ESTIMATE |

### 2.5 Cuts (per site, list)

Sites: left/right eyebrow (supraorbital), left/right eyelid, bridge of nose, cheek, scalp/hairline, lip/mouth.

| Parameter | Value | Basis |
|---|---|---|
| Cut probability per clean landing, elbow to head | 6 % | ESTIMATE. Lacerations are 36.7-59.4 % of all MMA injuries (Lystad 2014) [S] and 47.9 % (Bledsoe 2006) [S]; boxing (no elbows) also shows lacerations as the majority injury (Zazryn 2009) [S], so punches cut too, but elbows are the sharpest weapon by consensus. |
| Cut probability, punch (bare 4-oz glove) to brow/orbit | 1.2 %; to other head zones 0.4 % | ESTIMATE |
| Cut probability, knee/head-clash | 3 % / 8 % | ESTIMATE |
| Cut severity | severity 1-3 drawn on creation (weights 60/30/10); grows +1 for each 5 further clean strikes on that site | ESTIMATE |
| Bleeding into eye | eyebrow/eyelid cuts severity >= 2: vision on that side -25 %, accuracy -10 %, defence -10 %; severity 3: -50 % vision | ESTIMATE |
| Doctor check trigger | severity 3 anywhere, or severity 2 on an eyelid, or bleeding into the eye for > 60 s of fight time | ESTIMATE, based on standard ringside-physician practice (cuts that threaten the eye, cross the eyelid margin or vermilion border, expose bone, or cannot be controlled are the classic stoppage criteria). ARP position statements list is at https://ringsidearp.org/consensus-statements/ [S: index fetched; individual statements not readable in this session]. |
| Cutman effect | between rounds: severity -1 for one cut (priority: worst), never below 1; cuts re-open on the next 2 clean strikes | ESTIMATE |
| Doctor-stoppage share of finishes | 2-4 % of all bouts | ESTIMATE |

### 2.6 Eye pokes and other fouls

Unified Rules allow up to 5 minutes for recovery from a foul (groin or eye poke) at the referee's/doctor's discretion; a fighter who cannot continue after an accidental foul results in a No Contest (before the required rounds) or a technical decision [S-mem: ABC Unified Rules of MMA, 2017 revision]. Model: eye-poke chance per open-hand-forward extension 0.6 % (ESTIMATE; UFC broadcasts show roughly one poke per 5-10 fights), 30-300 s pause, 10 % chance of lasting vision -20 % for the bout, 3 % chance of fight-ending injury.

---

## 3. Consciousness / KO model

### 3.1 Physical scale

Map each landed head strike to an **equivalent rotational acceleration** `alphaEq` in rad/s², because that is the quantity with a published risk curve.

Reference points [S]:

| Strike | Force (N) | Head lin. acc (g) | Head rot. acc (rad/s²) | Source |
|---|---|---|---|---|
| Olympic straight punch to jaw, Hybrid III | 3427 ± 811 | 58 ± 13 | 6343 ± 1789 | Walilko 2005 |
| Olympic hook | 4405 ± 2318 | 71.2 ± 32.2 | 9306 ± 4485 | Viano 2005 |
| Taekwondo turning (roundhouse) kick to helmeted headform | n/a | 130 ± 52 (helmeted) | not measured | Fife 2013 |
| Football, avg sub-concussive impact | n/a | n/a | 1230 | Rowson 2012 |
| Football, avg concussive impact | n/a | n/a | 5022 (22.3 rad/s) | Rowson 2012 |
| 50 % concussion risk | n/a | ~82 g [S-mem, Zhang 2004] | 6383 (28.3 rad/s) | Rowson 2012 [S]; Zhang 2004 gives ~5900 rad/s², 82 g, HIC 235 for 50 % [S-mem] |

Sim mapping (ESTIMATE): `alphaEq = 6300 * (F / 3400) * leverMult * cleanMult * bodyMassScale`, where

- `F` is the weapon's delivered force (elbows ~= hooks, head kicks ~= 1.5-2x a hook because of the 130 g headform result; knees ~= 1.5x; hammerfists on the ground 0.6x; ground-and-pound straight punches 0.8x since the head is backed by the mat and cannot rotate freely -> lower rotational but higher translational load, which is why ground KOs look "accumulated" rather than "clean"),
- `leverMult` = 1.3 chin, 1.2 temple/behind-ear, 0.7 forehead, 0.8 mid-face,
- `cleanMult` = 1.0 flush, 0.5 partially blocked, 0.25 glancing/rolled-with,
- `bodyMassScale` = (defender head+neck effective mass relative to 75 kg fighter)^-0.5; heavier fighters have heavier heads but also far heavier fists: Follmer 2019 shows the net effect is strongly *pro-KO* at heavyweight (52.1 % vs 7.9 %) [S], so the attacker's mass term must dominate the defender's mass term.

### 3.2 Probability of knockout per impact

Use a logistic on `alphaEq` with the Rowson 50 % point, then scale by modifiers:

```
z = (alphaEq - 6383) / 1800           // 1800 ≈ pooled SD of the boxing data
pConcuss = sigmoid(z)                   // P(concussive event | impact)  — literature-anchored
pKO   = pConcuss * kKO                  // fraction of concussive events that are loss-of-consciousness
```

`kKO` baseline 0.22 (ESTIMATE): Hutchison's 12.7 % KO vs 19.1 % TKO split, plus the many concussive-but-not-KO ("rocked") events that never end the fight, implies most concussive impacts do not produce unconsciousness. Remaining `pConcuss - pKO` is distributed: 45 % rocked, 25 % flash knockdown, 8 % hurt knockdown (ESTIMATE).

**Modifiers (multiplicative on `alphaEq` unless stated)**

| Modifier | Value | Basis |
|---|---|---|
| Unseen / unanticipated strike | x 1.35 | Eckner 2014: anticipatory neck activation and neck strength both reduce head ΔV and Δω [S]; Mihalik 2010: unanticipated collisions more severe, especially in the 50th-75th percentile band [S]. Magnitude ESTIMATE. |
| Defender's neck-brace attribute (0-1) | x (1.15 - 0.30 * neck) | Collins 2014: -5 % odds per lb neck strength [S]. |
| Defender relaxed / mid-strike / mouth open | x 1.2 | mechanism: jaw slack -> larger mandibular excursion; ESTIMATE |
| Defender moving into the strike | x (1 + 0.5 * closingSpeed / 3 m/s) | kinematics; ESTIMATE |
| Fatigue (fighter's fatigue index f, 0-1) | x (1 + 0.25 * f) on `alphaEq`; also lowers defensive absorption | ESTIMATE; late-round KOs are common but Hutchison found *earlier* rounds carry higher KO risk [S], so keep this modest. |
| Prior in-bout head damage | x (1 + 0.006 * structuralHead), cap 1.6 | ESTIMATE (see 2.1) |
| Career KO history | `kKO` x (1 + 0.25 * min(priorKOs, 4)) | Hutchison 2014: prior KO/TKO is a KO risk factor [S]; Guskiewicz 2003: OR 3.0 for 3+ concussions [S]. |
| Age | `kKO` x 1.0 at <= 30, +4 %/yr after 30, +8 %/yr after 35 | Hutchison 2014: older age a risk factor [S]; ARP "older fighter" threshold at 35 [S]. Slope ESTIMATE. |
| Chin attribute (0-1, 0.5 = median) | `z -= (chin - 0.5) * 2.0` (i.e., a 0.9-chin fighter needs ~+1450 rad/s² more; a 0.1-chin fighter ~1450 less) | ESTIMATE. Individual variation in concussion tolerance is real (Rowson's data show concussions from ~2000 to > 10,000 rad/s²), heritability unknown. |
| Weight-cut dehydration (fraction of body mass cut that is not regained, d) | `z += 3 * d` (a fighter still 3 % down at fight time is 0.09 z worse) | ESTIMATE; the hypothesised mechanism (reduced CSF/brain buffering) is widely cited by ringside physicians and in the ARP weight-management statement but is not quantified in humans. |
| Ground (head on mat) | `alphaEq` x 0.7 but `structural` x 1.3 | ESTIMATE; ground KOs are typically accumulative TKOs |

### 3.3 Absorption from defence

`absorb` (fraction of raw removed before it becomes damage): rolled with / slipped-late 0.6; blocked with forearm 0.5 (goes to arms pool at 40 %); "chin down, shoulder up" braced 0.3; caught flush 0.0. Defensive skill and awareness feed this; being Rocked halves all absorb values.

### 3.4 Recovery from a rocked state

`acuteHead` decays exponentially, t½ 8 s, only while no head strike lands; each landed head strike during the rocked state resets the timer and adds damage. A fighter who clinches or grabs a leg, or whose opponent gasses/waits, typically exits Rocked in 10-25 s (ESTIMATE). Referee-observed signals used for stoppage (Section 5) key off `acuteHead` and the fighter's action choice, not off the raw damage.

---

## 4. Fatigue model

### 4.1 Energy pools (three-compartment)

| Pool | Capacity (arbitrary units, 100 = fresh) | Refill | Basis |
|---|---|---|---|
| **Phosphagen (PCr / alactic)** | 100; supplies bursts (any max-effort action: power punch flurry, takedown, sprawl, scramble) | exponential toward its ceiling with t½ ~ 30 s during low-intensity phases in-round (dynamic-exercise half-times are 20-30 s; Bogdanis 1995 measured 56.6 s after a 30-s all-out sprint [S]). In the 60-s round break use t½ 45 s -> ~60 % of the deficit refilled. Ceiling is reduced by glycolytic acidosis (see below). | Bogdanis 1995 [S]; Davis 2014 identifies PCr recovery in breaks as the decisive requirement in boxing [S]. |
| **Glycolytic (lactic)** | tracks blood lactate 1-22 mmol/L; every burst adds lactate; sustained medium output adds slowly | clearance 0.3-0.5 mmol/L/min at rest, ~2x with active recovery; effectively **no** meaningful clearance in a 60-s break. Across a 15-min bout it only accumulates. | Amtmann 2008: post-bout 10.2-20.7 mmol/L [S]; Coswig 2016 and Ghoul 2019 confirm high glycolytic demand [S]. Clearance rates are textbook physiology (ESTIMATE for the sim constants). |
| **Aerobic** | governs the *rate* at which the phosphagen pool refills and lactate clears; represented as a fighter attribute `vo2` (0-1) and a running "aerobic debt" | HR model: in-round HR 88-95 % HRmax (typical combat-sport data); HR drops 20-40 bpm in the first minute of recovery in trained athletes (ESTIMATE; textbook HRR1 values). | Davis 2014 [S]; Ghoul 2019 [S]. |

Derived **fatigue index** `f` (0-1) = weighted combination: `f = 0.45 * (1 - PCr/100) + 0.40 * clamp((lactate - 4) / 16) + 0.15 * aerobicDebt`. Grapple-heavy rounds weight lactate higher (isometric loading); striking rounds weight PCr higher.

### 4.2 Per-action energy costs (ESTIMATE; relative units, one 5-min round of "average" activity ≈ 100)

| Action (per instance or per second) | PCr cost | Lactate added (mmol/L) | Notes |
|---|---|---|---|
| Jab / light strike | 0.8 | 0.05 | |
| Power punch / kick | 2.5 | 0.15 | full-effort |
| Head kick / spinning technique | 3.5 | 0.2 | |
| 5-strike flurry | 12 | 0.9 | burst |
| Takedown attempt (shot) | 10 | 0.8 | failed shot costs the same |
| Sprawl / defending a shot | 6 | 0.5 | |
| Clinch pummel, per 10 s | 5 | 0.6 | isometric |
| Wall-walk / stand-up from bottom, per attempt | 8 | 0.7 | |
| Being on bottom under pressure, per 10 s | 3 | 0.5 | cost of frames + breathing under weight |
| Holding top position, per 10 s | 2 | 0.25 | cheaper than bottom, and top fighter breathes freely |
| Ground and pound, per strike | 1.5 | 0.1 | |
| Submission attempt (squeeze), per 10 s | 9 | 0.9 | |
| Escaping submission, per 10 s | 8 | 0.8 | |
| Movement / footwork, per second at high pace | 0.4 | 0.03 | |
| Being rocked (adrenaline, flailing) | 4 flat | 0.4 | "survival tax" |
| Taking a hard body shot | +10 % to all costs for 60 s; -20 % aerobic refill for 60 s | | ESTIMATE, see 2.2 |

Direction of the grappling costs (bottom > top, isometric clinch expensive) is consistent with the E:P ratios in Del Vecchio 2011 (1:2 to 1:4, most high-intensity actions in groundwork) [S]; the magnitudes are ESTIMATEs.

### 4.3 Effects of fatigue on capability (ESTIMATE; apply as multipliers, linear in `f` unless stated)

| Capability | at f = 0.5 | at f = 0.8 | Notes |
|---|---|---|---|
| Strike power | -12 % | -25 % | power falls less than volume (fighters keep "one big punch") |
| Strike speed / hand speed | -8 % | -18 % | |
| Output rate (strikes/min) | -20 % | -45 % | biggest observed effect; late rounds see lower volume |
| Accuracy | -8 % | -18 % | |
| Head movement / footwork defence | -20 % | -45 % | defence dies first; fatigued fighters get hit clean |
| Takedown speed & TD defence | -15 % | -35 % | |
| Decision quality (AI noise) | -15 % | -35 % | |
| Chin (via KO modifier) | +12 % alphaEq | +20 % | Section 3.2 |
| Recovery from Rocked | t½ 8 s -> 10 s | 8 -> 13 s | |

### 4.4 Round-break recovery (60 s)

- PCr: refill ~60 % of the deficit (t½ 45 s); if lactate > 14 mmol/L the PCr ceiling is capped at 85.
- Lactate: -0.5 mmol/L (negligible).
- Aerobic debt: -35 %.
- Acute damage: head t½ 8 s continues, so the break clears essentially all acute head damage (a rocked fighter is "saved by the bell" and comes out clear-headed but with the structural tax); body acute clears; leg acute clears.
- Structural: head -25 %, body -15 %, legs -10 % (Section 2).
- Cuts: cutman -1 severity on the worst cut.
- Corner can retire the fighter (Section 5).

### 4.5 Pace and fading ("front-runner" dynamics)

Because lactate does not clear between rounds, a fighter who runs `f` above ~0.6 in round 1 enters round 3 with a structurally lower PCr ceiling. Rule: **PCr ceiling = 100 - 1.2 * max(0, lactate - 8)**. A fighter at 18 mmol/L has a 88 ceiling; combined with aerobic debt this yields the familiar "fell off a cliff in round 3". Fighters with high `vo2` clear faster and fade less; the sim should show winners of the first round losing decision fights when their `vo2` is low and their round-1 output high.

**Second wind** (ESTIMATE): when `f` falls from > 0.7 back below 0.55 through a low-intensity stretch (clinch stall, slow ground phase, opponent backing off) for >= 40 s, grant a temporary +10 % output / +10 % decision-quality bonus for 60 s. This models the observed psychological rebound; there is no physiological literature for it, only PCr resynthesis.

### 4.6 Adrenaline dump (first-round fatigue in inexperienced fighters)

Mechanism: anticipatory sympathetic surge -> elevated pre-fight HR, shallow breathing, muscle tension, then a rapid perceived-exertion spike in the first 2-3 min followed by a crash. Evidence: official bouts elevate pre-fight blood glucose versus simulated bouts (6.1 vs 4.4 mmol/L, Coswig 2016) [S], a direct marker of the stress response; the rest is coach/physician consensus.

Sim rule (ESTIMATE): `dump = (1 - experience) * (1 - composure) * eventMagnitude`, range 0-1. For the first 150 s of round 1: all energy costs x (1 + 0.6 * dump), decision quality -20 % * dump, output +15 % * dump for the first 45 s (they rush) then -25 % * dump. Effect vanishes after round 1 unless `f` exceeded 0.75, in which case the lactate carries over normally. Debut fighters: experience ~0.1; 10+ pro fights ~0.8; title-fight `eventMagnitude` 1.0, regional card 0.6.

### 4.7 Weight cutting and dehydration

- Typical MMA cuts are 5-10 % of body mass in fight week (ESTIMATE; Crighton 2016 BJSM editorial "Alarming weight cutting behaviours" [S: title verified, no abstract] and multiple UFC-fighter surveys). A controlled ~5.3 % cut followed by > 24 h recovery did *not* impair performance indices (Connor 2022) [S], so the sim should penalise **residual** dehydration at fight time, not the cut itself.
- Rule: residual dehydration `d` (0-0.05). Aerobic refill rate x (1 - 4 * d) (2 % residual -> -8 %), PCr ceiling -2 per 1 % residual, chin `z += 3 d` (Section 3.2), heat tolerance lower. Poor rehydration habits, extreme cuts (> 8 %), and same-day weigh-ins raise `d`.

### 4.8 Altitude

Un-acclimatised: VO2max -6.3 %/1000 m (range 4.6-7.5 %) and endurance time -14.5 %/1000 m starting from ~800 m (Wehrlin 2006) [S]. Sim: at venue altitude `h` m, aerobic refill rate x (1 - 0.063 * max(0, h - 500)/1000) and lactate accumulation x (1 + 0.10 * max(0, h - 500)/1000); acclimatised fighters (>= 2 weeks) suffer half the penalty (ESTIMATE). Denver (1600 m): -7 % aerobic; Mexico City (2240 m): -11 %.

---

## 5. Referee, doctor and corner stoppage: implementable logic

### 5.1 Referee (in-round)

The Unified Rules give the referee sole discretion to stop the contest when a fighter cannot "intelligently defend" themselves; there is no count and no three-knockdown rule in Unified-Rules MMA (Shooto uses a 10-count and three-knockdown rule) [S: Wikipedia Unified Rules page, fetched]. Real referees key off observable cues, so the sim's referee should observe the same cues, not the hidden damage numbers.

Evaluate each tick while a fighter is in any of {Rocked, Knockdown, BodyCollapse, LegCollapse}:

```
defenseless = (state == KO)                                   -> stop immediately
            || (grounded && !activeDefence && unansweredHeadStrikes >= N_unans)
            || (standing && rocked && unansweredHeadStrikes >= N_stand && !clinchOrMove)
            || (state == BodyCollapse && !attemptingToRise && t > 6 s)
            || (limpArm || eyesRolled || armsDroppedFlag)       // "going limp"
```

- `N_unans` (ground, no intelligent defence): 3-5 unanswered clean head strikes, or ~2-4 s of pure covering without positional change. Basis: Hutchison 2014's 2.6 extra strikes / 3.5 s after a KO blow [S] and 18.5 strikes in the 30 s before a TKO [S]: a real referee lets roughly 15-20 partly-defended strikes accumulate before calling a "repetitive strikes" TKO, but 3-5 fully undefended ones.
- `N_stand` (standing but rocked): 5-8 unanswered strikes without a defensive action (block, move, clinch, level change), or a second knockdown within 10 s.
- **Referee strictness** attribute (0-1): scales `N_unans` and `N_stand` by (1.4 - 0.8 * strictness). Lenient referees (0.2) allow ~6 unanswered ground strikes; strict ones (0.8) ~3.
- **Referee positioning delay**: 0.5-2.0 s between the criteria being met and the actual stop, during which extra strikes land (this is the 0-20 s tail in Hutchison [S]).
- "Intelligent defence" counts as: guard changing position, hip escape/turn, grabbing a limb, standing attempt, striking back. A static double-forearm cover on the ground for > 3 s does **not** count.
- **Knockdown -> finish conversion**: with the above numbers the sim should converge on ~55-65 % of standing knockdowns leading to a finish in the same round (ESTIMATE; no peer-reviewed figure; consistent with broadcast statistics that a KD'd fighter rarely wins). Tune `kKO`, `N_unans` and the follow-up-attack behaviour to hit this range.

### 5.2 Doctor stoppage (between rounds or on referee call)

Trigger a doctor check when: a cut reaches severity 3, or an eyelid cut reaches severity 2, or blood enters the eye for > 60 s, or an eye is swollen shut (orbit structural >= 70), or a suspected fracture (nose structural >= 80 with breathing impairment; jaw fracture event), or after an eye-poke/foul when the fighter reports vision loss. Doctor stops if: `visionSide <= 0.4` on either eye, or cut severity 3 on an eyelid/crossing the eye, or severity 3 elsewhere with `bleedRate` uncontrolled after cutman, or fracture flagged. Doctor leniency attribute 0-1 shifts the thresholds by ±15 %. Real-world share: ~2-4 % of bouts (ESTIMATE).

### 5.3 Corner stoppage (round break)

Corner retires the fighter if `structuralHead >= 80` and the fighter lost the last round decisively, or `f >= 0.9` with a dominant opponent, or a hand/leg injury with `mobility <= 0.4`, weighted by corner "protectiveness" (0-1) and fight stakes (title fight -> less likely). Rare: ~1-2 % of bouts (ESTIMATE).

### 5.4 Fouls and pauses

Accidental eye poke or groin strike: pause up to 300 s; the fouled fighter's acute pools decay during the pause (a real tactical benefit); referee may deduct a point on second intentional-looking foul (ESTIMATE on point-deduction behaviour).

---

## 6. Data tables with sources

### 6.1 Head-impact biomechanics

| Quantity | Value | Source |
|---|---|---|
| Straight punch force, Olympic boxers | 3427 ± 811 N | Walilko, Viano, Bir 2005, Br J Sports Med 39:710-9, PMID 16183766 [S] |
| Hand velocity | 9.14 ± 2.06 m/s | same [S] |
| Effective punch mass | 2.9 ± 2.0 kg | same [S] |
| Jaw load | 876 ± 288 N | same [S] |
| Head translational / rotational acc, straight to jaw | 58 ± 13 g / 6343 ± 1789 rad/s² | same [S] |
| Neck shear | 994 ± 318 N | same [S] |
| Hook: Δv hand, force, neck load | 11.0 ± 3.4 m/s, 4405 ± 2318 N, 855 ± 537 N | Viano et al. 2005, Neurosurgery 57:1154-72, PMID 16331164 [S] |
| Hook: head acc | 71.2 ± 32.2 g, 9306 ± 4485 rad/s² | same [S] |
| Effective radius from head CG: boxing vs football | 65 mm vs 34 mm | same [S] |
| Peak strain location | midbrain, late in the impulse | same [S] |
| Taekwondo turning kick, helmeted headform linear acc | 130.1 ± 51.7 g (axe kick 55.0 ± 20.1 g) | Fife et al. 2013, Br J Sports Med, PMID 22930694 [S] |
| Concussion risk, rotational: sub-concussive avg / concussive avg / 50 % | 1230 / 5022 / 6383 rad/s² (28.3 rad/s) | Rowson et al. 2012, Ann Biomed Eng 40:1-13, PMID 22012081 [S] |
| Concussion 25/50/80 % (FE reconstruction of NFL impacts) | ~66/82/106 g; ~4600/5900/7900 rad/s²; HIC ~136/235/333 | Zhang, Yang, King 2004, J Biomech Eng 126:226-36, PMID 15179853 [S-mem: abstract confirms method; the numbers are from the paper body and not re-verified] |
| Neck strength vs concussion | OR 0.95 per lb (95 % CI 0.92-0.98) | Collins et al. 2014, J Prim Prev, PMID 24930131 [S] |
| Anticipation & neck strength reduce head ΔV, Δω | significant in all planes | Eckner et al. 2014, Am J Sports Med, PMID 24488820 [S] |
| Unanticipated collisions more severe | yes, esp. 50th-75th pct impacts | Mihalik et al. 2010, Pediatrics, PMID 20478933 [S] |

### 6.2 MMA KO/TKO epidemiology

| Quantity | Value | Source |
|---|---|---|
| KO rate, UFC 2006-12 | 6.4 / 100 AE (12.7 % of bouts) | Hutchison et al. 2014, Am J Sports Med 42:1352-8, PMID 24658345 [S] |
| TKO-by-strikes rate | 9.5 / 100 AE (19.1 %) | same [S] |
| Combined match-ending head trauma | 15.9 / 100 AE (31.9 %) | same [S] |
| Risk factors | weight class, earlier in round, earlier round, older age; + prior KO/TKO and match significance for KO | same [S] |
| KO blow location | 100 % head; 53.9 % mandibular | same [S] |
| KO strike -> stoppage | 3.5 s mean (0-20); 2.6 extra head strikes (0-20) | same [S] |
| TKO: strikes in final 30 s | 18.5 (5-46), 92.3 % to head | same [S] |
| KO/TKO per 100 AE: MW / LHW / HW (2014-17) | 19.53 / 20.8 / 26.09 | Follmer, Dellagrana, Zehr 2019, Sports Health, PMID 30768376 [S] |
| Share of bouts ending KO/TKO: women's SW vs men's HW | 7.9 % vs 52.1 % | same [S] |
| Concussion-stoppage rounds: distance head strikes (median, IQR) | 13 (6-25) vs 9 (4-18) for submission rounds | Miarka et al. 2022, Front Neurol, PMID 36119707 [S] |
| Severe concussion rate, Nevada 2002-07 | 15.4 / 1000 AE (3 % of matches) | Ngai, Levy, Hsu 2008, Br J Sports Med 42:686-9, PMID 18308883 [S] |
| Injury rate, Nevada 2001-04 | 28.6 / 100 fight participations; facial laceration 47.9 %, hand 13.5 %, nose 10.4 %, eye 8.3 % | Bledsoe et al. 2006, J Sports Sci Med 5(CSSI):136-42, PMID 24357986 [S] |
| Pooled injury incidence | 228.7 / 1000 AE (95 % CI 110-474); head 66.8-78 %; lacerations 36.7-59.4 %; fractures 7.4-43.3 %; concussion 3.8-20.4 %; losers 3x injuries; KO/TKO bouts 2x injuries vs submission bouts | Lystad, Gregory, Wilson 2014, Orthop J Sports Med, PMID 26535267 [S] |
| Post-Unified-Rules injury rates | 23.6-54.5 / 100 AE; concussion 14.7-16.1 / 100 AE | Systematic review 2025, Orthop J Sports Med, PMID 40620723 [S] |
| MMA vs boxing (Edmonton 2000-13, 1181 MMA / 550 boxers) | boxers more often uninjured (59.4 % vs 49.8 %); MMA more contusions; boxing more LOC/eye injuries | Karpman et al. 2016, Clin J Sport Med 26:332-4, PMID 26327287 [S] |
| Pro boxing injury rate (Victoria 1997-2005) | 23.6 / 100 fights, mostly head/face lacerations; age and fight count predictive | Zazryn et al. 2009, Clin J Sport Med, PMID 19124979 [S] |
| GB elite boxing hand/wrist competition injury rate | 347 / 1000 h | Loosemore et al. 2017, Hand (N Y), PMID 28344531 [S] |
| Repeat concussion odds with 3+ prior | OR 3.0 (1.6-5.6); 91.7 % of same-season repeats within 10 days | Guskiewicz et al. 2003, JAMA 290:2549-55, PMID 14625331 [S] |
| Exposure -> thalamic/caudate volume, processing speed | negative association; Fight Exposure Score predicts impairment | Bernick et al. 2015, Br J Sports Med, PMID 25633832 [S] |
| Older fighter threshold | > 35 years | ARP position statement 2024, Phys Sportsmed, PMID 38708547 [S] |

### 6.3 Energy systems and fatigue

| Quantity | Value | Source |
|---|---|---|
| MMA post-bout lactate / RPE | 10.2-20.7 mmol/L; RPE 13-19 (Borg 6-20) | Amtmann, Amtmann, Spath 2008, J Strength Cond Res 22:645-7, PMID 18550986 [S] |
| Official vs simulated MMA: pre-fight glucose | 6.1 ± 1.2 vs 4.4 ± 0.7 mmol/L; similar glycolytic demand | Coswig et al. 2016, Asian J Sports Med, PMID 27625756 [S] |
| Simulated 3x5 MMA: HR, RPE, lactate high; cortisol, testosterone up; CMJ down at 30 min; damage markers at 24 h | see abstract | Ghoul et al. 2019, J Strength Cond Res 33:1570-9, PMID 28658085 [S] |
| MMA effort:pause | 1:2 to 1:4; most high-intensity actions in groundwork | Del Vecchio, Hirata, Franchini 2011, Percept Mot Skills 112:639-48, PMID 21667772 [S] |
| Amateur boxing 3x2 energetics | aerobic energy dominant (526 kJ aerobic); PCr recovery in breaks is key | Davis, Leithäuser, Beneke 2014, Int J Sports Physiol Perform 9:233-9, PMID 24572964 [S] |
| Low-kick kickboxing E:P | ~1:1.5 overall; ~1:6 high-intensity:pause | Ouergui et al. 2017, IJSPP, PMID 27197115 [S] |
| PCr after 30 s sprint: end / 1.5 min / 6 min; half-time | 19.7 % / 65.0 % / 85.5 % of rest; 56.6 ± 7.3 s; muscle pH 6.72 -> 6.79 at 6 min | Bogdanis et al. 1995, J Physiol 482:467-80, PMID 7714837 [S] |
| VO2max vs altitude | -6.3 %/1000 m (4.6-7.5); time to exhaustion -14.5 %/1000 m | Wehrlin & Hallén 2006, Eur J Appl Physiol, PMID 16311764 [S] |
| RWL 5.3 % + > 24 h recovery | no performance decrement | Connor et al. 2022, Eur J Appl Physiol, PMID 35833967 [S] |
| Weight-cutting prevalence/severity | editorial call to action | Crighton, Close, Morton 2016, Br J Sports Med, PMID 26459278 [S: title only] |
| MMA physical-demands review | evidence base is descriptive; loads not adequately quantified | Kirk et al. 2020, J Sports Sci, PMID 32783581 [S] |

### 6.4 Rules

| Item | Value | Source |
|---|---|---|
| Round length / rest | 5 min / 1 min; 3 rounds non-title, 5 title | Unified Rules of MMA (Wikipedia summary fetched) [S] |
| Counts / three-knockdown | none in Unified Rules; Shooto: 10-count, 3 KDs in a round ends bout | same [S] |
| Foul recovery | up to 5 min | ABC Unified Rules [S-mem] |
| ARP position statements (concussion, weight management, eye conditions, older fighter, high-risk fighter) | index | https://ringsidearp.org/consensus-statements/ [S] |

---

## 7. Sim rules to implement

1. **Six damage regions** (head, body, leadLeg, rearLeg, arms, cuts[]) each with `acute` and `structural` pools; acute decays with region-specific half-lives (head 8 s, body 12 s, legs 20 s) only while not being hit; structural decays only at round breaks (head 25 %, body 15 %, legs 10 %) with 40 % of head structural permanent for the bout.
2. **Per-strike raw damage** = weaponForce x relativeVelocity x cleanMult (1.0/0.5/0.25) x targetMult x (1 - absorb). Head sub-location multipliers: chin 1.35, temple/behind-ear 1.25, mid-face 0.85, forehead 0.6, orbit 0.8 (structural 1.3).
3. **KO roll per head strike**: compute `alphaEq` (6300 rad/s² for a 3400-N straight to the jaw, scaled by force, lever, cleanness, attacker mass); `pConcuss = sigmoid((alphaEq - 6383)/1800 - 2*(chin-0.5) + 3*dehydration)`; `pKO = 0.22 * pConcuss * historyMult * ageMult`; remainder of `pConcuss` splits rocked 45 % / flash KD 25 % / hurt KD 8 % / nothing visible 22 %.
4. **Unseen strike** x1.35 on `alphaEq`; **relaxed/mid-strike** x1.2; **stepping in** up to x1.5; **neck attribute** x(1.15 - 0.3 neck); **fatigue** x(1 + 0.25 f); **prior in-bout head damage** x(1 + 0.006 structuralHead) capped at 1.6.
5. **Head kicks and knees** carry 1.5-2x hook force in `alphaEq`; elbows ~= hooks; ground strikes 0.7x rotational but 1.3x structural (ground finishes are accumulative).
6. **Rocked state** (acute 45-65): movement -40 %, guard -35 %, accuracy -25 %, power -15 %, decision quality -40 %, absorb halved; exits when acute decays below 35; experience biases the AI toward clinch/level-change survival, inexperience toward trading.
7. **Knockdown** (acute 65-90 or KO-roll KD outcome): grounded 1-3 s minimum; follow-up window; referee logic (rule 14) engaged.
8. **Liver / solar plexus**: clean strike with raw >= 35 triggers a 0.5-3 s delayed collapse (liver) or 3-15 s breathless state (solar plexus); body structural adds +4 % action cost and -6 % aerobic refill per 10 points.
9. **Legs**: mobility = 1 - 0.7 (structural/100)^1.5 per leg; calf kicks 1.5x structural with a 5 % foot-drop event; structural 30/55/75 thresholds degrade stance, rear-hand power and takedown defence; TKO at 85. Checked kicks return 60 % of damage to the kicker's shin with a 0.3 % catastrophic-injury roll.
10. **Cuts**: per-clean-landing probability elbow 6 %, punch to brow 1.2 %, head clash 8 %; severity 1-3; severity >= 2 on an eyelid or any severity 3 triggers a doctor check; blood-in-eye reduces vision/accuracy/defence; cutman reduces the worst cut by 1 per break.
11. **Hand injury**: 0.15 % per landed punch on skull (forehead/crown/temple), 0.04 % on jaw/soft target; injured hand -35 % power and -50 % usage.
12. **Energy**: three pools. PCr refills in-round with t½ 30 s during low-intensity stretches, 60 % of deficit over the 60-s break; lactate never meaningfully clears within the bout (-0.5 mmol/L per break) and lowers the PCr ceiling by 1.2 per mmol/L above 8; aerobic attribute scales both refill and clearance. Fatigue index f = 0.45 (1 - PCr) + 0.40 clamp((lactate - 4)/16) + 0.15 aerobicDebt.
13. **Fatigue effects** at f = 0.8: output -45 %, defence -45 %, power -25 %, speed -18 %, accuracy -18 %, TD/TDD -35 %, decision -35 %, chin +20 % alphaEq. Being on bottom costs 1.5x top; clinch pummel and submission squeezes are the most expensive sustained actions.
14. **Referee**: no counts. Stop when KO, or grounded with no intelligent defence and 3-5 unanswered clean head strikes (scaled by strictness), or standing-rocked with 5-8 unanswered strikes and no defensive action, or body/leg collapse with no attempt to rise for > 6 s, or "limp" flag. Add 0.5-2 s positioning delay. Target ~55-65 % KD-to-finish conversion in the same round.
15. **Doctor**: check on severity-3 cut, eyelid severity 2, > 60 s blood in eye, swollen-shut eye, suspected fracture; stop when vision on either side <= 0.4, eyelid/eye-crossing severity 3, uncontrolled bleeding after cutman, or fracture.
16. **Corner**: may retire the fighter at a break on structuralHead >= 80 + lost round, f >= 0.9 + dominant opponent, or mobility <= 0.4, weighted by protectiveness and stakes.
17. **Adrenaline dump**: dump = (1 - experience)(1 - composure) x eventMagnitude; for the first 150 s of round 1, costs x(1 + 0.6 dump), decision -20 % dump, output +15 % dump for 45 s then -25 % dump.
18. **Front-runner fade**: emerges automatically from rule 12 (non-clearing lactate + lowered PCr ceiling); do not add a separate "fade" parameter. Second wind: +10 % output/decision for 60 s after f drops from > 0.7 to < 0.55 via a 40-s low-intensity stretch.
19. **Weight cut**: penalise residual dehydration `d` at fight time only: aerobic refill x(1 - 4d), PCr ceiling -2 per 1 % d, chin z += 3d.
20. **Altitude**: aerobic refill x(1 - 0.063 (h - 500)/1000), lactate accumulation x(1 + 0.10 (h - 500)/1000); acclimatised fighters halve the penalty.
21. **Career layer**: each KO/TKO loss raises `priorKOs`, which raises `kKO` by 25 % per event (cap 4) and lowers the `chin` attribute by 0.03 permanently; age > 30 raises `kKO` 4 %/yr, > 35 8 %/yr; cumulative fight exposure reduces the processing-speed component of reaction time (Bernick 2015 direction).
22. **Toughness/heart attributes**: `chin` (KO tolerance, Section 3), `painTolerance` (scales body/leg state thresholds ±25 %), `composure` (scales adrenaline dump and rocked-state decision penalty; grows with experience), `recovery` (scales acute half-lives ±30 %). Treat all four as independent, normally distributed, with experience shifting composure only.

---

## 8. Assumptions and gaps

- **No published in-fight measurement of rocked-state duration, knockdown-to-finish conversion, or per-round power decline** exists. All such numbers are ESTIMATE and should be exposed as tunables and calibrated against the target finish distribution (31.9 % KO/TKO overall; 12.7 % KO; weight-class gradient 8 % -> 52 %).
- The KO probability curve is borrowed from instrumented American-football concussion data (Rowson 2012). Boxing punches produce shorter-duration, more rotational impulses than football hits (Viano 2005), so the football curve is a proxy, not a validated MMA KO curve. The `kKO = 0.22` split between concussion and unconsciousness is the least-supported constant in the model.
- Head-kick and knee rotational accelerations have not been measured in the literature found; the 130 g helmeted-headform kick figure (Fife 2013) is linear-only and helmeted, so the 1.5-2x hook scaling is an ESTIMATE.
- Body-shot, liver and solar-plexus thresholds have no biomechanical data at all; mechanism descriptions are from ringside-physician consensus.
- Leg-kick damage accumulation, calf-kick nerve events and leg-kick TKO rates are unstudied; the numbers are fight-observation ESTIMATEs.
- Cut-rate-by-weapon has no study separating elbows from punches; the 5x elbow multiplier is an ESTIMATE informed by the fact that boxing (no elbows) already has lacerations as the majority injury.
- Weight-cut effect on the chin is mechanistically plausible and widely asserted, but the only controlled study found (Connor 2022, ~5.3 % cut with > 24 h recovery) showed no performance decrement; hence the model penalises residual dehydration only.
- "Second wind" and "adrenaline dump" are modelled from coaching consensus plus a single stress-marker finding (pre-fight glucose, Coswig 2016); their magnitudes are ESTIMATE.
- The Unified Rules 5-minute foul-recovery figure and Zhang 2004's 25/50/80 % thresholds were quoted from memory ([S-mem]); verify before citing externally.
- UFC Performance Institute reports (2018, 2021) and analyst essays (Jack Slack on chins, Fightnomics on knockdowns) could not be fetched in this session and are not cited as sources; they are known to exist and are the best places to calibrate the ESTIMATEs in Sections 2-5.
