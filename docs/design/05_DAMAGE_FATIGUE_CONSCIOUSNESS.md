# 05 — Damage, Fatigue and Consciousness

Status: design v1 (2026-09-22). Binding conventions: `docs/design/00_CONVENTIONS.md`. Replaces the one-scalar
damage / one-pool stamina model described in `docs/AUDIT.md §1.1`.

Provenance tags per conventions §1: `[S: FILE §n]` sourced, `[D: …]` derived, `[E]` estimate. Research-file
short names used here: `DAMAGE` = `research/DAMAGE_PHYSIOLOGY.md`, `LIT_A` =
`research/LIT_A_performance_biomech_physio_injury.md`, `LIT_B` = `research/LIT_B_anthropometrics_predictors_expertise_tactics.md`,
`MT` = `research/MUAY_THAI_KICKBOXING.md`, `FD` = `research/FIGHT_DATA.md`, `SUBPHYS` =
`research/SUBMISSION_PHYSIOLOGY_DATA.md`, `BOX` = `research/BOXING.md`, `MMAI` = `research/MMA_INTEGRATION_STRATEGY.md`.
Where DAMAGE itself labels a number `ESTIMATE`, this section tags it `[E; DAMAGE §n]` — it is still an estimate
and is listed in §6.

---

## 1. Purpose and scope

This section owns everything that happens to a fighter's body and nervous system *after* a strike, throw, or
submission has been resolved, and everything that happens to their energy supply *while* they act:

1. **Damage** — six regional pools (head, body, lead leg, rear leg, arms, cuts) with acute/structural split,
   accumulation, decay, permanent fractions, thresholds and the states they trigger.
2. **Consciousness** — per-impact knockdown/knockout probability, the post-knockdown window, cumulative
   vulnerability, and the recovery curves.
3. **Fatigue** — three energy pools (phosphagen, glycolytic, aerobic), per-action costs, regeneration, round-break
   recovery, and the capability multipliers that every other section reads.
4. **Injury states** — dead leg, dead arm, broken hand/foot, swelling/eye closure, cuts, wind knocked out, liver
   collapse. Injury is abstract (no medical simulation); a state is a set of multipliers plus a presentation flag.
5. **Observable cues** — the boolean/scalar signals that the referee (§06), the AI (§07), the judges (§06) and
   the presentation layer read. Nobody outside this section reads a raw pool value.

Interfaces (by section number):

| Direction | Section | What crosses the boundary |
|---|---|---|
| in | §01 (fighter model) | attributes: `chinEff` (01 §2.4.3 — age- and KO-history-adjusted; every `chin` below means `chinEff` [REVIEW]), `neck` (01 `neckMult`), `bodyToughness` (`bodyToughnessThresholdMult`), `cardio`, `recovery` (`recoveryHalfLifeMult`), `strength`, `fightNightKg` (= `massKg` below), `age`, `bodyFatPct`, `composureEff`, `heart`, `discipline`; career: `kKOHistoryMult` (01 §2.4.3, = `historyMult` below), `experience` (01 §2.4.1 — replaces this section's `proFights/12` mapping [REVIEW]); energy composites `energy.pcrRefillHalfLifeS`, `energy.lactateClearance`, `energy.breakRefillFrac`, `energy.actionCostMult` (01 §2.7.5; the `aerobicRate` parameterisation below is the same curve to within 4 % over cardio 20–80 and 01's registry values are authoritative [REVIEW]); camp: `residualDehydration`, `acclimatised`; venue: `altitudeM`; ruleset: `gloveType`, round length/rest |
| in | §02 (striking resolution) | one `StrikeImpact` per landed strike (§2.1) |
| in | §03 (grappling) / §04 (submissions) | `StrikeImpact` for slams/throws (weapon `mat`), posture/position tags for energy costs, submission events (`sub.*` LOC / joint-failure — see §2.3.8) |
| out | §02 / §03 / §04 | capability multipliers (§2.5.5, §2.3.7): power, speed, accuracy, defence, TD/TDD, movement, kick power per leg, guard height per arm; `absorb` modifiers |
| out | §06 (referee/judges/doctor/corner) | `RefObservables` (§2.7, field names per §06 §2.3.1); knockdown/KO events; cut severity; doctor-check triggers; corner-retire inputs |
| out | §07 (AI) | hurt/tired signals (§2.8): own state and opponent-state estimates |
| out | presentation | state ids and severities; blood on/off; limp; mouth-open; wobble |
| both | §07 (multi-opponent) | `engagedBy`, swarm costs, split-attention defence penalty (§2.9) |

Not owned here: hit/miss resolution, force generation (§02), stoppage *decisions* (§06 — this section only
exposes the cues), between-round *decisions* by the corner (§07 — this section applies the physiological effect
of the break and of cutman work), career-mode persistence beyond the values named in §2.4.6.

Tick and determinism: all decay, regeneration and threshold checks run once per tick (dt = 0.1 s, conventions §2)
in the upkeep phase, before actions resolve; per-impact rolls run inside the action-resolution phase in ascending
fighter id order, drawing from the engine RNG in the fixed order listed in §2.10.

---

## 2. Model

### 2.1 Impact input contract (from §02 / §03)

Every landed strike (and every slam/throw with head or body contact) produces one `StrikeImpact` (the payload §02
§2.6.5 emits; §03 §5.1.1 strikes and §04 §2.6.6 slams emit the same shape), delivered to this section synchronously
in the resolution phase. [REVIEW: this is the merged contract agreed with §02; field names are §02's, the `defence`
enum, `posture`, `gloveType` enum and site names are this section's. `forceN` is **delivered** force on the Pierce
in-ring scale — placement is already applied upstream — so `cleanMult` is 1.0 for every impact that carries a
`placement` (see §2.2.1).]

```ts
interface StrikeImpact {
  tick: number; subTickMs: number;     // §09 subMs
  attacker: number; target: number;
  tech: string;                        // tech.* (§02 §2.2, §03 §5.1.1), 'slam' / 'throw' (§03/§04 landings)
  weapon: 'fist'|'backfist'|'hammerfist'|'elbow'|'elbow_point'|'knee'|'shin'|'instep'|'ball_of_foot'|'heel'
        |'shin_on_knee'|'head'|'mat';  // mapped here: backfist→fist, elbow_point→elbow, instep/ball_of_foot/heel→foot, shin_on_knee→shin
  region: 'head' | 'body' | 'leadLeg' | 'rearLeg' | 'arms';
  subLocation: HeadSite | BodySite | LegSite | ArmSite;   // = §02 `subLocation`; tables in §2.3 (`topback` = §02 "topback")
  placement: 'flush' | 'solid' | 'partial' | 'glancing';  // gates below written "contact = flush" read placement === 'flush'; 'solid' is not flush
  forceN: number;                      // DELIVERED force (§02 §2.6.4); F_del = forceN
  vRel: number; effMassKg: number;     // informational (§02); not used by v1 formulas
  absorb: number;                      // §02's defence-outcome absorb fraction (DP §3.3); used as absorbBase below
  defence: 'none' | 'block_forearm' | 'block_glove' | 'roll' | 'slip_late' | 'check' | 'knee_block' | 'catch';
  seen: boolean; counter: boolean; simultaneous: boolean;
  closingSpeedMs: number;              // relative velocity of target toward attacker, ≥ 0, m/s
  attackerState: { rocked: boolean; fatigue: number };        // fatigue = this section's f for the attacker
  targetState:   { midAction: boolean; mouthOpen: boolean; guardHand: 'up'|'away'; braced: boolean; grounded: boolean };
                                       // targetRelaxed = midAction || mouthOpen; targetBraced = braced; targetGrounded = grounded
  posture: 'distance' | 'clinch' | 'groundTop' | 'groundBottom' | 'wallPinned';   // attacker's posture at contact
  gloveType: 'mma4oz' | 'boxing8oz' | 'boxing10oz' | 'boxing12oz' | 'bare';
  rotProxy?: number;                   // optional rad/s² if §02 computes one; otherwise derived here (§2.2.2)
  selfDamage?: StrikeImpact;           // checked-kick shin (§2.3.3), hand/foot injury roll (§2.3.5)
}
```
`attackerMassKg` / `targetMassKg` are read from the fighter records (01 `fightNightKg`), not from the payload.

Expectations on §02 (calibration responsibilities shared with this section; see §5) [REVIEW: rewritten for the
delivered-force contract; the earlier "flush median 2,100 N rear straight" expectation was on a peak-force scale
that §02 never produces]:

- Delivered force `F_del = forceN` for landed **power head strikes at distance** must be approximately lognormal,
  median ≈ 1,100–1,150 N, σ_ln ≈ 0.45–0.5, so that ≈ 2–5 % of landed power punches exceed 2,000 N and the max sits
  near 5,000 N `[D: Pierce 2006 in-ring, median ≈ 950 N over all punches incl. jabs, 88 % < 1,500 N, 2–4 % ≥ 2,000 N,
  max 5,358 N — LIT_A §0.4; power subset shifted +20 % [E]]`. §02 §2.6.4 shows that its `F_med` (flush cross 1,400 N,
  hooks 1,500–1,600 N) × its placement mix (0.20/0.35/0.30/0.15 at ×1.00/0.75/0.45/0.25, `σ_F` 0.30) produces
  exactly this mixture (component medians ≈ 1,500 / 1,125 / 675 / 375 N; mixture median ≈ 1,100 N), which is the
  distribution the §2.4.1 Monte-Carlo was run on — the 2.3 % KD rate therefore holds with no change to `F_med`,
  `dmg.forceRef` or `dmg.rawScale`. Jabs: median ≈ 700 N, σ_ln 0.40 [E] (§02 `tech.jab` 900 N × placement).
- Kick/knee forces follow §02 Table B directly (rear body kick 1,600 N ≈ 1.15 × cross, knee 2,200 N ≈ 1.6 ×, teep
  1,500–1,900 N, elbow 1,400 N ≈ 1.0 ×) — replacing the earlier ratio expectations (kick 1.3 ×, knee 1.4 ×, teep
  0.7 ×, elbow 0.9 ×) [REVIEW: §02 owns the values; the §2.4.1 rows for kicks/knees/elbows must be re-run with
  §02's ratios in the C1–C3 batch].
- `seen = false` fraction for landed distance power head strikes ≈ 0.30 in R1 falling to ≈ 0.15 in R3 as fighters
  learn timing [E; needed to reproduce the KD-rate decay by round, FD #38 — see §5].

Every field is required except `rotProxy`. If `rotProxy` is present it replaces the derived `alphaEq` in §2.2.2
(§02 may compute one from an explicit head-kinematics model later; v1 does not).

### 2.2 Shared front end: delivered force, rotational equivalent, raw damage

#### 2.2.1 Contact and absorption

```
cleanMult   = impact.placement !== undefined ? 1.0                                       // §02 strikes: forceN is already delivered [REVIEW]
            : { flush: 1.0, partial: 0.5, glancing: 0.25 }[contact]                  // only for impacts built without a placement (legacy/ad-hoc) [E; DAMAGE §3.1]
absorbBase  = impact.absorb !== undefined ? impact.absorb                                // §02's defence-outcome fraction (blocked 0.45 MMA / 0.65 boxing, partial 0.45, glancing 0.6; BOX §3 D1) [REVIEW]
            : { none: 0, block_glove: 0.5, block_forearm: 0.5, roll: 0.6, slip_late: 0.6,
                check: 0.85, knee_block: 0.7, catch: 0.9 }[defence]                   // fallback table for §03/§04 impacts [E; DAMAGE §3.3; MT §3]
braceAbsorb = targetBraced ? 0.3 : 0                                                  [E; DAMAGE §3.3]
gloveBlockMult = { mma4oz: 0.7, bare: 0.6, boxing8oz: 1.0, boxing10oz: 1.0, boxing12oz: 1.1 }
                                                       // only applied to block_* absorb   [E; BOX §3 D1: 30–40 % less effective in MMA]
absorb      = clamp( max(absorbBase × (isBlock && impact.absorb === undefined ? gloveBlockMult : 1), braceAbsorb) × rockedAbsorbMult, 0, 0.95 )   // §02's absorb already includes the glove pass-through
rockedAbsorbMult = target in state.rocked or worse ? 0.5 : 1.0                        [E; DAMAGE §3.3]
F_del       = forceN × cleanMult
```

Absorbed energy is not lost: blocked head strikes route `absorb × 0.4 × raw` to the blocking arm (§2.3.4);
checked kicks route damage to the *kicker's* shin (§2.3.3).

#### 2.2.2 Rotational-acceleration equivalent (head impacts only)

```
alphaEq = ALPHA_REF × (F_del / F_REF) × kWeapon × kLever × kGlove × kUnseen × kBrace × kRelaxed × kClosing
          × kFatigue × kPrior × kGround × kCal
ALPHA_REF = 6,300 rad/s², F_REF = 3,400 N        [S: DAMAGE §3.1 — Walilko 2005 straight to jaw: 3,427 N → 6,343 rad/s²]
```

| Factor | Value | Tag |
|---|---|---|
| `kWeapon` fist straight / uppercut / hook-overhand | 1.00 / 1.05 / 1.15 | straight `[S: DAMAGE §3.1]`; hook `[D: (9,306/6,343)/(4,405/3,427) = 1.14 — Viano 2005 vs Walilko 2005, LIT_A §2]`; uppercut [E] |
| `kWeapon` elbow | 1.15 | `[S: DAMAGE §3.1 "elbows ≈ hooks"]` |
| `kWeapon` knee | 1.20 | [E; DAMAGE §3.1 says 1.5× a hook in alphaEq — with knee force already ≈ 1.4 × straight from §02, the per-newton term is 1.2] |
| `kWeapon` shin (head kick) | 1.20 | [E; DAMAGE §3.1 1.5–2× hook; same reasoning; Fife 2013 130 g helmeted-headform kick is the only datum, LIT_A §2] |
| `kWeapon` foot (instep/heel) | 1.10 | [E] |
| `kWeapon` hammerfist | 0.60 | `[S: DAMAGE §3.1]` |
| `kWeapon` mat (slam/throw head contact) | 0.35 | [E; Lota 2022 judo throws 276–5,081 rad/s², mostly sub-threshold — LIT_A §4] |
| `kWeapon` head (clash) | 0.80 | [E] |
| `kLever` chin/jaw / temple-behind-ear / mid-face / forehead-crown / orbit / top-back | 1.30 / 1.20 / 0.80 / 0.70 / 0.80 / 0.70 | `[S: DAMAGE §3.1]` (orbit, top-back [E]) |
| `kGlove` mma4oz / bare / boxing8oz / 10oz / 12oz | 1.15 / 1.20 / 1.00 / 0.97 / 0.93 | direction `[S: LIT_A §2 Bartsch 2012 — padding cuts linear not rotational; MMA glove > boxing glove rotational dosage]`; magnitudes [E; LIT_A suggests ×1.1–1.2] |
| `kUnseen` | `seen ? 1.0 : 1.35` | `[S: DAMAGE §3.2 — Eckner 2014, Mihalik 2010; magnitude E]` |
| `kBrace` | = 01 `neckMult` = `1.15 − 0.30 × neck/100` (01's `neck` attribute, default `40 + 0.2 × strength` in the legacy importer) [REVIEW: was a `(0.6 × chin + 0.4 × strength)` blend; 01 §2.2.1 defines `neck` for exactly this factor and 04 `M_NECK` uses the same attribute] | form `[S: DAMAGE §3.2 — Collins 2014, −5 % odds per lb neck strength]` |
| `kRelaxed` | `targetRelaxed ? 1.2 : 1.0` | [E; DAMAGE §3.2] |
| `kClosing` | `1 + 0.5 × min(closingSpeedMs, 3) / 3` | [E; DAMAGE §3.2] |
| `kFatigue` | `1 + 0.25 × f_target` | [E; DAMAGE §3.2] |
| `kPrior` | `min(1 + 0.006 × head.structural, 1.6)` | [E; DAMAGE §2.1 — direction from Guskiewicz 2003 OR 3.0] |
| `kGround` | `targetGrounded ? 0.7 : 1.0` | [E; DAMAGE §3.2] |
| `kCal` | 1.0 | calibration scalar, §5 (registry `ko.alphaCal`) |

Attacker mass does **not** enter `alphaEq` beyond what §02 already puts into `forceN`: in-ring landed force is
uncorrelated with body mass (r = 0.22) `[S: LIT_A §0 Pierce 2006]`, and the knockdown rate per 100 head strikes is
nearly flat across men's classes (FLW 0.87, HW 0.92, LHW 1.20) `[S: FD §2.1 #37]`. The steep weight-class
gradient in *finishes* (KO/TKO per 100 head sig 0.44 FLW → 0.99 HW `[S: FD #54]`) is produced by the severity
split (§2.4.3) and by heavier follow-up damage (§2.2.3), not by more frequent drops.

#### 2.2.3 Raw damage (all regions)

```
massSev  = clamp((attackerMassKg / 77)^0.5, 0.8, 1.3)                          [E; 77 kg = pooled UFC male mean, FD]
raw      = 100 × (F_del / F_REF) × kWeaponDmg × massSev × (1 − absorb)          [E; DAMAGE §2 form]
kWeaponDmg: fist 1.0, hammerfist 0.8, elbow 1.1, knee 1.2, shin 1.2, foot 0.9, head 0.8, mat 0.6   [E]
```

So a flush T4 rear straight of 2,100 N by a 77 kg fighter with no absorption is `raw = 100 × 0.618 = 61.8`
before regional multipliers; the in-fight median power punch (1,150 N delivered) is `raw ≈ 34`. Regional
multipliers (§2.3) then split `raw` into acute and structural increments.

Toughness attributes scale the *acute* increment, never the structural one (tough fighters feel less, not
break less): `acuteMult = 1 − 0.004 × (attr − 50)` where `attr` = `chin` for head, `bodyToughness` for body,
legs and arms [E; ±20 % at 0/100]. Every acute increment is also multiplied by `massScaleTarget =
(targetMassKg / 77)^-0.25` [E; heavier bodies dissipate more; a 120 kg target takes ×0.90, a 57 kg target ×1.08].

### 2.3 Regional damage model

Each region carries two pools in 0–100 (clamped): **acute** (shock; drives states; decays in seconds) and
**structural** (tissue damage; drives long capability loss; decays only at round breaks, part permanent for the
bout) `[S: DAMAGE §2]`. Decay is exponential: `pool ← pool × 0.5^(dt / halfLife)` per tick, **only while the
region has not been hit in the current tick**; a hit in the last `reHitWindow` seconds lengthens the half-life
(head 8 → 20 s) [E; DAMAGE §2.1].

Structural bookkeeping: every structural increment `Δ` is split `permanent += pFrac × Δ`,
`recoverable += (1 − pFrac) × Δ`; `structural = permanent + recoverable`; round-break decay applies to
`recoverable` only. Between bouts (career layer, §01) both zero out.

Common per-region constants:

| Region | acute t½ (s) | acute t½ if re-hit within window (s) | reHitWindow (s) | structural break recovery | pFrac | Tag |
|---|---|---|---|---|---|---|
| head | 8 | 20 | 10 | 25 % of recoverable per 60-s break | 0.40 | [E; DAMAGE §2.1] |
| body | 12 | 20 | 10 | 15 % | 0.30 | [E; DAMAGE §2.2; pFrac E] |
| leadLeg / rearLeg (each sub-pool) | 20 | 30 | 15 | 10 % | 0.50 | [E; DAMAGE §2.3; MT §5.1 "1–2 points per minute of rest"] |
| arms (each side) | 15 | 25 | 10 | 20 % | 0.30 | [E] |

For non-60-s breaks (boxing 60 s, Muay Thai 120 s, foul pauses up to 300 s) the structural break recovery is
`1 − (1 − r60)^(breakSeconds / 60)` [D]; acute pools simply continue their in-round decay through the break
(at 8 s t½ the head acute pool clears to < 1 % of its value in 60 s [D: 0.5^7.5 = 0.0055]).

`recovery` attribute scales every acute half-life: `t½_eff = t½ × (1 − 0.003 × (recovery − 50))` [E; ±15 % at
0/100; DAMAGE §7.22 says ±30 % — halved because §2.6 also gives `recovery` the rocked-exit speed].

#### 2.3.1 Head

Sub-locations (`HeadSite`) and multipliers `[S: DAMAGE §2.1]` (orbit/top-back structural [E]):

| site | acuteMult | structuralMult | notes |
|---|---|---|---|
| `chin` (mandible) | 1.35 | 0.9 | KO hotspot; 53.9 % of KO blows `[S: DAMAGE §1 Hutchison 2014]` |
| `temple` (incl. behind ear / mastoid) | 1.25 | 1.0 | off-switch for hooks and head kicks |
| `midface` (nose/mouth) | 0.85 | 1.15 | nose break event (§2.3.6) |
| `forehead` (incl. crown) | 0.60 | 0.9 | attacker hand-injury risk (§2.3.5) |
| `orbit` (eye socket) | 0.80 | 1.30 | cut and swelling site (§2.3.6) |
| `topback` (legal parts of top/side of head) | 0.70 | 1.0 | |

```
head.acute      += raw × acuteMult(site) × acuteMultAttr(chin) × massScaleTarget × (targetGrounded ? 1.0 : 1.0)
head.structural += raw × structuralMult(site) × 0.35 × (targetGrounded ? 1.3 : 1.0)     [E; 0.35 = structural:acute ratio; ground ×1.3 DAMAGE §3.2]
```

Per-strike progressive vulnerability is `kPrior` in §2.2.2 (also applied to the acute increment: `× kPrior`).

Head thresholds and the states they trigger (acute pool, after increment) `[E; DAMAGE §2.1]`:

| Acute head range | State entered | Exit condition |
|---|---|---|
| 30–45 | `state.stunned` | acute < 25 |
| 45–65 | `state.rocked` (severity `rs = (acute − 45) / 20`, 0–1) | acute < 35 |
| 65–90 | `state.knockdown_hurt` (grounded, rocked 15–40 s) — only if the §2.4 roll did not already resolve the impact | acute < 35 (rocked exit); grounded portion ends when fighter chooses to rise and `t ≥ 1 s` |
| ≥ 90 | `state.ko` | fight over |

Single-impact outcomes from the §2.4 roll (`ko`, `knockdown_hurt`, `knockdown_flash`, `rocked`) override the
threshold mapping for that impact; the threshold mapping is what makes accumulation finish fights ("TKO by
accumulated damage" is a rocked fighter whose acute pool keeps climbing because each hit resets decay).

**Swelling / eye closure** (structural, per side): `swell[side] += 0.6 × raw × structuralMult` for hits to
`orbit` or `midface` on that side; decays 0 in-round, 10 % per break (cutman ice) [E]. `vision[side] =
1 − 0.6 × clamp((swell − 30) / 50, 0, 1)` [E]; `swell ≥ 70` → `state.eye_swollen_shut[side]` (matches §06
`eyeSwollenShut` = orbit structural ≥ 70 `[S: DAMAGE §5.2]`), `vision = 0.2`, doctor-check trigger (§2.7). Vision penalties feed defence/accuracy via §2.3.7.

**Nose break event**: on a `midface` hit with `raw ≥ 30`, `P = 0.02` [E; nose 10.4 % of MMA injuries, Bledsoe
2006 `[S: DAMAGE §6.2]`; ~3.6 % of UFC fighter-bouts incur a facial fracture `[S: LIT_A §4 Jones 2023]`]. Effect:
`state.nose_broken` — mouth breathing, aerobic refill ×0.92 for the rest of the bout [E], blood presentation on,
doctor-check trigger only if `head.structural ≥ 80` too (§2.7).

#### 2.3.2 Body

`BodySite`: `liver` (right side under ribs), `solar` (solar plexus/diaphragm), `ribs` (either side, floating
ribs), `spleen` (left), `sternum`, `abdomen`. One body pool (acute/structural) plus site-specific event rolls.

| site | acuteMult | structuralMult | event |
|---|---|---|---|
| `liver` | 1.3 | 1.0 | liver collapse roll (below) |
| `solar` | 1.2 | 0.8 | wind-knocked-out roll (below) |
| `ribs` | 1.0 | 1.2 | rib-fracture roll: `P = 0.01` per clean tier-4 kick/knee (`raw ≥ 45`) `[S: MT §5.3 — rib trauma ~1 % of athlete-injuries]` |
| `spleen` | 1.1 | 1.0 | — |
| `sternum` | 0.8 | 0.9 | — |
| `abdomen` | 0.9 | 0.8 | — |
(all multipliers [E; DAMAGE §2.2, MT §5.3])

```
body.acute      += raw × acuteMult × acuteMultAttr(bodyToughness) × massScaleTarget
body.structural += raw × structuralMult × 0.40                                   [E]
```

Anchors: a clean T2 shin body kick adds 8–14 structural `[S: MT §5.1 units]`; with `raw ≈ 30` for such a kick,
`0.40 × 30 × 1.0 = 12` [D] — consistent.

States `[E; DAMAGE §2.2; MT §5.3]`:

| Trigger | State | Duration | Effects |
|---|---|---|---|
| `body.acute ≥ 50` | `state.body_hurt` | until acute < 35 (typically 8–20 s) | guard drops to protect body: head exposure +30 % (defence −0.30 logit-equivalent, see §2.3.7), movement ×0.8, output ×0.7 |
| `body.structural ≥ 40` | `state.body_worn` (persistent) | rest of bout unless structural decays below 35 | opponent head-kick accuracy +0.10 `[S: MT §5.3]`, energy cost ×1.3 via §2.5.6 coupling |
| `body.structural ≥ 60` | `state.body_worn` severity 2 | — | fighter turns away from kicks, backs up, mouth-open presentation `[S: MT §5.3]`; §07 hook `bodyShotAvoidance` |
| liver hit, `contact = flush`, `raw × acuteMult ≥ 35` | **delayed** `state.body_collapse` | trigger after a delay `U(0.5, 3.0) s`; grounded, cannot rise for `U(5, 20) s` | cannot intelligently defend during the grounded window; referee cue `attemptingToRise = false` until the window ends |
| solar hit, flush, `raw ≥ 30` | `state.winded` | `U(3, 15) s` | output ×0.3, movement ×0.6, PCr refill 0 for the duration; recovers fully if not followed up |
| `body.acute ≥ 80` | `state.body_collapse` (immediate) | grounded `U(5, 20) s` | as above |
| `body.structural ≥ 80` | each further tier-4 body strike (`raw ≥ 45`) rolls `state.body_collapse` with `P = 0.25` | — | `[S: MT §5.3]` |

Liver-collapse probability is not a roll: the threshold is deterministic given `raw`, and `bodyToughness`
scales the threshold `35 × (1 + 0.005 × (bodyToughness − 50))` [E; ±25 % per DAMAGE §7.22 `painTolerance`].
Body finishes are always TKO/"KO by collapse", never `state.ko` `[S: DAMAGE §2.2 — Hutchison: all true KOs were
head impacts]`; target share of finishes 4–6 % [E; DAMAGE §2.2].

Body → cardio coupling is defined in §2.5.6.

#### 2.3.3 Lead leg and rear leg

Each leg carries four structural sub-pools — `thigh`, `calf`, `shin`, `knee` `[S: MT §5.1]` — plus one acute
pool per leg. Which leg is "lead" follows the fighter's current stance (§02 owns stance; a stance switch swaps
the labels, not the pools — pools are attached to `left`/`right` and looked up by stance).

`LegSite` → sub-pool and multipliers `[S: DAMAGE §2.3; MT §5.1]`:

| site | acuteMult | structural pool | structuralMult | event |
|---|---|---|---|---|
| `thigh_outer` / `thigh_inner` | 1.0 | `thigh` | 1.0 | — |
| `calf` | 0.8 | `calf` | 1.5 | calf-shock roll (below) |
| `shin` (kicker's own, via check) | 0.5 | `shin` | 1.0 | fracture roll (below) |
| `knee` (oblique kick) | 0.6 | `knee` | 1.0 | acute knee event `P = 0.05` per clean landing → movement ×0.8 and TD entries −0.15 for the bout `[S: MT §8.9]` |

```
leg.acute             += raw × acuteMult × acuteMultAttr(bodyToughness) × massScaleTarget
leg.<pool>.structural += raw × structuralMult × 0.40                                    [E]
```

Anchor: a clean T2 rear low kick adds 8–12 `thigh`, a calf kick 10–14 `calf` `[S: MT §5.1]`; with `raw ≈ 25` for
a T2 low kick, `0.40 × 25 × 1.0 = 10` thigh and `0.40 × 25 × 1.5 = 15` calf [D] — the calf figure is at the top
of the MT band, which is intended (4-oz MMA meta).

**Calf-shock ("dead leg") roll**, per clean calf landing: `P = 0.08 + 0.02 × cleanCalfHitsSoFar` capped at 0.18
`[S: MT §5.1]`; DAMAGE §2.3 gives a flat 5 % foot-drop — MT's rising form is used because it reproduces the
"5–10 clean calf kicks → stance switch" observation. On success: `state.dead_leg` for `U(15, 30) s` [E; MT 15 s,
DAMAGE 30–90 s; the shorter MT window is used, the longer effect coming from the structural pool]:
movement ×0.7, check speed ×0.5, kick power from that leg ×0.6, TDD ×0.75 [E; MT §5.1].

**Leg mobility** (per leg) from structural pools `[S: DAMAGE §2.3 curve; MT §5.1 thresholds]`:

```
legLoad     = max(thigh, calf × 1.1, knee × 1.2)                          [E; calf/knee bite harder per point]
mobility    = 1 − 0.7 × (legLoad / 100)^1.5                                [S: DAMAGE §2.3]
kickPower   = 1 − 0.5 × (legLoad / 100)^1.2                                [E; MT §5.1 0.9/0.75/0.5 bands]
checkSpeed  = 1 − 0.5 × (legLoad / 100)^1.3                                [E; MT §5.1]
tddLeg      = 1 − 0.45 × (legLoad / 100)^1.2                               [E; MT §5.1 0.92/0.80/0.60]
```

Combined movement multiplier: `moveMult = 0.7 × min(mobL, mobR) + 0.3 × max(mobL, mobR)` `[S: DAMAGE §2.3
"worse leg at 70 % weight"]`. Rear-hand power multiplier from the rear leg: `1 − 0.2 × clamp((rearLegLoad − 40)/30, 0, 1)`
`[S: DAMAGE §2.3 threshold 55 → −20 %; smoothing E]`. Fighter-level TDD multiplier from legs: `min(tddLeg_L, tddLeg_R)`.

Leg states (structural `legLoad` of the worse leg) `[S: DAMAGE §2.3 thresholds; MT §5.1 behaviour]`:

| legLoad | State | Visible / behavioural |
|---|---|---|
| 30–55 | `state.leg_compromised` sev 1 | starts checking/switching stance; lead-leg check/kick output −20 %, power −10 % (already in the curves) |
| 55–75 | sev 2 | stops planting, switches stance (§07 hook `legDamageStanceSwitch`), TDD −25 %, rear-hand −20 % |
| 75–85 | sev 3 | limps, flat-footed, cannot chase (movement ≤ 0.55 [D: 1 − 0.7 × 0.75^1.5 = 0.545]); referee cue `limp = true` |
| ≥ 85 or leg acute ≥ 70 | `state.leg_collapse` — each further clean kick to that leg rolls a fall with `P = 0.30` `[S: MT §8.22]`; a fallen fighter who cannot stand within 3 s sets referee cue `cannotStand` (the MMA TKO roll `P = 0.20` belongs to §06) | leg-kick TKO share target 1–2 % of finishes [E; DAMAGE §2.3] |

**Checked kick — damage to the kicker** `[S: MT §3.2, §5.2, §8.12; DAMAGE §2.3]`: when `defence = check` or
`knee_block`, the kicker receives an `StrikeImpact` on their own kicking leg, site `shin`, with
`forceN = 0.6 × original forceN`, `contact = flush`, `absorb = 0` (the defender takes 0–20 % of the original —
`absorb = 0.85` on the original event, §2.2.1). Shin structural increments: low kick checked +10–15, calf kick
checked +8, body kick on knee +8 / on elbow +5 `[S: MT §5.2]` — reproduced by the 0.6 × force route
[D: 0.40 × (0.6 × raw 40) × 1.0 ≈ 10]. Catastrophic shin fracture roll per fully checked rear kick at T3+
intensity (`forceN ≥ 1,800 N` [E]): `P = 0.002` `[S: MT §5.2 — two documented in ~30 years of UFC title fights]`
(DAMAGE §2.3 gives 0.3 %; MT's 0.2 % is used) → `state.limb_fracture` (fight over, TKO-injury via §06).

Kicker's `shin` pool effects `[S: MT §5.2]`: 26–50 → kick frequency ×0.8, kick power ×0.9; 51–75 → ×0.6 / ×0.8
and §07 hook `stopLowKicksThisLeg`; ≥ 76 → §07 hook `refuseKicksThisLeg`.

#### 2.3.4 Arms (guard, forearms, hands)

Per side (`left`/`right`), one acute and one structural pool. Sources: blocked head kicks/knees/elbows on the
forearm/biceps, and clinch elbows.

```
blocked head strike (defence = block_forearm|block_glove): arm.structural[side] += 0.4 × absorb × raw   [S: DAMAGE §2.4 40 %]
direct arm target (region = 'arms', e.g. kick into the guard):  arm.acute += raw × 0.6; arm.structural += raw × 0.35  [E]
```

**Dead arm** `state.dead_arm[side]` when `arm.structural[side] ≥ 50` `[S: DAMAGE §2.4]`: that side's guard
height ×0.75, punch power ×0.8, minimum 60 s, exits when structural < 40 (in practice at a later break) [E].
Presentation: hand carried low. §07 hook `guardSideCompromised`.

#### 2.3.5 Attacker self-injury: hands and feet (abstract)

Per landed **punch** by the attacker `[S: DAMAGE §2.4]` (rates anchored on hand injuries = 13.5 % of MMA
injuries, Bledsoe 2006; 347/1,000 h in elite boxing, Loosemore 2017):

| Target | P(hand injury) per landed punch | Tag |
|---|---|---|
| `forehead`, `topback`, `temple` (skull) | 0.0015 × gloveHandMult | [E; DAMAGE §2.4] |
| `chin`, `midface`, `orbit`, body | 0.0004 × gloveHandMult | [E; DAMAGE §2.4] |
| hammerfist / elbow (any) | 0.0002 | [E; DAMAGE §2.4] |
| `gloveHandMult` mma4oz 1.0 / bare 2.5 / boxing 0.6 | | [E] |

Per landed **kick** on an elbow or knee (defence `knee_block`, or region `arms` with weapon `foot`): `P = 0.003`
foot injury `[S: DAMAGE §2.4]`.

`state.hand_injured[side]`: that hand's power ×0.65 and §07 hook `handUseFrequency ×0.5` `[S: DAMAGE §2.4]`;
`state.foot_injured[side]`: kicks from that leg power ×0.6, frequency ×0.4 [E]. Both persist for the bout.
Expected incidence: ≈ 45 landed head punches per fighter-bout [D: FD #51 26 head sig + non-sig], ≈ 30 % on the
skull zone → `45 × (0.3 × 0.0015 + 0.7 × 0.0004) ≈ 3.3 %` of fighter-bouts [D] — top of the DAMAGE 1–3 % band;
`gloveHandMult` is the tuning knob. Winner injuries skew to hand fractures `[S: LIT_A §4 Ross 2021 — winners 19 %
fractures, mostly hand]`.

#### 2.3.6 Cuts

A per-fighter list of `Cut { site, severity 1–3, bleedRate, cleanHitsSinceOpen, openedTick }`. Sites: `brow_L`,
`brow_R`, `eyelid_L`, `eyelid_R`, `nose_bridge`, `cheek_L`, `cheek_R`, `scalp`, `lip` `[S: DAMAGE §2.5]`.

Cut probability per **clean** (`contact = flush`) head landing, by weapon and head zone:

| weapon | to brow zone (`orbit` site → brow/eyelid) | other head sites | Tag |
|---|---|---|---|
| elbow, horizontal/diagonal | 0.12 | 0.06 | MT §5.4 gives 0.12 horizontal, 0.18 downward, 0.08 upward, 0.15 spinning; DAMAGE §2.5 gives 0.06 flat — MT values used for the brow zone, DAMAGE elsewhere; zone split [E] |
| elbow, downward (12-6 legal in MMA-unified since Nov 2024 `[S: RULES_JUDGING]`) | 0.18 | 0.08 | `[S: MT §5.4]` |
| elbow, upward | 0.08 | 0.04 | `[S: MT §5.4]` |
| fist, mma4oz | 0.012 | 0.004 | [E; DAMAGE §2.5] |
| fist, boxing gloves | 0.008 | 0.003 | [E; boxing cut hazard ≈ 1.7 % per boxer-round, LIT_A §4 Bledsoe 2005] |
| fist, bare | 0.025 | 0.008 | [E] |
| knee | 0.03 | 0.015 | [E; DAMAGE §2.5] |
| head clash | 0.08 | 0.04 | [E; DAMAGE §2.5] |
| shin/foot | 0.02 | 0.01 | [E] |

Multiply by `cutProneness = 1 + 0.01 × priorCutsCareer` (career layer, cap 1.5) [E] and by
`(1 + 0.005 × head.structural)` [E; swollen tissue splits more easily].

Severity on creation: 1/2/3 with weights 0.60/0.30/0.10 `[S: DAMAGE §2.5]`; elbows shift to 0.45/0.35/0.20 [E].
Growth: `+1` severity per 5 further clean strikes on that site (cap 3) `[S: DAMAGE §2.5]`. `bleedRate` =
severity (presentation, plus the doctor criterion below).

Effects `[S: DAMAGE §2.5]`: brow/eyelid cuts of severity ≥ 2 → `vision[side] × 0.75`; severity 3 → `× 0.5`
(compounds with swelling, floor 0.2). Vision feeds §2.3.7. Blood is presentation only: `bloodVisible = any cut
with severity ≥ 2, or severity 1 opened in the last 120 s` [E].

Cutman at each break: worst cut `severity −1` (never below 1), `cleanHitsSinceOpen = 0`; the treated cut
re-opens (severity restored) on the next 2 clean strikes to that site `[S: DAMAGE §2.5]`.

Doctor-check triggers (exposed to §06, which decides): any severity 3; severity ≥ 2 on an eyelid; blood in eye
(brow/eyelid severity ≥ 2) for > 60 s of fight time; eye swollen shut; `state.nose_broken` with
`head.structural ≥ 80` `[S: DAMAGE §5.2]`. Targets: 12 % of fighter-bouts incur a cut `[S: LIT_A §4 Jones 2023]`;
doctor stoppages 0.8–1.1 % of fights `[S: FD #109]`.

#### 2.3.7 Capability multipliers exported from damage (read by §02/§03/§04/§07)

All multipliers are products over active states; the table gives each state's contribution. Defence and
accuracy multipliers apply to the fighter's *effective attribute*, which §02 converts into its skill-gap term;
the equivalent logit shift at the T4 reference is `[D: with k_skill ≈ 2 logit per 100 points, a ×0.65 on a
75-point attribute is −26 points ≈ −0.5 logit]`.

| State (id) | movement | defence (guard/head-mvt) | accuracy | power | speed | decision quality | TDD | output rate | other |
|---|---|---|---|---|---|---|---|---|---|
| `state.stunned` | 1.0 | 0.90 | 0.90 | 1.0 | reaction latency +15 % | 0.95 | 0.95 | 1.0 | 2–6 s [E; DAMAGE §2.1] |
| `state.rocked` (sev `rs` 0–1) | 0.6 − 0.1 rs | 0.65 − 0.15 rs | 0.75 | 0.85 | 0.9 | 0.6 − 0.2 rs | 0.70 | 0.9 | absorb ×0.5; "fights on instinct" hooks §2.8 `[S: DAMAGE §2.1 values at rs = 0]` |
| `state.knockdown_flash` | grounded 1–3 s, then rocked 5–15 s | as rocked | as rocked | as rocked | as rocked | as rocked | — | — | [E; DAMAGE §2.1] |
| `state.knockdown_hurt` | grounded ≥ 1 s; rocked 15–40 s | 0.5 | 0.7 | 0.8 | 0.85 | 0.4 | 0.5 | 0.7 | [E; DAMAGE §2.1] |
| `state.ko` | 0 | 0 | — | — | — | — | — | — | unconscious `U(5, 90) s` [E; DAMAGE §2.1] |
| `state.body_hurt` | 0.8 | head 0.75 (guard drops) | 0.9 | 0.9 | 1.0 | 0.9 | 0.9 | 0.7 | [E; DAMAGE §2.2] |
| `state.winded` | 0.6 | 0.7 | 0.8 | 0.7 | 0.9 | 0.8 | 0.6 | 0.3 | 3–15 s [E] |
| `state.body_collapse` | 0 (grounded) | 0.3 | — | — | — | 0.3 | — | 0 | 5–20 s [E] |
| `state.dead_leg` | 0.7 | 1.0 | 1.0 | kick from leg 0.6 | 1.0 | 1.0 | 0.75 | 1.0 | 15–30 s [E] |
| `state.leg_compromised` sev 1/2/3 | via mobility curve | 1.0 | 1.0 | via curves | 1.0 | 1.0 | via curve | kicks 0.8 / 0.6 / 0.4 [E] | persistent |
| `state.dead_arm[side]` | 1.0 | side 0.75 | 1.0 | side 0.8 | 1.0 | 1.0 | 1.0 | 1.0 | ≥ 60 s [E] |
| `state.hand_injured[side]` | 1.0 | 1.0 | 1.0 | side 0.65 | 1.0 | 1.0 | 1.0 | side 0.5 | bout [E] |
| vision (`vAvg = mean(vision_L, vision_R)`) | 1.0 | `0.6 + 0.4 × vAvg` | `0.7 + 0.3 × vAvg` | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | `[S: DAMAGE §2.5 −10/−25/−50 % bands]`; strikes from the blind side get `seen = false` in §02 [E] |

Multipliers compose multiplicatively with the fatigue multipliers of §2.5.5; the composed vector is published
once per tick as `caps: CapabilityMultipliers` on the fighter state.

#### 2.3.8 Submission-derived injury states (definitions only; §04 owns the mechanics)

§04 emits `SubmissionOutcome { type: 'tap' | 'loc' | 'joint_failure', sub, holdAfterLocS }`. This section
defines the resulting states so the referee and career layer see one vocabulary [REVIEW: §04's draft ids
`state.unconscious` / `state.injured_limb` / `state.neck_strain` are aliased to `state.choked_out` /
`state.joint_failure` / `state.neck_cranked` below; §04 §0.3 records the alias]:

- `state.choked_out` (LOC): unconscious `U(2, 5) s` after prompt release, `U(10, 20) s` if held ≥ 4 s past LOC
  (with convulsion presentation, 61.5 % `[S: SUBPHYS §1 Sasaki 2022]`); coherent within 1–2 min
  `[S: SUBPHYS §1 Mitchell 2012, Koiwai 1987]`. Fight over (technical submission, §06). 11 % of fight-ending
  chokes reach LOC `[S: SUBPHYS §1 Stellpflug 2022]` — that ratio is §04's (tap latency) calibration.
- `state.joint_failure[joint]` (refused tap): elbow (armbar: UCL + flexor tendon rupture `[S: SUBPHYS §2 Almeida
  2017]`), shoulder (kimura), knee (heel hook: ACL/PCL/MCL; 41 % never returned `[S: SUBPHYS §2 Hinz 2021]`),
  ankle. In-bout effect: limb unusable (power 0, guard side 0, TDD ×0.5 for a leg), referee cue
  `injuryFlag = 'fracture'`; the fight normally ends here (§06 technical submission).
- `state.neck_cranked`: forces comparable to whiplash `[S: SUBPHYS §1 Kochhar 2005]`; in-bout effect
  `kBrace × 1.1` for the rest of the bout [E]; no stoppage on its own.

### 2.4 Knockdown / knockout model

#### 2.4.1 Per-impact concussive-event probability

For every head `StrikeImpact` with `F_del > 0`, after `alphaEq` (§2.2.2):

```
z        = (alphaEq − ALPHA_50) / ALPHA_SCALE
           − 0.02 × (chinEff − 50)                   // 01 chinEff 0–100 (age + KO history already inside, 01 §2.4.3); ±1.0 z at 0/100 [REVIEW]
           + 3 × residualDehydration                 // fraction of body mass still down at fight time, 0–0.05
pConcuss = sigmoid(z)
ALPHA_50 = 8,500 rad/s², ALPHA_SCALE = 1,000 rad/s²
```

Provenance of the curve. DAMAGE §3.2 proposes `(alphaEq − 6,383)/1,800` from Rowson 2012's rotation-only 50 %
point. That form has an unphysical floor (`sigmoid(−3.55) = 2.8 %` at zero force) and, run through the in-fight
force distribution of §2.1, produces ≈ 10 % knockdowns per landed power head strike — 2.5–5× the FD target
(§5). We therefore use the **combined** Rowson & Duma 2013 logistic
`CP = sigmoid(−10.2 + 0.0433·a + 0.000873·α − 9.2e-7·a·α)` `[S: LIT_A §4]`, collapsed onto the punch regime
with the boxing linear:rotational ratio `a ≈ 0.0085 × α` g per rad/s² `[D: mean of Walilko 58 g/6,343 and
Viano 71 g/9,306]`, which gives `CP(6,343) ≈ 0.07`, `CP(9,306) ≈ 0.66`, `CP(4,000) ≈ 0.005`, `CP(11,000) ≈
0.92` [D]. A single logistic with midpoint 8,500 and scale 1,000 reproduces those four points within ±0.03 [D]
and matches the Lota 2022 combat-sport means (concussive MMA impacts ≈ 7,560; boxing LOC punches 11,280 vs
6,146 non-LOC) `[S: LIT_A §4]`. Chin slope `[E; DAMAGE §3.2 — "0.9-chin needs ~+1,450 rad/s² more"]`;
dehydration slope `[E; DAMAGE §3.2, §4.7]`.

Monte-Carlo check of the pipeline (§2.1 force distribution, §2.2.2 factor mix: hooks 45 % / straights 40 % /
uppercuts 15 %; sites chin 30 / temple 20 / midface 25 / forehead 20 / orbit 5 %; unseen 25 %; relaxed 30 %;
glove mma4oz; chin ~ N(50, 15)) gives, per landed strike [D; 4×10⁵ samples, `scripts/` to reproduce in Phase 9]:

| Landed strike class | pConcuss | P(drop) = 0.55 pConcuss | P(KO) = 0.20 pConcuss |
|---|---|---|---|
| distance power head punch, pooled | 4.2 % | 2.3 % | 0.8 % |
| same, R1 mix (unseen 35 %, relaxed 35 %) | 4.8 % | 2.7 % | 1.0 % |
| same, R3 mix (F ×0.85, fatigue ×1.15, unseen 15 %) | 3.4 % | 1.8 % | 0.7 % |
| jab (median 700 N, straight only, unseen 15 %) | 0.3 % | 0.17 % | 0.06 % |
| clinch power head (F ×0.85, unseen 15 %, lever ×0.85) | 1.1 % | 0.6 % | 0.2 % |
| ground punch (F ×0.8, kGround 0.7, unseen 10 %) | 0.4 % | 0.2 % | 0.08 % |
| heavyweight (F ×1.2) | 7.5 % | 4.1 % | 1.5 % |
| flyweight (F ×0.85) | 2.4 % | 1.3 % | 0.5 % |
| women (F ×0.72) | 1.3 % | 0.7 % | 0.25 % |
| chin 80 / chin 20 target | 3.0 % / 5.7 % | 1.7 % / 3.1 % | 0.6 % / 1.1 % |
| head kick (F ×1.3, kWeapon 1.2, unseen 35 %) | 17 % | 9.5 % | 3.5 % |
| knee (F ×1.4, kWeapon 1.2, unseen 30 %) | 16 % | 9.1 % | 3.3 % |
| elbow (F ×0.9, kWeapon 1.15, unseen 30 %) | 3.9 % | 2.1 % | 0.8 % |

Weighted over the head-sig mix (distance 78 % of head sig landed, of which ≈ 60 % power / 40 % jab [E];
clinch 11 %; ground 11 % `[S: FD #22]`) this is ≈ 1.1 knockdowns per 100 head sig strikes [D] against the
target 0.82 ± 0.2 `[S: FD #37]`, and ≈ 2.3 % per landed distance power head strike against Fightnomics' 3.9 %
`[S: FD #36]` — the two FD targets are in mild tension (different eras and "power" definitions; see §5), and the
pipeline sits between them. `ko.alphaCal` is the single knob for moving both together.

#### 2.4.2 Outcome split given a concussive event

One uniform draw `u` after `pConcuss` succeeds:

```
kKO       = 0.20 × massSevKO × historyMult × (1 + 0.4 × f_target)               // fraction of concussive events that are LOC   [REVIEW: ageMult removed — see below]
massSevKO = clamp((attackerMassKg / 77)^0.8, 0.6, 1.5)                            [E]
outcome   = u < kKO                      → state.ko
            u < kKO + 0.10 × sevBoost    → state.knockdown_hurt
            u < kKO + 0.10 × sevBoost + 0.25 → state.knockdown_flash
            else                         → state.rocked (rs = 1.0)
sevBoost  = massSevKO                                                              [E]
```

`kKO` baseline 0.20 `[E; DAMAGE §3.2 gives 0.22 as "the least-supported constant in the model"]`; split
rocked 45 / flash 25 / hurt 8–10 / KO 20–22 `[E; DAMAGE §3.2]` — DAMAGE's residual 22 % "nothing visible" is
folded into `state.rocked` because sub-concussive stuns already arise from the acute pool (§2.3.1). Fatigue
term on `kKO` [E]: tired fighters drop *and stay down* more; keeps the per-strike drop rate modest as DAMAGE
recommends (Hutchison found earlier rounds carry higher KO risk `[S: DAMAGE §1]`).

The mass term makes the weight-class gradient appear in *severity*: HW (120 kg) `massSevKO = 1.43` → `kKO ≈
0.29`, FLW (57 kg) → 0.79 → `kKO ≈ 0.16` [D]. Combined with heavier follow-up damage (§2.2.3) this drives
KD-fight → KO/TKO conversion from 53 % (FLW) to 84 % (HW) `[S: FD #41]` — §5 calibration target.

Career and age multipliers (`[S: DAMAGE §3.2 — Hutchison 2014 risk factors; Guskiewicz 2003 OR 3.0]`, slopes [E]):

```
historyMult = 01 kKOHistoryMult = 1 + 0.25 × min(koLosses, 4)
ageMult     = 1.0   [REVIEW: removed. 01 §2.2.2 owns the single age term (the chin curve −1.75 pts/yr 25–30, −2.5 pts/yr 30–40,
                     attenuated ×0.6) and states "05 must not add its own age multiplier on kKO"; the DP §3.2 +4 %/+8 %/yr row
                     this multiplier encoded is subsumed by that curve. Calibration hook C-4 (01) / C27 (here) tunes `fm.age.chin.*`.]
```

Cross-check against FD: KO-loss rate <25 ≈ 10 % vs 37+ ≈ 25 % `[S: FD #119]`; with the age term living in 01's
`chinEff` (a 37-year-old loses 26 chin points → +0.52 z on every impact [D: 01 §2.2.2]) plus `historyMult` and the
structural/chin career decay (§2.4.6), the gradient is produced jointly with 01 (FD: strikes-per-knockdown-absorbed
falls to one third from early 20s to 40s); if C27 under-produces it, 01's `fm.age.chin.attenuation` (0.6) is the
lever, not a second age multiplier here [REVIEW]. Never-dropped 14 % vs 5+ career KDs 25 % `[S: FD #119]` ↔ `historyMult(2) = 1.5`
[D] — consistent in direction.

#### 2.4.3 Applying the outcome

On the same tick, in this order:

1. Acute head pool increment (§2.3.1) is applied first; `kPrior` uses the pre-impact structural value.
2. If the outcome is `state.ko`: `head.acute = max(acute, 90)`; fighter drops; `unconsciousS ~ U(5, 90)`
   `[E; DAMAGE §2.1]`; referee cue `ko = true`. The fight is over as soon as §06 processes it, but the engine
   keeps stepping so that the post-KO window (§2.4.4) is recorded (broadcast realism and the Hutchison follow-up
   stats).
3. `state.knockdown_hurt`: `head.acute = max(acute, 70)`; grounded; `riseAllowedAfterS ~ U(1, 3)`; rocked
   persists `U(15, 40) s` [E; DAMAGE §2.1] — implemented as: acute decay is *frozen* for `freezeS ~ U(10, 25)` s
   [E] after the drop, then the normal 8-s half-life resumes (a hurt fighter's legs come back slowly).
4. `state.knockdown_flash`: `head.acute = max(acute, 55)`; grounded `U(1, 3)` s (the fighter can rise at once);
   residual rocked `U(5, 15)` s [E; DAMAGE §2.1] via the normal decay.
5. `state.rocked` (from the roll): `head.acute = max(acute, 50)`.
6. Threshold mapping (§2.3.1) is re-evaluated on the final acute value; it can only raise severity, never lower it.
7. Emit `KnockdownEvent { tick, targetId, kind, causeTechId, site }` for §06 (judging: knockdown AME +0.238
   `[S: LIT_B §6 Holmes 2022]`), §07 and presentation.

Knockdowns from non-head causes (leg collapse §2.3.3, body collapse §2.3.2, being thrown §03) emit the same
event with `kind` set accordingly; judges treat leg-kick falls as knockdowns only under rulesets that count
them `[S: MT §9]` — §06's concern.

#### 2.4.4 Post-knockdown window and follow-up

Unified Rules MMA has no count `[S: DAMAGE §5.1]`; the window is the referee's positioning delay plus the
"intelligent defence" judgement (§06). This section supplies the physics of that window:

- While grounded after a knockdown the target's `absorb` is halved (rocked) and `kGround = 0.7` applies to
  `alphaEq` but `× 1.3` to structural head increments `[S: DAMAGE §3.2]` — ground finishes accumulate rather than
  flash.
- Each further landed head strike during `state.rocked`/`knockdown_*` resets the acute decay timer and adds
  damage normally `[S: DAMAGE §3.4]`; the acute pool crossing 90 produces `state.ko` by threshold (a
  "TKO-that-was-really-a-KO"; the referee cue distinguishes `ko` from `defenceless`).
- Follow-up strike volume and target selection are §07's (D-3 finisher logic in MMAI §7.5); the *expected*
  values this section is calibrated against: after a KO blow, 2.6 (0–20) extra head strikes and 3.5 s (0–20)
  to stoppage `[S: FD #49, #110]`; before a TKO, 18.5 (5–46) strikes in the final 30 s, 92 % to the head
  `[S: FD #48]`.
- Target conversions: 57 % of knockdown events end in a same-round KO/TKO by the scorer `[S: FD #40]`; 65 % of
  fights with ≥ 1 KD end KO/TKO `[S: FD #39]`; the fighter scoring a KD wins 86 % `[S: FD #42]`. Levers, in
  order of preference: `kd.hurtFreezeS` (how long the legs stay gone), `ko.kKO`, §06's unanswered-strike
  thresholds, §07's finisher aggression. DAMAGE §5.1 predicts 55–65 % with its defaults; 57 % is the FD point.

#### 2.4.5 Cumulative vulnerability within a fight

Three mechanisms, all already defined above, and no separate "damage bar":

1. `kPrior = 1 + 0.006 × head.structural` (cap 1.6) on `alphaEq` and on acute increments (§2.2.2, §2.3.1).
2. Non-decaying `permanent` structural fraction (40 % of head increments, §2.3).
3. The acute pool's re-hit half-life extension (8 → 20 s) — sustained pressure keeps a fighter in
   `state.stunned`/`rocked` where absorb is halved and defence degraded, which is what turns "hurt" into
   "finished" without any single big shot (the TKO path). Expect KO/TKO losers to absorb a median 6 (mean 11)
   head sig strikes before the stoppage `[S: FD #46]`.

#### 2.4.6 Career layer (values this section writes; §01 stores)

On `state.ko` or a head-strike TKO: `priorKOs += 1`; `chin −= 3` permanently `[E; DAMAGE §7.21 — 0.03 on a
0–1 scale]`; on `state.choked_out`: no chin change [E; SUBPHYS §1 — no lasting neuropsych effect from single
sportive LOC]. Cumulative exposure lowers processing speed (Bernick 2015 `[S: DAMAGE §1]`): the §01 age curve
should subtract from `reactionTime` per 100 career fight-minutes; this section does not own the slope.

### 2.5 Fatigue / energy model

Three compartments per fighter `[S: DAMAGE §4.1]`. The one-pool `stamina` of the current engine is removed.

| Pool | State variable | Range | What it represents |
|---|---|---|---|
| Phosphagen (PCr, alactic) | `pcr` | 0–100 (100 = fresh) | burst capacity: power strikes, shots, sprawls, scrambles, squeezes |
| Glycolytic (lactate-like) | `lac` | 1–22 mmol/L (rest 1.0) | acidosis that never meaningfully clears within a bout; lowers the PCr ceiling |
| Aerobic | `aer` (debt, 0–1) + attribute `aerobicRate` | 0–1 | how fast PCr refills and lactate clears; "heart-rate reserve" |

`aerobicRate = (1 + 0.008 × (cardio − 50)) × dehydMult × altMult × noseMult × bodyMult` [E; ±40 % at 0/100
cardio; the multipliers are defined in §2.5.6–§2.5.8]. Heavyweights get a lower `cardio` prior at generation
(§01): −10–15 % aerobic power `[S: LIT_A §3 Franchini 2011]`.

#### 2.5.1 Per-action costs

Costs are charged when an action *commits* (strike launch, shot launch) or per second for sustained postures.
Base values `[E; DAMAGE §4.2 — "one 5-min round of average activity ≈ 100 PCr-units"; direction of grappling
costs from Del Vecchio 2011 E:P 1:2–1:4]`:

| Action class (`techClass`, assigned by §02/§03/§04 per technique) | PCr cost | lactate (mmol/L) | Notes |
|---|---|---|---|
| `light_strike` (jab, teep, light kick, feint) | 0.8 | 0.05 | feints 0.4 / 0.02 [E] |
| `power_strike` (cross, hook, uppercut, overhand, body/low kick, knee, elbow) | 2.5 | 0.15 | |
| `heavy_strike` (head kick, spinning, flying knee) | 3.5 | 0.20 | |
| `flurry` (≥ 4 strikes within 2 s, charged on top of the per-strike costs) | +2.0 | +0.30 | [D: DAMAGE 12 / 0.9 for a 5-strike flurry minus 5 × 2.5 / 0.15 ≈ −0.5 / +0.15; rounded up because the burst tax is real] |
| `takedown_attempt` (shot, trip, throw entry) | 10 | 0.8 | failed costs the same |
| `sprawl` / TD defence | 6 | 0.5 | |
| `clinch_pummel` per 10 s | 5 | 0.6 | isometric |
| `clinch_hold_dominant` per 10 s | 3 | 0.35 | [E; cheaper than pummelling] |
| `wall_pinned` (pressed on the cage, defending) per 10 s | 4 | 0.55 | [E; between bottom and pummel] |
| `wall_pinning` (pressing) per 10 s | 3 | 0.4 | [E] |
| `wall_walk` / stand-up attempt from bottom | 8 | 0.7 | per attempt |
| `ground_bottom_pressured` per 10 s | 3 | 0.5 | frames + breathing under weight |
| `ground_bottom_active` (guard attacks, hip escapes) per 10 s | 5 | 0.6 | [E] |
| `ground_top_hold` per 10 s | 2 | 0.25 | |
| `ground_top_pass_attempt` per attempt | 4 | 0.4 | [E] |
| `gnp_strike` per strike | 1.5 | 0.1 | |
| `submission_squeeze` per 10 s | 9 | 0.9 | |
| `submission_escape` per 10 s | 8 | 0.8 | |
| `scramble` per second | 1.2 | 0.1 | [E; explosive transitions] |
| `movement_high_pace` per second | 0.4 | 0.03 | footwork above 60 % of max speed |
| `movement_low_pace` per second | 0.1 | 0.01 | [E] |
| `idle_standing` per second | 0.05 | 0.005 | [E] |
| `survival_tax` (on entering `state.rocked` or `knockdown_*`) | 4 flat | 0.4 | adrenaline, flailing |
| `swarm_tax` (multi-opponent, §2.9) | see §2.9 | | |

Modifiers on every cost:

```
skillCostMult   = striking classes: 1 − 0.003 × (relevantSubSkill − 50)   // ±15 % [E; LIT_A §3 Folhes 2023: RPE per action inversely with level]
                  grappling classes (takedown_attempt … submission_escape, scramble, wall_*): 01 `energy.actionCostMult` (1.6 / 1.3 / 1.1 / 1.1 / 1.0 / 0.9 by grappling tier, [S: BJJ §6]) instead   [REVIEW: 01 and 03 both carried this tier multiplier; it applies here, once]
bodyCostMult    = 1 + 0.004 × body.structural                       // +4 % per 10 points [E; DAMAGE §2.2]
bodyShotMult    = 1.10 while `bodyShotTaxUntil` > now (60 s after a body hit with raw ≥ 35)   [E; DAMAGE §4.2]
dumpCostMult    = 1 + 0.6 × dump (§2.5.7)
altLacMult      = 1 + 0.10 × max(0, altitudeM − 500)/1000 × (acclimatised ? 0.5 : 1)    (lactate only)  [E; DAMAGE §4.8]
weightCostMult  = (massKg / 77)^0.15                                  // heavier bodies cost more per action [E; LIT_A §3 Folhes: HW higher HR after R1]
pcrCost = base × skillCostMult × bodyCostMult × bodyShotMult × dumpCostMult × weightCostMult
lacAdd  = baseLac × (same) × altLacMult
```

If `pcr` would go below 0, the action still executes but the shortfall is charged as extra lactate
(`+0.05 mmol/L per unit shortfall` [E]) and the action's power/speed multipliers use `pcr = 0`.

#### 2.5.2 Regeneration in-round

Per tick, PCr refills toward its ceiling when the fighter's instantaneous intensity is low
(`intensity < 0.3`, where intensity = PCr spend over the last 3 s / 6 [E]):

```
pcrCeil   = 100 − 1.2 × max(0, lac − 8) − 200 × residualDehydration      // −2 per 1 % residual  [S: DAMAGE §4.5, §4.7]
tHalfPcr  = 30 s / aerobicRate × (1 + 0.5 × aer)                            // 20–30 s dynamic-exercise half-times; Bogdanis 56.6 s after all-out [S: DAMAGE §4.1]
pcr      += (pcrCeil − pcr) × (1 − 0.5^(dt / tHalfPcr))
lacClear  = 0.4 / 60 mmol/L per s at rest × aerobicRate × (intensity < 0.15 ? 1.0 : 0.5)   // 0.3–0.5/min rest, ~2× active [S: DAMAGE §4.1]
lac       = max(1, lac − lacClear × dt)
aer      += dt × (0.012 × intensity − 0.004 × (1 − intensity) × aerobicRate)  clamped 0–1   [E; ~85 s of sustained max effort to full debt; ~4 min of rest to clear]
```

During `state.winded` PCr refill is 0 (§2.3.2). Lactate clearance of 0.4 mmol/L/min means a 15-min bout clears
< 6 mmol/L in total even if the fighter did nothing — the pool is effectively cumulative `[S: DAMAGE §4.1]`.

#### 2.5.3 Fatigue index

```
f = 0.45 × (1 − pcr/100) + 0.40 × clamp((lac − 4)/16, 0, 1) + 0.15 × aer          [S: DAMAGE §4.1]
```

Grapple-heavy phases re-weight to `0.35 / 0.50 / 0.15` while `posture ∈ {clinch, ground*}` [E; DAMAGE §4.1 —
isometric loading; LIT_A §3 Slimani 2017: RPE–lactate r = 0.81 striking vs 0.53 grappling, so grapplers need
the extra channel]. `f` is the number every other section reads.

Expected trajectories (calibration, §5): post-bout lactate 10–21 mmol/L `[S: DAMAGE §1 Amtmann 2008]`; K-1
rounds 11.3 → 13.1 → 14.6 `[S: FD §2.5]`; an evenly paced T4 fighter should end R3 near `f ≈ 0.55` and
`lac ≈ 13`, a front-runner who spent R1 at intensity 0.6+ near `f ≈ 0.8`, `lac ≈ 18` [E].

#### 2.5.4 Round-break recovery (60 s standard; other lengths scale as in §2.3)

`[S: DAMAGE §4.4]` unless tagged:

- PCr: refill with `tHalfPcr = 45 s / aerobicRate` → ≈ 60 % of the deficit at `aerobicRate = 1`
  [D: 1 − 0.5^(60/45) = 0.60]; ceiling capped at 85 while `lac > 14`.
- Lactate: `−0.5 mmol/L` (negligible).
- Aerobic debt: `× 0.65`.
- Acute pools continue their in-round decay (head clears fully: "saved by the bell" comes out clear-headed but
  keeps the structural tax).
- Structural: head −25 % / body −15 % / legs −10 % / arms −20 % of the recoverable part (§2.3).
- Swelling −10 % (ice); cutman on the worst cut (§2.3.6).
- Corner effects (physiological side; the decision side is §07): `sitDown` (default true) — if the fighter stays
  standing (T0–T1 habit, or ruleset without stools), break PCr refill ×0.85 and `aer` recovery ×0.8 [E];
  `breatheCue` (corner tells the fighter to breathe; T3+ corners) `aer × 0.6` instead of 0.65 [E];
  `affirmation` +0.1 composure-equivalent for the next round's dump/rocked-decision penalties `[S: MMAI §7.7
  CO-4]`. These three flags are the only corner inputs this section accepts.

#### 2.5.5 Effects of fatigue on capability

Multipliers, linear in `f` between the anchors (`[S: DAMAGE §4.3]` for the anchors; shape [E]); composed with
the damage multipliers of §2.3.7 and published in `caps`:

| Capability | f = 0.5 | f = 0.8 | formula | Note |
|---|---|---|---|---|
| Strike power, rotational punches/kicks (cross, hook, overhand, round kicks) | 0.88 | 0.75 | `1 − 0.25 × f^1.1` (≈) | Dunn 2022: rotational punches lose ~2× the jab's force under lower-body fatigue `[S: LIT_A §2]` |
| Strike power, jab/teep/straight-line | 0.94 | 0.87 | `1 − 0.16 × f` | |
| Strike speed / hand speed | 0.92 | 0.82 | `1 − 0.22 × f` | |
| Output rate (strike attempts/min, §07 pace) | 0.80 | 0.55 | `1 − 0.55 × f^1.2` (≈) | biggest observed effect; late rounds see lower volume; kickboxing −8 % HIA R1→R3 `[S: FD #128]`, boxing −15–25 % late rounds `[S: BOX §7.2, low confidence]` |
| Accuracy | 0.92 | 0.82 | `1 − 0.22 × f` | |
| Head movement / footwork defence | 0.80 | 0.55 | `1 − 0.55 × f^1.2` | defence dies first |
| Takedown speed and TDD | 0.85 | 0.65 | `1 − 0.42 × f` | |
| Decision quality (§07 noise / plan adherence) | 0.85 | 0.65 | `1 − 0.42 × f` | |
| Chin (via `kFatigue` on `alphaEq`) | ×1.125 | ×1.20 | `1 + 0.25 × f` | §2.2.2 |
| Rocked recovery half-life | 10 s | 13 s | `8 × (1 + 0.6 × f)` s | §2.6 |
| Movement speed cap | 0.90 | 0.80 | `1 − 0.25 × f` | [E] |

Pace preservation: real fighters keep attack *counts* by cutting grip-fight time and circling more
`[S: LIT_A §3 Franchini 2019]`, and pro-boxing punch force did not fall across rounds `[S: LIT_A §0 Pierce
2006]`. The output-rate multiplier is therefore exposed to §07 as a *budget* (`paceBudget = 1 − 0.55 f^1.2`),
which the AI may spend on fewer exchanges of the same quality (T3+) or on the same number of weaker ones
(T0–T2) — §3.

#### 2.5.6 Body-shot → cardio coupling and dehydration

```
bodyMult   = 1 − 0.006 × body.structural            // −6 % aerobic refill per 10 structural  [E; DAMAGE §2.2]
bodyShot   = for 60 s after a body hit with raw ≥ 35: aerobicRate × 0.8 and all costs × 1.10   [E; DAMAGE §4.2]
dehydMult  = 1 − 4 × residualDehydration            // 2 % residual → −8 %  [E; DAMAGE §4.7]
```

`residualDehydration` (0–0.05) is supplied by §01's camp model: a controlled ≈ 5 % cut with > 24 h recovery
shows no decrement `[S: DAMAGE §4.7 Connor 2022]`, so only the *residual* is penalised; losers cut more
(10.6 % vs 8.6 %) `[S: LIT_B §2.11 Brechney 2021]`; expected regain 8–10 % of the limit in light divisions,
~6 % MW, ~3 % HW `[S: LIT_B §2.8]`. Suggested §01 mapping: `residualDehydration = max(0, (cutPct − 5) × 0.4 −
regainQuality × 1.5) / 100` [E].

#### 2.5.7 Adrenaline dump

```
dump = (1 − experience) × (1 − composureEff/100) × eventMagnitude       [E; DAMAGE §4.6]
experience = 01 §2.4.1 `experience` = 0.1 + 0.9 × (1 − exp(−totalFights/6)) (debut 0.10; 10 pro fights 0.83)   [REVIEW: was clamp(proFights/12, 0.1, 0.8) here; 01 owns it and 07 reads the same value]
eventMagnitude: regional card 0.6, main card 0.8, title fight 1.0, hostile crowd +0.1   [E; DAMAGE §4.6]
```

For the first 150 s of round 1: all energy costs `× (1 + 0.6 × dump)`, decision quality `× (1 − 0.2 × dump)`;
output *budget* `× (1 + 0.15 × dump)` for the first 45 s (they rush), then `× (1 − 0.25 × dump)` until 150 s
`[E; DAMAGE §4.6]`. Evidence: pre-fight glucose 6.1 vs 4.4 mmol/L in official vs simulated bouts
`[S: DAMAGE §4.6 Coswig 2016]`; elite boxers pace by internal cues and ignore false corner feedback
`[S: MMAI §7.6 Halperin 2019]`. After R1 the dump vanishes; its lactate carries over normally, which is the
"gassed in R2" pattern MMAI §7.6 describes (its `R1 pace ×1.3, drain ×1.4, R2 output ×0.7` is the same
phenomenon with slightly larger constants; DAMAGE's are used because they attach to `f`).

#### 2.5.8 Altitude

`altMult = 1 − 0.063 × max(0, altitudeM − 500)/1000 × (acclimatised ? 0.5 : 1)` on `aerobicRate`, and
`altLacMult` on lactate accumulation (§2.5.1) `[S: DAMAGE §4.8 Wehrlin 2006: VO2max −6.3 %/1,000 m]`.
Denver (1,600 m) → −7 %, Mexico City (2,240 m) → −11 % [D].

#### 2.5.9 Front-runner fade (emergent) and second wind

No fade parameter exists. Because lactate does not clear and `pcrCeil = 100 − 1.2 × max(0, lac − 8)`, a
fighter who runs `f > 0.6` in R1 enters R3 with a lower PCr ceiling and a higher `aer`; a fighter at 18 mmol/L
has an 88 ceiling `[S: DAMAGE §4.5]`. High-`cardio` fighters clear faster and fade less. Calibration: the sim
should reproduce round-1 winners with low `cardio` and high R1 output losing decisions (FD has no published
figure — §5 lists it as a sanity target, not a number).

**Second wind** `[E; DAMAGE §4.5]`: if `f` falls from > 0.7 to < 0.55 through ≥ 40 s of `intensity < 0.3`
(clinch stall, slow ground phase, opponent backing off), grant `secondWind` for 60 s: output budget ×1.10,
decision quality ×1.10. At most once per round. Psychological, not physiological; PCr resynthesis is the
only literature.

#### 2.5.10 Grip / forearm channel (grappling-heavy bouts)

A fourth, cheap accumulator `grip` (0–100) charged only by `clinch_pummel`, `submission_squeeze`,
`submission_escape`, wall-wrestling and gi-grip actions (+1.0 per 10 s [E]); decays with t½ 90 s in-round and
−40 % per break [E]. Effect: grip strength for §03/§04 `× (1 − 0.16 × grip/100)` `[S: LIT_A §0.6 — BJJ grip strength
−13–16 % per match; wrestling forearm most fatigued, Nilsson 2002]`. It does not enter `f`.

### 2.6 Recovery

#### 2.6.1 Rocked recovery curve

`head.acute` decays with `t½ = 8 s × (1 + 0.6 × f) × recoveryAttrMult` only while no head strike lands
`[S: DAMAGE §3.4]`; every landed head strike during the state resets the "last hit" timer (re-hit half-life 20 s
for the next 10 s, §2.3) and adds damage. Exit `state.rocked` at `acute < 35`, `state.stunned` at `< 25`.

Worked example [D]: a fighter rocked to `acute = 60` by a single shot who then clinches (no further head
strikes) exits rocked when `60 × 0.5^(t/8) < 35` → `t = 8 × log2(60/35) = 6.2 s` at `f = 0`; at `f = 0.6`
(`t½ = 10.9 s`) → 8.5 s; from `acute = 85` (hurt knockdown, decay frozen for ~17 s first) → 17 + 8 × log2(85/35)
= 17 + 10.2 ≈ 27 s. These reproduce DAMAGE's "10–25 s with clinch/grab; 15–40 s after a hurt knockdown".

`recoveryAttrMult = 1 − 0.003 × (recovery − 50)` (§2.3) [E].

#### 2.6.2 Knockdown recovery

- Flash KD: grounded `U(1, 3)` s — the fighter may rise as soon as `riseAllowedAfterS` elapses and §07 chooses
  to (a T0 fighter may not choose to, §3); residual rocked by decay `[E; DAMAGE §2.1]`.
- Hurt KD: `riseAllowedAfterS ~ U(1, 3)`; decay frozen `U(10, 25)` s; §07 hooks `survivalMode` (§2.8).
- Body collapse / winded: grounded window as §2.3.2; the referee cue `attemptingToRise` is false until it ends.
- Leg collapse: `cannotStand` cue until `leg.acute < 50` [E].
- KO: `unconsciousS ~ U(5, 90)` `[E; DAMAGE §2.1]`; Hutchison's 0–20 s stoppage tail arises from §06's delay,
  not from consciousness returning.

#### 2.6.3 Between rounds — see §2.5.4 and §2.3 (structural recovery, cutman, ice). Corner retirement inputs
exposed to §06/§07: `head.structural`, `f`, `mobilityMin`, `vision`, `handInjured`, `lostLastRoundDecisively`
(§06 computes the last) `[S: DAMAGE §5.3 — retire if structuralHead ≥ 80 and lost last round decisively, or
f ≥ 0.9 with a dominant opponent, or mobility ≤ 0.4; ~1–2 % of bouts]`.

#### 2.6.4 Second wind — §2.5.9.

#### 2.6.5 Foul pauses

Eye poke / groin: pause up to 300 s (§06); during the pause all acute pools decay at their normal in-round
rates and PCr refills at the in-round low-intensity rate `[S: DAMAGE §5.4]` — a real tactical benefit to the
fouled fighter (and to the fouler). Eye poke: `P(lasting vision −20 % for the bout) = 0.10`, `P(fight-ending
injury) = 0.03` `[E; DAMAGE §2.6]`; poke *incidence* (0.6 % per open-hand forward extension) is §02's.

### 2.7 Referee-observable cues (interface to §06)

Real referees key off observable cues, not hidden numbers `[S: DAMAGE §5.1]`. This section fills the
`RefObservables` record that §06 §2.3.1 defines (field names below are §06's; producers other than §05 are
marked), plus a few extra cues §06 may adopt. Published per fighter per tick:

```ts
interface RefObservables {
  // --- §06-defined fields produced here ---
  ko: boolean;                         // state.ko (acuteHead ≥ 90 or KO roll) or state.choked_out
  limp: boolean;                       // "going limp": limpness ≥ 1 (below)
  rocked: boolean; stunned: boolean;   // state.rocked / state.stunned
  bodyCollapse: { on: boolean; tSinceS: number };   // state.body_collapse / winded-grounded
  legCollapse:  { on: boolean; tSinceS: number };   // state.leg_collapse
  unansweredHead: number;              // clean head strikes absorbed since the fighter's last answer (rule below); shared with §02
  absorbedWindow30: number;            // strikes absorbed (any quality) in the trailing 30 s; shared with §02
  tSinceDefenceS: number;              // seconds since the last intelligent-defence action
  consciousness: number;               // 0–1; 1 normal; falls with choke progress (§04 writes) and to 0 at ko/choked_out
  cuts: { site; severity: 1|2|3; bleedIntoEye: boolean }[];
  visionL: number; visionR: number;    // 0.2–1
  eyeSwollenShut: boolean;             // swell[side] ≥ 70 on either side
  fractureFlag: 'nose' | 'jaw' | 'hand' | 'leg' | null;   // nose_broken / (jaw: not modelled v1) / hand_injured / limb_fracture or joint_failure
  knockedDown?: { cause: 'legal_strike' | 'slip' | 'foul' | 'push'; kind: 'flash' | 'hurt' | 'ko' | 'body' | 'leg' };  // event, this tick only
  // --- produced elsewhere, listed for completeness ---
  grounded: boolean;                   // §03 + ruleset groundedDef
  intelligentDefence: boolean;         // §03/§07 per the 3.0-s rule; this section supplies tSinceDefenceS and coveringStaticS
  attemptingToRise: boolean;           // §07 (forced false during body_collapse / leg cannotStand windows — see below)
  tapped; verbalTap; screams; jointFailed;   // §04
  // [REVIEW: fields §06 §2.3.2–2.3.5 read that neither draft listed — added so the record is complete]
  defenceQuality30: number;            // §02: share of the trailing-30-s absorbed strikes that were blocked/evaded
  knockdownsLast10s: number;           // §06 derives from this section's `knockedDown` events (ref.secondKdWindowS)
  underChoke: boolean;                 // §04: defender of a `state.sub_locked` choke
  clinching: boolean;                  // §03: in a `clinch`-kind engagement
  moving: boolean;                     // §02: footwork above `movement_low_pace` in the last 1 s
  // --- additional cues this section offers (§06 may ignore) ---
  coveringStaticS: number;             // seconds of static double-forearm cover without positional change
  limpness: 0 | 1 | 2;                 // 1: arms dropped / head lolls (acute ≥ 70 or knockdown_hurt); 2: limp (ko, or acute ≥ 85 for > 1 s)
  eyesCue: 'normal' | 'glassy' | 'rolled' | 'closed';   // glassy: rocked; rolled: acute ≥ 85; closed: ko
  reactionCue: 'normal' | 'slow' | 'none';               // slow: stunned/rocked; none: no defensive action for 2 s while being hit
  legsCue: 'normal' | 'wobble' | 'gone';                 // wobble: rocked rs < 0.5; gone: rs ≥ 0.5 or knockdown_hurt residual
  cannotStand: boolean;                // leg_collapse and leg acute ≥ 50
  bloodInEyeS: number;                 // cumulative fight seconds with a brow/eyelid cut of severity ≥ 2
  doctorCheckRequested: boolean;       // any §2.3.6 trigger fired since the last check
  mouthOpen: boolean;                  // f > 0.6 or body_worn sev 2 (presentation + "exhausted" read)
  visibleDamageScore: number;          // 0–1 judges' damage input = 0.5·clamp(head.acute/65) + 0.3·(cuts/swelling) + 0.2·(legs)  [E]
}
```

"Answer" rule for `unansweredHead` and `tSinceDefenceS` `[S: DAMAGE §5.1]`: the counter resets to 0 (and the
timer restarts) when the fighter performs any of: a guard change that alters which strikes land (§02 reports
`defenceChanged`), a hip escape / turn / positional change (§03), grabbing a limb or body-locking (§03), a
level change or clinch entry, footwork that changes range, a stand-up attempt, or throws a strike back. A
static double-forearm cover on the ground for > 3 s does **not** count and instead increments
`coveringStaticS`. §06's `intelligentDefence` is true when `tSinceDefenceS < 3.0 s` `[S: DAMAGE §5.1 as used by
§06 §2.3.1]`. `attemptingToRise` is forced `false` for the grounded window of `state.body_collapse` and
while `cannotStand` (the fighter physically cannot), whatever §07 intends. Calibration for §06: real referees
allow ~15–20 partly-defended strikes but only 3–5 fully undefended ones `[S: DAMAGE §5.1]`; the stoppage lag
(0.5–2.0 s positioning; 3.5 s mean incl. recognition, FD #110) is §06's parameter.

Limpness/eyes cues are the "going limp" signal referees use to stop even when the strike count is low
`[S: RULES_JUDGING S5 guidance: hands down, head snapping back, wobbly legs, eyes closed/spasms]`.

### 2.8 Behaviour hooks (interface to §07)

Own-state signals (exact, the fighter knows how they feel):

| Signal | Definition | Intended AI use (§07) |
|---|---|---|
| `hurt` | `state ∈ {stunned, rocked, knockdown_*}`, with `rs` | D-1 hurt-behaviour selection: clinch / shoot / cover / circle by style and tier `[S: MMAI §7.5]`; decision quality already reduced via `caps` |
| `survivalMode` | `knockdown_hurt` or `rs ≥ 0.6` | forces choice among {grab a leg, turtle, cover, wall-walk}; disables plan execution; `effectiveIQ −1` for 20 s `[S: MMAI §7.4]` |
| `legDamage[side]`, `deadLeg[side]` | `legLoad` and `state.dead_leg` | stance switch at sev 2 (`legDamageStanceSwitch`), reduce kicks from the damaged leg, check more, avoid planting |
| `shinPain[side]` | kicker's shin pool bands | `stopLowKicksThisLeg`, `refuseKicksThisLeg` `[S: MT §5.2]` |
| `bodyHurt`, `bodyWorn` | states | `bodyShotAvoidance`: elbows in, back up from kicks, mouth open; guard drops (already in caps) |
| `guardSideCompromised[side]`, `handUse[side]` | dead arm / hand injury | drop that hand's usage frequency ×0.5 |
| `vision[side]` | | strikes from the blind side are unseen; AI circles to keep the good eye toward the opponent [E] |
| `fatigue f`, `paceBudget`, `secondWind`, `dump` | §2.5 | pacing (§3); T3+ spend the budget on fewer exchanges of full quality |
| `roundsLeftEnergy` | `pcrCeil × (1 − aer)` projected per remaining round [E] | "do I have a round 3?" |

Opponent-state *estimates* (what the fighter can see; noisy by fightIQ — noise model is §07's):

| Observable | Source in this section | Notes |
|---|---|---|
| `oppHurtVisible` | opponent `legsCue ≠ normal`, `eyesCue = glassy`, `reactionCue = slow` | triggers finisher logic D-3 (reckless vs measured by IQ `[S: MMAI §7.5]`); the KO-risk window decays with the opponent's acute pool (20–30 s) `[S: MMAI §7.5]` |
| `oppTiredVisible` | opponent `mouthOpen`, output drop > 20 % over 60 s (§07 computes from its own log), `paceBudget` is *not* visible | |
| `oppLegVisible` | opponent `limp`, stance switch, checks | target the leg |
| `oppCut`, `oppSwollen` | cut list, swelling ≥ 30 | target the cut side (T3+) |
| `oppBodyWorn` | opponent guard-drop presentation | head-kick / body-attack opportunity `[S: MT §5.3]` |

Damage awareness is deliberately asymmetric: a fighter knows their own `f` exactly but reads the opponent
only through cues — this is what lets a good poker face (T4–T5 "sells composure" `[S: MT §8.24]`) hide damage.
Presentation flag `showsPain = (1 − composure/100) × severity` gates whether a hit *animates* as hurting;
referees and AI read the animation-level cue, not the pool [E].

### 2.9 Multi-opponent notes (interface to §07)

The existing engine has `swarmStaminaPenalty` (extra drain per additional engaged opponent) and a defensive
cover of `1/sqrt(engagedBy)` `[S: AUDIT §1.1; src/engine/engine.ts:481]`. No research file measures either.
What the evidence supports: at most ~2 attackers can strike a single defender effectively at once; violent
subgroups are 3–6 people; group attacks "burst" once half the group commits; downed defenders with standing
attackers face kicks, the injury mechanism most likely to need admission `[S: FD §6.4]`. Proposal:

1. **Split attention as a defence penalty** — keep the `1/sqrt(engagedBy)` shape [E; retained from the
   current engine; sub-linear because peripheral vision covers a second attacker partially] but apply it as a
   multiplier on the *defence attribute* (like §2.3.7), and make strikes from any attacker outside the
   defender's facing cone (±60° [E]) `seen = false` in §02 (so `kUnseen` 1.35 applies). Attackers beyond the
   second engaged (`engagedBy ≥ 3`) add only `+0.5` to the effective count [E; FD §6.4 "at most 2 effective"]:
   `effEngaged = min(engagedBy, 2) + 0.5 × max(0, engagedBy − 2)`; `cover = 1/sqrt(effEngaged)`.
2. **Swarm fatigue** — per second, `swarm_tax = 0.15 × (effEngaged − 1)` PCr and `0.01 × (effEngaged − 1)`
   lactate [E; replaces `swarmStaminaPenalty`], plus the movement costs that fighting on a retreating arc incurs
   naturally. Rationale: continuous high-pace movement with no pause phase (a 1-vs-N defender never gets the
   1:2–1:4 effort:pause structure `[S: LIT_A §0]`).
3. **Downed defender vs standing attackers** — kicks/stomps to a grounded head use `kGround = 1.0` (not 0.7),
   `kWeaponDmg × 1.5`, and every strike is `seen = false` while the defender is turtled [E; FD §6.4 item 3;
   fatal one-punch mechanism is the secondary head impact on the ground `[S: FD §6.3]`].
4. **Secondary ground impact** — a knockdown on a hard surface (street ruleset, §07) adds a `mat`-weapon
   `StrikeImpact` to the head with `forceN ~ U(800, 2,500)` and `kWeapon = 0.35 × surfaceHardness` [E].
5. Untrained crowd priors (force ≈ 50–60 % of elite, accuracy ≈ 23 %, bursts, alcohol) are §07/§01's
   `[S: FD §6.4]`; this section only notes that `dump` for a T0 fighter defaults to ≈ 0.7 [D: experience 0.1,
   composure 30 → (0.9)(0.7)(1.0) = 0.63 at magnitude 1].

### 2.10 Tick order and RNG draw order (determinism contract)

Upkeep phase (per fighter, ascending id): (1) acute decay per region (no RNG); (2) structural bookkeeping
(none in-round); (3) PCr/lactate/aer update; (4) state timers (rocked exit, grounded windows, dead-leg,
winded, delayed liver collapse fires here); (5) recompute `caps`, cues, hooks.

Resolution phase, per `StrikeImpact` in the order §02 resolves them: draws in this fixed order, each consuming
exactly one RNG call whether or not its condition applies (so the stream is stable): (a) `pConcuss` roll;
(b) outcome split `u`; (c) `unconsciousS` / grounded windows (one draw, scaled); (d) freeze duration;
(e) cut roll; (f) cut severity; (g) calf-shock / knee-event / rib / nose roll (region-specific, one draw);
(h) attacker hand/foot injury roll; (i) shin-fracture roll (checked kicks); (j) liver-collapse delay draw.
Round-break processing draws nothing.

State ids introduced by this section (conventions §5):

| id | one-line definition |
|---|---|
| `state.stunned` | head acute 30–45: slowed reactions, minor defence loss |
| `state.rocked` | head acute 45–65 or concussive roll: legs/guard/decision degraded, absorb halved |
| `state.knockdown_flash` | dropped by a single clean shot but able to rise at once |
| `state.knockdown_hurt` | dropped and badly hurt; decay frozen; survival mode |
| `state.ko` | unconscious from strikes; fight over |
| `state.choked_out` | unconscious from a choke; fight over |
| `state.joint_failure[joint]` | refused tap; limb unusable |
| `state.neck_cranked` | residual neck strain |
| `state.body_hurt` | body acute ≥ 50: guard drops, output falls |
| `state.body_worn` | body structural ≥ 40 (sev 2 at 60): persistent cardio tax and posture change |
| `state.winded` | solar-plexus strike: cannot breathe 3–15 s |
| `state.body_collapse` | liver/accumulated body shot: involuntary drop, cannot rise 5–20 s |
| `state.dead_leg` | calf-shock nerve event, 15–30 s |
| `state.leg_compromised` | structural leg load ≥ 30 (sev 1/2/3) |
| `state.leg_collapse` | leg load ≥ 85 or leg acute ≥ 70: falls on further kicks |
| `state.dead_arm[side]` | arm structural ≥ 50: guard drops that side |
| `state.hand_injured[side]` / `state.foot_injured[side]` | attacker self-injury |
| `state.limb_fracture` | catastrophic shin/limb break; fight over |
| `state.nose_broken` | mouth breathing, blood |
| `state.eye_swollen_shut[side]` | swelling ≥ 70 on that side |
| `state.second_wind` | temporary output/decision bonus |
| `state.adrenaline_dump` | R1 first 150 s cost/decision penalty |

---

## 3. Behaviour by skill tier

The physiology is tier-blind; what changes is the *attributes* generated per tier (§01) and the *choices*
made under the states above (§07). This table states what must visibly differ so that §01/§07 can be checked
against it. Composure and experience are the levers; `[S: MMAI §7.5, §7.6; DAMAGE §7.22; LIT_B §1.9]` for the
directions, magnitudes [E] unless tagged.

| Aspect | T0 untrained | T1 beginner | T2 amateur | T3 regional pro | T4 elite | T5 champion |
|---|---|---|---|---|---|---|
| Composure when hurt (chosen behaviour) | freezes or turns away, eyes close, covers with hands over face; eats follow-ups (`coveringStaticS` grows) | covers on the fence (worst option) or swings wildly | covers / trades; sometimes clinches late | clinches or shoots; circles out if a striker | immediate clinch / level change / angle; grabs a leg on the ground `[S: MMAI §7.5 D-1]` | as T4, and counters while hurt (T5 only) `[S: MMAI table 7.8]` |
| Rocked decision penalty (multiplies the §2.3.7 decision multiplier) | ×0.5 | ×0.6 | ×0.75 | ×0.9 | ×1.0 | ×1.05 (composure ≥ 90) |
| `showsPain` (presentation, §2.8) | 1.0 | 0.9 | 0.7 | 0.5 | 0.3 | 0.15 (Thai-style "sells composure") `[S: MT §8.24]` |
| Pacing | empties the tank in 60–90 s; no concept of rounds `[S: BOX §6 pacing row]` | fades after R1 | paces 3 rounds poorly; big R3 drop | paces 3 rounds; spends the `paceBudget` on weaker volume | spends the budget on fewer, full-quality exchanges; U-shaped pacing with a late surge `[S: FD §2.5 Muay Thai winners; LIT_A Franchini 2019]` | adjusts pace to the scorecard |
| Adrenaline dump (`dump` at magnitude 1, typical composure) | ≈ 0.65 | ≈ 0.5 | ≈ 0.35 | ≈ 0.2 | ≈ 0.08 | ≈ 0.03 |
| Energy cost per action (`skillCostMult`) | 1.15 | 1.10 | 1.03 | 0.97 | 0.91 | 0.85 |
| Round-break habits | stands, talks; no cutman skill (severity −0 with `P = 0.5`) | sits late | sits; cutman −1 | full corner | full corner + breathe cue | + affirmation, composure management |
| Typical `chin` / `bodyToughness` / `recovery` priors (§01) | 35 ± 15 | 40 ± 12 | 45 ± 10 | 50 ± 10 | 55 ± 10 | 60 ± 10 — champions are selected for chins [E] |
| Reaction to leg damage | keeps eating kicks, does not check (≤ 10 % checks) `[S: MT §8.14]` | checks rarely | checks 50 %; switches stance late | checks; switches stance at sev 2 | checks 70 %; switches early; catches | + counters the kick |
| Reaction to body damage | folds, turns away | drops guard, stops throwing | backs up | covers body, changes level | keeps elbows in, moves; hides it | hides it fully |
| Tapping / quitting interplay with `heart` | quits mentally when hurt or tired: at `f > 0.7` or `rocked`, `P(passive/turn-away per tick) = 0.02 × (1 − heart/100)` [E] — the referee reads `reactionCue = none` | quits at `f > 0.8` | rare; verbal submission to body shots possible | very rare | never quits from fatigue; taps only to real locks (§04) | as T4; refused taps more likely (`heart ≥ 90` → §04 tap latency ×1.5 [E]) |
| Cut/swelling response | ignores; blood in eye unmanaged | | corner manages | corner manages; fighter circles to protect the eye | targets the opponent's cut | as T4 + elbow selection to open it |
| Recovery between rounds | as physiology | | | | | + breathe cue and affirmation (§2.5.4) |

"Heart" is not a damage attribute: it governs *willingness* (continuing under `f` and `hurt`, tap latency,
attempting to rise) and never chin or pool values. Composure governs *quality* of decisions under stress and
`dump`. Discipline governs pacing adherence (§07). Their numeric effects are all in §07 except the three
hooks named here (`dump`, rocked decision penalty, `showsPain`).

---

## 4. Parameter registry

All ids are namespaced for `src/engine/params/damage.ts`, `…/consciousness.ts`, `…/fatigue.ts`. Units: s =
seconds, u = pool units (0–100), N = newtons, mmol = mmol/L, — = dimensionless.

### 4.1 Front end (`dmg.*`)

| id | value | unit | tag |
|---|---|---|---|
| `dmg.cleanMult.flush/partial/glancing` | 1.0 / 0.5 / 0.25 — fallback only; 1.0 for any impact carrying `placement` [REVIEW] | — | [E; DAMAGE §3.1] |
| `dmg.absorb.block_glove/block_forearm/roll/slip_late/check/knee_block/catch` | 0.5 / 0.5 / 0.6 / 0.6 / 0.85 / 0.7 / 0.9 | — | [E; DAMAGE §3.3; MT §3] |
| `dmg.absorb.brace` | 0.3 | — | [E; DAMAGE §3.3] |
| `dmg.absorb.gloveBlockMult.mma4oz/bare/boxing8/10/12` | 0.7 / 0.6 / 1.0 / 1.0 / 1.1 | — | [E; BOX §3] |
| `dmg.absorb.rockedMult` | 0.5 | — | [E; DAMAGE §3.3] |
| `dmg.absorb.cap` | 0.95 | — | [E] |
| `dmg.forceRef` | 3,400 | N | [S: DAMAGE §3.1] |
| `dmg.rawScale` | 100 | u per `forceRef` | [E] |
| `dmg.kWeaponDmg.fist/hammerfist/elbow/knee/shin/foot/head/mat` | 1.0 / 0.8 / 1.1 / 1.2 / 1.2 / 0.9 / 0.8 / 0.6 | — | [E] |
| `dmg.massSev.exp / min / max` | 0.5 / 0.8 / 1.3 | — | [E] |
| `dmg.massRef` | 77 | kg | [D: pooled UFC male mean, FD] |
| `dmg.massScaleTarget.exp` | −0.25 | — | [E] |
| `dmg.acuteAttrSlope` | 0.004 per point | — | [E] |
| `dmg.blockToArmFraction` | 0.4 | — | [S: DAMAGE §2.4] |

### 4.2 Regions (`dmg.head.*`, `dmg.body.*`, `dmg.leg.*`, `dmg.arm.*`, `dmg.cut.*`)

| id | value | unit | tag |
|---|---|---|---|
| `dmg.head.acuteHalfLife / reHit / reHitWindow` | 8 / 20 / 10 | s | [E; DAMAGE §2.1] |
| `dmg.head.breakRecovery / pFrac` | 0.25 / 0.40 | — | [E; DAMAGE §2.1] |
| `dmg.head.structuralRatio` | 0.35 | — | [E] |
| `dmg.head.groundStructuralMult` | 1.3 | — | [E; DAMAGE §3.2] |
| `dmg.head.site.acute.chin/temple/midface/forehead/orbit/topback` | 1.35 / 1.25 / 0.85 / 0.60 / 0.80 / 0.70 | — | [S: DAMAGE §2.1] (orbit, topback E) |
| `dmg.head.site.structural.chin/temple/midface/forehead/orbit/topback` | 0.9 / 1.0 / 1.15 / 0.9 / 1.3 / 1.0 | — | [S: DAMAGE §2.1] |
| `dmg.head.thr.stunned / rocked / kdHurt / ko` | 30 / 45 / 65 / 90 | u | [E; DAMAGE §2.1] |
| `dmg.head.exit.stunned / rocked` | 25 / 35 | u | [E; DAMAGE §7.6] |
| `dmg.head.kPriorSlope / kPriorCap` | 0.006 / 1.6 | — | [E; DAMAGE §2.1] |
| `dmg.swell.gain / breakRecovery / visionStart / visionSpan / shutAt` | 0.6 / 0.10 / 30 / 50 / 70 | u | [E]; `shutAt` [S: DAMAGE §5.2] |
| `dmg.nose.breakP / rawMin / aerobicMult` | 0.02 / 30 / 0.92 | — | [E; Bledsoe 2006 10.4 % nose share; Jones 2023 3.6 % facial fracture] |
| `dmg.body.acuteHalfLife / reHit / reHitWindow` | 12 / 20 / 10 | s | [E; DAMAGE §2.2] |
| `dmg.body.breakRecovery / pFrac / structuralRatio` | 0.15 / 0.30 / 0.40 | — | [E; DAMAGE §2.2] |
| `dmg.body.site.acute.liver/solar/ribs/spleen/sternum/abdomen` | 1.3 / 1.2 / 1.0 / 1.1 / 0.8 / 0.9 | — | [E] |
| `dmg.body.site.structural.liver/solar/ribs/spleen/sternum/abdomen` | 1.0 / 0.8 / 1.2 / 1.0 / 0.9 / 0.8 | — | [E] |
| `dmg.body.thr.hurt / hurtExit / worn / worn2 / collapse / collapseRollAt` | 50 / 35 / 40 / 60 / 80 / 80 | u | [E; DAMAGE §2.2; MT §5.3] |
| `dmg.body.collapseRollP` | 0.25 | — | [S: MT §5.3] |
| `dmg.body.liver.rawThr / delayMin / delayMax / downMin / downMax` | 35 / 0.5 / 3.0 / 5 / 20 | u, s | [E; DAMAGE §2.2] |
| `dmg.body.solar.rawThr / windedMin / windedMax` | 30 / 3 / 15 | u, s | [E; DAMAGE §2.2] |
| `dmg.body.ribFractureP / tier4Raw` | 0.01 / 45 | — | [S: MT §5.3] |
| `dmg.body.toughnessThrSlope` | 0.005 per point | — | [E; DAMAGE §7.22 ±25 %] |
| `dmg.leg.acuteHalfLife / reHit / reHitWindow` | 20 / 30 / 15 | s | [E; DAMAGE §2.3] |
| `dmg.leg.breakRecovery / pFrac / structuralRatio` | 0.10 / 0.50 / 0.40 | — | [E; DAMAGE §2.3; MT §5.1] |
| `dmg.leg.site.acute.thigh/calf/shin/knee` | 1.0 / 0.8 / 0.5 / 0.6 | — | [E; DAMAGE §2.3] |
| `dmg.leg.site.structural.thigh/calf/shin/knee` | 1.0 / 1.5 / 1.0 / 1.0 | — | [S: DAMAGE §2.3 calf 1.5] |
| `dmg.leg.loadWeight.calf / knee` | 1.1 / 1.2 | — | [E] |
| `dmg.leg.mobility.a / p` | 0.7 / 1.5 | — | [S: DAMAGE §2.3] |
| `dmg.leg.kickPower.a / p` | 0.5 / 1.2 | — | [E; MT §5.1] |
| `dmg.leg.checkSpeed.a / p` | 0.5 / 1.3 | — | [E; MT §5.1] |
| `dmg.leg.tdd.a / p` | 0.45 / 1.2 | — | [E; MT §5.1] |
| `dmg.leg.worseLegWeight` | 0.7 | — | [S: DAMAGE §2.3] |
| `dmg.leg.rearHandPower.drop / start / span` | 0.2 / 40 / 30 | — | [S: DAMAGE §2.3 (55 → −20 %); smoothing E] |
| `dmg.leg.thr.sev1 / sev2 / sev3 / collapse / collapseAcute` | 30 / 55 / 75 / 85 / 70 | u | [E; DAMAGE §2.3] |
| `dmg.leg.collapseFallP` | 0.30 | — | [S: MT §8.22] |
| `dmg.leg.calfShock.base / perHit / cap / durMin / durMax` | 0.08 / 0.02 / 0.18 / 15 / 30 | —, s | [S: MT §5.1]; duration [E] |
| `dmg.leg.deadLeg.move / check / kick / tdd` | 0.7 / 0.5 / 0.6 / 0.75 | — | [E; MT §5.1] |
| `dmg.leg.kneeEventP / kneeMove / kneeTdEntry` | 0.05 / 0.8 / −0.15 | — | [S: MT §8.9] |
| `dmg.leg.checkReturnForce` | 0.6 | — | [S: DAMAGE §2.3 60 %] |
| `dmg.leg.checkDefenderAbsorb` | 0.85 | — | [S: MT §3 0–20 %] |
| `dmg.leg.shinFractureP / shinFractureForceMin` | 0.002 / 1,800 | —, N | [S: MT §5.2]; force gate [E] |
| `dmg.leg.shin.band1 / band2 / band3` | 26 / 51 / 76 | u | [S: MT §5.2] |
| `dmg.leg.shin.freq1 / pow1 / freq2 / pow2` | 0.8 / 0.9 / 0.6 / 0.8 | — | [S: MT §5.2] |
| `dmg.arm.acuteHalfLife / reHit / reHitWindow` | 15 / 25 / 10 | s | [E] |
| `dmg.arm.breakRecovery / pFrac` | 0.20 / 0.30 | — | [E] |
| `dmg.arm.directAcute / directStructural` | 0.6 / 0.35 | — | [E] |
| `dmg.arm.deadArmThr / exit / minDur / guard / power` | 50 / 40 / 60 / 0.75 / 0.8 | u, s, — | [S: DAMAGE §2.4] (exit E) |
| `dmg.hand.pSkull / pSoft / pHammerElbow` | 0.0015 / 0.0004 / 0.0002 | — | [E; DAMAGE §2.4] |
| `dmg.hand.gloveMult.mma4oz/bare/boxing` | 1.0 / 2.5 / 0.6 | — | [E] |
| `dmg.hand.power / useFreq` | 0.65 / 0.5 | — | [S: DAMAGE §2.4] |
| `dmg.foot.p / power / freq` | 0.003 / 0.6 / 0.4 | — | [S: DAMAGE §2.4] (effects E) |
| `dmg.cut.p.elbowHoriz.brow/other` | 0.12 / 0.06 | — | [S: MT §5.4] / [E; DAMAGE §2.5] |
| `dmg.cut.p.elbowDown.brow/other` | 0.18 / 0.08 | — | [S: MT §5.4] |
| `dmg.cut.p.elbowUp.brow/other` | 0.08 / 0.04 | — | [S: MT §5.4] |
| `dmg.cut.p.fistMma.brow/other` | 0.012 / 0.004 | — | [E; DAMAGE §2.5] |
| `dmg.cut.p.fistBoxing.brow/other` | 0.008 / 0.003 | — | [E; LIT_A Bledsoe 2005] |
| `dmg.cut.p.fistBare.brow/other` | 0.025 / 0.008 | — | [E] |
| `dmg.cut.p.knee.brow/other` | 0.03 / 0.015 | — | [E; DAMAGE §2.5] |
| `dmg.cut.p.headClash.brow/other` | 0.08 / 0.04 | — | [E; DAMAGE §2.5] |
| `dmg.cut.p.shinFoot.brow/other` | 0.02 / 0.01 | — | [E] |
| `dmg.cut.pronenessPerCareerCut / cap` | 0.01 / 1.5 | — | [E] |
| `dmg.cut.structuralSlope` | 0.005 | — | [E] |
| `dmg.cut.sevWeights / sevWeightsElbow` | 0.60/0.30/0.10 ; 0.45/0.35/0.20 | — | [S: DAMAGE §2.5] / [E] |
| `dmg.cut.growthHits` | 5 | strikes | [S: DAMAGE §2.5] |
| `dmg.cut.vision.sev2 / sev3` | 0.75 / 0.5 | — | [S: DAMAGE §2.5] |
| `dmg.cut.bloodRecentS` | 120 | s | [E] |
| `dmg.cut.cutmanReduce / reopenHits` | 1 / 2 | — | [S: DAMAGE §2.5] |
| `dmg.cut.doctor.bloodInEyeS` | 60 | s | [S: DAMAGE §5.2] |
| `dmg.vision.defence.floor / accuracy.floor` | 0.6 / 0.7 | — | [S: DAMAGE §2.5 bands] |
| `dmg.recoveryAttrSlope` | 0.003 per point | — | [E] |

### 4.3 Consciousness (`ko.*`, `kd.*`)

| id | value | unit | tag |
|---|---|---|---|
| `ko.alphaRef / forceRef` | 6,300 / 3,400 | rad/s², N | [S: DAMAGE §3.1] |
| `ko.kWeapon.straight/uppercut/hook/elbow/knee/shin/foot/hammerfist/mat/head` | 1.0 / 1.05 / 1.15 / 1.15 / 1.2 / 1.2 / 1.1 / 0.6 / 0.35 / 0.8 | — | straight, hammerfist [S: DAMAGE §3.1]; hook [D]; elbow [S]; rest [E] |
| `ko.kLever.chin/temple/midface/forehead/orbit/topback` | 1.3 / 1.2 / 0.8 / 0.7 / 0.8 / 0.7 | — | [S: DAMAGE §3.1] (orbit, topback E) |
| `ko.kGlove.mma4oz/bare/boxing8/10/12` | 1.15 / 1.20 / 1.0 / 0.97 / 0.93 | — | [E; LIT_A Bartsch 2012 direction] |
| `ko.kUnseen` | 1.35 | — | [E; DAMAGE §3.2] |
| `ko.kBrace.a / b` | 1.15 / 0.30 (= 01 `fm.attr.neck_mult_a/b`, on 01 `neck`) [REVIEW] | — | [S: DAMAGE §3.2 form] |
| `ko.neckBrace.chinW / strengthW` | retired — `kBrace` reads 01 `neck` [REVIEW] | — | — |
| `ko.kRelaxed` | 1.2 | — | [E; DAMAGE §3.2] |
| `ko.kClosing.max / speedRef` | 0.5 / 3 | —, m/s | [E; DAMAGE §3.2] |
| `ko.kFatigue` | 0.25 | — | [E; DAMAGE §3.2] |
| `ko.kGround` | 0.7 | — | [E; DAMAGE §3.2] |
| `ko.alphaCal` | 1.0 | — | calibration [E] |
| `ko.alpha50 / alphaScale` | 8,500 / 1,000 | rad/s² | [D: Rowson & Duma 2013 collapsed onto punch a:α; §2.4.1] |
| `ko.chinSlope` | 0.02 per point | z | [E; DAMAGE §3.2] |
| `ko.dehydSlope` | 3 | z per unit fraction | [E; DAMAGE §3.2] |
| `ko.kKO` | 0.20 | — | [E; DAMAGE §3.2 (0.22)] |
| `ko.kKO.fatigue` | 0.4 | — | [E] |
| `ko.split.hurtKD / flashKD` | 0.10 / 0.25 | — | [E; DAMAGE §3.2] |
| `ko.massSevKO.exp / min / max` | 0.8 / 0.6 / 1.5 | — | [E] |
| `ko.historyPerKO / historyCap` | 0.25 / 4 (= 01 `fm.career.kko_history_per_ko`) | — | [S: DAMAGE §3.2 form; Hutchison, Guskiewicz] slope [E] |
| `ko.age.start / slope30 / knee / slope35` | retired — age enters only through 01 `chinEff` (`fm.age.chin.*`) [REVIEW] | — | — |
| `ko.careerChinLoss` | 3 | attribute points per KO/TKO loss | [E; DAMAGE §7.21] |
| `ko.unconsciousMin / Max` | 5 / 90 | s | [E; DAMAGE §2.1] |
| `kd.hurt.acuteFloor / freezeMin / freezeMax / riseMin / riseMax` | 70 / 10 / 25 / 1 / 3 | u, s | [E; DAMAGE §2.1] |
| `kd.flash.acuteFloor / groundedMin / groundedMax` | 55 / 1 / 3 | u, s | [E; DAMAGE §2.1] |
| `kd.rocked.acuteFloor` | 50 | u | [E] |
| `kd.survivalTax.pcr / lac` | 4 / 0.4 | u, mmol | [E; DAMAGE §4.2] |
| `rec.rockedHalfLife / fatigueSlope` | 8 / 0.6 | s, — | [S: DAMAGE §3.4]; slope [D: 8 → 13 s at f = 0.8] |

### 4.4 Fatigue (`fat.*`)

| id | value | unit | tag |
|---|---|---|---|
| `fat.cardioSlope` | 0.008 per point | — | [E] |
| `fat.cost.<techClass>.pcr / lac` | table §2.5.1 | u, mmol | [E; DAMAGE §4.2] |
| `fat.flurry.window / count / pcr / lac` | 2 / 4 / 2.0 / 0.30 | s, —, u, mmol | [D; DAMAGE §4.2] |
| `fat.skillCostSlope` | 0.003 per point | — | [E; LIT_A Folhes 2023] |
| `fat.bodyCostSlope` | 0.004 per structural u | — | [E; DAMAGE §2.2] |
| `fat.bodyShot.rawThr / durS / costMult / aerobicMult` | 35 / 60 / 1.10 / 0.8 | u, s, — | [E; DAMAGE §4.2] |
| `fat.weightCostExp` | 0.15 | — | [E; LIT_A Folhes 2023] |
| `fat.pcrShortfallLacPerUnit` | 0.05 | mmol/u | [E] |
| `fat.pcrCeil.lacStart / lacSlope / dehydPerUnit` | 8 / 1.2 / 200 | mmol, u/mmol, u per fraction | [S: DAMAGE §4.5, §4.7] |
| `fat.pcrHalfLifeInRound / intensityGate / aerDebtSlope` | 30 / 0.3 / 0.5 | s, —, — | [S: DAMAGE §4.1 (20–30 s)]; gate, slope [E] |
| `fat.intensityWindowS / intensityRef` | 3 / 6 | s, u | [E] |
| `fat.lacClearPerMin / activeMult / activeGate` | 0.4 / 0.5 / 0.15 | mmol/min, —, — | [S: DAMAGE §4.1 0.3–0.5] (gate E) |
| `fat.aer.upRate / downRate` | 0.012 / 0.004 | per s | [E] |
| `fat.f.w.pcr / lac / aer` | 0.45 / 0.40 / 0.15 | — | [S: DAMAGE §4.1] |
| `fat.f.w.grapple.pcr / lac / aer` | 0.35 / 0.50 / 0.15 | — | [E; DAMAGE §4.1] |
| `fat.f.lacStart / lacSpan` | 4 / 16 | mmol | [S: DAMAGE §4.1] |
| `fat.break.pcrHalfLife / ceilCapLac / ceilCap / lacDrop / aerMult` | 45 / 14 / 85 / 0.5 / 0.65 | s, mmol, u, mmol, — | [S: DAMAGE §4.4] |
| `fat.break.standingPcrMult / standingAerMult / breatheAerMult` | 0.85 / 0.8 / 0.6 | — | [E] |
| `fat.eff.powerRot.a / p` | 0.25 / 1.1 | — | [S: DAMAGE §4.3 anchors; Dunn 2022 shape] |
| `fat.eff.powerLinear.a` | 0.16 | — | [E; Dunn 2022 ~½ of rotational] |
| `fat.eff.speed.a` | 0.22 | — | [S: DAMAGE §4.3] |
| `fat.eff.output.a / p` | 0.55 / 1.2 | — | [S: DAMAGE §4.3] |
| `fat.eff.accuracy.a` | 0.22 | — | [S: DAMAGE §4.3] |
| `fat.eff.defence.a / p` | 0.55 / 1.2 | — | [S: DAMAGE §4.3] |
| `fat.eff.td.a` | 0.42 | — | [S: DAMAGE §4.3] |
| `fat.eff.decision.a` | 0.42 | — | [S: DAMAGE §4.3] |
| `fat.eff.moveCap.a` | 0.25 | — | [E] |
| `fat.bodyAerobicSlope` | 0.006 per structural u | — | [E; DAMAGE §2.2] |
| `fat.dehydAerobicSlope` | 4 | per unit fraction | [E; DAMAGE §4.7] |
| `fat.dump.expPerFight / expMin / expMax` | retired — 01 `experience` (`fm.exp.*`) [REVIEW] | — | — |
| `fat.dump.magnitude.regional / main / title / hostileCrowd` | 0.6 / 0.8 / 1.0 / +0.1 | — | [E; DAMAGE §4.6] |
| `fat.dump.durS / costMult / decisionMult / rushS / rushOutput / crashOutput` | 150 / 0.6 / 0.2 / 45 / 0.15 / 0.25 | s, — | [E; DAMAGE §4.6] |
| `fat.alt.baseM / vo2PerKm / lacPerKm / acclimMult` | 500 / 0.063 / 0.10 / 0.5 | m, — | [S: DAMAGE §4.8 Wehrlin 2006] (lac, acclim E) |
| `fat.secondWind.from / to / lowIntensityS / gate / durS / bonus` | 0.7 / 0.55 / 40 / 0.3 / 60 / 0.10 | — , s | [E; DAMAGE §4.5] |
| `fat.grip.perTenS / halfLife / breakDrop / strengthLoss` | 1.0 / 90 / 0.40 / 0.16 | u, s, —, — | [E]; loss [S: LIT_A Andreato 2013/15] |
| `fat.noseAerobicMult` | 0.92 | — | [E] |

### 4.5 Multi-opponent (`swarm.*`)

| id | value | unit | tag |
|---|---|---|---|
| `swarm.coverExp` | 0.5 (i.e. `1/sqrt`) | — | [E; retained from current engine] |
| `swarm.effectiveCap / beyondWeight` | 2 / 0.5 | — | [E; FD §6.4] |
| `swarm.facingConeDeg` | 60 | ° | [E] |
| `swarm.tax.pcrPerS / lacPerS` | 0.15 / 0.01 | u, mmol per extra engaged | [E] |
| `swarm.downed.kGround / dmgMult` | 1.0 / 1.5 | — | [E; FD §6.4] |
| `swarm.groundImpact.forceMin / forceMax / kWeapon` | 800 / 2,500 / 0.35 × hardness | N, — | [E; FD §6.3] |

---

## 5. Calibration hooks

Targets this section is responsible for (FD master-table numbers; tolerances per FD §3). "Lever" lists the
registry ids to move, in order, and which other sections share the target. Batch: ≥ 2,000 3×5 UFC-level bouts
(T4 vs T4 population, seeded) per FD §3.

| # | Metric | Target | Tol. | FD row | Levers (this section) | Shared with |
|---|---|---|---|---|---|---|
| C1 | Knockdowns per fighter per 15 min | 0.30 | ±0.05 | #30 | `ko.alphaCal`, `ko.alpha50` | §02 force distribution and `seen` rate |
| C2 | KD per 100 head sig landed | 0.82 | ±0.2 | #37 | same | §02 |
| C3 | KD per landed distance power head strike | 3.9 % (soft; pipeline gives 2.3 %, §2.4.1) | ±1 pp | #36 | same | §02 — definitional tension with C2; C2 wins |
| C4 | KD rate decay by round | ×1.0 / 0.45 / 0.28 | ±0.1 | #38, #125 | `ko.kFatigue` (pushes the wrong way — keep ≤ 0.25), `fat.eff.powerRot` | §02 `seen` decay 0.30 → 0.15 by R3 [E]; survivorship is free |
| C5 | Share of fights with ≥ 1 KD; KD distribution 0/1/2/3/4+ | 36 %; 64/30/5/1/0.2 | ±5 pp | #32, #33 | — (follows C1) | — |
| C6 | KD → same-round KO/TKO by scorer | 57 % | ±5 pp | #40 | `kd.hurt.freeze*`, `ko.kKO`, `dmg.absorb.rockedMult` | §06 unanswered thresholds; §07 finisher aggression |
| C7 | KD-fight → KO/TKO, by class | 65 % pooled; FLW 53 → HW 84 | ±5 / ±7 pp | #39, #41 | `ko.massSevKO.exp`, `dmg.massSev.exp` | §06, §07 |
| C8 | Fighter scoring ≥ 1 KD wins | 86 % | ±4 pp | #42 | (follows C6) | §06 judging (KD AME) |
| C9 | KO : TKO ratio | ≈ 1 : 2 (KO 11.5 %, TKO 22.4 % of fights) | ±5 pp | #90 | `ko.kKO`, `dmg.head.thr.ko` | §06 (`ko` cue vs `defenceless` cue) |
| C10 | KO/TKO % by men's class | HW 48 · LHW 44 · MW 37 · WW 33 · LW 30 · FW 29 · BW 26 · FLW 25 | ±4 pp | #92 | `ko.massSevKO`, `dmg.massSev` | §02 force by mass; §01 class priors |
| C11 | KO/TKO per 100 head sig landed by class | FLW 0.44 → HW 0.99 | ±20 % | #54 | same | |
| C12 | Women's KD per 15 / KO% | ≈ ⅓ of men; W-SW 14 % KO | ±0.04 / ±4 pp | #35, #94 | — | §01/§02 force priors (pipeline: F ×0.72 → 0.30× men) |
| C13 | Strikes before TKO: loser head sig absorbed (mean/median) | 11 / 6 | ±3 / ±2 | #46 | `dmg.head.reHit`, `dmg.head.kPriorSlope`, `dmg.head.structuralRatio` | §06 thresholds |
| C14 | Strikes in final 30 s before TKO | 18.5 (5–46), 92 % head | ±4 | #48 | `dmg.absorb.rockedMult` | §07 finisher, §06 |
| C15 | Referee lag after KO blow; extra strikes | 3.5 s; 2.6 | ±1.5 s; ±1 | #49, #110 | `ko.unconscious*` (must exceed the lag) | §06 owns the lag |
| C16 | Finish share by round; conditional hazard | R1 53 %; 0.25 / 0.21 / 0.16 | ±4 pp / ±0.04 | #98, #100 | `fat.*` fade constants (too much fade → R3 finishes too high) | §07 pacing |
| C17 | Doctor stoppages | 0.8–1.1 % of fights | ±0.4 pp | #109 | `dmg.cut.p.*`, `dmg.cut.sevWeights`, `dmg.swell.*` | §06 doctor leniency |
| C18 | Cut incidence per fighter-bout | 12 % | ±3 pp | LIT_A Jones 2023 | `dmg.cut.p.*` | §02 elbow frequency |
| C19 | Facial fracture per fighter-bout | 3.6 % | ±1.5 pp | LIT_A Jones 2023 | `dmg.nose.breakP` | |
| C20 | Hand injury per fighter-bout | 1–3 % | — | DAMAGE §2.4 | `dmg.hand.*` | |
| C21 | Body-shot finishes | 4–6 % of KO/TKO | ±2 pp | DAMAGE §2.2 | `dmg.body.liver.rawThr`, `dmg.body.thr.collapse` | §02 body-target share |
| C22 | Leg-kick TKOs | 1–2 % of finishes | ±1 pp | DAMAGE §2.3 | `dmg.leg.thr.collapse`, `dmg.leg.collapseFallP` | §06 |
| C23 | Post-bout lactate | 10–21 mmol/L; K-1 by round 11.3 / 13.1 / 14.6 | — | DAMAGE §1; FD §2.5 | `fat.cost.*`, `fat.lacClearPerMin` | §07 pacing |
| C24 | Output decline by round | HIA −8 % R1→R3 (kickboxing); boxing late rounds −15–25 % | ±5 % | #128; BOX | `fat.eff.output.*`, `fat.pcrCeil.*` | §07 `paceBudget` use |
| C25 | Fatigue-driven force loss by end of R3 (normal pace) | ≤ 10 % | — | LIT_A §6.3 Ouergui 2013 | `fat.eff.powerRot.a` (0.25 at f = 1 → ~12 % at f = 0.5) | |
| C26 | Front-runner fade sanity | R1 winner with low `cardio` + high R1 output loses the decision more often than not | qualitative | FD §2.5 (no published figure) | `fat.pcrCeil.lacSlope` | §07 |
| C27 | Age / KO-history susceptibility | KO-loss <25 ≈ 10 % vs 37+ ≈ 25 %; never-dropped 14 % vs 5+ KDs 25 % | ±4 pp | #119 | `ko.age.*`, `ko.historyPerKO` | §01 age curves on chin/reaction |
| C28 | Standing-8 / three-KD rulesets | GLORY (T)KO 32–35 %; boxing KD frequency (no number) | ±4 pp | FD §2.6 | `ko.kGlove.boxing*` | §06 ruleset |
| C29 | Multi-opponent | 91 % loss vs 3+ attackers is UNVERIFIED (FD §6.2) — do not calibrate on it; use "≤ 2 effective attackers", KOs mostly < 30 s | qualitative | FD §6 | `swarm.*` | §07 |

Measurement notes: C2/C3 tension — Fightnomics (to 2013) counts "power" narrowly; the 2015–26 scrape's 0.82 per
100 head sig is the better-defined target. The Monte-Carlo in §2.4.1 lands at ≈ 1.1 per 100 head sig before
§02's real target/position mix is applied; expect to reduce `ko.alphaCal` to ≈ 0.9 once §02 is in. Any change
to §02's force medians must be followed by a C1–C3 re-run.

---

## 6. Assumptions and open questions

Every `[E]` above, grouped; plus the playability-vs-realism tradeoffs.

### 6.1 Estimates (must be exposed as tunables and calibrated)

Damage front end and regions:
1. Contact multipliers 1.0/0.5/0.25; absorb table; brace 0.3; MMA-glove block ×0.7; rocked absorb ×0.5; cap 0.95.
2. `raw` scale (100 u at 3,400 N), weapon damage multipliers, attacker-mass exponent 0.5 (0.8–1.3), target-mass
   exponent −0.25, toughness slope 0.004/point, `recovery` slope 0.003/point.
3. All acute half-lives (head 8/20, body 12/20, legs 20/30, arms 15/25 s) and re-hit windows; structural
   break-recovery fractions (25/15/10/20 %) and permanent fractions (40/30/50/30 %); structural:acute ratios
   (0.35/0.40/0.40/0.35).
4. Head thresholds 30/45/65/90 and exits 25/35; sub-site multipliers for orbit and top/back; swelling gain,
   vision curve and 80-u eye-shut; nose-break 2 % and its aerobic tax.
5. Body site multipliers; body thresholds 50/40/60/80; liver `raw ≥ 35` with 0.5–3 s delay and 5–20 s down;
   solar 3–15 s; toughness threshold slope ±25 %; body-finish share 4–6 %.
6. Leg site multipliers, calf 1.5 structural, load weights 1.1/1.2, all four capability curves, rear-hand
   smoothing, thresholds 30/55/75/85, calf-shock rising probability and 15–30 s duration, knee-event 5 %,
   check return 60 %, shin-fracture force gate 1,800 N, shin-pool bands.
7. Arm pools entirely; dead-arm exit 40.
8. Hand-injury rates (0.15/0.04/0.02 %), bare-knuckle ×2.5, foot 0.3 %; effects (−35 % power, −50 % use).
9. Cut probabilities by weapon/zone (only elbow-horizontal/down/up from MT are semi-sourced), proneness,
   structural slope, severity weights, growth 5 hits, vision 0.75/0.5, blood window 120 s, cutman −1 / reopen 2.
10. Capability-multiplier table §2.3.7 (all cells).

Consciousness:
11. `alphaEq` factor magnitudes: unseen 1.35, relaxed 1.2, closing 0.5/3 m/s, fatigue 0.25, prior 0.006 (cap
    1.6), ground 0.7, glove 1.15/1.20/0.97/0.93, weapon factors for uppercut/knee/shin/foot/mat/head, neck-brace
    blend 0.6/0.4.
12. Logistic midpoint 8,500 / scale 1,000 (derived from a helmeted-football curve — proxy, not an MMA KO curve;
    DAMAGE §8 flags this as the weakest link); chin slope 0.02/point; dehydration slope 3.
13. `kKO` 0.20 (+0.4 f), split 10/25/45, mass severity exponent 0.8, history 25 %/KO (cap 4), age slopes
    4 %/8 %, career chin loss 3 points, unconscious 5–90 s, knockdown floors 70/55/50, freeze 10–25 s, grounded
    1–3 s, survival tax.
14. Attacker mass excluded from `alphaEq` (on Pierce's r = 0.22 and the flat KD-per-head-strike gradient) —
    if C10/C11 cannot be met through severity alone, add a mild `(m/77)^0.3` term.

Fatigue:
15. `cardio` → `aerobicRate` slope 0.008; every per-action cost (DAMAGE §4.2 magnitudes are all estimates);
    flurry tax; skill-cost slope 0.003; body-cost slope 0.004; body-shot 60-s tax; weight-cost exponent 0.15;
    PCr shortfall → lactate 0.05.
16. Intensity gate 0.3 (3-s window, ref 6 u); `aer` up/down rates 0.012/0.004; grapple re-weighting
    0.35/0.50/0.15; break standing/breathe multipliers; affirmation +0.1.
17. Fatigue-effect exponents (1.1, 1.2) and the linear/rotational power split; movement cap 0.25.
18. Adrenaline dump: experience mapping (proFights/12), magnitudes 0.6/0.8/1.0/+0.1, 150-s window, 0.6 cost,
    0.2 decision, 45-s rush +15 %, crash −25 %.
19. Altitude lactate +10 %/km and acclimatisation ×0.5; second-wind thresholds 0.7/0.55/40 s/60 s/+10 %; grip
    channel constants; nose aerobic 0.92.
20. Residual-dehydration mapping from cut % and regain quality (suggested to §01).

Interfaces and multi-opponent:
21. §02 force expectations (flush medians 2,100/1,250/2,400 N; delivered lognormal 1,150 N, σ 0.45; jab 700 N;
    kick/knee/teep/elbow ratios; `seen = false` 0.30 → 0.15 by round).
22. Referee cue definitions (limpness levels, eyes/reaction/legs cues, 3.0-s answer window (shared with §06), 3-s static cover, 2-s reactionCue window,
    `visibleDamageScore` weights 0.5/0.3/0.2).
23. Tier table §3: rocked decision penalties, `showsPain`, dump values, cost multipliers, attribute priors,
    quitting probability `0.02 × (1 − heart/100)` per tick, refused-tap latency ×1.5.
24. Multi-opponent: `1/sqrt` cover retained, effective-attacker cap 2 (+0.5 beyond), 60° cone, swarm tax
    0.15 u/s, downed multipliers 1.0/1.5, secondary ground impact 800–2,500 N × 0.35 × hardness.

### 6.2 Open questions

- **No published measurement** of rocked-state duration, knockdown-to-finish conversion mechanics, per-strike
  power decline with fatigue, body-shot/leg-kick dose-response, or cut rate by weapon `[S: DAMAGE §8; LIT_A §6]`.
  All are estimates that the Phase 9 batch must tune against C1–C24.
- The C2 vs C3 definitional tension (0.82 per 100 head sig vs 3.9 % per distance power strike) needs a
  UFCStats scrape that separates jabs from power strikes at distance; until then C2 is primary.
- Whether attacker mass belongs in `alphaEq` (item 14) — resolvable only by the class-gradient calibration.
- Should true KO (`state.ko`) be reachable by accumulation (acute ≥ 90 by threshold) or only by the roll?
  Currently both; Hutchison's "all KOs were direct head impacts" argues for roll-only, but the threshold path is
  what produces "KO'd on the ground under a barrage" broadcast realism. Default: both, and log which path.
- Ground-and-pound: `kGround = 0.7` on rotation and `× 1.3` on structural reproduces "accumulated" ground
  finishes; ground KO/TKO share (28 % of KO/TKOs, FD #82) is a §02/§03/§06 joint target not listed above.
- `residualDehydration` requires a camp model (§01) that does not exist yet; default 0.01 [E] for T3+, 0.02 for
  T1–T2, 0 for T0 (no cut).

### 6.3 Playability-vs-realism tradeoffs (default: realism)

| Choice | Realism default | Playability alternative | Where the switch lives |
|---|---|---|---|
| Post-KO strikes land on an unconscious fighter for the referee-lag window | yes (Hutchison 2.6 strikes / 3.5 s) | stop instantly | §06 `refLag`; presentation may cut away |
| Flash knockdowns from low-force shots (fat-tailed force) | yes — a T2 can drop a T4 with a perfect shot (Stojsih peak loads 2–3× concussive means `[S: LIT_A §2]`) | truncate the force tail | §02 σ_ln |
| Front-runner fade with no explicit parameter | emergent, sometimes brutal for low-`cardio` fighters | cap `f` at 0.85 | `fat.f.cap` (not set by default) |
| Adrenaline dump for T0–T1 | large (dump ≈ 0.65) | halve `fat.dump.costMult` | registry |
| Doctor stoppages on cuts at ~1 % | yes | disable | §06 |
| Blood on/off | presentation only; never affects mechanics beyond vision through the cut severity | — | presentation |
| Catastrophic shin fracture (0.2 % per checked hard kick) | on | off | `dmg.leg.shinFractureP` |
| Unconscious 5–90 s | on (with limp presentation) | fixed 10 s | `ko.unconscious*` |

