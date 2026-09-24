# REALISM PASS — skill, range, cards, knockouts and behaviour (engine 6.0.0)

Scope: `src/sim/**` (plus measurement scripts and the tests that pin the changes).
Engine **5.0.0 → 6.0.0**: replay compatibility breaks (new event fields, new edges,
different decisions everywhere), the golden fixture was regenerated on purpose.
The per-tick RNG draw schedule is **unchanged** (8 draws per fighter per tick in
P3, 6 + 10 per strike, 4 per grapple edge); every new stochastic choice reuses a
draw that already exists (see §6).

**Status honestly stated.** The session ran out of time before the calibration
could be brought back into tolerance after the structural changes. Most of the
structural fixes are in and measured; the final retune (KD rate, takedown
accuracy, submission rate, pace) was applied from one intermediate run and
validated only on a small run (see §4). Read §5 before trusting any headline row.

---

## 1. What was wrong (found by measuring first)

New tools: `scripts/dev/behaviour-audit.ts` (repetition, footwork, per-style
distributions, score-state behaviour, fatigue, adaptation), `scripts/dev/skill-audit.ts`
(logistic regression of the winner on derived-attribute gaps), a `skill_domains`
batch plan (a T4 fighter against his own clone with one skill domain 10 points
lower), `scripts/dev/quick-cal.ts` (compact §7 rows with a before column),
`scripts/dev/count-check.ts`, `grapple-trace.ts`, `style-probe.ts`,
`range-probe.ts`, `choice-probe.ts`, `pace-probe.ts`, `sweep-summary.mjs`,
`snap-run.sh` (run a batch from a snapshot of the tree).

The big findings were **dead code**, not bad parameters:

| # | Finding | Effect |
|---|---|---|
| F1 | **No grappling skill ever applied.** 03's edges name their skills by alias (`wr.shot`, `wr.sprawl`, `bjj.pass`, `mma.cage` ...); the binder filled the skill table with §01's own names (`wr.shots`, `bjj.passing` ...) which match none, so `skillOf` returned null and every takedown, pass, sweep, escape and get-up resolved on base rate + physique only. | A clone with **+10 on every grappling sub-skill won 47 %** (+10 striking: 62 %). The derived rating weights grappling like striking, so rating barely predicted wins. |
| F2 | **Chapter 02's tactical layer was never read at contact**: range fit (edge / one band out / smothered), the §2.8 reach term, stance matchups, combination flow bonuses, counter windows (§2.5, 34-row counter matrix), placement precision and head movement. Only the arrival skill gap, guard and read were live. | Reach could only matter through availability ("one band out" is always available), so reach won < 50 %; counter-punchers had no counters; precision and head movement did nothing. |
| F3 | **Feints did nothing.** A feint decision went to `commitStrike`, failed `hasTechnique` and returned; the defender's bite logic never saw it. | Every feint was a wasted tick; no feint was ever recorded. |
| F4 | **The counter boost never switched off.** `counterWindowUntilMs > 0` instead of `>= now`: after the first read-counter of a bout the x2.5 boost on counter families (incl. the sprawl posture) was permanent. | "Standing in a sprawl posture" took ~60-70 % of all non-strike decisions (base and pass alike) — the single biggest cause of stilted, identical behaviour. |
| F5 | **Movement was one tick long.** A movement decision set velocity for exactly the tick it was chosen. | 92 % of movement runs lasted one tick (mean 0.11 s); stop-go stutter. |
| F6 | **Nobody knew the score.** The belief was built from `world.judges.runningRoundsUp`, a field nothing wrote, so every belief was 0 + noise. The behind/ahead rows patched `intent.paceTarget`, which the pace governor never reads when a plan exists. | Belief sign right ~50 %; no late urgency, no protecting. |
| F7 | **Phase policies and authored style were labels.** The plan's clinch / ground-top / ground-bottom policies, `style.primaryMode` (game plan), `fallbackMode` (plan B), `style.initiative`, `losingBehaviour` (except "unchanged") were stored and never read. | A kickboxer and a wrestler behaved identically once the fight hit the mat; the creator's game-plan controls did nothing. |
| F8 | **No top-man exits.** The graph had every bottom exit and no top one. A striker who stuffed a shot could only advance (spin behind, take the back). | Strikers controlled wrestlers for 3.1 min per 15. |
| F9 | Smaller: MMA-integration skill (clinch striking, GnP, gameplan execution) read by nothing; closing speed never passed to the force model (counters into a man walking in got nothing extra); 02's `rot` column (trajectory) unused, hooks only x1.15 of a straight; sig-strike attempts counted at the throw live but at contact in the stats (QA2 #6). | See §2. |

---

## 2. Every change, with rationale and grounding

### 2.1 Skill that decides fights (item 1)

- **Grappling alias map** (`core/bind.ts#grapplingAliases`): 03 §2.1.3's binding table,
  resolved from §01 effective sub-skills, with its `max(...)` composites. Pinned by
  `tests/realism.test.ts` (every alias an edge names resolves).
- **MMA floor on the defensive aliases**: `wr.sprawl`, `jd.throw_def`, `wr.scramble`,
  `bjj.retention`, `bjj.escape` and the submission escapes/guard take
  `max(art skill, share x mmaIntegration)`; every pro drills TD defence, getting up and
  submission defence whatever his base [MMA_INTEGRATION §1, §7]. Without it a kickboxer
  with no wrestling block sprawled at 7 against shots at 75.
- **`grap.kSkillScale` 1.8** on every edge's k_skill: WRESTLING §8's tier table (sprawl
  denial 50/70/85 %, chain success 40/65/85 %, ride retention 60/75/85 % per 20-point tier)
  is 3.3-5.3 logit per 100 points; 03 had capped k at 2.1-2.5 for clamps [D].
- **Submission k x1.25** (entry/secure 2.5, finish/locked 1.25) [BJJ_POSITIONS '+' ladder].
- **`STRIKING_SKILL_GAIN` 1.6** on the arrival and defence skill-gap terms, and the
  placement terms now passed (precision from the technique's power sub-skill, head movement
  from the best defensive striking craft; `precisionK` 0.8, `headMovementK` -0.64).
- **Position-specific striking skill** (`strikeSkills`): clinch strikes read clinch striking
  vs clinch craft, ground strikes GnP vs guard/escapes — MMA integration now decides the
  exchanges it names.
- **Absolute defence level** (`ABSOLUTE_DEFENCE` k 1.5, ref 70 = T4 mean striking):
  FIGHT_DATA §5 rule 1, "equal-skill lower tiers land more (worse defence)"; aimed at the
  regional finish rate.
- **Gameplan execution** (`mmaIntegration.gameplanExecution`) widens/narrows the decision
  temperature x1.12 .. x0.84.

Measured (T4 lightweight vs clone, 200 bouts per cell, ±7 pp):

| clone gap -10 in | engine 5.0.0 | after alias fix (c1) | after skill gains (c2) |
|---|---|---|---|
| striking arts | 62.0 % | 60.5 % | 65.5 % |
| grappling arts | **47.0 %** | 55.0 % | 51.0 % |
| MMA integration | 48.5 % | 58.5 % | 55.0 % |
| everything | 60.0 % | 64.0 % | 61.5 % |

Grappling and integration skill now count; the *size* of the skill effect is still well
short of the odds data (see §5). Part of the grappling cell's weakness is the experiment
itself: grade and competition priors floor an art's mean, so a -10 shift often does not
stick for a graded grappler.

### 2.2 Reach through range management (item 2)

- **Tactical terms at contact** (`striking/tactics.ts`, `tacticalTerms`): range fit logit and
  force multiplier (edge -0.30, one band out -0.60, smothered hooks and kicks lose force),
  §2.8 reach logit (+0.12 per 10 cm on straights, teeps and round kicks at long/kick range,
  x0.7/1.0/1.5 by class), §2.7 stance matchup. Grounded in 02 and LIT_B §2 (reach changes
  *where* and *what*, not a win multiplier; the file header of `ai/plans/physical.ts` still
  holds).
- **Preferred distance keyed to both reaches** (`ai/footwork.ts#preferredDistance`): an
  outfighter stands at the end of his own jab and, when he has the longer arms, outside the
  other man's (his "shell", 02 §2.1.1); mid and short intents stand inside their own bands.
  Movement is scored with a dead band (`rangeTargetCurve`) so a fighter at his distance
  circles instead of wobbling in and out.
- **Committed steps** (`bind.steer`): a movement lasts its §2.1.5 duration (200-400 ms);
  step-in strikes carry the attacker ~0.4 m forward; lateral steps stay lateral relative to
  where the opponent *is* (`holdDefence`); a radial reversal within 0.6 s near the wanted
  range becomes a lateral step.
- **Range tools**: a landed or blocked jab, cross, teep or front body kick on a man walking
  in stops his step and moves him back 0.08-0.30 m (`stopTheEntry`).
- **Entering is counterable**: walking into the other man's long band unguarded opens a short
  exposure window (the 02 §2.5.1 table applied to a step; the check-hook row fires), and the
  AI treats an entering opponent like one in recovery (counter families up).
- **Closing speed** reaches the force model (02 §2.6.4, 05 kClosing).

Reach edge (population, UFC classes): 47.6 % → 48.9 % (n ≈ 400, ±5); the reach sweeps
in the final run were not completed (§4). Distance now varies by matchup (outfighter vs
pressure fighter ~0.95 m, two outfighters ~1.03 m).

### 2.3 Scorecard awareness (item 3)

`ai/scorecard.ts`. At each bell a fighter scores the round from what he could see — the
judges' own effective-scoring quantities (06 §2.4.2 weights) — plus perception error by
fight IQ (SC-1) reduced by his corner's view, one draw per break (the existing `uScore`).
Open scoring gives him the panel's verdict (SC-0). The belief is a soft rounds-up count.
During a round he reads the current round's margin without noise. **Urgency** = press /
desperation / protect from rounds up, the current round, rounds left and the clock:
behind in the final round presses (pace x1.30, risk +1, grapplers shoot more, strikers
less), needing a finish is desperation (risk +1.5, submission hazard up), comfortably ahead
protects (pace -12 %, risk -1, grapplers control). Non-final rounds: a round being lost in
its last ~90 s is "stolen". `losingBehaviour` (finish-seek / steal round / shell / gamble /
unchanged), `whenLosing` and `heart` shape it. Grounding: FIGHT_DATA §3 #129 / 07 S4, LIT_B
§3.3 (Miarka: less low-intensity time in R3), LIT_B §3.5 (Holmes' round marginal effects).
The behind/ahead adjustment rows keep only their emergency flag (no double counting).

Belief sign right: ~50 % → ~97-100 % (audit). Last-round output vs own previous round,
behind vs ahead after R2: +39 % vs +17 % (72-bout audit), noisy.

### 2.4 Knockouts: the rotational term (items 4, 5)

- **`kRot`** in `damage/ko.ts#alphaEquivalent`: `(1 + ko.rotGain x (rot - 1))`, times
  `(1 + ko.rotSiteGain x (rot - 1))` for tangential blows to the jaw or temple, using 02's
  trajectory column (`rot`: straight 1.0, uppercut 1.2, overhand 1.4, hook 1.5, head kick
  1.7), carried on the impact as `rotFactor`. The per-punch-kind `kWeapon` (hook 1.15) is
  superseded. Rotational acceleration is the concussion mechanism (Rowson & Duma 2013;
  LIT_A §4; Viano 2005); 53.9 % of KOs come from strikes to the mandible (Hutchison 2014).
  Hook to the jaw now turns the head ~1.5x a straight of the same force.
- Fight-ending punch type: lead hook 6.7 % → 22 %, rear hook 3.0 % → 9.7 %, "other" 58 % → 43 %
  (targets 27 / 24 / 20).
- **Weight class direction (item 5)**: the target direction is confirmed from FIGHT_DATA
  §2.3: KO/TKO *outcome* share rises with class (FLW 25 → HW 48 %), but knockdowns per
  15 min and per 100 head strikes are nearly flat to MW (#34, #37). The sim's outcome
  direction was right; its KD rate rose too steeply. `ko.targetMassExp` 0.5 → 0.7.
- `ko.alphaCal` 1.3 → 1.2 and `ko.kKO` 0.05 → 0.035 to re-centre the KD rate and the KO:TKO
  split after `kRot`, closing speed and the tactical layer (validated on the small final run
  only).

### 2.5 Grappling, submissions, finishing, tiers (item 6)

- **TD propensity by weight class** (`TD_CLASS_MULT`, WRESTLING §9 r20 `grap.tdPropensity*`
  which nothing read): FLW x1.30 .. HW x0.66. Measured on 20-bout probes: FLW 5.7 vs HW 3.5
  attempts per 15 (was FLW 3.5, HW 4.5).
- **Top-man exits**: `tech.sprawl_reset` (stuff and reset, 0.85) and `tech.top_stand_away`
  (stand out of guard, 0.70) [WRESTLING §3.7; MMA_INTEGRATION I-20, S-6]. Edge count 187 →
  189.
- **Phase policies** (`PHASE_POLICY_WEIGHTS`): clinch avoid/break/accept/seek/wall,
  ground-top stand-and-reset/pass-by-strikes/ride/gnp/sub-hunt, ground-bottom
  stand-up-first/wall-walk/sweep/sub-hunt, now multipliers on the families they name.
- **Clinch and ground leg strikes** (clinch knees to the thigh, punches/hammerfists to the
  thigh on the ground) and a position x target arrival table (clinch head -0.45, ground body
  +1.4, legs +0.6/0.8) [FIGHT_DATA §3 #18-#19]. Before: no leg strikes in either position.
- **Submission mix** by family weight (chokes x1.45, joint locks x0.8, leg locks x0.3;
  leg-entanglement hazard 0.5 → 0.2): chokes 60 % → 71 %, leg locks 12 % → 2.6 % (targets
  79 / 3). `mmaDefenceBonus` 0.8 → 1.0, `SUB_HAZARD_SCALE` 1.6.
- **Finishing after a knockdown**: the referee waits for three undefended damaging strikes
  instead of two (`HURT_TKO_UNANSWERED`, `COVERING_MIN_UNANSWERED`), the finisher follows a
  downed man more (0.35 → 0.6 per decision) and throws harder (finish pace x7). KD → finish
  conversion did **not** improve (§5).
- **Judges** weigh takedowns and control more (td 0.21 → 0.34, control offence 0.0038 →
  0.0055 /s, passive 0.0015 → 0.0030 /s) toward FIGHT_DATA #84/#86/#87.
- **Regional tier**: the absolute-defence term (§2.1). Tier checks were not re-run to
  completion (§4).

### 2.6 Behaviour coherence (item 7)

- **Feints are real** (`bind.commitFeint`): a committed 190-290 ms movement with no contact,
  bite resolved once at commit from §2.3.4's formula with habituation (-0.7 logit per repeat
  in 20 s) and over-feinting (third in a row read), recorded as `feint` events. A bite
  spends the defender's reactive defence and read and gives the follow-up +0.10-0.70 logit.
- **Counters and combinations** (`tactics.ts`): counter windows after every strike (missed
  x1.0, blocked x0.6, landed x0.4 of the technique's window), best-counter bonuses realised
  by counter craft, combination-flow bonuses realised by combination craft; strike events
  now carry `counter`.
- **Combination choice is varied**: a weighted draw over the chains a strike can start
  (authored favourite x3, a single strike always possible, last chain x0.35), instead of
  always the first in catalogue order. Uses `u_feint`, which the bite no longer needs.
- **Counter vs lead timing**: `counterLean` from plan initiative + authored `style.initiative`
  concentrates a counter-fighter's strikes into openings and spreads a lead fighter's.
- **Fatigue lowers intended output** (`fatiguePaceMult`, flat to f 0.3, then -0.4 per unit;
  shots -0.7), heart resists it; footwork steps are charged as low-pace movement.
- **Adaptation**: `worksWeight` — each strike family's landing rate on a 90 s half-life,
  shrunk to its expected rate, moves its weight by (rate/expected)^(0.9 x IQ x adaptability)
  within [0.6, 1.7]; plan B (`switchToPlanB`) when shots are stuffed twice, a weapon stops
  landing, he keeps getting taken down, or he clearly lost a round.

Audit (style matrix; engine 5.0.0 = 108 bouts, engine 6.0.0 = 36-72 bouts):

| metric | 5.0.0 | 6.0.0 |
|---|---|---|
| same strike as last / chance | 1.35 | 1.06 |
| trigram repeated back-to-back (shuffled baseline) | 0.79 % (0.16) | 0.09 % (0.00) |
| single-tick movement runs · mean run | 92 % · 0.11 s | 17 % · 0.25 s |
| in/out reversals per standing minute | 47.8 (velocity >0.2 m/s) | 25.9 (committed step sense) |
| strikes recorded as counters | 0 (never recorded) | 21-38 % by style |
| feints recorded | 0 | ~30 per bout |
| belief about the cards right | 48-66 % | 97-100 % |
| sig attempts by round (R1/R2/R3) | 36 / 44 / 49 | 47 / 42 / 45 |
| adaptation correlation (R1 landing → R2 share) | -0.13 | -0.36 (not fixed, §5) |

### 2.7 Parameters that now reach the bout (item 8)

Wired in this pass (the UI's "No effect on the bout" badges can come off):

| Control | Path | Effect now |
|---|---|---|
| Handedness | `body.handedness` | Strong hand in front (left-hander orthodox, right-hander southpaw): lead hand x1.12, rear x0.96. |
| Balance | `physical.balance` | Takedown/throw defence and anti-wrestling aliases ±0.12 per point from 50; flash-knockdown share x1.16 (10) .. x0.84 (90). |
| Grip strength | `physical.gripStrength` | Pummel, top control, back control and judo grip aliases ±0.12 per point from 50. |
| Initiative | `style.initiative` | Pressure/counter/point family weights and the counter-vs-lead timing of the strike hazard. |
| Game plan | `style.primaryMode` | The matching plan mode's fitness x1.4. |
| Plan B | `style.fallbackMode` | Replaces the generated fallback; switched to when the plan fails (see §2.6). |
| Risk when behind | `style.losingBehaviour` | All five values shape the scorecard urgency (§2.3). |
| Heart | `mental.heart` | Scales pressing under urgency (x0.7 .. x1.3) and the fatigue brake on output. |

`tests/ui.params-effect.test.ts` asserts these are inert, so its "not read" rows for them
will now fail until the UI moves them to `live` (UI-owned; not edited here).
Coordination, acceleration, agility, fatigue resistance and movement style have no
attribute in the fighter model; they would need schema fields, or the UI can map them onto
existing ones (explosiveness / speed / balance / cardio+recovery / pressure+range).

---

## 3. Determinism, versioning, invariants

- Draw schedule unchanged. New uses of existing draws: the softmax residual (the position of
  `u_select` inside the chosen candidate's interval, itself uniform) sells a feint; `u_feint`
  (no longer used for the bite) chooses the combination. Both are exact, pinned in
  `tests/realism.test.ts`.
- `SIM_ENGINE_VERSION` 6.0.0; `tests/fixtures/sim-golden.json` regenerated with
  `scripts/dev/sim-golden.ts --write` (the harness checks recorded vs unrecorded runs share a
  digest).
- **QA2 #6**: one definition of a strike attempt — thrown. Strike payloads carry `sig` and
  `pos` as thrown; every committed strike ends in exactly one strike event (cancelled,
  cut off by the bell or by the end of the bout → `interrupted`); stats and the batch
  summariser read `detail.sig/pos`. Live counters equal the stats (pinned).

## 4. Runs behind the numbers

| run | engine | content |
|---|---|---|
| `runs/post-tuning` | 5.0.0 | Phase 9 final, 8,180 bouts (reference; `runs/rp-ref` = its UFC/style/sweep subset) |
| `runs/rp-base-sd` | 5.0.0 | skill_domains, 800 bouts |
| `runs/rp-c1`, `rp-c2` | 6.0.0 mid-pass | UFC population 660 + skill_domains 800 + style 360 |
| `runs/rp-c4` | 6.0.0 pre-retune | UFC population 660 (+ part of skill_domains) |
| `runs/rp-final` | 6.0.0 final | UFC population, 30 bouts per class (330 bouts) — `docs/CALIBRATION.md` |

The machine was shared and the batch governor ran at one worker most of the session, so the
final validation is small: per-class rows are noise and pooled rows carry ±2-4 pp.

## 5. What is still off (largest first)

1. **Skill predictability** is better but far from the odds data: typical favourite (0.5-1 SD)
   ~57 % vs 60-67 %, +10 on every skill ~62 % vs ~80-85 %. The per-point skill effect is still
   weak relative to bout noise — chiefly the knockout lottery (a landed power shot's KD
   chance is barely skill-dependent) and decisions on near-equal volume. Next steps: make
   KD/flush probability depend on the defender's craft much more (elite defenders are rarely
   caught flush), and let skill set output (landed rate) more than accuracy alone.
2. **Calibration after the structural changes** was restored only roughly (KD rate,
   takedown accuracy and attempts, submission rate, pace were retuned from one run of 660
   bouts and validated on 330). A full calibration run is needed.
3. **Knockdown → finish conversion** stayed ~46-52 % (65 %); strikes in the last 30 s before a
   TKO ~7.5 (18.5); post-KO strikes 0.3 (2.6). The finisher's flurry and the referee's
   patience need a proper finishing-sequence model (sustained ground-and-pound on a hurt
   man), not threshold nudges.
4. **Adaptation metric** is negative: the audit's R1→R2 correlation is confounded by
   opponent adjustment and regression to the mean; `worksWeight` is in but not validated by
   a clean metric.
5. **Style balance**: judo/clinch-grinder archetypes lose heavily (8-33 %), BJJ swings with
   the submission tuning. S7 (no pair outside 30-70 %) fails.
6. **Performance**: interleaved bundled benchmarks on a loaded machine read ~+25-30 % cost
   per tick, of which a large share is behavioural (more standing time, more in-range
   candidates, longer movement) rather than code overhead; the new per-tick work was cached
   (preferred distance, urgency every 5 ticks, works weights per decision, reach limits).
   Over the 10 % budget as measured; needs a clean-machine A/B and targeted work
   (candidate construction, movement candidates).
7. Not reached this pass: regional (T3) finish rate re-measurement, reach sweeps at the new
   engine, S4b open scoring, row 128 (R3 vs R1 output) re-measurement at scale.
