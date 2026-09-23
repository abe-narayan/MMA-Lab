# PHASE 4 FINDINGS — AI ↔ resolver integration

What the chapter-07 decision layer looked like once it was actually driving
bouts, split into **bugs fixed here** and **calibration items for Phase 9**.
The rule for the split is §00's: a number that is merely wrong is a calibration
item and stays where it is; a number that is *used wrongly* — wrong units,
wrong population, a curve that vetoes where it should damp — is a bug.

Measurements are `npx tsx scripts/dev/probe.ts`, 40 bouts,
`arch.regional_pro_allrounder` mirror, `mma.unified.3r`.

---

## 0. The probe's own denominator (read this before quoting any rate)

`scripts/dev/probe.ts` computes `perFighterMin = secs / 60 / 2`. `secs` is
total **bout**-seconds and the tallies are summed over **both** fighters, so the
correct exposure is `2 x secs / 60`, i.e. `secs / 30`. Every per-minute and
per-15-minute figure the probe prints is therefore **4x too high**; the `control
min` line (`ctrl / 60 / N / 2`) is right.

Corrected, the post-fix run reads: SLpM 3.67 (target 3.9), TD 0.15/15 min
(1.45), KD 6.8/15 min (0.30), sub attempts 1.21/15 min (0.45–0.6).

The script is a dev probe, not a test, and the before/after comparison in this
document uses its raw output on both sides so the two are on one scale. Fixing
the divisor is a one-line change for whoever owns the probe.

---

## 1. Fixed in this pass

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | Zero `strike` events in a whole bout | `ExchangeLedger.pacePerMin()` counted every `attempt` entry — a step, a sprawl posture and a jab alike — and fed it to `c.pace`, whose denominator is a strike rate. A fighter who had circled for a second read as 60 strikes/min, `paceCurve` returned exactly 0 at ratio ≥ 3, and a 0 in a product utility removes the action. Feints survived only because `feint ∉ STRIKE_FAMILIES`. | `pacePerMin`/`landedPerMin` count strike families only; `c.pace` reads `landedPerMin`, per §2.5.5 P-6 ("the `c.pace` consideration counts *landed*, not thrown"). |
| 2 | `tech.level_change` loops as a no-op | It is a §2.3 A `setup` edge: `pos.standing_mid → pos.standing_mid`, whose entire payload is the SETUP state. `grapplingCandidates` offered it as a standalone action, so it was a free, repeatable nothing; and `GrappleWorld.setup` was hardcoded `false` in `bind.ts`, so even the payload never arrived. | `setup`-kind edges are no longer standalone candidates — §2.2.5's `macro.feint_level_change` / `macro.cut_feint_entry` already own them as steps. `bind.ts` now keeps a per-fighter `grap.setupWindowMs` window, opened by a strike commit and by a successful setup edge, and passes it as `GrappleWorld.setup`. |
| 3 | `ref.round_end` fires mid-round as a fighter action | `ref.*` rows share the edge catalogue and `ref.round_end.from` is *every* node, so `edgesFrom()` returned it everywhere and nothing filtered it. | `grapplingCandidates` skips `e.kind === 'referee'`. |
| 4 | Sprawls and level-change reads out of nowhere; garbage takedown accounting | `edgeAvailable` skipped the slot check when `ctx.slot === null`. A free-standing fighter holds no slot, so the initiator was handed the defender's half of the §2.3 table and could pick `def.sprawl` / `def.read_level_change` unprompted, joining an engagement as its *defender*. | Free-standing ⇒ slot `a`: whoever moves first from a free node is the actor. |
| 5 | Every bout TKO, zero knockdowns, reason always `covering without positional change` | The §2.3.3 rule was keyed on `grounded && !intelligentDefence && tSinceDefenceS ≥ 3 s` with nothing about strikes. `canAct` blocks a downed fighter and a fighter held at sub stage ≥ 2, so neither can ever "answer" — a knockdown or a submission attempt became an automatic TKO 3 s later, in bouts where no strike had been thrown. | The rule now also requires the fighter to be under fire: `unansweredHead ≥ 1 || coveringStaticS > 0` (the §05 observable that exists for exactly this rule and was unread). |
| 6 | Fighters hovered at 1.4–3.8 m; no §03 node but `pos.standing_long` was ever current, so no takedown or clinch entry was ever enumerated | `rangeTargetMetres` returned fixed 1.9 / 1.3 / 0.8 m for the plan's `long`/`mid`/`short`. `intent.rangeTarget` is a **band label** (§2.5 writes "rangeTarget long" and leaves the metres to §02), and for a pooled-average reach §02's long band ends at 1.21 m and everything past 1.48 m is `out`. A distance-striking plan therefore parked the fighter 0.4 m beyond his own kick range, and `c.range_target` rewarded the movement that kept him there. `pos.standing_long` has no outgoing edges. | The metres are now the midpoint of the fighter's own §02 band (`bandLimits(reachProfile(...))`). |

Regression tests added: `tests/ai.test.ts` (referee edges never enumerated;
bare setup edges never enumerated; free-standing fighter gets only slot-`a`
edges; ledger paces on strikes; three end-to-end claims about a live bout) and
`tests/rules.test.ts` (the covering TKO needs strikes).

One existing test, "a rocked fighter's live decisions shift to the emergency
set", was passing **because of** bug 3: its fixture leaves the pair 4.4 m apart,
where the only grappling candidate was `ref.round_end`, which
`familyForEdge` fell through to `clinchEntry` — one of the families the `shoot`
hurt row boosts. The fixture now places them at 0.8 m, where the shot and clinch
entries the row is about actually exist.

### Draw schedule

No fix adds or removes an RNG draw. P3 is still 8 per fighter (9 multi), P5 one,
and the per-contact counts are unchanged; `openSetupWindow`, the slot and
referee-edge filters and the band-derived range target are all pure. Fix 5 makes
`queueStoppage` fire less often, and that call samples the referee's reaction
lag — but that draw was always conditional on the criterion, not scheduled per
tick. `tests/determinism.test.ts` passes unchanged.

---

## 2. Calibration items for Phase 9 — values left alone

### C-1. Knockdown rate is ~20x the target

45 knockdowns over 40 bouts from 369 landed strikes ≈ **12 % of landed strikes
cause a knockdown** (`body` 17, `hurt` 20, `ko` 6, `flash` 2). FIGHT_DATA §3
wants 0.30 KD per 15 min, i.e. roughly 1 per 100 landed head significant
strikes — and `tests/damage.test.ts` asserts exactly that in isolation
("reproduces ~1.1 knockdowns per 100 head significant strikes"). So the §05
model is right on its own force distribution and the *engine's* distribution is
wrong: mean delivered force over landed strikes is 831 N, and body strikes are
140 of 369 landings with 17 body collapses behind them.

Evidence points at the force context `bind.ts` builds, not at §05's curves —
see C-2. This is the single reason mean duration is 1.2 min instead of 10.6 and
why the method mix has no decisions in it: nothing survives to the bell.

### C-2. `ExecutionQuality` is computed and thrown away

`policy.commit()` builds the full §2.3 `ExecutionQuality` (accuracy penalty,
power multiplier, telegraph, target slip, the T0–T1 overcommit) from draws the
schedule already spends, and puts it on `Decision.payload.exec`. `commitStrike`
reads only `payload.region`. Every strike therefore resolves with a perfect
execution and `ForceContext.commit` hardcoded to `'planted'` — the most
favourable commitment mode — which is a plausible contributor to C-1.

Wiring it is not a tuning change and wants doing, but it moves accuracy and
force together and should be measured against §02's own targets rather than
dropped in next to six other changes.

### C-3. Takedown completion 3 %

`stats.ts` counts a takedown as landed on §4.1's rule (a ground node held ≥ 3 s),
which is correct. 30 takedown attempts over 40 bouts stabilise about once.
Entry-to-capture succeeds at a believable rate in the event log
(`tech.single_leg` 11 success / 6 stuffed, `tech.double_leg` 4 / 6); what does
not happen is the capture-to-finish chain, because bouts end before it can. Re-
measure after C-1.

### C-4. Submission attempts high, control time low

1.2 attempts/15 min corrected (target 0.45–0.6), control 0.26 min (2.2).
`commitSubmission` counts a new `subAttempts` every time `f.sub.technique`
changes, so a fighter who alternates between two locks on consecutive ticks
books two attempts. Defensible as written — each is a genuine attempt — but it
interacts badly with a per-tick re-decision and is worth a dwell on the §04 side.

### C-5. `refereeWarning` spam: 12,005 events over 40 bouts

`Referee.checkStandupsAndBreaks` emits `'Work!'` on **every tick** that
`sSinceEffort ≥ cfg.standupWarnS`, with no latch. Cosmetic, but it dwarfs the
real event log (838 strikes) and bloats every replay. It wants a once-per-
threshold latch per engagement. Pre-existing; untouched here to keep this pass
to the symptoms it was scoped to.

### C-6. `c.pace` is a switch, not a regulator

With the numerator fixed the axis is still bang-bang: `1 − 0.5(x − 1)` reaches 0
at 3x target, and `compensate(c, 19)` blunts anything above that to at most a
4x score cut — not enough to outweigh `w_plan x w_style` (up to x3 on a jab).
The result is a fighter who throws flat out, then stops dead for the length of
the 30 s window. The shape, not the constant, is the calibration question: a
soft asymptote (`1 / (1 + k(x − 1))`) would regulate instead of oscillate. The
formula is left exactly as §2.2.2 prints it.

---

## 3. Before / after (raw probe output, 40 bouts)

| | before | after | target |
|---|---|---|---|
| mean duration | 1.3 min | 1.2 min | 10.6 |
| methods | tko 40 | ko 23, tko 17 | ~32 % KO/TKO, ~49 % dec |
| SLpM (probe scale) | 0.82 | 14.69 | 3.9 |
| sig accuracy | 43 % | 44 % | 46 % |
| TD /15 min | 4.68 @ 3 % | 0.61 @ 3 % | 1.45 @ 38 % |
| KD /15 min | 0.00 | 27.31 | 0.30 |
| sub attempts /15 min | 9.94 | 4.86 | 0.45–0.6 |
| control min | 0.31 | 0.26 | 2.2 |

`strike` events in the reference bout (`probe/1v1/0`): **0 → 9**, out of 9
non-housekeeping events. `ref.round_end` as a fighter action: **7 → 0**.
`tech.level_change` no-ops in that bout: **~20 → 4**, and each of those is now
the second step of `macro.feint_level_change` and opens a real setup window.

---

# PHASE 4b — the knockdown rate and the takedown rate

Second pass, scoped to C-1 (knockdowns ~20x target) and C-3 (takedown
completion 3 %). Same probe, same 40 mirror bouts; `scripts/dev/forces.ts`
adds the in-engine force / knockdown-source split.

## 4. What the measurement actually showed

The brief for this pass assumed the knockdown excess lived in the §05 impact
chain — a doubled multiplier, a unit slip, an inverted `seen`. It does not.
Instrumenting `DamageState.applyImpact` over the 25 `force/1v1/*` bouts:

| | in-engine | §2.4.1 Monte-Carlo (`tests/damage.test.ts`) |
|---|---|---|
| head impacts | 306 | 30,000 |
| `alphaEq` median / p90 / p99 / max | 890 / 2,148 / 3,459 / **4,079** | ~5,400 median, tail past 11,000 |
| mean `pConcuss` | **0.099 %** | 4.2 % |
| knockdowns from the §2.4 roll | **0** | 2.3 % of impacts |

**The §2.4 roll never fires in-engine.** `ko.alpha50` is 8,500 and the whole
in-engine `alphaEq` distribution sits below 4,100, so the logistic returns
~0.001. Every knockdown in the engine comes from paths the chapter-05 suite
does not cover at all:

| source | events | code |
|---|---|---|
| head acute crossing `thr.kdHurt` (65) | 17 | `state.applyHeadThresholds` |
| head acute crossing `thr.ko` (90) | 1 | same |
| `dmg.body.thr.collapseRollAt` collapse | 4 | `state.startBodyCollapse` |
| liver (`dmg.body.liver.rawThr`) | 4 | `state.applyBodySiteEvents` |

That is the discrepancy: **`tests/damage.test.ts` exercises the single-impact
roll on a fresh `DamageState`, where `applyHeadThresholds` returns immediately
(`wasHurt` is false) and nothing accumulates.** The module is calibrated on the
one path the engine never reaches.

The §2.3.1 threshold ladder itself is implemented exactly as the chapter prints
it — `raw`, `acuteMult(site)`, `acuteMultAttr`, `massScaleTarget`, `kPrior`,
the 30/45/65/90 bands, the 8 s / 20 s re-hit decay were all checked term by
term against §2.2.1–§2.3.1 and agree. The mechanism is right; see C-7 for the
constant that is not.

## 5. Fixed in this pass

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 7 | Takedown accuracy 3 % against a 38 % target; 0.15 TD/15 min against 1.45 | `computeStats.setPair` rebuilt the pair record from scratch on **every** position event, with `tdTick = byTakedown ? tick : -1`. A takedown chain is `entry -> capture -> mat` across several edges and only the first is a `takedown` event (`tech.double_leg` into `pos.td_double_leg_in`, then `tech.front_headlock_go_behind` — a `control` edge, so a `positionChange` — into `pos.ground_turtle`), so the three-second stabilisation clock was erased by the very move that completed the takedown. Any guard pass inside the window erased it too. | `setPair` carries `tdTick`/`tdBy`/`tdCounted` forward while the same pair stays on the mat, and carries the shooter's id forward through the non-mat part of the chain. |
| 8 | Same | The clock also keyed on `phaseOf(node) === 'ground'`, which is true for the §2.2.3 `attack` nodes (`pos.td_*`, `pos.throw_in_progress`) — a *contested* shot where nobody is down — and for `pos.scramble` / `pos.ground_knockdown`. | New `isMatNode`: ground families only, excluding `attack` and `transient`. A stalled single leg is no longer a landed takedown. |
| 9 | Same (the denominator) | `edgeEventKind` reports every §2.3 A `entry` edge as a `takedown` event, and group A also holds `tech.clinch_entry_cold`, `tech.clinch_entry_strikes` and `tech.pull_guard`. UFCStats counts none of those as takedown attempts. | `isTakedownAttemptEdge`: `capture`/`throw`, or an `entry` whose destinations include an `attack`-family node. |
| 10 | Every accumulation / body / leg knockdown scored for the **wrong fighter**, including in 06's judging input | `DamageState.event` addresses its events to itself (`actor === target === this.profile.id`) — it has no idea who is hitting it — and `stats.ts` does `actor.knockdowns++`. So the judges credited the 10-8 to the fighter who was dropped. | `pushDamageEvents` re-addresses a `knockdown` to its causer: the striker at P4, otherwise the new `FighterWorldState.lastStruckBy`. |
| 11 | Every §2.4 **roll** knockdown counted twice | 05 emits its own `knockdown` event from `emitKnockdown`, and `bind.resolveStrikeContact` emitted a second one for the same impact. Invisible today only because the roll never fires (§4). | The binder's duplicate emit is gone; `pushDamageEvents` now owns the posture, the queue cancel, the engagement exit and the counter. |
| 12 | §2.4 roll outcomes silently upgraded to a KO | §2.3.1: "single-impact outcomes from the §2.4 roll override the threshold mapping for that impact". `applyHeadThresholds` had `!resolvedByRoll` on the `kdHurt` branch but **not** on the `ko` branch, so a `rocked` or `knockdown_flash` roll on a fighter whose pool crossed 90 became a knockout by accumulation. | `!resolvedByRoll` on both branches. |
| 13 | 05 saw `targetState` as all-false on every impact | `bind.resolveStrikeContact` never set `StrikeResolveInput.targetState`, so `resolveStrike` fell back to its default. `ko.kGround` (x0.7 on the mat) and `dmg.head.groundStructuralMult` (x1.3) therefore never applied — ground-and-pound was scored as if the defender were standing — and `ko.kRelaxed` never fired. | `targetState` is built from the world: `grounded` from the target's posture, `midAction` from the live action, `mouthOpen` from 05's own `observables()`, `guardHand` from the guard spec. |
| 14 | `forces.ts` attributed 0 knockdowns to every technique | The accumulation knockdown events carried no `cause`. | `applyHeadThresholds` names the strike (`cause`, `region`), like `emitKnockdown` does. |

Regression tests: `tests/sim.core.test.ts` (§4.1 takedown accounting — four
cases, all four fail on the old code; knockdowns cross the 05 boundary once and
to the right fighter) and `tests/damage.test.ts` (the roll overrides the
threshold for its own impact; the accumulation band still fires when it did
not; one impact never emits two knockdown events).

### Draw schedule

Unchanged. No fix adds, removes or reorders a draw: `stats.ts` is a pure
function of the event log, `pushDamageEvents` only rewrites two integer fields
on an already-built event, the `!resolvedByRoll` guard sits *after* all ten
draws are taken (§2.10 takes them up front precisely so this is safe), and
`targetState` feeds multipliers, not rolls. `tests/determinism.test.ts` passes
unchanged.

## 6. New calibration items for Phase 9

### C-7. The head acute pool is ~2x hot relative to its own thresholds

`dmg.rawScale` (100, tagged `[E]`, registry range 10–300) is defined as "raw
damage units produced by a fully-delivered `dmg.forceRef` impact", and
`dmg.forceRef` is 3,400 N — Walilko's *mean* straight to the jaw, not a
knockout punch. So the chapter's own worked example (§2.2.3) says the median
delivered power punch, 1,150 N, is `raw ~ 34`, which at the chin
(`acuteMult` 1.35) is **46 acute points against a `thr.rocked` of 45**. One
median power punch rocks a fresh fighter, and the next one drops him. The
comment on `applyHeadThresholds` already spotted half of this and added the
`wasHurt` gate; the gate cannot help, because entering `rocked` is as cheap as
crossing `kdHurt`.

The chapter's own C13 is the cleanest measurement of the gap: **"strikes before
TKO: loser head sig absorbed, mean 11 / median 6" (FD #46)**. Measured
in-engine over the 25 `force/1v1/*` bouts:

| `dmg.rawScale` | C13 loser head sig absorbed | KD per landed strike | KD /15 min | mean duration | method mix (40 bouts) |
|---|---|---|---|---|---|
| 100 (shipped) | **4.0 mean / 4 median** | 8.8 % | 6.11 | 1.3 min | ko 26 / tko 14, no decisions |
| 50 | **11.9 / 12** | 1.04 % | 0.37 | 10.8 min | ko 13 / tko 8 / dec 19 |
| 35 | 20+ | 0.24 % | 0.06 | 14.7 min | dec 33 / tko 5 / ko 2 |

`dmg.rawScale` 50 puts C13, C1 (0.37 against 0.30 +- 0.05), C16 and the
KO/TKO-vs-decision split all inside or next to tolerance from one move. The
value is **not** changed here: §00's rule is that a number which is merely
wrong stays where it is, and this one moves C1–C3, C6, C7, C9–C14, C16 and C21
together — it has to be solved against the whole Phase 9 batch, not against one
probe. Two riders for whoever does:

- The lever is really the product `dmg.rawScale x (F_del / dmg.forceRef)`. §02
  currently delivers about half its own design anchor (C-8), so a §02 force
  re-calibration and a `rawScale` re-solve must happen in the same pass.
- At `rawScale` 50 the bouts go the distance and **SLpM collapses to 1.52**
  against a target of 3.9. That is C-9 coming out from behind the short bouts,
  not a new problem — but it means C-1 cannot be closed without C-9.

### C-8. §02 delivers about half its own design anchor, which kills the §2.4 roll

05 §2.1 records §02's intended distribution: flush cross 1,400 N, mixture
median ~1,100 N, max ~5,400 N (Pierce in-ring). In-engine over 295 landed
strikes: **median 563 N, p90 1,160, p99 1,836, max 2,187, 1.0 % >= 2,000 N**
against the 2–6 % anchor. The linear accumulation path barely notices (it just
climbs half as fast); the §2.4 roll is a logistic with a midpoint of 8,500 and
it dies completely — hence 0 roll knockdowns out of 306 head impacts.

Two inputs the roll needs are also simply unwired, and both belong to §02:

- **`seen` is effectively always true.** `bind` sets
  `seen = !spec.flags.includes('spinning')`, so the unseen fraction is ~1 %.
  05 §2.1 asks §02 for ~0.30 in R1 falling to ~0.15 in R3, and `ko.kUnseen` is
  1.35 — that is the whole upper tail of `alphaEq`, and it is the mechanism
  behind C4 (KD-rate decay by round), which currently cannot exist.
  Deliberately **not** invented here: §02 owns the rule and cannot get a new
  RNG draw for it (09 §2.7 fixes `DRAWS_PER_STRIKE` at 6), so it has to be
  derived from information P3 already has (the defender's read, mid-action,
  guard) and that is a §02 design decision, not a binder patch.
- **`ForceContext.closingSpeedMs` is never set**, so `ko.kClosing` is pinned at
  1.0 (design: up to x1.5) and the closing term in `relativeVelocity` is always
  0. `bind.commitModeOf` already computes the closing component for the commit
  mode and could pass it; left out of this pass because it raises force and
  `alphaEq` together and belongs with the C-8 re-measurement.

### C-9. The pace regulator is bang-bang, and damage is convex in burst rate

Strike attempts per 10 s per bout, both fighters, by seconds into the round:

| 0–10 | 10–20 | 20–30 | 30–40 | 40–50 | 50–60 | 60–70 (R2 opening) |
|---|---|---|---|---|---|---|
| 8.2 | 8.5 | 6.2 | 4.6 | 1.2 | 0.3 | 16.3 |

That is **24.6 attempts and 11.4 landed per fighter-minute for the first 20
seconds of every round** — about 3x the UFC rate — then a collapse to near
zero, averaging out to the correct SLpM. `c.pace` only damps above ratio 1 and
the ledger window is empty at every round start, so the controller cannot act
until the burst has already happened. The head acute pool has an 8 s half-life
that becomes 20 s inside the `reHitWindow`, so a burst is exactly the input it
integrates worst: 34 of 40 bouts finish inside the first 46 seconds of round 1
and the other 6 finish 12 seconds into round 2, right after the break drains
the window. This is C-6 restated with the numbers behind it; the shape of
`paceCurve` (a soft asymptote instead of a clamp, and a target the fighter
plans toward rather than reacts to) is the Phase 9 question.

## 7. Before / after (probe output, 40 bouts, per-fighter scale)

| | before | after | target |
|---|---|---|---|
| mean duration | 1.3 min | 1.3 min | 10.6 |
| methods | ko 26, tko 14 | ko 26, tko 14 | ~32 % KO/TKO, ~49 % dec |
| SLpM | 4.45 | 4.44 | 3.9 |
| sig accuracy | 45 % | 45 % | 46 % |
| TD /15 min | **0.15 @ 3 %** | **1.60 @ 48 %** | 1.45 @ 38 % |
| KD /15 min | 6.11 | 6.11 | 0.30 |
| sub attempts /15 min | 1.02 | 1.02 | 0.45–0.6 |
| control min | 0.23 | 0.23 | 2.2 |

In-engine distributions, 25 `force/1v1/*` bouts — unchanged by this pass,
because nothing here touches force or the magnitudes in the impact chain:

- `forceN` (landed): median 563, p90 1,160, p99 1,836, max 2,187; 1.0 % >= 2,000 N.
- `alphaEq` (head impacts): median 890, p90 2,148, p99 3,459, max 4,079.
- `pConcuss`: mean 0.099 %, p99 0.69 %.
- knockdown sources: 18 head-threshold, 8 body — **0 from the §2.4 roll**.

Takedown accuracy at 48 % is now above the 38 % target rather than a tenth of
it. It is measured on 1.3-minute bouts, where a shot that lands early is almost
never followed by a stand-up, so the figure will move on its own once C-7
lengthens the bouts; no value was tuned to reach it.

---

## Resolution of C-7 (`dmg.rawScale`) — applied at the end of Phase 4

`dmg.rawScale` was set to **50** (was 100). This is a `[E]`-tagged free parameter
with bounds 10–300, and the change was made against **chapter 05's own acceptance
row C13** ("loser head significant strikes absorbed before a TKO: 11 ± 3"), not
against a feel judgement:

| `dmg.rawScale` | C13 measured in-engine | verdict |
| --- | --- | --- |
| 100 | 4.0 | fails the chapter's own target |
| 50 | 11.9 | inside 11 ± 3 |

Effect on the headline batch (40 AI-vs-AI bouts, two `arch.regional_pro_allrounder`,
`mma.unified.3r`, `octagon_30`):

| Metric | before | after | target |
| --- | --- | --- | --- |
| Mean duration | 1.3 min | **10.8 min** | 10.6 |
| Method mix | 100% KO/TKO | 13 KO / 8 TKO / 19 decision | ~32% KO-TKO, ~49% decision |
| Knockdowns /15 min | 6.11 | **0.37** | 0.30 |
| SLpM | 4.44 | 1.52 | 3.9 |
| Sig. accuracy | 45% | 42% | 46% |
| Takedowns /15 min | 1.60 @ 48% | 2.04 @ 72% | 1.45 @ 38% |
| Submission attempts /15 min | 1.02 | 1.34 | 0.45–0.6 |
| Control minutes | 0.23 | 3.46 | 2.2 |

Three unit tests in `tests/damage.test.ts` had fixtures whose newton values
implicitly encoded the old scale. Two kinds of fix were needed, and the
difference matters: the liver-shot band test now states its intent through
`bandForce()` (raw damage is linear in delivered force, so the fixture scales
with the constant), while the roll-vs-threshold tests **pin** `dmg.rawScale` to
the reference value, because `alphaEq` — the concussion path — does *not* scale
with a damage constant, and scaling their force would have changed the very
thing they hold fixed.

### Still open for Phase 9

- **SLpM 1.52 vs 3.9.** Now *under* target. Directly downstream of C-9 (the pace
  controller is bang-bang: ~25 attempts/fighter-min for the first 20 s of a round,
  then near-zero). A regulator, not a new constant, is the fix.
- **Takedown accuracy 72% vs 38%** and volume 2.04 vs 1.45; control 3.46 min vs 2.2.
  The completion path was repaired during Phase 4 (it was 3%); it now overshoots.
- **Zero submission finishes** despite 1.34 attempts/15 min — attempts are not
  converting, against a target of roughly 17–25% per attempt.
- C-8 (chapter 02 delivers ~half its own force anchor; `seen` is ~1% unseen against
  0.30 designed; `closingSpeedMs` unwired) is likely entangled with the SLpM gap.

---

## Phase 6 findings

**F-1 (fixed): the fighter validator only knew one of three catalogues.**
Style preferences were checked against chapter 02's striking catalogue alone, so
every grappling reference in an archetype (`tech.double_leg`,
`tech.body_lock_lift_return`, `tech.clinch_entry_strikes`, …) was reported as
dangling — 61 false positives across the 15 archetypes. The validator now checks
the striking catalogue, chapter 03's action graph and chapter 04's submissions.

**F-2 (fixed): submission families had no representation.**
The remaining 7 were real: archetypes name a family (`sub.kimura`,
`sub.arm_triangle`, `sub.triangle`) where the catalogue stores position-specific
variants (`sub.kimura_guard`, `sub.kimura_half`, …). Forcing an archetype to pick
one variant would claim its owner only ever attacks from that position, which is
wrong. `resolveSubmissionFamily()` now expands a family into its members, and an
exact id resolves to itself, so either vocabulary is valid. Dangling ids: 0.

**F-3 (OPEN, for Phase 7): style preferences are not consumed by the AI.**
`style.goToSubmissions`, `favouriteTechniques`, `favouriteCombos` and
`takedownPreferences` are authored, validated and stored, but nothing in
`src/sim/ai/` reads them — a `grep` for `goToSubmissions` across the sim finds
only the legacy importer. So a fighter built around the guillotine currently
hunts it no more often than anyone else, and the creator's style tab has no
effect on the bout. The plan generator (07 §2.5) is the right consumer: its
weapon-selection step should seed from these lists before falling back to
discipline means. Until then the creator over-promises, and that is worth saying
plainly rather than leaving a user to discover it.

---

# Phase 5 — making tier change *how* a fighter fights

Phase 5's brief was that `rulesFor()` — chapter 01 §3's ~200-row tier behaviour
catalogue — was never called anywhere in `src/sim/ai/`. Tier reached behaviour
only through scalar composites (softmax temperature, skill gaps, telegraph), so
a white belt was a weaker black belt rather than a different fighter. Three
measured symptoms came with it. This section records what caused each, what was
done, and what is deliberately left measured rather than patched.

All numbers below are seeded batches from `scripts/dev/tiers.ts` and
`scripts/dev/probe.ts`; the executable form of the §7.3 checks is
`tests/tiers.test.ts`.

## 1. Identical fighters won 70/30 by fighter id — **fixed**

`arch.regional_pro_allrounder` against itself: **70 % / 30 %** for the lower id.

The striking was even (16.8 vs 16.9 significant landed per bout, 41.6 % vs
39.9 % accuracy, 48 vs 45 knockdowns). The grappling was not:

| per 200 mirror bouts | fighter 0 | fighter 1 |
| --- | --- | --- |
| takedowns landed | 448 | 212 |
| control seconds | 58,060 | 30,023 |
| reversals | 226 | 62 |
| judge rounds won | 736 | 418 |

**Cause.** 03 §2.1.1 allows one contested edge per engagement at a time, and
`commitGrapple` enforced it first-come: `if (e && e.inflight) return`. P3 decides
in ascending fighter id, so the lower id asked first on every tick and took the
slot whenever he wanted it; the higher id was locked out for the whole duration
of that edge, and locked out again on the next tick. Inside an engagement the
higher id could essentially never initiate — hence 2x the takedowns, 2x the
control and 3.6x the reversals. Reversing the P3 iteration order flipped the
bias exactly (30 % / 64 %), which is the proof.

**Fix.** The slot is now contested by the *intra-tick commit offset* —
`(decisionOffsetMs + jitter) mod dtMs`, the same number the scheduler already
turns into `commitMs` and which the loop already draws for exactly this purpose
(09 §2.2). `EngagementSet.contestInflight` returns free / blocked / displace; a
challenger with the earlier offset displaces the incumbent, whose commitment is
cancelled. Both sides of a lost contest pay the same price — the action energy
plus a `stuffed` edge event with `reason: 'contested'` — because charging only
the displaced fighter put the whole cost on the lower id (he is the only one who
*can* be displaced) and was worth a further ~3 pp.

Iteration order is unchanged, the draw schedule is unchanged (8 per fighter in
P3), and the advantage the order used to confer is now symmetric.

**After.** Mirror over 400 bouts: 51.0 % / 45.3 % / 3.8 % draws.

## 2. A brand-new fighter beat a regional pro 30 % of the time — **fixed**

`arch.brand_new_brawler` vs `arch.regional_pro_allrounder`: **30 % → 3-8 %**
(the §7.3 target is well under 5 %; pooled over three trained opponents it is
1.7 %). Two thirds of the original figure was the id-0 grappling monopoly above
— the T0 was fighter 0 in that matchup — and the rest was that nothing made him
*incompetent*, only weaker.

Now wired from the catalogue, each traceable by rule id through
`FighterIntent.tierRules` and `FighterWorldState.tells.rules`:

- **Repertoire gates** (`ai/actions.ts`): `beh.mt.kick_selection` (T0-T1 own the
  rear round kicks and nothing else), `beh.mt.elbow_availability`,
  `beh.mt.lean_back_t0`, `beh.mt.spinning_gate`, `beh.wr.sprawl_late` (a T0 has
  no sprawl at all), `beh.wr.timing_shots`, `beh.wr.cage_use`, `beh.bjj.top_t0`
  (no guard pass), `beh.bjj.sweep_repertoire` (no sweep), `beh.bjj.cage_use`,
  `beh.box.repertoire_t0` (no counter game).
- **Posture** (`core/bind.guardOf`): `beh.box.hands_at_chest` puts a T0 in
  `guard.low_hands` permanently, `beh.gen.hands_drop_tired` drops the guard at
  f > 0.45 for T0-T1 against f > 0.75 for T3+, and `beh.gen.turn_away` /
  `beh.gen.hurt_t0` put him in `guard.cover_turtle` with his back exposed
  (`defenderBackTurned` in 02's arrival logit).
- **Perception**: `beh.gen.eyes_close` (0.70 at T0, 0.30 at T1) now suppresses
  the read for the exchange and feeds `defenderVisionBlocked`.
- **Weights**: `beh.gen.t0_grab_push`, `beh.gen.panic_flurry`,
  `beh.box.backs_straight_up`, `beh.box.ring_cutting`, `beh.mma.getup_t1`,
  `beh.mt.fatigue_kicking`, `beh.mt.check_rate`, `beh.box.lead_hand_use`,
  `beh.box.body_work`, `beh.wr.underhook_pummel`, `beh.bjj.mma_bottom_priority`.

Equal-tier connect % is now monotone in tier — T0 69 %, T2 41 %, T3 38 %,
T4 35 %, T5 36 % — against 01 §3's `beh.box.defence_reference` ladder of
45-55 / 33 / 29 / 20-25 / <20. The direction is right; the top of the ladder is
still flat, which is finding 3.

The whole win matrix is now monotone in both directions (40 bouts per cell, row
fighter's win %):

|    | T0 | T1 | T2 | T3 | T4 | T5 |
| --- | --- | --- | --- | --- | --- | --- |
| T0 | 55 | 25 | 3 | 3 | 5 | 0 |
| T1 | 80 | 58 | 10 | 15 | 0 | 0 |
| T2 | 100 | 90 | 35 | 58 | 8 | 5 |
| T3 | 95 | 88 | 48 | 45 | 30 | 0 |
| T4 | 95 | 93 | 88 | 80 | 43 | 10 |
| T5 | 100 | 100 | 93 | 100 | 98 | 55 |

## 3. Higher skill still makes fights shorter — **improved, not solved**

Two champions finished each other **93 % of the time in 3.6 minutes**. After
Phase 5 the T5 mirror is 5.4-7.3 minutes at 80-90 % finishes, with knockdowns
per 15 minutes down from 2.21 to 0.9-1.5 and connect % down from 49-51 % to
36-37 %. It is still **shorter** than the T2 and T3 mirrors, and the executable
check for that ordering is `it.skip`ped in `tests/tiers.test.ts` with a pointer
here rather than weakened until it passes.

### What was wrong on the AI side, and is now fixed

**02's entire reactive-defence layer was dead.** Every `Candidate` carried
`defence: 'def.neutral'`, which is not an id in the defence catalogue, so
`resolvedDefenceOf` returned `null` on every strike of every bout ever
simulated. `availableDefences`, `defenceWindowMs`, `rankDefences` and
`patternReadP` existed and were never called; the only defence in the engine was
the passive guard roll. A successful read bought a counter-weight multiplier and
nothing else, which is precisely "skill converts into offence".

Four changes:

1. A successful read now selects a reactive defence from the tier's repertoire
   (`beh.gen.read`, `beh.box.high_guard_only`, `beh.box.repertoire_t2/t3/t4`,
   `beh.box.pull_counter`'s headMovement >= 55 gate), and it rides on the
   `Decision` ahead of the candidate's neutral posture.
2. **02's read 1 (pattern read, before launch) is wired.** Perception is delayed
   by `lagTicks` — two at a pro's reaction time — and a jab's whole flight is one
   or two ticks, so a fighter never *sees* a jab before it lands and the reactive
   window against it is negative at any tier. Only a fighter who predicts the
   family from his own opponent model defends one. The share of that prediction
   is gated on `beh.box.reads_adapt`'s iqTier ladder ("T0 none" … "T5 within
   exchanges") and on the model actually holding a habit (`PATTERN_HABIT_P`).
3. **A fighter mid-commitment now still decides.** The loop used to skip
   `decide()` entirely for a busy fighter and burn his draws, so he carried
   whatever `defence` his own last attack had set — `def.neutral` — through the
   whole exchange. Since a better fighter throws more, the better fighter was
   undefended *more* of the time. `DecisionContext.canAct` is now passed through
   and `LoopModules.holdDefence` applies the defence half only. The draw count
   per fighter in P3 is unchanged: `drawsPerFighter - 1` in the policy plus the
   commit jitter in the loop, either way.
4. 05's `targetState.midAction` read `target.action !== null`, and `f.action` is
   sticky — it keeps the last technique id long after the commitment ends. Every
   fighter was therefore permanently "relaxed" (`ko.kRelaxed`) from his first
   punch onward, worst of all for the busiest. It is now the commitment window.
   `targetState.braced`, never set by anything, is now the chin half of a read
   (`beh.gen.read`; `beh.gen.eyes_close`'s "absorb -0.15" is the same coupling
   from the other end).

Resolved-defence coverage by tier, over 20 mirror bouts each, went from a flat
~17 % to: T0 5 %, T2 31 %, T3 43 %, T4 53 %, T5 72 %.

### What is left, and why it is chapter 05's

Holding **every attribute fixed** and scaling only the sub-skills and training
years of one archetype (sub-skill band midpoints 5/20/40/60/80/95, years
0.1/0.6/2/6/10/14):

| skill tier | duration | decisions | KD / 15 min | connect % | SLpM |
| --- | --- | --- | --- | --- | --- |
| T0 | 14.1 m | 80 % | 0.11 | 66 % | 3.42 |
| T1 | 12.3 m | 62 % | 0.23 | 43 % | 3.65 |
| T2 | 15.4 m | 78 % | 0.09 | 43 % | 2.55 |
| T3 | 13.5 m | 67 % | 0.18 | 41 % | 1.49 |
| T4 | 10.5 m | 40 % | 0.44 | 39 % | 1.76 |
| T5 |  8.6 m | 18 % | 0.86 | 32 % | 2.47 |

Connect % falls monotonically — the defensive ladder now works — and the bout
still gets shorter, because **the tier ladder in the resolution chapters is
offence-only**:

- `FORCE.tierHook` spans **0.22 → 1.05** and `FORCE.tierStraight`
  **0.50 → 1.05** across T0-T5, and 01's `hipRotationMult` adds another
  0.50 → 1.10.
- Nothing on the durability side is keyed on tier at all. `ko.chinSlope`
  (0.02 logit per point) reads the `chin` **attribute**, which scaling skills
  does not touch; `kBrace` reads the `neck` attribute; `alpha50` and
  `alphaScale` are flat. In a controlled ladder the defender's chin is identical
  at T0 and T5 while the attacker's hook carries 4.8x the force.

So at equal attributes a higher tier is strictly more dangerous and exactly as
fragile, and a ~1.4x force edge beats a ~1.3x accuracy reduction. Knockdowns per
*landed* significant strike are 0.8 % at T3 and 2.3 % at T5, against chapter
05's own ~1.1 per 100 head significant strikes.

**Left for Phase 9** (chapter 05 / chapter 01 calibration, not AI):

- a tier or skill term on the durability side — the obvious candidates are
  `ko.chinSlope` (`[E]`, bounds 0-0.1, currently 0.02), a tier term in `kBrace`,
  or capping the top of `FORCE.tierHook`;
- or a re-fit of `dmg.rawScale` against a *high-volume* archetype rather than
  `arch.regional_pro_allrounder`, whose SLpM of 1.4-1.6 is less than half the
  3.9 target (the C-9 pace-controller item already open from Phase 4). The
  duration ladder is dominated by that: `arch.thai_striker` at 5.5 SLpM finishes
  in 2.6 minutes and `arch.champion_complete` at 3.1 in 7 minutes, while the
  starved T2/T3 archetypes run 8-13 minutes at the same tier gap.

### Also measured, also left

- **`targetState.braced` is a live trade-off.** The conservative reading shipped
  — braced only when the read produced *no* reactive answer that fitted the
  window — holds the headline batch at 11.3 min / 0.38 KD per 15 min / 55 %
  finishes, i.e. on the Phase 4 numbers. The broader reading (braced on any read
  while not mid-punch) measures 12.8 min / 0.21 / 35 % finishes: it trades the
  duration and knockdown targets for a finish share much closer to 09's ~32 %
  KO-TKO / ~49 % decision. Which one is right is a calibration decision to take
  together with `dmg.rawScale`, not separately from it.
- **Mirror symmetry, at scale.** Pooled over 1,000 seeded mirror bouts across
  five archetypes the lower id takes **47.7 %** of the decisive ones (460 of
  965, sd 1.6 pp) — 1.4 sd from even, so no residual bias is detectable above
  the noise, against the 70/30 it replaced. A 300-bout sample reads anywhere
  between 43 % and 53 %, which is why `tests/tiers.test.ts` pools and bands for
  its own sample size rather than asserting ±5 pp on 60 bouts per archetype.
  Three tie-breaks remain that all favour the *lower* id and are worth revisiting
  if a bias ever reappears: `(subMs, actorId, seq)` in P4, `perceived >= 0 ? 0 : 1`
  in `tenPointScore`, and the incumbent-wins tie in `contestInflight`.
- **Takedown accuracy is ~70-76 %** against a 38 % target — the Phase 4 item is
  unchanged in kind. Contested edges that are now beaten to the position appear
  as `stuffed` with `reason: 'contested'`, so the denominator is honest; the
  completion path itself still overshoots.
- **`beh.box.square_stance`'s "P(hit lands on chin/jaw) +0.15" and "takedown
  vulnerability +20 %"** are not wired: the first needs 02's sub-location
  weights to take a defender-side modifier, the second needs 03's takedown
  defence to. Both are one-line hooks in chapters Phase 5 did not open.
