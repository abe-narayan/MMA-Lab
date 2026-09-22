# 07 — Strategy and AI (decision architecture, game plans, adaptation, multi-opponent)

Binding conventions: `docs/design/00_CONVENTIONS.md`. Tags: `[S: FILE §n]` sourced, `[D: …]` derived, `[E]` estimate.
Where a research file marks a number **ESTIMATE** it is carried here as `[S: FILE §n (est.)]` — sourced from the
research brief, but a research-side estimate; every `(est.)` value is a calibration tunable and is covered by
Assumption A-1 in §6.

Tier vocabulary: skill tiers T0–T5 (conventions §3). Fight-IQ tier `iqTier` = the tier band of `fightIQ` (0–100)
using the same bands. The research brief's "IQ 1–5" maps to T1–T5; T0 is below the brief's scale
`[D: MMA_INTEGRATION §6.4 uses IQ 1–5; conventions §3 add T0]`.

---

## 1. Purpose and scope

This section owns **everything a fighter decides** and **how well the decision is carried out**, for 1v1, 1vN,
teams, free-for-all and crowd modes:

| Owned here | Interface |
|---|---|
| Decision architecture: strategic → tactical → action → execution-quality layers | consumes the legal-action catalogue of §02 (striking), §03 (clinch/wrestling), §04 (ground); emits one `ActionRequest` per fighter per tick |
| Perception, memory, opponent model, anticipation, feint susceptibility | reads recorded state from §05 (damage/fatigue) and §02–§04 (technique phases, telegraph scores); writes `readSuccess` / `feintBite` flags that §02 consumes in hit resolution |
| Pre-fight game plan generator and scouting noise | reads fighter schema of §01 (attributes, sub-skills, style, tendencies, record, stance exposure); writes `GamePlan` |
| In-fight adaptation, score awareness, damage awareness, corner model | reads judge model of §06 (true running score), referee events; writes `Intent` and `adjustments[]` |
| Multi-opponent threat assessment, targeting, positioning, team coordination, street/crowd dynamics | reads §09 §2.1 P5 steering/integration and §09 §3.3 arena geometry (`cageProximity`); writes movement intent (steering objective) + target id |
| Commentary/strategy events | consumed by §09 §5 (commentary) and the game-plan panel (§08 §7.6 HUD, §09 §4.4 `FighterIntent` projection) |
| Validation checks for strategy behaviour | feeds Phase 9 calibration (§5 here) |

Not owned here: hit/miss/damage resolution (§02–§05), judge scoring (§06), technique durations (§02–§04),
movement integration (§09 P5). This section only chooses actions, targets and steering goals.

Numbering note: §01's interface table labels this section "06" and calls referee/judging "07"; the numbering here
follows the file names (`06_RULES_REFEREE_JUDGING.md`, `07_STRATEGY_AND_AI.md`). §01's `iqTier` is 1–5
(`fightIQ` < 30 → 1); this section's "T0" IQ row applies when the fighter's overall tier is T0 (untrained), i.e.
`iqTier07 = overallTier == T0 ? 0 : iqTier01` `[D: conventions §3 + 01 §2.3.4]`. Mode ids map 1:1 onto §01's
`PrimaryMode` values (`distanceStriking` ↔ `mode.distance_striking`, `counter` ↔ `mode.counter_striking`, …);
`mode.sprawl_and_brawl` is `distanceStriking` with `tdPolicy: 'never'`, `clinchPolicy: 'break'` and the S-rules.
A style `gamePlanOverride` (§01 §2.6) bypasses the generator of §2.5.3 and is used verbatim.

Replaces: the current `chooseAction` weighted lottery and "nearest opponent" targeting (`docs/AUDIT.md §1.1`).
Keeps: the fixed tick order, seeded RNG, digest, and the multi-opponent geometry (fan-out, repulsion,
`engagedBy`) as the base of crowd mode (`docs/AUDIT.md §3`).

---

## 2. Model

### 2.1 Layered decision architecture

Four layers, each running on its own cadence. All layers are pure functions of recorded state plus the seeded
RNG; nothing reads wall-clock.

| Layer | Cadence | Output | Owner of variability |
|---|---|---|---|
| (a) **Strategic** — pre-fight game plan | once pre-bout; re-read at each round break | `GamePlan` (§2.5) | scouting noise σ by iqTier |
| (b) **Tactical** — intent | every `T_eval` s by iqTier, plus event triggers, plus round breaks (§2.6) | `Intent` (where to fight, what to attack/avoid, pace, risk) | P(change \| signal) by iqTier |
| (c) **Action** — utility scoring | every tick (dt = 0.1 s) in which the fighter is free to act | `ActionRequest` (action id + target + parameters) | softmax temperature τ by tier, fatigue, rocked |
| (d) **Execution quality** | at action commit | telegraph score, timing offset, accuracy/target error | tier, fatigue, composure |

Data flow per tick for fighter `f` (called in §09 §2.1 phase P3 "decide", ascending fighter id, so tick order is
preserved; movement intents are consumed in P5):

```
perceive(f)          // §2.4: build PerceivedState from snapshot at tick t − delay(f)
if evalDue(f)        // §2.6: cadence or event trigger
    intent = evaluate(f, plan, ledger, opponentModel, perceivedScore)
if f.free            // not mid-technique, not stunned/grounded-locked
    legal = catalogue.legal(f.state, opp.state, ruleset)          // §02–§04
    scores = legal.map(a => utility(a, f, intent, plan, perceived)) // §2.2
    a* = sampleSoftmax(scores, τ_eff(f), rng)                         // one uniform draw
    exec = executionQuality(a*, f, rng)                              // §2.3: fixed draws
    emit ActionRequest{a*, target, exec}
```

**Determinism contract.** Per fighter per tick the AI consumes exactly **6 RNG draws in fixed order**, whether
or not each branch is active (inactive branches still draw and discard) so the stream position is a pure
function of `(tick, fighterId)`:

| # | Draw | Used by |
|---|---|---|
| 1 | `u_read` | anticipation read of the most-threatening incoming technique (§2.4.4) |
| 2 | `u_feint` | feint bite (§2.4.5) |
| 3 | `u_eval` | P(change \| signal) at a tactical evaluation (§2.6.2) |
| 4 | `u_select` | softmax action selection (§2.2.4) |
| 5 | `u_timing` | timing error (§2.3) |
| 6 | `u_target` | target/accuracy error (§2.3) |

Multi-opponent adds one draw per tick for target switching (`u_switch`, §2.7.2) — draw 7, always taken. Per-bout
draws (plan generation, scouting noise) happen once before tick 0 in fighter-id order. Round-break draws
(corner cue correctness, uptake) happen in fighter-id order in the break step. `[E]` on the fixed-6 layout;
the count is a design choice, the principle is conventions §4.

### 2.2 Action layer — utility function (IAUS-style)

Following the utility-AI recommendation `[S: LIT_C §2]` (Infinite Axis Utility System: score = product of
considerations, pick max or weighted-random among top candidates), adapted to a 10 Hz deterministic engine.

#### 2.2.1 Score

For each legal action `a`:

```
score(a) = base(a)
         × Π_k  comp( c_k(x_k(a)) , n )          // considerations, k = 1..n, each in [0,1]
         × clamp( w_style(a) × w_plan(a) × w_adapt(a) × w_matchup(a) , 0.25 , 3.0 )
         × w_multi(a)                            // 1.0 in 1v1; §2.7
```

- `base(a)`: catalogue prior for the action family (e.g. jab 1.5, cross 1.0, headKick 0.28 — the existing
  engine priors are the starting point, re-fitted in Phase 9 to FIGHT_DATA #20–#23 target/position shares).
  `[S: docs/AUDIT.md §1.1]` for provenance of the current priors; values re-tuned `[E]`.
- `comp(c, n) = c + (1 − c) × (1 − 1/√n) × c` — the IAUS compensation factor so that products over many
  considerations do not collapse toward zero `[S: LIT_C §2]` (compensation described there; the √n form `[E]`).
- The clamp `[0.25, 3.0]` is the research rule "cap any single action weight at ×3 and floor at ×0.25"
  `[S: MMA_INTEGRATION §10 rule 22]`.

#### 2.2.2 Considerations (inputs `x_k`) and response curves

Every consideration is a response curve `c_k: [0,1] → [0,1]` over a normalised input. The full list the action
layer reads (all from `PerceivedState`, i.e. delayed by §2.4.1):

| id | input `x` (normalised) | curve shape | notes |
|---|---|---|---|
| `c.range_fit` | \|distance − action.optimalRange\| / action.rangeTolerance | 1 − x², clipped | from §02 technique ranges; replaces the current hard distance gates |
| `c.range_target` | \|distance − intent.rangeTarget\| for movement actions | linear | movement actions score high when they move toward the intent range |
| `c.own_fatigue` | f (0–1) | per family: strikes 1 − 0.45 f, kicks 1 − 0.6 f, shots 1 − 0.7 f, clinch-rest 0.3 + 0.7 f | output −45 % at f = 0.8 `[S: DAMAGE_PHYSIOLOGY §4.3]`; family split `[E]` |
| `c.opp_fatigue` | perceived opp f | pressure/clinch/TD families: 0.6 + 0.4 x | tired fighters defend TDs poorly `[S: MMA_INTEGRATION §7.2]` |
| `c.own_damage` | own region damage relevant to the action (leg for kicks, hand for punches) | 1 − x | from §05 regions |
| `c.opp_hurt` | perceived opp rocked/hurt (0/1) | finish families ×(1 + 0.5 x); defensive families ×(1 − 0.3 x) | finisher logic §2.6.5 |
| `c.cage` | own distance to fence / 1.5 m | family-specific (circle-away high when x → 0; shoot/clinch for pressure fighter high when *opp* x → 0) | `[S: MMA_INTEGRATION §3.1 S-2, W-2]` (1.5 m threshold) |
| `c.round_time` | seconds left in round / round length | finish-seeking and volume families rise in the last 60 s (×1.3) when behind `[S: MMA_INTEGRATION §7.4 SC-2 (est.)]` | |
| `c.setup` | ticks since own last strike (for shots: 1 if a strike landed/was thrown in the prior 1 s) | shots ×0.4 if naked `[S: MMA_INTEGRATION §3.1 W-1 (est.)]` | |
| `c.expected_threat` | opponent model's P(opp attacks next \| context) | counter-window families ×(0.5 + x); lead families ×(1.2 − 0.4 x) | §2.4.3 |
| `c.opp_recovery` | 1 if opp is in the recovery phase of a technique (perceived) | counter strikes ×1.8 `[S: MMA_INTEGRATION §3.3 P-4 (est.)]` | |
| `c.balance` | own balance (0–1) | kicks and shots ×x | |
| `c.position_value` | ground/clinch node value from §03/§04 tables (advance vs hold) | linear | e.g. pass value after ≥2 landed ground strikes in 5 s ×1.4 `[S: MMA_INTEGRATION §2.3 I-16 (est.)]` |
| `c.risk` | action risk class (0 safe … 1 gamble) vs intent.riskAppetite | c = 1 − max(0, risk − (0.5 + 0.25 × riskAppetite)) | riskAppetite ∈ {−2…+2} |
| `c.mustnot` | action ∈ plan.mustNots | 0.15 for T2+, 0.5 for T1 (they know but slip), 1.0 for T0 (no list) | `[E]` |
| `c.pace` | own strike rate over last 60 s / intent.paceTarget | strikes: 1 if below target, 1 − 0.5(x − 1) if above | pacing profile §2.5.4 |
| `c.dwell` | seconds in the pocket / clinch vs intent limits (V-2 ≤ 2 s pocket vs power puncher; F-2 > 3 s clinched with heavier opp) | exit families ×2 when limit exceeded | `[S: MMA_INTEGRATION §3.4 V-2, §4.3 F-2 (est.)]` |

#### 2.2.3 Where style, plan, adaptation and matchup weights enter

- `w_style(a)`: per-fighter static multiplier vector by action family, from the fighter's style profile in §01
  (pressure / counter / distance / clinch / wrestler / submission / volume / power). Range [0.5, 2.0] `[E]`.
  This is the "tendency" idea from sports sims `[S: LIT_C §2]` and replaces the current per-bout `tendency`
  jitter — jitter survives only as `ai.style_jitter_sd` (§4) applied once per bout.
- `w_plan(a)`: the game plan's `actionWeights[a]` (§2.5.2), the product of the matchup and physical-advantage
  rules that applied at plan time. T0 fighters have `w_plan ≡ 1`.
- `w_adapt(a)`: the product of currently active adjustments (§2.6.1), each with its own dwell timer.
- `w_matchup(a)`: **dynamic** matchup terms that depend on the live geometry rather than the plan — the
  open-stance lead-foot flag (ST-1: circle-to-outside ×1.5; cross ×1.4; jab ×0.75) and cage proximity rules.
  These are computed every tick because the stance and foot positions change. `[S: MMA_INTEGRATION §5.1]`.

#### 2.2.4 Selection: softmax with tier temperature

```
P(a) ∝ score(a)^(1/τ_eff)
τ_eff = τ_tier × 1 / ((1 − q_fatigue(f)) × (1 − q_rocked) × (1 − q_dump) × (1 + q_secondWind))
```

| tier | τ_tier | tag |
|---|---|---|
| T0 | 1.00 | `[E]` — near-lottery, matching the "wild" novice profile `[S: BOXING §6]` |
| T1 | 0.80 | `[E]` |
| T2 | 0.60 | `[E]` |
| T3 | 0.45 | `[E]` |
| T4 | 0.35 | `[E]` |
| T5 | 0.28 | `[E]` |

Decision-quality penalties (all applied as `1/(1 − q)` on τ):
- `q_fatigue(f)`: 0 at f ≤ 0.2, 0.15 at f = 0.5, 0.35 at f = 0.8, linear between and beyond (cap 0.5)
  `[S: DAMAGE_PHYSIOLOGY §4.3 (est.)]`, zero-point `[E]`.
- `q_rocked` = 0.40 while `state.rocked` `[S: DAMAGE_PHYSIOLOGY §7 rule 6]`.
- `q_dump` = 0.20 × dump for the first 150 s of R1 `[S: DAMAGE_PHYSIOLOGY §4.6]`.
- `q_secondWind` = +0.10 for 60 s when triggered `[S: DAMAGE_PHYSIOLOGY §4.5]`.

The tier that sets τ is the **discipline tier of the phase** (striking tier when standing at range, wrestling
tier in clinch/TD situations, BJJ tier on the ground) blended 50/50 with `iqTier` `[E]`: a T4 boxer with T1
ground skills chooses ground actions near-randomly.

Why softmax rather than argmax: FIGHT_DATA and the predictability ceiling (`[S: LIT_B §3.4]` 61.6 %) require
irreducible variance; argmax with a deterministic engine would make identical matchups replay identically apart
from resolution rolls. The temperature is also the single lever for "personality" and difficulty
(`[S: LIT_C §2]` personas/DDA via utility shaping, never via cheating inputs).

#### 2.2.5 Macro-actions (multi-tick plans)

A tiny HTN-style macro is allowed for sequences that lose meaning if re-chosen every tick
`[S: LIT_C §2]` ("a tiny HTN-style macro … replanned every tick"): combinations (§02 grammar, ≤ 4 strikes
`[S: MMA_INTEGRATION §6]` Wittman), `feint → level change`, `cut cage → feint → entry`, `sprawl → front
headlock → go-behind` (§03), `hit on the break`. A macro is chosen by the utility layer as one action with a
`plan[]` of steps; each subsequent tick the macro's next step is re-scored against `abort` (score from
`c.opp_hurt`, being hit, or opponent's changed range) so a fighter can bail out of a combination mid-way.
Combination length cap by tier: T0 1–2, T1 2, T2 3, T3 3–4, T4–T5 4 with abort/branch `[S: BOXING §6]`;
capped at 3 vs a wrestler at level-change distance `[S: MMA_INTEGRATION §3.1 S-4]`.

#### 2.2.6 Optional lookahead (MCTS) — reserved

The engine is a cloneable deterministic forward model, so an MCTS lookahead for "big" decisions (takedown
attempt, all-in flurry, clinch break) is possible: clone engine + RNG, roll out 3–5 ticks, N ≈ 64 playouts,
≤ 2 ms per decision in a worker `[S: LIT_C §2]`. **Not in the baseline**: it would double the RNG bookkeeping
and the headless batch cost on the target laptop (`docs/AUDIT.md §4`). If enabled, it must consume a
separate child RNG seeded from `(seed, tick, fighterId)` so the main stream is unchanged, and its result enters
as one extra consideration `c.lookahead` (never as a hard override). `[E]` on the "reserved" status.

### 2.3 Execution-quality layer

Applied at commit; the resolution sections consume the outputs.

| Output | Formula | Tags |
|---|---|---|
| `telegraph` (0–1, read by the opponent's anticipation, §2.4.4) | `tele_base(a) × (1 + 0.5 f) × tierMult`; tierMult T0 1.6, T1 1.4, T2 1.2, T3 1.0, T4 0.85, T5 0.7 | `tele_base` per technique from §02; tier multipliers `[E]` anchored on the novice tells "fist drops before the punch, wide loops, elbows flare" `[S: BOXING §6]` |
| `timingOffset` (ticks) | 0 with p = p_ontime(tier); else +1 tick (late) with p = 0.75, −1 tick (early, on nothing) with p = 0.25; p_ontime T0 0.55, T1 0.65, T2 0.75, T3 0.85, T4 0.92, T5 0.95; ×(1 − 0.15 f) | `[E]`; direction from "broken rhythm makes anticipatory defence fire at the wrong time" `[S: BOXING §5]` |
| `accuracyMod` (logit) | −k_exec × (1 − p_ontime) − 0.18 f/0.8 at f = 0.8 (accuracy −18 %) | fatigue accuracy `[S: DAMAGE_PHYSIOLOGY §4.3]`; k_exec = 0.6 logit `[E]` |
| `targetError` | with p = 0.10 (T0), 0.06 (T1), 0.03 (T2), 0.015 (T3), 0.008 (T4), 0.005 (T5) the requested target region is swapped for an adjacent one (head→body etc.) | `[E]` — "head-only slips, arm punches" `[S: BOXING §6]` |
| `powerCommit` | T0–T1 overcommit: 1.15 power, −0.2 balance on power strikes with p = 0.4/0.25 | `[S: BOXING §6]` "overcommitting for power" (qualitative), numbers `[E]` |
| `stanceIntegrity` | T0: square/crossed feet 30 % of movement ticks (TD defence −10 pts, kick check −); T1 10 %; T2+ 0 | `[S: BOXING §6]` qualitative; numbers `[E]` |
| `eyesClosed` | T0: 35 % of exchanges, T1: 15 % — read probability 0 for that exchange | `[S: BOXING §6]` "eyes close on contact"; numbers `[E]` |

Kinetic-chain efficiency (strength → punch force by training age) is a §02/§05 matter
(`[S: LIT_B §4.10]`), not repeated here.

### 2.4 Perception and opponent model

Principle: expertise is *cue-based anticipation*, not faster reflexes — simple RT does not differ by tier;
choice RT to sport-specific cues does `[S: LIT_B §4.2]`. Experts fixate the head/torso, novices the hands
`[S: LIT_B §4.1, §4.5]`. Beginners' default response is defensive; experts' is counter-offensive
`[S: LIT_B §4.4]`.

#### 2.4.1 Perception delay

Plumbing is §09 §2.5 (`ObservedState = worldAt(tick − lagTicks)`, ring buffer, `lagTicks ∈ {1,2,3}`); this
section sets the values and their meaning:

```
perceptionLagMs = base(tier) − 1 ms × (reactionTime − 50) + 50 ms × [f >= 0.7] + 150 ms × [rocked] + famMs
base(tier): T0/T1 300 ms, T2/T3 200 ms, T4/T5 100 ms          [S: 09 §2.5 (E)]
lagTicks = round(perceptionLagMs / 100), clamped to [1, 3]
```

- The ladder models **anticipation, not reflex**: simple RT does not differ by tier `[S: LIT_B §4.2]`, but
  experts pick up kinematic cues 50–100 ms earlier `[S: LIT_B §4.2]` and recognise attacks ≈ 100 ms faster
  (811 vs 915 ms) `[S: LIT_B §4.7]`; novices' gaze scatters to the limbs `[S: LIT_B §4.5]`, which is the
  extra 100 ms at T0/T1 `[E]`. The T5–T0 spread of 200 ms is at the top of the measured range (A-5).
- `reactionTime` (attribute, 0–100) shifts the lag by −1 ms per point above 50 `[S: 09 §2.5 (E)]`.
- Fatigue: +50 ms at f >= 0.7 `[S: 09 §2.5 (E)]` — direction from RT +10–15 % under mental fatigue with
  accuracy unchanged `[S: LIT_B §4.7]`.
- Rocked: +150 ms `[S: 09 §2.5 (E)]` (movement −40 %, decision −40 % `[S: DAMAGE_PHYSIOLOGY §7 rule 6]`).
- Familiarity `famMs` = +20 ms (≈ +10 % reaction) for a fighter with `stanceExposure[oppStance] < 3` facing
  the unfamiliar stance, T0–T3 only `[S: MMA_INTEGRATION §5.1 ST-5 (est.)]`, `[S: LIT_B §3.15]`.
- The lag is deterministic (no RNG); the anticipation *read* (§2.4.4) decides whether the delayed observation
  is interpreted correctly, and §02's reactive-defence roll compares `perceptionLagMs` with the technique's
  `startupMs − telegraphMs` `[S: 09 §2.5]`.

`PerceivedState` = the recorded snapshot at `t − d_percept` for the opponent's position, technique phase,
stance, guard; **own** state is read without delay. Opponent *hidden* state (fatigue index, acute damage) is not
readable directly; it is estimated from cues (§2.4.2).

#### 2.4.2 What a fighter notices (cue set)

| Cue | Source | Noticed by | Tags |
|---|---|---|---|
| Landed / absorbed strikes by family, target, cleanness | resolution events | all tiers, immediately (own body) | — |
| Opponent's technique starts (for reads) | opp phase at t − d | all tiers via §2.4.4 | — |
| Takedown outcomes, control seconds, position changes | §03/§04 events | all | — |
| Counters eaten (was hit during own technique recovery) | resolution tag `counter` | T2+ record it as a *pattern* (which technique got countered); T0–T1 only as damage | `[E]` |
| Opponent hurt/rocked | opp `state.rocked` visible cue (§05 rocked = movement −40 %, guard −35 %) | perceived with p = p_read(tier) per tick while it lasts; T0 0.5 | `[E]` on the probability; the cue set is `[S: MMA_INTEGRATION §7.1]` |
| Opponent tired | opp pace drop > 20 % over 30 s vs its R1 first-minute pace, or mouth-open/hands-low animation state at f ≥ 0.6 | T2+; T1 only via corner | thresholds `[S: MMA_INTEGRATION §7.1, §7.2 (est.)]` |
| Opponent cut / eye damage / leg damage | §05 visible flags | all from T1 | — |
| Opponent tendencies (what they throw, when) | opponent model §2.4.3 | T1+ (T0 has no model) | — |
| Referee/judge context (time, round, estimated score) | clock; §2.6.3 | T2+ (T1 only by corner) | — |

#### 2.4.3 Opponent model (online tendency table)

The Killer-Instinct/Tekken idea at coarse granularity `[S: LIT_C §2]`: counts
`N[context][oppActionFamily]` with Laplace smoothing and exponential forgetting.

- `context = (rangeBucket ∈ {long, mid, short, clinch, groundTop, groundBottom}) × (oppFatigueBucket ∈ {fresh
  f<0.4, tired f≥0.4}) × (myLastFamily ∈ {none, jab, power, kick, levelChange, clinchEntry})` → 72 contexts;
  families ≈ 12 → 864 counters per fighter. Cheap.
- Prior: scouted tendency profile (§2.5.1) entered as pseudo-counts `n_prior` by iqTier: T1 2, T2 4, T3 8,
  T4 12, T5 16 `[E]` (more trust in the film at higher IQ). Laplace α = 1 `[S: LIT_C §2]`.
- Forgetting: `N ← N × exp(−dt / τ_mem)` per tick; `τ_mem` by iqTier T1 20 s, T2 40 s, T3 60 s, T4 90 s,
  T5 120 s `[E]`. **Deviation** from `[S: LIT_C §2]` (τ ≈ 60 ticks = 6 s): 6 s cannot accumulate the ≥ 6
  attempts the adjustment rules need `[S: MMA_INTEGRATION §7.2]`; the exchange *ledger* (below) keeps the
  short horizon instead.
- Persistence: counts carry across round breaks (×1.0); T5 adds "cross-round trap building": the intent may
  deliberately repeat a pattern in R1 to exploit the opponent's learned response in R2 `[S: MMA_INTEGRATION
  §6.4]` (generational: "builds traps across rounds") — implemented as a plan trigger, §2.5.5.
- Output: `P(oppFamily | context)` and `expectedThreat` = Σ_family P × threatWeight(family); consumed by
  `c.expected_threat`, counter selection and feint selection.
- Fighter-side *pattern detection* (for the adjustment table): "opponent's adjustment detected" (T5 trigger) =
  KL divergence between the last-30 s distribution and the prior-60 s distribution in the same context
  exceeds 0.35 nats `[E]`.

**Exchange ledger** (fighter and corner share it, corner with half the noise): sliding 30 s window
`[S: MMA_INTEGRATION §7.1]` of per-family attempts/landed/absorbed, hit-rate, knockdowns, TDs landed/stuffed,
control seconds, clinch seconds, position changes, own damage delta, own fatigue delta, plus per-round totals.

#### 2.4.4 Anticipation (reads)

Each tick, for the single most-threatening incoming technique (highest expected damage among opponents' active
techniques not yet resolved), one read roll (draw 1):

```
p_read = sigmoid( logit(p_tier) + 2.0 × (t_elapsed / t_commit − 0.5) + 1.2 × telegraph − anxietyPen − famPen )
```

| tier | p_tier | tag |
|---|---|---|
| T0 | 0.50 | `[E]` below the novice band |
| T1 | 0.58 | `[D: novice band 0.55–0.65 [S: LIT_B §4.1]]` |
| T2 | 0.68 | `[D: novice/intermediate boundary]` |
| T3 | 0.75 | `[D: intermediate band 0.70–0.78]` |
| T4 | 0.83 | `[D: expert band 0.80–0.88]` |
| T5 | 0.87 | `[D: top of expert band]` |

- The elapsed-time slope (accuracy rises as the attack unfolds, expert curve above novice at every occlusion
  point) `[S: LIT_B §4.6]`; slope 2.0 `[E]`.
- `telegraph` from §2.3 of the attacker; coefficient 1.2 `[E]`.
- `anxietyPen`: when own `state.rocked` or composure-driven anxiety (composure < 40 and being pressured): T0–T1
  −0.15 → logit −0.65; T2–T3 −0.10; T4–T5 −0.05 `[S: LIT_B §4.3]` (suggests −15 % novice / −5 % expert; the
  T2–T3 midpoint `[E]`).
- `famPen`: 0.10 in probability terms (≈ −0.45 logit) for a fighter with `stanceExposure[oppStance] < 3 fights`
  facing the unfamiliar stance `[S: MMA_INTEGRATION §5.1 ST-5 (est.)]`, `[S: LIT_B §3.15]` (elite fighters fully
  adapted → 0 at T4+ regardless).
- Mental fatigue lowers RT more than accuracy `[S: LIT_B §4.7]` → fatigue does **not** enter `p_read`; it
  enters the delay (§2.4.1).

Consequences of a successful read (flags passed to §02 resolution and to the action layer):
1. The defender's defensive action for that technique is chosen with **full information** (correct guard side,
   check vs catch, sprawl vs frame) at the observed lag.
2. With probability `p_counter(tier)` the read also triggers a **counter-on-read**: the action layer is forced
   to score counter families ×2.5 for this tick `[E]` on the multiplier: T0 0.02, T1 0.05, T2 0.15, T3 0.25,
   T4 0.40, T5 0.50 `[D: LIT_B §4.4 suggests novice 0.05 / intermediate 0.25 / expert 0.5; T0 and T4 interpolated]`.
   Winners' block-and-counter rate 2.8 vs 0.1 per bout in novice boxing `[S: LIT_B §5.1]` is the validation
   anchor.
3. A failed read on a *telegraphed* attack still gets the generic defence chosen by the utility layer at the
   normal delay; a failed read on a *non-telegraphed* attack yields `def.neutral` (caught clean; §05 "unseen
   strike ×1.35" applies `[S: DAMAGE_PHYSIOLOGY §7 rule 4]`).

#### 2.4.5 Feints and deception

A feint is an action that exploits the *opponent's* read process `[S: LIT_B §4.13]`. When fighter A commits a
feint of family F (jab/rear-hand/level-change/step/kick feint; each 80–150 ms `[S: BOXING §5]`), opponent B
rolls draw 2:

```
p_bite(B) = p_bite_tier(B) × (1 + 0.3 × feintQuality(A)) × repeatPenalty
```

| tier of B | p_bite_tier | tag |
|---|---|---|
| T0 | 0.65 | `[E]` |
| T1 | 0.60 | `[S: LIT_B §4.5]` (novice ≈ 0.6) |
| T2 | 0.50 | `[E]` interpolation |
| T3 | 0.40 | `[E]` interpolation |
| T4 | 0.30 | `[E]` interpolation |
| T5 | 0.25 | `[S: LIT_B §4.5]` (expert ≈ 0.25) |

- `feintQuality(A)` = A's striking-tier index (0–1) × composure factor; T0–T1 cannot feint at all (catalogue
  gate: feints unlock at T2 "1 kind", layered feints at T4 `[S: BOXING §6]`).
- `repeatPenalty` = 0.6^(consecutive feints without a strike − 2) for ≥ 3 consecutive feints ("over-feinting
  lets the opponent walk through" `[S: BOXING §5]`; 0.6 `[E]`).
- On a bite, B executes the defensive reaction its opponent model predicts (guard up → level-change lane opens;
  sprawl reaction → uppercut/knee lane opens: I-6 +15–25 % hit chance on the follow-up
  `[S: MMA_INTEGRATION §2.1 I-6 (est.)]`), and B's next read roll is skipped (draw still taken). On a
  non-bite, B's `expectedThreat` for that family drops by 30 % for 5 s `[E]` (they "walk through").
- Feint policy in the intent: "feints first, angles second, centre-line third" for pressure fighters
  `[S: MMA_INTEGRATION §3.3 P-2]`; the first feint is information, the second set-up, the third the entry
  `[S: BOXING §5]` — implemented as macro `feint → feint → entry` for T3+ and `feint → entry` for T2.

#### 2.4.6 Memory across bouts (career layer hook)

Tendency profiles observed in a bout are written back into the fighter's *scouting record of that opponent* for
rematches (first-fight winner repeats 63–66 % `[S: FIGHT_DATA #113]` is partly a skill effect; the sim should
not add more than a +2 pp plan-quality bonus for a rematch `[E]`). Owned by the career section; noted here so
the scouting input has a source.

### 2.5 Pre-fight game plan (strategic layer)

Real camps build plans from film (tendencies, entries, exits, what the opponent does hurt/tired), physical
mismatches and a short list of musts / must-nots `[S: MMA_INTEGRATION §6]` (Jackson, Zahabi, Wittman).

#### 2.5.1 Scouting inputs

```
ScoutingReport (about the opponent, as perceived by this fighter's camp):
  physical:   stance, reachM, heightM, massKg (fight-night), age, cardio tier, chin tier, power tier, speed tier
  skills:     tier per discipline + sub-skills relevant to matchup (tdOffence, tdDefence, clinch, bjjTop,
              bjjBottom, cageWork, striking defence)               // §01 schema
  tendencies: strike mix by family, mean combo length, pace by round, TD attempt rate and setup mix
              (naked / off strikes / off clinch), TD success by type, reaction to pressure (circle L/R,
              backs to cage, clinches), reaction when hurt (cover/shoot/clinch/run), pace drop when tired,
              scoring habits (control-heavy / volume), finish history by round
  familiarity: fights vs southpaws, vs wrestlers, vs pressure
  record:     wins/losses by method, streak, layoff days, short-notice flag
Own profile: same fields, without noise (a fighter knows himself; T0–T1 over-rate themselves, §2.5.3)
Context:     rounds (3/5), cage size, ruleset/judging regime, venue (home/away/altitude)
```
`[S: MMA_INTEGRATION §6.1]` for the field list; the record/layoff fields are added from
`[S: FIGHT_DATA §2.4]` (layoff ≥ 1 yr 35 %, short notice 37 %) so the plan can lower `riskAppetite` for the
compromised side.

**Scouting noise.** Each scouted tendency and tier = true value + N(0, σ_scout) with σ_scout by iqTier:
T1 30 %, T2 20 %, T3 12 %, T4 8 %, T5 5 % (relative) `[S: MMA_INTEGRATION §6.4 (est.)]`; T0 has no report
(all fields = "unknown", plan = none). Physical traits (reach, height, stance, mass) are always exact from T1
(they are visible at the weigh-in). Draws for scouting noise happen pre-bout in fighter-id order (§2.1).
Self-assessment: T0–T1 over-rate their own tiers by +1 tier when choosing a mode `[E]` (the novice
"obsession with offence" `[S: BOXING §6]`).

#### 2.5.2 Plan structure (machine form)

```ts
interface GamePlan {
  primaryMode:  Mode;                 // §2.5.3 mode table
  fallbackMode: Mode | null;          // switched to by adaptation (T2+)
  rangeTarget:  'long' | 'mid' | 'short';
  phaseTarget:  'distance' | 'clinch' | 'groundTop' | 'any';
  initiative:   'lead' | 'counter' | 'mixed';
  primaryWeapons:   ActionFamily[];   // <= 3, e.g. ['jab','teep','cross']
  secondaryWeapons: ActionFamily[];   // <= 3
  avoidList:        ActionFamily[];   // soft: w_plan 0.6
  mustNots:         MustNot[];        // hard-ish: c.mustnot (§2.2.2)
  actionWeights: Record<ActionFamily, number>;   // product of matchup rules, clamped [0.25, 3]
  tdPolicy:     'never' | 'reactive' | 'offStrikes' | 'chain' | 'any';
  clinchPolicy: 'avoid' | 'break' | 'accept' | 'seek' | 'wall';
  groundTopPolicy:    'standAndReset' | 'passByStrikes' | 'ride' | 'gnp' | 'subHunt';
  groundBottomPolicy: 'standUpFirst' | 'wallWalk' | 'sweep' | 'subHunt';
  cagePolicy:   'centre' | 'cut' | 'circleAway';
  roundPacing:  { round: number; paceTarget: number; tdAttemptTarget: number; riskAppetite: -2|-1|0|1|2;
                  finishSeeking: number }[];
  triggers:     Trigger[];           // §2.6.1 signal -> adjustment, with tier thresholds
  cornerScript: CornerCue[];         // <= 2 cues per round, overwritten live (§2.6.6)
  quality:      0|1|2|3|4|5;         // = iqTier (feature gating, §2.5.8)
  rationale:    PlanRationale[];     // human-readable rule hits for the UI panel and commentary
}
```
`[S: MMA_INTEGRATION §6.2]` (structure), extended with explicit policies so the utility layer needs no string
parsing.

**Mode ids** (`mode.*`):

| id | one-line definition |
|---|---|
| `mode.distance_striking` | fight at long/mid range behind straight strikes and kicks; deny entries |
| `mode.pressure_striking` | cut the cage, force exchanges on the fence, body work, volume |
| `mode.counter_striking` | make the opponent lead; delayed and intercepting counters |
| `mode.sprawl_and_brawl` | distance striking with anti-wrestling priorities (stuff, punish, get up) |
| `mode.wrestle_control` | strike to set up shots, take the centre, chain on the fence, ride and GnP |
| `mode.clinch_grind` | body-lock/collar-tie on the fence, knees/elbows, wear down, trips |
| `mode.submission_hunt` | get the fight down by any entry (including guard pull / front headlock), attack chains, back-takes |

#### 2.5.3 Generator algorithm

Runs pre-bout for each fighter with `iqTier >= 1`; T0 gets `plan = null` and fights on style weights only.

```
1. advantage vector  Δ = own − opp for: reachCm, speedTier, strengthTier, cardioTier, chinTier, powerTier,
                        boxing, kicking, tdOffence − oppTdDefence, tdDefence − oppTdOffence, clinch, bjjTop,
                        bjjBottom, cageWork; plus stancePair ∈ {closed, open}, massDiff %
2. mode fitness      F(m) = own(m) × oppWeak(m) × veto(m)          (table below)
3. primaryMode       T1: argmax own(m) only (ignores the opponent [S: MMA_INTEGRATION §6.4 "only obvious
                     attributes"]); T2+: argmax F(m); ties -> lower-variance mode for iqTier >= 3, finishing
                     mode for iqTier <= 2 or personality aggression >= 70 [S: MMA_INTEGRATION §6.3 step 2]
4. fallbackMode      T2+: second-best F(m) that is not the same family (striking vs grappling) if
                     F >= 0.6 × best, else the best of the other family [E]
5. actionWeights     product of all applicable rules in 2.5.4 (physical) + 2.5.5 (style) + 2.5.6 (stance),
                     clamped [0.25, 3.0]
6. mustNots          from opponent's best weapons (T2+): e.g. opp kick-catch rate high -> 'rearKickMidRange';
                     opp guillotine finish rate high -> 'headOutsideOnShots'; opp counter rate high ->
                     'leadWithHead'; opp BJJ tier >= own + 1 -> 'engageGuard'
7. pacing            by cardio Δ, rounds, division finish profile (2.5.7)
8. triggers          tier-gated subset of the adjustment table (2.6.1)
9. cornerScript      one technical cue per round from the highest-weighted rule, one affirmation [S: §6.3 step 7]
10. rationale        each rule hit appended with its multiplier for the UI panel
```

**Mode fitness table** (`s(x)` = sub-skill/100; `t(x)` = tier/5; all weights `[E]` unless tagged; the *shape* —
"largest ownStrength × oppWeakness product" — is `[S: MMA_INTEGRATION §6.3 step 2]`):

| mode | own(m) | oppWeak(m) | veto(m) = 0 when |
|---|---|---|---|
| distance_striking | mean(s.boxing, s.kicking) × (1 + 0.02 × max(0, ΔreachCm)) | 1 − 0.5 × s.oppStrikingDefence | opp tdOffence tier >= own tdDefence tier + 2 and own get-up tier <= 1 |
| pressure_striking | mean(s.boxing, s.clinch) × t(cardio) × (1 + 0.1 × max(0, −ΔreachCm / 5)) | 1 − s.oppCageWork | own cardio tier <= opp − 1 |
| counter_striking | s.boxing × s.strikingDefence × (0.7 + 0.3 × reactionTime / 100) | opp tendency `leads` share | opp is also a counter fighter → ×0.5 (both wait), not a veto |
| sprawl_and_brawl | mean(s.boxing, s.tdDefence) | t(opp.tdOffence) (only attractive if the opponent shoots) | — |
| wrestle_control | s.tdOffence × (0.6 + 0.4 × s.cageWork) | 1 − s.oppTdDefence | opp bjjBottom tier >= own bjjTop tier + 2 (then → clinch_grind) |
| clinch_grind | s.clinch × (0.5 + 0.5 × t(strength)) × (1 + 0.05 × massDiff %) | 1 − s.oppClinch | own cardio tier <= opp − 2 |
| submission_hunt | mean(s.bjjTop, s.bjjBottom) × (0.5 + 0.5 × s.tdOffence) | 1 − s.oppSubDefence | opp wrestling tier >= own + 1 **and** opp striking tier >= own + 1 (nowhere to enter) |

Ties toward the decision-safe mode for high IQ reflect Zahabi's "hedge exchanges so the worst case is
acceptable" `[S: MMA_INTEGRATION §6]` (recalled principle in the brief).

#### 2.5.4 Physical-advantage rules (weights entering `actionWeights`)

Research caveat, binding on calibration: **reach and height barely move win probability once fighters are
weight-matched; they change technique mix and where the fight happens** `[S: LIT_B §1 pt 1]`, `[S: LIT_B §2.4]`
(stature null, BF01 = 7; armspan trivial except heavyweight), `[S: LIT_B §2.5]` (reach shifts the finishing
punch toward straights, not the chance of winning). The plan rules below therefore only re-weight *selection*;
any hit-chance effect of reach lives in §02 and applies at long/mid range only (R-5). The whole system must
calibrate to: longer-reach fighter wins 51.7 % overall, ≈ 60 % in standing-heavy fights with >= 2.5 in, ≈ 63 %
at > 7 in, 49 % when >= 70 % on the ground `[S: FIGHT_DATA #116]`.

| rule | condition | selection weights | tags |
|---|---|---|---|
| R-1 long | ΔreachCm >= +5 | rangeTarget long; jab ×1.6; teep ×1.5; cross ×1.3; hook ×0.8; long-guard posture unlocked (block ×1.1 in §02; eye-poke risk ×2.4 in §06); circleAway ×1.4 vs pressure opp; clinchEntry ×0.6 | `[S: MMA_INTEGRATION §4.1 R-1 (est.)]` |
| R-2 long, invaded | ΔreachCm >= +5 and opp inside own optimal range | retreat-with-jab / pivot ×1.5 for 1–2 s then re-establish; hook exchanges ×0.5 | `[S: §4.1 R-2 (est.)]` |
| R-3 short | ΔreachCm <= −5 | feint ×1.5; slip/level-change entries ×1.6; body hook / uppercut on entry ×1.4; lowKick to lead leg ×1.3; clinchEntry ×1.3; shoot-off-strikes ×1.2; lateral movement ×1.3 (never stand at the end of the jab) | `[S: §4.1 R-3 (est.)]` |
| R-3b short, parry the long guard | ΔreachCm <= −5 and opp uses long guard | parry→step-in cross ×1.4; cagePolicy `cut` | `[S: §5.1 ST-2 (est.)]` applied to the long-guard case `[E]` |
| R-4 draw the lead | ΔreachCm <= −5, iqTier >= 3 | half-step retreat bait → step-in cross/overhand ×1.5 (macro) | `[S: §4.1 R-4 (est.)]` |
| R-5 scope | any | reach hit-chance modifier (§02) applies only at long/mid range; zero in clinch/ground | `[S: §4.1 R-5]` |
| R-6 height | Δheight without Δreach | no striking weight; clinch control +5 % for the taller/heavier (§03) | `[S: §4.1 R-6 (est.)]` |
| H-1 mass | fight-night mass Δ >= 3 % | clinch control +5 %, TD finish +5 % (in §03); strength tier is the main driver | `[S: §4.2 H-1 (est.)]`; `[S: LIT_B §6]` weight regain OR ≈ 1.05, cap ±5 pp |
| H-2 strength | strength tier >= opp + 1 | clinchEntry ×1.4; cage pin ×1.5; lean-on-fence drains opp 1.5× (§05); bodylock TD ×1.3; GnP damage ×1.15 (§05) | `[S: §4.2 H-2 (est.)]` |
| H-3 wear-down pacing | as H-2 | R1 pace ×0.9; clinch time target >= 60 s/round; R3+ pressure ×1.3 when opp f >= 0.5 | `[S: §4.2 H-3 (est.)]` |
| F-1 speed | speed tier >= opp + 1 | in-and-out macro ×1.5 (advance→strike→retreat <= 1.2 s); circle ×1.4; paceTarget ×1.3; breakClinch ×1.8; pocket dwell <= 1 s | `[S: §4.3 F-1 (est.)]` |
| F-2 avoid being held | speed adv and heavier opp | clinched > 3 s → breakClinch priority even at strike cost; on cage → wallWalk ×2 | `[S: §4.3 F-2 (est.)]` |
| C-1 cardio | cardio tier >= opp + 1 | R1 strike rate ×1.2, R1 TD attempts ×1.2 (force scrambles), pressure ×1.3 from R2 | `[S: §4.4 C-1 (est.)]`; late advantage is volume/control, not finishes (KD rate ×0.28 by R3 `[S: FIGHT_DATA #125]`) |
| C-2 cardio deficit | cardio tier <= opp − 1 | economy: strike rate ×0.8; single power shots ×1.2 early; clinch/scramble ×0.7; naked shots ×0.3 | `[S: §4.4 C-2 (est.)]` |
| P-V power vs volume | power tier >= opp + 1 and opp is a volume style | feint ×1.4; counter windows ×1.5; single heavy shots ×1.3; combo length <= 3; R1 pace ×0.8; body shots ×1.2; front-load finish attempts R1–R2 | `[S: §3.4 V-3, V-4 (est.)]`, `[S: FIGHT_DATA #125]` |
| V-P volume vs power | volume style vs power tier >= own chin tier + 1 | paceTarget >= 1.3 × opp; jab/teep/lowKick ×1.4; head-only ×0.8; pocket dwell <= 2 s, exit on angle | `[S: §3.4 V-1, V-2 (est.)]`; "fighter who throws more wins in every class" `[S: MMA_INTEGRATION §1]` |
| AG-1 age | own age > 34 | scouting fidelity σ_scout × 0.8 (plan quality up); speed/recovery penalties live in §01/§05 | `[S: §4.5 A-1 (est.)]`; direction from `[S: LIT_B §5.8]` (accuracy preserved, output falls) |
| L-1 compromised camp | own layoff >= 210 d or short-notice replacement | riskAppetite −1; R1 pace ×0.9 | `[E]` from `[S: FIGHT_DATA #123–#124]` (37 % / 41 % win rates; mechanism assumed to be conditioning and plan quality) |

#### 2.5.5 Style-matchup rules

| rule | side / condition | selection weights and policies | tags |
|---|---|---|---|
| S-1 | striker; opp tdOffence tier − own tdDefence tier >= 1 | rangeTarget long; teep ×1.4; jab ×1.4; rear-leg kicks ×0.4; lead lowKick ×0.8; uppercut/knee on level-change reaction ×1.8 | `[S: MMA_INTEGRATION §3.1 S-1 (est.)]` |
| S-2 | as S-1 | circleAway ×1.5 when own cage distance < 1.5 m | `[S: §3.1 S-2 (est.)]` |
| S-3 | as S-1, taken down | standUp/wallWalk ×2.0 for 8 s; submission-from-bottom ×0.5 unless own bjj tier >= opp + 1 | `[S: §3.1 S-3 (est.)]` |
| S-4 | as S-1 | combo length <= 3; no 4th strike at level-change distance; weight-back stance flag (sprawl +10 pts, punch power ×0.9 in §02/§03) | `[S: §3.1 S-4, §10 rule 8 (est.)]` |
| S-5 | as S-1 | clinchPolicy `break`; breakClinch ×1.8 with hit-on-the-break macro (+20–30 % hit chance in §03) | `[S: §3.1 S-5, §2.2 I-12 (est.)]` |
| W-1 | wrestler | tdPolicy `offStrikes`: shoot only after >= 1 strike in the prior 1 s unless opp balance < 0.5 or opp mid-kick (kick catch); naked shots ×0.4 | `[S: §3.1 W-1 (est.)]` |
| W-2 | wrestler | advance ×1.5; cagePolicy `cut`; when opp back within 1.5 m of cage: clinchEntry ×1.8, shoot ×1.4 | `[S: §3.1 W-2 (est.)]` |
| W-3 | wrestler on top | groundStrike ×1.3 in guard/half; pass ×1.4 after 2 landed ground strikes; control-gap target >= 3 min (70 % decision odds; 87 % at 5+) | `[S: §3.1 W-3]`, `[S: FIGHT_DATA #84]` |
| W-4 | wrestler, TD stuffed ×2 in a row | switch to clinch entries and cage chains for 60 s before shooting again | `[S: §3.1 W-4 (est.)]` |
| W-5 | wrestler pacing | TD attempts R1 ×1.2, R3 ×0.9 unless behind ("grapplers perform better in early rounds") | `[S: §3.1 W-5]` |
| WB-1 | wrestler vs BJJ tier >= own + 1 | groundTopPolicy `passByStrikes` / `standAndReset`; submission attempts ×0.3; never dive into guard after a knockdown; ride from half/side with wrist control | `[S: §3.2 WB-1 (est.)]` |
| WB-2 | wrestler, opp pulls guard | standUp + referee-stand-up loop or GnP from standing posture; do not pass at all costs | `[S: §3.2 WB-2]` |
| WB-3 | BJJ player taken down | sweep ×1.6 on top fighter's strikes; submission ×1.4 when top posture breaks; wallWalk ×0.8 unless > 6 ground strikes absorbed in 30 s | `[S: §3.2 WB-3 (est.)]` |
| WB-4 | BJJ player standing | clinchPolicy `accept` (clinchEntry ×1.3) to pull/trip/jump guard only if own wrestling tier < opp − 1; otherwise strike at range and hunt the front-headlock/guillotine on shots | `[S: §3.2 WB-4 (est.)]`; back-take → submission 0.45 at elite `[S: LIT_B §5.11]` makes the back the priority target |
| P-1 | pressure fighter | cagePolicy `cut`: steering target = opponent projected toward the nearest wall along its circling side, not its current position; advance ×1.5 along that line | `[S: §3.3 P-1]` |
| P-2 | pressure fighter | feints ×1.5 before committing | `[S: §3.3 P-2 (est.)]` |
| P-3 | pressure fighter, opp within 1 m of cage | combo length +1; body hook/bodyKick ×1.4; clinchEntry ×1.3 | `[S: §3.3 P-3 (est.)]` |
| P-4 | counter fighter | retreat/circle ×1.4; lead strikes ×0.7; counter-window strikes ×1.8; check-hook + pivot macro when within 1.5 m of cage | `[S: §3.3 P-4 (est.)]` |
| P-5 | counter fighter, 3+ consecutive exchanges on the cage | switch to lead initiative for 20 s to reset the centre | `[S: §3.3 P-5 (est.)]` |
| P-6 | both | aggression/cage control are tiebreakers only (§06); pure pressure without landed strikes does not win rounds — the `c.pace` consideration counts *landed*, not thrown | `[S: §3.3 P-6]` |
| SH-1 | submission hunter standing | entries ranked: front headlock on opp shot > clinch trip > guard pull (guard pull only if opp GnP tier <= own bjjBottom − 1) | `[E]` from WB-4 and the MMA bottom-priority consensus "stand up > sweep > submit" `[S: BJJ_POSITIONS §6]` |

The evidence base for pressure vs counter is indirect (no head-to-head study) `[S: LIT_B §7 pt 6]`; those
rules encode coaching consensus and are calibration-adjustable (Assumption A-1).

#### 2.5.6 Stance rules

Data: southpaw vs orthodox is 34–34 in matched UFC bouts; career edge ≈ +1.4 pp n.s.; any edge is a
*familiarity* effect `[S: MMA_INTEGRATION §5]`, `[S: LIT_B §3.13–§3.16]`. Target: ≈ 50/50 between equally
experienced fighters, ≈ 55/45 when the orthodox fighter is inexperienced vs southpaws
`[S: MMA_INTEGRATION §10 rule 11]`; population 76.6 / 17.1 / 6.1 % orthodox / southpaw / switch
`[S: FIGHT_DATA §2.4]`.

| rule | condition | selection side (here) | resolution side (§02, quoted for coherence) | tags |
|---|---|---|---|---|
| ST-1 lead-foot battle | open stance; `dominantAngle` = own lead foot outside opp lead foot (per tick from the stance geometry of §02 / positions of §09 P5) | circle toward the outside-foot side ×1.5 (orthodox steps left, southpaw right); `w_matchup` dynamic | rear straight +15 %, rear kick to open side +15 %, opp rear straight −10 % | `[S: MMA_INTEGRATION §5.1 ST-1 (est.)]` |
| ST-2 jabs collide | open stance | jab ×0.75 both; parry→cross counter ×1.4 (lead-hand fighting) | — | `[S: §5.1 ST-2]` |
| ST-3 down the middle | open stance | cross ×1.4; rear bodyKick to the open side (liver vs an orthodox from a southpaw's left kick, spleen side vice versa) ×1.4; lead hook ×1.1 when dominant | — | `[S: §5.1 ST-3]` |
| ST-4 range | open stance | rangeTarget +0.1 m both; clinchEntry ×0.9 | — | `[S: §5.1 ST-4]` |
| ST-5 familiarity | `stanceExposure[oppStance] < 3` fights (`[E]` threshold) | wrong-way circle with p = 0.15 per exchange (steering error); counter families ×0.9 | reaction +10 % (§2.4.1), counter accuracy −10 % | `[S: §5.1 ST-5 (est.)]`; T4+ immune `[S: LIT_B §3.15]` |
| ST-6 lead-leg kick | open stance with dominant angle | lowKick to lead leg ×1.3 | — | `[S: §5.1 ST-6 (est.)]` |
| ST-7 closed stance | same stance | jab ×1.2; lead hook ×1.1; rear lowKick ×1.1; rear bodyKick ×0.9; clinchEntry ×1.1; circling symmetric | — | `[S: §5.2 ST-7]` |
| ST-8 switching | fighter has `stance = switch` | `switchStance` action (0.3 s, 1 % stamina); weight ×1.5 when opp has landed 3+ strikes on the same side in 30 s or own lead leg is damaged; gated to T3+ (switching "at will" only at T5 `[S: BOXING §6]`) | during switch: defence neutral, TD vulnerability +15 %, low kick on the switching leg ×1.3 damage | `[S: §5.3 ST-8 (est.)]` |

Calibration note: open-stance bouts finish inside the distance 18 % more often `[S: FIGHT_DATA §2.4]`; the
straight-down-the-middle weights (ST-3) are the intended mechanism. Checked in §5.

#### 2.5.7 Pacing profile per round

`roundPacing[r] = { paceTarget, tdAttemptTarget, riskAppetite, finishSeeking }`:

- Baseline `paceTarget` = division SLpM target (FIGHT_DATA #11) × style factor; final round ×1.10 for all
  tiers >= T2 because standing low-intensity time falls from ≈ 154 s to ≈ 127 s (−17 %)
  `[S: FIGHT_DATA #127]`, `[S: LIT_B §3.3]`; high-intensity actions fall ≈ 8 % R1→R3 in kickboxing
  `[S: FIGHT_DATA #128]` — the realised output is set by fatigue (§05); the *intent* is +10 % `[E]`.
- `finishSeeking[r]` = finish budget share 0.53 / 0.30 / 0.15 (R1/R2/R3) `[S: MMA_INTEGRATION §10 rule 19]`,
  `[S: FIGHT_DATA #98]`; heavyweights ×1.4, women's strawweight ×0.5 `[S: MMA_INTEGRATION §10 rule 19]`.
- Cardio rules C-1/C-2 and H-3 multiply `paceTarget`; W-5 sets `tdAttemptTarget`.
- Composure: `composure < 40` → intended R1 pace ×1.3 for 120 s, then R2 output ×0.7
  `[S: MMA_INTEGRATION §7.6 (est.)]`. This is the same phenomenon as the adrenaline dump of §05
  (`dump = (1 − experience)(1 − composure) × eventMagnitude` `[S: DAMAGE_PHYSIOLOGY §4.6]`): §05 owns the
  energy cost and output effect, §07 owns only the *intended* pace (the fighter rushes). Do not double count
  (Assumption A-7).
- Elite fighters pace by internal cues and do not change pacing on false corner feedback
  `[S: MMA_INTEGRATION §7.6]` (Halperin 2019) → corner *pace* cues have uptake ×0.5 at T4+ (§2.6.6).

#### 2.5.8 Plan quality by iqTier

| iqTier | scouting fidelity | plan features | characteristic failure |
|---|---|---|---|
| T0 | none | no plan; style weights only; no mustNots; no pacing (rushes: dump) | fights the opponent's fight; empties the tank |
| T1 | size and "he's a wrestler" (σ 30 %) | `primaryMode` only, by own strength; no fallback; no mustNots; flat pacing | no adjustment mid-round; adrenaline-dump pacing |
| T2 | attributes + 1–2 tendencies (σ 20 %) | primary + fallback; 1–2 mustNots; pacing by round; 1–2 triggers | adapts only after a knockdown/takedown; abandons plan when hit |
| T3 | full tendency profile (σ 12 %) | full structure; 3–5 triggers; stance-aware | trigger latency 60 s; over-commits to primary mode |
| T4 | full (σ 8 %) + opponent's *adjustment* tendencies | multi-branch triggers; exploits known reactions (feints tuned to the opponent's flinch) | occasionally over-thinks (passivity: lead families ×0.9 for 20 s after a failed trap `[E]`) |
| T5 | σ 5 % + in-fight discovery within 30 s | as T4 + "plans for the opponent's plan": predicted fallback pre-loaded; cross-round traps | — |

`[S: MMA_INTEGRATION §6.4]` (features), `[S: MMA_INTEGRATION §6.4 (est.)]` (σ).

#### 2.5.9 Why plans fail (failure modes the sim must be able to produce)

1. Scouting wrong (tendency noise). 2. Plan needed an attribute the weight cut took (cardio) → collapses in R2.
3. Right plan abandoned when hurt (composure/IQ). 4. No fallback for the opponent's counter-adjustment (T <= 3).
5. Too safe: winning rounds without damage → loses to a late finish or a bad card. 6. Needed the fence and the
cage was 30 ft / the opponent's footwork denied it. `[S: MMA_INTEGRATION §7.8]`. Each is an observable case
in the §5 checks.

### 2.6 In-fight adaptation (tactical layer)

Fighters re-evaluate in *bursts* — after being hurt, after a takedown, at round breaks — not continuously
`[S: MMA_INTEGRATION §7.3]`. The tactical layer therefore runs on a cadence plus event triggers, and each
evaluation may or may not change the `Intent`.

```ts
interface Intent {
  mode: Mode;                       // current (primary, fallback, or an emergency mode)
  rangeTarget: 'long'|'mid'|'short';
  phaseTarget: 'distance'|'clinch'|'groundTop'|'getUp'|'any';
  initiative: 'lead'|'counter'|'mixed';
  paceTarget: number;               // strikes/min intended
  riskAppetite: -2|-1|0|1|2;
  cagePolicy: 'centre'|'cut'|'circleAway';
  tdPolicy; clinchPolicy; groundTopPolicy; groundBottomPolicy;   // as GamePlan
  focusWeapons: ActionFamily[];     // <= 3
  avoid: ActionFamily[];
  emergency: null | 'hurt' | 'finish' | 'survive' | 'stealRound' | 'needFinish';
  adjustments: Adjustment[];        // active, each { id, weights, dwellUntilTick, source: 'self'|'corner'|'plan' }
  perceivedScore: { roundsUp: number; sigma: number; lastRoundEstimate: -1|0|1 };
  effectiveIqTier: 0|1|2|3|4|5;
  since: tick;                      // for min-dwell and commentary
}
```

#### 2.6.1 Signals → adjustments table

Signals are computed from the exchange ledger (30 s window, §2.4.3) and the perceived state. Each adjustment
is a set of family multipliers (entering `w_adapt`) and/or a policy change, with a dwell timer.

| id | signal (window) | adjustment | min iqTier | tags |
|---|---|---|---|---|
| `adj.drop_family` | family hit-rate < 25 % over >= 6 attempts | that family ×0.6; feints ×1.3; best-hit-rate family ×1.3 | T3 (T4 trigger "hit-rate collapse") | `[S: MMA_INTEGRATION §7.2 (est.)]` |
| `adj.defend_family` | absorbed >= 2 heavy strikes from the same technique | defensive bias vs that technique (guard side / check / frame chosen with priority: §02 defence selection reads `intent.defendBias`); counter-window ×1.3 | T2 | `[S: §7.2 (est.)]` |
| `adj.td_stuffed_x2` | own TD stuffed ×2 in a row | wrestler: W-4 (clinch/cage chains 60 s); striker: rear kicks ×1.2 (confidence) | T2 | `[S: §7.2, §3.1 W-4 (est.)]` |
| `adj.taken_down_x2` | taken down ×2 | S-3 stand-up urgency ×2; kicks ×0.3; jab/teep ×1.3; cagePolicy `centre`; if plan was striking → mode `counter_striking` at long range | T2 | `[S: §7.2 (est.)]` |
| `adj.opp_tired` | opp pace −20 % vs its early pace, or tired cue | pressure ×1.3; combo length +1; clinch grind ×1.2 if strength >=; TD attempts ×1.2 | T2 (T1 via corner only) | `[S: §7.2 (est.)]` |
| `adj.opp_hurt` | opp rocked/knockdown perceived | finisher logic §2.6.5 | all (behaviour differs by tier) | `[S: §7.5]` |
| `adj.self_low_stamina` | own f >= 0.6 in R1/R2 (stamina < 40 %) | C-2 economy mode; clinch-to-rest if strength >= opp; kicks ×0.6; conserve for the last 60 s (recency) | T2 | `[S: §7.2 (est.)]` |
| `adj.behind_final` | perceived down 1 round entering the final round | SC-2 (§2.6.3) | T2 | `[S: §7.4]` |
| `adj.need_finish` | perceived down 2 (3R) / 3 (5R) | SC-3 | T2 | `[S: §7.4]` |
| `adj.ahead` | perceived ahead | SC-4 | T3 (T <= 2 ignore, matching the data average) | `[S: §7.4]` |
| `adj.cut_vision` | own cut/eye poke with vision penalty | retreat ×1.2 for 20 s; corner cue "get inside" if the lead-side eye is impaired | T1 | `[S: §7.2 (est.)]` |
| `adj.cage_trapped` | >= 3 exchanges on the cage in 30 s | P-5 lead-initiative reset 20 s (counter fighters); circle-off macro ×1.5 | T2 | `[S: §3.3 P-5 (est.)]` |
| `adj.opp_adjusted` | KL divergence of opp action distribution > 0.35 nats (§2.4.3) | re-run the mode fitness with the *observed* profile replacing the scouted one; may switch mode without waiting for the cadence | T5 | `[S: §7.3]` (T5 trigger), threshold `[E]` |
| `adj.leg_damaged` | own lead leg structural >= 30 (§05 thresholds) | switchStance ×1.5 (if switch); check ×1.4; kicks with that leg ×0.5 | T2 | `[S: DAMAGE_PHYSIOLOGY §7 rule 9]` thresholds; weights `[E]` |
| `adj.opp_leg_damaged` | opp lead leg structural >= 30 perceived | lowKick to that leg ×1.5; TD attempts ×1.2 (TD defence degraded at 55) | T2 | `[S: DAMAGE_PHYSIOLOGY §7 rule 9]`; weights `[E]` |
| `adj.trap_set` (T5 only) | opp has responded the same way >= 3 times to the same setup in the opponent model | macro: repeat setup → pre-loaded counter to the learned response (feint tuned to the flinch) | T5 (T4 within a round) | `[S: §6.4]` elite/generational features; count 3 `[E]` |

Each adjustment carries `dwellUntilTick = now + minDwell(iqTier)`; while dwelling, the same signal cannot revert
it (prevents oscillation). Contradicting adjustments: the newer wins, but only after its own dwell has been
satisfied by the older one.

#### 2.6.2 Evaluation cadence and P(change)

| iqTier | T_eval | event-triggered evaluations | P(change \| signal) | min dwell before revert |
|---|---|---|---|---|
| T0 | never (no tactical layer) | none — only the reflexive hurt behaviour (§2.6.4) | — | — |
| T1 | never mid-round; corner only | knockdown (either) | 0.30 | until the break |
| T2 | 90 s | + takedown (either) | 0.50 | 45 s |
| T3 | 60 s | + own TD stuffed ×2, being hurt | 0.70 | 30 s |
| T4 | 30 s | + hit-rate collapse | 0.85 | 20 s |
| T5 | 20 s | + opponent's adjustment detected | 0.95 | 15 s |

`[S: MMA_INTEGRATION §7.3 (est.)]`. The evaluation uses draw 3 (`u_eval < P(change)`); the fixed-draw rule
(§2.1) means a fighter that is not due still consumes the draw.

**Effective IQ.** `effectiveIqTier = iqTier − 1` while any of: structural damage > 60 % of the TKO threshold
(§05), f >= 0.7 (stamina < 30 %), within 20 s of a knockdown suffered `[S: MMA_INTEGRATION §7.3 (est.)]`.
Rocked adds a further −1 for its duration `[E]` (decision quality −40 % `[S: DAMAGE_PHYSIOLOGY §7 rule 6]`).
Floor T0. The effective tier selects the cadence row, P(change), σ of the score estimate, and the hurt/finisher
behaviours; the *plan* itself is not degraded (it is written down), only the ability to execute it. This
reproduces failure mode 3 of §2.5.9.

Empirical anchor for keeping the *evaluation function* fixed and adapting only the *policy*: victory factors
were stable across eras while tactics drifted `[S: MMA_INTEGRATION §7.3]` (Frontiers AI 2019).

#### 2.6.3 Score awareness

Evidence: under near-open scoring, fighters ahead did not coast; fighters behind attempted and landed fewer
takedowns and submissions with no change in strike volume — they shift toward the stand-up KO
`[S: MMA_INTEGRATION §7.4]` (Gift 2025); trailing fighters' TD / sub attempts −38 % / −49 %
`[S: FIGHT_DATA #129]`; only ≈ 15 % of finishes come in R3 `[S: FIGHT_DATA #98]`; a strike-count-only model
matches judges 77.8 % of rounds `[S: FIGHT_DATA #85]`; 10–8s are ≈ 8 % of judge-rounds
`[S: MMA_INTEGRATION §7.4]`, so a fighter down two rounds cannot plan on one.

- **SC-1 estimate.** `perceivedScore = trueRoundsUp (from §06 running cards) + N(0, σ_score)` sampled once per
  round end (fighter-id order, break step), σ_score by effectiveIqTier: T1 1.0, T2 0.7, T3 0.5, T4 0.3, T5 0.2
  rounds `[S: §7.4 SC-1 (est.)]`; T0 has no estimate (behaves as "even"). The corner halves σ at the break
  (§2.6.6). Judge-bias context (home crowd, reputation) is inside the true cards of §06 and is *not* known to
  the fighter.
- **SC-2 behind by 1 entering the final round** (`emergency = 'stealRound'`): paceTarget ×1.25; TD attempts
  ×0.8; riskAppetite +1; last-60-s volume ×1.3 `[S: §7.4 SC-2 (est.)]`. The TD reduction follows the data
  direction (−38 %) but is deliberately milder for the *one-round* deficit, where stealing the round on volume
  is the rational play; the full −38/−49 % applies in SC-3.
- **SC-3 behind by 2 (3R) / 3 (5R)** (`emergency = 'needFinish'`): power strikes ×1.5; TD ×0.6 (unless own
  submission tier >= opp bottom tier + 2 → TD ×1.3, submissions ×1.6); defensive families ×0.7; accept
  exchanges (pocket dwell limits off) `[S: §7.4 SC-3 (est.)]`. Realistically this is *stand-up KO hunting*
  (KO/TKOs are 3× more likely to start standing `[S: MMA_INTEGRATION §7.4]`) — not reckless grappling.
- **SC-4 ahead** (T3+ only): no coasting, riskAppetite −1; wrestlers: takedown-to-control ×1.2; strikers:
  counter mode ×1.2; shorter combos; cagePolicy `centre` `[S: §7.4 SC-4 (est.)]`. T <= 2 ignore SC-4 and keep
  fighting the same way (which is what the data shows on average `[S: §7.4]`).
- **SC-0 open scoring.** When the ruleset's `judgingMode` is `open`, σ_score = 0 for fighter and corner
  `[S: 09 §2.5]`; SC-2/3/4 then fire deterministically, matching the open-scoring rise in finishes by the
  fighter behind (28.5 % → 40 %) `[S: MMA_INTEGRATION §7.4]`.
- **Style hooks.** §01 `losingBehaviour` (`finishSeek`/`stealRound`/`unchanged`/`shell`/`gamble`) and
  `tiredBehaviour` (`clinchRest`/`coast`/`gamble`/`retreat`) select among the SC-2/SC-3 and `adj.self_low_stamina`
  variants; `unchanged` disables SC-2/3 for that fighter (the T <= 2 data-average behaviour) `[S: 01 §2.6]`.
- **SC-5 wrong estimates are a feature.** With σ = 1.0 a T1 fighter is often wrong about the cards; the UI
  panel shows both the true card and the fighter's belief (§2.6.7).

#### 2.6.4 Damage awareness — when hurt

On `state.rocked` or a knockdown suffered (§05), the tactical layer enters `emergency = 'hurt'` for 10–20 s
`[S: MMA_INTEGRATION §7.5 D-1 (est.)]` (duration drawn uniformly, draw 3 re-used at the event) with a survival
behaviour chosen by style and effective tier:

| profile | chosen behaviour (weights while hurt) | tags |
|---|---|---|
| wrestler / grappler | shoot or clinch ×2.0 (buys time; clinch and ground time count as recovery) | `[S: §7.5 D-1 (est.)]` |
| striker with footwork (cageWork tier >= T3) | circle-away ×2.0, jab-and-move, avoid the fence | `[S: §7.5 D-1 (est.)]` |
| effectiveIqTier <= T1 (any style) | cover up on the cage ×2.0 — the worst option; ground/cage pins follow | `[S: §7.5 D-1 (est.)]`, `[S: MMA_INTEGRATION §8]` "cover on fence" |
| effectiveIqTier >= T4 | clinch or level-change immediately (lowest KO-continuation risk) ×2.5; T5 may counter while hurt (counter families ×1.3 kept) | `[S: §7.5 D-1 (est.)]`, `[S: §8]` "counters while hurt" |
| inexperienced (experience < 0.3) | trading ×1.5 (the §05 note: "inexperience biases toward trading") | `[S: DAMAGE_PHYSIOLOGY §7 rule 6]` |
| style override | §01 `StyleProfile.hurtBehaviour` (`coverOnCage`/`clinch`/`shoot`/`circleOut`/`trade`/`counter`/`turnAway`), when set, replaces the profile row; `turnAway` = the T0 ground default (turns to belly under strikes 90 % of the time `[S: BJJ_POSITIONS §6]`); `heart` scales `P(shell/turn away \| rocked) = 0.5 × (1 − heart/100)` for T0–T2 | `[S: 01 §2.5–§2.6]` |

Recovery: acute head damage decays with t½ 8 s only while no head strike lands; a fighter who clinches or grabs
a leg typically exits rocked in 10–25 s `[S: DAMAGE_PHYSIOLOGY §3.4 (est.)]`; KO risk after a knockdown decays
over ≈ 20–30 s `[S: MMA_INTEGRATION §7.5 D-2 (est.)]`. The hurt state also applies `effectiveIqTier −1`,
`anxietyPen` (§2.4.4) and `q_rocked` (§2.2.4).

#### 2.6.5 Damage awareness — when the opponent is hurt (finisher logic)

On perceiving `opp hurt` (§2.4.2), `emergency = 'finish'`:

| finisher profile | behaviour | stop rule | tags |
|---|---|---|---|
| **reckless**: effectiveIqTier <= T2, or personality aggression >= 80 with composure < 50 | swing families ×2.0; defensive families ×0.5; stamina drain ×2 (§05 input); no balance floor | none (keeps swinging until the opponent recovers or the finisher gasses — gets countered vs good chins) | `[S: §7.5 D-3 (est.)]` |
| **measured**: effectiveIqTier >= T3 | straight punches and knees ×1.5; keep balance >= 0.6 (power strikes with balance cost gated); cut the cage; take the back/mount if the opponent shoots or covers; GnP within the referee window | stop when hit-rate on the hurt opponent < 40 % over 8 attempts → return to plan | `[S: §7.5 D-3 (est.)]` |
| **trap** (T5) | measured + one feint before the finishing strike (hurt fighters flinch: bite p +0.2) | as measured | `[S: §8]` "Finisher: traps"; +0.2 `[E]` |

Follow-up windows after a knockdown (grounded 1–3 s minimum, referee lag 3.5 s / 2.6 extra strikes) are §05's
`[S: DAMAGE_PHYSIOLOGY §7 rule 7]`, `[S: FIGHT_DATA #49]`; the AI's job is to *use* them: `groundStrike` ×3
on a downed hurt opponent for all tiers, with the D-4 ground preference: wrestlers ride and GnP, strikers stand
and strike or GnP from a posture that allows standing back up; never dive into the guard of a BJJ specialist
who is only slightly hurt `[S: §7.5 D-4]` (WB-1). Calibration anchor: KD → same-round KO/TKO 57 %
`[S: FIGHT_DATA #40]`; fighter scoring >= 1 KD wins 86 % `[S: FIGHT_DATA #42]`.

Tier finisher styles: T0–T2 reckless, T3 measured vs good chins (reckless vs chin tier <= T1), T4 measured, T5
traps `[S: MMA_INTEGRATION §8]`.

#### 2.6.6 Corner model (round breaks)

Corners perform diagnosis, strategy, implementation, affirmation, consolidation `[S: MMA_INTEGRATION §7.7]`
(Hjortborg 2026); good corners give one or two simple cues tied to what is already working (Wittman)
`[S: §7.7]`.

- **CO-1 cues.** At each break the corner emits <= 2 cues chosen from the adjustment table using the corner's
  ledger view (σ halved vs the fighter) plus a score estimate. P(cue is the *right* adjustment) by corner tier
  T1 0.40, T2 0.55, T3 0.70, T4 0.85, T5 0.95 `[S: §7.7 CO-1 (est.)]`. A wrong cue is a random other
  adjustment from the table (it still rewrites weights if accepted). Corner tier is a bout-setup input (default:
  the fighter's own iqTier − 1, floor T1 `[E]`).
- **CO-2 uptake.** P(accept) = 0.5 + 0.1 × max(0, fighterIqTier − 2) − 0.2 × [damage > 60 %] − 0.1 × [cue
  contradicts primaryMode] `[S: §7.7 CO-2 (est.)]`; pace cues ×0.5 at T4+ (§2.5.7). Accepted cues rewrite
  `w_adapt` for the next round with `source: 'corner'` and reset the dwell timer. Uptake by tier reproduces
  the brief's 0.5/0.6/0.7/0.8/0.9 ladder `[S: MMA_INTEGRATION §8]`.
- **CO-3 risk call.** The corner sets round `riskAppetite` from *its* σ-adjusted score (SC-2/3/4) and can call
  "you need a finish" only when that estimate supports it; low-tier corners are wrong about the score more
  often `[S: §7.7 CO-3]`.
- **CO-4 affirmation.** Composure +10 (0–100 scale) for the next round, no technical change `[S: §7.7 CO-4]`.
- **CO-5 retirement.** The corner-stoppage rule is §05's (`[S: DAMAGE_PHYSIOLOGY §7 rule 16]`); here it is only
  exposed as an event.
- Draw order in the break step, per fighter id: cue-1 correctness, cue-2 correctness, uptake-1, uptake-2,
  score-noise sample (SC-1) — 5 draws, always taken.

#### 2.6.7 Game-plan panel state (UI contract)

The tactical layer exposes a structured, serialisable object every tick (cheap: it changes only on events) so
the UI can render a "game plan panel" and the commentary can explain strategy:

```ts
interface GamePlanPanel {
  fighterId: string;
  plan: GamePlan | null;                       // pre-fight, with rationale[] (rule ids + multipliers)
  intent: Intent;                              // live
  activeAdjustments: { id: string; source: 'self'|'corner'|'plan'; sinceTick: number; untilTick: number;
                       label: string }[];
  belief: { perceivedRoundsUp: number; sigma: number; trueRoundsUp: number /* debug only */ };
  opponentModel: { context: string; topFamilies: [family, p][] }[];   // top-3 contexts by count
  reads: { attempts: number; successes: number; counters: number; feintBites: number };  // running
  emergency: Intent['emergency'];
  cornerLastCues: { text: string; correct: boolean /* debug */; accepted: boolean }[];
  mustNotViolations: { mustNot: string; tick: number }[];
  perceivedDamageSelf: number; perceivedDamageOpp: number;   // 0–1, from cues (§2.4.2)
  targeting?: MultiTargetPanel;                // §2.7 when N > 1
}
```
§09 §4.4's `FighterIntent` is the read-only projection of this object returned by `Sim.intents()`:
`plan.{primaryMode, fallbackMode, rangeTarget, mustNots, roundPacing}` map 1:1 (`strikeRateTarget` =
`paceTarget`); `live.currentMode` = `intent.mode`, `live.sinceTick` = `intent.since`, `live.lastTrigger` = the
newest of `activeAdjustments` (`signal` = its source signal id, `adjustment` = its `adj.*` id),
`live.perceivedScore` = `belief.perceivedRoundsUp`, `live.effectiveIQ` = `intent.effectiveIqTier`,
`live.cornerCues` = `cornerLastCues` (`takenUp` = `accepted`).
Debug-only fields are stripped from the player-facing panel by the UI (§08 §7.6) — the fighter's *belief* is shown;
the truth is shown only in the analytics/model tab.

### 2.7 Multi-opponent AI (1vN, teams, free-for-all, crowd)

Kept from the current engine: 2-D geometry, fan-out, soft teammate repulsion, `engagedBy` counting within
1.7 m, `swarmStaminaPenalty`, `focusPenaltyLogit`, and the `1/√engagedBy` defensive cover
`[S: docs/AUDIT.md §1.1]`. Replaced: "attack the nearest" targeting and the absence of threat management,
flanking, roles and free-for-all.

Evidence base (all weak or indirect; every number below is an anchored prior — Assumption A-9):
- At most 2 attackers strike a single defender effectively at once; violent subgroups are 3–6 people; groups
  attack isolated/stumbling individuals; police doctrine is stacking/funnelling `[S: FIGHT_DATA §6.4 pt 1]`.
- Non-fighter share of a hostile group: 0.19 in "bursts", 0.49 otherwise; a burst (>= half the group joins
  within 2 s) occurs in 39 % of groups; predicted participation threshold 1/3 `[S: FIGHT_DATA §6.2]` (Weenink
  & Bruggeman).
- Untrained one-on-one fights: mean ≈ 45 s, only 20 % > 1 min, KOs mostly inside 30 s, fights > 1 min seldom
  have a clear winner; ≈ 23–25 % end in KO, 64 % of those inside 10 s; ≈ 48 % end indecisively
  `[S: FIGHT_DATA §6.3, §6.1]` (weak video samples).
- Going to the ground when outnumbered is catastrophic: kicks are the injury mechanism most likely to need
  admission; the fatal mechanism in one-punch deaths is the head hitting the ground `[S: FIGHT_DATA §6.4 pt 3]`.
- Bystanders intervene in 9 of 10 public conflicts, mostly to de-escalate; 26 % of filmed fights had a third
  party join, 68 % of those a "friend jumps in" `[S: FIGHT_DATA §6.2, §6.1]`.
- Alcohol in ≈ 64 % of stranger violence `[S: FIGHT_DATA §6.2]`.
- No dataset on trained-vs-multiple-untrained outcomes exists `[S: FIGHT_DATA §6.3]`; the "500 encounters"
  figures are unverified and must not be used `[S: FIGHT_DATA §6.2]`.

#### 2.7.1 Threat assessment

Every tick each fighter `i` scores every hostile `j` within `R_aware` = 6 m `[E]`:

```
threat(i,j) = 0.35 × prox      // prox = clamp(1 − (d_ij − 0.5) / 3.0, 0, 1)
            + 0.20 × facing    // 1 if j's heading is within ±45° of i, else 0.3
            + 0.20 × danger    // j's perceived power/skill tier index (0–1), ×1.5 if j has landed on i in the last 10 s
            + 0.15 × approach  // closing speed toward i, normalised to 2 m/s
            + 0.10 × freeHands // 1 if j is not engaged with someone else, 0.4 if j is mid-technique on another target
```
Weights `[E]`; the *ordering* (proximity and facing first, then who has hurt you) follows the police-doctrine
priority "the one who can reach you now" `[S: FIGHT_DATA §6.2]` (expert opinion). Perception delay (§2.4.1)
applies to `j`'s position and heading; `danger` uses the scouted tier where a scouting report exists (teams) or
a visible-size proxy (crowd: mass and height, `[E]`).

`opportunity(i,j)` = 1 if `j` is hurt/rocked, 0.6 if `j` is tired, 0.3 if `j` is facing away, else 0.

#### 2.7.2 Target selection policies (`tgt.*`)

| id | rule | used by | tags |
|---|---|---|---|
| `tgt.nearest` | argmin distance | T0–T1 in any mode; crowd default | `[S: docs/AUDIT.md §1.1]` (current behaviour, kept as the novice policy) |
| `tgt.most_dangerous` | argmax threat | T2+ when own `engagedBy` >= 2 or own damage > 40 % (defensive posture) | `[E]` |
| `tgt.weakest` | argmax opportunity × (1 − 0.5 threat) | T2+ when own threat sum < 0.5 (predator behaviour: groups attack the stumbling/isolated) | `[S: FIGHT_DATA §6.2]` (Collins) qualitative |
| `tgt.assigned` | team coordinator's assignment (§2.7.4) | teams T2+ | `[E]` |
| `tgt.leader` | argmax perceived tier among hostiles (target leadership, cause visible injury) | outnumbered T3+ when a clear lane exists | `[S: FIGHT_DATA §6.2]` police doctrine (expert opinion) |

Switching hysteresis (draw 7): switch only if `score(new) > 1.25 × score(current)` and the current target has
been held >= 1.5 s, or immediately if the current target is downed/incapacitated/fled or a new hostile lands on
me `[E]`. Target switches are commentary events (`evt.target.switch`).

#### 2.7.3 The outnumbered fighter

When `hostilesWithin(3 m) >= 2`, the tactical layer forces `mode.outnumbered` (overrides the game plan) with:

| behaviour | rule | tags |
|---|---|---|
| **keep them in a line** | steering objective = minimise the angular spread of hostiles within 3 m as seen from self (choose the movement direction among 8 candidates that yields the smallest max-angle between hostile bearings, subject to cage bounds); ties → move away from the centroid | `[S: FIGHT_DATA §6.2]` (stacking doctrine; Krav Maga "line attackers up so only one can engage") — implementation `[E]` |
| **use the fence/corner** | if no lane to keep them in a line exists (spread > 120° for > 1 s) and cage distance > 1 m: back to the fence at the point that maximises the minimum bearing gap (a corner in a ring; the fence in a cage) — accept `cage contact` penalties to deny the rear | `[E]`; the fence trade-off (denies flank, forbids retreat) is the design rationale |
| **never go to the ground** | `shoot`, `clinchEntry`-to-trip, and guard pulls ×0.05; if downed: `standUp`/`wallWalk` ×3.0 and no submission attempts; when grounded with >= 1 standing hostile the §05 downed-defender multiplier applies | `[S: FIGHT_DATA §6.4 pt 3]`; weights `[E]` |
| **strike and move** | after any committed strike, `retreat`/`circle` ×2.0 for 1.0 s; combos capped at 2; prefer straight strikes and front kicks (range) ×1.4; hooks ×0.7 | `[S: FIGHT_DATA §6.2]` "stay mobile"; weights `[E]` |
| **clinch only as a shield** | clinch entry allowed only to put the clinched hostile between self and the others (`c.shield` = 1 if the clinch partner would occlude >= 1 other hostile's line) ×1.5; break within 2 s otherwise | `[E]`; "putting assailants between each other" `[S: FIGHT_DATA §6.2]` |
| **cause visible injury early** | `opportunity` weight ×1.5 for the first 15 s (drop one, deter the rest: "as little as 14 seconds can make the difference") | `[S: FIGHT_DATA §6.2]` (expert opinion); 15 s `[E]` |
| **flight** | a `flee` action exists in crowd/street rulesets (exit toward the arena boundary/exit point); utility rises with own damage, hostiles count, and time since last landed strike; T0–T1 civilians flee readily, trained fighters later (§2.7.6) | `[S: FIGHT_DATA §6.3]` (fights end by flight/incapacitation; > 1 min seldom a clear winner) |

Existing engine constants remain: `focusPenaltyLogit` per extra engaged attacker and `1/√engagedBy` cover;
the count feeding them is capped at 2 effective attackers plus 0.3 per fringe attacker `[E]` per
`[S: FIGHT_DATA §6.4 pt 1]`.

#### 2.7.4 Teammate coordination (by discipline and tier)

A team has a *coordinator* (highest iqTier member) that assigns roles each `T_eval(coordinator)` and on events;
assignments enter members' targeting as `tgt.assigned` and their utility as `w_multi`.

| tier of team | coordination | roles | tags |
|---|---|---|---|
| T0 crowd | none; each member uses `tgt.nearest`; engagement obeys the **burst** model: a member commits when >= 1/3 of the group is already committed (participation threshold) or on a trigger (friend hit); non-fighter share 0.19 in bursts / 0.49 otherwise, sampled per member pre-bout | `[S: FIGHT_DATA §6.2]` Weenink; assignment `[E]` |
| T1 | "swarm": all engage the same target (nearest to the group centroid); no flanking; get in each other's way (repulsion kept) | `[E]` |
| T2 | **flank**: second attacker steers to a bearing >= 90° from the first attacker's bearing on the shared target; third+ takes the `fringe` role (waits at 2.5 m, enters on a knockdown/turn) | `[S: FIGHT_DATA §6.4 pt 1]` (<= 2 effective) ; 90° `[E]` |
| T3 | + **take turns** vs a skilled target: the engaged attacker disengages after 6 s or when f >= 0.5, the fringe attacker enters (keeps the defender working; drains him via `swarmStaminaPenalty`) | `[E]` |
| T4–T5 | + **one holds, one hits**: if a member's wrestling/clinch tier >= target's tdDefence tier, he is assigned `hold` (clinch/body lock, cage pin); the striker is assigned `hit` (free strikes on a held target: defence `def.neutral` for the held fighter vs the second attacker) | `[E]`; "screening/stacking" and "redirecting momentum" doctrine `[S: FIGHT_DATA §6.2]` |
| any | **protect a downed teammate**: a member whose teammate is downed and being struck switches to `tgt.most_dangerous` on the striker | `[E]`; third-party "friend jumps in" 68 % `[S: FIGHT_DATA §6.1]` |

Discipline flavour: wrestler/judoka members prefer `hold`; strikers `hit`; BJJ members with a held target
prefer back-take (rear position on a held opponent) only if no third hostile is within 3 m (never on the
ground otherwise) `[E]`.

#### 2.7.5 Free-for-all

Every fighter evaluates threat and opportunity over *all* others. Rules that produce realistic FFA behaviour:
- Fighters pair off: `w_multi(engage j)` ×0.5 if `j` is already engaged by someone else who is not hurt
  (avoid the middle of someone else's exchange) — small subgroups fight while others watch
  `[S: FIGHT_DATA §6.2]` (Collins).
- Opportunism: `opportunity(i,j)` ×1.5 when `j` is engaged with a third fighter and facing away from `i`
  (free hits); T3+ exploit this, T0–T1 do not track it (they use `tgt.nearest`) `[E]`.
- Last-two: when only two remain, the normal 1v1 tactical layer resumes with a fresh evaluation and the
  fighters' current fatigue/damage.
- Switching uses the same hysteresis as §2.7.2.

#### 2.7.6 Street / crowd dynamics

Applies when the ruleset is `street` (no referee, no rounds, boundary = scene exit, weapons off in v1):
- **Durations**: the sim should produce untrained 1v1 fights with median < 60 s, ≈ 20 % > 1 min, and ≈ 45–50 %
  indecisive ends (separation by bystanders, mutual flight) `[S: FIGHT_DATA §6.3, §6.1]`; ≈ 25 % KO with ≈ 64 %
  of those inside 10–30 s — these are §5 checks, produced by: T0 temperature 1.0, burst output (15–25/min for
  <= 20 s then collapse `[S: FIGHT_DATA §5]`), no chin conditioning (§05), and the `flee` utility.
- **Flight utility**: `U(flee) = 0.2 + 0.5 × ownDamageNorm + 0.15 × max(0, hostiles − 1) + 0.1 × [no strike
  landed in 15 s] − 0.3 × trainedIndex − 0.2 × [friend present]` `[E]`; it is scored with everything else, so a
  landed knockdown by the defender flips the attackers' flight utility (deterrence) via the `ownDamageNorm` and
  `friend downed` terms (+0.3) `[E]`.
- **Bystander model**: at fight start, with p = 0.9 at least one non-hostile bystander exists
  `[S: FIGHT_DATA §6.2]`; each bystander has `intervene` (de-escalate: step between; probability rises with
  bystander count) and `join` (p = 0.26 per fight that some third party joins, 68 % as a friend of one side
  `[S: FIGHT_DATA §6.1]`); a successful de-escalation ends the fight "indecisively".
- **Impairment**: hostile crowd members are `impaired` with p = 0.64 `[S: FIGHT_DATA §6.2]` (alcohol): τ ×1.3,
  accuracy −10 %, balance −15 %, pain response −20 % `[E]`.
- **Ground = catastrophe**: §05's downed-defender multiplier and the one-punch fall mechanism (secondary head
  impact) are why `standUp` ×3 and `flee` dominate for a downed fighter.
- **Engagement geometry**: engaged slots max 2, fringe queue for the rest `[S: FIGHT_DATA §6.4 pt 1]`.

#### 2.7.7 Multi-target panel

```ts
interface MultiTargetPanel {
  target: string | null; policy: 'nearest'|'most_dangerous'|'weakest'|'assigned'|'leader';
  threats: { id: string; threat: number; opportunity: number }[];
  role: 'solo'|'engage'|'flank'|'fringe'|'hold'|'hit'|'protect'|'flee'|'bystander';
  lineQuality: number;           // 1 − angularSpread/π for the outnumbered fighter
}
```

### 2.8 Commentary and strategy events

The AI emits typed events (recorded in the event log, replay-safe) so §09 §5 play-by-play can explain strategy.
Each carries `tick`, `fighterId`, a payload and a `template` for the default line.

| event id | when | payload | default template |
|---|---|---|---|
| `evt.plan.set` | pre-bout | `plan` summary + `rationale[]` | "{name}'s plan: {mode} — {topRule} ({multiplier})" e.g. "keep it long behind the jab and teep; never kick with the rear leg at mid range" |
| `evt.intent.change` | intent mode/range/initiative changed | old, new, `signal` id, `source` | "{name} has switched to {newMode} after {signalLabel}" |
| `evt.adjust.applied` | adjustment activated | `adj.*` id, weights, source | "{name} is going to the body — the head shots aren't landing" |
| `evt.adjust.expired` | dwell ended / reverted | id | (silent unless reverted early) |
| `evt.read.success` | read + counter triggered | technique read, counter chosen | "{name} saw that coming — slipped the cross and countered" |
| `evt.feint.bite` / `evt.feint.ignored` | feint resolved | feint family, reaction | "{opp} bit on the level-change feint, and {name} came up with the uppercut" |
| `evt.range.control` | fighter holds intent range >= 10 s vs an opponent whose intent range differs | own reach adv, tool | "{name} is using the long guard to keep the shorter fighter at the end of the jab" |
| `evt.cage.cut` | pressure fighter drives opponent to the fence (opp cage distance < 1 m after `cut` policy) | — | "{name} cut the cage off and put {opp} on the fence" |
| `evt.mustnot.violated` | fighter executes a mustNot action (T1–T2 slips) | mustNot id | "That's exactly what his corner told him not to do — rear kick in front of the wrestler" |
| `evt.score.belief` | round end | perceivedRoundsUp, sigma, (debug) true | "{name} thinks he's up a round; the cards may say otherwise" |
| `evt.emergency.enter` / `.exit` | hurt / finish / stealRound / needFinish / survive | kind, chosen behaviour | "{name} is hurt and looking to clinch" / "{name} knows he needs a finish — he's headhunting" |
| `evt.finish.mode` | finisher profile chosen | reckless / measured / trap | "He's staying measured — straight punches, not swinging wild" |
| `evt.corner.cue` | break | cue text, accepted (debug: correct) | "The corner wants the jab — 'it's your jab that's going to break him'" |
| `evt.corner.affirm` | break | composure delta | (colour line) |
| `evt.pace.shift` | intended pace changes >= 20 % | old, new, reason | "{name} is picking up the pace in the final round" |
| `evt.stance.switch` | ST-8 | reason | "{name} switched to southpaw to protect that lead leg" |
| `evt.target.switch` | multi | old, new, policy | "{name} has turned to the bigger threat" |
| `evt.role.assign` | team | role | "{name} is holding, {teammate} is hitting" |
| `evt.line.formed` / `.broken` | outnumbered | lineQuality | "He's backed to the fence and got them lined up" |
| `evt.flee` | street | — | "{name} has had enough — he's out of here" |
| `evt.trap.set` / `evt.trap.sprung` | T5 | setup, response | "He showed that jab-level-change three times for a reason" |

The template strings are defaults; §09 §5.3 owns the final commentary grammar. All events are pure functions of
recorded state (no RNG at emission).

### 2.9 Ids introduced in this section

| id family | members | definition |
|---|---|---|
| `mode.*` | distance_striking, pressure_striking, counter_striking, sprawl_and_brawl, wrestle_control, clinch_grind, submission_hunt, outnumbered | tactical mode (§2.5.2, §2.7.3) |
| `emergency.*` | hurt, finish, survive, stealRound, needFinish | overriding tactical state (§2.6) |
| `adj.*` | drop_family, defend_family, td_stuffed_x2, taken_down_x2, opp_tired, opp_hurt, self_low_stamina, behind_final, need_finish, ahead, cut_vision, cage_trapped, opp_adjusted, leg_damaged, opp_leg_damaged, trap_set | adjustments (§2.6.1) |
| `c.*` | range_fit, range_target, own_fatigue, opp_fatigue, own_damage, opp_hurt, cage, round_time, setup, expected_threat, opp_recovery, balance, position_value, risk, mustnot, pace, dwell, shield, lookahead | utility considerations (§2.2.2) |
| `tgt.*` | nearest, most_dangerous, weakest, assigned, leader | target policies (§2.7.2) |
| `role.*` | solo, engage, flank, fringe, hold, hit, protect, flee, bystander | multi-opponent roles (§2.7.4) |
| `evt.*` | see §2.8 | strategy events |
| new actions required from §02/§03/§09 | `tech.feint_*` (jab, rear_hand, level_change, step, kick), `switchStance`, `wallWalk`, `hitOnBreak` (chained), `flee` (street), `cageProximity` field | `[S: MMA_INTEGRATION §10 rule 1]` + `flee` `[E]` |

---

## 3. Behaviour by skill tier (fight IQ)

What visibly changes with `iqTier` (blended with the phase discipline tier per §2.2.4). Direction anchored on
`[S: MMA_INTEGRATION §8]`, `[S: BOXING §6]`, `[S: WRESTLING §7]`, `[S: BJJ_POSITIONS §6]`; the numeric
mappings are §2's parameters.

| dimension | T0 brand new | T1 beginner | T2 amateur | T3 regional pro | T4 elite | T5 champion |
|---|---|---|---|---|---|---|
| Plan | none; style weights only | one line ("box him") by own strength; no fallback | primary + fallback, 1–2 mustNots, round pacing | full plan, 3–5 triggers, stance-aware | multi-branch, exploits known reactions | + plans for the opponent's plan; cross-round traps |
| Scouting σ | — | 30 % | 20 % | 12 % | 8 % | 5 % |
| Adaptation | none (reflex only) | corner-only; knockdown | 90 s; after KD/TD; abandons plan when hit | 60 s; + stuffed TDs, hurt | 30 s; + hit-rate collapse | 20 s; + opponent's adjustment; discovery within 30 s |
| P(change \| signal) | — | 0.30 | 0.50 | 0.70 | 0.85 | 0.95 |
| Temperature τ | 1.00 | 0.80 | 0.60 | 0.45 | 0.35 | 0.28 |
| Pattern recognition (opponent model) | none | τ_mem 20 s, prior 2 | 40 s, 4 | 60 s, 8 | 90 s, 12 | 120 s, 16 + trap building |
| Anticipation p_read | 0.50 | 0.58 | 0.68 | 0.75 | 0.83 | 0.87 |
| Counter-on-read | 0.02 | 0.05 | 0.15 | 0.25 | 0.40 | 0.50 |
| Feint bite | 0.65 | 0.60 | 0.50 | 0.40 | 0.30 | 0.25 |
| Feints available | none | none | 1 kind | set-up chains, cage cutting | layered feints, delayed counters, rhythm breaks | everything, chosen per opponent |
| Range management | stands at the end of the opponent's reach | knows own range, forgets it when pressured | fights planned range most of the time | manipulates range with feints | controls range and the opponent's perception of it | — |
| Level-change hygiene | kicks with the rear leg vs wrestlers | same; stops kicking only after being taken down | follows S-1 | uses kicks as bait for counters (I-6) | off the opponent's tendencies | — |
| Cage awareness | backs straight up (`c.cage` weight ×0.3) | circles, wrong way vs southpaw (ST-5) | circles correctly, still gets caught | rarely on the fence; escapes on angles | uses the fence offensively | — |
| Takedown setup | naked shots (W-1 off) | off a single strike | off combinations | off feints and reactions | off tendencies | — |
| Getting up | turtles / covers | wall walk late | wall walk immediately | never lets the top fighter settle | stand-up leads into offence | — |
| Score awareness σ | none | 1.0 (corner-driven) | 0.7 | 0.5 | 0.3, adjusts last 60 s | 0.2, plans rounds |
| Hurt behaviour | cover on the fence | clinch (grabs and holds) | clinch/shoot | clinch or angle out | counters while hurt | — |
| Finisher | reckless | reckless | reckless (measured vs poor chins only) | measured | measured | traps |
| Corner uptake | 0.5 | 0.5 | 0.5 | 0.6 | 0.7 | 0.8 (pace cues ×0.5) |
| Composure (typical) | very low (dump ≈ 0.6–0.9) | low | moderate | moderate-high | high | very high |
| Tells (execution layer) | telegraph ×1.6, eyes closed 35 %, square stance 30 %, target error 10 % | ×1.4, 15 %, 10 %, 6 % | ×1.2, —, —, 3 % | ×1.0, 1.5 % | ×0.85, 0.8 % | ×0.7, 0.5 % |
| Combination cap | 1–2 | 2 | 3 | 3–4 | 4 | 4 with branch/abort |
| Ground decision latency (§04) | 4–8 s between edge attempts | 3–5 s | 2–4 s | 1.5–3 s | 1–2 s | 1–2 s |

The tier table is the *default*; personality (§01 §2.5) shifts rows using §01's formulas: `adaptability`
scales `P(change | signal) = base(iqTier) × (0.7 + 0.6 × adaptability/100)`, clamp <= 0.98; `discipline` sets
`P(abandon plan when hit) = 0.6 × (1 − discipline/100)` and the mustNot violation rate
`0.3 × (1 − discipline/100)` per opportunity (which is what `c.mustnot` realises); `aggression` sets the
initiative split `attackShare = 0.33 + 0.30 × (aggression − 50)/50` and the pace multiplier; `composure` scales
the dump, the rocked decision penalty and the anxiety read penalty `[S: 01 §2.5]`; `aggression >= 80 &
composure < 50` forces the reckless finisher (§2.6.5) `[E]`.

---

## 4. Parameter registry

All become `src/engine/params/ai.ts`. Units: `×` = multiplier on a selection weight; `s` seconds; `p`
probability; `logit` logit units; `t` ticks. Vector values are listed T0…T5 or R1/R2/R3 in order. `(est.)`
values are research-side estimates (Assumption A-1).

| id | value | unit | tag |
|---|---|---|---|
| **architecture** | | | |
| `ai.rng.draws_per_tick` | 6 (7 with multi-opponent) | count | `[E]` |
| `ai.utility.clamp` | [0.25, 3.0] | × | `[S: MMA_INTEGRATION §10 rule 22]` |
| `ai.utility.compensation` | √n form | — | `[E]` (IAUS principle `[S: LIT_C §2]`) |
| `ai.style.weight_range` | [0.5, 2.0] | × | `[E]` |
| `ai.style.jitter_sd` | 0.10 (replaces `tendencySd` 0.22) | log-normal σ | `[E]` |
| `ai.temp.tier` | 1.00 / 0.80 / 0.60 / 0.45 / 0.35 / 0.28 | τ | `[E]` |
| `ai.temp.phase_iq_blend` | 0.5 | fraction | `[E]` |
| `ai.q.fatigue` | 0 @ f<=0.2; 0.15 @ 0.5; 0.35 @ 0.8; cap 0.5 | fraction | `[S: DAMAGE_PHYSIOLOGY §4.3 (est.)]`; zero-point `[E]` |
| `ai.q.rocked` | 0.40 | fraction | `[S: DAMAGE_PHYSIOLOGY §7 rule 6]` |
| `ai.q.dump` | 0.20 × dump, first 150 s of R1 | fraction | `[S: DAMAGE_PHYSIOLOGY §4.6]` |
| `ai.q.second_wind` | +0.10 for 60 s | fraction | `[S: DAMAGE_PHYSIOLOGY §4.5]` |
| `ai.combo.cap.tier` | 2 / 2 / 3 / 4 / 4 / 4 | strikes | `[S: BOXING §6]` qualitative; numbers `[E]` |
| `ai.combo.cap_vs_wrestler` | 3 | strikes | `[S: MMA_INTEGRATION §3.1 S-4 (est.)]` |
| `ai.combo.max_any` | 4 | strikes | `[S: MMA_INTEGRATION §6]` (Wittman) |
| `ai.mcts.enabled` / `playouts` / `horizon` / `budget_ms` | false / 64 / 3–5 t / 2 | — | `[S: LIT_C §2]`; disabled `[E]` |
| **execution quality** | | | |
| `ai.exec.tele_mult.tier` | 1.6 / 1.4 / 1.2 / 1.0 / 0.85 / 0.7 | × | `[E]` |
| `ai.exec.tele_fatigue` | 0.5 (× (1 + 0.5 f)) | — | `[E]` |
| `ai.exec.p_ontime.tier` | 0.55 / 0.65 / 0.75 / 0.85 / 0.92 / 0.95 | p | `[E]` |
| `ai.exec.p_ontime_fatigue` | −0.15 f | p | `[E]` |
| `ai.exec.late_share` | 0.75 (late) / 0.25 (early) | p | `[E]` |
| `ai.exec.k_accuracy` | 0.6 | logit | `[E]` |
| `ai.exec.accuracy_fatigue` | −18 % @ f = 0.8 (linear) | fraction | `[S: DAMAGE_PHYSIOLOGY §4.3 (est.)]` |
| `ai.exec.target_error.tier` | 0.10 / 0.06 / 0.03 / 0.015 / 0.008 / 0.005 | p | `[E]` |
| `ai.exec.overcommit` | p 0.40 (T0) / 0.25 (T1); power ×1.15; balance −0.2 | — | `[E]` |
| `ai.exec.stance_break_p` | 0.30 (T0) / 0.10 (T1) / 0 | p per movement tick | `[E]` |
| `ai.exec.eyes_closed_p` | 0.35 (T0) / 0.15 (T1) / 0 | p per exchange | `[E]` |
| **perception** | | | |
| `ai.percept.base_ms.tier` | 300 / 300 / 200 / 200 / 100 / 100 | ms | `[S: 09 §2.5 (E)]` (owned jointly; §09 plumbing) |
| `ai.percept.reaction_slope` | −1 ms per `reactionTime` point above 50 | ms | `[S: 09 §2.5 (E)]` |
| `ai.percept.fatigue_ms` | +50 @ f >= 0.7 | ms | `[S: 09 §2.5 (E)]`, direction `[S: LIT_B §4.7]` |
| `ai.percept.rocked_ms` | +150 | ms | `[S: 09 §2.5 (E)]` |
| `ai.percept.familiarity_ms` | +20 (T0–T3, exposure < 3) | ms | `[S: MMA_INTEGRATION §5.1 ST-5 (est.)]` |
| `ai.percept.hurt_cue_p` | p_read(tier); T0 0.5 | p per tick | `[E]` |
| `ai.percept.tired_cue_pace_drop` | 0.20 | fraction | `[S: MMA_INTEGRATION §7.2 (est.)]` |
| `ai.oppmodel.laplace_alpha` | 1 | count | `[S: LIT_C §2]` |
| `ai.oppmodel.n_prior.tier` | — / 2 / 4 / 8 / 12 / 16 | pseudo-counts | `[E]` |
| `ai.oppmodel.tau_mem.tier` | — / 20 / 40 / 60 / 90 / 120 | s | `[E]` (deviates from LIT_C 6 s; A-4) |
| `ai.oppmodel.kl_adjust_threshold` | 0.35 | nats | `[E]` |
| `ai.ledger.window` | 30 | s | `[S: MMA_INTEGRATION §7.1]` |
| `ai.read.p_tier` | 0.50 / 0.58 / 0.68 / 0.75 / 0.83 / 0.87 | p | `[D: LIT_B §4.1]`; T0 `[E]` |
| `ai.read.elapsed_slope` | 2.0 | logit | `[E]` (shape `[S: LIT_B §4.6]`) |
| `ai.read.telegraph_coef` | 1.2 | logit | `[E]` |
| `ai.read.anxiety_pen` | 0.15 / 0.15 / 0.10 / 0.10 / 0.05 / 0.05 | p | `[S: LIT_B §4.3]` (ends); middle `[E]` |
| `ai.read.familiarity_pen` | 0.10 (T0–T3); 0 (T4+) | p | `[S: MMA_INTEGRATION §5.1 ST-5 (est.)]`, `[S: LIT_B §3.15]` |
| `ai.read.familiarity_threshold` | 3 | fights vs stance | `[E]` |
| `ai.read.counter_p.tier` | 0.02 / 0.05 / 0.15 / 0.25 / 0.40 / 0.50 | p | `[D: LIT_B §4.4]` |
| `ai.read.counter_mult` | 2.5 | × | `[E]` |
| `ai.feint.bite.tier` | 0.65 / 0.60 / 0.50 / 0.40 / 0.30 / 0.25 | p | `[S: LIT_B §4.5]` (T1, T5); rest `[E]` |
| `ai.feint.quality_coef` | 0.3 | — | `[E]` |
| `ai.feint.repeat_threshold` / `repeat_decay` | 3 / 0.6 | count / × | `[S: BOXING §5]` (threshold); decay `[E]` |
| `ai.feint.walkthrough_drop` | 0.30 for 5 s | fraction | `[E]` |
| `ai.feint.hurt_bonus` | +0.20 | p | `[E]` |
| `ai.feint.followup_bonus` | +15–25 % hit chance (I-6, in §02) | pp | `[S: MMA_INTEGRATION §2.1 I-6 (est.)]` |
| `ai.rematch_plan_bonus` | +0.02 | fraction | `[E]` |
| **game plan** | | | |
| `ai.scout.sigma.tier` | — / 0.30 / 0.20 / 0.12 / 0.08 / 0.05 | relative σ | `[S: MMA_INTEGRATION §6.4 (est.)]` |
| `ai.scout.self_overrate` | +1 tier at T0–T1 | tier | `[E]` |
| `ai.plan.fallback_ratio` | 0.6 | fraction | `[E]` |
| `ai.plan.finishing_mode_aggression` | 70 | attribute | `[E]` |
| `ai.plan.T4_overthink` | lead ×0.9 for 20 s after a failed trap | × / s | `[E]` |
| `ai.rule.R1` | jab 1.6; teep 1.5; cross 1.3; hook 0.8; circleAway 1.4; clinchEntry 0.6; threshold +5 cm | × | `[S: MMA_INTEGRATION §4.1 (est.)]` |
| `ai.rule.R2` | retreat-jab/pivot 1.5 for 1–2 s; hook exchange 0.5 | × | `[S: §4.1 (est.)]` |
| `ai.rule.R3` | feint 1.5; slip/level entries 1.6; body 1.4; lead lowKick 1.3; clinchEntry 1.3; shoot-off-strikes 1.2; lateral 1.3 | × | `[S: §4.1 (est.)]` |
| `ai.rule.R3b` | parry→cross 1.4 | × | `[E]` |
| `ai.rule.R4` | bait-and-cross 1.5 (iqTier >= 3) | × | `[S: §4.1 (est.)]` |
| `ai.rule.H2` | clinchEntry 1.4; cage pin 1.5; bodylock TD 1.3 | × | `[S: §4.2 (est.)]` |
| `ai.rule.H3` | R1 pace 0.9; clinch target 60 s/round; R3+ pressure 1.3 @ opp f >= 0.5 | ×, s | `[S: §4.2 (est.)]` |
| `ai.rule.F1` | in-out 1.5 (<= 1.2 s); circle 1.4; pace 1.3; breakClinch 1.8; pocket dwell 1 s | × | `[S: §4.3 (est.)]` |
| `ai.rule.F2` | clinch dwell 3 s; wallWalk 2.0 | s, × | `[S: §4.3 (est.)]` |
| `ai.rule.C1` | R1 rate 1.2; R1 TD 1.2; pressure 1.3 from R2 | × | `[S: §4.4 (est.)]` |
| `ai.rule.C2` | rate 0.8; power 1.2; clinch/scramble 0.7; naked shot 0.3 | × | `[S: §4.4 (est.)]` |
| `ai.rule.PV` | feint 1.4; counter 1.5; heavy 1.3; combo <= 3; R1 pace 0.8; body 1.2 | × | `[S: §3.4 (est.)]` |
| `ai.rule.VP` | pace >= 1.3 × opp; jab/teep/lowKick 1.4; head-only 0.8; pocket dwell 2 s | × | `[S: §3.4 (est.)]` |
| `ai.rule.AG1` | σ_scout ×0.8 at age > 34 | × | `[S: §4.5 (est.)]` |
| `ai.rule.L1` | riskAppetite −1; R1 pace 0.9 (layoff >= 210 d or short notice) | — | `[E]` |
| `ai.rule.S1` | teep 1.4; jab 1.4; rear kicks 0.4; lead lowKick 0.8; uppercut/knee-on-level-change 1.8 | × | `[S: §3.1 (est.)]` |
| `ai.rule.S2` | circleAway 1.5 @ cage < 1.5 m | × | `[S: §3.1 (est.)]` |
| `ai.rule.S3` | standUp/wallWalk 2.0 for 8 s; bottom sub 0.5 | × | `[S: §3.1 (est.)]` |
| `ai.rule.S5` | breakClinch 1.8 (+ hit-on-break in §03) | × | `[S: §3.1 (est.)]` |
| `ai.rule.W1` | naked shot 0.4; setup window 1 s; opp balance < 0.5 exception | ×, s | `[S: §3.1 (est.)]` |
| `ai.rule.W2` | advance 1.5; clinchEntry 1.8 & shoot 1.4 @ opp cage < 1.5 m | × | `[S: §3.1 (est.)]` |
| `ai.rule.W3` | groundStrike 1.3; pass 1.4 after 2 landed; control-gap target 180 s | ×, s | `[S: §3.1]`, `[S: FIGHT_DATA #84]` |
| `ai.rule.W4` | clinch/cage chains for 60 s after 2 stuffs | s | `[S: §3.1 (est.)]` |
| `ai.rule.W5` | TD R1 1.2 / R3 0.9 | × | `[S: §3.1]` |
| `ai.rule.WB1` | bottom-guard engagement off; sub 0.3 | × | `[S: §3.2 (est.)]` |
| `ai.rule.WB3` | sweep 1.6; sub 1.4; wallWalk 0.8; abort at > 6 strikes / 30 s | × | `[S: §3.2 (est.)]` |
| `ai.rule.WB4` | clinchEntry 1.3 (if wrestling tier < opp − 1) | × | `[S: §3.2 (est.)]` |
| `ai.rule.P1` | advance 1.5 along cut line | × | `[S: §3.3]` |
| `ai.rule.P2` | feint 1.5 | × | `[S: §3.3 (est.)]` |
| `ai.rule.P3` | combo +1; body 1.4; clinchEntry 1.3 @ opp cage < 1 m | × | `[S: §3.3 (est.)]` |
| `ai.rule.P4` | retreat/circle 1.4; lead 0.7; counter 1.8 | × | `[S: §3.3 (est.)]` |
| `ai.rule.P5` | 3 cage exchanges → lead 20 s | count, s | `[S: §3.3 (est.)]` |
| `ai.rule.ST1` | circle-outside 1.5 (+ §02 hit-chance ±15/−10 %) | × | `[S: §5.1 (est.)]` |
| `ai.rule.ST2` | jab 0.75; parry→cross 1.4 | × | `[S: §5.1]` |
| `ai.rule.ST3` | cross 1.4; rear bodyKick open side 1.4; lead hook 1.1 | × | `[S: §5.1]` |
| `ai.rule.ST4` | rangeTarget +0.1 m; clinchEntry 0.9 | m, × | `[S: §5.1]` |
| `ai.rule.ST5` | wrong-way circle p 0.15; counter 0.9 | p, × | `[S: §5.1 (est.)]` |
| `ai.rule.ST6` | lead-leg lowKick 1.3 | × | `[S: §5.1 (est.)]` |
| `ai.rule.ST7` | jab 1.2; lead hook 1.1; rear lowKick 1.1; rear bodyKick 0.9; clinchEntry 1.1 | × | `[S: §5.2]` |
| `ai.rule.ST8` | switch 0.3 s, 1 % stamina; weight 1.5 on trigger; gate T3+ | — | `[S: §5.3 (est.)]` |
| `ai.pace.final_round_intent` | 1.10 | × | `[E]` (from −17 % low-intensity time `[S: FIGHT_DATA #127]`) |
| `ai.pace.finish_budget` | 0.53 / 0.30 / 0.15 | share | `[S: FIGHT_DATA #98]` |
| `ai.pace.finish_class_mult` | HW 1.4; W-SW 0.5 | × | `[S: MMA_INTEGRATION §10 rule 19]` |
| `ai.pace.composure_threshold` | 40 | attribute | `[E]` |
| `ai.pace.composure_rush` | R1 ×1.3 for 120 s; R2 ×0.7 | × | `[S: MMA_INTEGRATION §7.6 (est.)]` |
| **adaptation** | | | |
| `ai.eval.T_eval.tier` | — / break-only / 90 / 60 / 30 / 20 | s | `[S: MMA_INTEGRATION §7.3 (est.)]` |
| `ai.eval.p_change.tier` | — / 0.30 / 0.50 / 0.70 / 0.85 / 0.95 | p | `[S: §7.3 (est.)]` |
| `ai.eval.dwell.tier` | — / break / 45 / 30 / 20 / 15 | s | `[S: §7.3 (est.)]` |
| `ai.effiq.damage_threshold` | 0.60 of TKO threshold | fraction | `[S: §7.3 (est.)]` |
| `ai.effiq.fatigue_threshold` | f >= 0.70 | fraction | `[S: §7.3 (est.)]` |
| `ai.effiq.kd_window` | 20 | s | `[S: §7.3 (est.)]` |
| `ai.effiq.rocked_extra` | −1 | tier | `[E]` |
| `ai.adj.drop_family` | hit-rate < 0.25 over >= 6; ×0.6; feints ×1.3; best ×1.3 | — | `[S: §7.2 (est.)]` |
| `ai.adj.defend_family` | >= 2 heavy absorbed; counter ×1.3 | — | `[S: §7.2 (est.)]` |
| `ai.adj.td_stuffed_x2` | rear kicks ×1.2 (striker) / W-4 (wrestler) | × | `[S: §7.2 (est.)]` |
| `ai.adj.taken_down_x2` | standUp ×2; kicks ×0.3; jab/teep ×1.3 | × | `[S: §7.2 (est.)]` |
| `ai.adj.opp_tired` | pressure ×1.3; combo +1; clinch ×1.2; TD ×1.2 | × | `[S: §7.2 (est.)]` |
| `ai.adj.self_low_stamina` | trigger f >= 0.6 in R1/R2; kicks ×0.6 | — | `[S: §7.2 (est.)]` |
| `ai.adj.cut_vision` | retreat ×1.2 for 20 s | ×, s | `[S: §7.2 (est.)]` |
| `ai.adj.cage_trapped` | 3 exchanges / 30 s; circle-off ×1.5 | — | `[E]` |
| `ai.adj.leg_damaged` / `opp_leg_damaged` | structural 30; switch 1.5; check 1.4; kicks 0.5 / lowKick 1.5; TD 1.2 | — | thresholds `[S: DAMAGE_PHYSIOLOGY §7 rule 9]`; weights `[E]` |
| `ai.adj.trap_repeat_count` | 3 | count | `[E]` |
| `ai.score.sigma.tier` | ∞ / 1.0 / 0.7 / 0.5 / 0.3 / 0.2 | rounds | `[S: §7.4 SC-1 (est.)]` |
| `ai.score.corner_sigma_mult` | 0.5 | × | `[S: §7.4 SC-1 (est.)]` |
| `ai.score.SC2` | pace 1.25; TD 0.8; risk +1; last-60-s volume 1.3 | — | `[S: §7.4 (est.)]` |
| `ai.score.SC3` | power 1.5; TD 0.6 (sub-spec: TD 1.3, sub 1.6 if sub tier >= opp bottom + 2); defence 0.7 | — | `[S: §7.4 (est.)]` |
| `ai.score.SC4` | risk −1; control 1.2 (wrestler) / counter 1.2 (striker); iqTier >= 3 | — | `[S: §7.4 (est.)]` |
| `ai.hurt.duration` | U(10, 20) | s | `[S: §7.5 D-1 (est.)]` |
| `ai.hurt.weights` | shoot/clinch 2.0; circle 2.0; cover 2.0; elite clinch/level 2.5; T5 counter 1.3; inexperienced trading 1.5 | × | `[S: §7.5 (est.)]`, `[S: DAMAGE_PHYSIOLOGY §7 rule 6]` |
| `ai.finish.reckless` | swing 2.0; defence 0.5; drain 2.0; trigger iqTier <= 2 or aggression >= 80 & composure < 50 | — | `[S: §7.5 D-3 (est.)]`; trigger attributes `[E]` |
| `ai.finish.measured` | straights/knees 1.5; balance floor 0.6; stop at hit-rate < 0.40 over 8 | — | `[S: §7.5 D-3 (est.)]` |
| `ai.finish.trap_bite_bonus` | +0.20 | p | `[E]` |
| `ai.finish.ground_strike_on_downed` | 3.0 | × | `[E]` |
| `ai.corner.correct.tier` | — / 0.40 / 0.55 / 0.70 / 0.85 / 0.95 | p | `[S: §7.7 CO-1 (est.)]` |
| `ai.corner.uptake` | 0.5 base; +0.1 per iqTier > 2; −0.2 damage > 60 %; −0.1 contradiction; pace cues ×0.5 at T4+ | p | `[S: §7.7 CO-2 (est.)]`; pace factor `[S: §7.6]` |
| `ai.corner.affirm` | +10 composure | attribute | `[S: §7.7 CO-4]` |
| `ai.corner.default_tier` | fighter iqTier − 1 (floor T1) | tier | `[E]` |
| `ai.corner.max_cues` | 2 | count | `[S: §7.7 CO-1]` |
| **multi-opponent** | | | |
| `ai.multi.aware_radius` | 6 | m | `[E]` |
| `ai.multi.threat_weights` | 0.35 / 0.20 / 0.20 / 0.15 / 0.10 | — | `[E]` |
| `ai.multi.prox_range` | 0.5–3.5 | m | `[E]` |
| `ai.multi.facing_cone` | ±45° (else 0.3) | deg | `[E]` |
| `ai.multi.recent_hit_mult` / window | 1.5 / 10 | ×, s | `[E]` |
| `ai.multi.opportunity` | hurt 1.0; tired 0.6; facing away 0.3 | — | `[E]` |
| `ai.multi.switch_ratio` / `min_hold` | 1.25 / 1.5 | ×, s | `[E]` |
| `ai.multi.effective_attackers` / `fringe_weight` | 2 / 0.3 | count, × | `[S: FIGHT_DATA §6.4 pt 1]` / `[E]` |
| `ai.multi.outnumbered_trigger` | >= 2 hostiles within 3 m | — | `[E]` |
| `ai.multi.line_spread_fallback` | > 120° for 1 s → fence | deg, s | `[E]` |
| `ai.multi.ground_weight` | shoot/pull 0.05; standUp 3.0 | × | `[S: FIGHT_DATA §6.4 pt 3]` direction; `[E]` |
| `ai.multi.strike_and_move` | retreat/circle 2.0 for 1.0 s; combo cap 2; straights 1.4; hooks 0.7 | — | `[E]` |
| `ai.multi.shield_clinch` | 1.5; break after 2 s | ×, s | `[E]` |
| `ai.multi.early_injury_window` | 15 s, opportunity ×1.5 | s, × | `[E]` |
| `ai.team.burst_threshold` | 1/3 committed | fraction | `[S: FIGHT_DATA §6.2]` |
| `ai.team.nonfighter_share` | 0.19 (burst) / 0.49 (non-burst); burst p 0.39 | p | `[S: FIGHT_DATA §6.2]` |
| `ai.team.flank_angle` | 90° | deg | `[E]` |
| `ai.team.fringe_distance` | 2.5 | m | `[E]` |
| `ai.team.turn_taking` | 6 s or f >= 0.5 | s | `[E]` |
| `ai.ffa.engaged_penalty` / `opportunism` | 0.5 / 1.5 | × | `[E]` |
| `ai.street.flee` | 0.2 + 0.5 dmg + 0.15 (hostiles − 1) + 0.1 idle15 − 0.3 trained − 0.2 friend; +0.3 friend downed | utility | `[E]` |
| `ai.street.bystander_p` | 0.90 | p | `[S: FIGHT_DATA §6.2]` |
| `ai.street.join_p` / `friend_share` | 0.26 / 0.68 | p | `[S: FIGHT_DATA §6.1]` |
| `ai.street.impaired_p` | 0.64 | p | `[S: FIGHT_DATA §6.2]` |
| `ai.street.impaired_effects` | τ ×1.3; accuracy −10 %; balance −15 %; pain −20 % | — | `[E]` |

---

## 5. Calibration hooks and validation checks (feeds Phase 9)

Responsibilities: the FIGHT_DATA targets whose *mechanism* is decision-making. The resolution sections own the
per-strike rates; this section owns the *mix* and the *dynamics*. Each check runs on a headless batch
(>= 2,000 bouts unless stated; `[S: FIGHT_DATA §3]` tolerance convention).

| # | check | target | tolerance | population | source |
|---|---|---|---|---|---|
| V-1 | longer-reach fighter's mean engagement distance (standing, non-clinch) exceeds the shorter fighter's preferred distance; share of standing time at `long` range rises with Δreach | +0.05 m per 10 cm Δreach; long-range share +8 pp per 10 cm | ±0.03 m; ±4 pp | matched-skill pairs, Δreach ∈ {0, 5, 10, 15 cm} | `[E]` mechanism check; finishing-punch mix straights +1 pp per cm `[S: LIT_B §2.5]` as the data anchor |
| V-2 | reach and win rate | 51.7 % overall; 60 % standing-heavy >= 2.5 in; 63 % at > 7 in; 49 % ground-heavy | ±3 pp | UFC-like population | `[S: FIGHT_DATA #116]` |
| V-3 | shorter fighters close and clinch more | clinch entries per 15 min +25 % and clinch time +20 % for the fighter with Δreach <= −5 cm vs equal-reach pairs | ±10 % relative | matched skill | `[E]` (mechanism of R-3); clinch share of fight time 15 % `[S: FIGHT_DATA #24]` must still hold overall |
| V-4 | grapplers take fights down more | wrestler-style fighters: TD attempts per 15 min >= 2 × striker-style; population mean 4.0 attempts / 1.45 landed / 38 % | ±0.5 / ±0.2 / ±3 pp | mixed styles | `[S: FIGHT_DATA #55–#57]` |
| V-5 | TD setup discipline | share of shots thrown within 1 s of a strike: T1 < 20 %, T3 >= 50 %, T5 >= 70 % | ±10 pp | by tier | `[S: WRESTLING §7]` (timing shots off strikes: never / 10 % / 30 % / >= 50 %) |
| V-6 | fighters behind on the cards raise output late | trailing fighter (true cards) in the final round: TD attempts −38 %, sub attempts −49 % vs own earlier rounds; SLpM +10 % vs own R2; power-strike share +5 pp | ±15 % rel.; ±8 %; ±3 pp | 3R decisions and R3 finishes | `[S: FIGHT_DATA #129]`; volume `[E]` (Gift: unchanged on average; A-10) |
| V-7 | leaders do not coast | leading fighter's R3 SLpM within ±10 % of own R2 | ±10 % | as V-6 | `[S: MMA_INTEGRATION §7.4]` |
| V-8 | round-3 urgency | standing low-intensity time R1 154 / R2 157 / R3 127 s | ±20 s | 3R fights reaching R3 | `[S: FIGHT_DATA #127]` |
| V-9 | elite fighters visibly adapt | share of bouts with >= 1 `evt.intent.change` mid-round: T1 < 10 %, T3 >= 50 %, T5 >= 90 %; mean latency from signal to change: T3 <= 60 s, T5 <= 20 s | ±10 pp; ±10 s | by iqTier | `[S: MMA_INTEGRATION §7.3 (est.)]` |
| V-10 | predictability ceiling | better-rated fighter wins 61–66 % over a population with UFC-like rating gaps; near pick'em 50–51 %; favourites at a −400-equivalent gap 88–93 % | ±3 pp | rating gap buckets | `[S: LIT_B §3.4]` (61.6 %), `[S: FIGHT_DATA #115]` |
| V-11 | counter usage by tier | counter-on-read strikes per bout: T1 ≈ 0 (novice losers 0.1 block-counters), T3+ >= 3 | ±1 | boxing ruleset | `[S: LIT_B §5.1]` (2.8 vs 0.1 per bout) |
| V-12 | exchange initiation mix | ≈ 1/3 lead, 1/3 counter, 1/3 defensive/positioning at T3–T5 | ±8 pp | striking rulesets | `[S: LIT_B §5.10]` (taekwondo Markov; proxy) |
| V-13 | knockdown conversion | KD → same-round KO/TKO 57 %; fighter scoring >= 1 KD wins 86 % | ±5 pp; ±4 pp | UFC-like | `[S: FIGHT_DATA #40, #42]` (finisher logic + §05 windows) |
| V-14 | stance | southpaw vs orthodox ≈ 52 % (50–57 band); ≈ 55/45 when the orthodox fighter has < 3 fights vs southpaws; open-stance bouts finish 18 % more often | ±3 pp; ±3 pp; ±8 % rel. | equal tiers | `[S: FIGHT_DATA #120, §2.4]` |
| V-15 | hurt behaviour by tier | on `state.rocked`: T0–T1 cover-on-fence share >= 50 %; T3+ clinch/level-change share >= 50 % | ±10 pp | by tier | `[S: MMA_INTEGRATION §8]` |
| V-16 | corner effect | bouts where an accepted correct cue precedes a positive swing in the next round's landed differential: T4 corners > T1 corners by >= 10 pp | ±5 pp | corner tier sweep | `[E]` |
| V-17 | outnumbered geometry | 1v3 trained-vs-untrained: mean effective attackers <= 2.0; defender never initiates ground; defender KD-of-attacker within 15 s in >= 30 % of bouts | — | crowd mode | `[S: FIGHT_DATA §6.4 pt 1]`; rest `[E]` |
| V-18 | street durations | untrained 1v1: median < 60 s; > 1 min ≈ 20 %; indecisive ≈ 45–50 %; KO ≈ 25 % with ≈ 64 % of KOs inside 30 s | ±10 s; ±8 pp; ±10 pp; ±8 pp | street ruleset | `[S: FIGHT_DATA §6.3, §6.1]` (weak) |
| V-19 | team roles | T4 teams vs a single T4: `hold`/`hit` role pairs occur in >= 60 % of 2v1 bouts; T1 teams 0 % | ±10 pp | teams | `[E]` |
| V-20 | mustNot slips | `evt.mustnot.violated` per bout: T1 >= 3, T3 <= 1, T5 ≈ 0 | ±1 | by tier | `[E]` |
| V-21 | determinism | identical seed → identical event log including all `evt.*` payloads; RNG draw count per tick = 6 (+1 multi) | exact | all | conventions §4 |
| V-22 | plan failure modes | each of §2.5.9's six failure modes occurs in >= 1 % of a mixed batch and is tagged in the event log | >= 1 % | mixed | `[E]` |

Debug surface: the Model tab (kept, `docs/AUDIT.md §1.3`) gains an "AI" page listing per-tier realised
values of V-5, V-9, V-11, V-15, V-20 from the corpus.

---

## 6. Assumptions and open questions

Every `[E]` above is covered by one of the following.

- **A-1 Research-side estimates.** All `(est.)` values (the multipliers of MMA_INTEGRATION §3–§7, the corner
  and adaptation numbers, hurt/finisher weights, scouting σ) are design parameters with no published
  measurement; they are the primary Phase 9 tuning set. Their *directions* are anchored in data (winners take
  more, better-set-up takedowns; make more positional improvements; trailing fighters drop TD/sub attempts).
- **A-2 Fixed RNG draw layout** (6 per fighter per tick, 7 with multi-opponent; 5 per fighter at breaks) is a
  design choice for replay stability; the count may change when §02–§04 finalise their own draws, but the
  principle (draws taken whether or not used) must not.
- **A-3 Temperature ladder** τ = 1.00…0.28, the phase/IQ 50/50 blend, the √n compensation, the style-weight
  range [0.5, 2.0] and the reduced style jitter σ 0.10 are estimates chosen so that T0 approximates the
  current lottery and T5 approaches argmax without reaching it (predictability ceiling V-10).
- **A-4 Memory horizons.** τ_mem 20–120 s by tier deviates from LIT_C's 6 s suggestion; the exchange ledger
  (30 s) carries the short horizon. Prior pseudo-counts 2–16, the KL threshold 0.35 nats, and the 72-context
  layout are estimates.
- **A-5 Perception/anticipation.** T0 read probability 0.50, the elapsed-time slope 2.0, the telegraph
  coefficient 1.2, the counter multiplier 2.5, the T2–T3 anxiety penalty 0.10, the familiarity threshold of 3
  fights, and all execution-quality tier multipliers (telegraph, on-time, target error, overcommit, stance
  break, eyes closed) are estimates; only the novice/expert endpoints and the fatigue → RT direction are
  sourced. The perception-lag ladder (300/200/100 ms, §09 §2.5) spans 200 ms T0→T5 where the measured
  expert–novice recognition gap is ≈ 100 ms `[S: LIT_B §4.7]`; the extra 100 ms at T0/T1 is attributed to
  scattered gaze and is an estimate. Beginner tells have no combat-sport quantification `[S: LIT_B §7 pt 5]`.
- **A-6 Feints.** Interpolated bite probabilities (T0, T2–T4), the quality coefficient, repeat decay 0.6,
  walk-through drop, hurt-bite bonus and the trap-repeat count of 3 are estimates.
- **A-7 No double counting of composure/dump.** §05 applies the energy cost and output effects of the
  adrenaline dump; §07 applies only the *intended* pace and the decision-quality term `q_dump`. If §05's
  output term is enabled, `ai.pace.composure_rush` must be set to 1.0 (calibration flag).
- **A-8 "Taller fighters fight longer"** is read as *at longer range*, not *longer duration*; there is no
  duration-by-height datum. V-1 is a mechanism check whose data anchor is the finishing-punch mix
  `[S: LIT_B §2.5]`, and reach must not move win probability beyond FIGHT_DATA #116 (V-2).
- **A-9 Multi-opponent priors are weak.** Everything in §2.7 is anchored on self-selected video samples,
  police/forensic data and expert doctrine `[S: FIGHT_DATA §7 assumption 6]`; there is no trained-vs-multiple
  dataset. All threat weights, angles, distances, role timings, flee utility coefficients and impairment
  effects are estimates to be revised when better data exists. The "500 encounters" figures are excluded.
- **A-10 Behind-late volume.** Gift 2025 finds no change in strike volume for trailing fighters on average;
  the +25 % intended pace (SC-2) and the V-6 +10 % realised target are a design choice to make round-stealing
  visible, bounded by the −38/−49 % TD/sub drop that *is* measured. If V-6 cannot be met without breaking V-7
  or #127, drop the pace term first.
- **A-11 Pressure vs counter, wrestler vs BJJ, striker vs grappler rules** encode coaching consensus; no
  head-to-head study exists `[S: LIT_B §7 pt 6]`. The submission-hunter entry ranking (SH-1) and R-3b are
  extrapolations.
- **A-12 Corner model** numbers (cue correctness, uptake, default corner tier, affirmation +10) are design
  parameters built from one microethnography, one null result on false feedback and coaching quotes
  `[S: MMA_INTEGRATION §11]`.
- **A-13 MCTS lookahead** is reserved, not baseline; enabling it requires a child RNG and a batch-cost review
  on the target laptop.
- **A-14 Predictability check definition.** "Evenly-rated" in V-10 means the population's rating-gap
  distribution matches UFC odds buckets; the 61–66 % band spans the Markov-model (61.6 %) and ML (62–67 %)
  ceilings; a sim that exceeds 70 % is under-randomised `[S: LIT_B §3.11]`.
- **A-15 Effective-IQ thresholds** (60 % damage, f 0.7, 20 s KD window, rocked −1), hurt duration U(10, 20) s,
  finisher trigger attributes (aggression 80, composure 50), ground-strike-on-downed ×3, the T4 over-thinking
  passivity and personality shifts in §3 are estimates.
- **A-16 Plan generator constants** (fallback ratio 0.6, finishing-mode aggression 70, T0–T1 self-overrating,
  L-1 layoff rule, final-round intent +10 %, composure threshold 40, rematch bonus) are estimates.

**Playability vs realism (default: realism).**
- Street/crowd fights are over in seconds and half end indecisively; that is realistic but not spectacular.
  A `ruleset.street.drama` flag may scale `flee` utility ×0.5 and bystander intervention ×0.5 for
  entertainment; off by default.
- T0–T1 fighters are ugly to watch (square stances, telegraphed swings, covering on the fence). Realism keeps
  them; the fighter creator (§01) can document that a "watchable" bout needs T2+.
- Softmax variance means the same matchup can look different bout to bout even at T5; this is required by
  V-10 and should not be "fixed" by lowering τ.

**Open questions.**
1. Decision cadence has no published measurement `[S: MMA_INTEGRATION §11]`; a UFCStats event-sequence study
   could replace the 20–90 s ladder.
2. Whether the opponent model should persist across bouts as a "film" object in the career layer (rematch
   effects) — proposed in §2.4.6, owned elsewhere.
3. (Resolved by §09 §2.5 and SC-0: open scoring sets σ_score = 0.) Remaining question: should the *corner*
   also see the true cards under closed scoring when the promotion posts them between rounds (some regional
   rulesets)? Default no.
4. Team coordination beyond 2v1 (3v3 with role graphs) is specified only by extension of §2.7.4.
5. Whether `flee` should exist in sanctioned rulesets as "retreat to survive the round" (it is a distinct,
   scored behaviour in boxing: "running"); currently only the street ruleset has it.

