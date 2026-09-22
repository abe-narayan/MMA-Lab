# 03 — Grappling: the positional state graph

Status: design, v1 (2026-09-22). Binding conventions: `docs/design/00_CONVENTIONS.md`. Replaces the 4-rung
ladder `guard → half → side → mount` and the single undifferentiated clinch described in `docs/AUDIT.md §1.1`.
Keeps and generalises the **engagement invariant** (`docs/AUDIT.md §3`).

Provenance tags follow conventions §1: `[S: FILE §n]`, `[D: …]`, `[E]`. In the catalogue tables a trailing
**src** column gives the tag that applies to **every untagged number in that row**; a number tagged inline
overrides the row tag. Every `[E]` is repeated in §9.3.

---

## 1. Purpose and scope

This section owns everything that happens once two fighters make grappling contact, and the standing
attacks that create that contact:

- the **node catalogue** (§2.2) — every clinch, takedown-in-progress, throw-in-progress, cage and ground
  position, including transient nodes (scramble, knocked-down);
- the **edge catalogue** (§2.3) — takedowns, throws, clinch transitions, passes, sweeps, escapes, back takes,
  get-ups, mat returns, scrambles, referee interventions, with duration, base probability, skill/physical/state
  modifiers and counters;
- **chain grappling** (§3), the **cage model** (§4), **ground-and-pound as a graph property** (§5),
  **control time / stalling / stand-up timers** (§6), **multi-opponent** rules (§7), **tier behaviours** (§8),
  and the **parameter registry, calibration hooks and assumptions** (§9).

Interfaces:

| Section | What crosses the boundary |
|---|---|
| §01 Fighter model | attributes (strength, explosiveness, flexibility, balance, massKg, heightM, cardio, reactionTime) and the discipline sub-skills named in §2.1.3. If §01 names them differently, §01's table is authoritative and the mapping is one-to-one. |
| §02 Striking | range nodes `pos.standing_long/mid/close` are owned by §02; §02 owns damage of every strike thrown from a grappling node (this section only says *which* strikes are available, at what rate and with what landing multiplier). Level changes off strikes, kick catches, knockdowns → ground entries are joint: §02 emits the trigger, this section resolves the grappling edge. |
| §04 Submissions | every `sub.*` id in this section is an **exit edge**: this section says from which node a submission may be entered and at what base entry rate; §04 owns stages, finish and the return node on failure. Ids used here (`sub.rnc`, `sub.guillotine_high_elbow`, `sub.guillotine_arm_in`, `sub.guillotine_standing`, `sub.darce`, `sub.anaconda`, `sub.arm_triangle`, `sub.triangle`, `sub.mounted_triangle`, `sub.mounted_guillotine`, `sub.armbar`, `sub.kimura`, `sub.americana`, `sub.omoplata`, `sub.gogoplata`, `sub.heel_hook_inside`, `sub.heel_hook_outside`, `sub.kneebar`, `sub.straight_ankle`, `sub.toe_hold`, `sub.north_south_choke`, `sub.ezekiel`, `sub.von_flue`, `sub.peruvian_necktie`, `sub.twister`, `sub.neck_crank`, `sub.calf_slicer`, `sub.crucifix_shoulder_lock`, `sub.electric_chair`, `sub.banana_split`) must match §04's id table; §04 wins on any conflict. |
| §05 Damage / physiology | fatigue (0–1), `state.rocked`, leg damage, grip fatigue; slam damage events emitted by lift/throw edges. |
| §06 Referee / judging | "work" events, control-time accrual, stand-up and clinch-break timers (§6), fouls (fence grab, back-of-head strikes, knees to a grounded head). |
| §07 AI / decision layer | edge availability and the tier behaviours in §8; the decision layer chooses *which* available edge to attempt and when; this section resolves it. |
| §07 Strategy & AI (multi-opponent, §07 §2.7) and §09 (match modes, §09 §3.1) | §7 here defines the engagement invariant; §07 owns targeting; §09 owns the multi-opponent manager (slots, fringe queue). [REVIEW: was "§08 Multi-opponent" — 08 is Presentation] |
| §08 Presentation | node ids are the animation keys (08 §5.7 pose table); `phase` and `progress` fields on an in-flight edge drive blending. |

Not in scope: submission mechanics (§04), striking damage (§02/§05), gi grappling rulesets (IBJJF/ADCC points
are listed as flags only; the engine's first target is MMA-unified).

---

## 2. Model

### 2.1 Foundations

#### 2.1.1 Engagement structure (the invariant, generalised)

```
Engagement {
  id, kind: 'clinch' | 'takedown' | 'throw' | 'ground' | 'scramble' | 'knockdown',
  node: PosId,                      // one node from §2.2
  a: FighterId, b: FighterId,       // 'a' is the slot the node table calls "controls"/"top"/"attacker"
  cage: boolean,                    // either fighter within 1.0 m of the fence  [S: WRESTLING §5.1] [S: BJJ_POSITIONS §5.3]
  underhookOwner: 'a' | 'b' | null, // cage-adjacent nodes: who benefits from the wall  [S: BJJ_POSITIONS §5.3]
  kuzushi: { dir: 0..7, mag: 0..3 },// standing tie-ups only  [S: JUDO §2.4]
  posture: 'chest' | 'postured',    // ground top slot: chest-to-chest vs postured to strike  [S: BJJ_POSITIONS §3.2 T12]
  inflight?: { edge: EdgeId, tStart, dur, phase },   // at most one contested edge resolving per engagement
  timers: { sinceWork, sinceStrikeOrTd, dwell, pinClock }   // feed §6
}
```

**Invariant I1** — a fighter is in at most one engagement. **I2** — a grounded fighter (any part but the
soles touching, 2024 Unified definition [S: BJJ_POSITIONS §9.4]) is always the `a` or `b` of exactly one
`ground`/`scramble`/`knockdown` engagement, so the world decomposes into top/bottom pairs plus free standing
fighters. **I3** — a `clinch`/`takedown`/`throw` engagement holds exactly two fighters. **I4** — every edge
names a from-node and resolves to nodes reachable in the catalogue; the engine validates the graph at load
(`scripts/consistency.ts` extends the existing sweep [S: AUDIT §1.4]). **I5** — a `scramble` resolves within
2,000 ms [S: WRESTLING §6] (4,000 ms hard cap [S: BJJ_POSITIONS §8 r26]).

Top-slot posture is a flag, not a node (BJJ_POSITIONS models it as a `*_GNP` sub-state; we fold it into the
`posture` field so animation and the §5 tables can read it uniformly).

#### 2.1.2 Resolution

Every contested edge resolves once, at `tStart + dur` (conventions §2: dt = 100 ms; durations are rounded up
to ticks). Probability per conventions §4:

```
P = clamp( sigmoid( logit(base) + k_skill·(skillAtt − skillDef)/100 + Σ phys + Σ state ), 0.03, 0.95 )
```

Clamp bounds `[0.03, 0.95]` [S: WRESTLING §9 preamble] (BJJ_POSITIONS uses `[0.02, 0.95]`; we adopt the
tighter lower bound). Two-stage edges (leg attacks: **capture** then **finish**) roll each stage separately
[S: WRESTLING §9 r8]. Concurrent bottom/top attempts in a ground node are resolved as a contested pair: the
attacker's `P` versus the defender's counter-edge `P`, higher-tier fighter first on ties [S: BJJ_POSITIONS §8 r2].

The **base** column is T4 vs T4, fresh, open mat (conventions §4). Research sources quote bases "vs a competent
defender of equal tier" (WRESTLING §3 preamble; BJJ_POSITIONS §3.1; JUDO §3 no-gi column) or "T2 vs T2"
(MUAY_THAI §3.1). Because the model carries only the **gap**, an equal-tier value is adopted unchanged as the
T4-vs-T4 base `[D: equal-tier value, gap = 0]`; tier-*level* effects enter through availability, chain rates
and behaviours (§8), consistent with FIGHT_DATA §5's rule that the skill gap, not the level, drives conversion
differences [S: FIGHT_DATA §5].

#### 2.1.3 Sub-skills used by this section (interface to §01)

The edge tables use short **aliases** to keep cells readable. Each alias resolves to one §01 sub-skill
(`docs/design/01_FIGHTER_MODEL.md §2.3.1`, effective values after style/background offsets) or to a declared
composite. §01 is authoritative for names; this table is the binding map.

| alias | resolves to (§01 id) | meaning here | typical defensive pairing |
|---|---|---|---|
| `wr.shot` | `wrestling.shots` | level change, penetration, leg-attack entries | `wr.sprawl` |
| `wr.finish` | `wrestling.finishes` | finishing captured legs (run the pipe, drive, lift, trip, dump) | `wr.sprawl` |
| `wr.sprawl` | `wrestling.takedownDefence` | sprawl, whizzer, limp leg, hip-in, re-shot denial | — |
| `wr.pummel` | `wrestling.clinch` | pummelling, underhooks, body locks, head position, snap-downs | `wr.pummel` |
| `wr.mat_return` | `wrestling.matReturns` | rear body-lock returns, lifts, knee-behind-knee | `wr.get_up` |
| `wr.ride` | `wrestling.topControl` | turtle / referee-position rides, tight waist, hooks, keeping position after a TD | `wr.get_up` |
| `wr.scramble` | `wrestling.scrambles` | funk, sit-outs, granby, hip heist | `wr.scramble` |
| `wr.get_up` | `max(wrestling.getUps, mmaIntegration.getUps)` `[E]` | technical stand-up, wall walk, wrestle-up, turtle stand | `wr.ride` / `bjj.top_control` |
| `wr.chain` | `wrestling.chains` | chain propensity and depth (§3.1) | — |
| `jd.grip` | `max(judo.gripFighting, judo.kuzushi)` `[E]` | no-gi tie fighting and building the kuzushi vector | `jd.grip` |
| `jd.throw_fwd` | `judo.throws` | hip / shoulder / inner-thigh forward throws | `jd.throw_def` |
| `jd.throw_rear` | `judo.throws` | reaps, trips, rear throws (same §01 skill; the split is for the AI's technique weights) | `jd.throw_def` |
| `jd.foot_sweep` | `judo.footSweeps` | timing sweeps (de ashi, sasae, ko uchi) | `jd.throw_def` |
| `jd.counter` | `judo.counters` | sukashi, gaeshi, tani otoshi, te guruma as counters | `jd.throw_fwd` / `jd.throw_rear` |
| `jd.throw_def` | `max(judo.gripFighting, wrestling.takedownDefence)` `[E]` (composite; §01 has no separate throw-defence skill) | posture, hip-in, stepping around, base | — |
| `bjj.pass` | `bjj.passing` | guard passing | `bjj.retention` |
| `bjj.retention` | `bjj.guard` | guard retention, re-guarding, frames | — |
| `bjj.sweep` | `bjj.sweeps` | sweeps and bottom reversals | `bjj.top_control` |
| `bjj.escape` | `bjj.escapes` | escapes from side / mount / back / kesa / N-S / KOB | `bjj.top_control` |
| `bjj.top_control` | `max(bjj.topControl, wrestling.topControl)` `[E]` | pins, pressure, advancing mount/back | `bjj.escape` |
| `bjj.back_control` | `bjj.backControl` | hooks, body triangle, hand fighting from the back | `bjj.escape` |
| `bjj.leg_entangle` | `bjj.legLocks` | ashi / SLX / 50-50 / saddle entries and control (finishes are §04) | `bjj.retention` |
| `mma.level_change` | `mmaIntegration.levelChanges` | shots and clinch entries off strikes, feints, reactive timing | `mma.anti_wrestling` |
| `mma.anti_wrestling` | `max(wrestling.takedownDefence, mmaIntegration.transitions)` `[E]` | reading the shot, sprawl-and-punish, front-headlock offence | `mma.level_change` |
| `mma.cage` | `max(mmaIntegration.cageWork, wrestling.cageWrestling)` `[E]` | cage wrestling both ways: pinning, hip-in, wall walking, denying the wall | `mma.cage` |
| `mma.gnp` | `mmaIntegration.groundAndPound` | striking from top positions without losing position | `bjj.retention` / `bjj.escape` |
| `mma.clinch_strike` | `max(mmaIntegration.clinchStriking, muayThai.clinch)` `[E]` | dirty boxing, plum, knees and elbows in tie-ups (damage owned by §02) | `mma.clinch_strike` |
| (kick catching) | `muayThai.catches` | `tech.kick_catch` attacker skill | opponent's `muayThai.kicks` / `kickboxing.kicks` (§02) |
| (sambo) | `sambo.takedowns` → `wr.shot`, `sambo.throws` → `jd.throw_*`, `sambo.gripFighting` → `jd.grip`, `sambo.topControl` → `bjj.top_control` | §01 resolves the effective value across disciplines with its transfer factor; this section reads the effective alias only | — |

Tier is per discipline (conventions §3). Where an edge names two aliases for one side (e.g. `wr.finish ∥ jd.throw_rear`)
the engine uses the **max** [E]. Submission-stage skills (`sk.chokes`, `sk.jointLocks`, `sk.legLocks`,
`sk.escapes`, `sk.control`, `sk.guard`, `sk.scramble`) are §04's; `sk.scramble` = `wr.scramble` and
`sk.control` / `sk.guard` = `bjj.top_control` / `bjj.retention` here.

Discipline-background transfer offsets (applied by §01 when deriving sub-skills, quoted here because they were
sourced by the grappling research): freestyle +10 leg attacks / +5 mat returns / +5 scrambles; folkstyle +8 /
+2 clinch / +10 rides / +10 scrambles; Greco −5 leg attacks / +15 clinch-cage / +5 mat returns; judo-sambo
−5 / +10 clinch / +5; BJJ-only −15 / −5 / −5 / +5 scrambles [S: WRESTLING §7]. The Greco +15 is a design choice
[S: WRESTLING §10].

#### 2.1.4 Modifier codes (used in the edge tables)

All in logit units. Attribute deltas are attacker minus defender unless marked `d` (defender's own value).

| code | term | derivation |
|---|---|---|
| `STR+` | +0.10 per 10 attribute points of strength advantage (`STR++` = +0.20) | `[D: WRESTLING §9 r3 P += 0.002/pt ⇒ 0.002/0.24 (sigmoid slope at P≈0.4) = 0.0083 logit/pt ≈ 0.08/10 pt; rounded 0.10]` |
| `MASS+` | +0.16 per 10 kg mass advantage (`MASS++` = +0.32; cap ±0.6 per code) | `[D: WRESTLING §9 r3 0.004/kg ⇒ 0.017 logit/kg; BJJ_POSITIONS §3.3 +0.08 per 5 kg]` |
| `EXP+` | +0.10 per 10 pts explosiveness advantage | `[E]` (JUDO §3 lists EXP for shots/lifts qualitatively) |
| `FLX+` | +0.10 per 10 pts flexibility advantage | `[E]` (JUDO §8 r7 ±0.03 per point on a 0–10 scale ≈ 0.3 per 10 % ⇒ rounded down for 0–100 scale) |
| `BALd` | −0.10 per 10 pts of defender balance above 50 | `[E]` (JUDO §3 "uke +BAL") |
| `HGT+` / `HGT−` | +0.05 per 10 cm the attacker is taller / shorter | `[D: JUDO §8 r7 +0.01 P per 2 cm ≈ 0.04 logit/2 cm ⇒ 0.2/10 cm; halved to 0.05 for no-gi because head/body handles reduce the leverage effect [E]]` |
| `RCH+` | +0.05 per 10 cm reach advantage | `[E]` (WRESTLING §3.6 ankle pick "long arms +5 pp") |
| `FAT−` | −1.0 × attacker fatigue (0–1); `FAT−−` = −2.0 | `[D: WRESTLING §9 r4 −0.25 P at FAT 1 ⇒ −1.04 logit; BJJ_POSITIONS §3.3 −0.9]` |
| `FATd+` | +1.0 × defender fatigue | same |
| `SETUP` | +0.63 if the edge fires ≤ 500 ms after a landed/committed strike, level-change feint, or reactively to the opponent's committed strike | `[D: WRESTLING §9 r5 +0.15 P ⇒ 0.63 logit]`; MMA_INTEGRATION §2.1 I-2/I-3 +10–15 pp `[S]` |
| `TELE` | −0.63 if shot from > 1.5 m with no setup | `[D: WRESTLING §9 r5 −0.15 P]` |
| `CAGE±x` | ±x when `cage = true` (value per edge) | WRESTLING §5.2; BJJ_POSITIONS §3.3 ±0.35 per `+` |
| `UHO` | +0.35 for the `underhookOwner` on cage-adjacent get-up/pin edges, −0.35 for the other | `[S: BJJ_POSITIONS §5.3 r4]` |
| `STK+` | +0.20 per landed ground/clinch strike by the actor in the last 5 s (max 3) | `[D: BJJ_POSITIONS §3.3 +0.25/strike; MMA_INTEGRATION I-16 +10–20 pp for 2+ strikes ⇒ 0.6 logit at 3 strikes ≈ +14 pp at P 0.4]` |
| `STK−` | −0.20 per strike absorbed by the actor in the last 5 s (max 3) | same |
| `POST` | +0.40 for bottom edges while top `posture = 'postured'` | `[S: BJJ_POSITIONS §3.3 posture bonus]` |
| `RCK` | +0.80 for the attacker when the defender is `state.rocked`; a rocked attacker may not initiate takedown/throw edges | `[E]` |
| `WET` | −0.15 on grip-dependent edges from round 3 or when the blood flag is set | `[S: BJJ_POSITIONS §3.3]` |
| `KUZ` | ×(0.5 + 0.25·mag) if the throw's required kuzushi direction is within 45° of the vector; ×0.5 if unaligned; ×0.3 if opposite — applied to P, not logit | `[S: JUDO §8 r6]` |
| `CHAIN` | see §3 | — |
| `LEGDMG` | −0.30 per 25 % damage on the attacker's driving leg for shots/drives; +0.30 for the attacker when the defender's base leg is ≥ 50 % damaged | `[E]` (interface to §05 leg pools) |

Multiplicative codes (`KUZ`, tier multipliers) are applied to `P` after the sigmoid, then re-clamped.

---

### 2.2 Node catalogue

Columns: **ctrl** = how hard it is for the non-controlling fighter to improve (0–10); **strike T/B** = strike
potential for controlling (top/attacker) and other (bottom/defender) slot (0–10); **subs T/B** = submission
exits available to each slot (ids per §04); **esc** = escape/break difficulty for the non-controlling slot at
equal skill (0–10); **cage** = whether a cage variant exists (`flag` = same node with `cage = true`, `node` =
separate node, `—` = n/a). Ratings for ground nodes are `[S: BJJ_POSITIONS §2]`; standing ratings are `[E]`
unless tagged. Dwell = typical seconds before a transition at equal elite skill `[S: BJJ_POSITIONS §2]` / `[E]`
for standing.

#### 2.2.1 Standing free (owned by §02; entry nodes here)

| id | description | controls | ctrl | strike T/B | subs T/B | esc | cage | dwell s | src |
|---|---|---|---|---|---|---|---|---|---|
| `pos.standing_long` | out of punching range (kicks/teeps only) | neither | 0 | 6/6 | — | — | flag | §02 | [E] |
| `pos.standing_mid` | punching range | neither | 0 | 8/8 | — | — | flag | §02 | [E] |
| `pos.standing_close` | pocket, < 0.8 m: clinch entries, level changes, hooks/uppercuts | neither | 0 | 8/8 | — | — | flag | §02 | [E] |
| `pos.standing_cage` | = any standing node with `cage = true`: defender's back ≤ 1.0 m from the fence; pressurer has initiative | pressurer | 1 | 8/7 | — | 2 (circle out) | is the flag | 3–15 | [S: WRESTLING §2] |

#### 2.2.2 Standing tie-ups (clinch)

| id | description | controls | ctrl | strike T/B | subs T/B | esc | cage | dwell s | src |
|---|---|---|---|---|---|---|---|---|---|
| `pos.clinch_hand_fight` | wrist / inside-bicep control, no head or body control; the no-gi kumi-kata node; grips slip 20 % per 5 s without re-pummel | slight edge to inside position | 1 | 5/5 | — | 1 | flag | 2–6 | [S: JUDO §2.2 N2/N9] [S: JUDO §8 r12] |
| `pos.clinch_collar_tie` | one hand behind the head, other on wrist/elbow/bicep; dirty-boxing node | head-control holder, small edge | 2 | 7/6 (short uppercuts, hooks, elbows, knees) | `sub.guillotine_standing` (T, on a ducking head) / — | 2 | flag | 3–10 | [S: WRESTLING §2] [S: WRESTLING §5.4] |
| `pos.clinch_thai_plum` | double collar tie, forearms inside, elbows pinched; strong downward kuzushi | holder ("narrow" dominance) | 4 | 9/3 (straight/stabbing knees, snap-down, turn) | — / — | 4 | flag | 3–8 | [S: MUAY_THAI §4.1] |
| `pos.clinch_over_under` | symmetric 50/50: each has one underhook, one overhook; the default MMA clinch; pummel exchange every 3 s decides deeper underhook / head position | whoever has head position + deeper underhook (`underhookOwner`) | 3 | 5/5 (knees to thigh/body, short elbows, foot stomps) | — / — | 3 | flag | 5–20 | [S: JUDO §2.2 N5] [S: WRESTLING §5.3] |
| `pos.clinch_underhook` | a single underhook with b whizzering (overhook) that arm; a's other hand on wrist/collar; the "inside position" node — best entry node for high crotch, trips, knee taps, slide-by | underhook holder | 4 | 6/4 | — / — | 4 | flag | 3–10 | [S: WRESTLING §2] [S: JUDO §2.2 N3] |
| `pos.clinch_overhook_control` | overhook holder dominates: deep whizzer + hip pressure + head post, attacker's head outside (typical after a stuffed head-outside single or a lost pummel); unlocks whizzer throw, harai goshi, hip toss | overhook holder | 3 | 5/4 | — / — | 3 | flag | 2–6 | [S: WRESTLING §3.2 whizzer] [S: JUDO §2.2 N4] |
| `pos.clinch_double_under` | a has both underhooks (b has double overhooks) | a, strongly | 6 | 5/3 (knees; b: elbows over the top) | — / `sub.guillotine_standing` (b, rare: 0.05 entry [E]) | 6 | flag | 3–8 | [S: WRESTLING §2] |
| `pos.clinch_body_lock_front` | hands locked (S-grip/gable) around waist from the front, over-under or double-under lock, hips in | lock holder | 6 | 3/4 (b: elbows, short punches over the top) | — / `sub.guillotine_standing` (b, 0.05 [E]) | 6 | flag | 3–10 | [S: WRESTLING §2] [S: JUDO §2.2 N7] |
| `pos.clinch_body_lock_rear` | a behind b, hands locked around waist; the standing back / mat-return node (= BJJ `BACK_STANDING`) | a | 6 | 3/2 (a: punches to side of head while standing; b: back elbows, foot stomps) | `sub.rnc` (a, standing, rare 0.03 entry [E]) / — | 5 | node → `pos.clinch_cage_pin_rear` | 5–20 | [S: WRESTLING §2] [S: BJJ_POSITIONS §2.2] |
| `pos.clinch_front_headlock` | a controls b's head + one arm (chin strap / elbow pull), b bent over standing or on one knee; reached by snap-down or stuffed shot | a | 5 | 6/2 (knees to body, uppercuts, elbows to side of head) | `sub.guillotine_high_elbow`, `sub.guillotine_arm_in`, `sub.darce`, `sub.anaconda`, `sub.peruvian_necktie` (a) / — | 5 | flag | 3–10 (decays after 4 s of no progress) | [S: WRESTLING §2] [S: WRESTLING §9 r12] |
| `pos.clinch_head_and_arm` | a's arm around b's head/neck + overhook or arm control; Rousey entry node for koshi guruma/harai | a | 4 | 5/4 | `sub.guillotine_arm_in` (a) / — | 3 | flag | 2–6 | [S: JUDO §2.2 N6] |
| `pos.clinch_two_on_one` | Russian tie: both a's hands on one of b's arms | a | 4 | 4/3 (b: free-hand punches) | — / — | 3 | flag | 2–6 | [S: JUDO §2.2 N8] |
| `pos.clinch_cage_pin_front` | a chest-to-chest with b flattened on the fence (underhook/body lock/collar), b's back on the cage; pummel sub-battle every 3 s; pinned fighter pays ×1.3 energy | a | 6 | 6/4 (a: knees to thigh/body, short elbows, foot stomps; b: elbows over the top, knees, foot stomps) | `sub.guillotine_standing` (a, if b ducks in, 0.05 [E]) / — | 6 | is the cage node | 5–40 | [S: WRESTLING §2] [S: WRESTLING §5.2] |
| `pos.clinch_cage_pin_rear` | rear body lock with b's front on the fence | a | 7 | 4/2 | `sub.rnc` (a, standing 0.03 [E]) / — | 6 | is the cage node | 5–30 | [S: WRESTLING §2] |

#### 2.2.3 Attacks in progress (transient, contested)

| id | description | controls | ctrl | strike T/B | subs T/B | esc | cage | dwell s | src |
|---|---|---|---|---|---|---|---|---|---|
| `pos.td_single_leg_in` | one leg captured. Sub-fields `head: inside|outside`, `leg: low|hip|chest`, `cage` | attacker ≈ 55/45 | 4 | 2/5 (b: punches/elbows to head, knees to thigh of posted leg if a's head down) | `sub.guillotine_standing` (b, on head-outside low head) / — | 4 | flag (cage single is the modern MMA chain hub) | 1.5–15 (cage up to 40) | [S: WRESTLING §2] [S: WRESTLING §8.4] |
| `pos.td_double_leg_in` | both legs captured, head outside on hip, penetration complete | attacker | 5 | 1/4 (b: hammerfists/elbows to back of shoulders; back-of-head illegal) | `sub.guillotine_standing` (b) / — | 4 | flag | 1–8 | [S: WRESTLING §2] |
| `pos.td_high_crotch_in` | one leg captured, head **inside** on chest, shoulder in the crotch | attacker | 5 | 1/3 | — (whizzer weak vs HC) / — | 4 | flag | 1.5–8 | [S: WRESTLING §2] [S: WRESTLING §3.4] |
| `pos.td_low_single_in` | hand on ankle, attacker's knee on the mat, head low | contested 50/50 | 3 | 1/6 (b: punches down on the head, knees illegal only if a is "grounded" — a is, so knees to head illegal under unified rules) | `sub.guillotine_standing` (b) / — | 3 | flag (needs open mat, CAGE−) | 1–4 | [S: WRESTLING §3.2] |
| `pos.td_sprawl` | defender has sprawled onto the shooter: hips back, chest on a's upper back/head; a on knees | defender (now attacker) | 5 | 6/1 (knees to body of the shooter; knees to head illegal if shooter grounded; punches to side of head) | `sub.guillotine_high_elbow`, `sub.darce`, `sub.anaconda` (defender) / — | 4 | flag (sprawl −0.42 on cage) | 1–5 | [S: WRESTLING §2] [S: BJJ_POSITIONS §2.7] |
| `pos.td_lifted` | defender's feet off the mat (double/body-lock/HC lift, suplex arch); slam pending | attacker | 8 | 0/2 | `sub.guillotine_standing` (b, "finish into the guillotine") / — | 2 (hook a leg, grab cage = foul) | flag | 0.5–1.5 | [S: WRESTLING §3.3] [S: JUDO §3 ura nage] |
| `pos.throw_in_progress` | a committed judo throw (tsukuri started); resolves in 700–1,400 ms to landing or the failure table | attacker | — | 0/0 | — / — | — | flag | 0.7–1.4 | [S: JUDO §3 exec time] |
| `pos.td_kick_caught` | a holds b's kicking leg; b hopping on one leg | catcher | 4 | 7/3 (a: punch/knee while holding, kick the post; b: punches/elbows while held) | — / — | 3 | flag | 0.3–2 | [S: MUAY_THAI §3.1] |

#### 2.2.4 Ground — mount family (slots: top `a`, bottom `b`)

| id | description | controls | ctrl | strike T/B | subs T/B | esc | cage | dwell s | src |
|---|---|---|---|---|---|---|---|---|---|
| `pos.ground_mount_low` | top on hips/thighs, knees on mat, grapevines optional | top | 7 | 5/1 | `sub.arm_triangle`, `sub.ezekiel`, `sub.americana` / — | 6 | flag (bottom near fence: shrimp blocked one side) | 15–40 | [S: BJJ_POSITIONS §2.1] |
| `pos.ground_mount_high` | knees in armpits, bottom's arms pinned/trapped; best pure GnP node; primary TKO node | top | 8 | 9/0 | `sub.armbar`, `sub.arm_triangle`, `sub.mounted_triangle`, `sub.mounted_guillotine` / — | 8 | flag | 10–30 | [S: BJJ_POSITIONS §2.1] |
| `pos.ground_mount_s` | S-mount: one knee by the head, hips over chest, arm isolated | top | 8 | 8/0 | `sub.armbar` (primary), `sub.mounted_triangle` / — | 8 | flag | 5–15 | [S: BJJ_POSITIONS §2.1] |
| `pos.ground_mount_tech` | technical mount: bottom turned to side, top's knee behind head, foot posted, chest on shoulder; gateway to back | top | 8 | 7/0 | `sub.armbar` (far arm), `sub.arm_triangle` / — | 7 | flag | 5–15 | [S: BJJ_POSITIONS §2.1] |

`posture = 'postured'` on any mount node = BJJ `MOUNT_GNP` (ctrl 6, dmg 10, esc 5) [S: BJJ_POSITIONS §2.1].

#### 2.2.5 Ground — back family

| id | description | controls | ctrl | strike T/B | subs T/B | esc | cage | dwell s | src |
|---|---|---|---|---|---|---|---|---|---|
| `pos.ground_back_hooks` | two hooks + seatbelt; bottom belly-down, on side or supine | top | 9 | 5/0 | `sub.rnc`, `sub.armbar` (rare) / — | 8 | flag (fence within reach enables wall-walk escape) | 20–90 | [S: BJJ_POSITIONS §2.2] |
| `pos.ground_back_body_triangle` | body triangle instead of hooks; ribs compressed; hook-stripping prevented | top | 9 | 4/0 | `sub.rnc` / — | 9 | flag | 30–120 | [S: BJJ_POSITIONS §2.2] |
| `pos.ground_back_one_hook` | one hook in, other leg free or being stripped; bottom often on the choking-arm hip | top (weak) | 6 | 4/0 | `sub.rnc` (rushed) / — | 5 | flag | 5–15 | [S: BJJ_POSITIONS §2.2] |
| `pos.ground_back_seatbelt` | seatbelt/rear body lock on a turtled or kneeling opponent, no hooks | top (weak) | 6 | 4/0 | `sub.rnc` (if chin exposed) / — | 5 | flag | 5–20 | [S: BJJ_POSITIONS §2.2] |
| `pos.ground_crucifix` | crucifix from back or side/turtle: one arm trapped by legs, other by arms; unanswered strikes | top | 9 | 8/0 | `sub.rnc` (arm-in), `sub.neck_crank`, `sub.crucifix_shoulder_lock` / — | 8 | flag | 10–40 | [S: BJJ_POSITIONS §2.2, §2.3] |

#### 2.2.6 Ground — side-control family

| id | description | controls | ctrl | strike T/B | subs T/B | esc | cage | dwell s | src |
|---|---|---|---|---|---|---|---|---|---|
| `pos.ground_side` | cross-body, chest-to-chest, cross-face + underhook or hip block | top | 7 | 6/1 | `sub.arm_triangle`, `sub.kimura`, `sub.americana`, `sub.darce`/`sub.anaconda` (on turn-in), `sub.north_south_choke` / — | 6 | flag → ctrl 8, esc 7 when bottom's head/shoulders on the fence (`SIDE_CONTROL_WALL`) | 15–45 (20–60 wall) | [S: BJJ_POSITIONS §2.3] |
| `pos.ground_side_kesa` | scarf hold: head + near arm trapped under armpit, hips beside | top | 7 | 5/1 | scarf armlocks (`sub.americana` variant), `sub.arm_triangle` / — | 7 | flag | 15–40 | [S: BJJ_POSITIONS §2.3] |
| `pos.ground_side_reverse_kesa` | reverse scarf: facing the legs, chest on chest; mount entry node | top | 7 | 4/1 | `sub.kimura` / — | 6 | flag | 5–20 | [S: BJJ_POSITIONS §2.3] |
| `pos.ground_side_kob` | knee on belly/sternum, posted foot, upright; mobile; punches | top | 6 | 7/1 | `sub.armbar` (far arm), `sub.darce` (on turn-in) / — | 4 | flag | 5–15 | [S: BJJ_POSITIONS §2.3] |
| `pos.ground_north_south` | chest on chest, heads opposite; only body knees legal for top | top | 7 | 3/0 | `sub.north_south_choke`, `sub.kimura`, `sub.armbar` (spin) / — | 6 | flag | 10–30 | [S: BJJ_POSITIONS §2.3] |

#### 2.2.7 Ground — half guard family

| id | description | controls | ctrl | strike T/B | subs T/B | esc | cage | dwell s | src |
|---|---|---|---|---|---|---|---|---|---|
| `pos.ground_half_flat` | bottom flat, top has cross-face + underhook or head control; the most common MMA ground node (wrestlers' default landing) and the highest-volume GnP node | top | 6 | 7/2 | `sub.arm_triangle`, `sub.darce` (when bottom turns), `sub.kimura` / `sub.kimura` (on posting arm), `sub.guillotine_high_elbow` (on posture break), `sub.triangle` (rare) | 5 | flag | 20–60 | [S: BJJ_POSITIONS §2.4] |
| `pos.ground_half_knee_shield` | Z-guard: bottom on side, knee shield across hip/chest, far frame; best MMA half guard for distance + get-up | bottom (weakly) | 4 | 3/2 | — / `sub.kimura`, `sub.triangle` (on shield removal), SLX entries | 3 | flag | 10–30 | [S: BJJ_POSITIONS §2.4] |
| `pos.ground_half_underhook` | bottom on side with the underhook, head under top's chin; gateway to dogfight/back/wrestle-up | bottom (weakly) | 4 | 3/1 | — / back take, wrestle-up | 3 | flag (UHO) | 5–20 | [S: BJJ_POSITIONS §2.4] |
| `pos.ground_half_dogfight` | both on knees, bottom has underhook, top has whizzer; scramble-like | contested 55/45 to underhook | 3 | 2/2 | `sub.guillotine_high_elbow`/`sub.darce` (top, whizzer side) / — | 2 | flag | 3–10 | [S: BJJ_POSITIONS §2.4] |
| `pos.ground_half_deep` | deep half: bottom under top's hips hugging the leg; sweep-rich, striking-poor for top | bottom (weakly) | 5 | 4/0 | `sub.kimura` (top), back take if bottom exposes / sweeps, back take | 4 | flag | 5–20 | [S: BJJ_POSITIONS §2.4] |
| `pos.ground_half_lockdown` | 10th Planet lockdown: bottom's legs lock and stretch top's leg | bottom (weakly) | 5 | 4/0 | — / `sub.electric_chair`, `sub.banana_split`, whip-up | 4 | flag | 10–30 | [S: BJJ_POSITIONS §2.4] |
| `pos.ground_half_quarter` | quarter guard: only the foot/ankle trapped; almost passed | top | 8 | 7/0 | as `pos.ground_side` / — | 7 | flag | 5–15 | [S: BJJ_POSITIONS §2.4] |
| `pos.ground_half_butterfly` | half butterfly: bottom's inside leg has a hook | bottom (weakly) | 4 | 3/1 | — / elevation sweeps, SLX entries | 3 | flag | 5–20 | [S: BJJ_POSITIONS §2.4] |

#### 2.2.8 Ground — closed guard family

| id | description | controls | ctrl | strike T/B | subs T/B | esc | cage | dwell s | src |
|---|---|---|---|---|---|---|---|---|---|
| `pos.ground_closed_posture_up` | top postured (spine vertical, hands on hips/biceps or posting), ankles crossed | top for striking, bottom for control | 4 | 5/2 | — / `sub.kimura` (posting arm), `sub.armbar`/`sub.triangle` only after posture break | 4 | flag | 10–40 | [S: BJJ_POSITIONS §2.5] |
| `pos.ground_closed_posture_broken` | top's head pulled down, overhooks/collar tie, hips controlled; bottom's attacking node | bottom | 2 | 2/3 | — / `sub.triangle`, `sub.armbar`, `sub.kimura`, `sub.guillotine_high_elbow`, `sub.omoplata`, arm-drag → back, sweeps | 2 | flag | 10–30 | [S: BJJ_POSITIONS §2.5] |
| `pos.ground_closed_high` | legs high on the back, one leg over the shoulder; elite bottom node | bottom | 1 | 1/2 | — / `sub.triangle`, `sub.armbar`, `sub.omoplata` | 1 | flag | 5–20 | [S: BJJ_POSITIONS §2.5] |
| `pos.ground_closed_rubber` | rubber guard / mission control | bottom | 2 | 1/1 | — / `sub.gogoplata`, `sub.omoplata`, `sub.triangle` | 2 | flag | 10–30 | [S: BJJ_POSITIONS §2.5] |
| `pos.ground_closed_top_standing` | top has stood inside closed guard, hands on chest/hips; about to open | top (weakly) | 5 | 4/3 (bottom: up-kick when guard opens) | — / `sub.kneebar`/`sub.heel_hook_*` via SLX entry, ankle-grab sweeps | 4 | flag | 3–10 | [S: BJJ_POSITIONS §2.5] |

#### 2.2.9 Ground — open guards

| id | description | controls | ctrl | strike T/B | subs T/B | esc | cage | dwell s | src |
|---|---|---|---|---|---|---|---|---|---|
| `pos.ground_open_legs_up` | "up-kick guard": bottom supine, feet on hips/thighs, top **standing** (BJJ `OPEN_SUPINE_LEGS_UP` + `STANDING_OVER_GUARD` merged: same pair). Up-kicks to the head legal (top not grounded); top: diving punches, leg kicks to thighs; the most common stand-up-vs-ground state | top (weakly) | 3 | 4/4 | — / up-kick KO threat, `sub.straight_ankle`/SLX entries | 4 (to stand) | flag (wall gives a post: get-up +) | 5–20 | [S: BJJ_POSITIONS §2.6, §2.8] |
| `pos.ground_open_butterfly` | seated, both hooks, underhook/overhook; wrestle-up and elevation node | bottom (weakly) | 3 | 3/1 | `sub.guillotine_high_elbow`/`sub.darce` (top, on head-down entries) / `sub.guillotine_high_elbow` (rare) | 3 | flag | 5–20 | [S: BJJ_POSITIONS §2.6] |
| `pos.ground_open_seated` | seated guard, shin-to-shin / ankle grip on the lead leg vs kneeling or standing opponent; entry node to SLX/butterfly/wrestle-up | bottom (weakly) | 3 | 3/1 | — / SLX/ankle attacks, single-leg wrestle-up | 3 | flag | 3–10 | [S: BJJ_POSITIONS §2.6] |
| `pos.ground_open_x` | X-guard under a standing opponent | bottom | 2 | 2/0 | — / sweeps, `sub.straight_ankle`, `sub.kneebar` | 2 | flag | 3–10 | [S: BJJ_POSITIONS §2.6] |
| `pos.ground_open_k` | K-guard: seated, knee across, grip behind the knee; head exposed to punches; rare in MMA | bottom | 3 | 4/0 | — / leg-entanglement entries, matrix back take | 3 | flag | 3–10 | [S: BJJ_POSITIONS §2.6] |
| `pos.ground_open_kneeling_top` | generic open guard (feet on hips/biceps) vs kneeling top; top can posture and strike or pass | contested | 4 | 5/1 | — / `sub.armbar`, `sub.triangle` (feet on hips), sweeps | 4 | flag | 5–20 | [S: BJJ_POSITIONS §2.6] |
| `pos.ground_hq` | headquarters: top standing/kneeling with one leg between the bottom's legs, bottom's inside leg pinned; gateway to knee cut, leg weave, backstep, smash | top | 5 | 5/1 | — / `sub.heel_hook_*`/SLX/50-50 if top's leg exposed | 4 | flag | 5–15 | [S: BJJ_POSITIONS §2.8] |

`Z_GUARD` = `pos.ground_half_knee_shield` (alias) [S: BJJ_POSITIONS §2.6].

#### 2.2.10 Ground — turtle, front headlock, referee's position

| id | description | controls | ctrl | strike T/B | subs T/B | esc | cage | dwell s | src |
|---|---|---|---|---|---|---|---|---|---|
| `pos.ground_turtle` | bottom on hands and knees; top beside/behind with spiral ride or hip control; back-exposure node; knees to head illegal (grounded), to body legal | top | 6 | 6/0 | `sub.rnc` (after back take), `sub.anaconda`/`sub.darce` (on turn-in), crucifix / — | 5 | flag → `TURTLE_WALL` (ctrl 5, esc 4: hooks harder, stand-up easier, top can flatten with the wall) | 5–20 | [S: BJJ_POSITIONS §2.7] |
| `pos.ground_referee` | folkstyle referee's position: top has tight waist + far wrist/ankle ride, bottom on hands and knees; in MMA = turtle with a tight-waist/ankle ride | top | 6 | 5/0 | `sub.rnc` (after hooks) / — | 5 | flag | 5–20 | [S: WRESTLING §2] [S: WRESTLING §3.8] |
| `pos.ground_front_headlock` | top sprawled/kneeling with head + arm or chin control over a turtled/kneeling opponent (post-sprawl or from turtle) | top | 5 | 5/1 (knees to body, uppercuts, elbows to side/top of head) | `sub.guillotine_high_elbow`, `sub.guillotine_arm_in`, `sub.darce`, `sub.anaconda`, `sub.peruvian_necktie` / — | 5 | flag | 3–10 | [S: BJJ_POSITIONS §2.7] |

#### 2.2.11 Ground — leg entanglements (entries here; finishes in §04)

| id | description | controls | ctrl | strike T/B | subs T/B | esc | cage | dwell s | src |
|---|---|---|---|---|---|---|---|---|---|
| `pos.ground_ashi_slx` | single-leg X / ashi garami: one leg isolated between the bottom's legs, hip-to-hip; sweeps and straight ankle | bottom (entangler) | 2 | 2/0 | — / `sub.straight_ankle`, `sub.heel_hook_inside` (ruleset flag), sweeps, technical stand-up | 2 | flag | 3–10 | [S: BJJ_POSITIONS §2.6 SLX] |
| `pos.ground_ashi_outside` | outside ashi: entangler's outside leg across the hip, foot on far hip; straight ankle / outside heel hook | entangler | 2 | 2/0 | — / `sub.straight_ankle`, `sub.heel_hook_outside`, `sub.toe_hold` | 2 | flag | 3–8 | [E] (position from §04's heel-hook family; ratings mirror SLX) |
| `pos.ground_5050` | 50/50: legs mutually entangled; symmetric heel-hook race; weak vs strikes for both | symmetric | 1 | 2/2 | `sub.heel_hook_inside`, `sub.heel_hook_outside` (both) | 1 | flag | 3–15 | [E] (ratings), family from [S: SUBMISSIONS §2.11] |
| `pos.ground_saddle` | saddle / 411 / honey hole / inside sankaku: entangler's legs triangled around the far thigh; inside heel hook and kneebar; top can only hammerfist | entangler | 4 | 2/1 | — / `sub.heel_hook_inside`, `sub.kneebar`, `sub.toe_hold` | 5 | flag | 3–10 | [E] (ratings); family [S: SUBMISSIONS §2.11] |
| `pos.ground_reap` | knee reap position (inside leg across, foot to far hip); illegal in IBJJF gi, legal no-gi adult brown/black and MMA | entangler | 3 | 2/1 | — / `sub.heel_hook_inside`, `sub.kneebar` | 4 | flag | 2–6 | [E]; ruleset [S: BJJ_POSITIONS §9.1] |
| `pos.ground_ashi_cross` | cross ashi garami: entangler's legs crossed over the trapped leg, knee line controlled from the outside; outside heel hook / kneebar | entangler | 3 | 2/1 | — / `sub.heel_hook_outside`, `sub.kneebar` | 3 | flag | 2–6 | [E] (node requested by §04 §0.1; ratings mirror outside ashi) |
| `pos.ground_truck` | 10th-Planet truck: twister side control, one of the bottom's legs triangled, back partially taken; reached from `pos.ground_turtle` / `pos.ground_back_one_hook` | top | 7 | 5/0 | `sub.twister`, `sub.calf_slicer`, `sub.banana_split` / — | 6 | flag | 5–15 | [E] (node requested by §04 §0.1; ratings between one-hook back and crucifix) |

#### 2.2.12 Cage-specific ground nodes, scramble, knockdown

| id | description | controls | ctrl | strike T/B | subs T/B | esc | cage | dwell s | src |
|---|---|---|---|---|---|---|---|---|---|
| `pos.ground_cage_seated` | bottom seated with back to the fence, top kneeling/standing in front (post-takedown against the cage); bottom's best get-up node, top's body-lock pin node | contested (UHO) | 4 | 4/2 | `sub.guillotine_high_elbow` (top, if bottom ducks in) / — | 3 | is the cage node | 5–20 | [S: BJJ_POSITIONS §2.8] |
| `pos.ground_wall_walk` | bottom has an open hand on the fence, hips off the mat, one foot planted; top on the hips (body lock or underhook); transitional to `pos.clinch_cage_pin_*` or standing | contested (UHO) | 4 | 3/2 (top: knees to thigh/body during the walk) | — / — | 3 | is the cage node | 3–8 | [S: BJJ_POSITIONS §2.8] [S: WRESTLING §2] |
| `pos.scramble` | neither fighter has a stable position (funk, roll, granby, sit-out, limp-leg mid-finish in progress); resolves by §2.3.12 formula in ≤ 2 s; both pay 2× grappling fatigue | skill-driven | 0 | 0/0 | front-headlock chokes for whoever wins the head (`sub.guillotine_*`, `sub.darce`, `sub.anaconda`) | — | flag (changes outcome table) | 1–2 (cap 4) | [S: WRESTLING §6] [S: BJJ_POSITIONS §2.8] |
| `pos.ground_knockdown` | b has been knocked/dropped by a strike (§02 emits), a standing; a chooses follow (dive/GnP → `pos.ground_open_legs_up`, `pos.ground_side`, `pos.ground_mount_*`), stand and wait, or the referee intervenes (§06). Rocked state applies | attacker | 5 | 8/1 | — / — | 3 | flag | 0.5–3 | [E] (node), knockdown→finish conversion 65 % at UFC level [S: FIGHT_DATA §5] |

Node count: 4 + 14 + 8 + 4 + 5 + 5 + 8 + 5 + 7 + 3 + 7 + 4 = **74** distinct ids (plus flags).

#### 2.2.13 Alias map for §04 (submissions) position ids

§04 §0.1 lists the node names it references and states that this section's ids are authoritative. Mapping
(§04 id → §03 id); unlisted §04 ids are identical here.

| §04 id | §03 id | note |
|---|---|---|
| `pos.clinch_whizzer` | `pos.clinch_overhook_control` | also reachable as the `def.whizzer` result inside `pos.td_single_leg_in` |
| `pos.clinch_rear_body_lock` | `pos.clinch_body_lock_rear` | |
| `pos.standing_front_headlock` | `pos.clinch_front_headlock` | |
| `pos.standing_sprawl` | `pos.td_sprawl` | |
| `pos.ground_scramble` | `pos.scramble` | |
| `pos.ground_mount_technical` | `pos.ground_mount_tech` | |
| `pos.ground_mount_gnp` | any `pos.ground_mount_*` with `posture = 'postured'` | sub-state, not a node |
| `pos.ground_back_seatbelt_no_hooks` | `pos.ground_back_seatbelt` | |
| `pos.ground_back_crucifix`, `pos.ground_crucifix_side` | `pos.ground_crucifix` | one node; the entry edge records the origin (back/turtle vs side) as a flag |
| `pos.ground_side_control` / `pos.ground_side_control_wall` | `pos.ground_side` (`cage = true` for the wall variant) | |
| `pos.ground_kesa_gatame` / `pos.ground_reverse_kesa` | `pos.ground_side_kesa` / `pos.ground_side_reverse_kesa` | |
| `pos.ground_knee_on_belly` | `pos.ground_side_kob` | |
| `pos.ground_closed_guard_bottom` / `pos.ground_closed_guard_broken` / `pos.ground_high_guard` / `pos.ground_rubber_guard` / `pos.ground_closed_guard_standing_top` | `pos.ground_closed_posture_up` / `pos.ground_closed_posture_broken` / `pos.ground_closed_high` / `pos.ground_closed_rubber` / `pos.ground_closed_top_standing` | |
| `pos.ground_open_guard_kneeling_top` / `pos.ground_open_supine_legs_up` / `pos.ground_butterfly` / `pos.ground_seated_shin_to_shin` / `pos.ground_x_guard` | `pos.ground_open_kneeling_top` / `pos.ground_open_legs_up` / `pos.ground_open_butterfly` / `pos.ground_open_seated` / `pos.ground_open_x` | |
| `pos.leg_ashi_slx` / `pos.leg_outside_ashi` / `pos.leg_saddle` / `pos.leg_50_50` / `pos.leg_cross_ashi` | `pos.ground_ashi_slx` / `pos.ground_ashi_outside` / `pos.ground_saddle` / `pos.ground_5050` / `pos.ground_ashi_cross` | |
| `pos.ground_cage_seated_bottom` | `pos.ground_cage_seated` | |
| `pos.ground_truck` | `pos.ground_truck` | added here at §04's request |

Submission ids: §04's catalogue names are authoritative; this section's `sub.straight_ankle` = §04
`sub.ankle_lock_straight`, and all other `sub.*` ids used here are expected to match §04's §3 catalogue
one-to-one (`sub.rnc`, `sub.guillotine_high_elbow`, `sub.heel_hook_inside`, `sub.kneebar`, `sub.von_flue`
confirmed at the time of writing).

---

### 2.3 Edge catalogue

Columns: **→ success** / **→ fail** list destination nodes with weights (weights sum to 1 within a cell;
"(def)" = the *defender* becomes slot `a` of the destination). **dur** is from commit to resolution in ms.
**base** is P(success) T4 vs T4 fresh open mat; two-stage edges give `capture / finish`. **k_skill** names the
attacker sub-skill vs defender sub-skill and the logit-per-100-points coefficient; per conventions §4 the
typical range is 1.0–3.0 — this section deliberately uses **up to 3.5** on the most technique-dominated ground
edges (`+++` in BJJ_POSITIONS) so that an elite passer vs a beginner guard passes ≈ 80 % of attempts
`[D: T4−T1 = 60 pts × 3.5 = 2.1 logit on base 0.35 ⇒ P = 0.81; BJJ_POSITIONS §3.3 calibrates 85 %]`.
Conversion of BJJ_POSITIONS `+`/`++`/`+++` → k 2.0 / 3.0 / 3.5 `[D: 0.55 logit per tier per '+' ≈ 20 pts ⇒ 2.75/100 per '+'; rounded into the conventions range]`;
WRESTLING `0.005 P/pt` → k 2.1 `[D: 0.005/0.24]`; JUDO tier multipliers f(+1) = 1.6, f(+2) = 2.5 → k 2.4
`[D: at base 0.30, f(+1) = 0.48 ⇒ +0.77 logit per 20-pt tier ⇒ 3.8/100; capped to 2.4 so that f(+2) after clamp stays ≤ 2.5 [E]]`.
**phys**/**state** use the §2.1.4 codes. Durations tagged `[S: WRESTLING §8.4]` are the "vs competent defender
(median)" column; entries are the 430–470 ms penetration step `[S: WRESTLING §1]`.

#### A. Standing setups, entries and strike-to-grapple integration

| id | from | → success | → fail / counter | requirements | dur ms | base | k_skill | phys | state | counters | src |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tech.level_change` | `pos.standing_mid/close` | same node, `levelChanged = true` for 500 ms (SETUP granted to the next shot) | same node; if defender reads it (`def.read_level_change`, P 0.30 [E] × defender `mma.anti_wrestling` gap) the defender gets a free knee/uppercut with +0.63 hit logit (§02) | not `state.rocked`; stance | 200–300 | n/a (setup) | — | — | FAT: at fatigue > 0.7 the AI stops level-changing 25 % of the time [S: WRESTLING §3.1] | knee, uppercut, sprawl-in-place | [S: WRESTLING §3.1] |
| `def.read_level_change` | `pos.standing_mid/close` (defender) while the opponent level-changes | defender's free knee/uppercut with §02's counter bonus (`ctr.intercepting_knee` +0.60 / `ctr.uppercut_on_level_change` +0.70; [REVIEW: was "+0.63", §02 owns it]) and the level change is cancelled; sprawl-in-place ready (`def.sprawl` window +100 ms) | the shot proceeds normally | reactionTime attribute ≥ 50 [E] | 200 | 0.30 [E] | `mma.anti_wrestling` vs `mma.level_change`, k 2.5 [E] | — | a feint (`tech.level_change_feint`) that succeeds consumes this read for 400 ms | feint first | [E] (MMA_INTEGRATION I-6 gives the +15–25 % hit bonus; the read probability is the estimate) |
| `tech.level_change_feint` (= §02 `feint.level_change`) | `pos.standing_mid/close` | same; opponent's sprawl reaction consumed → next strike (uppercut/knee) +0.70 hit logit (§02 `p.strike.feint.levelChangeBonus`) for 400 ms | same; costs 1 % stamina [E] | opponent has shown a sprawl reaction this bout | 250 | bite = 01 `feintBiteP` in the takedown domain (`defSkill = wrestling.takedownDefence`; T4 vs T4 ≈ 0.30) + §02 §2.3.4 modifiers [REVIEW: was 0.55 [E]; 01 owns the bite probability, 02 the follow-up bonus] | `mma.level_change` vs `mma.anti_wrestling`, k 2.0 [E] | — | — | none (stamina cost) | [S: MMA_INTEGRATION §2.1 I-6] (+15–25 % hit chance) |
| `tech.shot_reactive` | `pos.standing_mid` during opponent's committed rear hand/kick | `tech.double_leg` / `tech.single_leg` / `tech.high_crotch` capture stage with SETUP | as the underlying shot | attacker `wr.shot` ≥ 40; opponent's strike commitment ≥ 300 ms | 400 | underlying + SETUP | `mma.level_change` vs `mma.anti_wrestling`, k 2.5 | EXP+ | SETUP (+0.63); available only if attacker reactionTime ≥ 60 [E] | opponent retracts fast / throws with less commitment | [S: WRESTLING §3.1] |
| `tech.jab_to_double` | `pos.standing_mid`, jab thrown ≤ 800 ms ago | `tech.double_leg` with SETUP | as double | opponent guard raised or stepping back | 450 entry | double base + SETUP | as double | as double | SETUP | pull hands down + sprawl; counter-jab into knee; frame and circle | [S: MMA_INTEGRATION §2.1 I-2] (≈ 40–45 % full TD) |
| `tech.cross_to_single` | `pos.standing_mid`, cross thrown ≤ 600 ms ago and opponent stepped laterally | `tech.single_leg` with SETUP (converts to a cage single if ≤ 1.5 m from the fence) | as single | rear hand extended | 450 entry | single base + SETUP (≈ 0.38–0.42 full TD) | as single | as single | SETUP | limp-leg/whizzer, sprawl on one leg, hop to cage + hip-in | [S: MMA_INTEGRATION §2.1 I-3] |
| `tech.hook_to_body_lock` | `pos.standing_close`, hook thrown and opponent covers/ducks, distance < 1.0 m | `pos.clinch_body_lock_front` | `pos.clinch_over_under` 0.6 / `pos.standing_close` 0.4 | hook rotation carries the rear arm inside | 500 | 0.55 | `mma.level_change` vs `wr.pummel`, k 2.0 | STR+ | SETUP | frame on hip, underhook, hitting on the entry | [S: MMA_INTEGRATION §2.1 I-4] (50–60 %) |
| `tech.clinch_entry_strikes` | `pos.standing_close`, ≥ 2 strikes thrown in the last 1.5 s | `pos.clinch_collar_tie` 0.5 / `pos.clinch_over_under` 0.35 / `pos.clinch_underhook` 0.15 | `pos.standing_close` (defender frames/pivots; defender's free knee on entry P 0.25 [E]) | distance < 1.0 m | 400 | 0.47 | `mma.level_change` vs `mma.clinch_strike`, k 2.0 | STR+ | SETUP, CAGE+0.35 | frame, pivot off, knee on entry, hitting on the entry | [S: MMA_INTEGRATION §2.2 I-9] (40–55 %) |
| `tech.clinch_entry_cold` | `pos.standing_close` | `pos.clinch_collar_tie` 0.5 / `pos.clinch_over_under` 0.4 / `pos.clinch_hand_fight` 0.1 | `pos.standing_mid` (defender steps off) 0.7 / defender's free strike 0.3 [E] | none | 400 | 0.35 [E] | `wr.pummel` vs `wr.pummel`, k 2.0 | STR+ | TELE, CAGE+0.35, RCK | as above | [E] anchored on I-9 minus setup |
| `tech.kick_catch` | `pos.standing_mid` while opponent's body/low kick (≥ mid height) is in flight | `pos.td_kick_caught` | strike resolves normally (§02) | catcher balance ≥ 60; attempt within the 200 ms contact window | 200 | = §02 `def.kick_catch` success: 0.28 vs body kick / 0.35 teep / 0.25 knee / 0.10 head kick (0.15 vs low kick [E]) [REVIEW: was 0.25; §02 owns the catch roll, this row is the resulting edge] | `mma.anti_wrestling` vs opponent's kick discipline skill (§02), k 2.5 | — | reactionTime ≥ 55 required [E] | kicker retracts fast | [S: MMA_INTEGRATION §2.1 I-5] (20–30 %) |
| `tech.kick_catch_takedown` | `pos.td_kick_caught` | `pos.ground_open_kneeling_top` 0.40 / `pos.ground_half_flat` 0.35 / `pos.ground_side` 0.25 (run the pipe / trip / lift) | `pos.standing_close` (kicker pulls free) 0.7 / `pos.clinch_over_under` 0.3 | leg held ≥ 300 ms | 700–1,200 | 0.55 (= cold single + 0.20) | `wr.finish` vs `wr.sprawl`, k 2.1 | STR+, MASS+ | CAGE+0.42 (kicker can't hop away), FAT−, LEGDMG | kicker hops/frames on the shoulder (0.30 per beat), punches while held (lands 0.45, forces release 0.25), re-teep with the free leg 0.20 | [S: MUAY_THAI §3.1] (`[D: equal-tier T2 value adopted as base]`) |
| `tech.kick_catch_strike` | `pos.td_kick_caught` | same node + strike (§02: punch lands 0.60, knee to body/thigh 0.65, kick the post 0.55) | release | — | 300–500 | per §02 | `mma.clinch_strike` | — | — | kicker's elbow/punch while held | [S: MUAY_THAI §3.1] |
| `def.kick_pull_free` | `pos.td_kick_caught` (kicker) | `pos.standing_mid` | stays caught (rolled every 300 ms) | grip not yet closed (first 300 ms): 0.35; afterwards hop-and-frame 0.30 per beat | 300 | 0.35 first beat / 0.30 later | kicker `bjj.retention` ∥ `wr.sprawl` vs catcher `wr.finish`, k 2.0 | FLX+, own balance +0.05/10 [E] | FAT− | catcher steps and pulls (+0.15 P to sweep) | [S: MUAY_THAI §3.1] |
| `tech.knee_catch_single` | `pos.clinch_collar_tie` / `pos.clinch_thai_plum` when the opponent throws a knee | `pos.td_single_leg_in` (leg: hip) | same clinch node | knee thrown from the tie | 300 | 0.30 [E] (+0.08 P window per WRESTLING) | `wr.shot` vs `mma.clinch_strike`, k 2.0 | — | SETUP | knee with less commitment; plum control | [S: WRESTLING §5.4] (+8 pp single-catch window) |
| `tech.strike_in_tie` | any `pos.clinch_*` with a free hand/knee | same node + strike (§02 owns damage; land rates: dirty boxing 0.55–0.70 [S: MMA_INTEGRATION I-10], cage-pin knees 0.50–0.65 [S: MMA_INTEGRATION I-11]) | same node; each strike thrown from a tie gives the opponent +0.21 logit `[D: +5 pp]` on duck-under/arm-drag/snap-down for 1 s | free limb | 300–600 | per §02 | `mma.clinch_strike` | — | KUZ: a landed strike sets kuzushi mag +1 in the direction it pushes for 1 s [S: JUDO §2.4] | pummel for double unders, head position, break | [S: WRESTLING §5.4] [S: JUDO §5.4] |
| `tech.hit_on_break` | any `pos.clinch_*` → `pos.standing_close` | disengage + free strike with a 300 ms head start (+1.0 hit logit = §02 `ctr.hit_on_break`; [REVIEW: was +0.63 — §02 owns the hit bonus]) | disengage | the breaker initiates the break | 500 | break 0.60 [S: MUAY_THAI §4.3 "post and exit"] | `mma.clinch_strike` vs `mma.clinch_strike`, k 2.0 | — | — | step out with hand up / pivot | [S: MMA_INTEGRATION §2.2 I-12] (+20–30 % hit chance) |
| `tech.pull_guard` | `pos.clinch_collar_tie` / `pos.clinch_over_under` / `pos.clinch_front_headlock` (as the head holder) | `pos.ground_closed_posture_up` (bottom) 0.7 / `pos.ground_open_butterfly` 0.3; front-headlock version → `sub.guillotine_high_elbow` entry with guard pulled | `pos.ground_open_legs_up` (opponent stays standing) 0.6 / `pos.ground_hq` 0.4 | grips | 800 | 0.94 (success = ends on the ground; whether the opponent follows is the AI's choice) | — | — | judges score it for the top (§06) | opponent stays standing, strikes, or the referee stands (§6) | [S: BJJ_POSITIONS §7.4] (guard pull 94 %, Williams 2019) |

#### B. Leg attacks — single, double, high crotch, low single, ankle pick

Two-stage: **capture** then **finish**. Capture failure destinations (all shots unless overridden):
`pos.td_sprawl` (def) 0.50 / `pos.standing_close` 0.35 / `pos.clinch_front_headlock` (def) 0.15
[S: WRESTLING §9 r8]. Finish failure keeps the `*_in` node for another attempt (max 3 attempts open mat, 6 on
the cage [S: WRESTLING §9 r8]) unless the defender's kick-out (0.35) or whizzer throw (0.15) fires. Guillotine
tax on every leg attack: defender rolls `sub.guillotine_standing` entry at 0.12 base, ×2.5 if attacker is T0–T1,
×0.5 if T4+, +0.10 if defender `bjj.*` ≥ 70; a caught attacker still finishes the takedown into the guillotine
0.60 [S: WRESTLING §9 r6]. Landing distributions [S: WRESTLING §9 r15].

| id | from | → success | → fail / counter | requirements | dur ms | base | k_skill | phys | state | counters | src |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tech.single_leg` (capture) | `pos.standing_mid/close`, `pos.clinch_collar_tie`, `pos.clinch_underhook`, `pos.clinch_hand_fight` | `pos.td_single_leg_in` (head inside 0.6 / outside 0.4 [E]; leg: hip) | sprawl 0.40 / standing 0.45 / front headlock (def) 0.15 | level change (else TELE and −0.85 logit `[D: −20 pp]` for T0–T1); lead leg within 1.2 m | 500 | 0.55 capture (full TD 0.35–0.42) | `wr.shot` vs `wr.sprawl`, k 2.1 | EXP+, STR+ (half weight: 0.05/10) | SETUP, TELE, CAGE+0.42 `[D: +10 pp]`, FAT−, RCK, LEGDMG | sprawl, knee, down-block, step-back | [S: WRESTLING §3.2] |
| `tech.single_run_pipe` (finish) | `pos.td_single_leg_in` (leg on mat or at hip, head inside) | `pos.ground_open_kneeling_top` 0.55 / `pos.ground_half_flat` 0.35 / `pos.ground_side` 0.10 | stays `pos.td_single_leg_in` 0.50 / `pos.standing_close` (kick-out) 0.35 / `pos.clinch_overhook_control` (def whizzer) 0.15 | head on inside hip, leg clamped | 1,000–2,000 (×1.5 on cage) | 0.55 per attempt | `wr.finish` vs `wr.sprawl`, k 2.1 | STR+, MASS+ (half: 0.08/10 kg) | CAGE−1.05 `[D: −25 pp]` (cannot circle), FAT−, whizzer −0.85 `[D: −20 pp]` | whizzer, hop/limp leg, hand on head, cage post | [S: WRESTLING §3.2] |
| `tech.single_tree_top` (finish) | `pos.td_single_leg_in` (leg: chest) | `pos.ground_open_legs_up` 0.5 / `pos.ground_open_kneeling_top` 0.5 | stays | leg lifted to chest, defender hopping | 1,000 | 0.50 | `wr.finish` vs `wr.sprawl`, k 2.1 | STR+, HGT+ | FAT− | hook attacker's leg, grab head, hop to cage | [S: WRESTLING §3.2] |
| `tech.single_dump` (finish; cut across / knee-tap dump) | `pos.td_single_leg_in` | `pos.ground_side` 0.5 / `pos.ground_half_flat` 0.5 | stays | attacker steps across the posted leg | 1,000 | 0.50 | `wr.finish` vs `wr.sprawl`, k 2.1 | STR+ | CAGE+0.42 | limp leg, wide base, whizzer | [S: WRESTLING §3.2] |
| `tech.single_to_double` (chain) | `pos.td_single_leg_in` (defender hopping/whizzering) | `pos.td_double_leg_in` (then a double finish) 0.7 / `pos.ground_open_kneeling_top` directly 0.3 | stays | hips under, second hand to the far leg | 1,000 | 0.60 | `wr.finish` vs `wr.sprawl`, k 2.1 | STR+, MASS+ | CHAIN, FAT− | turn hips away, whizzer, cage post | [S: WRESTLING §3.2] ("explode to a double") |
| `tech.single_trip` (finish) | `pos.td_single_leg_in` (leg down; defender posted, esp. on the cage) | `pos.ground_open_kneeling_top` 0.6 / `pos.ground_half_flat` 0.4 | stays | free leg reachable | 700 | 0.45 | `wr.finish` ∥ `jd.throw_rear` vs `wr.sprawl`, k 2.1 | — | CAGE+0.42 | hop away, hip-in on cage | [S: WRESTLING §3.2] |
| `tech.single_low` (capture) | `pos.standing_mid` (open mat) | `pos.td_low_single_in` | `pos.standing_close` (attacker briefly on the mat; 20 % eats a strike [S]) | speed/explosiveness; > 1.2 m open mat | 400 | 0.45 capture / 0.60 finish from the low single | `wr.shot` vs `wr.sprawl`, k 2.1 | EXP+, speed +0.05/10 [E], light divisions +0.21 `[D: +5 pp]` | CAGE−0.42 (needs space), TELE | hop away, hip down/limp leg, punch down on the head | [S: WRESTLING §3.2] |
| `tech.single_low_finish` | `pos.td_low_single_in` | `pos.ground_open_kneeling_top` 0.60 / `pos.scramble` 0.35 / `pos.ground_side` 0.05 | `pos.standing_close` 0.6 / `pos.td_single_leg_in` (comes up to a regular single) 0.4 | ankle in hand, drive or tree-top | 800 | 0.60 | `wr.finish` vs `wr.sprawl`, k 2.1 | EXP+ | FAT− | limp leg, hip down | [S: WRESTLING §3.2] landing [S: WRESTLING §9 r15] |
| `tech.single_outside` (capture) | `pos.standing_mid`, `pos.clinch_overhook_control` (attacker on the overhook side) | `pos.td_single_leg_in` (head outside) | as single | defender's lead leg forward | 500 | 0.50 | `wr.shot` vs `wr.sprawl`, k 2.1 | EXP+ | SETUP, CAGE+0.42 | whizzer (high effectiveness vs head-outside: defender whizzer P 0.60 if `wr.sprawl` ≥ 40) | [S: WRESTLING §3.2] [S: WRESTLING §9 r11] |
| `tech.double_leg` (capture) | `pos.standing_mid/close` | `pos.td_double_leg_in` | sprawl 0.50 / standing 0.35 / front headlock (def) 0.15 | penetration step, hands behind knees, head outside | 450 entry | **capture 0.62** so that capture × drive-through 0.70 ≈ 0.43 full TD `[D: WRESTLING §3.3 43–50 % full TD]`; open-mat shots from > 1.2 m: base × 0.85 [S: WRESTLING §9 r7] | `wr.shot` vs `wr.sprawl`, k 2.1 | STR+, MASS+, EXP+ | SETUP, TELE, CAGE+0.63 `[D: +15 pp]`, FAT− (−0.85 extra `[D: −20 pp]` above fatigue 0.7), RCK, LEGDMG | sprawl, knee/uppercut on entry, underhooks + hip-heist, guillotine | [S: WRESTLING §3.3] |
| `tech.double_drive_through` (finish) | `pos.td_double_leg_in` | `pos.ground_open_kneeling_top` 0.60 / `pos.ground_half_flat` 0.30 / `pos.ground_side` 0.10 | `pos.td_sprawl` (def) | head up, hips under, feet driving | 500–1,000 | 0.70 clean / 0.40 if the defender is already half-sprawled | `wr.finish` vs `wr.sprawl`, k 2.1 | STR+, MASS++ (largest mass effect of any edge) | CAGE+0.42, FAT− | sprawl, underhooks, wide base | [S: WRESTLING §3.3] |
| `tech.double_lift_slam` (finish) | `pos.td_double_leg_in` (hips under) | `pos.td_lifted` → `pos.ground_side` 0.55 / `pos.ground_half_flat` 0.45 + slam damage event (§05: 3–8 % KO-class chance [S]) | stays `pos.td_double_leg_in` | strength ≥ defender's | 1,000–1,500 | 0.60 when hips are under | `wr.finish` vs `wr.sprawl`, k 2.1 | STR++, MASS++ | FAT−− | grab the cage (foul, §06), guillotine, sit hips down | [S: WRESTLING §3.3] |
| `tech.double_turn_corner` (finish) | `pos.td_double_leg_in` (defender partially sprawled) | `pos.ground_open_kneeling_top` 0.5 / `pos.ground_half_flat` 0.5 | `pos.td_sprawl` (def) | head drives across, feet circle 90° | 1,000 | 0.50 | `wr.finish` vs `wr.sprawl`, k 2.1 | — | FAT−, CAGE−0.42 (no room to circle) [E] | square back up, crossface | [S: WRESTLING §3.3] |
| `tech.double_cut_corner` (finish) | `pos.td_double_leg_in` | `pos.ground_side` | stays | lateral step, 45° drive | 1,000 | 0.55 | `wr.finish` vs `wr.sprawl`, k 2.1 | STR+ | — | re-square | [S: WRESTLING §3.3] |
| `tech.double_to_high_crotch` (chain) | `pos.td_double_leg_in` (far leg hidden by the sprawl) | `pos.td_high_crotch_in` | `pos.td_sprawl` (def) | inside arm switches to the crotch | 500 | 0.55 | `wr.finish` vs `wr.sprawl`, k 2.1 | — | CHAIN | limp leg, whizzer | [S: WRESTLING §3.3] |
| `tech.knee_tap_double` (from tie) | `pos.clinch_underhook`, `pos.clinch_collar_tie`, `pos.clinch_body_lock_front` | `pos.ground_open_kneeling_top` 0.5 / `pos.ground_half_flat` 0.3 / `pos.ground_side` 0.2 | same tie | defender's weight forward | 700 | 0.45 | `wr.finish` ∥ `jd.foot_sweep` vs `wr.sprawl`, k 2.1 | STR+ | CAGE+0.42 (ko-uchi/knee-tap ×1.5 P on the fence [S: JUDO §8 r13]) | post on head, hips back, whizzer | [S: WRESTLING §3.3] [S: JUDO §3 ko uchi] |
| `tech.high_crotch` (capture) | `pos.clinch_underhook` (best tie entry), `pos.clinch_collar_tie`, `pos.standing_close` off a level change | `pos.td_high_crotch_in` | standing 0.5 / sprawl 0.5 | underhook-side leg is the target; head inside on the chest | 500 | 0.55 from underhook / 0.45 from neutral | `wr.shot` vs `wr.sprawl`, k 2.1 | EXP+ | SETUP, CAGE+0.42 | hips back, cross-wrist control (whizzer weak) | [S: WRESTLING §3.4] |
| `tech.hc_to_double` (finish) | `pos.td_high_crotch_in` | `pos.ground_open_kneeling_top` 0.5 / `pos.ground_side` 0.5 | stays | second hand reaches the far leg | 700 | 0.60 | `wr.finish` vs `wr.sprawl`, k 2.1 | STR+, MASS+ | CHAIN | limp leg, hip away | [S: WRESTLING §3.4] |
| `tech.hc_lift_dump` (finish) | `pos.td_high_crotch_in` | `pos.td_lifted` → `pos.ground_side` | stays | hips under | 1,000 | 0.55 | `wr.finish` vs `wr.sprawl`, k 2.1 | STR++ | FAT− | sit down, whizzer, cage post | [S: WRESTLING §3.4] |
| `tech.hc_cage_drive_single` (chain) | `pos.td_high_crotch_in` with the cage ≤ 2 m | `pos.td_single_leg_in` (`cage = true`) | stays | fence reached | 1,000 | 0.65 | `mma.cage` vs `mma.cage`, k 2.0 | MASS+ | CHAIN | hip-in | [S: WRESTLING §3.4] |
| `tech.ankle_pick` | `pos.clinch_collar_tie` (head control), `pos.clinch_front_headlock` | `pos.ground_open_kneeling_top` 0.60 / `pos.scramble` 0.35 / `pos.ground_side` 0.05 | same tie | collar tie pulling the head down + defender's weight on the lead leg | 500 | 0.40 | `wr.shot` ∥ `jd.foot_sweep` vs `wr.sprawl`, k 2.1 | RCH+ | SETUP | posture up, step the lead leg back, sprawl on the reaching arm | [S: WRESTLING §3.6] landing [S: WRESTLING §9 r15] |
| `tech.re_shot` | `pos.td_sprawl` (shooter's view) | `pos.td_single_leg_in` 0.6 / `pos.td_high_crotch_in` 0.4 | `pos.clinch_front_headlock` (def) 0.40 / `pos.standing_close` 0.60 | knee under, defender's hands still on the head | 500 | 0.35 (= first shot −0.42 `[D: −10 pp]`; +0.42 if the defender is now bent over / hands on the mat) | `wr.shot` vs `wr.sprawl`, k 2.1 | — | CHAIN, FAT−− | keep hips back, snap, circle | [S: WRESTLING §3.7] |
| `def.sprawl` | `pos.standing_*` at shot time (defender) | `pos.td_sprawl` (def is `a`) | shooter captures | fires only if defender reactionTime maps to ≤ 450 ms (+100 ms if the shot was telegraphed) [S: WRESTLING §9 r10]; hips back within 300 ms | 300 | denies capture 0.55 vs double / 0.45 vs single (= 1 − capture); tier table T0 0.20, T2 0.50, T3 0.70, T4 0.85 [S: WRESTLING §9 r10] | `wr.sprawl` vs `wr.shot`, k 2.1 | MASS+ (heavier defender +0.21 `[D: +5 pp]`) | FAT− (−0.85 `[D: −20 pp]` × fatigue), CAGE−0.42 (no room) | re-shoot, drag the hands, high crotch off the sprawl | [S: WRESTLING §3.2, §3.3] |
| `def.whizzer` | `pos.td_single_leg_in` (defender; attacker's head outside) | `pos.clinch_overhook_control` (def) → `tech.whizzer_throw` 0.15 or `pos.standing_close` | attacker still finishes | free arm over the near arm | reactive (0) | applies −0.85 logit to run-the-pipe/dump; defender applies it with P 0.60 if `wr.sprawl` ≥ 40 | `wr.sprawl` vs `wr.finish`, k 2.1 | STR+ (strength-heavy), HGT+ | — | limp arm (0.40), switch to double (0.40), drive to cage (0.60 vs open-mat circling) | [S: WRESTLING §3.2] [S: WRESTLING §4 chain 8] |
| `tech.whizzer_throw` | `pos.clinch_overhook_control` | `pos.ground_side` (hip toss / harai-style) | `pos.td_single_leg_in` remains | deep whizzer + hip pressure | 800 | 0.15 | `jd.throw_fwd` ∥ `wr.sprawl` vs `wr.finish`, k 2.1 | STR++ | — | limp arm, drive the head across | [S: WRESTLING §3.2] |
| `def.limp_leg` | `pos.td_single_leg_in` (defender) | `pos.standing_close` | attacker re-clamps (stays) | leg below the attacker's hip or loose grip | 500 | 0.35 (0.60 vs a T0–T1 grip) | `wr.sprawl` vs `wr.finish`, k 2.1 | FLX+ | FATd+ | clamp leg to chest, lift | [S: WRESTLING §3.2] |
| `def.crossface_hip_pressure` | `pos.td_single_leg_in` / `pos.td_double_leg_in` (defender) | `pos.td_sprawl` → `pos.clinch_front_headlock` (def) | attacker completes | free arm across the face | 500 | +0.42 to sprawl `[D: +10 pp]`; 0.30 to convert a capture into a front headlock | `wr.sprawl` vs `wr.finish`, k 2.1 | STR+ | — | keep the head tight to the hip | [S: WRESTLING §3.2] |
| `def.underhooks_hip_heist` | `pos.td_double_leg_in` (defender) | `pos.clinch_underhook` (def holds it) 0.6 / `pos.standing_close` 0.4 | attacker completes | one/both underhooks as the attacker drives | 500–1,000 | 0.35 | `wr.sprawl` vs `wr.finish`, k 2.1 | STR+ | — | lift, switch to single | [S: WRESTLING §3.3] |
| `def.cage_hip_in_double` | `pos.td_double_leg_in` (`cage`, defender) | TD denied → `pos.clinch_cage_pin_front` (attacker keeps pressure) 0.70 / `pos.standing_cage` 0.30 | attacker completes to `pos.ground_open_kneeling_top` | back flat on the fence, hips forward, underhook + head post | continuous (rolled per finish attempt) | denies 0.45 | `mma.cage` vs `mma.cage`, k 2.0 | STR+ | — | switch to single/trip/knee-tap; foot stomps | [S: WRESTLING §3.3] |
| `def.cage_post_single` | `pos.td_single_leg_in` (`cage`, defender) | stays standing (halves per-attempt run-the-pipe P; tree-top/trips unchanged) | attacker completes | back on the fence, hips forward, hand on the attacker's head | continuous | ×0.5 on `tech.single_run_pipe` P | `mma.cage` vs `wr.finish`, k 2.0 | — | — | switch finish (trip, dump), foot sweep, knee to the thigh of the posted leg | [S: WRESTLING §3.2] |

#### C. Clinch transitions, snaps, drags, body locks, trips, mat returns

| id | from | → success | → fail / counter | requirements | dur ms | base | k_skill | phys | state | counters | src |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tech.pummel` | `pos.clinch_over_under`, `pos.clinch_collar_tie`, `pos.clinch_hand_fight`, `pos.clinch_cage_pin_front` | winner gains one of {`pos.clinch_underhook`, `pos.clinch_double_under`, `pos.clinch_body_lock_front`, head position (flag)}; a pinned defender who wins double-unders on the cage may reverse the pin 0.25 or break 0.35 | loser's node | not fully locked | 3,000 per exchange (Thai swim: 0.45 per 400 ms beat, 0.65 T4 vs T2 [S: MUAY_THAI §4.3]) | 0.50 | `wr.pummel` vs `wr.pummel`, k 1.6 `[D: WRESTLING §5.3 0.004 P/pt ⇒ 0.016 logit/pt]` | STR+ (`[D: 0.003 P/pt ⇒ 0.12/10 pts]`) | FAT: −0.63 × (fatAtt − fatDef) `[D: −0.15 P]`; Greco/judo background +0.42 `[D: +10 pp]` | hip-in, frames, elbows, re-pummel | [S: WRESTLING §5.3] |
| `tech.establish_body_lock` | `pos.clinch_underhook`, `pos.clinch_double_under`, `pos.clinch_cage_pin_front` | `pos.clinch_body_lock_front` | stays | hands locked (S-grip/gable) | 500–1,500 | 0.50 per exchange | `wr.pummel` vs `wr.pummel`, k 2.1 | STR+ | Greco +0.42 | hip-in, frames, elbows, re-pummel | [S: WRESTLING §3.5] |
| `tech.snap_down` | `pos.clinch_collar_tie`, `pos.clinch_thai_plum`, `pos.clinch_underhook`, `pos.standing_close` after a bent-over shot | `pos.clinch_front_headlock` 0.7 / `pos.ground_turtle` (hands hit the mat) 0.3 | `pos.clinch_collar_tie` (defender posts) | head control + defender leaning forward | 500–1,000 | 0.35 (0.60 vs a T0–T1 who bends at the waist) | `wr.pummel` vs `wr.pummel`, k 2.1 | STR+ | FATd+, defender bent posture +1.1 `[D: +25 pp]`; plum: knee window +0.20 P on success [S: MUAY_THAI §4.3] | posture up, post on hip, duck-under | [S: WRESTLING §3.1] |
| `tech.arm_drag` | `pos.standing_close`, `pos.clinch_collar_tie`, `pos.clinch_hand_fight`, `pos.clinch_two_on_one` | `pos.clinch_body_lock_rear` 0.25 / `pos.td_single_leg_in` 0.45 / `pos.clinch_underhook` 0.30 | `pos.standing_close` | wrist/tricep grip | 500 | 0.42 (38–45 %) | `wr.pummel` vs `wr.pummel`, k 2.1 | speed +0.05/10 [E] | WET, strike-in-tie window +0.21 | square up, re-drag, back-step | [S: WRESTLING §3.1] |
| `tech.duck_under` | `pos.clinch_collar_tie`, `pos.clinch_underhook` | `pos.clinch_body_lock_rear` | `pos.clinch_collar_tie`; counter: `sub.guillotine_standing` (def) on the ducking head 0.10 [E] | defender's elbow high / loose tie | 400 | 0.30 | `wr.pummel` vs `wr.pummel`, k 2.1 | HGT− (+0.21 `[D: +5 pp]` for a shorter attacker) | strike-in-tie window +0.21 | elbow tight, hip away, guillotine | [S: WRESTLING §3.1] [S: MMA_INTEGRATION I-13] |
| `tech.slide_by` | `pos.clinch_underhook` | `pos.clinch_body_lock_rear` | `pos.clinch_underhook` | underhook + defender's weight forward | 500 | 0.25 | `wr.pummel` vs `wr.pummel`, k 2.1 | — | — | hip-in, re-pummel | [S: WRESTLING §3.1] |
| `tech.two_on_one_back_take` | `pos.clinch_two_on_one` | `pos.clinch_body_lock_rear` 0.6 / `pos.td_single_leg_in` 0.4 | `pos.clinch_hand_fight` | both hands on the arm, defender's elbow away from the ribs | 500 | 0.35 [E] | `wr.pummel` vs `wr.pummel`, k 2.1 | — | WET | pull the arm back, square the hips | [S: JUDO §2.2 N8] (opens the back more than throws); value [E] |
| `tech.inside_trip` (= o uchi gari from the lock) | `pos.clinch_body_lock_front`, `pos.clinch_double_under`, `pos.clinch_cage_pin_front`, `pos.clinch_underhook` | `pos.ground_open_kneeling_top` 0.55 / `pos.ground_half_flat` 0.40 / `pos.ground_side` 0.05 | stays; judo failure table (§D) with commitment ×1.0 | attacker's leg hooks inside the near leg | 700 | 0.50 (45–55 %) | `wr.finish` ∥ `jd.throw_rear` vs `wr.sprawl` ∥ `jd.throw_def`, k 2.1 | STR++, MASS++ (coefficients doubled from the body lock) | CAGE+0.42 (defender can't step back; JUDO ×1.5 P on the fence), Greco/judo +0.42 | base, hip-in, wrestle-up | [S: WRESTLING §3.5] [S: WRESTLING §9 r13] [S: JUDO §8 r13] |
| `tech.outside_trip` (= o soto gari / gake from the lock) | `pos.clinch_body_lock_front`, `pos.clinch_underhook`, `pos.clinch_head_and_arm` | `pos.ground_side` 0.45 / `pos.ground_half_flat` 0.40 / `pos.ground_open_kneeling_top` 0.15 | stays; counter `tech.osoto_gaeshi` (§D) | defender's weight on the reaped leg | 700 | 0.48 (45–53 %) | `wr.finish` ∥ `jd.throw_rear` vs `jd.throw_def`, k 2.1 | STR++, MASS++, HGT+ | CAGE+0.42, judo/Greco +0.42 | step over/through, whizzer | [S: WRESTLING §3.5] |
| `tech.body_lock_lift_return` | `pos.clinch_body_lock_front` | `pos.td_lifted` → `pos.ground_side` 0.45 / `pos.ground_half_flat` 0.40 / `pos.ground_open_kneeling_top` 0.15 + slam damage (§05) | stays | hips under; strength ≥ defender's | 1,000–1,500 | 0.55 (50–60 %) | `wr.finish` vs `wr.sprawl`, k 2.1 | STR++, MASS++ | FAT−−, CAGE+0.42 (lifts ×1.25 P on the fence [S: JUDO §8 r13]) | sprawl hips, cage grab (foul), guillotine, sit hips down | [S: WRESTLING §3.5] |
| `tech.rear_mat_return` | `pos.clinch_body_lock_rear`, `pos.clinch_cage_pin_rear` | `pos.ground_turtle` (top) 0.55 / `pos.ground_back_hooks` 0.30 / `pos.ground_side` 0.15 | stays (defender wall-walks / hand-fights) | hips behind, knee behind knee | 1,000–2,000 | 0.55 per attempt; 0.70 on the cage with knee-behind-knee | `wr.mat_return` vs `wr.get_up`, k 2.1 | STR+, MASS+ | CAGE+0.42 | wrist control + turn in, wide base, hand-fight the lock, cage foot post | [S: WRESTLING §3.5] [S: BJJ_POSITIONS §3.2 T13] |
| `tech.rear_lift_suplex` (= ura nage from behind) | `pos.clinch_body_lock_rear` | `pos.td_lifted` → `pos.ground_side` 0.55 / `pos.ground_north_south` 0.15 / `pos.scramble` 0.30 + slam damage 0.8× (§05); **salto risk**: 10 % of successes send the attacker to `pos.scramble` at a disadvantage | stays | strength high | 1,000 | 0.35 | `wr.mat_return` ∥ `jd.throw_rear` vs `wr.get_up`, k 2.1 | STR++, MASS++ | Greco +0.63 `[D: +15 pp]`, CAGE+0.22 (×1.25 P) | base, hook a leg, spin in | [S: WRESTLING §3.5] [S: JUDO §3 ura nage, §5.3] |
| `tech.rear_trip` (ko uchi gake / o soto gake from behind, tani otoshi) | `pos.clinch_body_lock_rear` | `pos.ground_back_hooks` 0.4 / `pos.ground_turtle` 0.35 / `pos.ground_side` 0.25 | stays | defender's weight on the hooked leg | 800 | 0.45 [E] (between mat return 0.55 and rear throw 0.35) | `wr.mat_return` ∥ `jd.throw_rear` vs `wr.get_up`, k 2.1 | STR+ | CAGE+0.42 | step over, base wide | [E] |
| `def.wrestle_up_rear_lock` | `pos.clinch_body_lock_rear` (defender) | `pos.standing_close` 0.5 / `pos.clinch_underhook` (defender turns in) 0.5 | attacker retains | wrist control on the lock, hips forward, elbows down | 1,000–2,000 (rolled per 3 s window) | 0.30 per 3 s | `wr.get_up` vs `wr.mat_return`, k 2.1 | STR+ | FAT− | re-lock, knee behind knee, trips | [S: WRESTLING §3.5] |
| `tech.front_headlock_go_behind` | `pos.clinch_front_headlock`, `pos.td_sprawl` | `pos.ground_turtle` (top) 0.60 / `pos.ground_back_seatbelt` 0.40 | stays (after 4 s of no progress the front headlock decays: `pos.standing_close` 0.60 / `pos.clinch_collar_tie` 0.40) | defender's hands on the mat / posture broken | 700 | 0.45 (0.70 vs a bent-over T0–T1) | `wr.pummel` vs `wr.scramble`, k 2.1 | STR+ | FATd+ | posture up, peel the chin strap, sit-out | [S: WRESTLING §3.6] [S: WRESTLING §9 r12] |
| `tech.front_headlock_sub_entry` | `pos.clinch_front_headlock`, `pos.ground_front_headlock` | `sub.guillotine_high_elbow` / `sub.guillotine_arm_in` (entry 0.25), `sub.anaconda` / `sub.darce` (entry 0.20, needs the arm inside), `sub.peruvian_necktie` (§04) | stays; defender escapes to `pos.standing_close` 0.30 | chin strap / arm-in | 500–1,000 | entry as listed; finish per §04 | §04 | RCH+ | — | head-out, hips in, drive, hand fight | [S: WRESTLING §3.6] |
| `tech.sprawl_to_front_headlock` | `pos.td_sprawl` (sprawler) | `pos.clinch_front_headlock` (standing) 0.5 / `pos.ground_front_headlock` 0.5 | `pos.standing_close` (both stand) | chest on the shooter's head/shoulder | 500 | 0.60 | `wr.sprawl` vs `wr.shot`, k 2.1 | — | — | post and stand, re-shoot | [S: WRESTLING §3.7] |
| `tech.sprawl_spin_behind` | `pos.td_sprawl` (sprawler) | `pos.ground_turtle` (top) 0.6 / `pos.ground_back_seatbelt` 0.4 | `pos.standing_close` | shooter stays on the knees | 1,000 | 0.35 (0.65 vs a T0–T1 who stays down) | `wr.sprawl` vs `wr.scramble`, k 2.1 | — | — | sit-out or stand | [S: WRESTLING §3.7] |
| `tech.sprawl_knees` | `pos.td_sprawl` (sprawler) | same + knee to the body (§02); knees to the head only if the shooter is not grounded (§06 flag) | — | shooter's head/body available | 500 per knee | §02; +0.42 head-damage multiplier if the attacker's head is down `[D: +0.10]` | `mma.anti_wrestling` | — | — | cover, stand | [S: WRESTLING §3.7, §9 r23] |
| `tech.hip_heist_out` | `pos.td_sprawl` (shooter), `pos.ground_turtle` (bottom) | `pos.standing_close` 0.6 / `pos.clinch_underhook` 0.4 | stays | one foot posted, hips through | 500 | 0.40 | `wr.scramble` vs `wr.ride`, k 2.1 | speed +0.05/10 [E] | — | tight waist, ankle | [S: WRESTLING §3.9] |
| `tech.clinch_break` | any `pos.clinch_*` (open mat) | `pos.standing_close` | stays | hip distance / posting | 500 | 0.60 (post and exit) | `wr.pummel` vs `wr.pummel`, k 2.0 | STR+ | CAGE: n/a (use `tech.cage_break`, §E) | hitting on the break | [S: MUAY_THAI §4.3] |
| `tech.thai_turn` | `pos.clinch_thai_plum`, `pos.clinch_collar_tie` (frame) | same node, opponent balance −2 (§02 balance scalar), kuzushi lateral mag +1; sets up `tech.thai_dump` | stays | frame or inside position | 500 | 0.40 | `mma.clinch_strike` ∥ `jd.grip` vs same, k 2.0 | STR+ | — | base, swim | [S: MUAY_THAI §4.3] |
| `tech.thai_dump` | `pos.clinch_thai_plum` after a successful turn, or opponent posting on one leg | `pos.ground_open_legs_up` (dumper standing over) 0.7 / `pos.ground_side` 0.3 | stays | turn succeeded | 600 | 0.30 (0.50 for clinch specialists: `mma.clinch_strike` ≥ 80 [E]) | `jd.foot_sweep` ∥ `wr.finish` vs `jd.throw_def`, k 2.1 | STR+ | — | base, hip-in | [S: MUAY_THAI §4.3] |
| `tech.plum_knee` | `pos.clinch_thai_plum` (holder) | same + knee (§02): lands 0.55 dominant / 0.30 neutral / 0.15 defensive | same | dominance index (§02 clinch model) | 400 | per §02 | `mma.clinch_strike` | — | snap-down success → +0.20 P knee window for 1 s | knee shield / hip-in 0.50 | [S: MUAY_THAI §4.3] |
| `tech.plum_swim_escape` | `pos.clinch_thai_plum` (held) | `pos.clinch_over_under` 0.6 / `pos.clinch_collar_tie` (roles swapped) 0.4 | stays (eats a knee window) | not fully locked | 400 per beat | 0.45 per beat | `wr.pummel` vs `wr.pummel`, k 2.0 | STR+ | — | cross-face, re-pinch the elbows | [S: MUAY_THAI §4.3] |

#### D. Judo throws (no-gi / MMA form) and counter-throws

Grip gate [S: JUDO §2.3, §8 r1]: a throw edge is available only from tie-ups that supply **both** a pull
handle (wrist, overhook, head) and a lift/steer handle (collar tie, underhook, body lock, head). Single-handle
nodes (`pos.clinch_hand_fight`, `pos.clinch_collar_tie` alone) expose only de ashi, sasae, ko uchi, o uchi and
snap-downs. `KUZ` applies to every row. **Failure table** (rolled once per failed throw) [S: JUDO §8 r9]:
reset to the same tie 0.62 / tie lost → `pos.clinch_hand_fight` 0.18 / position given 0.10 (0.30 for seoi,
ippon seoi, kata guruma and drop entries → the defender takes `pos.clinch_body_lock_rear` or
`pos.clinch_front_headlock`; 0.30 for sumi gaeshi / tomoe nage → attacker on the bottom) / counter-throw
launched 0.10 × commitment (uchi mata, harai, o soto, o goshi, koshi guruma ×1.5; tai otoshi, o uchi, ko uchi
×1.0; de ashi, sasae ×0.3) × defender tier factor (T0–T1 0.3, T2–T3 1.0, T4–T5 1.5); a launched counter
succeeds at its conditional rate (column "base" of the counter rows); on failure both reset. Any throw taking
> 1,000 ms gives the defender one free strike check at 0.5 × clinch accuracy (§02); a landed power strike
aborts the throw [S: JUDO §8 r8]. Landing damage events (§05): 0.5 × slam scale for hip/shoulder throws, 0.8
for ura nage / tani otoshi, 0.2 for foot sweeps and inside reaps [S: JUDO §8 r11]. Landing distributions
[S: JUDO §5.3]. Same-side attack +0.14 logit `[D: ×1.15 P]`; kenka-yotsu same-side +0.22 `[D: ×1.25]`;
cross-side −0.10 `[D: ×0.9]` [S: JUDO §8 r5]. Handle decay: wrist/collar 20 % slip per 5 s, underhook /
overhook / body lock 5 % [S: JUDO §8 r12].

| id | from | → success (tori) | → fail / counter | requirements / kuzushi | dur ms | base (no-gi) | k_skill | phys | state | counters | src |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tech.uchi_mata` | `pos.clinch_underhook` (+ wrist/collar), `pos.clinch_head_and_arm`, `pos.clinch_over_under` (underhook side) | `pos.ground_side` 0.60 / `pos.ground_side_kesa` 0.25 / standing over → `pos.ground_open_legs_up` 0.10 / `pos.ground_turtle` (top) 0.05 | failure table; primary counter `tech.uchi_mata_sukashi` | front-corner kuzushi; hip under, near leg loaded; ken-ken hops +500 ms each (chain) | 900–1,400 | 0.25 | `jd.throw_fwd` vs `jd.throw_def`, k 2.4 | STR+, FLX+, HGT+ | KUZ, CAGE−0.36 `[D: ×0.7]` | sukashi, te guruma (catch the lifted leg), limp-arm out of the underhook → back | [S: JUDO §3] |
| `tech.osoto_gari` | `pos.clinch_collar_tie` + wrist, `pos.clinch_over_under` (underhook side), `pos.clinch_head_and_arm`, cross-body from the opposite underhook | `pos.ground_side` 0.55 / `pos.ground_half_flat` 0.30 / `pos.ground_back_seatbelt` 0.10 / `pos.scramble` 0.05 | failure table; mirror counter `tech.osoto_gaeshi`; cross-body version exposes the back (position-given share 0.20 [E]) | back-corner kuzushi; chest-to-chest drive; uke square or leaning back | 800–1,200 | 0.30 | `jd.throw_rear` vs `jd.throw_def`, k 2.4 | STR+, EXP+, HGT+ | KUZ, CAGE+0.42 (as a trip) | o soto gaeshi, ura nage, overhook + hip-in | [S: JUDO §3] |
| `tech.harai_goshi` | `pos.clinch_overhook_control`, `pos.clinch_head_and_arm`, `pos.clinch_body_lock_front` (waist), `pos.clinch_over_under` (overhook side) | `pos.ground_side` 0.60 / `pos.ground_side_kesa` 0.25 / `pos.ground_open_legs_up` 0.10 / `pos.ground_turtle` 0.05 | failure table; counters `tech.harai_gaeshi`, `tech.tani_otoshi`, `tech.te_guruma` | front-corner; hip across, sweeping leg across both thighs; uke close and slightly bent | 900–1,300 | 0.28 | `jd.throw_fwd` vs `jd.throw_def`, k 2.4 | STR+, FLX+, BALd | KUZ, CAGE−0.36 | hips back + whizzer, sit back (tani otoshi), catch the sweeping leg | [S: JUDO §3] |
| `tech.koshi_guruma` | `pos.clinch_head_and_arm` (Rousey entry), `pos.clinch_overhook_control` + head | `pos.ground_side_kesa` 0.50 / `pos.ground_side` 0.35 / `pos.ground_open_legs_up` 0.10 / `pos.ground_turtle` 0.05 (kesa-biased: arm already round the head) | failure table; MMA counter: head pop-out → `pos.clinch_body_lock_rear` (def) 0.35 conditional | front-corner; head controlled and bent | 800–1,200 | 0.25 | `jd.throw_fwd` vs `jd.throw_def`, k 2.4 | STR+, FLX+, HGT− | KUZ, CAGE−0.36 | o goshi (mirror), tani otoshi, head pop-out | [S: JUDO §3, §4] |
| `tech.o_goshi` | `pos.clinch_body_lock_front` (arm round the back), `pos.clinch_head_and_arm`, `pos.clinch_overhook_control` | `pos.ground_side` 0.60 / `pos.ground_side_kesa` 0.25 / `pos.ground_open_legs_up` 0.10 / `pos.ground_turtle` 0.05 | failure table; MMA counter: hips back + whizzer, or step around to `pos.clinch_body_lock_rear` (def) 0.30 conditional | front; hips fully across and below, knees bent | 900–1,200 | 0.22 | `jd.throw_fwd` vs `jd.throw_def`, k 2.4 | STR+, EXP+, FLX+, HGT− | KUZ, CAGE−0.36 | koshi guruma (mirror), tani otoshi, step-around back take | [S: JUDO §3] (Harrison; Fedor vs Mir) |
| `tech.ouchi_gari` | `pos.clinch_collar_tie`, `pos.clinch_underhook`, `pos.clinch_over_under`, `pos.clinch_body_lock_front`, `pos.clinch_cage_pin_front` | `pos.ground_open_kneeling_top` 0.60 / `pos.ground_half_flat` 0.30 / uke stands 0.10 (no side control by default) | failure table; counter `tech.ouchi_gaeshi`; MMA: uke whizzers and drives → uke top in `pos.ground_half_flat` | back / back-corner; far leg weighted or uke square on the fence | 600–900 | 0.32 | `jd.throw_rear` vs `jd.throw_def`, k 2.4 | STR+, HGT+ | KUZ, CAGE+0.41 `[D: ×1.5]` | o uchi gaeshi, whizzer + sprawl the hooked leg, sweep the post leg | [S: JUDO §3] |
| `tech.kouchi_gari` (inside trip / knee tap family) | `pos.clinch_collar_tie`, `pos.clinch_over_under`, `pos.clinch_body_lock_front`, `pos.clinch_underhook` | `pos.ground_open_kneeling_top` 0.60 / `pos.ground_half_flat` 0.30 / uke stands 0.10 | failure table; MMA: uke sprawls the hooked leg out and snaps down → `pos.clinch_front_headlock` (def) 0.25 conditional | back (to the reaped heel); near heel weighted | 500–800 | 0.30 | `jd.foot_sweep` ∥ `jd.throw_rear` vs `jd.throw_def`, k 2.4 | EXP+, BALd | KUZ, CAGE+0.41 | hiza guruma, sumi otoshi, step out | [S: JUDO §3] |
| `tech.tai_otoshi` | `pos.clinch_collar_tie` + wrist, `pos.clinch_overhook_control`, `pos.clinch_head_and_arm` | tori standing, uke on back → `pos.ground_open_legs_up` 0.50 / `pos.ground_side` 0.40 / uke scrambles up 0.10 | failure table (commitment ×1.0); counters mirror tai otoshi, sumi gaeshi, ko soto | front-corner; block the near shin; no lift needed | 700–1,000 | 0.20 | `jd.throw_fwd` vs `jd.throw_def`, k 2.4 | own balance +0.05/10 [E] | KUZ, CAGE−0.36 | bend knees and drive through, step over the leg | [S: JUDO §3] |
| `tech.sumi_gaeshi` | `pos.clinch_overhook_control`, `pos.clinch_front_headlock`, `pos.clinch_over_under` (rare) | rolls through to `pos.ground_mount_low` 0.35 / `pos.ground_side` 0.25 / **tori on bottom** `pos.ground_closed_posture_up` (uke top) 0.30 / uke passes → `pos.ground_side` (uke top) 0.10 | failure table (bottom-position share 0.30) | front kuzushi; uke bent or pushing forward | 1,000–1,500 | 0.15 | `jd.throw_fwd` ∥ `bjj.sweep` vs `jd.throw_def`, k 2.4 | FLX+, BALd | KUZ (needs uke's forward pressure: mag ≥ 2 or the throw is at ×0.5) | o uchi before tori sits; uke posts and ends on top | [S: JUDO §3, §5.3] |
| `tech.tomoe_nage` | `pos.clinch_collar_tie` + wrist | `pos.ground_mount_low` 0.35 / `pos.ground_side` 0.25 / tori on bottom 0.30 / uke passes 0.10 | failure table (bottom 0.30); MMA counter: uke stays standing and strikes (uke ends on top 0.40 conditional) | front; both hands controlled, uke leaning in | 1,000–1,400 | 0.05 | `jd.throw_fwd` vs `jd.throw_def`, k 2.4 | FLX+, BALd, strength −0.05/10 [E] | KUZ | ko soto before launch; stay standing | [S: JUDO §3] (Low viability) |
| `tech.ippon_seoi` (arm-trap shoulder throw) | `pos.clinch_hand_fight` (wrist + arm scoop), `pos.clinch_overhook_control` (opposite view), caught punch | `pos.ground_side` 0.55 / `pos.ground_side_kesa` 0.20 / `pos.ground_back_seatbelt` (uke on side facing away) 0.15 / `pos.ground_open_legs_up` 0.10 | failure table with position-given 0.30 → uke `pos.clinch_body_lock_rear` (back take 0.55 conditional) or `sub.guillotine_standing` off a failed drop | front-corner; arm trapped over the shoulder, hips under, feet inside | 700–1,000 | 0.15 | `jd.throw_fwd` vs `jd.throw_def`, k 2.4 | EXP+, STR+, FLX+, HGT− | KUZ, CAGE−0.36 | squat + hips back + arm over → back take; guillotine | [S: JUDO §3, §4] |
| `tech.morote_seoi` (two-hand) | `pos.clinch_hand_fight` + inside bicep (arm-drag seoi) | as ippon seoi | as ippon seoi (position-given 0.30) | full turn; back to uke | 700–1,100 | 0.12 | `jd.throw_fwd` vs `jd.throw_def`, k 2.4 | EXP+, FLX+, HGT− | KUZ, CAGE−0.36 | back take, ushiro goshi | [S: JUDO §3] (Low–Med) |
| `tech.kata_guruma` (fireman's carry) | `pos.clinch_hand_fight` (wrist + arm scoop), `pos.clinch_two_on_one`, caught punch | `pos.ground_side` 0.55 / `pos.ground_side_kesa` 0.20 / `pos.ground_back_seatbelt` 0.15 / `pos.ground_open_legs_up` 0.10 | failure table; MMA counter: sprawl → `pos.clinch_front_headlock` (def) / `sub.guillotine_standing` / back, 0.45 conditional | front-corner; drop under the arm, shoulder into the hip, arm between the legs | 1,200–1,800 | 0.18 | `jd.throw_fwd` ∥ `wr.finish` vs `wr.sprawl`, k 2.4 | STR+, EXP+, HGT− | KUZ; disabled under the judo ruleset (leg grab) | o uchi before tori leaves the ground; sprawl and guillotine | [S: JUDO §3, §8 r16] |
| `tech.ura_nage` (front body-lock back arch) | `pos.clinch_body_lock_front`, deep underhook in `pos.clinch_over_under`; classic counter to a forward throw | `pos.ground_side` / `pos.ground_north_south` 0.55 / `pos.scramble` 0.30 / uke lands on tori 0.15 + slam 0.8× | failure table; counter: ko uchi / o uchi before the lift | back kuzushi; uke leaning in or turned | 1,000–1,500 | 0.20 direct / 0.35 as counter | `jd.throw_rear` vs `jd.throw_def`, k 2.4 | STR+, EXP+, HGT− | KUZ, CAGE+0.22 (×1.25), Greco +0.63 | hook a leg, drop weight and turn in (ends in tori's front headlock) | [S: JUDO §3, §5.3] |
| `tech.te_guruma` (sukui nage / hand wheel) | `pos.clinch_body_lock_front` (hand behind the far knee), `pos.clinch_underhook` + thigh grab; counter to uchi mata / harai | `pos.ground_side` 0.60 / `pos.ground_side_kesa` 0.25 / `pos.ground_open_legs_up` 0.15 | failure table | lateral / back-corner; catch the planted leg, drive with the waist arm | 900–1,300 | 0.30 direct / 0.45 as counter | `jd.counter` ∥ `wr.finish` vs `jd.throw_def`, k 2.4 | STR+, EXP+ | CAGE+0.22 (×1.25); disabled in the judo ruleset | whizzer and sprag the lifted leg | [S: JUDO §3] |
| `tech.tani_otoshi` (valley drop) | `pos.clinch_over_under`, `pos.clinch_body_lock_rear`, `pos.clinch_body_lock_front` when uke drives; counter to forward turns | `pos.ground_side` 0.55 / `pos.ground_half_flat` 0.30 / `pos.scramble` 0.15 + slam 0.8× | failure table; counter: ko soto (difficult) | back-corner; uke driving or turning in | 800–1,200 | 0.15 direct / 0.40 as counter | `jd.counter` ∥ `jd.throw_rear` vs `jd.throw_def`, k 2.4 | STR+ | CAGE+0.42; knee-injury flag on uke (§05) [E] | base wide, turn in | [S: JUDO §3, §5.3] |
| `tech.de_ashi_harai` (advancing foot sweep) | `pos.clinch_collar_tie`, `pos.clinch_hand_fight`, `pos.clinch_over_under`, even `pos.standing_close` on uke's step | uke down, tori standing → `pos.ground_open_legs_up` 0.70 / tori follows → `pos.ground_side` 0.20 / uke pops up 0.10 | failure table (commitment ×0.3: near-zero counter risk) | lateral kuzushi; uke stepping, weight not yet transferred | 300–600 | 0.08 | `jd.foot_sweep` vs `jd.throw_def`, k 2.4 | BALd, own balance +0.05/10 [E] | KUZ (timing) | tsubame gaeshi (mirror), o soto, step over | [S: JUDO §3] |
| `tech.sasae_tsurikomi_ashi` | `pos.clinch_collar_tie` + wrist, `pos.clinch_two_on_one` | `pos.ground_open_legs_up` 0.50 / `pos.ground_side` 0.40 / uke scrambles 0.10 | failure table (×0.3) | front-corner; prop the advancing ankle; uke stepping forward | 500–800 | 0.08 | `jd.foot_sweep` vs `jd.throw_def`, k 2.4 | BALd | KUZ | step over | [S: JUDO §3] |
| `tech.hane_goshi` | `pos.clinch_overhook_control`, `pos.clinch_head_and_arm` | as harai goshi | as harai goshi | front-corner; bent leg springs the thigh | 900–1,200 | 0.20 | `jd.throw_fwd` vs `jd.throw_def`, k 2.4 | STR+, FLX+ | KUZ, CAGE−0.36 | as harai | [S: JUDO §3] |
| `tech.uchi_mata_sukashi` (counter only) | fires during uke's committed `tech.uchi_mata` (any tie giving a pull) | `pos.ground_side` 0.60 / `pos.ground_side_kesa` 0.25 / standing over 0.15 | both reset | step the attacked leg around/outside the sweeping leg; pure timing | 400–700 | 0.50 conditional on the launched counter (launch per the failure table) | `jd.counter` vs `jd.throw_fwd`, k 2.4 | BALd, own balance + | — | none (uke is mid-throw) | [S: JUDO §3, §4] (90–100 % when launched in gi; no-gi 50 %) |
| `tech.osoto_gaeshi` / `tech.harai_gaeshi` / `tech.ouchi_gaeshi` (mirror counters) | same tie as the attack being countered | counter-thrower → `pos.ground_side` 0.60 / `pos.ground_side_kesa` 0.25 / standing over 0.15 | both reset | block the reap/sweep, reap the support leg | 600–1,000 | 0.35 / 0.30 / 0.25 conditional | `jd.counter` vs the attacker's throw skill, k 2.4 | BALd, STR+ | CAGE−0.36 (uke's counter launch ×0.7 on the fence [S: JUDO §8 r13]) | — | [S: JUDO §4] |
| `tech.seoi_back_take` (MMA counter to shoulder throws) | during uke's failed `tech.ippon_seoi` / `tech.morote_seoi` / `tech.kata_guruma` | `pos.clinch_body_lock_rear` (counter-thrower) 0.6 / `pos.ground_back_seatbelt` 0.4 | reset | squat, hips back, arm over | 500 | 0.55 conditional | `wr.pummel` vs `jd.throw_fwd`, k 2.1 | — | — | — | [S: JUDO §4] |
| `tech.grip_exchange` (kuzushi action) | any `pos.clinch_*` | `underhookOwner` / head position gained; kuzushi mag +1 in the chosen direction (max 3, decays −1 per 2 s); dominant tie ⇒ next throw ×1.3 P; opponent-dominant ⇒ ×0.6 and a free counter roll | opponent gains | — | 3,000–8,000 (elite grip disputes 16–18 s = 2–3 exchanges) | 0.50 | `jd.grip` vs `jd.grip`, k 2.5 `[D: JUDO §8 r4 0.05 P per point on 0–10 ⇒ 0.5 P per 100 ⇒ 2.0 logit/100 at slope 0.25; rounded up to 2.5 so T5 vs T2 reaches the 0.85 clamp]`; clamp P 0.15–0.85 | STR+ | exchange duration × massKg/70 `[D: heavyweights 165 s vs extra-light 60 s of grip time, JUDO §10 r9]` | — | [S: JUDO §8 r4, r6] |

#### E. Cage-specific edges (standing and ground; see §4 for the model)

| id | from | → success | → fail / counter | requirements | dur ms | base | k_skill | phys | state | counters | src |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tech.cage_drive` | any `pos.clinch_*` with the defender ≤ 2 m from the fence; a stalled `tech.double_leg` with STR/MASS advantage pushes the defender 1–2 m (0.60) | `pos.clinch_cage_pin_front` | stays (defender circles off) | forward drive | 1,000–2,000 | 0.60 (vs open-mat circling; tier use: T2 50 %, T3 75 %, T4 90 % of stalled attempts [S: WRESTLING §7]) | `mma.cage` vs `mma.cage`, k 2.0 | STR+, MASS+ | FAT− | circle out, hip-in, underhook | [S: WRESTLING §4 chain 8, §5.1] |
| `tech.cage_pin_pummel` | `pos.clinch_cage_pin_front` (every 3,000 ms) | pinner gains {underhook, double unders, body lock, head position}; a pinned fighter who wins double-unders reverses the pin 0.25 or breaks 0.35 | loser's position | — | 3,000 | `P = 0.5 + 0.004·ΔWR + 0.003·ΔSTR − 0.15·ΔFAT` (in P, then re-expressed as logit terms in §2.1.4) | `wr.pummel` vs `wr.pummel`, k 1.6 | STR+ (0.12/10) | FAT (−0.63 × Δfatigue) | — | [S: WRESTLING §5.3] |
| `tech.cage_break` | `pos.clinch_cage_pin_front` / `pos.clinch_cage_pin_rear` (pinned) | `pos.standing_cage` (roles: pinned fighter circles out and off the fence) | stays pinned | underhook + hip-in + circle out | 5,000 (rolled per 5 s) | 0.30 per 5 s (+0.42 `[D: +10 pp]` if the pinner's head is on the wrong side) | `mma.cage` vs `mma.cage`, k 2.0 | STR+ | FAT−; pinned energy ×1.3 per second (§05) | knee behind knee, tight waist, re-pin | [S: WRESTLING §5.2] |
| `def.cage_hip_in` | `pos.clinch_cage_pin_front` (pinned) vs any drive/lift finish | halves the pinner's per-attempt drive/lift finish P; trips unaffected | — | back flat on the fence, hips forward, hand posts (open hand on the fence is legal; grabbing is a foul, §06) | continuous | ×0.5 on drive/lift finishes | `mma.cage` vs `wr.finish`, k 2.0 | STR+ | — | switch to trips / knee-tap / foot stomps | [S: WRESTLING §5.2] |
| `tech.cage_pin_strikes` | `pos.clinch_cage_pin_front` (either) | same + strike: pinner knees to thigh (fatigue damage, low KO) / knees to body / short elbows; pinned: elbows over the top, knees; land rates 0.50–0.65 (§02) | same | free limb | 400–600 | §02 | `mma.clinch_strike` | — | each pinner strike resets the §6 clinch-break timer | — | [S: WRESTLING §5.2, §9 r23] [S: MMA_INTEGRATION I-11] |
| `tech.foot_stomp` | `pos.clinch_cage_pin_front`, `pos.clinch_over_under` (cage) | same node; no damage; +0.21 logit `[D: +0.05 P]` on the next trip within 2 s; counts as "work" for §6 | same | free foot | 300 | lands 0.50 [E] | `mma.clinch_strike` | — | — | lift the foot, step | [S: WRESTLING §9 r23] |
| `tech.cage_single_chain` | `pos.td_single_leg_in` (`cage`) | the attacker cycles finishes: `tech.single_trip` (+0.42), `tech.single_dump` (+0.42), `tech.single_to_double`, `tech.single_run_pipe` (−1.05, ×0.5 vs hip-in); up to 6 attempts; every attempt ×1.5 duration | after 6 failed attempts → `pos.clinch_cage_pin_front` 0.6 / `pos.standing_cage` 0.4 | fence contact | 1,500–3,000 per attempt (cage single lasts 10–40 s total) | per finish edge; cumulative 0.45–0.60 over the chain | as the finish edges | — | CAGE terms as listed | wall walk (I-14), underhook + hip-in, whizzer + circle | [S: MMA_INTEGRATION I-8] [S: WRESTLING §5.2, §8.4] |
| `tech.wall_walk` | `pos.ground_cage_seated`, `pos.ground_half_flat` (cage), `pos.ground_side` (wall), `pos.ground_turtle` (cage), `pos.ground_back_hooks` (bottom can reach the fence) | stage 1 → `pos.ground_wall_walk` (reach feet 0.60 per attempt); stage 2 from `pos.ground_wall_walk`: `pos.standing_cage` clean 0.35 / `pos.clinch_cage_pin_front` (attacker keeps a body lock) 0.45 / back to the ground node 0.20 | stage 1 fail → `pos.ground_cage_seated` (dragged down) 0.60 / `pos.ground_turtle` (cage) 0.30 / `pos.ground_back_hooks` 0.10 | back on the fence, near-side underhook or open hand on the fence, feet under the hips; the bottom fighter's balance > 30 % | 3,000–6,000 per cycle (5 s cycle in I-14) | stage 1 0.60 (BJJ: 0.40 per attempt, cumulative ≈ 0.60 over 30 s — we adopt WRESTLING's 0.60 reach-feet × 0.35 clean ≈ 0.21 clean per cycle, 0.48 including "up but held"); vs strikers higher, vs elite riders lower | `wr.get_up` ∥ `mma.cage` vs `wr.ride` ∥ `mma.cage`, k 3.0 | STR++, MASS++ | CAGE (required), UHO, FAT−−, `[S: WRESTLING §9 r17]` +0.10 P × top fatigue (FATd+); fence-grab foul 5 % of attempts at T ≤ 1 → −0.5 logit + §06 warning | knee behind knee, tight waist, hip pressure, knees to thigh/body during the walk, mat return, twist body lock | [S: WRESTLING §3.8] [S: BJJ_POSITIONS §3.2 G2] [S: MMA_INTEGRATION I-14] |
| `tech.wall_walk_back_escape` | `pos.ground_back_hooks` / `pos.ground_back_body_triangle` with the fence reachable | `pos.clinch_body_lock_rear` (standing, top keeps the lock) 0.60 / `pos.standing_cage` free 0.40 | dragged back → `pos.ground_back_hooks` (retry) | hand-fight the choke first, walk the hips up the wall | 5,000–15,000 | 0.40 vs hooks (0.20 vs body triangle `[D: E11 10 % per attempt ⇒ half]`) | `wr.get_up` vs `bjj.back_control`, k 3.0 | STR++, MASS++ | CAGE (required), FAT−− | stretch the hooks, mat return, choke while standing | [S: BJJ_POSITIONS §3.2 E12] |
| `tech.cage_mat_return` | `pos.clinch_cage_pin_rear`, `pos.ground_wall_walk` (top) | `pos.ground_turtle` (cage) 0.55 / `pos.ground_back_hooks` 0.30 / `pos.ground_cage_seated` 0.15 | stays | knee behind knee; the wall helps | 1,000–2,000 | 0.70 (rear lock on the cage with knee-behind-knee) | `wr.mat_return` vs `wr.get_up`, k 2.1 | STR+, MASS+ | CAGE+ (already in base) | wrist control + turn in, foot post on the cage | [S: WRESTLING §3.5] |
| `tech.cage_knee_pin` | `pos.ground_cage_seated`, `pos.ground_wall_walk` (top) | top denies the wall walk: `pos.ground_cage_seated` with `underhookOwner = top` (bottom's wall-walk P −0.35 UHO), pass to `pos.ground_side` (wall) 0.30 | bottom keeps the underhook | inside knee pinning the bottom's near hip, body lock | 2,000–4,000 | 0.50 [E] | `mma.cage` ∥ `bjj.top_control` vs `mma.cage` ∥ `wr.get_up`, k 2.5 | STR+, MASS+ | CAGE (required) | knee shield along the fence, wrist control on the striking hand | [S: BJJ_POSITIONS §5.3] (knee pin, body-lock pinning); value [E] |
| `tech.cage_assisted_pass` | any guard vs `pos.ground_cage_seated` or a wall-adjacent half guard | `pos.ground_side` (wall) 0.60 / `pos.ground_mount_low` 0.10 / `pos.ground_turtle` (cage, bottom turns) 0.30 | bottom wall-walks to standing 0.30 of fails / stays | bottom pinned with back/shoulders on the fence; "pin the near hip, walk the far side" | 8,000–20,000 | 0.45 | `bjj.pass` ∥ `mma.cage` vs `bjj.retention`, k 3.0 | STR+ | CAGE (this is the +0.70 = `++`), STK+ | wall walk with underhook, knee shield to create space along the fence | [S: BJJ_POSITIONS §3.2 P10] |

#### F. Guard passes (top-initiated)

| id | from | → success | → fail / counter | requirements | dur ms | base | k_skill | phys | state | counters | src |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tech.pass_knee_cut` | `pos.ground_half_flat`, `pos.ground_half_knee_shield`, `pos.ground_hq` | `pos.ground_side` 0.70 / `pos.ground_mount_low` 0.10 / `pos.ground_side_kesa` 0.20 | same node; counter (0.25 of fails) → bottom recovers `pos.ground_half_underhook` or `pos.ground_half_dogfight`; (0.05) → `pos.ground_ashi_slx` (T4+ bottom) | underhook or cross-face + pin the knee shield; inside knee across the thigh; head low on the far side | 6,000–15,000 | 0.35 | `bjj.pass` vs `bjj.retention`, k 3.0 | STR+, MASS+ | STK+ (elbows during the slice), CAGE+0.35 (bottom can't shrimp away), FATd+ | knee shield + far frame; underhook + roll-under; wrestle-up on the sliced leg; leg entanglement on the exposed lead leg | [S: BJJ_POSITIONS §3.2 P1] |
| `tech.pass_toreando` | `pos.ground_open_legs_up`, `pos.ground_open_kneeling_top` | `pos.ground_side` 0.60 / `pos.ground_side_kob` 0.25 / `pos.ground_north_south` 0.15 | bottom re-guards (`pos.ground_open_*`) 0.80 / stands via technical stand-up 0.20 of fails | shin/ankle/knee control (no pants → 2-on-1 on a leg or knee push), push the legs aside, circle | 3,000–8,000 | 0.40 (0.45 vs an MMA-typical weak open guard) | `bjj.pass` vs `bjj.retention`, k 3.0 | — | WET, STK+ (bottom guards the face → loses leg frames) | hip escape + re-guard, leg pummel, up-kick when top dives, sit up to wrestle | [S: BJJ_POSITIONS §3.2 P2] |
| `tech.pass_leg_drag` | `pos.ground_open_kneeling_top`, `pos.ground_ashi_slx`/`pos.ground_open_x` (top escaping), `pos.ground_half_knee_shield` (after stripping) | `pos.ground_side` 0.50 / `pos.ground_back_hooks` (via turtle) 0.20 / `pos.ground_mount_tech` 0.10 / `pos.ground_side_kob` 0.20 | `pos.ground_half_flat` (bottom pulls the knee back) 0.7 / `pos.scramble` 0.3 | drag the leg across the hip, pin the thigh with the hip, control the far hip/head | 4,000–10,000 | 0.35 | `bjj.pass` vs `bjj.retention`, k 3.0 | — | WET, STK+ | hip escape + knee back; turn to turtle then stand | [S: BJJ_POSITIONS §3.2 P3] |
| `tech.pass_over_under` | `pos.ground_open_kneeling_top`, `pos.ground_half_flat` (after freeing the knee) | `pos.ground_side` 0.80 / `pos.ground_mount_low` 0.20 | same; counter: `sub.kimura` on the over arm (0.10 of fails), `sub.triangle` on the under arm (0.05) | one arm under a leg, one over, head low, drive laterally | 5,000–15,000 | 0.40 | `bjj.pass` vs `bjj.retention`, k 2.0 | STR++, MASS++ | STK− (hands busy), CAGE+0.35 | hip escape, kimura, frame on the head, leg on the shoulder → triangle | [S: BJJ_POSITIONS §3.2 P4] |
| `tech.pass_double_under_stack` | `pos.ground_open_kneeling_top`, `pos.ground_closed_top_standing` (after opening) | `pos.ground_side` 0.70 / `pos.ground_mount_low` 0.30 | bottom re-guards; counter: `sub.triangle` 0.05, `sub.kimura` 0.05, back roll-over → `pos.scramble` 0.10 of fails | both arms under the thighs, clasp, stack | 5,000–15,000 | 0.35 | `bjj.pass` vs `bjj.retention`, k 2.0 | STR++, MASS++ | STK−; spiking illegal (§06 flag) | hand-fight the hips, extend the legs, roll to knees (→ `pos.ground_turtle`) | [S: BJJ_POSITIONS §3.2 P5] |
| `tech.pass_smash_half` | `pos.ground_half_flat`, `pos.ground_half_quarter` | `pos.ground_side` 0.60 / `pos.ground_mount_low` 0.40 | same; counter: bottom recovers the underhook → `pos.ground_half_underhook` (0.30 of fails) | cross-face + underhook or head control; flatten; free the foot by knee-out or foot-drag | 8,000–25,000 | 0.40 (the highest-percentage MMA pass) | `bjj.pass` vs `bjj.retention`, k 2.0 | STR++, MASS++ | STK+ (elbows force the frame down), CAGE+0.35, FATd+ (`++`: +2.0 × bottom fatigue) | underhook + knee-shield recovery, kimura on the cross-face arm (rare), lockdown | [S: BJJ_POSITIONS §3.2 P6] |
| `tech.pass_body_lock` | `pos.ground_open_legs_up`, `pos.ground_open_butterfly`, `pos.ground_open_seated`, `pos.ground_open_k`, `pos.ground_half_knee_shield` | `pos.ground_side` 0.50 / `pos.ground_half_flat` (with head control) 0.30 / `pos.ground_mount_low` 0.20 | bottom keeps `pos.ground_half_knee_shield` 0.85 / wrestles up → `pos.scramble` 0.15 of fails | chest-to-chest, arms locked around the waist/hips, sprawl the legs, walk the hips around | 15,000–45,000 | 0.45 (dominant no-gi pass) | `bjj.pass` vs `bjj.retention`, k 2.0 | STR++, MASS++ | STK− (no hands free), FATd+ (`++`) | frame on the shoulder/neck, knee shield, sit-up/wrestle-up, guillotine attempts on the lowered head (`sub.guillotine_high_elbow` entry 0.05 of attempts [E]) | [S: BJJ_POSITIONS §3.2 P7] |
| `tech.pass_hq` (knee cut / leg weave / backstep from headquarters) | `pos.ground_hq` | `pos.ground_side` 0.60 / `pos.ground_half_flat` 0.20 / `pos.ground_side_kesa` 0.20; backstep variant → `pos.ground_north_south`/`pos.ground_side` | `pos.ground_half_knee_shield`; counter: `pos.ground_ashi_slx` on the pinned leg (0.10 of fails at T4+ bottom), wrestle-up (0.20) | inside leg pinned between the bottom's legs; outside knee/foot control; posture | 4,000–12,000 | 0.40 | `bjj.pass` vs `bjj.retention`, k 3.0 | — | STK+ (punches from HQ posture), CAGE+0.35 | inside knee push (pummel out), shin-to-shin, wrestle-up to a single | [S: BJJ_POSITIONS §3.2 P8] |
| `tech.pass_float` (floating / backstep / weave, light and mobile) | `pos.ground_hq`, `pos.ground_open_kneeling_top`, `pos.ground_open_butterfly` | `pos.ground_side` 0.40 / `pos.ground_north_south` 0.20 / `pos.ground_side_kob` 0.20 / `pos.ground_back_seatbelt` 0.20 | `pos.scramble` 0.85 / bottom gets `pos.ground_ashi_slx` 0.15 of fails | balance, hip mobility; T3+ only (T0–T2: 0.10) | 3,000–8,000 | 0.30 | `bjj.pass` vs `bjj.retention`, k 3.5 | MASS− (−0.16/10 kg: lighter passers float better) | FAT− | wrestle-ups, leg entanglements, guard recomposition | [S: BJJ_POSITIONS §3.2 P9] |
| `tech.pass_north_south_to_mount_back` | `pos.ground_north_south` | `pos.ground_mount_low` (spin) 0.6 / `pos.ground_back_seatbelt` (bottom turns) 0.4 | `pos.ground_side` | hips heavy, arm control | 3,000–8,000 | 0.50 | `bjj.pass` ∥ `bjj.top_control` vs `bjj.escape`, k 2.0 | — | STK− | bottom hip-escapes to knees → `pos.ground_turtle` | [S: BJJ_POSITIONS §3.2 P12] |
| `tech.pass_with_gnp` (strike-to-pass wrapper) | any guard node where the top has a free hand | as the underlying pass (`tech.pass_knee_cut` / `tech.pass_smash_half` / `tech.pass_hq`) with STK+ | same node, top stamina spent; counter: submission on the striking arm (`sub.armbar`/`sub.kimura`/`sub.triangle`, 0.08 of fails), sweep during posture (0.12) | posture, hips heavy; strike then pass while the bottom covers | 10,000–30,000 | underlying + STK+ (max +0.6 logit) | as underlying | — | STK+ is the mechanism; `posture = 'postured'` during the strikes gives POST to the bottom | cover-and-frame, hip escape when the top posts, wrist control | [S: BJJ_POSITIONS §3.2 P11] [S: MMA_INTEGRATION I-16] |
| `tech.open_closed_guard` | `pos.ground_closed_posture_up` (top) | `pos.ground_open_kneeling_top` 0.6 / `pos.ground_closed_top_standing` 0.4 (then `tech.pass_double_under_stack`/`tech.pass_toreando`) | `pos.ground_closed_posture_broken` (bottom pulls the head) 0.30 of fails / stays | posture, hands on hips/biceps or stand | 3,000–8,000 | 0.55 [E] | `bjj.pass` vs `bjj.retention`, k 2.5 | STR+ | STK+ (punches to open the guard; T0–T1 guards open after 3/5 landed strikes [S: BJJ_POSITIONS §6]) | break posture, hip bump, armbar/triangle entries | [E]; guard-opening-by-strikes [S: BJJ_POSITIONS §6] |

#### G. Top consolidation and advancement (non-pass)

| id | from | → success | → fail / counter | requirements | dur ms | base | k_skill | phys | state | counters | src |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tech.side_to_mount` | `pos.ground_side`, `pos.ground_side_kesa`, `pos.ground_side_reverse_kesa` | `pos.ground_mount_low` | `pos.ground_half_flat` (bottom catches the leg) 0.60 / `pos.ground_side` 0.40 | cross-face, block the near hip/knee, slide the knee across | 3,000–8,000 | 0.45 | `bjj.top_control` vs `bjj.escape`, k 2.0 | STR+ | STK+ | knee-in, hip escape on the transition, catch half guard | [S: BJJ_POSITIONS §3.2 T1] |
| `tech.side_to_kob` | `pos.ground_side` | `pos.ground_side_kob` | `pos.ground_side`; counter: bottom turns in → `pos.ground_turtle` 0.20 of fails | hip switch, posted foot | 1,000–3,000 | 0.70 | `bjj.top_control` vs `bjj.escape`, k 2.0 | — | — | follow the hip, turn in | [S: BJJ_POSITIONS §3.2 T2] |
| `tech.kob_to_mount_back` | `pos.ground_side_kob` | `pos.ground_mount_low` 0.60 / `pos.ground_back_seatbelt` (bottom turns) 0.40 | `pos.ground_half_flat` 0.5 / `pos.scramble` (bottom explodes to knees) 0.5 | pressure + timing | 2,000–5,000 | 0.50 | `bjj.top_control` vs `bjj.escape`, k 2.0 | — | STK+ | push-and-shrimp, turn to knees | [S: BJJ_POSITIONS §3.2 T3] |
| `tech.side_to_north_south` | `pos.ground_side` | `pos.ground_north_south` | `pos.ground_side`; counter: bottom turns to knees (`pos.ground_turtle`) 0.25 of fails | switch the hips over the head | 2,000–4,000 | 0.70 | `bjj.top_control` vs `bjj.escape`, k 2.0 | — | — | follow, hip escape | [S: BJJ_POSITIONS §3.2 T4] |
| `tech.mount_climb` | `pos.ground_mount_low` | `pos.ground_mount_high` 0.70 / `pos.ground_mount_s` 0.30 | `pos.ground_mount_low`; counter: elbow-knee escape during the climb → bottom `pos.ground_half_flat` 0.30 of fails | walk the knees up with head/arm control, hips heavy | 3,000–8,000 | 0.50 | `bjj.top_control` vs `bjj.escape`, k 3.0 | STR+ | STK+ (the bottom's arms come up to cover → the knees slide in) | elbows tight, hip escape, upa when the top climbs | [S: BJJ_POSITIONS §3.2 T5] |
| `tech.mount_to_tech_mount` | `pos.ground_mount_low`, `pos.ground_mount_high` when the bottom turns to the side | `pos.ground_mount_tech` | — | bottom-initiated (E4 turn) | 1,000–2,000 | 0.90 (bottom chooses) | — | — | — | — | [S: BJJ_POSITIONS §3.2 T6] |
| `tech.tech_mount_to_back` | `pos.ground_mount_tech` | `pos.ground_back_hooks` 0.60 / `pos.ground_back_one_hook` 0.40 | `pos.ground_mount_tech`; counter: bottom re-guards to `pos.ground_half_flat` (bottom) 0.25 of fails / stands to `pos.scramble` 0.10 | seatbelt / chest-to-back, insert the hook as the bottom turns | 2,000–5,000 | 0.65 | `bjj.back_control` vs `bjj.escape`, k 3.0 | — | STK+; +0.3 logit if the bottom chose E4 (gave the back) | turn *back* into mount, hip escape to guard, stand | [S: BJJ_POSITIONS §3.2 T7, §8 r25] |
| `tech.crucifix_entry` | `pos.ground_side` (bottom on side), `pos.ground_turtle` | `pos.ground_crucifix` | `pos.ground_turtle` / `pos.ground_side` | trap the near arm with the legs, control the far wrist | 3,000–8,000 | 0.25 (T3+) | `bjj.top_control` vs `bjj.escape`, k 3.5 | — | — | keep the elbows glued, roll through | [S: BJJ_POSITIONS §3.2 T8] |
| `tech.turtle_to_back` | `pos.ground_turtle`, `pos.ground_referee`, `pos.ground_front_headlock` | `pos.ground_back_hooks` 0.55 / `pos.ground_back_one_hook` 0.30 / `pos.ground_back_seatbelt` 0.15 | `pos.ground_turtle`; counter: sit-out/granby (0.30 of fails) → `pos.scramble` or bottom on top; wall-walk stand (0.25 vs cage) | seatbelt, chest on back, spiral ride, near hook first | 3,000–8,000 | 0.45 (+0.3 logit within 3 s of the opponent entering turtle [S: BJJ_POSITIONS §8 r13]) | `bjj.back_control` ∥ `wr.ride` vs `wr.get_up` ∥ `bjj.escape`, k 3.0 | STR+ | STK+ (punches make the bottom cover → hooks go in), CAGE±0.35 by UHO | hand-fight the seatbelt, sit-out, stand, turtle roll to guard | [S: BJJ_POSITIONS §3.2 T9] |
| `tech.ride_tight_waist` | `pos.ground_turtle`, `pos.ground_referee` | stays with control clock; per 5 s: hook-in → `pos.ground_back_hooks` 0.35 (+0.42 `[D: +10 pp]` folkstyle) / retain 0.40 / bottom stands or escapes 0.25 (−0.42 vs a folkstyle top) | bottom stands → `pos.standing_close` or `pos.scramble` | tight waist + far ankle/wrist | 5,000 per roll | retains 0.70 per 5 s | `wr.ride` vs `wr.get_up`, k 2.1 | STR+ | folkstyle +0.42 | technical stand-up, sit-out, granby, switch | [S: WRESTLING §3.8, §9 r18] |
| `tech.ride_leg_hook` | `pos.ground_turtle` (one hook in) | `pos.ground_back_hooks` 0.45 per 5 s | bottom turns in → `pos.ground_open_kneeling_top` (former top on the bottom) 0.25 / `pos.scramble` 0.75 | one hook, chest on back | 5,000 | retains 0.75 per 5 s | `wr.ride` vs `wr.get_up`, k 2.1 | FLX+ | — | turn in, clear the hook, stand with the cage | [S: WRESTLING §3.8] |
| `tech.back_body_triangle` | `pos.ground_back_hooks` | `pos.ground_back_body_triangle` | stays | hooks in, bottom not too wide (MASS: bottom > 15 kg heavier −0.5 [E]) | 5,000 | 0.60 (T3+) | `bjj.back_control` vs `bjj.escape`, k 2.0 | FLX+ | — | hand-fight, hips down | [S: BJJ_POSITIONS §8 r12] |
| `tech.back_one_hook_upgrade` | `pos.ground_back_one_hook` | `pos.ground_back_hooks` 0.50 per 5 s | bottom escapes 0.35 per 5 s (`tech.escape_back`) | second hook | 5,000 | 0.50 | `bjj.back_control` vs `bjj.escape`, k 3.0 | — | — | clear the hook, hips down | [S: BJJ_POSITIONS §8 r12] |
| `tech.gnp_posture` | any top node in mount/side/half/guard | `posture = 'postured'` (unlocks §5 striking; grants POST to the bottom) | — | free hand, base | 500–1,000 | 0.95 | — | — | — | — | [S: BJJ_POSITIONS §3.2 T12] |
| `tech.gnp_settle` | any postured top node | `posture = 'chest'` | — | — | 500 | 0.95 [E] | — | — | — | — | [E] |
| `tech.disengage_stand` | any guard top (`pos.ground_open_*`, `pos.ground_closed_*`, `pos.ground_half_knee_shield`) | `pos.ground_open_legs_up` (top standing) → `pos.standing_mid` if the top walks away | bottom holds a leg → `pos.ground_ashi_slx` / single-leg wrestle-up 0.05 | choice | 1,000–2,000 | 0.95 | — | — | — | costs judges' "control" (§06) | [S: BJJ_POSITIONS §3.2 R1] |
| `tech.knockdown_follow` | `pos.ground_knockdown` (attacker) | `pos.ground_open_legs_up` 0.45 / `pos.ground_side` 0.25 / `pos.ground_mount_low` 0.20 / `pos.ground_back_seatbelt` (bottom turtled) 0.10 | bottom recovers guard/stands → `pos.ground_open_legs_up` / `pos.standing_close` | attacker chooses to follow within 1,500 ms | 500–1,500 | 0.70 [E] (T4 downed fighter recovers to a guard/feet 30 % of the time) | `mma.gnp` vs `bjj.retention` ∥ `wr.get_up`, k 2.5 | EXP+ | RCK (+0.8 vs a rocked fighter; bottom `state.rocked` also halves its get-up P) | referee stoppage (§06), up-kick, guard recovery | [E]; knockdown→finish conversion 65 % at UFC level [S: FIGHT_DATA §5] is the calibration target |

#### H. Sweeps and bottom-initiated reversals

| id | from | → success | → fail / counter | requirements | dur ms | base | k_skill | phys | state | counters | src |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tech.sweep_hip_bump` | `pos.ground_closed_posture_up` (top hands low or posting) | `pos.ground_mount_low` (sweeper on top) | `pos.ground_closed_posture_up` (top re-bases); chains to `sub.kimura`/`sub.guillotine_high_elbow` | sit up on one elbow, hip through, trap the posting arm | 2,000–4,000 | 0.25 (gi lower-belt sit-up sweep 38 %; lower in MMA because the top posts and punches) | `bjj.sweep` vs `bjj.top_control`, k 2.0 | STR+, MASS+ | FATd+, POST (+0.4; +0.63 `[D: +15 pp]` when the top posts a hand to punch), STK− | base out, posture, punch on the sit-up | [S: BJJ_POSITIONS §3.2 S1, §4] |
| `tech.sweep_scissor` | `pos.ground_closed_posture_broken` (after opening), `pos.ground_open_kneeling_top` | `pos.ground_mount_low` (sweeper top) | `pos.ground_open_kneeling_top` 0.85 / top passes to `pos.ground_side` 0.15 of fails | knee across the chest, wrist + head control, chop | 2,000–4,000 | 0.20 in MMA (gi lower belts 55 %) | `bjj.sweep` vs `bjj.top_control`, k 2.0 | — | WET (`−−`: −0.3), STK− | post, knee in the middle, posture | [S: BJJ_POSITIONS §3.2 S2] |
| `tech.sweep_flower` (pendulum) | `pos.ground_closed_posture_broken`, `pos.ground_closed_high` | `pos.ground_mount_low` (sweeper top) | `pos.ground_closed_posture_broken`; chains to `sub.armbar` | underhook the leg, pendulum, control the arm | 2,000–4,000 | 0.20 | `bjj.sweep` vs `bjj.top_control`, k 2.0 | — | WET | base wide, posture, pull the arm free | [S: BJJ_POSITIONS §3.2 S3] |
| `tech.arm_drag_back_take_bottom` | `pos.ground_closed_posture_broken`, `pos.ground_open_butterfly`, `pos.ground_open_seated` | `pos.ground_back_hooks` 0.40 / `pos.ground_back_seatbelt` 0.40 / `pos.ground_side` (sweeper top) 0.20 | same guard; counter: top re-faces and may pass 0.20 of fails | 2-on-1 on the wrist/tricep, drag across, hip out | 2,000–4,000 | 0.20 (gi lower-belt back take 60 %; ADCC 2022: only 17 % of back takes came from guard) | `bjj.sweep` ∥ `wr.pummel` vs `bjj.top_control`, k 3.0 | — | WET | posture, elbow tight, re-square | [S: BJJ_POSITIONS §3.2 S4] |
| `tech.sweep_butterfly_hook` | `pos.ground_open_butterfly`, `pos.ground_half_butterfly` | `pos.ground_mount_low` 0.50 / `pos.ground_side` 0.30 / `pos.ground_half_flat` 0.20 (sweeper top) | `pos.ground_half_flat` (bottom, top smashes) 0.7 / `pos.scramble` 0.3; counter: top's body-lock pass 0.25 of fails, `sub.guillotine_high_elbow`/`sub.darce` on head-down entries 0.05 | underhook + overhook/wrist, chest-to-chest, elevate with the hook | 2,000–4,000 | 0.35 (most common scoring sweep in ADCC women's divisions) | `bjj.sweep` vs `bjj.top_control`, k 3.0 | STR+, MASS+ | STK− | sprawl the leg, post, body lock, head pressure | [S: BJJ_POSITIONS §3.2 S5] |
| `tech.entry_x_slx` | `pos.ground_open_seated`, `pos.ground_open_butterfly`, `pos.ground_open_legs_up` (top standing close) | `pos.ground_open_x` 0.5 / `pos.ground_ashi_slx` 0.5 | same seated guard; top backs off 0.3 of fails → `pos.ground_open_legs_up` | shin-to-shin / hook behind the knee | 1,500–3,000 | 0.30 | `bjj.leg_entangle` vs `bjj.retention`, k 3.0 | FLX+ | WET, STK− (head exposed) | knee down, posture, punch down | [S: BJJ_POSITIONS §3.2 S6] (entry 30 %) |
| `tech.sweep_x_slx` (tripod / technical-stand sweep) | `pos.ground_open_x`, `pos.ground_ashi_slx` | standing over a downed opponent (`pos.ground_open_legs_up` reversed) 0.60 / `pos.ground_side` (sweeper top) 0.20 / `pos.scramble` 0.20 | top steps out → `pos.ground_open_legs_up` 0.70 / top passes with a leg drag 0.30 of fails | hooks behind the knee, off-balance | 2,000–5,000 | 0.45 once established (gi lower belts 63 %) | `bjj.sweep` ∥ `bjj.leg_entangle` vs `bjj.top_control`, k 3.0 | — | WET, STK− | free the trapped leg (knee down), posture, punch down | [S: BJJ_POSITIONS §3.2 S6] |
| `tech.k_guard_entry` | `pos.ground_open_k` | `pos.ground_ashi_slx` / `pos.ground_5050` / `pos.ground_saddle` (leg-lock nodes) 0.7 / `pos.ground_back_hooks` (matrix) 0.3 | top body-locks (→ `tech.pass_body_lock`) or punches; 0.40 of fails end in `pos.ground_half_flat` (bottom) | knee across the hip, grip behind the knee, invert | 2,000–5,000 | 0.30 (T3+ only) | `bjj.leg_entangle` vs `bjj.retention` ∥ `mma.gnp`, k 3.5 | FLX+ | STK− (`−−`: −0.4 per strike, head exposed), RULE heelHooks | body lock, sprawl, punch the exposed head | [S: BJJ_POSITIONS §3.2 S7] |
| `tech.sweep_deep_half` (waiter / Homer Simpson / come-up behind) | `pos.ground_half_deep` | `pos.ground_half_flat` (sweeper top) 0.40 / `pos.ground_side` 0.30 / `pos.ground_back_hooks` 0.30 | `pos.ground_half_deep` (retry) 0.8 / top smashes to `pos.ground_side` 0.2 of fails; counter: top's `sub.kimura`/`sub.darce` 0.05 | under the hips, hug the leg, off-balance | 3,000–6,000 | 0.40 | `bjj.sweep` vs `bjj.top_control`, k 3.0 | STR+ | STK− (top elbows the crown; 12-6 flag) | cross-face, sit back on the hips, kimura | [S: BJJ_POSITIONS §3.2 S8] |
| `tech.dogfight_entry` | `pos.ground_half_underhook` | `pos.ground_half_dogfight` | `pos.ground_half_flat` (bottom; cross-face re-established) | underhook, get to the knees, head outside | 2,000–4,000 | 0.45 | `bjj.sweep` ∥ `wr.get_up` vs `bjj.top_control`, k 3.0 | STR++ | FAT−, CAGE+0.35 (wall helps stand) | whizzer, cross-face | [S: BJJ_POSITIONS §3.2 S9] |
| `tech.dogfight_resolve` | `pos.ground_half_dogfight` | underhook side wins 0.55: `pos.ground_back_hooks` 0.35 / single-leg to top (`pos.ground_side` or standing) 0.40 / roll-under to `pos.ground_side` (top) 0.25 | whizzer side wins 0.45: `pos.ground_side`/`pos.ground_side_kesa` (hip switch) 0.75 / `sub.guillotine_high_elbow`/`sub.darce` entry 0.25 | drive vs whizzer + hip switch | 2,000–6,000 | 0.55 for the underhook holder | `wr.scramble` ∥ `bjj.sweep` vs `wr.sprawl` ∥ `bjj.top_control`, k 3.0 | STR++ | FAT−, CAGE+0.35 for the underhook holder | limp-arm, hip switch | [S: BJJ_POSITIONS §3.2 S9] |
| `tech.lockdown_whip_up` (whip-up / electric chair / old-school) | `pos.ground_half_lockdown` | `pos.ground_half_dogfight` (whip-up) 0.45 / `pos.ground_half_flat` (sweeper top, old school) 0.30 / `sub.electric_chair` 0.25 (§04) | `pos.ground_half_flat` (bottom, top frees the leg) 0.90 / top passes to `pos.ground_side` 0.10 | lockdown established, underhook or double underhooks | 4,000–10,000 | 0.30 | `bjj.sweep` vs `bjj.top_control`, k 3.0 | STR+ | STK− (top elbows while stuck) | free the leg by hip-switching, posture, elbows | [S: BJJ_POSITIONS §3.2 S10] |
| `tech.knee_shield_wrestle_up` | `pos.ground_half_knee_shield` | standing single-leg (`pos.td_single_leg_in`, former bottom attacking) 0.50 / `pos.scramble` 0.30 / `pos.ground_side` (top) 0.20 | `pos.ground_half_flat` (bottom, shield collapsed) 0.50 / `pos.ground_turtle` (top snaps down) 0.25 / stays 0.25 | frame + knee shield to make space, post a hand, come up on the leg | 3,000–8,000 | 0.40 | `wr.get_up` ∥ `bjj.sweep` vs `bjj.top_control` ∥ `wr.sprawl`, k 3.0 | STR+ | CAGE+0.70 (`++`, wall-walk fusion), FATd+ | snap-down to front headlock, cross-face, knee-cut through the shield | [S: BJJ_POSITIONS §3.2 S11] |
| `tech.rubber_guard_sweep` (omoplata sweep) | `pos.ground_closed_rubber` | `pos.ground_side` (sweeper top) 0.6 / `pos.ground_mount_low` 0.4 | `pos.ground_closed_posture_broken` | flexibility, mission control established | 3,000–8,000 | 0.20 | `bjj.sweep` vs `bjj.top_control`, k 3.0 | FLX++ (0.20/10) | — | posture, stack, punch over the top | [S: BJJ_POSITIONS §3.2 S12] |
| `tech.upkick_push_stand` | `pos.ground_open_legs_up` (bottom) | standing (`pos.standing_mid`) via technical stand-up | same; counter: top dives with punches → `pos.ground_open_kneeling_top`/`pos.ground_hq` 0.30 of fails | feet on hips, push and hip-escape, post a hand | 2,000–5,000 | 0.55 (BJJGraph community model 75/15/10; lowered for MMA) | `wr.get_up` ∥ `bjj.retention` vs `mma.gnp`, k 2.0 | — | FAT−, STK± ; up-kick lands 0.15–0.25 with KO < 2 % [S: MMA_INTEGRATION I-17] | top backs off (referee may stand anyway), top dives (risks the up-kick) | [S: BJJ_POSITIONS §3.2 S13] |
| `tech.bridge_roll_kesa_side` | `pos.ground_side_kesa`, `pos.ground_side` | `pos.ground_side` (reversal, sweeper top) | same | leg hook on the top's trapped leg, bridge over the shoulder | 2,000–4,000 | 0.15 | `bjj.escape` vs `bjj.top_control`, k 2.0 | STR++, MASS++ | POST (+0.42 `[D: +10 pp]` when the top lifts to strike) | base wide, free the leg | [S: BJJ_POSITIONS §3.2 S14, §4] |
| `tech.sweep_on_strike` (wrapper) | any bottom node while the top posts/overcommits on a strike | as the underlying sweep with POST and a +0.63 window | as underlying | top `posture = 'postured'` and a strike in flight | as underlying | underlying + POST; ×2 vs a top with fatigue > 0.6 `[S: MMA_INTEGRATION I-18]` | as underlying | — | POST | keep the elbows in, base | [S: MMA_INTEGRATION §2.3 I-18] (20–30 %) |

#### I. Escapes (bottom-initiated, not to standing)

| id | from | → success | → fail / counter | requirements | dur ms | base | k_skill | phys | state | counters | src |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tech.escape_mount_elbow_knee` | `pos.ground_mount_low` (any posture) | `pos.ground_half_flat` (bottom) 0.70 / `pos.ground_half_knee_shield` 0.20 / `pos.ground_closed_posture_up` (bottom) 0.10 | `pos.ground_mount_low` (top re-mounts) 0.70 / `pos.ground_mount_high` (top climbs) 0.30 of fails | elbows inside, bridge to make space, shrimp, insert the knee | 3,000–8,000 | 0.30 (0.12 from `pos.ground_mount_high` / `pos.ground_mount_s`) | `bjj.escape` vs `bjj.top_control`, k 3.0 | STR+, MASS− (top's mass: −0.16/10 kg) | FAT−−, STK− (covering hands → no frames), POST (+0.42 `[D: +10 pp]`) | grapevines, high mount, cross-face, punch when the elbow drops | [S: BJJ_POSITIONS §3.2 E1, §4] |
| `tech.escape_mount_upa` | `pos.ground_mount_low`, `pos.ground_mount_high` (top's arm posted) | `pos.ground_closed_posture_up` (escaper on top) | `pos.ground_mount_low`/`pos.ground_mount_high` (top posts and climbs) 0.40 of fails; counter: `sub.armbar` on the trapped arm when the bottom pushes 0.05 | trap one arm and the same-side foot, bridge diagonally | 2,000–4,000 | 0.20 (0.35 when the top has just posted to punch) | `bjj.escape` vs `bjj.top_control`, k 2.0 | STR++, MASS++ | POST (+0.85 `[D: +20 pp]` when the top is postured in low mount, +0.63 in high mount) | post the free hand wide, spread the knees | [S: BJJ_POSITIONS §3.2 E2, §4] |
| `tech.escape_mount_kip` | `pos.ground_mount_high`, `pos.ground_mount_s` | `pos.ground_half_flat` (bottom) 0.6 / `pos.scramble` 0.4 | `pos.ground_mount_high` | explosive hip lift + turn, arms not trapped | 1,000–3,000 | 0.15 (T4+ 0.25) | `bjj.escape` vs `bjj.top_control`, k 3.5 | STR+, EXP+ | FAT−− | head/arm control, ride the hips | [S: BJJ_POSITIONS §3.2 E3] |
| `tech.escape_mount_turn_belly` (give the back) | `pos.ground_mount_high`, any postured mount | intent `pos.ground_turtle`; actual: `pos.ground_mount_tech` / `pos.ground_back_hooks` for the top 0.70, `pos.ground_turtle` 0.30 | — | none (damage-avoidance behaviour) | 1,000–2,000 | 0.90 to turn | — | — | grants the top `tech.tech_mount_to_back` +0.3 | top follows to technical mount/back | [S: BJJ_POSITIONS §3.2 E4, §8 r25] |
| `tech.escape_side_frames_shrimp` | `pos.ground_side` (incl. wall) | `pos.ground_half_flat` (bottom) 0.50 / `pos.ground_half_knee_shield` 0.30 / `pos.ground_closed_posture_up` (bottom) 0.20 | `pos.ground_side`; counter: top takes mount/KOB during the bridge 0.15 of fails, `sub.darce`/`sub.arm_triangle` on the frame 0.05 | forearm in the neck, hand on the hip, bridge, shrimp | 3,000–8,000 | 0.30 | `bjj.escape` vs `bjj.top_control`, k 3.0 | STR+ | FAT−−, CAGE−0.35 (the wall stops the shrimp), STK−, POST (+0.42 when the top lifts to strike) | cross-face, hip block, switch to KOB/N-S, knee-cut mount | [S: BJJ_POSITIONS §3.2 E5, §4] |
| `tech.escape_side_underhook_turn` | `pos.ground_side`, `pos.ground_side_kesa`, `pos.ground_north_south` | `pos.ground_turtle` (bottom) 0.50 / `pos.ground_half_dogfight`-like wrestling 0.30 / standing via `tech.wall_walk` 0.20 | `pos.ground_side`; counter: `sub.guillotine_high_elbow`/`sub.anaconda`/`sub.darce` on the turn 0.10 of fails, back take 0.25 of fails | near-side underhook, bridge, turn to the knees | 2,000–5,000 | 0.30 | `bjj.escape` ∥ `wr.get_up` vs `bjj.top_control`, k 3.0 | STR+ | CAGE+0.70 (`++`, wall walk), STK+ (bottom turns to escape punches: the strikes *help* the turn but cost damage), POST +0.42 | front-headlock chokes, seatbelt/back take, flatten | [S: BJJ_POSITIONS §3.2 E6, §4] |
| `tech.escape_granby` | `pos.ground_side` (top light), `pos.ground_turtle`, `pos.ground_north_south` | `pos.ground_open_kneeling_top` (bottom re-guards) 0.5 / `pos.ground_half_knee_shield` 0.5; from turtle: `pos.ground_open_kneeling_top` facing the top 0.50 / `pos.standing_close` 0.25 / `pos.scramble` 0.25 | same node 0.8 / top takes the back 0.2 of fails (0.10 from turtle) | shoulder roll along the mat; needs space | 1,000–3,000 | 0.15 (T4+ 0.30) | `bjj.escape` ∥ `wr.scramble` vs `bjj.top_control`, k 3.5 | FLX+, MASS−− (top's mass −0.32/10 kg) | — | weight on the hips/shoulders, crucifix if the arm is exposed | [S: BJJ_POSITIONS §3.2 E7] [S: WRESTLING §3.9] |
| `tech.escape_kob` | `pos.ground_side_kob` | `pos.ground_half_flat` (bottom) 0.60 / `pos.ground_open_kneeling_top` (bottom) 0.40 | `pos.ground_side_kob` 0.6 / `pos.ground_mount_low` 0.4; counter: `sub.armbar` on the pushing arm 0.10 of fails | push the knee, shrimp, turn in | 2,000–4,000 | 0.40 | `bjj.escape` vs `bjj.top_control`, k 2.0 | STR+ | STK− (top punches from KOB), POST (+0.63 `[D: +15 pp]` when the top winds up) | follow the hips, punch, switch sides | [S: BJJ_POSITIONS §3.2 E8, §4] |
| `tech.escape_north_south` | `pos.ground_north_south` | `pos.ground_turtle` (bottom) 0.50 / `pos.ground_half_flat` or `pos.ground_open_kneeling_top` (bottom) 0.50 | `pos.ground_north_south`; counter: `sub.north_south_choke`/`sub.kimura` 0.10 of fails | hands on the hips, hip escape, roll to the knees | 3,000–6,000 | 0.25 | `bjj.escape` vs `bjj.top_control`, k 3.0 | STR+ | FAT−, POST +0.21 `[D: +5 pp]` | weight on the chest, arm control, knees to the body | [S: BJJ_POSITIONS §3.2 E9, §4] |
| `tech.escape_back_hand_fight` (prerequisite roll) | `pos.ground_back_hooks`, `pos.ground_back_one_hook`, `pos.ground_back_body_triangle` | `handFightWon = true` for 5 s (enables `tech.escape_back`) | lost; losing 3× in a row gives §04 an `sub.rnc` attempt at +0.3 logit | 2-on-1 on the choking hand, chin tucked | 3,000 | 0.50 | `bjj.escape` vs `bjj.back_control`, k 3.0 | STR+ | FAT−, WET+ (+0.15: slippery helps the bottom), STK+ for the bottom when the top strikes (free hand: +0.42 `[D: +10 pp]`) | straitjacket (trap the far wrist with the leg), seatbelt switch | [S: BJJ_POSITIONS §8 r24, §4] |
| `tech.escape_back` (to the choking-arm side → guard) | `pos.ground_back_hooks` (hand fight won), `pos.ground_back_one_hook` | `pos.ground_half_flat` (bottom) 0.40 / `pos.ground_closed_posture_up` (bottom) 0.20 / `pos.ground_side` (bottom; "escaped but still under") 0.40 | `pos.ground_back_hooks` (retry) 0.80 / `pos.ground_back_body_triangle` (top upgrades) 0.20 of fails; counter: `sub.rnc` secured 0.15 of fails vs T4+ top | shoulders to the mat on the choking-arm side, clear the top hook | 5,000–15,000 per attempt | 0.15 from hooks / 0.35 from one hook (anchored to elite back-take → sub attempt 0.45, Lamas 2024) | `bjj.escape` vs `bjj.back_control`, k 3.5 | MASS− (top's mass −0.16/10 kg) | FAT−−, WET+, STK− (punches to the side of the head) | straitjacket, body triangle, "chair sit" | [S: BJJ_POSITIONS §3.2 E10] |
| `tech.escape_back_body_triangle` | `pos.ground_back_body_triangle` | `pos.ground_back_hooks` (lite) 0.4 / `pos.ground_half_flat` (bottom) 0.3 / `pos.ground_side` (bottom) 0.3 | stays | attack the locked ankle (knee pressure on the foot), turn toward the lock, slide down | 10,000–25,000 | 0.10 per attempt | `bjj.escape` vs `bjj.back_control`, k 3.5 | FLX− for the top (−0.10/10 of the top's flexibility [E]) | FAT−− | re-lock, switch sides, punch | [S: BJJ_POSITIONS §3.2 E11] |
| `tech.escape_crucifix` | `pos.ground_crucifix` | `pos.ground_turtle` (bottom) 0.5 / `pos.ground_side` (bottom) 0.5 | same; counter: choke/armbar (§04) 0.15 of fails | pull the trapped arm out by turning the thumb, roll | 5,000–15,000 | 0.15 | `bjj.escape` vs `bjj.top_control`, k 3.0 | STR+ | — | keep the leg lock on the arm, strike | [S: BJJ_POSITIONS §3.2 E13] |
| `tech.escape_kesa` | `pos.ground_side_kesa` | `pos.ground_half_flat` (bottom) 0.50 / reversal via `tech.bridge_roll_kesa_side` 0.20 / `pos.ground_turtle` (bottom) 0.30 | `pos.ground_side_kesa` 0.7 / `pos.ground_mount_low` (top switches) 0.3 | trap the near leg or frame under the jaw | 3,000–8,000 | 0.25 | `bjj.escape` vs `bjj.top_control`, k 2.0 | STR++, MASS++ | — | hips low, control the arm, switch to mount | [S: BJJ_POSITIONS §3.2 E16] |
| `tech.escape_half_recover` (half flat → knee shield / underhook) | `pos.ground_half_flat` (bottom) | `pos.ground_half_knee_shield` 0.55 / `pos.ground_half_underhook` 0.45 | `pos.ground_half_flat`; counter: top passes during the movement 0.15 of fails | frame the cross-face, shrimp, insert the knee or swim the underhook | 3,000–8,000 | 0.30 (E-recovery) | `bjj.retention` vs `bjj.top_control`, k 3.0 | STR+ | FAT−, STK−, POST +0.42 | cross-face, shoulder pressure, whizzer | [S: BJJ_POSITIONS §5.2] (E-recovery 30 %) |
| `tech.guard_retention` (implicit on every failed pass) | any P-edge failure | `pos.ground_half_knee_shield` / `pos.ground_open_kneeling_top` per the pass's fail cell | — | hip mobility, frames | 1,000–3,000 | inherent in pass failure rates; retention loses −0.1 logit per 5 % of the ground-damage pool (§05) | `bjj.retention` | — | STK− | — | [S: BJJ_POSITIONS §3.2 E15, §8 r23] |
| `tech.turtle_sit_out_peek` | `pos.ground_turtle` (incl. wall), `pos.ground_front_headlock` (bottom), `pos.ground_referee` | standing 0.35 / `pos.scramble` 0.30 / `pos.ground_half_knee_shield` (bottom re-guards) 0.20 / sit-out to top (`pos.ground_side` or `pos.ground_front_headlock` reversed) 0.15 | `pos.ground_turtle`; counter: back take with hooks 0.30 of fails, front-headlock choke entry 0.10 | hand-fight the seatbelt, head up, hip heist / sit-out | 2,000–5,000 | 0.35 (0.45 vs cage with wall walk) | `wr.scramble` ∥ `wr.get_up` vs `wr.ride`, k 3.0 | STR+ | CAGE+0.70 (`++`), FAT−−, POST +0.42 (when the top strikes instead of riding) | spiral ride, hooks, chin strap | [S: BJJ_POSITIONS §3.2 E14, §4] [S: WRESTLING §3.9] |
| `tech.turtle_switch` | `pos.ground_turtle`, `pos.ground_referee` (bottom) | `pos.ground_turtle` reversed (former bottom on top) | stays | top's arm around the waist | 700 | 0.20 (0.40 vs T0–T1) | `wr.scramble` vs `wr.ride`, k 2.1 (`++`: k 3.0) | — | — | hips away, drop the arm | [S: WRESTLING §3.9] |
| `tech.turtle_roll_to_guard` | `pos.ground_turtle` (top light, no hooks) | `pos.ground_open_kneeling_top` (bottom re-guards) | `pos.ground_turtle`; counter: back take 0.10 of fails | space, no hooks | 700 | 0.30 | `wr.scramble` ∥ `bjj.retention` vs `wr.ride`, k 3.0 | FLX+ | — | hooks in, chest pressure | [S: WRESTLING §3.9] (granby) |
| `tech.funk_roll` (Askren/Nickal roll-through) | `pos.td_single_leg_in` (defender view), `pos.scramble` | `pos.scramble` → `pos.ground_turtle` (top) / `pos.ground_back_hooks` with roles reversed | `pos.ground_open_kneeling_top` (funker on the bottom) | whizzer + attacker's head outside; funk trait | 1,000–2,000 | 0.25 (0.45 when `wr.scramble` ≥ 70) | `wr.scramble` vs `wr.finish`, k 3.0 | FLX+ | funk trait +10 to the scramble score (§L) | keep the head inside, finish fast, run the pipe | [S: WRESTLING §3.9] |

#### J. Get-ups (bottom → standing)

| id | from | → success | → fail / counter | requirements | dur ms | base | k_skill | phys | state | counters | src |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tech.technical_standup` | `pos.ground_open_legs_up`, `pos.ground_open_seated`, `pos.ground_open_butterfly` (opponent standing or backed off) | `pos.standing_mid` (§02) | `pos.ground_hq` (top re-engages) 0.40 / `pos.ground_open_legs_up` 0.40 / `pos.ground_front_headlock` or `pos.td_sprawl` (top snaps down) 0.20 of fails | post a hand, lead knee up, hip lift, retreat the leg | 1,500–3,000 | 0.55 vs an engaged opponent; 0.90 vs a disengaged one; open-mat from guard bottom nodes generally: 0.25 per attempt (0.45 vs a T0–T1 top) [S: WRESTLING §3.8] | `wr.get_up` vs `mma.gnp` ∥ `bjj.top_control`, k 2.0 | MASS (lighter bottom −0.21 `[D: −5 pp]` per WRESTLING) | FAT−, STK±, FATd+ (+0.42 × top fatigue `[D: WRESTLING §9 r17 +0.10 P]`); a failed attempt gives the top a free strike tick or a back-take roll 0.15 | re-engage with punches, snap-down, chase into the fence | [S: BJJ_POSITIONS §3.2 G1] [S: WRESTLING §3.8, §9 r17] |
| `tech.wrestle_up` | `pos.ground_open_butterfly`, `pos.ground_half_knee_shield`, `pos.ground_half_underhook`, `pos.ground_half_dogfight` | single-leg (`pos.td_single_leg_in`, former bottom attacking) 0.60 / `pos.standing_close` free 0.25 / `pos.ground_side` (reversal) 0.15 | `pos.ground_half_flat` (bottom) 0.50 / `pos.ground_turtle` 0.30 / `pos.ground_front_headlock` (bottom) 0.20 | underhook or wrist/head control, base on one knee, drive | 3,000–8,000 | 0.40 (T4+ 0.55) | `wr.get_up` vs `wr.sprawl` ∥ `bjj.top_control`, k 3.0 | STR++ | CAGE+0.35, FAT−− | sprawl, whizzer, snap-down, cross-face | [S: BJJ_POSITIONS §3.2 G3] |
| `tech.standup_from_closed_guard` | `pos.ground_closed_posture_up` (bottom) | `pos.ground_open_legs_up` → `tech.technical_standup` chain | `pos.ground_half_flat` (bottom; top passes during the opening) 0.40 of fails / stays | frames on the hips, open the guard, foot on the hip | 3,000–6,000 | 0.35 to reach the G1 chain (0.20 compound) | `wr.get_up` ∥ `bjj.retention` vs `bjj.top_control`, k 2.0 | — | STK−, FAT− | top drops weight, passes when the guard opens | [S: BJJ_POSITIONS §3.2 G4, §5.2] |
| `tech.stand_from_turtle` | `pos.ground_turtle` (open or wall), `pos.ground_referee` | standing (clinch or free); with the cage: `pos.standing_cage` with the top on `pos.clinch_body_lock_rear` 0.60 of successes | `pos.ground_turtle` / `pos.ground_back_*` | hand control on the seatbelt hands, head up, walk the feet in; with the cage an open hand on the fence, knee up | 2,000–5,000 | 0.35 (wall 0.45; WRESTLING turtle-with-cage 0.50 to reach the feet) | `wr.get_up` vs `wr.ride`, k 3.0 | STR+ | CAGE+0.70 | hooks, mat return, seatbelt | [S: BJJ_POSITIONS §3.2 G5] [S: WRESTLING §3.8] |
| `tech.stand_after_back_escape` | `pos.ground_back_one_hook`, `pos.ground_back_seatbelt` | standing with the rear body lock (`pos.clinch_body_lock_rear`) 0.6 / free 0.4 | `pos.ground_back_hooks` | clear the hook, base on the far foot | 3,000–6,000 | 0.35 | `wr.get_up` vs `bjj.back_control`, k 3.0 | STR+ | CAGE+0.70 | re-hook, body triangle | [S: BJJ_POSITIONS §3.2 G6] |
| `tech.kimura_grip_standup` | `pos.ground_half_flat` (bottom, cage), `pos.ground_closed_posture_up` (bottom, cage), `pos.ground_half_knee_shield` | `pos.ground_wall_walk` → `pos.standing_cage` 0.65 / `pos.ground_turtle` (former bottom on top, reversal) 0.15 / `sub.kimura` entry 0.20 (§04) | same node | kimura grip on the top's far arm | 2,000–3,000 | 0.35 | `bjj.sweep` ∥ `wr.get_up` vs `bjj.top_control`, k 3.0 | STR+ | CAGE+0.35 | hand posts, hide the arm, elbow tight | [S: WRESTLING §3.8] |
| `tech.hip_in_technical_standup_open` (MMA I-15) | `pos.ground_open_kneeling_top`, `pos.ground_half_*` (bottom), top posturing to strike | `pos.standing_close` | stays; the top punishes with GnP | frames set, top `posture = 'postured'` | 2,000–4,000 | 0.30 (25–40 %) | `wr.get_up` vs `mma.gnp`, k 2.5 | — | POST (required), FAT− | stay chest-to-chest, wrist control, GnP | [S: MMA_INTEGRATION §2.3 I-15] |

#### K. Post-takedown stabilisation (rolled once, 3 s after any landed takedown)

| landed via | stabilises top ≥ 10 s | immediate `pos.scramble` | bottom stands straight back up (wall) | src |
|---|---|---|---|---|
| double leg, open mat | 0.70 | 0.15 | 0.15 | [S: WRESTLING §8.4] |
| single leg (run the pipe) | 0.60 | 0.25 | 0.15 | [S: WRESTLING §8.4] |
| body lock / trip | 0.75 | 0.10 | 0.15 | [S: WRESTLING §8.4] |
| cage takedown (any) | 0.65 | 0.10 | 0.25 (immediate wall walk) | [S: WRESTLING §8.4] |
| snap-down / go-behind | 0.55 (turtle is unstable) | 0.30 | 0.15 | [S: WRESTLING §8.4] |
| low single / ankle pick | 0.50 | 0.35 | 0.15 | [S: WRESTLING §8.4] |
| judo throw landing in side/kesa | 0.75 [E] | 0.15 [E] | 0.10 [E] | [E] (mirrors body lock; throws land past the guard) |
| judo throw landing in guard / standing over | 0.55 [E] | 0.25 [E] | 0.20 [E] | [E] |

Tier shift: each tier of top advantage moves 0.10 of mass from the first column's complement into "stabilises"
(and vice versa) `[S: BJJ_POSITIONS §5.1]`; T0 tops lose position within 30 s 55 % of the time, T2 40 %, T3 25 %,
T4 15 % `[S: WRESTLING §7]`.

#### L. Scramble resolution, referee, round end

| id | from | → | rule | src |
|---|---|---|---|---|
| `tech.scramble_resolve` | `pos.scramble` | winner's node by the table below | Score per fighter `S = 0.5·wr.scramble + 0.2·bjj.escape + 0.15·speed + 0.15·flexibility − 30·fatigue + funk(+10)`; `P(A wins) = 1/(1 + 10^(−(S_A − S_B)/40))` (40 pts ≈ 90/10) ⇒ in logit form `0.0576 × ΔS` `[D: ln 10 / 40]`. The §I scramble techniques (sit-out, switch, granby, hip heist, funk) are sampled from the winner's repertoire to *label* the animation; they do not re-roll. Both fighters pay 2× grappling fatigue per second. Resolves in 1,000–2,000 ms (4,000 cap). | [S: WRESTLING §6] [S: BJJ_POSITIONS §8 r26] |
| scramble outcome (winner ends in) | — | open mat: `pos.ground_turtle` (top) 0.30 / `pos.ground_back_hooks` 0.15 / `pos.ground_side` or `pos.ground_half_flat` 0.25 / `pos.ground_open_kneeling_top` 0.15 / `pos.standing_close` (winner had the last upper-body control) 0.15. Against the cage: 0.25 / 0.20 / 0.20 / 0.10 / 0.25 (as `pos.clinch_cage_pin_*`) | — | [S: WRESTLING §6] |
| `ref.standup` | any ground node | `pos.standing_mid` (§06 restart) | inactivity timers in §6; the referee warns then stands; ≈ certain within 8 s of the threshold (20 %/s roll) | [S: BJJ_POSITIONS §8 r17] [S: RULES_JUDGING §3.3] |
| `ref.clinch_break` | any `pos.clinch_*` incl. cage pins | `pos.standing_mid` | §6 clinch-break timer; 0.50 per further 5 s after the threshold (referee variance parameter) | [S: WRESTLING §9 r24] [S: RULES_JUDGING §5] |
| `ref.round_end` | any | standing at the start of the next round; carries damage/stamina only; positional advantage is lost | UFC ground stints truncated by the bell ≈ 15 % of the time (calibration check) | [S: BJJ_POSITIONS §3.2 R3] |
| `ref.stoppage` | any GnP node | fight ends (§06) | stoppage requires ≥ 3 unanswered clean strikes before any roll (§5.4) | [S: BJJ_POSITIONS §8 r9] |

Edge count: A 17 · B 30 · C 24 · D 24 · E 12 · F 12 · G 17 · H 17 · I 20 · J 7 · L 6 = **186** edge rows (a few rows bundle mirror variants)
(plus the K stabilisation roll).

#### M. Trigger events emitted to §04 [REVIEW: added — §04 §1 lists these `evt.*` as inputs from this section but no edge named them]

| event id | emitted when | by edge / state |
|---|---|---|
| `evt.arm_crossed_centre` | the bottom fighter's arm crosses the centre line while framing under strikes | `tech.pass_with_gnp`, any postured GnP (§5.1) when the bottom covers (STK−) |
| `evt.hand_posted` | the top fighter posts a hand on the mat while `posture = 'postured'` | `tech.gnp_posture`, `tech.sweep_on_strike` window |
| `evt.back_taken` | arrival in `pos.ground_back_hooks` / `_body_triangle` / `_one_hook` / `_seatbelt` | `tech.turtle_to_back`, `tech.tech_mount_to_back`, `tech.rear_mat_return`, `tech.arm_drag_back_take_bottom`, scramble outcomes |
| `evt.sprawl_front_headlock` | arrival in `pos.td_sprawl` or `pos.clinch_front_headlock` / `pos.ground_front_headlock` after a shot | `def.sprawl`, `tech.sprawl_to_front_headlock`, `tech.snap_down` |
| `evt.step_over_guard` | the top fighter steps a leg over/through the bottom's guard during a pass | `tech.pass_knee_cut`, `tech.pass_hq`, `tech.pass_leg_drag` (attempt start) |
| `evt.turn_away` | the bottom fighter turns to the belly / gives the back | `tech.escape_mount_turn_belly`, `beh.bjj.turns_back` share of `tech.escape_side_underhook_turn`, `beh.gen.turn_away` on the ground |
| `evt.posture_broken` | top posture pulled down in closed guard | arrival in `pos.ground_closed_posture_broken` |
| `evt.underhook_from_bottom` | bottom wins the underhook in half guard | arrival in `pos.ground_half_underhook`, `tech.dogfight_entry` |
| `evt.head_down_standing` | a standing fighter's head drops below the opponent's chest (bent-over shot, snap-down, hurt) | `tech.snap_down` success, `beh.wr.no_level_change` shots, `state.rocked` + `tech.level_change` |

Each event carries `{ tick, subMs, fighter (the exposed fighter), node }` and is consumed by §04 §2.4.1 within its 3 s trigger window.

---

## 3. Chain grappling

A **chain** is a follow-up edge fired from the *failure* or *stall* state of a previous edge without returning
to neutral. The decision layer (§07) chooses whether to chain; this section supplies the probability that a
fighter of a given tier *chooses* to chain and the modifiers a chained edge carries.

### 3.1 Chain propensity by tier

```
P_chain(wrestling) = 0.15 + 0.008 × wr.chain         // wr.chain = wrestling.chains (§01); WRESTLING quotes WR_att — we use the dedicated chain sub-skill [E]
                                                      // T0 0.15, T1 0.31, T2 0.47, T3 0.63, T4 0.79, T5 0.91  [S: WRESTLING §9 r9]
halved when attacker fatigue > 0.7                    [S: WRESTLING §9 r4]
P_chain(judo renzoku) = T4–T5: 1.0 available ×1.3 P; T2–T3: ×1.1; T0–T1: unavailable   [S: JUDO §8 r10]
P_chain(bjj pass → pass) = +0.30 logit within 5 s of a failed pass, T4+; +0.15 T3; 0 below   [S: BJJ_POSITIONS §3.3, §8 r6]
```

Tier table `[D: from the formula, WR = tier band midpoint]`: | T0 0.15 | T1 0.31 | T2 0.47 | T3 0.63 | T4 0.79 | T5 0.91 |
(WRESTLING §7 quotes novice 15 %, competent 40 %, advanced 65 %, elite 80–90 %).

### 3.2 Modifiers on a chained edge

- Wrestling: own base with **−0.42 logit** for a second shot `[D: −10 pp]`, **+0.42** if the defender's hands
  are on the mat / posture bent `[S: WRESTLING §9 r9]`; each chain step costs 1.5× shot fatigue (§05).
- Judo: **×1.3 P** (kuzushi carried from the first attack) and the follow-up must fire within 500 ms
  `[S: JUDO §8 r10]`.
- BJJ: **+0.30 logit** (pass → pass, sweep → sub) `[S: BJJ_POSITIONS §8 r6]`; every chain step in a ground node
  pays 1.4× (top) / 1.6× (bottom) stamina `[S: BJJ_POSITIONS §8 r19]`.
- Elite retention: at T4+ each chain step keeps its full base (no −0.42) `[S: WRESTLING §7 "each chain step retains full base %"]`.

### 3.3 Allowed chains (edge → follow-ups, with per-step P at T4 vs T4)

| chain id | sequence | per-step P | cumulative | src |
|---|---|---|---|---|
| `chain.single_to_double` | `tech.single_leg` (defender hops/whizzers) → `tech.single_to_double` → `tech.double_drive_through` | 0.55 → 0.60 → 0.70 | 0.23 `[D]` | [S: WRESTLING §4 c1] |
| `chain.double_to_hc` | `tech.double_leg` (sprawl blocks one hand) → `tech.double_to_high_crotch` → `tech.hc_to_double` | 0.62 → 0.55 → 0.60 | 0.20 `[D]` | [S: WRESTLING §4 c2] |
| `chain.snap_fhl_gobehind` | `tech.snap_down` → front headlock established → `tech.front_headlock_go_behind` | 0.35 → 0.60 → 0.45 | 0.09–0.10 per attempt (≈ 0.30 vs a bent-over T0–T1) | [S: WRESTLING §4 c3] |
| `chain.sprawl_reshot` | shot sprawled → `tech.re_shot` (−0.42; +0.42 if hands dropped); defender's counter-chain `tech.sprawl_to_front_headlock` (0.60) → `tech.front_headlock_go_behind` (0.45) | — | defender chain 0.27 `[D]` | [S: WRESTLING §4 c4] |
| `chain.underhook_hc_cage_single_trip` | `tech.high_crotch` (from underhook) → `tech.hc_cage_drive_single` → `tech.single_trip`/`tech.single_dump` (cage) | 0.55 → 0.65 → 0.45 (+0.42) | ≈ 0.20 per pass through the chain; the dominant modern MMA chain and the reason cage rates exceed distance rates | [S: WRESTLING §4 c5] |
| `chain.bodylock_trips_lift` | `tech.inside_trip` (miss) → `tech.outside_trip` → `tech.body_lock_lift_return` | 0.50 → 0.48 → 0.55 | 1 − (0.5·0.52·0.45) = 0.88 that at least one lands `[D]` | [S: WRESTLING §4 c6] |
| `chain.rear_lock_return` | `tech.rear_mat_return` (miss) → knee-behind-knee → `tech.rear_mat_return` at 0.70 | 0.55 → 0.70 | 0.87 `[D]` | [S: WRESTLING §4 c7] |
| `chain.whizzer_battle` | vs `def.whizzer`: attacker chooses limp-arm re-pummel (0.40) / `tech.single_to_double` (0.40) / `tech.cage_drive` (0.60 vs open-mat circling); defender `tech.whizzer_throw` 0.15 | — | — | [S: WRESTLING §4 c8] |
| `chain.judo_renzoku` | `tech.kouchi_gari` → `tech.uchi_mata`; `tech.ouchi_gari` → `tech.uchi_mata`/`tech.harai_goshi`; `tech.ippon_seoi` → `tech.kouchi_gari`; `tech.uchi_mata` → `tech.ouchi_gari`/`tech.kouchi_gari` (ken-ken); `tech.tai_otoshi` → `tech.ouchi_gari`; `tech.sasae_tsurikomi_ashi` → `tech.harai_goshi`; `tech.de_ashi_harai` → `tech.osoto_gari` | second throw ×1.3 P | — | [S: JUDO §8 r10] |
| `chain.kimura_grip` | `sub.kimura` grip from half/closed guard bottom → `tech.kimura_grip_standup` (0.35) / sweep to `pos.ground_turtle` top (0.15 of successes) / back take (§04 return node) | 0.35 | — | [S: WRESTLING §3.8] |
| `chain.pass_to_pass` | any failed `tech.pass_*` → another `tech.pass_*` within 5 s (+0.30 logit T4+) | underlying + 0.30 | pass → pass transition 0.30 (Lamas 2024) | [S: BJJ_POSITIONS §3.3] |
| `chain.sweep_to_sub` | any landed sweep → §04 entry within 3 s (+0.30 logit) | — | — | [S: BJJ_POSITIONS §8 r6] |
| `chain.back_take_to_sub` | any arrival in `pos.ground_back_hooks` → immediate `sub.rnc` entry 0.45 | 0.45 | — | [S: BJJ_POSITIONS §1 (Lamas 2024)] |
| `chain.turtle_window` | any arrival in `pos.ground_turtle` → `tech.turtle_to_back` +0.30 for 3 s | — | — | [S: BJJ_POSITIONS §8 r13] |
| `chain.sprawl_brawl` | `def.sprawl` → free strike window 500 ms (§02) → reset to distance; each stuffed shot costs the shooter 2–3× the striker's stamina | — | — | [S: MMA_INTEGRATION I-20] |

Chain depth cap: 3 chained steps open mat, 6 on the cage (mirrors the finish-attempt cap) `[S: WRESTLING §9 r8]`.

---

## 4. Cage model

The fence is reachable when either fighter is within **1.0 m** `[S: WRESTLING §5.1] [S: BJJ_POSITIONS §5.3]`.
`cage = true` is set on the engagement when the *defender/bottom* is within that distance; takedowns landed
there start in `pos.ground_cage_seated` or a wall-adjacent `pos.ground_half_flat`. Default share of takedowns
landing at the fence: **0.55** `[S: WRESTLING §5 preamble]` (BJJ_POSITIONS §8 r16 uses 0.65; the engine derives it
from geometry and only uses these values as a calibration check). Cage-contact time target ≈ 21 % of fight time
`[S: FIGHT_DATA §2.2 (RM)]`. Distance shots are 5.7 % less successful in a 25-ft cage: `cageRadius` scales the
TELE term by `(radius_m / 9.1)^-1` `[E]` anchored on `[S: WRESTLING §8.1]`.

### 4.1 Effects of `cage = true` on edges (logit unless stated)

| effect | value | applies to | src |
|---|---|---|---|
| capture chance on double / single / HC | +0.42 to +0.63 (`[D: +10 to +15 pp]`) | `tech.double_leg`, `tech.single_leg`, `tech.high_crotch`, `tech.single_outside` | [S: WRESTLING §5.2, §9 r7] |
| run the pipe | −1.05 (`[D: −25 pp]`) | `tech.single_run_pipe` | [S: WRESTLING §5.2] |
| trips, knee-behind-knee returns, lifts | +0.42 | `tech.single_trip`, `tech.single_dump`, `tech.inside_trip`, `tech.outside_trip`, `tech.body_lock_lift_return`, `tech.rear_mat_return`, `tech.knee_tap_double`, `tech.ouchi_gari`, `tech.kouchi_gari` (×1.5 P) | [S: WRESTLING §5.2] [S: JUDO §8 r13] |
| forward hip throws | −0.36 (×0.7 P) | `tech.uchi_mata`, `tech.harai_goshi`, `tech.koshi_guruma`, `tech.o_goshi`, `tech.hane_goshi`, `tech.tai_otoshi`, seoi family | [S: JUDO §8 r13] |
| ura nage / te guruma / lifts | +0.22 (×1.25 P) | `tech.ura_nage`, `tech.te_guruma`, `tech.rear_lift_suplex` | [S: JUDO §8 r13] |
| defender's sprawl | −0.42 | `def.sprawl` | [S: WRESTLING §5.2] |
| uke's counter-throw launch | ×0.7 | judo failure-table counter branch | [S: JUDO §8 r13] |
| hip-in / posting defence | halves per-attempt drive/lift finish P; trips unaffected | `def.cage_hip_in`, `def.cage_post_single` | [S: WRESTLING §5.2] |
| time per finishing attempt | ×1.5 (a cage single lasts 10–40 s) | all `*_in` finish edges | [S: WRESTLING §5.2] |
| energy per second in `pos.clinch_cage_pin_*` | attacker 1.0×, pinned 1.3× | §05 | [S: WRESTLING §5.2] |
| cage-assisted passing / pinning | +0.35 (`+`) to +0.70 (`++`) | `tech.pass_knee_cut`, `tech.pass_over_under`, `tech.pass_smash_half`, `tech.pass_hq`, `tech.cage_assisted_pass`, `tech.side_to_mount` (wall side), `tech.rear_mat_return` | [S: BJJ_POSITIONS §3.3, §5.3] |
| wall-walk / stand-up family | +0.35 to +0.70 for the bottom | `tech.wall_walk`, `tech.escape_side_underhook_turn`, `tech.turtle_sit_out_peek`, `tech.stand_from_turtle`, `tech.knee_shield_wrestle_up`, `tech.wrestle_up`, `tech.wall_walk_back_escape` (requires the fence) | [S: BJJ_POSITIONS §3.3] |
| hip escapes toward the fence | −0.35 | `tech.escape_side_frames_shrimp` (bottom's head/shoulders on the fence) | [S: BJJ_POSITIONS §3.2 E5] |
| `underhookOwner` | ±0.35 on cage-adjacent get-up and pin edges (`UHO`) | `pos.ground_cage_seated`, `pos.ground_wall_walk`, `pos.ground_half_underhook` (cage), `pos.clinch_cage_pin_front` | [S: BJJ_POSITIONS §5.3 r4] |
| fence grab | foul (§06): 5 % of wall-walk attempts at T ≤ 1 → referee warning and −0.5 logit on that attempt; open-hand posting is legal | `tech.wall_walk`, `def.cage_hip_in` | [S: BJJ_POSITIONS §8 r16] [S: WRESTLING §8.3] |
| scramble outcomes | table in §2.3 L (more back takes, more `pos.clinch_cage_pin_*` resolutions) | `tech.scramble_resolve` | [S: WRESTLING §6] |
| break off the cage | 0.30 per 5 s vs competent pressure (+0.42 if the pinner's head is on the wrong side) | `tech.cage_break` | [S: WRESTLING §5.2] |

### 4.2 Wall-walk cycle (bottom against the fence)

```
[ground node, cage] ──tech.wall_walk stage 1 (3–6 s, 0.60)──▶ pos.ground_wall_walk
      ▲                                                          │
      │ 0.20 dragged back                                        ├─ 0.35 → pos.standing_cage (clean separation)
      │ (0.60 cage_seated / 0.30 turtle / 0.10 back_hooks on a   ├─ 0.45 → pos.clinch_cage_pin_front (attacker keeps a body lock / underhook)
      │  stage-1 failure)                                        └─ 0.20 → back to the ground node
      │
   top's answers each cycle: tech.cage_knee_pin (0.50), tech.cage_mat_return (0.70 with knee-behind-knee),
   knees to thigh/body (STK), twist body lock (kills the underhook → UHO flips to top on success, 0.40 [E])
```

Cumulative: with cycles every 5 s and `P(reach feet) = 0.60`, the bottom is on its feet (held or free) within
30 s with `1 − 0.4^6 = 0.996` at equal tier if the top does nothing, but each top answer re-rolls the UHO and
the drag-down branch; the calibration target is the WRESTLING §8.4 table: back up within 30 s **0.35** against
the cage (0.30 open mat), within 60 s 0.55, within 120 s 0.75, still down at the bell (TD at 3:00) 0.22
`[S: WRESTLING §8.4]`. In UFC ≈ 70 % of wall walks end in a fence clinch, not free space `[S: BJJ_POSITIONS §5.2]`,
which the 0.45 body-lock branch produces `[D: 0.45/(0.45+0.35) = 0.56 of successes held; plus drag-downs ≈ 0.7]`.

### 4.3 Hip-in defence and foot stomps / knees in the cage clinch

- **Hip-in** (`def.cage_hip_in`, `def.cage_post_single`): the pinned fighter keeps the back flat on the fence,
  hips forward, one underhook and a head post; it halves drive/lift finish rates and forces the pinner into
  trips, knee-taps and foot-stomp set-ups `[S: WRESTLING §5.2]`. Coaching's "three-layer stack" (head / inside arm /
  hips) is the animation reference `[S: WRESTLING §8.3]`.
- **Foot stomps** (`tech.foot_stomp`): no damage; +0.21 logit on the next trip within 2 s; count as work for the
  §6 timers `[S: WRESTLING §9 r23]`.
- **Knees to thigh/body** from `pos.clinch_cage_pin_front`: fatigue-class damage, low KO (§02/§05); each landed
  knee resets the clinch-break timer and adds `STK+` to the next trip/mat return `[S: WRESTLING §5.2]`.
- **Elbows over the top / knees** from the pinned side: legal, resets the timer, and each thrown strike opens
  the +0.21 duck-under / snap-down window for the pinner `[S: WRESTLING §5.4]`.

---

## 5. Ground-and-pound as part of the graph

GnP is not a separate mode: it is a property of the top slot's `posture` in a ground node. Damage per strike is
owned by §02/§05; this section fixes **rate**, **landing multiplier**, **damage multiplier**, the **openings** a
strike gives the bottom and the **judge credit**. Anchors: ground punches/elbows land 58.6 % (931 attempts)
`[S: BJJ_POSITIONS §4 (Roy & Murphy 2026)]`; sig-strike accuracy on the ground 72 % (head 67 %, body 94 %)
`[S: FIGHT_DATA §3 #16, #19]`; elite controllers throw 0.9–4.0 sig ground strikes per control-minute (league
median ≈ 2.0) `[S: BJJ_POSITIONS §4] [S: MMA_INTEGRATION I-16]`; 11 % of all sig strikes land on the ground
`[S: FIGHT_DATA §3 #81]`; ground KO/TKO share 28 % `[S: FIGHT_DATA §3 #82]`; ground finishing strikes are punches
≈ 83 %, elbows 14 %, knees 3 % `[S: FIGHT_DATA §3 #28]`; extra time in mount and side control raises TKO odds,
half guard and back do not (back raises submission odds) `[S: BJJ_POSITIONS §4]`.

### 5.1 Per-position striking table

**rate** = attempts/min when the top chooses to strike; **land** = P(lands clean) before §02 defence terms;
**dmg×** = multiplier vs the same fighter's standing power punch; **openings** = bonus to the listed bottom edges
while `posture = 'postured'` (in addition to the generic POST +0.4); **judge** = §06 credit per minute (0–3).
All `[S: BJJ_POSITIONS §4]` unless tagged.

| node (top) | posture options | rate /min | land | dmg× | strike types (legal under Unified) | openings for the bottom | sub risk to the top | judge |
|---|---|---|---|---|---|---|---|---|
| `pos.ground_mount_high` / `pos.ground_mount_s` | seated-high (elbows), postured (punches) | 25–40 | 0.65 | elbows 0.9, punches 0.8, hammerfists 0.6 | elbows (12-6 flag), punches, hammerfists | `tech.escape_mount_upa` +0.63 if the top posts a hand; `tech.escape_mount_elbow_knee` +0.42 on the climb; `tech.escape_mount_turn_belly` | `sub.armbar` vs a T0–T1 top who straight-arms the mat: 0.02 per 10 s; else ≈ 0 | 3 (10-8 territory after ~60 s sustained) |
| `pos.ground_mount_low` | seated (hips low), postured | 15–30 | 0.55 | 0.6 | punches, hammerfists to body/head, short elbows | `tech.escape_mount_upa` +0.85 when postured; `tech.escape_mount_elbow_knee` +0.42 | ≈ 0 | 2 |
| `pos.ground_mount_tech` | knee-up, chest on shoulder | 20–35 | 0.65 | 0.8 | punches/hammerfists to the exposed side of the head, elbows | bottom turns back into guard (`tech.tech_mount_to_back` counter branch) | ≈ 0 | 2.5 |
| `pos.ground_back_hooks` / `pos.ground_back_body_triangle` | belly-down: punches to the side of the head; supine: none | 10–25 | 0.60 | 0.5 (no hip rotation) | punches, hammerfists, short elbows to the side of the head; back of the head is a foul (§06) | `tech.escape_back_hand_fight` +0.42 (a free hand) | ≈ 0 | 2.5 (3 if the bottom is flat and absorbing) |
| `pos.ground_crucifix` | fixed | 30–50 | 0.85 (unanswered) | 0.8 | elbows, punches | none | ≈ 0 | 3 (TKO ≈ 0.35 per 30 s vs any tier [E]) |
| `pos.ground_side` | cross-face elbows, KOB punches, knees to the body | 12–25 | 0.55 | elbows 0.6, body knees 0.5 | short elbows, knees to the body (head illegal), punches after `tech.side_to_kob` | `tech.escape_side_frames_shrimp` +0.42 when the top lifts; `tech.escape_side_underhook_turn` +0.42 | ≈ 0 (`sub.kimura` on the striking arm only vs a T0 top) | 2 |
| `pos.ground_side_kesa` | near arm trapped: short elbows/hammerfists with the free hand | 10–20 | 0.60 | 0.5 | hammerfists, elbows | `tech.bridge_roll_kesa_side` +0.42 | ≈ 0 | 2 |
| `pos.ground_side_kob` | upright: full punches | 20–35 | 0.55 | 0.8 | punches, hammerfists | `tech.escape_kob` +0.63 when the top winds up | `sub.armbar` 0.02 | 2.5 |
| `pos.ground_north_south` | knees to the body only | 5–10 | 0.60 | 0.4 | knees to the body, short hammerfists to the ribs | `tech.escape_north_south` +0.21 | ≈ 0 | 1.5 |
| `pos.ground_half_flat` | head control + free-hand punches; cross-face elbows; "punch the frame down" | 15–30 | 0.55 | elbows 0.7, punches 0.6 | elbows, punches, hammerfists, shoulder pressure | `tech.dogfight_entry`/`tech.knee_shield_wrestle_up` +0.42 (underhook when the top sits up); `tech.escape_half_recover` +0.21 | `sub.kimura` on the posting arm 0.03 per 30 s; `sub.guillotine_high_elbow` on a posture break 0.03 | 2.5 (the highest-volume MMA GnP node) |
| `pos.ground_half_knee_shield` | very limited: punches to body/legs | 5–12 | 0.40 | 0.3 | punches to the body, hammerfists over the shield | none (top not committed) | ≈ 0 | 1 |
| `pos.ground_half_deep` / `pos.ground_half_lockdown` | elbows to the top of the head (12-6 flag); crown/back of head illegal | 8–15 | 0.60 | 0.5 | elbows, hammerfists | `tech.sweep_deep_half` / `tech.lockdown_whip_up` +0.42 when the top sits up | `sub.kimura` 0.01 | 1.5 |
| `pos.ground_closed_posture_up` | postured punches; elbows when the bottom pulls | 12–25 | 0.45 | 0.5 (elbows 0.7 when close) | punches, elbows, body shots | `tech.sweep_hip_bump` +0.63 when the top posts a hand; §04 entries on over-commit | `sub.triangle`/`sub.armbar` 0.04 per 30 s of postured striking vs a T3+ bottom; `sub.kimura` 0.02 | 1.5 |
| `pos.ground_closed_posture_broken` | almost none | 3–8 | 0.40 | 0.2 | short body punches, short elbows to the thigh | bottom attack node (§04: 1.0 attempts/min at T3+) | high | 0.5 (the bottom may win the exchange with sub attempts) |
| `pos.ground_open_kneeling_top` / `pos.ground_hq` | postured punches, diving punches | 10–20 | 0.45 | 0.6 | punches, hammerfists; leg kicks to the thighs when standing | §04 `sub.armbar`/`sub.triangle` 0.03 per 30 s; sweeps +0.42; up-kick when standing | 0.03 | 1.5 |
| `pos.ground_open_legs_up` (top standing) | diving punches, leg kicks to the thighs; soccer kicks/stomps illegal (§06 flag) | 6–15 | 0.40 | 0.7 (diving punches land hard, rarely) | punches, kicks to legs/body | bottom's up-kick (dmg× 0.6 to the head, legal because the top is standing); `tech.technical_standup` | up-kick KO 0.01 per 10 s [E] | 1 |
| `pos.ground_turtle` (top) | punches to the side of the head, knees to the body, hammerfists | 15–30 | 0.60 | 0.6 | punches, hammerfists, knees to the body (head: `kneesToGroundedHead` flag for ONE/PRIDE rules) | `tech.turtle_sit_out_peek` +0.42 when the top strikes instead of riding | ≈ 0 | 2.5 |
| `pos.ground_front_headlock` / `pos.td_sprawl` (top) | knees to the body, short uppercuts, elbows to the side/top of the head | 10–20 | 0.55 | 0.6 | knees to the body, uppercuts, elbows | `tech.re_shot` +0.42 | none (the guillotine is the top's exit) | 2 |
| **bottom striking** (any guard) | elbows from closed/half guard, hammerfists, up-kicks vs a standing top | 5–15 | 0.40 | 0.3 (elbows 0.4; up-kicks 0.6) | elbows, short punches, up-kicks (only vs standing), heel kicks to the kidneys | — | — | 0.5 (rarely wins rounds; stops 10-8s) |

#### 5.1.1 Clinch and ground strike ids [REVIEW: added — no section defined these ids; §02 §1 assigns tied clinch strikes and ground striking to this section, §05 needs a `tech` and `weapon` per impact, and §01's presets reference `tech.gnp_cross` / `tech.clinch_knee`]

Every strike thrown from a tie or a ground node is one of the ids below; force is taken from the named §02 Table B
row and multiplied by the **dmg×** of §5.1 (or the clinch rate/land values of §2.3 A/C/E), then handed to §05 as a
`StrikeImpact` with `posture ∈ {clinch, groundTop, groundBottom, wallPinned}`. Land rates are the §5.1 / §2.3 values.

| id | weapon | §02 force row | where | notes |
|---|---|---|---|---|
| `tech.clinch_uppercut` | fist | `tech.uppercut_lead/_rear` | `pos.clinch_collar_tie`, `pos.clinch_over_under`, cage pins | dirty boxing; lands 0.55–0.70 [S: MMA_INTEGRATION I-10] |
| `tech.clinch_hook` | fist | `tech.hook_lead` | as above | short hook over the tie |
| `tech.clinch_elbow` | elbow | `tech.elbow_*` | collar tie, plum, cage pins, front headlock | cut channel (§05); 12-6 flag |
| `tech.clinch_knee` | knee | `tech.knee_straight` | plum (`tech.plum_knee` is the plum-specific edge), collar tie, cage pins, front headlock, sprawl | body/thigh default; head only where legal (§06) |
| `tech.foot_stomp` | heel | — (no damage) | cage pins | already an edge in §2.3 E |
| `tech.gnp_punch` | fist | `tech.cross` (postured) / `tech.hook_lead` (seated) | any top node with a free hand | dmg× per §5.1 |
| `tech.gnp_hammerfist` | hammerfist | `tech.hook_lead` × 0.6 | mount, side, back, crucifix | 05 `kWeapon` hammerfist 0.6 |
| `tech.gnp_elbow` | elbow | `tech.elbow_*` | mount, side, half, crucifix, deep half | 12-6 flag; cut channel |
| `tech.gnp_knee_body` | knee | `tech.knee_straight` × 0.5 (body) | side, north-south, turtle, sprawl | never to a grounded head under Unified (§06) |
| `tech.upkick` | heel | `tech.teep_rear` × 0.6 | `pos.ground_open_legs_up` (bottom) | legal only vs a standing top (§06) |
| `tech.bottom_elbow` | elbow | `tech.elbow_horizontal` × 0.4 | closed / half guard bottom | |
| `tech.bottom_punch` | fist | `tech.jab` × 0.5 | any guard bottom | |

### 5.2 Posture-vs-control trade-off

Entering `posture = 'postured'` (`tech.gnp_posture`) unlocks the row above and simultaneously grants the bottom
**POST +0.40 logit** on every sweep/escape/get-up edge that lists it, plus the per-node opening in the table
`[S: BJJ_POSITIONS §3.3, §8 r7]`. A landed strike also drains the bottom's stamina 0.5 % `[S: BJJ_POSITIONS §8 r8]`
and reduces its guard retention by −0.1 logit per 5 % of the ground-damage pool `[S: BJJ_POSITIONS §8 r23]`; T0
guards open after 3 landed strikes, T1 after 5 `[S: BJJ_POSITIONS §6]`. The net effect at T4 vs T4 from
`pos.ground_closed_posture_up`: posturing raises the top's pass P by up to +0.6 (STK+) while raising the bottom's
hip-bump P from 0.25 to ≈ 0.48 `[D: logit(0.25) + 0.4 + 0.63 = −0.07 ⇒ 0.48]` for the tick the hand is posted — the
"fight" over posture is what the decision layer (§07) is choosing.

### 5.3 GnP as passing pressure

`STK+`: +0.20 logit per landed ground strike by the top in the last 5 s (max 3 ⇒ +0.60) on every pass/advance
edge marked STK+ `[D: BJJ_POSITIONS §3.3 +0.25; MMA_INTEGRATION I-16 +10–20 pp]`. The Frontiers AI 2019 victory
rule "offensive passes ≥ 3 with ground strikes ≥ 1" and the 77–79 % win rate for landing a single sig ground
strike `[S: MMA_INTEGRATION §1]` are why the top AI should strike before passing; the cost is the §5.2 window.
The bottom's covering (STK− on its own edges: −0.20 per strike absorbed) models frames collapsing under fire.

### 5.4 Finish and referee interface (owned by §05/§06; stated here for closure)

[REVIEW: the stoppage *decision* is §06's — `ref.tkoUnansweredGround` 6 / 4 / 3 unanswered clean head strikes
(lenient / standard / strict), `ref.tkoNoDefenceS` 3.0 / 2.0 / 1.2 s and `ref.tkoAbsorbed30`, all read from §05's
`RefObservables` (`unansweredHead`, `tSinceDefenceS`, `intelligentDefence`). The BJJ_POSITIONS per-strike stoppage
formula below is retained only as a calibration sanity check for the §5.1 rates; it is not rolled by the engine.]
Per landed strike: damage = `dmg× × strikerPower × (1 + 0.15 × posture)` into the ground-damage pool (§05 `raw`
via the §5.1 ids' `StrikeImpact`); sanity formula `P(stoppage per landed clean strike) ≈ 0.02 × dmg× × (1 + pool/threshold)`
after ≥ 3 unanswered clean strikes, plus the hard KO threshold `[S: BJJ_POSITIONS §4, §8 r9]`. Sanity: elite top vs T1 bottom in
`pos.ground_mount_high` ≈ 50 % TKO within 30 s; equal elite ≈ 15 % per 30 s (the bottom escapes/turtles first);
no bottom fighter spends > 5 min in `pos.ground_mount_high` without a stoppage roll every 5 s
`[S: BJJ_POSITIONS §8 r30]`. Per-minute finish anchors (equal tier): back hooks 0.20, mount high 0.15–0.20 (TKO
0.12, sub 0.05), side 0.05, half flat 0.03 (sub 0.01) `[S: BJJ_POSITIONS §7.5]`.

---

## 6. Control time, activity and stalling (feeds §06)

### 6.1 Work events

A **work event** resets `timers.sinceWork` for the engagement. Work = a landed strike (any position); any
attempted `tech.*` edge from the catalogue (pass, sweep, escape, get-up, back take, mat return, trip, throw,
takedown finish attempt, foot stomp); any §04 submission stage advance; a node change. **Not** work: holding a
node, `tech.gnp_posture`/`tech.gnp_settle` alone, grip changes with no attempt (`tech.grip_exchange` counts as
work only in the judo ruleset) `[S: RULES_JUDGING §3.3 "simply maintaining a superior position is not effort"]`.

### 6.2 Timers

| timer | strictness lenient / default / strict (s) | notes | src |
|---|---|---|---|
| `standupWarnSeconds` / `standupSeconds` — ground, no work by **either** | 45 / 75 · 30 / 50 · 15 / 30 | warning "work!" at the first, restart at the second; BJJ_POSITIONS uses 30 s in guard nodes and 45 s in side/mount/back before a 20 %/s stand-up roll — the strict/default columns bracket it | [S: RULES_JUDGING §5] [S: BJJ_POSITIONS §8 r17] |
| stand-up when the top is passive but the bottom is active | never / rarely / as above | the bottom's effort resets the timer | [S: RULES_JUDGING §5] |
| passive top in a guard node (no strikes, no pass attempts) | 20 s → apply the inactivity rule regardless of "control" | | [S: BJJ_POSITIONS §8 r27] |
| `clinchBreakSeconds` — fence clinch, no strikes or TD attempts | 40 / 25 / 12 | WRESTLING: 15 s then 0.50 per further 5 s (referee variance) | [S: RULES_JUDGING §5] [S: WRESTLING §9 r24] |
| Muay Thai clinch (no timer in the rule) | 5–8 s inactive | ruleset overlay | [S: RULES_JUDGING §3.3] |
| kickboxing clinch | one strike then break (≤ 5 s effective knees under ABC pro KB) | ruleset overlay | [S: RULES_JUDGING §3.3] |
| IBJJF stalling | 20 s clock; not stalling when defending from mount/back/side/N-S | ruleset overlay | [S: RULES_JUDGING §5] |

### 6.3 Control-time accrual (judging input)

`controlTime` accrues per tick to the fighter in the `a` slot of any `clinch` engagement where they hold
`underhookOwner`/head position or a cage pin, any `takedown` engagement (attacker), and the top slot of any
ground node whose ctrl ≥ 5 in §2.2, plus the back-control nodes for the fighter on the back
`[S: BJJ_POSITIONS §8 r22]`. Bottom control (closed guard posture broken, leg entanglements) accrues to the bottom
only in grappling rulesets, never under Unified `[E]`. Targets: control time ≈ 39 % of fight minutes (both
fighters), mean 2.2 min / median 1.0 min per fighter per fight; winners 3.0 vs losers 1.4 min
`[S: FIGHT_DATA §3 #77–79]`; a control gap ≥ 3 min wins the decision 70 %, ≥ 5 min 87 % `[S: FIGHT_DATA §3 #84]`;
controllers who lose average 49 vs 70 sig strikes `[S: MMA_INTEGRATION §1]`.

Judge credit per minute in a node is the **judge** column of §5.1; 10-8 when ≥ 3 min dominant position **and**
≥ 15 landed ground strikes or a near-finish `[S: BJJ_POSITIONS §8 r22]`. Aggression/cage control are tiebreakers
only (§06).

### 6.4 Stalling behaviours the referee sees

- Lay-and-pray: top in `pos.ground_half_flat`/`pos.ground_side` with `posture = 'chest'` and no edge attempts →
  20 s passive-top rule (§6.2).
- Guard holding (T1 bottom default: `pos.ground_closed_posture_up`, hold-and-stall) → ordinary stand-up timer.
- Fence leaning: `pos.clinch_cage_pin_front` with only foot stomps → stomps count as work; the referee break still
  fires at `clinchBreakSeconds` if nothing else lands `[E]` (design choice to avoid stomp-only stalling).
- Stalling from `pos.ground_back_hooks` while the bottom hand-fights: the bottom's hand-fight is work; the timer
  runs on the top: attempts of `sub.rnc` stages count.

---

## 7. Multi-opponent notes (interface to §07 §2.7 and §09 §3.1) [REVIEW: was "§08"]

The engagement invariant (§2.1.1) already decomposes the world into pairs. Rules when a **third fighter** C
approaches an engagement between A (top/attacker) and B (bottom/defender):

1. **No triple engagements.** C cannot join `A–B` as a third slot. C either (a) stays free and strikes, (b)
   starts a *new* engagement with A by pulling A out, or (c) starts a new engagement with B once B is free.
2. **Striking a grappling pair from outside.** C at `pos.standing_close` to the pair may strike A or B with the
   §02 standing kit; the target is `grounded` under Unified (no knees/kicks to the head; §06 flags per ruleset;
   street mode lifts all restrictions `[S: RULES_JUDGING §2.6]`). A top fighter being struck by C suffers `STK−`
   on all of its edges and loses 30 % of its striking rate (must cover) `[E]`; a bottom fighter being struck by
   two fighters gets **−1.0 logit** on every escape/get-up edge and its guard-retention degradation runs at ×2
   `[E]` ("dog-pile" effect; `[S: FIGHT_DATA §6]` multi-assailant outcomes are the anchor: ground + multiple
   attackers is the worst survivable state).
3. **Pulling the top fighter off.** C may attempt `tech.clinch_entry_cold` / `tech.arm_drag` /
   `tech.duck_under` (success node `pos.clinch_body_lock_rear`) on A from behind: base 0.55 `[E]` (A is occupied:
   +0.63 SETUP-equivalent), k `wr.pummel` vs A's `wr.pummel` 2.0. Success ends `A–B` immediately: B is placed in
   `pos.ground_open_legs_up` **with no top** (a `knockdown`-kind engagement with `a = null`) and auto-stands via
   `tech.technical_standup` at 0.90 in 1.5–3 s (disengaged branch); A–C becomes a `clinch` engagement in
   `pos.clinch_body_lock_rear` or `pos.clinch_over_under`.
4. **Team-mate assist without contact.** If C is A's team-mate, C's presence at ≤ 1.5 m gives A `+0.3` logit on
   finishing edges and B `−0.3` on get-ups `[E]` (B must split attention; §07 §2.7.3 `focusPenaltyLogit` continuity with
   the current engine `[S: AUDIT §1.1]`).
5. **Scrambles stay pairwise.** `pos.scramble` never admits a third fighter; C waits or strikes.
6. **Free-for-all sanity.** A fighter leaving an engagement (stand-up, break, referee) is free for one tick
   before any new engagement can claim it, so two claimants resolve by the §07 §2.7.2 targeting order, not by tick
   ordering.
7. **Determinism.** Engagement creation/dissolution is processed in ascending fighter id inside the existing
   tick order (`actions (ascending id)`) `[S: AUDIT §1.1]`.

---

## 8. Behaviour by skill tier

Tier bands per conventions §3. Values `[S: WRESTLING §7]` / `[S: JUDO §6]` / `[S: BJJ_POSITIONS §6]` unless tagged;
the research tiers (novice / competent / advanced / elite / generational; brand-new / beginner / intermediate /
advanced / elite) map onto T0–T1 / T2 / T3 / T4 / T5 `[D: band midpoints]`.

### 8.1 Wrestling

| behaviour | T0 | T1 | T2 | T3 | T4 | T5 | src |
|---|---|---|---|---|---|---|---|
| level change before a shot | never: bends at the waist, reaches (shots −0.85 logit, eats a counter 30 % of the time) | 30 % of shots [E] | 60 % | 90 % | always; feinted and mixed with strikes | always; off the opponent's tendencies | [S: WRESTLING §7] [S: MMA_INTEGRATION §8] |
| head position on shots | down/outside/low: guillotine catch ×2.5 | ×2.0 [E] | correct 60 % | correct 85 % | correct; ×0.5 catch | ×0.5 | [S: WRESTLING §7, §9 r6] |
| sprawl denial (`def.sprawl` tier table) | 0.20 (reaction ≥ 600 ms) | 0.20 [REVIEW: was 0.35 [E]; 01 `beh.wr.sprawl_late` puts T0–T1 at ≈ 20 %] | 0.50 | 0.70 | 0.85 | 0.90 | [S: WRESTLING §7, §9 r10] |
| chain after a stall (§3.1) | 0.15 | 0.31 | 0.47 | 0.63 | 0.79 | 0.91 | [D: §3.1] |
| reactive / set-up shots | never; no SETUP bonus | 5 % [E] | 10 % | 30 % | ≥ 50 %; +0.63 | ≥ 60 % [E] | [S: WRESTLING §7, §9 r5] |
| finish selection | one finish (a drive), repeats it | one finish | 2 finishes | 3–4, switches on the whizzer | full tree; picks the finish the defence hands them | full tree + baits | [S: WRESTLING §7] |
| cage use (drives a stalled attempt to the fence) | no; stalls in `pos.td_single_leg_in` and loses it to hops/limp legs | 25 % [E] | 50 % | 75 % | 90 % | 90 % + denies the opponent's wall | [S: WRESTLING §7] |
| bottom stand-up | turns away, gives the back (30 % of attempts cost `pos.ground_back_hooks`) | technical stand-up late | technical stand-up 0.25 per attempt | wall walk + kimura grip 0.35 | 0.45–0.55 per attempt; rarely gives the back | never lets the top settle; stand-ups lead into offence | [S: WRESTLING §7] [S: MMA_INTEGRATION §8] |
| energy | shoots from far; 2× energy per attempt | 1.6× | normal | fewer wasted shots | attempts per landed TD ≈ 1.6 vs population 2.5 | 1.5 [E] | [S: WRESTLING §7] |
| top retention (loses position within 30 s) | 55 % | 55 % [REVIEW: was 50 % [E]; 01 `beh.wr.ride_retention` T0–T1 55 %] | 40 % | 25 % | 15 % | 10 % [E] | [S: WRESTLING §7] |
| edge availability | `tech.double_leg` (no level change), `tech.single_leg` (head outside), `tech.clinch_entry_cold`, `tech.snap_down` (bent target) | + `tech.high_crotch`, `def.sprawl`, `tech.pummel` | + `tech.single_run_pipe`, `tech.double_drive_through`, `tech.arm_drag`, `tech.inside_trip`, `tech.rear_mat_return`, `tech.re_shot` | + all finishes, `tech.cage_drive`, `tech.hc_cage_drive_single`, `tech.front_headlock_go_behind`, `tech.ankle_pick` | full catalogue incl. `tech.single_low`, `tech.funk_roll` (if `wr.scramble` ≥ 70), `tech.rear_lift_suplex` | full | [E] gating by the WRESTLING §7 rows |

### 8.2 Judo (no-gi)

| behaviour | T0–T1 | T2–T3 | T4–T5 | src |
|---|---|---|---|---|
| posture | stiff arms, bent forward, head down, weight on the toes (kuzushi front mag 1 permanently: invites `tech.sumi_gaeshi`, `tech.koshi_guruma`, `tech.snap_down`) | upright but static; over-relies on one grip | upright, head over hips; changes posture with the grip | [S: JUDO §6] |
| grip fighting (`tech.grip_exchange`) | grabs whatever is offered; never breaks grips (P clamp 0.15) | preferred grip ~50 % of exchanges | wins 65–70 % vs intermediate; dictates ai/kenka-yotsu; varies the tsurite | [S: JUDO §6] |
| kuzushi | none — throws "from the arms" on a balanced uke (KUZ ×0.5 always) | one direction, telegraphed (mag ≤ 2) | multi-directional; reactive (action–reaction 34.8 % of attacks); uses uke's own step | [S: JUDO §6, §7.4] |
| attack pattern | single telegraphed attempts, one direction | 2 directions; occasional combination | 3–4 directions; chains (§3.3 `chain.judo_renzoku`); counters ready | [S: JUDO §6] |
| attempt rate (judo ruleset) | 1–3 per 4-min match + false attacks | 4–6 | 6–9 (super-elite 9 ± 6); 14.5 actions/match | [S: JUDO §6, §7.2, §7.3] |
| MMA attempt rate | rarely; falls into guard on any trip | ≈ 1 throw per 3 full tie-ups | ≈ 1 per 3 full tie-ups, plus counter-throws off caught punches and shots | [S: JUDO §8 r15] |
| failure mode | thrown by own momentum (mirror counters and tani otoshi succeed > 50 %); falls to the knees after a failed drop seoi and gets the back taken (position-given share ×2) | grip lost, resets | clean reset; keeps the grip; ≈ 2–4 % of attempts end in being thrown | [S: JUDO §6, §8 r9] |
| counter-launch factor (failure table) | 0.3 | 1.0 | 1.5 | [S: JUDO §8 r9] |
| edge availability | `tech.ouchi_gari`, `tech.kouchi_gari`, `tech.o_goshi`, `tech.osoto_gari` (telegraphed) | + `tech.uchi_mata`, `tech.harai_goshi`, `tech.koshi_guruma`, `tech.tai_otoshi`, `tech.de_ashi_harai`, `tech.tani_otoshi`, `tech.ura_nage` | full incl. `tech.uchi_mata_sukashi`, gaeshi family, `tech.te_guruma`, `tech.sumi_gaeshi`, `tech.ippon_seoi` off a caught punch | [E] gating |

### 8.3 BJJ / ground

| behaviour | T0 | T1 | T2 | T3 | T4 | T5 | src |
|---|---|---|---|---|---|---|---|
| bottom default | flat on the back; turns to the belly under strikes (`tech.escape_mount_turn_belly` 90 % of the time); straight-arm pushes from mount (armbar exposure ×3) | closed guard, holds and stalls (→ referee stand-ups); hip escape slow (dur ×1.5) | half-guard game: knee shield, underhook, dogfight; some butterfly; wall walks | full retention; butterfly/SLX entries; wrestle-ups; leg-lock threats deter passes; cage-savvy | fluid: never flat; chains sweep → sub → get-up; wrestle-ups from every seated guard; uses strike openings (upa on posts) | as T4 + baits posture to create openings [E] | [S: BJJ_POSITIONS §6] |
| top default | lies in guard, punches wildly, posts hands (upa +0.85); swept from mount by upa 2× | basic knee cut / stack; holds side control without advancing; GnP from half at a low rate | knee cut + smash + cross-face GnP from half; takes mount; loses the back by rushing the RNC | chain passing (pass → pass 0.30); body lock; floating; strikes to pass; systematic back control (hooks → body triangle → hand fight) | positional chains with minimal risk; converts turtle to back 60 %+; GnP volume without giving up posture; finishes from every dominant node | as T4 | [S: BJJ_POSITIONS §6] |
| grappling stamina cost | ×1.6 (panics, holds breath) | ×1.3 | ×1.1 | ×1.1 | ×1.0 | ×0.9 | [S: BJJ_POSITIONS §6] via 01 `energy.actionCostMult` [REVIEW: re-mapped — 01 §2.3.4 maps BJJ_POSITIONS' five tiers 0/1/2/3/4 → T0/T1/T2–T3/T4/T5, so BJJ tier 2 (×1.1) covers T2 and T3; was ×1.1/×1.0/×0.9/×0.85 for T2…T5] |
| decision latency between edge attempts (s) | 4–8 | 3–5 | 2–4 | 2–4 | 1.5–3 | 1–2 | [S: BJJ_POSITIONS §6] via 01 `beh.bjj.decision_latency` [REVIEW: re-mapped to 01 §2.3.4 (T2–T3 share BJJ tier 2)] |
| turns the back / gives up the back (share of side-control escapes) | 60 % | 40 % | 20 % | 20 % | 8 % | 3 % | [S: BJJ_POSITIONS §6] via 01 `beh.bjj.turns_back` [REVIEW: re-mapped to 01 §2.3.4] |
| escape attempts per 30 s under mount | 1 (bridge-and-push) | 2 | 3 | 3 | 4 | 5 | [S: BJJ_POSITIONS §6] via 01 `beh.bjj.mount_escape_attempts` [REVIEW: re-mapped to 01 §2.3.4] |
| submission-exit awareness while striking | none (arm extended: armbar 5 %/10 s) | low | medium | medium | high | very high | [S: BJJ_POSITIONS §6] = 01 `beh.bjj.sub_exit_awareness` [REVIEW: re-mapped] |
| uses the cage | no | rarely | yes (wall walk) | yes (wall walk) | both sides | both sides + denies the opponent's use (knee pin, body-lock pinning) | [S: BJJ_POSITIONS §6] = 01 `beh.bjj.cage_use` [REVIEW: re-mapped] |
| pass repertoire (AI weights) | stack 60 / knee cut 40 | knee cut 50 / stack 30 / toreando 20 | knee cut 35 / smash 25 / toreando 20 / over-under 10 / body lock 10 | as T2 | knee cut 25 / body lock 20 / leg drag 15 / toreando 15 / HQ 15 / float 10 | body lock 25 / float 20 / knee cut 20 / leg drag 15 / toreando 10 / cage 10 | [S: BJJ_POSITIONS §6] = 01 `beh.bjj.pass_repertoire` [REVIEW: re-mapped to 01 §2.3.4; the T4/T5 columns were one tier too low] |
| sweep repertoire | none (bucks) | hip bump / scissor / basic butterfly | butterfly / underhook half / knee-shield wrestle-up | as T2 | + X/SLX, deep half, arm drag | + K-guard, leg entanglements, matrix back takes | [S: BJJ_POSITIONS §6] = 01 `beh.bjj.sweep_repertoire` [REVIEW: re-mapped] |
| guard retention vs strikes | breaks: opens on 3 landed | opens on 5 | holds, re-guards | holds, re-guards | holds; frames + wrist control | holds; counters strikes with sweeps/subs | [S: BJJ_POSITIONS §6] = 01 `beh.bjj.guard_vs_strikes` [REVIEW: re-mapped] |
| bottom priority (AI) | turn away / push 60 % | closed-guard hold 50 / hip escape 30 / get-up 20 | get-up on 60 % of decisions unless a sweep/sub has P ≥ 0.45 | same | same, with sweep → sub chains | same | [S: BJJ_POSITIONS §8 r14] |

Cross-discipline MMA consensus that the AI (§07) should encode: bottom priority in MMA is stand up > sweep >
submit; closed guard is a posture-break-and-stand tool; the top's first job after a takedown is head control
(kills the wrestle-up and the wall walk); KOB and turtle striking are the fastest ways to make the bottom give
the back; leg entanglements are rare in MMA because the head is exposed `[S: BJJ_POSITIONS §6]`. Fight-IQ tiers
(§07): getting up — T1 turtles/covers, T2 wall-walks late, T3 immediately, T4 never lets the top settle, T5 stands
into offence `[S: MMA_INTEGRATION §8]`.

---

## 9. Parameter registry, calibration hooks, assumptions

### 9.1 Parameter registry

The **base**, **dur**, **k_skill** and destination weights of every row in §2.3 are parameters and become
`src/engine/params/grappling/edges.ts` verbatim (one record per edge id, tag carried as a string field). The
node ratings in §2.2 become `params/grappling/nodes.ts`. Global tunables:

| id | value | unit | tag |
|---|---|---|---|
| `grap.clampMin` / `grap.clampMax` | 0.03 / 0.95 | P | [S: WRESTLING §9] |
| `grap.k.str` | 0.10 | logit per 10 pts per `+` | [D: §2.1.4] |
| `grap.k.mass` | 0.16 (cap ±0.6 per code) | logit per 10 kg per `+` | [D: §2.1.4] |
| `grap.k.exp` / `grap.k.flx` | 0.10 / 0.10 | logit per 10 pts | [E] |
| `grap.k.bal` | −0.10 | logit per 10 pts of defender balance above 50 | [E] |
| `grap.k.hgt` / `grap.k.rch` | 0.05 / 0.05 | logit per 10 cm | [D]/[E] §2.1.4 |
| `grap.k.fat` | −1.0 | logit per unit fatigue per `−` | [D: §2.1.4] |
| `grap.setupBonus` / `grap.telegraphPenalty` | +0.63 / −0.63 | logit | [D: ±0.15 P] |
| `grap.setupWindowMs` | 500 | ms | [S: WRESTLING §9 r5] |
| `grap.reactiveShotMinSkill` | 40 | `wr.shot` | [S: WRESTLING §3.1] |
| `grap.reactiveShotMinReaction` | 60 | reactionTime attribute | [E] |
| `grap.sprawlWindowMs` / `grap.sprawlWindowTelegraphBonusMs` | 450 / +100 | ms | [S: WRESTLING §9 r10] |
| `grap.stkPerStrike` / `grap.stkMax` | 0.20 / 3 | logit, count | [D: §2.1.4] |
| `grap.postureBonus` | 0.40 | logit | [S: BJJ_POSITIONS §3.3] |
| `grap.rockedBonus` | 0.80 | logit | [E] |
| `grap.wetPenalty` / `grap.wetFromRound` | −0.15 / 3 | logit, round | [S: BJJ_POSITIONS §3.3] |
| `grap.uho` | ±0.35 | logit | [S: BJJ_POSITIONS §5.3] |
| `grap.cageReachM` | 1.0 | m | [S: WRESTLING §5.1] |
| `grap.cageTdShareTarget` | 0.55 | share of TDs at the fence (check only) | [S: WRESTLING §5] |
| `grap.cageCaptureBonus` / `grap.cageRunPipePenalty` / `grap.cageTripBonus` / `grap.cageSprawlPenalty` | +0.42 (+0.63 double) / −1.05 / +0.42 / −0.42 | logit | [D: WRESTLING §5.2 pp values] |
| `grap.cageFinishDurMult` | 1.5 | × | [S: WRESTLING §5.2] |
| `grap.cagePinnedEnergyMult` | 1.3 | × | [S: WRESTLING §5.2] |
| `grap.cageHipInFinishMult` | 0.5 | × on drive/lift P | [S: WRESTLING §5.2] |
| `grap.cageBreakPPer5s` | 0.30 | P | [S: WRESTLING §5.2] |
| `grap.cageFwdThrowMult` / `grap.cageReapMult` / `grap.cageLiftMult` / `grap.cageCounterLaunchMult` | 0.7 / 1.5 / 1.25 / 0.7 | × P | [S: JUDO §8 r13] |
| `grap.cageSizeTelePerM` | (radius/9.1)^−1 on TELE | × | [E] on [S: WRESTLING §8.1] |
| `grap.pummelIntervalMs` | 3,000 | ms | [S: WRESTLING §5.3] |
| `grap.pummelSkillP` / `grap.pummelStrP` / `grap.pummelFatP` | 0.004 / 0.003 / −0.15 | P per pt / per pt / per unit Δfatigue | [S: WRESTLING §5.3] |
| `grap.greccoJudoClinchBonus` | +0.42 | logit | [D: +10 pp, WRESTLING §9 r13] |
| `grap.guillotineTaxBase` / `.noviceMult` / `.eliteMult` / `.bjjBonus` / `.finishIntoGuillotine` | 0.12 / 2.5 / 0.5 / +0.10 / 0.60 | P | [S: WRESTLING §9 r6] |
| `grap.captureFailSplit` | sprawl 0.50 / standing 0.35 / front headlock 0.15 | weights | [S: WRESTLING §9 r8] |
| `grap.finishAttemptsMaxOpen` / `.MaxCage` | 3 / 6 | count | [S: WRESTLING §9 r8] |
| `grap.chainBase` / `grap.chainPerSkill` | 0.15 / 0.008 | P, P per `wr.chain` pt | [S: WRESTLING §9 r9] |
| `grap.chainFatigueHalfAbove` | 0.7 | fatigue | [S: WRESTLING §9 r4] |
| `grap.chainSecondShotPenalty` / `.bentBonus` | −0.42 / +0.42 | logit | [D: ∓10 pp] |
| `grap.chainStepFatigueMult` | 1.5 | × shot fatigue | [S: WRESTLING §9 r9] |
| `grap.judoChainMult` / `grap.judoChainWindowMs` | 1.3 / 500 | × P, ms | [S: JUDO §8 r10] |
| `grap.bjjChainBonusT4` / `.T3` / `.windowMs` | +0.30 / +0.15 / 5,000 | logit, ms | [S: BJJ_POSITIONS §8 r6] |
| `grap.judoFailTable` | reset 0.62 / lost 0.18 / given 0.10 (0.30 drop/sacrifice) / counter 0.10 | weights | [S: JUDO §8 r9] |
| `grap.judoCommitMult` | 1.5 / 1.0 / 0.3 | × | [S: JUDO §8 r9] |
| `grap.judoCounterTierFactor` | 0.3 / 1.0 / 1.5 (T0–1 / T2–3 / T4–5) | × | [S: JUDO §8 r9] |
| `grap.judoGripDominantMult` / `.ukeDominantMult` | 1.3 / 0.6 | × P | [S: JUDO §8 r4] |
| `grap.judoSameSide` / `.kenkaSameSide` / `.crossSide` | +0.14 / +0.22 / −0.10 | logit | [D: ×1.15 / ×1.25 / ×0.9] |
| `grap.kuzushiMagMax` / `.decayPer` / `.alignedMult` / `.unalignedMult` / `.oppositeMult` | 3 / −1 per 2,000 ms / (0.5 + 0.25·mag) / 0.5 / 0.3 | — | [S: JUDO §8 r6] |
| `grap.handleSlipWristCollar` / `.hookLock` | 0.20 / 0.05 per 5 s | P | [S: JUDO §8 r12] |
| `grap.throwStrikeCheckMs` / `.strikeCheckMult` | 1,000 / 0.5 | ms, × clinch accuracy | [S: JUDO §8 r8] |
| `grap.throwLandingDmg` | 0.5 / 0.8 / 0.2 (hip-shoulder / rear / sweep-reap) | × slam scale | [S: JUDO §8 r11] |
| `grap.slamKoClassP` | 0.03–0.08 | P per slam | [S: WRESTLING §3.3] |
| `grap.saltoRisk` | 0.10 | P on a successful rear lift | [S: WRESTLING §9 r14] |
| `grap.scrambleWeights` | 0.5 / 0.2 / 0.15 / 0.15 / −30 / +10 (wr.scramble / bjj.escape / speed / flexibility / fatigue / funk) | — | [S: WRESTLING §6] |
| `grap.scrambleLogitPerPt` | 0.0576 | logit per score point | [D: ln10/40] |
| `grap.scrambleMaxMs` / `.fatigueMult` | 2,000 (4,000 cap) / 2.0 | ms, × | [S: WRESTLING §6] [S: BJJ_POSITIONS §8 r26] |
| `grap.scrambleOutcomeOpen` / `.Cage` | 0.30/0.15/0.25/0.15/0.15 · 0.25/0.20/0.20/0.10/0.25 | weights | [S: WRESTLING §6] |
| `grap.frontHeadlockDecayMs` / `.decaySplit` | 4,000 / standing 0.60, collar tie 0.40 | ms, weights | [S: WRESTLING §9 r12] |
| `grap.stabiliseRollDelayMs` | 3,000 | ms | [S: WRESTLING §8.4] |
| `grap.stabiliseTable` | §2.3 K | weights | [S: WRESTLING §8.4] |
| `grap.stabiliseTierShift` | 0.10 per tier | mass moved | [S: BJJ_POSITIONS §5.1] |
| `grap.wallWalkCycleMs` / `.reachFeetP` / `.cleanP` / `.heldP` / `.dragP` | 5,000 / 0.60 / 0.35 / 0.45 / 0.20 | ms, P | [S: WRESTLING §3.8, §9 r17] |
| `grap.wallWalkFenceGrabP` (T ≤ 1) / `.grabPenalty` | 0.05 / −0.5 | P, logit | [S: BJJ_POSITIONS §8 r16] |
| `grap.getUpTopFatigueBonus` | +0.42 × top fatigue | logit | [D: WRESTLING §9 r17 +0.10 P] |
| `grap.getUpFailFreeStrikeOrBackTakeP` | 0.15 | P | [S: WRESTLING §9 r17] |
| `grap.ridePer5s` | hooks 0.35 (+0.42 folkstyle) / retain 0.40 / bottom out 0.25 | P | [S: WRESTLING §9 r18] |
| `grap.turtleWindowBonus` / `.windowMs` | +0.30 / 3,000 | logit, ms | [S: BJJ_POSITIONS §8 r13] |
| `grap.backTakeSubEntryP` | 0.45 | P | [S: BJJ_POSITIONS §1] |
| `grap.bodyTriangleP` / `.minTier` | 0.60 / T3 | P | [S: BJJ_POSITIONS §8 r12] |
| `grap.oneHookUpgradeP` / `.oneHookEscapeP` (per 5 s) | 0.50 / 0.35 | P | [S: BJJ_POSITIONS §8 r12] |
| `grap.backHandFightP` / `.durMs` / `.lossesForRncBonus` / `.rncBonus` | 0.50 / 3,000 / 3 / +0.3 | — | [S: BJJ_POSITIONS §8 r24] |
| `grap.gnpStaminaDrainPerLanded` | 0.005 | stamina fraction | [S: BJJ_POSITIONS §8 r8] |
| `grap.gnpRetentionPenaltyPer5pct` | −0.10 | logit | [S: BJJ_POSITIONS §8 r23] |
| `grap.guardOpensAfterStrikes` | T0 3 / T1 5 | count | [S: BJJ_POSITIONS §6] |
| `grap.gnpStoppageBase` / `.minUnanswered` | 0.02 × dmg× × (1 + pool/threshold) / 3 — calibration sanity check only; the engine's stoppage is §06 `ref.tkoUnansweredGround` 6/4/3 [REVIEW] | P, count | [S: BJJ_POSITIONS §4, §8 r9] |
| `grap.gnpPostureDmgBonus` | 0.15 | × | [S: BJJ_POSITIONS §4] |
| `grap.gnpTable` | §5.1 | — | [S: BJJ_POSITIONS §4] |
| `grap.groundFatigueMult` | top control 1.0 / top passing-GnP 1.4 / bottom escaping 1.6 / bottom closed-guard hold 0.6 | × | [S: BJJ_POSITIONS §8 r19] |
| `grap.tierStaminaMult` | = 01 `energy.actionCostMult` 1.6 / 1.3 / 1.1 / 1.1 / 1.0 / 0.9 (T0…T5) [REVIEW: was 1.6/1.3/1.1/1.0/0.9/0.85 — 01 owns the tier mapping and 05 reads 01's value] | × | [S: BJJ_POSITIONS §6 via 01 §2.3.4] |
| `grap.decisionLatencyS` | 4–8 / 3–5 / 2–4 / 2–4 / 1.5–3 / 1–2 (T0…T5) [REVIEW: re-mapped to 01 §2.3.4] | s | [S: BJJ_POSITIONS §6] |
| `grap.shotEnergyVsJab` / `.failedShotDefenderMult` | 3.0 / 1.5 | × | [S: WRESTLING §9 r25] |
| `grap.stuffedShotShooterMult` | 2–3 × the striker's stamina | × | [S: MMA_INTEGRATION I-20] |
| `grap.tdPropensityByClass` (AI) | FLW/BW/FW 1.15 · LW/WW 1.0 · MW 0.95 · LHW/HW 0.75; women 1.0 | × | [S: WRESTLING §9 r20, §10] |
| `grap.standupWarnS` / `.standupS` | 45/75 · 30/50 · 15/30 (lenient/default/strict) | s | [S: RULES_JUDGING §5] |
| `grap.standupRollPerS` | 0.20 | P per s after threshold | [S: BJJ_POSITIONS §8 r17] |
| `grap.passiveTopS` | 20 | s | [S: BJJ_POSITIONS §8 r27] |
| `grap.clinchBreakS` | 40 / 25 / 12 | s | [S: RULES_JUDGING §5] |
| `grap.clinchBreakRollPer5s` | 0.50 | P | [S: WRESTLING §9 r24] |
| `grap.multi.strikeTopRateMult` / `.dogPilePenalty` / `.pullOffBase` / `.teamAssist` | 0.7 / −1.0 / 0.55 / ±0.3 | ×, logit, P, logit | [E] §7 |
| `grap.freeAutoStandP` / `.freeAutoStandMs` | 0.90 / 1,500–3,000 | P, ms | [S: BJJ_POSITIONS §3.2 G1 (disengaged)] |
| `grap.rulesetFlags` | `heelHooks`, `elbows12to6`, `kneesToGroundedHead`, `soccerKicks`, `spiking`, `groundedDefinition2024`, `pointsSystem`, `legGrabs` (judo), `fenceAvailable` (ring = false) | flags | [S: BJJ_POSITIONS §8 r28] [S: JUDO §8 r16] |

### 9.2 Calibration hooks (FIGHT_DATA §3 targets this section owns or co-owns)

| # | metric | target | tolerance | how this section moves it |
|---|---|---|---|---|
| 55 | TD attempts per fighter per 15 min | 4.0 | ±0.5 | AI propensity (§07) × `grap.tdPropensityByClass`; WRESTLING volume anchor: average fighter ≈ 4 attempts / 1.65 landed, wrestler archetype ≈ 8 / 3–4 `[S: WRESTLING §9 r21]` |
| 56 | TD landed per fighter per 15 min | 1.45 | ±0.2 | capture × finish bases; cage share |
| 57 / 58 | TD accuracy / defence | 38 % / 62 % | ±3 pp | `tech.double_leg` capture 0.62 × 0.70; single 0.55 × 0.70; mix of entry types; open-mat ×0.85 |
| 59 / 60 / 61 | TD landed / attempted / accuracy by men's class | FLW 1.8 … HW 1.2 / 4.8 … 3.1 / flat 35–38 % | ±0.25 / ±0.5 / ±3 pp | propensity only; success is not class-scaled beyond MASS/STR `[S: WRESTLING §9 r20]` |
| 63 / 64 / 65 / 66 | TD per fight mean 2.1, distribution 28.5/21/16/11/8/6/8 %, zero-TD fights by class, 55 % fighter-bouts with zero TDs | as listed | ±0.3 / ±4 pp on 0 | archetype mix + propensity |
| 67 | winner vs loser TD accuracy | 45–51 % vs 26–29 % | ±4 pp | `k_skill` 2.1 reproduces 50/20 for typical gaps `[S: WRESTLING §9 r2]` |
| 68 | slam share of landed TDs | 9 % | ±3 pp | `tech.double_lift_slam`, `tech.body_lock_lift_return`, `tech.rear_lift_suplex` selection weights; clinch TDs slam 2–3× more than shots `[S: FIGHT_DATA §2.2]` |
| 77 / 78 / 79 | control time mean 2.2 / median 1.0 min; 39 % of fight minutes; winners 3.0 vs 1.4 | ±0.4 / ±5 pp / ±0.5 | dwell times, stabilisation table, get-up bases, stand-up timers |
| 80 | reversals per fight | 0.26 (83 % none) | ±0.1 | sweep bases and attempt frequency (rarity comes from attempts, not P `[S: BJJ_POSITIONS §10 r4]`) |
| 24 | fight time by phase: distance 61 / clinch 15 / ground 24 % | ±5 pp | entry rates + ground stint distribution (§9.2 below); lighter classes 49.6/13.4/36.2 `[S: FIGHT_DATA §2.2 (RM)]`; cage contact 20.9 % |
| 81 | share of sig strikes landed on the ground | 11 % | ±3 pp | §5.1 rates × ground time |
| 82 / 83 | KO/TKO by position (ground 28 %); ground KO share by class 21–32 % men / 39–47 % women | ±6 / ±7 pp | §5.4 stoppage model × mount/crucifix dwell |
| 84 / 86 / 87 | decisions won with more control 68 % (gap bands 51/57/70/87); with more TDs 69 %; striker wins with more strikes but fewer TDs 60–63 % | ±4 / ±4 / ±5 pp | §6.3 accrual → §06 |
| 16 / 19 | ground sig accuracy 72 % (head 67, body 94) | ±3 / ±4 pp | §5.1 land column (0.55–0.65 before §02 terms; 58.6 % for punches/elbows) |
| 28 | ground finishing strikes punches 83 / elbows 14 / knees 3 % | ±5 pp | §5.1 type mix |
| 73 / 74 | sub finish per attempt 25 %; RNC 39 % of finishes | ±5 / ±3 pp | co-owned with §04: back-node dwell and `chain.back_take_to_sub` drive the RNC share |
| — | ground stint after a TD: < 15 s 20 % · 15–45 s 25 % · 45–120 s 30 % · 120–300 s 20 % · finish 5 %; median ≈ 60 s | [E] | get-up bases, wall-walk cycle, §2.3 K `[S: BJJ_POSITIONS §5.1]` |
| — | back up within 30 / 60 / 120 s: open 30/45/65 %, cage 35/55/75 %; elite top vs competent bottom 12/25/45 %; novice top 50/70/85 % | [E] | `[S: WRESTLING §8.4]` |
| — | TD time to completion: blast double 2.5 s median (8 s P90); single 4 s (15 s); cage single/double 8 s (40 s); rear lock return 4 s (20 s); snap → go-behind 3 s (6 s) | [E] | durations × attempts × chain rates `[S: WRESTLING §8.4]` |
| — | elite examples: Makhachev 56 % acc / 91 % def / 3.1 TD per 15; Woodley 93 % def; GSP 74 % acc | — | sanity of `k_skill` at T5 vs T4 `[S: WRESTLING §8.1]` |
| — | passes ≈ 1.5 per 15 min (0.1/min); elite no-gi parity 0.3–1.0 per match; P(pass per 30 s in a guard node at parity) ≈ 0.25 | — | pass bases × decision latency `[S: FIGHT_DATA §2.2] [S: BJJ_POSITIONS §7.5]` |
| — | grappling work/rest structure: Greco work bouts 37 s / rest 14 s; BJJ HI bursts ≈ 4 s every ~30 s; grip strength −15 % per 10 min | — | edge durations and §05 grip fatigue `[S: LIT_A §1.5, §1.6]` |
| — | tier priors: TD accuracy T0 20–30 %, T1 30–35 %, T3 35–38 %, T4 38 %; defence 40–50 / 55 / 60 / 62 % | — | §8 availability + behaviours `[S: FIGHT_DATA §5]` |

Logging (for the calibration surface, `docs/AUDIT.md §3`): emit `TD_ATTEMPT`, `TD_LANDED`, `TD_STUFFED`,
`THROW`, `PASS`, `SWEEP`, `ESCAPE`, `BACK_TAKE`, `MOUNT`, `KOB`, `GET_UP`, `WALL_WALK`, `SCRAMBLE`, `GNP_LANDED`,
`REF_STANDUP`, `CLINCH_BREAK`, `SLAM` with node ids and the engagement's `cage` flag `[S: BJJ_POSITIONS §8 r29]`.

### 9.3 Assumptions and open questions

Every `[E]` in this section, with the tradeoff where one exists (default realism):

1. **Standing-node ratings** (ctrl/strike/esc for §2.2.1–§2.2.3) and all dwell times for standing nodes.
2. **Sub entry rates from clinch nodes** (`sub.guillotine_standing` 0.05 from double-unders/body lock/cage pin,
   `sub.rnc` standing 0.03, guillotine on a duck-under 0.10).
3. **Leg-entanglement node ratings** (`pos.ground_ashi_outside`, `pos.ground_5050`, `pos.ground_saddle`,
   `pos.ground_reap`): mirrored from SLX/BJJ ratings; §04 owns the finishes.
4. **`pos.ground_knockdown`** as a node, `tech.knockdown_follow` 0.70 and its landing split; the 65 % knockdown →
   finish conversion at UFC level is the target `[S: FIGHT_DATA §5]`.
5. **Modifier coefficients** `EXP`, `FLX`, `BAL`, `RCH`, the halved `HGT` (0.05/10 cm), the `RCK` +0.8, the
   `LEGDMG` terms, the `max()` rule for dual sub-skills, `def.read_level_change` 0.30, `tech.level_change_feint`
   0.55, reactionTime gates (60 for reactive shots, 55 for kick catches), `tech.kick_catch` 0.15 vs low kicks.
6. **k_skill choices**: 2.0/3.0/3.5 for BJJ `+/++/+++` and 2.4 for judo are rounded conversions; the judo cap
   is a design choice to keep two-tier gaps ≤ ×2.5 after clamping. **Deviation** from conventions §4's "typical
   1.0–3.0": 3.5 on `tech.pass_float`, `tech.escape_mount_kip`, `tech.escape_granby`, `tech.escape_back`,
   `tech.escape_back_body_triangle`, `tech.crucifix_entry`, `tech.k_guard_entry`.
7. **Cold clinch entry** 0.35, `tech.clinch_entry_strikes` defender's free knee 0.25, `tech.two_on_one_back_take`
   0.35, `tech.rear_trip` 0.45, `tech.open_closed_guard` 0.55, `tech.gnp_settle` 0.95, `tech.cage_knee_pin` 0.50,
   twist body lock 0.40, `tech.thai_dump` specialist threshold (`mma.clinch_strike` ≥ 80), foot stomp land 0.50,
   `tech.pass_body_lock` guillotine counter 0.05, `tech.double_turn_corner` cage −0.42, single-leg head
   inside/outside split 0.6/0.4.
8. **Judo throw stabilisation rows** in §2.3 K (0.75/0.15/0.10 and 0.55/0.25/0.20), `tech.osoto_gari` cross-body
   back exposure 0.20, `tech.tani_otoshi` knee-injury flag, `tech.tomoe_nage` STR− and `tech.tai_otoshi`/foot-sweep
   own-balance bonuses, grip-exchange duration scaling by `massKg/70`.
9. **Cage**: the 0.55 fence share of takedowns (WRESTLING) vs 0.65 (BJJ_POSITIONS) — the engine derives it from
   geometry; the `cageRadius` scaling of TELE; stomp-only stalling still triggers the break timer.
10. **Multi-opponent** (§7): all numbers (0.7 rate, −1.0 dog-pile, 0.55 pull-off, ±0.3 assist) and the one-tick
    free rule.
11. **Tier tables**: T1 and T5 columns interpolated where the research gave three or four tiers (sprawl 0.35/0.90,
    reactive 5 %/60 %, cage use 25 %, energy 1.6×/1.5, retention 50 %/10 %, T5 stamina 0.85, T5 give-back 2 %);
    edge-availability gating per tier is a design choice derived from the behaviour rows.
12. **Control-time accrual for the bottom** never counts under Unified (design choice; judges do credit
    submission *attempts*, which §06 handles as effective grappling).
13. **Research-level caveats inherited**: no public per-technique TD data with sample sizes; no MMA per-position
    transition data (all ground dwell/pass/sweep/escape rates are calibrated estimates anchored on lower-belt
    BJJ, elite no-gi Markov data, ADCC counts and MMA time-share); cage-vs-open-mat rates are calibrated so the
    population lands at ≈ 40 % accuracy; time-to-stand-up curves and retention are estimates anchored on control
    per TD ≈ 80–100 s and 36–38 % ground time; referee stand-up timing is referee-specific
    `[S: WRESTLING §10] [S: BJJ_POSITIONS §10] [S: RULES_JUDGING §3.3]`.
14. **Playability vs realism**: (a) scramble k = 5.76/100 makes scrambles very skill-deterministic — realistic,
    but a `grap.scrambleLogitPerPt` slider is exposed; (b) the 0.03 floor keeps T0 vs T5 takedowns possible
    (realism says ≈ 0; playability keeps upsets alive); (c) referee timers default to the middle column;
    (d) heel hooks default on for MMA rulesets (legal), off for gi.
15. **Open questions for §01/§04/§06/§07**: final sub-skill names; `sub.*` id reconciliation; whether the
    judges' control-time accrual should include `pos.clinch_over_under` with head position (currently yes);
    whether the AI may choose `tech.disengage_stand` to reset a dangerous guard (yes, at a control cost);
    women's divisions (same rules, no class propensity scaling `[S: WRESTLING §10]`, possibly lower GnP dmg×
    `[S: BJJ_POSITIONS §10]`); ring rulesets (`fenceAvailable = false`: no wall walk, more sweeps, more
    referee restarts `[S: BJJ_POSITIONS §9.4]`).
