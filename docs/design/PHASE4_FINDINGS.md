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
