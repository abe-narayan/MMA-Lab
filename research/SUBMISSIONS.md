# SUBMISSIONS — Research & Sim Rules

Discipline research doc for the MMA simulator. Every submission is modelled as a
four-stage battle — **Setup → Entry → Secure → Finish** — with an active
defence/escape roll on both sides at every stage, and with *chains* (edges) to
other submissions and positions when a stage fails.

Conventions used throughout:

* **Hard data** = a tally taken from a cited source (URL given).
* **ESTIMATE** = a number we set from coaching literature, video review and
  reasoning. Every estimate is labelled. Where the estimate is a per-stage
  success probability it is "vs a *competent* defender of equal skill" (see
  §4 for tier scaling).
* Durations are wall-clock seconds inside the bout.
* "Competent defender" = a UFC-level grappler who knows the standard
  defence at every stage (tier **Advanced** in §4).
* Web search budget for the session was exhausted part-way through; the
  technique/physiology sections therefore lean on well-established coaching
  sources that are cited by name/URL where the URL is known and are marked
  "(coaching consensus)" where a single URL could not be re-verified.

---

## 1. Summary

### 1.1 Headline numbers

| Metric | Value | Source / label |
|---|---|---|
| UFC bouts, 1994–Mar 2026 | 8,591 | GrapplerHQ compilation of UFCStats [G1] |
| … ending by submission | 1,659 (19.3 %) | [G1] |
| … ending by KO/TKO | 2,800 (32.6 %) | [G1] |
| … decision | 4,016 (46.8 %) | [G1] |
| Submission share of all *finishes* | 37 % | derived from [G1] |
| Submission rate, UFC PPV 1993–2023 (3,123 fights) | 618 / 3,123 = 19.8 % | Fares et al. 2025, *J Sports Med Phys Fitness* [P1] |
| Submission rate trend | "significantly decreased across the years" | [P1]; ESPN 2018 [E1] |
| Chokes as share of submissions | 65.5 % (PPV set) / 76.2 % (Stellpflug all-UFC choke set) | [P1], [P2] |
| Head as target of submission | 74.3 % | [P1] |
| Choke outcomes | 89 % tap, 11 % rendered unconscious | Stellpflug 2020, 904 UFC chokes [P2] |
| Time to unconsciousness once a blood choke is fully locked | **9.0 s mean (95 % CI 8.3–9.9)** in fully resisting elite grapplers (81 filmed chokes); per-type means 6.2–10.5 s | Stellpflug et al. 2020, *Int J Perform Anal Sport* [P4]; Mitchell 2012 VNR 9.5 ± 0.4 s [P6]; Rossen 1943 cuff ≈ 6.5 s [P7]; Koiwai judo 10–20 s [P8] |
| Post-LOC hold that produces convulsions/staggering | ≥ 4 s after LOC (OR 6.7); asymptomatic release 2.4 ± 2.0 s | Sasaki 2022, 7,426 judo world-championship bouts [P9] |
| Serious injury rate when an upper-limb joint sub is completed in the UFC | ≈ 7 of 80 filmed (≈ 9 %), mean 10.3 months out | Fares et al. 2026 [P5] |
| Knee-injury risk when heel hooks are legal (IBJJF) | 26.5 vs 2.2 per 1,000 matches, **RR 12.0** | Piekarski/Kreiswirth 2026 [P10] |
| Median UFC fighter submission attempts per 15 min | 0.6 | CageQuant [C1] |
| Elite finisher attempts per 15 min | Charles Oliveira 2.6; per 5-min round (min 10 bouts): Dustin Hazelett 1.404, Royce Gracie 1.282, Oliveira 0.807 | [C1]; Wikipedia UFC records [WR1] |
| Career attempt → finish (elite) | Oliveira 17 wins / 51 attempts = 33 %; Jim Miller 14 / 52 = 27 % | AgentMMA [A1]; [WR1] |
| Most UFC submission wins | Oliveira 17, Miller 14, Meerschaert 11, Maia 11, Royce Gracie 10, Nate Diaz 10; title-fight subs: D. Johnson 5, Jon Jones 4 | [WR1] |
| Whole-UFC attempt → finish conversion | **ESTIMATE 17–22 %** (≈ 1,659 finishes over ≈ 8–10 k recorded attempts) | derived, see §6.4 |
| Fastest UFC submission | 14 s (Ronda Rousey armbar) | MMAHive [M1] |
| Most attempts, one fight | 10 (Cole Miller) | [M1] |
| Female vs male submission rate | 21.1 % vs 17.3 % (n.s.) | Sportslyx summary of [P1]-type data [S1]; [P1] "no significant gender difference" |

### 1.2 UFC submission finishes by technique (all-time)

Primary tally = GrapplerHQ (UFCStats-derived, 1,659 subs to Mar 2026) [G1].
Cross-checks: Stellpflug 2020 choke-only set (904 chokes, to 2020) [P2];
Fares 2025 PPV-only set [P1]; MMAHive 2017-only breakdown [M1];
FightEncyclopedia 2024 ("UFC Stats") [F1]; Nate Latshaw (UFCStats scrape,
2024) [N1].

| Technique | Count [G1] | Share of subs [G1] | Cross-check |
|---|---|---|---|
| Rear-naked choke | 648 | **39.1 %** | 49.1 % of *chokes* [P2]; 32.7 % of PPV subs [P1]; 43.8 % (2017) [M1]; ~37 % [F1] |
| Guillotine (all variants) | 293 | **17.7 %** | 13.7 % standard + 9.7 % arm-in of chokes [P2]; 13.7 % (2017) [M1]; ~13 % [F1] |
| Armbar | 195 | **11.8 %** | 12.5 % (2017) [M1]; ~14 % [F1] |
| Arm-triangle (head-and-arm) | 126 | **7.6 %** | 8.2 % of chokes [P2]; 6.3 % (2017) [M1] |
| Triangle | 114 | **6.9 %** | 8.8 % of chokes [P2]; ~7 % [F1] |
| D'Arce / brabo | 47 | 2.8 % | anaconda+D'Arce+von Flue 3.7 % (2017) [M1]; ~3 % [F1] |
| Kimura | 43 | 2.6 % | ~8 % [F1] (outlier, likely includes other shoulder locks) |
| Anaconda | 38 | 2.3 % | — |
| All other (≈ 24 named techniques) | 155 | 9.3 % | "5 most common ≈ 82 %; 24+ other types ≈ 18 %" [N1] |

Top-5 share = 83.1 % [G1] — matches Latshaw's "~82 %" [N1]. Chokes =
78.8 % of subs, leg locks = 3.3 % of subs [G1].

**Itemised "long tail" — hard tallies from FightAlpha (UFCStats-derived,
8,745 fights, 1,695 subs, to 20 Jun 2026) [FA1], cross-checked with fight.tv
(to Mar 2025) [FT1] and the Wikipedia UFC records page [WR1]:**

| Technique | UFC finishes | Share of subs | Notes / verified instances |
|---|---|---|---|
| Heel hook (inside + outside) | **24** [FA1] (20 [FT1]) | 1.4 % | Shamrock d. Smith UFC 1 (1993, first); Palhares ×4 (2010–13); Ryan Hall d. BJ Penn UFC 232 (2018); Chase Hooper d. Barrett (2020); **Valter Walker ×4 in a row** (Tafa Aug 2024, Mayes Feb 2025, Nzechukwu Jul 2025, Sutherland Oct 2025) — verified per-year: 2018:1, 2020:1, 2024:1, 2025:3 |
| Kneebar | **20** [FA1] (23 [FT1]) | 1.2 % | Mir d. Lesnar UFC 81 (2008) |
| Neck crank (all cranks) | **22** [FT1] | 1.3 % | first: Tank Abbott d. Jennum (UU '95); not itemised by [FA1] |
| Straight ankle lock / Achilles | in residual (ESTIMATE 8–14) | ~0.6 % | first: Don Frye (UU '96); "one of the rarest MMA finishes" [BJ1] |
| von Flue | **≈ 8** (6 to 2019 + Menifield 2021 + McKenna 2022) [SK1] | 0.5 % | Von Flue d. Karalexis (2006); OSP ×4; Alonzo Menifield d. Cherant UFC 260; Cory McKenna (first woman, 2022) |
| Bulldog choke | **≥ 6** [SK2][WR1] | 0.4 % | Rhodes d. Ettish UFC 2; Newton d. Miletich UFC 31; Faber and Pennington UFC 181 (2014); Medeiros "reverse bulldog" UFC 177; **Ben Askren d. Robbie Lawler UFC 235 (2019)** |
| Ezekiel | **5** [FA1] (3 fighters [WO1]) | 0.3 % | Oleinik d. Pešta (Jan 2017, from *bottom* of mount, first in UFC) and d. Albini (UFC 224, 2018); Oleinik has 14 career Ezekiel wins |
| North-south choke | **5** [FA1] | 0.3 % | Monson d. Hinkle UFC 57 (2006, first); Merab Dvalishvili d. O'Malley UFC 316 |
| Forearm choke | 5 [FA1] | 0.3 % | |
| Inverted triangle | 4 [FA1] | 0.2 % | Rockhold inverted-triangle kimura UFC 172 |
| Twister | **4** [FA1][SK3] | 0.2 % | Jung d. Garcia (2011, first); Mitchell d. Sayles (2019); Da'Mon Blackshear d. Johnson (2023); Murtazali Magomedov d. Baghdasaryan (2026, "Scottish twister") |
| Calf slicer | **3** (4 incl. Walker Jul 2026) [FA1][WV1] | 0.2 % | Oliveira d. **Eric Wisely** (Jan 2012, first); Brett Johns d. Soto (2017); Valter Walker d. Petersen (Jul 2026) |
| Flying triangle | 3 [FA1] | 0.2 % | |
| Suloev stretch | **3** [FA1] | 0.2 % | Kenny Robertson d. Jardine UFC 157 (2013); Sterling d. Stamann and Zabit d. Davis (both UFC 228, 2018) |
| Omoplata | **2** [FA1][FT1] | 0.1 % | first: Ben Saunders d. Heatherly (2014) |
| Peruvian necktie | **2** (+1 "Pace choke" variant) [FA1] | 0.1 % | Dollaway d. Jesse Taylor (2008) and d. Doerksen (UFC 119); Cirkunov d. Crute (2019) |
| Japanese necktie | ≥ 1 [WR1] | <0.1 % | Matheus Nicolau d. Mesquita (2015) |
| Toe hold | **1** [FA1] | <0.1 % | Mir d. Tank Abbott UFC 41 (2003) |
| Americana / keylock | not itemised (ESTIMATE 10–15) | ~0.7 % | first: Severn d. Beneteau UFC 5 |
| Gogoplata | **0** official UFC | 0 | Diaz–Gomi was PRIDE 33 (2007, NC); Aoki d. Hansen PRIDE Shockwave 2006 |
| Buggy choke | 0 in UFC proper (TUF 34 exhibition 2026) | 0 | first in Cage Warriors 2024 |
| Mounted / standing / "flying" variants | logged under parent technique | — | e.g., Jones d. Gane guillotine (2023) logged "guillotine"; DJ d. Borg UFC 216 suplex-to-armbar logged "armbar" |

**Era trend (MDPI Applied Sciences 2026, 906 finalised bouts in 2003-04 /
2013-14 / 2023-24 windows) [MD1]:** RNC share of subs rose from 15.8 % to
**46.8 %**; back control is the dominant finishing context (45.5 % of
submissions). The modern game is increasingly "strikes → back → RNC".

### 1.3 Submission rate by weight class (UFC, all-time) [G1]

| Division | Fights | Subs | Sub % of fights | Sub % of finishes | KO % of fights |
|---|---|---|---|---|---|
| Heavyweight | 765 | 112 | 14.6 % | 22 % | 51.5 % |
| Light heavyweight | 752 | 129 | 17.2 % | 28 % | 44.1 % |
| Middleweight | 1,134 | 237 | 20.9 % | 35 % | 38.1 % |
| Welterweight | 1,387 | 259 | 18.7 % | 36 % | 33.0 % |
| Lightweight | 1,436 | 309 | 21.5 % | 42 % | 29.5 % |
| Featherweight | 851 | 141 | 16.6 % | 37 % | 28.8 % |
| Bantamweight | 772 | 150 | 19.4 % | 43 % | 25.5 % |
| Flyweight | 410 | 88 | 21.5 % | 48 % | 23.7 % |
| Women's bantamweight | 241 | 41 | 17.0 % | 44 % | 22.0 % |
| Women's flyweight | 270 | 53 | 19.6 % | 54 % | 17.0 % |
| Women's strawweight | 363 | 70 | 19.3 % | 59 % | 13.5 % |

Cross-check, MMA.SOCIAL (UFCStats-based, to 19 Sep 2026, ~8,750 fights)
[MS1]: HW sub 15.0 % / KO 52.5 %; LHW 17.3 / 46.3; MW 21.4 / 38.5; WW
18.7 / 33.6; LW 22.2 / 30.4; FW 16.9 / 30.1; BW 20.1 / 26.7; FLW 22.1 /
23.9; W-BW 17.3 / 22.2; W-FLW 20.1 / 16.9; W-SW 20.1 / 14.0. Overall:
KO 33.5 %, sub 19.7 %, dec 46.5 %; R1 finishes 28.2 %; mean finish round 1.7.

Reading: **submission rate per fight is roughly flat (15–22 %) across
divisions; what changes is KO rate**, so the *share of finishes* that are
submissions rises from ~22 % at HW to ~50–60 % at flyweight/women's
divisions. Fight Matrix 2026 [FM1] and Fares 2025 [P1] both find the sub rate
"peaks in the intermediate classes" (LW/MW ≈ 21 %) and is lowest at HW.
Fightomic's figures (FLW 22.0 %, BW 19.5 %, HW 14.4 %) agree [FO1].
(Fight Matrix's "HW ≈ 21.7 %" summary line conflicts with the tables; use
[G1]/[MS1].) Fares 2026 [P5] adds: women are **3.03× more likely** to lose by
an upper-limb joint submission than men.

### 1.4 Submission rate by year (UFC) [G1]

| Year | Fights | Subs | Sub % | KO/TKO | Decisions |
|---|---|---|---|---|---|
| 2015 | 473 | 88 | 18.6 % | 155 | 221 |
| 2016 | 493 | 89 | 18.1 % | 153 | 248 |
| 2017 | 457 | 80 | 17.5 % | 146 | 224 |
| 2018 | 474 | 90 | 19.0 % | 151 | 229 |
| 2019 | 516 | 80 | 15.5 % | 153 | 277 |
| 2020 | 456 | 82 | 18.0 % | 139 | 226 |
| 2021 | 509 | 73 | 14.3 % | 171 | 256 |
| 2022 | 511 | 98 | 19.2 % | 171 | 239 |
| 2023 | 520 | 102 | 19.6 % | 159 | 248 |
| 2024 | 517 | 83 | 16.1 % | 147 | 281 |
| 2025 | 522 | 92 | 17.6 % | 169 | 257 |

MMA.SOCIAL's per-year table [MS1] extends back to 2010 (sub %): 2010 23.6,
2011 18.6, 2012 21.0, 2013 17.8, 2014 19.2, 2015 19.0, 2016 18.4, 2017 17.9,
2018 19.2, 2019 15.8, 2020 18.5, 2021 14.7, 2022 19.4, 2023 20.2, 2024 16.2,
2025 17.9, 2026 (partial, 399 fights) 18.0.

Modern baseline ≈ **18 % ± 2** of fights end by submission. Early-era UFC
was far higher: 1994–2004 overall finish rate 74.0 % (419 bouts) vs 54.8 % in
2005–2014 [G1]; "~30 % of UFC fights 1993–2002 ended by submission" [RR1];
MMAHive: 20.0 % average 1993–2020 vs 17.9 % 2014–2020 [M1]. ESTIMATE for
the *tournament era* (UFC 1–UFC 10, 1993–96) 40–50 %. The early-vs-modern
gap is the single best real-world proxy for the "skill-gap" multiplier in
§5. Fares 2026 [P5] also finds that **time from grappling initiation to a
completed submission has increased significantly across UFC history** —
defenders hold out longer.

**Round of submission finishes (FightAlpha, 1,692 subs to Jun 2026) [FA2]:**
R1 862 (50.9 %), R2 540 (31.9 %), R3 264 (15.6 %), R4 17 (1.0 %), R5 9
(0.5 %); 76 submissions inside the first minute. Fastest: Taktarov d. Macias
0:09 guillotine (UFC 6); Rousey d. Zingano 0:14 armbar (fastest title-fight
sub). Latest: D. Johnson d. Horiguchi 24:59 armbar (UFC 186) [WR1].

---

## 2. Per-submission sections

### 2.0 Shared stage model (applies to every entry below)

| Stage | What it means | Attacker needs | Defender's job | Typical duration (ESTIMATE) |
|---|---|---|---|---|
| **S0 Setup** | Reach a *position + control* that makes the attack available | position, grips, posture break, opponent's arm/leg/neck placed where needed | positional defence: posture, frames, hand-fighting, hiding limbs | continuous; the attack is "available" when a trigger condition is met |
| **S1 Entry** | Commit to the attack: isolate the limb / thread the arm / throw the legs | commitment; opens the attacker to counters if it fails | early defence: pull the limb out, turn, deny the grip | 1–4 s |
| **S2 Secure** | Close the lock: grip connected, angle set, posture broken, hooks/legs locked | grip strength, flexibility, correct angle | late defence: hand-fighting the finishing grip, chin tuck, stacking, elbow-to-hip, hiding heel | 2–10 s |
| **S3 Finish** | Apply pressure until tap / unconsciousness / injury | pressure direction, patience, squeeze/hip extension | last-ditch: explosive escape, slam, roll, endure until the round ends, or tap | see per-technique "time-to-tap" |

Once S3 is fully locked, defender success is rare; most escapes happen at
S1–S2. This is the central modelling insight from every coach cited:
**"the best defence is early"** (Danaher, Giles, Kesting — coaching consensus).

Per-stage numbers below are **P(attacker advances to the next stage)** on a
single attempt versus a competent (Advanced-tier) defender of equal skill,
followed by the resulting overall conversion from S1 (which corresponds to a
UFCStats "submission attempt"). All are ESTIMATE unless a hard source is
given.

Attribute modifiers legend (applied per §5 rules): **SG** skill gap
(grappling), **FLX** flexibility, **STR** strength/squeeze, **SLIP**
sweat/blood slipperiness, **FAT** fatigue, **GRIP** grip strength/glove
interference, **DMG** accumulated damage/rocked state, **LEN** limb length.

---

### 2.1 Rear-naked choke (RNC)

* **Required positions:** back control (hooks in, or body triangle), back
  from turtle ("seatbelt" without hooks), standing back-take (rare; must
  drag down), occasionally from a scramble when the opponent turns to avoid
  ground-and-pound.
* **Setup requirements:** seatbelt/strap grip (one arm over the shoulder,
  one under the armpit), chest-to-back connection, at least one hook or body
  triangle. In MMA the dominant *creator* of back control is **damage**:
  the bottom fighter turns away from ground-and-pound and gives the back
  (ESTIMATE: >50 % of UFC RNCs are preceded by strikes on the ground or a
  rocked opponent). Other creators: failed takedown → back (the "go-behind"),
  scramble from turtle, opponent's failed guillotine, failed armbar from
  guard (§2.7 chain).
* **Entry (S1):** the over-arm (choking arm) slides under the chin. Attacker
  uses the under-arm hand to "two-on-one" the defender's near hand and clear
  it, strikes with the over hand (ground-and-pound from the back) to make
  the defender defend with hands high, or uses the "short choke"/palm-to-palm
  variation when the figure-four cannot be completed.
* **Secure (S2):** choking arm under chin, hand placed on the biceps of the
  second arm, second hand behind the head (figure-four), or palm-to-palm.
  Hips glued, defender flattened on the choking-arm side if possible
  (Danaher "strap and hooks" system – BJJ Fanatics [D1]).
* **Finish (S3):** squeeze through the elbows/chest, expand the chest, chin
  of the attacker over the defender's shoulder. Blood choke on both carotids.
  Danaher: only "the width of your own wrist" needs to get under the chin;
  the second hand goes palm-down on the far shoulder rather than behind the
  head; finish by rotating toward the choking side [D1]. Figure-four is the
  cleaner blood choke; palm-to-palm/"short choke" (Marcelo Garcia) gives
  more pressure but less head control and is more often air/mixed [W3].
  **Time to tap once fully locked: 2–6 s** (ESTIMATE); **time to
  unconsciousness if no tap: RNC 8.9 s mean** (Stellpflug 2020 [P4];
  overall 9.0 s, CI 8.3–9.9). Injury risk if not tapping: unconsciousness
  (referee stops); if held ≥ 4 s past LOC, convulsions/staggering likely
  [P9]; rare cervical-artery dissection (10-case series, [P11]).
  FightScience [FS1]: the "critical 15 seconds" of grip-stripping precede
  the neck; gloves reduce the defender's grip-fighting; ground-and-pound
  forces the turtle/back exposure.
* **Defences by stage**
  * S0: never turn away from strikes; if the back is taken, keep the hooks
    from coming in (elbows to knees), turn *into* the attacker, get the back
    to the mat.
  * S1: chin tuck, hand-fight the choking hand with both hands ("two hands on
    one wrist"), keep the shoulder shrugged, hide the neck in the "peekaboo".
  * S2: address the *second* hand (push the elbow of the choking arm down /
    "answer the phone" wrist grip), turn toward the choking-arm elbow.
  * S3: slide the body to the mat on the choking-arm side while turning in
    (Kesting "escape to the choking-arm side" — Grapplearts [K1]), peel the
    hand, or ride it out until the round ends (rarely > 5 s).
* **Escapes and where you end up:** clear one hook + turn in → attacker's
  guard or half guard (most common, 55 % of escapes ESTIMATE); scoot down
  and out → turtle then stand (25 %); roll over the attacker's shoulder →
  top of a scramble (10 %); referee round-end (10 %).
* **Counters:** essentially none once locked; the "counter" is the escape.
  From back control the defender who turns in aggressively can end in the
  attacker's guard and pass/strike.
* **Chains:** RNC (hands defended) → **armbar from the back** (§2.7 back
  variant), → **rear triangle / arm-triangle from back**, → **body-triangle
  crush + strikes** (TKO route), → **neck crank** (illegal-ish variants
  aside, legal cranks exist), → mount if the defender turns to escape.
  Inbound chains: failed guillotine (attacker sprawls past) → back; failed
  armbar from guard → back; turtle → RNC; front headlock/D'Arce failure →
  go-behind → RNC.
* **Attribute modifiers:** SG dominant; STR moderate (squeeze); GRIP
  (gloves make figure-four harder, palm-to-palm more common); SLIP slight;
  FAT of defender large (tired fighters give the back); DMG very large.
* **Finish frequency:** 648 UFC finishes, 39.1 % of subs [G1]; 49 % of
  chokes [P2]; the most converted technique in the sport.

| Stage | P(advance) | Duration | Notes |
|---|---|---|---|
| S0 (have back control w/ seatbelt) | — | — | trigger |
| S1 arm under chin | 0.45 / 5-s window, re-rollable | 1–3 s | +0.25 if defender is rocked/DMG |
| S2 second hand in | 0.60 | 2–6 s | |
| S3 tap | 0.90 | 2–6 s | 0.10 = escape/round end |
| Attempt→finish | ≈ 0.24 per single attempt; ≈ 0.45 over a full 60-s back-control episode with re-tries (ESTIMATE) | | |

---

### 2.2 Guillotine family

Variants: **standard (arm-out)**, **arm-in**, **high-elbow ("Marcelotine",
Marcelo Garcia)**, **ten-finger / power guillotine**, **mounted guillotine**,
**standing guillotine** (§2.30).

* **Required positions:** front headlock (from sprawl, from a shot, from a
  snap-down), closed guard / butterfly guard with head control, standing
  clinch (opponent bent over), mount (mounted guillotine after pulling the
  head up), scramble where the opponent's head is low.
* **Setup requirements:** opponent's head below the attacker's chest with
  the neck exposed; a chin-strap grip (blade of the wrist on the throat);
  ideally the opponent's head on the attacker's *own* hip side. Created by:
  sprawling on a shot (the #1 MMA creator), a wild takedown, a snap-down
  from the collar tie, an opponent posturing down after eating strikes,
  and *ducking under a punch*.
* **Entry:** wrist-under-chin, second hand clasps (standard: palm on wrist
  "figure-four"; high-elbow: elbow up and over the shoulder; ten-finger:
  interlocked fingers; arm-in: trapped arm inside the loop).
* **Secure:** pull guard (closed guard is best for standard; arm-in often
  finished from half guard or "off the side" because closed guard weakens
  the arm-in), or stay standing/kneeling for a power guillotine; sit hips
  back and lift the chest; angle the body *away* from the trapped head
  side. Mounted guillotine: from mount, cup the chin, pull to sit, lock,
  and roll to guard or finish in place.
* **Finish:** hips forward/back, shoulders up, elbow tight; standard =
  mixed air/blood (trachea + one carotid), arm-in = predominantly blood with
  shoulder pressure, high-elbow = strong bilateral carotid choke.
  **Time to tap once locked:** standard 4–12 s; high-elbow 3–8 s; arm-in
  6–20 s; ten-finger 5–15 s (ESTIMATE). **Time to LOC when applied as a
  functional blood choke: standard ≈ 8.9 s, arm-in ≈ 10.2 s** [P4][W4].
  Injury if not tapping: unconsciousness (blood variants) or laryngeal /
  hyoid injury (air variant — Singerman 2026: 88 % of BJJ/MMA practitioners
  report laryngopharyngeal symptoms after chokes; 8 of 18 who sought care
  had a hyolaryngeal fracture [P12]); the defender frequently endures a bad
  standard guillotine long enough to escape. Kesting's "strong side / weak
  side" rule [K2]: the choke is strong when the defender's head, legs and
  body are all on the same side of the attacker; the defender should
  scramble to the weak side immediately. Adesanya on McGregor–Poirier (UFC
  264): the guillotine's cost is ending up underneath [W4] — positional
  risk drives early release.
* **Defences by stage**
  * S0: keep the head *up* on shots, don't leave the neck; when snapped
    down, drive the head to the attacker's *outside* hip.
  * S1: "answer the phone" — hand over the choking forearm/shoulder; chin
    tuck; turn the head so the throat is not on the blade.
  * S2: posture *up* if standing; if in guard, put the head on the mat on
    the choking side, drive the shoulder into the throat, walk the legs to
    the choking-arm side ("go to the far side").
  * S3: pass to the choking-arm side and stack; grab the far hip; the
    **von Flue** counter (§2.20) when the attacker keeps the guillotine from
    side control; peel the elbow. Arm-in: push the trapped arm through and
    "swim" it.
* **Escapes and where you end up:** pass to side control on the choking
  side (most common; 50 % ESTIMATE), stand up out of it (25 %), attacker
  abandons to keep guard (25 %).
* **Counters:** von Flue choke; pick-up-and-slam (legal, e.g., Jones-era
  slams out of guillotines); back-take when the guillotine attacker rolls;
  *dropping the weight* through the attacker's guard to break the grip.
* **Chains:** guillotine → **D'Arce / anaconda** (if the opponent's arm is
  in/out appropriately at the front headlock), → **mounted guillotine** (from
  a sweep or when on top), → **back take** (go-behind when the defender
  turns), → **triangle** (from guard when the head pulls out), → **armbar**
  when the defender posts. Inbound: sprawl → front headlock; takedown
  defence; snap-down; failed knee-tap; opponent's failed head-inside
  single-leg; caught during a *standing* exchange (standing guillotine).
* **Attribute modifiers:** SLIP large (sweaty necks slide out; the #1
  reason guillotines fail late), GRIP large (gloves + sweat), STR moderate,
  LEN of attacker's arms + defender neck size (thick-necked HWs resist), FAT
  of attacker large (guillotines burn the forearms; abandoned in seconds if
  tired), DMG moderate.
* **Finish frequency:** 293 UFC (17.7 %) [G1]; ~23 % of all UFC chokes when
  standard + arm-in are pooled [P2]. **Lowest conversion of the big five** —
  it is the most-attempted technique; FightEncyclopedia quotes ≈ 9.5 %
  success per attempt in grappling competition [F1] (ESTIMATE MMA 10–15 %).

| Stage | Standard | Arm-in | High-elbow | Ten-finger | Mounted |
|---|---|---|---|---|---|
| S1 chin strap in | 0.55 | 0.55 | 0.45 | 0.60 | 0.50 |
| S2 lock + hips/guard | 0.45 | 0.40 | 0.55 | 0.40 | 0.55 |
| S3 tap | 0.45 | 0.40 | 0.65 | 0.45 | 0.70 |
| Attempt→finish | 0.11 | 0.09 | 0.16 | 0.11 | 0.19 |
| Lock→tap time | 4–12 s | 6–20 s | 3–8 s | 5–15 s | 4–10 s |

---

### 2.3 D'Arce / brabo choke

* **Required positions:** front headlock with the opponent's near arm
  *inside* (attacker's arm threads under the far armpit... i.e., under the
  opponent's near arm and across the neck), top half guard (opponent
  under-hooks; attacker threads over the under-hook), turtle, side control
  when the bottom fighter turns in, sprawl on a single leg.
* **Setup:** opponent's arm and head on the *same* side of the attacker's
  threading arm; opponent's head low. Created by: sprawl, opponent's
  under-hook attempt from half guard (the biggest MMA creator), opponent
  shooting a head-inside single, a scramble after a failed guillotine.
* **Entry:** thread the arm (palm up) under the near arm and across the
  throat until the hand appears on the far side of the neck; grab the
  attacker's own biceps (figure-four/"brabo grip").
* **Secure:** free hand goes behind the head, sprawl the hips, walk toward
  the opponent's head/side so the opponent is on their shoulder/side, keep
  the opponent's trapped shoulder driven into their own neck. Finishes from
  sprawl, from the side ("walking around"), or from the opponent's back
  (rolling D'Arce) — coaching consensus: Jeff Glover, Danaher front-headlock
  system.
* **Finish:** squeeze + rotate the chest down toward the opponent's hip;
  bilateral carotid via own shoulder + forearm. **Time to tap once locked:
  3–10 s** (ESTIMATE). Unconsciousness if no tap (≈ 9 s).
* **Defences:** S0 don't under-hook lazily from bottom half guard, keep the
  elbow tight; S1 pull the threatened arm out (the "swim"), posture the
  head up; S2 turn *toward* the attacker (belly-down), keep the trapped
  shoulder away from the neck ("shoulder to the ear" is death), walk the
  legs toward the attacker; S3 roll through (the "rolling escape") to come
  up on top, or explode to the knees and drive.
* **Escapes/end positions:** to knees/turtle (attacker keeps front headlock,
  40 %), roll through → attacker on bottom in half guard (20 %), pull the
  arm free → bottom half guard (40 %). ESTIMATE.
* **Counters:** the roll-through can put the defender on top; a strong
  bridge into the attacker while the grip is loose; low-elbow escape then
  single-leg.
* **Chains:** D'Arce ↔ **anaconda** (switch when the head/arm position
  flips), → **arm-triangle** (if the attacker ends up mounted/side on top
  with the arm still trapped), → **back take** (if the defender turns
  away), → **Peruvian necktie / Japanese necktie** from the same front
  headlock, → **guillotine** if the arm slips out. Inbound: half guard top,
  sprawl, turtle, failed guillotine.
* **Modifiers:** LEN of attacker arms very large (long arms finish; short
  arms fail S2), SLIP large, STR moderate, SG.
* **Finish frequency:** 47 UFC (2.8 %) [G1]; ~2 % of chokes [P2].
  Signature users: Tony Ferguson, Jeff Glover (grappling), Charles Oliveira.

| Stage | P | Duration |
|---|---|---|
| S1 thread | 0.45 | 1–3 s |
| S2 figure-four + walk/sprawl | 0.50 | 3–8 s |
| S3 tap | 0.70 | 3–10 s |
| Attempt→finish | 0.16 | |

---

### 2.4 Anaconda choke

* **Required positions:** front headlock/turtle where the attacker threads
  the arm *under the neck first* and out under the far armpit (mirror of the
  D'Arce). Also from a sprawl.
* **Setup:** opponent's head down, near arm exposed; grip = attacker's hand
  on own biceps ("gator" grip), the elbow of the trapped arm pushed into
  the opponent's neck.
* **Entry:** thread under the neck, exit under the armpit, figure-four.
* **Secure:** the "gator roll" — roll across the opponent's *trapped* side
  to bring them onto their back/side with the attacker's chest on top;
  walk the hips toward the opponent's head to close.
* **Finish:** squeeze, chest down, drive the opponent's shoulder into their
  own neck. **Lock→tap 3–10 s** (ESTIMATE).
* **Defences:** S1 keep the elbow tight to the ribs so there is no gap under
  the armpit; S2 don't roll with it — post the free hand and walk the feet
  *against* the roll direction; S3 pull the trapped arm free, drive the head
  through, or roll *with* it fast to come out on top.
* **Escapes/end positions:** back to turtle (40 %), reverse onto top (20 %),
  arm free → bottom side/half (40 %). ESTIMATE.
* **Counters:** roll counter; single-leg from turtle on a loose grip.
* **Chains:** anaconda ↔ D'Arce; → arm-triangle after the roll; → back
  take; → guillotine.
* **Modifiers:** LEN, SLIP, STR (same as D'Arce).
* **Frequency:** 38 UFC (2.3 %) [G1].
* Stage P: S1 0.40, S2 0.50, S3 0.70 → 0.14 per attempt. Duration S2 3–8 s.

---

### 2.5 Arm-triangle (head-and-arm / kata-gatame)

* **Required positions:** mount (most common in MMA — often after the
  bottom fighter frames against strikes and the arm gets pushed across), side
  control, top half guard (knee-slide arm-triangle), from the back
  (rear arm-triangle, rare).
* **Setup:** the opponent's arm pushed across their own face/neck; attacker's
  head on the *far* side; chest pressure. In MMA the arm goes across when
  the bottom fighter *blocks punches* or posts to bridge — ground strikes
  are the primary creator (ESTIMATE 60 % of UFC arm-triangles follow GnP
  from mount).
* **Entry:** attacker's arm goes under the neck, hand to own biceps or
  palm-to-palm (gable), head drops to the mat on the far side.
* **Secure:** dismount to the *opposite* side (leg steps over to side
  control on the side away from the trapped arm), sprawl hips low, walk
  toward the opponent's head. Keep the trapped arm pinned by the attacker's
  own head/shoulder.
* **Finish:** squeeze + hip pressure driving the opponent's shoulder into
  their carotid. **Lock→tap 5–15 s** (ESTIMATE; slow to set but very high
  finishing % once the attacker has dismounted correctly). **Time to LOC
  ≈ 7.2 s** — the fastest of the common chokes [P4][W5]. Unconsciousness if
  no tap: 13 of 92 arm-triangle victims in one UFC tally went out [SK4].
  Reference finishes: Makhachev d. Oliveira UFC 280; Khabib's filmed escape
  of Makhachev's modified arm-triangle [BJ2].
* **Defences:** S0 never let the arm cross the centreline from mount —
  elbows to the hips, frame on the hip not the face; S1 turn *into* the
  attacker and pull the arm back; S2 "answer the phone" with the trapped
  arm (hand to own ear/behind own head), bridge toward the attacker as they
  dismount, get the knee in; S3 walk the legs toward the attacker to reduce
  the angle, bridge and turn to knees, or hold the round out (arm-triangles
  are slower than RNC).
* **Escapes/end positions:** bridge-and-turn → attacker's guard or turtle
  (50 %), attacker retains side control/mount but loses the choke (40 %),
  rare reversal (10 %). ESTIMATE.
* **Counters:** the bridge into the attacker as they step over; from
  half guard, under-hook and come up to a single.
* **Chains:** mount GnP → arm-triangle; arm-triangle (defended) → mount
  re-established → **Americana/kimura** (the arm is already across), →
  **mounted triangle**, → **back take** if the defender turns away, → **mounted
  guillotine**. Inbound from D'Arce/anaconda after the roll; from
  knee-slide pass.
* **Modifiers:** STR moderate, SLIP large (sweaty chests slide — HW/large
  fighters have the highest failure rate at S3), body-size mismatch large
  (bigger attacker = better), DMG very large.
* **Frequency:** 126 UFC (7.6 %) [G1]; 8.2 % of chokes [P2]. High
  conversion once dismounted: S1 0.50, S2 0.55, S3 0.75 → **0.21 per
  attempt**; S2 lasts 4–10 s.

---

### 2.6 Triangle choke family

Variants: **front triangle from guard**, **triangle from mount / mounted
triangle**, **rear triangle from the back**, **flying triangle (§2.31)**,
**reverse/inverted** (very rare in MMA).

* **Required positions:** closed guard or open guard with the opponent's
  posture broken and *one arm in, one arm out*; mount (S-mount → step the leg
  over the head); back control (rear triangle).
* **Setup:** opponent's one arm pushed between the attacker's legs or
  pinned to the hip; the other arm posted outside; hips high; attacker's
  legs long enough for the opponent's frame. In MMA the creator is usually
  an opponent posturing to strike from guard with one arm posted, an
  overhook/arm-drag exchange, or the defender pushing on the hip to pass.
* **Entry:** shoot the leg over the shoulder, cross the ankles (the
  "diamond"), or lock the figure-four immediately.
* **Secure:** cut the angle (perpendicular), pull the head down, place the
  trapped arm across the throat, lock the figure-four with the shin behind
  the knee, cup the shin. From mount: S-mount, step over the head, roll or
  finish in place.
* **Finish:** squeeze the knees, pull the head, raise the hips. Bilateral
  carotid via own thigh + the trapped shoulder. **Lock→tap 5–15 s**; a
  poorly angled triangle can be held 30–60 s while the defender stalls.
  **Time to LOC ≈ 9.5 s** [P4][W6]. Unconsciousness if no tap; MMA
  defenders often go out in triangles. Paul Craig holds the UFC record for
  triangle finishes [FS2]. Slam precedents: Rampage Jackson powerbombed
  Arona out of a triangle (PRIDE, 2004); Matt Hughes slammed Carlos Newton
  out of a triangle at UFC 34 (2001) [W7].
* **Defences:** S0 posture, both hands in or both out, hands on the hips not
  the mat; S1 posture up and pull the head out before the lock; S2 "answer
  the phone" (trapped hand grabs own ear/behind own head), keep the head
  facing the trapped arm, drive the shoulder, stack; S3 stack + walk around
  to the trapped-arm side, pass the free arm through, **slam** (legal in
  UFC; Rampage-style — rare, very effective at HW/LHW), posture with the
  trapped arm up ("the Henderson escape"), or strike (elbows to the thigh
  are legal and used).
* **Escapes/end positions:** posture out → back in the attacker's guard
  (55 %), stack-pass → side control on the attacker (25 %), slam → top of
  a scramble (10 %, but often KO), round ends (10 %). ESTIMATE.
* **Counters:** slam; leg-lock counter (a knee-bar/ankle attack when the
  attacker crosses the ankles in a diamond — Ryan Hall style); knee-slice
  pass through the diamond; strikes to the body.
* **Chains:** triangle → **armbar** (the arm pinned across the throat is
  already isolated) → **omoplata** (arm ends outside the leg) → back to
  triangle — the classic "triangle-armbar-omoplata" triad; triangle →
  **mounted triangle → armbar**; triangle → **gogoplata** (extreme FLX); front
  triangle → sweep to **mounted triangle**; failed triangle from mount →
  side control retained. Inbound: armbar defended by the defender pulling
  the arm back; failed guillotine from guard; RNC hands defended → rear
  triangle; arm-drag from guard; Kimura-trap grip.
* **Modifiers:** FLX large, LEN (leg length vs opponent torso) very large,
  STR (defender's ability to stack/slam) large, weight of defender — the
  slam risk scales with STR gap, SLIP moderate, FAT of attacker moderate
  (legs cramp).
* **Frequency:** 114 UFC (6.9 %) [G1]; 8.8 % of chokes [P2]. Triangles have
  many long, failed attempts: ESTIMATE attempt→finish 10–15 %.

| Stage | Guard | Mounted | Rear |
|---|---|---|---|
| S1 leg over | 0.50 | 0.55 | 0.45 |
| S2 angle + lock | 0.45 | 0.55 | 0.50 |
| S3 tap | 0.55 | 0.70 | 0.60 |
| Attempt→finish | 0.12 | 0.21 | 0.14 |
| S2 duration | 3–10 s | 3–8 s | 3–8 s |

---

### 2.7 Armbar (juji-gatame) family

Variants: **from guard**, **from mount (S-mount / "spinning armbar")**,
**from the back**, **belly-down**, **straight armbar from top/knee-on-belly**,
**rolling/flying (§2.31)**.

* **Required positions:** closed guard with the opponent's arm extended
  across the centre; mount with the arm isolated (S-mount); back control
  when the opponent defends the RNC with the arm high; north-south or side
  control (spinning); standing (flying).
* **Setup:** isolate one arm with wrist/elbow control, hips *under* the
  shoulder, the opponent's posture broken (guard) or the attacker's knee
  high on the chest (mount). MMA creators: opponent posting on the mat to
  strike or to base; opponent pushing off the chest to escape mount;
  RNC hand-fighting exposing the arm; the classic Rousey judo-throw →
  mount → armbar route.
* **Entry:** guard: hips up, leg over the face, cut the angle. Mount:
  S-mount, step over the head, fall back or stay belly-down. Back: RNC hands
  defended → slide the leg over the face and fall to the side.
* **Secure:** knees pinched, thumb up, elbow above the attacker's hip, heels
  heavy, head under control (leg over the face).
* **Finish:** hip extension against the elbow. **Lock→tap 0–3 s** once the
  elbow is past the hip and the arm is straight (pain precedes structural
  failure in joint locks, so taps are near-immediate — Hasegawa 2026 [P13]);
  injury if no tap = elbow hyperextension: MRI of 5 elite BJJ athletes
  injured by armbar showed **UCL rupture in 100 % and common-flexor-tendon
  rupture in 100 %**, bone contusion in 60 %, no fractures (Almeida 2017
  [P14]); refused taps go to fracture/dislocation within ~1–3 s of full
  extension (Mir–Sylvia UFC 48 radius/ulna fracture; Rousey–Tate and
  Rousey–Budd elbow dislocations [WR2]). In BJJ competition data the elbow
  via armbar is the most common injury: armbar caused 10 of 14 elbow
  injuries across 5,022 exposures (Scoggin 2014 [P3]); armbar = 22.4 % of all
  submission-inflicted injuries in a 1,140-athlete survey (Hinz 2021 [P15]).
  Armbars are 67 % of UFC upper-limb joint submissions; ≈ 9 % of those
  produce a serious injury with ~10-month layoff (Fares 2026 [P5]).
* **Defences:** S0 never post far from your own hip; keep elbows in;
  S1 pull the elbow back to the ribs before the leg clears the head,
  posture, drive the head to the attacker's chest; S2 **grip fighting** —
  clasp hands (gable/"S-grip"), grab own thigh/shorts, "hitchhiker" (turn
  the thumb *toward* the attacker's leg and rotate out, ending on top), the
  "stack" (drive weight over the attacker's hips), roll toward the head
  (spin-out), or **slam** (allowed; effective if the attacker keeps the
  belly-down or hangs on standing). S3 last-ditch: rotate the thumb,
  bend the arm with the free hand, roll through — almost never works once
  the arm is straight against the hips.
* **Escapes/end positions:** posture + pull out → back in the guard /
  retain top (45 %), stack & pass → side control on the attacker (25 %),
  hitchhiker/spin-out → top position (15 %), attacker abandons to keep
  mount/back (15 %). ESTIMATE.
* **Counters:** slam; stack-pass; from a failed mount armbar the *defender*
  can come up into the attacker's guard or even take the back if the
  attacker falls off; from a failed *back* armbar the defender escapes to
  top of half guard.
* **Chains:** armbar (defended by grip) → **triangle** (throw the leg over
  the head); armbar → **omoplata**; armbar from guard failed → **back take**
  (attacker spins to the back as the defender pulls out); mount armbar
  failed → **mounted triangle / back**; back armbar failed → back retained
  or **RNC** again ("RNC → armbar → RNC" loop); kimura grip → armbar
  (§2.8). Inbound: RNC hands defended; triangle arm across; kimura;
  knee-on-belly with a push.
* **Modifiers:** SG dominant, FLX moderate (attacker), STR of defender
  large (grip break/slam), GRIP (glove grabbing is illegal, but gloves make
  the defender's clasp harder), SLIP moderate (sweaty arms slide out of the
  attacker's grip at S2, but also make the finish slide through the
  defender's clasp), LEN (long legs help the leg-over-face).
* **Frequency:** 195 UFC (11.8 %) [G1]. Third most common. Attempt→finish
  ESTIMATE 15–20 %.

| Stage | Guard | Mount | Back | Belly-down |
|---|---|---|---|---|
| S1 leg over / spin | 0.45 | 0.55 | 0.45 | 0.50 |
| S2 grip broken, arm isolated | 0.45 | 0.50 | 0.55 | 0.50 |
| S3 tap | 0.85 | 0.85 | 0.80 | 0.85 |
| Attempt→finish | 0.17 | 0.23 | 0.20 | 0.21 |
| Grip-break battle (S2) duration | 3–12 s | 3–10 s | 2–8 s | 2–6 s |

Note: if the attacker *loses* a mount armbar the positional cost is high
(mount → guard/scramble) — model this as an explicit risk (§5 rule 24).

---

### 2.8 Kimura (double wrist-lock / ude-garami) family

Variants: **from closed guard**, **from half guard (bottom)**, **from side
control (top)**, **from north-south**, **from top half guard**,
**as a sweep / back-take grip ("kimura trap")**, **standing (from the
clinch / whizzer counter)**.

* **Required positions:** any position where the attacker has a figure-four
  grip on the opponent's wrist with the elbow bent ~90° and the attacker's
  chest controls the shoulder.
* **Setup:** opponent posts a hand on the mat, grabs a single-leg with the
  arm exposed (the "whizzer kimura"), or defends a sweep. MMA creators: the
  opponent's post to base out of a sweep, defending the takedown, or the
  bottom fighter grabbing an under-hook that the top fighter wraps.
* **Entry:** wrist grip + own wrist grip (figure-four), elbow pinned to the
  attacker's chest.
* **Secure:** hip out (from guard), keep the opponent's elbow bent and away
  from their body, trap the opponent's arm with the leg (from top), or
  "hip in" so they cannot roll.
* **Finish:** rotate the wrist toward the opponent's spine/head. **Lock→tap
  1–4 s** once rotation begins with the elbow controlled. Injury if no tap:
  shoulder (rotator cuff/labrum), humeral spiral fracture (Mir–Nogueira,
  UFC 140, 2011).
* **Defences:** S0 don't post the hand away from the hip; S1 straighten the
  arm or grab your own belt/shorts/thigh (Danaher: "the arm is only in
  danger if it is bent and away from the body"); S2 roll *with* the
  rotation (roll over the shoulder), turn the elbow down toward the mat,
  drive the head toward the trapped arm; S3 from top: stay heavy, posture
  up and pull the arm free while the attacker is in guard (the guard kimura
  is weak without a hip angle).
* **Escapes/end positions:** straighten and pull out → same position
  (60 %), roll through → attacker still holds the grip and often ends on top
  ("kimura trap" — the escape *is* the attacker's sweep) (25 %), stand up
  out of guard kimura (15 %). ESTIMATE.
* **Counters:** the top fighter can pass over the kimura leg; the bottom
  fighter can use the roll to reverse.
* **Chains (the richest in the graph):** kimura grip → **sweep** (from guard/
  half guard: hip-bump + kimura), → **back take** (the "kimura trap" —
  David Avellan system), → **armbar** (straight-arm variant when the
  defender straightens), → **guillotine** (from the whizzer kimura standing
  when the head drops), → **take down** (standing kimura from the clinch),
  → **north-south kimura ↔ north-south choke**, → **arm-triangle** from side
  control when the arm is pushed across; failed kimura from top → mount /
  side control retained.
* **Modifiers:** STR large (the kimura is the "strong man's submission"),
  GRIP large (sweaty wrists slip; gloves make the wrist grip bulkier),
  FLX of defender large (flexible shoulders resist longer), SG.
* **Frequency:** 43 UFC (2.6 %) [G1]. Attempt→finish ESTIMATE 8–12 %
  (most kimura grips are used for control/sweeps, not finishes).

| Stage | Guard | Half-guard bottom | Side/N-S top | Standing/clinch |
|---|---|---|---|---|
| S1 figure-four | 0.50 | 0.45 | 0.55 | 0.35 |
| S2 elbow isolated + angle | 0.35 | 0.35 | 0.55 | 0.30 |
| S3 tap | 0.65 | 0.60 | 0.80 | 0.50 |
| Attempt→finish | 0.11 | 0.09 | 0.24 | 0.05 |

---

### 2.9 Americana / keylock (bent-arm lock, ude-garami "paint brush")

* **Required positions:** mount, side control (almost never from guard).
* **Setup:** opponent's arm bent ~90° and pinned to the mat above the
  shoulder line; created in MMA by the bottom fighter *blocking punches*
  with a high frame or by pushing on the attacker's chest.
* **Entry:** wrist pinned, attacker's other arm threads under the elbow and
  grabs own wrist.
* **Secure:** elbow low ("paint brush" the knuckles along the mat), keep
  weight on the chest.
* **Finish:** lift the elbow, drive the wrist down. **Lock→tap 2–6 s**;
  injury if no tap = shoulder (labrum/cuff) and elbow.
* **Defences:** S0 elbows to the ribs, never let the arm go above shoulder
  line under mount; S1 straighten the arm; S2 bridge into the attacker and
  turn the elbow toward the mat; S3 roll with it (from side control), or
  grab own head/hair.
* **Escapes:** straighten → position retained by the top fighter (80 %),
  bridge escape → half guard (20 %). ESTIMATE.
* **Counters:** none positionally; the escape.
* **Chains:** Americana ↔ kimura (arm flips), → arm-triangle (arm across),
  → mounted GnP, → armbar from mount (if the defender straightens to escape).
* **Modifiers:** STR large, FLX of defender large.
* **Frequency:** ESTIMATE 12–18 UFC finishes all-time (~1 %), heavily
  early-era; high finish rate on beginners, very low on trained fighters.
  Stage P: S1 0.45, S2 0.40, S3 0.75 → 0.14; vs Elite-tier defenders ≈ 0.03.

---

### 2.10 Omoplata

* **Required positions:** closed/open guard (arm outside the attacker's
  hip), from a failed triangle/armbar, from rubber guard, as a counter to a
  knee-slice pass.
* **Setup:** opponent's arm on the *outside* of the attacker's hip; hips
  high; attacker's leg over the shoulder facing the same side.
* **Entry:** swing the leg over the shoulder, sit up, control the hip/belt
  with the arm to prevent the forward roll.
* **Secure:** sit up perpendicular, hip pressure onto the shoulder, trap
  the arm against the leg, flatten the opponent.
* **Finish:** hip forward and lean, rotating the shoulder. **Lock→tap 3–8
  s**. Injury if no tap: shoulder.
* **Defences:** S1 posture and pull the arm out early; S2 **forward roll**
  (the opponent rolls through to escape — easiest and most common), drive
  the hip through and stand, cross the free arm; S3 "step over" the
  attacker's head to sit into their guard.
* **Escapes/end positions:** forward roll → the attacker often gets a sweep
  / top position (this is why the omoplata is used as a sweep in MMA)
  (45 %), posture out → back in guard (35 %), stand up → free (20 %).
  ESTIMATE.
* **Counters:** the opponent can stack into the attacker if the leg is
  loose, or **strike** the attacker's face during the sit-up.
* **Chains:** omoplata → **sweep** (main outcome), → **triangle**
  (re-enter), → **armbar** (straight arm), → **kimura** (roll), → **back
  take** (if the opponent rolls and stops on the side), → **gogoplata**
  (rubber guard). Inbound: triangle/armbar failure, opponent's knee-slice.
* **Modifiers:** FLX very large (hip mobility), LEN.
* **Frequency:** ESTIMATE 2–4 UFC finishes all-time (≈ 0.2 %); attempt→
  finish ≈ 3–5 % but sweep success ≈ 40 %.
* Stage P: S1 0.45, S2 0.35, S3 0.30 → 0.05 as a *submission*; as a *sweep*
  0.45 × 0.85 ≈ 0.40.

---

### 2.11 Heel hooks (inside/outside; saddle/411; 50/50; ashi garami)

* **Required positions:** any leg entanglement — **ashi garami (single-leg X)**
  for the outside heel hook; **inside sankaku / saddle / 411 / "honey hole"**
  for the inside heel hook; **50/50**; **cross ashi**; also a *standing*
  entanglement after an Imanari roll (Ryan Hall), or from bottom of a pass
  attempt.
* **Setup:** the opponent's knee line trapped between the attacker's
  thighs/legs, the heel exposed. MMA creators: the opponent stepping over
  the attacker's guard to pass (the "step-over" is the biggest gift),
  opponent standing in the open guard, Imanari roll, opponent kicking with a
  leg the attacker catches (rare), scrambles where a leg is left behind.
* **Entry:** cross the leg over the knee line (the attacker's outside leg
  hooks the opponent's leg to block the knee from turning), secure the heel
  with the elbow ("heel in the armpit").
* **Secure:** figure-four with the hands under the heel, knee line
  controlled (this is the whole battle — Danaher "Enter the System" [D2];
  Lachlan Giles, Craig Jones — coaching consensus: **control the knee
  line before the heel**).
* **Finish:** rotate the heel across the body (inside: toward the attacker's
  chest; outside: away), keep the knee stationary. **Lock→tap 1–3 s**; the
  heel hook gives *little pain before structural damage* — the tear can
  precede pain, so novices are injured *without* tapping (LCL/PCL/ACL,
  tibiofibular ligaments, meniscus — Wikipedia *Leglock* [W2]).
* **Defences:** S0 don't step over the guard; keep the knee off the
  centreline; S1 "hide the heel" — turn the knee *toward* the attacker's
  hooking leg, keep the toes pointed, "boot" (curl the foot behind the
  attacker's hip); S2 clear the knee line (kick the leg free before the
  outside hook locks), turn *into* the direction of rotation ("roll into
  it" for the outside heel hook, "roll away" for the inside — direction
  matters), strike the attacker's face (**legal and the main MMA defence**);
  S3 sprint-roll to unwind before the rotation completes (rarely works
  against a set 411); or *tap*.
* **Escapes/end positions:** clear the leg and stand → attacker on bottom
  open guard / neutral (50 %), pass over the entanglement → side control
  (20 %), counter-heel-hook (§counters) (10 %), attacker abandons for
  strikes (20 %). ESTIMATE.
* **Counters:** **heel hook counter to heel hook** in 50/50 (mutual
  exposure — first to finish wins), GnP from the top on the entangled
  attacker (why MMA fighters avoid leg locks: sitting in the entanglement
  exposes the attacker's head), the "knee-bar counter" when the attacker
  extends.
* **Chains:** heel hook ↔ **kneebar** (rotation fails → extension), ↔ **toe
  hold**, → **straight ankle lock** (fallback), → **calf slicer** (from 411
  when the leg is bent), → sweep / back take (from the saddle when the
  opponent turns), 50/50 → back take. Inbound: failed guard pass, Imanari
  roll, single-leg X sweep failure, opponent's failed kneebar.
* **Modifiers:** SG very large (leg-lock specialists vs non-specialists is
  the largest skill-gap effect of any submission), FLX of defender large,
  STR of attacker moderate, SLIP large (sweaty heels slip — a common
  no-gi/MMA failure), FAT of attacker (entanglements are cheap to hold).
* **Frequency:** ESTIMATE 20–30 UFC finishes all-time, ≈ 1–2 % of subs;
  no measurable rise since 2019 despite the ADCC leg-lock revolution
  (ADCC 2022 ≈ 31 % of finishes were heel hooks [F1]). Reason (Slack/Hall
  analyses, coaching consensus): entanglement exposes the leg-locker to
  strikes and takes the fight off its feet, and MMA gloves/sweat weaken the
  heel grip. Palhares is the outlier user.

| Stage | Inside (411) | Outside (ashi/50-50) |
|---|---|---|
| S1 knee line crossed | 0.45 | 0.40 |
| S2 heel captured + figure-four | 0.50 | 0.40 |
| S3 tap (or injury) | 0.85 | 0.70 |
| Attempt→finish | 0.19 | 0.11 |
| S2 duration | 2–8 s | 2–8 s |

---

### 2.12 Kneebar

* **Required positions:** leg entanglement with the opponent's leg
  extended across the attacker's hips; from top half guard (rolling
  kneebar), from the back (Suloev-stretch-adjacent), from the opponent's
  guard when they cross the ankles, from a failed heel hook.
* **Setup:** leg straight, knee at the attacker's hips, foot controlled
  under the armpit.
* **Entry:** roll or step through, hips under the knee.
* **Secure:** knees pinched, heel trapped under the armpit or grabbed, hips
  in line with the knee.
* **Finish:** hip extension against the knee. **Lock→tap 1–3 s**; injury if
  no tap = knee hyperextension (PCL/capsule).
* **Defences:** S1 bend the knee and pull the heel to the buttock; S2 turn
  the knee (rotate so the kneecap faces away from the hips), hide the foot
  ("figure-four your own legs"), sit up and strike; S3 roll toward the
  attacker's head.
* **Escapes/end positions:** leg freed → top position (attacker on
  bottom) (55 %), scramble neutral (35 %), reversal to attacker's back (10 %).
* **Counters:** counter-kneebar/heel hook in 50/50; GnP.
* **Chains:** kneebar ↔ heel hook, → toe hold, → straight ankle; failed
  rolling kneebar from top half guard → bottom (positional risk!).
* **Modifiers:** STR moderate, FLX of defender large (hamstring), SG.
* **Frequency:** ESTIMATE 20–25 UFC finishes (~1.3 %), e.g., Mir vs Lesnar
  (2008). Stage P: S1 0.40, S2 0.45, S3 0.80 → 0.14.

---

### 2.13 Straight ankle lock / Achilles lock

* **Required positions:** ashi garami / single-leg X, from open guard when
  the opponent stands, from the "leg-drag" when passing, 50/50.
* **Setup:** foot under the armpit, blade of the forearm under the Achilles.
* **Entry:** wrap, clasp (gable or figure-four), leg entanglement to keep
  the opponent from turning.
* **Secure:** hips forward, elbow tight to the ribs, opponent's knee
  controlled by the attacker's leg.
* **Finish:** arch the back, drive the forearm into the Achilles, plantar-
  flex the foot. **Lock→tap 3–8 s**; pain-driven — high pain tolerance
  fighters "grind through"; injury if no tap = ankle ligament sprain,
  Achilles/calf strain (rarely serious).
* **Defences:** S1 "boot" the foot (dorsiflex), turn the toes *toward* the
  attacker; S2 come up ("stand up out of it"), push the attacker's knee
  down, drive the hips forward to stack; S3 grind & strike, pull the foot.
* **Escapes:** stand and strike → top (60 %), pull out → neutral (40 %).
* **Counters:** counter-ankle lock in 50/50; GnP.
* **Chains:** ankle lock → **heel hook** (if the heel is exposed while the
  opponent turns), → **toe hold**, → single-leg X sweep. Inbound: failed
  heel hook.
* **Modifiers:** STR moderate, pain tolerance of defender large, FLX.
* **Frequency:** ESTIMATE 12–18 UFC (~1 %). Stage P: S1 0.50, S2 0.45,
  S3 0.45 → 0.10.

---

### 2.14 Toe hold

* **Required positions:** any leg entanglement, from top half guard, from
  the defender's turtle (rolling toe hold), 50/50, from a failed straight
  ankle lock.
* **Setup:** figure-four on the foot (hand on the toes, other hand under
  the shin grabbing own wrist).
* **Entry/Secure:** knee controlled (attacker's leg or chest), foot turned.
* **Finish:** rotate the foot toward the buttock/inward. **Lock→tap 1–3 s**;
  injury if no tap = ankle ligaments, sometimes knee.
* **Defences:** S1 dorsiflex, straighten the leg; S2 turn with it, pull the
  knee to the chest; S3 roll.
* **Escapes:** as ankle lock.
* **Chains:** ↔ heel hook, ↔ ankle lock, ↔ kneebar.
* **Modifiers:** GRIP large, STR, FLX of defender.
* **Frequency:** ESTIMATE 5–8 UFC finishes (Mir vs Abbott 2003). Stage P:
  S1 0.45, S2 0.45, S3 0.70 → 0.14.

---

### 2.15 North-south choke

* **Required positions:** north-south / side control transition (attacker
  moves to the head).
* **Setup:** attacker's arm around the neck, shoulder pressed into the
  throat, chest on the face; head side-by-side with the opponent's
  head (Marcelo Garcia's signature).
* **Entry:** from side control, slide the arm under the head while
  spinning to north-south.
* **Secure:** drop the hips low, "the choke is in the shoulder not the
  arm", grip hands or grab own shoulder; opponent's near arm trapped.
* **Finish:** chest down, drive the shoulder, be patient. **Lock→tap
  8–20 s** — slow; the defender often thinks they are fine and then goes out.
* **Defences:** S1 turn in, elbow to the neck; S2 bridge to create space,
  pull the head out backwards; S3 turn the head toward the arm's elbow and
  "walk" the shoulders out.
* **Escapes:** bridge and turn to knees → turtle (50 %), attacker resets
  side control (50 %).
* **Chains:** ↔ north-south kimura, → arm-triangle, → mount.
* **Modifiers:** SLIP very large (the worst offender in sweat), STR
  moderate, body size (bigger attacker better).
* **Frequency:** ESTIMATE 6–10 UFC (≈ 0.5 %). Stage P: S1 0.45, S2 0.45,
  S3 0.55 → 0.11.

---

### 2.16 Ezekiel choke (incl. from bottom in MMA)

* **Required positions:** mount (top), inside the opponent's closed guard
  (top), **from the bottom of mount / half guard** (Oleinik's MMA
  speciality — the gloves give a grip the gi sleeve gives in BJJ), from the
  back.
* **Setup:** one arm behind the opponent's head, the other hand pushes
  into the throat with the wrist grabbed or the fist wedged (no-gi: the
  "fist in the throat" variation).
* **Entry/Secure:** hand grips own opposite wrist (glove edge) and
  drives the forearm across the neck; head pressure.
* **Finish:** squeeze the elbows, push the fist through. **Lock→tap
  5–15 s**; mixed air/blood.
* **Defences:** S1 keep the head out of the arm; S2 posture, pull the
  hand off the throat, turn the chin to the elbow; S3 from bottom-of-mount
  Ezekiel the top fighter simply postures up and strikes (which is why it
  works only on fighters who stay low and heavy).
* **Escapes:** posture → mount retained (70 %); from the bottom, the
  defender frames and bridges (30 %).
* **Chains:** from mount → arm-triangle; from bottom → guillotine when the
  opponent pulls out.
* **Modifiers:** STR large, SLIP large, GRIP (MMA gloves *help*).
* **Frequency:** ESTIMATE 3–5 UFC (~0.2 %), 2 by Oleinik (Pesta 2017 first
  UFC Ezekiel; Albini 2017). Stage P (top): S1 0.40, S2 0.40, S3 0.45 →
  0.07; (bottom): 0.30 × 0.35 × 0.40 → 0.04.

---

### 2.17 von Flue choke

* **Required positions:** side control where the bottom fighter is
  *holding a guillotine* (or head-and-arm grip) after the attacker has
  passed to the choking-arm side.
* **Setup:** the defender's guillotine grip persists after the pass; the
  top fighter's shoulder is in the throat.
* **Entry/Secure:** top fighter drives the shoulder into the neck, clasps
  the hands under/around the back of the head, drops the hips.
* **Finish:** shoulder pressure across the carotid. **Lock→tap 4–10 s**.
* **Defences:** release the guillotine (the whole counter depends on the
  bottom fighter's stubbornness) and turn in.
* **Escapes:** release → bottom side control (the escape *is* releasing).
* **Chains:** inbound only from a guillotine. Counter-to-counter: none.
* **Modifiers:** SG (knowing when to let go), STR of top fighter.
* **Frequency:** ESTIMATE 6–9 UFC; Jason Von Flue (2006), OSP ×3 (Krylov
  2016, Okami 2017, Oleksiejczuk 2019). Stage P once the pass is completed
  with the grip retained: S2 0.60, S3 0.65 → 0.39 (high, because the
  defender has already made the mistake).

---

### 2.18 Peruvian necktie

* **Required positions:** front headlock with the opponent turtled and the
  attacker standing/kneeling at the head; the attacker's arm threads
  (guillotine-style, arm-in) and the attacker sits back throwing a leg over
  the opponent's back/neck.
* **Setup:** front headlock with the near arm in.
* **Entry:** grip locked (ten-finger or figure-four), attacker sits to the
  hip with one leg over the neck, one over the back.
* **Secure:** legs clamp, opponent's posture broken forward.
* **Finish:** lean back, pull with the arms, push with the legs. **Lock→tap
  4–10 s**; blood + crank.
* **Defences:** S1 keep the head up in the front headlock, don't let the
  arm in; S2 posture backward as the attacker sits, walk the knees toward
  the attacker; S3 roll toward the choking arm.
* **Escapes:** posture out → turtle/scramble (55 %), roll → attacker on
  bottom (30 %), round end (15 %).
* **Chains:** front headlock → Peruvian necktie ↔ Japanese necktie ↔
  D'Arce ↔ anaconda ↔ guillotine.
* **Frequency:** ESTIMATE 3–5 UFC (Dollaway 2008). Stage P: S1 0.40, S2 0.45,
  S3 0.60 → 0.11.

---

### 2.19 Japanese necktie

* **Required positions:** front headlock (turtle or sprawl) — the D'Arce
  grip but the attacker *steps the far leg over* the opponent's back and
  drops to the hip on the *opposite* side from the D'Arce, cranking the
  head down.
* **Setup/Entry:** D'Arce grip (arm threads under the near arm, hand to
  own biceps), step over, sit.
* **Secure:** leg across the back, hips down, opponent's head forced toward
  their own chest.
* **Finish:** pull the head down while driving the hip — choke + crank.
  **Lock→tap 4–10 s**.
* **Defences:** as D'Arce plus "sit through" toward the attacker's legs.
* **Chains:** ↔ D'Arce ↔ anaconda ↔ Peruvian.
* **Frequency:** ESTIMATE 1–3 UFC. Stage P: S1 0.40, S2 0.40, S3 0.60 → 0.10.

---

### 2.20 Bulldog choke

* **Required positions:** the attacker has a *headlock* (side headlock)
  with the opponent's head on the attacker's hip, usually in a scramble or
  when the opponent turtles and the attacker is *beside* them.
* **Setup:** head in the armpit, forearm across the throat, hand clasp.
* **Entry/Secure:** drop to the hip, pull the head, turn the opponent's
  face up with the hip.
* **Finish:** pull and squeeze; **Lock→tap 6–15 s**; mostly air choke with
  crank — the defender can often endure to the round end.
* **Defences:** turn in, pull the head out backwards, take the back of the
  attacker (the headlock is a poor position; a trained grappler takes the
  back off it).
* **Escapes:** head out → back take on the attacker (40 %), neutral (60 %).
* **Chains:** inbound from a scramble/turtle; outbound → **scarf-hold
  (kesa gatame)** positions.
* **Frequency:** ESTIMATE 2–4 UFC. Stage P: S1 0.35, S2 0.40, S3 0.45 →
  0.06. Heavily skill-gap dependent (works mostly on beginners).

---

### 2.21 Twister (guillotine-of-the-spine / wrestler's guillotine)

* **Required positions:** back control with *one* hook in (the "truck"/
  twister side control), opponent's near leg triangled by the attacker's
  legs, head controlled by the attacker's arm.
* **Setup:** lockdown on the near leg, far arm controlled, head pulled
  toward the opposite shoulder (Eddie Bravo 10th Planet).
* **Entry:** from back control when the hook is "half in"; trap the leg.
* **Secure:** hand behind the head (or full nelson), chest on the shoulder.
* **Finish:** rotate the spine — pull the head toward the trapped leg.
  **Lock→tap 1–5 s**; injury if no tap = cervical/thoracic spine strain
  (treat as high-severity).
* **Defences:** S1 keep the free leg from being triangled (tuck the knee);
  S2 turn the head *toward* the attacker (deny the rotation), clear the
  arm; S3 roll with it/tap.
* **Escapes:** clear the leg → attacker retains back (60 %), scramble to
  top (40 %).
* **Chains:** back control (one hook) ↔ twister ↔ **truck** → calf slicer
  (the leg is already in the truck) → RNC when both hooks come in.
* **Frequency:** 2 UFC (Jung 2011, Mitchell 2019) — hard [Wikipedia fight
  records]. Stage P: S1 0.30, S2 0.40, S3 0.75 → 0.09.

---

### 2.22 Neck cranks / can opener / spine locks

* **Required positions:** cranks are available from *many* positions:
  can opener from inside closed guard (top pulls the head), cattle-catch/
  crucifix cranks, "the twister" (above), rear neck crank from the back
  when the RNC is defended (arm over the face), face-crank from mount.
* **Setup/Entry/Secure:** typically "a choke that went wrong" — the arm
  ends on the chin/jaw rather than the neck.
* **Finish:** cervical flexion/rotation. **Lock→tap 2–10 s**; pain-driven —
  elite fighters *do not tap to cranks* and endure; beginners tap quickly.
  Injury if no tap: cervical strain; catastrophic injury is rare but
  non-zero (treat as medium severity, cumulative).
* **Defences:** posture (can opener: open the guard and put the hands on
  the mat), turn the chin into the elbow, tuck.
* **Escapes:** guard opens (can opener is a *pass* tool), back is escaped
  by turning in.
* **Chains:** RNC → neck crank → RNC (hand fighting loop); can opener →
  guard pass; crucifix → crank ↔ shoulder lock ↔ RNC.
* **Frequency:** ESTIMATE 15–20 UFC (~1 %). Stage P: S1 0.50, S2 0.50,
  S3 0.35 (vs Advanced) / 0.80 (vs Novice) → 0.09 / 0.20.

---

### 2.23 Gogoplata (rare)

* **Required positions:** rubber guard (mission control) or from the
  omoplata position; the attacker's shin across the opponent's throat, the
  foot pulled by the hands. Also from mount ("mounted gogoplata").
* **Setup:** posture broken, extreme hip flexibility, opponent's head
  below the attacker's chest.
* **Entry:** foot to the throat via the rubber guard; **Secure:** hands
  pull the foot/head; **Finish:** pull the head down onto the shin.
  **Lock→tap 4–10 s**.
* **Defences:** posture (rubber guard is beaten by posture and strikes),
  pull the head back, push the shin off.
* **Escapes:** posture → back in guard.
* **Chains:** omoplata ↔ gogoplata ↔ triangle; mount → mounted gogoplata.
* **Frequency:** 0 UFC (Diaz–Gomi PRIDE 2007 [overturned]; Aoki–Hansen
  Shooto 2006; Brad Imes UFC? — ESTIMATE ≤ 1 in UFC). Stage P: S1 0.25,
  S2 0.35, S3 0.50 → 0.04; FLX gate: attacker FLX ≥ 80/100.

---

### 2.24 Calf slicer (calf crush)

* **Required positions:** the "truck" (twister side control), from the back
  when the opponent turtles with a leg bent, from top half guard when the
  bottom fighter's knee is bent, from a failed heel hook (411).
* **Setup:** opponent's leg bent with the attacker's shin/forearm behind
  the knee.
* **Entry/Secure:** figure-four the leg (attacker's legs), grab the
  foot/ankle; **Finish:** pull the ankle toward the buttock. **Lock→tap
  2–6 s** — very painful (compression), injury if no tap = calf muscle,
  knee capsule.
* **Defences:** straighten the leg early; turn toward the attacker.
* **Escapes:** leg freed → back control retained by the attacker (70 %).
* **Chains:** truck ↔ twister ↔ calf slicer; 411 → calf slicer.
* **Frequency:** ESTIMATE 1–2 UFC (Oliveira–Elkins 2013 first). Stage P:
  S1 0.35, S2 0.45, S3 0.65 → 0.10.

---

### 2.25 Shoulder lock / cranks from the crucifix

* **Required positions:** crucifix (opponent turtled or on their back, one
  arm trapped between the attacker's legs, the other by the attacker's
  arm). Reached from turtle (the "crucifix from the back") or from side
  control when the opponent's arm is trapped.
* **Setup/Entry:** leg-trap one arm while breaking the opponent down.
* **Secure:** both arms trapped; the crucifix is more famous in MMA for
  **unanswered strikes** (TKO route: Matt Hughes on Ricardo Almeida,
  Bellator/UFC examples) than for the submission.
* **Finish:** arm crank via the legs (straight arm lock), neck crank, or
  RNC with one arm; **Lock→tap 2–6 s**.
* **Defences:** never let the arm get between the legs from turtle; roll
  to the trapped-arm side; bridge to the attacker's legs.
* **Escapes:** roll → scramble (40 %); attacker keeps crucifix (60 %).
* **Chains:** turtle → crucifix → RNC (one-arm) / neck crank / TKO by
  strikes; crucifix ↔ back control.
* **Frequency:** submission finishes ESTIMATE 3–6 UFC; TKO from crucifix far
  more common. Stage P (submission): S1 0.35, S2 0.45, S3 0.55 → 0.09;
  strikes-TKO from crucifix: see the GnP research doc.

---

### 2.26 Standing guillotine

* **Required positions:** clinch with the opponent's head down (after a
  sprawl, a snap-down, a level change, or when the opponent ducks).
* **Setup:** chin strap while standing; the attacker either finishes
  *standing* (rare; "power guillotine" with the hips forward) or *jumps
  guard* (common) or falls to the hip.
* **Finish:** standing: pull up and arch, **Lock→tap 3–8 s** (Cody
  McKenzie style); if the opponent lifts, the attacker must jump guard.
* **Defences:** posture, push the hips into the attacker and lift/slam,
  walk the opponent into the fence, drive the head to the far side.
* **Escapes:** posture → clinch (60 %), lift-and-dump → top (40 %, high
  slam damage).
* **Chains:** → guard guillotine, → mounted guillotine (after a dump where
  the attacker keeps the grip), → sprawl D'Arce/anaconda if the attacker
  is on top.
* **Frequency:** ESTIMATE 10–20 UFC logged under "guillotine". Stage P:
  S1 0.50, S2 0.35, S3 0.45 → 0.08 (standing finish); jump-to-guard path
  then uses §2.2.

---

### 2.27 Flying triangle / flying armbar (rare)

* **Required positions:** standing, opponent bent slightly with an arm
  extended (a collar tie or wrist grip), attacker jumps.
* **Setup:** wrist/collar control, the opponent stationary.
* **Entry:** jump, leg over the shoulder (triangle) or over the face
  (armbar); **Secure:** land in the lock or in guard; **Finish:** as §2.6/
  §2.7.
* **Defences:** step back; if caught, slam (the flying attacker is in the
  air — slams are the norm) or drop to the knees to stack.
* **Escapes:** attacker lands in guard (60 %), slammed → bottom + damage
  (25 %), lock finishes (15 %).
* **Frequency:** ESTIMATE ≤ 5 UFC. Stage P: S1 0.30, S2 0.35, S3 0.55 →
  0.06; slam risk on failure 0.40 with damage.

---

### 2.28 Mounted triangle / mounted guillotine — cross-reference

Covered in §2.6 (mounted triangle) and §2.2 (mounted guillotine). Both are
*positional* submissions: the attacker does not lose position on failure
(retains mount/side control ~75 %), which is why their attempt→finish is
higher than the guard versions.

### 2.29 Suloev stretch (for completeness)

From back control: the attacker grabs the opponent's ankle and pulls it up
toward the shoulder, hyper-extending the hamstring/hip. Rare (Zabit vs
Davis 2018, UFC). Stage P: S1 0.25, S2 0.40, S3 0.60 → 0.06; chains from
back control and into back control.

### 2.30 Banana split / electric chair / other rare positions

From the truck or lockdown; groin/hip stretch. ESTIMATE 0–2 UFC. Stage P:
0.25 × 0.40 × 0.55 → 0.06.

---

## 3. Chain graph

Node types: **POSITION** (uppercase) and **SUBMISSION** (Title Case). An
edge `A → B (trigger)` fires when the current stage of A fails *for that
reason*, or when A succeeds positionally. Probabilities (ESTIMATE) are the
share of *failures* of the source that route to the target when the
attacker is Advanced-tier; the remainder route back to the origin position
or to a neutral scramble.

```
BACK_CONTROL  → Rear-Naked Choke      (always available)
Rear-Naked Choke  → Armbar (from back)      (hands defended, arm high)        0.20
Rear-Naked Choke  → Rear Triangle           (arm trapped)                      0.10
Rear-Naked Choke  → Neck Crank              (arm on the jaw)                   0.15
Rear-Naked Choke  → Body-triangle + strikes (TKO path)                         0.25
Rear-Naked Choke  → MOUNT                    (defender turns in and stops)     0.15
Rear-Naked Choke  → GUARD/HALF (escape)      (hook cleared, turn-in)           0.15
Armbar (from back) → Rear-Naked Choke        (defender turns back)             0.50
Armbar (from back) → HALF_GUARD_TOP (defender) (escape)                        0.50

FRONT_HEADLOCK → Guillotine | D'Arce | Anaconda | Peruvian | Japanese Necktie
Guillotine → D'Arce           (arm-in, opponent's arm on the same side)        0.20
Guillotine → Anaconda         (opponent's head slides out under the arm)       0.10
Guillotine → Mounted Guillotine (sweep to top)                                 0.10
Guillotine → Back Take         (opponent turns / attacker go-behind)           0.15
Guillotine → Triangle          (from guard, head pops out with the arm in)     0.10
Guillotine (defended by pass) → Von Flue (DEFENDER's attack)                   0.15
Guillotine → Standing: opponent lifts → slam (damage) or Standing Guillotine
D'Arce ↔ Anaconda                                                              0.30 each way
D'Arce → Arm-Triangle           (attacker ends on top with arm trapped)        0.20
D'Arce → Back Take              (opponent turns away)                          0.20
D'Arce → Peruvian/Japanese Necktie (opponent stays turtled)                    0.10
Anaconda → Arm-Triangle (after roll)                                           0.20

MOUNT → Arm-Triangle | Americana | Armbar (mount) | Mounted Triangle | Mounted Guillotine | Ezekiel
Arm-Triangle → Americana/Kimura (arm across, dismount fails)                   0.20
Arm-Triangle → Mounted Triangle                                                 0.10
Arm-Triangle → Back Take (defender turns away)                                 0.15
Arm-Triangle → MOUNT retained                                                   0.45
Americana ↔ Kimura                                                              0.30
Americana → Armbar (mount) (defender straightens)                              0.25
Armbar (mount) → Mounted Triangle                                               0.20
Armbar (mount) → Back Take                                                      0.10
Armbar (mount) → GUARD_TOP_FOR_DEFENDER (positional loss)                       0.35
Mounted Triangle → Armbar                                                       0.35
Mounted Triangle → SIDE_CONTROL retained                                        0.45

CLOSED_GUARD (bottom) → Armbar | Triangle | Kimura | Omoplata | Guillotine | Gogoplata
Triangle → Armbar                                                               0.30
Triangle → Omoplata                                                              0.15
Triangle → Sweep to Mounted Triangle                                            0.10
Triangle → Gogoplata (FLX gate)                                                 0.03
Triangle (defended by slam) → damage event, attacker keeps guard 0.5 / loses 0.5
Armbar (guard) → Triangle                                                        0.30
Armbar (guard) → Omoplata                                                        0.10
Armbar (guard) → Back Take (spin under)                                          0.15
Armbar (guard) → CLOSED_GUARD retained                                           0.45
Omoplata → Sweep (TOP)                                                            0.45
Omoplata → Triangle                                                               0.15
Omoplata → Armbar / Kimura                                                        0.10
Omoplata → Back Take                                                              0.10
Kimura (guard/half) → Sweep (TOP)                                                0.35
Kimura (guard/half) → Back Take (kimura trap)                                    0.20
Kimura → Armbar (straight arm)                                                    0.10
Kimura → Guillotine (standing whizzer, head drops)                                0.10
Kimura (side/N-S top) ↔ North-South Choke                                         0.20
Kimura (side top) → Arm-Triangle                                                  0.15

TURTLE (top) → Front headlock family | Back Take | Crucifix | Rolling Toe Hold | Bulldog
Crucifix → RNC (one-arm) | Neck Crank | Shoulder Lock | TKO strikes
BACK_CONTROL (one hook) ↔ Twister ↔ Truck → Calf Slicer | Banana Split
BACK_CONTROL → Suloev Stretch                                                    (rare)

LEG_ENTANGLEMENT (ashi / 411 / 50-50) → Heel Hook | Kneebar | Ankle Lock | Toe Hold | Calf Slicer
Heel Hook ↔ Kneebar                                                              0.20
Heel Hook ↔ Toe Hold                                                             0.15
Heel Hook → Ankle Lock                                                            0.15
Heel Hook (411) → Calf Slicer                                                      0.05
Heel Hook (411/50-50) → Sweep / Back Take                                          0.15
Heel Hook (50-50) → Counter Heel Hook by DEFENDER                                  0.10
Ankle Lock → Heel Hook                                                              0.20
Ankle Lock → Single-leg X sweep                                                     0.30
Guard-pass attempt (step-over) → LEG_ENTANGLEMENT for the bottom fighter            (trigger)

STANDING → Standing Guillotine | Flying Triangle/Armbar | Standing Kimura | Standing RNC (rare)
Standing Guillotine → Guard Guillotine (jump guard)                                0.50
Standing Guillotine → lifted-and-dumped (damage; bottom)                           0.25
Flying Triangle/Armbar → CLOSED_GUARD (attacker lands in guard)                     0.60
Flying Triangle/Armbar → slammed (damage)                                            0.25
```

Damage-driven inbound edges (from the striking/GnP model): **rocked or
turtled after strikes → BACK_CONTROL** (p ≈ 0.5 per "turn-away" event),
**framing under mount GnP → arm across → Arm-Triangle/Americana** (p ≈ 0.3
per frame event), **sprawl on a desperate shot → FRONT_HEADLOCK** (p ≈ 0.6),
**standing hurt with head down → Standing Guillotine** (p ≈ 0.2).

---

## 4. Skill-tier behaviours

Grappling skill 0–100 ("SUB" attack / "SUBDEF" defence attributes).

| Tier | SUBDEF | Behaviour | Modelling |
|---|---|---|---|
| **Untrained** (0–19) | doesn't recognise danger; taps late or *does not know to tap* | goes unconscious in chokes (p 0.5), gets injured in joint locks (p 0.3 → injury event rather than tap), taps to pain from cranks/pressure, gives the back under any pressure | S1/S2 defence rolls at 0.10× base; time-to-tap +50 %; `no_tap` flag: 40 % chance of injury/unconscious instead of tap |
| **Novice** (20–39) | knows the *name* of the defence but applies it late (at S3) | defends only once the lock is on; taps to Americanas, can openers, neck cranks, "shoulder chokes"; leaves arms extended; steps over guards into leg locks | defence multiplier 0.4× at S1, 0.6× at S2, 1.0× at S3 (but S3 base is low) |
| **Intermediate** (40–59) | defends at S2; escapes locked subs rarely | good hand-fighting on RNC, answers the phone vs guillotine/triangle; still gives arm-triangle under GnP; rarely taps to cranks | defence 0.8× at S1, 1.0× at S2 & S3 |
| **Advanced / UFC roster** (60–79) — the *baseline* for every P in §2 | defends at S1; positional escapes; only submitted when hurt, exhausted, or by a specialist | 1.0× everywhere |
| **Elite** (80–100) | prevents S0 (never gives the position); early hand-fighting; will endure cranks and even partial chokes to the bell; can be *un-submittable* without damage/fatigue | defence 1.4× at S1, 1.25× at S2, 1.1× at S3; needs DMG/FAT or SG ≥ 20 to be finished with any regularity |

Real-world anchors for the tiers:

* UFC 1993–1997 (Untrained/Novice grapplers vs BJJ black belts) — ESTIMATE
  35–45 % of fights ended by submission, vs 17 % modern [G1][P1]. That is
  roughly a **2.2–2.6× multiplier** for extreme skill gaps.
* Modern champions who were never submitted across long careers (GSP, Jon
  Jones, Khabib, Volkanovski, Usman) vs those submitted repeatedly early in
  their careers illustrate the Elite tier's "S0 denial".
* 11 % of UFC chokes end in unconsciousness [P2] — mostly fighters who
  refused to tap (Elite pride) or Untrained-type late recognition; model as
  a per-fighter `stubbornness` trait 0–1 (default 0.11).
* Elite BJJ specialists in MMA (Oliveira, Maia, Nurmagomedov) convert
  ~30 % of recorded attempts [A1] vs a roster-wide ESTIMATE 17–22 %.

---

## 5. Sim rules to implement

Probabilities are per stated window; `base` = the §2 table value (Advanced
vs Advanced). All modifiers multiply the *attacker's* P(advance) unless
stated; clamp final P to [0.01, 0.97].

1. **Availability.** A submission is *available* only when its `required
   position` and `setup requirements` (from §2) are satisfied; check each
   tick. Setup requirements are position flags plus at least one *trigger
   event* (strikes landed, sweep, sprawl, arm crossing, step-over).
2. **Attempt decision.** When available, the attacker attempts with
   `p_attempt = 0.15 + 0.35·SUB/100`, scaled ×2.0 if the fighter's style is
   "submission hunter", ×0.5 if "wrestler/GnP", ×1.5 if opponent is rocked,
   ×0.5 if attacker is at FAT > 70 % (except RNC/arm-triangle which stay
   ×1.0).
3. **Attempt counter.** Register a UFCStats-style "submission attempt" only
   when S1 succeeds (the hold is applied) — this matches the FightMetric
   definition [A1]. Target: median 0.6 attempts / 15 min per fighter [C1];
   specialists 2.0–2.6.
4. **Four-stage resolution.** For each stage roll `P = base × M_skill ×
   M_attr × M_state`. On failure at stage k: roll the chain table (§3) for
   that submission; if no chain fires, return to origin position (or to
   the escape end-position listed in §2 with the given shares).
5. **Skill-gap multiplier.** `M_skill = 1.0 + 0.020·(SUB_att − SUBDEF_def)`
   for the attacker at S1/S2 (i.e., a 20-point gap ≈ ×1.4; a 50-point gap
   ≈ ×2.0 — matching the early-UFC 2.2–2.6× effect at 60–70-point gaps
   once S3 is included). At S3 use half the coefficient (0.010) because
   locked-in finishes are mostly mechanical.
6. **Tier multipliers.** Apply the defender-tier multipliers from §4 to the
   *defender's* effective SUBDEF before rule 5 (or equivalently divide P).
7. **Time-to-tap.** Once S3 succeeds, draw `t_tap` uniformly from the
   technique's lock→tap range (§2). Blood chokes: if the defender's
   `stubbornness` roll succeeds (default p 0.11 [P2]) the fighter does not
   tap and goes unconscious at `t_out ~ Normal(9 s, 2 s)` clamped [5, 13]
   [P2][W1]; referee stops on unconsciousness (+1–2 s). Joint locks: if
   the defender does not tap (Untrained `no_tap`, or `stubbornness` ×
   0.5), an **injury event** fires at `t_tap + 1 s` with severity: heel
   hook/kneebar/twister = high, armbar/kimura = high, americana/toe hold/
   ankle = medium, cranks = medium-cumulative; the bout ends by TKO
   (injury) or the fighter continues with a `disabled_limb` flag if the
   lock is released (p 0.3).
8. **Air-vs-blood chokes.** Standard guillotine, bulldog, Ezekiel: the
   defender may *endure*: per second in S3, P(escape) = 0.06 (Advanced) /
   0.10 (Elite) / 0.02 (Novice); blood chokes (RNC, high-elbow, D'Arce,
   anaconda, arm-triangle, triangle, N-S, von Flue): P(escape/s) = 0.02 /
   0.04 / 0.005.
9. **Round-end save.** A submission in S3 with `t_tap` extending past the
   round-end saves the defender; a submission in S2 at the bell is
   released. (UFC: no finishes after the bell; ESTIMATE ~3 % of locked
   subs are saved by the bell.)
10. **Sweat / slipperiness.** `SLIP` state rises with round number and
    body-lock time (round 1: 0.2, round 2: 0.5, round 3+: 0.8; blood adds
    +0.1). Multiply S2/S3 by `(1 − 0.30·SLIP)` for guillotine (all
    variants), D'Arce, anaconda, arm-triangle, north-south, Ezekiel,
    heel-hook heel grip, kimura wrist grip; `(1 − 0.10·SLIP)` for RNC,
    triangle, armbar; no effect on kneebar/ankle lock/cranks. (Direction is
    coaching consensus; magnitudes ESTIMATE.)
11. **Fatigue.** Attacker FAT (0–1) multiplies S2/S3 by `(1 − 0.4·FAT)` for
    grip-heavy attacks (guillotine family, kimura, D'Arce/anaconda, ankle
    lock) and `(1 − 0.15·FAT)` for others. Defender FAT multiplies the
    *defender's* S1/S2 defence by `(1 − 0.5·FAT)` — tired fighters give up
    the back and stop hand-fighting (this is the largest single driver of
    late-round RNCs — ESTIMATE, consistent with 2015–2025 data where subs are
    ~27 % of round-3+ finishes).
12. **Damage / rocked.** If the defender is `rocked` or has ≥ 60 % head
    damage: all attacker stage rolls ×1.6; the defender's tier is treated
    one level lower; probability of *giving the back* on a GnP event = 0.5.
13. **Strength.** STR difference (attacker − defender, −50..+50) multiplies
    S3 by `1 + 0.008·ΔSTR` for squeeze/rotation finishes (RNC, arm-triangle,
    guillotine, kimura, americana, ankle lock, cranks) and S2 defence by
    the same for the defender on armbar grip breaks, triangle stacks/slams
    and heel-hook leg clears.
14. **Flexibility.** Attacker FLX (0–100) gates: gogoplata requires ≥ 80;
    rubber-guard entries require ≥ 70; triangle S2 ×`(0.8 + 0.4·FLX/100)`;
    omoplata S1 ×`(0.7 + 0.6·FLX/100)`. Defender FLX multiplies *their*
    S3 escape on kimura/americana/omoplata by `(1 + 0.5·FLX/100)` and
    delays joint-lock injury by +1 s.
15. **Limb length.** `LEN` = (attacker limb length − defender torso/neck
    girth proxy). Triangle & D'Arce & arm-triangle S2 ×`(1 + 0.01·LEN)`;
    guillotine on thick-necked HWs S3 ×0.85.
16. **Gloves / grip.** MMA gloves: RNC uses palm-to-palm 50 % of the time
    (S3 ×0.9 vs figure-four); kimura & toe-hold grips ×0.9; Ezekiel from
    bottom is *enabled only in MMA* (gloves) — allow it with base 0.04.
17. **Weight class.** Do **not** scale submission *finish* rates by weight
    class directly — the data show a flat 15–22 % of fights [G1]. Instead
    the KO model's weight scaling naturally shifts the *share* of finishes.
    Apply only: HW/LHW SLIP +0.1 (bigger, sweatier), HW guillotine/N-S S3
    ×0.85 (neck girth), flyweight/bantam triangle & armbar S1 ×1.1 (limb
    ratios), women's divisions attempt rate ×1.15 (subs are 54–59 % of
    their finishes [G1]).
18. **Positional cost of failure.** After a failed attempt, apply the
    end-position shares from §2. Highest-risk (attacker loses top
    position): armbar from mount (0.35), rolling kneebar from top half
    guard (0.50), omoplata/triangle from guard while being stacked (0.25),
    flying attacks (0.65 land in guard, 0.25 slammed).
19. **Slam.** When a defender is standing/kneeling with the attacker in
    triangle/armbar/guillotine-from-guard and has STR ≥ 60 and the attacker
    is off the mat: P(slam attempt) = 0.15/s (Advanced), 0.30 (wrestler
    style). Slam resolves as a strike with damage `8–25` head-damage units
    (ESTIMATE); on slam the lock breaks with p 0.7 (triangle), 0.8
    (armbar), 0.5 (guillotine).
20. **Von Flue counter.** When a guillotine attacker retains the grip after
    the defender passes to the choking side, the defender (now on top) may
    attack von Flue with S2 0.60/S3 0.65; the bottom fighter releases with
    p = 0.8 if Advanced+, 0.4 if Intermediate, 0.1 if Novice (they don't
    know) — this is the classic "beginner tap".
21. **Heel-hook mutual exposure.** In 50/50 both fighters roll S1–S3 each
    tick; the first to S3 wins; each tick in the entanglement the *top*
    fighter may strike (GnP) with a 0.2 chance per tick of forcing the
    bottom fighter to release (MMA-specific leg-lock suppression).
22. **Chain resolution.** On any stage failure, sample one chain edge from
    §3 with the listed probabilities; a chain target starts at its **S1**
    (entry) with a ×1.2 bonus (the opponent is already reacting). Cap at 3
    chain hops per 15-s window to avoid infinite loops; after the cap,
    return to position.
23. **Elite "S0 denial".** Elite defenders (SUBDEF ≥ 80) reduce the
    *availability* trigger rate by 40 % (they don't give the position) and
    cannot be finished by cranks/pain subs (bulldog, can opener, ankle lock,
    neck crank) unless DMG ≥ 50 % or FAT ≥ 0.8.
24. **Untrained "no-tap".** For SUBDEF < 20: P(does not know to tap) = 0.4;
    resolve per rule 7. Also they tap to *non-submissions* (pressure,
    body-triangle crush, shoulder pressure) with p 0.05/s while mounted or
    back-controlled by an Advanced+ attacker.
25. **Conversion sanity targets** (tune to these):
    * Roster-wide attempt→finish 17–22 % (ESTIMATE, §6.4); RNC 30–40 %;
      guillotine 10–15 %; armbar 15–20 %; triangle 10–15 %; arm-triangle
      20–30 %; kimura 8–12 %; D'Arce/anaconda 14–18 %; heel hook 10–20 %.
    * Share of subs by technique to reproduce §1.2 within ±3 points for
      the top 5.
    * 17 % ± 2 of bouts end by submission for an Advanced-vs-Advanced
      roster; 35–45 % for Elite-vs-Novice cards.
    * 11 % of choke finishes end in unconsciousness rather than a tap.
    * ~27 % of all finishes (KO+sub) occur in round 1 for subs as for KOs
      [G1 gives 27.3 % of all fights ending in R1]; subs should not be
      front-loaded more than KOs — ESTIMATE ~45 % R1 / 30 % R2 / 25 % R3+
      of submission finishes.
26. **Logging.** Record `technique`, `variant`, `stage_reached`, `time_in_stage`,
    `chain_path`, `outcome` (tap / unconscious / injury / escape /
    round_end / abandoned), and `end_position` so the tuning script can
    compute conversion by technique and by tier.

---

## 6. Data tables with sources

### 6.1 Sources

| Key | Source | URL |
|---|---|---|
| [G1] | GrapplerHQ, "UFC Statistics: Finish Rates & Fight Trends, 1994–2026 (8,591 bouts)", UFCStats-derived | https://www.grapplerhq.com/mma/ufc-statistics/ |
| [P1] | Fares MY et al., "Exploring submission finishes in the UFC: a comprehensive analysis", *J Sports Med Phys Fitness* 2025; DOI 10.23736/S0022-4707.25.16585-7; PMID 40100224 | https://pubmed.ncbi.nlm.nih.gov/40100224/ |
| [P2] | Stellpflug SJ et al., "Analysis of the fight-ending chokes in the history of the UFC", 2020; PMID 33347362; summarised by Combat Sports Law | https://combatsportslaw.com/2020/12/26/physician-reviews-and-analyzes-all-choke-submissions-in-ufc-history/ |
| [P3] | Scoggin JF et al., "Assessment of injuries during Brazilian jiu-jitsu competition", *Orthop J Sports Med* 2014;2(2) — elbow via armbar the most common competition injury | https://journals.sagepub.com/doi/10.1177/2325967114522184 |
| [W1] | Wikipedia, "Chokehold" — mean ≈ 9 s to unconsciousness; air vs blood chokes | https://en.wikipedia.org/wiki/Chokehold |
| [W2] | Wikipedia, "Leglock" — heel hook mechanics/injury, kneebar, ankle lock, toe hold, calf slicer, Suloev stretch | https://en.wikipedia.org/wiki/Leglock |
| [M1] | MMAHive, "UFC Submission Statistics: Year Averages & Top Records" | https://www.mmahive.com/ufc-submission-statistics/ |
| [A1] | AgentMMA, "What counts as a UFC submission attempt? (FightMetric definition; Oliveira 51 att/17 wins; Miller 52/14)" | https://agentmma.com/mma-lab/ufc-submission-attempts-explained |
| [C1] | CageQuant, "How to read UFC fighter stats" — median Sub Avg 0.6; Oliveira 2.6 | https://www.cagequant.com/learn/ufc-fighter-stats-explained |
| [F1] | FightEncyclopedia, "Top 10 most effective submissions by success rate" (UFC Stats 2024 shares; ADCC 2022 heel hook ≈ 31 %; guillotine ≈ 9.5 % per attempt) | https://fightencyclopedia.com/blog/blog-top-10-most-effective-submissions-by-success-rate |
| [N1] | Nate Latshaw (UFCStats scrape, 2024): top-5 subs ≈ 82 %, 24+ other types ≈ 18 % | https://x.com/NateLatshaw/status/1809211879908356552 |
| [FM1] | Fight Matrix, "How fights actually end: finish rates by weight class" (2026) | https://www.fightmatrix.com/2026/07/31/how-fights-actually-end-finish-rates-by-weight-class/ |
| [FO1] | Fightomic, "UFC finish rates by weight class" (FLW sub 22.0 %, BW 19.5 %, HW 14.4 %) | https://fightomic.com/ufc-finish-rates-by-weight-class/ |
| [E1] | ESPN (2018), "How MMA fights end: submission victories way down" | https://africa.espn.com/mma/story/_/id/22277062/how-mma-fights-end-submission-victories-way-down |
| [S1] | Sportslyx UFC statistics (female 21.1 % vs male 17.3 % sub rate) | https://www.sportslyx.com/stats/ufc |
| [EV1] | Evolve MMA, "The most common submissions in MMA" | https://evolve-mma.com/blog/the-most-common-submissions-in-mma/ |
| [D1] | Danaher / BJJ Fanatics back-attack and front-headlock systems (coaching consensus; instructional catalogue) | https://bjjfanatics.com/ |
| [D2] | Danaher, "Enter the System: Leg Locks" (knee-line control precedes the heel) | https://bjjfanatics.com/ |
| [K1] | Grapplearts (Stephan Kesting) — RNC escape to the choking-arm side, guillotine defence | https://www.grapplearts.com/ |
| [L1] | Lachlan Giles / Submeta — heel hook defence: hide the heel, clear the knee line | https://submeta.io/ |
| [CJ1] | Craig Jones — leg entanglement systems (coaching consensus) | https://bjjfanatics.com/ |
| [JS1] | Jack Slack — MMA grappling analyses (guillotine-from-sprawl, why leg locks are rare in MMA) | https://jackslack.substack.com/ |
| [RH1] | Ryan Hall — Imanari roll / 50-50 heel hooks in MMA (interviews, TUF 22) | https://en.wikipedia.org/wiki/Ryan_Hall_(fighter) |

(D1, D2, K1, L1, CJ1, JS1 are catalogue/home URLs; the session's search
budget was exhausted before individual article URLs could be re-verified.
Claims attributed to them are standard, widely published coaching positions.)

### 6.2 Technique shares — comparison of sources

| Technique | GrapplerHQ 2026 [G1] | Stellpflug chokes-only 2020 [P2] (share of chokes) | Fares PPV 1993-2023 [P1] | MMAHive 2017 [M1] | FightEncyclopedia 2024 [F1] |
|---|---|---|---|---|---|
| RNC | 39.1 % | 49.1 % | 32.7 % | 43.8 % | ~37 % |
| Guillotine | 17.7 % | 13.7 % + 9.7 % arm-in | — | 13.7 % | ~13 % |
| Armbar | 11.8 % | n/a | — | 12.5 % | ~14 % |
| Arm-triangle | 7.6 % | 8.2 % | — | 6.3 % | — |
| Triangle | 6.9 % | 8.8 % | — | — | ~7 % |
| D'Arce | 2.8 % | <3 % | — | 3.7 % (w/ anaconda, von Flue) | ~3 % |
| Kimura | 2.6 % | n/a | — | — | ~8 % (outlier) |
| Anaconda | 2.3 % | <3 % | — | (pooled) | — |
| Heel hook | (in "other") | n/a | — | — | ~4 % (likely too high) |
| Ankle lock | (in "other") | n/a | — | — | ~2 % |

Use [G1] as canonical; the choke-only [P2] shares convert to all-sub shares
by ×0.762.

### 6.3 Choke physiology & injury data

| Item | Value | Source |
|---|---|---|
| Time to LOC, bilateral carotid compression | ≈ 9 s mean; ≈ 5–13 s range (judo/VNR literature summarised) | [P2][W1] |
| Recovery after release | seconds to ~20 s, usually full within a minute (coaching/judo *kappo* literature) | [W1] |
| UFC chokes ending in unconsciousness | 11 % (99 of 904) | [P2] |
| Chokes as share of UFC fight outcomes | 15.5 % | [P2] |
| Handedness of finishing chokes | 50.1 % R / 49.9 % L | [P2] |
| Air choke vs blood choke | air chokes slower, more painful, more injurious (trachea) | [W1] |
| BJJ competition injuries | elbow (armbar) the most common orthopaedic injury; overall ≈ 9.2 injuries / 1,000 exposures | [P3] |
| Heel hook | "high rate of injury, especially to ligaments in the knee"; minimal pain warning | [W2] |
| Kimura no-tap | humeral fracture (Mir–Nogueira, UFC 140, 2011) | public record |
| Armbar no-tap | forearm fracture (Mir–Sylvia, UFC 48, 2004) | public record |

### 6.4 Attempt/conversion derivation (ESTIMATE)

* Median Sub Avg = 0.6 / 15 min per fighter [C1]; mean is higher (skewed) —
  assume mean ≈ 0.8. Mean fight length 10:37 [G1]. Attempts per fight (both
  fighters) ≈ 2 × 0.8 × (10.6 / 15) ≈ 1.1 → ≈ 9,500 attempts over 8,591
  fights → 1,659 / 9,500 ≈ **17.5 %** roster-wide conversion. Elite finishers
  27–33 % [A1]. Range used in rules: 17–22 %.
* Per-technique conversions in rule 25 are ESTIMATES derived by combining
  finish shares [G1] with the observed attempt distribution (guillotines
  and armbars are attempted far more often than RNCs per finish — coaching
  consensus; FightEncyclopedia's ≈ 9.5 % guillotine figure [F1]).

### 6.5 Round of submission finishes

No clean per-round split for submissions was retrievable; [G1] gives
27.3 % of *all* fights ending in round 1 (all methods). ESTIMATE for
submissions: 45 % R1 / 30 % R2 / 25 % R3+ (RNCs skew later with fatigue;
guillotines skew earlier with fresh grips).

---

## 7. Assumptions and gaps

1. **Per-stage probabilities are estimates.** No public dataset records
   the stage at which submissions fail. All S1/S2/S3 numbers were set so
   that their products reproduce plausible attempt→finish conversions and,
   summed over the estimated attempt mix, the [G1] technique shares.
   They should be tuned in simulation (rule 25 targets).
2. **"Other" technique counts** (heel hook, kneebar, ankle lock, Ezekiel,
   von Flue, twister, etc.) are estimates within the [G1] "all other = 155"
   bucket, except twister (2) and calf slicer/Suloev (1–2) which are
   well-known single events.
3. **Search budget.** The session's web-search quota ran out mid-task, so
   several coaching sources are cited at catalogue level and some hoped-for
   numbers (per-round submission split, exact heel-hook count since 2019,
   a per-technique attempt log) could not be fetched. The physiology
   numbers rely on the Stellpflug review and Wikipedia's summary of the
   judo/vascular-neck-restraint literature rather than the primary papers
   (Rossen 1943; Koiwai 1987; Mitchell 2012) — the ≈ 9 s figure is
   consistent across those.
4. **Skill-gap multiplier** is anchored on the early-UFC vs modern
   submission-rate gap rather than on a controlled measure; the linear
   0.02/point coefficient is a modelling choice.
5. **Weight-class effects** are deliberately minimal because the data show
   the submission *rate* is flat; if the KO model does not already produce
   the KO gradient, the finish-share gradient in §1.3 will not appear.
6. **MMA-specific factors** (gloves, strikes from inside submissions,
   slams, cage walls) are modelled as multipliers and events, not
   mechanically; slam damage values are placeholders for the striking doc.
7. **Injury modelling** is abstract (severity tiers), per the brief; no
   attempt was made to model specific ligament pathology.
8. **Round-end saves and stalling** in air chokes/cranks assume the UFC
   rule set (no finishes after the bell, referee stops on unconsciousness).
9. Rare submissions (gogoplata, banana split, Suloev) are included for
   completeness with low priors; they mainly matter for flavour and for
   Untrained/Novice opponents.
