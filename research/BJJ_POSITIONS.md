# BJJ / Ground Positional Game for MMA — Research Brief for the State-Graph Design

Research agent output. Scope: ground positions as **nodes**, passes/sweeps/escapes/transitions/get-ups as **edges**, ground-and-pound (GnP) as a per-node action model. Submissions are only referenced as **exits** from nodes (finishing mechanics belong to the Submissions agent).

Conventions used throughout:

- Ratings are 0–10 unless stated. "Control" = how hard it is for the bottom player to improve position in MMA; "Damage" = realistic GnP damage potential for top; "Escape difficulty" = for the bottom player at equal skill.
- Percentages labelled **ESTIMATE** are the author's calibrated guesses anchored to the cited data, not measured values. Everything with a URL is measured/sourced.
- "Base success %" = probability that one discrete attempt (one edge traversal, of the stated duration) succeeds versus a *competent* defender of **equal skill tier, equal mass, fresh, no cage, no strikes**. Modifiers (Section 3.3) move it.
- MMA ruleset reference is the Unified Rules of MMA (2024 revision: "grounded" = any body part other than hands/feet touching the canvas; no knees/kicks to the head of a grounded opponent; no 12–6 elbows in older rule sets — legal since Nov 2024 ABC update in most US commissions, treat as a ruleset flag).

---

## 1. Summary

**What the data says**

1. MMA fights are on the ground roughly a third of the time. A 91-bout UFC lower-weight sample (2014–15) measured **49.6 % of time standing, 36.2 % mutual ground, 13.4 % clinch; cage contact 20.9 % of all time** (Roy & Murphy 2026, https://www.cambridgepublish.com/css/article/download/243/250/797). Bloody Elbow's 2014 UFC analysis: **38.1 % of fight time (1:54 of every 5:00) is "someone in ground control"** (https://bloodyelbow.com/2014/03/26/ufc-mma-analytics-ground-control-fighters-win-knockout-tko-submission-decision/).
2. Control time wins rounds: across 3,850 UFC decisions the fighter with more control time won **68.2 %**; with a 3–5 min control gap **70.3 %**, 5+ min **87.4 %** (The Fight Algorithm, https://thefightalgorithm.com/articles/the-invisible-round). Elite controllers throw **0.9–4.0 ground strikes per minute of control** (Covington 0.9, Sherk 1.2, Fitch 2.6, GSP 3.0, Khabib 4.0).
3. Ground strikes land at high rates: **931 ground punches/elbows, 546 landed = 58.6 %** in the same UFC lower-weight sample; ground submission attempts succeed **13.4 %** overall, **RNC 38.1 % (8/21)**, armbar 15.4 %, guillotine 10.5 %, triangle 11.5 %, leg locks 0/16 (Roy & Murphy 2026).
4. Back control is the most valuable node: **39.1 % of all UFC submissions are RNCs** (648 of 1,659; Grappler HQ, https://www.grapplerhq.com/mma/ufc-statistics/); in elite no-gi, a **back-take transitions directly to a submission attempt with probability 0.45**, the highest of any action (Lamas et al. 2024, https://journals.sagepub.com/doi/10.1177/17479541231210979). Extra time in half guard or back control does *not* raise TKO odds, whereas mount and side control do (Bloody Elbow 2014).
5. Elite grappling is sparse: takedowns, sweeps and back-takes each occur **< 1 per competitor per match**; submission attempts 1.03/match; the most common chain is **guard-pass attempt → another guard-pass attempt (0.30)** (Lamas 2024). ADCC 2024 male divisions: **26 guard passes, 17 back takes**, 34 % submission rate (BJJ Heroes, https://www.bjjheroes.com/editorial/adcc-2024-after-math-data-compilation-and-analysis; FloGrappling division sub rates 25–56 %, https://www.flograppling.com/articles/12792712-history-made-adcc-records-stats-from-2024). ADCC 2022: 27 passes; **only 17 % of male back takes came from guard attacks** (the rest from top/turtle/scrambles) (https://www.bjjheroes.com/editorial/adcc-2022-after-math-data-compliation-and-analysis).
6. Lower-belt sweep success per attempt: **scissor 55 %, X-guard 63 %, sit-up 38 %, back-take-from-guard 60 %; guard pull 94 %**; passing is 93 % knee slice / knee pin / bullfighter at white belt, 71 % at blue (Williams et al. 2019, 140 IBJJF fights, https://eprints.bournemouth.ac.uk/32250/).
7. No-gi sub-only matches: **standing:ground time ratio 1:2**, ground time 79–87 % of match, high-intensity actions ~20 % of match time; time in a dominant position (side/mount/back/N-S held ≥ 3 s) separates winners from losers (ES 0.39) and correlates with upper-body submissions (r = 0.50); heel-hook winners recorded **zero** dominant-position time (Spanias, Kirk & Øvretveit 2022, https://shura.shu.ac.uk/31193/).

**Design implications (headline sim rules)**

- Model the ground as ~30 nodes with a bottom/top perspective each, ~90 edges. Every edge has: duration, base p, modifiers, failure node.
- MMA bottom play is "get up first, sweep second, submit third" (Zahabi/Melanson consensus). Bottom-player AI at intermediate+ should try a get-up edge on ~60 % of decision ticks unless a high-percentage sweep/sub is available.
- Strikes are the MMA passing engine: each landed GnP strike during a pass attempt adds pass probability and drains bottom stamina; but posturing to strike opens sweep/sub/get-up windows for the bottom player (Section 4).
- The cage is a node modifier, not a separate node: it raises get-up probability for the bottom (wall walk) but also raises cage-assisted pass/pin probability for the top; net effect depends on who has the underhook.
- Referee stand-ups: no fixed timer in the Unified Rules; implement an inactivity counter (ESTIMATE 30–60 s with no "work" events) — see Rule 27.

---

## 2. Node list (positions)

Each node: `ID` — description; TOP perspective; BOTTOM perspective; **Ctrl** (MMA control 0–10) / **Dmg** (top GnP damage potential 0–10) / **EscDiff** (bottom escape difficulty 0–10); submission exits (top / bottom, names only); typical dwell time before a transition at equal elite skill (ESTIMATE).

### 2.1 Mount family

| ID | Description | Ctrl | Dmg | EscDiff | Sub exits TOP | Sub exits BOTTOM | Dwell (s) |
|---|---|---|---|---|---|---|---|
| `MOUNT_LOW` | Top sits on hips/thighs, knees on mat, hooks (grapevines) optional. Stable, weak striking angle. | 7 | 5 | 6 | arm triangle (via cross-face), Ezekiel (rare no-gi), americana | none realistic; bottom threatens upa/elbow-knee | 15–40 |
| `MOUNT_HIGH` | Knees in armpits, bottom arms trapped/pinned above chest. Best pure GnP node. | 8 | 9 | 8 | armbar, arm triangle, mounted triangle, mounted guillotine | none | 10–30 (ends by finish or bottom turning) |
| `MOUNT_S` | S-mount: one knee up by head, hips over chest, bottom arm isolated. Transitional to armbar/back. | 8 | 8 | 8 | armbar (primary), mounted triangle, back take | none | 5–15 |
| `MOUNT_TECH` | Technical mount: bottom has turned to side; top has knee behind head, foot posted, chest-to-shoulder. Gateway to back. | 8 | 7 | 7 | armbar (far arm), RNC after back take, arm triangle | none | 5–15 |
| `MOUNT_GNP` | Sub-state of MOUNT_HIGH/LOW: top postured, hips floating, throwing. Highest damage, lowest stability. | 6 | 10 | 5 | none while striking | armbar on straight-arm push (only vs beginner top), none realistic | 5–15 |

Notes: in MMA the bottom fighter's straight-arm push on the chest (brand-new behaviour) creates armbar/S-mount exits for the top. Mount dwell in UFC is short because the bottom fighter turns to turtle/back or gives up back (technical mount → back). Bloody Elbow (2014): extra mount time significantly increases TKO odds — treat mount as the primary TKO node.

### 2.2 Back family

| ID | Description | Ctrl | Dmg | EscDiff | Sub exits TOP | Sub exits BOTTOM | Dwell (s) |
|---|---|---|---|---|---|---|---|
| `BACK_HOOKS` | Two hooks + seatbelt (over/under). Bottom belly-down, on side or supine. | 9 | 5 | 8 | RNC, short choke, armbar (rare), bow-and-arrow (gi) | none | 20–90 |
| `BACK_BODY_TRI` | Body triangle instead of hooks. Slower to escape, ribs compressed. Prevents hook-stripping. | 9 | 4 | 9 | RNC, arm-in RNC | none; escape via knee-on-triangle ankle ("ankle attack" on the locked foot) | 30–120 |
| `BACK_ONE_HOOK` | One hook in, other leg free or being stripped; often bottom is on the "wrong" (choking-arm) hip. | 6 | 4 | 5 | RNC (rushed), no-hook chokes | none | 5–15 |
| `BACK_SEATBELT_NOHOOKS` | Seatbelt/rear body-lock on turtle/kneeling opponent, no hooks (Danaher "hooks are optional"). | 6 | 4 | 5 | RNC if chin exposed | none (bottom threatens to sit-through/roll) | 5–20 |
| `BACK_CRUCIFIX` | Crucifix from back/turtle: one arm trapped by legs, other by arms. Unanswered elbows/punches. | 9 | 8 | 8 | RNC/arm-in chokes, neck crank (illegal in some rulesets), wrist lock | none | 10–40 |
| `BACK_STANDING` | Rear body lock standing (mat-return position). Owned by the Clinch agent; listed here as entry to BACK_HOOKS via mat return. | 6 | 3 | 5 | RNC standing (rare) | none | 5–20 |

Back finishing: RNC is 39.1 % of all UFC submissions (Grappler HQ); RNC attempts convert at 38.1 % in the lower-weight UFC sample (Roy & Murphy 2026). In elite no-gi, back-take → immediate submission attempt p = 0.45 (Lamas 2024). Bloody Elbow (2014): extra back time raises **submission** but not TKO odds. Danaher's "straitjacket" system (BJJ Fanatics, not fetched) is the reference for hand-fighting sequencing: control the far-side wrist, trap it with the leg, then choke; treat as the elite-tier back behaviour.

### 2.3 Side control family

| ID | Description | Ctrl | Dmg | EscDiff | Sub exits TOP | Sub exits BOTTOM | Dwell (s) |
|---|---|---|---|---|---|---|---|
| `SIDE_CONTROL` | Cross-body, chest-to-chest, cross-face + underhook (or hip block). | 7 | 6 | 6 | arm triangle, kimura, americana, D'Arce/anaconda on turn-in, north-south choke | none realistic (bottom threatens reversal/turn to knees) | 15–45 |
| `KESA_GATAME` | Scarf hold: head + near arm trapped under armpit, hips beside. Strong pin, good for short elbows; risk: bottom hooks leg and rolls. | 7 | 5 | 7 | scarf armlocks (bicep slicer legality!), arm triangle variations | none; escape by leg hook / bridge | 15–40 |
| `REVERSE_KESA` | Reverse scarf: facing legs, chest on chest. Mount entry node. | 7 | 4 | 6 | kimura, mount → armbar | none | 5–20 |
| `KNEE_ON_BELLY` | Knee on sternum/belly, posted foot, upright. Great for punches; mobile. Scores 2 (IBJJF/ADCC). | 6 | 7 | 4 | armbar (far arm), D'Arce on turn-in, baseball bat (gi) | none | 5–15 |
| `NORTH_SOUTH` | Chest on chest, heads opposite. Excellent pin in BJJ; in MMA only body knees legal (head knees illegal), limited striking. | 7 | 3 | 6 | north-south choke, kimura, armbar (spin) | none | 10–30 |
| `CRUCIFIX_SIDE` | Crucifix entered from side control/turtle top, opponent supine: near arm trapped by legs, far arm controlled. | 9 | 8 | 8 | arm-in chokes, armbar, wrist lock | none | 10–40 |
| `SIDE_CONTROL_WALL` | Side control with bottom's head/shoulders on the fence: bottom can't hip-escape away; top can pin with the wall. (Modifier-state.) | 8 | 6 | 7 | as SIDE_CONTROL | none | 20–60 |

MMA note: side control is a *transit* node for damage (Bloody Elbow: extra side-control time raises finish odds but is "not great" for raw TKO rate). Top usually attacks mount/back or strikes to force the bottom to turn (→ turtle → back).

### 2.4 Half guard family (top/bottom)

| ID | Description | Ctrl (top) | Dmg (top) | EscDiff (bottom to guard/feet) | Sub exits TOP | Sub exits BOTTOM | Dwell (s) |
|---|---|---|---|---|---|---|---|
| `HALF_FLAT` | Bottom flat on back, top has cross-face + underhook or head control. The most common MMA ground node (wrestlers' default landing). | 6 | 7 | 5 | arm triangle, D'Arce (when bottom turns), kimura | kimura (on posting arm), guillotine (on posture-break), triangle (rare) | 20–60 |
| `HALF_KNEE_SHIELD` (= Z-guard) | Bottom on side, knee shield across hip/chest, far frame. Best MMA half guard for distance + get-up. | 4 | 3 | 3 | none direct | kimura, triangle from knee-shield removal, leg entanglement entries (SLX) | 10–30 |
| `HALF_UNDERHOOK` | Bottom on side with underhook, head under top's chin ("old school"/coyote entries). Gateway to dogfight/back/wrestle-up. | 4 | 3 | 3 | none | back take, wrestle-up | 5–20 |
| `HALF_DOGFIGHT` | Both on knees, bottom has underhook, top has whizzer. Scramble node. | 3 | 2 | 2 | guillotine/D'Arce (top, on whizzer side) | back take, single-leg finish, roll-under | 3–10 |
| `HALF_DEEP` | Deep half: bottom under top's hips, hugging leg. Sweep-rich, striking-poor for top. In MMA top can elbow the top of the head/back (12-6 legal in 2024 rules? see flags). | 5 | 4 | 4 | kimura (top), back take if bottom exposes | sweeps (waiter, Homer Simpson), back take | 5–20 |
| `HALF_LOCKDOWN` | 10th Planet lockdown: bottom's legs lock and stretch top's leg; "whip-up" to dogfight, electric chair. | 5 | 4 | 4 | none | electric chair (sub/sweep), old-school sweep, dogfight | 10–30 |
| `HALF_QUARTER` | Quarter guard: only the foot/ankle trapped. Almost passed. | 8 | 7 | 7 | as SIDE_CONTROL | none | 5–15 |
| `HALF_BUTTERFLY` | Half butterfly: bottom's inside leg has a butterfly hook. | 4 | 3 | 3 | none | elevation sweeps, SLX entries | 5–20 |

MMA note: half guard top with the head controlled is where MMA GnP is most frequent (Khabib, Usman, Covington, Makhachev). Intermediate-tier MMA bottom game is largely a knee-shield/underhook half-guard get-up game (Lachlan Giles' half-guard framework; Neil Melanson's MMA half guard). Top: elbows from the cross-face side, punches with the free hand when the bottom's frame fails; smash/knee-cut pass to side or mount.

### 2.5 Closed guard family

| ID | Description | Ctrl (top) | Dmg (top) | EscDiff (bottom to sweep/stand) | Sub exits TOP | Sub exits BOTTOM | Dwell (s) |
|---|---|---|---|---|---|---|---|
| `CLOSED_POSTURE_UP` | Top postured (spine vertical, hands on hips/biceps or posting), bottom's ankles crossed. | 4 | 5 | 4 | none (top can only strike/open) | armbar/triangle only after breaking posture; kimura on posting arm | 10–40 |
| `CLOSED_POSTURE_BROKEN` | Top's head pulled down, overhooks/collar-tie, hips controlled. Bottom's attacking node. | 2 | 2 | 2 | none | triangle, armbar, kimura, guillotine, omoplata, hip-bump/flower/scissor sweeps, arm-drag → back | 10–30 |
| `CLOSED_HIGH_GUARD` | Legs high on back, one leg over shoulder. Elite bottom node. | 1 | 1 | 1 | none | triangle, armbar, omoplata | 5–20 |
| `CLOSED_RUBBER` | Rubber guard / mission control (leg across neck, hand on own shin). MMA-specific (10th Planet). | 2 | 1 | 2 | none | gogoplata, omoplata, triangle, "New York → chill dog" sweeps | 10–30 |
| `CLOSED_STANDING_TOP` | Top has stood up inside closed guard (hands on chest / hips). About to open. | 5 | 4 | 4 | none | up-kick when guard opens, kneebar/heel hook via SLX entry, sweeps by ankle grabs | 3–10 |

MMA note: closed guard is defensively valuable (posture-broken guard nearly zeroes damage) but scores nothing and judges reward the top. Zahabi's MMA guard principle: closed guard is for breaking posture + standing up; never hold-and-stall. Beginner tier bottom players default to `CLOSED_POSTURE_UP` and stall there → referee stand-ups.

### 2.6 Open guards (no-gi/MMA-realistic)

| ID | Description | Ctrl (top) | Dmg (top) | EscDiff (bottom) | Sub exits TOP | Sub exits BOTTOM | Dwell (s) |
|---|---|---|---|---|---|---|---|
| `OPEN_SUPINE_LEGS_UP` | "Up-kick guard": bottom supine, feet on hips/thighs vs a **standing** opponent. Bottom may kick the head of a standing opponent (legal: opponent not grounded). | 3 | 4 (diving punches, leg kicks to thighs) | 4 (to stand) | none | none direct; up-kick KO threat; leg entries (SLX/ankle lock) | 5–20 |
| `BUTTERFLY` | Seated, both hooks, underhook/overhook. Wrestle-up and elevation node. | 3 | 3 | 3 | guillotine/D'Arce on bottom's head-down entries | guillotine (rare), hook sweep → top, wrestle-up | 5–20 |
| `SEATED_SHIN_TO_SHIN` | Seated guard, shin-to-shin/ankle grip on lead leg vs kneeling/standing opponent. Entry node to SLX/butterfly/wrestle-up. | 3 | 3 | 3 | none | SLX/ankle attacks, single-leg wrestle-up | 3–10 |
| `X_GUARD` | Under standing opponent, hooks behind the far knee, near leg on shoulder. High-percentage sweeps, weak vs strikes. | 2 | 2 | 2 | none | sweeps (technical stand-up, tripod), leg locks | 3–10 |
| `SLX` | Single-leg X / ashi garami: one leg isolated between bottom's legs, hip-to-hip. | 2 | 2 | 2 | none | straight ankle lock (legal), heel hook (ruleset flag), sweeps, technical stand-up | 3–10 |
| `K_GUARD` | Seated, inverted-ish; knee across, grip behind knee; feeds to leg entanglements/back takes. Rare in MMA (head exposed to punches). | 3 | 4 | 3 | none | leg entanglement entries, back take (matrix) | 3–10 |
| `Z_GUARD` | Alias of `HALF_KNEE_SHIELD` (listed with half guard). | – | – | – | – | – | – |
| `OPEN_GUARD_KNEELING_TOP` | Generic open guard (feet on hips/biceps) vs kneeling opponent; top can posture and strike or pass. | 4 | 5 | 4 | none | armbar/triangle (feet-on-hips), sweeps | 5–20 |

MMA note: the "legs-up vs standing opponent" node is the most common *stand-up-vs-ground* state (opponent refuses to engage / dives in with punches / leg-kicks the thighs). Ryan Hall's MMA game shows SLX/leg-entanglement from here; most fighters just try to stand (technical stand-up) or wall-walk.

### 2.7 Turtle / front headlock family

| ID | Description | Ctrl (top) | Dmg (top) | EscDiff (bottom) | Sub exits TOP | Sub exits BOTTOM | Dwell (s) |
|---|---|---|---|---|---|---|---|
| `TURTLE` | Bottom on hands & knees; top on side/behind with spiral ride or hip control. Back-exposure node. Knees to head illegal (grounded), knees to body legal. | 6 | 6 | 5 | RNC after back take, anaconda/D'Arce on turn-in, crucifix | none (bottom threatens sit-out/granby/roll to guard/stand) | 5–20 |
| `TURTLE_WALL` | Turtle with head/shoulder into the fence: wall-walk node; top's hooks harder, bottom's stand-up easier but top can flatten with the wall. | 5 | 5 | 4 | as TURTLE | none | 5–20 |
| `FRONT_HEADLOCK` | Top sprawled/standing with head + arm or chin control over a kneeling opponent (after sprawl or from turtle). | 5 | 5 | 5 | guillotine, D'Arce, anaconda, front-headlock → back (go-behind) | single/double leg re-shot, sit-out to top | 3–10 |
| `SPRAWL` | Post-takedown-attempt sprawl (top hips back). Transitional; owned by Wrestling agent; listed as entry to FRONT_HEADLOCK. | 4 | 3 | 4 | guillotine | re-shot | 2–5 |

### 2.8 Standing-over / cage / scramble nodes

| ID | Description | Ctrl | Dmg | EscDiff | Sub exits | Dwell (s) |
|---|---|---|---|---|---|---|
| `HQ` (headquarters) | Top standing/kneeling, one leg between the bottom's legs, bottom's inside leg pinned; gateway to knee cut, leg weave, backstep, smash. | 5 | 5 | 4 | leg-lock entries for bottom (SLX/50-50 if top leg exposed) | 5–15 |
| `STANDING_OVER_GUARD` | Top standing outside/above the open guard; bottom `OPEN_SUPINE_LEGS_UP`. | 3 | 4 | 3 | up-kick (bottom) | 3–15 |
| `CAGE_SEATED_BOTTOM` | Bottom seated with back to fence, top kneeling/standing in front (post-takedown against the cage). Bottom's best get-up node; top's body-lock pin node. | 4 | 4 | 3 | guillotine (top) if bottom ducks in; none for bottom | 5–20 |
| `CAGE_WALL_WALK` | Bottom has one hand on fence, hips off the mat, top on the hips (body lock or underhook). Transitional to standing clinch (Clinch agent). | 4 | 3 | 3 | none | 3–8 |
| `SCRAMBLE` | Neither has control (e.g., after a failed pass/sweep, granby, sit-out). Resolved by a contested roll. | 0 | 0 | – | guillotine/D'Arce/front-headlock chokes for whoever wins the head | 1–4 |

---

## 3. Edge catalogue

### 3.1 Column key

`dur` = typical seconds from decision to resolution. `base%` = success vs competent equal-tier defender (ESTIMATE unless a source is cited; anchors in Section 7). `fail →` = node on failure; "counter" = the specific defender action that produces a *worse* outcome than mere failure, with its share of failures (ESTIMATE). Modifiers are listed by tag and applied per Section 3.3.

Modifier tags: **SK** skill gap, **STR** strength, **MASS** mass/weight difference, **FAT** fatigue, **CAGE** cage proximity, **STK** strikes involved, **GRIP** no-gi grip realities, **WET** sweat/blood (late rounds), **RULE** ruleset flag.

### 3.2 Edge table

#### A. Guard passing (top-initiated)

| # | Transition | From | To (success) | To (failure / counter) | Requirements | dur (s) | base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|---|
| P1 | Knee cut / knee slice | `HALF_FLAT`, `HALF_KNEE_SHIELD`, `HQ` | `SIDE_CONTROL` (70 %), `MOUNT_LOW` (10 %), `KESA_GATAME` (20 %) | fail → same node; counter (25 % of fails) → bottom recovers `HALF_UNDERHOOK` or gets `HALF_DOGFIGHT`; (5 %) → leg entanglement `SLX` (elite bottom) | underhook or cross-face + pin the knee shield; top's inside knee across thigh; head low on far side | 6–15 | 35 % (most-used lower-belt pass: 93 % of white-belt passes are knee slice/knee pin/bullfighter, Williams 2019) | SK ++, STR +, MASS +, STK ++ (elbows to the head during the slice), CAGE + (bottom can't shrimp away), FAT (bottom) + | Knee shield + far frame; underhook + roll-under; "wrestle-up" on the sliced leg; leg-entanglement on the exposed lead leg |
| P2 | Toreando / bullfighter | `OPEN_SUPINE_LEGS_UP`, `OPEN_GUARD_KNEELING_TOP`, `STANDING_OVER_GUARD` | `SIDE_CONTROL` (60 %), `KNEE_ON_BELLY` (25 %), `NORTH_SOUTH` (15 %) | fail → bottom re-guards (`OPEN_...`) or stands (technical stand-up, 20 % of fails) | shin/ankle/knee control (no pants in MMA → grips slip; needs 2-on-1 on a leg or knee push), push legs aside, circle | 3–8 | 40 % (45 % vs MMA-typical weak open guard; ESTIMATE) | SK ++, WET − (sweaty shins), STK + (bottom must guard face → loses leg frames), GRIP − | Hip escape + re-guard; leg pummel; up-kick when top dives; bottom sits up to wrestle |
| P3 | Leg drag | `OPEN_GUARD_KNEELING_TOP`, `SLX`/`X_GUARD` (top escaping), `HALF_KNEE_SHIELD` (after stripping) | `SIDE_CONTROL` (50 %), `BACK_HOOKS` (20 %, via turtle) , `MOUNT_TECH` (10 %), `KNEE_ON_BELLY` (20 %) | fail → `HALF_FLAT` (bottom pulls knee back) or `SCRAMBLE` | drag the leg across own hip, pin thigh with hip, control far hip/head | 4–10 | 35 % | SK ++, WET −, STK + | Hip escape + knee-back; turn to turtle then stand (fail state for top is often `TURTLE`) |
| P4 | Over-under pass | `OPEN_GUARD_KNEELING_TOP`, `HALF_FLAT` (after freeing knee) | `SIDE_CONTROL` (80 %), `MOUNT_LOW` (20 %) | fail → same; counter: kimura on the over arm (10 % of fails), triangle on the under arm (5 %) | one arm under a leg, one over; head low; drive laterally | 5–15 | 40 % | STR ++, MASS ++, STK − (hands busy, no striking), CAGE + | Hip escape; kimura; frame on the head; leg on the shoulder → triangle |
| P5 | Double-under stack | `OPEN_GUARD_KNEELING_TOP`, `CLOSED_STANDING_TOP` (after opening) | `SIDE_CONTROL` (70 %), `MOUNT_LOW` (30 %) | fail → bottom re-guards; counter: triangle (5 %), kimura (5 %), back roll-over (bottom rolls backwards to escape stack, 10 %) → `SCRAMBLE` | both arms under thighs, clasp, stack hips over head | 5–15 | 35 % | STR ++, MASS ++, STK − , RULE (spiking illegal — stack is legal) | Bottom hand-fights hips, extends legs, rolls to knees (→ `TURTLE`) |
| P6 | Smash pass / cross-face smash from half | `HALF_FLAT`, `HALF_QUARTER` | `SIDE_CONTROL` (60 %), `MOUNT_LOW` (40 %) | fail → same; counter: bottom recovers underhook → `HALF_UNDERHOOK` (30 % of fails) | cross-face + underhook or head control; flatten bottom; free the foot by knee-out or foot-drag | 8–25 | 40 % (top of half with head control is the highest-percentage MMA pass, ESTIMATE) | STR ++, MASS ++, STK ++ (elbows force the frame down), CAGE +, FAT (bottom) ++ | Underhook + knee-shield recovery; kimura on the cross-face arm (rare); lockdown |
| P7 | Body-lock pass | `OPEN_SUPINE_LEGS_UP`, `BUTTERFLY`, `SEATED_SHIN_TO_SHIN`, `K_GUARD`, `HALF_KNEE_SHIELD` | `SIDE_CONTROL` (50 %), `HALF_FLAT` (top, with head control) (30 %), `MOUNT_LOW` (20 %) | fail → bottom keeps guard (`HALF_KNEE_SHIELD`) or wrestles up → `SCRAMBLE`/standing (15 % of fails) | chest-to-chest, arms locked around waist/hips, sprawl legs, walk hips around | 15–45 | 45 % (dominant no-gi pass; most-used pass in ADCC 66 kg, BJJ Heroes) | STR ++, MASS ++, STK − (no hands free), SK + , FAT (bottom) ++ | Frame on the shoulder/neck, knee shield, sit-up/wrestle-up, guillotine attempts on the lowered head |
| P8 | Headquarters → knee cut / leg weave / backstep | `HQ` | `SIDE_CONTROL` (60 %), `HALF_FLAT` top (20 %), `KESA_GATAME` (20 %); backstep → `NORTH_SOUTH`/`SIDE_CONTROL` | fail → `HALF_KNEE_SHIELD`; counter: leg-entanglement entry (`SLX`) on the pinned leg (10 % of fails at elite bottom), wrestle-up (20 %) | inside leg pinned between bottom's legs; outside knee/foot control; posture | 4–12 | 40 % | SK ++, STK ++ (punches from HQ posture), CAGE + | Bottom's inside knee push (pummel out), shin-to-shin, wrestle-up to single leg |
| P9 | Floating / backstep / weave pass (light, mobile) | `HQ`, `OPEN_GUARD_KNEELING_TOP`, `BUTTERFLY` | `SIDE_CONTROL` (40 %), `NORTH_SOUTH` (20 %), `KNEE_ON_BELLY` (20 %), `BACK_SEATBELT_NOHOOKS` (20 %) | fail → `SCRAMBLE` (high), or bottom gets `SLX` (15 % of fails) | balance, hip mobility, no commitment to pressure (Gordon Ryan "floating" style; needs advanced+) | 3–8 | 30 % (advanced/elite only; beginners 10 %) | SK +++, FAT (top) −, MASS − (lighter passers float better) | Wrestle-ups, leg entanglements, guard re-composition |
| P10 | Cage-assisted pass | any guard vs `CAGE_SEATED_BOTTOM` or wall-adjacent half guard | `SIDE_CONTROL_WALL` (60 %), `MOUNT_LOW` (10 %), `TURTLE_WALL` (30 %, bottom turns) | fail → bottom wall-walks to standing (30 % of fails) | bottom pinned with back/shoulders on the fence; top uses fence to stop hip escape; "pin the near hip, walk the far side" | 8–20 | 45 % (ESTIMATE) | CAGE ++ (this is the cage modifier), STR +, STK ++ | Wall walk with underhook; knee shield to create space along the fence; wrist control on the striking hand |
| P11 | Pass with GnP as pressure ("strike to pass") | any guard node where top has a free hand | as underlying pass (P1/P6/P8) | fail → same node, top stamina spent; counter: submission on the striking arm (armbar/kimura/triangle, 8 % of fails), sweep during posture (12 %) | posture, hips heavy, strike then pass while bottom covers | 10–30 | +8 pp on the underlying pass per 3 landed strikes (ESTIMATE; landed rate 58.6 % for ground punches/elbows, Roy & Murphy 2026) | STK (this is it), SK +, RULE (12–6 elbows; grounded knee rules) | Guard retention vs strikes: cover-and-frame; hip escape when top posts to punch; wrist control |
| P12 | Pass from north-south to mount / back | `NORTH_SOUTH` | `MOUNT_LOW` (spin), `BACK_SEATBELT_NOHOOKS` (when bottom turns) | fail → `SIDE_CONTROL` | hips heavy, arm control | 3–8 | 50 % | SK +, STK − | Bottom hip escapes to knees → `TURTLE` |

#### B. Top consolidation / advancement (non-pass)

| # | Transition | From | To (success) | To (failure / counter) | Requirements | dur (s) | base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|---|
| T1 | Side control → mount (knee slide / step-over) | `SIDE_CONTROL`, `KESA_GATAME`, `REVERSE_KESA` | `MOUNT_LOW` | fail → `HALF_FLAT` top (bottom catches the leg, 60 % of fails), `SIDE_CONTROL` (40 %) | cross-face, block near hip/knee, slide knee across | 3–8 | 45 % | SK +, STR +, STK + | Knee-in (bottom's near knee blocks), hip escape on the transition, catch half guard |
| T2 | Side control → knee on belly | `SIDE_CONTROL` | `KNEE_ON_BELLY` | fail → `SIDE_CONTROL`; counter: bottom turns in to knees → `TURTLE` (20 % of fails) | hip switch; posted foot | 1–3 | 70 % | SK + | Bottom follows the hip, turns in |
| T3 | Knee on belly → mount / back | `KNEE_ON_BELLY` | `MOUNT_LOW` (60 %), `BACK_SEATBELT_NOHOOKS` (40 % when bottom turns) | fail → `HALF_FLAT` top / `SCRAMBLE` (bottom explodes to knees) | pressure + timing | 2–5 | 50 % | SK +, STK + | Bottom's push-and-shrimp, turn to knees |
| T4 | Side control → north-south | `SIDE_CONTROL` | `NORTH_SOUTH` | fail → `SIDE_CONTROL`; counter: bottom turns to knees (`TURTLE`) 25 % | switch hips over head | 2–4 | 70 % | SK + | Bottom follows, hip escape |
| T5 | Mount low → high / S-mount | `MOUNT_LOW`, `MOUNT_GNP` | `MOUNT_HIGH` (70 %), `MOUNT_S` (30 %) | fail → `MOUNT_LOW`; counter: bottom gets elbow-knee escape during the climb → `HALF_FLAT` bottom (30 % of fails) | walk knees up with head/arms control, hips heavy | 3–8 | 50 % | SK ++, STK ++ (bottom's arms go up to cover → knees slide in), STR + | Elbows tight, hip escape, upa when top climbs high |
| T6 | Mount → technical mount (bottom turns) | `MOUNT_LOW`, `MOUNT_HIGH` | `MOUNT_TECH` | — (automatic when bottom turns to side; bottom-initiated) | — | 1–2 | 90 % (bottom chooses) | — | — |
| T7 | Technical mount → back | `MOUNT_TECH` | `BACK_HOOKS` (60 %), `BACK_ONE_HOOK` (40 %) | fail → `MOUNT_TECH`; counter: bottom re-guards to `HALF_FLAT` bottom (25 % of fails) / bottom stands to `SCRAMBLE` (10 %) | seatbelt/chest-to-back, insert hook as bottom turns | 2–5 | 65 % | SK ++, STK + | Bottom turns *back* into mount (rather than to belly), hip escape to guard, stands |
| T8 | Side control/turtle → crucifix | `SIDE_CONTROL` (bottom on side), `TURTLE` | `CRUCIFIX_SIDE`/`BACK_CRUCIFIX` | fail → `TURTLE`/`SIDE_CONTROL` | trap near arm with legs; control far wrist | 3–8 | 25 % (advanced+) | SK +++ | Keep elbows glued; roll through |
| T9 | Turtle → back (hooks) | `TURTLE`, `TURTLE_WALL`, `FRONT_HEADLOCK` | `BACK_HOOKS` (55 %), `BACK_ONE_HOOK` (30 %), `BACK_SEATBELT_NOHOOKS` (15 %) | fail → `TURTLE`; counter: bottom sit-out/granby (30 % of fails) → `SCRAMBLE`/bottom on top; wall-walk stand (25 % vs cage) | seatbelt, chest on back, spiral ride/hip control, insert near hook first | 3–8 | 45 % (83 % of ADCC 2022 male back takes were not from guard: passes/turtle/scrambles, BJJ Heroes) | SK ++, STK + (punches make bottom cover → hooks go in), STR +, CAGE ± | Hand-fight the seatbelt, sit-out, stand up, roll to guard ("turtle roll") |
| T10 | Front headlock → back (go-behind) | `FRONT_HEADLOCK`, `SPRAWL` | `BACK_SEATBELT_NOHOOKS`, `TURTLE` top | fail → `SCRAMBLE`/standing | chin strap + elbow control, snap down, circle behind | 2–5 | 45 % | SK ++, FAT (bottom) ++ | Re-shot, sit-out, wrist control, stand up |
| T11 | Half guard top → mount (knee through) | `HALF_FLAT` top, `HALF_QUARTER` | `MOUNT_LOW` | fail → `HALF_FLAT`; counter: bottom re-half or gets knee shield (35 % of fails) | free the trapped foot with knee pressure/foot-drag; head control | 5–15 | 35 % | STR +, MASS +, STK ++ | Lockdown, hooks on the leg, underhook & come up |
| T12 | Any dominant → GnP posture (enter `*_GNP` sub-state) | mount/side/half top | `MOUNT_GNP` etc. | — (bottom exploits: see escapes E1–E4 gain +10 pp while top is postured) | free hand, base | 0.5–1 | 95 % | — | — |
| T13 | Mat return from standing back | `BACK_STANDING` | `BACK_HOOKS` (60 %), `TURTLE` top (30 %), `SIDE_CONTROL` (10 %) | fail → standing clinch (Clinch agent) | rear body lock, trip/lift, land with hook | 2–5 | 55 % | STR ++, MASS ++, SK + , CAGE + (wall helps mat return) | Hand-fight the lock, hip heist, wall walk |

#### C. Sweeps and bottom-initiated reversals

| # | Transition | From | To (success) | To (failure / counter) | Requirements | dur (s) | base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|---|
| S1 | Hip-bump sweep | `CLOSED_POSTURE_UP` (top hands low or posting) | `MOUNT_LOW` top (bottom becomes top) | fail → `CLOSED_POSTURE_UP` (top re-bases), often sets up kimura/guillotine chains | sit up on one elbow, hip through, trap posting arm | 2–4 | 25 % (ESTIMATE; lower-belt gi "sit-up sweep" 38 % (Williams 2019), lower in MMA because top posts and punches) | STR +, MASS +, FAT (top) +, STK − (top with posture is harder to bump) | Base out, posture, punch on the sit-up |
| S2 | Scissor sweep | `CLOSED_POSTURE_BROKEN` (after opening) / `OPEN_GUARD_KNEELING_TOP` | `MOUNT_LOW` top | fail → `OPEN_GUARD_KNEELING_TOP` or top passes to `SIDE_CONTROL` (15 % of fails) | knee across chest, sleeve/wrist + collar-tie control (no-gi: wrist + head), chop | 2–4 | 20 % in MMA (gi lower belts: 55 %, Williams 2019) | GRIP −− (no sleeves), SK +, STK − | Post, knee in the middle, posture |
| S3 | Flower / pendulum sweep | `CLOSED_POSTURE_BROKEN`, `CLOSED_HIGH_GUARD` | `MOUNT_LOW` top | fail → `CLOSED_POSTURE_BROKEN`; chain → armbar | underhook the leg, pendulum leg, control arm | 2–4 | 20 % | GRIP −, SK + | Base wide, posture, pull arm free |
| S4 | Arm drag → back (from closed/butterfly/seated) | `CLOSED_POSTURE_BROKEN`, `BUTTERFLY`, `SEATED_SHIN_TO_SHIN` | `BACK_HOOKS` (40 %), `BACK_SEATBELT_NOHOOKS` (40 %), top in `SIDE_CONTROL`-like reversal (20 %) | fail → same guard; counter: top re-faces, may pass (20 % of fails) | 2-on-1 on the wrist/tricep, drag across, hip out | 2–4 | 20 % (lower-belt back-take from guard 60 % in gi, Williams 2019; ADCC 2022: only 17 % of back takes came from guard) | GRIP −, SK ++, WET − | Posture, elbow tight, re-square |
| S5 | Butterfly hook sweep | `BUTTERFLY`, `HALF_BUTTERFLY` | `MOUNT_LOW` top (50 %), `SIDE_CONTROL` top (30 %), `HALF_FLAT` top (20 %) | fail → `HALF_FLAT` bottom (top smashes) or `SCRAMBLE`; counter: top's body lock pass (P7) 25 % of fails, guillotine/D'Arce on head-down entries 5 % | underhook + overhook/wrist, chest-to-chest, elevate with hook | 2–4 | 35 % (most common scoring sweep in ADCC women's divisions, BJJ Heroes) | STR +, MASS +, SK ++, STK − | Sprawl the leg, post, body lock, head pressure |
| S6 | X-guard / SLX sweep (tripod, technical-stand sweep) | `X_GUARD`, `SLX` | standing over a downed opponent (top, `STANDING_OVER_GUARD` reversed) (60 %), `SIDE_CONTROL` top (20 %), `SCRAMBLE` (20 %) | fail → top steps out → `OPEN_SUPINE_LEGS_UP` / top passes with leg drag (30 % of fails) | hooks behind knee, off-balance; entry from butterfly/shin-to-shin | 2–5 | 45 % once established (X-guard 63 % at lower belts gi, Williams 2019); **entry** to X/SLX from seated guard 30 % | SK ++, WET −, STK − (top punching down while standing over X is rare but exists) | Free the trapped leg (knee-down), posture, punch down |
| S7 | K-guard → leg entanglement / back | `K_GUARD` | `SLX`/50-50 (leg-lock nodes, Sub agent), `BACK_HOOKS` (matrix) | fail → top body-locks (P7) or punches (STK), 40 % of fails end in `HALF_FLAT` bottom | knee across hip, grip behind the knee, invert | 2–5 | 30 % (advanced+ only) | SK +++, STK −− (head exposed to punches), RULE (heel hooks) | Body lock, sprawl, punch the exposed head |
| S8 | Deep-half sweeps (waiter, Homer Simpson, back take) | `HALF_DEEP` | `HALF_FLAT` top (40 %), `SIDE_CONTROL` top (30 %), `BACK_HOOKS` (30 % via coming up behind) | fail → `HALF_DEEP` (retry) or top smashes to `SIDE_CONTROL` (20 % of fails); counter: top's kimura/D'Arce (5 %) | under the hips, hug the leg, off-balance | 3–6 | 40 % | STR +, SK ++, STK − (top can elbow crown; RULE 12-6) | Cross-face, sit back on the hips, kimura |
| S9 | Underhook half → dogfight → sweep/back | `HALF_UNDERHOOK` | `HALF_DOGFIGHT` (entry, 45 %) → then `BACK_HOOKS` (35 %), single-leg to top (`SIDE_CONTROL`/standing) (40 %), roll-under to `SIDE_CONTROL` top (25 %) | fail → `HALF_FLAT` bottom (cross-face re-established) ; counter: top's whizzer → guillotine/D'Arce (10 % of fails), top's whizzer + hip switch to `SIDE_CONTROL`/`KESA` (30 %) | underhook, get to knees ("dogfight"), head outside, drive | 4–10 | dogfight entry 45 %; dogfight resolution favours underhook 55/45 (ESTIMATE) | STR ++, SK ++, FAT −, CAGE + (wall helps stand) | Whizzer, cross-face, hip switch, limp-arm |
| S10 | Lockdown → whip-up / electric chair / old-school | `HALF_LOCKDOWN` | `HALF_DOGFIGHT` (whip-up, 45 %), `HALF_FLAT` top (old school, 30 %), electric-chair sub node (25 %, Sub agent) | fail → `HALF_FLAT` bottom (top frees the leg); 10 % → top passes to `SIDE_CONTROL` | lockdown established (needs top's leg trapped), underhook or double underhooks | 4–10 | 30 % | STR +, SK ++, STK − (top elbows while stuck) | Free the leg by hip-switching, posture, elbows |
| S11 | Knee-shield → wrestle-up / technical stand-up | `HALF_KNEE_SHIELD`, `Z_GUARD` | standing (single-leg finish → Clinch agent) (50 %), `SCRAMBLE` (30 %), `SIDE_CONTROL` top (20 %) | fail → `HALF_FLAT` bottom (knee shield collapsed, 50 % of fails), `TURTLE` (top snaps down, 25 %) | frame + knee shield to make space, post hand, come up on the leg | 3–8 | 40 % | SK ++, STR +, CAGE ++ (wall-walk fusion), FAT (top) + | Snap-down to front headlock, cross-face, knee-cut through the shield |
| S12 | Rubber-guard sweeps / omoplata sweep | `CLOSED_RUBBER` | `SIDE_CONTROL` top (omoplata sweep), `MOUNT_LOW` top | fail → `CLOSED_POSTURE_BROKEN` | flexibility, mission control established | 3–8 | 20 % | SK ++, flexibility attribute | Posture, stack, punch over the top |
| S13 | Up-kick / feet-on-hips push to stand | `OPEN_SUPINE_LEGS_UP`, `STANDING_OVER_GUARD` | standing (Striking agent) via technical stand-up | fail → same; counter: top dives in with punches → `OPEN_GUARD_KNEELING_TOP`/`HQ` (30 % of fails) | feet on hips, push and hip-escape, post hand | 2–5 | 55 % (technical stand-up from seated: 75 % stand / 15 % re-guard / 10 % opponent gets HQ per BJJGraph community model, https://bjjgraph.org/Transitions/Technical-Stand-up; MMA ESTIMATE lower because top may just walk away or punch) | SK +, FAT (bottom) −, STK ± | Top backs off (referee may stand anyway), top dives (risk up-kick) |
| S14 | Bridge-and-roll from kesa / side (bottom hooks leg) | `KESA_GATAME`, `SIDE_CONTROL` | `SIDE_CONTROL` top (reversal) | fail → same | leg hook on top's trapped leg, bridge over shoulder | 2–4 | 15 % | STR ++, MASS ++ | Base wide, free the leg |

#### D. Escapes (bottom-initiated, not to standing)

| # | Transition | From | To (success) | To (failure / counter) | Requirements | dur (s) | base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|---|
| E1 | Elbow-knee (hip) escape from mount | `MOUNT_LOW`, `MOUNT_GNP` | `HALF_FLAT` bottom (70 %), `HALF_KNEE_SHIELD` (20 %), `CLOSED_POSTURE_UP` bottom (10 %) | fail → `MOUNT_LOW` (top re-mounts) or `MOUNT_HIGH` (top climbs, 30 % of fails) | elbows inside, bridge to make space, shrimp, insert knee | 3–8 | 30 % (from `MOUNT_HIGH`/`MOUNT_S`: 12 %) | SK ++, STR +, FAT −−, STK − (covering hands → no frames), MASS (top) − | Grapevines, high mount, cross-face, punch when the elbow drops |
| E2 | Upa / bridge-and-roll | `MOUNT_LOW`, `MOUNT_GNP` (top's arm posted) | `CLOSED_POSTURE_UP` top (bottom becomes top in guard) | fail → `MOUNT_LOW` / `MOUNT_HIGH` (top posts and climbs, 40 % of fails); counter: armbar on the trapped arm when bottom pushes (5 %) | trap one arm and same-side foot, bridge diagonally | 2–4 | 20 % (35 % when top has just posted to punch — the classic MMA GnP counter) | STR ++, MASS ++, STK + (top posted), SK + | Post the free hand wide, spread knees, don't cross feet behind |
| E3 | Kipping / "shrimp + kip" escape (elite) | `MOUNT_HIGH`, `MOUNT_S` | `HALF_FLAT` bottom, `SCRAMBLE` | fail → `MOUNT_HIGH` | explosive hip lift + turn, arms not trapped | 1–3 | 15 % (elite 25 %) | SK +++, STR +, FAT −− | Head/arm control, ride the hips |
| E4 | Turn to belly / give the back (from mount) | `MOUNT_HIGH`, `MOUNT_GNP` | `TURTLE` (bottom's intent) but usually → `BACK_HOOKS`/`MOUNT_TECH` for top | — (this is the beginner/damage-avoidance behaviour; success = out of punches, cost = back exposure) | none | 1–2 | 90 % to turn; 70 % of turns end in `BACK_HOOKS`/`MOUNT_TECH` at competent top | SK (top) ++ | Top follows to technical mount/back |
| E5 | Frames + hip escape from side control → guard | `SIDE_CONTROL`, `SIDE_CONTROL_WALL` | `HALF_FLAT` bottom (50 %), `HALF_KNEE_SHIELD` (30 %), `CLOSED_POSTURE_UP` bottom (20 %) | fail → `SIDE_CONTROL`; counter: top takes mount/KOB during bridge (15 % of fails), D'Arce/arm triangle on the frame (5 %) | forearm in neck, hand on hip, bridge, shrimp | 3–8 | 30 % | SK ++, STR +, FAT −−, CAGE − (wall stops the shrimp), STK − | Cross-face, hip block, switch to KOB/N-S, knee-cut mount |
| E6 | Underhook → turn to knees (side → turtle/dogfight) | `SIDE_CONTROL`, `KESA_GATAME`, `NORTH_SOUTH` | `TURTLE` (50 %), `HALF_DOGFIGHT`-like wrestling (30 %), standing via wall-walk (20 %) | fail → `SIDE_CONTROL`; counter: guillotine/anaconda/D'Arce on the turn (10 % of fails), back take (25 % of fails) | near-side underhook, bridge, turn to knees | 2–5 | 30 % | STR +, SK ++, CAGE ++ (wall walk), STK + (bottom turns to escape punches) | Front-headlock chokes, seatbelt/back take, flatten |
| E7 | Granby roll (side/turtle → guard) | `SIDE_CONTROL` (top light), `TURTLE`, `NORTH_SOUTH` | `OPEN_GUARD_KNEELING_TOP` bottom / `HALF_KNEE_SHIELD` | fail → same node or top takes back (20 % of fails) | shoulder roll along the mat; needs space | 1–3 | 15 % (elite 30 %) | SK +++, flexibility, MASS (top) −− | Weight on the hips/shoulders, crucifix if arm exposed |
| E8 | Escape knee-on-belly (push knee + shrimp) | `KNEE_ON_BELLY` | `HALF_FLAT` bottom (60 %), `OPEN_GUARD_KNEELING_TOP` bottom (40 %) | fail → `KNEE_ON_BELLY`/`MOUNT_LOW`; counter: armbar on the pushing arm (10 % of fails) | push the knee, shrimp, turn in | 2–4 | 40 % | STR +, SK +, STK − (top punches from KOB) | Follow the hips, punch, switch sides |
| E9 | Escape north-south (frame + turn to knees / hip escape to guard) | `NORTH_SOUTH` | `TURTLE` (50 %), `HALF_FLAT`/`OPEN_GUARD` bottom (50 %) | fail → `NORTH_SOUTH`; counter: north-south choke/kimura (10 % of fails) | hands on the hips, hip escape, roll to knees | 3–6 | 25 % | STR +, SK ++, FAT − | Weight on chest, arm control, knee to body (legal) |
| E10 | Back escape: hand-fight + escape to the "hips-down / choking-arm" side → guard | `BACK_HOOKS`, `BACK_ONE_HOOK` | `HALF_FLAT` bottom (40 %), `CLOSED_POSTURE_UP` bottom (20 %), `SIDE_CONTROL` bottom (40 %, "escape but top stays on top") | fail → `BACK_HOOKS` (retry), `BACK_BODY_TRI` (top upgrades, 20 % of fails); counter: RNC secured (the sub agent's finish node, 15 % of fails vs elite top) | 2-on-1 on the choking hand, chin tucked, get shoulders to mat on the choking-arm side, clear the top hook | 5–15 per attempt | 15 % per attempt from `BACK_HOOKS`; 35 % from `BACK_ONE_HOOK` (ESTIMATE anchored to elite back-take → sub p = 0.45, Lamas 2024) | SK +++, FAT −−, WET + (slippery), STK − (punches to the side of the head), MASS (top) − | Straitjacket (trap the far wrist with the leg), body triangle, seatbelt switch, "chair sit" |
| E11 | Back escape vs body triangle | `BACK_BODY_TRI` | `BACK_HOOKS`-lite / `HALF_FLAT` bottom / `SIDE_CONTROL` bottom | fail → `BACK_BODY_TRI` | attack the locked ankle (knee pressure on the foot), turn toward the lock, slide down | 10–25 | 10 % per attempt | SK +++, FAT −−, flexibility (top) − | Re-lock, switch sides, punch |
| E12 | Wall-walk back escape (stand up with opponent on back → peel at the fence) | `BACK_HOOKS` (bottom sitting/standing against fence), `BACK_STANDING` | standing with rear body lock (`BACK_STANDING`, Clinch agent) (60 %), free standing (40 %) | fail → dragged back down → `BACK_HOOKS` (retry) | fence within reach, hand-fight the choke first, walk hips up the wall | 5–15 | 40 % vs hooks when bottom can reach the fence (ESTIMATE; this is the primary MMA back escape at UFC level) | CAGE +++, STR ++, MASS ++, SK ++ | Break the bottom's base (hooks stretch), mat return, choke while standing |
| E13 | Escape crucifix | `CRUCIFIX_SIDE`, `BACK_CRUCIFIX` | `TURTLE`, `SIDE_CONTROL` bottom | fail → same; counter: choke/armbar (15 % of fails) | pull the trapped arm out by turning the thumb, roll | 5–15 | 15 % | SK ++, STR + | Keep the leg lock on the arm, strike |
| E14 | Turtle → sit-out / peek-out / stand-up / roll to guard | `TURTLE`, `TURTLE_WALL`, `FRONT_HEADLOCK` | standing (35 %), `SCRAMBLE` (30 %), bottom re-guards `HALF_KNEE_SHIELD` (20 %), sit-out to top (15 %) | fail → `TURTLE`; counter: back take with hooks (30 % of fails), front-headlock choke (10 %) | hand-fight the seatbelt, head up, hip heist / sit-out | 2–5 | 35 % (45 % vs cage with wall-walk) | SK ++, STR +, CAGE ++, FAT −− | Spiral ride, hooks, chin strap |
| E15 | Recover guard from half-guard-passed transitions (guard retention) | any P-edge failure | `HALF_KNEE_SHIELD`, `OPEN_GUARD_KNEELING_TOP` | — | hip mobility, frames | 1–3 | inherent in P-edge failure rates | SK, FAT | — |
| E16 | Escape kesa gatame (bridge + leg hook / frame under chin + turn in) | `KESA_GATAME` | `HALF_FLAT` bottom (50 %), reversal (S14) (20 %), `TURTLE` (30 %) | fail → `KESA_GATAME`/`MOUNT_LOW` (top switches) | trap the near leg or frame under the jaw | 3–8 | 25 % | STR ++, MASS ++ | Hips low, control the arm, switch to mount |

#### E. Get-ups (bottom → standing) — see also Section 5

| # | Transition | From | To (success) | To (failure / counter) | Requirements | dur (s) | base % | Modifiers | Counters |
|---|---|---|---|---|---|---|---|---|---|
| G1 | Technical stand-up (open guard vs standing opponent) | `OPEN_SUPINE_LEGS_UP`, `SEATED_SHIN_TO_SHIN`, `BUTTERFLY` (opponent standing or backed off) | standing at range (Striking agent) | fail → `HQ` (top re-engages, 40 % of fails), `OPEN_SUPINE_LEGS_UP` (40 %), `FRONT_HEADLOCK`/`SPRAWL` (top snaps down, 20 %) | post hand, lead knee up, hip lift, retreat leg | 1.5–3 | 55 % vs engaged opponent; 90 % vs disengaged (BJJGraph 75/15/10 model) | SK +, FAT −, STK ± (top's punches while bottom posts) | Re-engage with punches, snap-down, chase into the fence |
| G2 | Wall walk (from half/side/turtle bottom against the fence) | `CAGE_SEATED_BOTTOM`, `HALF_FLAT` bottom (near fence), `SIDE_CONTROL_WALL`, `TURTLE_WALL` | standing clinch on the fence (Clinch agent), usually with opponent's body lock (`BACK_STANDING` or front body lock) | fail → `CAGE_SEATED_BOTTOM`/`HALF_FLAT` bottom (dragged down, 60 % of fails), `TURTLE_WALL` (30 %), `BACK_HOOKS` (10 %) | fence within reach, underhook or wrist control on the near arm, walk hips up | 5–15 | 40 % per attempt (ESTIMATE); cumulative over 30 s vs equal-tier top ~60 % | CAGE +++ (required), STR ++, MASS ++, SK ++, FAT −− | Body lock + inside knee ("knee pin"), hip pressure, pull the far ankle ("chain wrestling"), re-takedown |
| G3 | Wrestle-up from butterfly / knee shield / underhook half (come up on a single leg) | `BUTTERFLY`, `HALF_KNEE_SHIELD`, `HALF_UNDERHOOK`, `HALF_DOGFIGHT` | single-leg (Wrestling/Clinch agent) (60 %), free standing (25 %), `SIDE_CONTROL` top via reversal (15 %) | fail → `HALF_FLAT` bottom (50 %), `TURTLE` (30 %), `FRONT_HEADLOCK` bottom (20 %) | underhook or wrist/head control, base on one knee, drive | 3–8 | 40 % (elite 55 %) | SK ++, STR ++, CAGE +, FAT −− | Sprawl, whizzer, snap-down, cross-face |
| G4 | Stand up from closed guard (open + shrimp + stand) | `CLOSED_POSTURE_UP` bottom | `OPEN_SUPINE_LEGS_UP` → G1 chain | fail → `HALF_FLAT` bottom (top passes during the opening, 40 % of fails) | frames on hips, open guard, foot on hip | 3–6 | 35 % to reach G1 | SK +, STK − (top punching), FAT − | Top drops weight, passes when the guard opens |
| G5 | Stand from turtle (wall or open) | `TURTLE`, `TURTLE_WALL` | standing (clinch/free) | fail → `TURTLE`/`BACK_*` | hand control on the seatbelt hands, head up, walk feet in | 2–5 | 35 % (wall 45 %) | CAGE ++, STR +, SK ++ | Hooks, mat return |
| G6 | Stand up after escaping the back (hips down escape → stand) | `BACK_ONE_HOOK`, `BACK_SEATBELT_NOHOOKS` | standing with rear body lock or free | fail → `BACK_HOOKS` | clear the hook, base on the far foot | 3–6 | 35 % | CAGE ++, STR + | Re-hook, body triangle |

#### F. Top-initiated disengage / referee

| # | Transition | From | To | Requirements | dur (s) | base % | Notes |
|---|---|---|---|---|---|---|---|
| R1 | Top stands out of guard (disengage) | any guard top | `STANDING_OVER_GUARD` → both standing | choice | 1–2 | 95 % (bottom may hold a leg → 5 % `SLX`/single leg) | Elite strikers vs dangerous guards do this; costs judges' "control" |
| R2 | Referee stand-up | any guard node with no "work" events | both standing (Striking agent) | inactivity timer | — | — | Unified Rules: referee restarts when neither fighter demonstrates "real, significant and/or sustained effort to advance"; no fixed time. ESTIMATE 30–60 s inactivity in guard; 15–30 s longer if top is in a dominant position (side/mount/back) because "improving position" counts as work (https://en.wikipedia.org/wiki/Unified_Rules_of_Mixed_Martial_Arts, https://agentmma.com/mma-lab/ufc-control-time-explained). |
| R3 | Round ends | any | standing at start of next round | — | — | — | Positional advantage does not carry over; average UFC ground stint truncated by the bell roughly 15 % of the time (ESTIMATE). |

### 3.3 Modifier model (apply to `base%`)

Let `p0` = base success, expressed as log-odds `L0 = ln(p0/(1−p0))`. Compute `L = L0 + Σ terms`, then `p = 1/(1+e^−L)`, clamped to [0.02, 0.95].

| Tag | Term | Notes |
|---|---|---|
| **SK** | `+0.55 × Δtier` per marked `+` (so `++` = 1.1 × Δtier), where Δtier = attacker tier − defender tier on a 0–4 scale (brand new, beginner, intermediate, advanced, elite) | One tier of skill gap ≈ +12–13 pp near 50 %; two tiers ≈ +25 pp. Calibrated so an elite passer vs a beginner guard passes on ~85 % of attempts. |
| **STR** | `+0.20 × (strength_z_attacker − strength_z_defender)` per `+` | strength z-score within weight class |
| **MASS** | `+0.08 × Δkg/5` per `+` (cap ±0.6) | 10 kg advantage ≈ +7 pp on pressure edges with `++` |
| **FAT** | `−0.9 × (1 − stamina_frac)` per `−` on the tired party (attacker or defender as indicated); `+` means the *opponent's* fatigue helps | At 50 % stamina a `−−` action loses ~20 pp; gassing beginners lose more (tier-scaled ×1.3 for brand new/beginner) |
| **CAGE** | `+0.35` per `+` when the acting fighter is within 1 m of the fence and the edge lists CAGE; `−0.35` per `−` | Wall walk requires the fence; cage-assisted passing requires bottom's back/shoulders at the fence |
| **STK** | `+0.25` per landed strike in the last 5 s (max 3) for edges marked STK `+`; `−0.25` for `−` edges when the actor is *absorbing* strikes; STK `−` on a top edge means the top cannot strike during it | Landed rate for ground strikes 58.6 % (Roy & Murphy 2026) |
| **GRIP** | `−0.3` per `−` in no-gi/MMA vs the gi baseline | Only used if the sim also supports gi grappling rulesets |
| **WET** | `−0.15` per `−` in round 3+ or when blood/sweat flag set | Sweat makes leg/wrist control slip |
| **RULE** | Edge disabled or re-weighted by ruleset flags (`heelHooks`, `elbows12to6`, `kneesToGroundedHead`, `spiking`) | Section 9 |
| **Posture bonus** | +0.4 for bottom escapes/sweeps while top is in a `*_GNP` postured sub-state | Trade-off for striking |
| **Chaining** | +0.3 for a second consecutive pass attempt within 5 s of a failed one ("pass → pass" 0.30 transition, Lamas 2024) and for sweep → sub chains | Elite tier only (advanced 0.15) |

---

## 4. Ground-and-pound model per position

Data anchors: 58.6 % landed rate for ground hammerfists/elbows/punches (931 attempts, Roy & Murphy 2026); 0.9–4.0 *significant* ground strikes per minute of control for elite controllers (Fight Algorithm); ground striking + chokes produced 35 of 44 finishes in the lower-weight UFC sample vs 9 from stand-up striking; Bloody Elbow 2014: extra time in **mount and side control raises TKO odds; half guard and back do not** (back raises submission odds). 36 % of Makhachev's landed significant strikes come on the floor (https://fightforecast.substack.com/p/will-islam-makhachevs-control-put).

Model per node (values are ESTIMATE unless noted): **rate** = attempted strikes/min when the top chooses to strike; **land%** = P(lands clean, not blocked/absorbed by arms); **dmg×** = damage multiplier vs a standing power punch by the same fighter (1.0 = full standing punch); **types** = legal, realistic strikes; **openings** = what striking gives the bottom (bonus applied to the listed edges while top is postured); **judge** = how much a minute of this scores with judges (0–3).

| Node | Posture options | rate (/min) | land % | dmg× | types | Openings for bottom while striking | Sub risk to top while striking | judge |
|---|---|---|---|---|---|---|---|---|
| `MOUNT_HIGH` / `MOUNT_S` | seated-high (elbows), postured (punches) | 25–40 | 65 % | elbows 0.9, punches 0.8, hammerfists 0.6 | elbows (12-6 legal under 2024 rules — flag), punches, hammerfists | upa +15 pp if top posts a hand; elbow-knee escape +10 pp on the climb; turn to back (E4) | armbar vs a beginner top who straight-arms the mat (2 % per 10 s); otherwise ~0 | 3 (10-8 territory after ~60 s of sustained GnP) |
| `MOUNT_LOW` | seated (hips low), postured | 15–30 | 55 % | 0.6 | punches, hammerfists to body/head, short elbows | upa +20 pp when postured; E1 +10 pp | ~0 | 2 |
| `MOUNT_TECH` | knee-up, chest on shoulder | 20–35 | 65 % | 0.8 | punches/hammerfists to the exposed side of the head, elbows | bottom turns back into guard (T7 counter) | armbar on far arm is top's, not bottom's; ~0 | 2.5 |
| `BACK_HOOKS` / `BACK_BODY_TRI` | belly-down: punches to side of head; supine: none | 10–25 | 60 % | 0.5 (no hip rotation) | punches, hammerfists, short elbows to the side of the head (no strikes to the back of the head — foul) | bottom's hand-fighting gets a free hand when top strikes: E10 +10 pp | ~0 | 2.5 (3 if bottom is flat and absorbing) |
| `BACK_CRUCIFIX` / `CRUCIFIX_SIDE` | fixed | 30–50 | 85 % (unanswered) | 0.8 | elbows, punches | none | ~0 | 3 (fast TKO node; ESTIMATE 35 % TKO per 30 s vs any tier) |
| `SIDE_CONTROL` | cross-face elbows, knee-on-belly punches (T2), knees to body | 12–25 | 55 % | elbows 0.6, knees to body 0.5 | short elbows, knees to the body (head illegal), punches after T2 | E5 +10 pp when top lifts to strike; E6 +10 pp | ~0 (kimura on the striking arm only vs brand-new top) | 2 |
| `KESA_GATAME` | near arm trapped: short elbows/hammerfists with free hand | 10–20 | 60 % | 0.5 | hammerfists, elbows | S14 +10 pp (bridge when top lifts) | ~0 | 2 |
| `KNEE_ON_BELLY` | upright: full punches | 20–35 | 55 % | 0.8 | punches, hammerfists | E8 +15 pp (bottom pushes knee when top winds up) | armbar 2 % | 2.5 |
| `NORTH_SOUTH` | knees to body only; otherwise a control node | 5–10 | 60 % | 0.4 | knees to the body, short hammerfists to ribs | E9 +5 pp | ~0 | 1.5 |
| `HALF_FLAT` (top) | head control + free-hand punches; cross-face elbows; "punch the frame down" | 15–30 | 55 % | elbows 0.7, punches 0.6 | elbows, punches, hammerfists, shoulder pressure | S9/S11 +10 pp (underhook when top sits up), E-recovery +5 pp | kimura on the posting arm 3 % per 30 s; guillotine on posture break 3 % | 2.5 (the highest-volume MMA GnP node: Khabib/Usman/Covington) |
| `HALF_KNEE_SHIELD` (top) | very limited; punches to body/legs | 5–12 | 40 % | 0.3 | punches to body, hammerfists over the shield | wrestle-up +0 (top not committed) | ~0 | 1 |
| `HALF_DEEP` / `HALF_LOCKDOWN` (top) | elbows to crown/back of head illegal; elbows to top of the head legal (flag 12-6) | 8–15 | 60 % | 0.5 | elbows, hammerfists | S8/S10 +10 pp when top sits up | kimura 1 % | 1.5 |
| `CLOSED_POSTURE_UP` (top) | postured punches, elbows when bottom pulls | 12–25 | 45 % | 0.5 (0.7 for elbows when close) | punches, elbows, body shots | S1 hip bump +15 pp when top posts a hand; armbar/triangle entry when top over-commits (Sub agent) | triangle/armbar 4 % per 30 s of postured striking vs advanced+ bottom; kimura 2 % | 1.5 (judges score it, but less than dominant positions) |
| `CLOSED_POSTURE_BROKEN` (top) | almost none (short body punches) | 3–8 | 40 % | 0.2 | short punches to body/ribs, short elbows to thigh | bottom attack node | high: sub attempts by bottom 1.0/min at advanced+ | 0.5 (bottom may win the exchange in judges' eyes with sub attempts) |
| `OPEN_GUARD_KNEELING_TOP` / `HQ` | postured punches, diving punches | 10–20 | 45 % | 0.6 | punches, hammerfists, leg kicks (thighs) when standing | armbar/triangle 3 % per 30 s; sweeps +10 pp; up-kick when standing | 3 % | 1.5 |
| `STANDING_OVER_GUARD` | diving punches, leg kicks to thighs, soccer kicks illegal (flag) | 6–15 | 40 % | 0.7 (diving punches land hard but rarely) | punches, kicks to legs/body | up-kick (bottom) 0.6 dmg× to the head is *legal* (top is standing); technical stand-up (G1) | up-kick KO risk 1 % per 10 s (ESTIMATE) | 1 |
| `TURTLE` (top) | punches to the side of the head, knees to the body, hammerfists | 15–30 | 60 % | 0.6 | punches, hammerfists, knees to body (head illegal — flag `kneesToGroundedHead` for ONE/PRIDE-style rules) | E14 +10 pp when top strikes instead of riding | ~0 | 2.5 |
| `FRONT_HEADLOCK` (top) | knees to body, short uppercuts, elbows to the side/top of head | 10–20 | 55 % | 0.6 | knees to body, uppercuts, elbows | re-shot +10 pp | guillotine is top's exit, not a risk | 2 |
| **Bottom striking** (any guard) | elbows from closed/half guard, up-kicks vs standing, hammerfists from bottom | 5–15 | 40 % | 0.3 (elbows 0.4; up-kicks 0.6) | elbows, short punches, up-kicks (only vs standing), heel kicks to kidneys (legal) | — | — | 0.5 (rarely wins rounds, but stops 10-8s) |

**GnP finish model (ESTIMATE):** each landed strike deals `dmg× × strike_power × (1 + 0.15 × posture)` to a ground-damage pool; the referee stops the fight when the bottom fighter fails to "intelligently defend" — model as `P(stoppage per landed clean strike) = 0.02 × dmg× × (1 + damage_pool/threshold)` plus a hard stop on KO-threshold. At elite top vs beginner bottom in `MOUNT_HIGH` this yields ~50 % TKO within 30 s; at equal elite tier ~15 % per 30 s (bottom escapes/turtles first), consistent with mount being the primary TKO node (Bloody Elbow 2014). **Judge credit**: GnP is "effective striking" for the top; a minute of mount/back with 10+ landed strikes reaches 10-8 territory under the 2017+ Unified scoring guidance (dominance + damage) (https://en.wikipedia.org/wiki/Unified_Rules_of_Mixed_Martial_Arts).

---

## 5. Get-up model

Anchors: UFC lower-weight sample: 36.2 % of time on the ground (Roy & Murphy 2026); Bloody Elbow 2014: 38.1 % of time in someone's ground control; UFC-wide takedown accuracy ~42 % (Fight Encyclopedia, https://fightencyclopedia.com/blog/blog-most-effective-takedowns-in-mma-by-success-rate), 31.6 % in the lower-weight sample. Cage time 20.9 % of all fight time. BJJGraph community model of the technical stand-up: 75 % stand / 15 % back to seated guard / 10 % opponent takes HQ. No published MMA study measures "time to stand after takedown" directly — the distribution below is an ESTIMATE reconciling ground-time share with per-fight takedown counts (~2 landed per 15 min in UFC averages → ~2.5–3 min of ground time per landed takedown as an *upper bound* including guard-pull/knockdown ground time).

### 5.1 Duration of a ground stint after a completed takedown (equal skill tier, ESTIMATE)

| Duration to bottom fighter standing (or referee stand-up / bell) | Share of stints |
|---|---|
| < 15 s (immediate wall-walk / technical stand-up, "takedown for nothing") | 20 % |
| 15–45 s | 25 % |
| 45–120 s | 30 % |
| 120–300 s (full-round control) | 20 % |
| ends by finish (sub/TKO) | 5 % (rises to 25 % when the top is two tiers better) |

Tier shift: each tier of top advantage moves ~10 % of mass from the first two rows to the last three; each tier of bottom advantage does the opposite. Elite wrestler-controllers (Khabib, Makhachev, Usman, Covington: 7:17–7:44 average control per fight; Almeida 84 % control-time percentage) represent the far tail: their opponents stand within 45 s on fewer than ~20 % of takedowns (ESTIMATE from the control-time leaderboards, https://thefightalgorithm.com/articles/the-invisible-round, https://nyfights.com/mma/5-active-ufc-fighters-with-the-most-control-time/).

### 5.2 Get-up success per attempt by starting node (equal tier, fresh; ESTIMATE)

| Bottom node | Preferred get-up edge | p per attempt | dur (s) | With cage reachable | Typical failure state |
|---|---|---|---|---|---|
| `OPEN_SUPINE_LEGS_UP` (opp. standing) | G1 technical stand-up | 55 % | 2 | 65 % (wall gives a post) | `HQ` / re-guard |
| `SEATED_SHIN_TO_SHIN` / `BUTTERFLY` | G3 wrestle-up / G1 | 45 % | 3–5 | 55 % | `HALF_FLAT` bottom / `FRONT_HEADLOCK` |
| `HALF_KNEE_SHIELD` | S11/G3 | 40 % | 4–8 | 55 % | `HALF_FLAT` bottom |
| `HALF_UNDERHOOK` → dogfight | S9/G3 | 40 % | 5–10 | 50 % | `HALF_FLAT` bottom / guillotine risk |
| `HALF_FLAT` (top has head control) | must first recover underhook/knee shield (E-recovery 30 %) | 15 % (compound) | 10–20 | 30 % (wall walk G2) | stays `HALF_FLAT` |
| `CLOSED_POSTURE_UP` | G4 → G1 | 20 % (compound) | 6–10 | 30 % | `HALF_FLAT` bottom |
| `SIDE_CONTROL` | E6 → G5/G2 | 12 % | 8–15 | 25 % | `TURTLE` → back exposure |
| `MOUNT_LOW` | E1 → recover half → wrestle-up | 5 % (compound) | 15–30 | 10 % | `MOUNT_HIGH`, back |
| `TURTLE` | E14/G5 | 35 % | 3–5 | 45 % | `BACK_HOOKS` |
| `BACK_HOOKS` (seated vs fence) | E12 wall-walk back escape | — | 5–15 | 40 % | `BACK_HOOKS` (retry), `BACK_BODY_TRI` |
| `CAGE_SEATED_BOTTOM` | G2 wall walk | 40 % (per 10 s) | 5–15 | (is cage) | `CAGE_SEATED_BOTTOM` (pinned), `TURTLE_WALL` |

Cumulative rule: attempts repeat every `dur` seconds while the bottom AI keeps choosing to get up; the top's counter-choices (body lock, knee pin, GnP) reduce `p` through the modifier table. A bottom fighter who gets up but is still held (rear body lock / front body lock at the fence) hands off to the Clinch agent — in UFC the majority of wall walks end in a fence clinch, not free space (ESTIMATE 70 %).

### 5.3 Cage usage rules

1. The wall is reachable when the fighters are within ~1 m; takedowns landed against the fence (the majority of UFC takedowns, consistent with 20.9 % cage time) start in `CAGE_SEATED_BOTTOM` or `HALF_FLAT`-near-fence.
2. Bottom benefits: G2 wall walk (needs the near-side underhook or a hand on the fence, no fence *grabbing* — a foul), E12 back escape, easier turtle stand-ups.
3. Top benefits: P10 cage-assisted pass, easier mat returns (T13), `SIDE_CONTROL_WALL` pin; the bottom cannot hip-escape *into* the fence.
4. Net: if the bottom has the underhook, the cage favours the bottom (+0.35 on get-ups); if the top has the underhook/body lock, the cage favours the top (+0.35 on pins/passes). Implement as an `underhook_owner` flag on cage-adjacent nodes.

---

## 6. Skill-tier behaviour differences

Tier scale used by the modifier model: 0 brand new, 1 beginner (≈ white/blue belt, < 2 yr), 2 intermediate (≈ purple, MMA regional), 3 advanced (≈ brown/black, UFC-level grappler), 4 elite (ADCC/world-class or UFC top-10 grappler).

| Behaviour | Brand new (0) | Beginner (1) | Intermediate (2) | Advanced (3) | Elite (4) |
|---|---|---|---|---|---|
| Bottom default | Flat on back, closed guard if lucky; turns to belly under strikes (E4 90 % of the time); straight-arm pushes the chest from mount (armbar exposure 3×) | Closed guard, holds and stalls (→ referee stand-ups); knows hip escape but slow (dur ×1.5) | Half-guard game: knee shield, underhook, dogfight; some butterfly; wall walks | Full guard retention; butterfly/SLX entries; wrestle-ups; leg-lock threats to deter passes; cage-savvy | Fluid: never flat; chains sweep → sub → get-up; wrestle-ups from every seated guard; uses strikes' openings (upa on posts) |
| Top default | Lies in guard, punches wildly, posts hands (upa +20 pp); gets swept from mount by upa 2× | Passes only with basic knee-cut/stack; holds side control without advancing; GnP from half at low rate | Knee cut + smash pass + cross-face GnP from half; takes mount; loses back control by rushing the RNC | Chain passing (pass → pass 0.30); body lock; floating; strikes to pass; systematic back control (hooks → body triangle → hand fight) | Positional chains with minimal risk; converts turtle to back 60 %+; GnP volume without giving up posture; finishes from every dominant node |
| Energy | Grappling stamina cost ×1.6 (panics, holds breath); gassed by 90 s of scrambling | ×1.3 | ×1.1 | ×1.0 | ×0.9 (efficient) |
| Decision latency (s between edge attempts) | 4–8 | 3–5 | 2–4 | 1.5–3 | 1–2 |
| Turns back / gives up the back | 60 % of side-control escapes | 40 % | 20 % | 8 % | 3 % (turns only with a plan: wall walk / roll) |
| Escape attempts per 30 s under mount | 1 (bridge-and-push) | 2 | 3 | 4 | 5 (kipping + elbow-knee + frames) |
| Submission-exit awareness while striking | none (arm extended: armbar 5 %/10 s) | low | medium | high | very high |
| Uses cage | no | rarely | yes (wall walk) | yes (both sides) | yes, and denies opponent's use (knee pin, body lock pinning) |
| Pass repertoire (weights for AI choice) | stack 60 / knee-cut 40 | knee-cut 50 / stack 30 / toreando 20 (Williams 2019: 93 % of white-belt passes are knee slice/knee pin/bullfighter) | knee-cut 35 / smash 25 / toreando 20 / over-under 10 / body lock 10 | knee-cut 25 / body lock 20 / leg drag 15 / toreando 15 / HQ 15 / float 10 | body lock 25 / float 20 / knee-cut 20 / leg drag 15 / toreando 10 / cage 10 |
| Sweep repertoire | none (bucks) | hip bump / scissor / basic butterfly | butterfly / underhook half / knee shield wrestle-up | + X/SLX, deep half, arm drag | + K-guard, leg entanglements, matrix back takes |
| Guard retention vs strikes | breaks: guard opens on 3 landed strikes | opens on 5 | holds, re-guards | holds, frames + wrist control | holds; counters strikes with sweeps/subs |

MMA-specific consensus from coaching material (Zahabi, Melanson, Ryan Hall, Jack Slack breakdowns — coaching content, not fetched; treat as expert opinion): (a) bottom priority order in MMA is stand up > sweep > submit, reversing sport BJJ; (b) closed guard in MMA is a posture-break-and-stand tool; (c) the top fighter's first job after a takedown is head control (cross-face/chin) because it kills both the wrestle-up and the wall walk; (d) knees-to-belly/knee-on-belly and turtle striking are the fastest MMA ways to force the bottom fighter to give the back; (e) leg entanglements are rare in MMA because the head is exposed to punches during entries (Ryan Hall being the counter-example).

---

## 7. Data tables with sources

### 7.1 Fight-time distribution (MMA)

| Metric | Value | Source |
|---|---|---|
| Time standing / ground / clinch, UFC FLW-BW-FW 2014–15 (91 bouts) | 49.63 % / 36.17 % / 13.36 % | Roy & Murphy 2026, https://www.cambridgepublish.com/css/article/download/243/250/797 |
| Cage-contact time | 20.91 % of match time (12,977 s) | same |
| Fight time with someone in ground control (UFC, 2014 analysis) | 38.1 % (1:54 per 5:00) | Bloody Elbow, https://bloodyelbow.com/2014/03/26/ufc-mma-analytics-ground-control-fighters-win-knockout-tko-submission-decision/ |
| Effect of extra ground time on finish odds | Mount and side control raise TKO odds; half guard and back control do not raise TKO (back raises submission) | same |
| Takedown success (lower weights) | 31.6 % overall (1,023 attempts); lower-body 39.8 %, upper-body 13.8 %, combined 44.0 %; 4.33 attempts/round | Roy & Murphy 2026 |
| Takedown success (UFC-wide) | ~42 % average; elite wrestlers > 60 % | Fight Encyclopedia, https://fightencyclopedia.com/blog/blog-most-effective-takedowns-in-mma-by-success-rate |
| Outcomes (8,591 UFC bouts 1994–2026) | KO/TKO 32.6 %, SUB 19.3 %, DEC 46.8 %; avg fight 10:37 | Grappler HQ, https://www.grapplerhq.com/mma/ufc-statistics/; Fight Matrix, https://www.fightmatrix.com/2026/07/31/how-fights-actually-end-finish-rates-by-weight-class/ |
| Round of early stoppage (lower weights) | R1 45.6 %, R2 26.1 %, R3 21.8 %, R5 6.5 % | Roy & Murphy 2026 |

### 7.2 Control time and judging

| Metric | Value | Source |
|---|---|---|
| Decisions won by fighter with more control time (3,850 UFC decisions) | 68.2 % overall; gap 0–1 min 51.0 %, 1–3 min 57.2 %, 3–5 min 70.3 %, 5+ min 87.4 % | The Fight Algorithm, https://thefightalgorithm.com/articles/the-invisible-round |
| Avg control per fight, top controllers | Usman 7:44, Dawson 7:23, GSP 7:22, Covington 7:21, Khabib 7:17 | same |
| Ground strikes per minute of control | Khabib 4.0, GSP 3.0, Fitch 2.6, Sherk 1.2, Covington 0.9 | same |
| When the controller loses the decision (1,211 fights) | controller 49.1 sig. strikes vs opponent 69.6 | same |
| Control-time percentage records | Almeida 84.2 % (alt. method 69.9 %), Chimaev 65.8 % (56.5 %) | NY Fights, https://nyfights.com/mma/5-active-ufc-fighters-with-the-most-control-time/; AgentMMA, https://agentmma.com/mma-lab/ufc-control-time-explained |
| Makhachev control | 52 % of cage time in control; 36 % of landed sig. strikes on the floor; 3.41 TD/15 min | Fight Forecast, https://fightforecast.substack.com/p/will-islam-makhachevs-control-put |
| Judging | control alone does not score; effective striking/grappling first; 10-8 for "large amounts of time in dominant grappling positions" with damage | AgentMMA (above); Wikipedia Unified Rules, https://en.wikipedia.org/wiki/Unified_Rules_of_Mixed_Martial_Arts |

### 7.3 Ground strikes and submissions (MMA)

| Metric | Value | Source |
|---|---|---|
| Ground punches/elbows landed | 546 / 931 = 58.6 %; "other" ground strikes 87/352 = 24.7 % | Roy & Murphy 2026 |
| Ground submission attempts success (all) | 21 / 157 = 13.4 % | same |
| RNC | 8 / 21 = 38.1 % | same |
| Armbar / kimura / shoulder lock | 15.4 % (4/26) / 7.7 % (1/13) / 22.2 % (2/9) | same |
| Guillotine / triangle | 10.5 % (2/19) / 11.5 % (3/26) | same |
| Leg locks | 0 / 16 | same |
| UFC submission mix (1,659 subs) | RNC 39.1 %, guillotine 17.7 %, armbar 11.8 %, arm triangle 7.6 %, triangle 6.9 %, D'Arce 2.8 %, kimura 2.6 %, anaconda 2.3 %; chokes 78.8 %, arm locks 15.0 %, leg locks 3.3 % | Grappler HQ, https://www.grapplerhq.com/mma/ufc-statistics/ |
| RNC finishes in UFC through 2024 | > 300 (older count) | Fight Encyclopedia, https://fightencyclopedia.com/techniques/position/back-position |
| Finishes by category (lower weights, 46 finishes) | ground striking 14, ground submissions 21 (76.1 % of finishes); stand-up striking 9 | Roy & Murphy 2026 |

### 7.4 Grappling competition (BJJ / no-gi)

| Metric | Value | Source |
|---|---|---|
| Elite no-gi (WSFC 2019, 93 matches) actions per competitor per match | takedown, sweep, back-take each < 1; submission attempts 1.03 | Lamas et al. 2024, https://journals.sagepub.com/doi/10.1177/17479541231210979 |
| Highest transition probabilities | pass attempt → pass attempt 0.30 (within-competitor); takedown attempt → opponent's submission attempt 0.15 | same |
| Back-take → direct submission attempt | 0.45 (highest reward–risk balance) | same |
| No-gi sub-only (26 matches, UK regional + international) | match 245 ± 227 s / 311 ± 206 s; standing:ground 1:2; ground time 79–87 %; high-intensity 18–20 %; dominant-position time winners > losers (ES 0.39); r = 0.50 with upper-body subs; heel-hook winners 0 s dominant position | Spanias, Kirk & Øvretveit 2022, https://shura.shu.ac.uk/31193/ |
| White/blue belt IBJJF (140 fights) | guard pull 94 %; passes 93 % (white) / 71 % (blue) knee slice + knee pin + bullfighter; sweeps: scissor 55 %, back take 60 %, X-guard 63 %, sit-up 38 %; submissions attempted: armbar 34 %, triangle 21 %, collar choke 12 % (inverse use/success) | Williams, Callaway, Gara & Tattersall 2019, https://eprints.bournemouth.ac.uk/32250/ |
| ADCC 2024 | 45 submissions (34 % rate; CJI 36 %); 26 passes and 17 back takes (male); takedowns: 15 single legs, 13 doubles, 5 uchi mata, 5 throw-bys, 5 de ashi, 4 body locks, 3 knee taps, 3 arm drags, 3 ankle picks; body lock most-used pass in 66 kg (3× knee cuts); Davies 5 knee-cut passes | BJJ Heroes, https://www.bjjheroes.com/editorial/adcc-2024-after-math-data-compilation-and-analysis; https://www.bjjheroes.com/editorial/analysis-of-guard-passing-in-the-adcc |
| ADCC 2024 division sub rates | +99/-99 kg 56.25 %; men's absolute 43.75 %; -66 kg 40 %; -88/-77 kg 31.25 %; women 25–43 % | FloGrappling, https://www.flograppling.com/articles/12792712-history-made-adcc-records-stats-from-2024 |
| ADCC 2022 | 40 subs (41 incl. superfight); 27 male passes; 17 % of male back takes from guard attacks | BJJ Heroes, https://www.bjjheroes.com/editorial/adcc-2022-after-math-data-compliation-and-analysis |
| ADCC women 2015–22 | butterfly hook sweep the top scoring bottom technique | BJJ Heroes, https://www.bjjheroes.com/editorial/adcc-female-division-stats-and-analysis |
| Technical stand-up (community model) | 75 % stand / 15 % re-seat / 10 % opponent HQ | BJJGraph, https://bjjgraph.org/Transitions/Technical-Stand-up |
| ADCC 2024 technical trends | body-lock takedowns "negate most of the scramble back up"; back control held until body triangle; north-south finishing of passes; Gordon Ryan "back-tracking" 21 pts | FloGrappling, https://www.flograppling.com/articles/12792696-bear-traps-mir-locks-more-technical-trends-from-2024-adcc-worlds |

### 7.5 Derived sim anchors (ESTIMATE, from the above)

| Quantity | Value | Derivation |
|---|---|---|
| P(finish per minute of `BACK_HOOKS`, equal elite tier) | 20 % | 0.45 chance of an immediate sub attempt per back take (Lamas) × RNC conversion 38 % (Roy & Murphy) ≈ 17 %, plus repeated attempts |
| P(finish per minute of `MOUNT_HIGH`, equal advanced tier) | 15–20 % (TKO 12 %, sub 5 %) | mount → TKO odds rise (Bloody Elbow); mount finishes mostly TKO in MMA |
| P(finish per minute of `SIDE_CONTROL`) | 5 % | "not great for finishing" (Bloody Elbow) |
| P(finish per minute of `HALF_FLAT` top) | 3 % (TKO via accumulation), sub 1 % | half-guard time does not raise TKO odds |
| P(pass per 30 s in a guard node, equal tier) | 25 % | ADCC 2024: 26 passes over ~90 male matches of 10–20 min ⇒ ~0.3 passes/match at elite parity; MMA strikes and weaker guards roughly triple it |
| P(sweep per 30 s from open/half guard, equal tier) | 15 % | sweeps < 1 per competitor per match at elite; lower belts 38–63 % per attempt but attempts are rare |
| Ground stint length (Section 5.1) | median ~60 s | ground share 36–38 % vs ~2 TDs/15 min |

---

## 8. Sim rules to implement

1. **Graph**: implement the nodes of Section 2 as an enum with `top`/`bottom` fighter slots and a `cage` flag (`near_fence`, `underhook_owner`). Every edge in Section 3 gets `{from, toSuccess[], toFail[], dur, base, modifiers[], counters[]}`; weighted `toSuccess/toFail` arrays use the percentages in the tables.
2. **Tick**: resolve ground actions on a 0.5 s tick; each fighter chooses an edge when their decision-latency timer (tier-based, Section 6) expires; the edge occupies `dur` seconds; both fighters can act concurrently — resolve as a contested roll (attacker `p` vs defender's counter edge `p`) with the higher-tier fighter's action resolved first on ties.
3. **Success probability**: `p = sigmoid(logit(base) + Σ modifier terms)`, clamp [0.02, 0.95], per Section 3.3.
4. **Skill gap**: `Δtier` term `+0.55 × Δtier` per `+`; two-tier gap makes passing ~85 % and escaping ~10 %.
5. **Failure/counter split**: on failure roll the counter share; counters send the attacker to the *worse* node listed (e.g., failed knee cut with 25 % counter → `HALF_UNDERHOOK` for the bottom).
6. **Chaining**: an attempt within 5 s of a failed attempt of the same family gets +0.3 logit (advanced +0.15, elite +0.3, lower tiers 0), modelling pass → pass 0.30 (Lamas).
7. **Posture trade-off**: entering a `*_GNP` sub-state gives the top striking access (Section 4) and the bottom +0.4 logit on escapes/sweeps that list a posture bonus, for as long as the top stays postured.
8. **Strikes-to-pass**: each landed ground strike in the last 5 s adds +0.25 logit (max 3) to STK`+` pass/advance edges and drains bottom stamina 0.5 % per landed strike; landed rate baseline 58.6 %, minus bottom's guard/frames (tier-scaled −5 pp per tier).
9. **GnP damage**: per-strike damage = `dmg× × striker_power × posture_factor`; feed the Striking agent's damage/KO pool; referee stoppage check per Section 4 GnP finish model; require ≥ 3 unanswered clean strikes before any stoppage roll.
10. **Bottom striking**: allow elbows/short punches from `CLOSED_*`, `HALF_*` bottom at dmg× 0.3 and up-kicks (dmg× 0.6) only from `OPEN_SUPINE_LEGS_UP`/`STANDING_OVER_GUARD` when the opponent is standing; illegal if opponent is grounded (ruleset flag).
11. **Submission exits**: every node's sub exits are edges handed to the Submissions agent with a per-node *entry* rate (elite ≈ 1.0 attempt/min in attacking nodes; back-take → immediate attempt 0.45); the Submissions agent returns finish/failure and a return node (e.g., failed armbar from mount → `CLOSED_POSTURE_UP` bottom or `SCRAMBLE`).
12. **Back control upgrades**: from `BACK_HOOKS`, top may attempt body triangle (5 s, 60 % at advanced+); `BACK_BODY_TRI` halves the bottom's E10 rate; `BACK_ONE_HOOK` decays to `BACK_HOOKS` (top, 50 %/5 s) or to escape (bottom, 35 %/5 s).
13. **Turtle = back exposure**: any node transition into `TURTLE` starts a 3 s window in which the top's T9 back take gets +0.3 logit; beginners enter turtle from strikes 40–60 % of the time (Section 6).
14. **Get-up priority**: bottom AI at tier ≥ 2 chooses a get-up edge (G1–G6, S11) on 60 % of decisions unless a sweep/sub edge has `p ≥ 0.45`; tier 1 chooses closed guard hold 50 % / hip escape 30 % / get-up 20 %; tier 0 chooses "turn away/push" 60 %.
15. **Ground stint distribution**: calibrate so that the stint duration after a completed takedown at equal tier matches Section 5.1 (median ≈ 60 s; 20 % < 15 s; 20 % full-round). Check overall ground share ≈ 30–40 % of fight time for a wrestler-vs-striker card mix.
16. **Cage**: `near_fence` set when the takedown lands within 1 m of the fence (default 65 % of takedowns, from cage-time share) or when a scramble moves there; apply CAGE modifiers per edge; `underhook_owner` decides who benefits (Section 5.3). Fence grabbing is a foul: bottom may post *on* the fence with an open hand but "grab" events (5 % of wall walks at tier ≤ 1) trigger a referee warning and a −0.5 logit on that attempt.
17. **Referee stand-up**: maintain `inactivity` seconds since the last "work" event (landed strike, pass/sweep/escape/sub attempt, positional improvement). When `inactivity ≥ 30 s` in guard nodes (`≥ 45 s` in side/mount/back, because holding a dominant position with intermittent strikes usually persists), roll a stand-up at 20 %/s (≈ certain within 8 s). Reset on any work event. Unified Rules give no fixed timer.
18. **Round end**: reset to standing; carry damage/stamina only.
19. **Fatigue**: grappling on the ground drains stamina at 1.0 (top control), 1.4 (top passing/GnP), 1.6 (bottom escaping/wrestling up), 0.6 (bottom holding closed guard) × tier multiplier (Section 6); apply FAT terms per edge. Bottom-of-side-control/mount is the most expensive state for the bottom fighter.
20. **Mass/strength**: MASS `+` edges are pressure edges (P4–P7, P10, T1, T11, T13, S1, S5, E2, E12, G2); use kg difference at fight time, not division.
21. **Sweat (WET)**: from round 3 (or blood flag), apply −0.15 logit to grip-dependent edges (P2, P3, S4, S6, E10 `+`).
22. **Judge credit**: accrue `control_time` (any top dominant node or bottom's back control) and `ground_effective_strikes`; a round with a control gap ≥ 3 min gives the controller the round 70 % of the time, ≥ 5 min 87 % (Fight Algorithm) unless the opponent out-lands them standing by ≥ 20 sig. strikes; 10-8 when ≥ 3 min dominant position **and** ≥ 15 landed ground strikes or a near-finish.
23. **Damage → guard retention**: bottom's guard-retention edges lose −0.1 logit per 5 % of the ground-damage pool; brand-new/beginner guards "open" after 3/5 landed strikes (Section 6).
24. **Escape-to-hip rule** (back): E10 success requires the bottom to first win a hand-fight roll (2-on-1 on the choking hand, 3 s, 50 % at equal tier); losing it 3× in a row allows the Submissions agent an RNC attempt with +0.3 logit.
25. **Gives-up-back**: when the bottom chooses E4 (turn away) under mount GnP, the top gets T6 automatically and T7 with +0.3 logit.
26. **Scramble resolution**: `SCRAMBLE` resolves in 1–4 s by a contested roll weighted by wrestling skill (Wrestling agent), stamina and mass: winner lands in `FRONT_HEADLOCK`/`TURTLE` top/`SIDE_CONTROL`/standing per the originating edge's `toFail` list.
27. **Referee restart vs stalling top**: if the top holds a guard node with no strikes and no pass attempts for 20 s, apply the inactivity rule regardless of position "control".
28. **Ruleset flags** (Section 9): `heelHooks`, `elbows12to6`, `kneesToGroundedHead`, `soccerKicks`, `spiking`, `groundedDefinition2024`, `pointsSystem` (none/IBJJF/ADCC/EBI-OT). Disable/enable edges and sub exits accordingly.
29. **Logging**: emit events `PASS`, `SWEEP`, `ESCAPE`, `BACK_TAKE`, `MOUNT`, `KOB`, `GET_UP`, `WALL_WALK`, `GNP_LANDED`, `REF_STANDUP` with node ids so that per-fight statistics can be checked against Section 7 (targets: 0.3–1.0 passes/match at parity, 36–38 % ground time on a mixed card, RNC ≈ 39 % of submissions, ground-strike landed rate ≈ 58 %).
30. **Sanity clamps**: no single edge may exceed p = 0.95; no bottom fighter may spend > 5 min in `MOUNT_HIGH` without a stoppage roll every 5 s; ground stints cannot exceed the round.

---

## 9. Grappling ruleset notes

Values below are from the governing rulebooks (IBJJF Rule Book v6.0 at https://ibjjf.com/books-videos; ADCC rules at https://adcombat.com/adcc-rules-and-regulations/ — both pages were reachable only as index/403 during this session, so the numbers are quoted from the author's knowledge of the current rulebooks and should be re-verified against the PDFs before shipping a points mode).

### 9.1 IBJJF (gi and no-gi points)

| Event | Points | Stabilisation |
|---|---|---|
| Takedown | 2 | 3 s on top, opponent's back/side on the mat |
| Sweep (from guard to top) | 2 | 3 s |
| Knee on belly | 2 | 3 s |
| Guard pass | 3 | 3 s in side control / north-south / kesa |
| Mount (incl. technical mount, S-mount) | 4 | 3 s, both knees or one knee + one foot |
| Back mount (hooks in) / back control | 4 | 3 s, both hooks (or body triangle counts with the no-gi rule change), no crossed feet |
| Advantages | tiebreaker for near-completed moves / near-submissions | — |
| Penalties | stalling (first: warning, then advantage/points to opponent, then DQ), pulling guard without engaging in no-gi: penalty | — |

Match durations: white 5 min, blue 6, purple 7, brown 8, black 10 (adult); masters shorter. Heel hooks and knee reaping: legal in no-gi brown/black (since 2021), illegal in gi. Slams illegal; spiking illegal.

### 9.2 ADCC

| Event | Points |
|---|---|
| Takedown (opponent lands on back/side, control) | 2 (4 if the takedown lands directly past the guard — "clean takedown") |
| Sweep | 2 (4 if it passes the guard in the same motion) |
| Knee on belly | 2 |
| Guard pass | 3 |
| Mount | 2 |
| Back mount (hooks or body triangle) | 3 |
| Pulling guard (after the no-points period) | −1 |
| Stalling / passivity | −1 per penalty (after warning); repeated passivity → DQ |

Format: 10 min matches at Worlds (finals 20 + 20; absolute finals 40), **no points in the first half** ("submission-only period"); overtime (3 min, then referee decision) if tied. 3 s hold requirement. Heel hooks, reaping, all leg locks legal (adult). No strikes. ADCC 2024 sub rate 34 % (BJJ Heroes) → most matches are decided by points/decision, hence the importance of passes (3) and back (3).

### 9.3 Submission-only and EBI overtime

- Pure sub-only (e.g., regional events in Spanias 2022): no points; draws by referee decision; ground time 79–87 % of match; heel-hook players ignore positional control.
- EBI overtime rules: alternating starts from `BACK_HOOKS` (seatbelt, hooks) or armbar "spiderweb"; escape time is the tiebreaker. Useful as a calibration harness: at elite level a hooks-and-seatbelt back start is escaped roughly half the time within ~60 s when both players know the format (ESTIMATE; EBI archive numbers not fetched).

### 9.4 MMA (Unified Rules) ground-relevant flags

- Grounded = any part other than hands/feet touching (2024 ABC update, closes the "one hand down" loophole) — https://en.wikipedia.org/wiki/Unified_Rules_of_Mixed_Martial_Arts.
- Illegal: knees/kicks to the head of a grounded opponent, stomps, soccer kicks, spiking on head/neck, strikes to the back of the head/spine, fence grabbing, small-joint manipulation, groin. 12-6 elbows: legal under the November 2024 ABC amendment where adopted (flag `elbows12to6`).
- Referee restart: "when neither fighter... demonstrates real, significant and/or sustained effort to advance towards finishing the fight"; maintaining a superior position alone is not effort.
- Judging: effective striking/grappling first; sub attempts and dominant positional time count as effective grappling; 10-8 for sustained dominance + damage.
- Promotion variants (flags): ONE FC (12-6 elbows, knees to grounded head allowed, no cage — ring or cage variants), RIZIN (soccer kicks/knees to grounded head, ring with ropes → no wall walk, more sweeps), PFL/Bellator as Unified.

---

## 10. Assumptions and gaps

1. **No public per-position transition data for MMA.** UFCStats records control time, takedowns, sub attempts and (in the raw feed) ground strikes, but not positions. All per-node dwell times, pass/sweep/escape rates in MMA are ESTIMATES anchored to: (a) BJJ per-attempt rates at lower belts (Williams 2019), (b) elite no-gi Markov transitions (Lamas 2024), (c) ADCC counts (BJJ Heroes/FloGrappling), (d) MMA time-share and strike/sub conversion (Roy & Murphy 2026; Bloody Elbow 2014). Priority for future validation: hand-tag 50 UFC fights for node dwell times and get-up latency.
2. **Bloody Elbow 2014 model coefficients** (odds ratio per extra minute in each position) could not be retrieved (paywall/403) — only the qualitative direction was recovered from the search excerpt. If the design team can access the article, replace the Section 7.5 per-minute finish anchors.
3. **Roy & Murphy 2026** is a small (91 bouts, 2014–15, flyweight–featherweight) sample from a low-profile journal; treat their sub-conversion rates as indicative (n = 9–26 per technique) and expect heavier divisions to show higher GnP finish rates (heavyweight finish rate 66 % vs ≈ 45 % at featherweight and below — Fight Matrix).
4. **Sweep numbers from Williams 2019** are gi, white/blue belt, no strikes; MMA values were scaled down (×0.4–0.6) for grips and punches. Elite no-gi sweeps are rare (< 1/match), so the per-attempt rate at elite parity is probably ≈ 30–40 % with few attempts — the sim should get rarity from *attempt frequency*, not from very low per-attempt p.
5. **BJJGraph** numbers are a community wiki's modelling constants, not measurements; used only for the technical stand-up outcome split.
6. **Rulebook values** (IBJJF/ADCC tables) are from memory of the current rulebooks because the PDFs could not be fetched; re-verify before implementing point scoring.
7. **Referee stand-up timing** is behaviourally variable (referee-specific); the 30–60 s inactivity ESTIMATE is consensus from broadcast observation, not a rule.
8. **Web search budget was exhausted mid-task**, so several coaching sources named in the brief (Danaher/BJJ Fanatics, Lachlan Giles, Gordon Ryan, Jack Slack, Ryan Hall, Zahabi, Melanson, Jiu-Jitsu X, Grapplearts) were not fetched; their influence here is limited to widely known technical consensus (labelled as such) and no numeric claims are attributed to them.
9. **Not covered (belongs to other agents):** finishing mechanics and per-submission conversion by node (Submissions agent); takedown entries, sprawls and mat returns from standing (Wrestling/Clinch agents); knockdown → ground entries and striking damage pools (Striking agent).
10. **Gaps worth a follow-up brief:** women's divisions (ADCC women's sub rates 25–43 %; MMA women's finish rates lower, e.g., strawweight 66 % decisions) may need lower GnP dmg×; heavyweight-specific fatigue and mass effects; ring vs cage (RIZIN/PRIDE) get-up rates; the 2024 grounded-knee rule change's effect on turtle behaviour (fighters no longer "hand-down" to avoid knees → more genuine turtling and more back exposure).
