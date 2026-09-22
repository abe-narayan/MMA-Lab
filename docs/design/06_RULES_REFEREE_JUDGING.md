# 06 — Rules, Referee and Judging

Binding conventions: `docs/design/00_CONVENTIONS.md`. Provenance tags: `[S: FILE §n]` sourced from `research/`,
`[D: …]` derived (arithmetic shown once), `[E]` estimate (every `[E]` is repeated in §6). Research files are
abbreviated: RULES = `RULES_JUDGING.md`, FD = `FIGHT_DATA.md`, LIT_B = `LIT_B_anthropometrics_predictors_expertise_tactics.md`,
DMG = `DAMAGE_PHYSIOLOGY.md`, INT = `MMA_INTEGRATION_STRATEGY.md`, BJJ = `BJJ_POSITIONS.md`, JUDO = `JUDO.md`,
MTKB = `MUAY_THAI_KICKBOXING.md`, BOX = `BOXING.md`, SUBPHYS = `SUBMISSION_PHYSIOLOGY_DATA.md`.

Where RULES itself marks a value **[ASSUMPTION]**/**[INFERRED]**/**[UNVERIFIED]**, this section cites it as
`[S: RULES §n (assumption)]` and treats it as a tunable default, not a fact.

---

## 1. Purpose and scope

This section owns everything that happens *because a sanctioning body says so* plus the two officials that
turn engine state into outcomes:

1. **Ruleset** — a data object (§2.1) that every other section reads: round structure, legal-technique
   matrix, grounded definition, clinch limits, throw/submission legality, win conditions, scoring system,
   knockdown/count rules, foul list, stoppage authorities, referee strictness. Thirteen instances (§2.2).
2. **Referee** — tick-level logic (§2.3): stoppages (KO/TKO/submission/doctor/corner/bell), knockdown
   counts, stand-ups and clinch breaks, foul detection and sanction, timidity, grappling-sport points and
   penalties, judo scoring, street-mode end conditions, and a strictness preset that shifts every threshold.
3. **Judges** — per-round scoring under each system (§2.4) with a per-judge noise/bias model tuned to the
   real decision-type distribution; bout-level aggregation (unanimous/split/majority, draws, technical
   decisions, overtime).
4. **Round/bout flow** (§2.5) — horn semantics, break sequence, doctor/corner/cutman events, fighter
   replacement in multi-opponent formats, overtime.
5. **Events** (§2.6) for commentary and HUD.

Interfaces (section map: 01 fighter · 02 striking · 03 grappling positions · 04 submissions · 05 damage/physiology · 07 strategy/AI incl. multi-opponent · 08 presentation/HUD · 09 architecture, commentary, calibration; the *interface names* are binding):

| Direction | Section | What crosses the boundary |
|---|---|---|
| in | §01 fighters | `heart`, `discipline`, `composure`, `fightIQ`, tier (foul rates, tap behaviour), `homeFighter`, `rankGap`/`oddsRatio` for judge bias, corner `protectiveness` |
| in | §02 striking | every landed/attempted strike carries `{weapon, target, subTarget, phase, sigFlag, clean, power}`; `intentionalFoul` flag when the AI chose an illegal action deliberately |
| in | §03 grappling | position ids `pos.*`, `reversal`, `pass`, `sweep`, `takedown{landedPastGuard}`, throw landing quality (judo), `stabilisedS` per position, `intelligentDefence` cue for a grounded fighter |
| in | §04 submissions | `SubmissionAttempt{stage}` (early / locked), `tap`, `verbalTap`, `screams`, `jointFailed`, `consciousness` under choke, attacker release timing |
| in | §05 damage/physiology | `RefObservables` (§2.3.1): `ko`, `limp`, `rocked`, `stunned`, `bodyCollapse`, `legCollapse`, `unansweredHead`, `tSinceDefence`, `cuts[]`, `visionL/R`, `eyeSwollen`, `consciousness`, `attemptingToRise`, fracture flags |
| in | §07 AI | corner cues (`CO-*`), towel decision inputs, flight/surrender decisions in street mode, exploitation of timeouts |
| out | §02/§03/§07 | `isLegal(action)` answers, `restart(position)`, `clockStopped`, `pausedUntil`, `pointsState` for score-aware AI, `openScorecards` when enabled |
| out | §08 presentation / §09 commentary | every event in §2.6 with a text template id (HUD in §08, commentary templates in §09) |
| out | §09 calibration | FD targets #49, #105–#110, #114 and RULES §6.3 rates (§5) |

Tick order (kept from `docs/AUDIT.md §1.1` for determinism): clock → upkeep → actions (ascending id) →
steering/integration → **referee** → digest. Judges run at round end (inside the referee phase of the
last tick of a round) and at technical-decision time.

---

## 2. Model

### 2.1 Ruleset schema

TypeScript-shaped; this becomes `src/engine/rules/ruleset.ts`. Enumerations are closed; adding a value is a
design change.

```ts
// ---------- primitives ----------
export type Weapon   = 'punch' | 'kick' | 'knee' | 'elbow' | 'headbutt' | 'stomp' | 'spinning_backfist';
export type Target   = 'head' | 'body' | 'leg' | 'back_of_head' | 'spine' | 'groin' | 'throat' | 'eyes'
                     | 'knee_joint' | 'downed_head';                 // downed_head only exists vs a grounded opponent
export type Phase    = 'standing' | 'clinch' | 'ground_top' | 'ground_bottom';
export type Legality = 'legal' | 'foul' | 'foul_hard';              // foul_hard: DQ-class regardless of intent
export type GroundedDef = 'unified_2001' | 'unified_2017' | 'unified_2024' | 'any_contact' | 'none';
// unified_2001: any part other than soles of feet (one hand = grounded)          [S: RULES §2.2]
// unified_2017: both palms/fists down, or any part other than a single hand      [S: RULES §2.2]
// unified_2024: any part other than hands or feet (hands never count)            [S: RULES §2.2]
// any_contact : boxing/KB/MT — a downed fighter may not be hit at all            [S: RULES §2.3, §2.5]

export type TakedownClass = 'shot' | 'trip' | 'sweep_shin' | 'sweep_side_foot' | 'hip_throw' | 'shoulder_throw'
  | 'leg_reap' | 'lift' | 'slam' | 'suplex' | 'spike' | 'kick_off_feet' | 'scissor' | 'leg_grab' | 'head_dive';
export type SubmissionClass = 'choke_blood' | 'choke_air' | 'neck_crank' | 'elbow_lock' | 'shoulder_lock'
  | 'wrist_lock' | 'straight_ankle' | 'toe_hold' | 'kneebar' | 'heel_hook' | 'twisting_knee' | 'knee_reap'
  | 'slicer' | 'spinal_lock' | 'small_joint' | 'trachea_grab' | 'fish_hook';

export type WinCondition = 'ko' | 'tko_strikes' | 'tko_doctor' | 'tko_corner' | 'tko_bell' | 'tko_bodily'
  | 'tko_count' | 'tko_three_kd' | 'tko_outmatched' | 'submission' | 'technical_submission'
  | 'decision' | 'technical_decision' | 'points' | 'ippon' | 'waza_ari_x2' | 'golden_score' | 'referee_decision'
  | 'dq' | 'hansoku_make' | 'incapacitation' | 'flight' | 'surrender' | 'separation' | 'weapon';

export type ScoringSystem = 'ten_point_must' | 'points_ibjjf' | 'points_adcc' | 'ippon' | 'none' | 'whole_fight';
export type JudgeCulture  = 'unified_2025' | 'legacy_2016' | 'boxing_abc' | 'glory' | 'muay_thai_abc'
                          | 'thai_stadium' | 'whole_fight' | 'none';
export type Strictness    = 'lenient' | 'standard' | 'strict';

// ---------- foul catalogue ----------
export type FoulId =
  | 'headbutt' | 'eye_gouge' | 'bite_spit' | 'fish_hook' | 'hair_pull' | 'spike' | 'back_of_head' | 'throat'
  | 'fingers_extended' | 'groin' | 'grounded_head_kick_knee' | 'stomp' | 'hold_gloves_shorts' | 'fence_grab'
  | 'small_joint' | 'throw_out' | 'finger_in_cut' | 'claw_pinch' | 'timidity' | 'abusive' | 'disregard'
  | 'unsporting_injury' | 'after_bell' | 'on_break' | 'under_ref_care' | 'corner_interference'
  // boxing / kickboxing / muay thai specific
  | 'holding' | 'hold_and_hit' | 'low_blow' | 'rabbit_punch' | 'hit_downed' | 'illegal_throw' | 'illegal_sweep'
  | 'catch_and_carry' | 'excessive_clinch' | 'elbow_illegal' | 'linear_leg_kick' | 'open_glove'
  // grappling / judo
  | 'illegal_submission' | 'slam' | 'stalling' | 'guard_pull' | 'passivity' | 'fleeing' | 'leg_grab_judo'
  | 'false_attack' | 'step_out' | 'defensive_grip' | 'head_dive';

export interface FoulRule {
  id: FoulId;
  intentDefault: 'accidental' | 'intentional' | 'by_context';   // by_context: AI flag or repeat after warning
  warningsBeforeDeduction: number;   // overridden by strictness preset
  deductionAccidental: number;       // points (0 or 1), usually gated by "substantial effect"
  deductionIntentional: number;      // 2 = mandatory in MMA/boxing/MT                          [S: RULES §2.2, §2.3, §2.5]
  recoveryMaxS: number;              // 300 for groin/eye in MMA/boxing/MT; 120 in ADCC; 0 otherwise
  needsDoctorAbove: number | null;   // injury severity that triggers doctor evaluation
  hard: boolean;                     // foul_hard => DQ (or hansoku-make) on first occurrence
}

// ---------- the ruleset ----------
export interface Ruleset {
  id: string;                        // e.g. 'mma.unified.3r'
  family: 'mma' | 'boxing' | 'kickboxing' | 'muay_thai' | 'grappling' | 'judo' | 'street';
  rounds: {
    count: number;                   // 1 for single-period sports
    lengthS: number;
    breakS: number;
    extra: { max: number; lengthS: number; breakS: number; trigger: 'draw' | 'tie' } | null;
    goldenScore: boolean;            // judo: unlimited extra time, first score wins
    noPositivePointsBeforeS: number; // ADCC: first half has no positive points (0 = off)
    clockStopsOnCount: boolean;      // false everywhere (count runs with the clock; no saved-by-bell)
  };
  weightClasses: { name: string; maxLb: number | null; maxKg: number | null }[];
  catchWeightMaxGapLb: number | null;
  gloves: { oz: number; fingerless: boolean; bareKnuckle: boolean };
  legal: Partial<Record<Weapon, Partial<Record<Target, Partial<Record<Phase, Legality>>>>>>;  // sparse; default = 'legal'
  groundedDef: GroundedDef;
  elbows12to6: Legality;             // 'legal' from Nov 2024; 'foul' for the 2017 variant           [S: RULES §2.2]
  clinch: {
    allowed: boolean;
    maxS: number | null;             // null = untimed, referee breaks on inactivity
    activityRule: 'none' | 'one_strike_then_break' | 'continuous' | 'holding_is_foul';
    kneesAllowed: boolean; elbowsAllowed: boolean; dirtyBoxingAllowed: boolean;
    catchKickStepLimit: number | null;   // MT: 2 steps then must strike                             [S: MTKB §9]
  };
  takedowns: { allowed: boolean; legal: TakedownClass[]; slamOnlyFromSubmission: boolean };
  submissions: { allowed: boolean; legal: SubmissionClass[]; standingLocksAllowed: boolean };
  ground: {
    fightingAllowed: boolean;        // false in boxing/KB/MT; judo = limited (ne-waza until mate)
    strikesAllowed: boolean;
    standupPolicy: 'unified_effort' | 'judo_progress' | 'ibjjf_stalling' | 'adcc_passivity' | 'none' | 'immediate';
  };
  winConditions: WinCondition[];
  scoring: {
    system: ScoringSystem; culture: JudgeCulture; judges: number;
    openScoring: 'hidden' | 'after_each_round' | 'always';
    ncThresholdRounds: (scheduled: number) => number;  // MMA/MT/GLORY: ceil(scheduled/2); boxing: 4     [S: RULES §6.2]
    drawsAllowed: boolean;           // GLORY sudden-victory round forbids a drawn extra round
    championRetainsOnDraw: boolean;  // GLORY title fights                                            [S: RULES §2.4]
  };
  knockdown: {
    counts: boolean;                 // false in MMA                                                  [S: RULES §3.2]
    mandatoryCount: number;          // 8
    koCount: number;                 // 10
    standingEight: boolean;          // GLORY only                                                     [S: RULES §6.2]
    threeKdRound: number | null;     // GLORY 3 (tournament 2); ABC KB 3 (head strikes); K-1 3
    fourKdBout: number | null;       // GLORY 4 (tournament 3); K-1 4
    outOfRingCountS: number;         // 20 (mandatory 18 if back sooner)                               [S: RULES §6.2]
    savedByBell: false;
  };
  fouls: FoulRule[];
  stoppage: {
    refereeStops: boolean;           // false in street
    doctor: boolean;
    cornerTowel: 'direct' | 'via_inspector' | 'none';   // MMA/MT direct; US boxing via inspector       [S: RULES §2.3, §2.5]
    outmatchedTko: boolean;          // MT "outmatched" clause                                         [S: RULES §2.5]
  };
  referee: { present: boolean; strictness: Strictness; crowdPresent: boolean };
  multiOpponent: { allowed: boolean; maxPerSide: number; replacement: 'none' | 'gauntlet' | 'tag' };
  street?: { surface: 'concrete' | 'asphalt' | 'grass' | 'mat'; bystanders: number; weaponHazardPerS: number };
}
```

**Legal-technique matrix, MMA-Unified (2024 text)** — every cell not listed is `legal` [S: RULES §2.1, §2.2]:

| Weapon × target | standing | clinch | ground_top | ground_bottom | vs grounded opponent |
|---|---|---|---|---|---|
| punch/elbow → head, body, leg | legal | legal | legal | legal | legal |
| punch/elbow → back_of_head, spine | foul | foul | foul | foul | foul |
| punch/elbow → throat (deliberate), groin, eyes | foul | foul | foul | foul | foul |
| kick → head | legal | legal | foul (target is grounded) | legal (up-kick at a standing opponent; foul if the opponent is also grounded) | **foul** (#12) |
| kick → body, leg | legal | legal | legal (body/leg of grounded opponent) | legal | legal |
| knee → head | legal | legal | — | — | **foul** (#12) |
| knee → body, leg | legal | legal | legal | legal | legal |
| stomp → any | foul (#13, standing foot-stomp on the foot is legal) | — | — | — | foul |
| headbutt | foul_hard (#1) | | | | |
| spinning_backfist | legal | legal | legal | legal | legal |
| elbow 12-6 | legal since Nov 2024 (`elbows12to6='legal'`); `mma.unified.2017` variant: foul | | | | |

Other families are given as overrides in §2.2.

### 2.2 Ruleset instances

Master table (numbers `[S: RULES §2.1]` unless tagged otherwise):

| id | rounds × s (break s) | gloves | punches | kicks | knees | elbows | ground strikes | clinch | takedowns | submissions | counts / 3-KD | scoring | NC threshold |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `mma.unified.3r` | 3 × 300 (60) | 4 oz fingerless (4–6 allowed) | ✓ | ✓ (no head of grounded) | ✓ (no head of grounded) | ✓ incl. 12-6 | ✓ | untimed, ref breaks | all arcing throws; ✗ spike | all except small-joint/trachea/fish-hook | none | 10-pt must, `unified_2025`, 3 judges | 2 of 3 |
| `mma.unified.5r` | 5 × 300 (60) | same | | | | | | | | | none | same | 3 of 5 |
| `mma.unified.2017` (variant) | as 3r/5r | same | | | | | ✗ 12-6 | | | | none | `legacy_2016` | as above |
| `mma.amateur` | 3 × 180 (60) [E] | 6–7 oz + shin guards [E] | ✓ | ✓ | ✓ body only [E] | ✗ to head [E] | ✓ punches only to head [E] | untimed | as unified | ✗ heel hooks, ✗ twisting knee locks [E] | none | 10-pt must `unified_2025` | 2 of 3 |
| `boxing.pro` | 4–12 × 180 (60) | 8–10 oz [E] | ✓ head/body, closed fist, front of glove | ✗ | ✗ | ✗ | ✗ | holding = foul; ref breaks | ✗ | ✗ | mandatory 8; no standing 8; no 3-KD; 20 s out of ring | 10-pt must `boxing_abc` | 4 rounds |
| `kickboxing.glory` | 3 × 180 (60); titles 5 × 180; extra round after 90 s break | 8 oz < 65 kg, 10 oz ≥ 65 kg | ✓ + spinning backfist | ✓ incl. arcing low kicks; ✗ linear leg kicks | ✓ incl. jumping | ✗ | ✗ | one knee then break | ✗ (✗ sweeps, throws, pushing) | ✗ | mandatory 8; standing 8 allowed; 3/round or 4/bout (tournament 2/3) | 10-pt must `glory`; sudden-victory round on draw | 2 of 3 / 3 of 5 |
| `kickboxing.k1` | 3 × 180 (60); extra round on draw [S: RULES §2.4 (unverified)] | 10 oz [S: MTKB §9] | ✓ | ✓ | ✓ | ✗ | ✗ | one knee / ≤ 5 s | ✗ | ✗ | mandatory 8; no standing 8 [E]; 3/round, 4/bout (tournament 2) | 10-pt must `glory` | 2 of 3 |
| `muay_thai.abc` | 3 or 5 × 180 (60) | 8–10 oz [S: MTKB §9] | ✓ | ✓ | ✓ unlimited in clinch | ✓ all angles | ✗ | untimed; ref breaks inactive clinch (~5 s [S: RULES §3.3 (assumption)]) | kick-off-feet ✓, shin sweeps ✓; ✗ side-of-foot trips, hip/shoulder/leg throws, reaps, lifts, pile-drive; catch ≤ 2 steps | ✗ | mandatory 8; no standing 8; 18-count off platform | 10-pt must `muay_thai_abc`; 10-6 possible | 2 of 3 / 3 of 5 |
| `muay_thai.stadium` | 5 × 180 (120) [S: RULES §2.5 (unverified)] | 8–10 oz | ✓ | ✓ | ✓ | ✓ | ✗ | as ABC | as ABC | ✗ | as ABC | 10-pt cards, `thai_stadium` whole-fight weighting | 3 of 5 |
| `grappling.ibjjf` | 1 × 300/360/420/480/600 by belt (0) | none (gi or no-gi) | ✗ | ✗ | ✗ | ✗ | ✗ | — | ✓; ✗ slam, scissor, suplex on head/neck | by belt (§2.2.4) | — | `points_ibjjf` (2/3/4 + advantages + penalties) | — |
| `grappling.adcc` | 1 × 600 (first 300 no points) qualifiers; 1 × 1200 (first 600 no positive points) finals; OT 300/600 | none | ✗ | ✗ | ✗ | ✗ | ✗ | — | ✓; slam only from inside a submission | all except full nelson, crucifix, chin-twist cranks, both-shoulder downward cranks, windpipe hand choke | — | `points_adcc` (−1 negatives) + OT + referee decision | — |
| `grappling.subonly` | 1 × 600 (0); optional EBI OT [S: BJJ §9.3] | none | ✗ | ✗ | ✗ | ✗ | ✗ | — | ✓; ✗ slam [E] | all (ADCC list) [E] | — | `none`; draw or EBI OT | — |
| `judo.ijf` | 1 × 240 (0) + golden score unlimited | none (judogi) | ✗ | ✗ | ✗ | ✗ | ✗ | 45 s attack clock after kumi-kata | ✓ throws; leg grab = shido; head dive/kani-basami/kawazu-gake = HM | elbow locks + chokes in ne-waza only; ✗ do-jime, ashi-garami, standing locks | — | `ippon` (ippon / waza-ari / yuko / shido) | — |
| `street` | none (open-ended) | bare knuckle | ✓ | ✓ | ✓ | ✓ | ✓ incl. stomps/soccer kicks | none | ✓ incl. spikes on hard surface | all incl. small joints, eye, throat | — | `none`; ends per §2.3.11 | — |

**MMA weight classes** [S: RULES §2.2] (kg = lb × 0.45359 [D]): Atomweight 105/47.6 · Strawweight 115/52.2 ·
Flyweight 125/56.7 · Bantamweight 135/61.2 · Featherweight 145/65.8 · Lightweight 155/70.3 · Super Lightweight
165/74.8 · Welterweight 170/77.1 · Super Welterweight 175/79.4 · Middleweight 185/83.9 · Super Middleweight
195/88.5 · Light Heavyweight 205/93.0 · Cruiserweight 225/102.1 · Heavyweight 265/120.2 · Super Heavyweight
>265/>120.2. Catch-weight gap ≤ 5 lb (2.3 kg [D]) [S: RULES §2.2]. UFC uses the 8 men's classes 125–265 plus
women's 115/125/135/145 [S: RULES §2.2 (known, not re-verified)].

**Boxing (pro) weight classes** [E — standard 17-class ladder, not in research; verify]: 105/47.6 · 108/49.0 ·
112/50.8 · 115/52.2 · 118/53.5 · 122/55.3 · 126/57.2 · 130/59.0 · 135/61.2 · 140/63.5 · 147/66.7 · 154/69.9 ·
160/72.6 · 168/76.2 · 175/79.4 · 200/90.7 · >200 (kg [D]).
**Muay Thai (ABC)**: 18 boxing-style classes from ≤105 lb to >225 lb [S: RULES §2.5]; intermediate cut-offs [E].
**GLORY** [E]: 65 / 70 / 77 / 85 / 95 / +95 kg. **IJF** [E]: men −60/−66/−73/−81/−90/−100/+100 kg; women
−48/−52/−57/−63/−70/−78/+78 kg. **IBJJF adult male gi** [E]: 57.5 / 64 / 70 / 76 / 82.3 / 88.3 / 94.3 / 100.5 /
+100.5 kg. **ADCC** [E]: men −66/−77/−88/−99/+99 kg; women −60/+60 kg. Street: none.

#### 2.2.1 Instance notes — MMA

- Foul list = the 27-item ABC list minus deleted #10 [S: RULES §2.2]; `FoulRule` defaults: `intentDefault` accidental for
  #2 (eye), #7 (back of head), #11 (groin), #12, #15 (fence: reflexive, treated accidental unless repeated), #16; intentional
  for #1, #3, #4, #5, #6, #8, #17–#19, #21–#27; `by_context` for #9, #13, #20. `deductionIntentional = 2`,
  `recoveryMaxS = 300` for groin/eye/doctor-needed fouls [S: RULES §2.2]. Loss of bodily function = `tko_bodily` [S: RULES §2.2].
- Ways to win = exactly the S1 list [S: RULES §2.2]: `ko, tko_strikes, tko_doctor, tko_corner, tko_bell, tko_bodily,
  submission, technical_submission, decision, technical_decision, dq` (+ NC and the three draw types as non-wins).
- `mma.amateur` is an `[E]` construct (IMMAF-style: shorter rounds, no elbows/knees to the head, larger gloves); no research
  file covers amateur MMA rules. Outcome mix target for it is FD #97 (amateur finishes ~60%).
- `mma.unified.2017` keeps the 12-6 foul and the two-hands-down grounded definition [S: RULES §7 item 5].

#### 2.2.2 Instance notes — boxing, kickboxing, Muay Thai

- Boxing: knockdown definition [S: RULES §2.3]: legal blow → any part other than soles touches; hanging defencelessly on the
  ropes; ropes prevent a fall; voluntary knee. Slip → no knockdown. Both down and both fail the count → technical draw.
  Referee gait test after 8. Low blow: 5 min; unable to continue after 5 min from an *accidental* low blow → fouled boxer
  loses by TKO [S: RULES §2.3]. Accidental foul stoppage: No Decision < 4 completed rounds, Technical Decision ≥ 4.
  Towel via inspector (delay, §2.3.8).
- GLORY: minus points subtracted before the round score (10-9 winner with −1 → 9-9) [S: RULES §2.4]; sudden-victory extra
  round in which judges may not score even; champion retains on a 5-round draw; tournament final up to two extra rounds.
- Muay Thai ABC: towel allowed (fighter or corner) [S: RULES §2.5]; `outmatchedTko = true` (health/safety clause); failing to
  rise from a slip after repeated commands → count → TKO at 10 [S: RULES §2.5].
- Muay Thai stadium: 2-min breaks and whole-fight impression are **[S: RULES §2.5 (unverified)]**; provided as the
  `thai_stadium` culture preset and `muay_thai.stadium` instance so they can be switched off.

#### 2.2.3 Instance notes — grappling

- IBJJF: points require 3 s stabilisation and no submission threat [S: RULES §2.6]; penalty ladders in §2.3.9; match
  length by belt; illegal-technique matrix by belt [S: RULES §2.6 (reconstructed; verify)]:
  adult white — ✗ slicers, kneebar, toe hold, heel hook, knee reap, twisting knee locks; blue/purple — same list;
  brown/black gi — ✗ heel hook, reap, twisting; brown/black no-gi — heel hook and reap ✓, twisting ✗.
  `submissions.legal` is generated from `belt` + `gi`.
- ADCC: negatives −1 for guard pull / knee down ≥ 3 s / backing up / passivity after two warnings / fleeing; accidental
  eye/groin/bleed → 120 s recovery; intentional strike or attempted illegal technique → DQ [S: RULES §2.6].
- Sub-only: no points; draw at time unless EBI overtime is enabled (alternating starts from `pos.ground_back_hooks` or the
  armbar "spiderweb"; escape time is the tiebreaker) [S: BJJ §9.3].

#### 2.2.4 Instance notes — judo and street

- Judo values [S: RULES §2.7; JUDO §9]: 240 s + golden score; yuko 5–9 s osaekomi / side landing; waza-ari 10–19 s /
  > 90° not on back; ippon 20 s / back + speed + force + control; two waza-ari = ippon; yuko never accumulates; third shido =
  hansoku-make; leg grab = shido (2025–28 cycle); 45 s attack clock after kumi-kata; golden-score osaekomi ends at 5 s.
- Street [S: RULES §2.8]: no referee, no rounds, no classes, bare knuckle; everything legal; surface multiplier on falls;
  ends on incapacitation / flight / surrender / separation / weapon / arrival; multi-attacker allowed (`maxPerSide` = 5 to
  match the existing 1v5 corpus [S: AUDIT §1]). Design note from the research is binding: no glamorisation, fleeing is a
  "win", attacks on incapacitated targets are never rewarded for the player.

### 2.3 Referee

#### 2.3.1 Observables (the referee never reads hidden damage numbers)

`RefObservables` is produced by §05/§03 every tick for each fighter; the referee reads only this record
[S: DMG §5.1 "the sim's referee should observe the same cues"]:

| Field | Type | Producer | Meaning |
|---|---|---|---|
| `ko` | bool | §05 | unconscious (acuteHead ≥ 90 or P(KO) roll) |
| `limp` | bool | §05 | limp arm / eyes rolled / arms dropped flag ("going limp") |
| `rocked`, `stunned` | bool | §05 | acuteHead 45–65 / 30–45 states |
| `bodyCollapse`, `legCollapse` | bool + `tSinceS` | §05 | liver/solar collapse; leg structural ≥ 85 or acute ≥ 70 |
| `grounded` | bool | §03 + `groundedDef` | per ruleset definition |
| `intelligentDefence` | bool | §03/§07 | true if in the last 3.0 s [S: DMG §5.1] the fighter did any of: guard change, hip escape/turn, limb grab, stand attempt, striking back, level change, clinch, footwork; a static double-forearm cover > 3 s = false |
| `unansweredHead` | int | §02/§05 | clean head strikes absorbed since the fighter's last defensive/offensive action |
| `absorbedWindow30` | int | §02/§05 | strikes absorbed (any defence quality) in the trailing 30 s |
| `defenceQuality30` | 0–1 | §02 | share of those strikes that were blocked/evaded |
| `tSinceDefenceS` | s | §05 | seconds since last intelligent-defence action |
| `consciousness` | 0–1 | §05 | for chokes (0 = LOC) |
| `tapped`, `verbalTap`, `screams`, `jointFailed` | bool | §04 | submission signals |
| `cuts[]` | {site, severity 1–3, bleedIntoEye} | §05 | |
| `visionL`, `visionR` | 0–1 | §05 | |
| `eyeSwollenShut` | bool | §05 | orbit structural ≥ 70 |
| `fractureFlag` | 'nose' \| 'jaw' \| 'hand' \| 'leg' \| null | §05 | |
| `attemptingToRise` | bool | §07 | |
| `knockedDown` | event | §05 | with `cause: 'legal_strike' \| 'slip' \| 'foul' \| 'push'` |

#### 2.3.2 Referee tick — master pseudocode

Runs once per tick (dt = 0.1 s) after resolution. `cfg` = strictness preset (§2.3.12), `rs` = ruleset.

```
refereeTick(state, rs, cfg):
  if rs.referee.present == false: return streetTick(state)                       # §2.3.11
  if state.paused: return pausedTick(state)                                       # counts, timeouts, doctor exams
  for each pending stoppage p in ref.pending:                                     # reaction lag (§2.3.3)
      if now >= p.commitAt and p.criterionStillTrue(): return endBout(p)
      if not p.criterionStillTrue(): ref.pending.remove(p)                        # fighter recovered / defended
  for f in activeFighters (ascending id):
      checkSubmission(f)              # §2.3.5  (tap/verbal/technical; own lag)
      checkKO(f)                      # §2.3.3
      checkTKOStrikes(f)              # §2.3.3
      checkCollapse(f)                # §2.3.3
      if rs.knockdown.counts: checkKnockdownEvent(f)                              # §2.3.4
      checkDoctorTriggers(f)          # §2.3.7 (in-round only for lacerations / fouls)
  processFoulQueue()                  # §2.3.6 (fouls flagged by resolution this tick)
  checkStandupsAndBreaks()            # §2.3.6b
  checkTimidity()
  if rs.family in {grappling, judo}: grapplingRefereeTick()                        # §2.3.9 / §2.3.10
  if roundClockExpired(): endRound()                                               # §2.5
```

**Reaction lag** (every stoppage except a tap): when a criterion first becomes true at `t0` the referee
*commits* to stop at `t0 + lag`; strikes continue to land during `lag` (the attacker's AI keeps attacking,
INT §7.5 D-3). If the criterion stops being true before `commitAt` (fighter starts defending intelligently)
the pending stoppage is cancelled — this is the "let them work" behaviour.

```
lag = cfg.refReactionS                                # 0.5 / 0.8 / 1.2 s strict/standard/lenient   [S: RULES §5 (assumption)]
    + travelS                                         # 0.4 s per metre of referee distance, 0.5–2.0 s [S: DMG §5.1 range]
    + (rng < cfg.pLagTail ? Exp(mean cfg.lagTailMeanS) : 0)   # 0.30 / 1.5 s [E] → heavy tail (Hutchison 0–20 s)
```
Calibration: KO-blow → stoppage mean 3.5 s, 2.6 extra head strikes [S: FD #49, #110]. With `refReactionS = 0.8`,
mean travel 1.2 s [E] and the tail 0.30 × 1.5 = 0.45 s [D], the KO lag mean is 0.8 + 1.2 + 0.45 ≈ 2.5 s [D]; the
remaining ~1 s comes from the KO criterion itself lagging the KO strike (§05 fall/limp animation) — verify in §5.

#### 2.3.3 Stoppage checks — KO / TKO / collapse

```
checkKO(f):                                                                        [S: RULES §3.1; DMG §5.1]
  if f.ko or f.limp: queueStoppage('ko', winner=opp(f), reason='strikes', lagKind='ko')

checkTKOStrikes(f):
  Nground = round(cfg.tkoUnansweredGround)              # 6 / 4 / 3
  Nstand  = round(cfg.tkoUnansweredStanding)            # 8 / 6 / 4
  if f.grounded and not f.intelligentDefence and f.unansweredHead >= Nground:
        queueStoppage('tko_strikes', opp(f), 'not intelligently defending (ground)')
  if f.grounded and not f.intelligentDefence and f.tSinceDefenceS >= cfg.tkoNoDefenceS:      # 3.0 / 2.0 / 1.2 s
        queueStoppage('tko_strikes', opp(f), 'covering without positional change')
  if not f.grounded and f.rocked and f.unansweredHead >= Nstand and not (f.clinching or f.moving):
        queueStoppage('tko_strikes', opp(f), 'rocked and not defending (standing)')
  if f.rocked and f.knockdownsLast10s >= 2:                                                   [S: DMG §5.1]
        queueStoppage('tko_strikes', opp(f), 'second knockdown while hurt')
  # "repetitive strikes" TKO — the referee also stops a fighter who is absorbing partly-defended volume:
  if f.absorbedWindow30 >= cfg.tkoAbsorbed30 and f.defenceQuality30 < 0.30 and (f.grounded or f.rocked):
        queueStoppage('tko_strikes', opp(f), 'repetitive strikes')     # 24 / 18 / 14 strikes  [D: from 18.5 ± 8.8 final-30-s strikes, FD #48]

checkCollapse(f):
  if f.bodyCollapse and not f.attemptingToRise and f.tSinceS > cfg.collapseGraceS:          # 6 s  [S: DMG §5.1]
        queueStoppage('tko_strikes', opp(f), 'body shot — cannot continue')
  if f.legCollapse and f.tSinceS > cfg.legCollapseGraceS:                                     # 5 s  [E]
        queueStoppage('tko_strikes', opp(f), 'leg — cannot stand')
```

Thresholds scale with a continuous strictness scalar `S ∈ {0.2, 0.5, 0.8}` for lenient/standard/strict via
`N × (1.4 − 0.8·S)` [S: DMG §5.1]; the table values above are the rounded results [D: 4 × 1.24 = 5 → we use 6 for the
lenient ground case to honour RULES §5's 8/5/3 spread; 4 × 0.76 = 3]. The two research files disagree on the ground
count (RULES 8/5/3 vs DMG 3–5); §4 carries the compromise 6/4/3 and §5 lists it as a calibration knob against FD #46
(loser absorbs a median 6 head strikes before stoppage).

"Not improving position" is never a stoppage criterion — it is a stand-up criterion (§2.3.6b) [S: RULES §3.1].
The referee may never call time to evaluate the effect of a legal strike except for a laceration [S: RULES §2.2].

#### 2.3.4 Knockdowns and counts (boxing / kickboxing / Muay Thai)

MMA has no counts: a knockdown is a damage event and the referee only applies §2.3.3 [S: RULES §3.2].

```
onKnockdownEvent(f, ev):                                                            [S: RULES §3.2, §2.3, §2.5]
  if ev.cause != 'legal_strike':
      signal('slip'); if rs.family == 'muay_thai' and f.refusesToRise(cfg.slipRiseCommands=3): startCount(f)  # MT rule
      return
  startCount(f)

startCount(f):
  state.paused = 'count'; opp(f).sentToNeutralCorner (1.0 s [E], no strikes allowed → 'hit_downed' foul otherwise)
  f.kdRound += 1; f.kdBout += 1; count = 0
  # count runs 1 per second, referee picks up from the timekeeper; the bell does NOT stop it (no saved-by-bell)
  every 1.0 s: count += 1; emit('refCount', count)
      if count == rs.knockdown.mandatoryCount (8):
          if f.standing and gaitTest(f): resumeAfterCount(f); return
          if f.eyesClosedOrSpasms (f.ko or f.limp): endBout('ko', opp(f), 'count stopped — no need to continue')
      if count >= rs.knockdown.koCount (10): endBout('ko', opp(f), 'count-out')
  # out of ring: count to rs.knockdown.outOfRingCountS (20); mandatory 18 if back sooner

gaitTest(f):                                                                        [S: RULES §2.3 "referee's gait test"]
  pPass = sigmoid( logit(0.85) − 3.0 × max(0, acuteHeadProxy(f) − 45)/45 − cfg.gaitStrictnessLogit )   # [E]
  # acuteHeadProxy = observable proxy from §05 (wobble/legs state), not the hidden pool
  # cfg.gaitStrictnessLogit: −0.85 / 0 / +1.4 lenient/standard/strict  [D: from RULES §5 p=0.3/0.5/0.8 → logit shifts]
  return rng < pPass

resumeAfterCount(f):
  if rs.knockdown.threeKdRound and f.kdRound >= rs.knockdown.threeKdRound: endBout('tko_three_kd', opp(f))
  if rs.knockdown.fourKdBout  and f.kdBout  >= rs.knockdown.fourKdBout:  endBout('tko_three_kd', opp(f))
  # ABC pro kickboxing: 3 in a round only counts knockdowns from head strikes                  [S: RULES §2.4]
  state.paused = null; f.residualRocked = true (§05 handles 5–15 s residual)

standingEight(f):   # GLORY only                                                    [S: RULES §2.4, §6.2]
  trigger: f.rocked and f.unansweredHead >= cfg.standingEightUnanswered (3 [E]) and not f.grounded
  behaves as startCount() but f stays standing; counts toward kdRound/kdBout
```

Whether the fighter is standing by 8 comes from §05 (knockdown-hurt: on the floor 1–3 s for a flash KD, 15–40 s rocked
for a hurt KD [S: DMG §2.1]); a fighter with `acuteHead ≥ 80` cannot rise in time [E]. Both fighters down and both fail
the count → technical draw [S: RULES §2.3].

#### 2.3.5 Submissions — taps, verbal taps, technical submissions

The *decision* to tap belongs to §04/§07 (pain, `heart`, tier); the referee only detects and stops.

```
checkSubmission(f):
  if f.tapped or f.verbalTap or f.screams:                                       [S: RULES §2.2 verbal tap incl. scream]
      lag = cfg.tapDetectS                                # 0.3 s median, LogNormal σ 0.4 [E]; taps on the mat/opponent
      queueStoppage('submission', opp(f), subType, lagKind='tap', lag)
  elif f.consciousness <= 0 and f.underChoke:                                    # technical submission — LOC
      lag = cfg.locDetectS                                # 1.0 s median [E]
      queueStoppage('technical_submission', opp(f), 'unconscious', lag)
  elif f.jointFailed:                                                            # refused tap → fracture/dislocation
      queueStoppage('technical_submission', opp(f), 'injury', lag = cfg.refReactionS)
```

Anchors: blood choke fully locked → LOC at 9.0 s mean (6–13 s) [S: SUBPHYS §1]; 89% of UFC choke finishes are taps,
11% LOC [S: SUBPHYS §3]; typical tap 3–7 s after full lock [S: SUBPHYS §4 (estimate)]; LOC → release 2.4 s
(asymptomatic) vs 5.0 s (symptomatic), ≥ 4 s post-LOC predicts symptoms [S: SUBPHYS §1]. The referee LOC lag 1.0 s
plus attacker release 0.5–1.5 s (§04) lands in the 2.4 s asymptomatic band [D: 1.0 + ~1.0]. Joint locks: pain precedes
failure, refused taps fracture within 1–3 s of full extension [S: SUBPHYS §4]; heel hooks give no warning
[S: SUBPHYS §2]. Submission to strikes is a TKO, not a submission [S: SUBPHYS §3].

Judo/IBJJF/ADCC: same detection (§04 supplies the same signals); judo chokes/locks are legal only in ne-waza and the referee calls *mate* on standing
locks (hansoku-make, §2.3.10).

#### 2.3.6 Fouls — occurrence, detection, consequence

**(a) Occurrence.** Every resolved action carries a foul roll. `p = pBase × tierMult(attacker) × contextMult`, drawn from
the seeded RNG after the hit roll. Per-action base probabilities [S: RULES §3.4 (assumptions)] re-scaled so the fight-level
rates in §5 come out [D: arithmetic in the last column]:

| Action (§02/§03 id family) | Foul | `pBase` | intent | Notes / derivation |
|---|---|---|---|---|
| straight punch / jab, open-hand range-finding (`tech.jab`, `tech.cross`, long guard posture) | `eye_gouge` (#2) via extended fingers (#9) | 0.0018 per straight attempt + 0.004 /s in long-guard posture | accidental; intentional if #9 repeated after warning | [D: 0.15 pokes/fight ÷ ~85 straight attempts per fight (FD #2: 8.4 att/min × 10.6 min × 2 fighters × ~0.48 straights) ≈ 0.0018]; long-guard rate [S: INT §2.4 0.3–0.6 %/s] |
| front kick / teep / knee to body | `groin` (#11) | 0.006 | accidental | [S: RULES §3.4] |
| round kick to body / low kick (inside) | `groin` | 0.003 | accidental | [S: RULES §3.4] |
| any head strike while target turns away | `back_of_head` (#7) | 0.015 | accidental; intentional after warning | [S: RULES §3.4] |
| ground-and-pound on turtle (`pos.ground_turtle_*`) | `back_of_head` | 0.03 per strike | accidental | [S: RULES §3.4] |
| knee to head when opponent has a knee/hand-and-knee down | `grounded_head_kick_knee` (#12) | 0.02 × (1 − refJudgement) | accidental (misjudged status) | [S: RULES §3.4]; ref calls it 70/85/97 % [S: RULES §5] |
| head kick vs opponent rising | `grounded_head_kick_knee` | 0.02 | accidental | [S: RULES §3.4] |
| takedown defence at fence (`def.sprawl` near wall) | `fence_grab` (#15) | 0.08 | reflexive; intentional after warning | [S: RULES §3.4]; ~0.2 calls/fight [D: 2.5 fence TD-defences × 0.08] |
| clinch at fence, wall-walk | `fence_grab` | 0.03 | reflexive | [S: RULES §3.4] |
| guard pass / GnP with fingers | `finger_in_cut` (#18) | 0.002 | accidental | [S: RULES §3.4] |
| wrestling scramble, hand-fighting | `small_joint` (#16) | 0.005 | accidental | [S: RULES §3.4] |
| slam with opponent inverted (§03 `takedown.slam`) | `spike` (#6) | 0.01 | by_context | [S: RULES §3.4] |
| strike launched ≤ 0.3 s before horn landing after it | `after_bell` (#24) | 0.03 | accidental | [S: RULES §3.4]; window [E] |
| non-engagement (backpedalling, no attempt) | `timidity` (#20) | timer, §(d) | by_context | [S: RULES §5] |
| head-butt in clinch (accidental clash) | `headbutt` (#1) | 0.004 per clinch entry | accidental clash (no deduction unless repeated); intentional = DQ-class | [E] |
| boxing: inside fighting / tie-up | `holding` | 0.15 per clinch entry | by_context | [E]; warnings ladder 3/2/1 [S: RULES §5] |
| boxing: punch aimed at body while opponent bends | `low_blow` | 0.004 per body punch | accidental | [D: 0.12 low blows/fight ÷ ~30 body punches per fight per boxer pair] |
| boxing: hook while opponent turns | `rabbit_punch` | 0.01 | accidental | [E] |
| kickboxing/MT: catch-and-carry > `catchKickStepLimit` | `catch_and_carry` | AI-driven | by_context | [S: MTKB §9] |
| kickboxing: sweep/throw attempt | `illegal_throw` | AI-driven (illegal action chosen) | intentional if T ≥ 3, accidental (reflex) if T ≤ 2 | [E] |
| judo: hand contacts leg during attack | `leg_grab_judo` | 0.05 per throw attempt at T ≤ 2, 0.01 at T ≥ 3 | shido | [E] |
| street | none — everything legal | | | |

`tierMult` (fighter tier of the fouler): T0 3.0 · T1 2.0 · T2 1.4 · T3 1.0 · T4 0.9 · T5 0.8 [E] (novices point fingers,
grab reflexively, mis-time the bell). `contextMult`: 1.5 when the fouler is rocked or `f ≥ 0.8` fatigue [E]; 2.0 when the AI's
`dirty` personality trait is set (§07) and the foul is then flagged `intentional` [E].

**(b) Detection.** The referee sees a foul with `pDetect` = 0.85 standard (0.75 lenient, 0.95 strict) [E] for contact fouls;
fence grabs 0.70/0.85/0.95 [E]; back-of-head 0.6/0.8/0.9 [E] (hard to see from some angles). Undetected fouls still do their
damage (§05) and the victim may protest: 0.05 chance the referee calls time anyway [E]. Grounded-status misjudgement uses
the 70/85/97 % table [S: RULES §5].

**(c) Consequence state machine** [S: RULES §2.2 foul procedure, §3.4]:

```
onFoulDetected(foul, fouler, victim):
  callTime(); state.paused = 'foul'; clock stops; emit('refFoulCall')
  effect = assessVictim(victim)                     # from §05: none | minor | substantial | cannot_continue
  intentional = foul.intentFlag == 'intentional'
             or fouler.warnings[foul.id] >= cfg.warningsBeforeIntentional      # 2 standard [E]
             or rs.fouls[foul.id].hard
  # --- recovery ---
  if foul.id in {groin, eye_gouge, fingers_extended, low_blow}:
      recoveryS = min(rs.fouls[foul.id].recoveryMaxS, victim.requestedRecoveryS())   # §05 pain curve; 300 s cap
      eye: victim must answer "can you see?" — vision < 0.4 on either eye → doctor (§2.3.7)
      acute pools decay during the pause (tactical benefit)                     [S: DMG §5.4]
  if effect needs doctor: doctorExam(victim, maxS = 300)
  # --- cannot continue ---
  if effect == cannot_continue:
      if intentional: return endBout('dq', winner = victim)                                     [S: RULES §2.2 A.1]
      if roundsCompleted >= rs.scoring.ncThresholdRounds(rs.rounds.count):
           return endBout(technicalDecisionOrDraw(cards incl. partial round))                    [S: RULES §2.2 B.2]
      else: return endBout('no_contest')  (referee may instead rule DQ if the foul was flagrant)   [S: RULES §2.2 B.1]
      # boxing: accidental low blow, cannot continue after 300 s → victim loses by TKO              [S: RULES §2.3]
      if rs.family == 'boxing' and foul.id == 'low_blow' and not intentional: return endBout('tko_strikes', winner = fouler)
  # --- sanction ---
  if intentional:
      deductPoints(fouler, rs.fouls[foul.id].deductionIntentional)   # 2, mandatory                 [S: RULES §2.2 A.2]
  elif foul.id == 'fence_grab' and effect >= substantial:
      deductPoints(fouler, 1); if positionGainedByGrab: restartStandingNeutral()                 [S: RULES §2.2 #15]
  elif fouler.warnings[foul.id] < cfg.warningsBeforeDeduction[foul.id]:
      warn(fouler)                                                                                # 2 / 1 / 0 lenient/standard/strict
  elif rng < cfg.pDeductAccidentalRepeat:                                                         # 0.3 / 0.6 / 0.9   [S: RULES §5]
      deductPoints(fouler, 1)
  else: warn(fouler)
  if fouler.pointDeductions >= cfg.dqAfterDeductions (4/3/2) or foul.flagrant: endBout('dq', victim)   [S: RULES §5]
  # --- restart ---
  restart(effect == none and positionFair ? positionBeforeFoul : standingNeutral)
  # injury caused by an intentional foul that later stops the fight (after the NC threshold):
  victim.markedInjury = {byFoul: foul.id, intentional}  → at any later stoppage caused by that injury:
       intentional → victim ahead on cards: technical decision; behind/even: technical draw       [S: RULES §2.2]
```

Point deductions are applied to the judges' cards for the round in which they occur (§2.4.4); judges never adjust their own
scores for fouls [S: RULES §2.3 (boxing S4); §2.2 (MMA)]. Gift found no judge bias against deducted fighters [S: LIT_B §3.6],
so no extra term.

**(d) Timidity.** `nonEngagementS` accumulates while a fighter is outside striking range, moving away, and has attempted
nothing; it resets on any attempt. At `cfg.timidityWarnS` (60/40/25 s) → warning; a second expiry → 1-point deduction
[S: RULES §5]. Faking an injury/foul to get time (AI exploit, §07) is treated as a timidity warning [S: RULES §2.2 #20].
Dropping the mouthpiece deliberately: same.

**(e) Rule-family overrides.** Boxing: `holding` ladder (warn ×3/2/1 → deduct) [S: RULES §5]; intentional foul 2 pts
[S: RULES §2.3]. GLORY: accidental foul before 2/3 or 3/5 rounds → NC, after → cards *without the foul round*
[S: RULES §2.4]. Muay Thai: same NC/TD thresholds as MMA [S: RULES §2.5]. ADCC: intentional strike / attempted illegal
technique → immediate DQ; accidental eye/groin/bleed → 120 s [S: RULES §2.6]. IBJJF: severe fouls DQ immediately; serious
fouls use the 4-step ladder (§2.3.9). Judo: shido / hansoku-make (§2.3.10).

#### 2.3.6b Stand-ups and clinch separation

"Effort" events (any of these by *either* fighter reset the position timer) [S: RULES §3.3; BJJ R2]: landed strike, strike
attempt (counted at most once per 5 s [E]), submission stage advance, pass/sweep/escape attempt, position change, get-up
attempt, mat return. Simply maintaining a superior position is not effort [S: RULES §2.2 (2026 text)].

```
checkStandupsAndBreaks():
  for each engaged pair (top, bottom) on the ground:
      mult = positionMult(pair.position)
      if pair.sSinceEffort >= cfg.standupWarnS × mult: sayOnce('work!')                          # 45/30/15 s
      if pair.sSinceEffort >= cfg.standupS × mult:     restart(standingNeutral); emit('refStandUp')   # 75/50/30 s
  for each clinch pair:
      if rs.clinch.activityRule == 'one_strike_then_break':
          if pair.strikesSinceEntry >= 1 or pair.sInClinch >= cfg.kbClinchMaxS: break()          # GLORY: 1 knee; ABC KB ≤ 5 s
      elif rs.clinch.activityRule == 'holding_is_foul':                                          # boxing
          if pair.sInClinch >= cfg.boxingBreakS (2.0 s [E]): break(); holdingFoulRoll()
      elif rs.clinch.activityRule == 'continuous':                                               # muay thai
          if pair.sSinceStrikeOrSweep >= cfg.mtClinchInactiveS (5–8 s; 6 [S: RULES §3.3 (assumption)]): break()
      else:                                                                                      # MMA
          if pair.atFence and pair.sSinceStrikeOrTdAttempt >= cfg.clinchBreakS (40/25/12): break()
          if not pair.atFence and pair.sSinceStrikeOrTdAttempt >= cfg.clinchBreakS × 0.8 [E]: break()
```

`positionMult` [S: BJJ R2 "15–30 s longer if top is dominant" → ×1.5; rest [E]]:
`pos.ground_mount_*`, `pos.ground_back_*`, `pos.ground_side_*`, `pos.ground_kob` 1.5 · `pos.ground_half_*` 1.0 ·
closed/open guard 1.0 · `pos.ground_turtle_*` / front headlock 0.8 · standing-over-guard 0.5 · cage-seated 0.9.
Bottom activity (sub or sweep attempts) resets the timer for both — "rarely stand when bottom is active" [S: RULES §5].
Restarts after a stand-up are standing at distance, centre of the area; after a break, standing at long range [E].

#### 2.3.7 Doctor checks

Triggers [S: DMG §2.5, §5.2]: a cut reaches severity 3; an eyelid cut reaches severity 2; blood into an eye for > 60 s of
fight time; eye swollen shut (orbit structural ≥ 70); suspected fracture (nose structural ≥ 80 with breathing impairment,
jaw fracture event); after an eye poke when the fighter reports vision loss. In-round, the referee may stop the action for
a laceration only [S: RULES §2.2]; other triggers wait for the break. `cfg.cutDoctorCall` (0.75/0.60/0.45 on a 0–1
severity scale [S: RULES §5]) maps to "severity 3 / 2.4 / 1.8 of 3" [D: × 3 and floor at the DMG severity-3 rule for
standard].

```
doctorExam(f, context):                       # takes 20–60 s of wall time [E]; between rounds it consumes the break
  stop = f.visionL <= 0.4 or f.visionR <= 0.4                                                    [S: DMG §5.2]
      or (cut.site in {eyelid, orbit-crossing} and cut.severity >= 3)                           [S: RULES §2.3 S5 orbit rule]
      or (cut.severity >= 3 and bleedUncontrolledAfterCutman)
      or f.fractureFlag in {jaw, leg} or (fractureFlag == nose and breathingImpaired)
  pStop = stop ? cfg.pDoctorStopOrbit (0.6/0.8/0.95) : (visionImpaired ? cfg.pDoctorStopVision (0.5/0.7/0.85) : 0.05 [E])
  pStop shifted ±15 % by doctor leniency attribute                                               [S: DMG §5.2]
  if rng < pStop: endBout('tko_doctor', opp(f), 'laceration' | 'vision' | 'fracture')
  else: allow corner to work the cut for the remaining break; mark cut 'watched' (re-check next break automatically)
  # referee gives the corner the rest period first when the round is nearly over (≤ 30 s left [E])   [S: RULES §2.3]
```

Target: doctor stoppages 0.8–1.1 % of fights, ≈ 2.4 % of strike stoppages [S: FD #109] (DMG §2.5 says 2–4 % — conflict;
FD is the calibration authority). Cut-man effect −1 severity on the worst cut per break, never below 1; cuts re-open on the
next 2 clean strikes [S: DMG §2.5].

#### 2.3.8 Corner stoppage

Evaluated at `breakS × 0.75` into each break and continuously in-round [S: DMG §5.3]:

```
cornerWantsOut(f) = (f.structuralHead >= 80 and lostLastRoundDecisively(f))
                 or (f.fatigue >= 0.9 and opponentDominant)
                 or (f.mobility <= 0.4 from hand/leg injury)
pTowel = cornerWantsOut ? sigmoid(logit(0.5) + 2.0 × (corner.protectiveness − 0.5) − 1.0 × titleFight) : 0     # [E]
```
Delivery: MMA/MT `direct` (towel or entering the cage → immediate `tko_corner`) [S: RULES §2.2, §2.5]; US boxing
`via_inspector` adds 5–15 s [E] before the referee is informed [S: RULES §2.3 "towel cannot stop"]. Target share 1–2 % of
bouts [S: DMG §5.3 (estimate)]. Corner stoppages count inside the KO/TKO bucket of FD #88.

#### 2.3.9 Grappling referees — IBJJF, ADCC, sub-only

Position-to-points mapping (from §03 ids; both systems require `stabilisedS ≥ 3` and no active §04 submission threat on the
scorer) [S: RULES §2.6; BJJ §9.1–9.2]:

| §03 event / position | IBJJF | ADCC |
|---|---|---|
| takedown → opponent back/side on mat, scorer on top (`pos.ground_*` bottom is guard/half) | 2 | 2 (4 if landed past guard) |
| sweep / reversal from bottom guard to top | 2 | 2 (4 if past guard in the same motion); reversal counts as sweep; no sweep points if the top player initiated a submission and ended on bottom |
| `pos.ground_kob` | 2 | 2 |
| guard pass → `pos.ground_side_*`, `pos.ground_north_south`, kesa | 3 | 3 (≥ 75 % of back on mat) |
| `pos.ground_mount_*` (both knees, below shoulder line) | 4 | 2 |
| `pos.ground_back_hooks` / body triangle | 4 | 3 |
| pass straight to mount | pass + mount only if each stabilised | pass only |
| exiting the area to escape a submission | 2 to attacker | −1 (fleeing) |
| re-scoring the same position | must lose it first | must lose it ≥ 3 s |

```
ibjjfTick():
  for each position change: if stabilisedS >= 3 and not scorerUnderSubmission: award(table)
  elif nearlyCompleted (stabilisedS < 3 or lost while completing): pendingAdvantage → award when the chance is gone
  submission attempt that put the opponent in "real danger" (§04 stage >= locked) and failed → advantage
  stalling clock: if no positional progression by top or bottom for 20 s (not when defending from mount/back/side/N-S):
       ladder[fighter]++ : [warning, advantage to opp, 2 pts to opp, DQ]                            [S: RULES §2.6]
  double guard pull: 20 s → both penalised, restart standing
  illegal technique for the division → DQ (technical severe); disciplinary → DQ from event
  at time: points → advantages → fewer penalties → referee decision (offensive initiative, closeness) → random pick
adccTick():
  if t < rs.rounds.noPositivePointsBeforeS: no positive points; passivity: 'WARNING PASSIVITY' ×2 then −1 each; warnings issued
       in the no-points half convert to −1 when the scoring half starts
  else: award(table); guard pull / one or both knees down ≥ 3 s while both standing → −1; backing up / refusing to engage → −1;
       fleeing the mat → −1 (and fleeing a submission more than once)
  at time: tie → overtime (5 or 10 min, max 1 or 2) → still tied: referee decision by dominance (aggression, near-submissions)
  referee stops the match if a competitor is unable to defend or in danger (LOC)                     [S: RULES §2.6]
subOnlyTick():
  no points; at time → draw, or EBI overtime if enabled: alternating starts from pos.ground_back_hooks / spiderweb;
  a submission wins; else the shorter cumulative escape time wins                                    [S: BJJ §9.3]
```

#### 2.3.10 Judo referee (IJF 2025–28)

```
ijfTick():                                                                            [S: RULES §2.7, §3.6; JUDO §9]
  on throw landing (from §03 throw resolution: {onBack, angleDeg, speed, force, control}):
      onBack and speed and force and control → ippon (ends)
      landing > 90° of shoulder axis but not on the back, or ippon missing one criterion → waza-ari
      side landing ≥ 90° / upper back / neck / shoulder-and-elbow / both buttocks / hands-elbows from an attack → yuko
      second waza-ari → ippon (waza-ari awasete ippon); yuko never accumulates
  osaekomi (a Kodokan-classified pin from §03, uke not holding tori's leg): timer 5 s yuko, 10 s waza-ari, 20 s ippon
      in golden score: 5 s yuko ends the contest
  ne-waza continuation: allow ground work while there is progress; mate after 5–10 s without progress   [S: JUDO §9]
  shido triggers: no attack 45 s after kumi-kata (30 s per JUDO §9 — use 45 s, IJF SOR text [S: RULES §2.7]); false attack;
      leg grab; stepping out deliberately; defensive grips; interlocked fingers; bear hug with clasped hands without attack;
      third shido → hansoku-make (athlete may continue in the competition)
  direct hansoku-make: head-diving throw, kani-basami, kawazu-gake, do-jime, ashi-garami, standing kansetsu/shime-waza,
      somersaulting with uke on the back, lifting and slamming, disregarding the referee
  at 240 s with equal scores (compare waza-ari count, then yuko count) → golden score until any score or hansoku-make
  submission (choke/armlock in ne-waza) → ippon
```
Frequency targets [S: FD §2.6 judo; JUDO §9]: ≈ 65 % end in regulation, ≈ 35 % reach golden score; of decisive outcomes
ippon ≈ 45–55 %, waza-ari ≈ 20–30 %, penalties ≈ 20–30 % (composite estimate in JUDO §9).

#### 2.3.11 Street mode (no referee)

```
streetTick():                                                                         [S: RULES §2.8; FD §6]
  for each participant p:
      if p.ko or (p.grounded and cannotStandFor >= 10 s [E]) or p.fractureFlag in {leg}: p.state = incapacitated
      if p.ai.decides('flee') and p.mobility > opponentsNearby.maxMobility × 0.9 [E]: p.state = fled (success roll 0.7 [E]; failure = caught, +stagger)
      if p.ai.decides('surrender') (verbal, curling up, hands up): p.state = surrendered  — attackers' AI stops with p = 0.8 per attacker [E]
  hazards per tick (seeded): separation λ_sep = 0.010/s × (1 + 0.3 × bystanders) after 10 s [E] (median ≈ 30 s [D: ln2/0.02 ≈ 35 s, inside RULES §2.8's 20–40 s]);
                             weapon λ_w = rs.street.weaponHazardPerS (0.001/s [E]); arrival λ_a = 0.005/s [E]
  end when: defender incapacitated/fled/surrendered, or all attackers incapacitated/fled/surrendered, or separation/weapon/arrival fires
  surface: falls/slams/knockdowns onto 'concrete'/'asphalt' multiply head impact by §05's hard-surface factor (§05 owns the number)
  free attacker vs grounded target: stomps/soccer kicks are legal actions with §05 lethality; the player's own AI never selects them (design rule)
```
No rounds, no rest, no counts; adrenaline dump per INT §7.6 / DMG §4.6 (§05 owns it).

#### 2.3.12 Referee strictness presets

All values are design defaults [S: RULES §5 (assumptions)] unless tagged; `[D]` where re-derived above.

| Parameter id | Lenient | Standard | Strict | Anchor |
|---|---|---|---|---|
| `ref.strictnessScalar` | 0.2 | 0.5 | 0.8 | [S: DMG §5.1] |
| `ref.tkoUnansweredGround` | 6 | 4 | 3 | [D: §2.3.3] |
| `ref.tkoUnansweredStanding` | 8 | 6 | 4 | [D: DMG 5–8 × scalar] |
| `ref.tkoNoDefenceS` | 3.0 | 2.0 | 1.2 | [S: RULES §5] |
| `ref.tkoAbsorbed30` | 24 | 18 | 14 | [D: FD #48 18.5 ± 8.8] |
| `ref.collapseGraceS` | 8 | 6 | 4 | [S: DMG §5.1 6 s; spread E] |
| `ref.refReactionS` | 1.2 | 0.8 | 0.5 | [S: RULES §5] |
| `ref.pLagTail` / `ref.lagTailMeanS` | 0.35 / 2.0 | 0.30 / 1.5 | 0.20 / 1.0 | [E] |
| `ref.cutDoctorCall` (0–1) | 0.75 | 0.60 | 0.45 | [S: RULES §5] |
| `ref.pDoctorStopOrbit` / `ref.pDoctorStopVision` | 0.6 / 0.5 | 0.8 / 0.7 | 0.95 / 0.85 | [S: RULES §5] |
| `ref.standupWarnS` / `ref.standupS` | 45 / 75 | 30 / 50 | 15 / 30 | [S: RULES §5] |
| bottom-active stand-up | never | rarely (reset) | as timer | [S: RULES §5] |
| `ref.clinchBreakS` (MMA fence) | 40 | 25 | 12 | [S: RULES §5] |
| `ref.kbClinchMaxS` | 5 (if effective) | 1 knee then break | 1 knee, immediate | [S: RULES §5] |
| `ref.boxingHoldingWarnings` | 3 | 2 | 1 | [S: RULES §5] |
| `ref.warningsBeforeDeduction` (accidental) | 2 | 1 | 0 (if any effect) | [S: RULES §5] |
| `ref.pDeductAccidentalRepeat` | 0.3 | 0.6 | 0.9 | [S: RULES §5] |
| `ref.deductionIntentional` | 2 | 2 | 2 | [S: RULES §2.2] |
| `ref.dqAfterDeductions` | 4 | 3 | 2 | [S: RULES §5] |
| `ref.timidityWarnS` | 60 | 40 | 25 | [S: RULES §5] |
| `ref.groundedJudgement` | 0.70 | 0.85 | 0.97 | [S: RULES §5] |
| `ref.gaitStrictnessLogit` | −0.85 | 0 | +1.4 | [D: from p 0.3/0.5/0.8] |
| `ref.mtOutmatchedRatio` (damage ratio) | 6:1 | 4:1 | 3:1 | [S: RULES §5] |
| `ref.pDetectContactFoul` | 0.75 | 0.85 | 0.95 | [E] |
| `ref.warningsBeforeIntentional` | 3 | 2 | 1 | [E] |
| `ref.standingEightUnanswered` (GLORY) | 4 | 3 | 2 | [E] |
| IBJJF stalling clock | 20 s | 20 s | 20 s (earlier "lute" cue) | [S: RULES §5] |

Strictness also carries a **referee experience** overlay: `regional` adds +0.3 s to `refReactionS` and widens the tail
(`pLagTail` +0.1) [E]; `elite` subtracts 0.1 s [E]. Referee task-load pressure (crowd, corner) is documented as a
demand [S: RULES §6.1 (S19)] but not modelled beyond the tail.

### 2.4 Judging

#### 2.4.1 Round ledger

`RoundLedger[fighter][round]` is filled from events (§02, §03, §04, §05) and frozen at the horn. Counts are per fighter, "vs
opponent" where noted:

`kd` (knockdowns scored, incl. flash), `rockedCaused`, `bodyHurtCaused`, `cutsOpened` (visible), `structuralHeadDealt`
(Δ opponent structuralHead, pts), `sigHead`, `sigBody`, `sigLeg`, `nonSigLanded`, `sigAttempted`, `groundSigHead`,
`tdLanded`, `tdLandedPastGuard`, `tdMissed`, `subLocked` (attempts reaching §04's locked stage), `subEarly` (attempts
that did not), `reversals`, `passes`, `dominantPositionsGained`, `controlOffenceS` (control seconds with ≥ 1 strike or
sub/pass attempt per 10 s [E]), `controlPassiveS`, `oppPurelyDefensiveS`, `aggressionS` (seconds pressing forward /
initiating), `centreS` (seconds controlling the centre or pinning the opponent to the fence/ropes), `defenceQuality`
(boxing), `roundSecondsElapsed` (partial rounds), plus family-specific: `cleanMtTechniques{bodyKick, knee, elbow, punch,
lowKick, teepEffective, sweepOffBalance}`, `stumbles` (visible balance loss), `catchAndDump`, `spectacularLanded`
(spinning/jumping/head kick), `powerPunchLanded`, `jabLanded`, `bodyPunchLanded`, `hurtEvents`.

#### 2.4.2 MMA — 10-point must, `unified_2025`

All weights are in **judge-logit units** (a knockdown = 1.0). Ratios follow Holmes' AMEs [S: LIT_B §3.5, §6] rescaled
KD → 1.0 [S: LIT_B §3.5 "use these AMEs directly… knockdown 1.0 (reference)"]; damage terms that the statistical model
could not observe are added per the ABC criteria [S: RULES §2.2 S2] with sizes from Collier ("visible damage 0.3–0.5 of a
knockdown") [S: LIT_B §3.7]:

```
dmg(X) = 1.00·kd                                                          [S: LIT_B §3.5]
       + 0.45·rockedCaused + 0.30·bodyHurtCaused + 0.25·cutsOpened       [S: LIT_B §3.7 range → E for the split]
       + 0.010·structuralHeadDealt                                        # cumulative damage [E]
       + 0.40·subLocked + 0.15·subEarly                                   [S: LIT_B §3.5 0.40; early split E]
       + 0.26·reversals + 0.21·tdLanded − 0.08·tdMissed                   [S: LIT_B §3.5]
       + 0.09·sigHead + 0.06·sigBody + 0.055·sigLeg + 0.013·nonSigLanded  [S: LIT_B §3.5]
       + 0.10·passes + 0.10·dominantPositionsGained                       [E: "advantageous positions" in S1]
dom(X) = 0.0038·controlOffenceS + 0.0015·controlPassiveS                 [S: LIT_B §3.5 0.0038/s; passive discount E per S2 "merely holding"]
       + 0.50·(oppPurelyDefensiveS / roundS)                              [E]
dur(X) = (controlOffenceS + aggressionS) / roundS                         # 0..1, informational for 10-7
margin = (dmg(A) + dom(A)) − (dmg(B) + dom(B))                            # > 0 favours A
```

Plan A/B/C [S: RULES §2.2]: if `|margin| < judge.evenThreshold` (0.15 [E]) add `0.10·sign(aggressionS_A − aggressionS_B)`
(Plan B); if still below threshold add `0.05·sign(centreS_A − centreS_B)` (Plan C) [E]. Defence is never scored
[S: RULES §2.2 S2].

Per-judge perception and score:

```
perceived_j = margin × styleScale_j + judge.noiseScale × Logistic(0,1) + bias_j        # noiseScale 0.32 [D: §2.4.3 Monte Carlo]
winner = sign(perceived_j)
if |perceived_j| < judge.T10 (0.05) and rng < judge.p1010 (0.5 × cultureFactor; 1.0 unified_2025 → 0.5): score 10-10  # [D: MC → ≈1.2 % of judge-rounds]
sigDamage(w) = kd(w) ≥ 1 or rockedCaused(w) ≥ 2 or dmg(w) ≥ judge.tenEightDamage (2.0 [E])
domination(w) = dom(w) ≥ judge.tenEightDom (0.6 [E]) and offence(l) ≤ 0.25·offence(w)   # offence = dmg without kd/rocked terms [E]
T8_j = judge.tenEight (2.6) × propensity_j   # propensity_j ~ N(1, 0.25) persistent per judge [D: MC j8]
if kd(w) ≥ 2 or (sigDamage and domination and dur(w) ≥ 0.8 and |perceived_j| ≥ 4.0 [E]):        score 10-7
elif (sigDamage and |perceived_j| ≥ 1.2 [E]) or (|perceived_j| ≥ T8_j and domination):           score 10-8
else:                                                                                            score 10-9
# positional control alone never yields a 10-8                                                    [S: RULES §2.2 S2]
score -= refDeductions(loser or fouler, round)                                                     [S: RULES §2.2]
```

Culture `legacy_2016`: control weights × 1.5, damage weights × 0.8, `tenEight` × 1.3, `p1010` × 3 [E] (more 10-10s, fewer
10-8s [S: RULES §5]). Culture `whole_fight` (ONE/PRIDE): one card per judge for the whole bout using
`Σ_rounds margin_r` with a near-finish bonus (+1.0 for any round with `kd ≥ 1` or `subLocked ≥ 1` [E]); no draws [S: RULES §4.1].

#### 2.4.3 Per-judge model — noise, biases, reliability

Each of the `rs.scoring.judges` (3) judges is an object with persistent, seeded traits:

| Trait | Distribution / value | Tag |
|---|---|---|
| `noiseScale` | 0.32 logit (logistic scale) | [D: Monte Carlo below] |
| `styleScale` | weight-vector perturbation: each weight × (1 + N(0, 0.15)), fixed per judge | [E] (Holmes: judges value control more when the controller has high sub probability) |
| `propensity1008` | N(1, 0.25) | [D: MC `j8`] |
| `prevRoundBias` | +0.15 logit toward the fighter *this judge* scored the previous round for, applied only when `|margin| < 1.0` | [D: Gift "+3–5 pp round-win" → 0.04 / 0.25 ≈ 0.16, LIT_B §3.6] |
| `reputationBias` | +0.137 logit per 10 ranking places in favour of the higher-ranked / bigger favourite, capped ±0.40 | [D: Holmes +0.034 per 10 places ÷ 0.25, LIT_B §3.5]; use `rankGap` if ranks exist, else 0.10 × ln(oddsRatio) [E] |
| `homeBias` | +0.145 logit for the home fighter **only if** `rs.referee.crowdPresent` | [D: Holmes +0.036 ÷ 0.25; no crowd → 0, LIT_B §3.5] |
| `leadBias` | +0.15 logit toward a fighter this judge has ahead by ≥ 2 rounds entering the round (3R: 2-0; 5R: 3-0 or 3-1) | [E, direction from Gift "insurmountable lead", LIT_B §3.6] |
| titleholder bias, deduction bias | 0 | [S: LIT_B §3.6 Gift: no support] |

**Monte Carlo tuning (run for this section, 400 000 three-round fights).** Assumed true-margin distribution in decision
fights: fight-level differential `N(0, 1.2)` shared across rounds plus round-level `N(0, 0.8)` [E] (round-margin SD
≈ 1.44 [D: √(1.2² + 0.8²)]); judge noise `0.32 × Logistic`; 10-8 threshold 2.6 with `N(1, 0.25)` propensity; 10-10 when
`|perceived| < 0.05` with p = 0.5. Results: judges agree on the round winner 75.3 % (target 77 % ± 4 [S: FD #114]);
decisions unanimous 77.0 % / split 18.3 % / majority 3.0 % (targets 77 / 20 / 2.5 ± 3 [S: FD #105]); draws 1.67 % of
decisions (target 1.5 %, i.e. 0.7 % of fights [S: FD #107]); 10-8 rounds 8.9 % of judge-rounds (target ≈ 8 % [S: INT §7.4]);
10-10 1.3 % of judge-rounds. Adding `prevRoundBias` 0.15 moved agreement to 76.0 % and split to 18.5 % [D]. With
`noiseScale = 1.0` the model *is* Holmes' fitted logistic; the smaller value reflects that the sim's margin includes
damage terms the regression could not observe. The noise is therefore specified as a ratio: `noiseScale / SD(round margin)
= 0.22` [D: 0.32 / 1.44] — if the engine's measured round-margin SD differs from 1.44, rescale `noiseScale` (§5).

Reliability reference: single-judge reliability 0.62–0.69, five-judge panel 0.89–0.92 (amateur boxing, World Boxing 2025)
[S: RULES §6.1]; the sim's three-judge agreement of ~76 % sits between those.

Judge experience overlay: `regional` judges use `noiseScale` 0.45 and `styleScale` σ 0.25 [E]; `elite` 0.30 [E].

#### 2.4.4 Bout decision aggregation

```
decideBout(cards, rs):
  for j: total_j = Σ_r score_j[r] (partial round included at a technical decision, "even if no action")   [S: RULES §2.2]
  winners = [sign(total_j.A − total_j.B)]
  3 same non-zero → unanimous decision; 2 for X and 1 for Y → split decision; 2 for X and 1 draw → majority decision
  3 draws → unanimous draw; 2 draws + 1 X → majority draw; X, Y, draw → split draw                  [S: RULES §2.2]
  technical decision / technical draw: same rules, `method` prefixed 'technical'
  rs.scoring.drawsAllowed == false (GLORY sudden victory): judges may not score the extra round even; the extra round alone decides
  rs.scoring.championRetainsOnDraw: title bout draw → champion retains (recorded as draw)
  rs.rounds.extra and draw: play extra round(s) per §2.5, then re-aggregate on the extra round only (GLORY) [S: RULES §2.4]
```
Per-round scoring (consensus) vs card-total scoring differ in only ~2.5 % of bouts [S: LIT_B §3.12]; the sim uses card
totals (standard) and exposes `consensus` as a display option only.

#### 2.4.5 Boxing (`boxing_abc`)

```
base(X) = 0.10·powerPunchLanded + 0.05·jabLanded + 0.08·bodyPunchLanded + 0.45·hurtEvents            [E: ratios from RULES §4.2 scaled to the KD = 1.0 logit unit]
        + 0.30·aggrIndex + 0.20·generalshipIndex + 0.15·defenceQuality                                  [S: RULES §4.2 ordering; sizes E]
margin = base(A) − base(B);  perceived_j as in §2.4.2 with noiseScale 0.40 [E] and homeBias 0.18      [D: MC — 0.18 logit/round reproduces P(home points win) = 0.74 over 12 rounds for equal boxers, LIT_B §3.9]
kdW = kd(winner); kdL = kd(loser); net = kdW − kdL                                                     [S: RULES §2.3 S4]
if net == 0: score = (|perceived_j| ≥ T8_j and offence(loser) ≈ 0) ? 10-8 : 10-9
if net == 1: score = 10-8; but 10-9 if the loser decisively won the rest (base margin excluding hurt/KD ≥ 1.0 against the KD scorer) AND hurt the winner
             (a flash KD late in a round the other boxer dominated stays 10-9 to the KD scorer [S: RULES §2.3])
             10-7 if net == 1 and |perceived_j| ≥ judge.decisiveMargin (2.6)
if net == 2: 10-7;  net ≥ 3: 10-6 (and lower with more)
10-10 only if nothing separates them (T10 0.05, p1010 0.3 [E])
"do not let a fighter steal a round with a last-second flurry": strikes in the final 10 s carry weight × 0.7 [E]
```
Accuracy dominance: winners hit 33 % vs losers 23 % and accuracy alone classifies 76.9 % of amateur rounds
[S: LIT_B §3.8]; with ~55 punches thrown per round [S: FD §2.6] a 10-pp accuracy gap ≈ 5.5 landed ≈ 0.5 logit [D], which
is decisive at `noiseScale` 0.40 in most rounds. Target: ~30 % of three-judge pro decisions non-unanimous
[S: RULES §4.2 (inferred)].

#### 2.4.6 Muay Thai (`muay_thai_abc`, `thai_stadium`)

```
abcMuayThaiRound():                                                                   [S: RULES §2.5, §4.4]
  if kd(A) != kd(B): winner = more/better knockdowns (never loses the round)
  elif |cumDamage(A) − cumDamage(B)| > judge.mtDamageT1 (0.5 logit [E]): winner = more damage   # cumDamage = dmg() without kd term
  elif technique(A) != technique(B): winner = higher
       technique = 1.0·bodyKick + 1.0·knee + 0.9·elbow + 0.6·punch + 0.5·lowKick + 0.8·sweepOffBalance + 0.4·teepEffective   [S: RULES §4.4 (assumption)]
  else: aggression / control / effective defence (Plan B/C style, 0.10 / 0.05 / 0.05 [E])
  score: 10-9 slight or clear; 10-8 overwhelming (|perceived| ≥ T8) or won + 1 KD; 10-7 won + 2 KD; 10-6 won + 3 KD
thaiStadiumBout():                                                                    [S: RULES §4.4 (unverified culture)]
  roundWeight = [0.5, 0.75, 1.25, 1.25, 0.75]; impression_j = Σ_r roundWeight[r] × perceived_j[r]
  composure: −0.20 per stumble / visible hurt, +0.30 per catchAndDump [E]; "least damaged wins even rounds"
  cards are still emitted per round (for the HUD) but the decision uses impression_j; kicks/knees to body outrank punches
  unless punches visibly hurt (already in technique weights); rounds 3–4 decisive; R5 coasted by the leader is an AI matter (§07)
```
Late-round emphasis is supported by Bhumipol (winners raise kick volume/accuracy in R5) [S: LIT_B §5.6].

#### 2.4.7 Kickboxing (`glory`, also used by `kickboxing.k1`)

```
gloryRound():                                                                         [S: RULES §2.4, §4.3]
  if kd(A) != kd(B): winner = more KDs (cannot lose the round unless point deductions flip it)
  else: damage first — highImpact = 0.60·rockedCaused (wobble/stagger) + 0.010·structuralHeadDealt (cumulative)   [E sizes]
        → clean strikes: 0.09·sigHead + 0.06·sigBody + 0.055·sigLeg, spectacularLanded × 1.3 [E]
        → aggression / ring domination (attack > defence): 0.10 / 0.05 [E]
  score: 10-9 default; 10-8 = KD or (highImpact ≥ 0.6 and domination); 10-7 = two KDs; 10-10 only with no marginal advantage
  minus points subtracted first (10-9 winner with −1 → 9-9)
  draw after scheduled rounds → sudden-victory round (drawsAllowed = false in that round); K-1 variant: one extra round [E]
```

#### 2.4.8 Grappling and judo decisions

```
IBJJF: points → advantages → fewer penalties → referee decision (offensive initiative, who came closer) → random pick
ADCC:  submission → points after the scoring half → OT → referee decision by dominance (aggression, near-submissions)
Sub-only: submission → draw (or EBI OT: submission, else shorter cumulative escape time)
Judo:  ippon → 2× waza-ari → waza-ari count → yuko count → golden score (first score / 3rd shido); shido never scores
```
[S: RULES §4.5; BJJ §9.3]

Referee decision (IBJJF/ADCC) uses `dom()` from §2.4.2 plus `subLocked` × 0.40 with `noiseScale` 0.32 and no biases [E].

### 2.5 Round and bout flow

```
boutFlow(rs):
  emit('boutStart'); for r in 1..rs.rounds.count: runRound(r); if boutEnded: break
  if not boutEnded: cards → decideBout(); if draw and rs.rounds.extra: for e in 1..extra.max: break(extra.breakS); runRound(extra); re-decide
  if rs.rounds.goldenScore and tied: runGoldenScore() (no time limit; ends on first score / hansoku-make)
runRound(r):
  emit('roundStart'); fighters at neutral start positions (standing, centre); clock = 0
  loop ticks: refereeTick(); if clock ≥ lengthS: horn()
horn():
  strikes whose impact tick is ≤ 0.3 s [E] after the horn resolve normally; actions *initiated* after the horn → 'after_bell' foul
  counts in progress continue past the horn (no saved-by-bell)                                       [S: RULES §6.2]
  a fighter who is `ko` at the horn: stoppage stands ('ko'); a fighter rocked at the horn recovers in the break (§05 §4.4)
  judges freeze RoundLedger, score (§2.4), emit('scorecardRound', visibility per rs.scoring.openScoring)
  emit('roundEnd'); emit('tenSecondWarning') at breakS − 10 during the break
break(breakS):
  t=0–5 s corner enters, stool; cutman: −1 severity on worst cut                                    [S: DMG §2.5]
  t=5 s: doctor check if any §2.3.7 trigger is active (exam 20–60 s [E]; may end the bout: 'tko_doctor')
  t=5–45 s: corner cues (§07 CO-1..CO-4); physiology recovery (§05 §4.4)
  t=breakS × 0.75: corner stoppage decision (§2.3.8)
  t=breakS: fighter must stand and be ready; if `f.cannotStand` or `f.consciousness < 0.5` [E]: endBout('tko_bell')     [S: RULES §2.2]
  loss of bodily function during the break → doctor evaluates → likely 'tko_bodily'                 [S: RULES §2.2]
multiOpponent (rs.multiOpponent.replacement):
  'none'    : all opponents active from the start (existing 1vN); a stopped fighter leaves; bout ends when a side is empty
  'gauntlet': next opponent enters (fresh) when the current one is stopped; timer continues; the single fighter gets no break  [E]
  'tag'     : side B rotates its active fighter at each break; inactive members recover at §05's break rate × 1.5 [E]
  referee logic applies per engaged pair; stand-ups/breaks per pair; a "free" attacker is never restrained by the referee
  street: replacement 'none'; participants may flee individually (§2.3.11)
overtime: GLORY extra round (breakS 90); ADCC 300/600 s; judo golden score; EBI OT; boxing/MT/MMA: none (draw stands)
```

Between-round scorecards are visible to fighters/corners only when `openScoring != 'hidden'`; §07's score awareness
uses `perceivedScore` (INT SC-1) when hidden and the true card when open.

### 2.6 Events for commentary and HUD (§08 HUD, §09 commentary)

Extends the existing `EventKind` [S: AUDIT §1.1; `src/engine/types.ts`]. Every event carries `{t, tick, round, actor,
target, detail, text}`; `actor = -1` for officials. `templateId` is the §09 commentary template key; §08 decides HUD rendering.

| Kind | detail / payload | Visible on HUD | Notes |
|---|---|---|---|
| `refWarning` | `{fighter, foulId, count}` | yes | "Watch the fingers!" |
| `refPointDeduction` | `{fighter, foulId, points, intentional}` | yes (card overlay) | |
| `refFoulCall` | `{fighter, foulId, detected, effect}` | yes | undetected fouls emit with `detected=false` for replay only |
| `refTimeout` | `{reason: 'foul' \| 'doctor' \| 'equipment', maxS}` | yes (clock stops) | |
| `refRecoveryClock` | `{fighter, elapsedS, maxS}` | yes | 5-min clock |
| `refCount` | `{fighter, count, standing: bool}` | yes (big count) | one per second |
| `standingEight` | `{fighter}` | yes | GLORY |
| `refStandUp` | `{position, sSinceEffort}` | yes | |
| `refBreak` | `{reason}` | yes | clinch break |
| `refWork` | `{pair}` | audio only | "work!" cue |
| `refStoppage` | `{method, loser, reason, lagS, extraStrikes}` | yes | KO/TKO |
| `submissionTap` / `technicalSubmission` | `{sub.*, stage, verbal, loc}` | yes | |
| `doctorCheck` / `doctorStoppage` | `{fighter, trigger, decision}` | yes | |
| `cornerStoppage` | `{fighter, via: 'towel' \| 'inspector' \| 'entered'}` | yes | |
| `knockdown` | `{fighter, cause, flash}` | yes | existing kind |
| `scorecardRound` | `{round, scores[judge][fighter], visibility}` | per `openScoring` | hidden cards still recorded for post-fight |
| `scorecardFinal` | `{totals, method}` | yes | read in order judge 1..n |
| `decision` / `technicalDecision` / `noContest` / `disqualification` | `{winner, method, cards}` | yes | |
| `pointsAwarded` / `advantage` / `penalty` | `{fighter, value, reason, position}` | yes (scoreboard) | IBJJF/ADCC |
| `ippon` / `wazaAri` / `yuko` / `shido` / `hansokuMake` / `osaekomiStart` / `osaekomiEnd` / `goldenScoreStart` | `{fighter, source}` | yes | judo |
| `overtimeStart` / `suddenVictoryStart` | `{period}` | yes | |
| `horn` / `tenSecondWarning` / `roundStart` / `roundEnd` | `{round}` | yes | |
| `streetEnd` | `{reason: 'incapacitation' \| 'flight' \| 'surrender' \| 'separation' \| 'weapon' \| 'arrival', participant}` | yes | |
| `timidityWarning` | `{fighter, s}` | yes | |

`BoutResult.method` (existing) is extended to the `WinCondition` union plus `'no_contest' | 'draw_unanimous' |
'draw_majority' | 'draw_split' | 'technical_draw' | 'all_opponents_stopped' | 'street_*'`.

---

## 3. Behaviour by skill tier

Officials have no tiers (they have strictness/experience presets, §2.3.12 and §2.4.3). Fighter tier changes what the
officials *see*:

| Tier | Fouls (`tierMult`) | Intelligent defence when hurt | Submissions | Rules knowledge | Visible consequence |
|---|---|---|---|---|---|
| T0 | 3.0 [E]: reflexive fence grabs, fingers out, turns away (back-of-head exposure), hits after the horn | static cover / turns away → `intelligentDefence=false` fast → early TKO; in boxing fails the gait test more often | does not recognise danger; taps late or not at all → higher LOC share (judo cadets 18.9 % vs seniors 4.3 % as the analogue [S: SUBPHYS §1]) and refused-tap injuries | holds in boxing, grabs the leg and carries in KB/MT | many warnings, quick stoppages, occasional DQ |
| T1 | 2.0 [E] | covers up on the cage (INT D-1 "worst option") | taps to pain promptly, late to chokes | timidity when hurt | frequent stand-ups (little ground work) |
| T2 | 1.4 [E] | mixes cover and clinch | normal | occasional accidental low blow / groin | baseline amateur outcome mix (FD #97) |
| T3 | 1.0 | clinches, shoots, circles (INT D-1) | normal; some refused taps under `heart` ≥ 80 [E] | — | baseline UFC calibration |
| T4 | 0.9 [E] | elite hurt-management; survives more stoppable moments (referee lets them work) | taps to joint locks promptly; may go out to chokes rather than tap (11 % LOC baseline [S: SUBPHYS §3]) | exploits timeouts (§07), grabs the fence "with substantial effect" more deliberately (intentional flag 0.2 [E]) | fewer stoppages per rocked event |
| T5 | 0.8 [E] | as T4 plus composure | as T4 | as T4 | — |

Judges do not know tiers, but tier-driven statistics shift the margin distribution: mismatches produce wider fight-level
differentials (`sd` in §2.4.3), so unanimous decisions rise and splits fall in mismatched bouts — consistent with FD #115
(favourites win 65–69 %).

---

## 4. Parameter registry

Becomes `src/engine/params/rules.ts`, `referee.ts`, `judging.ts`. Values are the **standard** preset; lenient/strict
in §2.3.12.

| id | value | unit | tag |
|---|---|---|---|
| `rules.mma.roundS` / `rules.mma.breakS` | 300 / 60 | s | [S: RULES §2.2] |
| `rules.mma.ncThreshold3` / `ncThreshold5` | 2 / 3 | rounds | [S: RULES §2.2] |
| `rules.boxing.roundS` / `breakS` / `ncThreshold` | 180 / 60 / 4 | s, s, rounds | [S: RULES §2.3] |
| `rules.kb.roundS` / `breakS` / `extraBreakS` | 180 / 60 / 90 | s | [S: RULES §2.4] |
| `rules.mt.roundS` / `breakS` / `stadiumBreakS` | 180 / 60 / 120 | s | [S: RULES §2.5; stadium unverified] |
| `rules.ibjjf.durationByBelt` | 300/360/420/480/600 | s | [S: RULES §2.6] |
| `rules.adcc.qualifierS` / `finalS` / `otS` | 600 (300 no-points) / 1200 (600) / 300–600 | s | [S: RULES §2.6] |
| `rules.judo.regulationS` / `osaekomiYuko` / `wazaAri` / `ippon` / `attackClockS` | 240 / 5 / 10 / 20 / 45 | s | [S: RULES §2.7] |
| `rules.grappling.stabiliseS` | 3 | s | [S: RULES §2.6] |
| `rules.ibjjf.stallingS` | 20 | s | [S: RULES §2.6] |
| `rules.mma.gloveOz` / `boxing.gloveOz` / `glory.gloveOz` | 4 / 8–10 / 8 (<65 kg) 10 | oz | [S: RULES §2.2 (known); E; RULES §2.4] |
| `rules.catchWeightGapLb` | 5 | lb | [S: RULES §2.2] |
| `rules.mt.catchKickStepLimit` | 2 | steps | [S: RULES §2.5; MTKB §9] |
| `rules.kb.threeKdRound` / `fourKdBout` / tournament | 3 / 4 / 2,3 | KDs | [S: RULES §2.4] |
| `rules.count.mandatory` / `ko` / `outOfRing` | 8 / 10 / 20 | s | [S: RULES §6.2] |
| `rules.foul.recoveryMaxS` / `rules.adcc.recoveryS` | 300 / 120 | s | [S: RULES §2.2, §2.6] |
| `rules.foul.deductionIntentional` | 2 | pts | [S: RULES §2.2] |
| `ref.strictnessScalar` | 0.5 | — | [S: DMG §5.1] |
| `ref.tkoUnansweredGround` | 4 | strikes | [D: §2.3.3] |
| `ref.tkoUnansweredStanding` | 6 | strikes | [D: §2.3.3] |
| `ref.tkoNoDefenceS` | 2.0 | s | [S: RULES §5] |
| `ref.tkoAbsorbed30` | 18 | strikes/30 s | [D: FD #48] |
| `ref.defenceQualityCeiling` | 0.30 | — | [E] |
| `ref.collapseGraceS` / `ref.legCollapseGraceS` | 6 / 5 | s | [S: DMG §5.1] / [E] |
| `ref.secondKdWindowS` | 10 | s | [S: DMG §5.1] |
| `ref.refReactionS` | 0.8 | s | [S: RULES §5] |
| `ref.travelSPerM` | 0.4 | s/m | [E] |
| `ref.pLagTail` / `ref.lagTailMeanS` | 0.30 / 1.5 | —, s | [E] |
| `ref.tapDetectS` (median, LogNormal σ 0.4) | 0.3 | s | [E] |
| `ref.locDetectS` | 1.0 | s | [E] |
| `ref.gaitPassBase` | 0.85 | prob | [E] |
| `ref.gaitSlopeLogit` | 3.0 | logit per 45 acute pts | [E] |
| `ref.standingEightUnanswered` | 3 | strikes | [E] |
| `ref.neutralCornerS` | 1.0 | s | [E] |
| `ref.slipRiseCommands` (MT) | 3 | commands | [E] |
| `ref.standupWarnS` / `ref.standupS` | 30 / 50 | s | [S: RULES §5] |
| `ref.positionMult.dominant` / `.guard` / `.turtle` / `.standingOver` / `.cageSeated` | 1.5 / 1.0 / 0.8 / 0.5 / 0.9 | × | [S: BJJ R2] / [E] |
| `ref.effortAttemptCooldownS` | 5 | s | [E] |
| `ref.clinchBreakS` / `ref.clinchBreakOpenMult` | 25 / 0.8 | s, × | [S: RULES §5] / [E] |
| `ref.kbClinchMaxS` | 5 | s | [S: RULES §2.4] |
| `ref.boxingBreakS` | 2.0 | s | [E] |
| `ref.mtClinchInactiveS` | 6 | s | [S: RULES §3.3 (assumption 5–8)] |
| `ref.boxingHoldingWarnings` | 2 | warnings | [S: RULES §5] |
| `ref.timidityWarnS` | 40 | s | [S: RULES §5] |
| `ref.warningsBeforeDeduction` | 1 | warnings | [S: RULES §5] |
| `ref.pDeductAccidentalRepeat` | 0.6 | prob | [S: RULES §5] |
| `ref.dqAfterDeductions` | 3 | deductions | [S: RULES §5] |
| `ref.warningsBeforeIntentional` | 2 | warnings | [E] |
| `ref.groundedJudgement` | 0.85 | prob | [S: RULES §5] |
| `ref.pDetectContactFoul` / `.fenceGrab` / `.backOfHead` | 0.85 / 0.85 / 0.80 | prob | [E] |
| `ref.pProtestTimeout` | 0.05 | prob | [E] |
| `ref.hornGraceS` | 0.3 | s | [E] |
| `ref.cutDoctorCall` | 0.60 | 0–1 | [S: RULES §5] |
| `ref.pDoctorStopOrbit` / `.pDoctorStopVision` / `.pDoctorStopOther` | 0.80 / 0.70 / 0.05 | prob | [S: RULES §5] / [E] |
| `ref.doctorExamS` | 20–60 | s | [E] |
| `ref.doctorLeniencyRange` | ±0.15 | × | [S: DMG §5.2] |
| `ref.doctorVisionStop` | 0.4 | vision | [S: DMG §5.2] |
| `ref.cornerCheckFraction` | 0.75 | of break | [E] |
| `ref.cornerTowelBase` / `.protectivenessSlope` / `.titlePenalty` | 0.5 / 2.0 / 1.0 | prob, logit, logit | [E] |
| `ref.inspectorDelayS` | 5–15 | s | [E] |
| `ref.mtOutmatchedRatio` | 4 | ratio | [S: RULES §5] |
| `ref.bellReadyConsciousness` | 0.5 | — | [E] |
| `ref.judoMateNoProgressS` | 5–10 | s | [S: JUDO §9] |
| `foul.pEyePokeStraight` / `.pEyePokeLongGuardPerS` | 0.0018 / 0.004 | prob | [D] / [S: INT §2.4] |
| `foul.pGroinFrontKickKnee` / `.pGroinRoundKick` | 0.006 / 0.003 | prob | [S: RULES §3.4] |
| `foul.pBackOfHeadTurn` / `.pBackOfHeadTurtle` | 0.015 / 0.03 | prob | [S: RULES §3.4] |
| `foul.pGroundedKnee` / `.pGroundedKick` | 0.02 / 0.02 | prob | [S: RULES §3.4] |
| `foul.pFenceGrabTdd` / `.pFenceGrabClinch` | 0.08 / 0.03 | prob | [S: RULES §3.4] |
| `foul.pFingerInCut` / `.pSmallJoint` / `.pSpike` / `.pAfterBell` | 0.002 / 0.005 / 0.01 / 0.03 | prob | [S: RULES §3.4] |
| `foul.pHeadClashClinch` | 0.004 | prob | [E] |
| `foul.pBoxingHolding` / `.pLowBlow` / `.pRabbit` | 0.15 / 0.004 / 0.01 | prob | [E] / [D] / [E] |
| `foul.pJudoLegGrabLow` / `.High` | 0.05 / 0.01 | prob | [E] |
| `foul.tierMult` | 3.0 / 2.0 / 1.4 / 1.0 / 0.9 / 0.8 | × T0..T5 | [E] |
| `foul.rockedFatigueMult` / `.dirtyMult` | 1.5 / 2.0 | × | [E] |
| `foul.intentionalFenceT4` | 0.2 | prob | [E] |
| `judge.w.kd` | 1.00 | logit | [S: LIT_B §3.5] |
| `judge.w.rocked` / `.bodyHurt` / `.cut` | 0.45 / 0.30 / 0.25 | logit | [S: LIT_B §3.7 range] / [E] |
| `judge.w.structuralHead` | 0.010 | logit/pt | [E] |
| `judge.w.subLocked` / `.subEarly` | 0.40 / 0.15 | logit | [S: LIT_B §3.5] / [E] |
| `judge.w.reversal` / `.td` / `.tdMissed` | 0.26 / 0.21 / −0.08 | logit | [S: LIT_B §3.5] |
| `judge.w.sigHead` / `.sigBody` / `.sigLeg` / `.nonSig` | 0.09 / 0.06 / 0.055 / 0.013 | logit | [S: LIT_B §3.5] |
| `judge.w.pass` / `.dominantPosition` | 0.10 / 0.10 | logit | [E] |
| `judge.w.controlOffenceS` / `.controlPassiveS` | 0.0038 / 0.0015 | logit/s | [S: LIT_B §3.5] / [E] |
| `judge.w.oppDefensiveFraction` | 0.50 | logit | [E] |
| `judge.evenThreshold` / `.planB` / `.planC` | 0.15 / 0.10 / 0.05 | logit | [E] |
| `judge.noiseScale` (MMA) / `.boxing` / `.regional` / `.elite` | 0.32 / 0.40 / 0.45 / 0.30 | logistic scale | [D: MC] / [E] / [E] / [E] |
| `judge.noiseToMarginSdRatio` | 0.22 | — | [D: 0.32/1.44] |
| `judge.styleSigma` / `.regional` | 0.15 / 0.25 | — | [E] |
| `judge.tenEight` / `.propensitySigma` / `.tenEightKd` / `.tenSeven` | 2.6 / 0.25 / 1.2 / 4.0 | logit | [D: MC] / [D: MC] / [E] / [E] |
| `judge.tenEightDamage` / `.tenEightDom` / `.loserOffenceRatio` | 2.0 / 0.6 / 0.25 | logit, logit, × | [E] |
| `judge.T10` / `.p1010` / `.p1010Boxing` | 0.05 / 0.5 / 0.3 | logit, prob | [D: MC] / [E] |
| `judge.prevRoundBias` / `.prevRoundCloseOnly` | 0.15 / 1.0 | logit | [D: LIT_B §3.6] / [E] |
| `judge.reputationPer10Ranks` / `.reputationCap` / `.oddsBias` | 0.137 / 0.40 / 0.10 | logit | [D: LIT_B §3.5] / [E] / [E] |
| `judge.homeBias.mma` / `.boxing` | 0.145 / 0.18 | logit | [D: LIT_B §3.5] / [D: MC vs LIT_B §3.9] |
| `judge.leadBias` | 0.15 | logit | [E] |
| `judge.legacy.controlMult` / `.damageMult` / `.tenEightMult` / `.p1010Mult` | 1.5 / 0.8 / 1.3 / 3 | × | [E] |
| `judge.wholeFight.nearFinishBonus` | 1.0 | logit | [E] |
| `judge.boxing.w.power` / `.jab` / `.body` / `.hurt` / `.aggr` / `.general` / `.defence` | 0.10 / 0.05 / 0.08 / 0.45 / 0.30 / 0.20 / 0.15 | logit | [E, ratios RULES §4.2] |
| `judge.boxing.decisiveMargin` / `.lastTenSecondsWeight` | 2.6 / 0.7 | logit, × | [E] |
| `judge.mt.damageT1` | 0.5 | logit | [E] |
| `judge.mt.technique.*` | 1.0/1.0/0.9/0.6/0.5/0.8/0.4 | logit | [S: RULES §4.4 (assumption)] |
| `judge.mt.stadiumRoundWeights` | 0.5/0.75/1.25/1.25/0.75 | × | [S: RULES §4.4 (unverified)] |
| `judge.mt.stumble` / `.catchAndDump` | −0.20 / +0.30 | logit | [E] |
| `judge.glory.rocked` / `.spectacularMult` / `.tenEightImpact` | 0.60 / 1.3 / 0.6 | logit, ×, logit | [E] |
| `street.incapStandS` / `.fleeMobilityRatio` / `.fleeSuccess` / `.surrenderStopP` | 10 / 0.9 / 0.7 / 0.8 | s, ×, prob, prob | [E] |
| `street.sepHazardPerS` / `.sepBystanderMult` / `.sepStartS` / `.weaponHazardPerS` / `.arrivalHazardPerS` | 0.010 / 0.3 / 10 / 0.001 / 0.005 | 1/s | [E; median ≈ 35 s D] |
| `flow.cornerEnterS` / `.doctorStartS` / `.cornerCueWindowS` | 5 / 5 / 5–45 | s | [E] |
| `flow.gauntletBreak` / `.tagRecoveryMult` | 0 / 1.5 | s, × | [E] |

---

## 5. Calibration hooks

This section is responsible for the following targets (headless batch ≥ 2 000 bouts, `mma.unified.3r`, T4 vs T4 mixed
divisions unless stated). Levers are the parameters this section owns; other sections own the upstream rates.

| Target | Value ± tol | Source | Primary levers here | Upstream owner |
|---|---|---|---|---|
| Decision-type split | U 77 / S 20 / M 2.5 % ± 3 pp | [S: FD #105] | `judge.noiseScale` (via `noiseToMarginSdRatio`), `judge.tenEight` | margin spread (§02/§03/§05) |
| Split-or-majority share of all fights | 9.5–11 % ± 2 pp | [S: FD #106] | same + decision rate | finish rates (§05) |
| Draws | 0.7 % of fights (1.5 % of decisions) ± 0.3 pp | [S: FD #107] | `judge.T10`, `judge.p1010`, `judge.propensitySigma` | — |
| Judge round agreement | 77 % ± 4 pp | [S: FD #114] | `judge.noiseScale` | — |
| 10-8 share of judge-rounds | ≈ 8 % (2016–19) | [S: INT §7.4] | `judge.tenEight`, `judge.tenEightKd`, `judge.tenEightDamage` | KD rate (FD #30–#33, §05) |
| Sig-strike leader wins the decision | 78 % ± 4 pp | [S: FD #85] | strike weights vs control weights | — |
| Control leader wins the decision | 68 % ± 4 pp; 5+ min gap → 87 % | [S: FD #84] | `judge.w.controlOffenceS`, `.controlPassiveS` | — |
| Striker with fewer TDs/control wins | 60–63 % ± 5 pp | [S: FD #87] | as above | — |
| NC + DQ | 1.3 % of fights ± 0.5 pp | [S: FD #108] | `foul.p*`, `ref.pDetect*`, `ref.dqAfterDeductions`, NC threshold | injury severity of fouls (§05) |
| Doctor stoppages | 0.8–1.1 % of fights ± 0.4 pp; ≈ 2.4 % of strike stoppages | [S: FD #109] | `ref.cutDoctorCall`, `ref.pDoctorStop*` | cut rates (§05 §2.5) |
| Referee lag after KO blow | 3.5 s ± 1.5 s; 2.6 ± 1 extra head strikes | [S: FD #49, #110] | `ref.refReactionS`, `ref.travelSPerM`, `ref.pLagTail`, `ref.lagTailMeanS` | KO recognition timing (§05) |
| Loser head strikes absorbed before TKO (median) | 6 ± 2 | [S: FD #46] | `ref.tkoUnansweredGround/Standing`, `ref.tkoAbsorbed30` | §05 rocked durations |
| Strikes in final 30 s before TKO | 18.5 ± 4 | [S: FD #48] | `ref.tkoAbsorbed30` | attacker finishing behaviour (§07) |
| KD → same-round KO/TKO by scorer | 57 % ± 5 pp | [S: FD #40] | stoppage thresholds | §05 follow-up damage, §07 |
| KO : TKO | ≈ 1 : 2 ± 5 pp | [S: FD #90] | `ref.tko*` (TKO share) | §05 KO probability |
| Corner stoppages | 1–2 % of bouts | [S: DMG §5.3 (estimate)] | `ref.cornerTowel*` | — |
| Eye pokes / low blows / fence-grab calls per fight | 0.15 / 0.12 / 0.2 | [S: RULES §6.3 (assumptions)] | `foul.p*` | action counts (§02/§03) |
| Point deductions per fight | 0.02–0.03 | [S: RULES §6.3 (assumption)] | `ref.warningsBeforeDeduction`, `ref.pDeductAccidentalRepeat` | — |
| MMA stand-up after stalled ground; fence-clinch break | 30–60 s; 15–30 s | [S: RULES §6.3 (assumptions)] | `ref.standupS`, `ref.clinchBreakS` | activity rates (§03/§07) |
| Home fighter (crowd) round-win bonus | +3.6 pp | [S: LIT_B §3.5] | `judge.homeBias.mma` | — |
| Boxing home points-decision rate (equal boxers, 12 R) | 0.74 | [S: LIT_B §3.9] | `judge.homeBias.boxing` | — |
| Boxing non-unanimous 3-judge decisions | ≈ 30 % | [S: RULES §4.2 (inferred)] | `judge.noiseScale.boxing` | — |
| GLORY (T)KO rate | 32–35 % | [S: FD §2.6] | 3-KD rule, standing 8 thresholds | §05 |
| Judo regulation / golden-score share | 65 / 35 % | [S: FD §2.6] | shido triggers, mate timing | throw success (§03) |
| ADCC / IBJJF black-belt submission rate | 34–42 % | [S: FD §2.6] | stalling/passivity penalties (indirect) | §03 |
| LOC share of choke finishes | 11 % ± 4 pp | [S: FD #76; SUBPHYS §3] | `ref.locDetectS` (indirect) | tap decision (§04/§07) |
| Street: median time to first ending condition | 20–40 s | [S: RULES §2.8 (assumption)] | `street.sep*`, `street.flee*` | §05/§07 |

Procedure: (1) freeze §02/§03/§05 rates; (2) measure the engine's per-round margin SD in decision fights and set
`judge.noiseScale = 0.22 × SD` [D]; (3) sweep `judge.tenEight` until 10-8 share ≈ 8 %; (4) check FD #105/#107/#114;
(5) sweep `ref.tko*` against FD #46/#48/#90; (6) sweep foul probabilities against RULES §6.3 and FD #108/#109.

---

## 6. Assumptions and open questions

Every `[E]` above, plus tradeoffs. Default is realism; playability alternatives are listed where they exist.

1. `mma.amateur` ruleset (3 × 180 s, 6–7 oz gloves, shin guards, no elbows/knees to the head, ground punches to head only,
   no heel hooks / twisting knee locks) — IMMAF-style construct, not in research. **Verify against IMMAF/state amateur rules.**
2. Pro boxing 17-class ladder, GLORY, IJF, IBJJF and ADCC weight-class lists — standard public knowledge, not in research;
   Muay Thai intermediate cut-offs unknown.
3. `kickboxing.k1` details (no standing 8; extra round on draw) are RULES **[UNVERIFIED]**; sub-only slam ban and ADCC-style
   legal list for `grappling.subonly` are design choices.
4. Reaction-lag model: `travelSPerM` 0.4 s/m, `pLagTail` 0.30, `lagTailMeanS` 1.5 s (0.35/2.0 lenient, 0.20/1.0 strict);
   the split of Hutchison's 3.5 s between referee lag and §05's KO-recognition timing is unmeasured.
5. Ground unanswered-strike count 6/4/3 (lenient/standard/strict) is a compromise between RULES §5 (8/5/3) and DMG §5.1
   (3–5); `defenceQualityCeiling` 0.30; `legCollapseGraceS` 5 s; `collapseGraceS` spread 8/6/4.
6. Gait test: base pass 0.85, slope 3.0 logit per 45 acute points, strictness shifts −0.85/0/+1.4; whether a fighter beats
   the count is decided by §05 with an `acuteHead ≥ 80` cannot-rise rule; both are guesses — no count-out-vs-8-count data
   was found.
7. Standing-eight trigger (3 unanswered while rocked), neutral-corner delay 1.0 s, MT slip-rise commands 3.
8. Tap detection 0.3 s median (σ 0.4 LogNormal), LOC detection 1.0 s; combined with §03 release time to land in the 2.4 s
   asymptomatic band. No direct referee-latency measurement exists for submissions.
9. Foul model: eye-poke 0.0018 per straight (derived from an assumed 0.15 pokes/fight), head-clash 0.004 per clinch entry,
   boxing holding 0.15 per tie-up, low blow 0.004 per body punch, rabbit punch 0.01, judo leg-grab 0.05/0.01, after-bell window
   0.3 s, `tierMult` 3.0…0.8, rocked/fatigue ×1.5, `dirty` ×2.0, T4 intentional fence-grab flag 0.2, detection 0.85/0.85/0.80,
   protest timeout 0.05, `warningsBeforeIntentional` 2. Fight-level foul rates themselves are RULES §6.3 assumptions.
10. Stand-up position multipliers other than the dominant ×1.5 (turtle 0.8, standing-over 0.5, cage-seated 0.9), attempt
    cooldown 5 s, open-clinch break multiplier 0.8, boxing tie-up break 2.0 s, MT inactive clinch 6 s.
11. Doctor: exam duration 20–60 s, `pDoctorStopOther` 0.05, "nearly over" = ≤ 30 s left; the FD (0.8–1.1 %) vs DMG (2–4 %)
    conflict on doctor-stoppage share is resolved in favour of FD.
12. Corner stoppage: base 0.5, protectiveness slope 2.0 logit, title penalty 1.0 logit, check at 75 % of the break,
    inspector delay 5–15 s; 1–2 % share is itself a DMG estimate.
13. Bell readiness: `consciousness < 0.5` or cannot stand → `tko_bell`.
14. Judge model: true-margin distribution for the Monte Carlo (fight-level SD 1.2, round SD 0.8) is assumed; the tuned
    `noiseScale` is therefore expressed as a ratio to the engine's measured margin SD. Weights for rocked/body-hurt/cut
    (0.45/0.30/0.25), cumulative damage 0.010/pt, early sub 0.15, pass/dominant position 0.10, passive control 0.0015/s,
    opponent-defensive 0.50, Plan B/C 0.10/0.05, even threshold 0.15, 10-8 damage/domination thresholds 2.0/0.6/0.25,
    `tenEightKd` 1.2, `tenSeven` 4.0, `styleSigma` 0.15/0.25, `leadBias` 0.15, `oddsBias` 0.10, reputation cap 0.40,
    regional/elite noise 0.45/0.30, legacy-culture multipliers, whole-fight near-finish bonus 1.0.
15. Boxing judge weights (0.10/0.05/0.08/0.45/0.30/0.20/0.15), noise 0.40, decisive margin 2.6, last-10-s weight 0.7,
    `p1010Boxing` 0.3. Muay Thai `damageT1` 0.5, stumble −0.20, catch-and-dump +0.30, Plan-B/C sizes; the stadium round
    weights and 2-min breaks are RULES **[UNVERIFIED]** culture. GLORY rocked weight 0.60, spectacular ×1.3, impact 10-8
    threshold 0.6, K-1 single extra round.
16. Grappling referee decision uses the MMA `dom()` with no biases; IBJJF belt matrix must be verified against the IBJJF
    poster before encoding [S: RULES §7 item 4]; judo mate after 5–10 s without progress; the 45 s vs 30 s attack-clock
    discrepancy between RULES §2.7 and JUDO §9 is resolved to 45 s (IJF SOR text).
17. Street: incapacitation after 10 s unable to stand, flee mobility ratio 0.9 and success 0.7, surrender stop probability
    0.8, separation hazard 0.010/s (+0.3 per bystander) after 10 s, weapon 0.001/s, arrival 0.005/s. All criminology-anchored
    only qualitatively [S: RULES §2.8; FD §6].
18. Flow: corner enters at 5 s, doctor at 5 s, cue window 5–45 s, gauntlet has no break, tag recovery ×1.5, horn grace 0.3 s.
19. Multi-opponent with a referee (`replacement` modes) is a game construct; only street is research-backed for 1vN.

**Playability-vs-realism tradeoffs.** (a) Hidden scorecards are realistic; `openScoring: 'after_each_round'` is offered
because it makes §07's score awareness legible to the viewer — it also changes fighter behaviour (INT §7.4). (b) The
reaction-lag tail produces realistic "late stoppages" that viewers dislike; `pLagTail = 0` is the arcade option.
(c) Foul timeouts up to 5 min are realistic but slow; a `foulTimeoutScale` (default 1.0) may compress them for
presentation without changing physiology outcomes. (d) Draws and split decisions are kept at real rates; tournaments that
need a winner should use `rs.rounds.extra` or `whole_fight` culture rather than suppressing draws.

**Open questions.** Effective date of the 2026 ABC stand-up paragraph (Nov 2027 implementation requested) [S: RULES §7 item 2];
whether NSAC/UFC adopted the 2024 grounded definition on schedule [S: RULES §2.2]; a per-round 10-8 / 30-27 frequency dataset
(FD lists it as a gap) to replace the INT §7.4 8 % anchor; a direct split-decision aggregate (RULES infers 17–20 % from one
judge's dissent count, FD gives 20.4 %).
