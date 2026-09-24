# Phase 9 edge-case QA: findings

Independent QA pass over the sim and the app logic, run 2026-09-23.

**Build under test.** Engine `SIM_ENGINE_VERSION = 4.3.0`, git HEAD `3a78295` ("Phase 9: calibration batch
runner…"). A calibration agent was editing `src/sim/**` during the run, so every number below was measured on a
**clean export of HEAD** (`git archive HEAD src`, run from a scratch directory) unless the row says "WIP".
"WIP" means the working tree with that agent's uncommitted edits (bind.ts, engagement.ts, graph.ts, stats.ts,
catalogue.ts, and new takedowns.ts/subOffers.ts). Each finding also says whether it still reproduces on WIP.

**How to reproduce.** Probes are in `scripts/dev/qa-*.ts`. Run each one through the resource governor, for example
`node scripts/dev/heavy.mjs npx tsx scripts/dev/qa-refout.ts`. The pinned checks are in
`tests/qa.edgecases.test.ts`: 44 pass, 4 are `it.todo`, and 6 of the 44 are `it.fails` that pin QA-1, 2, 3, 5, 9 and 10.
The whole file runs in about 25 s.

## Findings

| ID | Sev. | What | Repro (seed / config) | Expected | Actual | Suspected location |
| --- | --- | --- | --- | --- | --- | --- |
| QA-1 | **critical** | In any bout with more than 2 fighters, the referee stops working after the first stoppage. `RefereeSystem.tick` latches `this.ended` and from then on returns it at the top of every tick. bind.ts therefore marks the same loser out again and emits `fighterOut` **on every tick**, and no later KO, TKO, count, stand-up or foul is ever officiated. As a result, every teams/ffa bout with 3+ fighters has exactly one early stoppage and then goes to the time limit. | `qa-refout.ts`: teams 3v3, 6x `arch.regional_pro_allrounder`, seeds `qa-multi-3v3-0..2`, mma.unified.3r/octagon_30. Also `qa-multi.ts 5 3v3`, `qa-multi.ts 5 ffa4`, `qa-multi.ts 6 1v5 arch.brand_new_brawler arch.champion_complete`. | Each fighter is stopped at most once, and later KOs are officiated. The bout ends when one side has nobody left. | Seed 0: first out at tick 327, then **8,674 `fighterOut` events** (73% of the 11,966-event log), 95 knockdowns after the first out, 0 referee events after it, and the bout goes 10,200 ticks to the time limit. The same happens in 3v3 (5/5 seeds), ffa4 (5/5), and 1v5 champion vs 5 novices (6/6: the champion lands 150+ sig strikes and stops nobody after the first). Reproduces on WIP. | `src/sim/rules/referee.ts:726` (latch); `src/sim/core/bind.ts:1488` (loser re-marked every tick) and `:1459` (tick call). The referee needs a per-fighter reset (clear `ended`/`pending` after a non-final stoppage) instead of a bout-level latch. |
| QA-2 | **major** | The `street` ruleset has no referee, and `streetTick` (incapacitation, flight, surrender, bystander separation) is never called by the loop. So under `street`, including every crowd bout, a knocked-out fighter is never stopped. | `qa-street.ts`: 1v1 champion vs brand-new brawler, `street`/`street_open`, maxSeconds 600, seeds `qa-street-0..5`. `qa-multi.ts 10 crowd2 arch.brand_new_brawler arch.champion_complete`; `qa-multi.ts 6 crowd5`. | Crowd/street bouts end by incapacitation, flight or separation. 09 §7 asks for that endings distribution to be reported. | HEAD: 6/6 1v1 street bouts run the full 600 s with up to 3 knockdowns each, 0 stoppages. Crowd: 16/16 run to the 180 s cap with nobody out; a lone defender absorbs ~170 sig strikes from 5 attackers. WIP: street bouts end only by submission, and a KO'd fighter (head acute 88.9) is struck until he is submitted. | `src/sim/rules/referee.ts:1557` (`streetTick`: no caller anywhere in `src/`). `src/sim/core/bind.ts` refereePhase returns early for `referee.present: false`. |
| QA-3 | **major** | A capped untimed bout (crowd/street) is recorded as `separated`, which 09 §3.1 defines as an indecisive ending, but `decideIfUnfinished` still gives it to the side with more live fighters. Crowd attackers therefore "win" every crowd bout (see QA-2), and a 1v1 street bout is given to the fighter with more sig strikes. | `qa-modes.ts 2` crowd rows; test `QA-3` (crowd 1v2, `qa-crowd-sep`, maxSeconds 30). | `separated` → `winner: 'none'`, `winningTeam: null`. | `winner: 'none', winningTeam: 1` in 100% of crowd bouts; 1v1 street gives `winner: 0`. | `src/sim/core/bind.ts:1643-1664` |
| QA-4 | **major** | Teams/ffa on the bell: the winner is "live headcount × 1000 + sig strikes landed". 09 §4.3 specifies judged team aggregates of effective-scoring counters. So at the bell a 1v5 always goes to the 5-side, and a 3v3 always goes to whichever side lost fewer fighters, however lopsided the fight was. With QA-1, that means whichever side lost the one early stoppage loses. ffa ranks only by sig strikes, not effective score. | `qa-modes.ts`: teams 1v5 CHM vs 5 BNB (timeLimit, team 1, 2/2). `qa-multi.ts 5 3v3` (the side with 3 live fighters wins 5/5). | Round-by-round team scoring as in 09 §4.3. | Headcount decides. | `src/sim/core/bind.ts:1643-1655` |
| QA-5 | **major** | Under the grappling and judo rulesets the AI throws strikes. `strikingFlagsFor` maps `grappling`/`judo` to the `mma` striking family, so punches, kicks and elbows stay in the candidate set. Each strike is then refused at contact, logged as a `foul` and dropped. | `qa-fouls.ts` (BJJ guard player vs Thai striker, grappling.ibjjf/mat_ibjjf, seeds `qa-fouls-0..5`); `qa-rules.ts 40` grappling rows; test `QA-5`. | No strikes are chosen in IBJJF, ADCC, sub-only or judo. | HEAD: 430 illegal-strike fouls in 6 IBJJF bouts (~72 per bout). The 40-bout batch has 2,834 (IBJJF), 2,184 (ADCC), 2,190 (sub-only) and 2,008 (judo). WIP: 560 in 6 bouts. Every one is "detected" and nothing is penalised (QA-6). | `src/sim/ai/actions.ts:171-173`; `src/sim/core/bind.ts:~920-930` (illegal strike → foul event, then dropped) |
| QA-6 | **major** | The foul machine cannot be reached. `RefTickInput.fouls` is never filled by bind.ts, so `onFoul` never runs: there are no warnings for fouls, no point deductions and **no DQ, ever**, in any ruleset. The `dq` method cannot occur. | Code read: `grep -n "fouls" src/sim/core/bind.ts` finds nothing. Measured: `qa-rules.ts 40` gives 0 `dq`, 0 point deductions across 560 bouts and 14 rulesets, with ~11,000 foul events. | Detected fouls reach the referee's ladder (06 §2). | Fouls are logged only. | `src/sim/core/bind.ts:1459` (`rt.ref.tick({...})` has no `fouls`); `src/sim/rules/referee.ts:780` |
| QA-7 | **major** | Tournament brackets stall on a draw or no-contest. The screen leaves the match open to be re-run, but the re-run uses the same fixed seed (`boutSeed(t.id,'tournament',flat)`) with the same fighters and the tournament's fixed settings, so it gives the same draw every time. The only way out is to edit a fighter's definition. At the measured 9% draw rate in even matchups (below), a 16-entrant single-elimination bracket of evenly rated fighters stalls about 76% of the time. | Code read: `src/app/screens/Tournaments.tsx:239` (seed) and `:262-268` (draw branch); the tournament settings are set to `DEFAULT_SETTINGS` at creation (`:198`) and never changed. | A draw has a resolution path, such as a re-run with a salted seed or a rule-based advance. | The match stays open, and re-runs repeat the draw. | `src/app/screens/Tournaments.tsx:239-268` |
| QA-8 | major (app) | Recorded runs are heavy. Frames are plain snapshot objects, not the typed-array columns of 09 §4.5. | `qa-perf.ts` / `qa-framemem.ts` (HEAD). | 09 §4.5 budgets ≈ 11 MB for 1v5 × 5 rounds. | A 1v1 5R recorded run is **+56 MB** heap (17,401 frames). A 1v5 5R recorded run (`qa-perf-1v5-1`) is **+163 MB** heap and 146 MB as JSON, takes 7.4 s, and the worker then structured-clones it to the main thread. QA-1 makes this worse: multi bouts go the full distance, and 60–70% of their events are duplicate `fighterOut`s. | `src/sim/record/recorder.ts:226-230`, `src/app/workers/simProtocol.ts` (frames array) |
| QA-9 | minor | A submission finish always calls `finishBout`. In a bout with more than 2 fighters where a submission comes while the victim's side still has live fighters, the whole bout would end instead of marking the victim out. Not observed in about 60 multi-fighter bouts: submissions only happened once the other side was down to one fighter. | Code read. | The victim is marked out, and the bout continues while their side still has live fighters (the same rule as the referee path at bind.ts ~1595). | The whole bout ends unconditionally. | `src/sim/core/bind.ts:1338`, `:1355` |
| QA-10 | minor | Result bookkeeping in multi-fighter bouts is inconsistent. A team that wins by submission gets `winner = <submitter id>` even when teammates are alive, but a team KO or time-limit win gets `winner: 'none'`. | `qa-multi.ts 8 2v2`, seed 0 (`sub.rnc`, winner 1, team 0) vs seed 2 (`timeLimit`, winner none, team 1). | One convention for team wins. | Mixed. | `src/sim/core/bind.ts:1338`, `:1600-1606` |
| QA-11 | minor | `grappling.subonly` ends a bout with no submission as `method: 'timeLimit', winner: 'draw'`. That method is meant for multi-fighter modes; a 1v1 draw should use a `draw*` method or the ruleset's overtime (EBI-style). | `qa-rules.ts 40 grappling.subonly`: 40/40 at HEAD, 3/30 on WIP. | `draw` (or overtime). | `timeLimit` + draw. | `src/sim/core/bind.ts:1643-1664` (sub-only has no judge panel) |
| QA-12 | minor | Validator: `style.pacing[].outputMult` and `riskAppetite` are only checked for finiteness, so -5 and 1e9 are accepted. The sim survives them. | `qa-custom.ts` rows "pacing"; test `QA-9`. | A range error (for example 0–3 and 0–1). | `ok: true`. | `src/app/store/validate.ts:952-953` |
| QA-13 | minor | Validator: a 1 cm tall, 10 g, 0.01-year-old fighter is legal. The error bound is `v <= 0`, so this produces only warnings. It derives and fights without NaN, loses every fight by KO, and at 1 cm still wins some fights by submission. | `qa-custom.ts` rows "min valid" / "mass 0.01"; test `QA-10`. | Hard lower bounds that make physical sense (for example height ≥ 1.0 m, mass ≥ 30 kg). | Warnings only. | `src/app/store/validate.ts:124-133` (`BODY_RANGES`) |
| QA-14 | minor | Built-in archetype data fails its own validator's whole-number check: `record.stanceExposure.orthodox` is 8.8 on `arch.regional_pro_allrounder`, and there are similar fractional values elsewhere. Warning only. | `qa-custom.ts` baseline row. | Integer counters. | A warning on a shipped archetype. | `src/sim/fighter/archetypes.ts` (stanceExposure) |

### Calibration observations (not QA bugs; handed to the calibration pass)

Measured at HEAD. These overlap the 09 §7 table the calibration agent owns, so they are not QA findings.
- **Non-MMA striking rulesets finish nearly everything.** In `qa-rules.ts 40` (mixed archetype pairings), boxing.pro
  had 40/40 KO, GLORY 40/40, K-1 38 KO + 2 TKO, and Muay Thai ABC 37/40 finishes. MMA 3R with the same pairings had
  33/40 KO. The champion mirror had 94/100 finishes.
- **Grappling and judo never finish.** IBJJF, ADCC and judo went to decision in 40/40 bouts each, and sub-only
  timed out in 40/40, with zero submissions or ippon. On WIP it flips to 65–87% submissions.
- **Draws are frequent and split decisions rare.** In the RPA mirror (200 bouts), draws were 18/200 = 9% (real
  MMA: ~1%) and split decisions were 6/102 = 6% of decisions (target 20%).
- **Referee breaks under IBJJF.** There were ~79 `refereeBreak` events per IBJJF bout at HEAD, although IBJJF has
  no stand-ups. WIP shows about 1, so this is probably already being changed.
- **Mid-tier separation and "untrained" upsets.** A mid-tier gap (skills 55/6 years vs 50/5 years, same body)
  gave 16–22: competitive, and as expected. A fighter with no disciplines at all beat RPA 4/40 (10%).

## What passed

All numbers are from HEAD `3a78295`, engine 4.3.0. WIP results are the same except where noted.

**1. Multi-fighter modes (apart from QA-1 to QA-4).**
- Every shape completes: 1v2, 1v3, 1v5, 2v2 and 3v3 teams; ffa 2/3/4/6; crowd 1v2/1v5/1v8; and crowd without
  `maxSeconds`, which falls back to the 180 s default.
- No run hit `core.maxTicks`.
- 0 non-finite or runaway positions, and 0 negative stamina, damage or balance values, with a snapshot scanned
  every 5 ticks (~120 bouts).
- `winner` and `winningTeam` always agree with `teams.teamOf`.
- App model: the 1v5 preset lays out 6 slots as `[0,1,1,1,1,1]`. NaN/oversized ffa and crowd counts are clamped.
  An empty seed, an empty slot, a duplicate fighter or an unknown id is refused with a readable message.

**2. Extreme stats (40 seeds each unless noted).**
- No crash, NaN or negative condition in any pairing.
- all-100 vs all-0: 40–0, all by KO/TKO, average 34 s.
- all-100 vs RPA: 40–0.
- all-0 vs RPA: 1–39.
- all-0 mirror: 20–16 with 4 draws, average 904 s, mostly decisions.
- Strength-only (strength 100, everything else 0) vs all-0: 33–5.
- Chin is directional (60 seeds against an RPA reference). Knockdowns suffered by the modified fighter: 26 at
  chin/neck/body 0, 18 at 50, 3 at 100. (T)KO losses: 22, 16, 5.
- Physical all 0 vs RPA: 11–46.
- Zero cardio vs RPA: 17–41.
- Mental all 0 vs RPA: 22–35.
- Reaction time 0 vs RPA: 25–30. That is weak, but chapter 01 says experts differ from novices in anticipation,
  not reaction time.

**3. Mirror match.**
- RPA vs RPA, 200 seeds: red 89, blue 93, draw 18. Red's share of decisive bouts is **0.489, 95% CI
  [0.417, 0.561]**. Finishes: red 43, blue 37.
- Champion mirror, 100 seeds: 48–52, CI [0.385, 0.577].
- Corner swap (pressure boxer vs counter striker, 50 seeds each way): the pressure boxer won 6/50 in red and
  8/50 in blue. No corner bias.
- Mirror ffa3/ffa4 and teams 2v2/3v3 (20 seeds each): no slot or team bias beyond noise (team 0: 12/20 and 9/20).

**4. Determinism.** All of the following hold:
- The same seed and config give an identical digest, tick count, RNG draw count, event count and result in 1v1,
  1v5 teams, ffa and crowd.
- A replay survives a JSON round trip and verifies (`verified: true`); a tampered fighter fails with
  `reason: 'digest'`.
- Running other bouts first changes nothing (order independence).
- Reversing the key order of every fighter object changes nothing.
- The sim makes 0 calls to `Math.random` and 0 calls to `Date.now` while running.
- The input config is not mutated.
- Empty, unicode and 100,000-character seeds all run and diverge from each other.

**5. Rules.**
- 3R and 5R results are internally consistent: round ≤ the scheduled rounds, `timeSeconds` ≤ the round length,
  and `totalSeconds = (round-1)*(round+break) + timeSeconds`.
- Judges' totals equal the sum of their cards, and the decision type (unanimous, split, majority,
  draw/majority/split draw) and the winner match the three totals in every decided bout (~560 bouts, 14 rulesets).
- The `settings.rounds` / `roundSeconds` override is honoured.
- Doctor stoppages (`tko.doctor`), split decisions, majority decisions and all three draw types occur.
- DQ never occurs (QA-6).
- No bout ended exactly on the bell, and no knockdown fell in the final second before a bell, in ~600 bouts.
  That edge could not be forced from outside and is **not verified**.

**6. Customisation.**
- The validator never throws. On garbage input (`null`, numbers, arrays, wrong types) it returns `ok: false`.
- It rejects each of the following with the exact field path and a readable message: negative, NaN or string
  height; mass 0 or 501; attribute 101, -1 or Infinity; a missing block; sub-skill 150; negative years; an unknown
  discipline; a bad stance; `disciplines: null`; `pressureBias` 101; a negative build blend; 50% limb asymmetry.
- These extremes are accepted with warnings, and every one derives and fights without NaN: every discipline at
  0 years/0 skill and at 60 (or 1e6) years/100 skill; career record 0 and 1e6; experience override 0/100; height
  3 m, reach 3.5 m; mass 500 kg; age 120; body fat 75% and 0.01%; weigh-in exactly at the lightweight limit and
  0.1 kg over it; a zero somatotype blend; every style-preference extreme; all 11 injury regions at severity 100;
  rust of 1e6 months; 168 h/week training; a 50% weight cut.
- `deriveRuntime` itself throws on non-numeric input, but the validator refuses that input first.

**7. Skill tiers (identical physical and mental 60).**
- Elite (skills 90, 15 years) vs novice (skills 10, 0 years): **36–3, 1 draw (92% of decisive bouts)**.
- Champion archetype vs brand-new brawler archetype: 39–1.
- Mid tier (55/6 years vs 50/5 years): 16–22 with 2 draws, which is competitive.

**8. Performance (headless, one process, governor-capped to 6 cores).**
- Full-distance 1v1: 3R median **616 ms** (max 695); 5R median **894 ms** (max 957).
- 1v5 3R going the distance: **2.4–3.1 s**. A 1v5 that ends early: 90–425 ms.
- Leak check, 500 mixed bouts in one process (1v1 3R/5R plus ffa3), 116 s: heap after GC went from **82.9 MB to
  87.2 MB** (sampled every 50 bouts: 86.4 → 87.7 → 87.2, flat). RSS was 346 MB. **No leak.**
- Recorded runs are heavy (QA-8).

## Test file

`tests/qa.edgecases.test.ts` has 48 entries: 38 plain passing tests, 6 `it.fails` for QA-1, QA-2, QA-3, QA-5, QA-12
and QA-13, and 4 `it.todo` for QA-4, QA-6, QA-9 and QA-11. It runs in about 25 s. Each `it.fails` was checked by running it as a plain `it`, and each one fails on the asserted
bug:
- QA-1: 2,137 `fighterOut` events for one fighter.
- QA-3: `winningTeam` is 1.
- QA-2: no incapacitation or flight ending.
- QA-5: 46 illegal-strike fouls in 3,000 ticks.
- QA-12 and QA-13: `ok` is true.

When one of those bugs is fixed, its `it.fails` will turn red; change it to `it`.
