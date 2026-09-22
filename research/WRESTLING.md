# WRESTLING for MMA — Discipline Research (positional-graph input)

Research date: 2026-09-22. Purpose: feed the MMA-sim design doc where every technique is an
edge in a positional state graph with requirements, success probabilities and counters.
All figures marked **ESTIMATE** are the researcher's calibrated judgement from coaching
material and partial data, not measured values. Everything else carries a source URL in §8.

---

## 1. Summary

- **Population baseline (UFC):** takedown (TD) accuracy ≈ 38–42 % of attempts; TD defence
  ≈ 58–62 % (the complement); 1.65 landed TDs per 15 min per fighter. Winners of bouts land
  at a median 50 % accuracy, losers at 20 %. Winners keep ≈ 100 s of control per landed TD,
  losers ≈ 79 s (Ma et al. 2026, 8,461 UFC bouts).
- **By entry range:** open-mat/distance shots land ≈ 30–31 % on average (FightMetric via
  Bloody Elbow); clinch/cage entries land materially more (body lock 50–60 %, inside/outside
  trip 45–55 %, Fight Encyclopedia compilation of UFCStats). Cage geometry matters: distance
  shots are 5.7 % less successful in the smaller (25 ft) octagon (Bloody Elbow 2015).
- **By technique (MMA):** double leg 43–50 %, single leg 35–42 %, body lock 50–60 %,
  trips 45–55 %, arm-drag sequences 38–45 %. Double legs are ≈ 32 % of all landed UFC TDs.
- **Freestyle wrestling:** leg attacks are the dominant scoring action; winners convert
  ≈ 74 % of leg attacks vs ≈ 40 % for losers (Cipriano 1993); single-leg 73 % vs 25 %
  (winners vs losers). Elite doubles hit 50–65 % at world level.
- **Timing:** the penetration step of a double leg takes ≈ 0.43 s (elite) to 0.47 s
  (non-elite) from initiation to knee contact; elite wrestlers reach peak trailing-leg force
  0.05 s earlier and 20 % harder (Frontiers 2020). A full shot-to-mat sequence is
  ESTIMATE 1–3 s; a sprawled-out chain-wrestling sequence is ESTIMATE 4–15 s.
- **Ground time:** on average 38 % of UFC fight time is spent on the ground with someone in
  control (Bloody Elbow 2014). Data on "how quickly the bottom fighter stands up" do not
  exist publicly; §8.4 gives ESTIMATE curves.
- **Weight class:** heavier divisions have lower TD density; median landed TDs per minute is
  zero in 7 of 8 men's divisions (flyweight 0.067/min). 90th percentile ≈ 0.28–0.34 TD/min
  (≈ 4–5 per 15 min).
- **Design principle:** the sim should treat wrestling as *chains*, not single rolls: a
  failed first attempt usually leaves the attacker in a re-attack node (front headlock,
  single-leg-in-hand against the cage, or a scramble) rather than back at neutral.

---

## 2. Positional nodes relevant to wrestling

Node IDs are proposed for the state graph. "Cage" variants exist for every clinch node;
the cage version is a boolean flag `againstCage` rather than a separate node unless noted.

| Node ID | Description | Who has initiative | Typical next nodes |
|---|---|---|---|
| `STAND_NEUTRAL` | Both upright at striking/shot range, no grips. | Either | any entry, `TIE_*` |
| `STAND_NEUTRAL_CAGE` | Defender's back within ~1 m of the fence. | Pressurer | `TIE_*` (cage), shots vs the fence |
| `TIE_COLLAR` | Collar tie (one hand behind the head, other on wrist/elbow/bicep). Standard MMA-clinch "dirty boxing" node. | Symmetric, small edge to head control | snap-down, knee, elbow, underhook pummel |
| `TIE_UNDERHOOK` | One underhook (attacker's arm under defender's arm to the back), defender has an overhook/whizzer on that side (over-under). | Underhook holder | high crotch, inside trip, outside trip, duck-under, knee-tap, cage drive |
| `TIE_OVERHOOK` | Defender's view of the same position (overhook side). A whizzer is an overhook applied to a shooting arm. | Underhook holder | whizzer throw (hip toss), limp arm, re-pummel |
| `TIE_DOUBLE_UNDER` | Double underhooks (attacker) / double overhooks (defender). | Attacker strongly | body lock lift, inside trip, mat return, cage pin |
| `BODY_LOCK` | Hands locked around the waist/torso from the front. | Lock holder | lift, inside/outside trip, mat return |
| `BODY_LOCK_REAR` | Rear waist/body lock (attacker behind). | Attacker | mat return, lift/suplex (salto risk), trip |
| `FRONT_HEADLOCK` | Attacker controls defender's head + one arm (chin strap/elbow pull) with defender bent over. | Attacker | go-behind, guillotine, anaconda, D'Arce, snap to turtle |
| `SINGLE_LEG_IN` | Attacker has one leg captured (head inside or outside; leg on mat, or lifted to hip/chest). Sub-states: `high`, `low` (hand on ankle), `cage`. | Contested; attacker ~55/45 | finishes, whizzer, limp-leg, kick-out, guillotine |
| `DOUBLE_LEG_IN` | Attacker has penetrated with both legs captured, head outside on hip. | Attacker | drive-through finish, sprawl → `SPRAWL_TOP`, hip-heist |
| `HIGH_CROTCH_IN` | One leg captured with the head *inside* and the shoulder in the crotch. Bridge between single and double. | Attacker | double, lift, dump, cage drive |
| `SPRAWL_TOP` | Defender has sprawled onto a shooting attacker; attacker's head under defender's chest. | Defender (now attacker) | front headlock, go-behind, back to neutral, re-shot |
| `TURTLE` (`TURTLE_TOP`/`TURTLE_BOTTOM`) | One fighter on hands and knees, other behind/beside. | Top | back take, ride, front headlock, stand-up, granby, sit-out |
| `REFEREE_POSITION` | Folkstyle top/bottom ride: top has hand on belly + arm, bottom on hands and knees. In MMA this is turtle with a tight-waist/ankle ride. | Top | mat return, back take, bottom stand-up |
| `CAGE_PIN_FRONT` | Attacker has chest-to-chest pressure with defender flattened on the fence (underhook/body lock/collar). | Attacker | trips, knees, elbows, foot stomps, defender's hip-in |
| `CAGE_PIN_REAR` | Rear body lock or rear waist lock with defender's front against the fence. | Attacker | mat return, lift, trip, defender's wrist-fight/turn-in |
| `WALL_WALK` | Bottom fighter is seated/kneeling with back against the fence, working up. | Contested | `CAGE_PIN_FRONT` (attacker keeps pressure), `STAND_NEUTRAL_CAGE` (clean stand), sub-attacks |
| `SCRAMBLE` | Transient node: neither fighter has a stable position (funk, roll, granby, sit-out in progress). Resolves in ≤ 2 s. | Skill-driven | any grappling node |
| `GROUND_TOP_*` / `GROUND_BOTTOM_*` | Owned by BJJ/ground doc; wrestling doc only defines the entry (which ground node a takedown lands in). | — | — |

Landing nodes for takedowns (owned by ground doc, referenced here): `GUARD_TOP`,
`HALF_GUARD_TOP`, `SIDE_CONTROL_TOP`, `BACK_CONTROL` (via rear body lock/go-behind),
`TURTLE_TOP` (via snap-down/front headlock), `GROUND_STANDING_OVER` (attacker standing,
defender on back — common after a dump the attacker chooses not to follow).

---

## 3. Technique catalogue

Base success % is **vs a competent defender** (mid-tier: ~60 % TD defence, i.e. the UFC
population mean). Numbers are calibrated so that the mix of technique frequencies seen in the
UFC reproduces ≈ 40 % overall accuracy. Values without a source are ESTIMATE.

Modifier legend: STR = strength differential, MASS = mass differential (attacker minus
defender, kg), WR = wrestling skill differential (0–100 scale, attacker minus defender),
FAT = attacker fatigue 0–1, CAGE = defender against the cage, SETUP = executed off a strike,
level-change feint, or reaction (see §9 for magnitudes). "pp" = percentage points.

### 3.1 Stance, motion and entries (no capture yet)

| Technique | From | To (success) | To (failure) | Requirements | Exec time | Base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|
| Level change (feint or real) | `STAND_NEUTRAL` | `STAND_NEUTRAL` with `levelChanged=true` for 0.5 s | same, but eats a counter-strike (knee/uppercut) if defender reads it | stance, not fully fatigued | 0.2–0.3 s | n/a (setup; +10 pp to next shot if not telegraphed) | WR, FAT (fatigued fighters stop changing level: −25 % chance to use it at FAT>0.7) | knee, uppercut, sprawl-in-place |
| Penetration step (shot entry) | `STAND_NEUTRAL` | `DOUBLE_LEG_IN` / `SINGLE_LEG_IN` / `HIGH_CROTCH_IN` | `SPRAWL_TOP` (defender) or `STAND_NEUTRAL` (defender circles off) or `FRONT_HEADLOCK` (defender) | level change first; distance ≤ ~1.2 m | 0.43–0.47 s to knee contact (Frontiers 2020) | see each shot | WR, SETUP, CAGE, FAT | sprawl, down-block, knee, step-back + hands on head, guillotine |
| Reactive shot (off opponent's strike commitment) | `STAND_NEUTRAL` | shot node | as above | opponent throws a committed rear hand/kick; attacker WR ≥ 40 | 0.4 s | shot base +15 pp (ESTIMATE; Khabib/Weidman pattern, Mixing Martial Arts taxonomy) | WR heavily, timing attribute | throw with less commitment, retract fast |
| Snap-down | `TIE_COLLAR`, `TIE_UNDERHOOK`, `STAND_NEUTRAL` (after a bent-over shot) | `FRONT_HEADLOCK` or `TURTLE_TOP` (if defender's hands hit the mat) | `TIE_COLLAR` (defender posts) | head control + defender leaning forward | 0.5–1 s | 35 % vs competent; 60 % vs novice who bends at the waist | WR, STR, defender FAT, defender posture (bent = +25 pp) | posture up, post on hip, duck-under |
| Arm drag | `STAND_NEUTRAL`, `TIE_COLLAR` | `BODY_LOCK_REAR` (25 % of successes) or `SINGLE_LEG_IN` | `STAND_NEUTRAL` | wrist/tricep grip | 0.5 s | 38–45 % to some capture (Fight Enc.) | WR, speed | square up, re-drag, back-step |
| Duck-under | `TIE_COLLAR`, `TIE_UNDERHOOK` | `BODY_LOCK_REAR` | `TIE_COLLAR` | defender's elbow high / loose collar tie | 0.4 s | 30 % | WR, height (shorter attacker +5 pp) | elbow tight, hip away, guillotine on the ducking head |
| Slide-by / go-behind from tie | `TIE_UNDERHOOK` | `BODY_LOCK_REAR` | `TIE_UNDERHOOK` | underhook + defender's weight forward | 0.5 s | 25 % | WR | hip-in, re-pummel |

### 3.2 Single leg family

| Technique | From | To (success) | To (failure) | Requirements | Exec time | Base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|
| Single-leg entry (head inside/outside, sweep single) | `STAND_NEUTRAL`, `TIE_COLLAR`, `TIE_UNDERHOOK` | `SINGLE_LEG_IN` | `SPRAWL_TOP` (40 % of failures), `STAND_NEUTRAL` (45 %), `FRONT_HEADLOCK` for defender (15 %) | penetration step; lead leg within reach | 0.5 s to capture | capture 55 %; full TD 35–42 % (Fight Enc.) → capture→finish ≈ 70 % | WR, SETUP +15 pp, CAGE (capture +10 pp, finish +10 pp), FAT −, STR small | sprawl, knee, down-block, step-back |
| Low single (ankle, Burroughs-style) | `STAND_NEUTRAL` | `SINGLE_LEG_IN.low` | `STAND_NEUTRAL` (attacker briefly on the mat, exposed to knees: ESTIMATE 20 % eat a strike) | speed/explosiveness; open mat preferred | 0.4 s | capture 45 %; finish from low single 60 % | WR, speed, MASS (light divisions +5 pp); CAGE − (needs space) | hop away, hip down/limp leg, punch down on head |
| Outside single | `STAND_NEUTRAL`, `TIE_OVERHOOK` (attacker on the overhook side) | `SINGLE_LEG_IN` (head outside) | `STAND_NEUTRAL` | defender's lead leg forward | 0.5 s | capture 50 % | as single | whizzer (high effectiveness vs head-outside) |
| Finish: run the pipe | `SINGLE_LEG_IN` (leg on mat or at hip, head inside) | `GUARD_TOP`/`HALF_GUARD_TOP` | stays `SINGLE_LEG_IN` (another attempt) or `STAND_NEUTRAL` (kick-out) | head on inside hip, leg clamped to chest | 1–2 s | 55 % per attempt; "highest-percentage single finish" (Fight Enc.) | WR, STR, MASS, CAGE (see §5: −25 pp, defender can't be circled) | whizzer, hop/limp-leg, hand on attacker's head, cage post |
| Finish: tree-top (lift leg high, pull ankle up) | `SINGLE_LEG_IN.high` | `GROUND_STANDING_OVER` or `GUARD_TOP` | `SINGLE_LEG_IN` | leg lifted to chest, defender hopping | 1 s | 50 % | STR, height (taller attacker +5 pp) | hook attacker's leg, grab head, hop to cage |
| Finish: dump / cut across (lateral knee-tap dump) | `SINGLE_LEG_IN` | `SIDE_CONTROL_TOP` or `HALF_GUARD_TOP` | `SINGLE_LEG_IN` | attacker steps across defender's posted leg | 1 s | 50 % | WR, STR | limp leg, wide base, whizzer |
| Finish: lift / turn the corner to double | `SINGLE_LEG_IN` | `DOUBLE_LEG_IN` → finish chain, or `GUARD_TOP` directly | `SINGLE_LEG_IN` | hips under, second hand to far leg | 1 s | 60 % (Kolat: "explode to a double") | STR, MASS, WR | turn hips away, whizzer, cage post |
| Finish: trip (inside trip / chop from single) | `SINGLE_LEG_IN` (leg down, defender posted on cage) | `GUARD_TOP` | `SINGLE_LEG_IN` | defender's free leg reachable | 0.7 s | 45 % | WR | hop away, hip-in on cage |
| Defence: whizzer (overhook on the shooting arm) | `SINGLE_LEG_IN` (defender view) | `TIE_OVERHOOK` (defender) → whizzer throw/hip toss (15 %) or neutral | attacker still finishes | free arm over attacker's near arm; head-outside attacks most vulnerable | reactive | −20 pp to attacker finish; whizzer-throw 15 % | WR, STR (strength-heavy), height | limp arm, switch to double, drive head across |
| Defence: limp leg / kick-out | `SINGLE_LEG_IN` (defender view) | `STAND_NEUTRAL` | still `SINGLE_LEG_IN` (attacker re-clamps) | leg low (below attacker's hip) or loose grip | 0.5 s | 35 % vs competent attacker; 60 % vs novice grip | WR, flexibility, attacker FAT | clamp leg to chest, lift |
| Defence: sprawl on a single | `STAND_NEUTRAL` (defender view, at shot time) | `SPRAWL_TOP` | `SINGLE_LEG_IN` | hips back within 0.3 s of entry, hands on head/shoulders | 0.3 s | denies capture 45 % vs competent shooter (complement of the 55 % capture) | WR, reaction, FAT (tired fighters sprawl late: −15 pp at FAT>0.7) | re-shot, high crotch off sprawl, snap the hands |
| Defence: crossface + hip pressure | `SINGLE_LEG_IN`/`DOUBLE_LEG_IN` (defender) | `SPRAWL_TOP` → `FRONT_HEADLOCK` | attacker completes | free arm across attacker's face | 0.5 s | +10 pp to sprawl; 30 % to convert a capture into `FRONT_HEADLOCK` | STR | keep head tight to hip |
| Defence: cage post / hip-in (single on the fence) | `SINGLE_LEG_IN.cage` (defender) | stays standing | attacker completes | back on fence, hips forward, hand on attacker's head | continuous | halves per-attempt run-the-pipe rate; tree-top/trips unchanged | — | switch finish (trip, dump), foot sweep, knee to thigh on the posted leg |
| Counter-attack: guillotine on single | `SINGLE_LEG_IN` (defender; attacker's head outside and low) | `GUILLOTINE_STANDING` (submission doc) | — | attacker's head under defender's arm | 0.5 s | 12 % catch vs competent; 30 % vs novice head position | BJJ skill, height | head up/tight, finish fast |

### 3.3 Double leg family

| Technique | From | To (success) | To (failure) | Requirements | Exec time | Base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|
| Blast double (open mat) | `STAND_NEUTRAL` | `DOUBLE_LEG_IN` → finish | `SPRAWL_TOP` (50 % of failures), `STAND_NEUTRAL` (35 %), `FRONT_HEADLOCK`-defender (15 %) | penetration step, hands to backs of knees, head outside | 0.45 s entry + 1 s drive | full TD 43–50 % (Fight Enc.); vs competent 40 %; open-mat distance shots average 30–31 % (FightMetric/BE) | WR ++, SETUP +15 pp, STR +, MASS +, CAGE +15 pp, FAT − (−20 pp at FAT>0.7) | sprawl, knee/uppercut on entry, underhooks + hip-heist, guillotine |
| Double from underhook (knee-tap / low double off the tie) | `TIE_UNDERHOOK`, `TIE_COLLAR` | `GUARD_TOP`/`SIDE_CONTROL_TOP` | `TIE_UNDERHOOK` | defender's weight forward | 0.7 s | 45 % | WR, STR | post on head, hips back, whizzer |
| Finish: drive through | `DOUBLE_LEG_IN` | `GUARD_TOP` (60 %) / `HALF_GUARD_TOP` (30 %) / `SIDE_CONTROL_TOP` (10 %) | `SPRAWL_TOP` for defender | head up, hips under, feet driving | 0.5–1 s | 70 % if captured cleanly; 40 % if defender already half-sprawled | STR, MASS (largest MASS effect of any technique), WR, CAGE +10 pp | sprawl, underhooks, wide base |
| Finish: lift and slam | `DOUBLE_LEG_IN` | `SIDE_CONTROL_TOP`/`HALF_GUARD_TOP` + damage tick | `DOUBLE_LEG_IN` | hips under defender's; STR high | 1–1.5 s | 60 % when hips are under; slams add ESTIMATE 3–8 % chance of a KO-class damage event | STR ++, MASS ++, FAT −− | grab the cage (foul), guillotine, sit hips down |
| Finish: turn the corner | `DOUBLE_LEG_IN` (defender partially sprawled) | `GUARD_TOP`/`HALF_GUARD_TOP` | `SPRAWL_TOP` | head drives across, feet circle 90° | 1 s | 50 % | WR, FAT | square back up, crossface |
| Finish: cut the corner (angle drive) | `DOUBLE_LEG_IN` | `SIDE_CONTROL_TOP` | `DOUBLE_LEG_IN` | lateral step, 45° drive | 1 s | 55 % | WR, STR | re-square |
| Chain: double → high crotch | `DOUBLE_LEG_IN` (far leg hidden) | `HIGH_CROTCH_IN` | `SPRAWL_TOP` | inside arm switches to the crotch | 0.5 s | 55 % | WR | limp leg, whizzer |
| Defence: sprawl | `STAND_NEUTRAL` (at shot) | `SPRAWL_TOP` | `DOUBLE_LEG_IN` | hips back and down, chest on attacker's upper back | 0.3 s | denies capture 55 % vs competent; 30 % vs elite; 80 % vs novice (no level change) | WR, reaction, FAT, MASS (heavier defender +5 pp) | re-shoot, drag the hands, high crotch |
| Defence: underhooks + hip-heist | `DOUBLE_LEG_IN` (defender) | `TIE_UNDERHOOK` (defender holds it) or `STAND_NEUTRAL` | attacker completes | one/both underhooks as attacker drives | 0.5–1 s | 35 % | STR, WR | lift, switch to single |
| Defence: cage hip-in vs double | `DOUBLE_LEG_IN.cage` (defender) | `CAGE_PIN_FRONT` (attacker) — TD denied but pressure kept | `GUARD_TOP` attacker | back flat on fence, hips forward, underhook + head post | continuous | denies 45 %; 70 % of denials leave attacker in `CAGE_PIN_FRONT`, not neutral | STR, WR, fence skill | switch to single/trip/knee-tap; foot stomps |

### 3.4 High crotch

| Technique | From | To (success) | To (failure) | Requirements | Exec time | Base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|
| High crotch entry | `TIE_UNDERHOOK`, `TIE_COLLAR`, `STAND_NEUTRAL` (off level change) | `HIGH_CROTCH_IN` | `STAND_NEUTRAL` / `SPRAWL_TOP` | underhook-side leg is the target; head inside on chest | 0.5 s | capture 55 % from underhook (best tie-up entry per Sonnen/Fanatic material), 45 % from neutral | WR, SETUP, CAGE +10 pp | whizzer (weak vs HC because head is inside), hips back, cross-wrist control |
| Finish: HC → double (lift/turn the corner) | `HIGH_CROTCH_IN` | `GUARD_TOP`/`SIDE_CONTROL_TOP` | `HIGH_CROTCH_IN` | second hand reaches far leg | 0.7 s | 60 % | STR, MASS | limp leg, hip away |
| Finish: HC lift / dump | `HIGH_CROTCH_IN` | `SIDE_CONTROL_TOP` | `HIGH_CROTCH_IN` | hips under | 1 s | 55 % | STR ++ | sit down, whizzer, cage post |
| Finish: HC cage drive to single | `HIGH_CROTCH_IN.cage` | `SINGLE_LEG_IN.cage` | same | fence reached | 1 s | 65 % | MASS | hip-in |

### 3.5 Body lock, trips, mat returns

| Technique | From | To (success) | To (failure) | Requirements | Exec time | Base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|
| Establish body lock (pummel to double-under or over-under lock) | `TIE_UNDERHOOK`, `TIE_DOUBLE_UNDER`, `CAGE_PIN_FRONT` | `BODY_LOCK` | stays in tie | hands locked (S-grip/gable) | 0.5–1.5 s | 50 % per pummel exchange | WR, STR, Greco background +10 pp | hip-in, frames, elbows, re-pummel |
| Inside trip (body lock or double-under) | `BODY_LOCK`, `TIE_DOUBLE_UNDER`, `CAGE_PIN_FRONT` | `GUARD_TOP`/`HALF_GUARD_TOP` (attacker often lands inside guard) | `BODY_LOCK` | attacker's leg hooks inside defender's near leg | 0.7 s | 45–55 % (Fight Enc.) | WR, STR, CAGE +10 pp (defender can't step back) | base, hip-in, wrestle-up |
| Outside trip (osoto-style) | `BODY_LOCK`, `TIE_UNDERHOOK` | `SIDE_CONTROL_TOP`/`HALF_GUARD_TOP` | `BODY_LOCK` | defender's weight on the reaped leg | 0.7 s | 45–53 % (Fight Enc.) | WR, judo/Greco background +10 pp | step over/through, whizzer |
| Body lock lift and return (front) | `BODY_LOCK` | `SIDE_CONTROL_TOP` / `HALF_GUARD_TOP`; slam damage tick | `BODY_LOCK` | STR ≥ defender, hips under | 1–1.5 s | 50–60 % (Fight Enc. body-lock aggregate) | STR ++, MASS ++, FAT −− | sprawl hips, grab cage (foul), guillotine, sit hips down |
| Rear body lock mat return | `BODY_LOCK_REAR`, `CAGE_PIN_REAR` | `TURTLE_TOP` (55 %) / `BACK_CONTROL` (30 %) / `SIDE_CONTROL_TOP` (15 %) | `BODY_LOCK_REAR` remains (defender wall-walks) | hips behind defender, knee behind knee | 1–2 s | 55 % per attempt; 70 % on the cage with knee-behind-knee | STR, MASS, WR | wrist control + turn in, wide base, hand-fight the lock, cage foot post |
| Rear body lock lift (suplex/back arch) | `BODY_LOCK_REAR` | `SIDE_CONTROL_TOP` + damage; **salto risk**: 10 % attacker lands badly → `SCRAMBLE` | `BODY_LOCK_REAR` | STR high | 1 s | 35 % vs competent; Greco +15 pp | STR ++, MASS ++ | base, hook leg, spin in |
| Defence: hip-in / wrestle-up from rear lock | `BODY_LOCK_REAR` (defender) | `STAND_NEUTRAL` or `TIE_UNDERHOOK` (defender turns in) | attacker retains | wrist control on the lock, hips forward, elbows down | 1–2 s | 30 % per 3 s window vs competent | STR, WR | re-lock, knee behind knee, trips |

### 3.6 Ankle pick and snap family

| Technique | From | To (success) | To (failure) | Requirements | Exec time | Base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|
| Ankle pick | `TIE_COLLAR` (head control), `FRONT_HEADLOCK` | `HALF_GUARD_TOP`/`SIDE_CONTROL_TOP` (attacker lands at the legs, top of open guard) | `TIE_COLLAR` | collar tie pulling head down + defender's weight on lead leg | 0.5 s | 40 % | WR, reach (long arms +5 pp) | posture up, step lead leg back, sprawl on the reaching arm |
| Snap-down → go-behind | `FRONT_HEADLOCK` | `TURTLE_TOP` (60 %) / `BACK_CONTROL` (40 %) | `FRONT_HEADLOCK` remains | defender's hands on mat / posture broken | 0.7 s | 45 % vs competent; 70 % vs novice (bent over, reaching) | WR, STR | posture up, peel the chin strap, sit-out |
| Front headlock → guillotine (standing or pulling guard) | `FRONT_HEADLOCK` | `GUILLOTINE_*` (submission doc) | `FRONT_HEADLOCK`; defender may escape to `STAND_NEUTRAL` 30 % | arm-in or arm-out chin strap | 0.5 s | catch 25 % (finish per submission doc) | BJJ skill | head-out, hips in, drive |
| Front headlock → anaconda / D'Arce | `FRONT_HEADLOCK` (defender turtle-ish, arm exposed) | `ANACONDA_*` / `DARCE_*` (submission doc) | `FRONT_HEADLOCK` | defender's arm inside | 1 s | catch 20 % | BJJ skill, reach | posture, hand fight, roll through |

### 3.7 Sprawl and re-attack

| Technique | From | To (success) | To (failure) | Requirements | Exec time | Base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|
| Sprawl → front headlock | `SPRAWL_TOP` | `FRONT_HEADLOCK` | `STAND_NEUTRAL` (both stand) | chest on attacker's head/shoulder | 0.5 s | 60 % | WR | post and stand, re-shoot |
| Sprawl → spin-behind | `SPRAWL_TOP` | `TURTLE_TOP` / `BACK_CONTROL` | `STAND_NEUTRAL` | attacker stays on knees | 1 s | 35 % vs competent (attacker usually stands); 65 % vs novice who stays down | WR | sit-out or stand |
| Sprawl → knees to head (MMA) | `SPRAWL_TOP` | `SPRAWL_TOP` + strike | — | attacker's head available | 0.5 s per knee | striking doc | — | cover, stand |
| Re-shot (attacker after being sprawled) | `SPRAWL_TOP` (attacker view) | `SINGLE_LEG_IN` / `HIGH_CROTCH_IN` | `FRONT_HEADLOCK` for defender (40 %), `STAND_NEUTRAL` (60 %) | knee under, defender's hands still on head | 0.5 s | 35 % vs competent (second shot −10 pp vs first), +10 pp if defender is now bent over | WR ++, FAT −− | keep hips back, snap, circle |

### 3.8 Rides, turtle, getting back to feet

| Technique | From | To (success) | To (failure) | Requirements | Exec time | Base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|
| Tight-waist ride / ankle ride (folkstyle ride) | `TURTLE_TOP`, `REFEREE_POSITION` | stays `TURTLE_TOP` with control clock; hook-in → `BACK_CONTROL` 35 % per 5 s | bottom stands (`STAND_NEUTRAL`) or scrambles | tight waist + far ankle/wrist | continuous | retains position 70 % per 5 s vs competent | WR, folkstyle +10 pp, STR | technical stand-up, sit-out, granby, switch |
| Leg ride (one hook in) | `TURTLE_TOP` | `BACK_CONTROL` (both hooks, 45 % per 5 s) | bottom turns in → `GUARD_TOP` for former top (25 %) or `SCRAMBLE` | one hook, chest on back | continuous | retains 75 % per 5 s | WR, flexibility | turn in, clear hook, stand with cage |
| Technical stand-up (open mat) | `GUARD_BOTTOM`/`TURTLE_BOTTOM`/ground bottom nodes | `STAND_NEUTRAL` | same ground node (costs ~3 s + a strike-exposure tick) | frame on hip/head, one foot posted | 2–3 s | 25 % per attempt vs competent top; 45 % vs novice top | WR, BJJ, top FAT, MASS (lighter bottom −5 pp) | pressure, tight waist, back take on the turn |
| Wall walk (against the cage) | `GUARD_BOTTOM.cage`/`TURTLE_BOTTOM.cage` → `WALL_WALK` | `STAND_NEUTRAL_CAGE` (35 %) or `CAGE_PIN_FRONT` with attacker keeping a body lock (45 %) | back to ground node (20 %) | back on fence, near-side underhook or overhook, feet under hips | 3–6 s | reaching feet ≈ 60 % per attempt; ≈ 35 % of those separate cleanly (ESTIMATE; Evolve/RDX/MiddleEasy material) | WR, STR, cage skill, FAT | knee behind knee, tight waist, hip pressure, knees to thigh/body during the walk, mat return |
| Kimura-grip stand-up (bottom half guard/guard on cage) | `HALF_GUARD_BOTTOM`, `GUARD_BOTTOM` | `WALL_WALK` → `STAND_NEUTRAL`, or `TURTLE_TOP` reversal (15 %) | same | kimura grip on top player's far arm | 2–3 s | 35 % | BJJ, WR | hand posts, hide arm, elbow tight |
| Bottom-turtle stand-up (with cage) | `TURTLE_BOTTOM.cage` | `STAND_NEUTRAL_CAGE` with attacker on `BODY_LOCK_REAR` (60 % of successes) | `TURTLE_BOTTOM` | open hand on cage, knee up | 2 s | 50 % to reach feet; expect `BODY_LOCK_REAR` follow-up | WR, STR | mat return, hooks, seatbelt |

### 3.9 Scramble techniques (see §6 for the model)

| Technique | From | To (success) | To (failure) | Requirements | Exec time | Base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|
| Sit-out | `TURTLE_BOTTOM` | `STAND_NEUTRAL` (40 %) / `SCRAMBLE` (60 %) | `TURTLE_BOTTOM` | top has no hooks | 0.5 s | 35 % | WR, speed | follow hips, tight waist |
| Switch | `TURTLE_BOTTOM`, `REFEREE_POSITION` | `TURTLE_TOP` (reversal) | `TURTLE_BOTTOM` | top's arm around waist | 0.7 s | 20 % vs competent, 40 % vs novice | WR ++ | hips away, drop the arm |
| Granby roll | `TURTLE_BOTTOM` | `GUARD_BOTTOM` facing top (safe) 50 % / `STAND_NEUTRAL` 25 % / `SCRAMBLE` 25 % | `BACK_CONTROL` for top (10 % of failures) | space, no hooks | 0.7 s | 30 % | flexibility, WR | hooks in, chest pressure |
| Hip heist | `SPRAWL_TOP` (attacker who was shot on), `TURTLE_BOTTOM` | `STAND_NEUTRAL` / `TIE_UNDERHOOK` | same | one foot posted, hips through | 0.5 s | 40 % | WR, speed | tight waist, ankle |
| Funk / roll-through (Askren/Nickal style) | `SINGLE_LEG_IN` (defender view), `SCRAMBLE` | `SCRAMBLE` → `TURTLE_TOP`/`BACK_CONTROL` (roles reversed) | `GUARD_BOTTOM` for the funker | whizzer + attacker's head outside; funk skill | 1–2 s | 25 % vs competent; 45 % when funk skill ≥ 70 | funk skill, flexibility | keep head inside, finish fast, run the pipe |

---

## 4. Chain-wrestling graph

Edges are "attempt → follow-up when the first attempt is stalled or partially blocked".
`P` values are ESTIMATE probabilities that a mid-tier wrestler *chooses* that follow-up
rather than resetting; elite wrestlers chain ≈ 80 % of stalled attempts, novices ≈ 15 %.

```
STAND_NEUTRAL
 ├─ level change ─┬─ blast double ── captured? ──yes──> drive / lift / turn corner / cut corner
 │                │                   └─ defender sprawls ──> [attacker chooses]
 │                │                        ├─ high crotch off the sprawl            (P 0.35)
 │                │                        ├─ single leg (nearer leg)               (P 0.35)
 │                │                        ├─ hip-heist out to neutral              (P 0.15)
 │                │                        └─ stall → defender FRONT_HEADLOCK       (P 0.15)
 │                ├─ single leg ──── captured? ──yes──> run pipe / tree-top / dump / lift→double / trip
 │                │                   ├─ defender whizzers → switch to double (0.4) / limp-arm re-pummel (0.3) / drive to cage (0.3)
 │                │                   ├─ defender limp-legs → re-shoot low single (0.3) / neutral
 │                │                   └─ defender sprawls → high crotch (0.4) / front-headlock loss
 │                ├─ high crotch ─── captured? ──> HC→double (0.5) / lift-dump (0.3) / HC→cage single (0.2)
 │                └─ low single ──── captured? ──> tree-top / turn corner to double / kick-out risk
 ├─ collar tie ─┬─ snap-down → FRONT_HEADLOCK ─┬─ go-behind → TURTLE_TOP / BACK_CONTROL
 │              │                               ├─ guillotine / anaconda / D'Arce (submission doc)
 │              │                               └─ defender postures → collar tie → ankle pick
 │              ├─ ankle pick
 │              ├─ duck-under → BODY_LOCK_REAR → mat return / trip
 │              └─ pummel → TIE_UNDERHOOK
 ├─ TIE_UNDERHOOK ─┬─ high crotch (best-% entry from ties)
 │                 ├─ inside trip / outside trip
 │                 ├─ knee-tap double
 │                 ├─ slide-by → BODY_LOCK_REAR
 │                 ├─ drive to cage → CAGE_PIN_FRONT (§5)
 │                 └─ pummel → TIE_DOUBLE_UNDER → BODY_LOCK → lift / inside trip / mat return
 └─ arm drag → SINGLE_LEG_IN or BODY_LOCK_REAR
```

Named chains (sequence of edges with per-step rolls):

1. **Single → double:** `SINGLE_LEG_IN` (defender hops/whizzers) → lift the leg, step in,
   second hand to far knee → `DOUBLE_LEG_IN` → drive. Per-step 60 %.
2. **Double → high crotch:** sprawl blocks one hand → arm through crotch → `HIGH_CROTCH_IN`
   → HC finish. Per-step 55 %.
3. **Snap → front headlock → go-behind:** snap 35 % → headlock established 60 % → go-behind
   45 %. Cumulative from collar tie ≈ 9–10 % per attempt vs competent; ≈ 30 % vs a bent-over
   novice.
4. **Shot sprawled → re-shot:** re-shot is −10 pp vs the first shot, +10 pp if the
   defender's hands dropped to the mat. Defender's counter-chain: sprawl → front headlock
   → go-behind (60 % × 45 %).
5. **Underhook → HC → cage single → trip:** each step 55–65 %; the dominant modern MMA chain
   (Khabib/Usman/Merab pattern) and why cage TD rates exceed distance rates.
6. **Body lock → inside trip (miss) → outside trip → lift:** 50 % → 45 % → 55 %.
7. **Rear body lock → mat return (miss) → knee-behind-knee → mat return:** 55 % → 70 %.
8. **Whizzer battle:** vs the defender's whizzer the attacker chooses limp-arm (40 %),
   switch to double (40 %), or drive to cage (60 % success vs open mat where the defender
   can circle). Defender's whizzer throw 15 % (STR-heavy).

---

## 5. Cage-wrestling model

Empirical anchors: distance shots land ≈ 30–31 % on average (FightMetric via Bloody Elbow);
body lock/trips from an established clinch land 45–60 % (Fight Encyclopedia); distance
shots are 5.7 % less successful in the smaller cage (Bloody Elbow 2015). Ma et al. note
that cage location was not coded in UFCStats data, so the cage rates below are ESTIMATE,
calibrated so the population overall accuracy (~40 %) is reproduced assuming ≈ 55 % of UFC
TD attempts occur on or near the fence (ESTIMATE, modern grappler-heavy meta).

### 5.1 Node flags and transitions

- `againstCage` is set when the defender is within 1 m of the fence. Pressure fighters
  drive opponents there via footwork (striking doc) or by a stalled shot that carries the
  defender back (any failed double with STR/MASS advantage pushes 1–2 m: ESTIMATE 60 %).
- Cage nodes: `STAND_NEUTRAL_CAGE`, `CAGE_PIN_FRONT`, `CAGE_PIN_REAR`, `SINGLE_LEG_IN.cage`,
  `DOUBLE_LEG_IN.cage`, `WALL_WALK`.

### 5.2 Modifiers when `againstCage` is true

| Effect | Value (vs open mat) |
|---|---|
| Capture chance on double/single/HC | +10 to +15 pp (defender cannot retreat) |
| Finish chance: run the pipe | −25 pp (cannot circle) → attacker prefers trips/dump/lift |
| Finish chance: trips, knee-behind-knee mat returns, lifts | +10 pp |
| Defender's sprawl effectiveness | −10 pp (no room to shoot hips back) |
| Defender's hip-in / posting defence | available: halves per-attempt finish rate for drives; trips unaffected |
| Time per finishing attempt | ×1.5 (fence wrestling is a grind; a cage single can last 10–40 s) |
| Energy per second in `CAGE_PIN_*` | attacker 1.0×, pinned defender 1.3× (holding weight off the fence is costly: Evolve/RDX coaching material) |
| Strikes inside `CAGE_PIN_FRONT` | attacker: knees to thigh (low damage, fatigue +), knees to body, short elbows, foot stomps (no damage, set up trips); defender: elbows over the top, knees, foot stomps |
| Separation ("break off the cage") | 30 % per 5 s vs competent pressure (underhook + hip-in + circle out; +10 pp if attacker's head is on the wrong side); referee stall timer per rule 24 |
| Wall walk | see §3.8: 60 % reach feet per attempt; 45 % of those end in `CAGE_PIN_FRONT` with attacker keeping a lock |

### 5.3 Fence pin sub-battle (underhook/overhook exchange)

Each 3 s tick in `CAGE_PIN_FRONT`, roll a **pummel exchange**: the winner gains one of
{underhook, double underhooks, body lock, head position}. Probability attacker wins:

```
P = 0.5 + 0.004·(WR_att − WR_def) + 0.003·(STR_att − STR_def) − 0.15·(FAT_att − FAT_def)
```

An attacker with double-unders or a body lock may then attempt trips/lifts/mat returns
(§3.5). A defender who wins double-unders may reverse to `CAGE_PIN_FRONT` with roles
swapped (25 %) or break away (35 %).

### 5.4 Dirty boxing node

`TIE_COLLAR` (open mat or cage) allows short uppercuts, hooks, elbows and knees at low volume
(striking doc governs damage). The wrestling doc only sets: each strike thrown from the tie
gives the opponent a +5 pp window for duck-under/arm-drag/snap-down (ESTIMATE), and each
knee thrown from a collar tie gives the opponent a +8 pp single-leg catch window (the
"catch the knee → single" counter).

---

## 6. Scramble model

A `SCRAMBLE` node is entered whenever a takedown or escape is *partially* successful
(single leg finished but the defender's whizzer rolled through; granby out of turtle;
limp-leg mid-finish; funk roll). It resolves within 1–2 s to a concrete node.

Resolution: compute a scramble score for each fighter

```
S = 0.5·WR + 0.2·BJJ + 0.15·speed + 0.15·flexibility − 30·FAT + funkBonus
funkBonus = +10 if the fighter has the 'funk' trait (Askren/Nickal/Cejudo style)
P(A comes out on top) = 1 / (1 + 10^(−(S_A − S_B)/40))      // 40 pts ≈ 90/10
```

Outcome distribution for the winner (ESTIMATE):

| Winner ends in | Open mat | Against cage |
|---|---|---|
| `TURTLE_TOP` on opponent | 30 % | 25 % |
| `BACK_CONTROL` | 15 % | 20 % |
| `SIDE_CONTROL_TOP` / `HALF_GUARD_TOP` | 25 % | 20 % |
| `GUARD_TOP` | 15 % | 10 % |
| `STAND_NEUTRAL` (winner had the last upper-body control) | 15 % | 25 % (as `CAGE_PIN_*`) |

Scramble energy: both fighters pay 2× normal grappling fatigue per second (scrambles are
maximal effort; coaching material universally warns of the energy tax of chain wrestling
and re-attacks). The techniques in §3.9 (sit-out, switch, granby, hip heist, funk) are
*how* the winner wins, sampled by weight from the fighter's known techniques; they modify
`S` by their listed base % rather than being separate rolls.

---

## 7. Skill-tier behaviour differences

WR scale 0–100. Tiers: Novice 0–30, Competent 30–55, Advanced 55–75, Elite 75–90,
Generational 90–100 (Khabib/GSP/Cormier/Askren/Merab/Burroughs-in-MMA).

| Behaviour | Novice | Competent | Advanced | Elite |
|---|---|---|---|---|
| Level change before shot | No (bends at the waist, reaches with arms): shots −20 pp and eat counters 30 % of the time | 60 % of shots | 90 % | Always; feinted and mixed with strikes (level-change uppercut, jab-to-double) |
| Head position on shots | Head down/outside and low: guillotine catch window ×2.5 | Correct 60 % | Correct 85 % | Correct; head "reinforces the stance" (MiddleEasy) |
| Sprawl reaction | Late/none (reaction ≥ 0.6 s): denies 20 % | Denies ≈ 50 % (population TD defence ≈ 60 % includes stalled attempts) | 65–75 % | 80–90 % (Woodley 93 %, Burgos 91.5 %, Makhachev 91 %) |
| Chain wrestling after a stall | 15 %; usually stalls in `SPRAWL_TOP` for the defender | 40 % | 65 % | 80–90 %; each chain step retains full base % |
| Timing shots off strikes | Never | 10 % of shots reactive | 30 % | ≥ 50 % reactive or setup-based; reactive shots +15 pp |
| Finish selection | One finish (usually a drive); repeats it | 2 finishes | 3–4, switches on whizzer | Full tree; picks the finish the defence hands them (Kolat: "all finishes begin when the opponent beats you with a sprawl") |
| Cage use | Doesn't drive to the fence; stalls in open-mat `SINGLE_LEG_IN` and loses it to hops/limp leg | Drives to fence 50 % | 75 % | 90 %; converts open-mat stalls into cage chains |
| Bottom-side stand-up | Turns away, gives back (30 % of attempts cost `BACK_CONTROL`) | Technical stand-up 25 % per attempt | Wall walk + kimura grip 35 % | 45–55 % per attempt; rarely gives back |
| Energy management | Shoots from far; 2× energy per attempt | Normal | Fewer wasted shots | Attempts per landed TD ≈ 1.6 vs population ≈ 2.5 |
| Ride/top retention after TD | Loses position within 30 s 55 % of the time | 40 % | 25 % | 15 % (Ma et al.: winners ≈ 100 s control per TD) |

Discipline-background modifiers on WR sub-skills (transfer to MMA, per FloWrestling/MatTime
/coaching consensus; the Greco figure is a design choice, see §10):

| Background | Leg attacks | Upper-body / clinch / cage | Mat returns & rides | Scrambles | Notes |
|---|---|---|---|---|---|
| Freestyle | +10 | 0 | +5 | +5 | Best direct transfer of shots; freestyle rewards exposure not control, so top retention is slightly weaker than folkstyle. Gut wrench/leg lace do not transfer. |
| Folkstyle (NCAA) | +8 | +2 | +10 (riding-time culture; NCAA 2024 rules cut riding time 20 %) | +10 (funk, granby, sit-outs, escapes are folkstyle-specific) | Best transfer for control/top retention and bottom stand-ups |
| Greco-Roman | −5 (no leg attacks) | +15 (pummeling, body lock, throws, posture, cage pressure) | +5 (lifts/mat returns) | 0 | Widely held to be over-represented among UFC champions (Couture, Henderson, Sonnen-era lore) because MMA fights migrate to the fence where Greco skills dominate |
| Judo / Sambo | −5 | +10 (trips, throws from over-under) | +5 | 0 | Overlaps with Greco in the cage model; throw/salto risk +5 pp |
| BJJ-only | −15 | −5 | −5 | +5 | Uses guard pulls / kimura stand-ups rather than shots |

---

## 8. Data tables with sources

### 8.1 UFC / MMA population statistics

| Metric | Value | Source |
|---|---|---|
| Average TD accuracy (all fighters, UFCStats) | ≈ 42 % | Fight Encyclopedia compilation of ufcstats.com: https://fightencyclopedia.com/blog/blog-most-effective-takedowns-in-mma-by-success-rate |
| Average TD accuracy among leaderboard-qualifying fighters | a little under 38 %; ≈ 2 in 5 clear 40 %; ≈ 1 in 6 exceed 50 % | https://agentmma.com/mma-lab/ufc-takedown-trends |
| Average landed TDs per 15 min per fighter | 1.65 | https://content.shurzy.com/post/ufc-betting-explained-takedown-rate-defense-metrics |
| Winner median TD accuracy / loser median | 50.0 % [IQR 22.2–83.3] / 20.0 % [0–50] | Ma et al. 2026, BMC Sports Sci Med Rehabil, 8,461 UFC bouts 1997–2025: https://pmc.ncbi.nlm.nih.gov/articles/PMC13523191/ (also https://link.springer.com/article/10.1186/s13102-026-01804-8) |
| Control time per landed TD, winners / losers | 99.75 s [57–161] / 78.88 s [43–133] | Ma et al. 2026 |
| Winner median TD density / loser | 0.0667 TD/min / 0.000 TD/min | Ma et al. 2026 |
| Men's TD density trend | −0.00426 TD·min⁻¹·yr⁻¹ (r = −0.753, p < 0.001) 1997–2025; −0.00202/yr from 2002; women 2013–2025 not significant | Ma et al. 2026 |
| Weight-class TD density (P50/P75/P90, TD/min) | FLW 0.067/0.200/0.344; BW 0/0.133/0.279; LW 0/0.200/0.333; WW 0/0.158/0.328; MW 0/0.162/0.333; HW 0/0.120/0.299 | Ma et al. 2026 |
| Weight-class effect | HW and LHW lower TD density than lighter/mid divisions; Kruskal-Wallis H = 105.8, p < 0.001, ε² ≈ 0.0066 (small) | Ma et al. 2026 |
| Distance (open-mat) TD success, UFC average | ≈ 30–31 % | FightMetric data quoted in Bloody Elbow alternative-stats columns ("55 % at distance vs 31 % average"; "lands 38 % with a 30 % average"): https://bloodyelbow.com/2019/02/27/ufc-235-jones-smith-woodley-usman-alternative-statistics-mma-editorial/ ; https://bloodyelbow.com/2018/10/02/ufc-229-khabib-nurmagomedov-conor-mcgregor-alternative-statistics-mma-editorial/ (paywalled; figures from search excerpts) |
| Cage size effect | Distance TD attempts 5.7 % lower success in the smaller cage | Bloody Elbow analytics 2015: https://bloodyelbow.com/2015/06/30/mma-be-analytics-ufc-octagon-cage-size-finishes-knockouts-submissions-decisions/ |
| Time on ground with someone in control | 38.1 % of fight time (1:54 per 5-min round) | Bloody Elbow analytics 2014: https://bloodyelbow.com/2014/03/26/ufc-mma-analytics-ground-control-fighters-win-knockout-tko-submission-decision/ |
| Double leg share of all landed UFC TDs | ≈ 32 % | https://fightencyclopedia.com/blog/blog-what-is-a-double-leg-takedown-explained-with-data |
| TD success by type (MMA) | double 43–50 %; single 35–42 %; body lock 50–60 %; inside trip 45–55 %; outside trip 45–53 %; arm-drag sequence 38–45 % | Fight Encyclopedia (UFCStats compilation; methodology loosely documented): https://fightencyclopedia.com/blog/blog-most-effective-takedowns-in-mma-by-success-rate |
| Elite accuracy examples | GSP ≈ 74 %; Askren ≈ 78 %; Cormier ≈ 72 %; Khabib ≈ 68 %; Makhachev 56 % acc / 91 % def / 3.10 TD per 15 min; Machida 65 %; C. Anderson 50 % | Fight Encyclopedia; Shurzy; https://numbersmma.substack.com/p/whittakergastelum-pennecabbage-skewed |
| Elite defence examples | Woodley 93 %; Burgos 91.5 % (9th all-time); Makhachev 91 %; I. M. Garry 80 % | Bloody Elbow UFC 235 column; https://www.thesportster.com/ufc-fighters-best-takedown-defense-stats/ ; Shurzy |
| Wrestling base vs other bases | Wrestling-base fighters outperformed all other bases on TD success; wrestlers held ≈ 35–38 % of UFC titles 2010–2018 | Coswig, Miarka et al. 2019 (416 UFC fights), as summarised by Fight Encyclopedia |
| Interpretive benchmarks | > 50 % accuracy = highly efficient; > 70 % defence = strong; 75–80 %+ defence stuffs most average wrestlers | https://www.fightmatrix.com/2025/01/02/stats-and-metrics-to-use-when-betting-on-ufc-fights/ ; https://www.cagequant.com/learn/ufc-fighter-stats-explained ; https://content.shurzy.com/post/how-to-use-takedown-defense-stats-to-predict-ufc-upsets |

### 8.2 Freestyle / folkstyle wrestling statistics

| Metric | Value | Source |
|---|---|---|
| Leg-attack success, international, winners / losers | 74 % / 40 % | Cipriano 1993, J Strength Cond Res, "A technical-tactical analysis of freestyle wrestling": https://journals.lww.com/nsca-jscr/abstract/1993/08000/a_technical_tactical_analysis_of_freestyle.2.aspx (as cited in Frontiers 2020) |
| Single-leg success, winners / losers | 73.1 % / 25.0 % | technical-tactical analysis cited by Frontiers 2020 / Fight Encyclopedia |
| Leg-attack success, Japanese tournament, winners / losers | 100 % / 66.7 % | Fujiyama et al. 2019, cited in https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2020.00058/full |
| Elite double-leg completion at world level | 50–65 % | Fight Encyclopedia double-leg article |
| Double-leg penetration mechanics | movement time 0.43 ± 0.05 s elite vs 0.47 ± 0.07 s non-elite (n.s.); elite peak trailing-leg GRF 1.60 vs 1.34 BW (p = 0.042); time-to-peak 0.25 vs 0.30 s (p = 0.046); peak COM velocity ≈ 2.3–2.4 m/s; forward COM displacement ≈ 0.4 m | Frontiers in Sports and Active Living 2020: https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2020.00058/full |
| Attack efficacy, men's freestyle | 1.1 pts/min (London 2012) → 1.6 pts/min (Rio 2016); leg attacks the dominant technique, then gut wrench | Tünnemann & Curby 2016, Int J Wrestling Science 6:90–116: https://www.researchgate.net/publication/317832607_Scoring_Analysis_of_the_Wrestling_from_the_2016_Rio_Olympic_Games |
| 2015 Worlds | Majority of gold-medalists' points from leg attacks; a setup before the leg attack raises its success | Tünnemann & Curby 2016 (summarised in https://dergipark.org.tr/en/download/article-file/4721563) |
| Physical profile, Greco vs freestyle juniors | Greco faster, more agile, greater leg strength; freestyle more flexible | https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4120459/ |
| NCAA 2023-24 rule change effect | Takedown 3 pts; riding time at the 2024 NCAAs fell 20.1 % vs prior years | https://www.ncaa.org/news/2023/6/8/media-center-3-point-takedown-approved-in-wrestling.aspx ; https://tapedlaces.com/2024/03/30/ncaa-wrestling-rule-changes-2024/ |

### 8.3 Rules and coaching references

| Source | Key points used |
|---|---|
| UWW International Wrestling Rules (Dec 2025): https://cdn.uww.org/2025-12/wrestling_rules_1.pdf ; FloWrestling scoring guide: https://www.flowrestling.org/articles/11184753-how-to-score-an-olympic-wrestling-match | Takedown = control with 3 points of contact: 2 pts; feet-to-danger 4 pts; grand amplitude 5 pts; passivity → 30-s activity period |
| NCAA 3-point takedown: https://www.ncaa.org/news/2023/6/8/media-center-3-point-takedown-approved-in-wrestling.aspx ; https://www.on3.com/news/ncaa-wrestling-rule-changes-three-point-takedown-nearfall-2023-24-season-video-review/ | Takedown 3 pts (hand-touch TD removed); near fall 2/3/4 pts for 2/3/4 s; reversal 2; escape 1 |
| Style differences: https://www.flowrestling.org/articles/11186163-what-are-the-differences-between-folkstyle-freestyle-greco-roman ; https://mattime.app/compare/greco-roman-vs-freestyle-wrestling/ | Folkstyle rewards control, freestyle rewards exposure; Greco = no attacks below the waist |
| Unified-rules cage notes: https://middleeasy.com/guides/mma-wall-wrestling | Fence grabbing with fingers/toes is a foul; open-hand posting allowed; scoring priority striking > grappling > aggression > cage control; head/inside-arm/hips "three-layer stack" for wall wrestling |
| Cage defence coaching: https://evolve-mma.com/blog/how-to-use-the-cage-wall-to-escape-takedowns-in-mma/ ; https://blogs.rdxsports.com/mma-cage-wall-defense/ ; https://fanaticwrestling.com/blogs/news/escape-the-cage-with-zack-esposito | Hip-in, underhook + post, do not get flattened, wall walk mechanics |
| Cary Kolat curriculum: https://www.kolat.com/4-to-6-year-teaching-curriculum.html ; https://www.kolat.com/blog/single-leg-mat-finish-session1 ; https://www.kolat.com/sprawl/-sprawl | "All finishes begin when the opponent beats you with a sprawl"; vs sprawl: cut across, explode to double, run the pipe → double |
| Chael Sonnen (Fanatic Wrestling): https://fanaticwrestling.com/blogs/news/3-basic-wrestling-techniques-with-chael-sonnen ; https://mixedmartialarts.com/news/chael-sonnen-the-single-leg-takedown-doesnt-exist-in-mma/ | Underhook → high crotch/single; double leg = "change levels, run"; prefers double over single in MMA (single hands the defender both your hands) |
| Fight Encyclopedia technique pages: https://fightencyclopedia.com/techniques/takedown/leg-attack-takedown/single-leg-takedown/single-leg-finish/run-the-pipe | Run the pipe mechanics and counters (sprawl, underhook, post-and-circle, level-change defence) |
| Takedown taxonomy (Mixing Martial Arts): https://www.mixingmartialarts.com/p/takedown-taxonomy-a-guide-to-takedown | Entry categories: distance shots, reactive, footwork setups, split-step, stance-dependent; defensive layers head/hands/hips/distance |
| Dan Gable, *Coaching Wrestling Successfully* (Human Kinetics): https://us.humankinetics.com/products/coaching-wrestling-successfully ; penetration-step cues: https://www.parentedge.com/drills/wrestling/penetration-step | Level change → hips low and forward → lead-foot drive |

### 8.4 ESTIMATE tables (no public data; researcher calibration)

**Time to complete a takedown (initiation → ground node)**

| Entry | Clean (no resistance) | vs competent defender (median) | 90th percentile (chain/cage grind) |
|---|---|---|---|
| Blast double, open mat | 1.0 s | 2.5 s | 8 s |
| Single leg, open mat | 1.5 s | 4 s | 15 s |
| High crotch → double | 1.5 s | 3 s | 8 s |
| Body lock trip/lift | 1.0 s | 3 s | 10 s |
| Cage single/double | 2 s | 8 s | 40 s |
| Rear body lock mat return | 1 s | 4 s | 20 s |
| Snap → go-behind | 1.5 s | 3 s | 6 s |

**Bottom fighter returns to feet after a completed takedown** (anchored on Ma et al. median
control ≈ 80–100 s per TD, 38 % of fight time on the ground, and wall-walk coaching material)

| Time since TD | Open mat, competent vs competent | Against cage | Elite top vs competent bottom | Novice top vs competent bottom |
|---|---|---|---|---|
| back up within 30 s | 30 % | 35 % | 12 % | 50 % |
| back up within 60 s | 45 % | 55 % | 25 % | 70 % |
| back up within 120 s | 65 % | 75 % | 45 % | 85 % |
| still down at round end (TD at 3:00 of 5:00) | 30 % | 22 % | 50 % | 12 % |

**Top-position retention right after the takedown** (node the top fighter stabilises in
within 3 s):

| Landed via | Stabilises top ≥ 10 s | Immediate scramble | Bottom stands straight back up (wall) |
|---|---|---|---|
| Double leg, open mat | 70 % | 15 % | 15 % |
| Single leg (run the pipe) | 60 % | 25 % | 15 % |
| Body lock / trip | 75 % | 10 % | 15 % |
| Cage takedown (any) | 65 % | 10 % | 25 % (immediate wall walk) |
| Snap-down / go-behind | 55 % (turtle is unstable) | 30 % | 15 % |
| Low single / ankle pick | 50 % | 35 % | 15 % |

---

## 9. Sim rules to implement

All probabilities are per attempt unless noted. Clamp final probabilities to [0.03, 0.95].

1. **Base attempt probability** for a takedown edge = table base % (§3). Defaults if a
   technique is unlisted: open-mat leg attack 0.40, clinch/body-lock TD 0.52, cage TD 0.50,
   throw 0.30.
2. **Wrestling skill differential:** `P += 0.005 × (WR_att − WR_def)`; a 40-point gap moves
   a 0.40 double to 0.60. This reproduces winners' 50 % vs losers' 20 % (Ma et al.) for
   typical skill spreads.
3. **Strength and mass:** `P += 0.002 × (STR_att − STR_def)` and `P += 0.004 × MASS_diff_kg`
   for drive/lift/body-lock finishes; half those coefficients for singles/low singles/ankle
   picks (technique-dominated).
4. **Fatigue:** `P −= 0.25 × FAT_att` for shots (fatigued fighters shoot from too far and
   without a level change); `P_defence −= 0.20 × FAT_def` for sprawls. Above FAT 0.7 the
   attacker's chain probability (rule 9) is halved.
5. **Setup bonus:** +0.15 if the shot is reactive to a committed strike or immediately
   follows a landed jab/level-change feint within 0.5 s; −0.15 if shot with no setup from
   > 1.5 m (telegraphed). Novices never get the setup bonus.
6. **Head-position / guillotine tax:** on every leg attack the defender rolls a guillotine
   catch: 0.12 base, ×2.5 if attacker tier is Novice, ×0.5 if Elite, +0.10 if defender
   BJJ ≥ 70. A catch moves to the submission doc's standing-guillotine node; the takedown
   may still complete (attacker "finishes into the guillotine" 0.60).
7. **Cage flags:** if `againstCage`: capture +0.12, drive/lift/trip finishes +0.10,
   run-the-pipe −0.25, defender sprawl −0.10, finishing time ×1.5, pinned defender energy
   ×1.3. Open-mat distance shots use the 30–31 % anchor: multiply the open-mat base by 0.85
   when the attacker shoots from > 1.2 m.
8. **Two-stage resolution:** every leg attack rolls *capture* then *finish*. Capture failure
   → `SPRAWL_TOP` (defender) 0.50, `STAND_NEUTRAL` 0.35, `FRONT_HEADLOCK` (defender) 0.15.
   Finish failure keeps `*_LEG_IN` for another attempt (max 3 attempts open mat, 6 on the
   cage) unless the defender rolls a kick-out/limp-leg (0.35) or whizzer throw (0.15).
9. **Chain wrestling:** after a stalled capture the attacker chains with probability
   `0.15 + 0.008 × WR_att` (novice 0.15, elite 0.80). A chained follow-up uses its own base
   with −0.10 for a second shot, +0.10 if the defender's hands are on the mat / posture is
   bent. Each chain step costs 1.5× shot fatigue.
10. **Sprawl reaction window:** the sprawl fires only if defender reaction time (attribute,
    0.25–0.7 s) ≤ 0.45 s (+0.10 s if the attacker telegraphed). Sprawl denial: novice 0.20,
    competent 0.50, advanced 0.70, elite 0.85; −0.20 × FAT_def.
11. **Whizzer:** when the attacker's head is outside on a single, the defender applies a
    whizzer with 0.60 chance if WR_def ≥ 40. A whizzer applies −0.20 to run-the-pipe/dump;
    the attacker's best answer is the switch to double (0.40 → `DOUBLE_LEG_IN`).
12. **Snap-down / front headlock:** snap 0.35 (+0.25 vs bent-over novice); go-behind 0.45;
    submissions per submission doc (guillotine catch 0.25, anaconda/D'Arce 0.20). After 4 s
    with no progress the front headlock decays to `STAND_NEUTRAL` (0.60) or `TIE_COLLAR`
    (0.40).
13. **Body lock / trips:** establishing a body lock from a tie is a pummel roll every 3 s
    (§5.3). From `BODY_LOCK`: inside trip 0.50, outside trip 0.48, lift-return 0.55, with
    STR/MASS coefficients doubled. Greco/judo background +0.10 on these edges.
14. **Rear body lock:** mat return 0.55 (0.70 with knee-behind-knee on the cage). Suplex/lift
    0.35, +0.15 Greco; 10 % of successful lifts trigger a salto-risk roll → `SCRAMBLE`.
    Defender wrestle-up 0.30 per 3 s.
15. **Landing-node distribution** after a completed TD: double → guard 0.60 / half 0.30 /
    side 0.10; single (run the pipe) → guard 0.55 / half 0.35 / side 0.10; body-lock lift or
    outside trip → side 0.45 / half 0.40 / guard 0.15; inside trip → guard 0.55 / half 0.40
    / side 0.05; rear body lock mat return → turtle-top 0.55 / back 0.30 / side 0.15;
    snap-down → turtle-top 0.60 / back 0.40; low single / ankle pick → open-guard top 0.60 /
    scramble 0.35 / side 0.05.
16. **Post-TD retention:** apply the §8.4 retention table on landing; subsequent stand-up
    rolls use rule 17.
17. **Getting up:** each stand-up attempt (technical stand-up 0.25, wall walk 0.35 clean
    separation, kimura-grip 0.35, turtle-with-cage 0.50 to feet) takes 2–6 s and
    `P += 0.004 × (WR_bot − WR_top) + 0.10 × FAT_top`. A failed attempt gives the top
    player a free strike tick or a back-take roll (0.15). Wall walks that reach the feet but
    fail to separate resolve to `CAGE_PIN_FRONT` (attacker keeps a body lock) 0.45,
    `STAND_NEUTRAL_CAGE` 0.35, back to the ground 0.20.
18. **Rides:** in `TURTLE_TOP`, per 5 s: hook-in → `BACK_CONTROL` 0.35 (+0.10 folkstyle);
    retain turtle 0.40; bottom stands/escapes 0.25 (−0.10 vs a folkstyle top player).
19. **Scrambles:** on any partial success enter `SCRAMBLE`, resolve in 1–2 s with the §6
    logistic (40 skill points ≈ 90/10) and the §6 outcome table; 2× fatigue rate.
20. **Weight class:** scale a fighter's *propensity* to attempt takedowns (AI decision layer)
    by division: FLW/BW/FW 1.15, LW/WW 1.0, MW 0.95, LHW/HW 0.75 (Ma et al. density
    ordering). Success probability is not weight-class-scaled beyond the MASS/STR terms.
21. **Volume anchor:** an average AI fighter should produce ≈ 4 TD attempts and ≈ 1.65 landed
    TDs per 15 min against an average opponent; a wrestler archetype ≈ 8 attempts / 3–4
    landed (Makhachev 3.10 per 15). Use this to sanity-check the decision layer.
22. **Skill-tier behaviours (AI):** novice: no level change (shot −0.20), reaching arms, no
    sprawl (defence 0.20), stalls in `SINGLE_LEG_IN`; elite: reactive shots ≥ 50 % of
    attempts, chain 0.80, cage drive 0.90, finish selection by defence type (§7).
23. **Strikes inside wrestling nodes:** knees to thigh/body from `CAGE_PIN_FRONT` (fatigue
    damage, low KO), foot stomps (no damage, +0.05 to the next trip), elbows from
    `TIE_COLLAR` (striking doc). Defender knees from `SPRAWL_TOP` get a +0.10 head-damage
    multiplier if the attacker's head is down.
24. **Referee separation:** in `CAGE_PIN_*` or `TIE_*` with no scoring action for 15 s, start
    a break timer: 0.50 probability of a break per further 5 s (ESTIMATE; expose as a
    referee-variance parameter).
25. **Energy accounting:** a full shot costs the attacker ≈ 3× the energy of a jab
    (ESTIMATE); a failed shot ending in `SPRAWL_TOP` costs the *defender* 1.5× (sprawl +
    drive); cage pins tax the pinned fighter 1.3× per second; scrambles 2× for both.

---

## 10. Assumptions and gaps

- **No public per-technique TD data with sample sizes.** Fight Encyclopedia's ranges
  (double 43–50 %, single 35–42 %, body lock 50–60 %) are compilations from UFCStats without
  a published methodology; treat them as directional. UFCStats records only takedowns
  landed/attempted with no technique tag. Ma et al. explicitly note that takedown type, cage
  location and round phase were not available.
- **Distance vs clinch averages** (≈ 30–31 % distance) come from FightMetric numbers quoted
  in paywalled Bloody Elbow columns (2015–2019); the equivalent clinch average was not
  retrievable. The cage numbers in §5 are ESTIMATE calibrated so the population lands at
  ≈ 40 % overall.
- **Time-to-stand-up and retention curves** (§8.4) are ESTIMATE. The only anchors are median
  control time per TD (≈ 80–100 s), 38 % of fight time on the ground, and the finding that
  the median UFC fighter-bout has zero landed takedowns.
- **Takedown execution times** are ESTIMATE except the 0.43–0.47 s penetration-step duration
  (lab, unopposed, elite freestyle wrestlers).
- **Freestyle success rates** (74 %/40 % leg attacks, 73 %/25 % single leg) are 1990s-era
  winner/loser splits, not attacker-vs-competent-defender rates; they mainly establish that
  skill gaps produce ~2:1 conversion differences.
- **Greco over-representation among MMA champions** is anecdotal (forum discussion and
  commentator lore), not measured; the +15 clinch modifier is a design choice.
- **Salto/suplex risk, foot stomps, knee-to-thigh effects, whizzer-throw rates, funk
  scramble rates** have no data; all ESTIMATE from coaching material (Kolat, Sonnen/Fanatic
  Wrestling, Fight Encyclopedia technique pages, Evolve/RDX cage-defence guides).
- **Sonnen's "the single leg doesn't exist in MMA"** is a coaching opinion (he prefers the
  double because a single hands the defender both of the attacker's hands); the sim keeps
  singles at a lower base % than doubles and heavily cage-dependent, consistent with it.
- **Women's divisions:** Ma et al. found no significant weight-class differences and a stable
  TD density 2013–2025; use the same rules without the division propensity scaling.
- **Interactions with striking/ground docs:** landing-node distributions and guillotine catch
  rates must be reconciled with the BJJ/ground and submission docs; the striking doc owns
  damage from knees/elbows in clinch nodes.
- No peer-reviewed cage-vs-open-mat comparison exists beyond the 2015 cage-size study; the
  Frontiers 2020 mechanics paper is the only lab study of shot timing found.
