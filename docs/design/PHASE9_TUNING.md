# PHASE 9 TUNING — calibration pass against FIGHT_DATA

What the calibration pass changed, why, and what it could not reach. The
companion report with every number is `docs/CALIBRATION.md` (regenerated from
the final run); this file is the change log and the reasoning.

Engine: **4.3.0 → 5.0.0** (`SIM_ENGINE_VERSION`, `src/sim/record/recorder.ts`).
The major bump is deliberate: the event schema gained fields (`detail.a` on
grapple events, `detail.short` on strikes), a `reversal` event now means a
reversal, the referee applies stand-ups, and every bout ever recorded plays out
differently.

Method, in order (09 §6.6 / the task brief): fix the bugs that produced absurd
numbers first, each with a regression pin (`tests/phase9.bugs.test.ts`); then
tune by structural impact — pace and output, accuracy by position and target,
the damage and knockdown model, grappling, judging, tiers. Parameters tagged
`[E]`/`[D]` and flagged `free` were preferred; where a sourced value or the
model's structure had to move, the reason is written next to it (code comment
and provenance tag `[E: tuned Phase 9, ...]`) and below.

**Registry caveat found on the way.** Only chapter 05 (damage) and parts of
01/03/06 read `src/sim/params` at run time. Chapters 02 (striking), 04
(submissions) and 07 (AI) keep their numbers as typed tables in their own
modules (436 striking, 203 submission and ~210 AI registry entries are
mirrors no code reads), and chapter 06 reads registry *defaults* only
(`rules/params.ts`). So `--params` overrides move damage parameters and
nothing else; every AI, striking and submission change below is a code
change. Wiring the mirrors is a follow-up, not done here.

---

## 1. Bugs fixed

Each has a pin in `tests/phase9.bugs.test.ts` unless noted (QA ones are pinned
in `tests/qa.edgecases.test.ts`).

| # | Symptom (baseline) | Root cause | Fix |
|---|---|---|---|
| B1 | Reversals 34.35 a fight (real 0.26) | `stats.ts` counted every `reversal` event, and `bind.ts` filed **every sweep-table attempt** (failed ones, and guard entries such as X-guard or dogfight entries) as `reversal`. | One definition, `grappling/takedowns.ts#isReversal`: a successful bottom-initiated edge, mat to mat, that leaves the actor in slot `a` on top. The sim now emits `reversal` only for those (else `positionChange`). Stats, judges and the summariser share it. |
| B2 | Loser control in decisions 3.5 min (real 1.9); control share 56 % | Stats rebuilt pairs as `setPair(actor, target)` — the actor always slot `a` — so every failed escape or sweep by the bottom man credited *him* with control. Edges can hand slot `a` to either fighter. | Grapple events carry `detail.a` (slot `a` after the transition); stats and the batch summariser read it. |
| B3 | Takedowns landed > attempted | (a) `standUp`-kind events (every escape and get-up, *including failed and contested ones*) cleared the pair, so control stopped and the next event re-created the pair and re-credited a takedown; (b) any arrival on the mat credited a landed takedown to someone (guard pulls, knockdown follow-ups); (c) `engagementJoin` twinned the opening edge and was counted as a second attempt. | Stats act on `detail.to` for every grapple kind (contested attempts change nothing); a landing is credited only to a fighter with an open attempt, on top, once per attempt (`TD_CHAIN_SECONDS`); `engagementJoin` is skipped for attempts. |
| B4 | Takedown accuracy denominators wrong both ways | The attempt definition missed ankle picks, knee taps, mat returns, go-behinds and snap-downs to the mat, and counted clinch entries in the judges. | `isTakedownAttempt(edge, fromNode)`: the first edge of a takedown chain started on the feet or in the clinch; guard pulls, kick catches and clinch entries excluded. Judges and stats share it. |
| B5 | Round breaks counted as fight time and control | Stats integrated every tick and had no `roundEnd` handling; a pair that ended a round in mount kept "controlling" through the minute's break. | `roundEnd` clears pairs and pauses integration until `roundStart`. |
| B6 | Referee stand-ups and clinch breaks never happened | `refereeBreak` events were emitted and never applied (471 "stand them up" calls in 10 bouts, 432 still engaged 5 ticks later). | `bind.ts#refereeSeparate`: dissolves the engagement, cancels in-flight contacts and holds, restarts the pair apart, emits `disengage` (no `edge`: it is not a fighter action). |
| B7 | **Zero submission finishes** in 1,187 bouts | `canAct` froze the attacker once a hold reached `secure` (stage 2), and nothing scheduled the following windows, so every submission stalled at stage 2 until something else moved the pair. | The attacker may act while holding a stage-2+ submission, and `commitDecision` turns his choice into the next window of that hold. |
| B8 | Invariant I5 violations (2,313 ticks in one 1v5 cell, 452,437 in rules×arenas) | `f.sub` outlived the position it came from; and I5 read the node's short generic threat list, which the catalogue's variant ids never matched. | `syncEngagement` drops a hold the node no longer offers; `nodeAllowsSubmission` also accepts family prefixes and the catalogue's own offers. |
| B9 | Submissions only from the back/turtle/mount, offered to both fighters | The AI looked the catalogue up by chapter-04 position ids — side control, closed and half guard (whose §04 ids differ from §03's) offered nothing — and ignored the entry roles, so the man *under* back control could "attack" a rear-naked choke. | `grappling/subOffers.ts`: every catalogue entry resolved through `resolvePositionAlias` onto a §03 node and slot by its role; the AI, the binder and I5 read it. |
| B10 | ~300 phantom "beaten to" attempts a bout; fatigue 0.7-0.8 by R2 | When the opponent's edge was already in motion, the blocked fighter was billed a takedown attempt's energy and a stuffed event **every tick**. | Only a simultaneous claim is a lost race; a fighter blocked by an edge already in motion simply does nothing. |
| B11 | Escaping to the knees handed the escaper the top of the turtle | Three §2.3 rows (underhook turn, north-south escape, kesa escape to turtle) had "(bottom)" transcribed as a slot swap. | Swaps removed; the `swap` semantics documented on `EdgeDestination`. |
| B12 | Shots chosen at mid range silently vanished | The AI enumerated edges from `standingNodeFor` (02's reach bands); the world placed free fighters with fixed 1.3/2.0 m cut-offs, and `commitGrapple` drops an edge whose `from` does not list the fighter's node. | `freeNodeFor` uses the same band ladder. |
| B13 | Both fighters "on top" in side control, half guard, mount, back and turtle | `isTopRole` read the node *id* ("no 'bottom' or 'guard' in the name"). | Reads the fighter's slot role in his engagement. |
| B14 | Every grappling edge cost a takedown attempt (10 PCr, 0.8 mmol/L) | `commitGrapple` charged `takedownAttempt` for pummels, grip exchanges, posture-ups and escapes. | `edgeEnergy`: shots/throws/finishes remain takedown attempts; the rest pay the §2.5.1 class that describes them. |
| B15 | No ground-and-pound at all | The stand-up enumerator returned nothing on the ground; the "groundStrike" family was the posture/settle edges; the §03 §5.1 GnP table (rates, damage fractions) was data only. | Ground strikes are real candidates (`groundStrikeCandidates`, the §5.1.1 ids now in the striking catalogue as `GROUND_TECHNIQUES`), the per-node damage fraction is applied, posture/settle edges are `ride`. |
| B16 | Two-thirds of bouts ended "KO" (real 11.5 %) | The referee's KO check fired on 05 `limpness >= 1`, which a *hurt* knockdown sets — every hurt knockdown was an instant KO stoppage. | KO = the fighter is out (or limpness 2 → a TKO "limp under strikes"); a hurt fighter is stopped on a lowered unanswered-strike count (`HURT_TKO_UNANSWERED`). |
| B17 | One arm-punch on the mat stopped fights ("covering without positional change") | The covering rule fired on one unanswered strike or any blocked strike; the *top* man counted as grounded; a bottom man in the middle of an escape counted as not defending; a knockdown did not reset the defence clock. | Damaging strikes only (flush/solid, ≥ 300 N delivered: `UNANSWERED_MIN_FORCE_N`), ≥ 2 of them (`COVERING_MIN_UNANSWERED`) or 3 s of static cover; grounded means down or underneath; an escape in motion and a guard/turtle held by an unhurt, unspent fighter are defence; a knockdown resets the clock. |
| B18 | A laceration kept the bout in a doctor pause ("separating") to the bell; fighters fought through every pause | The in-round cut trigger stayed true, so a new exam started the tick the last ended; nothing stopped the fighters while the referee counted or the doctor looked. | A cut is re-examined only if it worsens; `canAct` is false while the referee is paused. |
| B19 | Checked kicks: live tallies and computed stats disagreed | 02 `statLanded` counts a checked kick; `stats.ts` did not. | `isStatLanded` shared by stats, summariser and judges. |
| B20 | A knockdown blow could be classified at distance | Stats cleared the pair on the `knockdown` event, which is logged before the strike that caused it. | Clear at end of tick. |
| B21 | Sig/total landed 0.97 (real 0.72) | Significance counted everything but jabs (review item 2). | One `isSignificantStrike` (stats, summariser, sim counters): short clinch/ground strikes and punches from the back are total strikes only. |
| B22 | A submission stayed "hold" forever | 04 §2.4.4 dMax was not applied. | A stage stalled past `dMaxFactor x dMean` is let go. |
| B23 | Judges scored clinch entries and guard pulls as takedowns, and non-significant strikes as significant | Ledger folded every `takedown`-kind event and every strike. | Shared takedown/reversal definitions; short strikes to `nonSigLanded`. |
| B24 | Knockdown-to-finish conversion ~50 % (real 65 %); no fighter ever "smelled the finish" | The loop built `ObservedFighter.visiblyHurt` from `damage.has('rocked')` / `has('stunned')`; 05's state ids are `state.rocked` / `state.stunned`, so no fighter was ever visibly hurt. The whole 07 §2.6.5 finish layer (finish emergency, finisher weights, the pace governor's finish multiplier) was dead code. | Correct ids (`core/loop.ts`). A knockdown is also always read as hurt (the per-tick cue roll is for subtle signs). |
| B25 | (latent behind B24) hundreds of "smells the finish" a bout | A measured finisher who gave up re-read the same hurt episode on the next tick and restarted. | `FINISH_RETRY_MS` (10 s) before a stopped finisher re-reads the cue. |
| B26 | 19 of 20 flash knockdowns went unpunished | `tech.knockdown_follow` leaves from `pos.ground_knockdown`, a node nothing ever put a fighter in; the attacker could only throw standing punches at a man on the floor. | `freeNodeFor` places a free fighter within `KNOCKDOWN_FOLLOW_RANGE_M` of a downed opponent at `pos.ground_knockdown`; the AI follows with `KNOCKDOWN_FOLLOW_P` per decision. |
| B27 | `tech.sweep_on_strike` alone made 0.5 reversals a fight (real total 0.26), from side control and mount too | Its §2.3 requirement ("with a strike in flight") was text only. | Offered only while the top man has a strike in the air (`ON_THE_STRIKE_EDGES`, `EnumerationContext.oppStriking`). |
| B28 | I4 (engaged pair too far apart) on hundreds of ticks a bout in 1v2 / 2v2 / 1v5 | Body separation pushed both bodies of any overlapping pair, so a third fighter walking into a clinch shoved one half of it out of range. | `loop.ts#separate`: a fighter engaged with someone else is anchored; the free one gives way. |
| B29 | I5 (a hold on nobody) after a stoppage or a stand-up | A fighter stopped by the referee or the street rules, and both fighters of a pair dissolved by a stand-up edge, kept `f.sub`. | Cleared on each path. |
| B30 | I2/I3 for one or two ticks after an engagement ended | The former partner of a knocked-down or stopped fighter kept reporting the old node until his next upkeep; in multi-fighter bouts a free-standing edge (a level change) aimed at a fighter tied up with someone else overwrote that fighter's node. | `leaveAndSync` syncs the former partner on the same tick; free-standing edges leave third-party engagements alone. |
| B31 | I3 when two fighters followed the same knockdown | The second follower's join silently stripped the first pair. | An edge started on a free opponent who has since been tied up by someone else is stuffed ("target engaged"). |
| QA-1 | Multi-fighter bouts: referee dead after the first stoppage | Referee latched `ended`; bind re-stopped the same fighter every tick. | `Referee.resumeAfterStoppage`. |
| QA-2 | Street/crowd bouts never ended | `streetTick` never called. | `streetPhase` in the referee phase. |
| QA-3 | Capped crowd bouts awarded by headcount | — | `separated`, no winner. |
| QA-4 | Teams/ffa at the bell decided by headcount × 1000 + sig strikes | — | 09 §4.3 team scoring from summed effective scores (`effectiveScore`). |
| QA-5 | Strikes thrown (and fouled) under grappling/judo rules | Rulesets mapped to the MMA striking family. | `strikingAllowed(ruleset)` gates strikes and feints. |
| QA-6 | Fouls never reached the referee | `RefTickInput.fouls` never filled. | Illegal strikes become `FoulOccurrence`s for P6 (`announced`, no duplicate event). |
| QA-9/10 | A submission ended a team bout; mixed winner conventions | — | `submissionStops`: marks the victim out, ends the bout only when his side is empty; team wins carry `winner: 'none'`. |
| QA-11 | Sub-only 1v1 without a finish ended "timeLimit" | — | `decideSubOnly` → `draw`. |
| C2 | `localeCompare` tie-breaks (audit) | ICU-dependent ordering. | Code-unit comparison. |

Metric/summariser fixes (scripts, not sim): the finishing-strike rows 27-29 and
44-49 use strike stoppages only (`isStrikeKoTko`, doctor/corner excluded);
`readResults` de-duplicates rows by `(cell, i)` so a manifest-less `--resume`
cannot double-count.

---

## 2. Structural changes (model, not bugs)

| Change | Where | Why (metric) |
|---|---|---|
| **Family-first choice**: each candidate's softmax weight is divided by the number of candidates in its family | `ai/utility.ts#familyShares` | BASE_PRIOR is a family prior; with one candidate per technique the jab (9 variants) and the back (9 submissions) got 9× their family weight. Rows 20-21, 69. |
| **Pace governor**: the plan's pace target becomes a per-tick strike hazard with proportional feedback on the fighter's own thrown rate, applied as a cap on the strike share of the softmax; exchange clustering (hazard x5 inside an exchange, x0.3 outside); per-phase multipliers; tier multiplier | `ai/policy.ts#strikeCap`, `PACE_GOVERNOR`, `EXCHANGE`, `tierPaceMult` | C-9 (PHASE4_FINDINGS): the score brake could not hold a rate (utility has no absolute scale; the brake was diluted by compensation; the landed-rate window was empty at every bell). Rows 1-2, 5, 127. |
| **Takedown governor**: the plan's per-round `tdAttemptTarget` (unread before) as an exact hazard with feedback | `takedownCap`, `TD_GOVERNOR` | Rows 55-56. |
| **Submission hazard** by position and skill, opportunity from the defender's submission defence | `submissionCap`, `SUB_HAZARD_PER_MIN`, `SUB_OPPORTUNITY_SLOPE` | Rows 69-71, 93, T7. |
| **Grappling tempo**: positional-edge attempts per minute by role; exact (obligatory) for the man underneath | `grappleTempoCap`, `GRAPPLE_TEMPO_PER_MIN` | Energy (lactate 9 mmol/L mid-R1), control time, ground episode length. Rows 24, 77-80. |
| Clinch-entry and feint/level-change budgets | `CLINCH_ENTRY_PER_MIN`, `FEINT_PER_MIN` | Row 24; level changes ran at 10 a minute. |
| Shot chains: the shooter drives the finish; the defender's counters share the contact tempo; chain edges share the finish family | `policy.ts`, `actions.ts#familyForEdge` | Row 57: < 1 shot in 8 reached the mat. |
| **Short strikes** (non-significant): clinch/ground variants, faster, +1.4 logit, x0.3 force | `SHORT_STRIKE_MODEL`, `SHORT_STRIKE` | Rows 5-7. |
| Positional and target-region arrival terms | `POSITIONAL_ARRIVAL`, `TARGET_ARRIVAL` | Rows 15-19. |
| **Unfamiliarity**: the share of unseen strikes (05 kUnseen) decays with the strikes a fighter has faced from this opponent; scaled by the defender's tier | `bind.ts#unseenByUnfamiliarity`, `UNFAMILIAR` | Rows 38, 125 (knockdowns per landed power strike fall by round), T7. |
| Head-neck inertia term in the KO model | `ko.ts` kInertia, `ko.targetMassExp` | Row 37 (KD per 100 head sig flat across classes; was 10x HW/FLW). |
| Relative 10-8 damage test; 10-7 only for three knockdowns or overwhelming sustained dominance | `judges.ts#tenPointScore` | Rows 105-107 (10-8s on 45 % of judge-rounds, draws 3-5 %). |
| Female delivered-force multiplier (0.72) | `striking/resolve.ts` `FORCE.femaleMult`, `ForceContext.female` | Rows 35, 37 (women's KD per 100 head sig 1.0 vs 0.3; the model had no sex term beyond mass). Morris et al. 2020 measured male punch power ~2.6x female. |
| MMA takedown-chain logit (`grap.tdChainLogit` +0.65) on the shooter's attempt and finish edges | `grappling/resolve.ts` `GrappleWorld.extraLogit`, `bind.ts#tdChainEdge` | Row 57 (TD accuracy 24-26 % vs 38 %): the WRESTLING §9 base rates are wrestler-vs-wrestler. Unit-level resolvers are unchanged. |
| MMA get-up logit (`grap.getUpLogit` +1.0) on bottom edges from the mat that end standing or in the clinch | `bind.ts#getUpEdge` | Row 24 (ground time 29-33 % vs 24 %; a third of ground spells lasted to the bell). |
| Positional defence multiplier (blocks/parries x0.5 in the clinch, x0.7 on the ground) | `bind.ts` `POSITIONAL_DEFENCE` | Rows 16, 18-19: with only the arrival term, clinch/ground accuracy sat at ~60 % (72 %) — the losses were blocks, which arrival does not touch. |
| MMA submission defence term | `stages.ts` `mmaDefenceBonus` | Row 73. |

---

## 3. Parameter changes

Registry parameters (read at run time; provenance tags updated in place):

| Parameter | Old → new | Reason | Metric |
|---|---|---|---|
| `dmg.rawScale` | 50 → 35 | Head damage per landed strike ran ~40 % high once strikes landed at the real rate; acute pools filled in two minutes | 30-37, 50 |
| `dmg.head.thr.kdHurt` | 65 → 80 | Hurt knockdowns from accumulated jabs | 30-33, 38 |
| `dmg.head.thr.ko` | 90 → 95 | Same, for the KO threshold | 39, 90 |
| `dmg.head.kPriorSlope` | 0.006 → 0.0015 | Earlier damage multiplied later KD odds so steeply that R3 KD rates rose instead of falling | 38, 125 |
| `ko.kFatigue` | 0.25 → 0 | The striker's fatigue already lowers force (02 `fatigueForceMult`); a second target-side fatigue term made tired fighters glass | 38, 125 |
| `ko.alphaCal` | 1.0 → 1.3 | Rescale of the logistic after the head-mass inertia term | 36 |
| `ko.chinSlope` | 0.02 → 0.05 | Chin barely mattered (KO-loss by KD history flat) | 119 |
| `ko.kKO` | 0.20 → 0.05 | Most knockdowns were instant KOs (KO:TKO 3:1 vs 1:2) | 90 |
| `ko.targetMassExp` (new) | — → 0.5 | Head-neck inertia: KD rate per landed head strike was 10x at HW vs FLW | 34, 37 |
| `judge.tenEight` | 2.6 → 6.5 | Engine round margins are wider than the 06 Monte Carlo assumed; 10-8s were 20 %+ of judge-rounds and the offsetting 10-8s made draws | 105-107 |
| `judge.tenEightKd` | 1.2 → 3.2 | Same | 105-107 |
| `judge.tenEightDamage` | 2.0 → 5.5 (now a differential) | Same; "significant damage" is damage done to the other man | 105-107 |
| `judge.tenSeven` | 4.0 → 6.5 | 10-7s at 2.6 % of judge-rounds (real ~0.1 %) | 106 |
| `judge.noiseScale` | 0.32 → 0.26 | Split decisions 24 % of decisions (real 20 %) | 105 |
| `judge.p1010` | 0.5 → 0.15 | 10-10 rounds made 3.6 % of fights draws | 107 |
| `grap.tdChainLogit` (new) | — → 0.65 | See §2 | 56-57 |
| `grap.getUpLogit` (new) | — → 1.0 | See §2 | 24 |

Module constants (chapters 02, 04, 07 and the binder keep their numbers in
code; each has a Phase 9 comment at its definition):

| Constant | Old → new | Reason | Metric |
|---|---|---|---|
| `BASE_PRIOR` (07) jab / bodyHook / lowKick / leadLowKick / bodyKick / sweep | 1.50 / 0.50 / 0.65 / 0.55 / 0.42 / 0.55 → 3.40 / 1.60 / 3.00 / 2.20 / 1.30 / 0.30 | Target and technique mix: head 88 % of attempts (real 77), too few jabs for the KD-per-power-strike rate | 20-21, 26, 36 |
| `PACE_NOMINAL_ACCURACY` (new) | — → 0.45 | Landed-to-thrown conversion of the plan's pace target | 1-2 |
| `PACE_GOVERNOR` (new) | gain 1.4, n 2, boost 3, finish x5, clinch x0.75, ground top x1.1, ground bottom x0.4 | Pace by phase | 1-2, 23 |
| `EXCHANGE` (new) | window 1.5 s, in x5, out x0.3 | Strikes come in exchanges | 127 |
| `tierPaceMult` (new) | 0.55 + 0.11 x tier | Regional pace (T2 6-7, T3 7.5-8 sig att/min) | T7 |
| `TD_GOVERNOR` (new) | gain 2.6, boost 3, n 2, prior 60 s, floor 0.15/round | Takedown attempts | 55, 60 |
| `CLINCH_ENTRY_PER_MIN` (new) | 3.0 | Clinch time (9 % vs 15 %) | 24 |
| `GRAPPLE_TEMPO_PER_MIN` (new) | clinch 5, top 5, bottom 12 (exact) | Energy and ground-spell length | 24, 77 |
| `FEINT_PER_MIN` (new) | 2.5 | Level changes ran at 10 a minute | — |
| `SUB_HAZARD_PER_MIN` (new) | back 1.8, mount 0.75, turtle 0.5, side 0.25, closed guard bottom 0.45, ... | Submission attempts by position | 69-72 |
| `SUB_OPPORTUNITY_EXP` / `SUB_HUNT_MULT` (new) | 1.5 / 1.5 | Weak submission defence invites attempts | T7, 69 |
| `KNOCKDOWN_FOLLOW_P` / `KNOCKDOWN_FOLLOW_RANGE_M` (new) | 0.35 per decision / 2.4 m | B26 | 39-40 |
| `FINISH_RETRY_MS` (new) | 10 s | B25 | — |
| `SHORT_STRIKE_MODEL` (new) | +1.4 logit, x0.30 force, x0.70 time | Non-significant clinch/ground strikes | 5-7 |
| `POSITIONAL_ARRIVAL` (new) | clinch +1.6, ground top +1.6, ground bottom +0.3 logit | Accuracy by position | 16 |
| `POSITIONAL_DEFENCE` (new) | clinch x0.5, ground top x0.7 on block/defence success | Accuracy by position | 16, 18-19 |
| `TARGET_ARRIVAL` (new) | head -0.7, body +2.2, legs +0.7 logit | Accuracy by target | 15, 17, 25-26 |
| `UNFAMILIAR` (new) | p0 0.45, floor 0.06, tau 35 strikes, tier slope 0.5 | Unseen strikes decay as a fighter reads his opponent | 38, 125 |
| `FORCE.femaleMult` (02, new) | 0.72 | See §2 | 35, 37 |
| `GNP_DEFAULT_DMG` (new) | 0.6 | GnP damage for top nodes with no §5.1 row | 28 |
| `UNANSWERED_MIN_FORCE_N` (05, new) | 300 N | Only damaging strikes count as unanswered | 48, 90 |
| `HURT_TKO_UNANSWERED` / `COVERING_MIN_UNANSWERED` / `COVERING_STATIC_S` (06, new) | 2 / 2 / 3 s | Referee TKO rules after B16/B17 | 90, 48 |
| `MODIFIER_PARAMS.mmaDefenceBonus` (04, new) | +0.8 logit on the defender's escape under MMA rules | Half of all locked-in attempts finished (real 25 %) | 73 |

**Determinism.** The per-tick draw schedule is unchanged (`DRAWS_PER_DECIDE`,
`DRAWS_PER_STRIKE`, `GRAPPLE_EDGE_DRAWS`); every new
governor, the unfamiliarity hash and the knockdown-follow decision are
draw-free or reuse an existing draw, so `tests/style.test.ts`'s draw floor
holds unchanged. Bout digests all changed (engine 5.0.0); the golden/digest
tests pin determinism (same seed, same digest) rather than a digest value.


---

## 4. Result (final run)

`runs/post-tuning`: engine 5.0.0, seed `cal-2026-09`, **8,180 bouts** —
`baseline` 19 cells x 120 (1,320 T4 x T4 UFC-population bouts + 960 regional),
`tier_matrix` 36 x 40, `identical` 800, `physical_sweeps` 51 x 20,
`style_matrix` 36 x 20, `judging` 4 x 100, `mma_5r` 3 x 100, `rematch` 200,
`multi` 7 x 40, `rules_arenas` 53 x 10, `edge_cases` 7 x 30. 105 min at two
workers under the governor (9 pauses when the machine, with the other agents'
work on it, crossed the cap; no shrinks). The full report, with the Δ vs
baseline column on every row, is `docs/CALIBRATION.md`.

That is ~120 bouts per class for the master population. It is enough for the
pooled rows to reach the §6.6 CI rule (half-width ≤ tolerance/2) but **not**
for most per-class rows (the `class` status needs 6 of 8 men's classes to
pass individually, each on ~120 bouts; at the plans' default 2,000 per class
this would take roughly a day on this machine). So `class` rows report 0/22
PASS largely on sample size, and several FAIL on noise; their pooled
counterparts are the ones to read.

| | pre-tuning baseline (1,187 bouts) | post-tuning (8,180 bouts) |
|---|---|---|
| Master table rows PASS / WIDE / FAIL | 1 / 5 / 107 | **23 / 22 / 80** |
| Core rows PASS / WIDE / FAIL | 1 / 4 / 84 | **23 / 15 / 61** |
| Edge-case QA pass / fail | 1 / 5 (of those with data) | 12 / 5 |
| SLpM · sig att/min · sig acc | 1.92 · 4.58 · 42.1 % | **3.95 · 8.89 · 44.4 %** (3.90 · 8.40 · 46 %) |
| Total landed/min · sig/total | 1.98 · 0.97 | **4.98 · 0.79** (5.40 · 0.72) |
| Outcome mix KO+TKO / SUB / DEC | 64.5 / 0.0 / 32.1 % | **29.1 / 21.3 / 48.8 %** (32 / 18 / 49) |
| KO : TKO | 57.9 : 6.7 | **11.0 : 18.1** (11.5 : 22.4) |
| Mean 3R duration | 8.74 min | **10.57 min** (10.6) |
| KD / fighter / 15 min · KD per power-head landed | 0.63 · 6.8 % | **0.34 · 3.3 %** (0.30 · 3.9 %) |
| KD → KO/TKO (fight level) | 98.5 % | **50.9 %** (65 %) |
| KD rate R2/R1 · R3/R1 | 2.48 · 2.57 | **0.66 · 0.53** (0.45 · 0.28) |
| TD att/15 · TD accuracy | 3.76 · 49.9 % | **3.51 · 35.8 %** (4.0 · 38 %) |
| Sub att/15 · sub finish / attempt | 1.44 · 0 % | **0.49 · 30.7 %** (0.45 · 25 %) |
| Time distance / clinch / ground | 47 / 16 / 37 % | **64 / 11 / 25 %** (61 / 15 / 24) |
| Control per fighter (mean / median) | 2.44 / 0.26 min | **1.77 / 1.00 min** (2.2 / 1.0) |
| Reversals per fight | 34.35 | **0.37** (0.26) |
| Decisions unanimous / split / majority · draws | 78 / 10 / 11 % · 3.3 % | **77 / 21 / 2 % · 0.8 %** (77 / 20 / 2.5 · 0.7) |
| Identical fighters, side A | 55 % (n = 100) | **51.7 % ± 3.5** (n = 800) |

(Baseline numbers are the pre-tuning `results.jsonl` re-evaluated with the
current, corrected metric definitions.)

## 5. What is still off, and why

Largest first. Where a fix was tried and reverted it says so.

1. **Tier populations (T7) and predictability (T6).** Regional T3 x T3
   finishes 40 % (target 69 %), T2 x T2 20 % (60 %); better-rated fighters
   win only 51 % at a 0.5-1 SD rating gap (60-65 %) and 66 % at ≥ 2.5 SD
   (88-93 %). Same-tier pairs behave like slightly weaker T4 pairs: 02's
   force-by-tier (Smith 2000) and the tier pace term *lower* damage output at
   lower tiers and nothing makes regional defence disproportionately worse.
   Real regional finish rates are also largely a mismatch effect (wide skill
   spread within a card), which the plan's same-tier pairing does not
   reproduce. Raising the unfamiliarity tier slope (0.5 → 1.0) was tried: +2 pp
   of regional finishes, reverted as not worth the churn. Within a tier the
   derived rating (`mmaMean`) spreads only ~3.8 points, so rating gaps are
   mostly noise. Needs a model decision (a defence-skill-by-tier term, and a
   wider within-tier attribute spread in the generator), not a parameter.
2. **Finishing sequences.** KD → KO/TKO conversion 51 % (65 %) — up from
   ~35 % mid-pass once B24-B26 made the finish layer live; post-KO strikes
   before the referee steps in 0.34 (2.6) and strikes in the final 30 s of a
   TKO 7 (18.5): the referee stops fast and the finisher's flurries are short.
   Fight-ending punches are mostly "other" (ground strikes) and elbows; lead
   and rear hooks end only 10 % of fights (51 %): the KO model has no
   rotational-acceleration term, so a hook is not more concussive than a
   straight of the same force.
3. **Knockdowns by weight class.** Pooled KD rates are on target, but they
   still rise with mass (HW 0.62 vs FLW 0.38 KD/15; real is flat up to LHW).
   The head-inertia term fixed the 10x spread; the remaining slope sits
   between the punch mass exponent (02 `massExpPunch` 0.5) and the target
   term, which ~120 bouts per class cannot separate. KD decay by round
   (R3/R1 0.53 vs 0.28) is half-way: real decay is partly selection (the
   fragile are finished early), which a population of similar chins cannot
   show.
4. **Accuracy by target inside positions.** Clinch/ground head strikes land
   too often (68 % vs 58 %) and ground body strikes too rarely (61 % vs 94 %);
   there are **no leg strikes in the clinch or on the ground at all** (rows
   18-19 leg; the techniques do not exist in the catalogue). Distance power-
   head accuracy 31 % (25 %), with too much spread between fighters
   (SD 14 vs 8 %). Sig/total 0.79 (0.72): short strikes are
   thrown a little too rarely.
5. **Grappling shape.** Takedowns per class run the wrong way (HW attempts
   4.5/15 vs 3.1; flyweights 3.5 vs 4.8) — 03's `grap.tdPropensity*` by class
   is not read by the AI's takedown governor. Control time 1.8 min mean
   (2.2); submissions 21 % of outcomes (18 %) with a choke share of 61 %
   (79 %) and leg locks 10 % (3 %); slams 4 % of takedowns (9 %); no choke
   ends in unconsciousness (the §04 model has no unconscious outcome). Back
   control with a body triangle is a near-permanent position (the §2.3
   escape is 0.10 base), so a share of ground spells still lasts to the bell.
6. **Strategy checks (§7.2).** Reach edge wins 45-50 % in the population and
   30 % at +18 cm (target 52-63 %): the longer fighter does not use his range
   (no range management keyed to reach). Trailing fighters do not raise output
   or take more risks late (S4); the style-matchup matrix is lopsided (6 of 15
   pairs outside 30-70 %). These are 07 behaviour-model gaps, not parameters.
7. **Multi-fighter / street.** Invariants now hold (0 violations in 1v3, 2v2,
   1v5, rules x arenas and extreme anthropometrics; one tick of I5 in each of
   1v2 and ffa-4 over 40 bouts, down from tens of thousands). But the all-T0
   street crowd never produces a KO (0 % vs ~25 %) and the T5-vs-crowd
   defender spends 19 % of contact on the ground (≤ 10 %).

## 6. Test changes

- New `tests/phase9.bugs.test.ts` (19 pins covering B1-B27). B28-B31 (multi-fighter invariants) are covered by the per-tick invariant sweeps of `tests/sim.core.test.ts` (1v1, teams, ffa, crowd) and the calibration run's edge-case rows.
- `tests/qa.edgecases.test.ts`: QA-1/2/3/5 flipped from `it.fails` to `it`;
  QA-4/6/11 written as real tests; QA-9 left `todo` (the AI cannot reach the
  state it needs).
- `tests/rules.test.ts`: the 06 Monte Carlo test runs on synthetic margins
  that carry no relative-damage signal; its bands follow the retuned noise,
  10-8 and 10-10 parameters (commented); registry pins updated (0.26, 6.5).
- `tests/damage.test.ts`: knockdown Monte Carlo bands re-derived for the
  retuned damage parameters; blocked-strike case at 2,000 N.
- `tests/tiers.test.ts`: connect % measured at distance only (clinch and
  ground strikes now land ~70 % by design); T3 ≤ T2 slack 0.02 → 0.03 (the two
  are different archetypes; the tier direction is pinned by T0 and T5).
- `tests/style.test.ts`: the strangler preference is measured on attempts
  started, over 60 bouts (the stage-1+ share follows the defender as much as
  the attacker).
- `tests/match.setup.test.ts`: the carry-over case searches seeds until a bout
  lasts ≥ 120 s. Seed re-picks, each with a comment: `presentation.camera`
  (cam-1 / cam-91 / cam-40, searched in order), `presentation.integration`
  (searched demo seed), `replay.transport` (a bout with an airable event).
- `tests/sim.core.test.ts` unchanged: its per-tick invariant sweep caught the
  I3 case B26 introduced (a fighter over a downed opponent is in
  `pos.ground_knockdown`, which I3 now allows).
