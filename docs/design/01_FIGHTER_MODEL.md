# 01 — Fighter Model

Status: design, binding for implementation. Conventions: `docs/design/00_CONVENTIONS.md` (tags, units, scales,
logit convention, naming). Replaces `src/engine/fighter.ts` (`AthleteProfile` / `deriveAttributes`, see
`docs/AUDIT.md §1.1`).

Source shorthand used in tags: `LIT_B` = `research/LIT_B_anthropometrics_predictors_expertise_tactics.md`,
`LIT_A` = `research/LIT_A_performance_biomech_physio_injury.md`, `FD` = `research/FIGHT_DATA.md`,
`DP` = `research/DAMAGE_PHYSIOLOGY.md`, `BOX` = `research/BOXING.md`, `MT` = `research/MUAY_THAI_KICKBOXING.md`,
`WR` = `research/WRESTLING.md`, `JU` = `research/JUDO.md`, `BJJ` = `research/BJJ_POSITIONS.md`,
`SUB` = `research/SUBMISSIONS.md`, `MIS` = `research/MMA_INTEGRATION_STRATEGY.md`, `RJ` = `research/RULES_JUDGING.md`,
`CONV` = `docs/design/00_CONVENTIONS.md`, `AUDIT` = `docs/AUDIT.md`.

---

## 1. Purpose and scope

This section owns **everything that is true about a fighter before the first tick**: body, physical attributes,
discipline experience and sub-skills, record, mental profile, style, appearance, the derived composites other
sections read, the skill-tier computation, and the **tier behaviour catalogue** (the machine-readable list of
what a fighter of tier Tn visibly does and cannot do). It also owns the archetype presets and the backward-
compatible conversion of the legacy `AthleteProfile`.

It does **not** own: per-tick state (damage pools, energy pools, positions — those live in the sections that
mutate them), technique tables, or the decision algorithm. It provides the *inputs* those sections read.

### 1.1 Interfaces (what other sections read from here)

Section numbers follow the files in `docs/design/` (02 Striking … 09 Architecture/Modes/Calibration); if the
index is renumbered the section *names* are authoritative.

| Consumer | Reads from this section |
|---|---|
| 02 Striking | `effectiveReachM`, `effectiveKickReachM`, `reachAdvCm`, `reachLeverage`, `powerIndex.*`, `handSpeedMs`, `kickSpeedMs`, `execTimeMult`, `telegraphMod`, boxing / muayThai / kickboxing / karate / taekwondo sub-skills and tiers, `anticipation.*`, style (preferred range, initiative, favourite techniques/combos), tier catalogue `beh.box.*`, `beh.mt.*`, `beh.gen.*` |
| 03 Grappling state graph (clinch, takedowns, ground positions) | wrestling / judo / sambo sub-skills and tiers, bjj positional sub-skills (`guard`, `passing`, `topControl`, `backControl`, `escapes`, `sweeps`, `wrestleUps`) and tier, `grapplingStrength`, `clinchPower`, `sprawlSpeedMult`, `tdDefenceBase`, `balance`, `explosiveness`, `reactionTimeMs`, tier catalogue `beh.wr.*`, `beh.ju.*`, `beh.bjj.*`, style takedown preferences and bottom/top priorities |
| 04 Submissions | `subAttack` (SUB), `subDefence` (SUBDEF), bjj `chokes` / `jointLocks` / `legLocks`, `flexibility`, `stubbornness`, tier catalogue `beh.sub.*`, style go-to submissions |
| 05 Damage, fatigue & consciousness | `chinEff`, `chinZ`, `kKOHistoryMult`, `neckMult`, `bodyToughnessThresholdMult`, `recoveryHalfLifeMult`, `energy.*` (PCr refill, lactate clearance, break refill, tier cost multiplier), `residualDehydration`, `experience`, `composureEff`, `heart` |
| 06 Rules, referee & judging | `sex`, `weightClass`, `record` / `winStreak` (reputation-bias input, `MIS §3.5`), foul rolls from `beh.mma.t0_rule_ignorance` and `beh.gen.turn_away` |
| 07 Strategy & AI | mental block, style block (incl. `gamePlanOverride`), `iqTier`, adaptation parameters, tier catalogue `beh.mma.*`, `beh.gen.*`, all discipline tiers, `paceAgeMult`, `stanceFamiliarity`, `experience` |
| 08 Presentation | `appearance`, rig proportions (§2.1.2), animation-set tags emitted by the tier catalogue (`anim.*`, §3.9), `stance`, `handedness` |
| 09 Architecture, modes & calibration (incl. fighter creator / generator, legacy corpus) | the whole schema, tier derivation, transfer matrix, generator priors, archetypes, legacy conversion, parameter registry (§5), calibration hooks (§6) |

### 1.2 Design principles (from the evidence)

1. **Anthropometrics modulate *how*, not *whether*.** Height/reach have no reliable bout-level win effect in MMA
   except at heavyweight `[S: LIT_B §2.4]`; reach changes which punch finishes `[S: LIT_B §2.5]` and landed output
   at distance `[S: LIT_B §2.3]`. So reach feeds range and technique selection (02, 07), not a win multiplier.
2. **Age is the one anthropometric that predicts winning, and it works through durability and pace**, not
   accuracy `[S: LIT_B §2.1, §2.4, §5.8]`. Age curves act on physical attributes and the chin; skill and IQ do
   not decay with age.
3. **Experts anticipate, novices react.** Expert vs non-expert: response accuracy 83.3 % vs 68.5 % (SMD 1.24);
   fewer fixations (SMD −2.04); choice-RT advantage exists but **simple RT does not differ** `[S: LIT_B §4.1, §4.2]`.
   Therefore `reactionTime` is a physical attribute that tiers do **not** scale; what tiers scale is the
   *read* (anticipation) probability, cue-pickup lead time, counter-on-read probability and feint susceptibility.
4. **Technique quality gates physical power.** Elite rear-hand force is 2× novice (4,800 vs 2,381 N) at similar
   body mass `[S: LIT_B §4.9]`; elite use a more efficient kinetic chain `[S: LIT_B §4.10]`. So `powerIndex` is
   strength × mass × explosiveness **gated** by the discipline sub-skill.
5. **Tier is per discipline.** A T4 boxer with T0 wrestling shows T0 wrestling tells the moment he is shot on.
   The catalogue (§3) keys each rule to the tier of the discipline the behaviour belongs to.

---

## 2. Model

### 2.1 Body

```ts
type Sex = 'male' | 'female';
type Stance = 'orthodox' | 'southpaw' | 'switch';
type Handedness = 'right' | 'left';
type WeightClassId =
  | 'wc.atomweight' | 'wc.strawweight' | 'wc.flyweight' | 'wc.bantamweight' | 'wc.featherweight'
  | 'wc.lightweight' | 'wc.super_lightweight' | 'wc.welterweight' | 'wc.super_welterweight'
  | 'wc.middleweight' | 'wc.super_middleweight' | 'wc.light_heavyweight' | 'wc.cruiserweight'
  | 'wc.heavyweight' | 'wc.super_heavyweight' | 'wc.open';

interface FighterBody {
  sex: Sex;                    // default 'male'
  heightM: number;             // stature, m
  reachM: number;              // wingspan fingertip-to-fingertip, m (UFC "reach" definition)
  legReachM: number;           // hip joint to heel, m (UFC "leg reach" definition)
  weighInKg: number;           // official weigh-in mass (weightLb = weighInKg / 0.45359237)
  fightNightKg: number;        // mass at first bell after regain
  weightClass: WeightClassId;  // derived from weighInKg unless the ruleset is open-weight
  ageYears: number;            // decimal years at fight date
  bodyFatPct: number;          // 4–40 [E] creator range
  build: { ecto: number; meso: number; endo: number }; // sum = 1
  stance: Stance;
  handedness: Handedness;
  dominantLeg: 'right' | 'left'; // default = handedness side
}
```

**Weight classes** (Unified Rules of MMA; boxing/kickboxing rulesets map onto the same ids) `[S: RJ §2.2]`:

| id | Upper limit lb | kg |
|---|---|---|
| wc.atomweight | 105 | 47.6 |
| wc.strawweight | 115 | 52.2 |
| wc.flyweight | 125 | 56.7 |
| wc.bantamweight | 135 | 61.2 |
| wc.featherweight | 145 | 65.8 |
| wc.lightweight | 155 | 70.3 |
| wc.super_lightweight | 165 | 74.8 |
| wc.welterweight | 170 | 77.1 |
| wc.super_welterweight | 175 | 79.4 |
| wc.middleweight | 185 | 83.9 |
| wc.super_middleweight | 195 | 88.5 |
| wc.light_heavyweight | 205 | 93.0 |
| wc.cruiserweight | 225 | 102.1 |
| wc.heavyweight | 265 | 120.2 |
| wc.super_heavyweight | >265 | >120.2 |

**Fight-night mass.** `fightNightKg = weighInKg × (1 + regainPct/100)`. Default `regainPct` by class (median
post-weigh-in regain, CSAC data) `[S: LIT_B §2.8]`: bantamweight 9.7, flyweight 9.4, atomweight 9.4,
featherweight 9.0, lightweight 8.5, welterweight 8.2, strawweight 8.1, middleweight 5.8; light-heavyweight 4.5
`[E]`, heavyweight 3.0 `[S: LIT_B §2.8 "smallest"; value E]`. Bellator mean 9.5 % `[S: LIT_B §2.12]`. The weight-
cut block (§2.4) can override.

**Population priors for generation** (UFC pooled men+women) `[S: LIT_B §2.4]`: stature 177.5 ± 9.5 cm; armspan
182.2 ± 11.5 cm; ape index A:S ~ N(1.026, 0.028). Generator: draw height by class, then `reachM = heightM ×
N(1.026, 0.028)`; `legReachM = heightM × N(0.575, 0.020)` `[E]` (UFC leg-reach values cluster around 0.57–0.58 of
stature). Stance: orthodox 76.6 %, southpaw 17.1 %, switch 6.1 % `[S: FD §2.4 (agentmma)]`; handedness: left
12.6 % of men, 9.9 % of women `[S: LIT_B §3.16]`; `P(left-handed | southpaw) = 0.60` `[E]` (many southpaws are
converted right-handers). Female fighters: apply the same schema; sex only enters through weight class limits,
calibration targets and regain defaults.

**Height/reach by class prior (male)** `[E]` — mean height by class for the generator: FLW 1.66, BW 1.69, FW
1.72, LW 1.76, WW 1.80, MW 1.83, LHW 1.87, HW 1.90 m (σ 0.05 within class); pooled matches 177.5 cm `[S: LIT_B §2.4]`.

**Body fat defaults** `[E]`: FLW–LW 8 %, WW–MW 9 %, LHW 10 %, HW 14 % (range 8–25 %), untrained adult 18–25 %.

#### 2.1.1 Appearance

```ts
interface FighterAppearance {
  skinTone: number;                 // 0 (lightest) … 1 (darkest), mapped to a 12-step palette by 08 [E]
  hair: { style: HairStyleId; color: ColorId; length: 'shaved' | 'short' | 'medium' | 'tied' };
  facialHair: FacialHairId;         // 'none' | 'stubble' | 'goatee' | 'full' | 'moustache'
  facePreset: number;               // index into 08's head-mesh presets
  faceMorphs?: Record<string, number>; // optional per-morph 0–1 overrides
  tattoos: Array<{ slot: TattooSlot; textureId: string; tint?: ColorId }>;
  shorts: { style: 'mma_short' | 'vale_tudo' | 'boxing_trunk' | 'thai_short' | 'compression';
            primary: ColorId; secondary: ColorId; trim: ColorId; sponsorSet?: string };
  gloves: { type: 'mma_4oz' | 'boxing_8oz' | 'boxing_10oz' | 'kb_10oz' | 'bare'; color: ColorId };
  handWrapColor: ColorId;
  mouthguardColor: ColorId;
  shinGuards?: boolean;             // amateur MT / kickboxing rulesets
  flag?: string;                    // ISO country for chyrons
}
type TattooSlot = 'leftArmFull' | 'rightArmFull' | 'leftForearm' | 'rightForearm' | 'chest' | 'stomach'
  | 'back' | 'neck' | 'leftLeg' | 'rightLeg' | 'leftCalf' | 'rightCalf';
```

Glove type is normally set by the ruleset (08 reads it; 05 uses it for cut/rotational modifiers, `[S: LIT_A §2 Bartsch 2012]`); the appearance field is the *visual* override.

#### 2.1.2 Rig proportions derived from the body

All ratios are design estimates anchored on standard anthropometric segment ratios and the UFC reach/height
definitions; they exist so that two fighters of equal height but different reach/leg reach *look* different and so
that 02's range geometry and 08's mesh agree. Every ratio `[E]` unless tagged.

```
shoulderWidthM  = 0.20 × heightM × (0.92 + 0.16 × build.meso)        // joint-centre to joint-centre
armLengthM      = (reachM − shoulderWidthM) / 2                       // shoulder joint → fingertip
  upperArmM = 0.42 × armLengthM; forearmM = 0.33 × armLengthM; handM = 0.25 × armLengthM
legLengthM      = legReachM                                            // hip joint → heel
  thighM = 0.47 × legLengthM; shankM = 0.44 × legLengthM; footHeightM = 0.09 × legLengthM
headHeightM     = 0.13 × heightM;  neckM = 0.05 × heightM
torsoM          = max(0.26 × heightM, heightM − legLengthM − headHeightM − neckM)
refMassKg       = 23.5 × heightM²                                      // "lean trained" reference (BMI 23.5)
bulk            = fightNightKg / refMassKg
limbRadiusScale = bulk ^ 0.5
waistScale      = 1 + 0.012 × (bodyFatPct − 10)
chestScale      = 1 + 0.08 × build.meso − 0.04 × build.ecto
definition      = clamp(1 − bodyFatPct / 25, 0, 1)                     // muscle-striation mask weight
```

Worked example (pooled UFC mean, 1.775 m, reach 1.822 m, legReach 1.021 m, 77 kg, 9 % fat, meso 0.6):
shoulder 0.372 m, arm 0.725 m (upper 0.305 / fore 0.239 / hand 0.181), thigh 0.480 / shank 0.449, torso 0.435 m
(clamped to 0.462 m by the 0.26 H floor), refMass 74.0 kg, bulk 1.04, limbRadiusScale 1.02 `[D]`.

### 2.2 Physical attributes

Scale: 0–100, 50 = average trained adult male of the weight class, 80+ elite, 95+ freak `[S: CONV §3]`. Fourteen
attributes: the thirteen listed in `CONV §3` plus `neck` (added here because 05's KO model consumes it directly,
`[S: DP §3.2 Collins 2014]`).

```ts
interface PhysicalAttributes {
  strength: number; explosiveness: number; speed: number; handSpeed: number; kickSpeed: number;
  cardio: number; chin: number; bodyToughness: number; recovery: number; flexibility: number;
  balance: number; reactionTime: number; neck: number;
}
```

#### 2.2.1 Definitions, physical anchors, consumers

| Attribute | Definition | 50 ≙ | 80 ≙ | 95 ≙ | Feeds (section: quantity) | Anchor tag |
|---|---|---|---|---|---|---|
| `strength` | Maximal force, expressed as relative lift total (bench+squat+deadlift)/body mass | 4.0 × BW | 5.5 × BW | 7.0 × BW | 01: `powerIndex`, `grapplingStrength`, `clinchPower`; 03: clinch control, TD finish, mat returns, pins; 04: squeezes, escapes | `[E]` anchors; legacy `refRelStrength = 3.0` was an untrained reference `[S: AUDIT §1.1]` |
| `explosiveness` | Rate of force development / first-step and burst quality | CMJ 40 cm; lead-leg RFD ≈ 12 N/ms | CMJ 52 cm; RFD 16.9 N/ms | CMJ 62 cm | 01: `powerIndex`; 02: strike acceleration, entry speed; 03: shot speed, sprawl speed; 05: burst (PCr) cost efficiency | elite RFD 16.9 vs junior 10.3 N/ms `[S: BOX §6]`; CMJ anchors `[E]` |
| `speed` | Foot speed / footwork velocity | top footwork speed 2.0 m/s | 2.4 m/s | 2.6 m/s | 02/07: movement, in-and-out, angles, cage escape; 03: distance to shot | legacy `baseSpeed 1.7 + 0.45` `[S: AUDIT/params]`; anchors `[E]` |
| `handSpeed` | Fist velocity at impact for a straight punch | 8.0 m/s | 9.3 m/s | 10.0 m/s | 02: execution-time multiplier, telegraph, force; 01: `powerIndex` | Olympic straight 9.14 m/s `[S: DP §3.1 Walilko 2005]`; other anchors `[E]` |
| `kickSpeed` | Foot velocity at impact for a roundhouse | 6.5 m/s | 7.3 m/s | 7.7 m/s | 02: kick execution-time multiplier, force | MT expert 7.22 ± 1.47 m/s `[S: MT §7.1]`; others `[E]` |
| `cardio` | Aerobic capacity (`vo2` 0–1 in 05 = cardio/100) | VO2max 55 ml/kg/min | 63 | 70 | 05: PCr refill rate, lactate clearance, aerobic debt; 07: pace targets | `[S: DP §4.1]` for the role; ml/kg anchors `[E]` |
| `chin` | Tolerance to rotational head acceleration (05 `chin` 0–1 = chinEff/100, 0.5 = median) | median | needs ≈ +870 rad/s² more per impact | ≈ +1300 rad/s² | 05: KO logistic z-shift | `z −= (chin − 0.5) × 2` in units of 1,800 rad/s² `[S: DP §3.2]`; `[D]` 0.30 × 2 × 1,800 = 1,080 → quoted values are 0.8×/1.2× that band |
| `bodyToughness` | Pain tolerance for body/leg trauma (05 `painTolerance`) | ×1.00 thresholds | ×1.15 | ×1.225 | 05: body/leg state thresholds ±25 % | `[S: DP §7 r22]` |
| `recovery` | Speed of acute recovery (rocked, body-hurt) and between-round refill | acute half-lives ×1.00 | ×0.82 | ×0.73 | 05: acute half-lives ±30 %; 01: `energy.breakRefillFrac` | `[S: DP §7 r22]` |
| `flexibility` | Range of motion (hips/hamstrings/shoulders) | head kick at own head height with quality ×0.90 | ×1.00 | ×1.05 | 02: head-kick availability and exec quality; 03/04: rubber guard, triangle from guard, escape from certain locks (`BJJ §4 S12`) | `[S: BJJ §4 S12]` for the role; multipliers `[E]` |
| `balance` | Single-leg and post-contact stability | post-kick stumble P ×1.0 | ×0.6 | ×0.4 | 02: post-kick balance loss; 03: TD defence base, sweep/trip resistance, clinch off-balancing | `[E]`, uses `MT §6` stumble table as the tier component |
| `reactionTime` | Simple visual reaction latency (higher = better) | 225 ms | 205 ms | 196 ms | 02: reaction gate (`BOX §8 r13`); 03: sprawl window (`WR §9 r10`) | 200–250 ms trained `[S: BOX §7]`; **not tier-scaled** `[S: LIT_B §4.2]` |
| `neck` | Neck strength / bracing | alphaEq ×1.00 | ×0.91 | ×0.865 | 05: KO modifier `× (1.15 − 0.30 × neck/100)` | `[S: DP §3.2]` |

Formulas used by consumers (all `[E]` unless noted; anchored to the table above):

```
reactionTimeMs      = 225 − 0.65 × (reactionTime − 50)                   // 50→225, 80→205.5, 95→195.75
footSpeedMs         = 2.0 + 0.0133 × (speed − 50)                        // 50→2.00, 80→2.40, 95→2.60
handSpeedMs         = 8.0 + 0.0433 × (handSpeed − 50)                    // 80→9.30 (≈ Olympic straight 9.14), 95→9.95
kickSpeedMs         = 6.5 + 0.0267 × (kickSpeed − 50)                    // 80→7.30, 95→7.70
bodyToughnessThresholdMult = 1 + 0.5 × (bodyToughness/100 − 0.5)        // ±25 %  [S: DP §7 r22]
recoveryHalfLifeMult       = 1 − 0.6 × (recovery/100 − 0.5)             // ±30 %  [S: DP §7 r22]
neckMult                   = 1.15 − 0.30 × (neck/100)                   //        [S: DP §3.2]
flexKickQualityMult        = 0.80 + 0.25 × (flexibility/100)            // 50→0.925, 80→1.0, 100→1.05
balanceStumbleMult         = 1.6 − 1.2 × (balance/100)                  // 50→1.0, 80→0.64, 100→0.4
```

#### 2.2.2 Age curves

There is no peer-reviewed attribute-level age curve; what is peer-reviewed is direction (winners 0.82 y younger,
r = 0.18 `[S: LIT_B §2.4]`), win rate by age band (58.1 % <25 → 37.7 % 37+, ≈ −0.7 pp/yr `[S: FD §2.4]`), late-
career output −1.5 %/yr with accuracy preserved `[S: LIT_B §5.8]`, peak age median 30.6 (IQR 28.0–33.2)
`[S: FD §2.4]`, and the KO-susceptibility gradient (strikes absorbed per knockdown falls to one-third from the
early 20s to the 40s; KO-loss rate ≈10 % <25 → 24.6 % 37+) `[S: FD §2.4, §4]`. The curves below are `[E]`
shaped to reproduce those anchors; they are applied as multipliers on the *stored* attribute to give the
*effective* attribute used in a bout (`attrEff = attr × ageMult(attr, age)`, clamped 0–100).

Piecewise-linear multipliers (1.00 inside the peak window; slopes are per year outside it):

| Attribute | Rise to peak (per yr, from age 18) | Peak window | Decline A (%/yr) | Decline B from age (%/yr) | Tag / anchor |
|---|---|---|---|---|---|
| explosiveness | +2.0 % (0.90 at 18 → 1.00 at 23) | 23–28 | −1.0 (29–33) | 34+: −2.0 | `[E]`; `MIS §4.5` "speed −1 sub-tier per 2 yr after 34" |
| speed, handSpeed, kickSpeed | +1.5 % (0.925 at 18) | 23–29 | −1.0 (30–33) | 34+: −2.0 | `[E]`; output −1.5 %/yr late career `[S: LIT_B §5.8]` |
| strength | +2.5 % (0.80 at 18) | 26–33 | −0.7 (34–38) | 39+: −1.5 | `[E]` |
| cardio | +1.0 % (0.94 at 18) | 24–31 | −0.8 (32–35) | 36+: −1.5 | `[E]` |
| recovery | 0 | 18–27 | −1.0 (28–33) | 34+: −2.5 | `[E]`; `MIS §4.5` "−5 %/yr over 34" is the upper bound |
| flexibility | 0 | 18–25 | −0.7 (26–34) | 35+: −1.2 | `[E]` |
| balance | 0 | 18–34 | 0 | 35+: −0.8 | `[E]` |
| reactionTime | 0 | 18–30 | −0.5 (31+) | — | `[E]`; plus career-exposure term below |
| bodyToughness, neck | 0 | all | 0 | — | `[E]` |
| chin | — | ≤25 | see chin curve | — | `[S→E]` below |

**Chin curve** (points subtracted from `chin`, cumulative): 0 up to age 25; −1.75 pts/yr from 25 to 30
(−8.75 at 30); −2.5 pts/yr from 30 to 40 (−33.75 at 40); flat thereafter (cap −34) `[D]`. Derivation: the
observed hazard ratios ×1.33 at 30, ×2.0 at 35, ×3.0 at 40 `[S: FD §4]` are ln 1.33 = 0.29, ln 2 = 0.69,
ln 3 = 1.10 logit; at 0.02 logit per chin point (`z −= (chin−0.5)×2`, `[S: DP §3.2]`) that is 14 / 35 / 55
points; attenuated by 0.6 `[E]` because part of the observed gradient is carried by the separate KO-history term
(§2.4) and by selection. **05 must not add its own age multiplier on `kKO`** (the `DP §3.2` "+4 %/yr after 30,
+8 %/yr after 35" row is subsumed by this curve) — one age term, here.

**Career exposure on reaction time**: `reactionTimeEff −= 0.1 × max(0, proFights − 10)` points `[E]`, direction
from cumulative-exposure processing-speed loss `[S: DP §7 r21 Bernick 2015]`.

**Pace**: `paceAgeMult = 1 − 0.015 × max(0, age − 33)` `[S: LIT_B §5.8]` consumed by 07 as a multiplier on
output-rate targets (accuracy is *not* reduced by age).

**Skill and mental attributes do not decay with age.** Decision-quality gains with experience are an input (the
creator/generator raises `fightIQ`/`composure` with fights), not an age function.

#### 2.2.3 Legacy derivation (backward compatibility with `AthleteProfile`)

`AthleteProfile` = height (in), weight (lb), age, three 1RM lifts (lb), TKD/boxing/grappling years, conditioning
0–1, training days/week `[S: AUDIT §1.1]`. Conversion (`legacy.toFighter(profile)`), every mapping `[E]` unless
tagged; `S(y, q)` is the years-to-skill prior of §2.3.2:

```
massKg        = weightLb × 0.45359237;  weighInKg = fightNightKg = massKg   // no cut for legacy amateurs
heightM       = heightIn × 0.0254
reachM        = 1.026 × heightM        // [S: LIT_B §2.4]; replaces the legacy half-span bug (1.02 × 0.5 × H)
legReachM     = 0.575 × heightM
bodyFatPct    = 12 (trained, trainingDaysPerWeek ≥ 3) | 20 (untrained)
bmi           = massKg / heightM²
build.endo    = clamp((bmi − 24) / 8, 0, 0.6); build.meso = clamp((relStrength − 3) / 3, 0, 0.7) × (1 − endo)
build.ecto    = 1 − endo − meso
stance        = 'orthodox'; handedness = 'right'
relStrength   = (bench + squat + deadlift) / weightLb
strength      = clamp(50 + 60 × log2(relStrength / 4.0))              // A: 5.25×BW → 73.6; B: 3.0×BW → 25.0 [D]
techniqueIdx  = 1 − exp(−(boxingYears + tkdYears + grapplingYears) / 3) // legacy tauTechnical = 3 [S: AUDIT/params]
explosiveness = clamp(0.6 × strength + 20 + 20 × conditioning)
speed         = clamp(45 + 20 × techniqueIdx − 25 × max(0, ln(massKg / 77)))
handSpeed     = clamp(40 + 20 × S(boxingYears, 0.9)/100 + 0.15 × explosiveness)
kickSpeed     = clamp(40 + 20 × S(tkdYears, 0.9)/100 + 0.15 × explosiveness)
cardio        = 30 + 50 × conditioning                                   // 0.5 → 55, 0.8 → 70
recovery      = cardio − 5 + 5 × (trainingDaysPerWeek / 7)
chin = 50; bodyToughness = 50; reactionTime = 50; neck = 40 + 0.2 × strength
flexibility   = tkdYears > 0 ? 60 : 45
balance       = 45 + 15 × techniqueIdx
boxing.*      = S(boxingYears, 0.9)          // every boxing sub-skill equal; creator can spread
taekwondo.*   = S(tkdYears, 0.9)
wrestling.* = bjj.* = 0.8 × S(grapplingYears, 0.9)   // "grappling" unspecified → split
mmaIntegration.* = 0.5 × min(strikingMean, grapplingMean)
fightIQ = 35 + 30 × techniqueIdx; composure = 35 + 25 × techniqueIdx; aggression = 55; heart = 50
discipline = 40 + 30 × (trainingDaysPerWeek / 7); adaptability = 40 + 20 × techniqueIdx
record = { pro: 0-0-0, am: 0-0-0 }; experience = 0.1
```

Check on the shipped profiles `[D]`: Athlete A (200 lb, 5 yr TKD, 3 yr boxing, conditioning 0.8, 7 d/wk):
strength 73.6, cardio 70, boxing 100×0.9×3/6.5 = 41.5 (T2), taekwondo 100×0.9×5/8.5 = 52.9 (T3), transferred
kickboxing kicks 0.6 × 52.9 = 31.8 (§2.3.3). Athlete B (150 lb, untrained, 0.5): strength 25, cardio 55, all
disciplines 0 → T0. Legacy transfer 0.6 for TKD → striking `[S: AUDIT §1.1, fighter.ts]` is retained as the
TKD→kickboxing kicks factor.

### 2.3 Discipline experience and sub-skills

```ts
type DisciplineId = 'boxing' | 'muayThai' | 'kickboxing' | 'wrestling' | 'judo' | 'bjj' | 'karate' | 'sambo'
  | 'taekwondo' | 'mmaIntegration';

interface DisciplineBlock<K extends string> {
  yearsTrained: number;        // decimal years
  trainingQuality: number;     // 0.6 hobbyist … 1.15 elite camp (see §2.3.2)
  competition?: { bouts: number; wins: number; level: 'none' | 'local' | 'national' | 'international' };
  styleTags: string[];         // discipline-specific (e.g. wrestling: 'freestyle' | 'folkstyle' | 'greco')
  native: Record<K, number>;   // stored sub-skills 0–100
  // derived, not stored:
  effective: Record<K, number>; // native ⊕ transfers (§2.3.3)
  mean: number;                 // mean of effective sub-skills
  tier: 0 | 1 | 2 | 3 | 4 | 5;  // §2.3.4
}
```

#### 2.3.1 Sub-skill catalogue

Each sub-skill is 0–100 and is the "relevant sub-skill" named by other sections' logit edges (`CONV §4`).
One-line definitions; the consumer column names the section whose formulas read it.

**boxing** (10)

| Sub-skill | Definition | Consumer |
|---|---|---|
| `jab` | Lead-hand straight: speed, accuracy, use as range tool | 02 |
| `power` | Rear-hand and hook mechanics: kinetic-chain efficiency (gates `powerIndex`) | 01, 02 |
| `combinations` | Ability to chain 2–5 punches with rhythm; combo length available | 02 |
| `headMovement` | Slip, roll, pull, weave quality and correctness of direction | 02 |
| `footwork` | Pivots, angles, in-and-out, ring/cage cutting and escaping | 02, 07 |
| `guard` | Positional defence: high guard, parry, catch, shoulder roll | 02 |
| `bodyWork` | Body punching selection and accuracy | 02 |
| `counters` | Block-and-counter, pull counter, check hook, delayed counter | 02 |
| `feints` | Feint repertoire and sell quality | 02 |
| `ringCraft` | Cutting the cage/ring, controlling centre, exit management | 02, 07 |

**muayThai** (8)

| Sub-skill | Definition | Consumer |
|---|---|---|
| `kicks` | Round kicks (low/body/head): hip rotation, shin contact, return to stance | 02 |
| `teep` | Push kicks lead/rear: range control, balance disruption | 02 |
| `knees` | Straight/curved/long knees, clinch knees | 02, 03 |
| `elbows` | Elbow strikes standing and in clinch | 02, 03 |
| `clinch` | Thai plum: neck control, swimming, turning, off-balancing | 03 |
| `checks` | Kick defence by checking; early-check window | 02 |
| `catches` | Catching kicks and follow-ups (sweep/dump/knee) | 02, 03 |
| `hands` | Boxing inside a Muay Thai frame (mostly transferred from boxing) | 02 |

**kickboxing** (8): `punches`, `kicks`, `lowKicks`, `combinations` (punch-to-kick chaining, Dutch style),
`footwork`, `checks`, `spinning` (spinning back kick/fist, wheel kick), `defence` (blocks, parries, lean-backs).
Consumers 02 (all), 03 (`punches` for clinch break-offs).

**wrestling** (10)

| Sub-skill | Definition | Consumer |
|---|---|---|
| `shots` | Level change, penetration step, double/single/low single entries | 03 |
| `takedownDefence` | Sprawl, whizzer, hip pressure, limp-leg, re-shot denial | 03 |
| `topControl` | Riding, mat returns, pinning hips, cross-face, keeping position after a takedown | 03, 04 |
| `scrambles` | Funk, granby, sit-outs, re-attacks in transition | 03, 04 |
| `cageWrestling` | Fence pressure, body-lock takedowns on the cage, head-inside/outside chains | 03 |
| `clinch` | Upper-body wrestling: pummelling, underhooks, collar ties, snap-downs | 03 |
| `chains` | Re-attack after a stall/sprawl; finish tree depth | 03 |
| `finishes` | Turning the corner, lifts, trips, dumps from a completed shot | 03 |
| `getUps` | Technical stand-up, wall walk, kimura grip stand-up from bottom | 03, 04 |
| `matReturns` | Returning a standing opponent to the mat from the back / body lock | 03 |

Style tags `freestyle | folkstyle | greco | none` apply the background modifiers of `WR §7` (leg attacks +10/+8/−5,
upper-body +0/+2/+15, mat returns +5/+10/+5, scrambles +5/+10/0) as **additive offsets on the effective
sub-skills** `[S: WR §7]` (Greco +15 is a design choice per `WR §10`, `[S→E]`).

**judo** (7): `gripFighting` (winning kumi-kata, breaking grips), `throws` (tachi-waza execution), `footSweeps`
(ashi-waza timing), `counters` (mirror counters, tani otoshi, uchi-mata-sukashi), `kuzushi` (off-balancing incl.
action–reaction), `newaza` (pins, turnovers, transitions to ne-waza), `ukemi` (falling safely, landing on top /
in guard rather than flat). Consumers 03 (all; `newaza` and `ukemi` for the ground nodes).

**bjj** (12)

| Sub-skill | Definition | Consumer |
|---|---|---|
| `guard` | Guard retention and framing (closed, half, butterfly, open, vs strikes) | 03 |
| `passing` | Pass repertoire and chaining (`BJJ §6` weights) | 03 |
| `topControl` | Side control / mount / knee-on-belly retention, posture under strikes | 03 |
| `backControl` | Hooks, body triangle, hand-fighting from the back | 03, 04 |
| `chokes` | RNC, guillotine, arm-triangle, triangle, D'arce/anaconda mechanics | 04 |
| `jointLocks` | Armbar, kimura, americana, omoplata mechanics | 04 |
| `legLocks` | Heel hooks, knee bars, straight ankle; entanglement entries | 04 |
| `escapes` | Positional escapes (mount, side, back, turtle) | 03 |
| `sweeps` | Sweep repertoire and wrestle-ups from guard | 03 |
| `subDefence` | Early recognition, hand-fighting, S1/S2 denial (SUBDEF in `SUB §4`) | 04 |
| `subAttack` | Finishing pressure and chain awareness (SUB in `SUB §5`) | 04 |
| `wrestleUps` | Getting up from seated guards, using the cage | 03 |

**karate** (6): `distanceControl`, `blitz` (straight-line burst entries), `kicks` (front/round/side kicks from
long range), `counters` (timing on the opponent's entry), `footwork` (bouncing, angles, retreat-and-return),
`timing` (rhythm breaking, half-beat attacks). Consumers 02, 07.

**sambo** (7): `throws`, `takedowns` (leg attacks from sambo grips), `legLocks`, `gripFighting`, `topControl`,
`transitions` (throw → submission chains), `strikingToGrappling` (combat sambo: punches into throws). Consumers 03, 04.

**taekwondo** (6): `kicks`, `headKicks`, `spinning`, `footwork`, `distance`, `counters`. Consumer 02.

**mmaIntegration** (8)

| Sub-skill | Definition | Consumer |
|---|---|---|
| `levelChanges` | Blending strikes and shots: feint-shoot, jab-to-double, level-change uppercut (`MIS §2.1`) | 02, 03, 07 |
| `clinchStriking` | Dirty boxing, elbows and knees inside wrestling clinches on the cage | 03 |
| `cageWork` | Using and escaping the fence standing and on the ground | 03, 07 |
| `groundAndPound` | Posture, strike selection and pass-with-strikes from top | 03 (strike resolution in 02) |
| `getUps` | Getting up under an MMA top player (stand > sweep > submit priority) | 03 |
| `transitions` | Scramble-to-strike and strike-to-scramble awareness | 03, 04 |
| `subDefenceUnderStrikes` | Keeping arms safe while eating shots; not giving the neck when hurt | 04 |
| `gameplanExecution` | Carrying out a multi-phase plan (range → clinch → ground) | 07 |

Untrained default: every sub-skill of an untrained discipline = 5 `[E]` (inside the T0 band 0–10, `[S: CONV §3]`).

#### 2.3.2 Years → skill prior (creator default, generator, legacy)

```
S(y, q) = clamp( 100 × q × y / (y + 3.5), 0, 100 )
```

`[E]`, fitted to the `CONV §3` training columns: q = 1.0 gives 0.25 yr → 6.7 (T0), 1 yr → 22 (T1), 4 yr → 53
(T2/T3 boundary), 8 yr → 70 (T3/T4 boundary), 15 yr → 81, 25 yr → 88 `[D]`. Training quality `q`: 0.6
hobbyist (≤2 sessions/wk), 0.8 regular (3–4/wk), 0.9 amateur competitor, 1.0 full-time professional camp, 1.15
elite camp with international competition `[E]`. The generator then spreads sub-skills as `native_i = S + N(0, 8)`
`[E]` and the creator lets the user specialise. A T5 requires the mental gate (§2.3.4) — years alone never
produce it.

#### 2.3.3 Cross-discipline transfer

`effective[d][k] = max(native[d][k], max_i(factor_i × native[src_i][srcSkill_i]))` — **max, not sum**, so
stacking two sources never exceeds the best of them `[E]`. Style-tag offsets (`WR §7`) are added after the max.
Transfer factors (tags per row; `[E]` = design judgement anchored on the cited coaching consensus):

| id | From → To | Factor | Tag |
|---|---|---|---|
| `xfer.tkd_kicks_kb` | taekwondo.kicks → kickboxing.kicks | 0.60 | `[S: AUDIT §1.1 (legacy tkdTransfer 0.6)]` |
| `xfer.tkd_kicks_mt` | taekwondo.kicks → muayThai.kicks | 0.50 | `[E]` (TKD snap vs Thai swing-through, `MT §2 S1`) |
| `xfer.tkd_head_kb` | taekwondo.headKicks → kickboxing.kicks (head only, 02 reads separately) | 0.80 | `[E]` |
| `xfer.tkd_spin_kb` | taekwondo.spinning → kickboxing.spinning | 0.85 | `[E]` |
| `xfer.tkd_foot_karate` | taekwondo.footwork → karate.footwork | 0.70 | `[E]` |
| `xfer.tkd_dist_karate` | taekwondo.distance → karate.distanceControl | 0.60 | `[E]` |
| `xfer.box_hands_mt` | boxing.power → muayThai.hands | 0.90 | `[E]` |
| `xfer.box_punch_kb` | boxing.power → kickboxing.punches | 0.90 | `[E]` |
| `xfer.box_combo_kb` | boxing.combinations → kickboxing.combinations | 0.70 | `[E]` (kick chaining not covered) |
| `xfer.box_foot_kb` | boxing.footwork → kickboxing.footwork | 0.80 | `[E]` |
| `xfer.box_guard_kb` | boxing.guard → kickboxing.defence | 0.60 | `[E]` (no kick defence) |
| `xfer.box_head_karate` | boxing.headMovement → karate.counters | 0.30 | `[E]` |
| `xfer.mt_kicks_kb` | muayThai.kicks → kickboxing.kicks | 0.90 | `[E]` |
| `xfer.mt_checks_kb` | muayThai.checks → kickboxing.checks | 0.95 | `[E]` |
| `xfer.mt_knees_wrclinch` | muayThai.clinch → wrestling.clinch | 0.40 | `[E]` (collar ties yes, pummelling no) |
| `xfer.mt_clinch_mmaclinch` | muayThai.clinch → mmaIntegration.clinchStriking | 0.60 | `[E]` |
| `xfer.kb_kicks_mt` | kickboxing.kicks → muayThai.kicks | 0.85 | `[E]` |
| `xfer.kb_punch_box` | kickboxing.punches → boxing.power | 0.75 | `[E]` |
| `xfer.kb_combo_box` | kickboxing.combinations → boxing.combinations | 0.70 | `[E]` |
| `xfer.kb_low_mt` | kickboxing.lowKicks → muayThai.kicks | 0.70 | `[E]` |
| `xfer.karate_dist_box` | karate.distanceControl → boxing.footwork | 0.40 | `[E]` |
| `xfer.karate_kicks_kb` | karate.kicks → kickboxing.kicks | 0.55 | `[E]` (exec time 1.29 s vs MT 1.02 s, `MT §7.1`) |
| `xfer.karate_counter_box` | karate.counters → boxing.counters | 0.50 | `[E]` |
| `xfer.wr_clinch_ju` | wrestling.clinch → judo.gripFighting | 0.40 | `[E]` (no-gi grips) |
| `xfer.wr_top_bjj` | wrestling.topControl → bjj.topControl | 0.70 | `[E]` |
| `xfer.wr_scr_bjj` | wrestling.scrambles → bjj.escapes | 0.50 | `[E]` |
| `xfer.wr_getup_bjj` | wrestling.getUps → bjj.wrestleUps | 0.80 | `[E]` |
| `xfer.wr_shots_mma` | wrestling.shots → mmaIntegration.levelChanges | 0.50 | `[E]` |
| `xfer.wr_cage_mma` | wrestling.cageWrestling → mmaIntegration.cageWork | 0.70 | `[E]` |
| `xfer.wr_clinch_mt` | wrestling.clinch → muayThai.clinch | 0.40 | `[E]` |
| `xfer.ju_throws_wr` | judo.throws → wrestling.clinch | 0.60 | `[S: WR §7]` (judo/sambo: upper-body +10) |
| `xfer.ju_throws_wrfin` | judo.throws → wrestling.finishes | 0.40 | `[E]` |
| `xfer.ju_grip_wr` | judo.gripFighting → wrestling.clinch | 0.50 | `[E]` |
| `xfer.ju_sweep_wr` | judo.footSweeps → wrestling.finishes (trips) | 0.60 | `[E]` |
| `xfer.ju_newaza_bjj` | judo.newaza → bjj.topControl | 0.50 | `[E]` |
| `xfer.ju_newaza_bjjpin` | judo.newaza → bjj.passing | 0.35 | `[E]` |
| `xfer.ju_counter_wr` | judo.counters → wrestling.takedownDefence | 0.35 | `[E]` (throw counters, not sprawls) |
| `xfer.ju_ukemi_bjj` | judo.ukemi → bjj.guard | 0.30 | `[E]` |
| `xfer.bjj_guard_ju` | bjj.guard → judo.newaza | 0.50 | `[E]` |
| `xfer.bjj_scr_wr` | bjj.escapes → wrestling.scrambles | 0.50 | `[S: WR §7]` (BJJ-only scrambles +5) |
| `xfer.bjj_wrestleup_wr` | bjj.wrestleUps → wrestling.getUps | 0.70 | `[E]` |
| `xfer.bjj_shots_wr` | bjj.sweeps → wrestling.shots | 0.20 | `[S: WR §7]` (BJJ-only leg attacks −15 → weak) |
| `xfer.bjj_top_wr` | bjj.topControl → wrestling.topControl | 0.60 | `[E]` |
| `xfer.bjj_subdef_mma` | bjj.subDefence → mmaIntegration.subDefenceUnderStrikes | 0.60 | `[E]` |
| `xfer.bjj_legs_sambo` | bjj.legLocks → sambo.legLocks | 0.90 | `[E]` |
| `xfer.sambo_throws_ju` | sambo.throws → judo.throws | 0.70 | `[E]` |
| `xfer.sambo_td_wr` | sambo.takedowns → wrestling.shots | 0.65 | `[E]` |
| `xfer.sambo_grip_ju` | sambo.gripFighting → judo.gripFighting | 0.70 | `[E]` |
| `xfer.sambo_legs_bjj` | sambo.legLocks → bjj.legLocks | 0.80 | `[E]` |
| `xfer.sambo_top_bjj` | sambo.topControl → bjj.topControl | 0.60 | `[E]` |
| `xfer.sambo_trans_bjj` | sambo.transitions → bjj.subAttack | 0.50 | `[E]` |
| `xfer.sambo_s2g_mma` | sambo.strikingToGrappling → mmaIntegration.levelChanges | 0.70 | `[E]` (combat sambo) |
| `xfer.sambo_throws_wr` | sambo.throws → wrestling.clinch | 0.55 | `[E]` |
| `xfer.mma_lc_wr` | mmaIntegration.levelChanges → wrestling.shots | 0.30 | `[E]` |
| `xfer.mma_gnp_bjj` | mmaIntegration.groundAndPound → bjj.topControl | 0.40 | `[E]` |
| `xfer.mma_getup_bjj` | mmaIntegration.getUps → bjj.wrestleUps | 0.60 | `[E]` |

Rule of thumb for adding rows: same movement family in a different rule set 0.85–0.95; same phase, different
mechanics 0.5–0.7; adjacent phase 0.3–0.5; incompatible 0–0.2 `[E]`.

#### 2.3.4 Tier derivation

```
tierBySkill(mean):  <10 → T0; <30 → T1; <50 → T2; <70 → T3; <90 → T4; ≥90 → T5        // [S: CONV §3]
tierByYears(y):     <0.25 → T0; <1 → T1; <4 → T2; <8 → T3; ≥8 → T4                     // [S: CONV §3]
tier = min(tierBySkill(mean of effective sub-skills), tierByYears(yearsTrained) + 1)   // [E] cap
T5 gate: tier == 5 only if mean ≥ 90 AND fightIQ ≥ 80 AND composure ≥ 75; otherwise T4   // [S: CONV §3 "exceptional IQ/consistency"; thresholds E]
```

The `+1` cap lets a fast learner sit one tier above his training age but no more (a 6-month prodigy cannot be
T4). Transferred skill counts toward `mean` but `yearsTrained` for the target discipline is
`years + 0.5 × Σ(source years × factor)` `[E]` so that a 10-year judoka is not held to T1 wrestling by the cap.

**Aggregate tiers** (for rules that need a single number):

```
strikingMean  = max over {boxing, muayThai, kickboxing, karate, taekwondo} of discipline mean
grapplingMean = max over {wrestling, judo, bjj, sambo} of discipline mean
mmaMean       = 0.35 × strikingMean + 0.35 × grapplingMean + 0.30 × mmaIntegration.mean   // [E]
strikingTier, grapplingTier, mmaTier = tierBySkill(...) with the years cap using the best contributing discipline
iqTier        = fightIQ < 30 → 1; < 50 → 2; < 70 → 3; < 90 → 4; else 5                 // maps MIS §6.4/§8 "IQ 1–5"
```

Mapping of research tier vocabularies onto T0–T5 (used when a catalogue row cites a research table):

| Research file | Its tiers | → T |
|---|---|---|
| `BOX §6` | Brand-new / Beginner / Amateur / Regional pro / Elite / Champion | T0 / T1 / T2 / T3 / T4 / T5 |
| `MT §6` | T0 beginner / T1 amateur / T2 regional / T3 national / T4 elite | T0–T1 / T2 / T3 / T4 / T5 |
| `WR §7` | Novice 0–30 / Competent 30–55 / Advanced 55–75 / Elite 75–90 / Generational 90+ | T0–T1 / T2 / T3 / T4 / T5 |
| `JU §6` | Novice / Intermediate / Elite | T0–T1 / T2–T3 / T4–T5 |
| `BJJ §6` | 0 brand new / 1 beginner / 2 intermediate / 3 advanced / 4 elite | T0 / T1 / T2–T3 / T4 / T5 |
| `SUB §4` | Untrained 0–19 / Novice 20–39 / Intermediate 40–59 / Advanced 60–79 / Elite 80–100 (SUBDEF) | by `bjj.subDefence` value directly |
| `MIS §6.4, §8` | IQ 1–5 | `iqTier` |

### 2.4 Record, experience and career state

```ts
interface FightRecord { wins: number; losses: number; draws: number; noContests: number;
  koWins: number; subWins: number; decWins: number; koLosses: number; subLosses: number; decLosses: number; }

interface CareerState {
  pro: FightRecord;
  amateur: FightRecord;
  titleFights: number;               // championship bouts contested (any promotion)
  bigFightComposure: number;         // 0–100, composure under maximal event magnitude (§2.4.2)
  careerKnockdownsAbsorbed: number;  // knockdowns suffered (all bouts)
  lastResult: 'win' | 'loss' | 'draw' | 'none';
  lastResultWasKoLoss: boolean;
  daysSinceLastBout: number;         // layoff
  shortNoticeDays?: number;          // if replacing on short notice: days of camp (<21 = short notice [E])
  stanceExposure: { orthodox: number; southpaw: number }; // bouts vs each stance
  weightCut: { cutPct: number; regainPct: number; residualDehydration: number }; // §2.4.4
  winStreak: number;                 // consecutive wins entering the bout
}
```

#### 2.4.1 Experience scalar

```
totalFights = pro.total + 0.5 × amateur.total                                          // [E] amateur bouts count half
experience  = 0.1 + 0.9 × (1 − exp(−totalFights / 6))                                 // [E]; debut 0.10, 10 pro fights 0.83
```
Calibrated to `DP §4.6`: "debut fighters experience ≈ 0.1; 10+ pro fights ≈ 0.8" `[S: DP §4.6]`. 05 uses it in the
adrenaline-dump rule (`dump = (1 − experience)(1 − composure/100) × eventMagnitude`, `[S: DP §4.6]`).

**Veteran edge**: debutant vs UFC veteran 43/57 `[S: FD §2.4]` → `experienceLogit = +0.28 × (experience_A −
experience_B)` on the bout-level prior `[D: logit(0.57) = 0.282]`; this is *not* applied per exchange — 07 folds
it into decision-quality noise (`decisionNoiseMult = 1.4 − 0.5 × experience` `[E]`). Beyond ~120 cage minutes the
experience effect flattens and then reverses through age (48.7 % <30 min → 52.0 % at 120–179 min → 44.1 %
>180 min `[S: FD §2.4]`), which the age curves already produce; do **not** add a separate "too much experience"
penalty.

#### 2.4.2 Big-fight composure

`bigFightComposure` is stored (creator) with generator default
`clamp(composure − 15 + 3 × min(titleFights, 5) + 0.5 × min(pro.total, 20))` `[E]`. 05/07 compute the composure
used in a bout as `composureEff = composure + (bigFightComposure − composure) × eventMagnitude`, with
`eventMagnitude` 1.0 title fight, 0.8 main event, 0.6 regional card, 0.3 amateur/smoker `[S: DP §4.6 (1.0 / 0.6);
others E]`.

#### 2.4.3 KO losses, knockdown history and chin decay

```
chinEff        = clamp(chin − ageChinPenalty(age) − 3 × min(koLosses, 4) − 1 × min(careerKnockdownsAbsorbed, 5), 0, 100)
kKOHistoryMult = 1 + 0.25 × min(koLosses, 4)                                            // [S: DP §3.2]
```
`−3` per KO loss (cap 4) is `DP §7 r21` ("lowers chin by 0.03 permanently") `[S: DP §7 r21]`; the knockdown term
`−1` per career knockdown absorbed (cap 5) `[E]` reproduces the never-dropped 13.9 % → 5+ KDs 25.3 % KO-loss
gradient jointly with `kKOHistoryMult` `[S: FD §2.4]` (calibration hook C-4, §6). Consecutive-KO risk (22.7 % of
KO'd athletes suffer a second consecutive KO; OR 1.13) `[S: FD §2.4]` is covered by the same terms plus the
quick-turnaround rule below.

#### 2.4.4 Layoffs, short notice, weight cut, streaks

| Condition | Effect (applied to effective attributes / mental for this bout) | Tag |
|---|---|---|
| Layoff > 210 d | win rate 41 % vs baseline 50 % → logit −0.36 `[D]`; implemented as `composureEff −8`, `reactionTimeEff −3`, `cardioEff −4`, `anticipation.readP −0.03` (sum ≈ −0.36 logit at typical k) | `[S: FD §2.4]` value; split `[E]` |
| Layoff ≥ 365 d | 35 % → logit −0.62 `[D]`; `composureEff −12`, `reactionTimeEff −5`, `cardioEff −6`, `readP −0.05` | `[S: FD §2.4]` (conflicting 57 % count noted there); split `[E]` |
| < 60 d after a KO loss | 13 % (n = 16, weak) → treat as `chinEff −10`, `composureEff −10` for the bout | `[S: FD §2.4]`; magnitude `[E]` |
| Short notice (camp < 21 d) | 37 % → logit −0.53 `[D]`; `cardioEff −8`, `residualDehydration +0.01`, plan quality: scouting σ ×1.5 (07) | `[S: FD §2.4]`; split `[E]` |
| Win streak ≥ 5 | 61 % `[S: FD §2.4]`; **no direct modifier** — the streak is evidence of latent skill already in the ratings; 06 may use it for reputation bias in judging (`MIS §3.5`, +0.34 % round-win per rank place) | `[S: LIT_B §3.5]` |
| Previous-bout result | `lastResult = 'loss'` → `composureEff −3`; `'win'` → +2 | `[S: LIT_B §2.7]` direction; magnitude `[E]` |
| Weight cut | `cutPct` (mass lost in fight week) and `regainPct`. `residualDehydration d = clamp(0.015 × max(0, cutPct − 5) × (1 − discipline/100) × 1.5, 0, 0.05)` `[E]`. 05 applies: aerobic refill × (1 − 4d), PCr ceiling −2 per 1 % d, chin `z += 3d` `[S: DP §4.7]`. Regain edge: `fightNightKg` difference feeds `clinchPower`/`powerIndex` (§2.7); no separate odds multiplier (OR 1.046 per 1 % `[S: LIT_B §2.8]` is small and null in elite samples `[S: LIT_B §2.10]`) | `[S: DP §4.7]`, `[S: LIT_B §2.8–2.12]` |
| Stance exposure | `stanceFamiliarity[opp.stance] = 1 − exp(−bouts vs that stance / 4)` `[E]`; 02 applies `ST-5` (`MIS §5.1`) scaled by `(1 − familiarity)`: reaction +10 %, counter accuracy −10 %, wrong-side step 15 %/exchange at familiarity 0 | `[S: MIS §5.1]`; decay `[E]` |

### 2.5 Mental attributes

```ts
interface MentalAttributes { fightIQ: number; aggression: number; composure: number; heart: number;
  discipline: number; adaptability: number; }
```

| Attribute | Definition | Gates / feeds (section: effect) |
|---|---|---|
| `fightIQ` | Quality of perception → plan → decision: scouting fidelity, plan structure, read bonus, score estimate | `iqTier` (§2.3.4) → scouting noise σ 30/20/12/8/5 % `[S: MIS §6.4]`; plan features (single mode → multi-branch traps) `[S: MIS §6.4]`; score-estimate σ none/corner-only/0.5/0.3/0.2 `[S: MIS §8]`; `anticipation.readP += 0.03 × (fightIQ − 50)/50` (§2.7.6) `[E]`; finisher measured vs reckless (IQ ≥ 3 measured) `[S: MIS §7.5 D-3]`; takedown setup class `[S: MIS §8]` |
| `aggression` | Initiative preference and finishing appetite | initiative split: base attack/counter/defensive-positioning ≈ 1/3 each `[S: LIT_B §5.10]`; `attackShare = 0.33 + 0.30 × (aggression − 50)/50` `[E]`; pace target × (0.8 + 0.4 × aggression/100) `[E]`; finisher recklessness if `aggression ≥ 75` acts as personality 'killer' (`MIS §7.5 D-3`) `[E]`; high-intensity time winners 1.8× losers `[S: LIT_B §2.13]` is an outcome, not an input |
| `composure` | Resistance to arousal/anxiety effects | adrenaline dump `(1 − composure/100)` `[S: DP §4.6]`; rocked-state decision penalty scale `[S: DP §7 r22]`; anxiety read penalty scale (§3 `beh.gen.anxiety_gaze`) `[S: LIT_B §4.3]`; low composure → R1 pace ×1.3, drain ×1.4 for 120 s, R2 output ×0.7 `[S: MIS §7.6]`; corner uptake +; "sells composure" (T3+ Thai) `[S: MT §6]`; grows with experience only via the creator/generator, falls with layoff (§2.4.4) |
| `heart` | Willingness to continue under damage/fatigue/deficit | stubbornness (tap refusal) `= tierBase × (0.5 + heart/100)` (§2.7.7) `[E]` on `SUB §4` tier bases; hurt-state: `P(shell/turn away \| rocked) = 0.5 × (1 − heart/100)` for T0–T2 `[E]`; 05 uses `bodyToughness` for physiology, `heart` for the *decision* to keep working: `continueUnderBodyHurtP = heart/100` `[E]`; corner-retirement resistance (05 corner rule weights protectiveness × (1 − heart/100)) `[E]`; late-round surge when behind (`MIS §7.4`) enabled if heart ≥ 60 `[E]` |
| `discipline` | Adherence to plan, pacing and preparation | `P(abandon plan when hit) = 0.6 × (1 − discipline/100)` `[E]` (`MIS §7.8` failure mode 3); mustNot violation rate `0.3 × (1 − discipline/100)` per opportunity `[E]`; pacing adherence noise; weight-cut `residualDehydration` (§2.4.4); training quality prior for generation |
| `adaptability` | Speed/willingness to change behaviour on evidence (distinct from IQ = quality of the change) | `P(change \| signal) = base(iqTier) × (0.7 + 0.6 × adaptability/100)`, clamp ≤ 0.98 `[E]` on `MIS §7.3` bases 0.3/0.5/0.7/0.85/0.95; min dwell × (1.3 − 0.6 × adaptability/100) `[E]`; corner uptake `+0.1 × (adaptability − 50)/50` `[E]` on `MIS §7.7 CO-2` |

Generator priors `[E]`: mental attributes ~ N(50, 12) for T3, shifted +10 for T4 and +20 for T5 on `fightIQ`
and `composure`; T0–T1 `composure` ~ N(35, 12); `aggression` independent of tier.

### 2.6 Style (data schema)

```ts
type RangeBand = 'long' | 'mid' | 'short' | 'clinch' | 'ground';
type Initiative = 'pressure' | 'counter' | 'point' | 'balanced';
type PrimaryMode = 'distanceStriking' | 'pressureStriking' | 'wrestleControl' | 'clinchGrind' | 'counter'
  | 'submissionHunt';                                          // [S: MIS §6.2]
type HurtBehaviour = 'coverOnCage' | 'clinch' | 'shoot' | 'circleOut' | 'trade' | 'counter' | 'turnAway';
type LosingBehaviour = 'finishSeek' | 'stealRound' | 'unchanged' | 'shell' | 'gamble';
type TiredBehaviour = 'clinchRest' | 'coast' | 'gamble' | 'retreat';

interface StyleProfile {
  preferredRange: RangeBand;
  initiative: Initiative;
  pressureBias: number;              // 0 (pure counter) … 100 (pure pressure); 'point' = low commitment
  primaryMode: PrimaryMode;          // default plan mode; 07 may override per opponent
  fallbackMode: PrimaryMode;
  favouriteTechniques: Array<{ techId: string; weight: number }>;   // e.g. { techId: 'tech.jab', weight: 1.6 }
  combos: Array<{ id: string; sequence: string[]; weight: number }>; // e.g. ['tech.jab','tech.cross','tech.low_kick_rear']
  goToSubmissions: Array<{ subId: string; weight: number }>;        // e.g. 'sub.rnc'
  takedowns: { prefs: Array<{ techId: string; weight: number }>;
               setup: 'naked' | 'offSingleStrike' | 'offCombination' | 'offFeint' | 'reactive' | 'offClinch';
               cageBias: number };                                 // 0–1: preference to finish on the fence
  bottomPriority: Array<'standUp' | 'sweep' | 'submit'>;           // MMA default ['standUp','sweep','submit'] [S: BJJ §6]
  topPriority: Array<'control' | 'strike' | 'pass' | 'submit'>;
  hurtBehaviour: HurtBehaviour;      // default by tier (§3 beh.gen.hurt_*) if omitted
  losingBehaviour: LosingBehaviour;  // when behind on the fighter's own score estimate
  tiredBehaviour: TiredBehaviour;
  stanceSwitching: number;           // 0–100 propensity; requires stance 'switch' for full effect
  pacing: Array<{ round: number; outputMult: number; riskAppetite: number }>; // optional per-round override
  guardStyle?: 'highGuard' | 'philly' | 'longGuard' | 'peekaboo' | 'thai' | 'hybrid';  // [S: BOX §4 D9–D11]
  thaiStyle?: 'muayFemur' | 'muayKhao' | 'muayMat' | 'muayTae' | 'dutch';               // [S: MT §8 r23–24]
  gamePlanOverride?: GamePlan;       // full MIS §6.2 plan object; if present, 07 uses it verbatim
}
```

Defaults when a creator leaves fields blank: `preferredRange` from the best discipline (boxing → mid, MT/KB/karate/
TKD → long, wrestling/judo/sambo → clinch, bjj → ground) `[E]`; `initiative` from `aggression` (≥65 pressure,
≤35 counter, else balanced) `[E]`; `hurtBehaviour` by tier table §3; `bottomPriority` MMA default
`['standUp','sweep','submit']` `[S: BJJ §6 consensus (a)]`.

Style is descriptive, not prescriptive: it multiplies 07's action weights (`MIS §10 r22`: multiplicative,
renormalised, capped ×3 / floored ×0.25 `[S: MIS §10]`). A style that the fighter's sub-skills cannot support is
still selected but executed at the sub-skill's quality (this is how a T1 who "wants to be a counter striker" looks).

### 2.7 Derived composites

All composites are recomputed once per bout from effective (age-adjusted, career-adjusted) attributes. Ids are
the field names other sections reference.

#### 2.7.1 Mass and class

```
massIndex          = ln(fightNightKg / 77.1)                       // reference = welterweight limit [S: RJ §2.2]
classRefKg         = upper limit of weightClass × (1 + regainPct/100)
massVsClass        = ln(fightNightKg / classRefKg)                 // ≈ 0 within class; used cross-class
```

#### 2.7.2 Reach and range

```
effectiveReachM     = (reachM − 0.20 × heightM) / 2 + 0.10          // fist reach from stance: arm length + shoulder turn  [E]
effectiveKickReachM = legReachM + 0.15                              // hip rotation / lean                                  [E]
reachAdvCm          = (reachM_self − reachM_opp) × 100
reachLeverage       = by weightClass: FLW 0.15, BW 0.15, FW 0.2, LW 0.3, WW 0.5, MW 0.6, LHW 0.8, HW 1.0   [E]
```
`reachLeverage` scales every reach effect 02/07 apply, reproducing "steeper at heavier weights, ~0 at BW/FLW"
`[S: FD §4]` and the HW-only bout-level effect (winners +2.2 cm, r = 0.28) `[S: LIT_B §2.4]`. Reference
magnitudes for 02: +1.5 landed significant strikes per bout per cm at HW `[S: LIT_B §2.3]`; finishing-punch mix
shifts +1 pp toward straights per cm (cap ±20 cm) `[S: LIT_B §2.5]`; the bout-level win shift is ≈ +0.5 pp per
inch overall, cap +15 pp, ×1.5 standing-heavy, ×0 ground-heavy `[S: FD §4 E-on-S]` — that is a *calibration
target* for the emergent effect, not a term.

#### 2.7.3 Power index (force at impact, N)

```
techGate(s)   = 0.50 + 0.50 × (s / 100) ^ 0.8                       // s = gating sub-skill; 0→0.50, 55→0.79, 100→1.00  [D: Smith 2000 ratios 0.50 / 0.78 / 1.00, S: LIT_B §4.9]
physTerm      = (fightNightKg / 77.1) ^ 0.5 × (0.7 + 0.3 × strengthEff / 50) ^ 0.5 × (0.7 + 0.3 × explosivenessEff / 50) ^ 0.5   // [E]
handTerm      = 0.85 + 0.15 × handSpeedMs / 8.0                     // [E] (Dinu & Louis: elite = more force at higher velocity, S: LIT_B §4.10)

powerIndex.rearHand   = 4800 × techGate(max(boxing.power, kickboxing.punches, muayThai.hands)) × physTerm × handTerm
powerIndex.leadHand   = 0.59 × powerIndex.rearHand                  // [S: LIT_B §4.9] lead/rear ≈ 0.59 at every tier
powerIndex.hookMult   = 1.29                                        // [D: 4405 / 3427, S: DP §3.1]
powerIndex.rearKick   = 1400 × techGate(max(muayThai.kicks, kickboxing.kicks, 0.9 × taekwondo.kicks, 0.85 × karate.kicks)) × physTerm × (0.85 + 0.15 × kickSpeedMs / 6.5) × 3.4
                        // pad force 1,400 N expert MT [S: MT §7.1]; ×3.4 maps pad force onto the in-fight range (~1,850 N low kick in match context [S: MT §7.1 S4] … 14,000 N bag peaks [S: MT §7.1 S3]); factor [E]
powerIndex.leadKick   = 0.75 × powerIndex.rearKick                  // [E]
powerIndex.knee       = 1.5 × powerIndex.rearHand × powerIndex.hookMult   // knees ≈ 1.5× hook in alphaEq terms [S: DP §3.1]
powerIndex.elbow      = 1.0 × powerIndex.rearHand × powerIndex.hookMult   // elbows ≈ hooks [S: DP §3.1]
powerIndex.headKickAlphaMult = 1.75                                 // head kicks 1.5–2× hook [S: DP §3.1]; mid-point [E]
```

Worked values `[D]`: 77 kg, strength 50, explosiveness 50, handSpeed 50, boxing.power 5 (T0) → rear hand
4800 × 0.526 × 1.0 × 1.0 = 2,525 N (novice 2,381 N `[S: LIT_B §4.9]`); boxing.power 80, strength 75,
explosiveness 75, handSpeed 80 → 4800 × 0.918 × 1.15 × 1.024 = 5,190 N (elite 4,800 N `[S]`; the surplus is the
above-average physicals). 05 converts force to `alphaEq` (`DP §3.1`); 02 applies fatigue power loss (−12 % at
f = 0.5, `[S: DP §4.3]`).

#### 2.7.4 Grappling composites

```
grapplingStrength = clamp(strengthEff + 60 × massVsClass)                  // +7 pts per +10 kg at 77 kg [D: 60 × ln(87/77) = 7.3]; [E]
clinchPower       = 0.6 × grapplingStrength + 0.25 × explosivenessEff + 0.15 × balanceEff        // [E]; MIS §4.2 H-1 (+3 % fight-night mass → +5 % clinch control) is the target
sprawlSpeedMult   = 0.85 + 0.30 × explosivenessEff / 100                   // [E]; multiplies the reaction window in WR §9 r10
tdDefenceBase     = 0.5 × wrestling.takedownDefence + 0.2 × balanceEff + 0.15 × grapplingStrength + 0.15 × mmaIntegration.cageWork  // [E] the "defender skill" 03's logit reads
subAttack (SUB)   = 0.6 × bjj.subAttack + 0.2 × max(bjj.chokes, bjj.jointLocks, bjj.legLocks) + 0.2 × bjj.topControl   // [E]
subDefence (SUBDEF) = 0.7 × bjj.subDefence + 0.2 × bjj.escapes + 0.1 × mmaIntegration.subDefenceUnderStrikes         // [E]
```

#### 2.7.5 Chin, toughness, energy (05 inputs)

```
chinEff, chinZ = −(chinEff/100 − 0.5) × 2, kKOHistoryMult        // §2.4.3, [S: DP §3.2]
neckMult, bodyToughnessThresholdMult, recoveryHalfLifeMult        // §2.2.1
energy.pcrCapacity        = 100                                    // fixed [S: DP §4.1]
energy.pcrRefillHalfLifeS = 30 × (1.35 − 0.70 × cardioEff/100)     // 50→30 s [S: DP §4.1]; slope [E]; 80→23.7 s, 20→36.3 s
energy.lactateClearance   = 0.4 × (0.6 + 0.8 × cardioEff/100)      // mmol/L/min at rest; 0.3–0.5 [S: DP §4.1]; slope [E]
energy.breakRefillFrac    = 0.60 × (0.85 + 0.30 × recoveryEff/100) // 60 % of deficit [S: DP §4.4]; slope [E]
energy.actionCostMult     = grappling-tier multiplier from §3 beh.bjj.energy (1.6/1.3/1.1/1.0/0.9) [S: BJJ §6]
residualDehydration       // §2.4.4
```

#### 2.7.6 Anticipation (the expert edge)

Per domain `dom ∈ {striking, takedown, submission}` with `defSkill_dom` = striking: mean(boxing.headMovement,
boxing.guard, best of muayThai.checks / kickboxing.defence); takedown: wrestling.takedownDefence; submission:
subDefence.

```
readP_dom      = clamp(0.55 + 0.33 × defSkill_dom/100 + 0.03 × (fightIQ − 50)/50, 0.45, 0.92)
               // T0 (5) → 0.57, T2 (40) → 0.68, T3 (60) → 0.75, T4 (80) → 0.81, T5 (95) → 0.86  [S: LIT_B §4.1 bands novice 0.55–0.65 / intermediate 0.70–0.78 / expert 0.80–0.88]
cueLeadMs      = 100 × defSkill_dom/100                             // 0…100 ms earlier cue pickup vs telegraphed attacks [S: LIT_B §4.2 "50–100 ms"]
counterOnReadP = 0.05 + 0.45 × clamp((counterSkill − 10)/80, 0, 1)  // counterSkill = boxing.counters (striking), wrestling.chains (takedown), bjj.subAttack (submission); T0 0.05, T2 0.22, T4 0.44, T5 0.53 [S: LIT_B §4.4: 0.05 / 0.25 / 0.5]
feintBiteP     = 0.62 − 0.40 × defSkill_dom/100                     // T0 0.60, T2 0.46, T4 0.30, T5 0.24 [S: LIT_B §4.5: novice 0.6, expert 0.25]
anxietyReadPenalty = (0.16 − 0.11 × defSkill_dom/100) × 2 × (1 − composureEff/100)   // at composure 50: T0 −0.155, T4 −0.072 [S: LIT_B §4.3: −15 % novice, −5 % expert]; composure scaling [E]
fatigueRtMult  = 1 + 0.125 × f                                      // f = 05 fatigue index; RT +10–15 % under fatigue, read accuracy unchanged [S: LIT_B §4.7]
```

The **simple** reaction latency stays `reactionTimeMs` (§2.2.1) for every tier `[S: LIT_B §4.2]`. Reactive defence
against an attack is possible only if `execMs_attack + telegraphMs − cueLeadMs ≥ reactionTimeMs × fatigueRtMult`
(02's reaction gate, `BOX §8 r13`); otherwise only positional/anticipatory defence is available. This is what makes
a jab (≈140 ms delivery, `[S: BOX §2]`) unreactable at every tier while a telegraphed T0 haymaker
(`telegraphMod +0.25`, §2.7.8) is readable by a T3.

#### 2.7.7 Submission stubbornness and tap behaviour

```
stubbornnessBase = by subDefence: <20 → n/a (no_tap flag 0.40 [S: SUB §4]); 20–39 → 0.19; 40–79 → 0.11; ≥80 → 0.05   [S: SUB §4]
stubbornness     = clamp(stubbornnessBase × (0.5 + heart/100), 0.02, 0.5)                                            [E]
refusesToTap     = style trait (boolean) → stubbornness = max(stubbornness, 0.5)                                       [S: SUB §4 "refuses to tap" trait]
injuryHistoryTapEarly: if pro.subLosses ≥ 2 → stubbornness × 0.8                                                     [S: SUB §4 Hinz 2021 direction; factor E]
```

#### 2.7.8 Tier, execution and telegraph modifiers exported to 02/03

```
execTimeMult(tier)  = T0 1.50, T1 1.40, T2 1.25, T3 1.00, T4 0.90, T5 0.85       // kicks [S: MT §6]; punches use 0.5 + 0.5 × this [E]
telegraphMod(tier)  = T0 +0.25, T1 +0.20, T2 +0.15, T3 0, T4 −0.05, T5 −0.10      // added to the defender's read probability [S: MT §6]
hipRotationMult     = T0 0.50, T1 0.60, T2 0.75, T3 1.00, T4 1.05, T5 1.10         // kick power [S: MT §6]; punches use techGate instead
paceAgeMult, experience, stanceFamiliarity, composureEff                           // §2.2.2, §2.4
```

---

## 3. Behaviour by skill tier — THE TIER BEHAVIOUR CATALOGUE

This is the Phase-5 contract between the fighter model, the AI (07), the resolution sections (02–05) and the
presentation layer (08). Every row is a rule the engine implements as data:

```ts
interface TierBehaviourRule {
  id: string;                       // beh.<domain>.<name>
  domain: 'gen' | 'box' | 'mt' | 'wr' | 'ju' | 'bjj' | 'sub' | 'mma';
  tierKey: 'boxing' | 'muayThai' | 'kickboxing' | 'wrestling' | 'judo' | 'bjj' | 'subDefence' | 'subAttack'
         | 'mmaTier' | 'iqTier' | 'strikingTier' | 'grapplingTier' | 'experience';   // which tier the rule keys on
  tiers: [min: number, max: number];// inclusive T-range (or band range for subDefence/subAttack)
  trigger: string;                  // engine predicate id (07 evaluates); 'always' allowed
  effects: Array<
    | { kind: 'weight'; action: string; mult: number }                 // ⊗ decision weight on an action / family
    | { kind: 'exec'; param: string; add?: number; mult?: number }     // ⊕ execution-quality modifier
    | { kind: 'prob'; param: string; value: number }                   // P(...) used by the resolution
    | { kind: 'anim'; tag: string }                                    // ▶ animation set / overlay
    | { kind: 'repertoire'; add?: string[]; remove?: string[] }        // technique availability
  >;
  tag: string;                      // provenance
}
```

Notation in the tables: `⊗ w(x)×k` decision weight; `⊕` execution modifier; `P(...)` probability; `▶` animation
tag (listed in §3.9). "Tier" is the tier of the **discipline the rule belongs to** (§2.3.4); rows that key on
`iqTier`, `mmaTier`, `subDefence` say so. Where a research file's tier vocabulary differs, the mapping of §2.3.4
was used. Rows tagged `[E]` inside a `[S]` row carry the research direction with a design-chosen magnitude.

Core principle restated for implementers: **no rule in this catalogue changes `reactionTimeMs`.** Tiers change
`readP`, `cueLeadMs`, `counterOnReadP`, `feintBiteP`, telegraph, execution time, repertoire, energy cost and
decision weights `[S: LIT_B §4.1, §4.2]`.

### 3.0 General: perception, arousal, fatigue, hurt behaviour (`beh.gen.*`)

| id | tiers (key) | trigger | effect | tag |
|---|---|---|---|---|
| `beh.gen.read` | all (domain defence skill) | opponent initiates a technique | `P(read) = readP_dom` (§2.7.6). Read → reactive defence/counter allowed; no read → positional defence only | `[S: LIT_B §4.1]` |
| `beh.gen.simple_rt_untiered` | all | always | latency = `reactionTimeMs × fatigueRtMult`; **no tier term** | `[S: LIT_B §4.2]` |
| `beh.gen.cue_lead` | T2–T5 (defence skill) | opponent in wind-up / telegraph phase | ⊕ effective latency −`cueLeadMs` (0–100 ms) | `[S: LIT_B §4.2]` |
| `beh.gen.reflex_defensive` | T0–T1 (defence skill) | read succeeded | ⊗ w(cover, step back)×3, w(counter)×0.2 → `counterOnReadP ≈ 0.05`; ▶ `anim.flinch_cover` | `[S: LIT_B §4.4]` |
| `beh.gen.reflex_counter` | T4–T5 (counters skill) | read succeeded | counter fires with `counterOnReadP` (≈0.45–0.53); ▶ `anim.counter_slot` | `[S: LIT_B §4.4]` |
| `beh.gen.feint_bite` | all (defence skill) | opponent feints | `P(bite) = feintBiteP` (T0 0.60 … T5 0.24); bite commits a defensive action (guard shift / step / check) and grants the attacker 02's setup bonus | `[S: LIT_B §4.5]` |
| `beh.gen.anxiety_gaze` | T0–T3 (defence skill) | first 60 s of R1; 20 s after being hurt; behind in final round; hostile crowd | ⊕ `readP −= anxietyReadPenalty` (T0 ≈ −0.155, T4 ≈ −0.07 at composure 50); ▶ `anim.gaze_scatter` (T0–T1 only) | `[S: LIT_B §4.3]`; triggers `[E]` |
| `beh.gen.fatigue_rt` | all | `f > 0.4` | ⊕ latency ×`(1 + 0.125 f)`; `readP` unchanged (experts' defensive edge compresses late) | `[S: LIT_B §4.7]` |
| `beh.gen.eyes_close` | T0 (striking tier) | incoming power strike | P = 0.70: `readP = 0` for the exchange, absorb −0.15; ▶ `anim.eyes_shut_flinch` | `[S: BOX §8 r31]` (−0.15); P `[E]` |
| `beh.gen.eyes_close_t1` | T1 (striking tier) | incoming power strike inside an exchange | P = 0.30, same effect | `[E]` |
| `beh.gen.turn_away` | T0 (striking tier) | hit clean, or ≥3 strikes absorbed in 2 s | P = 0.50: turns side/back; absorb 0 for follow-ups; back-of-head exposure (attacker foul roll, 06); ▶ `anim.turn_away_cover` | `[S: BOX §6]`; P `[E]` |
| `beh.gen.hands_drop_tired` | T0–T1 at `f > 0.45`; T2 at `f > 0.6`; T3+ at `f > 0.75` | fatigue threshold | ⊕ guard height −30 % (T0–T1), −15 % (T2+); ▶ `anim.guard_low_mouth_open`, `anim.feet_flat` | `[S: BOX §6]`; thresholds `[E]` |
| `beh.gen.adrenaline_dump` | `experience < 0.5` | R1, first 150 s | `dump = (1 − experience)(1 − composureEff/100) × eventMagnitude`; costs ×(1 + 0.6 dump), decision −20 % dump, output +15 % dump for 45 s then −25 % dump | `[S: DP §4.6]` |
| `beh.gen.t0_burst_collapse` | T0 (striking tier) | any engagement | output bursts 15–25 attempts/min for ≤20 s, then output ×0.4; energy costs ×1.8 | `[S: FD §5]`; ×0.4/×1.8 `[E]` |
| `beh.gen.panic_flurry` | T0–T1 (striking tier) | opponent rushes, or own `acuteHead ≥ 30` | ⊗ w(wild swing)×3, w(defence)×0.5; costs ×2; ▶ `anim.windmill` | `[S: MIS §7.5 D-3]` pattern; values `[E]` |
| `beh.gen.hurt_t0` | T0 (mmaTier) | rocked | `hurtBehaviour = 'turnAway'`: ⊗ w(cover)×2, w(turn away) per `beh.gen.turn_away`; backs straight to fence | `[S: MIS §8]` |
| `beh.gen.hurt_t1` | T1 (mmaTier) | rocked | `'coverOnCage'`: ⊗ w(cover)×2, w(retreat straight)×2 | `[S: MIS §8]` |
| `beh.gen.hurt_t2` | T2 (mmaTier) | rocked | `'clinch'` ×2 | `[S: MIS §8]` |
| `beh.gen.hurt_t3` | T3 (mmaTier) | rocked | `'clinch'` or `'shoot'` ×2 (shoot if wrestling tier ≥ T3) | `[S: MIS §8]` |
| `beh.gen.hurt_t4` | T4 (mmaTier) | rocked | `'clinch'` or `'circleOut'` ×2 (`circleOut` if boxing.footwork ≥ 60) | `[S: MIS §8]` |
| `beh.gen.hurt_t5` | T5 (mmaTier) | rocked | `'counter'`: ⊗ w(counter)×1.5; rocked decision penalty ×0.7 of the 05 value | `[S: MIS §8]`; ×0.7 `[E]` |
| `beh.gen.hurt_behaviour_duration` | all | rocked | chosen behaviour persists 10–20 s with `effectiveIQ −1` | `[S: MIS §7.5 D-1]` |
| `beh.gen.pacing_t0` | T0 (striking tier) | R1 | pace target ×1.5 for 60 s; no reserve; see `t0_burst_collapse` | `[S: BOX §6]` |
| `beh.gen.pacing_t1` | T1 | R2+ | output ×0.70 in R2, ×0.55 in R3 unless `cardioEff ≥ 70` | `[S: BOX §6]`, R3/R1 0.70 `[S: FD §5]`; R2 `[E]` |
| `beh.gen.pacing_t2` | T2 | all rounds | R3/R1 ≈ 0.80 | `[S: FD §5]` |
| `beh.gen.pacing_t3` | T3 | all | R3/R1 ≈ 0.85; corner-driven pace changes | `[S: FD §5]`, `[S: BOX §6]` |
| `beh.gen.pacing_t4` | T4–T5 | all | R3/R1 ≈ 0.85–0.90; late surge when own score estimate says behind (T5 adjusts pace to score) | `[S: FD §5]`, `[S: BOX §6]` |
| `beh.gen.compose_sell` | T3–T5 (striking tier) | hit by a strike of power tier < 4 | no hit-reaction animation; judges' visible-damage cue suppressed | `[S: MT §6]`, `[S: MT §8 r24]` |
| `beh.gen.show_pain` | T0–T1 (striking tier) | any clean hit | ▶ `anim.hit_react_big`; visible-damage judge cue ×1.5 | `[S: MT §6]`; ×1.5 `[E]` |
| `beh.gen.score_awareness` | iqTier 1–5 | round end / final 60 s | score-estimate σ: none / corner-only / 0.5 / 0.3 / 0.2 (rounds) | `[S: MIS §8]` |
| `beh.gen.corner_uptake` | iqTier 1–5 | round break | 0.5 / 0.6 / 0.7 / 0.8 / 0.9, +adaptability term (§2.5) | `[S: MIS §8]` |
| `beh.gen.adapt_cadence` | iqTier 1–5 | in-round | `T_eval` never / 90 / 60 / 30 / 20 s; `P(change|signal)` 0.3 / 0.5 / 0.7 / 0.85 / 0.95 × adaptability term; dwell — / 45 / 30 / 20 / 15 s | `[S: MIS §7.3]` |
| `beh.gen.plan_abandon` | all (discipline attr) | hit clean ≥ 2 in 10 s | `P = 0.6 × (1 − discipline/100)`: plan weights off, `favouriteTechniques` ×2 (fights on instinct) | `[E]`; failure mode `[S: MIS §7.8 (3)]` |
| `beh.gen.second_wind` | all | `f` from > 0.7 to < 0.55 via ≥ 40 s low intensity | +10 % output / decision quality for 60 s | `[S: DP §4.5]` |
| `beh.gen.finisher_reckless` | iqTier ≤ 2, or `aggression ≥ 75` | opponent hurt | ⊗ w(swing)×2, defence ×0.5, drain ×2 | `[S: MIS §7.5 D-3]`; aggression gate `[E]` |
| `beh.gen.finisher_measured` | iqTier ≥ 3 | opponent hurt | ⊗ straights/knees ×1.5, keep balance ≥ 60 %, cut the cage; stop if hit-rate < 40 % over 8 attempts | `[S: MIS §7.5 D-3]` |
| `beh.gen.stance_familiarity` | all | opponent stance with `stanceFamiliarity < 1` | ST-5 penalties × `(1 − familiarity)` (§2.4.4) | `[S: MIS §5.1]` |
| `beh.gen.t0_grab_push` | T0 (mmaTier and wrestling) | opponent within 0.5 m | ⊗ w(grab / push / headlock)×3 over strikes; ▶ `anim.grab_push`, `anim.headlock_pull` | `[S: FD §6]` pattern; ×3 `[E]` |
| `beh.gen.t0_fall_together` | T0 vs T0 (grappling tier) | clinch > 3 s | P(both fall) 0.35 per 5 s; landing position random (top/bottom 50/50) | `[E]`; `[S: FD §5 "who hits the ground"]` |
| `beh.gen.t0_no_guard_when_grabbed` | T0 (mmaTier) | grabbed / clinched | hands stop guarding: head absorb 0 vs clinch strikes; ▶ `anim.clinch_hands_busy` | `[E]` |
| `beh.gen.crowd_mode_size` | T0 vs T0 | open-weight | size dominates: 03/02 mass terms unmodified, but `readP` for both floors at 0.45 (no anticipation on either side) | `[S: FD §5 rule (4)]`; floor `[E]` |

### 3.1 Boxing (`beh.box.*`, tier = boxing tier)

| id | tiers | trigger | effect | tag |
|---|---|---|---|---|
| `beh.box.square_stance` | T0 | standing | ⊕ stance squareness 0.8, weight on heels, chin up: P(hit lands on chin/jaw sub-location) +0.15; takedown vulnerability +20 %; ▶ `anim.stance_square_heels` | `[S: BOX §6]`; values `[E]` |
| `beh.box.cross_feet` | T0–T1 | lateral movement | P(feet cross per step) 0.40 / 0.15; while crossed: balance −40 %, punch power ×0.5, P(stumble on contact) 0.3; ▶ `anim.step_cross` | `[S: BOX §6]`; P `[E]` |
| `beh.box.chin_up_mouth_open` | T0 always; T1 at `f > 0.5` | — | 05's "relaxed/mouth open" ×1.2 on alphaEq permanently on; ▶ `anim.chin_up` | `[S: DP §3.2]`, `[S: BOX §6]` |
| `beh.box.hands_at_chest` | T0 | guard posture | ⊕ guard height −40 %: head absorb (blocked) 0.5 → 0.2; ▶ `anim.guard_chest` | `[S: BOX §6]`; 0.2 `[E]` |
| `beh.box.arm_punch` | T0 | any punch | `techGate ≈ 0.50`; elbows flare; wide loops: hook telegraph +0.25; ▶ `anim.punch_arm_only` | `[S: LIT_B §4.9]`, `[S: BOX §6]` |
| `beh.box.fist_drop_telegraph` | T0–T1 | before each punch | telegraph +0.25 (T0) / +0.15 (T1); ▶ `anim.fist_drop_windup` | `[S: BOX §6]`; values `[S: MT §6 telegraph]` |
| `beh.box.overcommit` | T0–T1 | power punch | commitment cost +2 (T0) / +1 (T1); on miss P(stumble) 0.35 / 0.15; counter window ×2; ▶ `anim.overreach` | `[S: BOX §6]`; stumble P `[S: MT §6]` |
| `beh.box.repertoire_t0` | T0 | — | available: `{1, 2, wild 1-2-3, high guard, back-straight-up}`; combo accuracy ×0.6 per punch after the first; no feints, no counters | `[S: BOX §8 r31]`; decay `[E]` |
| `beh.box.repertoire_t1` | T1 | — | + `{3, 4, 5/6 (accuracy ×0.7), 1-2, 1-2-3, block, one slip direction}` | `[S: BOX §8 r31]` |
| `beh.box.repertoire_t2` | T2 | — | + `{all punches, body work, parry/catch/slip/roll (one direction well), 1 feint type, basic counters, pivot}` | `[S: BOX §8 r31]` |
| `beh.box.repertoire_t3` | T3 | — | + `{check hook, shoulder roll (if guardStyle = philly), set-up chains, ring cutting, L-step, pull counter}` | `[S: BOX §8 r31]` |
| `beh.box.repertoire_t4` | T4 | — | + `{delayed counters, rhythm breaking, layered feints, per-round adaptation}` | `[S: BOX §8 r31]` |
| `beh.box.repertoire_t5` | T5 | — | + `{within-exchange adaptation, style switch}`; opponent-tendency noise σ → 5 % by end of R2 ("reads inside 1–2 rounds") | `[S: BOX §8 r31]`, `[S: BOX §6]` |
| `beh.box.high_guard_only` | T1 | incoming punch read | defence choice = high guard 90 %; when slipping, P(wrong direction) 0.30 → eats the punch at ×1.2 damage | `[S: BOX §6]`; ×1.2 `[E]` |
| `beh.box.hands_drop_after_punch` | T1 | after every punch | ⊕ guard −25 % for 300 ms; opponent counter window ×1.5 | `[S: BOX §6]`; values `[E]` |
| `beh.box.backs_straight_up` | T0–T1 | under pressure | ⊗ w(retreat straight)×3, w(circle)×0.3; ▶ `anim.retreat_straight` | `[S: BOX §6]`, `[S: MIS §8]` |
| `beh.box.rear_hand_home` | T2 | jabbing | rear hand stays in guard: absorb vs opponent lead hook +0.2 | `[S: BOX §6]`; +0.2 `[E]` |
| `beh.box.one_direction_slip` | T2 | slipping | slips to one side only; opponent gets 02's setup bonus after observing 3 slips | `[S: BOX §6]` |
| `beh.box.holds_stance` | T2 | — | squareness 0.2; small pivots; stance breaks only when hit or `f > 0.7` | `[S: BOX §6]` |
| `beh.box.hip_rotation_appears` | T1+ | punches | `techGate` from `power`; T1 still `overcommit` | `[S: BOX §6]`, `[S: LIT_B §4.10]` |
| `beh.box.volume_target` | by tier | pro-length round | thrown/round: T0 20–35 (wild), T1 35–50, T2 45–60, T3 50–60, T4 40–70 (style), T5 style-dependent; MMA rulesets scale to 02's per-minute targets | `[S: BOX §6]` |
| `beh.box.accuracy_reference` | by tier | equal-tier reference | power/jab landed: T0 ≈15/10 %, T1 25/12, T2 30/15, T3 35/18, T4 40–48/20–25, T5 45–50 power | `[S: BOX §6]` (T0 `[E]` there) |
| `beh.box.defence_reference` | by tier | equal-tier reference | opponent connect %: T0 45–55, T1 40, T2 33, T3 29, T4 20–25, T5 < 20 | `[S: BOX §6]` |
| `beh.box.block_counter` | T2–T5 | successful block/parry | counter available with `P = counterOnReadP`; T0–T1 ≈ 0 (novice winners 2.8 vs losers 0.1 block-counters/bout) | `[S: LIT_B §5.1]` |
| `beh.box.angles` | T3–T5 | after an exchange | ⊗ w(pivot / L-step) ×1.5 (T3), ×2 (T4+); T4+ controls lead foot vs southpaw (`MIS §5.1 ST-1`) | `[S: BOX §6]`; multipliers `[E]` |
| `beh.box.economy_inside` | T3–T5 | short range | short punches: exec ×0.85, commitment −1 | `[S: BOX §6]`; values `[E]` |
| `beh.box.feint_layering` | T4–T5 | setting up a power shot | ≥ 2 feints precede; sell quality = `feints`; opponent's `feintBiteP` applies each | `[S: BOX §6]` |
| `beh.box.delayed_counter` | T4–T5 | opponent's combination ends | half-beat counter: accuracy +0.10 | `[S: BOX §6]`; +0.10 `[E]` |
| `beh.box.pull_counter` | T3 (unreliable) / T4+ | opponent jabs or crosses | available if `headMovement ≥ 55`; T3 executes at 0.7 quality | `[S: BOX §8 r31]`; gate `[E]` |
| `beh.box.body_work` | T2+ / T0–T1 | opponent guard high or on fence | ⊗ w(body punches) ×1.3 (T2+); ×0.3 (T0–T1 head-hunt) | `[S: BOX §6]`; multipliers `[E]` |
| `beh.box.ring_cutting` | T3–T5 / T0–T1 | opponent circles | `ringCraft` gates cut-off stepping; T0–T1 chase straight (⊗ w(advance straight) ×2) | `[S: BOX §6]`, `[S: MIS §8]` |
| `beh.box.reads_adapt` | by tier | — | T0 none; T1 responds only to being hit; T2 sticks to plan; T3 corner-driven; T4 self-adjusts per round; T5 within exchanges | `[S: BOX §6]` |
| `beh.box.guard_style_gate` | T3+ | `guardStyle = philly` | shoulder roll at 0.65 quality only if `guard ≥ 55 ∧ headMovement ≥ 55`, else amateur 0.40 version | `[S: BOX §4 D9]`; gate `[E]` |
| `beh.box.eyes_on_torso` | T2–T5 | exchange | no flinch flag; fixation on chest/shoulders → `readP` as computed (fewer fixations) | `[S: LIT_B §4.1]` |
| `beh.box.lead_hand_use` | T2+ | R1 | winners throw more lead-hand punches (34.2 vs 26.5 in R1 at novice level): ⊗ w(jab) ×1.2 for T2+ vs T0–T1 ×0.8 | `[S: LIT_B §5.1]`; multipliers `[E]` |

### 3.2 Muay Thai and kickboxing (`beh.mt.*`, tier = muayThai or kickboxing tier of the technique's source)

| id | tiers | trigger | effect | tag |
|---|---|---|---|---|
| `beh.mt.kick_exec_time` | all | kick | ⊕ exec × `execTimeMult` (1.50 / 1.40 / 1.25 / 1.00 / 0.90 / 0.85) | `[S: MT §6]` |
| `beh.mt.kick_telegraph` | all | kick | ⊕ defender read + `telegraphMod` (+0.25 … −0.10); T0 lean-back wind-up ▶ `anim.kick_windup_leanback` | `[S: MT §6]` |
| `beh.mt.hip_rotation` | all | round kick | ⊕ power × `hipRotationMult` (0.50 … 1.10); T0–T1 kick with foot/instep ▶ `anim.kick_instep`, self-injury (foot) P ×3 | `[S: MT §6]`, `[S: MT §2 S1]`; ×3 `[E]` |
| `beh.mt.balance_after_kick` | all | kick misses / is checked | P(fall or stumble) miss/checked: T0–T1 0.35/0.45, T2 0.15/0.25, T3 0.05/0.10, T4 0.03/0.06, T5 0.02/0.04; × `balanceStumbleMult` | `[S: MT §6]` |
| `beh.mt.no_return_to_stance` | T0–T1 | after any kick | P 0.60 (T0) / 0.30 (T1): stays square, hands down → counter window ×2; ▶ `anim.kick_no_reset` | `[S: MT §6]` (×2); P `[E]` |
| `beh.mt.check_rate` | all | incoming low kick read | P(attempt check): T0 < 0.10, T1 0.10, T2 0.25, T3 0.50, T4 0.60, T5 0.70 (+ reads feints) | `[S: MT §6]` |
| `beh.mt.kick_selection` | by tier | — | T0–T1 rear low/body only, no teep, no switch; T2 + teep, switch kick; T3 full catalogue; T4 + question-mark, spinning; T5 + deception layers | `[S: MT §6]` |
| `beh.mt.catch_behaviour` | by tier | body kick caught | T0–T1: attempts on anything (⊗ w(catch)×2, success ×0.5, punched during catch P 0.4); T2 catches, no follow-up; T3 catch → sweep/knee; T4 chooses counter by opponent's balance; T5 catches and dumps, baits kicks | `[S: MT §6]`; T0 values `[E]` |
| `beh.mt.clinch_behaviour` | by tier | clinch | T0–T1 grabs the neck, pulls, gets turned (P 0.6) ▶ `anim.neck_grab_pull`; T2 basic plum, snap-down; T3 frame, swim, turn; T4 positional cycling; T5 controls exchanges, off-balances at will | `[S: MT §6]`; P `[E]` |
| `beh.mt.compose_scoring` | by tier | hit | T0–T1 reacts to every hit (`beh.gen.show_pain`); T2 some; T3 neutral; T4 sells composure, walks off kicks; T5 manipulates judges, stalls last round when ahead (Thai rules) | `[S: MT §6]` |
| `beh.mt.fatigue_kicking` | by tier | fatigue | kick weight: T0–T1 ×0.2 once `f > 0.5` ("stops kicking by R2"); T2 by R3; T3 ≈ 80 % by R5; T4 ≈ 90 %; T5 ≈ 95 % | `[S: MT §6]` |
| `beh.mt.dutch_gating` | `thaiStyle = dutch` | low kick | 60 % of low kicks follow a punch combination (+0.10 accuracy, −0.15 telegraph) | `[S: MT §8 r23]` |
| `beh.mt.thai_style` | `thaiStyle ∈ {muayFemur, muayKhao, muayMat, muayTae}` | Thai ruleset | body kicks / clinch knees / teeps preferred; minimal punching for score; coasts R5 if ahead | `[S: MT §8 r24]` |
| `beh.mt.lean_back_t0` | T0 | any kick | torso lean ≥ 20°: head kick unavailable; body-kick range −0.10 m | `[E]` |
| `beh.mt.head_kick_gate` | all | head kick | available only if `flexibility ≥ 40 ∧ (kicks ≥ 30 ∨ taekwondo.headKicks ≥ 30)`; quality × `flexKickQualityMult` | `[E]` |
| `beh.mt.teep_usage` | T2+ | opponent advancing | ⊗ w(teep) × (1 + teep/100); T0–T1 no teep | `[S: MT §6]`; multiplier `[E]` |
| `beh.mt.spinning_gate` | T4+ (or `taekwondo.spinning ≥ 50`) | opponent square / after setup | spinning techniques available | `[S: MT §6]` |
| `beh.mt.shin_conditioning` | by tier | own kick checked | attacker's share of checked-kick damage: ×1.3 (T0–T1), ×1.0 (T2), ×0.8 (T3+) on 05's 60 % base | `[S: DP §2.3]` base; multipliers `[E]` |
| `beh.mt.elbow_availability` | T2+ (muayThai) | short range / clinch | elbows available; T0–T1 `w(elbow) = 0` | `[E]` |
| `beh.mt.knee_availability` | T1+ (muayThai) | clinch | curved knees T1+, straight/long knees T2+ | `[E]` |
| `beh.mt.question_mark_setup` | T4+ | ≥ 2 prior low kicks/teeps landed | question-mark kick accuracy 0.15 → 0.35 | `[S: MT §2 K6]` |
| `beh.mt.calf_kick_targeting` | T2+ | opponent square / front-heavy | ⊗ w(calf kick) ×1.5 vs `squareness > 0.5` | `[S: MT §2 K7]`; ×1.5 `[E]` |
| `beh.mt.kb_winner_profile` | T3+ (kickboxing) | — | ⊗ hooks ×1.2, punch combinations ×1.2, foot defence and clinch ×1.2 (winners' profile) | `[S: LIT_B §5.5]`; multipliers `[E]` |

### 3.3 Wrestling (`beh.wr.*`, tier = wrestling tier)

| id | tiers | trigger | effect | tag |
|---|---|---|---|---|
| `beh.wr.no_level_change` | T0–T1 | shot | bends at waist, reaches with arms: shot success −20 pp; eats a counter strike 30 % of shots; ▶ `anim.shot_bent_waist` | `[S: WR §7]` |
| `beh.wr.level_change_rate` | T2 / T3 / T4+ | shot | proper level change 60 % / 90 % / always (feinted, mixed with strikes: level-change uppercut, jab-to-double) | `[S: WR §7]` |
| `beh.wr.head_position` | T0–T1 / T2 / T3 / T4+ | shot | head down-outside-low: guillotine catch window ×2.5 / correct 60 % / 85 % / correct | `[S: WR §7]` |
| `beh.wr.sprawl_late` | T0–T1 | opponent shoots | sprawl reaction ≥ 0.6 s (fires only if shot exec ≥ 600 ms); denies ≈ 20 % | `[S: WR §7]` |
| `beh.wr.sprawl_rate` | T2 / T3 / T4+ | shot on self | denies ≈ 50 % / 65–75 % / 80–90 % (elite examples 91–93 %) | `[S: WR §7]` |
| `beh.wr.chain_after_stall` | by tier | shot stalled in sprawl | P(re-attack / chain): T0–T1 0.15 (stalls in `SPRAWL_TOP`), T2 0.40, T3 0.65, T4–T5 0.80–0.90; each chain step retains full base % | `[S: WR §7]` |
| `beh.wr.timing_shots` | by tier | opponent commits a strike | reactive shots: T0–T1 never; T2 10 % of shots; T3 30 %; T4+ ≥ 50 % reactive/setup (reactive +15 pp) | `[S: WR §7]` |
| `beh.wr.finish_selection` | by tier | shot in on legs | T0–T1 one finish (drive), repeats it; T2 two; T3 3–4, switches on whizzer; T4+ full tree, takes what the defence gives | `[S: WR §7]` |
| `beh.wr.cage_use` | by tier | open-mat stall | T0–T1 never drives to fence (loses `SINGLE_LEG_IN` to hops/limp leg); T2 50 %; T3 75 %; T4+ 90 % | `[S: WR §7]` |
| `beh.wr.bottom_turns_away` | T0–T1 | bottom stand-up attempt | turns away: 30 % of attempts cost `BACK_CONTROL`; ▶ `anim.turn_to_knees_back_exposed` | `[S: WR §7]` |
| `beh.wr.standup_rate` | T2 / T3 / T4+ | bottom stand-up attempt | technical stand-up 25 % / wall walk + kimura grip 35 % / 45–55 %, rarely gives back | `[S: WR §7]` |
| `beh.wr.energy` | T0–T1 / T4+ | shot | shoots from far: 2× energy per attempt / attempts per landed TD ≈ 1.6 (population 2.5) | `[S: WR §7]` |
| `beh.wr.ride_retention` | by tier | after a takedown | loses position within 30 s: T0–T1 55 %, T2 40 %, T3 25 %, T4+ 15 % | `[S: WR §7]` |
| `beh.wr.setup_class` | iqTier 1–5 | shot decision | naked / off single strike / off combinations / off feints & reactions / off tendencies | `[S: MIS §8]` |
| `beh.wr.background_offsets` | style tag | — | freestyle / folkstyle / greco / judo-sambo / bjj-only offsets on effective sub-skills | `[S: WR §7]` |
| `beh.wr.t0_tackle` | T0 | grappling urge | head-down football tackle: success 20–30 % vs another T0 (no sprawl), ≈ 5 % vs T2+ (eats guillotine / knee) | `[S: FD §5]`; vs T2+ `[E]` |
| `beh.wr.stall_in_sprawl` | T0–T1 | sprawled on | stays head-down in `SPRAWL_TOP`; opponent's guillotine / D'arce entry weight ×2 | `[S: WR §7]`; ×2 `[E]` |
| `beh.wr.underhook_pummel` | T3+ / T0–T1 | clinch | ⊗ w(pummel for underhooks) ×1.5 / T0–T1 ⊗ w(headlock, over-hook squeeze) ×2 | `[E]`; `[S: JU §6 MMA specifics]` |
| `beh.wr.tired_defence` | all | fatigue | TDD −15 % at `f = 0.5`, −35 % at `f = 0.8` | `[S: DP §4.3]` |
| `beh.wr.control_time_target` | T4+ | after takedown | expected control ≈ 100 s per takedown (winners) vs 79 s (losers) — emerges from `ride_retention`; calibration check | `[S: LIT_B §2.14]` |

### 3.4 Judo (`beh.ju.*`, tier = judo tier)

| id | tiers | trigger | effect | tag |
|---|---|---|---|---|
| `beh.ju.posture_t0` | T0–T1 | grip / clinch | stiff arms, bent forward, head down, weight on toes: opponent's snap-down / koshi-guruma / sumi-gaeshi ⊗ ×1.5; collar tie & arm drag +15 pp; ▶ `anim.judo_stiff_arm_bent` | `[S: JU §6]`; values `[E]` |
| `beh.ju.grip_t0` | T0–T1 | grip exchange | grabs whatever is offered, never breaks grips: opponent dominant grip P 0.75 | `[S: JU §6]`; P `[E]` |
| `beh.ju.grip_t2` | T2–T3 | grip exchange | breaks grips; preferred grip ≈ 50 % of exchanges; over-relies on one grip (readable after 3 exchanges) | `[S: JU §6]` |
| `beh.ju.grip_t4` | T4–T5 | grip exchange | wins grip 65–70 % vs intermediate; varies tsurite; dictates ai/kenka-yotsu | `[S: JU §6]` |
| `beh.ju.kuzushi_t0` | T0–T1 | throw attempt | no kuzushi; throws from the arms; P(throws himself) 0.30; mirror counters / tani otoshi succeed > 50 % | `[S: JU §6]`; 0.30 `[E]` |
| `beh.ju.kuzushi_t2` | T2–T3 | throw | one-direction kuzushi, telegraphed (+0.15 read) | `[S: JU §6]`; +0.15 `[E]` |
| `beh.ju.kuzushi_t4` | T4–T5 | throw | multi-directional; action–reaction 34.8 % of attacks; uses uke's step | `[S: JU §6]`, `[S: JU §7.4]` |
| `beh.ju.attack_pattern` | by tier | — | T0–T1 single telegraphed attempts in one direction; T2–T3 2 directions, occasional combination; T4–T5 3–4 directions, chains (ko-uchi → uchi-mata, o-uchi → uchi-mata, seoi → ko-uchi), counters ready | `[S: JU §6]` |
| `beh.ju.attack_rate` | by tier | per judo match | 1–3 real attempts (many false attacks) / 4–6 / 6–9 | `[S: JU §6]`, `[S: JU §7.2]` |
| `beh.ju.failure_mode` | by tier | failed throw | T0–T1 thrown by own momentum; after a failed drop seoi falls to knees → pinned / back taken (P 0.5); T2–T3 grip lost, resets; T4–T5 clean reset, keeps grip, countered ≈ 3 % of attempts | `[S: JU §6]`; P 0.5 `[E]` |
| `beh.ju.defence_posture` | by tier | opponent attacks | T0–T1 stiff-arms, bends forward, retreats; T2–T3 hips back, arm block, can be pulled; T4–T5 hips in, head up, steps around | `[S: JU §6]` |
| `beh.ju.mma_t0` | T0–T1 | MMA clinch | clinch-shy, arms extended → easy collar tie / arm drag; falls into guard on any trip | `[S: JU §6]` |
| `beh.ju.mma_t2` | T2–T3 | MMA clinch | knows under/over-hook but gives up the body lock | `[S: JU §6]` |
| `beh.ju.mma_t4` | T4–T5 | MMA clinch | pummels for inside position; uses strikes as kuzushi; times uke's shot or punch | `[S: JU §6]` |
| `beh.ju.tier_mult` | cross-tier | throw resolution | novice vs elite: elite success ×2.5 (cap 75 %), novice ×0.25; counter-launch novice ×0.3, elite ×1.5 (vs intermediate) | `[S: JU §6]` |
| `beh.ju.ukemi` | by tier (`ukemi`) | being thrown | `ukemi < 30`: lands flat (+10 acute body, 05) ▶ `anim.fall_flat`; 30–70 lands on side; ≥ 70 lands in guard / turtles to base ▶ `anim.breakfall` | `[E]` |

### 3.5 BJJ and ground positional play (`beh.bjj.*`, tier = bjj tier)

| id | tiers | trigger | effect | tag |
|---|---|---|---|---|
| `beh.bjj.bottom_t0` | T0 | on bottom | flat on back; closed guard only by luck; turns to belly under strikes 90 % (E4); straight-arm push from mount bottom (armbar exposure ×3); ▶ `anim.mount_bottom_straight_arm`, `anim.turtle_panic` | `[S: BJJ §6]` |
| `beh.bjj.bottom_t1` | T1 | on bottom | closed guard, holds and stalls (referee stand-ups); hip escape known but slow (duration ×1.5) | `[S: BJJ §6]` |
| `beh.bjj.bottom_t2` | T2–T3 | on bottom | half-guard game: knee shield, underhook, dogfight; some butterfly; wall walks | `[S: BJJ §6]` |
| `beh.bjj.bottom_t4` | T4 | on bottom | full guard retention; butterfly / SLX entries; wrestle-ups; leg-lock threats deter passes; cage-savvy | `[S: BJJ §6]` |
| `beh.bjj.bottom_t5` | T5 | on bottom | never flat; chains sweep → sub → get-up; wrestle-ups from every seated guard; uses strikes' openings (upa on posts) | `[S: BJJ §6]` |
| `beh.bjj.top_t0` | T0 | on top | lies in guard, punches wildly, posts hands (opponent upa +20 pp); swept from mount by upa 2× | `[S: BJJ §6]` |
| `beh.bjj.top_t1` | T1 | on top | passes only knee-cut / stack; holds side control without advancing; GnP from half at low rate | `[S: BJJ §6]` |
| `beh.bjj.top_t2` | T2–T3 | on top | knee cut + smash pass + cross-face GnP from half; takes mount; loses back control by rushing the RNC | `[S: BJJ §6]` |
| `beh.bjj.top_t4` | T4 | on top | chain passing (pass → pass 0.30); body lock; floating; strikes to pass; systematic back control (hooks → body triangle → hand fight) | `[S: BJJ §6]`, `[S: LIT_B §5.11]` |
| `beh.bjj.top_t5` | T5 | on top | positional chains with minimal risk; turtle → back 60 %+; GnP volume without giving up posture; finishes from every dominant node | `[S: BJJ §6]` |
| `beh.bjj.energy` | by tier | grappling | action cost ×1.6 (T0: panics, holds breath, gassed by 90 s of scrambling), ×1.3 (T1), ×1.1 (T2–T3), ×1.0 (T4), ×0.9 (T5) | `[S: BJJ §6]` |
| `beh.bjj.decision_latency` | by tier | between edge attempts | 4–8 s / 3–5 / 2–4 / 1.5–3 / 1–2 s | `[S: BJJ §6]` |
| `beh.bjj.turns_back` | by tier | side-control escape | gives up the back: 60 % / 40 % / 20 % / 8 % / 3 % (T5 turns only with a plan: wall walk / roll) | `[S: BJJ §6]` |
| `beh.bjj.mount_escape_attempts` | by tier | under mount, per 30 s | 1 (bridge-and-push) / 2 / 3 / 4 / 5 (kipping + elbow-knee + frames) | `[S: BJJ §6]` |
| `beh.bjj.sub_exit_awareness` | by tier | posting / striking from top or bottom | T0 none (arm extended → armbar 5 % per 10 s); T1 low; T2–T3 medium; T4 high; T5 very high | `[S: BJJ §6]` |
| `beh.bjj.cage_use` | by tier | on ground near fence | T0 no; T1 rarely; T2–T3 wall walk; T4 both sides; T5 also denies opponent's use (knee pin, body-lock pinning) | `[S: BJJ §6]` |
| `beh.bjj.pass_repertoire` | by tier | choose pass | weights: T0 stack 60 / knee-cut 40; T1 knee-cut 50 / stack 30 / toreando 20; T2–T3 knee-cut 35 / smash 25 / toreando 20 / over-under 10 / body lock 10; T4 knee-cut 25 / body lock 20 / leg drag 15 / toreando 15 / HQ 15 / float 10; T5 body lock 25 / float 20 / knee-cut 20 / leg drag 15 / toreando 10 / cage 10 | `[S: BJJ §6]` |
| `beh.bjj.sweep_repertoire` | by tier | choose sweep | T0 none (bucks); T1 hip bump / scissor / basic butterfly; T2–T3 butterfly / underhook half / knee-shield wrestle-up; T4 + X / SLX, deep half, arm drag; T5 + K-guard, leg entanglements, matrix back takes | `[S: BJJ §6]` |
| `beh.bjj.guard_vs_strikes` | by tier | strikes landed from top | guard opens after 3 landed (T0) / 5 (T1); T2–T3 holds, re-guards; T4 holds with frames + wrist control; T5 counters strikes with sweeps / subs | `[S: BJJ §6]` |
| `beh.bjj.mma_bottom_priority` | mmaTier ≥ T2 / sport-BJJ-only | on bottom | stand > sweep > submit; a fighter with `bjj.mean ≥ 50 ∧ mmaIntegration.getUps < 30` inverts (submit first) | `[S: BJJ §6 (a)]`; gate `[E]` |
| `beh.bjj.head_control_first` | T3+ top | just after a takedown | first action = cross-face / chin control (kills wrestle-up and wall walk) | `[S: BJJ §6 (c)]` |
| `beh.bjj.leg_entanglement_rarity` | all (MMA rules) | leg-lock entry | ⊗ w(leg entanglement) ×0.3 unless `legLocks ≥ 75` (head exposed to punches during entries) | `[S: BJJ §6 (e)]`; ×0.3 `[E]` |
| `beh.bjj.t0_hold_breath` | T0 | any grappling | lactate accumulation ×1.4 | `[S: BJJ §6]` direction; ×1.4 `[E]` |
| `beh.bjj.knee_on_belly_pressure` | T3+ top | side control on a turtling/turning opponent | ⊗ w(knee-on-belly, turtle strikes) ×1.4 (fastest way to force the back) | `[S: BJJ §6 (d)]`; ×1.4 `[E]` |

### 3.6 Submissions (`beh.sub.*`, band = `subDefence` or `subAttack` value)

| id | band | trigger | effect | tag |
|---|---|---|---|---|
| `beh.sub.untrained_no_tap` | SUBDEF < 20 | caught | doesn't recognise danger: defence rolls ×0.10 at S1/S2; time-to-tap +50 %; `no_tap` 40 % → LOC (P 0.5 in chokes) or injury (P 0.3 in joint locks); taps to cranks/pressure; gives the back under any pressure | `[S: SUB §4]` |
| `beh.sub.novice_late` | 20–39 | caught | defends only at S3 (×0.4 at S1, ×0.6 at S2, ×1.0 at S3); taps to americanas, can-openers, neck cranks, shoulder chokes; leaves arms extended; steps over guards into leg locks | `[S: SUB §4]` |
| `beh.sub.intermediate` | 40–59 | caught | defends at S2 (×0.8 at S1); good RNC hand-fighting, answers the phone vs guillotine / triangle; still gives arm-triangle under GnP; rarely taps to cranks | `[S: SUB §4]` |
| `beh.sub.advanced` | 60–79 | caught | defends at S1 (×1.0 everywhere); positional escapes; submitted only when hurt, exhausted, or by a specialist | `[S: SUB §4]` |
| `beh.sub.elite` | ≥ 80 | — | prevents S0 (never gives the position); early hand-fighting; endures cranks and partial chokes to the bell; ×1.4 S1, ×1.25 S2, ×1.1 S3; needs damage/fatigue or a skill gap ≥ 20 to be finished with regularity | `[S: SUB §4]` |
| `beh.sub.stubbornness` | all | S3 locked, blood choke | `stubbornness` (§2.7.7): base 0.19 / 0.11 / 0.05; no tap → LOC at N(9.0, 1.5) s clamped [6, 13] | `[S: SUB §4, §5 r7]` |
| `beh.sub.attempt_rate` | SUB (all) | submission available | `p_attempt = 0.15 + 0.35 × SUB/100`; ×2 `submissionHunt`, ×0.5 wrestler/GnP style, ×1.5 opponent rocked, ×0.5 at fatigue > 70 % (RNC / arm-triangle exempt) | `[S: SUB §5 r2]` |
| `beh.sub.specialist_conversion` | SUB ≥ 85 | attempts | ≈ 30 % of recorded attempts convert vs roster 17–22 % — must **emerge** from `SUB §5 r5` skill-gap term; calibration check only | `[S: SUB §4]` |
| `beh.sub.arm_extension_t0` | SUBDEF < 20 on bottom | pushing the top fighter | straight-arm push → armbar / kimura availability P 0.05 per 10 s from mount | `[S: BJJ §6]` |
| `beh.sub.neck_when_hurt` | `mmaIntegration.subDefenceUnderStrikes < 30` | rocked and shot on / snapped down | gives the neck: guillotine S1 +20 pp; turns → RNC S0 granted | `[S: SUB §4]` direction; +20 pp `[E]` |
| `beh.sub.tap_early_injury_history` | all | `pro.subLosses ≥ 2` | `stubbornness × 0.8` | `[S: SUB §4 Hinz 2021]`; ×0.8 `[E]` |
| `beh.sub.early_hand_fight` | SUBDEF ≥ 60 | back taken | hand-fighting begins at S0 (before the choke arm is in): 04's S1 base × 0.8 for the attacker | `[S: SUB §4]` ("defends at S1"); ×0.8 `[E]` |

### 3.7 MMA integration and fight IQ (`beh.mma.*`; execution keys on `mmaTier`, decisions on `iqTier`)

| id | tiers | trigger | effect | tag |
|---|---|---|---|---|
| `beh.mma.range_t1` | iqTier 1 | standing | stands at the end of the opponent's reach: range error +0.15 m toward the opponent's optimum | `[S: MIS §8]`; 0.15 m `[E]` |
| `beh.mma.range_t2` | iqTier 2 | pressured (`opp.pressureBias > 60`) | knows own range, forgets it: same error while pressured | `[S: MIS §8]` |
| `beh.mma.range_t3` | iqTier 3 | — | at planned range 80 % of standing time | `[S: MIS §8]`; 80 % `[E]` |
| `beh.mma.range_t4` | iqTier 4–5 | — | manipulates range with feints; T5 controls the opponent's perception (opponent range error +0.10 m) | `[S: MIS §8]`; 0.10 m `[E]` |
| `beh.mma.kick_vs_wrestler_t1` | mmaTier T0–T1 | vs wrestling tier ≥ T3 | kicks with the rear leg regardless → opponent's reactive-shot bonus applies | `[S: MIS §8]` |
| `beh.mma.kick_vs_wrestler_t2` | mmaTier T2 | after being taken down | ⊗ w(kick) ×0.3 for the rest of the fight | `[S: MIS §8]`; ×0.3 `[E]` |
| `beh.mma.kicks_as_bait` | iqTier 4–5 | vs wrestler | uses kicks to bait shots for counters (`MIS I-6`) | `[S: MIS §8]` |
| `beh.mma.cage_t1` | iqTier 1 | pressured | backs straight up | `[S: MIS §8]` |
| `beh.mma.cage_t2` | iqTier 2 | pressured | circles, wrong way vs southpaw (P 0.5) | `[S: MIS §8]`; P `[E]` |
| `beh.mma.cage_t3` | iqTier 3 | pressured | circles correctly, still gets caught (population fence time) | `[S: MIS §8]` |
| `beh.mma.cage_t4` | iqTier 4 / 5 | pressured | rarely on the fence, escapes on angles / uses the fence offensively (cage pins, wall-walk denial) | `[S: MIS §8]` |
| `beh.mma.td_setup` | iqTier 1–5 | shoot | naked / off a single strike / off combinations / off feints and reactions / off the opponent's tendencies | `[S: MIS §8]` |
| `beh.mma.getup_t1` | mmaTier T0–T1 | on bottom | turtles / covers | `[S: MIS §8]` |
| `beh.mma.getup_t2` | mmaTier T2 | on bottom | wall walk late (after ≈ 20 s) | `[S: MIS §8]`; 20 s `[E]` |
| `beh.mma.getup_t3` | mmaTier T3 | on bottom | wall walk immediately | `[S: MIS §8]` |
| `beh.mma.getup_t4` | mmaTier T4 / T5 | on bottom | never lets the top fighter settle (attempt every ≤ 8 s) / stand-up leads into offence | `[S: MIS §8]`; 8 s `[E]` |
| `beh.mma.finisher` | iqTier 1–5 | opponent hurt | reckless / reckless / measured vs good chins / measured / traps | `[S: MIS §8]` |
| `beh.mma.plan_quality` | iqTier 1–5 | pre-fight | scouting fidelity, plan features and failure modes per `MIS §6.4` (σ 30/20/12/8/5 %) | `[S: MIS §6.4]` |
| `beh.mma.adapt_triggers` | iqTier 1–5 | in-fight | event-triggered evaluation: KD only / + TD / + stuffed TD ×2, hurt / + hit-rate collapse / + opponent's adjustment detected | `[S: MIS §7.3]` |
| `beh.mma.effective_iq_degrade` | all | damage > 60 % or stamina < 30 %; knockdown | `effectiveIQ −1`; knockdown −1 for 20 s | `[S: MIS §7.3]` |
| `beh.mma.score_behind` | iqTier ≥ 3 | behind entering the final round | 0–2 down → `finishSeek`; 1–1 → `stealRound` (volume) | `[S: MIS §7.4]` |
| `beh.mma.trailing_td_drop` | all | behind on own estimate | TD / sub attempts −38 % / −49 %; strike volume unchanged | `[S: MIS §7.4]`, `[S: FD #129]` |
| `beh.mma.level_change_striking` | `levelChanges ≥ 50` | striking exchange | jab-to-double, level-change uppercut, feint-shoot available | `[S: MIS §2.1]`; gate `[E]` |
| `beh.mma.gnp_posture_t0` | `groundAndPound < 20` | top | punches wildly, posts hands → opponent upa +20 pp | `[S: BJJ §6]` |
| `beh.mma.gnp_posture_t3` | `groundAndPound ≥ 50` | top | strikes to pass; keeps posture; GnP volume 2–4 per control minute | `[S: BJJ §6]`, `[S: BJJ §7.2]` |
| `beh.mma.corner_uptake` | iqTier 1–5 | round break | 0.5 / 0.6 / 0.7 / 0.8 / 0.9 | `[S: MIS §8]` |
| `beh.mma.clinch_striking_gate` | `clinchStriking` | clinch | ⊗ w(dirty boxing, clinch elbows/knees) × (0.3 + 0.7 × clinchStriking/100) | `[E]` |
| `beh.mma.hurt_shoot_smart` | grapplingTier ≥ T3 ∧ iqTier ≥ 3 | rocked | shoot / clinch immediately (lowest KO-continuation risk) | `[S: MIS §7.5 D-1]` |
| `beh.mma.t0_rule_ignorance` | mmaTier T0 | clinch / GnP | grabs fence or shorts P 0.2 per clinch; strikes to the back of the head P 0.1 per GnP burst (foul rolls → 06) | `[E]` |
| `beh.mma.fatigue_decision` | all | fatigue | decision quality −15 % at `f = 0.5`, −35 % at `f = 0.8` | `[S: DP §4.3]` |

### 3.8 Cross-tier resolution note

When two disciplines' tiers disagree inside one exchange (a T4 boxer being shot on by a T2 wrestler), the
defender's rule set is the one keyed to the *defending* discipline (wrestling.takedownDefence → `beh.wr.sprawl_*`),
and the attacker's to the *attacking* discipline. A fighter with T0 wrestling therefore shows `beh.wr.sprawl_late`
even if his boxing is T5. Aggregate tiers (`mmaTier`, `iqTier`) are only used by rows that name them.

### 3.9 Animation tags introduced (for 08)

| tag | Definition |
|---|---|
| `anim.flinch_cover` | Reflexive cover-up with head tuck, no counter posture |
| `anim.counter_slot` | Pre-loaded counter posture (weight on rear leg, hand cocked) |
| `anim.gaze_scatter` | Head/eye darting to limbs; visible nervousness |
| `anim.eyes_shut_flinch` | Eyes closed, head turns on incoming power strike |
| `anim.turn_away_cover` | Turns side/back to opponent, arms over head |
| `anim.guard_low_mouth_open` | Hands at chest/waist, mouth open, chin up |
| `anim.feet_flat` | Flat-footed shuffle, no bounce |
| `anim.windmill` | Wild alternating overhand swings, head down |
| `anim.hit_react_big` | Exaggerated hit reaction (head snap, stagger, facial) |
| `anim.grab_push` | Untrained two-hand push / lapel grab |
| `anim.headlock_pull` | Side headlock with pulling |
| `anim.clinch_hands_busy` | Hands holding the opponent, head unguarded |
| `anim.stance_square_heels` | Square stance, weight back on heels |
| `anim.step_cross` | Feet crossing during lateral movement |
| `anim.chin_up` | Chin lifted, neck extended |
| `anim.guard_chest` | Hands held at chest height |
| `anim.punch_arm_only` | Punch without hip/shoulder rotation, elbow flared |
| `anim.fist_drop_windup` | Fist dips before launching |
| `anim.overreach` | Over-extended punch with forward lean, stumble on miss |
| `anim.retreat_straight` | Straight-line backward retreat |
| `anim.kick_windup_leanback` | Visible chamber/lean-back before a kick |
| `anim.kick_instep` | Kick contacting with foot/instep rather than shin |
| `anim.kick_no_reset` | Lands square with hands down after kicking |
| `anim.neck_grab_pull` | Untrained neck grab and pull in the clinch |
| `anim.shot_bent_waist` | Takedown attempt bending at the waist, head down/outside |
| `anim.turn_to_knees_back_exposed` | Turns to knees away from the opponent, exposing the back |
| `anim.judo_stiff_arm_bent` | Stiff-arm, forward-bent grip posture |
| `anim.fall_flat` | Flat back landing without breakfall |
| `anim.breakfall` | Slapping breakfall, rolls to base |
| `anim.mount_bottom_straight_arm` | Straight-arm push against the chest from mount bottom |
| `anim.turtle_panic` | Turns to belly and covers head under strikes |

---

## 4. Archetype presets

Fifteen presets, each a complete `FighterModel` literal (`src/engine/data/archetypes.ts`). **All archetype
values are `[E]` design data** placed inside the `CONV §3` tier bands and the population priors of §2.1; the
"derived check" line under each is `[D]` from §2.7 formulas. Disciplines not listed are untrained (all sub-skills
5, `yearsTrained 0`); transfers (§2.3.3) apply automatically. Technique/submission ids (`tech.*`, `sub.*`) are
owned by 02–04; any id that does not resolve there must be aliased, not silently dropped. Appearance blocks are
omitted (creator/generator fills them; they do not affect simulation).

Common defaults unless overridden: `sex 'male'`, `handedness 'right'`, `dominantLeg` = handedness,
`stanceExposure {orthodox: 0.8 × pro.total, southpaw: 0.2 × pro.total}`, `daysSinceLastBout 120`, `weightCut
{cutPct: 7, regainPct: class default, residualDehydration: 0.01}`, `lastResult 'win'`, `titleFights 0`,
`bottomPriority ['standUp','sweep','submit']`, `topPriority ['control','strike','pass','submit']`,
`stanceSwitching 10`, `pacing []`.

### 4.1 `arch.elite_wrestler_boxer` — "the modern UFC welterweight"

```ts
{ id: 'arch.elite_wrestler_boxer',
  body: { heightM: 1.80, reachM: 1.85, legReachM: 1.04, weighInKg: 77.1, fightNightKg: 84.1, weightClass: 'wc.welterweight',
          ageYears: 29, bodyFatPct: 8, build: { ecto: 0.15, meso: 0.75, endo: 0.10 }, stance: 'orthodox' },
  physical: { strength: 78, explosiveness: 76, speed: 66, handSpeed: 72, kickSpeed: 55, cardio: 80, chin: 70,
              bodyToughness: 72, recovery: 74, flexibility: 50, balance: 82, reactionTime: 60, neck: 78 },
  mental: { fightIQ: 78, aggression: 66, composure: 78, heart: 80, discipline: 84, adaptability: 72 },
  disciplines: {
    wrestling: { yearsTrained: 18, trainingQuality: 1.15, styleTags: ['folkstyle'],
      native: { shots: 86, takedownDefence: 88, topControl: 84, scrambles: 82, cageWrestling: 84, clinch: 80,
                chains: 84, finishes: 82, getUps: 80, matReturns: 82 } },
    boxing: { yearsTrained: 9, trainingQuality: 1.1, styleTags: [],
      native: { jab: 74, power: 74, combinations: 66, headMovement: 60, footwork: 72, guard: 72, bodyWork: 58,
                counters: 62, feints: 66, ringCraft: 76 } },
    bjj: { yearsTrained: 8, trainingQuality: 1.0, styleTags: ['no-gi'],
      native: { guard: 55, passing: 74, topControl: 80, backControl: 78, chokes: 66, jointLocks: 52, legLocks: 30,
                escapes: 72, sweeps: 50, subDefence: 78, subAttack: 60, wrestleUps: 84 } },
    mmaIntegration: { yearsTrained: 10, trainingQuality: 1.15, styleTags: [],
      native: { levelChanges: 86, clinchStriking: 76, cageWork: 86, groundAndPound: 82, getUps: 82, transitions: 80,
                subDefenceUnderStrikes: 78, gameplanExecution: 82 } } },
  career: { pro: { wins: 19, losses: 3, draws: 0, noContests: 0, koWins: 6, subWins: 3, decWins: 10, koLosses: 0, subLosses: 1, decLosses: 2 },
            amateur: { wins: 6, losses: 1 }, titleFights: 1, bigFightComposure: 74, careerKnockdownsAbsorbed: 1, winStreak: 4 },
  style: { preferredRange: 'mid', initiative: 'pressure', pressureBias: 70, primaryMode: 'wrestleControl', fallbackMode: 'pressureStriking',
           favouriteTechniques: [{ techId: 'tech.jab', weight: 1.4 }, { techId: 'tech.cross', weight: 1.3 }, { techId: 'tech.double_leg', weight: 1.6 }],
           combos: [{ id: 'combo.jab_cross_double', sequence: ['tech.jab', 'tech.cross', 'tech.double_leg'], weight: 1.5 },
                    { id: 'combo.jab_jab_cross', sequence: ['tech.jab', 'tech.jab', 'tech.cross'], weight: 1.2 }],
           goToSubmissions: [{ subId: 'sub.rnc', weight: 1.5 }, { subId: 'sub.arm_triangle', weight: 1.0 }],
           takedowns: { prefs: [{ techId: 'tech.double_leg', weight: 1.5 }, { techId: 'tech.body_lock_td', weight: 1.2 }, { techId: 'tech.single_leg', weight: 1.0 }],
                        setup: 'offCombination', cageBias: 0.8 },
           hurtBehaviour: 'shoot', losingBehaviour: 'stealRound', tiredBehaviour: 'clinchRest', guardStyle: 'highGuard' } }
```
Derived check `[D]`: wrestling T4 (mean 83, 18 yr), boxing T4 (mean 68 → T3 by skill; 9 yr → cap T4+1; **T3**),
bjj T3, mmaIntegration T4; iqTier 4; `powerIndex.rearHand ≈ 5,295 N`; `chinEff = 70 − 7 − 0 − 1 = 62`;
`readP_striking ≈ 0.79`; `experience = 0.1 + 0.9(1 − e^{−25.5/6}) ≈ 0.99`.

### 4.2 `arch.thai_striker` — "Muay Femur turned MMA lightweight"

```ts
{ id: 'arch.thai_striker',
  body: { heightM: 1.78, reachM: 1.83, legReachM: 1.05, weighInKg: 70.3, fightNightKg: 76.1, weightClass: 'wc.lightweight',
          ageYears: 27, bodyFatPct: 8, build: { ecto: 0.45, meso: 0.50, endo: 0.05 }, stance: 'orthodox' },
  physical: { strength: 58, explosiveness: 74, speed: 70, handSpeed: 70, kickSpeed: 86, cardio: 78, chin: 62,
              bodyToughness: 80, recovery: 70, flexibility: 84, balance: 86, reactionTime: 58, neck: 60 },
  mental: { fightIQ: 66, aggression: 58, composure: 82, heart: 72, discipline: 74, adaptability: 60 },
  disciplines: {
    muayThai: { yearsTrained: 16, trainingQuality: 1.15, styleTags: ['muayFemur'],
      native: { kicks: 90, teep: 88, knees: 84, elbows: 82, clinch: 86, checks: 86, catches: 82, hands: 62 } },
    boxing: { yearsTrained: 4, trainingQuality: 0.9, styleTags: [],
      native: { jab: 58, power: 56, combinations: 52, headMovement: 34, footwork: 56, guard: 62, bodyWork: 44, counters: 50, feints: 60, ringCraft: 52 } },
    wrestling: { yearsTrained: 3, trainingQuality: 1.0, styleTags: [],
      native: { shots: 22, takedownDefence: 52, topControl: 30, scrambles: 40, cageWrestling: 44, clinch: 60, chains: 15, finishes: 20, getUps: 50, matReturns: 15 } },
    bjj: { yearsTrained: 3, trainingQuality: 0.9, styleTags: [],
      native: { guard: 40, passing: 30, topControl: 32, backControl: 28, chokes: 34, jointLocks: 30, legLocks: 12, escapes: 44, sweeps: 30, subDefence: 46, subAttack: 28, wrestleUps: 48 } },
    mmaIntegration: { yearsTrained: 4, trainingQuality: 1.0, styleTags: [],
      native: { levelChanges: 40, clinchStriking: 82, cageWork: 54, groundAndPound: 40, getUps: 56, transitions: 44, subDefenceUnderStrikes: 48, gameplanExecution: 62 } } },
  career: { pro: { wins: 12, losses: 4, draws: 0, noContests: 0, koWins: 8, subWins: 0, decWins: 4, koLosses: 0, subLosses: 3, decLosses: 1 },
            amateur: { wins: 40, losses: 12 }, /* Thai stadium record counted as amateur here */ titleFights: 0, bigFightComposure: 76, careerKnockdownsAbsorbed: 1, winStreak: 2 },
  style: { preferredRange: 'long', initiative: 'counter', pressureBias: 35, primaryMode: 'distanceStriking', fallbackMode: 'clinchGrind',
           favouriteTechniques: [{ techId: 'tech.round_kick_body_rear', weight: 1.6 }, { techId: 'tech.teep_lead', weight: 1.5 }, { techId: 'tech.clinch_knee', weight: 1.4 }, { techId: 'tech.elbow_horizontal', weight: 1.2 }],
           combos: [{ id: 'combo.teep_kick', sequence: ['tech.teep_lead', 'tech.round_kick_body_rear'], weight: 1.4 },
                    { id: 'combo.jab_cross_low', sequence: ['tech.jab', 'tech.cross', 'tech.low_kick_rear'], weight: 1.2 }],
           goToSubmissions: [{ subId: 'sub.guillotine_high_elbow', weight: 1.0 }],
           takedowns: { prefs: [{ techId: 'tech.kick_catch_sweep', weight: 1.4 }, { techId: 'tech.inside_trip', weight: 1.0 }], setup: 'offClinch', cageBias: 0.3 },
           hurtBehaviour: 'clinch', losingBehaviour: 'finishSeek', tiredBehaviour: 'retreat', guardStyle: 'longGuard', thaiStyle: 'muayFemur' } }
```
Derived check `[D]`: muayThai T4 (mean 82.5; mental gate fails IQ 66 → not T5), boxing T2, wrestling T2 (mean
34.8), bjj T2, mmaIntegration T2 (mean 53 → T3 by skill, 4 yr → cap T3; **T3**); `powerIndex.rearHand ≈ 4,463 N`;
`powerIndex.rearKick` = 1400 × techGate(90) × physTerm(≈1.04) × (0.85 + 0.15 × 7.46/6.5) × 3.4 ≈ 5,010 N;
`chinEff = 62 − 3.5 − 0 − 1 = 57.5`; `readP_striking ≈ 0.76`.

### 4.3 `arch.bjj_guard_player` — "black-belt world medallist, striking still catching up"

```ts
{ id: 'arch.bjj_guard_player',
  body: { heightM: 1.75, reachM: 1.78, legReachM: 1.01, weighInKg: 65.8, fightNightKg: 71.7, weightClass: 'wc.featherweight',
          ageYears: 31, bodyFatPct: 9, build: { ecto: 0.40, meso: 0.50, endo: 0.10 }, stance: 'southpaw', handedness: 'left' },
  physical: { strength: 55, explosiveness: 58, speed: 56, handSpeed: 48, kickSpeed: 46, cardio: 74, chin: 58,
              bodyToughness: 64, recovery: 68, flexibility: 90, balance: 74, reactionTime: 52, neck: 56 },
  mental: { fightIQ: 72, aggression: 48, composure: 76, heart: 78, discipline: 70, adaptability: 66 },
  disciplines: {
    bjj: { yearsTrained: 19, trainingQuality: 1.15, styleTags: ['gi', 'no-gi', 'guardPlayer'],
      native: { guard: 96, passing: 84, topControl: 82, backControl: 92, chokes: 92, jointLocks: 90, legLocks: 78,
                escapes: 92, sweeps: 94, subDefence: 94, subAttack: 94, wrestleUps: 80 } },
    judo: { yearsTrained: 4, trainingQuality: 0.8, styleTags: [],
      native: { gripFighting: 46, throws: 38, footSweeps: 42, counters: 40, kuzushi: 40, newaza: 70, ukemi: 66 } },
    wrestling: { yearsTrained: 4, trainingQuality: 1.0, styleTags: [],
      native: { shots: 40, takedownDefence: 56, topControl: 60, scrambles: 70, cageWrestling: 44, clinch: 42, chains: 30, finishes: 36, getUps: 66, matReturns: 40 } },
    boxing: { yearsTrained: 5, trainingQuality: 0.9, styleTags: [],
      native: { jab: 44, power: 38, combinations: 34, headMovement: 30, footwork: 40, guard: 48, bodyWork: 30, counters: 32, feints: 36, ringCraft: 30 } },
    muayThai: { yearsTrained: 2, trainingQuality: 0.8, styleTags: [],
      native: { kicks: 30, teep: 28, knees: 34, elbows: 20, clinch: 36, checks: 34, catches: 22, hands: 30 } },
    mmaIntegration: { yearsTrained: 6, trainingQuality: 1.0, styleTags: [],
      native: { levelChanges: 46, clinchStriking: 36, cageWork: 56, groundAndPound: 58, getUps: 62, transitions: 72, subDefenceUnderStrikes: 84, gameplanExecution: 64 } } },
  career: { pro: { wins: 11, losses: 5, draws: 0, noContests: 0, koWins: 0, subWins: 9, decWins: 2, koLosses: 1, subLosses: 0, decLosses: 4 },
            amateur: { wins: 3, losses: 0 }, titleFights: 0, bigFightComposure: 78, careerKnockdownsAbsorbed: 2, winStreak: 1 },
  style: { preferredRange: 'ground', initiative: 'counter', pressureBias: 40, primaryMode: 'submissionHunt', fallbackMode: 'wrestleControl',
           favouriteTechniques: [{ techId: 'tech.jab', weight: 1.1 }, { techId: 'tech.guard_pull', weight: 1.3 }, { techId: 'tech.single_leg', weight: 1.2 }],
           combos: [{ id: 'combo.jab_shoot', sequence: ['tech.jab', 'tech.single_leg'], weight: 1.3 }],
           goToSubmissions: [{ subId: 'sub.triangle', weight: 1.6 }, { subId: 'sub.rnc', weight: 1.4 }, { subId: 'sub.armbar_guard', weight: 1.3 }, { subId: 'sub.heel_hook_inside', weight: 0.8 }],
           takedowns: { prefs: [{ techId: 'tech.single_leg', weight: 1.2 }, { techId: 'tech.guard_pull', weight: 1.4 }, { techId: 'tech.arm_drag_back', weight: 1.1 }], setup: 'offSingleStrike', cageBias: 0.5 },
           bottomPriority: ['sweep', 'submit', 'standUp'], topPriority: ['pass', 'submit', 'control', 'strike'],
           hurtBehaviour: 'shoot', losingBehaviour: 'gamble', tiredBehaviour: 'clinchRest', guardStyle: 'highGuard' } }
```
Derived check `[D]`: bjj mean 89 → T4 (T5 gate: mean < 90 and IQ 72 < 80 → **T4**), wrestling T2, boxing T2,
mmaIntegration T3; `SUBDEF = 0.7×94 + 0.2×92 + 0.1×84 = 92.6` (elite band); `stubbornness = 0.05 × (0.5 + 0.78) =
0.064`; `powerIndex.rearHand ≈ 3,508 N`; `chinEff = 58 − 10.5 − 3 − 2 = 42.5` (age 31); `readP_striking ≈ 0.70`.
Note `bottomPriority` is inverted (sport instinct) — `beh.bjj.mma_bottom_priority` does not override it because
`mmaIntegration.getUps = 62 ≥ 30`; this fighter *chooses* to play guard.

### 4.4 `arch.judoka` — "Olympic-level judoka, three years into MMA"

```ts
{ id: 'arch.judoka',
  body: { heightM: 1.83, reachM: 1.86, legReachM: 1.06, weighInKg: 83.9, fightNightKg: 91.5, weightClass: 'wc.middleweight',
          ageYears: 30, bodyFatPct: 10, build: { ecto: 0.10, meso: 0.70, endo: 0.20 }, stance: 'orthodox' },
  physical: { strength: 80, explosiveness: 72, speed: 54, handSpeed: 52, kickSpeed: 44, cardio: 70, chin: 64,
              bodyToughness: 76, recovery: 66, flexibility: 62, balance: 90, reactionTime: 56, neck: 84 },
  mental: { fightIQ: 68, aggression: 62, composure: 80, heart: 82, discipline: 88, adaptability: 56 },
  disciplines: {
    judo: { yearsTrained: 22, trainingQuality: 1.15, styleTags: ['international'],
      native: { gripFighting: 94, throws: 95, footSweeps: 92, counters: 90, kuzushi: 94, newaza: 78, ukemi: 96 } },
    bjj: { yearsTrained: 4, trainingQuality: 1.0, styleTags: ['no-gi'],
      native: { guard: 40, passing: 56, topControl: 74, backControl: 58, chokes: 50, jointLocks: 60, legLocks: 14, escapes: 56, sweeps: 36, subDefence: 62, subAttack: 46, wrestleUps: 58 } },
    wrestling: { yearsTrained: 3, trainingQuality: 1.0, styleTags: [],
      native: { shots: 30, takedownDefence: 66, topControl: 62, scrambles: 48, cageWrestling: 60, clinch: 70, chains: 24, finishes: 50, getUps: 54, matReturns: 60 } },
    boxing: { yearsTrained: 3, trainingQuality: 1.0, styleTags: [],
      native: { jab: 44, power: 46, combinations: 36, headMovement: 28, footwork: 40, guard: 50, bodyWork: 30, counters: 30, feints: 34, ringCraft: 38 } },
    mmaIntegration: { yearsTrained: 3, trainingQuality: 1.1, styleTags: [],
      native: { levelChanges: 38, clinchStriking: 62, cageWork: 64, groundAndPound: 66, getUps: 52, transitions: 56, subDefenceUnderStrikes: 54, gameplanExecution: 66 } } },
  career: { pro: { wins: 7, losses: 1, draws: 0, noContests: 0, koWins: 3, subWins: 2, decWins: 2, koLosses: 0, subLosses: 0, decLosses: 1 },
            amateur: { wins: 0, losses: 0 }, titleFights: 0, bigFightComposure: 84, careerKnockdownsAbsorbed: 1, winStreak: 3 },
  style: { preferredRange: 'clinch', initiative: 'pressure', pressureBias: 68, primaryMode: 'clinchGrind', fallbackMode: 'wrestleControl',
           favouriteTechniques: [{ techId: 'tech.uchi_mata', weight: 1.6 }, { techId: 'tech.osoto_gari', weight: 1.4 }, { techId: 'tech.collar_tie_knee', weight: 1.1 }],
           combos: [{ id: 'combo.cross_clinch', sequence: ['tech.cross', 'tech.clinch_entry_collar'], weight: 1.4 },
                    { id: 'combo.kouchi_uchimata', sequence: ['tech.kouchi_gari', 'tech.uchi_mata'], weight: 1.5 }],
           goToSubmissions: [{ subId: 'sub.kimura', weight: 1.3 }, { subId: 'sub.arm_triangle', weight: 1.1 }],
           takedowns: { prefs: [{ techId: 'tech.uchi_mata', weight: 1.6 }, { techId: 'tech.osoto_gari', weight: 1.4 }, { techId: 'tech.body_lock_td', weight: 1.1 }], setup: 'offClinch', cageBias: 0.7 },
           hurtBehaviour: 'clinch', losingBehaviour: 'unchanged', tiredBehaviour: 'clinchRest', guardStyle: 'highGuard' } }
```
Derived check `[D]`: judo T4 (mean 91; gate fails, IQ 68), bjj T2 (mean 50.3 → T3 by skill; 4 yr → cap T3;
**T3**), wrestling T2 (mean 52 → T3; 3 yr + transfer years 0.5 × 22 × 0.6 = 6.6 → cap T3; **T3**), boxing T2,
mmaIntegration T3; `grapplingStrength ≈ 80`; `powerIndex.rearHand ≈ 4,624 N`; `chinEff = 64 − 8.75 − 0 − 1 =
54.3`; `readP_striking ≈ 0.71`; `beh.ju.ukemi` band ≥ 70 (breakfalls, lands in base).

### 4.5 `arch.pressure_boxer` — "Olympic-style boxer who walks you down"

```ts
{ id: 'arch.pressure_boxer',
  body: { heightM: 1.75, reachM: 1.80, legReachM: 1.00, weighInKg: 70.3, fightNightKg: 76.3, weightClass: 'wc.lightweight',
          ageYears: 28, bodyFatPct: 8, build: { ecto: 0.25, meso: 0.65, endo: 0.10 }, stance: 'orthodox' },
  physical: { strength: 62, explosiveness: 74, speed: 72, handSpeed: 80, kickSpeed: 48, cardio: 84, chin: 76,
              bodyToughness: 74, recovery: 76, flexibility: 48, balance: 72, reactionTime: 64, neck: 70 },
  mental: { fightIQ: 64, aggression: 80, composure: 72, heart: 86, discipline: 66, adaptability: 54 },
  disciplines: {
    boxing: { yearsTrained: 15, trainingQuality: 1.15, styleTags: ['pressure', 'peekaboo'],
      native: { jab: 84, power: 84, combinations: 90, headMovement: 80, footwork: 78, guard: 82, bodyWork: 88, counters: 70, feints: 72, ringCraft: 84 } },
    wrestling: { yearsTrained: 5, trainingQuality: 1.0, styleTags: [],
      native: { shots: 30, takedownDefence: 66, topControl: 44, scrambles: 50, cageWrestling: 56, clinch: 58, chains: 20, finishes: 28, getUps: 62, matReturns: 26 } },
    bjj: { yearsTrained: 5, trainingQuality: 0.9, styleTags: [],
      native: { guard: 46, passing: 36, topControl: 40, backControl: 34, chokes: 40, jointLocks: 34, legLocks: 10, escapes: 54, sweeps: 34, subDefence: 56, subAttack: 30, wrestleUps: 58 } },
    muayThai: { yearsTrained: 2, trainingQuality: 0.8, styleTags: [],
      native: { kicks: 34, teep: 26, knees: 38, elbows: 30, clinch: 40, checks: 40, catches: 20, hands: 84 } },
    mmaIntegration: { yearsTrained: 6, trainingQuality: 1.05, styleTags: [],
      native: { levelChanges: 50, clinchStriking: 74, cageWork: 66, groundAndPound: 60, getUps: 66, transitions: 52, subDefenceUnderStrikes: 60, gameplanExecution: 62 } } },
  career: { pro: { wins: 14, losses: 2, draws: 1, noContests: 0, koWins: 9, subWins: 0, decWins: 5, koLosses: 0, subLosses: 1, decLosses: 1 },
            amateur: { wins: 60, losses: 14 }, titleFights: 0, bigFightComposure: 70, careerKnockdownsAbsorbed: 2, winStreak: 5 },
  style: { preferredRange: 'short', initiative: 'pressure', pressureBias: 88, primaryMode: 'pressureStriking', fallbackMode: 'clinchGrind',
           favouriteTechniques: [{ techId: 'tech.lead_hook', weight: 1.5 }, { techId: 'tech.body_hook_rear', weight: 1.5 }, { techId: 'tech.uppercut_rear', weight: 1.2 }],
           combos: [{ id: 'combo.jab_cross_hook_body', sequence: ['tech.jab', 'tech.cross', 'tech.lead_hook', 'tech.body_hook_rear'], weight: 1.6 },
                    { id: 'combo.body_head', sequence: ['tech.body_hook_lead', 'tech.lead_hook'], weight: 1.4 },
                    { id: 'combo.slip_counter', sequence: ['def.slip_outside', 'tech.cross'], weight: 1.2 }],
           goToSubmissions: [{ subId: 'sub.guillotine_arm_in', weight: 0.8 }],
           takedowns: { prefs: [{ techId: 'tech.body_lock_td', weight: 1.0 }], setup: 'offClinch', cageBias: 0.6 },
           hurtBehaviour: 'trade', losingBehaviour: 'finishSeek', tiredBehaviour: 'gamble', guardStyle: 'peekaboo' } }
```
Derived check `[D]`: boxing T4 (mean 81), wrestling T2 (mean 44), bjj T2, muayThai T1 (mean 39 → T2 by skill;
2 yr → cap T2; **T2**), mmaIntegration T3; `powerIndex.rearHand ≈ 4,974 N`; `chinEff = 76 − 5.25 − 0 − 2 = 68.8`;
`readP_striking ≈ 0.80`; `attackShare = 0.33 + 0.30 × 0.6 = 0.51`; `hurtBehaviour 'trade'` is deliberately worse
than the T4 default (`beh.gen.hurt_t4`) — heart 86 plus aggression 80 is the "brawler in trouble" profile.

### 4.6 `arch.counter_striker` — "karate/kickboxing counter puncher, southpaw"

```ts
{ id: 'arch.counter_striker',
  body: { heightM: 1.88, reachM: 1.96, legReachM: 1.10, weighInKg: 83.9, fightNightKg: 90.6, weightClass: 'wc.middleweight',
          ageYears: 33, bodyFatPct: 9, build: { ecto: 0.55, meso: 0.40, endo: 0.05 }, stance: 'switch', handedness: 'left' },
  physical: { strength: 60, explosiveness: 78, speed: 80, handSpeed: 82, kickSpeed: 80, cardio: 76, chin: 66,
              bodyToughness: 60, recovery: 66, flexibility: 80, balance: 84, reactionTime: 70, neck: 62 },
  mental: { fightIQ: 82, aggression: 36, composure: 86, heart: 62, discipline: 78, adaptability: 80 },
  disciplines: {
    karate: { yearsTrained: 24, trainingQuality: 1.15, styleTags: ['kyokushin-point hybrid'],
      native: { distanceControl: 94, blitz: 88, kicks: 84, counters: 92, footwork: 92, timing: 94 } },
    kickboxing: { yearsTrained: 10, trainingQuality: 1.1, styleTags: [],
      native: { punches: 78, kicks: 82, lowKicks: 72, combinations: 66, footwork: 88, checks: 74, spinning: 80, defence: 84 } },
    boxing: { yearsTrained: 6, trainingQuality: 1.0, styleTags: [],
      native: { jab: 76, power: 68, combinations: 58, headMovement: 78, footwork: 86, guard: 60, bodyWork: 50, counters: 88, feints: 90, ringCraft: 80 } },
    wrestling: { yearsTrained: 6, trainingQuality: 1.0, styleTags: [],
      native: { shots: 26, takedownDefence: 76, topControl: 40, scrambles: 56, cageWrestling: 58, clinch: 48, chains: 16, finishes: 26, getUps: 70, matReturns: 20 } },
    bjj: { yearsTrained: 6, trainingQuality: 0.9, styleTags: [],
      native: { guard: 56, passing: 34, topControl: 38, backControl: 30, chokes: 44, jointLocks: 36, legLocks: 16, escapes: 60, sweeps: 40, subDefence: 62, subAttack: 30, wrestleUps: 66 } },
    mmaIntegration: { yearsTrained: 9, trainingQuality: 1.1, styleTags: [],
      native: { levelChanges: 44, clinchStriking: 50, cageWork: 78, groundAndPound: 46, getUps: 74, transitions: 56, subDefenceUnderStrikes: 64, gameplanExecution: 84 } } },
  career: { pro: { wins: 21, losses: 6, draws: 0, noContests: 1, koWins: 11, subWins: 1, decWins: 9, koLosses: 1, subLosses: 2, decLosses: 3 },
            amateur: { wins: 10, losses: 2 }, titleFights: 2, bigFightComposure: 84, careerKnockdownsAbsorbed: 3, winStreak: 1,
            stanceExposure: { orthodox: 22, southpaw: 6 } },
  style: { preferredRange: 'long', initiative: 'counter', pressureBias: 18, primaryMode: 'counter', fallbackMode: 'distanceStriking',
           favouriteTechniques: [{ techId: 'tech.cross', weight: 1.4 }, { techId: 'tech.front_kick_body', weight: 1.3 }, { techId: 'tech.round_kick_head_lead', weight: 1.2 }, { techId: 'tech.spinning_back_kick', weight: 1.0 }],
           combos: [{ id: 'combo.pull_cross', sequence: ['def.pull', 'tech.cross'], weight: 1.6 },
                    { id: 'combo.blitz', sequence: ['tech.blitz_step', 'tech.jab', 'tech.cross'], weight: 1.3 },
                    { id: 'combo.feint_feint_cross', sequence: ['tech.feint_jab', 'tech.feint_level', 'tech.cross'], weight: 1.4 }],
           goToSubmissions: [{ subId: 'sub.guillotine_high_elbow', weight: 0.8 }],
           takedowns: { prefs: [{ techId: 'tech.single_leg', weight: 0.8 }], setup: 'reactive', cageBias: 0.2 },
           hurtBehaviour: 'circleOut', losingBehaviour: 'stealRound', tiredBehaviour: 'retreat', stanceSwitching: 80, guardStyle: 'longGuard' } }
```
Derived check `[D]`: karate T4 (mean 90.7; gate IQ 82 ≥ 80 ∧ composure 86 ≥ 75 → **T5**), kickboxing T4, boxing
T4 (mean 73.4; 6 yr + transfer years → cap T4), wrestling T2 (mean 43.6), bjj T2, mmaIntegration T3 (mean 62);
`powerIndex.rearHand ≈ 5,152 N`; `chinEff = 66 − 16.25 − 3 − 3 = 43.8` (age 33: the ageing-chin curve is
visible); `readP_striking ≈ 0.83`, `counterOnReadP = 0.05 + 0.45 × (88 − 10)/80 = 0.49`; `feintBiteP ≈ 0.31`.

### 4.7 `arch.brand_new_brawler` — "big guy from the bar, never trained"

```ts
{ id: 'arch.brand_new_brawler',
  body: { heightM: 1.84, reachM: 1.86, legReachM: 1.04, weighInKg: 95, fightNightKg: 95, weightClass: 'wc.cruiserweight',
          ageYears: 24, bodyFatPct: 22, build: { ecto: 0.10, meso: 0.35, endo: 0.55 }, stance: 'orthodox' },
  physical: { strength: 38, explosiveness: 35, speed: 32, handSpeed: 42, kickSpeed: 30, cardio: 26, chin: 50,
              bodyToughness: 48, recovery: 36, flexibility: 30, balance: 34, reactionTime: 48, neck: 46 },
  mental: { fightIQ: 20, aggression: 82, composure: 24, heart: 55, discipline: 20, adaptability: 30 },
  disciplines: { /* none: every discipline untrained (all 5) */ },
  career: { pro: { wins: 0, losses: 0, draws: 0, noContests: 0, koWins: 0, subWins: 0, decWins: 0, koLosses: 0, subLosses: 0, decLosses: 0 },
            amateur: { wins: 0, losses: 0 }, titleFights: 0, bigFightComposure: 15, careerKnockdownsAbsorbed: 0, winStreak: 0,
            daysSinceLastBout: 0, weightCut: { cutPct: 0, regainPct: 0, residualDehydration: 0 } },
  style: { preferredRange: 'short', initiative: 'pressure', pressureBias: 90, primaryMode: 'pressureStriking', fallbackMode: 'clinchGrind',
           favouriteTechniques: [{ techId: 'tech.overhand_rear', weight: 2.0 }, { techId: 'tech.lead_hook', weight: 1.5 }, { techId: 'tech.grab_push', weight: 1.4 }, { techId: 'tech.headlock', weight: 1.3 }],
           combos: [{ id: 'combo.wild_three', sequence: ['tech.overhand_rear', 'tech.lead_hook', 'tech.overhand_rear'], weight: 1.5 }],
           goToSubmissions: [{ subId: 'sub.headlock_squeeze', weight: 1.0 }],
           takedowns: { prefs: [{ techId: 'tech.tackle', weight: 1.5 }], setup: 'naked', cageBias: 0.0 },
           hurtBehaviour: 'turnAway', losingBehaviour: 'gamble', tiredBehaviour: 'gamble', guardStyle: 'highGuard' } }
```
Derived check `[D]`: every discipline T0; `mmaTier` T0; `iqTier` 1; `experience = 0.10`; `powerIndex.rearHand
≈ 2,654 N` (novice band 1,600–2,400 N `[S: FD §5]`, slightly above because of 95 kg mass); `chinEff = 50`;
`readP_striking = 0.55 + 0.33 × 0.05 − 0.018 ≈ 0.55` (floor region); `feintBiteP = 0.60`; `beh.gen.t0_burst_collapse`,
`beh.box.square_stance`, `beh.gen.eyes_close`, `beh.gen.turn_away`, `beh.wr.t0_tackle`, `beh.bjj.bottom_t0`,
`beh.sub.untrained_no_tap` all active. `energy.actionCostMult = 1.6`.

### 4.8 `arch.gym_fit_beginner` — "six months of boxing and BJJ, trains four days a week"

```ts
{ id: 'arch.gym_fit_beginner',
  body: { heightM: 1.78, reachM: 1.80, legReachM: 1.02, weighInKg: 79, fightNightKg: 79, weightClass: 'wc.super_welterweight',
          ageYears: 26, bodyFatPct: 14, build: { ecto: 0.30, meso: 0.55, endo: 0.15 }, stance: 'orthodox' },
  physical: { strength: 52, explosiveness: 50, speed: 50, handSpeed: 46, kickSpeed: 40, cardio: 58, chin: 50,
              bodyToughness: 50, recovery: 54, flexibility: 46, balance: 44, reactionTime: 50, neck: 48 },
  mental: { fightIQ: 32, aggression: 52, composure: 34, heart: 58, discipline: 60, adaptability: 40 },
  disciplines: {
    boxing: { yearsTrained: 0.5, trainingQuality: 0.8, styleTags: [],
      native: { jab: 18, power: 14, combinations: 14, headMovement: 10, footwork: 14, guard: 20, bodyWork: 10, counters: 8, feints: 6, ringCraft: 8 } },
    bjj: { yearsTrained: 0.5, trainingQuality: 0.8, styleTags: ['gi'],
      native: { guard: 16, passing: 12, topControl: 12, backControl: 10, chokes: 14, jointLocks: 12, legLocks: 4, escapes: 14, sweeps: 12, subDefence: 16, subAttack: 12, wrestleUps: 10 } },
    mmaIntegration: { yearsTrained: 0, trainingQuality: 0.8, styleTags: [], native: { levelChanges: 6, clinchStriking: 6, cageWork: 5, groundAndPound: 6, getUps: 8, transitions: 5, subDefenceUnderStrikes: 8, gameplanExecution: 8 } } },
  career: { pro: { wins: 0, losses: 0, draws: 0, noContests: 0, koWins: 0, subWins: 0, decWins: 0, koLosses: 0, subLosses: 0, decLosses: 0 },
            amateur: { wins: 0, losses: 0 }, titleFights: 0, bigFightComposure: 20, careerKnockdownsAbsorbed: 0, winStreak: 0,
            daysSinceLastBout: 0, weightCut: { cutPct: 0, regainPct: 0, residualDehydration: 0 } },
  style: { preferredRange: 'mid', initiative: 'balanced', pressureBias: 50, primaryMode: 'distanceStriking', fallbackMode: 'clinchGrind',
           favouriteTechniques: [{ techId: 'tech.jab', weight: 1.3 }, { techId: 'tech.cross', weight: 1.3 }],
           combos: [{ id: 'combo.one_two', sequence: ['tech.jab', 'tech.cross'], weight: 1.5 }, { id: 'combo.one_two_three', sequence: ['tech.jab', 'tech.cross', 'tech.lead_hook'], weight: 1.0 }],
           goToSubmissions: [{ subId: 'sub.rnc', weight: 1.0 }, { subId: 'sub.armbar_guard', weight: 0.8 }],
           takedowns: { prefs: [{ techId: 'tech.double_leg', weight: 1.0 }], setup: 'naked', cageBias: 0.1 },
           hurtBehaviour: 'coverOnCage', losingBehaviour: 'unchanged', tiredBehaviour: 'retreat', guardStyle: 'highGuard' } }
```
Derived check `[D]`: boxing mean 12.2 → T1 (0.5 yr → tierByYears T1, cap T2; **T1**), bjj T1 (mean 12),
mmaIntegration T0; `S(0.5, 0.8) = 10.0` matches the band; `experience 0.10`; `powerIndex.rearHand ≈ 2,998 N`;
`chinEff = 50 − 1.75 = 48.3`; `readP ≈ 0.59`; `SUBDEF = 0.7×16 + 0.2×14 + 0.1×8 = 14.8` → `beh.sub.untrained_no_tap`
still applies (knows the names, taps late). Active tells: `beh.box.repertoire_t1`, `beh.box.high_guard_only`,
`beh.box.hands_drop_after_punch`, `beh.gen.eyes_close_t1`, `beh.gen.pacing_t1`, `beh.wr.sprawl_late`.

### 4.9 `arch.regional_pro_allrounder` — "8-3 on the regional circuit, no glaring hole"

```ts
{ id: 'arch.regional_pro_allrounder',
  body: { heightM: 1.80, reachM: 1.84, legReachM: 1.03, weighInKg: 77.1, fightNightKg: 83.4, weightClass: 'wc.welterweight',
          ageYears: 27, bodyFatPct: 9, build: { ecto: 0.25, meso: 0.60, endo: 0.15 }, stance: 'orthodox' },
  physical: { strength: 58, explosiveness: 58, speed: 56, handSpeed: 58, kickSpeed: 56, cardio: 62, chin: 58,
              bodyToughness: 58, recovery: 58, flexibility: 54, balance: 58, reactionTime: 54, neck: 56 },
  mental: { fightIQ: 52, aggression: 58, composure: 54, heart: 66, discipline: 58, adaptability: 50 },
  disciplines: {
    boxing: { yearsTrained: 6, trainingQuality: 1.0, styleTags: [], native: { jab: 60, power: 58, combinations: 56, headMovement: 50, footwork: 56, guard: 60, bodyWork: 50, counters: 50, feints: 48, ringCraft: 52 } },
    muayThai: { yearsTrained: 6, trainingQuality: 1.0, styleTags: [], native: { kicks: 60, teep: 54, knees: 56, elbows: 50, clinch: 54, checks: 56, catches: 46, hands: 58 } },
    wrestling: { yearsTrained: 6, trainingQuality: 1.0, styleTags: ['folkstyle'], native: { shots: 58, takedownDefence: 62, topControl: 58, scrambles: 56, cageWrestling: 60, clinch: 56, chains: 50, finishes: 54, getUps: 58, matReturns: 52 } },
    bjj: { yearsTrained: 6, trainingQuality: 1.0, styleTags: ['no-gi'], native: { guard: 56, passing: 56, topControl: 58, backControl: 56, chokes: 58, jointLocks: 52, legLocks: 34, escapes: 60, sweeps: 50, subDefence: 62, subAttack: 54, wrestleUps: 58 } },
    mmaIntegration: { yearsTrained: 6, trainingQuality: 1.0, styleTags: [], native: { levelChanges: 58, clinchStriking: 58, cageWork: 60, groundAndPound: 60, getUps: 58, transitions: 56, subDefenceUnderStrikes: 60, gameplanExecution: 56 } } },
  career: { pro: { wins: 8, losses: 3, draws: 0, noContests: 0, koWins: 3, subWins: 2, decWins: 3, koLosses: 1, subLosses: 1, decLosses: 1 },
            amateur: { wins: 5, losses: 2 }, titleFights: 0, bigFightComposure: 46, careerKnockdownsAbsorbed: 2, winStreak: 2 },
  style: { preferredRange: 'mid', initiative: 'balanced', pressureBias: 55, primaryMode: 'pressureStriking', fallbackMode: 'wrestleControl',
           favouriteTechniques: [{ techId: 'tech.jab', weight: 1.2 }, { techId: 'tech.low_kick_rear', weight: 1.3 }, { techId: 'tech.double_leg', weight: 1.1 }],
           combos: [{ id: 'combo.jab_cross_low', sequence: ['tech.jab', 'tech.cross', 'tech.low_kick_rear'], weight: 1.4 }],
           goToSubmissions: [{ subId: 'sub.rnc', weight: 1.4 }, { subId: 'sub.guillotine_high_elbow', weight: 1.0 }],
           takedowns: { prefs: [{ techId: 'tech.double_leg', weight: 1.2 }, { techId: 'tech.body_lock_td', weight: 1.0 }], setup: 'offSingleStrike', cageBias: 0.6 },
           hurtBehaviour: 'clinch', losingBehaviour: 'stealRound', tiredBehaviour: 'clinchRest', guardStyle: 'highGuard' } }
```
Derived check `[D]`: every discipline mean 54–58 → **T3** (6 yr → cap T3 anyway); mmaTier T3; iqTier 3;
`powerIndex.rearHand ≈ 4,336 N` (regional band 3,000–4,000 N `[S: FD §5]`, a little high because the
`physTerm` at 83 kg > 1); `chinEff = 58 − 3.5 − 3 − 2 = 49.5`; `readP ≈ 0.74`; `experience = 0.1 + 0.9(1 −
e^{−14.5/6}) = 0.92`. This is the **T3 vs T3 reference fighter** for the tier-prior rows of `FD §5`.

### 4.10 `arch.ageing_veteran` — "former champion at 38, chin gone, brain intact"

```ts
{ id: 'arch.ageing_veteran',
  body: { heightM: 1.88, reachM: 1.93, legReachM: 1.08, weighInKg: 93.0, fightNightKg: 101.0, weightClass: 'wc.light_heavyweight',
          ageYears: 38, bodyFatPct: 12, build: { ecto: 0.15, meso: 0.65, endo: 0.20 }, stance: 'orthodox' },
  physical: { strength: 74, explosiveness: 60, speed: 52, handSpeed: 66, kickSpeed: 54, cardio: 62, chin: 78,
              bodyToughness: 80, recovery: 50, flexibility: 42, balance: 74, reactionTime: 56, neck: 80 },
  mental: { fightIQ: 86, aggression: 50, composure: 90, heart: 88, discipline: 80, adaptability: 78 },
  disciplines: {
    boxing: { yearsTrained: 20, trainingQuality: 1.15, styleTags: [], native: { jab: 84, power: 80, combinations: 74, headMovement: 70, footwork: 66, guard: 82, bodyWork: 70, counters: 84, feints: 86, ringCraft: 88 } },
    wrestling: { yearsTrained: 16, trainingQuality: 1.1, styleTags: ['greco'], native: { shots: 62, takedownDefence: 84, topControl: 80, scrambles: 66, cageWrestling: 88, clinch: 88, chains: 62, finishes: 70, getUps: 74, matReturns: 78 } },
    bjj: { yearsTrained: 14, trainingQuality: 1.0, styleTags: ['no-gi'], native: { guard: 62, passing: 74, topControl: 80, backControl: 76, chokes: 72, jointLocks: 68, legLocks: 30, escapes: 78, sweeps: 52, subDefence: 86, subAttack: 66, wrestleUps: 74 } },
    muayThai: { yearsTrained: 8, trainingQuality: 1.0, styleTags: [], native: { kicks: 60, teep: 62, knees: 76, elbows: 78, clinch: 74, checks: 70, catches: 56, hands: 80 } },
    mmaIntegration: { yearsTrained: 18, trainingQuality: 1.15, styleTags: [], native: { levelChanges: 78, clinchStriking: 88, cageWork: 90, groundAndPound: 84, getUps: 76, transitions: 74, subDefenceUnderStrikes: 84, gameplanExecution: 90 } } },
  career: { pro: { wins: 28, losses: 9, draws: 0, noContests: 0, koWins: 14, subWins: 6, decWins: 8, koLosses: 4, subLosses: 1, decLosses: 4 },
            amateur: { wins: 4, losses: 1 }, titleFights: 6, bigFightComposure: 92, careerKnockdownsAbsorbed: 8, winStreak: 0,
            lastResult: 'loss', lastResultWasKoLoss: true, daysSinceLastBout: 240, stanceExposure: { orthodox: 28, southpaw: 9 } },
  style: { preferredRange: 'clinch', initiative: 'counter', pressureBias: 40, primaryMode: 'clinchGrind', fallbackMode: 'counter',
           favouriteTechniques: [{ techId: 'tech.jab', weight: 1.3 }, { techId: 'tech.clinch_elbow', weight: 1.4 }, { techId: 'tech.body_lock_td', weight: 1.3 }],
           combos: [{ id: 'combo.jab_clinch', sequence: ['tech.jab', 'tech.clinch_entry_underhook'], weight: 1.4 }, { id: 'combo.check_hook', sequence: ['def.pivot', 'tech.check_hook'], weight: 1.2 }],
           goToSubmissions: [{ subId: 'sub.arm_triangle', weight: 1.3 }, { subId: 'sub.rnc', weight: 1.2 }],
           takedowns: { prefs: [{ techId: 'tech.body_lock_td', weight: 1.5 }, { techId: 'tech.inside_trip', weight: 1.2 }], setup: 'offClinch', cageBias: 0.9 },
           hurtBehaviour: 'clinch', losingBehaviour: 'stealRound', tiredBehaviour: 'clinchRest', guardStyle: 'highGuard' } }
```
Derived check `[D]`: boxing T4 (mean 78.4), wrestling T4 (mean 75.2), bjj T4 (mean 68 → T3 by skill; **T3**),
muayThai T3, mmaIntegration T4 (mean 83); iqTier 4. Age 38 multipliers: explosiveness ×0.87 (−1 %/yr 29–33,
−2 %/yr 34–38 → 0.95 × 0.90 ≈ 0.86 → **52**), speed ×0.86 → 45, handSpeed → 57, strength ×0.965 → 71, cardio
×0.938 → 58, recovery ×0.82 → 41. `chinEff = 78 − 28.75 (age) − 12 (4 KO losses) − 5 (8 KDs, cap 5) = 32.3`;
`kKOHistoryMult = 2.0`; layoff 240 d → `composureEff −8` etc.; `lastResultWasKoLoss` at 240 d does **not** trigger
the < 60-d rule. Skills and IQ untouched by age. `powerIndex.rearHand ≈ 5,627 N` at stored attributes (≈ 5,300 N
after age multipliers `[D]`). This is calibration archetype C-3 (§6).

### 4.11 `arch.heavyweight_power_puncher` — "one-punch heavyweight, 118 kg, two-round gas tank"

```ts
{ id: 'arch.heavyweight_power_puncher',
  body: { heightM: 1.93, reachM: 2.01, legReachM: 1.12, weighInKg: 117.0, fightNightKg: 118.0, weightClass: 'wc.heavyweight',
          ageYears: 31, bodyFatPct: 18, build: { ecto: 0.05, meso: 0.55, endo: 0.40 }, stance: 'orthodox' },
  physical: { strength: 82, explosiveness: 70, speed: 40, handSpeed: 64, kickSpeed: 42, cardio: 38, chin: 62,
              bodyToughness: 66, recovery: 44, flexibility: 34, balance: 56, reactionTime: 50, neck: 86 },
  mental: { fightIQ: 48, aggression: 74, composure: 60, heart: 64, discipline: 46, adaptability: 44 },
  disciplines: {
    boxing: { yearsTrained: 10, trainingQuality: 1.0, styleTags: [], native: { jab: 56, power: 84, combinations: 48, headMovement: 40, footwork: 42, guard: 54, bodyWork: 44, counters: 58, feints: 46, ringCraft: 50 } },
    kickboxing: { yearsTrained: 4, trainingQuality: 0.9, styleTags: [], native: { punches: 80, kicks: 40, lowKicks: 52, combinations: 44, footwork: 40, checks: 38, spinning: 10, defence: 46 } },
    wrestling: { yearsTrained: 5, trainingQuality: 0.9, styleTags: [], native: { shots: 30, takedownDefence: 58, topControl: 56, scrambles: 34, cageWrestling: 60, clinch: 58, chains: 20, finishes: 36, getUps: 44, matReturns: 40 } },
    bjj: { yearsTrained: 5, trainingQuality: 0.8, styleTags: [], native: { guard: 30, passing: 40, topControl: 52, backControl: 34, chokes: 36, jointLocks: 30, legLocks: 8, escapes: 40, sweeps: 24, subDefence: 46, subAttack: 26, wrestleUps: 40 } },
    mmaIntegration: { yearsTrained: 7, trainingQuality: 1.0, styleTags: [], native: { levelChanges: 34, clinchStriking: 62, cageWork: 56, groundAndPound: 70, getUps: 44, transitions: 38, subDefenceUnderStrikes: 44, gameplanExecution: 44 } } },
  career: { pro: { wins: 15, losses: 5, draws: 0, noContests: 0, koWins: 13, subWins: 0, decWins: 2, koLosses: 2, subLosses: 1, decLosses: 2 },
            amateur: { wins: 2, losses: 1 }, titleFights: 0, bigFightComposure: 52, careerKnockdownsAbsorbed: 4, winStreak: 3,
            weightCut: { cutPct: 1, regainPct: 1, residualDehydration: 0 } },
  style: { preferredRange: 'mid', initiative: 'pressure', pressureBias: 62, primaryMode: 'pressureStriking', fallbackMode: 'clinchGrind',
           favouriteTechniques: [{ techId: 'tech.overhand_rear', weight: 1.7 }, { techId: 'tech.lead_hook', weight: 1.4 }, { techId: 'tech.uppercut_rear', weight: 1.2 }, { techId: 'tech.jab', weight: 0.9 }],
           combos: [{ id: 'combo.jab_overhand', sequence: ['tech.jab', 'tech.overhand_rear'], weight: 1.5 }, { id: 'combo.hook_cross', sequence: ['tech.lead_hook', 'tech.cross'], weight: 1.2 }],
           goToSubmissions: [],
           takedowns: { prefs: [{ techId: 'tech.body_lock_td', weight: 1.0 }], setup: 'offClinch', cageBias: 0.7 },
           hurtBehaviour: 'trade', losingBehaviour: 'finishSeek', tiredBehaviour: 'gamble', guardStyle: 'highGuard',
           pacing: [{ round: 1, outputMult: 1.15, riskAppetite: 0.8 }, { round: 2, outputMult: 0.9, riskAppetite: 0.7 }, { round: 3, outputMult: 0.7, riskAppetite: 0.9 }] } }
```
Derived check `[D]`: boxing mean 52.2 → T3 (10 yr → cap ok), kickboxing T2, wrestling T2, bjj T2, mmaIntegration
T2 (mean 49); `physTerm = (118/77.1)^0.5 × (0.7 + 0.3 × 82/50)^0.5 × (0.7 + 0.3 × 70/50)^0.5 = 1.237 × 1.09 × 1.058
= 1.43`; `powerIndex.rearHand = 4800 × techGate(84) × 1.43 × 1.011 ≈ 5,958 N` — the highest of the presets by
mass, not skill; `energy.pcrRefillHalfLifeS = 30 × (1.35 − 0.266) = 32.5 s`; `chinEff = 62 − 11.25 − 6 − 4 = 40.8`;
`readP ≈ 0.70`; `reachLeverage 1.0` (HW). Expected 05 outcome: highest KD-per-landed-power-strike of the
presets both dealt and absorbed (HW 52.1 % KO/TKO share `[S: DP §1]`).

### 4.12 `arch.flyweight_volume_striker` — "8 significant strikes a minute, never stops moving"

```ts
{ id: 'arch.flyweight_volume_striker',
  body: { heightM: 1.65, reachM: 1.68, legReachM: 0.94, weighInKg: 56.7, fightNightKg: 61.9, weightClass: 'wc.flyweight',
          ageYears: 26, bodyFatPct: 7, build: { ecto: 0.45, meso: 0.50, endo: 0.05 }, stance: 'switch' },
  physical: { strength: 44, explosiveness: 80, speed: 92, handSpeed: 88, kickSpeed: 84, cardio: 92, chin: 64,
              bodyToughness: 62, recovery: 86, flexibility: 78, balance: 82, reactionTime: 72, neck: 48 },
  mental: { fightIQ: 66, aggression: 70, composure: 74, heart: 76, discipline: 72, adaptability: 68 },
  disciplines: {
    kickboxing: { yearsTrained: 12, trainingQuality: 1.1, styleTags: ['dutch'], native: { punches: 76, kicks: 80, lowKicks: 84, combinations: 90, footwork: 92, checks: 76, spinning: 62, defence: 74 } },
    boxing: { yearsTrained: 6, trainingQuality: 1.0, styleTags: [], native: { jab: 78, power: 56, combinations: 84, headMovement: 66, footwork: 90, guard: 62, bodyWork: 64, counters: 62, feints: 72, ringCraft: 70 } },
    wrestling: { yearsTrained: 6, trainingQuality: 1.0, styleTags: ['freestyle'], native: { shots: 48, takedownDefence: 74, topControl: 46, scrambles: 70, cageWrestling: 58, clinch: 52, chains: 40, finishes: 44, getUps: 78, matReturns: 34 } },
    bjj: { yearsTrained: 6, trainingQuality: 0.9, styleTags: [], native: { guard: 60, passing: 44, topControl: 44, backControl: 50, chokes: 54, jointLocks: 40, legLocks: 20, escapes: 70, sweeps: 52, subDefence: 66, subAttack: 40, wrestleUps: 76 } },
    mmaIntegration: { yearsTrained: 7, trainingQuality: 1.05, styleTags: [], native: { levelChanges: 60, clinchStriking: 58, cageWork: 70, groundAndPound: 52, getUps: 78, transitions: 66, subDefenceUnderStrikes: 64, gameplanExecution: 66 } } },
  career: { pro: { wins: 13, losses: 3, draws: 0, noContests: 0, koWins: 3, subWins: 2, decWins: 8, koLosses: 0, subLosses: 1, decLosses: 2 },
            amateur: { wins: 9, losses: 2 }, titleFights: 0, bigFightComposure: 66, careerKnockdownsAbsorbed: 1, winStreak: 3 },
  style: { preferredRange: 'long', initiative: 'pressure', pressureBias: 72, primaryMode: 'distanceStriking', fallbackMode: 'pressureStriking',
           favouriteTechniques: [{ techId: 'tech.jab', weight: 1.4 }, { techId: 'tech.low_kick_rear', weight: 1.4 }, { techId: 'tech.calf_kick', weight: 1.3 }, { techId: 'tech.switch_kick_body', weight: 1.2 }],
           combos: [{ id: 'combo.dutch_1', sequence: ['tech.jab', 'tech.cross', 'tech.lead_hook', 'tech.low_kick_rear'], weight: 1.6 },
                    { id: 'combo.dutch_2', sequence: ['tech.cross', 'tech.lead_hook', 'tech.round_kick_body_rear'], weight: 1.4 },
                    { id: 'combo.jab_jab_switch', sequence: ['tech.jab', 'tech.jab', 'tech.switch_kick_body'], weight: 1.2 }],
           goToSubmissions: [{ subId: 'sub.rnc', weight: 1.2 }],
           takedowns: { prefs: [{ techId: 'tech.double_leg', weight: 0.8 }], setup: 'offCombination', cageBias: 0.4 },
           hurtBehaviour: 'circleOut', losingBehaviour: 'stealRound', tiredBehaviour: 'coast', stanceSwitching: 60, guardStyle: 'hybrid', thaiStyle: 'dutch' } }
```
Derived check `[D]`: kickboxing T4 (mean 79.3), boxing T3 (mean 70.4 → T4 by skill; 6 yr + transfer → cap T4;
**T4**), wrestling T3, bjj T3, mmaIntegration T3; `powerIndex.rearHand ≈ 4,142 N` (light but technically sharp;
mass term 0.90); `chinEff = 64 − 1.75 − 0 − 1 = 61.3`; `energy.pcrRefillHalfLifeS = 30 × (1.35 − 0.644) = 21.2 s`,
`breakRefillFrac = 0.60 × 1.108 = 0.665`; `paceAgeMult 1.0`; `attackShare 0.45`; pace target × 1.08. Expected 02
output ≈ 8–9 sig attempts/min (FLW class 7.8 `[S: FD #12]`).

### 4.13 `arch.sambo_grappler` — "combat sambo master of sport, lightweight"

```ts
{ id: 'arch.sambo_grappler',
  body: { heightM: 1.75, reachM: 1.78, legReachM: 1.00, weighInKg: 70.3, fightNightKg: 76.3, weightClass: 'wc.lightweight',
          ageYears: 28, bodyFatPct: 8, build: { ecto: 0.15, meso: 0.75, endo: 0.10 }, stance: 'orthodox' },
  physical: { strength: 72, explosiveness: 70, speed: 60, handSpeed: 56, kickSpeed: 50, cardio: 82, chin: 66,
              bodyToughness: 78, recovery: 78, flexibility: 56, balance: 86, reactionTime: 56, neck: 76 },
  mental: { fightIQ: 70, aggression: 72, composure: 84, heart: 84, discipline: 86, adaptability: 58 },
  disciplines: {
    sambo: { yearsTrained: 20, trainingQuality: 1.15, styleTags: ['combat'], native: { throws: 90, takedowns: 88, legLocks: 74, gripFighting: 86, topControl: 90, transitions: 84, strikingToGrappling: 88 } },
    wrestling: { yearsTrained: 8, trainingQuality: 1.05, styleTags: ['freestyle'], native: { shots: 74, takedownDefence: 84, topControl: 86, scrambles: 76, cageWrestling: 86, clinch: 82, chains: 78, finishes: 80, getUps: 74, matReturns: 84 } },
    judo: { yearsTrained: 6, trainingQuality: 1.0, styleTags: [], native: { gripFighting: 70, throws: 74, footSweeps: 66, counters: 62, kuzushi: 68, newaza: 56, ukemi: 80 } },
    bjj: { yearsTrained: 6, trainingQuality: 1.0, styleTags: ['no-gi'], native: { guard: 44, passing: 68, topControl: 84, backControl: 72, chokes: 62, jointLocks: 66, legLocks: 70, escapes: 66, sweeps: 40, subDefence: 76, subAttack: 62, wrestleUps: 70 } },
    boxing: { yearsTrained: 5, trainingQuality: 1.0, styleTags: [], native: { jab: 50, power: 54, combinations: 40, headMovement: 34, footwork: 44, guard: 56, bodyWork: 36, counters: 40, feints: 44, ringCraft: 46 } },
    mmaIntegration: { yearsTrained: 7, trainingQuality: 1.15, styleTags: [], native: { levelChanges: 84, clinchStriking: 72, cageWork: 88, groundAndPound: 86, getUps: 70, transitions: 82, subDefenceUnderStrikes: 74, gameplanExecution: 78 } } },
  career: { pro: { wins: 16, losses: 1, draws: 0, noContests: 0, koWins: 5, subWins: 6, decWins: 5, koLosses: 0, subLosses: 0, decLosses: 1 },
            amateur: { wins: 30, losses: 6 }, titleFights: 0, bigFightComposure: 80, careerKnockdownsAbsorbed: 0, winStreak: 9 },
  style: { preferredRange: 'clinch', initiative: 'pressure', pressureBias: 78, primaryMode: 'wrestleControl', fallbackMode: 'clinchGrind',
           favouriteTechniques: [{ techId: 'tech.overhand_rear', weight: 1.3 }, { techId: 'tech.single_leg', weight: 1.4 }, { techId: 'tech.body_lock_td', weight: 1.4 }, { techId: 'tech.gnp_cross', weight: 1.4 }],
           combos: [{ id: 'combo.overhand_shoot', sequence: ['tech.overhand_rear', 'tech.double_leg'], weight: 1.5 }, { id: 'combo.cage_trip', sequence: ['tech.clinch_entry_underhook', 'tech.inside_trip'], weight: 1.4 }],
           goToSubmissions: [{ subId: 'sub.rnc', weight: 1.3 }, { subId: 'sub.kimura', weight: 1.2 }, { subId: 'sub.knee_bar', weight: 0.9 }],
           takedowns: { prefs: [{ techId: 'tech.single_leg', weight: 1.4 }, { techId: 'tech.body_lock_td', weight: 1.4 }, { techId: 'tech.inside_trip', weight: 1.2 }, { techId: 'tech.double_leg', weight: 1.0 }], setup: 'offSingleStrike', cageBias: 0.9 },
           hurtBehaviour: 'shoot', losingBehaviour: 'unchanged', tiredBehaviour: 'clinchRest', guardStyle: 'highGuard' } }
```
Derived check `[D]`: sambo T4 (mean 85.7), wrestling T4 (mean 80.4; 8 yr + transfer years → T4), judo T3, bjj T3
(mean 65.3), boxing T2, mmaIntegration T4 (mean 79); `powerIndex.rearHand ≈ 4,203 N`; `chinEff = 66 − 5.25 = 60.8`;
`readP_takedown` (wrestling.takedownDefence 84) `= 0.55 + 0.277 + 0.012 = 0.84`; `tdDefenceBase = 0.5×84 + 0.2×86 +
0.15×72 + 0.15×88 = 83.2`; `experience 0.99`; `beh.wr.sprawl_rate` T4 band (80–90 %).

### 4.14 `arch.tkd_convert` — "the legacy Athlete A: 5 years TKD, 3 years boxing, strong for his size, age 20"

```ts
{ id: 'arch.tkd_convert',   // legacy.toFighter(ATHLETE_A) with creator-spread sub-skills
  body: { heightM: 1.778, reachM: 1.824, legReachM: 1.022, weighInKg: 90.7, fightNightKg: 90.7, weightClass: 'wc.super_middleweight',
          ageYears: 20, bodyFatPct: 12, build: { ecto: 0.20, meso: 0.62, endo: 0.18 }, stance: 'orthodox' },
  physical: { strength: 74, explosiveness: 64, speed: 57, handSpeed: 54, kickSpeed: 62, cardio: 70, chin: 50,
              bodyToughness: 50, recovery: 70, flexibility: 60, balance: 58, reactionTime: 50, neck: 55 },
  mental: { fightIQ: 42, aggression: 55, composure: 47, heart: 50, discipline: 70, adaptability: 49 },
  disciplines: {
    taekwondo: { yearsTrained: 5, trainingQuality: 0.9, styleTags: ['WT sport'], native: { kicks: 56, headKicks: 60, spinning: 58, footwork: 54, distance: 52, counters: 44 } },
    boxing: { yearsTrained: 3, trainingQuality: 0.9, styleTags: [], native: { jab: 46, power: 44, combinations: 40, headMovement: 34, footwork: 42, guard: 46, bodyWork: 34, counters: 36, feints: 32, ringCraft: 30 } },
    mmaIntegration: { yearsTrained: 0, trainingQuality: 0.9, styleTags: [], native: { levelChanges: 5, clinchStriking: 5, cageWork: 5, groundAndPound: 5, getUps: 5, transitions: 5, subDefenceUnderStrikes: 5, gameplanExecution: 5 } } },
  career: { pro: { wins: 0, losses: 0, draws: 0, noContests: 0, koWins: 0, subWins: 0, decWins: 0, koLosses: 0, subLosses: 0, decLosses: 0 },
            amateur: { wins: 0, losses: 0 }, titleFights: 0, bigFightComposure: 30, careerKnockdownsAbsorbed: 0, winStreak: 0,
            daysSinceLastBout: 0, weightCut: { cutPct: 0, regainPct: 0, residualDehydration: 0 } },
  style: { preferredRange: 'long', initiative: 'counter', pressureBias: 40, primaryMode: 'distanceStriking', fallbackMode: 'pressureStriking',
           favouriteTechniques: [{ techId: 'tech.round_kick_head_rear', weight: 1.3 }, { techId: 'tech.side_kick', weight: 1.2 }, { techId: 'tech.jab', weight: 1.1 }],
           combos: [{ id: 'combo.jab_cross', sequence: ['tech.jab', 'tech.cross'], weight: 1.2 }, { id: 'combo.jab_body_kick', sequence: ['tech.jab', 'tech.round_kick_body_rear'], weight: 1.1 }],
           goToSubmissions: [],
           takedowns: { prefs: [], setup: 'naked', cageBias: 0.0 },
           hurtBehaviour: 'coverOnCage', losingBehaviour: 'unchanged', tiredBehaviour: 'retreat', guardStyle: 'highGuard' } }
```
Derived check `[D]`: taekwondo mean 54 → T3 (5 yr → cap T3), boxing mean 38.4 → T2, kickboxing **transferred**
(kicks 0.6 × 56 = 33.6, punches 0.9 × 44 = 39.6, footwork 0.8 × 42 = 33.6, spinning 0.85 × 58 = 49.3, …) mean ≈ 30
→ T2 with transfer years 0.5 × (5 × 0.6 + 3 × 0.9) = 2.85 → cap T2+1 = T3 → **T2**; wrestling/bjj T0 (all 5) →
`beh.wr.sprawl_late`, `beh.bjj.bottom_t0` active despite competent striking (the "striker with no ground game"
case the legacy model could not express). `powerIndex.rearHand ≈ 4,333 N` (strong, untechnical: techGate(44) = 0.76,
physTerm 1.19); `chinEff = 50`; `readP ≈ 0.66`; `experience 0.10` → full adrenaline dump in R1.

### 4.15 `arch.champion_complete` — "the T5 reference: complete lightweight champion"

```ts
{ id: 'arch.champion_complete',
  body: { heightM: 1.78, reachM: 1.83, legReachM: 1.03, weighInKg: 70.3, fightNightKg: 76.3, weightClass: 'wc.lightweight',
          ageYears: 30, bodyFatPct: 7, build: { ecto: 0.30, meso: 0.62, endo: 0.08 }, stance: 'switch' },
  physical: { strength: 70, explosiveness: 82, speed: 80, handSpeed: 82, kickSpeed: 78, cardio: 90, chin: 80,
              bodyToughness: 80, recovery: 84, flexibility: 74, balance: 90, reactionTime: 68, neck: 78 },
  mental: { fightIQ: 94, aggression: 60, composure: 94, heart: 92, discipline: 92, adaptability: 90 },
  disciplines: {
    boxing: { yearsTrained: 14, trainingQuality: 1.15, styleTags: [], native: { jab: 92, power: 84, combinations: 88, headMovement: 86, footwork: 92, guard: 88, bodyWork: 82, counters: 92, feints: 94, ringCraft: 92 } },
    muayThai: { yearsTrained: 10, trainingQuality: 1.1, styleTags: [], native: { kicks: 86, teep: 84, knees: 86, elbows: 84, clinch: 82, checks: 88, catches: 78, hands: 88 } },
    wrestling: { yearsTrained: 14, trainingQuality: 1.15, styleTags: ['folkstyle'], native: { shots: 86, takedownDefence: 94, topControl: 88, scrambles: 90, cageWrestling: 90, clinch: 86, chains: 86, finishes: 84, getUps: 92, matReturns: 84 } },
    bjj: { yearsTrained: 12, trainingQuality: 1.1, styleTags: ['no-gi'], native: { guard: 82, passing: 86, topControl: 90, backControl: 92, chokes: 90, jointLocks: 80, legLocks: 60, escapes: 92, sweeps: 78, subDefence: 96, subAttack: 84, wrestleUps: 94 } },
    mmaIntegration: { yearsTrained: 14, trainingQuality: 1.15, styleTags: [], native: { levelChanges: 94, clinchStriking: 88, cageWork: 94, groundAndPound: 90, getUps: 94, transitions: 92, subDefenceUnderStrikes: 94, gameplanExecution: 96 } } },
  career: { pro: { wins: 26, losses: 1, draws: 0, noContests: 0, koWins: 10, subWins: 8, decWins: 8, koLosses: 0, subLosses: 0, decLosses: 1 },
            amateur: { wins: 12, losses: 1 }, titleFights: 7, bigFightComposure: 96, careerKnockdownsAbsorbed: 1, winStreak: 14 },
  style: { preferredRange: 'mid', initiative: 'balanced', pressureBias: 55, primaryMode: 'distanceStriking', fallbackMode: 'wrestleControl',
           favouriteTechniques: [{ techId: 'tech.jab', weight: 1.3 }, { techId: 'tech.cross', weight: 1.2 }, { techId: 'tech.low_kick_rear', weight: 1.2 }, { techId: 'tech.double_leg', weight: 1.2 }],
           combos: [{ id: 'combo.feint_level_cross', sequence: ['tech.feint_level', 'tech.cross'], weight: 1.5 }, { id: 'combo.jab_cross_double', sequence: ['tech.jab', 'tech.cross', 'tech.double_leg'], weight: 1.4 }, { id: 'combo.body_kick_cross', sequence: ['tech.round_kick_body_rear', 'tech.cross'], weight: 1.2 }],
           goToSubmissions: [{ subId: 'sub.rnc', weight: 1.5 }, { subId: 'sub.arm_triangle', weight: 1.2 }, { subId: 'sub.guillotine_high_elbow', weight: 1.0 }],
           takedowns: { prefs: [{ techId: 'tech.double_leg', weight: 1.3 }, { techId: 'tech.single_leg', weight: 1.1 }, { techId: 'tech.body_lock_td', weight: 1.2 }], setup: 'offFeint', cageBias: 0.7 },
           hurtBehaviour: 'counter', losingBehaviour: 'stealRound', tiredBehaviour: 'clinchRest', stanceSwitching: 50, guardStyle: 'hybrid' } }
```
Derived check `[D]`: mmaIntegration mean 92.8, IQ 94 ≥ 80, composure 94 ≥ 75 → **T5**; wrestling mean 88 → T4;
boxing 89 → T4; bjj 85.3 → T4; muayThai 84.5 → T4; `mmaMean = 0.35×89 + 0.35×88 + 0.30×92.8 = 89.8` → mmaTier T4
by skill but the T5 gate is evaluated on the *integration* discipline → **mmaTier T5**; iqTier 5.
`powerIndex.rearHand ≈ 5,385 N`; `chinEff = 80 − 8.75 − 0 − 1 = 70.3`; `readP_striking ≈ 0.86`, `counterOnReadP
= 0.51`, `feintBiteP = 0.28`; `stubbornness = 0.05 × 1.42 = 0.071`. Expected against `arch.regional_pro_allrounder`:
favourite win rate ≥ 88 % (odds bucket −400 to −900 `[S: FD #115]`) — calibration hook C-1.

### 4.16 Preset summary

| id | Class | Age | Striking tier | Grappling tier | mmaTier | iqTier | rearHand N `[D]` | chinEff `[D]` |
|---|---|---|---|---|---|---|---|---|
| arch.elite_wrestler_boxer | WW | 29 | T3 (box) | T4 (wr) | T4 | 4 | 5,295 | 62.0 |
| arch.thai_striker | LW | 27 | T4 (mt) | T2 | T3 | 3 | 4,463 | 57.5 |
| arch.bjj_guard_player | FW | 31 | T2 | T4 (bjj) | T3 | 4 | 3,508 | 42.5 |
| arch.judoka | MW | 30 | T2 | T4 (ju) | T3 | 3 | 4,624 | 54.3 |
| arch.pressure_boxer | LW | 28 | T4 (box) | T2 | T3 | 3 | 4,974 | 68.8 |
| arch.counter_striker | MW | 33 | T5 (karate) | T2 | T3 | 4 | 5,152 | 43.8 |
| arch.brand_new_brawler | CW (open) | 24 | T0 | T0 | T0 | 1 | 2,654 | 50.0 |
| arch.gym_fit_beginner | SWW (open) | 26 | T1 | T1 | T0 | 2 | 2,998 | 48.3 |
| arch.regional_pro_allrounder | WW | 27 | T3 | T3 | T3 | 3 | 4,336 | 49.5 |
| arch.ageing_veteran | LHW | 38 | T4 (box) | T4 (wr) | T4 | 4 | 5,627 | 32.3 |
| arch.heavyweight_power_puncher | HW | 31 | T3 (box) | T2 | T2 | 2 | 5,958 | 40.8 |
| arch.flyweight_volume_striker | FLW | 26 | T4 (kb) | T3 | T3 | 3 | 4,142 | 61.3 |
| arch.sambo_grappler | LW | 28 | T2 | T4 (sambo/wr) | T4 | 4 | 4,203 | 60.8 |
| arch.tkd_convert | SMW (open) | 20 | T3 (tkd) | T0 | T1 | 2 | 4,333 | 50.0 |
| arch.champion_complete | LW | 30 | T4 | T4 | T5 | 5 | 5,385 | 70.3 |

`mmaTier` for the mixed cases follows `mmaMean` (§2.3.4); e.g. `arch.tkd_convert`: 0.35×54 + 0.35×5 + 0.30×5 =
22.2 → T1 `[D]`.

---

## 5. Parameter registry

Becomes `src/engine/params/fighterModel.ts`. Every number introduced by this section is registered; the
catalogue rows of §3 are registered under their rule id (`beh.<domain>.<name>.<param>`), and the transfer factors
under `xfer.<id>` (§2.3.3, 56 rows, not repeated). Units: `pts` = attribute points (0–100), `–` = dimensionless.

### 5.1 Body, generation, rig

| id | value | unit | tag |
|---|---|---|---|
| `fm.body.regain_pct.bantamweight` | 9.7 | % | `[S: LIT_B §2.8]` |
| `fm.body.regain_pct.flyweight` | 9.4 | % | `[S: LIT_B §2.8]` |
| `fm.body.regain_pct.atomweight` | 9.4 | % | `[S: LIT_B §2.8]` |
| `fm.body.regain_pct.featherweight` | 9.0 | % | `[S: LIT_B §2.8]` |
| `fm.body.regain_pct.lightweight` | 8.5 | % | `[S: LIT_B §2.8]` |
| `fm.body.regain_pct.welterweight` | 8.2 | % | `[S: LIT_B §2.8]` |
| `fm.body.regain_pct.strawweight` | 8.1 | % | `[S: LIT_B §2.8]` |
| `fm.body.regain_pct.middleweight` | 5.8 | % | `[S: LIT_B §2.8]` |
| `fm.body.regain_pct.light_heavyweight` | 4.5 | % | `[E]` |
| `fm.body.regain_pct.heavyweight` | 3.0 | % | `[E]` (`LIT_B §2.8` "smallest") |
| `fm.body.regain_pct.default_other` | 8.0 | % | `[E]` |
| `fm.gen.stature_mean` | 177.5 | cm | `[S: LIT_B §2.4]` |
| `fm.gen.stature_sd` | 9.5 | cm | `[S: LIT_B §2.4]` |
| `fm.gen.ape_index_mean` | 1.026 | – | `[S: LIT_B §2.4]` |
| `fm.gen.ape_index_sd` | 0.028 | – | `[S: LIT_B §2.4]` |
| `fm.gen.leg_reach_ratio_mean` | 0.575 | – | `[E]` |
| `fm.gen.leg_reach_ratio_sd` | 0.020 | – | `[E]` |
| `fm.gen.height_by_class` | FLW 1.66 · BW 1.69 · FW 1.72 · LW 1.76 · WW 1.80 · MW 1.83 · LHW 1.87 · HW 1.90 (σ 0.05) | m | `[E]` |
| `fm.gen.bodyfat_by_class` | FLW–LW 8 · WW–MW 9 · LHW 10 · HW 14 · untrained 18–25 | % | `[E]` |
| `fm.gen.p_stance` | orthodox 0.766 · southpaw 0.171 · switch 0.061 | – | `[S: FD §2.4]` |
| `fm.gen.p_left_handed` | male 0.126 · female 0.099 | – | `[S: LIT_B §3.16]` |
| `fm.gen.p_left_given_southpaw` | 0.60 | – | `[E]` |
| `fm.rig.shoulder_ratio` | 0.20 | × height | `[E]` |
| `fm.rig.shoulder_meso_gain` | 0.16 | – | `[E]` |
| `fm.rig.arm_split` | 0.42 / 0.33 / 0.25 | – | `[E]` |
| `fm.rig.leg_split` | 0.47 / 0.44 / 0.09 | – | `[E]` |
| `fm.rig.head_ratio` | 0.13 | × height | `[E]` |
| `fm.rig.neck_ratio` | 0.05 | × height | `[E]` |
| `fm.rig.torso_floor_ratio` | 0.26 | × height | `[E]` |
| `fm.rig.ref_bmi` | 23.5 | kg/m² | `[E]` |
| `fm.rig.waist_per_fat_pct` | 0.012 | – | `[E]` |
| `fm.rig.chest_meso_gain` | 0.08 | – | `[E]` |
| `fm.rig.chest_ecto_loss` | 0.04 | – | `[E]` |
| `fm.rig.definition_fat_cap` | 25 | % | `[E]` |
| `fm.rig.arm_reach_shoulder_ratio` | 0.20 | × height | `[E]` (same as shoulder_ratio; used in `effectiveReachM`) |

### 5.2 Physical attribute mappings

| id | value | unit | tag |
|---|---|---|---|
| `fm.attr.rt_base_ms` | 225 | ms | `[S: BOX §7]` (200–250 band) |
| `fm.attr.rt_slope_ms_per_pt` | 0.65 | ms/pt | `[E]` |
| `fm.attr.foot_speed_base` | 2.0 | m/s | `[E]` (legacy 1.7 + 0.45 `[S: AUDIT]`) |
| `fm.attr.foot_speed_slope` | 0.0133 | m/s per pt | `[E]` |
| `fm.attr.hand_speed_base` | 8.0 | m/s | `[E]` |
| `fm.attr.hand_speed_slope` | 0.0433 | m/s per pt | `[E]` (80 → 9.3 ≈ 9.14 `[S: DP §3.1]`) |
| `fm.attr.kick_speed_base` | 6.5 | m/s | `[E]` |
| `fm.attr.kick_speed_slope` | 0.0267 | m/s per pt | `[E]` (80 → 7.3 ≈ 7.22 `[S: MT §7.1]`) |
| `fm.attr.toughness_threshold_range` | 0.50 | – (±25 %) | `[S: DP §7 r22]` |
| `fm.attr.recovery_halflife_range` | 0.60 | – (±30 %) | `[S: DP §7 r22]` |
| `fm.attr.neck_mult_a` | 1.15 | – | `[S: DP §3.2]` |
| `fm.attr.neck_mult_b` | 0.30 | – | `[S: DP §3.2]` |
| `fm.attr.flex_kick_base` | 0.80 | – | `[E]` |
| `fm.attr.flex_kick_slope` | 0.25 | – | `[E]` |
| `fm.attr.balance_stumble_a` | 1.6 | – | `[E]` |
| `fm.attr.balance_stumble_b` | 1.2 | – | `[E]` |
| `fm.attr.chin_z_per_pt` | 0.02 | z per pt | `[S: DP §3.2]` (`(chin − 0.5) × 2`) |
| `fm.attr.strength_rel_ref` | 4.0 | × BW | `[E]` |
| `fm.attr.strength_rel_slope` | 60 | pts per log2 | `[E]` |

### 5.3 Age curves

Format per attribute: `rise%/yr from 18 | peakStart–peakEnd | declineA %/yr | declineB from age : %/yr`.

| id | value | unit | tag |
|---|---|---|---|
| `fm.age.explosiveness` | 2.0 · 23–28 · 1.0 · 34 : 2.0 | see fmt | `[E]` |
| `fm.age.speed` / `.handSpeed` / `.kickSpeed` | 1.5 · 23–29 · 1.0 · 34 : 2.0 | | `[E]`; `[S: LIT_B §5.8]` direction |
| `fm.age.strength` | 2.5 · 26–33 · 0.7 · 39 : 1.5 | | `[E]` |
| `fm.age.cardio` | 1.0 · 24–31 · 0.8 · 36 : 1.5 | | `[E]` |
| `fm.age.recovery` | 0 · 18–27 · 1.0 · 34 : 2.5 | | `[E]`; `[S: MIS §4.5]` bound |
| `fm.age.flexibility` | 0 · 18–25 · 0.7 · 35 : 1.2 | | `[E]` |
| `fm.age.balance` | 0 · 18–34 · 0 · 35 : 0.8 | | `[E]` |
| `fm.age.reactionTime` | 0 · 18–30 · 0.5 · — | | `[E]` |
| `fm.age.chin.start` | 25 | yr | `[S: FD §4]` (≤25 = 1.0) |
| `fm.age.chin.slope1` | 1.75 | pts/yr (25–30) | `[D]` |
| `fm.age.chin.knee` | 30 | yr | `[S: FD §4]` |
| `fm.age.chin.slope2` | 2.5 | pts/yr (30–40) | `[D]` |
| `fm.age.chin.cap` | 34 | pts | `[D]` |
| `fm.age.chin.attenuation` | 0.6 | – | `[E]` |
| `fm.age.exposure_rt_per_fight` | 0.1 | pts per pro fight > 10 | `[E]` |
| `fm.age.pace_slope` | 0.015 | per yr > 33 | `[S: LIT_B §5.8]` |
| `fm.age.pace_start` | 33 | yr | `[E]` |

### 5.4 Skill, tiers, transfer

| id | value | unit | tag |
|---|---|---|---|
| `fm.skill.years_tau` | 3.5 | yr | `[E]` (fits `CONV §3`) |
| `fm.skill.quality` | hobbyist 0.6 · regular 0.8 · amateur 0.9 · pro 1.0 · elite 1.15 | – | `[E]` |
| `fm.skill.spread_sd` | 8 | pts | `[E]` |
| `fm.skill.untrained_default` | 5 | pts | `[E]` |
| `fm.tier.bands` | 10 / 30 / 50 / 70 / 90 | pts | `[S: CONV §3]` |
| `fm.tier.years_bands` | 0.25 / 1 / 4 / 8 | yr | `[S: CONV §3]` |
| `fm.tier.years_cap_offset` | +1 | tier | `[E]` |
| `fm.tier.transfer_years_factor` | 0.5 | – | `[E]` |
| `fm.tier.t5_iq_gate` | 80 | pts | `[E]` |
| `fm.tier.t5_composure_gate` | 75 | pts | `[E]` |
| `fm.tier.mma_mean_weights` | 0.35 / 0.35 / 0.30 | – | `[E]` |
| `fm.tier.iq_bands` | 30 / 50 / 70 / 90 | pts | `[E]` (maps `MIS` IQ 1–5) |
| `fm.wr.background_offsets` | freestyle +10/0/+5/+5 · folkstyle +8/+2/+10/+10 · greco −5/+15/+5/0 · judo-sambo −5/+10/+5/0 · bjj-only −15/−5/−5/+5 | pts | `[S: WR §7]` (greco +15 `[S→E]`) |
| `xfer.*` | §2.3.3 table (56 factors) | – | per row |
| `fm.legacy.*` | §2.2.3 constants (strength 50/60/4.0; cardio 30/50; speed 45/20/25/77; handSpeed 40/20/0.15; recovery −5/+5; chin/toughness/RT 50; neck 40/0.2; flex 60/45; balance 45/15; grappling split 0.8; mmaIntegration 0.5; IQ 35/30; composure 35/25; aggression 55; heart 50; discipline 40/30; adaptability 40/20; techniqueIdx tau 3) | – | `[E]`; tau 3 `[S: AUDIT/params]` |

### 5.5 Career and mental

| id | value | unit | tag |
|---|---|---|---|
| `fm.exp.amateur_weight` | 0.5 | – | `[E]` |
| `fm.exp.tau_fights` | 6 | fights | `[E]` (fits `DP §4.6` anchors) |
| `fm.exp.floor` | 0.10 | – | `[S: DP §4.6]` |
| `fm.exp.veteran_logit` | 0.28 | logit | `[D: logit(0.57)]` from `[S: FD §2.4]` |
| `fm.exp.decision_noise` | 1.4 − 0.5 × experience | – | `[E]` |
| `fm.career.bigfight_default` | composure − 15 + 3/title (cap 5) + 0.5/pro fight (cap 20) | pts | `[E]` |
| `fm.career.event_magnitude` | title 1.0 · main 0.8 · regional 0.6 · amateur 0.3 | – | `[S: DP §4.6]` (1.0, 0.6); others `[E]` |
| `fm.career.chin_per_ko_loss` | 3 (cap 4) | pts | `[S: DP §7 r21]` |
| `fm.career.chin_per_kd` | 1 (cap 5) | pts | `[E]` |
| `fm.career.kko_history_per_ko` | 0.25 (cap 4) | – | `[S: DP §3.2]` |
| `fm.career.layoff_210` | composure −8 · RT −3 · cardio −4 · readP −0.03 | pts | `[S: FD §2.4]` total; split `[E]` |
| `fm.career.layoff_365` | composure −12 · RT −5 · cardio −6 · readP −0.05 | pts | `[S: FD §2.4]` total; split `[E]` |
| `fm.career.post_ko_60d` | chin −10 · composure −10 | pts | `[E]` (`FD §2.4` n = 16) |
| `fm.career.short_notice` | cardio −8 · dehydration +0.01 · scouting σ ×1.5 | mixed | `[S: FD §2.4]` total; split `[E]` |
| `fm.career.last_result` | loss −3 · win +2 (composure) | pts | `[E]` (`LIT_B §2.7` direction) |
| `fm.career.dehydration_per_pct` | 0.015 × 1.5 beyond 5 % cut, × (1 − discipline/100), cap 0.05 | – | `[E]` |
| `fm.career.stance_familiarity_tau` | 4 | bouts | `[E]` |
| `fm.mental.attack_share_base` | 0.33 | – | `[S: LIT_B §5.10]` |
| `fm.mental.attack_share_slope` | 0.30 | – | `[E]` |
| `fm.mental.pace_aggr` | 0.8 + 0.4 × aggression/100 | – | `[E]` |
| `fm.mental.killer_threshold` | 75 | pts | `[E]` |
| `fm.mental.shell_base` | 0.5 | – | `[E]` |
| `fm.mental.plan_abandon` | 0.6 | – | `[E]` |
| `fm.mental.mustnot_violation` | 0.3 | – | `[E]` |
| `fm.mental.adapt_mult` | 0.7 + 0.6 × adaptability/100 (cap 0.98) | – | `[E]` |
| `fm.mental.dwell_mult` | 1.3 − 0.6 × adaptability/100 | – | `[E]` |
| `fm.mental.corner_adapt` | 0.1 per 50 pts | – | `[E]` |
| `fm.mental.heart_surge_gate` | 60 | pts | `[E]` |
| `fm.mental.stubbornness_heart` | 0.5 + heart/100 | – | `[E]` |
| `fm.mental.stubbornness_clamp` | 0.02 – 0.5 | – | `[E]` |
| `fm.mental.stubbornness_bands` | 0.19 / 0.11 / 0.05 | – | `[S: SUB §4]` |
| `fm.mental.no_tap_untrained` | 0.40 | – | `[S: SUB §4]` |
| `fm.mental.injury_tap_early` | 0.8 | – | `[E]` (`SUB §4` Hinz direction) |
| `fm.mental.gen_prior_sd` | 12 | pts | `[E]` |

### 5.6 Composites

| id | value | unit | tag |
|---|---|---|---|
| `fm.mass.ref_kg` | 77.1 | kg | `[S: RJ §2.2]` |
| `fm.reach.shoulder_ratio` | 0.20 | × height | `[E]` |
| `fm.reach.shoulder_turn_m` | 0.10 | m | `[E]` |
| `fm.reach.kick_extra_m` | 0.15 | m | `[E]` |
| `fm.reach.leverage_by_class` | FLW 0.15 · BW 0.15 · FW 0.2 · LW 0.3 · WW 0.5 · MW 0.6 · LHW 0.8 · HW 1.0 | – | `[E]` on `[S: FD §4, LIT_B §2.4]` |
| `fm.power.rear_ref_n` | 4800 | N | `[S: LIT_B §4.9]` |
| `fm.power.gate_floor` | 0.50 | – | `[S: LIT_B §4.9]` |
| `fm.power.gate_exp` | 0.8 | – | `[D]` (fits 0.78 at intermediate) |
| `fm.power.phys_mass_exp` | 0.5 | – | `[E]` |
| `fm.power.phys_attr_weight` | 0.3 | – | `[E]` |
| `fm.power.hand_term` | 0.85 + 0.15 × v/8 | – | `[E]` |
| `fm.power.lead_ratio` | 0.59 | – | `[S: LIT_B §4.9]` |
| `fm.power.hook_mult` | 1.29 | – | `[D: 4405/3427, S: DP §3.1]` |
| `fm.power.kick_pad_ref_n` | 1400 | N | `[S: MT §7.1]` |
| `fm.power.kick_pad_to_fight` | 3.4 | – | `[E]` |
| `fm.power.lead_kick_ratio` | 0.75 | – | `[E]` |
| `fm.power.knee_mult` | 1.5 | – | `[S: DP §3.1]` |
| `fm.power.elbow_mult` | 1.0 | – | `[S: DP §3.1]` |
| `fm.power.head_kick_alpha_mult` | 1.75 | – | `[E]` mid of 1.5–2 `[S: DP §3.1]` |
| `fm.grap.strength_mass_slope` | 60 | pts per ln(kg ratio) | `[E]` |
| `fm.grap.clinch_power_w` | 0.6 / 0.25 / 0.15 | – | `[E]` |
| `fm.grap.sprawl_speed` | 0.85 + 0.30 × explosiveness/100 | – | `[E]` |
| `fm.grap.tdd_base_w` | 0.5 / 0.2 / 0.15 / 0.15 | – | `[E]` |
| `fm.grap.sub_w` | 0.6 / 0.2 / 0.2 | – | `[E]` |
| `fm.grap.subdef_w` | 0.7 / 0.2 / 0.1 | – | `[E]` |
| `fm.energy.pcr_capacity` | 100 | – | `[S: DP §4.1]` |
| `fm.energy.pcr_halflife_base_s` | 30 | s | `[S: DP §4.1]` |
| `fm.energy.pcr_halflife_cardio` | 1.35 − 0.70 × cardio/100 | – | `[E]` |
| `fm.energy.lactate_clear_base` | 0.4 | mmol/L/min | `[S: DP §4.1]` (0.3–0.5) |
| `fm.energy.lactate_clear_cardio` | 0.6 + 0.8 × cardio/100 | – | `[E]` |
| `fm.energy.break_refill_base` | 0.60 | – | `[S: DP §4.4]` |
| `fm.energy.break_refill_recovery` | 0.85 + 0.30 × recovery/100 | – | `[E]` |
| `fm.energy.tier_cost_mult` | 1.6 / 1.3 / 1.1 / 1.0 / 0.9 | – | `[S: BJJ §6]` |
| `fm.antic.read_base` | 0.55 | – | `[S: LIT_B §4.1]` |
| `fm.antic.read_skill_slope` | 0.33 | – | `[S: LIT_B §4.1]` (fits bands) |
| `fm.antic.read_iq_slope` | 0.03 | – | `[E]` |
| `fm.antic.read_clamp` | 0.45 – 0.92 | – | `[E]` |
| `fm.antic.cue_lead_max_ms` | 100 | ms | `[S: LIT_B §4.2]` |
| `fm.antic.counter_base` | 0.05 | – | `[S: LIT_B §4.4]` |
| `fm.antic.counter_range` | 0.45 over skill 10–90 | – | `[S: LIT_B §4.4]` (0.05/0.25/0.5) |
| `fm.antic.feint_a` | 0.62 | – | `[S: LIT_B §4.5]` |
| `fm.antic.feint_b` | 0.40 | – | `[S: LIT_B §4.5]` |
| `fm.antic.anxiety_a` | 0.16 | – | `[S: LIT_B §4.3]` |
| `fm.antic.anxiety_b` | 0.11 | – | `[S: LIT_B §4.3]` |
| `fm.antic.anxiety_composure_scale` | 2 × (1 − composure/100) | – | `[E]` |
| `fm.antic.fatigue_rt` | 0.125 | per unit f | `[S: LIT_B §4.7]` (+10–15 %) |
| `fm.exec.time_mult` | 1.50 / 1.40 / 1.25 / 1.00 / 0.90 / 0.85 | – | `[S: MT §6]` (T1 interpolated `[E]`) |
| `fm.exec.punch_time_blend` | 0.5 | – | `[E]` |
| `fm.exec.telegraph` | +0.25 / +0.20 / +0.15 / 0 / −0.05 / −0.10 | read prob | `[S: MT §6]` (T1 `[E]`) |
| `fm.exec.hip_rotation` | 0.50 / 0.60 / 0.75 / 1.00 / 1.05 / 1.10 | – | `[S: MT §6]` (T1 `[E]`) |

### 5.7 Tier catalogue magnitudes (design-chosen values; sourced rows carry their research value under the same id)

| id | value | unit | tag |
|---|---|---|---|
| `beh.gen.eyes_close.p` | 0.70 | – | `[E]` |
| `beh.gen.eyes_close.absorb` | −0.15 | – | `[S: BOX §8 r31]` |
| `beh.gen.eyes_close_t1.p` | 0.30 | – | `[E]` |
| `beh.gen.turn_away.p` | 0.50 | – | `[E]` |
| `beh.gen.hands_drop_tired.f` | 0.45 / 0.60 / 0.75 | – | `[E]` |
| `beh.gen.hands_drop_tired.guard` | −30 % / −15 % | – | `[E]` |
| `beh.gen.t0_burst_collapse.window_s` | 20 | s | `[S: FD §5]` |
| `beh.gen.t0_burst_collapse.output_after` | 0.4 | – | `[E]` |
| `beh.gen.t0_burst_collapse.cost_mult` | 1.8 | – | `[E]` |
| `beh.gen.panic_flurry.*` | swing ×3 · defence ×0.5 · cost ×2 | – | `[E]` |
| `beh.gen.hurt_t5.decision_penalty_scale` | 0.7 | – | `[E]` |
| `beh.gen.pacing_t1.r2` | 0.70 | – | `[E]` |
| `beh.gen.pacing_t1.r3` | 0.55 | – | `[E]` (R3/R1 0.70 `[S: FD §5]` applied to R2 base) |
| `beh.gen.pacing_*.r3_over_r1` | T2 0.80 · T3 0.85 · T4+ 0.85–0.90 | – | `[S: FD §5]` |
| `beh.gen.show_pain.judge_mult` | 1.5 | – | `[E]` |
| `beh.gen.t0_grab_push.w` | 3 | – | `[E]` |
| `beh.gen.t0_fall_together.p_per_5s` | 0.35 | – | `[E]` |
| `beh.gen.crowd_mode_size.read_floor` | 0.45 | – | `[E]` |
| `beh.box.square_stance.chin_p` | +0.15 | – | `[E]` |
| `beh.box.square_stance.td_vuln` | +20 % | – | `[E]` |
| `beh.box.cross_feet.p` | 0.40 / 0.15 | – | `[E]` |
| `beh.box.cross_feet.effects` | balance −40 % · power ×0.5 · stumble 0.3 | – | `[E]` |
| `beh.box.hands_at_chest.absorb` | 0.2 | – | `[E]` |
| `beh.box.repertoire_t0.combo_decay` | 0.6 | – | `[E]` |
| `beh.box.repertoire_t1.poor_accuracy` | 0.7 | – | `[E]` |
| `beh.box.high_guard_only.p` | 0.90 | – | `[E]` |
| `beh.box.high_guard_only.wrong_slip` | 0.30 / ×1.2 | – | `[E]` |
| `beh.box.hands_drop_after_punch.*` | −25 % · 300 ms · ×1.5 | – | `[E]` |
| `beh.box.backs_straight_up.w` | ×3 / ×0.3 | – | `[E]` |
| `beh.box.rear_hand_home.absorb` | +0.2 | – | `[E]` |
| `beh.box.angles.w` | ×1.5 / ×2 | – | `[E]` |
| `beh.box.economy_inside.*` | exec ×0.85 · commit −1 | – | `[E]` |
| `beh.box.delayed_counter.acc` | +0.10 | – | `[E]` |
| `beh.box.pull_counter.gate` | headMovement ≥ 55; T3 quality 0.7 | – | `[E]` |
| `beh.box.body_work.w` | ×1.3 / ×0.3 | – | `[E]` |
| `beh.box.guard_style_gate.*` | 0.65 / 0.40; gates 55/55 | – | `[S: BOX §4 D9]`; gates `[E]` |
| `beh.box.lead_hand_use.w` | ×1.2 / ×0.8 | – | `[E]` |
| `beh.mt.hip_rotation.foot_injury_mult` | 3 | – | `[E]` |
| `beh.mt.no_return_to_stance.p` | 0.60 / 0.30 | – | `[E]` |
| `beh.mt.catch_behaviour.t0` | w ×2 · success ×0.5 · punched 0.4 | – | `[E]` |
| `beh.mt.clinch_behaviour.t0_turned` | 0.6 | – | `[E]` |
| `beh.mt.fatigue_kicking.t0_w` | 0.2 at f > 0.5 | – | `[E]` |
| `beh.mt.lean_back_t0.*` | 20° · −0.10 m | – | `[E]` |
| `beh.mt.head_kick_gate.*` | flexibility 40 · skill 30 | pts | `[E]` |
| `beh.mt.shin_conditioning.mult` | 1.3 / 1.0 / 0.8 | – | `[E]` |
| `beh.mt.calf_kick_targeting.w` | ×1.5 at squareness > 0.5 | – | `[E]` |
| `beh.mt.kb_winner_profile.w` | ×1.2 | – | `[E]` |
| `beh.wr.t0_tackle.vs_trained` | 0.05 | – | `[E]` |
| `beh.wr.stall_in_sprawl.w` | ×2 | – | `[E]` |
| `beh.wr.underhook_pummel.w` | ×1.5 / ×2 | – | `[E]` |
| `beh.ju.posture_t0.*` | ×1.5 · +15 pp | – | `[E]` |
| `beh.ju.grip_t0.p` | 0.75 | – | `[E]` |
| `beh.ju.kuzushi_t0.self_fall` | 0.30 | – | `[E]` |
| `beh.ju.kuzushi_t2.read` | +0.15 | – | `[E]` |
| `beh.ju.failure_mode.t0_pinned` | 0.5 | – | `[E]` |
| `beh.ju.ukemi.bands` | 30 / 70; flat +10 acute body | pts | `[E]` |
| `beh.bjj.mma_bottom_priority.gate` | bjj ≥ 50 ∧ getUps < 30 | pts | `[E]` |
| `beh.bjj.leg_entanglement_rarity.*` | ×0.3; legLocks ≥ 75 | – | `[E]` |
| `beh.bjj.t0_hold_breath.lactate` | 1.4 | – | `[E]` |
| `beh.bjj.knee_on_belly_pressure.w` | ×1.4 | – | `[E]` |
| `beh.sub.neck_when_hurt.*` | gate 30 · +20 pp | – | `[E]` |
| `beh.sub.early_hand_fight.mult` | 0.8 | – | `[E]` |
| `beh.mma.range_t1.err_m` | 0.15 | m | `[E]` |
| `beh.mma.range_t3.share` | 0.80 | – | `[E]` |
| `beh.mma.range_t4.opp_err_m` | 0.10 | m | `[E]` |
| `beh.mma.kick_vs_wrestler_t2.w` | 0.3 | – | `[E]` |
| `beh.mma.cage_t2.wrong_way` | 0.5 | – | `[E]` |
| `beh.mma.getup_t2.late_s` | 20 | s | `[E]` |
| `beh.mma.getup_t4.interval_s` | 8 | s | `[E]` |
| `beh.mma.level_change_striking.gate` | 50 | pts | `[E]` |
| `beh.mma.clinch_striking_gate.*` | 0.3 + 0.7 × skill/100 | – | `[E]` |
| `beh.mma.t0_rule_ignorance.*` | fence/shorts 0.2 · back-of-head 0.1 | – | `[E]` |

---

## 6. Calibration hooks

This section is responsible for the `FIGHT_DATA` targets below (Phase 9 headless batches; ≥ 2,000 bouts per
cell; tolerances from `FD §3`). Hooks marked "with NN" are shared with that section because the effect emerges
from its resolution formulas acting on this section's inputs.

| Hook | Target (`FD` row / research) | Procedure | Owner |
|---|---|---|---|
| C-1 Skill-gap favourite rate | `FD #115`: favourites 65–69 % overall; −400 to −900 → 88–93 %; pick'em 50–51 %; upsets 30–32 % `[S]` | Archetype ladder: `arch.champion_complete` vs `arch.regional_pro_allrounder` ≥ 88 %; T3 vs T3 mirror 50 ± 2 %; T4 vs T3 same style 65–72 %; T4 vs T2 ≥ 85 %; T5 vs T0 ≥ 99 %. If the ladder is too steep/flat, tune `k_skill` in 02–04 first, then `fm.skill.years_tau` | 01 with 02–07 |
| C-2 Predictability ceiling | `LIT_B §3.4`: 61–62 % accuracy on real fighters; sim outcomes > 70 % predictable from ratings = under-randomised `[S]` | Generate 2,000 T3–T4 random pairs; logistic on rating difference must not exceed 70 % accuracy | 01 with 07 |
| C-3 Age edge | `FD #117–118`: ≥ 3–4 yr younger → 58–60 %; win rate <25 58 % → 37+ 38 % `[S]` | Clone `arch.regional_pro_allrounder` at ages 24 / 28 / 32 / 36 / 40 with identical skills; run each vs the 28-year-old; check the age curves (§2.2.2) produce the gradient without touching skills. Also `arch.ageing_veteran` vs its own 28-year-old clone → younger wins ~60 % | 01 |
| C-4 KO susceptibility | `FD #119`: KO-loss rate <25 ≈ 10 % → 37+ ≈ 25 %; never-dropped 14 % → 5+ KDs 25 % `[S]` | Same age ladder: KO/TKO-by-strikes loss share vs age; then KD-history ladder (0 / 2 / 5 career KDs, 0 / 2 / 4 KO losses) at fixed age. Tune `fm.age.chin.*`, `fm.career.chin_per_kd` | 01 with 05 |
| C-5 Reach edge | `FD #116`: any 51.7 %; ≥ 2.5 in in standing-heavy 60 %; > 7 in 63 %; ground-heavy 49 % `[S]` | Pairs of striker archetypes with reach varied ±0 / 6 / 18 cm at equal skill, per class; `reachLeverage` must give ~0 at BW/FLW and the HW gradient (`LIT_B §2.4`) | 01 with 02 |
| C-6 Southpaw | `FD #120`: 50–57 % (use ≈ 52 %) `[S]` | Orthodox vs southpaw clones with `stanceExposure` low vs high; edge must vanish at high familiarity (`LIT_B §3.15`) | 01 with 02/07 |
| C-7 Debutant / layoff / short notice | `FD #122–124`: 43 % / 41 % (>210 d) / 35 % (≥1 yr) / 37 % `[S]` | Clone pairs differing only in `experience` / `daysSinceLastBout` / `shortNoticeDays`; tune `fm.exp.*`, `fm.career.layoff_*`, `fm.career.short_notice` | 01 |
| C-8 Small weight edge | `FD #121`: heavier by ≤ 6 lb at weigh-in → 54.5 % `[S]`; one class up ≈ +8–12 pp `[E]` | Clone pairs with `fightNightKg` +2.7 kg and +10 kg at equal skill; `powerIndex`, `grapplingStrength`, `clinchPower` and 05's mass terms must jointly reproduce | 01 with 02/03/05 |
| C-9 Punch force by tier | `FD §5`: novice 1,600–2,400 N; beginner 2,400–3,000; regional 3,000–4,000; elite 4,800 N `[S/E]` | Unit test on `powerIndex.rearHand` for the fifteen presets and for S(y,q)-generated fighters at 0 / 1 / 6 / 15 yr | 01 |
| C-10 Read probability by tier | `LIT_B §4.1`: novice 0.55–0.65, intermediate 0.70–0.78, expert 0.80–0.88 `[S]` | Unit test on `readP` across generated tiers | 01 |
| C-11 Tier priors, emergent | `FD §5` rows: sig accuracy 15–20 / 22–26 / 27–30 / 31–33 %; TD accuracy 20–30 / 30–35 / 35–38 / 38 %; TD defence 40–50 / 55 / 60 / 62 %; sub finish per attempt 40 / 30 / 28 / 25 %; R3/R1 output collapse / 0.70 / 0.80 / 0.85–0.9; KD per landed power head strike 2–3 / 4–5 / 4–4.5 / 3.9 % | Equal-tier mirror bouts at T0, T1/T2, T3, T4 using generated fighters; each row is checked by the owning section (02 / 03 / 04 / 05) with this section's tier inputs fixed | 02–05 with 01 |
| C-12 Generator population | `LIT_B §2.4`: stature 177.5 ± 9.5, armspan 182.2 ± 11.5, A:S 1.026 ± 0.028; stance mix 76.6 / 17.1 / 6.1 % `[S]` | Statistical test on 10,000 generated fighters | 01 |
| C-13 Win-method mix by class | `LIT_B §2.15`, `DP §1`: KO/TKO share rises FLW ~20 % → HW ~52–60 %; ranked male mix 44 / 33 / 23 % `[S]` | Class-matched generated T4 pairs; the mass term in `powerIndex` and 05's alphaEq scaling produce it; if not, tune `fm.power.phys_mass_exp` before touching 05 | 01 with 05 |
| C-14 Adrenaline dump visibility | `DP §4.6` rule; `MIS §7.6` (R1 pace ×1.3, R2 output ×0.7 for low composure) `[S]` | `arch.tkd_convert` (experience 0.1, composure 47) vs `arch.regional_pro_allrounder`: R1 first-45-s output and R2 output ratio | 01 with 05/07 |
| C-15 Legacy parity | `AUDIT §1.1` shipped profiles | `legacy.toFighter(ATHLETE_A)` vs `legacy.toFighter(ATHLETE_B)` must give A ≥ 90 % (T2–T3 striker vs T0, +23 kg) — not a data target, a regression guard that the conversion preserves the old corpus' qualitative result | 01 |

---

## 7. Assumptions and open questions

### 7.1 Every `[E]` in this section

Body / generation / rig: leg-reach ratio 0.575 ± 0.020; P(left-handed | southpaw) 0.60; height-by-class means and
σ 0.05; body-fat defaults by class; LHW 4.5 % and HW 3.0 % regain; all rig ratios (`fm.rig.*`) and the BMI-23.5
reference; the `[E]` numbering of consuming sections.

Attributes: strength anchors (4.0 / 5.5 / 7.0 × BW) and the log2 slope 60; CMJ / RFD anchors for explosiveness;
foot-, hand- and kick-speed anchors and slopes; VO2max anchors; flexibility and balance multipliers; the
reaction-time slope 0.65 ms/pt.

Age: every attribute curve (rise, peak window, both slopes); the chin curve's 0.6 attenuation; the exposure-RT term
(0.1 pt per fight beyond 10); pace decline starting at 33.

Legacy conversion: every mapping constant in §2.2.3.

Skills: `S(y, q)` with τ 3.5 and the quality anchors; sub-skill spread σ 8; untrained default 5; the `+1`
years cap; transfer-years factor 0.5; T5 mental gates (IQ 80, composure 75); `mmaMean` weights; IQ bands; the
whole transfer matrix except the three rows tagged `[S]`.

Career / mental: amateur bouts count 0.5; experience τ 6; decision-noise 1.4 − 0.5·experience; big-fight
composure default; event magnitudes 0.8 / 0.3; chin −1 per career knockdown; the split of the layoff, short-notice
and post-KO penalties across attributes; last-result ±; residual-dehydration formula; stance-familiarity τ 4;
attack-share slope 0.30; pace × aggression; killer threshold 75; shell base 0.5; plan-abandon 0.6; mustNot 0.3;
adaptability multipliers; corner-uptake adaptability term; heart surge gate 60; stubbornness heart scaling and
clamp; injury tap-early 0.8; generator priors N(50, 12) and tier shifts.

Composites: `effectiveReachM` (0.20 H shoulder, +0.10 m), kick reach +0.15 m; `reachLeverage` by class; power:
`physTerm` exponents (0.5 / 0.3), `handTerm`, kick pad-to-fight ×3.4, lead-kick 0.75, head-kick alpha 1.75;
grappling composites (all weights); energy slopes on cardio and recovery; anticipation: IQ slope 0.03, clamp
0.45–0.92, counter-skill mapping, anxiety composure scaling; punch exec blend 0.5; T1 interpolations of the MT
tier tables.

Catalogue: every magnitude listed in §5.7, and every trigger threshold that a research table did not state (first
60 s, 20 s after hurt, 2 strikes in 10 s, f thresholds).

Archetypes: all fifteen presets in full.

### 7.2 Open questions

1. **Chin ageing severity.** The curve implies a 40-year-old with a stored chin of 78 fights with an effective
   32 before KO history. That matches the strikes-per-knockdown data (`FD §4`) but will *feel* harsh in a
   career mode. Realism is the default; a playability toggle `fm.age.chin.attenuation` (0.6 → 0.4) is the knob.
2. **Where the age win-gradient comes from.** We attribute it to durability + pace + recovery (evidence-backed
   direction) and give skills/IQ no decay. If C-3 under-produces the −0.7 pp/yr gradient with the physical curves
   alone, the missing part should be added to `explosiveness`/`speed` slopes, not to skills (accuracy is preserved
   with age, `LIT_B §5.8`).
3. **T5 gate.** "Champion" is a mental gate on top of skill. A 92-mean grappler with IQ 70 is T4 for behaviour
   purposes. This is deliberate (`CONV §3` "exceptional IQ/consistency") but means the creator must explain why a
   maxed-out skill slider does not show "T5".
4. **Max-not-sum transfer.** A judoka with 20 years and 3 years of wrestling gets `wrestling.clinch = max(native,
   0.6 × throws)`; the second source never adds. A soft-OR was rejected to avoid stacking exploits in the creator;
   revisit if archetype 4.4 (judoka) under-performs in clinch takedowns versus expectation.
5. **Reach as leverage, not term.** All reach effects are scaled by `reachLeverage` and applied in 02/07. If C-5
   shows the HW gradient but not the "standing-heavy 60 %" figure, the fix belongs in 02's range-hit modifiers, not
   here.
6. **Novice tells in pro-only modes.** T0/T1 rows (eyes closing, turning away, grab-and-push) only fire for T0/T1
   fighters; they never appear in UFC-level bouts because the tiers gate them. No toggle is needed, but 08 must
   make sure the animation set is reachable only through catalogue tags.
7. **Weight cut as trait vs event.** The cut is modelled as a residual-dehydration penalty only (`DP §4.7`
   evidence). The regain *benefit* is purely via fight-night mass. If C-8 needs more, add a capped odds term (OR
   ≈ 1.05 per 1 %, `LIT_B §2.8`) in 07 rather than an attribute here.
8. **Female fighters.** Same schema; different calibration rows (`FD #14`, women's decision share 46 %
   `LIT_B §2.15`). No attribute-level sex modifier is proposed; the "50 = average trained male of the class"
   anchor means a generated elite female strawweight will carry lower absolute `strength`/`powerIndex` through
   mass and class, which is the intended mechanism. Revisit after calibration.
9. **Simple RT slope with age.** −0.5 %/yr after 30 is a placeholder from general ageing literature; the expert
   anticipation edge (skill-driven) does not decay, which is why older high-IQ fighters remain hard to hit clean
   but easy to hurt.
10. **Playability vs realism (default realism).** The catalogue makes T0 fighters collapse within 60 s and lose to
    any T2 almost always; a "crowd mode" (`FD §6`) needs this. A "gym-arcade" preset that clamps `energy.actionCostMult
    ≤ 1.2` and disables `beh.gen.t0_burst_collapse` is the suggested playability variant, off by default.
