# Muay Thai & Kickboxing — Research Brief for the Bout Simulator

Discipline research agent output. Feeds the design doc where each technique becomes a state-machine action with requirements, success probabilities and counters.

Conventions used in this document:

- **Sourced** numbers carry a bracketed source tag `[Sx]` that resolves in section 7.4.
- **ESTIMATE** = a number the author supplies from coaching consensus or inference where no measured data was found. Treat as a tunable default, not a fact.
- **Skill tiers** used throughout: T0 beginner (<1 yr), T1 amateur (1–3 yr, a few bouts), T2 regional pro / experienced amateur, T3 national-level pro, T4 elite (stadium champion / GLORY-UFC top-15).
- Timing values are for a single technique thrown from a set stance, adult male fighter, ~70 kg. Scale with weight class (heavier = slower recovery, higher force).

---

## 1. Summary

1. **Round kicks are the highest-value strike in the Thai ruleset and the highest-force strike in the kickboxing/MMA arsenal.** Elite Muay Thai roundhouses are measured at ~7.2 m/s foot velocity and ~1,400 N mean pad force in lab conditions (Gavagan & Sayers 2017) with older accelerometer-in-bag work reporting peaks up to ~14,000 N (Sidthilaw 1997). The Thai kick trades knee-extension speed for whole-body mass transfer: shorter chamber, deeper hip turn (~490°/s pelvic rotation), knee still 43° flexed at impact, body travels *into* the target. That is why it hurts through a block and why it is comparatively slow to recover from. [S1][S2][S3]
2. **Execution time is the central balancing lever.** Lab whole-movement time for an expert Thai roundhouse from movement onset to impact is ~1.0 s (includes the step); the *observable* window from foot lift to impact is roughly 300–450 ms (ESTIMATE from TKD data 250–400 ms plus Thai step). Teeps and calf kicks are faster (~250–350 ms); head kicks, question-mark kicks and spinning techniques are slower and more telegraphed. Recovery back to stance adds 300–600 ms depending on tier and whether the kick landed, was checked, or missed. [S1][S4]
3. **Checks are the great equaliser.** A checked kick returns damage to the kicker (shin-on-shin, upper-shin/knee vs distal shin). Two UFC title fights (Silva–Weidman UFC 168, Weidman–Hall UFC 261) ended by tibia/fibula fracture on a checked kick. Cumulative checks reliably reduce kick output. [S5][S6][S7]
4. **Calf kick is the MMA meta because MMA stances are wide, front-heavy and square (for takedown defence), which makes the lead calf available and hard to lift. Its effect is neurological (peroneal nerve), not purely accumulative:** 1–3 clean hits can produce foot-drop, and most sources put visible mobility loss at 5–10 clean calf kicks. It is checkable but the check window is short. [S8][S9][S10]
5. **Catches follow body kicks, not low kicks.** A caught body kick in Muay Thai leads to a sweep/dump, a knee, or the clinch; in MMA it leads to a takedown. Muay Thai stadium rules allow only two *forward* steps while holding the leg before a strike must be thrown; K-1/GLORY-style rules allow one strike then release, no sweeps. [S11][S12][S13]
6. **The clinch is a positional game, not a static "plum".** The double-inside neck tie is narrow and counterable (cross-face, swims, turns). Dominance comes from a frame (one hand behind neck + elbow on collarbone, other hand inside the elbow), head pressure, hip distance, and turning the opponent off-balance. Knees from the clinch are scored heavily in Thailand; in K-1/GLORY the clinch is one strike then break; in MMA the clinch merges with wrestling. [S14][S15][S16]
7. **Scoring culture drives behaviour.** Thai stadium judging: clean body kicks and knees dominate, balance/composure after exchanges is scored, losing balance or being swept loses the exchange, rounds 1–2 are lightly weighted. IFMA: count skills first, then force. ONE/GLORY/K-1: damage and knockdowns first, all strikes equal. This changes strike selection more than any physical variable. [S17][S18][S19][S20]
8. **Elbows are the primary cut mechanism**: 84% of pro facial lacerations in a Muay Thai injury cohort were from elbows; lacerations were 14.4% of all injuries; GLORY and K-1 ban elbows precisely because cuts end fights inconclusively. [S21][S22]
9. **Skill tier changes *what* is thrown and *what happens after*, not just hit rates:** beginners telegraph, under-rotate the hip, fall off balance, don't return to stance, and don't check. Elite fighters chain kicks off punches (Dutch style), disguise level (question mark), and treat the return-to-stance as part of the strike. [S23][S24]

---

## 2. Technique Catalogue

Range bands: **L** = long (kick range, outside punching range), **M** = mid (punching range), **S** = short (elbow/knee range), **C** = clinch. Power tier: 1 (jab-like) to 5 (fight-ending single shot). Commitment/balance cost: 1 (none) to 5 (falling if missed). Accuracy vs *competent* defender = T2 attacker vs T2 defender, "landed with effect" (clean or through a partial block that still scores/damages), ESTIMATE unless tagged. Execution time = foot/hand leaves stance → impact, ESTIMATE unless tagged; recovery = impact → back in stance.

| # | Technique | Range | Setup requirements | Exec (ms) | Recovery (ms) | Accuracy vs competent def. | Power | Commit / balance cost | Best counters (for defender) | Defences that beat it |
|---|---|---|---|---|---|---|---|---|---|---|
| K1 | Rear round kick, **low (thigh)**, shin | L→M | Distance; opponent's weight on lead leg; ideally hands occupied by a punch | 350–450 | 350–500 | 0.55–0.65 | 3 | 2 | Straight punch as kick lands (leg committed) [S25]; return low kick; catch is rare at thigh height | **Check** (shin/knee raise), step back, step in and smother |
| K2 | Rear round kick, **body**, shin | L | Distance; opponent's elbow/guard not glued to ribs; often after a jab/teep | 400–500 | 400–600 | 0.45–0.55 (partial blocks common) | 4 | 3 | **Catch → sweep/dump/knee/takedown**; punch over the kick; lean-back + counter kick | Elbow/forearm block (absorbs but hurts), catch, step in, teep-jam |
| K3 | Rear round kick, **head**, shin/instep | L | Opponent's guard low or hands busy; level change disguise; flexibility | 450–600 | 500–700 | 0.20–0.35 | 5 | 4 | Duck-under → takedown (MMA); punch as kicker's hip opens; step in and clinch | High guard / forearm block, lean back, step inside the arc |
| K4 | **Switch kick** (lead leg round kick after hop-switch) | L | Space to switch; targets body/head of orthodox vs orthodox open side | 400–550 (switch adds ~100–150) | 400–600 | 0.45–0.55 body | 3–4 | 3 | Punch during the switch (visible tell), teep the planted leg, catch | Check, block, teep-jam the switch, step off |
| K5 | **Lead-leg round kick** (no switch) | L→M | Quick range change; lighter | 300–400 | 300–400 | 0.45 | 2 | 2 | Counter punch, catch | Check, block |
| K6 | **Question-mark kick** (chamber low, whip high) | L | Established low-kick/teep pattern first (≥2 prior low kicks or teeps in the fight); guard reacting low | 450–600 | 500–700 | 0.15 baseline → 0.35 after conditioning setup | 5 | 4 | Punch on the pause at chamber; step inside | Keep guard high regardless of chamber; lean back |
| K7 | **Calf kick** (rear or lead, shin to lateral calf just below knee → above ankle) | L→M | Opponent square/wide/front-heavy stance; MMA gloves; after jab or feint | 250–350 | 250–400 | 0.60–0.70 (MMA), lower vs Thai-stance opponent (0.45) | 3 (neurological) | 1–2 | Cross/overhand as it lands; check-and-return; leg catch is very rare | **Early check** (short window), step back, stance switch, lead-leg lift/retract |
| K8 | **Oblique kick** (push kick above/into knee) | L | Opponent stepping in or planting front leg; MMA legal; banned/grey elsewhere | 250–350 | 250–350 | 0.50 | 2 (acute) / 4 (joint) | 1 | Catch (rare), punch entry | Check (knee raise), stance switch, step back |
| T1 | **Lead teep** to body | L | Space; distance-control intent | 250–350 | 250–350 | 0.55–0.65 (body contact incl. pushing) | 2 | 1 | Catch → sweep/takedown; sidestep + punch/kick; parry down and step in | Parry/redirect, step off line, catch |
| T2 | **Rear teep** to body | L | Committed distance; opponent advancing | 350–450 | 400–550 | 0.50 | 3 | 2–3 | Catch, sidestep + counter | Parry, catch, step off |
| T3 | Teep to **thigh/hip** (stop-kick) | L | Opponent stepping in | 250–300 | 250–350 | 0.60 | 1–2 | 1 | Punch entry, catch | Check, step around |
| T4 | Teep to **face** (jumping/lead) | L | Opponent low guard / ducking; scoring show-off | 350–500 | 400–600 | 0.20 | 4 | 3 | Catch → dump; walk down | Parry, step off |
| E1 | **Horizontal elbow** (sok tat) | S/C | Inside punching range; clinch break or after a parry | 150–250 | 150–250 | 0.45–0.55 | 4 (cut risk high) | 2 | Counter elbow, knee, clinch | High guard, step back, frame |
| E2 | **Upward elbow** (sok ngad) | S/C | Opponent's guard high or head forward (clinch) | 150–250 | 150–250 | 0.40 | 4 | 2 | Head control, knee | Posture, frame under chin |
| E3 | **Downward / 12-6 elbow** (sok sab) | S/C | Opponent bent forward, snapped down, or on the cage; illegal on downed opponent in MMA per unified rules (12-6 legalised 2024 in US unified rules; verify state) | 200–300 | 250–350 | 0.35 | 5 (cuts, skull) | 3 | Level change / takedown | Posture, pull head away |
| E4 | **Diagonal / slashing elbow** (sok chieng) | S | Same as E1 | 150–250 | 150–250 | 0.45 | 4 (cuts) | 2 | Counter elbow | High guard |
| E5 | **Spinning elbow** (sok klap) | S→M | Opponent pressing forward on a line; after a blocked round elbow | 400–600 | 500–700 | 0.20–0.30 | 5 | 4 | Step back and punch the exposed back; takedown (MMA) | Step back, step to the spinning side |
| N1 | **Straight knee** (lean-back / long knee) | M→S | Opponent moving in or body open; step | 300–450 | 400–500 | 0.45 | 4 | 3 | Catch the knee and dump; punch over it; takedown (MMA) | Elbow/forearm block, step off, hip check |
| N2 | **Curved / side knee** (chicken-wing, to ribs) | C | Clinch established | 200–350 | 150–250 | 0.60 (from dominant tie) | 2 | 1 | Return knee, knee block with own thigh | Hip distance, turn |
| N3 | **Clinch knee** (stabbing / pull-in) | C | Dominant inside position or head control | 250–400 | 200–300 | 0.55 dominant / 0.30 neutral | 3–4 | 2 | Knee shield, turn, swim to inside | Posture, hip-in, knee shield |
| N4 | **Flying / jumping knee** | L→M | Opponent shooting, ducking, or backed to ropes; committed | 500–700 | 700–900 | 0.20 | 5 | 5 | Sidestep + counter, takedown when landing | Step off line, high guard |
| S1 | **Spinning back kick / heel** (KB) | L | Opponent square and linear | 500–700 | 600–800 | 0.25 | 5 | 4 | Step off, punch the back | Step to spin side, block with elbow |
| D1 | **Dutch combo: punch-punch-low kick** (e.g. jab-cross-rear low, or liver hook → low kick) | M→L | Sequence; each punch gates the next | 350–450 for the terminal kick | as K1 | Kick accuracy +0.10 vs bare K1 (hands occupy guard, weight shifted to lead leg) [S25][S26] | 3 | 2 | Check the kick while covering; counter straight between punches | Check with hands up; step back after 2nd punch |

Notes on mechanics feeding the table:

- **Chambering & contact surface.** Thai style: minimal chamber, leg swings as a bat, shin (lower third for range, mid-shin ideal) is the weapon; instep is used for reach/head and by beginners (foot injuries higher). Kicking with the foot rather than shin is a T0/T1 tell. Knee remains ~43° flexed at impact in elite Thai kicks vs ~15° in karate/TKD, indicating a "swing-through" not a snap. [S1]
- **Hip turn & step.** Pivot foot steps out ~45° and turns over; hip drives through; arm on the kicking side swings down for counter-balance. Insufficient hip rotation = "leg swing" (weak, catchable, unbalanced). [S23][S24]
- **Switch kick** puts the rear-hand-side hip into the kick from the lead leg via a hop-switch; the switch is a visible tell (~100–150 ms) that skilled opponents time punches on.
- **Question-mark kick** works only after the low line has been established; treat its accuracy as a function of prior low-line kicks in the bout. [S27]
- **Calf kick** is low-commitment (hips stay back, no full weight transfer), which is why it is hard to catch and quick to recover from. [S8][S9]
- **Oblique kick** is legal in UFC, banned in GLORY (linear kicks to the knee), grey in Thai stadia (thigh legal, kneecap illegal). [S28][S29]
- **Elbows**: sok tat (horizontal) is the most common cut cause; sok sab (downward) is the skull-fracture / deep-laceration elbow. [S22]
- **Knees**: five Thai families — straight lean-back, stabbing (pull-in), chicken-wing (fast, low power, tiring), cross-hatch (inside, rotational), sky-piercing (pincer, no lean-back). Hip drive distinguishes effective knees. [S16]

---

## 3. Defence Catalogue

Probabilities are ESTIMATE for T2 vs T2 unless tagged. "Outcome" describes the post-defence state the state machine should transition to.

| Defence | Applies to | P(attempt succeeds) T2 vs T2 | Outcome on success | Outcome on failure | Cost to defender |
|---|---|---|---|---|---|
| **Shin check** (lift lead leg, knee ~45° out, shin vertical, contact with upper shin/knee) | K1, K4/K5 low, K7 (short window), K8 | Low kick 0.55; calf kick 0.35; body kick 0.30 (check-high) | Kicker takes **shin damage** (see §5.2); defender takes 0–20% of kick damage; kicker's balance −1; opportunity for defender to return a kick or punch while kicker re-plants | Kick lands on thigh/calf with full effect; late lift can add damage (kick catches the knee/ankle) | Momentary single-leg stance (200–300 ms) → vulnerable to punches, teep-to-chest, and, in MMA, a takedown if the opponent feints the kick |
| **Knee raise / knee block** (knee driven up toward the kick, elbow-to-knee for body) | K1, K2 (with elbow), N1 | 0.45 body, 0.50 low | Kick absorbed on knee/elbow, partial damage 20–40%; kicker's shin/foot damaged | As above | As check; slightly slower to return |
| **Arm / forearm block** (elbow glued to ribs, forearm covers) | K2, K3, E1/E4, N1 | 0.60 body kick, 0.55 head kick | Block absorbs; defender still takes 25–40% damage to arm/ribs (Thai kicks "score through" blocks under some judging); arm fatigue accumulates | Clean hit | Guard occupied → cannot punch during the block |
| **Catch** (scoop under the kick, pin to armpit, elbow tight) | K2 primarily; T1/T2; K3 discouraged; K1/K7 almost never | Body kick 0.30 (T2), 0.45 (T4 catcher vs T2 kicker), 0.10 vs T4 kicker; teep 0.35; head kick 0.10 (and absorbs power) [S11][S30] | See **post-catch tree** below | Kick lands; defender's guard was low → +0.10 to a follow-up punch by the kicker | Momentary one-arm guard |
| **Teep-jam** (lead teep to hip/thigh/body as opponent lifts to kick or switches) | K2, K4, N4, S1 | 0.40 (needs read) | Kicker stopped mid-motion, balance −2, often stumbles back; defender scores a clean teep | Both strikes land; defender absorbs kick | Timing read required (T2+) |
| **Lean-back / sway** (upper body back, keep feet) | K3, K6, E1, E5, T4 | 0.45 head kick | Kick whiffs; kicker balance −2 and back exposed → counter kick/punch window ~400 ms | Head kick lands with reduced power (0.6×) | Low if feet stay planted; high if defender overleans (falls back / eats follow-up) |
| **Step-off / step-back** (out of range) | All kicks | 0.50 low kick, 0.55 calf, 0.40 body | Whiff; kicker balance −1; defender loses ground | Partial hit (0.5×) | Gives ground (scoring negative in aggression-weighted rulesets) |
| **Step-in / smother** (close distance into M/S as the kick starts) | K2, K3, K4, S1, E5 | 0.45 | Kick lands on thigh/upper body at low power (0.4×); defender enters clinch range | Kick lands mid-shin at power | Requires aggression, exposes to knees/elbows on entry |
| **Parry down** (hand redirect of teep) | T1–T4 | 0.55 | Teep redirected; kicker turned; window for a punch or leg-catch | Teep lands | Low |
| **Knee shield / hip-in** (clinch) | N2, N3 | 0.50 neutral, 0.30 when opponent dominant | Knee absorbed on thigh | Knee lands | Low |
| **Duck-under / level change** (MMA only) | K3, K6, N4 | 0.40 | Takedown entry with 0.6 completion bonus | Kick/knee lands (dangerous vs knees) | High risk |

### 3.1 Post-catch outcome tree (kicker's leg caught, catcher has control)

Muay Thai stadium rules: catcher may take **two forward steps** before a weapon must be thrown; backward steps unlimited; step count resets after a strike. Hip throws, calf hooks, back-of-foot trips and "ploughing" (pushing with 2+ forward steps) are fouls; sweeps with the **front of the shin** or hip volleys and dumps from a pull are legal. [S12][S13] Kickboxing (K-1/WKO/GLORY): one strike while holding, then release; no sweep/throw. [S31][S32] MMA: any takedown.

ESTIMATE for T2 vs T2, catcher chooses:

| Catcher's action | P(success) | Kicker outcome | Notes |
|---|---|---|---|
| **Sweep** the standing leg with shin (Thai) | 0.45 | Kicker on canvas: no knockdown count, but round-impact "loses the exchange", balance/composure score −; ~0 damage | +0.15 if catcher steps and pulls first ("hop" cue) [S11]; −0.20 if kicker T4 |
| **Pull-and-dump** (step back, pull, release as they fall) → knee/elbow on the way in | 0.40 dump; 0.50 the follow-up strike lands | Kicker falls into a rear knee / uppercut elbow (power 4) | Legal in Thai; in KB only the strike is legal, no pull-off-balance |
| **Knee to the body/thigh** while holding | 0.65 | Damage tier 2–3 | One strike only under KB rules; unlimited (with step rule) in MT |
| **Punch** (cross/overhand) while holding | 0.60 | Damage tier 3, head | Common in MMA/KB |
| **Return kick** to the standing leg (kick the post) | 0.55 | Damage tier 3, balance −2, often a fall | Classic Thai counter |
| **Walk forward and dump** (Thai, ≤2 steps) | 0.35 | Fall | 3rd step = foul warning |
| **Leg-catch takedown** (MMA: run the pipe, trip, or lift) | 0.55 | Kicker on bottom; catcher in top position | Numbers: single-leg from a caught kick is one of the highest-percentage takedown entries in MMA; treat as +0.20 over a cold single-leg attempt (ESTIMATE) |
| **Release and reset** | 1.0 | Neutral | Chosen by passive / tired catchers |

Kicker's escape options while caught (roll once per 300 ms of hold; ESTIMATE): immediate straight pull-back before the grip closes 0.35 (T2) / 0.55 (T4); hop and frame on the shoulder 0.30 per beat; collar-tie + knee shield 0.30; punch/elbow while held (lands 0.45, forces release 0.25); re-teep with the free leg 0.20. Twisting aggressively raises P(sweep) by 0.15. [S30]

### 3.2 Check damage to the kicker

- Physiology: the check presents the thick proximal tibia/knee to the kicker's thinner distal tibia; the kicker's leg is unsupported at impact. Outcomes range from bruising (usual) to periosteal injury to complete tib/fib fracture (rare; Silva vs Weidman, UFC 168; Weidman vs Hall, UFC 261). [S5][S6]
- Behavioural: coaching sources agree that repeated checks visibly reduce kick output over rounds. [S7]
- Sim treatment: see §5.2 and rule 12.

---

## 4. Clinch Model

### 4.1 Positions (per fighter, symmetric)

| Position | Description | Who is dominant | Actions available to dominant |
|---|---|---|---|
| **Long clinch / collar-tie** | One hand behind the head, other hand on bicep/inside elbow; arm's length | Whoever has hip distance and head control | Long knees, pull-and-knee, break with elbow, turn |
| **Double inside ("plum")** | Both forearms inside, hands clasped on the crown/neck, elbows pinching | Holder — but "narrow"; only snap-down + knee available; vulnerable to cross-face, swim, and being turned | Snap down, straight/stabbing knees, turn |
| **Frame (one-in-one-out)** | Lead hand behind neck, same-side elbow on collarbone, other hand inside the opponent's elbow; head pressure on the jaw | Frame holder (Sylvie's preferred neutral-to-dominant frame) | Turn, pull, push, swim to double inside, knees, elbows on the break, arm-lock [S14] |
| **Arm-lock / over-under** | One arm trapped under the armpit, other controls neck | Locker | Curved knees, turns, sweeps with hip/shin |
| **Body lock (waist)** | Arms around waist | Holder if hips are in; otherwise the framer | Legal in MT if it does not hyper-extend the back; hip throws illegal; in MMA → takedown |
| **Broken / posted** | One fighter has posted and created hip distance | Poster | Elbow on exit, knee on exit, disengage |

### 4.2 Dominance factors (score each 0–1, sum → dominance index)

1. **Inside position** (forearms inside opponent's) — weight 0.30.
2. **Head/posture control** (opponent's head bent, yours upright; forehead pressure on their jaw) — 0.25. [S14]
3. **Hip distance** (your hips away from theirs so knees have room; theirs pinned to yours so they cannot) — 0.20.
4. **Balance / base** (feet under you; not being turned) — 0.15.
5. **Strength & conditioning delta** (relative clinch strength, fatigue) — 0.10.

Dominance index > 0.6 = dominant, 0.4–0.6 = neutral, < 0.4 = defensive.

### 4.3 Actions (state transitions)

| Action | Requirement | P(success) T2 vs T2 (neutral) | Effect |
|---|---|---|---|
| **Swim** (pummel an arm inside) | Not fully locked | 0.45 per beat (0.65 if T4 vs T2) | +inside position |
| **Turn** (rotate opponent off their base using the frame) | Frame or inside | 0.40 | Opponent balance −2; in Thai scoring, being turned = losing the exchange; can set up dump |
| **Snap-down** (pull head down) | Double inside or head control | 0.35 | Opponent posture broken → knee window +0.20; if head goes below hips, downward elbow window (MT) |
| **Knee** (straight / curved / stabbing) | See N2/N3 | 0.55 dominant, 0.30 neutral, 0.15 defensive | Damage; scores strongly in MT |
| **Knee shield / hip-in** | Any | 0.50 | Blocks incoming knee |
| **Dump / sweep** (shin volley, arm-drive twist, pull-off-balance) | Turn succeeded or opponent posting on one leg | 0.30 (Thai, T2); 0.50 for clinch specialists | Opponent on canvas; large scoring impact in MT; illegal in KB; in MMA becomes a trip takedown |
| **Break with elbow** | Any, hands free | 0.35 lands | Cut risk; disengage |
| **Post and exit** | Hip distance | 0.60 | To M range |
| **Referee break** | Passive clinch (MT: no knees/elbows/sweeps attempted; ~3–5 s ESTIMATE; KB: after 1 strike or immediately) | forced | To M range |

### 4.4 Ruleset overlays

- **Muay Thai (stadium/WBC/IFMA)**: clinch continues while active; unlimited knees; elbows allowed; sweeps/dumps allowed with shin/hip, no hip throws, no leg hooks with calf/back of foot, no judo throws, no back-hyperextension. Referee breaks passive clinches. [S12][S13][S19]
- **GLORY (2025+)**: one immediate strike in the clinch, then mandatory disengage; extended holding is a foul; no elbows; no sweeps/throws. [S31][S33]
- **K-1 / WKO K1 rules**: one strike per clinch, passive clinch is a foul; catch-and-strike one attack then release; no sweeps or slams; no elbows. [S32]
- **MMA (unified)**: clinch is unlimited; knees to the head of a standing opponent legal; elbows legal (12-6 legality varies by commission — verify); clinch merges with wrestling (body lock → takedown), cage wall available.

---

## 5. Damage Model for Legs and Body

### 5.1 Leg damage pools (per leg: `thigh`, `calf`, `shin`, `knee`)

Damage units: 0–100 per pool. A "clean" T2 rear low kick to the thigh adds ~8–12 (ESTIMATE); calf kick to the calf pool adds ~10–14 clean, plus a **neurological shock** roll (below); oblique kick adds 3–5 to `knee` plus a 0.05 chance of an acute joint event.

Effects by pool level (ESTIMATE, anchored to coaching reports of 5–10 clean calf kicks producing stance switching and slowing [S10], and Poirier–McGregor (18 leg kicks, TKO r2 [S8]) / Stephens–Melendez (32/35 leg kicks landed [S8])):

| Pool | Level | Movement speed | Kick power from that leg | Check speed | Takedown defence (MMA) | Behaviour |
|---|---|---|---|---|---|---|
| thigh | 0–25 | 1.00 | 1.00 | 1.00 | 1.00 | none |
| thigh | 26–50 | 0.92 | 0.90 | 0.95 | 0.92 | starts checking, switching stance |
| thigh | 51–75 | 0.80 | 0.75 | 0.85 | 0.80 | limping, fewer entries, hops on lead leg |
| thigh | 76–100 | 0.60 | 0.50 | 0.60 | 0.60 | falling from further kicks; TKO risk if referee/corner ruleset |
| calf | 0–20 | 1.00 | 1.00 | 1.00 | 1.00 | none |
| calf | 21–45 | 0.90 | 0.90 | 0.85 | 0.88 | stance switch, weight to rear leg (which raises TD vulnerability) [S9] |
| calf | 46–70 | 0.75 | 0.70 | 0.65 | 0.70 | visible limp, cannot plant → punch power −15% |
| calf | 71–100 | 0.50 | 0.40 | 0.40 | 0.50 | foot-drop, repeated stumbles, high TKO probability |

**Calf-kick neurological shock:** on each clean calf kick roll P = 0.08 + 0.02 × (clean calf hits so far, max +0.10); on success apply an immediate 15 s "dead leg" (movement 0.7, check speed 0.5) independent of pool level. Peroneal nerve mechanism per [S9][S10].

**Recovery:** pools recover 1–2 points per minute of rest between rounds, none during a round (ESTIMATE; bruising and nerve effects do not resolve intra-fight).

### 5.2 Shin damage to the kicker

Each checked kick adds to the kicker's `shin` pool: low kick checked on upper shin/knee +10–15; calf kick checked +8; body kick checked with knee +8, with elbow +5 (ESTIMATE). Fracture event: P = 0.002 per fully checked rear low/body kick at T3+ intensity (two documented in ~30 years of UFC title fights — treat as very rare) [S5][S6]. Effects of shin pool: 26–50 → kick output frequency ×0.8, kick power ×0.9; 51–75 → ×0.6 / ×0.8 and the fighter stops throwing that leg's round kicks below the waist; 76+ → refuses to kick with that leg. This reproduces the widely observed "checks reduce kicking over rounds" [S7].

### 5.3 Body damage

Body pool 0–100. Clean shin body kick adds 8–14 (ESTIMATE; force-normalised Thai kicks are the highest among the three styles tested [S1]); clinch knee adds 4–8 (curved) to 8–12 (straight stabbing); lean-back long knee 10–14; teep 2–4 (body) and 1 balance point. Effects: 40+ → guard drops to elbows-in (head-kick accuracy +0.10 for opponent), stamina drain ×1.3; 60+ → fighter turns away from kicks, backs up, breathes with mouth open; 80+ → body-shot TKO roll on each further tier-4 body strike (P = 0.25). Rib fracture event: P = 0.01 per clean tier-4 body kick/knee (rib trauma ~1% of athlete-injuries in the 2025 in-ring cohort [S21]).

### 5.4 Cuts (elbows)

Per landed elbow to the head: P(cut) = 0.12 horizontal/diagonal, 0.18 downward, 0.08 upward, 0.15 spinning (ESTIMATE, anchored on: lacerations 14.4% of Muay Thai fight injuries; 84% of pro facial lacerations from elbows [S21][S22]). Cut severity tiers drive doctor-stoppage rolls at round breaks; MMA cuts on the eyebrow also affect vision (accuracy −0.05).

---

## 6. Skill-Tier Behaviour Differences

| Aspect | T0 beginner | T1 amateur | T2 regional pro | T3 national | T4 elite |
|---|---|---|---|---|---|
| Kick execution time multiplier | 1.5× (slow, telegraphed wind-up, lean-back) | 1.25× | 1.0× | 0.9× | 0.85× |
| Telegraph (defender's read bonus) | +0.25 | +0.15 | 0 | −0.05 | −0.10 (level disguise, no chamber tell) |
| Hip rotation / contact surface | Under-rotated, kicks with foot/instep, "leg swing"; power ×0.5 | Partial; shin sometimes; ×0.75 | Full; shin; ×1.0 | ×1.05 | ×1.1 (body-mass transfer) [S1] |
| Balance after kick (miss / checked) | P(fall or stumble) 0.35 / 0.45 | 0.15 / 0.25 | 0.05 / 0.10 | 0.03 / 0.06 | 0.02 / 0.04 |
| Return to stance | Often skipped (stays square, hands down) → counter window ×2 | Slow | Normal | Fast | Kick-and-reset is part of the technique |
| Checking | Rarely attempts (<10% of low kicks); "the defensive skill beginners skip" [S24] | 25% | 50% | 60% | 70%, plus reads feints |
| Kick selection | Rear low/body only, no teep, no switch | Adds teep, switch | Full catalogue | Adds question mark, spinning | Full plus deception layers |
| Catches | Attempts on anything, poor grip, gets punched | Catches, no follow-up | Catch → sweep/knee | Chooses counter by opponent's balance | Catches and dumps at high rates; also baits kicks to catch |
| Clinch | Grabs the neck, pulls, gets turned | Basic plum, snap-down | Frame, swim, turn | Positional cycling | Controls exchanges; off-balances at will |
| Composure/scoring behaviour (Thai) | Reacts to every hit, shows pain | Some | Neutral | Sells composure, walks off kicks | Manipulates judges' perception; stalls last round when ahead |
| Fatigue impact on kicking | Stops kicking by round 2 | Round 3 | Kicks at ~80% by round 5 | ~90% | ~95% |

---

## 7. Data Tables with Sources

### 7.1 Biomechanics

| Measure | Value | Population / method | Source |
|---|---|---|---|
| Roundhouse execution time (movement onset → impact, includes step) | Muay Thai 1.02 ± 0.15 s; Karate 1.29 ± 0.28 s; TKD 1.54 ± 0.52 s | 8 expert practitioners per style; 500 Hz motion capture, pad with strain gauge | [S1] |
| Foot velocity at impact | MT 7.22 ± 1.47 m/s; Karate 5.57; TKD 6.36 | same | [S1] |
| Impact force (absolute) | TKD 1547 ± 530 N; MT 1400 ± 419 N; Karate 1211 ± 219 N (no sig. diff.); MT highest when normalised to body mass | same | [S1] |
| Knee flexion at impact | MT 43° vs 15–16° | same | [S1] |
| Pelvic axial rotation velocity | MT ~493 °/s | same | [S1] |
| Vertical COM displacement | MT 1.24 ± 0.15 vs 0.78 (Kar) / 0.93 (TKD) (units as reported) | same | [S1] |
| Foot velocity vs relative force | r = 0.66, p = 0.001 | same | [S1] |
| Roundhouse velocity range across literature | 6.9–18.3 m/s | 86-study review | [S2] |
| Roundhouse impact force range | 172–6,400 N | same | [S2] |
| Front (push) kick velocity / force | 5.2–16.7 m/s / 466–7,790 N | same | [S2] |
| Side kick force (highest) | up to 9,015 N | same | [S2] |
| Thai roundhouse peak force (accelerometer in bag) | up to ~14,000 N | Sidthilaw 1997 thesis, Oregon State | [S3] |
| Low kick force to thigh in match context | ~1,850 N | cited in narrative review of leg-kick mechanics | [S4] |
| Knee strike force | ~8,242 N reported for Muay Thai fighters (1.5–6 yrs training) | cited in narrative review; original attributed to Lee & McGill — verify | [S4] |
| Skill effect | Higher-skill: better proximal-to-distal sequencing, body-mass use, higher activation, coordination | review summary | [S2] |

### 7.2 Injury / effect data

| Measure | Value | Source |
|---|---|---|
| Muay Thai fight injury rate | 55 injuries per 100 fight exposures | [S21a] |
| Injury type share | Contusion 38.7%, laceration 14.4%, swelling 13.5%, fracture 12.6%, sprain/strain 10.8%, concussion 5.4% | [S21a] |
| Injury location | Extremities 58.6%, head/neck 30.6%, trunk 10.8% | [S21a] |
| Facial laceration mechanism (pros) | 84% elbow, 8% knee, 8% punch | [S21a] |
| Pro vs amateur injury rate | 65% vs 44% | [S21a] |
| In-ring cohort (n = 663) | 91.4% no health issue; 24.6% of contests ended RSC; epistaxis 1.96%, concussion 1.50%, rib trauma 1.05% | [S21b] |
| Checked-kick fractures | Silva (UFC 168, 2013) tib/fib; Weidman (UFC 261, 2021) | [S5][S6] |

### 7.3 Fight statistics

| Measure | Value | Source |
|---|---|---|
| Most leg kicks landed in a UFC fight | 95 (Karol Rosa vs Irene Aldana, UFC 296, 3 × 5 min) — Rosa lost the decision | [S34] |
| Poirier vs McGregor II (UFC 257) | 18 leg kicks credited to Poirier, mostly calf; TKO r2 | [S8] |
| Stephens vs Melendez (UFC 215) | 32 of 35 leg kicks landed (91%) | [S8] |
| UFC average significant-strike accuracy | ~40% (Szilagyi, ufc.stats) to ~48% (aggregator; featherweight 52%, heavyweight 43%) | [S35][S36] |
| Leg strikes per minute, women's strawweight | 6.2 (aggregator; treat as low-confidence) | [S36] |
| GLORY / ONE / stadium kick accuracy | **Not found in public sources.** Gap — see §10 | — |

Note on UFCStats: leg-kick accuracy is not published as an aggregate; UFCStats reports SDLL/SDLA (distance leg strikes landed/attempted) per fight. A scrape across fights would give the number. From the two named fights above plus coaching consensus, a working ESTIMATE for **landed / attempted leg kicks in MMA is 0.65–0.80** (leg kicks are "significant" only when they land clean, and defenders check a minority), which is far higher than head-strike accuracy.

### 7.4 Source list

- [S1] Gavagan CJ, Sayers MGL (2017). *A biomechanical analysis of the roundhouse kicking technique of expert practitioners: A comparison between the martial arts disciplines of Muay Thai, Karate, and Taekwondo.* PLOS ONE. https://pmc.ncbi.nlm.nih.gov/articles/PMC5571909/ (also https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0182645)
- [S2] *Impact Force and Velocities for Kicking Strikes in Combat Sports: A Literature Review* (2024). https://pmc.ncbi.nlm.nih.gov/articles/PMC10974023/
- [S3] Sidthilaw S (1997). *Kinetic and kinematic analysis of Thai boxing roundhouse kicks.* Oregon State University thesis. https://ir.library.oregonstate.edu/downloads/9p290c69b
- [S4] *Mechanical Efficiency and Injury Risk in Leg Kicks Across Combat Sports: A Narrative Review of Stance, Hip Rotation, and Striking Surface Effects.* https://pmc.ncbi.nlm.nih.gov/articles/PMC12940734/ (values taken from search abstract; full text blocked by captcha during research)
- [S5] Bloody Elbow, *Chris Weidman's "Dirty" Defense* (destruction check). https://bloodyelbow.com/2013/12/30/ufc-168-anderson-silva-chris-weidman-dirty-defense-kick-check-break-shin-knee-spike-mma-technique/
- [S6] ESPN, Weidman on breaking his leg at UFC 261. https://africa.espn.com/mma/story/_/id/31339390/chris-weidman-talks-training-return-breaking-leg-ufc-261 ; Washington Post on Silva UFC 168. https://www.washingtonpost.com/news/early-lead/wp/2013/12/29/anderson-silva-suffers-gruesome-leg-injury-in-ufc-loss-to-chris-weidman-video/
- [S7] Evolve MMA, *How To Check Kicks In Muay Thai.* https://evolve-mma.com/blog/how-to-check-kicks-in-muay-thai/
- [S8] Evolve MMA, *The Rise Of The Calf Kick In MMA.* https://evolve-mma.com/blog/the-rise-of-the-calf-kick-in-mma/ ; TheSportster, *Why Calf Kicks Are So Effective.* https://www.thesportster.com/why-calf-kicks-effective-in-mma-explained/
- [S9] GroundedMMA, *What Is a Calf Kick.* https://groundedmma.com/what-is-a-calf-kick-mma/ ; MMaailm, *Rise of Calf Kicks.* https://mmaailm.ee/en/calf-kicks-mma-revolution/
- [S10] MMA Fight Nation (2026), *Why the Calf Kick Still Dominates the UFC.* https://www.mmafightnation.com/2026/02/why-calf-kick-still-dominates-ufc-how.html
- [S11] Evolve University, *Catch and Sweep.* https://evolve-university.com/blog/heres-how-to-utilize-the-catch-and-sweep-in-muay-thai/ ; *4 Catch and Counter Techniques.* https://evolve-university.com/blog/4-muay-thai-catch-and-counter-techniques-you-should-be-drilling/
- [S12] Evolve MMA, *8 Common Muay Thai Fouls.* https://evolve-mma.com/blog/8-common-muay-thai-fouls-you-should-know/
- [S13] Sylvie von Duuglas-Ittu, *Illegal Throws in Muay Thai.* https://8limbsus.com/blog/illegal-throws-in-muay-thai-sweeps-cant-do
- [S14] Sylvie von Duuglas-Ittu, *Clinch – The Importance of Building a Frame.* https://8limbsus.com/muay-thai-thailand/clinch-importance-of-building-a-frame
- [S15] Sylvie von Duuglas-Ittu, *Using Your Legs in Muay Thai Clinch & Clinch Basics.* https://8limbsus.com/muay-thai-thailand/using-your-legs-in-muay-thai-clinch-clinch-basics
- [S16] Sylvie von Duuglas-Ittu, *Different Kinds of Muay Thai Knees.* https://8limbsus.com/sylvie-technique-vlog/sylvies-tips-different-kinds-muay-thai-knees
- [S17] IFMA, *Scoring 101.* https://muaythai.sport/scoring-101/
- [S18] WBC Muaythai, *Rules & Regulations.* https://www.wbcmuaythai.com/rules-regulations (site returned 500 at fetch time; scoring summary via search excerpt: body kick outscores a counter straight punch)
- [S19] Evolve MMA, *Updated Guide to Muay Thai Scoring Systems.* https://evolve-mma.com/blog/an-updated-guide-to-the-muay-thai-scoring-systems-of-today/
- [S20] Muay Thai Bible, *Rules & Scoring.* https://muaythaibible.com/rules
- [S21a] Strotmeyer S et al. (2016). *Epidemiology of Muay Thai fight-related injuries.* Injury Epidemiology. https://pmc.ncbi.nlm.nih.gov/articles/PMC5149460/
- [S21b] *Epidemiological analysis of athlete injuries in Muay Thai in-ring matches* (2025). Injury Epidemiology. https://injepijournal.biomedcentral.com/articles/10.1186/s40621-025-00569-x
- [S22] YOKKAO, *Muay Thai Elbow Strikes.* https://yokkao.com/blogs/muay-thai-news/muay-thai-elbow-strikes ; Rajadamnern, *Ultimate Guide to Muay Elbows.* https://rajadamnern.com/blog/muay-thai-elbows/
- [S23] Evolve MMA, *Muay Thai 101: The Roundhouse Kick.* https://evolve-mma.com/blog/muay-thai-101-the-roundhouse-kick/ ; Sumalee, *Common Muay Thai Mistakes.* https://sumaleeboxinggym.com/common-muay-thai-mistakes-how-to-fix-them/
- [S24] Muay Thai Ventura, *Checking Kicks: The Defense Beginners Skip.* https://muaythaiventura.com/checking-kicks-the-defensive-skill-beginners-skip-too-long/
- [S25] The Fight Site, *Ernesto Hoost: The Original Stylebender.* https://www.thefight-site.com/home/ernesto-hoost-original-stylebender
- [S26] muaythai.com, *Dutch Kickboxing: What is It?* https://muaythai.com/dutch-kickboxing/ ; Dynamic Striking, *Combining Punches & Kicks with Ernesto Hoost.* https://dynamicstriking.com/blogs/news/combining-our-punches-kicks-with-ernesto-hoost
- [S27] Evolve MMA, *How To Throw A Question Mark Kick.* https://evolve-mma.com/blog/how-to-throw-a-question-mark-kick-in-muay-thai/
- [S28] LowKickMMA, *Oblique Kick.* https://www.lowkickmma.com/oblique-kick/
- [S29] The Body Lock, *The Oblique Kick.* https://thebodylockmma.com/mma/mma-techniques/oblique-kick-controversial-leg-attack/
- [S30] Evolve MMA, *What To Do If An Opponent Catches Your Leg.* https://evolve-mma.com/blog/what-to-do-if-an-opponent-catches-your-leg-in-muay-thai/
- [S31] GLORY, *Rules* (PDF glory-rules-2026-v2 linked, not fetchable) https://glorykickboxing.com/rules ; *Scoring Rules in GLORY.* https://glorykickboxing.com/news/scoring-rules-in-glory
- [S32] WKO, *K1 Rules.* https://www.worldkickboxingorganisation.org/k1-rules
- [S33] GLORY, *Updates to GLORY Rules* (Jan 2025 clinch rule). https://glorykickboxing.com/news/updates-to-glory-rules
- [S34] Guinness World Records, *Most leg kicks landed during a UFC match.* https://www.guinnessworldrecords.com/world-records/494983-most-leg-kicks-landed-during-a-ufc-match
- [S35] Szilagyi T, *Understanding striking performance (ufc.stats).* https://tamaszilagyi.com/ufc.stats/articles/2020-04-15-striking.html
- [S36] Zipdo aggregator, *UFC Fighter Statistics.* https://zipdo.co/ufc-fighter-statistics/ (low confidence)
- [S37] Evolve MMA, *Mastering the Teep.* https://evolve-mma.com/blog/mastering-the-teep-how-to-use-muay-thais-push-kick-to-control-distance/ ; Evolve Vacation, *Different Types of Teeps.* https://evolve-vacation.com/blog/different-types-of-teeps-in-muay-thai/
- [S38] Muay Thai Guy (Sean Fagan), *Do's and Don'ts of Checking Leg Kicks.* https://www.muay-thai-guy.com/blog/the-dos-and-dont-of-checking-leg-kicks-in-muay-thai

---

## 8. Sim Rules to Implement

All probabilities are base values for T2 vs T2 at neutral range and neutral fatigue; ESTIMATE unless a source tag is given. Modifiers stack additively on probability then clamp to [0.02, 0.95].

**Timing & state**

1. Every kick is a 3-phase action: `wind` (chamber/step, cancelable, telegraph roll happens here), `strike` (uncancelable, 100–200 ms), `recover` (return to stance). Durations from §2 column "Exec/Recovery", scaled by tier multiplier in §6. Rear round kick total ≈ 400 + 450 ms at T2 (ESTIMATE anchored on ~1.0 s onset→impact in lab [S1]).
2. During `recover` after a **missed or checked** kick, the kicker's defensive rating is −30% and balance is reduced (§2 column). During `recover` after a **landed** kick, −10%.
3. **Telegraph read**: defender's chance to select a reactive defence = base 0.50 + tier read bonus (§6) + 0.15 if the same kick was thrown ≥3 times this round without variation − 0.15 if the kick follows a punch within 300 ms (Dutch gating) [S25][S26] − 0.20 for calf kick (short window) − 0.10 for question-mark kick after ≥2 established low-line kicks [S27].

**Round kicks**

4. Rear low kick: P(land clean) = 0.60; +0.10 if preceded by a landed or blocked punch within 300 ms; +0.10 if opponent's thigh pool ≥ 50; −0.25 if defender chooses check and the read succeeds. Damage 8–12 to `thigh`.
5. Body kick: P(land clean) = 0.50; blocked-by-arm 0.30 (25–40% damage passes through, and scores partially under Thai judging when it "moves" the defender) ; caught 0.10 (rises to 0.20 if the kicker's tier < catcher's tier, falls to 0.03 at T4 kicker vs T2). Damage 8–14 `body`. If caught → §3.1 tree.
6. Head kick: P(land clean) = 0.25 baseline; +0.15 if opponent's body pool ≥ 40 (guard drops); +0.20 for question-mark kick with setup satisfied; −0.15 vs a fighter in a high boxing guard. Landed clean = KO roll with power tier 5.
7. Switch kick: as body/head kick with +100–150 ms wind and telegraph +0.10; power ×1.0 (the switch loads the hip); opponent may **teep-jam** the switch at P = 0.40 if read succeeds.
8. Calf kick (MMA/kickboxing only; treated as low kick to lower target in MT): P(land clean) = 0.65 vs square/MMA stance, 0.45 vs bladed Thai stance; check P = 0.35 if read; damage 10–14 `calf` + neurological shock roll (§5.1). Stance-switch by the defender removes the target for 1 exchange but sets the sim flag `switched_stance` (−0.10 to their own striking accuracy, +0.10 takedown vulnerability) [S9][S10].
9. Oblique kick (MMA only): P = 0.50; damage 3–5 `knee`; P(acute knee event) 0.05 → opponent movement ×0.8 for the rest of the fight and takedown entries −0.15. Illegal in GLORY (foul, point deduction on 2nd), grey in MT (legal if it lands on thigh; foul if on kneecap: roll 0.30 that it is called).

**Teeps**

10. Lead teep: P(contact) = 0.60; effect = push (opponent range +1 band, balance −1, pressure momentum reset); damage 2–4. Rear teep: P = 0.50, push effect ×1.5, damage 4–6, recovery 400–550 ms [S37]. Catch P = 0.35 if read → §3.1 tree (teep-catch dump is a "single-leg" style pull).
11. Teep as **counter** (stop-kick) to an opponent's forward step or switch: P = 0.55 if read; opponent's action is cancelled and their balance −2.

**Checks**

12. Check resolution (if defender committed to check and the read succeeded): defender takes 0–20% of kick damage on `shin`; kicker takes 10–15 `shin` for low/body kicks, 8 for calf kicks (§5.2). P(fracture) = 0.002 per fully checked rear kick at T3+ intensity [S5][S6]. Kicker's `shin` pool modifies their kick frequency and power (§5.2) — this reproduces the "stops kicking after being checked" behaviour [S7].
13. A defender who checks is single-legged for 250 ms: attacker's follow-up punch +0.10 accuracy; in MMA, a takedown attempt in that window gets +0.15.
14. Fighters below T1 check ≤10% of readable low kicks; T2 50%; T4 70% (§6).

**Catches and follow-ups**

15. On a caught kick, the catcher picks from §3.1 with ruleset gating: MT allows sweep/dump/knee/return-kick/≤2 forward steps; KB allows one strike then release; MMA allows any takedown (+0.20 over a cold single leg). Being swept/dumped in MT = "lose the exchange": add −1.0 to the round scorecard weight (§9) and set balance flag `off_balance_visible`.
16. Kicker escape rolls per 300 ms of hold (§3.1). If the catcher takes a 3rd forward step in MT, referee warning; 2nd offence = point deduction.

**Elbows, knees, clinch**

17. Elbows are only selectable at S/C range or as a clinch-break; P(land) = 0.50 horizontal, 0.40 upward, 0.35 downward; cut roll per §5.4. In GLORY/K-1 any elbow is a foul.
18. Knees: long knee P = 0.45 at M range against an advancing opponent (+0.15 if the opponent is ducking/shooting → MMA flying-knee-on-shot); clinch knees P by dominance index (0.55 / 0.30 / 0.15). Chicken-wing knees: P = 0.60, damage 2–4, cost 1 stamina each to both fighters (tiring) [S16].
19. Clinch engine: each beat (≈1 s) both fighters pick swim / turn / snap-down / knee / shield / dump / break (§4.3). Dominance index recomputed every beat; referee break after N passive beats: MT 4, GLORY/K-1 after 1 strike or 1 passive beat, MMA never (cage rules apply).
20. Dumps/sweeps from clinch (MT): P = 0.30 base, +0.20 if the opponent has just been turned, +0.15 for a clinch specialist archetype; illegal under KB; under MMA becomes a trip takedown with the same odds.

**Damage & accumulation**

21. Leg pools per §5.1; apply movement, kick-power, check-speed and takedown-defence multipliers every action. Intra-round no recovery; between rounds 1–2 points per minute.
22. When any leg pool ≥ 75, each further clean kick to that pool triggers a fall roll P = 0.30 (MT: scored as a knockdown only if the referee counts, typically not for leg kicks; MMA: referee TKO roll P = 0.20 if the fighter cannot stand within 3 s).

**Style & scoring behaviour**

23. Dutch-style archetype: 60% of low kicks are gated behind a punch combination; those kicks use rule 4's +0.10 and the telegraph −0.15. Counter-Dutch: defender's straight punch during the kicker's `wind` phase lands at P = 0.45 [S25].
24. Thai-style archetype under Thai scoring: prefers body kicks and clinch knees, teeps to manage distance, minimal punching for score; sells composure (no reaction animation on hits below tier 4); coasts in round 5 if ahead on the sim's judge model [S19].
25. Under GLORY/K-1/ONE scoring: all strikes weigh equally, damage first; archetypes shift to punch-heavy combinations with low kicks and reduce clinch attempts to ≤1 strike [S31][S32][S33].

**Skill tiers**

26. Apply §6 multipliers: execution time, telegraph, power, fall probability, check rate, catalogue gating. T0 fighters cannot throw K6, E5, N4, S1; T1 cannot throw K6/E5.

---

## 9. Rules Differences by Ruleset

| Item | Muay Thai (Thai stadium / WBC MT / IFMA) | Kickboxing (GLORY / K-1 / WAKO K1-style) | MMA (Unified) |
|---|---|---|---|
| Rounds | 5 × 3 min, 2 min rest (pro); 3 × 3 amateur [S20] | 3 × 3 min; 5 × 3 for titles; GLORY extension round on draw [S31] | 3 × 5 / 5 × 5 |
| Elbows | Legal (all angles); most-common cut cause [S22] | **Illegal** (cuts end fights inconclusively) [S31][S32] | Legal; 12-6 legality by commission (verify) |
| Knees | Legal to head/body/legs, unlimited in clinch | Legal to body and head; one strike per clinch (GLORY 2025: "one immediate single strike then disengage") [S33]; WKO: one strike per clinch, passive clinch foul [S32] | Legal; no knees to the head of a grounded opponent |
| Clinch | Active clinch continues; referee breaks passivity; sweeps/dumps allowed | Limited to a few seconds / one strike; holding is a foul | Unlimited; merges with wrestling |
| Catching kicks | Legal; ≤2 forward steps while holding before a strike, backward unlimited; count resets after a strike [S12] | Catch and one attack, then release; no sweep/slam [S32] | Legal; any takedown |
| Sweeps / throws | Shin-front sweeps, hip "volley" dumps legal; calf/back-of-foot hooks, hip throws, judo throws, back hyperextension, rugby tackles, "ploughing" illegal [S12][S13] | Illegal | All takedowns legal |
| Oblique kick to knee | Grey: thigh legal, kneecap illegal [S29] | Illegal (linear kicks to the knee, GLORY) [S29] | Legal [S28] |
| Scoring | Stadium: effect + balance + composure; kicks/knees > elbows > punches; sweeps/off-balancing score; rounds 1–2 lightly weighted, 3–4 decisive; least-damaged wins even rounds. IFMA: count skills, then force; catch alone does not score; caught kick on ribs still scores for the kicker. WBC MT: body kick outscores a counter straight [S17][S18][S19][S20] | Damage first (GLORY 2025 adds "wobble, stagger, reduced functionality" as objective signs), then aggression, cleanness, complexity; knockdowns dominate; WKO: knockdowns > damage > clean hits > aggression; 3-knockdown rule; standing 8 [S31][S32][S33] | Effective striking/grappling → aggression → control; knockdowns |
| Knockdown handling | 10-8 for a knockdown; leg-kick falls usually not counted | Count; 3 in a round = TKO (K-1/WKO) | Referee discretion; no counts |
| Gloves | 8–10 oz (ONE: 4 oz MMA gloves for MT → more KOs, less clinch) [S19] | 10 oz | 4 oz → higher calf-kick and elbow relevance |
| Stance implication | Bladed, weight back, lead leg light for checks | Squarer, boxing-forward (Dutch) | Wide, front-heavy, square (TDD) → calf kick meta [S8][S9] |

---

## 10. Assumptions and Gaps

1. **No public per-kick accuracy data for GLORY, ONE or Thai stadia was found.** UFCStats has per-fight leg-strike landed/attempted columns (SDLL/SDLA); a scrape would replace the 0.65–0.80 ESTIMATE in §7.3. Session web-search quota was exhausted before a leg-kick trend dataset (2010 → 2024) could be located.
2. **Execution times in ms are estimates.** The only measured Thai number is 1.02 s onset→impact in a lab maximal-effort kick with a step [S1]; sparring kicks are quicker. TKD literature (Estevan et al., not fetchable) reports execution times in the 250–400 ms range for the kicking limb only; the split used here (wind 200–300 / strike 100–200 / recovery 300–600) is inferred.
3. **All defence success probabilities and post-catch outcome probabilities are ESTIMATE**, anchored qualitatively to coaching sources. They are set so that a T2-vs-T2 exchange produces roughly: low kicks land 60%, body kicks 50% clean, head kicks 25%, catches on ~10% of body kicks, sweeps on ~45% of catches.
4. **Leg pool thresholds** are calibrated to reproduce "5–10 clean calf kicks → stance switch / slowing" [S10] and the 18-kick Poirier TKO [S8]; they are not from a dose-response study. No such study exists in the reviewed literature.
5. **Knee strike force (8,242 N)** comes second-hand from a review abstract that attributes it to Lee & McGill; the original could not be fetched. Treat as provisional.
6. **GLORY 2026 rule PDF** was not fetchable (404 on the linked path); the clinch rule is from GLORY's Jan 2025 announcement [S33]. The GLORY catch-kick rule (historically: one step and one strike) should be verified against the PDF.
7. **WBC Muaythai site returned HTTP 500**; its scoring description is from a search excerpt. IKF unified rules returned 401.
8. **Muay Thai "two-step" rule** phrasing varies by promotion; some referees allow more. Implement as a tunable `catchStepLimit` (default 2).
9. **12-6 elbow legality in MMA** changed in the 2024 US unified-rules revision; not re-verified here — flag for the MMA rules agent.
10. **Cut probabilities per elbow** are derived from injury-share data (lacerations 14.4% of injuries; 84% from elbows) and are not per-strike rates; tune against desired cut-stoppage frequency (~5–8% of pro Thai bouts, ESTIMATE).
11. Fatigue interactions (kick output decline per round) are asserted from coaching consensus; no round-by-round kick-count data was found.
12. Peer-reviewed data on **teep force** specific to Muay Thai is absent; the front-kick range in [S2] (466–7,790 N) spans TKD and karate populations.
